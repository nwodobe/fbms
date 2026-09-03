-- AFLP 2027 - droits de modification RT / Producteurs
-- Objectif : Zonal Head et Agent Recenseur peuvent corriger les fiches dans leur
-- périmètre, sans pouvoir les supprimer. Le Branch Manager conserve la suppression.

begin;

create or replace function public.peut_modifier_rt_producteur()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mon_role() in (
    'Branch Manager',
    'Assistant Branch Manager',
    'Head of Field',
    'Procurement Officer',
    'Zonal Head',
    'Unit Head',
    'Assistant Unit Head',
    'Supervisor',
    'Agent Recenseur',
    'Chef d''equipe',
    'Chef d''équipe',
    'Administrateur'
  )
$$;

grant execute on function public.peut_modifier_rt_producteur() to authenticated;

-- Une policy permissive explicite garantit le droit UPDATE des rôles concernés.
drop policy if exists rt_update_rt_farmer_roles on public.rt;
create policy rt_update_rt_farmer_roles on public.rt
  for update to authenticated
  using (
    public.peut_modifier_rt_producteur()
    and private.farmer_registry_can_access_village(village_id, id)
  )
  with check (
    public.peut_modifier_rt_producteur()
    and private.farmer_registry_can_access_village(village_id, id)
  );

drop policy if exists producteurs_update_rt_farmer_roles on public.producteurs;
create policy producteurs_update_rt_farmer_roles on public.producteurs
  for update to authenticated
  using (
    public.peut_modifier_rt_producteur()
    and private.farmer_registry_can_access_village(village_id, rt_id)
  )
  with check (
    public.peut_modifier_rt_producteur()
    and private.farmer_registry_can_access_village(village_id, rt_id)
  );

-- Les anciennes policies permissives ALL existent encore pour compatibilité.
-- Ces policies RESTRICTIVE empêchent qu'elles puissent contourner rôle/périmètre.
drop policy if exists rt_update_role_scope_guard on public.rt;
create policy rt_update_role_scope_guard on public.rt
  as restrictive
  for update to authenticated
  using (
    public.peut_modifier_rt_producteur()
    and private.farmer_registry_can_access_village(village_id, id)
  )
  with check (
    public.peut_modifier_rt_producteur()
    and private.farmer_registry_can_access_village(village_id, id)
  );

drop policy if exists producteurs_update_role_scope_guard on public.producteurs;
create policy producteurs_update_role_scope_guard on public.producteurs
  as restrictive
  for update to authenticated
  using (
    public.peut_modifier_rt_producteur()
    and private.farmer_registry_can_access_village(village_id, rt_id)
  )
  with check (
    public.peut_modifier_rt_producteur()
    and private.farmer_registry_can_access_village(village_id, rt_id)
  );

-- Suppression physique : seul le BM peut DELETE, même si une ancienne policy ALL
-- serait plus permissive. La suppression logique deleted=true est déjà protégée
-- par trg_suppr_rt / trg_suppr_prod -> fbms_controler_suppression().
drop policy if exists rt_delete_bm_only_guard on public.rt;
create policy rt_delete_bm_only_guard on public.rt
  as restrictive
  for delete to public
  using (public.est_bm());

drop policy if exists producteurs_delete_bm_only_guard on public.producteurs;
create policy producteurs_delete_bm_only_guard on public.producteurs
  as restrictive
  for delete to public
  using (public.est_bm());

commit;
