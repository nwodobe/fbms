-- =============================================================================
-- Adaptateur PostgreSQL local · reproduit ce que Supabase fournit d'origine
-- =============================================================================
-- Ce fichier N'EST PAS une migration : il n'est jamais appliqué à un projet
-- Supabase, qui possède déjà ces rôles et ces fonctions. Il permet d'exécuter
-- les migrations et les tests RLS contre un PostgreSQL nu, sans Docker.
--
-- Le mécanisme reproduit est exactement celui de Supabase : le PostgREST de
-- production exécute `SET ROLE authenticated` puis renseigne
-- `request.jwt.claims`. auth.uid() et auth.jwt() lisent ce réglage. Une
-- politique qui passe ici passe donc en production.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant anon, authenticated, service_role to postgres;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim',  true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(auth.jwt() ->> 'role', ''), current_setting('role', true));
$$;

-- Table minimale des comptes, uniquement pour satisfaire les tests locaux.
create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  created_at timestamptz not null default now()
);
