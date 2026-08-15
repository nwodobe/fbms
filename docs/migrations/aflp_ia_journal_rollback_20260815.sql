-- ============================================================================
--  RETOUR ARRIÈRE — Assistant IA AFLP, journal et catalogue versionné
--  Fichier : docs/migrations/aflp_ia_journal_rollback_20260815.sql
--  ----------------------------------------------------------------------------
--  ⚠ CE SCRIPT DÉTRUIT DES DONNÉES. Lire les trois paragraphes suivants avant
--  de l'exécuter.
--
--  IL N'EST PAS LE RETOUR ARRIÈRE NORMAL.
--  La migration `aflp_ia_journal_20260815.sql` est ADDITIVE : elle ne touche à
--  aucune table existante, n'ajoute aucune colonne ailleurs, ne renomme ni ne
--  supprime rien. Le frontend teste la présence des tables et se désactive
--  proprement si elles sont absentes (shared/aflp-ia-journal.js). Revenir en
--  arrière NE DEMANDE DONC AUCUN SQL : il suffit de rétablir la version
--  précédente du frontend. Les tables restent, inertes et sans coût.
--
--  LE CHEMIN RECOMMANDÉ EN CAS D'INCIDENT, dans cet ordre :
--    1. couper la journalisation côté client — `AFLP_IA_JOURNAL.arreter()` ou
--       le drapeau `aflp_ia_journal_actif` de `parametres_calcul` à 'false' ;
--    2. si nécessaire, rétablir le dernier commit frontend stable ;
--    3. NE RIEN SUPPRIMER. Un journal effacé après un incident, c'est
--       l'incident sans ses traces.
--
--  N'EXÉCUTER CE SCRIPT QUE si le Branch Manager demande explicitement la
--  suppression du dispositif, et APRÈS export du journal et de l'audit.
--
--  Export préalable (à faire AVANT, depuis l'éditeur SQL) :
--    select * from public.aflp_ia_questions order by created_at;
--    select * from public.aflp_ia_feedback  order by created_at;
--    select * from public.aflp_ia_audit     order by cree_le;
-- ============================================================================

begin;

-- 1. Vue --------------------------------------------------------------------
drop view if exists public.aflp_ia_metriques;

-- 2. Déclencheurs ------------------------------------------------------------
drop trigger if exists aflp_ia_q_no_update     on public.aflp_ia_questions;
drop trigger if exists aflp_ia_int_fige        on public.aflp_ia_intentions;
drop trigger if exists aflp_ia_form_fige       on public.aflp_ia_formulations;
drop trigger if exists aflp_ia_ver_transition  on public.aflp_ia_catalogue_versions;
drop trigger if exists aflp_ia_int_audit       on public.aflp_ia_intentions;
drop trigger if exists aflp_ia_form_audit      on public.aflp_ia_formulations;
drop trigger if exists aflp_ia_audit_no_update on public.aflp_ia_audit;

-- 3. Tables, dans l'ordre des dépendances ------------------------------------
drop table if exists public.aflp_ia_formulations;
drop table if exists public.aflp_ia_intentions;
drop table if exists public.aflp_ia_feedback;
drop table if exists public.aflp_ia_questions;
drop table if exists public.aflp_ia_catalogue_versions;
drop table if exists public.aflp_ia_audit;

-- 4. Fonctions de déclencheur ------------------------------------------------
drop function if exists public.aflp_ia_questions_immuables();
drop function if exists public.aflp_ia_catalogue_fige();
drop function if exists public.aflp_ia_version_transition();
drop function if exists public.aflp_ia_auditer();
drop function if exists public.aflp_ia_audit_immuable();

-- 5. Paramètre de rétention --------------------------------------------------
--    Retiré seulement s'il n'a pas été modifié depuis l'installation : une
--    valeur choisie par un humain n'est pas à nous.
do $$
begin
  if to_regclass('public.parametres_calcul') is not null then
    delete from public.parametres_calcul
    where cle = 'aflp_ia_retention_jours' and valeur = '180';
  end if;
end
$$;

commit;

-- Après ce script, l'assistant continue de répondre : le moteur déterministe,
-- le catalogue et les métriques locales ne dépendent d'aucune de ces tables.
-- Seules la journalisation serveur et l'interface d'administration s'arrêtent.
