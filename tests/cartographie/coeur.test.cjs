/* CARTOGRAPHIE DES PARCELLES — tests du cœur de calcul (Node, sans réseau).
   Coordonnées FICTIVES autour de 7,70° N / 5,03° O (aucune parcelle réelle).
   Références : superficies planes des formes construites (250 × 200 m = 50 000 m², etc.),
   recoupées par PostGIS (recette serveur G-01b à G-04b) ; tolérance 0,01 %. */
'use strict';
const C = require('../../shared/parcelles-coeur.js');
const geodesic = require('../../shared/vendor/geographiclib-geodesic-2.2.0.min.js');
const G = geodesic.Geodesic.WGS84;
const fs = require('fs'), path = require('path');
const R = [];
function t(id, libelle, fn) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r === true || (r && r.ok); detail = r && r.detail !== undefined ? r.detail : ''; } catch (e) { detail = e.message; }
  R.push({ id, libelle, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', detail: String(detail).slice(0, 200) });
  console.log((ok ? 'RÉUSSI  ' : 'ÉCHOUÉ  ') + id + ' ' + libelle + (ok ? '' : ' — ' + detail));
}
const LAT0 = 7.70, LON0 = -5.03;
function pt(x, y, ox = 0) { x += ox; const d = Math.hypot(x, y), az = Math.atan2(x, y) * 180 / Math.PI; const r = G.Direct(LAT0, LON0, az, d); return [r.lon2, r.lat2]; }
const forme = (pts, ox) => pts.map(([x, y]) => pt(x, y, ox));
const pres = (a, b, tol = 0.01) => ({ ok: Math.abs(a - b) / b * 100 < tol, detail: `obtenu ${a.toFixed(2)}, attendu ${b.toFixed(2)}` });
const RECT = forme([[0, 0], [250, 0], [250, 200], [0, 200]]);
const IRREG = forme([[0, 0], [180, -20], [310, 40], [360, 170], [300, 260], [190, 240], [120, 300], [30, 220], [-20, 110]], 1500);
const GRAND = forme([[0, 0], [520, 0], [520, 300], [260, 300], [260, 180], [0, 180]], 3000);
const PETIT = forme([[0, 0], [50, 0], [50, 50], [0, 50]], 4500);

t('JS-01', 'Rectangle 250 × 200 m : 5,00 ha (géodésique WGS84)', () => pres(C.mesurer(RECT).area_m2, 50000));
t('JS-02', 'Rectangle : périmètre 900 m', () => pres(C.mesurer(RECT).perimeter_m, 900));
t('JS-03', 'Champ irrégulier 9 sommets : 8,51 ha', () => pres(C.mesurer(IRREG).area_m2, 85100));
t('JS-04', 'Champ de plus de 10 ha (L) : 12,48 ha', () => pres(C.mesurer(GRAND).area_m2, 124800));
t('JS-05', 'Petite parcelle 50 × 50 m : 0,25 ha', () => pres(C.mesurer(PETIT).area_m2, 2500));
t('JS-06', 'Sens de parcours indifférent (horaire = antihoraire)', () => pres(C.mesurer(RECT.slice().reverse()).area_m2, C.mesurer(RECT).area_m2, 1e-9));
t('JS-07', 'Premier point répété en fin : même surface', () => pres(C.mesurer(RECT.concat([RECT[0]])).area_m2, C.mesurer(RECT).area_m2, 1e-9));
t('JS-08', 'Polygone auto-intersecté détecté', () => { const v = C.verifier(forme([[0, 0], [100, 100], [100, 0], [0, 100]])); return { ok: !v.ok && /croisent/.test(v.erreurs.join(' ')), detail: v.erreurs.join(' | ') }; });
t('JS-09', 'Polygone incomplet (2 sommets) refusé', () => { const v = C.verifier(forme([[0, 0], [50, 0]])); return { ok: !v.ok && /au moins 3/.test(v.erreurs[0]), detail: v.erreurs.join(' | ') }; });
t('JS-10', 'Points répétés consécutifs ignorés', () => C.nettoyer([RECT[0], RECT[0], RECT[1], RECT[2], RECT[3]]).length === 4);
t('JS-11', 'GeoJSON : anneau fermé, ordre longitude-latitude', () => { const g = C.geojson(RECT); const a = g.coordinates[0]; return g.type === 'Polygon' && a.length === 5 && a[0][0] === a[4][0] && a[0][0] < -4 && a[0][1] > 7; });
t('JS-12', 'Surface calculée sur les coordonnées réellement envoyées (arrondies)', () => pres(C.mesurer(C.geojson(RECT).coordinates[0]).area_m2, C.verifier(RECT).area_m2, 1e-9));
t('JS-13', 'Écart superficie déclarée 2 ha / mesurée 5 ha = +150 %', () => C.ecartDeclare(50000, 2, 'HA') === 150);
t('JS-14', 'Écart non calculé sans superficie déclarée (aucun chiffre inventé)', () => C.ecartDeclare(50000, null, 'HA') === null);
t('JS-15', 'Lectures GPS : les mauvaises lectures sont écartées, précision annoncée prudente', () => {
  const r = C.combinerLectures([{ lat: 7.7, lng: -5.03, precision: 5 }, { lat: 7.70001, lng: -5.03001, precision: 6 }, { lat: 7.71, lng: -5.04, precision: 60 }]);
  return { ok: r.lectures === 2 && r.precision === 6 && Math.abs(r.lat - 7.7) < 0.0001, detail: JSON.stringify(r) };
});
t('JS-16', 'Aucune lecture GPS valable : aucune position fabriquée', () => C.combinerLectures([{ lat: NaN, lng: 1, precision: 5 }]) === null);
t('JS-17', 'Statistiques de précision : min, médiane, max', () => { const s = C.statsPrecision([8, 3, 5]); return s.min === 3 && s.mediane === 5 && s.max === 8 && s.n === 3; });
t('JS-18', 'Libellés de synchronisation exigés par le mandat', () => C.ETATS.LOCAL === 'Enregistré sur ce téléphone' && C.ETATS.ATTENTE === 'En attente de synchronisation' && C.ETATS.RECU === 'Reçu par le serveur' && C.ETATS.CONFLIT === 'Conflit à résoudre');
t('JS-19', 'Import GeoJSON (Feature) : sommets lus', () => C.sommetsDepuisGeoJSON({ type: 'Feature', geometry: C.geojson(RECT) }).length === 4);
t('JS-20', 'Import GeoJSON : plusieurs contours refusés', () => { try { C.sommetsDepuisGeoJSON({ type: 'MultiPolygon', coordinates: [C.geojson(RECT).coordinates, C.geojson(PETIT).coordinates] }); return false; } catch (e) { return /plusieurs/.test(e.message); } });
t('JS-21', 'Import KML : polygone lu, même surface', () => {
  const kml = '<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>' + C.geojson(RECT).coordinates[0].map(c => c[0] + ',' + c[1] + ',0').join(' ') + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>';
  return pres(C.mesurer(C.sommetsDepuisKML(kml)).area_m2, 50000);
});
t('JS-22', 'Soumission : précision GPS, méthode et confiance transmises', () => {
  const v = C.verifier(RECT); const s = C.soumission('p', { methode: 'GPS_POINTS', confiance: 'PARTIELLES', sommets_gps: [{ precision: 4 }, { precision: 9 }, { precision: 6 }] }, v, 'dev');
  return s.method === 'GPS_POINTS' && s.gps_points === 3 && s.gps_accuracy_max_m === 9 && s.boundary_confidence === 'PARTIELLES' && s.area_m2_client > 49990;
});
t('JS-23', 'Export CSV : séparateur point-virgule, décimales à la française, BOM UTF-8', () => { const x = C.csv([{ a: 'Brobo', b: 2.5 }], [['a', 'Cluster'], ['b', 'Ha']]); return x.charCodeAt(0) === 0xfeff && x.includes('Cluster;Ha') && x.includes('Brobo;2,5'); });
t('JS-24', 'Contour hors Côte d\'Ivoire signalé', () => !C.verifier([[2.35, 48.85], [2.36, 48.85], [2.36, 48.86]]).ok);

/* ---- Gabarit de départ et transformations d'ensemble (parcours Parcelles du 21/11/2026) ---- */
const CENTRE = [-5.0297, 7.7003], GAB = C.gabarit(CENTRE);
t('JS-25', 'Gabarit : 4 sommets, carré de 70 m de côté (4 900 m², 280 m) autour du point', () => { const m = C.mesurer(GAB); return { ok: GAB.length === 4 && pres(m.area_m2, 4900, 1e-4) && pres(m.perimeter_m, 280, 1e-4), detail: m.area_m2 + ' m² · ' + m.perimeter_m + ' m' }; });
t('JS-26', 'Gabarit : côtés égaux et diagonales égales au centimètre (vrai carré sur l\'ellipsoïde)', () => { const c = [0, 1, 2, 3].map(i => C.distance(GAB[i], GAB[(i + 1) % 4])), d = [C.distance(GAB[0], GAB[2]), C.distance(GAB[1], GAB[3])]; return { ok: Math.max(...c) - Math.min(...c) < 0.01 && Math.abs(d[0] - d[1]) < 0.01 && Math.abs(c[0] - 70) < 0.01, detail: JSON.stringify(c.concat(d)) }; });
t('JS-27', 'Gabarit : ordre P1 nord-ouest, P2 nord-est, P3 sud-est, P4 sud-ouest ; centré sur le point', () => { const c = C.centroide(GAB); return GAB[0][0] < CENTRE[0] && GAB[0][1] > CENTRE[1] && GAB[1][0] > CENTRE[0] && GAB[1][1] > CENTRE[1] && GAB[2][0] > CENTRE[0] && GAB[2][1] < CENTRE[1] && GAB[3][0] < CENTRE[0] && GAB[3][1] < CENTRE[1] && C.distance(c, CENTRE) < 0.01; });
t('JS-28', 'Gabarit : contour valide (fermé, sans croisement, en Côte d\'Ivoire)', () => C.verifier(GAB).ok);
t('JS-29', 'Gabarit : la taille ne dépend d\'aucune superficie déclarée (fonction sans paramètre de superficie)', () => C.gabarit.length === 2 && JSON.stringify(C.gabarit(CENTRE)) === JSON.stringify(C.gabarit(CENTRE, undefined)));
t('JS-30', 'Gabarit : point illisible → aucun carré fabriqué', () => C.gabarit([NaN, 7]).length === 0);
t('JS-31', 'estGabarit : vrai pour le carré intact, faux dès qu\'un sommet bouge', () => { const m = GAB.map(p => p.slice()); m[2] = [m[2][0] + 0.00001, m[2][1]]; return C.estGabarit(GAB, CENTRE) && !C.estGabarit(m, CENTRE); });
t('JS-32', 'Déplacer : centre à l\'endroit demandé (500 m plus loin), superficie et périmètre conservés à 0,01 % près', () => {
  const irr = [[-5.0300, 7.7000], [-5.0285, 7.7002], [-5.0280, 7.7012], [-5.0292, 7.7018], [-5.0303, 7.7010]], a = C.mesurer(irr), cible = [-5.0252, 7.7030], d = C.deplacer(irr, cible), b = C.mesurer(d);
  return { ok: d.length === 5 && C.distance(C.centroide(d), cible) < 0.05 && pres(b.area_m2, a.area_m2, 1e-4) && pres(b.perimeter_m, a.perimeter_m, 1e-4), detail: a.area_m2 + ' → ' + b.area_m2 };
});
t('JS-33', 'Déplacer : chaque côté garde sa longueur au centimètre', () => { const irr = [[-5.0300, 7.7000], [-5.0285, 7.7002], [-5.0280, 7.7012], [-5.0303, 7.7010]], d = C.deplacer(irr, [-5.0260, 7.7040]); return irr.every((p, i) => Math.abs(C.distance(p, irr[(i + 1) % 4]) - C.distance(d[i], d[(i + 1) % 4])) < 0.01); });
t('JS-34', 'Échelle × 2 : superficie × 4, périmètre × 2, centre inchangé', () => { const e = C.echelle(GAB, 2), m = C.mesurer(e); return { ok: pres(m.area_m2, 19600, 1e-4) && pres(m.perimeter_m, 560, 1e-4) && C.distance(C.centroide(e), CENTRE) < 0.01, detail: m.area_m2 }; });
t('JS-35', 'Échelle : agrandir puis réduire du même facteur revient au contour d\'origine (au centimètre)', () => { const r = C.echelle(C.echelle(GAB, 1.15), 1 / 1.15); return r.every((p, i) => C.distance(p, GAB[i]) < 0.01); });
t('JS-36', 'Échelle : facteur nul ou négatif refusé (contour inchangé)', () => JSON.stringify(C.echelle(GAB, 0)) === JSON.stringify(C.nettoyer(GAB)) && JSON.stringify(C.echelle(GAB, -2)) === JSON.stringify(C.nettoyer(GAB)));
t('JS-37', 'Libellés : « Cartographie à compléter » et « Point GPS capturé » ; aucun libellé « vérifié » pour un simple point', () => C.STATUTS.NON_LOCALISEE === 'Cartographie à compléter' && /^Point GPS capturé/.test(C.STATUTS.LOCALISEE) && !/vérifi/i.test(C.STATUTS.LOCALISEE));
/* ---- Métadonnées d'imagerie Esri (réponses d'essai) ---- */
t('JS-38', 'Imagerie : date AAAAMMJJ, résolution et source lues (noms de champs ou alias)', () => { const a = C.metaImagerie({ results: [{ attributes: { SRC_DATE: 20230214, SRC_RES: 0.6, NICE_DESC: 'Source d\'essai' } }] }), b = C.metaImagerie({ results: [{ attributes: { 'DATE (YYYYMMDD)': '20221105', 'RESOLUTION (M)': '0.5', 'SOURCE': 'Autre essai' } }] }); return { ok: a.date === '2023-02-14' && a.resolution_m === 0.6 && a.source === 'Source d\'essai' && b.date === '2022-11-05' && b.resolution_m === 0.5 && a.fournisseur === 'Esri World Imagery', detail: JSON.stringify([a, b]) }; });
t('JS-39', 'Imagerie : code Esri 99999, zéro, date future ou impossible → aucune date (jamais inventée)', () => [99999, 0, '20991231', '20231345', 'null', '', null, '2023'].every(v => C.metaImagerie({ results: [{ attributes: { SRC_DATE: v, NICE_DESC: 'x' } }] }).date === null));
t('JS-40', 'Imagerie : réponse vide, erreur ou absente → null', () => C.metaImagerie(null) === null && C.metaImagerie({}) === null && C.metaImagerie({ results: [] }) === null && C.metaImagerie({ error: { code: 498 } }) === null);
t('JS-41', 'Imagerie : entre plusieurs couches, celle qui porte une date est retenue', () => C.metaImagerie({ results: [{ attributes: { SRC_DATE: 99999, NICE_DESC: 'sans date' } }, { attributes: { SRC_DATE: 20240301, SRC_RES: 0.3, NICE_DESC: 'avec date' } }] }).date === '2024-03-01');
t('JS-42', 'Soumission : date et source de l\'image transmises avec le contour', () => { const s = C.soumission('p', { methode: 'SATELLITE', confiance: 'VISIBLES', fond: 'Esri World Imagery', date_image: '2023-02-14' }, C.verifier(RECT), 'dev'); return s.imagery_date === '2023-02-14' && s.imagery_source === 'Esri World Imagery'; });

const ok = R.filter(r => r.resultat === 'RÉUSSI').length;
fs.mkdirSync(path.join(__dirname, 'resultats'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'resultats', 'coeur.json'), JSON.stringify({ total: R.length, reussis: ok, echoues: R.length - ok, tests: R }, null, 1));
console.log(`Cœur cartographie : ${R.length} tests, ${ok} réussis, ${R.length - ok} échoués.`);
process.exit(ok === R.length ? 0 : 1);
