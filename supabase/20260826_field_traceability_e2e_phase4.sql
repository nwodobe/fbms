begin;

create or replace view public.field_reconciliation_queue_v
with (security_invoker=true) as
select
  s.id as shipment_id,
  s.shipment_code,
  s.vehicle_plate,
  s.origin_label,
  s.destination_label,
  s.dispatched_qty_kg,
  s.received_qty_kg,
  round(coalesce(s.received_qty_kg,0)-coalesce(s.dispatched_qty_kg,0),2) as variance_kg,
  case
    when s.status='DISPATCHED' then 'AWAITING_RECEPTION'
    when s.status in ('RECEIVED','CLOSED') and abs(coalesce(s.received_qty_kg,0)-coalesce(s.dispatched_qty_kg,0)) <= 0.01 then 'BALANCED'
    when s.status in ('RECEIVED','CLOSED') then 'TO_RECONCILE'
    else s.status
  end as reconciliation_status,
  s.reception_id,
  r.camion as reception_camion,
  r.poids_annonce as reception_poids_annonce,
  r.ref_doc as reception_ref_doc,
  r.etat as reception_etat,
  rl.id as factory_lot_id,
  rl.net_initial as factory_net_initial,
  rl.etat as factory_lot_etat,
  m.id as movement_id,
  m.qty_sent_kg as movement_sent_kg,
  m.qty_received_kg as movement_received_kg,
  m.status as movement_status,
  m.variance_reason,
  s.departed_at,
  s.arrived_at,
  s.created_at
from public.field_shipments s
left join public.rcn_receptions r on r.id=s.reception_id
left join public.rcn_lots rl on rl.reception_id=s.reception_id
left join public.field_stock_movements m on m.shipment_id=s.id and m.status<>'CANCELLED'
where s.status<>'CANCELLED';

revoke all on public.field_reconciliation_queue_v from anon;
grant select on public.field_reconciliation_queue_v to authenticated;

create or replace view public.field_traceability_alerts_v
with (security_invoker=true) as
select * from (
  select
    'HIGH'::text as severity,
    'SHIPMENT_WEIGHT_VARIANCE'::text as alert_type,
    'SHIPMENT'::text as entity_type,
    s.id::text as entity_id,
    s.shipment_code as reference,
    ('Ecart de poids camion: expédié '||coalesce(s.dispatched_qty_kg,0)||' kg, reçu '||coalesce(s.received_qty_kg,0)||' kg')::text as message,
    'Justifier et réconcilier l’écart de poids'::text as action_required,
    coalesce(s.arrived_at,s.updated_at,s.created_at) as created_at
  from public.field_shipments s
  where s.status in ('RECEIVED','CLOSED')
    and abs(coalesce(s.received_qty_kg,0)-coalesce(s.dispatched_qty_kg,0)) > 0.01
    and exists (
      select 1 from public.field_stock_movements m
      where m.shipment_id=s.id and m.status='DISPATCHED'
    )

  union all

  select
    'HIGH','RECEPTION_WITHOUT_FACTORY_LOT','RECEPTION',r.id,r.id,
    'Réception usine rattachée au camion mais aucun lot RCN usine n’est encore créé',
    'Créer ou rattacher le lot RCN usine',
    coalesce(r.arrivee_at,r.created_at)
  from public.rcn_receptions r
  join public.field_shipments s on s.reception_id=r.id and s.status in ('RECEIVED','CLOSED')
  where not exists(select 1 from public.rcn_lots l where l.reception_id=r.id)

  union all

  select
    'MEDIUM','LOT_BAG_TRACE_INCOMPLETE','FIELD_LOT',v.lot_id::text,v.lot_code,
    ('Sacs RCN incomplets: '||round(v.bag_weight_kg,2)||' kg identifiés sur '||round(v.contributor_kg,2)||' kg du lot'),
    'Identifier les sacs RCN physiques restants',
    v.created_at
  from public.field_lot_bag_control_v v
  where v.lot_status<>'CANCELLED' and v.bag_trace_status in ('NOT_STARTED','PARTIAL')

  union all

  select
    'MEDIUM','SHIPMENT_NO_RECEPTION','SHIPMENT',s.id::text,s.shipment_code,
    'Camion parti sans réception usine rattachée',
    'Rattacher la réception usine',
    s.departed_at
  from public.field_shipments s
  where s.status='DISPATCHED'
    and s.departed_at < now()-interval '24 hours'

  union all

  select
    'INFO','PARCEL_DEFERRED_2027','PURCHASE',v.achat_id::text,coalesce(v.achat_local_id,v.achat_id::text),
    'Parcelle/GPS à compléter après campagne — non bloquant pour 2027',
    'Compléter la parcelle après campagne',
    v.created_at
  from public.field_traceability_purchase_status_v v
  where v.parcel_trace_status='DEFERRED'
) a;

revoke all on public.field_traceability_alerts_v from anon;
grant select on public.field_traceability_alerts_v to authenticated;

create or replace function public.field_reconcile_shipment(
  p_shipment_id uuid,
  p_received_qty_kg numeric,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  s public.field_shipments%rowtype;
  v_sent numeric;
  v_total_move numeric;
  v_reason text;
  v_now timestamptz:=now();
  rec record;
  v_share numeric;
begin
  select * into s from public.field_shipments where id=p_shipment_id for update;
  if s.id is null then raise exception 'Expédition introuvable'; end if;
  if s.status='CANCELLED' then raise exception 'Expédition annulée'; end if;
  if s.reception_id is null then raise exception 'Réception usine non rattachée'; end if;
  if p_received_qty_kg is null or p_received_qty_kg < 0 then raise exception 'Poids reçu invalide'; end if;

  v_sent:=coalesce(s.dispatched_qty_kg,0);
  if p_received_qty_kg > v_sent + 0.01 then
    raise exception 'Poids reçu %.2f kg supérieur au poids expédié %.2f kg: investigation obligatoire',p_received_qty_kg,v_sent;
  end if;

  v_reason:=nullif(btrim(coalesce(p_reason,'')),'');
  if abs(v_sent-p_received_qty_kg)>0.01 and v_reason is null then
    raise exception 'Motif obligatoire pour un écart de poids';
  end if;

  select coalesce(sum(qty_sent_kg),0) into v_total_move
  from public.field_stock_movements
  where shipment_id=s.id and status<>'CANCELLED';
  if v_total_move<=0 then raise exception 'Aucun mouvement physique associé à cette expédition'; end if;

  update public.field_shipments
  set received_qty_kg=p_received_qty_kg,
      status='RECEIVED',
      arrived_at=coalesce(arrived_at,v_now),
      notes=case when v_reason is null then notes else concat_ws(E'\n',notes,'Réconciliation: '||v_reason) end
  where id=s.id;

  for rec in
    select id,lot_id,qty_sent_kg
    from public.field_stock_movements
    where shipment_id=s.id and status<>'CANCELLED'
    order by created_at,id
  loop
    v_share:=round(p_received_qty_kg*rec.qty_sent_kg/v_total_move,2);
    if v_share>rec.qty_sent_kg then v_share:=rec.qty_sent_kg; end if;
    update public.field_stock_movements
      set qty_received_kg=v_share,
          status='RECEIVED',
          received_at=coalesce(received_at,v_now),
          variance_reason=case when abs(rec.qty_sent_kg-v_share)>0.01 then v_reason else variance_reason end
    where id=rec.id;

    update public.field_lots set status='RECEIVED' where id=rec.lot_id and status<>'CANCELLED';
  end loop;

  update public.field_shipment_lots sl
    set received_qty_kg=round(p_received_qty_kg*coalesce(sl.loaded_qty_kg,0)/nullif(v_total_move,0),2)
  where sl.shipment_id=s.id;

  return jsonb_build_object(
    'shipment_id',s.id,
    'sent_kg',v_sent,
    'received_kg',p_received_qty_kg,
    'variance_kg',round(p_received_qty_kg-v_sent,2),
    'status','RECEIVED',
    'reason',v_reason
  );
end;
$$;

revoke all on function public.field_reconcile_shipment(uuid,numeric,text) from public,anon;
grant execute on function public.field_reconcile_shipment(uuid,numeric,text) to authenticated;

comment on view public.field_reconciliation_queue_v is 'File E2E-4 de réconciliation expédition, réception usine, lot usine et mouvement physique.';
comment on view public.field_traceability_alerts_v is 'Alertes de rupture de la chaîne de traçabilité; PARCEL_DEFERRED_2027 reste informatif et non bloquant.';
comment on function public.field_reconcile_shipment(uuid,numeric,text) is 'Réconcilie un camion reçu avec ses mouvements physiques; écart négatif justifié, surpoids bloqué pour investigation.';

commit;
