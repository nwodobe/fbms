/* Recette du moteur « Carburant & Autonomie » (AFLP FLEET, Pilotage).
   Données FICTIVES : agents « Agent A… », identifiants inventés. Les kilométrages
   des quatre motos de référence reprennent l'état historique du 6/11/2026
   (aucun nom, montant réel, téléphone ni coordonnée).
   Exécution : node tests/moto/carburant-autonomie.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../../moto/moto-carburant-previsionnel.js');
const C = require('../../moto/moto-core.js');

const H = 3600000, J = 24 * H;
const T0 = Date.parse('2026-11-10T08:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const plein = (id, t, km, l, just = 'VERIFIE', extra = {}) => ({ id, moto_id: 'm', date_achat: iso(t), created_at: iso(t), compteur_km: km, litres: l, plein_complet: true, justificatif_statut: just, ...extra });
const complement = (id, t, km, l, just = 'VERIFIE') => ({ id, moto_id: 'm', date_achat: iso(t), created_at: iso(t), compteur_km: km, litres: l, plein_complet: false, justificatif_statut: just });
const moto = (km, releveMs, extra = {}) => ({ id: 'm', code: 'MOTO-T', beneficiaire_nom: 'Agent A', compteur_actuel_km: km, dernier_releve_at: releveMs == null ? null : iso(releveMs), mise_en_service_at: iso(T0 - 10 * J), ...extra });
const ev = (o) => F.evaluerMoto({ maintenant: iso(T0), missions: [], planning: [], ...o });
// Moto suivie 4 jours à 60 km/jour : plein vérifié à 0 km il y a 4 jours.
const rythme60 = (kmActuel, extraAchats = []) => ({ moto: moto(kmActuel, T0 - H), achats: [plein('p0', T0 - 4 * J, kmActuel - 240, 12)].concat(extraAchats) });
const plan = (j1, j2, extra = []) => [{ moto_id: 'm', jour: iso(T0).slice(0, 10), km: j1 }, { moto_id: 'm', jour: iso(T0 + J).slice(0, 10), km: j2 }].concat(extra);

let n = 0;
function test(nom, f) { f(); n++; console.log('OK ' + String(n).padStart(2, '0') + ' ' + nom); }

/* 1. Quatre motos de référence (état du 6/11/2026, reconstitué) */
test('1 · quatre motos historiques : stock, autonomie, plein conseillé', () => {
  const ref = [['MOTO-003', 231, 2, 9.95, 229, 4.92, 112], ['MOTO-004', 150, 5, 12.16, 145, 8.62, 196], ['MOTO-005', 57, 2, 11.05, 55, 12.58, 286], ['MOTO-006', 84, 2, 9.95, 82, 11.39, 259]];
  for (const [code, km, kp, l, depuis, reste, aut] of ref) {
    const tPlein = Date.parse('2026-11-04T17:15:00Z'), tRel = Date.parse('2026-11-06T12:00:00Z');
    const r = F.evaluerMoto({ maintenant: iso(tRel), moto: { id: code, code, compteur_actuel_km: km, dernier_releve_at: iso(tRel) },
      achats: [{ id: code, moto_id: code, date_achat: iso(tPlein), created_at: iso(tPlein), compteur_km: kp, litres: l, plein_complet: true, justificatif_statut: 'A_VERIFIER' }], missions: [] });
    assert.equal(r.km_depuis_plein, depuis, code);
    assert.equal(r.stock_l, reste, code);
    assert.equal(r.autonomie_km, aut, code);
  }
  const m3 = F.evaluerMoto({ maintenant: '2026-11-06T12:00:00Z', moto: { id: 'x', code: 'MOTO-003', compteur_actuel_km: 231, dernier_releve_at: '2026-11-06T09:30:00Z' },
    achats: [{ id: 'a', date_achat: '2026-11-04T17:15:00Z', compteur_km: 2, litres: 9.95, plein_complet: true, justificatif_statut: 'A_VERIFIER' }], missions: [] });
  assert.equal(m3.plein_conseille_l, 10.08);
  assert.equal(m3.cout_plein_fcfa, 9119);           // 10,076 L × 905 = 9 118,8 FCFA (mandat : ~9 119)
  assert.equal(m3.statut, 'CRITIQUE');              // 229 km en ~1,7 jour : autonomie < besoin des 24 h
  assert.equal(m3.fiabilite, 'MOYENNE');            // plein non vérifié, historique < 3 jours
});

test('2 · réservoir initial : plein au compteur actuel = 15 L, pas 15 L + achat', () => {
  const r = ev({ moto: moto(500, T0 - H), achats: [plein('p', T0 - H, 500, 11)] });
  assert.equal(r.stock_l, 15); assert.equal(r.plein_conseille_l, 0); assert.equal(r.autonomie_km, 341);
});

test('3 · compteur qui augmente : 100 km consomment 4,4 L', () => {
  const r = ev(rythme60(340));
  assert.equal(r.km_depuis_plein, 240);
  assert.equal(r.stock_l, 4.44);                   // 15 − 240 × 0,044
  assert.equal(ev({ moto: moto(100, T0 - H), achats: [plein('p', T0 - 2 * J, 0, 9)] }).stock_l, 10.6);
});

test('4 · plein complémentaire : retour à 15 L sans additionner les litres', () => {
  const r = ev({ moto: moto(300, T0 - H), achats: [plein('a', T0 - 4 * J, 0, 12), plein('b', T0 - J, 250, 11)] });
  assert.equal(r.dernier_plein.compteur_km, 250);
  assert.equal(r.stock_l, 12.8);                   // 15 − 50 × 0,044
});

test('5 · ravitaillements successifs reconstitués chronologiquement', () => {
  const achats = [complement('c2', T0 - J, 200, 3), plein('a', T0 - 4 * J, 0, 12), complement('c1', T0 - 2 * J, 100, 2)];
  const r = ev({ moto: moto(260, T0 - H), achats });
  // 15 − 4,4 + 2 = 12,6 ; − 4,4 + 3 = 11,2 ; − 60 km (2,64) = 8,56
  assert.equal(r.stock_l, 8.56);
  assert.deepEqual(r.evenements.map((e) => e.type), ['PLEIN', 'COMPLEMENT', 'COMPLEMENT']);
  const deborde = ev({ moto: moto(20, T0 - H), achats: [plein('a', T0 - 2 * J, 0, 12), complement('c', T0 - J, 10, 5)] });
  assert.equal(deborde.stock_l, 14.56);            // plafonné à 15 L au complément, puis 10 km
  assert.ok(deborde.points_a_verifier.some((x) => /supérieur à la place disponible/.test(x)));
  const doublon = ev({ moto: moto(260, T0 - H), achats: achats.concat([complement('c1', T0 - 2 * J, 100, 2)]) });
  assert.equal(doublon.stock_l, 8.56);              // même identifiant compté une seule fois
});

test('6 · seuil d\'alerte dynamique : 60 + 60 km → 2,64 + 2,64 = 5,28 L', () => {
  const r = ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 800, 12)], planning: plan(60, 60) });
  assert.equal(r.source_km, 'PLANNING');
  assert.equal(r.besoin_24h_l, 2.64); assert.equal(r.stock_securite_l, 2.64); assert.equal(r.seuil_alerte_l, 5.28);
  const a = ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 785, 12)], planning: plan(60, 60) });   // 15 − 9,46 = 5,54 L
  assert.equal(a.statut, 'RAVITAILLEMENT_A_PLANIFIER');
  const b = ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 790, 12)], planning: plan(60, 60) });   // 5,76 L > 5,28 mais 5,76 − 2,64 < 5,28
  assert.equal(b.statut, 'RAVITAILLEMENT_A_PLANIFIER');
  assert.ok(/moins de 24 h/.test(b.justification[0]));
  const c = ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 900, 12)], planning: plan(60, 60) });    // 10,6 L
  assert.equal(c.statut, 'NORMAL');
});

test('7 · réserve de sécurité atteinte → critique ; juste au-dessus → à planifier', () => {
  assert.equal(ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 720, 12)], planning: plan(60, 60) }).statut, 'RAVITAILLEMENT_A_PLANIFIER');   // 2,68 L > 2,64 L
  const r = ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 715, 12)], planning: plan(60, 60) });    // 15 − 285 × 0,044 = 2,46 L ≤ 2,64 L
  assert.equal(r.statut, 'CRITIQUE');
  assert.equal(r.ravitaillement_propose, true);
  assert.equal(r.plein_conseille_l, 12.54); assert.equal(r.cout_plein_fcfa, 11349);
  assert.equal(r.minimum_pour_seuil_l, 2.82);      // distinct du volume pour refaire le plein
});

test('8 · autonomie insuffisante pour la mission du jour, besoin supérieur au réservoir', () => {
  const r = ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 880, 12)], planning: plan(300, 20) });   // 9,72 L : 221 km < 300 km
  assert.equal(r.statut, 'CRITIQUE'); assert.ok(/inférieure aux 300 km/.test(r.justification[0]));
  const d = ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - J, 1000, 12)], planning: plan(200, 200) });     // 8,8 + 8,8 > 15
  assert.equal(d.depasse_reservoir, true); assert.equal(d.statut, 'RAVITAILLEMENT_A_PLANIFIER');
  const e = ev({ moto: moto(1000, T0 - H), achats: [plein('p', T0 - J, 1000, 12)], planning: plan(400, 0) });       // 17,6 L en un jour
  assert.equal(e.statut, 'CRITIQUE'); assert.ok(/plus que le réservoir/.test(e.justification[0]));
});

test('9 · mission annulée : sans effet sur le besoin', () => {
  const base = { moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 900, 12)] };
  const r = ev({ ...base, planning: plan(60, 60, [{ moto_id: 'm', jour: iso(T0).slice(0, 10), km: 500, annule: true }]) });
  assert.equal(r.km_24h, 60); assert.equal(r.planning_annules, 1);
  const s = ev({ ...base, planning: [{ moto_id: 'm', jour: iso(T0).slice(0, 10), km: 500, statut: 'ANNULEE' }] });
  assert.notEqual(s.km_24h, 500);
});

test('10 · distance manquante : historique, puis référentiel signalé', () => {
  const r = ev({ ...rythme60(500), planning: plan(null, null) });
  assert.equal(r.source_km, 'HISTORIQUE'); assert.equal(r.km_24h, 60.6);  // 240 km / 3,96 jours
  const s = ev({ moto: moto(500, T0 - H), achats: [plein('p', T0 - H, 500, 12)] });   // aucun km parcouru, aucun planning
  assert.equal(s.source_km, 'REFERENTIEL'); assert.equal(s.km_24h, 70);
  assert.equal(s.statut, 'DONNEES_A_VERIFIER'); assert.equal(s.calcul_provisoire, true);
});

test('10 bis · absence de mission ≠ absence de déplacement', () => {
  const r = ev({ moto: moto(180, T0 - H), achats: [plein('p', T0 - 3 * J, 0, 12)], missions: [] });
  assert.equal(r.source_km, 'HISTORIQUE'); assert.ok(r.km_24h > 0);
});

test('11 · compteur incohérent : données à vérifier, sans conclusion', () => {
  const a = ev({ moto: moto(40, T0 - H), achats: [plein('p', T0 - J, 100, 12)] });
  assert.equal(a.statut, 'DONNEES_A_VERIFIER'); assert.equal(a.stock_l, null); assert.equal(a.fiabilite, 'INSUFFISANTE');
  const b = ev({ moto: moto(100, T0 - H), achats: [plein('p', T0 - 2 * J, 0, 12), complement('c', T0 - J, 150, 2)] });
  assert.equal(b.statut, 'DONNEES_A_VERIFIER'); assert.ok(b.anomalies[0].includes('au-delà du compteur'));
  const c = ev({ moto: moto(400, T0 - H), achats: [plein('p', T0 - 4 * J, 0, 12)] });                // 400 km sans achat : 15 − 17,6
  assert.equal(c.statut, 'CRITIQUE'); assert.ok(c.anomalies.some((x) => /aucune faute présumée/.test(x)));
});

test('12 · synchronisation tardive signalée, fiabilité faible', () => {
  const r = ev({ moto: moto(200, T0 - H), achats: [plein('p', T0 - 5 * J, 0, 12, 'VERIFIE', { created_at: iso(T0 - J) })] });
  assert.ok(r.points_a_verifier.some((x) => /tardivement/.test(x)));
  assert.equal(r.fiabilite, 'FAIBLE');
});

test('13 · justificatif en attente : calcul conservé, fiabilité moyenne', () => {
  const r = ev({ moto: moto(200, T0 - H), achats: [plein('p', T0 - 4 * J, 0, 12, 'A_VERIFIER')] });
  assert.equal(r.stock_l, 6.2); assert.equal(r.fiabilite, 'MOYENNE');
  const v = ev({ moto: moto(200, T0 - H), achats: [plein('p', T0 - 4 * J, 0, 12, 'VERIFIE')] });
  assert.equal(v.fiabilite, 'BONNE');
  const rejete = ev({ moto: moto(200, T0 - H), achats: [plein('p', T0 - 4 * J, 0, 12, 'REJETE')] });
  assert.equal(rejete.stock_l, null);                                  // un plein rejeté ne sert pas d'ancre
});

test('14 · moto sans relevé récent → données à vérifier', () => {
  const r = ev({ moto: moto(100, T0 - 72 * H), achats: [plein('p', T0 - 6 * J, 0, 12)] });
  assert.equal(r.statut, 'DONNEES_A_VERIFIER'); assert.ok(r.points_a_verifier.some((x) => /plus de 48 h/.test(x)));
  const sans = ev({ moto: moto(100, null), achats: [plein('p', T0 - 6 * J, 0, 12)] });
  assert.equal(sans.statut, 'DONNEES_A_VERIFIER');
  const aucunPlein = ev({ moto: moto(100, T0 - H), achats: [complement('c', T0 - J, 50, 3)] });
  assert.equal(aucunPlein.stock_l, null); assert.ok(/Aucun plein complet/.test(aucunPlein.justification[0]));
});

test('15 · changement de planning : recalcul immédiat du statut', () => {
  const base = { moto: moto(1000, T0 - H), achats: [plein('p', T0 - 4 * J, 880, 12)] };   // 9,72 L
  assert.equal(ev({ ...base, planning: plan(60, 60) }).statut, 'NORMAL');
  assert.equal(ev({ ...base, planning: plan(120, 120) }).statut, 'RAVITAILLEMENT_A_PLANIFIER');
  assert.equal(ev({ ...base, planning: plan(250, 60) }).statut, 'CRITIQUE');
});

test('15 bis · mission ouverte : km non encore relevés déduits prudemment', () => {
  const sans = ev(rythme60(340));
  const avec = ev({ ...rythme60(340), missions: [{ moto_id: 'm', statut: 'OUVERTE', depart_at: iso(T0 - 6 * H), km_depart: 340 }] });
  assert.ok(avec.stock_l < sans.stock_l); assert.equal(avec.km_en_cours_estimes, 2.5);    // depuis le dernier relevé (1 h), pas depuis le départ : 60,6 km/j × 1 h
  const vieille = ev({ ...rythme60(340), missions: [{ moto_id: 'm', statut: 'OUVERTE', depart_at: iso(T0 - 3 * J), km_depart: 200 }] });
  assert.ok(vieille.points_a_verifier.some((x) => /Mission ouverte/.test(x)));
});

test('16 · aucune double notification ; aggravation et jour suivant notifiés', () => {
  const l = [{ moto_id: 'm', code: 'MOTO-T', statut: 'RAVITAILLEMENT_A_PLANIFIER' }, { moto_id: 'n', code: 'MOTO-U', statut: 'NORMAL' }];
  const a = F.historiserAlertes({}, l, iso(T0));
  assert.equal(a.nouvelles.length, 1);
  const b = F.historiserAlertes(a.journal, l, iso(T0 + 2 * H));
  assert.equal(b.nouvelles.length, 0); assert.equal(Object.values(b.journal)[0].occurrences, 2);
  const c = F.historiserAlertes(b.journal, [{ moto_id: 'm', code: 'MOTO-T', statut: 'CRITIQUE' }], iso(T0 + 3 * H));
  assert.equal(c.nouvelles.length, 1);
  const d = F.historiserAlertes(c.journal, [{ moto_id: 'm', code: 'MOTO-T', statut: 'CRITIQUE' }], iso(T0 + J));
  assert.equal(d.nouvelles.length, 1);
  const purge = F.historiserAlertes(d.journal, [], iso(T0 + 30 * J));
  assert.equal(Object.keys(purge.journal).length, 0);
});

test('17 · droits : section réservée aux rôles « pilotage », aucun effet d\'écriture', () => {
  for (const cl of ['BM', 'ABM', 'LOGISTIQUE', 'ZONE', 'FINANCE', 'DIRECTION']) assert.equal(C.peut(cl, 'pilotage'), true, cl);
  assert.equal(C.peut('UNITE', 'pilotage'), false);
  assert.equal(C.peut(null, 'pilotage'), false);
  const app = fs.readFileSync(path.join(__dirname, '../../moto/moto-app.js'), 'utf8');
  const debut = app.indexOf('/* -- C bis. CARBURANT'), fin = app.indexOf('/* -- D. FORMATION');
  assert.ok(debut > 0 && fin > debut);
  const bloc = app.slice(debut, fin);
  assert.ok(!/\brpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|storage\.from/.test(bloc), 'le bloc carburant ne doit rien écrire');
  assert.ok(/peut\('pilotage'\)/.test(bloc));
  const moteur = fs.readFileSync(path.join(__dirname, '../../moto/moto-carburant-previsionnel.js'), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|supabase|localStorage/.test(moteur), 'moteur sans réseau ni stockage');
});

test('18 · flotte : comptage, classement par urgence puis autonomie', () => {
  const fl = [
    { id: 'a', code: 'MOTO-A', compteur_actuel_km: 100, dernier_releve_at: iso(T0 - H), mise_en_service_at: iso(T0 - 9 * J) },
    { id: 'b', code: 'MOTO-B', compteur_actuel_km: 330, dernier_releve_at: iso(T0 - H), mise_en_service_at: iso(T0 - 9 * J) },
    { id: 'c', code: 'MOTO-C', compteur_actuel_km: 50, dernier_releve_at: null, mise_en_service_at: iso(T0 - 9 * J) },
    { id: 'd', code: 'MOTO-D', compteur_actuel_km: 0, dernier_releve_at: null, statut_affectation: 'NON_AFFECTEE' }];
  const carb = [{ id: 1, moto_id: 'a', date_achat: iso(T0 - 4 * J), compteur_km: 0, litres: 9, plein_complet: true, justificatif_statut: 'VERIFIE' },
    { id: 2, moto_id: 'b', date_achat: iso(T0 - 4 * J), compteur_km: 0, litres: 9, plein_complet: true, justificatif_statut: 'VERIFIE' }];
  const r = F.evaluerFlotte({ flotte: fl, carburant: carb, missions: [], planning: [], maintenant: iso(T0) });
  assert.equal(r.synthese.suivies, 3);              // MOTO-D non affectée, sans achat : non suivie
  assert.deepEqual(r.lignes.map((l) => l.code), ['MOTO-B', 'MOTO-C', 'MOTO-A']);
  assert.deepEqual([r.synthese.critique, r.synthese.donnees, r.synthese.normal], [1, 1, 1]);
});

test('paramètres : 4 L + 10 % = 4,4 L/100 km ; valeurs invalides refusées', () => {
  assert.equal(F.parametres().conso_prudente, 4.4);
  assert.throws(() => F.evaluerMoto({ moto: moto(1, T0) }, { capacite_l: 0 }));
  assert.throws(() => F.evaluerMoto({ moto: moto(1, T0) }, { prix_fcfa_l: -5 }));
});

console.log('VALIDÉ : ' + n + ' tests du moteur Carburant & Autonomie.');
