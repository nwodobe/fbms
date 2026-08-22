/**
 * Robustesse : ce que l'application dit à l'utilisateur quand rien ne marche.
 *
 * Un défaut technique est une chose ; un défaut technique invisible en est une
 * autre. Ces scénarios ne cherchent pas à faire tomber l'application — ils
 * vérifient qu'elle **le dit** quand elle tombe, plutôt que de laisser
 * l'opérateur croire que sa saisie est passée.
 *
 *   node tests/e2e/07-robustesse.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS, SUPABASE_PROD } from '../bench/banc.mjs'

const resultats = []
function verdict(id, titre, attendu, obtenu, ok, gravite = 'HIGH', preuve = {}) {
  resultats.push({ id, titre, attendu, obtenu, ok, gravite: ok ? '—' : gravite, preuve })
  console.log(`${ok ? '  CONFORME  ' : '  DÉFAUT    '} ${id} ${titre}\n              ${obtenu}`)
}

const banc = await demarrerBanc()
const navigateur = await ouvrirNavigateur()
const agent = PERSONAS.find((p) => p.cle === 'agent')

/* ════════════════════════════════════════════════════════════════════════
   R-01 — Backend totalement indisponible (503 sur tout)
   ════════════════════════════════════════════════════════════════════════ */
{
  const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  await contexte.route(SUPABASE_PROD + '/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'service indisponible' }) }))
  const page = await contexte.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e.message).slice(0, 120)))
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  const vu = await page.evaluate(() => ({
    portail: !!document.getElementById('anagroci-authgate'),
    texteEcran: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    formulaireOuvert: !!document.getElementById('saveComplet'),
  }))
  const informe = /indisponible|erreur|impossible|réessay|hors ligne|connexion/i.test(vu.texteEcran)
  verdict('R-01', 'Backend totalement indisponible (HTTP 503)',
    'un message explicite, pas un écran figé',
    `portail affiché : ${vu.portail ? 'oui' : 'non'} · formulaire accessible : ${vu.formulaireOuvert ? 'oui' : 'non'} · message à l'écran : « ${vu.texteEcran.slice(0, 120)} » · erreurs JS : ${erreurs.length}`,
    informe, 'HIGH', { erreurs: erreurs.slice(0, 3) })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   R-02 — CDN tiers indisponible (le SDK Supabase ne se charge pas)
   ════════════════════════════════════════════════════════════════════════ */
{
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  await contexte.route(/supabase-js|jsdelivr/i, (route) => route.abort('failed'))
  const page = await contexte.newPage()
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const vu = await page.evaluate(() => ({
    portail: !!document.getElementById('anagroci-authgate'),
    texte: ((document.getElementById('anagroci-authgate') || document.body).innerText || '').replace(/\s+/g, ' ').slice(0, 200),
  }))
  const informe = /module de sécurité|réseau|réessay/i.test(vu.texte)
  verdict('R-02', 'CDN tiers indisponible : le SDK Supabase ne se charge pas',
    'message explicite ; idéalement, une copie locale de secours',
    `écran : « ${vu.texte.slice(0, 140)} »`,
    informe, 'MEDIUM',
    { note: "L'application affiche bien un message, mais elle reste entièrement inutilisable : aucune copie locale du SDK n'existe (01-MAPPING §8)." })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   R-03 — Session expirée en cours d'usage
   ════════════════════════════════════════════════════════════════════════ */
{
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  const page = await contexte.newPage()
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { timeout: 20000 })
  await page.waitForTimeout(1500)
  // Une saisie doit exister, sinon la synchronisation n'a rien à envoyer et le
  // test ne mesurerait rien.
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('anagroci_achats') || '[]')
    all.unshift({ local_id: 'TEST_LOAD_JETON', date: '2026-08-22', village_nom: 'TEST_LOAD_V001', rt_nom: 'TEST_LOAD_RT_01', poids_net: 100, prix_kg: 400, montant: 40000, numero_recu: 'TEST_LOAD_JET', nb_sacs: 2, _status: 'pending' })
    localStorage.setItem('anagroci_achats', JSON.stringify(all))
  })
  // Le jeton devient invalide côté serveur, sans que le client en soit prévenu.
  await contexte.route(SUPABASE_PROD + '/rest/v1/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'JWT expired', code: 'PGRST301' }) }))
  await page.evaluate(() => window.syncAll && window.syncAll())
  await page.waitForTimeout(4000)
  const vu = await page.evaluate(() => {
    const rec = JSON.parse(localStorage.getItem('anagroci_achats') || '[]')[0] || {}
    return {
      statut: rec._status || '(file vide)',
      erreur: rec._error || null,
      liste: (document.getElementById('list') || {}).textContent || '',
      msg: (document.getElementById('msg') || {}).textContent || '',
    }
  })
  const informe = /session|expir|reconnect|erreur|échec/i.test(vu.liste + ' ' + vu.msg)
  verdict('R-03', 'Jeton expiré pendant l\'usage',
    'invitation claire à se reconnecter',
    `statut de la file : ${vu.statut} · message : « ${(vu.msg || vu.liste).replace(/\s+/g, ' ').slice(0, 120) || '(aucun)'} »`,
    informe, 'MEDIUM', { vu })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   R-04 — Clics répétés sur « Synchroniser »
   ════════════════════════════════════════════════════════════════════════ */
{
  banc.api.tables.set('achats', [])
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  const page = await contexte.newPage()
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#syncBtn', { timeout: 20000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const all = []
    for (let i = 0; i < 5; i++) all.push({ local_id: 'TEST_LOAD_RAFALE_' + i, date: '2026-08-22', village_nom: 'TEST_LOAD_V001', rt_nom: 'TEST_LOAD_RT_01', poids_net: 100, prix_kg: 400, montant: 40000, numero_recu: 'TEST_LOAD_RAF_' + i, nb_sacs: 2, _status: 'pending' })
    localStorage.setItem('anagroci_achats', JSON.stringify(all))
  })
  const avant = banc.api.compteurs.requetes
  for (let i = 0; i < 8; i++) await page.click('#syncBtn', { force: true }).catch(() => {})
  await page.waitForTimeout(6000)
  const lignes = (banc.api.tables.get('achats') || []).length
  const requetes = banc.api.compteurs.requetes - avant
  verdict('R-04', 'Huit clics successifs sur « Synchroniser »',
    '5 lignes en base, aucun doublon',
    `${lignes} ligne(s) en base pour 5 achats en file, ${requetes} requêtes émises`,
    lignes === 5, 'MEDIUM', { requetes })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   R-05 — Retour navigateur après une saisie
   ════════════════════════════════════════════════════════════════════════ */
{
  banc.api.tables.set('achats', [])
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  const page = await contexte.newPage()
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/index.html', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { timeout: 20000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('anagroci_achats') || '[]')
    all.unshift({ local_id: 'TEST_LOAD_RETOUR', date: '2026-08-22', village_nom: 'TEST_LOAD_V001', rt_nom: 'TEST_LOAD_RT_01', poids_net: 100, prix_kg: 400, montant: 40000, numero_recu: 'TEST_LOAD_RET', nb_sacs: 2, _status: 'pending' })
    localStorage.setItem('anagroci_achats', JSON.stringify(all))
  })
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.goForward({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { timeout: 20000 })
  await page.waitForTimeout(2000)
  const enFile = await page.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').length)
  verdict('R-05', 'Retour puis avance navigateur avec une saisie en attente',
    'la file locale est intacte',
    `${enFile} achat(s) en file après aller-retour`,
    enFile >= 1, 'MEDIUM', {})
  await contexte.close()
}

await navigateur.close()
await banc.fermer()

mkdirSync('tests/reports/donnees', { recursive: true })
writeFileSync('tests/reports/donnees/08-robustesse.json', JSON.stringify({ genere: new Date().toISOString(), resultats }, null, 1))
const defauts = resultats.filter((r) => !r.ok)
console.log(`\n${resultats.length - defauts.length}/${resultats.length} conformes — ${defauts.length} défaut(s)`)
