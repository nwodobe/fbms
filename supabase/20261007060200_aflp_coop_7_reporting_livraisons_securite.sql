-- AFLP 2027 · Coopératives · 7c — Delivery Plan (mode B), reporting filtrable, durcissement.

begin;

-- ---------------------------------------------------- livraisons : vue enrichie (colonnes ajoutées en fin)
create or replace view public.aflp_coop_delivery_status_v with (security_invoker = true) as
select d.id, d.code, d.cooperative_id, d.campaign, d.payment_model, d.section_id, d.collection_point_id, d.warehouse_id,
       d.planned_date, d.planned_kg, d.planned_bags, d.arrival_id, d.wms_reception_id, d.delivered_kg, d.delivered_bags,
       d.delivered_at, d.status, d.cancel_reason, d.notes, d.created_at, d.created_by, d.updated_at, d.updated_by,
       c.code as cooperative_code, c.name as cooperative_name,
       coalesce(al.allocated_kg, 0) as allocated_kg, coalesce(al.producers, 0) as allocated_producers,
       coalesce(d.wms_reception_id, arr.reception_id) as reception_id_resolved,
       arr.statut as arrival_status, w.code as warehouse_code,
       case when d.status = 'ANNULEE' then 'ANNULEE'
            when coalesce(al.allocated_kg,0) = 0 then 'ALLOCATION_A_COMPLETER'
            when abs(coalesce(al.allocated_kg,0) - coalesce(d.delivered_kg, d.planned_kg, 0)) <= 0.5 then
                 case when d.status = 'RECUE' then 'TRACABLE' else 'ALLOUEE_PREVISION' end
            else 'ALLOCATION_A_COMPLETER' end as allocation_status,
       (d.status = 'RECUE' and abs(coalesce(al.allocated_kg,0) - coalesce(d.delivered_kg,0)) <= 0.5) as fully_traceable,
       coalesce(d.truck, arr.payload->>'truck') as truck,
       coalesce(d.driver, arr.payload->>'driver') as driver,
       coalesce(d.transporter, arr.payload->>'transporter') as transporter,
       coalesce(d.origin, arr.payload->>'origin') as origin,  -- jamais déduite de la localité
       c.supplier_id, ps.display_name as supplier_name,
       (select h.code from public.procurement_supplier_code_history h where h.supplier_id = c.supplier_id and h.is_current limit 1) as supplier_code,
       w.name as warehouse_name, c.is_qa,
       case when d.status = 'ANNULEE' then 'ANNULEE'
            when d.status = 'RECUE' and abs(coalesce(al.allocated_kg,0) - coalesce(d.delivered_kg,0)) <= 0.5 then 'TRACABLE_PRODUCTEUR'
            when d.status = 'RECUE' then 'ORGANISATION_SEULEMENT'
            else 'EN_ATTENTE_RECEPTION' end as traceability_level
from public.aflp_coop_deliveries d
join public.aflp_cooperatives c on c.id = d.cooperative_id
left join lateral (select sum(qty_kg) allocated_kg, count(*) producers from public.aflp_coop_delivery_allocations a where a.delivery_id = d.id) al on true
left join public.rcn_proc_arrivages arr on arr.id = d.arrival_id
left join public.wms_warehouses w on w.id = d.warehouse_id
left join public.procurement_suppliers ps on ps.supplier_id = c.supplier_id;
grant select on public.aflp_coop_delivery_status_v to authenticated;
revoke all on public.aflp_coop_delivery_status_v from anon;

-- Planification : camion, chauffeur, transporteur et origine conservés sur la livraison
-- elle-même (même sans Supplier lié).
create or replace function public.aflp_coop_plan_delivery(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_coop uuid := (p->>'cooperative_id')::uuid; c public.aflp_cooperatives; cc public.aflp_coop_campaigns;
  v_campaign text := coalesce(private.aflp_txt(p,'campaign'),'2027'); v_arr jsonb; d public.aflp_coop_deliveries;
  v_code text; v_wh uuid; v_origin text;
begin
  perform private.aflp_require_edit(v_coop);
  select * into c from public.aflp_cooperatives where id = v_coop;
  if c.aflp_status not in ('APPROUVEE','ACTIVE') or c.archived then
    raise exception 'Coopérative % (statut %) : livraison non planifiable', c.code, c.aflp_status;
  end if;
  select * into cc from public.aflp_coop_campaigns where cooperative_id = v_coop and campaign = v_campaign;
  v_wh := coalesce(nullif(p->>'warehouse_id','')::uuid, cc.destination_warehouse_id);
  if v_wh is null then raise exception 'Entrepôt de destination obligatoire'; end if;
  if private.aflp_numv(p,'planned_kg') is null or private.aflp_numv(p,'planned_kg') <= 0 then raise exception 'Quantité prévue (kg) obligatoire'; end if;
  if nullif(p->>'planned_date','') is null then raise exception 'Date de livraison prévue obligatoire'; end if;
  -- Repli historique (contrat Procurement : origine obligatoire) limité au Delivery Plan ;
  -- la livraison coopérative ne garde que l'origine réellement saisie.
  v_origin := coalesce(private.aflp_txt(p,'origin'), c.locality, c.departement, 'GBEKE');

  if c.supplier_id is not null and coalesce((p->>'to_procurement_plan')::boolean, true) and not c.is_qa then
    select h.code into v_code from public.procurement_supplier_code_history h where h.supplier_id = c.supplier_id and h.is_current limit 1;
    v_arr := public.procurement_schedule_supplier_arrival(jsonb_build_object(
      'purchase_type','COOPERATIVE','supplier_code', v_code, 'origin', v_origin,
      'warehouse_id', v_wh, 'expected_kg', private.aflp_numv(p,'planned_kg'), 'expected_bags', p->>'planned_bags',
      'expected_at', (p->>'planned_date')::date + time '08:00', 'truck', p->>'truck', 'driver', p->>'driver',
      'transporter', p->>'transporter', 'reference', coalesce(private.aflp_txt(p,'reference'), c.code)));
  end if;

  insert into public.aflp_coop_deliveries(cooperative_id, campaign, payment_model, section_id, collection_point_id, warehouse_id,
     planned_date, planned_kg, planned_bags, arrival_id, notes, truck, driver, transporter, origin)
  values (v_coop, v_campaign, coalesce(cc.payment_model,'INDIVIDUAL_FARMER'), nullif(p->>'section_id','')::uuid,
     nullif(p->>'collection_point_id','')::uuid, v_wh, (p->>'planned_date')::date, private.aflp_numv(p,'planned_kg'),
     private.aflp_numv(p,'planned_bags')::int, v_arr->>'id', private.aflp_txt(p,'notes'),
     private.aflp_txt(p,'truck'), private.aflp_txt(p,'driver'), private.aflp_txt(p,'transporter'), private.aflp_txt(p,'origin'))
  returning * into d;
  return to_jsonb(d) || jsonb_build_object('arrival', v_arr);
end $$;

-- ------------------------------------------------------ totaux par canal (QA exclus)
create or replace function public.aflp_channel_totals(p_campaign text default '2027', p_include_qa boolean default false)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with p as (
    select pr.id, pr.rt_id,
           exists (select 1 from public.aflp_coop_memberships m join public.aflp_cooperatives c on c.id = m.cooperative_id
                   where m.producer_id = pr.id and m.campaign = p_campaign and m.is_primary and m.status <> 'ENDED'
                     and not c.archived and (p_include_qa or not c.is_qa)) as coop
    from public.producteurs pr
    where not pr.deleted and public.est_actif() and private.farmer_registry_can_access_producteur(pr.id)
      and (p_include_qa or not coalesce((pr.data->>'qa')::boolean, false))
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

-- ------------------------------------------------------------ reporting filtrable
-- Filtres combinables : campaign, channel (AFLP_DIRECT|COOPERATIVE), coop, coop_status,
-- zone, cluster, village_id, section_id, producer (Farmer ID / nom), date_from, date_to.
-- Un producteur n'est compté qu'une fois (canal = affiliation principale ouverte).
-- Les achats sont filtrés par leur propre canal à la date d'achat (vérité historique).
-- Agrégats uniquement : aucune donnée nominative n'est renvoyée.
create or replace function public.aflp_coop_report(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_campaign text := coalesce(nullif(p->>'campaign',''),'2027'); v_ch text := nullif(p->>'channel','');
  v_coop uuid := nullif(p->>'coop','')::uuid; v_cst text := nullif(p->>'coop_status',''); v_zone text := nullif(p->>'zone','');
  v_cluster text := nullif(p->>'cluster',''); v_village text := nullif(p->>'village_id',''); v_section uuid := nullif(p->>'section_id','')::uuid;
  v_prod text := nullif(btrim(coalesce(p->>'producer','')),''); v_from date := nullif(p->>'date_from','')::date;
  v_to date := nullif(p->>'date_to','')::date; v_yr int := extract(year from current_date)::int; res jsonb;
begin
  if not public.est_actif() then raise exception 'Session inactive' using errcode = '42501'; end if;
  if v_from is not null and v_to is not null and v_from > v_to then raise exception 'Période invalide : « du » après « au »'; end if;

  with prod as (
    select pr.id, pr.code, pr.sexe, pr.birth_year, pr.village_id, v.cluster_code, cl.zone_code,
           pm.cooperative_id, pm.section_id, pm.verified, coalesce(pm.cooperative_id is not null, false) as is_coop,
           q.completeness_pct, q.consent_recorded, pr.consent_status, q.has_gps, q.has_area
    from public.producteurs pr
    left join public.villages v on v.id = pr.village_id
    left join public.aflp_clusters cl on cl.code = v.cluster_code
    left join lateral (select m.cooperative_id, m.section_id, m.verified from public.aflp_coop_memberships m
                       join public.aflp_cooperatives c on c.id = m.cooperative_id
                       where m.producer_id = pr.id and m.campaign = v_campaign and m.is_primary and m.status <> 'ENDED'
                         and not c.archived and not c.is_qa limit 1) pm on true
    left join public.aflp_producer_quality_v q on q.producer_id = pr.id
    where not pr.deleted and not coalesce((pr.data->>'qa')::boolean,false)
      and private.farmer_registry_can_access_producteur(pr.id)
  ), coops as (
    select c.*, cl.zone_code from public.aflp_cooperatives c left join public.aflp_clusters cl on cl.code = c.cluster_code
    where not c.is_qa and not c.archived and private.aflp_coop_can_read(c.id)
      and (v_coop is null or c.id = v_coop) and (v_cst is null or c.aflp_status = v_cst)
      and (v_cluster is null or c.cluster_code = v_cluster) and (v_zone is null or cl.zone_code = v_zone)
      and (v_village is null or exists (select 1 from public.aflp_coop_villages cv where cv.cooperative_id = c.id and cv.village_id = v_village and cv.active))
      and (v_section is null or exists (select 1 from public.aflp_coop_sections s where s.cooperative_id = c.id and s.id = v_section))
      and coalesce(v_ch,'COOPERATIVE') = 'COOPERATIVE'
  ), f as (
    select pr.* from prod pr
    where (v_ch is null or (v_ch = 'COOPERATIVE') = pr.is_coop)
      and (v_zone is null or pr.zone_code = v_zone) and (v_cluster is null or pr.cluster_code = v_cluster)
      and (v_village is null or pr.village_id = v_village) and (v_section is null or pr.section_id = v_section)
      and (v_coop is null or pr.cooperative_id = v_coop)
      and (v_cst is null or pr.cooperative_id in (select id from coops))
      and (v_prod is null or upper(pr.code) = upper(v_prod) or pr.id = v_prod
           or exists (select 1 from public.producteurs x where x.id = pr.id
                      and public.farmer_registry_norm_text(coalesce(x.nom,'') || ' ' || coalesce(x.prenoms,'')) like '%' || public.farmer_registry_norm_text(v_prod) || '%'))
  ), buys as (
    select a.producteur_id, a.poids_net, a.sourcing_channel, a.cooperative_id from public.achats a join f on f.id = a.producteur_id
    where not coalesce(a.rejet,false) and coalesce(a.campaign, v_campaign) = v_campaign
      and (v_from is null or a.date::date >= v_from) and (v_to is null or a.date::date <= v_to)
      and (v_ch is null or coalesce(a.sourcing_channel,'AFLP_DIRECT') = v_ch)
  ), dlv as (
    select d.* from public.aflp_coop_deliveries d join coops c on c.id = d.cooperative_id
    where d.campaign = v_campaign and d.status <> 'ANNULEE'
      and (v_section is null or d.section_id = v_section)
      and (v_from is null or coalesce(d.delivered_at::date, d.planned_date) >= v_from)
      and (v_to is null or coalesce(d.delivered_at::date, d.planned_date) <= v_to)
      and v_village is null and v_prod is null
  ), dl as (
    select d.*, coalesce((select sum(qty_kg) from public.aflp_coop_delivery_allocations a where a.delivery_id = d.id),0) alloc from dlv d
  )
  select jsonb_build_object(
    'filters', p,
    'producteurs', (select count(*) from f),
    'direct_rt', (select count(*) from f where not is_coop),
    'cooperative', (select count(*) from f where is_coop),
    'membres_verifies', (select count(*) from f where is_coop and verified),
    'femmes', (select count(*) from f where sexe = 'F'), 'hommes', (select count(*) from f where sexe = 'M'),
    'sexe_non_collecte', (select count(*) from f where sexe is null or sexe not in ('M','F','OTHER')),
    'jeunes_moins_35', (select count(*) from f where birth_year is not null and birth_year >= v_yr - 35),
    'age_non_collecte', (select count(*) from f where birth_year is null),
    'consentement_accorde', (select count(*) from f where consent_status = 'GRANTED'),
    'consentement_non_recueilli', (select count(*) from f where not coalesce(consent_recorded,false)),
    'avec_gps', (select count(*) from f where has_gps), 'avec_superficie', (select count(*) from f where has_area),
    'completude_moyenne', (select round(avg(completeness_pct)) from f),
    'dossiers_complets', (select count(*) from f where completeness_pct = 100),
    'cooperatives', (select count(*) from coops), 'cooperatives_actives', (select count(*) from coops where aflp_status = 'ACTIVE'),
    'achats_nombre', (select count(*) from buys), 'achats_kg', (select coalesce(sum(poids_net),0) from buys),
    'achats_kg_canal_coop', (select coalesce(sum(poids_net),0) from buys where sourcing_channel = 'COOPERATIVE'),
    'livraisons', (select count(*) from dl), 'livraisons_recues_kg', (select coalesce(sum(delivered_kg) filter (where status = 'RECUE'),0) from dl),
    'livraisons_a_repartir', (select count(*) from dl where status = 'RECUE' and abs(alloc - coalesce(delivered_kg,0)) > 0.5),
    'livraisons_tracables', (select count(*) from dl where status = 'RECUE' and abs(alloc - coalesce(delivered_kg,0)) <= 0.5),
    'target_mt', (select sum(cc.target_mt) from public.aflp_coop_campaigns cc join coops c on c.id = cc.cooperative_id where cc.campaign = v_campaign),
    'par_cooperative', (select coalesce(jsonb_agg(x order by x->>'code'), '[]'::jsonb) from (
        select jsonb_build_object('cooperative_id', c.id, 'code', c.code, 'name', c.name, 'statut', c.aflp_status, 'cluster', c.cluster_code,
          'producteurs', (select count(*) from f where f.cooperative_id = c.id),
          'verifies', (select count(*) from f where f.cooperative_id = c.id and f.verified),
          'completude', (select round(avg(completeness_pct)) from f where f.cooperative_id = c.id),
          'achats_kg', (select coalesce(sum(b.poids_net),0) from buys b join f on f.id = b.producteur_id where f.cooperative_id = c.id),
          'livre_kg', (select coalesce(sum(delivered_kg) filter (where status = 'RECUE'),0) from dl where dl.cooperative_id = c.id),
          'a_repartir', (select count(*) from dl where dl.cooperative_id = c.id and status = 'RECUE' and abs(alloc - coalesce(delivered_kg,0)) > 0.5),
          'target_mt', (select cc.target_mt from public.aflp_coop_campaigns cc where cc.cooperative_id = c.id and cc.campaign = v_campaign)) x
        from coops c) z),
    'par_cluster', (select coalesce(jsonb_agg(y order by y->>'cluster'), '[]'::jsonb) from (
        select jsonb_build_object('cluster', coalesce(cluster_code,'—'), 'zone', coalesce(zone_code,'—'), 'producteurs', count(*),
               'direct_rt', count(*) filter (where not is_coop), 'cooperative', count(*) filter (where is_coop)) y
        from f group by cluster_code, zone_code) z2)
  ) into res;
  return res;
end $$;

-- ------------------------------------------------------------------- durcissement
-- Fonctions de trigger du module : jamais appelées directement par un client.
do $$ declare f text; begin
  foreach f in array array['private.aflp_achat_canal()','private.aflp_alloc_audit()','private.aflp_alloc_guard()',
    'private.aflp_coop_audit_trigger()','private.aflp_coop_guard_direction()','private.aflp_dlv_guard()',
    'private.aflp_coop_block_delete()','private.aflp_coop_set_code()','private.aflp_coop_touch()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.aflp_coop_report(jsonb), public.aflp_coop_plan_delivery(jsonb),
                       public.aflp_channel_totals(text, boolean) from public, anon;
grant execute on function public.aflp_coop_report(jsonb), public.aflp_coop_plan_delivery(jsonb),
                          public.aflp_channel_totals(text, boolean) to authenticated;

commit;
