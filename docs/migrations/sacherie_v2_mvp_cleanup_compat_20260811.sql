-- Sacherie V2 MVP - nettoyage de compatibilité
-- À exécuter APRES sacherie_v2_mvp_20260811.sql.
-- Sans effet sur les données. Supprime seulement les anciennes signatures de fonctions
-- qui pourraient subsister après une tentative antérieure du MVP.

begin;

-- Ancienne création de demande sans client_request_id : à supprimer pour éviter
-- un chemin non idempotent encore appelable par un client authentifié.
drop function if exists public.sacherie_creer_demande(text,text,numeric,integer);

-- Ancien helper d'exécution sans contrôle de cluster.
drop function if exists public.peut_executer_sacherie();

-- Les helpers internes ne sont pas des API publiques.
revoke all on function public.sacherie_code_cluster(text) from public;
revoke all on function public.peut_demander_sacherie() from public;
revoke all on function public.peut_executer_sacherie(text) from public;
revoke all on function public.sacherie_peut_lire_demande(text,text,uuid) from public;
revoke all on function public.sacherie_sacs_sous_responsabilite_rt(text) from public;
revoke all on function public.sacherie_stock_cluster(text) from public;
revoke all on function public.sacherie_reservations_rt(text,uuid) from public;
revoke all on function public.sacherie_assign_cycle_achat() from public;
revoke all on function public.sacherie_guard_mouvement() from public;

commit;
