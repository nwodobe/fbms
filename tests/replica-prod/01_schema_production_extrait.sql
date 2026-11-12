-- Réplique de test isolée · extrait du schéma de PRODUCTION (jmbdgpdthzpszfnddwzi),
-- lu en lecture seule le 12/11/2026 via catalogues PostgreSQL (pg_get_functiondef,
-- pg_get_triggerdef, pg_get_constraintdef). DDL uniquement, aucune ligne réelle.
--
-- FIDÈLE   : colonnes, contraintes, déclencheurs et fonctions de contrôle des tables
--            campaigns, rt, villages, profils, achats, avances, field_lots,
--            field_shipments, field_shipment_lots, field_stock_movements,
--            wms_receptions, wms_grns, aflp_incidents, reconciliations ;
--            politiques RLS d'écriture de achats, avances, field_shipments,
--            field_stock_movements ; privilèges de la production.
-- SIMPLIFIÉ (repéré « STUB ») : déclencheurs achats sans lien avec la caisse
--            (canal coopérative, mode A, producteur), contexte WMS, politiques SELECT.
set search_path = public, extensions;
set check_function_bodies = off;

create table public.procurement_campaigns(code text primary key, starts_on date, ends_on date, source text);

create table public.campaigns (id uuid default gen_random_uuid() not null, code text not null, name text not null, year integer not null, campaign_type text default 'REAL'::text not null, status text default 'DRAFT'::text not null, start_date date, planned_end_date date, actual_end_date date, currency text default 'XOF'::text not null, country text default 'CI'::text not null, season text, description text, config jsonb default '{}'::jsonb not null, copied_from uuid, created_at timestamp with time zone default now() not null, created_by uuid, opened_at timestamp with time zone, opened_by uuid, closing_started_at timestamp with time zone, closing_started_by uuid, closed_at timestamp with time zone, closed_by uuid, closed_with_reserves boolean default false not null, archived_at timestamp with time zone, archived_by uuid, reopened_count integer default 0 not null, is_current boolean default false not null, is_qa boolean default false not null, row_version integer default 1 not null, updated_at timestamp with time zone default now() not null, constraint campaigns_campaign_type_check CHECK ((campaign_type = ANY (ARRAY['REAL'::text, 'DEMO'::text, 'SIMULATION'::text, 'TRAINING'::text, 'QA'::text]))), constraint campaigns_code_key UNIQUE (code), constraint campaigns_pkey PRIMARY KEY (id), constraint campaigns_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PLANNING'::text, 'READY'::text, 'OPEN'::text, 'CLOSING'::text, 'CLOSED'::text, 'ARCHIVED'::text]))));

create table public.rt (id text not null, data jsonb not null, nom text, telephone text, village_id text, village_nom text, statut text default 'Pressenti'::text not null, score integer default 0, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, created_by text, updated_by text, deleted boolean default false not null, cluster text, id_rt text, constraint rt_active_requires_village CHECK (((COALESCE(deleted, false) = true) OR (village_id IS NOT NULL))), constraint rt_pkey PRIMARY KEY (id));

create table public.villages (id text not null, data jsonb not null, village text, region text, departement text, score integer default 0, statut text default 'Brouillon'::text not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, created_by text, updated_by text, deleted boolean default false not null, cluster text, gps_lat numeric(9,6), gps_lng numeric(9,6), rayon_geofence_m integer default 1500, cluster_code text, farmer_code_prefix text, constraint villages_pkey PRIMARY KEY (id));

create table public.profils (user_id uuid not null, email text not null, nom text not null, role text not null, actif boolean default true not null, created_at timestamp with time zone default now() not null, fonction_operationnelle text, cluster text, zone text, village_id text, rt_id text, authority_level text, permissions jsonb default '[]'::jsonb not null, telephone text, derniere_connexion timestamp with time zone, site_code text, warehouse_code text, constraint profils_email_key UNIQUE (email), constraint profils_pkey PRIMARY KEY (user_id), constraint profils_role_check CHECK ((role = ANY (ARRAY['Branch Manager'::text, 'Assistant Branch Manager'::text, 'Head of Field'::text, 'Procurement Officer'::text, 'Supervisor'::text, 'Agent Recenseur'::text, 'Consultation uniquement'::text, 'General Manager'::text, 'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text, 'RT'::text, 'LBA Purchase Officer'::text, 'Warehouse Manager'::text, 'Storekeeper'::text, 'QA / Lab'::text, 'Factory User'::text, 'Finance'::text, 'Viewer / Auditor'::text, 'Finance Manager'::text, 'Assistant Unit Head'::text]))));

create table public.achats (id uuid default gen_random_uuid() not null, local_id text, date date not null, cluster text, village_id text, village_nom text, rt_nom text, producteur_nom text, poids_brut numeric, tare numeric, poids_net numeric not null, prix_kg numeric not null, montant numeric not null, mode_paiement text, numero_recu text, nb_sacs integer, humidite numeric, impuretes numeric, rejet boolean default false, observation text, recu_photo text, commission_rt numeric, bonus_diff numeric, refinancable boolean default false, created_by uuid default auth.uid(), created_by_nom text, created_at timestamp with time zone default now(), rt_id text, producteur_id text, producteur_ref boolean default true, recu_photo_url text, qualite_statut text default 'À contrôler'::text, statut_validation text default 'À valider'::text, validated_by text, validated_at timestamp with time zone, stock_statut text default 'Entrée RT'::text, cash_statut text default 'Non réconcilié'::text, producteur_tel text, producteur_statut text, prix_hors_bareme boolean default false, motif_prix text, kor numeric, stock_libere boolean default false, saisie_mode text, cycle_id text, producteur_code text, weight_source text, campaign text, sourcing_channel text default 'AFLP_DIRECT'::text not null, cooperative_id uuid, coop_membership_id uuid, coop_member_number text, coop_section_id uuid, campaign_id uuid, constraint achats_local_id_key UNIQUE (local_id), constraint achats_montant_coherent_chk CHECK (((montant IS NULL) OR (poids_net IS NULL) OR (prix_kg IS NULL) OR (abs((montant - (poids_net * prix_kg))) <= (1)::numeric))), constraint achats_pkey PRIMARY KEY (id), constraint achats_poids_net_check CHECK ((poids_net > (0)::numeric)), constraint achats_prix_kg_check CHECK ((prix_kg > (0)::numeric)));

create table public.avances (id uuid default gen_random_uuid() not null, local_id text, date date default CURRENT_DATE not null, cluster text, rt_id text, rt_nom text, source text, montant numeric not null, motif text, statut text default 'Active'::text not null, created_by_nom text, created_by uuid default auth.uid(), created_at timestamp with time zone default now() not null, cycle_id text, volume_finance_kg numeric, prix_reference_kg numeric, cycle_statut text, override_bm boolean default false not null, override_motif text, campaign_id uuid, constraint avances_local_id_key UNIQUE (local_id), constraint avances_montant_check CHECK ((montant > (0)::numeric)), constraint avances_pkey PRIMARY KEY (id));

create table public.reconciliations (id uuid default gen_random_uuid() not null, local_id text, date date default CURRENT_DATE not null, cluster text, rt_id text, rt_nom text, cash_restant numeric default 0 not null, valeur_stock numeric default 0 not null, total_avance numeric default 0 not null, total_paye numeric default 0 not null, ecart numeric default 0 not null, statut text default 'A controler'::text not null, created_by_nom text, created_by uuid default auth.uid(), created_at timestamp with time zone default now() not null, constraint reconciliations_local_id_key UNIQUE (local_id), constraint reconciliations_pkey PRIMARY KEY (id));

create table public.aflp_incidents (id text default ((('INC-'::text || to_char(now(), 'YYYYMMDD'::text)) || '-'::text) || upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 6))) not null, incident_date date default CURRENT_DATE not null, campaign text not null, zone_code text, cluster_code text, village_id text, rt_id text, producteur_id text, incident_type text not null, risk_category text, description text not null, severity text not null, immediate_action text, responsible_person text, status text default 'OUVERT'::text not null, closing_date date, closing_note text, evidence_available boolean default false not null, evidence_ref text, remarks text, reported_by uuid default auth.uid(), reported_by_name text, updated_by uuid, updated_by_name text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, campaign_id uuid, constraint aflp_incidents_check CHECK (((status <> 'CLOS'::text) OR ((closing_date IS NOT NULL) AND (length(btrim(COALESCE(closing_note, ''::text))) >= 5)))), constraint aflp_incidents_description_check CHECK ((length(btrim(description)) >= 10)), constraint aflp_incidents_incident_type_check CHECK ((incident_type = ANY (ARRAY['ACCIDENT_MOTO'::text, 'SECURITE_TERRAIN'::text, 'CONFLIT_PRODUCTEUR'::text, 'RETARD_PAIEMENT'::text, 'MANQUE_SACS'::text, 'PERTE_STOCK'::text, 'SUSPICION_FRAUDE'::text, 'QUALITE_LITIGIEUSE'::text, 'PROBLEME_TRANSPORT'::text, 'RISQUE_TRAVAIL_ENFANTS'::text, 'GPS_PREUVE_MANQUANTE'::text, 'AUTRE'::text]))), constraint aflp_incidents_pkey PRIMARY KEY (id), constraint aflp_incidents_risk_category_check CHECK ((risk_category = ANY (ARRAY['SECURITE'::text, 'FINANCIER'::text, 'OPERATIONNEL'::text, 'QUALITE'::text, 'CONFORMITE'::text, 'SOCIAL'::text, 'DONNEES'::text]))), constraint aflp_incidents_severity_check CHECK ((severity = ANY (ARRAY['FAIBLE'::text, 'MOYENNE'::text, 'ELEVEE'::text, 'CRITIQUE'::text]))), constraint aflp_incidents_status_check CHECK ((status = ANY (ARRAY['OUVERT'::text, 'EN_COURS'::text, 'CLOS'::text]))));

create table public.field_lots (id uuid default gen_random_uuid() not null, local_id text, lot_code text not null, scope_type text not null, scope_id text, scope_label text not null, status text default 'FORMING'::text not null, sealed_at timestamp with time zone, closed_at timestamp with time zone, notes text, created_by uuid default auth.uid(), created_at timestamp with time zone default now() not null, updated_by uuid, updated_at timestamp with time zone default now() not null, record_version bigint default 1 not null, campaign_id uuid, constraint field_lots_check CHECK (((status = ANY (ARRAY['FORMING'::text, 'CANCELLED'::text])) OR (sealed_at IS NOT NULL))), constraint field_lots_lot_code_key UNIQUE (lot_code), constraint field_lots_pkey PRIMARY KEY (id), constraint field_lots_scope_type_check CHECK ((scope_type = ANY (ARRAY['VILLAGE'::text, 'CLUSTER'::text, 'MIXED'::text]))), constraint field_lots_status_check CHECK ((status = ANY (ARRAY['FORMING'::text, 'SEALED'::text, 'IN_STOCK'::text, 'IN_TRANSIT'::text, 'RECEIVED'::text, 'CLOSED'::text, 'CANCELLED'::text]))));
-- STUB : contributeurs de lot (alimentés par les achats en production).
create table public.field_lot_contributors(id uuid primary key default gen_random_uuid(), lot_id uuid not null, achat_id uuid, qty_kg numeric not null, status text not null default 'ACTIVE');

create table public.field_shipments (id uuid default gen_random_uuid() not null, local_id text, shipment_code text not null, origin_type text not null, origin_id text, origin_label text not null, destination_type text not null, destination_id text, destination_label text not null, vehicle_plate text, driver_name text, planned_qty_kg numeric, dispatched_qty_kg numeric, received_qty_kg numeric, status text default 'DRAFT'::text not null, departed_at timestamp with time zone, arrived_at timestamp with time zone, reception_id text, document_ref text, notes text, created_by uuid default auth.uid(), created_at timestamp with time zone default now() not null, updated_by uuid, updated_at timestamp with time zone default now() not null, record_version bigint default 1 not null, wms_reception_id text, campaign_id uuid, constraint field_shipments_check CHECK (((status = ANY (ARRAY['DRAFT'::text, 'LOADING'::text, 'CANCELLED'::text])) OR (departed_at IS NOT NULL))), constraint field_shipments_check1 CHECK (((status <> ALL (ARRAY['RECEIVED'::text, 'CLOSED'::text])) OR ((arrived_at IS NOT NULL) AND (reception_id IS NOT NULL)))), constraint field_shipments_check2 CHECK (((status = ANY (ARRAY['DRAFT'::text, 'CANCELLED'::text])) OR (NULLIF(btrim(COALESCE(vehicle_plate, ''::text)), ''::text) IS NOT NULL))), constraint field_shipments_destination_type_check CHECK ((destination_type = ANY (ARRAY['WAREHOUSE'::text, 'FACTORY'::text, 'OTHER'::text]))), constraint field_shipments_local_id_key UNIQUE (local_id), constraint field_shipments_origin_type_check CHECK ((origin_type = ANY (ARRAY['VILLAGE'::text, 'WAREHOUSE'::text, 'BOUAKE_WAREHOUSE'::text, 'OTHER'::text]))), constraint field_shipments_pkey PRIMARY KEY (id), constraint field_shipments_reception_id_key UNIQUE (reception_id), constraint field_shipments_record_version_check CHECK ((record_version > 0)), constraint field_shipments_shipment_code_key UNIQUE (shipment_code), constraint field_shipments_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'LOADING'::text, 'DISPATCHED'::text, 'RECEIVED'::text, 'CLOSED'::text, 'CANCELLED'::text]))));

create table public.field_shipment_lots (id uuid default gen_random_uuid() not null, local_id text, shipment_id uuid not null, lot_id uuid not null, planned_qty_kg numeric, loaded_qty_kg numeric, received_qty_kg numeric, created_by uuid default auth.uid(), created_at timestamp with time zone default now() not null, updated_by uuid, updated_at timestamp with time zone default now() not null, record_version bigint default 1 not null, constraint field_shipment_lots_local_id_key UNIQUE (local_id), constraint field_shipment_lots_pkey PRIMARY KEY (id), constraint field_shipment_lots_shipment_id_lot_id_key UNIQUE (shipment_id, lot_id));

create table public.field_stock_movements (id uuid default gen_random_uuid() not null, local_id text, movement_code text not null, lot_id uuid not null, shipment_id uuid, movement_type text not null, from_type text not null, from_id text, from_label text not null, to_type text not null, to_id text, to_label text not null, qty_sent_kg numeric not null, qty_received_kg numeric, status text default 'DRAFT'::text not null, departed_at timestamp with time zone, received_at timestamp with time zone, variance_reason text, document_ref text, created_by uuid default auth.uid(), created_at timestamp with time zone default now() not null, updated_by uuid, updated_at timestamp with time zone default now() not null, record_version bigint default 1 not null, constraint field_stock_movements_check CHECK (((status = ANY (ARRAY['DRAFT'::text, 'CANCELLED'::text])) OR (departed_at IS NOT NULL))), constraint field_stock_movements_movement_code_key UNIQUE (movement_code), constraint field_stock_movements_pkey PRIMARY KEY (id), constraint field_stock_movements_qty_sent_kg_check CHECK ((qty_sent_kg > (0)::numeric)), constraint field_stock_movements_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'DISPATCHED'::text, 'RECEIVED'::text, 'CANCELLED'::text]))));

create table public.wms_warehouses (id uuid default gen_random_uuid() not null, site_code text not null, code text not null, name text not null, location text, status text default 'ACTIVE'::text not null, capacity_kg numeric, is_factory boolean default false not null, created_by uuid, created_at timestamp with time zone default now() not null, updated_by uuid, updated_at timestamp with time zone default now() not null, constraint wms_warehouses_code_key UNIQUE (code), constraint wms_warehouses_pkey PRIMARY KEY (id));

create table public.wms_receptions (id text not null, warehouse_id uuid not null, truck text not null, supplier_name text, origin text not null, arrival_at timestamp with time zone default now() not null, status text default 'ARRIVED'::text not null, gross_kg numeric, tare_kg numeric, net_kg numeric, bags integer, weighbridge_ticket text, offloaded_at timestamp with time zone, created_at timestamp with time zone default now() not null, field_shipment_id uuid, campaign_id uuid, constraint wms_receptions_net_kg_check CHECK (((net_kg IS NULL) OR (net_kg > (0)::numeric))), constraint wms_receptions_pkey PRIMARY KEY (id));

create table public.wms_grns (id text not null, reception_id text not null, warehouse_id uuid not null, lot_id text, status text default 'EMIS'::text not null, content jsonb not null, issued_by uuid, issued_by_name text, issued_role text, issued_at timestamp with time zone default now() not null, constraint wms_grns_pkey PRIMARY KEY (id), constraint wms_grns_reception_id_key UNIQUE (reception_id), constraint wms_grns_status_check CHECK ((status = ANY (ARRAY['EMIS'::text, 'ANNULE'::text]))));

-- ===== Fonctions extraites de la production (verbatim) =====
CREATE OR REPLACE FUNCTION public.farmer_registry_resolve_cluster_code(p text) RETURNS text LANGUAGE sql IMMUTABLE
AS $f$ select nullif(upper(btrim(coalesce(p,''))),'') $f$; -- STUB (normalisation simplifiée)

CREATE OR REPLACE FUNCTION public.est_actif() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select exists (select 1 from public.profils where user_id = auth.uid() and actif = true) $function$;
CREATE OR REPLACE FUNCTION public.est_bm() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select exists (select 1 from public.profils where user_id = auth.uid() and actif = true and role = 'Branch Manager') $function$;
CREATE OR REPLACE FUNCTION public.mon_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select role from public.profils where user_id = auth.uid() and actif = true limit 1 $function$;
CREATE OR REPLACE FUNCTION public.fbms_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select role from profils where user_id = auth.uid() and actif = true; $function$;
CREATE OR REPLACE FUNCTION public.peut_editer_config() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select public.mon_role() in ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor') $function$;
CREATE OR REPLACE FUNCTION public.fb_rt_key(p_rt_id text, p_rt_nom text) RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$ select nullif(coalesce(nullif(p_rt_id,''), lower(regexp_replace(coalesce(p_rt_nom,''), '\s+', '', 'g'))), '') $function$;

CREATE OR REPLACE FUNCTION private.aflp_auh_actif() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$ select exists (select 1 from public.profils p where p.user_id = auth.uid() and p.actif = true and p.role = 'Assistant Unit Head') $function$;
CREATE OR REPLACE FUNCTION private.aflp_auh_cluster() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$ select public.farmer_registry_resolve_cluster_code(p.cluster) from public.profils p where p.user_id = auth.uid() and p.actif = true and p.role = 'Assistant Unit Head' limit 1 $function$;
CREATE OR REPLACE FUNCTION private.aflp_cluster_du_village(p_village_id text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$ select public.farmer_registry_resolve_cluster_code(coalesce(nullif(btrim(v.cluster_code),''), nullif(btrim(v.cluster),''), v.data->'s1'->>'cluster')) from public.villages v where v.id = p_village_id $function$;
CREATE OR REPLACE FUNCTION private.aflp_auh_dans_perimetre(p_cluster text, p_village_id text DEFAULT NULL::text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_mien text; v_cible text;
begin
  if not private.aflp_auh_actif() then return true; end if;
  v_mien := private.aflp_auh_cluster();
  if v_mien is null then return false; end if;
  v_cible := public.farmer_registry_resolve_cluster_code(p_cluster);
  if v_cible is null and nullif(btrim(coalesce(p_village_id,'')),'') is not null then
    v_cible := private.aflp_cluster_du_village(p_village_id);
  end if;
  return v_cible is not null and v_cible = v_mien;
end $function$;

CREATE OR REPLACE FUNCTION private.aflp_auh_garde_achat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare non_valides constant text[] := array['À valider','À contrôler','Validation BM requise','À sécher','À trier'];
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'UPDATE' then
    if new.statut_validation is distinct from old.statut_validation
       or new.validated_by is distinct from old.validated_by or new.validated_at is distinct from old.validated_at then
      raise exception 'Assistant Unit Head : la validation d''un achat est réservée aux rôles habilités.' using errcode = '42501';
    end if;
  end if;
  if not private.aflp_auh_dans_perimetre(new.cluster, new.village_id)
     or (nullif(btrim(coalesce(new.village_id,'')),'') is not null
         and private.aflp_cluster_du_village(new.village_id) is distinct from private.aflp_auh_cluster()) then
    raise exception 'Assistant Unit Head : achat hors de votre cluster (%).', coalesce(new.cluster, new.village_id, 'cluster absent') using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.statut_validation is not null and new.statut_validation <> all (non_valides) then
      new.observation := concat_ws(' | ', nullif(new.observation,''), 'Statut « ' || new.statut_validation || ' » reçu d''un Assistant Unit Head ramené à « À valider »');
      new.statut_validation := 'À valider';
    end if;
    new.validated_by := null;
    new.validated_at := null;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.aflp_auh_garde_avance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if private.aflp_auh_actif() then
    raise exception 'Assistant Unit Head : l''engagement ou la modification d''une avance est réservé aux rôles habilités.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.avances_garde_override() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if coalesce(new.override_bm, false) is true then
    if not public.est_bm() then
      raise exception 'Override du blocage de caisse réservé au Branch Manager (rôle courant : %).', coalesce(public.fbms_role(), 'aucun');
    end if;
    if coalesce(length(btrim(new.override_motif)), 0) < 10 then
      raise exception 'Override du blocage de caisse : motif circonstancié obligatoire (10 caractères minimum).';
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.campaign_purge_active() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
declare v text := current_setting('aflp.campaign_purge', true);
begin
  if v is null or v = '' then return false; end if;
  return exists (select 1 from public.campaigns c where c.id::text = v and c.campaign_type <> 'REAL');
exception when others then return false;
end $function$;
CREATE OR REPLACE FUNCTION private.campaign_status_fr(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'private'
AS $function$ select case p when 'DRAFT' then 'Brouillon' when 'PLANNING' then 'En préparation' when 'READY' then 'Prête' when 'OPEN' then 'Ouverte' when 'CLOSING' then 'En clôture' when 'CLOSED' then 'Clôturée' when 'ARCHIVED' then 'Archivée' else p end $function$;
CREATE OR REPLACE FUNCTION private.campaign_by_code(p_code text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$ select id from public.campaigns where code = upper(btrim(p_code)) limit 1 $function$;
CREATE OR REPLACE FUNCTION private.campaign_current_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$ select id from public.campaigns where is_current limit 1 $function$;

CREATE OR REPLACE FUNCTION private.campaign_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
declare
  v_kind   text := tg_argv[0];
  v_legacy text := nullif(tg_argv[1], '');
  v_ptab   text := nullif(tg_argv[2], '');
  v_pcol   text := nullif(tg_argv[3], '');
  v_row    jsonb; v_code text; v_id uuid; c public.campaigns; v_old public.campaigns;
begin
  if private.campaign_purge_active() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    select * into v_old from public.campaigns where id = old.campaign_id;
    if v_old.status in ('CLOSED','ARCHIVED') then
      raise exception 'Campagne % % : lecture seule. Suppression impossible.', v_old.code, lower(private.campaign_status_fr(v_old.status)) using errcode = '42501';
    end if;
    if v_kind = 'STOCK' then raise exception 'Un LOT ne se supprime pas : utilisez un mouvement compensatoire.' using errcode = '42501'; end if;
    return old;
  end if;
  v_row := to_jsonb(new);
  if tg_op = 'UPDATE' then
    if old.campaign_id is not null and new.campaign_id is distinct from old.campaign_id then
      raise exception 'Une opération ne change pas de campagne.' using errcode = '42501';
    end if;
    if old.campaign_id is null then return new; end if;
    select * into c from public.campaigns where id = old.campaign_id;
    if c.status in ('CLOSED','ARCHIVED') and v_kind <> 'STOCK' then
      raise exception 'Campagne % clôturée : lecture seule.', c.code using errcode = '42501';
    end if;
    if v_kind = 'TRANSACTION' and c.status not in ('OPEN','CLOSING') then
      raise exception 'Campagne % non ouverte (%) : opération non modifiable.', c.code, private.campaign_status_fr(c.status) using errcode = '42501';
    end if;
    if v_legacy is not null and (v_row->>v_legacy) is distinct from c.code then
      new := jsonb_populate_record(new, jsonb_build_object(v_legacy, c.code));
    end if;
    return new;
  end if;
  v_id := new.campaign_id;
  if v_id is null and v_ptab is not null and (v_row->>v_pcol) is not null then
    execute format('select campaign_id from public.%I where id::text = $1', v_ptab) into v_id using v_row->>v_pcol;
  end if;
  if v_id is null and v_legacy is not null then
    v_code := nullif(btrim(v_row->>v_legacy), '');
    if v_code is not null then v_id := private.campaign_by_code(v_code); end if;
  end if;
  if v_id is null then v_id := private.campaign_current_id(); end if;
  if v_id is null then
    raise exception 'Aucune campagne courante : ouvrez une campagne dans Administration → Campagnes avant d''enregistrer une opération.' using errcode = '23514';
  end if;
  select * into c from public.campaigns where id = v_id;
  if not found then raise exception 'Campagne inconnue.' using errcode = '23503'; end if;
  if v_kind = 'CONFIG' and c.status in ('CLOSED','ARCHIVED') then
    raise exception 'Campagne % : paramétrage en lecture seule.', c.code using errcode = '42501';
  elsif v_kind = 'TRANSACTION' and c.status <> 'OPEN' then
    raise exception 'Campagne % % : aucune nouvelle opération ne peut y être enregistrée.', c.code, lower(private.campaign_status_fr(c.status)) using errcode = '42501';
  elsif v_kind in ('RECONCILIATION','STOCK') and c.status not in ('OPEN','CLOSING') then
    raise exception 'Campagne % : aucun rapprochement ne peut y être enregistré.', c.code using errcode = '42501';
  end if;
  new.campaign_id := c.id;
  if v_legacy is not null and (v_row->>v_legacy) is distinct from c.code then
    new := jsonb_populate_record(new, jsonb_build_object(v_legacy, c.code));
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.campaigns_sync_legacy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'Le code de campagne % ne se modifie pas.', old.code using errcode = '42501';
  end if;
  new.is_qa := new.campaign_type = 'QA';
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.row_version := old.row_version + 1; end if;
  insert into public.procurement_campaigns (code, starts_on, ends_on, source)
  values (new.code, coalesce(new.start_date, make_date(new.year, 1, 1)), coalesce(new.planned_end_date, make_date(new.year, 12, 31)), 'CAMPAIGNS')
  on conflict (code) do nothing;
  return new;
end $function$;

-- Contrôle historique avance/achat (production : SECURITY INVOKER, sans verrou).
CREATE OR REPLACE FUNCTION public.fb_prevent_achat_over_advance() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare k text; total_avance numeric := 0; total_achat numeric := 0; disponible numeric := 0;
begin
  k := public.fb_rt_key(new.rt_id, new.rt_nom);
  if k is null then return new; end if;
  select coalesce(sum(a.montant),0) into total_avance from public.avances a
  where public.fb_rt_key(a.rt_id, a.rt_nom) = k and coalesce(a.statut,'Active') <> 'Annulee'
    and a.campaign_id is not distinct from new.campaign_id;
  select coalesce(sum(x.montant),0) into total_achat from public.achats x
  where public.fb_rt_key(x.rt_id, x.rt_nom) = k and x.id is distinct from new.id
    and x.campaign_id is not distinct from new.campaign_id
    and not coalesce(nullif(btrim(coalesce(new.local_id,'')),'') is not null and x.local_id = new.local_id, false);
  disponible := total_avance - total_achat;
  if coalesce(new.montant,0) > disponible then
    raise exception 'Avance RT insuffisante pour la campagne en cours. Disponible: %, achat: %', disponible, new.montant using errcode = '23514';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.sacherie_assign_cycle_achat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ declare v_cycle text; v_count integer; begin if new.cycle_id is null and new.rt_id is not null then select count(*),min(a.cycle_id) into v_count,v_cycle from public.avances a where a.rt_id=new.rt_id and a.cycle_id is not null and a.cycle_statut='OPEN'; if v_count=1 then new.cycle_id:=v_cycle; elsif v_count>1 then raise exception 'Plusieurs cycles Sacherie OPEN pour ce RT : correction BM requise'; end if; end if; return new; end $function$;

CREATE OR REPLACE FUNCTION public.field_traceability_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ begin new.updated_at := now(); new.updated_by := auth.uid(); new.record_version := old.record_version + 1; return new; end; $function$;

CREATE OR REPLACE FUNCTION public.field_shipment_receive_stock_if_balanced() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sent numeric; v_received numeric;
begin
  if new.status not in ('RECEIVED','CLOSED') or old.status in ('RECEIVED','CLOSED') then return new; end if;
  v_sent := coalesce(new.dispatched_qty_kg,0); v_received := coalesce(new.received_qty_kg,0);
  if abs(v_sent-v_received) <= 0.01 then
    update public.field_stock_movements set qty_received_kg=qty_sent_kg, status='RECEIVED', received_at=coalesce(new.arrived_at,now())
     where shipment_id=new.id and status='DISPATCHED';
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION private.field_shipment_on_wms_offload() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
declare v_sent numeric;
begin
  if new.field_shipment_id is null or new.net_kg is null or old.net_kg is not null then return new; end if;
  select coalesce(sum(qty_sent_kg),0) into v_sent from public.field_stock_movements where shipment_id = new.field_shipment_id and status = 'DISPATCHED';
  if v_sent > 0 then
    update public.field_stock_movements m set qty_received_kg = round(m.qty_sent_kg * new.net_kg / v_sent, 3), status = 'RECEIVED',
           received_at = coalesce(new.offloaded_at, now()),
           variance_reason = case when abs(new.net_kg - v_sent) > 0.01 then coalesce(m.variance_reason, 'Écart pont-bascule réception Warehouse ' || new.id) else m.variance_reason end
     where m.shipment_id = new.field_shipment_id and m.status = 'DISPATCHED';
  end if;
  update public.field_shipments set received_qty_kg = new.net_kg, arrived_at = coalesce(arrived_at, new.arrival_at, now())
   where id = new.field_shipment_id and status in ('DISPATCHED','LOADING');
  update public.field_lots l set status = 'RECEIVED' where l.status = 'IN_TRANSIT'
     and l.id in (select sl.lot_id from public.field_shipment_lots sl where sl.shipment_id = new.field_shipment_id);
  return new;
end $function$;

-- STUB : en production un déclencheur sur field_shipment_lots crée un mouvement par lot.
CREATE OR REPLACE FUNCTION private.stub_shipment_lot_movement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$ declare s public.field_shipments;
begin select * into s from public.field_shipments where id=new.shipment_id;
 if s.status='DISPATCHED' then
  insert into public.field_stock_movements(movement_code,lot_id,shipment_id,movement_type,from_type,from_label,to_type,to_label,qty_sent_kg,status,departed_at,created_by)
  values('MV-'||substr(new.id::text,1,8),new.lot_id,new.shipment_id,'VILLAGE_TO_WAREHOUSE','VILLAGE',s.origin_label,'WAREHOUSE',s.destination_label,new.loaded_qty_kg,'DISPATCHED',s.departed_at,s.created_by);
 end if; return new; end $f$;

-- STUB : contexte WMS / rôles / audit de procurement_field_create_shipment.
CREATE OR REPLACE FUNCTION public.wms_ctx() RETURNS jsonb LANGUAGE sql STABLE AS $f$ select jsonb_build_object('uid',auth.uid()) $f$;
CREATE OR REPLACE FUNCTION private.ops_has_role(p text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ select public.mon_role() = any(p) $f$;
CREATE OR REPLACE FUNCTION public.wms_audit(a text,b text,c jsonb,d jsonb,e text) RETURNS void LANGUAGE sql AS $f$ select null::void $f$;

-- Évacuation canonique (production, verbatim) : insère directement en DISPATCHED.
CREATE OR REPLACE FUNCTION public.procurement_field_create_shipment(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  c jsonb; v_id uuid; v_code text; v_origin_type text; v_dest_type text;
  v_lots jsonb; x jsonb; v_lot uuid; v_loaded numeric; v_planned numeric; v_total numeric:=0;
  v_wh public.wms_warehouses; v_departed timestamptz;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(array['Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
    'Field Buying Operations Officer','Zonal Head','Unit Head','Supervisor','Administrateur']) then raise exception 'Droit insuffisant pour créer une évacuation'; end if;
  v_origin_type:=upper(coalesce(nullif(p->>'origin_type',''),'VILLAGE'));
  v_dest_type:=upper(coalesce(nullif(p->>'destination_type',''),'WAREHOUSE'));
  if nullif(btrim(p->>'vehicle_plate'),'') is null then raise exception 'Truck Number obligatoire'; end if;
  if v_dest_type='WAREHOUSE' then
    select * into v_wh from public.wms_warehouses where id::text=nullif(p->>'destination_id','') or upper(code)=upper(coalesce(p->>'destination_id','')) limit 1;
    if v_wh.id is null or v_wh.status<>'ACTIVE' then raise exception 'Destination Warehouse invalide ou inactive'; end if;
  end if;
  v_lots:=coalesce(p->'lots','[]'::jsonb);
  if jsonb_typeof(v_lots)<>'array' or jsonb_array_length(v_lots)=0 then raise exception 'Au moins un lot terrain est obligatoire'; end if;
  for x in select value from jsonb_array_elements(v_lots) loop
    v_lot:=(x->>'lot_id')::uuid; v_loaded:=nullif(x->>'loaded_qty_kg','')::numeric;
    if v_loaded is null or v_loaded<=0 then raise exception 'Loaded Quantity invalide'; end if;
    if not exists(select 1 from public.field_lots where id=v_lot and status in ('SEALED','IN_STOCK','IN_TRANSIT')) then raise exception 'Lot % introuvable ou non expédiable',v_lot; end if;
    v_total:=v_total+v_loaded;
  end loop;
  v_code:=upper(nullif(btrim(p->>'shipment_code'),''));
  if v_code is null then v_code:='SHP-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)); end if;
  v_departed:=coalesce(nullif(p->>'departed_at','')::timestamptz,now());
  insert into public.field_shipments(local_id,shipment_code,origin_type,origin_id,origin_label,destination_type,destination_id,destination_label,
    vehicle_plate,driver_name,planned_qty_kg,dispatched_qty_kg,status,departed_at,document_ref,notes,created_by
  ) values(nullif(p->>'local_id',''),v_code,v_origin_type,nullif(p->>'origin_id',''),btrim(p->>'origin_label'),
    v_dest_type,case when v_dest_type='WAREHOUSE' then v_wh.id::text else nullif(p->>'destination_id','') end,
    case when v_dest_type='WAREHOUSE' then v_wh.code||' - '||v_wh.name else btrim(p->>'destination_label') end,
    upper(regexp_replace(p->>'vehicle_plate','\s+','','g')),nullif(p->>'driver_name',''),
    coalesce(nullif(p->>'planned_qty_kg','')::numeric,v_total),v_total,'DISPATCHED',v_departed,
    nullif(p->>'document_ref',''),nullif(p->>'notes',''),(c->>'uid')::uuid) returning id into v_id;
  for x in select value from jsonb_array_elements(v_lots) loop
    v_lot:=(x->>'lot_id')::uuid; v_loaded:=nullif(x->>'loaded_qty_kg','')::numeric; v_planned:=coalesce(nullif(x->>'planned_qty_kg','')::numeric,v_loaded);
    insert into public.field_shipment_lots(local_id,shipment_id,lot_id,planned_qty_kg,loaded_qty_kg,created_by) values(nullif(x->>'local_id',''),v_id,v_lot,v_planned,v_loaded,(c->>'uid')::uuid);
    update public.field_lots set status='IN_TRANSIT',updated_by=(c->>'uid')::uuid,updated_at=now() where id=v_lot and status<>'CANCELLED';
  end loop;
  return jsonb_build_object('id',v_id,'shipment_code',v_code,'status','DISPATCHED','dispatched_qty_kg',v_total);
end $function$;

-- ===== Déclencheurs (pg_get_triggerdef, production) =====
CREATE TRIGGER trg_000_campaign_stamp BEFORE INSERT OR DELETE OR UPDATE ON public.achats FOR EACH ROW EXECUTE FUNCTION private.campaign_stamp('TRANSACTION', 'campaign', '', '');
CREATE TRIGGER trg_fb_prevent_achat_over_advance BEFORE INSERT OR UPDATE OF montant, rt_id, rt_nom ON public.achats FOR EACH ROW EXECUTE FUNCTION fb_prevent_achat_over_advance();
CREATE TRIGGER trg_sacherie_assign_cycle_achat BEFORE INSERT ON public.achats FOR EACH ROW EXECUTE FUNCTION sacherie_assign_cycle_achat();
CREATE TRIGGER trg_zzzz_aflp_auh_garde_achat BEFORE INSERT OR UPDATE ON public.achats FOR EACH ROW EXECUTE FUNCTION private.aflp_auh_garde_achat();
CREATE TRIGGER trg_000_campaign_stamp BEFORE INSERT OR DELETE OR UPDATE ON public.aflp_incidents FOR EACH ROW EXECUTE FUNCTION private.campaign_stamp('TRANSACTION', 'campaign', '', '');
CREATE TRIGGER trg_000_campaign_stamp BEFORE INSERT OR DELETE OR UPDATE ON public.avances FOR EACH ROW EXECUTE FUNCTION private.campaign_stamp('TRANSACTION', '', '', '');
CREATE TRIGGER trg_avances_override_bm BEFORE INSERT OR UPDATE ON public.avances FOR EACH ROW EXECUTE FUNCTION avances_garde_override();
CREATE TRIGGER trg_zzzz_aflp_auh_garde_avance BEFORE INSERT OR DELETE OR UPDATE ON public.avances FOR EACH ROW EXECUTE FUNCTION private.aflp_auh_garde_avance();
CREATE TRIGGER trg_campaigns_sync_legacy BEFORE INSERT OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION private.campaigns_sync_legacy();
CREATE TRIGGER trg_000_campaign_stamp BEFORE INSERT OR DELETE OR UPDATE ON public.field_lots FOR EACH ROW EXECUTE FUNCTION private.campaign_stamp('TRANSACTION', '', '', '');
CREATE TRIGGER trg_field_lots_touch BEFORE UPDATE ON public.field_lots FOR EACH ROW EXECUTE FUNCTION field_traceability_touch();
CREATE TRIGGER trg_000_campaign_stamp BEFORE INSERT OR DELETE OR UPDATE ON public.field_shipments FOR EACH ROW EXECUTE FUNCTION private.campaign_stamp('TRANSACTION', '', '', '');
CREATE TRIGGER trg_field_shipments_receive_stock AFTER UPDATE OF status, received_qty_kg, arrived_at ON public.field_shipments FOR EACH ROW EXECUTE FUNCTION field_shipment_receive_stock_if_balanced();
CREATE TRIGGER trg_field_shipments_touch BEFORE UPDATE ON public.field_shipments FOR EACH ROW EXECUTE FUNCTION field_traceability_touch();
CREATE TRIGGER trg_field_stock_movements_touch BEFORE UPDATE ON public.field_stock_movements FOR EACH ROW EXECUTE FUNCTION field_traceability_touch();
CREATE TRIGGER trg_stub_shipment_lot_movement AFTER INSERT ON public.field_shipment_lots FOR EACH ROW EXECUTE FUNCTION private.stub_shipment_lot_movement();
CREATE TRIGGER trg_000_campaign_stamp BEFORE INSERT OR DELETE OR UPDATE ON public.wms_receptions FOR EACH ROW EXECUTE FUNCTION private.campaign_stamp('TRANSACTION', '', '', '');
CREATE TRIGGER trg_field_shipment_on_wms_offload AFTER UPDATE OF net_kg ON public.wms_receptions FOR EACH ROW EXECUTE FUNCTION private.field_shipment_on_wms_offload();

-- ===== Privilèges et RLS d'écriture (production) =====
grant all on public.achats, public.avances, public.reconciliations, public.field_shipments, public.field_stock_movements,
  public.field_lots, public.field_shipment_lots, public.rt, public.villages, public.profils to authenticated;
grant select on public.campaigns, public.aflp_incidents, public.wms_receptions, public.wms_grns, public.wms_warehouses to authenticated;
alter table public.achats enable row level security;
alter table public.avances enable row level security;
alter table public.field_shipments enable row level security;
alter table public.field_stock_movements enable row level security;
alter table public.aflp_incidents enable row level security;
alter table public.reconciliations enable row level security;
create policy achats_ins on public.achats for insert to authenticated with check (est_actif() AND (created_by = auth.uid()));
create policy achats_upd on public.achats for update to authenticated using (est_bm()) with check (est_bm());
create policy achats_sel on public.achats for select to authenticated using (est_actif()); -- STUB (périmètre simplifié)
create policy avances_auh_interdit_ins on public.avances as restrictive for insert to authenticated with check (NOT (select private.aflp_auh_actif()));
create policy avances_ins on public.avances for insert to authenticated with check ((select est_actif()));
create policy avances_upd on public.avances for update to authenticated using ((select peut_editer_config())) with check ((select peut_editer_config()));
create policy avances_sel on public.avances for select to authenticated using (est_actif()); -- STUB
create policy field_shipments_ins on public.field_shipments for insert to authenticated with check (est_actif() AND (created_by = auth.uid()));
create policy field_shipments_upd on public.field_shipments for update to authenticated using (est_actif()) with check (est_actif());
create policy field_shipments_sel on public.field_shipments for select to authenticated using (est_actif()); -- STUB
create policy field_stock_movements_ins on public.field_stock_movements for insert to authenticated with check (est_actif() AND (created_by = auth.uid()));
create policy field_stock_movements_upd on public.field_stock_movements for update to authenticated using (est_actif()) with check (est_actif());
create policy field_stock_movements_sel on public.field_stock_movements for select to authenticated using (est_actif()); -- STUB
create policy aflp_incidents_select on public.aflp_incidents for select to authenticated using (est_actif()); -- STUB
grant execute on all functions in schema public to authenticated;

-- ===== Sacherie : registre canonique (colonnes et vues de la production) =====
create table public.rcn_jute_locations (code text primary key, site_code text, warehouse_code text, nom text, type text, actif boolean default true,
  created_at timestamptz default now(), scope_type text, cluster text, rt_id text, producteur_id text, actor_type text, actor_code text);
create table public.rcn_jute_movements (id text primary key default gen_random_uuid()::text, event_key text, movement_type text not null, ledger text not null default 'INTERNE',
  supplier_code text, qty integer not null check (qty > 0), from_location text, to_location text, from_state text, to_state text, reception_id text, lot_id text, bin_id text,
  source_type text, source_id text, reference text, note text, proof_url text, movement_at timestamptz default now(), created_by uuid, created_at timestamptz default now(),
  owner_type text default 'ANAGROCI', campaign text, bale_count integer, loose_bags integer, unit_cost numeric, total_cost numeric, cluster text, rt_id text,
  producteur_id text, legacy_sacs_id uuid, bag_movement_request_id uuid, bag_condition text, campaign_id uuid,
  check ((ledger = 'FOURNISSEUR' and supplier_code is not null) or ledger = 'INTERNE'));
create view public.rcn_jute_v_stock with (security_invoker=true) as
 WITH x AS (SELECT to_location AS location_code, to_state AS state, qty AS delta FROM rcn_jute_movements
            WHERE ledger = 'INTERNE' AND to_location IS NOT NULL AND to_state IS NOT NULL
        UNION ALL SELECT from_location, from_state, - qty FROM rcn_jute_movements
            WHERE ledger = 'INTERNE' AND from_location IS NOT NULL AND from_state IS NOT NULL)
 SELECT location_code, state, sum(delta)::integer AS qty FROM x GROUP BY location_code, state;
create view public.sacherie_ct_rt_stock with (security_invoker=true) as
 WITH stock AS (SELECT l.cluster, l.rt_id, max(l.nom) AS rt_nom,
            COALESCE(sum(s_1.qty), 0)::integer AS total_sous_responsabilite,
            COALESCE(sum(s_1.qty) FILTER (WHERE s_1.state = 'UTILISABLE'), 0)::integer AS vides,
            COALESCE(sum(s_1.qty) FILTER (WHERE s_1.state = 'PLEIN'), 0)::integer AS pleins
           FROM rcn_jute_locations l LEFT JOIN rcn_jute_v_stock s_1 ON s_1.location_code = l.code
          WHERE l.scope_type = 'RT' GROUP BY l.cluster, l.rt_id)
 SELECT * FROM stock;
grant select on public.rcn_jute_locations, public.rcn_jute_movements, public.rcn_jute_v_stock, public.sacherie_ct_rt_stock to authenticated;
