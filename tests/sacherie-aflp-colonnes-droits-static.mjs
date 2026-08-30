/* Non-regression : FIELD BUYING > Sacherie AFLP.
   Deux incidents du 30/08/2026, tous deux invisibles a la lecture rapide :
   - Pilotage        : « permission denied for view sacherie_ct_global_stock »
   - Demandes/sorties: « column ops_bag_releases.created_at does not exist »
   Les deux tuaient TOUTE la rubrique, car bagsData() charge les dix requetes
   dans un seul Promise.all : une seule qui echoue rejette l'ensemble. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync('operations/field-buying.js', 'utf8');
const sql = fs.readFileSync('docs/migrations/sacherie_ct_views_grants_20260830.sql', 'utf8');

/* --- 1. ops_bag_releases : released_at est la seule colonne canonique ----- */
const selectReleases = js.match(/q\('ops_bag_releases',\s*'([^']*)'/);
assert.ok(selectReleases, "la requete ops_bag_releases doit rester lisible dans bagsData()");
const colonnes = selectReleases[1].split(',');
assert.ok(!colonnes.includes('created_at'),
  "ops_bag_releases n'a pas de colonne created_at : PostgREST renvoie 400 et toute la Sacherie tombe");
assert.ok(colonnes.includes('released_at'),
  'la date de sortie physique doit etre lue depuis released_at');

const blocReleases = js.slice(js.indexOf("q('ops_bag_releases'"));
assert.match(blocReleases.slice(0, 400), /\.order\('released_at',\s*\{\s*ascending:\s*false\s*\}\)/,
  'les sorties doivent etre triees serveur sur released_at, plus recentes en tete');

/* Aucun rendu ne doit plus lire x.created_at sur une ligne de sortie. */
assert.doesNotMatch(js, /date\(x\.created_at\)[^]{0,200}source_location_code/,
  'le tableau des sorties physiques doit afficher released_at');

/* --- 2. Migration : les QUATRE vues de pilotage, pas seulement deux ------- */
const vues = ['sacherie_ct_global_stock', 'sacherie_ct_cluster_stock',
  'sacherie_ct_rt_stock', 'sacherie_ct_latest_inventory'];
for (const v of vues) {
  assert.match(sql, new RegExp(`alter view public\\.${v}\\s+set \\(security_invoker = true\\)`),
    `${v} doit rester en security_invoker : sinon les RLS ne filtrent plus`);
  assert.match(sql, new RegExp(`grant select on public\\.${v}\\s+to authenticated`),
    `${v} doit etre lisible par authenticated`);
  assert.match(sql, new RegExp(`revoke all on public\\.${v}\\s+from anon`),
    `${v} ne doit jamais etre lisible par anon (cle publique visible dans les pages)`);
}

/* La migration ne doit pas contourner le bug 2 en ajoutant une colonne. */
assert.doesNotMatch(sql, /^\s*alter\s+table\s+public\.ops_bag_releases/im,
  'ops_bag_releases ne recoit pas de created_at de compatibilite : la correction est cote code');

console.log('Sacherie AFLP colonnes & droits static: PASS');
