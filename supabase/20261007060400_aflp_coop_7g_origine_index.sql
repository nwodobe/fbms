-- AFLP 2027 · Coopératives · 7g/7h — origine de livraison jamais déduite ; index de la file À vérifier.
-- Appliqué en production sous aflp_coop_7g_origine_livraison_non_deduite et aflp_coop_7h_index_revue_producteur.
-- 7g : la livraison ne garde que l'origine saisie (avant : repli sur la localité de la coopérative).
--      Le repli reste limité à l'arrivage Procurement, dont le contrat exige une origine.

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

-- 7h
create index if not exists aflp_rev_resolved_prod_idx on public.aflp_coop_enrollment_reviews(resolved_producer_id) where resolved_producer_id is not null;

-- 7i / 7j (appliqués en production : aflp_coop_7i_correspondance_nom_prenoms, aflp_coop_7j_nom_seul_indice_faible)
-- La version finale de private.aflp_match_core est dans 20261007060100_aflp_coop_7_enrolement_fonctions.sql :
--   7i : farmer_registry_norm_text supprime les espaces ; la règle « nom + prénoms » testait la présence
--        d'un espace dans le nom normalisé et ne se déclenchait donc jamais. Elle teste désormais la
--        présence de prénoms dans la saisie brute (régression détectée par la recette 11d).
--   7j : le nom de famille seul dans le même village n'est un indice de doublon que si les prénoms
--        manquent d'un côté ; deux prénoms renseignés et différents désignent deux personnes.
