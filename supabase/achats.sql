-- Field Buying 2027 - Module Achats Terrain
-- A executer dans Supabase SQL Editor.

create table if not exists public.achats (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  date date not null,
  cluster text,
  village_id uuid,
  village_nom text,
  rt_nom text,
  producteur_nom text,
  poids_brut numeric,
  tare numeric,
  poids_net numeric not null check (poids_net > 0),
  prix_kg numeric not null check (prix_kg > 0),
  montant numeric not null,
  mode_paiement text,
  numero_recu text,
  nb_sacs integer,
  humidite numeric,
  impuretes numeric,
  rejet boolean default false,
  observation text,
  recu_photo text,
  commission_rt numeric,
  bonus_diff numeric,
  refinancable boolean default false,
  sync_statut text default 'Synchronise',
  created_by uuid default auth.uid(),
  created_by_nom text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists achats_date_idx on public.achats (date);
create index if not exists achats_village_idx on public.achats (village_id);
create index if not exists achats_cluster_idx on public.achats (cluster);
create index if not exists achats_rt_idx on public.achats (rt_nom);

alter table public.achats enable row level security;

drop policy if exists achats_sel on public.achats;
drop policy if exists achats_ins on public.achats;
drop policy if exists achats_upd on public.achats;
drop policy if exists achats_del on public.achats;

create policy achats_sel on public.achats
for select to authenticated
using (public.est_actif());

create policy achats_ins on public.achats
for insert to authenticated
with check (public.est_actif() and created_by = auth.uid());

create policy achats_upd on public.achats
for update to authenticated
using (public.est_bm())
with check (public.est_bm());

create policy achats_del on public.achats
for delete to authenticated
using (public.est_bm());