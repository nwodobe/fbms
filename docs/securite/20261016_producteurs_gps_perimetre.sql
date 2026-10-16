-- =============================================================================
-- FBMS · Garde de périmètre sur les coordonnées GPS des producteurs
-- Date : 2026-10-16 · Branche : fix/aflp-unit-head-enrollment
--
-- Constat : public.offline_sync_batch (SECURITY DEFINER, propriétaire postgres,
-- BYPASSRLS), branche FIELD_GPS_UPDATE, met à jour gps_lat / gps_lng de N'IMPORTE
-- QUEL producteur sans contrôle de périmètre : la RLS est contournée.
-- C'est la seule fonction SECURITY DEFINER qui écrit ces colonnes (vérifié le 16/10).
--
-- Correctif : déclencheur BEFORE UPDATE sur public.producteurs. Si un utilisateur
-- authentifié modifie gps_lat ou gps_lng d'un producteur hors de son périmètre
-- (private.farmer_registry_can_access_village sur l'ANCIENNE ligne), l'écriture est
-- refusée (42501), quel que soit le chemin (API directe, RPC, synchronisation).
--   · En ligne : la RLS (producteurs_update_role_scope_guard) applique déjà la
--     même règle → aucune restriction nouvelle.
--   · Hors ligne : l'opération FIELD_GPS_UPDATE hors périmètre revient
--     « NEEDS_REVIEW » au lieu d'être appliquée.
--   · Sans effet pour auth.uid() nul (maintenance / service), ni hors GPS.
-- Non destructif, réexécutable, aucune donnée modifiée.
-- =============================================================================
create or replace function private.producteur_gps_dans_mon_perimetre()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.gps_lat is not distinct from old.gps_lat and new.gps_lng is not distinct from old.gps_lng then
    return new;
  end if;
  if not private.farmer_registry_can_access_village(old.village_id, old.rt_id) then
    raise exception 'Coordonnées GPS : producteur hors de votre périmètre.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function private.producteur_gps_dans_mon_perimetre() from public;

drop trigger if exists trg_producteur_gps_perimetre on public.producteurs;
create trigger trg_producteur_gps_perimetre
  before update of gps_lat, gps_lng on public.producteurs
  for each row execute function private.producteur_gps_dans_mon_perimetre();

-- RETOUR ARRIÈRE :
--   drop trigger if exists trg_producteur_gps_perimetre on public.producteurs;
--   drop function if exists private.producteur_gps_dans_mon_perimetre();
