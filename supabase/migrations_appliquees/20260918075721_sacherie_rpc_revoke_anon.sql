-- =====================================================================
-- ENREGISTREMENT — NE PAS REJOUER EN PRODUCTION
-- Version      : 20260918075721
-- Nom          : sacherie_rpc_revoke_anon
-- Statut       : APPLIQUEE en production le 18/09/2026 07:57:21 UTC
-- Source       : copie verbatim de schema_migrations.statements (lecture seule)
-- Dependance   : suppose appliquees 20260918075629 (sacherie_inventory_periodicity)
--                et 20260918075652 (sacherie_movement_search), versionnees sur
--                la branche feat/sacherie-security-inventory-journal.
-- =====================================================================
-- Les deux RPC refusent deja un appel non authentifie ('Connexion requise'),
-- mais le droit par defaut accorde a `anon` n'a aucune raison d'exister :
-- on le retire pour que le catalogue dise la meme chose que le code.
revoke execute on function public.sacherie_ct_inventaires_dus(text, text, boolean) from anon;
revoke execute on function public.sacherie_search_movements(text,date,date,text,text,text,text,text,text,integer,timestamptz,text) from anon;
