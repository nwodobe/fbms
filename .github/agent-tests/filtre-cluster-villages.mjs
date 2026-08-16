#!/usr/bin/env node
/**
 * Non-régression du filtre Cluster de la Base de données villages
 * (`fbms/index.html`, vue « Référentiel > Base de données »).
 *
 * Ce contrôle OUVRE réellement la page dans Chromium, aux trois largeurs
 * imposées par la politique, puis exerce le filtre. Il ne lit pas le code : sur
 * FBMS, `shared/uppercase.js` injecte des scripts dynamiquement et la lecture
 * seule ne prouve rien.
 *
 * Le jeu d'essai est SYNTHÉTIQUE — villages, clusters et enquêteurs inventés.
 * Aucune donnée réelle (nom de producteur, téléphone, montant, coordonnée de
 * parcelle) n'y figure, conformément à la règle 4 de CLAUDE.md.
 *
 * Il reprend le serveur statique local et les doublures de
 * `.github/scripts/verifier-pages.mjs` : mêmes conditions que la porte
 * existante, sans dépendre de la disponibilité d'un CDN tiers.
 *
 * Usage :
 *   npm install --no-save playwright@1.49.1
 *   node .github/agent-tests/filtre-cluster-villages.mjs
 *
 * Ce fichier n'est PAS branché sur `agent-quality-gates.yml` : le workflow
 * n'appelle nommément que `politique-chemins.mjs`, et `.github/workflows/**`
 * est interdit aux agents. C'est une recette rejouable à la main, pas une
 * porte de fusion — le dire est préférable à le laisser croire.
 *
 * Sortie : 0 si tout passe, 1 sinon.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const RACINE = process.cwd()
const PORT = Number(process.env.PORT_FBMS ?? 4327)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

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

const VIEWPORTS = [
  { nom: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { nom: 'tablette-768x1024', width: 768, height: 1024, mobile: true },
  { nom: 'bureau-1440x900', width: 1440, height: 900, mobile: false },
]

/**
 * Écarts console DÉJÀ présents sur `main`, vérifiés en retirant la
 * modification : `fbms/index.html` demande `./manifest.webmanifest` et
 * `./icon-192.png` en relatif, donc 404 réelles (CLAUDE.md §6). Les afficher
 * en remarque plutôt que les taire ; les compter en échec rendrait cette
 * recette rouge pour un défaut qu'elle ne traite pas.
 */
const CONSOLE_HERITEE = /Failed to load resource.*40[34]|favicon|manifest|icon-192/i

let echecs = 0
let remarques = 0

for (const viewport of VIEWPORTS) {
  const contexte = await navigateur.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    locale: 'fr-FR',
    serviceWorkers: 'block',
  })
  const onglet = await contexte.newPage()

  const messagesConsole = []
  onglet.on('console', (m) => { if (m.type() === 'error') messagesConsole.push(m.text().slice(0, 200)) })
  onglet.on('pageerror', (e) => messagesConsole.push('JS : ' + String(e.message).slice(0, 200)))

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

  const resultat = await onglet.evaluate(() => {
    const res = { cas: [], exceptions: [] }
    const ok = (nom, attendu, obtenu) => {
      res.cas.push({ nom, bon: JSON.stringify(attendu) === JSON.stringify(obtenu), attendu, obtenu })
    }

    // --- Jeu d'essai synthétique -------------------------------------------
    // Le champ cluster est volontairement bruité : casse variable, espaces de
    // bord, chaîne vide, null, et une fiche où la clé n'existe pas du tout.
    const fiches = [
      { village: 'ESSAI-ALPHA',   cluster: ' diabo ', region: 'Gbêkê',  dep: 'DEP-1', enq: 'ENQ-1', pot: 100, camion: true },
      { village: 'ESSAI-BRAVO',   cluster: 'DIABO',   region: 'Gbêkê',  dep: 'DEP-1', enq: 'ENQ-2', pot: 200, camion: false },
      { village: 'ESSAI-CHARLIE', cluster: 'Diabo',   region: 'Hambol', dep: 'DEP-2', enq: 'ENQ-1', pot: 300, camion: true },
      { village: 'ESSAI-DELTA',   cluster: 'BEOUMI',  region: 'Gbêkê',  dep: 'DEP-1', enq: 'ENQ-3', pot: 400, camion: true },
      { village: 'ESSAI-ECHO',    cluster: 'ANDO',    region: 'Hambol', dep: 'DEP-2', enq: 'ENQ-2', pot: 500, camion: false },
      { village: 'ESSAI-FOXTROT', cluster: '',        region: 'Gbêkê',  dep: 'DEP-1', enq: 'ENQ-1', pot: 600, camion: true },
      { village: 'ESSAI-GOLF',    cluster: null,      region: 'Hambol', dep: 'DEP-2', enq: 'ENQ-3', pot: 700, camion: false },
    ]
    STATE.villages = fiches.map((f, i) => {
      const v = blankVillage()
      v.id = 'essai_' + i
      v.s1.village = f.village
      v.s1.cluster = f.cluster
      v.s1.region = f.region
      v.s1.departement = f.dep
      v.s1.enqueteur = f.enq
      v.s3.potentielMT = f.pot
      v.s3.nbProducteurs = 100
      v.s3.prodMoyenneKg = 200
      v.s5.camion10T = f.camion
      return v
    })
    const orpheline = blankVillage()
    orpheline.id = 'essai_orphelin'
    orpheline.s1.village = 'ESSAI-HOTEL'
    orpheline.s1.region = 'Gbêkê'
    orpheline.s1.departement = 'DEP-1'
    orpheline.s1.enqueteur = 'ENQ-1'
    delete orpheline.s1.cluster
    STATE.villages.push(orpheline)

    const noms = () => getFilteredVillages().map((x) => x.v.s1.village).sort()
    const raz = () => {
      STATE.query = ''
      STATE.regionFilter = ''
      STATE.clusterFilter = ''
      STATE.tierFilter = ''
      STATE.statutFilter = ''
      STATE.camionOnly = false
      STATE.page = 1
    }

    try {
      // 1. Liste construite depuis les données : dédupliquée, triée, sans vide.
      ok('options générées dynamiquement, triées, dédupliquées',
        ['ANDO', 'BEOUMI', 'DIABO'], villageClusterOptions())

      // 2. Normalisation : casse et espaces de bord n'empêchent pas la sélection.
      raz(); STATE.clusterFilter = 'DIABO'
      ok('cluster DIABO seul', ['ESSAI-ALPHA', 'ESSAI-BRAVO', 'ESSAI-CHARLIE'], noms())

      // 3-7. Logique ET avec chacun des autres filtres, puis en combinaison.
      raz(); STATE.clusterFilter = 'DIABO'; STATE.regionFilter = 'Gbêkê'
      ok('cluster ET région', ['ESSAI-ALPHA', 'ESSAI-BRAVO'], noms())

      raz(); STATE.clusterFilter = 'DIABO'; STATE.query = 'ALPHA'
      ok('cluster ET recherche village', ['ESSAI-ALPHA'], noms())

      raz(); STATE.clusterFilter = 'DIABO'; STATE.query = 'DELTA'
      ok('cluster ET recherche hors cluster → vide', [], noms())

      raz(); STATE.clusterFilter = 'DIABO'; STATE.camionOnly = true
      ok('cluster ET camion 10T', ['ESSAI-ALPHA', 'ESSAI-CHARLIE'], noms())

      raz(); STATE.clusterFilter = 'DIABO'; STATE.regionFilter = 'Gbêkê'; STATE.camionOnly = true
      ok('région ET cluster ET camion 10T', ['ESSAI-ALPHA'], noms())

      // 8. Retour à « Tous les clusters » : les autres filtres restent actifs.
      raz(); STATE.regionFilter = 'Gbêkê'; STATE.clusterFilter = 'DIABO'
      const restreint = noms().length
      STATE.clusterFilter = ''
      ok('« Tous les clusters » réaffiche selon les autres filtres',
        ['ESSAI-ALPHA', 'ESSAI-BRAVO', 'ESSAI-DELTA', 'ESSAI-FOXTROT', 'ESSAI-HOTEL'], noms())
      ok('… la sélection précédente était bien plus restreinte', 2, restreint)

      // 9. Cluster inconnu : zéro ligne, aucune exception.
      raz(); STATE.clusterFilter = 'CLUSTER-INEXISTANT'
      ok('cluster inconnu → aucun village', [], noms())

      // 10. Les exports lisent la même source que le tableau.
      raz(); STATE.clusterFilter = 'BEOUMI'
      ok('exports Excel/CSV/JSON alimentés par les filtres actifs',
        ['ESSAI-DELTA'], getFilteredVillages().map((x) => x.v.s1.village))

      // 11. Le tri n'est pas cassé par le filtre.
      raz(); STATE.clusterFilter = 'DIABO'; STATE.sortKey = 'potentiel'; STATE.sortDir = 'desc'
      ok('tri par potentiel conservé sous filtre cluster',
        [300, 200, 100], getFilteredVillages().map((x) => Number(x.v.s3.potentielMT)))
      STATE.sortKey = 'score'; STATE.sortDir = 'desc'

      // 12. Barre de filtres : ordre et libellés attendus.
      raz(); STATE.active = 'database'
      const html = DatabaseView()
      ok('ordre de la barre de filtres',
        ['Toutes régions', 'Tous les clusters', 'Tous classements', 'Tous statuts'],
        [...html.matchAll(/<option value="">([^<]+)<\/option>/g)].map((m) => m[1]))
      ok('le select cluster expose les clusters de la base', true,
        /<option value="DIABO"/.test(html) && /<option value="BEOUMI"/.test(html) && /<option value="ANDO"/.test(html))

      // 13-15. Rendu réel sous filtre, état persistant, vue fiche.
      STATE.clusterFilter = 'DIABO'
      const rendu = DatabaseView()
      ok('le tableau rendu ne contient que le cluster choisi', true,
        rendu.includes('ESSAI-ALPHA') && !rendu.includes('ESSAI-DELTA'))
      ok('l\'option choisie reste marquée selected au re-rendu', true,
        /<option value="DIABO" selected>/.test(rendu))
      STATE.dbView = 'card'
      const carte = DatabaseView()
      ok('vue fiche filtrée elle aussi', true,
        carte.includes('ESSAI-ALPHA') && !carte.includes('ESSAI-DELTA'))
      STATE.dbView = 'table'

      // 16. Le setter remet la pagination à 1 et re-rend sans recharger la page.
      raz(); STATE.page = 3
      setClusterFilter('BEOUMI')
      ok('setClusterFilter réinitialise la pagination', 1, STATE.page)
      ok('setClusterFilter alimente l\'état', 'BEOUMI', STATE.clusterFilter)
      raz(); renderContent()
    } catch (e) {
      res.exceptions.push('EXCEPTION : ' + e.message)
    }
    return res
  })

  const rates = resultat.cas.filter((c) => !c.bon)
  const heritees = messagesConsole.filter((m) => CONSOLE_HERITEE.test(m))
  const nouvelles = messagesConsole.filter((m) => !CONSOLE_HERITEE.test(m))

  console.log(`\n── ${viewport.nom} ──`)
  for (const c of resultat.cas) {
    console.log(`  ${c.bon ? '✓' : '✗'} ${c.nom}`)
    if (!c.bon) console.log(`      attendu ${JSON.stringify(c.attendu)}\n      obtenu  ${JSON.stringify(c.obtenu)}`)
  }
  for (const e of resultat.exceptions) console.log(`  ✗ ${e}`)
  console.log(`  ${nouvelles.length === 0 ? '✓' : '✗'} console sans nouvelle erreur${nouvelles.length ? ' — ' + nouvelles.join(' | ') : ''}`)
  for (const h of heritees) console.log(`  ~ historique ${h}`)

  echecs += rates.length + resultat.exceptions.length + nouvelles.length
  remarques += heritees.length
  await contexte.close()
}

await navigateur.close()
serveur.close()

console.log(`\n${VIEWPORTS.length} largeur(s) · ${echecs} échec(s) · ${remarques} écart(s) historique(s)`)
process.exit(echecs === 0 ? 0 : 1)
