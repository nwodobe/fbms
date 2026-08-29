import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bootstrapPath = new URL('../operations/field-buying-performance-bootstrap.js', import.meta.url);
const htmlPath = new URL('../operations/field-buying.html', import.meta.url);
const source = fs.readFileSync(bootstrapPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

assert.ok(source.includes('ANAGROCI_SUPABASE_CLIENT'), 'le bootstrap doit publier le client partage');
assert.ok(source.includes('LIGHT_VILLAGES'), 'la selection villages LIGHT doit exister');
assert.ok(source.includes('LIGHT_RT'), 'la selection RT LIGHT doit exister');
assert.ok(source.includes('PROFILE_VILLAGES'), 'le referentiel profils villages doit etre optimise');
assert.ok(source.includes('PROFILE_RT'), 'le referentiel profils RT doit etre optimise');
assert.ok(source.includes("select('id,data')"), 'le JSON legacy doit etre charge uniquement par ID');
assert.ok(!source.includes('villages.data.s7.candidats = null'), 'aucune suppression legacy ne doit etre realisee');

const perfPos = html.indexOf('field-buying-performance-bootstrap.js');
const authPos = html.indexOf('../shared/auth-gate.js');
const enginePos = html.indexOf('./field-buying.js');
assert.ok(perfPos > -1 && authPos > -1 && enginePos > -1, 'scripts FIELD BUYING attendus absents');
assert.ok(perfPos < authPos && perfPos < enginePos, 'le bootstrap doit etre charge avant auth-gate et field-buying.js');

let nativeCreateCount = 0;
const observed = [];
const rowsByTable = {
  villages: [{ id: 'v1', village: 'Village 1', data: { heavy: true } }],
  rt: [{ id: 'r1', nom: 'RT 1', data: { heavy: true } }]
};
function makeBuilder(table, state = {}) {
  return {
    select(columns) { observed.push({ table, columns }); state.columns = columns; return makeBuilder(table, state); },
    eq(col, value) { state.eq = [col, value]; return makeBuilder(table, state); },
    maybeSingle() {
      const data = (rowsByTable[table] || []).find(r => !state.eq || r[state.eq[0]] === state.eq[1]) || null;
      return Promise.resolve({ data, error: null });
    },
    limit() { return makeBuilder(table, state); },
    then(resolve) {
      let data = (rowsByTable[table] || []).map(r => {
        if (state.columns === 'id,data') return { id: r.id, data: r.data };
        const copy = { ...r };
        if (state.columns && !state.columns.split(',').includes('data')) delete copy.data;
        return copy;
      });
      return Promise.resolve({ data, error: null }).then(resolve);
    }
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
const window = { supabase: fakeSupabase, location: { hash: '#rt/r1' } };
vm.runInNewContext(source, { window, Proxy, Object, String, Array, Promise, decodeURIComponent });

const c1 = window.supabase.createClient('https://example.supabase.co', 'anon');
const c2 = window.supabase.createClient('https://example.supabase.co', 'anon');
assert.equal(c1, c2, 'les modules doivent recevoir la meme instance Supabase');
assert.equal(nativeCreateCount, 1, 'createClient natif ne doit etre execute qu une fois');
assert.equal(window.ANAGROCI_SUPABASE_CLIENT, c1, 'le client partage doit etre publie globalement');

const baseVillages = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,data,deleted';
const baseRt = 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted,data';
const profileVillages = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,data,deleted';
const profileRt = 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,data,deleted';

await c1.from('villages').select(baseVillages).limit(500);
await c1.from('rt').select(baseRt).limit(500);
await c1.from('villages').select(profileVillages).eq('deleted', false).limit(800);
const rtResult = await c1.from('rt').select(profileRt).eq('deleted', false).limit(800);

assert.equal(observed[0].columns, 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,deleted', 'base() ne doit plus demander villages.data');
assert.equal(observed[1].columns, 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted', 'base() ne doit plus demander rt.data');
assert.equal(observed[2].columns, 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,deleted', 'loadRefs villages doit etre LIGHT');
assert.equal(observed[3].columns, 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted', 'loadRefs RT doit etre LIGHT');
assert.ok(observed.some(x => x.table === 'rt' && x.columns === 'id,data'), 'la fiche RT ouverte doit charger uniquement son id,data');
assert.deepEqual(rtResult.data[0].data, { heavy: true }, 'le JSON cible doit etre reinjecte dans la fiche ouverte');

console.log('FIELD BUYING performance bootstrap phase 2: OK');
