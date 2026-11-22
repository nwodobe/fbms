// FBMS · formulaire de parcelle du Farmer Passport après la simplification du 21/11/2026.
// Contrôles STATIQUES (lecture du code) : ils ne remplacent ni le test navigateur ni la recette sur téléphone.
// Lancer : node --test tests/cartographie/formulaire-parcelle-simplifie-static.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ops = readFileSync(new URL('../../shared/farmer-registry-operations.js', import.meta.url), 'utf8');
const debut = ops.indexOf('function plotForm(id){'), fin = ops.indexOf('function plotNameKey(v){');
const form = ops.slice(debut, fin), save = ops.slice(ops.indexOf('async function savePlot('), ops.indexOf('function productionForm('));
test('le formulaire existe et se termine par un seul bouton « Enregistrer »', () => {
  assert.ok(debut > 0 && fin > debut);
  /* Un seul bouton d'enregistrement. Depuis le 22/11/2026 (demande du Branch Manager), le formulaire porte aussi le
     bouton du consentement GPS, qui n'enregistre rien : il ouvre le parcours de la plantation. */
  assert.equal((form.match(/<button/g) || []).length, 2);
  assert.equal((form.match(/onclick="saveFarmerPlot/g) || []).length, 1);
  assert.equal((form.match(/onclick="ouvrirConsentementParcelle/g) || []).length, 1);
  assert.match(form, />Enregistrer<\/button>/);
  assert.doesNotMatch(ops, /Enregistrer sans cartographie|Enregistrer puis ouvrir Esri/);
});
test('le champ « Notes parcelle » et l\'encadré Rainforest Alliance ne sont plus affichés', () => {
  assert.doesNotMatch(form, /Notes parcelle|frPlot_notes/);
  assert.doesNotMatch(form, /Carte de plantation · Rainforest Alliance|l\\'éditeur Esri vous permet/);
});
test('les notes historiques (dont FBMS-AUTO-PROVISOIRE) sont conservées à l\'enregistrement, jamais effacées', () => {
  assert.match(save, /notes:old\.notes!=null\?old\.notes:null/);
  assert.doesNotMatch(save, /notes:value\('frPlot_notes'\)/);
});
test('les champs techniques GPS ne sont plus visibles ni saisissables', () => {
  for (const libelle of ['Latitude', 'Longitude', 'Précision GPS', 'Horodatage GPS', 'Statut GPS', 'Superficie GPS vérifiée (ha)'])
    assert.doesNotMatch(form, new RegExp("field\\('" + libelle.replace(/[()]/g, '\\$&')), libelle);
  assert.doesNotMatch(form, /selectField\('Statut GPS'/);
  assert.doesNotMatch(form, /captureFarmerGps\(/);
  assert.match(form, /hidden\('frGps_lat',row\.latitude\)/);
});
test('une parcelle déjà connue du serveur ne renvoie plus sa position ni son état de cartographie', () => {
  assert.match(save, /if\(old\.id\)\['latitude','longitude','gps_accuracy_m','gps_captured_at','gps_status'/);
});
test('la superficie vérifiée reste réservée à la supervision et n\'est jamais remplie automatiquement', () => {
  assert.match(form, /supervisor\(\)\?'<details class="fr-supervision">/);
  assert.match(save, /gps_verified_area:supervisor\(\)&&value\('frPlot_verifiedArea'\)\?numberValue\('frPlot_verifiedArea'\):old\.gps_verified_area\|\|null/);
});
test('après enregistrement confirmé par le serveur : parcours intégré, même identifiant (pas de doublon)', () => {
  assert.match(save, /result&&result\._sync_status==='SYNCED'/);
  assert.match(save, /global\.location\.hash='#parcelles\/parcours\/'\+encodeURIComponent\(id\)/);
  assert.match(save, /cartographie à compléter/);
  assert.match(save, /similarPlot\(data\(\)\.plots,row\)/);
});

/* 22/11/2026 : statut et bouton du consentement GPS visibles directement dans le formulaire Parcelles. */
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../shared/farmer-registry-operations.js', import.meta.url), 'utf8');
  const assert = (await import('node:assert/strict')).default;
  const f = src.slice(src.indexOf('function plotForm('), src.indexOf('function ouvrirConsentementParcelle('));
  assert.match(f, /id="frPlotConsent"/, 'bloc consentement dans le formulaire');
  assert.match(f, /peindreConsentementParcelle\(!!id,row\.id\)/, 'statut chargé à l\'ouverture du formulaire');
  assert.match(f, /from\('farmer_consents'\)/, 'statut lu dans le registre de consentement');
  assert.match(f, /non vérifiable hors connexion \(aucun accord n’est présumé\)/, 'hors ligne : rien de présumé');
  assert.match(f, /scopes\.gps===true/, 'seule la portée GPS accordée compte');
  assert.match(src, /#parcelles\/parcours\/'\+encodeURIComponent\(plotId\)/, 'le bouton ouvre le parcours (accord, capture, carte)');
  console.log('RÉUSSI  consentement GPS visible dans le formulaire Parcelles');
}
