-- =====================================================================
-- REPÈRES GPS AFLP 2027 · RETOUR ARRIÈRE de la migration 1
-- ---------------------------------------------------------------------
-- NE DÉTRUIT AUCUNE DONNÉE DE TERRAIN.
-- Le retour arrière ferme l'écriture (la fonction de synchronisation est retirée) :
-- les téléphones gardent alors leurs repères « en attente » sur l'appareil, sans
-- perte, jusqu'à la remise en service. La table public.geo_reperes et ses lignes
-- sont CONSERVÉES, en lecture seule.
--
-- Supprimer la table elle-même est une décision humaine distincte, à prendre après
-- export : elle n'est volontairement pas écrite ici.
-- REJOUABLE : oui.
-- =====================================================================
begin;

drop function if exists public.geo_reperes_sync_batch(jsonb);
drop function if exists private.geo_repere_enregistrer(jsonb);

commit;
