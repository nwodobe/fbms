/**
 * Montée progressive puis palier tenu à 100 utilisateurs.
 *
 * Profil : 0 → 10 → 25 → 50 → 75 → 100, puis maintien. Le maintien est la
 * partie utile : il fait apparaître ce qu'un pic ne montre pas — dégradation
 * progressive, saturation d'un pool de connexions, expiration de session,
 * fuite mémoire côté serveur.
 *
 * Le plafond de 100 n'est jamais dépassé (consigne §12).
 *
 *   k6 run tests/load/02-montee.js
 *   k6 run -e MAINTIEN=10m tests/load/02-montee.js
 */
import { sleep } from 'k6'
import { connexion, personaPour, lire, creerAchat, tConsultation, tRecherche, SEUILS } from './00-commun.js'

const MAINTIEN = __ENV.MAINTIEN || '5m'

export const options = {
  scenarios: {
    montee: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '30s', target: 25 },
        { duration: '30s', target: 25 },
        { duration: '45s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '45s', target: 75 },
        { duration: '30s', target: 75 },
        { duration: '45s', target: 100 },
        { duration: MAINTIEN, target: 100 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
  },
  thresholds: SEUILS,
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  const persona = personaPour(__VU)
  const jeton = connexion(persona)
  if (!jeton) { sleep(5); return }
  lire(jeton, 'profils?select=*&user_id=eq.x', tConsultation, 'lecture_profil')
  lire(jeton, 'villages?select=data,created_at,updated_at,created_by,updated_by&deleted=eq.false', tConsultation, 'liste_villages')
  if ((__VU + __ITER) % 5 === 0) creerAchat(jeton, __VU, __ITER)
  else lire(jeton, 'rt?select=*&deleted=eq.false', tRecherche, 'liste_rt')
  sleep(5 + Math.random() * 7)
}
