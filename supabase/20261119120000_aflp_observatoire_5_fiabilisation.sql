-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 · migration 5 : fiabilisation
-- Mandat du Branch Manager du 19/11/2026 (décisions 1 à 7).
--   D2 · sélection libre des arbres par le Chef d'Unité (mode DESIGNATION),
--        nomenclature terrain B03/A010, remplacement daté et motivé ;
--   D3 · registre FBMS complet avant installation (aucune écriture dans le registre) ;
--   D4 · matrice de validation : AUH → UH, UH → ZH, BM en exception justifiée ;
--   D5 · une preuve photo par arbre retrouvé, contrôlée dans le stockage serveur ;
--   D6 · saisie rétrospective justifiée, dates futures refusées, anomalies classées ;
--   D1/D8 · préparation des six clusters et supervision Branch Manager.
-- ADDITIVE : aucune table supprimée, aucune donnée effacée. Les champs déjà installés
-- en mode TIRAGE gardent leur fonctionnement et leurs codes.
-- RETOUR ARRIÈRE : supabase/20261119120100_aflp_observatoire_5_rollback.sql
-- REJOUABLE : oui.
-- =====================================================================
begin;

-- ---------------------------------------------------------------- colonnes
alter table public.pheno_panels add column if not exists mode_selection text not null default 'TIRAGE';
alter table public.pheno_panels drop constraint if exists pheno_panels_mode_selection_check;
alter table public.pheno_panels add constraint pheno_panels_mode_selection_check check (mode_selection in ('TIRAGE', 'DESIGNATION'));
alter table public.pheno_panels add column if not exists designe_par uuid;
alter table public.pheno_panels add column if not exists designe_le timestamptz;

alter table public.pheno_arbres add column if not exists designe_par uuid;
alter table public.pheno_arbres add column if not exists date_effet date;

alter table public.pheno_visites add column if not exists temporalite text not null default 'NORMALE';
alter table public.pheno_visites drop constraint if exists pheno_visites_temporalite_check;
alter table public.pheno_visites add constraint pheno_visites_temporalite_check check (temporalite in ('NORMALE', 'RETROSPECTIVE', 'INCOHERENTE'));
alter table public.pheno_visites add column if not exists justification_retro text;
alter table public.pheno_visites add column if not exists validation_justification text;
alter table public.pheno_visites add column if not exists validation_exceptionnelle boolean not null default false;

alter table public.pheno_observations add column if not exists photo_exception text;
alter table public.pheno_observations add column if not exists photo_prise_le timestamptz;
alter table public.pheno_observations add column if not exists photo_latitude numeric;
alter table public.pheno_observations add column if not exists photo_longitude numeric;

-- Protocole actif : désignation libre (décision 2). Les champs déjà installés ne changent pas.
update public.pheno_protocoles set parametres = parametres || jsonb_build_object(
  'mode_selection', 'DESIGNATION', 'nomenclature', 'B00/A000',
  'avertissement', 'Suivi d''arbres désignés par le Chef d''Unité : pas un échantillon statistiquement représentatif.')
where actif and coalesce(parametres->>'mode_selection', '') <> 'DESIGNATION';

-- Classement (sans suppression) des visites déjà reçues dont la date est incohérente
-- (antérieure à la campagne ou à l'installation du champ). Revue à faire par le valideur.
update public.pheno_visites v set temporalite = 'INCOHERENTE'
from public.pheno_panels p left join public.campaigns c on c.id = p.campaign_id
where p.id = v.panel_id and v.temporalite = 'NORMALE'
  and (v.date_observation < (p.created_at at time zone 'Africa/Abidjan')::date - 1
       or (c.start_date is not null and v.date_observation < c.start_date));

-- ---------------------------------------------------------------- aides
create or replace function private.pheno_aujourdhui() returns date
language sql stable set search_path to 'public', 'pg_temp' as $$ select (now() at time zone 'Africa/Abidjan')::date $$;

create or replace function private.pheno_code_arbre(p_bloc integer, p_numero integer) returns text
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select 'B' || lpad(p_bloc::text, 2, '0') || '/A' || lpad(p_numero::text, 3, '0')
$$;

-- D3 · Ce qui manque à une parcelle du registre pour entrer dans l'Observatoire.
-- Exigences limitées à celles du mandat (pas de superficie : le protocole ne l'exige pas).
create or replace function private.pheno_parcelle_manques(p_plot uuid) returns text[]
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select coalesce(array_remove(array[
    case when v.id is null or public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')) is null
         then 'village rattaché à un cluster AFLP' end,
    case when pr.id is null or coalesce(btrim(pr.code), '') = '' or coalesce(pr.possible_duplicate, false)
         then 'producteur identifié (code unique, sans doublon signalé)' end,
    case when pr.id is null or coalesce(btrim(pr.nom), '') = '' or coalesce(btrim(pr.prenoms), '') = ''
         then 'nom et prénoms du producteur' end,
    case when fp.latitude is null or fp.longitude is null or fp.gps_status <> 'POINT_CAPTURED'
         then 'position GPS relevée sur le champ' end,
    case when coalesce(fp.tree_count, 0) <= 0 then 'nombre d''arbres du champ' end,
    case when coalesce(fp.status, '') <> 'ACTIVE' or fp.deleted then 'champ actif dans le registre' end
  ], null), '{}')
  from public.farmer_plots fp
  left join public.villages v on v.id = fp.village_id
  left join public.producteurs pr on pr.id = fp.producteur_id and not coalesce(pr.deleted, false)
  where fp.id = p_plot
$$;

-- D4 · Droit de décision sur une visite précise.
-- ORDINAIRE : AUH → Chef d'Unité du cluster ; AUH ou UH → Chef de Zone de la zone ;
--             ABM par affectation explicite. EXCEPTIONNEL : Branch Manager, avec justification.
-- Jamais sur sa propre observation ou transcription. Le Chef de Zone observateur n'a
-- pas de validateur ordinaire défini : seule l'exception Branch Manager s'applique.
create or replace function private.pheno_droit_decision(v public.pheno_visites) returns text
language plpgsql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_moi text := private.pheno_classe(); v_obs text := private.pheno_classe_de(v.observateur_id);
begin
  if auth.uid() is null or auth.uid() in (v.observateur_id, coalesce(v.transcripteur_id, v.observateur_id)) then return null; end if;
  if v_moi = 'UH' and v.cluster_code = private.pheno_mon_cluster() and v_obs = 'AUH' then return 'ORDINAIRE'; end if;
  if v_moi = 'ZH' and private.pheno_peut_lire_cluster(v.cluster_code) and v_obs in ('AUH', 'UH') then return 'ORDINAIRE'; end if;
  if v_moi = 'ABM' and private.pheno_a_affectation(v.campaign_id, v.cluster_code, array['VALIDATION']) and v_obs in ('AUH', 'UH', 'ZH') then return 'ORDINAIRE'; end if;
  if v_moi = 'BM' then return 'EXCEPTIONNEL'; end if;
  return null;
end $$;

-- D5 · État des preuves photo d'une visite : attendues (arbres retrouvés), reçues
-- (objet présent dans le stockage serveur), exceptions motivées.
create or replace function private.pheno_preuves_visite(p_visite uuid) returns jsonb
language sql stable security definer set search_path to 'public', 'private', 'storage', 'pg_temp' as $$
  select jsonb_build_object(
    'attendues', count(*) filter (where o.retrouve),
    'recues', count(*) filter (where o.retrouve and o.photo_ref is not null and exists (
       select 1 from storage.objects so where so.bucket_id = 'pheno-preuves' and so.name = o.photo_ref)),
    'exceptions', count(*) filter (where o.retrouve and coalesce(btrim(o.photo_exception), '') <> ''),
    'manquantes', coalesce(string_agg(a.code, ', ' order by a.rang) filter (where o.retrouve and coalesce(btrim(o.photo_exception), '') = ''
       and (o.photo_ref is null or not exists (select 1 from storage.objects so where so.bucket_id = 'pheno-preuves' and so.name = o.photo_ref))), ''))
  from public.pheno_observations o join public.pheno_arbres a on a.id = o.arbre_id
  where o.visite_id = p_visite
$$;

-- ---------------------------------------------------------------- observations
create or replace function private.pheno_obs_valeurs(o public.pheno_observations) returns jsonb
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select jsonb_build_object('retrouve', o.retrouve, 'f', o.f, 'n', o.n, 'p', o.p, 'pas_vu_motif', o.pas_vu_motif,
    'chute', o.chute, 'chute_preuve', o.chute_preuve, 'anomalie', o.anomalie, 'photo_ref', o.photo_ref, 'photo_exception', o.photo_exception)
$$;

create or replace function private.pheno_obs_demande(o jsonb) returns jsonb
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select case when (o->>'retrouve')::boolean is false then
    jsonb_build_object('retrouve', false, 'f', null, 'n', null, 'p', null,
      'pas_vu_motif', nullif(btrim(o->>'pas_vu_motif'), ''), 'chute', null, 'chute_preuve', null,
      'anomalie', nullif(btrim(o->>'anomalie'), ''), 'photo_ref', nullif(btrim(o->>'photo_ref'), ''), 'photo_exception', null)
  else
    jsonb_build_object('retrouve', o->'retrouve', 'f', o->'f', 'n', o->'n', 'p', o->'p',
      'pas_vu_motif', nullif(btrim(o->>'pas_vu_motif'), ''), 'chute', o->'chute',
      'chute_preuve', case when o->>'chute' in ('MURE', 'PREMATUREE') then o->'chute_preuve' end,
      'anomalie', nullif(btrim(o->>'anomalie'), ''), 'photo_ref', nullif(btrim(o->>'photo_ref'), ''),
      'photo_exception', nullif(btrim(o->>'photo_exception'), ''))
  end
$$;

-- Contrôles de complétude, à la soumission et à la validation.
create or replace function private.pheno_visite_controler(p_visite uuid) returns void
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites; v_n integer; v_codes text; v_pr jsonb;
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
  if v_n > 0 then raise exception 'Visite incomplète : fleurs, noix, pommes ou fruits tombés non renseignés (%).', v_codes using errcode = 'PH002'; end if;
  select count(*), string_agg(a.code, ', ') into v_n, v_codes
    from public.pheno_observations o join public.pheno_arbres a on a.id = o.arbre_id
    where o.visite_id = p_visite and coalesce(btrim(o.pas_vu_motif), '') = ''
      and (o.retrouve = false or 'PAS_VU' in (o.f, o.n, o.p, o.chute));
  if v_n > 0 then raise exception 'Raison obligatoire pour « Pas vu » ou arbre non retrouvé (%).', v_codes using errcode = 'PH002'; end if;
  select count(*), string_agg(a.code, ', ') into v_n, v_codes
    from public.pheno_observations o join public.pheno_arbres a on a.id = o.arbre_id
    where o.visite_id = p_visite and o.chute in ('MURE', 'PREMATUREE') and o.chute_preuve is null;
  if v_n > 0 then raise exception 'Source de preuve obligatoire pour une chute constatée (%).', v_codes using errcode = 'PH002'; end if;
  v_pr := private.pheno_preuves_visite(p_visite);
  if coalesce(v_pr->>'manquantes', '') <> '' then
    raise exception 'Photo manquante ou pas encore reçue par FBMS pour : %. Envoyez les photos puis soumettez à nouveau.', v_pr->>'manquantes' using errcode = 'PH002'; end if;
  if v.temporalite <> 'NORMALE' and coalesce(btrim(v.justification_retro), '') = '' then
    raise exception 'Saisie après le jour de l''observation : la justification est obligatoire.' using errcode = 'PH002'; end if;
end $$;

-- ---------------------------------------------------------------- visite
create or replace function private.pheno_visite_enregistrer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_uid uuid := auth.uid(); v_id uuid := (p->>'id')::uuid; v_panel public.pheno_panels; v_vis public.pheno_visites;
  v_soumettre boolean := coalesce((p->>'soumettre')::boolean, false); v_date date := (p->>'date_observation')::date;
  v_sem text; v_mode text := coalesce(p->>'mode_saisie', 'DIRECT'); v_obs uuid; v_trans uuid; v_o jsonb; v_arbre public.pheno_arbres;
  v_old public.pheno_observations; v_dem jsonb; v_anc jsonb; v_k text; v_n integer := 0; v_deja_soumise boolean := false;
  v_motif text := nullif(btrim(p->>'motif_correction'), ''); v_photo text;
  v_jour_saisie date; v_justif text := nullif(btrim(p->>'justification_retro'), ''); v_temp text := 'NORMALE'; v_debut date;
begin
  if v_id is null then raise exception 'Identifiant de visite manquant.' using errcode = 'PH002'; end if;
  select * into v_panel from public.pheno_panels where id = (p->>'panel_id')::uuid;
  if not found then raise exception 'Champ de l''Observatoire introuvable.' using errcode = 'PH002'; end if;
  if not private.pheno_peut_collecter(v_panel.cluster_code) then
    raise exception 'Collecte réservée aux agents du cluster %.', v_panel.cluster_code using errcode = 'PH001'; end if;
  if v_panel.statut <> 'ACTIF' then raise exception 'Ce champ n''est pas actif (statut %).', v_panel.statut using errcode = 'PH002'; end if;
  if not private.pheno_campagne_ouverte(v_panel.campaign_id) then raise exception 'La campagne n''est pas ouverte.' using errcode = 'PH002'; end if;
  if v_date is null then raise exception 'Date d''observation manquante.' using errcode = 'PH002'; end if;
  -- D6 · Date future impossible : refusée (heure de Côte d'Ivoire). Jamais remplacée par la date du jour.
  if v_date > private.pheno_aujourdhui() then
    raise exception 'La date d''observation (%) est dans le futur. Vérifiez la date du téléphone.', to_char(v_date, 'DD/MM/YYYY') using errcode = 'PH002'; end if;
  -- D6 · Saisie rétrospective : toute date passée est possible, justification obligatoire à la soumission,
  -- classement INCOHERENTE si la date précède la campagne, l'installation du champ ou date de plus de 60 jours.
  v_jour_saisie := least(coalesce(((p->>'saisie_le')::timestamptz at time zone 'Africa/Abidjan')::date, private.pheno_aujourdhui()), private.pheno_aujourdhui());
  if v_date < v_jour_saisie then
    select start_date into v_debut from public.campaigns where id = v_panel.campaign_id;
    v_temp := case when v_date < (v_panel.created_at at time zone 'Africa/Abidjan')::date - 1
                     or (v_debut is not null and v_date < v_debut) or v_date < v_jour_saisie - 60
                   then 'INCOHERENTE' else 'RETROSPECTIVE' end;
    if v_soumettre and v_justif is null then
      raise exception 'Saisie après le jour de l''observation : indiquez pourquoi (justification obligatoire).' using errcode = 'PH002'; end if;
  end if;
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
          'row_version', v_vis.row_version, 'recu_serveur_le', v_vis.recu_serveur_le, 'preuves', private.pheno_preuves_visite(v_id));
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
      temporalite = v_temp, justification_retro = v_justif,
      recu_serveur_le = now(), row_version = row_version + 1, updated_at = now() where id = v_id;
  else
    if exists (select 1 from public.pheno_visites where panel_id = v_panel.id and semaine_iso = v_sem) then
      perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', v_panel.id, 'CONFLIT_DOUBLON_SEMAINE', null,
        jsonb_build_object('semaine', v_sem, 'visite_refusee', v_id, 'appareil', p->>'device_id'), null);
      return jsonb_build_object('statut', 'CONFLIT', 'code', 'DOUBLON_SEMAINE', 'visite_id', v_id,
        'message', format('Une autre visite existe déjà pour ce champ en semaine %s. La vôtre n''a pas été enregistrée : contactez votre Chef d''Unité.', v_sem));
    end if;
    insert into public.pheno_visites (id, panel_id, campaign_id, cluster_code, semaine_iso, date_observation, saisie_le,
      observateur_id, transcripteur_id, mode_saisie, ramassage, anomalies, latitude, longitude, device_id, temporalite, justification_retro)
    values (v_id, v_panel.id, v_panel.campaign_id, v_panel.cluster_code, v_sem, v_date, (p->>'saisie_le')::timestamptz,
      v_obs, v_trans, v_mode, p->>'ramassage', nullif(btrim(p->>'anomalies'), ''),
      (p->>'latitude')::numeric, (p->>'longitude')::numeric, p->>'device_id', v_temp, v_justif);
  end if;

  for v_o in select * from jsonb_array_elements(coalesce(p->'observations', '[]')) loop
    select * into v_arbre from public.pheno_arbres where id = (v_o->>'arbre_id')::uuid and panel_id = v_panel.id;
    if not found then raise exception 'Arbre étranger à ce champ.' using errcode = 'PH002'; end if;
    if v_arbre.statut not in ('ACTIF', 'RESERVE_ACTIVEE') then
      raise exception 'L''arbre % n''est pas observé (réserve non activée ou arbre remplacé).', v_arbre.code using errcode = 'PH002'; end if;
    v_dem := private.pheno_obs_demande(v_o);
    v_photo := v_dem->>'photo_ref';
    -- D5 · la photo d'un arbre appartient à CET arbre de CETTE visite : chemin imposé.
    --     Chemin : <campagne>/<champ>/<auteur du dépôt>/<visite8>_<arbre sans tirets>_<horodatage>.<ext>
    if v_photo is not null then
      if v_photo not like v_panel.campaign_id::text || '/' || v_panel.id::text || '/' || v_uid::text || '/%' then
        raise exception 'Référence de preuve invalide.' using errcode = 'PH002'; end if;
      if position(replace(v_arbre.id::text, '-', '') in v_photo) = 0 then
        raise exception 'La photo jointe à l''arbre % ne porte pas l''identifiant de cet arbre : reprenez la photo de cet arbre.', v_arbre.code using errcode = 'PH002'; end if;
      if exists (select 1 from jsonb_array_elements(coalesce(p->'observations', '[]')) x
                 where nullif(btrim(x->>'photo_ref'), '') = v_photo and (x->>'arbre_id')::uuid <> v_arbre.id) then
        raise exception 'La même photo est jointe à deux arbres (%) : chaque arbre a sa propre photo.', v_arbre.code using errcode = 'PH002'; end if;
    end if;
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
        anomalie = v_dem->>'anomalie', photo_ref = v_photo, photo_exception = v_dem->>'photo_exception',
        photo_prise_le = (v_o->>'photo_prise_le')::timestamptz, photo_latitude = (v_o->>'photo_latitude')::numeric,
        photo_longitude = (v_o->>'photo_longitude')::numeric, updated_at = now() where id = v_old.id;
    else
      insert into public.pheno_observations (visite_id, arbre_id, retrouve, f, n, p, pas_vu_motif, chute, chute_preuve, anomalie, photo_ref,
        photo_exception, photo_prise_le, photo_latitude, photo_longitude)
      values (v_id, v_arbre.id, (v_dem->>'retrouve')::boolean, v_dem->>'f', v_dem->>'n', v_dem->>'p', v_dem->>'pas_vu_motif',
        v_dem->>'chute', v_dem->>'chute_preuve', v_dem->>'anomalie', v_photo, v_dem->>'photo_exception',
        (v_o->>'photo_prise_le')::timestamptz, (v_o->>'photo_latitude')::numeric, (v_o->>'photo_longitude')::numeric);
    end if;
  end loop;

  if v_soumettre then
    perform private.pheno_visite_controler(v_id);
    update public.pheno_visites set statut = 'SOUMIS', soumis_le = now(), correction_motif = null where id = v_id;
    perform private.pheno_journaliser(v_panel.cluster_code, 'VISITE', v_id, case when v_deja_soumise then 'RESOUMISE' else 'SOUMISE' end,
      null, jsonb_build_object('semaine', v_sem, 'mode', v_mode, 'appareil', p->>'device_id', 'saisie_le', p->>'saisie_le',
        'temporalite', v_temp, 'preuves', private.pheno_preuves_visite(v_id)), coalesce(v_motif, v_justif));
  end if;
  select * into v_vis from public.pheno_visites where id = v_id;
  return jsonb_build_object('statut', 'ACCEPTEE', 'visite_id', v_id, 'statut_visite', v_vis.statut, 'row_version', v_vis.row_version,
    'recu_serveur_le', v_vis.recu_serveur_le, 'temporalite', v_vis.temporalite, 'preuves', private.pheno_preuves_visite(v_id));
end $$;

-- ---------------------------------------------------------------- installation
create or replace function public.pheno_panel_installer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_id uuid := (p->>'id')::uuid; v_campaign uuid := (p->>'campaign_id')::uuid; v_plot public.farmer_plots;
  v_cluster text; v_total integer := (p->>'nb_blocs_total')::integer; v_tires integer := (p->>'nb_blocs_tires')::integer;
  v_proto public.pheno_protocoles; v_exist public.pheno_panels; v_titulaires integer; v_reserves integer;
  v_ordre integer[]; v_bloc jsonb; v_rang integer; v_m integer; v_r integer; v_n integer; v_mode text; v_manques text[];
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
        'mode_selection', v_exist.mode_selection,
        'blocs_tires', (select coalesce(jsonb_agg(numero order by rang_tirage), '[]') from public.pheno_blocs where panel_id = v_id and tire));
    end if;
    raise exception 'Installation verrouillée : ce champ est déjà installé avec d''autres paramètres.' using errcode = 'PH409';
  end if;
  if exists (select 1 from public.pheno_panels where campaign_id = v_campaign and plot_id = v_plot.id) then
    raise exception 'Cette parcelle est déjà installée dans l''Observatoire pour cette campagne (autre appareil).' using errcode = 'PH409';
  end if;
  if not private.pheno_campagne_ouverte(v_campaign) then
    raise exception 'La campagne n''est pas ouverte.' using errcode = 'PH002'; end if;

  -- D3 · Registre FBMS complet avant installation. Rien n'est écrit dans le registre.
  v_manques := private.pheno_parcelle_manques(v_plot.id);
  if cardinality(v_manques) > 0 then
    raise exception 'Ce champ doit être complété dans le registre FBMS avant de commencer l''Observatoire. Manque : %. À corriger par le RT ou le Chef d''Unité dans le registre producteurs.',
      array_to_string(v_manques, ', ') using errcode = 'PH002'; end if;

  select * into v_proto from public.pheno_protocoles where actif order by created_at desc limit 1;
  if not found then raise exception 'Aucun protocole actif.' using errcode = 'PH002'; end if;
  v_titulaires := coalesce((v_proto.parametres->>'titulaires')::integer, 10);
  v_reserves := coalesce((v_proto.parametres->>'reserves')::integer, 2);
  v_mode := coalesce(v_proto.parametres->>'mode_selection', 'TIRAGE');
  if v_mode = 'TIRAGE' and private.pheno_graine(v_campaign) is null then
    raise exception 'Graine de tirage de la campagne absente : le Branch Manager doit la créer avant toute installation.' using errcode = 'PH002'; end if;

  if v_total is null or v_tires is null or v_total < 1 or v_tires < 1 or v_tires > v_total or v_tires > v_titulaires then
    raise exception 'Nombre de blocs invalide : le champ compte % bloc(s) et vous en suivez %. Il faut suivre au moins 1 bloc, au plus le nombre de blocs du champ et au plus %.',
      coalesce(v_total::text, '?'), coalesce(v_tires::text, '?'), v_titulaires using errcode = 'PH002'; end if;
  if jsonb_typeof(p->'blocs') <> 'array' or jsonb_array_length(p->'blocs') <> v_total then
    raise exception 'La liste des blocs doit contenir exactement % blocs.', v_total using errcode = 'PH002'; end if;
  select count(distinct (b->>'numero')::integer) into v_n from jsonb_array_elements(p->'blocs') b
    where (b->>'numero')::integer between 1 and v_total and coalesce(btrim(b->>'repere'), '') <> '' and (b->>'id') is not null;
  if v_n <> v_total then
    raise exception 'Chaque bloc doit avoir un numéro unique de 1 à %, un identifiant et un repère physique.', v_total using errcode = 'PH002'; end if;

  if v_mode = 'DESIGNATION' then
    -- D2 · Blocs suivis choisis par l'équipe terrain (aucun tirage).
    select array_agg((b->>'numero')::integer order by (b->>'numero')::integer) into v_ordre
      from jsonb_array_elements(p->'blocs') b where coalesce((b->>'suivi')::boolean, false);
    if coalesce(cardinality(v_ordre), 0) <> v_tires then
      raise exception 'Cochez exactement % bloc(s) à suivre (vous en avez coché %).', v_tires, coalesce(cardinality(v_ordre), 0) using errcode = 'PH002'; end if;
  else
    v_ordre := private.pheno_tirage(private.pheno_graine(v_campaign) || ':' || v_plot.id::text || ':BLOCS', v_total, v_tires);
  end if;

  insert into public.pheno_panels (id, campaign_id, protocole_id, plot_id, producteur_id, village_id, cluster_code,
    nb_blocs_total, nb_blocs_tires, tirage_graine, tirage_par, device_id, created_by, pi_village, pi_champ, mode_selection)
  values (v_id, v_campaign, v_proto.id, v_plot.id, v_plot.producteur_id, v_plot.village_id, v_cluster,
    v_total, v_tires, case when v_mode = 'DESIGNATION' then 'DESIGNATION' else private.pheno_graine(v_campaign) || ':' || v_plot.id::text || ':BLOCS' end,
    auth.uid(), p->>'device_id', auth.uid(),
    case when v_mode = 'TIRAGE' and private.pheno_classe() = 'BM' then (p->>'pi_village')::numeric end,
    case when v_mode = 'TIRAGE' and private.pheno_classe() = 'BM' then (p->>'pi_champ')::numeric end, v_mode);

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

  perform private.pheno_journaliser(v_cluster, 'PANEL', v_id, case when v_mode = 'DESIGNATION' then 'CHOIX_BLOCS' else 'TIRAGE_BLOCS' end, null, jsonb_build_object(
    'protocole', v_proto.code || ' ' || v_proto.version, 'mode_selection', v_mode, 'B', v_total, 'b', v_tires, 'blocs_suivis', to_jsonb(v_ordre),
    'choisi_par', auth.uid(), 'appareil', p->>'device_id', 'saisi_le_client', p->>'created_at_client'), null);

  return jsonb_build_object('panel_id', v_id, 'statut_panel', 'TIRAGE_VERROUILLE', 'mode_selection', v_mode, 'blocs_tires', to_jsonb(v_ordre), 'row_version', 1);
end $$;

-- Inventaire : en mode DESIGNATION, aucun tirage automatique ; le Chef d'Unité désigne ensuite.
create or replace function public.pheno_bloc_inventorier(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_bloc public.pheno_blocs; v_panel public.pheno_panels; v_n integer := (p->>'nb_arbres')::integer;
begin
  select * into v_bloc from public.pheno_blocs where id = (p->>'bloc_id')::uuid for update;
  if not found then raise exception 'Bloc introuvable.' using errcode = 'PH002'; end if;
  select * into v_panel from public.pheno_panels where id = v_bloc.panel_id;
  if not private.pheno_peut_collecter(v_panel.cluster_code) then
    raise exception 'Inventaire réservé aux agents du cluster.' using errcode = 'PH001'; end if;
  if not v_bloc.tire then raise exception 'Ce bloc n''est pas suivi : il n''est pas inventorié.' using errcode = 'PH002'; end if;
  if v_n is null or v_n < 0 or v_n > 2000 then raise exception 'Nombre d''arbres invalide (0 à 2000).' using errcode = 'PH002'; end if;
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
  if v_panel.mode_selection = 'TIRAGE' then perform private.pheno_tirer_arbres(v_panel.id); end if;
  select * into v_panel from public.pheno_panels where id = v_panel.id;
  return jsonb_build_object('bloc_id', v_bloc.id, 'statut_panel', v_panel.statut, 'incompatibilite', v_panel.incompatibilite, 'mode_selection', v_panel.mode_selection,
    'arbres', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'role', a.role, 'rang', a.rang) order by a.role desc, a.rang), '[]')
               from public.pheno_arbres a where a.panel_id = v_panel.id));
end $$;

-- D2 · Désignation libre de 10 titulaires et 2 réserves par le Chef d'Unité.
create or replace function public.pheno_arbres_designer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_panel public.pheno_panels; v_proto public.pheno_protocoles; v_tit integer; v_res integer; v_a jsonb; v_b public.pheno_blocs;
  v_num integer; v_role text; v_rt integer := 0; v_rr integer := 0; v_cles text[] := '{}'; v_cle text; v_liste jsonb := '[]'::jsonb;
  v_n_t integer; v_n_r integer; v_ex text[];
begin
  select * into v_panel from public.pheno_panels where id = (p->>'panel_id')::uuid for update;
  if not found then raise exception 'Champ de l''Observatoire introuvable.' using errcode = 'PH002'; end if;
  if not (private.pheno_classe() = 'BM' or (private.pheno_classe() = 'UH' and v_panel.cluster_code = private.pheno_mon_cluster())) then
    raise exception 'Le choix des arbres est réservé au Chef d''Unité du cluster %.', v_panel.cluster_code using errcode = 'PH001'; end if;
  if v_panel.mode_selection <> 'DESIGNATION' then
    raise exception 'Ce champ a été installé par tirage : ses arbres ne se désignent pas.' using errcode = 'PH002'; end if;
  if jsonb_typeof(p->'arbres') <> 'array' then raise exception 'Liste d''arbres invalide.' using errcode = 'PH002'; end if;

  -- Rejeu identique (même téléphone ou autre) : accepté sans rien changer. Sinon, conflit.
  if exists (select 1 from public.pheno_arbres where panel_id = v_panel.id) then
    select array_agg(k order by k) into v_ex from (
      select a.bloc_id::text || ':' || a.numero_inventaire || ':' || a.role as k
      from public.pheno_arbres a where a.panel_id = v_panel.id and a.remplace_arbre_id is null) s;
    if v_ex = (select array_agg(k order by k) from (select (x->>'bloc_id') || ':' || (x->>'numero') || ':' || (x->>'role') as k
                                                    from jsonb_array_elements(p->'arbres') x) s2) then
      return jsonb_build_object('panel_id', v_panel.id, 'deja_designe', true, 'statut_panel', v_panel.statut);
    end if;
    raise exception 'Les arbres de ce champ sont déjà désignés. Pour changer un arbre, utilisez le remplacement avec motif.' using errcode = 'PH409';
  end if;
  if v_panel.statut <> 'TIRAGE_VERROUILLE' then raise exception 'Le champ n''attend pas de désignation (statut %).', v_panel.statut using errcode = 'PH002'; end if;
  if exists (select 1 from public.pheno_blocs where panel_id = v_panel.id and tire and nb_arbres_inventories is null) then
    raise exception 'Comptez d''abord tous les arbres de chaque bloc suivi.' using errcode = 'PH002'; end if;

  select * into v_proto from public.pheno_protocoles where id = v_panel.protocole_id;
  v_tit := coalesce((v_proto.parametres->>'titulaires')::integer, 10);
  v_res := coalesce((v_proto.parametres->>'reserves')::integer, 2);
  select count(*) filter (where x->>'role' = 'TITULAIRE'), count(*) filter (where x->>'role' = 'RESERVE')
    into v_n_t, v_n_r from jsonb_array_elements(p->'arbres') x;
  if v_n_t <> v_tit or v_n_r <> v_res or jsonb_array_length(p->'arbres') <> v_tit + v_res then
    raise exception 'Choisissez exactement % arbres suivis et % arbres de réserve (reçu : % et %).', v_tit, v_res, v_n_t, v_n_r using errcode = 'PH002'; end if;

  for v_a in select * from jsonb_array_elements(p->'arbres') loop
    select * into v_b from public.pheno_blocs where id = (v_a->>'bloc_id')::uuid and panel_id = v_panel.id;
    if not found or not v_b.tire then raise exception 'Un arbre choisi n''appartient pas à un bloc suivi de ce champ.' using errcode = 'PH002'; end if;
    v_num := (v_a->>'numero')::integer; v_role := v_a->>'role';
    if v_num is null or v_num < 1 or v_num > v_b.nb_arbres_inventories then
      raise exception 'Bloc %, arbre % : le numéro doit être compris entre 1 et % (arbres comptés dans le bloc).', lpad(v_b.numero::text, 2, '0'), coalesce(v_num::text, '?'), v_b.nb_arbres_inventories using errcode = 'PH002'; end if;
    v_cle := v_b.id::text || ':' || v_num;
    if v_cle = any (v_cles) then
      raise exception 'L''arbre % est choisi deux fois.', private.pheno_code_arbre(v_b.numero, v_num) using errcode = 'PH002'; end if;
    v_cles := v_cles || v_cle;
    if v_role = 'TITULAIRE' then v_rt := v_rt + 1; else v_rr := v_rr + 1; end if;
    insert into public.pheno_arbres (id, panel_id, bloc_id, code, numero_inventaire, role, rang, statut, proba_inclusion, designe_par, date_effet)
    values (private.pheno_arbre_id(v_b.id, v_num), v_panel.id, v_b.id, private.pheno_code_arbre(v_b.numero, v_num), v_num, v_role,
      case when v_role = 'TITULAIRE' then v_rt else v_rr end, case when v_role = 'TITULAIRE' then 'ACTIF' else 'RESERVE_EN_ATTENTE' end,
      null, auth.uid(), private.pheno_aujourdhui());
    v_liste := v_liste || jsonb_build_object('code', private.pheno_code_arbre(v_b.numero, v_num), 'role', v_role);
  end loop;

  update public.pheno_panels set statut = 'ACTIF', designe_par = auth.uid(), designe_le = now(), reserves_manquantes = 0,
    row_version = row_version + 1, updated_at = now() where id = v_panel.id;
  perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', v_panel.id, 'DESIGNATION_ARBRES', null,
    jsonb_build_object('designe_par', auth.uid(), 'arbres', v_liste, 'appareil', p->>'device_id',
      'avertissement', 'Suivi d''arbres désignés : pas un échantillon statistiquement représentatif.'), null);
  return jsonb_build_object('panel_id', v_panel.id, 'statut_panel', 'ACTIF',
    'arbres', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'role', a.role, 'rang', a.rang) order by a.role desc, a.rang), '[]')
               from public.pheno_arbres a where a.panel_id = v_panel.id));
end $$;

-- D2 · Remplacement d'un arbre suivi : motif, date d'effet, traçabilité. Les observations
-- passées de l'arbre remplacé sont conservées (statut REMPLACE, rien n'est supprimé).
drop function if exists public.pheno_reserve_activer(uuid, text);
create or replace function public.pheno_reserve_activer(p_arbre_remplace uuid, p_motif text, p_date_effet date default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_a public.pheno_arbres; v_panel public.pheno_panels; v_r public.pheno_arbres; v_b public.pheno_blocs; v_effet date := coalesce(p_date_effet, private.pheno_aujourdhui());
begin
  select * into v_a from public.pheno_arbres where id = p_arbre_remplace for update;
  if not found then raise exception 'Arbre introuvable.' using errcode = 'PH002'; end if;
  select * into v_panel from public.pheno_panels where id = v_a.panel_id;
  if not (private.pheno_peut_valider(v_panel.campaign_id, v_panel.cluster_code)
          or (v_panel.mode_selection = 'DESIGNATION' and private.pheno_classe() = 'UH' and v_panel.cluster_code = private.pheno_mon_cluster())) then
    raise exception 'Le remplacement d''un arbre est réservé au Chef d''Unité du cluster ou au valideur agronomique.' using errcode = 'PH001'; end if;
  if coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire.' using errcode = 'PH002'; end if;
  if v_effet > private.pheno_aujourdhui() then raise exception 'La date d''effet ne peut pas être dans le futur.' using errcode = 'PH002'; end if;
  if not (v_a.statut = 'ACTIF' or v_a.statut = 'RESERVE_ACTIVEE') then
    raise exception 'Cet arbre n''est pas un arbre suivi actif.' using errcode = 'PH002'; end if;
  select * into v_r from public.pheno_arbres where panel_id = v_a.panel_id and statut = 'RESERVE_EN_ATTENTE'
    order by (bloc_id = v_a.bloc_id) desc, rang limit 1 for update;
  if not found then raise exception 'Aucune réserve disponible pour ce champ.' using errcode = 'PH002'; end if;
  select * into v_b from public.pheno_blocs where id = v_r.bloc_id;
  update public.pheno_arbres set statut = 'REMPLACE', date_effet = v_effet where id = v_a.id;
  update public.pheno_arbres set statut = 'RESERVE_ACTIVEE', remplace_arbre_id = v_a.id, activation_le = now(), date_effet = v_effet,
    activation_par = auth.uid(), activation_motif = p_motif, proba_approchee = true,
    proba_inclusion = case when v_panel.mode_selection = 'TIRAGE' then coalesce(v_panel.pi_village, 1) * coalesce(v_panel.pi_champ, 1)
      * (v_panel.nb_blocs_tires::numeric / v_panel.nb_blocs_total)
      * (v_b.nb_titulaires_prevus::numeric / nullif(v_b.nb_arbres_inventories, 0)) end
    where id = v_r.id;
  perform private.pheno_journaliser(v_panel.cluster_code, 'ARBRE', v_r.id, 'RESERVE_ACTIVEE',
    jsonb_build_object('arbre_remplace', v_a.code), jsonb_build_object('reserve', v_r.code, 'date_effet', v_effet), p_motif);
  return jsonb_build_object('arbre_remplace', v_a.code, 'reserve_activee', v_r.code, 'reserve_id', v_r.id, 'date_effet', v_effet);
end $$;

-- ---------------------------------------------------------------- décisions (D4)
create or replace function public.pheno_visite_verifier(p_visite uuid, p_version integer default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites;
begin
  v := private.pheno_visite_pour_decision(p_visite, p_version);
  if private.pheno_droit_decision(v) is null then
    raise exception 'Vous n''êtes pas le responsable chargé de vérifier cette visite.' using errcode = 'PH001'; end if;
  if v.statut <> 'SOUMIS' then raise exception 'Seule une visite soumise peut passer en vérification.' using errcode = 'PH002'; end if;
  update public.pheno_visites set statut = 'EN_VERIFICATION', verifie_par = auth.uid(), verifie_le = now(),
    row_version = row_version + 1, updated_at = now() where id = p_visite;
  perform private.pheno_journaliser(v.cluster_code, 'VISITE', p_visite, 'EN_VERIFICATION',
    jsonb_build_object('statut', v.statut), jsonb_build_object('statut', 'EN_VERIFICATION', 'droit', private.pheno_droit_decision(v)), null);
  return jsonb_build_object('visite_id', p_visite, 'statut_visite', 'EN_VERIFICATION', 'row_version', v.row_version + 1);
end $$;

create or replace function public.pheno_visite_demander_correction(p_visite uuid, p_motif text, p_version integer default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites;
begin
  v := private.pheno_visite_pour_decision(p_visite, p_version);
  if private.pheno_droit_decision(v) is null then
    raise exception 'Vous n''êtes pas le responsable chargé de cette visite.' using errcode = 'PH001'; end if;
  if coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire.' using errcode = 'PH002'; end if;
  if v.statut not in ('SOUMIS', 'EN_VERIFICATION') then
    raise exception 'Une correction ne se demande que sur une visite soumise ou en vérification.' using errcode = 'PH002'; end if;
  update public.pheno_visites set statut = 'CORRECTION_DEMANDEE', correction_motif = p_motif,
    row_version = row_version + 1, updated_at = now() where id = p_visite;
  perform private.pheno_journaliser(v.cluster_code, 'VISITE', p_visite, 'CORRECTION_DEMANDEE',
    jsonb_build_object('statut', v.statut), jsonb_build_object('statut', 'CORRECTION_DEMANDEE', 'droit', private.pheno_droit_decision(v)), p_motif);
  return jsonb_build_object('visite_id', p_visite, 'statut_visite', 'CORRECTION_DEMANDEE', 'row_version', v.row_version + 1);
end $$;

drop function if exists public.pheno_visite_valider(uuid, integer);
create or replace function public.pheno_visite_valider(p_visite uuid, p_version integer default null, p_justification text default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v public.pheno_visites; v_droit text; v_pr jsonb; v_justif text := nullif(btrim(p_justification), '');
begin
  v := private.pheno_visite_pour_decision(p_visite, p_version);
  v_droit := private.pheno_droit_decision(v);
  if v_droit is null then
    raise exception 'Vous n''êtes pas le validateur de cette visite (Chef d''Unité pour un Assistant, Chef de Zone pour un Chef d''Unité).' using errcode = 'PH001'; end if;
  if v.statut not in ('SOUMIS', 'EN_VERIFICATION') then
    raise exception 'Seule une visite soumise ou en vérification peut être validée.' using errcode = 'PH002'; end if;
  perform private.pheno_visite_controler(p_visite);
  v_pr := private.pheno_preuves_visite(p_visite);
  if v_droit = 'EXCEPTIONNEL' and v_justif is null then
    raise exception 'Validation exceptionnelle par le Branch Manager : la justification est obligatoire.' using errcode = 'PH002'; end if;
  if (v_pr->>'exceptions')::integer > 0 and v_justif is null then
    raise exception 'Cette visite comporte % exception(s) de photo : justifiez la validation.', v_pr->>'exceptions' using errcode = 'PH002'; end if;
  if v.temporalite <> 'NORMALE' and v_justif is null then
    raise exception 'Visite saisie après coup (%) : justifiez la validation après contrôle.', lower(v.temporalite) using errcode = 'PH002'; end if;
  update public.pheno_visites set statut = 'VALIDE', valide_par = auth.uid(), valide_le = now(),
    validation_exceptionnelle = (v_droit = 'EXCEPTIONNEL'), validation_justification = v_justif,
    row_version = row_version + 1, updated_at = now() where id = p_visite;
  perform private.pheno_journaliser(v.cluster_code, 'VISITE', p_visite, case when v_droit = 'EXCEPTIONNEL' then 'VALIDEE_EXCEPTION' else 'VALIDEE' end,
    jsonb_build_object('statut', v.statut), jsonb_build_object('statut', 'VALIDE', 'droit', v_droit, 'preuves', v_pr), v_justif);
  perform private.pheno_recalculer_evenements(v.panel_id);
  return jsonb_build_object('visite_id', p_visite, 'statut_visite', 'VALIDE', 'row_version', v.row_version + 1, 'droit', v_droit);
end $$;

-- Correction décidée : photo_exception devient corrigeable.
create or replace function public.pheno_correction_decider(p_correction uuid, p_decision text, p_motif text) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare c public.pheno_corrections; v public.pheno_visites; v_obs public.pheno_observations;
begin
  select * into c from public.pheno_corrections where id = p_correction for update;
  if not found then raise exception 'Proposition introuvable.' using errcode = 'PH002'; end if;
  select * into v from public.pheno_visites where id = c.visite_id for update;
  if not (private.pheno_peut_valider(v.campaign_id, v.cluster_code) or private.pheno_droit_decision(v) is not null) then
    raise exception 'Décision réservée au validateur de la visite.' using errcode = 'PH001'; end if;
  if auth.uid() = c.proposee_par or auth.uid() in (v.observateur_id, coalesce(v.transcripteur_id, v.observateur_id)) then
    raise exception 'On ne décide pas de sa propre proposition ni sur sa propre visite.' using errcode = 'PH001'; end if;
  if c.statut <> 'PROPOSEE' then raise exception 'Proposition déjà traitée.' using errcode = 'PH002'; end if;
  if p_decision not in ('APPLIQUEE', 'REJETEE') then raise exception 'Décision invalide.' using errcode = 'PH002'; end if;
  if coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire.' using errcode = 'PH002'; end if;
  if p_decision = 'APPLIQUEE' then
    if c.champ not in ('retrouve', 'f', 'n', 'p', 'pas_vu_motif', 'chute', 'chute_preuve', 'anomalie', 'photo_ref', 'photo_exception') then
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
      photo_exception = case when c.champ = 'photo_exception' then c.nouvelle_valeur else photo_exception end,
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

-- ---------------------------------------------------------------- synchronisation
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
    v_hash := private.pheno_hex(jsonb_build_object('type', v_op->'type', 'payload', coalesce(v_op->'payload', '{}'::jsonb),
      'device_id', v_op->'device_id', 'created_at_client', v_op->'created_at_client')::text);
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
        when 'ARBRES_DESIGNER' then v_res := jsonb_build_object('statut', 'ACCEPTEE') || public.pheno_arbres_designer(v_payload);
        when 'ARBRE_MARQUER' then v_res := jsonb_build_object('statut', 'ACCEPTEE') || public.pheno_arbre_marquer(v_payload);
        when 'VISITE_ENREGISTRER' then v_res := private.pheno_visite_enregistrer(v_payload);
        else raise exception 'Type d''opération inconnu : %.', v_op->>'type' using errcode = 'PH002';
      end case;
    exception
      when sqlstate 'PH409' then v_res := jsonb_build_object('statut', 'CONFLIT', 'code', 'PH409', 'message', sqlerrm);
      when sqlstate 'PH001' then v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'PH001', 'message', sqlerrm);
      when sqlstate 'PH002' then v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'PH002', 'message', sqlerrm);
      when others then
        v_diag := substr(private.pheno_hex(gen_random_uuid()::text), 1, 10);
        insert into public.pheno_journal (acteur, cluster_code, entite, entite_id, action, nouvelle)
        values (auth.uid(), null, 'SYNCHRO', null, 'ERREUR_TECHNIQUE', jsonb_build_object('diagnostic', v_diag, 'sqlstate', sqlstate, 'detail', sqlerrm, 'type', v_op->>'type'));
        v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'TECHNIQUE', 'diagnostic', v_diag,
          'message', 'Opération refusée par le serveur (erreur technique). Communiquez le code ' || v_diag || ' à votre Chef d''Unité.');
    end;
    v_res := v_res || jsonb_build_object('idempotency_key', v_cle, 'recu_serveur_le', coalesce(v_res->'recu_serveur_le', to_jsonb(now())));
    if v_res->>'statut' in ('ACCEPTEE', 'CONFLIT') then
      insert into private.pheno_sync_recus (idempotency_key, user_id, request_hash, resultat)
      values (v_cle, auth.uid(), v_hash, v_res) on conflict (idempotency_key) do nothing;
    end if;
    v_out := v_out || v_res;
  end loop;
  return jsonb_build_object('resultats', v_out, 'serveur_le', now());
end $$;

-- ---------------------------------------------------------------- registre (D3)
drop function if exists public.pheno_parcelles_disponibles(uuid);
create or replace function public.pheno_parcelles_disponibles(p_campaign uuid) returns table (
  plot_id uuid, producteur_id text, producteur_nom text, producteur_code text, village_id text, village_nom text,
  cluster_code text, parcelle_nom text, arbres_declares integer, deja_installee boolean,
  producteur_prenoms text, gps_releve boolean, eligible boolean, manques text[])
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select fp.id, fp.producteur_id, pr.nom, pr.code, fp.village_id, v.village,
    public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')) as cl,
    fp.local_name, fp.tree_count,
    exists (select 1 from public.pheno_panels pp where pp.campaign_id = p_campaign and pp.plot_id = fp.id),
    pr.prenoms, (fp.latitude is not null and fp.longitude is not null and fp.gps_status = 'POINT_CAPTURED'),
    cardinality(private.pheno_parcelle_manques(fp.id)) = 0, private.pheno_parcelle_manques(fp.id)
  from public.farmer_plots fp
  join public.villages v on v.id = fp.village_id
  join public.producteurs pr on pr.id = fp.producteur_id
  where not fp.deleted and coalesce(fp.status, 'ACTIVE') = 'ACTIVE' and not coalesce(pr.deleted, false)
    and private.pheno_peut_collecter(public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')))
  order by pr.nom, pr.prenoms, fp.local_name
$$;

-- ---------------------------------------------------------------- validation : liste lisible (D4)
create or replace function public.pheno_visites_a_traiter(p_campaign uuid) returns table (
  visite_id uuid, panel_id uuid, cluster_code text, village text, producteur text, parcelle text, observateur text, role_observateur text,
  semaine_iso text, date_observation date, recu_serveur_le timestamptz, statut text, mode_saisie text, temporalite text,
  photos_attendues integer, photos_recues integer, photos_exceptions integer, droit text, row_version integer)
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select v.id, v.panel_id, v.cluster_code, vi.village, btrim(coalesce(pr.nom, '') || ' ' || coalesce(pr.prenoms, '')), fp.local_name,
    po.nom, po.role, v.semaine_iso, v.date_observation, v.recu_serveur_le, v.statut, v.mode_saisie, v.temporalite,
    (pv->>'attendues')::integer, (pv->>'recues')::integer, (pv->>'exceptions')::integer, private.pheno_droit_decision(v), v.row_version
  from public.pheno_visites v
  join public.pheno_panels p on p.id = v.panel_id
  left join public.farmer_plots fp on fp.id = p.plot_id
  left join public.producteurs pr on pr.id = p.producteur_id
  left join public.villages vi on vi.id = p.village_id
  left join public.profils po on po.user_id = v.observateur_id
  cross join lateral (select private.pheno_preuves_visite(v.id) as pv) x
  where v.campaign_id = p_campaign and v.statut in ('SOUMIS', 'EN_VERIFICATION', 'CORRECTION_DEMANDEE')
    and private.pheno_peut_lire_cluster(v.cluster_code)
  order by (private.pheno_droit_decision(v) = 'ORDINAIRE') desc nulls last, v.date_observation
$$;

-- ---------------------------------------------------------------- six clusters (D1, §8)
-- Préparation par cluster : uniquement des faits observés dans la base. Aucun « taux » inventé.
create or replace function public.pheno_preparation_clusters(p_campaign uuid) returns table (
  cluster_code text, zone_code text, parcelles_registre integer, parcelles_eligibles integer, parcelles_installees integer,
  champs_actifs integer, chefs_unite integer, assistants integer, chef_zone integer, validateur_disponible boolean, statut text, motifs text[])
language plpgsql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
begin
  if private.pheno_classe() not in ('BM', 'ABM', 'ZH') then raise exception 'Réservé au pilotage (Branch Manager, Chef de Zone).' using errcode = 'PH001'; end if;
  return query
  with reg as (
    select public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')) as cl,
      count(*)::integer as n, count(*) filter (where cardinality(private.pheno_parcelle_manques(fp.id)) = 0)::integer as ok
    from public.farmer_plots fp join public.villages v on v.id = fp.village_id
    where not fp.deleted and coalesce(fp.status, 'ACTIVE') = 'ACTIVE' group by 1
  ), pan as (
    select pp.cluster_code as cl, count(*)::integer as n, count(*) filter (where pp.statut = 'ACTIF')::integer as actifs
    from public.pheno_panels pp where pp.campaign_id = p_campaign group by 1
  ), pers as (
    select public.aflp_cluster_code(pr.cluster) as cl, count(*) filter (where pr.role = 'Unit Head')::integer as uh,
      count(*) filter (where pr.role = 'Assistant Unit Head')::integer as auh
    from public.profils pr where pr.actif group by 1
  ), zh as (
    select z.code as zone, count(*)::integer as n from public.profils pr join public.aflp_zones z
      on public.aflp_norm(z.code) = public.aflp_norm(pr.zone) or public.aflp_norm(z.label) = public.aflp_norm(pr.zone)
    where pr.actif and pr.role = 'Zonal Head' group by 1
  )
  select c.code, c.zone_code, coalesce(reg.n, 0), coalesce(reg.ok, 0), coalesce(pan.n, 0), coalesce(pan.actifs, 0),
    coalesce(pers.uh, 0), coalesce(pers.auh, 0), coalesce(zh.n, 0),
    (coalesce(pers.uh, 0) > 0 and coalesce(zh.n, 0) > 0),
    case when coalesce(reg.ok, 0) = 0 or coalesce(pers.uh, 0) + coalesce(pers.auh, 0) = 0 then 'NON_PRET'
         when coalesce(pers.uh, 0) = 0 or coalesce(zh.n, 0) = 0 then 'PARTIEL'
         else 'PRET_TECHNIQUE' end,
    array_remove(array[
      case when coalesce(reg.ok, 0) = 0 then 'aucune parcelle complète dans le registre' end,
      case when coalesce(pers.uh, 0) + coalesce(pers.auh, 0) = 0 then 'aucun agent habilité (Chef d''Unité ou Assistant)' end,
      case when coalesce(pers.uh, 0) = 0 then 'pas de Chef d''Unité : visites des Assistants sans validateur ordinaire' end,
      case when coalesce(zh.n, 0) = 0 then 'pas de Chef de Zone : visites des Chefs d''Unité sans validateur ordinaire' end], null)
  from public.aflp_clusters c
  left join reg on reg.cl = c.code left join pan on pan.cl = c.code left join pers on pers.cl = c.code left join zh on zh.zone = c.zone_code
  where private.pheno_peut_lire_cluster(c.code)
  order by c.zone_code, c.code;
end $$;

-- Supervision Branch Manager : ce que le SERVEUR sait. Une visite restée sur un téléphone
-- déconnecté n'est pas connue du serveur et n'apparaît pas ici (aucun chiffre fabriqué).
create or replace view public.pheno_v_supervision with (security_invoker = true) as
select p.campaign_id, p.cluster_code,
  count(distinct p.id) filter (where p.statut = 'ACTIF') as champs_actifs,
  count(distinct p.id) filter (where p.statut = 'TIRAGE_VERROUILLE') as champs_en_preparation,
  count(distinct p.id) filter (where p.statut = 'ACTIF' and not exists (select 1 from public.pheno_visites v2 where v2.panel_id = p.id
     and v2.semaine_iso = to_char((now() at time zone 'Africa/Abidjan')::date, 'IYYY"-W"IW') and v2.statut <> 'BROUILLON')) as visites_semaine_manquantes,
  count(v.id) filter (where v.statut = 'SOUMIS') as soumises,
  count(v.id) filter (where v.statut = 'EN_VERIFICATION') as en_verification,
  count(v.id) filter (where v.statut = 'CORRECTION_DEMANDEE') as corrections_demandees,
  count(v.id) filter (where v.statut = 'VALIDE') as validees,
  count(v.id) filter (where v.statut in ('SOUMIS', 'EN_VERIFICATION') and v.soumis_le < now() - interval '72 hours') as validations_bloquees_72h,
  count(v.id) filter (where v.temporalite <> 'NORMALE') as anomalies_temporelles,
  count(v.id) filter (where v.validation_exceptionnelle) as validations_exceptionnelles,
  (select count(*) from public.pheno_arbres a join public.pheno_panels p3 on p3.id = a.panel_id
     where p3.campaign_id = p.campaign_id and p3.cluster_code = p.cluster_code and a.statut = 'RESERVE_ACTIVEE') as remplacements_arbres,
  (select count(*) filter (where o.retrouve) from public.pheno_observations o join public.pheno_visites v3 on v3.id = o.visite_id
     where v3.campaign_id = p.campaign_id and v3.cluster_code = p.cluster_code and v3.statut <> 'BROUILLON') as photos_attendues,
  (select count(*) from public.pheno_observations o join public.pheno_visites v3 on v3.id = o.visite_id
     where v3.campaign_id = p.campaign_id and v3.cluster_code = p.cluster_code and v3.statut <> 'BROUILLON' and o.retrouve
       and exists (select 1 from storage.objects so where so.bucket_id = 'pheno-preuves' and so.name = o.photo_ref)) as photos_recues,
  (select count(*) from public.pheno_observations o join public.pheno_visites v3 on v3.id = o.visite_id
     where v3.campaign_id = p.campaign_id and v3.cluster_code = p.cluster_code and v3.statut <> 'BROUILLON' and coalesce(btrim(o.photo_exception), '') <> '') as exceptions_photo,
  (select count(*) from public.pheno_observations o join public.pheno_visites v3 on v3.id = o.visite_id
     where v3.campaign_id = p.campaign_id and v3.cluster_code = p.cluster_code and v3.statut <> 'BROUILLON' and o.retrouve is false) as arbres_introuvables,
  'SERVEUR_UNIQUEMENT'::text as perimetre
from public.pheno_panels p
left join public.pheno_visites v on v.panel_id = p.id
group by p.campaign_id, p.cluster_code;

-- Vues pilotes : seules les visites à la date NORMALE entrent dans les indicateurs ordinaires (D6).
create or replace view public.pheno_v_champ_semaine with (security_invoker = true) as
select v.campaign_id, v.cluster_code, v.panel_id, v.id as visite_id, v.semaine_iso, v.date_observation,
  count(o.id) filter (where a.role = 'TITULAIRE') as arbres_observes,
  count(*) filter (where a.role = 'RESERVE') as reserves_activees_observees,
  count(*) filter (where a.role = 'TITULAIRE' and o.retrouve is false) as arbres_non_retrouves,
  count(*) filter (where a.role = 'TITULAIRE' and 'PAS_VU' in (o.f, o.n, o.p, o.chute)) as arbres_avec_pas_vu,
  round(sum(w.poids) filter (where a.role = 'TITULAIRE' and (o.retrouve is not true or o.f = 'PAS_VU')) / nullif(sum(w.poids) filter (where a.role = 'TITULAIRE'), 0), 4) as non_reponse_f,
  round(sum(w.poids) filter (where a.role = 'TITULAIRE' and (o.retrouve is not true or o.chute in ('PAS_VU', 'NON_CONFIRME'))) / nullif(sum(w.poids) filter (where a.role = 'TITULAIRE'), 0), 4) as non_reponse_c,
  round(sum(w.poids) filter (where a.role = 'TITULAIRE' and o.f = 'OUI') / nullif(sum(w.poids) filter (where a.role = 'TITULAIRE' and o.f in ('OUI', 'NON')), 0), 4) as part_f,
  round(sum(w.poids) filter (where a.role = 'TITULAIRE' and o.n = 'OUI') / nullif(sum(w.poids) filter (where a.role = 'TITULAIRE' and o.n in ('OUI', 'NON')), 0), 4) as part_n,
  round(sum(w.poids) filter (where a.role = 'TITULAIRE' and o.p = 'OUI') / nullif(sum(w.poids) filter (where a.role = 'TITULAIRE' and o.p in ('OUI', 'NON')), 0), 4) as part_p,
  round(sum(w.poids) filter (where a.role = 'TITULAIRE' and o.chute = 'MURE')
    / nullif(sum(w.poids) filter (where a.role = 'TITULAIRE' and o.chute in ('MURE', 'PREMATUREE', 'ABSENCE')), 0), 4) as part_c_hebdo,
  count(*) filter (where a.role = 'TITULAIRE' and o.chute = 'PREMATUREE') as chutes_prematurees,
  count(*) filter (where a.role = 'TITULAIRE' and o.chute = 'NON_CONFIRME') as chutes_non_confirmees,
  count(*) filter (where a.role = 'TITULAIRE' and o.chute = 'MURE' and o.chute_preuve = 'DECLAREE_PRODUCTEUR') as c_declarees_producteur,
  'PILOTE_NON_OFFICIEL'::text as nature
from public.pheno_visites v
join public.pheno_observations o on o.visite_id = v.id
join public.pheno_arbres a on a.id = o.arbre_id
cross join lateral (select 1 / coalesce(a.proba_inclusion, 1) as poids) w
where v.statut = 'VALIDE' and v.temporalite = 'NORMALE'
group by v.campaign_id, v.cluster_code, v.panel_id, v.id, v.semaine_iso, v.date_observation;

create or replace view public.pheno_v_c_cumulatif with (security_invoker = true) as
select v.campaign_id, v.cluster_code, v.panel_id, v.semaine_iso, v.date_observation,
  t.poids_total, t.arbres_suivis,
  coalesce(c.arbres_c, 0) as arbres_c_cumules,
  coalesce(c.poids_c, 0) as poids_c,
  round(coalesce(c.poids_c, 0) / nullif(t.poids_total, 0), 4) as part_c_cumulatif,
  (p.mode_selection = 'TIRAGE' and p.pi_village is not null and p.pi_champ is not null) as ponderation_complete,
  'PILOTE_NON_OFFICIEL'::text as nature,
  p.mode_selection
from public.pheno_visites v
join public.pheno_panels p on p.id = v.panel_id
cross join lateral (
  select sum(1 / coalesce(a.proba_inclusion, 1)) as poids_total, count(*) as arbres_suivis
  from public.pheno_arbres a where a.panel_id = v.panel_id and a.role = 'TITULAIRE' and a.statut = 'ACTIF') t
left join lateral (
  select sum(1 / coalesce(a.proba_inclusion, 1)) as poids_c, count(*) as arbres_c
  from public.pheno_arbres a
  where a.panel_id = v.panel_id and a.role = 'TITULAIRE' and a.statut = 'ACTIF'
    and exists (select 1 from public.pheno_observations o join public.pheno_visites v2 on v2.id = o.visite_id
                where o.arbre_id = a.id and o.chute = 'MURE' and v2.statut = 'VALIDE' and v2.temporalite = 'NORMALE' and v2.date_observation <= v.date_observation)) c on true
where v.statut = 'VALIDE' and v.temporalite = 'NORMALE';

create or replace view public.pheno_v_c_cumulatif_cluster with (security_invoker = true) as
with champs as (
  select campaign_id, cluster_code, count(*) filter (where statut = 'ACTIF') as champs_actifs,
    count(*) filter (where statut = 'INCOMPATIBLE') as champs_incompatibles,
    count(*) filter (where statut = 'TIRAGE_VERROUILLE') as champs_en_installation
  from public.pheno_panels group by 1, 2
), sem as (
  select campaign_id, cluster_code, semaine_iso, count(*) as champs_valides,
    round(sum(poids_c) / nullif(sum(poids_total), 0), 4) as part_c_cumulatif_ratio,
    bool_and(ponderation_complete) as ponderation_complete, bool_or(mode_selection = 'DESIGNATION') as designes
  from public.pheno_v_c_cumulatif group by 1, 2, 3
)
select s.campaign_id, s.cluster_code, s.semaine_iso, c.champs_actifs, c.champs_incompatibles, c.champs_en_installation, s.champs_valides,
  round(s.champs_valides::numeric / nullif(c.champs_actifs, 0), 4) as couverture,
  s.part_c_cumulatif_ratio,
  case when s.designes then 'SUIVI_ARBRES_DESIGNES' when s.ponderation_complete then 'PLAN_COMPLET' else 'DESCRIPTIF_INTRA_CHAMP' end as type_estimation,
  case when not s.ponderation_complete then 'DESCRIPTIF_SANS_PALIER'
       when s.champs_valides::numeric / nullif(c.champs_actifs, 0) < 0.75 then 'COUVERTURE_INSUFFISANTE'
       when s.part_c_cumulatif_ratio >= 0.30 then 'PREALERTE_30'
       when s.part_c_cumulatif_ratio >= 0.20 then 'PREALERTE_20'
       when s.part_c_cumulatif_ratio >= 0.10 then 'PREALERTE_10'
       else 'AUCUN' end as palier_experimental,
  'PILOTE_NON_OFFICIEL'::text as nature
from sem s join champs c using (campaign_id, cluster_code);

create or replace view public.pheno_v_qualite with (security_invoker = true) as
select v.campaign_id, v.cluster_code, v.semaine_iso,
  (select count(*) from public.pheno_panels p where p.campaign_id = v.campaign_id and p.cluster_code = v.cluster_code and p.statut = 'ACTIF') as champs_actifs,
  count(*) as visites,
  count(*) filter (where v.statut = 'BROUILLON') as brouillons,
  count(*) filter (where v.statut = 'SOUMIS') as soumises,
  count(*) filter (where v.statut = 'EN_VERIFICATION') as en_verification,
  count(*) filter (where v.statut = 'CORRECTION_DEMANDEE') as corrections_demandees,
  count(*) filter (where v.statut = 'VALIDE') as validees,
  count(*) filter (where v.mode_saisie = 'TRANSCRIPTION_PAPIER') as transcriptions_papier,
  count(*) filter (where v.saisie_le is not null and v.recu_serveur_le - v.saisie_le > interval '48 hours') as recues_apres_48h,
  count(*) filter (where v.saisie_le::date > v.date_observation) as saisies_apres_le_jour,
  (select count(*) from public.pheno_observations o join public.pheno_visites v3 on v3.id = o.visite_id
     where v3.campaign_id = v.campaign_id and v3.cluster_code = v.cluster_code and v3.semaine_iso = v.semaine_iso and v3.temporalite = 'NORMALE' and o.retrouve is false) as arbres_non_retrouves,
  (select count(*) from public.pheno_observations o join public.pheno_visites v3 on v3.id = o.visite_id
     where v3.campaign_id = v.campaign_id and v3.cluster_code = v.cluster_code and v3.semaine_iso = v.semaine_iso and v3.temporalite = 'NORMALE' and 'PAS_VU' in (o.f, o.n, o.p, o.chute)) as arbres_avec_pas_vu,
  (select count(*) from public.pheno_corrections c join public.pheno_visites v3 on v3.id = c.visite_id
     where v3.campaign_id = v.campaign_id and v3.cluster_code = v.cluster_code and v3.semaine_iso = v.semaine_iso and c.statut = 'PROPOSEE') as corrections_en_attente,
  count(*) filter (where v.temporalite = 'RETROSPECTIVE') as visites_retrospectives
from public.pheno_visites v
where v.temporalite <> 'INCOHERENTE'
group by v.campaign_id, v.cluster_code, v.semaine_iso;

-- Revue des dates incohérentes (classées, jamais supprimées).
create or replace view public.pheno_v_anomalies_temporelles with (security_invoker = true) as
select v.id as visite_id, v.campaign_id, v.cluster_code, v.panel_id, v.date_observation, v.semaine_iso, v.saisie_le, v.recu_serveur_le,
  v.statut, v.temporalite, v.justification_retro, v.observateur_id, v.device_id
from public.pheno_visites v where v.temporalite <> 'NORMALE';

-- ---------------------------------------------------------------- droits
revoke all on function private.pheno_aujourdhui(), private.pheno_code_arbre(integer, integer), private.pheno_parcelle_manques(uuid),
  private.pheno_droit_decision(public.pheno_visites), private.pheno_preuves_visite(uuid) from public, anon, authenticated;
revoke all on function public.pheno_arbres_designer(jsonb), public.pheno_reserve_activer(uuid, text, date),
  public.pheno_visite_valider(uuid, integer, text), public.pheno_parcelles_disponibles(uuid),
  public.pheno_visites_a_traiter(uuid), public.pheno_preparation_clusters(uuid) from public, anon;
grant execute on function public.pheno_arbres_designer(jsonb), public.pheno_reserve_activer(uuid, text, date),
  public.pheno_visite_valider(uuid, integer, text), public.pheno_parcelles_disponibles(uuid),
  public.pheno_visites_a_traiter(uuid), public.pheno_preparation_clusters(uuid) to authenticated;
revoke all on public.pheno_v_supervision, public.pheno_v_anomalies_temporelles from anon;
grant select on public.pheno_v_supervision, public.pheno_v_anomalies_temporelles,
  public.pheno_v_champ_semaine, public.pheno_v_c_cumulatif, public.pheno_v_c_cumulatif_cluster, public.pheno_v_qualite to authenticated;

commit;
