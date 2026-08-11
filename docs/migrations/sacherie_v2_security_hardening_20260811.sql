-- FBMS / AFLP 2027 - Sacherie V2 security hardening
-- A executer APRES sacherie_v2_mvp_20260811.sql.
-- Objectif : supprimer tout EXECUTE anonyme, limiter les helpers internes et
-- fixer le search_path de la fonction utilitaire.

begin;

alter function public.sacherie_code_cluster(text) set search_path = public;

-- Fonctions historiques utilisées par les policies : jamais anonymes.
revoke execute on function public.est_actif() from anon;
revoke execute on function public.est_bm() from anon;

-- Supprimer les droits hérités de PUBLIC sur tous les objets Sacherie V2.
revoke execute on function public.sacherie_mon_contexte() from public, anon;
revoke execute on function public.sacherie_calculer_plafond(text,text,numeric) from public, anon;
revoke execute on function public.sacherie_configurer_cycle(uuid,text,numeric,numeric) from public, anon;
revoke execute on function public.sacherie_cloturer_cycle(text) from public, anon;
revoke execute on function public.sacherie_creer_demande(text,text,text,numeric,integer) from public, anon;
revoke execute on function public.sacherie_decider_demande(uuid,text,integer,text) from public, anon;
revoke execute on function public.sacherie_executer_demande(uuid,integer,text,text) from public, anon;
revoke execute on function public.peut_demander_sacherie() from public, anon;
revoke execute on function public.peut_executer_sacherie(text) from public, anon;
revoke execute on function public.sacherie_peut_lire_demande(text,text,uuid) from public, anon;
revoke execute on function public.sacherie_sacs_sous_responsabilite_rt(text) from public, anon;
revoke execute on function public.sacherie_stock_cluster(text) from public, anon;
revoke execute on function public.sacherie_reservations_rt(text,uuid) from public, anon;
revoke execute on function public.sacherie_assign_cycle_achat() from public, anon;
revoke execute on function public.sacherie_guard_mouvement() from public, anon;
revoke execute on function public.sacherie_code_cluster(text) from public, anon;

-- Helpers internes : pas d'appel direct par les utilisateurs connectés.
-- Les RPC SECURITY DEFINER et les triggers les appellent avec les droits du propriétaire.
revoke execute on function public.peut_demander_sacherie() from authenticated;
revoke execute on function public.peut_executer_sacherie(text) from authenticated;
revoke execute on function public.sacherie_sacs_sous_responsabilite_rt(text) from authenticated;
revoke execute on function public.sacherie_stock_cluster(text) from authenticated;
revoke execute on function public.sacherie_reservations_rt(text,uuid) from authenticated;
revoke execute on function public.sacherie_assign_cycle_achat() from authenticated;
revoke execute on function public.sacherie_guard_mouvement() from authenticated;
revoke execute on function public.sacherie_code_cluster(text) from authenticated;

-- API explicitement exposée aux utilisateurs connectés.
grant execute on function public.sacherie_mon_contexte() to authenticated;
grant execute on function public.sacherie_calculer_plafond(text,text,numeric) to authenticated;
grant execute on function public.sacherie_configurer_cycle(uuid,text,numeric,numeric) to authenticated;
grant execute on function public.sacherie_cloturer_cycle(text) to authenticated;
grant execute on function public.sacherie_creer_demande(text,text,text,numeric,integer) to authenticated;
grant execute on function public.sacherie_decider_demande(uuid,text,integer,text) to authenticated;
grant execute on function public.sacherie_executer_demande(uuid,integer,text,text) to authenticated;

-- Fonctions nécessaires aux policies RLS.
grant execute on function public.est_actif() to authenticated;
grant execute on function public.est_bm() to authenticated;
grant execute on function public.sacherie_peut_lire_demande(text,text,uuid) to authenticated;

commit;
