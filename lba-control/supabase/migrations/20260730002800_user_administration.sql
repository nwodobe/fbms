-- =============================================================================
-- LBA Control · 2800 · Administration des comptes et lecture du journal
-- =============================================================================
-- Deux écrans du périmètre étaient annoncés dans la navigation depuis la phase 1
-- et n'ont jamais été construits : la gestion des utilisateurs et le journal
-- d'audit consultable. Les règles existaient en base et étaient testées ; ce qui
-- manquait, c'était le moyen de s'en servir sans outil technique.
--
-- Ce fichier ajoute le peu de serveur qui manquait, et rien de plus :
--
--  · **changer un rôle** — avec les gardes qui empêchent une entreprise de se
--    fermer sa propre porte ou de s'attribuer des pouvoirs qu'elle n'a pas ;
--  · **suspendre un compte et révoquer un appareil** — sans jamais supprimer,
--    parce qu'un compte effacé emporte la lisibilité de tout ce qu'il a fait ;
--  · **lire le journal** — filtré, paginé, et sans jamais permettre d'y écrire.
--
-- ⚠ Ce fichier crée des fonctions : il se termine par une révocation explicite.
-- =============================================================================

/*
 * Change le rôle d'un utilisateur.
 *
 * Quatre refus, tous délibérés :
 *
 *  1. Un rôle non attribuable — magasinier, logistique, partenaire externe — a
 *     ses politiques écrites mais non activées. L'attribuer donnerait un compte
 *     dont personne ne sait ce qu'il peut faire.
 *
 *  2. Personne ne se change son propre rôle. Se promouvoir soi-même annule la
 *     séparation des tâches, et se rétrograder par erreur enferme dehors.
 *
 *  3. Le dernier propriétaire actif ne peut pas être rétrogradé. Une entreprise
 *     sans propriétaire ne peut plus rien administrer, et seul le support
 *     pourrait la rouvrir — c'est-à-dire une session d'assistance chez le
 *     client pour réparer un dégât évitable.
 *
 *  4. `super_admin` ne s'attribue pas depuis un tenant : c'est un rôle de
 *     plateforme, qui n'appartient à aucun client.
 */
create or replace function app.set_user_role(
  p_user_id uuid,
  p_role    user_role,
  p_reason  text
)
returns users
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_user      public.users;
  v_old       public.user_role;
  v_owners    integer;
begin
  if not app.can_manage_settings() then
    raise exception 'Votre profil ne permet pas de modifier les rôles.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Un changement de rôle se justifie : indiquez au moins 10 caractères de motif.'
      using errcode = 'check_violation';
  end if;

  if p_role = 'super_admin' then
    raise exception 'Le rôle de plateforme ne s''attribue pas depuis une entreprise.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.assignable_roles ar
                  where ar.role = p_role and ar.is_assignable) then
    raise exception
      'Le rôle « % » a ses politiques écrites mais non activées : l''attribuer donnerait un compte '
      'dont personne ne sait ce qu''il peut faire.', p_role
      using errcode = 'check_violation';
  end if;

  select * into v_user from public.users
   where id = p_user_id and tenant_id = app.current_tenant_id();

  if not found then
    raise exception 'Utilisateur introuvable dans votre entreprise.' using errcode = 'no_data_found';
  end if;

  if p_user_id = app.current_user_id() then
    raise exception
      'Vous ne pouvez pas changer votre propre rôle : se promouvoir soi-même annule la séparation '
      'des tâches, et se rétrograder par erreur enferme dehors.'
      using errcode = 'insufficient_privilege';
  end if;

  v_old := v_user.role;

  if v_old = 'proprietaire' and p_role <> 'proprietaire' then
    select count(*) into v_owners from public.users
     where tenant_id = app.current_tenant_id()
       and role = 'proprietaire' and status = 'active' and id <> p_user_id;

    if v_owners = 0 then
      raise exception
        'Ce compte est le dernier propriétaire actif. Le rétrograder laisserait l''entreprise sans '
        'personne pour l''administrer.'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.users
     set role = p_role, updated_at = now(), updated_by = app.current_user_id()
   where id = p_user_id
   returning * into v_user;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, old_value, new_value, justification)
  values
    (app.current_tenant_id(), app.current_user_id(), 'status_change', 'users', p_user_id::text,
     jsonb_build_object('role', v_old), jsonb_build_object('role', p_role), p_reason);

  return v_user;
end;
$$;

/*
 * Suspend ou réactive un compte.
 *
 * Jamais de suppression : un compte effacé emporte la lisibilité de tout ce
 * qu'il a fait, et le journal d'audit se met à désigner un identifiant sans
 * nom. La même garde du dernier propriétaire s'applique — suspendre le dernier
 * revient à fermer l'entreprise.
 */
create or replace function app.set_user_status(
  p_user_id uuid,
  p_status  user_status,
  p_reason  text
)
returns users
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_user   public.users;
  v_old    public.user_status;
  v_owners integer;
begin
  if not app.can_manage_settings() then
    raise exception 'Votre profil ne permet pas de suspendre un compte.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Une suspension se justifie : indiquez au moins 10 caractères de motif.'
      using errcode = 'check_violation';
  end if;

  select * into v_user from public.users
   where id = p_user_id and tenant_id = app.current_tenant_id();

  if not found then
    raise exception 'Utilisateur introuvable dans votre entreprise.' using errcode = 'no_data_found';
  end if;

  if p_user_id = app.current_user_id() then
    raise exception 'Vous ne pouvez pas suspendre votre propre compte.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_user.role = 'proprietaire' and p_status <> 'active' then
    select count(*) into v_owners from public.users
     where tenant_id = app.current_tenant_id()
       and role = 'proprietaire' and status = 'active' and id <> p_user_id;

    if v_owners = 0 then
      raise exception 'Ce compte est le dernier propriétaire actif : le suspendre ferme l''entreprise.'
        using errcode = 'check_violation';
    end if;
  end if;

  v_old := v_user.status;

  update public.users
     set status = p_status, updated_at = now(), updated_by = app.current_user_id()
   where id = p_user_id
   returning * into v_user;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, old_value, new_value, justification)
  values
    (app.current_tenant_id(), app.current_user_id(),
     (case when p_status = 'active' then 'reactivate' else 'suspend' end)::audit_action,
     'users', p_user_id::text,
     jsonb_build_object('status', v_old), jsonb_build_object('status', p_status), p_reason);

  return v_user;
end;
$$;

/*
 * Révoque un appareil.
 *
 * L'appareil est marqué, jamais supprimé : savoir qu'un téléphone a été révoqué
 * le 12 mars fait partie de l'enquête sur ce qu'il a saisi le 11.
 */
create or replace function app.revoke_device(p_device_row_id uuid, p_reason text)
returns user_devices
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_device public.user_devices;
begin
  if not app.can_manage_settings() then
    raise exception 'Votre profil ne permet pas de révoquer un appareil.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.user_devices
     set revoked_at = now(), revoked_by = app.current_user_id()
   where id = p_device_row_id
     and tenant_id = app.current_tenant_id()
     and revoked_at is null
   returning * into v_device;

  if not found then
    raise exception 'Appareil introuvable ou déjà révoqué.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (app.current_tenant_id(), app.current_user_id(), 'status_change', 'user_devices',
     p_device_row_id::text, jsonb_build_object('revoked_at', now()),
     coalesce(nullif(btrim(p_reason), ''), 'Appareil révoqué.'));

  return v_device;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lecture du journal
-- -----------------------------------------------------------------------------

/*
 * Journal d'audit, filtré et borné.
 *
 * Le journal grossit vite — 215 entrées pour le seul jeu de démonstration. Le
 * lire en entier depuis un navigateur est impraticable et inutile : on cherche
 * toujours quelque chose. La pagination est donc imposée ici, et non laissée au
 * bon vouloir de l'appelant.
 *
 * Aucune écriture n'est possible : le journal reste immuable, y compris pour
 * celui qui le consulte.
 */
create or replace function app.audit_trail(
  p_action  audit_action default null,
  p_table   text default null,
  p_user_id uuid default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null,
  p_limit   integer default 100,
  p_offset  integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_rows  jsonb;
  v_total bigint;
begin
  if not app.can_read_tenant(app.current_tenant_id()) then
    raise exception 'Lecture non autorisée.' using errcode = 'insufficient_privilege';
  end if;

  -- Le pisteur ne lit pas le journal : il y verrait l'activité de tous les
  -- autres, y compris les montants et les décisions qui ne le regardent pas.
  if app.current_role() = 'pisteur' then
    raise exception 'Le journal d''audit n''est pas accessible à votre profil.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_total
    from public.audit_log l
   where l.tenant_id = app.current_tenant_id()
     and (p_action  is null or l.action = p_action)
     and (p_table   is null or l.table_name = p_table)
     and (p_user_id is null or l.user_id = p_user_id)
     and (p_from    is null or l.occurred_at >= p_from)
     and (p_to      is null or l.occurred_at <= p_to);

  select coalesce(jsonb_agg(row order by occurred_at desc), '[]'::jsonb) into v_rows
  from (
    select l.id, l.occurred_at, l.action::text as action, l.table_name, l.record_id,
           l.user_id, u.full_name as user_name, u.role::text as user_role,
           l.justification, l.changed_fields, l.device_id
      from public.audit_log l
      left join public.users u on u.id = l.user_id
     where l.tenant_id = app.current_tenant_id()
       and (p_action  is null or l.action = p_action)
       and (p_table   is null or l.table_name = p_table)
       and (p_user_id is null or l.user_id = p_user_id)
       and (p_from    is null or l.occurred_at >= p_from)
       and (p_to      is null or l.occurred_at <= p_to)
     order by l.occurred_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0))
  ) as row;

  return jsonb_build_object('total', v_total, 'entries', v_rows);
end;
$$;

comment on function app.audit_trail(audit_action, text, uuid, timestamptz, timestamptz, integer, integer) is
  'Journal filtré et borné. La pagination est imposée ici plutôt que laissée à l''appelant : le '
  'journal grossit vite et on y cherche toujours quelque chose de précis.';

-- -----------------------------------------------------------------------------
-- Relais publics
-- -----------------------------------------------------------------------------

create or replace function public.set_user_role(p_user_id uuid, p_role user_role, p_reason text)
returns users language sql set search_path = pg_catalog, app, public
as $$ select app.set_user_role(p_user_id, p_role, p_reason); $$;

create or replace function public.set_user_status(p_user_id uuid, p_status user_status, p_reason text)
returns users language sql set search_path = pg_catalog, app, public
as $$ select app.set_user_status(p_user_id, p_status, p_reason); $$;

create or replace function public.revoke_device(p_device_row_id uuid, p_reason text)
returns user_devices language sql set search_path = pg_catalog, app, public
as $$ select app.revoke_device(p_device_row_id, p_reason); $$;

create or replace function public.audit_trail(
  p_action audit_action default null, p_table text default null, p_user_id uuid default null,
  p_from timestamptz default null, p_to timestamptz default null,
  p_limit integer default 100, p_offset integer default 0
)
returns jsonb language sql stable set search_path = pg_catalog, app, public
as $$ select app.audit_trail(p_action, p_table, p_user_id, p_from, p_to, p_limit, p_offset); $$;

-- -----------------------------------------------------------------------------
-- Fermeture de la surface d'exécution
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app    to authenticated, service_role;
