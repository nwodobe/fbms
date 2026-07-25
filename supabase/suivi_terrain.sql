-- ============================================================================
-- ANAGROCI — SUIVI TERRAIN LIVE (supabase/suivi_terrain.sql)
-- ----------------------------------------------------------------------------
-- Suivi en direct des équipes sur le terrain (façon Uber) : chaque membre
-- démarre un « trajet » depuis son téléphone ; les positions GPS remontent en
-- continu et alimentent le cockpit de supervision (carte live) ainsi que
-- l'historique des trajets (relecture des missions).
--
-- À exécuter dans Supabase → SQL Editor, APRÈS supabase/rls.sql (les
-- fonctions d'aide public.est_actif / est_bm / peut_editer_terrain doivent
-- exister). Script rejouable sans danger (create if not exists + drop policy).
--
-- Modèle :
--   · suivi_trajets   : un enregistrement par trajet (qui, quoi, quand,
--                       distance cumulée, dernière position connue). L'id est
--                       généré CÔTÉ CLIENT (uuid) pour permettre le démarrage
--                       hors ligne puis la synchronisation différée.
--   · suivi_positions : le fil des points GPS d'un trajet (lat/lng, précision,
--                       vitesse, cap, batterie), insérés par lots.
-- ============================================================================

create table if not exists public.suivi_trajets (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nom                  text not null default '',          -- nom affiché (copie du profil au démarrage)
  role                 text not null default '',          -- rôle au moment du trajet
  objet                text not null default '',          -- mission / motif du déplacement
  statut               text not null default 'actif' check (statut in ('actif','termine')),
  demarre_a            timestamptz not null default now(),
  termine_a            timestamptz,
  distance_m           double precision not null default 0,
  nb_points            integer not null default 0,
  derniere_lat         double precision,                  -- dernière position connue (dénormalisée
  derniere_lng         double precision,                  -- pour un cockpit live sans requête lourde)
  derniere_precision_m double precision,
  derniere_vitesse_ms  double precision,
  dernier_point_a      timestamptz,
  batterie_pct         integer,
  created_at           timestamptz not null default now()
);

create table if not exists public.suivi_positions (
  id           bigint generated always as identity primary key,
  trajet_id    uuid not null references public.suivi_trajets (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  precision_m  double precision,
  vitesse_ms   double precision,
  cap_deg      double precision,
  batterie_pct integer,
  enregistre_a timestamptz not null default now()
);

create index if not exists suivi_trajets_user_demarre_idx  on public.suivi_trajets (user_id, demarre_a desc);
create index if not exists suivi_trajets_statut_point_idx  on public.suivi_trajets (statut, dernier_point_a desc);
create index if not exists suivi_positions_trajet_time_idx on public.suivi_positions (trajet_id, enregistre_a);
create index if not exists suivi_positions_user_time_idx   on public.suivi_positions (user_id, enregistre_a desc);

-- ---------------------------------------------------------------------------
-- Sécurité (RLS) — même philosophie que les tables terrain :
--   · lecture   : tout profil ACTIF (le cockpit est accessible bm/chef/agent/
--                 direction ; l'UI restreint ce que voit chaque rôle) ;
--   · écriture  : chacun n'écrit QUE ses propres trajets/positions
--                 (user_id = auth.uid()), et uniquement s'il a un profil
--                 terrain actif ;
--   · clôture   : le propriétaire — ou le BM (pouvoir de clore un trajet
--                 resté « actif » après perte d'un téléphone) ;
--   · purge     : BM uniquement.
-- ---------------------------------------------------------------------------
alter table public.suivi_trajets   enable row level security;
alter table public.suivi_positions enable row level security;

drop policy if exists suivi_trajets_sel on public.suivi_trajets;
drop policy if exists suivi_trajets_ins on public.suivi_trajets;
drop policy if exists suivi_trajets_upd on public.suivi_trajets;
drop policy if exists suivi_trajets_del on public.suivi_trajets;
create policy suivi_trajets_sel on public.suivi_trajets
  for select to authenticated using (public.est_actif());
create policy suivi_trajets_ins on public.suivi_trajets
  for insert to authenticated with check (user_id = auth.uid() and public.peut_editer_terrain());
create policy suivi_trajets_upd on public.suivi_trajets
  for update to authenticated
  using (user_id = auth.uid() or public.est_bm())
  with check (user_id = auth.uid() or public.est_bm());
create policy suivi_trajets_del on public.suivi_trajets
  for delete to authenticated using (public.est_bm());

drop policy if exists suivi_positions_sel on public.suivi_positions;
drop policy if exists suivi_positions_ins on public.suivi_positions;
drop policy if exists suivi_positions_del on public.suivi_positions;
create policy suivi_positions_sel on public.suivi_positions
  for select to authenticated using (public.est_actif());
create policy suivi_positions_ins on public.suivi_positions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.peut_editer_terrain()
    and exists (select 1 from public.suivi_trajets t
                where t.id = trajet_id and t.user_id = auth.uid())
  );
create policy suivi_positions_del on public.suivi_positions
  for delete to authenticated using (public.est_bm());

-- ---------------------------------------------------------------------------
-- Temps réel : publication des changements pour le cockpit live
-- (supabase_realtime respecte la RLS ci-dessus). Bloc protégé : sans effet si
-- les tables sont déjà publiées.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.suivi_trajets;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.suivi_positions;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- VÉRIFICATION RAPIDE (facultatif) :
--   select tablename, rowsecurity from pg_tables
--    where schemaname='public' and tablename like 'suivi_%';
--   select * from pg_publication_tables where pubname='supabase_realtime'
--    and tablename like 'suivi_%';
-- ============================================================================
