-- =============================================================================
-- LBA Control · 2900 · Ouverture d'un client depuis la console
-- =============================================================================
-- La console plateforme administrait les clients existants mais n'en créait
-- pas : ouvrir une entreprise et inviter son administrateur restait une
-- manipulation technique, faite à la main dans la base. C'est ce qui séparait
-- encore le produit d'un service vendable sans intervention.
--
-- Trois décisions structurent ce fichier.
--
--  1. **Une entreprise naît complète ou ne naît pas.** Tenant, marque,
--     abonnement et administrateur sont créés dans une seule transaction. Une
--     entreprise sans abonnement se retrouverait bloquée à la première
--     vérification ; une entreprise sans propriétaire ne pourrait rien
--     administrer.
--
--  2. **L'identité vient de Supabase Auth, pas d'ici.** Cette fonction ne crée
--     aucun mot de passe et n'invente aucun compte : elle prépare une
--     invitation que la couche serveur transformera en utilisateur réel. Un
--     produit qui gère lui-même les mots de passe en gère mal.
--
--  3. **Rien n'est écrasé.** Un slug déjà pris arrête la création avec un
--     message clair, plutôt que de rattacher le nouveau client aux données de
--     l'ancien.
--
-- ⚠ Ce fichier crée des fonctions : révocation explicite à la fin.
-- =============================================================================

create type invitation_status as enum ('pending', 'accepted', 'expired', 'revoked');

/*
 * Invitations.
 *
 * Une invitation n'est pas un compte : c'est une promesse de compte, avec une
 * date de péremption. Sans expiration, un lien oublié dans une boîte mail reste
 * une porte ouverte des années durant.
 */
create table tenant_invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  email        text not null,
  full_name    text not null,
  role         user_role not null,
  status       invitation_status not null default 'pending',
  -- Jeton à usage unique. Stocké tel quel parce qu'il ne donne accès à rien par
  -- lui-même : c'est la couche d'authentification qui vérifie l'identité.
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at   timestamptz not null default now() + interval '14 days',
  invited_by   uuid,
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_user_id uuid references users(id) on delete set null
);

create index tenant_invitations_tenant_idx on tenant_invitations (tenant_id, status);
create unique index tenant_invitations_pending_email_uidx
  on tenant_invitations (tenant_id, lower(email)) where status = 'pending';

comment on table tenant_invitations is
  'Promesse de compte, avec péremption. Un lien d''invitation sans expiration oublié dans une boîte '
  'mail reste une porte ouverte des années durant.';

alter table tenant_invitations enable row level security;

-- Le client voit qui a été invité chez lui ; la plateforme voit tout.
create policy tenant_invitations_select on tenant_invitations for select to authenticated
  using (app.is_platform_admin() or (app.can_read_tenant(tenant_id) and app.can_manage_settings()));

-- Aucune écriture directe : tout passe par les fonctions ci-dessous, qui
-- contrôlent le rôle invité et la cohérence de l'entreprise.
create policy tenant_invitations_insert on tenant_invitations for insert to authenticated
  with check (false);
create policy tenant_invitations_update on tenant_invitations for update to authenticated
  using (false);
create policy tenant_invitations_delete on tenant_invitations for delete to authenticated
  using (false);

grant select, insert, update, delete on tenant_invitations to authenticated;

/*
 * Ouvre une entreprise.
 *
 * Tout ou rien : le tenant, sa marque, son abonnement d'essai et l'invitation
 * de son propriétaire dans la même transaction. Si l'un échoue, aucun n'existe —
 * mieux vaut recommencer que réparer une entreprise à moitié née.
 */
create or replace function app.create_tenant(
  p_slug            text,
  p_commercial_name text,
  p_legal_name      text,
  p_owner_email     text,
  p_owner_name      text,
  p_plan_id         uuid default null,
  p_trial_days      integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_tenant     public.tenants;
  v_plan       public.subscription_plans;
  v_invitation public.tenant_invitations;
  v_slug       text := lower(btrim(coalesce(p_slug, '')));
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé aux administrateurs de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_slug !~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$' then
    raise exception
      'Identifiant d''entreprise invalide : minuscules, chiffres et tirets, 3 à 50 caractères. '
      'Il apparaît dans les adresses et ne se change pas ensuite.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.tenants t where t.slug = v_slug) then
    -- Arrêt net plutôt que rattachement : réutiliser un slug relierait le
    -- nouveau client aux données de l'ancien.
    raise exception 'L''identifiant « % » est déjà utilisé par une autre entreprise.', v_slug
      using errcode = 'unique_violation';
  end if;

  if length(btrim(coalesce(p_commercial_name, ''))) < 2 then
    raise exception 'Le nom commercial est obligatoire.' using errcode = 'check_violation';
  end if;

  if p_owner_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse électronique du propriétaire invalide.' using errcode = 'check_violation';
  end if;

  -- Plan : celui demandé, sinon le premier plan actif. Une entreprise sans
  -- abonnement se retrouverait bloquée à la première vérification.
  select * into v_plan from public.subscription_plans
   where is_active
     and (p_plan_id is null or id = p_plan_id)
   order by (id = p_plan_id) desc, monthly_amount
   limit 1;

  if not found then
    raise exception 'Aucun plan d''abonnement disponible : impossible d''ouvrir une entreprise.'
      using errcode = 'no_data_found';
  end if;

  insert into public.tenants (slug, commercial_name, legal_name, status)
  values (v_slug, btrim(p_commercial_name),
          coalesce(nullif(btrim(p_legal_name), ''), btrim(p_commercial_name)), 'active')
  returning * into v_tenant;

  -- Marque par défaut : les couleurs standard, validées par le contrôle de
  -- contraste. Le client les changera depuis son écran.
  insert into public.tenant_branding (tenant_id, commercial_name, legal_name)
  values (v_tenant.id, v_tenant.commercial_name, v_tenant.legal_name);

  insert into public.subscriptions
    (tenant_id, plan_id, status, period_start, period_end, trial_end, amount, currency)
  values
    (v_tenant.id, v_plan.id, 'trial', current_date,
     current_date + greatest(1, coalesce(p_trial_days, 30)),
     current_date + greatest(1, coalesce(p_trial_days, 30)),
     v_plan.monthly_amount, coalesce(v_plan.currency, 'XOF'));

  insert into public.tenant_invitations (tenant_id, email, full_name, role, invited_by)
  values (v_tenant.id, lower(btrim(p_owner_email)), btrim(p_owner_name), 'proprietaire',
          app.current_user_id())
  returning * into v_invitation;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (v_tenant.id, app.current_user_id(), 'create', 'tenants', v_tenant.id::text,
     jsonb_build_object('slug', v_slug, 'plan', v_plan.name),
     format('Entreprise ouverte depuis la console, propriétaire invité : %s.', p_owner_email));

  return jsonb_build_object(
    'tenant_id', v_tenant.id,
    'slug', v_tenant.slug,
    'invitation_id', v_invitation.id,
    'invitation_token', v_invitation.token,
    'invitation_expires_at', v_invitation.expires_at,
    'plan', v_plan.name,
    'trial_end', current_date + greatest(1, coalesce(p_trial_days, 30)));
end;
$$;

comment on function app.create_tenant(text, text, text, text, text, uuid, integer) is
  'Ouvre une entreprise complète — tenant, marque, abonnement d''essai, invitation du propriétaire — '
  'dans une seule transaction. Une entreprise à moitié née est plus coûteuse à réparer qu''à '
  'recommencer.';

/*
 * Invite une personne supplémentaire dans une entreprise existante.
 *
 * Accessible au client lui-même : c'est son équipe. Le rôle invité passe par la
 * même liste d'attribuables que le changement de rôle — inviter quelqu'un ne
 * doit pas contourner ce que changer un rôle interdit.
 */
create or replace function app.invite_user(
  p_email     text,
  p_full_name text,
  p_role      user_role
)
returns tenant_invitations
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_invitation public.tenant_invitations;
begin
  if not app.can_manage_settings() then
    raise exception 'Votre profil ne permet pas d''inviter un utilisateur.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_role = 'super_admin' then
    raise exception 'Le rôle de plateforme ne s''invite pas depuis une entreprise.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.assignable_roles ar
                  where ar.role = p_role and ar.is_assignable) then
    raise exception 'Le rôle « % » n''est pas encore attribuable.', p_role
      using errcode = 'check_violation';
  end if;

  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse électronique invalide.' using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.users u
              where u.tenant_id = app.current_tenant_id()
                and lower(u.email) = lower(btrim(p_email))) then
    raise exception 'Cette adresse est déjà rattachée à un compte de votre entreprise.'
      using errcode = 'unique_violation';
  end if;

  insert into public.tenant_invitations (tenant_id, email, full_name, role, invited_by)
  values (app.current_tenant_id(), lower(btrim(p_email)), btrim(p_full_name), p_role,
          app.current_user_id())
  on conflict (tenant_id, lower(email)) where status = 'pending'
    -- Réinviter quelqu'un renouvelle le délai plutôt que d'échouer : c'est le
    -- geste normal quand un courriel s'est perdu.
    do update set full_name  = excluded.full_name,
                  role       = excluded.role,
                  token      = encode(gen_random_bytes(24), 'hex'),
                  expires_at = now() + interval '14 days',
                  invited_at = now(),
                  invited_by = app.current_user_id()
  returning * into v_invitation;

  return v_invitation;
end;
$$;

/*
 * Révoque une invitation non encore acceptée.
 *
 * Elle reste en base, marquée : savoir qu'une personne a été invitée puis
 * écartée fait partie de l'histoire de l'entreprise.
 */
create or replace function app.revoke_invitation(p_invitation_id uuid)
returns tenant_invitations
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_invitation public.tenant_invitations;
begin
  update public.tenant_invitations
     set status = 'revoked'
   where id = p_invitation_id
     and status = 'pending'
     and (app.is_platform_admin()
          or (tenant_id = app.current_tenant_id() and app.can_manage_settings()))
   returning * into v_invitation;

  if not found then
    raise exception 'Invitation introuvable, déjà acceptée ou déjà révoquée.'
      using errcode = 'no_data_found';
  end if;

  return v_invitation;
end;
$$;

-- -----------------------------------------------------------------------------
-- Relais publics
-- -----------------------------------------------------------------------------

create or replace function public.create_tenant(
  p_slug text, p_commercial_name text, p_legal_name text,
  p_owner_email text, p_owner_name text,
  p_plan_id uuid default null, p_trial_days integer default 30
)
returns jsonb language sql set search_path = pg_catalog, app, public
as $$ select app.create_tenant(p_slug, p_commercial_name, p_legal_name,
                               p_owner_email, p_owner_name, p_plan_id, p_trial_days); $$;

create or replace function public.invite_user(p_email text, p_full_name text, p_role user_role)
returns tenant_invitations language sql set search_path = pg_catalog, app, public
as $$ select app.invite_user(p_email, p_full_name, p_role); $$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns tenant_invitations language sql set search_path = pg_catalog, app, public
as $$ select app.revoke_invitation(p_invitation_id); $$;

-- -----------------------------------------------------------------------------
-- Fermeture de la surface d'exécution
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app    to authenticated, service_role;
