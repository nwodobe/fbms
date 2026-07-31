-- =============================================================================
-- LBA Control · 2500 · Tâches récurrentes exécutées par le serveur
-- =============================================================================
-- Deux traitements doivent tourner tous les jours, sans qu'aucun humain ait à y
-- penser :
--
--   · `app.advance_subscription_lifecycle` — un abonnement échu passe en période
--     de grâce, puis en lecture seule. Tant que personne ne l'exécute, un client
--     qui n'a pas payé garde un accès complet, et un client qui a payé reste
--     bloqué. Le cycle décrit au §20 n'existe que si quelque chose l'avance.
--
--   · `app.evaluate_alerts` — les alertes se calculent sur des durées : une
--     avance non couverte depuis sept jours, un transfert parti sans ticket
--     depuis douze heures. Elles n'apparaissent donc pas au moment d'une saisie,
--     mais au passage du temps. Sans exécution périodique, la moitié des vingt
--     types d'alerte ne se déclencherait jamais.
--
-- Ce fichier fournit les fonctions et, si `pg_cron` est présent, la
-- planification. Les deux sont séparés : sur un projet où l'extension n'est pas
-- disponible, les fonctions restent appelables par un ordonnanceur externe.
--
-- ⚠ Cette migration crée des fonctions ; elle se termine donc, comme la 2400,
-- par une révocation explicite. PostgreSQL accorde `EXECUTE` à `PUBLIC` sur
-- toute fonction nouvellement créée, et `ALTER DEFAULT PRIVILEGES` ne retire
-- pas ce droit intégré. Toute migration ultérieure créant des fonctions devra
-- faire de même — l'audit du catalogue le vérifie.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Journal d'exécution
-- -----------------------------------------------------------------------------
-- Une tâche planifiée qui échoue en silence est pire qu'une tâche absente :
-- l'absence se remarque, l'échec silencieux se découvre trois semaines plus tard
-- en cherchant pourquoi une alerte n'est jamais partie.
--
-- Table de plateforme, sans `tenant_id` : une exécution porte sur l'ensemble des
-- clients. Seuls les administrateurs de la plateforme la lisent — le détail par
-- client, lui, reste dans le journal d'audit de chaque client.

create table scheduled_task_runs (
  id            uuid primary key default gen_random_uuid(),
  task          text not null check (task in ('subscription_lifecycle', 'alert_evaluation')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running'
                check (status in ('running', 'succeeded', 'failed')),
  tenants_seen  integer not null default 0 check (tenants_seen >= 0),
  changes       integer not null default 0 check (changes >= 0),
  -- Détail par client : ce qui a changé, et pour qui. Un agrégat seul ne permet
  -- pas de répondre à « pourquoi ce client-là n'a pas basculé ».
  details       jsonb not null default '[]'::jsonb,
  error         text
);

create index scheduled_task_runs_task_idx on scheduled_task_runs (task, started_at desc);

comment on table scheduled_task_runs is
  'Journal des exécutions planifiées. Une tâche qui échoue en silence se découvre trois semaines '
  'plus tard, en cherchant pourquoi une alerte n''est jamais partie.';

alter table scheduled_task_runs enable row level security;

-- Lecture réservée à la plateforme : ce journal parle de tous les clients à la
-- fois, et son contenu révélerait le nombre et l'activité des autres.
create policy scheduled_task_runs_select on scheduled_task_runs
  for select to authenticated using (app.is_platform_admin());

-- Personne n'écrit ici depuis un navigateur : seules les fonctions
-- `security definer` de ce fichier alimentent la table.
create policy scheduled_task_runs_insert on scheduled_task_runs
  for insert to authenticated with check (false);
create policy scheduled_task_runs_update on scheduled_task_runs
  for update to authenticated using (false);
create policy scheduled_task_runs_delete on scheduled_task_runs
  for delete to authenticated using (false);

-- Le `grant … on all tables` de la migration 1200 ne porte que sur les tables
-- existant à ce moment-là. Toute table créée ensuite doit être accordée
-- explicitement, sinon RLS n'a même pas l'occasion de s'appliquer : l'accès est
-- refusé plus tôt, avec un message qui ne dit rien du cloisonnement. Un audit du
-- catalogue vérifie qu'aucune table n'a été oubliée.
grant select, insert, update, delete on scheduled_task_runs to authenticated;

-- -----------------------------------------------------------------------------
-- Exécution
-- -----------------------------------------------------------------------------

/*
 * Avance le cycle de vie de tous les abonnements.
 *
 * L'échec d'un client n'interrompt pas les autres : une entreprise dont
 * l'abonnement est dans un état inattendu ne doit pas empêcher les cinquante
 * suivantes de basculer. Chaque échec est consigné avec son identifiant.
 */
create or replace function app.run_subscription_lifecycle(p_today date default null)
returns scheduled_task_runs
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_run     public.scheduled_task_runs;
  r         record;
  v_result  jsonb;
  v_details jsonb := '[]'::jsonb;
  v_seen    integer := 0;
  v_changes integer := 0;
begin
  insert into public.scheduled_task_runs (task) values ('subscription_lifecycle')
  returning * into v_run;

  for r in
    select s.id, s.tenant_id, s.status from public.subscriptions s
     where s.status not in ('cancelled', 'expired')
  loop
    v_seen := v_seen + 1;
    begin
      v_result := app.advance_subscription_lifecycle(r.id, p_today);

      -- Seuls les changements réels sont consignés : une ligne par client et par
      -- jour, même quand rien ne bouge, noierait ce qui compte.
      if coalesce((v_result ->> 'status_changed')::boolean, false)
         or jsonb_array_length(coalesce(v_result -> 'reminders_sent', '[]'::jsonb)) > 0 then
        v_changes := v_changes + 1;
        v_details := v_details || jsonb_build_object(
          'tenant_id', r.tenant_id,
          'subscription_id', r.id,
          'from', r.status,
          'to', v_result ->> 'new_status',
          'reminders', v_result -> 'reminders_sent');
      end if;
    exception when others then
      v_details := v_details || jsonb_build_object(
        'tenant_id', r.tenant_id, 'subscription_id', r.id, 'error', sqlerrm);
    end;
  end loop;

  update public.scheduled_task_runs
     set finished_at = now(), status = 'succeeded',
         tenants_seen = v_seen, changes = v_changes, details = v_details
   where id = v_run.id
   returning * into v_run;

  return v_run;
end;
$$;

comment on function app.run_subscription_lifecycle(date) is
  'Avance le cycle de vie de tous les abonnements. L''échec d''un client n''interrompt pas les '
  'autres : il est consigné et l''exécution continue.';

/*
 * Évalue les alertes de tous les clients actifs.
 *
 * `app.evaluate_alerts` contrôle la lecture du tenant appelé ; exécutée par
 * l'ordonnanceur, il n'y a pas de tenant courant. On se place donc explicitement
 * sur chaque client, ce qui a l'avantage de laisser les mêmes règles
 * s'appliquer — et non un chemin d'exécution privilégié qui divergerait.
 */
create or replace function app.run_alert_evaluation()
returns scheduled_task_runs
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_run     public.scheduled_task_runs;
  r         record;
  v_opened  integer;
  v_details jsonb := '[]'::jsonb;
  v_seen    integer := 0;
  v_changes integer := 0;
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

      v_opened := app.evaluate_alerts(r.id);

      if v_opened > 0 then
        v_changes := v_changes + v_opened;
        v_details := v_details || jsonb_build_object('tenant_id', r.id, 'opened', v_opened);
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

comment on function app.run_alert_evaluation() is
  'Évalue les alertes de tous les clients actifs, en se plaçant sur chacun : les mêmes règles '
  's''appliquent qu''à un appel ordinaire, sans chemin privilégié qui divergerait.';

-- -----------------------------------------------------------------------------
-- Consultation depuis la console plateforme
-- -----------------------------------------------------------------------------

create or replace function app.scheduled_task_history(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_rows jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé aux administrateurs de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row order by started_at desc), '[]'::jsonb) into v_rows
  from (
    select id, task, started_at, finished_at, status, tenants_seen, changes,
           -- Le détail complet peut être volumineux ; le nombre d'anomalies
           -- suffit à savoir s'il faut aller le lire.
           jsonb_array_length(details) as detail_count,
           (select count(*) from jsonb_array_elements(details) d
             where d ? 'error') as error_count,
           error
      from public.scheduled_task_runs
     order by started_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 200))
  ) as row;

  return v_rows;
end;
$$;

create or replace function public.scheduled_task_history(p_limit integer default 20)
returns jsonb
language sql
stable
set search_path = pg_catalog, app, public
as $$ select app.scheduled_task_history(p_limit); $$;

-- -----------------------------------------------------------------------------
-- Planification
-- -----------------------------------------------------------------------------
-- Garde identique à celle des buckets : la base locale de test n'a pas
-- `pg_cron`, et cette migration doit s'y appliquer sans bruit. Le déclenchement
-- réel est donc conditionnel, et documenté dans le README pour les projets où
-- l'extension n'est pas disponible.

do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'Extension pg_cron absente : planifiez app.run_subscription_lifecycle() et app.run_alert_evaluation() par un ordonnanceur externe (voir README).';
    return;
  end if;

  -- Heures creuses en Côte d'Ivoire (UTC+0) : la bascule d'un abonnement ne doit
  -- pas surprendre un utilisateur en pleine saisie.
  perform cron.unschedule(jobname)
    from cron.job where jobname in ('lba-subscription-lifecycle', 'lba-alert-evaluation');

  perform cron.schedule('lba-subscription-lifecycle', '10 2 * * *',
    $job$ select app.run_subscription_lifecycle(); $job$);

  -- Les alertes tournent deux fois par jour : une avance qui devient trop
  -- ancienne à midi ne doit pas attendre le lendemain matin pour être signalée.
  perform cron.schedule('lba-alert-evaluation', '30 4,13 * * *',
    $job$ select app.run_alert_evaluation(); $job$);

  raise notice 'Tâches planifiées installées : cycle d''abonnement (02h10), alertes (04h30 et 13h30).';
end
$$;

-- -----------------------------------------------------------------------------
-- Fermeture de la surface d'exécution
-- -----------------------------------------------------------------------------
-- Répétition volontaire de la migration 2400. Sans elle, les fonctions créées
-- ci-dessus seraient exécutables par `PUBLIC` — donc par `anon`, donc par
-- n'importe qui muni de la clé publiable.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app    to authenticated, service_role;
