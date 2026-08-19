#!/usr/bin/env node
/**
 * Assistant IA AFLP — corpus de régression de la compréhension.
 *
 * CE QUE CE BANC MESURE
 *   Pour chaque formulation validée du catalogue, la couche de compréhension
 *   retourne-t-elle l'intention prévue ? C'est la seule question, et elle est
 *   posée sur les 190 formulations à la fois.
 *
 * POURQUOI IL EST INDISPENSABLE
 *   Les intentions du catalogue partagent leur vocabulaire : « combien »,
 *   « RT », « avance » reviennent partout. Ajouter un synonyme à une intention
 *   peut détourner silencieusement les questions d'une autre. Ce banc est le
 *   seul endroit où cela se voit — un ajout qui « marche sur mon exemple »
 *   casse en moyenne deux formulations ailleurs.
 *
 * CE QU'IL NE MESURE PAS
 *   L'exactitude des chiffres (voir aflp-ia-assistant.mjs) ni la façon dont un
 *   utilisateur réel formule ses questions. Un corpus écrit par celui qui écrit
 *   le moteur est un corpus complaisant : les formulations issues du terrain
 *   arriveront par l'interface d'administration, et c'est là que ce banc
 *   deviendra vraiment probant.
 *
 * Usage : node .github/agent-tests/aflp-ia-corpus.mjs
 * Sortie : 0 si tout passe, 1 sinon.
 */
import assert from 'node:assert/strict';
import { charger, CONTEXTE } from './aflp-ia-fixture.mjs';

const { CATALOGUE, COMPREHENSION } = charger();

let echecs = 0;
const signaler = (m) => { echecs++; console.error('  ✗ ' + m); };

/* =========================================================================
   1. Intégrité du catalogue
   ===================================================================== */
const pbs = CATALOGUE.verifier();
if (pbs.length) { pbs.forEach((p) => signaler('catalogue : ' + p)); }

const publiees = CATALOGUE.intentions.filter((i) => i.statut === 'publie' || i.statut === 'non_disponible');
assert.ok(publiees.length >= 20 && publiees.length <= 30,
  `le catalogue doit compter entre 20 et 30 intentions utiles, il en compte ${publiees.length}`);

for (const i of publiees) {
  if (i.formulations.length < 5) signaler(`${i.code} : ${i.formulations.length} formulations (minimum 5)`);
}

/* Aucune formulation ne doit apparaître dans deux intentions : ce serait un
   conflit insoluble, et le corpus le maquillerait en « une des deux passe ». */
const vues = new Map();
for (const i of publiees) {
  for (const f of i.formulations) {
    const n = COMPREHENSION.normaliser(f);
    if (vues.has(n) && vues.get(n) !== i.code) {
      signaler(`formulation partagée par ${vues.get(n)} et ${i.code} : « ${f} »`);
    }
    vues.set(n, i.code);
  }
}

/* =========================================================================
   2. Routage du corpus complet
   ===================================================================== */
const corpus = CATALOGUE.corpus();
let routees = 0;
for (const c of corpus) {
  const r = COMPREHENSION.comprendre(c.question, CONTEXTE);
  if (r.contrat.intent === c.code) { routees++; continue; }
  signaler(`« ${c.question} » → ${r.contrat.intent || 'aucune'} (attendu ${c.code}) ` +
    `· candidats ${JSON.stringify(r.trace.candidats)}`);
}

/* =========================================================================
   3. Robustesse : accents, casse, ponctuation, fautes mineures
   -------------------------------------------------------------------------
   Chaque variante est dérivée MÉCANIQUEMENT d'une formulation validée, pour
   qu'aucune ne soit choisie parce qu'elle passe.
   ===================================================================== */
const sansAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const fauteFrappe = (s) => s.replace(/(\b\w{6,}\b)/, (m) => m.slice(0, -1)); // dernière lettre avalée

let variantes = 0, variantesOk = 0;
for (const i of publiees) {
  const base = i.formulations[0];
  for (const [nom, transformee] of [
    ['sans accent', sansAccent(base)],
    ['majuscules', base.toUpperCase()],
    ['minuscules sans ponctuation', sansAccent(base).toLowerCase().replace(/[^\w\s]/g, ' ')],
    ['faute de frappe', fauteFrappe(base)],
  ]) {
    variantes++;
    const r = COMPREHENSION.comprendre(transformee, CONTEXTE);
    if (r.contrat.intent === i.code) { variantesOk++; continue; }
    signaler(`${i.code} · ${nom} : « ${transformee} » → ${r.contrat.intent || 'aucune'}`);
  }
}

/* =========================================================================
   4. Questions hors périmètre — le refus doit rester un refus
   ===================================================================== */
const HORS_PERIMETRE = [
  'Quel temps fera-t-il demain ?',
  'Raconte-moi une blague',
  'Qui a gagné le match hier soir ?',
  'Traduis bonjour en anglais',
  'Combien coûte un billet pour Abidjan ?',
  'Écris-moi un poème sur le cacao',
];
for (const q of HORS_PERIMETRE) {
  const r = COMPREHENSION.comprendre(q, CONTEXTE);
  if (r.contrat.intent !== null) {
    signaler(`question hors périmètre acceptée : « ${q} » → ${r.contrat.intent}`);
  }
  if (!r.contrat.requires_clarification) {
    signaler(`question hors périmètre sans demande de reformulation : « ${q} »`);
  }
}

/* =========================================================================
   5. Questions ambiguës — l'assistant doit demander, pas parier
   ===================================================================== */
const AMBIGUES = [
  { q: 'Combien avons-nous acheté ?', motif: 'aucune portée précisée' },
];
for (const a of AMBIGUES) {
  const r = COMPREHENSION.comprendre(a.q, CONTEXTE);
  if (!r.contrat.requires_clarification) {
    signaler(`ambiguïté non détectée (${a.motif}) : « ${a.q} »`);
  }
  if (!r.contrat.clarification_question) {
    signaler(`clarification demandée sans question posée : « ${a.q} »`);
  }
}

/* Une portée explicite lève l'ambiguïté : sinon l'assistant demanderait
   éternellement, ce qui est une autre façon de ne pas répondre. */
for (const q of ['Combien avons-nous acheté à Béoumi ?', 'Combien avons-nous acheté au total ?']) {
  const r = COMPREHENSION.comprendre(q, CONTEXTE);
  if (r.contrat.requires_clarification) signaler(`clarification superflue sur : « ${q} »`);
}

/* =========================================================================
   6. Déterminisme de la compréhension
   ===================================================================== */
for (const c of corpus.slice(0, 40)) {
  const a = JSON.stringify(COMPREHENSION.comprendre(c.question, CONTEXTE).contrat);
  const b = JSON.stringify(COMPREHENSION.comprendre(c.question, CONTEXTE).contrat);
  if (a !== b) signaler(`compréhension non déterministe : « ${c.question} »`);
}

/* =========================================================================
   Verdict
   ===================================================================== */
console.log(`Corpus     : ${routees}/${corpus.length} formulations validées correctement routées`);
console.log(`Variantes  : ${variantesOk}/${variantes} (accents, casse, ponctuation, fautes)`);
console.log(`Intentions : ${publiees.length} publiées ou explicitement indisponibles`);

if (echecs) {
  console.error(`\nÉCHEC — ${echecs} anomalie(s) de reconnaissance.`);
  process.exit(1);
}
console.log('OK - Corpus de compréhension AFLP');
