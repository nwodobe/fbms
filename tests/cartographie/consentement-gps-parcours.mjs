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
test('cartography still blocks unauthorized GPS and links to Passport',()=>{
  assert.match(pc,/if \(!consent\) actions \+= avis/);
  assert.match(pc,/Ouvrir le consentement du producteur/);
  assert.match(pc,/encodeURIComponent\(x\.producteur_id\) \+ '\/consents'/);
});
test('browser cache bust after code changes',()=>{
  assert.match(html,/field-buying\.js\?v=20261120-gps-consent-1/);
  assert.match(html,/parcelles\.js\?v=20261120-gps-consent-1/);
});
