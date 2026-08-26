begin;

create or replace view public.field_traceability_purchase_status_v
with (security_invoker=true) as
select
  a.id as achat_id,
  a.local_id as achat_local_id,
  a.date as achat_date,
  a.producteur_id,
  a.producteur_code as farmer_id,
  a.producteur_nom,
  a.village_id,
  a.village_nom,
  a.cluster,
  a.rt_id,
  a.rt_nom,
  a.poids_net,
  a.nb_sacs,
  coalesce(ps.plot_count,0) as plot_count,
  coalesce(ps.plot_allocated_kg,0::numeric) as plot_allocated_kg,
  case
    when coalesce(ps.plot_count,0)=0 then 'DEFERRED'
    when coalesce(ps.plot_allocated_kg,0) + 0.01 >= a.poids_net then 'ALLOCATED'
    else 'PARTIAL'
  end as parcel_trace_status,
  coalesce(lc.lot_count,0) as lot_count,
  coalesce(lc.lot_allocated_kg,0::numeric) as lot_allocated_kg,
  coalesce(bg.bag_count,0) as rcn_bag_count,
  coalesce(bg.bag_weight_kg,0::numeric) as rcn_bag_weight_kg,
  a.statut_validation,
  a.qualite_statut,
  a.created_at
from public.achats a
left join lateral (
  select count(*)::int as plot_count, coalesce(sum(s.qty_kg),0::numeric) as plot_allocated_kg
  from public.field_purchase_sources s
  where s.achat_id=a.id
) ps on true
left join lateral (
  select count(distinct c.lot_id)::int as lot_count, coalesce(sum(c.qty_kg),0::numeric) as lot_allocated_kg
  from public.field_lot_contributors c
  where c.achat_id=a.id and c.status='ACTIVE'
) lc on true
left join lateral (
  select count(*)::int as bag_count, coalesce(sum(b.net_weight_kg),0::numeric) as bag_weight_kg
  from public.field_rcn_bags b
  where b.achat_id=a.id and b.status<>'VOID'
) bg on true;

revoke all on public.field_traceability_purchase_status_v from anon;
grant select on public.field_traceability_purchase_status_v to authenticated;

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
  )
  select
    c.producteur_id,
    c.farmer_id,
    c.producteur_nom,
    c.producteur_prenoms,
    c.achat_id,
    c.achat_local_id,
    c.achat_date,
    c.achat_poids_net_kg,
    c.lot_contribution_kg,
    c.field_lot_id,
    c.lot_code,
    c.lot_status,
    c.plot_sources,
    c.bags,
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
  from public.field_traceability_chain_v c, q
  where q.x=''
     or lower(coalesce(c.farmer_id,'')) like '%'||q.x||'%'
     or lower(coalesce(c.producteur_nom,'')) like '%'||q.x||'%'
     or lower(coalesce(c.producteur_prenoms,'')) like '%'||q.x||'%'
     or lower(coalesce(c.achat_id::text,'')) like '%'||q.x||'%'
     or lower(coalesce(c.achat_local_id,'')) like '%'||q.x||'%'
     or lower(coalesce(c.lot_code,'')) like '%'||q.x||'%'
     or lower(coalesce(c.shipment_code,'')) like '%'||q.x||'%'
     or lower(coalesce(c.vehicle_plate,'')) like '%'||q.x||'%'
     or lower(coalesce(c.reception_id,'')) like '%'||q.x||'%'
     or lower(coalesce(c.factory_lot_id,'')) like '%'||q.x||'%'
     or lower(coalesce(c.bags::text,'')) like '%'||q.x||'%'
  order by c.achat_date desc nulls last, c.lot_code, c.shipment_code
  limit 100;
$$;

revoke all on function public.field_traceability_search(text) from public, anon;
grant execute on function public.field_traceability_search(text) to authenticated;

comment on view public.field_traceability_purchase_status_v is 'Statut E2E par achat: parcelles, lots et sacs RCN. Une parcelle manquante reste DEFERRED et ne bloque pas l achat.';
comment on function public.field_traceability_search(text) is 'Recherche serveur Traceability 360 par Farmer ID, producteur, achat, lot, sac, camion, reception ou lot usine.';

commit;
