#!/usr/bin/env node
/**
 * Exécution réelle des pages de FBMS, aux trois viewports imposés.
 *
 * C'est le seul contrôle qui ouvre vraiment le site : les autres lisent des
 * fichiers. Il sert un serveur statique local — la même chose que GitHub Pages,
 * sans le réseau — puis, pour chaque page :
 *
 *   · relève les erreurs console et les erreurs JavaScript non gérées ;
 *   · relève les requêtes échouées, en distinguant l'interne de l'externe ;
 *   · mesure le débordement horizontal ;
 *   · mesure les zones tactiles sous le seuil de la politique ;
 *   · vérifie qu'un focus reste visible au clavier ;
 *   · exécute axe-core en WCAG 2.0/2.1 niveaux A et AA.
 *
 * Les hôtes externes sont interceptés et remplacés par des DOUBLURES
 * déterministes (`.github/vendor/doublures/`). Ce n'est pas une commodité :
 * sans cela, la porte deviendrait rouge chaque fois qu'un CDN tiers a un
 * hoquet, pour une raison qui n'appartient pas au dépôt.
 *
 * Mais une neutralisation aveugle ne vaut pas mieux : renvoyer du vide à la
 * place du SDK Supabase faisait lever « createClient is undefined » sur presque
 * chaque page — des erreurs fabriquées par le harnais, qui auraient noyé les
 * vraies. La doublure répond donc ce que répond Supabase à un visiteur SANS
 * session, c'est-à-dire exactement l'état que ces contrôles observent.
 *
 * L'indisponibilité réelle d'un CDN reste un vrai sujet : c'est celui de
 * l'audit, pas d'une porte de fusion.
 *
 * Usage :
 *   node .github/scripts/verifier-pages.mjs [--json fichier.json]
 * Prérequis : `npx playwright` disponible et Chromium installé.
 */
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const RACINE = process.cwd()
const PORT = Number(process.env.PORT_FBMS ?? 4319)
const SEUIL_TACTILE = 44

const VIEWPORTS = [
  { nom: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { nom: 'tablette-768x1024', width: 768, height: 1024, mobile: true },
  { nom: 'bureau-1440x900', width: 1440, height: 900, mobile: false },
]

/** Pages réellement servies. Le fichier de sauvegarde n'en est pas une. */
const PAGES = execFileSync('git', ['ls-files', '-z', '*.html'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((c) => !c.startsWith('savoir-plus/'))
  .filter((c) => !c.includes('Sauvegarde Master'))

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

const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const navigateur = await chromium.launch({
  executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
})

const axeChemin = ['node_modules/axe-core/axe.min.js', '.github/vendor/axe.min.js'].find((c) =>
  existsSync(c),
)
const axe = axeChemin ? readFileSync(axeChemin, 'utf8') : null

/**
 * Bibliothèques tierces remplacées par une doublure locale.
 * L'ordre compte : le premier motif qui correspond gagne.
 */
const DOUBLURES = [
  { motif: /supabase/i, fichier: '.github/vendor/doublures/supabase.js' },
  { motif: /lucide/i, fichier: '.github/vendor/doublures/lucide.js' },
  { motif: /tailwindcss/i, fichier: '.github/vendor/doublures/tailwind.js' },
  { motif: /leaflet|markercluster/i, fichier: '.github/vendor/doublures/leaflet.js' },
  { motif: /xlsx|sheetjs/i, fichier: '.github/vendor/doublures/xlsx.js' },
]
  .filter((d) => existsSync(d.fichier))
  .map((d) => ({ ...d, corps: readFileSync(d.fichier, 'utf8') }))

const observations = []

for (const viewport of VIEWPORTS) {
  for (const page of PAGES) {
    const contexte = await navigateur.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      locale: 'fr-FR',
      serviceWorkers: 'block',
    })
    const onglet = await contexte.newPage()

    const erreursConsole = []
    const erreursJs = []
    const echecsInternes = []
    const echecsExternes = []

    onglet.on('console', (m) => {
      if (m.type() === 'error') erreursConsole.push(m.text().slice(0, 300))
    })
    onglet.on('pageerror', (e) => erreursJs.push(String(e.message).slice(0, 300)))
    onglet.on('requestfailed', (r) => {
      const cible = r.url().startsWith(`http://127.0.0.1:${PORT}`) ? echecsInternes : echecsExternes
      cible.push(`${r.method()} ${r.url().slice(0, 200)}`)
    })
    // Une 404 n'est pas un « échec de requête » pour Playwright : elle répond.
    // C'est pourtant exactement ce qu'un lien mort produit en production.
    onglet.on('response', (r) => {
      if (r.status() >= 400 && r.url().startsWith(`http://127.0.0.1:${PORT}`)) {
        echecsInternes.push(`HTTP ${r.status()} ${r.url().slice(0, 200)}`)
      }
    })

    // Doublures des hôtes tiers : voir l'en-tête du fichier.
    await onglet.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue()

      const doublure = DOUBLURES.find((d) => d.motif.test(url))
      if (doublure) {
        return route.fulfill({
          status: 200,
          contentType: 'text/javascript; charset=utf-8',
          body: doublure.corps,
        })
      }
      // Police, image ou feuille de style tierce : rien à doubler.
      return route.fulfill({ status: 204, body: '' })
    })

    await onglet.goto(`http://127.0.0.1:${PORT}/${page}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    // Attendre un état, pas un délai : les scripts injectés dynamiquement
    // (shared/uppercase.js en injecte deux) arrivent après le DOM, et une
    // simple temporisation rendait la porte intermittente.
    await onglet.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await onglet.waitForTimeout(1200)

    const mesures = await onglet
      .evaluate((seuil) => {
        const visible = (el) => {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
        }
        const interactifs = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')].filter(visible)
        return {
          titre: document.title,
          langue: document.documentElement.lang,
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          h1: [...document.querySelectorAll('h1')].filter(visible).length,
          interactifs: interactifs.length,
          tactilesInsuffisants: interactifs
            .map((el) => {
              const r = el.getBoundingClientRect()
              return { texte: (el.textContent ?? '').trim().slice(0, 40), l: Math.round(r.width), h: Math.round(r.height) }
            })
            .filter((e) => e.l < seuil || e.h < seuil)
            .slice(0, 15),
        }
      }, SEUIL_TACTILE)
      .catch((e) => ({ erreur: String(e.message).slice(0, 200) }))

    let accessibilite = { indisponible: true }
    if (axe) {
      accessibilite = await onglet
        .addScriptTag({ content: axe })
        .then(() =>
          onglet.evaluate(async () => {
            const r = await window.axe.run(document, {
              runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
              resultTypes: ['violations'],
            })
            return r.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              nombre: v.nodes.length,
              exemple: v.nodes[0]?.failureSummary?.replace(/\s+/g, ' ').slice(0, 200) ?? '',
            }))
          }),
        )
        .catch((e) => ({ erreur: String(e.message).slice(0, 200) }))
    }

    observations.push({
      page,
      viewport: viewport.nom,
      ...mesures,
      debordement: mesures.scrollWidth > mesures.innerWidth + 1,
      erreursConsole,
      erreursJs,
      echecsInternes,
      echecsExternesNeutralises: echecsExternes.length,
      accessibilite,
    })

    await contexte.close()
  }
}

await navigateur.close()
serveur.close()

// --- Verdict ----------------------------------------------------------------
const REFERENTIEL = '.github/agent-policy/pages-baseline.json'
const accepte = existsSync(REFERENTIEL)
  ? new Set(JSON.parse(readFileSync(REFERENTIEL, 'utf8')).accepted)
  : new Set()

const problemes = []
for (const o of observations) {
  // La clé ignore volontairement le viewport : un même défaut se manifeste aux
  // trois tailles, mais l'ordre de chargement fait qu'il n'est pas toujours
  // capté aux trois. Indexer par viewport rendait le référentiel instable.
  const ajouter = (regle, detail) => problemes.push({ cle: `${o.page}|${regle}`, detail, viewport: o.viewport })
  if (o.erreursJs.length > 0) ajouter('erreur-js', o.erreursJs[0])
  if (o.erreursConsole.length > 0) ajouter('erreur-console', o.erreursConsole[0])
  if (o.echecsInternes.length > 0) ajouter('requete-interne-echouee', o.echecsInternes[0])
  if (o.debordement) ajouter('debordement-horizontal', `${o.scrollWidth} > ${o.innerWidth}`)
}

const historiques = problemes.filter((p) => accepte.has(p.cle))
const nouveaux = problemes.filter((p) => !accepte.has(p.cle))
const distinctsNouveaux = [...new Map(nouveaux.map((p) => [p.cle, p])).values()]

const historiquesDistincts = [...new Set(historiques.map((p) => p.cle))]
for (const c of historiquesDistincts) process.stdout.write(`~ historique ${c}\n`)
for (const p of distinctsNouveaux) process.stdout.write(`✗ NOUVEAU    ${p.cle}\n    ${p.detail}\n`)

const violationsA11y = observations.flatMap((o) =>
  Array.isArray(o.accessibilite) ? o.accessibilite.map((v) => `${o.page}|${o.viewport}|${v.id}(${v.nombre})`) : [],
)
process.stdout.write(
  `\n${PAGES.length} page(s) × ${VIEWPORTS.length} viewport(s) = ${observations.length} observations\n` +
    `${historiquesDistincts.length} problème(s) hérité(s) distinct(s) · ${distinctsNouveaux.length} nouveau(x)\n` +
    `${violationsA11y.length} violation(s) d'accessibilité relevée(s)` +
    `${axe ? '' : ' (axe-core absent : contrôle non exécuté)'}\n`,
)

const indexJson = process.argv.indexOf('--json')
if (indexJson !== -1 && process.argv[indexJson + 1]) {
  writeFileSync(process.argv[indexJson + 1], `${JSON.stringify({ observations, problemes }, null, 2)}\n`)
  process.stdout.write(`\nObservations écrites dans ${process.argv[indexJson + 1]}\n`)
}

process.exit(nouveaux.length > 0 ? 1 : 0)
