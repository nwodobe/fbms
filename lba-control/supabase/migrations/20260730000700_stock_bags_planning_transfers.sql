-- =============================================================================
-- LBA Control · 0700 · Stocks, lots, sacherie, planning, transferts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lots de stock
-- -----------------------------------------------------------------------------
-- Le statut porte EXACTEMENT les 9 valeurs imposées. La localisation
-- (« chez pisteur » / « en magasin ») est portée par holder_type : mélanger les
-- deux axes produirait des états contradictoires (INC-04).

create table stock_lots (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  code                text not null,
  campaign_id         uuid not null references campaigns(id),
  partner_company_id  uuid references partner_companies(id),
  contract_id         uuid references contracts(id),
  field_agent_id      uuid references field_agents(id),
  product_id          uuid not null references products(id),
  site_id             uuid references sites(id),
  holder_type         holder_type not null,
  holder_id           uuid,
  quantity_kg         numeric(14,3) not null check (quantity_kg >= 0),
  bag_count           integer check (bag_count >= 0),
  kor                 numeric(9,4) check (kor >= 0),
  humidity            numeric(9,4) check (humidity >= 0),
  status              stock_status not null default 'disponible',
  opened_at           date not null default current_date,
  closed_at           timestamptz,
  is_own_account      boolean not null default false,
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  unique (tenant_id, code),
  constraint stock_lot_partner_or_own_account check (
    partner_company_id is not null or is_own_account
  )
);

create index stock_lots_partner_idx  on stock_lots (tenant_id, partner_company_id, status);
create index stock_lots_agent_idx    on stock_lots (tenant_id, field_agent_id);
create index stock_lots_holder_idx   on stock_lots (tenant_id, holder_type, holder_id);
create index stock_lots_campaign_idx on stock_lots (tenant_id, campaign_id, status);

comment on constraint stock_lots_quantity_kg_check on stock_lots is
  'Stock négatif interdit (CDC §11.2). Une quantité négative n''est pas une donnée : c''est un aveu '
  'que la traçabilité a été perdue quelque part en amont.';

comment on column stock_lots.holder_type is
  'field_agent = « chez pisteur », warehouse = « en magasin », in_transit, partner_site. '
  'Restitue les états du CDC §11.1 sans surcharger status.';

-- -----------------------------------------------------------------------------
-- Grand livre des mouvements de matière
-- -----------------------------------------------------------------------------

create table stock_movements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  stock_lot_id   uuid not null references stock_lots(id) on delete cascade,
  type           stock_movement_type not null,
  quantity_kg    numeric(14,3) not null,
  bag_count      integer,
  occurred_at    timestamptz not null default now(),
  source_table   text,
  source_id      uuid,
  reason         text,
  approved_by    uuid,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  constraint stock_movement_quantity_not_zero check (quantity_kg <> 0),
  -- Une perte ou une correction sans motif est indéfendable en audit.
  constraint stock_movement_exception_is_justified check (
    type not in ('perte', 'correction', 'reaffectation')
    or length(btrim(coalesce(reason, ''))) >= 5
  )
);

create index stock_movements_lot_idx    on stock_movements (tenant_id, stock_lot_id, occurred_at desc);
create index stock_movements_source_idx on stock_movements (tenant_id, source_table, source_id);

-- -----------------------------------------------------------------------------
-- Réservations · la double réservation est structurellement impossible
-- -----------------------------------------------------------------------------

create table stock_reservations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  stock_lot_id     uuid not null references stock_lots(id) on delete cascade,
  delivery_plan_id uuid,
  partner_company_id uuid not null references partner_companies(id),
  quantity_kg      numeric(14,3) not null check (quantity_kg > 0),
  status           reservation_status not null default 'active',
  reserved_at      timestamptz not null default now(),
  released_at      timestamptz,
  released_by      uuid,
  release_reason   text,
  created_at       timestamptz not null default now(),
  created_by       uuid
);

create index stock_reservations_lot_active_idx
  on stock_reservations (tenant_id, stock_lot_id) where status = 'active';
create index stock_reservations_plan_idx
  on stock_reservations (tenant_id, delivery_plan_id);

comment on table stock_reservations is
  'Une quantité réservée pour OLAM ne peut pas être promise à DORADO (RG-06). La somme des '
  'réservations actives d''un lot ne peut jamais dépasser sa quantité : garanti par la fonction '
  'transactionnelle app.reserve_stock() qui verrouille la ligne du lot, et par un trigger de '
  'contrôle — l''interface n''est pas seule à décider.';

-- -----------------------------------------------------------------------------
-- Réaffectation inter-sociétés · approbation obligatoire
-- -----------------------------------------------------------------------------

create table stock_reassignments (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  stock_lot_id             uuid not null references stock_lots(id),
  from_partner_company_id  uuid not null references partner_companies(id),
  to_partner_company_id    uuid not null references partner_companies(id),
  quantity_kg              numeric(14,3) not null check (quantity_kg > 0),
  reason                   text not null check (length(btrim(reason)) >= 10),
  approved_by              uuid not null,
  approved_at              timestamptz not null default now(),
  proof_path               text,
  created_at               timestamptz not null default now(),
  created_by               uuid,
  constraint reassignment_changes_partner check (
    from_partner_company_id <> to_partner_company_id
  ),
  -- Séparation des tâches : demander et approuver soi-même une réaffectation
  -- inter-sociétés reviendrait à supprimer le contrôle.
  constraint reassignment_approver_is_not_requester check (
    created_by is null or approved_by <> created_by
  )
);

create index stock_reassignments_lot_idx on stock_reassignments (tenant_id, stock_lot_id);

-- -----------------------------------------------------------------------------
-- Sacherie multi-sociétés
-- -----------------------------------------------------------------------------

create table bag_stocks (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  partner_company_id uuid references partner_companies(id),
  holder_type        holder_type not null,
  holder_id          uuid,
  bag_count          integer not null default 0 check (bag_count >= 0),
  updated_at         timestamptz not null default now()
);

create unique index bag_stocks_scope_uidx
  on bag_stocks (tenant_id, coalesce(partner_company_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 holder_type, coalesce(holder_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table bag_movements (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  partner_company_id uuid references partner_companies(id),
  type               bag_movement_type not null,
  quantity           integer not null check (quantity <> 0),
  from_holder_type   holder_type,
  from_holder_id     uuid,
  to_holder_type     holder_type,
  to_holder_id       uuid,
  field_agent_id     uuid references field_agents(id),
  purchase_id        uuid references purchases(id),
  transfer_id        uuid,
  occurred_at        timestamptz not null default now(),
  reason             text,
  approved_by        uuid,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  constraint bag_exception_is_justified check (
    type not in ('perte', 'reaffectation') or length(btrim(coalesce(reason, ''))) >= 5
  )
);

create index bag_movements_agent_idx on bag_movements (tenant_id, field_agent_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Planning de livraison
-- -----------------------------------------------------------------------------

create table delivery_plans (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  reference            text not null,
  partner_company_id   uuid not null references partner_companies(id),
  contract_id          uuid references contracts(id),
  campaign_id          uuid not null references campaigns(id),
  planned_date         date not null,
  planned_volume_kg    numeric(14,3) not null check (planned_volume_kg > 0),
  origin_site_id       uuid references sites(id),
  destination_site_id  uuid references sites(id),
  field_agent_id       uuid references field_agents(id),
  vehicle_id           uuid references vehicles(id),
  transporter_id       uuid references transporters(id),
  priority             priority_level not null default 'normale',
  status               delivery_plan_status not null default 'brouillon',
  confirmed_at         timestamptz,
  confirmed_by         uuid,
  postponed_at         timestamptz,
  postpone_reason      text,
  cancelled_at         timestamptz,
  cancelled_by         uuid,
  cancellation_reason  text,
  notes                text,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  unique (tenant_id, reference),
  -- Un report sans motif efface la responsabilité de la promesse non tenue.
  constraint plan_postpone_is_justified check (
    postponed_at is null or length(btrim(coalesce(postpone_reason, ''))) >= 5
  ),
  constraint plan_cancel_is_justified check (
    status <> 'annule'
    or (cancelled_at is not null and length(btrim(coalesce(cancellation_reason, ''))) >= 5)
  )
);

create index delivery_plans_date_idx    on delivery_plans (tenant_id, planned_date);
create index delivery_plans_partner_idx on delivery_plans (tenant_id, partner_company_id, status);
create index delivery_plans_status_idx  on delivery_plans (tenant_id, status);

alter table stock_reservations
  add constraint stock_reservations_plan_fk
  foreign key (delivery_plan_id) references delivery_plans(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Transferts · LES QUATRE POIDS
-- -----------------------------------------------------------------------------
-- chargé, déchargé, accepté, payé sont quatre colonnes distinctes et non
-- écrasables. Aucun champ générique « poids livré » n'existe dans ce schéma :
-- c'est l'exigence structurante du produit (RG-08).

create table transfers (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  transfer_number          text not null,
  partner_company_id       uuid not null references partner_companies(id),
  contract_id              uuid references contracts(id),
  campaign_id              uuid not null references campaigns(id),
  delivery_plan_id         uuid references delivery_plans(id),

  -- ---------- Chargement ----------
  origin_site_id           uuid references sites(id),
  dispatched_at            timestamptz,
  transporter_id           uuid references transporters(id),
  vehicle_id               uuid references vehicles(id),
  driver_name              text,
  driver_phone             text,
  tractor_plate            text,
  trailer_plate            text,
  gross_weight_kg          numeric(14,3) check (gross_weight_kg >= 0),
  tare_kg                  numeric(14,3) check (tare_kg >= 0),
  net_loaded_kg            numeric(14,3) check (net_loaded_kg >= 0),
  bag_count_loaded         integer check (bag_count_loaded >= 0),
  kor_departure            numeric(9,4) check (kor_departure >= 0),
  humidity_departure       numeric(9,4) check (humidity_departure >= 0),
  weighbridge_id           uuid references weighbridges(id),
  weighing_ticket_path     text,
  weight_source            weight_source not null default 'declared',
  loading_responsible      text,

  -- ---------- Réception ----------
  arrived_at               timestamptz,
  unloaded_at              timestamptz,
  destination_site_id      uuid references sites(id),
  gross_weight_reception_kg numeric(14,3) check (gross_weight_reception_kg >= 0),
  tare_reception_kg        numeric(14,3) check (tare_reception_kg >= 0),
  net_unloaded_kg          numeric(14,3) check (net_unloaded_kg >= 0),
  accepted_kg              numeric(14,3) check (accepted_kg >= 0),
  paid_kg                  numeric(14,3) check (paid_kg >= 0),
  bag_count_received       integer check (bag_count_received >= 0),
  bag_count_damaged        integer check (bag_count_damaged >= 0),
  kor_reception            numeric(9,4) check (kor_reception >= 0),
  humidity_reception       numeric(9,4) check (humidity_reception >= 0),
  rejected_kg              numeric(14,3) check (rejected_kg >= 0),
  rejection_reason         text,
  reception_ticket_path    text,
  receiver_name            text,

  -- ---------- Valorisation ----------
  applied_price_id         uuid references negotiated_prices(id),
  applied_price_value      numeric(18,2),
  recognized_amount        numeric(18,2) check (recognized_amount >= 0),

  status                   transfer_status not null default 'brouillon',
  closed_at                timestamptz,
  closed_by                uuid,
  cancelled_at             timestamptz,
  cancelled_by             uuid,
  cancellation_reason      text,
  created_at               timestamptz not null default now(),
  created_by               uuid,
  updated_at               timestamptz not null default now(),
  updated_by               uuid,

  -- ---------- Écarts (colonnes générées) ----------
  -- Les deux formulations des documents sources sont conservées : aucune n'est
  -- arbitrée à la place du métier (INC-01).
  ecart_physique_kg numeric(14,3)
    generated always as (net_loaded_kg - net_unloaded_kg) stored,
  ecart_physique_pct numeric(12,6)
    generated always as (
      case when net_loaded_kg is not null and net_loaded_kg > 0 and net_unloaded_kg is not null
           then (net_loaded_kg - net_unloaded_kg) / net_loaded_kg * 100 end
    ) stored,
  ecart_acceptation_kg numeric(14,3)          -- CMD §14
    generated always as (net_unloaded_kg - accepted_kg) stored,
  ecart_paiement_kg numeric(14,3)             -- CMD §14
    generated always as (accepted_kg - paid_kg) stored,
  ecart_total_acceptation_kg numeric(14,3)    -- CDC §12.3
    generated always as (net_loaded_kg - accepted_kg) stored,
  ecart_financier_total_kg numeric(14,3)      -- CDC §12.3
    generated always as (net_loaded_kg - paid_kg) stored,
  tare_variation_kg numeric(14,3)
    generated always as (tare_reception_kg - tare_kg) stored,

  unique (tenant_id, transfer_number),
  constraint transfer_net_loaded_consistent check (
    gross_weight_kg is null or tare_kg is null or net_loaded_kg is null
    or abs(net_loaded_kg - (gross_weight_kg - tare_kg)) <= 0.001
  ),
  constraint transfer_net_unloaded_consistent check (
    gross_weight_reception_kg is null or tare_reception_kg is null or net_unloaded_kg is null
    or abs(net_unloaded_kg - (gross_weight_reception_kg - tare_reception_kg)) <= 0.001
  ),
  -- Le poids accepté ne peut pas dépasser le poids réellement déchargé, ni le
  -- poids payé dépasser le poids accepté : sinon la chaîne des quatre poids
  -- perdrait tout sens.
  constraint transfer_accepted_within_unloaded check (
    accepted_kg is null or net_unloaded_kg is null or accepted_kg <= net_unloaded_kg + 0.001
  ),
  constraint transfer_paid_within_accepted check (
    paid_kg is null or accepted_kg is null or paid_kg <= accepted_kg + 0.001
  ),
  constraint transfer_cancel_is_justified check (
    status <> 'annule'
    or (cancelled_at is not null and length(btrim(coalesce(cancellation_reason, ''))) >= 5)
  )
);

create index transfers_partner_idx  on transfers (tenant_id, partner_company_id, dispatched_at desc);
create index transfers_plan_idx     on transfers (tenant_id, delivery_plan_id);
create index transfers_status_idx   on transfers (tenant_id, status);
create index transfers_campaign_idx on transfers (tenant_id, campaign_id);
create index transfers_transit_idx  on transfers (tenant_id, dispatched_at)
  where status = 'en_transit';

comment on table transfers is
  'Quatre poids distincts et non écrasables : net_loaded_kg, net_unloaded_kg, accepted_kg, paid_kg. '
  'Aucun champ générique « poids livré » n''existe (RG-08, CA-05). Les cinq écarts sont des colonnes '
  'générées : ils ne peuvent donc pas être saisis à la main ni diverger des poids sources.';

comment on column transfers.weight_source is
  'verified / estimated_bags / declared. Sans cette distinction, un écart calculé sur une estimation '
  'serait traité comme un écart mesuré — et imputé à tort à quelqu''un.';

create table transfer_lots (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  transfer_id  uuid not null references transfers(id) on delete cascade,
  stock_lot_id uuid not null references stock_lots(id),
  quantity_kg  numeric(14,3) not null check (quantity_kg > 0),
  bag_count    integer check (bag_count >= 0),
  created_at   timestamptz not null default now(),
  primary key (transfer_id, stock_lot_id)
);

alter table bag_movements
  add constraint bag_movements_transfer_fk
  foreign key (transfer_id) references transfers(id) on delete set null;
