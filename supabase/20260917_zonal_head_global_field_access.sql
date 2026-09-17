-- ANAGROCI FBMS - AFLP 2027
-- Zonal Head : portee geographique globale sur les donnees terrain,
-- sans aucun droit de suppression ni droit d'administration.
--
-- APPLIQUEE en base le 2026-09-17 (migration Supabase zonal_head_global_field_access).
--
-- Principe : un SEUL point de decision geographique est modifie,
-- private.farmer_registry_can_access_village(). Les policies existantes,
-- les guards DELETE et le trigger anti-suppression logique restent en place
-- et s'appliquent inchanges aux autres roles.
--
-- Policies CONSERVEES telles quelles :
--   villages/rt/producteurs *_sel, *_select, *_ins, *_upd, *_write
--   producteurs.farmer_registry_scope_guard        (RESTRICTIVE ALL, geographique)
--   producteurs.producteurs_update_role_scope_guard(RESTRICTIVE UPDATE)
--   rt.rt_update_role_scope_guard                  (RESTRICTIVE UPDATE)
--   producteurs.producteurs_del / producteurs_delete_bm_only_guard / prod_del_admin
--   rt.rt_del / rt_delete_bm_only_guard / rt_del_admin
--   villages.villages_del / villages_del_admin
-- Policy AJOUTEE :
--   villages.villages_delete_bm_only_guard         (RESTRICTIVE DELETE, symetrie)
-- Policy SUPPRIMEE : aucune.
-- Trigger CONSERVE : fbms_controler_suppression() sur les trois tables, qui
--   refuse deja le passage deleted = true a tout role autre que Branch Manager.

-- 1. Roles disposant d'une portee terrain globale (hors roles GLOBAL deja geres
--    par farmer_registry_authority). Ajouter un role ici est le seul geste
--    necessaire pour lui accorder la meme portee : rien n'est code en dur par zone.
create or replace function public.portee_terrain_globale()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mon_role() in ('Zonal Head')
$$;

comment on function public.portee_terrain_globale() is
  'Roles dont le perimetre terrain couvre toutes les zones du programme. '
  'Portee geographique uniquement : ne donne ni suppression, ni administration.';

grant execute on function public.portee_terrain_globale() to authenticated;

-- 2. Point de decision geographique unique.
create or replace function private.farmer_registry_can_access_village(
  target_village text,
  target_rt text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  p public.profils%rowtype;
  v_cluster text;
  v_zone text;
  v_has_multi_zone boolean := false;
begin
  select * into p
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1;

  if p.user_id is null then return false; end if;
  if private.farmer_registry_authority() = 'GLOBAL' then return true; end if;

  -- Portee terrain globale par role (Zonal Head). Dynamique : vaut pour toute
  -- zone existante ou creee ulterieurement, sans liste a maintenir.
  if public.portee_terrain_globale() then return true; end if;

  select coalesce(v.cluster_code, upper(btrim(v.cluster))), c.zone_code
    into v_cluster, v_zone
  from public.villages v
  left join public.aflp_clusters c on c.code = v.cluster_code
  where v.id = target_village and not v.deleted;

  if v_cluster is null then return false; end if;

  -- Multi-zone explicite : permissions = {"zones":["GBEKE_1","GBEKE_2"]}
  if jsonb_typeof(p.permissions) = 'object'
     and jsonb_typeof(p.permissions->'zones') = 'array' then
    select exists (
      select 1
      from jsonb_array_elements_text(p.permissions->'zones') z
      where public.farmer_registry_norm_text(z)
            = public.farmer_registry_norm_text(v_zone)
         or public.farmer_registry_norm_text(z)
            = public.farmer_registry_norm_text(
                (select label from public.aflp_zones where code = v_zone)
              )
    ) into v_has_multi_zone;
    if v_has_multi_zone then return true; end if;
  end if;

  if p.village_id is not null then
    if target_village is distinct from p.village_id then return false; end if;
    if p.rt_id is not null and target_rt is distinct from p.rt_id then return false; end if;
    return true;
  end if;

  if p.cluster is not null then
    return public.farmer_registry_norm_text(p.cluster)
      = public.farmer_registry_norm_text(v_cluster);
  end if;

  if p.zone is not null then
    return public.farmer_registry_norm_text(p.zone)
      = public.farmer_registry_norm_text(v_zone)
      or public.farmer_registry_norm_text(p.zone)
      = public.farmer_registry_norm_text(
          (select z.label from public.aflp_zones z where z.code = v_zone)
        );
  end if;

  -- Plus d'acces large implicite si aucun perimetre n'est configure.
  return false;
end
$$;

-- 3. Suppression physique : garde RESTRICTIVE uniforme sur les trois tables.
--    producteurs et rt en avaient une, villages non.
drop policy if exists villages_delete_bm_only_guard on public.villages;
create policy villages_delete_bm_only_guard on public.villages
  as restrictive for delete to authenticated
  using (public.est_bm());
