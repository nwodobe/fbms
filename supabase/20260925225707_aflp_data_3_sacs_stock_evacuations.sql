-- FBMS · AFLP DATA (3/5) : sacs jute, stock terrain, évacuations, qualité,
-- incidents et journal d'audit. Vues en lecture seule (security_invoker).

create or replace function public.aflp_jsonb(p text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $f$
begin
  if p is null or btrim(p) !~ '^\{' then return null; end if;
  return p::jsonb;
exception when others then
  return null;
end $f$;

create or replace function public.aflp_incident_type_label(p text)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select case upper(coalesce(p, ''))
    when 'ACCIDENT_MOTO' then 'Accident moto'
    when 'SECURITE_TERRAIN' then 'Sécurité terrain'
    when 'CONFLIT_PRODUCTEUR' then 'Conflit producteur'
    when 'RETARD_PAIEMENT' then 'Retard paiement'
    when 'MANQUE_SACS' then 'Manque de sacs'
    when 'PERTE_STOCK' then 'Perte de stock'
    when 'SUSPICION_FRAUDE' then 'Suspicion fraude'
    when 'QUALITE_LITIGIEUSE' then 'Qualité litigieuse'
    when 'PROBLEME_TRANSPORT' then 'Problème transport'
    when 'RISQUE_TRAVAIL_ENFANTS' then 'Risque travail des enfants'
    when 'GPS_PREUVE_MANQUANTE' then 'Problème GPS ou preuve manquante'
    when 'AUTRE' then 'Autre'
    else p end
$f$;

-- 1. Onglet 9 · AFLP Jute Bags Ledger --------------------------------------
-- Stock d'un emplacement = sacs présents hors état REFORME.
-- Clôture = Ouverture + Reçus + Retours pleins + Retours vides + Transferts entrants
--           − Remis aux producteurs − Réformés/perdus − Transferts sortants.
-- Colonnes « utilisés pour achats », « abîmés réparables », « reconditionnés » :
-- changements d'état, sans effet sur le solde.
create or replace view public.aflp_v_jute_bags_ledger with (security_invoker = true) as
with loc as (
  select l.code, l.scope_type, l.nom, l.rt_id, l.producteur_id, l.type as loc_type,
    case l.scope_type when 'PRODUCTEUR' then 1 when 'RT' then 2 when 'CLUSTER' then 3 else 4 end as niveau,
    coalesce(public.aflp_cluster_code(l.cluster), rd.cluster_code, pv.cluster_code) as cluster_code,
    coalesce(rd.village_id, p.village_id) as village_id,
    coalesce(rd.rt_name, prt.rt_name) as rt_name,
    nullif(btrim(concat_ws(' ', p.nom, p.prenoms)), '') as producer_name
  from public.rcn_jute_locations l
  left join public.aflp_v_rt_dim rd on rd.rt_id = l.rt_id
  left join public.producteurs p on p.id = l.producteur_id
  left join public.aflp_v_village_dim pv on pv.village_id = p.village_id
  left join public.aflp_v_rt_dim prt on prt.rt_id = p.rt_id
  where l.scope_type in ('CLUSTER', 'RT', 'PRODUCTEUR') or l.code like 'AFLP-%'
), lines as (
  select m.id, m.movement_at, m.movement_type, m.qty, m.from_state, m.to_state, m.producteur_id, m.note, m.reference,
    m.campaign, 'STATE'::text as side, m.from_location as loc_code, null::text as other_code
  from public.rcn_jute_movements m
  where m.from_location = m.to_location and m.from_location in (select code from loc)
  union all
  select m.id, m.movement_at, m.movement_type, m.qty, m.from_state, m.to_state, m.producteur_id, m.note, m.reference,
    m.campaign, 'OUT', m.from_location, m.to_location
  from public.rcn_jute_movements m
  where m.from_location is distinct from m.to_location and m.from_location in (select code from loc)
  union all
  select m.id, m.movement_at, m.movement_type, m.qty, m.from_state, m.to_state, m.producteur_id, m.note, m.reference,
    m.campaign, 'IN', m.to_location, m.from_location
  from public.rcn_jute_movements m
  where m.from_location is distinct from m.to_location and m.to_location in (select code from loc)
), cat as (
  select x.*, me.scope_type as own_scope, me.niveau as own_niveau, me.cluster_code, me.village_id, me.rt_name,
    me.producer_name as loc_producer, me.nom as loc_nom,
    ot.nom as other_nom, ot.scope_type as other_scope, coalesce(ot.niveau, 9) as other_niveau,
    coalesce(ot.loc_type, ol.type) as other_type,
    (x.side = 'IN' and x.movement_type in ('SOLDE_INITIAL', 'ACHAT', 'DOTATION', 'RECU_LIVRAISON', 'AJUSTEMENT_INVENTAIRE')) as is_receipt,
    (x.side = 'IN' and (x.movement_type = 'RETOUR'
       or (x.movement_type = 'TRANSFERT' and ot.niveau is not null and ot.niveau < me.niveau))) as is_return,
    (x.side = 'OUT' and ot.scope_type = 'PRODUCTEUR' and x.movement_type in ('TRANSFERT', 'DOTATION')) as is_issue,
    ((x.side = 'OUT' and (x.movement_type in ('REFORME', 'PERTE_APPROUVEE', 'AJUSTEMENT_INVENTAIRE')
        or coalesce(ot.loc_type, ol.type) = 'REBUT'))
     or (x.side = 'STATE' and x.to_state = 'REFORME' and x.from_state is distinct from 'REFORME')) as is_discard,
    ((x.side = 'OUT' and x.from_state = 'REFORME') or (x.side = 'IN' and x.to_state = 'REFORME')) as is_neutral
  from lines x
  join loc me on me.code = x.loc_code
  left join loc ot on ot.code = x.other_code
  left join public.rcn_jute_locations ol on ol.code = x.other_code
), val as (
  select c.*,
    case when not c.is_neutral and c.is_receipt then c.qty
         when not c.is_neutral and c.side = 'STATE' and c.from_state = 'REFORME' and c.to_state <> 'REFORME' then c.qty
         else 0 end as received,
    case when not c.is_neutral and c.is_return and not c.is_receipt and c.to_state = 'PLEIN' then c.qty else 0 end as returned_full,
    case when not c.is_neutral and c.is_return and not c.is_receipt and c.to_state is distinct from 'PLEIN' then c.qty else 0 end as returned_empty,
    case when not c.is_neutral and c.side = 'IN' and not c.is_receipt and not c.is_return then c.qty else 0 end as transferred_in,
    case when not c.is_neutral and c.is_issue then c.qty else 0 end as issued,
    case when not c.is_neutral and c.is_discard then c.qty else 0 end as discarded,
    case when not c.is_neutral and c.side = 'OUT' and not c.is_issue and not c.is_discard then c.qty else 0 end as transferred_out,
    case when c.side = 'STATE' and c.to_state = 'PLEIN' and c.from_state is distinct from 'PLEIN' then c.qty else 0 end as used_for_purchases,
    case when c.side = 'STATE' and c.to_state in ('DECHIRE', 'A_REPARER', 'HUMIDE') then c.qty else 0 end as damaged_repairable,
    case when (c.side = 'STATE' and c.to_state = 'REPARE')
           or (c.side = 'IN' and c.movement_type in ('REPARATION_RETOUR', 'REBAGING')) then c.qty else 0 end as reconditioned
  from cat c
), run as (
  select v.*,
    (v.received + v.returned_full + v.returned_empty + v.transferred_in - v.issued - v.discarded - v.transferred_out) as delta,
    sum(v.received + v.returned_full + v.returned_empty + v.transferred_in - v.issued - v.discarded - v.transferred_out)
      over (partition by v.loc_code order by v.movement_at, v.id, v.side rows between unbounded preceding and current row) as closing
  from val v
)
select r.id || case r.side when 'OUT' then '-S' when 'IN' then '-E' else '-C' end as movement_id,
  r.movement_at as movement_date,
  z.label as zone, c.label as cluster, vd.village_name as village,
  case r.own_scope when 'CLUSTER' then 'Magasin cluster ' || coalesce(c.label, r.loc_nom)
    when 'RT' then coalesce(r.rt_name, r.loc_nom)
    when 'PRODUCTEUR' then coalesce(r.rt_name, 'RT à compléter') else r.loc_nom end as rt_staff,
  coalesce(r.loc_producer, nullif(btrim(concat_ws(' ', mp.nom, mp.prenoms)), '')) as supplier_producer,
  case r.movement_type when 'SOLDE_INITIAL' then 'Solde initial' when 'ACHAT' then 'Achat' when 'DOTATION' then 'Dotation'
    when 'RETOUR' then 'Retour' when 'TRANSFERT' then 'Transfert' when 'CLASSEMENT' then 'Classement'
    when 'REPARATION_SORTIE' then 'Sortie réparation' when 'REPARATION_RETOUR' then 'Retour réparation'
    when 'REBAGING' then 'Rebagging' when 'REFORME' then 'Réforme' when 'PERTE_APPROUVEE' then 'Perte approuvée'
    when 'AJUSTEMENT_INVENTAIRE' then 'Ajustement inventaire' when 'RECU_LIVRAISON' then 'Réception livraison'
    else r.movement_type end
    || case r.side when 'OUT' then ' (sortie)' when 'IN' then ' (entrée)' else '' end as movement_type,
  r.closing - r.delta as bags_opening_stock,
  r.received as bags_received, r.issued as bags_issued_to_producers, r.used_for_purchases as bags_used_for_purchases,
  r.returned_full as bags_returned_full, r.returned_empty as bags_returned_empty,
  r.damaged_repairable, r.discarded as damaged_unusable, r.reconditioned as reconditioned_bags,
  r.transferred_out as bags_transferred_out, r.transferred_in as bags_transferred_in,
  r.closing as closing_balance,
  nullif(concat_ws(' · ',
    case r.side when 'OUT' then 'Vers ' || coalesce(r.other_nom, r.other_code) when 'IN' then 'Depuis ' || coalesce(r.other_nom, r.other_code, 'extérieur') end,
    case when r.side = 'STATE' then coalesce(r.from_state, '?') || ' → ' || coalesce(r.to_state, '?') end,
    nullif(btrim(r.note), ''), nullif(btrim(r.reference), '')), '') as remarks,
  r.loc_code as location_code, r.own_scope as location_scope, r.side,
  c.zone_code, r.cluster_code, r.village_id, loc.rt_id, coalesce(loc.producteur_id, r.producteur_id) as producteur_id,
  public.aflp_campaign(r.campaign) as campaign
from run r
join loc on loc.code = r.loc_code
left join public.aflp_clusters c on c.code = r.cluster_code
left join public.aflp_zones z on z.code = c.zone_code
left join public.aflp_v_village_dim vd on vd.village_id = r.village_id
left join public.producteurs mp on mp.id = r.producteur_id;

-- 2. Onglet 10 · Field Stock / Village Stock ---------------------------------
-- Clôture = Ouverture + Achats + Retours − Évacuations − Ajustements/pertes.
create or replace view public.aflp_v_field_stock with (security_invoker = true) as
with lot_tot as (
  select c.lot_id, sum(c.qty_kg) as lot_kg, sum(coalesce(c.bag_count, 0)) as lot_bags
  from public.field_lot_contributors c where c.status = 'ACTIVE' group by c.lot_id
), lot_vil as (
  select c.lot_id, a.village_id, sum(c.qty_kg) as kg, sum(coalesce(c.bag_count, 0)) as bags
  from public.field_lot_contributors c join public.achats a on a.id = c.achat_id
  where c.status = 'ACTIVE' group by c.lot_id, a.village_id
), mv as (
  select m.id, m.movement_type, m.from_type, m.to_type, m.status, m.qty_sent_kg, m.qty_received_kg,
    m.departed_at, m.received_at,
    coalesce(lv.village_id, case when m.from_type = 'VILLAGE' then m.from_id when m.to_type = 'VILLAGE' then m.to_id end) as village_id,
    case when lt.lot_kg > 0 and lv.kg is not null then lv.kg / lt.lot_kg else 1 end as share,
    case when lt.lot_kg > 0 then coalesce(lv.bags, lt.lot_bags)::numeric / lt.lot_kg end as bags_per_kg
  from public.field_stock_movements m
  left join lot_tot lt on lt.lot_id = m.lot_id
  left join lot_vil lv on lv.lot_id = m.lot_id
  where (m.from_type = 'VILLAGE' or m.to_type = 'VILLAGE') and m.status in ('DISPATCHED', 'RECEIVED')
), ev as (
  select a.village_id, a.date as d, a.poids_net as purchases, 0::numeric as returns, 0::numeric as evac, 0::numeric as adj,
    coalesce(a.nb_sacs, 0)::numeric as bags_in, 0::numeric as bags_out,
    coalesce(rd.rt_name, a.rt_nom) as rt_name,
    case when a.stock_statut ilike '%non libéré%' then 1 else 0 end as non_libere
  from public.achats a
  left join public.aflp_v_rt_alias ra on ra.any_rt_id = a.rt_id
  left join public.aflp_v_rt_dim rd on rd.rt_id = coalesce(ra.rt_id, a.rt_id)
  where not coalesce(a.rejet, false) and a.village_id is not null
  union all
  select mv.village_id, mv.departed_at::date, 0, 0, mv.qty_sent_kg * mv.share, 0, 0,
    round(coalesce(mv.qty_sent_kg * mv.bags_per_kg, 0)), null, 0
  from mv where mv.from_type = 'VILLAGE' and mv.movement_type <> 'ADJUSTMENT'
  union all
  select mv.village_id, mv.departed_at::date, 0, 0, 0, mv.qty_sent_kg * mv.share, 0, 0, null, 0
  from mv where mv.from_type = 'VILLAGE' and mv.movement_type = 'ADJUSTMENT'
  union all
  select mv.village_id, mv.received_at::date, 0, coalesce(mv.qty_received_kg, 0) * mv.share, 0, 0, 0, 0, null, 0
  from mv where mv.to_type = 'VILLAGE' and mv.movement_type = 'RETURN' and mv.status = 'RECEIVED'
), day as (
  select ev.village_id, ev.d, sum(ev.purchases) as purchases, sum(ev.returns) as returns, sum(ev.evac) as evac,
    sum(ev.adj) as adj, sum(ev.bags_in) as bags_in, sum(ev.bags_out) as bags_out,
    string_agg(distinct ev.rt_name, ', ') as rts, sum(ev.non_libere) as non_liberes
  from ev where ev.d is not null group by ev.village_id, ev.d
), run as (
  select day.*,
    sum(day.purchases + day.returns - day.evac - day.adj) over w as closing,
    sum(day.bags_in - day.bags_out) over w as bags_closing
  from day
  window w as (partition by day.village_id order by day.d rows between unbounded preceding and current row)
)
select 'STK-' || run.village_id || '-' || to_char(run.d, 'YYYYMMDD') as stock_id, run.d as date,
  vd.zone, vd.cluster, coalesce(vd.village_name, run.village_id) as village,
  coalesce(run.rts, (select string_agg(r.rt_name, ', ') from public.aflp_v_rt_dim r where r.village_id = run.village_id)) as rt,
  'Stock bord champ · ' || coalesce(vd.village_name, run.village_id) as stock_point,
  round(run.closing - (run.purchases + run.returns - run.evac - run.adj), 3) as opening_stock_kg,
  round(run.purchases, 3) as purchases_kg, round(run.returns, 3) as returns_kg,
  round(run.evac, 3) as evacuated_kg, round(run.adj, 3) as loss_adjustment_kg,
  round(run.closing, 3) as closing_stock_kg,
  greatest(round(run.bags_closing), 0) as bags_in_stock,
  case when run.closing < -0.5 then 'Écart négatif' when run.closing > 0.5 then 'En stock' else 'Évacué / vide' end as stock_status,
  null::date as last_physical_check,
  null::numeric as variance_kg,
  nullif(concat_ws(' · ',
    case when run.non_liberes > 0 then run.non_liberes || ' achat(s) stock non libéré' end,
    case when run.closing < -0.5 then 'Évacué plus que acheté : vérifier les lots' end), '') as remarks,
  vd.zone_code, vd.cluster_code, run.village_id, '2027'::text as campaign
from run left join public.aflp_v_village_dim vd on vd.village_id = run.village_id;

-- 3. Onglet 11 · Evacuations & Transport ------------------------------------
create or replace view public.aflp_v_evacuations with (security_invoker = true) as
with lot_tot as (
  select c.lot_id, sum(c.qty_kg) as lot_kg, sum(coalesce(c.bag_count, 0)) as lot_bags
  from public.field_lot_contributors c where c.status = 'ACTIVE' group by c.lot_id
), sl as (
  select x.shipment_id, sum(x.loaded_qty_kg) as loaded_kg, sum(x.received_qty_kg) as received_kg,
    round(sum(case when lt.lot_kg > 0 then x.loaded_qty_kg * lt.lot_bags / lt.lot_kg end)) as bags_est
  from public.field_shipment_lots x left join lot_tot lt on lt.lot_id = x.lot_id group by x.shipment_id
), vil as (
  select x.shipment_id,
    array_agg(distinct a.village_id) filter (where a.village_id is not null) as village_ids,
    array_agg(distinct coalesce(ra.rt_id, a.rt_id)) filter (where a.rt_id is not null) as rt_ids,
    array_agg(distinct a.producteur_id) filter (where a.producteur_id is not null) as producer_ids,
    string_agg(distinct vd.village_name, ', ') as villages,
    min(vd.cluster_code) as cluster_code, count(distinct vd.cluster_code) as n_clusters
  from public.field_shipment_lots x
  join public.field_lot_contributors c on c.lot_id = x.lot_id and c.status = 'ACTIVE'
  join public.achats a on a.id = c.achat_id
  left join public.aflp_v_village_dim vd on vd.village_id = a.village_id
  left join public.aflp_v_rt_alias ra on ra.any_rt_id = a.rt_id
  group by x.shipment_id
), base as (
  select s.*, sl.loaded_kg, sl.received_kg as lots_received_kg, sl.bags_est, vil.village_ids, vil.rt_ids, vil.producer_ids,
    vil.villages, vil.n_clusters,
    coalesce(vo.cluster_code, vil.cluster_code) as cl_code,
    w.code as w_code, w.name as w_name, w.is_factory,
    r.transporter as r_transporter, r.expected_bags as r_expected_bags, r.net_kg as r_net_kg, r.bags as r_bags, r.status as r_status,
    coalesce(s.dispatched_qty_kg, sl.loaded_kg) as q_loaded,
    coalesce(s.received_qty_kg, r.net_kg, sl.received_kg) as q_received
  from public.field_shipments s
  left join sl on sl.shipment_id = s.id
  left join vil on vil.shipment_id = s.id
  left join public.aflp_v_village_dim vo on s.origin_type = 'VILLAGE' and vo.village_id = s.origin_id
  left join lateral (select w1.code, w1.name, w1.is_factory from public.wms_warehouses w1
    where w1.id::text = s.destination_id or w1.code = s.destination_id or w1.code = s.destination_label limit 1) w on true
  left join lateral (select r1.* from public.wms_receptions r1
    where r1.id = s.wms_reception_id or r1.field_shipment_id = s.id order by (r1.id = s.wms_reception_id) desc, r1.created_at desc limit 1) r on true
)
select b.shipment_code as evacuation_id,
  coalesce(b.departed_at, b.created_at)::date as evacuation_date,
  z.label as zone,
  c.label || case when b.n_clusters > 1 then ' (+' || (b.n_clusters - 1) || ' cluster)' else '' end as cluster,
  coalesce(nullif(btrim(b.origin_label), ''), b.villages) as origin,
  coalesce(b.w_code || ' · ' || b.w_name, b.destination_label) as destination,
  b.vehicle_plate as truck_no, b.driver_name, nullif(btrim(b.r_transporter), '') as transporter,
  b.q_loaded as qty_loaded_kg, coalesce(b.r_expected_bags, b.bags_est::int) as bags_loaded,
  b.q_received as qty_received_kg, b.r_bags as bags_received,
  case when b.q_received is not null and b.q_loaded is not null then round(b.q_received - b.q_loaded, 3) end as difference_kg,
  null::numeric as distance_km, null::numeric as transport_cost, null::numeric as fuel_estimate,
  case b.status when 'DRAFT' then 'Brouillon' when 'LOADING' then 'Chargement' when 'DISPATCHED' then 'En route'
    when 'RECEIVED' then 'Reçu' when 'CLOSED' then 'Clôturé' when 'CANCELLED' then 'Annulé' else b.status end as status,
  nullif(concat_ws(' · ',
    case when b.q_received is not null and b.q_loaded > 0 and abs(b.q_received - b.q_loaded) > greatest(0.005 * b.q_loaded, 1)
      then 'Écart poids ' || round(100 * (b.q_received - b.q_loaded) / b.q_loaded, 2) || ' %' end,
    case when b.status = 'DISPATCHED' and b.departed_at < now() - interval '24 hours' then 'Non réceptionné depuis plus de 24 h' end), '') as incident,
  nullif(btrim(b.notes), '') as remarks,
  b.status as status_code, b.destination_type, b.w_code as destination_code, coalesce(b.is_factory, b.destination_type = 'FACTORY') as to_factory,
  c.zone_code, b.cl_code as cluster_code, b.village_ids, b.rt_ids, b.producer_ids, b.id as shipment_uuid, b.departed_at, b.arrived_at,
  '2027'::text as campaign
from base b
left join public.aflp_clusters c on c.code = b.cl_code
left join public.aflp_zones z on z.code = c.zone_code;

-- 4. Onglet 13 · Quality & Traceability -------------------------------------
create or replace view public.aflp_v_quality_traceability with (security_invoker = true) as
select 'QA-' || coalesce(nullif(a.local_id, ''), a.id::text) as quality_id, a.date,
  coalesce(vd.zone, zz.label) as zone, coalesce(vd.cluster, cz.label) as cluster,
  coalesce(vd.village_name, a.village_nom) as village,
  coalesce(nullif(btrim(concat_ws(' ', p.nom, p.prenoms)), ''), a.producteur_nom) as producer_lot,
  'Contrôle achat bord champ'::text as sample_type,
  a.humidite as moisture_pct, null::integer as nut_count, a.kor,
  case when a.impuretes is not null then 'Impuretés ' || a.impuretes || ' %' end as defects,
  case when coalesce(a.rejet, false) then 'Rejeté' else coalesce(a.qualite_statut, 'À évaluer') end as decision,
  a.created_by_nom as quality_officer,
  case when t.overall_status in ('COMPLETE', 'COMPLET', 'OK') then 'Oui'
       when t.overall_status is null then 'Non évalué'
       else 'Non · ' || coalesce(t.next_action, t.overall_status) end as traceability_complete,
  case when a.producteur_id is not null then 'Oui' else 'Non' end as producer_linked,
  case when vd.village_id is not null then 'Oui' else 'Non' end as village_linked,
  case when a.rt_id is not null then 'Oui' else 'Non' end as rt_linked,
  case when coalesce(t.plot_count, 0) > 0 then 'Oui (parcelle)'
       when p.gps_lat is not null and p.gps_lng is not null then 'Oui (producteur)' else 'Non' end as gps_linked,
  nullif(concat_ws(' · ',
    case when t.completeness_score_2027 is not null then 'Score traçabilité 2027 : ' || t.completeness_score_2027 || ' %' end,
    case when t.shipment_count > 0 then 'Évacué' end), '') as remarks,
  'ACHAT'::text as source_type, public.aflp_campaign(a.campaign) as campaign,
  coalesce(vd.zone_code, cz.zone_code) as zone_code, coalesce(vd.cluster_code, cz.code) as cluster_code,
  a.village_id, coalesce(ra.rt_id, a.rt_id) as rt_id, a.producteur_id,
  (a.qualite_statut is null or a.qualite_statut ilike 'à %' or a.qualite_statut ilike '%attente%') and not coalesce(a.rejet, false) as pending
from public.achats a
left join public.aflp_v_village_dim vd on vd.village_id = a.village_id
left join public.aflp_clusters cz on cz.code = public.aflp_cluster_code(a.cluster)
left join public.aflp_zones zz on zz.code = cz.zone_code
left join public.aflp_v_rt_alias ra on ra.any_rt_id = a.rt_id
left join public.producteurs p on p.id = a.producteur_id
left join public.field_traceability_completeness_v t on t.achat_id = a.id
union all
select q.id, q.created_at::date, z.label, c.label, g.villages,
  'Lot ' || coalesce(q.lot_id, r.lot_id, r.id),
  case q.type when 'SAMPLING' then 'Échantillonnage réception' when 'FINAL' then 'Analyse finale' when 'POST_DRY' then 'Contrôle après séchage' else q.type end
    || coalesce(' · ' || w.code, ''),
  q.moisture_pct, q.nut_count, coalesce(q.kor_display, q.kor_exact),
  nullif(concat_ws(' · ', case when q.spotted_g > 0 then 'Tachetées ' || q.spotted_g || ' g' end,
    case when q.imm_g > 0 then 'Immatures ' || q.imm_g || ' g' end,
    case when q.voids_g > 0 then 'Vides ' || q.voids_g || ' g' end), ''),
  coalesce(case q.disposition when 'READY' then 'Prêt' when 'RE_DRY' then 'À resécher' when 'HOLD' then 'Bloqué' end,
    case when q.within_tolerance then 'Dans la tolérance' when q.within_tolerance = false then 'Hors tolérance' end, r.decision),
  q.analyst,
  case when g.producers > 0 then 'Oui (généalogie lot)' else 'Non' end,
  case when g.producers > 0 then 'Oui' else 'Non' end,
  case when g.villages is not null then 'Oui' else 'Non' end,
  case when g.rts > 0 then 'Oui' else 'Non' end,
  'Non disponible',
  nullif(btrim(q.note), ''),
  'WAREHOUSE', '2027', c.zone_code, g.cluster_code, null, null, null,
  false
from public.wms_quality_snapshots q
join public.wms_receptions r on r.id = q.reception_id
left join public.wms_warehouses w on w.id = r.warehouse_id
left join lateral (
  select count(distinct gc.producer_id) as producers, count(distinct gc.rt_id) as rts,
    string_agg(distinct gc.village_name, ', ') as villages, min(vd2.cluster_code) as cluster_code
  from public.wms_lot_procurement_contributors gc
  left join public.aflp_v_village_dim vd2 on vd2.village_id = gc.village_id
  where gc.field_shipment_id = r.field_shipment_id or gc.wms_lot_id = coalesce(q.lot_id, r.lot_id)) g on true
left join public.aflp_clusters c on c.code = g.cluster_code
left join public.aflp_zones z on z.code = c.zone_code
where q.superseded_by is null and (r.field_shipment_id is not null or r.purchase_type = 'FIELD_BUYING');

-- 5. Onglet 14 · Incidents, Risks & Compliance ------------------------------
create or replace view public.aflp_v_incidents with (security_invoker = true) as
select i.id as incident_id, i.incident_date as date, z.label as zone, c.label as cluster, vd.village_name as village,
  coalesce(i.reported_by_name, 'Utilisateur FBMS') as reported_by,
  public.aflp_incident_type_label(i.incident_type) as incident_type,
  case i.risk_category when 'SECURITE' then 'Sécurité' when 'FINANCIER' then 'Financier' when 'OPERATIONNEL' then 'Opérationnel'
    when 'QUALITE' then 'Qualité' when 'CONFORMITE' then 'Conformité' when 'SOCIAL' then 'Social' when 'DONNEES' then 'Données'
    else i.risk_category end as risk_category,
  i.description,
  case i.severity when 'FAIBLE' then 'Faible' when 'MOYENNE' then 'Moyenne' when 'ELEVEE' then 'Élevée' when 'CRITIQUE' then 'Critique' end as severity,
  i.immediate_action, i.responsible_person,
  case i.status when 'OUVERT' then 'Ouvert' when 'EN_COURS' then 'En cours' when 'CLOS' then 'Clos' end as status,
  i.closing_date,
  case when i.evidence_available then 'Oui' || coalesce(' · ' || i.evidence_ref, '') else 'Non' end as evidence_available,
  nullif(concat_ws(' · ', i.remarks, case when i.status = 'CLOS' then 'Clôture : ' || i.closing_note end), '') as remarks,
  'DECLARE'::text as source_type, i.status as status_code, i.incident_type as type_code, i.severity as severity_code,
  coalesce(i.zone_code, c.zone_code) as zone_code, i.cluster_code, i.village_id, i.rt_id, i.producteur_id, i.campaign
from public.aflp_incidents i
left join public.aflp_clusters c on c.code = i.cluster_code
left join public.aflp_zones z on z.code = coalesce(i.zone_code, c.zone_code)
left join public.aflp_v_village_dim vd on vd.village_id = i.village_id
union all
select 'AUTO-JUTE-' || lr.id, lr.submitted_at::date, z.label, c.label, vd.village_name,
  'Détection automatique (sacherie)', 'Manque de sacs', 'Opérationnel',
  'Perte de ' || lr.qty || ' sac(s) déclarée' || coalesce(' : ' || nullif(btrim(lr.motif), ''), ''),
  case when lr.qty >= 50 then 'Élevée' when lr.qty >= 10 then 'Moyenne' else 'Faible' end,
  null, null,
  case lr.statut when 'SOUMIS' then 'Ouvert' else 'Clos' end,
  lr.decided_at::date,
  case when lr.proof_url is not null then 'Oui' else 'Non' end,
  concat_ws(' · ', 'Décision : ' || lr.statut, nullif(btrim(lr.commentaire_decision), '')),
  'AUTO', case lr.statut when 'SOUMIS' then 'OUVERT' else 'CLOS' end, 'MANQUE_SACS',
  case when lr.qty >= 50 then 'ELEVEE' when lr.qty >= 10 then 'MOYENNE' else 'FAIBLE' end,
  c.zone_code, c.code, vd.village_id, l.rt_id, l.producteur_id, '2027'
from public.rcn_jute_loss_requests lr
join public.rcn_jute_locations l on l.code = lr.location_code and (l.scope_type in ('CLUSTER', 'RT', 'PRODUCTEUR') or l.code like 'AFLP-%')
left join public.aflp_v_rt_dim rd on rd.rt_id = l.rt_id
left join public.aflp_clusters c on c.code = coalesce(public.aflp_cluster_code(l.cluster), rd.cluster_code)
left join public.aflp_zones z on z.code = c.zone_code
left join public.aflp_v_village_dim vd on vd.village_id = rd.village_id
where lr.statut <> 'ANNULE'
union all
select 'AUTO-EVAC-' || e.evacuation_id, e.evacuation_date, e.zone, e.cluster, e.origin,
  'Détection automatique (évacuation)', 'Perte de stock', 'Opérationnel',
  'Écart chargé / reçu de ' || e.difference_kg || ' kg sur ' || e.qty_loaded_kg || ' kg chargés',
  case when abs(e.difference_kg) >= 0.02 * e.qty_loaded_kg then 'Élevée' else 'Moyenne' end,
  null, null,
  case when e.status_code = 'CLOSED' then 'Clos' else 'Ouvert' end,
  case when e.status_code = 'CLOSED' then e.arrived_at::date end,
  'Non', 'Évacuation ' || e.evacuation_id,
  'AUTO', case when e.status_code = 'CLOSED' then 'CLOS' else 'OUVERT' end, 'PERTE_STOCK',
  case when abs(e.difference_kg) >= 0.02 * e.qty_loaded_kg then 'ELEVEE' else 'MOYENNE' end,
  e.zone_code, e.cluster_code, e.village_ids[1], e.rt_ids[1], null, e.campaign
from public.aflp_v_evacuations e
where e.difference_kg is not null and e.qty_loaded_kg > 0 and abs(e.difference_kg) > greatest(0.005 * e.qty_loaded_kg, 1)
union all
select 'AUTO-TRANSIT-' || e.evacuation_id, e.evacuation_date, e.zone, e.cluster, e.origin,
  'Détection automatique (évacuation)', 'Problème transport', 'Opérationnel',
  'Évacuation en route depuis plus de 24 h sans réception à ' || coalesce(e.destination, 'destination'),
  'Moyenne', null, null, 'Ouvert', null::date, 'Non', 'Camion ' || coalesce(e.truck_no, '?'),
  'AUTO', 'OUVERT', 'PROBLEME_TRANSPORT', 'MOYENNE',
  e.zone_code, e.cluster_code, e.village_ids[1], e.rt_ids[1], null, e.campaign
from public.aflp_v_evacuations e
where e.status_code = 'DISPATCHED' and e.departed_at < now() - interval '24 hours'
union all
select 'AUTO-PREUVE-' || d.purchase_id, d.purchase_date, d.zone, d.cluster, d.village,
  'Détection automatique (achat)', 'Problème GPS ou preuve manquante', 'Données',
  'Achat sans photo du reçu (preuve manquante)', 'Faible', null, null, 'Ouvert', null::date, 'Non',
  'Achat ' || d.purchase_id,
  'AUTO', 'OUVERT', 'GPS_PREUVE_MANQUANTE', 'FAIBLE',
  d.zone_code, d.cluster_code, d.village_id, d.rt_id, d.producteur_id, d.campaign
from public.aflp_v_daily_purchases d
where not d.rejet and d.remarks like '%Photo du reçu absente%';

-- 6. Onglet 16 · AFLP Audit Log -------------------------------------------------
-- audit_log et farmer_change_log restent réservés au Branch Manager (RLS).
create or replace view public.aflp_v_audit_log with (security_invoker = true) as
select 'AUD-' || a.id as audit_id, a.ts as date, a.email as user_email,
  public.aflp_jsonb(a.details)->>'role' as role,
  coalesce(public.aflp_jsonb(a.details)->>'module',
    case when a.action like 'aflp_%' then 'aflp' else split_part(a.action, '_', 1) end) as module,
  a.action,
  case when a.action like 'aflp_incident%' then 'Incident'
       when a.action like 'achat%' or a.action like 'farmer_buying%' then 'Achat'
       when a.action like 'cash%' then 'Avance / caisse'
       when a.action ~ '^(bag|sac)' then 'Sacs jute'
       when a.action ~* '^(producteur|farmer)' then 'Producteur'
       when a.action ~ '^(distance|hub)' then 'Village / hub'
       else null end as object_type,
  coalesce(public.aflp_jsonb(a.details)->>'id', public.aflp_jsonb(a.details)->>'village_id',
    public.aflp_jsonb(a.details)->>'loss_id', public.aflp_jsonb(a.details)->>'location',
    case when public.aflp_jsonb(a.details) is null then left(a.details, 80) end) as object_id,
  null::text as before_value,
  case when public.aflp_jsonb(a.details) is not null
       then left((public.aflp_jsonb(a.details) - 'path' - 'ts_client' - 'module' - 'role')::text, 400) end as after_value,
  public.aflp_jsonb(a.details)->>'reason' as reason,
  null::text as approval,
  null::text as remarks,
  'AUDIT_LOG'::text as source_type
from public.audit_log a
where a.action not in ('module_access', 'sync_requested', 'logout', 'login')
  and a.action !~ '_guards_installed$' and a.action !~ '^alis_'
union all
select 'FCL-' || f.id, f.created_at, f.actor_email, f.actor_role, 'Registre producteurs', f.operation,
  f.table_name, f.record_id, left(f.before_data::text, 400), left(f.after_data::text, 400), f.reason,
  null, null, 'FARMER_CHANGE_LOG'
from public.farmer_change_log f;

revoke all on function public.aflp_jsonb(text), public.aflp_incident_type_label(text) from public, anon;
grant execute on function public.aflp_jsonb(text), public.aflp_incident_type_label(text) to authenticated;
revoke all on public.aflp_v_jute_bags_ledger, public.aflp_v_field_stock, public.aflp_v_evacuations,
  public.aflp_v_quality_traceability, public.aflp_v_incidents, public.aflp_v_audit_log from anon;
grant select on public.aflp_v_jute_bags_ledger, public.aflp_v_field_stock, public.aflp_v_evacuations,
  public.aflp_v_quality_traceability, public.aflp_v_incidents, public.aflp_v_audit_log to authenticated;
