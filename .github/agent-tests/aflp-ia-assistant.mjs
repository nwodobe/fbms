#!/usr/bin/env node
/**
 * Assistant IA AFLP — contrôle de non-régression.
 *
 * Deux natures de vérification, volontairement dans le même fichier :
 *
 *   1. STRUCTURE — le moteur et l'interface sont-ils encore branchés au
 *      Command Center, et l'échappement d'affichage est-il toujours complet ?
 *   2. MÉTIER — la règle « PAS DE RÉCONCILIATION = PAS DE REFINANCEMENT »
 *      produit-elle encore le même verdict sur un jeu de cas connus ?
 *
 * Le second point est le plus important. Un moteur qui compile mais qui
 * déclare refinançable une équipe non réconciliée ne casse aucun test de
 * syntaxe — il casse la règle de gestion du programme.
 *
 * Toutes les données de ce fichier sont FICTIVES : aucun nom de producteur,
 * aucun montant réel, aucune coordonnée de parcelle.
 *
 * Usage : node .github/agent-tests/aflp-ia-assistant.mjs
 * Sortie : 0 si tout passe, 1 sinon.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const racine = process.cwd();
const require = createRequire(path.join(racine, 'package-inexistant.js'));

const fichiers = {
  moteur: 'shared/aflp-ia-moteur.js',
  interface: 'shared/aflp-ia-ui.js',
  page: 'terrain/command.html',
};
const source = Object.fromEntries(
  Object.entries(fichiers).map(([k, rel]) => [k, fs.readFileSync(path.join(racine, rel), 'utf8')])
);

/* =========================================================================
   1. Structure — câblage et sécurité d'affichage
   ===================================================================== */

assert.ok(source.page.includes('shared/aflp-ia-moteur.js'),
  'command.html ne charge plus le moteur AFLP');
assert.ok(source.page.includes('shared/aflp-ia-ui.js'),
  'command.html ne charge plus l\'interface AFLP');
assert.ok(source.page.includes('id="aflpIa"'),
  'le conteneur #aflpIa a disparu de command.html');
assert.match(source.page, /AFLP_IA_UI\.rafraichir\(/,
  'command.html n\'alimente plus l\'assistant après le chargement des données');

/* Sans ces colonnes, l'assistant ne peut plus dater une avance ni vérifier
   qu'une réconciliation couvre bien la dernière avance reçue : la règle de
   refinancement deviendrait fausse en silence. */
assert.match(source.page, /q\("avances","date,/,
  'la requête avances doit remonter la colonne date');
assert.match(source.page, /q\("reconciliations","date,/,
  'la requête reconciliations doit remonter la colonne date');

/* Le moteur ne doit jamais appeler le réseau : il travaille sur des données
   déjà chargées, et doit rester utilisable hors ligne. */
assert.doesNotMatch(source.moteur, /\bfetch\s*\(|XMLHttpRequest|createClient/,
  'le moteur AFLP ne doit contenir aucun appel réseau');
assert.doesNotMatch(source.moteur, /\bdocument\b/,
  'le moteur AFLP ne doit pas toucher au DOM');

/* Échappement : même exigence que la Control Tower Sacherie — l'apostrophe
   comprise, sinon un nom de cluster suffit à casser un attribut. */
assert.match(source.interface, /replace\(\/\[&<>"'\]\/g/,
  'aflp-ia-ui.js : esc() doit inclure l\'apostrophe');
assert.match(source.interface, /"'": "&#39;"/,
  'aflp-ia-ui.js : esc() doit encoder l\'apostrophe en &#39;');
assert.doesNotMatch(source.interface, /\son(?:click|change|input|error|load)\s*=\s*["']/i,
  'aflp-ia-ui.js contient un gestionnaire d\'événement inline');

/* =========================================================================
   2. Métier — la règle AFLP sur des cas connus
   ===================================================================== */

const IA = require(path.join(racine, 'shared/aflp-ia-moteur.js'));

assert.equal(IA.format.cle('Djébonoua'), 'DJEBONOUA',
  'la normalisation des accents est cassée : les jointures par cluster vont diverger');

const JOUR = '2027-03-10';
const donnees = {
  dateRef: JOUR,
  villages: [
    { id: 'v1', data: { s1: { village: 'VILLAGE ALPHA', cluster: 'Djébonoua', gpsLat: 7.1 } } },
    { id: 'v2', data: { s1: { village: 'VILLAGE BRAVO', cluster: 'Brobo' } } },
    { id: 'v3', data: { s1: { village: 'VILLAGE CHARLIE', cluster: 'Béoumi', gpsLat: 7.9 } } },
  ],
  rt: [
    { id: 'rt1', village_nom: 'VILLAGE ALPHA', data: { nom: 'EQUIPE 01', cluster: 'Djébonoua' } },
    { id: 'rt2', village_nom: 'VILLAGE BRAVO', data: { nom: 'EQUIPE 02', cluster: 'Brobo' } },
    { id: 'rt3', village_nom: 'VILLAGE CHARLIE', data: { nom: 'EQUIPE 03', cluster: 'Béoumi' } },
  ],
  achats: [
    { date: JOUR, cluster: 'Djébonoua', village_nom: 'VILLAGE ALPHA', rt_id: 'rt1', rt_nom: 'EQUIPE 01',
      poids_net: 12000, montant: 6000000, commission_rt: 120000, numero_recu: 'R-001',
      refinancable: true, qualite_statut: 'OK', statut_validation: 'OK' },
    { date: JOUR, cluster: 'Brobo', village_nom: 'VILLAGE BRAVO', rt_id: 'rt2', rt_nom: 'EQUIPE 02',
      poids_net: 5000, montant: 2500000, commission_rt: 50000, numero_recu: '',
      refinancable: false, qualite_statut: 'À contrôler', statut_validation: 'Validation BM requise' },
    { date: '2027-02-01', cluster: 'Béoumi', village_nom: 'VILLAGE CHARLIE', rt_id: 'rt3', rt_nom: 'EQUIPE 03',
      poids_net: 3000, montant: 1500000, commission_rt: 30000, numero_recu: 'R-003',
      refinancable: true, qualite_statut: 'OK', statut_validation: 'OK' },
  ],
  avances: [
    { date: '2027-03-08', cluster: 'Djébonoua', rt_id: 'rt1', rt_nom: 'EQUIPE 01', montant: 7000000 },
    { date: '2027-03-09', cluster: 'Brobo', rt_id: 'rt2', rt_nom: 'EQUIPE 02', montant: 3000000 },
    { date: '2027-03-09', cluster: 'Béoumi', rt_id: 'rt3', rt_nom: 'EQUIPE 03', montant: 1000000 },
  ],
  reconciliations: [
    // rt1 : postérieure à l'avance, écart nul -> GO
    { date: '2027-03-09', rt_id: 'rt1', rt_nom: 'EQUIPE 01', statut: 'Réconcilié', ecart: 0 },
    // rt2 : réconciliée AVANT l'avance du 09 -> ne couvre pas l'argent en cours
    { date: '2027-03-05', rt_id: 'rt2', rt_nom: 'EQUIPE 02', statut: 'Réconcilié', ecart: 0 },
    // rt3 : aucune réconciliation, et payé > avancé
  ],
  sacs: [
    { date: JOUR, type: 'DOTATION_RT', source: 'ANAGROCI', destination: 'RT', cluster: 'Djébonoua', rt_id: 'rt1', quantite: 500 },
    { date: JOUR, type: 'DISTRIBUTION', source: 'RT', destination: 'PRODUCTEUR', cluster: 'Djébonoua', rt_id: 'rt1', producteur_id: 'p1', quantite: 200 },
    { date: JOUR, type: 'DECHIRE_RT', source: 'RT', destination: 'PERTE', cluster: 'Brobo', rt_id: 'rt2', quantite: 30 },
  ],
  fileLocale: { enAttente: 4, echecs: 1 },
};

const etat = IA.construireEtat(donnees);

// -- Cadrage du pilote --------------------------------------------------------
assert.equal(etat.objectifMT, 3000, 'l\'objectif AFLP doit rester 3 000 MT');
assert.equal(etat.couverture.villagesCibles, 60, 'la cible villages doit rester 60');
assert.equal(etat.couverture.rtCibles, 60, 'la cible équipes RT doit rester 60');
assert.equal(IA.CLUSTERS_AFLP.length, 6, 'le pilote compte 6 clusters');

// -- Agrégats -----------------------------------------------------------------
assert.equal(etat.volume.cumulKg, 20000, 'cumul volume');
assert.equal(etat.volume.jourKg, 17000, 'volume du jour');
assert.equal(etat.cash.avances, 11000000, 'avances cumulées');
assert.equal(etat.cash.paye, 10000000, 'payé aux producteurs');
assert.equal(etat.cash.solde, 1000000, 'solde de caisse');
assert.equal(etat.qualite.sansRecu, 1, 'achats sans reçu');
assert.equal(etat.qualite.montantSansRecu, 2500000, 'montant sans reçu');
assert.equal(etat.sacs.rtTotal, 270, 'sacs en main RT (500 - 200 - 30)');
assert.equal(etat.sacs.negRt, 1, 'un solde RT négatif attendu');

// -- La règle de refinancement, cas par cas -----------------------------------
const refi = IA.refinancement(etat);
const parNom = Object.fromEntries(refi.parRT.map((r) => [r.nom, r]));

assert.equal(refi.global.rtEvalues, 3, 'trois équipes portent une avance ou un achat');
assert.equal(parNom['EQUIPE 01'].statut, 'GO',
  'une équipe réconciliée après sa dernière avance, sans écart, doit être GO');
assert.equal(parNom['EQUIPE 02'].statut, 'NO-GO',
  'une réconciliation antérieure à la dernière avance ne doit PAS ouvrir le refinancement');
assert.match(parNom['EQUIPE 02'].motifs.join(' '), /antérieure/,
  'le motif doit nommer l\'antériorité de la réconciliation');
assert.equal(parNom['EQUIPE 03'].statut, 'NO-GO',
  'une équipe sans réconciliation ne peut jamais être refinancée');
assert.match(parNom['EQUIPE 03'].motifs.join(' '), /Aucune réconciliation/,
  'le motif doit nommer l\'absence de réconciliation');
assert.match(parNom['EQUIPE 03'].motifs.join(' '), /Dépassement/,
  'un dépassement de caisse doit être signalé comme motif distinct');

assert.equal(refi.global.montantDebloquable, 6000000,
  'seuls les achats avec reçu d\'une équipe GO sont débloquables');
assert.equal(refi.global.montantBloque, 1500000,
  'un achat sans reçu n\'entre dans aucune assiette, même bloquée');
assert.equal(refi.global.statut, 'PARTIEL', 'statut global attendu');

// -- Alertes ------------------------------------------------------------------
const alertes = IA.alertes(etat, refi);
const codes = alertes.map((a) => a.code);
for (const attendu of ['AFLP-REFI-01', 'AFLP-TRAC-01', 'AFLP-SYNC-01']) {
  assert.ok(codes.includes(attendu), `alerte manquante : ${attendu}`);
}
assert.equal(alertes[0].severite, 'critique', 'les alertes critiques doivent venir en tête');
assert.ok(alertes.every((a) => a.valeur > 0),
  'aucune alerte ne doit être produite avec un compteur nul');

// -- Synthèse -----------------------------------------------------------------
const synthese = IA.synthese(etat, refi, alertes);
assert.equal(synthese.sections.length, 6, 'la synthèse compte six sections');
assert.equal(synthese.decisions.length, 3, 'la synthèse propose trois décisions');
assert.match(synthese.enTete, /AFLP 2027/, 'l\'en-tête doit nommer la campagne');
assert.ok(IA.syntheseTexte(synthese).length > 500, 'l\'export texte est vide ou tronqué');

// -- Questions en langage naturel ---------------------------------------------
const demander = (q) => IA.repondre(q, etat, refi, alertes);
assert.match(demander('Quels RT sont bloqués pour refinancement ?').texte,
  /pas de refinancement/i, 'la réponse doit rappeler la règle AFLP');
assert.match(demander('Combien a acheté Brobo ?').texte, /Brobo/,
  'la portée par cluster n\'est plus reconnue');
assert.match(demander('Quel est le solde de caisse de GBEKE 1 ?').texte, /GBEKE 1/,
  'la portée par zone n\'est plus reconnue');
assert.match(demander('Que dois-je traiter en priorité ?').texte, /priorité/i,
  'la question des priorités ne renvoie plus les alertes');

/* Le point de refus : l'assistant doit dire qu'il ne sait pas, au lieu de
   produire une phrase plausible sans fondement. */
assert.equal(demander('Quel temps fera-t-il demain ?').confiance, 'nulle',
  'une question hors périmètre doit être refusée explicitement');

// -- Déterminisme -------------------------------------------------------------
assert.equal(
  JSON.stringify(IA.synthese(IA.construireEtat(donnees))),
  JSON.stringify(IA.synthese(IA.construireEtat(donnees))),
  'deux exécutions sur les mêmes données doivent donner le même résultat'
);

console.log('OK - Assistant IA AFLP : câblage, règle de refinancement, alertes, synthèse, questions');
