-- ============================================================================
-- ANAGROCI — MODULE 2 : CASH CONTROL (Avances RT · Solde · Réconciliation)
-- ----------------------------------------------------------------------------
-- À exécuter dans Supabase → SQL Editor APRÈS supabase/rls.sql et achats.sql.
-- Se branche sur les achats : solde RT = Σ avances − Σ montants payés (achats).
-- Synchro hors-ligne idempotente via local_id.
-- ============================================================================

-- Avances remises à un RT (source Finance → RT, ou Cluster Head → RT).
create table if not exists public.avances (
  id             uuid primary key default gen_random_uuid(),
  local_id       text unique,
  date           date not null,
  cluster        text,
  rt_id          text,
  rt_nom         text,
  source         text,                          -- 'Finance' | 'Cluster Head'
  montant        numeric not null check (montant > 0),
  motif          text,
  statut         text default 'Active',
  created_by     uuid default auth.uid(),
  created_by_nom text,
  created_at     timestamptz default now()
);
create index if not exists avances_rt_idx  on public.avances (rt_id);
create index if not exists avances_date_idx on public.avances (date);

-- Réconciliations : cash restant + valeur stock vs avances → écart.
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
  statut         text,                          -- 'Réconcilié' | 'À contrôler'
  created_by     uuid default auth.uid(),
  created_by_nom text,
  created_at     timestamptz default now()
);
create index if not exists recon_rt_idx  on public.reconciliations (rt_id);
create index if not exists recon_date_idx on public.reconciliations (date);

-- ---------------------------------------------------------------------------
-- RLS (fonctions est_actif/est_bm/peut_editer_config viennent de rls.sql)
--   avances        : lecture profil actif ; remise = chefs/BM ; MAJ/suppr = BM.
--   reconciliations: lecture profil actif ; saisie = profil actif (RT compris) ;
--                    MAJ/suppr = BM.
-- ---------------------------------------------------------------------------
alter table public.avances enable row level security;
drop policy if exists avances_sel on public.avances;
drop policy if exists avances_ins on public.avances;
drop policy if exists avances_upd on public.avances;
drop policy if exists avances_del on public.avances;
create policy avances_sel on public.avances for select to authenticated using (public.est_actif());
create policy avances_ins on public.avances for insert to authenticated with check (public.peut_editer_config() and created_by = auth.uid());
create policy avances_upd on public.avances for update to authenticated using (public.est_bm()) with check (public.est_bm());
create policy avances_del on public.avances for delete to authenticated using (public.est_bm());

alter table public.reconciliations enable row level security;
drop policy if exists recon_sel on public.reconciliations;
drop policy if exists recon_ins on public.reconciliations;
drop policy if exists recon_upd on public.reconciliations;
drop policy if exists recon_del on public.reconciliations;
create policy recon_sel on public.reconciliations for select to authenticated using (public.est_actif());
create policy recon_ins on public.reconciliations for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy recon_upd on public.reconciliations for update to authenticated using (public.est_bm()) with check (public.est_bm());
create policy recon_del on public.reconciliations for delete to authenticated using (public.est_bm());

-- ============================================================================
-- Vérification :
--   select tablename, rowsecurity from pg_tables where tablename in ('avances','reconciliations');
-- ============================================================================
