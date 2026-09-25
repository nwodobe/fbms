-- FBMS · Rapports d'activité (2/4) : Warehouse Receiving, Quality Inspection, Drying Batch

-- 4. Warehouse Receiving --------------------------------------------------
create or replace view public.reports_v_warehouse_receiving with (security_invoker = true) as
select w.site_code as warehouse_site,
  w.code as warehouse,
  ib.bin_id as initial_bin_no,
  pd.dest_bin_id as after_drying_bin_no,
  r.lot_id as lot_no,
  case when pd.id is not null then 'Oui' end as lot_dry,
  r.delivery_note as delivery_note_no,
  null::text as scale_location,
  r.warehouse_receipt as warehouse_receipt_no,
  coalesce(r.offload_end, r.offloaded_at) as fiche_date,
  'Offloading'::text as activity,
  case when ccak.status = 'PRESENT' then 'Oui' when ccak.status is not null then 'Non' end as ccak_validated,
  ib.area_code as storage_area,
  null::text as fiche_cca_no,
  r.truck as truck_no,
  r.arrival_at as arrival_date,
  coalesce(r.offload_end, r.offloaded_at) as discharge_date,
  r.origin, r.supplier_name,
  ccak.reference as cca_no,
  r.supplier_code,
  r.bags_good as good_bags_offloaded,
  case when r.bags_wet is null and r.bags_torn is null then null else coalesce(r.bags_wet,0) + coalesce(r.bags_torn,0) end as damaged_bags_offloaded,
  r.bags as total_bags_discharged,
  r.bags_recond as recondition_bags,
  r.bags as total_bags_stock,
  null::integer as new_bags_used_recondition,
  r.bags_good as good_bags, r.bags_wet as humid_bags, r.bags_torn as torn_bags,
  case when coalesce(r.bags_recond,0) > 0 then 'Oui' else 'Non' end as recondition_flag,
  r.bags_recond as reconditioned_bags,
  l.initial_bags as total_bags_lot,
  null::integer as export_bags, null::integer as bio_bags, null::integer as brousse_bags,
  r.bags as total_received_bags,
  r.gross_kg as gross_weight_kg,
  s.refraction_kg as total_refraction_kg,
  nullif(g.content->'weighing'->>'net_kg','')::numeric as grn_qty_kg,
  s.paid_weight_kg,
  r.net_kg as net_weight_kg,
  null::numeric as weight_difference_kg,
  l.initial_kg as net_weight_book_kg,
  nullif(g.content->'weighing'->>'net_kg','')::numeric as grn_fresh_qty_kg,
  null::numeric as grn_dried_qty_kg,
  qs.browns_g as q1_rejection_g, qs.voids_g as q1_void_g, qs.oil_g as q1_oil_g, null::numeric as q1_total_defect_g,
  qs.gk_g as q1_good_kernel_g, qs.imm_g as q1_immature_g, qs.spotted_g as q1_spotted_g, null::numeric as q1_total_kernels_g,
  qs.kor_display as q1_kor, null::numeric as q1_murli, null::numeric as q1_shot, null::numeric as q1_fot,
  null::numeric as q1_useful_kernel_yield_pct, null::numeric as q1_total_yield_pct,
  qs.moisture_pct as q1_moisture_pct, qs.nut_count as q1_nut_count, null::numeric as q1_shell_g,
  qf.browns_g as q2_rejection_g, null::numeric as q2_murli_total_pct, qf.voids_g as q2_void_g, qf.oil_g as q2_oil_g,
  null::numeric as q2_total_defect_g, qf.gk_g as q2_good_kernel_g, qf.imm_g as q2_immature_g, qf.spotted_g as q2_spotted_g,
  null::numeric as q2_total_kernels_g, qf.kor_display as q2_kor, null::numeric as q2_murli, pd.kor_display as q2_after_dry_kor,
  null::numeric as q2_shot, null::numeric as q2_fot, null::numeric as q2_useful_kernel_yield_pct, null::numeric as q2_total_yield_pct,
  qf.moisture_pct as q2_moisture_pct, qf.nut_count as q2_nut_count, null::numeric as q2_shell_g,
  r.id as reception_id,
  coalesce(r.offload_end, r.offloaded_at)::date as report_date,
  r.warehouse_id, w.code as warehouse_code,
  public.reports_truck_norm(r.truck) as truck_norm,
  g.id as grn_no, ccak.reference as ccak_code,
  public.reports_status_group(r.status) as status_group,
  r.procurement_channel as channel,
  coalesce(s.campaign, public.reports_campaign_of(r.arrival_at::date)) as campaign,
  l.status as lot_status
from public.wms_receptions r
join public.wms_warehouses w on w.id = r.warehouse_id
left join public.wms_lots l on l.id = r.lot_id
left join public.procurement_reception_settlements s on s.reception_id = r.id
left join public.wms_v_quality_current qs on qs.reception_id = r.id and qs.type = 'SAMPLING'
left join public.wms_v_quality_current qf on qf.reception_id = r.id and qf.type = 'FINAL'
left join lateral (select d.reference, d.status from public.wms_reception_documents d
                   where d.reception_id = r.id and d.doc_type = 'CCAK' order by d.recorded_at desc limit 1) ccak on true
left join public.wms_grns g on g.reception_id = r.id
left join lateral (select m.dest_id as bin_id, a.code as area_code
                   from public.wms_movement_lots ml
                   join public.wms_movements m on m.id = ml.movement_id
                   left join public.wms_bins b on b.id = m.dest_id
                   left join public.wms_physical_areas a on a.id = b.physical_area_id
                   where ml.lot_id = r.lot_id and m.dest_type = 'BIN' and m.status = 'POSTED'
                   order by m.posted_at limit 1) ib on true
left join lateral (select p.id, p.dest_bin_id, p.kor_display from public.wms_v_post_dry_quality_current p
                   where p.lot_id = r.lot_id order by p.created_at desc limit 1) pd on true
where r.offloaded_at is not null
  and ((select public.reports_scope_code()) is null or w.code = (select public.reports_scope_code()));

-- 5. Quality Inspection ---------------------------------------------------
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
    when 'SAMPLING' then r.decision
    when 'FINAL' then case when q.within_tolerance then 'Conforme (tolérance)' when q.within_tolerance = false then 'Hors tolérance' end
    else q.disposition end as decision,
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

-- 6. Drying Batch ---------------------------------------------------------
create or replace view public.reports_v_drying_batch with (security_invoker = true) as
select d.id as drying_id,
  d.created_at as drying_date,
  w.site_code as warehouse_site,
  w.code as warehouse,
  d.source_bin_id as source_bin_no,
  d.dest_bin_id as destination_bin_no,
  lt.lot_nos as lot_no_raw,
  lt.receipt_nos as warehouse_receipt_no_raw,
  null::text as fiche_no_raw,
  lt.origins as origin_raw,
  lt.supplier_names as supplier_name_raw,
  lt.supplier_codes as supplier_code_raw,
  lt.ccak_codes as ccak_supplier_code_raw,
  d.status,
  case d.type when 'DRYING' then 'Séchage' when 'SORTING' then 'Tri' else d.type end as dry_type,
  d.dest_bin_id as destination_raw,
  null::numeric as issued_gross_with_bags_pallets_kg,
  null::numeric as issued_pallet_weight_kg,
  null::numeric as issued_gross_with_bags_kg,
  d.input_bags as issued_bags,
  d.input_kg as issued_net_weight_kg,
  null::numeric as received_gross_with_bags_pallets_kg,
  null::numeric as received_pallet_weight_kg,
  null::numeric as received_gross_with_bags_kg,
  d.output_bags as received_bags,
  d.output_kg as received_net_weight_kg,
  d.moisture_before as input_moisture_pct, d.nc_before as input_nut_count, d.kor_before as input_kor,
  d.moisture_after as output_moisture_pct, d.nc_after as output_nut_count, d.kor_after as output_kor,
  pq.oil_g as oil, pq.browns_g as rejection, pq.gk_g as good_kernel, pq.imm_g as immature, pq.spotted_g as spotted,
  null::numeric as shell, pq.voids_g as void,
  case when d.moisture_before is not null and d.moisture_after is not null then d.moisture_before - d.moisture_after end as moisture_loss_pct,
  case when d.type = 'DRYING' then d.process_loss_kg end as drying_loss_kg,
  case when d.type = 'DRYING' then d.process_loss_pct end as drying_loss_pct,
  case when d.type = 'SORTING' then d.process_loss_kg end as triage_loss_kg,
  case when d.type = 'SORTING' then d.process_loss_pct end as triage_loss_pct,
  null::numeric as damaged_nuts_kg,
  d.input_bags as input_bags_for_drying,
  d.output_bags as output_bags_after_drying,
  case d.type when 'DRYING' then 'Drying' when 'SORTING' then 'Picking' else d.type end as drying_or_picking,
  d.note as remarks,
  null::numeric as issued_to_production,
  case when coalesce(d.cycle_no,1) > 1 then d.created_at end as re_drying_date,
  null::numeric as moisture_first_redry_pct,
  null::numeric as moisture_second_dry_pct,
  null::numeric as issued_to_production_3,
  null::text as remarks_4,
  case when coalesce(lt.lot_count,0) > 1 then 'Oui (' || lt.lot_count || ' LOT)' end as needs_lot_allocation_clarification,
  d.created_at::date as report_date,
  d.warehouse_id, w.code as warehouse_code,
  lt.first_supplier_code as supplier_code,
  lt.lot_nos as lot_no,
  public.reports_campaign_of(d.created_at::date) as campaign
from public.wms_dryings d
join public.wms_warehouses w on w.id = d.warehouse_id
left join lateral (
  select string_agg(distinct l.id, ', ') as lot_nos,
         string_agg(distinct r.warehouse_receipt, ', ') as receipt_nos,
         string_agg(distinct l.origin, ', ') as origins,
         string_agg(distinct l.supplier_name, ', ') as supplier_names,
         string_agg(distinct l.supplier_code, ', ') as supplier_codes,
         string_agg(distinct dc.reference, ', ') as ccak_codes,
         min(l.supplier_code) as first_supplier_code,
         count(distinct l.id) as lot_count
  from public.wms_movement_lots ml
  join public.wms_lots l on l.id = ml.lot_id
  left join public.wms_receptions r on r.id = l.reception_id
  left join public.wms_reception_documents dc on dc.reception_id = r.id and dc.doc_type = 'CCAK'
  where ml.movement_id = d.issue_movement_id) lt on true
left join public.wms_quality_snapshots pq on pq.id = d.post_dry_snapshot_id
where (select public.reports_scope_code()) is null or w.code = (select public.reports_scope_code());
