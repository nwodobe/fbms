/**
 * Concurrence dure : plusieurs utilisateurs sur LE MÊME enregistrement.
 *
 * Trois familles de collision provoquées volontairement :
 *
 *   A. MÊME FICHE VILLAGE — tous les utilisateurs lisent la même version puis
 *      écrivent. Le contrôle de conflit de fbms/index.html est un « lire puis
 *      écrire » non atomique : ce scénario compte combien d'écritures sont
 *      silencieusement écrasées.
 *
 *   B. MÊME IDENTIFIANT LOCAL D'ACHAT — le même local_id envoyé par plusieurs
 *      utilisateurs à la même seconde. La contrainte d'unicité de
 *      supabase/achats.sql doit tenir : une seule ligne, aucune erreur
 *      remontée à l'utilisateur grâce à ignore-duplicates.
 *
 *   C. MÊME NUMÉRO DE REÇU PAPIER — deux saisies du même reçu par deux agents
 *      différents. Aucune contrainte n'existe sur `numero_recu` : ce scénario
 *      mesure combien de doublons métier passent.
 *
 *   k6 run -e VUS=25 tests/load/05-concurrence.js
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Trend } from 'k6/metrics'
import { connexion, personaPour, entetes, URL_BASE, ECRITURE, PERSONAS } from './00-commun.js'

const collisionsVillage = new Counter('collisions_village')
const ecrasementsSilencieux = new Counter('ecrasements_silencieux')
const doublonsLocalId = new Counter('doublons_local_id_acceptes')
const doublonsRecu = new Counter('doublons_recu_acceptes')
const tEcriture = new Trend('duree_ecriture_concurrente', true)

const VILLAGE_PARTAGE = '00000000-0000-4000-8000-100000000001'

export const options = {
  scenarios: {
    collision: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 25),
      duration: __ENV.DUREE || '60s',
    },
  },
  thresholds: {
    ecrasements_silencieux: ['count<1'],
    doublons_local_id_acceptes: ['count<1'],
    doublons_recu_acceptes: ['count<1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  // Uniquement des rôles autorisés à écrire : ce scénario mesure la collision,
  // pas le refus de la RLS (déjà couvert par tests/e2e/04-securite-acces.mjs).
  const persona = personaPour(__VU)
  const jeton = connexion(persona.cle === 'direction' ? PERSONAS.find((p) => p.cle === 'agent') : persona)
  if (!jeton) { sleep(3); return }
  const cas = __ITER % 3

  if (cas === 0) {
    /* A — même fiche village, lecture de contrôle puis écriture. */
    const avant = http.get(`${URL_BASE}/rest/v1/villages?select=data,updated_at&id=eq.${VILLAGE_PARTAGE}`, { headers: entetes(jeton) })
    const versionLue = avant.json('0.updated_at')
    const marque = `TEST_LOAD_VU${__VU}_IT${__ITER}`
    if (ECRITURE) {
      const debut = Date.now()
      const r = http.post(`${URL_BASE}/rest/v1/villages?on_conflict=id`, JSON.stringify({
        id: VILLAGE_PARTAGE, village: 'TEST_LOAD_V001', statut: 'Validé', deleted: false,
        data: { id: VILLAGE_PARTAGE, marqueur: marque, s1: { village: 'TEST_LOAD_V001', cluster: 'TEST_LOAD_CLUSTER_A' } },
      }), { headers: { ...entetes(jeton), Prefer: 'resolution=merge-duplicates,return=representation' } })
      tEcriture.add(Date.now() - debut)
      collisionsVillage.add(1)
      // Relecture immédiate : si notre marqueur a déjà disparu, une autre
      // écriture est passée par-dessus sans que personne n'en soit averti.
      const apres = http.get(`${URL_BASE}/rest/v1/villages?select=data,updated_at&id=eq.${VILLAGE_PARTAGE}`, { headers: entetes(jeton) })
      const marqueurFinal = apres.json('0.data.marqueur')
      if (r.status < 300 && marqueurFinal !== marque) ecrasementsSilencieux.add(1)
      check(r, { 'écriture village acceptée': (x) => x.status < 300 })
      // La version lue avant écriture n'a servi à rien côté serveur : on le note.
      check(avant, { 'version de contrôle lisible': () => !!versionLue })
    }
  } else if (cas === 1) {
    /* B — même local_id envoyé deux fois de suite. */
    if (!ECRITURE) return
    const partage = `TEST_LOAD-COMMUN-${__ITER}`
    const corps = JSON.stringify({
      local_id: partage, date: '2026-08-22', village_nom: 'TEST_LOAD_V001',
      rt_nom: 'TEST_LOAD_RT_01', producteur_nom: 'TEST_LOAD_PRODUCTEUR_1', producteur_ref: false,
      poids_brut: 100, tare: 0, poids_net: 100, prix_kg: 400, montant: 40000,
      mode_paiement: 'Wave', numero_recu: 'TEST_LOAD_RECU_' + __ITER, nb_sacs: 2,
      qualite_statut: 'OK', statut_validation: 'À valider', created_by_nom: 'TEST_LOAD',
    })
    const opts = { headers: { ...entetes(jeton), Prefer: 'resolution=ignore-duplicates,return=minimal' } }
    http.post(`${URL_BASE}/rest/v1/achats?on_conflict=local_id`, corps, opts)
    http.post(`${URL_BASE}/rest/v1/achats?on_conflict=local_id`, corps, opts)
    const compte = http.get(`${URL_BASE}/rest/v1/achats?select=local_id&local_id=eq.${partage}`, { headers: entetes(jeton) })
    const n = (compte.json() || []).length
    if (n > 1) doublonsLocalId.add(n - 1)
    check(compte, { 'un seul enregistrement pour un local_id': () => n <= 1 })
  } else {
    /* C — même numéro de reçu papier, deux identifiants locaux différents. */
    if (!ECRITURE) return
    const recu = `TEST_LOAD_RECU_PARTAGE_${__ITER}`
    const base = {
      date: '2026-08-22', village_nom: 'TEST_LOAD_V001', rt_nom: 'TEST_LOAD_RT_01',
      producteur_nom: 'TEST_LOAD_PRODUCTEUR_1', producteur_ref: false,
      poids_brut: 100, tare: 0, poids_net: 100, prix_kg: 400, montant: 40000,
      mode_paiement: 'Wave', numero_recu: recu, nb_sacs: 2,
      qualite_statut: 'OK', statut_validation: 'À valider', created_by_nom: 'TEST_LOAD',
    }
    const opts = { headers: { ...entetes(jeton), Prefer: 'resolution=ignore-duplicates,return=minimal' } }
    http.post(`${URL_BASE}/rest/v1/achats?on_conflict=local_id`, JSON.stringify({ ...base, local_id: `TEST_LOAD-A-${__VU}-${__ITER}` }), opts)
    http.post(`${URL_BASE}/rest/v1/achats?on_conflict=local_id`, JSON.stringify({ ...base, local_id: `TEST_LOAD-B-${__VU}-${__ITER}` }), opts)
    const compte = http.get(`${URL_BASE}/rest/v1/achats?select=local_id&numero_recu=eq.${recu}`, { headers: entetes(jeton) })
    const n = (compte.json() || []).length
    if (n > 1) doublonsRecu.add(n - 1)
    check(compte, { 'un seul achat par numéro de reçu': () => n <= 1 })
  }
  sleep(1)
}
