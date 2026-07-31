-- =============================================================================
-- LBA Control · 2400 · Fermeture de la surface d'exécution face à PUBLIC
-- =============================================================================
-- PostgreSQL accorde `EXECUTE` à `PUBLIC` sur **toute** fonction créée. Ce droit
-- intégré ne peut pas être neutralisé par `ALTER DEFAULT PRIVILEGES … REVOKE …
-- FROM PUBLIC` : cette forme n'annule que ce qu'un `GRANT` par défaut avait
-- ajouté. La migration 1900 l'affirmait ; c'était faux, et l'audit du catalogue
-- l'a démontré dès que de nouvelles fonctions sont apparues.
--
-- La seule fermeture fiable est une révocation explicite exécutée **après** la
-- création de la dernière fonction. D'où ce fichier, et d'où son rang.
--
-- ⚠ Toute migration ajoutant une fonction doit répéter cette révocation à sa
-- fin — c'est ce que font les migrations 2500 à 2900. Le test
-- `tests/db/security-audit.test.ts` échoue si la règle est enfreinte : il
-- vérifie qu'aucune fonction de `app` ou `public` n'est atteignable par `anon`.
--
-- ⚠ Cette révocation ne suffit PAS sur un projet Supabase hébergé, qui accorde
-- en plus un droit nominatif à `anon` sur chaque fonction créée dans `public`.
-- `PUBLIC` et `anon` sont deux titulaires distincts : révoquer l'un ne retire
-- pas l'autre. C'est l'objet de la migration 3000.
-- =============================================================================

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app    to authenticated, service_role;

-- `anon` ne doit atteindre ni le schéma interne ni ses fonctions.
revoke all on schema app from anon;
