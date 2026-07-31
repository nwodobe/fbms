-- =============================================================================
-- LBA Control · 3000 · Fermeture de la surface d'exécution face à `anon`
-- =============================================================================
-- Écart trouvé au déploiement sur un projet Supabase hébergé, et invisible en
-- local — c'est tout l'intérêt de l'avoir cherché là-bas.
--
-- Les migrations 1900 à 2900 fermaient la surface d'exécution en révoquant
-- `EXECUTE` à `PUBLIC`. Sur la base de test locale, cela suffisait : plus
-- personne ne pouvait atteindre les relais publics sans être `authenticated`.
--
-- Un projet Supabase hébergé ajoute une règle que la base locale n'a pas :
--
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- Chaque fonction créée dans `public` reçoit donc un GRANT **nominatif** à
-- `anon`. Révoquer `PUBLIC` ne le retire pas — ce sont deux droits distincts.
-- Résultat : les 43 relais publics du produit étaient appelables sans être
-- connecté, par `/rest/v1/rpc/<nom>` avec la seule clé publiable.
--
-- Aucun n'aurait rendu de donnée : tous commencent par résoudre le tenant, et
-- un appelant anonyme n'en a pas. Mais la migration 2400 promettait mieux que
-- « la fonction refuse » — elle promettait « la fonction est inatteignable ».
-- La première garantie dépend de chaque implémentation, la seconde du droit
-- d'accès. C'est la seconde qu'on rétablit ici.
--
-- Deux gestes, indissociables :
--
--   1. révoquer le droit sur les fonctions DÉJÀ créées ;
--   2. neutraliser le privilège par défaut, sans quoi la prochaine fonction
--      écrite rouvrirait la porte sans que personne ne le remarque.
--
-- ⚠ Les fonctions apportées par les extensions (`btree_gist`, `pgcrypto`,
-- `uuid-ossp`…) sont laissées telles quelles : elles ne sont pas à nous, elles
-- n'exposent aucune donnée du produit, et les toucher ferait diverger le
-- schéma de ce que Supabase gère lui-même.
-- =============================================================================

do $$
declare
  v_fn      record;
  v_revoked integer := 0;
begin
  for v_fn in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      -- `deptype = 'e'` marque ce qui appartient à une extension.
      left join pg_depend d
        on d.objid = p.oid
       and d.classid = 'pg_proc'::regclass
       and d.deptype = 'e'
     where n.nspname in ('app', 'public')
       and d.objid is null
       and pg_get_userbyid(p.proowner) = current_user
  loop
    execute format('revoke execute on function %s from anon', v_fn.signature);
    v_revoked := v_revoked + 1;
  end loop;

  raise notice 'EXECUTE révoqué à anon sur % fonction(s) du produit.', v_revoked;
end
$$;

-- Privilège par défaut : la forme REVOKE annule ici un GRANT par défaut réel
-- (celui posé par Supabase), et non le droit intégré de PostgreSQL. Elle est
-- donc efficace — contrairement au cas de `PUBLIC` documenté en migration 2400.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema app    revoke execute on functions from anon;

-- Rappelé plutôt que supposé : sans USAGE, le contenu du schéma interne est
-- inatteignable même si un droit d'exécution réapparaissait par accident.
revoke all on schema app from anon;

-- -----------------------------------------------------------------------------
-- Chemin de recherche de app.score_weight
-- -----------------------------------------------------------------------------
-- Seule fonction du produit sans `search_path` figé. Elle ne lit aucune table,
-- mais son argument est une énumération : la résolution du type dépend donc du
-- chemin de l'appelant. Le figer coûte une ligne et supprime la question.

create or replace function app.score_weight(p_component score_component_code)
returns numeric
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_component
    when 'couverture_avances'      then 20
    when 'respect_delais'          then 15
    when 'ecarts_poids'            then 15
    when 'respect_prix'            then 10
    when 'qualite'                 then 10
    when 'fiabilite_justificatifs' then 10
    when 'gestion_sacs'            then 5
    when 'regularite'              then 5
    when 'maitrise_tcb'            then 10
  end::numeric;
$$;

-- La fonction vient d'être recréée : elle a repris le droit par défaut, que la
-- révocation ci-dessus ne pouvait pas anticiper.
revoke execute on function app.score_weight(score_component_code) from anon, public;
grant  execute on function app.score_weight(score_component_code) to authenticated, service_role;
