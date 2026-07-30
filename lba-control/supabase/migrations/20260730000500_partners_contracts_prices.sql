-- =============================================================================
-- LBA Control · 0500 · Référentiel, sociétés partenaires, contrats, prix
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Référentiel géographique et logistique
-- -----------------------------------------------------------------------------

create table products (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  unit       text not null default 'kg',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table zones (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table localities (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  zone_id    uuid references zones(id) on delete set null,
  name       text not null,
  gps_lat    numeric(10,7),
  gps_lng    numeric(10,7),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, zone_id, name)
);

create table sites (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  code         text not null,
  name         text not null,
  type         site_type not null,
  locality_id  uuid references localities(id) on delete set null,
  address      text,
  capacity_kg  numeric(14,3) check (capacity_kg >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (tenant_id, code)
);

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  code         text not null,
  full_name    text not null,
  phone        text,
  id_document  text,
  locality_id  uuid references localities(id) on delete set null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  unique (tenant_id, code)
);

create index suppliers_name_idx on suppliers (tenant_id, lower(full_name));

create table transporters (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table vehicles (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  transporter_id uuid references transporters(id) on delete set null,
  tractor_plate  text not null,
  trailer_plate  text,
  known_tare_kg  numeric(14,3) check (known_tare_kg >= 0),
  capacity_kg    numeric(14,3) check (capacity_kg > 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create unique index vehicles_plates_uidx
  on vehicles (tenant_id, tractor_plate, coalesce(trailer_plate, ''));

comment on column vehicles.known_tare_kg is
  'Tare historique du véhicule. Une tare de pesée qui s''en écarte déclenche une alerte : '
  'c''est le premier signal d''une pesée douteuse.';

create table weighbridges (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  code               text not null,
  name               text not null,
  site_id            uuid references sites(id) on delete set null,
  calibration_status calibration_status not null default 'inconnu',
  calibrated_at      date,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (tenant_id, code)
);

-- -----------------------------------------------------------------------------
-- Sociétés partenaires
-- -----------------------------------------------------------------------------

create table partner_companies (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  code                      text not null,
  name                      text not null,
  contact_name              text,
  phone                     text,
  email                     text,
  address                   text,
  status                    partner_status not null default 'active',
  -- Surcharges de la cascade contrat → société → tenant
  weight_tolerance_pct      numeric(9,4) check (weight_tolerance_pct >= 0),
  acceptance_tolerance_pct  numeric(9,4) check (acceptance_tolerance_pct >= 0),
  external_access_enabled   boolean not null default false,  -- portail P2, désactivé au MVP
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  updated_by                uuid,
  unique (tenant_id, code)
);

comment on table partner_companies is
  'OLAM, DORADO, ANAGROCI… Un même LBA travaille avec plusieurs sociétés simultanément. '
  'Une société ne voit jamais les données d''une autre, et la désactivation n''efface aucune donnée.';

-- -----------------------------------------------------------------------------
-- Campagnes
-- -----------------------------------------------------------------------------

create table campaigns (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  code         text not null,
  name         text not null,
  start_date   date not null,
  end_date     date not null,
  status       campaign_status not null default 'ouverte',
  closed_at    timestamptz,
  closed_by    uuid,
  reopened_at  timestamptz,
  reopened_by  uuid,
  reopen_reason text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  unique (tenant_id, code),
  constraint campaign_dates_ordered check (end_date >= start_date),
  -- Une réouverture sans motif serait indéfendable en audit (RG-14).
  constraint campaign_reopen_requires_reason check (
    reopened_at is null or length(btrim(coalesce(reopen_reason, ''))) >= 10
  )
);

-- -----------------------------------------------------------------------------
-- Contrats
-- -----------------------------------------------------------------------------

create table contracts (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  partner_company_id       uuid not null references partner_companies(id),
  campaign_id              uuid not null references campaigns(id),
  product_id               uuid not null references products(id),
  reference                text not null,
  target_volume_kg         numeric(14,3) check (target_volume_kg > 0),
  start_date               date not null,
  end_date                 date not null,
  delivery_site_id         uuid references sites(id) on delete set null,
  delivery_place           text,
  kor_min                  numeric(9,4) check (kor_min >= 0),
  humidity_max             numeric(9,4) check (humidity_max >= 0),
  impurities_max           numeric(9,4) check (impurities_max >= 0),
  weight_tolerance_pct     numeric(9,4) check (weight_tolerance_pct >= 0),
  acceptance_tolerance_pct numeric(9,4) check (acceptance_tolerance_pct >= 0),
  payment_terms            text,
  payment_delay_days       integer check (payment_delay_days >= 0),
  lba_commission_value     numeric(18,2) check (lba_commission_value >= 0),
  lba_commission_mode      commission_mode not null default 'aucune',
  -- Arbitrages D1 et D2, paramétrables par contrat : les trancher ne demandera
  -- aucune migration.
  coverage_basis           coverage_basis not null default 'reception_accepted',
  valuation_price_basis    valuation_price_basis not null default 'net_reconnu',
  status                   contract_status not null default 'brouillon',
  activated_at             timestamptz,
  closed_at                timestamptz,
  cancelled_at             timestamptz,
  cancelled_by             uuid,
  cancellation_reason      text,
  proof_path               text,
  negotiated_by            uuid,
  validated_by             uuid,
  created_at               timestamptz not null default now(),
  created_by               uuid,
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  unique (tenant_id, reference),
  constraint contract_dates_ordered check (end_date >= start_date)
);

create index contracts_partner_idx  on contracts (tenant_id, partner_company_id, status);
create index contracts_campaign_idx on contracts (tenant_id, campaign_id);

comment on column contracts.coverage_basis is
  'Fait générateur de la couverture d''une avance (arbitrage D1). Défaut : réception acceptée, '
  'conformément à la recommandation du dossier de conception et du dossier de maquettes.';

-- -----------------------------------------------------------------------------
-- Prix négociés · historisés, jamais écrasés
-- -----------------------------------------------------------------------------

create table negotiated_prices (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  contract_id        uuid not null references contracts(id) on delete cascade,
  price_type         price_type not null,
  price              numeric(18,2) not null check (price > 0),
  currency           text not null default 'XOF',
  valid_from         date not null,
  valid_to           date,
  quality_conditions jsonb not null default '{}'::jsonb,
  justification      text,
  proof_path         text,
  version            integer not null default 1 check (version > 0),
  superseded_by      uuid references negotiated_prices(id),
  is_provisional     boolean not null default false,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  constraint price_period_ordered check (valid_to is null or valid_to >= valid_from),

  -- Deux prix actifs du même type ne peuvent pas se chevaucher sur un même
  -- contrat : sans cela, « le prix applicable à cette date » n'aurait pas de
  -- réponse unique, et la valorisation deviendrait arbitraire.
  constraint negotiated_prices_no_overlap exclude using gist (
    contract_id with =,
    price_type with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  )
);

create index negotiated_prices_lookup_idx
  on negotiated_prices (tenant_id, contract_id, price_type, valid_from desc);

comment on table negotiated_prices is
  'Un prix actif n''est JAMAIS écrasé (CMD §6). Toute révision insère une nouvelle version avec date '
  'd''effet et justification. Un prix expiré reste lié aux opérations passées : les achats et transferts '
  'conservent une copie du prix applicable à la date de l''opération.';
