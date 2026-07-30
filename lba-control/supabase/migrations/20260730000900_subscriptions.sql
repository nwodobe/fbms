-- =============================================================================
-- LBA Control · 0900 · Abonnements, factures, paiements, événements
-- =============================================================================
-- Règle non négociable : une déclaration de paiement par le client ne change
-- AUCUN statut. Seule une confirmation vérifiée par un super-administrateur
-- (ou, plus tard, un webhook serveur signé) active ou prolonge un abonnement.
-- Une capture d'écran est donc structurellement insuffisante — pas par
-- convention d'interface, mais parce que la base ne l'accepte pas.
-- =============================================================================

create table subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  plan_id             uuid not null references subscription_plans(id),
  status              subscription_status not null default 'trial',
  period_start        date not null,
  period_end          date not null,
  trial_end           date,
  grace_days          integer not null default 5 check (grace_days between 0 and 30),
  readonly_after_days integer not null default 30 check (readonly_after_days > 0),
  grace_started_at    timestamptz,
  read_only_at        timestamptz,
  blocked_at          timestamptz,
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  cancellation_reason text,
  suspended_by        uuid,
  suspension_reason   text,
  reactivated_by      uuid,
  reactivated_at      timestamptz,
  amount              numeric(18,2) not null check (amount >= 0),
  currency            text not null default 'XOF',
  auto_renew          boolean not null default false,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  constraint subscription_period_ordered check (period_end >= period_start),
  constraint subscription_suspension_is_justified check (
    status not in ('suspended', 'suspended_read_only')
    or length(btrim(coalesce(suspension_reason, ''))) >= 5
  )
);

-- Un tenant n'a qu'un abonnement courant : deux abonnements actifs
-- simultanés rendraient l'état d'accès indéterminé.
create unique index subscriptions_active_uidx
  on subscriptions (tenant_id)
  where status not in ('cancelled', 'expired');

create index subscriptions_status_idx on subscriptions (status, period_end);

comment on column subscriptions.status is
  '9 statuts. suspended_read_only (J+5 : écriture bloquée, lecture et export autorisés) est distinct '
  'de suspended (J+30 : accès opérationnel bloqué, données conservées). Sans cette distinction, le '
  'cycle décrit par le cahier des charges ne serait pas représentable (INC-03).';

-- -----------------------------------------------------------------------------
-- Factures
-- -----------------------------------------------------------------------------

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  number          text not null,
  amount          numeric(18,2) not null check (amount >= 0),
  amount_paid     numeric(18,2) not null default 0 check (amount_paid >= 0),
  currency        text not null default 'XOF',
  issued_at       date not null default current_date,
  due_date        date not null,
  period_start    date not null,
  period_end      date not null,
  status          invoice_status not null default 'issued',
  cancelled_at    timestamptz,
  cancellation_reason text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  unique (tenant_id, number)
);

create index invoices_due_idx on invoices (tenant_id, due_date, status);

-- -----------------------------------------------------------------------------
-- Paiements d'abonnement
-- -----------------------------------------------------------------------------

create table subscription_payments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  invoice_id      uuid references invoices(id) on delete set null,
  amount          numeric(18,2) not null check (amount > 0),
  currency        text not null default 'XOF',
  method          payment_method not null,
  reference       text not null,
  payer           text,
  declared_at     timestamptz not null default now(),
  declared_by     uuid,
  proof_path      text,
  status          subscription_payment_status not null default 'declared',
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  verifier_note   text,
  rejected_reason text,
  -- Deux paiements ne peuvent pas partager la même référence : c'est ce qui
  -- empêche qu'un même règlement prolonge la période deux fois.
  unique (tenant_id, method, reference),
  constraint payment_confirmation_has_verifier check (
    status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null)
  ),
  constraint payment_rejection_is_justified check (
    status <> 'rejected' or length(btrim(coalesce(rejected_reason, ''))) >= 5
  )
);

create index subscription_payments_sub_idx    on subscription_payments (tenant_id, subscription_id, declared_at desc);
create index subscription_payments_status_idx on subscription_payments (status) where status = 'declared';

comment on table subscription_payments is
  'Un paiement DÉCLARÉ par le client ne modifie aucun statut. Seul app.confirm_subscription_payment(), '
  'réservée au super-administrateur, confirme et prolonge. Un paiement partiel est conservé comme avoir '
  'et ne renouvelle pas la période (CDC §20.5).';

-- -----------------------------------------------------------------------------
-- Événements d'abonnement · rappels, changements, idempotence
-- -----------------------------------------------------------------------------

create table subscription_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  event_type      subscription_event_type not null,
  old_status      subscription_status,
  new_status      subscription_status,
  payment_id      uuid references subscription_payments(id) on delete set null,
  -- Clé d'idempotence : un même rappel ou un même paiement ne peut jamais être
  -- traité deux fois, y compris si un webhook est rejoué (CDC §23.1).
  idempotency_key text,
  payload         jsonb not null default '{}'::jsonb,
  actor_user_id   uuid,
  reason          text,
  occurred_at     timestamptz not null default now()
);

create unique index subscription_events_idempotency_uidx
  on subscription_events (tenant_id, idempotency_key) where idempotency_key is not null;

create index subscription_events_sub_idx on subscription_events (tenant_id, subscription_id, occurred_at desc);

comment on index subscription_events_idempotency_uidx is
  'Test d''idempotence exigé : un même webhook ou paiement ne prolonge jamais deux fois la période.';

-- -----------------------------------------------------------------------------
-- Avoirs et remboursements
-- -----------------------------------------------------------------------------

create table subscription_credits (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  payment_id      uuid references subscription_payments(id) on delete set null,
  amount          numeric(18,2) not null check (amount > 0),
  currency        text not null default 'XOF',
  origin          text not null check (origin in ('paiement_partiel', 'remboursement', 'geste_commercial', 'correction')),
  reason          text not null,
  consumed_at     timestamptz,
  expires_at      date,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

comment on table subscription_credits is
  'Un paiement partiel devient un avoir : il est conservé et visible, mais ne renouvelle pas la '
  'période. Toute remise ou activation exceptionnelle a une date de fin et un auteur (CDC §26.2).';

-- -----------------------------------------------------------------------------
-- Plan par défaut · offre de lancement (CDC §26.1)
-- -----------------------------------------------------------------------------

insert into subscription_plans
  (code, name, description, monthly_amount, setup_amount, currency, billing_period_months,
   max_users, max_field_agents, max_partner_companies, storage_mb, modules)
values
  ('standard', 'Standard',
   'Offre de lancement : 1 LBA, jusqu''à 5 utilisateurs, paramétrage standard, 1 formation.',
   50000, 300000, 'XOF', 1, 5, 50, 5, 5120,
   '{"terrain":true,"stocks":true,"transferts":true,"tcb":true,"scoring":true,"exports":true}'::jsonb),
  ('essai', 'Essai',
   'Période d''essai limitée avant souscription.',
   0, 0, 'XOF', 1, 3, 10, 2, 512,
   '{"terrain":true,"stocks":true,"transferts":true,"tcb":false,"scoring":false,"exports":false}'::jsonb);
