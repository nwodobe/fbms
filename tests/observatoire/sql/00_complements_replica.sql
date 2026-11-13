-- =====================================================================
-- OBSERVATOIRE — compléments de la réplique LOCALE de test.
-- USAGE : tests locaux uniquement. Jamais sur une base Supabase réelle.
-- La réplique tests/sql/replica (18/09/2026) ne contient ni campaigns ni
-- farmer_plots. Structures minimales ci-dessous : colonnes et types relevés
-- en production le 13/11/2026 (lecture seule du catalogue, aucune donnée).
-- Les compléments moto (aflp_norm, aflp_cluster_code, storage, clusters)
-- sont appliqués avant ce fichier.
-- =====================================================================
alter table public.profils drop constraint if exists profils_role_check;
alter table public.profils add constraint profils_role_check check (role = any (array[
  'Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor','Agent Recenseur',
  'Consultation uniquement','General Manager','Field Buying Operations Officer','Zonal Head','Unit Head','RT',
  'LBA Purchase Officer','Warehouse Manager','Storekeeper','QA / Lab','Factory User','Finance','Viewer / Auditor',
  'Finance Manager','Assistant Unit Head']));

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, year integer not null,
  campaign_type text not null default 'REAL', status text not null default 'DRAFT',
  start_date date, planned_end_date date, actual_end_date date, closed_at timestamptz, closed_with_reserves boolean not null default false,
  is_current boolean not null default false, row_version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.farmer_plots (
  id uuid primary key default gen_random_uuid(), producteur_id text not null references public.producteurs(id),
  village_id text not null references public.villages(id), local_name text,
  tree_count integer, productive_tree_count integer, latitude numeric, longitude numeric,
  status text not null default 'ACTIVE', created_at timestamptz not null default now(),
  created_by uuid, deleted boolean not null default false, record_version bigint not null default 1
);
