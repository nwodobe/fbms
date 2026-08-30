/* Tolérance aux pannes de la rubrique Sacherie AFLP — test d'exécution réelle.
 *
 * Ce test OUVRE la page dans Chromium. Il ne lit pas le code : il fait échouer
 * une requête sur les dix et vérifie ce que l'écran affiche vraiment.
 *
 * Ce qu'il prouve :
 *   1. une requête en échec ne vide plus la rubrique — les neuf autres rendent ;
 *   2. l'écran NOMME le jeu de données manquant, au lieu d'afficher un tableau
 *      vide indiscernable d'un tableau légitimement vide ;
 *   3. le chargement dégradé n'est pas mis en cache.
 *
 * Le SDK Supabase est remplacé par une doublure déterministe : aucun réseau,
 * aucune donnée réelle. Les valeurs sont fictives et le restent.
 *
 * Usage : node tests/sacherie-tolerance-pannes.mjs
 * Prérequis : npm install --no-save playwright@1.49.1
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const RACINE = process.cwd()
const PORT = Number(process.env.PORT_FBMS ?? 4321)
const TABLE_EN_PANNE = 'ops_bag_releases'
const MESSAGE_PANNE = 'column ops_bag_releases.created_at does not exist'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

/* Le harnais n'est pas un fichier du dépôt : il est servi en mémoire. Un .html
   sur disque serait ramassé par verifier-html/liens et publié par Pages. */
const HARNAIS = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Harnais Sacherie</title>
<link rel="stylesheet" href="/operations/operations.css"><link rel="stylesheet" href="/operations/operations-v2.css"></head>
<body><div id="opsRouteView"></div>
<script>
window.ANAGROCI_SUPABASE_URL = 'http://doublure.test';
window.ANAGROCI_SUPABASE_ANON = 'doublure';
var LIGNES = {
  sacherie_ct_global_stock: [{ total: 1200, vides: 900, pleins: 300, transit: 0, dechires: 0, a_reparer: 0 }],
  sacherie_ct_cluster_stock: [{ cluster: 'CLUSTER-TEST-A', stock_cluster_vide: 500, stock_cluster_plein: 100,
    stock_chez_rt: 40, stock_chez_producteur: 0, transit: 0, dechires: 0, a_reparer: 0, total_reseau: 640 }],
  sacherie_ct_rt_stock: [{ rt_id: 'RT-TEST-1', rt_nom: 'RT Fictif Un', cluster: 'CLUSTER-TEST-A',
    total_sous_responsabilite: 40, vides: 40, pleins: 0, dechires: 0, a_reparer: 0, derniere_activite: '2026-08-01' }],
  rcn_jute_locations: [{ code: 'AFLP-CL-CLUSTER-TEST-A', scope_type: 'CLUSTER', cluster: 'CLUSTER-TEST-A', nom: 'Cluster test', actif: true }],
  profils: [{ nom: 'Testeur', role: 'Branch Manager', actif: true }]
};
function reponse(table) {
  if (table === ${JSON.stringify(TABLE_EN_PANNE)}) return { data: null, error: { message: ${JSON.stringify(MESSAGE_PANNE)} } };
  return { data: LIGNES[table] || [], error: null };
}
function builder(table) {
  var profil = { nom: 'Testeur', role: 'Branch Manager', actif: true };
  var b = {
    select: function () { return b; }, order: function () { return b; }, limit: function () { return b; },
    eq: function () { return b; }, in: function () { return b; }, is: function () { return b; },
    maybeSingle: function () { return Promise.resolve({ data: profil, error: null }); },
    single: function () { return Promise.resolve({ data: profil, error: null }); },
    then: function (ok, ko) { return Promise.resolve(reponse(table)).then(ok, ko); }
  };
  return b;
}
window.supabase = { createClient: function () {
  return {
    auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'utilisateur-test' } } } }); } },
    from: function (table) { return builder(table); },
    rpc: function () { return Promise.resolve({ data: null, error: null }); }
  };
} };
</script>
<script src="/operations/field-buying.js"></script>
</body></html>`

const serveur = createServer((req, res) => {
  const chemin = decodeURIComponent(req.url.split('?')[0])
  /* Chromium réclame toujours une icône : on répond 204 plutôt que de filtrer
     le 404 côté assertions — ainsi un VRAI 404 fait toujours échouer le test. */
  if (chemin === '/favicon.ico') { res.writeHead(204); return res.end() }
  if (chemin === '/__harnais.html') {
    res.writeHead(200, { 'content-type': TYPES['.html'] })
    return res.end(HARNAIS)
  }
  const fichier = join(RACINE, normalize(chemin).replace(/^(\.\.[/\\])+/, ''))
  if (!existsSync(fichier) || !statSync(fichier).isFile()) {
    res.writeHead(404); return res.end('introuvable')
  }
  res.writeHead(200, { 'content-type': TYPES[extname(fichier)] || 'application/octet-stream' })
  res.end(readFileSync(fichier))
})

await new Promise((r) => serveur.listen(PORT, r))
/* Chromium préinstallé quand il existe (environnements sans téléchargement) ;
   sinon celui de Playwright, comme en intégration continue. On ne code pas en
   dur un numéro de build : il change, et le test cesserait de tourner sans
   qu'on sache pourquoi. */
function chromiumLocal() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) return undefined
  const dossiers = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  for (const d of dossiers) {
    const bin = join(base, d, 'chrome-linux', 'chrome')
    if (existsSync(bin)) return bin
  }
  return undefined
}
const navigateur = await chromium.launch({ executablePath: chromiumLocal() })
const erreursConsole = []
let echec = null

try {
  const page = await navigateur.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => erreursConsole.push('erreur JS : ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') erreursConsole.push('console : ' + m.text()) })

  await page.goto(`http://127.0.0.1:${PORT}/__harnais.html#bags`, { waitUntil: 'load' })
  await page.waitForSelector('.notice.danger', { timeout: 15000 })

  /* 1. L'écran nomme la panne, avec le message du serveur. */
  const bandeau = await page.textContent('.notice.danger')
  assert.match(bandeau, /Données partielles/, 'le bandeau « Données partielles » doit être affiché')
  assert.match(bandeau, new RegExp(TABLE_EN_PANNE), 'le bandeau doit nommer la requête en échec')
  assert.match(bandeau, /vides parce que la lecture a échoué/, 'le bandeau doit distinguer « vide » de « inconnu »')
  const items = await page.$$eval('.ops-pannes li', (l) => l.map((x) => x.textContent))
  assert.equal(items.length, 1, 'une seule panne attendue, or : ' + JSON.stringify(items))
  assert.match(items[0], new RegExp(MESSAGE_PANNE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'le message exact du serveur doit être repris, pas un libellé générique')

  /* 2. Les neuf autres requêtes rendent malgré la dixième en échec. */
  const corps = await page.textContent('#opsRouteView')
  assert.match(corps, /Sacherie AFLP/, 'la rubrique doit être peinte')
  assert.match(corps, /CLUSTER-TEST-A/, 'le stock cluster doit rendre malgré la panne voisine')
  assert.match(corps, /RT Fictif Un/, 'le RT Bag Account doit rendre malgré la panne voisine')
  /* Intl.NumberFormat('fr-FR') sépare les milliers par une espace insécable
     (U+00A0 ou U+202F selon l'ICU) : on compare sans aucune espace. */
  const kpis = (await page.textContent('.kpi-grid')).replace(/[\s  ]+/g, '')
  assert.match(kpis, /1200/, 'le parc total (vue globale) doit rendre malgré la panne voisine')

  /* 3. Le bandeau tient sur une colonne : .notice est un conteneur flex, une
        liste posée en frère du libellé se rangerait à côté au lieu d'en dessous. */
  const empile = await page.$eval('.notice.danger', (el) => {
    const liste = el.querySelector('.ops-pannes')
    return liste.getBoundingClientRect().top > el.querySelector('b').getBoundingClientRect().bottom - 2
  })
  assert.ok(empile, 'la liste des pannes doit se placer SOUS le libellé, pas à côté')

  /* 4. Un chargement dégradé ne reste pas en cache. */
  const enCache = await page.evaluate(() => {
    const s = window.ANAGROCI_FB && window.ANAGROCI_FB.store
    return !!(s && s.get && Object.prototype.hasOwnProperty.call(s, 'bags'))
  })
  assert.equal(enCache, false, 'le jeu de données dégradé ne doit pas être mémorisé')

  /* 5. Aucune erreur JS non gérée : la tolérance ne doit pas se payer en
        rejets de promesse orphelins. */
  const fabriquees = erreursConsole.filter((m) => !m.includes('[FB sacherie]'))
  assert.deepEqual(fabriquees, [], 'erreurs inattendues : ' + JSON.stringify(fabriquees))

  console.log('Sacherie tolérance aux pannes : PASS (1 requête en panne sur 10, rubrique rendue)')
} catch (e) {
  echec = e
} finally {
  await navigateur.close()
  await new Promise((r) => serveur.close(r))
}

if (echec) { console.error(echec.message); process.exit(1) }
