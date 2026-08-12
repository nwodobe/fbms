#!/usr/bin/env node
/**
 * Non-régression — navigation unifiée et sécurité d'affichage du module
 * Sacherie AFLP, dans un vrai navigateur.
 *
 * Ce script charge LES VRAIS fichiers du module (aucune copie) et ne remplace
 * que le client Supabase par un double rendant des données fixes. Il vérifie
 * ce qu'aucune analyse statique ne peut prouver :
 *
 *   · un cluster nommé `N'DA` ou porteur d'une charge d'injection s'affiche
 *     comme du texte et n'exécute rien (le défaut P0) ;
 *   · l'écran n'a plus qu'un en-tête, une barre de navigation et cinq onglets,
 *     là où trois modules empilaient quinze onglets et deux bandeaux ;
 *   · les décisions passent par un panneau contextualisé, jamais par prompt()
 *     ou confirm() ;
 *   · rien ne déborde horizontalement aux trois largeurs imposées.
 *
 * Il JUGE : sortie 1 si un contrôle échoue. C'est un test de non-régression,
 * pas un parcours exploratoire.
 *
 * Aucune donnée réelle n'est utilisée : ni producteur, ni téléphone, ni
 * montant, ni coordonnée de parcelle.
 *
 * Usage :
 *   npm install --no-save playwright@1.49.1
 *   node .github/agent-tests/sacherie-navigation.mjs [--preuves dossier/]
 */
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
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

const VIEWPORTS = [
  { nom: 'mobile-390x844', width: 390, height: 844 },
  { nom: 'tablette-768x1024', width: 768, height: 1024 },
  { nom: 'bureau-1440x900', width: 1440, height: 900 }
]

/* ============================================================== Banc d'essai
   Le banc n'est pas un fichier du dépôt : la denylist des agents interdit tout
   fichier HTML, et un banc d'essai n'a de toute façon rien à faire dans
   l'arborescence publiée. Il est servi en mémoire.                         */
const BANC = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Banc d'essai Sacherie</title>
<link rel="stylesheet" href="/shared/anagroci-sacherie.css">
</head><body>
<div id="sacherie-app"></div>
<script>
function iso(j){ return new Date(Date.now() + j*86400000).toISOString(); }

/* Deux noms conçus pour casser l'ancienne navigation : un nom ivoirien courant
   avec apostrophe, et une charge d'injection. */
var CLUSTER_APOSTROPHE = "N'DA";
var CLUSTER_INJECTION = "X'); window.__pwned = 1; //";
var RT_APOSTROPHE = "RT KOFFI N'GUESSAN";

var SNAPSHOT = {
  generated_at: new Date().toISOString(),
  global: { total: 48320, vides: 12480, pleins: 9600, transit: 1840,
            dechires: 1940, a_reparer: 720, repares: 260, rebut: 520 },
  clusters: [
    { cluster: 'BOTRO', total_reseau: 11240, stock_cluster_vide: 4200, stock_chez_rt: 5100,
      stock_chez_producteur: 720, stock_hub_plein: 1220, dechires: 640, a_reparer: 180, rebut: 120,
      physical_stock: 11072, inventory_gap: -168, last_inventory: iso(-4), status: 'CRITIQUE' },
    { cluster: CLUSTER_APOSTROPHE, total_reseau: 10960, stock_cluster_vide: 3900, stock_chez_rt: 4300,
      stock_chez_producteur: 410, stock_hub_plein: 2350, dechires: 520, a_reparer: 160, rebut: 80,
      physical_stock: 10914, inventory_gap: -46, last_inventory: iso(-9), status: 'ATTENTION' },
    { cluster: CLUSTER_INJECTION, total_reseau: 9480, stock_cluster_vide: 3100, stock_chez_rt: 4000,
      stock_chez_producteur: 380, stock_hub_plein: 2000, dechires: 400, a_reparer: 140, rebut: 80,
      physical_stock: null, inventory_gap: null, last_inventory: null, status: 'NORMAL' }
  ],
  rts: [
    { rt_id: 'RT-014', rt_nom: 'RT ADJOUMANI', cluster: 'BOTRO', total_sous_responsabilite: 620,
      vides: 380, pleins: 120, dechires: 90, a_reparer: 20, repares: 5, rebut: 10,
      derniere_activite: iso(-1), risk_level: 'CRITIQUE' },
    { rt_id: "RT-N'GUESSAN", rt_nom: RT_APOSTROPHE, cluster: CLUSTER_APOSTROPHE,
      total_sous_responsabilite: 410, vides: 260, pleins: 80, dechires: 50, a_reparer: 15,
      repares: 2, rebut: 5, derniere_activite: iso(-3), risk_level: 'ATTENTION' }
  ],
  movements: [
    { movement_at: iso(-0.2), movement_type: 'REMISE', source_type: 'EXECUTED', cluster: 'BOTRO',
      rt_id: 'RT-014', qty: 250, from_location: 'AFLP-CL-BOTRO', to_location: 'AFLP-RT-RT-014',
      from_state: 'UTILISABLE', to_state: 'UTILISABLE', reference: 'BAG-2027-BOT-000125' },
    { movement_at: iso(-9), movement_type: 'TRANSFERT', source_type: 'EXECUTED', cluster: CLUSTER_APOSTROPHE,
      rt_id: null, qty: 340, from_location: 'AFLP-CL-NDA', to_location: 'AFLP-HUB-BOUAKE',
      from_state: 'PLEIN', to_state: 'EN_TRANSIT', reference: 'MVT-2027-1184' },
    { movement_at: iso(-2), movement_type: 'ETAT', source_type: 'EXECUTED', cluster: 'BOTRO',
      rt_id: 'RT-014', qty: 180, from_location: 'AFLP-RT-RT-014', to_location: 'AFLP-RT-RT-014',
      from_state: 'DECHIRE', to_state: 'A_REPARER', reference: '' }
  ],
  inventories: [
    { counted_at: iso(-4), cluster: 'BOTRO', scope_type: 'CLUSTER', state: 'UTILISABLE',
      theoretical_qty: 4368, counted_qty: 4200, difference_qty: -168 },
    { counted_at: iso(-1), cluster: CLUSTER_APOSTROPHE, scope_type: 'CLUSTER', state: 'UTILISABLE',
      theoretical_qty: 3902, counted_qty: 3900, difference_qty: -2 }
  ],
  alerts: [ { message: 'Stock cluster sous le seuil de reapprovisionnement', cluster: 'BOTRO', severity: 'ATTENTION' } ]
};

var LOCATIONS = [
  { code: 'AFLP-CL-BOTRO', nom: 'Magasin cluster', cluster: 'BOTRO', scope_type: 'CLUSTER' },
  { code: 'AFLP-RT-RT-014', nom: 'RT ADJOUMANI', cluster: 'BOTRO', scope_type: 'RT' }
];
var PERTES = [
  { id: 'perte-1', cluster: 'BOTRO', location_code: 'AFLP-RT-RT-014', location_name: 'RT ADJOUMANI',
    state: 'UTILISABLE', qty: 60, motif: "Incendie de magasin declare par l'equipe", statut: 'SOUMIS',
    submitted_at: iso(-3) }
];
var REQUESTS = [
  { id: 'req-1', request_code: 'DEM-2027-0412', cluster: 'BOTRO', rt_id: 'RT-014', rt_nom: 'RT ADJOUMANI',
    cycle_id: 'WAVE-2027-BOT-001', stock_rcn_kg_verified: 0, system_max_bags: 27, bags_already_held: 8,
    reserved_approved_bags: 0, max_new_available: 19, requested_qty: 19, approved_qty: null,
    status: 'PENDING_BM', requested_at: iso(-3), expires_at: null },
  { id: 'req-2', request_code: 'DEM-2027-0418', cluster: CLUSTER_APOSTROPHE, rt_id: "RT-N'GUESSAN",
    rt_nom: RT_APOSTROPHE, cycle_id: 'WAVE-2027-NDA-001', stock_rcn_kg_verified: 0,
    system_max_bags: 30, bags_already_held: 4, reserved_approved_bags: 0, max_new_available: 26,
    requested_qty: 400, approved_qty: 400, status: 'APPROVED', requested_at: iso(-6), expires_at: iso(0.9) }
];
var RT_TABLE = [
  { id: 'RT-014', nom: 'RT ADJOUMANI', cluster: 'BOTRO', village_nom: 'Village A', data: {} },
  { id: "RT-N'GUESSAN", nom: RT_APOSTROPHE, cluster: CLUSTER_APOSTROPHE, village_nom: 'Village B', data: {} }
];
var AVANCES = [
  { id: 'av-1', date: '2027-01-12', cluster: 'BOTRO', rt_id: 'RT-014', rt_nom: 'RT ADJOUMANI',
    montant: 800000, statut: 'Active', cycle_id: 'WAVE-2027-BOT-001', volume_finance_kg: 2000,
    prix_reference_kg: 400, cycle_statut: 'OPEN', created_at: iso(-20) }
];

var RPC = {
  sacherie_ct_snapshot: SNAPSHOT,
  sacherie_ct_locations: LOCATIONS,
  sacherie_ct_pertes: PERTES,
  sacherie_mon_contexte: { fonction_operationnelle: 'Unit Head', cluster: 'BOTRO' },
  sacherie_calculer_plafond: { volume_finance_kg: 2000, volume_achete_cycle_kg: 0,
    stock_rcn_kg_verified: 0, system_max_bags: 27, bags_already_held: 8,
    reserved_approved_bags: 0, max_new_available: 19, cluster_stock: 4200 }
};
var TABLES = { rt: RT_TABLE, avances: AVANCES, bag_movement_requests: REQUESTS };
window.__rpcAppels = [];

function requete(rows) {
  var q = {};
  ['select','eq','neq','order','limit','in','is'].forEach(function (k) { q[k] = function () { return q; }; });
  q.then = function (ok, ko) { return Promise.resolve({ data: rows, error: null }).then(ok, ko); };
  return q;
}
window.supabase = { createClient: function () { return {
  rpc: function (nom, args) {
    window.__rpcAppels.push({ nom: nom, args: args || null });
    if (Object.prototype.hasOwnProperty.call(RPC, nom)) return Promise.resolve({ data: RPC[nom], error: null });
    return Promise.resolve({ data: null, error: { message: 'RPC non simulee : ' + nom } });
  },
  from: function (t) { return requete(TABLES[t] || []); }
}; } };

window.ANAGROCI_SUPABASE_URL = 'https://banc-essai.invalid';
window.ANAGROCI_SUPABASE_ANON = 'cle-de-banc-essai';
window.ANAGROCI_MODULE = 'sacs';
window.ANAGROCI_AUTH = { profile: { nom: 'Compte de recette', role: 'Branch Manager' },
  niveau: 'bm', estBM: true, module: 'sacs' };

/* Les boîtes natives sont piégées : le test prouve qu'elles ne servent plus. */
window.__boiteNativeUtilisee = false;
window.prompt = function () { window.__boiteNativeUtilisee = true; return null; };
window.confirm = function () { window.__boiteNativeUtilisee = true; return false; };
</script>
<script src="/shared/anagroci-sacherie-control-tower.js"></script>
<script src="/shared/anagroci-sacherie-control-actions.js"></script>
<script src="/shared/anagroci-sacherie-v2.js"></script>
<script>document.dispatchEvent(new CustomEvent('anagroci:authenticated', { detail: window.ANAGROCI_AUTH }));</script>
</body></html>`

/* ============================================================ Serveur local */
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' }
function servir() {
  return new Promise((resoudre) => {
    const serveur = createServer(async (req, res) => {
      const url = (req.url || '/').split('?')[0]
      if (url === '/' || url === '/banc') {
        res.writeHead(200, { 'content-type': MIME['.html'] })
        return res.end(BANC)
      }
      const chemin = join(RACINE, normalize(url).replace(/^(\.\.[/\\])+/, ''))
      try {
        const contenu = await readFile(chemin)
        const ext = url.slice(url.lastIndexOf('.'))
        res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
        res.end(contenu)
      } catch {
        res.writeHead(404); res.end('introuvable')
      }
    })
    serveur.listen(0, '127.0.0.1', () => resoudre({ serveur, port: serveur.address().port }))
  })
}

/* ==================================================================== Rapport */
const resultats = []
const ok = (quoi, preuve) => resultats.push({ statut: 'ok', quoi, preuve })
const defaut = (quoi, preuve) => resultats.push({ statut: 'defaut', quoi, preuve })
const nonConcluant = (quoi, preuve) => resultats.push({ statut: 'non-concluant', quoi, preuve })

if (!CHROMIUM) {
  console.log('non-concluant : aucun Chromium trouvé sous /opt/pw-browsers.')
  console.log('Ce contrôle n’a PAS été exécuté. Ne le comptez pas comme réussi.')
  process.exit(2)
}

const { serveur, port } = await servir()
const BASE = `http://127.0.0.1:${port}`
const navigateur = await chromium.launch({ executablePath: CHROMIUM })

try {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await contexte.newPage()
  const erreursConsole = []
  page.on('pageerror', (e) => erreursConsole.push(String(e.message || e)))
  await page.goto(`${BASE}/banc`, { waitUntil: 'load' })
  await page.waitForSelector('#sacx .sacx-kpi', { timeout: 15000 })
  await page.waitForTimeout(500)

  /* -------------------------------------------------- 1. Le correctif P0 */
  const pwned = await page.evaluate(() => window.__pwned === undefined ? 'absent' : 'EXECUTE')
  if (pwned === 'absent') ok('Aucune injection exécutée', 'window.__pwned est resté indéfini après le rendu complet')
  else defaut('INJECTION EXÉCUTÉE', 'window.__pwned a été défini : la charge du nom de cluster s’est exécutée')

  await page.click('[data-tab="reseau"]')
  await page.waitForSelector('#sacx table')
  const texteReseau = await page.textContent('#sacxMain')
  if (texteReseau.includes("X'); window.__pwned = 1; //")) {
    ok('Le nom porteur d’une charge est affiché comme texte', 'la chaîne apparaît intégralement dans le tableau réseau')
  } else {
    defaut('Le nom porteur d’une charge n’est pas affiché tel quel',
      'il a été tronqué ou interprété ; vérifiez l’échappement')
  }

  /* Le cas réel : un cluster ivoirien avec apostrophe reste navigable. */
  const ligneApostrophe = page.locator('#sacx tr[data-cluster="N\'DA"]')
  if (await ligneApostrophe.count()) {
    await ligneApostrophe.first().click()
    await page.waitForTimeout(300)
    const apres = await page.textContent('#sacxMain')
    if (apres.includes("KOFFI N'GUESSAN")) {
      ok('Un cluster nommé N’DA reste navigable', 'le clic descend jusqu’aux RT du cluster')
    } else {
      defaut('La navigation casse sur un cluster nommé N’DA', 'le clic ne descend pas jusqu’aux RT')
    }
  } else {
    defaut('Le cluster N’DA n’est pas rendu', 'aucune ligne data-cluster correspondante')
  }

  /* --------------------------------------- 2. Une seule coquille, 5 onglets */
  /* Les KPI vivent sur le pilotage : on y revient avant de les compter. */
  await page.click('[data-tab="pilotage"]')
  await page.waitForSelector('#sacx .sacx-kpi')
  const structure = await page.evaluate(() => ({
    entetes: document.querySelectorAll('#sacx .sacx-head').length,
    barres: document.querySelectorAll('#sacx .sacx-navbar').length,
    onglets: Array.from(document.querySelectorAll('#sacx .sacx-tab')).map((b) => b.textContent.replace(/\\d+$/, '').trim()),
    anciens: ['#sct', '#sv2', '#ctActions', '.ct-hero', '.sv2-head', '.cta-tabs']
      .filter((s) => document.querySelector(s)),
    kpis: document.querySelectorAll('#sacx .sacx-kpi').length
  }))

  if (structure.entetes === 1 && structure.barres === 1) {
    ok('Un seul en-tête et une seule barre de navigation', `${structure.entetes} en-tête, ${structure.barres} barre`)
  } else {
    defaut('Plusieurs en-têtes ou barres de navigation',
      `${structure.entetes} en-tête(s), ${structure.barres} barre(s) — l’empilement de blocs est revenu`)
  }

  const ATTENDUS = ['Pilotage', 'Réseau', 'Flux', 'État du parc', 'Contrôles']
  const libelles = structure.onglets.map((t) => t.replace(/\s*\d+$/, '').trim())
  if (libelles.length === 5 && ATTENDUS.every((a, i) => libelles[i] === a)) {
    ok('Cinq onglets, dans l’ordre cible', libelles.join(' · '))
  } else {
    defaut('La barre de navigation ne porte pas les cinq onglets cibles',
      `trouvé : ${libelles.join(' · ') || '(aucun)'} — attendu : ${ATTENDUS.join(' · ')}`)
  }

  if (!structure.anciens.length) {
    ok('L’ancienne structure en trois blocs a disparu', 'ni #sct, ni #sv2, ni #ctActions, ni leurs bandeaux')
  } else {
    defaut('Des blocs de l’ancienne structure subsistent', structure.anciens.join(' · '))
  }

  if (structure.kpis === 6) ok('Six KPI décisionnels sur le pilotage', '6 cartes, contre douze dont quatre en double')
  else defaut('Le nombre de KPI n’est pas celui de la cible', `${structure.kpis} carte(s) au lieu de 6`)

  /* ------------------------------------------- 3. Chaque onglet s'ouvre */
  for (const onglet of ['pilotage', 'reseau', 'flux', 'parc', 'controles']) {
    await page.click(`[data-tab="${onglet}"]`)
    await page.waitForTimeout(350)
    const etat = await page.evaluate((id) => ({
      selectionne: document.querySelector(`[data-tab="${id}"]`).getAttribute('aria-selected'),
      sections: document.querySelectorAll('#sacxMain [data-section]').length,
      vide: document.getElementById('sacxMain').textContent.trim().length
    }), onglet)
    if (etat.selectionne === 'true' && etat.sections > 0 && etat.vide > 40) {
      ok(`Onglet ${onglet} : s’ouvre et rend du contenu`, `${etat.sections} section(s)`)
    } else {
      defaut(`Onglet ${onglet} : ne rend rien d’exploitable`,
        `aria-selected=${etat.selectionne}, ${etat.sections} section(s), ${etat.vide} caractère(s)`)
    }
  }

  /* --------------------------------- 4. File de décision unique et badge */
  await page.click('[data-tab="pilotage"]')
  await page.waitForTimeout(300)
  const decision = await page.evaluate(() => ({
    items: document.querySelectorAll('#sacxMain [data-decide]').length,
    badge: (document.querySelector('[data-badge="flux"]') || {}).textContent || '',
    badgeVisible: !(document.querySelector('[data-badge="flux"]') || { hidden: true }).hidden,
    total: window.ANAGROCI_SACHERIE_SHELL.decisions().length
  }))
  if (decision.items >= 2) {
    ok('La bande « À décider » agrège plusieurs sources', `${decision.items} groupe(s) : demandes, pertes, expirations`)
  } else {
    defaut('La bande « À décider » n’agrège pas les deux files',
      `${decision.items} groupe(s) — les demandes et les pertes doivent y figurer ensemble`)
  }
  if (decision.badgeVisible && decision.badge === String(decision.total) && decision.total > 0) {
    ok('Le badge de l’onglet Flux porte le nombre de décisions', `${decision.badge} en attente`)
  } else {
    defaut('Le badge de décisions est absent ou faux',
      `badge="${decision.badge}", visible=${decision.badgeVisible}, décisions=${decision.total}`)
  }

  /* ------------------------------- 5. Un seul bouton « Nouvelle opération » */
  await page.click('#sacxOpsBtn')
  await page.waitForTimeout(200)
  const ops = await page.$$eval('#sacxOpsMenu [data-op] .t', (n) => n.map((x) => x.textContent.trim()))
  const OPS_ATTENDUES = ['Demande de sacs', 'Comptage physique', 'Traiter des sacs abîmés', 'Déclarer une perte']
  if (OPS_ATTENDUES.every((o) => ops.includes(o))) {
    ok('Le menu « Nouvelle opération » porte les quatre opérations', ops.join(' · '))
  } else {
    defaut('Le menu « Nouvelle opération » est incomplet', `trouvé : ${ops.join(' · ') || '(aucune)'}`)
  }
  await page.keyboard.press('Escape')

  /* ------------------- 6. Une décision ouvre un panneau, pas une boîte native */
  await page.click('[data-tab="flux"]')
  await page.waitForSelector('#sacxMain [data-decide], #sacxMain table')
  await page.waitForTimeout(300)
  const boutonDecider = page.locator('#sacxMain [data-decide]').first()
  if (await boutonDecider.count()) {
    await boutonDecider.click()
    await page.waitForTimeout(400)
    const panneau = await page.evaluate(() => ({
      ouvert: !!document.querySelector('.sacx-panel'),
      titre: (document.querySelector('.sacx-panel header b') || {}).textContent || '',
      recap: !!document.querySelector('.sacx-panel .sacx-recap'),
      primaires: document.querySelectorAll('.sacx-panelfoot .sacx-btn:not(.secondary)').length,
      natif: window.__boiteNativeUtilisee
    }))
    if (panneau.ouvert && panneau.recap && !panneau.natif) {
      ok('Une décision ouvre un panneau contextualisé', `« ${panneau.titre} », avec récapitulatif, sans boîte native`)
    } else {
      defaut('La décision ne passe pas par un panneau contextualisé',
        `panneau=${panneau.ouvert}, récapitulatif=${panneau.recap}, boîte native=${panneau.natif}`)
    }
    if (panneau.primaires === 1) {
      ok('Une seule action primaire dans le panneau de décision', 'les autres actions sont secondaires')
    } else {
      defaut('Le panneau de décision a plusieurs actions primaires',
        `${panneau.primaires} boutons pleins — quatre poids visuels égaux étaient le défaut d’origine`)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  } else {
    nonConcluant('Aucune décision à ouvrir', 'la file de décision est vide dans le jeu d’essai')
  }

  /* ----------------------------------- 7. Trois largeurs, aucun débordement */
  for (const vp of VIEWPORTS) {
    const p = await contexte.newPage()
    await p.setViewportSize({ width: vp.width, height: vp.height })
    await p.goto(`${BASE}/banc`, { waitUntil: 'load' })
    await p.waitForSelector('#sacx .sacx-kpi', { timeout: 15000 })
    await p.waitForTimeout(400)
    const mesure = await p.evaluate(() => ({
      corps: document.documentElement.scrollWidth,
      fenetre: window.innerWidth,
      kpiParRangee: (() => {
        const grille = document.querySelector('#sacx .sacx-kpis')
        if (!grille) return 0
        return getComputedStyle(grille).gridTemplateColumns.split(' ').length
      })()
    }))
    if (mesure.corps <= mesure.fenetre + 1) {
      ok(`${vp.nom} : aucun débordement horizontal de la page`, `${mesure.corps} px pour ${mesure.fenetre} px utiles`)
    } else {
      defaut(`${vp.nom} : la page déborde horizontalement`,
        `${mesure.corps} px pour ${mesure.fenetre} px utiles`)
    }
    if (vp.width === 768 && mesure.kpiParRangee >= 3) {
      ok('tablette-768x1024 : trois colonnes de KPI', `${mesure.kpiParRangee} colonnes, contre deux avant la refonte`)
    } else if (vp.width === 768) {
      defaut('tablette-768x1024 : la tablette est servie comme un téléphone',
        `${mesure.kpiParRangee} colonne(s) de KPI`)
    }
    if (PREUVES) {
      await mkdir(PREUVES, { recursive: true })
      await p.screenshot({ path: join(PREUVES, `sacherie-${vp.nom}.png`), fullPage: false })
    }
    await p.close()
  }

  /* ------------------------------------------ 8. Aucune erreur JavaScript */
  if (!erreursConsole.length) ok('Aucune erreur JavaScript pendant le parcours', 'console sans pageerror')
  else defaut(`${erreursConsole.length} erreur(s) JavaScript`, erreursConsole.slice(0, 3).join(' · '))

  if (PREUVES) {
    await writeFile(join(PREUVES, 'sacherie-navigation.json'), JSON.stringify(resultats, null, 2))
  }
} finally {
  await navigateur.close()
  serveur.close()
}

const defauts = resultats.filter((r) => r.statut === 'defaut')
const nonConcluants = resultats.filter((r) => r.statut === 'non-concluant')
for (const r of resultats) {
  console.log(`${r.statut === 'ok' ? '·' : r.statut === 'defaut' ? '✗' : '?'} ${r.quoi}`)
  console.log(`    ${r.preuve}`)
}
console.log('')
console.log(`${resultats.length} contrôle(s) · ${defauts.length} défaut(s) · ${nonConcluants.length} non concluant(s)`)
if (defauts.length) process.exit(1)
