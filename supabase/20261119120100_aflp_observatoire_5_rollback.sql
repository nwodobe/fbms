-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 · RETOUR ARRIÈRE de la migration 5
-- Effet : retire les fonctions et vues ajoutées par la migration 5, puis il faut
-- REJOUER, dans cet ordre, les migrations d'origine (toutes rejouables) :
--   supabase/20261113100200_aflp_observatoire_3_rpc_sync.sql
--   supabase/20261113100300_aflp_observatoire_4_vues_pilote.sql
-- Les colonnes ajoutées sont CONSERVÉES (additives, sans effet sur l'ancien code) :
-- aucune donnée saisie après la migration 5 n'est perdue (temporalité, justifications,
-- exceptions photo, désignations). Les champs installés en mode DESIGNATION restent
-- lisibles mais ne peuvent plus être désignés : les terminer avant retour arrière.
-- =====================================================================
begin;
drop view if exists public.pheno_v_supervision;
drop view if exists public.pheno_v_anomalies_temporelles;
drop view if exists public.pheno_v_c_cumulatif_cluster;
drop view if exists public.pheno_v_c_cumulatif;
drop view if exists public.pheno_v_qualite;
drop view if exists public.pheno_v_champ_semaine;
drop function if exists public.pheno_preparation_clusters(uuid);
drop function if exists public.pheno_visites_a_traiter(uuid);
drop function if exists public.pheno_arbres_designer(jsonb);
drop function if exists public.pheno_visite_valider(uuid, integer, text);
drop function if exists public.pheno_reserve_activer(uuid, text, date);
drop function if exists public.pheno_parcelles_disponibles(uuid);
drop function if exists private.pheno_droit_decision(public.pheno_visites);
drop function if exists private.pheno_preuves_visite(uuid);
drop function if exists private.pheno_parcelle_manques(uuid);
update public.pheno_protocoles set parametres = parametres - 'mode_selection' - 'nomenclature' - 'avertissement' where actif;
commit;
-- Puis : rejouer 20261113100200 et 20261113100300 (voir en-tête).
