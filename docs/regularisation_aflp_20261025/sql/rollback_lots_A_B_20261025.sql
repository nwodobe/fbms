-- =============================================================================
-- Procédure SÛRE d'annulation / restauration des lots du 25/10/2026
-- Remplace l'ancien script à base de DELETE (retiré le 25/10/2026 : il pouvait
-- effacer des lignes complétées ultérieurement et n'était pas réversible).
--
-- Principes :
--  * aucune suppression physique : lot A = désactivation (deleted = true, status INACTIVE),
--    lot B = retrait (status WITHDRAWN) ;
--  * seules les lignes STRICTEMENT identiques à leur état initial figé
--    (regularisation_aflp.lot_a_etat_initial / lot_b_etat_initial) sont touchées ;
--    une parcelle complétée sur le terrain ou une attestation modifiée est exclue et journalisée ;
--  * chaque action est tracée dans regularisation_aflp.journal_annulation (avant / après)
--    et dans farmer_change_log ;
--  * restauration symétrique, elle aussi conditionnée à l'absence de modification intermédiaire ;
--  * exécution réservée au Branch Manager (p_acteur), motif obligatoire, simulation par défaut.
-- Fonctions créées par la migration regularisation_aflp_etat_initial_et_annulation_sure_20261025
-- (schéma interne regularisation_aflp, non exposé à l'API).
-- Testé le 25/10/2026 en transaction annulée : 178/179 désactivées, 1 parcelle modifiée préservée,
-- 0 DELETE, restauration 178/178 identique (hors horodatage), producteurs inchangés.
-- =============================================================================

-- 1. Simulation (aucune écriture) : combien de lignes seraient annulées / exclues ?
select * from regularisation_aflp.annuler_lot_a('<UUID_BRANCH_MANAGER>', 'motif', false);
select * from regularisation_aflp.annuler_lot_b('<UUID_BRANCH_MANAGER>', 'motif', false);

-- 2. Exécution (dans une transaction, contrôler puis COMMIT)
begin;
select * from regularisation_aflp.annuler_lot_a('<UUID_BRANCH_MANAGER>', '<motif écrit de la décision>', true);
select * from regularisation_aflp.annuler_lot_b('<UUID_BRANCH_MANAGER>', '<motif écrit de la décision>', true);
select lot, action, count(*) from regularisation_aflp.journal_annulation group by 1, 2;
-- contrôle : producteurs strictement identiques à la sauvegarde
select (select md5(string_agg(id||':'||md5(data::text)||':'||record_version, ',' order by id)) from public.producteurs)
     = (select empreinte_producteurs from backup_avant_regularisation_aflp_20261025._manifest) as producteurs_inchanges;
-- commit;
rollback;

-- 3. Restauration (annule l'annulation)
begin;
select * from regularisation_aflp.restaurer_lot_a('<UUID_BRANCH_MANAGER>', '<motif>', true);
select * from regularisation_aflp.restaurer_lot_b('<UUID_BRANCH_MANAGER>', '<motif>', true);
-- commit;
rollback;

-- 4. Restauration des fiches producteurs depuis la sauvegarde (en cas d'altération accidentelle)
--    Ne touche que les dossiers dont data diffère de la sauvegarde. Testée en transaction annulée.
-- begin;
-- update public.producteurs p set data = b.data
--   from backup_avant_regularisation_aflp_20261025.producteurs b
--  where b.id = p.id and p.data is distinct from b.data;
-- commit;
