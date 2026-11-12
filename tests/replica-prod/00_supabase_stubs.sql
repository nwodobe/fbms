-- Réplique de test isolée · socle Supabase minimal (auth, storage, rôles).
-- AUCUNE donnée réelle. Ne jamais exécuter sur un projet Supabase.
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
end $$;
grant usage on schema public, private, storage, auth, extensions to authenticated, anon;

-- Identité : comme Supabase, auth.uid() lit le claim "sub" du JWT de la session.
create or replace function auth.uid() returns uuid language sql stable
 as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users(id uuid primary key, email text);

create table storage.buckets(id text primary key, name text, public boolean,
 file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),
 bucket_id text not null, name text not null, owner_id text,
 metadata jsonb default '{}'::jsonb, created_at timestamptz default now(),
 unique(bucket_id, name));
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
create or replace function storage.foldername(p_name text) returns text[]
 language sql immutable as $$
 select (string_to_array(p_name, '/'))[1:greatest(array_length(string_to_array(p_name,'/'),1)-1,0)] $$;
create or replace function storage.extension(p_name text) returns text
 language sql immutable as $$ select lower(reverse(split_part(reverse(p_name), '.', 1))) $$;
grant execute on function storage.foldername(text), storage.extension(text), auth.uid() to authenticated, anon;
