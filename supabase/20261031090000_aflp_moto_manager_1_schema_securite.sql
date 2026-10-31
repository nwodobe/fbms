-- =====================================================================
-- ANAGROCI FBMS — AFLP MOTO MANAGER (1/3) : schéma, périmètres, RLS, journal
-- Fichier : supabase/20261031090000_aflp_moto_manager_1_schema_securite.sql
-- Branche : feat/aflp-moto-manager
--
-- STATUT : APPLIQUÉE EN PRODUCTION le 31/10/2026 sur autorisation de M. KOUASSI
--          (empreintes md5 des fonctions vérifiées identiques à la version testée).
--
-- PRINCIPES :
--   · Aucune écriture directe : toutes les tables moto_* sont en lecture RLS
--     pour `authenticated`, les écritures passent EXCLUSIVEMENT par les
--     fonctions SECURITY DEFINER de la migration 2/3 (même modèle que
--     aflp_incidents). Masquer un bouton n'est jamais la protection.
--   · Aucun rôle n'est créé ni modifié : profils_role_check est inchangée.
--   · Aucune donnée réelle n'est insérée : ni moto, ni châssis, ni document.
--   · Journal immuable de chaque changement (ancienne / nouvelle valeur,
--     auteur, date, motif, valideur).
--
-- ORDRE : 1/3 → 2/3 (RPC) → 3/3 (vues et indicateurs).
-- RETOUR ARRIÈRE : supabase/20261031090300_aflp_moto_manager_rollback.sql
-- =====================================================================
begin;

create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. Contexte de l'utilisateur et classes métier Moto Manager
--    Correspondance rôle FBMS existant → classe Moto Manager :
--      Branch Manager            → BM        (supervision globale, validations)
--      Assistant Branch Manager  → ABM       (inventaire, documents, remises, dotations)
--      Zonal Head                → ZONE      (supervision, entretiens, corrections opérationnelles)
--      Unit Head                 → UNITE     (opérations de SA moto)
--      Finance, Finance Manager  → FINANCE   (lecture financière, vérification justificatifs)
--      General Manager           → DIRECTION (lecture, validation des opérations initiées par le BM)
--      autres rôles              → null      (aucun accès)
--    RH : aucun rôle RH n'existe dans profils_role_check. La vérification du
--    permis est enregistrée par l'ABM ou le BM avec le nom du vérificateur RH.
-- ---------------------------------------------------------------------
create or replace function private.moto_classe()
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select case p.role
           when 'Branch Manager' then 'BM'
           when 'Assistant Branch Manager' then 'ABM'
           when 'Zonal Head' then 'ZONE'
           when 'Unit Head' then 'UNITE'
           when 'Finance' then 'FINANCE'
           when 'Finance Manager' then 'FINANCE'
           when 'General Manager' then 'DIRECTION'
           else null end
  from public.profils p
  where p.user_id = auth.uid() and p.actif = true
  limit 1
$$;

create or replace function private.moto_est_finance_manager()
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select exists (select 1 from public.profils where user_id = auth.uid() and actif and role = 'Finance Manager') $$;

create or replace function private.moto_mon_cluster()
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select public.aflp_cluster_code(p.cluster) from public.profils p where p.user_id = auth.uid() and p.actif limit 1 $$;

create or replace function private.moto_ma_zone()
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select c.zone_code from public.aflp_clusters c where c.code = public.aflp_cluster_code(p.cluster)),
    (select z.code from public.aflp_zones z where public.aflp_norm(z.code) = public.aflp_norm(p.zone)
                                               or public.aflp_norm(z.label) = public.aflp_norm(p.zone) limit 1))
  from public.profils p where p.user_id = auth.uid() and p.actif limit 1
$$;

create or replace function private.moto_mon_nom()
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select coalesce(nom, email) from public.profils where user_id = auth.uid() limit 1 $$;

-- ---------------------------------------------------------------------
-- 2. Paramètres configurables (aucune valeur constructeur inventée)
-- ---------------------------------------------------------------------
create table if not exists public.moto_parametres (
  cle text primary key,
  valeur numeric,
  valeur_json jsonb,
  unite text,
  description text not null,
  provisoire boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.moto_parametres (cle, valeur, valeur_json, unite, description, provisoire) values
  ('conso_reference_l100', 3, null, 'L/100 km', 'Référence de planification (mandat 30/10/2026). Ce n''est pas une donnée constructeur vérifiée.', false),
  ('conso_seuil_verification_1', 3.6, null, 'L/100 km', 'Seuil d''alerte 1 : déclenche une vérification, jamais une accusation.', true),
  ('conso_seuil_verification_2', 4.2, null, 'L/100 km', 'Seuil d''alerte 2 : vérification prioritaire, jamais une accusation.', true),
  ('jours_operationnels_semaine', 6, null, 'jours', 'Jours opérationnels prévus par semaine pour le calcul de disponibilité (hypothèse à confirmer).', true),
  ('alerte_document_jours', 30, null, 'jours', 'Délai d''alerte avant expiration d''un document administratif.', true),
  ('controle_plein_complet_jours', 30, null, 'jours', 'Fréquence visée d''un plein complet de contrôle (au moins un par mois).', false),
  ('equipements_obligatoires', null, '["CASQUE","GILET_HAUTE_VISIBILITE"]'::jsonb, null, 'Équipements de sécurité exigés à la remise (liste à confirmer par ANAGROCI).', true),
  ('documents_obligatoires', null, '["CARTE_GRISE","PLAQUE","ASSURANCE"]'::jsonb, null, 'Documents exigés pour la conformité administrative.', false)
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- 3. Inventaire : passeport numérique de la moto
--    Châssis, moteur et immatriculation sont NULLABLES : on n'invente rien.
-- ---------------------------------------------------------------------
create sequence if not exists public.moto_code_seq;

create table if not exists public.moto_motos (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('MOTO-' || lpad(nextval('public.moto_code_seq')::text, 3, '0')),
  qr_token uuid not null unique default gen_random_uuid(),
  marque text not null,
  modele text not null,
  annee integer check (annee is null or annee between 2000 and 2100),
  couleur text,
  numero_chassis text,
  numero_moteur text,
  immatriculation text,
  fournisseur text,
  date_reception date,
  cluster_code text references public.aflp_clusters(code),
  zone_code text references public.aflp_zones(code),
  statut_administratif text not null default 'EN_ATTENTE'
    check (statut_administratif in ('EN_ATTENTE','EN_VERIFICATION','CONFORME','NON_CONFORME')),
  statut_affectation text not null default 'NON_AFFECTEE'
    check (statut_affectation in ('NON_AFFECTEE','PREAFFECTEE','REMISE','TRANSFEREE')),
  statut_technique text not null default 'A_CONTROLER'
    check (statut_technique in ('A_CONTROLER','APTE','IMMOBILISEE','EN_REPARATION')),
  mise_en_service_at timestamptz,
  mise_en_service_par uuid,
  mise_en_service_motif text,
  compteur_actuel_km numeric(10,1) check (compteur_actuel_km is null or compteur_actuel_km >= 0),
  observations text,
  actif boolean not null default true,
  row_version integer not null default 1,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists moto_motos_chassis_uq on public.moto_motos (upper(btrim(numero_chassis))) where numero_chassis is not null and btrim(numero_chassis) <> '';
create unique index if not exists moto_motos_immat_uq on public.moto_motos (upper(regexp_replace(immatriculation, '\s', '', 'g'))) where immatriculation is not null and btrim(immatriculation) <> '';
create index if not exists moto_motos_cluster_idx on public.moto_motos (cluster_code);

-- Documents (fichiers dans le bucket privé moto-documents)
create table if not exists public.moto_documents (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  affectation_id uuid,
  type_document text not null check (type_document in
    ('CARTE_GRISE','PLAQUE','ASSURANCE','RAPPORT_MECANICIEN','PV_REMISE','PHOTO','PERMIS','FACTURE','JUSTIFICATIF','AUTRE')),
  numero_reference text,
  date_emission date,
  date_expiration date,
  storage_path text,
  nom_fichier text,
  statut text not null default 'EN_VERIFICATION' check (statut in ('EN_VERIFICATION','CONFORME','NON_CONFORME','REMPLACE')),
  motif_verification text,
  depose_par uuid not null default auth.uid(),
  depose_at timestamptz not null default now(),
  verifie_par uuid,
  verifie_at timestamptz,
  check (date_expiration is null or date_emission is null or date_expiration >= date_emission),
  check (statut not in ('CONFORME','NON_CONFORME') or verifie_par is not null),
  check (verifie_par is null or verifie_par <> depose_par)
);
create index if not exists moto_documents_moto_idx on public.moto_documents (moto_id, type_document);

-- Affectations (préaffectation, remise, transfert, retrait)
create table if not exists public.moto_affectations (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  beneficiaire_id uuid not null references public.profils(user_id),
  cluster_code text not null references public.aflp_clusters(code),
  type_affectation text not null check (type_affectation in ('PREAFFECTATION','REMISE','TRANSFERT')),
  statut text not null default 'ACTIVE' check (statut in ('ACTIVE','CLOTUREE','ANNULEE')),
  date_debut date not null default current_date,
  date_fin date,
  compteur_km numeric(10,1),
  pv_document_id uuid references public.moto_documents(id),
  permis_verifie boolean not null default false,
  permis_categorie text,
  permis_verifie_par_nom text,
  permis_verifie_at date,
  equipements jsonb not null default '{}'::jsonb,
  motif text,
  cree_par uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  cloture_par uuid,
  cloture_at timestamptz
);
create unique index if not exists moto_affectations_une_active_uq on public.moto_affectations (moto_id) where statut = 'ACTIVE';
create index if not exists moto_affectations_benef_idx on public.moto_affectations (beneficiaire_id, statut);

-- Contrôles : inspection initiale, contrôle avant départ, contrôle de remise en service
create table if not exists public.moto_controles (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  type_controle text not null check (type_controle in ('INSPECTION_INITIALE','AVANT_DEPART','REMISE_EN_SERVICE')),
  date_controle timestamptz not null default now(),
  compteur_km numeric(10,1) check (compteur_km is null or compteur_km >= 0),
  items jsonb not null default '[]'::jsonb,
  anomalie_critique boolean not null,
  resultat text not null check (resultat in ('APTE','INAPTE')),
  intervenant_nom text,
  garage_nom text,
  avis_mecanicien text,
  rapport_document_id uuid references public.moto_documents(id),
  realise_par uuid not null default auth.uid(),
  client_op_id uuid unique,
  created_at timestamptz not null default now(),
  check (not anomalie_critique or resultat = 'INAPTE')
);
comment on column public.moto_controles.avis_mecanicien is
  'Avis technique d''un mécanicien. Ce n''est PAS un certificat réglementaire officiel.';
create index if not exists moto_controles_moto_idx on public.moto_controles (moto_id, date_controle desc);

-- Relevés kilométriques
create table if not exists public.moto_releves_km (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  date_releve timestamptz not null default now(),
  compteur_km numeric(10,1) not null check (compteur_km >= 0),
  source text not null default 'RELEVE' check (source in ('RELEVE','CONTROLE','CARBURANT','REMISE','INCIDENT','MAINTENANCE','CORRECTION')),
  saisi_par uuid not null default auth.uid(),
  client_op_id uuid unique,
  created_at timestamptz not null default now()
);
create index if not exists moto_releves_moto_idx on public.moto_releves_km (moto_id, compteur_km desc);

-- Immobilisations (source de vérité de l'indisponibilité technique)
create table if not exists public.moto_immobilisations (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  debut timestamptz not null default now(),
  fin timestamptz,
  motif text not null,
  source_type text not null check (source_type in ('INCIDENT','MAINTENANCE','CONTROLE','DECISION')),
  source_id uuid,
  ouverte_par uuid not null default auth.uid(),
  levee_par uuid,
  levee_motif text,
  check (fin is null or fin >= debut)
);
create index if not exists moto_immobilisations_moto_idx on public.moto_immobilisations (moto_id, debut);

-- ---------------------------------------------------------------------
-- 4. Carburant et dotations financières
--    Moto Manager ENREGISTRE et RAPPROCHE ; il n'exécute aucun paiement.
-- ---------------------------------------------------------------------
create table if not exists public.moto_budgets (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid references public.moto_motos(id),
  beneficiaire_id uuid not null references public.profils(user_id),
  periode_debut date not null,
  periode_fin date not null,
  montant_autorise numeric(14,0) not null check (montant_autorise > 0),
  statut text not null default 'PROPOSE' check (statut in ('PROPOSE','VALIDE','REJETE','ANNULE')),
  motif text,
  propose_par uuid not null default auth.uid(),
  propose_at timestamptz not null default now(),
  valide_par uuid,
  valide_at timestamptz,
  check (periode_fin >= periode_debut),
  check (statut <> 'VALIDE' or valide_par is not null)
);

create table if not exists public.moto_dotations (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.moto_budgets(id),
  moto_id uuid references public.moto_motos(id),
  beneficiaire_id uuid not null references public.profils(user_id),
  mode_paiement text not null check (mode_paiement in ('ESPECES','MOBILE_MONEY')),
  operateur_mobile_money text,
  montant_remis numeric(14,0) not null check (montant_remis > 0),
  frais_transaction numeric(14,0) not null default 0 check (frais_transaction >= 0),
  reference text,
  statut text not null default 'REMISE_DECLAREE'
    check (statut in ('REMISE_DECLAREE','CONFIRMEE','CONTESTEE','ECHOUEE','ANNULEE')),
  montant_recu numeric(14,0) check (montant_recu is null or montant_recu >= 0),
  remis_par uuid not null default auth.uid(),
  remis_at timestamptz not null default now(),
  confirme_par uuid,
  confirme_at timestamptz,
  motif text,
  client_op_id uuid unique,
  check (mode_paiement = 'MOBILE_MONEY' or frais_transaction = 0),
  check (mode_paiement <> 'MOBILE_MONEY' or (reference is not null and btrim(reference) <> '')),
  check (statut <> 'CONFIRMEE' or (montant_recu is not null and confirme_par = beneficiaire_id)),
  check (montant_recu is null or montant_recu <= montant_remis)
);
comment on column public.moto_dotations.montant_remis is
  'Montant remis par l''ABM. Pour Mobile Money : montant envoyé, hors frais de transaction.';
comment on column public.moto_dotations.montant_recu is
  'Montant dont le bénéficiaire confirme la réception. Seul le statut CONFIRMEE vaut dotation reçue.';
create index if not exists moto_dotations_benef_idx on public.moto_dotations (beneficiaire_id, statut);

create table if not exists public.moto_carburant (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  agent_id uuid not null references public.profils(user_id),
  date_achat timestamptz not null,
  compteur_km numeric(10,1) not null check (compteur_km >= 0),
  litres numeric(8,2) not null check (litres > 0 and litres <= 60),
  montant numeric(14,0) not null check (montant > 0),
  plein_complet boolean not null,
  station text,
  financement text not null default 'DOTATION' check (financement in ('DOTATION','AVANCE_PERSONNELLE')),
  justificatif_path text,
  justificatif_statut text not null default 'A_VERIFIER' check (justificatif_statut in ('A_VERIFIER','VERIFIE','REJETE')),
  justificatif_motif text,
  verifie_par uuid,
  verifie_at timestamptz,
  rembourse_par uuid,
  remboursement_id uuid,
  saisi_par uuid not null default auth.uid(),
  client_op_id uuid unique,
  created_at timestamptz not null default now(),
  check (verifie_par is null or verifie_par <> saisi_par),
  check (justificatif_statut <> 'VERIFIE' or justificatif_path is not null)
);
create index if not exists moto_carburant_moto_idx on public.moto_carburant (moto_id, compteur_km);

create table if not exists public.moto_restitutions (
  id uuid primary key default gen_random_uuid(),
  beneficiaire_id uuid not null references public.profils(user_id),
  moto_id uuid references public.moto_motos(id),
  montant numeric(14,0) not null check (montant > 0),
  mode_paiement text not null check (mode_paiement in ('ESPECES','MOBILE_MONEY')),
  reference text,
  motif text,
  enregistre_par uuid not null default auth.uid(),
  enregistre_at timestamptz not null default now()
);

create table if not exists public.moto_remboursements (
  id uuid primary key default gen_random_uuid(),
  beneficiaire_id uuid not null references public.profils(user_id),
  carburant_ids uuid[] not null,
  montant numeric(14,0) not null check (montant > 0),
  statut text not null default 'DEMANDE' check (statut in ('DEMANDE','VALIDE','PAYE_DECLARE','REJETE')),
  mode_paiement text check (mode_paiement in ('ESPECES','MOBILE_MONEY')),
  reference text,
  demande_par uuid not null default auth.uid(),
  demande_at timestamptz not null default now(),
  valide_par uuid,
  valide_at timestamptz,
  paye_declare_par uuid,
  paye_declare_at timestamptz,
  motif text,
  check (valide_par is null or valide_par <> demande_par)
);

-- Corrections financières et opérationnelles sensibles (principe des 4 yeux)
create table if not exists public.moto_corrections (
  id uuid primary key default gen_random_uuid(),
  cible_table text not null check (cible_table in ('moto_carburant','moto_dotations','moto_releves_km')),
  cible_id uuid not null,
  champ text not null,
  ancienne_valeur text,
  nouvelle_valeur text not null,
  motif text not null check (length(btrim(motif)) >= 10),
  statut text not null default 'DEMANDEE' check (statut in ('DEMANDEE','APPLIQUEE','REJETEE')),
  demande_par uuid not null default auth.uid(),
  demande_at timestamptz not null default now(),
  valide_par uuid,
  valide_at timestamptz,
  decision_motif text,
  check (valide_par is null or valide_par <> demande_par)
);

-- ---------------------------------------------------------------------
-- 5. Maintenance, échéances paramétrables, pneumatiques
-- ---------------------------------------------------------------------
create table if not exists public.moto_regles_maintenance (
  code text primary key,
  libelle text not null,
  type_maintenance text not null check (type_maintenance in ('VIDANGE','ENTRETIEN_PREVENTIF','REVISION')),
  intervalle_km numeric(10,0) check (intervalle_km is null or intervalle_km > 0),
  intervalle_jours integer check (intervalle_jours is null or intervalle_jours > 0),
  tolerance_km numeric(10,0) not null default 200,
  source text not null default 'PARAMETRE_ANAGROCI' check (source in ('PARAMETRE_ANAGROCI','CONSTRUCTEUR_VERIFIE')),
  reference_documentaire text,
  actif boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (not actif or intervalle_km is not null or intervalle_jours is not null),
  check (source <> 'CONSTRUCTEUR_VERIFIE' or reference_documentaire is not null)
);
-- Règles créées SANS intervalle et INACTIVES : la documentation APSONIC
-- AP150-30 n'a pas été vérifiée. À renseigner par le Branch Manager.
insert into public.moto_regles_maintenance (code, libelle, type_maintenance) values
  ('VIDANGE', 'Vidange huile moteur', 'VIDANGE'),
  ('ENTRETIEN', 'Entretien préventif (chaîne, freins, filtres)', 'ENTRETIEN_PREVENTIF'),
  ('REVISION', 'Révision générale', 'REVISION')
on conflict (code) do nothing;

create table if not exists public.moto_maintenances (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  type_maintenance text not null check (type_maintenance in ('VIDANGE','ENTRETIEN_PREVENTIF','REVISION','REPARATION','PANNE')),
  statut text not null default 'DEMANDEE' check (statut in ('DEMANDEE','AUTORISEE','EN_COURS','TERMINEE','REFUSEE','ANNULEE')),
  description text not null check (length(btrim(description)) >= 5),
  compteur_km numeric(10,1),
  cout_estime numeric(14,0) check (cout_estime is null or cout_estime >= 0),
  cout_reel numeric(14,0) check (cout_reel is null or cout_reel >= 0),
  garage_nom text,
  facture_document_id uuid references public.moto_documents(id),
  incident_id uuid,
  date_intervention date,
  demande_par uuid not null default auth.uid(),
  demande_at timestamptz not null default now(),
  autorise_par uuid,
  autorise_at timestamptz,
  termine_par uuid,
  termine_at timestamptz,
  client_op_id uuid unique,
  check (autorise_par is null or autorise_par <> demande_par)
);
create index if not exists moto_maintenances_moto_idx on public.moto_maintenances (moto_id, statut);

create table if not exists public.moto_pneus (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  marque text not null,
  modele text,
  dimensions text not null,
  numero_serie text,
  date_achat date,
  cout_achat numeric(14,0) check (cout_achat is null or cout_achat >= 0),
  fournisseur text,
  statut text not null default 'EN_STOCK' check (statut in ('EN_STOCK','MONTE','EN_REPARATION','REFORME')),
  motif_reforme text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.moto_pneu_poses (
  id uuid primary key default gen_random_uuid(),
  pneu_id uuid not null references public.moto_pneus(id),
  moto_id uuid not null references public.moto_motos(id),
  position text not null check (position in ('AVANT','ARRIERE')),
  pose_date date not null,
  pose_km numeric(10,1) not null check (pose_km >= 0),
  depose_date date,
  depose_km numeric(10,1),
  motif_depose text,
  pose_par uuid not null default auth.uid(),
  depose_par uuid,
  check (depose_km is null or depose_km >= pose_km)
);
create unique index if not exists moto_pneu_pose_ouverte_pneu_uq on public.moto_pneu_poses (pneu_id) where depose_date is null;
create unique index if not exists moto_pneu_pose_ouverte_pos_uq on public.moto_pneu_poses (moto_id, position) where depose_date is null;

create table if not exists public.moto_pneu_reparations (
  id uuid primary key default gen_random_uuid(),
  pneu_id uuid not null references public.moto_pneus(id),
  moto_id uuid references public.moto_motos(id),
  date_reparation date not null,
  compteur_km numeric(10,1),
  cout numeric(14,0) not null default 0 check (cout >= 0),
  description text not null,
  saisi_par uuid not null default auth.uid()
);

-- ---------------------------------------------------------------------
-- 6. Incidents (lien avec le registre AFLP existant public.aflp_incidents)
-- ---------------------------------------------------------------------
create table if not exists public.moto_incidents (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  type_incident text not null check (type_incident in ('PANNE','ACCIDENT','CREVAISON','ANOMALIE')),
  gravite text not null check (gravite in ('MINEURE','MAJEURE','CRITIQUE')),
  etape text not null default 'SIGNALE' check (etape in
    ('SIGNALE','IMMOBILISEE','DIAGNOSTIC','AUTORISATION_DEPENSE','REPARATION','CONTROLE','REMIS_EN_SERVICE','CLOS')),
  description text not null check (length(btrim(description)) >= 10),
  lieu text,
  compteur_km numeric(10,1),
  survenu_at timestamptz not null default now(),
  arret_confirme boolean not null default false,
  cout_estime numeric(14,0),
  cout_reel numeric(14,0),
  depense_autorisee_par uuid,
  aflp_incident_id text,
  declare_par uuid not null default auth.uid(),
  declare_at timestamptz not null default now(),
  clos_par uuid,
  clos_at timestamptz,
  client_op_id uuid unique,
  check (depense_autorisee_par is null or depense_autorisee_par <> declare_par)
);
create index if not exists moto_incidents_moto_idx on public.moto_incidents (moto_id, etape);

create table if not exists public.moto_incident_etapes (
  id bigserial primary key,
  incident_id uuid not null references public.moto_incidents(id),
  etape text not null,
  note text,
  auteur uuid not null default auth.uid(),
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. Formation
-- ---------------------------------------------------------------------
create table if not exists public.moto_formation_resultats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profils(user_id),
  module_code text not null,
  score integer not null check (score >= 0),
  total integer not null check (total > 0),
  reussi boolean not null,
  realise_at timestamptz not null default now(),
  client_op_id uuid unique,
  check (score <= total)
);

-- ---------------------------------------------------------------------
-- 8. Idempotence des opérations terrain (hors connexion)
-- ---------------------------------------------------------------------
create table if not exists public.moto_operations (
  client_op_id uuid primary key,
  user_id uuid not null,
  type_operation text not null,
  statut text not null check (statut in ('SYNCHRONISE','REJETE')),
  resultat jsonb not null,
  recu_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. Journal immuable
-- ---------------------------------------------------------------------
create table if not exists public.moto_journal (
  id bigserial primary key,
  at timestamptz not null default now(),
  table_nom text not null,
  enregistrement_id text,
  action text not null,
  ancienne_valeur jsonb,
  nouvelle_valeur jsonb,
  auteur uuid,
  auteur_nom text,
  motif text,
  valideur uuid
);
create index if not exists moto_journal_cible_idx on public.moto_journal (table_nom, enregistrement_id);

create or replace function private.moto_journaliser()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_id text := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'cle', v_new ->> 'code', v_new ->> 'client_op_id');
  v_val text := nullif(current_setting('moto.valideur', true), '');
begin
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  insert into public.moto_journal (table_nom, enregistrement_id, action, ancienne_valeur, nouvelle_valeur,
                                   auteur, auteur_nom, motif, valideur)
  values (tg_table_name, v_id, tg_op, v_old, v_new, auth.uid(), private.moto_mon_nom(),
          nullif(current_setting('moto.motif', true), ''), case when v_val is null then null else v_val::uuid end);
  return coalesce(new, old);
end $$;

create or replace function private.moto_journal_immuable()
returns trigger language plpgsql as $$
begin
  raise exception 'Le journal Moto Manager est immuable' using errcode = '42501';
end $$;
drop trigger if exists moto_journal_immuable_trg on public.moto_journal;
create trigger moto_journal_immuable_trg before update or delete on public.moto_journal
  for each row execute function private.moto_journal_immuable();

do $$
declare t text;
begin
  foreach t in array array['moto_parametres','moto_motos','moto_documents','moto_affectations','moto_controles',
    'moto_releves_km','moto_immobilisations','moto_budgets','moto_dotations','moto_carburant','moto_restitutions',
    'moto_remboursements','moto_corrections','moto_regles_maintenance','moto_maintenances','moto_pneus',
    'moto_pneu_poses','moto_pneu_reparations','moto_incidents','moto_formation_resultats']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_journal_trg', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.moto_journaliser()', t || '_journal_trg', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10. Périmètres de lecture
-- ---------------------------------------------------------------------
create or replace function private.moto_est_affectataire(p_moto uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from public.moto_affectations a
                 where a.moto_id = p_moto and a.statut = 'ACTIVE'
                   and a.type_affectation in ('REMISE','TRANSFERT') and a.beneficiaire_id = auth.uid())
$$;

create or replace function private.moto_dans_perimetre(p_moto uuid)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text := private.moto_classe(); m record;
begin
  if v_classe is null then return false; end if;
  if v_classe in ('BM','ABM','FINANCE','DIRECTION') then return true; end if;
  select cluster_code, zone_code into m from public.moto_motos where id = p_moto;
  if not found then return false; end if;
  if v_classe = 'ZONE' then
    -- Décision du 17/09/2026 : portée terrain globale du Chef de Zone.
    if public.portee_terrain_globale() then return true; end if;
    return m.zone_code is not null and m.zone_code = private.moto_ma_zone();
  end if;
  if v_classe = 'UNITE' then
    return private.moto_est_affectataire(p_moto)
        or (m.cluster_code is not null and m.cluster_code = private.moto_mon_cluster());
  end if;
  return false;
end $$;

create or replace function private.moto_lecture_finance(p_beneficiaire uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$ select private.moto_classe() in ('BM','ABM','FINANCE','DIRECTION') or (private.moto_classe() is not null and p_beneficiaire = auth.uid()) $$;

-- Chemin de stockage : premier dossier = id de la moto (lecture sûre, sans exception de cast).
create or replace function private.moto_uuid_ou_null(p text)
returns uuid language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid else null end
$$;

-- ---------------------------------------------------------------------
-- 11. RLS : lecture par périmètre, AUCUNE écriture directe
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['moto_parametres','moto_motos','moto_documents','moto_affectations','moto_controles',
    'moto_releves_km','moto_immobilisations','moto_budgets','moto_dotations','moto_carburant','moto_restitutions',
    'moto_remboursements','moto_corrections','moto_regles_maintenance','moto_maintenances','moto_pneus',
    'moto_pneu_poses','moto_pneu_reparations','moto_incidents','moto_incident_etapes','moto_formation_resultats',
    'moto_operations','moto_journal']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_lecture', t);
  end loop;
end $$;
revoke all on sequence public.moto_code_seq from anon, authenticated;

create policy moto_parametres_lecture on public.moto_parametres for select to authenticated using (private.moto_classe() is not null);
create policy moto_regles_maintenance_lecture on public.moto_regles_maintenance for select to authenticated using (private.moto_classe() is not null);
create policy moto_motos_lecture on public.moto_motos for select to authenticated using (private.moto_dans_perimetre(id));
create policy moto_documents_lecture on public.moto_documents for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_affectations_lecture on public.moto_affectations for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_controles_lecture on public.moto_controles for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_releves_km_lecture on public.moto_releves_km for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_immobilisations_lecture on public.moto_immobilisations for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_maintenances_lecture on public.moto_maintenances for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_incidents_lecture on public.moto_incidents for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_incident_etapes_lecture on public.moto_incident_etapes for select to authenticated
  using (exists (select 1 from public.moto_incidents i where i.id = incident_id and private.moto_dans_perimetre(i.moto_id)));
create policy moto_pneus_lecture on public.moto_pneus for select to authenticated using (private.moto_classe() in ('BM','ABM','ZONE','FINANCE','DIRECTION'));
create policy moto_pneu_poses_lecture on public.moto_pneu_poses for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_pneu_reparations_lecture on public.moto_pneu_reparations for select to authenticated
  using (private.moto_classe() in ('BM','ABM','ZONE','FINANCE','DIRECTION') or (moto_id is not null and private.moto_dans_perimetre(moto_id)));
-- Carburant : le Chef de Zone voit la consommation de son périmètre ; montants inclus (non confidentiels).
create policy moto_carburant_lecture on public.moto_carburant for select to authenticated
  using (private.moto_dans_perimetre(moto_id) or agent_id = auth.uid());
-- Données financières : BM, ABM, Finance, Direction, et le bénéficiaire pour ses propres lignes.
create policy moto_budgets_lecture on public.moto_budgets for select to authenticated using (private.moto_lecture_finance(beneficiaire_id));
create policy moto_dotations_lecture on public.moto_dotations for select to authenticated using (private.moto_lecture_finance(beneficiaire_id));
create policy moto_restitutions_lecture on public.moto_restitutions for select to authenticated using (private.moto_lecture_finance(beneficiaire_id));
create policy moto_remboursements_lecture on public.moto_remboursements for select to authenticated using (private.moto_lecture_finance(beneficiaire_id));
create policy moto_corrections_lecture on public.moto_corrections for select to authenticated
  using (private.moto_classe() in ('BM','ABM','FINANCE','DIRECTION') or demande_par = auth.uid());
create policy moto_formation_resultats_lecture on public.moto_formation_resultats for select to authenticated
  using (user_id = auth.uid() or private.moto_classe() in ('BM','ABM','ZONE','DIRECTION'));
create policy moto_operations_lecture on public.moto_operations for select to authenticated using (user_id = auth.uid());
create policy moto_journal_lecture on public.moto_journal for select to authenticated using (private.moto_classe() in ('BM','ABM','DIRECTION') or private.moto_est_finance_manager());

-- ---------------------------------------------------------------------
-- 12. Stockage documentaire PRIVÉ
--     Chemin : <moto_id>/<categorie>/<uuid>.<ext>. Aucune modification ni
--     suppression par l'application : une preuve déposée est conservée.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('moto-documents', 'moto-documents', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.moto_peut_deposer(p_nom text)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid_ou_null((storage.foldername(p_nom))[1]);
        v_cat text := (storage.foldername(p_nom))[2];
        v_classe text := private.moto_classe();
begin
  if v_moto is null or v_classe is null then return false; end if;
  if not exists (select 1 from public.moto_motos where id = v_moto) then return false; end if;
  if v_classe in ('BM','ABM') then return true; end if;
  if v_classe = 'ZONE' then return private.moto_dans_perimetre(v_moto) and v_cat in ('controle','incident','maintenance','photo'); end if;
  if v_classe = 'UNITE' then return private.moto_est_affectataire(v_moto) and v_cat in ('justificatif','incident','photo','controle'); end if;
  return false;
end $$;

drop policy if exists moto_documents_depot on storage.objects;
create policy moto_documents_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'moto-documents' and private.moto_peut_deposer(name));
drop policy if exists moto_documents_consultation on storage.objects;
create policy moto_documents_consultation on storage.objects for select to authenticated
  using (bucket_id = 'moto-documents'
         and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1])));

revoke all on function private.moto_classe(), private.moto_est_finance_manager(), private.moto_mon_cluster(),
  private.moto_ma_zone(), private.moto_mon_nom(), private.moto_est_affectataire(uuid),
  private.moto_dans_perimetre(uuid), private.moto_lecture_finance(uuid), private.moto_peut_deposer(text),
  private.moto_uuid_ou_null(text) from public, anon;
grant execute on function private.moto_classe(), private.moto_est_finance_manager(), private.moto_mon_cluster(),
  private.moto_ma_zone(), private.moto_mon_nom(), private.moto_est_affectataire(uuid),
  private.moto_dans_perimetre(uuid), private.moto_lecture_finance(uuid), private.moto_peut_deposer(text),
  private.moto_uuid_ou_null(text) to authenticated;

commit;
