-- =============================================================================
-- LBA Control · 3300 · Expiration des invitations — un marquage qui tient
-- =============================================================================
-- Défaut trouvé en vérifiant le parcours d'activation sur le projet hébergé, et
-- pas autrement : le test local affirmait « refuse une invitation expirée et la
-- marque comme telle », mais ne vérifiait que le refus. La moitié de son nom
-- était fausse depuis le premier jour.
--
-- `app.accept_invitation` faisait ceci :
--
--     update public.tenant_invitations set status = 'expired' where id = …;
--     raise exception 'Cette invitation a expiré le %…';
--
-- En PostgreSQL, `raise exception` annule la transaction en cours — donc
-- l'`update` qui le précède. Le statut restait `pending`, indéfiniment. Écrire
-- puis lever dans le même souffle n'écrit rien.
--
-- Deux corrections, et une constatation.
--
--  1. **L'écriture morte disparaît.** Elle ne faisait pas ce que son commentaire
--     annonçait, et un commentaire faux coûte plus cher qu'une ligne absente :
--     il fait tenir pour acquis quelque chose qui ne l'est pas.
--
--  2. **Un balayage marque réellement les invitations périmées**, rattaché à la
--     tâche planifiée quotidienne. Le statut cesse ainsi de mentir à qui lit la
--     table directement — un export, un audit, un décompte.
--
-- La constatation : rien n'était cassé pour l'utilisateur. L'interface dérive
-- l'expiration de `expires_at` (`invitationState` dans src/domain/tenants.ts) et
-- affichait donc « périmée » correctement, et `app.invite_user` renouvelle une
-- invitation en attente par `on conflict do update` — réinviter la même adresse
-- fonctionnait déjà. Ce qui était faux, c'est ce que la base racontait d'elle-même.
-- =============================================================================

create or replace function app.accept_invitation(p_token text)
returns users
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_uid        uuid := app.current_user_id();
  v_email      text := lower(nullif(btrim(coalesce(app.jwt_claims() ->> 'email', '')), ''));
  v_invitation public.tenant_invitations;
  v_user       public.users;
begin
  if v_uid is null then
    raise exception 'Connectez-vous avant d''accepter une invitation.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_invitation
  from public.tenant_invitations
  where token = btrim(coalesce(p_token, ''))
  for update;

  if not found or v_invitation.status <> 'pending' then
    raise exception 'Invitation introuvable, déjà utilisée ou révoquée.'
      using errcode = 'no_data_found';
  end if;

  -- Refus sec, sans écriture. Marquer ici serait sans effet : l'exception qui
  -- suit annulerait l'écriture. Le marquage est fait par
  -- `app.expire_stale_invitations`, hors du chemin de refus.
  if v_invitation.expires_at <= now() then
    raise exception
      'Cette invitation a expiré le %. Demandez-en une nouvelle.',
      to_char(v_invitation.expires_at, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  if v_email is null or lower(v_invitation.email) <> v_email then
    raise exception 'Cette invitation a été émise pour une autre adresse électronique.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.users u where u.id = v_uid) then
    raise exception
      'Ce compte est déjà rattaché à une entreprise. Une même identité ne peut pas en servir deux.'
      using errcode = 'unique_violation';
  end if;

  insert into public.users (id, tenant_id, role, full_name, email, status)
  values (v_uid, v_invitation.tenant_id, v_invitation.role, v_invitation.full_name, v_email, 'active')
  returning * into v_user;

  update public.tenant_invitations
     set status = 'accepted', accepted_at = now(), accepted_user_id = v_uid
   where id = v_invitation.id;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (v_invitation.tenant_id, v_uid, 'create', 'users', v_uid::text,
     jsonb_build_object('role', v_invitation.role, 'email', v_email),
     format('Invitation acceptée, émise le %s.', to_char(v_invitation.invited_at, 'DD/MM/YYYY')));

  return v_user;
end;
$$;

comment on function app.accept_invitation(text) is
  'Transforme une invitation en compte. Vérifie le jeton ET l''adresse authentifiée : le jeton seul '
  'suffirait à quiconque le lit dans une boîte mail transférée. Refuse une invitation périmée sans '
  'rien écrire — le marquage appartient à app.expire_stale_invitations.';

-- -----------------------------------------------------------------------------
-- Balayage des invitations périmées
-- -----------------------------------------------------------------------------
-- Réservé à la plateforme : la fonction traverse tous les clients, et c'est la
-- tâche planifiée qui l'appelle. Un client n'a rien à balayer chez les autres.

create or replace function app.expire_stale_invitations()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_count integer;
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé aux administrateurs de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.tenant_invitations
     set status = 'expired'
   where status = 'pending'
     and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.expire_stale_invitations() is
  'Marque les invitations dont le délai est écoulé. Sans elle, `status` resterait « pending » pour '
  'toujours et mentirait à qui lit la table — l''interface, elle, dérive l''expiration de expires_at.';

-- -----------------------------------------------------------------------------
-- Rattachement à la tâche quotidienne
-- -----------------------------------------------------------------------------
-- Le cycle d'abonnement tourne déjà tous les jours et parcourt les clients :
-- c'est le bon endroit. Une tâche planifiée de plus, pour une phrase de SQL,
-- serait un rouage supplémentaire à surveiller.

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
  v_expired integer := 0;
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

  -- Bloc séparé : un échec du balayage ne doit pas défaire les bascules
  -- d'abonnement déjà appliquées au-dessus.
  begin
    v_expired := app.expire_stale_invitations();
    if v_expired > 0 then
      v_changes := v_changes + v_expired;
      v_details := v_details || jsonb_build_object('invitations_expirees', v_expired);
    end if;
  exception when others then
    v_details := v_details || jsonb_build_object('etape', 'invitations', 'error', sqlerrm);
  end;

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

do $$
declare v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d
        on d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
     where n.nspname in ('app', 'public')
       and d.objid is null
       and pg_get_userbyid(p.proowner) = current_user
  loop
    execute format('revoke execute on function %s from anon', v_fn.signature);
  end loop;
end
$$;

grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app    to authenticated, service_role;

do $$
begin
  revoke execute on function app.custom_access_token(jsonb) from authenticated, anon, public;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function app.custom_access_token(jsonb) to supabase_auth_admin;
  end if;
end
$$;
