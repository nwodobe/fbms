#!/usr/bin/env node
/* ============================================================================
   CONTRÔLE D'EXÉCUTION DU COMMAND CENTER BM
   ----------------------------------------------------------------------------
   Les portes du dépôt (`verifier-html`, `verifier-liens`, `verifier-pages`)
   ouvrent bien la page, mais SANS session : `anagroci:authenticated` n'est
   jamais émis, `loadAll()` ne s'exécute pas, et tout ce qui fait le cockpit —
   navigation locale, dévoilement progressif, tableaux, résumés — reste
   invisible à la mesure.

   Ce contrôle comble ce trou. Il sert le dépôt tel quel et ne remplace que
   DEUX ressources, exactement comme les doublures de `verifier-pages.mjs` :

     · le SDK Supabase du CDN → une doublure qui rend des données FICTIVES ;
     · shared/auth-gate.js    → une doublure qui franchit la porte au niveau bm.

   `terrain/command.html` et les modules AFLP sont servis SANS retouche : ce
   qui est mesuré est bien le fichier du dépôt.

   Aucune donnée réelle : ni nom de producteur, ni montant, ni coordonnée GPS.
   Les noms de clusters sont ceux, publics, du référentiel géographique.

   Usage :
     node .github/agent-tests/command-center/verifier-command-center.mjs
   Prérequis : `npm install --no-save playwright@1.49.1` et Chromium installé.
   ATTENTION : cette installation DÉSINSTALLE @electric-sql/pglite. Les deux
   bancs ne cohabitent pas dans le même `node_modules`.
   ========================================================================== */
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

/* axe-core est vendu dans le dépôt pour `verifier-pages.mjs` : on réutilise la
   même copie, sinon les deux contrôles ne mesureraient pas la même chose. */
const AXE = ['node_modules/axe-core/axe.min.js', '.github/vendor/axe.min.js']
  .map((c) => join(process.cwd(), c)).find((c) => existsSync(c))

const RACINE = process.cwd()
const PORT = Number(process.env.PORT_CC ?? 4322)
const SECTIONS = ['sec-synthese', 'sec-traiter', 'sec-terrain', 'sec-risques', 'sec-ia', 'sec-previsions']
const VIEWPORTS = [
  { nom: 'mobile-390x844', width: 390, height: 844 },
  { nom: 'tablette-768x1024', width: 768, height: 1024 },
  { nom: 'bureau-1440x900', width: 1440, height: 900 },
]
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
}

/* ── Jeu de données fictif ────────────────────────────────────────────────── */
const CLUSTERS = ['DJEBONOUA', 'BROBO', 'DIABO', 'SAKASSOU', 'BEOUMI', 'BOTRO']
const villages = []
const rts = []
for (let c = 0; c < CLUSTERS.length; c++) {
  const i = CLUSTERS[c][0]
  for (let v = 0; v < 10; v++) {
    villages.push({ id: 'v' + c + '-' + v, data: { s1: { village: 'VILLAGE TEST ' + i + (v + 1), cluster: CLUSTERS[c], gpsLat: v % 4 === 0 ? null : 7.5 } } })
  }
  for (let r = 0; r < 8; r++) {
    rts.push({ id: 'rt' + c + '-' + r, village_nom: 'VILLAGE TEST ' + i + (r + 1), data: { nom: 'EQUIPE TEST ' + i + (r + 1), cluster: CLUSTERS[c] } })
  }
}
const auj = new Date().toISOString().slice(0, 10)
const achats = Array.from({ length: 140 }, (_, i) => ({
  poids_net: 800 + (i % 7) * 120, poids_brut: 1000, tare: 20, montant: 400000 + (i % 5) * 25000,
  prix_kg: 500, commission_rt: 12000, date: i % 6 === 0 ? auj : '2026-08-10',
  cluster: CLUSTERS[i % CLUSTERS.length], rt_id: 'rt' + (i % CLUSTERS.length) + '-' + (i % 8),
  rt_nom: 'EQUIPE TEST X', village_nom: 'VILLAGE TEST X', producteur_id: 'p' + (i % 30),
  producteur_nom: 'PRODUCTEUR TEST', refinancable: i % 11 !== 0,
  qualite_statut: i % 9 === 0 ? 'HUMIDITE' : 'OK', statut_validation: i % 13 === 0 ? 'Validation BM requise' : 'OK',
  numero_recu: i % 11 === 0 ? null : 'R-' + i, humidite: 7.5, kor: 48, rejet: 2, nb_sacs: 12,
}))
const avances = Array.from({ length: 60 }, (_, i) => ({
  date: '2026-08-12', montant: 500000 + (i % 4) * 100000,
  rt_id: 'rt' + (i % CLUSTERS.length) + '-' + (i % 8), rt_nom: 'EQUIPE TEST X', cluster: CLUSTERS[i % CLUSTERS.length],
}))
const recons = Array.from({ length: 22 }, (_, i) => ({
  date: '2026-08-13', rt_id: 'rt' + (i % CLUSTERS.length) + '-' + (i % 8), rt_nom: 'EQUIPE TEST X',
  cluster: CLUSTERS[i % CLUSTERS.length], statut: i % 3 === 0 ? 'Réconcilié' : 'En écart',
  ecart: 12000, cash_restant: 45000, valeur_stock: 300000, created_at: '2026-08-13T10:0' + (i % 10) + ':00Z',
}))
const sacs = Array.from({ length: 90 }, (_, i) => ({
  date: '2026-08-12', type: i % 17 === 0 ? 'DECHIRE_RT' : 'DISTRIBUTION',
  source: i % 3 === 0 ? 'CLUSTER' : 'RT', destination: i % 3 === 0 ? 'RT' : 'PRODUCTEUR',
  cluster: CLUSTERS[i % CLUSTERS.length], rt_id: 'rt' + (i % CLUSTERS.length) + '-' + (i % 8),
  rt_nom: 'EQUIPE TEST X', producteur_id: 'p' + (i % 30), producteur_nom: 'PRODUCTEUR TEST',
  quantite: 20 + (i % 5) * 6,
}))
const DONNEES = { parametres_calcul: [{ cle: 'objectif_cout_kg', valeur: '9' }], villages, rt: rts, achats, avances, reconciliations: recons, sacs_mouvements: sacs }

const DOUBLURE_SUPABASE = `(function(g){var D=${JSON.stringify(DONNEES)};
function req(t){var p=Promise.resolve({data:D[t]||[],error:null}),c={};
["select","eq","order","limit","gte","lte","in","is","insert","upsert","update","single","maybeSingle"].forEach(function(m){c[m]=function(){return c;};});
c.then=function(a,b){return p.then(a,b);};c.catch=function(a){return p.catch(a);};return c;}
g.supabase={createClient:function(){return{from:req,rpc:function(){return Promise.resolve({data:null,error:null});},
auth:{getSession:function(){return Promise.resolve({data:{session:null}});},signOut:function(){return Promise.resolve({});},
onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}};}}};}};})(window);`

const DOUBLURE_AUTH = `(function(){window.ANAGROCI_AUTH={profile:{id:"test",nom:"BM TEST",niveau:"bm"}};
function ouvrir(){var s=document.getElementById("anagroci-userslot");
if(s)s.innerHTML='<span style="background:#fff;border-radius:999px;padding:0 14px;font-size:12px;font-weight:700;color:#053B23;display:inline-flex;align-items:center;min-height:44px">BM TEST</span>';
document.dispatchEvent(new CustomEvent("anagroci:authenticated",{detail:{niveau:"bm"}}));}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(ouvrir,60);});else setTimeout(ouvrir,60);})();`

/* Version d'AVANT la refonte, pour comparer la hauteur à données égales.
   La référence est ÉPINGLÉE au commit qui précède la refonte (b22d723, dernier
   à avoir touché cette page avant elle). Elle valait `HEAD` à l'écriture du
   banc, quand la refonte n'était pas encore commise — depuis, `HEAD` EST la
   refonte : le contrôle se comparait à lui-même et basculait au pixel près
   (2592 contre 2591). Un garde-fou qui se mesure à soi ne garde rien.
   `CC_REF_AVANT` permet de viser une autre référence. */
const REF_AVANT = process.env.CC_REF_AVANT || 'b22d723'
let AVANT = null
try { AVANT = execFileSync('git', ['show', REF_AVANT + ':terrain/command.html'], { encoding: 'utf8', cwd: RACINE }) } catch (e) { AVANT = null }

const doublurer = (html) => html
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^"']+/g, '/__doublure/supabase.js')
  .replace(/\.\.\/shared\/auth-gate\.js/g, '/__doublure/auth-gate.js')

const serveur = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  if (url === '/favicon.ico') { res.writeHead(204); return res.end() }
  if (url === '/__doublure/supabase.js') { res.writeHead(200, { 'content-type': TYPES['.js'] }); return res.end(DOUBLURE_SUPABASE) }
  if (url === '/__doublure/auth-gate.js') { res.writeHead(200, { 'content-type': TYPES['.js'] }); return res.end(DOUBLURE_AUTH) }
  if (url === '/__avant/command.html') {
    if (!AVANT) { res.writeHead(404); return res.end('référence ' + REF_AVANT + ' indisponible') }
    res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(doublurer(AVANT))
  }
  const chemin = normalize(join(RACINE, url === '/' ? '/index.html' : url))
  if (!chemin.startsWith(normalize(RACINE)) || !existsSync(chemin) || statSync(chemin).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404 ' + url)
  }
  const ext = extname(chemin).toLowerCase()
  if (ext === '.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(doublurer(readFileSync(chemin, 'utf8'))) }
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' })
  res.end(readFileSync(chemin))
})
await new Promise((r) => serveur.listen(PORT, r))
const BASE = 'http://localhost:' + PORT

const navigateur = await chromium.launch()
let echecs = 0
const dire = (ok, texte) => { if (!ok) echecs++; console.log((ok ? '  ok    ' : '  ÉCHEC ') + texte) }

/* ── Hauteur de page à données égales, avant et après la refonte ─────────── */
if (AVANT) {
  console.log('\n=== hauteur de page à données égales (bureau 1440×900) ===')
  const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 } })
  const mesurer = async (chemin) => {
    const pg = await ctx.newPage()
    await pg.goto(BASE + chemin, { waitUntil: 'networkidle' })
    await pg.waitForFunction(() => document.getElementById('kVol').textContent.indexOf('MT') > 0, null, { timeout: 15000 })
    await pg.waitForTimeout(1200)
    const h = await pg.evaluate(() => document.documentElement.scrollHeight)
    await pg.close()
    return h
  }
  const avant = await mesurer('/__avant/command.html')
  const apres = await mesurer('/terrain/command.html')
  console.log('  avant (' + REF_AVANT + ') : ' + avant + ' px')
  console.log('  après        : ' + apres + ' px')
  dire(apres < avant, 'la page est plus courte à contenu égal (' + Math.round((1 - apres / avant) * 100) + ' % de moins)')
  await ctx.close()
}

/* ── Captures d'écran, à la demande ───────────────────────────────────────
   `CC_CAPTURES=<dossier>` écrit des images de la page CONNECTÉE, seul état où
   le cockpit existe vraiment. Elles ne mesurent rien : elles servent à montrer
   le résultat à quelqu'un qui n'a pas le dépôt sous la main. Hors de ce
   dossier, le banc se comporte exactement comme avant. */
if (process.env.CC_CAPTURES) {
  const dossier = process.env.CC_CAPTURES
  mkdirSync(dossier, { recursive: true })
  console.log('\n=== captures → ' + dossier + ' ===')
  const prete = async (pg) => {
    await pg.waitForFunction(() => document.getElementById('kVol').textContent.indexOf('MT') > 0, null, { timeout: 20000 })
    await pg.waitForTimeout(1400)
  }
  const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const pg = await ctx.newPage()

  await pg.goto(BASE + '/terrain/command.html', { waitUntil: 'networkidle' })
  await prete(pg)
  await pg.screenshot({ path: join(dossier, '1-cockpit-defaut.png'), fullPage: true })

  await pg.evaluate(() => document.querySelector('[data-ia="synthese"]').click())
  await pg.waitForTimeout(900)
  await pg.evaluate(() => document.getElementById('sec-ia').scrollIntoView())
  await pg.waitForTimeout(500)
  await pg.screenshot({ path: join(dossier, '2-assistant-ia.png') })
  const bloc = await pg.$('.aflp-zc')
  if (bloc) await bloc.screenshot({ path: join(dossier, '3-zones-clusters.png') })

  if (AVANT) {
    const pg2 = await ctx.newPage()
    await pg2.goto(BASE + '/__avant/command.html', { waitUntil: 'networkidle' })
    await prete(pg2)
    await pg2.screenshot({ path: join(dossier, '0-avant.png'), fullPage: true })
  }
  await ctx.close()

  const ctxm = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const pgm = await ctxm.newPage()
  await pgm.goto(BASE + '/terrain/command.html', { waitUntil: 'networkidle' })
  await prete(pgm)
  await pgm.screenshot({ path: join(dossier, '4-mobile.png'), fullPage: true })
  await ctxm.close()
  console.log('  images écrites')
}

for (const vp of VIEWPORTS) {
  console.log('\n=== ' + vp.nom + ' ===')
  const ctx = await navigateur.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  const erreurs = []
  /* On identifie une ressource par son URL, jamais par le texte de la console :
     « Failed to load resource » ne dit pas QUOI a échoué. */
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console: ' + m.text()) })
  page.on('pageerror', (e) => erreurs.push('js: ' + e.message))
  /* Seules les ressources SERVIES PAR LE BANC comptent comme échec : c'est ce
     que le libellé du contrôle promet, et c'est tout ce que ce lot maîtrise.
     Une police Google qui ne répond pas fait échouer la mesure sans rien dire
     de la page. Les échecs externes sont signalés, jamais fatals — les liens
     sortants relèvent de `verifier-liens.mjs`. */
  const externes = []
  page.on('requestfailed', (r) => {
    (r.url().startsWith(BASE) ? erreurs : externes).push('requête KO: ' + r.url())
  })
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) erreurs.push('HTTP ' + r.status() + ' ' + r.url()) })

  await page.goto(BASE + '/terrain/command.html', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.getElementById('kVol').textContent.indexOf('MT') > 0, null, { timeout: 15000 })
  await page.waitForTimeout(500)

  dire(erreurs.length === 0, 'aucune erreur JS ni ressource interne manquante — ' + (erreurs[0] || 'RAS'))
  if (externes.length) console.log('  note  ' + externes.length + ' ressource(s) externe(s) sans réponse (hors périmètre) : ' + externes[0])

  const deb = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  dire(deb <= 0, 'pas de débordement horizontal de la page (écart ' + deb + 'px)')

  /* En ligne, au chargement : aucun bandeau réseau ne doit occuper de place.
     Il en occupait — vide, bordé, coloré — parce que `hidden` ne suffit pas
     face à `display:flex`. Le contrôle porte sur la surface, pas sur l'attribut. */
  const netVide = await page.evaluate(() => document.getElementById('netBar').getBoundingClientRect().height)
  dire(netVide === 0, 'aucun bandeau réseau peint au chargement en ligne (hauteur ' + netVide + 'px)')

  const petits = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('#ccNav .pill,.btn,.chipa,.ftg,.more,.tools input,.tools select,.state .act,.todo').forEach((e) => {
      const b = e.getBoundingClientRect()
      if (b.width > 0 && b.height > 0 && b.height < 44) out.push((e.className || e.tagName) + ' h=' + Math.round(b.height))
    })
    return out
  })
  dire(petits.length === 0, 'cibles tactiles ≥ 44 px — ' + (petits.join(', ') || 'RAS'))

  await page.evaluate(() => window.scrollTo(0, 1200))
  await page.waitForTimeout(250)
  const nav = await page.evaluate(() => {
    const n = document.getElementById('ccNav').getBoundingClientRect()
    const b = document.getElementById('anagroci-suite-bar')
    return { top: Math.round(n.top), barre: b ? Math.round(b.getBoundingClientRect().height) : -1, y: Math.round(window.pageYOffset) }
  })
  dire(nav.y > 0, 'la page défile réellement (y=' + nav.y + ')')
  dire(Math.abs(nav.top - nav.barre) <= 2, 'navigation locale collante sous la barre suite (top=' + nav.top + ')')

  for (const s of SECTIONS) {
    await page.click('#ccNav .pill[data-sec="' + s + '"]')
    await page.waitForTimeout(700)
    const m = await page.evaluate((id) => {
      const el = document.getElementById(id)
      const t = el.querySelector('.sec-h').getBoundingClientRect()
      const off = document.getElementById('anagroci-suite-bar').offsetHeight + document.getElementById('ccNav').offsetHeight
      const p = document.querySelector('#ccNav .pill[aria-current="true"]')
      return { titre: Math.round(t.top), off: Math.round(off), actif: p ? p.getAttribute('data-sec') : null, hash: location.hash }
    }, s)
    dire(m.titre >= m.off - 2 && m.titre <= m.off + 40 && m.actif === s && m.hash === '#' + s,
      s + ' : ancre + titre sous le collant (' + m.titre + '/' + m.off + ') + pastille (' + m.actif + ')')
  }

  const ouvert = await page.evaluate(() => ({
    pred: document.getElementById('panPred').getAttribute('data-open'),
    onglets: document.querySelectorAll('#aflpPred .aflpp-tab').length,
    hauteur: document.getElementById('aflpPred').offsetHeight,
  }))
  dire(ouvert.pred === '1' && ouvert.onglets === 8 && ouvert.hauteur > 150,
    'Prévisions dépliées par la navigation, 8 onglets conservés (' + ouvert.hauteur + 'px)')

  const espion = await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto'
    const el = document.getElementById('sec-terrain')
    window.scrollTo(0, el.getBoundingClientRect().top + window.pageYOffset - 60)
    await new Promise((r) => setTimeout(r, 1200))
    const a = document.querySelector('#ccNav .pill[aria-current="true"]').getAttribute('data-sec')
    document.documentElement.style.scrollBehavior = ''
    return a
  })
  dire(espion === 'sec-terrain', 'la pastille suit un défilement libre → ' + espion)

  const ia = await page.evaluate(async () => {
    document.querySelector('[data-ia="alertes"]').click()
    await new Promise((r) => setTimeout(r, 400))
    return {
      ouvert: document.getElementById('panIa').getAttribute('data-open'),
      onglet: (document.querySelector('#aflpIa .aflp-tab[aria-selected="true"]') || {}).id,
      onglets: document.querySelectorAll('#aflpIa .aflp-tab').length,
      resume: document.getElementById('iaResume').textContent.trim(),
      pred: document.getElementById('predResume').textContent.trim(),
    }
  })
  dire(ia.ouvert === '1' && ia.onglet === 'aflp-tab-alertes' && ia.onglets === 4,
    'raccourci « Alertes » : panneau ouvert sur le bon onglet, 4 onglets conservés')
  dire(/attention|Aucune anomalie/.test(ia.resume), 'résumé IA lu du moteur — « ' + ia.resume + ' »')
  dire(/Porte Niveau 1/.test(ia.pred), 'résumé Prévisions lu du moteur — « ' + ia.pred + ' »')

  /* « Zones et clusters » — la table de comparaison de l'assistant, sur
     l'onglet Synthèse. Les événements sont émis AVEC bulle : le module écoute
     par délégation sur son conteneur, et un événement qui ne remonte pas ne
     serait jamais vu. C'est aussi ce que fait une vraie frappe au clavier. */
  const zc = await page.evaluate(async () => {
    const p = (ms) => new Promise((r) => setTimeout(r, ms))
    const ev = (n) => new Event(n, { bubbles: true })
    const lignes = () => [...document.querySelectorAll('#aflp-zc-corps tr')]
    document.getElementById('aflp-tab-synthese').click(); await p(350)
    const r = {}
    r.total = lignes().length
    r.zones = document.querySelectorAll('#aflp-zc-corps .aflp-zn').length
    const q = document.getElementById('aflp-zc-q')
    q.focus()
    q.value = 'DIA'; q.dispatchEvent(ev('input')); await p(150)
    r.filtre = lignes().length
    r.focusGarde = document.activeElement === q
    r.compteur = document.getElementById('aflp-zc-cpt').textContent.trim()
    q.value = 'gbeke'; q.dispatchEvent(ev('input')); await p(150)
    r.parZone = lignes().length
    q.value = 'ZZZZ'; q.dispatchEvent(ev('input')); await p(150)
    r.vide = /Aucun cluster ne correspond/.test(document.getElementById('aflp-zc-corps').textContent)
    q.value = ''; q.dispatchEvent(ev('input')); await p(150)
    const t = document.getElementById('aflp-zc-tri')
    t.value = 'nom'; t.dispatchEvent(ev('change')); await p(150)
    r.triNom = lignes().map((x) => x.cells[0].textContent.trim())
    const tg = document.querySelector('.aflp-zc-tg')
    tg.click(); await p(150)
    r.replie = document.getElementById('aflp-zc-zone').hidden === true
    r.aria = tg.getAttribute('aria-expanded')
    tg.click(); await p(150)
    r.rouvert = document.getElementById('aflp-zc-zone').hidden === false
    return r
  })
  dire(zc.total > 0 && zc.zones === zc.total,
    'Zones et clusters : ' + zc.total + ' ligne(s), chacune avec son badge de zone')
  dire(zc.filtre > 0 && zc.filtre < zc.total && zc.vide,
    'recherche : ' + zc.filtre + ' sur ' + zc.total + ' pour « DIA », puis état « aucun résultat »')
  dire(zc.parZone > zc.filtre, 'la recherche porte aussi sur la zone (« gbeke » → ' + zc.parZone + ')')
  dire(zc.focusGarde, 'le champ garde le focus pendant la frappe (corps du tableau seul réécrit)')
  dire(/sur/.test(zc.compteur), 'compteur de résultats — « ' + zc.compteur + ' »')
  dire(JSON.stringify(zc.triNom) === JSON.stringify([...zc.triNom].sort((a, b) => a.localeCompare(b, 'fr'))),
    'tri par nom : ' + zc.triNom.join(' < '))
  dire(zc.replie && zc.aria === 'false' && zc.rouvert, 'le bloc se replie et se rouvre, aria-expanded suivi')

  const pd = await page.evaluate(async () => {
    const p = (ms) => new Promise((r) => setTimeout(r, ms))
    const r = {}
    r.rtAvant = document.querySelectorAll('#rtTable tr').length
    document.getElementById('rtMore').click(); await p(150)
    r.rtApres = document.querySelectorAll('#rtTable tr').length
    document.getElementById('rtMore').click(); await p(150)
    r.rtReplie = document.querySelectorAll('#rtTable tr').length
    const cf = document.getElementById('clusFilter')
    cf.value = 'DIA'; cf.dispatchEvent(new Event('input')); await p(150)
    r.filtre = document.querySelectorAll('#clusTable tr').length
    cf.value = 'ZZZZ'; cf.dispatchEvent(new Event('input')); await p(150)
    r.filtreVide = /Aucun cluster ne correspond/.test(document.getElementById('clusTable').textContent)
    cf.value = ''; cf.dispatchEvent(new Event('input')); await p(120)
    const cs = document.getElementById('clusSort'); cs.value = 'nom'; cs.dispatchEvent(new Event('change')); await p(120)
    r.triNom = [...document.querySelectorAll('#clusTable tr')].map((t) => t.cells[0].textContent.trim().replace('Attention', ''))
    cs.value = 'vol'; cs.dispatchEvent(new Event('change')); await p(120)
    r.todoAvant = document.querySelectorAll('#todo .todo').length
    const tm = document.getElementById('todoMore'); if (tm) { tm.click(); await p(150) }
    r.todoApres = document.querySelectorAll('#todo .todo').length
    r.ref = document.querySelectorAll('#refTable > div').length
    r.attention = document.querySelectorAll('#clusTable .att').length
    return r
  })
  dire(pd.rtAvant === 3 && pd.rtApres > 3 && pd.rtReplie === 3, 'RT à risque : aperçu 3 → tout (' + pd.rtApres + ') → aperçu 3')
  dire(pd.filtre === 1 && pd.filtreVide, 'recherche cluster : 1 résultat, puis état « aucun résultat »')
  dire(JSON.stringify(pd.triNom) === JSON.stringify([...pd.triNom].sort((a, b) => a.localeCompare(b, 'fr'))), 'tri par nom : ' + pd.triNom.join(' < '))
  dire(pd.todoApres >= pd.todoAvant, 'anomalies : aperçu ' + pd.todoAvant + ' → liste complète ' + pd.todoApres)
  dire(pd.ref === 8, 'référentiel compacté : les 8 indicateurs sont conservés')
  dire(pd.attention > 0, 'clusters en écart signalés discrètement (' + pd.attention + ')')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  dire((await page.evaluate(() => document.getElementById('panIa').getAttribute('data-open'))) === '1',
    'le repli choisi est retrouvé à la visite suivante')

  /* États : hors ligne, échec de chargement, squelette. */
  await ctx.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await page.waitForTimeout(200)
  /* `peint` et non `!hidden` : `.netbar{display:flex}` est une règle d'auteur,
     elle bat le `display:none` que le navigateur donne à `[hidden]`. Mesurer
     la propriété laissait passer un bandeau vide peint en permanence sur la
     page en ligne. Ce qu'il faut mesurer, c'est la surface réellement occupée. */
  const mesureNet = () => {
    const b = document.getElementById('netBar')
    return {
      peint: b.getBoundingClientRect().height > 0,
      texte: b.textContent.slice(0, 40),
      classe: b.className,
    }
  }
  const horsLigne = await page.evaluate(mesureNet)
  dire(horsLigne.peint && /off/.test(horsLigne.classe), 'bandeau hors ligne visible — « ' + horsLigne.texte + '… »')

  const echec = await page.evaluate(() => {
    loadFailState()
    return {
      todo: document.querySelector('#todo .state') ? document.querySelector('#todo .state').className : null,
      kpi: document.getElementById('kVol').textContent,
      ref: document.querySelector('#refTable .state') ? 'état' : 'absent',
      rejouer: !!document.querySelector('#todo .act'),
    }
  })
  dire(/state (off|err)/.test(echec.todo || '') && echec.kpi === '—' && echec.ref === 'état' && echec.rejouer,
    'état d’échec : KPI neutralisés, message et bouton « Réessayer » (' + echec.todo + ')')

  await ctx.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(150)
  const retour = await page.evaluate(mesureNet)
  dire(!retour.peint, 'le bandeau ne laisse aucune trace peinte au retour du réseau')

  const skel = await page.evaluate(() => { setSkeletons(); return document.querySelectorAll('.skel').length })
  dire(skel > 10, 'squelettes de chargement rétablis (' + skel + ' éléments)')

  /* Accessibilité, page chargée ET tout déplié — l'état le plus exigeant.
     Chaque écart est imputé par CONTENANCE DANS LE DOM, pas par ressemblance
     de sélecteur : `#anagroci-suite-bar` (navigation globale) et `#aflpIa` /
     `#aflpPred` (feuilles des modules partagés) sont hors périmètre de ce lot
     et comptés à part. Tout écart imputable au cockpit fait échouer. */
  if (AXE) {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.getElementById('kVol').textContent.indexOf('MT') > 0, null, { timeout: 15000 })
    await page.evaluate(() => { document.querySelectorAll('.fold').forEach((f) => { if (f.getAttribute('data-open') !== '1') f.querySelector('.ftg').click() }) })
    await page.waitForTimeout(1000)
    await page.addScriptTag({ path: AXE })
    const viol = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      return r.violations.flatMap((v) => v.nodes.map((n) => {
        const sel = n.target.join(' ')
        let ou = 'page'
        try {
          const e = document.querySelector(sel)
          if (e && e.closest('#anagroci-suite-bar,#anagroci-lang-toggle')) ou = 'barre'
          else if (e && e.closest('#aflpIa,#aflpPred')) ou = 'modules'
        } catch (err) { /* sélecteur non rejouable : imputé à la page, au pire */ }
        return { ou, txt: v.id + ' @ ' + sel }
      }))
    })
    const miennes = viol.filter((v) => v.ou === 'page')
    dire(miennes.length === 0, 'axe-core : 0 écart imputable au cockpit (' + viol.length + ' au total : ' +
      viol.filter((v) => v.ou === 'barre').length + ' barre suite, ' + viol.filter((v) => v.ou === 'modules').length +
      ' modules AFLP) — ' + (miennes[0] ? miennes[0].txt : 'RAS'))
  } else {
    console.log('  —     axe-core absent : contrôle d’accessibilité non exécuté')
  }

  await ctx.close()
}

await navigateur.close()
await new Promise((r) => serveur.close(r))
console.log('\n' + (echecs ? echecs + ' contrôle(s) en échec' : 'Tous les contrôles sont passés'))
process.exit(echecs ? 1 : 0)
