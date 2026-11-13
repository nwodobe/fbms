-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 (pilote) — migration 3/4 : RPC ET
-- SYNCHRONISATION
-- ---------------------------------------------------------------------
-- STATUT : NON APPLIQUÉE EN PRODUCTION (réplique locale uniquement).
-- PRINCIPES
--   * Toutes les écritures passent par ces fonctions SECURITY DEFINER,
--     qui contrôlent le rôle, le périmètre et l'état avant d'écrire.
--   * Tirage reproductible : ordre croissant de sha256('<graine>:<numéro>').
--     Graines NON CHOISIES par l'agent (audit du 13/11/2026) :
--       blocs  = '<graine de campagne>:<plot_id>:BLOCS'
--       arbres = '<graine de campagne>:<plot_id>:B<numéro du bloc>:ARBRES'
--     La graine de campagne est aléatoire, tirée par le serveur, créée par le BM
--     avant toute installation et immuable. Réinstaller ne change pas le tirage. Le navigateur applique
--     le même calcul hors ligne ; le serveur fait foi et recalcule.
--   * b (blocs tirés) est transmis AVANT le tirage et verrouillé avec lui.
--     Un tirage verrouillé ne peut être ni rejoué ni modifié.
--   * Synchronisation dédiée (pheno_sync_batch) : offline_sync_batch n'est
--     pas modifiée. Idempotence par clé + empreinte de la demande.
--   * Une visite soumise, en vérification ou validée n'est JAMAIS écrasée
--     par un envoi hors ligne : les écarts deviennent des propositions de
--     correction.
-- CODES D'ERREUR : PH001 droit refusé · PH002 donnée invalide · PH409 conflit.
-- RETOUR ARRIÈRE : supabase/20261113100400_aflp_observatoire_rollback.sql
-- REJOUABLE : oui (create or replace).
-- =====================================================================
begin;

create or replace function private.pheno_hex(p text) returns text
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

-- k premiers numéros de 1..n dans l'ordre du tirage
create or replace function private.pheno_tirage(p_graine text, p_n integer, p_k integer) returns integer[]
language sql immutable set search_path to 'public', 'private', 'pg_temp' as $$
  select coalesce(array_agg(i order by h, i), '{}')
  from (select i, private.pheno_hex(p_graine || ':' || i) h from generate_series(1, p_n) i
        order by 2, 1 limit greatest(p_k, 0)) t
$$;

create or replace function private.pheno_arbre_id(p_bloc uuid, p_numero integer) returns uuid
language sql immutable set search_path to 'public', 'private', 'pg_temp' as $$
  select substr(private.pheno_hex(p_bloc::text || ':ARBRE:' || p_numero), 1, 32)::uuid
$$;

create or replace function private.pheno_journaliser(p_cluster text, p_entite text, p_id uuid, p_action text,
  p_ancienne jsonb, p_nouvelle jsonb, p_motif text) returns void
language sql security definer set search_path to 'public', 'pg_temp' as $$
  insert into public.pheno_journal (acteur, cluster_code, entite, entite_id, action, ancienne, nouvelle, motif)
  values (auth.uid(), p_cluster, p_entite, p_id, p_action, p_ancienne, p_nouvelle, p_motif)
$$;

create or replace function private.pheno_campagne_ouverte(p_campaign uuid) returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (select 1 from public.campaigns where id = p_campaign and status = 'OPEN')
$$;

create or replace function private.pheno_graine(p_campaign uuid) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select graine from public.pheno_graines where campaign_id = p_campaign
$$;

-- Création unique de la graine de campagne par le Branch Manager (aléa serveur).
create or replace function public.pheno_graine_creer(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_g text;
begin
  if private.pheno_classe() is distinct from 'BM' then raise exception 'Réservé au Branch Manager.' using errcode = 'PH001'; end if;
  if not exists (select 1 from public.campaigns where id = p_campaign) then raise exception 'Campagne inconnue.' using errcode = 'PH002'; end if;
  select graine into v_g from public.pheno_graines where campaign_id = p_campaign;
  if v_g is not null then return jsonb_build_object('campaign_id', p_campaign, 'graine', v_g, 'deja_creee', true); end if;
  v_g := private.pheno_hex(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.pheno_graines (campaign_id, graine, cree_par) values (p_campaign, v_g, auth.uid());
  perform private.pheno_journaliser(null, 'GRAINE', p_campaign, 'GRAINE_CREEE', null, jsonb_build_object('graine', v_g), null);
  return jsonb_build_object('campaign_id', p_campaign, 'graine', v_g, 'deja_creee', false);
end $$;

-- ---------------------------------------------------------------------
-- Tirage des arbres, quand tous les blocs tirés sont inventoriés
-- ---------------------------------------------------------------------
create or replace function private.pheno_tirer_arbres(p_panel uuid) returns void
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_panel public.pheno_panels; v_b record; v_ordre integer[]; v_i integer; v_rang_t integer := 0; v_rang_r integer := 0;
  v_manque integer := 0; v_incompat text := null; v_proba numeric; v_detail jsonb := '[]'::jsonb;
begin
  select * into v_panel from public.pheno_panels where id = p_panel for update;
  if v_panel.statut <> 'TIRAGE_VERROUILLE' then return; end if;
  if exists (select 1 from public.pheno_blocs where panel_id = p_panel and tire and nb_arbres_inventories is null) then return; end if;

  -- Un bloc tiré trop petit est une incompatibilité signalée : on ne gonfle
  -- jamais N et on ne remplace jamais le bloc.
  for v_b in select * from public.pheno_blocs where panel_id = p_panel and tire order by rang_tirage loop
    if v_b.nb_arbres_inventories < v_b.nb_titulaires_prevus then
      update public.pheno_blocs set incompatible = true where id = v_b.id;
      v_incompat := concat_ws(' ; ', v_incompat, format('bloc %s : %s arbres inventoriés pour %s titulaires prévus',
        v_b.numero, v_b.nb_arbres_inventories, v_b.nb_titulaires_prevus));
    end if;
  end loop;
  if v_incompat is not null then
    update public.pheno_panels set statut = 'INCOMPATIBLE', incompatibilite = v_incompat,
      row_version = row_version + 1, updated_at = now() where id = p_panel;
    perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', p_panel, 'INCOMPATIBILITE', null,
      jsonb_build_object('detail', v_incompat), null);
    return;
  end if;

  for v_b in select * from public.pheno_blocs where panel_id = p_panel and tire order by rang_tirage loop
    v_ordre := private.pheno_tirage(private.pheno_graine(v_panel.campaign_id) || ':' || v_panel.plot_id::text || ':B' || v_b.numero || ':ARBRES', v_b.nb_arbres_inventories,
      least(v_b.nb_arbres_inventories, v_b.nb_titulaires_prevus + v_b.nb_reserves_prevues));
    v_proba := coalesce(v_panel.pi_village, 1) * coalesce(v_panel.pi_champ, 1)
      * (v_panel.nb_blocs_tires::numeric / v_panel.nb_blocs_total)
      * (v_b.nb_titulaires_prevus::numeric / v_b.nb_arbres_inventories);
    for v_i in 1 .. coalesce(array_length(v_ordre, 1), 0) loop
      if v_i <= v_b.nb_titulaires_prevus then
        v_rang_t := v_rang_t + 1;
        insert into public.pheno_arbres (id, panel_id, bloc_id, code, numero_inventaire, role, rang, statut, proba_inclusion)
        values (private.pheno_arbre_id(v_b.id, v_ordre[v_i]), p_panel, v_b.id,
          'B' || v_b.numero || '-' || lpad(v_ordre[v_i]::text, 3, '0'), v_ordre[v_i], 'TITULAIRE', v_rang_t, 'ACTIF', v_proba);
      else
        v_rang_r := v_rang_r + 1;
        insert into public.pheno_arbres (id, panel_id, bloc_id, code, numero_inventaire, role, rang, statut, proba_inclusion)
        values (private.pheno_arbre_id(v_b.id, v_ordre[v_i]), p_panel, v_b.id,
          'B' || v_b.numero || '-' || lpad(v_ordre[v_i]::text, 3, '0'), v_ordre[v_i], 'RESERVE', v_rang_r, 'RESERVE_EN_ATTENTE', null);
      end if;
    end loop;
    v_manque := v_manque + greatest(0, v_b.nb_titulaires_prevus + v_b.nb_reserves_prevues - v_b.nb_arbres_inventories);
    v_detail := v_detail || jsonb_build_object('bloc', v_b.numero, 'graine', private.pheno_graine(v_panel.campaign_id) || ':' || v_panel.plot_id::text || ':B' || v_b.numero || ':ARBRES',
      'N', v_b.nb_arbres_inventories, 'm', v_b.nb_titulaires_prevus, 'ordre', to_jsonb(v_ordre), 'proba', v_proba);
  end loop;

  update public.pheno_panels set statut = 'ACTIF', reserves_manquantes = v_manque,
    row_version = row_version + 1, updated_at = now() where id = p_panel;
  perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', p_panel, 'TIRAGE_ARBRES', null,
    jsonb_build_object('algorithme', 'sha256(graine:numero) croissant', 'blocs', v_detail,
      'reserves_manquantes', v_manque, 'proba_amont_renseignee', v_panel.pi_village is not null and v_panel.pi_champ is not null), null);
end $$;

-- ---------------------------------------------------------------------
-- Installation d'un champ : blocs, b fixé, tirage des blocs, verrouillage
-- ---------------------------------------------------------------------
create or replace function public.pheno_panel_installer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_id uuid := (p->>'id')::uuid; v_campaign uuid := (p->>'campaign_id')::uuid; v_plot public.farmer_plots;
  v_cluster text; v_total integer := (p->>'nb_blocs_total')::integer; v_tires integer := (p->>'nb_blocs_tires')::integer;
  v_proto public.pheno_protocoles; v_exist public.pheno_panels; v_titulaires integer; v_reserves integer;
  v_ordre integer[]; v_bloc jsonb; v_rang integer; v_m integer; v_r integer; v_n integer;
begin
  if private.pheno_classe() is null then raise exception 'Accès à l''Observatoire refusé.' using errcode = 'PH001'; end if;
  if v_id is null or v_campaign is null or (p->>'plot_id') is null then
    raise exception 'Identifiants manquants (champ, campagne ou parcelle).' using errcode = 'PH002'; end if;

  select * into v_plot from public.farmer_plots where id = (p->>'plot_id')::uuid and not deleted;
  if not found then raise exception 'Parcelle introuvable dans le registre producteurs.' using errcode = 'PH002'; end if;
  select public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster'))
    into v_cluster from public.villages v where v.id = v_plot.village_id;
  if v_cluster is null then raise exception 'Le village de la parcelle n''est rattaché à aucun cluster AFLP.' using errcode = 'PH002'; end if;
  if not private.pheno_peut_collecter(v_cluster) then
    raise exception 'Installation réservée aux agents du cluster %.', v_cluster using errcode = 'PH001'; end if;

  select * into v_exist from public.pheno_panels where id = v_id;
  if found then
    if v_exist.plot_id = v_plot.id and v_exist.campaign_id = v_campaign
       and v_exist.nb_blocs_total = v_total and v_exist.nb_blocs_tires = v_tires then
      return jsonb_build_object('panel_id', v_id, 'statut_panel', v_exist.statut, 'deja_installe', true, 'row_version', v_exist.row_version,
        'blocs_tires', (select coalesce(jsonb_agg(numero order by rang_tirage), '[]') from public.pheno_blocs where panel_id = v_id and tire));
    end if;
    raise exception 'Tirage verrouillé : ce champ est déjà installé avec d''autres paramètres.' using errcode = 'PH409';
  end if;
  if exists (select 1 from public.pheno_panels where campaign_id = v_campaign and plot_id = v_plot.id) then
    raise exception 'Cette parcelle est déjà installée dans l''Observatoire pour cette campagne (autre appareil).' using errcode = 'PH409';
  end if;
  if not private.pheno_campagne_ouverte(v_campaign) then
    raise exception 'La campagne n''est pas ouverte.' using errcode = 'PH002'; end if;
  if private.pheno_graine(v_campaign) is null then
    raise exception 'Graine de tirage de la campagne absente : le Branch Manager doit la créer avant toute installation.' using errcode = 'PH002'; end if;

  select * into v_proto from public.pheno_protocoles where actif order by created_at desc limit 1;
  if not found then raise exception 'Aucun protocole actif.' using errcode = 'PH002'; end if;
  v_titulaires := coalesce((v_proto.parametres->>'titulaires')::integer, 10);
  v_reserves := coalesce((v_proto.parametres->>'reserves')::integer, 2);

  if v_total is null or v_tires is null or v_total < 1 or v_tires < 1 or v_tires > v_total or v_tires > v_titulaires then
    raise exception 'Nombre de blocs invalide : B=% et b=% (1 <= b <= B, b <= %).', v_total, v_tires, v_titulaires using errcode = 'PH002'; end if;
  if jsonb_typeof(p->'blocs') <> 'array' or jsonb_array_length(p->'blocs') <> v_total then
    raise exception 'La liste des blocs doit contenir exactement % blocs.', v_total using errcode = 'PH002'; end if;
  select count(distinct (b->>'numero')::integer) into v_n from jsonb_array_elements(p->'blocs') b
    where (b->>'numero')::integer between 1 and v_total and coalesce(btrim(b->>'repere'), '') <> '' and (b->>'id') is not null;
  if v_n <> v_total then
    raise exception 'Chaque bloc doit avoir un numéro unique de 1 à %, un identifiant et un repère physique.', v_total using errcode = 'PH002'; end if;

  insert into public.pheno_panels (id, campaign_id, protocole_id, plot_id, producteur_id, village_id, cluster_code,
    nb_blocs_total, nb_blocs_tires, tirage_graine, tirage_par, device_id, created_by,
    pi_village, pi_champ)
  values (v_id, v_campaign, v_proto.id, v_plot.id, v_plot.producteur_id, v_plot.village_id, v_cluster,
    v_total, v_tires, private.pheno_graine(v_campaign) || ':' || v_plot.id::text || ':BLOCS', auth.uid(), p->>'device_id', auth.uid(),
    case when private.pheno_classe() = 'BM' then (p->>'pi_village')::numeric end,
    case when private.pheno_classe() = 'BM' then (p->>'pi_champ')::numeric end);

  v_ordre := private.pheno_tirage(private.pheno_graine(v_campaign) || ':' || v_plot.id::text || ':BLOCS', v_total, v_tires);
  for v_bloc in select * from jsonb_array_elements(p->'blocs') loop
    v_rang := array_position(v_ordre, (v_bloc->>'numero')::integer);
    v_m := 0; v_r := 0;
    if v_rang is not null then
      v_m := v_titulaires / v_tires + case when v_rang <= v_titulaires % v_tires then 1 else 0 end;
      select count(*) into v_r from generate_series(1, v_reserves) k where ((k - 1) % v_tires) + 1 = v_rang;
    end if;
    insert into public.pheno_blocs (id, panel_id, numero, repere, latitude, longitude, tire, rang_tirage, nb_titulaires_prevus, nb_reserves_prevues)
    values ((v_bloc->>'id')::uuid, v_id, (v_bloc->>'numero')::integer, btrim(v_bloc->>'repere'),
      (v_bloc->>'latitude')::numeric, (v_bloc->>'longitude')::numeric, v_rang is not null, v_rang, v_m, v_r);
  end loop;

  perform private.pheno_journaliser(v_cluster, 'PANEL', v_id, 'TIRAGE_BLOCS', null, jsonb_build_object(
    'protocole', v_proto.code || ' ' || v_proto.version, 'graine', private.pheno_graine(v_campaign) || ':' || v_plot.id::text || ':BLOCS',
    'algorithme', 'sha256(graine:numero) croissant', 'B', v_total, 'b', v_tires, 'blocs_tires', to_jsonb(v_ordre),
    'b_fixe_avant_tirage', true, 'appareil', p->>'device_id', 'saisi_le_client', p->>'created_at_client'), null);

  return jsonb_build_object('panel_id', v_id, 'statut_panel', 'TIRAGE_VERROUILLE', 'blocs_tires', to_jsonb(v_ordre), 'row_version', 1);
end $$;

-- ---------------------------------------------------------------------
-- Inventaire exhaustif d'un bloc tiré (N_j). Déclenche le tirage des arbres.
-- ---------------------------------------------------------------------
create or replace function public.pheno_bloc_inventorier(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_bloc public.pheno_blocs; v_panel public.pheno_panels; v_n integer := (p->>'nb_arbres')::integer;
begin
  select * into v_bloc from public.pheno_blocs where id = (p->>'bloc_id')::uuid for update;
  if not found then raise exception 'Bloc introuvable.' using errcode = 'PH002'; end if;
  select * into v_panel from public.pheno_panels where id = v_bloc.panel_id;
  if not private.pheno_peut_collecter(v_panel.cluster_code) then
    raise exception 'Inventaire réservé aux agents du cluster.' using errcode = 'PH001'; end if;
  if not v_bloc.tire then raise exception 'Ce bloc n''a pas été tiré : il n''est pas inventorié.' using errcode = 'PH002'; end if;
  if v_n is null or v_n < 0 or v_n > 2000 then raise exception 'Nombre d''arbres invalide.' using errcode = 'PH002'; end if;
  if v_bloc.nb_arbres_inventories is not null then
    if v_bloc.nb_arbres_inventories = v_n then
      return jsonb_build_object('bloc_id', v_bloc.id, 'deja_inventorie', true, 'statut_panel', v_panel.statut);
    end if;
    raise exception 'Inventaire déjà enregistré (% arbres) : il ne peut plus être modifié.', v_bloc.nb_arbres_inventories using errcode = 'PH409';
  end if;
  if v_panel.statut <> 'TIRAGE_VERROUILLE' then raise exception 'Le champ n''attend plus d''inventaire.' using errcode = 'PH002'; end if;

  update public.pheno_blocs set nb_arbres_inventories = v_n, inventaire_le = now(), inventaire_par = auth.uid() where id = v_bloc.id;
  perform private.pheno_journaliser(v_panel.cluster_code, 'BLOC', v_bloc.id, 'INVENTAIRE', null,
    jsonb_build_object('bloc', v_bloc.numero, 'N', v_n, 'appareil', p->>'device_id'), null);
  perform private.pheno_tirer_arbres(v_panel.id);
  select * into v_panel from public.pheno_panels where id = v_panel.id;
  return jsonb_build_object('bloc_id', v_bloc.id, 'statut_panel', v_panel.statut, 'incompatibilite', v_panel.incompatibilite,
    'arbres', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'role', a.role, 'rang', a.rang) order by a.role desc, a.rang), '[]')
               from public.pheno_arbres a where a.panel_id = v_panel.id));
end $$;

-- Marquage d'un arbre : GPS et preuve
create or replace function public.pheno_arbre_marquer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_a public.pheno_arbres; v_cluster text;
begin
  select * into v_a from public.pheno_arbres where id = (p->>'arbre_id')::uuid for update;
  if not found then raise exception 'Arbre introuvable.' using errcode = 'PH002'; end if;
  v_cluster := private.pheno_cluster_du_panel(v_a.panel_id);
  if not private.pheno_peut_collecter(v_cluster) then raise exception 'Marquage réservé aux agents du cluster.' using errcode = 'PH001'; end if;
  if (p->>'latitude')::numeric not between -90 and 90 or (p->>'longitude')::numeric not between -180 and 180 then
    raise exception 'Coordonnées GPS invalides.' using errcode = 'PH002'; end if;
  update public.pheno_arbres set latitude = (p->>'latitude')::numeric, longitude = (p->>'longitude')::numeric,
    gps_precision_m = (p->>'precision_m')::numeric, preuve_ref = coalesce(p->>'preuve_ref', preuve_ref),
    marque_le = now(), marque_par = auth.uid() where id = v_a.id;
  perform private.pheno_journaliser(v_cluster, 'ARBRE', v_a.id, 'MARQUAGE',
    jsonb_build_object('latitude', v_a.latitude, 'longitude', v_a.longitude, 'preuve_ref', v_a.preuve_ref),
    jsonb_build_object('latitude', p->'latitude', 'longitude', p->'longitude', 'preuve_ref', p->>'preuve_ref'), null);
  return jsonb_build_object('arbre_id', v_a.id, 'marque', true);
end $$;

-- Activation officielle d'une réserve (remplacement d'un titulaire)
create or replace function public.pheno_reserve_activer(p_arbre_remplace uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_a public.pheno_arbres; v_panel public.pheno_panels; v_r public.pheno_arbres; v_b public.pheno_blocs;
begin
  select * into v_a from public.pheno_arbres where id = p_arbre_remplace for update;
  if not found then raise exception 'Arbre introuvable.' using errcode = 'PH002'; end if;
  select * into v_panel from public.pheno_panels where id = v_a.panel_id;
  if not private.pheno_peut_valider(v_panel.campaign_id, v_panel.cluster_code) then
    raise exception 'L''activation d''une réserve est réservée au valideur agronomique.' using errcode = 'PH001'; end if;
  if coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire.' using errcode = 'PH002'; end if;
  if not (v_a.statut = 'ACTIF' or v_a.statut = 'RESERVE_ACTIVEE') then
    raise exception 'Cet arbre n''est pas un arbre observé actif.' using errcode = 'PH002'; end if;
  select * into v_r from public.pheno_arbres where panel_id = v_a.panel_id and statut = 'RESERVE_EN_ATTENTE'
    order by (bloc_id = v_a.bloc_id) desc, rang limit 1 for update;
  if not found then raise exception 'Aucune réserve disponible pour ce champ.' using errcode = 'PH002'; end if;
  select * into v_b from public.pheno_blocs where id = v_r.bloc_id;
  update public.pheno_arbres set statut = 'REMPLACE' where id = v_a.id;
  update public.pheno_arbres set statut = 'RESERVE_ACTIVEE', remplace_arbre_id = v_a.id, activation_le = now(),
    activation_par = auth.uid(), activation_motif = p_motif, proba_approchee = true,
    proba_inclusion = coalesce(v_panel.pi_village, 1) * coalesce(v_panel.pi_champ, 1)
      * (v_panel.nb_blocs_tires::numeric / v_panel.nb_blocs_total)
      * (v_b.nb_titulaires_prevus::numeric / v_b.nb_arbres_inventories)
    where id = v_r.id;
  perform private.pheno_journaliser(v_panel.cluster_code, 'ARBRE', v_r.id, 'RESERVE_ACTIVEE',
    jsonb_build_object('arbre_remplace', v_a.code), jsonb_build_object('reserve', v_r.code, 'proba_approchee', true), p_motif);
  return jsonb_build_object('arbre_remplace', v_a.code, 'reserve_activee', v_r.code, 'reserve_id', v_r.id);
end $$;

-- Probabilités amont (village, champ) : Branch Manager uniquement
create or replace function public.pheno_panel_definir_probabilites(p_panel uuid, p_pi_village numeric, p_pi_champ numeric, p_motif text) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_panel public.pheno_panels;
begin
  if private.pheno_classe() is distinct from 'BM' then raise exception 'Réservé au Branch Manager.' using errcode = 'PH001'; end if;
  if coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire.' using errcode = 'PH002'; end if;
  if p_pi_village is null or p_pi_champ is null or p_pi_village <= 0 or p_pi_village > 1 or p_pi_champ <= 0 or p_pi_champ > 1 then
    raise exception 'Probabilités attendues dans ]0 ; 1].' using errcode = 'PH002'; end if;
  select * into v_panel from public.pheno_panels where id = p_panel for update;
  if not found then raise exception 'Champ introuvable.' using errcode = 'PH002'; end if;
  update public.pheno_panels set pi_village = p_pi_village, pi_champ = p_pi_champ, row_version = row_version + 1, updated_at = now() where id = p_panel;
  update public.pheno_arbres a set proba_inclusion = p_pi_village * p_pi_champ
      * (v_panel.nb_blocs_tires::numeric / v_panel.nb_blocs_total) * (b.nb_titulaires_prevus::numeric / b.nb_arbres_inventories)
    from public.pheno_blocs b where b.id = a.bloc_id and a.panel_id = p_panel and a.proba_inclusion is not null;
  perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', p_panel, 'PROBABILITES_AMONT',
    jsonb_build_object('pi_village', v_panel.pi_village, 'pi_champ', v_panel.pi_champ),
    jsonb_build_object('pi_village', p_pi_village, 'pi_champ', p_pi_champ), p_motif);
  return jsonb_build_object('panel_id', p_panel, 'pi_village', p_pi_village, 'pi_champ', p_pi_champ);
end $$;

-- ---------------------------------------------------------------------
-- Affectations agronomiques : Branch Manager uniquement
-- ---------------------------------------------------------------------
create or replace function public.pheno_affectation_accorder(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_user uuid := (p->>'user_id')::uuid; v_classe text; v_id uuid; v_clusters text[];
begin
  if private.pheno_classe() is distinct from 'BM' then raise exception 'Réservé au Branch Manager.' using errcode = 'PH001'; end if;
  v_classe := private.pheno_classe_de(v_user);
  if v_classe is null or v_classe not in ('ABM', 'ZH', 'UH') then
    raise exception 'Une affectation agronomique ne peut viser qu''un Zonal Head, un Unit Head ou l''Assistant Branch Manager actif.' using errcode = 'PH002'; end if;
  if (p->>'droit') not in ('VERIFICATION', 'VALIDATION') then raise exception 'Droit invalide.' using errcode = 'PH002'; end if;
  select array_agg(c.code) into v_clusters from public.aflp_clusters c
    where c.code in (select jsonb_array_elements_text(p->'cluster_codes'));
  if v_clusters is null or cardinality(v_clusters) <> jsonb_array_length(p->'cluster_codes') then
    raise exception 'Cluster inconnu dans l''affectation.' using errcode = 'PH002'; end if;
  if not exists (select 1 from public.campaigns where id = (p->>'campaign_id')::uuid) then
    raise exception 'Campagne inconnue.' using errcode = 'PH002'; end if;
  insert into public.pheno_affectations (campaign_id, user_id, cluster_codes, droit, valide_du, valide_au, motif, accorde_par)
  values ((p->>'campaign_id')::uuid, v_user, v_clusters, p->>'droit', coalesce((p->>'valide_du')::date, current_date),
    (p->>'valide_au')::date, p->>'motif', auth.uid()) returning id into v_id;
  perform private.pheno_journaliser(v_clusters[1], 'AFFECTATION', v_id, 'ACCORDEE', null, p - 'motif', p->>'motif');
  return jsonb_build_object('affectation_id', v_id);
end $$;

create or replace function public.pheno_affectation_revoquer(p_id uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_a public.pheno_affectations;
begin
  if private.pheno_classe() is distinct from 'BM' then raise exception 'Réservé au Branch Manager.' using errcode = 'PH001'; end if;
  if coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire.' using errcode = 'PH002'; end if;
  select * into v_a from public.pheno_affectations where id = p_id for update;
  if not found then raise exception 'Affectation introuvable.' using errcode = 'PH002'; end if;
  update public.pheno_affectations set actif = false, revoque_le = now(), revoque_par = auth.uid() where id = p_id;
  perform private.pheno_journaliser(v_a.cluster_codes[1], 'AFFECTATION', p_id, 'REVOQUEE', to_jsonb(v_a), null, p_motif);
  return jsonb_build_object('affectation_id', p_id, 'actif', false);
end $$;

-- ---------------------------------------------------------------------
-- Visite : enregistrement (brouillon ou soumission)
-- ---------------------------------------------------------------------
create or replace function private.pheno_obs_valeurs(o public.pheno_observations) returns jsonb
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select jsonb_build_object('retrouve', o.retrouve, 'f', o.f, 'n', o.n, 'p', o.p, 'pas_vu_motif', o.pas_vu_motif,
    'chute', o.chute, 'chute_preuve', o.chute_preuve, 'anomalie', o.anomalie, 'photo_ref', o.photo_ref)
$$;

-- Demande normalisée : un arbre non retrouvé ne porte aucun stade ; la source
-- de preuve n'existe que pour une chute constatée (mûre ou prématurée).
create or replace function private.pheno_obs_demande(o jsonb) returns jsonb
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select case when (o->>'retrouve')::boolean is false then
    jsonb_build_object('retrouve', false, 'f', null, 'n', null, 'p', null,
      'pas_vu_motif', nullif(btrim(o->>'pas_vu_motif'), ''), 'chute', null, 'chute_preuve', null,
      'anomalie', nullif(btrim(o->>'anomalie'), ''), 'photo_ref', nullif(btrim(o->>'photo_ref'), ''))
  else
    jsonb_build_object('retrouve', o->'retrouve', 'f', o->'f', 'n', o->'n', 'p', o->'p',
      'pas_vu_motif', nullif(btrim(o->>'pas_vu_motif'), ''), 'chute', o->'chute',
      'chute_preuve', case when o->>'chute' in ('MURE', 'PREMATUREE') then o->'chute_preuve' end,
      'anomalie', nullif(btrim(o->>'anomalie'), ''), 'photo_ref', nullif(btrim(o->>'photo_ref'), ''))
  end
$$;

create or replace function private.pheno_visite_controler(p_visite uuid) returns void
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites; v_n integer; v_codes text;
begin
  select * into v from public.pheno_visites where id = p_visite;
  if v.ramassage is null then raise exception 'Visite incomplète : question du ramassage non renseignée.' using errcode = 'PH002'; end if;
  select count(*), string_agg(a.code, ', ' order by a.rang) into v_n, v_codes
    from public.pheno_arbres a left join public.pheno_observations o on o.arbre_id = a.id and o.visite_id = p_visite
    where a.panel_id = v.panel_id and a.statut in ('ACTIF', 'RESERVE_ACTIVEE') and (o.id is null or o.retrouve is null);
  if v_n > 0 then raise exception 'Visite incomplète : % arbre(s) sans réponse « Retrouvé » (%).', v_n, v_codes using errcode = 'PH002'; end if;
  select count(*), string_agg(a.code, ', ') into v_n, v_codes
    from public.pheno_observations o join public.pheno_arbres a on a.id = o.arbre_id
    where o.visite_id = p_visite and o.retrouve and (o.f is null or o.n is null or o.p is null or o.chute is null);
  if v_n > 0 then raise exception 'Visite incomplète : stades F, N, P ou chute non renseignés (%).', v_codes using errcode = 'PH002'; end if;
  select count(*), string_agg(a.code, ', ') into v_n, v_codes
    from public.pheno_observations o join public.pheno_arbres a on a.id = o.arbre_id
    where o.visite_id = p_visite and coalesce(btrim(o.pas_vu_motif), '') = ''
      and (o.retrouve = false or 'PAS_VU' in (o.f, o.n, o.p, o.chute));
  if v_n > 0 then raise exception 'Raison obligatoire pour « Pas vu » ou arbre non retrouvé (%).', v_codes using errcode = 'PH002'; end if;
  select count(*), string_agg(a.code, ', ') into v_n, v_codes
    from public.pheno_observations o join public.pheno_arbres a on a.id = o.arbre_id
    where o.visite_id = p_visite and o.chute in ('MURE', 'PREMATUREE') and o.chute_preuve is null;
  if v_n > 0 then raise exception 'Source de preuve obligatoire pour une chute constatée (%).', v_codes using errcode = 'PH002'; end if;
end $$;

create or replace function private.pheno_visite_enregistrer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_uid uuid := auth.uid(); v_id uuid := (p->>'id')::uuid; v_panel public.pheno_panels; v_vis public.pheno_visites;
  v_soumettre boolean := coalesce((p->>'soumettre')::boolean, false); v_date date := (p->>'date_observation')::date;
  v_sem text; v_mode text := coalesce(p->>'mode_saisie', 'DIRECT'); v_obs uuid; v_trans uuid; v_o jsonb; v_arbre public.pheno_arbres;
  v_old public.pheno_observations; v_dem jsonb; v_anc jsonb; v_k text; v_n integer := 0; v_deja_soumise boolean := false;
  v_motif text := nullif(btrim(p->>'motif_correction'), ''); v_photo text;
begin
  if v_id is null then raise exception 'Identifiant de visite manquant.' using errcode = 'PH002'; end if;
  select * into v_panel from public.pheno_panels where id = (p->>'panel_id')::uuid;
  if not found then raise exception 'Champ de l''Observatoire introuvable.' using errcode = 'PH002'; end if;
  if not private.pheno_peut_collecter(v_panel.cluster_code) then
    raise exception 'Collecte réservée aux agents du cluster %.', v_panel.cluster_code using errcode = 'PH001'; end if;
  if v_panel.statut <> 'ACTIF' then raise exception 'Ce champ n''est pas actif (statut %).', v_panel.statut using errcode = 'PH002'; end if;
  if not private.pheno_campagne_ouverte(v_panel.campaign_id) then raise exception 'La campagne n''est pas ouverte.' using errcode = 'PH002'; end if;
  if v_date is null then raise exception 'Date d''observation manquante.' using errcode = 'PH002'; end if;
  if v_date > current_date + 1 then raise exception 'Date d''observation dans le futur.' using errcode = 'PH002'; end if;
  v_sem := to_char(v_date, 'IYYY"-W"IW');
  if (p->>'semaine_iso') is not null and p->>'semaine_iso' <> v_sem then
    raise exception 'La semaine % ne correspond pas à la date d''observation (%).', p->>'semaine_iso', v_sem using errcode = 'PH002'; end if;

  if v_mode = 'DIRECT' then v_obs := v_uid; v_trans := null;
  elsif v_mode = 'TRANSCRIPTION_PAPIER' then
    v_obs := (p->>'observateur_id')::uuid; v_trans := v_uid;
    if v_obs is null or v_obs = v_uid then
      raise exception 'Transcription d''une fiche papier : l''observateur doit être une autre personne que le transcripteur.' using errcode = 'PH002'; end if;
    if private.pheno_classe_de(v_obs) is null or private.pheno_classe_de(v_obs) not in ('UH', 'AUH', 'BM') then
      raise exception 'Observateur inconnu ou non habilité.' using errcode = 'PH002'; end if;
    -- L'observateur d'une fiche papier appartient au cluster du champ (sauf Branch Manager).
    if private.pheno_classe_de(v_obs) <> 'BM' and not exists (select 1 from public.profils pr where pr.user_id = v_obs and pr.actif
         and public.aflp_cluster_code(pr.cluster) = v_panel.cluster_code) then
      raise exception 'L''observateur désigné n''appartient pas au cluster de ce champ.' using errcode = 'PH002'; end if;
  else raise exception 'Mode de saisie invalide.' using errcode = 'PH002';
  end if;

  select * into v_vis from public.pheno_visites where id = v_id for update;
  if found then
    if v_vis.panel_id <> v_panel.id then raise exception 'Cette visite appartient à un autre champ.' using errcode = 'PH002'; end if;
    if v_uid not in (v_vis.observateur_id, coalesce(v_vis.transcripteur_id, v_vis.observateur_id)) and private.pheno_classe() <> 'BM' then
      raise exception 'Seul l''auteur peut modifier cette visite.' using errcode = 'PH001'; end if;
    if v_vis.statut in ('SOUMIS', 'EN_VERIFICATION', 'VALIDE') then
      -- Jamais d'écrasement : les écarts deviennent des propositions de correction.
      for v_o in select * from jsonb_array_elements(coalesce(p->'observations', '[]')) loop
        select * into v_old from public.pheno_observations where visite_id = v_id and arbre_id = (v_o->>'arbre_id')::uuid;
        continue when not found;
        v_dem := private.pheno_obs_demande(v_o); v_anc := private.pheno_obs_valeurs(v_old);
        for v_k in select jsonb_object_keys(v_dem) loop
          if (v_dem->v_k) is distinct from (v_anc->v_k) then
            insert into public.pheno_corrections (visite_id, arbre_id, champ, ancienne_valeur, nouvelle_valeur, motif, origine, proposee_par)
            values (v_id, v_old.arbre_id, v_k, v_anc->>v_k, v_dem->>v_k, coalesce(v_motif, 'Écart détecté à la synchronisation'), 'CONFLIT_HORS_LIGNE', v_uid)
            on conflict do nothing;
            v_n := v_n + 1;
          end if;
        end loop;
      end loop;
      if v_n = 0 then
        return jsonb_build_object('statut', 'ACCEPTEE', 'identique', true, 'visite_id', v_id, 'statut_visite', v_vis.statut,
          'row_version', v_vis.row_version, 'recu_serveur_le', v_vis.recu_serveur_le);
      end if;
      perform private.pheno_journaliser(v_vis.cluster_code, 'VISITE', v_id, 'CONFLIT_HORS_LIGNE', null,
        jsonb_build_object('ecarts', v_n, 'appareil', p->>'device_id'), v_motif);
      return jsonb_build_object('statut', 'CONFLIT', 'code', 'VISITE_FIGEE', 'visite_id', v_id, 'statut_visite', v_vis.statut,
        'propositions', v_n, 'message', format('La visite est déjà %s sur le serveur : %s écart(s) transmis comme proposition(s) de correction.',
          lower(replace(v_vis.statut, '_', ' ')), v_n));
    end if;
    if (p->>'base_version') is not null and (p->>'base_version')::integer <> v_vis.row_version then
      perform private.pheno_journaliser(v_vis.cluster_code, 'VISITE', v_id, 'CONFLIT_VERSION', null,
        jsonb_build_object('version_serveur', v_vis.row_version, 'version_appareil', p->>'base_version', 'appareil', p->>'device_id'), null);
      return jsonb_build_object('statut', 'CONFLIT', 'code', 'VERSION', 'visite_id', v_id, 'row_version', v_vis.row_version,
        'message', 'La visite a été modifiée sur le serveur depuis votre dernière lecture. Rechargez-la avant de la modifier.');
    end if;
    if v_vis.statut = 'CORRECTION_DEMANDEE' and v_soumettre and v_motif is null then
      raise exception 'Motif de correction obligatoire pour soumettre à nouveau.' using errcode = 'PH002'; end if;
    v_deja_soumise := v_vis.soumis_le is not null;
    update public.pheno_visites set date_observation = v_date, semaine_iso = v_sem, saisie_le = coalesce((p->>'saisie_le')::timestamptz, saisie_le),
      mode_saisie = v_mode, observateur_id = v_obs, transcripteur_id = v_trans,
      ramassage = p->>'ramassage', anomalies = nullif(btrim(p->>'anomalies'), ''),
      latitude = (p->>'latitude')::numeric, longitude = (p->>'longitude')::numeric, device_id = coalesce(p->>'device_id', device_id),
      recu_serveur_le = now(), row_version = row_version + 1, updated_at = now() where id = v_id;
  else
    if exists (select 1 from public.pheno_visites where panel_id = v_panel.id and semaine_iso = v_sem) then
      perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', v_panel.id, 'CONFLIT_DOUBLON_SEMAINE', null,
        jsonb_build_object('semaine', v_sem, 'visite_refusee', v_id, 'appareil', p->>'device_id'), null);
      return jsonb_build_object('statut', 'CONFLIT', 'code', 'DOUBLON_SEMAINE', 'visite_id', v_id,
        'message', format('Une autre visite existe déjà pour ce champ en semaine %s. La vôtre n''a pas été enregistrée : contactez votre Unit Head.', v_sem));
    end if;
    insert into public.pheno_visites (id, panel_id, campaign_id, cluster_code, semaine_iso, date_observation, saisie_le,
      observateur_id, transcripteur_id, mode_saisie, ramassage, anomalies, latitude, longitude, device_id)
    values (v_id, v_panel.id, v_panel.campaign_id, v_panel.cluster_code, v_sem, v_date, (p->>'saisie_le')::timestamptz,
      v_obs, v_trans, v_mode, p->>'ramassage', nullif(btrim(p->>'anomalies'), ''),
      (p->>'latitude')::numeric, (p->>'longitude')::numeric, p->>'device_id');
  end if;

  for v_o in select * from jsonb_array_elements(coalesce(p->'observations', '[]')) loop
    select * into v_arbre from public.pheno_arbres where id = (v_o->>'arbre_id')::uuid and panel_id = v_panel.id;
    if not found then raise exception 'Arbre étranger à ce champ.' using errcode = 'PH002'; end if;
    if v_arbre.statut not in ('ACTIF', 'RESERVE_ACTIVEE') then
      raise exception 'L''arbre % n''est pas observé (réserve non activée ou arbre remplacé).', v_arbre.code using errcode = 'PH002'; end if;
    v_dem := private.pheno_obs_demande(v_o);
    v_photo := v_dem->>'photo_ref';
    if v_photo is not null and v_photo not like v_panel.campaign_id::text || '/' || v_panel.id::text || '/' || v_uid::text || '/%' then
      raise exception 'Référence de preuve invalide.' using errcode = 'PH002'; end if;
    select * into v_old from public.pheno_observations where visite_id = v_id and arbre_id = v_arbre.id;
    if found then
      v_anc := private.pheno_obs_valeurs(v_old);
      if v_deja_soumise and v_anc is distinct from v_dem then
        for v_k in select jsonb_object_keys(v_dem) loop
          if (v_dem->v_k) is distinct from (v_anc->v_k) then
            perform private.pheno_journaliser(v_panel.cluster_code, 'OBSERVATION', v_old.id, 'CORRECTION_AUTEUR',
              jsonb_build_object('arbre', v_arbre.code, 'champ', v_k, 'valeur', v_anc->v_k),
              jsonb_build_object('arbre', v_arbre.code, 'champ', v_k, 'valeur', v_dem->v_k), v_motif);
          end if;
        end loop;
      end if;
      update public.pheno_observations set retrouve = (v_dem->>'retrouve')::boolean, f = v_dem->>'f', n = v_dem->>'n', p = v_dem->>'p',
        pas_vu_motif = v_dem->>'pas_vu_motif', chute = v_dem->>'chute', chute_preuve = v_dem->>'chute_preuve',
        anomalie = v_dem->>'anomalie', photo_ref = v_photo, updated_at = now() where id = v_old.id;
    else
      insert into public.pheno_observations (visite_id, arbre_id, retrouve, f, n, p, pas_vu_motif, chute, chute_preuve, anomalie, photo_ref)
      values (v_id, v_arbre.id, (v_dem->>'retrouve')::boolean, v_dem->>'f', v_dem->>'n', v_dem->>'p', v_dem->>'pas_vu_motif',
        v_dem->>'chute', v_dem->>'chute_preuve', v_dem->>'anomalie', v_photo);
    end if;
  end loop;

  if v_soumettre then
    perform private.pheno_visite_controler(v_id);
    update public.pheno_visites set statut = 'SOUMIS', soumis_le = now(), correction_motif = null where id = v_id;
    perform private.pheno_journaliser(v_panel.cluster_code, 'VISITE', v_id, case when v_deja_soumise then 'RESOUMISE' else 'SOUMISE' end,
      null, jsonb_build_object('semaine', v_sem, 'mode', v_mode, 'appareil', p->>'device_id', 'saisie_le', p->>'saisie_le'), v_motif);
  end if;
  select * into v_vis from public.pheno_visites where id = v_id;
  return jsonb_build_object('statut', 'ACCEPTEE', 'visite_id', v_id, 'statut_visite', v_vis.statut, 'row_version', v_vis.row_version,
    'recu_serveur_le', v_vis.recu_serveur_le);
end $$;

-- ---------------------------------------------------------------------
-- Synchronisation dédiée : lot d'opérations, idempotent
-- ---------------------------------------------------------------------
create or replace function public.pheno_sync_batch(p_operations jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_op jsonb; v_cle text; v_hash text; v_recu private.pheno_sync_recus; v_res jsonb; v_out jsonb := '[]'::jsonb; v_payload jsonb; v_diag text;
begin
  if auth.uid() is null or private.pheno_classe() is null then
    raise exception 'Accès à l''Observatoire refusé.' using errcode = 'PH001'; end if;
  if jsonb_typeof(p_operations) <> 'array' then raise exception 'Lot invalide.' using errcode = 'PH002'; end if;
  if jsonb_array_length(p_operations) > 50 then raise exception 'Lot trop volumineux (50 opérations au plus).' using errcode = 'PH002'; end if;

  for v_op in select * from jsonb_array_elements(p_operations) loop
    v_cle := v_op->>'idempotency_key';
    if coalesce(v_cle, '') = '' or length(v_cle) > 200 then
      v_out := v_out || jsonb_build_object('idempotency_key', v_cle, 'statut', 'REJETEE', 'message', 'Clé d''idempotence manquante.');
      continue;
    end if;
    -- Empreinte sur la forme canonique jsonb (clés triées par PostgreSQL), en SHA-256.
    -- Empreinte sur toute l'enveloppe qui fait foi (type, charge, appareil, date client) : un renvoi
    -- d'un autre appareil avec la même clé est refusé (audit T1). L'utilisateur vient de la session.
    v_hash := private.pheno_hex(jsonb_build_object('type', v_op->'type', 'payload', coalesce(v_op->'payload', '{}'::jsonb),
      'device_id', v_op->'device_id', 'created_at_client', v_op->'created_at_client')::text);
    -- Deux envois simultanés de la même opération : le second attend la fin du premier,
    -- puis trouve son accusé (écriture métier et accusé sont dans la même transaction).
    perform pg_advisory_xact_lock(hashtextextended('pheno_sync:' || v_cle, 0));
    select * into v_recu from private.pheno_sync_recus where idempotency_key = v_cle;
    if found then
      if v_recu.user_id = auth.uid() and v_recu.request_hash = v_hash then
        v_out := v_out || (v_recu.resultat || jsonb_build_object('idempotency_key', v_cle, 'rejoue', true));
      else
        v_out := v_out || jsonb_build_object('idempotency_key', v_cle, 'statut', 'REJETEE',
          'message', 'Clé d''idempotence déjà utilisée pour une autre demande.');
      end if;
      continue;
    end if;
    v_payload := coalesce(v_op->'payload', '{}'::jsonb)
      || jsonb_build_object('device_id', v_op->>'device_id', 'created_at_client', v_op->>'created_at_client');
    begin
      case v_op->>'type'
        when 'PANEL_INSTALLER' then v_res := jsonb_build_object('statut', 'ACCEPTEE') || public.pheno_panel_installer(v_payload);
        when 'BLOC_INVENTORIER' then v_res := jsonb_build_object('statut', 'ACCEPTEE') || public.pheno_bloc_inventorier(v_payload);
        when 'ARBRE_MARQUER' then v_res := jsonb_build_object('statut', 'ACCEPTEE') || public.pheno_arbre_marquer(v_payload);
        when 'VISITE_ENREGISTRER' then v_res := private.pheno_visite_enregistrer(v_payload);
        else raise exception 'Type d''opération inconnu : %.', v_op->>'type' using errcode = 'PH002';
      end case;
    exception
      when sqlstate 'PH409' then v_res := jsonb_build_object('statut', 'CONFLIT', 'code', 'PH409', 'message', sqlerrm);
      when sqlstate 'PH001' then v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'PH001', 'message', sqlerrm);
      when sqlstate 'PH002' then v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'PH002', 'message', sqlerrm);
      when others then
        -- Aucun détail technique vers le téléphone (audit T3) : code de diagnostic, détail au journal (invisible des écrans).
        v_diag := substr(private.pheno_hex(gen_random_uuid()::text), 1, 10);
        insert into public.pheno_journal (acteur, cluster_code, entite, entite_id, action, nouvelle)
        values (auth.uid(), null, 'SYNCHRO', null, 'ERREUR_TECHNIQUE', jsonb_build_object('diagnostic', v_diag, 'sqlstate', sqlstate, 'detail', sqlerrm, 'type', v_op->>'type'));
        v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'TECHNIQUE', 'diagnostic', v_diag,
          'message', 'Opération refusée par le serveur (erreur technique). Communiquez le code ' || v_diag || ' à votre Unit Head.');
    end;
    v_res := v_res || jsonb_build_object('idempotency_key', v_cle, 'recu_serveur_le', coalesce(v_res->'recu_serveur_le', to_jsonb(now())));
    -- Un refus n'est pas mémorisé : il peut être rejoué après correction (droit, campagne…).
    if v_res->>'statut' in ('ACCEPTEE', 'CONFLIT') then
      insert into private.pheno_sync_recus (idempotency_key, user_id, request_hash, resultat)
      values (v_cle, auth.uid(), v_hash, v_res) on conflict (idempotency_key) do nothing;
    end if;
    v_out := v_out || v_res;
  end loop;
  return jsonb_build_object('resultats', v_out, 'serveur_le', now());
end $$;

-- ---------------------------------------------------------------------
-- Événements de maturité (intervalles), recalculés sur les visites VALIDÉES
-- ---------------------------------------------------------------------
create or replace function private.pheno_recalculer_evenements(p_panel uuid) returns void
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
begin
  delete from public.pheno_evenements_maturite where panel_id = p_panel;
  insert into public.pheno_evenements_maturite (arbre_id, campaign_id, panel_id, stade, derniere_visite_negative, premiere_visite_positive, visite_id, preuve)
  with obs as (
    select o.arbre_id, v.campaign_id, v.id visite_id, v.date_observation d, s.stade,
      case s.stade when 'F' then o.f when 'N' then o.n when 'P' then o.p
        else case o.chute when 'MURE' then 'OUI' when 'ABSENCE' then 'NON' when 'PREMATUREE' then 'NON' else null end end val,
      case when s.stade = 'C' then o.chute_preuve end preuve
    from public.pheno_observations o
    join public.pheno_visites v on v.id = o.visite_id and v.statut = 'VALIDE' and v.panel_id = p_panel
    cross join (values ('F'), ('N'), ('P'), ('C')) s(stade)
    where o.retrouve
  ), premier as (
    select distinct on (arbre_id, stade) arbre_id, campaign_id, stade, d, visite_id, preuve
    from obs where val = 'OUI' order by arbre_id, stade, d
  )
  select p.arbre_id, p.campaign_id, p_panel, p.stade,
    (select max(o2.d) from obs o2 where o2.arbre_id = p.arbre_id and o2.stade = p.stade and o2.val = 'NON' and o2.d < p.d),
    p.d, p.visite_id, p.preuve
  from premier p;
end $$;

-- ---------------------------------------------------------------------
-- Circuit : vérification, demande de correction, validation
-- ---------------------------------------------------------------------
create or replace function private.pheno_visite_pour_decision(p_visite uuid, p_version integer) returns public.pheno_visites
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites;
begin
  select * into v from public.pheno_visites where id = p_visite for update;
  if not found or not private.pheno_peut_lire_cluster(v.cluster_code) then
    raise exception 'Visite introuvable.' using errcode = 'PH002'; end if;
  if p_version is not null and p_version <> v.row_version then
    raise exception 'La visite a changé depuis votre lecture : rechargez-la.' using errcode = 'PH409'; end if;
  if auth.uid() in (v.observateur_id, v.transcripteur_id) then
    raise exception 'On ne vérifie ni ne valide une visite que l''on a observée ou saisie.' using errcode = 'PH001'; end if;
  return v;
end $$;

create or replace function public.pheno_visite_verifier(p_visite uuid, p_version integer default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites;
begin
  v := private.pheno_visite_pour_decision(p_visite, p_version);
  if not private.pheno_peut_verifier(v.campaign_id, v.cluster_code) then
    raise exception 'Vérification non autorisée pour ce cluster.' using errcode = 'PH001'; end if;
  if v.statut <> 'SOUMIS' then raise exception 'Seule une visite soumise peut passer en vérification.' using errcode = 'PH002'; end if;
  update public.pheno_visites set statut = 'EN_VERIFICATION', verifie_par = auth.uid(), verifie_le = now(),
    row_version = row_version + 1, updated_at = now() where id = p_visite;
  perform private.pheno_journaliser(v.cluster_code, 'VISITE', p_visite, 'EN_VERIFICATION',
    jsonb_build_object('statut', v.statut), jsonb_build_object('statut', 'EN_VERIFICATION'), null);
  return jsonb_build_object('visite_id', p_visite, 'statut_visite', 'EN_VERIFICATION', 'row_version', v.row_version + 1);
end $$;

create or replace function public.pheno_visite_demander_correction(p_visite uuid, p_motif text, p_version integer default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites;
begin
  v := private.pheno_visite_pour_decision(p_visite, p_version);
  if not (private.pheno_peut_verifier(v.campaign_id, v.cluster_code) or private.pheno_peut_valider(v.campaign_id, v.cluster_code)) then
    raise exception 'Demande de correction non autorisée pour ce cluster.' using errcode = 'PH001'; end if;
  if coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire.' using errcode = 'PH002'; end if;
  if v.statut not in ('SOUMIS', 'EN_VERIFICATION') then
    raise exception 'Une correction ne se demande que sur une visite soumise ou en vérification.' using errcode = 'PH002'; end if;
  update public.pheno_visites set statut = 'CORRECTION_DEMANDEE', correction_motif = p_motif,
    row_version = row_version + 1, updated_at = now() where id = p_visite;
  perform private.pheno_journaliser(v.cluster_code, 'VISITE', p_visite, 'CORRECTION_DEMANDEE',
    jsonb_build_object('statut', v.statut), jsonb_build_object('statut', 'CORRECTION_DEMANDEE'), p_motif);
  return jsonb_build_object('visite_id', p_visite, 'statut_visite', 'CORRECTION_DEMANDEE', 'row_version', v.row_version + 1);
end $$;

create or replace function public.pheno_visite_valider(p_visite uuid, p_version integer default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites;
begin
  v := private.pheno_visite_pour_decision(p_visite, p_version);
  if not private.pheno_peut_valider(v.campaign_id, v.cluster_code) then
    raise exception 'Validation finale non autorisée : affectation agronomique requise.' using errcode = 'PH001'; end if;
  if v.statut not in ('SOUMIS', 'EN_VERIFICATION') then
    raise exception 'Seule une visite soumise ou en vérification peut être validée.' using errcode = 'PH002'; end if;
  perform private.pheno_visite_controler(p_visite);
  update public.pheno_visites set statut = 'VALIDE', valide_par = auth.uid(), valide_le = now(),
    row_version = row_version + 1, updated_at = now() where id = p_visite;
  perform private.pheno_journaliser(v.cluster_code, 'VISITE', p_visite, 'VALIDEE',
    jsonb_build_object('statut', v.statut), jsonb_build_object('statut', 'VALIDE'), null);
  perform private.pheno_recalculer_evenements(v.panel_id);
  return jsonb_build_object('visite_id', p_visite, 'statut_visite', 'VALIDE', 'row_version', v.row_version + 1);
end $$;

-- Décision sur une proposition de correction (visite figée) : valideur uniquement
create or replace function public.pheno_correction_decider(p_correction uuid, p_decision text, p_motif text) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare c public.pheno_corrections; v public.pheno_visites; v_obs public.pheno_observations;
begin
  select * into c from public.pheno_corrections where id = p_correction for update;
  if not found then raise exception 'Proposition introuvable.' using errcode = 'PH002'; end if;
  select * into v from public.pheno_visites where id = c.visite_id for update;
  if not private.pheno_peut_valider(v.campaign_id, v.cluster_code) then
    raise exception 'Décision réservée au valideur agronomique.' using errcode = 'PH001'; end if;
  if auth.uid() = c.proposee_par then raise exception 'On ne décide pas de sa propre proposition.' using errcode = 'PH001'; end if;
  if c.statut <> 'PROPOSEE' then raise exception 'Proposition déjà traitée.' using errcode = 'PH002'; end if;
  if p_decision not in ('APPLIQUEE', 'REJETEE') then raise exception 'Décision invalide.' using errcode = 'PH002'; end if;
  if coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire.' using errcode = 'PH002'; end if;
  if p_decision = 'APPLIQUEE' then
    if c.champ not in ('retrouve', 'f', 'n', 'p', 'pas_vu_motif', 'chute', 'chute_preuve', 'anomalie', 'photo_ref') then
      raise exception 'Champ non corrigeable.' using errcode = 'PH002'; end if;
    select * into v_obs from public.pheno_observations where visite_id = c.visite_id and arbre_id = c.arbre_id for update;
    if not found then raise exception 'Observation introuvable.' using errcode = 'PH002'; end if;
    update public.pheno_observations set
      retrouve = case when c.champ = 'retrouve' then c.nouvelle_valeur::boolean else retrouve end,
      f = case when c.champ = 'f' then c.nouvelle_valeur else f end,
      n = case when c.champ = 'n' then c.nouvelle_valeur else n end,
      p = case when c.champ = 'p' then c.nouvelle_valeur else p end,
      pas_vu_motif = case when c.champ = 'pas_vu_motif' then c.nouvelle_valeur else pas_vu_motif end,
      chute = case when c.champ = 'chute' then c.nouvelle_valeur else chute end,
      chute_preuve = case when c.champ = 'chute_preuve' then c.nouvelle_valeur else chute_preuve end,
      anomalie = case when c.champ = 'anomalie' then c.nouvelle_valeur else anomalie end,
      photo_ref = case when c.champ = 'photo_ref' then c.nouvelle_valeur else photo_ref end,
      updated_at = now() where id = v_obs.id;
    update public.pheno_visites set row_version = row_version + 1, updated_at = now() where id = v.id;
    perform private.pheno_journaliser(v.cluster_code, 'OBSERVATION', v_obs.id, 'CORRECTION_APPLIQUEE',
      jsonb_build_object('champ', c.champ, 'valeur', c.ancienne_valeur), jsonb_build_object('champ', c.champ, 'valeur', c.nouvelle_valeur), p_motif);
    if v.statut = 'VALIDE' then perform private.pheno_recalculer_evenements(v.panel_id); end if;
  else
    perform private.pheno_journaliser(v.cluster_code, 'VISITE', v.id, 'CORRECTION_REJETEE',
      jsonb_build_object('champ', c.champ, 'valeur', c.ancienne_valeur), jsonb_build_object('champ', c.champ, 'valeur_refusee', c.nouvelle_valeur), p_motif);
  end if;
  update public.pheno_corrections set statut = p_decision, decidee_par = auth.uid(), decidee_le = now(), decision_motif = p_motif where id = p_correction;
  return jsonb_build_object('correction_id', p_correction, 'statut', p_decision);
end $$;

-- Parcelles du registre installables par l'agent : son cluster seulement (tout pour le BM).
-- Champs minimaux, aucun téléphone ni donnée sensible du registre. Évite de dépendre des
-- droits de lecture du registre producteurs, qui ne sont pas accordés à l'Assistant Unit Head.
create or replace function public.pheno_parcelles_disponibles(p_campaign uuid) returns table (
  plot_id uuid, producteur_id text, producteur_nom text, producteur_code text, village_id text, village_nom text,
  cluster_code text, parcelle_nom text, arbres_declares integer, deja_installee boolean)
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select fp.id, fp.producteur_id, pr.nom, pr.code, fp.village_id, v.village,
    public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')) as cl,
    fp.local_name, fp.tree_count,
    exists (select 1 from public.pheno_panels pp where pp.campaign_id = p_campaign and pp.plot_id = fp.id)
  from public.farmer_plots fp
  join public.villages v on v.id = fp.village_id
  join public.producteurs pr on pr.id = fp.producteur_id
  where not fp.deleted and coalesce(fp.status, 'ACTIVE') = 'ACTIVE' and not coalesce(pr.deleted, false)
    and private.pheno_peut_collecter(public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')))
  order by pr.nom, fp.local_name
$$;

-- Collègues de collecte du même cluster (nom uniquement), pour désigner
-- l'observateur d'une fiche papier. Aucune autre donnée de profil n'est exposée.
create or replace function public.pheno_observateurs_du_cluster() returns table (user_id uuid, nom text, role text)
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select p.user_id, p.nom, p.role from public.profils p
  where p.actif and p.role in ('Unit Head', 'Assistant Unit Head')
    and private.pheno_classe() in ('UH', 'AUH')
    and public.aflp_cluster_code(p.cluster) = private.pheno_mon_cluster()
    and p.user_id <> auth.uid()
  order by p.nom
$$;

-- Droits d'exécution : fonctions internes fermées, RPC ouvertes aux seuls comptes connectés
revoke all on function private.pheno_hex(text), private.pheno_tirage(text, integer, integer), private.pheno_arbre_id(uuid, integer),
  private.pheno_journaliser(text, text, uuid, text, jsonb, jsonb, text), private.pheno_campagne_ouverte(uuid),
  private.pheno_tirer_arbres(uuid), private.pheno_obs_valeurs(public.pheno_observations), private.pheno_obs_demande(jsonb),
  private.pheno_visite_controler(uuid), private.pheno_visite_enregistrer(jsonb), private.pheno_recalculer_evenements(uuid),
  private.pheno_visite_pour_decision(uuid, integer), private.pheno_graine(uuid) from public, anon, authenticated;
revoke all on function public.pheno_panel_installer(jsonb), public.pheno_bloc_inventorier(jsonb), public.pheno_arbre_marquer(jsonb),
  public.pheno_reserve_activer(uuid, text), public.pheno_panel_definir_probabilites(uuid, numeric, numeric, text),
  public.pheno_affectation_accorder(jsonb), public.pheno_affectation_revoquer(uuid, text), public.pheno_sync_batch(jsonb),
  public.pheno_visite_verifier(uuid, integer), public.pheno_visite_demander_correction(uuid, text, integer),
  public.pheno_visite_valider(uuid, integer), public.pheno_correction_decider(uuid, text, text),
  public.pheno_observateurs_du_cluster(), public.pheno_parcelles_disponibles(uuid), public.pheno_graine_creer(uuid) from public, anon;
grant execute on function public.pheno_panel_installer(jsonb), public.pheno_bloc_inventorier(jsonb), public.pheno_arbre_marquer(jsonb),
  public.pheno_reserve_activer(uuid, text), public.pheno_panel_definir_probabilites(uuid, numeric, numeric, text),
  public.pheno_affectation_accorder(jsonb), public.pheno_affectation_revoquer(uuid, text), public.pheno_sync_batch(jsonb),
  public.pheno_visite_verifier(uuid, integer), public.pheno_visite_demander_correction(uuid, text, integer),
  public.pheno_visite_valider(uuid, integer), public.pheno_correction_decider(uuid, text, text),
  public.pheno_observateurs_du_cluster(), public.pheno_parcelles_disponibles(uuid), public.pheno_graine_creer(uuid) to authenticated;

commit;
