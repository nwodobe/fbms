-- =============================================================================
-- LBA Control · 2000 · Couverture des avances sans planning préalable
-- =============================================================================
-- Écart trouvé par le parcours de démonstration complet (E2E-14), et par lui
-- seul : chaque règle était juste isolément, l'enchaînement ne l'était pas.
--
-- `app.cover_advances_from_reception` identifiait le pisteur concerné **par le
-- planning du transfert**. Or `transfers.delivery_plan_id` est nullable : un
-- chargement direct, décidé le matin parce qu'un camion passait, produit un
-- transfert sans planning.
--
-- Conséquence, silencieuse : la réception n'affectait aucune avance. Le pisteur
-- avait livré, l'argent restait compté comme étant chez lui, l'alerte
-- « argent chez le pisteur depuis N jours » se déclenchait à tort, et la
-- composante « couverture des avances » de son score le sanctionnait pour une
-- livraison qu'il avait bel et bien faite.
--
-- Le correctif remonte au pisteur par la matière chargée quand le planning est
-- absent, et répartit la valeur reçue au prorata de ce que chacun a chargé.
-- =============================================================================

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
  v_total_kg numeric;
  v_leftover numeric := 0;
  r          record;
begin
  select * into v_transfer from public.transfers where id = p_transfer_id;
  if not found or v_transfer.accepted_kg is null then
    return 0;
  end if;

  -- Valorisation au prix appliqué au transfert, jamais au prix du jour.
  v_value := v_transfer.accepted_kg * coalesce(v_transfer.applied_price_value, 0);
  if v_value <= 0 then
    return 0;
  end if;

  -- Chemin nominal : le planning désigne le pisteur dont les avances ont
  -- financé la matière.
  select field_agent_id into v_agent
  from public.delivery_plans where id = v_transfer.delivery_plan_id;

  if v_agent is not null then
    return app.allocate_advance_fifo(
      v_agent, v_transfer.partner_company_id, 'reception', p_transfer_id, v_value);
  end if;

  -- Chargement direct, sans planning : on remonte au pisteur par les lots
  -- réellement chargés. Ne rien faire ici laisserait l'argent compté comme
  -- étant chez un pisteur qui a pourtant livré.
  select sum(tl.quantity_kg) into v_total_kg
  from public.transfer_lots tl
  join public.stock_lots sl on sl.id = tl.stock_lot_id
  where tl.transfer_id = p_transfer_id and sl.field_agent_id is not null;

  if coalesce(v_total_kg, 0) <= 0 then
    -- Aucun pisteur identifiable : on ne devine pas. Retourner la valeur
    -- entière en reliquat la rend visible plutôt que de la faire disparaître.
    return v_value;
  end if;

  -- Plusieurs pisteurs peuvent avoir alimenté le même camion. Chacun est
  -- couvert au prorata de ce qu'il a chargé : attribuer le tout au premier
  -- serait arbitraire, et injuste pour les autres.
  for r in
    select sl.field_agent_id as agent_id, sum(tl.quantity_kg) as loaded_kg
    from public.transfer_lots tl
    join public.stock_lots sl on sl.id = tl.stock_lot_id
    where tl.transfer_id = p_transfer_id and sl.field_agent_id is not null
    group by sl.field_agent_id
  loop
    v_leftover := v_leftover + app.allocate_advance_fifo(
      r.agent_id,
      v_transfer.partner_company_id,
      'reception',
      p_transfer_id,
      round(v_value * r.loaded_kg / v_total_kg, 2));
  end loop;

  return v_leftover;
end;
$$;

comment on function app.cover_advances_from_reception(uuid) is
  'Couvre les avances à partir d''une réception acceptée (arbitrage D1). Le pisteur vient du planning '
  'quand il existe, sinon des lots réellement chargés — sans quoi un chargement direct laisserait '
  'l''argent compté comme étant chez un pisteur qui a pourtant livré.';
