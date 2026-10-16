-- =============================================================================
-- FBMS · AFLP 2027 — Cloisonnement par cluster des écritures VILLAGES
-- pour les rôles à périmètre cluster (Unit Head, Assistant Unit Head).
-- Date : 2026-10-16 · Branche : fix/aflp-unit-head-enrollment
--
-- Constat (politiques réelles relevées le 2026-10-16) :
--   public.villages INSERT/UPDATE = (villages_write OU villages_ins/upd)
--                                   ET peut_ecrire_referentiel_terrain()
--   Aucune condition géographique : un Unit Head pouvait créer ou modifier un
--   village de n'importe quel cluster, et donc déplacer un village (et ses
--   producteurs) dans son propre cluster pour contourner
--   farmer_registry_scope_guard sur public.producteurs.
--
-- Correctif : UNE politique RESTRICTIVE par commande (INSERT, UPDATE).
--   · N'ajoute AUCUN droit (une politique restrictive ne peut que retirer).
--   · Neutre pour tous les autres rôles (la fonction renvoie TRUE).
--   · UPDATE : USING contrôle l'ancienne ligne, WITH CHECK la nouvelle →
--     ni sortie ni entrée d'un village dans un autre cluster.
--   · Les trois signaux de cluster d'une fiche (cluster_code, cluster,
--     data.s1.cluster) doivent tous désigner le cluster du compte : un
--     désalignement volontaire ne peut pas servir de contournement.
--   · Compte Unit Head sans cluster exploitable : aucune écriture village.
--   · RLS n'est ni désactivée ni affaiblie ; aucune donnée n'est modifiée.
-- =============================================================================

create or replace function private.aflp_village_ecriture_dans_mon_cluster(
  p_cluster_code text, p_cluster text, p_data jsonb
) returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $$
declare
  v_role text;
  v_mon_cluster text;
  v_signal text;
  v_code text;
  v_nb int := 0;
begin
  select role, cluster into v_role, v_mon_cluster
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1;

  -- Politique sans objet pour les rôles qui ne sont pas à périmètre cluster :
  -- leurs droits restent exactement ceux des autres politiques.
  if v_role is null or v_role not in ('Unit Head', 'Assistant Unit Head') then
    return true;
  end if;

  -- Cluster du compte : obligatoire et reconnu par le référentiel officiel.
  v_mon_cluster := public.farmer_registry_resolve_cluster_code(v_mon_cluster);
  if v_mon_cluster is null then
    return false;
  end if;

  foreach v_signal in array array[p_cluster_code, p_cluster, p_data -> 's1' ->> 'cluster'] loop
    if nullif(btrim(coalesce(v_signal, '')), '') is null then
      continue;
    end if;
    v_code := public.farmer_registry_resolve_cluster_code(v_signal);
    if v_code is null or v_code <> v_mon_cluster then
      return false;
    end if;
    v_nb := v_nb + 1;
  end loop;

  -- Une fiche sans aucun cluster n'est pas attribuable : refusée.
  return v_nb > 0;
end
$$;

revoke all on function private.aflp_village_ecriture_dans_mon_cluster(text, text, jsonb) from public;
grant execute on function private.aflp_village_ecriture_dans_mon_cluster(text, text, jsonb) to authenticated;

comment on function private.aflp_village_ecriture_dans_mon_cluster(text, text, jsonb) is
  'AFLP 2027 : TRUE si le compte n''est pas à périmètre cluster ; sinon TRUE seulement si tous les signaux de cluster de la fiche village désignent le cluster du compte.';

drop policy if exists villages_cluster_scope_unit_head_ins on public.villages;
create policy villages_cluster_scope_unit_head_ins on public.villages
  as restrictive for insert to authenticated
  with check (private.aflp_village_ecriture_dans_mon_cluster(cluster_code, cluster, data));

drop policy if exists villages_cluster_scope_unit_head_upd on public.villages;
create policy villages_cluster_scope_unit_head_upd on public.villages
  as restrictive for update to authenticated
  using (private.aflp_village_ecriture_dans_mon_cluster(cluster_code, cluster, data))
  with check (private.aflp_village_ecriture_dans_mon_cluster(cluster_code, cluster, data));

-- =============================================================================
-- RETOUR ARRIÈRE (restaure exactement l'état antérieur, sans perte de données)
--
--   drop policy if exists villages_cluster_scope_unit_head_ins on public.villages;
--   drop policy if exists villages_cluster_scope_unit_head_upd on public.villages;
--   drop function if exists private.aflp_village_ecriture_dans_mon_cluster(text, text, jsonb);
-- =============================================================================
