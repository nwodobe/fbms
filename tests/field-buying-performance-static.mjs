import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bootstrapPath = new URL('../operations/field-buying-performance-bootstrap.js', import.meta.url);
const htmlPath = new URL('../operations/field-buying.html', import.meta.url);
const source = fs.readFileSync(bootstrapPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

assert.ok(source.includes('ANAGROCI_SUPABASE_CLIENT'), 'le bootstrap doit publier le client partagé');
assert.ok(source.includes('LIGHT_VILLAGES'), 'la sélection villages LIGHT doit exister');
assert.ok(source.includes('LIGHT_RT'), 'la sélection RT LIGHT doit exister');
assert.ok(!source.includes("villages.data.s7.candidats = null"), 'aucune suppression legacy ne doit être réalisée');

const perfPos = html.indexOf('field-buying-performance-bootstrap.js');
const authPos = html.indexOf('../shared/auth-gate.js');
const enginePos = html.indexOf('./field-buying.js');
assert.ok(perfPos > -1 && authPos > -1 && enginePos > -1, 'scripts FIELD BUYING attendus absents');
assert.ok(perfPos < authPos && perfPos < enginePos, 'le bootstrap doit être chargé avant auth-gate et field-buying.js');

let nativeCreateCount = 0;
const observed = [];
function makeBuilder(table) {
  return {
    select(columns) {
      observed.push({ table, columns });
      return makeBuilder(table);
    },
    eq() { return makeBuilder(table); },
    limit() { return makeBuilder(table); },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
  };
}
const fakeSupabase = {
  createClient() {
    nativeCreateCount += 1;
    return {
      from(table) { return makeBuilder(table); },
      auth: { getSession: async () => ({ data: { session: null } }) },
      storage: { from: () => ({}) }
    };
  }
};
const window = { supabase: fakeSupabase };
vm.runInNewContext(source, { window, Proxy, Object, String, Array, Promise });

const c1 = window.supabase.createClient('https://example.supabase.co', 'anon');
const c2 = window.supabase.createClient('https://example.supabase.co', 'anon');
assert.equal(c1, c2, 'les modules doivent recevoir la même instance Supabase');
assert.equal(nativeCreateCount, 1, 'createClient natif ne doit être exécuté qu’une fois pour la même configuration');
assert.equal(window.ANAGROCI_SUPABASE_CLIENT, c1, 'le client partagé doit être publié globalement');

const baseVillages = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,data,deleted';
const baseRt = 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted,data';
const profileVillages = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,data,deleted';

c1.from('villages').select(baseVillages).limit(500);
c1.from('rt').select(baseRt).limit(500);
c1.from('villages').select(profileVillages).eq('deleted', false).limit(800);

assert.equal(observed[0].columns, 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,deleted', 'base() ne doit plus demander villages.data');
assert.equal(observed[1].columns, 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted', 'base() ne doit plus demander rt.data');
assert.equal(observed[2].columns, profileVillages, 'les fiches 360 legacy ne doivent pas être altérées par ce correctif');

console.log('FIELD BUYING performance bootstrap: OK');
