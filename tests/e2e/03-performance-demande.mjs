/**
 * Performance frontend et DEMANDE CLIENT par utilisateur.
 *
 * Deux mesures distinctes, à ne pas confondre :
 *
 *  1. PERFORMANCE DE RENDU — mesurée dans un vrai Chromium sur les octets
 *     exacts du dépôt : LCP, CLS, poids transféré, nombre de scripts,
 *     scripts bloquants, temps d'accès au formulaire. Ces chiffres valent
 *     pour la production : le HTML, le CSS et le JS sont identiques.
 *     Ce qui diffère : la latence réseau (ici ~0 ms) et le CDN GitHub Pages.
 *     Le chargement initial réel sera donc PLUS LENT que mesuré ici, jamais
 *     plus rapide.
 *
 *  2. DEMANDE CLIENT — combien de requêtes backend UN utilisateur génère
 *     par minute, en observant la page pendant 65 secondes sans y toucher.
 *     Cette mesure est indépendante du serveur : elle est directement
 *     multipliable par 100 pour dimensionner la charge, et c'est elle qui
 *     alimente le modèle de tests/load/.
 *
 *   node tests/e2e/03-performance-demande.mjs [--court]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS, VIEWPORTS, SUPABASE_PROD, centiles } from '../bench/banc.mjs'

const COURT = process.argv.includes('--court')
const OBSERVATION_MS = COURT ? 20000 : 65000

const PAGES = [
  { chemin: 'index.html', nom: 'Portail', persona: 'bm' },
  { chemin: 'terrain/achats.html', nom: 'Achats Terrain', persona: 'agent' },
  { chemin: 'terrain/sacs.html', nom: 'Stock & Sacs', persona: 'agent' },
  { chemin: 'terrain/cash.html', nom: 'Caisse & Avances', persona: 'sup' },
  { chemin: 'terrain/command.html', nom: 'Command Center', persona: 'bm' },
  { chemin: 'fbms/index.html', nom: 'FBMS Référentiel', persona: 'bm' },
  { chemin: 'fbms/fbms_carte.html', nom: 'Cartographie', persona: 'agent' },
  { chemin: 'fbms/fbms_hubs.html', nom: 'Hubs / Clusters', persona: 'sup' },
  { chemin: 'fbms/audit_distances.html', nom: 'Audit Distances', persona: 'sup' },
  { chemin: 'logistique/alis_fbms.html', nom: 'ALIS Logistique', persona: 'sup' },
  { chemin: 'rcntrace/index.html', nom: 'RCN TRACE', persona: 'bm' },
]

const banc = await demarrerBanc()
const navigateur = await ouvrirNavigateur()
const mesures = []

for (const page of PAGES) {
  const persona = PERSONAS.find((p) => p.cle === page.persona)
  for (const viewport of VIEWPORTS) {
    const contexte = await navigateur.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile, hasTouch: viewport.mobile, locale: 'fr-FR', serviceWorkers: 'block',
    })
    await router(contexte, banc)
    const onglet = await contexte.newPage()
    await connecter(onglet, banc.api, persona)

    const requetes = []          // vers le backend applicatif
    const ressources = []        // servies par le site
    onglet.on('response', async (r) => {
      const u = r.url()
      if (u.startsWith(SUPABASE_PROD)) {
        const url = new URL(u)
        requetes.push({ t: Date.now(), methode: r.request().method(), cible: url.pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth:'), statut: r.status() })
      } else if (u.startsWith(banc.statique.base)) {
        let taille = 0
        try { taille = (await r.body()).length } catch (e) { /* corps consommé */ }
        ressources.push({ url: u.replace(banc.statique.base, ''), type: r.request().resourceType(), octets: taille })
      }
    })

    const t0 = Date.now()
    await onglet.goto(banc.statique.base + '/' + page.chemin, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    const domReady = Date.now() - t0
    await onglet.waitForLoadState('load', { timeout: 20000 }).catch(() => {})
    const charge = Date.now() - t0

    // Portail d'authentification levé : premier instant où la page est utilisable.
    let utilisable = null
    try {
      await onglet.waitForFunction(() => !document.getElementById('anagroci-authgate'), null, { timeout: 25000 })
      utilisable = Date.now() - t0
    } catch (e) { utilisable = null }

    const vitals = await onglet.evaluate(() => new Promise((resolve) => {
      const out = { lcp: null, cls: 0, fcp: null, ressourcesNav: null }
      try {
        new PerformanceObserver((l) => { const e = l.getEntries(); out.lcp = e[e.length - 1].startTime })
          .observe({ type: 'largest-contentful-paint', buffered: true })
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value })
          .observe({ type: 'layout-shift', buffered: true })
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]
        if (fcp) out.fcp = fcp.startTime
      } catch (e) { /* API non disponible */ }
      setTimeout(() => {
        const nav = performance.getEntriesByType('navigation')[0]
        if (nav) out.ressourcesNav = { domInteractive: nav.domInteractive, domComplete: nav.domComplete }
        resolve(out)
      }, 2500)
    }))

    const dom = await onglet.evaluate(() => ({
      scripts: document.querySelectorAll('script[src]').length,
      scriptsBloquants: [...document.querySelectorAll('script[src]')].filter((s) => !s.defer && !s.async).length,
      scriptsInline: document.querySelectorAll('script:not([src])').length,
      octetsInline: [...document.querySelectorAll('script:not([src])')].reduce((s, e) => s + e.textContent.length, 0),
      feuilles: document.querySelectorAll('link[rel=stylesheet]').length,
      noeuds: document.querySelectorAll('*').length,
      debordement: document.documentElement.scrollWidth > window.innerWidth + 1,
    }))

    // Observation au repos : c'est la mesure de la demande client.
    const reqAvant = requetes.length
    const debutRepos = Date.now()
    await onglet.waitForTimeout(OBSERVATION_MS)
    const reposMs = Date.now() - debutRepos
    const auRepos = requetes.filter((r) => r.t >= debutRepos)

    const parCible = {}
    for (const r of auRepos) parCible[r.methode + ' ' + r.cible] = (parCible[r.methode + ' ' + r.cible] || 0) + 1

    const clients = await onglet.evaluate(() => {
      // Nombre de clients Supabase distincts créés par la page (chaque client
      // porte son propre GoTrue et son propre verrou de rafraîchissement).
      let n = 0
      for (const c of ['SB', 'sb', 'supabaseClient']) { try { if (window[c]) n++ } catch (e) {} }
      return { globauxDetectes: n }
    })

    mesures.push({
      page: page.chemin, nom: page.nom, persona: page.persona, viewport: viewport.nom,
      domReadyMs: domReady, chargeMs: charge, utilisableMs: utilisable,
      lcpMs: vitals.lcp == null ? null : Math.round(vitals.lcp),
      cls: +vitals.cls.toFixed(4),
      fcpMs: vitals.fcp == null ? null : Math.round(vitals.fcp),
      ...dom,
      octetsTotal: ressources.reduce((s, r) => s + r.octets, 0),
      octetsHtml: ressources.filter((r) => r.type === 'document').reduce((s, r) => s + r.octets, 0),
      octetsJs: ressources.filter((r) => r.type === 'script').reduce((s, r) => s + r.octets, 0),
      nbRessources: ressources.length,
      requetesInitiales: reqAvant,
      requetesAuRepos: auRepos.length,
      reposMs,
      requetesParMinute: +((auRepos.length / reposMs) * 60000).toFixed(2),
      detailRepos: parCible,
      clients,
      ressourcesLourdes: ressources.filter((r) => r.octets > 60000).map((r) => `${r.url} ${(r.octets / 1024).toFixed(0)} ko`),
    })
    console.log(`  ${page.nom.padEnd(20)} ${viewport.nom.padEnd(18)} charge ${String(charge).padStart(5)} ms · utilisable ${utilisable == null ? ' jamais' : String(utilisable).padStart(5) + ' ms'} · ${(mesures[mesures.length - 1].octetsTotal / 1024).toFixed(0).padStart(5)} ko · ${reqAvant} req initiales · ${mesures[mesures.length - 1].requetesParMinute}/min au repos`)
    await contexte.close()
  }
}

await navigateur.close()
await banc.fermer()

mkdirSync('tests/reports/donnees', { recursive: true })
writeFileSync('tests/reports/donnees/03-performance.json', JSON.stringify({
  genere: new Date().toISOString(), observationMs: OBSERVATION_MS, mesures,
  syntheseCharge: centiles(mesures.map((m) => m.chargeMs)),
  syntheseUtilisable: centiles(mesures.filter((m) => m.utilisableMs != null).map((m) => m.utilisableMs)),
}, null, 1))
console.log('\nDétail : tests/reports/donnees/03-performance.json')
