/**
 * Contrôle d'accès, rôles et isolation entre utilisateurs.
 *
 * PÉRIMÈTRE ET LIMITE À LIRE AVANT D'INTERPRÉTER LES RÉSULTATS
 *
 * Les tests d'écriture et de lecture par rôle s'exécutent contre l'émulateur,
 * qui applique les politiques TELLES QUE DÉCLARÉES dans supabase/rls.sql et
 * supabase/achats.sql. Ils vérifient donc la COHÉRENCE du modèle d'accès
 * (portail JavaScript ↔ politiques SQL) et la présence de failles de
 * conception. Ils ne prouvent PAS que ces politiques sont effectivement
 * actives sur le projet Supabase de production : cela ne peut se vérifier
 * qu'en interrogeant la production, hors d'atteinte ici (01-MAPPING.md §0).
 * Chaque conclusion concernée est marquée « modèle vérifié / déploiement
 * NON CONFIRMÉ ».
 *
 * Les tests de navigation, eux, s'exécutent sur les octets réels des pages :
 * leurs conclusions valent pour la production.
 *
 *   node tests/e2e/04-securite-acces.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { demarrerBanc, router, ouvrirNavigateur, connecter, PERSONAS, SUPABASE_PROD } from '../bench/banc.mjs'

const resultats = []
function verdict(id, titre, attendu, obtenu, ok, gravite = 'HIGH', portee = 'production', preuve = {}) {
  resultats.push({ id, titre, attendu, obtenu, ok, gravite: ok ? '—' : gravite, portee, preuve })
  console.log(`${ok ? '  CONFORME  ' : '  DÉFAUT    '} ${id} ${titre}\n              ${obtenu}`)
}

const banc = await demarrerBanc()
const navigateur = await ouvrirNavigateur()

const jeton = {}
for (const p of PERSONAS) {
  const r = await (await fetch(banc.api.base + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'k' },
    body: JSON.stringify({ email: p.email, password: p.motDePasse }),
  })).json()
  jeton[p.cle] = r.access_token
}

const TABLES_SENSIBLES = ['villages', 'producteurs', 'rt', 'achats', 'avances', 'profils', 'audit_log']

/* ════════════════════════════════════════════════════════════════════════
   S-01 — Visiteur anonyme muni de la clé publiable
   ════════════════════════════════════════════════════════════════════════ */
{
  const fuites = []
  for (const t of TABLES_SENSIBLES) {
    const r = await fetch(banc.api.base + `/rest/v1/${t}?select=*&limit=5`, { headers: { apikey: 'sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d' } })
    const corps = await r.json().catch(() => null)
    if (Array.isArray(corps) && corps.length > 0) fuites.push(`${t} (${corps.length} lignes)`)
  }
  verdict('S-01', 'Clé publiable seule : aucune donnée lisible',
    'toutes les tables renvoient un ensemble vide',
    fuites.length ? 'tables lisibles sans session : ' + fuites.join(', ') : `${TABLES_SENSIBLES.length} tables interrogées, aucune ligne renvoyée`,
    fuites.length === 0, 'BLOCKER', 'modèle vérifié / déploiement NON CONFIRMÉ')
}

/* ════════════════════════════════════════════════════════════════════════
   S-02 — Compte désactivé
   ════════════════════════════════════════════════════════════════════════ */
{
  const r = await fetch(banc.api.base + '/rest/v1/villages?select=id&limit=5', { headers: { apikey: 'k', Authorization: 'Bearer ' + jeton.inactif } })
  const corps = await r.json()
  verdict('S-02', 'Compte désactivé : accès aux données',
    'aucune ligne renvoyée',
    `${Array.isArray(corps) ? corps.length : '?'} ligne(s) renvoyée(s)`,
    Array.isArray(corps) && corps.length === 0, 'BLOCKER', 'modèle vérifié / déploiement NON CONFIRMÉ')
}

/* ════════════════════════════════════════════════════════════════════════
   S-03 — Matrice d'écriture par rôle (terrain, config, suppression)
   ════════════════════════════════════════════════════════════════════════ */
{
  const essais = [
    { role: 'agent', table: 'villages', methode: 'POST', attendu: 'autorisé' },
    { role: 'agent', table: 'achats', methode: 'POST', attendu: 'autorisé' },
    { role: 'agent', table: 'achats', methode: 'DELETE', attendu: 'refusé' },
    { role: 'agent', table: 'parametres_collecte_courte', methode: 'POST', attendu: 'refusé' },
    { role: 'sup', table: 'parametres_collecte_courte', methode: 'POST', attendu: 'autorisé' },
    { role: 'sup', table: 'villages', methode: 'DELETE', attendu: 'refusé' },
    { role: 'direction', table: 'villages', methode: 'POST', attendu: 'refusé' },
    { role: 'direction', table: 'achats', methode: 'POST', attendu: 'refusé' },
    { role: 'bm', table: 'achats', methode: 'DELETE', attendu: 'autorisé' },
    { role: 'bm', table: 'profils', methode: 'POST', attendu: 'autorisé' },
    { role: 'sup', table: 'profils', methode: 'POST', attendu: 'refusé' },
  ]
  const ecarts = []
  const detail = []
  for (const e of essais) {
    const url = banc.api.base + `/rest/v1/${e.table}` + (e.methode === 'DELETE' ? '?local_id=eq.TEST_LOAD_INEXISTANT&id=eq.zzz' : '?on_conflict=id')
    const r = await fetch(url, {
      method: e.methode,
      headers: { apikey: 'k', Authorization: 'Bearer ' + jeton[e.role], 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: e.methode === 'DELETE' ? undefined : JSON.stringify({ id: 'TEST_LOAD_SEC_' + e.role, user_id: 'TEST_LOAD_SEC_' + e.role, cle: 'TEST_LOAD_SEC', id_palier: 'TEST_LOAD_SEC', local_id: 'TEST_LOAD_SEC_' + e.role, poids_net: 1, prix_kg: 1, montant: 1, date: '2026-08-22', data: {} }),
    })
    const obtenu = r.status === 401 || r.status === 403 ? 'refusé' : 'autorisé'
    detail.push({ ...e, statut: r.status, obtenu })
    if (obtenu !== e.attendu) ecarts.push(`${e.role} ${e.methode} ${e.table} → ${obtenu} (attendu ${e.attendu})`)
  }
  verdict('S-03', 'Matrice d\'écriture par rôle conforme aux politiques déclarées',
    '11 combinaisons conformes à supabase/rls.sql',
    ecarts.length ? 'écarts : ' + ecarts.join(' | ') : '11/11 combinaisons conformes',
    ecarts.length === 0, 'CRITICAL', 'modèle vérifié / déploiement NON CONFIRMÉ', { detail })
}

/* ════════════════════════════════════════════════════════════════════════
   S-04 — Cloisonnement des profils
   ════════════════════════════════════════════════════════════════════════ */
{
  const vuAgent = await (await fetch(banc.api.base + '/rest/v1/profils?select=*', { headers: { apikey: 'k', Authorization: 'Bearer ' + jeton.agent } })).json()
  const vuBM = await (await fetch(banc.api.base + '/rest/v1/profils?select=*', { headers: { apikey: 'k', Authorization: 'Bearer ' + jeton.bm } })).json()
  verdict('S-04', 'Un agent ne lit que son propre profil',
    '1 profil pour l\'agent, tous pour le Branch Manager',
    `agent voit ${vuAgent.length} profil(s), BM voit ${vuBM.length} profil(s)`,
    vuAgent.length === 1 && vuBM.length === PERSONAS.length, 'HIGH', 'modèle vérifié / déploiement NON CONFIRMÉ')
}

/* ════════════════════════════════════════════════════════════════════════
   S-05 — Portée des données métier : y a-t-il un cloisonnement par zone ?
   ════════════════════════════════════════════════════════════════════════ */
{
  const parRole = {}
  for (const cle of ['bm', 'sup', 'agent', 'direction']) {
    const villages = await (await fetch(banc.api.base + '/rest/v1/villages?select=id&deleted=eq.false', { headers: { apikey: 'k', Authorization: 'Bearer ' + jeton[cle] } })).json()
    const achats = await (await fetch(banc.api.base + '/rest/v1/achats?select=id,montant', { headers: { apikey: 'k', Authorization: 'Bearer ' + jeton[cle] } })).json()
    parRole[cle] = { villages: villages.length, achats: achats.length }
  }
  const tousPareils = new Set(Object.values(parRole).map((v) => v.villages)).size === 1
  verdict('S-05', 'Cloisonnement des données métier par zone ou par cluster',
    'un agent ne voit que le périmètre qui lui est affecté',
    `villages visibles — BM ${parRole.bm.villages}, Superviseur ${parRole.sup.villages}, Agent ${parRole.agent.villages}, Consultation ${parRole.direction.villages} : ${tousPareils ? 'AUCUN cloisonnement, tous les rôles voient tout' : 'périmètres distincts'}`,
    !tousPareils, 'MEDIUM', 'modèle vérifié / déploiement NON CONFIRMÉ',
    { parRole, source: 'supabase/rls.sql — la politique de lecture des tables terrain est `est_actif()`, sans filtre de périmètre' })
}

/* ════════════════════════════════════════════════════════════════════════
   S-06 — Rôle « Consultation uniquement » et données financières
   ════════════════════════════════════════════════════════════════════════ */
{
  const achats = await (await fetch(banc.api.base + '/rest/v1/achats?select=montant,producteur_nom,numero_recu', { headers: { apikey: 'k', Authorization: 'Bearer ' + jeton.direction } })).json()
  const avances = await (await fetch(banc.api.base + '/rest/v1/avances?select=*', { headers: { apikey: 'k', Authorization: 'Bearer ' + jeton.direction } })).json()
  verdict('S-06', 'Rôle « Consultation uniquement » face aux montants et aux tiers',
    'accès restreint aux seuls écrans autorisés par le portail (Hubs, Carte, Command Center)',
    `lecture directe de la table achats : ${Array.isArray(achats) ? achats.length : '?'} ligne(s) accessibles (montants, noms de producteurs, n° de reçus) ; table avances : ${Array.isArray(avances) ? avances.length : '?'} ligne(s)`,
    false, 'MEDIUM', 'modèle vérifié / déploiement NON CONFIRMÉ',
    {
      note: 'Le portail interdit à ce rôle les modules Achats et Caisse (ACCESS de shared/auth-gate.js), mais la RLS ne l\'empêche pas de lire les mêmes tables directement avec la clé publiable et sa session. L\'écran est fermé, la donnée ne l\'est pas.',
    })
}

/* ════════════════════════════════════════════════════════════════════════
   S-07 — Accès direct par URL à un module interdit
   ════════════════════════════════════════════════════════════════════════ */
{
  const MODULES = [
    { page: 'terrain/achats.html', module: 'achats', autorises: ['bm', 'sup', 'agent'] },
    { page: 'terrain/cash.html', module: 'cash', autorises: ['bm', 'sup'] },
    { page: 'terrain/command.html', module: 'command', autorises: ['bm', 'direction'] },
    { page: 'fbms/audit_distances.html', module: 'audit', autorises: ['bm', 'sup'] },
    { page: 'shared/admin.html', module: 'admin', autorises: ['bm'] },
    { page: 'logistique/alis_fbms.html', module: 'logistique', autorises: ['bm', 'sup'] },
  ]
  const ecarts = []
  const detail = []
  for (const m of MODULES) {
    for (const p of PERSONAS.filter((x) => x.cle !== 'inactif')) {
      const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
      await router(contexte, banc)
      const page = await contexte.newPage()
      await connecter(page, banc.api, p)
      await page.goto(banc.statique.base + '/' + m.page, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      const etat = await page.evaluate(() => {
        const g = document.getElementById('anagroci-authgate')
        if (!g) return 'ouvert'
        return /Accès non autorisé/.test(g.textContent || '') ? 'refusé' : 'bloqué'
      })
      const devrait = m.autorises.includes(p.cle) ? 'ouvert' : 'refusé'
      detail.push({ page: m.page, persona: p.cle, etat, attendu: devrait })
      if (etat !== devrait) ecarts.push(`${p.cle} → ${m.page} : ${etat} (attendu ${devrait})`)
      await contexte.close()
    }
  }
  verdict('S-07', 'Accès direct par URL à un module interdit',
    'le portail refuse explicitement chaque module hors périmètre',
    ecarts.length ? 'écarts : ' + ecarts.join(' | ') : `${detail.length}/${detail.length} combinaisons conformes à la table ACCESS de shared/auth-gate.js`,
    ecarts.length === 0, 'CRITICAL', 'production', { detail })
}

/* ════════════════════════════════════════════════════════════════════════
   S-08 — Profil en cache : peut-on ouvrir un module en falsifiant son rôle ?
   shared/auth-gate.js retombe sur localStorage lorsque la lecture du profil
   échoue (mode hors ligne). Ce test empoisonne ce cache.
   ════════════════════════════════════════════════════════════════════════ */
{
  const agent = PERSONAS.find((p) => p.cle === 'agent')
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  // La lecture du profil échoue : c'est le cas « hors ligne » prévu par le code.
  await contexte.route(SUPABASE_PROD + '/rest/v1/profils*', (route) => route.abort('internetdisconnected'))
  const page = await contexte.newPage()
  const session = await connecter(page, banc.api, agent)
  await page.addInitScript(([cle, valeur]) => { try { localStorage.setItem(cle, valeur) } catch (e) {} },
    ['anagroci_profile_' + session.user.id, JSON.stringify({ user_id: session.user.id, nom: 'TEST_LOAD_AGENT', email: agent.email, role: 'Branch Manager', actif: true })])
  await page.goto(banc.statique.base + '/shared/admin.html', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const etat = await page.evaluate(() => {
    const g = document.getElementById('anagroci-authgate')
    return { gate: g ? (/Accès non autorisé/.test(g.textContent || '') ? 'refusé' : 'connexion') : 'ouvert', roue: !!document.querySelector('#anagroci-userslot .ag-cog') }
  })
  // Ce que la BASE répond réellement à ce même utilisateur, rôle falsifié ou non.
  const creation = await fetch(banc.api.base + '/rest/v1/profils', {
    method: 'POST', headers: { apikey: 'k', Authorization: 'Bearer ' + jeton.agent, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 'TEST_LOAD_ESCALADE', nom: 'TEST_LOAD', role: 'Branch Manager', actif: true }),
  })
  verdict('S-08', 'Rôle falsifié dans le cache local (mode hors ligne)',
    'l\'écran d\'administration reste inaccessible',
    `écran d'administration : ${etat.gate === 'ouvert' ? 'OUVERT avec un rôle falsifié' : etat.gate} ; création de compte tentée en base : HTTP ${creation.status} (${creation.status === 403 || creation.status === 401 ? 'refusée par la RLS' : 'ACCEPTÉE'})`,
    etat.gate !== 'ouvert', 'HIGH', 'production (écran) / modèle (base)',
    { note: 'Le repli sur cache local est volontaire (travail hors ligne). Il rend l\'écran ouvrable, mais la barrière qui compte reste la RLS côté base.' })
  await contexte.close()
}

/* ════════════════════════════════════════════════════════════════════════
   S-09 — Aucune clé de service dans les fichiers publiés
   ════════════════════════════════════════════════════════════════════════ */
{
  const motifs = [/service_role/i, /\bsk_live\b/i, /\bsb_secret\b/i, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{40,}/]
  const trouve = []
  const parcourir = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'savoir-plus', 'supabase', 'docs', 'tests'].includes(e.name)) continue
      const chemin = dir + '/' + e.name
      if (e.isDirectory()) { parcourir(chemin); continue }
      if (!/\.(html|js|css|json|webmanifest)$/.test(e.name)) continue
      const texte = readFileSync(chemin, 'utf8')
      for (const m of motifs) if (m.test(texte)) trouve.push(chemin + ' :: ' + String(m))
    }
  }
  parcourir('.')
  verdict('S-09', 'Aucun secret serveur dans les fichiers publiés',
    'aucune occurrence de clé de service dans les fichiers servis',
    trouve.length ? trouve.join(' | ') : 'aucune occurrence sur les fichiers HTML/JS/CSS/JSON servis',
    trouve.length === 0, 'BLOCKER', 'production')
}

/* ════════════════════════════════════════════════════════════════════════
   S-10 — Deux sessions simultanées dans le même navigateur
   ════════════════════════════════════════════════════════════════════════ */
{
  const bm = PERSONAS.find((p) => p.cle === 'bm')
  const agent = PERSONAS.find((p) => p.cle === 'agent')
  const c1 = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  const c2 = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(c1, banc); await router(c2, banc)
  const p1 = await c1.newPage(); const p2 = await c2.newPage()
  await connecter(p1, banc.api, bm); await connecter(p2, banc.api, agent)
  await Promise.all([
    p1.goto(banc.statique.base + '/index.html', { waitUntil: 'domcontentloaded' }),
    p2.goto(banc.statique.base + '/index.html', { waitUntil: 'domcontentloaded' }),
  ])
  await p1.waitForTimeout(3000)
  const chip1 = (await p1.textContent('#anagroci-userslot .ag-name').catch(() => '')) || ''
  const chip2 = (await p2.textContent('#anagroci-userslot .ag-name').catch(() => '')) || ''
  const melange = /BM/.test(chip2) || /AGENT/.test(chip1)
  verdict('S-10', 'Deux sessions simultanées : aucun mélange d\'identité',
    'chaque contexte affiche son propre utilisateur',
    `session 1 : « ${chip1.trim()} » · session 2 : « ${chip2.trim()} »`,
    !melange && chip1 && chip2, 'BLOCKER', 'production')
  await c1.close(); await c2.close()
}

/* ════════════════════════════════════════════════════════════════════════
   S-11 — Jeton expiré ou falsifié
   ════════════════════════════════════════════════════════════════════════ */
{
  const faux = await fetch(banc.api.base + '/rest/v1/villages?select=id', { headers: { apikey: 'k', Authorization: 'Bearer jeton-fabrique-de-toutes-pieces' } })
  const corps = await faux.json().catch(() => null)
  verdict('S-11', 'Jeton fabriqué : aucune donnée',
    'ensemble vide ou refus',
    `HTTP ${faux.status}, ${Array.isArray(corps) ? corps.length : '?'} ligne(s)`,
    Array.isArray(corps) ? corps.length === 0 : faux.status >= 400, 'BLOCKER', 'modèle vérifié / déploiement NON CONFIRMÉ')
}

/* ════════════════════════════════════════════════════════════════════════
   S-12 — Pages servies dépourvues de portail d'authentification
   ════════════════════════════════════════════════════════════════════════ */
{
  const { execFileSync } = await import('node:child_process')
  const pages = execFileSync('git', ['ls-files', '-z', '*.html'], { encoding: 'utf8' })
    .split('\0').filter(Boolean)
    .filter((c) => !c.startsWith('savoir-plus/') && !c.includes('Sauvegarde Master'))
  const sansPortail = pages.filter((f) => !readFileSync(f, 'utf8').includes('auth-gate'))
  verdict('S-12', 'Toutes les pages servies passent par le portail d\'authentification',
    'chaque page HTML publiée charge shared/auth-gate.js',
    sansPortail.length ? `${sansPortail.length} page(s) sans portail : ${sansPortail.join(', ')}` : 'toutes les pages sont protégées',
    sansPortail.length === 0, 'CRITICAL', 'production',
    { sansPortail, note: 'SECURITE.md déclare le verrou posé sur « FBMS (fbms/app.html) ». Or la tuile REF du portail pointe vers fbms/index.html, qui ne charge pas auth-gate.js.' })
}

/* ════════════════════════════════════════════════════════════════════════
   S-13 — Que voit-on sur fbms/index.html sans aucune session ?
   ════════════════════════════════════════════════════════════════════════ */
{
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(contexte, banc)
  const page = await contexte.newPage()   // aucune session injectée
  await page.goto(banc.statique.base + '/fbms/index.html', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const vu = await page.evaluate(() => ({
    portail: !!document.getElementById('anagroci-authgate'),
    texte: (document.body.innerText || '').slice(0, 400),
    boutons: document.querySelectorAll('button').length,
    villagesAffiches: (document.body.innerText.match(/TEST_LOAD_V\d{3}/g) || []).length,
  }))
  const inactif = PERSONAS.find((p) => p.cle === 'inactif')
  const c2 = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
  await router(c2, banc)
  const p2 = await c2.newPage()
  await connecter(p2, banc.api, inactif)
  await p2.goto(banc.statique.base + '/fbms/index.html', { waitUntil: 'domcontentloaded' })
  await p2.waitForTimeout(6000)
  const vuInactif = await p2.evaluate(() => ({
    portail: !!document.getElementById('anagroci-authgate'),
    villagesAffiches: (document.body.innerText.match(/TEST_LOAD_V\d{3}/g) || []).length,
    boutons: document.querySelectorAll('button').length,
  }))
  verdict('S-13', 'FBMS Référentiel sans session et avec un compte désactivé',
    'interface masquée tant qu\'aucun compte actif n\'est authentifié',
    `sans session : portail affiché ${vu.portail ? 'oui' : 'NON'}, ${vu.boutons} boutons actifs, ${vu.villagesAffiches} référence(s) village visibles — ` +
    `compte désactivé : portail ${vuInactif.portail ? 'affiché' : 'ABSENT'}, ${vuInactif.boutons} boutons, ${vuInactif.villagesAffiches} village(s) visibles`,
    vu.portail === true, 'CRITICAL', 'production',
    { apercu: vu.texte })
  await contexte.close(); await c2.close()
}

/* ════════════════════════════════════════════════════════════════════════
   S-14 — Les deux couches de sécurité connaissent-elles les mêmes rôles ?
   Le portail tire ses rôles de shared/aflp-access.js ; la base tire les siens
   des fonctions de supabase/rls.sql. Si les listes divergent, un compte peut
   voir un écran que la base lui refusera — ou l'inverse.
   ════════════════════════════════════════════════════════════════════════ */
{
  const acces = readFileSync('shared/aflp-access.js', 'utf8')
  const rls = readFileSync('supabase/rls.sql', 'utf8')
  const libelles = [...acces.matchAll(/\{ code: "[A-Z_]+", label: "([^"]+)"/g)]
    .map((m) => m[1])
    .filter((l) => !/Djébonoua|Béoumi|Botro|Brobo|Diabo|Sakassou|Global|Transverse|Zone|Cluster|Village/i.test(l))
  const bloc = (nom) => {
    const i = rls.indexOf('function public.' + nom)
    return i < 0 ? '' : rls.slice(i, i + 600)
  }
  const terrain = bloc('peut_editer_terrain')
  const config = bloc('peut_editer_config')
  const bm = bloc('est_bm')
  const inconnusEcriture = libelles.filter((l) => !terrain.includes("'" + l + "'"))
  const bmInconnu = libelles.filter((l) => /Branch Manager/i.test(l) && !bm.includes("'" + l + "'"))
  verdict('S-14', 'Rôles du portail et rôles reconnus par la RLS',
    'tout rôle proposé par l\'écran d\'administration est reconnu par les politiques',
    inconnusEcriture.length
      ? `${inconnusEcriture.length} rôle(s) proposés par l'administration mais absents de peut_editer_terrain() : ${inconnusEcriture.join(', ')}` +
        (bmInconnu.length ? ` — dont, pour est_bm() : ${bmInconnu.join(', ')}` : '')
      : 'les deux couches connaissent les mêmes rôles',
    inconnusEcriture.length === 0, 'CRITICAL', 'modèle vérifié (lecture croisée du code et du SQL)',
    {
      rolesPortail: libelles,
      note: "supabase/20260818_farmer_registry_phase1_security.sql connaît bien « Zonal Head », « Unit Head », « Warehouse Keeper » ; supabase/rls.sql, non. Les deux moitiés du même modèle d'accès ne décrivent plus les mêmes rôles.",
      configConnaitTous: libelles.filter((l) => !config.includes("'" + l + "'")),
    })
}

await navigateur.close()
await banc.fermer()

mkdirSync('tests/reports/donnees', { recursive: true })
writeFileSync('tests/reports/donnees/04-securite.json', JSON.stringify({ genere: new Date().toISOString(), resultats }, null, 1))
const defauts = resultats.filter((r) => !r.ok)
console.log(`\n${resultats.length - defauts.length}/${resultats.length} conformes — ${defauts.length} point(s) : ${defauts.map((d) => d.id).join(', ')}`)
