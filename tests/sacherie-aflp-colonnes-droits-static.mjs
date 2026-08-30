/* Non-regression : FIELD BUYING > Sacherie AFLP.
   Deux incidents du 30/08/2026, tous deux invisibles a la lecture rapide :
   - Pilotage        : « permission denied for view sacherie_ct_global_stock »
   - Demandes/sorties: « column ops_bag_releases.created_at does not exist »
   Les deux tuaient TOUTE la rubrique, car bagsData() charge les dix requetes
   dans un seul Promise.all : une seule qui echoue rejette l'ensemble. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync('operations/field-buying.js', 'utf8');
const sql = fs.readFileSync('supabase/20260830_sacherie_ct_views_grants.sql', 'utf8');

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

/* --- 1 bis. Une requete en echec ne doit plus vider toute la rubrique ----- */
/* Le comportement lui-meme est verifie dans un navigateur par
   tests/sacherie-tolerance-pannes.mjs ; ici on garde la structure qui le rend
   possible, pour que sa disparition se voie meme sans Playwright. */
assert.doesNotMatch(js, /return Promise\.all\(\[\s*\n\s*q\('sacherie_ct_cluster_stock'/,
  'bagsData() ne doit plus enchainer les requetes brutes dans un Promise.all nu');
assert.match(js, /function tolerant\(pannes, source, promesse, repli\)/,
  'le garde-fou tolerant() doit exister');
const blocBags = js.slice(js.indexOf('function bagsData()'), js.indexOf('function bagsPannesNotice'));
for (const source of ['sacherie_ct_cluster_stock', 'sacherie_ct_rt_stock', 'ops_bag_requests',
  'aflp_bag_envelopes', 'aflp_bag_cluster_allocations', 'rcn_jute_locations', 'ops_bag_releases',
  'sacherie_ct_global_stock', 'rcn_jute_loss_requests', 'sacherie_ct_latest_inventory']) {
  assert.ok(blocBags.includes("t('" + source + "'"),
    `la requete ${source} doit etre isolee : une panne ne fait tomber qu'elle`);
}
assert.match(blocBags, /pannes: pannes/, 'les pannes doivent remonter jusqu\'a l\'ecran');
assert.match(blocBags, /FBStore\.invalidate\('bags'\)/,
  'un chargement degrade ne doit pas etre mis en cache');
assert.match(js, /Données partielles/,
  'l\'ecran doit nommer les jeux de donnees manquants, pas afficher un tableau vide muet');
assert.match(js, /createHost\(\) \+ bagsPannesNotice\(b\)/,
  'le bandeau doit etre peint dans la rubrique Sacherie');

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
