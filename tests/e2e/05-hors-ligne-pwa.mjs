/**
 * Couche PWA : que se passe-t-il quand le réseau disparaît ?
 *
 * L'application est présentée comme utilisable sur le terrain, hors couverture.
 * Ce script vérifie cette promesse par l'expérience, avec les service workers
 * ACTIVÉS (les autres scripts les bloquent pour rester déterministes).
 *
 * Deux service workers coexistent dans le dépôt :
 *   · i18n-sw.js  — enregistré par index.html, portée = tout le site ;
 *   · sw.js       — enregistré par fbms/index.html, portée = /fbms/ seulement.
 * Ils n'ont pas la même politique de cache. Ce script mesure laquelle
 * s'applique à chaque module et ce qu'elle donne hors ligne.
 *
 *   node tests/e2e/05-hors-ligne-pwa.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS } from '../bench/banc.mjs'

const resultats = []
function verdict(id, titre, attendu, obtenu, ok, gravite = 'HIGH', preuve = {}) {
  resultats.push({ id, titre, attendu, obtenu, ok, gravite: ok ? '—' : gravite, preuve })
  console.log(`${ok ? '  CONFORME  ' : '  DÉFAUT    '} ${id} ${titre}\n              ${obtenu}`)
}

const banc = await demarrerBanc()
const navigateur = await ouvrirNavigateur()
const agent = PERSONAS.find((p) => p.cle === 'agent')

const PAGES = [
  { chemin: 'terrain/achats.html', nom: 'Achats Terrain' },
  { chemin: 'terrain/sacs.html', nom: 'Stock & Sacs' },
  { chemin: 'index.html', nom: 'Portail' },
  { chemin: 'fbms/index.html', nom: 'FBMS Référentiel' },
]

for (const page of PAGES) {
  const etat = { horsLigne: false }
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    locale: 'fr-FR', serviceWorkers: 'allow',
  })
  await router(contexte, { ...banc, horsLigne: () => etat.horsLigne })
  const onglet = await contexte.newPage()
  await connecter(onglet, banc.api, agent)

  // 1er passage : en ligne, on laisse le service worker s'installer et prendre
  // le contrôle (il faut un second chargement pour qu'il intercepte).
  await onglet.goto(banc.statique.base + '/index.html', { waitUntil: 'domcontentloaded' })
  await onglet.waitForTimeout(2500)
  await onglet.goto(banc.statique.base + '/' + page.chemin, { waitUntil: 'domcontentloaded' })
  await onglet.waitForTimeout(3000)

  const controle = await onglet.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return {
      controle: !!navigator.serviceWorker.controller,
      script: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL.split('/').pop() : null,
      portee: reg ? reg.scope : null,
      caches: (await caches.keys()),
    }
  })

  // Réseau coupé, puis rechargement : c'est le geste du terrain.
  // Coupure TOTALE : le site lui-même devient injoignable. Sans cela, la
  // requête interceptée est relayée au serveur local et le « hors ligne » ne
  // teste rien — c'est le piège dans lequel une première version de ce script
  // est tombée.
  etat.horsLigne = 'total'
  await onglet.context().setOffline(true)
  let rechargementOk = true
  let contenu = ''
  try {
    await onglet.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
    contenu = await onglet.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 200))
  } catch (e) {
    rechargementOk = false
    contenu = String(e.message).slice(0, 150)
  }
  const utilisable = rechargementOk && /achat|sac|village|ANAGROCI|Chargement/i.test(contenu)

  verdict(
    'PWA-' + page.chemin.replace(/[^a-z]/gi, '').slice(0, 12),
    `Rechargement hors ligne — ${page.nom}`,
    'la page se recharge depuis le cache et reste utilisable',
    `service worker actif : ${controle.script || 'aucun'} (portée ${controle.portee || '—'}, caches ${JSON.stringify(controle.caches)}) ; rechargement hors ligne : ${rechargementOk ? 'abouti' : 'ÉCHEC'} ; contenu obtenu : « ${contenu.replace(/\s+/g, ' ').slice(0, 90)} »`,
    utilisable, 'CRITICAL',
    { page: page.chemin, controle, contenu },
  )
  await onglet.context().setOffline(false)
  etat.horsLigne = false
  await contexte.close()
}

/* Écriture hors ligne puis rechargement : la file survit-elle ? */
{
  const etat = { horsLigne: false }
  const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'allow' })
  await router(contexte, { ...banc, horsLigne: () => etat.horsLigne })
  const onglet = await contexte.newPage()
  await connecter(onglet, banc.api, agent)
  await onglet.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await onglet.waitForSelector('#saveComplet', { timeout: 20000 })
  await onglet.waitForTimeout(2000)
  const dejaEnFile = await onglet.evaluate(() => {
    // On dépose directement une saisie dans la file, comme le fait save().
    const rec = { local_id: 'TEST_LOAD_HORSLIGNE_1', date: '2026-08-22', village_nom: 'TEST_LOAD_V001', rt_nom: 'TEST_LOAD_RT_01', poids_net: 100, prix_kg: 400, montant: 40000, numero_recu: 'TEST_LOAD_HL1', nb_sacs: 2, _status: 'pending' }
    const all = JSON.parse(localStorage.getItem('anagroci_achats') || '[]')
    all.unshift(rec); localStorage.setItem('anagroci_achats', JSON.stringify(all))
    return all.length
  })
  etat.horsLigne = 'total'
  await contexte.setOffline(true)
  let survitAuRechargement = null
  try {
    await onglet.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
    survitAuRechargement = await onglet.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').length)
  } catch (e) {
    survitAuRechargement = 'page non rechargeable hors ligne'
  }
  await contexte.setOffline(false)
  etat.horsLigne = false
  verdict('PWA-FILE', 'File de saisie hors ligne après rechargement',
    'la file locale survit et reste consultable',
    `${dejaEnFile} achat(s) en file avant coupure ; après rechargement hors ligne : ${survitAuRechargement}`,
    survitAuRechargement === dejaEnFile, 'CRITICAL', {})
  await contexte.close()
}

await navigateur.close()
await banc.fermer()

mkdirSync('tests/reports/donnees', { recursive: true })
writeFileSync('tests/reports/donnees/05-hors-ligne.json', JSON.stringify({ genere: new Date().toISOString(), resultats }, null, 1))
const defauts = resultats.filter((r) => !r.ok)
console.log(`\n${resultats.length - defauts.length}/${resultats.length} conformes — ${defauts.length} défaut(s)`)
