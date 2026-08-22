/**
 * Banc d'essai commun : serveur statique + émulateur Supabase + routage
 * navigateur.
 *
 * Le routage remplace les hôtes tiers par des équivalents locaux :
 *   · `*.supabase.co`  → l'émulateur (tests/bench/faux-supabase.mjs) ;
 *   · `@supabase/supabase-js` → le VRAI paquet npm servi en local, pas une
 *     doublure : le client testé est celui qui tourne en production ;
 *   · Leaflet / Lucide / Tailwind / XLSX / Chart.js → doublures du dépôt
 *     (`.github/vendor/doublures/`) — ce sont des bibliothèques d'affichage,
 *     leur absence fausserait le rendu mais pas le comportement de données ;
 *   · polices et photos de stock → 204 / pixel, pour ne pas mesurer un CDN
 *     tiers à la place de l'application.
 *
 * Chaque substitution est comptabilisée et publiée dans les rapports : rien
 * n'est neutralisé en silence.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium, firefox, webkit } from 'playwright'
import { demarrerServeurStatique } from './serveur-statique.mjs'
import { demarrerFauxSupabase } from './faux-supabase.mjs'

export const RACINE = process.cwd()
export const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
export const SUPABASE_PROD = 'https://jmbdgpdthzpszfnddwzi.supabase.co'

export const VIEWPORTS = [
  { nom: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { nom: 'tablette-768x1024', width: 768, height: 1024, mobile: true },
  { nom: 'bureau-1440x900', width: 1440, height: 900, mobile: false },
]

/** 1×1 PNG transparent, pour remplacer les photos de stock tierces. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const DOUBLURES = [
  { motif: /lucide/i, fichier: '.github/vendor/doublures/lucide.js' },
  { motif: /tailwind/i, fichier: '.github/vendor/doublures/tailwind.js' },
  // Doublure Leaflet propre au banc : celle du dépôt n'a pas createPane, ce qui
  // interrompait tout le script de fbms/fbms_carte.html — voir l'en-tête de
  // tests/bench/doublure-leaflet.js.
  { motif: /leaflet|markercluster/i, fichier: 'tests/bench/doublure-leaflet.js' },
  { motif: /xlsx|sheetjs/i, fichier: '.github/vendor/doublures/xlsx.js' },
  { motif: /chart\.js|chart\.umd/i, fichier: '.github/vendor/doublures/vide.js' },
]
  .filter((d) => existsSync(d.fichier))
  .map((d) => ({ ...d, corps: readFileSync(d.fichier, 'utf8') }))

/** Comptes de test. Rôles réels du projet (shared/auth-gate.js + rls.sql). */
export const PERSONAS = [
  { cle: 'bm', email: 'test.load.bm@example.invalid', motDePasse: 'TEST_LOAD_bm_2026', role: 'Branch Manager', nom: 'TEST_LOAD_BM' },
  { cle: 'sup', email: 'test.load.sup@example.invalid', motDePasse: 'TEST_LOAD_sup_2026', role: 'Supervisor', nom: 'TEST_LOAD_SUPERVISEUR' },
  { cle: 'agent', email: 'test.load.agent@example.invalid', motDePasse: 'TEST_LOAD_agent_2026', role: 'Agent Recenseur', nom: 'TEST_LOAD_AGENT' },
  { cle: 'direction', email: 'test.load.dir@example.invalid', motDePasse: 'TEST_LOAD_dir_2026', role: 'Consultation uniquement', nom: 'TEST_LOAD_DIRECTION' },
  { cle: 'inactif', email: 'test.load.off@example.invalid', motDePasse: 'TEST_LOAD_off_2026', role: 'Agent Recenseur', nom: 'TEST_LOAD_INACTIF', actif: false },
]

export async function demarrerBanc({ latenceMs = 0, plafondConcurrence = 0, jeuDonnees = true } = {}) {
  const statique = await demarrerServeurStatique({
    racine: RACINE,
    vendor: RACINE + '/node_modules',
  })
  const api = await demarrerFauxSupabase({ latenceMs, plafondConcurrence })
  for (const p of PERSONAS) api.creerUtilisateur({ email: p.email, motDePasse: p.motDePasse, role: p.role, nom: p.nom, actif: p.actif !== false })
  if (jeuDonnees) semer(api)
  return { statique, api, fermer: async () => { await statique.fermer(); await api.fermer() } }
}

/** Jeu de données de test — jamais de donnée réelle (CLAUDE.md §5.4). */
export function semer(api, { villages = 40, rt = 12, producteurs = 60 } = {}) {
  const clusters = ['TEST_LOAD_CLUSTER_A', 'TEST_LOAD_CLUSTER_B', 'TEST_LOAD_CLUSTER_C']
  const tv = api.tables.get('villages') || (api.tables.set('villages', []), api.tables.get('villages'))
  for (let i = 1; i <= villages; i++) {
    const code = 'TEST_LOAD_V' + String(i).padStart(3, '0')
    tv.push({
      id: '00000000-0000-4000-8000-' + String(100000000000 + i),
      village: code, region: 'TEST_LOAD_REGION', departement: 'TEST_LOAD_DEPT',
      statut: 'Validé', score: 50 + (i % 40), deleted: false,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      created_by: 'test.load.bm@example.invalid', updated_by: 'test.load.bm@example.invalid',
      data: {
        id: '00000000-0000-4000-8000-' + String(100000000000 + i),
        statut: 'Validé',
        s1: {
          village: code, cluster: clusters[i % clusters.length], region: 'TEST_LOAD_REGION',
          departement: 'TEST_LOAD_DEPT', gpsLat: 7.0 + i / 500, gpsLng: -5.0 - i / 500,
          distanceHub: 10 + (i % 50), distanceHubRoutiere: i % 3 === 0 ? 12 + (i % 50) : null,
        },
        s3: { potentielMT: 100 + i, potentielSecuriseMT: 60 + i },
        s7: { candidats: [ { nom: 'TEST_LOAD_CANDIDAT_RT_' + i, telephone: '0700000001' }, { nom: '' }, { nom: '' } ] },
        s9: { potentiel20: 10 + (i % 11), route20: 10, dispoRT20: 10, risqueConcurrentiel20: 10, faisabilitePaiement20: 10, decision: '' },
        photos: {}, updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
  }
  const th = api.tables.get('hubs_clusters') || (api.tables.set('hubs_clusters', []), api.tables.get('hubs_clusters'))
  clusters.forEach((c, i) => th.push({
    id: 'hub-' + i, nom: c, hub_key: c.replace(/[^A-Z0-9]/g, ''), gps_lat: 7.1 + i / 100, gps_lng: -5.1 - i / 100,
    distance_usine_routiere: 80 + i * 10, distance_usine_gps: 75 + i * 10, deleted: false,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  }))
  const trt = api.tables.get('rt') || (api.tables.set('rt', []), api.tables.get('rt'))
  for (let i = 1; i <= rt; i++) {
    trt.push({
      id: 'rt-' + i, village_id: '00000000-0000-4000-8000-' + String(100000000000 + i), deleted: false,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      data: { id: 'rt-' + i, nom: 'TEST_LOAD_RT_' + String(i).padStart(2, '0'), village: 'TEST_LOAD_V' + String(i).padStart(3, '0'), soldeAvance: 500000 },
    })
  }
  const tp = api.tables.get('producteurs') || (api.tables.set('producteurs', []), api.tables.get('producteurs'))
  for (let i = 1; i <= producteurs; i++) {
    tp.push({
      id: 'prod-' + i, code: 'TEST_LOAD_P' + String(i).padStart(4, '0'), deleted: false,
      village_id: '00000000-0000-4000-8000-' + String(100000000000 + (((i - 1) % villages) + 1)),
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      data: { id: 'prod-' + i, code: 'TEST_LOAD_P' + String(i).padStart(4, '0'), nom: 'TEST_LOAD_PRODUCTEUR_' + i, village: 'TEST_LOAD_V' + String((((i - 1) % villages) + 1)).padStart(3, '0') },
    })
  }
  const tpc = api.tables.get('parametres_calcul') || (api.tables.set('parametres_calcul', []), api.tables.get('parametres_calcul'))
  Object.entries({ usine_lat: 6.741972, usine_lng: -5.34575, objectif_cout_kg: 8, part_carburant: 0.21, part_hors_carburant: 0.79, coefficient_majoration_carburant: 1.09, capacite_17t: 17000, capacite_25t: 25000, capacite_38t: 38000 })
    .forEach(([cle, valeur]) => tpc.push({ cle, valeur: String(valeur) }))
  const tcc = api.tables.get('parametres_collecte_courte') || (api.tables.set('parametres_collecte_courte', []), api.tables.get('parametres_collecte_courte'))
  ;[[0, 15, 6, 60000], [15, 35, 8, 90000], [35, 65, 10, 120000], [65, null, 12, 150000]].forEach(([a, b, t, f], i) =>
    tcc.push({ id_palier: 'pal-' + i, km_min: a, km_max: b, tarif_fcfa_kg: t, forfait_min_fcfa: f, actif: true, ordre: i, validation_bm_requise: b === null }))
  const tg = api.tables.get('grilles_tarifaires') || (api.tables.set('grilles_tarifaires', []), api.tables.get('grilles_tarifaires'))
  tg.push({ id_grille: 'g1', statut: 'Active', date_debut: '2026-01-01' })
  const tl = api.tables.get('lignes_tarifaires') || (api.tables.set('lignes_tarifaires', []), api.tables.get('lignes_tarifaires'))
  ;[50, 100, 150, 200, 300].forEach((d, i) => tl.push({ id_ligne: 'l' + i, id_grille: 'g1', statut: 'Actif', distance_km: d, base_17t: 200000 + d * 900, base_25t: 260000 + d * 1100, base_38t: 330000 + d * 1400 }))
}

/** Installe le routage réseau sur un contexte Playwright. */
export async function router(contexte, { statique, api, compteur = null, horsLigne = () => false } = {}) {
  const vendorSupabase = statique.base + '/__vendor/@supabase/supabase-js/dist/umd/supabase.js'
  await contexte.route('**/*', async (route) => {
    const requete = route.request()
    const url = requete.url()
    if (compteur) compteur.push({ url, methode: requete.method(), type: requete.resourceType(), t: Date.now() })

    if (url.startsWith(statique.base) || url.startsWith(api.base)) {
      // horsLigne() peut renvoyer 'total' : dans ce cas même le site statique
      // devient injoignable — c'est le seul moyen d'éprouver réellement le
      // service worker, car context.setOffline() n'affecte pas une requête
      // interceptée puis relayée par route.continue().
      const etat = horsLigne()
      if (etat === 'total') return route.abort('internetdisconnected')
      if (etat && !url.startsWith(statique.base)) return route.abort('internetdisconnected')
      return route.continue()
    }

    // Backend applicatif → émulateur local.
    if (url.startsWith(SUPABASE_PROD)) {
      if (horsLigne()) return route.abort('internetdisconnected')
      const cible = api.base + url.slice(SUPABASE_PROD.length)
      try {
        const reponse = await route.fetch({ url: cible })
        // On recopie corps et en-têtes AVANT de rendre la main : sous
        // limitation de débit (CDP), l'objet réponse peut être libéré entre le
        // fetch et le fulfill (« Fetch response has been disposed »).
        const corps = await reponse.body()
        const entetes = reponse.headers()
        return route.fulfill({ status: reponse.status(), headers: entetes, body: corps })
      } catch (e) {
        return route.abort('failed')
      }
    }

    // Le VRAI SDK Supabase, servi localement (paquet npm, pas une doublure).
    if (/@supabase\/supabase-js/.test(url)) {
      const reponse = await route.fetch({ url: vendorSupabase })
      const corps = await reponse.body()
      return route.fulfill({ status: 200, body: corps, headers: { 'content-type': 'text/javascript; charset=utf-8' } })
    }
    if (/\/591\.supabase\.js/.test(url)) {
      const reponse = await route.fetch({ url: statique.base + '/__vendor/@supabase/supabase-js/dist/umd/591.supabase.js' })
      const corps = await reponse.body()
      return route.fulfill({ status: 200, body: corps, headers: { 'content-type': 'text/javascript; charset=utf-8' } })
    }

    const doublure = DOUBLURES.find((d) => d.motif.test(url))
    if (doublure) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: doublure.corps })

    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url) || /ftcdn\.net|tile\.openstreetmap/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
    }
    return route.fulfill({ status: 204, body: '' })
  })
}

/** Ouvre un navigateur Chromium local. */
export async function ouvrirNavigateur(nom = 'chromium') {
  if (nom === 'firefox') return firefox.launch()
  if (nom === 'webkit') return webkit.launch()
  return chromium.launch({ executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined })
}

/** Connecte une page en injectant la session GoTrue attendue par supabase-js. */
export async function connecter(page, api, persona) {
  const reponse = await fetch(api.base + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: 'sb_publishable_test' },
    body: JSON.stringify({ email: persona.email, password: persona.motDePasse }),
  })
  const session = await reponse.json()
  if (!session.access_token) throw new Error('connexion émulateur refusée pour ' + persona.email)
  // supabase-js v2 stocke la session sous sb-<ref>-auth-token dans localStorage.
  await page.addInitScript(([cle, valeur]) => {
    try { window.localStorage.setItem(cle, valeur) } catch (e) {}
  }, ['sb-jmbdgpdthzpszfnddwzi-auth-token', JSON.stringify(session)])
  return session
}

export function centiles(valeurs) {
  if (!valeurs.length) return { n: 0, moy: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  const v = [...valeurs].sort((a, b) => a - b)
  const q = (p) => v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))]
  return {
    n: v.length,
    moy: +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(1),
    p50: +q(50).toFixed(1), p95: +q(95).toFixed(1), p99: +q(99).toFixed(1), max: +v[v.length - 1].toFixed(1),
  }
}
