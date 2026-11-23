// FBMS GPS consent: non-destructive static security/regression checks.
// Run: node --test tests/cartographie/consentement-gps-parcours.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fb = readFileSync(new URL('../../operations/field-buying.js',import.meta.url),'utf8');
const pc = readFileSync(new URL('../../operations/parcelles.js',import.meta.url),'utf8');
const html = readFileSync(new URL('../../operations/field-buying.html',import.meta.url),'utf8');
test('registration does not fabricate GPS consent',()=>{
  assert.doesNotMatch(fb,/function defaultConsentGps\(/);
  assert.match(fb,/une inscription au programme ne suffit pas/);
  assert.match(fb,/var choix = .*fbGpsDecision/);
  assert.match(fb,/if \(!\['ACCORDE','REFUSE','RETIRE'\]\.includes\(choix\)/);
});
test('consent event is explicit and scoped',()=>{
  assert.match(fb,/scopes\.gps = choix === 'ACCORDE'/);
  assert.match(fb,/\.from\('farmer_consents'\)\.insert\(/);
  assert.match(fb,/agent_id: profile\.userId, created_by: profile\.userId/);
  assert.match(fb,/source: 'FIELD_GPS_DECISION'/);
});
test('consent event is never backdated or bulk migrated',()=>{
  assert.match(fb,/consent_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(fb,/\.from\('farmer_consents'\)\.update\(/);
  assert.match(fb,/aucun accord présélectionné/i);
});
test('cannot claim success while offline',()=>{
  assert.match(fb,/Connexion obligatoire : aucune décision GPS/);
  assert.match(fb,/Décision GPS NON enregistrée/);
});
test('enrollment leads agent to the consent tab',()=>{
  assert.match(fb,/editRow \? '' : '\/consents'/);
  assert.match(fb,/confirmer le consentement GPS avec le producteur/);
});
/* Parcours Parcelles du 21/11/2026 : l'accord GPS se recueille DANS la rubrique Parcelles (plus de renvoi vers le
   passeport). Les garanties restent les mêmes : décision explicite, ajoutée à l'historique, jamais hors ligne. */
test('cartography collects the GPS decision inside Parcelles, never presumed',()=>{
  assert.doesNotMatch(pc,/Ouvrir le consentement du producteur/);
  assert.match(pc,/Pour localiser votre plantation et établir sa carte, nous avons besoin de votre accord pour enregistrer ses coordonnées géographiques\./);
  assert.match(pc,/data-v="ACCORDE" aria-pressed="false"/);
  assert.match(pc,/data-v="REFUSE" aria-pressed="false"/);
  assert.match(pc,/\.from\('farmer_consents'\)\.insert\(/);
  assert.doesNotMatch(pc,/\.from\('farmer_consents'\)\.(update|delete|upsert)\(/);
  assert.match(pc,/source: 'FIELD_GPS_DECISION'/);
  assert.match(pc,/agent_id: moi, created_by: moi/);
  assert.match(pc,/consent_at: new Date\(\)\.toISOString\(\)/);
  assert.match(pc,/if \(!enLigne\(\)\) return dire\('Connexion nécessaire : aucune décision GPS n\\'est enregistrée ni présumée hors ligne\.'\)/);
});
test('refusal or withdrawal blocks capture and the map',()=>{
  assert.match(pc,/if \(p\.accord\.etat !== 'ACCORDE'\) return parcours\(id\);/);
  assert.match(pc,/if \(!x\.consentement_gps\) return aller\('parcelles\/parcours\/' \+ id\);/);
  assert.match(pc,/La localisation et la carte de ce champ sont bloquées\. La parcelle reste enregistrée\./);
});
test('a captured point is never auto-verified',()=>{
  assert.doesNotMatch(pc,/gps_status\s*[:=]\s*'GPS_VERIFIED'/);
  assert.doesNotMatch(pc,/gps_verified_area/);
});
test('browser cache bust after code changes',()=>{
  assert.match(html,/field-buying\.js\?v=20261123-reperes-gps-1/);
  assert.match(html,/parcelles\.js\?v=20261123-reperes-gps-1/);
  assert.match(html,/parcelles-coeur\.js\?v=20261122-citations-1/);
  assert.match(html,/parcelles\.css\?v=20261122-parcours-1/);
});
test('imagery date comes from the public Esri citation service, never with the key',()=>{
  /* Régression constatée sur l'itel le 21/11/2026 : « identify » sur ibasemaps-api répond 404, la date restait « non disponible ». */
  const f = pc.slice(pc.indexOf('function metaImage('), pc.indexOf('function peindreMetaImage('));
  assert.match(pc,/ESRI_CITATIONS = 'https:\/\/services\.arcgisonline\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer'/);
  assert.match(f,/ESRI_CITATIONS \+ '\/identify\?'/);
  assert.doesNotMatch(f,/token/);
  assert.doesNotMatch(f,/ESRI_IMAGERIE/);
});
