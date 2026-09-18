-- =====================================================================
-- ANAGROCI FBMS — Sacherie AFLP — Lot 1 : RLS de lecture périmétrée
-- Fichier : supabase/20260918c_sacherie_rls_lecture_perimetre.sql
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

-- ORDRE : 3/3 (après 20260918a : utilise private.sacherie_peut_lire_*)
begin;
-- ---------------------------------------------------------------------
-- 15. RLS de lecture perimetree pour les postes Sacherie AFLP.
--     Avant : Unit Head, Storekeeper, Zonal Head, FBOO ne lisaient AUCUNE
--     ligne de rcn_jute_* (listes historiques RCN TRACE), donc les vues
--     security_invoker (stocks cluster / RT, dernier inventaire) etaient
--     vides pour eux. Policies PERMISSIVE ajoutees, en LECTURE seule,
--     bornees par le meme perimetre que les RPC. Aucune policy existante
--     n'est modifiee ni supprimee.
-- ---------------------------------------------------------------------
drop policy if exists sacherie_perimetre_read on public.rcn_jute_locations;
create policy sacherie_perimetre_read on public.rcn_jute_locations
  for select to authenticated using (private.sacherie_peut_lire_cluster(cluster, true));

drop policy if exists sacherie_perimetre_read on public.rcn_jute_movements;
create policy sacherie_perimetre_read on public.rcn_jute_movements
  for select to authenticated using (ledger = 'INTERNE' and private.sacherie_peut_lire_cluster(cluster, false));

drop policy if exists sacherie_perimetre_read on public.rcn_jute_transfers;
create policy sacherie_perimetre_read on public.rcn_jute_transfers
  for select to authenticated
  using (private.sacherie_peut_lire_emplacement(from_location) or private.sacherie_peut_lire_emplacement(to_location));

drop policy if exists sacherie_perimetre_read on public.rcn_jute_loss_requests;
create policy sacherie_perimetre_read on public.rcn_jute_loss_requests
  for select to authenticated using (ledger = 'INTERNE' and private.sacherie_peut_lire_emplacement(location_code));

drop policy if exists sacherie_perimetre_read on public.rcn_jute_inventories;
create policy sacherie_perimetre_read on public.rcn_jute_inventories
  for select to authenticated using (private.sacherie_peut_lire_emplacement(location_code));

revoke all on function private.sacherie_peut_lire_cluster(text,boolean) from public, anon;
revoke all on function private.sacherie_peut_lire_emplacement(text) from public, anon;
grant execute on function private.sacherie_peut_lire_cluster(text,boolean) to authenticated;
grant execute on function private.sacherie_peut_lire_emplacement(text) to authenticated;

commit;
