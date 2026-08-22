/**
 * Lanceur de la campagne de charge.
 *
 * Enchaîne les paliers 1 / 5 / 10 / 25 / 50 / 75 / 100, puis la montée
 * progressive, le pic et la concurrence dure. Chaque exécution produit un
 * résumé JSON k6 rangé dans tests/reports/donnees/.
 *
 * Par défaut, la cible est l'ÉMULATEUR LOCAL : ce lanceur démarre lui-même
 * le serveur statique et l'émulateur Supabase sur des ports fixes, avec un
 * jeu de données de test. Voir l'en-tête de tests/load/00-commun.js pour
 * viser la production à la place.
 *
 *   node tests/load/executer.mjs                 # campagne complète
 *   node tests/load/executer.mjs --paliers 1,5   # sous-ensemble
 *   node tests/load/executer.mjs --latence 120   # latence serveur simulée
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { demarrerServeurStatique } from '../bench/serveur-statique.mjs'
import { demarrerFauxSupabase } from '../bench/faux-supabase.mjs'
import { PERSONAS, semer } from '../bench/banc.mjs'

const PORT_API = 54329
const PORT_SITE = 54330
const arg = (nom, defaut) => {
  const i = process.argv.indexOf('--' + nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const PALIERS = String(arg('paliers', '1,5,10,25,50,75,100')).split(',').map(Number)
const DUREE = arg('duree', '60s')
const LATENCE = Number(arg('latence', 0))
const PLAFOND = Number(arg('plafond', 0))

mkdirSync('tests/reports/donnees', { recursive: true })

const statique = await demarrerServeurStatique({ racine: process.cwd(), port: PORT_SITE, vendor: process.cwd() + '/node_modules' })
const api = await demarrerFauxSupabase({ port: PORT_API, latenceMs: LATENCE, plafondConcurrence: PLAFOND })
for (const p of PERSONAS) api.creerUtilisateur({ email: p.email, motDePasse: p.motDePasse, role: p.role, nom: p.nom, actif: p.actif !== false })
semer(api)

console.log(`Émulateur Supabase : ${api.base} (latence simulée ${LATENCE} ms, plafond ${PLAFOND || 'aucun'})`)
console.log(`Site statique      : ${statique.base}`)

function k6(script, env, sortie) {
  return new Promise((resolve) => {
    const args = ['run', '--summary-export', sortie, '--quiet']
    for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
    args.push(script)
    const p = spawn('k6', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } })
    let sortieTexte = ''
    p.stdout.on('data', (d) => { sortieTexte += d })
    p.stderr.on('data', (d) => { sortieTexte += d })
    p.on('close', (code) => resolve({ code, texte: sortieTexte }))
  })
}

const resultats = []

function lireResume(fichier, etiquette, extra = {}) {
  if (!existsSync(fichier)) return null
  const r = JSON.parse(readFileSync(fichier, 'utf8'))
  const m = r.metrics || {}
  const req = m.http_reqs || {}
  const dur = m.http_req_duration || {}
  const echec = m.http_req_failed || {}
  const ligne = {
    etiquette,
    requetes: req.count ?? 0,
    debitParSeconde: +(req.rate ?? 0).toFixed(2),
    tauxEchecHttp: +((echec.value ?? 0) * 100).toFixed(3),
    tauxEchecFonctionnel: +(((m.taux_echec_fonctionnel || {}).value ?? 0) * 100).toFixed(3),
    moy: Math.round(dur.avg ?? 0),
    p50: Math.round(dur.med ?? 0),
    p95: Math.round(dur['p(95)'] ?? 0),
    p99: Math.round(dur['p(99)'] ?? 0),
    max: Math.round(dur.max ?? 0),
    erreursMetier: (m.erreurs_metier || {}).count ?? 0,
    ecrituresRefusees: (m.ecritures_refusees || {}).count ?? 0,
    doublons: (m.doublons_detectes || {}).count ?? 0,
    ecrasementsSilencieux: (m.ecrasements_silencieux || {}).count ?? 0,
    doublonsLocalId: (m.doublons_local_id_acceptes || {}).count ?? 0,
    doublonsRecu: (m.doublons_recu_acceptes || {}).count ?? 0,
    parAction: Object.fromEntries(Object.entries(m)
      .filter(([k]) => k.startsWith('duree_'))
      .map(([k, v]) => [k, { n: v.count ?? 0, p50: Math.round(v.med ?? 0), p95: Math.round(v['p(95)'] ?? 0), p99: Math.round(v['p(99)'] ?? 0) }])),
    ...extra,
  }
  resultats.push(ligne)
  return ligne
}

/* ------------------------------- Paliers -------------------------------- */
for (const vus of PALIERS) {
  api.tables.set('achats', [])
  api.raz()
  const sortie = `tests/reports/donnees/k6-palier-${vus}.json`
  process.stdout.write(`Palier ${String(vus).padStart(3)} utilisateurs … `)
  const t0 = Date.now()
  const { code } = await k6('tests/load/01-paliers.js', {
    VUS: vus, DUREE, SUPABASE_URL: api.base, SUPABASE_KEY: 'sb_publishable_test',
  }, sortie)
  const ligne = lireResume(sortie, `palier-${vus}`, {
    vus, seuilsRespectes: code === 0,
    concurrenceServeurMax: api.maxConcurrence(),
    lignesAchatsCreees: (api.tables.get('achats') || []).length,
    dureeReelleS: Math.round((Date.now() - t0) / 1000),
  })
  console.log(ligne
    ? `${ligne.requetes} req · ${ligne.debitParSeconde}/s · p95 ${ligne.p95} ms · p99 ${ligne.p99} ms · échec ${ligne.tauxEchecHttp} % · seuils ${code === 0 ? 'OK' : 'DÉPASSÉS'}`
    : 'aucun résumé produit')
}

/* --------------------------- Montée progressive -------------------------- */
if (!process.argv.includes('--sans-montee')) {
  api.tables.set('achats', []); api.raz()
  process.stdout.write('Montée 0→100 puis maintien … ')
  const { code } = await k6('tests/load/02-montee.js', {
    SUPABASE_URL: api.base, SUPABASE_KEY: 'sb_publishable_test', MAINTIEN: arg('maintien', '3m'),
  }, 'tests/reports/donnees/k6-montee.json')
  const l = lireResume('tests/reports/donnees/k6-montee.json', 'montee-0-100', { seuilsRespectes: code === 0, concurrenceServeurMax: api.maxConcurrence() })
  console.log(l ? `${l.requetes} req · p95 ${l.p95} ms · p99 ${l.p99} ms · échec ${l.tauxEchecHttp} %` : 'aucun résumé')
}

/* ---------------------------------- Pic ---------------------------------- */
if (!process.argv.includes('--sans-pic')) {
  api.tables.set('achats', []); api.raz()
  process.stdout.write('Pic 10→100 … ')
  const { code } = await k6('tests/load/03-pic.js', { SUPABASE_URL: api.base, SUPABASE_KEY: 'sb_publishable_test' }, 'tests/reports/donnees/k6-pic.json')
  const l = lireResume('tests/reports/donnees/k6-pic.json', 'pic-10-100', { seuilsRespectes: code === 0, concurrenceServeurMax: api.maxConcurrence() })
  console.log(l ? `${l.requetes} req · p95 ${l.p95} ms · p99 ${l.p99} ms · échec ${l.tauxEchecHttp} %` : 'aucun résumé')
}

/* ----------------------------- Concurrence ------------------------------- */
if (!process.argv.includes('--sans-concurrence')) {
  api.tables.set('achats', []); api.raz()
  process.stdout.write('Concurrence dure (25 utilisateurs sur les mêmes enregistrements) … ')
  const { code } = await k6('tests/load/05-concurrence.js', { VUS: 25, DUREE: '60s', SUPABASE_URL: api.base, SUPABASE_KEY: 'sb_publishable_test' }, 'tests/reports/donnees/k6-concurrence.json')
  const l = lireResume('tests/reports/donnees/k6-concurrence.json', 'concurrence-25', { seuilsRespectes: code === 0 })
  console.log(l ? `écrasements silencieux ${l.ecrasementsSilencieux} · doublons local_id ${l.doublonsLocalId} · doublons reçu ${l.doublonsRecu}` : 'aucun résumé')
}

/* ------------------------------- Statique -------------------------------- */
if (!process.argv.includes('--sans-statique')) {
  process.stdout.write('Publication statique 0→100 … ')
  const { code } = await k6('tests/load/04-statique.js', { SITE: statique.base }, 'tests/reports/donnees/k6-statique.json')
  const l = lireResume('tests/reports/donnees/k6-statique.json', 'statique-0-100', { seuilsRespectes: code === 0 })
  console.log(l ? `${l.requetes} req · p95 ${l.p95} ms · échec ${l.tauxEchecHttp} %` : 'aucun résumé')
}

const { writeFileSync } = await import('node:fs')
writeFileSync('tests/reports/donnees/04-charge.json', JSON.stringify({
  genere: new Date().toISOString(),
  cible: api.base,
  avertissement: "Backend émulé localement : ces temps ne sont PAS ceux de Supabase en production. Ils mesurent la forme de la charge et le comportement du client.",
  latenceSimuleeMs: LATENCE, plafondConcurrence: PLAFOND, dureePalier: DUREE,
  resultats,
}, null, 1))

await statique.fermer()
await api.fermer()
console.log('\nRésultats : tests/reports/donnees/04-charge.json')
