begin;

create or replace view public.field_stock_balance_v
with (security_invoker=true) as
with ledger as (
  select
    l.id as lot_id,
    case l.scope_type when 'VILLAGE' then 'VILLAGE' when 'CLUSTER' then 'WAREHOUSE' else 'OTHER' end as location_type,
    l.scope_label as location_label,
    coalesce(sum(c.qty_kg),0::numeric) as qty_kg
  from public.field_lots l
  left join public.field_lot_contributors c on c.lot_id=l.id and c.status='ACTIVE'
  group by l.id,l.scope_type,l.scope_label

  union all

  select m.lot_id,m.from_type,m.from_label,-m.qty_sent_kg
  from public.field_stock_movements m
  where m.status in ('DISPATCHED','RECEIVED')

  union all

  select
    m.lot_id,
    'TRUCK'::text,
    coalesce(s.vehicle_plate,'MOUVEMENT '||m.movement_code),
    m.qty_sent_kg
  from public.field_stock_movements m
  left join public.field_shipments s on s.id=m.shipment_id
  where m.status='DISPATCHED'

  union all

  select m.lot_id,m.to_type,m.to_label,m.qty_received_kg
  from public.field_stock_movements m
  where m.status='RECEIVED' and m.qty_received_kg is not null
)
select
  lot_id,
  location_type,
  location_label,
  round(sum(qty_kg),2) as balance_kg
from ledger
group by lot_id,location_type,location_label
having abs(sum(qty_kg)) > 0.01;

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
begin
  select * into s from public.field_shipments where id=new.shipment_id;
  if s.id is null or s.status not in ('DISPATCHED','RECEIVED','CLOSED') then return new; end if;
  if exists(select 1 from public.field_stock_movements where shipment_id=s.id and lot_id=new.lot_id and status<>'CANCELLED') then return new; end if;
  v_from_type := case when s.origin_type='BOUAKE_WAREHOUSE' then 'WAREHOUSE' else s.origin_type end;
  v_move_type := case when v_from_type='VILLAGE' and s.destination_type='WAREHOUSE' then 'VILLAGE_TO_WAREHOUSE' when v_from_type='WAREHOUSE' and s.destination_type='WAREHOUSE' then 'WAREHOUSE_TO_WAREHOUSE' when v_from_type='WAREHOUSE' and s.destination_type='FACTORY' then 'WAREHOUSE_TO_FACTORY' when s.destination_type='FACTORY' then 'FACTORY_RECEIPT' else 'ADJUSTMENT' end;
  v_code := 'MOV-' || replace(s.shipment_code,'SHP-','');
  insert into public.field_stock_movements(movement_code,lot_id,shipment_id,movement_type,from_type,from_id,from_label,to_type,to_id,to_label,qty_sent_kg,status,departed_at,document_ref,created_by)
  values(v_code,new.lot_id,s.id,v_move_type,v_from_type,s.origin_id,s.origin_label,s.destination_type,s.destination_id,s.destination_label,new.loaded_qty_kg,'DISPATCHED',coalesce(s.departed_at,now()),s.document_ref,s.created_by);
  return new;
end;
$$;
revoke all on function public.field_shipment_lot_create_stock_movement() from public,anon,authenticated;
drop trigger if exists trg_field_shipment_lots_stock_movement on public.field_shipment_lots;
create trigger trg_field_shipment_lots_stock_movement after insert on public.field_shipment_lots for each row execute function public.field_shipment_lot_create_stock_movement();

create or replace function public.field_shipment_receive_stock_if_balanced()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_sent numeric; v_received numeric;
begin
  if new.status not in ('RECEIVED','CLOSED') or old.status in ('RECEIVED','CLOSED') then return new; end if;
  v_sent := coalesce(new.dispatched_qty_kg,0); v_received := coalesce(new.received_qty_kg,0);
  if abs(v_sent-v_received) <= 0.01 then
    update public.field_stock_movements set qty_received_kg=qty_sent_kg,status='RECEIVED',received_at=coalesce(new.arrived_at,now()) where shipment_id=new.id and status='DISPATCHED';
  end if;
  return new;
end;
$$;
revoke all on function public.field_shipment_receive_stock_if_balanced() from public,anon,authenticated;
drop trigger if exists trg_field_shipments_receive_stock on public.field_shipments;
create trigger trg_field_shipments_receive_stock after update of status,received_qty_kg,arrived_at on public.field_shipments for each row execute function public.field_shipment_receive_stock_if_balanced();

comment on function public.field_shipment_lot_create_stock_movement() is 'Cree automatiquement le mouvement physique de stock correspondant a un lot charge dans une expedition.';
comment on function public.field_shipment_receive_stock_if_balanced() is 'Ferme automatiquement le mouvement physique si la reception camion ne presente aucun ecart; sinon laisse le mouvement a reconcilier manuellement.';

commit;
