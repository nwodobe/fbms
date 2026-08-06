#!/usr/bin/env node
/**
 * Audit de l'application FBMS RÉELLEMENT PUBLIÉE.
 *
 * Différence essentielle avec `verifier-pages.mjs` : celui-ci sert le dépôt
 * localement et contrôle ce qui SERA publié ; celui-là ouvre ce qui EST publié.
 * Les deux sont nécessaires, et ils ne trouvent pas les mêmes choses — une
 * ressource absente du dépôt mais présente sur le serveur, une publication
 * partielle, un cache périmé ne se voient que sur le site en ligne.
 *
 * Ici, AUCUNE doublure n'est installée : sur la production, l'indisponibilité
 * d'un CDN tiers est un fait qui concerne l'utilisateur, donc un constat
 * légitime. Elle est relevée séparément des défauts du site lui-même, parce que
 * la corriger ne relève pas du même geste.
 *
 * Les pages ne sont pas devinées : elles sont découvertes en suivant les liens
 * internes depuis la page d'entrée. Auditer une liste écrite à la main
 * donnerait un rapport sur le site qu'on croit avoir, pas sur celui qui est en
 * ligne.
 *
 * Usage :
 *   PRODUCTION_URL=https://nwodobe.github.io/fbms/index.html \
 *   node .github/scripts/auditer-production.mjs [--json r.json] [--markdown r.md]
 *
 * Sortie : 0 si aucune anomalie P0/P1, 1 sinon.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const URL_CIBLE = process.env.PRODUCTION_URL
const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SEUIL_TACTILE = 44
const MAX_PAGES = Number(process.env.AUDIT_MAX_PAGES ?? 20)

if (!URL_CIBLE) {
  process.stderr.write(
    "PRODUCTION_URL est absente.\n" +
      "Ce script refuse de deviner une adresse : un audit doit savoir ce qu'il audite.\n",
  )
  process.exit(2)
}
if (!URL_CIBLE.startsWith('https://') && process.env.AUDIT_AUTORISER_HTTP !== '1') {
  process.stderr.write('La production doit être servie en HTTPS.\n')
  process.exit(2)
}

const VIEWPORTS = [
  { nom: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { nom: 'tablette-768x1024', width: 768, height: 1024, mobile: true },
  { nom: 'bureau-1440x900', width: 1440, height: 900, mobile: false },
]

const origine = new URL(URL_CIBLE)
/** Racine du site publié : `/fbms/` pour `…/fbms/index.html`. */
const PREFIXE = origine.pathname.replace(/[^/]*$/, '')
const interne = (u) => {
  try {
    const c = new URL(u, URL_CIBLE)
    return c.origin === origine.origin && c.pathname.startsWith(PREFIXE)
  } catch {
    return false
  }
}
const normaliser = (u) => {
  const c = new URL(u, URL_CIBLE)
  c.hash = ''
  c.search = ''
  return c.toString()
}

const axe = existsSync('.github/vendor/axe.min.js')
  ? readFileSync('.github/vendor/axe.min.js', 'utf8')
  : null

const navigateur = await chromium.launch({
  executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
})

// --- 1. Découverte des pages ------------------------------------------------
const aVisiter = [normaliser(URL_CIBLE)]
const decouvertes = []
const vues = new Set(aVisiter)

{
  const contexte = await navigateur.newContext({ locale: 'fr-FR' })
  const onglet = await contexte.newPage()
  while (aVisiter.length > 0 && decouvertes.length < MAX_PAGES) {
    const url = aVisiter.shift()
    let statut = null
    try {
      const r = await onglet.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      statut = r?.status() ?? null
    } catch {
      decouvertes.push({ url, injoignable: true })
      continue
    }
    decouvertes.push({ url, statut })
    if (statut !== null && statut >= 400) continue

    const liens = await onglet
      .evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href))
      .catch(() => [])
    for (const lien of liens) {
      if (!interne(lien)) continue
      const n = normaliser(lien)
      // On ne suit que des documents : un PDF ou une image n'a pas d'interface
      // à auditer, et les ouvrir gonflerait le rapport sans rien y ajouter.
      if (/\.(pdf|png|jpe?g|svg|webp|zip|csv|xlsx?)$/i.test(new URL(n).pathname)) continue
      if (vues.has(n)) continue
      vues.add(n)
      aVisiter.push(n)
    }
  }
  await contexte.close()
}

const tronque = aVisiter.length > 0
const PAGES = decouvertes.map((d) => d.url)

// --- 2. Audit page par page, viewport par viewport ---------------------------
const observations = []

for (const viewport of VIEWPORTS) {
  for (const url of PAGES) {
    const contexte = await navigateur.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      locale: 'fr-FR',
    })
    const onglet = await contexte.newPage()

    const erreursConsole = []
    const erreursJs = []
    const echecsInternes = []
    const echecsExternes = []

    onglet.on('console', (m) => {
      if (m.type() === 'error') erreursConsole.push(m.text().replace(/\s+/g, ' ').slice(0, 300))
    })
    onglet.on('pageerror', (e) => erreursJs.push(String(e.message).replace(/\s+/g, ' ').slice(0, 300)))
    const classer = (texte, cible) => (interne(cible) ? echecsInternes : echecsExternes).push(texte)
    onglet.on('requestfailed', (r) =>
      classer(`${r.method()} ${r.url().slice(0, 200)} (${r.failure()?.errorText ?? 'échec'})`, r.url()),
    )
    onglet.on('response', (r) => {
      if (r.status() >= 400) classer(`HTTP ${r.status()} ${r.url().slice(0, 200)}`, r.url())
    })

    let statut = null
    let injoignable = null
    try {
      const r = await onglet.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      statut = r?.status() ?? null
    } catch (erreur) {
      injoignable = String(erreur.message).split('\n')[0].slice(0, 200)
    }
    if (injoignable === null) {
      await onglet.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      await onglet.waitForTimeout(1200)
    }

    const mesures =
      injoignable !== null
        ? {}
        : await onglet
            .evaluate((seuil) => {
              const visible = (el) => {
                const r = el.getBoundingClientRect()
                const s = getComputedStyle(el)
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
              }
              const interactifs = [
                ...document.querySelectorAll('a,button,input,select,textarea,[role="button"]'),
              ].filter(visible)
              return {
                titre: document.title,
                langue: document.documentElement.lang,
                texteVisible: (document.body?.innerText ?? '').trim().length,
                innerWidth: window.innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
                interactifs: interactifs.length,
                tactilesInsuffisants: interactifs
                  .map((el) => {
                    const r = el.getBoundingClientRect()
                    return {
                      texte: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
                      l: Math.round(r.width),
                      h: Math.round(r.height),
                    }
                  })
                  .filter((e) => e.l < seuil || e.h < seuil)
                  .slice(0, 10),
              }
            }, SEUIL_TACTILE)
            .catch((e) => ({ erreurMesure: String(e.message).slice(0, 200) }))

    let accessibilite = { indisponible: true }
    if (axe && injoignable === null) {
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
      url,
      viewport: viewport.nom,
      statut,
      injoignable,
      ...mesures,
      debordement:
        typeof mesures.scrollWidth === 'number' && mesures.scrollWidth > mesures.innerWidth + 1,
      erreursConsole,
      erreursJs,
      echecsInternes,
      echecsExternes,
      accessibilite,
    })

    await contexte.close()
  }
}

await navigateur.close()

// --- 3. Classement ----------------------------------------------------------
// Une anomalie n'est retenue que si une observation la porte : chaque entrée
// cite ce qui a été vu. Un constat sans preuve n'a rien à faire dans un
// rapport que quelqu'un devra croire.
const anomalies = []
const ajouter = (gravite, url, regle, preuve, viewport) =>
  anomalies.push({ gravite, url, regle, preuve, viewport })

for (const o of observations) {
  const relatif = o.url.replace(origine.origin, '')
  if (o.injoignable) {
    ajouter('P0', relatif, 'page-injoignable', o.injoignable, o.viewport)
    continue
  }
  if (o.statut !== null && o.statut >= 400) {
    ajouter('P0', relatif, 'reponse-http-en-erreur', `HTTP ${o.statut}`, o.viewport)
    continue
  }
  if (typeof o.texteVisible === 'number' && o.texteVisible < 50) {
    ajouter('P0', relatif, 'page-vide-a-l-ecran', `${o.texteVisible} caractères visibles`, o.viewport)
  }
  if (o.erreursJs.length > 0) ajouter('P1', relatif, 'erreur-javascript', o.erreursJs[0], o.viewport)
  if (o.echecsInternes.length > 0)
    ajouter('P1', relatif, 'ressource-du-site-en-echec', o.echecsInternes[0], o.viewport)
  if (o.debordement)
    ajouter('P1', relatif, 'debordement-horizontal', `${o.scrollWidth} px > ${o.innerWidth} px`, o.viewport)
  if (Array.isArray(o.accessibilite)) {
    for (const v of o.accessibilite.filter((x) => x.impact === 'critical' || x.impact === 'serious')) {
      ajouter('P2', relatif, `accessibilite:${v.id}`, `${v.nombre} élément(s) — ${v.exemple}`, o.viewport)
    }
  }
  if (o.tactilesInsuffisants?.length > 0) {
    const e = o.tactilesInsuffisants[0]
    ajouter(
      'P2',
      relatif,
      'zone-tactile-insuffisante',
      `${o.tactilesInsuffisants.length} élément(s) sous ${SEUIL_TACTILE} px, ex. « ${e.texte} » ${e.l}×${e.h}`,
      o.viewport,
    )
  }
  if (!o.langue) ajouter('P2', relatif, 'attribut-lang-absent', '<html> sans attribut lang', o.viewport)
  if (!o.titre?.trim()) ajouter('P2', relatif, 'titre-absent', 'document.title vide', o.viewport)
  if (o.erreursConsole.length > 0)
    ajouter('P3', relatif, 'erreur-console', o.erreursConsole[0], o.viewport)
  if (o.echecsExternes.length > 0)
    ajouter('P3', relatif, 'dependance-externe-en-echec', o.echecsExternes[0], o.viewport)
}

/** Un même défaut se voit aux trois largeurs : on le compte une fois. */
const groupees = new Map()
for (const a of anomalies) {
  const cle = `${a.gravite}|${a.url}|${a.regle}`
  if (!groupees.has(cle)) groupees.set(cle, { ...a, viewports: [] })
  groupees.get(cle).viewports.push(a.viewport)
}
const distinctes = [...groupees.values()].sort((a, b) => a.gravite.localeCompare(b.gravite))

const parGravite = (g) => distinctes.filter((a) => a.gravite === g)
const bloquantes = [...parGravite('P0'), ...parGravite('P1')]

// --- 4. Rapport -------------------------------------------------------------
const lignes = []
lignes.push(`## Audit de la production FBMS`)
lignes.push('')
lignes.push(`- Cible : \`${URL_CIBLE}\``)
lignes.push(`- Pages découvertes en suivant les liens internes : **${PAGES.length}**`)
lignes.push(`- Largeurs testées : ${VIEWPORTS.map((v) => v.nom).join(', ')}`)
lignes.push(`- Observations : **${observations.length}**`)
if (tronque) {
  lignes.push(
    `- ⚠ Découverte arrêtée à ${MAX_PAGES} pages : ${aVisiter.length} page(s) atteignable(s) n'ont **pas** été auditées.`,
  )
}
if (!axe) lignes.push(`- ⚠ axe-core absent : le contrôle d'accessibilité n'a **pas** été exécuté.`)
lignes.push('')

if (distinctes.length === 0) {
  lignes.push('Aucune anomalie relevée sur les pages parcourues.')
} else {
  for (const g of ['P0', 'P1', 'P2', 'P3']) {
    const lot = parGravite(g)
    if (lot.length === 0) continue
    const intitule = {
      P0: 'P0 — la page est inutilisable',
      P1: 'P1 — la page fonctionne mal',
      P2: 'P2 — accessibilité et ergonomie',
      P3: 'P3 — signalé, non bloquant',
    }[g]
    lignes.push(`### ${intitule} (${lot.length})`)
    lignes.push('')
    lignes.push('| Page | Constat | Observation | Largeurs |')
    lignes.push('| --- | --- | --- | --- |')
    for (const a of lot) {
      const preuve = String(a.preuve).replace(/\|/g, '\\|').slice(0, 180)
      lignes.push(`| \`${a.url}\` | ${a.regle} | ${preuve} | ${a.viewports.length}/3 |`)
    }
    lignes.push('')
  }
  lignes.push('')
  lignes.push(
    'Chaque ligne provient d’une page réellement ouverte dans Chromium : aucune n’est déduite du code source.',
  )
  lignes.push(
    'Les P3 « dépendance externe » désignent un tiers indisponible au moment du passage — à recouper avant toute correction.',
  )
}

const markdown = `${lignes.join('\n')}\n`
process.stdout.write(markdown)

const iJson = process.argv.indexOf('--json')
if (iJson !== -1 && process.argv[iJson + 1]) {
  writeFileSync(
    process.argv[iJson + 1],
    `${JSON.stringify({ cible: URL_CIBLE, pages: PAGES, tronque, observations, anomalies: distinctes }, null, 2)}\n`,
  )
}
const iMd = process.argv.indexOf('--markdown')
if (iMd !== -1 && process.argv[iMd + 1]) writeFileSync(process.argv[iMd + 1], markdown)

process.stdout.write(
  `\n${distinctes.length} anomalie(s) distincte(s) · ${bloquantes.length} bloquante(s) (P0/P1)\n`,
)
process.exit(bloquantes.length > 0 ? 1 : 0)
