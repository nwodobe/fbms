#!/usr/bin/env node
/**
 * AFLP MOTO MANAGER — tests unitaires du cœur métier (moto/moto-core.js).
 * Aucune dépendance : node --test tests/moto/core.test.mjs
 * Les valeurs attendues sont celles des vues SQL (même jeu fictif que
 * tests/moto/tests_serveur_moto.py) : le client et le serveur calculent pareil.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../moto/moto-core.js');

test('Classes métier : correspondance stricte avec private.moto_classe()', () => {
  assert.equal(C.classeDepuisRole('Branch Manager'), 'BM');
  assert.equal(C.classeDepuisRole('Assistant Branch Manager'), 'ABM');
  assert.equal(C.classeDepuisRole('Zonal Head'), 'ZONE');
  assert.equal(C.classeDepuisRole('Unit Head'), 'UNITE');
  assert.equal(C.classeDepuisRole('Finance Manager'), 'FINANCE');
  assert.equal(C.classeDepuisRole('General Manager'), 'DIRECTION');
  assert.equal(C.classeDepuisRole('Supervisor'), null);
  assert.equal(C.classeDepuisRole('Agent Recenseur'), null);
  assert.equal(C.peut('UNITE', 'admin'), false);
  assert.equal(C.peut('ABM', 'mettre_en_service'), false, 'la mise en service reste au BM');
  assert.equal(C.peut('ABM', 'valider_corrections'), false, 'l\'ABM ne valide pas ses corrections');
});

test('Plein à plein : plein initial exclu, plein final inclus (3,50 L/100 km)', () => {
  const achats = [
    { id: 'a', compteur_km: 60, litres: 3.0, plein_complet: true, justificatif_statut: 'VERIFIE', date_achat: '2026-11-01T08:00:00Z' },
    { id: 'b', compteur_km: 120, litres: 1.5, plein_complet: false, justificatif_statut: 'VERIFIE', date_achat: '2026-11-02T08:00:00Z' },
    { id: 'c', compteur_km: 160, litres: 2.0, plein_complet: true, justificatif_statut: 'A_VERIFIER', date_achat: '2026-11-03T08:00:00Z' },
  ];
  const r = C.consoPleinAPlein(achats, { seuil1: 3.6, seuil2: 4.2 });
  assert.equal(r.intervalles.length, 1);
  assert.equal(r.intervalles[0].litres, 3.5);
  assert.equal(r.intervalles[0].km, 100);
  assert.equal(r.l_100km, 3.5);
  assert.equal(r.intervalles[0].statut_alerte, 'NORMAL');
});

test('Plein à plein : justificatif rejeté exclu, seuils provisoires, données insuffisantes', () => {
  const base = [
    { compteur_km: 100, litres: 2, plein_complet: true, justificatif_statut: 'VERIFIE' },
    { compteur_km: 140, litres: 9, plein_complet: false, justificatif_statut: 'REJETE' },
    { compteur_km: 200, litres: 3.8, plein_complet: true, justificatif_statut: 'VERIFIE' },
  ];
  const r = C.consoPleinAPlein(base);
  assert.equal(r.l_100km, 3.8);
  assert.equal(r.intervalles[0].statut_alerte, 'VERIFICATION');
  assert.equal(C.statutAlerte(4.25, 100, {}), 'VERIFICATION_PRIORITAIRE');
  assert.equal(C.consoPleinAPlein([{ compteur_km: 10, litres: 2, plein_complet: true }]).l_100km, null);
  assert.equal(C.l100(null), 'Non disponible');
  const inval = C.consoPleinAPlein([{ compteur_km: 50, litres: 1, plein_complet: true }, { compteur_km: 50, litres: 1, plein_complet: true }]);
  assert.equal(inval.intervalles[0].statut_alerte, 'INVALIDE');
  assert.equal(inval.l_100km, null);
});

test('Rapprochement : remis ≠ reçu ≠ justifié, échec exclu, pas de double comptage', () => {
  const r = C.rapprochement({
    budgets: [{ statut: 'VALIDE', montant_autorise: 30000 }, { statut: 'PROPOSE', montant_autorise: 99999 }],
    dotations: [
      { statut: 'CONFIRMEE', montant_remis: 10000, montant_recu: 10000, frais_transaction: 0 },
      { statut: 'CONTESTEE', montant_remis: 10000, montant_recu: 9900, frais_transaction: 100 },
      { statut: 'ECHOUEE', montant_remis: 5000, frais_transaction: 0 },
    ],
    carburant: [
      { financement: 'DOTATION', justificatif_statut: 'VERIFIE', montant: 2550 },
      { financement: 'DOTATION', justificatif_statut: 'VERIFIE', montant: 1275 },
      { financement: 'DOTATION', justificatif_statut: 'VERIFIE', montant: 1700 },
      { financement: 'DOTATION', justificatif_statut: 'REJETE', montant: 800 },
      { financement: 'AVANCE_PERSONNELLE', justificatif_statut: 'VERIFIE', montant: 2125, remboursement_id: 'r1' },
    ],
    restitutions: [{ montant: 475 }],
    remboursements: [{ statut: 'PAYE_DECLARE', montant: 2125 }],
  });
  assert.equal(r.budget_autorise, 30000);
  assert.equal(r.dotations_remises, 20000);
  assert.equal(r.frais_mobile_money, 100);
  assert.equal(r.dotations_recues, 19900, 'part reçue d\'une dotation en écart incluse');
  assert.equal(r.justifies_verifies, 5525);
  assert.equal(r.achats_declares, 5525);
  assert.equal(r.avance_a_apurer, 13900);
  assert.equal(r.reste_a_rembourser, 0);
  assert.equal(r.remboursements_valides, 2125);
});

test('Disponibilité technique : jours prévus (lundi-samedi) et immobilisations', () => {
  // Lundi 2 → samedi 7 novembre 2026 : 6 jours prévus ; immobilisée mercredi 4 et jeudi 5.
  const d = C.disponibilite('2026-11-02T08:00:00Z', [{ debut: '2026-11-04T10:00:00Z', fin: '2026-11-05T16:00:00Z' }], '2026-11-08T12:00:00Z', 6);
  assert.equal(d.jours_prevus, 6);
  assert.equal(d.jours_indisponibles, 2);
  assert.equal(d.taux, 66.7);
  assert.equal(C.disponibilite(null, [], new Date()).taux, null, 'moto non mise en service : non disponible');
});

test('Coût direct au km : dénominateur nul → non disponible', () => {
  assert.deepEqual(C.coutKm({ km_debut: 5, km_fin: 708, cout_carburant_verifie: 7650, cout_maintenance: 5000, cout_pneus: 13000, cout_incidents: 8000 }),
    { km_parcourus: 703, cout_direct_total: 33650, fcfa_km: 47.9 });
  assert.equal(C.coutKm({ km_debut: 5, km_fin: 5 }).fcfa_km, null);
});

test('Sécurité : anomalie critique et immobilisation locale sans réseau', () => {
  const items = C.CONTROLE_DEPART.map(i => ({ ...i, ok: true }));
  assert.equal(C.anomalieCritique(items), false);
  assert.equal(C.resultatControle(items), 'APTE');
  items.find(i => i.code === 'FREIN_AVANT').ok = false;
  assert.equal(C.anomalieCritique(items), true);
  assert.equal(C.exigeImmobilisation({ type: 'CONTROLE_DEPART', payload: { items } }), true);
  assert.equal(C.exigeImmobilisation({ type: 'INCIDENT', payload: { type_incident: 'PANNE', gravite: 'CRITIQUE' } }), true);
  assert.equal(C.exigeImmobilisation({ type: 'INCIDENT', payload: { type_incident: 'ACCIDENT', gravite: 'MINEURE' } }), true);
  assert.equal(C.exigeImmobilisation({ type: 'INCIDENT', payload: { type_incident: 'CREVAISON', gravite: 'MINEURE' } }), false);
});

test('Validations de saisie terrain', () => {
  assert.ok(C.validerCarburant({ moto_id: 'x', date_achat: new Date().toISOString(), compteur_km: '10', litres: '70', montant: '1', plein_complet: true, financement: 'DOTATION', avec_justificatif: true }).some(e => /Litres/.test(e)));
  assert.ok(C.validerCarburant({ moto_id: 'x', date_achat: new Date().toISOString(), compteur_km: '10', litres: '2', montant: '1700', financement: 'DOTATION', avec_justificatif: false }).length === 2);
  assert.deepEqual(C.validerReleve({ compteur_km: '120' }, 100), []);
  assert.ok(C.validerReleve({ compteur_km: '90' }, 100).length === 1);
  assert.ok(C.validerIncident({ type_incident: 'PANNE', gravite: 'CRITIQUE', description: 'court' }).length === 1);
  assert.equal(C.nombreSaisi('1 275,5'), 1275.5);
  assert.equal(C.nombreSaisi('abc'), null);
});

test('File hors connexion : SYNCHRONISE seulement sur réponse serveur, reprises limitées', () => {
  const op = { client_op_id: 'o1', statut: 'EN_ATTENTE', tentatives: 0, cree_le: '2026-11-01T00:00:00Z' };
  let o = C.appliquerResultat(op, { statut: 'ERREUR_TEMPORAIRE' }, Date.parse('2026-11-01T10:00:00Z'));
  assert.equal(o.statut, 'EN_ATTENTE'); assert.equal(o.tentatives, 1);
  assert.equal(C.operationsEligibles([o], Date.parse('2026-11-01T10:00:05Z')).length, 0, 'reprise différée');
  assert.equal(C.operationsEligibles([o], Date.parse('2026-11-01T10:00:20Z')).length, 1);
  for (let i = 0; i < 4; i++) o = C.appliquerResultat(o, null);
  assert.equal(o.statut, 'BLOQUE', 'au-delà de 5 tentatives : relance manuelle');
  assert.equal(C.appliquerResultat(op, { statut: 'SYNCHRONISE', doublon: true }).message, 'Déjà reçu par le serveur (aucun doublon créé).');
  assert.equal(C.appliquerResultat(op, { statut: 'REJETE', message: 'CONFLIT_COMPTEUR' }).statut, 'REJETE');
  assert.deepEqual(C.resumeFile([{ statut: 'EN_ATTENTE' }, { statut: 'SYNCHRONISE' }, { statut: 'REJETE' }]), { EN_ATTENTE: 1, SYNCHRONISE: 1, REJETE: 1, BLOQUE: 0 });
  assert.ok(C.TYPES_HORS_LIGNE.indexOf('DOTATION_REMETTRE') < 0, 'une remise de dotation exige le réseau');
});

test('Limites d\'observation : quatre motos ne font pas une statistique', () => {
  assert.match(C.avertissementEchantillon(4, 3), /Observation limitée/);
  assert.match(C.avertissementEchantillon(0), /non disponibles/);
  assert.equal(C.avertissementEchantillon(30, 40), null);
});
