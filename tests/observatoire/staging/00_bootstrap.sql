-- STAGING LOCAL FIDÈLE À LA PRODUCTION — amorce Supabase (rôles, auth, storage).
-- Jamais exécuté sur une base Supabase. Aucune donnée personnelle.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema if not exists auth; create schema if not exists private; create schema if not exists storage; create schema if not exists extensions;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
create extension if not exists unaccent; create extension if not exists pg_trgm;
-- Storage : structure Supabase (colonnes utilisées par les politiques et les migrations).
create table if not exists storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
  avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid default auth.uid(), owner_id text, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb, version text, user_metadata jsonb, unique (bucket_id, name));
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts,1)-1]; end $$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[array_length(_parts,1)]; end $$;
grant execute on function storage.foldername(text), storage.filename(text) to anon, authenticated, service_role;
alter table storage.objects enable row level security; alter table storage.buckets enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
-- Droits par défaut Supabase (ce qui rend les REVOKE explicites indispensables).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
