/**
 * Balayage fonctionnel : chaque page servie × chaque persona × trois largeurs.
 *
 * Ce que le script observe RÉELLEMENT dans le navigateur, pour chaque
 * combinaison :
 *   · erreurs JavaScript non gérées et erreurs console ;
 *   · requêtes internes en échec et réponses HTTP >= 400 ;
 *   · état du portail d'authentification (affiché / levé / accès refusé) ;
 *   · requêtes émises vers le backend (méthode, table) — c'est la mesure de
 *     la DEMANDE CLIENT réutilisée par le modèle de charge ;
 *   · poids réel de la page (octets servis) et repères de rendu.
 *
 * Sortie : tests/reports/donnees/01-parcours-pages.json
 *   node tests/e2e/01-parcours-pages.mjs [--rapide]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS, VIEWPORTS, SUPABASE_PROD } from '../bench/banc.mjs'

const RAPIDE = process.argv.includes('--rapide')

const PAGES = execFileSync('git', ['ls-files', '-z', '*.html'], { encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter((c) => !c.startsWith('savoir-plus/'))
  .filter((c) => !c.includes('Sauvegarde Master'))

/* Module déclaré par la page (attribut data-module de auth-gate.js), utile
   pour confronter l'accès observé à la table ACCESS du code. */
const banc = await demarrerBanc()
const navigateur = await ouvrirNavigateur()
const observations = []

const personas = RAPIDE ? PERSONAS.filter((p) => ['bm', 'agent'].includes(p.cle)) : PERSONAS
const viewports = RAPIDE ? VIEWPORTS.filter((v) => v.nom.startsWith('bureau')) : VIEWPORTS

console.log(`${PAGES.length} pages × ${personas.length} personas × ${viewports.length} largeurs = ${PAGES.length * personas.length * viewports.length} ouvertures`)

for (const persona of personas) {
  for (const viewport of viewports) {
    const contexte = await navigateur.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile, hasTouch: viewport.mobile,
      locale: 'fr-FR', serviceWorkers: 'block',
    })
    await router(contexte, banc)

    for (const chemin of PAGES) {
      const onglet = await contexte.newPage()
      await connecter(onglet, banc.api, persona)

      const erreursJs = []
      const erreursConsole = []
      const echecsInternes = []
      const requetesApi = []
      let octets = 0

      onglet.on('pageerror', (e) => erreursJs.push(String(e.message).slice(0, 240)))
      onglet.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text().slice(0, 240)) })
      onglet.on('requestfailed', (r) => {
        if (r.url().startsWith(banc.statique.base)) echecsInternes.push(`${r.method()} ${r.url().replace(banc.statique.base, '')}`)
      })
      onglet.on('response', async (r) => {
        if (r.url().startsWith(banc.statique.base)) {
          if (r.status() >= 400) echecsInternes.push(`HTTP ${r.status()} ${r.url().replace(banc.statique.base, '')}`)
          try { octets += (await r.body()).length } catch (e) { /* corps déjà consommé */ }
        }
        if (r.url().startsWith(SUPABASE_PROD)) {
          const u = new URL(r.url())
          requetesApi.push({
            methode: r.request().method(),
            cible: u.pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth:'),
            statut: r.status(),
          })
        }
      })

      const debut = Date.now()
      let navigationOk = true
      await onglet.goto(banc.statique.base + '/' + chemin, { waitUntil: 'domcontentloaded', timeout: 20000 })
        .catch(() => { navigationOk = false })
      await onglet.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
      await onglet.waitForTimeout(1200)
      const ms = Date.now() - debut

      const etat = await onglet.evaluate(() => {
        const gate = document.getElementById('anagroci-authgate')
        let statutPortail = 'levé'
        if (gate) {
          const t = gate.textContent || ''
          if (/Accès non autorisé/.test(t)) statutPortail = 'refusé'
          else if (/Se connecter/.test(t)) statutPortail = 'connexion'
          else statutPortail = 'bloqué'
        }
        return {
          statutPortail,
          titre: document.title || '',
          lang: document.documentElement.getAttribute('lang') || '',
          debordement: document.documentElement.scrollWidth > window.innerWidth + 1,
          largeurDoc: document.documentElement.scrollWidth,
          nbFormulaires: document.querySelectorAll('form').length,
          nbChamps: document.querySelectorAll('input,select,textarea').length,
          nbBoutons: document.querySelectorAll('button,[role=button],a.btn').length,
          nbLiens: document.querySelectorAll('a[href]').length,
          imagesSansAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
          module: (document.querySelector('script[data-module]') || {}).dataset?.module || '',
        }
      }).catch(() => ({ statutPortail: 'erreur' }))

      observations.push({
        page: chemin, persona: persona.cle, role: persona.role, viewport: viewport.nom,
        ms, octets, navigationOk, ...etat,
        erreursJs, erreursConsole, echecsInternes,
        api: requetesApi,
        nbApi: requetesApi.length,
      })
      await onglet.close()
    }
    await contexte.close()
    console.log(`  ${persona.cle} / ${viewport.nom} — terminé`)
  }
}

await navigateur.close()
await banc.fermer()

mkdirSync('tests/reports/donnees', { recursive: true })
writeFileSync('tests/reports/donnees/01-parcours-pages.json', JSON.stringify({
  genere: new Date().toISOString(),
  pages: PAGES.length, personas: personas.map((p) => p.cle), viewports: viewports.map((v) => v.nom),
  observations,
}, null, 1))

const avecErreurJs = observations.filter((o) => o.erreursJs.length)
const avec404 = observations.filter((o) => o.echecsInternes.length)
console.log(`\n${observations.length} ouvertures — ${avecErreurJs.length} avec erreur JS, ${avec404.length} avec ressource interne en échec`)
console.log('Détail : tests/reports/donnees/01-parcours-pages.json')
