-- =====================================================================
-- AFLP MOTO MANAGER — compléments de la réplique LOCALE de test.
-- USAGE : tests locaux uniquement (tests/moto/executer_tests_moto.sh).
-- Jamais sur une base Supabase réelle.
--
-- La réplique tests/sql/replica date du 18/09/2026 : elle ne contient ni le
-- schéma storage, ni les helpers AFLP ajoutés après. Les définitions
-- ci-dessous sont les définitions EXACTES relevées en production le
-- 30/10/2026 (lecture seule, pg_get_functiondef), sauf le schéma storage qui
-- est un bouchon minimal reproduisant la sémantique utilisée par la RLS.
-- =====================================================================

create or replace function public.aflp_norm(p text)
 returns text language sql immutable set search_path to 'public', 'pg_temp'
as $function$
  select nullif(upper(translate(btrim(coalesce(p, '')),
    'éèêëàâäîïôöûüçÉÈÊËÀÂÄÎÏÔÖÛÜÇ', 'eeeeaaaiioouucEEEEAAAIIOOUUC')), '')
$function$;

create or replace function public.aflp_cluster_code(p text)
 returns text language sql stable set search_path to 'public', 'pg_temp'
as $function$
  select c.code from public.aflp_clusters c
  where public.aflp_norm(p) is not null
    and (public.aflp_norm(p) = c.code or public.aflp_norm(p) = public.aflp_norm(c.label)
         or public.aflp_norm(p) = any (select public.aflp_norm(a) from unnest(c.aliases) a))
  order by c.code limit 1
$function$;

create or replace function public.fbms_email()
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select email from profils where user_id = auth.uid() and actif = true;
$function$;

-- Contrainte de rôles telle qu'en production au 30/10/2026 (ajout Finance Manager).
alter table public.profils drop constraint if exists profils_role_check;
alter table public.profils add constraint profils_role_check check (role = any (array[
  'Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor','Agent Recenseur',
  'Consultation uniquement','General Manager','Field Buying Operations Officer','Zonal Head','Unit Head','RT',
  'LBA Purchase Officer','Warehouse Manager','Storekeeper','QA / Lab','Factory User','Finance','Viewer / Auditor',
  'Finance Manager']));

-- Bouchon storage (sémantique Supabase : bucket_id, name, owner, foldername()).
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid default auth.uid(), created_at timestamptz default now(),
  metadata jsonb, unique (bucket_id, name)
);
create or replace function storage.foldername(name text) returns text[]
 language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Référentiel AFLP minimal (codes identiques à la production).
insert into public.aflp_zones (code, label, region) values
  ('GBEKE_1','GBEKE 1','Gbêkê'), ('GBEKE_2','GBEKE 2','Gbêkê')
on conflict (code) do nothing;
insert into public.aflp_clusters (code, label, zone_code, aliases) values
  ('SAKASSOU','Sakassou','GBEKE_1','{sakassou}'), ('BROBO','Brobo','GBEKE_1','{brobo}'),
  ('DJEBONOUA','Djébonoua','GBEKE_1','{"N''Djébonoua",ndjebonoua,djebonoua}'),
  ('BOTRO','Botro','GBEKE_2','{botro}'), ('BEOUMI','Béoumi','GBEKE_2','{beoumi}'), ('DIABO','Diabo','GBEKE_2','{diabo}')
on conflict (code) do nothing;
