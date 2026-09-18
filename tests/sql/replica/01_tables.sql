-- Replica locale : structure des tables utilisees par la Sacherie AFLP,
-- extraite du catalogue de production le 18/09/2026 (lecture seule,
-- format_type/pg_get_constraintdef). Aucune donnee de production n'est copiee.
create table public.achats (
  id uuid default gen_random_uuid() not null,
  local_id text, date date not null, cluster text, village_id text, village_nom text,
  rt_nom text, producteur_nom text, poids_brut numeric, tare numeric,
  poids_net numeric not null, prix_kg numeric not null, montant numeric not null,
  mode_paiement text, numero_recu text, nb_sacs integer, humidite numeric, impuretes numeric,
  rejet boolean default false, observation text, recu_photo text, commission_rt numeric,
  bonus_diff numeric, refinancable boolean default false, created_by uuid default auth.uid(),
  created_by_nom text, created_at timestamp with time zone default now(), rt_id text,
  producteur_id text, producteur_ref boolean default true, recu_photo_url text,
  qualite_statut text default 'À contrôler'::text, statut_validation text default 'À valider'::text,
  validated_by text, validated_at timestamp with time zone, stock_statut text default 'Entrée RT'::text,
  cash_statut text default 'Non réconcilié'::text, producteur_tel text, producteur_statut text,
  prix_hors_bareme boolean default false, motif_prix text, kor numeric, stock_libere boolean default false,
  saisie_mode text, cycle_id text, producteur_code text,
  constraint achats_local_id_key UNIQUE (local_id),
  constraint achats_pkey PRIMARY KEY (id),
  constraint achats_poids_net_check CHECK ((poids_net > (0)::numeric)),
  constraint achats_prix_kg_check CHECK ((prix_kg > (0)::numeric))
);
create table public.aflp_clusters (
  code text not null, label text not null, zone_code text not null,
  aliases text[] default '{}'::text[] not null, active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint aflp_clusters_code_zone_code_key UNIQUE (code, zone_code),
  constraint aflp_clusters_pkey PRIMARY KEY (code)
);
create table public.aflp_zones (
  code text not null, label text not null, region text, active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint aflp_zones_pkey PRIMARY KEY (code)
);
create table public.avances (
  id uuid default gen_random_uuid() not null, local_id text, date date default CURRENT_DATE not null,
  cluster text, rt_id text, rt_nom text, source text, montant numeric not null, motif text,
  statut text default 'Active'::text not null, created_by_nom text, created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null, cycle_id text, volume_finance_kg numeric,
  prix_reference_kg numeric, cycle_statut text, override_bm boolean default false not null, override_motif text,
  constraint avances_local_id_key UNIQUE (local_id),
  constraint avances_pkey PRIMARY KEY (id),
  constraint avances_montant_check CHECK ((montant > (0)::numeric))
);
create table public.bag_movement_requests (
  id uuid default gen_random_uuid() not null, client_request_id text not null, request_code text not null,
  cluster text not null, zone text, rt_id text not null, rt_nom text, cycle_id text not null,
  movement_type text default 'DOTATION_RT'::text not null, stock_rcn_kg_verified numeric not null,
  stock_checked_by uuid default auth.uid() not null, stock_checked_at timestamp with time zone default now() not null,
  stock_source text default 'PHYSICAL_COUNT'::text not null, volume_finance_kg numeric not null,
  volume_achete_cycle_kg numeric default 0 not null, volume_finance_restant_kg numeric not null,
  bags_already_held integer default 0 not null, reserved_approved_bags integer default 0 not null,
  system_max_bags integer default 0 not null, max_new_bags integer default 0 not null,
  max_new_available integer default 0 not null, cluster_stock_at_request integer default 0 not null,
  requested_qty integer not null, approved_qty integer, status text default 'PENDING_BM'::text not null,
  requested_by uuid default auth.uid() not null, requested_at timestamp with time zone default now() not null,
  approved_by uuid, approved_at timestamp with time zone, expires_at timestamp with time zone,
  approval_comment text, closed_at timestamp with time zone, created_at timestamp with time zone default now() not null,
  constraint bag_movement_requests_request_code_key UNIQUE (request_code),
  constraint bag_req_client_uid UNIQUE (client_request_id),
  constraint bag_movement_requests_pkey PRIMARY KEY (id),
  constraint bag_movement_requests_requested_qty_check CHECK ((requested_qty > 0)),
  constraint bag_movement_requests_stock_rcn_kg_verified_check CHECK ((stock_rcn_kg_verified >= (0)::numeric)),
  constraint bag_movement_requests_volume_achete_cycle_kg_check CHECK ((volume_achete_cycle_kg >= (0)::numeric)),
  constraint bag_movement_requests_volume_finance_kg_check CHECK ((volume_finance_kg >= (0)::numeric)),
  constraint bag_movement_requests_volume_finance_restant_kg_check CHECK ((volume_finance_restant_kg >= (0)::numeric)),
  constraint bag_req_approved_qty_chk CHECK (((approved_qty IS NULL) OR ((approved_qty > 0) AND (approved_qty <= requested_qty)))),
  constraint bag_req_status_chk CHECK ((status = ANY (ARRAY['PENDING_BM'::text, 'APPROVED'::text, 'HOLD'::text, 'REJECTED'::text, 'PARTIALLY_EXECUTED'::text, 'EXECUTED'::text, 'CLOSED'::text, 'FAIL_INCIDENT'::text])))
);
create table public.ops_bag_releases (
  id uuid default gen_random_uuid() not null, client_release_id text not null, request_id uuid not null,
  qty integer not null, source_location_code text not null, destination_location_code text not null,
  jute_movement_id text, released_by uuid not null, released_at timestamp with time zone default now() not null,
  received_by uuid, received_at timestamp with time zone, proof_url text, notes text,
  constraint ops_bag_releases_client_release_id_key UNIQUE (client_release_id),
  constraint ops_bag_releases_jute_movement_id_key UNIQUE (jute_movement_id),
  constraint ops_bag_releases_pkey PRIMARY KEY (id),
  constraint ops_bag_releases_qty_check CHECK ((qty > 0))
);
create table public.ops_bag_requests (
  id uuid default gen_random_uuid() not null, client_request_id text not null, request_code text not null,
  channel text not null, campaign text not null, lba_code text, cluster text, rt_id text,
  source_location_code text, destination_location_code text, requested_qty integer not null,
  approved_qty integer, released_qty integer default 0 not null, received_qty integer default 0 not null,
  status text default 'REQUESTED'::text not null, requested_by uuid not null,
  requested_at timestamp with time zone default now() not null, reviewed_by uuid, reviewed_at timestamp with time zone,
  approved_by uuid, approved_at timestamp with time zone, expires_at timestamp with time zone,
  closed_at timestamp with time zone, closed_reason text, notes text, metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null,
  receipt_gap_reason text,
  constraint ops_bag_requests_client_request_id_key UNIQUE (client_request_id),
  constraint ops_bag_requests_request_code_key UNIQUE (request_code),
  constraint ops_bag_requests_pkey PRIMARY KEY (id),
  constraint ops_bag_requests_channel_check CHECK ((channel = ANY (ARRAY['LBA'::text, 'AFLP'::text]))),
  constraint ops_bag_requests_check CHECK (((approved_qty IS NULL) OR ((approved_qty > 0) AND (approved_qty <= requested_qty)))),
  constraint ops_bag_requests_check1 CHECK ((((channel = 'LBA'::text) AND (lba_code IS NOT NULL)) OR ((channel = 'AFLP'::text) AND (cluster IS NOT NULL) AND (rt_id IS NOT NULL)))),
  constraint ops_bag_requests_check2 CHECK ((released_qty <= COALESCE(approved_qty, requested_qty))),
  constraint ops_bag_requests_check3 CHECK ((received_qty <= released_qty)),
  constraint ops_bag_requests_received_qty_check CHECK ((received_qty >= 0)),
  constraint ops_bag_requests_released_qty_check CHECK ((released_qty >= 0)),
  constraint ops_bag_requests_requested_qty_check CHECK ((requested_qty > 0)),
  constraint ops_bag_requests_status_check CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'REVIEWED'::text, 'CONSOLIDATED'::text, 'GM_APPROVED'::text, 'BM_APPROVED'::text, 'READY_FOR_RELEASE'::text, 'PARTIALLY_RELEASED'::text, 'FULLY_RELEASED'::text, 'RECEIVED'::text, 'CLOSED'::text, 'REJECTED'::text, 'CANCELLED'::text, 'EXPIRED'::text])))
);
create table public.producteurs (
  id text not null, data jsonb not null, code text, nom text, telephone text, village_id text not null,
  village_nom text, rt_id text, statut text default 'Identifié'::text not null,
  created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null,
  created_by text, updated_by text, deleted boolean default false not null,
  constraint producteurs_pkey PRIMARY KEY (id)
);
create table public.profils (
  user_id uuid not null, email text not null, nom text not null, role text not null,
  actif boolean default true not null, created_at timestamp with time zone default now() not null,
  fonction_operationnelle text, cluster text, zone text, village_id text, rt_id text, authority_level text,
  permissions jsonb default '[]'::jsonb not null, telephone text, derniere_connexion timestamp with time zone,
  site_code text, warehouse_code text,
  constraint profils_email_key UNIQUE (email),
  constraint profils_pkey PRIMARY KEY (user_id),
  constraint profils_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint profils_authority_level_chk CHECK (((authority_level IS NULL) OR (authority_level = ANY (ARRAY['GLOBAL'::text, 'ZONE'::text, 'CLUSTER'::text, 'VILLAGE'::text, 'TRANSVERSE'::text])))),
  constraint profils_role_check CHECK ((role = ANY (ARRAY['Branch Manager'::text, 'Assistant Branch Manager'::text, 'Head of Field'::text, 'Procurement Officer'::text, 'Supervisor'::text, 'Agent Recenseur'::text, 'Consultation uniquement'::text, 'General Manager'::text, 'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text, 'RT'::text, 'LBA Purchase Officer'::text, 'Warehouse Manager'::text, 'Storekeeper'::text, 'QA / Lab'::text, 'Factory User'::text, 'Finance'::text, 'Viewer / Auditor'::text])))
);
create table public.rcn_jute_inventories (
  id text not null, location_code text not null, state text not null, theoretical_qty integer not null,
  counted_qty integer not null, difference_qty integer generated always as (counted_qty - theoretical_qty) stored, motif text,
  statut text default 'SOUMIS'::text not null, counted_by uuid, approved_by uuid,
  counted_at timestamp with time zone default now() not null, approved_at timestamp with time zone,
  proof_url text, inventory_batch_id text, reconciliation_status text,
  constraint rcn_jute_inventories_pkey PRIMARY KEY (id),
  constraint rcn_jute_inventories_counted_qty_check CHECK ((counted_qty >= 0)),
  constraint rcn_jute_inventories_statut_check CHECK ((statut = ANY (ARRAY['SOUMIS'::text, 'APPROUVE'::text, 'REFUSE'::text])))
);
create table public.rcn_jute_inventory_frequencies (
  scope_type text not null, frequency_days integer not null,
  updated_at timestamp with time zone default now() not null, updated_by uuid,
  constraint rcn_jute_inventory_frequencies_pkey PRIMARY KEY (scope_type),
  constraint rcn_jute_inventory_frequencies_frequency_days_check CHECK (((frequency_days >= 1) AND (frequency_days <= 90)))
);
create table public.rcn_jute_locations (
  code text not null, site_code text, warehouse_code text, nom text not null,
  type text default 'STOCK'::text not null, actif boolean default true not null,
  created_at timestamp with time zone default now() not null, scope_type text, cluster text, rt_id text,
  producteur_id text, actor_type text, actor_code text,
  constraint rcn_jute_locations_pkey PRIMARY KEY (code),
  constraint rcn_jute_locations_actor_type_check CHECK (((actor_type IS NULL) OR (actor_type = ANY (ARRAY['FACTORY'::text, 'EXTERNAL_WAREHOUSE'::text, 'CLUSTER'::text, 'RT'::text, 'PRODUCTEUR'::text, 'LBA'::text, 'SUPPLIER'::text])))),
  constraint rcn_jute_locations_type_check CHECK ((type = ANY (ARRAY['STOCK'::text, 'RECEPTION'::text, 'REPARATION'::text, 'REBUT'::text, 'TRANSIT'::text, 'REBGAGING'::text])))
);
create table public.rcn_jute_loss_requests (
  id text not null, supplier_code text, location_code text, state text, qty integer not null,
  ledger text not null, motif text not null, proof_url text, statut text default 'SOUMIS'::text not null,
  submitted_by uuid, decided_by uuid, submitted_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone, commentaire_decision text,
  constraint rcn_jute_loss_requests_pkey PRIMARY KEY (id),
  constraint rcn_jute_loss_requests_ledger_check CHECK ((ledger = ANY (ARRAY['FOURNISSEUR'::text, 'INTERNE'::text]))),
  constraint rcn_jute_loss_requests_qty_check CHECK ((qty > 0)),
  constraint rcn_jute_loss_requests_statut_check CHECK ((statut = ANY (ARRAY['SOUMIS'::text, 'APPROUVE'::text, 'REFUSE'::text, 'ANNULE'::text])))
);
create table public.rcn_jute_movements (
  id text not null, event_key text not null, movement_type text not null, ledger text not null,
  supplier_code text, qty integer not null, from_location text, to_location text, from_state text,
  to_state text, reception_id text, lot_id text, bin_id text, source_type text, source_id text,
  reference text not null, note text, proof_url text, movement_at timestamp with time zone default now() not null,
  created_by uuid, created_at timestamp with time zone default now() not null,
  owner_type text default 'ANAGROCI'::text not null, campaign text, bale_count integer default 0 not null,
  loose_bags integer default 0 not null, unit_cost numeric, total_cost numeric, cluster text, rt_id text,
  producteur_id text, legacy_sacs_id uuid, bag_movement_request_id uuid,
  constraint rcn_jute_movements_event_key_key UNIQUE (event_key),
  constraint rcn_jute_movements_pkey PRIMARY KEY (id),
  constraint rcn_jute_movements_check CHECK ((((ledger = 'FOURNISSEUR'::text) AND (supplier_code IS NOT NULL)) OR (ledger = 'INTERNE'::text))),
  constraint rcn_jute_movements_from_state_check CHECK (((from_state IS NULL) OR (from_state = ANY (ARRAY['UTILISABLE'::text, 'PLEIN'::text, 'HUMIDE'::text, 'A_REPARER'::text, 'REPARE'::text, 'DECHIRE'::text, 'REFORME'::text, 'EN_TRANSIT'::text, 'A_CLASSER'::text])))),
  constraint rcn_jute_movements_ledger_check CHECK ((ledger = ANY (ARRAY['FOURNISSEUR'::text, 'INTERNE'::text]))),
  constraint rcn_jute_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['SOLDE_INITIAL'::text, 'ACHAT'::text, 'DOTATION'::text, 'RETOUR'::text, 'TRANSFERT'::text, 'CLASSEMENT'::text, 'REPARATION_SORTIE'::text, 'REPARATION_RETOUR'::text, 'REBAGING'::text, 'REFORME'::text, 'PERTE_APPROUVEE'::text, 'AJUSTEMENT_INVENTAIRE'::text]))),
  constraint rcn_jute_movements_qty_check CHECK ((qty > 0)),
  constraint rcn_jute_movements_to_state_check CHECK (((to_state IS NULL) OR (to_state = ANY (ARRAY['UTILISABLE'::text, 'PLEIN'::text, 'HUMIDE'::text, 'A_REPARER'::text, 'REPARE'::text, 'DECHIRE'::text, 'REFORME'::text, 'EN_TRANSIT'::text, 'A_CLASSER'::text])))),
  constraint rcn_jute_owner_check CHECK ((owner_type = ANY (ARRAY['ANAGROCI'::text, 'FOURNISSEUR'::text, 'INCONNU'::text])))
);
create table public.rcn_jute_settings (
  id text default 'DEFAULT'::text not null, bags_per_bale integer default 500 not null,
  alert_threshold integer default 100000 not null, average_fill_kg numeric default 80 not null,
  initial_reference integer default 300000 not null, updated_at timestamp with time zone default now() not null,
  updated_by uuid, inventory_frequency_days integer default 7 not null,
  constraint rcn_jute_settings_pkey PRIMARY KEY (id)
);
create table public.rcn_jute_transfers (
  id text not null, from_location text not null, to_location text not null, state text not null,
  qty_sent integer not null, qty_received integer, vehicle text, driver text, document_ref text not null,
  statut text default 'PREPARE'::text not null, sent_by uuid, received_by uuid,
  sent_at timestamp with time zone, received_at timestamp with time zone, ecart integer, motif_ecart text,
  proof_url text, created_at timestamp with time zone default now() not null,
  constraint rcn_jute_transfers_document_ref_key UNIQUE (document_ref),
  constraint rcn_jute_transfers_pkey PRIMARY KEY (id),
  constraint rcn_jute_transfers_qty_received_check CHECK ((qty_received >= 0)),
  constraint rcn_jute_transfers_qty_sent_check CHECK ((qty_sent > 0)),
  constraint rcn_jute_transfers_statut_check CHECK ((statut = ANY (ARRAY['PREPARE'::text, 'EXPEDIE'::text, 'RECU'::text, 'ECART'::text, 'CLOS'::text, 'ANNULE'::text])))
);
create table public.rcn_jute_receipt_lines (
  id text not null, entity_type text not null, entity_id text not null, qty integer not null, outcome text,
  document_ref text not null, proof_url text, received_at timestamp with time zone default now() not null,
  received_by uuid,
  constraint rcn_jute_receipt_lines_entity_type_entity_id_document_ref_o_key UNIQUE (entity_type, entity_id, document_ref, outcome),
  constraint rcn_jute_receipt_lines_pkey PRIMARY KEY (id),
  constraint rcn_jute_receipt_lines_entity_type_check CHECK ((entity_type = ANY (ARRAY['ACHAT'::text, 'TRANSFERT'::text, 'REPARATION'::text]))),
  constraint rcn_jute_receipt_lines_qty_check CHECK ((qty > 0))
);
create table public.rt (
  id text not null, data jsonb not null, nom text, telephone text, village_id text, village_nom text,
  statut text default 'Pressenti'::text not null, score integer default 0,
  created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null,
  created_by text, updated_by text, deleted boolean default false not null, cluster text, id_rt text,
  constraint rt_pkey PRIMARY KEY (id)
);
create table public.sacs_mouvements (
  id uuid default gen_random_uuid() not null, local_id text, date date default CURRENT_DATE not null,
  type text not null, source text not null, destination text not null, cluster text, village_id text,
  village_nom text, rt_id text, rt_nom text, producteur_id text, producteur_nom text,
  quantite integer not null, observation text, document_url text, created_by_nom text,
  created_by uuid default auth.uid(), created_at timestamp with time zone default now() not null,
  request_id uuid, bag_movement_code text, approved_qty integer, executed_qty integer, bag_state text,
  lot_id text, business_status text, issued_by uuid, issued_at timestamp with time zone, received_by uuid,
  received_at timestamp with time zone, correction_of uuid, producteur_code text,
  constraint sacs_mouvements_local_id_key UNIQUE (local_id),
  constraint sacs_mouvements_pkey PRIMARY KEY (id),
  constraint sacs_mouvements_quantite_check CHECK ((quantite > 0))
);
create table public.villages (
  id text not null, data jsonb not null, village text, statut text default 'Brouillon'::text not null,
  deleted boolean default false not null, cluster text, cluster_code text,
  constraint villages_pkey PRIMARY KEY (id)
);
