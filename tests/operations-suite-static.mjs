import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const portal = read('index.html');
const workspaces = ['field-buying.html','lba-purchase.html','warehouse.html','stock-transfer.html','factory.html'];
for (const label of ['FIELD BUYING','LBA PURCHASE','WAREHOUSE OPERATIONS','STOCK TRANSFER','FACTORY','TRACEABILITY 360','REPORTS & EXPORT']) {
  assert.ok(portal.includes(label), `portal missing ${label}`);
}
assert.ok(portal.includes('ACHAT BORD CHAMP'), 'portal must use Achat Bord Champ');
assert.ok(!portal.includes('ACHATS DIRECTS'), 'legacy Achats Directs wording still visible on portal');
for (const file of workspaces) {
  const html = read('operations/' + file);
  assert.ok(html.includes('operations.css'), `${file}: shared design system missing`);
  assert.ok(html.includes('operations-v2.css'), `${file}: responsive v2 design missing`);
  assert.ok(html.includes('workspace.js'), `${file}: workspace shell missing`);
  assert.ok(html.includes('navigation-v2.js'), `${file}: unified navigation missing`);
  assert.ok(html.includes('auth-gate.js'), `${file}: auth gate missing`);
  assert.ok(!html.includes('href="../rcntrace/index.html'), `${file}: legacy RCN shell link must not be exposed`);
}
const nav = read('operations/navigation-v2.js');
for (const route of ['#registry','#limits','#financing','#cycles','#deliveries','#bags','#balances','#aging','#performance']) {
  assert.ok(nav.includes(route.slice(1)), `LBA route missing ${route}`);
}
assert.ok(nav.includes('Achat Bord Champ'), 'FR terminology missing');
const field = read('operations/field-buying.html');
assert.ok(/parcelle\/GPS ne bloque jamais/i.test(field), '2027 parcel non-blocking rule missing');
assert.ok(field.includes('Achat Bord Champ'), 'Field Buying page must expose Achat Bord Champ');
const lba = read('operations/lba-purchase-v2.js');
assert.ok(lba.includes('lba_create_funding_limit'), 'funding-limit RPC missing from LBA UI');
assert.ok(lba.includes("statut:'À_APPROUVER'"), 'draft financing creation missing');
assert.ok(lba.includes("statut:ok?'APPROUVÉ':'REFUSÉ'"), 'financing approval flow missing');
const wh = read('operations/module-router-v2.js');
assert.ok(/LOT = identité/i.test(wh) && /BIN = localisation/i.test(wh), 'LOT/BIN rule missing');
const transfer = read('operations/stock-transfer.html');
assert.ok(/LBA direct Factory/i.test(transfer), 'direct LBA factory transfer boundary missing');
const factory = read('operations/factory.html');
assert.ok(/Arrival ≠ Process/i.test(factory), 'factory warehouse/process boundary missing');
const reports = read('operations/reports-export.js');
assert.ok(reports.includes("'Metadata'"), 'Excel Metadata sheet missing');
assert.ok(!reports.includes('HYPERLINK('), 'external hyperlink formula found');
const reportsHtml = read('operations/reports.html');
assert.ok(!reportsHtml.includes('../rcntrace/index.html'), 'Reports must not jump to legacy RCN shell');
const trace = read('operations/traceability-search.js');
assert.ok(trace.includes('operations_traceability_search_v'), 'cross-domain traceability view not used');
console.log('Operations Suite static assertions: PASS');
