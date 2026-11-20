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

const ok = R.filter(r => r.resultat === 'RÉUSSI').length;
fs.mkdirSync(path.join(__dirname, 'resultats'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'resultats', 'coeur.json'), JSON.stringify({ total: R.length, reussis: ok, echoues: R.length - ok, tests: R }, null, 1));
console.log(`Cœur cartographie : ${R.length} tests, ${ok} réussis, ${R.length - ok} échoués.`);
process.exit(ok === R.length ? 0 : 1);
