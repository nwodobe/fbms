/* REPÈRES GPS · tests du cœur (validation des coordonnées, opération, point dans un contour).
   Lancer : node tests/reperes-gps/coeur.test.cjs
   Données fictives uniquement (coordonnées inventées autour de 7,69 ; -5,03). */
'use strict';
const assert = require('assert');
const C = require('../../shared/reperes-gps-coeur.js');
let n = 0;
function cas(nom, f) { f(); n++; console.log('ok ' + n + ' · ' + nom); }

cas('le point et la virgule sont acceptés, la valeur est identique', () => {
  const a = C.lireCoordonnees('7.689512', '-5.031245'), b = C.lireCoordonnees('7,689512', '-5,031245');
  assert.ok(a.ok && b.ok);
  assert.strictEqual(a.latitude, 7.689512); assert.strictEqual(b.latitude, 7.689512);
  assert.strictEqual(a.longitude, -5.031245); assert.strictEqual(b.longitude, -5.031245);
  assert.deepStrictEqual(a.alertes, []);
});
cas('la longitude négative est préservée (signe ASCII, signe typographique, espaces)', () => {
  assert.strictEqual(C.lireCoordonnees(' 7,689512 ', ' -5,031245 ').longitude, -5.031245);
  assert.strictEqual(C.lireCoordonnees('7,689512', '−5,031245').longitude, -5.031245);
  assert.strictEqual(C.lireCoordonnees('+7,689512', '-5,031245').latitude, 7.689512);
});
cas('aucune correction silencieuse : signe oublié = alerte, valeur inchangée', () => {
  const r = C.lireCoordonnees('7,689512', '5,031245');
  assert.ok(r.ok); assert.strictEqual(r.longitude, 5.031245); assert.ok(r.horsZone);
  assert.match(r.alertes[0], /signe moins devant la longitude/);
  assert.match(r.alertes[0], /Rien n'a été modifié/);
});
cas('aucune permutation silencieuse : inversion = alerte, valeurs inchangées', () => {
  const r = C.lireCoordonnees('-5,031245', '7,689512');
  assert.ok(r.ok); assert.strictEqual(r.latitude, -5.031245); assert.strictEqual(r.longitude, 7.689512);
  assert.ok(r.horsZone); assert.match(r.alertes[0], /semblent inversées/);
});
cas('bornes : latitude de -90 à 90, longitude de -180 à 180', () => {
  assert.match(C.lireCoordonnees('90,1', '-5').erreurs.latitude, /entre -90 et 90/);
  assert.match(C.lireCoordonnees('7', '-180,5').erreurs.longitude, /entre -180 et 180/);
  assert.ok(C.lireCoordonnees('-90', '180').ok);
  assert.ok(C.lireCoordonnees('90', '-180').ok);
});
cas('0 ; 0 n\'est jamais une position', () => {
  const r = C.lireCoordonnees('0', '0');
  assert.ok(!r.ok); assert.match(r.erreurs.general, /n'est pas une position/);
  assert.ok(!C.lireCoordonnees('0,0', '0.000').ok);
  assert.ok(C.lireCoordonnees('0', '-5,5').ok, 'une latitude nulle seule reste un nombre valide');
});
cas('champ vide ou illisible : erreur expliquée, jamais une valeur par défaut', () => {
  assert.match(C.lireCoordonnees('', '-5').erreurs.latitude, /vide/);
  assert.match(C.lireCoordonnees('abc', '-5').erreurs.latitude, /format non accepté|illisible/);
  assert.match(C.lireCoordonnees('7', '').erreurs.longitude, /vide/);
});
cas('formats ambigus refusés : degrés-minutes, lettres, deux séparateurs, exposant', () => {
  assert.match(C.lireCoordonnees('7°41\'22"', '-5').erreurs.latitude, /degrés décimaux/);
  assert.match(C.lireCoordonnees('7.689512N', '-5').erreurs.latitude, /degrés décimaux/);
  assert.match(C.lireCoordonnees('7', '5.031245W').erreurs.longitude, /degrés décimaux/);
  assert.match(C.lireCoordonnees('7.689,512', '-5').erreurs.latitude, /deux séparateurs/);
  assert.ok(!C.lireCoordonnees('7e0', '-5').ok);
  assert.ok(!C.lireCoordonnees('7,689512 -5,031245', '-5').ok, 'deux nombres dans un seul champ');
});
cas('peu de décimales : alerte de précision, sans rien inventer', () => {
  const r = C.lireCoordonnees('7,7', '-5,0');
  assert.ok(r.ok); assert.ok(r.alertes.some((a) => /Peu de décimales/.test(a)));
});
cas('hors Côte d\'Ivoire : signalé, jamais refusé d\'office ni corrigé', () => {
  const r = C.lireCoordonnees('48,856613', '2,352222');
  assert.ok(r.ok && r.horsZone); assert.strictEqual(r.latitude, 48.856613);
});
cas('opération : origine, précision inconnue = null, clé d\'idempotence unique', () => {
  const o = C.operation({ type: 'ARBRE', id: 'a1' }, { latitude: 7.689512, longitude: -5.031245, origine: 'SAISIE_MANUELLE', source_externe: '  GPS de poche  ' }, { version_base: 0, device_id: 'REP-test' });
  assert.strictEqual(o.type, 'REPERE_ENREGISTRER');
  assert.strictEqual(o.payload.origine, 'SAISIE_MANUELLE');
  assert.strictEqual(o.payload.precision_m, null, 'une précision inconnue reste inconnue');
  assert.strictEqual(o.payload.releve_le, null, 'une date de relevé inconnue reste inconnue');
  assert.strictEqual(o.payload.source_externe, 'GPS de poche');
  assert.strictEqual(o.payload.latitude, 7.689512); assert.strictEqual(o.payload.longitude, -5.031245);
  const o2 = C.operation({ type: 'ARBRE', id: 'a1' }, { latitude: 7.689512, longitude: -5.031245, origine: 'SAISIE_MANUELLE' }, {});
  assert.notStrictEqual(o.idempotency_key, o2.idempotency_key);
  assert.match(o.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
cas('opération : une capture sans précision ou sans heure est refusée ; 0;0 et type inconnu aussi', () => {
  assert.throws(() => C.operation({ type: 'PARCELLE', id: 'p' }, { latitude: 7.6, longitude: -5.0, origine: 'GPS_APPAREIL' }, {}), /précision et son heure/);
  assert.throws(() => C.operation({ type: 'PARCELLE', id: 'p' }, { latitude: 0, longitude: 0, origine: 'SAISIE_MANUELLE' }, {}), /pas une position/);
  assert.throws(() => C.operation({ type: 'VILLAGE', id: 'p' }, { latitude: 7.6, longitude: -5.0, origine: 'SAISIE_MANUELLE' }, {}), /non précisé/);
  assert.throws(() => C.operation({ type: 'PARCELLE', id: 'p' }, { latitude: 7.6, longitude: -5.0, origine: 'DEVINE' }, {}), /Origine/);
});
cas('contour : sommets GeoJSON en [longitude, latitude], point en latitude/longitude nommées', () => {
  const carre = { type: 'Polygon', coordinates: [[[-5.0320, 7.6890], [-5.0300, 7.6890], [-5.0300, 7.6910], [-5.0320, 7.6910], [-5.0320, 7.6890]]] };
  const dedans = C.positionDansContour(7.6900, -5.0310, carre, null);
  assert.ok(dedans.connu && dedans.dedans && !dedans.signale);
  const loin = C.positionDansContour(7.6900, -5.0280, carre, null);
  assert.ok(!loin.dedans && loin.signale); assert.ok(loin.distance_m > 200 && loin.distance_m < 240, 'environ 220 m : ' + loin.distance_m);
  /* Ordre inversé : le même point, lu à l'envers, tomberait très loin. */
  assert.ok(C.positionDansContour(-5.0310, 7.6900, carre, null).signale);
});
cas('contour : tolérance = précision connue, sinon 10 m ; un point seul ne donne aucune surface', () => {
  const carre = { type: 'Polygon', coordinates: [[[-5.0320, 7.6890], [-5.0300, 7.6890], [-5.0300, 7.6910], [-5.0320, 7.6910], [-5.0320, 7.6890]]] };
  const pres = C.positionDansContour(7.6900, -5.02995, carre, null);   // ~5,5 m dehors
  assert.ok(!pres.dedans && !pres.signale && pres.tolerance_m === 10);
  const a20 = C.positionDansContour(7.6900, -5.02982, carre, null);    // ~20 m dehors
  assert.ok(a20.signale);
  assert.ok(!C.positionDansContour(7.6900, -5.02982, carre, 30).signale, 'précision annoncée de 30 m : toléré');
  assert.deepStrictEqual(C.positionDansContour(7.69, -5.03, null, null), { connu: false });
  assert.strictEqual(typeof C.surface, 'undefined', 'le cœur des repères ne calcule aucune superficie');
});
console.log('\n' + n + ' cas · tous conformes');
