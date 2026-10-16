#!/usr/bin/env node
/* Non-régression 2026-10-16 : feuille Producteurs_Detailles de la Sauvegarde Master
   (fbms/index.html). Les fonctions testées sont extraites telles quelles de la page,
   puis un vrai classeur .xlsx est écrit et relu avec SheetJS 0.18.5 (version de la page).
   Données synthétiques uniquement.
   Usage : npm install --no-save xlsx@0.18.5 && node tests/master-export-producteurs.mjs */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import XLSX from 'xlsx';

const html = readFileSync('fbms/index.html', 'utf8');
const debut = html.indexOf('function masterRow(');
const fin = html.indexOf('async function exportMaster(');
assert.ok(debut > 0 && fin > debut, 'fonctions Producteurs_Detailles introuvables dans fbms/index.html');
assert.match(html, /"Producteurs_Detailles"/, 'feuille Producteurs_Detailles absente de exportMaster');
assert.match(html, /"Producteurs_RAW"/, 'feuille Producteurs_RAW absente de exportMaster');
assert.match(html, /select\("\*"\)\.eq\("deleted", false\)/, 'la ligne producteurs complète (dont data) doit être lue');

const ctx = { XLSX };
vm.createContext(ctx);
vm.runInContext(html.slice(debut, fin), ctx);

const base = { nom: 'Test', village_nom: 'Village Test', rt_id: 'rt-1', deleted: false };
const producteurs = [
  { ...base, id: 'p1', code: 'TST-0001', data: { superficieHa: 5, nbArbres: 750, prodPrecKg: 3000, potentiel2027Kg: 3000, agePlantation: 45, anneesAnacarde: 45, engagementKg: 1000, autresCultures: 'Igname' } },
  { ...base, id: 'p2', code: 'TST-0002', data: { superficieHa: '0.50', nbArbres: '5 ANS', prodPrecKg: '0', engagementKg: '300' } },
  { ...base, id: 'p3', code: 'TST-0003', data: {} },
  { ...base, id: 'p4', code: 'TST-0004', data: { superficieHa: 9, nbArbres: 999 } },
  { ...base, id: 'p5', code: 'TST-0005', data: { superficieHa: 7, potentiel2027Kg: 9999, engagementKg: 7777 } },
  { ...base, id: 'p6', code: 'TST-0006', data: '{"superficieHa":"3,5","prodPrecKg":"700"}' },
];
const plots = [
  { producteur_id: 'p4', declared_area: 1.5, area_unit: 'HA', tree_count: 100, latitude: 7.1, longitude: -5.1, gps_status: 'GPS_VERIFIED', gps_verified_area: 1.4, status: 'ACTIVE', deleted: false },
  { producteur_id: 'p4', declared_area: 5000, area_unit: 'M2', tree_count: 50, status: 'ACTIVE', deleted: false },
  { producteur_id: 'p4', declared_area: 80, area_unit: 'HA', tree_count: 9000, status: 'ARCHIVED', deleted: false },
];
const baselines = [
  { producteur_id: 'p5', version: 1, status: 'DRAFT', productive_area_ha: 3, forecast_kg: 1000 },
  { producteur_id: 'p5', version: 2, status: 'FINAL', productive_area_ha: 4, forecast_kg: 2500, previous_production_kg: 2000 },
];

ctx.__in = { producteurs, plots, baselines };
const bytes = vm.runInContext(`(() => {
  const refs = masterAgriRefs(__in.plots, __in.baselines);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, masterDetailSheet(__in.producteurs.map(x => masterDetailRow(x, refs))), "Producteurs_Detailles");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(__in.producteurs.map(masterRow)), "Producteurs_RAW");
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
})()`, ctx);

const wb = XLSX.read(bytes, { type: 'buffer' });
assert.deepEqual(wb.SheetNames, ['Producteurs_Detailles', 'Producteurs_RAW']);
const ws = wb.Sheets.Producteurs_Detailles;
assert.ok(ws['!autofilter'], 'filtre automatique absent');
const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
assert.equal(rows.length, 6, 'une ligne par producteur attendue');
assert.equal(new Set(rows.map(r => r['Farmer ID'])).size, 6, 'Farmer ID dupliqué');
const R = Object.fromEntries(rows.map(r => [r['Farmer ID'], r]));
const SUP = 'Superficie anacarde (ha)', ARB = 'Nombre d’arbres', PREV = 'Production précédente (kg)', POT = 'Potentiel / prévision (kg)';

// Cellule réellement numérique dans le fichier (type 'n'), pas du texte
const hdr = XLSX.utils.sheet_to_json(ws, { header: 1 })[0];
const cSup = XLSX.utils.encode_cell({ r: 1, c: hdr.indexOf(SUP) });
assert.equal(ws[cSup].t, 'n', 'superficie doit être une cellule numérique Excel');

assert.equal(R['TST-0001'][SUP], 5); assert.equal(R['TST-0001'][ARB], 750); assert.equal(R['TST-0001'][PREV], 3000);
assert.equal(R['TST-0001'][POT], 3000); assert.equal(R['TST-0001']['Potentiel / prévision (MT)'], 3);
assert.equal(R['TST-0001']['Âge plantation (ans)'], 45); assert.equal(R['TST-0001']['Ancienneté anacarde (ans)'], 45);
assert.equal(R['TST-0001']['Autres cultures'], 'Igname'); assert.equal(R['TST-0001']['Rendement historique (kg/ha)'], 600);
assert.equal(R['TST-0001']['Engagement AFLP (kg)'], 1000);

assert.equal(R['TST-0002'][SUP], 0.5); assert.equal(R['TST-0002'][PREV], 0);
assert.equal(R['TST-0002'][ARB], null, '« 5 ANS » ne doit pas devenir un nombre d’arbres');
assert.match(String(R['TST-0002']['Saisies agricoles non numériques']), /5 ANS/);
assert.equal(R['TST-0002'][POT], null, 'engagementKg ne doit jamais servir de potentiel');

for (const h of [SUP, ARB, PREV, POT, 'Nombre de parcelles', 'Rendement historique (kg/ha)']) assert.equal(R['TST-0003'][h], null, 'absence convertie : ' + h);

assert.equal(R['TST-0004'][SUP], 2); assert.equal(R['TST-0004'][ARB], 150); assert.equal(R['TST-0004']['Nombre de parcelles'], 2);
assert.equal(R['TST-0004']['Parcelles GPS'], 1); assert.equal(R['TST-0004']['Superficie GPS vérifiée (ha)'], 1.4);

assert.equal(R['TST-0005'][SUP], 4); assert.equal(R['TST-0005'][POT], 2500); assert.equal(R['TST-0005'][PREV], 2000);
assert.equal(R['TST-0005']['Engagement AFLP (kg)'], 7777);

assert.equal(R['TST-0006'][SUP], 3.5); assert.equal(R['TST-0006'][PREV], 700);

const raw = XLSX.utils.sheet_to_json(wb.Sheets.Producteurs_RAW, { defval: null });
assert.equal(raw.length, 6); assert.match(String(raw[0].data), /superficieHa/, 'Producteurs_RAW doit conserver data');

console.log(JSON.stringify({ result: 'PASS', feuilles: wb.SheetNames, lignes: rows.length }));
