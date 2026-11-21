-- Retour arrière de 20261122090000_ota_suivi_installations.sql.
-- NE S'EXÉCUTE PAS dans la chaîne normale : à lancer à la main, sur décision du Branch Manager.
-- Supprime uniquement les objets du suivi des mises à jour ; aucune autre table n'est touchée.
-- Les signalements enregistrés sont perdus (ils se reconstituent au prochain signalement des téléphones).
drop view if exists public.ota_installations_v;
drop function if exists public.ota_installation_signaler(jsonb);
drop table if exists public.app_installations;
