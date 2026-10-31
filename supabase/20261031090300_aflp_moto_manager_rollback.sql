-- =====================================================================
-- ANAGROCI FBMS — AFLP MOTO MANAGER : RETOUR ARRIÈRE
-- Fichier : supabase/20261031090300_aflp_moto_manager_rollback.sql
--
-- STATUT : NON APPLIQUÉ. À exécuter UNIQUEMENT sur décision du Branch Manager.
--
-- Deux niveaux, dans cet ordre :
--   NIVEAU 1 (non destructif, toujours possible) : coupe toutes les écritures
--     et toute lecture applicative. Les données restent intactes.
--   NIVEAU 2 (destructif) : supprime le module. REFUSE de s'exécuter si une
--     table moto_* contient des données réelles : aucune donnée n'est
--     supprimée par ce script. Archiver d'abord (pg_dump des tables moto_*).
--
-- Usage : exécuter le bloc NIVEAU 1 seul ; le bloc NIVEAU 2 seulement si
-- le module n'a jamais été utilisé en production.
-- =====================================================================

-- ----------------------------- NIVEAU 1 ------------------------------
begin;
do $$
declare f record; t record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'moto\_%'
  loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname like 'moto\_%' and c.relkind in ('r','v')
  loop
    execute format('revoke select on public.%I from authenticated', t.relname);
  end loop;
end $$;
drop policy if exists moto_documents_depot on storage.objects;
drop policy if exists moto_documents_consultation on storage.objects;
commit;

-- ----------------------------- NIVEAU 2 ------------------------------
-- Décommenter et exécuter séparément, après archivage, si et seulement si
-- le module n'a jamais porté de données réelles.
/*
begin;
do $$
declare t text; n bigint;
begin
  foreach t in array array['moto_motos','moto_documents','moto_affectations','moto_controles','moto_releves_km',
    'moto_immobilisations','moto_budgets','moto_dotations','moto_carburant','moto_restitutions','moto_remboursements',
    'moto_corrections','moto_maintenances','moto_pneus','moto_pneu_poses','moto_pneu_reparations','moto_incidents',
    'moto_incident_etapes','moto_formation_resultats','moto_operations']
  loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then raise exception 'REFUS : la table % contient % ligne(s). Archivez puis décidez explicitement.', t, n; end if;
  end loop;
  if exists (select 1 from storage.objects where bucket_id = 'moto-documents') then
    raise exception 'REFUS : le bucket moto-documents contient des fichiers.';
  end if;
end $$;
drop view if exists public.moto_v_formation, public.moto_v_qualite_donnees, public.moto_v_pneus, public.moto_v_alertes_documents,
  public.moto_v_echeances, public.moto_v_disponibilite, public.moto_v_cout_km, public.moto_v_couts, public.moto_v_rapprochement,
  public.moto_v_conso_moto, public.moto_v_conso_intervalles, public.moto_v_flotte cascade;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname like 'moto\_%'
  loop execute format('drop function if exists %s cascade', f.sig); end loop;
end $$;
drop table if exists public.moto_journal, public.moto_operations, public.moto_formation_resultats, public.moto_incident_etapes,
  public.moto_incidents, public.moto_pneu_reparations, public.moto_pneu_poses, public.moto_pneus, public.moto_maintenances,
  public.moto_regles_maintenance, public.moto_corrections, public.moto_remboursements, public.moto_restitutions,
  public.moto_carburant, public.moto_dotations, public.moto_budgets, public.moto_immobilisations, public.moto_releves_km,
  public.moto_controles, public.moto_affectations, public.moto_documents, public.moto_motos, public.moto_parametres cascade;
drop sequence if exists public.moto_code_seq;
delete from storage.buckets where id = 'moto-documents';
commit;
*/
