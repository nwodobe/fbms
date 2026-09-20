
create or replace function public.field_shipment_lot_create_stock_movement()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.field_shipments%rowtype;
  v_from_type text;
  v_move_type text;
  v_code text;
  v_lot_code text;
begin
  select * into s from public.field_shipments where id=new.shipment_id;
  if s.id is null or s.status not in ('DISPATCHED','RECEIVED','CLOSED') then
    return new;
  end if;
  if exists(select 1 from public.field_stock_movements where shipment_id=s.id and lot_id=new.lot_id and status<>'CANCELLED') then
    return new;
  end if;

  select lot_code into v_lot_code from public.field_lots where id=new.lot_id;
  v_from_type := case when s.origin_type='BOUAKE_WAREHOUSE' then 'WAREHOUSE' else s.origin_type end;
  v_move_type := case
    when v_from_type='VILLAGE' and s.destination_type='WAREHOUSE' then 'VILLAGE_TO_WAREHOUSE'
    when v_from_type='WAREHOUSE' and s.destination_type='WAREHOUSE' then 'WAREHOUSE_TO_WAREHOUSE'
    when v_from_type='WAREHOUSE' and s.destination_type='FACTORY' then 'WAREHOUSE_TO_FACTORY'
    when s.destination_type='FACTORY' then 'FACTORY_RECEIPT'
    else 'ADJUSTMENT'
  end;

  -- Un code par couple Shipment/Lot : une évacuation multi-lots doit produire
  -- plusieurs mouvements physiques sans collision d'unicité.
  v_code := 'MOV-' || replace(s.shipment_code,'SHP-','') || '-' ||
            upper(substr(md5(new.lot_id::text),1,6));

  insert into public.field_stock_movements(
    movement_code,lot_id,shipment_id,movement_type,
    from_type,from_id,from_label,to_type,to_id,to_label,
    qty_sent_kg,status,departed_at,document_ref,created_by
  ) values (
    v_code,new.lot_id,s.id,v_move_type,
    v_from_type,s.origin_id,s.origin_label,s.destination_type,s.destination_id,s.destination_label,
    new.loaded_qty_kg,'DISPATCHED',coalesce(s.departed_at,now()),s.document_ref,s.created_by
  );
  return new;
end;
$$;
