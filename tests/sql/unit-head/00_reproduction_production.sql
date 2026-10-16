-- =============================================================================
-- Reproduction LOCALE et isolée de la chaîne d'autorisation villages / producteurs
-- de la production FBMS (projet jmbdgpdthzpszfnddwzi), relevée le 2026-10-16.
-- Fonctions, déclencheurs et politiques : recopiés à l'identique de pg_proc /
-- pg_policies / pg_trigger. Tables : colonnes réelles utiles aux contrôles.
-- Seuls éléments simulés (signalés « BOUCHON ») : auth.uid(), journal d'audit,
-- rafraîchissement du Farmer Passport, création forcée de doublon.
-- Usage : psql -v ON_ERROR_STOP=1 -f 00_reproduction_production.sql
-- =============================================================================
create extension if not exists unaccent;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;
create schema if not exists auth;
create schema if not exists private;

-- BOUCHON : équivalent Supabase de auth.uid()
create table auth.users(id uuid primary key, email text, aud text, role text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
         (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')), '')::uuid
$$;

-- ----------------------------------------------------------------- tables
create table public.aflp_zones(code text primary key, label text not null, region text, active boolean not null default true);
create table public.aflp_clusters(code text primary key, label text not null, zone_code text not null, aliases text[] not null default '{}', active boolean not null default true);
create table public.profils(
  user_id uuid primary key references auth.users(id) on delete cascade, email text not null unique, nom text not null,
  role text not null, actif boolean not null default true, cluster text, zone text, village_id text, rt_id text,
  authority_level text, permissions jsonb not null default '[]'::jsonb);
create table public.villages(
  id text primary key, data jsonb not null, village text, region text, departement text, score integer default 0,
  statut text not null default 'Brouillon', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by text, updated_by text, deleted boolean not null default false, cluster text,
  gps_lat numeric(9,6), gps_lng numeric(9,6), cluster_code text, farmer_code_prefix text);
create unique index villages_farmer_code_prefix_uidx on public.villages(farmer_code_prefix)
  where farmer_code_prefix is not null and btrim(farmer_code_prefix)<>'';
create table public.rt(id text primary key, data jsonb not null, nom text, telephone text, village_id text, village_nom text,
  statut text not null default 'Pressenti', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by text, updated_by text, deleted boolean not null default false, cluster text, id_rt text);
create table public.producteurs(
  id text primary key, data jsonb not null, code text, nom text, telephone text, village_id text not null, village_nom text, rt_id text,
  statut text not null default 'Identifié', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by text, updated_by text, deleted boolean not null default false, gps_lat numeric(9,6), gps_lng numeric(9,6),
  prenoms text, sexe text, birth_year integer, age_band text, telephone_alt text, preferred_language text,
  id_document_type text, id_document_number text, operational_status text not null default 'ACTIVE',
  passport_stage text not null default 'INCOMPLETE', passport_completion smallint not null default 0,
  risk_profile text not null default 'NOT_ASSESSED', consent_status text not null default 'NOT_RECORDED',
  possible_duplicate boolean not null default false, review_required boolean not null default false, review_reason text,
  record_version bigint not null default 1, created_by_user_id uuid default auth.uid(), updated_by_user_id uuid default auth.uid(),
  is_qa boolean not null default false);
create table public.prod_code_seq(village_id text primary key, dernier integer not null);
create table public.farmer_identity_documents(id bigserial primary key, producteur_id text, document_type text, document_number text, status text, source text, created_by uuid, created_at timestamptz default now());
create table public.farmer_change_log(id bigserial primary key, table_name text, record_id text, operation text, before_data jsonb, after_data jsonb, actor_id uuid, actor_email text, actor_role text);
create table public.campaigns(id uuid primary key default gen_random_uuid(), code text not null, status text not null default 'DRAFT');
create table public.farmer_plots(id uuid primary key, producteur_id text, village_id text, local_name text, declared_area numeric, area_unit text,
  latitude numeric, longitude numeric, gps_status text, gps_captured_at timestamptz, area_source text, evidence_level text, status text);
create table private.offline_sync_receipts(idempotency_key uuid primary key, client_operation_id uuid not null, operation_type text not null,
  user_id uuid not null, device_id uuid not null, campaign_id uuid not null, request_hash text not null, result jsonb not null,
  created_at_client timestamptz, processed_at timestamptz not null default now());
create table private.offline_device_leases(lease_token uuid primary key default gen_random_uuid(), campaign_id uuid not null, rt_id text not null,
  user_id uuid not null, device_id uuid not null, issued_at timestamptz not null default now(), valid_until timestamptz not null);

-- ----------------------------------------------------------------- fonctions (copies exactes)
CREATE OR REPLACE FUNCTION public.fbms_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select role from profils where user_id = auth.uid() and actif = true;
$f$;
CREATE OR REPLACE FUNCTION public.fbms_email() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select email from profils where user_id = auth.uid() and actif = true;
$f$;
CREATE OR REPLACE FUNCTION public.est_actif() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif = true)
$f$;
CREATE OR REPLACE FUNCTION public.est_bm() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profils
                 where user_id = auth.uid() and actif = true and role = 'Branch Manager')
$f$;
CREATE OR REPLACE FUNCTION public.mon_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select role from public.profils where user_id = auth.uid() and actif = true limit 1
$f$;
CREATE OR REPLACE FUNCTION public.peut_editer_terrain() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
     'Supervisor','Agent Recenseur','Chef d''equipe','Chef d''équipe')
$f$;
CREATE OR REPLACE FUNCTION public.peut_modifier_rt_producteur() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select public.mon_role() in (
    'Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Zonal Head','Unit Head',
    'Assistant Unit Head','Supervisor','Agent Recenseur','Chef d''equipe','Chef d''équipe','Administrateur')
$f$;
CREATE OR REPLACE FUNCTION public.peut_ecrire_referentiel_terrain() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select coalesce(public.peut_editer_terrain(), false) or coalesce(public.peut_modifier_rt_producteur(), false)
      or coalesce(public.mon_role() in ('Field Buying Operations Officer','General Manager'), false)
$f$;
CREATE OR REPLACE FUNCTION public.portee_terrain_globale() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select public.mon_role() in ('Zonal Head')
$f$;
CREATE OR REPLACE FUNCTION public.farmer_registry_norm_text(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  select regexp_replace(upper(unaccent(coalesce(value, ''))), '[^A-Z0-9]+', '', 'g')
$f$;
CREATE OR REPLACE FUNCTION public.farmer_registry_norm_phone(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  select case
    when regexp_replace(coalesce(value, ''), '[^0-9]+', '', 'g') like '225%'
      then right(regexp_replace(coalesce(value, ''), '[^0-9]+', '', 'g'), 10)
    else regexp_replace(coalesce(value, ''), '[^0-9]+', '', 'g')
  end
$f$;
CREATE OR REPLACE FUNCTION public.farmer_registry_resolve_cluster_code(value text) RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $f$
  select c.code
  from public.aflp_clusters c
  where c.active
    and (
      public.farmer_registry_norm_text(c.code) = public.farmer_registry_norm_text(value)
      or public.farmer_registry_norm_text(c.label) = public.farmer_registry_norm_text(value)
      or exists (
        select 1
        from unnest(c.aliases) a(alias)
        where public.farmer_registry_norm_text(a.alias) = public.farmer_registry_norm_text(value)
      )
    )
  order by c.code
  limit 1
$f$;
CREATE OR REPLACE FUNCTION private.farmer_registry_authority() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private' AS $f$
  select coalesce(
    p.authority_level,
    case p.role
      when 'Branch Manager' then 'GLOBAL'
      when 'Branch Manager / Head of Programme' then 'GLOBAL'
      when 'Assistant Branch Manager' then 'GLOBAL'
      when 'Head of Field' then 'GLOBAL'
      when 'Procurement Officer' then 'GLOBAL'
      when 'Zonal Head' then 'ZONE'
      when 'Unit Head' then 'CLUSTER'
      when 'Assistant Unit Head' then 'CLUSTER'
      when 'Supervisor' then 'CLUSTER'
      when 'Warehouse Keeper' then 'CLUSTER'
      when 'RT / Field Partner' then 'VILLAGE'
      when 'Agent Recenseur' then 'VILLAGE'
      when 'Logistics Coordinator' then 'TRANSVERSE'
      when 'Finance / Controller' then 'TRANSVERSE'
      when 'Read Only / Audit' then 'TRANSVERSE'
      when 'Consultation uniquement' then 'TRANSVERSE'
      else 'TRANSVERSE'
    end
  )
  from public.profils p
  where p.user_id = auth.uid() and p.actif = true
  limit 1
$f$;
CREATE OR REPLACE FUNCTION private.farmer_registry_can_access_village(target_village text, target_rt text DEFAULT NULL::text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'private' AS $f$
declare
  p public.profils%rowtype;
  v_cluster text;
  v_zone text;
  v_has_multi_zone boolean := false;
begin
  select * into p
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1;

  if p.user_id is null then return false; end if;
  if private.farmer_registry_authority() = 'GLOBAL' then return true; end if;
  if public.portee_terrain_globale() then return true; end if;

  select coalesce(v.cluster_code, upper(btrim(v.cluster))), c.zone_code
    into v_cluster, v_zone
  from public.villages v
  left join public.aflp_clusters c on c.code = v.cluster_code
  where v.id = target_village and not v.deleted;

  if v_cluster is null then return false; end if;

  if jsonb_typeof(p.permissions) = 'object'
     and jsonb_typeof(p.permissions->'zones') = 'array' then
    select exists (
      select 1
      from jsonb_array_elements_text(p.permissions->'zones') z
      where public.farmer_registry_norm_text(z)
            = public.farmer_registry_norm_text(v_zone)
         or public.farmer_registry_norm_text(z)
            = public.farmer_registry_norm_text(
                (select label from public.aflp_zones where code = v_zone)
              )
    ) into v_has_multi_zone;
    if v_has_multi_zone then return true; end if;
  end if;

  if p.village_id is not null then
    if target_village is distinct from p.village_id then return false; end if;
    if p.rt_id is not null and target_rt is distinct from p.rt_id then return false; end if;
    return true;
  end if;

  if p.cluster is not null then
    return public.farmer_registry_norm_text(p.cluster)
      = public.farmer_registry_norm_text(v_cluster);
  end if;

  if p.zone is not null then
    return public.farmer_registry_norm_text(p.zone)
      = public.farmer_registry_norm_text(v_zone)
      or public.farmer_registry_norm_text(p.zone)
      = public.farmer_registry_norm_text(
          (select z.label from public.aflp_zones z where z.code = v_zone)
        );
  end if;

  return false;
end
$f$;
-- BOUCHON : la création forcée d'un doublon fort n'est pas testée ici.
create or replace function private.aflp_can_force_create() returns boolean language sql stable as $f$ select false $f$;

-- ----------------------------------------------------------------- fonctions de déclencheurs (copies exactes)
CREATE OR REPLACE FUNCTION public.farmer_registry_prepare_village_cluster_code() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
declare
  v_label text;
  v_code text;
begin
  if new.deleted then
    return new;
  end if;
  if new.cluster_code is not null and btrim(new.cluster_code) <> ''
     and exists(select 1 from public.aflp_clusters c where c.code = new.cluster_code and c.active) then
    return new;
  end if;
  v_label := coalesce(nullif(new.cluster,''), nullif(new.data->'s1'->>'cluster',''));
  if v_label is null then
    return new;
  end if;
  v_code := public.farmer_registry_resolve_cluster_code(v_label);
  if v_code is not null then
    new.cluster_code := v_code;
  end if;
  return new;
end
$f$;
CREATE OR REPLACE FUNCTION public.fb_preserve_media_villages() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $f$
begin return NEW; end $f$;  -- sans effet sur les contrôles d'accès (fusion des médias s7)
CREATE OR REPLACE FUNCTION public.controler_statut_agent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
begin
  if fbms_role() = 'Agent Recenseur' and new.statut not in ('Brouillon','Soumis') then
    raise exception 'Un Agent Recenseur ne peut placer une fiche qu''en Brouillon ou Soumis.';
  end if;
  return new;
end $f$;
CREATE OR REPLACE FUNCTION public.fbms_controler_suppression() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
begin
  if coalesce(old.deleted, false) = false
     and new.deleted = true
     and coalesce(fbms_role(), '') <> 'Branch Manager' then
    raise exception 'Seul le Branch Manager peut supprimer des fiches.';
  end if;
  return new;
end $f$;
CREATE OR REPLACE FUNCTION public.fn_sync_villages_colonnes() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $f$
begin
  new.cluster := coalesce(nullif(upper(trim(new.data->'s1'->>'cluster')),''), new.cluster);
  new.gps_lat := coalesce(nullif(trim(new.data->'s1'->>'gpsLat'),'')::numeric, new.gps_lat);
  new.gps_lng := coalesce(nullif(trim(new.data->'s1'->>'gpsLng'),'')::numeric, new.gps_lng);
  return new;
exception when others then
  return new;
end;
$f$;
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
begin new.updated_at := now(); new.updated_by := fbms_email(); return new; end $f$;
CREATE OR REPLACE FUNCTION private.village_controle_nom() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private' AS $f$
declare v_nom text; v_k text; v_hit text;
begin
  if coalesce(new.deleted, false) then return new; end if;
  v_nom := nullif(btrim(coalesce(new.village, new.data->'s1'->>'village', '')), '');
  if v_nom is null then raise exception 'Le nom du village est obligatoire.' using errcode = '23514'; end if;
  v_k := public.farmer_registry_norm_text(v_nom);
  if v_k = '' then raise exception 'Le nom du village est obligatoire.' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and public.farmer_registry_norm_text(coalesce(old.village, old.data->'s1'->>'village','')) = v_k
     and old.cluster_code is not distinct from new.cluster_code and not coalesce(old.deleted,false) then
    return new;
  end if;
  select v.id into v_hit from public.villages v
   where not v.deleted and v.id <> new.id and v.cluster_code is not distinct from new.cluster_code
     and public.farmer_registry_norm_text(coalesce(v.village, v.data->'s1'->>'village','')) = v_k
   limit 1;
  if v_hit is not null then
    raise exception 'Le village « % » existe déjà dans ce cluster. Utilisez la fiche existante.', v_nom using errcode = '23505';
  end if;
  return new;
end $f$;
CREATE OR REPLACE FUNCTION public.farmer_registry_set_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare prefix text; next_number integer;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code then raise exception 'Le Farmer ID est immuable après attribution.'; end if;
    return new;
  end if;
  if new.code is null or btrim(new.code) = '' or new.code like 'TMP-%' then
    select v.farmer_code_prefix into prefix from public.villages v where v.id = new.village_id and not v.deleted;
    if prefix is null or btrim(prefix) = '' then raise exception 'Préfixe Farmer ID absent pour le village sélectionné.'; end if;
    insert into public.prod_code_seq (village_id, dernier) values (new.village_id, 1)
    on conflict (village_id) do update set dernier = public.prod_code_seq.dernier + 1 returning dernier into next_number;
    new.code := prefix || '-' || lpad(next_number::text, 4, '0');
  end if;
  return new;
end $f$;
-- Copie partielle fidèle sur les contrôles : village valide, RT du même village.
CREATE OR REPLACE FUNCTION public.farmer_registry_prepare_producteur() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare v_village_nom text; v_rt_village text;
begin
  if new.data is null then new.data := '{}'::jsonb; end if;
  select coalesce(v.village, v.data->'s1'->>'village') into v_village_nom
  from public.villages v where v.id = new.village_id and not v.deleted;
  if v_village_nom is null then raise exception 'Village producteur invalide ou supprime.'; end if;
  if new.rt_id is not null then
    select r.village_id into v_rt_village from public.rt r where r.id = new.rt_id and not r.deleted;
    if v_rt_village is null then raise exception 'RT producteur invalide ou supprime.'; end if;
    if v_rt_village is distinct from new.village_id then
      raise exception 'Le RT selectionne n''appartient pas au village du producteur.';
    end if;
  end if;
  new.village_nom := coalesce(nullif(new.village_nom,''), v_village_nom);
  if tg_op = 'UPDATE' then new.record_version := coalesce(old.record_version, 0) + 1; end if;
  return new;
end $f$;
CREATE OR REPLACE FUNCTION private.farmer_controle_doublon() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private' AS $f$
declare v_tel text; v_idn text; v_nn text; v_hit record; v_justif boolean;
begin
  if coalesce(new.deleted, false) then return new; end if;
  if tg_op = 'UPDATE' and new.telephone is not distinct from old.telephone and new.nom is not distinct from old.nom
     and new.prenoms is not distinct from old.prenoms and new.village_id is not distinct from old.village_id
     and old.deleted is not distinct from new.deleted then
    return new;
  end if;
  v_tel := nullif(public.farmer_registry_norm_phone(new.telephone), '');
  if v_tel is not null and length(v_tel) < 8 then v_tel := null; end if;
  v_idn := nullif(public.farmer_registry_norm_text(coalesce(new.nom,'') || ' ' || coalesce(new.prenoms,'')), '');
  v_nn  := nullif(public.farmer_registry_norm_text(new.nom), '');
  v_justif := coalesce(new.possible_duplicate, false) and length(btrim(coalesce(new.review_reason,''))) >= 10;
  if v_tel is not null and v_idn is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.telephone is not null
       and public.farmer_registry_norm_phone(p.telephone) = v_tel
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = v_idn
     limit 1;
    if v_hit.id is not null then
      if not v_justif then
        raise exception 'DOUBLON_FORT: ce producteur existe déjà (Farmer ID %, même téléphone et même identité). Ouvrez la fiche existante au lieu d''en créer une nouvelle.', coalesce(v_hit.code, v_hit.id)
          using errcode = '23505';
      end if;
      if auth.uid() is not null and not private.aflp_can_force_create() then
        raise exception 'DOUBLON_FORT: création malgré un doublon fort réservée à la supervision (Supervisor, Unit Head, Zonal Head, direction).'
          using errcode = '42501';
      end if;
      new.review_required := true;
      return new;
    end if;
  end if;
  if v_idn is not null and nullif(btrim(coalesce(new.prenoms,'')),'') is not null and new.village_id is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.village_id = new.village_id
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = v_idn
     limit 1;
    if v_hit.id is not null then
      if not v_justif then
        raise exception 'DOUBLON_FORT: un producteur de même nom et prénoms existe déjà dans ce village (Farmer ID %). Vérifiez la fiche existante ; une création exceptionnelle exige une justification.', coalesce(v_hit.code, v_hit.id)
          using errcode = '23505';
      end if;
      new.review_required := true;
      return new;
    end if;
  end if;
  if v_tel is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.telephone is not null
       and public.farmer_registry_norm_phone(p.telephone) = v_tel
     limit 1;
    if v_hit.id is not null then
      new.possible_duplicate := true; new.review_required := true;
      new.review_reason := coalesce(nullif(btrim(coalesce(new.review_reason,'')),''),
        'À vérifier : téléphone partagé avec le Farmer ID ' || coalesce(v_hit.code, v_hit.id) || ' (téléphone familial possible).');
      return new;
    end if;
  end if;
  if v_nn is not null and new.village_id is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.village_id = new.village_id and p.nom is not null
       and public.farmer_registry_norm_text(p.nom) = v_nn
       and (nullif(btrim(coalesce(new.prenoms,'')),'') is null or nullif(btrim(coalesce(p.prenoms,'')),'') is null)
     limit 1;
    if v_hit.id is not null then
      new.review_required := true;
      new.review_reason := coalesce(nullif(btrim(coalesce(new.review_reason,'')),''),
        'À vérifier : même nom dans le même village que le Farmer ID ' || coalesce(v_hit.code, v_hit.id) || ' (indice faible).');
    end if;
  end if;
  return new;
end $f$;
-- BOUCHON : journal d'audit (identique en structure, sans masquage)
create or replace function public.farmer_registry_audit_trigger() returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin insert into public.farmer_change_log(table_name, record_id, operation, actor_id) values (tg_table_name, coalesce(case when tg_op='DELETE' then old.id else new.id end,'?'), tg_op, auth.uid());
 if tg_op = 'DELETE' then return old; end if; return new; end $f$;
-- BOUCHON : rafraîchissement du Farmer Passport (aucun effet sur les droits)
create or replace function public.farmer_registry_refresh_from_producteur_trigger() returns trigger language plpgsql security definer as $f$ begin return new; end $f$;

-- ----------------------------------------------------------------- déclencheurs (mêmes noms, ordre alphabétique conservé)
create trigger trg_farmer_registry_village_cluster_code before insert or update on public.villages for each row execute function public.farmer_registry_prepare_village_cluster_code();
create trigger trg_fb_preserve_media_villages before update on public.villages for each row execute function public.fb_preserve_media_villages();
create trigger trg_statut_agent before insert or update on public.villages for each row execute function public.controler_statut_agent();
create trigger trg_suppr_villages before update on public.villages for each row execute function public.fbms_controler_suppression();
create trigger trg_sync_villages_colonnes before insert or update on public.villages for each row execute function public.fn_sync_villages_colonnes();
create trigger trg_touch_villages before update on public.villages for each row execute function public.touch_updated_at();
create trigger trg_zz_village_controle_nom before insert or update on public.villages for each row execute function private.village_controle_nom();
create trigger trg_farmer_registry_audit_producteurs after insert or update or delete on public.producteurs for each row execute function public.farmer_registry_audit_trigger();
create trigger trg_farmer_registry_prepare_producteur before insert or update on public.producteurs for each row execute function public.farmer_registry_prepare_producteur();
create trigger trg_farmer_registry_refresh_producteur after insert or update on public.producteurs for each row execute function public.farmer_registry_refresh_from_producteur_trigger();
create trigger trg_farmer_registry_set_code before insert or update on public.producteurs for each row execute function public.farmer_registry_set_code();
create trigger trg_farmer_registry_zz_controle_doublon before insert or update on public.producteurs for each row execute function private.farmer_controle_doublon();
create trigger trg_suppr_prod before update on public.producteurs for each row execute function public.fbms_controler_suppression();
create trigger trg_touch_prod before update on public.producteurs for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------- RLS et politiques (copies exactes de pg_policies)
alter table public.villages enable row level security;
alter table public.producteurs enable row level security;
alter table public.profils enable row level security;
alter table public.rt enable row level security;

create policy villages_write on public.villages as permissive for all to public
  using (((fbms_role() <> 'Consultation uniquement'::text) AND ((fbms_role() <> 'Agent Recenseur'::text) OR (created_by = fbms_email()) OR (created_by IS NULL))))
  with check ((fbms_role() <> 'Consultation uniquement'::text));
create policy villages_del on public.villages as permissive for delete to authenticated using (est_bm());
create policy villages_del_admin on public.villages as restrictive for delete to public using ((fbms_role() = 'Branch Manager'::text));
create policy villages_delete_bm_only_guard on public.villages as restrictive for delete to authenticated using (est_bm());
create policy villages_ecriture_roles_terrain_ins on public.villages as restrictive for insert to authenticated with check (peut_ecrire_referentiel_terrain());
create policy villages_ins on public.villages as permissive for insert to authenticated with check (peut_editer_terrain());
create policy villages_sel on public.villages as permissive for select to authenticated using (est_actif());
create policy villages_select on public.villages as permissive for select to public using ((fbms_role() IS NOT NULL));
create policy villages_ecriture_roles_terrain_upd on public.villages as restrictive for update to authenticated using (peut_ecrire_referentiel_terrain()) with check (peut_ecrire_referentiel_terrain());
create policy villages_upd on public.villages as permissive for update to authenticated using (peut_editer_terrain()) with check (peut_editer_terrain());

create policy farmer_registry_scope_guard on public.producteurs as restrictive for all to authenticated
  using (private.farmer_registry_can_access_village(village_id, rt_id)) with check (private.farmer_registry_can_access_village(village_id, rt_id));
create policy prod_write on public.producteurs as permissive for all to public
  using (((fbms_role() <> 'Consultation uniquement'::text) AND ((fbms_role() <> 'Agent Recenseur'::text) OR (created_by = fbms_email()) OR (created_by IS NULL))))
  with check ((fbms_role() <> 'Consultation uniquement'::text));
create policy prod_del_admin on public.producteurs as restrictive for delete to public using ((fbms_role() = 'Branch Manager'::text));
create policy producteurs_del on public.producteurs as permissive for delete to authenticated using (est_bm());
create policy producteurs_delete_bm_only_guard on public.producteurs as restrictive for delete to public using (est_bm());
create policy producteurs_ecriture_roles_terrain_ins on public.producteurs as restrictive for insert to authenticated with check (peut_ecrire_referentiel_terrain());
create policy producteurs_ins on public.producteurs as permissive for insert to authenticated with check (peut_editer_terrain());
create policy prod_select on public.producteurs as permissive for select to public using ((fbms_role() IS NOT NULL));
create policy producteurs_sel on public.producteurs as permissive for select to authenticated using (est_actif());
create policy producteurs_upd on public.producteurs as permissive for update to authenticated using (peut_editer_terrain()) with check (peut_editer_terrain());
create policy producteurs_update_role_scope_guard on public.producteurs as restrictive for update to authenticated
  using ((peut_modifier_rt_producteur() AND private.farmer_registry_can_access_village(village_id, rt_id)))
  with check ((peut_modifier_rt_producteur() AND private.farmer_registry_can_access_village(village_id, rt_id)));
create policy producteurs_update_rt_farmer_roles on public.producteurs as permissive for update to authenticated
  using ((peut_modifier_rt_producteur() AND private.farmer_registry_can_access_village(village_id, rt_id)))
  with check ((peut_modifier_rt_producteur() AND private.farmer_registry_can_access_village(village_id, rt_id)));

create policy profils_del_bm on public.profils as permissive for delete to authenticated using (est_bm());
create policy profils_ins_bm on public.profils as permissive for insert to authenticated with check (est_bm());
create policy profils_sel_bm on public.profils as permissive for select to authenticated using (est_bm());
create policy profils_sel_self on public.profils as permissive for select to authenticated using ((user_id = auth.uid()));
create policy profils_select on public.profils as permissive for select to public using (((auth.uid() = user_id) OR (fbms_role() = 'Branch Manager'::text)));
create policy profils_upd_bm on public.profils as permissive for update to authenticated using (est_bm()) with check (est_bm());
create policy profils_update on public.profils as permissive for update to public using ((fbms_role() = 'Branch Manager'::text));

create policy rt_sel on public.rt as permissive for select to authenticated using (est_actif());

-- ----------------------------------------------------------------- privilèges Supabase par défaut
grant usage on schema public, private, auth to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, private, auth to authenticated;

-- ----------------------------------------------------------------- référentiel officiel (copie)
insert into public.aflp_zones(code,label,region) values ('GBEKE_1','GBEKE 1','Gbêkê'),('GBEKE_2','GBEKE 2','Gbêkê');
insert into public.aflp_clusters(code,label,zone_code,aliases) values
  ('BEOUMI','Béoumi','GBEKE_2','{BEOUMI}'),('BOTRO','Botro','GBEKE_2','{BOTRO}'),('BROBO','Brobo','GBEKE_1','{BROBO}'),
  ('DIABO','Diabo','GBEKE_2','{DIABO}'),('DJEBONOUA','Djébonoua','GBEKE_1','{DJEBONOUA,"N''DJEBONOUA",DJEBONOU,DJEBONOA}'),
  ('SAKASSOU','Sakassou','GBEKE_1','{SAKASSOU}');
insert into public.campaigns(id, code, status) values ('c5b19a48-de65-464a-892b-a2b2c76acdaa','2027','OPEN');
