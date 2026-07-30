-- =============================================================================
-- LBA Control · 0200 · Plateforme, tenants, marque et paramètres
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Plateforme (hors tenant)
-- -----------------------------------------------------------------------------

create table platform_admins (
  user_id     uuid primary key,
  full_name   text not null,
  email       text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

comment on table platform_admins is
  'Super-administrateurs plateforme. Aucun tenant_id : ils n''appartiennent à aucune entreprise cliente.';

create table subscription_plans (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique,
  name                    text not null,
  description             text,
  monthly_amount          numeric(18,2) not null check (monthly_amount >= 0),
  setup_amount            numeric(18,2) not null default 0 check (setup_amount >= 0),
  currency                text not null default 'XOF',
  billing_period_months   integer not null default 1 check (billing_period_months > 0),
  max_users               integer check (max_users > 0),
  max_field_agents        integer check (max_field_agents > 0),
  max_partner_companies   integer check (max_partner_companies > 0),
  storage_mb              integer check (storage_mb > 0),
  modules                 jsonb not null default '{}'::jsonb,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Tenants
-- -----------------------------------------------------------------------------

create table tenants (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique
                     check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  commercial_name  text not null,
  legal_name       text not null,
  status           tenant_status not null default 'active',
  currency         text not null default 'XOF',
  language         text not null default 'fr',
  timezone         text not null default 'Africa/Abidjan',
  custom_domain    text unique,           -- réservé, hors MVP
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

comment on column tenants.slug is
  'Segment d''URL de résolution du tenant (app.lbacontrol.ci/<slug>). La liste des tenants n''est jamais exposée.';

-- -----------------------------------------------------------------------------
-- Mode d'assistance super-administrateur (CMD §4)
-- -----------------------------------------------------------------------------
-- Sans session active, motivée et non expirée, un super-administrateur ne lit
-- AUCUNE donnée métier. Ce n'est pas une convention d'interface : c'est ce que
-- la base autorise.

create table platform_support_sessions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  admin_user_id uuid not null references platform_admins(user_id),
  reason       text not null check (length(btrim(reason)) >= 10),
  granted_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoked_by   uuid,
  constraint support_session_expires_after_grant check (expires_at > granted_at)
);

create index on platform_support_sessions (tenant_id, expires_at desc);
create index on platform_support_sessions (admin_user_id);

comment on constraint support_session_expires_after_grant on platform_support_sessions is
  'Une session d''assistance a toujours une fin. Un accès permanent serait un accès non contrôlé.';

-- -----------------------------------------------------------------------------
-- Marque du tenant · deux couleurs, emplacements fixes (CMD §5)
-- -----------------------------------------------------------------------------

create table tenant_branding (
  tenant_id         uuid primary key references tenants(id) on delete cascade,
  commercial_name   text,
  legal_name        text,
  slogan            text,
  logo_path         text,
  logo_mobile_path  text,
  login_image_path  text,
  primary_color     text not null default '#1f6f43' check (primary_color   ~* '^#[0-9a-f]{6}$'),
  secondary_color   text not null default '#b45309' check (secondary_color ~* '^#[0-9a-f]{6}$'),
  phone             text,
  email             text,
  address           text,
  tax_id            text,
  document_footer   text,
  currency          text not null default 'XOF',
  language          text not null default 'fr',
  -- Contraste WCAG mesuré au moment de l'enregistrement : une couleur illisible
  -- est refusée avec sa mesure, elle n'est pas silencieusement acceptée.
  primary_contrast_ratio    numeric(5,2),
  secondary_contrast_ratio  numeric(5,2),
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);

comment on table tenant_branding is
  'Personnalisation encadrée : nom, logos, deux couleurs, coordonnées. Ni la structure des écrans, '
  'ni la typographie, ni les règles métier ne sont modifiables par le client.';

-- -----------------------------------------------------------------------------
-- Paramètres opérationnels du tenant
-- -----------------------------------------------------------------------------
-- Tous ces seuils sont surchargeables au niveau société partenaire puis contrat.
-- La résolution se fait en cascade : contrat → société → tenant → défaut.

create table tenant_settings (
  tenant_id                        uuid primary key references tenants(id) on delete cascade,
  default_weight_tolerance_pct     numeric(9,4) not null default 0.5   check (default_weight_tolerance_pct >= 0),
  default_acceptance_tolerance_pct numeric(9,4) not null default 1.0   check (default_acceptance_tolerance_pct >= 0),
  default_tare_variation_kg        numeric(14,3) not null default 100  check (default_tare_variation_kg >= 0),
  default_coverage_basis           coverage_basis not null default 'reception_accepted',
  default_valuation_price_basis    valuation_price_basis not null default 'net_reconnu',
  default_allocation_key           allocation_key not null default 'poids_accepte',
  advance_justification_days       integer not null default 7  check (advance_justification_days > 0),
  advance_block_uncovered_days     integer not null default 7  check (advance_block_uncovered_days > 0),
  no_delivery_warning_days         integer not null default 3  check (no_delivery_warning_days > 0),
  no_delivery_critical_days        integer not null default 5  check (no_delivery_critical_days > 0),
  transit_max_days                 integer not null default 3  check (transit_max_days > 0),
  receipt_required_above           numeric(18,2) not null default 50000 check (receipt_required_above >= 0),
  subscription_grace_days          integer not null default 5  check (subscription_grace_days between 0 and 30),
  subscription_readonly_days       integer not null default 30 check (subscription_readonly_days > 0),
  score_rule_version               text not null default 'v1',
  updated_at                       timestamptz not null default now(),
  updated_by                       uuid
);

comment on column tenant_settings.subscription_grace_days is
  'Arbitrage D11 (3, 5 ou 7 jours) non tranché par le métier : valeur initiale 5, paramétrable sans migration.';
