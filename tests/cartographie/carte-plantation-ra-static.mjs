import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const base = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path,base),'utf8');
const docsSource = read('operations/carte-plantation.js');
const operationsSource = read('shared/farmer-registry-operations.js');
const parcelsSource = read('operations/parcelles.js');
const fieldSource = read('operations/field-buying.js');
const html = read('operations/field-buying.html');
const sw = read('sw.js');

const window = {};
window.window = window;
vm.runInNewContext(docsSource,{ window, console });
const generator = window.ANAGROCI_CARTE_PLANTATION;
assert.ok(generator, 'Plantation document engine must be registered');

const plot = {plot_id:'plot-1', plot_code:'BKE-01', producteur_code:'P-100',
 producteur_nom:'KOFFI', producteur_prenoms:'TEST', village_nom:'BROBO',
 cluster_code:'BROBO', declared_area:2, area_unit:'HA', consentement_gps:true};
const geometry = {id:'geometry-1',plot_id:'plot-1',version_no:2,status:'VALIDE',
 method:'SATELLITE',gps_points:0,producer_confirmation:'CONFIRMEE_SUR_PLACE',
 area_m2:19800,perimeter_m:590,created_at:'2026-11-20T11:00:00Z',
 geojson:{type:'Polygon',coordinates:[[[-5.2,7.8],[-5.19,7.8],[-5.19,7.81],[-5.2,7.8]]]}};
const data = JSON.parse(JSON.stringify(generator.geojson(plot,geometry)));
assert.equal(data.type,'FeatureCollection');
assert.equal(data.features[0].geometry.type,'Polygon');
assert.equal(data.features[0].properties.geometry_version,2);
assert.equal(data.features[0].properties.farm_unit_id,null,'Never invent a Rainforest Alliance farm unit identifier');
assert.equal(data.features[0].properties.crs,'EPSG:4326');
assert.match(data.features[0].properties.qualification,/terrain/);
const pdf = generator.html(plot,geometry);
assert.match(pdf,/CARTE DE PLANTATION/);
assert.match(pdf,/VALIDÉ FBMS/);
assert.match(pdf,/Rainforest Alliance/);
assert.match(pdf,/vectorielle/);
assert.doesNotMatch(pdf,/<img[^>]*src=["']https?:/);
assert.doesNotMatch(pdf,/static-map-tiles-api\.arcgis\.com|World_Imagery\/MapServer/);
assert.doesNotMatch(pdf,/certifié par Rainforest Alliance/i);
assert.throws(()=>generator.geojson({...plot,consentement_gps:false},geometry),/Export interdit/);
assert.throws(()=>generator.html(plot,{...geometry,plot_id:'plot-2'}),/Aucun contour/);
assert.throws(()=>generator.geojson(plot,{...geometry,geojson:{type:'Point',coordinates:[-5.2,7.8]}}),/Export interdit/);
assert.match(generator.qualification({...geometry,status:'SOUMIS'}),/PROVISOIRE/);
assert.match(generator.qualification({...geometry,gps_points:3,method:'GPS_POINTS'}),/références terrain à contrôler/);
assert.match(generator.qualification({...geometry,ra_statut_preparation:'REVUE_DOCUMENTAIRE_RA_REQUISE',ra_references_confirmees:2}),/revue documentaire/);
assert.equal(JSON.parse(JSON.stringify(generator.geojson(plot,{...geometry,ra_statut_preparation:'REVUE_DOCUMENTAIRE_RA_REQUISE',ra_references_confirmees:2}))).features[0].properties.ground_references_confirmed,2);
assert.doesNotMatch(generator.qualification({...geometry,ra_statut_preparation:'REFERENCES_TERRAIN_A_CONFIRMER',gps_points:99}),/revue documentaire/);
assert.match(operationsSource,/Enregistrer puis ouvrir Esri/);
assert.match(operationsSource,/global\.location\.hash='#parcelles\/tracer\/'/);
assert.match(operationsSource,/result&&result\._sync_status==='SYNCED'/);
assert.match(fieldSource,/Carte de plantation · Esri/);
assert.match(parcelsSource,/ANAGROCI_CARTE_PLANTATION/);
assert.match(parcelsSource,/peutPiloter\(\) && consent && geomDoc/);
assert.match(parcelsSource,/plot_id,version_no,status,method/);
assert.match(html,/carte-plantation\.js\?v=20261120-ra-preuves-2/);
assert.match(sw,/ops-offline-v30-ra-docs/);
assert.match(sw,/operations\/carte-plantation\.js/);
console.log('PASS: mapping Esri depuis nouvelle parcelle, consentement GPS, statut RA et documents vectoriels.');
