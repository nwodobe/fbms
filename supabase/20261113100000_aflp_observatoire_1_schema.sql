-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 (pilote) — migration 1/4 : SCHÉMA
-- ---------------------------------------------------------------------
-- STATUT : NON APPLIQUÉE EN PRODUCTION. Testée uniquement sur la réplique
--          locale (tests/observatoire/executer_tests_observatoire.sh).
--          Application en production = décision explicite du Branch Manager.
-- PRINCIPES
--   * Strictement ADDITIVE : aucune table, colonne, fonction ou politique
--     existante n'est modifiée ni supprimée. farmer_visits n'est pas touchée.
--   * Domaine dédié « pheno_ » relié à farmer_plots, campaigns, aflp_clusters.
--   * RLS activée sans politique dans ce fichier : tout est refusé par
--     défaut tant que la migration 2 (sécurité) n'est pas appliquée.
--   * Aucune écriture directe : les écritures passent par les RPC SECURITY
--     DEFINER de la migration 3.
--   * Collecte PILOTE (spécification V2.1, E2.4) : aucun indicateur officiel.
-- ORDRE : 1 schéma -> 2 sécurité -> 3 RPC/synchronisation -> 4 vues pilote.
-- RETOUR ARRIÈRE : supabase/20261113100400_aflp_observatoire_rollback.sql
-- REJOUABLE : oui (if not exists partout).
-- =====================================================================
begin;

create schema if not exists private;

-- 1. Version de protocole ------------------------------------------------
create table if not exists public.pheno_protocoles (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version text not null,
  statut text not null default 'PILOTE' check (statut in ('PILOTE','ARCHIVE')),
  actif boolean not null default true,
  parametres jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (code, version)
);
insert into public.pheno_protocoles (code, version, parametres)
values ('AFLP2027-OBS', 'v0.9', jsonb_build_object(
  'titulaires', 10, 'reserves', 2,
  'algorithme_tirage', 'sha256(graine:numero) croissant',
  'seuils_experimentaux_c_cumulatif', jsonb_build_array(10, 20, 30),
  'couverture_min_prealerte', 0.75,
  'delai_maturite', 'hypothèse non calibrée, aucune prévision en 2027'))
on conflict (code, version) do nothing;

-- 2. Panel : un champ observé pour une campagne ----------------------------
create table if not exists public.pheno_panels (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  protocole_id uuid not null references public.pheno_protocoles(id),
  plot_id uuid not null references public.farmer_plots(id),
  producteur_id text not null,
  village_id text not null,
  cluster_code text not null references public.aflp_clusters(code),
  statut text not null default 'TIRAGE_VERROUILLE'
    check (statut in ('TIRAGE_VERROUILLE','ACTIF','INCOMPATIBLE','SUSPENDU','RETIRE')),
  nb_blocs_total integer not null check (nb_blocs_total between 1 and 60),
  nb_blocs_tires integer not null check (nb_blocs_tires >= 1),
  b_fixe_le timestamptz not null default now(),
  tirage_graine text not null,
  tirage_le timestamptz not null default now(),
  tirage_par uuid not null,
  tirage_verrouille boolean not null default true,
  pi_village numeric check (pi_village is null or (pi_village > 0 and pi_village <= 1)),
  pi_champ numeric check (pi_champ is null or (pi_champ > 0 and pi_champ <= 1)),
  incompatibilite text,
  reserves_manquantes integer not null default 0,
  device_id text,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  check (nb_blocs_tires <= nb_blocs_total),
  unique (campaign_id, plot_id)
);
create index if not exists pheno_panels_cluster_idx on public.pheno_panels (campaign_id, cluster_code);

-- 3. Blocs disjoints (repères physiques) ------------------------------------
create table if not exists public.pheno_blocs (
  id uuid primary key,
  panel_id uuid not null references public.pheno_panels(id) on delete cascade,
  numero integer not null check (numero >= 1),
  repere text not null check (btrim(repere) <> ''),
  latitude numeric, longitude numeric,
  tire boolean not null default false,
  rang_tirage integer,
  nb_titulaires_prevus integer not null default 0,
  nb_reserves_prevues integer not null default 0,
  nb_arbres_inventories integer check (nb_arbres_inventories is null or nb_arbres_inventories between 0 and 2000),
  inventaire_le timestamptz, inventaire_par uuid,
  incompatible boolean not null default false,
  unique (panel_id, numero)
);

-- 4. Arbres marqués (titulaires et réserves), identifiant permanent --------
create table if not exists public.pheno_arbres (
  id uuid primary key,
  panel_id uuid not null references public.pheno_panels(id) on delete cascade,
  bloc_id uuid not null references public.pheno_blocs(id) on delete cascade,
  code text not null,
  numero_inventaire integer not null check (numero_inventaire >= 1),
  role text not null check (role in ('TITULAIRE','RESERVE')),
  rang integer not null,
  statut text not null check (statut in ('ACTIF','REMPLACE','RESERVE_EN_ATTENTE','RESERVE_ACTIVEE')),
  proba_inclusion numeric check (proba_inclusion is null or (proba_inclusion > 0 and proba_inclusion <= 1)),
  proba_approchee boolean not null default false,
  latitude numeric, longitude numeric, gps_precision_m numeric,
  preuve_ref text, marque_le timestamptz, marque_par uuid,
  remplace_arbre_id uuid references public.pheno_arbres(id),
  activation_le timestamptz, activation_par uuid, activation_motif text,
  created_at timestamptz not null default now(),
  unique (panel_id, code),
  unique (bloc_id, numero_inventaire)
);
create index if not exists pheno_arbres_panel_idx on public.pheno_arbres (panel_id);

-- 5. Affectations agronomiques (droits propres à l'Observatoire) -----------
create table if not exists public.pheno_affectations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  user_id uuid not null,
  cluster_codes text[] not null check (cardinality(cluster_codes) >= 1),
  droit text not null check (droit in ('VERIFICATION','VALIDATION')),
  valide_du date not null default current_date,
  valide_au date,
  actif boolean not null default true,
  motif text,
  accorde_par uuid not null,
  created_at timestamptz not null default now(),
  revoque_le timestamptz, revoque_par uuid,
  check (valide_au is null or valide_au >= valide_du)
);
create index if not exists pheno_affectations_user_idx on public.pheno_affectations (user_id, campaign_id) where actif;

-- 6. Visites hebdomadaires -------------------------------------------------
create table if not exists public.pheno_visites (
  id uuid primary key,
  panel_id uuid not null references public.pheno_panels(id),
  campaign_id uuid not null references public.campaigns(id),
  cluster_code text not null,
  semaine_iso text not null check (semaine_iso ~ '^[0-9]{4}-W[0-9]{2}$'),
  date_observation date not null,
  saisie_le timestamptz,
  recu_serveur_le timestamptz not null default now(),
  observateur_id uuid not null,
  transcripteur_id uuid,
  mode_saisie text not null default 'DIRECT' check (mode_saisie in ('DIRECT','TRANSCRIPTION_PAPIER')),
  statut text not null default 'BROUILLON'
    check (statut in ('BROUILLON','SOUMIS','EN_VERIFICATION','VALIDE','CORRECTION_DEMANDEE')),
  ramassage text check (ramassage in ('OUI','NON','NE_SAIT_PAS')),
  anomalies text,
  latitude numeric, longitude numeric,
  device_id text,
  soumis_le timestamptz,
  verifie_par uuid, verifie_le timestamptz,
  valide_par uuid, valide_le timestamptz,
  correction_motif text,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mode_saisie = 'DIRECT' or (transcripteur_id is not null and transcripteur_id <> observateur_id)),
  unique (panel_id, semaine_iso)
);
create index if not exists pheno_visites_cluster_idx on public.pheno_visites (campaign_id, cluster_code, statut);

-- 7. Observations par arbre. NULL = non renseigné (jamais de « Non » par défaut)
create table if not exists public.pheno_observations (
  id uuid primary key default gen_random_uuid(),
  visite_id uuid not null references public.pheno_visites(id) on delete cascade,
  arbre_id uuid not null references public.pheno_arbres(id),
  retrouve boolean,
  f text check (f in ('OUI','NON','PAS_VU')),
  n text check (n in ('OUI','NON','PAS_VU')),
  p text check (p in ('OUI','NON','PAS_VU')),
  pas_vu_motif text,
  chute text check (chute in ('MURE','PREMATUREE','NON_CONFIRME','ABSENCE','PAS_VU')),
  chute_preuve text check (chute_preuve in ('VUE_AGENT','DECLAREE_PRODUCTEUR')),
  anomalie text,
  photo_ref text,
  updated_at timestamptz not null default now(),
  unique (visite_id, arbre_id)
);

-- 8. Corrections (demandes, propositions issues d'un conflit hors ligne) ----
create table if not exists public.pheno_corrections (
  id uuid primary key default gen_random_uuid(),
  visite_id uuid not null references public.pheno_visites(id),
  arbre_id uuid references public.pheno_arbres(id),
  champ text not null,
  ancienne_valeur text,
  nouvelle_valeur text,
  motif text,
  origine text not null check (origine in ('CONFLIT_HORS_LIGNE','AUTEUR')),
  statut text not null default 'PROPOSEE' check (statut in ('PROPOSEE','APPLIQUEE','REJETEE')),
  proposee_par uuid not null,
  proposee_le timestamptz not null default now(),
  decidee_par uuid, decidee_le timestamptz, decision_motif text
);
create unique index if not exists pheno_corrections_dedoublonnage
  on public.pheno_corrections (visite_id, coalesce(arbre_id, '00000000-0000-0000-0000-000000000000'::uuid), champ, coalesce(nouvelle_valeur, ''))
  where statut = 'PROPOSEE';

-- 9. Événements de maturité : INTERVALLES d'observation, jamais des dates biologiques
create table if not exists public.pheno_evenements_maturite (
  arbre_id uuid not null references public.pheno_arbres(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id),
  panel_id uuid not null references public.pheno_panels(id) on delete cascade,
  stade text not null check (stade in ('F','N','P','C')),
  derniere_visite_negative date,
  premiere_visite_positive date not null,
  visite_id uuid not null references public.pheno_visites(id),
  preuve text,
  calcule_le timestamptz not null default now(),
  primary key (arbre_id, campaign_id, stade)
);

-- 10. Journal immuable ------------------------------------------------------
create table if not exists public.pheno_journal (
  id bigint generated always as identity primary key,
  le timestamptz not null default now(),
  acteur uuid,
  cluster_code text,
  entite text not null,
  entite_id uuid,
  action text not null,
  ancienne jsonb,
  nouvelle jsonb,
  motif text
);
create index if not exists pheno_journal_entite_idx on public.pheno_journal (entite, entite_id);

create or replace function private.pheno_journal_immuable() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  raise exception 'Le journal de l''Observatoire est immuable.' using errcode = 'PH001';
end $$;
revoke all on function private.pheno_journal_immuable() from public, anon, authenticated;
drop trigger if exists pheno_journal_immuable on public.pheno_journal;
create trigger pheno_journal_immuable before update or delete on public.pheno_journal
  for each row execute function private.pheno_journal_immuable();

-- 11. Accusés de réception de synchronisation (idempotence) -----------------
create table if not exists private.pheno_sync_recus (
  idempotency_key text primary key,
  user_id uuid not null,
  request_hash text not null,
  resultat jsonb not null,
  recu_le timestamptz not null default now()
);

-- 12. Bucket de preuves : privé. Les politiques (refus par défaut) sont en migration 2.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pheno-preuves', 'pheno-preuves', false, 6291456, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- 13. RLS activée partout, aucun droit d'écriture direct ---------------------
do $$
declare t text;
begin
  foreach t in array array['pheno_protocoles','pheno_panels','pheno_blocs','pheno_arbres','pheno_affectations',
    'pheno_visites','pheno_observations','pheno_corrections','pheno_evenements_maturite','pheno_journal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on private.pheno_sync_recus from anon, authenticated;

commit;
