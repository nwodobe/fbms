-- FBMS · Rapports d'activité (3/4) : Warehouse Activity Ledger, Jute Bags Movement, synthèse quotidienne

-- 7. Warehouse Activity Ledger -------------------------------------------
-- Mouvements RCN postés (kg) + reconditionnement (sacs, réception) +
-- rebagging (sacs, grand livre sacherie). Les lignes « Closing Balance »
-- sont calculées à la date de fin par reports_activity_summary.
create or replace view public.reports_v_warehouse_activity_ledger with (security_invoker = true) as
with mv as (
  select m.id as movement_id, m.type, m.posted_at, m.warehouse_id, m.source_type, m.source_id, m.dest_type, m.dest_id,
         m.reference_type, m.reference_id, m.reason, m.truck, ml.lot_id, ml.qty_out, ml.qty_in,
         l.supplier_name as lot_supplier, l.supplier_code as lot_supplier_code, l.reception_id as lot_reception
  from public.wms_movements m
  join public.wms_movement_lots ml on ml.movement_id = m.id
  left join public.wms_lots l on l.id = ml.lot_id
  where m.status = 'POSTED'
), rows_ as (
  select mv.*,
    case mv.type
      when 'OFFLOAD' then 'Offloading'
      when 'BIN_TRANSFER' then case when mv.source_type = 'BIN' then 'Destaking' else 'Staking' end
      when 'DRYING_ISSUE' then 'Drying'
      when 'DRYING_RECEIPT' then 'Drying'
      when 'SORTING' then 'Triage'
      when 'TRANSFER_OUT' then 'Transfer Out'
      when 'TRANSFER_IN' then 'Transfer In'
      when 'PRODUCTION_ISSUE' then 'Production Issue'
      when 'RETURN_TO_SUPPLIER' then 'Return to Supplier'
      when 'ADJUSTMENT' then 'Adjustment'
      else mv.type end as activity_type,
    case when mv.type = 'BIN_TRANSFER' and mv.source_type = 'BIN' then mv.qty_out else coalesce(nullif(mv.qty_in,0), mv.qty_out) end as qty_kg,
    1 as side
  from mv
  union all
  select mv.*, 'Staking', mv.qty_in, 2
  from mv where mv.type = 'BIN_TRANSFER' and mv.source_type = 'BIN'
), lbl(code, label) as (
  values ('TRUCK','Camion'),('STAGING','Staging'),('BIN','BIN'),('DRYING','Séchage'),('TRANSIT','Transit'),
         ('PRODUCTION','Production'),('SUPPLIER','Fournisseur'),('ADJUSTMENT','Ajustement')
), led as (
  select x.posted_at as activity_date,
    x.activity_type,
    concat_ws(' → ', (select label from lbl where code = x.source_type), (select label from lbl where code = x.dest_type)) as particulars,
    case when x.side = 2 or x.source_type = 'STAGING' then x.dest_id
         when x.source_type = 'TRUCK' then coalesce(x.truck, r.truck)
         when x.source_type = 'BIN' then x.source_id
         else coalesce(x.dest_id, x.source_id) end as offloaded,
    case when x.type = 'OFFLOAD' then r.bags end as bags,
    round(x.qty_kg / 1000.0, 3) as quantity_mt,
    x.reference_id as fiche_no,
    x.lot_id as lot_no,
    x.lot_supplier as vendor,
    null::numeric as rate,
    null::numeric as total,
    x.movement_id as reference_no,
    x.reason as remarks,
    null::numeric as gross_weight_with_pallet_kg,
    null::integer as pallet_count,
    case when x.type = 'OFFLOAD' then r.gross_kg end as gross_weight_kg,
    null::numeric as gross_weight_without_pallet_kg,
    x.qty_kg as net_weight_kg,
    x.type as source_movement_type,
    x.posted_at::date as report_date,
    x.warehouse_id, w.code as warehouse_code,
    coalesce(x.lot_supplier_code, r.supplier_code) as supplier_code,
    public.reports_truck_norm(coalesce(x.truck, r.truck)) as truck_norm,
    r.id as reception_id,
    r.procurement_channel as channel,
    public.reports_campaign_of(x.posted_at::date) as campaign
  from rows_ x
  join public.wms_warehouses w on w.id = x.warehouse_id
  left join public.wms_receptions r on r.id = coalesce(x.lot_reception, case when x.reference_type = 'RECEPTION' then x.reference_id end)
  union all
  select coalesce(r.offload_end, r.offloaded_at), 'Reconditioning', 'Sacs reconditionnés à la réception', r.truck, r.bags_recond,
    null::numeric, r.warehouse_receipt, r.lot_id, r.supplier_name, null::numeric, null::numeric, r.id,
    'Sacs reconditionnés (réception)', null::numeric, null::integer, null::numeric, null::numeric, null::numeric,
    'RECONDITIONING', coalesce(r.offload_end, r.offloaded_at)::date, r.warehouse_id, w.code, r.supplier_code,
    public.reports_truck_norm(r.truck), r.id, r.procurement_channel, public.reports_campaign_of(coalesce(r.offload_end, r.offloaded_at)::date)
  from public.wms_receptions r
  join public.wms_warehouses w on w.id = r.warehouse_id
  where coalesce(r.bags_recond,0) > 0 and r.offloaded_at is not null
  union all
  select j.movement_at, 'Rebagging', 'Rebagging (sacherie)', j.from_location, j.qty,
    null::numeric, j.reference, j.lot_id, null::text, null::numeric, null::numeric, j.id,
    j.note, null::numeric, null::integer, null::numeric, null::numeric, null::numeric,
    'REBAGING', j.movement_at::date, w.id, w.code, j.supplier_code,
    public.reports_truck_norm(r.truck), j.reception_id, r.procurement_channel, public.reports_campaign_of(j.movement_at::date)
  from public.rcn_jute_movements j
  join public.rcn_jute_locations jl on jl.code = coalesce(j.from_location, j.to_location)
  join public.wms_warehouses w on w.code = jl.warehouse_code
  left join public.wms_receptions r on r.id = j.reception_id
  where j.ledger = 'INTERNE' and j.movement_type = 'REBAGING'
)
select * from led
where (select public.reports_scope_code()) is null or led.warehouse_code = (select public.reports_scope_code());

-- 8. Jute Bags Movement ---------------------------------------------------
create or replace view public.reports_v_jute_bags_movement with (security_invoker = true) as
with loc as (
  select l.code, l.warehouse_code from public.rcn_jute_locations l
  where l.type = 'STOCK' and coalesce(l.scope_type,'') in ('EXTERNAL_WAREHOUSE','FACTORY_WAREHOUSE')
), sides as (
  select m.*, m.from_location as location_code, 'OUT'::text as side from public.rcn_jute_movements m
  where m.ledger = 'INTERNE' and m.from_location in (select code from loc) and m.from_location is distinct from m.to_location
  union all
  select m.*, m.to_location, 'IN' from public.rcn_jute_movements m
  where m.ledger = 'INTERNE' and m.to_location in (select code from loc) and m.from_location is distinct from m.to_location
)
select s.id as movement_id,
  s.movement_at as movement_date,
  case s.movement_type
    when 'ACHAT' then 'JUTE BAGS PURCHASED/UNLOADINGS'
    when 'SOLDE_INITIAL' then 'OPENING BALANCE'
    when 'DOTATION' then 'BAGS ISSUED TO SUPPLIER'
    when 'RETOUR' then 'BAGS RETURNED BY SUPPLIER'
    when 'RECU_LIVRAISON' then 'BAGS RECEIVED WITH RCN DELIVERY'
    when 'TRANSFERT' then case when s.side = 'OUT' then 'BAGS TRANSFER OUT' else 'BAGS TRANSFER IN' end
    when 'REBAGING' then 'REBAGGING'
    when 'REFORME' then 'DAMAGED / DISCARDED'
    when 'PERTE_APPROUVEE' then 'APPROVED LOSS'
    when 'AJUSTEMENT_INVENTAIRE' then 'INVENTORY ADJUSTMENT'
    when 'SORTIE_PRODUCTION' then 'ISSUED TO PRODUCTION'
    when 'RETOUR_PRODUCTION' then 'RETURNED FROM PRODUCTION'
    when 'CONSOMMATION_PRODUCTION' then 'CONSUMED IN PRODUCTION'
    when 'CLASSEMENT' then 'BAGS SORTING'
    when 'REPARATION_SORTIE' then 'SENT FOR REPAIR'
    when 'REPARATION_RETOUR' then 'RETURNED FROM REPAIR'
    else s.movement_type end as activity_type,
  s.supplier_code,
  s.location_code as warehouse_location,
  r.truck as truck_no,
  r.warehouse_receipt as warehouse_receipt_no,
  case when s.side = 'OUT' then s.qty end as bags_issued,
  case when s.side = 'IN' then s.qty end as bags_received,
  s.movement_type, s.side, s.from_location, s.to_location, s.from_state, s.to_state, s.reference, s.note,
  s.movement_at::date as report_date,
  w.id as warehouse_id, lc.warehouse_code,
  public.reports_truck_norm(r.truck) as truck_norm,
  s.reception_id, s.lot_id as lot_no,
  r.procurement_channel as channel,
  coalesce(s.campaign, public.reports_campaign_of(s.movement_at::date)) as campaign
from sides s
join loc lc on lc.code = s.location_code
left join public.wms_warehouses w on w.code = lc.warehouse_code
left join public.wms_receptions r on r.id = s.reception_id
where (select public.reports_scope_code()) is null or lc.warehouse_code = (select public.reports_scope_code());

-- 9. Synthèse quotidienne -------------------------------------------------
create or replace view public.reports_v_activity_summary with (security_invoker = true) as
select t.report_date, t.warehouse_code, t.warehouse_id,
  count(*) as trucks_arrived,
  count(*) filter (where t.decision = 'ACCEPTED') as trucks_accepted,
  count(*) filter (where t.status = 'REJECTED') as trucks_rejected,
  count(*) filter (where t.status_group = 'EN_ATTENTE') as trucks_pending,
  sum(t.net_weight_kg) as net_kg,
  sum(t.paid_weight_kg) as paid_weight_kg,
  sum(t.refraction_kg) as refraction_kg,
  sum(t.bags_count) as bags_received,
  sum(t.good_bags) as good_bags, sum(t.humid_bags) as humid_bags, sum(t.torn_bags) as torn_bags,
  sum(t.reconditioned_bags) as reconditioned_bags
from public.reports_v_truck_reception t
group by t.report_date, t.warehouse_code, t.warehouse_id;
