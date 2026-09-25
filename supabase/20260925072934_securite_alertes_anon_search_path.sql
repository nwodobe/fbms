-- FBMS · vérification du 25/09/2026 · alertes Supabase (non destructif)
-- 1) 5 fonctions SECURITY DEFINER exécutables par le rôle anon (non
--    connecté). Aucune n'est utile sans connexion : les politiques RLS qui
--    les appellent sont réservées à authenticated, deux sont des fonctions
--    de déclencheur (le privilège EXECUTE n'est pas vérifié au déclenchement).
--    On retire EXECUTE à PUBLIC et anon ; authenticated et service_role
--    conservent leur droit explicite.
-- 2) 2 fonctions de déclencheur sans search_path figé : on fixe
--    search_path (elles n'utilisent que des fonctions de pg_catalog).
revoke execute on function public.peut_modifier_rt_producteur() from public, anon;
revoke execute on function public.portee_terrain_globale() from public, anon;
revoke execute on function public.procurement_apply_field_purchase_rule() from public, anon;
revoke execute on function public.procurement_capture_rejection() from public, anon;
revoke execute on function public.sacherie_ops_closure_readiness(text, text) from public, anon;
grant execute on function public.peut_modifier_rt_producteur() to authenticated, service_role;
grant execute on function public.portee_terrain_globale() to authenticated, service_role;
grant execute on function public.procurement_apply_field_purchase_rule() to authenticated, service_role;
grant execute on function public.procurement_capture_rejection() to authenticated, service_role;
grant execute on function public.sacherie_ops_closure_readiness(text, text) to authenticated, service_role;
alter function public.fb_preserve_media_rt() set search_path = pg_catalog, public;
alter function public.fb_preserve_media_villages() set search_path = pg_catalog, public;
