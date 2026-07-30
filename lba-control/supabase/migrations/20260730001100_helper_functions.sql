-- =============================================================================
-- LBA Control · 1100 · Fonctions de sécurité et logique serveur (schéma app)
-- =============================================================================
-- Ces fonctions sont le socle de toutes les politiques RLS. Elles sont
-- SECURITY DEFINER lorsqu'elles doivent lire une table elle-même protégée par
-- RLS (sinon les politiques s'appelleraient récursivement), et fixent toujours
-- un search_path explicite : sans cela, un objet homonyme créé dans un schéma
-- utilisateur pourrait détourner l'exécution avec les droits du propriétaire.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lecture du jeton
-- -----------------------------------------------------------------------------

create or replace function app.jwt_claims()
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(auth.jwt(), '{}'::jsonb);
$$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select nullif(app.jwt_claims() ->> 'sub', '')::uuid;
$$;

-- Le tenant et le rôle sont lus dans app_metadata, qui n'est PAS modifiable par
-- l'utilisateur. Les placer dans user_metadata permettrait à n'importe qui de
-- s'auto-attribuer un autre tenant ou le rôle propriétaire.
create or replace function app.current_tenant_id()
returns uuid
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select nullif(app.jwt_claims() -> 'app_metadata' ->> 'tenant_id', '')::uuid;
$$;

create or replace function app.current_role()
returns user_role
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select nullif(app.jwt_claims() -> 'app_metadata' ->> 'role', '')::user_role;
$$;

create or replace function app.current_device_id()
returns text
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select nullif(app.jwt_claims() -> 'app_metadata' ->> 'device_id', '');
$$;

create or replace function app.has_role(variadic roles user_role[])
returns boolean
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select app.current_role() = any (roles);
$$;

-- -----------------------------------------------------------------------------
-- Plateforme et mode d'assistance
-- -----------------------------------------------------------------------------

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, app, public
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = app.current_user_id() and pa.is_active
  );
$$;

-- Un super-administrateur n'accède aux données d'un client QUE dans une session
-- d'assistance active, motivée et non expirée (CMD §4). Hors session, la
-- requête renvoie zéro ligne — ce n'est pas une règle d'interface.
create or replace function app.has_support_access(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, app, public
as $$
  select exists (
    select 1
    from public.platform_support_sessions s
    where s.tenant_id = target_tenant
      and s.admin_user_id = app.current_user_id()
      and s.revoked_at is null
      and s.expires_at > now()
  );
$$;

create or replace function app.can_read_tenant(target_tenant uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select target_tenant is not null
     and (
       target_tenant = app.current_tenant_id()
       or (app.is_platform_admin() and app.has_support_access(target_tenant))
     );
$$;

-- -----------------------------------------------------------------------------
-- Verrou d'écriture lié à l'abonnement
-- -----------------------------------------------------------------------------
-- Évalué dans les politiques INSERT/UPDATE de toutes les tables métier : un
-- client suspendu ne peut pas écrire, même en appelant l'API directement.
-- SECURITY DEFINER pour éviter que la lecture de subscriptions ne déclenche
-- récursivement les politiques de subscriptions.

create or replace function app.tenant_can_write(target_tenant uuid default null)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, app, public
as $$
  select coalesce(
    (
      select s.status in ('trial', 'pending_payment', 'active', 'grace_period', 'overdue')
      from public.subscriptions s
      where s.tenant_id = coalesce(target_tenant, app.current_tenant_id())
        and s.status not in ('cancelled', 'expired')
      order by s.period_end desc
      limit 1
    ),
    -- Aucun abonnement enregistré : le tenant vient d'être créé, l'écriture
    -- reste possible jusqu'à la première facturation.
    true
  );
$$;

comment on function app.tenant_can_write(uuid) is
  'false dès que l''abonnement est suspended_read_only, suspended, expired ou cancelled. '
  'La lecture et les exports restent autorisés : le non-paiement bloque la saisie avant de bloquer '
  'l''accès aux données (CDC §20.4).';

-- -----------------------------------------------------------------------------
-- Cloisonnement du pisteur
-- -----------------------------------------------------------------------------

create or replace function app.current_field_agent_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, app, public
as $$
  select fa.id
  from public.field_agents fa
  where fa.user_id = app.current_user_id()
    and fa.tenant_id = app.current_tenant_id()
  limit 1;
$$;

-- Vrai si l'utilisateur n'est pas un pisteur (aucune restriction), ou s'il l'est
-- et que la ligne lui appartient. Un pisteur ne voit jamais les opérations d'un
-- collègue ni la marge du LBA.
create or replace function app.agent_scope_ok(row_agent_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select case
    when app.current_role() = 'pisteur'
      then row_agent_id is not null and row_agent_id = app.current_field_agent_id()
    else true
  end;
$$;

-- -----------------------------------------------------------------------------
-- Raccourcis de rôle
-- -----------------------------------------------------------------------------

create or replace function app.is_read_only_role()
returns boolean
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select app.current_role() = 'auditeur';
$$;

create or replace function app.can_manage_settings()
returns boolean
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select app.has_role('proprietaire', 'gestionnaire');
$$;

create or replace function app.can_write_operations()
returns boolean
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select app.has_role('proprietaire', 'gestionnaire', 'responsable_terrain', 'magasinier', 'logistique');
$$;

create or replace function app.can_write_finance()
returns boolean
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select app.has_role('proprietaire', 'gestionnaire', 'comptable');
$$;

-- Le comptable ne modifie JAMAIS un poids physique (DMQ §2.2) : il ne l'a pas
-- constaté. Cette séparation est ce qui rend une pesée opposable.
create or replace function app.can_write_weights()
returns boolean
language sql
stable
set search_path = pg_catalog, app, public
as $$
  select app.has_role('proprietaire', 'gestionnaire', 'responsable_terrain', 'magasinier', 'logistique');
$$;

-- -----------------------------------------------------------------------------
-- Réservation de stock · transactionnelle
-- -----------------------------------------------------------------------------
-- La double réservation est empêchée par un verrou de ligne sur le lot, pas par
-- une vérification côté client : deux confirmations simultanées passeraient
-- toutes les deux un simple contrôle de lecture.

create or replace function app.reserve_stock(
  p_lot_id   uuid,
  p_plan_id  uuid,
  p_quantity numeric,
  p_partner  uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_lot           public.stock_lots;
  v_already       numeric;
  v_reservation_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La quantité à réserver doit être strictement positive.'
      using errcode = 'check_violation';
  end if;

  -- Verrou de ligne : sérialise les réservations concurrentes sur ce lot.
  select * into v_lot from public.stock_lots where id = p_lot_id for update;

  if not found then
    raise exception 'Lot de stock introuvable.' using errcode = 'no_data_found';
  end if;

  if v_lot.tenant_id <> app.current_tenant_id() then
    raise exception 'Lot hors du périmètre de votre entreprise.' using errcode = 'insufficient_privilege';
  end if;

  if not app.tenant_can_write(v_lot.tenant_id) then
    raise exception 'La saisie est désactivée : abonnement suspendu.' using errcode = 'insufficient_privilege';
  end if;

  -- Un stock réservé pour une société ne peut pas être promis à une autre.
  if v_lot.partner_company_id is not null and p_partner is not null
     and v_lot.partner_company_id <> p_partner then
    raise exception
      'Cette opération utilise un stock affecté à une autre société. Une réaffectation approuvée est requise.'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(r.quantity_kg), 0) into v_already
  from public.stock_reservations r
  where r.stock_lot_id = p_lot_id and r.status = 'active';

  if v_already + p_quantity > v_lot.quantity_kg then
    raise exception
      'La quantité demandée dépasse le stock disponible non réservé (disponible : % kg).',
      (v_lot.quantity_kg - v_already)
      using errcode = 'check_violation';
  end if;

  insert into public.stock_reservations
    (tenant_id, stock_lot_id, delivery_plan_id, partner_company_id, quantity_kg, status, created_by)
  values
    (v_lot.tenant_id, p_lot_id, p_plan_id, p_partner, p_quantity, 'active', app.current_user_id())
  returning id into v_reservation_id;

  update public.stock_lots
     set status = case when v_already + p_quantity >= quantity_kg then 'reserve' else status end,
         updated_at = now()
   where id = p_lot_id;

  return v_reservation_id;
end;
$$;

-- Filet de sécurité : même si une réservation est insérée sans passer par la
-- fonction, la somme des réservations actives ne peut pas dépasser le lot.
create or replace function app.enforce_reservation_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_quantity numeric;
  v_reserved numeric;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select quantity_kg into v_quantity from public.stock_lots where id = new.stock_lot_id;

  select coalesce(sum(quantity_kg), 0) into v_reserved
  from public.stock_reservations
  where stock_lot_id = new.stock_lot_id and status = 'active' and id <> new.id;

  if v_reserved + new.quantity_kg > v_quantity then
    raise exception
      'La quantité demandée dépasse le stock disponible non réservé (disponible : % kg).',
      (v_quantity - v_reserved)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger stock_reservations_capacity_guard
  before insert or update on public.stock_reservations
  for each row execute function app.enforce_reservation_capacity();

-- -----------------------------------------------------------------------------
-- Anti double comptage du TCB
-- -----------------------------------------------------------------------------

create or replace function app.enforce_expense_category_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_reserved boolean;
  v_code     text;
begin
  select ec.is_system_reserved, ec.code into v_reserved, v_code
  from public.expense_categories ec
  where ec.id = new.category_id;

  if coalesce(v_reserved, false) and not new.is_system_generated then
    raise exception
      'La catégorie « % » est réservée au système. La valeur d''achat provient des achats terrain : '
      'la saisir en dépense la compterait deux fois dans le TCB.', v_code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger expenses_category_guard
  before insert or update on public.expenses
  for each row execute function app.enforce_expense_category_rules();

-- -----------------------------------------------------------------------------
-- Cohérence des sociétés le long de la chaîne financière
-- -----------------------------------------------------------------------------
-- Une avance ne peut pas puiser dans le financement d'une autre société, et un
-- achat ne peut pas être rattaché à une avance d'une autre société (CA-02).

create or replace function app.enforce_advance_partner_consistency()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_funding_partner uuid;
begin
  if new.funding_id is not null then
    select partner_company_id into v_funding_partner
    from public.fundings where id = new.funding_id;

    if v_funding_partner is not null and v_funding_partner <> new.partner_company_id then
      raise exception
        'Cette opération utilise un financement d''une autre société. Une réaffectation approuvée est requise.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger advances_partner_consistency_guard
  before insert or update on public.advances
  for each row execute function app.enforce_advance_partner_consistency();

create or replace function app.enforce_purchase_partner_consistency()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_advance_partner uuid;
  v_funding_partner uuid;
begin
  if new.advance_id is not null then
    select partner_company_id into v_advance_partner
    from public.advances where id = new.advance_id;

    if v_advance_partner is not null and new.partner_company_id is not null
       and v_advance_partner <> new.partner_company_id then
      raise exception
        'Cette opération utilise un financement d''une autre société. Une réaffectation approuvée est requise.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.funding_id is not null then
    select partner_company_id into v_funding_partner
    from public.fundings where id = new.funding_id;

    if v_funding_partner is not null and new.partner_company_id is not null
       and v_funding_partner <> new.partner_company_id then
      raise exception
        'Cette opération utilise un financement d''une autre société. Une réaffectation approuvée est requise.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger purchases_partner_consistency_guard
  before insert or update on public.purchases
  for each row execute function app.enforce_purchase_partner_consistency();

-- -----------------------------------------------------------------------------
-- Confirmation manuelle d'un paiement d'abonnement
-- -----------------------------------------------------------------------------
-- Réservée au super-administrateur. Idempotente. La nouvelle date de fin part de
-- la date de fin existante si l'abonnement est encore actif, afin de ne jamais
-- perdre les jours déjà payés (CDC §20.5).

create or replace function app.confirm_subscription_payment(
  p_payment_id      uuid,
  p_verifier_note   text default null,
  p_idempotency_key text default null
)
returns subscriptions
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_payment      public.subscription_payments;
  v_subscription public.subscriptions;
  v_invoice      public.invoices;
  v_key          text;
  v_new_end      date;
  v_months       integer;
begin
  if not app.is_platform_admin() then
    raise exception 'Seul un super-administrateur peut confirmer un paiement.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_payment from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Paiement introuvable.' using errcode = 'no_data_found';
  end if;

  v_key := coalesce(p_idempotency_key, 'payment:' || p_payment_id::text);

  -- Idempotence : un même paiement ne prolonge jamais deux fois la période.
  if exists (
    select 1 from public.subscription_events
    where tenant_id = v_payment.tenant_id and idempotency_key = v_key
  ) then
    select * into v_subscription from public.subscriptions where id = v_payment.subscription_id;
    return v_subscription;
  end if;

  select * into v_subscription from public.subscriptions
  where id = v_payment.subscription_id for update;

  select * into v_invoice from public.invoices where id = v_payment.invoice_id;

  -- Un paiement partiel est conservé comme avoir mais ne renouvelle pas la
  -- période : accepter l'inverse reviendrait à offrir un mois contre un acompte.
  if v_invoice.id is not null
     and (v_invoice.amount_paid + v_payment.amount) < v_invoice.amount then

    update public.invoices
       set amount_paid = amount_paid + v_payment.amount,
           status      = 'partially_paid'
     where id = v_invoice.id;

    update public.subscription_payments
       set status = 'partial', confirmed_by = app.current_user_id(),
           confirmed_at = now(), verifier_note = p_verifier_note
     where id = p_payment_id;

    insert into public.subscription_credits
      (tenant_id, subscription_id, payment_id, amount, origin, reason, created_by)
    values
      (v_payment.tenant_id, v_payment.subscription_id, p_payment_id, v_payment.amount,
       'paiement_partiel', 'Paiement partiel confirmé, période non renouvelée.', app.current_user_id());

    insert into public.subscription_events
      (tenant_id, subscription_id, event_type, payment_id, idempotency_key, actor_user_id, reason)
    values
      (v_payment.tenant_id, v_payment.subscription_id, 'payment_confirmed', p_payment_id, v_key,
       app.current_user_id(), 'Paiement partiel : avoir enregistré, période inchangée.');

    return v_subscription;
  end if;

  -- Paiement complet : prolongation à partir de la date de fin existante si
  -- l'abonnement court encore, sinon à partir d'aujourd'hui.
  select billing_period_months into v_months
  from public.subscription_plans where id = v_subscription.plan_id;

  v_new_end := greatest(v_subscription.period_end, current_date)
               + (coalesce(v_months, 1) || ' months')::interval;

  update public.subscriptions
     set status            = 'active',
         period_start      = case when v_subscription.period_end < current_date
                                  then current_date else v_subscription.period_start end,
         period_end        = v_new_end,
         grace_started_at  = null,
         read_only_at      = null,
         blocked_at        = null,
         suspension_reason = null,
         reactivated_by    = app.current_user_id(),
         reactivated_at    = now(),
         updated_at        = now(),
         updated_by        = app.current_user_id()
   where id = v_subscription.id
   returning * into v_subscription;

  update public.subscription_payments
     set status = 'confirmed', confirmed_by = app.current_user_id(),
         confirmed_at = now(), verifier_note = p_verifier_note
   where id = p_payment_id;

  if v_invoice.id is not null then
    update public.invoices
       set amount_paid = amount_paid + v_payment.amount, status = 'paid'
     where id = v_invoice.id;
  end if;

  insert into public.subscription_events
    (tenant_id, subscription_id, event_type, old_status, new_status,
     payment_id, idempotency_key, actor_user_id, reason)
  values
    (v_payment.tenant_id, v_subscription.id, 'payment_confirmed',
     v_subscription.status, 'active', p_payment_id, v_key,
     app.current_user_id(), coalesce(p_verifier_note, 'Paiement vérifié et confirmé.'));

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (v_payment.tenant_id, app.current_user_id(), 'payment_confirm', 'subscription_payments',
     p_payment_id::text, to_jsonb(v_payment), p_verifier_note);

  return v_subscription;
end;
$$;

comment on function app.confirm_subscription_payment(uuid, text, text) is
  'Seul chemin d''activation ou de prolongation d''un abonnement. Une capture d''écran, un SMS '
  'transféré ou une référence saisie par le client ne suffisent jamais (CMD §20).';

-- -----------------------------------------------------------------------------
-- Ouverture d'une session d'assistance
-- -----------------------------------------------------------------------------

create or replace function app.open_support_session(
  p_tenant_id     uuid,
  p_reason        text,
  p_duration_mins integer default 60
)
returns platform_support_sessions
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_session public.platform_support_sessions;
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé aux super-administrateurs.' using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Un motif d''assistance explicite est obligatoire.' using errcode = 'check_violation';
  end if;

  if p_duration_mins is null or p_duration_mins <= 0 or p_duration_mins > 480 then
    raise exception 'La durée doit être comprise entre 1 et 480 minutes.' using errcode = 'check_violation';
  end if;

  insert into public.platform_support_sessions (tenant_id, admin_user_id, reason, expires_at)
  values (p_tenant_id, app.current_user_id(), p_reason,
          now() + make_interval(mins => p_duration_mins))
  returning * into v_session;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (p_tenant_id, app.current_user_id(), 'validate', 'platform_support_sessions',
     v_session.id::text, to_jsonb(v_session), p_reason);

  return v_session;
end;
$$;

-- -----------------------------------------------------------------------------
-- Horodatage de modification
-- -----------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, app, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
