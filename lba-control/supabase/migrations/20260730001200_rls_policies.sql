-- =============================================================================
-- LBA Control · 1200 · Row Level Security
-- =============================================================================
-- RLS est activée sur TOUTES les tables exposées, et chacune possède les quatre
-- politiques demandées (SELECT, INSERT, UPDATE, DELETE).
--
-- Sur les tables transactionnelles, la politique DELETE existe et REFUSE
-- (USING false) : la commande exige à la fois des politiques DELETE et
-- l'interdiction de toute suppression physique. Les deux sont respectées à la
-- lettre — la politique est présente, testée, et elle refuse. L'annulation passe
-- par statut + date + motif + auteur + audit.
--
-- Note sur FORCE ROW LEVEL SECURITY : il n'est volontairement pas activé. Les
-- rôles d'exécution (anon, authenticated) ne sont jamais propriétaires des
-- tables, donc RLS s'applique intégralement à eux. En revanche les fonctions
-- SECURITY DEFINER (app.reserve_stock, app.confirm_subscription_payment, les
-- triggers d'audit) s'exécutent avec les droits du propriétaire et doivent
-- pouvoir écrire — c'est précisément le mécanisme qui permet d'alimenter un
-- journal d'audit qu'aucun utilisateur ne peut écrire directement.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Privilèges de base
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant usage on schema app to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema app to authenticated;

-- Le rôle anonyme n'a strictement aucun accès aux données métier.
revoke all on all tables in schema public from anon;

-- =============================================================================
-- 1. Tables plateforme (hors tenant)
-- =============================================================================

alter table platform_admins enable row level security;

create policy platform_admins_select on platform_admins for select to authenticated
  using (app.is_platform_admin() or user_id = app.current_user_id());
create policy platform_admins_insert on platform_admins for insert to authenticated
  with check (false);   -- créés uniquement par fonction serveur
create policy platform_admins_update on platform_admins for update to authenticated
  using (false) with check (false);
create policy platform_admins_delete on platform_admins for delete to authenticated
  using (false);

alter table subscription_plans enable row level security;

create policy subscription_plans_select on subscription_plans for select to authenticated
  using (is_active or app.is_platform_admin());
create policy subscription_plans_insert on subscription_plans for insert to authenticated
  with check (app.is_platform_admin());
create policy subscription_plans_update on subscription_plans for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy subscription_plans_delete on subscription_plans for delete to authenticated
  using (false);

alter table platform_support_sessions enable row level security;

create policy support_sessions_select on platform_support_sessions for select to authenticated
  using (app.is_platform_admin()
         or (tenant_id = app.current_tenant_id() and app.has_role('proprietaire')));
create policy support_sessions_insert on platform_support_sessions for insert to authenticated
  with check (false);   -- uniquement via app.open_support_session()
create policy support_sessions_update on platform_support_sessions for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy support_sessions_delete on platform_support_sessions for delete to authenticated
  using (false);

comment on policy support_sessions_select on platform_support_sessions is
  'Le propriétaire du LBA voit qui est entré chez lui, quand et pourquoi. Une assistance invisible '
  'ne serait pas une assistance auditée.';

alter table assignable_roles enable row level security;

create policy assignable_roles_select on assignable_roles for select to authenticated using (true);
create policy assignable_roles_insert on assignable_roles for insert to authenticated
  with check (app.is_platform_admin());
create policy assignable_roles_update on assignable_roles for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy assignable_roles_delete on assignable_roles for delete to authenticated using (false);

-- =============================================================================
-- 2. Tenant, marque, paramètres
-- =============================================================================

alter table tenants enable row level security;

create policy tenants_select on tenants for select to authenticated
  using (app.can_read_tenant(id));
create policy tenants_insert on tenants for insert to authenticated
  with check (app.is_platform_admin());
create policy tenants_update on tenants for update to authenticated
  using (app.is_platform_admin() or (id = app.current_tenant_id() and app.has_role('proprietaire')))
  with check (app.is_platform_admin() or id = app.current_tenant_id());
create policy tenants_delete on tenants for delete to authenticated using (false);

alter table tenant_branding enable row level security;

create policy tenant_branding_select on tenant_branding for select to authenticated
  using (app.can_read_tenant(tenant_id));
create policy tenant_branding_insert on tenant_branding for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.tenant_can_write() and app.can_manage_settings());
create policy tenant_branding_update on tenant_branding for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.tenant_can_write() and app.can_manage_settings())
  with check (tenant_id = app.current_tenant_id());
create policy tenant_branding_delete on tenant_branding for delete to authenticated using (false);

alter table tenant_settings enable row level security;

create policy tenant_settings_select on tenant_settings for select to authenticated
  using (app.can_read_tenant(tenant_id));
create policy tenant_settings_insert on tenant_settings for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.tenant_can_write() and app.can_manage_settings());
create policy tenant_settings_update on tenant_settings for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.tenant_can_write() and app.can_manage_settings())
  with check (tenant_id = app.current_tenant_id());
create policy tenant_settings_delete on tenant_settings for delete to authenticated using (false);

-- =============================================================================
-- 3. Utilisateurs et appareils
-- =============================================================================

alter table users enable row level security;

-- Un pisteur ne voit que sa propre fiche : la liste du personnel n'est pas une
-- information dont il a besoin pour travailler.
create policy users_select on users for select to authenticated
  using (
    (tenant_id is not null and app.can_read_tenant(tenant_id)
     and (app.current_role() <> 'pisteur' or id = app.current_user_id()))
    or id = app.current_user_id()
  );
create policy users_insert on users for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.tenant_can_write() and app.can_manage_settings());
create policy users_update on users for update to authenticated
  using (
    (tenant_id = app.current_tenant_id() and app.tenant_can_write() and app.can_manage_settings())
    or id = app.current_user_id()
  )
  with check (tenant_id = app.current_tenant_id() or id = app.current_user_id());
create policy users_delete on users for delete to authenticated using (false);

alter table user_devices enable row level security;

create policy user_devices_select on user_devices for select to authenticated
  using (app.can_read_tenant(tenant_id)
         and (app.current_role() <> 'pisteur' or user_id = app.current_user_id()));
create policy user_devices_insert on user_devices for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and (user_id = app.current_user_id() or app.can_manage_settings()));
create policy user_devices_update on user_devices for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and (user_id = app.current_user_id() or app.can_manage_settings()))
  with check (tenant_id = app.current_tenant_id());
create policy user_devices_delete on user_devices for delete to authenticated using (false);

-- =============================================================================
-- 4. Journal d'audit · lecture contrôlée, écriture réservée aux triggers
-- =============================================================================

alter table audit_log enable row level security;

create policy audit_log_select on audit_log for select to authenticated
  using (
    tenant_id is not null
    and app.can_read_tenant(tenant_id)
    and app.has_role('proprietaire', 'gestionnaire', 'comptable', 'auditeur')
  );

-- Aucun utilisateur n'écrit dans le journal. Seuls les triggers SECURITY
-- DEFINER, qui s'exécutent avec les droits du propriétaire, y parviennent.
create policy audit_log_insert on audit_log for insert to authenticated with check (false);
create policy audit_log_update on audit_log for update to authenticated using (false) with check (false);
create policy audit_log_delete on audit_log for delete to authenticated using (false);

comment on policy audit_log_update on audit_log is
  'Aucun rôle, pas même propriétaire ou super-administrateur, ne peut modifier une entrée d''audit. '
  'Un journal réécrivable ne prouve rien.';

-- =============================================================================
-- 5. Génération des politiques des tables métier
-- =============================================================================
-- Le tableau ci-dessous est la cartographie de sécurité complète. Il tient sur
-- un écran, ce qui le rend auditable : c'est délibéré. Colonnes :
--   table          nom de la table
--   profile        ref | ops | fin | weights | agent_ops | server
--   agent_col      colonne de rattachement au pisteur (null = invisible au pisteur)
--   agent_insert   le pisteur peut-il créer ses propres lignes

do $$
declare
  r record;
  v_select_extra text;
  v_write        text;
  v_delete       text;
begin
  for r in
    select * from (values
      -- ---------------------------------------------------------------- référentiel
      ('products',                 'ref',       null,             false),
      ('zones',                    'ref',       null,             false),
      ('localities',               'ref',       null,             false),
      ('sites',                    'ref',       null,             false),
      ('suppliers',                'ref',       null,             false),
      ('transporters',             'ref',       null,             false),
      ('vehicles',                 'ref',       null,             false),
      ('weighbridges',             'ref',       null,             false),
      ('partner_companies',        'ref',       null,             false),
      ('campaigns',                'ref',       null,             false),
      ('expense_categories',       'ref',       null,             false),
      ('alert_rules',              'ref',       null,             false),
      ('field_agents',             'ref',       'id',             false),
      ('field_agent_localities',   'ref',       'field_agent_id', false),
      ('field_agent_partners',     'ref',       'field_agent_id', false),

      -- ------------------------------------------------------------------- finance
      -- Invisibles au pisteur : conditions commerciales et exposition globale.
      ('contracts',                'ref',       null,             false),
      ('negotiated_prices',        'ref',       null,             false),
      ('fundings',                 'fin',       null,             false),
      ('advances',                 'fin',       'field_agent_id', false),
      ('advance_allocations',      'fin',       null,             false),
      ('advance_repayments',       'fin',       null,             false),

      -- -------------------------------------------------------------------- terrain
      ('purchases',                'agent_ops', 'field_agent_id', true),
      ('purchase_duplicate_flags', 'ops',       null,             false),

      -- --------------------------------------------------------------------- stock
      ('stock_lots',               'ops',       'field_agent_id', false),
      ('stock_movements',          'ops',       null,             false),
      ('stock_reservations',       'ops',       null,             false),
      ('stock_reassignments',      'ops',       null,             false),
      ('bag_stocks',               'ops',       null,             false),
      ('bag_movements',            'ops',       'field_agent_id', false),

      -- ---------------------------------------------------------------- logistique
      ('delivery_plans',           'ops',       'field_agent_id', false),
      ('transfers',                'weights',   null,             false),
      ('transfer_lots',            'weights',   null,             false),

      -- ----------------------------------------------------------------- incidents
      ('incidents',                'ops',       'field_agent_id', false),
      ('incident_evidences',       'ops',       null,             false),

      -- --------------------------------------------------------------------- coûts
      ('expenses',                 'agent_ops', 'field_agent_id', true),
      ('expense_duplicate_flags',  'fin',       null,             false),
      ('expense_allocations',      'fin',       null,             false),
      -- TCB et marges : hors de portée du pisteur, par construction.
      ('tcb_snapshots',            'server',    null,             false),
      ('tcb_snapshot_components',  'server',    null,             false),

      -- ------------------------------------------------------------------ scoring
      ('agent_scores',             'server',    'field_agent_id', false),
      ('agent_score_components',   'server',    null,             false),
      ('agent_score_adjustments',  'fin',       null,             false),
      ('external_events',          'ops',       'field_agent_id', false),

      -- ------------------------------------------------------------------ alertes
      ('alerts',                   'ops',       'field_agent_id', false)
      -- Les tables d'abonnement sont traitées explicitement en section 6 :
      -- ce sont des données commerciales de la plateforme, pas des données
      -- métier du client, et le super-administrateur doit les administrer sans
      -- ouvrir une session d'assistance chez le client.
    ) as t(tbl, profile, agent_col, agent_insert)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    -- ---- Restriction de lecture ------------------------------------------------
    if r.agent_col is null then
      -- Aucune colonne de rattachement : la table est invisible au pisteur.
      v_select_extra := $q$ and app.current_role() <> 'pisteur'$q$;
    else
      v_select_extra := format(' and app.agent_scope_ok(%I)', r.agent_col);
    end if;

    -- ---- Prédicat d'écriture ---------------------------------------------------
    v_write := case r.profile
      when 'ref'       then 'app.can_manage_settings()'
      when 'ops'       then 'app.can_write_operations()'
      when 'fin'       then 'app.can_write_finance()'
      when 'weights'   then 'app.can_write_weights()'
      when 'agent_ops' then 'app.can_write_operations() or app.can_write_finance()'
      when 'server'    then 'false'
    end;

    if r.agent_insert then
      v_write := format(
        '(%s or (app.current_role() = ''pisteur'' and %I = app.current_field_agent_id()))',
        v_write, r.agent_col);
    end if;

    -- ---- Suppression -----------------------------------------------------------
    -- Référentiel : nettoyage de paramétrage autorisé aux administrateurs.
    -- Tout le reste : refus, l'annulation se fait par statut et motif.
    v_delete := case r.profile
      when 'ref' then 'tenant_id = app.current_tenant_id() and app.tenant_can_write() and app.can_manage_settings()'
      else 'false'
    end;

    execute format($f$
      create policy %1$I_select on public.%1$I for select to authenticated
        using (app.can_read_tenant(tenant_id)%2$s)
    $f$, r.tbl, v_select_extra);

    execute format($f$
      create policy %1$I_insert on public.%1$I for insert to authenticated
        with check (tenant_id = app.current_tenant_id() and app.tenant_can_write() and (%2$s))
    $f$, r.tbl, v_write);

    execute format($f$
      create policy %1$I_update on public.%1$I for update to authenticated
        using (tenant_id = app.current_tenant_id() and app.tenant_can_write() and (%2$s))
        with check (tenant_id = app.current_tenant_id())
    $f$, r.tbl, v_write);

    execute format($f$
      create policy %1$I_delete on public.%1$I for delete to authenticated
        using (%2$s)
    $f$, r.tbl, v_delete);
  end loop;
end;
$$;

-- =============================================================================
-- 6. Abonnements · données commerciales de la plateforme
-- =============================================================================
-- Distinction importante : un abonnement, une facture et un paiement ne sont pas
-- des données métier du client — ce sont les données de la relation commerciale.
-- Le super-administrateur doit pouvoir les administrer (console plateforme,
-- CDC §20.6) sans ouvrir une session d'assistance, laquelle est réservée à
-- l'accès aux opérations du client.
--
-- Côté client, le propriétaire et le comptable consultent leur abonnement et
-- DÉCLARENT un paiement. Ils ne le confirment jamais : le trigger
-- app.enforce_payment_confirmation_authority() s'en assure.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('subscriptions'),
      ('invoices'),
      ('subscription_events'),
      ('subscription_credits')
    ) as t(tbl)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    execute format($f$
      create policy %1$I_select on public.%1$I for select to authenticated
        using (
          app.is_platform_admin()
          or (tenant_id = app.current_tenant_id()
              and app.has_role('proprietaire', 'comptable', 'gestionnaire', 'auditeur'))
        )
    $f$, r.tbl);

    execute format($f$
      create policy %1$I_insert on public.%1$I for insert to authenticated
        with check (app.is_platform_admin())
    $f$, r.tbl);

    execute format($f$
      create policy %1$I_update on public.%1$I for update to authenticated
        using (app.is_platform_admin()) with check (app.is_platform_admin())
    $f$, r.tbl);

    execute format($f$
      create policy %1$I_delete on public.%1$I for delete to authenticated using (false)
    $f$, r.tbl);
  end loop;
end;
$$;

alter table subscription_payments enable row level security;

create policy subscription_payments_select on subscription_payments for select to authenticated
  using (
    app.is_platform_admin()
    or (tenant_id = app.current_tenant_id()
        and app.has_role('proprietaire', 'comptable', 'gestionnaire', 'auditeur'))
  );

-- Le client déclare son règlement — c'est utile et légitime. Le passage au
-- statut « confirmé » lui reste interdit par trigger.
create policy subscription_payments_insert on subscription_payments for insert to authenticated
  with check (
    app.is_platform_admin()
    or (tenant_id = app.current_tenant_id() and app.has_role('proprietaire', 'comptable'))
  );

create policy subscription_payments_update on subscription_payments for update to authenticated
  using (
    app.is_platform_admin()
    or (tenant_id = app.current_tenant_id() and app.has_role('proprietaire', 'comptable'))
  )
  with check (app.is_platform_admin() or tenant_id = app.current_tenant_id());

create policy subscription_payments_delete on subscription_payments for delete to authenticated
  using (false);

-- =============================================================================
-- 7. Tables rattachées à l'utilisateur
-- =============================================================================

alter table notifications enable row level security;

create policy notifications_select on notifications for select to authenticated
  using (app.can_read_tenant(tenant_id) and (user_id = app.current_user_id() or app.has_role('proprietaire')));
create policy notifications_insert on notifications for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.can_write_operations());
create policy notifications_update on notifications for update to authenticated
  using (tenant_id = app.current_tenant_id() and user_id = app.current_user_id())
  with check (tenant_id = app.current_tenant_id());
create policy notifications_delete on notifications for delete to authenticated using (false);

-- Journal de synchronisation : chacun voit et alimente le sien. Un pisteur doit
-- pouvoir prouver que ses saisies sont parties, y compris quand l'abonnement est
-- suspendu — sinon une suspension ferait disparaître la preuve du travail fait.
alter table sync_operations enable row level security;

create policy sync_operations_select on sync_operations for select to authenticated
  using (app.can_read_tenant(tenant_id)
         and (user_id = app.current_user_id() or app.current_role() <> 'pisteur'));
create policy sync_operations_insert on sync_operations for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and user_id = app.current_user_id());
create policy sync_operations_update on sync_operations for update to authenticated
  using (tenant_id = app.current_tenant_id() and user_id = app.current_user_id())
  with check (tenant_id = app.current_tenant_id());
create policy sync_operations_delete on sync_operations for delete to authenticated
  using (false);

comment on policy sync_operations_delete on sync_operations is
  'Une opération de synchronisation ne s''efface jamais, même après succès : c''est la preuve '
  'qu''aucune saisie terrain n''a disparu.';

alter table sync_sessions enable row level security;

create policy sync_sessions_select on sync_sessions for select to authenticated
  using (app.can_read_tenant(tenant_id)
         and (user_id = app.current_user_id() or app.current_role() <> 'pisteur'));
create policy sync_sessions_insert on sync_sessions for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and user_id = app.current_user_id());
create policy sync_sessions_update on sync_sessions for update to authenticated
  using (tenant_id = app.current_tenant_id() and user_id = app.current_user_id())
  with check (tenant_id = app.current_tenant_id());
create policy sync_sessions_delete on sync_sessions for delete to authenticated using (false);
