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

/* Le banc EST la page de production : on charge terrain/sacherie_v2.html tel
   quel, en retirant seulement ce qui sortirait sur le réseau (CDN Supabase,
   portail d'authentification, barre de suite), et en injectant les données
   fixes juste avant les modules. Mesurer le responsive sur une page d'essai
   simplifiée reviendrait à mesurer une mise en page qui n'existe pas. */
const PAGE = await readFile(join(RACINE, 'terrain', 'sacherie_v2.html'), 'utf8')
const FIXTURES = `<script>
var REFERENCE = ${JSON.stringify(REFERENCE)};
var SNAPSHOT = {
  generated_at: new Date().toISOString(),
  global: { total: REFERENCE.total, vides: 3195, pleins: 0, transit: 0,
            dechires: 5, a_reparer: 0, repares: 0, rebut: 0 },
  clusters: REFERENCE.clusters,
  rts: REFERENCE.rts,
  movements: (function(){
    var out = [{ movement_at: new Date(Date.now() - 35*86400000).toISOString(), movement_type: 'DOTATION_RT',
      source_type: 'LEGACY', cluster: 'BOTRO', rt_id: 'RT-BOTRO-1', qty: 60,
      from_location: 'AFLP-CL-BOTRO', to_location: 'AFLP-RT-RT-BOTRO-1',
      from_state: 'UTILISABLE', to_state: 'UTILISABLE', reference: 'HIST-0001' },
    /* Valeurs piégeuses : accents, apostrophe, guillemets et point-virgule —
       le séparateur du fichier lui-même. */
    { movement_at: new Date(Date.now() - 86400000).toISOString(), movement_type: 'TRANSFERT',
      source_type: 'EXECUTED', cluster: "N'DJEBONOUA", rt_id: 'RT-NDJ-1', qty: 40,
      from_location: 'AFLP-CL-NDJ', to_location: 'AFLP-HUB-BOUAKE',
      from_state: 'PLEIN', to_state: 'EN_TRANSIT',
      reference: 'RÉF "SPÉCIALE" ; N\\u2019DJÉBONOUA' }];
    for (var i = 0; i < 60; i++) out.push({
      movement_at: new Date(Date.now() - (i + 2) * 3600000).toISOString(),
      movement_type: 'REMISE', source_type: 'EXECUTED', cluster: 'DIABO', rt_id: 'RT-DIABO-1',
      qty: 10 + i, from_location: 'AFLP-CL-DIABO', to_location: 'AFLP-RT-RT-DIABO-1',
      from_state: 'UTILISABLE', to_state: 'UTILISABLE', reference: 'MVT-' + (1000 + i) });
    return out;
  })(),
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
  sacherie_ct_pertes: [{ id: 'perte-1', cluster: 'BOTRO', location_code: 'AFLP-RT-RT-BOTRO-1',
    location_name: 'RT BOTRO 1', state: 'UTILISABLE', qty: 12, motif: 'Magasin inondé',
    statut: 'SOUMIS', submitted_at: new Date(Date.now() - 86400000).toISOString() }],
  sacherie_mon_contexte: { fonction_operationnelle: 'Unit Head', cluster: 'BOTRO' },
  sacherie_ct_inventorier: { status: 'HOLD', difference: 0 },
  sacherie_ct_traiter_etat: { ok: true },
  sacherie_ct_declarer_perte: { ok: true }
};
var TABLES = {
  rt: [{ id: 'RT-BOTRO-1', nom: 'RT BOTRO 1', cluster: 'BOTRO', village_nom: 'Village A', data: {}, statut: 'ACTIF' }],
  avances: [{ id: 'av-1', date: '2027-01-12', cluster: 'BOTRO', rt_id: 'RT-BOTRO-1', rt_nom: 'RT BOTRO 1',
    montant: 800000, statut: 'Active', cycle_id: 'WAVE-2027-BOT-001', volume_finance_kg: 2000,
    prix_reference_kg: 400, cycle_statut: 'OPEN', created_at: new Date().toISOString() }],
  bag_movement_requests: [
    { id: 'req-botro', request_code: 'DEM-2027-0001', cluster: 'BOTRO', rt_id: 'RT-BOTRO-1',
      rt_nom: 'RT BOTRO 1', cycle_id: 'WAVE-2027-BOT-001', stock_rcn_kg_verified: 0,
      system_max_bags: 27, bags_already_held: 8, reserved_approved_bags: 0, max_new_available: 19,
      requested_qty: 19, approved_qty: 19, status: 'APPROVED',
      requested_at: new Date(Date.now() - 2*86400000).toISOString(), expires_at: null },
    { id: 'req-diabo', request_code: 'DEM-2027-0002', cluster: 'DIABO', rt_id: 'RT-DIABO-1',
      rt_nom: 'RT DIABO 1', cycle_id: 'WAVE-2027-DIA-001', stock_rcn_kg_verified: 0,
      system_max_bags: 30, bags_already_held: 0, reserved_approved_bags: 0, max_new_available: 30,
      requested_qty: 25, approved_qty: 25, status: 'APPROVED',
      requested_at: new Date(Date.now() - 4*86400000).toISOString(), expires_at: null }
  ]
};

/* Tout appel RPC est enregistré au lieu de partir : aucune donnée de
   production n'est créée par ces tests. */
window.__rpc = [];
window.__failNext = null;
window.__bloquer = false;
function requete(rows){var q={};['select','eq','neq','order','limit','in','is'].forEach(function(k){q[k]=function(){return q;};});
  q.then=function(ok,ko){return Promise.resolve({data:rows,error:null}).then(ok,ko);};return q;}
window.supabase = { createClient: function(){ return {
  rpc: function(nom,args){
    window.__rpc.push({nom:nom,args:args||null});
    if(window.__bloquer)return new Promise(function(){});
    if(window.__failNext && window.__failNext.nom===nom){var f=window.__failNext;window.__failNext=null;
      return f.throw?Promise.reject(new Error(f.message)):Promise.resolve({data:null,error:{message:f.message}});}
    if(Object.prototype.hasOwnProperty.call(RPC,nom))return Promise.resolve({data:RPC[nom],error:null});
    return Promise.resolve({data:null,error:{message:'RPC non simulée : '+nom}});
  },
  from: function(t){ return requete(TABLES[t]||[]); }
}; } };
var Q=new URLSearchParams(location.search);
var ROLE=Q.get('role')||'Branch Manager';
var FONCTION=Q.get('fonction')||'Unit Head';
var CLUSTER=Q.get('cluster')||'BOTRO';
RPC.sacherie_mon_contexte={fonction_operationnelle:FONCTION,cluster:CLUSTER};
if(Q.get('lent'))window.ANAGROCI_SACHERIE_TIMEOUT_MS=Number(Q.get('lent'));
window.ANAGROCI_SUPABASE_URL='https://banc.invalid';
window.ANAGROCI_SUPABASE_ANON='cle-banc';
window.ANAGROCI_MODULE='sacs';
window.ANAGROCI_AUTH={profile:{nom:'Recette',role:ROLE},niveau:ROLE==='Branch Manager'?'bm':'chef',estBM:ROLE==='Branch Manager',module:'sacs'};
</script>
`

const BANC = PAGE
  /* Les polices distantes ne changent rien aux mesures et feraient dépendre la
     recette d'un réseau sortant : on les retire du banc. */
  .replace(/<link rel="preconnect"[^>]*>/g, '')
  .replace(/<link href="https:\/\/fonts\.googleapis[^>]*>/g, '')
  .replace(/<script src="https:\/\/cdn\.jsdelivr[^>]*><\/script>/g, '')
  .replace(/<script defer src="\.\.\/shared\/auth-gate\.js"[^>]*><\/script>/g, '')
  .replace(/<script defer src="\.\.\/shared\/suite-bar\.js"[^>]*><\/script>/g, '')
  .replace(/<script defer src="\.\.\/shared\/(anagroci-sacherie-[a-z0-9-]+\.js)[^"]*"><\/script>/g,
           (_, f) => `<script defer data-module-sacherie src="/shared/${f}"></script>`)
  .replace('</head>', FIXTURES + '</head>')
  .replace('</body>', '<script>document.dispatchEvent(new CustomEvent("anagroci:authenticated",{detail:window.ANAGROCI_AUTH}));</script></body>')

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

  /* ------------------- C1 dans le workflow de dotation (§4 : « ailleurs ») ---
     Le même antipattern que l'inventaire vivait dans le workflow SOP-006 :
     `num('')` rend 0, donc un stock RCN « vérifié » vide partait comme un
     comptage physique à zéro. */
  const dotation = await page.evaluate(async () => {
    const v2 = window.ANAGROCI_SACHERIE_V2
    if (!v2 || !v2.openRequest) return { indisponible: 'API du workflow absente' }
    window.__rpc.length = 0
    v2.openRequest({})
    await new Promise((r) => setTimeout(r, 400))
    const rt = document.getElementById('sv2_rt')
    const champ = document.getElementById('sv2_stock')
    if (!rt || !champ) return { indisponible: 'formulaire de demande non rendu' }

    /* On place le formulaire dans l'état exact du scénario : RT choisi, cycle
       ouvert choisi, quantité saisie — et le stock RCN laissé VIDE. */
    const opt = Array.from(rt.options).find((o) => o.value)
    if (!opt) return { indisponible: 'aucun RT proposé' }
    rt.value = opt.value
    rt.dispatchEvent(new Event('change'))
    await new Promise((r) => setTimeout(r, 200))
    const cycle = document.getElementById('sv2_cycle')
    const copt = cycle && Array.from(cycle.options).find((o) => o.value)
    if (!copt) return { indisponible: 'aucun cycle financé ouvert proposé' }
    cycle.value = copt.value
    champ.value = ''
    const q = document.getElementById('sv2_qty')
    if (q) q.value = '10'

    document.getElementById('sv2_calc').click()
    await new Promise((r) => setTimeout(r, 400))
    const appels = window.__rpc.filter((x) => x.nom === 'sacherie_calculer_plafond')
    return {
      indisponible: false,
      rt: rt.value, cycle: cycle.value,
      plafondsDemandes: appels.length,
      stockEnvoye: appels.length ? appels[0].args.p_stock_rcn_kg : undefined,
      message: (document.getElementById('sv2_msg') || {}).textContent || ''
    }
  })
  if (dotation.indisponible) {
    defaut('Dotation — scénario non exécutable dans le banc',
      dotation.indisponible + ' : le contrôle du stock RCN vide n’a PAS été exécuté, ne le comptez pas comme réussi')
  } else if (dotation.plafondsDemandes === 0) {
    ok('C1 — un stock RCN vérifié vide ne part pas comme zéro',
      `RT ${dotation.rt} · cycle ${dotation.cycle} · aucun appel au calcul de plafond · « ${String(dotation.message).slice(0, 70)} »`)
  } else {
    defaut('C1 — un stock RCN vérifié vide part encore au serveur',
      `p_stock_rcn_kg = ${JSON.stringify(dotation.stockEnvoye)}`)
  }

  /* Le workflow doit refuser les mêmes saisies que les formulaires de contrôle. */
  const dotationDecimal = await page.evaluate(([h]) => {
    const r = eval(h).parseBagQty('12.7', { min: 1 })
    const z = eval(h).parseBagQty('', { min: 0 })
    return { decimalRefuse: !r.ok, videRefuse: !z.ok }
  }, [H])
  if (dotationDecimal.decimalRefuse && dotationDecimal.videRefuse) {
    ok('Le workflow de dotation partage la validation des contrôles', 'même helper, mêmes refus')
  } else {
    defaut('Le workflow de dotation a sa propre validation', 'les règles divergent entre les écrans')
  }

  await page.evaluate(() => {
    const d = document.getElementById('sv2_request_back') || document.querySelector('.cta-close')
    if (d) d.click()
  })

  /* ============================================================ NAVIGATION ===
     Un onglet, un RT ou un cluster inconnu ne doit pas produire une bascule
     muette : l'utilisateur doit savoir que ce qu'il a demandé n'existe pas. */
  const nav = await page.evaluate(async () => {
    const lire = () => ({
      onglet: (document.querySelector('.ct-tab[aria-selected="true"]') || {}).dataset?.tab,
      url: new URLSearchParams(location.search).get('tab'),
      corps: document.getElementById('ctBody').textContent
    })
    window.ANAGROCI_SACHERIE_CT.setTab('flux')
    await new Promise((r) => setTimeout(r, 250))
    const valide = lire()
    window.ANAGROCI_SACHERIE_CT.setTab('onglet-qui-n-existe-pas')
    await new Promise((r) => setTimeout(r, 250))
    const refuse = lire()
    return { valide, refuse }
  })
  if (nav.valide.onglet === 'flux' && nav.valide.url === 'flux') {
    ok('Navigation — l’onglet actif est porté par l’URL', '?tab=flux, partageable et rechargeable')
  } else {
    defaut('Navigation — l’URL ne suit pas l’onglet', `onglet=${nav.valide.onglet}, url=${nav.valide.url}`)
  }
  if (nav.refuse.onglet === 'flux') {
    ok('Navigation — un onglet inconnu ne déplace pas l’utilisateur', 'setTab refuse une valeur hors liste')
  } else {
    defaut('Navigation — un onglet inconnu déplace l’utilisateur', `onglet devenu ${nav.refuse.onglet}`)
  }

  /* Rechargement direct sur une URL portant un onglet inexistant. */
  const p2 = await navigateur.newPage({ viewport: { width: 1440, height: 900 } })
  await p2.goto(`http://127.0.0.1:${port}/banc?tab=inexistant`, { waitUntil: 'load' })
  await p2.waitForSelector('.ct-kpi', { timeout: 15000 })
  await p2.waitForTimeout(400)
  const rechargement = await p2.evaluate(() => ({
    onglet: document.querySelector('.ct-tab[aria-selected="true"]').dataset.tab,
    avis: document.getElementById('ctBody').textContent
  }))
  if (rechargement.onglet === 'pilotage' && /n’existe pas/.test(rechargement.avis)) {
    ok('Navigation — un onglet inconnu dans l’URL est signalé', 'retour au Pilotage annoncé, pas subi')
  } else {
    defaut('Navigation — bascule silencieuse depuis l’URL', `onglet=${rechargement.onglet}, aucun avis`)
  }

  /* Rechargement sur un onglet valide : l'état doit être restauré. */
  await p2.goto(`http://127.0.0.1:${port}/banc?tab=parc`, { waitUntil: 'load' })
  await p2.waitForSelector('.ct-tab[aria-selected="true"]', { timeout: 15000 })
  await p2.waitForTimeout(400)
  const restaure = await p2.evaluate(() => document.querySelector('.ct-tab[aria-selected="true"]').dataset.tab)
  if (restaure === 'parc') ok('Navigation — ?tab= restaure l’onglet au rechargement', 'état partageable')
  else defaut('Navigation — ?tab= n’est pas restauré', `onglet ouvert : ${restaure}`)
  await p2.close()

  /* ============================================================ PAGINATION ===
     Bornée des deux côtés : ni page 0, ni page au-delà de la dernière. */
  const pagePagination = await navigateur.newPage({ viewport: { width: 1440, height: 900 } })
  await pagePagination.goto(`http://127.0.0.1:${port}/banc?tab=flux`, { waitUntil: 'load' })
  await pagePagination.waitForSelector('.ct-pagination', { timeout: 15000 })
  await pagePagination.waitForTimeout(300)
  const pagination = await pagePagination.evaluate(() => {
    const m = document.querySelector('.ct-pagination span').textContent.match(/Page (\d+) \/ (\d+)/)
    const prec = document.querySelector('.ct-pagination [data-page="0"]')
    return {
      depart: { page: Number(m[1]), pages: Number(m[2]), lignes: document.querySelectorAll('#ctTable-flux tbody tr').length },
      precDesactive: prec ? prec.disabled : null
    }
  })
  await pagePagination.close()

  const pageHorsBornes = await navigateur.newPage({ viewport: { width: 1440, height: 900 } })
  await pageHorsBornes.goto(`http://127.0.0.1:${port}/banc?tab=flux&page=999`, { waitUntil: 'load' })
  await pageHorsBornes.waitForSelector('.ct-pagination', { timeout: 15000 })
  await pageHorsBornes.waitForTimeout(300)
  const borne = await pageHorsBornes.evaluate(() => {
    const m = document.querySelector('.ct-pagination span').textContent.match(/Page (\d+) \/ (\d+)/)
    return { page: Number(m[1]), pages: Number(m[2]), vide: document.querySelectorAll('#ctTable-flux tbody tr').length === 0 }
  })
  if (borne.page === borne.pages && !borne.vide) {
    ok('Pagination — une page hors bornes est ramenée à la dernière', `page ${borne.page}/${borne.pages}, tableau non vide`)
  } else {
    defaut('Pagination — une page hors bornes produit un tableau vide', JSON.stringify(borne))
  }
  await pageHorsBornes.close()

  /* =================================================================== CSV ===
     Accents, apostrophes, guillemets et point-virgule — le séparateur du
     fichier lui-même — doivent survivre au passage dans Excel. */
  const csv = await page.evaluate(async () => {
    window.ANAGROCI_SACHERIE_CT.openCluster('')
    window.ANAGROCI_SACHERIE_CT.setTab('flux')
    await new Promise((r) => setTimeout(r, 350))
    let capture = null
    const vrai = URL.createObjectURL
    URL.createObjectURL = (b) => { capture = b; return 'blob:test' }
    document.querySelector('[data-export="flux"]').click()
    URL.createObjectURL = vrai
    if (!capture) return null
    const octets = new Uint8Array(await capture.arrayBuffer())
    return { texte: await capture.text(), bom: octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf }
  })
  if (!csv) {
    defaut('CSV — export du journal impossible', 'aucun fichier produit')
  } else {
    const texte = csv.texte
    const lignePiege = texte.split(/\r\n/).find((l) => /SP..?CIALE|SPÉCIALE/.test(l)) || ''
    if (csv.bom) ok('CSV — marque d’ordre des octets présente', 'Excel ouvre le fichier en UTF-8')
    else defaut('CSV — pas de BOM', 'Excel affichera les accents en mojibake')
    if (/RÉF/.test(texte) && /DJÉBONOUA|N’DJ/.test(texte)) ok('CSV — accents et apostrophes préservés', lignePiege.slice(0, 80))
    else defaut('CSV — accents perdus', lignePiege.slice(0, 120))
    if (/""SPÉCIALE""/.test(texte)) ok('CSV — les guillemets sont doublés', 'valeur échappée selon la convention CSV')
    else defaut('CSV — guillemets non échappés', lignePiege.slice(0, 120))
    const enTete = texte.replace(/^\ufeff/, '').split(/\r\n/)[0]
    if (enTete.split(';').length >= 8 && /"movement_at_iso"/.test(enTete)) {
      ok('CSV — séparateur point-virgule et en-têtes techniques', enTete.slice(0, 90))
    } else {
      defaut('CSV — en-tête inattendu', enTete.slice(0, 120))
    }
    /* Un point-virgule DANS une valeur ne doit pas créer de colonne. */
    const colonnes = lignePiege.match(/"/g) ? (lignePiege.match(/"/g).length) : 0
    if (colonnes % 2 === 0) ok('CSV — un point-virgule dans une valeur ne casse pas les colonnes', 'guillemets équilibrés')
    else defaut('CSV — guillemets déséquilibrés sur la ligne piégée', lignePiege.slice(0, 120))
  }

  /* ======================================================== SYNCHRONISATION ===
     Retour en ligne : l'écran doit se rafraîchir de lui-même. */
  const reprise = await page.evaluate(async () => {
    window.dispatchEvent(new Event('offline'))
    await new Promise((r) => setTimeout(r, 200))
    const horsLigne = document.getElementById('sacUpdatedLabel').className
    window.dispatchEvent(new Event('online'))
    await new Promise((r) => setTimeout(r, 700))
    return { horsLigne, apres: document.getElementById('sacUpdatedLabel').className,
             texte: document.getElementById('sacUpdatedLabel').textContent }
  })
  if (/off/.test(reprise.horsLigne)) ok('Synchronisation — la perte de réseau est affichée', 'état hors ligne')
  else defaut('Synchronisation — la perte de réseau passe inaperçue', reprise.horsLigne)
  if (/ok/.test(reprise.apres)) ok('Synchronisation — le retour en ligne rafraîchit l’écran', reprise.texte)
  else defaut('Synchronisation — le retour en ligne ne rafraîchit pas', `${reprise.apres} · ${reprise.texte}`)

  /* Délai de garde : une requête qui ne revient jamais. */
  const lent = await navigateur.newPage({ viewport: { width: 1440, height: 900 } })
  await lent.goto(`http://127.0.0.1:${port}/banc?lent=700`, { waitUntil: 'load' })
  await lent.waitForTimeout(300)
  const verdictLent = await lent.evaluate(async () => {
    window.__bloquer = true
    window.ANAGROCI_SACHERIE_CT.reload()
    await new Promise((r) => setTimeout(r, 1800))
    window.__bloquer = false
    return {
      classe: document.getElementById('sacUpdatedLabel').className,
      texte: document.getElementById('sacUpdatedLabel').textContent,
      corps: document.getElementById('ctBody').textContent,
      fuite: /timeout/i.test(document.body.innerText)
    }
  })
  if (/stale/.test(verdictLent.classe) && !/Chargement/.test(verdictLent.texte)) {
    ok('Synchronisation — une requête sans réponse déclenche le délai de garde', verdictLent.texte)
  } else {
    defaut('Synchronisation — une requête sans réponse laisse « Chargement… » indéfiniment', `${verdictLent.classe} · ${verdictLent.texte}`)
  }
  if (!verdictLent.fuite && /délai imparti|pas répondu/i.test(verdictLent.corps)) {
    ok('Synchronisation — le dépassement de délai est expliqué en clair', 'aucun terme technique exposé')
  } else {
    defaut('Synchronisation — message de dépassement de délai absent ou technique', verdictLent.corps.slice(0, 100))
  }
  await lent.close()

  /* ================================================================ RÔLES ===
     Le même écran, rejoué par profil. On vérifie ce que chaque fonction peut
     déclencher, et surtout ce qu'elle ne peut pas. */
  const profils = [
    { nom: 'Branch Manager', role: 'Branch Manager', fonction: 'Branch Manager', cluster: 'BOTRO',
      attendu: { demande: true, pertes: true, remiseBotro: true, remiseDiabo: true } },
    { nom: 'Unit Head (BOTRO)', role: 'Supervisor', fonction: 'Unit Head', cluster: 'BOTRO',
      attendu: { demande: true, pertes: false, remiseBotro: false, remiseDiabo: false } },
    { nom: 'Warehouse Keeper (BOTRO)', role: 'Agent Recenseur', fonction: 'Warehouse Keeper', cluster: 'BOTRO',
      attendu: { demande: false, pertes: false, remiseBotro: true, remiseDiabo: false } },
    { nom: 'Assistant Unit Head (DIABO)', role: 'Agent Recenseur', fonction: 'Assistant Unit Head', cluster: 'DIABO',
      attendu: { demande: true, pertes: false, remiseBotro: false, remiseDiabo: true } }
  ]
  for (const profil of profils) {
    const pr = await navigateur.newPage({ viewport: { width: 1440, height: 900 } })
    await pr.goto(`http://127.0.0.1:${port}/banc?role=${encodeURIComponent(profil.role)}&fonction=${encodeURIComponent(profil.fonction)}&cluster=${encodeURIComponent(profil.cluster)}&tab=flux`, { waitUntil: 'load' })
    await pr.waitForSelector('.ct-tab', { timeout: 15000 })
    await pr.waitForTimeout(900)
    const vu = await pr.evaluate(async () => {
      const v2 = window.ANAGROCI_SACHERIE_V2
      const boutons = () => Array.from(document.querySelectorAll('[data-review-exec]')).map((b) => b.dataset.reviewExec)
      let demande = false
      if (v2 && v2.openRequest) {
        v2.openRequest({})
        await new Promise((r) => setTimeout(r, 350))
        demande = !!document.getElementById('sv2_rt')
        const fermer = document.querySelector('.cta-close')
        if (fermer) fermer.click()
        await new Promise((r) => setTimeout(r, 150))
      }
      /* Le bouton de remise n'existe que dans la vue « À remettre ». */
      const mode = document.getElementById('sv2_mode')
      if (mode) { mode.value = 'approved'; mode.dispatchEvent(new Event('change')) }
      await new Promise((r) => setTimeout(r, 400))
      const hote = document.getElementById('sv2_loss_decisions')
      return {
        demande,
        pertes: !!(hote && /Pertes à décider/.test(hote.textContent) && hote.querySelector('[data-loss-review]')),
        remises: boutons()
      }
    })
    const constate = {
      demande: vu.demande,
      pertes: vu.pertes,
      remiseBotro: vu.remises.includes('req-botro'),
      remiseDiabo: vu.remises.includes('req-diabo')
    }
    const ecarts = Object.keys(profil.attendu).filter((k) => constate[k] !== profil.attendu[k])
    if (!ecarts.length) {
      ok(`Rôles — ${profil.nom}`,
        `demande ${constate.demande ? 'oui' : 'non'} · décision perte ${constate.pertes ? 'oui' : 'non'} · ` +
        `remise BOTRO ${constate.remiseBotro ? 'oui' : 'non'} · remise DIABO ${constate.remiseDiabo ? 'oui' : 'non'}`)
    } else {
      defaut(`Rôles — ${profil.nom} : droits incorrects`,
        ecarts.map((k) => `${k} attendu ${profil.attendu[k]}, constaté ${constate[k]}`).join(' · '))
    }
    await pr.close()
  }

  /* ------------------------------------------------------------- Responsive */
  for (const vp of [{ n: 'mobile-390x844', w: 390, h: 844, kpiAttendu: 2 },
                    { n: 'tablette-768x1024', w: 768, h: 1024, kpiAttendu: 3 },
                    { n: 'bureau-1440x900', w: 1440, h: 900, kpiAttendu: 6 }]) {
    const p = await navigateur.newPage({ viewport: { width: vp.w, height: vp.h } })
    await p.goto(`http://127.0.0.1:${port}/banc`, { waitUntil: 'load' })
    await p.waitForSelector('.ct-kpi', { timeout: 15000 })
    await p.waitForTimeout(400)

    const m = await p.evaluate(() => {
      const grille = document.querySelector('.ct-kpis')
      const nav = document.querySelector('.ct-nav')
      const petit = (el) => { const r = el.getBoundingClientRect(); return r.height < 40 || r.width < 40 }
      return {
        corps: document.documentElement.scrollWidth,
        fenetre: window.innerWidth,
        colonnesKpi: grille ? getComputedStyle(grille).gridTemplateColumns.split(' ').length : 0,
        navDefile: nav ? nav.scrollWidth > nav.clientWidth : false,
        onglets: document.querySelectorAll('.ct-tab').length,
        ciblesTropPetites: Array.from(document.querySelectorAll('.ct-tab, .ct-action, .sac-primary')).filter(petit)
          .map((e) => (e.textContent || e.className).trim().slice(0, 24) + ' ' +
            Math.round(e.getBoundingClientRect().width) + '×' + Math.round(e.getBoundingClientRect().height))
      }
    })
    if (m.corps <= m.fenetre + 1) ok(`${vp.n} — aucun débordement horizontal de la page`, `${m.corps} px pour ${m.fenetre} px`)
    else defaut(`${vp.n} — la page déborde`, `${m.corps} px pour ${m.fenetre} px`)

    if (m.colonnesKpi === vp.kpiAttendu) ok(`${vp.n} — ${m.colonnesKpi} colonne(s) de KPI`, 'grille adaptée à la largeur')
    else defaut(`${vp.n} — grille de KPI inattendue`, `${m.colonnesKpi} colonne(s) au lieu de ${vp.kpiAttendu}`)

    if (m.onglets === 5 && (vp.w > 720 || m.navDefile || m.corps <= m.fenetre + 1)) {
      ok(`${vp.n} — les cinq onglets restent atteignables`, m.navDefile ? 'barre défilante' : 'barre entière visible')
    } else {
      defaut(`${vp.n} — navigation inatteignable`, `${m.onglets} onglet(s), défilement=${m.navDefile}`)
    }

    if (!m.ciblesTropPetites.length) ok(`${vp.n} — cibles tactiles d’au moins 40 px`, 'onglets et actions utilisables au doigt')
    else defaut(`${vp.n} — ${m.ciblesTropPetites.length} cible(s) sous 40 px`, m.ciblesTropPetites.join(' · '))

    /* Les tableaux larges doivent défiler DANS leur conteneur, pas emporter la page. */
    const tableau = await p.evaluate(async () => {
      window.ANAGROCI_SACHERIE_CT.setTab('flux')
      await new Promise((r) => setTimeout(r, 400))
      const boite = document.querySelector('.ct-table')
      if (!boite) return null
      return { interne: boite.scrollWidth > boite.clientWidth,
               page: document.documentElement.scrollWidth > window.innerWidth + 1 }
    })
    if (tableau && !tableau.page) ok(`${vp.n} — le journal défile dans son conteneur`, tableau.interne ? 'défilement interne' : 'tableau entier visible')
    else defaut(`${vp.n} — le journal emporte la page en largeur`, JSON.stringify(tableau))

    /* Le tiroir d'opération : formulaire utilisable, champs pleine largeur. */
    const tiroir = await p.evaluate(async () => {
      window.ANAGROCI_SACHERIE_CT_ACTIONS.open('inventory', {})
      await new Promise((r) => setTimeout(r, 350))
      const d = document.querySelector('.cta-drawer')
      const champ = document.getElementById('ctaQty')
      const fichier = document.getElementById('ctaProof')
      if (!d || !champ) return null
      const rd = d.getBoundingClientRect(), rc = champ.getBoundingClientRect()
      const r = { tiroirTientDansLaVue: rd.width <= window.innerWidth + 1,
                  champLisible: rc.width >= Math.min(240, rd.width - 60),
                  preuvePresente: !!fichier,
                  accept: fichier ? fichier.getAttribute('accept') : '' }
      window.ANAGROCI_SACHERIE_CT_ACTIONS.close()
      return r
    })
    if (tiroir && tiroir.tiroirTientDansLaVue && tiroir.champLisible && tiroir.preuvePresente) {
      ok(`${vp.n} — le tiroir d’opération est utilisable`, `champ de saisie pleine largeur · pièce justificative : ${tiroir.accept}`)
    } else {
      defaut(`${vp.n} — tiroir d’opération inutilisable à cette largeur`, JSON.stringify(tiroir))
    }

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
