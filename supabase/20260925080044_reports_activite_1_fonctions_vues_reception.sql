-- FBMS · Rapports d'activité (1/4) : fonctions utilitaires, Suppliers, Delivery Plan, Truck Reception
-- FBMS · Rapports d'activité (Warehouse / Procurement) · 25/09/2026
-- Vues de reporting en lecture seule, alignées sur le modèle Excel
-- « ANAGROCI DATA PROCUREMENT » (en-têtes uniquement, aucune donnée copiée).
--  * security_invoker : les politiques RLS des tables sources s'appliquent
--    à l'utilisateur connecté (aucune élévation de droits).
--  * périmètre : un profil rattaché à un Warehouse (rôles
--    warehouse_scoped_roles) ne voit que son Warehouse.
--  * colonnes absentes de la base : NULL (colonne vide dans l'export),
--    jamais de valeur inventée.
--  * colonnes de filtre communes : report_date, warehouse_id,
--    warehouse_code, supplier_code, truck_norm, lot_no, reception_id,
--    grn_no, ccak_code, status_group, channel, campaign.
-- Aucune table n'est créée ni modifiée.

create or replace function public.reports_scope_code()
returns text language sql stable security definer set search_path = public, pg_temp as $f$
  select case
    when p.user_id is null then null
    when not coalesce((public.wms_param('transferRoleMatrix')->'warehouse_scoped_roles') ? p.role, false) then null
    when nullif(btrim(p.warehouse_code),'') is null then '∅'
    else btrim(p.warehouse_code) end
  from (select 1) x
  left join public.profils p on p.user_id = (select auth.uid()) and coalesce(p.actif,false)
$f$;

create or replace function public.reports_campaign_of(p_date date)
returns text language sql stable security definer set search_path = public, pg_temp as $f$
  select c.code from public.procurement_campaigns c
  where p_date between c.starts_on and c.ends_on order by c.starts_on desc limit 1
$f$;

create or replace function public.reports_status_group(p_status text)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select case p_status
    when 'REJECTED' then 'REJETE'
    when 'QUALITY_HOLD' then 'HOLD'
    when 'RELEASED' then 'LIBERE'
    when 'CLOSED' then 'LIBERE'
    when 'ACCEPTED_WAITING_OFFLOAD' then 'ACCEPTE'
    when 'AWAITING_FINAL_QA' then 'ACCEPTE'
    else 'EN_ATTENTE' end
$f$;

create or replace function public.reports_truck_norm(p text)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select upper(regexp_replace(coalesce(p,''),'[^A-Za-z0-9]','','g'))
$f$;

-- 1. Suppliers ------------------------------------------------------------
create or replace view public.reports_v_suppliers with (security_invoker = true) as
select f.code as supplier_code, f.nom as supplier_name, f.categorie as channel, f.statut as supplier_status, f.supplier_id
from public.rcn_fournisseurs f;

-- 2. Delivery Plan --------------------------------------------------------
create or replace view public.reports_v_delivery_plan with (security_invoker = true) as
select a.arrival_id as delivery_plan_id,
  a.eta_date as planned_delivery_date,
  a.supplier_name as supplier,
  coalesce(a.current_code, a.supplier_code) as supplier_code,
  a.expected_kg as expected_quantity_kg,
  null::text as expected_truck_type,
  a.eta as expected_arrival_date,
  a.warehouse_code as destination_warehouse,
  a.actual_arrival_at as actual_arrival_date,
  a.status as delivery_status,
  a.truck as truck_no,
  nullif(concat_ws(' · ', a.last_reschedule_reason, a.cancel_reason), '') as remarks,
  coalesce(a.eta_date, a.created_at::date) as report_date,
  a.warehouse_id, a.warehouse_code,
  public.reports_truck_norm(a.truck) as truck_norm,
  a.reception_id,
  public.reports_status_group(a.reception_status) as status_group,
  a.channel,
  coalesce(a.campaign, public.reports_campaign_of(coalesce(a.eta_date, a.created_at::date))) as campaign
from public.procurement_v_arrival_schedule a
where (select public.reports_scope_code()) is null or a.warehouse_code = (select public.reports_scope_code());

-- 3. Truck Reception ------------------------------------------------------
create or replace view public.reports_v_truck_reception with (security_invoker = true) as
select r.id as reception_id,
  r.arrival_at as arrival_date,
  coalesce(r.offload_end, r.offloaded_at) as offloading_date,
  s.payment_method as payment_type,
  coalesce(nullif(btrim(w.location),''), w.site_code) as warehouse_location,
  w.code as warehouse_code,
  r.supplier_name, r.supplier_code,
  r.truck as truck_no,
  ccak.reference as fiche_code,
  r.warehouse_receipt as fiche_offloading_no,
  r.bags as bags_count,
  r.gross_kg as gross_weight_kg,
  r.net_kg as net_weight_kg,
  r.bags_good as good_bags, r.bags_wet as humid_bags, r.bags_torn as torn_bags,
  s.refraction_kg, s.paid_weight_kg,
  coalesce(s.approved_price, s.price_per_kg) as price_cfa_per_kg,
  coalesce(s.amount_approved, s.amount_payable) as amount_cfa,
  qs.moisture_pct, qs.nut_count, qs.kor_display as kor, qf.kor_display as final_kor,
  r.origin,
  nullif(concat_ws(' · ', r.decision_comment, r.hold_reason), '') as remarks,
  'W-' || extract(week from r.arrival_at)::int || ' ' || to_char(r.arrival_at, 'Mon') as week,
  r.status, public.reports_status_group(r.status) as status_group, r.decision, r.rejection_reason_code,
  r.arrival_at::date as report_date, r.warehouse_id,
  public.reports_truck_norm(r.truck) as truck_norm,
  r.lot_id as lot_no, g.id as grn_no, ccak.reference as ccak_code,
  r.procurement_channel as channel,
  coalesce(s.campaign, public.reports_campaign_of(r.arrival_at::date)) as campaign,
  r.bags_recond as reconditioned_bags,
  r.offloaded_at,
  ds.doc_status
from public.wms_receptions r
join public.wms_warehouses w on w.id = r.warehouse_id
left join public.procurement_reception_settlements s on s.reception_id = r.id
left join public.wms_v_quality_current qs on qs.reception_id = r.id and qs.type = 'SAMPLING'
left join public.wms_v_quality_current qf on qf.reception_id = r.id and qf.type = 'FINAL'
left join lateral (select d.reference, d.status from public.wms_reception_documents d
                   where d.reception_id = r.id and d.doc_type = 'CCAK' order by d.recorded_at desc limit 1) ccak on true
left join public.wms_grns g on g.reception_id = r.id
left join public.wms_v_reception_documents_status ds on ds.reception_id = r.id
where (select public.reports_scope_code()) is null or w.code = (select public.reports_scope_code());
