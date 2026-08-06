#!/usr/bin/env node
/**
 * Parcours pratiques de FBMS — les gestes qu'un utilisateur fait vraiment.
 *
 * `verifier-pages.mjs` charge chaque page et la mesure au repos. Ce script fait
 * autre chose : il AGIT. Il suit un lien, revient en arrière, actualise,
 * demande une URL qui n'existe pas, navigue au clavier, remplit un champ et
 * soumet un formulaire vide. Ces gestes révèlent des défauts qu'aucune mesure
 * statique ne peut voir — un retour arrière qui perd l'état, un focus
 * invisible, une validation qui n'affiche rien.
 *
 * Chaque constat porte SA PREUVE : une valeur mesurée, et une capture d'écran
 * quand il y a quelque chose à montrer. Un parcours sans preuve n'est pas un
 * parcours testé.
 *
 * Usage :
 *   node .github/agent-tests/parcours-pratiques.mjs \
 *     [--base http://127.0.0.1:4501] [--preuves dossier/] [--json r.json]
 *
 * Sortie : toujours 0. Ce script CONSTATE, il ne juge pas — le classement des
 * anomalies revient à `app-audit-agent`, et bloquer une fusion sur un parcours
 * exploratoire rendrait l'intégration continue ingouvernable.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}

const BASE = arg('--base', process.env.BASE_FBMS ?? 'http://127.0.0.1:4501').replace(/\/$/, '')
const PREUVES = arg('--preuves', 'preuves')
const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const VIEWPORTS = [
  { nom: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { nom: 'tablette-768x1024', width: 768, height: 1024, mobile: true },
  { nom: 'bureau-1440x900', width: 1440, height: 900, mobile: false },
]

mkdirSync(PREUVES, { recursive: true })

const constats = []
/**
 * @param statut  'ok' | 'defaut' | 'non-concluant'
 * Le troisième existe parce qu'un contrôle qui n'a pas pu s'exécuter n'est ni
 * un succès ni un échec, et le noter « ok » serait un mensonge commode.
 */
const noter = (viewport, parcours, statut, preuve, capture = null) =>
  constats.push({ viewport, parcours, statut, preuve, capture })

const navigateur = await chromium.launch({
  executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
})

for (const vp of VIEWPORTS) {
  const contexte = await navigateur.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: 'fr-FR',
    serviceWorkers: 'block',
  })
  const page = await contexte.newPage()

  const erreursConsole = []
  const erreursEnvironnement = []
  const erreursJs = []
  const echecsReseau = []

  /**
   * Marqueur de la sonde 404 volontaire. Sans ce filtre, le script comptait sa
   * PROPRE requête comme une ressource en échec et rapportait un défaut à
   * chaque viewport — une anomalie entièrement fabriquée par le harnais.
   */
  const SONDE_404 = 'cette-page-n-existe-pas'

  /**
   * Un tunnel refusé, un proxy injoignable, un DNS muet : ce sont des faits sur
   * la MACHINE qui exécute le test, pas sur le site. Les compter comme des
   * erreurs de FBMS noierait les vraies sous des dizaines de fausses.
   *
   * Ces motifs sont des pannes de la COUCHE RÉSEAU, jamais du code de la page.
   * L'autorité sur les ressources du site reste `echecsReseau`, qui filtre par
   * origine : si une ressource servie par le site échoue, elle y apparaît, quel
   * que soit le classement fait ici.
   */
  const ENVIRONNEMENT =
    /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_TIMED_OUT|ERR_CERT_/

  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const texte = m.text().replace(/\s+/g, ' ').slice(0, 200)
    if (texte.includes(SONDE_404)) return
    ;(ENVIRONNEMENT.test(texte) ? erreursEnvironnement : erreursConsole).push(texte)
  })
  page.on('pageerror', (e) => erreursJs.push(String(e.message).replace(/\s+/g, ' ').slice(0, 200)))
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE) && !r.url().includes(SONDE_404)) {
      echecsReseau.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`)
    }
  })

  const capturer = async (nom) => {
    const chemin = join(PREUVES, `${vp.nom}--${nom}.png`)
    await page.screenshot({ path: chemin, fullPage: false }).catch(() => {})
    return chemin
  }

  // --- 1. Page principale ---------------------------------------------------
  const reponse = await page
    .goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    .catch(() => null)
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1000)

  if (!reponse) {
    noter(vp.nom, 'page-principale', 'non-concluant', "la page d'accueil n'a pas répondu")
    await contexte.close()
    continue
  }

  const accueil = await page.evaluate(() => ({
    titre: document.title,
    texte: (document.body?.innerText ?? '').trim().length,
    liens: [...document.querySelectorAll('a[href]')].length,
    boutons: [...document.querySelectorAll('button,[role="button"]')].length,
    champs: [...document.querySelectorAll('input,select,textarea')].length,
    formulaires: document.querySelectorAll('form').length,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  noter(
    vp.nom,
    'page-principale',
    accueil.texte > 50 ? 'ok' : 'defaut',
    `titre « ${accueil.titre} », ${accueil.texte} caractères visibles, ${accueil.liens} lien(s), ${accueil.boutons} bouton(s)`,
    await capturer('01-accueil'),
  )
  noter(
    vp.nom,
    'debordement-horizontal',
    accueil.scrollWidth <= accueil.innerWidth + 1 ? 'ok' : 'defaut',
    `scrollWidth ${accueil.scrollWidth} vs innerWidth ${accueil.innerWidth}`,
  )

  // --- 2. Navigation : suivre un lien interne -------------------------------
  const cible = await page.evaluate((base) => {
    const a = [...document.querySelectorAll('a[href]')].find((x) => {
      try {
        const u = new URL(x.href)
        return u.origin === new URL(base).origin && !x.href.includes('#') && x.offsetParent !== null
      } catch {
        return false
      }
    })
    return a ? { href: a.href, texte: (a.textContent ?? '').trim().slice(0, 40) } : null
  }, BASE)

  if (!cible) {
    noter(vp.nom, 'navigation-lien-interne', 'non-concluant', 'aucun lien interne visible sur l’accueil')
  } else {
    const avant = page.url()
    await page.goto(cible.href, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(800)
    const apres = page.url()
    noter(
      vp.nom,
      'navigation-lien-interne',
      apres !== avant ? 'ok' : 'defaut',
      `« ${cible.texte} » → ${apres.replace(BASE, '')}`,
      await capturer('02-lien-suivi'),
    )

    // --- 3. Retour arrière --------------------------------------------------
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(800)
    const revenu = page.url()
    const contenuRevenu = await page.evaluate(() => (document.body?.innerText ?? '').trim().length)
    noter(
      vp.nom,
      'retour-arriere',
      revenu.replace(/\/$/, '') === avant.replace(/\/$/, '') && contenuRevenu > 50 ? 'ok' : 'defaut',
      `revenu sur ${revenu.replace(BASE, '')}, ${contenuRevenu} caractères rendus`,
      await capturer('03-retour-arriere'),
    )
  }

  // --- 4. Actualisation -----------------------------------------------------
  const avantRechargement = await page.evaluate(() => (document.body?.innerText ?? '').trim().length)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(1000)
  const apresRechargement = await page.evaluate(() => (document.body?.innerText ?? '').trim().length)
  noter(
    vp.nom,
    'actualisation',
    apresRechargement > 50 ? 'ok' : 'defaut',
    `${avantRechargement} → ${apresRechargement} caractères après F5`,
  )

  // --- 5. URL inexistante ---------------------------------------------------
  // GitHub Pages sert sa propre page 404 ; un serveur local renvoie un corps
  // brut. Les deux doivent au minimum répondre 404 et non 200 : une URL morte
  // qui répond 200 fait croire au navigateur — et aux moteurs — que la page
  // existe.
  const r404 = await page
    .goto(`${BASE}/cette-page-n-existe-pas-${Date.now()}.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    })
    .catch(() => null)
  const corps404 = await page.evaluate(() => (document.body?.innerText ?? '').trim().slice(0, 120))
  noter(
    vp.nom,
    'url-inexistante',
    r404?.status() === 404 ? 'ok' : 'defaut',
    `statut ${r404?.status() ?? 'aucun'} · corps « ${corps404} »`,
    await capturer('04-url-inexistante'),
  )

  // --- 6. Navigation au clavier et visibilité du focus ----------------------
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(1000)

  const clavier = []
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab')
    const focalise = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      // Un focus « visible » n'est pas un contour déclaré : c'est un contour
      // qui a une épaisseur. `outline: solid 0px` compte pour rien.
      const largeurContour = Number.parseFloat(s.outlineWidth) || 0
      const contourVisible = largeurContour > 0 && s.outlineStyle !== 'none'
      const ombreVisible = s.boxShadow !== 'none' && s.boxShadow !== ''
      return {
        balise: el.tagName.toLowerCase(),
        texte: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30),
        dansLEcran: r.top >= 0 && r.left >= 0 && r.width > 0 && r.height > 0,
        focusVisible: contourVisible || ombreVisible,
      }
    })
    if (focalise) clavier.push(focalise)
  }

  if (clavier.length === 0) {
    noter(vp.nom, 'navigation-clavier', 'defaut', '12 tabulations n’ont focalisé aucun élément')
  } else {
    const sansFocus = clavier.filter((c) => !c.focusVisible)
    noter(
      vp.nom,
      'navigation-clavier',
      'ok',
      `${clavier.length} élément(s) atteints en 12 tabulations (${clavier.map((c) => c.balise).join(', ')})`,
    )
    noter(
      vp.nom,
      'focus-visible',
      sansFocus.length === 0 ? 'ok' : 'defaut',
      sansFocus.length === 0
        ? `les ${clavier.length} éléments focalisés portent un contour ou une ombre`
        : `${sansFocus.length}/${clavier.length} élément(s) focalisés sans indicateur visible, ex. <${sansFocus[0].balise}> « ${sansFocus[0].texte} »`,
      await capturer('05-focus-clavier'),
    )
  }

  // --- 7. Formulaires et validation des champs ------------------------------
  const formulaire = await page.evaluate(() => {
    const f = document.querySelector('form')
    if (!f) return null
    const champs = [...f.querySelectorAll('input,select,textarea')]
    return {
      champs: champs.length,
      requis: champs.filter((c) => c.required).length,
      types: [...new Set(champs.map((c) => c.type ?? c.tagName.toLowerCase()))].slice(0, 6),
      soumission: Boolean(f.querySelector('[type=submit],button')),
    }
  })

  if (!formulaire) {
    noter(vp.nom, 'formulaire-validation', 'non-concluant', 'aucun <form> sur la page d’accueil publique')
  } else {
    // Soumettre à vide : la validation native ou applicative doit se manifester.
    const validation = await page.evaluate(() => {
      const f = document.querySelector('form')
      const invalides = [...f.querySelectorAll('input,select,textarea')].filter(
        (c) => typeof c.checkValidity === 'function' && !c.checkValidity(),
      )
      return {
        bloqueParLeNavigateur: !f.checkValidity(),
        champsInvalides: invalides.length,
        premierMessage: invalides[0]?.validationMessage ?? '',
      }
    })
    noter(
      vp.nom,
      'formulaire-validation',
      validation.bloqueParLeNavigateur || formulaire.requis === 0 ? 'ok' : 'defaut',
      `${formulaire.champs} champ(s) (${formulaire.types.join(', ')}), ${formulaire.requis} requis · ` +
        (validation.bloqueParLeNavigateur
          ? `soumission à vide refusée : « ${validation.premierMessage} »`
          : 'soumission à vide non bloquée par la validation native'),
      await capturer('06-formulaire'),
    )
  }

  // --- 8. Boutons : cliquables et dimensionnés ------------------------------
  const boutons = await page.evaluate(() => {
    const visibles = [...document.querySelectorAll('button,[role="button"],a[href]')].filter((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    })
    return {
      total: visibles.length,
      trop_petits: visibles
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { t: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30), l: Math.round(r.width), h: Math.round(r.height) }
        })
        .filter((e) => e.l < 44 || e.h < 44),
      sans_intitule: visibles.filter(
        (el) =>
          (el.textContent ?? '').trim() === '' &&
          !el.getAttribute('aria-label') &&
          !el.getAttribute('title'),
      ).length,
    }
  })
  noter(
    vp.nom,
    'boutons-et-zones-tactiles',
    boutons.trop_petits.length === 0 && boutons.sans_intitule === 0 ? 'ok' : 'defaut',
    `${boutons.total} élément(s) interactifs · ${boutons.trop_petits.length} sous 44 px` +
      (boutons.trop_petits[0]
        ? ` (ex. « ${boutons.trop_petits[0].t} » ${boutons.trop_petits[0].l}×${boutons.trop_petits[0].h})`
        : '') +
      ` · ${boutons.sans_intitule} sans intitulé accessible`,
  )

  // --- 9. Réseau lent -------------------------------------------------------
  // Playwright sait ralentir le réseau, mais FBMS n'a AUCUN seuil de
  // performance défini. Mesurer sans seuil produirait un chiffre que personne
  // ne saurait interpréter, et le comparer à un seuil inventé serait pire.
  // On mesure donc, et on s'abstient de juger.
  const debut = Date.now()
  await page.route('**/*', async (route) => {
    await new Promise((r) => setTimeout(r, 150))
    // Pendant le délai, la navigation a pu abandonner la requête : Playwright
    // considère alors la route comme déjà traitée et lève. Sans ce filet, le
    // script mourait ici d'un rejet non capté, au premier viewport, sans
    // restituer un seul constat.
    try {
      await route.continue()
    } catch {
      /* requête abandonnée entre-temps : rien à faire */
    }
  })
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  const duree = Date.now() - debut
  const rendu = await page
    .evaluate(() => (document.body?.innerText ?? '').trim().length)
    .catch(() => 0)
  await page.unroute('**/*').catch(() => {})
  noter(
    vp.nom,
    'reseau-lent',
    rendu > 50 ? 'ok' : 'defaut',
    `+150 ms par requête : ${duree} ms jusqu'au DOM, ${rendu} caractères rendus (mesure sans seuil de référence)`,
    await capturer('07-reseau-lent'),
  )

  // --- 10. Console et réseau ------------------------------------------------
  noter(
    vp.nom,
    'erreurs-console',
    erreursConsole.length === 0 && erreursJs.length === 0 ? 'ok' : 'defaut',
    `${erreursJs.length} erreur(s) JS, ${erreursConsole.length} erreur(s) console imputables au site` +
      (erreursJs[0] ? ` · ex. ${erreursJs[0]}` : erreursConsole[0] ? ` · ex. ${erreursConsole[0]}` : ''),
  )
  if (erreursEnvironnement.length > 0) {
    noter(
      vp.nom,
      'acces-reseau-externe',
      'non-concluant',
      `${erreursEnvironnement.length} requête(s) externe(s) bloquées par la machine de test ` +
        `(${erreursEnvironnement[0].slice(0, 60)}…) : les dépendances tierces n'ont pas pu être évaluées`,
    )
  }
  noter(
    vp.nom,
    'ressources-reseau',
    echecsReseau.length === 0 ? 'ok' : 'defaut',
    echecsReseau.length === 0
      ? 'aucune ressource du site en erreur'
      : `${echecsReseau.length} échec(s) · ${[...new Set(echecsReseau)].slice(0, 3).join(' · ')}`,
  )

  await contexte.close()
}

await navigateur.close()

// --- Restitution ------------------------------------------------------------
const largeur = Math.max(...constats.map((c) => c.parcours.length))
let viewportCourant = null
for (const c of constats) {
  if (c.viewport !== viewportCourant) {
    viewportCourant = c.viewport
    process.stdout.write(`\n### ${viewportCourant}\n`)
  }
  const marque = { ok: 'OK          ', defaut: 'DÉFAUT      ', 'non-concluant': 'NON CONCLUANT' }[c.statut]
  process.stdout.write(`${marque} ${c.parcours.padEnd(largeur)}  ${c.preuve}\n`)
}

const compte = (s) => constats.filter((c) => c.statut === s).length
process.stdout.write(
  `\n${constats.length} constat(s) · ${compte('ok')} ok · ${compte('defaut')} défaut(s) · ` +
    `${compte('non-concluant')} non concluant(s)\n` +
    `Captures dans ${PREUVES}/\n`,
)

const iJson = process.argv.indexOf('--json')
if (iJson !== -1 && process.argv[iJson + 1]) {
  writeFileSync(process.argv[iJson + 1], `${JSON.stringify({ base: BASE, constats }, null, 2)}\n`)
}
