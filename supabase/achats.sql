-- ============================================================================
-- ANAGROCI - MODULE 1 : ACHATS TERRAIN (Field Buying)
-- ----------------------------------------------------------------------------
-- A executer dans Supabase -> SQL Editor APRES supabase/rls.sql.
-- Table des achats journaliers RCN (Producteur -> RT), avec RLS par role.
-- La synchro hors-ligne s'appuie sur local_id (idempotence : upsert do nothing).
-- ============================================================================

create table if not exists public.achats (
  id             uuid primary key default gen_random_uuid(),
  local_id       text unique,                   -- identifiant local (synchro idempotente)
  date           date not null,
  cluster        text,
  village_id     text,                          -- public.villages.id est text (ex. v_1783341599948_9073)
  village_nom    text,
  rt_id          text,
  rt_nom         text,
  producteur_id  text,
  producteur_nom text,
  producteur_ref boolean default true,          -- false = producteur non reference (a regulariser)
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
  commission_rt  numeric,                       -- 10 FCFA/kg x poids_net
  bonus_diff     numeric,                       -- 5 FCFA/kg provisionne
  refinancable   boolean default false,         -- false si pas de recu (ou rejet)
  recu_photo_url text,
  qualite_statut     text default 'À contrôler', -- Standard | À contrôler
  statut_validation  text default 'À valider',   -- À valider | À contrôler | À régulariser | Validation BM requise | Validé | Rejeté
  validated_by       text,
  validated_at       timestamptz,
  stock_statut       text default 'Entrée RT',
  cash_statut        text default 'Non réconcilié',
  created_by     uuid default auth.uid(),
  created_by_nom text,
  created_at     timestamptz default now()
);

-- Mise a niveau d'une table achats deja existante (idempotent) :
alter table public.achats alter column village_id type text using village_id::text;
alter table public.achats add column if not exists kor numeric;
alter table public.achats add column if not exists rt_id text;
alter table public.achats add column if not exists producteur_id text;
alter table public.achats add column if not exists producteur_ref boolean default true;
alter table public.achats add column if not exists recu_photo_url text;
alter table public.achats add column if not exists qualite_statut text default 'À contrôler';
alter table public.achats add column if not exists statut_validation text default 'À valider';
alter table public.achats add column if not exists validated_by text;
alter table public.achats add column if not exists validated_at timestamptz;
alter table public.achats add column if not exists stock_statut text default 'Entrée RT';
alter table public.achats add column if not exists cash_statut text default 'Non réconcilié';

create index if not exists achats_date_idx    on public.achats (date);
create index if not exists achats_village_idx on public.achats (village_id);
create index if not exists achats_rt_idx      on public.achats (rt_nom);

-- ---------------------------------------------------------------------------
-- RLS : lecture = tout profil actif ; saisie = tout profil actif, pour son
-- propre compte ; correction/suppression = Branch Manager uniquement.
-- Les fonctions est_actif() / est_bm() proviennent de supabase/rls.sql.
-- ---------------------------------------------------------------------------
alter table public.achats enable row level security;
drop policy if exists achats_sel on public.achats;
drop policy if exists achats_ins on public.achats;
drop policy if exists achats_upd on public.achats;
drop policy if exists achats_del on public.achats;

create policy achats_sel on public.achats
  for select to authenticated using (public.est_actif());

create policy achats_ins on public.achats
  for insert to authenticated
  with check (public.est_actif() and created_by = auth.uid());

create policy achats_upd on public.achats
  for update to authenticated using (public.est_bm()) with check (public.est_bm());

create policy achats_del on public.achats
  for delete to authenticated using (public.est_bm());

-- ============================================================================
-- Verification :
--   select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='achats' and column_name='village_id';
--   select count(*) from public.achats;
--   select tablename, rowsecurity from pg_tables where tablename='achats';
-- ============================================================================
