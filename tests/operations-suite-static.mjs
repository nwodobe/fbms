import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const portal = read('index.html');
const workspaces = ['field-buying.html','lba-purchase.html','warehouse.html','stock-transfer.html','factory.html'];
for (const label of ['FIELD BUYING','LBA PURCHASE','WAREHOUSE OPERATIONS','STOCK TRANSFER','FACTORY','TRACEABILITY 360','REPORTS & EXPORT']) {
  assert.ok(portal.includes(label), `portal missing ${label}`);
}
for (const file of workspaces) {
  const html = read('operations/' + file);
  assert.ok(html.includes('operations.css'), `${file}: shared design system missing`);
  assert.ok(html.includes('workspace.js'), `${file}: workspace shell missing`);
  assert.ok(html.includes('auth-gate.js'), `${file}: auth gate missing`);
}
const field = read('operations/field-buying.html');
assert.ok(/parcelle\/GPS ne bloque jamais/i.test(field), '2027 parcel non-blocking rule missing');
const lba = read('operations/lba-purchase.html');
assert.ok(/directement au Factory Warehouse/i.test(lba), 'direct LBA factory routing missing');
const wh = read('operations/warehouse.html');
assert.ok(/LOT = identité/i.test(wh) && /BIN = localisation/i.test(wh), 'LOT/BIN rule missing');
const transfer = read('operations/stock-transfer.html');
assert.ok(/change de site ANAGROCI/i.test(transfer), 'inter-site transfer boundary missing');
const factory = read('operations/factory.html');
assert.ok(/arrivée usine ≠ entrée process/i.test(factory), 'factory warehouse/process boundary missing');
const reports = read('operations/reports-export.js');
assert.ok(reports.includes("'Metadata'"), 'Excel Metadata sheet missing');
assert.ok(!reports.includes('HYPERLINK('), 'external hyperlink formula found');
const trace = read('operations/traceability-search.js');
assert.ok(trace.includes('operations_traceability_search_v'), 'cross-domain traceability view not used');
console.log('Operations Suite static assertions: PASS');
