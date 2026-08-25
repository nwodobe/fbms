-- AFLP Farmer Registry - Sustainability Dashboard v1
-- Applied to Supabase PROD on 2026-08-25.

create or replace view public.farmer_sustainability_dashboard_v
with (security_invoker = true)
as
select
  zone_code,
  zone_label,
  cluster_code,
  cluster_label,
  village_id,
  village_nom,
  rt_id,
  rt_code,
  rt_nom,
  count(*) filter (where not deleted)::integer as producers_registered,
  count(*) filter (where not deleted and operational_status='ACTIVE')::integer as active_producers,
  count(*) filter (where not deleted and passport_stage='BASIC')::integer as passport_basic,
  count(*) filter (where not deleted and passport_stage='MAPPED')::integer as passport_mapped,
  count(*) filter (where not deleted and passport_stage='BASELINE')::integer as passport_baseline,
  count(*) filter (where not deleted and passport_stage='VERIFIED')::integer as passport_verified,
  round(avg(passport_completion) filter (where not deleted),1) as average_passport_completion,
  coalesce(sum(plot_count) filter (where not deleted),0)::integer as plots_registered,
  coalesce(sum(gps_mapped_count) filter (where not deleted),0)::integer as gps_points_captured,
  coalesce(sum(gps_verified_count) filter (where not deleted),0)::integer as gps_verified_points,
  count(*) filter (where not deleted and gps_mapped_count=0)::integer as farmers_gps_missing,
  coalesce(sum(declared_area_ha) filter (where not deleted),0::numeric) as hectares_declared,
  coalesce(sum(gps_verified_area_ha) filter (where not deleted),0::numeric) as hectares_gps_verified,
  count(*) filter (where not deleted and production_baseline_count>0)::integer as production_baseline_completed,
  count(*) filter (where not deleted and sustainability_baseline_count>0)::integer as sustainability_baseline_completed,
  count(*) filter (where not deleted and risk_profile='LOW')::integer as risk_low,
  count(*) filter (where not deleted and risk_profile='MEDIUM')::integer as risk_medium,
  count(*) filter (where not deleted and risk_profile='HIGH')::integer as risk_high,
  count(*) filter (where not deleted and risk_profile='REVIEW_REQUIRED')::integer as risk_review_required,
  count(*) filter (where not deleted and risk_profile='NOT_ASSESSED')::integer as risk_not_assessed,
  coalesce(sum(open_action_count) filter (where not deleted),0)::integer as actions_open,
  coalesce(sum(overdue_action_count) filter (where not deleted),0)::integer as actions_overdue,
  coalesce(sum(critical_action_count) filter (where not deleted),0)::integer as actions_critical,
  count(*) filter (where not deleted and training_count>0)::integer as trained_farmers
from public.farmer_passport_summary_v
group by zone_code,zone_label,cluster_code,cluster_label,village_id,village_nom,rt_id,rt_code,rt_nom;

revoke all on public.farmer_sustainability_dashboard_v from anon;
grant select on public.farmer_sustainability_dashboard_v to authenticated;
