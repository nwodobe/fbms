-- =============================================================================
-- LBA Control · 1700 · Dépenses, allocations, TCB, marges, scoring et alertes
-- =============================================================================
-- Phase 5 : le produit commence à porter des jugements. Trois exigences
-- gouvernent tout ce fichier :
--
--   · un chiffre qui juge doit être reconstituable jusqu'à la transaction ;
--   · un coût ne doit jamais être compté deux fois ;
--   · aucun calcul ne sanctionne personne — il propose, un humain décide.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Le score ajusté par événements externes est distinct du score affiché
-- -----------------------------------------------------------------------------
-- Trois valeurs coexistent et doivent rester distinguables : le brut, celui
-- corrigé des événements externes validés, et celui affiché après ajustement
-- humain motivé. Les confondre reviendrait à effacer qui a corrigé quoi.

alter table agent_scores
  add column if not exists event_adjusted_score numeric(6,2)
    check (event_adjusted_score between 0 and 100);

comment on column agent_scores.raw_score is
  'Score brut : moyenne pondérée des composantes mesurées, sans aucune correction.';
comment on column agent_scores.event_adjusted_score is
  'Score après neutralisation des seules observations couvertes par un événement externe VALIDÉ.';
comment on column agent_scores.adjusted_score is
  'Score AFFICHÉ = score ajusté aux événements + ajustements humains motivés, borné à [0, 100].';

-- -----------------------------------------------------------------------------
-- Discipline de la dépense
-- -----------------------------------------------------------------------------

/*
 * Une dépense validée est un engagement. Son montant, sa catégorie et son
 * bénéficiaire deviennent immuables : un montant révisable après validation
 * rendrait la validation décorative, et le TCB avec elle.
 */
create or replace function app.enforce_expense_workflow()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('validee', 'payee', 'partiellement_payee') then
    if new.amount <> old.amount
       or new.category_id <> old.category_id
       or lower(btrim(new.beneficiary)) <> lower(btrim(old.beneficiary)) then
      raise exception
        'Une dépense validée ne peut plus changer de montant, de catégorie ni de bénéficiaire. '
        'Annulez-la avec un motif, puis saisissez la dépense corrigée.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'validee' and old.status <> 'validee' then
    if new.validated_by is null then
      raise exception 'Une validation exige un valideur identifié.'
        using errcode = 'check_violation';
    end if;

    -- Séparation des tâches : celui qui saisit ne valide pas. Sans cela, un
    -- seul utilisateur peut créer et approuver sa propre dépense.
    if new.submitted_by is not null and new.validated_by = new.submitted_by then
      raise exception
        'Une dépense ne peut pas être validée par la personne qui l''a soumise.'
        using errcode = 'check_violation';
    end if;

    new.validated_at := coalesce(new.validated_at, now());
  end if;

  return new;
end;
$$;

create trigger expenses_workflow_guard
  before update on public.expenses
  for each row execute function app.enforce_expense_workflow();

-- -----------------------------------------------------------------------------
-- Détection de doublons de dépenses
-- -----------------------------------------------------------------------------
-- Pondérations alignées sur src/domain/duplicates.ts : aucun critère ne
-- déclenche seul un signalement, et rien n'est bloqué — seulement signalé.

create or replace function app.expense_duplicate_score(
  a public.expenses,
  b public.expenses
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_score    integer := 0;
  v_criteria text[] := array[]::text[];
begin
  if a.category_id = b.category_id then
    v_score := v_score + 15; v_criteria := v_criteria || 'categorie'::text;
  end if;

  if lower(btrim(a.beneficiary)) = lower(btrim(b.beneficiary)) then
    v_score := v_score + 25; v_criteria := v_criteria || 'beneficiaire'::text;
  end if;

  if a.expense_date = b.expense_date then
    v_score := v_score + 20; v_criteria := v_criteria || 'date'::text;
  elsif abs(a.expense_date - b.expense_date) <= 1 then
    v_score := v_score + 10; v_criteria := v_criteria || 'date_proche'::text;
  end if;

  if abs(a.amount - b.amount) < 0.01 then
    v_score := v_score + 25; v_criteria := v_criteria || 'montant'::text;
  elsif a.amount > 0 and abs(a.amount - b.amount) / a.amount <= 0.02 then
    v_score := v_score + 10; v_criteria := v_criteria || 'montant_proche'::text;
  end if;

  if a.reference is not null and btrim(a.reference) <> ''
     and btrim(a.reference) = btrim(b.reference) then
    v_score := v_score + 25; v_criteria := v_criteria || 'reference'::text;
  end if;

  if a.field_agent_id is not null and a.field_agent_id = b.field_agent_id then
    v_score := v_score + 5; v_criteria := v_criteria || 'pisteur'::text;
  end if;

  if a.transfer_id is not null and a.transfer_id = b.transfer_id then
    v_score := v_score + 5; v_criteria := v_criteria || 'transfert'::text;
  end if;

  return jsonb_build_object('score', least(100, v_score), 'criteria', to_jsonb(v_criteria));
end;
$$;

create or replace function app.detect_expense_duplicates()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_other  public.expenses;
  v_result jsonb;
begin
  for v_other in
    select e.* from public.expenses e
    where e.tenant_id = new.tenant_id
      and e.id <> new.id
      and e.status not in ('rejetee', 'annulee')
      and e.expense_date between new.expense_date - 3 and new.expense_date + 3
  loop
    v_result := app.expense_duplicate_score(new, v_other);

    if (v_result->>'score')::integer >= 60 then
      insert into public.expense_duplicate_flags
        (tenant_id, expense_id, candidate_id, similarity_score, matched_criteria)
      values
        (new.tenant_id, new.id, v_other.id, (v_result->>'score')::integer,
         array(select jsonb_array_elements_text(v_result->'criteria')))
      on conflict (expense_id, candidate_id) do update
        set similarity_score = excluded.similarity_score,
            matched_criteria = excluded.matched_criteria;
    end if;
  end loop;

  return new;
end;
$$;

create trigger expenses_duplicate_detection
  after insert on public.expenses
  for each row execute function app.detect_expense_duplicates();

-- -----------------------------------------------------------------------------
-- Base de répartition des charges indirectes
-- -----------------------------------------------------------------------------

/*
 * Valeur de la clé de répartition pour une cible.
 *
 * Chaque clé lit une source différente : les kilos acceptés viennent des
 * réceptions, la valeur d'achat des achats validés, les sacs des mouvements de
 * sacherie. Une clé qui lirait une valeur saisie à la main ne serait pas une
 * clé, mais une opinion.
 */
create or replace function app.allocation_base(
  p_tenant      uuid,
  p_key         allocation_key,
  p_target_type allocation_target,
  p_target_id   uuid,
  p_campaign_id uuid default null
)
returns numeric
language plpgsql
stable
set search_path = pg_catalog, app, public
as $$
declare
  v numeric := 0;
begin
  if p_key = 'poids_accepte' then
    select coalesce(sum(t.accepted_kg), 0) into v
    from public.transfers t
    where t.tenant_id = p_tenant
      and t.status <> 'annule'
      and t.accepted_kg is not null
      and (p_campaign_id is null or t.campaign_id = p_campaign_id)
      and (
        (p_target_type = 'partner'  and t.partner_company_id = p_target_id) or
        (p_target_type = 'contract' and t.contract_id = p_target_id) or
        (p_target_type = 'campaign' and t.campaign_id = p_target_id) or
        (p_target_type = 'transfer' and t.id = p_target_id)
      );

  elsif p_key = 'valeur_achat' then
    select coalesce(sum(p.amount), 0) into v
    from public.purchases p
    where p.tenant_id = p_tenant
      and p.status in ('valide', 'paye')
      and (p_campaign_id is null or p.campaign_id = p_campaign_id)
      and (
        (p_target_type = 'partner'     and p.partner_company_id = p_target_id) or
        (p_target_type = 'contract'    and p.contract_id = p_target_id) or
        (p_target_type = 'campaign'    and p.campaign_id = p_target_id) or
        (p_target_type = 'field_agent' and p.field_agent_id = p_target_id)
      );

  elsif p_key = 'nb_livraisons' then
    select count(*) into v
    from public.transfers t
    where t.tenant_id = p_tenant
      and t.status in ('receptionne', 'cloture')
      and (p_campaign_id is null or t.campaign_id = p_campaign_id)
      and (
        (p_target_type = 'partner'  and t.partner_company_id = p_target_id) or
        (p_target_type = 'contract' and t.contract_id = p_target_id) or
        (p_target_type = 'campaign' and t.campaign_id = p_target_id)
      );

  elsif p_key = 'nb_sacs' then
    select coalesce(sum(t.bag_count_received), 0) into v
    from public.transfers t
    where t.tenant_id = p_tenant
      and t.status <> 'annule'
      and (p_campaign_id is null or t.campaign_id = p_campaign_id)
      and (
        (p_target_type = 'partner'  and t.partner_company_id = p_target_id) or
        (p_target_type = 'contract' and t.contract_id = p_target_id) or
        (p_target_type = 'campaign' and t.campaign_id = p_target_id) or
        (p_target_type = 'transfer' and t.id = p_target_id)
      );

  elsif p_key = 'jours_stockage' then
    select coalesce(sum(greatest(1, extract(day from now() - sl.created_at))), 0) into v
    from public.stock_lots sl
    where sl.tenant_id = p_tenant
      and sl.status not in ('cloture', 'rejete')
      and (p_campaign_id is null or sl.campaign_id = p_campaign_id)
      and (
        (p_target_type = 'partner'  and sl.partner_company_id = p_target_id) or
        (p_target_type = 'campaign' and sl.campaign_id = p_target_id) or
        (p_target_type = 'lot'      and sl.id = p_target_id)
      );

  else
    -- 'manuel' : aucune base calculable. Retourner 0 forcerait un refus clair
    -- plus haut plutôt qu'une répartition inventée.
    v := 0;
  end if;

  return coalesce(v, 0);
end;
$$;

/*
 * Répartit une charge indirecte et historise chaque quote-part.
 *
 * Refuse plutôt que d'imputer zéro : une charge répartie sur une clé nulle
 * disparaîtrait du TCB sans que personne ne s'en aperçoive. Le reliquat
 * d'arrondi va à la plus grosse part, de sorte que la somme des quotes-parts
 * égale toujours le montant réparti au centime près.
 */
create or replace function app.allocate_indirect_expense(
  p_expense_id  uuid,
  p_key         allocation_key,
  p_target_type allocation_target,
  p_target_ids  uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_expense   public.expenses;
  v_total     numeric := 0;
  v_id        uuid;
  v_base      numeric;
  v_bases     numeric[] := array[]::numeric[];
  v_cents     bigint;
  v_assigned  bigint := 0;
  v_share     bigint;
  v_max_index integer := 1;
  v_index     integer := 0;
  v_lines     jsonb := '[]'::jsonb;
begin
  select * into v_expense from public.expenses where id = p_expense_id;
  if not found then
    raise exception 'Dépense introuvable.' using errcode = 'no_data_found';
  end if;

  if not app.tenant_can_write(v_expense.tenant_id) then
    raise exception 'Écriture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  if v_expense.nature <> 'indirect' then
    raise exception
      'Seule une charge indirecte se répartit. Une dépense directe est déjà rattachée à son périmètre.'
      using errcode = 'check_violation';
  end if;

  if v_expense.status not in ('validee', 'payee', 'partiellement_payee') then
    raise exception
      'Seule une dépense validée se répartit : répartir un brouillon inscrirait au TCB un coût non engagé.'
      using errcode = 'check_violation';
  end if;

  if p_key = 'manuel' then
    raise exception
      'La clé manuelle n''est pas calculable : saisissez les quotes-parts, motivez-les et faites-les approuver.'
      using errcode = 'check_violation';
  end if;

  if p_target_ids is null or array_length(p_target_ids, 1) is null then
    raise exception 'Aucune cible de répartition fournie.' using errcode = 'check_violation';
  end if;

  foreach v_id in array p_target_ids loop
    v_base := app.allocation_base(
      v_expense.tenant_id, p_key, p_target_type, v_id, v_expense.campaign_id);
    v_bases := v_bases || v_base;
    v_total := v_total + v_base;
  end loop;

  if v_total <= 0 then
    raise exception
      'La clé « % » vaut zéro sur ce périmètre : la charge ne peut pas être imputée sans disparaître du TCB.',
      p_key
      using errcode = 'check_violation';
  end if;

  -- Ancienne répartition remplacée intégralement : deux jeux de quotes-parts
  -- coexistants doubleraient la charge.
  delete from public.expense_allocations where expense_id = p_expense_id;

  v_cents := round(v_expense.amount * 100)::bigint;

  for v_index in 1 .. array_length(p_target_ids, 1) loop
    if v_bases[v_index] > v_bases[v_max_index] then
      v_max_index := v_index;
    end if;
  end loop;

  for v_index in 1 .. array_length(p_target_ids, 1) loop
    v_share := floor(v_cents * v_bases[v_index] / v_total)::bigint;
    v_assigned := v_assigned + v_share;

    insert into public.expense_allocations
      (tenant_id, expense_id, target_type, target_id, allocation_key,
       base_value, total_base_value, share_ratio, allocated_amount, created_by)
    values
      (v_expense.tenant_id, p_expense_id, p_target_type, p_target_ids[v_index], p_key,
       v_bases[v_index], v_total, round(v_bases[v_index] / v_total, 8),
       v_share / 100.0, app.current_user_id());
  end loop;

  -- Reliquat d'arrondi à la plus grosse part : sans cela, la somme des
  -- quotes-parts ne rendrait pas le montant réparti.
  if v_cents - v_assigned <> 0 then
    update public.expense_allocations
       set allocated_amount = allocated_amount + (v_cents - v_assigned) / 100.0
     where expense_id = p_expense_id
       and target_id = p_target_ids[v_max_index]
       and target_type = p_target_type;
  end if;

  select jsonb_agg(jsonb_build_object(
           'target_id', target_id,
           'base_value', base_value,
           'share_ratio', share_ratio,
           'allocated_amount', allocated_amount) order by allocated_amount desc)
    into v_lines
  from public.expense_allocations
  where expense_id = p_expense_id;

  return jsonb_build_object(
    'expense_id', p_expense_id,
    'allocation_key', p_key,
    'total_base_value', v_total,
    'allocated_total', (select sum(allocated_amount) from public.expense_allocations
                        where expense_id = p_expense_id),
    'lines', coalesce(v_lines, '[]'::jsonb));
end;
$$;

create or replace function public.allocate_indirect_expense(
  p_expense_id uuid, p_key allocation_key, p_target_type allocation_target, p_target_ids uuid[]
)
returns jsonb
language sql
set search_path = pg_catalog, app, public
as $$ select app.allocate_indirect_expense(p_expense_id, p_key, p_target_type, p_target_ids); $$;

grant execute on function public.allocate_indirect_expense(uuid, allocation_key, allocation_target, uuid[])
  to authenticated;

-- -----------------------------------------------------------------------------
-- TCB · calcul et instantané explicable
-- -----------------------------------------------------------------------------

/*
 * Calcule le TCB d'un périmètre, écrit l'instantané et sa décomposition.
 *
 * La valeur d'achat vient de `purchases`, jamais d'une dépense : la catégorie
 * `achat_produit` est réservée au système précisément pour cela (INC-05). Les
 * avances n'apparaissent nulle part — une remise de fonds n'est pas un coût.
 *
 * `tcb_per_accepted_kg` reste NULL quand aucun kilo n'est accepté : afficher 0
 * ferait croire à une matière gratuite (H-04).
 */
create or replace function app.compute_tcb(
  p_scope_type  allocation_target,
  p_scope_id    uuid,
  p_campaign_id uuid default null,
  p_is_forecast boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_tenant       uuid;
  v_purchase     numeric := 0;
  v_purchase_n   integer := 0;
  v_direct       numeric := 0;
  v_indirect     numeric := 0;
  v_indirect_n   integer := 0;
  v_losses       numeric := 0;
  v_losses_n     integer := 0;
  v_accepted     numeric;
  v_loaded       numeric;
  v_unloaded     numeric;
  v_paid         numeric;
  v_total        numeric;
  v_per_kg       numeric;
  v_snapshot     uuid;
  v_family       record;
begin
  -- Le périmètre détermine le tenant : jamais le client.
  v_tenant := case p_scope_type
    when 'partner'     then (select tenant_id from public.partner_companies where id = p_scope_id)
    when 'campaign'    then (select tenant_id from public.campaigns where id = p_scope_id)
    when 'contract'    then (select tenant_id from public.contracts where id = p_scope_id)
    when 'field_agent' then (select tenant_id from public.field_agents where id = p_scope_id)
    when 'lot'         then (select tenant_id from public.stock_lots where id = p_scope_id)
    when 'transfer'    then (select tenant_id from public.transfers where id = p_scope_id)
  end;

  if v_tenant is null then
    raise exception 'Périmètre de TCB introuvable.' using errcode = 'no_data_found';
  end if;

  if not app.can_read_tenant(v_tenant) then
    raise exception 'Lecture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  -- Valeur d'achat -----------------------------------------------------------
  select coalesce(sum(p.amount), 0), count(*) into v_purchase, v_purchase_n
  from public.purchases p
  where p.tenant_id = v_tenant
    and p.status in ('valide', 'paye')
    and (p_campaign_id is null or p.campaign_id = p_campaign_id)
    and (
      (p_scope_type = 'partner'     and p.partner_company_id = p_scope_id) or
      (p_scope_type = 'campaign'    and p.campaign_id = p_scope_id) or
      (p_scope_type = 'contract'    and p.contract_id = p_scope_id) or
      (p_scope_type = 'field_agent' and p.field_agent_id = p_scope_id) or
      (p_scope_type in ('lot', 'transfer') and false)
    );

  -- Dépenses directes validées ----------------------------------------------
  select coalesce(sum(e.amount), 0) into v_direct
  from public.expenses e
  join public.expense_categories ec on ec.id = e.category_id
  where e.tenant_id = v_tenant
    and e.nature = 'direct'
    and e.status in ('validee', 'payee', 'partiellement_payee')
    and ec.code <> 'achat_produit'
    and (p_campaign_id is null or e.campaign_id = p_campaign_id)
    and (
      (p_scope_type = 'partner'     and e.partner_company_id = p_scope_id) or
      (p_scope_type = 'campaign'    and e.campaign_id = p_scope_id) or
      (p_scope_type = 'contract'    and e.contract_id = p_scope_id) or
      (p_scope_type = 'field_agent' and e.field_agent_id = p_scope_id) or
      (p_scope_type = 'lot'         and e.stock_lot_id = p_scope_id) or
      (p_scope_type = 'transfer'    and e.transfer_id = p_scope_id)
    );

  -- Quotes-parts indirectes --------------------------------------------------
  select coalesce(sum(ea.allocated_amount), 0), count(*) into v_indirect, v_indirect_n
  from public.expense_allocations ea
  join public.expenses e on e.id = ea.expense_id
  where ea.tenant_id = v_tenant
    and ea.target_type = p_scope_type
    and ea.target_id = p_scope_id
    and e.status in ('validee', 'payee', 'partiellement_payee');

  -- Pertes valorisées --------------------------------------------------------
  -- Valorisation au prix net reconnu appliqué au transfert (arbitrage D2).
  select coalesce(sum(
           greatest(coalesce(t.ecart_physique_kg, 0), 0)
           * coalesce(t.applied_price_value, 0)), 0),
         count(*) filter (where coalesce(t.ecart_physique_kg, 0) > 0)
    into v_losses, v_losses_n
  from public.transfers t
  where t.tenant_id = v_tenant
    and t.status in ('receptionne', 'cloture')
    and (p_campaign_id is null or t.campaign_id = p_campaign_id)
    and (
      (p_scope_type = 'partner'  and t.partner_company_id = p_scope_id) or
      (p_scope_type = 'campaign' and t.campaign_id = p_scope_id) or
      (p_scope_type = 'contract' and t.contract_id = p_scope_id) or
      (p_scope_type = 'transfer' and t.id = p_scope_id) or
      (p_scope_type in ('field_agent', 'lot') and false)
    );

  -- Poids --------------------------------------------------------------------
  select sum(t.accepted_kg), sum(t.net_loaded_kg), sum(t.net_unloaded_kg), sum(t.paid_kg)
    into v_accepted, v_loaded, v_unloaded, v_paid
  from public.transfers t
  where t.tenant_id = v_tenant
    and t.status <> 'annule'
    and (p_campaign_id is null or t.campaign_id = p_campaign_id)
    and (
      (p_scope_type = 'partner'  and t.partner_company_id = p_scope_id) or
      (p_scope_type = 'campaign' and t.campaign_id = p_scope_id) or
      (p_scope_type = 'contract' and t.contract_id = p_scope_id) or
      (p_scope_type = 'transfer' and t.id = p_scope_id) or
      (p_scope_type in ('field_agent', 'lot') and false)
    );

  v_total  := round(v_purchase + v_direct + v_indirect + v_losses, 2);
  v_per_kg := case when coalesce(v_accepted, 0) > 0
                   then round(v_total / v_accepted, 4) end;

  insert into public.tcb_snapshots
    (tenant_id, scope_type, scope_id, campaign_id, is_forecast,
     accepted_weight_kg, loaded_weight_kg, unloaded_weight_kg, paid_weight_kg,
     purchase_value, direct_expenses, indirect_allocated, valued_losses,
     tcb_total, tcb_per_accepted_kg, inputs, created_by)
  values
    (v_tenant, p_scope_type, p_scope_id, p_campaign_id, p_is_forecast,
     v_accepted, v_loaded, v_unloaded, v_paid,
     v_purchase, v_direct, v_indirect, v_losses,
     v_total, v_per_kg,
     jsonb_build_object(
       'purchase_count', v_purchase_n,
       'indirect_allocation_count', v_indirect_n,
       'loss_count', v_losses_n,
       'accepted_weight_kg', v_accepted,
       'note', case when coalesce(v_accepted, 0) > 0 then null
                    else 'Aucun kilo accepté : le TCB par kilo reste non calculable.' end),
     app.current_user_id())
  returning id into v_snapshot;

  -- Décomposition ------------------------------------------------------------
  insert into public.tcb_snapshot_components
    (tenant_id, snapshot_id, component, amount, amount_per_kg, source_count)
  values
    (v_tenant, v_snapshot, 'valeur_achat', v_purchase,
     case when coalesce(v_accepted, 0) > 0 then round(v_purchase / v_accepted, 4) end,
     v_purchase_n);

  for v_family in
    select ec.family, sum(e.amount) as amount, count(*) as n
    from public.expenses e
    join public.expense_categories ec on ec.id = e.category_id
    where e.tenant_id = v_tenant
      and e.nature = 'direct'
      and e.status in ('validee', 'payee', 'partiellement_payee')
      and ec.code <> 'achat_produit'
      and (p_campaign_id is null or e.campaign_id = p_campaign_id)
      and (
        (p_scope_type = 'partner'     and e.partner_company_id = p_scope_id) or
        (p_scope_type = 'campaign'    and e.campaign_id = p_scope_id) or
        (p_scope_type = 'contract'    and e.contract_id = p_scope_id) or
        (p_scope_type = 'field_agent' and e.field_agent_id = p_scope_id) or
        (p_scope_type = 'lot'         and e.stock_lot_id = p_scope_id) or
        (p_scope_type = 'transfer'    and e.transfer_id = p_scope_id)
      )
    group by ec.family
  loop
    insert into public.tcb_snapshot_components
      (tenant_id, snapshot_id, component, amount, amount_per_kg, source_count)
    values
      (v_tenant, v_snapshot, 'depenses:' || v_family.family, v_family.amount,
       case when coalesce(v_accepted, 0) > 0 then round(v_family.amount / v_accepted, 4) end,
       v_family.n);
  end loop;

  if v_indirect_n > 0 then
    insert into public.tcb_snapshot_components
      (tenant_id, snapshot_id, component, amount, amount_per_kg, source_count)
    values
      (v_tenant, v_snapshot, 'charges_indirectes', v_indirect,
       case when coalesce(v_accepted, 0) > 0 then round(v_indirect / v_accepted, 4) end,
       v_indirect_n);
  end if;

  if v_losses_n > 0 then
    insert into public.tcb_snapshot_components
      (tenant_id, snapshot_id, component, amount, amount_per_kg, source_count)
    values
      (v_tenant, v_snapshot, 'pertes_valorisees', v_losses,
       case when coalesce(v_accepted, 0) > 0 then round(v_losses / v_accepted, 4) end,
       v_losses_n);
  end if;

  return v_snapshot;
end;
$$;

create or replace function public.compute_tcb(
  p_scope_type allocation_target, p_scope_id uuid,
  p_campaign_id uuid default null, p_is_forecast boolean default false
)
returns uuid
language sql
set search_path = pg_catalog, app, public
as $$ select app.compute_tcb(p_scope_type, p_scope_id, p_campaign_id, p_is_forecast); $$;

grant execute on function public.compute_tcb(allocation_target, uuid, uuid, boolean) to authenticated;

/*
 * Marge d'un instantané.
 *
 * Écrit les deux marges ET leur écart de réconciliation (INC-06). L'écart n'est
 * pas corrigé : il indique que le chiffre d'affaires ne porte pas exactement
 * sur le poids accepté, ce qui est une information de contrôle.
 */
create or replace function app.record_margin(
  p_snapshot_id       uuid,
  p_net_revenue       numeric,
  p_net_sale_price_kg numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_snapshot public.tcb_snapshots;
  v_total    numeric;
  v_per_kg   numeric;
  v_implied  numeric;
  v_gap      numeric;
begin
  select * into v_snapshot from public.tcb_snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'Instantané de TCB introuvable.' using errcode = 'no_data_found';
  end if;

  if not app.tenant_can_write(v_snapshot.tenant_id) then
    raise exception 'Écriture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  v_total := case when p_net_revenue is not null
                  then round(p_net_revenue - v_snapshot.tcb_total, 2) end;

  v_per_kg := case when p_net_sale_price_kg is not null
                    and v_snapshot.tcb_per_accepted_kg is not null
                   then round(p_net_sale_price_kg - v_snapshot.tcb_per_accepted_kg, 4) end;

  v_implied := case when v_per_kg is not null and coalesce(v_snapshot.accepted_weight_kg, 0) > 0
                    then round(v_per_kg * v_snapshot.accepted_weight_kg, 2) end;

  v_gap := case when v_total is not null and v_implied is not null
                then round(v_total - v_implied, 2) end;

  update public.tcb_snapshots
     set net_sale_price = p_net_sale_price_kg,
         net_revenue = p_net_revenue,
         margin_total = v_total,
         margin_per_kg = v_per_kg,
         margin_reconciliation_gap = v_gap,
         is_deficit = case when v_total is not null then v_total < 0 end
   where id = p_snapshot_id;

  return jsonb_build_object(
    'margin_total', v_total,
    'margin_per_kg', v_per_kg,
    'implied_margin', v_implied,
    'margin_reconciliation_gap', v_gap,
    'is_deficit', case when v_total is not null then v_total < 0 end);
end;
$$;

create or replace function public.record_margin(
  p_snapshot_id uuid, p_net_revenue numeric, p_net_sale_price_kg numeric
)
returns jsonb
language sql
set search_path = pg_catalog, app, public
as $$ select app.record_margin(p_snapshot_id, p_net_revenue, p_net_sale_price_kg); $$;

grant execute on function public.record_margin(uuid, numeric, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- Scoring · explicable, jamais punitif d'office
-- -----------------------------------------------------------------------------

/*
 * Montant couvert d'une avance : allocations FIFO + remboursements non annulés.
 *
 * Extrait ici parce que trois calculs distincts en dépendent — le score, les
 * alertes et l'exposition. Trois formules recopiées finiraient par diverger,
 * et deux chiffres de couverture différents dans le même écran détruiraient la
 * crédibilité des deux.
 */
create or replace function app.advance_covered(p_advance_id uuid)
returns numeric
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce((select sum(al.amount) from public.advance_allocations al
                    where al.advance_id = p_advance_id), 0)
       + coalesce((select sum(r.amount) from public.advance_repayments r
                    where r.advance_id = p_advance_id and r.cancelled_at is null), 0);
$$;

create or replace function app.score_weight(p_component score_component_code)
returns numeric
language sql
immutable
as $$
  select case p_component
    when 'couverture_avances'      then 20
    when 'respect_delais'          then 15
    when 'ecarts_poids'            then 15
    when 'respect_prix'            then 10
    when 'qualite'                 then 10
    when 'fiabilite_justificatifs' then 10
    when 'gestion_sacs'            then 5
    when 'regularite'              then 5
    when 'maitrise_tcb'            then 10
  end::numeric;
$$;

/*
 * Calcule le score d'un pisteur sur une période.
 *
 * Deux règles structurent le calcul :
 *
 *   · une composante sans observation est EXCLUE, jamais notée zéro : punir un
 *     pisteur pour une dotation de sacs qu'il n'a jamais reçue serait une
 *     sanction fabriquée. Les poids sont renormalisés sur les composantes
 *     réellement mesurées ;
 *
 *   · la maturité gouverne la catégorie. En dessous du seuil d'observation,
 *     aucune catégorie n'est prononcée.
 *
 * Le plafond recommandé est écrit dans `agent_scores.recommended_ceiling` et
 * NULLE PART ailleurs : `field_agents.ceiling_amount` n'est jamais touché ici.
 */
create or replace function app.compute_agent_score(
  p_agent_id     uuid,
  p_campaign_id  uuid default null,
  p_period_start date default null,
  p_period_end   date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_agent        public.field_agents;
  v_start        date;
  v_end          date;
  v_score_id     uuid;
  v_raw          numeric;
  v_event_adj    numeric;
  v_displayed    numeric;
  v_maturity     score_maturity;
  v_category     score_category;
  v_operations   integer;
  v_active_days  integer;
  v_total_weight numeric := 0;
  c              record;
begin
  select * into v_agent from public.field_agents where id = p_agent_id;
  if not found then
    raise exception 'Pisteur introuvable.' using errcode = 'no_data_found';
  end if;

  if not app.tenant_can_write(v_agent.tenant_id) then
    raise exception 'Écriture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  v_end   := coalesce(p_period_end, current_date);
  v_start := coalesce(p_period_start, v_end - 90);

  -- Volume et durée d'activité : ils gouvernent la maturité, pas le score.
  select count(*),
         coalesce(greatest(1, (max(p.purchased_at)::date - min(p.purchased_at)::date)), 0)
    into v_operations, v_active_days
  from public.purchases p
  where p.tenant_id = v_agent.tenant_id
    and p.field_agent_id = p_agent_id
    and p.status in ('valide', 'paye')
    and p.purchased_at::date between v_start and v_end
    and (p_campaign_id is null or p.campaign_id = p_campaign_id);

  v_maturity := case
    when v_operations >= 25 and v_active_days >= 45 then 'confirme'
    when v_operations >= 10 and v_active_days >= 21 then 'provisoire'
    when v_operations >= 3  and v_active_days >= 7  then 'en_observation'
    else 'non_evalue'
  end::score_maturity;

  insert into public.agent_scores
    (tenant_id, field_agent_id, campaign_id, period_start, period_end, maturity, created_by)
  values
    (v_agent.tenant_id, p_agent_id, p_campaign_id, v_start, v_end, v_maturity, app.current_user_id())
  returning id into v_score_id;

  -- Composante 1 · couverture des avances -----------------------------------
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'couverture_avances', app.score_weight('couverture_avances'),
         least(100, round(100 * coalesce(sum(app.advance_covered(a.id)), 0)
               / nullif(sum(a.amount), 0), 2)),
         0,
         jsonb_build_object('avances', count(*), 'montant', coalesce(sum(a.amount), 0),
                            'couvert', coalesce(sum(app.advance_covered(a.id)), 0)),
         'Part des montants avancés effectivement couverts par des réceptions acceptées.'
  from public.advances a
  where a.tenant_id = v_agent.tenant_id
    and a.field_agent_id = p_agent_id
    and a.status in ('decaisse', 'partiellement_couvert', 'cloture')
    and a.issued_at::date between v_start and v_end
    and (p_campaign_id is null or a.campaign_id = p_campaign_id)
  having sum(a.amount) > 0;

  -- Composante 2 · respect des délais ---------------------------------------
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'respect_delais', app.score_weight('respect_delais'),
         round(100.0 * count(*) filter (where dp.status in ('receptionne', 'cloture'))
               / count(*), 2),
         0,
         jsonb_build_object('plannings', count(*),
                            'honores', count(*) filter (where dp.status in ('receptionne', 'cloture')),
                            'en_retard', count(*) filter (where dp.status not in
                              ('receptionne', 'cloture', 'annule', 'reporte')
                              and dp.planned_date < current_date)),
         'Plannings honorés sur l''ensemble des plannings de la période. Un report motivé compte '
         'comme non honoré, jamais comme une faute établie.'
  from public.delivery_plans dp
  where dp.tenant_id = v_agent.tenant_id
    and dp.field_agent_id = p_agent_id
    and dp.planned_date between v_start and v_end
    and (p_campaign_id is null or dp.campaign_id = p_campaign_id)
  having count(*) > 0;

  -- Composante 3 · écarts de poids ------------------------------------------
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'ecarts_poids', app.score_weight('ecarts_poids'),
         greatest(0, round(100 - 20 * coalesce(avg(abs(t.ecart_physique_pct)), 0), 2)),
         0,
         jsonb_build_object('transferts', count(*),
                            'ecart_moyen_pct', round(coalesce(avg(abs(t.ecart_physique_pct)), 0), 4)),
         'Écart physique moyen constaté. Un écart n''impute aucune responsabilité par lui-même.'
  from public.transfers t
  join public.delivery_plans dp on dp.id = t.delivery_plan_id
  where t.tenant_id = v_agent.tenant_id
    and dp.field_agent_id = p_agent_id
    and t.ecart_physique_pct is not null
    and t.dispatched_at::date between v_start and v_end
  having count(*) > 0;

  -- Composante 4 · respect des prix -----------------------------------------
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'respect_prix', app.score_weight('respect_prix'),
         round(100.0 * count(*) filter (where p.price_override_reason is null) / count(*), 2),
         0,
         jsonb_build_object('achats', count(*),
                            'hors_plafond', count(*) filter (where p.price_override_reason is not null)),
         'Achats réalisés dans le plafond de prix, sans dérogation.'
  from public.purchases p
  where p.tenant_id = v_agent.tenant_id
    and p.field_agent_id = p_agent_id
    and p.status in ('valide', 'paye')
    and p.purchased_at::date between v_start and v_end
    and (p_campaign_id is null or p.campaign_id = p_campaign_id)
  having count(*) > 0;

  -- Composante 5 · qualité ---------------------------------------------------
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'qualite', app.score_weight('qualite'),
         round(100.0 * count(*) filter (where coalesce(p.kor, 0) > 0) / count(*), 2),
         0,
         jsonb_build_object('achats', count(*), 'kor_moyen', round(coalesce(avg(p.kor), 0), 4)),
         'Part des achats dont la qualité a été mesurée à la collecte.'
  from public.purchases p
  where p.tenant_id = v_agent.tenant_id
    and p.field_agent_id = p_agent_id
    and p.status in ('valide', 'paye')
    and p.purchased_at::date between v_start and v_end
  having count(*) > 0;

  -- Composante 6 · fiabilité des justificatifs -------------------------------
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'fiabilite_justificatifs',
         app.score_weight('fiabilite_justificatifs'),
         round(100.0 * count(*) filter (where p.proof_path is not null) / count(*), 2),
         0,
         jsonb_build_object('achats', count(*),
                            'sans_justificatif', count(*) filter (where p.proof_path is null)),
         'Achats accompagnés d''une pièce justificative.'
  from public.purchases p
  where p.tenant_id = v_agent.tenant_id
    and p.field_agent_id = p_agent_id
    and p.status in ('valide', 'paye')
    and p.purchased_at::date between v_start and v_end
  having count(*) > 0;

  -- Composante 7 · gestion des sacs -----------------------------------------
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'gestion_sacs', app.score_weight('gestion_sacs'),
         greatest(0, round(100 - 100.0
           * coalesce(sum(abs(bm.quantity)) filter (where bm.type = 'perte'), 0)
           / nullif(sum(abs(bm.quantity)) filter (where bm.type = 'dotation_pisteur'), 0), 2)),
         0,
         jsonb_build_object(
           'dotations', coalesce(sum(abs(bm.quantity)) filter (where bm.type = 'dotation_pisteur'), 0),
           'pertes', coalesce(sum(abs(bm.quantity)) filter (where bm.type = 'perte'), 0)),
         'Sacs perdus rapportés aux sacs remis.'
  from public.bag_movements bm
  where bm.tenant_id = v_agent.tenant_id
    and bm.field_agent_id = p_agent_id
    and bm.occurred_at::date between v_start and v_end
  having sum(abs(bm.quantity)) filter (where bm.type = 'dotation_pisteur') > 0;

  -- Composante 8 · régularité ------------------------------------------------
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'regularite', app.score_weight('regularite'),
         least(100, round(100.0 * count(distinct p.purchased_at::date)
                          / greatest(1, (v_end - v_start) / 7.0), 2)),
         0,
         jsonb_build_object('jours_actifs', count(distinct p.purchased_at::date),
                            'semaines', round((v_end - v_start) / 7.0, 2)),
         'Jours d''activité rapportés au nombre de semaines de la période.'
  from public.purchases p
  where p.tenant_id = v_agent.tenant_id
    and p.field_agent_id = p_agent_id
    and p.status in ('valide', 'paye')
    and p.purchased_at::date between v_start and v_end
  having count(*) > 0;

  -- Composante 9 · maîtrise du TCB contrôlable -------------------------------
  -- Seuls les coûts que le pisteur contrôle réellement entrent ici (D6) :
  -- l'évaluer sur le gardiennage du magasin serait le noter sur une décision
  -- qui n'est pas la sienne.
  insert into public.agent_score_components
    (tenant_id, score_id, component, weight, value, weighted_value, source_data, explanation)
  select v_agent.tenant_id, v_score_id, 'maitrise_tcb', app.score_weight('maitrise_tcb'),
         greatest(0, least(100, round(100 - 100.0 * sum(e.amount)
           / nullif((select sum(p.amount) from public.purchases p
                     where p.tenant_id = v_agent.tenant_id
                       and p.field_agent_id = p_agent_id
                       and p.status in ('valide', 'paye')
                       and p.purchased_at::date between v_start and v_end), 0), 2))),
         0,
         jsonb_build_object('depenses_controlables', sum(e.amount), 'lignes', count(*)),
         'Coûts contrôlables par le pisteur rapportés à la valeur achetée.'
  from public.expenses e
  join public.expense_categories ec on ec.id = e.category_id
  where e.tenant_id = v_agent.tenant_id
    and e.field_agent_id = p_agent_id
    and ec.is_controllable_by_agent
    and e.status in ('validee', 'payee', 'partiellement_payee')
    and e.expense_date between v_start and v_end
  having sum(e.amount) > 0;

  -- Renormalisation des poids sur les composantes mesurées -------------------
  select coalesce(sum(weight), 0) into v_total_weight
  from public.agent_score_components where score_id = v_score_id;

  if v_total_weight > 0 then
    update public.agent_score_components
       set value = least(100, greatest(0, value)),
           weighted_value = round(least(100, greatest(0, value)) * weight / v_total_weight, 4)
     where score_id = v_score_id;

    select round(sum(weighted_value), 2) into v_raw
    from public.agent_score_components where score_id = v_score_id;
  end if;

  -- Score ajusté aux événements externes VALIDÉS -----------------------------
  -- Chaque événement validé recouvrant la période neutralise la pénalité de la
  -- composante « respect des délais » à hauteur de son poids.
  select case
           when v_raw is null then null
           else least(100, v_raw + coalesce((
             select round(sum(
               (100 - c2.value) * c2.weight / nullif(v_total_weight, 0)), 2)
             from public.agent_score_components c2
             where c2.score_id = v_score_id
               and c2.component = 'respect_delais'
               and exists (
                 select 1 from public.external_events ev
                 where ev.tenant_id = v_agent.tenant_id
                   and ev.field_agent_id = p_agent_id
                   and ev.validated_by is not null
                   and ev.occurred_from between v_start and v_end)), 0))
         end
    into v_event_adj;

  v_displayed := v_event_adj;

  v_category := case
    when v_displayed is null or v_maturity = 'non_evalue' then 'non_evalue'
    when v_displayed >= 85 then 'excellent'
    when v_displayed >= 70 then 'fiable'
    when v_displayed >= 55 then 'sous_surveillance'
    when v_displayed >= 40 then 'risque'
    else 'critique'
  end::score_category;

  update public.agent_scores
     set raw_score = v_raw,
         event_adjusted_score = v_event_adj,
         adjusted_score = v_displayed,
         category = v_category,
         -- RECOMMANDATION uniquement. Aucune écriture sur field_agents.
         recommended_ceiling = case
           when v_maturity = 'non_evalue' or v_displayed is null then null
           when v_displayed >= 85 then round(v_agent.ceiling_amount * 1.2, 2)
           when v_displayed >= 70 then v_agent.ceiling_amount
           when v_displayed >= 55 then round(v_agent.ceiling_amount * 0.85, 2)
           when v_displayed >= 40 then round(v_agent.ceiling_amount * 0.6, 2)
           else round(v_agent.ceiling_amount * 0.4, 2)
         end,
         excluded_events = coalesce((
           select jsonb_agg(jsonb_build_object('id', ev.id, 'type', ev.event_type))
           from public.external_events ev
           where ev.tenant_id = v_agent.tenant_id
             and ev.field_agent_id = p_agent_id
             and ev.validated_by is not null
             and ev.occurred_from between v_start and v_end), '[]'::jsonb)
   where id = v_score_id;

  return v_score_id;
end;
$$;

create or replace function public.compute_agent_score(
  p_agent_id uuid, p_campaign_id uuid default null,
  p_period_start date default null, p_period_end date default null
)
returns uuid
language sql
set search_path = pg_catalog, app, public
as $$ select app.compute_agent_score(p_agent_id, p_campaign_id, p_period_start, p_period_end); $$;

grant execute on function public.compute_agent_score(uuid, uuid, date, date) to authenticated;

/*
 * Ajustement humain motivé du score affiché.
 *
 * Modifie `adjusted_score`, jamais `raw_score` ni les composantes : le score
 * brut doit rester reconstituable après coup (RG-12).
 */
create or replace function app.adjust_agent_score(
  p_score_id uuid,
  p_delta    numeric,
  p_reason   text
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_score public.agent_scores;
  v_new   numeric;
begin
  select * into v_score from public.agent_scores where id = p_score_id;
  if not found then
    raise exception 'Score introuvable.' using errcode = 'no_data_found';
  end if;

  if not app.tenant_can_write(v_score.tenant_id) then
    raise exception 'Écriture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception
      'Un ajustement de score exige un motif d''au moins 10 caractères : sans motif, le score affiché '
      'devient invérifiable.'
      using errcode = 'check_violation';
  end if;

  if v_score.event_adjusted_score is null then
    raise exception 'Un score non calculable ne peut pas être ajusté.' using errcode = 'check_violation';
  end if;

  insert into public.agent_score_adjustments
    (tenant_id, score_id, delta, reason, adjusted_by)
  values
    (v_score.tenant_id, p_score_id, p_delta, p_reason, app.current_user_id());

  select least(100, greatest(0, v_score.event_adjusted_score + coalesce(sum(delta), 0)))
    into v_new
  from public.agent_score_adjustments where score_id = p_score_id;

  update public.agent_scores
     set adjusted_score = round(v_new, 2),
         category = case
           when maturity = 'non_evalue' then 'non_evalue'
           when v_new >= 85 then 'excellent'
           when v_new >= 70 then 'fiable'
           when v_new >= 55 then 'sous_surveillance'
           when v_new >= 40 then 'risque'
           else 'critique'
         end::score_category
   where id = p_score_id;

  return round(v_new, 2);
end;
$$;

create or replace function public.adjust_agent_score(
  p_score_id uuid, p_delta numeric, p_reason text
)
returns numeric
language sql
set search_path = pg_catalog, app, public
as $$ select app.adjust_agent_score(p_score_id, p_delta, p_reason); $$;

grant execute on function public.adjust_agent_score(uuid, numeric, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Règles d'alerte · les vingt types, à seuils configurables
-- -----------------------------------------------------------------------------

create or replace function app.seed_alert_rules(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_count integer;
begin
  insert into public.alert_rules (tenant_id, alert_type, severity, threshold)
  values
    (p_tenant, 'financement_proche_echeance',          'surveillance', '{"days": 7}'),
    (p_tenant, 'avance_sans_achat',                    'surveillance', '{"days": 3}'),
    (p_tenant, 'avance_non_couverte',                  'critique',     '{"days": 15, "amount": 0}'),
    (p_tenant, 'argent_chez_pisteur_trop_longtemps',   'critique',     '{"days": 7, "amount": 0}'),
    (p_tenant, 'aucune_livraison_depuis_x_jours',      'surveillance', '{"days": 5}'),
    (p_tenant, 'livraison_prevue_48h',                 'info',         '{"hours": 48}'),
    (p_tenant, 'livraison_prevue_demain',              'info',         '{"days": 1}'),
    (p_tenant, 'livraison_en_retard',                  'critique',     '{"days": 1}'),
    (p_tenant, 'stock_insuffisant',                    'critique',     '{"ratio": 1}'),
    (p_tenant, 'double_reservation',                   'blocage',      '{"kg": 0}'),
    (p_tenant, 'camion_sans_document',                 'critique',     '{"hours": 6}'),
    (p_tenant, 'transfert_transit_trop_long',          'critique',     '{"hours": 48}'),
    (p_tenant, 'reception_non_renseignee',             'surveillance', '{"hours": 24}'),
    (p_tenant, 'ecart_superieur_tolerance',            'critique',     '{"pct": 0}'),
    (p_tenant, 'tare_anormale',                        'surveillance', '{"kg": 100}'),
    (p_tenant, 'depense_sans_justificatif',            'surveillance', '{"amount": 50000}'),
    (p_tenant, 'depense_doublon_probable',             'surveillance', '{"score": 70}'),
    (p_tenant, 'tcb_superieur_prix_net',               'critique',     '{"margin": 0}'),
    (p_tenant, 'marge_inferieure_seuil',               'surveillance', '{"marginPerKg": 10}'),
    (p_tenant, 'abonnement_proche_echeance',           'surveillance', '{"days": 7}')
  on conflict (tenant_id, alert_type) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.seed_alert_rules(uuid) is
  'Installe les vingt règles avec leurs seuils par défaut. Les seuils sont ensuite modifiables par '
  'tenant : un seuil imposé par l''éditeur serait un jugement sur un métier qu''il ne pratique pas.';

create or replace function app.alert_threshold(
  p_tenant uuid, p_type alert_type, p_key text, p_default numeric
)
returns numeric
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce((threshold->>p_key)::numeric, p_default)
  from public.alert_rules
  where tenant_id = p_tenant and alert_type = p_type and is_active
  limit 1;
$$;

/*
 * Ouvre les alertes détectées sur un tenant.
 *
 * L'index unique partiel `alerts_dedupe_uidx` garantit qu'une même condition
 * n'ouvre qu'une alerte à la fois : rejouer l'évaluation toutes les heures ne
 * doit pas produire cent lignes identiques, sinon plus personne ne les lit.
 *
 * Les messages décrivent un fait mesuré et son seuil. Aucun ne désigne de
 * responsable : le logiciel n'a pas les moyens d'établir une intention.
 */
create or replace function app.raise_alert(
  p_tenant     uuid,
  p_type       alert_type,
  p_message    text,
  p_measured   numeric,
  p_threshold  numeric,
  p_table      text default null,
  p_id         uuid default null,
  p_agent      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_rule  public.alert_rules;
  v_id    uuid;
begin
  select * into v_rule from public.alert_rules
  where tenant_id = p_tenant and alert_type = p_type and is_active;

  if not found then
    return null;  -- Règle absente ou désactivée : silence assumé.
  end if;

  insert into public.alerts
    (tenant_id, alert_type, severity, title, message, field_agent_id,
     related_table, related_id, measured_value, threshold_value, dedupe_key)
  values
    (p_tenant, p_type, v_rule.severity, p_type::text, p_message, p_agent,
     p_table, p_id, p_measured, p_threshold,
     p_type::text || ':' || coalesce(p_id::text, 'global'))
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function app.evaluate_alerts(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_opened integer := 0;
  r        record;
begin
  if not app.can_read_tenant(p_tenant) then
    raise exception 'Lecture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  -- 1 · Financements proches de l'échéance -----------------------------------
  for r in
    select f.id, f.reference, (f.coverage_deadline - current_date) as days
    from public.fundings f
    where f.tenant_id = p_tenant
      and f.coverage_deadline is not null
      and f.status not in ('cloture', 'rembourse', 'annule')
      and f.coverage_deadline - current_date
          <= app.alert_threshold(p_tenant, 'financement_proche_echeance', 'days', 7)
  loop
    if app.raise_alert(p_tenant, 'financement_proche_echeance',
         format('Financement %s à échéance dans %s jour(s).', r.reference, r.days),
         r.days, app.alert_threshold(p_tenant, 'financement_proche_echeance', 'days', 7),
         'fundings', r.id) is not null then v_opened := v_opened + 1; end if;
  end loop;

  -- 2 et 3 · Avances sans achat, avances non couvertes ------------------------
  for r in
    select a.id, a.reference, a.field_agent_id, fa.full_name,
           (current_date - a.disbursed_at::date) as age,
           greatest(0, a.amount - app.advance_covered(a.id)) as outstanding,
           (select count(*) from public.purchases p
             where p.advance_id = a.id and p.status <> 'annule') as purchases
    from public.advances a
    join public.field_agents fa on fa.id = a.field_agent_id
    where a.tenant_id = p_tenant
      and a.disbursed_at is not null
      and a.status in ('decaisse', 'partiellement_couvert')
  loop
    if r.purchases = 0
       and r.age >= app.alert_threshold(p_tenant, 'avance_sans_achat', 'days', 3) then
      if app.raise_alert(p_tenant, 'avance_sans_achat',
           format('Avance %s (%s) décaissée depuis %s jour(s) sans achat enregistré.',
                  r.reference, r.full_name, r.age),
           r.age, app.alert_threshold(p_tenant, 'avance_sans_achat', 'days', 3),
           'advances', r.id, r.field_agent_id) is not null then v_opened := v_opened + 1; end if;
    end if;

    if r.outstanding > app.alert_threshold(p_tenant, 'avance_non_couverte', 'amount', 0)
       and r.age >= app.alert_threshold(p_tenant, 'avance_non_couverte', 'days', 15) then
      if app.raise_alert(p_tenant, 'avance_non_couverte',
           format('Avance %s (%s) : reliquat non couvert depuis %s jour(s).',
                  r.reference, r.full_name, r.age),
           r.age, app.alert_threshold(p_tenant, 'avance_non_couverte', 'days', 15),
           'advances', r.id, r.field_agent_id) is not null then v_opened := v_opened + 1; end if;
    end if;
  end loop;

  -- 4 et 5 · Exposition et inactivité des pisteurs ---------------------------
  for r in
    select fa.id, fa.full_name,
           coalesce(sum(greatest(0, a.amount - app.advance_covered(a.id))), 0) as exposure,
           min(a.disbursed_at)::date as oldest,
           (select max(p.purchased_at)::date from public.purchases p
             where p.field_agent_id = fa.id and p.status <> 'annule') as last_delivery
    from public.field_agents fa
    left join public.advances a
      on a.field_agent_id = fa.id
     and a.status in ('decaisse', 'partiellement_couvert')
    where fa.tenant_id = p_tenant and fa.status = 'actif'
    group by fa.id, fa.full_name
  loop
    if r.oldest is not null
       and r.exposure > app.alert_threshold(p_tenant, 'argent_chez_pisteur_trop_longtemps', 'amount', 0)
       and (current_date - r.oldest)
           >= app.alert_threshold(p_tenant, 'argent_chez_pisteur_trop_longtemps', 'days', 7) then
      -- Constat, pas accusation : l'argent peut être immobilisé par un marché
      -- fermé, une route coupée ou un acheteur absent.
      if app.raise_alert(p_tenant, 'argent_chez_pisteur_trop_longtemps',
           format('%s détient une exposition de %s FCFA depuis %s jour(s).',
                  r.full_name, round(r.exposure), current_date - r.oldest),
           current_date - r.oldest,
           app.alert_threshold(p_tenant, 'argent_chez_pisteur_trop_longtemps', 'days', 7),
           'field_agents', r.id, r.id) is not null then v_opened := v_opened + 1; end if;
    end if;

    if r.last_delivery is not null
       and (current_date - r.last_delivery)
           >= app.alert_threshold(p_tenant, 'aucune_livraison_depuis_x_jours', 'days', 5) then
      if app.raise_alert(p_tenant, 'aucune_livraison_depuis_x_jours',
           format('%s n''a livré aucune marchandise depuis %s jour(s).',
                  r.full_name, current_date - r.last_delivery),
           current_date - r.last_delivery,
           app.alert_threshold(p_tenant, 'aucune_livraison_depuis_x_jours', 'days', 5),
           'field_agents', r.id, r.id) is not null then v_opened := v_opened + 1; end if;
    end if;
  end loop;

  -- 6, 7 et 8 · Planning ------------------------------------------------------
  for r in
    select dp.id, dp.reference, dp.planned_date, (dp.planned_date - current_date) as remaining
    from public.delivery_plans dp
    where dp.tenant_id = p_tenant
      and dp.status not in ('receptionne', 'cloture', 'annule', 'reporte')
  loop
    if r.remaining < 0
       and abs(r.remaining) >= app.alert_threshold(p_tenant, 'livraison_en_retard', 'days', 1) then
      if app.raise_alert(p_tenant, 'livraison_en_retard',
           format('Livraison %s en retard de %s jour(s).', r.reference, abs(r.remaining)),
           abs(r.remaining), app.alert_threshold(p_tenant, 'livraison_en_retard', 'days', 1),
           'delivery_plans', r.id) is not null then v_opened := v_opened + 1; end if;
    else
      if r.remaining = app.alert_threshold(p_tenant, 'livraison_prevue_demain', 'days', 1) then
        if app.raise_alert(p_tenant, 'livraison_prevue_demain',
             format('Livraison %s prévue demain.', r.reference),
             r.remaining, 1, 'delivery_plans', r.id) is not null then v_opened := v_opened + 1; end if;
      end if;

      if r.remaining >= 0
         and r.remaining * 24 <= app.alert_threshold(p_tenant, 'livraison_prevue_48h', 'hours', 48) then
        if app.raise_alert(p_tenant, 'livraison_prevue_48h',
             format('Livraison %s prévue dans %s h.', r.reference, r.remaining * 24),
             r.remaining * 24, app.alert_threshold(p_tenant, 'livraison_prevue_48h', 'hours', 48),
             'delivery_plans', r.id) is not null then v_opened := v_opened + 1; end if;
      end if;
    end if;
  end loop;

  -- 9 · Stock insuffisant -----------------------------------------------------
  for r in
    select c.id, c.reference, c.target_volume_kg as committed,
           coalesce((select sum(sl.quantity_kg) from public.stock_lots sl
                     where sl.tenant_id = p_tenant
                       and sl.contract_id = c.id
                       and sl.status = 'disponible'), 0) as available
    from public.contracts c
    where c.tenant_id = p_tenant and c.status = 'actif' and c.target_volume_kg > 0
  loop
    if r.available / r.committed < app.alert_threshold(p_tenant, 'stock_insuffisant', 'ratio', 1) then
      if app.raise_alert(p_tenant, 'stock_insuffisant',
           format('Contrat %s : %s kg disponibles pour %s kg engagés.',
                  r.reference, round(r.available), round(r.committed)),
           round(r.available / r.committed, 4),
           app.alert_threshold(p_tenant, 'stock_insuffisant', 'ratio', 1),
           'contracts', r.id) is not null then v_opened := v_opened + 1; end if;
    end if;
  end loop;

  -- 10 · Double réservation ---------------------------------------------------
  for r in
    select sl.id, sl.code, sl.quantity_kg,
           coalesce((select sum(sr.quantity_kg) from public.stock_reservations sr
                     where sr.stock_lot_id = sl.id and sr.status = 'active'), 0) as reserved
    from public.stock_lots sl
    where sl.tenant_id = p_tenant
  loop
    if r.reserved - r.quantity_kg > app.alert_threshold(p_tenant, 'double_reservation', 'kg', 0) then
      if app.raise_alert(p_tenant, 'double_reservation',
           format('Lot %s : %s kg réservés pour %s kg disponibles.',
                  r.code, round(r.reserved), round(r.quantity_kg)),
           r.reserved - r.quantity_kg,
           app.alert_threshold(p_tenant, 'double_reservation', 'kg', 0),
           'stock_lots', r.id) is not null then v_opened := v_opened + 1; end if;
    end if;
  end loop;

  -- 11 à 15 · Transferts ------------------------------------------------------
  for r in
    select t.id, t.transfer_number, t.status, t.dispatched_at, t.arrived_at,
           t.weighing_ticket_path, t.net_unloaded_kg, t.ecart_physique_pct,
           t.tare_variation_kg,
           extract(epoch from (now() - t.dispatched_at)) / 3600 as hours_since_dispatch,
           extract(epoch from (now() - t.arrived_at)) / 3600 as hours_since_arrival
    from public.transfers t
    where t.tenant_id = p_tenant and t.status <> 'annule'
  loop
    if r.dispatched_at is not null and r.weighing_ticket_path is null
       and r.hours_since_dispatch
           >= app.alert_threshold(p_tenant, 'camion_sans_document', 'hours', 6) then
      if app.raise_alert(p_tenant, 'camion_sans_document',
           format('Transfert %s parti depuis %s h sans ticket de pesée.',
                  r.transfer_number, floor(r.hours_since_dispatch)),
           floor(r.hours_since_dispatch),
           app.alert_threshold(p_tenant, 'camion_sans_document', 'hours', 6),
           'transfers', r.id) is not null then v_opened := v_opened + 1; end if;
    end if;

    if r.status = 'en_transit' and r.dispatched_at is not null
       and r.hours_since_dispatch
           >= app.alert_threshold(p_tenant, 'transfert_transit_trop_long', 'hours', 48) then
      if app.raise_alert(p_tenant, 'transfert_transit_trop_long',
           format('Transfert %s en transit depuis %s h.',
                  r.transfer_number, floor(r.hours_since_dispatch)),
           floor(r.hours_since_dispatch),
           app.alert_threshold(p_tenant, 'transfert_transit_trop_long', 'hours', 48),
           'transfers', r.id) is not null then v_opened := v_opened + 1; end if;
    end if;

    if r.arrived_at is not null and r.net_unloaded_kg is null
       and r.hours_since_arrival
           >= app.alert_threshold(p_tenant, 'reception_non_renseignee', 'hours', 24) then
      if app.raise_alert(p_tenant, 'reception_non_renseignee',
           format('Transfert %s arrivé depuis %s h sans réception saisie.',
                  r.transfer_number, floor(r.hours_since_arrival)),
           floor(r.hours_since_arrival),
           app.alert_threshold(p_tenant, 'reception_non_renseignee', 'hours', 24),
           'transfers', r.id) is not null then v_opened := v_opened + 1; end if;
    end if;

    if r.ecart_physique_pct is not null then
      declare
        v_tolerance numeric := (app.resolve_weight_tolerance(r.id)->>'value')::numeric;
      begin
        if abs(r.ecart_physique_pct)
           > v_tolerance + app.alert_threshold(p_tenant, 'ecart_superieur_tolerance', 'pct', 0) then
          -- La cause reste ouverte : humidité, pont-bascule, route ou saisie.
          if app.raise_alert(p_tenant, 'ecart_superieur_tolerance',
               format('Transfert %s : écart physique de %s %% pour une tolérance de %s %%. Cause à qualifier.',
                      r.transfer_number, trim_scale(r.ecart_physique_pct), trim_scale(v_tolerance)),
               abs(r.ecart_physique_pct), v_tolerance,
               'transfers', r.id) is not null then v_opened := v_opened + 1; end if;
        end if;
      end;
    end if;

    if r.tare_variation_kg is not null
       and abs(r.tare_variation_kg) > app.alert_threshold(p_tenant, 'tare_anormale', 'kg', 100) then
      if app.raise_alert(p_tenant, 'tare_anormale',
           format('Transfert %s : tare variant de %s kg entre départ et arrivée.',
                  r.transfer_number, trim_scale(r.tare_variation_kg)),
           abs(r.tare_variation_kg), app.alert_threshold(p_tenant, 'tare_anormale', 'kg', 100),
           'transfers', r.id) is not null then v_opened := v_opened + 1; end if;
    end if;
  end loop;

  -- 16 · Dépense sans justificatif -------------------------------------------
  for r in
    select e.id, e.amount, coalesce(e.reference, e.beneficiary) as label
    from public.expenses e
    where e.tenant_id = p_tenant
      and e.status not in ('brouillon', 'rejetee', 'annulee')
      and e.proof_path is null
      and e.amount > app.alert_threshold(p_tenant, 'depense_sans_justificatif', 'amount', 50000)
  loop
    if app.raise_alert(p_tenant, 'depense_sans_justificatif',
         format('Dépense %s de %s FCFA sans justificatif joint.', r.label, round(r.amount)),
         r.amount, app.alert_threshold(p_tenant, 'depense_sans_justificatif', 'amount', 50000),
         'expenses', r.id) is not null then v_opened := v_opened + 1; end if;
  end loop;

  -- 17 · Doublon probable de dépense -----------------------------------------
  for r in
    select edf.id, edf.similarity_score
    from public.expense_duplicate_flags edf
    where edf.tenant_id = p_tenant
      and edf.status = 'a_verifier'
      and edf.similarity_score
          >= app.alert_threshold(p_tenant, 'depense_doublon_probable', 'score', 70)
  loop
    if app.raise_alert(p_tenant, 'depense_doublon_probable',
         format('Deux dépenses présentent une similarité de %s/100. À vérifier avant paiement.',
                trim_scale(r.similarity_score)),
         r.similarity_score,
         app.alert_threshold(p_tenant, 'depense_doublon_probable', 'score', 70),
         'expense_duplicate_flags', r.id) is not null then v_opened := v_opened + 1; end if;
  end loop;

  -- 18 et 19 · TCB et marges --------------------------------------------------
  for r in
    select distinct on (ts.scope_type, ts.scope_id)
           ts.id, ts.scope_id, ts.tcb_per_accepted_kg, ts.net_sale_price, ts.margin_per_kg
    from public.tcb_snapshots ts
    where ts.tenant_id = p_tenant and not ts.is_forecast
    order by ts.scope_type, ts.scope_id, ts.computed_at desc
  loop
    if r.tcb_per_accepted_kg is not null and r.net_sale_price is not null
       and r.tcb_per_accepted_kg
           > r.net_sale_price - app.alert_threshold(p_tenant, 'tcb_superieur_prix_net', 'margin', 0) then
      if app.raise_alert(p_tenant, 'tcb_superieur_prix_net',
           format('Coût de revient de %s FCFA/kg pour un prix net de %s FCFA/kg.',
                  trim_scale(r.tcb_per_accepted_kg), trim_scale(r.net_sale_price)),
           r.tcb_per_accepted_kg, r.net_sale_price,
           'tcb_snapshots', r.id) is not null then v_opened := v_opened + 1; end if;
    end if;

    if r.margin_per_kg is not null
       and r.margin_per_kg < app.alert_threshold(p_tenant, 'marge_inferieure_seuil', 'marginPerKg', 10) then
      if app.raise_alert(p_tenant, 'marge_inferieure_seuil',
           format('Marge de %s FCFA/kg, sous le seuil configuré.', trim_scale(r.margin_per_kg)),
           r.margin_per_kg,
           app.alert_threshold(p_tenant, 'marge_inferieure_seuil', 'marginPerKg', 10),
           'tcb_snapshots', r.id) is not null then v_opened := v_opened + 1; end if;
    end if;
  end loop;

  -- 20 · Abonnement proche de l'échéance -------------------------------------
  for r in
    select s.id, sp.name, (s.period_end - current_date) as remaining
    from public.subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
    where s.tenant_id = p_tenant
      and s.status not in ('cancelled', 'expired')
      and s.period_end - current_date
          <= app.alert_threshold(p_tenant, 'abonnement_proche_echeance', 'days', 7)
  loop
    if app.raise_alert(p_tenant, 'abonnement_proche_echeance',
         format('Abonnement %s expire dans %s jour(s).', r.name, r.remaining),
         r.remaining, app.alert_threshold(p_tenant, 'abonnement_proche_echeance', 'days', 7),
         'subscriptions', r.id) is not null then v_opened := v_opened + 1; end if;
  end loop;

  return v_opened;
end;
$$;

create or replace function public.evaluate_alerts(p_tenant uuid)
returns integer
language sql
set search_path = pg_catalog, app, public
as $$ select app.evaluate_alerts(p_tenant); $$;

grant execute on function public.evaluate_alerts(uuid) to authenticated;

create or replace function public.seed_alert_rules(p_tenant uuid)
returns integer
language sql
set search_path = pg_catalog, app, public
as $$ select app.seed_alert_rules(p_tenant); $$;

grant execute on function public.seed_alert_rules(uuid) to authenticated;
