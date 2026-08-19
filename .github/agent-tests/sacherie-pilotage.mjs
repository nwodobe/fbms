import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const files = {
  page: 'terrain/sacherie_v2.html',
  tower: 'shared/anagroci-sacherie-control-tower.js',
  actions: 'shared/anagroci-sacherie-control-actions.js',
  sop: 'shared/anagroci-sacherie-v2.js',
};
const source = Object.fromEntries(Object.entries(files).map(([key, rel]) => [key, fs.readFileSync(path.join(root, rel), 'utf8')]));

// P0 : aucun gestionnaire inline ne doit permettre de reconstituer du JavaScript
// avec une valeur issue des donnees. Les trois helpers esc() doivent aussi encoder
// explicitement l'apostrophe, en plus de &, <, > et ".
for (const [key, text] of Object.entries(source)) {
  assert.doesNotMatch(text, /\son(?:click|change|input|error|load)\s*=\s*["']/i, `${files[key]} contient encore un gestionnaire d'evenement inline`);
}
for (const key of ['tower', 'actions', 'sop']) {
  assert.match(source[key], /replace\(\/\[&<>"'\]\/g/, `${files[key]} : esc() doit inclure l'apostrophe`);
  assert.match(source[key], /"'":'&#39;'/, `${files[key]} : esc() doit encoder l'apostrophe en &#39;`);
}

// Navigation cible : une seule coquille et exactement les cinq destinations de
// l'audit. Les anciennes barres autonomes ne doivent plus etre montees.
for (const label of ['Pilotage', 'Réseau', 'Flux', 'État du parc', 'Contrôles']) {
  assert.ok(source.tower.includes(`'${label}'`), `onglet cible manquant : ${label}`);
}
assert.ok(source.page.includes('id="sacherieApp"'), 'la page doit fournir une coquille Sacherie unique');
assert.ok(source.page.includes('id="sacNewOperation"'), 'le bouton global Nouvelle operation est requis');
assert.doesNotMatch(source.tower, /data-tab="(?:overview|clusters|rts|damaged|moves|inventory)"/, 'ancienne navigation Control Tower encore presente');
assert.doesNotMatch(source.sop, /class="sv2-nav"/, 'ancienne navigation SOP autonome encore presente');
assert.doesNotMatch(source.actions, /class="cta-tabs"/, 'ancienne navigation Actions autonome encore presente');

// La file de decisions doit rester visible depuis la navigation principale.
assert.match(source.tower, /id="ctDecisionBadge"/, 'badge de decisions manquant');
assert.match(source.tower, /À décider/, 'bande de decisions manquante');

console.log('OK - securite P0 et navigation Sacherie unifiee');
