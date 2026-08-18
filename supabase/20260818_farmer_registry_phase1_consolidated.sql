-- ANAGROCI FBMS - AFLP Farmer Registry Phase 1
-- Consolidated repository source for the live migrations applied on 2026-08-18.
-- Additive and idempotent where PostgreSQL permits. No DROP TABLE, no TRUNCATE,
-- no producer reactivation, no Farmer ID renumbering.

begin;

create table if not exists public.aflp_zones (
  code text primary key, label text not null, region text,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.aflp_clusters (
  code text primary key, label text not null,
  zone_code text not null references public.aflp_zones(code) on update cascade,
  aliases text[] not null default '{}', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (code, zone_code)
);
insert into public.aflp_zones(code,label,region) values
 ('GBEKE_1','GBEKE 1','Gbêkê'),('GBEKE_2','GBEKE 2','Gbêkê')
on conflict(code) do update set label=excluded.label,region=excluded.region,active=true,updated_at=now();
insert into public.aflp_clusters(code,label,zone_code,aliases) values
 ('DJEBONOUA','Djébonoua','GBEKE_1',array['DJEBONOUA','DJEBONOU','DJEBONOA']),
 ('BROBO','Brobo','GBEKE_1',array['BROBO']),('SAKASSOU','Sakassou','GBEKE_1',array['SAKASSOU']),
 ('BEOUMI','Béoumi','GBEKE_2',array['BEOUMI']),('BOTRO','Botro','GBEKE_2',array['BOTRO']),
 ('DIABO','Diabo','GBEKE_2',array['DIABO'])
on conflict(code) do update set label=excluded.label,zone_code=excluded.zone_code,aliases=excluded.aliases,active=true,updated_at=now();

alter table public.villages add column if not exists cluster_code text;
alter table public.villages add column if not exists farmer_code_prefix text;
alter table public.profils add column if not exists village_id text;
alter table public.profils add column if not exists rt_id text;
alter table public.profils add column if not exists authority_level text;
alter table public.profils add column if not exists permissions jsonb not null default '[]'::jsonb;

create or replace function public.farmer_registry_norm_text(value text)
returns text language sql immutable set search_path=public as $$
 select regexp_replace(upper(unaccent(coalesce(value,''))),'[^A-Z0-9]+','','g')
$$;
create or replace function public.farmer_registry_norm_phone(value text)
returns text language sql immutable set search_path=public as $$
 select case when regexp_replace(coalesce(value,''),'[^0-9]+','','g') like '225%'
 then right(regexp_replace(coalesce(value,''),'[^0-9]+','','g'),10)
 else regexp_replace(coalesce(value,''),'[^0-9]+','','g') end
$$;

update public.villages v set cluster_code=c.code
from public.aflp_clusters c
where v.cluster_code is null
 and public.farmer_registry_norm_text(coalesce(v.cluster,v.data->'s1'->>'cluster'))=public.farmer_registry_norm_text(c.code);
with candidates as (
 select id,left(public.farmer_registry_norm_text(coalesce(village,data->'s1'->>'village',id))||'XXXX',4) base
 from public.villages where farmer_code_prefix is null or btrim(farmer_code_prefix)=''
), ranked as (
 select id,base,row_number() over(partition by base order by id) rn from candidates
)
update public.villages v set farmer_code_prefix=case when r.rn=1 then r.base else r.base||lpad(r.rn::text,2,'0') end
from ranked r where v.id=r.id;
create unique index if not exists villages_farmer_code_prefix_uidx on public.villages(farmer_code_prefix)
 where farmer_code_prefix is not null and btrim(farmer_code_prefix)<>'';
create index if not exists villages_cluster_code_idx on public.villages(cluster_code) where not deleted;

alter table public.producteurs add column if not exists prenoms text;
alter table public.producteurs add column if not exists sexe text;
alter table public.producteurs add column if not exists birth_year integer;
alter table public.producteurs add column if not exists age_band text;
alter table public.producteurs add column if not exists telephone_alt text;
alter table public.producteurs add column if not exists preferred_language text;
alter table public.producteurs add column if not exists id_document_type text;
alter table public.producteurs add column if not exists id_document_number text;
alter table public.producteurs add column if not exists operational_status text not null default 'ACTIVE';
alter table public.producteurs add column if not exists passport_stage text not null default 'INCOMPLETE';
alter table public.producteurs add column if not exists passport_completion smallint not null default 0;
alter table public.producteurs add column if not exists risk_profile text not null default 'NOT_ASSESSED';
alter table public.producteurs add column if not exists consent_status text not null default 'NOT_RECORDED';
alter table public.producteurs add column if not exists consent_date timestamptz;
alter table public.producteurs add column if not exists consent_version text;
alter table public.producteurs add column if not exists consent_method text;
alter table public.producteurs add column if not exists possible_duplicate boolean not null default false;
alter table public.producteurs add column if not exists review_required boolean not null default false;
alter table public.producteurs add column if not exists review_reason text;
alter table public.producteurs add column if not exists record_version bigint not null default 1;
alter table public.producteurs add column if not exists created_by_user_id uuid default auth.uid();
alter table public.producteurs add column if not exists updated_by_user_id uuid default auth.uid();

create table if not exists public.farmer_consents (
 id uuid primary key default gen_random_uuid(),
 producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
 status text not null check(status in('GRANTED','PARTIAL','REFUSED','WITHDRAWN')),
 scopes jsonb not null default '{}'::jsonb check(jsonb_typeof(scopes)='object'),
 consent_at timestamptz not null, agent_id uuid default auth.uid(), agent_name text,
 text_version text not null, method text not null check(method in('VERBAL','WRITTEN','DIGITAL','WITNESSED')),
 proof_id uuid references public.preuves(id) on update cascade on delete set null,
 notes text, source text not null default 'FIELD_ENROLLMENT',
 supersedes_id uuid references public.farmer_consents(id) on update cascade on delete set null,
 created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create table if not exists public.farmer_identity_documents (
 id uuid primary key default gen_random_uuid(),
 producteur_id text not null references public.producteurs(id) on update cascade on delete restrict deferrable initially deferred,
 document_type text, document_number text,
 status text not null default 'ACTIVE' check(status in('ACTIVE','REPLACED','WITHDRAWN')),
 source text not null default 'FIELD_ENROLLMENT',
 supersedes_id uuid references public.farmer_identity_documents(id) on update cascade on delete set null,
 created_at timestamptz not null default now(), created_by uuid default auth.uid(),
 check(status='WITHDRAWN' or (nullif(btrim(document_type),'') is not null and nullif(btrim(document_number),'') is not null))
);
create table if not exists public.farmer_change_log (
 id bigint generated always as identity primary key,
 table_name text not null, record_id text not null,
 operation text not null check(operation in('INSERT','UPDATE','DELETE')),
 before_data jsonb, after_data jsonb, actor_id uuid, actor_email text, actor_role text,
 reason text, created_at timestamptz not null default now()
);
create index if not exists farmer_consents_producteur_date_idx on public.farmer_consents(producteur_id,created_at desc,consent_at desc);
create index if not exists farmer_identity_documents_producteur_date_idx on public.farmer_identity_documents(producteur_id,created_at desc);
create unique index if not exists farmer_identity_documents_value_uidx on public.farmer_identity_documents(producteur_id,document_number)
 where nullif(btrim(document_number),'') is not null;
create index if not exists farmer_change_log_record_idx on public.farmer_change_log(table_name,record_id,created_at desc);
create index if not exists producteurs_phone_norm_idx on public.producteurs(public.farmer_registry_norm_phone(telephone)) where not deleted and telephone is not null;
create index if not exists producteurs_name_norm_idx on public.producteurs(public.farmer_registry_norm_text(nom)) where not deleted and nom is not null;

insert into public.farmer_identity_documents(producteur_id,document_type,document_number,status,source,created_at)
select p.id,coalesce(nullif(p.id_document_type,''),nullif(p.data->>'pieceType',''),'LEGACY'),
 coalesce(nullif(p.id_document_number,''),nullif(p.data->>'pieceNum','')),'ACTIVE','PHASE1_PRIVACY_MIGRATION',coalesce(p.created_at,now())
from public.producteurs p
where coalesce(nullif(p.id_document_number,''),nullif(p.data->>'pieceNum','')) is not null
and not exists(select 1 from public.farmer_identity_documents d where d.producteur_id=p.id
 and d.document_number=coalesce(nullif(p.id_document_number,''),nullif(p.data->>'pieceNum','')));
update public.producteurs set id_document_number=null,data=coalesce(data,'{}'::jsonb)-'pieceNum'
where id_document_number is not null or coalesce(data,'{}'::jsonb)?'pieceNum';

create or replace function public.farmer_registry_set_code()
returns trigger language plpgsql security definer set search_path=public as $$
declare prefix text; n integer;
begin
 if tg_op='UPDATE' then
  if new.code is distinct from old.code then raise exception 'Le Farmer ID est immuable apres attribution.'; end if;
  return new;
 end if;
 if new.code is null or btrim(new.code)='' or new.code like 'TMP-%' then
  select farmer_code_prefix into prefix from public.villages where id=new.village_id and not deleted;
  if prefix is null then raise exception 'Prefixe Farmer ID absent pour le village selectionne.'; end if;
  insert into public.prod_code_seq(village_id,dernier) values(new.village_id,1)
  on conflict(village_id) do update set dernier=public.prod_code_seq.dernier+1 returning dernier into n;
  new.code:=prefix||'-'||lpad(n::text,4,'0');
 end if;
 return new;
end $$;

create or replace function public.farmer_registry_prepare_producteur()
returns trigger language plpgsql security definer set search_path=public as $$
declare village_name text; rt_village text; doc_number text; doc_type text;
begin
 new.data:=coalesce(new.data,'{}'::jsonb);
 select coalesce(village,data->'s1'->>'village') into village_name from public.villages where id=new.village_id and not deleted;
 if village_name is null then raise exception 'Village producteur invalide ou supprime.'; end if;
 if new.rt_id is not null then
  select village_id into rt_village from public.rt where id=new.rt_id and not deleted;
  if rt_village is null then raise exception 'RT producteur invalide ou supprime.'; end if;
  if rt_village is distinct from new.village_id then raise exception 'Le RT selectionne n''appartient pas au village du producteur.'; end if;
 end if;
 doc_number:=coalesce(nullif(btrim(new.id_document_number),''),nullif(btrim(new.data->>'pieceNum'),''));
 doc_type:=coalesce(nullif(btrim(new.id_document_type),''),nullif(btrim(new.data->>'pieceType'),''),'OTHER');
 if doc_number is not null and not exists(select 1 from public.farmer_identity_documents d where d.producteur_id=new.id and d.document_number=doc_number) then
  insert into public.farmer_identity_documents(producteur_id,document_type,document_number,status,source,created_by)
  values(new.id,doc_type,doc_number,'ACTIVE',case when new.data?'pieceNum' then 'LEGACY_UI_COMPAT' else 'FIELD_ENROLLMENT' end,auth.uid());
 end if;
 new.id_document_number:=null;
 new.village_nom:=coalesce(nullif(new.village_nom,''),village_name);
 new.prenoms:=coalesce(new.prenoms,nullif(new.data->>'prenoms',''));
 new.sexe:=coalesce(new.sexe,case public.farmer_registry_norm_text(new.data->>'sexe') when 'HOMME' then 'M' when 'FEMME' then 'F' when 'M' then 'M' when 'F' then 'F' else null end);
 new.birth_year:=coalesce(new.birth_year,case when coalesce(new.data->>'anneeNaissance','')~'^[0-9]{4}$'
  and (new.data->>'anneeNaissance')::integer between 1900 and extract(year from current_date)::integer
  then (new.data->>'anneeNaissance')::integer end);
 new.age_band:=coalesce(new.age_band,nullif(new.data->>'ageBand',''));
 new.telephone_alt:=coalesce(new.telephone_alt,nullif(new.data->>'telephoneAlt',''));
 new.preferred_language:=coalesce(new.preferred_language,nullif(new.data->>'preferredLanguage',''));
 new.id_document_type:=coalesce(new.id_document_type,nullif(new.data->>'pieceType',''));
 new.data:=(new.data-'pieceNum')||jsonb_strip_nulls(jsonb_build_object(
  'prenoms',new.prenoms,'sexe',case new.sexe when 'M' then 'Homme' when 'F' then 'Femme' else new.data->>'sexe' end,
  'anneeNaissance',new.birth_year,'ageBand',new.age_band,'telephoneAlt',new.telephone_alt,
  'preferredLanguage',new.preferred_language,'pieceType',new.id_document_type,
  'operationalStatus',new.operational_status,'possibleDuplicate',new.possible_duplicate,
  'reviewRequired',new.review_required,'reviewReason',new.review_reason));
 if tg_op='UPDATE' then new.record_version:=coalesce(old.record_version,0)+1; end if;
 new.updated_at:=now(); new.updated_by_user_id:=auth.uid();
 return new;
end $$;

create or replace function public.farmer_registry_prepare_consent()
returns trigger language plpgsql security definer set search_path=public as $$
declare previous uuid;
begin
 if new.consent_at>now()+interval '1 day' then raise exception 'Date de consentement future interdite.'; end if;
 if jsonb_typeof(new.scopes) is distinct from 'object' then raise exception 'Perimetres de consentement invalides.'; end if;
 if new.status='GRANTED' and not(
  coalesce((new.scopes->>'identity')::boolean,false) and coalesce((new.scopes->>'agriculture')::boolean,false)
  and coalesce((new.scopes->>'gps')::boolean,false) and coalesce((new.scopes->>'photos')::boolean,false)
  and coalesce((new.scopes->>'training')::boolean,false) and coalesce((new.scopes->>'inspections')::boolean,false)
  and coalesce((new.scopes->>'transactions')::boolean,false)) then raise exception 'Un consentement GRANTED exige tous les perimetres.'; end if;
 if new.status='PARTIAL' and not(
  coalesce((new.scopes->>'identity')::boolean,false) or coalesce((new.scopes->>'agriculture')::boolean,false)
  or coalesce((new.scopes->>'gps')::boolean,false) or coalesce((new.scopes->>'photos')::boolean,false)
  or coalesce((new.scopes->>'training')::boolean,false) or coalesce((new.scopes->>'inspections')::boolean,false)
  or coalesce((new.scopes->>'transactions')::boolean,false)) then raise exception 'Un consentement PARTIAL exige au moins un perimetre.'; end if;
 if new.supersedes_id is null then select id into previous from public.farmer_consents
  where producteur_id=new.producteur_id order by created_at desc,consent_at desc limit 1; new.supersedes_id:=previous; end if;
 new.agent_id:=coalesce(new.agent_id,auth.uid()); new.created_by:=coalesce(new.created_by,auth.uid()); return new;
end $$;

create or replace function public.farmer_registry_refresh_passport(pid text)
returns void language plpgsql security definer set search_path=public as $$
declare p public.producteurs%rowtype; c public.farmer_consents%rowtype; identity_pts int:=0; assignment_pts int:=0; consent_pts int:=0; stage text:='INCOMPLETE'; risk text:='NOT_ASSESSED'; cs text:='NOT_RECORDED';
begin
 select * into p from public.producteurs where id=pid; if p.id is null then return; end if;
 select * into c from public.farmer_consents where producteur_id=pid order by created_at desc,consent_at desc limit 1;
 if nullif(btrim(p.nom),'') is not null and p.sexe is not null and (p.birth_year is not null or nullif(btrim(p.age_band),'') is not null)
  and length(public.farmer_registry_norm_phone(p.telephone))=10 then identity_pts:=30; end if;
 if p.village_id is not null and p.rt_id is not null then assignment_pts:=20; end if;
 if c.id is not null then cs:=c.status; if c.status='GRANTED' then consent_pts:=15; elsif c.status='PARTIAL' then consent_pts:=8; end if; end if;
 if identity_pts=30 and assignment_pts=20 and cs='GRANTED' then stage:='BASIC'; end if;
 if p.review_required or p.possible_duplicate or cs in('PARTIAL','REFUSED','WITHDRAWN') then risk:='REVIEW_REQUIRED'; end if;
 update public.producteurs set passport_completion=identity_pts+assignment_pts+consent_pts,passport_stage=stage,risk_profile=risk,
  consent_status=cs,consent_date=case when c.id is null then null else c.consent_at end,
  consent_version=case when c.id is null then null else c.text_version end,
  consent_method=case when c.id is null then null else c.method end
 where id=pid;
end $$;

create or replace function public.farmer_possible_duplicates(p_nom text,p_telephone text,p_village_id text,p_exclude_id text default null)
returns table(producteur_id text,farmer_id text,nom text,village_id text,reason text,confidence integer)
language sql stable security invoker set search_path=public as $$
 with q as(select public.farmer_registry_norm_text(p_nom) nn,public.farmer_registry_norm_phone(p_telephone) pn)
 select p.id,p.code,p.nom,p.village_id,
  case when q.pn<>'' and public.farmer_registry_norm_phone(p.telephone)=q.pn and p.village_id=p_village_id then 'SAME_PHONE_SAME_VILLAGE'
       when q.pn<>'' and public.farmer_registry_norm_phone(p.telephone)=q.pn then 'SAME_PHONE_OTHER_VILLAGE'
       else 'SAME_NAME_SAME_VILLAGE' end,
  case when q.pn<>'' and public.farmer_registry_norm_phone(p.telephone)=q.pn and p.village_id=p_village_id then 95
       when q.pn<>'' and public.farmer_registry_norm_phone(p.telephone)=q.pn then 80 else 65 end
 from public.producteurs p cross join q where not p.deleted and (p_exclude_id is null or p.id<>p_exclude_id)
 and((q.pn<>'' and public.farmer_registry_norm_phone(p.telephone)=q.pn)
  or(q.nn<>'' and public.farmer_registry_norm_text(p.nom)=q.nn and p.village_id=p_village_id))
 order by 6 desc,p.created_at limit 10
$$;

create or replace function public.farmer_registry_refresh_from_producteur_trigger()
returns trigger language plpgsql security definer set search_path=public as $$begin perform public.farmer_registry_refresh_passport(new.id);return new;end$$;
create or replace function public.farmer_registry_refresh_from_consent_trigger()
returns trigger language plpgsql security definer set search_path=public as $$begin perform public.farmer_registry_refresh_passport(new.producteur_id);return new;end$$;

create or replace function public.farmer_registry_audit_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare rid text; b jsonb; a jsonb;
begin
 rid:=coalesce(case when tg_op='DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end,
  case when tg_op='DELETE' then to_jsonb(old)->>'producteur_id' else to_jsonb(new)->>'producteur_id' end,'UNKNOWN');
 b:=case when tg_op in('UPDATE','DELETE') then to_jsonb(old) end;
 a:=case when tg_op in('INSERT','UPDATE') then to_jsonb(new) end;
 if tg_table_name='producteurs' then
  if b is not null then b:=jsonb_set(b-'id_document_number','{data}',coalesce(b->'data','{}'::jsonb)-'pieceNum',true);end if;
  if a is not null then a:=jsonb_set(a-'id_document_number','{data}',coalesce(a->'data','{}'::jsonb)-'pieceNum',true);end if;
 elsif tg_table_name='farmer_identity_documents' then b:=b-'document_number';a:=a-'document_number'; end if;
 insert into public.farmer_change_log(table_name,record_id,operation,before_data,after_data,actor_id,actor_email,actor_role)
 values(tg_table_name,rid,tg_op,b,a,auth.uid(),public.fbms_email(),public.fbms_role());
 if tg_op='DELETE' then return old;end if;return new;
end$$;

drop trigger if exists trg_code_producteur on public.producteurs;
drop trigger if exists trg_set_producteur_code on public.producteurs;
drop trigger if exists trg_farmer_registry_prepare_producteur on public.producteurs;
drop trigger if exists trg_farmer_registry_set_code on public.producteurs;
create trigger trg_farmer_registry_prepare_producteur before insert or update of data,nom,prenoms,sexe,birth_year,age_band,telephone,telephone_alt,preferred_language,id_document_type,id_document_number,village_id,village_nom,rt_id,statut,operational_status,possible_duplicate,review_required,review_reason
 on public.producteurs for each row execute function public.farmer_registry_prepare_producteur();
create trigger trg_farmer_registry_set_code before insert or update of code on public.producteurs
 for each row execute function public.farmer_registry_set_code();
drop trigger if exists trg_farmer_registry_prepare_consent on public.farmer_consents;
create trigger trg_farmer_registry_prepare_consent before insert on public.farmer_consents
 for each row execute function public.farmer_registry_prepare_consent();
drop trigger if exists trg_farmer_registry_refresh_producteur on public.producteurs;
create trigger trg_farmer_registry_refresh_producteur after insert or update of nom,prenoms,sexe,birth_year,age_band,telephone,village_id,rt_id,possible_duplicate,review_required
 on public.producteurs for each row execute function public.farmer_registry_refresh_from_producteur_trigger();
drop trigger if exists trg_farmer_registry_refresh_consent on public.farmer_consents;
create trigger trg_farmer_registry_refresh_consent after insert on public.farmer_consents
 for each row execute function public.farmer_registry_refresh_from_consent_trigger();
drop trigger if exists trg_farmer_registry_audit_producteurs on public.producteurs;
create trigger trg_farmer_registry_audit_producteurs after insert or update or delete on public.producteurs
 for each row execute function public.farmer_registry_audit_trigger();
drop trigger if exists trg_farmer_registry_audit_consents on public.farmer_consents;
create trigger trg_farmer_registry_audit_consents after insert or update or delete on public.farmer_consents
 for each row execute function public.farmer_registry_audit_trigger();
drop trigger if exists trg_farmer_registry_audit_identity_documents on public.farmer_identity_documents;
create trigger trg_farmer_registry_audit_identity_documents after insert or update or delete on public.farmer_identity_documents
 for each row execute function public.farmer_registry_audit_trigger();

create or replace view public.farmer_passport_summary_v with(security_invoker=true) as
select p.id producteur_id,p.code farmer_id,p.nom,p.prenoms,p.telephone,p.village_id,p.village_nom,p.rt_id,
 coalesce(r.id_rt,r.id) rt_code,coalesce(r.nom,r.data->>'nom') rt_nom,v.cluster_code,
 coalesce(c.label,v.cluster,v.data->'s1'->>'cluster') cluster_label,c.zone_code,z.label zone_label,
 p.operational_status,p.passport_stage,p.passport_completion,p.risk_profile,p.consent_status,p.consent_date,
 p.possible_duplicate,p.review_required,p.review_reason,p.record_version,p.updated_at,p.deleted
from public.producteurs p join public.villages v on v.id=p.village_id
left join public.rt r on r.id=p.rt_id left join public.aflp_clusters c on c.code=v.cluster_code
left join public.aflp_zones z on z.code=c.zone_code;

commit;
