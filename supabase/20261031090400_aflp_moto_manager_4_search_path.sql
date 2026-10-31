-- =====================================================================
-- ANAGROCI FBMS — AFLP MOTO MANAGER (4/4) : search_path figé sur les
-- fonctions utilitaires (avertissement « function_search_path_mutable »
-- du conseiller de sécurité Supabase, relevé après application le
-- 31/10/2026). Aucun changement de comportement : toutes ces fonctions
-- qualifient déjà leurs références.
-- STATUT : APPLIQUÉE EN PRODUCTION le 31/10/2026.
-- =====================================================================
begin;
alter function private.moto_champ_corrigeable(text, text, text) set search_path = public, private, pg_temp;
alter function private.moto_erreur(text) set search_path = public, private, pg_temp;
alter function private.moto_items_valides(jsonb) set search_path = public, private, pg_temp;
alter function private.moto_journal_immuable() set search_path = public, private, pg_temp;
alter function private.moto_motif(text, integer) set search_path = public, private, pg_temp;
alter function private.moto_num(jsonb, text) set search_path = public, private, pg_temp;
alter function private.moto_refus(text) set search_path = public, private, pg_temp;
alter function private.moto_uuid(jsonb, text) set search_path = public, private, pg_temp;
alter function private.moto_uuid_ou_null(text) set search_path = public, private, pg_temp;
commit;
