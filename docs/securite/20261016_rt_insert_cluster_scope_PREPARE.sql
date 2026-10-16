-- =============================================================================
-- FBMS · Cloisonnement par cluster de la CRÉATION de RT (Unit Head / Assistant)
-- Date : 2026-10-16 · Statut : PRÉPARÉ ET TESTÉ EN LOCAL — NON APPLIQUÉ
-- (le mandat laisse les RT « selon les permissions existantes » : application
--  sur décision expresse uniquement).
--
-- Constat : public.rt INSERT = (rt_write OU rt_ins) ET peut_ecrire_referentiel_terrain().
-- Aucune condition géographique : un Unit Head peut créer un RT dans le village d'un
-- autre cluster. La MODIFICATION est déjà cloisonnée (rt_update_role_scope_guard).
--
-- Correctif : politique RESTRICTIVE sur INSERT, limitée aux rôles à périmètre cluster.
-- =============================================================================
create or replace function private.aflp_rt_creation_dans_mon_cluster(p_village_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private'
as $$
  select case
    when coalesce((select role from public.profils where user_id = auth.uid() and actif = true limit 1), '')
         not in ('Unit Head', 'Assistant Unit Head') then true
    else coalesce(private.farmer_registry_can_access_village(p_village_id, null), false)
  end
$$;
revoke all on function private.aflp_rt_creation_dans_mon_cluster(text) from public;
grant execute on function private.aflp_rt_creation_dans_mon_cluster(text) to authenticated;

drop policy if exists rt_cluster_scope_unit_head_ins on public.rt;
create policy rt_cluster_scope_unit_head_ins on public.rt
  as restrictive for insert to authenticated
  with check (private.aflp_rt_creation_dans_mon_cluster(village_id));

-- RETOUR ARRIÈRE :
--   drop policy if exists rt_cluster_scope_unit_head_ins on public.rt;
--   drop function if exists private.aflp_rt_creation_dans_mon_cluster(text);
