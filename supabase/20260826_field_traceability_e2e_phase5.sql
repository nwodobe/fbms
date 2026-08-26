begin;

create or replace view public.field_traceability_completeness_v
with (security_invoker=true) as
with chain as (
  select
    achat_id,
    bool_or(field_lot_id is not null) as has_field_lot,
    bool_or(shipment_id is not null and shipment_status <> 'CANCELLED') as has_shipment,
    bool_or(reception_id is not null) as has_reception,
    bool_or(factory_lot_id is not null) as has_factory_lot,
    count(distinct field_lot_id) filter (where field_lot_id is not null) as chain_lot_count,
    count(distinct shipment_id) filter (where shipment_id is not null and shipment_status <> 'CANCELLED') as shipment_count,
    count(distinct reception_id) filter (where reception_id is not null) as reception_count,
    count(distinct factory_lot_id) filter (where factory_lot_id is not null) as factory_lot_count
  from public.field_traceability_chain_v
  group by achat_id
), base as (
  select
    p.*,
    coalesce(c.has_field_lot,false) as has_field_lot,
    coalesce(c.has_shipment,false) as has_shipment,
    coalesce(c.has_reception,false) as has_reception,
    coalesce(c.has_factory_lot,false) as has_factory_lot,
    coalesce(c.chain_lot_count,0) as chain_lot_count,
    coalesce(c.shipment_count,0) as shipment_count,
    coalesce(c.reception_count,0) as reception_count,
    coalesce(c.factory_lot_count,0) as factory_lot_count,
    case when p.producteur_id is not null and nullif(btrim(coalesce(p.farmer_id,'')),'') is not null then 20 else 0 end as farmer_points,
    case
      when coalesce(p.lot_allocated_kg,0) >= coalesce(p.poids_net,0)-0.01 and coalesce(p.poids_net,0)>0 then 20
      when coalesce(p.lot_allocated_kg,0)>0 then 10
      else 0
    end as lot_points,
    case
      when coalesce(p.lot_allocated_kg,0)>0 and coalesce(p.rcn_bag_weight_kg,0) >= coalesce(p.lot_allocated_kg,0)-0.01 then 20
      when coalesce(p.rcn_bag_weight_kg,0)>0 then 10
      else 0
    end as bag_points
  from public.field_traceability_purchase_status_v p
  left join chain c on c.achat_id=p.achat_id
)
select
  achat_id, achat_local_id, achat_date, producteur_id, farmer_id, producteur_nom,
  village_id, village_nom, cluster, rt_id, rt_nom, poids_net, lot_allocated_kg,
  rcn_bag_count, rcn_bag_weight_kg, parcel_trace_status, plot_count, plot_allocated_kg,
  chain_lot_count, shipment_count, reception_count, factory_lot_count,
  case when farmer_points=20 then 'COMPLETE' else 'MISSING' end as farmer_status,
  case when lot_points=20 then 'COMPLETE' when lot_points=10 then 'PARTIAL' else 'MISSING' end as lot_trace_status,
  case when bag_points=20 then 'COMPLETE' when bag_points=10 then 'PARTIAL' else 'MISSING' end as bag_trace_status,
  case when has_shipment then 'COMPLETE' else 'MISSING' end as shipment_trace_status,
  case when has_reception then 'COMPLETE' else 'MISSING' end as reception_trace_status,
  case when has_factory_lot then 'COMPLETE' else 'MISSING' end as factory_lot_trace_status,
  farmer_points + lot_points + bag_points +
    case when has_shipment then 15 else 0 end +
    case when has_reception then 15 else 0 end +
    case when has_factory_lot then 10 else 0 end as completeness_score_2027,
  case
    when farmer_points=0 then 'Régulariser le Farmer ID du producteur'
    when lot_points<20 then 'Rattacher tout le poids acheté à un lot terrain'
    when bag_points<20 then 'Identifier les sacs RCN physiques du lot'
    when not has_shipment then 'Créer ou rattacher l’expédition camion'
    when not has_reception then 'Rattacher la réception usine'
    when not has_factory_lot then 'Créer ou rattacher le lot RCN usine'
    else 'Chaîne opérationnelle 2027 complète'
  end as next_action,
  case
    when farmer_points + lot_points + bag_points +
      case when has_shipment then 15 else 0 end +
      case when has_reception then 15 else 0 end +
      case when has_factory_lot then 10 else 0 end = 100 then 'COMPLETE'
    when farmer_points=0 then 'ACTION_REQUIRED'
    when farmer_points + lot_points + bag_points > 20 then 'IN_PROGRESS'
    else 'TO_START'
  end as overall_status,
  created_at
from base;

revoke all on public.field_traceability_completeness_v from anon;
grant select on public.field_traceability_completeness_v to authenticated;

create or replace view public.field_traceability_dashboard_v
with (security_invoker=true) as
select
  count(*)::integer as purchase_count,
  count(*) filter (where overall_status='COMPLETE')::integer as complete_count,
  count(*) filter (where overall_status='IN_PROGRESS')::integer as in_progress_count,
  count(*) filter (where overall_status='ACTION_REQUIRED')::integer as action_required_count,
  count(*) filter (where farmer_status='MISSING')::integer as farmer_missing_count,
  count(*) filter (where lot_trace_status<>'COMPLETE')::integer as lot_incomplete_count,
  count(*) filter (where bag_trace_status<>'COMPLETE' and lot_trace_status<>'MISSING')::integer as bag_incomplete_count,
  count(*) filter (where shipment_trace_status='MISSING' and bag_trace_status='COMPLETE')::integer as shipment_pending_count,
  count(*) filter (where reception_trace_status='MISSING' and shipment_trace_status='COMPLETE')::integer as reception_pending_count,
  count(*) filter (where factory_lot_trace_status='MISSING' and reception_trace_status='COMPLETE')::integer as factory_lot_pending_count,
  count(*) filter (where parcel_trace_status='DEFERRED')::integer as parcel_deferred_count,
  round(coalesce(avg(completeness_score_2027),0),1) as average_score_2027
from public.field_traceability_completeness_v;

revoke all on public.field_traceability_dashboard_v from anon;
grant select on public.field_traceability_dashboard_v to authenticated;

create or replace view public.field_traceability_alerts_v
with (security_invoker=true) as
select * from (
  select 'HIGH'::text as severity,'MISSING_FARMER_ID'::text as alert_type,'PURCHASE'::text as entity_type,
    v.achat_id::text as entity_id,coalesce(v.achat_local_id,v.achat_id::text) as reference,
    'Achat sans Farmer ID canonique : la chaîne producteur ne peut pas être prouvée de bout en bout'::text as message,
    'Régulariser le producteur et son Farmer ID'::text as action_required,v.created_at
  from public.field_traceability_completeness_v v where v.farmer_status='MISSING'
  union all
  select 'HIGH','SHIPMENT_WEIGHT_VARIANCE','SHIPMENT',s.id::text,s.shipment_code,
    ('Ecart de poids camion: expédié '||coalesce(s.dispatched_qty_kg,0)||' kg, reçu '||coalesce(s.received_qty_kg,0)||' kg'),
    'Justifier et réconcilier l’écart de poids',coalesce(s.arrived_at,s.updated_at,s.created_at)
  from public.field_shipments s
  where s.status in ('RECEIVED','CLOSED')
    and abs(coalesce(s.received_qty_kg,0)-coalesce(s.dispatched_qty_kg,0)) > 0.01
    and exists (select 1 from public.field_stock_movements m where m.shipment_id=s.id and m.status='DISPATCHED')
  union all
  select 'HIGH','RECEPTION_WITHOUT_FACTORY_LOT','RECEPTION',r.id,r.id,
    'Réception usine rattachée au camion mais aucun lot RCN usine n’est encore créé','Créer ou rattacher le lot RCN usine',coalesce(r.arrivee_at,r.created_at)
  from public.rcn_receptions r
  join public.field_shipments s on s.reception_id=r.id and s.status in ('RECEIVED','CLOSED')
  where not exists(select 1 from public.rcn_lots l where l.reception_id=r.id)
  union all
  select 'MEDIUM','LOT_BAG_TRACE_INCOMPLETE','FIELD_LOT',v.lot_id::text,v.lot_code,
    ('Sacs RCN incomplets: '||round(v.bag_weight_kg,2)||' kg identifiés sur '||round(v.contributor_kg,2)||' kg du lot'),
    'Identifier les sacs RCN physiques restants',v.created_at
  from public.field_lot_bag_control_v v
  where v.lot_status<>'CANCELLED' and v.bag_trace_status in ('NOT_STARTED','PARTIAL')
  union all
  select 'MEDIUM','SHIPMENT_NO_RECEPTION','SHIPMENT',s.id::text,s.shipment_code,'Camion parti sans réception usine rattachée','Rattacher la réception usine',s.departed_at
  from public.field_shipments s where s.status='DISPATCHED' and s.departed_at < now()-interval '24 hours'
  union all
  select 'INFO','PARCEL_DEFERRED_2027','PURCHASE',v.achat_id::text,coalesce(v.achat_local_id,v.achat_id::text),
    'Parcelle/GPS à compléter après campagne — non bloquant pour 2027','Compléter la parcelle après campagne',v.created_at
  from public.field_traceability_purchase_status_v v where v.parcel_trace_status='DEFERRED'
) a;

revoke all on public.field_traceability_alerts_v from anon;
grant select on public.field_traceability_alerts_v to authenticated;

comment on view public.field_traceability_completeness_v is 'E2E-5: score 2027 sur Farmer ID, lot, sacs, camion, réception et lot usine. Parcelle/GPS suivie séparément et non bloquante.';
comment on view public.field_traceability_dashboard_v is 'E2E-5: synthèse de complétude de la chaîne opérationnelle AFLP 2027.';

commit;