-- ============================================================================
-- Retour arrière de rls_roles_aflp_20260822.sql
-- ----------------------------------------------------------------------------
-- Rétablit les trois fonctions d'aide exactement telles qu'elles figurent dans
-- `supabase/rls.sql` au commit 6933e8a.
--
-- ⚠️  Revenir en arrière REPRODUIT le défaut BUG-010 : les huit rôles AFLP
--     perdent à nouveau tout droit d'écriture, et un « Branch Manager / Head of
--     Programme » ne peut plus ni créer un compte ni supprimer un achat.
--     À n'exécuter que si la migration a provoqué un effet imprévu, et en
--     prévenant les utilisateurs concernés.
-- ============================================================================

begin;

create or replace function public.est_bm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils
                 where user_id = auth.uid() and actif = true and role = 'Branch Manager')
$$;

create or replace function public.peut_editer_terrain()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
     'Supervisor','Agent Recenseur')
$$;

create or replace function public.peut_editer_config()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
$$;

commit;
