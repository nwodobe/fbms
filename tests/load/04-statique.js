/**
 * Charge sur la couche de publication (GitHub Pages) — LECTURE SEULE.
 *
 * C'est le seul scénario totalement inoffensif : il ne fait que télécharger
 * des fichiers publics. Il peut être lancé contre la production sans aucun
 * risque pour les données, et c'est le premier à exécuter le jour où l'accès
 * sortant est ouvert.
 *
 *   k6 run -e SITE=https://nwodobe.github.io/fbms tests/load/04-statique.js
 *
 * Ce qu'il mesure : la capacité du CDN à servir 100 ouvertures simultanées et
 * le poids réel du chargement initial de chaque module. Ce qu'il ne mesure
 * pas : la base de données, qui n'est pas sollicitée ici.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Counter } from 'k6/metrics'

const SITE = __ENV.SITE || 'http://127.0.0.1:54330'

const tPage = new Trend('duree_page_html', true)
const tActif = new Trend('duree_ressource', true)
const octets = new Counter('octets_telecharges')

/** Modules du portail, tels que déclarés dans index.html. */
const PAGES = [
  '/index.html',
  '/terrain/achats.html',
  '/terrain/sacs.html',
  '/terrain/cash.html',
  '/terrain/command.html',
  '/fbms/index.html',
  '/fbms/fbms_carte.html',
  '/fbms/fbms_hubs.html',
  '/fbms/audit_distances.html',
  '/logistique/alis_fbms.html',
  '/rcntrace/index.html',
]

const PARTAGES = [
  '/shared/auth-gate.js',
  '/shared/i18n.js',
  '/shared/anagroci-audit.js',
  '/shared/pjs-theme.css',
]

export const options = {
  scenarios: {
    ouverture: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '20s', target: 25 },
        { duration: '20s', target: 50 },
        { duration: '20s', target: 75 },
        { duration: '20s', target: 100 },
        { duration: '60s', target: 100 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    'duree_page_html': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  const page = PAGES[(__VU + __ITER) % PAGES.length]
  const r = http.get(SITE + page, { tags: { page } })
  tPage.add(r.timings.duration)
  octets.add(r.body ? r.body.length : 0)
  check(r, { 'page servie en 200': (x) => x.status === 200 })

  // Chaque page tire les scripts partagés : on reproduit ce coût.
  const lot = PARTAGES.map((p) => ['GET', SITE + p])
  const reponses = http.batch(lot)
  for (const rep of reponses) {
    tActif.add(rep.timings.duration)
    octets.add(rep.body ? rep.body.length : 0)
  }
  sleep(4 + Math.random() * 6)
}
