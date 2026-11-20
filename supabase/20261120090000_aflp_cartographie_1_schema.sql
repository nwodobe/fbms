-- =====================================================================
-- CARTOGRAPHIE DES PARCELLES AFLP · migration 1/3 : SCHÉMA
-- ---------------------------------------------------------------------
-- STATUT : préparée et testée sur la recette LOCALE (tests/cartographie/).
--          Application en production = décision explicite du Branch Manager
--          (mandat « Opération FBMS Cartographie 2026 », § 19).
-- PRINCIPES
--   * farmer_plots reste LA table des parcelles : ajout de colonnes nullables
--     uniquement, aucune ligne existante réécrite, aucune contrainte modifiée.
--   * Chaque contour est une VERSION immuable (farmer_plot_geometries) : une
--     correction crée une nouvelle version ; une version validée n'est jamais
--     modifiée en place, elle passe à REMPLACE lorsqu'une autre est validée.
--   * Superficie déclarée (declared_area), point GPS (latitude/longitude) et
--     superficie GPS saisie (gps_verified_area) ne sont jamais écrasés.
--   * RLS active, aucune écriture directe : tout passe par les RPC de la
--     migration 2 (SECURITY DEFINER, contrôles d'auteur, de périmètre, de version).
-- RETOUR ARRIÈRE : 20261120090300_aflp_cartographie_rollback.sql
-- REJOUABLE : oui (if not exists partout).
-- =====================================================================
begin;

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create schema if not exists private;

-- 1. Extension additive de farmer_plots -------------------------------------
alter table public.farmer_plots add column if not exists plot_code text;
alter table public.farmer_plots add column if not exists mapping_status text;
alter table public.farmer_plots add column if not exists current_geometry_id uuid;
alter table public.farmer_plots add column if not exists mapped_area_ha numeric(12,4);
alter table public.farmer_plots add column if not exists mapped_area_method text;
alter table public.farmer_plots add column if not exists split_from_plot_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'farmer_plots_mapping_status_chk') then
    alter table public.farmer_plots add constraint farmer_plots_mapping_status_chk
      check (mapping_status is null or mapping_status in ('SOUMIS','A_CORRIGER','VALIDE','ARCHIVE')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'farmer_plots_mapped_area_method_chk') then
    alter table public.farmer_plots add constraint farmer_plots_mapped_area_method_chk
      check (mapped_area_method is null or mapped_area_method in ('SATELLITE_ESTIMEE','GPS_MESUREE','IMPORT_FICHIER','MIXTE')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'farmer_plots_mapped_area_chk') then
    alter table public.farmer_plots add constraint farmer_plots_mapped_area_chk
      check (mapped_area_ha is null or mapped_area_ha > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'farmer_plots_split_from_fk') then
    alter table public.farmer_plots add constraint farmer_plots_split_from_fk
      foreign key (split_from_plot_id) references public.farmer_plots(id) on update restrict on delete restrict not valid;
  end if;
end $$;
create unique index if not exists farmer_plots_plot_code_uidx on public.farmer_plots(plot_code) where plot_code is not null;
-- Numéro de parcelle : séquence, pas un extrait d'identifiant (8 caractères d'un UUID entrent en
-- collision ; constaté au test navigateur du 20/11/2026 sur deux parcelles de même préfixe).
create sequence if not exists private.plot_map_code_seq as bigint start 1;
revoke all on sequence private.plot_map_code_seq from public, anon, authenticated;

-- 2. Versions de contour ------------------------------------------------------
create table if not exists public.farmer_plot_geometries (
  id uuid primary key,
  plot_id uuid not null references public.farmer_plots(id) on update restrict on delete restrict,
  producteur_id text not null,
  village_id text not null,
  cluster_code text not null,
  zone_code text,
  version_no integer not null check (version_no >= 1),
  base_geometry_id uuid references public.farmer_plot_geometries(id),
  method text not null check (method in ('SATELLITE','GPS_POINTS','IMPORT_FICHIER','MIXTE')),
  geom extensions.geography(Polygon, 4326) not null,
  geojson_client jsonb not null,
  area_m2 numeric(14,2) not null check (area_m2 > 0),
  perimeter_m numeric(12,2) not null check (perimeter_m > 0),
  area_m2_client numeric(14,2),
  perimeter_m_client numeric(12,2),
  vertex_count integer not null check (vertex_count >= 3),
  imagery_source text,
  imagery_date date,
  boundary_confidence text not null check (boundary_confidence in ('VISIBLES','PARTIELLES','INCERTAINES','VERIFICATION_TERRAIN')),
  gps_points integer check (gps_points is null or gps_points >= 0),
  gps_accuracy_min_m numeric(8,2),
  gps_accuracy_median_m numeric(8,2),
  gps_accuracy_max_m numeric(8,2),
  producer_confirmation text not null default 'NON_DEMANDEE'
    check (producer_confirmation in ('NON_DEMANDEE','CONFIRMEE_SUR_PLACE','CONTESTEE','PRODUCTEUR_ABSENT')),
  producer_confirmation_note text,
  notes text,
  status text not null check (status in ('SOUMIS','A_CORRIGER','VALIDE','REMPLACE','ARCHIVE')),
  created_by uuid not null,
  created_by_role text,
  device_id text,
  client_operation_id text,
  request_hash text,
  created_at_client timestamptz,
  created_at timestamptz not null default now(),
  preverified_by uuid,
  preverified_at timestamptz,
  preverification_note text,
  decided_by uuid,
  decided_at timestamptz,
  decision_comment text,
  decision_exception boolean not null default false,
  row_version integer not null default 1,
  unique (plot_id, version_no)
);
create index if not exists farmer_plot_geometries_plot_idx on public.farmer_plot_geometries(plot_id, version_no desc);
create index if not exists farmer_plot_geometries_cluster_idx on public.farmer_plot_geometries(cluster_code, status);
create index if not exists farmer_plot_geometries_geom_gix on public.farmer_plot_geometries using gist (geom);
-- Au plus UNE version validée en vigueur par parcelle.
create unique index if not exists farmer_plot_geometries_un_valide on public.farmer_plot_geometries(plot_id) where status = 'VALIDE';

-- 3. Anomalies (chevauchements, conflits, écarts, précision) -------------------
create table if not exists public.farmer_plot_anomalies (
  id uuid primary key default gen_random_uuid(),
  geometry_id uuid not null references public.farmer_plot_geometries(id),
  plot_id uuid not null references public.farmer_plots(id),
  other_geometry_id uuid references public.farmer_plot_geometries(id),
  other_plot_id uuid references public.farmer_plots(id),
  cluster_code text not null,
  zone_code text,
  type text not null check (type in ('CHEVAUCHEMENT','CONFLIT_VERSION','ECART_SUPERFICIE','PRECISION_GPS')),
  overlap_m2 numeric(14,2),
  detail jsonb not null default '{}'::jsonb,
  bloquante boolean not null,
  statut text not null default 'OUVERTE' check (statut in ('OUVERTE','RESOLUE')),
  classification text check (classification is null or classification in
    ('LEGITIME_FAMILIAL','LIMITE_PARTAGEE','ERREUR_TRACE','SUPERPOSITION_DECLAREE','CONFLIT_TRAITE','ECART_CONFIRME','ECART_A_CORRIGER','PRECISION_ACCEPTEE')),
  justification text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists farmer_plot_anomalies_geom_idx on public.farmer_plot_anomalies(geometry_id) where statut = 'OUVERTE';
create index if not exists farmer_plot_anomalies_cluster_idx on public.farmer_plot_anomalies(cluster_code, statut);

-- 4. Journal (ajout seul) ----------------------------------------------------------
create table if not exists public.farmer_plot_map_events (
  id bigserial primary key,
  plot_id uuid not null,
  geometry_id uuid,
  acteur uuid,
  acteur_role text,
  action text not null,
  avant jsonb,
  apres jsonb,
  motif text,
  created_at timestamptz not null default now()
);
create index if not exists farmer_plot_map_events_plot_idx on public.farmer_plot_map_events(plot_id, created_at desc);

-- 5. Reçus d'idempotence de la file hors ligne ---------------------------------------
create table if not exists private.plot_map_sync_recus (
  idempotency_key text primary key,
  user_id uuid not null,
  request_hash text not null,
  resultat jsonb not null,
  created_at timestamptz not null default now()
);

-- 6. Paramètres et indicateurs de fonctionnalité (désactivé par défaut) -----------------
create table if not exists public.plot_map_parametres (
  cle text primary key,
  valeur jsonb not null,
  maj_le timestamptz not null default now(),
  maj_par uuid
);
insert into public.plot_map_parametres (cle, valeur) values
  ('activation', '{"localisation": false, "contours": false, "clusters_pilotes": []}'::jsonb),
  ('imagerie', '{"fournisseur": "aucun", "licence_confirmee": false, "note": "Aucune imagerie satellite activée tant que la licence n''est pas confirmée par écrit."}'::jsonb),
  ('seuils', '{"ecart_superficie_pct": 20, "precision_gps_max_m": 30, "precision_localisation_max_m": 50, "tolerance_calcul_pct": 0.5, "chevauchement_min_m2": 1, "superficie_min_m2": 100, "superficie_max_ha": 200}'::jsonb),
  ('consentement', '{"gps_requis": true}'::jsonb)
on conflict (cle) do nothing;

-- 7. RLS : tout refusé par défaut, lectures ouvertes par la migration 2 ----------------
alter table public.farmer_plot_geometries enable row level security;
alter table public.farmer_plot_anomalies enable row level security;
alter table public.farmer_plot_map_events enable row level security;
alter table public.plot_map_parametres enable row level security;
alter table private.plot_map_sync_recus enable row level security;

revoke all on public.farmer_plot_geometries, public.farmer_plot_anomalies, public.farmer_plot_map_events, public.plot_map_parametres from anon, authenticated;
revoke all on private.plot_map_sync_recus from anon, authenticated;
revoke all on sequence public.farmer_plot_map_events_id_seq from anon, authenticated;

commit;
