-- =============================================================================
-- LBA Control · 3200 · Jeton d'accès et acceptation d'invitation
-- =============================================================================
-- Depuis la phase 1, tout le cloisonnement repose sur deux valeurs lues dans le
-- jeton : `app_metadata.tenant_id` et `app_metadata.role`. Le README demandait
-- de les écrire « à la main » au moment de créer un compte. C'était le dernier
-- geste manuel du produit, et le plus dangereux :
--
--  · une valeur recopiée peut être recopiée de travers, et un `tenant_id` erroné
--    ouvre l'entreprise d'un autre ;
--  · elle ne se met jamais à jour. `app.set_user_role` change `users.role` et
--    écrit dans le journal, mais le jeton continuait de porter l'ancien rôle.
--    Une rétrogradation n'aurait pris effet nulle part ;
--  · elle fait exister deux sources de vérité pour la même information, sans
--    rien pour les rapprocher.
--
-- La bonne place est un *auth hook* : une fonction que Supabase Auth appelle à
-- chaque émission de jeton. `public.users` redevient la seule source, et le
-- jeton n'en est qu'une projection — recalculée à chaque connexion et à chaque
-- rafraîchissement.
--
-- Ce fichier ajoute aussi ce qui manquait pour qu'une invitation serve à quelque
-- chose : de quoi la transformer en compte réel.
--
-- ⚠ Le hook doit être ACTIVÉ dans le tableau de bord Supabase
-- (Authentication → Hooks → Customize Access Token, pointer sur
-- `app.custom_access_token`). Tant qu'il ne l'est pas, aucun jeton ne porte de
-- tenant et l'application ne montre rien — ce qui est le bon échec : elle ne
-- montre pas les données d'un autre.
--
-- ⚠ Ce fichier crée des fonctions : révocation explicite à la fin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Le jeton, projection de public.users
-- -----------------------------------------------------------------------------

create or replace function app.custom_access_token(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_uid   uuid := nullif(event ->> 'user_id', '')::uuid;
  v_user  public.users;
  v_admin boolean;
  v_meta  jsonb := coalesce(event -> 'claims' -> 'app_metadata', '{}'::jsonb);
begin
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = v_uid and pa.is_active
  ) into v_admin;

  -- L'administrateur de plateforme n'appartient à aucune entreprise : son jeton
  -- ne porte aucun tenant. C'est ce qui l'oblige à passer par une session
  -- d'assistance motivée pour voir les données d'un client (CMD §4).
  if v_admin then
    return jsonb_set(event, '{claims,app_metadata}',
      v_meta || jsonb_build_object('role', 'super_admin', 'tenant_id', null));
  end if;

  select * into v_user from public.users where id = v_uid;

  -- Compte suspendu : le jeton ne porte plus ni tenant ni rôle. La suspension
  -- devient effective au prochain rafraîchissement plutôt qu'à la seule
  -- prochaine ouverture de session.
  --
  -- Compte inconnu : c'est le cas normal juste après l'inscription, avant
  -- l'acceptation de l'invitation. On n'invente rien — un jeton sans tenant ne
  -- donne accès à rien, ce qui est exactement ce qu'il faut.
  if v_user.id is null or v_user.status <> 'active' then
    return jsonb_set(event, '{claims,app_metadata}', v_meta - 'role' - 'tenant_id');
  end if;

  return jsonb_set(event, '{claims,app_metadata}',
    v_meta || jsonb_build_object('role', v_user.role::text, 'tenant_id', v_user.tenant_id));
end;
$$;

comment on function app.custom_access_token(jsonb) is
  'Auth hook : projette public.users dans app_metadata à chaque émission de jeton. La table reste la '
  'seule source de vérité — un rôle changé prend effet au rafraîchissement, sans recopie manuelle.';

-- `supabase_auth_admin` est le rôle qui exécute les hooks. Il n'existe pas sur
-- la base de test locale : la garde rend ce bloc inoffensif dans les deux
-- environnements, comme pour les buckets et pg_cron.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    raise notice 'Rôle supabase_auth_admin absent (base locale) : droits du hook non appliqués.';
    return;
  end if;

  grant usage on schema app to supabase_auth_admin;
  grant execute on function app.custom_access_token(jsonb) to supabase_auth_admin;

  -- Personne d'autre n'appelle ce hook. Laissé ouvert, il permettrait à un
  -- utilisateur de se fabriquer une réponse de jeton et d'en tirer des
  -- conclusions sur les comptes des autres.
  revoke execute on function app.custom_access_token(jsonb) from authenticated, anon, public;
end
$$;

-- -----------------------------------------------------------------------------
-- Une invitation devient un compte
-- -----------------------------------------------------------------------------
-- La migration 2900 créait des invitations que rien ne pouvait accepter. Le
-- propriétaire invité recevait un jeton et n'avait aucun moyen de s'en servir.
--
-- Deux vérifications, et pas une seule : le jeton ET l'adresse. Le jeton seul
-- suffirait à quiconque le lit dans une boîte mail transférée ; exiger que
-- l'adresse authentifiée soit celle de l'invitation lie le compte créé à la
-- personne réellement invitée.

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

  if v_invitation.expires_at <= now() then
    -- Marquée plutôt que laissée en attente : une invitation périmée qui reste
    -- « pending » bloque toute réinvitation de la même adresse.
    update public.tenant_invitations set status = 'expired' where id = v_invitation.id;
    raise exception
      'Cette invitation a expiré le %. Demandez-en une nouvelle.',
      to_char(v_invitation.expires_at, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  if v_email is null or lower(v_invitation.email) <> v_email then
    raise exception
      'Cette invitation a été émise pour une autre adresse électronique.'
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
  'suffirait à quiconque le lit dans une boîte mail transférée. Le jeton d''accès ne portera le '
  'tenant qu''au rafraîchissement suivant — l''interface doit rafraîchir la session.';

-- Lecture de l'invitation avant acceptation : l'écran doit pouvoir annoncer
-- « Vous êtes invité chez X en tant que Y » sans exiger d'être déjà rattaché.
-- Ne renvoie aucune donnée métier, et rien du tout si le jeton ne correspond pas.
create or replace function app.invitation_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_invitation public.tenant_invitations;
  v_name       text;
begin
  select * into v_invitation
  from public.tenant_invitations
  where token = btrim(coalesce(p_token, ''));

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(tb.commercial_name, t.commercial_name) into v_name
  from public.tenants t
  left join public.tenant_branding tb on tb.tenant_id = t.id
  where t.id = v_invitation.tenant_id;

  return jsonb_build_object(
    'found', true,
    'commercial_name', v_name,
    'role', v_invitation.role::text,
    'full_name', v_invitation.full_name,
    -- L'adresse n'est pas renvoyée en clair : un jeton deviné livrerait une
    -- adresse électronique valide. L'appelant sait déjà la sienne.
    'email_matches', lower(v_invitation.email)
                     = lower(coalesce(app.jwt_claims() ->> 'email', '')),
    'status', v_invitation.status::text,
    'expired', v_invitation.expires_at <= now());
end;
$$;

-- -----------------------------------------------------------------------------
-- Relais publics
-- -----------------------------------------------------------------------------
-- Appelables par un compte authentifié SANS tenant : c'est précisément leur
-- raison d'être.

create or replace function public.accept_invitation(p_token text)
returns users language sql set search_path = pg_catalog, app, public
as $$ select app.accept_invitation(p_token); $$;

create or replace function public.invitation_preview(p_token text)
returns jsonb language sql stable set search_path = pg_catalog, app, public
as $$ select app.invitation_preview(p_token); $$;

-- -----------------------------------------------------------------------------
-- Fermeture de la surface d'exécution
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d
        on d.objid = p.oid
       and d.classid = 'pg_proc'::regclass
       and d.deptype = 'e'
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

-- Le hook fait exception : il vient d'être regrappé par le GRANT global
-- ci-dessus, et il ne doit être appelable que par le service d'authentification.
do $$
begin
  revoke execute on function app.custom_access_token(jsonb) from authenticated, anon, public;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function app.custom_access_token(jsonb) to supabase_auth_admin;
  end if;
end
$$;
