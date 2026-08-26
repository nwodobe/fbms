begin;

create or replace function public.field_traceability_search(p_query text)
returns table (
  producteur_id text,
  farmer_id text,
  producteur_nom text,
  producteur_prenoms text,
  achat_id uuid,
  achat_local_id text,
  achat_date date,
  achat_poids_net_kg numeric,
  lot_contribution_kg numeric,
  field_lot_id uuid,
  lot_code text,
  lot_status text,
  plot_sources jsonb,
  bags jsonb,
  shipment_id uuid,
  shipment_code text,
  shipment_status text,
  origin_label text,
  destination_label text,
  vehicle_plate text,
  loaded_qty_kg numeric,
  received_qty_kg numeric,
  reception_id text,
  factory_lot_id text
)
language sql
stable
security invoker
set search_path=public
as $$
  with q as (
    select lower(btrim(coalesce(p_query,''))) as x
  ), base as (
    select
      p.producteur_id,
      p.farmer_id,
      p.producteur_nom,
      pr.prenoms as producteur_prenoms,
      p.achat_id,
      p.achat_local_id,
      p.achat_date,
      p.poids_net as achat_poids_net_kg,
      c.lot_contribution_kg,
      c.field_lot_id,
      c.lot_code,
      c.lot_status,
      coalesce(c.plot_sources,'[]'::jsonb) as plot_sources,
      coalesce(c.bags,'[]'::jsonb) as bags,
      c.shipment_id,
      c.shipment_code,
      c.shipment_status,
      c.origin_label,
      c.destination_label,
      c.vehicle_plate,
      c.loaded_qty_kg,
      c.received_qty_kg,
      c.reception_id,
      c.factory_lot_id
    from public.field_traceability_purchase_status_v p
    left join public.producteurs pr on pr.id=p.producteur_id
    left join public.field_traceability_chain_v c on c.achat_id=p.achat_id
  )
  select b.*
  from base b, q
  where q.x=''
     or lower(coalesce(b.farmer_id,'')) like '%'||q.x||'%'
     or lower(coalesce(b.producteur_nom,'')) like '%'||q.x||'%'
     or lower(coalesce(b.producteur_prenoms,'')) like '%'||q.x||'%'
     or lower(coalesce(b.achat_id::text,'')) like '%'||q.x||'%'
     or lower(coalesce(b.achat_local_id,'')) like '%'||q.x||'%'
     or lower(coalesce(b.lot_code,'')) like '%'||q.x||'%'
     or lower(coalesce(b.shipment_code,'')) like '%'||q.x||'%'
     or lower(coalesce(b.vehicle_plate,'')) like '%'||q.x||'%'
     or lower(coalesce(b.reception_id,'')) like '%'||q.x||'%'
     or lower(coalesce(b.factory_lot_id,'')) like '%'||q.x||'%'
     or lower(coalesce(b.bags::text,'')) like '%'||q.x||'%'
  order by b.achat_date desc nulls last, b.lot_code nulls last, b.shipment_code nulls last
  limit 100;
$$;

revoke all on function public.field_traceability_search(text) from public, anon;
grant execute on function public.field_traceability_search(text) to authenticated;

commit;
