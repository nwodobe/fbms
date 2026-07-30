-- =============================================================================
-- LBA Control · 0800 · Incidents, dépenses, TCB, marges, scoring, alertes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Incidents et litiges
-- -----------------------------------------------------------------------------

create table incidents (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  reference                 text not null,
  type                      incident_type not null,
  severity                  incident_severity not null default 'moderee',
  campaign_id               uuid references campaigns(id),
  partner_company_id        uuid references partner_companies(id),
  field_agent_id            uuid references field_agents(id),
  related_table             text,
  related_id                uuid,
  transfer_id               uuid references transfers(id),
  description               text not null,
  exposed_amount            numeric(18,2) check (exposed_amount >= 0),
  exposed_quantity_kg       numeric(14,3) check (exposed_quantity_kg >= 0),
  suspected_responsible_type text check (
    suspected_responsible_type in ('pisteur', 'transporteur', 'magasin', 'societe', 'inconnu')
  ),
  suspected_responsible_id  uuid,
  status                    incident_status not null default 'ouvert',
  assigned_to               uuid,
  investigation_notes       text,
  decision                  text,
  decision_cause            incident_cause,
  validated_by              uuid,
  validated_at              timestamptz,
  opened_at                 timestamptz not null default now(),
  closed_at                 timestamptz,
  reopened_at               timestamptz,
  reopen_reason             text,
  blocks_closure            boolean not null default true,
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  updated_by                uuid,
  unique (tenant_id, reference),
  -- Une décision d'incident engage une responsabilité : elle exige une cause
  -- qualifiée et un valideur. Fermer sans décider serait effacer le problème.
  constraint incident_decision_is_qualified check (
    status not in ('decide', 'cloture')
    or (decision_cause is not null and validated_by is not null
        and length(btrim(coalesce(decision, ''))) >= 5)
  ),
  constraint incident_reopen_is_justified check (
    reopened_at is null or length(btrim(coalesce(reopen_reason, ''))) >= 5
  )
);

create index incidents_status_idx   on incidents (tenant_id, status, severity);
create index incidents_agent_idx    on incidents (tenant_id, field_agent_id);
create index incidents_transfer_idx on incidents (tenant_id, transfer_id);
create index incidents_related_idx  on incidents (tenant_id, related_table, related_id);

comment on column incidents.suspected_responsible_type is
  'RESPONSABLE PRÉSUMÉ, jamais établi automatiquement. Un écart de poids peut venir de l''humidité, '
  'du pont-bascule, du transport ou d''une erreur de saisie : l''imputer d''office au pisteur serait '
  'une accusation fabriquée par le logiciel (CMD §14, DMQ E14).';

comment on column incidents.blocks_closure is
  'Un incident ouvert au-dessus de la tolérance empêche la clôture du transfert tant qu''aucune '
  'décision n''est prise.';

create table incident_evidences (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  incident_id uuid not null references incidents(id) on delete cascade,
  label       text not null,
  file_path   text,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

-- -----------------------------------------------------------------------------
-- Catégories de dépenses · les 23 catégories imposées (CMD §16)
-- -----------------------------------------------------------------------------

create table expense_categories (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  code                     text not null,
  label                    text not null,
  family                   text not null,
  is_direct                boolean not null default true,
  default_allocation_key   allocation_key not null default 'poids_accepte',
  requires_receipt_above   numeric(18,2),
  cap_amount               numeric(18,2),
  -- Réservée au système : la valeur d'achat vient de purchases, jamais d'une
  -- dépense saisie à la main. C'est ce qui empêche le double comptage du TCB.
  is_system_reserved       boolean not null default false,
  is_controllable_by_agent boolean not null default false,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  unique (tenant_id, code)
);

comment on column expense_categories.is_system_reserved is
  'achat_produit et commission_pisteur (générée) existent au référentiel mais sont refusées en saisie '
  'manuelle : sinon le prix d''achat serait compté deux fois dans le TCB (INC-05).';

comment on column expense_categories.is_controllable_by_agent is
  'Détermine ce qui entre dans la composante « maîtrise du TCB » du score. Un pisteur ne doit être '
  'évalué que sur les coûts qu''il contrôle réellement (CDC §13.4, arbitrage D6).';

-- -----------------------------------------------------------------------------
-- Dépenses
-- -----------------------------------------------------------------------------

create table expenses (
  id                    uuid primary key,           -- UUID appareil (saisie hors ligne possible)
  tenant_id             uuid not null references tenants(id) on delete cascade,
  category_id           uuid not null references expense_categories(id),
  partner_company_id    uuid references partner_companies(id),
  campaign_id           uuid not null references campaigns(id),
  contract_id           uuid references contracts(id),
  field_agent_id        uuid references field_agents(id),
  stock_lot_id          uuid references stock_lots(id),
  transfer_id           uuid references transfers(id),
  expense_date          date not null,
  amount                numeric(18,2) not null check (amount > 0),
  currency              text not null default 'XOF',
  beneficiary           text not null,
  beneficiary_user_id   uuid,
  payment_method        payment_method not null,
  reference             text,
  proof_path            text,
  nature                expense_nature not null default 'direct',
  allocation_key        allocation_key,
  status                expense_status not null default 'brouillon',
  submitted_by          uuid,
  submitted_at          timestamptz,
  validated_by          uuid,
  validated_at          timestamptz,
  rejected_by           uuid,
  rejected_at           timestamptz,
  rejection_reason      text,
  paid_at               date,
  paid_amount           numeric(18,2) check (paid_amount >= 0),
  is_system_generated   boolean not null default false,

  -- Bloc hors ligne
  sync_status           sync_status not null default 'synced',
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

  -- Séparation des tâches : une dépense ne peut pas être validée par son
  -- bénéficiaire (DCP §3.1).
  constraint expense_beneficiary_is_not_validator check (
    beneficiary_user_id is null or validated_by is null or validated_by <> beneficiary_user_id
  ),
  constraint expense_rejection_is_justified check (
    status <> 'rejetee'
    or (rejected_by is not null and length(btrim(coalesce(rejection_reason, ''))) >= 5)
  ),
  constraint expense_cancel_is_justified check (
    status <> 'annulee'
    or (cancelled_at is not null and length(btrim(coalesce(cancellation_reason, ''))) >= 5)
  ),
  constraint expense_indirect_has_key check (
    nature <> 'indirect' or allocation_key is not null
  )
);

create index expenses_category_idx  on expenses (tenant_id, category_id, expense_date desc);
create index expenses_partner_idx   on expenses (tenant_id, partner_company_id);
create index expenses_agent_idx     on expenses (tenant_id, field_agent_id);
create index expenses_transfer_idx  on expenses (tenant_id, transfer_id);
create index expenses_status_idx    on expenses (tenant_id, status);
create index expenses_sync_idx      on expenses (tenant_id, sync_status) where sync_status <> 'synced';
create index expenses_duplicate_idx on expenses (tenant_id, expense_date, amount, lower(beneficiary));

comment on table expenses is
  'Une dépense REJETÉE ou ANNULÉE n''entre jamais dans le TCB. Une dépense VALIDÉE mais non payée y '
  'entre (critère de recette DCP §12). Une avance n''est pas une dépense et n''apparaît pas ici.';

create table expense_duplicate_flags (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  expense_id       uuid not null references expenses(id) on delete cascade,
  candidate_id     uuid not null references expenses(id) on delete cascade,
  similarity_score numeric(5,2) not null check (similarity_score between 0 and 100),
  matched_criteria text[] not null,
  status           text not null default 'a_verifier'
                     check (status in ('a_verifier', 'confirme', 'ecarte')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint expense_duplicate_distinct_rows check (expense_id <> candidate_id),
  unique (expense_id, candidate_id)
);

-- -----------------------------------------------------------------------------
-- Allocations de dépenses indirectes
-- -----------------------------------------------------------------------------
-- Chaque clé et chaque résultat sont historisés (RG-10) : une quote-part dont
-- on ne peut pas reconstituer le calcul n'est pas auditable.

create table expense_allocations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  expense_id       uuid not null references expenses(id) on delete cascade,
  target_type      allocation_target not null,
  target_id        uuid not null,
  allocation_key   allocation_key not null,
  base_value       numeric(18,4) not null check (base_value >= 0),
  total_base_value numeric(18,4) not null check (total_base_value > 0),
  share_ratio      numeric(12,8) not null check (share_ratio >= 0 and share_ratio <= 1),
  allocated_amount numeric(18,2) not null check (allocated_amount >= 0),
  computed_at      timestamptz not null default now(),
  rule_version     text not null default 'v1',
  is_manual        boolean not null default false,
  approved_by      uuid,
  reason           text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  constraint manual_expense_allocation_is_approved check (
    not is_manual or (approved_by is not null and length(btrim(coalesce(reason, ''))) >= 5)
  ),
  unique (expense_id, target_type, target_id)
);

create index expense_allocations_target_idx on expense_allocations (tenant_id, target_type, target_id);

-- -----------------------------------------------------------------------------
-- TCB et marges · instantanés explicables
-- -----------------------------------------------------------------------------

create table tcb_snapshots (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  scope_type                allocation_target not null,
  scope_id                  uuid not null,
  campaign_id               uuid references campaigns(id),
  period_start              date,
  period_end                date,
  is_forecast               boolean not null default false,
  computed_at               timestamptz not null default now(),
  rule_version              text not null default 'v1',

  accepted_weight_kg        numeric(14,3) check (accepted_weight_kg >= 0),
  loaded_weight_kg          numeric(14,3),
  unloaded_weight_kg        numeric(14,3),
  paid_weight_kg            numeric(14,3),

  purchase_value            numeric(18,2) not null default 0,
  direct_expenses           numeric(18,2) not null default 0,
  indirect_allocated        numeric(18,2) not null default 0,
  valued_losses             numeric(18,2) not null default 0,
  tcb_total                 numeric(18,2) not null default 0,
  -- NULL et non zéro quand le poids accepté est nul : un TCB/kg de 0 serait un
  -- mensonge, une valeur absente est une information exacte (H-04).
  tcb_per_accepted_kg       numeric(18,4),

  net_sale_price            numeric(18,2),
  net_revenue               numeric(18,2),
  margin_total              numeric(18,2),
  margin_per_kg             numeric(18,4),
  -- Écart assumé entre les deux définitions de marge de la commande (INC-06).
  margin_reconciliation_gap numeric(18,2),

  is_deficit                boolean,
  inputs                    jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  created_by                uuid
);

create index tcb_snapshots_scope_idx on tcb_snapshots (tenant_id, scope_type, scope_id, computed_at desc);

comment on column tcb_snapshots.inputs is
  'Transactions sources ayant produit le calcul. Chaque KPI doit être explicable par ses '
  'transactions (CDC §2.1) : sans cette trace, le TCB serait une boîte noire.';

create table tcb_snapshot_components (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  snapshot_id  uuid not null references tcb_snapshots(id) on delete cascade,
  component    text not null,
  amount       numeric(18,2) not null,
  amount_per_kg numeric(18,4),
  source_count integer,
  created_at   timestamptz not null default now()
);

create index tcb_snapshot_components_idx on tcb_snapshot_components (tenant_id, snapshot_id);

-- -----------------------------------------------------------------------------
-- Scoring des pisteurs · explicable, versionné, jamais punitif d'office
-- -----------------------------------------------------------------------------

create table agent_scores (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  field_agent_id uuid not null references field_agents(id) on delete cascade,
  campaign_id    uuid references campaigns(id),
  period_start   date,
  period_end     date,
  computed_at    timestamptz not null default now(),
  raw_score      numeric(6,2) check (raw_score between 0 and 100),
  adjusted_score numeric(6,2) check (adjusted_score between 0 and 100),
  category       score_category not null default 'non_evalue',
  maturity       score_maturity not null default 'non_evalue',
  rule_version   text not null default 'v1',
  recommended_ceiling numeric(18,2) check (recommended_ceiling >= 0),
  excluded_events jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  created_by     uuid
);

create index agent_scores_agent_idx on agent_scores (tenant_id, field_agent_id, computed_at desc);

comment on column agent_scores.recommended_ceiling is
  'RECOMMANDATION, jamais appliquée automatiquement (DMQ E06). Le score suggère une décision, '
  'il ne la prend pas.';

comment on column agent_scores.maturity is
  'Un nouveau pisteur est « non évalué » puis « en observation » : le noter comme un pisteur établi '
  'sur trois opérations produirait une décision injuste.';

create table agent_score_components (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  score_id      uuid not null references agent_scores(id) on delete cascade,
  component     score_component_code not null,
  weight        numeric(5,2) not null check (weight >= 0),
  value         numeric(6,2) not null check (value between 0 and 100),
  weighted_value numeric(8,4) not null,
  source_data   jsonb not null default '{}'::jsonb,
  excluded_events jsonb not null default '[]'::jsonb,
  explanation   text,
  created_at    timestamptz not null default now(),
  unique (score_id, component)
);

comment on table agent_score_components is
  'Une ligne par composante avec son poids, sa valeur, ses données sources et les événements exclus. '
  'Somme des poids = 100 : couverture 20, délais 15, écarts 15, prix 10, qualité 10, justificatifs 10, '
  'sacs 5, régularité 5, TCB contrôlable 10.';

create table agent_score_adjustments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  score_id     uuid not null references agent_scores(id) on delete cascade,
  delta        numeric(6,2) not null,
  reason       text not null check (length(btrim(reason)) >= 10),
  adjusted_by  uuid not null,
  adjusted_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table agent_score_adjustments is
  'Ajustement humain motivé. Il modifie le score AFFICHÉ, jamais les données sources : le score brut '
  'reste reconstituable (RG-12).';

create table external_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  field_agent_id uuid references field_agents(id) on delete cascade,
  transfer_id    uuid references transfers(id) on delete set null,
  event_type     text not null check (event_type in (
    'camion_indisponible', 'refus_reception', 'panne_pont_bascule', 'pluie',
    'blocage_administratif', 'retard_financement', 'autre'
  )),
  description    text not null,
  occurred_from  date not null,
  occurred_to    date,
  validated_by   uuid,
  validated_at   timestamptz,
  proof_path     text,
  created_at     timestamptz not null default now(),
  created_by     uuid
);

create index external_events_agent_idx on external_events (tenant_id, field_agent_id, occurred_from desc);

comment on table external_events is
  'Événements externes VALIDÉS qui expliquent un retard sans qu''il soit imputable au pisteur. '
  'Produisent le score ajusté affiché à côté du score brut (principe d''équité, DCP §8.2).';

-- -----------------------------------------------------------------------------
-- Alertes · 20 types, seuils configurables
-- -----------------------------------------------------------------------------

create table alert_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  alert_type  alert_type not null,
  severity    alert_severity not null default 'surveillance',
  threshold   jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (tenant_id, alert_type)
);

create table alerts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  alert_type         alert_type not null,
  severity           alert_severity not null,
  title              text not null,
  message            text not null,
  campaign_id        uuid references campaigns(id),
  partner_company_id uuid references partner_companies(id),
  field_agent_id     uuid references field_agents(id),
  related_table      text,
  related_id         uuid,
  measured_value     numeric(18,4),
  threshold_value    numeric(18,4),
  status             alert_status not null default 'ouverte',
  raised_at          timestamptz not null default now(),
  acknowledged_by    uuid,
  acknowledged_at    timestamptz,
  resolved_at        timestamptz,
  resolution_note    text,
  dedupe_key         text,
  created_at         timestamptz not null default now()
);

create index alerts_open_idx  on alerts (tenant_id, status, severity, raised_at desc);
create index alerts_agent_idx on alerts (tenant_id, field_agent_id) where status = 'ouverte';
create unique index alerts_dedupe_uidx
  on alerts (tenant_id, dedupe_key) where dedupe_key is not null and status = 'ouverte';

comment on index alerts_dedupe_uidx is
  'Empêche qu''une même condition génère cent alertes identiques : une alerte répétée cent fois '
  'n''est plus lue par personne.';

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid references users(id) on delete cascade,
  channel     notification_channel not null default 'in_app',
  title       text not null,
  body        text not null,
  alert_id    uuid references alerts(id) on delete set null,
  sent_at     timestamptz,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_user_idx on notifications (tenant_id, user_id, created_at desc);
