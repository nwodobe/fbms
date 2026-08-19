-- ============================================================================
-- Banc d'essai Niveau 1 — LIGNE DE BASE
-- ----------------------------------------------------------------------------
-- Reproduit l'état du dépôt AVANT les migrations Niveau 1, afin que les tests
-- mesurent un écart réel et non une base idéale.
--
-- Source fidèle : supabase/rls.sql, supabase/achats.sql, supabase/cash.sql,
-- supabase/sacs.sql, et les extensions de docs/migrations/sacherie_v2_mvp_*.sql.
--
-- Ce qui est ÉMULÉ (et donc ne prouve rien sur Supabase lui-même) :
--   · auth.uid()  -> lit le paramètre de session request.jwt.claim.sub
--   · les rôles Supabase authenticated / anon / service_role
-- Tout le reste est du PostgreSQL authentique.
-- ============================================================================

-- --- Émulation Supabase ------------------------------------------------------
create schema if not exists auth;

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;

-- --- Référentiels (forme réelle : colonne data jsonb) ------------------------
create table if not exists public.profils (
  user_id uuid primary key,
  nom text,
  email text,
  role text,
  actif boolean default true
);
-- Extensions apportées par la Sacherie V2.
alter table public.profils add column if not exists fonction_operationnelle text;
alter table public.profils add column if not exists cluster text;
alter table public.profils add column if not exists zone text;

create table if not exists public.villages (
  id uuid primary key default gen_random_uuid(),
  data jsonb,
  deleted boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.rt (
  id uuid primary key default gen_random_uuid(),
  data jsonb,
  village_nom text,
  deleted boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.producteurs (
  id uuid primary key default gen_random_uuid(),
  data jsonb,
  code text,
  village_id uuid,
  deleted boolean default false,
  updated_at timestamptz default now()
);

-- --- Fonctions d'aide : copie conforme de supabase/rls.sql -------------------
create or replace function public.mon_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profils where user_id = auth.uid() and actif = true limit 1
$$;

create or replace function public.est_actif()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif = true)
$$;

create or replace function public.est_bm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils
                 where user_id = auth.uid() and actif = true and role = 'Branch Manager')
$$;

create or replace function public.peut_editer_terrain()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
     'Supervisor','Agent Recenseur')
$$;

create or replace function public.peut_editer_config()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
$$;

-- --- MODULE 1 : achats (supabase/achats.sql, à l'identique) ------------------
create table if not exists public.achats (
  id             uuid primary key default gen_random_uuid(),
  local_id       text unique,
  date           date not null,
  cluster        text,
  village_id     uuid,
  village_nom    text,
  rt_id          text,
  rt_nom         text,
  producteur_id  text,
  producteur_nom text,
  producteur_ref boolean default true,
  poids_brut     numeric,
  tare           numeric,
  poids_net      numeric not null check (poids_net > 0),
  prix_kg        numeric not null check (prix_kg > 0),
  montant        numeric not null,
  mode_paiement  text,
  numero_recu    text,
  nb_sacs        integer,
  humidite       numeric,
  kor            numeric,
  impuretes      numeric,
  rejet          boolean default false,
  observation    text,
  recu_photo     text,
  commission_rt  numeric,
  bonus_diff     numeric,
  refinancable   boolean default false,
  recu_photo_url text,
  qualite_statut     text default 'À contrôler',
  statut_validation  text default 'À valider',
  validated_by       text,
  validated_at       timestamptz,
  stock_statut       text default 'Entrée RT',
  cash_statut        text default 'Non réconcilié',
  created_by     uuid default auth.uid(),
  created_by_nom text,
  created_at     timestamptz default now()
);
alter table public.achats add column if not exists cycle_id text;

alter table public.achats enable row level security;
drop policy if exists achats_sel on public.achats;
drop policy if exists achats_ins on public.achats;
drop policy if exists achats_upd on public.achats;
drop policy if exists achats_del on public.achats;
create policy achats_sel on public.achats for select to authenticated using (public.est_actif());
create policy achats_ins on public.achats for insert to authenticated
  with check (public.est_actif() and created_by = auth.uid());
create policy achats_upd on public.achats for update to authenticated using (public.est_bm()) with check (public.est_bm());
create policy achats_del on public.achats for delete to authenticated using (public.est_bm());

-- --- MODULE 2 : cash (supabase/cash.sql, à l'identique) ----------------------
create table if not exists public.avances (
  id             uuid primary key default gen_random_uuid(),
  local_id       text unique,
  date           date not null,
  cluster        text,
  rt_id          text,
  rt_nom         text,
  source         text,
  montant        numeric not null check (montant > 0),
  motif          text,
  statut         text default 'Active',
  created_by     uuid default auth.uid(),
  created_by_nom text,
  created_at     timestamptz default now()
);
alter table public.avances add column if not exists cycle_id text;
alter table public.avances add column if not exists volume_finance_kg numeric;
alter table public.avances add column if not exists prix_reference_kg numeric;
alter table public.avances add column if not exists cycle_statut text;

create unique index if not exists avances_cycle_id_uidx
  on public.avances(cycle_id) where cycle_id is not null;
create unique index if not exists avances_un_cycle_open_par_rt_uidx
  on public.avances(rt_id) where cycle_id is not null and cycle_statut = 'OPEN';

create table if not exists public.reconciliations (
  id             uuid primary key default gen_random_uuid(),
  local_id       text unique,
  date           date not null,
  cluster        text,
  rt_id          text,
  rt_nom         text,
  cash_restant   numeric,
  valeur_stock   numeric,
  total_avance   numeric,
  total_paye     numeric,
  ecart          numeric,
  statut         text,
  created_by     uuid default auth.uid(),
  created_by_nom text,
  created_at     timestamptz default now()
);

alter table public.avances enable row level security;
drop policy if exists avances_sel on public.avances;
drop policy if exists avances_ins on public.avances;
drop policy if exists avances_upd on public.avances;
drop policy if exists avances_del on public.avances;
create policy avances_sel on public.avances for select to authenticated using (public.est_actif());
create policy avances_ins on public.avances for insert to authenticated
  with check (public.peut_editer_config() and created_by = auth.uid());
create policy avances_upd on public.avances for update to authenticated using (public.est_bm()) with check (public.est_bm());
create policy avances_del on public.avances for delete to authenticated using (public.est_bm());

alter table public.reconciliations enable row level security;
drop policy if exists recon_sel on public.reconciliations;
drop policy if exists recon_ins on public.reconciliations;
drop policy if exists recon_upd on public.reconciliations;
drop policy if exists recon_del on public.reconciliations;
create policy recon_sel on public.reconciliations for select to authenticated using (public.est_actif());
create policy recon_ins on public.reconciliations for insert to authenticated
  with check (public.est_actif() and created_by = auth.uid());
create policy recon_upd on public.reconciliations for update to authenticated using (public.est_bm()) with check (public.est_bm());
create policy recon_del on public.reconciliations for delete to authenticated using (public.est_bm());

-- --- MODULE 3 : sacs (supabase/sacs.sql, à l'identique) ----------------------
create table if not exists public.sacs_mouvements (
  id             uuid primary key default gen_random_uuid(),
  local_id       text unique,
  date           date not null,
  type           text not null,
  source         text,
  destination    text,
  cluster        text,
  village_id     uuid,
  village_nom    text,
  rt_id          text,
  rt_nom         text,
  producteur_id  text,
  producteur_nom text,
  quantite       integer not null check (quantite > 0),
  observation    text,
  created_by     uuid default auth.uid(),
  created_by_nom text,
  created_at     timestamptz default now()
);
alter table public.sacs_mouvements add column if not exists request_id uuid;
alter table public.sacs_mouvements add column if not exists bag_movement_code text;
alter table public.sacs_mouvements add column if not exists approved_qty integer;
alter table public.sacs_mouvements add column if not exists executed_qty integer;
alter table public.sacs_mouvements add column if not exists bag_state text;
alter table public.sacs_mouvements add column if not exists lot_id text;
alter table public.sacs_mouvements add column if not exists business_status text;
alter table public.sacs_mouvements add column if not exists correction_of uuid;

alter table public.sacs_mouvements enable row level security;
drop policy if exists sacs_sel on public.sacs_mouvements;
drop policy if exists sacs_ins on public.sacs_mouvements;
drop policy if exists sacs_upd on public.sacs_mouvements;
drop policy if exists sacs_del on public.sacs_mouvements;
create policy sacs_sel on public.sacs_mouvements for select to authenticated using (public.est_actif());
create policy sacs_ins on public.sacs_mouvements for insert to authenticated
  with check (public.est_actif() and created_by = auth.uid());
create policy sacs_upd on public.sacs_mouvements for update to authenticated using (public.est_bm()) with check (public.est_bm());
create policy sacs_del on public.sacs_mouvements for delete to authenticated using (public.est_bm());

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
