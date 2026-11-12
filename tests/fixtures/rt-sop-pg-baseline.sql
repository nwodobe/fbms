-- Test-only minimal Supabase-compatible stubs for PostgreSQL CI; no production data.
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable
 as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key);
create table public.profils(user_id uuid primary key references auth.users(id), nom text, role text, actif boolean);
create table public.rt(id text primary key,nom text,cluster text,village_id text,village_nom text,deleted boolean not null default false);
create table public.campaigns(id uuid primary key,code text,year integer,campaign_type text,status text);
create table public.avances(
 id uuid primary key default gen_random_uuid(), local_id text unique,date date,cluster text,rt_id text,rt_nom text,
 source text,montant numeric,motif text,statut text,created_by uuid,created_by_nom text,campaign_id uuid
);
create table public.achats(
 id uuid primary key default gen_random_uuid(),campaign_id uuid,rt_id text,numero_recu text,
 montant numeric,rejet boolean default false,statut_validation text,
 validated_by text,validated_at timestamptz
);
create table public.field_shipments(
 id uuid primary key default gen_random_uuid(),campaign_id uuid,
 origin_type text,origin_id text,origin_label text,
 destination_type text,destination_id text,destination_label text,
 vehicle_plate text,driver_name text,dispatched_qty_kg numeric,
 document_ref text,status text,shipment_code text
);
create table public.wms_receptions(id text primary key,field_shipment_id uuid,net_kg numeric,weighbridge_ticket text,created_at timestamptz);
create table public.wms_grns(id text primary key,reception_id text,status text,issued_by uuid,issued_at timestamptz);
create table storage.buckets(
 id text primary key,name text,public boolean,file_size_limit bigint,
 allowed_mime_types text[]
);
create table storage.objects(
 id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,
 owner_id text,metadata jsonb default '{}'::jsonb
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(p_name text) returns text[]
 language sql stable as $$
 select string_to_array(substring(p_name from 1 for greatest(length(p_name)-length(split_part(reverse(p_name),'/',1))-1,0)),'/')
$$;
create or replace function storage.extension(p_name text) returns text
 language sql stable as $$select lower(reverse(split_part(reverse(split_part(p_name,'/',3)),'.',1)))$$;
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333'),
 ('44444444-4444-4444-8444-444444444444');
insert into public.profils values
 ('11111111-1111-4111-8111-111111111111','BM TEST','Branch Manager',true),
 ('22222222-2222-4222-8222-222222222222','FINANCE TEST','Finance',true),
 ('33333333-3333-4333-8333-333333333333','UH TEST','Unit Head',true),
 ('44444444-4444-4444-8444-444444444444','ASSISTANT TEST','Assistant Unit Head',true);
insert into public.rt values ('RT-FICTIF-01','RT FICTIF','BROBO','V-FICTIF','VILLAGE FICTIF',false);
insert into public.campaigns values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','0002',2027,'REAL','OPEN'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2027',2027,'SIMULATION','OPEN');
