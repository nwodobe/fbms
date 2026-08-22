/**
 * Réseau dégradé : ce que vit un agent en zone de collecte.
 *
 * Trois profils appliqués par le protocole DevTools de Chromium, plus une
 * latence serveur injectée dans l'émulateur — car un débit réduit et un
 * serveur lent ne produisent pas les mêmes symptômes.
 *
 * Ce qui est mesuré :
 *   · le temps avant qu'un écran devienne manipulable ;
 *   · le temps pour enregistrer un achat ;
 *   · si l'utilisateur reçoit une réponse ou reste devant un écran muet.
 *
 *   node tests/e2e/06-reseau-degrade.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS } from '../bench/banc.mjs'

const PROFILS = [
  { nom: 'reference (local)', descenteKbps: 0, monteeKbps: 0, latenceMs: 0, latenceServeurMs: 0 },
  { nom: '4G correcte', descenteKbps: 9000, monteeKbps: 4000, latenceMs: 60, latenceServeurMs: 40 },
  { nom: '3G de brousse', descenteKbps: 780, monteeKbps: 330, latenceMs: 300, latenceServeurMs: 150 },
  { nom: '2G / EDGE', descenteKbps: 240, monteeKbps: 120, latenceMs: 800, latenceServeurMs: 400 },
]

const PAGES = ['terrain/achats.html', 'index.html', 'rcntrace/index.html']
const resultats = []

for (const profil of PROFILS) {
  const banc = await demarrerBanc({ latenceMs: profil.latenceServeurMs })
  const navigateur = await ouvrirNavigateur()
  for (const chemin of PAGES) {
    const contexte = await navigateur.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      locale: 'fr-FR', serviceWorkers: 'block',
    })
    await router(contexte, banc)
    const page = await contexte.newPage()
    await connecter(page, banc.api, PERSONAS.find((p) => p.cle === 'agent'))

    if (profil.descenteKbps) {
      const cdp = await contexte.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: profil.latenceMs,
        downloadThroughput: (profil.descenteKbps * 1024) / 8,
        uploadThroughput: (profil.monteeKbps * 1024) / 8,
      })
    }

    const t0 = Date.now()
    let utilisableMs = null
    let statut = 'ok'
    try {
      await page.goto(banc.statique.base + '/' + chemin, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.waitForFunction(() => !document.getElementById('anagroci-authgate'), null, { timeout: 120000 })
      utilisableMs = Date.now() - t0
    } catch (e) { statut = 'délai dépassé (>120 s)' }

    let saisieMs = null
    if (chemin === 'terrain/achats.html' && statut === 'ok') {
      try {
        await page.waitForSelector('#saveComplet', { timeout: 60000 })
        await page.fill('#f_village', 'TEST_LOAD_V001')
        await page.waitForFunction(() => {
          const r = document.getElementById('f_rt')
          return r && r.tagName === 'SELECT' && r.options.length > 1
        }, null, { timeout: 90000 })
        await page.fill('#f_brut', '100'); await page.fill('#f_tare', '0')
        await page.fill('#f_prix', '400'); await page.fill('#f_sacs', '2')
        await page.fill('#f_recu', 'TEST_LOAD_RESEAU'); await page.fill('#f_prod_tel', '0700000001')
        await page.waitForTimeout(1500)
        const opts = await page.evaluate(() => [...document.getElementById('f_rt').options].map((o) => o.value).filter(Boolean))
        if (opts.length) await page.selectOption('#f_rt', opts[0])
        const t1 = Date.now()
        await page.click('#saveComplet')
        await page.waitForFunction(() => (document.getElementById('msg') || {}).textContent, null, { timeout: 60000 })
        saisieMs = Date.now() - t1
      } catch (e) { saisieMs = -1 }
    }

    const resu = {
      profil: profil.nom, page: chemin, utilisableMs, saisieMs, statut,
      latenceServeurMs: profil.latenceServeurMs, descenteKbps: profil.descenteKbps,
    }
    resultats.push(resu)
    console.log(`  ${profil.nom.padEnd(20)} ${chemin.padEnd(24)} utilisable ${utilisableMs == null ? 'JAMAIS' : String(utilisableMs).padStart(6) + ' ms'}${saisieMs != null ? ` · saisie ${saisieMs === -1 ? 'ÉCHEC' : saisieMs + ' ms'}` : ''}`)
    await contexte.close()
  }
  await navigateur.close()
  await banc.fermer()
}

mkdirSync('tests/reports/donnees', { recursive: true })
writeFileSync('tests/reports/donnees/07-reseau-degrade.json', JSON.stringify({ genere: new Date().toISOString(), profils: PROFILS, resultats }, null, 1))
console.log('\nDétail : tests/reports/donnees/07-reseau-degrade.json')
