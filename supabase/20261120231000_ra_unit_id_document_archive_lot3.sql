-- AFLP Rainforest Alliance Lot 3: official identifier matching and private PDFs.
-- No existing parcel or consent is changed; no synthetic Farm Unit IDs.
create table if not exists public.farmer_plot_ra_units (
 plot_id uuid primary key references public.farmer_plots(id) on delete restrict,
 producteur_id text not null references public.producteurs(id),
 zone_code text,
 farm_id text not null check (char_length(farm_id) between 1 and 128 and farm_id=btrim(farm_id)),
 farm_unit_id text not null unique check (char_length(farm_unit_id) between 1 and 128 and farm_unit_id=btrim(farm_unit_id)),
 source_reference text not null check (char_length(btrim(source_reference)) between 6 and 300),
 status text not null default 'A_VERIFIER' check (status in ('A_VERIFIER','VERIFIE','REJETE')),
 created_by uuid not null, created_at timestamptz not null default now(),
 verified_by uuid, verified_at timestamptz, review_comment text
);
create index if not exists farmer_plot_ra_units_producteur_idx on public.farmer_plot_ra_units(producteur_id);
alter table public.farmer_plot_ra_units enable row level security;
drop policy if exists ra_units_read on public.farmer_plot_ra_units;
create policy ra_units_read on public.farmer_plot_ra_units for select to authenticated
 using (private.farmer_registry_can_read_sensitive() and private.plot_map_peut_lire(producteur_id,zone_code));
revoke all on public.farmer_plot_ra_units from anon,authenticated;
grant select on public.farmer_plot_ra_units to authenticated;

create or replace function public.plot_map_ra_unite_saisir(p_plot uuid,p_farm_id text,p_farm_unit_id text,p_source_reference text)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare cx record; old public.farmer_plot_ra_units; fid text:=btrim(coalesce(p_farm_id,'')); uid text:=btrim(coalesce(p_farm_unit_id,'')); src text:=btrim(coalesce(p_source_reference,''));
begin
 if private.plot_map_classe() not in ('BM','ZH','ABM') then raise exception 'Saisie réservée à la supervision.' using errcode='PM001'; end if;
 select * into cx from private.plot_map_contexte(p_plot);
 if cx.plot_id is null or cx.deleted or not private.plot_map_peut_lire(cx.producteur_id,cx.zone_code) then raise exception 'Parcelle inaccessible.' using errcode='PM001';end if;
 if not private.plot_map_consentement_gps(cx.producteur_id) then raise exception 'Consentement GPS absent.' using errcode='PM001'; end if;
 if length(fid) not between 1 and 128 or length(uid) not between 1 and 128 or length(src) not between 6 and 300
   or fid is distinct from p_farm_id or uid is distinct from p_farm_unit_id then
   raise exception 'Identifiants RA exacts et référence documentaire obligatoires ; préserver la casse.' using errcode='PM002';
 end if;
 select * into old from public.farmer_plot_ra_units where plot_id=p_plot for update;
 if old.plot_id is not null and old.status='VERIFIE' then raise exception 'Identifiant vérifié : modification interdite sans procédure de correction distincte.' using errcode='PM409';end if;
 insert into public.farmer_plot_ra_units(plot_id,producteur_id,zone_code,farm_id,farm_unit_id,source_reference,created_by)
 values(p_plot,cx.producteur_id,cx.zone_code,fid,uid,src,auth.uid())
 on conflict (plot_id) do update set farm_id=excluded.farm_id,farm_unit_id=excluded.farm_unit_id,
 source_reference=excluded.source_reference,created_by=auth.uid(),created_at=now(),status='A_VERIFIER',
 verified_by=null,verified_at=null,review_comment=null;
 perform private.plot_map_journaliser(p_plot,null,'RA_IDENTIFIANTS_SAISIS',null,jsonb_build_object('farm_unit_id',uid,'source_reference',src),null);
 return jsonb_build_object('statut','A_VERIFIER','plot_id',p_plot);
end $$;

create or replace function public.plot_map_ra_unite_verifier(p_plot uuid,p_decision text,p_commentaire text default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare u public.farmer_plot_ra_units; next_status text;
begin
 select * into u from public.farmer_plot_ra_units where plot_id=p_plot for update;
 if u.plot_id is null or u.status<>'A_VERIFIER' then raise exception 'Aucun identifiant RA en attente.' using errcode='PM409';end if;
 if private.plot_map_classe() not in ('BM','ZH') or not private.plot_map_peut_lire(u.producteur_id,u.zone_code) then
   raise exception 'Validation hors périmètre.' using errcode='PM001';end if;
 if u.created_by=auth.uid() then raise exception 'La vérification indépendante est obligatoire.' using errcode='PM001';end if;
 if p_decision not in ('VERIFIER','REJETER') then raise exception 'Décision inconnue.' using errcode='PM002';end if;
 if char_length(btrim(coalesce(p_commentaire,'')))<12 then raise exception 'Référence de rapprochement et motif de 12 caractères minimum obligatoires.' using errcode='PM002';end if;
 if not private.plot_map_consentement_gps(u.producteur_id) then raise exception 'Consentement GPS absent.' using errcode='PM001';end if;
 next_status:=case when p_decision='VERIFIER' then 'VERIFIE' else 'REJETE' end;
 update public.farmer_plot_ra_units set status=next_status,verified_by=auth.uid(),verified_at=now(),review_comment=btrim(p_commentaire) where plot_id=p_plot;
 perform private.plot_map_journaliser(p_plot,null,'RA_IDENTIFIANTS_'||next_status,
 jsonb_build_object('status',u.status),jsonb_build_object('status',next_status),p_commentaire);
 return jsonb_build_object('statut',next_status,'plot_id',p_plot);
end $$;
revoke all on function public.plot_map_ra_unite_saisir(uuid,text,text,text) from public,anon;
revoke all on function public.plot_map_ra_unite_verifier(uuid,text,text) from public,anon;
grant execute on function public.plot_map_ra_unite_saisir(uuid,text,text,text) to authenticated;
grant execute on function public.plot_map_ra_unite_verifier(uuid,text,text) to authenticated;

-- Private, non-overwriteable archive. No public URL policy.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('aflp-ra-plantation-pdfs','aflp-ra-plantation-pdfs',false,5242880,array['application/pdf']::text[])
on conflict (id) do nothing;

create table if not exists public.farmer_plot_ra_documents (
 id uuid primary key,
 plot_id uuid not null references public.farmer_plots(id) on delete restrict,
 geometry_id uuid not null references public.farmer_plot_geometries(id) on delete restrict,
 producteur_id text not null references public.producteurs(id),
 zone_code text,
 farm_unit_id text not null,
 geometry_version integer not null,
 storage_path text not null unique,
 claimed_sha256 text not null check (claimed_sha256 ~ '^[a-f0-9]{64}$'),
 byte_size integer not null check (byte_size between 100 and 5242880),
 status text not null default 'ARCHIVE_INTERNE' check (status='ARCHIVE_INTERNE'),
 created_by uuid not null,
 created_at timestamptz not null default now()
);
create index if not exists ra_docs_plot_idx on public.farmer_plot_ra_documents(plot_id,created_at desc);
alter table public.farmer_plot_ra_documents enable row level security;
drop policy if exists ra_docs_read on public.farmer_plot_ra_documents;
create policy ra_docs_read on public.farmer_plot_ra_documents for select to authenticated
 using (private.farmer_registry_can_read_sensitive() and private.plot_map_peut_lire(producteur_id,zone_code));
revoke all on public.farmer_plot_ra_documents from anon,authenticated;
grant select on public.farmer_plot_ra_documents to authenticated;

-- Format plot-uuid/geometry-uuid/document-uuid.pdf, no extra directories.
create or replace function private.ra_pdf_can_access(p_path text,p_read boolean)
returns boolean language plpgsql stable security definer set search_path=public,private,storage,pg_temp as $ra$
declare dirs text[]:=storage.foldername(p_path);
begin
 if coalesce(array_length(dirs,1),0)<>2
   or dirs[1] !~* '^[0-9a-f-]{36}$'
   or dirs[2] !~* '^[0-9a-f-]{36}$'
   or storage.filename(p_path) !~* '^[0-9a-f-]{36}[.]pdf$' then return false;end if;
 return exists(
  select 1 from public.farmer_plot_geometries g
  where g.plot_id=dirs[1]::uuid and g.id=dirs[2]::uuid
    and private.plot_map_peut_lire(g.producteur_id,g.zone_code)
    and private.plot_map_consentement_gps(g.producteur_id)
    and ((p_read and private.plot_map_classe() in ('BM','ZH','ABM'))
      or (not p_read and private.plot_map_classe() in ('BM','ZH')
         and g.status='VALIDE'
         and exists(select 1 from public.farmer_plot_ra_units u where u.plot_id=g.plot_id and u.status='VERIFIE')
         and exists(select 1 from public.plot_map_ra_preparation_v pr
                    where pr.geometry_id=g.id and pr.statut_preparation='REVUE_DOCUMENTAIRE_RA_REQUISE')));
end $ra$;
drop policy if exists ra_pdf_insert on storage.objects;
create policy ra_pdf_insert on storage.objects for insert to authenticated
with check (bucket_id='aflp-ra-plantation-pdfs' and private.ra_pdf_can_access(name,false));
drop policy if exists ra_pdf_read on storage.objects;
create policy ra_pdf_read on storage.objects for select to authenticated
using (bucket_id='aflp-ra-plantation-pdfs' and private.ra_pdf_can_access(name,true));

create or replace function public.plot_map_ra_document_archiver(p_id uuid,p_plot uuid,p_geometry uuid,p_path text,p_sha text,p_bytes integer)
returns jsonb language plpgsql security definer set search_path=public,private,storage,pg_temp as $arch$
declare
 g public.farmer_plot_geometries;
 u public.farmer_plot_ra_units;
 object_record record;
begin
 select * into g from public.farmer_plot_geometries where id=p_geometry;
 if g.id is null or g.plot_id is distinct from p_plot or g.status<>'VALIDE'
 or not private.ra_pdf_can_access(p_path,false) then
   raise exception 'Dossier cartographique non éligible.' using errcode='PM001';
 end if;
 if p_path is distinct from (p_plot::text||'/'||p_geometry::text||'/'||p_id::text||'.pdf') then
   raise exception 'Chemin documentaire invalide.' using errcode='PM002';
 end if;
 if not private.plot_map_consentement_gps(g.producteur_id) then
   raise exception 'Consentement absent.' using errcode='PM001';
 end if;
 select * into u from public.farmer_plot_ra_units where plot_id=p_plot and status='VERIFIE';
 if u.plot_id is null then raise exception 'Farm Unit ID non vérifié.' using errcode='PM001';end if;
 if p_sha !~ '^[a-f0-9]{64}$' or p_bytes<100 or p_bytes>5242880 then
   raise exception 'Empreinte ou taille incorrecte.' using errcode='PM002';
 end if;
 select o.name,o.owner_id,o.metadata into object_record from storage.objects o
 where o.bucket_id='aflp-ra-plantation-pdfs' and o.name=p_path;
 if object_record.name is null or object_record.owner_id is distinct from auth.uid()::text then
   raise exception 'PDF absent du stockage privé ou envoyé par un autre compte.' using errcode='PM001';
 end if;
 if (object_record.metadata->>'mimetype') is distinct from 'application/pdf'
 or coalesce((object_record.metadata->>'size')::integer,-1)<>p_bytes then
   raise exception 'Format ou taille du PDF incohérent.' using errcode='PM002';
 end if;
 insert into public.farmer_plot_ra_documents
  (id,plot_id,geometry_id,producteur_id,zone_code,farm_unit_id,geometry_version,storage_path,claimed_sha256,byte_size,created_by)
 values
  (p_id,p_plot,p_geometry,g.producteur_id,g.zone_code,u.farm_unit_id,g.version_no,p_path,p_sha,p_bytes,auth.uid());
 perform private.plot_map_journaliser(p_plot,p_geometry,'RA_PDF_ARCHIVE',null,
   jsonb_build_object('document_id',p_id,'storage_path',p_path,'sha256_client',p_sha),null);
 return jsonb_build_object('statut','ARCHIVE_INTERNE','document_id',p_id);
end $arch$;
revoke all on function public.plot_map_ra_document_archiver(uuid,uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.plot_map_ra_document_archiver(uuid,uuid,uuid,text,text,integer) to authenticated;
