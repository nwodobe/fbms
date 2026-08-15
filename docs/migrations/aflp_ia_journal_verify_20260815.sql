-- ============================================================================
--  CONTRÔLE APRÈS MIGRATION — Assistant IA AFLP, journal et catalogue
--  Fichier : docs/migrations/aflp_ia_journal_verify_20260815.sql
--  ----------------------------------------------------------------------------
--  À exécuter dans Supabase → SQL Editor JUSTE APRÈS
--  docs/migrations/aflp_ia_journal_20260815.sql.
--
--  Chaque bloc renvoie une colonne `verdict`. Tout autre résultat que
--  « CONFORME » est un défaut à traiter AVANT d'ouvrir l'interface
--  d'administration aux utilisateurs.
--
--  Ce script LIT uniquement. Il ne modifie rien.
-- ============================================================================

-- 1. Les six tables existent -------------------------------------------------
select 'Tables créées' as controle,
       case when count(*) = 6 then 'CONFORME'
            else 'DÉFAUT : ' || count(*) || '/6 tables présentes' end as verdict,
       string_agg(table_name, ', ' order by table_name) as detail
from information_schema.tables
where table_schema = 'public'
  and table_name in ('aflp_ia_questions','aflp_ia_feedback','aflp_ia_catalogue_versions',
                     'aflp_ia_intentions','aflp_ia_formulations','aflp_ia_audit');

-- 2. RLS activée sur TOUTES les tables exposées ------------------------------
--    Une table de journal sans RLS est une table publique : la clé Supabase
--    anonyme est en clair dans les pages du site.
select 'RLS activée' as controle,
       case when bool_and(rowsecurity) then 'CONFORME'
            else 'DÉFAUT : RLS absente sur ' ||
                 string_agg(tablename, ', ') filter (where not rowsecurity) end as verdict
from pg_tables
where schemaname = 'public'
  and tablename in ('aflp_ia_questions','aflp_ia_feedback','aflp_ia_catalogue_versions',
                    'aflp_ia_intentions','aflp_ia_formulations','aflp_ia_audit');

-- 3. Aucune politique ouverte sans prédicat ----------------------------------
--    « TO authenticated USING (true) » signifie : tout compte connecté lit
--    tout. C'est le défaut le plus fréquent et le plus coûteux.
select 'Politiques sans prédicat' as controle,
       case when count(*) = 0 then 'CONFORME'
            else 'DÉFAUT : ' || string_agg(policyname, ', ') end as verdict
from pg_policies
where schemaname = 'public'
  and tablename like 'aflp_ia_%'
  and cmd in ('SELECT','UPDATE','DELETE')
  and (qual is null or btrim(qual) in ('true','(true)'));

-- 4. Toute politique UPDATE porte USING ET WITH CHECK ------------------------
select 'UPDATE avec USING et WITH CHECK' as controle,
       case when count(*) = 0 then 'CONFORME'
            else 'DÉFAUT : ' || string_agg(tablename || '.' || policyname, ', ') end as verdict
from pg_policies
where schemaname = 'public'
  and tablename like 'aflp_ia_%'
  and cmd = 'UPDATE'
  and (qual is null or with_check is null);

-- 5. Aucune politique n'est ouverte au rôle `anon` ---------------------------
select 'Aucun accès anonyme' as controle,
       case when count(*) = 0 then 'CONFORME'
            else 'DÉFAUT : ' || string_agg(tablename || '.' || policyname, ', ') end as verdict
from pg_policies
where schemaname = 'public'
  and tablename like 'aflp_ia_%'
  and 'anon' = any(roles);

-- 6. Le rôle `anon` n'a aucun privilège table --------------------------------
select 'Privilèges anon révoqués' as controle,
       case when count(*) = 0 then 'CONFORME'
            else 'DÉFAUT : ' || string_agg(distinct table_name || ':' || privilege_type, ', ') end as verdict
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'aflp_ia_%'
  and grantee = 'anon';

-- 7. Le journal ne peut pas être supprimé depuis le navigateur ---------------
select 'DELETE/TRUNCATE retirés à authenticated sur le journal' as controle,
       case when count(*) = 0 then 'CONFORME'
            else 'DÉFAUT : ' || string_agg(privilege_type, ', ') end as verdict
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'aflp_ia_questions'
  and grantee = 'authenticated'
  and privilege_type in ('DELETE','TRUNCATE');

-- 8. Les déclencheurs d'immutabilité et de figement sont en place ------------
select 'Déclencheurs' as controle,
       case when count(*) = 6 then 'CONFORME'
            else 'DÉFAUT : ' || count(*) || '/6 — ' ||
                 coalesce(string_agg(trigger_name, ', '), 'aucun') end as verdict
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in ('aflp_ia_q_no_update','aflp_ia_int_fige','aflp_ia_form_fige',
                       'aflp_ia_ver_transition','aflp_ia_int_audit','aflp_ia_form_audit');

-- 9. La vue de métriques respecte la RLS de l'appelant -----------------------
--    Sans `security_invoker`, la vue s'exécute avec les droits de son
--    propriétaire : elle exposerait le journal entier à tout compte connecté.
select 'Vue aflp_ia_metriques en security_invoker' as controle,
       case when exists (
              select 1 from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'aflp_ia_metriques'
                and c.reloptions::text like '%security_invoker=%true%'
            ) then 'CONFORME'
            else 'DÉFAUT : la vue contourne la RLS' end as verdict;

-- 10a. Aucun SECURITY DEFINER dans le schéma EXPOSÉ ---------------------------
--      `public` est publié par PostgREST : une fonction SECURITY DEFINER y est
--      appelable depuis le navigateur avec les droits de son propriétaire.
select 'Aucun SECURITY DEFINER dans public' as controle,
       case when count(*) = 0 then 'CONFORME'
            else 'DÉFAUT : ' || string_agg(p.proname, ', ') end as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'aflp_ia_%'
  and p.prosecdef;

-- 10b. Le seul SECURITY DEFINER toléré est encadré ---------------------------
--      Le déclencheur d'audit DOIT l'être : `aflp_ia_audit` n'ouvre aucune
--      politique INSERT, et une fonction de déclencheur ordinaire s'exécute
--      avec les droits de l'utilisateur. Sans SECURITY DEFINER, aucune
--      modification du catalogue n'est possible.
select 'Déclencheur d''audit encadré' as controle,
       case
         when p.oid is null then 'DÉFAUT : aflp_ia_interne.auditer() absente'
         when not p.prosecdef then 'DÉFAUT : la fonction n''est pas SECURITY DEFINER'
         when p.proconfig is null or not (p.proconfig::text like '%search_path%')
           then 'DÉFAUT : search_path non figé'
         when has_function_privilege('public', p.oid, 'execute')
           then 'DÉFAUT : EXECUTE encore accordé à PUBLIC'
         else 'CONFORME'
       end as verdict
from (select 1) x
left join pg_proc p on p.proname = 'auditer'
  and p.pronamespace = (select oid from pg_namespace where nspname = 'aflp_ia_interne');

-- 10c. Le schéma interne n'est pas exposé -------------------------------------
--      À VÉRIFIER AUSSI À LA MAIN : Supabase → Settings → API → « Exposed
--      schemas » ne doit contenir que `public` (et `graphql_public`). Cette
--      requête ne voit pas ce réglage, qui vit dans la configuration PostgREST.
select 'Droits sur le schéma interne' as controle,
       case when not has_schema_privilege('anon', 'aflp_ia_interne', 'usage')
             and not has_schema_privilege('authenticated', 'aflp_ia_interne', 'usage')
            then 'CONFORME'
            else 'DÉFAUT : usage accordé sur aflp_ia_interne' end as verdict
where exists (select 1 from pg_namespace where nspname = 'aflp_ia_interne');

-- 11. Idempotence : la clé de la file locale est unique ----------------------
select 'Unicité de cle_idempotence' as controle,
       case when exists (
              select 1 from pg_indexes
              where schemaname = 'public' and tablename = 'aflp_ia_questions'
                and indexdef ilike '%unique%cle_idempotence%'
            ) then 'CONFORME'
            else 'DÉFAUT : une question rejouée hors ligne pourrait compter deux fois' end as verdict;

-- 12. Version initiale du catalogue -----------------------------------------
select 'Version 1.0.0 publiée' as controle,
       case when exists (select 1 from public.aflp_ia_catalogue_versions
                         where version = '1.0.0' and statut = 'publie')
            then 'CONFORME' else 'DÉFAUT : version initiale absente ou non publiée' end as verdict;

-- 13. Rétention configurée ---------------------------------------------------
select 'Rétention du journal' as controle,
       case when to_regclass('public.parametres_calcul') is null then 'SANS OBJET (table absente)'
            when exists (select 1 from public.parametres_calcul where cle = 'aflp_ia_retention_jours')
            then 'CONFORME' else 'DÉFAUT : durée de rétention non configurée' end as verdict;

-- 14. Inventaire des politiques, pour relecture humaine ----------------------
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname = 'public' and tablename like 'aflp_ia_%'
order by tablename, cmd, policyname;
