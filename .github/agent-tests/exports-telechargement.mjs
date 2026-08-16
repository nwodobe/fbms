#!/usr/bin/env node
/**
 * Non-régression du téléchargement des exports de `fbms/index.html`.
 *
 * Défaut corrigé : deux fonctions `downloadBlob` étaient déclarées dans le même
 * script, avec des signatures incompatibles — `(blob, filename)` et
 * `(content, mime, filename)`. La seconde déclaration l'emportant, les appels
 * d'`exportCSV()` et `exportJSON()` voyaient leur nom de fichier atterrir dans
 * le paramètre `mime`, et `filename` restait undefined. Les deux exports
 * sortaient un fichier « undefined.txt », le second écrasant le premier.
 *
 * Le contenu, lui, était correct : un Blob imbriqué dans un Blob conserve ses
 * octets. C'est pourquoi ce contrôle vérifie le NOM du fichier et pas seulement
 * sa présence — un test qui n'aurait regardé que le contenu serait resté vert.
 *
 * Le téléchargement ne dépend pas de la largeur de la fenêtre : ce contrôle
 * s'exécute à une seule largeur (1440×900), contrairement aux contrôles d'inter-
 * face qui en exigent trois.
 *
 * L'export Excel n'est pas couvert : il passe par `XLSX.writeFile`, que la
 * doublure SheetJS du harnais ne met pas en œuvre. Le dire plutôt que de
 * laisser croire à une couverture complète.
 *
 * Usage :
 *   npm install --no-save playwright@1.49.1
 *   node .github/agent-tests/exports-telechargement.mjs
 *
 * Comme `filtre-cluster-villages.mjs`, ce fichier n'est pas branché sur
 * `agent-quality-gates.yml` : `.github/workflows/**` est interdit aux agents.
 *
 * Sortie : 0 si tout passe, 1 sinon.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const RACINE = process.cwd()
const PORT = Number(process.env.PORT_FBMS ?? 4371)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

const cas = []
const ok = (nom, attendu, obtenu) => {
  cas.push({ nom, bon: JSON.stringify(attendu) === JSON.stringify(obtenu), attendu, obtenu })
}

// --- Contrôle statique : le doublon ne doit pas revenir ----------------------
// C'est la cause racine. Une page qui redéclare la même fonction ne lève aucune
// erreur en mode script : rien ne le signalerait à la prochaine régression.
const source = readFileSync('fbms/index.html', 'utf8')
ok('une seule déclaration de downloadBlob',
  1, (source.match(/function downloadBlob\s*\(/g) || []).length)

const serveur = createServer((requete, reponse) => {
  const chemin = decodeURIComponent(new URL(requete.url, 'http://x').pathname)
  let fichier = join(RACINE, normalize(chemin).replace(/^(\.\.[/\\])+/, ''))
  if (existsSync(fichier) && statSync(fichier).isDirectory()) fichier = join(fichier, 'index.html')
  if (!existsSync(fichier)) {
    reponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    reponse.end('introuvable')
    return
  }
  reponse.writeHead(200, { 'Content-Type': TYPES[extname(fichier)] ?? 'application/octet-stream' })
  reponse.end(readFileSync(fichier))
})
await new Promise((resolve) => serveur.listen(PORT, '127.0.0.1', resolve))

const DOUBLURES = [
  { motif: /supabase/i, fichier: '.github/vendor/doublures/supabase.js' },
  { motif: /lucide/i, fichier: '.github/vendor/doublures/lucide.js' },
  { motif: /tailwindcss/i, fichier: '.github/vendor/doublures/tailwind.js' },
  { motif: /leaflet|markercluster/i, fichier: '.github/vendor/doublures/leaflet.js' },
  { motif: /xlsx|sheetjs/i, fichier: '.github/vendor/doublures/xlsx.js' },
]
  .filter((d) => existsSync(d.fichier))
  .map((d) => ({ ...d, corps: readFileSync(d.fichier, 'utf8') }))

const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const navigateur = await chromium.launch({
  executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
})
const contexte = await navigateur.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'fr-FR',
  serviceWorkers: 'block',
  acceptDownloads: true,
})
const onglet = await contexte.newPage()

const erreurs = []
onglet.on('pageerror', (e) => erreurs.push(String(e.message).slice(0, 200)))

await onglet.route('**/*', (route) => {
  const url = route.request().url()
  if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue()
  const doublure = DOUBLURES.find((d) => d.motif.test(url))
  if (doublure) {
    return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: doublure.corps })
  }
  return route.fulfill({ status: 204, body: '' })
})

await onglet.goto(`http://127.0.0.1:${PORT}/fbms/index.html`, { waitUntil: 'domcontentloaded' })
await onglet.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
await onglet.waitForTimeout(1200)

// Jeu d'essai synthétique — aucune donnée réelle.
await onglet.evaluate(() => {
  STATE.villages = ['ESSAI-ALPHA', 'ESSAI-BRAVO'].map((nom, i) => {
    const v = blankVillage()
    v.id = 'essai_' + i
    v.s1.village = nom
    v.s1.cluster = i === 0 ? 'DIABO' : 'BEOUMI'
    v.s1.region = 'Gbêkê'
    v.s1.departement = 'DEP-1'
    v.s1.enqueteur = 'ENQ-1'
    v.s3.potentielMT = 100 * (i + 1)
    v.s3.nbProducteurs = 100
    v.s3.prodMoyenneKg = 200
    return v
  })
  STATE.active = 'database'
  STATE.clusterFilter = ''
  renderContent()
})

/** Déclenche une fonction de la page et rend le téléchargement obtenu. */
async function telecharger(expression) {
  const [dl] = await Promise.all([
    onglet.waitForEvent('download', { timeout: 6000 }).catch(() => null),
    onglet.evaluate(expression),
  ])
  if (!dl) return null
  const chemin = await dl.path()
  return {
    nom: dl.suggestedFilename(),
    contenu: chemin ? readFileSync(chemin, 'utf8') : '',
  }
}

// --- 1. exportCSV : nom correct, en-tête présent ----------------------------
const csv = await telecharger(() => window.exportCSV())
ok('exportCSV nomme le fichier', 'anagroci_villages.csv', csv?.nom)
ok('exportCSV écrit bien l\'en-tête', true, csv?.contenu.startsWith('Village,Région,Département'))
ok('exportCSV sépare les lignes en CRLF (RFC 4180)', true, /\r\n/.test(csv?.contenu ?? ''))

// --- 2. exportJSON : nom correct, JSON analysable ---------------------------
const json = await telecharger(() => window.exportJSON())
ok('exportJSON nomme le fichier', 'anagroci_villages.json', json?.nom)
let analysable = false
try { analysable = Array.isArray(JSON.parse(json?.contenu ?? '')) } catch { analysable = false }
ok('exportJSON produit un tableau JSON analysable', true, analysable)

// --- 3. Les deux exports ne portent pas le MÊME nom -------------------------
// C'était le symptôme le plus coûteux : le second téléchargement écrasait le
// premier dans le dossier de l'utilisateur.
ok('CSV et JSON ne s\'écrasent pas', true, csv?.nom !== json?.nom)

// --- 4. Les exports suivent les filtres actifs ------------------------------
await onglet.evaluate(() => { setClusterFilter('DIABO') })
const csvFiltre = await telecharger(() => window.exportCSV())
ok('export CSV filtré : ne garde que le cluster choisi', true,
  (csvFiltre?.contenu ?? '').includes('ESSAI-ALPHA') && !(csvFiltre?.contenu ?? '').includes('ESSAI-BRAVO'))

// --- 5. Chemin de la sauvegarde master --------------------------------------
// `exporterMaster()` exige une session Supabase réelle, hors de portée de ce
// harnais. On exerce donc directement l'appel qu'elle effectue — c'est la ligne
// modifiée par le correctif, et la seule qui utilisait l'ancienne signature.
await onglet.evaluate(() => { setClusterFilter('') })
const master = await telecharger(() =>
  window.downloadBlob(new Blob([JSON.stringify({ essai: true }, null, 1)], { type: 'application/json' }), 'FBMS_MASTER_essai.json'))
ok('sauvegarde master nommée correctement', 'FBMS_MASTER_essai.json', master?.nom)
ok('sauvegarde master : contenu intact', true, (master?.contenu ?? '').includes('"essai"'))

await navigateur.close()
serveur.close()

for (const c of cas) {
  console.log(`  ${c.bon ? '✓' : '✗'} ${c.nom}`)
  if (!c.bon) console.log(`      attendu ${JSON.stringify(c.attendu)}\n      obtenu  ${JSON.stringify(c.obtenu)}`)
}
for (const e of erreurs) console.log(`  ✗ erreur JS : ${e}`)

const echecs = cas.filter((c) => !c.bon).length + erreurs.length
console.log(`\n${cas.length} cas · ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
