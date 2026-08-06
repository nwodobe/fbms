#!/usr/bin/env node
/**
 * Smoke test de la production GitHub Pages.
 *
 * Il ne se contente pas de constater qu'une page répond : une coquille HTML
 * servie alors que le JavaScript ne démarre pas répond 200 tout aussi bien, et
 * l'utilisateur voit un écran vide. Ce script ouvre donc réellement la page
 * dans Chromium, sur mobile et sur ordinateur, et vérifie qu'elle est
 * UTILISABLE.
 *
 * Usage :
 *   PRODUCTION_URL=https://nwodobe.github.io/fbms/index.html \
 *   node .github/scripts/smoke-production.mjs
 */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const URL_CIBLE = process.env.PRODUCTION_URL ?? 'https://nwodobe.github.io/fbms/index.html'
const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const constats = []
const noter = (ok, libelle, detail = '') => constats.push({ ok, libelle, detail })

// La production DOIT être en HTTPS. L'échappatoire n'existe que pour vérifier
// la logique de ce script contre un serveur local, et elle le dit à l'écran :
// personne ne doit pouvoir la confondre avec un contrôle de production.
if (!URL_CIBLE.startsWith('https://')) {
  if (process.env.SMOKE_AUTORISER_HTTP !== '1') {
    process.stderr.write('La production doit être servie en HTTPS.\n')
    process.exit(1)
  }
  process.stdout.write('⚠ Cible NON HTTPS : auto-vérification du script, PAS un contrôle de production.\n\n')
}

const navigateur = await chromium.launch({
  executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
})

const APPAREILS = [
  { nom: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { nom: 'bureau-1440x900', width: 1440, height: 900, mobile: false },
]

for (const appareil of APPAREILS) {
  const contexte = await navigateur.newContext({
    viewport: { width: appareil.width, height: appareil.height },
    isMobile: appareil.mobile,
    hasTouch: appareil.mobile,
    locale: 'fr-FR',
  })
  const page = await contexte.newPage()

  const erreursJs = []
  const ressourcesEnEchec = []
  page.on('pageerror', (e) => erreursJs.push(String(e.message).slice(0, 200)))
  page.on('response', (r) => {
    // Seules les ressources SERVIES PAR LE SITE comptent : une panne de CDN
    // tiers est un vrai sujet, mais pas une raison de déclarer la production
    // en panne.
    try {
      if (r.status() >= 400 && new URL(r.url()).host === new URL(URL_CIBLE).host) {
        ressourcesEnEchec.push(`HTTP ${r.status()} ${r.url()}`)
      }
    } catch {
      /* URL inexploitable : sans intérêt ici */
    }
  })

  let reponse = null
  try {
    reponse = await page.goto(URL_CIBLE, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  } catch (erreur) {
    noter(false, `[${appareil.nom}] la page se charge`, String(erreur.message).split('\n')[0])
    await contexte.close()
    continue
  }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

  noter(Boolean(reponse?.ok()), `[${appareil.nom}] réponse HTTP`, `statut ${reponse?.status()}`)

  const etat = await page.evaluate(() => ({
    titre: document.title,
    texte: (document.body.innerText ?? '').trim().length,
    feuilles: document.styleSheets.length,
    scripts: document.querySelectorAll('script').length,
    liens: document.querySelectorAll('a[href]').length,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))

  noter(etat.titre.trim() !== '', `[${appareil.nom}] la page porte un titre`, etat.titre)
  noter(etat.texte > 50, `[${appareil.nom}] contenu principal rendu`, `${etat.texte} caracteres visibles`)
  noter(etat.feuilles > 0, `[${appareil.nom}] au moins une feuille de style chargee`, String(etat.feuilles))
  noter(etat.scripts > 0, `[${appareil.nom}] au moins un script present`, String(etat.scripts))
  noter(etat.liens > 0, `[${appareil.nom}] navigation disponible`, `${etat.liens} lien(s)`)
  noter(
    etat.scrollWidth <= etat.innerWidth + 1,
    `[${appareil.nom}] aucun debordement horizontal`,
    `${etat.scrollWidth} vs ${etat.innerWidth}`,
  )
  noter(erreursJs.length === 0, `[${appareil.nom}] aucune erreur JavaScript`, erreursJs[0] ?? '')
  noter(
    ressourcesEnEchec.length === 0,
    `[${appareil.nom}] aucune ressource du site en echec`,
    ressourcesEnEchec[0] ?? '',
  )

  await contexte.close()
}

await navigateur.close()

for (const c of constats) {
  process.stdout.write(`${c.ok ? 'OK  ' : 'ECHEC'} ${c.libelle}${c.detail ? ` — ${c.detail}` : ''}\n`)
}

const echecs = constats.filter((c) => !c.ok)
process.stdout.write(  `\n${URL_CIBLE}\n${constats.length - echecs.length}/${constats.length} controle(s) au vert\n`,
process.exitCode = echecs.length > 0 ? 1 : 0
process.exit(echecs.length > 0 ? 1 : 0)
