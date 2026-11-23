-- =====================================================================
-- SIGNALEMENTS GPS AFLP 2027 · RETOUR ARRIÈRE de la migration 1
-- ---------------------------------------------------------------------
-- NE DÉTRUIT AUCUNE DONNÉE.
-- Ferme l'écriture (les trois fonctions sont retirées). Les tables
-- public.geo_signalements et public.geo_signalements_evenements, leurs lignes
-- et la vue de lecture sont CONSERVÉES, en lecture seule : les signalements
-- déjà faits restent consultables. L'écran affiche alors « indisponible »
-- au lieu des boutons (PGRST202 détecté).
--
-- Supprimer les tables est une décision humaine distincte, à prendre après
-- export : elle n'est volontairement pas écrite ici. Aucun point GPS n'a été
-- modifié par cette fonctionnalité : il n'y a rien à restaurer ailleurs.
-- REJOUABLE : oui.
-- =====================================================================
begin;

drop function if exists public.geo_signalement_creer(jsonb);
drop function if exists public.geo_signalement_repondre(uuid, text);
drop function if exists public.geo_signalement_resoudre(uuid, text, text);
drop function if exists private.geo_signalement_superviseur(text);
drop function if exists private.geo_signalement_distance_m(numeric, numeric, numeric, numeric);

commit;
