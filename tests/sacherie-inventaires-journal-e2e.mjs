/* Sacherie AFLP — vérification d'exécution réelle des deux nouveaux écrans.
 *
 * Ce test OUVRE les pages dans Chromium. Il ne lit pas le code : il vérifie
 * ce que l'écran affiche vraiment, à trois largeurs (desktop, tablette,
 * mobile).
 *
 * Ce qu'il prouve :
 *   1. le tableau de périodicité affiche les neuf colonnes demandées et
 *      classe correctement À JOUR / À FAIRE / EN RETARD / JAMAIS INVENTORIÉ ;
 *   2. le KPI « Inventaires à faire » compte les emplacements réellement dus,
 *      pas « locations moins lignes d'inventaire » ;
 *   3. le journal pagine par curseur : « Charger plus » ajoute la page
 *      suivante sans doublon ni ligne sautée, et la recherche repart de zéro ;
 *   4. une panne du journal affiche « momentanément indisponible » au lieu
 *      d'un tableau vide.
 *
 * Le SDK Supabase est remplacé par une doublure déterministe : aucun réseau,
 * aucune donnée réelle.
 *
 * Usage : node tests/sacherie-inventaires-journal-e2e.mjs
 * Prérequis : npm install --no-save playwright@1.49.1
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const RACINE = process.cwd()
const PORT = Number(process.env.PORT_FBMS ?? 4327)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
const SORTIE = join(RACINE, '.captures-sacherie')

const HARNAIS = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Harnais Sacherie</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/operations/operations.css"><link rel="stylesheet" href="/operations/operations-v2.css"></head>
<body><div id="opsRouteView"></div>
<script>
window.ANAGROCI_SUPABASE_URL = 'http://doublure.test';
window.ANAGROCI_SUPABASE_ANON = 'doublure';
window.__JOURNAL_EN_PANNE = false;

/* Six emplacements couvrant les six cas de périodicité. */
var INVENTAIRES_DUS = [
  { location_code:'AFLP-CL-DIABO', nom:'Cluster Diabo', scope_type:'CLUSTER', cluster:'DIABO',
    dernier_inventaire:'2026-09-03T08:00:00Z', jours_ecoules:15, frequence_jours:7,
    prochaine_echeance:'2026-09-10', statut:'EN_RETARD', ecart_dernier:0, hold:false, stock_utilisable:855 },
  { location_code:'AFLP-RT-RT-F', nom:'RT Fictif F', scope_type:'RT', cluster:'BOTRO',
    dernier_inventaire:'2026-08-29T08:00:00Z', jours_ecoules:20, frequence_jours:7,
    prochaine_echeance:'2026-09-05', statut:'EN_RETARD', ecart_dernier:-5, hold:true, stock_utilisable:55 },
  { location_code:'AFLP-CL-SAKASSOU', nom:'Cluster Sakassou', scope_type:'CLUSTER', cluster:'SAKASSOU',
    dernier_inventaire:null, jours_ecoules:null, frequence_jours:7,
    prochaine_echeance:null, statut:'JAMAIS_INVENTORIE', ecart_dernier:null, hold:false, stock_utilisable:0 },
  { location_code:'AFLP-CL-BOTRO', nom:'Cluster Botro', scope_type:'CLUSTER', cluster:'BOTRO',
    dernier_inventaire:'2026-09-11T08:00:00Z', jours_ecoules:7, frequence_jours:7,
    prochaine_echeance:'2026-09-18', statut:'A_FAIRE', ecart_dernier:0, hold:false, stock_utilisable:140 },
  { location_code:'AFLP-CL-BEOUMI', nom:'Cluster Beoumi', scope_type:'CLUSTER', cluster:'BEOUMI',
    dernier_inventaire:'2026-09-17T08:00:00Z', jours_ecoules:1, frequence_jours:7,
    prochaine_echeance:'2026-09-24', statut:'A_JOUR', ecart_dernier:0, hold:false, stock_utilisable:500 },
  { location_code:'AFLP-RT-RT-E', nom:'RT Fictif E', scope_type:'RT', cluster:'BEOUMI',
    dernier_inventaire:'2026-09-16T08:00:00Z', jours_ecoules:2, frequence_jours:7,
    prochaine_echeance:'2026-09-23', statut:'A_JOUR', ecart_dernier:-3, hold:true, stock_utilisable:147 }
];

/* 260 mouvements fictifs, ordonnés du plus récent au plus ancien. */
var JOURNAL = [];
for (var i = 0; i < 260; i++) {
  JOURNAL.push({
    id: 'MVT-' + String(1000 + i),
    event_key: 'EVT:' + (1000 + i),
    movement_at: new Date(Date.UTC(2026, 8, 18, 0, 0, 0) - i * 3600000).toISOString(),
    movement_type: ['TRANSFERT','CLASSEMENT','ACHAT','PERTE_APPROUVEE'][i % 4],
    source_type: 'DOUBLURE',
    reference: 'BAG-2027-' + String(100000 + i),
    qty: 1 + (i % 30),
    from_location: 'AFLP-CL-BEOUMI', to_location: 'AFLP-RT-RT-E',
    from_state: 'UTILISABLE', to_state: 'UTILISABLE',
    cluster: 'BEOUMI', rt_id: 'rt_fictif_' + (i % 3), producteur_id: null,
    note: null, proof_url: null, created_by: null
  });
}

function chercher(a) {
  a = a || {};
  var lignes = JOURNAL.slice();
  if (a.p_query) {
    var q = String(a.p_query).toLowerCase();
    lignes = lignes.filter(function (x) {
      return (x.reference + ' ' + x.event_key + ' ' + x.rt_id + ' ' + x.cluster).toLowerCase().indexOf(q) >= 0;
    });
  }
  if (a.p_movement_type) lignes = lignes.filter(function (x) { return x.movement_type === a.p_movement_type; });
  if (a.p_cursor_date) {
    var cd = a.p_cursor_date, ci = a.p_cursor_id || '';
    lignes = lignes.filter(function (x) {
      return x.movement_at < cd || (x.movement_at === cd && x.id < ci);
    });
  }
  var lim = Math.min(Math.max(Number(a.p_limit) || 50, 1), 100);
  return lignes.slice(0, lim);
}

var LIGNES = {
  sacherie_ct_global_stock: [{ total: 1200, vides: 900, pleins: 300, transit: 0, dechires: 4, a_reparer: 2 }],
  sacherie_ct_cluster_stock: [{ cluster: 'BEOUMI', stock_cluster_vide: 500, stock_cluster_plein: 0,
    stock_chez_rt: 147, stock_chez_producteur: 0, transit: 0, dechires: 4, a_reparer: 2, total_reseau: 653 }],
  sacherie_ct_rt_stock: [],
  rcn_jute_locations: INVENTAIRES_DUS.map(function (x) {
    return { code: x.location_code, nom: x.nom, scope_type: x.scope_type, cluster: x.cluster, actif: true };
  }),
  rcn_jute_v_stock: INVENTAIRES_DUS.map(function (x) {
    return { location_code: x.location_code, state: 'UTILISABLE', qty: x.stock_utilisable };
  }),
  sacherie_ct_latest_inventory: [],
  profils: [{ nom: 'Testeur', role: 'Branch Manager', actif: true }]
};

function builder(table) {
  var profil = { nom: 'Testeur', role: 'Branch Manager', actif: true };
  var b = {
    select: function () { return b; }, order: function () { return b; }, limit: function () { return b; },
    eq: function () { return b; }, in: function () { return b; }, is: function () { return b; },
    maybeSingle: function () { return Promise.resolve({ data: profil, error: null }); },
    single: function () { return Promise.resolve({ data: profil, error: null }); },
    then: function (ok, ko) { return Promise.resolve({ data: LIGNES[table] || [], error: null }).then(ok, ko); }
  };
  return b;
}
window.supabase = { createClient: function () {
  return {
    auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'utilisateur-test' } } } }); } },
    from: function (table) { return builder(table); },
    rpc: function (nom, args) {
      if (nom === 'sacherie_ct_inventaires_dus') return Promise.resolve({ data: INVENTAIRES_DUS, error: null });
      if (nom === 'sacherie_search_movements') {
        if (window.__JOURNAL_EN_PANNE) return Promise.resolve({ data: null, error: { message: 'permission denied for function sacherie_search_movements' } });
        return Promise.resolve({ data: chercher(args), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
  };
} };
</script>
<script src="/operations/field-buying.js"></script>
<script src="/operations/sacherie-operational-p1.js"></script>
<script>
/* Le harnais ne charge pas navigation-v2.js (qui exige la coquille complète
   de l'application). On reproduit sa seule responsabilité de routage, mot
   pour mot : sans cela, changer de hash ne redessinerait rien et le test
   validerait un écran figé. */
window.addEventListener('hashchange', function () {
  if (window.ANAGROCI_OPS_ROUTE) window.ANAGROCI_OPS_ROUTE();
});
</script>
</body></html>`

const serveur = createServer((req, res) => {
  const chemin = decodeURIComponent(req.url.split('?')[0])
  if (chemin === '/favicon.ico') { res.writeHead(204); return res.end() }
  if (chemin === '/__harnais.html') {
    res.writeHead(200, { 'content-type': TYPES['.html'] })
    return res.end(HARNAIS)
  }
  const fichier = join(RACINE, normalize(chemin).replace(/^(\.\.[/\\])+/, ''))
  if (!existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); return res.end('introuvable') }
  res.writeHead(200, { 'content-type': TYPES[extname(fichier)] || 'application/octet-stream' })
  res.end(readFileSync(fichier))
})
await new Promise((r) => serveur.listen(PORT, r))

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

const LARGEURS = [['desktop', 1440, 900], ['tablette', 834, 1112], ['mobile', 390, 844]]
const navigateur = await chromium.launch({ executablePath: chromiumLocal() })
const erreurs = []
let echec = null
try {
  mkdirSync(SORTIE, { recursive: true })
  for (const [nom, w, h] of LARGEURS) {
    const page = await navigateur.newPage({ viewport: { width: w, height: h } })
    page.on('pageerror', (e) => erreurs.push(nom + ' — erreur JS : ' + e.message))
    page.on('console', (m) => { if (m.type() === 'error') erreurs.push(nom + ' — console : ' + m.text()) })

    /* ---- Écran Contrôle : périodicité des inventaires ---- */
    await page.goto(`http://127.0.0.1:${PORT}/__harnais.html#bags/control`, { waitUntil: 'load' })
    await page.waitForSelector('.ops-sacherie', { timeout: 15000 })
    await page.waitForFunction(() => document.body.textContent.includes('Périodicité des inventaires'), null, { timeout: 15000 })

    const texteCtl = await page.textContent('#opsRouteView')
    for (const col of ['Localisation', 'Dernier inventaire', 'Jours écoulés', 'Fréquence',
                       'Prochaine échéance', 'Écart dernier inventaire'])
      assert.ok(texteCtl.includes(col), nom + ' : colonne « ' + col + ' » absente du tableau de périodicité')
    for (const st of ['EN RETARD', 'À FAIRE', 'À JOUR', 'JAMAIS INVENTORIÉ'])
      assert.ok(texteCtl.includes(st), nom + ' : statut ' + st + ' absent')
    assert.ok(texteCtl.includes('HOLD'), nom + ' : le HOLD doit rester visible à côté du statut de fréquence')

    /* Le KPI compte les emplacements réellement dus : 2 en retard + 1 jamais + 1 à faire = 4. */
    const kpi = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.kpi')]
        .find((x) => x.textContent.includes('Inventaires à faire'))
      return t ? t.querySelector('b').textContent.trim() : null
    })
    assert.equal(kpi, '4', nom + ' : le KPI doit compter 4 emplacements dus, obtenu ' + kpi)

    const aTraiter = await page.textContent('.ops-alert-list')
    assert.match(aTraiter, /2 inventaire\(s\) en retard/, nom + ' : les retards doivent remonter dans À TRAITER')

    await page.screenshot({ path: join(SORTIE, `controle-${nom}.png`), fullPage: true })

    /* ---- Écran Journal : pagination par curseur ---- */
    await page.goto(`http://127.0.0.1:${PORT}/__harnais.html#bags/history`, { waitUntil: 'load' })
    await page.waitForSelector('#histRows table tbody tr', { timeout: 15000 })

    const page1 = await page.$$eval('#histRows tbody tr td:nth-child(2)', (t) => t.map((x) => x.textContent.trim()))
    assert.equal(page1.length, 50, nom + ' : la première page doit tenir 50 lignes, obtenu ' + page1.length)

    await page.click('#histPlus')
    await page.waitForFunction(() => document.querySelectorAll('#histRows tbody tr').length === 100, null, { timeout: 15000 })
    const page2 = await page.$$eval('#histRows tbody tr td:nth-child(2)', (t) => t.map((x) => x.textContent.trim()))
    assert.equal(page2.length, 100, nom + ' : 100 lignes après « Charger plus »')
    assert.equal(new Set(page2).size, 100, nom + ' : aucun doublon entre les deux pages')
    assert.deepEqual(page2.slice(0, 50), page1, nom + ' : la première page ne doit pas bouger')

    /* Recherche : repart de zéro, ne s'ajoute pas à la liste courante. */
    await page.fill('#histQ', 'BAG-2027-100257')
    await page.waitForFunction(() => {
      const l = document.querySelectorAll('#histRows tbody tr')
      return l.length === 1 && l[0].textContent.includes('BAG-2027-100257')
    }, null, { timeout: 15000 })

    /* Une référence hors des 100 premières lignes reste trouvable. */
    assert.ok(!page2.includes('BAG-2027-100257'),
      nom + ' : la référence cherchée doit être hors des deux premières pages pour que le test ait un sens')

    await page.screenshot({ path: join(SORTIE, `journal-${nom}.png`), fullPage: true })

    /* ---- Panne du journal ---- */
    await page.evaluate(() => { window.__JOURNAL_EN_PANNE = true })
    await page.fill('#histQ', 'panne')
    await page.waitForFunction(() => document.body.textContent.includes('Journal momentanément indisponible'), null, { timeout: 15000 })
    const pan = await page.textContent('#histRows')
    assert.match(pan, /momentanément indisponible/, nom + ' : la panne doit être nommée')
    assert.ok(!/Aucun mouvement ne correspond/.test(pan),
      nom + ' : une panne ne doit jamais être présentée comme un journal vide')
    await page.evaluate(() => { window.__JOURNAL_EN_PANNE = false })

    /* Pas de débordement horizontal, surtout sur mobile. */
    const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(debord <= 1, nom + ' : débordement horizontal de ' + debord + ' px')

    await page.close()
  }
  assert.deepEqual(erreurs, [], 'aucune erreur JavaScript attendue')
} catch (e) { echec = e } finally {
  await navigateur.close(); serveur.close()
}
if (echec) { console.error('Sacherie inventaires & journal e2e : ÉCHEC\n' + echec.message); process.exit(1) }
console.log('Sacherie inventaires & journal e2e : PASS (3 largeurs, captures dans .captures-sacherie/)')
