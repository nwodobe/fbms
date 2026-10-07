-- =============================================================================
-- AFLP 2027 · Coopératives — 5/5 : vues, synthèses, Traceability 360, reporting
-- -----------------------------------------------------------------------------
-- Règles de calcul (aucune donnée inventée) :
--   * Producteur compté UNE fois : par coopérative = producteurs distincts ;
--     totaux programme = affiliation PRINCIPALE uniquement.
--   * Potentiel DÉCLARÉ (coopérative) et potentiel CALCULÉ (producteurs) restent
--     séparés. Le potentiel producteur vient du baseline de production de la
--     campagne, à défaut de la déclaration Farmer Passport ; sinon NON COLLECTÉ
--     (compté à part, jamais remplacé par 0 silencieux).
--   * Volume acheté = achats mode A (achats.cooperative_id) + livraisons
--     consolidées REÇUES (mode B). Les deux circuits sont disjoints par
--     construction (un achat terrain n'est jamais une livraison consolidée).
--   * Qualité : lue dans les LOTS WMS existants (KOR, humidité, rejets) — aucune
--     ressaisie.
-- =============================================================================
begin;

-- ------------------------------------------------ canal AFLP par producteur
create or replace view public.aflp_producer_channel_v with (security_invoker = true) as
select p.id as producer_id, p.code as farmer_id, p.nom, p.prenoms, p.village_id, p.village_nom, p.rt_id,
       camp.code as campaign,
       case when pm.id is not null then 'COOPERATIVE' else 'AFLP_DIRECT' end as sourcing_channel,
       pm.cooperative_id as primary_cooperative_id, c.code as primary_cooperative_code, c.name as primary_cooperative_name,
       pm.member_number, pm.section_id, s.name as section_name, pm.verified as membership_verified,
       coalesce(pm.followup_rt_id, p.rt_id) as followup_rt_id,
       coalesce(e.enrollment_channel, case when p.rt_id is not null then 'AFLP_DIRECT' else 'NON_RENSEIGNE' end) as enrollment_channel,
       e.enrolled_cooperative_id,
       (select count(*) from public.aflp_coop_memberships m2 where m2.producer_id = p.id and m2.campaign = camp.code and m2.status <> 'ENDED') as open_memberships,
       (select count(*) from public.aflp_coop_memberships m3 where m3.producer_id = p.id) as membership_history
from public.producteurs p
cross join (select code from public.procurement_campaigns where code = '2027') camp
left join public.aflp_coop_memberships pm on pm.producer_id = p.id and pm.campaign = camp.code and pm.is_primary and pm.status <> 'ENDED'
left join public.aflp_cooperatives c on c.id = pm.cooperative_id
left join public.aflp_coop_sections s on s.id = pm.section_id
left join public.aflp_producer_enrollment e on e.producer_id = p.id
where not p.deleted;
comment on view public.aflp_producer_channel_v is 'Canal AFLP 2027 de chaque producteur : COOPERATIVE si affiliation principale ouverte, sinon AFLP_DIRECT. Source d''enrôlement distincte de l''affiliation actuelle.';

-- ------------------------------------------- membres d'une coopérative (liste)
create or replace view public.aflp_coop_members_v with (security_invoker = true) as
select m.id as membership_id, m.cooperative_id, m.campaign, m.producer_id, p.code as farmer_id, p.nom, p.prenoms,
       p.village_id, p.village_nom, p.telephone, p.sexe, p.birth_year, p.rt_id, p.consent_status, p.passport_stage,
       p.passport_completion, p.operational_status, p.possible_duplicate,
       m.member_number, m.section_id, s.name as section_name, m.status, m.is_primary, m.verified, m.verification_date,
       m.verification_method, m.source, m.membership_start, m.membership_end, m.followup_rt_id,
       coalesce(pl.area_ha, nullif(p.data->>'superficieHa','')::numeric) as area_ha,
       coalesce(pb.forecast_kg, nullif(p.data->>'potentiel2027Kg','')::numeric) as potential_kg,
       case when pb.forecast_kg is not null then 'BASELINE' when nullif(p.data->>'potentiel2027Kg','') is not null then 'DECLARE' else 'NON_COLLECTE' end as potential_source,
       pl.plot_count, pl.gps_plots,
       (select max(a.date) from public.achats a where a.producteur_id = p.id and not coalesce(a.rejet,false)) as last_purchase_date
from public.aflp_coop_memberships m
join public.producteurs p on p.id = m.producer_id and not p.deleted
left join public.aflp_coop_sections s on s.id = m.section_id
left join lateral (select sum(case when fp.area_unit = 'HA' then fp.declared_area end) as area_ha, count(*) as plot_count,
                          count(*) filter (where fp.latitude is not null and fp.longitude is not null) as gps_plots
                   from public.farmer_plots fp where fp.producteur_id = p.id and not coalesce(fp.deleted,false)) pl on true
left join lateral (select b.forecast_kg from public.farmer_production_baselines b
                   where b.producteur_id = p.id and b.campaign = m.campaign order by b.version desc limit 1) pb on true;

-- ---------------------------------------------- état d'allocation des livraisons
create or replace view public.aflp_coop_delivery_status_v with (security_invoker = true) as
select d.*, c.code as cooperative_code, c.name as cooperative_name,
       coalesce(al.allocated_kg, 0) as allocated_kg, coalesce(al.producers, 0) as allocated_producers,
       coalesce(d.wms_reception_id, arr.reception_id) as reception_id_resolved,
       arr.statut as arrival_status, w.code as warehouse_code,
       case when d.status = 'ANNULEE' then 'ANNULEE'
            when coalesce(al.allocated_kg,0) = 0 then 'ALLOCATION_A_COMPLETER'
            when abs(coalesce(al.allocated_kg,0) - coalesce(d.delivered_kg, d.planned_kg, 0)) <= 0.5 then
                 case when d.status = 'RECUE' then 'TRACABLE' else 'ALLOUEE_PREVISION' end
            else 'ALLOCATION_A_COMPLETER' end as allocation_status,
       (d.status = 'RECUE' and abs(coalesce(al.allocated_kg,0) - coalesce(d.delivered_kg,0)) <= 0.5) as fully_traceable
from public.aflp_coop_deliveries d
join public.aflp_cooperatives c on c.id = d.cooperative_id
left join lateral (select sum(qty_kg) allocated_kg, count(*) producers from public.aflp_coop_delivery_allocations a where a.delivery_id = d.id) al on true
left join public.rcn_proc_arrivages arr on arr.id = d.arrival_id
left join public.wms_warehouses w on w.id = d.warehouse_id;

-- ------------------------------------------------------- origine d'un LOT WMS
create or replace view public.aflp_lot_origin_v with (security_invoker = true) as
with contrib as (
  select k.wms_lot_id, a.sourcing_channel, a.cooperative_id, k.producer_id, k.village_id, k.field_qty_kg
  from public.wms_lot_procurement_contributors k left join public.achats a on a.id = k.achat_id
), dlv as (
  select l.id as wms_lot_id, ds.cooperative_id, ds.id as delivery_id, ds.fully_traceable, ds.allocated_producers
  from public.wms_lots l
  join public.aflp_coop_delivery_status_v ds on ds.reception_id_resolved = l.reception_id
)
select l.id as lot_id, l.reception_id, l.supplier_code, l.supplier_name, l.initial_kg, l.status as lot_status,
       r.procurement_channel, r.purchase_type,
       case when exists (select 1 from dlv where dlv.wms_lot_id = l.id) then 'COOPERATIVE'
            when (select count(distinct sourcing_channel) from contrib where contrib.wms_lot_id = l.id) > 1 then 'MIXTE'
            when exists (select 1 from contrib where contrib.wms_lot_id = l.id and sourcing_channel = 'COOPERATIVE') then 'COOPERATIVE'
            when exists (select 1 from contrib where contrib.wms_lot_id = l.id) then 'AFLP_DIRECT'
            else coalesce(r.procurement_channel, r.purchase_type, 'NON_RENSEIGNE') end as origin_channel,
       (select string_agg(distinct c.code, ', ') from public.aflp_cooperatives c
         where c.id in (select cooperative_id from contrib where contrib.wms_lot_id = l.id
                        union select cooperative_id from dlv where dlv.wms_lot_id = l.id)) as cooperative_codes,
       (select count(distinct producer_id) from contrib where contrib.wms_lot_id = l.id)
         + coalesce((select sum(allocated_producers) from dlv where dlv.wms_lot_id = l.id),0) as farmers,
       (select count(distinct village_id) from contrib where contrib.wms_lot_id = l.id) as villages,
       case when exists (select 1 from dlv where dlv.wms_lot_id = l.id and not dlv.fully_traceable) then 'ALLOCATION_A_COMPLETER'
            when exists (select 1 from dlv where dlv.wms_lot_id = l.id) then 'TRACABLE_PRODUCTEUR'
            when exists (select 1 from contrib where contrib.wms_lot_id = l.id) then 'TRACABLE_PRODUCTEUR'
            else 'ORGANISATION_SEULEMENT' end as traceability_level
from public.wms_lots l left join public.wms_receptions r on r.id = l.reception_id;

-- ------------------------------------------------- synthèse par coopérative
create or replace function public.aflp_coop_dashboard(p_campaign text default '2027')
returns table(cooperative_id uuid, code text, name text, acronym text, locality text, departement text, sous_prefecture text,
  cluster_code text, zone_code text, aflp_status text, compliance_status text, producer_registry_status text, is_qa boolean,
  archived boolean, payment_model text, supplier_linked boolean, declared_members int, producers_registered bigint,
  producers_verified bigint, producers_primary bigint, villages_covered bigint, sections bigint,
  declared_potential_mt numeric, farmer_potential_kg numeric, farmer_potential_missing bigint, area_ha numeric,
  target_mt numeric, secured_volume_mt numeric, purchased_kg_mode_a numeric, delivered_kg_mode_b numeric, purchased_kg numeric,
  achievement_pct numeric, passport_complete bigint, consent_granted bigint, women bigint, youth bigint, birth_year_missing bigint,
  gps_plots bigint, documents_valid bigint, documents_expired bigint, documents_missing_categories int,
  deliveries_to_allocate bigint, kor_avg numeric, moisture_avg numeric, rejected_receptions bigint, bags_balance numeric,
  last_activity timestamptz)
language sql stable security definer set search_path = public, private as $$
  with coops as (
    select c.*, k.zone_code, cc.payment_model, cc.declared_potential_mt, cc.target_mt, cc.secured_volume_mt
    from public.aflp_cooperatives c
    left join public.aflp_clusters k on k.code = c.cluster_code
    left join public.aflp_coop_campaigns cc on cc.cooperative_id = c.id and cc.campaign = p_campaign
    where private.aflp_coop_can_read(c.id)
  ), mem as (
    select m.cooperative_id, m.producer_id, bool_or(m.verified) verified, bool_or(m.is_primary) is_primary
    from public.aflp_coop_memberships m join public.producteurs p on p.id = m.producer_id and not p.deleted
    where m.campaign = p_campaign and m.status in ('ACTIVE','PENDING','SUSPENDED')
    group by 1,2
  ), prod as (
    select mem.cooperative_id, mem.producer_id, mem.verified, mem.is_primary, p.sexe, p.birth_year, p.consent_status, p.passport_stage,
           coalesce((select b.forecast_kg from public.farmer_production_baselines b where b.producteur_id = p.id and b.campaign = p_campaign order by b.version desc limit 1),
                    nullif(p.data->>'potentiel2027Kg','')::numeric) pot_kg,
           coalesce((select sum(fp.declared_area) from public.farmer_plots fp where fp.producteur_id = p.id and fp.area_unit = 'HA' and not coalesce(fp.deleted,false)),
                    nullif(p.data->>'superficieHa','')::numeric) area,
           (select count(*) from public.farmer_plots fp where fp.producteur_id = p.id and fp.latitude is not null and not coalesce(fp.deleted,false)) gps
    from mem join public.producteurs p on p.id = mem.producer_id
  ), buy_a as (
    select a.cooperative_id, sum(a.poids_net) kg, max(a.created_at) last_at from public.achats a
    where a.cooperative_id is not null and not coalesce(a.rejet,false) and coalesce(a.campaign, p_campaign) = p_campaign group by 1
  ), buy_b as (
    select ds.cooperative_id, sum(ds.delivered_kg) filter (where ds.status = 'RECUE') kg,
           count(*) filter (where ds.status <> 'ANNULEE' and ds.allocation_status = 'ALLOCATION_A_COMPLETER') to_alloc,
           max(ds.updated_at) last_at
    from public.aflp_coop_delivery_status_v ds
    where ds.campaign = p_campaign group by 1
  ), lots as (
    select distinct c.id cooperative_id, l.id lot_id, l.kor_final, l.moisture_final
    from coops c join public.aflp_lot_origin_v o on c.code = any(string_to_array(o.cooperative_codes, ', '))
    join public.wms_lots l on l.id = o.lot_id
  ), rej as (
    select ds.cooperative_id, count(*) n from public.aflp_coop_delivery_status_v ds
    join public.wms_receptions r on r.id = ds.reception_id_resolved
    where upper(coalesce(r.decision,'')) like 'REJ%' or upper(coalesce(r.status,'')) like 'REJ%' group by 1
  ), docs as (
    select d.cooperative_id,
           count(*) filter (where not d.voided and (d.expires_on is null or d.expires_on >= current_date)) valid,
           count(*) filter (where not d.voided and d.expires_on < current_date) expired,
           array_agg(distinct d.category) filter (where not d.voided) cats
    from public.aflp_coop_documents d group by 1
  ), bags as (
    select c.id cooperative_id, j.balance from coops c
    join public.procurement_supplier_code_history h on h.supplier_id = c.supplier_id and h.is_current
    join public.rcn_jute_v_supplier_profile j on j.supplier_code = h.code
  )
  select c.id, c.code, c.name, c.acronym, c.locality, c.departement, c.sous_prefecture, c.cluster_code, c.zone_code,
         c.aflp_status, c.compliance_status, c.producer_registry_status, c.is_qa, c.archived,
         coalesce(c.payment_model,'INDIVIDUAL_FARMER'), c.supplier_id is not null, c.declared_members,
         (select count(*) from prod where prod.cooperative_id = c.id),
         (select count(*) from prod where prod.cooperative_id = c.id and prod.verified),
         (select count(*) from prod where prod.cooperative_id = c.id and prod.is_primary),
         (select count(*) from public.aflp_coop_villages v where v.cooperative_id = c.id and v.active),
         (select count(*) from public.aflp_coop_sections s where s.cooperative_id = c.id and s.active),
         c.declared_potential_mt,
         (select sum(pot_kg) from prod where prod.cooperative_id = c.id),
         (select count(*) from prod where prod.cooperative_id = c.id and pot_kg is null),
         (select sum(area) from prod where prod.cooperative_id = c.id),
         c.target_mt, c.secured_volume_mt,
         coalesce(ba.kg,0), coalesce(bb.kg,0), coalesce(ba.kg,0) + coalesce(bb.kg,0),
         case when coalesce(c.target_mt,0) > 0 then round((coalesce(ba.kg,0) + coalesce(bb.kg,0)) / 10 / c.target_mt, 1) end,
         (select count(*) from prod where prod.cooperative_id = c.id and prod.passport_stage in ('BASELINE','VERIFIED','MAPPED')),
         (select count(*) from prod where prod.cooperative_id = c.id and prod.consent_status = 'GRANTED'),
         (select count(*) from prod where prod.cooperative_id = c.id and prod.sexe = 'F'),
         (select count(*) from prod where prod.cooperative_id = c.id and prod.birth_year >= extract(year from current_date)::int - 35),
         (select count(*) from prod where prod.cooperative_id = c.id and prod.birth_year is null),
         (select coalesce(sum(gps),0) from prod where prod.cooperative_id = c.id),
         coalesce(dc.valid,0), coalesce(dc.expired,0),
         (select count(*) from unnest(array['AGREMENT','STATUTS','LISTE_MEMBRES','RIB','PIECE_PRESIDENT','CONTRAT_AFLP']) req(cat)
           where dc.cats is null or not (req.cat = any(dc.cats)))::int,
         coalesce(bb.to_alloc,0),
         (select round(avg(kor_final),2) from lots where lots.cooperative_id = c.id),
         (select round(avg(moisture_final),2) from lots where lots.cooperative_id = c.id),
         coalesce(rj.n,0), bg.balance,
         greatest(c.updated_at, ba.last_at, bb.last_at)
  from coops c
  left join buy_a ba on ba.cooperative_id = c.id
  left join buy_b bb on bb.cooperative_id = c.id
  left join docs dc on dc.cooperative_id = c.id
  left join rej rj on rj.cooperative_id = c.id
  left join bags bg on bg.cooperative_id = c.id
  order by c.is_qa, c.archived, c.code;
$$;

-- ------------------------------------------------ totaux sans double comptage
create or replace function public.aflp_channel_totals(p_campaign text default '2027', p_include_qa boolean default false)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with p as (
    select pr.id, pr.rt_id,
           exists (select 1 from public.aflp_coop_memberships m join public.aflp_cooperatives c on c.id = m.cooperative_id
                   where m.producer_id = pr.id and m.campaign = p_campaign and m.is_primary and m.status <> 'ENDED'
                     and not c.archived and (p_include_qa or not c.is_qa)) as coop
    from public.producteurs pr
    where not pr.deleted and private.farmer_registry_can_access_producteur(pr.id)
  )
  select jsonb_build_object(
    'campaign', p_campaign,
    'producteurs_total', count(*),
    'direct_rt', count(*) filter (where not coop),
    'cooperatives', count(*) filter (where coop),
    'cooperatives_avec_rt_suivi', count(*) filter (where coop and rt_id is not null),
    'sans_rt_ni_coop', count(*) filter (where not coop and rt_id is null),
    'note', 'Chaque producteur est compté une seule fois : canal COOPERATIVE si affiliation principale ouverte, sinon DIRECT.'
  ) from p;
$$;

-- --------------------------------------- chaîne complète d'une coopérative (T360)
create or replace function public.aflp_coop_chain(p_coop uuid, p_campaign text default '2027')
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare c public.aflp_cooperatives; v_lots text[]; res jsonb;
begin
  if not private.aflp_coop_can_read(p_coop) then raise exception 'Coopérative hors périmètre' using errcode = '42501'; end if;
  select * into c from public.aflp_cooperatives where id = p_coop;
  select array_agg(distinct lot_id) into v_lots from public.aflp_lot_origin_v where c.code = any(string_to_array(cooperative_codes, ', '));
  res := jsonb_build_object(
    'cooperative', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'status', c.aflp_status, 'supplier_linked', c.supplier_id is not null),
    'producteurs', jsonb_build_object(
       'ouverts', (select count(distinct producer_id) from public.aflp_coop_memberships where cooperative_id = p_coop and campaign = p_campaign and status <> 'ENDED'),
       'historique', (select count(*) from public.aflp_coop_memberships where cooperative_id = p_coop),
       'verifies', (select count(distinct producer_id) from public.aflp_coop_memberships where cooperative_id = p_coop and campaign = p_campaign and verified and status <> 'ENDED')),
    'achats_mode_a', (select jsonb_build_object('nombre', count(*), 'kg', coalesce(sum(poids_net),0), 'producteurs', count(distinct producteur_id),
                        'dernier', max(date)) from public.achats where cooperative_id = p_coop and not coalesce(rejet,false)),
    'achats_vers_lots_terrain', (select jsonb_build_object('lots', count(distinct flc.lot_id), 'kg', coalesce(sum(flc.qty_kg),0))
                        from public.field_lot_contributors flc join public.achats a on a.id = flc.achat_id
                        where a.cooperative_id = p_coop and flc.status = 'ACTIVE'),
    'livraisons', coalesce((select jsonb_agg(jsonb_build_object('code', ds.code, 'statut', ds.status, 'prevu_kg', ds.planned_kg,
                        'livre_kg', ds.delivered_kg, 'alloue_kg', ds.allocated_kg, 'allocation', ds.allocation_status,
                        'arrivage', ds.arrival_id, 'reception', ds.reception_id_resolved, 'entrepot', ds.warehouse_code,
                        'date', coalesce(ds.delivered_at::date, ds.planned_date)) order by ds.planned_date desc)
                        from public.aflp_coop_delivery_status_v ds where ds.cooperative_id = p_coop), '[]'::jsonb),
    'lots', coalesce((select jsonb_agg(jsonb_build_object('lot', o.lot_id, 'reception', o.reception_id, 'kg', o.initial_kg,
                        'statut', o.lot_status, 'canal', o.origin_channel, 'producteurs', o.farmers, 'villages', o.villages,
                        'tracabilite', o.traceability_level, 'kor', l.kor_final, 'humidite', l.moisture_final, 'entrepot', w.code,
                        'bins', (select jsonb_agg(distinct mv.dest_id) from public.wms_movement_lots ml join public.wms_movements mv on mv.id = ml.movement_id
                                 where ml.lot_id = o.lot_id and mv.dest_type = 'BIN'),
                        'transferts', (select jsonb_agg(distinct jsonb_build_object('id', t.id, 'statut', t.status, 'destination', dw.code, 'usine', dw.is_factory))
                                 from public.wms_transfer_lines tl join public.wms_transfers t on t.id = tl.transfer_id
                                 left join public.wms_warehouses dw on dw.id = t.dest_warehouse_id where tl.lot_id = o.lot_id)))
                     from public.aflp_lot_origin_v o join public.wms_lots l on l.id = o.lot_id
                     left join public.wms_warehouses w on w.id = l.warehouse_id
                     where o.lot_id = any(coalesce(v_lots, array[]::text[]))), '[]'::jsonb));
  return res;
end $$;

-- ------------------------------ Traceability 360 : la coopérative devient recherchable
create or replace view public.operations_traceability_search_v with (security_invoker = true) as
 SELECT 'FARMER_CHAIN'::text AS entity_type,
    COALESCE(c.farmer_id, c.producteur_id) AS entity_id,
    concat_ws(' '::text, c.farmer_id, c.producteur_nom, c.producteur_prenoms, c.lot_code, c.shipment_code, c.vehicle_plate, c.factory_lot_id) AS search_text,
    c.achat_date AS event_date, c.achat_poids_net_kg AS qty_kg, c.origin_label, c.destination_label,
    jsonb_build_object('producteur_id', c.producteur_id, 'achat_id', c.achat_id, 'lot_code', c.lot_code, 'shipment_code', c.shipment_code,
      'vehicle_plate', c.vehicle_plate, 'reception_id', c.reception_id, 'factory_lot_id', c.factory_lot_id) AS details
   FROM field_traceability_chain_v c
UNION ALL
 SELECT 'RCN_GENEALOGY'::text, ((g.parent_id || '>'::text) || g.enfant_id),
    concat_ws(' '::text, g.parent_type, g.parent_id, g.enfant_type, g.enfant_id), NULL::date, g.qty_kg, NULL::text, NULL::text,
    jsonb_build_object('parent_type', g.parent_type, 'parent_id', g.parent_id, 'child_type', g.enfant_type, 'child_id', g.enfant_id, 'share_pct', g.part_pct)
   FROM rcn_v_genealogie g
UNION ALL
 SELECT 'LBA'::text, f.code, concat_ws(' '::text, f.code, f.nom, array_to_string(f.sites, ' '::text)), f.derniere_livraison, f.volume_livre_kg,
    NULL::text, NULL::text,
    jsonb_build_object('name', f.nom, 'status', f.statut, 'sites', f.sites, 'kor_avg', f.kor_moyen, 'moisture_avg', f.humidite_moyenne)
   FROM rcn_fournisseurs f WHERE (f.code ~~ 'LBA-%'::text)
UNION ALL
 SELECT 'FUNDING_CYCLE'::text, c.cycle_code, concat_ws(' '::text, c.cycle_code, c.lba_code, c.campaign, c.status), (c.opened_at)::date,
    NULL::numeric, NULL::text, NULL::text,
    jsonb_build_object('lba_code', c.lba_code, 'campaign', c.campaign, 'status', c.status, 'opened_at', c.opened_at,
      'first_delivery_at', c.first_delivery_at, 'closed_at', c.closed_at)
   FROM lba_funding_cycles c
UNION ALL
 SELECT 'STOCK_TRANSFER'::text, t.id, concat_ws(' '::text, t.id, t.bin_id, t.destination, t.truck_plate, t.transporter, t.driver_name, t.seal_no),
    (t.created_at)::date, t.poids_envoye, t.origin_warehouse_code, t.destination_warehouse_code,
    jsonb_build_object('bin_id', t.bin_id, 'state', t.etat, 'sent_kg', t.poids_envoye, 'received_kg', t.poids_recu, 'variance_kg', t.ecart_kg,
      'truck', t.truck_plate, 'seal', t.seal_no)
   FROM rcn_transferts t
UNION ALL
 SELECT 'COOPERATIVE'::text, k.code,
    concat_ws(' '::text, k.code, k.name, k.acronym, k.locality, k.sous_prefecture, k.cluster_code, k.registration_no),
    k.aflp_join_date, NULL::numeric, k.locality, NULL::text,
    jsonb_build_object('cooperative_id', k.id, 'name', k.name, 'status', k.aflp_status, 'cluster', k.cluster_code, 'locality', k.locality)
   FROM aflp_cooperatives k WHERE NOT k.archived AND NOT k.is_qa
UNION ALL
 SELECT 'COOP_DELIVERY'::text, d.code,
    concat_ws(' '::text, d.code, d.cooperative_code, d.cooperative_name, d.arrival_id, d.reception_id_resolved, d.warehouse_code),
    COALESCE(d.delivered_at::date, d.planned_date), COALESCE(d.delivered_kg, d.planned_kg), d.cooperative_name, d.warehouse_code,
    jsonb_build_object('cooperative', d.cooperative_code, 'status', d.status, 'allocation', d.allocation_status,
      'allocated_kg', d.allocated_kg, 'arrival', d.arrival_id, 'reception', d.reception_id_resolved)
   FROM aflp_coop_delivery_status_v d
UNION ALL
 SELECT 'WMS_LOT'::text, o.lot_id,
    concat_ws(' '::text, o.lot_id, o.reception_id, o.supplier_code, o.supplier_name, o.cooperative_codes, o.origin_channel),
    NULL::date, o.initial_kg, o.supplier_name, NULL::text,
    jsonb_build_object('origin_channel', o.origin_channel, 'cooperatives', o.cooperative_codes, 'farmers', o.farmers, 'villages', o.villages,
      'traceability', o.traceability_level, 'reception', o.reception_id, 'status', o.lot_status)
   FROM aflp_lot_origin_v o;

grant select on public.aflp_producer_channel_v, public.aflp_coop_members_v, public.aflp_coop_delivery_status_v,
  public.aflp_lot_origin_v, public.operations_traceability_search_v to authenticated;
revoke all on public.aflp_producer_channel_v, public.aflp_coop_members_v, public.aflp_coop_delivery_status_v,
  public.aflp_lot_origin_v from anon;
revoke all on function public.aflp_coop_dashboard(text), public.aflp_channel_totals(text,boolean), public.aflp_coop_chain(uuid,text) from public, anon;
grant execute on function public.aflp_coop_dashboard(text), public.aflp_channel_totals(text,boolean), public.aflp_coop_chain(uuid,text) to authenticated;

commit;
