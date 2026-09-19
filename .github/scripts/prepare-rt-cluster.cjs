const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = 'operations/field-buying.js';
let source = fs.readFileSync(path, 'utf8');
const blob = (s) => crypto.createHash('sha1').update('blob ' + Buffer.byteLength(s) + '\0').update(s).digest('hex');
assert.equal(blob(source), 'b1080182bd42e75b9e768fb924fbc19f04031743', 'Source changed; re-audit required.');
function once(oldText, newText) {
  assert.equal(source.split(oldText).length - 1, 1, 'Expected one exact anchor: ' + oldText.slice(0, 80));
  source = source.replace(oldText, newText);
}
once("q('aflp_clusters', 'code,label,zone_code,active', 30)", "q('aflp_clusters', 'code,label,zone_code,aliases,active', 30)");
const helper = `/* Filtre de consultation uniquement : codes, libelles et alias du referentiel.
   Ne transforme aucune donnee et ne remplace jamais les autorisations RLS. */
function rtClusterResolver(c) {
  var keys = Object.create(null);
  function key(value) { return normName(value).replace(/\\s+/g, ''); }
  (c.clusters || []).forEach(function (ref) {
    var code = key(ref.code);
    if (!code) return;
    [ref.code, ref.label].concat(Array.isArray(ref.aliases) ? ref.aliases : []).forEach(function (alias) {
      var k = key(alias);
      if (k) keys[k] = code;
    });
  });
  return function (value) {
    if (value && typeof value === 'object') {
      var village = c.vm && c.vm[value.village_id];
      value = value.cluster_code || value.cluster || value.cluster_label ||
        (village && (village.cluster_code || village.cluster)) || '';
    }
    var k = key(value);
    return keys[k] || k;
  };
}

`;
once("var rtTab = 'villages';", helper + "var rtTab = 'villages';");
once("    var clusterOpts = selOptions(c.clusters.map(function (x) { return [x.label, x.label]; }), rtFilter.cluster);", `    var clusterOf = rtClusterResolver(c);
    rtFilter.cluster = clusterOf(rtFilter.cluster);
    function inCluster(row) { return !rtFilter.cluster || clusterOf(row) === rtFilter.cluster; }
    var clusterOpts = selOptions(c.clusters.map(function (x) { return [clusterOf(x.code), x.label]; }), rtFilter.cluster);`);
once("return (!rtFilter.cluster || v.cluster === rtFilter.cluster) && match(v.village + ' ' + (v.cluster || ''));", "return inCluster(v) && match(v.village + ' ' + (v.cluster || ''));");
once("return (!rtFilter.cluster || r.cluster === rtFilter.cluster) && match(r.nom + ' ' + (r.village_nom || '') + ' ' + (r.telephone || ''));", "return inCluster(r) && match(r.nom + ' ' + (r.village_nom || '') + ' ' + (r.telephone || ''));");
once("var rows = c.rts.filter(function (r) { return !rtFilter.cluster || r.cluster === rtFilter.cluster; })", "var rows = c.rts.filter(function (r) { return inCluster(r) && match(r.nom + ' ' + (r.village_nom || '') + ' ' + (r.telephone || '')); })");
const start = source.indexOf('function renderRt(sub, fichTab) {');
const end = source.indexOf('function rtToFarmer(rtId) {', start);
assert.ok(start > 0 && end > start);
let section = source.slice(start, end);
for (const [oldText, newText] of [
  ["c.villages.forEach(function (v) {", "c.villages.filter(function (v) { return inCluster(v) && match(v.village + ' ' + (v.cluster || '')); }).forEach(function (v) {"],
  ["c.rts.forEach(function (r) {", "c.rts.filter(function (r) { return inCluster(r) && match(r.nom + ' ' + (r.village_nom || '') + ' ' + (r.telephone || '')); }).forEach(function (r) {"],
  ["c.farmers.forEach(function (f) {", "c.farmers.filter(function (f) { return inCluster(f) && match((f.farmer_id || '') + ' ' + (f.nom || '') + ' ' + (f.prenoms || '') + ' ' + (f.village_nom || '') + ' ' + (f.telephone || '')); }).forEach(function (f) {"],
  ["rtFilter.cluster = this.value; draw();", "rtFilter.cluster = clusterOf(this.value); draw();"]
]) {
  assert.equal(section.split(oldText).length - 1, 1, 'Expected one RT section anchor: ' + oldText);
  section = section.replace(oldText, newText);
}
source = source.slice(0, start) + section + source.slice(end);
fs.writeFileSync(path, source);
const htmlPath = 'operations/field-buying.html';
let html = fs.readFileSync(htmlPath, 'utf8');
assert.equal(blob(html), '5d011a94ed36a01ed49fedfa037cf7da21be6da8', 'HTML changed; re-audit required.');
const oldVersion = './field-buying.js?v=20260918-acces-1';
assert.equal(html.split(oldVersion).length - 1, 1);
html = html.replace(oldVersion, './field-buying.js?v=20260919-rt-cluster-1');
fs.writeFileSync(htmlPath, html);
console.log(JSON.stringify({ source_blob: blob(source), html_blob: blob(html) }));
