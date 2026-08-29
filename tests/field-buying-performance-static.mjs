/* Gardes statiques de performance FIELD BUYING — version réconciliée.
   L'ancien bootstrap réécrivait les requêtes Supabase du moteur par
   correspondance de chaînes de colonnes (couplage cassant) ; il doit
   rester inerte. Les provisions de performance vivent dans le moteur
   unique operations/field-buying.js et sont vérifiées ici. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const moteur = fs.readFileSync('operations/field-buying.js', 'utf8');
const stub = fs.readFileSync('operations/field-buying-performance-bootstrap.js', 'utf8');
const html = fs.readFileSync('operations/field-buying.html', 'utf8');

function has(re, msg) { assert.match(moteur, re, msg); }

assert.ok(!html.includes('field-buying-performance-bootstrap.js'),
  'le bootstrap d’interception ne doit plus être chargé');
assert.ok(!stub.includes('originalCreateClient') && !stub.includes('new Proxy'),
  'le fichier inerte ne doit plus intercepter createClient');

/* Cache mémoire avec TTL et déduplication des requêtes en vol. */
has(/var TTL = 45000/, 'TTL du cache mémoire attendu');
has(/if \(slot && slot\.promise\) return slot\.promise;/, 'déduplication des requêtes en vol attendue');
has(/invalidate: function/, 'invalidation ciblée du cache attendue');

/* Chargement de base parallèle et préchargement en période creuse. */
has(/Promise\.all\(\[/, 'chargement parallèle attendu');
has(/requestIdleCallback/, 'préchargement en requestIdleCallback attendu');

/* Un seul moteur chargé par la page. */
const scripts = (html.match(/field-buying[^"']*\.js/g) || []);
assert.deepEqual([...new Set(scripts)].map((s) => s.replace(/\?.*$/, '')),
  ['field-buying.js'], 'field-buying.html ne charge qu’un moteur FIELD BUYING');

console.log('field-buying-performance-static: OK (optimisations dans le moteur unique)');
