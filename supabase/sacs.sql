-- ============================================================================
-- ANAGROCI — MODULE 3 : STOCK & SACS (volet terrain) — Traçabilité des sacs
-- ----------------------------------------------------------------------------
-- À exécuter dans Supabase → SQL Editor APRÈS supabase/rls.sql.
-- Registre des mouvements de sacs (jute standard). Les soldes par RT et par
-- producteur se déduisent des mouvements (source → destination).
--   Solde RT        = Σ(dest=RT)        − Σ(source=RT)
--   Solde producteur= Σ(dest=PRODUCTEUR)− Σ(source=PRODUCTEUR)
-- Synchro hors-ligne idempotente via local_id.
-- ============================================================================

create table if not exists public.sacs_mouvements (
  id             uuid primary key default gen_random_uuid(),
  local_id       text unique,
  date           date not null,
  type           text not null,                 -- DOTATION_RT | DISTRIBUTION | ENLEVEMENT | RETOUR_PROD | RETOUR_RT | DECHIRE_RT | DECHIRE_PROD
  source         text,                          -- ANAGROCI | RT | PRODUCTEUR | HUB | USINE | PERTE
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
create index if not exists sacs_rt_idx   on public.sacs_mouvements (rt_id);
create index if not exists sacs_prod_idx on public.sacs_mouvements (producteur_id);
create index if not exists sacs_date_idx on public.sacs_mouvements (date);

-- ---------------------------------------------------------------------------
-- RLS : lecture profil actif ; saisie par profil actif (RT compris) pour son
-- compte ; correction/suppression réservées au Branch Manager.
-- ---------------------------------------------------------------------------
alter table public.sacs_mouvements enable row level security;
drop policy if exists sacs_sel on public.sacs_mouvements;
drop policy if exists sacs_ins on public.sacs_mouvements;
drop policy if exists sacs_upd on public.sacs_mouvements;
drop policy if exists sacs_del on public.sacs_mouvements;
create policy sacs_sel on public.sacs_mouvements for select to authenticated using (public.est_actif());
create policy sacs_ins on public.sacs_mouvements for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy sacs_upd on public.sacs_mouvements for update to authenticated using (public.est_bm()) with check (public.est_bm());
create policy sacs_del on public.sacs_mouvements for delete to authenticated using (public.est_bm());

-- ============================================================================
-- Vérification :
--   select tablename, rowsecurity from pg_tables where tablename='sacs_mouvements';
-- ============================================================================
