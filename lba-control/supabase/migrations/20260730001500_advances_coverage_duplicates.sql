-- =============================================================================
-- LBA Control · 1500 · Exposition, plafonds d'avance, FIFO et doublons
-- =============================================================================
-- Phase 3. Trois règles qui ne peuvent pas rester côté client :
--
--  1. Le plafond d'une avance. Un contrôle uniquement dans le formulaire serait
--     contournable par un appel direct à l'API — c'est-à-dire exactement par la
--     personne qui aurait intérêt à le contourner.
--
--  2. L'allocation FIFO. Lire les avances puis écrire les allocations depuis le
--     client laisserait deux décaissements simultanés couvrir deux fois la même
--     avance.
--
--  3. La détection de doublons. Elle doit s'appliquer aussi aux écritures
--     arrivées par synchronisation hors ligne, qui ne passent par aucun écran.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Exposition d'un pisteur
-- -----------------------------------------------------------------------------
-- Chaque état reste séparé. Aucun « solde » unique n'est renvoyé : c'est ce qui
-- évite de confondre de la matière en cours de route avec un manquant.

create or replace function app.agent_exposure(
  p_agent_id uuid,
  p_partner_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_advanced   numeric := 0;
  v_allocated  numeric := 0;
  v_repaid     numeric := 0;
  v_oldest_age integer := 0;
begin
  select coalesce(sum(a.amount), 0)
    into v_advanced
  from public.advances a
  where a.field_agent_id = p_agent_id
    and a.status in ('decaisse', 'partiellement_couvert')
    and (p_partner_id is null or a.partner_company_id = p_partner_id);

  select coalesce(sum(al.amount), 0)
    into v_allocated
  from public.advance_allocations al
  join public.advances a on a.id = al.advance_id
  where a.field_agent_id = p_agent_id
    and a.status in ('decaisse', 'partiellement_couvert')
    and (p_partner_id is null or a.partner_company_id = p_partner_id);

  select coalesce(sum(r.amount), 0)
    into v_repaid
  from public.advance_repayments r
  join public.advances a on a.id = r.advance_id
  where a.field_agent_id = p_agent_id
    and r.cancelled_at is null
    and (p_partner_id is null or a.partner_company_id = p_partner_id);

  -- L'ancienneté part de la date de l'avance, jamais de la dernière remise.
  select coalesce(max(current_date - a.issued_at::date), 0)
    into v_oldest_age
  from public.advances a
  where a.field_agent_id = p_agent_id
    and a.status in ('decaisse', 'partiellement_couvert')
    and (p_partner_id is null or a.partner_company_id = p_partner_id)
    and a.amount > coalesce(
      (select sum(al.amount) from public.advance_allocations al where al.advance_id = a.id), 0)
       + coalesce(
      (select sum(r.amount) from public.advance_repayments r
        where r.advance_id = a.id and r.cancelled_at is null), 0);

  return jsonb_build_object(
    'advanced', v_advanced,
    'covered', v_allocated + v_repaid,
    'exposure', greatest(0, v_advanced - v_allocated - v_repaid),
    'oldest_outstanding_age_days', v_oldest_age
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Contrôle de capacité avant décaissement
-- -----------------------------------------------------------------------------

create or replace function app.check_advance_capacity(
  p_agent_id   uuid,
  p_partner_id uuid,
  p_amount     numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_agent          public.field_agents;
  v_global         jsonb;
  v_partner        jsonb;
  v_partner_link   public.field_agent_partners;
  v_block_days     integer;
  v_issues         jsonb := '[]'::jsonb;
  v_hard_block     boolean := false;
begin
  select * into v_agent from public.field_agents where id = p_agent_id;
  if not found then
    raise exception 'Pisteur introuvable.' using errcode = 'no_data_found';
  end if;

  select coalesce(advance_block_uncovered_days, 7) into v_block_days
  from public.tenant_settings where tenant_id = v_agent.tenant_id;
  v_block_days := coalesce(v_block_days, 7);

  v_global  := app.agent_exposure(p_agent_id, null);
  v_partner := app.agent_exposure(p_agent_id, p_partner_id);

  select * into v_partner_link
  from public.field_agent_partners
  where field_agent_id = p_agent_id and partner_company_id = p_partner_id;

  if v_agent.status <> 'actif' then
    v_hard_block := true;
    v_issues := v_issues || jsonb_build_object(
      'reason', 'pisteur_suspendu', 'severity', 'blocage',
      'message', 'Ce pisteur n''est pas actif. Aucune nouvelle avance ne peut lui être remise.');
  end if;

  if v_partner_link.field_agent_id is null or not v_partner_link.is_active then
    v_hard_block := true;
    v_issues := v_issues || jsonb_build_object(
      'reason', 'societe_non_autorisee', 'severity', 'blocage',
      'message', 'Ce pisteur n''est pas autorisé pour cette société partenaire.');
  end if;

  if v_agent.ceiling_amount > 0
     and (v_global ->> 'exposure')::numeric + p_amount > v_agent.ceiling_amount then
    v_issues := v_issues || jsonb_build_object(
      'reason', 'plafond_global_depasse', 'severity', 'blocage',
      'measured', (v_global ->> 'exposure')::numeric + p_amount,
      'threshold', v_agent.ceiling_amount,
      'message', format(
        'Cette avance porterait l''exposition à %s FCFA, au-dessus du plafond de %s FCFA.',
        round((v_global ->> 'exposure')::numeric + p_amount), round(v_agent.ceiling_amount)));
  end if;

  if v_partner_link.ceiling_amount is not null and v_partner_link.ceiling_amount > 0
     and (v_partner ->> 'exposure')::numeric + p_amount > v_partner_link.ceiling_amount then
    v_issues := v_issues || jsonb_build_object(
      'reason', 'plafond_societe_depasse', 'severity', 'blocage',
      'measured', (v_partner ->> 'exposure')::numeric + p_amount,
      'threshold', v_partner_link.ceiling_amount,
      'message', format(
        'L''exposition sur cette société atteindrait %s FCFA, au-dessus du plafond de %s FCFA.',
        round((v_partner ->> 'exposure')::numeric + p_amount), round(v_partner_link.ceiling_amount)));
  end if;

  if (v_global ->> 'oldest_outstanding_age_days')::integer > v_block_days then
    v_issues := v_issues || jsonb_build_object(
      'reason', 'avance_ancienne_non_couverte', 'severity', 'blocage',
      'measured', (v_global ->> 'oldest_outstanding_age_days')::integer,
      'threshold', v_block_days,
      'message', format(
        'Ce pisteur détient une avance non couverte depuis %s jours (seuil : %s).',
        v_global ->> 'oldest_outstanding_age_days', v_block_days));
  end if;

  return jsonb_build_object(
    'issues', v_issues,
    'can_proceed', jsonb_array_length(v_issues) = 0,
    -- Une dérogation lève un seuil, jamais une décision de gestion déjà prise.
    'requires_override', jsonb_array_length(v_issues) > 0 and not v_hard_block,
    'has_hard_block', v_hard_block,
    'exposure', v_global
  );
end;
$$;

-- Relais publics : PostgREST n'expose que le schéma `public`. Ils n'ajoutent
-- aucun privilège, tous les contrôles restant dans les fonctions du schéma app.
create or replace function public.agent_exposure(
  p_agent_id uuid, p_partner_id uuid default null
)
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.agent_exposure(p_agent_id, p_partner_id); $$;

grant execute on function public.agent_exposure(uuid, uuid) to authenticated;

create or replace function public.check_advance_capacity(
  p_agent_id uuid, p_partner_id uuid, p_amount numeric
)
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.check_advance_capacity(p_agent_id, p_partner_id, p_amount); $$;

grant execute on function public.check_advance_capacity(uuid, uuid, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- Application du plafond au décaissement
-- -----------------------------------------------------------------------------

create or replace function app.enforce_advance_ceiling()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_check jsonb;
begin
  -- Le contrôle porte sur le décaissement : un brouillon ou une demande peuvent
  -- être préparés librement, c'est la sortie d'argent qui engage.
  if new.status not in ('approuve', 'decaisse') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status in ('approuve', 'decaisse') then
    return new;
  end if;

  v_check := app.check_advance_capacity(new.field_agent_id, new.partner_company_id, new.amount);

  if (v_check ->> 'can_proceed')::boolean then
    return new;
  end if;

  if (v_check ->> 'has_hard_block')::boolean then
    raise exception '%',
      (select string_agg(value ->> 'message', ' ')
       from jsonb_array_elements(v_check -> 'issues')
       where value ->> 'reason' in ('pisteur_suspendu', 'societe_non_autorisee'))
      using errcode = 'check_violation';
  end if;

  -- Seuil dépassé : autorisé uniquement par dérogation motivée et approuvée.
  if not new.requires_override then
    raise exception '% Une dérogation motivée et approuvée est requise.',
      (select string_agg(value ->> 'message', ' ')
       from jsonb_array_elements(v_check -> 'issues'))
      using errcode = 'check_violation';
  end if;

  if new.override_approved_by is null
     or length(btrim(coalesce(new.override_reason, ''))) < 10 then
    raise exception
      'La dérogation exige un motif explicite et l''approbation d''un responsable.'
      using errcode = 'check_violation';
  end if;

  if new.override_approved_by = coalesce(new.created_by, new.override_approved_by) then
    raise exception 'Le demandeur ne peut pas approuver sa propre dérogation.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger advances_ceiling_guard
  before insert or update on public.advances
  for each row execute function app.enforce_advance_ceiling();

-- -----------------------------------------------------------------------------
-- Allocation FIFO transactionnelle
-- -----------------------------------------------------------------------------

create or replace function app.allocate_advance_fifo(
  p_agent_id    uuid,
  p_partner_id  uuid,
  p_source_type advance_allocation_source,
  p_source_id   uuid,
  p_amount      numeric
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_left      numeric := p_amount;
  v_advance   record;
  v_covered   numeric;
  v_available numeric;
  v_apply     numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant à affecter doit être strictement positif.'
      using errcode = 'check_violation';
  end if;

  -- FIFO strict : les premières avances d'abord, verrouillées pour sérialiser
  -- deux affectations concurrentes.
  for v_advance in
    select a.*
    from public.advances a
    where a.field_agent_id = p_agent_id
      and a.status in ('decaisse', 'partiellement_couvert')
      and (p_partner_id is null or a.partner_company_id = p_partner_id)
    order by a.issued_at, a.id
    for update
  loop
    exit when v_left <= 0;

    select coalesce(sum(al.amount), 0) into v_covered
    from public.advance_allocations al where al.advance_id = v_advance.id;

    v_available := v_advance.amount - v_covered;
    continue when v_available <= 0;

    v_apply := least(v_available, v_left);

    insert into public.advance_allocations
      (tenant_id, advance_id, source_type, source_id, amount, created_by)
    values
      (v_advance.tenant_id, v_advance.id, p_source_type, p_source_id, v_apply, app.current_user_id())
    on conflict (advance_id, source_type, source_id) do update
      set amount = public.advance_allocations.amount + excluded.amount;

    v_left := v_left - v_apply;

    update public.advances
       set status = (case when v_covered + v_apply >= amount then 'cloture' else 'partiellement_couvert' end)::advance_status,
           updated_at = now()
     where id = v_advance.id;
  end loop;

  -- Le reliquat non affecté est RENVOYÉ, pas absorbé : une livraison qui
  -- dépasse les avances doit rester visible.
  return v_left;
end;
$$;

-- -----------------------------------------------------------------------------
-- Détection de doublons d'achat
-- -----------------------------------------------------------------------------
-- Mêmes pondérations que src/domain/duplicates.ts. La géolocalisation pèse 5
-- points sur 100 : elle ne peut jamais déclencher un signalement à elle seule.

create or replace function app.purchase_duplicate_score(
  a public.purchases,
  b public.purchases
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
  if a.field_agent_id = b.field_agent_id then
    v_score := v_score + 10; v_criteria := v_criteria || 'pisteur'::text;
  end if;

  if (a.supplier_id is not null and a.supplier_id = b.supplier_id)
     or (a.supplier_name is not null and lower(btrim(a.supplier_name)) = lower(btrim(b.supplier_name))) then
    v_score := v_score + 20; v_criteria := v_criteria || 'vendeur'::text;
  end if;

  if a.purchased_at::date = b.purchased_at::date then
    v_score := v_score + 15; v_criteria := v_criteria || 'date'::text;
    if abs(extract(epoch from (a.purchased_at - b.purchased_at))) <= 1800 then
      v_score := v_score + 10; v_criteria := v_criteria || 'heure_proche'::text;
    end if;
  end if;

  if abs(a.net_weight_kg - b.net_weight_kg) < 0.001 then
    v_score := v_score + 25; v_criteria := v_criteria || 'poids'::text;
  end if;

  if abs(a.amount - b.amount) < 0.01 then
    v_score := v_score + 20; v_criteria := v_criteria || 'montant'::text;
  end if;

  if a.payment_reference is not null and btrim(a.payment_reference) <> ''
     and btrim(a.payment_reference) = btrim(b.payment_reference) then
    v_score := v_score + 25; v_criteria := v_criteria || 'reference_paiement'::text;
  end if;

  if a.locality_id is not null and a.locality_id = b.locality_id then
    v_score := v_score + 5; v_criteria := v_criteria || 'localite'::text;
  end if;

  if a.gps_lat is not null and b.gps_lat is not null
     and abs(a.gps_lat - b.gps_lat) < 0.001 and abs(a.gps_lng - b.gps_lng) < 0.001 then
    v_score := v_score + 5; v_criteria := v_criteria || 'geolocalisation'::text;
  end if;

  if a.device_id is not null and a.device_id = b.device_id then
    v_score := v_score + 5; v_criteria := v_criteria || 'appareil'::text;
  end if;

  return jsonb_build_object('score', least(100, v_score), 'criteria', to_jsonb(v_criteria));
end;
$$;

create or replace function app.detect_purchase_duplicates()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_other  public.purchases;
  v_result jsonb;
begin
  for v_other in
    select p.* from public.purchases p
    where p.tenant_id = new.tenant_id
      and p.id <> new.id
      and p.status <> 'annule'
      and p.purchased_at between new.purchased_at - interval '3 days'
                             and new.purchased_at + interval '3 days'
  loop
    v_result := app.purchase_duplicate_score(new, v_other);

    if (v_result ->> 'score')::integer >= 60 then
      insert into public.purchase_duplicate_flags
        (tenant_id, purchase_id, candidate_id, similarity_score, matched_criteria)
      values
        (new.tenant_id, new.id, v_other.id, (v_result ->> 'score')::numeric,
         array(select jsonb_array_elements_text(v_result -> 'criteria')))
      on conflict (purchase_id, candidate_id) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

create trigger purchases_duplicate_detection
  after insert on public.purchases
  for each row execute function app.detect_purchase_duplicates();

comment on function app.detect_purchase_duplicates() is
  'Signale, ne bloque jamais. Un doublon probable reste une hypothèse : l''insertion réussit, '
  'et un humain tranche depuis l''écran des achats. Le déclenchement AFTER INSERT garantit que '
  'les écritures arrivées par synchronisation hors ligne sont analysées elles aussi.';
