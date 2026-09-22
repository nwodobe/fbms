
begin;

-- Administrative identity fields on stable supplier master.
alter table public.procurement_suppliers
  add column if not exists ccak_code text,
  add column if not exists phone_alt text;

create index if not exists procurement_suppliers_ccak_idx
  on public.procurement_suppliers (upper(ccak_code))
  where ccak_code is not null;

-- Versioned bank details (RIB). No physical delete: deactivate/replace instead.
create table if not exists public.procurement_supplier_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.procurement_suppliers(supplier_id) on delete restrict,
  account_holder text not null,
  bank_name text not null,
  bank_code text,
  branch_code text,
  account_number text not null,
  rib_key text,
  iban text,
  swift_bic text,
  currency text not null default 'XOF',
  is_primary boolean not null default true,
  status text not null default 'ACTIVE',
  valid_from date not null default current_date,
  valid_to date,
  change_reason text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint procurement_supplier_bank_status_chk check(status in ('ACTIVE','INACTIVE','REPLACED')),
  constraint procurement_supplier_bank_dates_chk check(valid_to is null or valid_to >= valid_from),
  constraint procurement_supplier_bank_currency_chk check(currency ~ '^[A-Z]{3}$')
);

create unique index if not exists procurement_supplier_one_primary_bank_uq
  on public.procurement_supplier_bank_accounts(supplier_id)
  where is_primary and status='ACTIVE';

create index if not exists procurement_supplier_bank_supplier_idx
  on public.procurement_supplier_bank_accounts(supplier_id,status,created_at desc);

alter table public.procurement_supplier_bank_accounts enable row level security;
drop policy if exists procurement_supplier_bank_read on public.procurement_supplier_bank_accounts;
create policy procurement_supplier_bank_read on public.procurement_supplier_bank_accounts
for select to authenticated using (
  private.ops_has_role(array[
    'Procurement Officer','LBA Purchase Officer','Branch Manager','Assistant Branch Manager',
    'General Manager','Finance','Coordination','Administrateur'
  ])
);
revoke insert,update,delete on public.procurement_supplier_bank_accounts from authenticated,anon;
grant select on public.procurement_supplier_bank_accounts to authenticated;

-- Private legal/document vault metadata.
create table if not exists public.procurement_supplier_documents (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.procurement_suppliers(supplier_id) on delete restrict,
  document_type text not null,
  title text not null,
  document_number text,
  issue_date date,
  expiry_date date,
  campaign text,
  bucket_id text not null default 'procurement-supplier-docs',
  storage_path text not null,
  original_file_name text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'ACTIVE',
  note text,
  version_no integer not null default 1,
  replaced_by uuid references public.procurement_supplier_documents(id) on delete restrict,
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_supplier_doc_type_chk check(document_type in (
    'CONTRAT','RCCM','PROCURATION','DELEGATION_POUVOIR',
    'AUTORISATION_SIGNATURE','DFE','RIB','OTHER'
  )),
  constraint procurement_supplier_doc_status_chk check(status in ('ACTIVE','EXPIRED','REPLACED','VOID')),
  constraint procurement_supplier_doc_dates_chk check(expiry_date is null or issue_date is null or expiry_date >= issue_date),
  constraint procurement_supplier_doc_bucket_chk check(bucket_id='procurement-supplier-docs')
);

create unique index if not exists procurement_supplier_document_path_uq
  on public.procurement_supplier_documents(storage_path);
create index if not exists procurement_supplier_document_supplier_idx
  on public.procurement_supplier_documents(supplier_id,document_type,status,created_at desc);

alter table public.procurement_supplier_documents enable row level security;
drop policy if exists procurement_supplier_documents_read on public.procurement_supplier_documents;
create policy procurement_supplier_documents_read on public.procurement_supplier_documents
for select to authenticated using (
  private.ops_has_role(array[
    'Procurement Officer','LBA Purchase Officer','Branch Manager','Assistant Branch Manager',
    'General Manager','Finance','Coordination','Administrateur'
  ])
);
revoke insert,update,delete on public.procurement_supplier_documents from authenticated,anon;
grant select on public.procurement_supplier_documents to authenticated;

-- Private Storage bucket (15 MB / file).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'procurement-supplier-docs','procurement-supplier-docs',false,15728640,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists procurement_supplier_docs_storage_insert on storage.objects;
create policy procurement_supplier_docs_storage_insert
on storage.objects for insert to authenticated
with check(
  bucket_id='procurement-supplier-docs'
  and private.ops_has_role(private.procurement_supplier_editor_roles())
  and (storage.foldername(name))[1]=(auth.uid())::text
  and ((storage.foldername(name))[2]) ~ '^[0-9a-fA-F-]{36}$'
);

drop policy if exists procurement_supplier_docs_storage_read on storage.objects;
create policy procurement_supplier_docs_storage_read
on storage.objects for select to authenticated
using(
  bucket_id='procurement-supplier-docs'
  and private.ops_has_role(array[
    'Procurement Officer','LBA Purchase Officer','Branch Manager','Assistant Branch Manager',
    'General Manager','Finance','Coordination','Administrateur'
  ])
);

-- Extend generic supplier create/update for administrative fields.
create or replace function public.procurement_update_supplier(p_supplier_id uuid, p jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare c jsonb; s public.procurement_suppliers; n public.procurement_suppliers; b jsonb:='{}'; a jsonb:='{}'; k text; v_dups jsonb;
  v_allowed text[]:=array[
    'display_name','legal_name','entity_type','contact_person','phone','phone_alt','email','region','origins','delivery_sites',
    'registration_no','tax_id','ccak_code','address','aliases','notes','contract_status','contract_reference',
    'contract_valid_from','contract_valid_to'
  ];
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(private.procurement_supplier_editor_roles()) then
    raise exception 'Droit insuffisant pour modifier un Supplier / LBA' using errcode='42501';
  end if;
  select * into s from public.procurement_suppliers where supplier_id=p_supplier_id for update;
  if s.supplier_id is null then raise exception 'Supplier introuvable'; end if;
  if p ? 'row_version' and (p->>'row_version')::int<>s.row_version then
    raise exception 'Fiche modifiée entre-temps (version % ≠ %) : rechargez',p->>'row_version',s.row_version using errcode='40001';
  end if;
  if p ? 'procurement_mode' and upper(p->>'procurement_mode')<>s.procurement_mode then
    raise exception 'Le mode Procurement se change via Change Procurement Mode (action auditée dédiée)';
  end if;
  if p ? 'status' and upper(p->>'status')<>s.status then raise exception 'Le statut se change via Change Status (motif obligatoire)'; end if;
  if p ? 'code' then raise exception 'Un code n''est jamais renommé : utilisez Change Procurement Mode'; end if;
  for k in select jsonb_object_keys(p) loop
    if k<>'row_version' and k<>'confirm_not_duplicate' and k<>'procurement_mode' and k<>'status' and not (k = any(v_allowed)) then
      raise exception 'Champ non modifiable : %',k;
    end if;
  end loop;

  n:=s;
  if p ? 'display_name' then n.display_name:=upper(btrim(regexp_replace(coalesce(p->>'display_name',''),'\s+',' ','g')));
    if n.display_name='' then raise exception 'Supplier Name obligatoire'; end if; n.name_key:=public.procurement_name_key(n.display_name); end if;
  if p ? 'legal_name' then n.legal_name:=nullif(upper(btrim(p->>'legal_name')),''); end if;
  if p ? 'entity_type' then n.entity_type:=upper(p->>'entity_type');
    if n.entity_type not in ('COOPERATIVE','COMPANY','INDIVIDUAL','OTHER') then raise exception 'Entity Type invalide'; end if; end if;
  if p ? 'contact_person' then n.contact_person:=nullif(btrim(p->>'contact_person'),''); end if;
  if p ? 'phone' then n.phone:=nullif(btrim(p->>'phone'),''); n.phone_key:=public.procurement_phone_key(n.phone); end if;
  if p ? 'phone_alt' then n.phone_alt:=nullif(btrim(p->>'phone_alt'),''); end if;
  if p ? 'email' then n.email:=nullif(lower(btrim(p->>'email')),''); end if;
  if p ? 'region' then n.region:=nullif(upper(btrim(p->>'region')),''); end if;
  if p ? 'origins' then n.origins:=private.procurement_text_array(p->'origins'); end if;
  if p ? 'delivery_sites' then n.delivery_sites:=private.procurement_text_array(p->'delivery_sites'); end if;
  if p ? 'registration_no' then n.registration_no:=nullif(upper(btrim(p->>'registration_no')),''); end if;
  if p ? 'tax_id' then n.tax_id:=nullif(upper(btrim(p->>'tax_id')),''); end if;
  if p ? 'ccak_code' then n.ccak_code:=nullif(upper(btrim(p->>'ccak_code')),''); end if;
  if p ? 'address' then n.address:=nullif(btrim(p->>'address'),''); end if;
  if p ? 'aliases' then n.aliases:=private.procurement_text_array(p->'aliases'); end if;
  if p ? 'notes' then n.notes:=nullif(btrim(p->>'notes'),''); end if;
  if p ? 'contract_status' then n.contract_status:=upper(coalesce(nullif(p->>'contract_status',''),'NONE'));
    if n.contract_status not in ('NONE','ACTIVE','EXPIRED','CLOSED') then raise exception 'Contract Status invalide'; end if; end if;
  if p ? 'contract_reference' then n.contract_reference:=nullif(btrim(p->>'contract_reference'),''); end if;
  if p ? 'contract_valid_from' then n.contract_valid_from:=nullif(p->>'contract_valid_from','')::date; end if;
  if p ? 'contract_valid_to' then n.contract_valid_to:=nullif(p->>'contract_valid_to','')::date; end if;

  if n.display_name is distinct from s.display_name or n.registration_no is distinct from s.registration_no then
    select coalesce(jsonb_agg(to_jsonb(d)),'[]') into v_dups from public.procurement_find_supplier_duplicates(
      jsonb_build_object('name',n.display_name,'registration_no',n.registration_no,'exclude_supplier_id',s.supplier_id)) d
     where d.match_type ~ '(EXACT_NAME|CORE_NAME|REGISTRATION_NO)';
    if jsonb_array_length(v_dups)>0 and (not coalesce((p->>'confirm_not_duplicate')::boolean,false) or v_dups::text ~ 'REGISTRATION_NO') then
      raise exception 'POSSIBLE_DUPLICATE_SUPPLIER : % (%)',v_dups->0->>'display_name',v_dups->0->>'current_code'
        using errcode='23505', detail=v_dups::text;
    end if;
  end if;

  foreach k in array v_allowed loop
    if to_jsonb(n)->k is distinct from to_jsonb(s)->k then
      b:=b||jsonb_build_object(k,to_jsonb(s)->k); a:=a||jsonb_build_object(k,to_jsonb(n)->k);
    end if;
  end loop;
  if a='{}'::jsonb then return to_jsonb(s)||jsonb_build_object('changed',false); end if;

  update public.procurement_suppliers set
    display_name=n.display_name,legal_name=n.legal_name,name_key=n.name_key,entity_type=n.entity_type,
    contact_person=n.contact_person,phone=n.phone,phone_key=n.phone_key,phone_alt=n.phone_alt,email=n.email,region=n.region,
    origins=n.origins,delivery_sites=n.delivery_sites,registration_no=n.registration_no,tax_id=n.tax_id,ccak_code=n.ccak_code,
    address=n.address,aliases=n.aliases,notes=n.notes,contract_status=n.contract_status,
    contract_reference=n.contract_reference,contract_valid_from=n.contract_valid_from,contract_valid_to=n.contract_valid_to,
    updated_at=now(),updated_by=(c->>'uid')::uuid,updated_by_name=c->>'nom',row_version=s.row_version+1
  where supplier_id=s.supplier_id returning * into n;

  perform private.procurement_sync_code_projection(s.supplier_id);
  perform public.wms_audit(s.supplier_id::text,'procurement.supplier.update',b,a,coalesce(nullif(btrim(p_reason),''),'Modification fiche partenaire'));
  return to_jsonb(n)||jsonb_build_object('changed',true,'before',b,'after',a);
end $$;

-- Bank account save/replace. One active primary bank account per supplier.
create or replace function public.procurement_save_supplier_bank_account(
  p_supplier_id uuid,p jsonb,p_reason text default null
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare c jsonb;s public.procurement_suppliers;old public.procurement_supplier_bank_accounts;r public.procurement_supplier_bank_accounts;
  v_holder text;v_bank text;v_account text;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(array[
    'Procurement Officer','LBA Purchase Officer','Branch Manager','Assistant Branch Manager',
    'General Manager','Finance','Coordination','Administrateur'
  ]) then raise exception 'Droit insuffisant pour enregistrer un RIB' using errcode='42501'; end if;
  select * into s from public.procurement_suppliers where supplier_id=p_supplier_id;
  if s.supplier_id is null then raise exception 'Supplier introuvable'; end if;

  v_holder:=nullif(btrim(p->>'account_holder'),'');
  v_bank:=nullif(btrim(p->>'bank_name'),'');
  v_account:=regexp_replace(coalesce(p->>'account_number',''),'\s+','','g');
  if v_holder is null or v_bank is null or v_account='' then
    raise exception 'Titulaire, banque et numéro de compte sont obligatoires';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then p_reason:='Création / mise à jour RIB'; end if;

  select * into old from public.procurement_supplier_bank_accounts
   where supplier_id=p_supplier_id and is_primary and status='ACTIVE'
   order by created_at desc limit 1 for update;

  if old.id is not null then
    update public.procurement_supplier_bank_accounts
      set status='REPLACED',is_primary=false,valid_to=current_date,change_reason=p_reason,
          updated_by=(c->>'uid')::uuid,updated_by_name=c->>'nom',updated_at=now(),row_version=row_version+1
    where id=old.id;
  end if;

  insert into public.procurement_supplier_bank_accounts(
    supplier_id,account_holder,bank_name,bank_code,branch_code,account_number,rib_key,iban,swift_bic,currency,
    is_primary,status,valid_from,change_reason,created_by,created_by_name,updated_by,updated_by_name
  ) values(
    p_supplier_id,upper(v_holder),upper(v_bank),nullif(upper(btrim(p->>'bank_code')),''),
    nullif(upper(btrim(p->>'branch_code')),''),v_account,nullif(upper(btrim(p->>'rib_key')),''),
    nullif(upper(regexp_replace(coalesce(p->>'iban',''),'\s+','','g')),''),
    nullif(upper(btrim(p->>'swift_bic')),''),upper(coalesce(nullif(btrim(p->>'currency'),''),'XOF')),
    true,'ACTIVE',coalesce(nullif(p->>'valid_from','')::date,current_date),p_reason,
    (c->>'uid')::uuid,c->>'nom',(c->>'uid')::uuid,c->>'nom'
  ) returning * into r;

  perform public.wms_audit(
    p_supplier_id::text,'procurement.supplier.bank',
    case when old.id is null then null else jsonb_build_object('bank_name',old.bank_name,'account_last4',right(old.account_number,4)) end,
    jsonb_build_object('bank_name',r.bank_name,'account_last4',right(r.account_number,4),'rib_key',r.rib_key,'currency',r.currency),
    p_reason
  );
  return jsonb_build_object(
    'id',r.id,'supplier_id',r.supplier_id,'account_holder',r.account_holder,'bank_name',r.bank_name,
    'bank_code',r.bank_code,'branch_code',r.branch_code,'account_number',r.account_number,'rib_key',r.rib_key,
    'iban',r.iban,'swift_bic',r.swift_bic,'currency',r.currency,'status',r.status,'is_primary',r.is_primary
  );
end $$;

create or replace function public.procurement_get_supplier_bank_accounts(p_supplier_id uuid)
returns table(
  id uuid,account_holder text,bank_name text,bank_code text,branch_code text,account_number text,rib_key text,
  iban text,swift_bic text,currency text,is_primary boolean,status text,valid_from date,valid_to date,created_at timestamptz
)
language plpgsql security definer set search_path=public
as $$
begin
  perform public.wms_ctx();
  if not private.ops_has_role(array[
    'Procurement Officer','LBA Purchase Officer','Branch Manager','Assistant Branch Manager',
    'General Manager','Finance','Coordination','Administrateur'
  ]) then raise exception 'Accès RIB non autorisé' using errcode='42501'; end if;
  return query
    select b.id,b.account_holder,b.bank_name,b.bank_code,b.branch_code,b.account_number,b.rib_key,
           b.iban,b.swift_bic,b.currency,b.is_primary,b.status,b.valid_from,b.valid_to,b.created_at
      from public.procurement_supplier_bank_accounts b
     where b.supplier_id=p_supplier_id
     order by b.is_primary desc,b.created_at desc;
end $$;

-- LBA enriched create: identity + administrative fields + optional RIB in one transaction.
create or replace function public.procurement_create_lba_profile(p jsonb)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare c jsonb;r jsonb;sid uuid;u jsonb;b jsonb;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(private.procurement_supplier_editor_roles()) then
    raise exception 'Droit insuffisant pour créer un LBA' using errcode='42501';
  end if;

  r:=public.procurement_create_supplier(
    jsonb_build_object(
      'name',p->>'name','display_name',p->>'name','legal_name',p->>'legal_name',
      'code',nullif(p->>'code',''),'procurement_mode','LBA','entity_type',coalesce(nullif(p->>'entity_type',''),'COOPERATIVE'),
      'origins',coalesce(p->'origins',to_jsonb(p->>'origin')),'delivery_sites',coalesce(p->'delivery_sites',to_jsonb(p->>'site')),
      'contract',coalesce((p->>'contract')::boolean,false),'contract_status',coalesce(p->>'contract_status',case when coalesce((p->>'contract')::boolean,false) then 'ACTIVE' else 'NONE' end),
      'contract_reference',p->>'contract_reference','contact_person',p->>'contact_person','phone',p->>'phone',
      'email',p->>'email','region',p->>'region','registration_no',p->>'registration_no','tax_id',p->>'tax_id',
      'address',p->>'address','notes',p->>'notes','source','OPERATIONS_PROCUREMENT_LBA'
    ) || case when p ? 'confirm_not_duplicate' then jsonb_build_object(
      'confirm_not_duplicate',p->'confirm_not_duplicate','duplicate_override_reason',p->>'duplicate_override_reason'
    ) else '{}'::jsonb end
  );

  sid:=(r->>'supplier_id')::uuid;
  u:=public.procurement_update_supplier(
    sid,
    jsonb_strip_nulls(jsonb_build_object(
      'ccak_code',nullif(p->>'ccak_code',''),
      'phone_alt',nullif(p->>'phone_alt','')
    )),
    'Complément administratif création LBA'
  );

  if p ? 'bank' and jsonb_typeof(p->'bank')='object'
     and nullif(btrim(coalesce(p->'bank'->>'account_number','')),'') is not null then
    b:=public.procurement_save_supplier_bank_account(sid,p->'bank','RIB enregistré à la création du LBA');
  end if;

  perform public.wms_audit(
    sid::text,'procurement.lba.profile.create',null,
    jsonb_build_object('code',r->>'code','ccak_code',p->>'ccak_code','phone',p->>'phone','bank_registered',b is not null),
    'Création dossier administratif LBA'
  );
  return r||jsonb_build_object('supplier_id',sid,'admin',u,'bank_registered',b is not null);
end $$;

-- Register a file already uploaded to the private bucket.
create or replace function public.procurement_register_supplier_document(
  p_supplier_id uuid,p_document_type text,p_title text,p_storage_path text,p_document_number text default null,
  p_issue_date date default null,p_expiry_date date default null,p_campaign text default null,p_note text default null
) returns jsonb
language plpgsql security definer set search_path=public,storage
as $$
declare c jsonb;s public.procurement_suppliers;o storage.objects;r public.procurement_supplier_documents;v_type text;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(private.procurement_supplier_editor_roles()) then
    raise exception 'Droit insuffisant pour enregistrer un document LBA' using errcode='42501';
  end if;
  select * into s from public.procurement_suppliers where supplier_id=p_supplier_id;
  if s.supplier_id is null then raise exception 'Supplier introuvable'; end if;
  v_type:=upper(btrim(coalesce(p_document_type,'')));
  if v_type not in ('CONTRAT','RCCM','PROCURATION','DELEGATION_POUVOIR','AUTORISATION_SIGNATURE','DFE','RIB','OTHER') then
    raise exception 'Type de document invalide';
  end if;
  if nullif(btrim(p_title),'') is null then raise exception 'Titre du document obligatoire'; end if;
  if p_expiry_date is not null and p_issue_date is not null and p_expiry_date<p_issue_date then
    raise exception 'Date expiration antérieure à date émission';
  end if;
  if p_storage_path not like (auth.uid()::text||'/'||p_supplier_id::text||'/%') then
    raise exception 'Chemin Storage invalide pour ce Supplier';
  end if;

  select * into o from storage.objects
   where bucket_id='procurement-supplier-docs' and name=p_storage_path;
  if o.id is null then raise exception 'Fichier non trouvé dans le coffre documentaire'; end if;

  insert into public.procurement_supplier_documents(
    supplier_id,document_type,title,document_number,issue_date,expiry_date,campaign,
    storage_path,original_file_name,mime_type,size_bytes,note,uploaded_by,uploaded_by_name
  ) values(
    p_supplier_id,v_type,btrim(p_title),nullif(btrim(p_document_number),''),p_issue_date,p_expiry_date,
    nullif(btrim(p_campaign),''),p_storage_path,
    coalesce(o.metadata->>'filename',split_part(p_storage_path,'/',array_length(string_to_array(p_storage_path,'/'),1))),
    o.metadata->>'mimetype',nullif(o.metadata->>'size','')::bigint,nullif(btrim(p_note),''),
    (c->>'uid')::uuid,c->>'nom'
  ) returning * into r;

  perform public.wms_audit(
    p_supplier_id::text,'procurement.supplier.document.add',null,
    jsonb_build_object('document_id',r.id,'type',r.document_type,'title',r.title,'file',r.original_file_name),
    'Ajout document administratif'
  );
  return to_jsonb(r);
end $$;

create or replace function public.procurement_void_supplier_document(p_document_id uuid,p_reason text)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare c jsonb;r public.procurement_supplier_documents;b jsonb;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(private.procurement_supplier_editor_roles()) then
    raise exception 'Droit insuffisant pour invalider un document' using errcode='42501';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Motif obligatoire'; end if;
  select * into r from public.procurement_supplier_documents where id=p_document_id for update;
  if r.id is null then raise exception 'Document introuvable'; end if;
  if r.status<>'ACTIVE' then raise exception 'Document déjà non actif'; end if;
  b:=to_jsonb(r);
  update public.procurement_supplier_documents set status='VOID',note=concat_ws(E'\n',note,'Invalidation: '||p_reason),updated_at=now()
   where id=p_document_id returning * into r;
  perform public.wms_audit(r.supplier_id::text,'procurement.supplier.document.void',b,to_jsonb(r),p_reason);
  return to_jsonb(r);
end $$;

create or replace view public.procurement_v_supplier_bank_masked
with (security_invoker=true) as
select
  b.id,b.supplier_id,b.account_holder,b.bank_name,b.bank_code,b.branch_code,
  case when length(b.account_number)<=4 then repeat('*',length(b.account_number))
       else repeat('*',greatest(length(b.account_number)-4,0))||right(b.account_number,4) end account_number_masked,
  b.rib_key,
  case when b.iban is null then null
       when length(b.iban)<=6 then repeat('*',length(b.iban))
       else left(b.iban,2)||repeat('*',greatest(length(b.iban)-6,0))||right(b.iban,4) end iban_masked,
  b.swift_bic,b.currency,b.is_primary,b.status,b.valid_from,b.valid_to,b.created_at
from public.procurement_supplier_bank_accounts b;

grant select on public.procurement_v_supplier_bank_masked to authenticated;

create or replace view public.procurement_v_supplier_admin_profile
with (security_invoker=true) as
select
  s.supplier_id,s.display_name,s.legal_name,s.entity_type,s.procurement_mode,s.status,
  s.contact_person,s.phone,s.phone_alt,s.email,s.region,s.address,s.registration_no,s.tax_id,s.ccak_code,
  s.contract_status,s.contract_reference,s.contract_valid_from,s.contract_valid_to,s.origins,s.delivery_sites,s.notes,
  ch.code current_code,
  bm.bank_name,bm.account_holder,bm.account_number_masked,bm.iban_masked,bm.rib_key,bm.swift_bic,
  coalesce(d.total_documents,0) total_documents,
  coalesce(d.active_documents,0) active_documents,
  coalesce(d.contract_docs,0) contract_docs,
  coalesce(d.rccm_docs,0) rccm_docs,
  coalesce(d.dfe_docs,0) dfe_docs,
  s.row_version,s.updated_at
from public.procurement_suppliers s
left join public.procurement_supplier_code_history ch
  on ch.supplier_id=s.supplier_id and ch.is_current
left join public.procurement_v_supplier_bank_masked bm
  on bm.supplier_id=s.supplier_id and bm.is_primary and bm.status='ACTIVE'
left join lateral (
  select count(*) total_documents,
         count(*) filter(where status='ACTIVE') active_documents,
         count(*) filter(where status='ACTIVE' and document_type='CONTRAT') contract_docs,
         count(*) filter(where status='ACTIVE' and document_type='RCCM') rccm_docs,
         count(*) filter(where status='ACTIVE' and document_type='DFE') dfe_docs
  from public.procurement_supplier_documents x
  where x.supplier_id=s.supplier_id
) d on true;

grant select on public.procurement_v_supplier_admin_profile to authenticated;

-- Allow admin fields in supplier create by post-create update from enriched LBA RPC; keep generic create stable.
revoke all on function public.procurement_create_lba_profile(jsonb) from public,anon;
grant execute on function public.procurement_create_lba_profile(jsonb) to authenticated;
revoke all on function public.procurement_save_supplier_bank_account(uuid,jsonb,text) from public,anon;
grant execute on function public.procurement_save_supplier_bank_account(uuid,jsonb,text) to authenticated;
revoke all on function public.procurement_get_supplier_bank_accounts(uuid) from public,anon;
grant execute on function public.procurement_get_supplier_bank_accounts(uuid) to authenticated;
revoke all on function public.procurement_register_supplier_document(uuid,text,text,text,text,date,date,text,text) from public,anon;
grant execute on function public.procurement_register_supplier_document(uuid,text,text,text,text,date,date,text,text) to authenticated;
revoke all on function public.procurement_void_supplier_document(uuid,text) from public,anon;
grant execute on function public.procurement_void_supplier_document(uuid,text) to authenticated;

commit;
