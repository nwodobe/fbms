-- =====================================================================
-- ANAGROCI FBMS — Sacherie AFLP — Lot 1 : comptes, rôles, journal des habilitations
-- Fichier : supabase/20260918b_comptes_roles_habilitations.sql
-- Branche : fix/sacherie-identity-access-hardening
--
-- STATUT : NON APPLIQUEE EN PRODUCTION. Testee sur replique locale
--          (tests/sql/executer_tests.sh).
--
-- PRINCIPE : une seule regle serveur fait autorite pour les droits Sacherie :
--   profils.role (+ profils.actif) pour ce que l'utilisateur PEUT FAIRE,
--   profils.cluster / authority_level / portee_terrain_globale() pour OU.
--   profils.fonction_operationnelle devient purement informative : elle
--   n'accorde plus aucun droit (colonne conservee, aucune suppression).
--
-- CE QUE LA MIGRATION NE FAIT PAS : aucune modification de compte reel,
--   aucun mouvement de stock, aucune ecriture dans rcn_jute_movements,
--   aucune transition FULLY_RELEASED -> RECEIVED -> CLOSED, aucun plafond
--   d'enveloppe, aucune cloture de campagne.
--
-- RETOUR ARRIERE : voir 20260918z_sacherie_lot1_rollback_complet.sql
--   et docs/sacherie_lot1_identite_acces_20260918.md (§ deploiement).
-- =====================================================================

-- ORDRE : 2/3 (après 20260918a : utilise private.sacherie_norm_cluster)
begin;
-- ---------------------------------------------------------------------
-- 13. Comptes et roles : referentiel serveur des roles attribuables.
--     Les VALEURS viennent de profils_role_check (source unique, jamais
--     dupliquee) ; la fonction n'ajoute que libelle, portee et
--     attribuabilite. Un role ajoute a la contrainte apparait
--     automatiquement (libelle = valeur, attribuable).
-- ---------------------------------------------------------------------
create or replace function public.fbms_roles_attribuables()
returns table(valeur text, libelle text, portee text, cluster_requis boolean, attribuable boolean, note text)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not public.est_bm() then
    raise exception 'Réservé au Branch Manager actif' using errcode = '42501';
  end if;
  return query
  with c as (
    select (regexp_matches(pg_get_constraintdef(k.oid), '''([^'']+)''::text', 'g'))[1] as v
    from pg_constraint k
    where k.conrelid = 'public.profils'::regclass and k.conname = 'profils_role_check'
  ),
  meta(v, lib, portee, clr, attr, note, ordre) as (values
    ('Branch Manager', 'Branch Manager / Responsable programme', 'GLOBAL', false, false, 'Non attribuable depuis l''écran : procédure administrateur (Supabase).', 1),
    ('General Manager', 'General Manager', 'GLOBAL', false, false, 'Rôle supérieur au Branch Manager : non attribuable par lui.', 2),
    ('Zonal Head', 'Chef de Zone (Zonal Head)', 'GLOBAL', false, true, 'Portée terrain globale (décision du 17/09/2026). Revue des demandes ; ne mouvemente pas les sacs.', 3),
    ('Field Buying Operations Officer', 'Field Buying Operations Officer', 'GLOBAL', false, true, 'Consolidation et coordination ; lecture Sacherie globale.', 4),
    ('Unit Head', 'Chef d''Unité (Unit Head)', 'CLUSTER', true, true, 'Demandes RT, suivi des comptes RT, réceptions terrain. Cluster obligatoire.', 5),
    ('Storekeeper', 'Magasinier (Storekeeper)', 'CLUSTER', true, true, 'Sorties, transferts, comptages, constats physiques. Cluster obligatoire.', 6),
    ('Warehouse Manager', 'Responsable entrepôt usine (Warehouse Manager)', 'HORS_SACHERIE_AFLP', false, true, 'Module RCN TRACE / usine. Aucun accès aux emplacements AFLP.', 7)
  )
  select c.v, coalesce(m.lib, c.v), coalesce(m.portee, 'HORS_SACHERIE_AFLP'), coalesce(m.clr, false),
         coalesce(m.attr, true), m.note
  from c left join meta m on m.v = c.v
  order by coalesce(m.ordre, 100), c.v;
end
$fn$;

-- ---------------------------------------------------------------------
-- 14. Garde des habilitations sur profils (defense en profondeur, en plus
--     des policies RLS existantes reservees au BM).
-- ---------------------------------------------------------------------
create or replace function private.profils_garde_habilitations()
returns trigger
language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid();
begin
  -- Validation du cluster pour tout ecrivain (y compris procedure administrateur)
  if tg_op in ('INSERT','UPDATE') and new.cluster is not null and btrim(new.cluster) <> ''
     and (tg_op = 'INSERT' or new.cluster is distinct from old.cluster)
     and private.sacherie_norm_cluster(new.cluster) is null then
    raise exception 'Cluster « % » inconnu du référentiel AFLP', new.cluster using errcode = '23514';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.authority_level = 'GLOBAL'
     and (tg_op = 'INSERT' or new.authority_level is distinct from old.authority_level)
     and new.role in ('Unit Head','Storekeeper') and v_uid is not null then
    -- Portee globale explicite d'un poste normalement limite : autorisee au BM,
    -- tracee dans l'audit. Aucune condition supplementaire ici.
    null;
  end if;
  -- Procedure administrateur (service_role / SQL) : tracee par l'audit.
  if v_uid is null then return coalesce(new, old); end if;

  if not public.est_bm() then
    raise exception 'Seul le Branch Manager actif peut modifier les comptes et leurs habilitations' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.user_id = v_uid then raise exception 'Vous ne pouvez pas supprimer votre propre compte' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then raise exception 'Identifiant de compte non modifiable' using errcode = '42501'; end if;
    if old.user_id = v_uid and (new.role is distinct from old.role or new.actif is distinct from old.actif
        or new.authority_level is distinct from old.authority_level or new.permissions is distinct from old.permissions) then
      raise exception 'Vous ne pouvez pas modifier vos propres habilitations (rôle, statut, portée)' using errcode = '42501';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.role is distinct from old.role) and new.role in ('Branch Manager','General Manager') then
    raise exception 'Le rôle « % » ne s''attribue pas depuis l''écran : procédure administrateur requise', new.role using errcode = '42501';
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_profils_garde_habilitations on public.profils;
create trigger trg_profils_garde_habilitations
  before insert or update or delete on public.profils
  for each row execute function private.profils_garde_habilitations();

-- Journal des changements de comptes : reutilise le journal central existant
-- public.rcn_proc_audit_central (avant/apres, auteur, role, date).
create or replace function private.profils_journaliser()
returns trigger
language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare v_role text;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'derniere_connexion') = (to_jsonb(old) - 'derniere_connexion') then
    return new;
  end if;
  if auth.uid() is not null then
    select role into v_role from public.profils where user_id = auth.uid();
  else
    v_role := coalesce(auth.role(), 'procedure administrateur ('||current_user||')');
  end if;
  insert into public.rcn_proc_audit_central(table_name, record_id, action, before_data, after_data, actor_id, actor_role)
  values ('profils', coalesce(new.user_id, old.user_id)::text, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid(), v_role);
  return coalesce(new, old);
end
$fn$;

drop trigger if exists trg_profils_journal on public.profils;
create trigger trg_profils_journal
  after insert or update or delete on public.profils
  for each row execute function private.profils_journaliser();

-- Le BM administre les comptes : il lit le journal de SES changements de comptes
-- (et seulement celui-la). Nouvelle permission de lecture, justifiee par
-- l'administration des comptes.                             [A VALIDER]
drop policy if exists rcn_proc_audit_central_read_profils_bm on public.rcn_proc_audit_central;
create policy rcn_proc_audit_central_read_profils_bm on public.rcn_proc_audit_central
  for select to authenticated
  using (table_name = 'profils' and (select public.est_bm()));

revoke all on function public.fbms_roles_attribuables() from public, anon;
grant execute on function public.fbms_roles_attribuables() to authenticated;
revoke all on function private.profils_garde_habilitations() from public, anon, authenticated;
revoke all on function private.profils_journaliser() from public, anon, authenticated;

commit;
