-- =============================================================================
-- ANAGROCI FBMS / AFLP FARMER REGISTRY COMPLET
-- Parcelles · GPS · Production · Sustainability · Inspections · Actions
-- Date : 2026-08-18
-- Pré-requis : Farmer Registry Phase 1 déjà appliqué.
-- Migration additive. Aucun DROP TABLE, aucun TRUNCATE, aucune réactivation.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. PARCELLES ET GPS
-- -----------------------------------------------------------------------------
create table if not exists public.farmer_plots (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  village_id text not null references public.villages(id) on update cascade on delete restrict,
  local_name text,
  declared_area numeric(12,3),
  area_unit text not null default 'HA',
  land_tenure_status text not null default 'UNKNOWN',
  orchard_age_years numeric(6,2),
  tree_count integer,
  productive_tree_count integer,
  latitude numeric(10,7),
  longitude numeric(10,7),
  gps_accuracy_m numeric(10,2),
  gps_captured_at timestamptz,
  gps_captured_by uuid,
  gps_status text not null default 'NOT_MAPPED',
  gps_verified_area numeric(12,3),
  geometry_geojson jsonb,
  area_source text not null default 'DECLARED',
  evidence_level text not null default 'DECLARED',
  notes text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted boolean not null default false,
  record_version bigint not null default 1,
  constraint farmer_plots_area_chk check (declared_area is null or declared_area > 0),
  constraint farmer_plots_verified_area_chk check (gps_verified_area is null or gps_verified_area > 0),
  constraint farmer_plots_tree_count_chk check (tree_count is null or tree_count >= 0),
  constraint farmer_plots_productive_tree_count_chk check (productive_tree_count is null or productive_tree_count >= 0),
  constraint farmer_plots_tree_coherence_chk check (tree_count is null or productive_tree_count is null or productive_tree_count <= tree_count),
  constraint farmer_plots_area_unit_chk check (area_unit in ('HA','M2','ACRE','OTHER')),
  constraint farmer_plots_tenure_chk check (land_tenure_status in ('OWNER','FAMILY','LEASED','BORROWED','CUSTOMARY','SHARED','UNKNOWN','OTHER')),
  constraint farmer_plots_gps_status_chk check (gps_status in ('NOT_MAPPED','POINT_CAPTURED','GPS_VERIFIED','REJECTED')),
  constraint farmer_plots_area_source_chk check (area_source in ('DECLARED','OBSERVED','DOCUMENTED','GPS_ESTIMATED','GPS_VERIFIED')),
  constraint farmer_plots_evidence_chk check (evidence_level in ('DECLARED','OBSERVED','DOCUMENTED','GPS_VERIFIED','AUDITED')),
  constraint farmer_plots_status_chk check (status in ('ACTIVE','INACTIVE','REVIEW_REQUIRED')),
  constraint farmer_plots_coordinates_chk check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint farmer_plots_gps_metadata_chk check (
    gps_status in ('NOT_MAPPED','REJECTED')
    or (latitude is not null and longitude is not null and gps_accuracy_m > 0 and gps_captured_at is not null)
  ),
  constraint farmer_plots_geometry_chk check (geometry_geojson is null or jsonb_typeof(geometry_geojson)='object')
);
create index if not exists farmer_plots_producteur_idx on public.farmer_plots(producteur_id) where not deleted;
create index if not exists farmer_plots_village_idx on public.farmer_plots(village_id) where not deleted;
create index if not exists farmer_plots_gps_status_idx on public.farmer_plots(gps_status) where not deleted;

-- -----------------------------------------------------------------------------
-- 2. BASELINE PRODUCTION
-- -----------------------------------------------------------------------------
create table if not exists public.farmer_production_baselines (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  campaign text not null,
  version integer not null default 0,
  productive_area_ha numeric(12,3),
  previous_production_kg numeric(14,3),
  forecast_kg numeric(14,3),
  productive_tree_count integer,
  previous_sales_channel text,
  already_anagroci_supplier boolean,
  data_source text not null default 'FIELD_DECLARATION',
  evidence_level text not null default 'DECLARED',
  status text not null default 'DRAFT',
  captured_at timestamptz not null default now(),
  captured_by uuid not null default auth.uid(),
  finalized_at timestamptz,
  finalized_by uuid,
  supersedes_id uuid references public.farmer_production_baselines(id) on update cascade on delete set null,
  notes text,
  yield_kg_ha numeric(14,3) generated always as (
    case when productive_area_ha is not null and productive_area_ha > 0 and previous_production_kg is not null
      then round(previous_production_kg / productive_area_ha,3) else null end
  ) stored,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  record_version bigint not null default 1,
  constraint farmer_production_campaign_chk check (btrim(campaign)<>''),
  constraint farmer_production_values_chk check (
    (productive_area_ha is null or productive_area_ha>0)
    and (previous_production_kg is null or previous_production_kg>=0)
    and (forecast_kg is null or forecast_kg>=0)
    and (productive_tree_count is null or productive_tree_count>=0)
  ),
  constraint farmer_production_evidence_chk check (evidence_level in ('DECLARED','OBSERVED','DOCUMENTED','CALCULATED','VERIFIED','AUDITED')),
  constraint farmer_production_status_chk check (status in ('DRAFT','FINAL','CANCELLED')),
  unique(producteur_id,campaign,version)
);
create index if not exists farmer_production_producteur_idx on public.farmer_production_baselines(producteur_id,campaign,version desc);
create index if not exists farmer_production_final_idx on public.farmer_production_baselines(producteur_id,finalized_at desc) where status='FINAL';

-- -----------------------------------------------------------------------------
-- 3. CATALOGUE SUSTAINABILITY ET BASELINES
-- -----------------------------------------------------------------------------
create table if not exists public.sustainability_question_catalog (
  question_code text not null,
  catalog_version text not null,
  domain text not null,
  sequence_no integer not null,
  label_fr text not null,
  label_en text,
  guidance_fr text,
  required boolean not null default true,
  risk_trigger_answers text[] not null default '{}'::text[],
  risk_level text not null default 'NONE',
  default_corrective_action text,
  default_priority text not null default 'MEDIUM',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(question_code,catalog_version),
  constraint sustainability_catalog_domain_chk check (domain in ('AGRICULTURAL_PRACTICES','ENVIRONMENT','PHYTOSANITARY_MANAGEMENT','SOCIAL_SAFETY')),
  constraint sustainability_catalog_risk_chk check (risk_level in ('NONE','MEDIUM','HIGH','REVIEW_REQUIRED')),
  constraint sustainability_catalog_priority_chk check (default_priority in ('LOW','MEDIUM','HIGH','CRITICAL'))
);

insert into public.sustainability_question_catalog
(question_code,catalog_version,domain,sequence_no,label_fr,label_en,guidance_fr,required,risk_trigger_answers,risk_level,default_corrective_action,default_priority)
values
('A01','AFLP-SUST-2026.1','AGRICULTURAL_PRACTICES',1,'Le verger est-il entretenu ?','Is the orchard maintained?','Observer l’enherbement, les accès et l’état général.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Établir et exécuter un calendrier d’entretien du verger.','MEDIUM'),
('A02','AFLP-SUST-2026.1','AGRICULTURAL_PRACTICES',2,'La taille des arbres est-elle pratiquée ?','Is pruning practiced?','Vérifier les traces de taille et la compréhension de la pratique.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Former le producteur à la taille et planifier une démonstration pratique.','MEDIUM'),
('A03','AFLP-SUST-2026.1','AGRICULTURAL_PRACTICES',3,'Les branches mortes sont-elles gérées ?','Are dead branches managed?','Observer les branches mortes au sol ou dans les arbres.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Retirer les branches mortes selon les bonnes pratiques.','MEDIUM'),
('A04','AFLP-SUST-2026.1','AGRICULTURAL_PRACTICES',4,'La zone de récolte est-elle préparée ?','Is the harvest area prepared?','Observer le sol sous les arbres et les obstacles.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Préparer et nettoyer la zone de récolte avant la campagne.','MEDIUM'),
('A05','AFLP-SUST-2026.1','AGRICULTURAL_PRACTICES',5,'La circulation sous les arbres est-elle adéquate ?','Is circulation under trees adequate?','Vérifier l’accès pour la récolte et l’entretien.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Dégager les passages nécessaires sans dégrader le sol.','LOW'),
('A06','AFLP-SUST-2026.1','AGRICULTURAL_PRACTICES',6,'Le sol est-il visible et prêt pour la récolte ?','Is the soil visible and harvest-ready?','Apprécier la préparation utile à la récolte sans favoriser l’érosion.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Adapter le nettoyage du sol en limitant l’érosion.','LOW'),
('B01','AFLP-SUST-2026.1','ENVIRONMENT',7,'Existe-t-il des preuves de brûlage non contrôlé ?','Is there evidence of uncontrolled burning?','Observer les zones brûlées et recueillir des faits.',true,array['YES','UNKNOWN','NOT_VERIFIED'],'REVIEW_REQUIRED','Arrêter le brûlage non contrôlé et documenter les mesures de prévention.','CRITICAL'),
('B02','AFLP-SUST-2026.1','ENVIRONMENT',8,'Un pare-feu fonctionnel est-il présent ?','Is a functional firebreak present?','Vérifier la présence, la largeur et l’entretien.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'HIGH','Créer ou réhabiliter un pare-feu adapté.','HIGH'),
('B03','AFLP-SUST-2026.1','ENVIRONMENT',9,'Une érosion visible est-elle observée ?','Is visible erosion observed?','Observer ravines, ruissellement et perte de sol.',true,array['YES','PARTIAL','UNKNOWN','NOT_VERIFIED'],'HIGH','Mettre en place des mesures de lutte antiérosive.','HIGH'),
('B04','AFLP-SUST-2026.1','ENVIRONMENT',10,'Des pratiques de protection du sol sont-elles appliquées ?','Are soil protection practices applied?','Paillage, couverture ou autres pratiques adaptées.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Introduire au moins une pratique de protection du sol.','MEDIUM'),
('B05','AFLP-SUST-2026.1','ENVIRONMENT',11,'Le producteur connaît-il les mesures de protection des pollinisateurs ?','Does the farmer know pollinator protection measures?','Questionner sur floraison, produits et heures de traitement.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Former le producteur à la protection des pollinisateurs.','MEDIUM'),
('B06','AFLP-SUST-2026.1','ENVIRONMENT',12,'Les résidus agricoles sont-ils gérés de manière appropriée ?','Are agricultural residues appropriately managed?','Observer stockage, compostage, brûlage ou abandon.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Définir une méthode sûre de gestion des résidus.','MEDIUM'),
('C01','AFLP-SUST-2026.1','PHYTOSANITARY_MANAGEMENT',13,'Des pesticides sont-ils utilisés sur l’exploitation ?','Are pesticides used on the farm?','Réponse factuelle ; YES n’est pas automatiquement une non-conformité.',true,array[]::text[],'NONE',null,'LOW'),
('C02','AFLP-SUST-2026.1','PHYTOSANITARY_MANAGEMENT',14,'Le producteur connaît-il les produits autorisés ou recommandés ?','Does the farmer know authorized products?','Demander le nom du produit ou vérifier le contenant.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'HIGH','Former le producteur aux produits autorisés.','HIGH'),
('C03','AFLP-SUST-2026.1','PHYTOSANITARY_MANAGEMENT',15,'Des équipements de protection individuelle sont-ils disponibles ?','Is PPE available?','Vérifier les équipements réellement disponibles.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'HIGH','Mettre à disposition les EPI requis.','HIGH'),
('C04','AFLP-SUST-2026.1','PHYTOSANITARY_MANAGEMENT',16,'Les équipements de protection sont-ils effectivement utilisés ?','Is PPE actually used?','Distinguer déclaration et observation.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'HIGH','Former et contrôler l’utilisation effective des EPI.','HIGH'),
('C05','AFLP-SUST-2026.1','PHYTOSANITARY_MANAGEMENT',17,'Des pulvérisations sont-elles réalisées pendant la floraison ?','Is spraying performed during flowering?','Question factuelle liée au risque pollinisateurs.',true,array['YES','UNKNOWN','NOT_VERIFIED'],'REVIEW_REQUIRED','Suspendre les traitements incompatibles avec la floraison.','CRITICAL'),
('C06','AFLP-SUST-2026.1','PHYTOSANITARY_MANAGEMENT',18,'Les emballages de pesticides sont-ils réutilisés ?','Are pesticide containers reused?','Vérifier les usages des contenants.',true,array['YES','UNKNOWN','NOT_VERIFIED'],'REVIEW_REQUIRED','Cesser la réutilisation et organiser une élimination sûre.','CRITICAL'),
('C07','AFLP-SUST-2026.1','PHYTOSANITARY_MANAGEMENT',19,'Les produits phytosanitaires sont-ils stockés de façon sûre ?','Are crop protection products stored safely?','Vérifier séparation, fermeture et accès enfants.',true,array['NO','PARTIAL','UNKNOWN','NOT_VERIFIED'],'HIGH','Aménager un stockage fermé et sécurisé.','HIGH'),
('D01','AFLP-SUST-2026.1','SOCIAL_SAFETY',20,'La main-d’œuvre familiale participe-t-elle aux activités ?','Is family labour involved?','Réponse factuelle servant de contexte.',true,array[]::text[],'NONE',null,'LOW'),
('D02','AFLP-SUST-2026.1','SOCIAL_SAFETY',21,'Une main-d’œuvre saisonnière est-elle employée ?','Is seasonal labour employed?','Réponse factuelle servant de contexte.',true,array[]::text[],'NONE',null,'LOW'),
('D03','AFLP-SUST-2026.1','SOCIAL_SAFETY',22,'Des personnes de moins de 18 ans participent-elles aux activités ?','Are persons under 18 involved?','Préciser les tâches, l’âge et la fréquence.',true,array['YES','UNKNOWN','NOT_VERIFIED'],'MEDIUM','Documenter les tâches et vérifier leur caractère léger et sûr.','HIGH'),
('D04','AFLP-SUST-2026.1','SOCIAL_SAFETY',23,'Des mineurs participent-ils à des activités dangereuses ?','Are minors involved in hazardous activities?','Inclure produits chimiques, charges, hauteur, machines et outils dangereux.',true,array['YES','UNKNOWN','NOT_VERIFIED'],'REVIEW_REQUIRED','Retirer immédiatement les mineurs des activités dangereuses.','CRITICAL'),
('D05','AFLP-SUST-2026.1','SOCIAL_SAFETY',24,'Un risque d’exposition chimique des travailleurs est-il présent ?','Is there a chemical exposure risk?','Évaluer manipulation, stockage et pulvérisation.',true,array['YES','PARTIAL','UNKNOWN','NOT_VERIFIED'],'REVIEW_REQUIRED','Éliminer l’exposition non maîtrisée et fournir les EPI.','CRITICAL'),
('D06','AFLP-SUST-2026.1','SOCIAL_SAFETY',25,'Un incident de sécurité a-t-il été observé ou déclaré ?','Has a safety incident been observed?','Documenter les faits, la date et les suites.',true,array['YES','UNKNOWN','NOT_VERIFIED'],'HIGH','Documenter l’incident et traiter sa cause.','HIGH')
on conflict(question_code,catalog_version) do update set
  domain=excluded.domain,sequence_no=excluded.sequence_no,label_fr=excluded.label_fr,
  label_en=excluded.label_en,guidance_fr=excluded.guidance_fr,required=excluded.required,
  risk_trigger_answers=excluded.risk_trigger_answers,risk_level=excluded.risk_level,
  default_corrective_action=excluded.default_corrective_action,
  default_priority=excluded.default_priority,active=true,updated_at=now();

create table if not exists public.farmer_sustainability_baselines (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  plot_id uuid references public.farmer_plots(id) on update cascade on delete set null,
  campaign text not null,
  catalog_version text not null default 'AFLP-SUST-2026.1',
  version integer not null default 0,
  status text not null default 'DRAFT',
  inspection_date date not null default current_date,
  answered_count integer not null default 0,
  required_count integer not null default 0,
  risk_profile text not null default 'NOT_ASSESSED',
  risk_reasons jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now(),
  captured_by uuid not null default auth.uid(),
  finalized_at timestamptz,
  finalized_by uuid,
  supersedes_id uuid references public.farmer_sustainability_baselines(id) on update cascade on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  record_version bigint not null default 1,
  constraint farmer_sust_campaign_chk check (btrim(campaign)<>''),
  constraint farmer_sust_status_chk check (status in ('DRAFT','FINAL','CANCELLED')),
  constraint farmer_sust_risk_chk check (risk_profile in ('NOT_ASSESSED','LOW','MEDIUM','HIGH','REVIEW_REQUIRED')),
  constraint farmer_sust_reasons_chk check (jsonb_typeof(risk_reasons)='array')
);
create unique index if not exists farmer_sust_version_uidx on public.farmer_sustainability_baselines(producteur_id,campaign,coalesce(plot_id::text,''),version);
create index if not exists farmer_sust_producteur_idx on public.farmer_sustainability_baselines(producteur_id,campaign,version desc);

create table if not exists public.farmer_sustainability_answers (
  id uuid primary key default gen_random_uuid(),
  baseline_id uuid not null references public.farmer_sustainability_baselines(id) on update cascade on delete restrict,
  question_code text not null,
  catalog_version text not null,
  answer text not null,
  evidence_level text not null default 'DECLARED',
  observation text,
  proof_id uuid references public.preuves(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  record_version bigint not null default 1,
  constraint farmer_sust_answer_value_chk check (answer in ('YES','NO','PARTIAL','UNKNOWN','NOT_VERIFIED','NOT_APPLICABLE')),
  constraint farmer_sust_answer_evidence_chk check (evidence_level in ('DECLARED','OBSERVED','DOCUMENTED','GPS_VERIFIED','AUDITED')),
  constraint farmer_sust_answer_catalog_fk foreign key(question_code,catalog_version)
    references public.sustainability_question_catalog(question_code,catalog_version) on update cascade on delete restrict,
  unique(baseline_id,question_code)
);
create index if not exists farmer_sust_answers_baseline_idx on public.farmer_sustainability_answers(baseline_id);

-- -----------------------------------------------------------------------------
-- 4. INSPECTIONS, ACTIONS, VISITES ET VÉRIFICATIONS
-- -----------------------------------------------------------------------------
create table if not exists public.farmer_inspections (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  plot_id uuid references public.farmer_plots(id) on update cascade on delete set null,
  inspection_type text not null default 'FOLLOW_UP',
  inspection_date date not null default current_date,
  catalog_version text not null default 'AFLP-SUST-2026.1',
  inspector_id uuid not null default auth.uid(),
  inspector_name text,
  latitude numeric(10,7),longitude numeric(10,7),gps_accuracy_m numeric(10,2),
  status text not null default 'DRAFT',
  risk_profile text not null default 'NOT_ASSESSED',
  risk_reasons jsonb not null default '[]'::jsonb,
  notes text,finalized_at timestamptz,finalized_by uuid,
  created_at timestamptz not null default now(),created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),updated_by uuid default auth.uid(),record_version bigint not null default 1,
  constraint farmer_inspection_type_chk check (inspection_type in ('BASELINE_CHECK','FOLLOW_UP','VERIFICATION','INCIDENT','CORRECTIVE_ACTION_REVIEW')),
  constraint farmer_inspection_status_chk check (status in ('DRAFT','FINAL','CANCELLED')),
  constraint farmer_inspection_risk_chk check (risk_profile in ('NOT_ASSESSED','LOW','MEDIUM','HIGH','REVIEW_REQUIRED')),
  constraint farmer_inspection_coordinates_chk check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180 and gps_accuracy_m>0))
);
create index if not exists farmer_inspections_producteur_idx on public.farmer_inspections(producteur_id,inspection_date desc);

create table if not exists public.farmer_inspection_answers (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.farmer_inspections(id) on update cascade on delete restrict,
  question_code text not null,catalog_version text not null,answer text not null,
  evidence_level text not null default 'OBSERVED',observation text,
  proof_id uuid references public.preuves(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),updated_by uuid default auth.uid(),record_version bigint not null default 1,
  constraint farmer_inspection_answer_value_chk check (answer in ('YES','NO','PARTIAL','UNKNOWN','NOT_VERIFIED','NOT_APPLICABLE')),
  constraint farmer_inspection_answer_evidence_chk check (evidence_level in ('DECLARED','OBSERVED','DOCUMENTED','GPS_VERIFIED','AUDITED')),
  constraint farmer_inspection_answer_catalog_fk foreign key(question_code,catalog_version)
    references public.sustainability_question_catalog(question_code,catalog_version) on update cascade on delete restrict,
  unique(inspection_id,question_code)
);
create index if not exists farmer_inspection_answers_inspection_idx on public.farmer_inspection_answers(inspection_id);

create table if not exists public.farmer_action_plans (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  plot_id uuid references public.farmer_plots(id) on update cascade on delete set null,
  baseline_id uuid references public.farmer_sustainability_baselines(id) on update cascade on delete set null,
  inspection_id uuid references public.farmer_inspections(id) on update cascade on delete set null,
  question_code text,category text not null,issue text not null,corrective_action text not null,
  responsible_user_id uuid,responsible_name text,due_date date,
  status text not null default 'OPEN',priority text not null default 'MEDIUM',
  created_at timestamptz not null default now(),created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),updated_by uuid default auth.uid(),
  closed_at timestamptz,closed_by uuid,evidence_id uuid references public.preuves(id) on update cascade on delete set null,
  reviewer_id uuid,reviewer_name text,record_version bigint not null default 1,
  constraint farmer_action_status_chk check (status in ('OPEN','IN_PROGRESS','CLOSED','OVERDUE','CANCELLED')),
  constraint farmer_action_priority_chk check (priority in ('LOW','MEDIUM','HIGH','CRITICAL'))
);
create unique index if not exists farmer_action_source_question_uidx on public.farmer_action_plans(coalesce(baseline_id,inspection_id),question_code) where question_code is not null and status<>'CANCELLED';
create index if not exists farmer_action_producteur_idx on public.farmer_action_plans(producteur_id,status,due_date);

create table if not exists public.farmer_visits (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  plot_id uuid references public.farmer_plots(id) on update cascade on delete set null,
  mission_id uuid references public.missions(id) on update cascade on delete set null,
  checkin_id uuid references public.checkins(id) on update cascade on delete set null,
  visit_type text not null default 'FOLLOW_UP',visit_date timestamptz not null default now(),
  agent_id uuid not null default auth.uid(),agent_name text,
  latitude numeric(10,7),longitude numeric(10,7),gps_accuracy_m numeric(10,2),
  purpose text,outcome text,next_action text,notes text,
  created_at timestamptz not null default now(),created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),updated_by uuid default auth.uid(),record_version bigint not null default 1,
  constraint farmer_visit_type_chk check (visit_type in ('ENROLLMENT','PLOT_MAPPING','BASELINE','TRAINING_FOLLOW_UP','INSPECTION','CORRECTIVE_ACTION','FOLLOW_UP','OTHER')),
  constraint farmer_visit_coordinates_chk check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180 and gps_accuracy_m>0))
);
create index if not exists farmer_visits_producteur_idx on public.farmer_visits(producteur_id,visit_date desc);

create table if not exists public.farmer_verifications (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  plot_id uuid references public.farmer_plots(id) on update cascade on delete set null,
  status text not null,verification_method text not null,checks jsonb not null default '{}'::jsonb,
  evidence_id uuid references public.preuves(id) on update cascade on delete set null,notes text,
  verified_at timestamptz not null default now(),verified_by uuid not null default auth.uid(),verifier_name text,
  created_at timestamptz not null default now(),created_by uuid not null default auth.uid(),
  constraint farmer_verification_status_chk check (status in ('APPROVED','REJECTED','REVOKED')),
  constraint farmer_verification_method_chk check (verification_method in ('FIELD_REVIEW','DOCUMENT_REVIEW','AUDIT','SUPERVISOR_REVIEW')),
  constraint farmer_verification_checks_chk check (jsonb_typeof(checks)='object')
);
create index if not exists farmer_verifications_producteur_idx on public.farmer_verifications(producteur_id,verified_at desc);

alter table public.participants_formation add column if not exists attendance_status text not null default 'PRESENT';
alter table public.participants_formation add column if not exists competency_topic text;
alter table public.participants_formation add column if not exists location text;
alter table public.participants_formation add column if not exists evidence_id uuid references public.preuves(id) on update cascade on delete set null;
alter table public.participants_formation add column if not exists created_at timestamptz not null default now();
alter table public.participants_formation add column if not exists created_by uuid default auth.uid();

-- La stratégie de fichiers utilise le bucket privé terrain-preuves.
alter table public.preuves drop constraint if exists preuves_entite_type_check;
alter table public.preuves add constraint preuves_entite_type_check check (entite_type in (
  'checkin','session_formation','depense','enrolement','mission','producteur','farmer_plot',
  'farmer_production_baseline','farmer_sustainability_baseline','farmer_inspection',
  'farmer_action_plan','farmer_visit','farmer_verification'
));
alter table public.preuves drop constraint if exists preuves_type_preuve_check;
alter table public.preuves add constraint preuves_type_preuve_check check (type_preuve in (
  'photo','signature','document','gps','consent','inspection','corrective_action_evidence',
  'training_evidence','identity_evidence','other'
));
create index if not exists preuves_entite_idx on public.preuves(entite_type,entite_id,horodatage_serveur desc);

-- -----------------------------------------------------------------------------
-- 5. RÔLES SPÉCIFIQUES FARMER REGISTRY
-- -----------------------------------------------------------------------------
create or replace function private.farmer_registry_can_capture()
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists(select 1 from public.profils p where p.user_id=auth.uid() and p.actif=true and p.role in (
    'Branch Manager','Branch Manager / Head of Programme','Assistant Branch Manager','Head of Field',
    'Procurement Officer','Zonal Head','Unit Head','Assistant Unit Head','Supervisor','Agent Recenseur',
    'Chef d''equipe','Chef d''équipe'))
$$;
create or replace function private.farmer_registry_can_supervise()
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists(select 1 from public.profils p where p.user_id=auth.uid() and p.actif=true and p.role in (
    'Branch Manager','Branch Manager / Head of Programme','Assistant Branch Manager','Head of Field',
    'Procurement Officer','Zonal Head','Unit Head','Supervisor','Admin','Administrateur'))
$$;
create or replace function private.farmer_registry_can_read_sensitive()
returns boolean language sql stable security definer set search_path=public,private as $$
  select private.farmer_registry_can_capture() or private.farmer_registry_can_supervise()
$$;
create or replace function private.farmer_registry_can_access_plot(p_plot_id uuid)
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists(select 1 from public.farmer_plots fp where fp.id=p_plot_id and private.farmer_registry_can_access_producteur(fp.producteur_id))
$$;
create or replace function private.farmer_registry_can_access_sustainability_baseline(p_baseline_id uuid)
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists(select 1 from public.farmer_sustainability_baselines b where b.id=p_baseline_id and private.farmer_registry_can_access_producteur(b.producteur_id))
$$;
create or replace function private.farmer_registry_can_access_inspection(p_inspection_id uuid)
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists(select 1 from public.farmer_inspections i where i.id=p_inspection_id and private.farmer_registry_can_access_producteur(i.producteur_id))
$$;

-- -----------------------------------------------------------------------------
-- 6. RÈGLES SERVEUR ET HISTORISATION
-- -----------------------------------------------------------------------------
create or replace function public.farmer_registry_risk_rank(p_risk text)
returns integer language sql immutable set search_path=public as $$
  select case p_risk when 'REVIEW_REQUIRED' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 when 'LOW' then 1 else 0 end
$$;
create or replace function public.farmer_registry_max_risk(p_first text,p_second text)
returns text language sql immutable set search_path=public as $$
  select case when public.farmer_registry_risk_rank(p_first)>=public.farmer_registry_risk_rank(p_second)
    then coalesce(p_first,'NOT_ASSESSED') else coalesce(p_second,'NOT_ASSESSED') end
$$;
create or replace function public.farmer_registry_touch_child_row()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at:=now();new.updated_by:=auth.uid();
  if tg_op='UPDATE' then new.record_version:=coalesce(old.record_version,0)+1;
  else new.record_version:=greatest(coalesce(new.record_version,1),1);end if;
  return new;
end $$;

create or replace function public.farmer_registry_prepare_plot()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_village_id text;v_gps_changed boolean:=false;
begin
  select p.village_id into v_village_id from public.producteurs p where p.id=new.producteur_id and not p.deleted;
  if v_village_id is null then raise exception 'Producteur absent ou supprimé.';end if;
  if new.village_id is distinct from v_village_id then raise exception 'La parcelle doit appartenir au village du producteur.';end if;
  if not private.farmer_registry_can_access_producteur(new.producteur_id) then raise exception 'Parcelle hors périmètre utilisateur.';end if;
  v_gps_changed:=tg_op='INSERT' or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude
    or new.gps_accuracy_m is distinct from old.gps_accuracy_m or new.gps_captured_at is distinct from old.gps_captured_at;
  if new.latitude is not null and new.longitude is not null then
    new.gps_captured_at:=coalesce(new.gps_captured_at,now());
    if v_gps_changed then new.gps_captured_by:=auth.uid();elsif tg_op='UPDATE' then new.gps_captured_by:=old.gps_captured_by;end if;
    if new.gps_status='NOT_MAPPED' then new.gps_status:='POINT_CAPTURED';end if;
  elsif new.gps_status in ('POINT_CAPTURED','GPS_VERIFIED') then raise exception 'Coordonnées GPS et métadonnées obligatoires.';end if;
  if new.gps_status='GPS_VERIFIED' and (tg_op='INSERT' or old.gps_status is distinct from 'GPS_VERIFIED')
    and not private.farmer_registry_can_supervise() then raise exception 'La vérification GPS est réservée à la supervision.';end if;
  if new.gps_verified_area is not null and new.gps_status<>'GPS_VERIFIED' then raise exception 'Une superficie GPS vérifiée exige GPS_VERIFIED.';end if;
  return new;
end $$;

create or replace function public.farmer_registry_prepare_production_baseline()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_previous public.farmer_production_baselines%rowtype;
begin
  if not private.farmer_registry_can_access_producteur(new.producteur_id) then raise exception 'Baseline production hors périmètre.';end if;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('production:'||new.producteur_id||':'||new.campaign,0));
    new.captured_by:=auth.uid();
    if new.version is null or new.version<=0 then select coalesce(max(version),0)+1 into new.version from public.farmer_production_baselines where producteur_id=new.producteur_id and campaign=new.campaign;end if;
    if new.supersedes_id is null then select * into v_previous from public.farmer_production_baselines where producteur_id=new.producteur_id and campaign=new.campaign and status='FINAL' order by version desc,created_at desc limit 1;new.supersedes_id:=v_previous.id;end if;
  else
    new.captured_by:=old.captured_by;
    if old.status='FINAL' and to_jsonb(new)-array['updated_at','updated_by','record_version'] is distinct from to_jsonb(old)-array['updated_at','updated_by','record_version'] then raise exception 'Une baseline production finalisée est immuable.';end if;
  end if;
  if new.status='FINAL' and (new.productive_area_ha is null or new.previous_production_kg is null or new.forecast_kg is null) then raise exception 'Données obligatoires manquantes.';end if;
  return new;
end $$;

create or replace function public.farmer_registry_prepare_sustainability_baseline()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_plot_owner text;v_previous public.farmer_sustainability_baselines%rowtype;
begin
  if not private.farmer_registry_can_access_producteur(new.producteur_id) then raise exception 'Baseline Sustainability hors périmètre.';end if;
  if new.plot_id is not null then select producteur_id into v_plot_owner from public.farmer_plots where id=new.plot_id and not deleted;if v_plot_owner is distinct from new.producteur_id then raise exception 'Parcelle incohérente.';end if;end if;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('sustainability:'||new.producteur_id||':'||new.campaign||':'||coalesce(new.plot_id::text,''),0));
    new.captured_by:=auth.uid();
    if new.version is null or new.version<=0 then select coalesce(max(version),0)+1 into new.version from public.farmer_sustainability_baselines where producteur_id=new.producteur_id and campaign=new.campaign and plot_id is not distinct from new.plot_id;end if;
    if new.supersedes_id is null then select * into v_previous from public.farmer_sustainability_baselines where producteur_id=new.producteur_id and campaign=new.campaign and plot_id is not distinct from new.plot_id and status='FINAL' order by version desc,created_at desc limit 1;new.supersedes_id:=v_previous.id;end if;
  else
    new.captured_by:=old.captured_by;
    if old.status='FINAL' and to_jsonb(new)-array['updated_at','updated_by','record_version'] is distinct from to_jsonb(old)-array['updated_at','updated_by','record_version'] then raise exception 'Une baseline Sustainability finalisée est immuable.';end if;
  end if;return new;
end $$;

create or replace function public.farmer_registry_prepare_sustainability_answer()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_baseline public.farmer_sustainability_baselines%rowtype;
begin
  select * into v_baseline from public.farmer_sustainability_baselines where id=new.baseline_id;
  if v_baseline.id is null then raise exception 'Baseline introuvable.';end if;
  if v_baseline.status<>'DRAFT' then raise exception 'Réponses immuables après finalisation.';end if;
  if new.catalog_version is distinct from v_baseline.catalog_version then raise exception 'Version catalogue incohérente.';end if;
  if not private.farmer_registry_can_access_producteur(v_baseline.producteur_id) then raise exception 'Réponse hors périmètre.';end if;
  return new;
end $$;

create or replace function public.farmer_registry_prepare_inspection()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_plot_owner text;
begin
  if not private.farmer_registry_can_access_producteur(new.producteur_id) then raise exception 'Inspection hors périmètre.';end if;
  if new.plot_id is not null then select producteur_id into v_plot_owner from public.farmer_plots where id=new.plot_id and not deleted;if v_plot_owner is distinct from new.producteur_id then raise exception 'Parcelle incohérente.';end if;end if;
  if tg_op='UPDATE' and old.status='FINAL' and to_jsonb(new)-array['updated_at','updated_by','record_version'] is distinct from to_jsonb(old)-array['updated_at','updated_by','record_version'] then raise exception 'Inspection finalisée immuable.';end if;
  if tg_op='INSERT' then new.inspector_id:=auth.uid();else new.inspector_id:=old.inspector_id;end if;return new;
end $$;

create or replace function public.farmer_registry_prepare_inspection_answer()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_inspection public.farmer_inspections%rowtype;
begin
  select * into v_inspection from public.farmer_inspections where id=new.inspection_id;
  if v_inspection.id is null then raise exception 'Inspection introuvable.';end if;
  if v_inspection.status<>'DRAFT' then raise exception 'Réponses immuables après finalisation.';end if;
  if new.catalog_version is distinct from v_inspection.catalog_version then raise exception 'Version catalogue incohérente.';end if;
  if not private.farmer_registry_can_access_producteur(v_inspection.producteur_id) then raise exception 'Réponse hors périmètre.';end if;return new;
end $$;

create or replace function public.farmer_registry_prepare_action_plan()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if not private.farmer_registry_can_access_producteur(new.producteur_id) then raise exception 'Action hors périmètre.';end if;
  if new.status in ('CLOSED','CANCELLED') and not private.farmer_registry_can_supervise() then raise exception 'Clôture ou annulation réservée à la supervision.';end if;
  if new.status='CLOSED' then
    if new.evidence_id is null then raise exception 'Preuve obligatoire pour clôturer.';end if;
    new.closed_at:=coalesce(new.closed_at,now());new.closed_by:=coalesce(new.closed_by,auth.uid());new.reviewer_id:=coalesce(new.reviewer_id,auth.uid());
  else new.closed_at:=null;new.closed_by:=null;end if;
  if new.status in ('OPEN','IN_PROGRESS') and new.due_date is not null and new.due_date<current_date then new.status:='OVERDUE';end if;return new;
end $$;

create or replace function public.farmer_registry_prepare_visit()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_plot_owner text;
begin
  if not private.farmer_registry_can_access_producteur(new.producteur_id) then raise exception 'Visite hors périmètre.';end if;
  if new.plot_id is not null then select producteur_id into v_plot_owner from public.farmer_plots where id=new.plot_id and not deleted;if v_plot_owner is distinct from new.producteur_id then raise exception 'Parcelle incohérente.';end if;end if;
  if tg_op='INSERT' then new.agent_id:=auth.uid();else new.agent_id:=old.agent_id;end if;return new;
end $$;

create or replace function public.farmer_registry_prepare_verification()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_stage text;v_open_critical integer;v_plot_owner text;
begin
  if not private.farmer_registry_can_supervise() then raise exception 'Vérification réservée à la supervision.';end if;
  if not private.farmer_registry_can_access_producteur(new.producteur_id) then raise exception 'Vérification hors périmètre.';end if;
  if new.plot_id is not null then select producteur_id into v_plot_owner from public.farmer_plots where id=new.plot_id and not deleted;if v_plot_owner is distinct from new.producteur_id then raise exception 'Parcelle incohérente.';end if;end if;
  if new.status='APPROVED' then
    select passport_stage into v_stage from public.producteurs where id=new.producteur_id;
    if v_stage not in ('BASELINE','VERIFIED') then raise exception 'Le passeport doit atteindre BASELINE.';end if;
    if not(coalesce((new.checks->>'identity_checked')::boolean,false) and coalesce((new.checks->>'plot_checked')::boolean,false) and coalesce((new.checks->>'baseline_checked')::boolean,false)) then raise exception 'Contrôles obligatoires manquants.';end if;
    select count(*) into v_open_critical from public.farmer_action_plans where producteur_id=new.producteur_id and priority='CRITICAL' and status in ('OPEN','IN_PROGRESS','OVERDUE');
    if v_open_critical>0 then raise exception 'Impossible de vérifier avec une action critique ouverte.';end if;
  end if;new.verified_by:=auth.uid();return new;
end $$;

create or replace function public.farmer_registry_refresh_passport(p_producteur_id text)
returns void language plpgsql security definer set search_path=public,private as $$
declare
  p public.producteurs%rowtype;c public.farmer_consents%rowtype;
  v_identity int:=0;v_assignment int:=0;v_consent int:=0;v_plots int:=0;v_gps int:=0;v_production int:=0;v_sustainability int:=0;
  v_total int:=0;v_stage text:='INCOMPLETE';v_risk text:='NOT_ASSESSED';v_sust_risk text:='NOT_ASSESSED';v_consent_status text:='NOT_RECORDED';
  v_plot_count int:=0;v_gps_count int:=0;v_production_count int:=0;v_sust_count int:=0;v_open_critical int:=0;v_open_high int:=0;v_verification_status text;
begin
  select * into p from public.producteurs where id=p_producteur_id;if p.id is null then return;end if;
  select * into c from public.farmer_consents where producteur_id=p_producteur_id order by event_order desc limit 1;
  if nullif(btrim(p.nom),'') is not null and p.sexe is not null and (p.birth_year is not null or nullif(btrim(p.age_band),'') is not null) and length(public.farmer_registry_norm_phone(p.telephone))=10 then v_identity:=30;end if;
  if p.village_id is not null and p.rt_id is not null then v_assignment:=20;end if;
  if c.id is not null then v_consent_status:=c.status;if c.status='GRANTED' then v_consent:=15;elsif c.status='PARTIAL' then v_consent:=8;end if;end if;
  select count(*) into v_plot_count from public.farmer_plots where producteur_id=p_producteur_id and not deleted and status='ACTIVE';if v_plot_count>0 then v_plots:=10;end if;
  select count(*) into v_gps_count from public.farmer_plots where producteur_id=p_producteur_id and not deleted and status='ACTIVE' and gps_status in ('POINT_CAPTURED','GPS_VERIFIED');if v_gps_count>0 then v_gps:=10;end if;
  select count(*) into v_production_count from public.farmer_production_baselines where producteur_id=p_producteur_id and status='FINAL';if v_production_count>0 then v_production:=10;end if;
  select count(*) into v_sust_count from public.farmer_sustainability_baselines where producteur_id=p_producteur_id and status='FINAL';
  if v_sust_count>0 then v_sustainability:=5;select risk_profile into v_sust_risk from public.farmer_sustainability_baselines where producteur_id=p_producteur_id and status='FINAL' order by finalized_at desc nulls last,version desc,created_at desc limit 1;end if;
  v_total:=v_identity+v_assignment+v_consent+v_plots+v_gps+v_production+v_sustainability;
  if v_identity=30 and v_assignment=20 and v_consent_status='GRANTED' then v_stage:='BASIC';end if;
  if v_stage='BASIC' and v_plot_count>0 and v_gps_count>0 then v_stage:='MAPPED';end if;
  if v_stage='MAPPED' and v_production_count>0 and v_sust_count>0 then v_stage:='BASELINE';end if;
  select status into v_verification_status from public.farmer_verifications where producteur_id=p_producteur_id order by verified_at desc,created_at desc limit 1;
  if v_stage='BASELINE' and v_verification_status='APPROVED' then v_stage:='VERIFIED';end if;
  v_risk:=coalesce(v_sust_risk,'NOT_ASSESSED');if p.review_required or p.possible_duplicate or v_consent_status in ('PARTIAL','REFUSED','WITHDRAWN') then v_risk:='REVIEW_REQUIRED';end if;
  select count(*) filter(where priority='CRITICAL'),count(*) filter(where priority='HIGH') into v_open_critical,v_open_high from public.farmer_action_plans where producteur_id=p_producteur_id and status in ('OPEN','IN_PROGRESS','OVERDUE');
  if v_open_critical>0 then v_risk:='REVIEW_REQUIRED';elsif v_open_high>0 then v_risk:=public.farmer_registry_max_risk(v_risk,'HIGH');end if;
  update public.producteurs set passport_completion=v_total,passport_stage=v_stage,risk_profile=v_risk,
    consent_status=v_consent_status,consent_date=case when c.id is null then null else c.consent_at end,
    consent_version=case when c.id is null then null else c.text_version end,consent_method=case when c.id is null then null else c.method end
  where id=p_producteur_id and (passport_completion is distinct from v_total or passport_stage is distinct from v_stage or risk_profile is distinct from v_risk or consent_status is distinct from v_consent_status);
end $$;

create or replace function public.farmer_registry_refresh_child_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_producteur_id text;
begin v_producteur_id:=coalesce(to_jsonb(new)->>'producteur_id',to_jsonb(old)->>'producteur_id');if v_producteur_id is not null then perform public.farmer_registry_refresh_passport(v_producteur_id);end if;if tg_op='DELETE' then return old;end if;return new;end $$;

-- -----------------------------------------------------------------------------
-- 7. FINALISATION TRANSACTIONNELLE
-- -----------------------------------------------------------------------------
create or replace function public.farmer_finalize_production_baseline(p_baseline_id uuid)
returns public.farmer_production_baselines language plpgsql security definer set search_path=public,private as $$
declare v_row public.farmer_production_baselines%rowtype;
begin
  select * into v_row from public.farmer_production_baselines where id=p_baseline_id for update;
  if v_row.id is null then raise exception 'Baseline production introuvable.';end if;
  if not private.farmer_registry_can_capture() or not private.farmer_registry_can_access_producteur(v_row.producteur_id) then raise exception 'Finalisation non autorisée.';end if;
  if v_row.status='FINAL' then return v_row;end if;if v_row.status<>'DRAFT' then raise exception 'Seule une baseline DRAFT peut être finalisée.';end if;
  if v_row.productive_area_ha is null or v_row.previous_production_kg is null or v_row.forecast_kg is null then raise exception 'Données obligatoires manquantes.';end if;
  update public.farmer_production_baselines set status='FINAL',finalized_at=now(),finalized_by=auth.uid() where id=p_baseline_id returning * into v_row;
  perform public.farmer_registry_refresh_passport(v_row.producteur_id);return v_row;
end $$;

create or replace function public.farmer_finalize_sustainability_baseline(p_baseline_id uuid)
returns public.farmer_sustainability_baselines language plpgsql security definer set search_path=public,private as $$
declare v_row public.farmer_sustainability_baselines%rowtype;v_required int;v_answered int;v_risk text:='LOW';v_reasons jsonb:='[]';r record;v_existing uuid;v_due date;
begin
  select * into v_row from public.farmer_sustainability_baselines where id=p_baseline_id for update;
  if v_row.id is null then raise exception 'Baseline Sustainability introuvable.';end if;
  if not private.farmer_registry_can_capture() or not private.farmer_registry_can_access_producteur(v_row.producteur_id) then raise exception 'Finalisation non autorisée.';end if;
  if v_row.status='FINAL' then return v_row;end if;if v_row.status<>'DRAFT' then raise exception 'Seule une baseline DRAFT peut être finalisée.';end if;
  select count(*) into v_required from public.sustainability_question_catalog where catalog_version=v_row.catalog_version and active and required;
  select count(distinct a.question_code) into v_answered from public.farmer_sustainability_answers a join public.sustainability_question_catalog q on q.question_code=a.question_code and q.catalog_version=a.catalog_version where a.baseline_id=p_baseline_id and q.active and q.required;
  if v_required=0 or v_answered<v_required then raise exception 'Baseline incomplète : % réponses sur %.',v_answered,v_required;end if;
  for r in select q.*,a.answer,a.observation from public.farmer_sustainability_answers a join public.sustainability_question_catalog q on q.question_code=a.question_code and q.catalog_version=a.catalog_version where a.baseline_id=p_baseline_id and a.answer=any(q.risk_trigger_answers) order by q.sequence_no loop
    v_risk:=public.farmer_registry_max_risk(v_risk,r.risk_level);v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('question_code',r.question_code,'domain',r.domain,'answer',r.answer,'risk_level',r.risk_level,'label',r.label_fr,'observation',r.observation));
    if r.default_corrective_action is not null then
      select id into v_existing from public.farmer_action_plans where baseline_id=p_baseline_id and question_code=r.question_code and status<>'CANCELLED' limit 1;
      v_due:=current_date+case r.default_priority when 'CRITICAL' then 7 when 'HIGH' then 14 when 'MEDIUM' then 30 else 60 end;
      if v_existing is null then insert into public.farmer_action_plans(producteur_id,plot_id,baseline_id,question_code,category,issue,corrective_action,responsible_user_id,responsible_name,due_date,status,priority) values(v_row.producteur_id,v_row.plot_id,p_baseline_id,r.question_code,r.domain,r.label_fr||' — réponse : '||r.answer,r.default_corrective_action,auth.uid(),public.fbms_email(),v_due,'OPEN',r.default_priority);
      else update public.farmer_action_plans set issue=r.label_fr||' — réponse : '||r.answer,corrective_action=r.default_corrective_action,priority=r.default_priority,due_date=coalesce(due_date,v_due) where id=v_existing;end if;
    end if;
  end loop;
  update public.farmer_sustainability_baselines set status='FINAL',required_count=v_required,answered_count=v_answered,risk_profile=v_risk,risk_reasons=v_reasons,finalized_at=now(),finalized_by=auth.uid() where id=p_baseline_id returning * into v_row;
  perform public.farmer_registry_refresh_passport(v_row.producteur_id);return v_row;
end $$;

create or replace function public.farmer_finalize_inspection(p_inspection_id uuid)
returns public.farmer_inspections language plpgsql security definer set search_path=public,private as $$
declare v_row public.farmer_inspections%rowtype;v_required int;v_answered int;v_risk text:='LOW';v_reasons jsonb:='[]';r record;v_existing uuid;v_due date;
begin
  select * into v_row from public.farmer_inspections where id=p_inspection_id for update;
  if v_row.id is null then raise exception 'Inspection introuvable.';end if;
  if not private.farmer_registry_can_capture() or not private.farmer_registry_can_access_producteur(v_row.producteur_id) then raise exception 'Finalisation non autorisée.';end if;
  if v_row.status='FINAL' then return v_row;end if;if v_row.status<>'DRAFT' then raise exception 'Seule une inspection DRAFT peut être finalisée.';end if;
  select count(*) into v_required from public.sustainability_question_catalog where catalog_version=v_row.catalog_version and active and required;
  select count(distinct a.question_code) into v_answered from public.farmer_inspection_answers a join public.sustainability_question_catalog q on q.question_code=a.question_code and q.catalog_version=a.catalog_version where a.inspection_id=p_inspection_id and q.active and q.required;
  if v_answered<v_required then raise exception 'Inspection incomplète : % réponses sur %.',v_answered,v_required;end if;
  for r in select q.*,a.answer,a.observation from public.farmer_inspection_answers a join public.sustainability_question_catalog q on q.question_code=a.question_code and q.catalog_version=a.catalog_version where a.inspection_id=p_inspection_id and a.answer=any(q.risk_trigger_answers) order by q.sequence_no loop
    v_risk:=public.farmer_registry_max_risk(v_risk,r.risk_level);v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('question_code',r.question_code,'domain',r.domain,'answer',r.answer,'risk_level',r.risk_level,'label',r.label_fr));
    if r.default_corrective_action is not null then
      select id into v_existing from public.farmer_action_plans where inspection_id=p_inspection_id and question_code=r.question_code and status<>'CANCELLED' limit 1;
      v_due:=current_date+case r.default_priority when 'CRITICAL' then 7 when 'HIGH' then 14 when 'MEDIUM' then 30 else 60 end;
      if v_existing is null then insert into public.farmer_action_plans(producteur_id,plot_id,inspection_id,question_code,category,issue,corrective_action,responsible_user_id,responsible_name,due_date,status,priority) values(v_row.producteur_id,v_row.plot_id,p_inspection_id,r.question_code,r.domain,r.label_fr||' — réponse : '||r.answer,r.default_corrective_action,auth.uid(),public.fbms_email(),v_due,'OPEN',r.default_priority);end if;
    end if;
  end loop;
  update public.farmer_inspections set status='FINAL',risk_profile=v_risk,risk_reasons=v_reasons,finalized_at=now(),finalized_by=auth.uid() where id=p_inspection_id returning * into v_row;
  if v_risk in ('HIGH','REVIEW_REQUIRED') then update public.producteurs set review_required=true,review_reason=coalesce(nullif(review_reason,''),'Inspection terrain à risque') where id=v_row.producteur_id;end if;
  perform public.farmer_registry_refresh_passport(v_row.producteur_id);return v_row;
end $$;

-- -----------------------------------------------------------------------------
-- 8. TRIGGERS
-- -----------------------------------------------------------------------------
drop trigger if exists trg_farmer_registry_prepare_plot on public.farmer_plots;
create trigger trg_farmer_registry_prepare_plot before insert or update on public.farmer_plots for each row execute function public.farmer_registry_prepare_plot();
drop trigger if exists trg_farmer_registry_touch_plot on public.farmer_plots;
create trigger trg_farmer_registry_touch_plot before insert or update on public.farmer_plots for each row execute function public.farmer_registry_touch_child_row();
drop trigger if exists trg_farmer_registry_prepare_production on public.farmer_production_baselines;
create trigger trg_farmer_registry_prepare_production before insert or update on public.farmer_production_baselines for each row execute function public.farmer_registry_prepare_production_baseline();
drop trigger if exists trg_farmer_registry_touch_production on public.farmer_production_baselines;
create trigger trg_farmer_registry_touch_production before insert or update on public.farmer_production_baselines for each row execute function public.farmer_registry_touch_child_row();
drop trigger if exists trg_farmer_registry_prepare_sustainability on public.farmer_sustainability_baselines;
create trigger trg_farmer_registry_prepare_sustainability before insert or update on public.farmer_sustainability_baselines for each row execute function public.farmer_registry_prepare_sustainability_baseline();
drop trigger if exists trg_farmer_registry_touch_sustainability on public.farmer_sustainability_baselines;
create trigger trg_farmer_registry_touch_sustainability before insert or update on public.farmer_sustainability_baselines for each row execute function public.farmer_registry_touch_child_row();
drop trigger if exists trg_farmer_registry_prepare_sustainability_answer on public.farmer_sustainability_answers;
create trigger trg_farmer_registry_prepare_sustainability_answer before insert or update on public.farmer_sustainability_answers for each row execute function public.farmer_registry_prepare_sustainability_answer();
drop trigger if exists trg_farmer_registry_touch_sustainability_answer on public.farmer_sustainability_answers;
create trigger trg_farmer_registry_touch_sustainability_answer before insert or update on public.farmer_sustainability_answers for each row execute function public.farmer_registry_touch_child_row();
drop trigger if exists trg_farmer_registry_prepare_inspection on public.farmer_inspections;
create trigger trg_farmer_registry_prepare_inspection before insert or update on public.farmer_inspections for each row execute function public.farmer_registry_prepare_inspection();
drop trigger if exists trg_farmer_registry_touch_inspection on public.farmer_inspections;
create trigger trg_farmer_registry_touch_inspection before insert or update on public.farmer_inspections for each row execute function public.farmer_registry_touch_child_row();
drop trigger if exists trg_farmer_registry_prepare_inspection_answer on public.farmer_inspection_answers;
create trigger trg_farmer_registry_prepare_inspection_answer before insert or update on public.farmer_inspection_answers for each row execute function public.farmer_registry_prepare_inspection_answer();
drop trigger if exists trg_farmer_registry_touch_inspection_answer on public.farmer_inspection_answers;
create trigger trg_farmer_registry_touch_inspection_answer before insert or update on public.farmer_inspection_answers for each row execute function public.farmer_registry_touch_child_row();
drop trigger if exists trg_farmer_registry_prepare_action on public.farmer_action_plans;
create trigger trg_farmer_registry_prepare_action before insert or update on public.farmer_action_plans for each row execute function public.farmer_registry_prepare_action_plan();
drop trigger if exists trg_farmer_registry_touch_action on public.farmer_action_plans;
create trigger trg_farmer_registry_touch_action before insert or update on public.farmer_action_plans for each row execute function public.farmer_registry_touch_child_row();
drop trigger if exists trg_farmer_registry_prepare_visit on public.farmer_visits;
create trigger trg_farmer_registry_prepare_visit before insert or update on public.farmer_visits for each row execute function public.farmer_registry_prepare_visit();
drop trigger if exists trg_farmer_registry_touch_visit on public.farmer_visits;
create trigger trg_farmer_registry_touch_visit before insert or update on public.farmer_visits for each row execute function public.farmer_registry_touch_child_row();
drop trigger if exists trg_farmer_registry_prepare_verification on public.farmer_verifications;
create trigger trg_farmer_registry_prepare_verification before insert on public.farmer_verifications for each row execute function public.farmer_registry_prepare_verification();

do $$ declare t text;begin
  foreach t in array array['farmer_plots','farmer_production_baselines','farmer_sustainability_baselines','farmer_sustainability_answers','farmer_inspections','farmer_inspection_answers','farmer_action_plans','farmer_visits','farmer_verifications'] loop
    execute format('drop trigger if exists %I on public.%I','trg_farmer_registry_audit_'||t,t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.farmer_registry_audit_trigger()','trg_farmer_registry_audit_'||t,t);
  end loop;
  foreach t in array array['farmer_plots','farmer_production_baselines','farmer_sustainability_baselines','farmer_action_plans','farmer_verifications'] loop
    execute format('drop trigger if exists %I on public.%I','trg_farmer_registry_refresh_'||t,t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.farmer_registry_refresh_child_trigger()','trg_farmer_registry_refresh_'||t,t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 9. RLS ET PRIVILÈGES
-- -----------------------------------------------------------------------------
alter table public.farmer_plots enable row level security;
alter table public.farmer_production_baselines enable row level security;
alter table public.sustainability_question_catalog enable row level security;
alter table public.farmer_sustainability_baselines enable row level security;
alter table public.farmer_sustainability_answers enable row level security;
alter table public.farmer_inspections enable row level security;
alter table public.farmer_inspection_answers enable row level security;
alter table public.farmer_action_plans enable row level security;
alter table public.farmer_visits enable row level security;
alter table public.farmer_verifications enable row level security;

-- Politiques finales. Les tables GPS exigent can_read_sensitive.
drop policy if exists farmer_plots_select on public.farmer_plots;
create policy farmer_plots_select on public.farmer_plots for select to authenticated using(est_actif() and private.farmer_registry_can_read_sensitive() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_plots_insert on public.farmer_plots;
create policy farmer_plots_insert on public.farmer_plots for insert to authenticated with check(private.farmer_registry_can_capture() and created_by=auth.uid() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_plots_update on public.farmer_plots;
create policy farmer_plots_update on public.farmer_plots for update to authenticated using(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id)) with check(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id));

drop policy if exists farmer_production_select on public.farmer_production_baselines;
create policy farmer_production_select on public.farmer_production_baselines for select to authenticated using(est_actif() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_production_insert on public.farmer_production_baselines;
create policy farmer_production_insert on public.farmer_production_baselines for insert to authenticated with check(private.farmer_registry_can_capture() and created_by=auth.uid() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_production_update on public.farmer_production_baselines;
create policy farmer_production_update on public.farmer_production_baselines for update to authenticated using(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id)) with check(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id));

drop policy if exists sustainability_catalog_select on public.sustainability_question_catalog;
create policy sustainability_catalog_select on public.sustainability_question_catalog for select to authenticated using(est_actif());
drop policy if exists sustainability_catalog_write on public.sustainability_question_catalog;
create policy sustainability_catalog_write on public.sustainability_question_catalog for all to authenticated using(peut_editer_config()) with check(peut_editer_config());

drop policy if exists farmer_sust_baseline_select on public.farmer_sustainability_baselines;
create policy farmer_sust_baseline_select on public.farmer_sustainability_baselines for select to authenticated using(est_actif() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_sust_baseline_insert on public.farmer_sustainability_baselines;
create policy farmer_sust_baseline_insert on public.farmer_sustainability_baselines for insert to authenticated with check(private.farmer_registry_can_capture() and created_by=auth.uid() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_sust_baseline_update on public.farmer_sustainability_baselines;
create policy farmer_sust_baseline_update on public.farmer_sustainability_baselines for update to authenticated using(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id)) with check(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id));

drop policy if exists farmer_sust_answer_select on public.farmer_sustainability_answers;
create policy farmer_sust_answer_select on public.farmer_sustainability_answers for select to authenticated using(est_actif() and private.farmer_registry_can_access_sustainability_baseline(baseline_id));
drop policy if exists farmer_sust_answer_insert on public.farmer_sustainability_answers;
create policy farmer_sust_answer_insert on public.farmer_sustainability_answers for insert to authenticated with check(private.farmer_registry_can_capture() and created_by=auth.uid() and private.farmer_registry_can_access_sustainability_baseline(baseline_id));
drop policy if exists farmer_sust_answer_update on public.farmer_sustainability_answers;
create policy farmer_sust_answer_update on public.farmer_sustainability_answers for update to authenticated using(private.farmer_registry_can_capture() and private.farmer_registry_can_access_sustainability_baseline(baseline_id)) with check(private.farmer_registry_can_capture() and private.farmer_registry_can_access_sustainability_baseline(baseline_id));

drop policy if exists farmer_inspections_select on public.farmer_inspections;
create policy farmer_inspections_select on public.farmer_inspections for select to authenticated using(est_actif() and private.farmer_registry_can_read_sensitive() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_inspections_insert on public.farmer_inspections;
create policy farmer_inspections_insert on public.farmer_inspections for insert to authenticated with check(private.farmer_registry_can_capture() and created_by=auth.uid() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_inspections_update on public.farmer_inspections;
create policy farmer_inspections_update on public.farmer_inspections for update to authenticated using(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id)) with check(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id));

drop policy if exists farmer_inspection_answers_select on public.farmer_inspection_answers;
create policy farmer_inspection_answers_select on public.farmer_inspection_answers for select to authenticated using(est_actif() and private.farmer_registry_can_access_inspection(inspection_id));
drop policy if exists farmer_inspection_answers_insert on public.farmer_inspection_answers;
create policy farmer_inspection_answers_insert on public.farmer_inspection_answers for insert to authenticated with check(private.farmer_registry_can_capture() and created_by=auth.uid() and private.farmer_registry_can_access_inspection(inspection_id));
drop policy if exists farmer_inspection_answers_update on public.farmer_inspection_answers;
create policy farmer_inspection_answers_update on public.farmer_inspection_answers for update to authenticated using(private.farmer_registry_can_capture() and private.farmer_registry_can_access_inspection(inspection_id)) with check(private.farmer_registry_can_capture() and private.farmer_registry_can_access_inspection(inspection_id));

drop policy if exists farmer_actions_select on public.farmer_action_plans;
create policy farmer_actions_select on public.farmer_action_plans for select to authenticated using(est_actif() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_actions_insert on public.farmer_action_plans;
create policy farmer_actions_insert on public.farmer_action_plans for insert to authenticated with check(private.farmer_registry_can_capture() and created_by=auth.uid() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_actions_update on public.farmer_action_plans;
create policy farmer_actions_update on public.farmer_action_plans for update to authenticated using(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id)) with check(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id));

drop policy if exists farmer_visits_select on public.farmer_visits;
create policy farmer_visits_select on public.farmer_visits for select to authenticated using(est_actif() and private.farmer_registry_can_read_sensitive() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_visits_insert on public.farmer_visits;
create policy farmer_visits_insert on public.farmer_visits for insert to authenticated with check(private.farmer_registry_can_capture() and created_by=auth.uid() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_visits_update on public.farmer_visits;
create policy farmer_visits_update on public.farmer_visits for update to authenticated using(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id)) with check(private.farmer_registry_can_capture() and private.farmer_registry_can_access_producteur(producteur_id));

drop policy if exists farmer_verifications_select on public.farmer_verifications;
create policy farmer_verifications_select on public.farmer_verifications for select to authenticated using(est_actif() and private.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_verifications_insert on public.farmer_verifications;
create policy farmer_verifications_insert on public.farmer_verifications for insert to authenticated with check(private.farmer_registry_can_supervise() and created_by=auth.uid() and private.farmer_registry_can_access_producteur(producteur_id));

grant select,insert,update on public.farmer_plots,public.farmer_production_baselines,
  public.sustainability_question_catalog,public.farmer_sustainability_baselines,
  public.farmer_sustainability_answers,public.farmer_inspections,
  public.farmer_inspection_answers,public.farmer_action_plans,public.farmer_visits to authenticated;
grant select,insert on public.farmer_verifications to authenticated;
revoke delete on public.farmer_plots,public.farmer_production_baselines,
  public.farmer_sustainability_baselines,public.farmer_sustainability_answers,
  public.farmer_inspections,public.farmer_inspection_answers,
  public.farmer_action_plans,public.farmer_visits,public.farmer_verifications from authenticated;

grant execute on function public.farmer_finalize_production_baseline(uuid) to authenticated;
grant execute on function public.farmer_finalize_sustainability_baseline(uuid) to authenticated;
grant execute on function public.farmer_finalize_inspection(uuid) to authenticated;

-- Les fonctions trigger ne sont jamais appelables via /rest/v1/rpc.
revoke all on function public.farmer_registry_touch_child_row() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_plot() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_production_baseline() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_sustainability_baseline() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_sustainability_answer() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_inspection() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_inspection_answer() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_action_plan() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_visit() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_verification() from public,anon,authenticated;
revoke all on function public.farmer_registry_refresh_child_trigger() from public,anon,authenticated;
revoke all on function public.farmer_registry_refresh_passport(text) from public,anon,authenticated;

-- -----------------------------------------------------------------------------
-- 10. VUES DE PILOTAGE
-- -----------------------------------------------------------------------------
create or replace view public.farmer_action_plans_effective_v with (security_invoker=true) as
select a.*,case when a.status in ('OPEN','IN_PROGRESS') and a.due_date is not null and a.due_date<current_date then 'OVERDUE' else a.status end as effective_status
from public.farmer_action_plans a;

create or replace view public.farmer_sustainability_current_v with (security_invoker=true) as
select distinct on (b.producteur_id) b.id,b.producteur_id,b.plot_id,b.campaign,b.catalog_version,b.version,b.status,
  b.inspection_date,b.answered_count,b.required_count,b.risk_profile,b.risk_reasons,b.finalized_at,b.finalized_by,b.created_at
from public.farmer_sustainability_baselines b where b.status='FINAL'
order by b.producteur_id,b.finalized_at desc nulls last,b.version desc,b.created_at desc;

create or replace view public.farmer_plot_map_v with (security_invoker=true) as
select fp.id as plot_id,fp.producteur_id,p.code as farmer_id,p.nom,p.prenoms,fp.village_id,fp.local_name,
  fp.declared_area,fp.area_unit,fp.gps_verified_area,fp.latitude,fp.longitude,fp.gps_accuracy_m,
  fp.gps_captured_at,fp.gps_status,fp.geometry_geojson,fp.area_source,fp.evidence_level,fp.status
from public.farmer_plots fp join public.producteurs p on p.id=fp.producteur_id
where not fp.deleted and not p.deleted;

create or replace view public.farmer_passport_summary_v with (security_invoker=true) as
select p.id as producteur_id,p.code as farmer_id,p.nom,p.prenoms,p.telephone,p.village_id,p.village_nom,p.rt_id,
  coalesce(r.id_rt,r.id) as rt_code,coalesce(r.nom,r.data->>'nom') as rt_nom,
  v.cluster_code,coalesce(c.label,v.cluster,v.data->'s1'->>'cluster') as cluster_label,c.zone_code,z.label as zone_label,
  p.operational_status,p.passport_stage,p.passport_completion,p.risk_profile,p.consent_status,p.consent_date,
  p.possible_duplicate,p.review_required,p.review_reason,p.record_version,p.updated_at,p.deleted,
  coalesce(pl.plot_count,0) as plot_count,coalesce(pl.declared_area_ha,0) as declared_area_ha,
  coalesce(pl.gps_mapped_count,0) as gps_mapped_count,coalesce(pl.gps_verified_count,0) as gps_verified_count,
  coalesce(pl.gps_verified_area_ha,0) as gps_verified_area_ha,
  coalesce(pb.production_baseline_count,0) as production_baseline_count,pb.latest_campaign as production_campaign,pb.latest_yield_kg_ha,
  coalesce(sb.sustainability_baseline_count,0) as sustainability_baseline_count,sb.latest_sustainability_date,sb.latest_sustainability_risk,
  coalesce(tr.training_count,0) as training_count,tr.last_training_date,
  coalesce(ins.inspection_count,0) as inspection_count,ins.last_inspection_date,
  coalesce(ac.open_action_count,0) as open_action_count,coalesce(ac.overdue_action_count,0) as overdue_action_count,coalesce(ac.critical_action_count,0) as critical_action_count,
  pu.last_purchase_date,pu.last_purchase_kg,pu.last_purchase_amount,coalesce(bg.bag_movement_count,0) as bag_movement_count,
  coalesce(vs.visit_count,0) as visit_count,vs.last_visit_date
from public.producteurs p
join public.villages v on v.id=p.village_id left join public.rt r on r.id=p.rt_id
left join public.aflp_clusters c on c.code=v.cluster_code left join public.aflp_zones z on z.code=c.zone_code
left join lateral(select count(*)::int plot_count,
  coalesce(sum(case area_unit when 'HA' then declared_area when 'M2' then declared_area/10000 when 'ACRE' then declared_area*0.404686 else 0 end),0) declared_area_ha,
  count(*) filter(where gps_status in ('POINT_CAPTURED','GPS_VERIFIED'))::int gps_mapped_count,
  count(*) filter(where gps_status='GPS_VERIFIED')::int gps_verified_count,
  coalesce(sum(case when gps_status='GPS_VERIFIED' then coalesce(gps_verified_area,0) else 0 end),0) gps_verified_area_ha
  from public.farmer_plots where producteur_id=p.id and not deleted and status='ACTIVE') pl on true
left join lateral(select count(*)::int production_baseline_count,(array_agg(campaign order by finalized_at desc nulls last,version desc))[1] latest_campaign,(array_agg(yield_kg_ha order by finalized_at desc nulls last,version desc))[1] latest_yield_kg_ha from public.farmer_production_baselines where producteur_id=p.id and status='FINAL') pb on true
left join lateral(select count(*)::int sustainability_baseline_count,max(finalized_at) latest_sustainability_date,(array_agg(risk_profile order by finalized_at desc nulls last,version desc))[1] latest_sustainability_risk from public.farmer_sustainability_baselines where producteur_id=p.id and status='FINAL') sb on true
left join lateral(select count(*)::int training_count,max(s.date_session) last_training_date from public.participants_formation pf join public.sessions_formation s on s.id=pf.session_id where pf.producteur_id=p.id) tr on true
left join lateral(select count(*)::int inspection_count,max(inspection_date) last_inspection_date from public.farmer_inspections where producteur_id=p.id and status='FINAL') ins on true
left join lateral(select count(*) filter(where effective_status in ('OPEN','IN_PROGRESS','OVERDUE'))::int open_action_count,count(*) filter(where effective_status='OVERDUE')::int overdue_action_count,count(*) filter(where priority='CRITICAL' and effective_status in ('OPEN','IN_PROGRESS','OVERDUE'))::int critical_action_count from public.farmer_action_plans_effective_v where producteur_id=p.id) ac on true
left join lateral(select max(date) last_purchase_date,(array_agg(poids_net order by date desc,created_at desc))[1] last_purchase_kg,(array_agg(montant order by date desc,created_at desc))[1] last_purchase_amount from public.achats where producteur_id in (p.id,p.code)) pu on true
left join lateral(select count(*)::int bag_movement_count from public.sacs_mouvements where producteur_id in (p.id,p.code)) bg on true
left join lateral(select count(*)::int visit_count,max(visit_date) last_visit_date from public.farmer_visits where producteur_id=p.id) vs on true;

create or replace view public.farmer_registry_dashboard_v with (security_invoker=true) as
select zone_code,zone_label,cluster_code,cluster_label,village_id,village_nom,rt_id,rt_code,rt_nom,
  count(*) filter(where not deleted)::int producers_registered,
  count(*) filter(where not deleted and operational_status='ACTIVE')::int active_producers,
  count(*) filter(where not deleted and passport_stage='BASIC')::int passport_basic,
  count(*) filter(where not deleted and passport_stage='MAPPED')::int passport_mapped,
  count(*) filter(where not deleted and passport_stage='BASELINE')::int passport_baseline,
  count(*) filter(where not deleted and passport_stage='VERIFIED')::int passport_verified,
  round(avg(passport_completion) filter(where not deleted),1) average_passport_completion,
  coalesce(sum(plot_count) filter(where not deleted),0)::int plots_registered,
  coalesce(sum(declared_area_ha) filter(where not deleted),0) hectares_declared,
  coalesce(sum(gps_verified_area_ha) filter(where not deleted),0) hectares_gps_verified,
  count(*) filter(where not deleted and gps_mapped_count=0)::int farmers_gps_missing,
  count(*) filter(where not deleted and production_baseline_count>0)::int production_baseline_completed,
  count(*) filter(where not deleted and sustainability_baseline_count>0)::int sustainability_baseline_completed,
  count(*) filter(where not deleted and training_count>0)::int trained_farmers,
  coalesce(sum(open_action_count) filter(where not deleted),0)::int open_corrective_actions,
  count(*) filter(where not deleted and risk_profile in ('HIGH','REVIEW_REQUIRED'))::int high_risk_farmers,
  count(*) filter(where not deleted and (review_required or risk_profile='REVIEW_REQUIRED'))::int farmers_requiring_review
from public.farmer_passport_summary_v
group by zone_code,zone_label,cluster_code,cluster_label,village_id,village_nom,rt_id,rt_code,rt_nom;

grant select on public.farmer_action_plans_effective_v,public.farmer_sustainability_current_v,
  public.farmer_plot_map_v,public.farmer_passport_summary_v,public.farmer_registry_dashboard_v to authenticated;

commit;
