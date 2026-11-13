-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 (pilote) — RETOUR ARRIÈRE COMPLET
-- ---------------------------------------------------------------------
-- Supprime UNIQUEMENT les objets créés par les migrations 1 à 4 de
-- l'Observatoire (préfixe pheno_). Aucun objet existant de FBMS n'est touché.
-- ATTENTION : les données de l'Observatoire sont supprimées avec les tables.
--   Avant exécution en production : exporter les tables pheno_* (pg_dump
--   --table 'public.pheno_*') et conserver l'export.
-- Les fichiers du bucket « pheno-preuves » ne sont PAS supprimés par ce
--   script (suppression par l'API Storage, décision séparée du BM). Le
--   bucket reste privé et sans politique : inaccessible.
-- REJOUABLE : oui (if exists partout).
-- =====================================================================
begin;

drop view if exists public.pheno_v_qualite;
drop view if exists public.pheno_v_c_cumulatif_cluster;
drop view if exists public.pheno_v_c_cumulatif;
drop view if exists public.pheno_v_champ_semaine;

drop policy if exists pheno_preuves_depot on storage.objects;
drop policy if exists pheno_preuves_lecture on storage.objects;

drop function if exists public.pheno_observateurs_du_cluster();
drop function if exists public.pheno_correction_decider(uuid, text, text);
drop function if exists public.pheno_visite_valider(uuid, integer);
drop function if exists public.pheno_visite_demander_correction(uuid, text, integer);
drop function if exists public.pheno_visite_verifier(uuid, integer);
drop function if exists public.pheno_sync_batch(jsonb);
drop function if exists public.pheno_affectation_revoquer(uuid, text);
drop function if exists public.pheno_affectation_accorder(jsonb);
drop function if exists public.pheno_panel_definir_probabilites(uuid, numeric, numeric, text);
drop function if exists public.pheno_reserve_activer(uuid, text);
drop function if exists public.pheno_arbre_marquer(jsonb);
drop function if exists public.pheno_bloc_inventorier(jsonb);
drop function if exists public.pheno_panel_installer(jsonb);
drop function if exists private.pheno_visite_pour_decision(uuid, integer);
drop function if exists private.pheno_recalculer_evenements(uuid);
drop function if exists private.pheno_visite_enregistrer(jsonb);
drop function if exists private.pheno_visite_controler(uuid);
drop function if exists private.pheno_obs_demande(jsonb);
drop function if exists private.pheno_obs_valeurs(public.pheno_observations);
drop function if exists private.pheno_tirer_arbres(uuid);
drop function if exists private.pheno_campagne_ouverte(uuid);
drop function if exists private.pheno_journaliser(text, text, uuid, text, jsonb, jsonb, text);
drop function if exists private.pheno_arbre_id(uuid, integer);
drop function if exists private.pheno_tirage(text, integer, integer);
drop function if exists private.pheno_hex(text);

drop table if exists private.pheno_sync_recus;
drop table if exists public.pheno_journal;
drop table if exists public.pheno_evenements_maturite;
drop table if exists public.pheno_corrections;
drop table if exists public.pheno_observations;
drop table if exists public.pheno_visites;
drop table if exists public.pheno_affectations;
drop table if exists public.pheno_arbres;
drop table if exists public.pheno_blocs;
drop table if exists public.pheno_panels;
drop table if exists public.pheno_protocoles;

drop function if exists private.pheno_journal_immuable();
drop function if exists private.pheno_preuve_autorisee(text, text);
drop function if exists private.pheno_uuid_ou_null(text);
drop function if exists private.pheno_peut_lire_visite(uuid);
drop function if exists private.pheno_peut_lire_panel(uuid);
drop function if exists private.pheno_cluster_du_panel(uuid);
drop function if exists private.pheno_peut_valider(uuid, text);
drop function if exists private.pheno_peut_verifier(uuid, text);
drop function if exists private.pheno_a_affectation(uuid, text, text[]);
drop function if exists private.pheno_peut_collecter(text);
drop function if exists private.pheno_peut_lire_cluster(text);
drop function if exists private.pheno_ma_zone();
drop function if exists private.pheno_mon_cluster();
drop function if exists private.pheno_classe();
drop function if exists private.pheno_classe_de(uuid);

commit;
