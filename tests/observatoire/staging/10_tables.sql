create table if not exists aflp_clusters (
  code text not null,
  label text not null,
  zone_code text not null,
  aliases text[] default '{}'::text[] not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists aflp_coop_memberships (
  id uuid default gen_random_uuid() not null,
  producer_id text not null,
  cooperative_id uuid not null,
  campaign text not null,
  section_id uuid,
  member_number text,
  status text default 'ACTIVE'::text not null,
  membership_start date default CURRENT_DATE not null,
  membership_end date,
  is_primary boolean default false not null,
  verified boolean default false not null,
  verification_date date,
  verification_method text,
  verified_by uuid,
  source text default 'MANUEL'::text not null,
  followup_rt_id text,
  notes text,
  created_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone default now() not null,
  updated_by uuid default auth.uid(),
  campaign_id uuid
);
create table if not exists aflp_coop_villages (
  id uuid default gen_random_uuid() not null,
  cooperative_id uuid not null,
  village_id text,
  village_name text,
  section_id uuid,
  declared_producers integer,
  declared_potential_mt numeric,
  leader_name text,
  collection_point_id uuid,
  active boolean default true not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone default now() not null,
  updated_by uuid default auth.uid()
);
create table if not exists aflp_cooperatives (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  acronym text,
  legal_name text,
  org_type text default 'SCOOPS'::text not null,
  registration_no text,
  approval_no text,
  rccm text,
  creation_date date,
  head_office text,
  address text,
  region text,
  departement text,
  sous_prefecture text,
  locality text,
  locality_village_id text,
  gps_lat numeric,
  gps_lng numeric,
  cluster_code text,
  phone text,
  email text,
  declared_members integer,
  aflp_status text default 'PROSPECT'::text not null,
  status_reason text,
  compliance_status text default 'NON_EVALUE'::text not null,
  producer_registry_status text default 'NON_FOURNI'::text not null,
  aflp_join_date date,
  supplier_id uuid,
  notes text,
  is_qa boolean default false not null,
  archived boolean default false not null,
  archived_at timestamp with time zone,
  archived_by uuid,
  archive_reason text,
  created_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone default now() not null,
  updated_by uuid default auth.uid(),
  row_version integer default 1 not null,
  qa_campaign_id uuid
);
create table if not exists aflp_producer_enrollment (
  producer_id text not null,
  enrollment_channel text not null,
  enrolled_by_rt_id text,
  enrolled_cooperative_id uuid,
  enrolled_campaign text,
  source text default 'MANUEL'::text not null,
  enrolled_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid()
);
create table if not exists aflp_zones (
  code text not null,
  label text not null,
  region text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists campaigns (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  year integer not null,
  campaign_type text default 'REAL'::text not null,
  status text default 'DRAFT'::text not null,
  start_date date,
  planned_end_date date,
  actual_end_date date,
  currency text default 'XOF'::text not null,
  country text default 'CI'::text not null,
  season text,
  description text,
  config jsonb default '{}'::jsonb not null,
  copied_from uuid,
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  opened_at timestamp with time zone,
  opened_by uuid,
  closing_started_at timestamp with time zone,
  closing_started_by uuid,
  closed_at timestamp with time zone,
  closed_by uuid,
  closed_with_reserves boolean default false not null,
  archived_at timestamp with time zone,
  archived_by uuid,
  reopened_count integer default 0 not null,
  is_current boolean default false not null,
  is_qa boolean default false not null,
  row_version integer default 1 not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists farmer_action_plans (
  id uuid default gen_random_uuid() not null,
  producteur_id text not null,
  plot_id uuid,
  baseline_id uuid,
  inspection_id uuid,
  question_code text,
  category text not null,
  issue text not null,
  corrective_action text not null,
  responsible_user_id uuid,
  responsible_name text,
  due_date date,
  status text default 'OPEN'::text not null,
  priority text default 'MEDIUM'::text not null,
  created_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid default auth.uid(),
  closed_at timestamp with time zone,
  closed_by uuid,
  evidence_id uuid,
  reviewer_id uuid,
  reviewer_name text,
  record_version bigint default 1 not null
);
create table if not exists farmer_change_log (
  id bigint generated by default as identity not null,
  table_name text not null,
  record_id text not null,
  operation text not null,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid,
  actor_email text,
  actor_role text,
  reason text,
  created_at timestamp with time zone default now() not null
);
create table if not exists farmer_consents (
  id uuid default gen_random_uuid() not null,
  producteur_id text not null,
  status text not null,
  scopes jsonb default '{}'::jsonb not null,
  consent_at timestamp with time zone not null,
  agent_id uuid default auth.uid(),
  agent_name text,
  text_version text not null,
  method text not null,
  proof_id uuid,
  notes text,
  source text default 'FIELD_ENROLLMENT'::text not null,
  supersedes_id uuid,
  created_at timestamp with time zone not null,
  created_by uuid default auth.uid(),
  event_order bigint generated by default as identity not null
);
create table if not exists farmer_identity_documents (
  id uuid default gen_random_uuid() not null,
  producteur_id text not null,
  document_type text,
  document_number text,
  status text default 'ACTIVE'::text not null,
  source text default 'FIELD_ENROLLMENT'::text not null,
  supersedes_id uuid,
  created_at timestamp with time zone not null,
  created_by uuid default auth.uid(),
  event_order bigint generated by default as identity not null
);
create table if not exists farmer_plots (
  id uuid default gen_random_uuid() not null,
  producteur_id text not null,
  village_id text not null,
  local_name text,
  declared_area numeric(12,3),
  area_unit text default 'HA'::text not null,
  land_tenure_status text default 'UNKNOWN'::text not null,
  orchard_age_years numeric(6,2),
  tree_count integer,
  productive_tree_count integer,
  latitude numeric(10,7),
  longitude numeric(10,7),
  gps_accuracy_m numeric(10,2),
  gps_captured_at timestamp with time zone,
  gps_captured_by uuid,
  gps_status text default 'NOT_MAPPED'::text not null,
  gps_verified_area numeric(12,3),
  geometry_geojson jsonb,
  area_source text default 'DECLARED'::text not null,
  evidence_level text default 'DECLARED'::text not null,
  notes text,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid default auth.uid(),
  deleted boolean default false not null,
  record_version bigint default 1 not null
);
create table if not exists farmer_production_baselines (
  id uuid default gen_random_uuid() not null,
  producteur_id text not null,
  campaign text not null,
  version integer default 0 not null,
  productive_area_ha numeric(12,3),
  previous_production_kg numeric(14,3),
  forecast_kg numeric(14,3),
  productive_tree_count integer,
  previous_sales_channel text,
  already_anagroci_supplier boolean,
  data_source text default 'FIELD_DECLARATION'::text not null,
  evidence_level text default 'DECLARED'::text not null,
  status text default 'DRAFT'::text not null,
  captured_at timestamp with time zone default now() not null,
  captured_by uuid default auth.uid() not null,
  finalized_at timestamp with time zone,
  finalized_by uuid,
  supersedes_id uuid,
  notes text,
  yield_kg_ha numeric(14,3),
  created_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid default auth.uid(),
  record_version bigint default 1 not null,
  campaign_id uuid
);
create table if not exists farmer_sustainability_baselines (
  id uuid default gen_random_uuid() not null,
  producteur_id text not null,
  plot_id uuid,
  campaign text not null,
  catalog_version text default 'AFLP-SUST-2026.2'::text not null,
  version integer default 0 not null,
  status text default 'DRAFT'::text not null,
  inspection_date date default CURRENT_DATE not null,
  answered_count integer default 0 not null,
  required_count integer default 0 not null,
  risk_profile text default 'NOT_ASSESSED'::text not null,
  risk_reasons jsonb default '[]'::jsonb not null,
  captured_at timestamp with time zone default now() not null,
  captured_by uuid default auth.uid() not null,
  finalized_at timestamp with time zone,
  finalized_by uuid,
  supersedes_id uuid,
  notes text,
  created_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid default auth.uid(),
  record_version bigint default 1 not null,
  campaign_id uuid
);
create table if not exists farmer_verifications (
  id uuid default gen_random_uuid() not null,
  producteur_id text not null,
  plot_id uuid,
  status text not null,
  verification_method text not null,
  checks jsonb default '{}'::jsonb not null,
  evidence_id uuid,
  notes text,
  verified_at timestamp with time zone default now() not null,
  verified_by uuid default auth.uid() not null,
  verifier_name text,
  created_at timestamp with time zone default now() not null,
  created_by uuid default auth.uid() not null
);
create table if not exists missions (
  id uuid default gen_random_uuid() not null,
  equipe_id uuid not null,
  date_debut date not null,
  date_fin date not null,
  budget_alloue_xof numeric(14,0) default 0 not null,
  objectif_enrolements integer default 0,
  statut text default 'brouillon'::text not null,
  approuve_par uuid,
  approuve_le timestamp with time zone,
  notes text,
  created_by uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted boolean default false not null
);
create table if not exists moto_affectations (
  id uuid default gen_random_uuid() not null,
  moto_id uuid not null,
  beneficiaire_id uuid not null,
  cluster_code text,
  type_affectation text not null,
  statut text default 'ACTIVE'::text not null,
  date_debut date default CURRENT_DATE not null,
  date_fin date,
  compteur_km numeric(10,1),
  pv_document_id uuid,
  permis_verifie boolean default false not null,
  permis_categorie text,
  permis_verifie_par_nom text,
  permis_verifie_at date,
  equipements jsonb default '{}'::jsonb not null,
  motif text,
  cree_par uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null,
  cloture_par uuid,
  cloture_at timestamp with time zone,
  etat_remise_id uuid,
  permis_id uuid
);
create table if not exists moto_mission_photos (
  id uuid default gen_random_uuid() not null,
  mission_id uuid not null,
  moment text not null,
  chemin text not null,
  sha256 text not null,
  taille_octets integer,
  etag text,
  depose_par uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null,
  controle_sha256 text,
  controle_conforme boolean,
  controle_par uuid,
  controle_at timestamp with time zone
);
create table if not exists moto_missions (
  id uuid default gen_random_uuid() not null,
  moto_id uuid not null,
  conducteur_id uuid not null,
  objet text not null,
  objet_detail text,
  destination text not null,
  statut text default 'OUVERTE'::text not null,
  depart_releve_id uuid not null,
  depart_km numeric(10,1) not null,
  depart_at timestamp with time zone not null,
  depart_recu_at timestamp with time zone default now() not null,
  depart_origine text not null,
  depart_lu_km numeric(10,1),
  depart_localite text,
  depart_gps_statut text not null,
  depart_horloge_ecart_s integer,
  depart_client_op_id uuid not null,
  arrivee_releve_id uuid,
  arrivee_km numeric(10,1),
  arrivee_at timestamp with time zone,
  arrivee_recu_at timestamp with time zone,
  arrivee_origine text,
  arrivee_lu_km numeric(10,1),
  arrivee_localite text,
  arrivee_gps_statut text,
  arrivee_horloge_ecart_s integer,
  arrivee_client_op_id uuid,
  annule_par uuid,
  annule_at timestamp with time zone,
  annule_motif text,
  annule_systeme boolean default false not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists moto_motos (
  id uuid default gen_random_uuid() not null,
  code text,
  qr_token uuid default gen_random_uuid() not null,
  marque text,
  modele text,
  annee integer,
  couleur text,
  numero_chassis text,
  numero_moteur text,
  immatriculation text,
  fournisseur text,
  date_reception date,
  cluster_code text,
  zone_code text,
  statut_administratif text default 'EN_ATTENTE'::text not null,
  statut_affectation text default 'NON_AFFECTEE'::text not null,
  statut_technique text default 'A_CONTROLER'::text not null,
  mise_en_service_at timestamp with time zone,
  mise_en_service_par uuid,
  mise_en_service_motif text,
  compteur_actuel_km numeric(10,1),
  observations text,
  actif boolean default true not null,
  row_version integer default 1 not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  situation_parc text default 'RECEPTIONNEE'::text not null,
  origine text default 'NEUVE'::text not null,
  date_acquisition date,
  date_debut_utilisation date,
  date_debut_suivi date,
  historique_note text,
  photo_path text,
  compteur_reception_km numeric(10,1),
  beneficiaire_prevu_id uuid,
  beneficiaire_prevu_libelle text,
  modele_technique_code text,
  modele_technique_par uuid,
  modele_technique_at timestamp with time zone
);
create table if not exists preuves (
  id uuid default gen_random_uuid() not null,
  entite_type text not null,
  entite_id text not null,
  type_preuve text default 'photo'::text not null,
  storage_path text not null,
  gps_lat numeric(9,6),
  gps_lng numeric(9,6),
  horodatage_client timestamp with time zone not null,
  horodatage_serveur timestamp with time zone default now() not null,
  sha256 text,
  created_by uuid default auth.uid() not null
);
create table if not exists procurement_campaigns (
  code text not null,
  starts_on date not null,
  ends_on date not null,
  source text default 'DEFAULT_CALENDAR_YEAR'::text not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists prod_code_seq (
  village_id text not null,
  dernier integer default 0 not null
);
create table if not exists producteurs (
  id text not null,
  data jsonb not null,
  code text,
  nom text,
  telephone text,
  village_id text not null,
  village_nom text,
  rt_id text,
  statut text default 'Identifié'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text,
  updated_by text,
  deleted boolean default false not null,
  mission_id uuid,
  gps_lat numeric(9,6),
  gps_lng numeric(9,6),
  prenoms text,
  sexe text,
  birth_year integer,
  age_band text,
  telephone_alt text,
  preferred_language text,
  id_document_type text,
  id_document_number text,
  operational_status text default 'ACTIVE'::text not null,
  passport_stage text default 'INCOMPLETE'::text not null,
  passport_completion smallint default 0 not null,
  risk_profile text default 'NOT_ASSESSED'::text not null,
  consent_status text default 'NOT_RECORDED'::text not null,
  consent_date timestamp with time zone,
  consent_version text,
  consent_method text,
  possible_duplicate boolean default false not null,
  review_required boolean default false not null,
  review_reason text,
  record_version bigint default 1 not null,
  created_by_user_id uuid default auth.uid(),
  updated_by_user_id uuid default auth.uid(),
  is_qa boolean default false not null,
  qa_campaign_id uuid
);
create table if not exists profils (
  user_id uuid not null,
  email text not null,
  nom text not null,
  role text not null,
  actif boolean default true not null,
  created_at timestamp with time zone default now() not null,
  fonction_operationnelle text,
  cluster text,
  zone text,
  village_id text,
  rt_id text,
  authority_level text,
  permissions jsonb default '[]'::jsonb not null,
  telephone text,
  derniere_connexion timestamp with time zone,
  site_code text,
  warehouse_code text
);
create table if not exists rcn_proc_audit_central (
  id bigint generated by default as identity not null,
  table_name text not null,
  record_id text not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid,
  actor_role text,
  created_at timestamp with time zone default now() not null
);
create table if not exists rt (
  id text not null,
  data jsonb not null,
  nom text,
  telephone text,
  village_id text,
  village_nom text,
  statut text default 'Pressenti'::text not null,
  score integer default 0,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text,
  updated_by text,
  deleted boolean default false not null,
  cluster text,
  id_rt text
);
create table if not exists villages (
  id text not null,
  data jsonb not null,
  village text,
  region text,
  departement text,
  score integer default 0,
  statut text default 'Brouillon'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text,
  updated_by text,
  deleted boolean default false not null,
  cluster text,
  gps_lat numeric(9,6),
  gps_lng numeric(9,6),
  rayon_geofence_m integer default 1500,
  cluster_code text,
  farmer_code_prefix text
);
create table if not exists wms_parameters (
  id uuid default gen_random_uuid() not null,
  key text not null,
  value jsonb not null,
  version integer default 1 not null,
  effective_from timestamp with time zone default now() not null,
  approved_by text,
  reason text,
  active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  governance_status text default 'BROUILLON'::text not null,
  validated_by uuid,
  validated_by_name text,
  validated_at timestamp with time zone,
  validation_reason text
);
create table if not exists wms_receptions (
  id text not null,
  warehouse_id uuid not null,
  truck text not null,
  supplier_name text,
  supplier_code text,
  origin text not null,
  purchase_type text,
  reference text,
  expected_kg numeric,
  expected_bags integer,
  arrival_at timestamp with time zone default now() not null,
  driver text,
  transporter text,
  status text default 'ARRIVED'::text not null,
  decision text,
  decision_comment text,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamp with time zone,
  gross_kg numeric,
  tare_kg numeric,
  net_kg numeric,
  bags integer,
  bags_good integer,
  bags_wet integer,
  bags_torn integer,
  bags_recond integer,
  weighbridge_ticket text,
  delivery_note text,
  warehouse_receipt text,
  offload_start timestamp with time zone,
  offload_end timestamp with time zone,
  offloaded_by uuid,
  offloaded_at timestamp with time zone,
  hold_reason text,
  lot_id text,
  idempotency_key text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone default now() not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  procurement_channel text,
  procurement_source_type text,
  procurement_source_id text,
  field_shipment_id uuid,
  lba_code text,
  ad_hoc boolean default false not null,
  ad_hoc_reason text,
  supplier_id uuid,
  rejection_reason_code text,
  delivery_note_present boolean default false not null,
  doc_derogation_by uuid,
  doc_derogation_by_name text,
  doc_derogation_at timestamp with time zone,
  doc_derogation_reason text,
  campaign_id uuid
);
alter table aflp_clusters add constraint aflp_clusters_code_zone_code_key UNIQUE (code, zone_code);
alter table aflp_clusters add constraint aflp_clusters_pkey PRIMARY KEY (code);
alter table aflp_coop_memberships add constraint aflp_coop_memberships_pkey PRIMARY KEY (id);
alter table aflp_coop_villages add constraint aflp_coop_villages_pkey PRIMARY KEY (id);
alter table aflp_cooperatives add constraint aflp_cooperatives_code_key UNIQUE (code);
alter table aflp_cooperatives add constraint aflp_cooperatives_supplier_id_key UNIQUE (supplier_id);
alter table aflp_cooperatives add constraint aflp_cooperatives_pkey PRIMARY KEY (id);
alter table aflp_producer_enrollment add constraint aflp_producer_enrollment_pkey PRIMARY KEY (producer_id);
alter table aflp_zones add constraint aflp_zones_pkey PRIMARY KEY (code);
alter table campaigns add constraint campaigns_code_key UNIQUE (code);
alter table campaigns add constraint campaigns_pkey PRIMARY KEY (id);
alter table farmer_action_plans add constraint farmer_action_plans_pkey PRIMARY KEY (id);
alter table farmer_change_log add constraint farmer_change_log_pkey PRIMARY KEY (id);
alter table farmer_consents add constraint farmer_consents_pkey PRIMARY KEY (id);
alter table farmer_identity_documents add constraint farmer_identity_documents_pkey PRIMARY KEY (id);
alter table farmer_plots add constraint farmer_plots_pkey PRIMARY KEY (id);
alter table farmer_production_baselines add constraint farmer_production_baselines_producteur_id_campaign_version_key UNIQUE (producteur_id, campaign, version);
alter table farmer_production_baselines add constraint farmer_production_baselines_pkey PRIMARY KEY (id);
alter table farmer_sustainability_baselines add constraint farmer_sustainability_baselines_pkey PRIMARY KEY (id);
alter table farmer_verifications add constraint farmer_verifications_pkey PRIMARY KEY (id);
alter table missions add constraint missions_pkey PRIMARY KEY (id);
alter table moto_affectations add constraint moto_affectations_pkey PRIMARY KEY (id);
alter table moto_mission_photos add constraint moto_mission_photos_etag_key UNIQUE (etag);
alter table moto_mission_photos add constraint moto_mission_photos_sha256_key UNIQUE (sha256);
alter table moto_mission_photos add constraint moto_mission_photos_chemin_key UNIQUE (chemin);
alter table moto_mission_photos add constraint moto_mission_photos_pkey PRIMARY KEY (id);
alter table moto_mission_photos add constraint moto_mission_photos_mission_id_moment_key UNIQUE (mission_id, moment);
alter table moto_missions add constraint moto_missions_arrivee_client_op_id_key UNIQUE (arrivee_client_op_id);
alter table moto_missions add constraint moto_missions_depart_client_op_id_key UNIQUE (depart_client_op_id);
alter table moto_missions add constraint moto_missions_pkey PRIMARY KEY (id);
alter table moto_motos add constraint moto_motos_code_key UNIQUE (code);
alter table moto_motos add constraint moto_motos_qr_token_key UNIQUE (qr_token);
alter table moto_motos add constraint moto_motos_pkey PRIMARY KEY (id);
alter table preuves add constraint preuves_pkey PRIMARY KEY (id);
alter table procurement_campaigns add constraint procurement_campaigns_pkey PRIMARY KEY (code);
alter table prod_code_seq add constraint prod_code_seq_pkey PRIMARY KEY (village_id);
alter table producteurs add constraint producteurs_code_key UNIQUE (code);
alter table producteurs add constraint producteurs_pkey PRIMARY KEY (id);
alter table profils add constraint profils_email_key UNIQUE (email);
alter table profils add constraint profils_pkey PRIMARY KEY (user_id);
alter table rcn_proc_audit_central add constraint rcn_proc_audit_central_pkey PRIMARY KEY (id);
alter table rt add constraint rt_pkey PRIMARY KEY (id);
alter table villages add constraint villages_pkey PRIMARY KEY (id);
alter table wms_parameters add constraint wms_parameters_pkey PRIMARY KEY (id);
alter table wms_receptions add constraint wms_receptions_pkey PRIMARY KEY (id);
alter table wms_receptions add constraint wms_receptions_idempotency_key_key UNIQUE (idempotency_key);
alter table campaigns add constraint campaigns_campaign_type_check CHECK ((campaign_type = ANY (ARRAY['REAL'::text, 'DEMO'::text, 'SIMULATION'::text, 'TRAINING'::text, 'QA'::text])));
alter table campaigns add constraint campaigns_year_check CHECK (((year >= 2020) AND (year <= 2100)));
alter table campaigns add constraint campaigns_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PLANNING'::text, 'READY'::text, 'OPEN'::text, 'CLOSING'::text, 'CLOSED'::text, 'ARCHIVED'::text])));
alter table campaigns add constraint campaigns_name_check CHECK ((length(btrim(name)) >= 3));
alter table campaigns add constraint campaigns_dates_chk CHECK (((planned_end_date IS NULL) OR (start_date IS NULL) OR (planned_end_date >= start_date)));
alter table campaigns add constraint campaigns_code_check CHECK ((code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$'::text));
alter table farmer_plots add constraint farmer_plots_area_unit_chk CHECK ((area_unit = ANY (ARRAY['HA'::text, 'M2'::text, 'ACRE'::text, 'OTHER'::text])));
alter table farmer_plots add constraint farmer_plots_area_chk CHECK (((declared_area IS NULL) OR (declared_area > (0)::numeric)));
alter table farmer_plots add constraint farmer_plots_area_source_chk CHECK ((area_source = ANY (ARRAY['DECLARED'::text, 'OBSERVED'::text, 'DOCUMENTED'::text, 'GPS_ESTIMATED'::text, 'GPS_VERIFIED'::text])));
alter table farmer_plots add constraint farmer_plots_coordinates_chk CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)) AND ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))));
alter table farmer_plots add constraint farmer_plots_evidence_chk CHECK ((evidence_level = ANY (ARRAY['DECLARED'::text, 'OBSERVED'::text, 'DOCUMENTED'::text, 'GPS_VERIFIED'::text, 'AUDITED'::text])));
alter table farmer_plots add constraint farmer_plots_geometry_chk CHECK (((geometry_geojson IS NULL) OR (jsonb_typeof(geometry_geojson) = 'object'::text)));
alter table farmer_plots add constraint farmer_plots_gps_metadata_chk CHECK (((gps_status = 'NOT_MAPPED'::text) OR (gps_status = 'REJECTED'::text) OR ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND (gps_accuracy_m > (0)::numeric) AND (gps_captured_at IS NOT NULL))));
alter table farmer_plots add constraint farmer_plots_gps_status_chk CHECK ((gps_status = ANY (ARRAY['NOT_MAPPED'::text, 'POINT_CAPTURED'::text, 'GPS_VERIFIED'::text, 'REJECTED'::text])));
alter table farmer_plots add constraint farmer_plots_productive_tree_count_chk CHECK (((productive_tree_count IS NULL) OR (productive_tree_count >= 0)));
alter table farmer_plots add constraint farmer_plots_status_chk CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'REVIEW_REQUIRED'::text])));
alter table farmer_plots add constraint farmer_plots_tenure_chk CHECK ((land_tenure_status = ANY (ARRAY['OWNER'::text, 'FAMILY'::text, 'LEASED'::text, 'BORROWED'::text, 'CUSTOMARY'::text, 'SHARED'::text, 'UNKNOWN'::text, 'OTHER'::text])));
alter table farmer_plots add constraint farmer_plots_tree_coherence_chk CHECK (((tree_count IS NULL) OR (productive_tree_count IS NULL) OR (productive_tree_count <= tree_count)));
alter table farmer_plots add constraint farmer_plots_tree_count_chk CHECK (((tree_count IS NULL) OR (tree_count >= 0)));
alter table farmer_plots add constraint farmer_plots_verified_area_chk CHECK (((gps_verified_area IS NULL) OR (gps_verified_area > (0)::numeric)));
alter table missions add constraint missions_budget_alloue_xof_check CHECK ((budget_alloue_xof >= (0)::numeric));
alter table missions add constraint missions_check CHECK ((date_fin >= date_debut));
alter table missions add constraint missions_statut_check CHECK ((statut = ANY (ARRAY['brouillon'::text, 'soumise'::text, 'approuvee'::text, 'en_cours'::text, 'cloturee'::text, 'annulee'::text])));
alter table producteurs add constraint producteurs_birth_year_chk CHECK (((birth_year IS NULL) OR ((birth_year >= 1900) AND (birth_year <= (EXTRACT(year FROM CURRENT_DATE))::integer))));
alter table producteurs add constraint producteurs_consent_status_chk CHECK ((consent_status = ANY (ARRAY['NOT_RECORDED'::text, 'GRANTED'::text, 'PARTIAL'::text, 'REFUSED'::text, 'WITHDRAWN'::text])));
alter table producteurs add constraint producteurs_statut_check CHECK ((statut = ANY (ARRAY['Identifié'::text, 'Enrôlé'::text, 'Actif'::text, 'Inactif'::text])));
alter table producteurs add constraint producteurs_sexe_phase1_chk CHECK (((sexe IS NULL) OR (sexe = ANY (ARRAY['M'::text, 'F'::text, 'OTHER'::text, 'UNKNOWN'::text]))));
alter table producteurs add constraint producteurs_risk_profile_chk CHECK ((risk_profile = ANY (ARRAY['NOT_ASSESSED'::text, 'LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'REVIEW_REQUIRED'::text])));
alter table producteurs add constraint producteurs_phone_format_ck CHECK ((deleted OR (telephone IS NULL) OR (btrim(telephone) = ''::text) OR (regexp_replace(telephone, '[^0-9]'::text, ''::text, 'g'::text) ~ '^0[0-9]{9}$'::text)));
alter table producteurs add constraint producteurs_passport_stage_chk CHECK ((passport_stage = ANY (ARRAY['INCOMPLETE'::text, 'BASIC'::text, 'MAPPED'::text, 'BASELINE'::text, 'VERIFIED'::text])));
alter table producteurs add constraint producteurs_passport_completion_chk CHECK (((passport_completion >= 0) AND (passport_completion <= 100)));
alter table producteurs add constraint producteurs_operational_status_chk CHECK ((operational_status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'SUSPENDED'::text, 'REVIEW_REQUIRED'::text])));
alter table producteurs add constraint producteurs_nom_no_html_ck CHECK ((deleted OR ((COALESCE(nom, ''::text) !~ '[<>]'::text) AND (COALESCE(prenoms, ''::text) !~ '[<>]'::text))));
alter table profils add constraint profils_role_check CHECK ((role = ANY (ARRAY['Branch Manager'::text, 'Assistant Branch Manager'::text, 'Head of Field'::text, 'Procurement Officer'::text, 'Supervisor'::text, 'Agent Recenseur'::text, 'Consultation uniquement'::text, 'General Manager'::text, 'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text, 'RT'::text, 'LBA Purchase Officer'::text, 'Warehouse Manager'::text, 'Storekeeper'::text, 'QA / Lab'::text, 'Factory User'::text, 'Finance'::text, 'Viewer / Auditor'::text, 'Finance Manager'::text, 'Assistant Unit Head'::text])));
alter table profils add constraint profils_authority_level_chk CHECK (((authority_level IS NULL) OR (authority_level = ANY (ARRAY['GLOBAL'::text, 'ZONE'::text, 'CLUSTER'::text, 'VILLAGE'::text, 'TRANSVERSE'::text]))));
alter table rt add constraint rt_active_requires_village CHECK (((COALESCE(deleted, false) = true) OR (village_id IS NOT NULL)));
alter table rt add constraint rt_statut_check CHECK ((statut = ANY (ARRAY['Pressenti'::text, 'Confirmé'::text, 'Actif'::text, 'Écarté'::text])));
alter table villages add constraint villages_farmer_code_prefix_chk CHECK (((farmer_code_prefix IS NULL) OR (farmer_code_prefix ~ '^[A-Z0-9]{4,8}$'::text))) NOT VALID;
alter table villages add constraint villages_statut_check CHECK ((statut = ANY (ARRAY['Brouillon'::text, 'Soumis'::text, 'À corriger'::text, 'Validé Supervisor'::text, 'Validé Head of Field'::text, 'Approuvé BM'::text, 'Rejeté'::text])));
alter table aflp_clusters add constraint aflp_clusters_zone_code_fkey FOREIGN KEY (zone_code) REFERENCES aflp_zones(code) ON UPDATE CASCADE;
alter table campaigns add constraint campaigns_copied_from_fkey FOREIGN KEY (copied_from) REFERENCES campaigns(id) ON DELETE SET NULL;
alter table farmer_plots add constraint farmer_plots_village_id_fkey FOREIGN KEY (village_id) REFERENCES villages(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table farmer_plots add constraint farmer_plots_producteur_id_fkey FOREIGN KEY (producteur_id) REFERENCES producteurs(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table missions add constraint missions_approuve_par_fkey FOREIGN KEY (approuve_par) REFERENCES profils(user_id);
alter table producteurs add constraint producteurs_village_id_fkey FOREIGN KEY (village_id) REFERENCES villages(id);
alter table producteurs add constraint producteurs_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES missions(id);
alter table producteurs add constraint producteurs_rt_id_fkey FOREIGN KEY (rt_id) REFERENCES rt(id);
alter table profils add constraint profils_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table rt add constraint rt_village_id_fkey FOREIGN KEY (village_id) REFERENCES villages(id);
alter table villages add constraint villages_cluster_code_fkey FOREIGN KEY (cluster_code) REFERENCES aflp_clusters(code) ON UPDATE CASCADE NOT VALID;
