-- =============================================================================
-- LBA Control · 0300 · Utilisateurs, rôles, appareils
-- =============================================================================

create table users (
  id                 uuid primary key,             -- = auth.users.id
  tenant_id          uuid references tenants(id) on delete cascade,
  role               user_role not null,
  full_name          text not null,
  email              text,
  phone              text,
  status             user_status not null default 'active',
  mfa_enrolled_at    timestamptz,                  -- MFA « préparé » (CMD §23)
  last_login_at      timestamptz,
  failed_login_count integer not null default 0 check (failed_login_count >= 0),
  locked_until       timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,

  -- Un super-administrateur n'appartient à aucun tenant ; tout autre rôle en a
  -- obligatoirement un. Sans cette contrainte, un utilisateur métier sans tenant
  -- échapperait à toutes les politiques d'isolation.
  constraint users_tenant_matches_role check (
    (role = 'super_admin' and tenant_id is null)
    or (role <> 'super_admin' and tenant_id is not null)
  )
);

create unique index users_email_per_tenant_uidx
  on users (tenant_id, lower(email)) where email is not null;
create index users_tenant_role_idx on users (tenant_id, role) where tenant_id is not null;

comment on column users.role is
  '10 rôles (union des documents sources, INC-02). magasinier, logistique et partenaire_externe '
  'sont définis et protégés par RLS mais non attribuables depuis l''interface MVP.';

-- -----------------------------------------------------------------------------
-- Rôles attribuables au MVP
-- -----------------------------------------------------------------------------
-- Aucune exigence n'est supprimée : les rôles reportés existent, ils sont
-- simplement marqués non attribuables, ce qui est réversible sans migration.

create table assignable_roles (
  role          user_role primary key,
  is_assignable boolean not null default true,
  note          text
);

insert into assignable_roles (role, is_assignable, note) values
  ('super_admin',         true,  'Console plateforme'),
  ('proprietaire',        true,  null),
  ('gestionnaire',        true,  null),
  ('comptable',           true,  null),
  ('responsable_terrain', true,  null),
  ('pisteur',             true,  null),
  ('auditeur',            true,  null),
  ('magasinier',          false, 'CDC §5 / DCP §3 — politiques écrites, activation post-MVP'),
  ('logistique',          false, 'CDC §5 — politiques écrites, activation post-MVP'),
  ('partenaire_externe',  false, 'Portail société partenaire reporté en P2 (DCP §11)');

-- -----------------------------------------------------------------------------
-- Appareils
-- -----------------------------------------------------------------------------

create table user_devices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  device_id     text not null,               -- généré et persisté par l'appareil
  label         text,
  platform      text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  unique (tenant_id, user_id, device_id)
);

create index user_devices_tenant_idx on user_devices (tenant_id, user_id);

comment on table user_devices is
  'Un appareil révoqué ne peut plus synchroniser. Sert aussi à détecter le partage de compte '
  'et les sessions concurrentes anormales (CDC §20).';
