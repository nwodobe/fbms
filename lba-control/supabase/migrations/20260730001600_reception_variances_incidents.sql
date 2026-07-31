-- =============================================================================
-- LBA Control · 1600 · Réception, écarts, incidents et mouvements de stock
-- =============================================================================
-- Phase 4. Le moment le plus sensible du produit : celui où l'on constate qu'il
-- manque de la marchandise. Trois garanties sont posées ici.
--
--  1. La tolérance applicable est résolue en cascade contrat → société →
--     entreprise, et l'origine du seuil est CONSERVÉE. « Écart supérieur à la
--     tolérance » sans dire laquelle ni d'où elle vient est ininterprétable.
--
--  2. Un écart hors tolérance ouvre un incident et bloque la clôture, mais
--     n'impute la responsabilité à PERSONNE. Humidité, étalonnage du pont,
--     tare, route et saisie sont des causes au moins aussi fréquentes que la
--     malhonnêteté.
--
--  3. La réception acceptée déclenche l'allocation FIFO des avances : c'est
--     l'événement de couverture par défaut (arbitrage D1).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Résolution de la tolérance
-- -----------------------------------------------------------------------------

create or replace function app.resolve_weight_tolerance(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_transfer public.transfers;
  v_contract public.contracts;
  v_partner  public.partner_companies;
  v_default  numeric;
begin
  select * into v_transfer from public.transfers where id = p_transfer_id;
  if not found then
    raise exception 'Transfert introuvable.' using errcode = 'no_data_found';
  end if;

  select * into v_contract from public.contracts where id = v_transfer.contract_id;
  select * into v_partner  from public.partner_companies where id = v_transfer.partner_company_id;

  select default_weight_tolerance_pct into v_default
  from public.tenant_settings where tenant_id = v_transfer.tenant_id;

  if v_contract.weight_tolerance_pct is not null then
    return jsonb_build_object('value', trim_scale(v_contract.weight_tolerance_pct), 'source', 'contrat');
  end if;

  if v_partner.weight_tolerance_pct is not null then
    return jsonb_build_object('value', trim_scale(v_partner.weight_tolerance_pct), 'source', 'societe');
  end if;

  return jsonb_build_object('value', trim_scale(coalesce(v_default, 0.5)), 'source', 'entreprise');
end;
$$;

create or replace function public.resolve_weight_tolerance(p_transfer_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.resolve_weight_tolerance(p_transfer_id); $$;

grant execute on function public.resolve_weight_tolerance(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Enregistrement d'une réception
-- -----------------------------------------------------------------------------
-- Un seul point d'entrée transactionnel : saisir les poids, calculer les écarts,
-- ouvrir l'incident si nécessaire et déplacer le stock sont indissociables. Les
-- séparer laisserait la base dans un état où le camion est arrivé mais où le
-- stock est encore « en transit ».

create or replace function app.record_transfer_reception(
  p_transfer_id       uuid,
  p_net_unloaded_kg   numeric,
  p_accepted_kg       numeric,
  p_paid_kg           numeric default null,
  p_gross_reception_kg numeric default null,
  p_tare_reception_kg numeric default null,
  p_kor_reception     numeric default null,
  p_humidity_reception numeric default null,
  p_rejected_kg       numeric default null,
  p_rejection_reason  text default null,
  p_receiver_name     text default null,
  p_reception_ticket_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_transfer   public.transfers;
  v_tolerance  jsonb;
  v_pct        numeric;
  v_exceeds    boolean := false;
  v_incident   public.incidents;
  v_incident_id uuid := null;
  v_reference  text;
begin
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfert introuvable.' using errcode = 'no_data_found';
  end if;

  if v_transfer.tenant_id <> app.current_tenant_id() then
    raise exception 'Transfert hors du périmètre de votre entreprise.'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.tenant_can_write(v_transfer.tenant_id) then
    raise exception 'La saisie est désactivée : abonnement suspendu.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Le comptable ne constate pas une pesée : il ne l'a pas vue.
  if not app.can_write_weights() then
    raise exception 'Votre profil ne permet pas de saisir des poids physiques.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_net_unloaded_kg is null or p_accepted_kg is null then
    raise exception 'Le poids déchargé et le poids accepté sont obligatoires à la réception.'
      using errcode = 'check_violation';
  end if;

  update public.transfers
     set arrived_at                = coalesce(arrived_at, now()),
         unloaded_at               = now(),
         gross_weight_reception_kg = p_gross_reception_kg,
         tare_reception_kg         = p_tare_reception_kg,
         net_unloaded_kg           = p_net_unloaded_kg,
         accepted_kg               = p_accepted_kg,
         paid_kg                   = p_paid_kg,
         kor_reception             = p_kor_reception,
         humidity_reception        = p_humidity_reception,
         rejected_kg               = coalesce(p_rejected_kg, p_net_unloaded_kg - p_accepted_kg),
         rejection_reason          = p_rejection_reason,
         receiver_name             = p_receiver_name,
         reception_ticket_path     = p_reception_ticket_path,
         status                    = 'receptionne',
         updated_at                = now(),
         updated_by                = app.current_user_id()
   where id = p_transfer_id
   returning * into v_transfer;

  v_tolerance := app.resolve_weight_tolerance(p_transfer_id);
  v_pct := abs(coalesce(v_transfer.ecart_physique_pct, 0));
  v_exceeds := v_pct > (v_tolerance ->> 'value')::numeric;

  -- Un écart calculé sur un poids de départ estimé ne vaut pas un écart mesuré.
  if v_exceeds and v_transfer.weight_source = 'verified' then
    select 'INC-' || lpad((count(*) + 1)::text, 4, '0') into v_reference
    from public.incidents where tenant_id = v_transfer.tenant_id;

    insert into public.incidents
      (tenant_id, reference, type, severity, campaign_id, partner_company_id, transfer_id,
       description, exposed_quantity_kg, exposed_amount,
       -- Responsable présumé « inconnu » : le logiciel constate, il n'accuse pas.
       suspected_responsible_type, status, blocks_closure, created_by)
    values
      (v_transfer.tenant_id, v_reference, 'ecart_poids',
       (case when v_pct > (v_tolerance ->> 'value')::numeric * 3 then 'critique' else 'grave' end)::incident_severity,
       v_transfer.campaign_id, v_transfer.partner_company_id, p_transfer_id,
       format(
         'Écart de %s %% entre le poids chargé (%s kg) et le poids déchargé (%s kg), '
         'au-dessus de la tolérance de %s %% (source : %s). '
         'Causes à examiner avant toute conclusion : perte d''humidité, écart d''étalonnage entre '
         'ponts-bascules, variation de tare, perte en transport, erreur de saisie.',
         trim_scale(round(v_pct, 3)), trim_scale(v_transfer.net_loaded_kg), trim_scale(v_transfer.net_unloaded_kg),
         v_tolerance ->> 'value', v_tolerance ->> 'source'),
       abs(coalesce(v_transfer.ecart_physique_kg, 0)),
       abs(coalesce(v_transfer.ecart_physique_kg, 0)) * coalesce(v_transfer.applied_price_value, 0),
       'inconnu', 'ouvert', true, app.current_user_id())
    returning * into v_incident;

    v_incident_id := v_incident.id;
  end if;

  -- Le stock lié passe en réceptionné : la matière n'est plus en transit.
  update public.stock_lots
     set status = 'receptionne', updated_at = now()
   where id in (select stock_lot_id from public.transfer_lots where transfer_id = p_transfer_id);

  insert into public.stock_movements
    (tenant_id, stock_lot_id, type, quantity_kg, source_table, source_id, reason, created_by)
  select v_transfer.tenant_id, tl.stock_lot_id, 'sortie', -tl.quantity_kg,
         'transfers', p_transfer_id, 'Réception au site de destination', app.current_user_id()
  from public.transfer_lots tl
  where tl.transfer_id = p_transfer_id;

  return jsonb_build_object(
    'transfer_id', p_transfer_id,
    'ecart_physique_kg', v_transfer.ecart_physique_kg,
    'ecart_physique_pct', v_transfer.ecart_physique_pct,
    'ecart_acceptation_kg', v_transfer.ecart_acceptation_kg,
    'ecart_paiement_kg', v_transfer.ecart_paiement_kg,
    'ecart_total_acceptation_kg', v_transfer.ecart_total_acceptation_kg,
    'ecart_financier_total_kg', v_transfer.ecart_financier_total_kg,
    'tolerance', v_tolerance,
    'exceeds_tolerance', v_exceeds,
    'incident_id', v_incident_id
  );
end;
$$;

create or replace function public.record_transfer_reception(
  p_transfer_id uuid, p_net_unloaded_kg numeric, p_accepted_kg numeric,
  p_paid_kg numeric default null, p_gross_reception_kg numeric default null,
  p_tare_reception_kg numeric default null, p_kor_reception numeric default null,
  p_humidity_reception numeric default null, p_rejected_kg numeric default null,
  p_rejection_reason text default null, p_receiver_name text default null,
  p_reception_ticket_path text default null
)
returns jsonb
language sql
volatile
set search_path = pg_catalog, app, public
as $$
  select app.record_transfer_reception(
    p_transfer_id, p_net_unloaded_kg, p_accepted_kg, p_paid_kg, p_gross_reception_kg,
    p_tare_reception_kg, p_kor_reception, p_humidity_reception, p_rejected_kg,
    p_rejection_reason, p_receiver_name, p_reception_ticket_path);
$$;

grant execute on function public.record_transfer_reception(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text
) to authenticated;

comment on function app.record_transfer_reception(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text
) is
  'Seul chemin d''enregistrement d''une réception. Saisir les poids, calculer les écarts, ouvrir '
  'l''incident et déplacer le stock forment une seule transaction : les séparer laisserait la base '
  'dans un état où le camion est arrivé mais la matière encore en transit.';

-- Relais public de la réservation transactionnelle définie en migration 1100 :
-- PostgREST n'expose que le schéma `public`, et l'interface doit passer par
-- cette fonction plutôt que d'insérer directement dans stock_reservations.
create or replace function public.reserve_stock(
  p_lot_id uuid, p_plan_id uuid, p_quantity numeric, p_partner uuid
)
returns uuid
language sql
volatile
set search_path = pg_catalog, app, public
as $$ select app.reserve_stock(p_lot_id, p_plan_id, p_quantity, p_partner); $$;

grant execute on function public.reserve_stock(uuid, uuid, numeric, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Couverture des avances par la réception acceptée (arbitrage D1)
-- -----------------------------------------------------------------------------

create or replace function app.cover_advances_from_reception(p_transfer_id uuid)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_transfer public.transfers;
  v_agent    uuid;
  v_value    numeric;
  v_leftover numeric;
begin
  select * into v_transfer from public.transfers where id = p_transfer_id;
  if not found or v_transfer.accepted_kg is null then
    return 0;
  end if;

  -- Le pisteur concerné est celui du planning : c'est lui dont les avances ont
  -- financé la matière livrée.
  select field_agent_id into v_agent
  from public.delivery_plans where id = v_transfer.delivery_plan_id;

  if v_agent is null then
    return 0;
  end if;

  -- Valorisation au prix appliqué au transfert, jamais au prix du jour.
  v_value := v_transfer.accepted_kg * coalesce(v_transfer.applied_price_value, 0);
  if v_value <= 0 then
    return 0;
  end if;

  v_leftover := app.allocate_advance_fifo(
    v_agent, v_transfer.partner_company_id, 'reception', p_transfer_id, v_value);

  -- Le reliquat non affecté est renvoyé : un excédent de couverture doit rester
  -- visible plutôt que d'être absorbé en silence.
  return v_leftover;
end;
$$;

create or replace function public.cover_advances_from_reception(p_transfer_id uuid)
returns numeric
language sql
volatile
set search_path = pg_catalog, app, public
as $$ select app.cover_advances_from_reception(p_transfer_id); $$;

grant execute on function public.cover_advances_from_reception(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Chargement : le stock quitte le magasin
-- -----------------------------------------------------------------------------

create or replace function app.enforce_transfer_dispatch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
begin
  if new.status = 'en_transit' and old.status is distinct from 'en_transit' then
    if new.net_loaded_kg is null or new.net_loaded_kg <= 0 then
      raise exception 'Le poids net chargé doit être renseigné avant le départ du camion.'
        using errcode = 'check_violation';
    end if;

    -- Un poids déclaré n'interdit pas le départ, mais il est conservé comme tel :
    -- l'écart constaté à l'arrivée devra en tenir compte.
    if new.weighing_ticket_path is null and new.weight_source = 'verified' then
      raise exception
        'Un poids déclaré « vérifié » exige le ticket de pesée. Sinon, marquez-le comme estimé ou déclaré.'
        using errcode = 'check_violation';
    end if;

    update public.stock_lots
       set status = 'en_transit', holder_type = 'in_transit', updated_at = now()
     where id in (select stock_lot_id from public.transfer_lots where transfer_id = new.id);
  end if;

  return new;
end;
$$;

create trigger transfers_dispatch_guard
  before update on public.transfers
  for each row execute function app.enforce_transfer_dispatch();

-- -----------------------------------------------------------------------------
-- Cohérence du stock réservé lors du chargement
-- -----------------------------------------------------------------------------

create or replace function app.enforce_transfer_lot_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_lot       public.stock_lots;
  v_transfer  public.transfers;
  v_assigned  numeric;
begin
  select * into v_lot from public.stock_lots where id = new.stock_lot_id for update;
  select * into v_transfer from public.transfers where id = new.transfer_id;

  if v_lot.partner_company_id is not null
     and v_lot.partner_company_id <> v_transfer.partner_company_id then
    raise exception
      'Ce lot est affecté à une autre société. Une réaffectation approuvée est requise avant chargement.'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(quantity_kg), 0) into v_assigned
  from public.transfer_lots
  where stock_lot_id = new.stock_lot_id and transfer_id <> new.transfer_id;

  if v_assigned + new.quantity_kg > v_lot.quantity_kg then
    raise exception
      'La quantité chargée dépasse la quantité du lot (disponible : % kg).',
      (v_lot.quantity_kg - v_assigned)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger transfer_lots_capacity_guard
  before insert or update on public.transfer_lots
  for each row execute function app.enforce_transfer_lot_capacity();
