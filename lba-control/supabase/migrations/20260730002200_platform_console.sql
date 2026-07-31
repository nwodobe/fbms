-- =============================================================================
-- LBA Control · 2200 · Console plateforme (Z01)
-- =============================================================================
-- Ce que le super-administrateur voit, et surtout ce qu'il ne voit pas.
--
-- Il administre des abonnements, pas des campagnes. La console lui donne
-- l'état commercial de chaque client — plan, échéance, paiements en attente,
-- nombre d'utilisateurs — et **aucune donnée métier** : ni achat, ni prix, ni
-- marge, ni nom de pisteur.
--
-- Accéder aux données d'un client reste possible, mais seulement par une
-- session d'assistance explicite, motivée, horodatée et à durée limitée. Le
-- client peut ensuite lire dans son journal qui est entré chez lui, quand et
-- pourquoi.
-- =============================================================================

/*
 * Tableau des clients, vu de la plateforme.
 *
 * Les compteurs sont des agrégats : « 14 utilisateurs », jamais leurs noms.
 * Un agrégat renseigne sur la santé d'un compte sans ouvrir son contenu.
 */
create or replace function app.platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_tenants jsonb;
  v_pending jsonb;
  v_sessions jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'Console réservée aux administrateurs de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row order by commercial_name), '[]'::jsonb) into v_tenants
  from (
    select
      t.id,
      t.slug,
      t.commercial_name,
      t.status::text as tenant_status,
      s.id                as subscription_id,
      s.status::text      as subscription_status,
      s.period_end,
      s.amount,
      (s.period_end - current_date) as days_to_expiry,
      sp.name             as plan_name,
      (select count(*) from public.users u where u.tenant_id = t.id and u.status = 'active')
        as active_users,
      (select count(*) from public.field_agents fa
        where fa.tenant_id = t.id and fa.status = 'actif') as active_agents,
      (select count(*) from public.subscription_payments p
        where p.tenant_id = t.id and p.status = 'declared') as pending_payments
    from public.tenants t
    left join public.subscriptions s
      on s.tenant_id = t.id and s.status not in ('cancelled', 'expired')
    left join public.subscription_plans sp on sp.id = s.plan_id
  ) as row;

  -- Paiements déclarés, tous clients confondus : c'est la file de travail
  -- quotidienne de la plateforme.
  select coalesce(jsonb_agg(row order by declared_at), '[]'::jsonb) into v_pending
  from (
    select p.id, p.tenant_id, t.commercial_name, p.amount, p.method::text as method,
           p.reference, p.payer, p.declared_at
    from public.subscription_payments p
    join public.tenants t on t.id = p.tenant_id
    where p.status = 'declared'
  ) as row;

  select coalesce(jsonb_agg(row order by granted_at desc), '[]'::jsonb) into v_sessions
  from (
    select ss.id, ss.tenant_id, t.commercial_name, ss.reason,
           ss.granted_at, ss.expires_at, ss.revoked_at,
           (ss.revoked_at is null and ss.expires_at > now()) as is_active
    from public.platform_support_sessions ss
    join public.tenants t on t.id = ss.tenant_id
    order by ss.granted_at desc
    limit 50
  ) as row;

  return jsonb_build_object(
    'tenants', v_tenants,
    'pending_payments', v_pending,
    'support_sessions', v_sessions);
end;
$$;

create or replace function public.platform_overview()
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.platform_overview(); $$;

grant execute on function public.platform_overview() to authenticated;

comment on function app.platform_overview() is
  'État commercial des clients : plan, échéance, paiements en attente, compteurs. AUCUNE donnée '
  'métier — le super-administrateur administre des abonnements, pas des campagnes.';

-- -----------------------------------------------------------------------------
-- Sessions d'assistance
-- -----------------------------------------------------------------------------

create or replace function public.open_support_session(
  p_tenant_id uuid, p_reason text, p_duration_mins integer default 60
)
returns platform_support_sessions
language sql
set search_path = pg_catalog, app, public
as $$ select app.open_support_session(p_tenant_id, p_reason, p_duration_mins); $$;

grant execute on function public.open_support_session(uuid, text, integer) to authenticated;

/*
 * Révocation immédiate.
 *
 * Une session d'assistance expire d'elle-même, mais devoir attendre l'expiration
 * pour couper un accès ouvert par erreur serait une mauvaise réponse à un
 * incident. La révocation est tracée comme l'ouverture.
 */
create or replace function app.revoke_support_session(p_session_id uuid)
returns platform_support_sessions
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_session public.platform_support_sessions;
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé aux administrateurs de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.platform_support_sessions
     set revoked_at = now(), revoked_by = app.current_user_id()
   where id = p_session_id and revoked_at is null
   returning * into v_session;

  if not found then
    raise exception 'Session introuvable ou déjà révoquée.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (v_session.tenant_id, app.current_user_id(), 'status_change', 'platform_support_sessions',
     p_session_id::text, jsonb_build_object('revoked_at', now()),
     'Session d''assistance révoquée avant son expiration.');

  return v_session;
end;
$$;

create or replace function public.revoke_support_session(p_session_id uuid)
returns platform_support_sessions
language sql
set search_path = pg_catalog, app, public
as $$ select app.revoke_support_session(p_session_id); $$;

grant execute on function public.revoke_support_session(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Suspension et réactivation d'un client
-- -----------------------------------------------------------------------------

/*
 * Suspendre un client est la décision la plus lourde de la plateforme : elle
 * coupe l'outil de travail d'une entreprise entière. Elle exige donc un motif
 * substantiel, et n'efface rien.
 */
create or replace function app.set_tenant_status(
  p_tenant_id uuid,
  p_status    tenant_status,
  p_reason    text
)
returns tenants
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_tenant public.tenants;
  v_old    public.tenant_status;
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé aux administrateurs de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 20 then
    raise exception
      'Suspendre ou réactiver un client coupe ou rétablit l''outil de travail d''une entreprise : '
      'le motif doit compter au moins 20 caractères.'
      using errcode = 'check_violation';
  end if;

  select status into v_old from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'Entreprise introuvable.' using errcode = 'no_data_found';
  end if;

  update public.tenants set status = p_status, updated_at = now()
   where id = p_tenant_id
   returning * into v_tenant;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, old_value, new_value, justification)
  values
    (p_tenant_id, app.current_user_id(),
     (case when p_status = 'active' then 'reactivate' else 'suspend' end)::audit_action,
     'tenants', p_tenant_id::text,
     jsonb_build_object('status', v_old), jsonb_build_object('status', p_status),
     p_reason);

  return v_tenant;
end;
$$;

create or replace function public.set_tenant_status(
  p_tenant_id uuid, p_status tenant_status, p_reason text
)
returns tenants
language sql
set search_path = pg_catalog, app, public
as $$ select app.set_tenant_status(p_tenant_id, p_status, p_reason); $$;

grant execute on function public.set_tenant_status(uuid, tenant_status, text) to authenticated;

comment on function app.set_tenant_status(uuid, tenant_status, text) is
  'Suspend ou réactive un client. Ne supprime rien : les données restent intactes et redeviennent '
  'accessibles à la réactivation.';
