-- =============================================================================
-- LBA Control · 2700 · Messages sortants (WhatsApp, SMS, courriel)
-- =============================================================================
-- La phase 9 a donné aux alertes un destinataire dans l'application. Il leur
-- manquait un destinataire dans le monde réel : un pisteur qui n'ouvre pas
-- l'application de la journée n'était prévenu de rien.
--
-- Trois décisions structurent ce fichier.
--
--  1. **Une file, pas un appel direct.** Aucun trigger n'appelle un fournisseur
--     de SMS. Une requête HTTP dans une transaction la bloque le temps du
--     réseau, et un `rollback` après un envoi réussi produit un message parti
--     pour une opération qui n'existe pas. La base dépose une ligne ; un
--     processus séparé la prend et l'envoie.
--
--  2. **Le consentement est une donnée, pas un défaut.** Un canal n'est utilisé
--     que si la personne l'a explicitement accepté. Un numéro présent dans la
--     fiche n'est pas un accord pour l'utiliser.
--
--  3. **L'unicité est en base.** Une même alerte ne peut engendrer qu'un seul
--     message par personne et par canal. Vérifier avant d'insérer laisserait
--     deux exécutions concurrentes en créer deux — et un SMS en double se paie
--     deux fois.
--
-- ⚠ Comme les migrations 2400 à 2600, ce fichier crée des fonctions et se
-- termine donc par une révocation explicite.
-- =============================================================================

create type message_channel_out as enum ('sms', 'whatsapp', 'email');
create type message_status as enum ('queued', 'sending', 'sent', 'failed', 'cancelled');

-- -----------------------------------------------------------------------------
-- Consentement
-- -----------------------------------------------------------------------------
-- Table séparée plutôt que colonnes sur `users` : un consentement se donne, se
-- retire, et la date des deux compte. Un booléen écrasé ne dit pas quand.

create table user_message_channels (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  channel      message_channel_out not null,
  -- Coordonnée figée au moment du consentement : accepter de recevoir des SMS
  -- sur un numéro n'est pas accepter d'en recevoir sur le suivant.
  destination  text not null,
  consented_at timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (tenant_id, user_id, channel)
);

create index user_message_channels_active_idx
  on user_message_channels (tenant_id, user_id) where revoked_at is null;

comment on table user_message_channels is
  'Consentement explicite par canal. Un numéro présent dans la fiche d''un utilisateur n''est pas '
  'un accord pour lui écrire.';

alter table user_message_channels enable row level security;

create policy user_message_channels_select on user_message_channels for select to authenticated
  using (app.can_read_tenant(tenant_id)
         and (user_id = app.current_user_id() or app.can_manage_settings()));

-- Chacun règle ses propres canaux ; un administrateur règle ceux de son équipe.
-- Un abonnement suspendu ne bloque pas ce réglage : il touche à la façon d'être
-- prévenu, pas aux données métier.
create policy user_message_channels_insert on user_message_channels for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and (user_id = app.current_user_id() or app.can_manage_settings()));
create policy user_message_channels_update on user_message_channels for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and (user_id = app.current_user_id() or app.can_manage_settings()))
  with check (tenant_id = app.current_tenant_id());
-- Un consentement se révoque par `revoked_at`, il ne s'efface pas : la trace de
-- ce qui a été accepté, et quand, est ce qui protège l'entreprise.
create policy user_message_channels_delete on user_message_channels for delete to authenticated
  using (false);

grant select, insert, update, delete on user_message_channels to authenticated;

-- -----------------------------------------------------------------------------
-- File d'envoi
-- -----------------------------------------------------------------------------

create table message_outbox (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  user_id        uuid references users(id) on delete set null,
  alert_id       uuid references alerts(id) on delete set null,
  channel        message_channel_out not null,
  destination    text not null,
  subject        text,
  body           text not null,
  status         message_status not null default 'queued',
  -- Un envoi différé pour heures calmes attend ici plutôt que de partir la nuit
  -- ou d'être perdu.
  not_before     timestamptz not null default now(),
  attempts       integer not null default 0 check (attempts >= 0),
  last_error     text,
  last_attempt_at timestamptz,
  sent_at        timestamptz,
  -- Identifiant rendu par le fournisseur : sans lui, impossible de rapprocher
  -- une facture d'opérateur des messages réellement demandés.
  provider       text,
  provider_ref   text,
  segments       integer check (segments > 0),
  created_at     timestamptz not null default now()
);

create index message_outbox_pending_idx
  on message_outbox (status, not_before) where status in ('queued', 'failed');
create index message_outbox_tenant_idx on message_outbox (tenant_id, created_at desc);

-- Une alerte ne prévient chaque personne qu'une fois par canal. La contrainte
-- est en base : vérifier avant d'insérer laisserait deux exécutions
-- concurrentes en créer deux, et un SMS en double se paie deux fois.
create unique index message_outbox_alert_user_channel_uidx
  on message_outbox (tenant_id, alert_id, user_id, channel)
  where alert_id is not null;

comment on table message_outbox is
  'File des messages sortants. Aucun trigger n''appelle un fournisseur : une requête HTTP dans une '
  'transaction la bloque, et un rollback après envoi produit un message parti pour une opération '
  'qui n''existe pas.';

alter table message_outbox enable row level security;

-- Un administrateur voit ce qui est parti de chez lui ; chacun voit ce qui lui
-- était destiné. Le corps du message reprend celui de l'alerte, donc le même
-- cloisonnement s'applique.
create policy message_outbox_select on message_outbox for select to authenticated
  using (app.can_read_tenant(tenant_id)
         and (user_id = app.current_user_id() or app.can_manage_settings()));

-- Personne n'écrit ici depuis un navigateur : la file est alimentée par les
-- fonctions `security definer` ci-dessous et vidée par le processus d'envoi.
create policy message_outbox_insert on message_outbox for insert to authenticated
  with check (false);
create policy message_outbox_update on message_outbox for update to authenticated
  using (false);
create policy message_outbox_delete on message_outbox for delete to authenticated
  using (false);

grant select, insert, update, delete on message_outbox to authenticated;

-- -----------------------------------------------------------------------------
-- Mise en file
-- -----------------------------------------------------------------------------

/*
 * Heure d'Abidjan.
 *
 * La Côte d'Ivoire est à UTC+0 toute l'année, sans heure d'été. C'est écrit ici
 * plutôt que supposé : le jour où un client s'installe ailleurs, la question se
 * posera à cet endroit précis et non dans quinze conditions dispersées.
 */
create or replace function app.abidjan_hour(p_at timestamptz default now())
returns integer
language sql
immutable
set search_path = pg_catalog
as $$ select extract(hour from (p_at at time zone 'Africa/Abidjan'))::integer; $$;

/*
 * Prochaine sortie des heures calmes, en instant absolu.
 *
 * Isolé dans sa propre fonction parce que l'expression est piégeuse : `at time
 * zone` lie plus fort que `+`, si bien que
 * `date_trunc(…) + interval '6 hours' at time zone 'Africa/Abidjan'` se lit
 * « intervalle converti en fuseau » et échoue. Écrite une fois, parenthésée une
 * fois, testée une fois.
 */
create or replace function app.next_quiet_hours_end(p_at timestamptz default now())
returns timestamptz
language sql
stable
set search_path = pg_catalog
as $$
  select case
    when extract(hour from (p_at at time zone 'Africa/Abidjan')) < 6
      then (date_trunc('day', p_at at time zone 'Africa/Abidjan') + interval '6 hours')
             at time zone 'Africa/Abidjan'
    else (date_trunc('day', p_at at time zone 'Africa/Abidjan') + interval '1 day 6 hours')
           at time zone 'Africa/Abidjan'
  end;
$$;

/*
 * Canaux applicables à une gravité. Miroir exact de `src/domain/messaging.ts`.
 *
 * Le doublon est assumé et vérifié par test : le client décide ce qu'il montre,
 * le serveur décide ce qui part. Un formulaire contourné ne doit pas pouvoir
 * déclencher un SMS que la règle n'autorise pas.
 */
create or replace function app.channels_for_severity(p_severity alert_severity)
returns message_channel_out[]
language sql
immutable
-- `public` doit figurer dans le chemin : les deux énumérations y vivent, et un
-- chemin limité à `pg_catalog` les rend introuvables au moment du cast.
set search_path = pg_catalog, public
as $$
  select case p_severity
    when 'blocage'  then array['whatsapp', 'sms']::message_channel_out[]
    when 'critique' then array['whatsapp']::message_channel_out[]
    else array[]::message_channel_out[]
  end;
$$;

/*
 * Dépose dans la file les messages dus aux alertes ouvertes d'un client.
 *
 * Renvoie le nombre réellement mis en file — pas le nombre d'alertes vues.
 * Compter les alertes ferait croire à un envoi là où l'index unique a tout
 * écarté, et masquerait un consentement absent.
 */
create or replace function app.enqueue_alert_messages(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_queued integer;
  v_name   text;
begin
  if not app.can_read_tenant(p_tenant) then
    raise exception 'Lecture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(tb.commercial_name, t.commercial_name, 'LBA Control')
    into v_name
    from public.tenants t
    left join public.tenant_branding tb on tb.tenant_id = t.id
   where t.id = p_tenant;

  insert into public.message_outbox
    (tenant_id, user_id, alert_id, channel, destination, subject, body, not_before)
  select
    a.tenant_id,
    c.user_id,
    a.id,
    c.channel,
    c.destination,
    -- Le sujet ne sert qu'au courriel ; SMS et WhatsApp l'ignorent.
    case when c.channel = 'email' then v_name || ' · ' || a.title else null end,
    v_name || ' · ' || a.title || '. ' || a.message,
    -- Heures calmes : différé au matin plutôt qu'envoyé la nuit ou perdu. Un
    -- blocage passe outre — c'est le seul cas où réveiller quelqu'un se
    -- justifie.
    case
      when a.severity = 'blocage' then now()
      when app.abidjan_hour() >= 21 or app.abidjan_hour() < 6
        then app.next_quiet_hours_end()
      else now()
    end
  from public.alerts a
  join lateral app.alert_recipients(a.id) as r(user_id) on true
  join public.user_message_channels c
    on c.tenant_id = a.tenant_id
   and c.user_id = r.user_id
   and c.revoked_at is null
   and c.channel = any(app.channels_for_severity(a.severity))
  where a.tenant_id = p_tenant
    and a.status = 'ouverte'
  -- Le conflit est le cas NORMAL : l'évaluation tourne deux fois par jour sur
  -- des alertes qui restent ouvertes plusieurs jours.
  on conflict do nothing;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

comment on function app.enqueue_alert_messages(uuid) is
  'Dépose les messages dus aux alertes ouvertes. Renvoie le nombre RÉELLEMENT mis en file : compter '
  'les alertes masquerait un consentement absent.';

-- -----------------------------------------------------------------------------
-- Consommation par le processus d'envoi
-- -----------------------------------------------------------------------------

/*
 * Réserve un lot de messages à envoyer.
 *
 * `for update skip locked` : deux exécutions simultanées du processus d'envoi
 * ne se disputent pas les mêmes lignes et n'envoient donc pas deux fois. C'est
 * la seule forme qui reste correcte si la fonction planifiée se déclenche
 * pendant qu'une exécution précédente traîne.
 */
create or replace function app.claim_messages(p_limit integer default 50)
returns setof message_outbox
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé au processus d''envoi de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  update public.message_outbox
     set status = 'sending', last_attempt_at = now()
   where id in (
     select o.id from public.message_outbox o
      where o.status in ('queued', 'failed')
        and o.not_before <= now()
        and o.attempts < 5
      order by o.not_before
      limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update skip locked
   )
  returning *;
end;
$$;

/*
 * Consigne le sort d'un message.
 *
 * Un échec définitif — numéro invalide, destinataire désabonné — ne repart pas :
 * insister coûte de l'argent sans rien changer. Le message reste en base,
 * consultable, jamais supprimé.
 */
create or replace function app.record_message_result(
  p_id           uuid,
  p_sent         boolean,
  p_provider     text default null,
  p_provider_ref text default null,
  p_segments     integer default null,
  p_error        text default null,
  p_retryable    boolean default true
)
returns message_outbox
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_row public.message_outbox;
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé au processus d''envoi de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.message_outbox
     -- Le cast n'est pas décoratif : un `case` de littéraux produit du `text`,
     -- que PostgreSQL refuse d'assigner à une énumération. Sans lui, la
     -- fonction échoue à l'exécution, pas à la création.
     set status       = (case when p_sent then 'sent'
                              when p_retryable then 'failed'
                              else 'cancelled' end)::message_status,
         sent_at      = case when p_sent then now() else sent_at end,
         provider     = coalesce(p_provider, provider),
         provider_ref = coalesce(p_provider_ref, provider_ref),
         segments     = coalesce(p_segments, segments),
         last_error   = case when p_sent then null else p_error end,
         attempts     = attempts + 1,
         -- Report exponentiel plafonné à une heure, miroir de `sendBackoffMs`.
         not_before   = case
           when p_sent or not p_retryable then not_before
           else now() + least(interval '1 hour',
                              (power(2, attempts) * interval '30 seconds'))
         end
   where id = p_id
   returning * into v_row;

  if not found then
    raise exception 'Message introuvable.' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Raccordement à la tâche planifiée
-- -----------------------------------------------------------------------------
-- Évaluer, notifier, mettre en file : une seule opération utile. Les séparer
-- laisserait des alertes que personne ne voit et des messages que personne
-- n'envoie.

create or replace function app.run_alert_evaluation()
returns scheduled_task_runs
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_run      public.scheduled_task_runs;
  r          record;
  v_opened   integer;
  v_notified integer;
  v_queued   integer;
  v_errors   jsonb;
  v_details  jsonb := '[]'::jsonb;
  v_seen     integer := 0;
  v_changes  integer := 0;
begin
  insert into public.scheduled_task_runs (task) values ('alert_evaluation')
  returning * into v_run;

  for r in select t.id from public.tenants t where t.status = 'active' loop
    v_seen := v_seen + 1;
    v_opened := 0; v_notified := 0; v_queued := 0;
    v_errors := '[]'::jsonb;

    perform set_config('request.jwt.claims',
      jsonb_build_object('app_metadata',
        jsonb_build_object('tenant_id', r.id, 'role', 'proprietaire'))::text, true);

    -- Trois blocs SÉPARÉS, et c'est tout l'intérêt. En plpgsql, une exception
    -- annule le bloc entier : les trois étapes réunies faisaient qu'un échec de
    -- la mise en file effaçait les alertes ouvertes et les notifications créées
    -- juste avant. Prévenir tout le monde puis tout défaire est pire que ne
    -- rien faire — le journal disait « exécuté » et rien ne subsistait.
    begin
      v_opened := app.evaluate_alerts(r.id);
    exception when others then
      v_errors := v_errors || jsonb_build_object('etape', 'evaluation', 'error', sqlerrm);
    end;

    begin
      v_notified := app.notify_from_alerts(r.id);
    exception when others then
      v_errors := v_errors || jsonb_build_object('etape', 'notification', 'error', sqlerrm);
    end;

    begin
      v_queued := app.enqueue_alert_messages(r.id);
    exception when others then
      v_errors := v_errors || jsonb_build_object('etape', 'mise_en_file', 'error', sqlerrm);
    end;

    if v_opened > 0 or v_notified > 0 or v_queued > 0 or jsonb_array_length(v_errors) > 0 then
      v_changes := v_changes + v_opened + v_notified + v_queued;
      v_details := v_details || jsonb_build_object(
        'tenant_id', r.id, 'opened', v_opened, 'notified', v_notified, 'queued', v_queued)
        || case when jsonb_array_length(v_errors) > 0
                then jsonb_build_object('error', v_errors -> 0 ->> 'error', 'echecs', v_errors)
                else '{}'::jsonb end;
    end if;
  end loop;

  perform set_config('request.jwt.claims', '', true);

  update public.scheduled_task_runs
     set finished_at = now(), status = 'succeeded',
         tenants_seen = v_seen, changes = v_changes, details = v_details
   where id = v_run.id
   returning * into v_run;

  return v_run;
end;
$$;

-- -----------------------------------------------------------------------------
-- Relais publics
-- -----------------------------------------------------------------------------

create or replace function public.set_message_channel(
  p_channel message_channel_out, p_destination text, p_user_id uuid default null
)
returns user_message_channels
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_row    public.user_message_channels;
  v_target uuid := coalesce(p_user_id, app.current_user_id());
begin
  if v_target <> app.current_user_id() and not app.can_manage_settings() then
    raise exception 'Vous ne pouvez régler que vos propres canaux.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_destination, ''))) = 0 then
    raise exception 'Une coordonnée est nécessaire pour ce canal.' using errcode = 'check_violation';
  end if;

  insert into public.user_message_channels (tenant_id, user_id, channel, destination)
  values (app.current_tenant_id(), v_target, p_channel, btrim(p_destination))
  on conflict (tenant_id, user_id, channel) do update
    -- Une nouvelle coordonnée est un nouveau consentement : accepter de recevoir
    -- des SMS sur un numéro n'est pas les accepter sur le suivant.
    set destination  = excluded.destination,
        consented_at = now(),
        revoked_at   = null
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.revoke_message_channel(
  p_channel message_channel_out, p_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_rows   integer;
  v_target uuid := coalesce(p_user_id, app.current_user_id());
begin
  if v_target <> app.current_user_id() and not app.can_manage_settings() then
    raise exception 'Vous ne pouvez régler que vos propres canaux.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.user_message_channels
     set revoked_at = now()
   where tenant_id = app.current_tenant_id()
     and user_id = v_target
     and channel = p_channel
     and revoked_at is null;

  get diagnostics v_rows = row_count;

  -- Les messages déjà en file pour ce canal sont annulés : un désabonnement qui
  -- laisse partir les envois de la veille n'est pas un désabonnement.
  update public.message_outbox
     set status = 'cancelled', last_error = 'Consentement retiré avant l''envoi.'
   where tenant_id = app.current_tenant_id()
     and user_id = v_target
     and channel = p_channel
     and status in ('queued', 'failed');

  return v_rows;
end;
$$;

create or replace function public.claim_messages(p_limit integer default 50)
returns setof message_outbox
language sql
set search_path = pg_catalog, app, public
as $$ select * from app.claim_messages(p_limit); $$;

create or replace function public.record_message_result(
  p_id uuid, p_sent boolean, p_provider text default null, p_provider_ref text default null,
  p_segments integer default null, p_error text default null, p_retryable boolean default true
)
returns message_outbox
language sql
set search_path = pg_catalog, app, public
as $$ select app.record_message_result(p_id, p_sent, p_provider, p_provider_ref,
                                       p_segments, p_error, p_retryable); $$;

-- -----------------------------------------------------------------------------
-- Fermeture de la surface d'exécution
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app    to authenticated, service_role;
