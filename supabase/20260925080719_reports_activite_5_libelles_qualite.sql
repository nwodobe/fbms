-- FBMS · Rapports d'activité (5) : libellés français des décisions qualité

create or replace view public.reports_v_quality_inspection with (security_invoker = true) as
select q.id as quality_inspection_id,
  coalesce(q.reception_id, l.reception_id) as reception_id,
  case q.type when 'SAMPLING' then 'Échantillonnage' when 'FINAL' then 'Qualité finale' when 'POST_DRY' then 'Après séchage' else q.type end as inspection_stage,
  w.code as warehouse,
  case when q.type in ('SAMPLING','FINAL') then 'Réception' else 'Séchage / Tri' end as activity_type,
  q.created_at as inspection_date,
  coalesce(r.supplier_name, l.supplier_name) as supplier_name,
  ccak.reference as ccak_code,
  coalesce(r.supplier_code, l.supplier_code) as anagroci_code,
  coalesce(r.truck, l.truck) as truck_no,
  coalesce(q.lot_id, r.lot_id) as lot_no,
  coalesce(r.origin, l.origin) as origin,
  q.moisture_pct, q.nut_count,
  q.gk_g as good_kernel_g, q.spotted_g, q.imm_g as immature_g, q.voids_g as void_g, q.oil_g, q.browns_g as browns_rejection_g,
  q.kor_display as kor,
  case q.type
    when 'SAMPLING' then case r.decision when 'ACCEPTED' then 'Accepté' when 'REJECTED' then 'Refusé' else r.decision end
    when 'FINAL' then case when q.within_tolerance then 'Conforme (tolérance)' when q.within_tolerance = false then 'Hors tolérance' end
    else case q.disposition when 'READY' then 'Prêt' when 'RE_DRY' then 'À resécher' when 'HOLD' then 'Bloqué' else q.disposition end end as decision,
  q.analyst as quality_head,
  q.note as remarks,
  q.type as inspection_type,
  q.created_at::date as report_date,
  w.id as warehouse_id, w.code as warehouse_code,
  coalesce(r.supplier_code, l.supplier_code) as supplier_code,
  public.reports_truck_norm(coalesce(r.truck, l.truck)) as truck_norm,
  public.reports_status_group(r.status) as status_group,
  r.procurement_channel as channel,
  public.reports_campaign_of(q.created_at::date) as campaign
from public.wms_quality_snapshots q
left join public.wms_lots l on l.id = q.lot_id
left join public.wms_receptions r on r.id = coalesce(q.reception_id, l.reception_id)
left join public.wms_dryings d on d.id = q.drying_id
join public.wms_warehouses w on w.id = coalesce(r.warehouse_id, l.warehouse_id, d.warehouse_id)
left join lateral (select dd.reference from public.wms_reception_documents dd
                   where dd.reception_id = r.id and dd.doc_type = 'CCAK' order by dd.recorded_at desc limit 1) ccak on true
where q.superseded_by is null
  and ((select public.reports_scope_code()) is null or w.code = (select public.reports_scope_code()));
