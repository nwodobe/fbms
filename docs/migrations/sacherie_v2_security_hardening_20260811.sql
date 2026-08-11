-- FBMS / AFLP 2027 - Sacherie V2 security hardening
-- A executer APRES sacherie_v2_mvp_20260811.sql.
-- Objectif : supprimer tout EXECUTE anonyme sur les fonctions SECURITY DEFINER
-- et fixer le search_path de la fonction utilitaire.

begin;

-- Le helper immutable doit lui aussi avoir un search_path explicite.
alter function public.sacherie_code_cluster(text) set search_path = public;

-- Les fonctions historiques utilisées par les policies restent disponibles aux
-- utilisateurs authentifies, mais jamais a anon.
revoke execute on function public.est_actif() from anon;
revoke execute on function public.est_bm() from anon;

-- Aucun RPC Sacherie V2 n'est anonyme.
revoke execute on function public.sacherie_mon_contexte() from public, anon;
revoke execute on function public.sacherie_calculer_plafond(text,text,numeric) from public, anon;
revoke execute on function public.sacherie_configurer_cycle(uuid,text,numeric,numeric) from public, anon;
revoke execute on function public.sacherie_cloturer_cycle(text) from public, anon;
revoke execute on function public.sacherie_creer_demande(text,text,text,numeric,integer) from public, anon;
revoke execute on function public.sacherie_decider_demande(uuid,text,integer,text) from public, anon;
revoke execute on function public.sacherie_executer_demande(uuid,integer,text,text) from public, anon;

-- Helpers internes : pas d'exposition anonyme.
revoke execute on function public.peut_demander_sacherie() from public, anon;
revoke execute on function public.peut_executer_sacherie(text) from public, anon;
revoke execute on function public.sacherie_peut_lire_demande(text,text,uuid) from public, anon;
revoke execute on function public.sacherie_sacs_sous_responsabilite_rt(text) from public, anon;
revoke execute on function public.sacherie_stock_cluster(text) from public, anon;
revoke execute on function public.sacherie_reservations_rt(text,uuid) from public, anon;
revoke execute on function public.sacherie_assign_cycle_achat() from public, anon;
revoke execute on function public.sacherie_guard_mouvement() from public, anon;
revoke execute on function public.sacherie_code_cluster(text) from public, anon;

-- API explicitement autorisee pour les utilisateurs connectes.
grant execute on function public.sacherie_mon_contexte() to authenticated;
grant execute on function public.sacherie_calculer_plafond(text,text,numeric) to authenticated;
grant execute on function public.sacherie_configurer_cycle(uuid,text,numeric,numeric) to authenticated;
grant execute on function public.sacherie_cloturer_cycle(text) to authenticated;
grant execute on function public.sacherie_creer_demande(text,text,text,numeric,integer) to authenticated;
grant execute on function public.sacherie_decider_demande(uuid,text,integer,text) to authenticated;
grant execute on function public.sacherie_executer_demande(uuid,integer,text,text) to authenticated;

-- Fonctions necessaires aux policies RLS.
grant execute on function public.est_actif() to authenticated;
grant execute on function public.est_bm() to authenticated;
grant execute on function public.sacherie_peut_lire_demande(text,text,uuid) to authenticated;

commit;
