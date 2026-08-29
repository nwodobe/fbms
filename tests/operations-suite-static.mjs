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

// FIELD BUYING : un seul shell, un seul moteur, 11 rubriques Operations natives.
assert.ok(/field-buying\.js\?v=[0-9A-Za-z-]+/.test(field), 'restored FIELD BUYING engine missing');
assert.ok(!field.includes('field-buying-v2.js'), 'obsolete thin FIELD BUYING engine must not be loaded');
assert.ok(!field.includes('../terrain/') && !field.includes('../fbms/') && !field.includes('../rcntrace/'),
  'FIELD BUYING must never jump to a legacy shell');
for (const label of ['Vue d’ensemble','Achat Bord Champ','Recensement','Producteurs','RT & Villages','Hubs & Cartographie','Sacherie AFLP','Caisse & Avances','Command Center','Sustainability','Traceability']) {
  assert.ok(nav.includes(label), `FIELD BUYING navigation missing ${label}`);
}
const fieldJs = read('operations/field-buying.js');
assert.ok(fieldJs.includes('FieldBuyingStore'), 'FIELD BUYING shared store missing');
assert.ok(fieldJs.includes('Promise.all'), 'FIELD BUYING base data must load in parallel');
assert.ok(fieldJs.includes("FieldBuyingStore.get('bags'"), 'bag domain must be lazy loaded');
assert.ok(fieldJs.includes("FieldBuyingStore.get('trace'"), 'traceability domain must be lazy loaded');
assert.ok(fieldJs.includes("rows('villages'"), 'village canonical source missing');
assert.ok(fieldJs.includes("rows('rt'"), 'RT canonical source missing');
assert.ok(fieldJs.includes("rows('producteurs'"), 'Farmer Registry canonical source missing');
assert.ok(fieldJs.includes("rows('achats'"), 'Achat Bord Champ canonical source missing');
assert.ok(fieldJs.includes("rows('ops_bag_requests'"), 'central bag request source missing');
assert.ok(fieldJs.includes("rows('ops_bag_releases'"), 'central physical bag releases missing');
assert.ok(fieldJs.includes('farmer_possible_duplicates'), 'Farmer duplicate guard must be reused');
assert.ok(fieldJs.includes('+ Nouveau village') && fieldJs.includes('+ Nouveau producteur') && fieldJs.includes('+ Nouveau RT'),
  'Recensement critical create actions must stay visible');
assert.ok(fieldJs.includes('+ Nouvel achat'), 'Achat Bord Champ critical action missing');
assert.ok(fieldJs.includes('+ Nouvelle demande RT'), 'bag request critical action missing');
assert.ok(/approval ≠ release/i.test(fieldJs), 'bag approval/release separation missing');
assert.ok(/parcelle\/GPS facultatif/i.test(fieldJs), '2027 optional parcel rule missing from create flow');
assert.ok(fieldJs.includes('3 000 MT'), 'campaign target must remain 3 000 MT');

// --- LBA Purchase : un seul moteur, un bouton qui ne peut pas disparaitre -------
// Ces assertions datent d'un defaut reel : lba-purchase-v2.js publiait
// ANAGROCI_OPS_ROUTE a la fin de son init() asynchrone et ecrasait le routeur du
// patch UX charge apres lui. Le bouton « + Nouveau LBA » et la rubrique Achats RCN
// disparaissaient des le premier changement de rubrique.
const lbaHtml = read('operations/lba-purchase.html');
const engines = ['lba-purchase.js', 'lba-purchase-v2.js', 'lba-purchase-v3.js', 'lba-purchase-ux-fix.js']
  .filter(name => new RegExp(`src="\\./${name.replace('.', '\\.')}\\?`).test(lbaHtml));
assert.deepEqual(engines, ['lba-purchase.js'],
  `LBA Purchase must load exactly one rendering engine, found: ${engines.join(', ') || 'none'}`);
assert.ok(/lba-purchase\.js\?v=[0-9A-Za-z-]+/.test(lbaHtml), 'LBA engine must be cache-busted');

const lba = read('operations/lba-purchase.js');
assert.ok(lba.includes('lba_create_funding_limit'), 'funding-limit RPC missing from LBA UI');
assert.ok(lba.includes("statut: 'À_APPROUVER'"), 'draft financing creation missing');
assert.ok(lba.includes("statut: ok ? 'APPROUVÉ' : 'REFUSÉ'"), 'financing approval flow missing');

// Le routeur doit etre publie AVANT que boot() ne soit planifie, sinon un autre
// script peut s'installer entre-temps et etre ecrase.
const publishAt = lba.indexOf('global.ANAGROCI_OPS_ROUTE = render;');
const bootAt = lba.indexOf("document.readyState === 'loading'");
assert.ok(publishAt > 0, 'LBA engine must publish ANAGROCI_OPS_ROUTE');
assert.equal(lba.split('global.ANAGROCI_OPS_ROUTE = render;').length - 1, 1,
  'ANAGROCI_OPS_ROUTE must be published exactly once');
assert.ok(publishAt < bootAt, 'ANAGROCI_OPS_ROUTE must be published before boot is scheduled');

// Le bouton fait partie du rendu de l'en-tete : il n'est jamais injecte apres coup.
assert.ok(lba.includes('+ Nouveau LBA'), 'create button label missing');
assert.ok(/function renderOverview[\s\S]{0,900}createButton\(\)/.test(lba),
  '+ Nouveau LBA must be part of the Overview header render');
assert.ok(/function renderRegistry[\s\S]{0,900}createButton\(\)/.test(lba),
  '+ Nouveau LBA must be part of the Registry header render');

// Achats RCN est une vraie rubrique du routeur, pas un repli sur la vue d'ensemble.
assert.ok(/purchases:\s*function/.test(lba), 'Achats RCN route missing from LBA router');
assert.ok(lba.includes('rcn_proc_validations_achat'), 'Achats RCN must read purchase validations');
assert.ok(lba.includes('rcn_receptions'), 'Achats RCN must resolve the delivery site');

// Creation LBA : on reutilise la fonction serveur, on ne reinvente pas la sequence.
assert.ok(lba.includes("rpc('lba_create'"), 'LBA creation must reuse the lba_create routine');
assert.ok(!/from\('rcn_fournisseurs'\)[\s\S]{0,80}\.insert\(/.test(lba),
  'LBA creation must not insert straight into the supplier registry');

// Performance : chargement de base groupe et cache partage entre rubriques.
assert.ok(lba.includes('Promise.all'), 'base data must load in parallel');
assert.ok(lba.includes('LBAStore'), 'shared client-side store missing');
assert.ok(lba.includes('requestIdleCallback'), 'idle preloading missing');

// Le bouton principal ne doit jamais finir dans « Plus d'actions ».
assert.ok(!nav.includes('.ops-route-actions') || /ops-pagehead \.ops-actions/.test(nav),
  'action overflow must not collapse route-level actions');

// Aucun vocabulaire technique dans l'interface visible du module Operations.
for (const file of ['lba-purchase.html', 'reports.html', 'traceability.html',
                    'lba-purchase.js', 'workspace.js', 'traceability-search.js']) {
  const src = read('operations/' + file);
  const visible = src
    .replace(/https?:\/\/[^"'\s)]+/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/ANAGROCI_SUPABASE_[A-Z]+/g, '')
    .replace(/global\.supabase|window\.supabase/g, '');
  for (const word of ['Supabase', 'PostgreSQL', 'RLS', 'RPC', 'serveur autoritaire']) {
    assert.ok(!visible.includes(word),
      `${file}: technical wording "${word}" must not reach the user interface`);
  }
}
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
