-- Sacherie AFLP — droits de lecture des vues de pilotage (Control Tower)
-- Date : 2026-08-30
-- Contexte : l'onglet FIELD BUYING > Sacherie AFLP > Pilotage renvoyait
--   « permission denied for view sacherie_ct_global_stock ».
--
-- Cause : les quatre vues sacherie_ct_* n'ont jamais été décrites dans le
-- dépôt — elles n'existaient que dans la base. Leurs privilèges ont donc
-- dérivé sans trace : `authenticated` n'avait pas SELECT, et PostgREST
-- refusait la lecture à tout utilisateur connecté.
--
-- Posture de sécurité (SECURITE.md) : ces vues restent en security_invoker,
-- donc les RLS des tables sous-jacentes (rcn_jute_*) continuent de filtrer
-- ligne à ligne selon l'utilisateur. Le GRANT ouvre la vue, pas les données.
-- `anon` ne doit jamais lire la sacherie : la clé publique est visible dans
-- les pages, un SELECT accordé à `anon` exposerait le stock à qui la lit.
--
-- Migration idempotente : elle peut être rejouée sans effet de bord.
-- Elle couvre les QUATRE vues critiques, pas seulement les deux qui ont
-- déclenché l'incident — cluster_stock et rt_stock alimentent le même écran
-- et dériveraient de la même façon.

begin;

alter view public.sacherie_ct_global_stock      set (security_invoker = true);
alter view public.sacherie_ct_cluster_stock     set (security_invoker = true);
alter view public.sacherie_ct_rt_stock          set (security_invoker = true);
alter view public.sacherie_ct_latest_inventory  set (security_invoker = true);

revoke all on public.sacherie_ct_global_stock      from anon;
revoke all on public.sacherie_ct_cluster_stock     from anon;
revoke all on public.sacherie_ct_rt_stock          from anon;
revoke all on public.sacherie_ct_latest_inventory  from anon;

grant select on public.sacherie_ct_global_stock      to authenticated;
grant select on public.sacherie_ct_cluster_stock     to authenticated;
grant select on public.sacherie_ct_rt_stock          to authenticated;
grant select on public.sacherie_ct_latest_inventory  to authenticated;

commit;

-- --------------------------------------------------------------------------
-- Vérification (à exécuter après la migration ; ne modifie rien).
-- Attendu : quatre lignes, invoker = t, auth_select = t, anon_select = f.
-- --------------------------------------------------------------------------
-- select c.relname,
--        (c.reloptions::text like '%security_invoker=true%') as invoker,
--        has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
--        has_table_privilege('anon',          c.oid, 'SELECT') as anon_select
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relname in ('sacherie_ct_global_stock','sacherie_ct_cluster_stock',
--                      'sacherie_ct_rt_stock','sacherie_ct_latest_inventory')
--  order by 1;

-- --------------------------------------------------------------------------
-- ops_bag_releases : AUCUNE modification de schéma.
-- --------------------------------------------------------------------------
-- Le second incident (« column ops_bag_releases.created_at does not exist »)
-- est un défaut de code, pas de base. La colonne canonique de la sortie
-- physique est `released_at` (not null, défaut now()) ; la table n'a jamais
-- porté de `created_at`. On corrige l'appelant (operations/field-buying.js) ;
-- on n'ajoute pas une colonne de compatibilité : deux horodatages pour un
-- même fait finiraient par diverger, et un audit de sacherie ne peut pas
-- s'appuyer sur une date dont on ignore laquelle fait foi.
