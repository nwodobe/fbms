
begin;

create or replace function public.procurement_field_create_lot(p jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  c jsonb; v_id uuid; v_code text; v_scope text; v_scope_id text; v_scope_label text;
  v_purchase jsonb; x jsonb; v_achat uuid; v_qty numeric; v_bags int;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(array[
    'Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
    'Field Buying Operations Officer','Zonal Head','Unit Head','Supervisor','Administrateur'
  ]) then raise exception 'Droit insuffisant pour créer un lot terrain'; end if;

  v_scope:=upper(coalesce(nullif(p->>'scope_type',''),'VILLAGE'));
  if v_scope not in ('VILLAGE','CLUSTER','MIXED') then raise exception 'Scope Type invalide'; end if;
  v_scope_id:=nullif(btrim(p->>'scope_id'),'');
  v_scope_label:=nullif(btrim(p->>'scope_label'),'');
  if v_scope_label is null then raise exception 'Scope Label obligatoire'; end if;
  v_code:=upper(nullif(btrim(p->>'lot_code'),''));
  if v_code is null then
    v_code:='FLD-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  end if;

  insert into public.field_lots(local_id,lot_code,scope_type,scope_id,scope_label,status,notes,created_by)
  values(nullif(p->>'local_id',''),v_code,v_scope,v_scope_id,v_scope_label,'FORMING',nullif(p->>'notes',''),(c->>'uid')::uuid)
  returning id into v_id;

  v_purchase:=coalesce(p->'purchases','[]'::jsonb);
  if jsonb_typeof(v_purchase)<>'array' or jsonb_array_length(v_purchase)=0 then
    raise exception 'Au moins un achat terrain est obligatoire';
  end if;

  for x in select value from jsonb_array_elements(v_purchase)
  loop
    v_achat:=(x->>'achat_id')::uuid;
    v_qty:=nullif(x->>'qty_kg','')::numeric;
    v_bags:=nullif(x->>'bag_count','')::int;
    if v_qty is null or v_qty<=0 then raise exception 'Quantité contributeur invalide'; end if;
    insert into public.field_lot_contributors(local_id,lot_id,achat_id,qty_kg,bag_count,status,created_by)
    values(nullif(x->>'local_id',''),v_id,v_achat,v_qty,v_bags,'ACTIVE',(c->>'uid')::uuid);
  end loop;

  update public.field_lots set status='SEALED',sealed_at=now(),updated_by=(c->>'uid')::uuid,updated_at=now()
  where id=v_id;

  perform public.wms_audit(v_id::text,'procurement.field_lot',null,
    jsonb_build_object('lot_code',v_code,'scope_type',v_scope,'scope_label',v_scope_label,'purchases',v_purchase),
    'Consolidation Achat Bord Champ');
  return jsonb_build_object('id',v_id,'lot_code',v_code,'status','SEALED');
end $$;

create or replace function public.procurement_field_create_shipment(p jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  c jsonb; v_id uuid; v_code text; v_origin_type text; v_dest_type text; v_status text;
  v_lots jsonb; x jsonb; v_lot uuid; v_loaded numeric; v_planned numeric; v_total numeric:=0;
  v_wh public.wms_warehouses;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(array[
    'Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
    'Field Buying Operations Officer','Zonal Head','Unit Head','Supervisor','Administrateur'
  ]) then raise exception 'Droit insuffisant pour créer une évacuation'; end if;

  v_origin_type:=upper(coalesce(nullif(p->>'origin_type',''),'VILLAGE'));
  if v_origin_type not in ('VILLAGE','WAREHOUSE','BOUAKE_WAREHOUSE','OTHER') then raise exception 'Origin Type invalide'; end if;
  v_dest_type:=upper(coalesce(nullif(p->>'destination_type',''),'WAREHOUSE'));
  if v_dest_type not in ('WAREHOUSE','FACTORY','OTHER') then raise exception 'Destination Type invalide'; end if;
  if nullif(btrim(p->>'origin_label'),'') is null then raise exception 'Origin obligatoire'; end if;
  if nullif(btrim(p->>'destination_label'),'') is null then raise exception 'Destination obligatoire'; end if;
  if nullif(btrim(p->>'vehicle_plate'),'') is null then raise exception 'Truck Number obligatoire'; end if;

  if v_dest_type='WAREHOUSE' then
    select * into v_wh from public.wms_warehouses
    where id::text=nullif(p->>'destination_id','')
       or upper(code)=upper(coalesce(p->>'destination_id',''))
    limit 1;
    if v_wh.id is null or v_wh.status<>'ACTIVE' then raise exception 'Destination Warehouse invalide ou inactive'; end if;
  end if;

  v_code:=upper(nullif(btrim(p->>'shipment_code'),''));
  if v_code is null then
    v_code:='SHP-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  end if;

  insert into public.field_shipments(
    local_id,shipment_code,origin_type,origin_id,origin_label,destination_type,destination_id,destination_label,
    vehicle_plate,driver_name,planned_qty_kg,status,document_ref,notes,created_by
  ) values(
    nullif(p->>'local_id',''),v_code,v_origin_type,nullif(p->>'origin_id',''),btrim(p->>'origin_label'),
    v_dest_type,case when v_dest_type='WAREHOUSE' then v_wh.id::text else nullif(p->>'destination_id','') end,
    case when v_dest_type='WAREHOUSE' then v_wh.code||' - '||v_wh.name else btrim(p->>'destination_label') end,
    upper(regexp_replace(p->>'vehicle_plate','\s+','','g')),nullif(p->>'driver_name',''),
    nullif(p->>'planned_qty_kg','')::numeric,'LOADING',nullif(p->>'document_ref',''),nullif(p->>'notes',''),
    (c->>'uid')::uuid
  ) returning id into v_id;

  v_lots:=coalesce(p->'lots','[]'::jsonb);
  if jsonb_typeof(v_lots)<>'array' or jsonb_array_length(v_lots)=0 then
    raise exception 'Au moins un lot terrain est obligatoire';
  end if;

  for x in select value from jsonb_array_elements(v_lots)
  loop
    v_lot:=(x->>'lot_id')::uuid;
    v_loaded:=nullif(x->>'loaded_qty_kg','')::numeric;
    v_planned:=coalesce(nullif(x->>'planned_qty_kg','')::numeric,v_loaded);
    if v_loaded is null or v_loaded<=0 then raise exception 'Loaded Quantity invalide'; end if;
    insert into public.field_shipment_lots(local_id,shipment_id,lot_id,planned_qty_kg,loaded_qty_kg,created_by)
    values(nullif(x->>'local_id',''),v_id,v_lot,v_planned,v_loaded,(c->>'uid')::uuid);
    v_total:=v_total+v_loaded;
  end loop;

  update public.field_shipments set planned_qty_kg=coalesce(planned_qty_kg,v_total),dispatched_qty_kg=v_total,
    status='DISPATCHED',departed_at=coalesce(nullif(p->>'departed_at','')::timestamptz,now()),
    updated_by=(c->>'uid')::uuid,updated_at=now()
  where id=v_id;

  -- Les lignes de shipment ont été créées pendant LOADING; déclencher maintenant le mouvement physique canonique
  -- en rejouant le trigger via UPDATE no-op sur loaded_qty_kg.
  update public.field_shipment_lots set loaded_qty_kg=loaded_qty_kg,updated_by=(c->>'uid')::uuid,updated_at=now()
  where shipment_id=v_id;

  perform public.wms_audit(v_id::text,'procurement.field_shipment',null,
    jsonb_build_object('shipment_code',v_code,'origin',p->>'origin_label','destination',
      case when v_dest_type='WAREHOUSE' then v_wh.code else p->>'destination_label' end,
      'truck',p->>'vehicle_plate','dispatched_qty_kg',v_total,'lots',v_lots),
    'Evacuation Achat Bord Champ');
  return jsonb_build_object('id',v_id,'shipment_code',v_code,'status','DISPATCHED','dispatched_qty_kg',v_total);
end $$;

revoke all on function public.procurement_field_create_lot(jsonb) from public,anon;
revoke all on function public.procurement_field_create_shipment(jsonb) from public,anon;
grant execute on function public.procurement_field_create_lot(jsonb) to authenticated;
grant execute on function public.procurement_field_create_shipment(jsonb) to authenticated;

commit;
