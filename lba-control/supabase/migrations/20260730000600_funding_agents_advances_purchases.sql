-- =============================================================================
-- LBA Control · 0600 · Financements, pisteurs, avances, achats terrain
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Financements reçus des sociétés partenaires
-- -----------------------------------------------------------------------------

create table fundings (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  partner_company_id  uuid not null references partner_companies(id),
  contract_id         uuid references contracts(id),
  campaign_id         uuid not null references campaigns(id),
  amount              numeric(18,2) not null check (amount > 0),
  currency            text not null default 'XOF',
  received_at         date not null,
  reference           text,
  payment_method      payment_method not null,
  reference_price     numeric(18,2) check (reference_price > 0),
  coverage_deadline   date,
  proof_path          text,
  status              funding_status not null default 'recu',
  notes               text,
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  cancellation_reason text,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,

  -- Indicatif uniquement : ne remplace jamais le volume réellement accepté.
  theoretical_volume_kg numeric(18,3)
    generated always as (
      case when reference_price is not null and reference_price > 0
           then round(amount / reference_price, 3) end
    ) stored
);

create index fundings_partner_idx  on fundings (tenant_id, partner_company_id, received_at desc);
create index fundings_campaign_idx on fundings (tenant_id, campaign_id);
create index fundings_deadline_idx on fundings (tenant_id, coverage_deadline)
  where coverage_deadline is not null;

comment on column fundings.theoretical_volume_kg is
  'montant / prix_de_référence — donnée INFORMATIVE (CMD §7). Ne remplace jamais le volume accepté.';

comment on table fundings is
  'Les financements sont toujours séparés par société partenaire. Une avance ou une livraison pour '
  'DORADO ne couvre jamais automatiquement un financement OLAM : la contrainte est portée par la '
  'cohérence de partner_company_id tout au long de la chaîne, et vérifiée par test.';

-- -----------------------------------------------------------------------------
-- Pisteurs
-- -----------------------------------------------------------------------------

create table field_agents (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  user_id              uuid references users(id) on delete set null,
  code                 text not null,
  full_name            text not null,
  phone                text,
  id_document          text,
  zone_id              uuid references zones(id) on delete set null,
  mobile_money_account text,
  ceiling_amount       numeric(18,2) not null default 0 check (ceiling_amount >= 0),
  activation_date      date,
  status               agent_status not null default 'actif',
  supervisor_id        uuid references users(id) on delete set null,
  commission_mode      commission_mode not null default 'aucune',
  commission_value     numeric(18,4) not null default 0 check (commission_value >= 0),
  suspension_reason    text,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  unique (tenant_id, code)
);

create unique index field_agents_user_uidx on field_agents (user_id) where user_id is not null;
create index field_agents_zone_idx on field_agents (tenant_id, zone_id);

comment on column field_agents.user_id is
  'Compte utilisateur du pisteur (hypothèse H-03). C''est ce lien qui permet à RLS de restreindre '
  'un pisteur à ses seules opérations. Un pisteur sans compte existe (saisie déléguée) mais ne '
  'bénéficie pas du mode hors ligne.';

create table field_agent_localities (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  field_agent_id uuid not null references field_agents(id) on delete cascade,
  locality_id    uuid not null references localities(id) on delete cascade,
  primary key (field_agent_id, locality_id)
);

-- Un pisteur peut travailler pour plusieurs sociétés, avec un plafond par société.
create table field_agent_partners (
  tenant_id          uuid not null references tenants(id) on delete cascade,
  field_agent_id     uuid not null references field_agents(id) on delete cascade,
  partner_company_id uuid not null references partner_companies(id) on delete cascade,
  ceiling_amount     numeric(18,2) check (ceiling_amount >= 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  primary key (field_agent_id, partner_company_id)
);

-- -----------------------------------------------------------------------------
-- Avances aux pisteurs
-- -----------------------------------------------------------------------------

create table advances (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  field_agent_id        uuid not null references field_agents(id),
  partner_company_id    uuid not null references partner_companies(id),  -- origine des fonds
  funding_id            uuid references fundings(id),
  contract_id           uuid references contracts(id),
  campaign_id           uuid not null references campaigns(id),
  amount                numeric(18,2) not null check (amount > 0),
  currency              text not null default 'XOF',
  issued_at             timestamptz not null default now(),
  payment_method        payment_method not null,
  reference             text,
  zone_id               uuid references zones(id) on delete set null,
  volume_target_kg      numeric(14,3) check (volume_target_kg > 0),
  max_purchase_price    numeric(18,2) check (max_purchase_price > 0),
  justification_deadline date,
  proof_path            text,
  status                advance_status not null default 'brouillon',

  -- Dépassement de plafond : autorisé UNIQUEMENT par dérogation explicite et
  -- tracée. Jamais un blocage définitif automatique (H-11).
  requires_override     boolean not null default false,
  override_reason       text,
  override_approved_by  uuid,
  override_approved_at  timestamptz,

  submitted_by          uuid,
  approved_by           uuid,
  approved_at           timestamptz,
  disbursed_at          timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid,
  cancellation_reason   text,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,

  -- Séparation des tâches : le créateur d'une avance ne peut pas l'approuver
  -- lui-même (CDC §5, DCP §3.1).
  constraint advance_creator_is_not_approver check (
    approved_by is null or created_by is null or approved_by <> created_by
  ),
  -- Une dérogation sans motif ni approbateur n'est pas une dérogation.
  constraint advance_override_is_justified check (
    not requires_override
    or (override_approved_by is not null and length(btrim(coalesce(override_reason, ''))) >= 10)
    or status in ('brouillon', 'soumis', 'annule')
  )
);

create index advances_agent_idx    on advances (tenant_id, field_agent_id, issued_at desc);
create index advances_partner_idx  on advances (tenant_id, partner_company_id);
create index advances_funding_idx  on advances (tenant_id, funding_id);
create index advances_status_idx   on advances (tenant_id, status);
create index advances_deadline_idx on advances (tenant_id, justification_deadline)
  where justification_deadline is not null;

comment on table advances is
  'Une avance est un ACTIF à justifier, jamais une charge. Elle n''apparaît dans aucune table de '
  'dépenses et n''entre jamais dans le TCB tant qu''elle n''est pas convertie en achat ou en dépense '
  'validée (RG-05).';

-- -----------------------------------------------------------------------------
-- Couverture FIFO des avances
-- -----------------------------------------------------------------------------

create table advance_allocations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  advance_id    uuid not null references advances(id) on delete cascade,
  source_type   advance_allocation_source not null,
  source_id     uuid not null,
  amount        numeric(18,2) not null check (amount > 0),
  allocated_at  timestamptz not null default now(),
  is_manual     boolean not null default false,
  approved_by   uuid,
  reason        text,
  created_at    timestamptz not null default now(),
  created_by    uuid,

  -- Une correction manuelle de l'affectation FIFO est possible, mais seulement
  -- approuvée et motivée (CMD §10, arbitrage D4).
  constraint manual_allocation_is_approved check (
    not is_manual or (approved_by is not null and length(btrim(coalesce(reason, ''))) >= 5)
  ),
  unique (advance_id, source_type, source_id)
);

create index advance_allocations_advance_idx on advance_allocations (tenant_id, advance_id, allocated_at);
create index advance_allocations_source_idx  on advance_allocations (tenant_id, source_type, source_id);

comment on table advance_allocations is
  'Allocation FIFO : les premières livraisons couvrent les premières avances. Une livraison peut '
  'couvrir plusieurs avances et une avance être couverte par plusieurs livraisons. L''âge du reliquat '
  'conserve la date de l''avance d''origine, pas celle de la dernière remise.';

create table advance_repayments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  advance_id     uuid not null references advances(id) on delete cascade,
  amount         numeric(18,2) not null check (amount > 0),
  repaid_at      date not null,
  payment_method payment_method not null,
  reference      text,
  proof_path     text,
  notes          text,
  cancelled_at   timestamptz,
  cancelled_by   uuid,
  cancellation_reason text,
  created_at     timestamptz not null default now(),
  created_by     uuid
);

create index advance_repayments_advance_idx on advance_repayments (tenant_id, advance_id);

-- -----------------------------------------------------------------------------
-- Achats terrain
-- -----------------------------------------------------------------------------
-- L'identifiant est fourni par l'appareil (UUID hors ligne). C'est lui qui rend
-- la synchronisation idempotente : un rejeu n'insère rien de nouveau.

create table purchases (
  id                    uuid primary key,            -- généré par l'appareil
  tenant_id             uuid not null references tenants(id) on delete cascade,
  field_agent_id        uuid not null references field_agents(id),
  partner_company_id    uuid references partner_companies(id),
  campaign_id           uuid not null references campaigns(id),
  contract_id           uuid references contracts(id),
  funding_id            uuid references fundings(id),
  advance_id            uuid references advances(id),
  supplier_id           uuid references suppliers(id),
  supplier_name         text,                        -- vendeur occasionnel non référencé
  locality_id           uuid references localities(id),
  village               text,
  gps_lat               numeric(10,7),
  gps_lng               numeric(10,7),
  purchased_at          timestamptz not null,        -- date et heure RÉELLES de l'achat
  gross_weight_kg       numeric(14,3) check (gross_weight_kg >= 0),
  tare_kg               numeric(14,3) not null default 0 check (tare_kg >= 0),
  net_weight_kg         numeric(14,3) not null check (net_weight_kg > 0),
  price_per_kg          numeric(18,2) not null check (price_per_kg > 0),
  amount                numeric(18,2) not null check (amount > 0),
  bag_count             integer check (bag_count >= 0),
  kor                   numeric(9,4) check (kor >= 0),
  humidity              numeric(9,4) check (humidity >= 0),
  impurities            numeric(9,4) check (impurities >= 0),
  payment_method        payment_method not null,
  payment_reference     text,
  proof_path            text,
  is_own_account        boolean not null default false,
  status                purchase_status not null default 'brouillon',

  -- Instantané du prix applicable à la date de l'opération : une révision de
  -- prix ultérieure ne doit jamais réécrire le passé.
  applied_price_id      uuid references negotiated_prices(id),
  applied_price_value   numeric(18,2),
  price_override_reason text,

  -- Bloc hors ligne (CMD §19)
  sync_status           sync_status not null default 'pending',
  device_id             text,
  created_at_device     timestamptz,
  created_at_server     timestamptz not null default now(),
  sync_attempts         integer not null default 0 check (sync_attempts >= 0),
  last_sync_error       text,
  last_sync_attempt_at  timestamptz,
  local_version         integer not null default 1 check (local_version > 0),

  cancelled_at          timestamptz,
  cancelled_by          uuid,
  cancellation_reason   text,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,

  -- Arbitrage D9 : un achat propre du LBA (sans financement société) est
  -- autorisé, mais seulement s'il est explicitement déclaré comme tel.
  constraint purchase_partner_or_own_account check (
    partner_company_id is not null or is_own_account
  ),
  -- Le montant doit correspondre au produit poids × prix : sans cette
  -- contrainte, un montant saisi à la main pourrait diverger silencieusement du
  -- poids qui alimente le stock.
  constraint purchase_amount_matches_weight_and_price check (
    abs(amount - round(net_weight_kg * price_per_kg, 2)) <= 1
  ),
  constraint purchase_net_weight_consistent check (
    gross_weight_kg is null or abs(net_weight_kg - (gross_weight_kg - tare_kg)) <= 0.001
  ),
  constraint purchase_cancel_is_justified check (
    status <> 'annule'
    or (cancelled_at is not null and length(btrim(coalesce(cancellation_reason, ''))) >= 5)
  )
);

create index purchases_agent_idx    on purchases (tenant_id, field_agent_id, purchased_at desc);
create index purchases_partner_idx  on purchases (tenant_id, partner_company_id);
create index purchases_advance_idx  on purchases (tenant_id, advance_id);
create index purchases_campaign_idx on purchases (tenant_id, campaign_id, purchased_at desc);
create index purchases_sync_idx     on purchases (tenant_id, sync_status) where sync_status <> 'synced';
create index purchases_supplier_idx on purchases (tenant_id, supplier_id);

comment on column purchases.id is
  'UUID généré hors ligne par l''appareil. Clé de l''idempotence : INSERT ... ON CONFLICT (id) '
  'DO NOTHING garantit qu''un rejeu de synchronisation ne crée jamais de doublon.';

-- -----------------------------------------------------------------------------
-- Doublons probables d'achats
-- -----------------------------------------------------------------------------
-- Signalés, jamais bloqués automatiquement : un doublon probable reste une
-- hypothèse tant qu'un humain ne l'a pas confirmée.

create table purchase_duplicate_flags (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  purchase_id       uuid not null references purchases(id) on delete cascade,
  candidate_id      uuid not null references purchases(id) on delete cascade,
  similarity_score  numeric(5,2) not null check (similarity_score between 0 and 100),
  matched_criteria  text[] not null,
  status            text not null default 'a_verifier'
                      check (status in ('a_verifier', 'confirme', 'ecarte')),
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz not null default now(),
  constraint duplicate_flag_distinct_rows check (purchase_id <> candidate_id),
  unique (purchase_id, candidate_id)
);

create index purchase_duplicate_flags_status_idx
  on purchase_duplicate_flags (tenant_id, status) where status = 'a_verifier';

comment on column purchase_duplicate_flags.matched_criteria is
  'Critères ayant déclenché le signalement : pisteur, vendeur, date, poids, montant, localisation, '
  'référence de paiement. La géolocalisation pondère le score mais ne constitue jamais une preuve '
  'unique (CMD §11).';
