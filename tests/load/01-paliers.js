/**
 * Palier de charge à effectif constant.
 *
 * Un palier = un nombre d'utilisateurs simultanés maintenu pendant une durée
 * fixe. Le lanceur tests/load/executer.mjs enchaîne 1, 5, 10, 25, 50, 75 puis
 * 100 en relevant chaque fois les mêmes indicateurs, afin que la comparaison
 * entre paliers soit la seule variable.
 *
 *   k6 run -e VUS=25 -e DUREE=60s tests/load/01-paliers.js
 *
 * Répartition des actions — calquée sur l'usage réel du produit, pas sur un
 * modèle générique. Elle est justifiée dans 04-LOAD-REPORT.md §2 :
 *   40 % consultation      (ouvrir un module, lire le référentiel)
 *   20 % recherche/filtre  (producteurs d'un village, achats du jour)
 *   20 % création          (saisie d'un achat — le geste de campagne)
 *   10 % modification      (mise à jour d'une fiche village)
 *    5 % export/rapport    (relevé complet des achats)
 *    5 % opération lourde  (cycle de synchronisation FBMS complet)
 */
import { sleep } from 'k6'
import {
  connexion, personaPour, lire, creerAchat, entetes, URL_BASE,
  tConsultation, tRecherche, tModification, tExport, tLourd, SEUILS, ECRITURE,
  tauxEchec, erreursMetier,
} from './00-commun.js'
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  scenarios: {
    palier: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DUREE || '60s',
    },
  },
  thresholds: SEUILS,
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: false,
}

export function setup() {
  return { debut: Date.now() }
}

export default function () {
  const persona = personaPour(__VU)
  const jeton = connexion(persona)
  if (!jeton) { sleep(3); return }

  // Toute page de l'application lit le profil au chargement (auth-gate.js).
  lire(jeton, `profils?select=*&user_id=eq.x`, tConsultation, 'lecture_profil')

  const tirage = (__VU * 13 + __ITER * 7) % 100

  if (tirage < 40) {
    /* Consultation : ouverture d'un module de référentiel. */
    lire(jeton, 'villages?select=data,created_at,updated_at,created_by,updated_by&deleted=eq.false', tConsultation, 'liste_villages')
    lire(jeton, 'hubs_clusters?select=*&deleted=eq.false', tConsultation, 'liste_hubs')
  } else if (tirage < 60) {
    /* Recherche et filtres. */
    const village = ((__VU + __ITER) % 40) + 1
    lire(jeton, `producteurs?select=code,data,statut&deleted=eq.false&village_id=eq.00000000-0000-4000-8000-${100000000000 + village}`, tRecherche, 'producteurs_du_village')
    lire(jeton, `rt?select=id,id_rt,nom,data,village_id&deleted=eq.false`, tRecherche, 'liste_rt')
  } else if (tirage < 80) {
    /* Création : saisie d'un achat. */
    creerAchat(jeton, __VU, __ITER)
    lire(jeton, `achats?select=*&date=eq.2026-08-22`, tRecherche, 'achats_du_jour')
  } else if (tirage < 90) {
    /* Modification d'une fiche village — même forme que RemoteVillages.upsert :
       une lecture de contrôle de conflit PUIS une écriture. */
    const id = `00000000-0000-4000-8000-${100000000000 + ((__VU % 40) + 1)}`
    const debut = Date.now()
    lire(jeton, `villages?select=data,updated_at,updated_by&id=eq.${id}`, tModification, 'controle_conflit')
    if (ECRITURE) {
      const r = http.post(`${URL_BASE}/rest/v1/villages?on_conflict=id`, JSON.stringify({
        id, village: 'TEST_LOAD_V' + String((__VU % 40) + 1).padStart(3, '0'),
        statut: 'Validé', deleted: false,
        data: { id, s1: { village: 'TEST_LOAD_V' + String((__VU % 40) + 1).padStart(3, '0'), cluster: 'TEST_LOAD_CLUSTER_A' }, s9: { potentiel20: 10, route20: 10, dispoRT20: 10, risqueConcurrentiel20: 10, faisabilitePaiement20: 10 } },
      }), { headers: { ...entetes(jeton), Prefer: 'resolution=merge-duplicates,return=representation' }, tags: { action: 'modification_village' } })
      const ok = r.status >= 200 && r.status < 300
      check(r, { 'modification village : 2xx': () => ok })
      tauxEchec.add(!ok)
      if (!ok) erreursMetier.add(1)
    }
    tModification.add(Date.now() - debut)
  } else if (tirage < 95) {
    /* Export : relevé complet des achats, tel que le font les écrans de suivi. */
    lire(jeton, 'achats?select=*', tExport, 'export_achats')
  } else {
    /* Opération lourde : cycle de synchronisation FBMS complet
       (fbms/index.html:syncNow — pousse puis relit trois référentiels). */
    const debut = Date.now()
    lire(jeton, 'villages?select=data,created_at,updated_at,created_by,updated_by&deleted=eq.false', tLourd, 'sync_villages')
    lire(jeton, 'rt?select=*&deleted=eq.false', tLourd, 'sync_rt')
    lire(jeton, 'producteurs?select=*&deleted=eq.false', tLourd, 'sync_producteurs')
    lire(jeton, 'parametres_calcul?select=cle,valeur', tLourd, 'sync_parametres')
    tLourd.add(Date.now() - debut)
  }

  // Rythme de terrain : un geste toutes les 5 à 12 secondes.
  sleep(5 + Math.random() * 7)
}
