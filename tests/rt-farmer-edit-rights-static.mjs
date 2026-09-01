import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('operations/field-buying.html','utf8');
const js = fs.readFileSync('operations/rt-farmer-rights.js','utf8');
const sql = fs.readFileSync('supabase/20260901_rt_farmer_edit_rights_no_delete.sql','utf8');

assert.match(html,/rt-farmer-rights\.js\?v=20260901-1/,'module droits ciblés non chargé');
assert.match(js,/role \|\| ''\)\.toLowerCase\(\) === 'zonal head'/,'Zonal Head non reconnu');
assert.match(js,/from\('rt'\)\.update/,'édition RT absente');
assert.match(js,/from\('producteurs'\)\.update/,'édition Producteur absente');
assert.doesNotMatch(js,/\.delete\s*\(/,'le module ne doit jamais supprimer');
assert.doesNotMatch(js,/deleted\s*:\s*true/,'le module ne doit jamais faire de soft-delete');
assert.match(sql,/'Zonal Head'/,'Zonal Head absent du helper serveur');
assert.match(sql,/'Agent Recenseur'/,'Agent Recenseur absent du helper serveur');
assert.match(sql,/rt_delete_bm_only_guard/,'garde DELETE RT absente');
assert.match(sql,/producteurs_delete_bm_only_guard/,'garde DELETE Producteur absente');
assert.match(sql,/as restrictive[\s\S]*for delete to public[\s\S]*est_bm\(\)/i,'DELETE physique non réservé au BM');
assert.match(sql,/farmer_registry_can_access_village/,'périmètre géographique non contrôlé');

console.log('Droits RT/Producteurs : PASS');
