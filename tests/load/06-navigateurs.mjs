/**
 * Volet « navigateur » de la simulation hybride 100 utilisateurs.
 *
 * Architecture retenue (cahier de charge §10) :
 *   ·  10 utilisateurs NAVIGATEUR — vraies sessions Chromium, vrais parcours,
 *      vrai code applicatif, vraies files locales ;
 *   ·  90 utilisateurs PROTOCOLE — k6, mêmes appels réseau (tests/load/01-paliers.js).
 *
 * Pourquoi cette répartition et pas 100 navigateurs : une session Chromium avec
 * ce code coûte 150 à 400 Mo de mémoire (RCN TRACE charge 1 Mo de JavaScript et
 * construit 500 nœuds). Cent sessions ne diraient rien de plus sur le serveur, et
 * mesureraient surtout la machine qui exécute le test. Dix sessions suffisent à
 * vérifier ce que le protocole seul ne voit pas : cohérence de l'affichage,
 * mélange de sessions, files locales, erreurs JavaScript sous charge.
 *
 * À lancer PENDANT le palier k6 à 90 utilisateurs pour obtenir les 100 simultanés :
 *
 *   # terminal 1
 *   node tests/load/executer.mjs --paliers 90 --duree 5m --sans-montee --sans-pic \
 *        --sans-concurrence --sans-statique
 *   # terminal 2, une fois le palier lancé
 *   node tests/load/06-navigateurs.mjs --api http://127.0.0.1:54329 --site http://127.0.0.1:54330
 *
 * Sans argument, le script démarre son propre banc et tourne seul (10 utilisateurs).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS, SUPABASE_PROD, centiles } from '../bench/banc.mjs'

const arg = (nom, defaut) => { const i = process.argv.indexOf('--' + nom); return i >= 0 ? process.argv[i + 1] : defaut }
const NB = Number(arg('utilisateurs', 10))
const DUREE_MS = Number(arg('duree', 180)) * 1000

/* Répartition des gestes, calquée sur l'usage réel (cahier de charge §11). */
const PARCOURS = [
  { poids: 40, nom: 'consultation', page: 'index.html', persona: 'bm' },
  { poids: 20, nom: 'recherche', page: 'fbms/fbms_hubs.html', persona: 'sup' },
  { poids: 20, nom: 'creation', page: 'terrain/achats.html', persona: 'agent' },
  { poids: 10, nom: 'modification', page: 'fbms/audit_distances.html', persona: 'sup' },
  { poids: 5, nom: 'rapport', page: 'terrain/command.html', persona: 'bm' },
  { poids: 5, nom: 'lourd', page: 'rcntrace/index.html', persona: 'bm' },
]
function tirer(i) {
  let seuil = (i * 17) % 100
  for (const p of PARCOURS) { if (seuil < p.poids) return p; seuil -= p.poids }
  return PARCOURS[0]
}

const banc = await demarrerBanc()
const navigateur = await ouvrirNavigateur()
console.log(`${NB} utilisateurs navigateur, ${DUREE_MS / 1000} s`)

const journal = []
const erreursJs = []
const identites = []

async function utilisateur(i) {
  const parcours = tirer(i)
  const persona = PERSONAS.find((p) => p.cle === parcours.persona)
  const contexte = await navigateur.newContext({
    viewport: i % 2 ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: !!(i % 2), hasTouch: !!(i % 2), locale: 'fr-FR', serviceWorkers: 'block',
  })
  await router(contexte, banc)
  const page = await contexte.newPage()
  page.on('pageerror', (e) => erreursJs.push({ i, parcours: parcours.nom, message: String(e.message).slice(0, 160) }))
  await connecter(page, banc.api, persona)

  const fin = Date.now() + DUREE_MS
  let tour = 0
  while (Date.now() < fin) {
    tour++
    const t0 = Date.now()
    let statut = 'ok'
    try {
      await page.goto(banc.statique.base + '/' + parcours.page, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForFunction(() => !document.getElementById('anagroci-authgate'), null, { timeout: 25000 })
    } catch (e) { statut = 'echec:' + String(e.message).slice(0, 60) }
    journal.push({ i, parcours: parcours.nom, tour, ms: Date.now() - t0, statut })

    // Vérification d'identité : la session affichée est-elle bien la nôtre ?
    const chip = await page.textContent('#anagroci-userslot .ag-name').catch(() => '')
    identites.push({ i, attendu: persona.nom, affiche: (chip || '').trim() })

    if (parcours.nom === 'creation') {
      // Une saisie réelle, avec sa file locale et sa synchronisation.
      try {
        await page.waitForSelector('#saveComplet', { timeout: 15000 })
        await page.fill('#f_village', 'TEST_LOAD_V' + String((i % 40) + 1).padStart(3, '0'))
        await page.waitForFunction(() => {
          const r = document.getElementById('f_rt')
          return r && r.tagName === 'SELECT' && r.options.length > 1
        }, null, { timeout: 15000 })
        await page.fill('#f_brut', String(80 + i))
        await page.fill('#f_tare', '0')
        await page.fill('#f_prix', '400')
        await page.fill('#f_sacs', '2')
        await page.fill('#f_recu', `TEST_LOAD_NAV_${i}_${tour}`)
        await page.fill('#f_prod_tel', '0700000001')
        await page.waitForTimeout(1200)
        const options = await page.evaluate(() => [...document.getElementById('f_rt').options].map((o) => o.value).filter(Boolean))
        if (options.length) await page.selectOption('#f_rt', options[0])
        const t1 = Date.now()
        await page.click('#saveComplet')
        await page.waitForTimeout(2500)
        journal.push({ i, parcours: 'saisie_achat', tour, ms: Date.now() - t1, statut: 'ok' })
      } catch (e) {
        journal.push({ i, parcours: 'saisie_achat', tour, ms: 0, statut: 'echec:' + String(e.message).slice(0, 60) })
      }
    }
    await page.waitForTimeout(4000 + Math.random() * 6000)
  }
  await contexte.close()
}

const t0 = Date.now()
await Promise.all(Array.from({ length: NB }, (_, i) => utilisateur(i).catch((e) => erreursJs.push({ i, message: 'session interrompue : ' + e.message.slice(0, 120) }))))
const dureeReelle = Date.now() - t0

await navigateur.close()

const achats = banc.api.tables.get('achats') || []
const recus = achats.map((a) => a.numero_recu)
const doublonsRecu = recus.length - new Set(recus).size
const localIds = achats.map((a) => a.local_id)
const doublonsLocal = localIds.length - new Set(localIds).size
const melanges = identites.filter((x) => x.affiche && !x.affiche.includes(x.attendu))
const echecs = journal.filter((j) => j.statut !== 'ok')

const resume = {
  genere: new Date().toISOString(),
  utilisateurs: NB, dureeS: Math.round(dureeReelle / 1000),
  ouvertures: journal.filter((j) => j.parcours !== 'saisie_achat').length,
  saisies: journal.filter((j) => j.parcours === 'saisie_achat').length,
  echecs: echecs.length,
  detailEchecs: echecs.slice(0, 10),
  tempsOuverture: centiles(journal.filter((j) => j.parcours !== 'saisie_achat' && j.statut === 'ok').map((j) => j.ms)),
  tempsSaisie: centiles(journal.filter((j) => j.parcours === 'saisie_achat' && j.statut === 'ok').map((j) => j.ms)),
  achatsEnBase: achats.length,
  doublonsNumeroRecu: doublonsRecu,
  doublonsLocalId: doublonsLocal,
  melangesDeSession: melanges.length,
  detailMelanges: melanges.slice(0, 5),
  erreursJs: erreursJs.length,
  detailErreursJs: [...new Set(erreursJs.map((e) => e.message))].slice(0, 10),
  requetesBackend: banc.api.compteurs.requetes,
  erreursBackend: banc.api.compteurs.erreurs,
  concurrenceServeurMax: banc.api.maxConcurrence(),
}

await banc.fermer()
mkdirSync('tests/reports/donnees', { recursive: true })
writeFileSync('tests/reports/donnees/06-navigateurs.json', JSON.stringify(resume, null, 1))
console.log(JSON.stringify(resume, null, 1))
