-- =============================================================================
-- AFLP FARMER REGISTRY — INDEXES DE MONTÉE EN CHARGE
-- À appliquer après les migrations Farmer Registry complet.
-- =============================================================================

begin;

create index if not exists farmer_action_plans_baseline_idx
  on public.farmer_action_plans(baseline_id)
  where baseline_id is not null;

create index if not exists farmer_action_plans_inspection_idx
  on public.farmer_action_plans(inspection_id)
  where inspection_id is not null;

create index if not exists farmer_action_plans_plot_idx
  on public.farmer_action_plans(plot_id)
  where plot_id is not null;

create index if not exists farmer_inspections_plot_idx
  on public.farmer_inspections(plot_id)
  where plot_id is not null;

create index if not exists farmer_production_supersedes_idx
  on public.farmer_production_baselines(supersedes_id)
  where supersedes_id is not null;

create index if not exists farmer_sustainability_plot_idx
  on public.farmer_sustainability_baselines(plot_id)
  where plot_id is not null;

create index if not exists farmer_sustainability_supersedes_idx
  on public.farmer_sustainability_baselines(supersedes_id)
  where supersedes_id is not null;

create index if not exists farmer_verifications_plot_idx
  on public.farmer_verifications(plot_id)
  where plot_id is not null;

create index if not exists farmer_visits_checkin_idx
  on public.farmer_visits(checkin_id)
  where checkin_id is not null;

create index if not exists farmer_visits_mission_idx
  on public.farmer_visits(mission_id)
  where mission_id is not null;

create index if not exists farmer_visits_plot_idx
  on public.farmer_visits(plot_id)
  where plot_id is not null;

-- Ces deux indexes étaient redondants : les contraintes uniques couvrent déjà
-- leur première colonne et répondent aux recherches par parent.
drop index if exists public.farmer_sust_answers_baseline_idx;
drop index if exists public.farmer_inspection_answers_inspection_idx;

commit;
