-- FBMS zero-cost ephemeral staging bootstrap.
-- TEST ONLY. This is a compatibility schema for GitHub Actions local Supabase.
-- It must never be executed against the operational project.
\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

create table if not exists public.profils (
  user_id uuid primary key,
  email text not null unique,
  nom text not null,
  role text not null check (role in ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor','Agent Recenseur','Consultation uniquement')),
  actif boolean not null default true,
  fonction_operationnelle text,
  cluster text,
  zone text,
  village_id text,
  rt_id text,
  authority_level text,
  permissions jsonb not null default '[]'::jsonb,
  telephone text,
  derniere_connexion timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.villages (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  village text,
  region text,
  departement text,
  score integer default 0,
  statut text not null default 'Brouillon',
  cluster text,
  gps_lat numeric,
  gps_lng numeric,
  rayon_geofence_m integer default 1500,
  cluster_code text,
  farmer_code_prefix text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.rt (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  nom text,
  telephone text,
  village_id text references public.villages(id),
  village_nom text,
  statut text not null default 'Pressenti' check (statut in ('Pressenti','Confirmé','Actif','Écarté')),
  score integer default 0,
  cluster text,
  id_rt text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create unique index if not exists rt_id_rt_unique_idx on public.rt(id_rt) where id_rt is not null;
create index if not exists rt_village_idx on public.rt(village_id) where not deleted;
create index if not exists rt_cluster_idx on public.rt(cluster);

create table if not exists public.equipes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  chef_user_id uuid references public.profils(user_id),
  cluster text,
  statut text not null default 'active' check (statut in ('active','suspendue','dissoute')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  equipe_id uuid not null references public.equipes(id),
  date_debut date not null,
  date_fin date not null check (date_fin >= date_debut),
  budget_alloue_xof numeric not null default 0 check (budget_alloue_xof >= 0),
  objectif_enrolements integer default 0,
  statut text not null default 'brouillon' check (statut in ('brouillon','soumise','approuvee','en_cours','cloturee','annulee')),
  approuve_par uuid references public.profils(user_id),
  approuve_le timestamptz,
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists idx_missions_equipe on public.missions(equipe_id);
create index if not exists idx_missions_statut on public.missions(statut);

create table if not exists public.mission_villages (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  village_id text not null references public.villages(id),
  ordre integer,
  objectif_enrolements integer default 0,
  statut text not null default 'planifie' check (statut in ('planifie','visite','reporte','annule')),
  unique(mission_id,village_id)
);
create index if not exists idx_mission_villages_mission on public.mission_villages(mission_id);
create index if not exists idx_mission_villages_village on public.mission_villages(village_id);

create table if not exists public.producteurs (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  code text unique,
  nom text,
  prenoms text,
  telephone text,
  village_id text not null references public.villages(id),
  village_nom text,
  rt_id text references public.rt(id),
  statut text not null default 'Identifié' check (statut in ('Identifié','Enrôlé','Actif','Inactif')),
  mission_id uuid references public.missions(id),
  gps_lat numeric,
  gps_lng numeric,
  operational_status text not null default 'ACTIVE',
  passport_stage text not null default 'INCOMPLETE',
  passport_completion smallint not null default 0 check (passport_completion between 0 and 100),
  risk_profile text not null default 'NOT_ASSESSED',
  consent_status text not null default 'NOT_RECORDED',
  consent_date timestamptz,
  possible_duplicate boolean not null default false,
  review_required boolean not null default false,
  created_by text,
  created_by_user_id uuid,
  updated_by text,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists producteurs_village_idx on public.producteurs(village_id) where not deleted;
create index if not exists producteurs_rt_idx on public.producteurs(rt_id) where not deleted;
create index if not exists idx_producteurs_mission on public.producteurs(mission_id);

create table if not exists public.achats (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  date date not null,
  cluster text,
  village_id text,
  village_nom text,
  rt_id text,
  rt_nom text,
  producteur_id text,
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
  kor numeric,
  rejet boolean default false,
  observation text,
  recu_photo text,
  commission_rt numeric,
  bonus_diff numeric,
  refinancable boolean default false,
  producteur_ref boolean default true,
  recu_photo_url text,
  qualite_statut text default 'À contrôler',
  statut_validation text default 'À valider',
  validated_by text,
  validated_at timestamptz,
  stock_statut text default 'Entrée RT',
  cash_statut text default 'Non réconcilié',
  producteur_tel text,
  producteur_statut text,
  prix_hors_bareme boolean default false,
  motif_prix text,
  stock_libere boolean default false,
  saisie_mode text,
  cycle_id text,
  created_by uuid,
  created_by_nom text,
  created_at timestamptz default now(),
  constraint achats_montant_coherent_chk check (abs(montant - poids_net * prix_kg) <= 1),
  constraint achats_commission_coherente_chk check (commission_rt is null or abs(commission_rt - poids_net * 10) <= 1),
  constraint achats_bonus_coherent_chk check (bonus_diff is null or abs(bonus_diff - poids_net * 5) <= 1)
);
create index if not exists achats_date_idx on public.achats(date);
create index if not exists achats_village_idx on public.achats(village_id);
create index if not exists achats_cycle_idx on public.achats(cycle_id,rt_id);
create unique index if not exists achats_numero_recu_unique_idx on public.achats(lower(trim(numero_recu))) where numero_recu is not null and length(trim(numero_recu))>0;

create table if not exists public.avances (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  date date not null default current_date,
  cluster text,
  rt_id text,
  rt_nom text,
  source text,
  montant numeric not null check (montant > 0),
  motif text,
  statut text not null default 'Active',
  cycle_id text,
  volume_finance_kg numeric,
  prix_reference_kg numeric,
  cycle_statut text,
  override_bm boolean not null default false,
  override_motif text,
  created_by uuid,
  created_by_nom text,
  created_at timestamptz not null default now()
);
create unique index if not exists avances_cycle_id_uidx on public.avances(cycle_id) where cycle_id is not null;
create unique index if not exists avances_un_cycle_open_par_rt_uidx on public.avances(rt_id) where cycle_id is not null and cycle_statut='OPEN';

create table if not exists public.sacs_mouvements (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  date date not null default current_date,
  type text not null,
  source text not null,
  destination text not null,
  cluster text,
  village_id text,
  village_nom text,
  rt_id text,
  rt_nom text,
  producteur_id text,
  producteur_nom text,
  quantite integer not null check (quantite > 0),
  observation text,
  document_url text,
  request_id uuid,
  bag_movement_code text,
  approved_qty integer,
  executed_qty integer,
  bag_state text,
  lot_id text,
  business_status text,
  issued_by uuid,
  issued_at timestamptz,
  received_by uuid,
  received_at timestamptz,
  correction_of uuid,
  created_by uuid,
  created_by_nom text,
  created_at timestamptz not null default now()
);
create unique index if not exists sacs_bag_movement_code_uidx on public.sacs_mouvements(bag_movement_code) where bag_movement_code is not null;

create table if not exists public.preuves (
  id uuid primary key default gen_random_uuid(),
  entite_type text not null,
  entite_id text not null,
  type_preuve text not null default 'photo',
  storage_path text not null,
  gps_lat numeric,
  gps_lng numeric,
  horodatage_client timestamptz not null,
  horodatage_serveur timestamptz not null default now(),
  sha256 text,
  created_by uuid not null
);
create unique index if not exists uq_preuves_sha256 on public.preuves(sha256) where sha256 is not null;
create index if not exists idx_preuves_entite on public.preuves(entite_type,entite_id);

create table if not exists public.sessions_formation (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id),
  village_id text not null references public.villages(id),
  theme text not null,
  date_session date not null,
  participants_hommes integer not null default 0 check (participants_hommes >= 0),
  participants_femmes integer not null default 0 check (participants_femmes >= 0),
  attestant_nom text,
  attestant_qualite text,
  notes text,
  statut_validation text not null default 'en_attente' check (statut_validation in ('en_attente','validee','rejetee')),
  valide_par uuid references public.profils(user_id),
  valide_le timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valide_par is null or valide_par <> created_by)
);

create table if not exists public.depenses_mission (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id),
  village_id text references public.villages(id),
  code_gl text,
  libelle text not null,
  montant_xof numeric not null check (montant_xof > 0),
  preuve_id uuid references public.preuves(id),
  statut_validation text not null default 'en_attente' check (statut_validation in ('en_attente','validee_superviseur','approuvee','rejetee')),
  valide_par uuid references public.profils(user_id),
  valide_le timestamptz,
  motif_rejet text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valide_par is null or valide_par <> created_by)
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id),
  village_id text not null references public.villages(id),
  type text not null check (type in ('in','out')),
  gps_lat numeric,
  gps_lng numeric,
  gps_precision_m numeric,
  horodatage_client timestamptz not null,
  horodatage_serveur timestamptz not null default now(),
  user_id uuid not null
);

create table if not exists public.audit_log (
  id bigserial primary key,
  user_id uuid,
  action text not null,
  entity text,
  entity_id text,
  client_transaction_id text,
  old_state jsonb,
  new_state jsonb,
  created_at timestamptz not null default now()
);

-- Reuse the repository's real helper functions and base policies.
\ir ../../supabase/rls.sql
\ir ../../supabase/achats.sql
\ir ../../supabase/cash.sql
\ir ../../supabase/sacs.sql

-- Apply the real Sacherie V2 server-side rules/RPCs to the isolated database.
\ir ../../docs/migrations/sacherie_v2_mvp_20260811.sql

-- Terrain mission tables mirror current production access rules.
create or replace function public.est_equipe_terrain()
returns boolean language sql stable security definer set search_path=public as $$
  select public.mon_role() in ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor','Agent Recenseur')
$$;

alter table public.equipes enable row level security;
alter table public.missions enable row level security;
alter table public.mission_villages enable row level security;
alter table public.checkins enable row level security;
alter table public.preuves enable row level security;
alter table public.sessions_formation enable row level security;
alter table public.depenses_mission enable row level security;

do $$
declare t text;
begin
  foreach t in array array['equipes','missions','mission_villages'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.est_actif()))',t||'_qa_sel',t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.peut_editer_config()))',t||'_qa_ins',t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.peut_editer_config())) with check ((select public.peut_editer_config()))',t||'_qa_upd',t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.est_bm()))',t||'_qa_del',t);
  end loop;
end $$;

create policy checkins_qa_sel on public.checkins for select to authenticated using ((select public.est_actif()));
create policy checkins_qa_ins on public.checkins for insert to authenticated with check ((select public.est_equipe_terrain()) and user_id=(select auth.uid()));
create policy preuves_qa_sel on public.preuves for select to authenticated using ((select public.est_actif()));
create policy preuves_qa_ins on public.preuves for insert to authenticated with check ((select public.est_equipe_terrain()) and created_by=(select auth.uid()));
create policy sessions_qa_sel on public.sessions_formation for select to authenticated using ((select public.est_actif()));
create policy sessions_qa_ins on public.sessions_formation for insert to authenticated with check ((select public.est_equipe_terrain()) and created_by=(select auth.uid()));
create policy sessions_qa_upd on public.sessions_formation for update to authenticated using ((select public.peut_editer_config())) with check ((select public.peut_editer_config()));
create policy depenses_qa_sel on public.depenses_mission for select to authenticated using ((select public.est_actif()));
create policy depenses_qa_ins on public.depenses_mission for insert to authenticated with check ((select public.est_equipe_terrain()) and created_by=(select auth.uid()));
create policy depenses_qa_upd on public.depenses_mission for update to authenticated using ((select public.peut_editer_config())) with check ((select public.peut_editer_config()));

-- Storage bucket exists only in the ephemeral local stack.
insert into storage.buckets(id,name,public)
values ('terrain-preuves','terrain-preuves',false)
on conflict (id) do nothing;

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

select 'FBMS_STAGING_SCHEMA_READY' as status;
