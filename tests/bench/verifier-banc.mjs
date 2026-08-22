/**
 * Contrôle du banc d'essai lui-même.
 *
 * Un banc non vérifié invaliderait tout ce qui en sort. Ce script prouve que :
 *   1. le serveur statique renvoie les octets EXACTS du dépôt (comparaison
 *      octet à octet avec le fichier commis) ;
 *   2. le vrai SDK @supabase/supabase-js s'exécute dans la page ;
 *   3. l'émulateur authentifie et applique les rôles ;
 *   4. le portail d'authentification s'ouvre puis se lève réellement.
 *
 *   node tests/bench/verifier-banc.mjs
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS } from './banc.mjs'

const banc = await demarrerBanc()
const resultats = []
const dire = (ok, texte, detail = '') => { resultats.push({ ok, texte, detail }); console.log((ok ? '  OK   ' : '  ÉCHEC') + ' ' + texte + (detail ? ' — ' + detail : '')) }

/* 1. Octets identiques au dépôt. */
for (const f of ['index.html', 'terrain/achats.html', 'shared/auth-gate.js', 'fbms/index.html']) {
  const disque = readFileSync(f)
  const servi = Buffer.from(await (await fetch(banc.statique.base + '/' + f)).arrayBuffer())
  const a = createHash('sha256').update(disque).digest('hex')
  const b = createHash('sha256').update(servi).digest('hex')
  dire(a === b, `octets identiques : ${f}`, a.slice(0, 12))
}

/* 2/3. Émulateur : authentification et rôles. */
const bm = PERSONAS.find((p) => p.cle === 'bm')
const agent = PERSONAS.find((p) => p.cle === 'agent')
const inactif = PERSONAS.find((p) => p.cle === 'inactif')

const rMauvais = await fetch(banc.api.base + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'k' },
  body: JSON.stringify({ email: bm.email, password: 'mauvais' }),
})
dire(rMauvais.status === 400, 'mot de passe erroné refusé (400)', 'statut ' + rMauvais.status)

const sessionBM = await (await fetch(banc.api.base + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'k' },
  body: JSON.stringify({ email: bm.email, password: bm.motDePasse }),
})).json()
dire(!!sessionBM.access_token, 'connexion BM acceptée')

const anon = await fetch(banc.api.base + '/rest/v1/villages?select=id&deleted=eq.false', { headers: { apikey: 'sb_publishable_test' } })
const anonCorps = await anon.json()
dire(Array.isArray(anonCorps) && anonCorps.length === 0, 'RLS : visiteur anonyme ne lit aucun village', 'reçu ' + JSON.stringify(anonCorps).slice(0, 40))

const bmLit = await (await fetch(banc.api.base + '/rest/v1/villages?select=id&deleted=eq.false', {
  headers: { apikey: 'k', Authorization: 'Bearer ' + sessionBM.access_token },
})).json()
dire(bmLit.length === 40, 'BM lit les 40 villages de test', 'reçu ' + bmLit.length)

const sessionAgent = await (await fetch(banc.api.base + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'k' },
  body: JSON.stringify({ email: agent.email, password: agent.motDePasse }),
})).json()
const supAgent = await fetch(banc.api.base + '/rest/v1/achats?local_id=eq.zz', {
  method: 'DELETE', headers: { apikey: 'k', Authorization: 'Bearer ' + sessionAgent.access_token },
})
dire(supAgent.status === 403, 'RLS : Agent ne peut pas supprimer un achat', 'statut ' + supAgent.status)

const sessionOff = await fetch(banc.api.base + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'k' },
  body: JSON.stringify({ email: inactif.email, password: inactif.motDePasse }),
})
const jetonOff = (await sessionOff.json()).access_token
const litOff = await (await fetch(banc.api.base + '/rest/v1/villages?select=id', {
  headers: { apikey: 'k', Authorization: 'Bearer ' + jetonOff },
})).json()
dire(litOff.length === 0, 'RLS : compte désactivé ne lit rien', 'reçu ' + litOff.length)

/* 4. Le portail se lève réellement dans un navigateur. */
const navigateur = await ouvrirNavigateur()
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
await router(contexte, banc)
const page = await contexte.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(String(e.message)))

await page.goto(banc.statique.base + '/index.html', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const sdkCharge = await page.evaluate(() => !!(window.supabase && window.supabase.createClient))
dire(sdkCharge, 'le vrai SDK supabase-js est chargé dans la page')
const portailVisible = await page.locator('#anagroci-authgate').count()
dire(portailVisible === 1, 'portail d\'authentification affiché sans session')
const formulaire = await page.locator('#ag-email').count()
dire(formulaire === 1, 'formulaire de connexion présent')

await page.close()
const page2 = await contexte.newPage()
page2.on('pageerror', (e) => erreurs.push(String(e.message)))
await connecter(page2, banc.api, bm)
await page2.goto(banc.statique.base + '/index.html', { waitUntil: 'domcontentloaded' })
await page2.waitForTimeout(2000)
const gateParti = await page2.locator('#anagroci-authgate').count()
dire(gateParti === 0, 'portail levé après connexion BM')
const chip = await page2.locator('#anagroci-userslot .ag-name').textContent().catch(() => '')
dire(/TEST_LOAD_BM/.test(chip || ''), 'chip utilisateur affiche le profil connecté', chip || '(vide)')
const tuiles = await page2.locator('a.tile').count()
dire(tuiles === 10, 'les 10 tuiles applicatives sont rendues', 'compté ' + tuiles)

dire(erreurs.length === 0, 'aucune erreur JS non gérée sur le portail', erreurs.slice(0, 2).join(' | '))

await navigateur.close()
await banc.fermer()

const echecs = resultats.filter((r) => !r.ok)
console.log('\n' + (resultats.length - echecs.length) + '/' + resultats.length + ' contrôles du banc réussis')
process.exit(echecs.length ? 1 : 0)
