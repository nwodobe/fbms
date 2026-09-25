-- =====================================================================
-- FBMS / WMS — P1-01 (complément) : périmètre d'écriture sacherie
-- Audit du 24/09/2026, contre-vérification du 25/09/2026.
--
-- Constat : la politique d'insertion historique de rcn_jute_movements
-- autorise des rôles limités à un Warehouse (Warehouse Manager) à écrire
-- directement un mouvement de sacs sur n'importe quel emplacement, en
-- contournant wms_bag_move (contrôle de périmètre). Les écrans sacherie
-- historiques (rcntrace/jute-*.js) insèrent en direct : on ne retire pas
-- ce droit, on le restreint.
--
-- Correctif (non destructif, aucune donnée modifiée) :
--   * politique RESTRICTIVE d'insertion : pour un rôle limité à un
--     Warehouse, le mouvement doit partir de, ou arriver à, son propre
--     emplacement BAG-WH-<code> ; profil limité sans Warehouse → refus.
--     Rôles non limités (BM, GM, Coordination...) : inchangé.
--   * les fonctions métier SECURITY DEFINER (wms_bag_move, déclencheurs
--     de déchargement/transfert) ne sont pas concernées (propriétaire
--     postgres, contrôle de périmètre déjà fait dans la fonction).
--   * anon : retrait des droits d'écriture (déjà inopérants via RLS).
-- =====================================================================
drop policy if exists rcn_jute_movements_wh_scope_write on public.rcn_jute_movements;
create policy rcn_jute_movements_wh_scope_write on public.rcn_jute_movements
  as restrictive for insert to authenticated
  with check (
    (select private.jute_scope_location()) is null
    or from_location = (select private.jute_scope_location())
    or to_location   = (select private.jute_scope_location())
  );
comment on policy rcn_jute_movements_wh_scope_write on public.rcn_jute_movements is
  'P1-01 : un rôle limité à un Warehouse n''écrit en direct que des mouvements de sacs touchant son propre emplacement BAG-WH-<code>.';

revoke insert, update, delete on public.rcn_jute_movements from anon;
