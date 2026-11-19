-- =====================================================================
-- CARTOGRAPHIE DES PARCELLES AFLP · RETOUR ARRIÈRE des migrations 1 à 3
-- ---------------------------------------------------------------------
-- ATTENTION : supprime les CONTOURS, anomalies, journaux et paramètres de la
-- cartographie. À n'utiliser en production qu'avant tout usage réel ; après mise
-- en service, la voie normale est la DÉSACTIVATION (plot_map_parametre_definir
-- 'activation' {localisation:false, contours:false}), qui ne détruit rien.
-- Les points GPS posés par « Localiser mon champ » restent dans farmer_plots
-- (colonnes existantes avant la cartographie) : ils ne sont pas effacés.
-- L'extension PostGIS est conservée (aucun objet existant n'en dépend avant).
-- =====================================================================
begin;
drop function if exists public.plot_map_tableau(jsonb);
drop view if exists public.plot_map_geometries_v;
drop view if exists public.plot_map_parcelles_v;
drop function if exists private.plot_map_nom(uuid);
drop function if exists public.plot_map_sync_batch(jsonb);
drop function if exists public.plot_map_parametre_definir(text, jsonb);
drop function if exists public.plot_map_archiver(uuid, text);
drop function if exists public.plot_map_classer_anomalie(uuid, text, text);
drop function if exists public.plot_map_decider(uuid, text, text, integer, boolean);
drop function if exists public.plot_map_preverifier(uuid, text);
drop function if exists public.plot_map_soumettre(jsonb);
drop function if exists public.plot_map_ajouter_parcelle(jsonb);
drop function if exists public.plot_map_localiser(jsonb);
drop table if exists public.farmer_plot_anomalies;
drop table if exists public.farmer_plot_map_events;
drop table if exists private.plot_map_sync_recus;
drop table if exists public.plot_map_parametres;
alter table public.farmer_plots drop constraint if exists farmer_plots_split_from_fk;
drop table if exists public.farmer_plot_geometries;
drop function if exists private.plot_map_hex(text);
drop function if exists private.plot_map_journaliser(uuid, uuid, text, jsonb, jsonb, text);
drop function if exists private.plot_map_actif(text, text);
drop function if exists private.plot_map_peut_saisir(text, text);
drop function if exists private.plot_map_peut_lire(text, text);
drop function if exists private.plot_map_consentement_gps(text);
drop function if exists private.plot_map_contexte(uuid);
drop function if exists private.plot_map_ma_zone();
drop function if exists private.plot_map_mon_cluster();
drop function if exists private.plot_map_norm(text);
drop function if exists private.plot_map_classe();
drop function if exists private.plot_map_profil();
drop function if exists private.plot_map_seuil(text, numeric);
drop function if exists private.plot_map_param(text);
alter table public.farmer_plots drop constraint if exists farmer_plots_mapping_status_chk;
alter table public.farmer_plots drop constraint if exists farmer_plots_mapped_area_method_chk;
alter table public.farmer_plots drop constraint if exists farmer_plots_mapped_area_chk;
drop index if exists public.farmer_plots_plot_code_uidx;
-- Les parcelles ajoutées par la cartographie restent dans le registre (aucune suppression de parcelle) ;
-- seules les colonnes propres à la cartographie sont retirées.
alter table public.farmer_plots drop column if exists split_from_plot_id;
alter table public.farmer_plots drop column if exists mapped_area_method;
alter table public.farmer_plots drop column if exists mapped_area_ha;
alter table public.farmer_plots drop column if exists current_geometry_id;
alter table public.farmer_plots drop column if exists mapping_status;
alter table public.farmer_plots drop column if exists plot_code;
commit;
