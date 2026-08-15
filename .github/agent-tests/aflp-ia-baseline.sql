-- ============================================================================
-- Banc d'essai de l'Assistant IA AFLP — LIGNE DE BASE
-- ----------------------------------------------------------------------------
-- Reproduit ce que la migration `docs/migrations/aflp_ia_journal_20260815.sql`
-- trouvera devant elle sur le projet Supabase : l'émulation d'`auth`, les rôles
-- PostgREST, la table `profils` et les cinq fonctions d'autorisation de
-- `supabase/rls.sql`, recopiées à l'identique.
--
-- CE QUI EST ÉMULÉ, et ne prouve donc rien sur Supabase lui-même :
--   · auth.uid()  → lit le paramètre de session request.jwt.claim.sub
--   · les rôles anon / authenticated / service_role
--   · PostgREST : absent. Ce banc teste PostgreSQL, pas l'API REST.
-- Tout le reste — politiques, déclencheurs, contraintes, vue — est du
-- PostgreSQL authentique, réellement exécuté.
-- ============================================================================

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

-- Reproduit le défaut constaté sur la base réelle le 14/08/2026 : des droits
-- larges accordés par défaut. La migration doit les REVOQUER explicitement, et
-- c'est cela que le banc vérifie.
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on tables to anon;

create table if not exists public.profils (
  user_id uuid primary key,
  nom text,
  email text,
  role text,
  actif boolean default true
);

create table if not exists public.parametres_calcul (
  cle text primary key,
  valeur text
);

-- --- Copie conforme de supabase/rls.sql -------------------------------------
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
