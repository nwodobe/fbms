
create or replace function public.procurement_create_direct_supplier_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare c jsonb;r jsonb;sid uuid;u jsonb;b jsonb;v_entity text;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(private.procurement_supplier_editor_roles()) then
    raise exception 'Droit insuffisant pour créer un Supplier Direct' using errcode='42501';
  end if;

  v_entity:=upper(coalesce(nullif(btrim(p->>'entity_type'),''),'OTHER'));
  if v_entity not in ('COOPERATIVE','COMPANY','INDIVIDUAL','OTHER') then
    raise exception 'Entity Type invalide';
  end if;

  r:=public.procurement_create_supplier(
    jsonb_build_object(
      'name',p->>'name',
      'display_name',p->>'name',
      'legal_name',p->>'legal_name',
      'code',nullif(p->>'code',''),
      'procurement_mode','DIRECT',
      'entity_type',v_entity,
      'category',case when v_entity='COOPERATIVE' then 'COOPERATIVE' else 'DIRECT' end,
      'origins',coalesce(p->'origins',to_jsonb(p->>'origin')),
      'delivery_sites',coalesce(p->'delivery_sites',to_jsonb(p->>'site')),
      'contract',coalesce((p->>'contract')::boolean,false),
      'contract_status',coalesce(p->>'contract_status',case when coalesce((p->>'contract')::boolean,false) then 'ACTIVE' else 'NONE' end),
      'contract_reference',p->>'contract_reference',
      'contact_person',p->>'contact_person',
      'phone',p->>'phone',
      'email',p->>'email',
      'region',p->>'region',
      'registration_no',p->>'registration_no',
      'tax_id',p->>'tax_id',
      'address',p->>'address',
      'notes',p->>'notes',
      'source','OPERATIONS_PROCUREMENT_SUPPLIER'
    ) || case when p ? 'confirm_not_duplicate' then jsonb_build_object(
      'confirm_not_duplicate',p->'confirm_not_duplicate',
      'duplicate_override_reason',p->>'duplicate_override_reason'
    ) else '{}'::jsonb end
  );

  sid:=(r->>'supplier_id')::uuid;

  u:=public.procurement_update_supplier(
    sid,
    jsonb_strip_nulls(jsonb_build_object(
      'ccak_code',nullif(p->>'ccak_code',''),
      'phone_alt',nullif(p->>'phone_alt','')
    )),
    'Complément administratif création Supplier Direct'
  );

  if p ? 'bank' and jsonb_typeof(p->'bank')='object'
     and nullif(btrim(coalesce(p->'bank'->>'account_number','')),'') is not null then
    b:=public.procurement_save_supplier_bank_account(
      sid,p->'bank','RIB enregistré à la création du Supplier Direct'
    );
  end if;

  perform public.wms_audit(
    sid::text,
    'procurement.supplier.direct.profile.create',
    null,
    jsonb_build_object(
      'code',r->>'code',
      'ccak_code',p->>'ccak_code',
      'phone',p->>'phone',
      'bank_registered',b is not null,
      'procurement_mode','DIRECT'
    ),
    'Création dossier administratif Supplier Direct'
  );

  return r||jsonb_build_object(
    'supplier_id',sid,
    'admin',u,
    'bank_registered',b is not null,
    'procurement_mode','DIRECT'
  );
end $$;

revoke all on function public.procurement_create_direct_supplier_profile(jsonb) from public,anon;
grant execute on function public.procurement_create_direct_supplier_profile(jsonb) to authenticated;
