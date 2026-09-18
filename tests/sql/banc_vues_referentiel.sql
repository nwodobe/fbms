-- BANC NAVIGATEUR UNIQUEMENT : vues de referentiel simplifiees (memes colonnes
-- que la production) pour que les ecrans se chargent. Elles ne participent a
-- AUCUN controle d'acces Sacherie. security_invoker : RLS des tables sources.
create or replace view public.villages_light_v with (security_invoker=true) as
  select id, village, null::text region, null::text departement, cluster, cluster_code, statut, 0::int score,
         null::numeric gps_lat, null::numeric gps_lng, null::text farmer_code_prefix, deleted, data from public.villages;
create or replace view public.rt_light_v with (security_invoker=true) as
  select id, id_rt, nom, telephone, village_id, village_nom, cluster, statut, score, deleted, data from public.rt;
create or replace view public.farmer_passport_summary_v with (security_invoker=true) as
  select p.id producteur_id, p.id farmer_id, p.nom, null::text prenoms, null::text telephone, p.village_id, p.village_nom,
         p.rt_id, null::text rt_code, null::text rt_nom, null::text cluster_code, null::text cluster_label, null::text zone_code,
         null::text zone_label, 'ACTIVE'::text operational_status, 'BASIC'::text passport_stage, 0::smallint passport_completion,
         'NOT_ASSESSED'::text risk_profile, 'NOT_RECORDED'::text consent_status, null::timestamptz consent_date, false possible_duplicate,
         false review_required, null::text review_reason, 1::bigint record_version, p.updated_at, p.deleted, 0 plot_count,
         0::numeric declared_area_ha, 0 gps_mapped_count, 0 gps_verified_count, 0::numeric gps_verified_area_ha, 0 production_baseline_count,
         null::text production_campaign, null::numeric latest_yield_kg_ha, 0 sustainability_baseline_count,
         null::timestamptz latest_sustainability_date, null::text latest_sustainability_risk, 0 training_count, null::date last_training_date,
         0 inspection_count, null::date last_inspection_date, 0 open_action_count, 0 overdue_action_count, 0 critical_action_count,
         null::date last_purchase_date, null::numeric last_purchase_kg, null::numeric last_purchase_amount, 0 bag_movement_count,
         0 visit_count, null::timestamptz last_visit_date
  from public.producteurs p;
create or replace view public.field_traceability_completeness_v with (security_invoker=true) as
  select a.id achat_id, a.local_id achat_local_id, a.date achat_date, a.producteur_id, a.producteur_id farmer_id, a.producteur_nom,
         a.village_id, a.village_nom, a.cluster, a.rt_id, a.rt_nom, a.poids_net, 0::numeric lot_allocated_kg, 0 rcn_bag_count,
         0::numeric rcn_bag_weight_kg, 'NA'::text parcel_trace_status, 0 plot_count, 0::numeric plot_allocated_kg, 0::bigint chain_lot_count,
         0::bigint shipment_count, 0::bigint reception_count, 0::bigint factory_lot_count, 'NA'::text farmer_status, 'NA'::text lot_trace_status,
         'NA'::text bag_trace_status, 'NA'::text shipment_trace_status, 'NA'::text reception_trace_status, 'NA'::text factory_lot_trace_status,
         0 completeness_score_2027, null::text next_action, 'NA'::text overall_status, a.created_at
  from public.achats a;
create policy banc_villages_read on public.villages for select to authenticated using (true);
create policy banc_producteurs_read on public.producteurs for select to authenticated using (true);
create policy banc_avances_read on public.avances for select to authenticated using (true);
create policy banc_achats_read on public.achats for select to authenticated using (true);
grant select on public.villages_light_v, public.rt_light_v, public.farmer_passport_summary_v, public.field_traceability_completeness_v to authenticated;
insert into public.villages(id,data,village,cluster,cluster_code,statut) values ('V-TB1','{}','Village test Botro','BOTRO','BOTRO','Approuvé BM'),('V-TD1','{}','Village test Diabo','DIABO','DIABO','Approuvé BM');
notify pgrst, 'reload schema';
