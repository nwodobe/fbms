-- Retour arrière des écritures de données du 25/10/2026 (lots REG-AFLP-A et REG-AFLP-B).
-- À exécuter avec un rôle d'administration (service_role / SQL editor), après export.
-- Les suppressions sont journalisées par farmer_registry_audit_trigger dans farmer_change_log.
-- Sauvegarde de référence : schéma backup_avant_regularisation_aflp_20261025 (non exposé).

begin;
-- Contrôle préalable : seules les lignes des lots sont visées.
select count(*) as parcelles_lot_a from public.farmer_plots where notes like 'REG-AFLP-A-20261025%';           -- attendu : 179
select count(*) as attestations_lot_b from public.farmer_participation_attestations
 where executed_by_note like '%REG-AFLP-B-20261025%';                                                      -- attendu : 160

-- Lot A : parcelles provisoires « EXPLOITATION DÉCLARÉE · À VÉRIFIER ».
-- Ne supprimer que celles restées intactes (aucune modification terrain depuis la migration).
delete from public.farmer_plots
 where notes like 'REG-AFLP-A-20261025%' and record_version = 1;

-- Lot B : attestations rétrospectives du Branch Manager.
delete from public.farmer_participation_attestations
 where executed_by_note like '%REG-AFLP-B-20261025%';

-- Contrôle : producteurs strictement identiques à la sauvegarde.
select (select md5(string_agg(id||':'||md5(data::text)||':'||record_version, ',' order by id)) from public.producteurs)
     = (select empreinte_producteurs from backup_avant_regularisation_aflp_20261025._manifest) as producteurs_inchanges;
-- commit;   -- décommenter après vérification des compteurs
rollback;
