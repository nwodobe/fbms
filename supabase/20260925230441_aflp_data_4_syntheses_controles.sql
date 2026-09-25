-- FBMS · AFLP DATA (4/5) : synthèses filtrables (RPC) et contrôles obligatoires.
-- Fonctions SECURITY INVOKER : elles lisent les vues aflp_v_* sous la RLS de
-- l'appelant. Paramètre p (jsonb) : from, to, campaign, zone, cluster,
-- clusters (liste), village, rt, producer. Tout filtre vide est ignoré.
-- Appliquée en base en deux temps (aflp_data_4a_filtres_referentiels, aflp_data_4b_overview_controles_performance).
-- Ce fichier contient l'état final, correctif de la migration 5 inclus.

-- 1. Filtres ---------------------------------------------------------------------
create or replace function public.aflp_from(p jsonb)
returns date language sql immutable set search_path = public, pg_temp as $f$
  select coalesce(public.aflp_date(p->>'from'), date '1900-01-01')
$f$;

create or replace function public.aflp_to(p jsonb)
returns date language sql immutable set search_path = public, pg_temp as $f$
  select coalesce(public.aflp_date(p->>'to'), date '2999-12-31')
$f$;

create or replace function public.aflp_camp_ok(p jsonb, c text)
returns boolean language sql immutable set search_path = public, pg_temp as $f$
  select nullif(btrim(p->>'campaign'), '') is null or coalesce(c, '2027') = btrim(p->>'campaign')
$f$;

-- Filtre strict (faits : achats, mouvements) : une valeur absente ne passe pas un filtre posé.
create or replace function public.aflp_ok(p jsonb, z text, c text, v text, r text)
returns boolean language sql immutable set search_path = public, pg_temp as $f$
  select (nullif(p->>'zone', '') is null or z = p->>'zone')
    and (nullif(p->>'cluster', '') is null or c = p->>'cluster')
    and (jsonb_typeof(p->'clusters') is distinct from 'array' or jsonb_array_length(p->'clusters') = 0
         or c in (select jsonb_array_elements_text(p->'clusters')))
    and (nullif(p->>'village', '') is null or v = p->>'village')
    and (nullif(p->>'rt', '') is null or r = p->>'rt')
$f$;

-- Filtre souple (référentiels) : village ou RT absent = non concerné.
create or replace function public.aflp_ok_dim(p jsonb, z text, c text, v text, r text)
returns boolean language sql immutable set search_path = public, pg_temp as $f$
  select (nullif(p->>'zone', '') is null or z = p->>'zone')
    and (nullif(p->>'cluster', '') is null or c = p->>'cluster')
    and (jsonb_typeof(p->'clusters') is distinct from 'array' or jsonb_array_length(p->'clusters') = 0
         or c in (select jsonb_array_elements_text(p->'clusters')))
    and (nullif(p->>'village', '') is null or v is null or v = p->>'village')
    and (nullif(p->>'rt', '') is null or r is null or r = p->>'rt')
$f$;

create or replace function public.aflp_prod_ok(p jsonb, pid text)
returns boolean language sql immutable set search_path = public, pg_temp as $f$
  select nullif(p->>'producer', '') is null or pid = p->>'producer'
$f$;

-- 2. Onglet 2 · Zones & Clusters --------------------------------------------------
create or replace function public.aflp_rpt_zones_clusters(p jsonb default '{}'::jsonb)
returns table (zone text, cluster text, department text, sous_prefecture text, main_town text,
  zone_head text, unit_head text, assistant text, number_of_villages bigint, target_mt numeric,
  potential_mt numeric, secured_mt numeric, purchased_mt numeric, evacuated_mt numeric,
  remaining_mt numeric, performance_pct numeric, risk_level text, remarks text,
  zone_code text, cluster_code text)
language sql stable set search_path = public, pg_temp as $f$
with cl as (
  select c.code, c.label, c.zone_code, z.label as zone_label
  from public.aflp_clusters c left join public.aflp_zones z on z.code = c.zone_code
  where c.active and public.aflp_ok_dim(p, c.zone_code, c.code, null, null)
    and (nullif(p->>'village', '') is null or exists (select 1 from public.aflp_v_village_dim x
          where x.village_id = p->>'village' and x.cluster_code = c.code))
), vil as (
  select vd.cluster_code, count(*) as n, sum(vd.potential_mt) as pot, sum(vd.secured_mt) as sec,
    mode() within group (order by vd.department) as dep,
    string_agg(distinct vd.sous_prefecture, ', ') as sp,
    count(*) filter (where not exists (select 1 from public.aflp_v_rt_dim r where r.village_id = vd.village_id)) as sans_rt
  from public.aflp_v_village_dim vd
  where public.aflp_ok_dim(p, vd.zone_code, vd.cluster_code, vd.village_id, null)
  group by vd.cluster_code
), pur as (
  select d.cluster_code, sum(d.quantity_kg) as kg, count(distinct d.village_id) as villages_actifs
  from public.aflp_v_daily_purchases d
  where not d.rejet and d.purchase_date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_camp_ok(p, d.campaign) and public.aflp_prod_ok(p, d.producteur_id)
    and public.aflp_ok(p, d.zone_code, d.cluster_code, d.village_id, d.rt_id)
  group by d.cluster_code
), evc as (
  select s.cluster_code, sum(s.evacuated_kg) as kg
  from public.aflp_v_field_stock s
  where s.date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_ok_dim(p, s.zone_code, s.cluster_code, s.village_id, null)
  group by s.cluster_code
), tg as (
  select t.scope_code, t.target_mt from public.aflp_program_targets t
  where t.scope_type = 'CLUSTER' and t.campaign = coalesce(nullif(p->>'campaign', ''), '2027')
), inc as (
  select i.cluster_code, count(*) filter (where i.status_code <> 'CLOS') as open_n,
    count(*) filter (where i.status_code <> 'CLOS' and i.severity_code in ('ELEVEE', 'CRITIQUE')) as hi
  from public.aflp_v_incidents i where i.date <= public.aflp_to(p) group by i.cluster_code
)
select cl.zone_label, cl.label, vil.dep, vil.sp,
  case when w.code is not null then cl.label end,
  st.zone_head, st.unit_head, st.assistant,
  coalesce(vil.n, 0), tg.target_mt, vil.pot, vil.sec,
  round(coalesce(pur.kg, 0) / 1000, 3), round(coalesce(evc.kg, 0) / 1000, 3),
  case when tg.target_mt is not null then round(tg.target_mt - coalesce(pur.kg, 0) / 1000, 3) end,
  case when tg.target_mt > 0 then round(100 * coalesce(pur.kg, 0) / 1000 / tg.target_mt, 1) end,
  case when coalesce(inc.hi, 0) > 0 then 'Élevé'
       when coalesce(inc.open_n, 0) > 0 or coalesce(vil.sans_rt, 0) > 0 then 'Moyen' else 'Faible' end,
  nullif(concat_ws(' · ',
    case when tg.target_mt is null then 'Objectif cluster à compléter' end,
    case when w.code is null then 'Pas d''entrepôt relais configuré (transit Bouaké possible)' end,
    case when coalesce(vil.sans_rt, 0) > 0 then vil.sans_rt || ' village(s) sans RT' end,
    case when coalesce(vil.n, 0) - coalesce(pur.villages_actifs, 0) > 0
         then (coalesce(vil.n, 0) - coalesce(pur.villages_actifs, 0)) || ' village(s) sans achat' end,
    case when coalesce(inc.open_n, 0) > 0 then inc.open_n || ' incident(s) ouvert(s)' end), ''),
  cl.zone_code, cl.code
from cl
left join vil on vil.cluster_code = cl.code
left join pur on pur.cluster_code = cl.code
left join evc on evc.cluster_code = cl.code
left join tg on tg.scope_code = cl.code
left join inc on inc.cluster_code = cl.code
left join public.aflp_cluster_staff() st on st.cluster_code = cl.code
left join public.wms_warehouses w on w.code = 'WH-' || cl.code
order by cl.zone_code, cl.label
$f$;

-- 3. Onglet 4 · Producers Registry --------------------------------------------------
create or replace function public.aflp_rpt_producers(p jsonb default '{}'::jsonb)
returns table (producer_id text, producer_name text, phone_number text, village text, zone text, cluster text,
  rt_assigned text, estimated_farm_size_ha numeric, estimated_production_kg numeric, secured_quantity_kg numeric,
  producer_status text, id_document_available text, payment_method text, wave_number text,
  last_transaction_date date, total_sold_kg numeric, total_amount_paid numeric, outstanding_balance numeric,
  traceability_status text, remarks text, zone_code text, cluster_code text, village_id text, rt_id text,
  producteur_uuid text)
language sql stable set search_path = public, pg_temp as $f$
with pur as (
  select a.producteur_id, max(a.date) as last_d, sum(a.poids_net) as kg, sum(coalesce(a.montant, 0)) as paid,
    sum(case when a.montant is null then a.poids_net * a.prix_kg else 0 end) as due
  from public.achats a
  where not coalesce(a.rejet, false) and a.producteur_id is not null
    and a.date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_camp_ok(p, public.aflp_campaign(a.campaign))
  group by a.producteur_id
), tr as (
  select distinct on (t.producteur_id) t.producteur_id, t.overall_status, t.next_action
  from public.field_traceability_completeness_v t where t.producteur_id is not null
  order by t.producteur_id, t.achat_date desc, t.created_at desc
)
select coalesce(nullif(p0.code, ''), p0.id),
  nullif(btrim(concat_ws(' ', p0.nom, p0.prenoms)), ''),
  p0.telephone, vd.village_name, vd.zone, vd.cluster, rd.rt_name,
  public.aflp_num(p0.data->>'superficieHa'),
  coalesce(public.aflp_num(p0.data->>'potentiel2027Kg'), public.aflp_num(p0.data->>'prodPrecKg')),
  public.aflp_num(p0.data->>'engagementKg'),
  coalesce(p0.statut, p0.operational_status),
  case when coalesce(nullif(p0.id_document_type, ''), nullif(p0.data->>'pieceType', '')) is not null
       then 'Oui (' || coalesce(nullif(p0.id_document_type, ''), p0.data->>'pieceType') || ')' else 'Non' end,
  nullif(p0.data->>'paiementMode', ''),
  nullif(p0.data->>'mobileMoneyNum', ''),
  pur.last_d, pur.kg, pur.paid, pur.due,
  case when tr.overall_status is null then case when pur.kg is null then 'Sans achat' else 'Non évalué' end
       when tr.overall_status in ('COMPLETE', 'COMPLET', 'OK') then 'Complète'
       else 'Incomplète · ' || coalesce(tr.next_action, tr.overall_status) end,
  nullif(concat_ws(' · ',
    case when p0.possible_duplicate then 'Doublon possible' end,
    case when p0.review_required then 'Revue requise' || coalesce(' : ' || nullif(p0.review_reason, ''), '') end,
    case when p0.village_id is null then 'Village manquant' end,
    case when p0.rt_id is null then 'RT manquant' end), ''),
  vd.zone_code, vd.cluster_code, p0.village_id, coalesce(ra.rt_id, p0.rt_id), p0.id
from public.producteurs p0
left join public.aflp_v_village_dim vd on vd.village_id = p0.village_id
left join public.aflp_v_rt_alias ra on ra.any_rt_id = p0.rt_id
left join public.aflp_v_rt_dim rd on rd.rt_id = coalesce(ra.rt_id, p0.rt_id)
left join pur on pur.producteur_id = p0.id
left join tr on tr.producteur_id = p0.id
where not coalesce(p0.deleted, false)
  and public.aflp_ok(p, vd.zone_code, vd.cluster_code, p0.village_id, coalesce(ra.rt_id, p0.rt_id))
  and public.aflp_prod_ok(p, p0.id)
order by vd.cluster, vd.village_name, 2
$f$;

-- 4. Onglet 5 · RT & Field Teams ------------------------------------------------------
-- Achats : sur la période. Cash et sacs : soldes cumulés à la date de fin.
create or replace function public.aflp_rpt_field_teams(p jsonb default '{}'::jsonb)
returns table (staff_id text, name text, role text, zone text, cluster text, assigned_village text,
  phone text, sim_wave text, active_status text, start_date date, supervisor text,
  producers_assigned bigint, target_kg numeric, purchased_kg numeric, achievement_pct numeric,
  cash_advance_received numeric, cash_justified numeric, cash_balance numeric,
  bags_issued numeric, bags_returned numeric, bags_balance numeric, incidents bigint, remarks text,
  zone_code text, cluster_code text, village_id text, rt_id text)
language sql stable set search_path = public, pg_temp as $f$
with pur as (
  select d.rt_id, d.cluster_code, d.zone_code, sum(d.quantity_kg) as kg
  from public.aflp_v_daily_purchases d
  where not d.rejet and d.purchase_date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_camp_ok(p, d.campaign) and public.aflp_prod_ok(p, d.producteur_id)
  group by d.rt_id, d.cluster_code, d.zone_code
), cash as (
  select c.rt_id, sum(c.amount_received) as rec, sum(c.amount_paid) as paid, sum(c.amount_returned) as ret
  from public.aflp_v_cash_advances c where c.date <= public.aflp_to(p) group by c.rt_id
), bags as (
  select j.rt_id, sum(j.bags_received + j.bags_transferred_in) as issued, sum(j.bags_transferred_out) as returned
  from public.aflp_v_jute_bags_ledger j
  where j.location_scope = 'RT' and j.movement_date::date <= public.aflp_to(p) group by j.rt_id
), bal as (
  select distinct on (j.rt_id) j.rt_id, j.closing_balance
  from public.aflp_v_jute_bags_ledger j
  where j.location_scope = 'RT' and j.movement_date::date <= public.aflp_to(p)
  order by j.rt_id, j.movement_date desc, j.movement_id desc
), prod as (
  select coalesce(ra.rt_id, p1.rt_id) as rt_id, count(*) as n
  from public.producteurs p1 left join public.aflp_v_rt_alias ra on ra.any_rt_id = p1.rt_id
  where not coalesce(p1.deleted, false) group by 1
), inc as (
  select i.rt_id, i.cluster_code, i.zone_code, i.status_code from public.aflp_v_incidents i
  where i.status_code <> 'CLOS' and i.date <= public.aflp_to(p)
), st as (select * from public.aflp_cluster_staff())
select r.staff_code, r.rt_name, 'RT (Représentant terrain)', r.zone, r.cluster, r.village_name, r.phone, r.wave_info,
  r.rt_status, null::date, st.unit_head,
  coalesce(prod.n, 0), r.target_kg,
  coalesce((select sum(x.kg) from pur x where x.rt_id = r.rt_id), 0),
  case when r.target_kg > 0 then round(100 * coalesce((select sum(x.kg) from pur x where x.rt_id = r.rt_id), 0) / r.target_kg, 1) end,
  coalesce(cash.rec, 0), coalesce(cash.paid, 0), coalesce(cash.rec, 0) - coalesce(cash.paid, 0) - coalesce(cash.ret, 0),
  coalesce(bags.issued, 0)::numeric, coalesce(bags.returned, 0)::numeric, coalesce(bal.closing_balance, 0)::numeric,
  (select count(*) from inc where inc.rt_id = r.rt_id),
  nullif(concat_ws(' · ',
    case when r.target_kg is null then 'Objectif RT à compléter' end,
    case when coalesce(cash.rec, 0) - coalesce(cash.paid, 0) < 0 then 'Achats supérieurs aux avances' end,
    case when r.rt_status is distinct from 'Confirmé' then 'RT ' || lower(coalesce(r.rt_status, 'sans statut')) end), ''),
  r.zone_code, r.cluster_code, r.village_id, r.rt_id
from public.aflp_v_rt_dim r
left join cash on cash.rt_id = r.rt_id
left join bags on bags.rt_id = r.rt_id
left join bal on bal.rt_id = r.rt_id
left join prod on prod.rt_id = r.rt_id
left join st on st.cluster_code = r.cluster_code
where public.aflp_ok(p, r.zone_code, r.cluster_code, r.village_id, r.rt_id)
union all
select s.staff_ref, s.nom,
  case s.role when 'Zonal Head' then 'Chef de Zone (Zonal Head)' when 'Unit Head' then 'Chef d''Unité (Unit Head)'
    when 'Assistant Unit Head' then 'Assistant Chef d''Unité' else s.role end,
  z.label, c.label, null, s.telephone, null,
  case when s.actif then 'Actif' else 'Inactif' end, null::date,
  case when s.role in ('Unit Head', 'Chef d''Unité') then st.zone_head
       when s.role = 'Assistant Unit Head' then st.unit_head end,
  null::bigint, null::numeric,
  case when s.cluster_code is not null then coalesce((select sum(x.kg) from pur x where x.cluster_code = s.cluster_code), 0)
       when s.zone_code is not null then coalesce((select sum(x.kg) from pur x where x.zone_code = s.zone_code), 0) end,
  null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
  (select count(*) from inc where (s.cluster_code is not null and inc.cluster_code = s.cluster_code)
      or (s.cluster_code is null and s.zone_code is not null and inc.zone_code = s.zone_code)),
  case when s.cluster_code is null and s.zone_code is null then 'Périmètre (zone ou cluster) à compléter dans le profil' end,
  s.zone_code, s.cluster_code, null, null
from public.aflp_staff_directory() s
left join public.aflp_clusters c on c.code = s.cluster_code
left join public.aflp_zones z on z.code = coalesce(s.zone_code, c.zone_code)
left join st on st.cluster_code = s.cluster_code
where nullif(p->>'rt', '') is null and nullif(p->>'village', '') is null
  and public.aflp_ok_dim(p, s.zone_code, s.cluster_code, null, null)
$f$;

-- 5. Onglet 12 · Warehouse Relay AFLP ---------------------------------------------------
-- Seuls les flux AFLP sont comptés : réceptions issues d'une évacuation terrain
-- ou de type Achat Bord Champ, et lignes de transfert portant ces lots vers l'usine.
create or replace function public.aflp_rpt_warehouse_relay(p jsonb default '{}'::jsonb)
returns table (warehouse_relay text, zone text, cluster text, location text, opening_stock_kg numeric,
  received_from_field_kg numeric, transferred_to_yamoussoukro_kg numeric, closing_stock_kg numeric,
  bags_received numeric, bags_transferred numeric, quality_status text, lot_number text,
  bin_location text, last_movement_date date, remarks text, zone_code text, cluster_code text, warehouse_code text)
language sql stable set search_path = public, pg_temp as $f$
with rec as (
  select r.id, r.warehouse_id, coalesce(r.offloaded_at, r.arrival_at, r.created_at)::date as d,
    coalesce(r.net_kg, r.expected_kg, 0) as kg, coalesce(r.bags, r.expected_bags, 0) as bags, r.lot_id, r.status,
    (select min(e.cluster_code) from public.aflp_v_evacuations e where e.shipment_uuid = r.field_shipment_id) as cluster_code
  from public.wms_receptions r
  where (r.field_shipment_id is not null or r.purchase_type = 'FIELD_BUYING') and r.status <> 'REJECTED'
), lots as (
  select l.id as lot_id, l.warehouse_id from public.wms_lots l join rec on rec.id = l.reception_id
), trf as (
  select t.id, t.origin_warehouse_id as wh, coalesce(t.departed_at, t.loaded_at, t.requested_at)::date as d,
    sum(coalesce(tl.dispatched_qty, 0)) as kg,
    case when t.dispatched_qty > 0 then round(coalesce(t.bags_loaded, 0) * sum(coalesce(tl.dispatched_qty, 0)) / t.dispatched_qty) end as bags
  from public.wms_transfers t
  join public.wms_transfer_lines tl on tl.transfer_id = t.id
  join lots on lots.lot_id = tl.lot_id
  join public.wms_warehouses dw on dw.id = t.dest_warehouse_id and dw.is_factory
  where not coalesce(t.is_test, false)
    and t.status in ('IN_TRANSIT', 'ARRIVED', 'DISCREPANCY', 'RESOLUTION_PENDING', 'RECONCILED', 'CLOSED')
  group by t.id, t.origin_warehouse_id, t.departed_at, t.loaded_at, t.requested_at, t.dispatched_qty, t.bags_loaded
), wh as (
  select w.*, coalesce(public.aflp_cluster_code(w.location), public.aflp_cluster_code(replace(w.code, 'WH-', '')),
      (select min(rec.cluster_code) from rec where rec.warehouse_id = w.id)) as cl_code
  from public.wms_warehouses w
  where not coalesce(w.is_factory, false)
    and (w.code like 'WH-%' or exists (select 1 from rec where rec.warehouse_id = w.id))
)
select w.code || ' · ' || w.name, z.label, c.label, w.location,
  coalesce((select sum(kg) from rec where rec.warehouse_id = w.id and rec.d < public.aflp_from(p)), 0)
    - coalesce((select sum(kg) from trf where trf.wh = w.id and trf.d < public.aflp_from(p)), 0),
  coalesce((select sum(kg) from rec where rec.warehouse_id = w.id and rec.d between public.aflp_from(p) and public.aflp_to(p)), 0),
  coalesce((select sum(kg) from trf where trf.wh = w.id and trf.d between public.aflp_from(p) and public.aflp_to(p)), 0),
  coalesce((select sum(kg) from rec where rec.warehouse_id = w.id and rec.d <= public.aflp_to(p)), 0)
    - coalesce((select sum(kg) from trf where trf.wh = w.id and trf.d <= public.aflp_to(p)), 0),
  coalesce((select sum(bags) from rec where rec.warehouse_id = w.id and rec.d between public.aflp_from(p) and public.aflp_to(p)), 0)::numeric,
  coalesce((select sum(bags) from trf where trf.wh = w.id and trf.d between public.aflp_from(p) and public.aflp_to(p)), 0)::numeric,
  (select string_agg(x.lib || ' : ' || x.n, ' · ' order by x.lib) from (
     select case rec.status when 'ARRIVED' then 'Arrivé' when 'AWAITING_DECISION' then 'Décision qualité attendue'
       when 'ACCEPTED_WAITING_OFFLOAD' then 'Accepté, déchargement' when 'AWAITING_FINAL_QA' then 'Analyse finale attendue'
       when 'QUALITY_HOLD' then 'Bloqué qualité' when 'RELEASED' then 'Libéré' when 'CLOSED' then 'Clôturé' else rec.status end as lib,
       count(*) as n
     from rec where rec.warehouse_id = w.id and rec.d <= public.aflp_to(p) group by 1) x),
  (select string_agg(distinct lots.lot_id, ', ') from lots where lots.warehouse_id = w.id),
  (select string_agg(distinct v.bin_id, ', ') from public.wms_v_bin_lot_available v
     join lots on lots.lot_id = v.lot_id where v.warehouse_id = w.id and v.physical_kg > 0),
  greatest((select max(rec.d) from rec where rec.warehouse_id = w.id), (select max(trf.d) from trf where trf.wh = w.id)),
  nullif(concat_ws(' · ',
    case when w.code like 'BKE-%' then 'Transit Bouaké (flux AFLP enregistré)' end,
    case when not exists (select 1 from rec where rec.warehouse_id = w.id) then 'Aucun flux AFLP enregistré' end,
    case when w.status is distinct from 'ACTIVE' then 'Entrepôt ' || lower(coalesce(w.status, 'inactif')) end), ''),
  c.zone_code, w.cl_code, w.code
from wh w
left join public.aflp_clusters c on c.code = w.cl_code
left join public.aflp_zones z on z.code = c.zone_code
where public.aflp_ok_dim(p, c.zone_code, w.cl_code, null, null)
order by w.code
$f$;

-- 6. Livraisons AFLP à l'usine de Yamoussoukro ---------------------------------------
create or replace function public.aflp_delivered_factory_kg(p jsonb default '{}'::jsonb)
returns numeric language sql stable set search_path = public, pg_temp as $f$
  with rec as (
    select r.id, r.warehouse_id, coalesce(r.offloaded_at, r.arrival_at, r.created_at)::date as d,
      coalesce(r.net_kg, r.expected_kg, 0) as kg
    from public.wms_receptions r
    where (r.field_shipment_id is not null or r.purchase_type = 'FIELD_BUYING') and r.status <> 'REJECTED'
  ), lots as (select l.id as lot_id from public.wms_lots l join rec on rec.id = l.reception_id)
  select coalesce((select sum(rec.kg) from rec join public.wms_warehouses w on w.id = rec.warehouse_id and w.is_factory
                    where rec.d between public.aflp_from(p) and public.aflp_to(p)), 0)
       + coalesce((select sum(coalesce(tl.received_qty, 0)) from public.wms_transfers t
                    join public.wms_transfer_lines tl on tl.transfer_id = t.id
                    join lots on lots.lot_id = tl.lot_id
                    join public.wms_warehouses dw on dw.id = t.dest_warehouse_id and dw.is_factory
                    where not coalesce(t.is_test, false) and t.received_at is not null
                      and t.received_at::date between public.aflp_from(p) and public.aflp_to(p)), 0)
$f$;

-- 7. Complétude des données (%) -------------------------------------------------------------
create or replace function public.aflp_completeness(p jsonb default '{}'::jsonb)
returns numeric language sql stable set search_path = public, pg_temp as $f$
  with x as (
    select (d.producteur_id is not null)::int + (d.village_id is not null)::int + (d.rt_id is not null)::int
           + (coalesce(d.remarks, '') not like '%Photo du reçu absente%')::int as ok, 4 as tot
    from public.aflp_v_daily_purchases d
    where not d.rejet and d.purchase_date between public.aflp_from(p) and public.aflp_to(p)
      and public.aflp_ok(p, d.zone_code, d.cluster_code, d.village_id, d.rt_id)
    union all
    select (v.gps_lat is not null and v.gps_lng is not null)::int + (v.assigned_rt is not null)::int
           + (v.last_visit_date is not null)::int, 3
    from public.aflp_v_villages v where public.aflp_ok_dim(p, v.zone_code, v.cluster_code, v.village_id, null)
    union all
    select (p1.village_id is not null)::int + (p1.rt_id is not null)::int + (nullif(p1.telephone, '') is not null)::int, 3
    from public.producteurs p1 left join public.aflp_v_village_dim vd on vd.village_id = p1.village_id
    where not coalesce(p1.deleted, false) and public.aflp_ok_dim(p, vd.zone_code, vd.cluster_code, p1.village_id, p1.rt_id)
  )
  select case when sum(tot) > 0 then round(100.0 * sum(ok) / sum(tot), 1) end from x
$f$;

-- 8. Onglet 1 · AFLP Overview ----------------------------------------------------------------
create or replace function public.aflp_rpt_overview(p jsonb default '{}'::jsonb)
returns table (ordre integer, kpi text, valeur numeric, valeur_texte text, unite text, note text)
language sql stable set search_path = public, pg_temp as $f$
with pur as (
  select d.* from public.aflp_v_daily_purchases d
  where not d.rejet and d.purchase_date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_camp_ok(p, d.campaign) and public.aflp_prod_ok(p, d.producteur_id)
    and public.aflp_ok(p, d.zone_code, d.cluster_code, d.village_id, d.rt_id)
), vil as (
  select * from public.aflp_v_village_dim v where public.aflp_ok_dim(p, v.zone_code, v.cluster_code, v.village_id, null)
), tg as (
  select t.target_mt from public.aflp_program_targets t
  where t.scope_type = 'PROGRAMME' and t.campaign = coalesce(nullif(p->>'campaign', ''), '2027') limit 1
), jl as (
  select * from public.aflp_v_jute_bags_ledger j
  where j.movement_date::date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_ok_dim(p, j.zone_code, j.cluster_code, j.village_id, j.rt_id)
), fs as (
  select distinct on (s.village_id) s.village_id, s.closing_stock_kg from public.aflp_v_field_stock s
  where s.date <= public.aflp_to(p) and public.aflp_ok_dim(p, s.zone_code, s.cluster_code, s.village_id, null)
  order by s.village_id, s.date desc
), ev as (
  select * from public.aflp_v_evacuations e
  where e.status_code not in ('DRAFT', 'CANCELLED')
    and e.evacuation_date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_ok_dim(p, e.zone_code, e.cluster_code, null, null)
    and (nullif(p->>'village', '') is null or e.village_ids @> array[p->>'village'])
    and (nullif(p->>'rt', '') is null or e.rt_ids @> array[p->>'rt'])
    and (nullif(p->>'producer', '') is null or e.producer_ids @> array[p->>'producer'])
), st as (
  select * from public.aflp_staff_directory() s where s.actif and public.aflp_ok_dim(p, s.zone_code, s.cluster_code, null, null)
), cash as (
  select * from public.aflp_v_cash_advances c
  where c.date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_ok_dim(p, c.zone_code, c.cluster_code, c.village_id, c.rt_id)
), last_upd as (
  select greatest(
    (select max(created_at) from public.achats), (select max(created_at) from public.avances),
    (select max(movement_at) from public.rcn_jute_movements), (select max(updated_at) from public.field_shipments),
    (select max(updated_at) from public.aflp_incidents), (select max(updated_at) from public.villages),
    (select max(updated_at) from public.producteurs)) as ts
)
select * from (values
  (1, 'Campaign', null::numeric, coalesce(nullif(p->>'campaign', ''), '2027'), null::text, 'Programme AFLP (ANAGROCI FieldLink Programme)'),
  (2, 'Target MT', (select target_mt from tg), null, 'MT', 'Objectif programme validé par le Branch Manager'),
  (3, 'Purchased MT', round((select coalesce(sum(quantity_kg), 0) from pur) / 1000, 3), null, 'MT', 'Achats bord champ non rejetés sur la période'),
  (4, 'Secured MT', (select sum(secured_mt) from vil), null, 'MT', 'Potentiel sécurisé déclaré au recensement des villages'),
  (5, 'Remaining MT', round((select target_mt from tg) - (select coalesce(sum(quantity_kg), 0) from pur) / 1000, 3), null, 'MT', 'Objectif moins achats'),
  (6, 'Number of zones', (select count(distinct zone_code) from vil)::numeric, null, null, null),
  (7, 'Number of clusters', (select count(distinct cluster_code) from vil)::numeric, null, null, null),
  (8, 'Number of villages', (select count(*) from vil)::numeric, null, null, 'Villages actifs du référentiel'),
  (9, 'Villages covered', (select count(distinct village_id) from pur)::numeric, null, null, 'Villages avec au moins un achat sur la période'),
  (10, 'Producers registered', (select count(*) from public.producteurs p1 left join public.aflp_v_village_dim vd on vd.village_id = p1.village_id
        where not coalesce(p1.deleted, false) and public.aflp_ok_dim(p, vd.zone_code, vd.cluster_code, p1.village_id, p1.rt_id))::numeric, null, null, null),
  (11, 'Active RT', (select count(*) from public.aflp_v_rt_dim r where r.rt_status = 'Confirmé'
        and public.aflp_ok_dim(p, r.zone_code, r.cluster_code, r.village_id, r.rt_id))::numeric, null, null,
        'RT confirmés · ' || (select count(distinct rt_id) from pur) || ' RT avec achat sur la période'),
  (12, 'Active Unit Heads', (select count(*) from st where st.role in ('Unit Head', 'Chef d''Unité'))::numeric, null, null, 'Profils actifs avec le rôle Unit Head'),
  (13, 'Active Zone Heads', (select count(*) from st where st.role in ('Zonal Head', 'Chef de Zone'))::numeric, null, null, 'Profils actifs avec le rôle Zonal Head'),
  (14, 'Total advances', (select coalesce(sum(amount_received), 0) from cash), null, 'FCFA', 'Avances RT non annulées sur la période'),
  (15, 'Total paid amount', (select coalesce(sum(gross_amount), 0) from pur), null, 'FCFA', 'Montants payés aux producteurs'),
  (16, 'Total bags issued', (select coalesce(sum(bags_issued_to_producers), 0) + coalesce(sum(case when location_scope = 'CLUSTER' then bags_transferred_out else 0 end), 0) from jl), null, 'sacs',
        'Sacs sortis des magasins cluster vers les RT et remis aux producteurs'),
  (17, 'Total bags returned', (select coalesce(sum(bags_returned_full + bags_returned_empty), 0) from jl), null, 'sacs', 'Retours pleins et vides'),
  (18, 'Field stock kg', (select coalesce(sum(closing_stock_kg), 0) from fs), null, 'kg', 'Stock bord champ calculé à la date de fin'),
  (19, 'Evacuated kg', (select coalesce(sum(qty_loaded_kg), 0) from ev), null, 'kg', 'Évacuations parties sur la période'),
  (20, 'Warehouse relay stock kg', (select coalesce(sum(closing_stock_kg), 0) from public.aflp_rpt_warehouse_relay(p)), null, 'kg', 'Flux AFLP uniquement'),
  (21, 'Final delivered to Yamoussoukro kg', public.aflp_delivered_factory_kg(p), null, 'kg', 'Réceptions AFLP à l''usine et transferts relais reçus'),
  (22, 'Incidents open', (select count(*) from public.aflp_v_incidents i where i.status_code <> 'CLOS' and i.date <= public.aflp_to(p)
        and public.aflp_ok_dim(p, i.zone_code, i.cluster_code, i.village_id, i.rt_id))::numeric, null, null, 'Déclarés et détectés automatiquement'),
  (23, 'Data completeness rate', public.aflp_completeness(p), null, '%', 'Achats, villages et producteurs : champs clés renseignés'),
  (24, 'Last update', null, to_char((select ts from last_upd) at time zone 'Africa/Abidjan', 'YYYY-MM-DD HH24:MI'), null, 'Dernière écriture dans les tables AFLP')
) as t(ordre, kpi, valeur, valeur_texte, unite, note)
order by 1
$f$;

-- 9. Contrôles obligatoires ---------------------------------------------------------------------
create or replace function public.aflp_rpt_controls(p jsonb default '{}'::jsonb)
returns table (ordre integer, code text, controle text, statut text, anomalies bigint, valeur numeric,
  unite text, detail text)
language sql stable set search_path = public, pg_temp as $f$
with pur as (
  select d.* from public.aflp_v_daily_purchases d
  where d.purchase_date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_camp_ok(p, d.campaign) and public.aflp_prod_ok(p, d.producteur_id)
    and public.aflp_ok(p, d.zone_code, d.cluster_code, d.village_id, d.rt_id)
), rtcash as (
  select c.rt_id, max(c.staff_rt) as rt, sum(c.amount_received) as rec, sum(c.amount_paid) as paid,
    sum(c.amount_received - c.amount_paid - c.amount_returned) as bal,
    max(c.date) filter (where c.transaction_type = 'Avance reçue') as last_adv,
    max(c.date) filter (where c.transaction_type = 'Réconciliation caisse' and c.approval_status ilike 'réconcili%') as last_recon,
    count(*) filter (where c.transaction_type = 'Réconciliation caisse' and abs(coalesce(c.difference, 0)) > 1) as recon_ecarts
  from public.aflp_v_cash_advances c
  where c.date <= public.aflp_to(p) and public.aflp_ok_dim(p, c.zone_code, c.cluster_code, c.village_id, c.rt_id)
  group by c.rt_id
), jl as (
  select j.* from public.aflp_v_jute_bags_ledger j
  where j.movement_date::date <= public.aflp_to(p) and public.aflp_ok_dim(p, j.zone_code, j.cluster_code, j.village_id, j.rt_id)
), jlast as (
  select distinct on (j.location_code) j.location_code, j.location_scope, j.closing_balance, j.movement_date, j.cluster_code
  from jl j order by j.location_code, j.movement_date desc, j.movement_id desc
), fs as (
  select distinct on (s.village_id) s.village_id, s.village, s.cluster, s.cluster_code, s.closing_stock_kg
  from public.aflp_v_field_stock s
  where s.date <= public.aflp_to(p) and public.aflp_ok_dim(p, s.zone_code, s.cluster_code, s.village_id, null)
  order by s.village_id, s.date desc
), fsp as (
  select s.village_id, sum(s.purchases_kg) as ach, sum(s.evacuated_kg) as evac, sum(s.returns_kg) as ret, sum(s.loss_adjustment_kg) as adj
  from public.aflp_v_field_stock s
  where s.date between public.aflp_from(p) and public.aflp_to(p) and public.aflp_ok_dim(p, s.zone_code, s.cluster_code, s.village_id, null)
  group by s.village_id
), ev as (
  select e.* from public.aflp_v_evacuations e
  where e.status_code not in ('DRAFT', 'CANCELLED') and e.evacuation_date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_ok_dim(p, e.zone_code, e.cluster_code, null, null)
    and (nullif(p->>'village', '') is null or e.village_ids @> array[p->>'village'])
    and (nullif(p->>'rt', '') is null or e.rt_ids @> array[p->>'rt'])
    and (nullif(p->>'producer', '') is null or e.producer_ids @> array[p->>'producer'])
), wr as (select * from public.aflp_rpt_warehouse_relay(p)),
vil as (select * from public.aflp_v_villages v where public.aflp_ok_dim(p, v.zone_code, v.cluster_code, v.village_id, null)),
inc as (
  select i.* from public.aflp_v_incidents i
  where i.status_code <> 'CLOS' and i.date <= public.aflp_to(p) and public.aflp_ok_dim(p, i.zone_code, i.cluster_code, i.village_id, i.rt_id)
), prods as (
  select p1.id, p1.village_id from public.producteurs p1
  left join public.aflp_v_village_dim vd on vd.village_id = p1.village_id
  where not coalesce(p1.deleted, false)
    and ((vd.village_id is not null and public.aflp_ok_dim(p, vd.zone_code, vd.cluster_code, p1.village_id, p1.rt_id))
      or (vd.village_id is null and nullif(p->>'zone', '') is null and nullif(p->>'cluster', '') is null and nullif(p->>'village', '') is null
          and coalesce(jsonb_array_length(case when jsonb_typeof(p->'clusters') = 'array' then p->'clusters' end), 0) = 0
          and (nullif(p->>'rt', '') is null or p1.rt_id = p->>'rt')))
), res as (
  select 1 as ordre, 'CASH_RT' as code, 'Solde cash RT (avances − paiements − retours)' as controle,
    (select count(*) from rtcash where bal < -1) + (select coalesce(sum(recon_ecarts), 0) from rtcash) as anomalies,
    (select coalesce(sum(bal), 0) from rtcash) as valeur, 'FCFA' as unite,
    (select count(*) from rtcash where bal < -1) || ' RT en solde négatif · '
      || (select coalesce(sum(recon_ecarts), 0) from rtcash) || ' réconciliation(s) en écart · solde total '
      || to_char((select coalesce(sum(bal), 0) from rtcash), 'FM999G999G999G990') || ' FCFA' as detail,
    (select count(*) from rtcash) as base
  union all
  select 2, 'SACS_SOLDE', 'Solde sacs jute (ouverture + entrées − sorties = clôture)',
    (select count(*) from jl where bags_opening_stock + bags_received + bags_returned_full + bags_returned_empty
        + bags_transferred_in - bags_issued_to_producers - damaged_unusable - bags_transferred_out <> closing_balance)
      + (select count(*) from jlast where closing_balance < 0),
    (select coalesce(sum(closing_balance), 0) from jlast), 'sacs',
    (select count(*) from jlast) || ' emplacement(s) AFLP · '
      || (select count(*) from jlast where closing_balance < 0) || ' solde(s) négatif(s)',
    (select count(*) from jl)
  union all
  select 3, 'STOCK_VILLAGE', 'Stock village (achats + retours − évacuations − pertes)',
    (select count(*) from fs where closing_stock_kg < -0.5),
    (select coalesce(sum(closing_stock_kg), 0) from fs), 'kg',
    (select count(*) from fs where closing_stock_kg > 0.5) || ' village(s) avec stock · '
      || (select count(*) from fs where closing_stock_kg < -0.5) || ' village(s) en écart négatif',
    (select count(*) from fs)
  union all
  select 4, 'STOCK_CLUSTER', 'Stock cluster (somme des stocks villages)',
    (select count(*) from (select cluster_code from fs group by cluster_code having sum(closing_stock_kg) < -0.5) x),
    (select coalesce(sum(closing_stock_kg), 0) from fs), 'kg',
    coalesce((select string_agg(coalesce(cluster, 'Sans cluster') || ' ' || to_char(kg, 'FM999G999G990') || ' kg', ' · ' order by cluster)
       from (select cluster, sum(closing_stock_kg) as kg from fs group by cluster) x), 'Aucun stock bord champ'),
    (select count(*) from fs)
  union all
  select 5, 'STOCK_RELAIS', 'Stock warehouse relay (reçu − transféré à Yamoussoukro)',
    (select count(*) from wr where closing_stock_kg < -0.5),
    (select coalesce(sum(closing_stock_kg), 0) from wr), 'kg',
    (select count(*) from wr where received_from_field_kg > 0 or opening_stock_kg <> 0) || ' relais avec flux AFLP · '
      || (select count(*) from wr where closing_stock_kg < -0.5) || ' solde(s) négatif(s)',
    (select count(*) from wr where received_from_field_kg > 0 or opening_stock_kg <> 0)
  union all
  select 6, 'ECART_ACHATS_EVACUATIONS', 'Écart achats vs évacuations (par village)',
    (select count(*) from fsp where evac > ach + ret + 0.5),
    (select coalesce(sum(ach), 0) - coalesce(sum(evac), 0) from fsp), 'kg',
    'Achats ' || to_char((select coalesce(sum(ach), 0) from fsp), 'FM999G999G990') || ' kg · évacués '
      || to_char((select coalesce(sum(evac), 0) from fsp), 'FM999G999G990') || ' kg · '
      || (select count(*) from fsp where evac > ach + ret + 0.5) || ' village(s) évacués au-delà des achats',
    (select count(*) from fsp)
  union all
  select 7, 'ECART_CHARGE_RECU', 'Écart quantité chargée vs reçue (tolérance 0,5 %, min. 1 kg)',
    (select count(*) from ev where difference_kg is not null and qty_loaded_kg > 0
       and abs(difference_kg) > greatest(0.005 * qty_loaded_kg, 1)),
    (select coalesce(sum(difference_kg), 0) from ev where difference_kg is not null), 'kg',
    (select count(*) from ev where difference_kg is not null) || ' évacuation(s) reçue(s) · '
      || (select count(*) from ev where status_code = 'DISPATCHED') || ' en route',
    (select count(*) from ev)
  union all
  select 8, 'PRODUCTEURS_SANS_VILLAGE', 'Producteurs sans village',
    (select count(*) from prods pr where pr.village_id is null
       or not exists (select 1 from public.aflp_v_village_dim vd where vd.village_id = pr.village_id)),
    null, 'producteurs', 'Village absent ou inconnu du référentiel', (select count(*) from prods)
  union all
  select 9, 'ACHATS_SANS_PRODUCTEUR', 'Achats sans producteur enregistré',
    (select count(*) from pur where not rejet and producteur_id is null),
    (select coalesce(sum(quantity_kg), 0) from pur where not rejet and producteur_id is null), 'kg',
    'Achats non rattachés à une fiche producteur', (select count(*) from pur where not rejet)
  union all
  select 10, 'PAIEMENTS_SANS_ACHAT', 'Paiements sans achat valide',
    (select count(*) from pur where (rejet and coalesce(gross_amount, 0) > 0)
       or (not rejet and gross_amount is not null and price_kg is not null and abs(gross_amount - quantity_kg * price_kg) > 1)),
    (select coalesce(sum(gross_amount), 0) from pur where rejet and coalesce(gross_amount, 0) > 0), 'FCFA',
    'Un paiement producteur est toujours porté par un achat : contrôle des montants sur achats rejetés ou incohérents (poids × prix)',
    (select count(*) from pur)
  union all
  select 11, 'SACS_SANS_RETOUR', 'Sacs sortis sans retour (chez producteurs, sans mouvement depuis 30 jours)',
    (select count(*) from jlast where location_scope = 'PRODUCTEUR' and closing_balance > 0
       and movement_date < least(public.aflp_to(p), current_date) - 30),
    (select coalesce(sum(closing_balance), 0) from jlast where location_scope = 'PRODUCTEUR'), 'sacs',
    (select count(*) from jlast where location_scope = 'PRODUCTEUR' and closing_balance > 0) || ' producteur(s) détiennent des sacs AFLP',
    (select count(*) from jlast where location_scope = 'PRODUCTEUR')
  union all
  select 12, 'AVANCE_NON_JUSTIFIEE', 'RT avec avance non justifiée (solde > 0 sans réconciliation après la dernière avance, 7 jours)',
    (select count(*) from rtcash where bal > 1 and last_adv < least(public.aflp_to(p), current_date) - 7
       and (last_recon is null or last_recon < last_adv)),
    (select coalesce(sum(bal), 0) from rtcash where bal > 1 and (last_recon is null or last_recon < last_adv)), 'FCFA',
    (select count(*) from rtcash where bal > 1) || ' RT avec solde d''avance ouvert',
    (select count(*) from rtcash)
  union all
  select 13, 'VILLAGE_SANS_VISITE', 'Village sans visite (aucune visite ou dernière visite de plus de 90 jours)',
    (select count(*) from vil where last_visit_date is null or last_visit_date < least(public.aflp_to(p), current_date) - 90),
    null, 'villages',
    (select count(*) from vil where last_visit_date is null) || ' sans visite · '
      || (select count(*) from vil where last_visit_date < least(public.aflp_to(p), current_date) - 90) || ' visite ancienne',
    (select count(*) from vil)
  union all
  select 14, 'VILLAGE_SANS_ACHAT', 'Village sans achat sur la période',
    (select count(*) from vil where not exists (select 1 from pur where not pur.rejet and pur.village_id = vil.village_id)),
    null, 'villages', 'Villages du référentiel sans aucun achat enregistré', (select count(*) from vil)
  union all
  select 15, 'INCIDENT_NON_CLOS', 'Incident non clôturé',
    (select count(*) from inc),
    (select count(*) from inc where date < current_date - 7), 'incidents',
    (select count(*) from inc where source_type = 'DECLARE') || ' déclaré(s) · '
      || (select count(*) from inc where source_type = 'AUTO') || ' détecté(s) · '
      || (select count(*) from inc where date < current_date - 7) || ' ouvert(s) depuis plus de 7 jours',
    (select count(*) from inc)
  union all
  select 16, 'TRACABILITE_CHAINE', 'Traçabilité producteur → village → RT → achat → évacuation',
    (select count(*) from pur where not rejet and (producteur_id is null or village_id is null or rt_id is null)),
    (select count(*) from pur join public.field_traceability_completeness_v t on t.achat_id = pur.achat_uuid
       where not pur.rejet and t.shipment_count > 0), 'achats évacués',
    (select count(*) from pur where not rejet and producteur_id is not null and village_id is not null and rt_id is not null)
      || ' achat(s) entièrement rattaché(s) sur ' || (select count(*) from pur where not rejet)
      || ' · valeur = achats déjà rattachés à une évacuation',
    (select count(*) from pur where not rejet)
)
select res.ordre, res.code, res.controle,
  case when res.anomalies > 0 then 'ALERTE' when coalesce(res.base, 0) = 0 then 'SANS DONNÉES' else 'OK' end,
  res.anomalies::bigint, res.valeur::numeric, res.unite, res.detail
from res order by res.ordre
$f$;

-- 10. Onglet 15 · AFLP Performance Dashboard ----------------------------------------------------
create or replace function public.aflp_rpt_performance(p jsonb default '{}'::jsonb)
returns table (section text, rang integer, indicateur text, valeur numeric, unite text, detail text)
language sql stable set search_path = public, pg_temp as $f$
with pur as (
  select d.* from public.aflp_v_daily_purchases d
  where not d.rejet and d.purchase_date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_camp_ok(p, d.campaign) and public.aflp_prod_ok(p, d.producteur_id)
    and public.aflp_ok(p, d.zone_code, d.cluster_code, d.village_id, d.rt_id)
), tg as (
  select t.target_mt from public.aflp_program_targets t
  where t.scope_type = 'PROGRAMME' and t.campaign = coalesce(nullif(p->>'campaign', ''), '2027') limit 1
), vil as (select * from public.aflp_v_villages v where public.aflp_ok_dim(p, v.zone_code, v.cluster_code, v.village_id, null)),
ctl as (select * from public.aflp_rpt_controls(p)),
ft as (select * from public.aflp_rpt_field_teams(p) f where f.role like 'RT%'),
ev as (
  select e.* from public.aflp_v_evacuations e
  where e.status_code not in ('DRAFT', 'CANCELLED') and e.evacuation_date between public.aflp_from(p) and public.aflp_to(p)
    and public.aflp_ok_dim(p, e.zone_code, e.cluster_code, null, null)
    and (nullif(p->>'village', '') is null or e.village_ids @> array[p->>'village'])
    and (nullif(p->>'rt', '') is null or e.rt_ids @> array[p->>'rt'])
    and (nullif(p->>'producer', '') is null or e.producer_ids @> array[p->>'producer'])
), kpi as (
  select * from (values
    (1, 'Target MT', (select target_mt from tg), 'MT', 'Objectif programme'),
    (2, 'Purchased MT', round((select coalesce(sum(quantity_kg), 0) from pur) / 1000, 3), 'MT',
       case when (select target_mt from tg) > 0 then round(100 * (select coalesce(sum(quantity_kg), 0) from pur) / 1000 / (select target_mt from tg), 1) || ' % de l''objectif' end),
    (3, 'Evacuated MT', round((select coalesce(sum(qty_loaded_kg), 0) from ev) / 1000, 3), 'MT', 'Évacuations parties sur la période'),
    (4, 'Paid amount', (select coalesce(sum(gross_amount), 0) from pur), 'FCFA', null),
    (5, 'Average price', (select round(sum(gross_amount) / nullif(sum(quantity_kg), 0), 1) from pur), 'FCFA/kg', 'Montant payé / kg acheté'),
    (6, 'Average kg per producer', (select round(sum(quantity_kg) / nullif(count(distinct producteur_id), 0), 1) from pur where producteur_id is not null), 'kg', null),
    (7, 'Active villages', (select count(distinct village_id) from pur)::numeric, 'villages', 'Au moins un achat sur la période'),
    (8, 'Active producers', (select count(distinct producteur_id) from pur)::numeric, 'producteurs', 'Au moins une vente sur la période'),
    (9, 'Active RT', (select count(distinct rt_id) from pur)::numeric, 'RT', 'Au moins un achat sur la période'),
    (10, 'Villages with zero purchase', (select anomalies from ctl where code = 'VILLAGE_SANS_ACHAT')::numeric, 'villages', null),
    (11, 'RT with cash balance open', (select count(*) from ft where ft.cash_balance > 1)::numeric, 'RT', 'Solde d''avance à justifier'),
    (12, 'Sacherie variance', (select coalesce(sum(qty), 0) from public.rcn_jute_loss_requests lr
        join public.rcn_jute_locations l on l.code = lr.location_code and (l.scope_type in ('CLUSTER', 'RT', 'PRODUCTEUR') or l.code like 'AFLP-%')
        where lr.statut in ('SOUMIS', 'APPROUVE') and lr.submitted_at::date <= public.aflp_to(p))::numeric, 'sacs',
        'Pertes de sacs déclarées (soumises ou approuvées) · ' || (select anomalies from ctl where code = 'SACS_SOLDE') || ' anomalie(s) de solde'),
    (13, 'Stock variance', (select valeur from ctl where code = 'STOCK_VILLAGE'), 'kg',
        (select anomalies from ctl where code = 'STOCK_VILLAGE') || ' village(s) en écart négatif · pas d''inventaire physique terrain'),
    (14, 'Evacuation variance', (select valeur from ctl where code = 'ECART_CHARGE_RECU'), 'kg',
        (select anomalies from ctl where code = 'ECART_CHARGE_RECU') || ' évacuation(s) hors tolérance'),
    (15, 'Quality pending', (select count(*) from public.aflp_v_quality_traceability q where q.pending
        and q.date between public.aflp_from(p) and public.aflp_to(p)
        and public.aflp_ok(p, q.zone_code, q.cluster_code, q.village_id, q.rt_id))::numeric, 'achats', 'Statut qualité à évaluer ou en attente'),
    (16, 'Incidents open', (select anomalies from ctl where code = 'INCIDENT_NON_CLOS')::numeric, 'incidents', null),
    (17, 'Data completeness', public.aflp_completeness(p), '%', 'Champs clés renseignés')
  ) as k(rang, indicateur, valeur, unite, detail)
)
select 'KPI', k.rang, k.indicateur, k.valeur, k.unite, k.detail from kpi k
union all
select 'TOP 10 VILLAGES', (row_number() over (order by x.kg desc, x.village))::int, x.village, round(x.kg, 1), 'kg', x.cluster
from (select coalesce(d.village, 'Village inconnu') as village, max(d.cluster) as cluster, sum(d.quantity_kg) as kg
      from pur d group by coalesce(d.village_id, d.village), coalesce(d.village, 'Village inconnu') order by kg desc limit 10) x
union all
select 'TOP 10 RT', (row_number() over (order by x.kg desc, x.rt))::int, x.rt, round(x.kg, 1), 'kg', x.cluster
from (select coalesce(d.rt_name, 'RT inconnu') as rt, max(d.cluster) as cluster, sum(d.quantity_kg) as kg
      from pur d group by coalesce(d.rt_id, d.rt_name), coalesce(d.rt_name, 'RT inconnu') order by kg desc limit 10) x
union all
select 'VILLAGES SANS ACHAT', (row_number() over (order by v.cluster, v.village_name))::int, v.village_name, null, null, v.cluster
from vil v where not exists (select 1 from pur where pur.village_id = v.village_id)
union all
select 'RT AVEC SOLDE CASH OUVERT', (row_number() over (order by f.cash_balance desc))::int, f.name, f.cash_balance, 'FCFA', f.cluster
from ft f where f.cash_balance > 1
$f$;

-- 11. Vues demandées (sans filtre : toute la campagne) -----------------------------------------
create or replace view public.aflp_v_overview with (security_invoker = true) as
select * from public.aflp_rpt_overview('{}'::jsonb);
create or replace view public.aflp_v_zones_clusters with (security_invoker = true) as
select * from public.aflp_rpt_zones_clusters('{}'::jsonb);
create or replace view public.aflp_v_producers with (security_invoker = true) as
select * from public.aflp_rpt_producers('{}'::jsonb);
create or replace view public.aflp_v_field_teams with (security_invoker = true) as
select * from public.aflp_rpt_field_teams('{}'::jsonb);
create or replace view public.aflp_v_warehouse_relay with (security_invoker = true) as
select * from public.aflp_rpt_warehouse_relay('{}'::jsonb);
create or replace view public.aflp_v_performance_dashboard with (security_invoker = true) as
select * from public.aflp_rpt_performance('{}'::jsonb);
create or replace view public.aflp_v_controls with (security_invoker = true) as
select * from public.aflp_rpt_controls('{}'::jsonb);

-- 12. Droits ---------------------------------------------------------------------------------------
revoke all on function public.aflp_from(jsonb), public.aflp_to(jsonb), public.aflp_camp_ok(jsonb, text),
  public.aflp_ok(jsonb, text, text, text, text), public.aflp_ok_dim(jsonb, text, text, text, text),
  public.aflp_prod_ok(jsonb, text), public.aflp_rpt_zones_clusters(jsonb), public.aflp_rpt_producers(jsonb),
  public.aflp_rpt_field_teams(jsonb), public.aflp_rpt_warehouse_relay(jsonb), public.aflp_delivered_factory_kg(jsonb),
  public.aflp_completeness(jsonb), public.aflp_rpt_overview(jsonb), public.aflp_rpt_controls(jsonb),
  public.aflp_rpt_performance(jsonb) from public, anon;
grant execute on function public.aflp_from(jsonb), public.aflp_to(jsonb), public.aflp_camp_ok(jsonb, text),
  public.aflp_ok(jsonb, text, text, text, text), public.aflp_ok_dim(jsonb, text, text, text, text),
  public.aflp_prod_ok(jsonb, text), public.aflp_rpt_zones_clusters(jsonb), public.aflp_rpt_producers(jsonb),
  public.aflp_rpt_field_teams(jsonb), public.aflp_rpt_warehouse_relay(jsonb), public.aflp_delivered_factory_kg(jsonb),
  public.aflp_completeness(jsonb), public.aflp_rpt_overview(jsonb), public.aflp_rpt_controls(jsonb),
  public.aflp_rpt_performance(jsonb) to authenticated;
revoke all on public.aflp_v_overview, public.aflp_v_zones_clusters, public.aflp_v_producers, public.aflp_v_field_teams,
  public.aflp_v_warehouse_relay, public.aflp_v_performance_dashboard, public.aflp_v_controls from anon;
grant select on public.aflp_v_overview, public.aflp_v_zones_clusters, public.aflp_v_producers, public.aflp_v_field_teams,
  public.aflp_v_warehouse_relay, public.aflp_v_performance_dashboard, public.aflp_v_controls to authenticated;
