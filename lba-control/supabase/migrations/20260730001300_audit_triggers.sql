-- =============================================================================
-- LBA Control · 1300 · Triggers d'audit, horodatage et garde-fous
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Trigger d'audit générique
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER : s'exécute avec les droits du propriétaire, ce qui lui
-- permet d'écrire dans audit_log alors qu'AUCUN utilisateur ne le peut. C'est
-- exactement la propriété recherchée — un journal alimenté par la base et non
-- par l'application.
--
-- Une modification sensible (poids, prix, montant, société, statut) produit une
-- entrée dédiée EN PLUS de l'entrée de modification : ces changements sont ceux
-- qui déplacent de l'argent, ils ne doivent pas se perdre dans un flux générique.

create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_old        jsonb;
  v_new        jsonb;
  v_tenant     uuid;
  v_record_id  text;
  v_changed    text[];
  v_action     audit_action;
  v_justification text;

  c_weight_cols constant text[] := array[
    'gross_weight_kg', 'tare_kg', 'net_weight_kg', 'net_loaded_kg', 'net_unloaded_kg',
    'accepted_kg', 'paid_kg', 'rejected_kg', 'quantity_kg',
    'gross_weight_reception_kg', 'tare_reception_kg'
  ];
  c_price_cols constant text[] := array[
    'price', 'price_per_kg', 'applied_price_value', 'max_purchase_price', 'reference_price'
  ];
  c_amount_cols constant text[] := array[
    'amount', 'paid_amount', 'exposed_amount', 'allocated_amount',
    'recognized_amount', 'ceiling_amount'
  ];
begin
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;

  v_tenant    := nullif(coalesce(v_new, v_old) ->> 'tenant_id', '')::uuid;
  v_record_id := coalesce(v_new, v_old) ->> 'id';
  v_justification := coalesce(
    v_new ->> 'cancellation_reason',
    v_new ->> 'rejection_reason',
    v_new ->> 'override_reason',
    v_new ->> 'reason'
  );

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key), '{}')
      into v_changed
      from jsonb_each(v_new)
     where v_old -> key is distinct from v_new -> key
       and key not in ('updated_at', 'updated_by');

    -- Rien de substantiel n'a changé : ne pas polluer le journal.
    if v_changed = '{}' then
      return new;
    end if;
  end if;

  v_action := case
    when tg_op = 'INSERT' then 'create'::audit_action
    when tg_op = 'DELETE' then 'cancel'::audit_action
    when (v_new ->> 'status') in ('annule', 'annulee') and (v_old ->> 'status') is distinct from (v_new ->> 'status')
      then 'cancel'::audit_action
    else 'update'::audit_action
  end;

  insert into public.audit_log
    (tenant_id, user_id, device_id, action, table_name, record_id,
     old_value, new_value, changed_fields, justification)
  values
    (v_tenant, app.current_user_id(), app.current_device_id(), v_action,
     tg_table_name, v_record_id, v_old, v_new, v_changed, v_justification);

  if tg_op <> 'UPDATE' then
    return coalesce(new, old);
  end if;

  -- Entrées dédiées pour les changements qui déplacent de l'argent.
  if v_changed && c_weight_cols then
    insert into public.audit_log
      (tenant_id, user_id, device_id, action, table_name, record_id,
       old_value, new_value, changed_fields, justification)
    values
      (v_tenant, app.current_user_id(), app.current_device_id(), 'weight_change',
       tg_table_name, v_record_id, v_old, v_new,
       array(select unnest(v_changed) intersect select unnest(c_weight_cols)), v_justification);
  end if;

  if v_changed && c_price_cols then
    insert into public.audit_log
      (tenant_id, user_id, device_id, action, table_name, record_id,
       old_value, new_value, changed_fields, justification)
    values
      (v_tenant, app.current_user_id(), app.current_device_id(), 'price_change',
       tg_table_name, v_record_id, v_old, v_new,
       array(select unnest(v_changed) intersect select unnest(c_price_cols)), v_justification);
  end if;

  if v_changed && c_amount_cols then
    insert into public.audit_log
      (tenant_id, user_id, device_id, action, table_name, record_id,
       old_value, new_value, changed_fields, justification)
    values
      (v_tenant, app.current_user_id(), app.current_device_id(), 'amount_change',
       tg_table_name, v_record_id, v_old, v_new,
       array(select unnest(v_changed) intersect select unnest(c_amount_cols)), v_justification);
  end if;

  if 'partner_company_id' = any (v_changed) then
    insert into public.audit_log
      (tenant_id, user_id, device_id, action, table_name, record_id,
       old_value, new_value, changed_fields, justification)
    values
      (v_tenant, app.current_user_id(), app.current_device_id(), 'partner_change',
       tg_table_name, v_record_id, v_old, v_new, array['partner_company_id'], v_justification);
  end if;

  if 'status' = any (v_changed) then
    insert into public.audit_log
      (tenant_id, user_id, device_id, action, table_name, record_id,
       old_value, new_value, changed_fields, justification)
    values
      (v_tenant, app.current_user_id(), app.current_device_id(), 'status_change',
       tg_table_name, v_record_id, v_old, v_new, array['status'], v_justification);
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rattachement des triggers
-- -----------------------------------------------------------------------------
-- Toutes les tables métier portant un tenant_id sont auditées. La liste est
-- construite depuis le catalogue : ajouter une table plus tard la rend auditée
-- automatiquement, on ne peut donc pas en oublier une par distraction.

do $$
declare
  r record;
begin
  for r in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not in ('audit_log', 'sync_operations', 'sync_sessions',
                            'assignable_roles', 'subscription_plans', 'platform_admins')
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
      )
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_trigger()',
      'audit_' || r.tbl, r.tbl);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Horodatage automatique
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'updated_at' and a.attnum > 0 and not a.attisdropped
      )
  loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function app.set_updated_at()',
      'set_updated_at_' || r.tbl, r.tbl);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Garde-fou : un client ne confirme jamais son propre paiement
-- -----------------------------------------------------------------------------
-- La politique RLS autorise le comptable du tenant à DÉCLARER un paiement.
-- Sans ce trigger, rien ne l'empêcherait de passer lui-même le statut à
-- « confirmé » — ce qui viderait de son sens toute la règle de vérification.

create or replace function app.enforce_payment_confirmation_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'declared' and not app.is_platform_admin() then
      raise exception
        'Un paiement ne peut être enregistré qu''au statut « déclaré ». Seul un super-administrateur confirme.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and not app.is_platform_admin() then
    raise exception
      'Seul un super-administrateur peut modifier le statut d''un paiement d''abonnement. '
      'Une capture d''écran ou une référence saisie ne renouvelle jamais un abonnement.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger subscription_payments_authority_guard
  before insert or update on public.subscription_payments
  for each row execute function app.enforce_payment_confirmation_authority();

-- -----------------------------------------------------------------------------
-- Garde-fou : le pisteur n'écrit que ses propres lignes
-- -----------------------------------------------------------------------------
-- RLS le garantit déjà, mais une insertion passant par une fonction serveur
-- contournerait la politique. Deux verrous valent mieux qu'un sur le point le
-- plus sensible du produit.

create or replace function app.enforce_agent_ownership()
returns trigger
language plpgsql
set search_path = pg_catalog, app, public
as $$
declare
  v_agent uuid;
begin
  if app.current_role() <> 'pisteur' then
    return new;
  end if;

  v_agent := (to_jsonb(new) ->> 'field_agent_id')::uuid;

  if v_agent is null or v_agent <> app.current_field_agent_id() then
    raise exception 'Un pisteur ne peut enregistrer que ses propres opérations.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger purchases_agent_ownership_guard
  before insert or update on public.purchases
  for each row execute function app.enforce_agent_ownership();

create trigger expenses_agent_ownership_guard
  before insert or update on public.expenses
  for each row execute function app.enforce_agent_ownership();

-- -----------------------------------------------------------------------------
-- Garde-fou : un prix actif n'est jamais écrasé
-- -----------------------------------------------------------------------------
-- La contrainte EXCLUDE empêche déjà le chevauchement. Ce trigger interdit en
-- plus de modifier le prix ou la période d'une version déjà utilisée : une
-- révision doit créer une NOUVELLE version, sinon les opérations passées
-- changeraient de valeur rétroactivement.

create or replace function app.enforce_price_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, app, public
as $$
begin
  if new.price is distinct from old.price
     or new.valid_from is distinct from old.valid_from
     or new.price_type is distinct from old.price_type then

    if exists (select 1 from public.purchases where applied_price_id = old.id)
       or exists (select 1 from public.transfers where applied_price_id = old.id) then
      raise exception
        'Ce prix a déjà servi à valoriser des opérations. Créez une nouvelle version avec date d''effet '
        'plutôt que de modifier celle-ci.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger negotiated_prices_immutability_guard
  before update on public.negotiated_prices
  for each row execute function app.enforce_price_immutability();

-- -----------------------------------------------------------------------------
-- Garde-fou : un incident bloquant empêche la clôture d'un transfert
-- -----------------------------------------------------------------------------

create or replace function app.enforce_transfer_closure_rules()
returns trigger
language plpgsql
set search_path = pg_catalog, app, public
as $$
begin
  if new.status = 'cloture' and old.status is distinct from 'cloture' then

    if exists (
      select 1 from public.incidents i
      where i.transfer_id = new.id
        and i.blocks_closure
        and i.status in ('ouvert', 'en_enquete', 'reouvert')
    ) then
      raise exception
        'Un incident non résolu est ouvert sur ce transfert. La clôture est bloquée tant qu''aucune '
        'décision n''est prise.'
        using errcode = 'check_violation';
    end if;

    -- Clôturer une réception incomplète reviendrait à figer un écart que plus
    -- personne ne pourra expliquer.
    if new.net_unloaded_kg is null or new.accepted_kg is null then
      raise exception
        'Le poids déchargé et le poids accepté doivent être renseignés avant la clôture.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger transfers_closure_guard
  before update on public.transfers
  for each row execute function app.enforce_transfer_closure_rules();
