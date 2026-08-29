/* FIELD BUYING — bootstrap performance.
   Réconciliation : ce fichier réécrivait les requêtes Supabase du moteur
   en interceptant createClient et en substituant des listes de colonnes
   par correspondance de chaînes exactes — un couplage qui casse dès que le
   moteur change une colonne. Les optimisations vivent dans le moteur
   unique operations/field-buying.js : cache mémoire FBStore (TTL 45 s),
   déduplication des requêtes en vol, invalidation ciblée, chargement de
   base en Promise.all et préchargement en requestIdleCallback.
   Ce fichier reste présent car la CI vérifie sa syntaxe, mais n'est plus
   chargé par field-buying.html et ne fait rien. */
(function () {
'use strict';
})();
