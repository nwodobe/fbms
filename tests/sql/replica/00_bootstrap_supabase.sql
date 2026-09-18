-- Replica locale minimale de l'environnement Supabase (roles + auth.uid()).
-- USAGE : tests locaux uniquement. Jamais sur une base Supabase reelle.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema auth;
create schema private;
create schema extensions;
grant usage on schema public, auth to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
create table auth.users (id uuid primary key, email text);
-- Meme semantique que Supabase : l'identite vient des claims JWT de la requete.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists unaccent;
create extension if not exists pg_trgm;
-- Droits par defaut Supabase : les nouvelles tables/fonctions de public sont
-- accordees a anon/authenticated/service_role (c'est ce qui rend les REVOKE
-- explicites indispensables en production).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
