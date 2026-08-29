import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../operations/field-buying-sex-compat.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, { window, String });
const sex = window.ANAGROCI_FB_SEX_COMPAT;
assert.ok(sex, 'compatibilite sexe absente');

for (const v of ['M','Homme','Masculin','Male','homme']) assert.equal(sex.normalizeDbSex(v), 'M', `attendu M pour ${v}`);
for (const v of ['F','Femme','Féminin','Female','femme']) assert.equal(sex.normalizeDbSex(v), 'F', `attendu F pour ${v}`);
assert.equal(sex.normalizeUiSex('M'), 'Homme');
assert.equal(sex.normalizeUiSex('F'), 'Femme');
assert.equal(sex.normalizeDbSex(''), '');
assert.equal(sex.normalizeDbSex(null), '');

console.log('FIELD BUYING sex compatibility: OK');
