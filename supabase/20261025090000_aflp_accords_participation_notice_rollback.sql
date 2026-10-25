-- Retour arrière de 20261025090000_aflp_accords_participation_notice.sql
-- ATTENTION : supprime les attestations et remises de notice enregistrées.
-- Exporter d'abord : select * from public.farmer_participation_attestations;
--                    select * from public.farmer_notice_deliveries;
-- Le journal farmer_change_log conserve la trace des insertions.
drop view if exists public.farmer_regularisation_status_v;
drop table if exists public.farmer_notice_deliveries;
drop table if exists public.farmer_participation_attestations;
drop table if exists public.aflp_notice_versions;
