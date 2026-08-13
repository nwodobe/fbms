#!/usr/bin/env node
/**
 * Non-régression Sacherie — validations de saisie, transitions d'état, preuves,
 * disponibilité en cluster et invariants du grand livre.
 *
 * Charge les VRAIS fichiers du module dans Chromium et ne remplace que le
 * client Supabase par un double rendant le jeu de données de référence de
 * l'audit (3 200 sacs, 555 sous responsabilité terrain). Aucune donnée de
 * production n'est créée ni modifiée : le double intercepte tous les appels
 * RPC et enregistre ce qui SERAIT parti au serveur.
 *
 * Il JUGE : sortie 1 si un contrôle échoue.
 *
 * Usage :
 *   npm install --no-save playwright@1.49.1
 *   node .github/agent-tests/sacherie-validations.mjs [--preuves dossier/]
 */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}
const PREUVES = arg('--preuves', '')
const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'
].find((p) => existsSync(p))

/* ======================================================= Données de référence
   Reprises telles quelles de l'audit des 34 simulations. Elles servent
   d'invariants : aucune correction ne doit les déplacer.                    */
const REFERENCE = {
  total: 3200,
  terrain: 555,
  clusters: [
    { cluster: 'BOTRO', total_reseau: 200, stock_cluster_vide: 140, stock_chez_rt: 60,
      stock_chez_producteur: 0, stock_hub_plein: 0, dechires: 5, a_reparer: 0, rebut: 0,
      physical_stock: null, inventory_gap: null, last_inventory: null, status: 'NORMAL' },
    { cluster: 'DIABO', total_reseau: 1000, stock_cluster_vide: 855, stock_chez_rt: 145,
      stock_chez_producteur: 0, stock_hub_plein: 0, dechires: 0, a_reparer: 0, rebut: 0,
      physical_stock: null, inventory_gap: null, last_inventory: null, status: 'NORMAL' },
    { cluster: "N'DJEBONOUA", total_reseau: 1500, stock_cluster_vide: 1150, stock_chez_rt: 350,
      stock_chez_producteur: 0, stock_hub_plein: 0, dechires: 0, a_reparer: 0, rebut: 0,
      physical_stock: null, inventory_gap: null, last_inventory: null, status: 'NORMAL' },
    { cluster: 'BEOUMI', total_reseau: 500, stock_cluster_vide: 500, stock_chez_rt: 0,
      stock_chez_producteur: 0, stock_hub_plein: 0, dechires: 0, a_reparer: 0, rebut: 0,
      physical_stock: null, inventory_gap: null, last_inventory: null, status: 'CRITIQUE' }
  ],
  rts: [
    { rt_id: 'RT-BOTRO-1', rt_nom: 'RT BOTRO 1', cluster: 'BOTRO', total_sous_responsabilite: 60,
      vides: 55, pleins: 0, dechires: 5, a_reparer: 0, repares: 0, rebut: 0,
      derniere_activite: new Date(Date.now() - 2 * 86400000).toISOString(), risk_level: 'ATTENTION' },
    { rt_id: 'RT-DIABO-1', rt_nom: 'RT DIABO 1', cluster: 'DIABO', total_sous_responsabilite: 145,
      vides: 145, pleins: 0, dechires: 0, a_reparer: 0, repares: 0, rebut: 0,
      derniere_activite: new Date(Date.now() - 3 * 86400000).toISOString(), risk_level: 'NORMAL' },
    { rt_id: 'RT-NDJ-1', rt_nom: "RT N'DJEBONOUA 1", cluster: "N'DJEBONOUA", total_sous_responsabilite: 350,
      vides: 350, pleins: 0, dechires: 0, a_reparer: 0, repares: 0, rebut: 0,
      derniere_activite: new Date(Date.now() - 5 * 86400000).toISOString(), risk_level: 'NORMAL' }
  ]
}

const BANC = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Banc validations Sacherie</title></head>
<body>
<header><div class="sac-title"><h1>Sacherie AFLP</h1></div>
<button class="sac-primary" id="sacNewOperation" type="button">+ Nouvelle opération</button>
<span id="anagroci-userslot"></span></header>
<p><strong id="sacContextLabel">Sacherie</strong><span id="sacUpdatedLabel">Initialisation…</span></p>
<section id="sacherieApp"></section>
<script>
var REFERENCE = ${JSON.stringify(REFERENCE)};
var SNAPSHOT = {
  generated_at: new Date().toISOString(),
  global: { total: REFERENCE.total, vides: 3195, pleins: 0, transit: 0,
            dechires: 5, a_reparer: 0, repares: 0, rebut: 0 },
  clusters: REFERENCE.clusters,
  rts: REFERENCE.rts,
  movements: [
    { movement_at: new Date(Date.now() - 35*86400000).toISOString(), movement_type: 'DOTATION_RT',
      source_type: 'LEGACY', cluster: 'BOTRO', rt_id: 'RT-BOTRO-1', qty: 60,
      from_location: 'AFLP-CL-BOTRO', to_location: 'AFLP-RT-RT-BOTRO-1',
      from_state: 'UTILISABLE', to_state: 'UTILISABLE', reference: 'HIST-0001' }
  ],
  inventories: [],
  alerts: [{ message: 'Cluster BEOUMI sans RT rattaché', cluster: 'BEOUMI', severity: 'CRITIQUE' }],
  transit_aging: { over_7d_qty: null }
};
var LOCATIONS = [
  { code: 'AFLP-CL-BEOUMI', nom: 'Magasin cluster', cluster: 'BEOUMI', scope_type: 'CLUSTER' },
  { code: 'AFLP-CL-BOTRO', nom: 'Magasin cluster', cluster: 'BOTRO', scope_type: 'CLUSTER' },
  { code: 'AFLP-RT-RT-BOTRO-1', nom: 'RT BOTRO 1', cluster: 'BOTRO', scope_type: 'RT', rt_id: 'RT-BOTRO-1' }
];
var RPC = {
  sacherie_ct_snapshot: SNAPSHOT,
  sacherie_ct_locations: LOCATIONS,
  sacherie_ct_pertes: [],
  sacherie_mon_contexte: { fonction_operationnelle: 'Unit Head', cluster: 'BOTRO' },
  sacherie_ct_inventorier: { status: 'HOLD', difference: 0 },
  sacherie_ct_traiter_etat: { ok: true },
  sacherie_ct_declarer_perte: { ok: true }
};
var TABLES = { rt: [], avances: [], bag_movement_requests: [] };

/* Tout appel RPC est enregistré au lieu de partir : aucune donnée de
   production n'est créée par ces tests. */
window.__rpc = [];
window.__failNext = null;
function requete(rows){var q={};['select','eq','neq','order','limit','in','is'].forEach(function(k){q[k]=function(){return q;};});
  q.then=function(ok,ko){return Promise.resolve({data:rows,error:null}).then(ok,ko);};return q;}
window.supabase = { createClient: function(){ return {
  rpc: function(nom,args){
    window.__rpc.push({nom:nom,args:args||null});
    if(window.__failNext && window.__failNext.nom===nom){var f=window.__failNext;window.__failNext=null;
      return f.throw?Promise.reject(new Error(f.message)):Promise.resolve({data:null,error:{message:f.message}});}
    if(Object.prototype.hasOwnProperty.call(RPC,nom))return Promise.resolve({data:RPC[nom],error:null});
    return Promise.resolve({data:null,error:{message:'RPC non simulée : '+nom}});
  },
  from: function(t){ return requete(TABLES[t]||[]); }
}; } };
window.ANAGROCI_SUPABASE_URL='https://banc.invalid';
window.ANAGROCI_SUPABASE_ANON='cle-banc';
window.ANAGROCI_MODULE='sacs';
window.ANAGROCI_AUTH={profile:{nom:'Recette',role:'Branch Manager'},niveau:'bm',estBM:true,module:'sacs'};
</script>
<script src="/shared/anagroci-sacherie-control-tower.js"></script>
<script src="/shared/anagroci-sacherie-control-actions.js"></script>
<script src="/shared/anagroci-sacherie-v2.js"></script>
<script>document.dispatchEvent(new CustomEvent('anagroci:authenticated',{detail:window.ANAGROCI_AUTH}));</script>
</body></html>`

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
function servir() {
  return new Promise((resoudre) => {
    const serveur = createServer(async (req, res) => {
      const url = (req.url || '/').split('?')[0]
      if (url === '/' || url === '/banc') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(BANC)
      }
      try {
        const contenu = await readFile(join(RACINE, normalize(url).replace(/^(\.\.[/\\])+/, '')))
        res.writeHead(200, { 'content-type': MIME[url.slice(url.lastIndexOf('.'))] || 'application/octet-stream' })
        res.end(contenu)
      } catch { res.writeHead(404); res.end('introuvable') }
    })
    serveur.listen(0, '127.0.0.1', () => resoudre({ serveur, port: serveur.address().port }))
  })
}

const resultats = []
const ok = (quoi, preuve) => resultats.push({ statut: 'ok', quoi, preuve })
const defaut = (quoi, preuve) => resultats.push({ statut: 'defaut', quoi, preuve })

if (!CHROMIUM) {
  console.log('non-concluant : aucun Chromium sous /opt/pw-browsers. Ce contrôle n’a PAS été exécuté.')
  process.exit(2)
}

const { serveur, port } = await servir()
const navigateur = await chromium.launch({ executablePath: CHROMIUM })

try {
  const page = await navigateur.newPage({ viewport: { width: 1440, height: 900 } })
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e.message || e)))
  await page.goto(`http://127.0.0.1:${port}/banc`, { waitUntil: 'load' })
  await page.waitForSelector('.ct-kpi', { timeout: 15000 })
  await page.waitForTimeout(600)

  const H = 'window.ANAGROCI_SACHERIE_CT.helpers'

  /* Sans les validations partagées, tout le reste est sans objet : on le dit
     clairement au lieu de laisser le script s'effondrer sur une exception. */
  const helpersPresents = await page.evaluate(() => !!(window.ANAGROCI_SACHERIE_CT && window.ANAGROCI_SACHERIE_CT.helpers))
  if (!helpersPresents) {
    defaut('Validations partagées absentes',
      'window.ANAGROCI_SACHERIE_CT.helpers est introuvable : saisie vide, transitions, plafonds et ' +
      'contrôle des preuves ne sont plus centralisés. Les contrôles suivants n’ont pas pu être exécutés.')
    for (const r of resultats) console.log(`✗ ${r.quoi}\n    ${r.preuve}`)
    await navigateur.close()
    serveur.close()
    process.exit(1)
  }

  /* ------------------------------------------------ C1 / M2 / M3 : quantités */
  const casQty = [
    ['', {}, false, 'saisie vide refusée (C1)'],
    ['   ', {}, false, 'espaces seuls refusés (C1)'],
    ['0', {}, true, 'zéro explicitement saisi accepté'],
    ['55', {}, true, 'entier positif accepté'],
    ['12.7', {}, false, 'décimal refusé (M2)'],
    ['12,7', {}, false, 'décimal à virgule refusé (M2)'],
    ['-3', {}, false, 'négatif refusé'],
    ['abc', {}, false, 'texte refusé'],
    ['1e9', {}, false, 'notation scientifique refusée (M2)'],
    ['999999999', { max: 55 }, false, 'au-delà du stock disponible refusé (M3)'],
    ['55', { max: 55 }, true, 'égal au stock disponible accepté'],
    ['0', { min: 1 }, false, 'zéro refusé quand un minimum de 1 s’applique']
  ]
  for (const [entree, opts, attendu, quoi] of casQty) {
    const r = await page.evaluate(([h, e, o]) => eval(h).parseBagQty(e, o), [H, entree, opts])
    if (!!r.ok === attendu) ok(`Quantité — ${quoi}`, `« ${entree} » → ${r.ok ? 'valeur ' + r.value : r.error}`)
    else defaut(`Quantité — ${quoi}`, `« ${entree} » → ${r.ok ? 'accepté (' + r.value + ')' : 'refusé : ' + r.error}`)
  }

  /* Le point exact du défaut C1 : Number('') vaut 0. */
  const zeroFantome = await page.evaluate(([h]) => {
    const r = eval(h).parseBagQty('')
    return { refuse: !r.ok, valeur: r.value === undefined ? 'aucune' : r.value }
  }, [H])
  if (zeroFantome.refuse) ok('C1 — une saisie vide ne produit aucune quantité', `valeur retournée : ${zeroFantome.valeur}`)
  else defaut('C1 — une saisie vide produit encore une quantité', `valeur : ${zeroFantome.valeur}`)

  /* ------------------------------------------------------- M1 : transitions */
  const casTransition = [
    ['DECHIRE', 'A_REPARER', true],
    ['DECHIRE', 'REFORME', true],
    ['A_REPARER', 'REPARE', true],
    ['A_REPARER', 'REFORME', true],
    ['REPARE', 'UTILISABLE', true],
    ['DECHIRE', 'UTILISABLE', false],
    ['REPARE', 'A_REPARER', false],
    ['A_REPARER', 'A_REPARER', false],
    ['UTILISABLE', 'DECHIRE', false],
    ['REFORME', 'UTILISABLE', false]
  ]
  for (const [de, vers, attendu] of casTransition) {
    const r = await page.evaluate(([h, a, b]) => eval(h).transitionAllowed(a, b), [H, de, vers])
    if (!!r.ok === attendu) ok(`Transition ${de} → ${vers} ${attendu ? 'autorisée' : 'interdite'}`, r.ok ? 'acceptée' : r.error)
    else defaut(`Transition ${de} → ${vers} : verdict inattendu`, r.ok ? 'acceptée à tort' : 'refusée à tort : ' + r.error)
  }

  /* ------------------------------------------------------------ M4 : preuves */
  const casFichier = [
    ['photo.jpg', 'image/jpeg', 500000, true],
    ['photo.png', 'image/png', 500000, true],
    ['bordereau.pdf', 'application/pdf', 500000, true],
    ['trop-gros.jpg', 'image/jpeg', 2000000, false],
    ['carte.svg', 'image/svg+xml', 1000, false],
    ['charge.exe', 'application/x-msdownload', 1000, false],
    ['page.html', 'text/html', 1000, false],
    ['faux.jpg', 'text/html', 1000, false],
    ['sans-type.jpg', '', 1000, false],
    ['vide.pdf', 'application/pdf', 0, false],
    ['double.pdf.exe', 'application/x-msdownload', 1000, false]
  ]
  for (const [nom, type, taille, attendu] of casFichier) {
    const r = await page.evaluate(([h, n, t, s]) => eval(h).validateEvidenceFile({ name: n, type: t, size: s }), [H, nom, type, taille])
    if (!!r.ok === attendu) ok(`Preuve — ${nom} (${type || 'type absent'}) ${attendu ? 'acceptée' : 'refusée'}`, r.ok ? 'acceptée' : r.error)
    else defaut(`Preuve — ${nom} : verdict inattendu`, r.ok ? 'acceptée à tort' : 'refusée à tort : ' + r.error)
  }

  /* --------------------------------------------------- C4 : messages serveur */
  const messages = await page.evaluate(([h]) => ({
    droits: eval(h).friendlyError({ message: 'permission denied for function sacherie_ct_cockpit' }),
    absente: eval(h).friendlyError({ message: 'function public.sacherie_ct_snapshot(unknown) does not exist' }),
    reseau: eval(h).friendlyError({ message: 'Failed to fetch' })
  }), [H])
  const fuite = Object.entries(messages).filter(([, v]) => /permission denied|function |relation |public\./i.test(v))
  if (!fuite.length) ok('C4 — aucun message technique exposé à l’utilisateur', messages.droits)
  else defaut('C4 — un message technique fuite dans l’interface', fuite.map(([k, v]) => `${k} : ${v}`).join(' · '))

  /* ------------------------------------------- C3 : disponibilité en cluster */
  const dispo = await page.evaluate(([h]) => eval(h).clusterAvailable(), [H])
  const attenduDispo = 140 + 855 + 1150 + 500
  if (dispo.value === attenduDispo) {
    ok('C3 — « Disponibles en Cluster » exclut les sacs sous responsabilité terrain',
      `${dispo.value} sacs en magasin cluster, contre 3 195 annoncés auparavant`)
  } else {
    defaut('C3 — la disponibilité en cluster est fausse', `${dispo.value} au lieu de ${attenduDispo}`)
  }
  const libelle = await page.textContent('#ctBody')
  if (!/Vides disponibles/.test(libelle) && /Disponibles en Cluster/.test(libelle)) {
    ok('C3 — le libellé ambigu « Vides disponibles » a disparu', 'remplacé par « Disponibles en Cluster »')
  } else {
    defaut('C3 — le libellé ambigu subsiste', 'l’écran affiche encore « Vides disponibles »')
  }

  /* ---------------------------------- Invariants du grand livre (§19 mission) */
  const livre = await page.evaluate(() => {
    const s = window.ANAGROCI_SACHERIE_CT.snapshot()
    const terrain = (s.rts || []).reduce((t, r) => t + Number(r.total_sous_responsabilite || 0), 0)
    const parCluster = {}
    ;(s.clusters || []).forEach((c) => { parCluster[c.cluster] = c })
    return {
      total: Number(s.global.total),
      terrain,
      negatifs: (s.rts || []).filter((r) => Number(r.total_sous_responsabilite) < 0).length,
      botro: parCluster.BOTRO, diabo: parCluster.DIABO,
      ndj: parCluster["N'DJEBONOUA"], beoumi: parCluster.BEOUMI
    }
  })
  const invariants = [
    ['parc total = 3 200', livre.total === 3200, livre.total],
    ['sous responsabilité terrain = 555', livre.terrain === 555, livre.terrain],
    ['aucun stock négatif', livre.negatifs === 0, livre.negatifs + ' RT négatif(s)'],
    ['BOTRO : 200 dont 140 cluster / 60 RT', livre.botro.total_reseau === 200 && livre.botro.stock_cluster_vide === 140 && livre.botro.stock_chez_rt === 60, `${livre.botro.total_reseau}/${livre.botro.stock_cluster_vide}/${livre.botro.stock_chez_rt}`],
    ['DIABO : 1 000 dont 855 cluster / 145 RT', livre.diabo.total_reseau === 1000 && livre.diabo.stock_cluster_vide === 855 && livre.diabo.stock_chez_rt === 145, `${livre.diabo.total_reseau}/${livre.diabo.stock_cluster_vide}/${livre.diabo.stock_chez_rt}`],
    ["N'DJEBONOUA : 1 500 dont 1 150 cluster / 350 RT", livre.ndj.total_reseau === 1500 && livre.ndj.stock_cluster_vide === 1150 && livre.ndj.stock_chez_rt === 350, `${livre.ndj.total_reseau}/${livre.ndj.stock_cluster_vide}/${livre.ndj.stock_chez_rt}`],
    ['BEOUMI : 500 au réseau', livre.beoumi.total_reseau === 500, livre.beoumi.total_reseau]
  ]
  for (const [quoi, vrai, mesure] of invariants) {
    if (vrai) ok(`Grand livre — ${quoi}`, String(mesure))
    else defaut(`Grand livre — ${quoi} rompu`, String(mesure))
  }

  /* ------------------------------ Cluster critique sans RT (BEOUMI, §15) */
  await page.evaluate(() => window.ANAGROCI_SACHERIE_CT.openCluster('BEOUMI'))
  await page.waitForTimeout(400)
  const vueBeoumi = await page.textContent('#ctBody')
  if (/BEOUMI/.test(vueBeoumi) && /CRITIQUE/.test(vueBeoumi)) {
    ok('Le risque d’un cluster sans RT reste visible', 'BEOUMI affiche son statut CRITIQUE dans la vue Réseau')
  } else {
    defaut('Le risque cluster disparaît faute de RT', 'BEOUMI filtré ne montre plus son statut')
  }

  /* -------------------------------------------------- Routage : RT inconnu */
  await page.evaluate(() => window.ANAGROCI_SACHERIE_CT.openRT('RT-INEXISTANT'))
  await page.waitForTimeout(400)
  const vueRT = await page.textContent('#ctBody')
  if (/introuvable/i.test(vueRT)) ok('Un RT inexistant produit un message explicite', 'pas de bascule silencieuse')
  else defaut('Un RT inexistant est ignoré silencieusement', 'la vue retombe sans le dire')

  /* --------------------------------------------------- M6 / M7 : export CSV */
  /* On repart d'un réseau non filtré : le test précédent a laissé un RT
     inexistant dans le filtre, et la vue « introuvable » n'a pas de bouton. */
  await page.evaluate(() => window.ANAGROCI_SACHERIE_CT.openCluster(''))
  await page.waitForTimeout(300)
  const csvPlein = await page.evaluate(() => {
    let capture = null
    const vrai = URL.createObjectURL
    URL.createObjectURL = (b) => { capture = b; return 'blob:test' }
    document.querySelector('[data-export="reseau"]').click()
    URL.createObjectURL = vrai
    return capture ? capture.text() : null
  })
  if (csvPlein && /derniere_activite_iso/.test(csvPlein) && /\d{4}-\d{2}-\d{2}T/.test(csvPlein) && !/il y a /.test(csvPlein)) {
    ok('M7 — le CSV exporte des dates absolues', 'colonne derniere_activite_iso au format ISO 8601')
  } else {
    defaut('M7 — le CSV n’exporte pas de date exploitable', String(csvPlein || '').slice(0, 120))
  }

  const csvVide = await page.evaluate(() => {
    window.ANAGROCI_SACHERIE_CT.openCluster('CLUSTER-SANS-RT')
    let appele = false
    const vrai = URL.createObjectURL
    URL.createObjectURL = () => { appele = true; return 'blob:test' }
    const b = document.querySelector('[data-export="reseau"]')
    if (b) b.click()
    URL.createObjectURL = vrai
    return { appele, corps: document.getElementById('ctBody').textContent }
  })
  if (!csvVide.appele && /Aucune donnée à exporter/.test(csvVide.corps)) {
    ok('M6 — un export vide est bloqué avec un message', 'aucun fichier produit')
  } else {
    defaut('M6 — un export vide produit encore un fichier', `téléchargement déclenché : ${csvVide.appele}`)
  }

  /* ------------------------------------- C4 : échec de rafraîchissement visible */
  await page.evaluate(() => {
    window.__failNext = { nom: 'sacherie_ct_snapshot', message: 'permission denied for function sacherie_ct_cockpit' }
    return window.ANAGROCI_SACHERIE_CT.reload()
  })
  await page.waitForTimeout(600)
  const sync = await page.evaluate(() => ({
    label: document.getElementById('sacUpdatedLabel').textContent,
    classe: document.getElementById('sacUpdatedLabel').className,
    banniere: !!document.getElementById('ctStaleBanner'),
    reessayer: !!document.querySelector('[data-retry]'),
    fuite: /permission denied|sacherie_ct_cockpit/i.test(document.body.innerText)
  }))
  if (/non actualis/i.test(sync.label) && sync.classe.includes('stale')) {
    ok('C4 — l’échec de synchronisation est affiché', sync.label)
  } else {
    defaut('C4 — l’écran annonce encore des données à jour', `${sync.label} (${sync.classe})`)
  }
  if (sync.banniere && sync.reessayer) ok('C4 — bandeau d’avertissement et bouton Réessayer présents', 'les données affichées sont signalées comme figées')
  else defaut('C4 — aucun avertissement sur les données figées', `bandeau=${sync.banniere}, réessayer=${sync.reessayer}`)
  if (!sync.fuite) ok('C4 — le message technique reste hors de l’interface', 'seul le message métier est affiché')
  else defaut('C4 — le nom de la fonction Postgres est exposé', 'permission denied … visible à l’écran')

  /* --------------------------------------- C1 de bout en bout : aucun envoi */
  await page.evaluate(() => { window.__failNext = null; return window.ANAGROCI_SACHERIE_CT.reload() })
  await page.waitForTimeout(500)
  const envoi = await page.evaluate(async () => {
    window.__rpc.length = 0
    window.ANAGROCI_SACHERIE_CT_ACTIONS.open('inventory', {})
    await new Promise((r) => setTimeout(r, 250))
    document.getElementById('ctaLoc').value = 'AFLP-CL-BEOUMI'
    document.getElementById('ctaState').value = 'UTILISABLE'
    document.getElementById('ctaQty').value = ''
    document.getElementById('ctaRun').click()
    await new Promise((r) => setTimeout(r, 350))
    return {
      appels: window.__rpc.filter((x) => x.nom === 'sacherie_ct_inventorier').length,
      message: (document.getElementById('ctaMsg') || {}).textContent || ''
    }
  })
  if (envoi.appels === 0 && /obligatoire/i.test(envoi.message)) {
    ok('C1 de bout en bout — aucun appel serveur sur quantité vide', envoi.message.slice(0, 90))
  } else {
    defaut('C1 de bout en bout — la quantité vide part encore au serveur', `${envoi.appels} appel(s) · ${envoi.message}`)
  }

  /* --------------------------- C2 de bout en bout : écart sans motif retenu */
  const sansMotif = await page.evaluate(async () => {
    window.__rpc.length = 0
    document.getElementById('ctaQty').value = '50'
    document.getElementById('ctaReason').value = ''
    document.getElementById('ctaRun').click()
    await new Promise((r) => setTimeout(r, 300))
    const premier = window.__rpc.filter((x) => x.nom === 'sacherie_ct_inventorier').length
    const msg = (document.getElementById('ctaMsg') || {}).textContent || ''
    document.getElementById('ctaRun').click()
    await new Promise((r) => setTimeout(r, 400))
    return { premier, second: window.__rpc.filter((x) => x.nom === 'sacherie_ct_inventorier').length, msg }
  })
  if (sansMotif.premier === 0 && /motif/i.test(sansMotif.msg)) {
    ok('C2 — un comptage sans motif exige une confirmation explicite', sansMotif.msg.slice(0, 100))
  } else {
    defaut('C2 — un comptage sans motif part directement', `${sansMotif.premier} appel(s) au premier clic`)
  }
  if (sansMotif.second === 1) ok('C2 — après confirmation, le comptage part une seule fois', 'pas de double soumission')
  else defaut('C2 — comportement inattendu après confirmation', `${sansMotif.second} appel(s)`)

  await page.evaluate(() => window.ANAGROCI_SACHERIE_CT_ACTIONS.close())

  /* ------------------------------------------------- M1 de bout en bout (UI) */
  const optionsEtat = await page.evaluate(async () => {
    window.ANAGROCI_SACHERIE_CT_ACTIONS.open('state', { state: 'DECHIRE' })
    await new Promise((r) => setTimeout(r, 250))
    const lire = () => Array.from(document.getElementById('ctaTo').options).map((o) => o.value)
    const depuisDechire = lire()
    document.getElementById('ctaFrom').value = 'REPARE'
    document.getElementById('ctaFrom').dispatchEvent(new Event('change'))
    const depuisRepare = lire()
    window.ANAGROCI_SACHERIE_CT_ACTIONS.close()
    return { depuisDechire, depuisRepare }
  })
  if (!optionsEtat.depuisDechire.includes('UTILISABLE') && optionsEtat.depuisRepare.join() === 'UTILISABLE') {
    ok('M1 — l’interface ne propose que les transitions autorisées',
      `abîmé → ${optionsEtat.depuisDechire.join('/')} ; réparé → ${optionsEtat.depuisRepare.join('/')}`)
  } else {
    defaut('M1 — l’interface propose encore des transitions interdites',
      `abîmé → ${optionsEtat.depuisDechire.join('/')} ; réparé → ${optionsEtat.depuisRepare.join('/')}`)
  }

  /* ------------------------------------------------------------- Responsive */
  for (const vp of [{ n: 'mobile-390x844', w: 390, h: 844 }, { n: 'tablette-768x1024', w: 768, h: 1024 }, { n: 'bureau-1440x900', w: 1440, h: 900 }]) {
    const p = await navigateur.newPage({ viewport: { width: vp.w, height: vp.h } })
    await p.goto(`http://127.0.0.1:${port}/banc`, { waitUntil: 'load' })
    await p.waitForSelector('.ct-kpi', { timeout: 15000 })
    await p.waitForTimeout(400)
    const m = await p.evaluate(() => ({ corps: document.documentElement.scrollWidth, fenetre: window.innerWidth }))
    if (m.corps <= m.fenetre + 1) ok(`${vp.n} — aucun débordement horizontal`, `${m.corps} px pour ${m.fenetre} px`)
    else defaut(`${vp.n} — la page déborde`, `${m.corps} px pour ${m.fenetre} px`)
    if (PREUVES) { await mkdir(PREUVES, { recursive: true }); await p.screenshot({ path: join(PREUVES, `sacherie-${vp.n}.png`) }) }
    await p.close()
  }

  if (!erreurs.length) ok('Aucune erreur JavaScript pendant le parcours', 'console sans pageerror')
  else defaut(`${erreurs.length} erreur(s) JavaScript`, erreurs.slice(0, 3).join(' · '))
} finally {
  await navigateur.close()
  serveur.close()
}

const defauts = resultats.filter((r) => r.statut === 'defaut')
for (const r of resultats) {
  console.log(`${r.statut === 'ok' ? '·' : '✗'} ${r.quoi}`)
  console.log(`    ${r.preuve}`)
}
console.log('')
console.log(`${resultats.length} contrôle(s) · ${defauts.length} défaut(s)`)
if (defauts.length) process.exit(1)
