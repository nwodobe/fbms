-- ============================================================================
-- ANAGROCI — SÉCURITÉ DES DONNÉES (Row Level Security)
-- ----------------------------------------------------------------------------
-- À exécuter dans Supabase → SQL Editor.
-- Effet : plus aucune donnée n'est accessible sans être connecté ET avoir un
-- profil ACTIF. C'est la vraie serrure (le portail JS ne fait que masquer l'UI).
--
-- ORDRE DE DÉPLOIEMENT (important pour ne pas se verrouiller dehors) :
--   1) Créer d'abord AU MOINS UN compte Branch Manager :
--        - Supabase → Authentication → Add user (email + mot de passe).
--        - Puis insérer son profil (remplacer l'uuid et l'email) :
--            insert into public.profils (user_id, nom, email, role, actif)
--            values ('<UUID_DU_USER>', 'Nom BM', 'bm@anagroci.ci', 'Branch Manager', true);
--   2) Exécuter CE script en entier.
--   3) Se connecter sur le portail avec ce compte et vérifier l'accès.
--   (La création des autres comptes se fera ensuite depuis shared/admin.html.)
-- ============================================================================

-- Colonne email sur profils (pratique pour l'écran d'administration). Sans effet si déjà présente.
alter table public.profils add column if not exists email text;

-- ---------------------------------------------------------------------------
-- Fonctions d'aide (SECURITY DEFINER : elles lisent profils sans être bloquées
-- par la RLS, et servent de base à toutes les politiques).
-- ---------------------------------------------------------------------------
create or replace function public.mon_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profils where user_id = auth.uid() and actif = true limit 1
$$;

create or replace function public.est_actif()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif = true)
$$;

create or replace function public.est_bm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils
                 where user_id = auth.uid() and actif = true and role = 'Branch Manager')
$$;

-- Peut modifier les données terrain (bm, chef d'équipe, agent recenseur).
create or replace function public.peut_editer_terrain()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
     'Supervisor','Agent Recenseur')
$$;

-- Peut modifier la configuration logistique / tarifs (bm + chefs / achats).
create or replace function public.peut_editer_config()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
$$;

-- ---------------------------------------------------------------------------
-- Politiques génériques appliquées en boucle :
--   · TERRAIN  : lecture = tout profil actif ; écriture = peut_editer_terrain ; suppression = BM.
--   · CONFIG   : lecture = tout profil actif ; écriture/suppression = peut_editer_config.
-- Les tables absentes sont ignorées (bloc protégé).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  terrain text[] := array['villages','hubs_clusters','rt','producteurs'];
  config  text[] := array['grilles_tarifaires','lignes_tarifaires','parametres_calcul','parametres_collecte_courte'];
begin
  foreach t in array terrain loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t||'_sel', t);
      execute format('drop policy if exists %I on public.%I', t||'_ins', t);
      execute format('drop policy if exists %I on public.%I', t||'_upd', t);
      execute format('drop policy if exists %I on public.%I', t||'_del', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.est_actif())', t||'_sel', t);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.peut_editer_terrain())', t||'_ins', t);
      execute format('create policy %I on public.%I for update to authenticated using (public.peut_editer_terrain()) with check (public.peut_editer_terrain())', t||'_upd', t);
      execute format('create policy %I on public.%I for delete to authenticated using (public.est_bm())', t||'_del', t);
    end if;
  end loop;

  foreach t in array config loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t||'_sel', t);
      execute format('drop policy if exists %I on public.%I', t||'_ins', t);
      execute format('drop policy if exists %I on public.%I', t||'_upd', t);
      execute format('drop policy if exists %I on public.%I', t||'_del', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.est_actif())', t||'_sel', t);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.peut_editer_config())', t||'_ins', t);
      execute format('create policy %I on public.%I for update to authenticated using (public.peut_editer_config()) with check (public.peut_editer_config())', t||'_upd', t);
      execute format('create policy %I on public.%I for delete to authenticated using (public.est_bm())', t||'_del', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Table profils : chacun lit son profil ; le BM lit et gère tous les profils.
-- (La création de compte passe par la fonction Edge admin-create-user.)
-- ---------------------------------------------------------------------------
alter table public.profils enable row level security;
drop policy if exists profils_sel_self on public.profils;
drop policy if exists profils_sel_bm   on public.profils;
drop policy if exists profils_ins_bm   on public.profils;
drop policy if exists profils_upd_bm   on public.profils;
drop policy if exists profils_del_bm   on public.profils;
create policy profils_sel_self on public.profils for select to authenticated using (user_id = auth.uid());
create policy profils_sel_bm   on public.profils for select to authenticated using (public.est_bm());
create policy profils_ins_bm   on public.profils for insert to authenticated with check (public.est_bm());
create policy profils_upd_bm   on public.profils for update to authenticated using (public.est_bm()) with check (public.est_bm());
create policy profils_del_bm   on public.profils for delete to authenticated using (public.est_bm());

-- ---------------------------------------------------------------------------
-- Journal d'audit : tout utilisateur connecté peut écrire ; seul le BM lit.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.audit_log') is not null then
    execute 'alter table public.audit_log enable row level security';
    execute 'drop policy if exists audit_ins on public.audit_log';
    execute 'drop policy if exists audit_sel on public.audit_log';
    execute 'create policy audit_ins on public.audit_log for insert to authenticated with check (auth.uid() is not null)';
    execute 'create policy audit_sel on public.audit_log for select to authenticated using (public.est_bm())';
  end if;
end $$;

-- ============================================================================
-- VÉRIFICATION RAPIDE (facultatif) :
--   select tablename, rowsecurity from pg_tables where schemaname='public' order by 1;
--   -> rowsecurity doit être 'true' sur toutes les tables ci-dessus.
-- ============================================================================
