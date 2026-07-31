-- =============================================================================
-- LBA Control · 1800 · Cycle d'abonnement, clôture de campagne, conservation
-- =============================================================================
-- Ce fichier contient les seules règles du produit capables de couper l'accès
-- d'un client payant, et celles qui figent une campagne. Trois principes :
--
--   · le blocage est graduel, annoncé et réversible ;
--   · aucune phase du cycle ne supprime la moindre donnée ;
--   · une déclaration de paiement par le client ne change AUCUN statut.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Déclaration de paiement par le client
-- -----------------------------------------------------------------------------

/*
 * Enregistre une déclaration et rien d'autre.
 *
 * La fonction existe pour que la règle soit exécutable et non seulement écrite :
 * le statut de l'abonnement n'est pas touché, la période n'est pas prolongée,
 * et la ligne créée porte le statut `declared`. Seule
 * `app.confirm_subscription_payment` — réservée au super-administrateur —
 * réactive quoi que ce soit.
 */
create or replace function app.declare_subscription_payment(
  p_amount     numeric,
  p_method     payment_method,
  p_reference  text,
  p_invoice_id uuid default null,
  p_payer      text default null,
  p_proof_path text default null
)
returns subscription_payments
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_tenant       uuid := app.current_tenant_id();
  v_subscription public.subscriptions;
  v_payment      public.subscription_payments;
begin
  if v_tenant is null then
    raise exception 'Entreprise non résolue.' using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception
      'Une déclaration de paiement exige une référence : sans elle, le paiement est invérifiable.'
      using errcode = 'check_violation';
  end if;

  select * into v_subscription from public.subscriptions
  where tenant_id = v_tenant and status not in ('cancelled', 'expired')
  order by period_end desc limit 1;

  if not found then
    raise exception 'Aucun abonnement en cours pour cette entreprise.' using errcode = 'no_data_found';
  end if;

  insert into public.subscription_payments
    (tenant_id, subscription_id, invoice_id, amount, method, reference, payer,
     declared_by, proof_path, status)
  values
    (v_tenant, v_subscription.id, p_invoice_id, p_amount, p_method, btrim(p_reference), p_payer,
     app.current_user_id(), p_proof_path, 'declared')
  returning * into v_payment;

  insert into public.subscription_events
    (tenant_id, subscription_id, event_type, old_status, new_status, payment_id,
     actor_user_id, reason)
  values
    (v_tenant, v_subscription.id, 'payment_declared',
     -- Ancien et nouveau statut sont volontairement identiques : c'est la
     -- preuve, dans la trace elle-même, que la déclaration n'a rien changé.
     v_subscription.status, v_subscription.status, v_payment.id,
     app.current_user_id(), 'Déclaration client enregistrée, en attente de vérification.');

  return v_payment;
end;
$$;

create or replace function public.declare_subscription_payment(
  p_amount numeric, p_method payment_method, p_reference text,
  p_invoice_id uuid default null, p_payer text default null, p_proof_path text default null
)
returns subscription_payments
language sql
set search_path = pg_catalog, app, public
as $$
  select app.declare_subscription_payment(
    p_amount, p_method, p_reference, p_invoice_id, p_payer, p_proof_path);
$$;

grant execute on function public.declare_subscription_payment(
  numeric, payment_method, text, uuid, text, text) to authenticated;

comment on function app.declare_subscription_payment(numeric, payment_method, text, uuid, text, text) is
  'Enregistre une déclaration client. Ne modifie NI le statut NI la période : une capture d''écran '
  'ne réactive pas un abonnement (CMD §20).';

/*
 * Verrou complémentaire : personne ne doit pouvoir faire passer un paiement à
 * `confirmed` par une simple mise à jour de ligne. La confirmation est un
 * chemin de code unique, pas un champ modifiable.
 */
create or replace function app.enforce_payment_status_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
begin
  if new.status in ('confirmed', 'partial') and coalesce(old.status, 'declared') <> new.status then
    if not app.is_platform_admin() then
      raise exception
        'Seul un super-administrateur peut confirmer un paiement, et uniquement par la fonction '
        'de vérification. Une déclaration ne se confirme pas elle-même.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger subscription_payments_status_authority
  before insert or update on public.subscription_payments
  for each row execute function app.enforce_payment_status_authority();

-- -----------------------------------------------------------------------------
-- Cycle : rappels et bascules de statut
-- -----------------------------------------------------------------------------

/*
 * Phase attendue d'un abonnement, calculée à partir des seules dates.
 *
 * Reproduit `src/domain/subscription.ts` : échéance → grâce → lecture seule →
 * blocage. Les deux implémentations sont vérifiées l'une contre l'autre par les
 * tests de base, parce qu'un serveur et une interface en désaccord sur le jour
 * du blocage produiraient une réclamation client impossible à trancher.
 */
create or replace function app.subscription_phase(p_subscription_id uuid, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  s           public.subscriptions;
  v_today     date := coalesce(p_today, current_date);
  v_overdue   integer;
  v_grace     integer;
  v_block     integer;
begin
  select * into s from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'Abonnement introuvable.' using errcode = 'no_data_found';
  end if;

  v_grace   := s.grace_days;
  v_block   := s.readonly_after_days;
  v_overdue := greatest(0, v_today - s.period_end);

  if s.status in ('cancelled', 'expired') then
    return jsonb_build_object(
      'phase', 'resilie', 'expected_status', s.status::text,
      'access_level', 'read_only', 'days_overdue', v_overdue, 'data_retained', true);
  end if;

  if v_today <= s.period_end then
    return jsonb_build_object(
      'phase', case when s.status = 'trial' then 'essai' else 'actif' end,
      'expected_status', case when s.status = 'trial' then 'trial' else 'active' end,
      'access_level', 'full',
      'days_to_expiry', s.period_end - v_today,
      'days_overdue', 0, 'data_retained', true);
  end if;

  if v_overdue <= v_grace then
    return jsonb_build_object(
      'phase', 'echu_en_grace', 'expected_status', 'grace_period',
      'access_level', 'full', 'days_overdue', v_overdue, 'data_retained', true);
  end if;

  if v_overdue <= v_block then
    return jsonb_build_object(
      'phase', 'lecture_seule', 'expected_status', 'suspended_read_only',
      'access_level', 'read_only', 'days_overdue', v_overdue, 'data_retained', true);
  end if;

  return jsonb_build_object(
    'phase', 'bloque', 'expected_status', 'suspended',
    'access_level', 'blocked', 'days_overdue', v_overdue, 'data_retained', true);
end;
$$;

create or replace function public.subscription_phase(p_subscription_id uuid, p_today date default null)
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.subscription_phase(p_subscription_id, p_today); $$;

grant execute on function public.subscription_phase(uuid, date) to authenticated;

/*
 * Fait avancer un abonnement : émet les rappels dus et applique la bascule de
 * statut si les dates l'exigent.
 *
 * Idempotente à double titre : chaque rappel porte une clé unique rattachée à
 * l'échéance, et une bascule vers un statut déjà atteint n'émet aucun
 * événement. Rejouer la fonction toutes les heures ne produit donc ni doublon
 * de courriel ni bruit dans le journal.
 *
 * Aucune suppression n'est faite, à aucune phase (CMD §20 : « données
 * conservées »).
 */
create or replace function app.advance_subscription_lifecycle(
  p_subscription_id uuid,
  p_today           date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  s          public.subscriptions;
  v_today    date := coalesce(p_today, current_date);
  v_phase    jsonb;
  v_expected public.subscriptions.status%type;
  v_days     integer;
  v_kind     text;
  v_offset   integer;
  v_key      text;
  v_reminders text[] := array[]::text[];
  v_changed  boolean := false;
begin
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if not found then
    raise exception 'Abonnement introuvable.' using errcode = 'no_data_found';
  end if;

  if not app.is_platform_admin() and not app.can_read_tenant(s.tenant_id) then
    raise exception 'Accès refusé à cet abonnement.' using errcode = 'insufficient_privilege';
  end if;

  -- Rappels ------------------------------------------------------------------
  v_days := s.period_end - v_today;

  if v_days >= 0 and s.status not in ('cancelled', 'expired') then
    foreach v_kind in array array['reminder_j7', 'reminder_j3', 'reminder_j0'] loop
      v_offset := case v_kind
        when 'reminder_j7' then 7
        when 'reminder_j3' then 3
        else 0
      end;

      continue when v_days > v_offset;

      -- La clé porte l'échéance, pas le jour d'envoi : un renouvellement crée
      -- une nouvelle échéance, donc une nouvelle série de rappels.
      v_key := v_kind || ':' || s.id::text || ':' || s.period_end::text;

      begin
        insert into public.subscription_events
          (tenant_id, subscription_id, event_type, old_status, new_status,
           idempotency_key, payload, reason)
        values
          (s.tenant_id, s.id, v_kind::subscription_event_type, s.status, s.status, v_key,
           jsonb_build_object('days_to_expiry', v_days, 'period_end', s.period_end),
           format('Rappel automatique : échéance dans %s jour(s).', v_days));

        v_reminders := v_reminders || v_kind;
      exception when unique_violation then
        -- Rappel déjà émis pour cette échéance : rien à faire, et surtout pas
        -- un second courriel.
        null;
      end;
    end loop;
  end if;

  -- Bascule de statut --------------------------------------------------------
  v_phase := app.subscription_phase(p_subscription_id, v_today);
  v_expected := (v_phase->>'expected_status')::subscription_status;

  -- Un abonnement `pending_payment` ou `overdue` encore dans sa période n'est
  -- pas ramené de force à `active` : seule une confirmation de paiement le fait.
  if v_expected = 'active' and s.status in ('pending_payment', 'overdue') then
    v_expected := s.status;
  end if;

  if v_expected <> s.status then
    update public.subscriptions
       set status            = v_expected,
           grace_started_at  = case when v_expected = 'grace_period'
                                    then coalesce(s.grace_started_at, now()) else s.grace_started_at end,
           read_only_at      = case when v_expected = 'suspended_read_only'
                                    then coalesce(s.read_only_at, now()) else s.read_only_at end,
           blocked_at        = case when v_expected = 'suspended'
                                    then coalesce(s.blocked_at, now()) else s.blocked_at end,
           suspension_reason = case
             when v_expected in ('suspended', 'suspended_read_only')
             then format('Échéance dépassée de %s jour(s). Données conservées.',
                         v_phase->>'days_overdue')
             else s.suspension_reason end,
           updated_at = now()
     where id = s.id;

    insert into public.subscription_events
      (tenant_id, subscription_id, event_type, old_status, new_status, payload, reason)
    values
      (s.tenant_id, s.id, 'status_change', s.status, v_expected, v_phase,
       'Bascule automatique du cycle. Aucune donnée supprimée.');

    v_changed := true;
  end if;

  return jsonb_build_object(
    'subscription_id', s.id,
    'phase', v_phase,
    'reminders_sent', to_jsonb(v_reminders),
    'status_changed', v_changed,
    'new_status', v_expected);
end;
$$;

create or replace function public.advance_subscription_lifecycle(
  p_subscription_id uuid, p_today date default null
)
returns jsonb
language sql
set search_path = pg_catalog, app, public
as $$ select app.advance_subscription_lifecycle(p_subscription_id, p_today); $$;

grant execute on function public.advance_subscription_lifecycle(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Clôture et réouverture de campagne · arbitrage D10
-- -----------------------------------------------------------------------------

/*
 * Ce qui empêche de clôturer une campagne.
 *
 * Renvoie les obstacles plutôt qu'un simple booléen : « clôture impossible »
 * sans dire pourquoi oblige l'utilisateur à deviner, et le pousse à chercher un
 * contournement.
 */
create or replace function app.campaign_closure_blockers(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  c          public.campaigns;
  v_blockers jsonb := '[]'::jsonb;
  v_count    integer;
  v_amount   numeric;
begin
  select * into c from public.campaigns where id = p_campaign_id;
  if not found then
    raise exception 'Campagne introuvable.' using errcode = 'no_data_found';
  end if;

  select count(*) into v_count
  from public.incidents
  where tenant_id = c.tenant_id and campaign_id = p_campaign_id
    and status in ('ouvert', 'en_enquete', 'reouvert');

  if v_count > 0 then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'incidents_ouverts', 'count', v_count,
      'message', format('%s incident(s) sans décision. Clôturer effacerait la question sans y répondre.', v_count));
  end if;

  select count(*), coalesce(sum(greatest(0, a.amount - app.advance_covered(a.id))), 0)
    into v_count, v_amount
  from public.advances a
  where a.tenant_id = c.tenant_id and a.campaign_id = p_campaign_id
    and a.status in ('decaisse', 'partiellement_couvert')
    and a.amount > app.advance_covered(a.id);

  if v_count > 0 then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'avances_non_couvertes', 'count', v_count, 'amount', v_amount,
      'message', format('%s avance(s) non couverte(s), soit %s FCFA encore chez les pisteurs.',
                        v_count, round(v_amount)));
  end if;

  select count(*) into v_count
  from public.transfers t
  where t.tenant_id = c.tenant_id and t.campaign_id = p_campaign_id
    and t.status in ('charge', 'en_transit', 'arrive', 'decharge');

  if v_count > 0 then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'transferts_en_cours', 'count', v_count,
      'message', format('%s transfert(s) non réceptionné(s) ou non clôturé(s).', v_count));
  end if;

  select count(*) into v_count
  from public.expenses e
  where e.tenant_id = c.tenant_id and e.campaign_id = p_campaign_id
    and e.status in ('brouillon', 'soumise');

  if v_count > 0 then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'depenses_non_statuees', 'count', v_count,
      'message', format('%s dépense(s) en attente de validation ou de rejet.', v_count));
  end if;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'can_close', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers);
end;
$$;

create or replace function public.campaign_closure_blockers(p_campaign_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.campaign_closure_blockers(p_campaign_id); $$;

grant execute on function public.campaign_closure_blockers(uuid) to authenticated;

/*
 * Clôture une campagne.
 *
 * Bloquante par défaut (arbitrage D10) : les obstacles doivent être levés, pas
 * contournés. Une dérogation reste possible mais exige un motif d'au moins
 * vingt caractères et laisse la liste des obstacles dans le journal d'audit —
 * une clôture forcée dont on ne peut pas reconstituer l'état est pire qu'une
 * campagne restée ouverte.
 *
 * Aucune donnée n'est supprimée ni figée physiquement : la clôture est un
 * statut, l'écriture est ensuite refusée par les règles métier.
 */
create or replace function app.close_campaign(
  p_campaign_id uuid,
  p_reason      text default null,
  p_force       boolean default false
)
returns campaigns
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  c          public.campaigns;
  v_check    jsonb;
begin
  select * into c from public.campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'Campagne introuvable.' using errcode = 'no_data_found';
  end if;

  if not app.tenant_can_write(c.tenant_id) then
    raise exception 'Écriture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  if not app.has_role('proprietaire', 'gestionnaire') then
    raise exception 'Seuls le propriétaire et le gestionnaire peuvent clôturer une campagne.'
      using errcode = 'insufficient_privilege';
  end if;

  if c.status = 'cloturee' then
    return c;  -- Idempotent : reclôturer ne produit ni erreur ni second événement.
  end if;

  v_check := app.campaign_closure_blockers(p_campaign_id);

  if not (v_check->>'can_close')::boolean then
    if not p_force then
      raise exception
        'Clôture impossible : %',
        (select string_agg(b->>'message', ' ') from jsonb_array_elements(v_check->'blockers') b)
        using errcode = 'check_violation';
    end if;

    if length(btrim(coalesce(p_reason, ''))) < 20 then
      raise exception
        'Une clôture forcée exige un motif d''au moins 20 caractères décrivant ce qui reste en suspens.'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.campaigns
     set status = 'cloturee', closed_at = now(), closed_by = app.current_user_id()
   where id = p_campaign_id
   returning * into c;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (c.tenant_id, app.current_user_id(), 'status_change', 'campaigns', p_campaign_id::text,
     jsonb_build_object('status', 'cloturee', 'forced', p_force, 'blockers', v_check->'blockers'),
     coalesce(p_reason, 'Clôture normale, aucun obstacle en suspens.'));

  return c;
end;
$$;

/*
 * Rouvre une campagne clôturée.
 *
 * Autorisée mais tracée : un exercice qu'on ne peut jamais rouvrir pousse à
 * falsifier les dates de l'exercice suivant. Le motif est déjà imposé par
 * contrainte (`campaign_reopen_requires_reason`, 10 caractères).
 */
create or replace function app.reopen_campaign(p_campaign_id uuid, p_reason text)
returns campaigns
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'Campagne introuvable.' using errcode = 'no_data_found';
  end if;

  if not app.tenant_can_write(c.tenant_id) then
    raise exception 'Écriture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  if not app.has_role('proprietaire') then
    raise exception 'Seul le propriétaire peut rouvrir une campagne clôturée.'
      using errcode = 'insufficient_privilege';
  end if;

  if c.status <> 'cloturee' then
    raise exception 'Seule une campagne clôturée peut être rouverte.' using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception
      'Une réouverture exige un motif d''au moins 10 caractères : sans lui, la modification '
      'd''un exercice clos est indéfendable en audit.'
      using errcode = 'check_violation';
  end if;

  update public.campaigns
     set status = 'reouverte', reopened_at = now(),
         reopened_by = app.current_user_id(), reopen_reason = p_reason
   where id = p_campaign_id
   returning * into c;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, old_value, new_value, justification)
  values
    (c.tenant_id, app.current_user_id(), 'status_change', 'campaigns', p_campaign_id::text,
     jsonb_build_object('status', 'cloturee'), jsonb_build_object('status', 'reouverte'), p_reason);

  return c;
end;
$$;

create or replace function public.close_campaign(
  p_campaign_id uuid, p_reason text default null, p_force boolean default false
)
returns campaigns
language sql
set search_path = pg_catalog, app, public
as $$ select app.close_campaign(p_campaign_id, p_reason, p_force); $$;

create or replace function public.reopen_campaign(p_campaign_id uuid, p_reason text)
returns campaigns
language sql
set search_path = pg_catalog, app, public
as $$ select app.reopen_campaign(p_campaign_id, p_reason); $$;

grant execute on function public.close_campaign(uuid, text, boolean) to authenticated;
grant execute on function public.reopen_campaign(uuid, text) to authenticated;

/*
 * Refus d'écriture sur une campagne clôturée.
 *
 * Le statut ne suffirait pas : sans ce garde-fou, une saisie datée d'une
 * campagne close changerait des chiffres déjà communiqués à une société
 * partenaire. Une campagne `reouverte` redevient écrivable — c'est le but de la
 * réouverture, et elle est tracée.
 */
create or replace function app.enforce_closed_campaign()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_status public.campaign_status;
begin
  select status into v_status from public.campaigns where id = new.campaign_id;

  if v_status = 'cloturee' then
    raise exception
      'La campagne est clôturée. Rouvrez-la avec un motif si cette écriture est légitime : '
      'modifier un exercice clos sans trace ne l''est pas.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger purchases_closed_campaign_guard
  before insert or update on public.purchases
  for each row execute function app.enforce_closed_campaign();

create trigger expenses_closed_campaign_guard
  before insert or update on public.expenses
  for each row execute function app.enforce_closed_campaign();

create trigger advances_closed_campaign_guard
  before insert or update on public.advances
  for each row execute function app.enforce_closed_campaign();

-- -----------------------------------------------------------------------------
-- Conservation des données · arbitrage D12
-- -----------------------------------------------------------------------------

/*
 * Ce qui serait archivable, et rien de plus.
 *
 * La fonction **ne supprime rien** et ne marque rien : elle décrit. Le produit
 * n'a aucun chemin de suppression automatique, par construction — une purge
 * programmée qui se déclenche pendant un contentieux détruit précisément la
 * preuve dont on a besoin.
 */
create or replace function app.archival_candidates(p_tenant uuid, p_retention_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_cutoff date := current_date - p_retention_days;
  v_campaigns integer;
  v_transfers integer;
begin
  if not app.can_read_tenant(p_tenant) then
    raise exception 'Lecture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_campaigns
  from public.campaigns
  where tenant_id = p_tenant and status = 'cloturee' and closed_at::date <= v_cutoff;

  select count(*) into v_transfers
  from public.transfers
  where tenant_id = p_tenant and status = 'cloture' and updated_at::date <= v_cutoff;

  return jsonb_build_object(
    'cutoff_date', v_cutoff,
    'retention_days', p_retention_days,
    'closed_campaigns', v_campaigns,
    'closed_transfers', v_transfers,
    'deletion_performed', false,
    'note', 'Aucune suppression automatique n''existe dans ce produit. Cette liste est indicative : '
            'l''archivage reste une décision humaine, tracée.');
end;
$$;

create or replace function public.archival_candidates(p_tenant uuid, p_retention_days integer default 90)
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.archival_candidates(p_tenant, p_retention_days); $$;

grant execute on function public.archival_candidates(uuid, integer) to authenticated;

comment on function app.archival_candidates(uuid, integer) is
  'Décrit ce qui dépasse la durée de conservation (défaut 90 jours, arbitrage D12). Ne supprime '
  'rien : le produit n''a aucun chemin de suppression automatique.';
