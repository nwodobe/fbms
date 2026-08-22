/**
 * Socle commun des scripts k6 — ANAGROCI FBMS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OÙ POINTE CE SCRIPT
 *
 * Par défaut il vise l'ÉMULATEUR LOCAL (tests/bench/faux-supabase.mjs), parce
 * que l'environnement d'exécution de cette campagne n'a pas d'accès sortant
 * vers `*.supabase.co` ni vers `nwodobe.github.io` (CONNECT refusé, 403 —
 * voir 01-MAPPING.md §0). Les temps obtenus ainsi mesurent le COMPORTEMENT
 * du client et la FORME de la charge, PAS la capacité du serveur de
 * production.
 *
 * Pour mesurer la production, il suffit de fournir les variables :
 *
 *   k6 run -e SUPABASE_URL=https://<projet>.supabase.co \
 *          -e SUPABASE_KEY=<clé publiable> \
 *          -e COMPTE_PREFIXE=test.load \
 *          -e MOT_DE_PASSE=<mot de passe des comptes de test> \
 *          tests/load/01-paliers.js
 *
 * AVANT DE FAIRE CELA : lire tests/load/LISEZ-MOI.md. Les scénarios qui
 * écrivent créent des lignes réelles (préfixées TEST_LOAD_) dans la base de
 * production. Le mode lecture seule (-e ECRITURE=0) est le défaut prudent.
 * ─────────────────────────────────────────────────────────────────────────
 */
import http from 'k6/http'
import { check } from 'k6'
import { Trend, Counter, Rate } from 'k6/metrics'

export const URL_BASE = __ENV.SUPABASE_URL || 'http://127.0.0.1:54329'
export const CLE = __ENV.SUPABASE_KEY || 'sb_publishable_test'
export const ECRITURE = (__ENV.ECRITURE ?? '1') !== '0'
export const PREFIXE = __ENV.COMPTE_PREFIXE || 'test.load'
export const MOT_DE_PASSE = __ENV.MOT_DE_PASSE || null

/* Métriques par famille d'action : un p95 global mélangerait une lecture de
   référentiel et une écriture transactionnelle, ce qui ne veut rien dire. */
export const tConsultation = new Trend('duree_consultation', true)
export const tRecherche = new Trend('duree_recherche', true)
export const tCreation = new Trend('duree_creation', true)
export const tModification = new Trend('duree_modification', true)
export const tExport = new Trend('duree_export', true)
export const tLourd = new Trend('duree_operation_lourde', true)
export const tAuth = new Trend('duree_authentification', true)

export const erreursMetier = new Counter('erreurs_metier')
export const ecrituresRefusees = new Counter('ecritures_refusees')
export const doublons = new Counter('doublons_detectes')
export const tauxEchec = new Rate('taux_echec_fonctionnel')

/** Comptes de test, un par persona réel du projet. */
export const PERSONAS = [
  { cle: 'bm', email: PREFIXE + '.bm@example.invalid', motDePasse: 'TEST_LOAD_bm_2026', role: 'Branch Manager', poids: 10 },
  { cle: 'sup', email: PREFIXE + '.sup@example.invalid', motDePasse: 'TEST_LOAD_sup_2026', role: 'Supervisor', poids: 25 },
  { cle: 'agent', email: PREFIXE + '.agent@example.invalid', motDePasse: 'TEST_LOAD_agent_2026', role: 'Agent Recenseur', poids: 55 },
  { cle: 'direction', email: PREFIXE + '.dir@example.invalid', motDePasse: 'TEST_LOAD_dir_2026', role: 'Consultation uniquement', poids: 10 },
]

/** Tire un persona selon la répartition réelle attendue sur le terrain. */
export function personaPour(vu) {
  const total = PERSONAS.reduce((s, p) => s + p.poids, 0)
  let seuil = (vu * 37) % total
  for (const p of PERSONAS) { if (seuil < p.poids) return p; seuil -= p.poids }
  return PERSONAS[PERSONAS.length - 1]
}

export function connexion(persona) {
  const debut = Date.now()
  const r = http.post(
    `${URL_BASE}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: persona.email, password: MOT_DE_PASSE || persona.motDePasse }),
    { headers: { 'Content-Type': 'application/json', apikey: CLE }, tags: { action: 'authentification' } },
  )
  tAuth.add(Date.now() - debut)
  const ok = check(r, { 'connexion acceptée': (x) => x.status === 200 })
  tauxEchec.add(!ok)
  if (!ok) { erreursMetier.add(1); return null }
  return r.json('access_token')
}

export function entetes(jeton) {
  return {
    apikey: CLE,
    Authorization: 'Bearer ' + jeton,
    'Content-Type': 'application/json',
    'X-VU': String(__VU),
  }
}

export function lire(jeton, chemin, trend, action) {
  const debut = Date.now()
  const r = http.get(`${URL_BASE}/rest/v1/${chemin}`, { headers: entetes(jeton), tags: { action } })
  trend.add(Date.now() - debut)
  const ok = check(r, { [`${action} : 2xx`]: (x) => x.status >= 200 && x.status < 300 })
  tauxEchec.add(!ok)
  if (!ok) erreursMetier.add(1)
  return r
}

/** Identifiant local d'achat : même schéma que terrain/achats.html (uid()). */
export function idLocal(vu, iteration) {
  return `TEST_LOAD-${vu}-${iteration}-${Math.floor(Math.random() * 1e9)}`
}

export function achatDeTest(vu, iteration) {
  const net = 50 + ((vu * 7 + iteration) % 400)
  const prix = 400
  return {
    local_id: idLocal(vu, iteration),
    date: '2026-08-22',
    cluster: 'TEST_LOAD_CLUSTER_A',
    village_nom: 'TEST_LOAD_V' + String(((vu + iteration) % 40) + 1).padStart(3, '0'),
    rt_nom: 'TEST_LOAD_RT_' + String(((vu % 12) + 1)).padStart(2, '0'),
    producteur_nom: 'TEST_LOAD_PRODUCTEUR_' + ((vu * 3 + iteration) % 60 + 1),
    producteur_ref: false,
    poids_brut: net, tare: 0, poids_net: net,
    prix_kg: prix, montant: net * prix,
    mode_paiement: 'Wave',
    numero_recu: `TEST_LOAD_R-${vu}-${iteration}`,
    nb_sacs: 2, humidite: 8, kor: 47, rejet: false,
    commission_rt: net * 10, bonus_diff: net * 5,
    refinancable: true,
    qualite_statut: 'OK', statut_validation: 'À valider',
    stock_statut: 'Entrée RT', cash_statut: 'Non réconcilié',
    created_by_nom: 'TEST_LOAD',
  }
}

/** Écriture d'achat, avec la même sémantique d'upsert que l'application. */
export function creerAchat(jeton, vu, iteration) {
  if (!ECRITURE) return null
  const debut = Date.now()
  const r = http.post(
    `${URL_BASE}/rest/v1/achats?on_conflict=local_id`,
    JSON.stringify(achatDeTest(vu, iteration)),
    { headers: { ...entetes(jeton), Prefer: 'resolution=ignore-duplicates,return=minimal' }, tags: { action: 'creation_achat' } },
  )
  tCreation.add(Date.now() - debut)
  const ok = r.status >= 200 && r.status < 300
  check(r, { 'création achat : 2xx': () => ok })
  tauxEchec.add(!ok)
  if (!ok) {
    erreursMetier.add(1)
    if (r.status === 409) doublons.add(1)
    if (r.status === 401 || r.status === 403) ecrituresRefusees.add(1)
  }
  return r
}

/** Seuils de départ imposés par le cahier de charge (§20). */
export const SEUILS = {
  taux_echec_fonctionnel: ['rate<0.01'],
  'http_req_failed': ['rate<0.01'],
  'duree_consultation': ['p(95)<2000', 'p(99)<5000'],
  'duree_recherche': ['p(95)<2000', 'p(99)<5000'],
  'duree_creation': ['p(95)<2000', 'p(99)<5000'],
  'duree_modification': ['p(95)<2000', 'p(99)<5000'],
  'duree_export': ['p(95)<2000', 'p(99)<5000'],
  'duree_operation_lourde': ['p(95)<5000'],
  'duree_authentification': ['p(95)<2000'],
}
