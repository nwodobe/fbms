/* Gardes statiques de l'édition préremplie FIELD BUYING — version réconciliée.
   L'édition RT / Village / Producteur vit dans le moteur unique
   operations/field-buying.js (mêmes formulaires, préremplis, update ciblé) ;
   l'ancien module field-buying-prefilled-edit.js, qui interceptait la
   soumission des mêmes formulaires en doublon, doit rester inerte. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const moteur = fs.readFileSync('operations/field-buying.js', 'utf8');
const stub = fs.readFileSync('operations/field-buying-prefilled-edit.js', 'utf8');
const html = fs.readFileSync('operations/field-buying.html', 'utf8');

function has(re, msg) { assert.match(moteur, re, msg); }

assert.ok(!html.includes('field-buying-prefilled-edit.js'),
  'le module d’interception ne doit plus être chargé (édition dans le moteur unique)');
assert.ok(!stub.includes('addEventListener(\'submit\''),
  'le fichier inerte ne doit plus intercepter la soumission des formulaires');

/* Les trois formulaires canoniques s'ouvrent en mode édition prérempli. */
has(/function openVillageForm\(editId\)/, 'édition Village via le formulaire canonique');
has(/function openRtForm\(prefill, editId\)/, 'édition RT via le formulaire canonique');
has(/function openFarmerForm\(prefill, editId\)/, 'édition Producteur via le formulaire canonique');
has(/Modifier le village — /, 'en-tête édition Village attendu');
has(/Modifier le RT — /, 'en-tête édition RT attendu');
has(/Modifier le producteur — /, 'en-tête édition Producteur attendu');
has(/Enregistrer les modifications/, 'CTA édition attendu');

/* Mise à jour ciblée : jamais de re-création, jamais de nouvel identifiant. */
has(/update\(row\)\.eq\('id', editRow\.id\)/, 'édition = UPDATE sur l’id existant');
has(/p_exclude_id: editRow \? editRow\.id : null/, 'anti-doublon Producteur avec exclusion de soi');

/* Le sexe fait l'aller-retour avec le format base (M/F, trigger serveur). */
has(/function sexeCode\(/, 'normalisation sexe M/F requise');
has(/<option value="M">Homme<\/option>/, 'options sexe au format base');

for (const forbidden of ['rt_profiles_v2', 'village_profiles_v2', 'farmer_profiles_v2']) {
  assert.ok(!moteur.includes(forbidden), `aucun silo ${forbidden}`);
}
console.log('field-buying-prefilled-edit-static: OK (édition dans le moteur unique)');
