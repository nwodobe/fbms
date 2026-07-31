-- =============================================================================
-- LBA Control · 2600 · Notifications engendrées par les alertes
-- =============================================================================
-- Les alertes existent depuis la phase 5, mais personne n'était prévenu : il
-- fallait ouvrir l'écran des alertes pour les découvrir. Une alerte
-- « livraison prévue demain » lue le surlendemain n'a servi à rien.
--
-- Trois décisions structurent ce fichier.
--
--  1. **L'audience est celle de la lecture.** Une notification part à qui a
--     déjà le droit de lire l'alerte. Inventer un second modèle d'audience à
--     côté de RLS ferait diverger les deux : un jour, quelqu'un serait prévenu
--     d'une chose qu'il ne peut pas ouvrir, ou l'inverse.
--
--  2. **Une notification par personne et par alerte, jamais deux.** La règle
--     vit dans un index unique, pas dans une condition d'appel : c'est la seule
--     forme qui résiste à deux exécutions simultanées.
--
--  3. **Lue ≠ résolue.** `read_at` range l'écran ; il ne touche pas au statut de
--     l'alerte. Les confondre ferait disparaître un problème d'un simple coup
--     d'œil, ce qui est exactement ce que le §17 interdit de faire au scoring et
--     que la même prudence impose ici.
--
-- ⚠ Comme la 2400 et la 2500, ce fichier crée des fonctions et se termine donc
-- par une révocation explicite.
-- =============================================================================

-- Une seule notification par destinataire et par alerte. La contrainte est
-- posée en base parce qu'une vérification « select puis insert » laisserait
-- deux exécutions concurrentes en créer deux.
create unique index if not exists notifications_alert_user_uidx
  on notifications (tenant_id, alert_id, user_id)
  where alert_id is not null;

comment on index notifications_alert_user_uidx is
  'Une alerte ne prévient chaque personne qu''une fois. Rejouer l''évaluation ne remplit pas la '
  'boîte de doublons.';

/*
 * Destinataires d'une alerte.
 *
 * Reprend la règle de lecture appliquée par RLS, et rien d'autre :
 *
 *  · une alerte qui ne nomme aucun pisteur ne va pas aux pisteurs ;
 *  · une alerte qui en nomme un lui parvient, à lui seul parmi les pisteurs ;
 *  · l'auditeur est un observateur : il lit quand il le décide, le prévenir de
 *    tout ne ferait que du bruit sans lui donner de moyen d'agir.
 */
create or replace function app.alert_recipients(p_alert_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, app, public
as $$
  select u.id
    from public.alerts a
    join public.users u on u.tenant_id = a.tenant_id
   where a.id = p_alert_id
     and u.status = 'active'
     and u.role <> 'auditeur'
     and (
       u.role <> 'pisteur'
       or exists (
         select 1 from public.field_agents fa
          where fa.user_id = u.id
            and fa.id = a.field_agent_id)
     );
$$;

comment on function app.alert_recipients(uuid) is
  'Destinataires d''une alerte : exactement ceux qui ont déjà le droit de la lire. Inventer une '
  'seconde audience à côté de RLS ferait diverger les deux.';

/*
 * Engendre les notifications manquantes pour les alertes ouvertes d'un client.
 *
 * Renvoie le nombre de notifications réellement créées — pas le nombre
 * d'alertes parcourues. Compter les alertes ferait croire à un envoi là où
 * l'index unique a tout écarté.
 */
create or replace function app.notify_from_alerts(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_created integer := 0;
  v_rows    integer;
begin
  if not app.can_read_tenant(p_tenant) then
    raise exception 'Lecture non autorisée sur ce tenant.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.notifications (tenant_id, user_id, channel, title, body, alert_id)
  select a.tenant_id, r.user_id, 'in_app', a.title, a.message, a.id
    from public.alerts a
    cross join lateral app.alert_recipients(a.id) as r(user_id)
   where a.tenant_id = p_tenant
     and a.status = 'ouverte'
  -- Le conflit est le cas NORMAL, pas l'exception : l'évaluation tourne deux
  -- fois par jour sur des alertes qui restent ouvertes plusieurs jours.
  on conflict do nothing;

  get diagnostics v_rows = row_count;
  v_created := v_rows;

  return v_created;
end;
$$;

comment on function app.notify_from_alerts(uuid) is
  'Crée les notifications manquantes pour les alertes ouvertes. Renvoie le nombre RÉELLEMENT créé : '
  'compter les alertes parcourues ferait croire à un envoi là où l''index unique a tout écarté.';

create or replace function public.notify_from_alerts(p_tenant uuid)
returns integer
language sql
set search_path = pg_catalog, app, public
as $$ select app.notify_from_alerts(p_tenant); $$;

-- -----------------------------------------------------------------------------
-- Lecture
-- -----------------------------------------------------------------------------

/*
 * Marque des notifications comme lues.
 *
 * Sans argument, toutes celles de l'utilisateur. `read_at` n'est jamais
 * réécrit : une notification déjà lue conserve la date de sa première lecture,
 * qui est la seule information utile pour savoir quand quelqu'un a su.
 */
create or replace function app.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_rows integer;
begin
  update public.notifications
     set read_at = now()
   where tenant_id = app.current_tenant_id()
     and user_id = app.current_user_id()
     and read_at is null
     and (p_ids is null or id = any(p_ids));

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language sql
set search_path = pg_catalog, app, public
as $$ select app.mark_notifications_read(p_ids); $$;

comment on function app.mark_notifications_read(uuid[]) is
  'Marque comme lu. NE TOUCHE PAS au statut de l''alerte : ranger son écran n''est pas régler la '
  'situation, et confondre les deux ferait disparaître un problème d''un coup d''œil.';

-- -----------------------------------------------------------------------------
-- Raccordement à la tâche planifiée
-- -----------------------------------------------------------------------------
-- L'évaluation des alertes et l'envoi des notifications forment une seule
-- opération utile : évaluer sans prévenir laisse le produit exactement où il
-- était avant cette migration.

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
  v_details  jsonb := '[]'::jsonb;
  v_seen     integer := 0;
  v_changes  integer := 0;
begin
  insert into public.scheduled_task_runs (task) values ('alert_evaluation')
  returning * into v_run;

  for r in select t.id from public.tenants t where t.status = 'active' loop
    v_seen := v_seen + 1;
    begin
      -- Un abonnement suspendu continue d'être surveillé : ses alertes
      -- l'attendront à la réactivation plutôt que de manquer.
      perform set_config('request.jwt.claims',
        jsonb_build_object('app_metadata',
          jsonb_build_object('tenant_id', r.id, 'role', 'proprietaire'))::text, true);

      v_opened   := app.evaluate_alerts(r.id);
      -- Prévenir fait partie de l'évaluation : les séparer laisserait des
      -- alertes ouvertes que personne ne verrait jamais.
      v_notified := app.notify_from_alerts(r.id);

      if v_opened > 0 or v_notified > 0 then
        v_changes := v_changes + v_opened + v_notified;
        v_details := v_details || jsonb_build_object(
          'tenant_id', r.id, 'opened', v_opened, 'notified', v_notified);
      end if;
    exception when others then
      v_details := v_details || jsonb_build_object('tenant_id', r.id, 'error', sqlerrm);
    end;
  end loop;

  -- Le contexte emprunté est rendu : le laisser en place ferait passer la suite
  -- de la session pour le dernier client parcouru.
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
-- Fermeture de la surface d'exécution
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app    to authenticated, service_role;
