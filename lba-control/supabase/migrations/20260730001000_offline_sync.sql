-- =============================================================================
-- LBA Control · 1000 · Journal serveur de synchronisation hors ligne
-- =============================================================================
-- Miroir serveur de la file IndexedDB. Il ne sert pas à stocker les données
-- métier (elles vont dans purchases, expenses, etc.) mais à PROUVER qu'aucune
-- opération n'a disparu entre l'appareil et la base — l'exigence la plus
-- exposée du produit, puisqu'un pisteur travaille en réseau instable.
-- =============================================================================

create table sync_operations (
  id                 uuid primary key,           -- UUID généré par l'appareil
  tenant_id          uuid not null references tenants(id) on delete cascade,
  user_id            uuid not null references users(id),
  device_id          text not null,
  entity_type        text not null,
  entity_id          uuid not null,
  operation          text not null default 'insert'
                       check (operation in ('insert', 'update', 'cancel')),
  status             sync_status not null default 'pending',
  attempts           integer not null default 0 check (attempts >= 0),
  last_error         text,
  last_attempt_at    timestamptz,
  created_at_device  timestamptz not null,
  created_at_server  timestamptz not null default now(),
  synced_at          timestamptz,
  local_version      integer not null default 1 check (local_version > 0),
  payload_hash       text,
  conflict_detected  boolean not null default false,
  conflict_details   jsonb
);

create index sync_operations_device_idx  on sync_operations (tenant_id, device_id, created_at_device);
create index sync_operations_user_idx    on sync_operations (tenant_id, user_id, status);
create index sync_operations_pending_idx on sync_operations (tenant_id, status)
  where status in ('pending', 'syncing', 'failed');
create index sync_operations_entity_idx  on sync_operations (tenant_id, entity_type, entity_id);

comment on table sync_operations is
  'Journal de synchronisation. Aucune ligne n''est jamais supprimée, y compris après succès : '
  'c''est la preuve, en cas de contestation, qu''une opération saisie sur le terrain est bien '
  'arrivée — ou qu''elle ne l''est pas.';

comment on column sync_operations.id is
  'UUID de l''appareil. INSERT ... ON CONFLICT (id) DO NOTHING rend la synchronisation idempotente : '
  'trois rejeux du même lot produisent une seule ligne (CA-03).';

comment on column sync_operations.conflict_detected is
  'Un conflit est AFFICHÉ à l''utilisateur, jamais résolu par écrasement silencieux (CDC §10.2).';

-- -----------------------------------------------------------------------------
-- Sessions de synchronisation
-- -----------------------------------------------------------------------------

create table sync_sessions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  user_id          uuid not null references users(id),
  device_id        text not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  operations_sent  integer not null default 0 check (operations_sent >= 0),
  operations_ok    integer not null default 0 check (operations_ok >= 0),
  operations_failed integer not null default 0 check (operations_failed >= 0),
  duplicates_skipped integer not null default 0 check (duplicates_skipped >= 0),
  network_quality  text,
  error_summary    text
);

create index sync_sessions_device_idx on sync_sessions (tenant_id, device_id, started_at desc);
