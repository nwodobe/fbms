-- =============================================================================
-- LBA Control · 0400 · Journal d'audit
-- =============================================================================
-- Le journal est alimenté exclusivement par triggers (migration 1300) et n'est
-- modifiable par personne : aucune politique UPDATE ni DELETE n'est créée sur
-- cette table, pour aucun rôle, y compris propriétaire et super-administrateur.
-- =============================================================================

create table audit_log (
  id            bigint generated always as identity primary key,
  tenant_id     uuid references tenants(id) on delete cascade,  -- null = action plateforme
  user_id       uuid,
  device_id     text,
  action        audit_action not null,
  table_name    text not null,
  record_id     text,
  old_value     jsonb,
  new_value     jsonb,
  changed_fields text[],
  occurred_at   timestamptz not null default now(),   -- horloge SERVEUR, jamais celle de l'appareil
  ip_address    inet,
  user_agent    text,
  justification text
);

create index audit_log_tenant_time_idx  on audit_log (tenant_id, occurred_at desc);
create index audit_log_record_idx       on audit_log (tenant_id, table_name, record_id);
create index audit_log_user_idx         on audit_log (tenant_id, user_id, occurred_at desc);
create index audit_log_action_idx       on audit_log (tenant_id, action, occurred_at desc);

comment on table audit_log is
  'Journal immuable. Journalise : connexion, création, modification, annulation, validation, '
  'changement de société, de poids, de prix, de montant, de statut, confirmation de paiement, '
  'suspension, réactivation et export sensible (CMD §22).';

comment on column audit_log.occurred_at is
  'Horloge serveur. L''horodatage de l''appareil est conservé ailleurs mais ne fait jamais foi : '
  'sinon un score ou une ancienneté d''avance serait manipulable depuis le terrain.';
