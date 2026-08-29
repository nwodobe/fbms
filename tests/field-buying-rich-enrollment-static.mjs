import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('operations/field-buying.html');
const rich = read('operations/field-buying-rich-enrollment.js');
const css = read('operations/field-buying-rich-enrollment.css');

assert.ok(html.includes('field-buying-rich-enrollment.css'), 'rich enrollment CSS not loaded');
assert.ok(html.includes('field-buying-rich-enrollment.js'), 'rich enrollment JS not loaded');
assert.ok(html.indexOf('field-buying.js') < html.indexOf('field-buying-rich-enrollment.js'), 'rich layer must load after core engine');

for (const s of ['s1:', 's2:', 's3:', 's4:', 's5:', 's6:', 's7:', 's8:', 's9:']) {
  assert.ok(rich.includes(s), `historic village section missing: ${s}`);
}
for (const label of ['Identification', 'Localisation', 'Production', 'Accessibilité', 'Concurrence', 'Organisation', 'Paiement & risques', 'Validation']) {
  assert.ok(rich.includes(label), `village wizard section missing: ${label}`);
}
for (const label of ['Expérience achat RCN', 'Nombre de producteurs connus', 'Moyen de déplacement', 'Réputation locale', 'Niveau de risque']) {
  assert.ok(rich.includes(label), `RT enriched field missing: ${label}`);
}
for (const engine of ['farmer_possible_duplicates', 'farmer_registry_refresh_passport', 'farmer_plots', 'farmer_production_baselines', 'farmer_sustainability_baselines', 'farmer_consents', 'farmer_visits', 'farmer_inspections', 'farmer_verifications', 'farmer_action_plans']) {
  assert.ok(rich.includes(engine), `canonical Farmer Registry engine missing: ${engine}`);
}
for (const tab of ['Identité','Exploitation','Parcelles','Production','Sustainability','Consentements','Visites','Inspections','Achats','Lots / Traceability','Actions','Historique']) {
  assert.ok(rich.includes(tab), `Farmer Passport tab missing: ${tab}`);
}
assert.ok(/Parcelle à compléter après campagne/i.test(rich), '2027 parcel optional wording missing');
assert.ok(/parcelle, le GPS et Sustainability ne bloquent jamais/i.test(rich), '2027 non-blocking rule missing in producer flow');
assert.ok(!/villages_v2|rt_v2|producteurs_v2/.test(rich), 'parallel business tables are forbidden');
assert.ok(rich.includes('data-complete="1"'), 'progressive completeness tracking missing');
for (const level of ['Niveau 1', 'Niveau 2', 'Niveau 3']) assert.ok(rich.includes(level), `completion level missing: ${level}`);
assert.ok(css.includes('@media(max-width:620px)'), 'mobile 360/390/430 responsive layer missing');
assert.ok(css.includes('min-height:44px'), '44px touch targets missing');
console.log('FIELD BUYING rich enrollment static assertions: PASS');
