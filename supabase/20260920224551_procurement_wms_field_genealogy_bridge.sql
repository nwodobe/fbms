
create table if not exists public.wms_lot_procurement_contributors(
  id uuid primary key default gen_random_uuid(),
  wms_lot_id text not null references public.wms_lots(id) on update restrict on delete restrict,
  field_shipment_id uuid references public.field_shipments(id) on update restrict on delete restrict,
  field_lot_id uuid references public.field_lots(id) on update restrict on delete restrict,
  achat_id uuid references public.achats(id) on update restrict on delete restrict,
  producer_id text,
  producer_code text,
  producer_name text,
  rt_id text,
  rt_name text,
  village_id text,
  village_name text,
  field_qty_kg numeric not null check(field_qty_kg>0),
  field_bag_count integer check(field_bag_count is null or field_bag_count>=0),
  created_at timestamptz not null default now(),
  unique(wms_lot_id,achat_id)
);

create index if not exists wms_lot_procurement_contributors_lot_idx
on public.wms_lot_procurement_contributors(wms_lot_id);
create index if not exists wms_lot_procurement_contributors_producer_idx
on public.wms_lot_procurement_contributors(producer_id);
create index if not exists wms_lot_procurement_contributors_shipment_idx
on public.wms_lot_procurement_contributors(field_shipment_id);

create or replace function public.wms_capture_field_genealogy()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.wms_receptions;
begin
  select * into r from public.wms_receptions where id=new.reception_id;
  if r.field_shipment_id is null then return new; end if;

  insert into public.wms_lot_procurement_contributors(
    wms_lot_id,field_shipment_id,field_lot_id,achat_id,
    producer_id,producer_code,producer_name,rt_id,rt_name,village_id,village_name,
    field_qty_kg,field_bag_count
  )
  select
    new.id,r.field_shipment_id,sl.lot_id,c.achat_id,
    a.producteur_id,a.producteur_code,a.producteur_nom,a.rt_id,a.rt_nom,a.village_id,a.village_nom,
    c.qty_kg,c.bag_count
  from public.field_shipment_lots sl
  join public.field_lot_contributors c on c.lot_id=sl.lot_id and c.status='ACTIVE'
  join public.achats a on a.id=c.achat_id
  where sl.shipment_id=r.field_shipment_id
  on conflict(wms_lot_id,achat_id) do nothing;

  perform public.wms_audit(new.id,'lot.procurement_genealogy',null,
    jsonb_build_object(
      'field_shipment_id',r.field_shipment_id,
      'contributors',(select count(*) from public.wms_lot_procurement_contributors where wms_lot_id=new.id),
      'field_qty_kg',(select coalesce(sum(field_qty_kg),0) from public.wms_lot_procurement_contributors where wms_lot_id=new.id),
      'warehouse_net_kg',new.initial_kg
    ),
    'Capture de la généalogie Achat Bord Champ sans allocation automatique de variance');
  return new;
end $$;

drop trigger if exists trg_wms_lot_capture_field_genealogy on public.wms_lots;
create trigger trg_wms_lot_capture_field_genealogy
after insert on public.wms_lots
for each row execute function public.wms_capture_field_genealogy();

create or replace view public.wms_v_lot_procurement_contributors
with (security_invoker=true) as
select
  c.*,
  l.reception_id,l.warehouse_id,l.truck,l.initial_kg warehouse_net_kg,
  sum(c.field_qty_kg) over(partition by c.wms_lot_id) field_total_kg,
  l.initial_kg - sum(c.field_qty_kg) over(partition by c.wms_lot_id) field_warehouse_variance_kg
from public.wms_lot_procurement_contributors c
join public.wms_lots l on l.id=c.wms_lot_id;

alter table public.wms_lot_procurement_contributors enable row level security;
drop policy if exists wms_lot_proc_contrib_read on public.wms_lot_procurement_contributors;
create policy wms_lot_proc_contrib_read on public.wms_lot_procurement_contributors
for select to authenticated using (true);
revoke all on public.wms_lot_procurement_contributors from anon;
grant select on public.wms_lot_procurement_contributors,public.wms_v_lot_procurement_contributors to authenticated;
