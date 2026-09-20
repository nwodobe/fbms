
create or replace function public.procurement_field_create_shipment(p jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  c jsonb; v_id uuid; v_code text; v_origin_type text; v_dest_type text;
  v_lots jsonb; x jsonb; v_lot uuid; v_loaded numeric; v_planned numeric; v_total numeric:=0;
  v_wh public.wms_warehouses; v_departed timestamptz;
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

  v_lots:=coalesce(p->'lots','[]'::jsonb);
  if jsonb_typeof(v_lots)<>'array' or jsonb_array_length(v_lots)=0 then
    raise exception 'Au moins un lot terrain est obligatoire';
  end if;

  -- Valider et sommer avant de créer le Shipment.
  for x in select value from jsonb_array_elements(v_lots)
  loop
    v_lot:=(x->>'lot_id')::uuid;
    v_loaded:=nullif(x->>'loaded_qty_kg','')::numeric;
    if v_loaded is null or v_loaded<=0 then raise exception 'Loaded Quantity invalide'; end if;
    if not exists(select 1 from public.field_lots where id=v_lot and status in ('SEALED','IN_STOCK','IN_TRANSIT')) then
      raise exception 'Lot % introuvable ou non expédiable',v_lot;
    end if;
    v_total:=v_total+v_loaded;
  end loop;

  v_code:=upper(nullif(btrim(p->>'shipment_code'),''));
  if v_code is null then
    v_code:='SHP-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  end if;
  v_departed:=coalesce(nullif(p->>'departed_at','')::timestamptz,now());

  -- Le Shipment est DISPATCHED avant l'insertion des lignes : le trigger existant
  -- crée ainsi exactement un field_stock_movement par Lot.
  insert into public.field_shipments(
    local_id,shipment_code,origin_type,origin_id,origin_label,destination_type,destination_id,destination_label,
    vehicle_plate,driver_name,planned_qty_kg,dispatched_qty_kg,status,departed_at,document_ref,notes,created_by
  ) values(
    nullif(p->>'local_id',''),v_code,v_origin_type,nullif(p->>'origin_id',''),btrim(p->>'origin_label'),
    v_dest_type,case when v_dest_type='WAREHOUSE' then v_wh.id::text else nullif(p->>'destination_id','') end,
    case when v_dest_type='WAREHOUSE' then v_wh.code||' - '||v_wh.name else btrim(p->>'destination_label') end,
    upper(regexp_replace(p->>'vehicle_plate','\s+','','g')),nullif(p->>'driver_name',''),
    coalesce(nullif(p->>'planned_qty_kg','')::numeric,v_total),v_total,'DISPATCHED',v_departed,
    nullif(p->>'document_ref',''),nullif(p->>'notes',''),(c->>'uid')::uuid
  ) returning id into v_id;

  for x in select value from jsonb_array_elements(v_lots)
  loop
    v_lot:=(x->>'lot_id')::uuid;
    v_loaded:=nullif(x->>'loaded_qty_kg','')::numeric;
    v_planned:=coalesce(nullif(x->>'planned_qty_kg','')::numeric,v_loaded);
    insert into public.field_shipment_lots(local_id,shipment_id,lot_id,planned_qty_kg,loaded_qty_kg,created_by)
    values(nullif(x->>'local_id',''),v_id,v_lot,v_planned,v_loaded,(c->>'uid')::uuid);
    update public.field_lots set status='IN_TRANSIT',updated_by=(c->>'uid')::uuid,updated_at=now()
    where id=v_lot and status<>'CANCELLED';
  end loop;

  if (select count(*) from public.field_stock_movements where shipment_id=v_id and status='DISPATCHED')
     <> jsonb_array_length(v_lots) then
    raise exception 'Échec de matérialisation des mouvements physiques de l''évacuation';
  end if;

  perform public.wms_audit(v_id::text,'procurement.field_shipment',null,
    jsonb_build_object('shipment_code',v_code,'origin',p->>'origin_label','destination',
      case when v_dest_type='WAREHOUSE' then v_wh.code else p->>'destination_label' end,
      'truck',p->>'vehicle_plate','dispatched_qty_kg',v_total,'lots',v_lots),
    'Evacuation Achat Bord Champ');
  return jsonb_build_object('id',v_id,'shipment_code',v_code,'status','DISPATCHED','dispatched_qty_kg',v_total);
end $$;

revoke all on function public.procurement_field_create_shipment(jsonb) from public,anon;
grant execute on function public.procurement_field_create_shipment(jsonb) to authenticated;
