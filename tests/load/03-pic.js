/**
 * Pic d'arrivée : 10 → 100 utilisateurs en 10 secondes.
 *
 * Reproduit le moment réel de la campagne : l'ouverture des pesées le matin,
 * où toutes les équipes ouvrent l'application dans la même minute. On observe
 * trois choses distinctes : le refus (erreurs HTTP), l'attente (dérive des
 * temps de réponse) et surtout la RÉCUPÉRATION — un système qui ne revient
 * pas à son temps nominal après le pic n'est pas dimensionné.
 *
 *   k6 run tests/load/03-pic.js
 */
import { sleep } from 'k6'
import { connexion, personaPour, lire, tConsultation, SEUILS } from './00-commun.js'

export const options = {
  scenarios: {
    pic: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '45s', target: 10 },   // régime nominal, sert de référence
        { duration: '10s', target: 100 },  // pic
        { duration: '90s', target: 100 },  // tenue sous pic
        { duration: '10s', target: 10 },   // retombée
        { duration: '90s', target: 10 },   // récupération : le temps revient-il ?
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: SEUILS,
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  const persona = personaPour(__VU)
  const jeton = connexion(persona)
  if (!jeton) { sleep(3); return }
  // Séquence d'ouverture d'un module : profil puis référentiel.
  lire(jeton, 'profils?select=*&user_id=eq.x', tConsultation, 'lecture_profil')
  lire(jeton, 'villages?select=data,created_at,updated_at,created_by,updated_by&deleted=eq.false', tConsultation, 'liste_villages')
  sleep(3 + Math.random() * 4)
}
