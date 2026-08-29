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

// --- FIELD BUYING : un seul moteur, capacites metier reintegrees -----------------
const fbEngines = ['field-buying.js', 'field-buying-v2.js']
  .filter(name => new RegExp(`src="\\./${name.replace('.', '\\.')}\\?`).test(field));
assert.deepEqual(fbEngines, ['field-buying.js'],
  `Field Buying must load exactly one rendering engine, found: ${fbEngines.join(', ') || 'none'}`);
assert.ok(/leaflet@1\.9\.4/.test(field), 'Field Buying must load Leaflet for the operational map');

const fb = read('operations/field-buying.js');
// Routeur publie avant le demarrage — la lecon du defaut LBA.
const fbPublish = fb.indexOf('global.ANAGROCI_OPS_ROUTE = render;');
const fbBoot = fb.indexOf("document.readyState === 'loading'");
assert.ok(fbPublish > 0 && fbPublish < fbBoot, 'FB router must be published before boot');

// Les 11 rubriques cibles existent dans le routeur.
for (const r of ['overview', 'purchases', 'census', 'farmers', 'rt', 'hubs', 'bags',
                 'cash', 'command', 'sustainability', 'traceability']) {
  assert.ok(new RegExp(`\\b${r}: function`).test(fb), `FB route missing: ${r}`);
}
const nav2 = read('operations/navigation-v2.js');
for (const label of ['Recensement', 'Producteurs', 'Hubs & Cartographie', 'Sacherie AFLP',
                     'Caisse & Avances', 'Command Center']) {
  assert.ok(nav2.includes(label), `FB sidebar missing: ${label}`);
}

// Reutilisation des moteurs existants — jamais de deuxieme base.
for (const t of ["q('villages_light_v'", "q('rt_light_v'", "from('villages')", "from('rt')", "from('producteurs')", "from('achats')",
                 "q('avances'", "q('reconciliations'", "from('ops_bag_requests')",
                 "rpc('farmer_possible_duplicates'", "rpc('field_traceability_search'",
                 'farmer_passport_summary_v', 'sacherie_ct_rt_stock', 'sacherie_ct_cluster_stock',
                 'aflp_zones', 'aflp_clusters', 'hubs_clusters', 'log_hubs']) {
  assert.ok(fb.includes(t), `FB must reuse existing engine: ${t}`);
}
// Bareme de l'ancien moteur d'achats conserve.
assert.ok(fb.includes('PRIX_CAMPAGNE = 400'), 'campaign price 400 missing');
assert.ok(fb.includes("'Validation BM requise'"), 'off-scale price BM validation missing');
assert.ok(fb.includes("'Entrée RT'"), 'stock release rule missing');
// Regle 2027 : parcelle jamais bloquante — le formulaire d'achat n'exige aucune parcelle.
assert.ok(/parcelle à compléter après campagne/i.test(fb), '2027 parcel-optional wording missing');
assert.ok(!/gps_mapped_count[^\n]*required/.test(fb), 'parcel must never be required');
// Actions critiques rendues dans l'en-tete, jamais injectees apres coup.
for (const label of ['+ Nouveau village', '+ Nouveau producteur', '+ Nouveau RT',
                     '+ Nouvel achat', '+ Nouvelle demande RT']) {
  assert.ok(fb.includes(label), `FB critical action missing: ${label}`);
}
// Performance : chargement groupe, cache partage, prechargement.
assert.ok(fb.includes('FBStore'), 'FB shared store missing');
assert.ok(fb.includes('Promise.all'), 'FB parallel base load missing');
assert.ok(fb.includes('requestIdleCallback'), 'FB idle preload missing');
// Terminologie officielle.
assert.ok(!/Achat Direct|Direct Purchase|Direct Buying|Farmgate/i.test(fb), 'forbidden terminology in FB engine');
// Aucun saut vers l'ancien shell.
assert.ok(!/fbms\/index\.html|terrain\/achats\.html|terrain\/cash\.html|rcntrace\/index\.html/.test(fb),
  'FB engine must not link back to legacy shells');
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

// Fiches 360° : securite des documents et regles d'edition.
assert.ok(/villages:\s*function/.test(fb), 'village fiche route missing');
assert.ok(fb.includes('renderRtFiche') && fb.includes('renderVillageFiche'), 'fiche 360 renderers missing');
// Pieces d'identite : bucket prive + URL signee, JAMAIS d'URL publique ni de base64 en table.
assert.ok(fb.includes("BUCKET_PRIVE = 'terrain-preuves'"), 'private bucket missing');
assert.ok(fb.includes('createSignedUrl'), 'signed URL access missing');
assert.ok(!/getPublicUrl[\s\S]{0,40}BUCKET_PRIVE|BUCKET_PRIVE[\s\S]{0,120}getPublicUrl/.test(fb),
  'private bucket must never expose a public URL');
assert.ok(!/toDataURL|readAsDataURL/.test(fb), 'images must never be stored as base64');
assert.ok(fb.includes("from('preuves')"), 'documents must reuse the preuves engine');
assert.ok(fb.includes("from('audit_log')"), 'changes must reuse the central audit log');
// Edition : jamais de re-creation.
assert.ok(/update\(row\)\.eq\('id', editRow\.id\)/.test(fb), 'edits must update the same row by id');
assert.ok(fb.includes('p_exclude_id: editRow ? editRow.id : null'), 'duplicate check must exclude self on edit');
// Camera mobile.
assert.ok(fb.includes("setAttribute('capture', 'environment')"), 'mobile camera capture missing');

// Aucun vocabulaire technique dans l'interface visible du module Operations.
for (const file of ['lba-purchase.html', 'reports.html', 'traceability.html',
                    'lba-purchase.js', 'workspace.js', 'traceability-search.js']) {
  const src = read('operations/' + file);
  const visible = src
    .replace(/https?:\/\/[^"'\s)]+/g, '')          // URLs de CDN et de projet
    .replace(/\/\*[\s\S]*?\*\//g, '')               // commentaires de code
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
