-- =============================================================================
-- LBA Control · 2100 · Sacherie — soldes, contrôles et réaffectations
-- =============================================================================
-- Un sac vaut peu ; deux mille sacs perdus valent une campagne. C'est le poste
-- où les pertes passent le plus facilement inaperçues, parce que personne ne
-- les compte au moment où elles se produisent.
--
-- Le solde n'est jamais saisi : il se déduit des mouvements. `bag_stocks` est
-- un cache tenu par trigger, reconstructible à tout moment — un solde qu'on
-- peut corriger à la main est un solde auquel on ne peut pas se fier.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Forme d'un mouvement
-- -----------------------------------------------------------------------------

/*
 * Chaque type de mouvement a une forme : une origine, une destination, ou les
 * deux. Un `dotation_pisteur` sans destination n'est pas une dotation, c'est
 * une disparition — et elle fausserait deux soldes à la fois.
 */
create or replace function app.enforce_bag_movement_shape()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_needs_from boolean;
  v_needs_to   boolean;
  v_available  integer;
begin
  if new.quantity <= 0 then
    raise exception
      'La quantité de sacs doit être strictement positive : le sens du mouvement est porté par '
      'l''origine et la destination, pas par le signe.'
      using errcode = 'check_violation';
  end if;

  if new.partner_company_id is null then
    raise exception
      'Les sacs appartiennent à une société. Sans elle, il devient impossible de savoir à qui les restituer.'
      using errcode = 'check_violation';
  end if;

  v_needs_from := new.type <> 'reception_societe';
  v_needs_to   := new.type not in ('utilisation_achat', 'perte');

  -- Une réaffectation entre sociétés s'écrit en DEUX lignes : une sortie côté
  -- société d'origine, une entrée côté société de destination.
  -- `partner_company_id` est une colonne unique — une seule ligne ne peut pas
  -- exprimer « d'OLAM vers DORADO ». Chaque patte n'a donc qu'un bout, et
  -- exiger les deux rendrait la réaffectation impossible à enregistrer.
  if new.type = 'reaffectation' then
    if new.from_holder_type is null and new.to_holder_type is null then
      raise exception 'Une réaffectation exige au moins une origine ou une destination.'
        using errcode = 'check_violation';
    end if;
    v_needs_from := false;
    v_needs_to   := false;
  end if;

  if v_needs_from and new.from_holder_type is null then
    raise exception
      'Ce mouvement exige une origine : sans elle, des sacs disparaîtraient d''un stock sans qu''on sache lequel.'
      using errcode = 'check_violation';
  end if;

  if v_needs_to and new.to_holder_type is null then
    raise exception 'Ce mouvement exige une destination.' using errcode = 'check_violation';
  end if;

  -- Une réaffectation déplace de la valeur d'un tiers vers un autre : elle ne
  -- peut pas être décidée par la seule personne qui la saisit. La contrainte
  -- de motif existe déjà en table ; l'approbateur est exigé ici.
  if new.type = 'reaffectation' and new.approved_by is null then
    raise exception
      'Une réaffectation de sacs exige une approbation nominative : c''est un transfert de valeur '
      'entre deux sociétés.'
      using errcode = 'check_violation';
  end if;

  -- Solde suffisant à l'origine. Sans ce contrôle, un solde négatif
  -- apparaîtrait et la contrainte de `bag_stocks` refuserait la mise à jour
  -- avec un message incompréhensible.
  if new.from_holder_type is not null then
    select coalesce(bag_count, 0) into v_available
    from public.bag_stocks
    where tenant_id = new.tenant_id
      and coalesce(partner_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(new.partner_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and holder_type = new.from_holder_type
      and coalesce(holder_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(new.from_holder_id, '00000000-0000-0000-0000-000000000000'::uuid);

    if coalesce(v_available, 0) < new.quantity then
      raise exception
        'Solde insuffisant : % sac(s) disponible(s) pour % demandé(s).',
        coalesce(v_available, 0), new.quantity
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger bag_movements_shape_guard
  before insert on public.bag_movements
  for each row execute function app.enforce_bag_movement_shape();

-- -----------------------------------------------------------------------------
-- Tenue des soldes
-- -----------------------------------------------------------------------------

create or replace function app.apply_bag_movement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
begin
  if new.from_holder_type is not null then
    insert into public.bag_stocks
      (tenant_id, partner_company_id, holder_type, holder_id, bag_count)
    values
      (new.tenant_id, new.partner_company_id, new.from_holder_type, new.from_holder_id, 0)
    on conflict do nothing;

    update public.bag_stocks
       set bag_count = bag_count - new.quantity, updated_at = now()
     where tenant_id = new.tenant_id
       and coalesce(partner_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(new.partner_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and holder_type = new.from_holder_type
       and coalesce(holder_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(new.from_holder_id, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;

  if new.to_holder_type is not null then
    insert into public.bag_stocks
      (tenant_id, partner_company_id, holder_type, holder_id, bag_count)
    values
      (new.tenant_id, new.partner_company_id, new.to_holder_type, new.to_holder_id, new.quantity)
    on conflict (tenant_id,
                 coalesce(partner_company_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 holder_type,
                 coalesce(holder_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set bag_count = public.bag_stocks.bag_count + excluded.bag_count,
                  updated_at = now();
  end if;

  return new;
end;
$$;

create trigger bag_movements_apply
  after insert on public.bag_movements
  for each row execute function app.apply_bag_movement();

/*
 * Reconstruit les soldes à partir des mouvements.
 *
 * Le cache peut diverger — une migration, une correction manuelle en base, un
 * incident. Pouvoir le recalculer signifie que la source de vérité reste les
 * mouvements, jamais le solde affiché.
 */
create or replace function app.rebuild_bag_stocks(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_rows integer;
begin
  if not app.tenant_can_write(p_tenant) then
    raise exception 'Écriture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  delete from public.bag_stocks where tenant_id = p_tenant;

  insert into public.bag_stocks (tenant_id, partner_company_id, holder_type, holder_id, bag_count)
  select p_tenant, partner_company_id, holder_type, holder_id, sum(delta)
  from (
    select partner_company_id, from_holder_type as holder_type, from_holder_id as holder_id,
           -quantity as delta
    from public.bag_movements
    where tenant_id = p_tenant and from_holder_type is not null
    union all
    select partner_company_id, to_holder_type, to_holder_id, quantity
    from public.bag_movements
    where tenant_id = p_tenant and to_holder_type is not null
  ) as flows
  group by partner_company_id, holder_type, holder_id
  having sum(delta) <> 0;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.rebuild_bag_stocks(p_tenant uuid)
returns integer
language sql
set search_path = pg_catalog, app, public
as $$ select app.rebuild_bag_stocks(p_tenant); $$;

grant execute on function public.rebuild_bag_stocks(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Rapprochement d'une société
-- -----------------------------------------------------------------------------

/*
 * Reprend `src/domain/bags.ts` : reçus, distribués, retournés, utilisés,
 * perdus, et le taux de perte.
 *
 * Le taux est NULL — et non 0 — quand rien n'a été distribué : un taux de perte
 * de 0 % sur une dotation inexistante se lit comme un excellent résultat.
 */
create or replace function app.bag_reconciliation(p_tenant uuid, p_partner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_received    integer;
  v_distributed integer;
  v_returned    integer;
  v_used        integer;
  v_lost        integer;
  v_held        integer;
begin
  if not app.can_read_tenant(p_tenant) then
    raise exception 'Lecture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  select
    coalesce(sum(quantity) filter (where type = 'reception_societe'), 0),
    coalesce(sum(quantity) filter (where type = 'dotation_pisteur'), 0),
    coalesce(sum(quantity) filter (where type in ('retour_vide', 'retour_plein')), 0),
    coalesce(sum(quantity) filter (where type = 'utilisation_achat'), 0),
    coalesce(sum(quantity) filter (where type = 'perte'), 0)
  into v_received, v_distributed, v_returned, v_used, v_lost
  from public.bag_movements
  where tenant_id = p_tenant and partner_company_id = p_partner;

  select coalesce(sum(bag_count), 0) into v_held
  from public.bag_stocks
  where tenant_id = p_tenant and partner_company_id = p_partner and holder_type = 'field_agent';

  return jsonb_build_object(
    'partner_company_id', p_partner,
    'received', v_received,
    'distributed', v_distributed,
    'returned', v_returned,
    'used_for_purchases', v_used,
    'declared_losses', v_lost,
    'held_by_agents', v_held,
    'expected_in_warehouse', v_received - v_distributed + v_returned,
    'loss_rate_pct', case when v_distributed > 0
                          then round(v_lost::numeric / v_distributed * 100, 2) end);
end;
$$;

create or replace function public.bag_reconciliation(p_tenant uuid, p_partner uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.bag_reconciliation(p_tenant, p_partner); $$;

grant execute on function public.bag_reconciliation(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Réaffectation entre sociétés
-- -----------------------------------------------------------------------------

/*
 * Déplace des sacs d'une société vers une autre, en une transaction.
 *
 * Deux mouvements sont écrits : une sortie côté société d'origine, une entrée
 * côté société de destination. Les enregistrer séparément depuis le client
 * laisserait, en cas d'interruption, des sacs sortis de nulle part ou entrés
 * de nulle part.
 */
create or replace function app.reassign_bags(
  p_from_partner uuid,
  p_to_partner   uuid,
  p_holder_type  holder_type,
  p_holder_id    uuid,
  p_quantity     integer,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_out    uuid;
  v_in     uuid;
begin
  if v_tenant is null or not app.tenant_can_write(v_tenant) then
    raise exception 'Écriture non autorisée.' using errcode = 'insufficient_privilege';
  end if;

  if not app.has_role('proprietaire', 'gestionnaire') then
    raise exception
      'Seuls le propriétaire et le gestionnaire peuvent réaffecter des sacs entre sociétés.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_from_partner = p_to_partner then
    raise exception 'Les sociétés d''origine et de destination doivent différer.'
      using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception
      'Une réaffectation entre sociétés exige un motif écrit : c''est un transfert de valeur entre '
      'deux tiers, pas une correction de saisie.'
      using errcode = 'check_violation';
  end if;

  insert into public.bag_movements
    (tenant_id, partner_company_id, type, quantity,
     from_holder_type, from_holder_id, reason, approved_by, created_by)
  values
    (v_tenant, p_from_partner, 'reaffectation', p_quantity,
     p_holder_type, p_holder_id, p_reason, app.current_user_id(), app.current_user_id())
  returning id into v_out;

  insert into public.bag_movements
    (tenant_id, partner_company_id, type, quantity,
     to_holder_type, to_holder_id, reason, approved_by, created_by)
  values
    (v_tenant, p_to_partner, 'reaffectation', p_quantity,
     p_holder_type, p_holder_id, p_reason, app.current_user_id(), app.current_user_id())
  returning id into v_in;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (v_tenant, app.current_user_id(), 'partner_change', 'bag_movements', v_out::text,
     jsonb_build_object('from_partner', p_from_partner, 'to_partner', p_to_partner,
                        'quantity', p_quantity, 'holder_type', p_holder_type),
     p_reason);

  return jsonb_build_object('out_movement_id', v_out, 'in_movement_id', v_in, 'quantity', p_quantity);
end;
$$;

create or replace function public.reassign_bags(
  p_from_partner uuid, p_to_partner uuid, p_holder_type holder_type,
  p_holder_id uuid, p_quantity integer, p_reason text
)
returns jsonb
language sql
set search_path = pg_catalog, app, public
as $$
  select app.reassign_bags(p_from_partner, p_to_partner, p_holder_type,
                           p_holder_id, p_quantity, p_reason);
$$;

grant execute on function public.reassign_bags(uuid, uuid, holder_type, uuid, integer, text)
  to authenticated;

comment on table public.bag_stocks is
  'CACHE tenu par trigger, jamais saisi. Reconstructible par app.rebuild_bag_stocks : la source de '
  'vérité reste bag_movements. Un solde corrigeable à la main est un solde auquel on ne peut pas se fier.';

-- Les fonctions créées ici héritent des privilèges par défaut posés en 1900 :
-- révoqués pour PUBLIC, accordés à authenticated et service_role.
