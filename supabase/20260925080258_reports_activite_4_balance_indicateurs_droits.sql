-- FBMS · Rapports d'activité (4/4) : balance sacherie, indicateurs, droits

-- 10. Balance sacherie sur la période ---------------------------------------
-- Opening + Receipts + Transfers In − Issues − Damaged/Discarded − Transfers Out = Closing
-- closing_actual = stock réel du grand livre à la date de fin ; variance =
-- closing_actual − closing (ajustements d'inventaire, pertes approuvées,
-- mouvements non classés dans la formule).
create or replace function public.reports_jute_balance(p_start date, p_end date, p_warehouse_code text default null)
returns table(location_code text, warehouse_code text, opening integer, receipts integer, transfers_in integer, issues integer,
              damaged_discarded integer, transfers_out integer, closing integer, closing_actual integer, variance integer)
language sql stable security invoker set search_path = public, pg_temp as $f$
with loc as (
  select l.code, l.warehouse_code from public.rcn_jute_locations l
  where l.type = 'STOCK' and coalesce(l.scope_type,'') in ('EXTERNAL_WAREHOUSE','FACTORY_WAREHOUSE')
    and (p_warehouse_code is null or l.warehouse_code = p_warehouse_code)
    and ((select public.reports_scope_code()) is null or l.warehouse_code = (select public.reports_scope_code()))
), mv as (
  select m.from_location, m.to_location, m.movement_type, m.qty, m.movement_at::date as d
  from public.rcn_jute_movements m
  where m.ledger = 'INTERNE' and m.from_location is distinct from m.to_location
    and (m.from_location in (select code from loc) or m.to_location in (select code from loc))
    and m.movement_at::date <= p_end
), agg as (
  select lc.code as location_code, lc.warehouse_code,
    coalesce(sum(case when mv.d < p_start and mv.to_location = lc.code then mv.qty
                      when mv.d < p_start and mv.from_location = lc.code then -mv.qty end),0) as opening,
    coalesce(sum(mv.qty) filter (where mv.d >= p_start and mv.to_location = lc.code
                                   and mv.movement_type in ('RECU_LIVRAISON','RETOUR','ACHAT','SOLDE_INITIAL','RETOUR_PRODUCTION')),0) as receipts,
    coalesce(sum(mv.qty) filter (where mv.d >= p_start and mv.to_location = lc.code and mv.movement_type = 'TRANSFERT'),0) as transfers_in,
    coalesce(sum(mv.qty) filter (where mv.d >= p_start and mv.from_location = lc.code
                                   and mv.movement_type in ('DOTATION','SORTIE_PRODUCTION','REBAGING','CONSOMMATION_PRODUCTION')),0) as issues,
    coalesce(sum(mv.qty) filter (where mv.d >= p_start and mv.from_location = lc.code and mv.movement_type = 'REFORME'),0) as damaged_discarded,
    coalesce(sum(mv.qty) filter (where mv.d >= p_start and mv.from_location = lc.code and mv.movement_type = 'TRANSFERT'),0) as transfers_out,
    coalesce(sum(case when mv.to_location = lc.code then mv.qty when mv.from_location = lc.code then -mv.qty end),0) as closing_actual
  from loc lc
  left join mv on (mv.from_location = lc.code or mv.to_location = lc.code)
  group by lc.code, lc.warehouse_code
)
select a.location_code, a.warehouse_code, a.opening::int, a.receipts::int, a.transfers_in::int, a.issues::int,
  a.damaged_discarded::int, a.transfers_out::int,
  (a.opening + a.receipts + a.transfers_in - a.issues - a.damaged_discarded - a.transfers_out)::int as closing,
  a.closing_actual::int,
  (a.closing_actual - (a.opening + a.receipts + a.transfers_in - a.issues - a.damaged_discarded - a.transfers_out))::int as variance
from agg a
order by a.location_code
$f$;

-- 11. Indicateurs du rapport ------------------------------------------------
create or replace function public.reports_activity_summary(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $f$
declare
  v_start date := coalesce(nullif(p->>'start','')::date, current_date);
  v_end date := coalesce(nullif(p->>'end','')::date, coalesce(nullif(p->>'start','')::date, current_date));
  v_wh text := nullif(btrim(coalesce(p->>'warehouse_code','')),'');
  v_sup text := nullif(btrim(coalesce(p->>'supplier','')),'');
  v_truck text := nullif(public.reports_truck_norm(p->>'truck'),'');
  v_lot text := nullif(btrim(coalesce(p->>'lot_no','')),'');
  v_rec text := nullif(btrim(coalesce(p->>'reception_id','')),'');
  v_grn text := nullif(btrim(coalesce(p->>'grn_no','')),'');
  v_ccak text := nullif(btrim(coalesce(p->>'ccak_code','')),'');
  v_status text := nullif(btrim(coalesce(p->>'status_group','')),'');
  v_channel text := nullif(btrim(coalesce(p->>'channel','')),'');
  v_campaign text := nullif(btrim(coalesce(p->>'campaign','')),'');
  k jsonb; v_plan bigint; v_rcn jsonb; v_jute jsonb;
begin
  if v_end < v_start then raise exception 'Période invalide : la date de fin précède la date de début' using errcode = '22023'; end if;
  if v_end - v_start > 1100 then raise exception 'Période trop longue (3 ans maximum)' using errcode = '22023'; end if;

  with t as (
    select t.* from public.reports_v_truck_reception t
    where t.report_date between v_start and v_end
      and (v_wh is null or t.warehouse_code = v_wh)
      and (v_sup is null or t.supplier_code ilike '%'||v_sup||'%' or t.supplier_name ilike '%'||v_sup||'%')
      and (v_truck is null or t.truck_norm like '%'||v_truck||'%')
      and (v_lot is null or t.lot_no = v_lot)
      and (v_rec is null or t.reception_id = v_rec)
      and (v_grn is null or t.grn_no = v_grn)
      and (v_ccak is null or t.ccak_code ilike '%'||v_ccak||'%')
      and (v_status is null or t.status_group = v_status)
      and (v_channel is null or t.channel = v_channel)
      and (v_campaign is null or t.campaign = v_campaign)
  ), lt as (
    select l.status, l.staging_kg from public.wms_v_lots l where l.id in (select t.lot_no from t where t.lot_no is not null)
  )
  select jsonb_build_object(
    'trucks_arrived', (select count(*) from t),
    'trucks_accepted', (select count(*) from t where t.decision = 'ACCEPTED'),
    'trucks_rejected', (select count(*) from t where t.status = 'REJECTED'),
    'trucks_pending', (select count(*) from t where t.status_group = 'EN_ATTENTE'),
    'net_kg', (select coalesce(sum(t.net_weight_kg),0) from t),
    'paid_weight_kg', (select coalesce(sum(t.paid_weight_kg),0) from t),
    'refraction_kg', (select coalesce(sum(t.refraction_kg),0) from t),
    'bags_received', (select coalesce(sum(t.bags_count),0) from t),
    'good_bags', (select coalesce(sum(t.good_bags),0) from t),
    'humid_bags', (select coalesce(sum(t.humid_bags),0) from t),
    'torn_bags', (select coalesce(sum(t.torn_bags),0) from t),
    'reconditioned_bags', (select coalesce(sum(t.reconditioned_bags),0) from t),
    'receptions_without_grn', (select count(*) from t where t.offloaded_at is not null and t.status <> 'REJECTED' and t.grn_no is null),
    'documents_missing', (select count(*) from t where t.doc_status in ('INCOMPLET','REJETE')),
    'lots_hold', (select count(*) from lt where lt.status = 'HOLD'),
    'lots_released', (select count(*) from lt where lt.status = 'RELEASED'),
    'lots_not_binned', (select count(*) from lt where lt.status = 'RELEASED' and coalesce(lt.staging_kg,0) > 0.0005))
  into k;

  select count(*) into v_plan from public.reports_v_delivery_plan d
  where d.report_date between v_start and v_end
    and (v_wh is null or d.warehouse_code = v_wh)
    and (v_sup is null or d.supplier_code ilike '%'||v_sup||'%' or d.supplier ilike '%'||v_sup||'%')
    and (v_truck is null or d.truck_norm like '%'||v_truck||'%')
    and (v_channel is null or d.channel = v_channel)
    and (v_campaign is null or d.campaign = v_campaign);

  select coalesce(jsonb_agg(jsonb_build_object('warehouse_code', x.code, 'warehouse_id', x.id, 'rcn_closing_kg', x.kg) order by x.code), '[]'::jsonb)
  into v_rcn
  from (
    select w.code, w.id,
      round(coalesce(sum(case when m.dest_type in ('STAGING','BIN','DRYING') then ml.qty_in else 0 end)
                   - sum(case when m.source_type in ('STAGING','BIN','DRYING') then ml.qty_out else 0 end), 0), 3) as kg
    from public.wms_warehouses w
    join public.wms_movements m on m.warehouse_id = w.id and m.status = 'POSTED' and m.posted_at::date <= v_end
    join public.wms_movement_lots ml on ml.movement_id = m.id
    where (v_wh is null or w.code = v_wh)
      and ((select public.reports_scope_code()) is null or w.code = (select public.reports_scope_code()))
    group by w.code, w.id) x;

  select coalesce(jsonb_agg(to_jsonb(j) order by j.location_code), '[]'::jsonb) into v_jute
  from public.reports_jute_balance(v_start, v_end, v_wh) j;

  return k || jsonb_build_object(
    'trucks_planned', v_plan,
    'rcn_closing_kg', (select coalesce(sum((e->>'rcn_closing_kg')::numeric),0) from jsonb_array_elements(v_rcn) e),
    'rcn_closing_by_warehouse', v_rcn,
    'jute_closing_bags', (select coalesce(sum((e->>'closing_actual')::int),0) from jsonb_array_elements(v_jute) e),
    'jute_balance', v_jute,
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'scope', (select public.reports_scope_code()),
    'generated_at', now());
end $f$;

-- Droits : lecture réservée aux utilisateurs connectés -----------------------
revoke all on public.reports_v_suppliers, public.reports_v_delivery_plan, public.reports_v_truck_reception,
  public.reports_v_warehouse_receiving, public.reports_v_quality_inspection, public.reports_v_drying_batch,
  public.reports_v_warehouse_activity_ledger, public.reports_v_jute_bags_movement, public.reports_v_activity_summary from anon, public;
grant select on public.reports_v_suppliers, public.reports_v_delivery_plan, public.reports_v_truck_reception,
  public.reports_v_warehouse_receiving, public.reports_v_quality_inspection, public.reports_v_drying_batch,
  public.reports_v_warehouse_activity_ledger, public.reports_v_jute_bags_movement, public.reports_v_activity_summary to authenticated;
revoke execute on function public.reports_scope_code(), public.reports_campaign_of(date), public.reports_status_group(text),
  public.reports_truck_norm(text), public.reports_jute_balance(date, date, text), public.reports_activity_summary(jsonb) from public, anon;
grant execute on function public.reports_scope_code(), public.reports_campaign_of(date), public.reports_status_group(text),
  public.reports_truck_norm(text), public.reports_jute_balance(date, date, text), public.reports_activity_summary(jsonb) to authenticated, service_role;
