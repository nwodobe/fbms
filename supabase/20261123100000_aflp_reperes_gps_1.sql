-- =====================================================================
-- REPÈRES GPS AFLP 2027 · migration 1 : coordonnées saisies ou capturées
--   pour une parcelle, un bloc ou un arbre suivi de l'Observatoire
-- ---------------------------------------------------------------------
-- Mandat du Branch Manager du 23/11/2026 (« saisie manuelle des coordonnées GPS,
-- hors réseau, livrée par OTA »). Le mandat lève, pour cette seule amélioration,
-- l'interdiction d'agent-policy.yml de modifier `supabase/**` et le projet hébergé.
--
-- POURQUOI UNE TABLE À PART (et non les colonnes latitude/longitude existantes)
--   1. farmer_plots_gps_metadata_chk exige une précision > 0 et une date de capture
--      dès qu'un point existe : une saisie manuelle à précision inconnue devrait
--      INVENTER une précision. Ici, une précision inconnue reste NULL.
--   2. Les clients déjà distribués écrivent farmer_plots / pheno_arbres par
--      LOCALISER et ARBRE_MARQUER. Ils ne connaissent pas cette table : ils ne
--      peuvent donc ni effacer un repère, ni sa provenance, ni son rattachement.
--   3. Une saisie manuelle ne devient jamais un « point capturé sur le champ » :
--      farmer_plots.gps_status n'est pas touché, l'éligibilité à l'installation
--      d'un panel (private.pheno_parcelle_manques) reste inchangée.
--
-- CE QUE LA MIGRATION NE FAIT PAS
--   Elle ne modifie aucune table, colonne, contrainte, fonction ni donnée existante.
--   Elle ne calcule aucune superficie : un repère est un POINT.
--   Elle ne rend aucune coordonnée obligatoire.
--
-- MODÈLE
--   public.geo_reperes : une ligne par version d'un repère. Jamais d'UPDATE des
--   coordonnées : corriger = nouvelle ligne (version_no + 1, remplace_id), l'ancienne
--   passe à actif = false. L'historique (ancienne valeur, nouvelle valeur, auteur,
--   motif) est donc la table elle-même.
--   Référentiel : WGS84, degrés décimaux, latitude puis longitude.
--
-- SÉCURITÉ (équivalente aux objets existants, sans élargissement)
--   Lecture  : RLS — qui peut lire la parcelle (plot_map_peut_lire) ou le panel
--              (pheno_peut_lire_panel) lit ses repères.
--   Écriture : aucune politique. Seule public.geo_reperes_sync_batch (SECURITY
--              DEFINER) écrit, avec les mêmes gardes que plot_map_localiser
--              (classe, périmètre, activation du cluster, consentement GPS) et que
--              pheno_arbre_marquer (pheno_peut_collecter).
--   Le consentement GPS du producteur est exigé pour les trois types d'objet.
--
-- RETOUR ARRIÈRE : 20261123100100_aflp_reperes_gps_1_rollback.sql
-- REJOUABLE : oui.
-- =====================================================================
begin;

create table if not exists public.geo_reperes (
  id                  uuid primary key default gen_random_uuid(),
  objet_type          text not null,
  objet_id            uuid not null,
  plot_id             uuid not null references public.farmer_plots(id),
  panel_id            uuid references public.pheno_panels(id),
  bloc_id             uuid references public.pheno_blocs(id),
  producteur_id       text not null,
  cluster_code        text,
  zone_code           text,
  latitude            numeric(10,7) not null,
  longitude           numeric(10,7) not null,
  referentiel         text not null default 'WGS84',
  origine             text not null,
  source_externe      text,
  releve_le           timestamptz,
  precision_m         numeric(8,2),
  hors_zone_attendue  boolean not null default false,
  version_no          integer not null,
  remplace_id         uuid references public.geo_reperes(id),
  motif               text,
  actif               boolean not null default true,
  statut              text not null default 'BROUILLON',
  consentement_ref    jsonb,
  device_id           text,
  client_operation_id text,
  saisi_le_client     timestamptz,
  created_by          uuid not null,
  created_by_role     text,
  created_at          timestamptz not null default now(),
  constraint geo_reperes_objet_type_chk  check (objet_type in ('PARCELLE', 'BLOC', 'ARBRE')),
  constraint geo_reperes_latitude_chk    check (latitude between -90 and 90),
  constraint geo_reperes_longitude_chk   check (longitude between -180 and 180),
  constraint geo_reperes_pas_zero_chk    check (not (latitude = 0 and longitude = 0)),
  constraint geo_reperes_referentiel_chk check (referentiel = 'WGS84'),
  constraint geo_reperes_origine_chk     check (origine in ('GPS_APPAREIL', 'SAISIE_MANUELLE')),
  constraint geo_reperes_precision_chk   check (precision_m is null or (precision_m > 0 and precision_m <= 10000)),
  -- Une capture par l'appareil porte toujours sa précision et son heure ;
  -- une saisie manuelle peut les ignorer (inconnu = NULL, jamais une valeur fictive).
  constraint geo_reperes_capture_chk     check (origine <> 'GPS_APPAREIL' or (precision_m is not null and releve_le is not null)),
  constraint geo_reperes_statut_chk      check (statut in ('BROUILLON', 'VERIFIE', 'REJETE')),
  constraint geo_reperes_version_chk     check (version_no >= 1),
  constraint geo_reperes_source_chk      check (source_externe is null or length(source_externe) <= 200),
  constraint geo_reperes_motif_chk       check (motif is null or length(motif) <= 500),
  constraint geo_reperes_rattachement_chk check (
    (objet_type = 'PARCELLE' and objet_id = plot_id and bloc_id is null)
    or (objet_type = 'BLOC'  and panel_id is not null and bloc_id = objet_id)
    or (objet_type = 'ARBRE' and panel_id is not null)),
  constraint geo_reperes_version_unique unique (objet_type, objet_id, version_no)
);

comment on table public.geo_reperes is
  'Repères GPS (points) de parcelles, blocs et arbres suivis. WGS84, degrés décimaux. Une ligne par version ; actif = version courante. Un repère n''est ni un contour ni une superficie.';
comment on column public.geo_reperes.origine is 'GPS_APPAREIL : capturé par ce téléphone. SAISIE_MANUELLE : coordonnées tapées par l''agent (ne prouve pas une présence sur le champ).';
comment on column public.geo_reperes.releve_le is 'Date du relevé sur le terrain si elle est connue. Distincte de saisi_le_client (saisie) et de created_at (réception serveur).';
comment on column public.geo_reperes.precision_m is 'Précision du relevé en mètres si elle a été fournie. NULL = inconnue.';
comment on column public.geo_reperes.statut is 'Validation métier, indépendante de la transmission : BROUILLON tant que la supervision n''a pas statué.';

create unique index if not exists geo_reperes_actif_unique on public.geo_reperes (objet_type, objet_id) where actif;
create index if not exists geo_reperes_plot_idx  on public.geo_reperes (plot_id) where actif;
create index if not exists geo_reperes_panel_idx on public.geo_reperes (panel_id) where actif and panel_id is not null;

create table if not exists private.geo_reperes_sync_recus (
  idempotency_key text primary key,
  user_id         uuid not null,
  request_hash    text not null,
  resultat        jsonb not null,
  recu_le         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Droits : lecture seule pour les utilisateurs connectés, rien pour anon.
-- (Les privilèges par défaut du projet accordent tout à anon : on révoque.)
-- ---------------------------------------------------------------------
revoke all on public.geo_reperes from public, anon, authenticated;
grant select on public.geo_reperes to authenticated;
revoke all on private.geo_reperes_sync_recus from public, anon, authenticated;

alter table public.geo_reperes enable row level security;
alter table private.geo_reperes_sync_recus enable row level security;

create or replace function private.geo_repere_peut_lire(p_producteur text, p_zone text, p_panel uuid) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select coalesce(private.plot_map_peut_lire(p_producteur, p_zone), false)
      or (p_panel is not null and coalesce(private.pheno_peut_lire_panel(p_panel), false))
$$;
revoke all on function private.geo_repere_peut_lire(text, text, uuid) from public, anon;
grant execute on function private.geo_repere_peut_lire(text, text, uuid) to authenticated;

drop policy if exists geo_reperes_lecture on public.geo_reperes;
create policy geo_reperes_lecture on public.geo_reperes for select to authenticated
  using ((select private.geo_repere_peut_lire(producteur_id, zone_code, panel_id)));

-- ---------------------------------------------------------------------
-- Enregistrement d'un repère (appelé seulement par le lot de synchronisation).
-- Codes : GR001 = refus d'accès ou de consentement · GR002 = donnée invalide ·
--         GR409 = le repère a changé sur le serveur depuis la lecture du téléphone.
-- ---------------------------------------------------------------------
create or replace function private.geo_repere_enregistrer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_type text := upper(coalesce(p->>'objet_type', ''));
  v_objet uuid; v_lat numeric; v_lng numeric; v_prec numeric; v_releve timestamptz; v_saisi timestamptz;
  v_origine text := upper(coalesce(p->>'origine', ''));
  v_source text := nullif(btrim(coalesce(p->>'source_externe', '')), '');
  v_motif text := nullif(btrim(coalesce(p->>'motif', '')), '');
  v_base integer := coalesce(nullif(p->>'version_base', '')::integer, 0);
  v_plot uuid; v_panel uuid; v_bloc uuid; v_cluster_panel text;
  cx record; v_cur public.geo_reperes; v_new public.geo_reperes; v_hors boolean; v_classe text;
begin
  if auth.uid() is null then raise exception 'Accès refusé.' using errcode = 'GR001'; end if;
  if v_type not in ('PARCELLE', 'BLOC', 'ARBRE') then raise exception 'Type d''objet inconnu.' using errcode = 'GR002'; end if;
  if v_origine not in ('GPS_APPAREIL', 'SAISIE_MANUELLE') then raise exception 'Origine des coordonnées inconnue.' using errcode = 'GR002'; end if;
  begin
    v_objet := (p->>'objet_id')::uuid;
    v_lat := (p->>'latitude')::numeric; v_lng := (p->>'longitude')::numeric;
    v_prec := nullif(p->>'precision_m', '')::numeric;
    v_releve := nullif(p->>'releve_le', '')::timestamptz;
    v_saisi := nullif(p->>'saisi_le_client', '')::timestamptz;
  exception when others then
    raise exception 'Coordonnées ou dates illisibles.' using errcode = 'GR002';
  end;
  if v_objet is null then raise exception 'Objet non précisé.' using errcode = 'GR002'; end if;
  if v_lat is null or v_lng is null then raise exception 'Latitude et longitude sont obligatoires.' using errcode = 'GR002'; end if;
  if v_lat not between -90 and 90 then raise exception 'Latitude hors limites (de -90 à 90).' using errcode = 'GR002'; end if;
  if v_lng not between -180 and 180 then raise exception 'Longitude hors limites (de -180 à 180).' using errcode = 'GR002'; end if;
  if v_lat = 0 and v_lng = 0 then raise exception 'Le point 0, 0 n''est pas une position : laissez le repère vide si la position est inconnue.' using errcode = 'GR002'; end if;
  if v_prec is not null and (v_prec <= 0 or v_prec > 10000) then raise exception 'Précision invalide.' using errcode = 'GR002'; end if;
  if v_origine = 'GPS_APPAREIL' and (v_prec is null or v_releve is null) then
    raise exception 'Une capture GPS doit porter sa précision et son heure.' using errcode = 'GR002'; end if;
  if v_releve is not null and v_releve > now() + interval '10 minutes' then
    raise exception 'Date du relevé dans le futur : corrigez la date ou l''heure du téléphone.' using errcode = 'GR002'; end if;
  if length(coalesce(v_source, '')) > 200 or length(coalesce(v_motif, '')) > 500 then
    raise exception 'Texte trop long.' using errcode = 'GR002'; end if;

  -- Rattachement : toujours retrouvé sur le serveur, jamais cru sur parole.
  if v_type = 'PARCELLE' then
    v_plot := v_objet;
  elsif v_type = 'BLOC' then
    select b.id, b.panel_id, pp.plot_id, pp.cluster_code into v_bloc, v_panel, v_plot, v_cluster_panel
      from public.pheno_blocs b join public.pheno_panels pp on pp.id = b.panel_id where b.id = v_objet;
    if v_bloc is null then raise exception 'Bloc introuvable.' using errcode = 'GR002'; end if;
  else
    select a.bloc_id, a.panel_id, pp.plot_id, pp.cluster_code into v_bloc, v_panel, v_plot, v_cluster_panel
      from public.pheno_arbres a join public.pheno_panels pp on pp.id = a.panel_id where a.id = v_objet;
    if v_panel is null then raise exception 'Arbre introuvable.' using errcode = 'GR002'; end if;
  end if;

  select * into cx from private.plot_map_contexte(v_plot);
  if cx.plot_id is null or cx.deleted then raise exception 'Parcelle introuvable.' using errcode = 'GR002'; end if;

  if v_type = 'PARCELLE' then
    v_classe := private.plot_map_classe();
    if v_classe is null then raise exception 'Accès refusé.' using errcode = 'GR001'; end if;
    if cx.cluster_code is null then raise exception 'Le village de cette parcelle n''est rattaché à aucun cluster AFLP.' using errcode = 'GR002'; end if;
    if not private.plot_map_actif('localisation', cx.cluster_code) then
      raise exception 'La localisation des champs n''est pas encore activée pour ce cluster.' using errcode = 'GR001'; end if;
    if not private.plot_map_peut_saisir(cx.cluster_code, cx.producteur_id) then
      raise exception 'Cette parcelle est hors de votre périmètre.' using errcode = 'GR001'; end if;
  else
    v_classe := private.pheno_classe();
    if v_classe is null or not private.pheno_peut_collecter(v_cluster_panel) then
      raise exception 'Repérage réservé aux agents du cluster.' using errcode = 'GR001'; end if;
  end if;

  if not private.plot_map_consentement_gps(cx.producteur_id) then
    raise exception 'Le producteur n''a pas donné son accord pour l''enregistrement des données GPS. Recueillez d''abord son consentement.' using errcode = 'GR001'; end if;

  -- Position incohérente avec le contexte : signalée, jamais corrigée.
  v_hors := v_lat not between 4 and 11 or v_lng not between -9 and -2;
  if v_hors and not coalesce((p->>'confirmer_hors_zone')::boolean, false) then
    raise exception 'Ces coordonnées sont hors de la Côte d''Ivoire. Vérifiez la latitude, la longitude et le signe, puis confirmez si elles sont exactes.' using errcode = 'GR002'; end if;

  perform pg_advisory_xact_lock(hashtextextended('geo_repere:' || v_type || ':' || v_objet::text, 0));
  select * into v_cur from public.geo_reperes where objet_type = v_type and objet_id = v_objet and actif for update;

  if found then
    if v_cur.latitude = round(v_lat, 7) and v_cur.longitude = round(v_lng, 7) and v_cur.origine = v_origine
       and v_cur.precision_m is not distinct from round(v_prec, 2) and v_cur.releve_le is not distinct from v_releve
       and v_cur.source_externe is not distinct from v_source then
      return jsonb_build_object('statut', 'ACCEPTEE', 'repere_id', v_cur.id, 'version_no', v_cur.version_no, 'inchange', true,
                                'objet_type', v_type, 'objet_id', v_objet, 'recu_serveur_le', now());
    end if;
    if v_cur.version_no <> v_base then
      raise exception 'Ce repère a été modifié depuis un autre appareil (version % sur le serveur). Comparez les deux positions avant de choisir.', v_cur.version_no
        using errcode = 'GR409';
    end if;
    if v_motif is null then raise exception 'Indiquez le motif de la correction du repère.' using errcode = 'GR002'; end if;
    update public.geo_reperes set actif = false where id = v_cur.id;
  elsif v_base <> 0 then
    raise exception 'Le repère attendu n''existe plus sur le serveur. Rechargez la fiche avant de corriger.' using errcode = 'GR409';
  end if;

  insert into public.geo_reperes (objet_type, objet_id, plot_id, panel_id, bloc_id, producteur_id, cluster_code, zone_code,
      latitude, longitude, origine, source_externe, releve_le, precision_m, hors_zone_attendue, version_no, remplace_id, motif,
      consentement_ref, device_id, client_operation_id, saisi_le_client, created_by, created_by_role)
  values (v_type, v_objet, v_plot, v_panel, case when v_type = 'PARCELLE' then null else v_bloc end, cx.producteur_id,
      coalesce(v_cluster_panel, cx.cluster_code), cx.zone_code,
      round(v_lat, 7), round(v_lng, 7), v_origine, v_source, v_releve, round(v_prec, 2), v_hors,
      coalesce(v_cur.version_no, 0) + 1, v_cur.id, v_motif,
      private.plot_map_consentement_ref(cx.producteur_id), nullif(p->>'device_id', ''), nullif(p->>'client_operation_id', ''),
      v_saisi, auth.uid(), v_classe)
  returning * into v_new;

  return jsonb_build_object('statut', 'ACCEPTEE', 'repere_id', v_new.id, 'version_no', v_new.version_no, 'inchange', false,
                            'objet_type', v_type, 'objet_id', v_objet, 'hors_zone_attendue', v_hors, 'recu_serveur_le', now());
end $$;
revoke all on function private.geo_repere_enregistrer(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Lot de synchronisation idempotent (même contrat que plot_map_sync_batch
-- et pheno_sync_batch : clé d'idempotence, empreinte de la demande, reçu).
-- ---------------------------------------------------------------------
create or replace function public.geo_reperes_sync_batch(p_operations jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_op jsonb; v_cle text; v_hash text; v_recu private.geo_reperes_sync_recus; v_res jsonb; v_out jsonb := '[]'::jsonb;
  v_payload jsonb; v_diag text; v_cur public.geo_reperes;
begin
  if auth.uid() is null or (private.plot_map_classe() is null and private.pheno_classe() is null) then
    raise exception 'Accès refusé.' using errcode = 'GR001'; end if;
  if jsonb_typeof(p_operations) <> 'array' then raise exception 'Lot invalide.' using errcode = 'GR002'; end if;
  if jsonb_array_length(p_operations) > 50 then raise exception 'Lot trop volumineux (50 opérations au plus).' using errcode = 'GR002'; end if;

  for v_op in select * from jsonb_array_elements(p_operations) loop
    v_cle := v_op->>'idempotency_key';
    if coalesce(v_cle, '') = '' or length(v_cle) > 200 then
      v_out := v_out || jsonb_build_object('idempotency_key', v_cle, 'statut', 'REJETEE', 'message', 'Clé d''idempotence manquante.');
      continue;
    end if;
    v_hash := encode(sha256(convert_to(jsonb_build_object('type', v_op->'type', 'payload', coalesce(v_op->'payload', '{}'::jsonb))::text, 'UTF8')), 'hex');
    perform pg_advisory_xact_lock(hashtextextended('geo_reperes_sync:' || v_cle, 0));
    select * into v_recu from private.geo_reperes_sync_recus where idempotency_key = v_cle;
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
      || jsonb_build_object('device_id', v_op->>'device_id', 'saisi_le_client', v_op->>'created_at_client', 'client_operation_id', v_cle);
    begin
      case v_op->>'type'
        when 'REPERE_ENREGISTRER' then v_res := private.geo_repere_enregistrer(v_payload);
        else raise exception 'Type d''opération inconnu : %.', v_op->>'type' using errcode = 'GR002';
      end case;
    exception
      when sqlstate 'GR409' then
        select * into v_cur from public.geo_reperes
         where objet_type = upper(v_payload->>'objet_type') and objet_id = nullif(v_payload->>'objet_id', '')::uuid and actif;
        v_res := jsonb_build_object('statut', 'CONFLIT', 'code', 'GR409', 'message', sqlerrm,
          'serveur', case when v_cur.id is null then null else jsonb_build_object(
            'repere_id', v_cur.id, 'version_no', v_cur.version_no, 'latitude', v_cur.latitude, 'longitude', v_cur.longitude,
            'origine', v_cur.origine, 'source_externe', v_cur.source_externe, 'releve_le', v_cur.releve_le,
            'precision_m', v_cur.precision_m, 'created_at', v_cur.created_at) end);
      when sqlstate 'GR001' then v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'GR001', 'message', sqlerrm);
      when sqlstate 'GR002' then v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'GR002', 'message', sqlerrm);
      when others then
        v_diag := substr(encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), 1, 10);
        raise warning 'geo_reperes_sync_batch % : % (%)', v_diag, sqlerrm, sqlstate;
        v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'TECHNIQUE', 'diagnostic', v_diag,
          'message', 'Opération refusée par le serveur (erreur technique). Communiquez le code ' || v_diag || ' à votre responsable.');
    end;
    v_res := v_res || jsonb_build_object('idempotency_key', v_cle, 'recu_serveur_le', coalesce(v_res->'recu_serveur_le', to_jsonb(now())));
    -- Seule une acceptation est définitive. Un conflit ou un refus peut être rejoué
    -- après correction (nouvelle clé côté téléphone), jamais mémorisé comme un succès.
    if v_res->>'statut' = 'ACCEPTEE' then
      insert into private.geo_reperes_sync_recus (idempotency_key, user_id, request_hash, resultat)
      values (v_cle, auth.uid(), v_hash, v_res) on conflict (idempotency_key) do nothing;
    end if;
    v_out := v_out || v_res;
  end loop;
  return jsonb_build_object('resultats', v_out, 'serveur_le', now());
end $$;

revoke all on function public.geo_reperes_sync_batch(jsonb) from public, anon;
grant execute on function public.geo_reperes_sync_batch(jsonb) to authenticated;

commit;
