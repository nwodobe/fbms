/**
 * Intégrité des données et concurrence — exécution réelle dans Chromium.
 *
 * Chaque test produit un verdict fondé sur un état OBSERVÉ des deux côtés :
 * ce que l'écran annonce, et ce que le backend détient réellement. C'est la
 * seule façon de détecter une « opération déclarée réussie mais non
 * enregistrée » (critère NO-GO §19 du cahier de charge).
 *
 * Aucune donnée réelle : tous les enregistrements portent le préfixe
 * TEST_LOAD_ et vivent dans l'émulateur local, jamais en production.
 *
 *   node tests/e2e/02-integrite-donnees.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS, SUPABASE_PROD } from '../bench/banc.mjs'

const resultats = []
function verdict(id, titre, attendu, obtenu, ok, gravite = 'HIGH', preuve = {}) {
  resultats.push({ id, titre, attendu, obtenu, ok, gravite: ok ? '—' : gravite, preuve })
  console.log(`${ok ? '  CONFORME  ' : '  DÉFAUT    '} ${id} ${titre}\n              attendu : ${attendu}\n              obtenu  : ${obtenu}`)
}

const banc = await demarrerBanc()
const navigateur = await ouvrirNavigateur()
const bm = PERSONAS.find((p) => p.cle === 'bm')
const agent = PERSONAS.find((p) => p.cle === 'agent')

/** Ouvre une page achats connectée, prête à saisir. */
async function ouvrirAchats(persona = agent, options = {}) {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  const etat = { horsLigne: false }
  await router(contexte, { ...banc, horsLigne: () => etat.horsLigne })
  const page = await contexte.newPage()
  page.on('pageerror', (e) => (options.erreurs || []).push(String(e.message)))
  await connecter(page, banc.api, persona)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { state: 'visible', timeout: 15000 })
  await page.waitForTimeout(800)
  return { contexte, page, etat }
}

/**
 * Saisit une valeur, que le champ soit resté un <input> ou qu'il ait été
 * remplacé par un <select> par terrain/achats_dropdown_patch.js.
 */
async function saisir(page, selecteur, valeur) {
  const balise = await page.evaluate((s) => (document.querySelector(s) || {}).tagName || '', selecteur)
  if (balise !== 'SELECT') { await page.fill(selecteur, valeur); return { mode: 'input' } }
  const options = await page.evaluate((s) => [...document.querySelector(s).options].map((o) => o.value), selecteur)
  const trouve = options.find((o) => o && o.toUpperCase().includes(valeur.toUpperCase()))
  if (trouve !== undefined) { await page.selectOption(selecteur, trouve); return { mode: 'select', valeur: trouve } }
  // Pas d'option correspondante : on utilise la saisie libre quand elle existe.
  if (options.includes('__FREE__')) {
    await page.selectOption(selecteur, '__FREE__')
    if (await page.locator('#f_prod_free').count()) await page.fill('#f_prod_free', valeur)
    return { mode: 'libre' }
  }
  return { mode: 'aucune-option', options }
}

/**
 * Remplit le formulaire d'achat.
 *
 * L'ordre n'est pas anodin : terrain/achats_dropdown_patch.js reconstruit le
 * <select> RT de façon asynchrone (renderRefs → innerHTML), ce qui EFFACE la
 * sélection en cours. Constat reproductible, consigné en BUG-004. Le harnais
 * pose donc le RT et le producteur en DERNIER, puis vérifie qu'ils ont tenu
 * juste avant le clic — sinon il refait la pose. Sans cela, la campagne
 * mesurerait ce défaut d'affichage à la place du comportement testé.
 */
async function remplirAchat(page, { recu, brut = 100, prix = 400, sacs = 2, village = 'TEST_LOAD_V001', rt = 'TEST_LOAD_RT_01', prod = 'TEST_LOAD_PRODUCTEUR_1', hum = null, kor = null } = {}) {
  await saisir(page, '#f_village', village)
  await page.waitForFunction(() => {
    const r = document.getElementById('f_rt')
    return r && r.tagName === 'SELECT' && r.options.length > 1
  }, null, { timeout: 20000 })
  await page.fill('#f_brut', String(brut))
  await page.fill('#f_tare', '0')
  await page.fill('#f_prix', String(prix))
  await page.fill('#f_sacs', String(sacs))
  await page.fill('#f_recu', recu)
  if (hum !== null) await page.fill('#f_hum', String(hum))
  if (kor !== null) await page.fill('#f_kor', String(kor))
  // Téléphone : la page réclame un numéro dès qu'elle croit le producteur non
  // référencé — ce qui, à cause de BUG-005, arrive pour TOUS les producteurs
  // choisis dans la liste déroulante. On le renseigne pour pouvoir tester la
  // suite du parcours ; le défaut lui-même est mesuré par T-INT-17.
  await page.fill('#f_prod_tel', '0700000001')
  await page.waitForTimeout(1500)     // laisse retomber les reconstructions en attente
  await poserRtEtProducteur(page, rt, prod)
}

async function poserRtEtProducteur(page, rt, prod) {
  for (let essai = 0; essai < 6; essai++) {
    const pose = await saisir(page, '#f_rt', rt)
    if (pose.mode === 'aucune-option') throw new Error('harnais : aucune option RT -> ' + JSON.stringify(pose.options))
    await saisir(page, '#f_prod', prod)
    await page.waitForTimeout(400)
    const tenu = await page.evaluate(() => ({
      rt: (document.getElementById('f_rt') || {}).value || '',
      prod: (document.getElementById('f_prod') || {}).value || '',
    }))
    if (tenu.rt) return tenu
  }
  throw new Error('harnais : la sélection RT est effacée en boucle par renderRefs (BUG-004)')
}

/** Clique sur Enregistrer après une dernière vérification de la sélection RT. */
async function enregistrer(page, { brouillon = false, rt = 'TEST_LOAD_RT_01', prod = 'TEST_LOAD_PRODUCTEUR_1' } = {}) {
  const valeur = await page.evaluate(() => (document.getElementById('f_rt') || {}).value || '')
  if (!valeur) await poserRtEtProducteur(page, rt, prod)
  await page.click(brouillon ? '#saveBrouillon' : '#saveComplet')
}

const achats = () => banc.api.tables.get('achats') || []
const razAchats = () => banc.api.tables.set('achats', [])

/* ════════════════════════════════════════════════════════════════════════
   T-INT-01 — Double-clic sur « Valider l'achat complet »
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page } = await ouvrirAchats()
  await remplirAchat(page, { recu: 'TEST_LOAD_R001' })
  await poserRtEtProducteur(page, 'TEST_LOAD_RT_01', 'TEST_LOAD_PRODUCTEUR_1')
  // Deux clics quasi simultanés, comme un appui nerveux sur un téléphone lent.
  await Promise.all([page.click('#saveComplet'), page.click('#saveComplet', { force: true })]).catch(() => {})
  await page.waitForTimeout(2500)
  const enFile = await page.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').length)
  const serveur = achats().length
  const msg01 = (await page.textContent('#msg').catch(() => '') || '').trim().slice(0, 80)
  verdict('T-INT-01', 'Double-clic sur Enregistrer (achats)',
    '1 achat en file locale et 1 sur le serveur',
    `${enFile} en file locale, ${serveur} sur le serveur — message écran : « ${msg01} »`,
    enFile === 1 && serveur === 1, 'CRITICAL',
    { local_ids: achats().map((a) => a.local_id) })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-02 — Deux saisies portant le MÊME numéro de reçu papier
   Le code client classe explicitement une erreur « Bloqué reçu doublon »
   (terrain/achats.html:classifyErr) : il attend donc une contrainte serveur.
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const a = await ouvrirAchats()
  await remplirAchat(a.page, { recu: 'TEST_LOAD_RECU_UNIQUE' })
  await enregistrer(a.page); await a.page.waitForTimeout(1500)
  await a.contexte.close()

  const b = await ouvrirAchats()
  await remplirAchat(b.page, { recu: 'TEST_LOAD_RECU_UNIQUE', brut: 250 })
  await enregistrer(b.page); await b.page.waitForTimeout(1500)
  const messageB = await b.page.textContent('#msg').catch(() => '')
  await b.contexte.close()

  const memeRecu = achats().filter((x) => x.numero_recu === 'TEST_LOAD_RECU_UNIQUE')
  verdict('T-INT-02', 'Deux achats avec le même numéro de reçu papier',
    'refus serveur (contrainte d\'unicité) ou alerte visible',
    `${memeRecu.length} lignes acceptées, message client : « ${(messageB || '').trim().slice(0, 70)} »`,
    memeRecu.length <= 1, 'HIGH',
    { poids: memeRecu.map((x) => x.poids_net), montants: memeRecu.map((x) => x.montant) })
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-03 — Réponse perdue APRÈS commit serveur, puis « Réessayer »
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  let couper = false
  // Le serveur reçoit et enregistre ; le client, lui, ne reçoit jamais la réponse.
  await router(contexte, banc)
  await contexte.route(SUPABASE_PROD + '/rest/v1/achats*', async (route) => {
    const reponse = await route.fetch({ url: banc.api.base + new URL(route.request().url()).pathname + new URL(route.request().url()).search })
    if (couper) return route.abort('connectionreset')
    return route.fulfill({ response: reponse })
  })
  const page = await contexte.newPage()
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { timeout: 15000 })
  await page.waitForTimeout(600)

  couper = true
  await remplirAchat(page, { recu: 'TEST_LOAD_R003' })
  await enregistrer(page)
  await page.waitForTimeout(2000)
  const apresCoupure = achats().length
  const statutClient1 = await page.evaluate(() => (JSON.parse(localStorage.getItem('anagroci_achats') || '[]')[0] || {})._status)

  couper = false
  await page.evaluate(() => window.syncAll())
  await page.waitForTimeout(2000)
  const apresRetry = achats().length
  const statutClient2 = await page.evaluate(() => (JSON.parse(localStorage.getItem('anagroci_achats') || '[]')[0] || {})._status)

  verdict('T-INT-03', 'Réponse perdue après commit serveur puis renvoi',
    'exactement 1 ligne serveur, client marqué « synced »',
    `${apresCoupure} ligne(s) après coupure puis ${apresRetry} après renvoi ; statut client ${statutClient1} → ${statutClient2}`,
    apresRetry === 1 && statutClient2 === 'synced', 'CRITICAL', {})
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-04 — Saturation du quota localStorage pendant une saisie
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page } = await ouvrirAchats()
  const remplissage = await page.evaluate(() => {
    // Sature réellement : gros blocs jusqu'au refus, puis blocs de plus en plus
    // fins, pour ne laisser aucune marge — c'est l'état d'un téléphone après
    // plusieurs journées de saisie hors ligne avec photos de reçus.
    let blocs = 0, erreur = null
    for (const taille of [256 * 1024, 16 * 1024, 1024, 64]) {
      try { for (let i = 0; i < 2000; i++) { localStorage.setItem('TEST_LOAD_ballast_' + taille + '_' + i, 'x'.repeat(taille)); blocs++ } }
      catch (e) { erreur = e.name }
    }
    let reste = 0
    try { localStorage.setItem('TEST_LOAD_sonde', 'y'.repeat(32)); localStorage.removeItem('TEST_LOAD_sonde'); reste = 32 } catch (e) { reste = 0 }
    return { blocs, erreur, margeRestanteOctets: reste }
  })
  await remplirAchat(page, { recu: 'TEST_LOAD_R004' })
  await enregistrer(page)
  await page.waitForTimeout(1500)
  const message = (await page.textContent('#msg').catch(() => '') || '').trim()
  const classeMsg = await page.getAttribute('#msg', 'class').catch(() => '')
  const enFile = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('anagroci_achats') || '[]').length } catch (e) { return -1 } })
  const surServeur = achats().length
  const annonceSucces = /valid|enregistr/i.test(message) && !/erreur|échec|impossible/i.test(message)

  verdict('T-INT-04', 'Quota localStorage saturé pendant une saisie d\'achat',
    'échec explicite à l\'écran, ou achat réellement conservé',
    `quota atteint après ${remplissage.blocs} blocs (${remplissage.erreur}, marge résiduelle ${remplissage.margeRestanteOctets} o) ; message « ${message.slice(0, 60)} » (classe ${classeMsg}) ; ${enFile} en file, ${surServeur} sur le serveur`,
    !(annonceSucces && enFile === 0 && surServeur === 0), 'BLOCKER',
    { message, enFile, surServeur, quota: remplissage })
  await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('TEST_LOAD_ballast_')).forEach((k) => localStorage.removeItem(k)) })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-05 — File d'attente locale corrompue
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page } = await ouvrirAchats()
  await remplirAchat(page, { recu: 'TEST_LOAD_R005' })
  await enregistrer(page)
  await page.waitForTimeout(1200)
  // On garde l'achat côté client (non synchronisé) puis on tronque la clé,
  // ce qu'une écriture interrompue par une fermeture d'onglet produit.
  const avant = await page.evaluate(() => {
    const brut = localStorage.getItem('anagroci_achats') || '[]'
    localStorage.setItem('anagroci_achats', brut.slice(0, Math.floor(brut.length * 0.6)))
    return JSON.parse(brut).length
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { timeout: 15000 })
  await page.waitForTimeout(1200)
  // On mesure ce que voit l'APPLICATION (sa fonction load() avale l'exception
  // de parsing et renvoie une liste vide), pas ce que voit le test.
  const vuParLApp = await page.evaluate(() => (typeof window.load === 'function' ? window.load('anagroci_achats', []) : []).length)
  const brutRestant = await page.evaluate(() => (localStorage.getItem('anagroci_achats') || '').length)
  // L'avertissement peut apparaître dans le bandeau de message OU en tête de
  // la liste : on regarde les deux, c'est la visibilité qui est testée.
  const alerte = ((await page.textContent('#msg').catch(() => '')) || '')
    + ' ' + ((await page.textContent('#list').catch(() => '')) || '')
  const compteurEcran = await page.textContent('#kPend').catch(() => '')
  verdict('T-INT-05', 'File locale tronquée (écriture interrompue)',
    'alerte visible pour l\'utilisateur, ou récupération partielle',
    `${avant} achat(s) avant ; après rechargement l'application en voit ${vuParLApp} (${brutRestant} octets illisibles restent en base locale) ; message écran : « ${(alerte || '(aucun)').trim().slice(0, 50) || '(aucun)'} », compteur « en attente » : ${compteurEcran}`,
    !(avant > 0 && vuParLApp === 0 && !/perdu|corrompu|erreur|illisible|mis de côté/i.test(alerte || '')), 'CRITICAL', { brutRestant })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-06 — Coupure réseau pendant la saisie, puis retour du réseau
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page, etat } = await ouvrirAchats()
  // On saisit en ligne (l'agent a ouvert la page au bureau), PUIS le réseau
  // tombe : c'est la situation de terrain, et c'est aussi la seule où les
  // listes de référence sont disponibles.
  await remplirAchat(page, { recu: 'TEST_LOAD_R006' })
  etat.horsLigne = true
  await page.evaluate(() => { window.ONLINE = false; window.dispatchEvent(new Event('offline')) })
  await enregistrer(page)
  await page.waitForTimeout(1500)
  const enFileHorsLigne = await page.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').length)
  const serveurHorsLigne = achats().length
  etat.horsLigne = false
  await page.evaluate(() => { window.ONLINE = true; window.dispatchEvent(new Event('online')) })
  await page.evaluate(() => window.syncAll())
  await page.waitForTimeout(2500)
  const serveurApres = achats().length
  verdict('T-INT-06', 'Coupure réseau pendant la saisie puis reconnexion',
    'achat conservé hors ligne puis remonté une seule fois',
    `hors ligne : ${enFileHorsLigne} en file / ${serveurHorsLigne} serveur ; après retour réseau : ${serveurApres} sur le serveur`,
    enFileHorsLigne === 1 && serveurApres === 1, 'BLOCKER', {})
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-07 — Fermeture de l'onglet pendant la synchronisation
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  let lent = false
  await router(contexte, banc)
  await contexte.route(SUPABASE_PROD + '/rest/v1/achats*', async (route) => {
    if (lent) await new Promise((r) => setTimeout(r, 4000))
    const u = new URL(route.request().url())
    const reponse = await route.fetch({ url: banc.api.base + u.pathname + u.search })
    return route.fulfill({ response: reponse })
  })
  const page = await contexte.newPage()
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { timeout: 15000 })
  await page.waitForTimeout(600)
  lent = true
  await remplirAchat(page, { recu: 'TEST_LOAD_R007' })
  await enregistrer(page)
  await page.waitForTimeout(900)         // synchro engagée, réponse pas encore là
  const etatAvant = await page.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').map((r) => r._status))
  await page.close()                      // fermeture brutale de l'onglet
  await new Promise((r) => setTimeout(r, 5000))
  const surServeur = achats().length

  const page2 = await contexte.newPage()
  await connecter(page2, banc.api, agent)
  lent = false
  await page2.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page2.waitForSelector('#saveComplet', { timeout: 15000 })
  await page2.waitForTimeout(2500)
  const apresReprise = achats().length
  const statuts = await page2.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').map((r) => r._status))
  verdict('T-INT-07', 'Fermeture de l\'onglet pendant la synchronisation',
    'aucune perte, aucun doublon après réouverture',
    `${surServeur} ligne(s) serveur à la fermeture (statut client ${etatAvant.join(',')}), ${apresReprise} après réouverture (statut ${statuts.join(',')})`,
    apresReprise === 1, 'CRITICAL', {})
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-08 — Collision : deux utilisateurs modifient le MÊME village

   Ce test passe par le VRAI chemin de code de la page (RemoteVillages.upsert),
   dans deux navigateurs authentifiés distincts, et non par des appels HTTP
   fabriqués. C'est indispensable depuis que le contrôle de conflit est devenu
   une écriture conditionnelle : un test qui rejouerait l'ancienne séquence
   mesurerait l'ancien code, pas celui qui est livré.
   ════════════════════════════════════════════════════════════════════════ */
{
  const villages = banc.api.tables.get('villages')
  const cible = villages[0]
  const versionInitiale = cible.updated_at
  // Copie intégrale : ce test écrase réellement la fiche (colonnes ET data).
  // Ne restaurer que le nom laisserait la colonne `village` altérée, et les
  // tests suivants ne retrouveraient plus le village dans les listes.
  const instantane = JSON.parse(JSON.stringify(cible))

  async function ouvrirReferentiel(persona) {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
    await router(contexte, banc)
    const page = await contexte.newPage()
    await connecter(page, banc.api, persona)
    await page.goto(banc.statique.base + '/fbms/index.html', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => typeof RemoteVillages !== 'undefined' && typeof RemoteVillages.upsert === 'function', null, { timeout: 25000 })
    return { contexte, page }
  }

  /** Écrit la fiche via le code de la page, en partant de la version lue. */
  const ecrire = (page, id, base, valeur) => page.evaluate(async ([id, base, valeur]) => {
    const v = {
      id, statut: 'Validé',
      s1: { village: valeur, cluster: 'TEST_LOAD_CLUSTER_A', region: 'TEST_LOAD_REGION', departement: 'TEST_LOAD_DEPT' },
      s9: { potentiel20: 10, route20: 10, dispoRT20: 10, risqueConcurrentiel20: 10, faisabilitePaiement20: 10 },
      photos: {}, updatedAt: base,
    }
    try {
      const r = await RemoteVillages.upsert(v, base, false)
      return { conflit: !!(r && r.conflict), valeurServeur: r && r.village && r.village.s1 && r.village.s1.village }
    } catch (e) { return { erreur: String(e && e.message || e) } }
  }, [id, base, valeur])

  const a = await ouvrirReferentiel(bm)
  const b = await ouvrirReferentiel(PERSONAS.find((p) => p.cle === 'sup'))

  // Les deux partent de la MÊME version de référence : c'est la collision.
  const base = versionInitiale
  const rA = await ecrire(a.page, cible.id, base, 'TEST_LOAD_MODIF_A')
  const rB = await ecrire(b.page, cible.id, base, 'TEST_LOAD_MODIF_B')

  const final = villages.find((v) => v.id === cible.id)
  const valeurFinale = final.data.s1.village
  const acceptes = [rA, rB].filter((r) => r && !r.conflit && !r.erreur).length
  const conflits = [rA, rB].filter((r) => r && r.conflit).length
  const perteSilencieuse = acceptes === 2   // deux écritures acceptées : l'une est perdue sans le dire

  verdict('T-INT-08', 'Deux utilisateurs modifient le même village (entrelacement)',
    'une écriture acceptée, la seconde signalée en conflit',
    `base de référence commune ; A → ${rA.conflit ? 'conflit signalé' : (rA.erreur || 'accepté')} · B → ${rB.conflit ? 'conflit signalé' : (rB.erreur || 'accepté')} ; valeur finale « ${valeurFinale} » ; ${acceptes} écriture(s) acceptée(s), ${conflits} conflit(s) signalé(s)`,
    acceptes === 1 && conflits === 1 && !perteSilencieuse, 'CRITICAL',
    { rA, rB, versionInitiale, valeurFinale, mecanisme: 'écriture conditionnelle UPDATE ... WHERE id = ? AND updated_at = ? (fbms/index.html:RemoteVillages.upsert)' })

  await a.contexte.close(); await b.contexte.close()
  const i = villages.findIndex((v) => v.id === cible.id)
  if (i >= 0) villages[i] = instantane
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-09 — Fiche village incomplète (section s9 absente)
   ════════════════════════════════════════════════════════════════════════ */
{
  const villages = banc.api.tables.get('villages')
  const incomplet = JSON.parse(JSON.stringify(villages[1]))
  incomplet.id = '00000000-0000-4000-8000-999999999999'
  incomplet.village = 'TEST_LOAD_SANS_S9'
  incomplet.data.id = incomplet.id
  incomplet.data.s1.village = 'TEST_LOAD_SANS_S9'
  delete incomplet.data.s9
  villages.push(incomplet)

  const erreurs = []
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  const page = await contexte.newPage()
  page.on('pageerror', (e) => erreurs.push(String(e.message)))
  await connecter(page, banc.api, bm)
  await page.goto(banc.statique.base + '/fbms/index.html', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const casse = erreurs.some((e) => /potentiel20|s9|undefined/.test(e))
  verdict('T-INT-09', 'Fiche village sans section s9 (donnée incomplète)',
    'la page reste fonctionnelle, la fiche est traitée avec une note nulle',
    casse ? `erreur JS non gérée : « ${erreurs.find((e) => /potentiel20|s9/.test(e))} »` : 'aucune erreur JS',
    !casse, 'HIGH', { erreurs: erreurs.slice(0, 3), source: 'fbms/index.html:759 scoreOf() lit v.s9 sans garde' })
  await contexte.close()
  villages.pop()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-10 — Valeurs limites et caractères spéciaux dans le formulaire
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page } = await ouvrirAchats()
  const cas = [
    { nom: 'poids négatif', champ: '#f_brut', valeur: '-50', attenduRefus: true },
    { nom: 'poids nul', champ: '#f_brut', valeur: '0', attenduRefus: true },
    { nom: 'prix nul', champ: '#f_prix', valeur: '0', attenduRefus: true },
    { nom: 'humidité 99 %', champ: '#f_hum', valeur: '99', attenduRefus: true },
    { nom: 'KOR 500 %', champ: '#f_kor', valeur: '500', attenduRefus: true },
    { nom: 'poids extrême 1e12', champ: '#f_brut', valeur: '1000000000000', attenduRefus: false },
    { nom: 'reçu 5000 caractères', champ: '#f_recu', valeur: 'A'.repeat(5000), attenduRefus: false },
    { nom: 'reçu injection <script>', champ: '#f_recu', valeur: '<script>window.__XSS=1</script>', attenduRefus: false },
    { nom: 'accents et unicode', champ: '#f_recu', valeur: 'REÇU_ÉÈÊ_ŒŽ_ᜠ', attenduRefus: false },
  ]
  const detail = []
  for (const c of cas) {
    await page.evaluate(() => { localStorage.setItem('anagroci_achats', '[]') })
    await remplirAchat(page, { recu: 'TEST_LOAD_LIM' })
    await page.fill(c.champ, c.valeur)
    await enregistrer(page)
    await page.waitForTimeout(500)
    const message = (await page.textContent('#msg').catch(() => '') || '').trim()
    const classe = await page.getAttribute('#msg', 'class').catch(() => '')
    const enregistre = await page.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').length) > 0
    detail.push({ cas: c.nom, refuse: !enregistre, message: message.slice(0, 70), classe, conforme: c.attenduRefus ? !enregistre : true })
  }
  const xss = await page.evaluate(() => !!window.__XSS)
  await page.waitForTimeout(500)
  const nonConformes = detail.filter((d) => !d.conforme)
  verdict('T-INT-10', 'Valeurs limites, caractères spéciaux et injection',
    'toute valeur métier impossible est refusée avec un message',
    nonConformes.length ? nonConformes.map((d) => d.cas).join(', ') + ' acceptés' : 'tous les cas impossibles sont refusés',
    nonConformes.length === 0 && !xss, 'MEDIUM', { detail, xssExecute: xss })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-11 — Deux onglets du même utilisateur saisissent en parallèle
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  const o1 = await contexte.newPage(); await connecter(o1, banc.api, agent)
  await o1.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await o1.waitForSelector('#saveComplet', { timeout: 15000 })
  const o2 = await contexte.newPage()
  await o2.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await o2.waitForSelector('#saveComplet', { timeout: 15000 })
  await o1.waitForTimeout(800)

  await remplirAchat(o1, { recu: 'TEST_LOAD_ONGLET_1', brut: 111 })
  await remplirAchat(o2, { recu: 'TEST_LOAD_ONGLET_2', brut: 222 })
  await Promise.all([enregistrer(o1), enregistrer(o2)])
  await o1.waitForTimeout(3000)
  const file = await o1.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').map((r) => r.numero_recu))
  const serveur = achats().map((a) => a.numero_recu).sort()
  verdict('T-INT-11', 'Deux onglets du même compte saisissent en parallèle',
    'les 2 achats survivent (file locale partagée)',
    `file locale : [${file.join(', ')}] ; serveur : [${serveur.join(', ')}]`,
    serveur.length === 2, 'HIGH', { file, serveur })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-12 — Rechargement de la page pendant la synchronisation
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  let lent = false
  await router(contexte, banc)
  await contexte.route(SUPABASE_PROD + '/rest/v1/achats*', async (route) => {
    if (lent) await new Promise((r) => setTimeout(r, 3500))
    const u = new URL(route.request().url())
    const reponse = await route.fetch({ url: banc.api.base + u.pathname + u.search })
    return route.fulfill({ response: reponse })
  })
  const page = await contexte.newPage()
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { timeout: 15000 })
  await page.waitForTimeout(600)
  lent = true
  await remplirAchat(page, { recu: 'TEST_LOAD_R012' })
  await enregistrer(page)
  await page.waitForTimeout(800)
  await page.reload({ waitUntil: 'domcontentloaded' })
  lent = false
  await page.waitForSelector('#saveComplet', { timeout: 15000 })
  await page.waitForTimeout(4000)
  const serveur = achats().length
  const statuts = await page.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').map((r) => r._status))
  verdict('T-INT-12', 'Rechargement pendant la synchronisation',
    'exactement 1 ligne serveur, aucun achat bloqué en « pending »',
    `${serveur} ligne(s) serveur, statuts clients [${statuts.join(', ')}]`,
    serveur === 1, 'HIGH', { statuts })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-13 — Champ qualité KOR : conservé de l'écran jusqu'à la base ?
   terrain/achats_dropdown_patch.js remplace window.syncAll et exécute
   `delete payload.kor` avant l'envoi.
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page } = await ouvrirAchats()
  await remplirAchat(page, { recu: 'TEST_LOAD_R013', hum: 8, kor: 47 })
  await enregistrer(page)
  await page.waitForTimeout(2500)
  const ligne = achats()[0] || {}
  const local = await page.evaluate(() => (JSON.parse(localStorage.getItem('anagroci_achats') || '[]')[0] || {}))
  verdict('T-INT-13', 'Le KOR saisi arrive-t-il jusqu\'à la base ?',
    'kor = 47 dans la ligne serveur',
    `saisi à l'écran : ${local.kor} · humidité transmise : ${ligne.humidite} · kor transmis : ${ligne.kor === undefined ? 'ABSENT de la ligne serveur' : ligne.kor}`,
    ligne.kor === 47, 'CRITICAL',
    { source: 'terrain/achats_dropdown_patch.js — `delete payload.kor` dans le syncAll de remplacement', ligneServeur: Object.keys(ligne) })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-14 — Photo du reçu : preuve de paiement conservée ?
   Le syncAll d'origine n'efface la photo qu'après obtention d'une URL
   serveur ; celui du correctif fait `delete rec.recu_photo` sans condition
   et n'appelle jamais l'envoi vers le Storage.
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page } = await ouvrirAchats()
  await remplirAchat(page, { recu: 'TEST_LOAD_R014' })
  // Photo simulée par l'API interne de la page (équivalent d'une prise de vue).
  // Vraie prise de vue : on dépose un JPEG dans le champ fichier et on laisse
  // onPhoto() faire son travail (redimensionnement + dataURL).
  await page.setInputFiles('#f_photo', {
    name: 'TEST_LOAD_recu.jpg', mimeType: 'image/jpeg',
    buffer: Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAKAAoBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AJ//2Q==', 'base64'),
  })
  await page.waitForFunction(() => /prête/.test((document.getElementById('photoHint') || {}).textContent || ''), null, { timeout: 10000 })
  const photoAvant = await page.evaluate(() => { try { return typeof PHOTO === 'string' ? PHOTO.length : 0 } catch (e) { return -1 } })
  await enregistrer(page)
  await page.waitForTimeout(2500)
  const ligne = achats()[0] || {}
  const local = await page.evaluate(() => (JSON.parse(localStorage.getItem('anagroci_achats') || '[]')[0] || {}))
  const photoLocaleRestante = !!local.recu_photo
  const urlServeur = ligne.recu_photo_url || null
  const base64EnBase = typeof ligne.recu_photo === 'string' ? ligne.recu_photo.length : 0
  verdict('T-INT-14', 'Photo du reçu : où finit la preuve de paiement ?',
    'fichier dans Supabase Storage + URL dans la ligne (recu_photo_url)',
    `photo saisie : ${photoAvant} o ; URL Storage : ${urlServeur || 'aucune'} ; base64 écrit dans la colonne recu_photo de la table achats : ${base64EnBase} o ; copie locale conservée : ${photoLocaleRestante ? 'oui' : 'non'}`,
    !!urlServeur && base64EnBase === 0, 'HIGH',
    { source: 'shared/anagroci-audit.js:syncQueueWithErrors envoie la ligne telle quelle, base64 compris — alors que terrain/achats.html:syncAll annonce « jamais de base64 dans la table »' })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-15 — Un brouillon (sans reçu) part-il en base ?
   Le syncAll d'origine ne pousse que « pending » / « failed » ; celui du
   correctif pousse tout ce qui n'est pas « synced », brouillons compris.
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page } = await ouvrirAchats()
  await remplirAchat(page, { recu: '' })
  await enregistrer(page, { brouillon: true })
  await page.waitForTimeout(1200)
  const enFile = await page.evaluate(() => JSON.parse(localStorage.getItem('anagroci_achats') || '[]').map((r) => [r._status, r.numero_recu]))
  await page.evaluate(() => window.syncAll())
  await page.waitForTimeout(2500)
  const surServeur = achats().map((a) => ({ statut: a.statut_validation, recu: a.numero_recu, mode: a.saisie_mode }))
  verdict('T-INT-15', 'Un brouillon sans reçu est-il poussé en base ?',
    'le brouillon reste local tant qu\'il n\'est pas validé',
    `file locale ${JSON.stringify(enFile)} → serveur ${JSON.stringify(surServeur)}`,
    surServeur.length === 0, 'HIGH',
    { source: 'achats_dropdown_patch.js filtre `_status!=="synced"` là où la page filtre `pending|failed`' })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-16 — Un refus serveur est-il visible à l'écran ?
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  await contexte.route(SUPABASE_PROD + '/rest/v1/achats*', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy for table "achats"' }) })
    }
    const u = new URL(route.request().url())
    return route.fulfill({ response: await route.fetch({ url: banc.api.base + u.pathname + u.search }) })
  })
  const page = await contexte.newPage()
  await connecter(page, banc.api, agent)
  await page.goto(banc.statique.base + '/terrain/achats.html', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saveComplet', { timeout: 15000 })
  await page.waitForTimeout(600)
  await remplirAchat(page, { recu: 'TEST_LOAD_R016' })
  await enregistrer(page)
  await page.waitForTimeout(3000)
  const vu = await page.evaluate(() => {
    const rec = JSON.parse(localStorage.getItem('anagroci_achats') || '[]')[0] || {}
    return {
      statut: rec._status, erreurStockee: rec._error || null, categorie: rec._errcat || null,
      tousLesStatuts: JSON.parse(localStorage.getItem('anagroci_achats') || '[]').map((r) => r._status),
      texteListe: (document.getElementById('list') || {}).textContent || '',
      badge: (document.getElementById('kPend') || {}).textContent || '',
    }
  })
  const signale = /erreur|échec|refus|voir l'erreur/i.test(vu.texteListe)
  verdict('T-INT-16', 'Refus serveur (RLS) : l\'utilisateur en est-il averti ?',
    'l\'achat passe en « échec » et l\'erreur est proposée à la lecture',
    `statut client « ${vu.statut} », erreur mémorisée : ${vu.erreurStockee ? 'oui' : 'non'}, mention d'échec à l'écran : ${signale ? 'oui' : 'NON'} (compteur en attente : ${vu.badge})`,
    signale, 'HIGH',
    { source: 'achats_dropdown_patch.js ne met jamais `_status="failed"` ; l\'écran ne connaît que « En attente »', vu })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   T-INT-17 — Un producteur choisi dans la liste des enrôlés est-il reconnu ?
   La liste déroulante propose « CODE - NOM » ; terrain/achats.html cherche le
   producteur par son NOM seul (currentProdRow / prodLabel).
   ════════════════════════════════════════════════════════════════════════ */
{
  razAchats()
  const { contexte, page } = await ouvrirAchats()
  await saisir(page, '#f_village', 'TEST_LOAD_V001')
  await page.waitForFunction(() => {
    const r = document.getElementById('f_rt')
    return r && r.tagName === 'SELECT' && r.options.length > 1
  }, null, { timeout: 20000 })
  await page.fill('#f_brut', '100'); await page.fill('#f_tare', '0')
  await page.fill('#f_prix', '400'); await page.fill('#f_sacs', '2')
  await page.fill('#f_recu', 'TEST_LOAD_R017')
  await page.waitForTimeout(1500)
  await poserRtEtProducteur(page, 'TEST_LOAD_RT_01', 'TEST_LOAD_PRODUCTEUR_1')
  const valeurListe = await page.evaluate(() => (document.getElementById('f_prod') || {}).value)
  await page.click('#saveComplet')            // sans téléphone : on observe la réaction
  await page.waitForTimeout(1200)
  const message = (await page.textContent('#msg').catch(() => '') || '').trim()
  const refuse = /non référencé|téléphone obligatoire/i.test(message)
  // On complète pour lire ce que la base retient réellement du producteur.
  await page.fill('#f_prod_tel', '0700000001')
  await enregistrer(page)
  await page.waitForTimeout(2500)
  const ligne = achats()[0] || {}
  verdict('T-INT-17', 'Producteur choisi dans la liste des enrôlés : reconnu ?',
    'producteur_ref = true, aucun téléphone réclamé',
    `valeur de la liste « ${valeurListe} » ; message : « ${message.slice(0, 70)} » ; en base producteur_ref = ${ligne.producteur_ref}, statut « ${ligne.producteur_statut} », producteur_id = ${ligne.producteur_id}`,
    !refuse && ligne.producteur_ref === true, 'HIGH',
    { source: 'achats_dropdown_patch.js écrit « CODE - NOM » comme valeur ; achats.html:currentProdRow compare avec prodLabel() qui ne rend que le NOM' })
  await contexte.close()
}

await navigateur.close()
await banc.fermer()

mkdirSync('tests/reports/donnees', { recursive: true })
writeFileSync('tests/reports/donnees/02-integrite.json', JSON.stringify({ genere: new Date().toISOString(), resultats }, null, 1))
const defauts = resultats.filter((r) => !r.ok)
console.log(`\n${resultats.length - defauts.length}/${resultats.length} conformes — ${defauts.length} défaut(s) : ${defauts.map((d) => d.id).join(', ')}`)
