import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync('operations/field-buying-prefilled-edit.js', 'utf8');
const html = fs.readFileSync('operations/field-buying.html', 'utf8');

function has(re, msg) { assert.match(js, re, msg); }

assert.match(html, /field-buying-prefilled-edit\.js\?v=/, 'le correctif doit être chargé après les profils');
has(/normalizeRtForForm/, 'normalisation RT legacy obligatoire');
has(/normalizeVillageForForm/, 'normalisation Village obligatoire');
has(/normalizeFarmerForForm/, 'normalisation Producteur obligatoire');
has(/global\.ANAGROCI_FB\.openRtForm\(r\)/, 'édition RT doit réutiliser le formulaire canonique');
has(/global\.ANAGROCI_FB\.openVillageForm\(v\)/, 'édition Village doit réutiliser le formulaire canonique');
has(/global\.ANAGROCI_FB\.openFarmerForm\(f\)/, 'édition Producteur doit réutiliser le formulaire canonique');
has(/form\.dataset\.mode='edit'/, 'le formulaire doit être explicitement en mode edit');
has(/Enregistrer les modifications/, 'CTA édition attendu');
has(/c\.from\('rt'\)\.update/, 'RT edit doit utiliser UPDATE');
has(/\.eq\('id',n\.row\.id\)/, 'RT edit doit cibler l ID existant');
has(/if\(r\.id===n\.row\.id\)return false/, 'anti-doublon RT doit exclure le RT courant');
has(/p_exclude_id:f\.id/, 'anti-doublon Farmer doit exclure le producteur courant');
has(/c\.from\('producteurs'\)\.update/, 'Farmer edit doit utiliser UPDATE');
has(/c\.from\('villages'\)\.update/, 'Village edit doit utiliser UPDATE');
has(/deepClone\(n\.data\)/, 'les JSON existants doivent être fusionnés et non reconstruits à zéro');
has(/location\.hash='#rt\/'/, 'retour fiche RT attendu');
has(/location\.hash='#villages\/'/, 'retour fiche Village attendu');
has(/location\.hash='#farmers\/'/, 'retour Farmer Passport attendu');
has(/tel\.removeAttribute\('required'\)/, 'un téléphone historique manquant ne doit pas bloquer l édition RT');
has(/friendlyError/, 'messages utilisateur simplifiés attendus');
has(/RT_MODIFIED/, 'audit modification RT attendu');
has(/VILLAGE_MODIFIED/, 'audit modification Village attendu');
has(/FARMER_MODIFIED/, 'audit modification Farmer attendu');

for (const forbidden of ['rt_profiles_v2','village_profiles_v2','farmer_profiles_v2']) {
  assert.ok(!js.includes(forbidden), `aucun silo ${forbidden}`);
}
console.log('field-buying-prefilled-edit-static: OK');
