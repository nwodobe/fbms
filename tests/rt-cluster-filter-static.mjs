/* RT & Villages regression tests. No database connection or writes. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('operations/field-buying.js', 'utf8');
const html = fs.readFileSync('operations/field-buying.html', 'utf8');
const norm = source.slice(source.indexOf('function normName('), source.indexOf('function normPhone('));
const helper = source.slice(source.indexOf('function rtClusterResolver('), source.indexOf("var rtTab = 'villages';"));
assert.ok(helper.startsWith('function rtClusterResolver('), 'Cluster resolver is missing');
const sandbox = {};
vm.runInNewContext(norm + helper + '\nthis.resolve = rtClusterResolver;', sandbox);
const clusters = [
  { code: 'BEOUMI', label: 'B\u00e9oumi', aliases: ['BEOUMI'] },
  { code: 'BOTRO', label: 'Botro', aliases: ['BOTRO'] },
  { code: 'BROBO', label: 'Brobo', aliases: ['BROBO'] },
  { code: 'DIABO', label: 'Diabo', aliases: ['DIABO'] },
  { code: 'DJEBONOUA', label: 'Dj\u00e9bonoua', aliases: ['DJEBONOUA', "N'DJEBONOUA", 'DJEBONOU', 'DJEBONOA'] },
  { code: 'SAKASSOU', label: 'Sakassou', aliases: ['SAKASSOU'] }
];
const c = {clusters, vm:{v1:{cluster_code:'DJEBONOUA', cluster:"N'DJEBONOUA"}}};
const before = JSON.stringify(c);
const resolve = sandbox.resolve(c);
let checked = 0;
for (const ref of clusters) {
  for (const alias of [ref.code, ref.label, ref.label.toLowerCase(), '  ' + ref.label + '  ', ...(ref.aliases || [])]) {
    assert.equal(resolve(alias), ref.code, alias); checked++;
    assert.equal(resolve({cluster:alias}), ref.code); checked++;
  }
  assert.equal(resolve({cluster_code:ref.code, cluster:'outdated label'}), ref.code); checked++;
}
for (const alias of ["N'Dj\u00e9bonoua", 'N\u2019DJEBONOUA', ' n djebonoua ']) {
  assert.equal(resolve(alias),'DJEBONOUA'); checked++;
}
for (const val of ['', null, undefined, {}]) {assert.equal(resolve(val), ''); checked++;}
assert.equal(resolve({village_id:'v1'}), 'DJEBONOUA'); checked++;
assert.equal(resolve({cluster_label:'B\u00e9oumi'}), 'BEOUMI'); checked++;
assert.notEqual(resolve('BEOUMI UNKNOWN'), 'BEOUMI'); checked++;
assert.equal(sandbox.resolve({clusters:[], vm:{}})(' b\u00e9oumi '), 'BEOUMI'); checked++;
assert.equal(JSON.stringify(c), before, 'No mutation of source data'); checked++;
const section = source.slice(source.indexOf('function renderRt(sub,'), source.indexOf('function rtToFarmer('));
assert.match(section, /return \[clusterOf\(x.code\), x.label\]/); checked++;
assert.ok(!section.includes('cluster === rtFilter.cluster')); checked++;
assert.equal((section.match(/return inCluster\(/g) || []).length, 6, 'All four tabs filter rows'); checked++;
assert.match(section, /rtFilter.cluster = clusterOf\(this.value\)/); checked++;
assert.match(source, /q\('aflp_clusters', 'code,label,zone_code,aliases,active'/); checked++;
assert.match(html, /field-buying\.js\?v=20260919-farmer-edit-1/); checked++;
console.log('rt-cluster-filter-static: ' + checked + ' assertions passed');
