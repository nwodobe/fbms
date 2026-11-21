// Régression P0 audit itel 20/11/2026 : parcelles d'un producteur hors ligne.
// Exécute la VRAIE logique de passportData (extraite de operations/field-buying.js)
// dans une machine virtuelle Node, avec un faux Supabase et un faux stockage local
// par compte. Aucune donnée réelle, aucun réseau.
// Lancer : node --test tests/parcelles-hors-ligne-p0.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../operations/field-buying.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../operations/parcelles.css', import.meta.url), 'utf8');

function slice(from, to) {
  const a = src.indexOf(from); const b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, 'bloc introuvable : ' + from);
  return src.slice(a, b);
}
const storeSrc = slice('var FBStore = {', '/* Le serveur Supabase plafonne');
const passportSrc = slice('function passportUid()', 'function passportTabs()');

/* Faux stockage ANAGROCI_OFFLINE : clé par compte, comme offline-field.js. */
function fakeOffline(env) {
  return {
    isOnline: () => env.online,
    setBundle: (name, value) => { env.bundles[name + ':u:' + env.uid] = value; return Promise.resolve(); },
    getBundle: (name) => Promise.resolve(env.bundles[name + ':u:' + env.uid] || null),
  };
}
function makeEnv(over = {}) {
  const env = Object.assign({ online: true, uid: 'user-A', bundles: {}, serverPlots: [], pending: [], failNetwork: false, calls: 0 }, over);
  const ctx = {
    TTL: 60000, store: Object.create(null), console, setTimeout, Promise, Date, Array, Object, JSON,
    global: {},
  };
  ctx.global.ANAGROCI_AUTH = { profile: { user_id: env.uid } };
  ctx.global.ANAGROCI_OFFLINE = fakeOffline(env);
  ctx.global.AFLP_FARMER_REGISTRY = { syncEngine: { listCache: () => Promise.resolve(env.pending) } };
  ctx.global.addEventListener = () => {};
  ctx.client = () => Promise.resolve(env.online && !env.failNetwork ? {} : null);
  ctx.q = (table, cols, limit, mod) => {
    env.calls++;
    if (!env.online || env.failNetwork) return Promise.reject(new Error('Failed to fetch'));
    if (table === 'farmer_plots') return Promise.resolve(env.serverPlots);
    if (table === 'producteurs') return Promise.resolve([{ id: 'P1', data: { superficieHa: 3.5 } }]);
    return Promise.resolve([]);
  };
  vm.createContext(ctx);
  vm.runInContext(storeSrc + passportSrc + '\nthis.passportData = passportData; this.FBStore = FBStore; this.plotsUnknown = plotsUnknown;', ctx);
  env.ctx = ctx;
  env.setUid = (u) => { env.uid = u; ctx.global.ANAGROCI_AUTH.profile.user_id = u; };
  return env;
}
const PLOT = { id: 'PLOT-TEST-1', producteur_id: 'P1', local_name: 'Parcelle test', declared_area: 3.5, gps_status: 'NOT_MAPPED' };

test('en ligne : parcelles du serveur et instantané local enregistré pour le compte', async () => {
  const env = makeEnv({ serverPlots: [PLOT] });
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'server');
  assert.equal(p.plots.length, 1);
  assert.equal(p.producteur.data.superficieHa, 3.5);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(env.bundles['passport_plots:P1:u:user-A'], 'instantané rattaché au compte A');
});

test('P0 : hors ligne après une consultation en ligne, la parcelle reste visible (id, surface, statut)', async () => {
  const env = makeEnv({ serverPlots: [PLOT] });
  await env.ctx.passportData('P1');
  await new Promise((r) => setTimeout(r, 5));
  env.ctx.FBStore.clear();            // fermeture / réouverture de l'application
  env.online = false;
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'cache');
  assert.ok(p.plotsAt, 'date du dernier état local');
  assert.deepEqual(JSON.parse(JSON.stringify(p.plots.map((x) => [x.id, x.declared_area, x.gps_status]))), [['PLOT-TEST-1', 3.5, 'NOT_MAPPED']]);
  assert.equal(p.producteur.data.superficieHa, 3.5, 'superficie déclarée conservée');
});

test('P0 : échec réseau alors que le téléphone se croit en ligne → état local, jamais liste vide', async () => {
  const env = makeEnv({ serverPlots: [PLOT] });
  await env.ctx.passportData('P1');
  await new Promise((r) => setTimeout(r, 5));
  env.ctx.FBStore.clear();
  env.failNetwork = true;
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'cache');
  assert.equal(p.plots.length, 1);
});

test('P0 : sans instantané fiable, la liste est « inconnue » et non vide', async () => {
  const env = makeEnv({ online: false });
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'unknown');
  assert.equal(env.ctx.plotsUnknown(p), true);
});

test('sécurité : un autre compte du même téléphone ne lit pas l’instantané du précédent', async () => {
  const env = makeEnv({ serverPlots: [PLOT] });
  await env.ctx.passportData('P1');
  await new Promise((r) => setTimeout(r, 5));
  env.ctx.FBStore.clear();
  env.online = false;
  env.setUid('user-B');
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'unknown');
  assert.equal(p.plots.length, 0);
});

test('sécurité : sans compte identifié, aucun instantané n’est lu ni écrit', async () => {
  const env = makeEnv({ serverPlots: [PLOT] });
  env.ctx.global.ANAGROCI_AUTH = null;
  await env.ctx.passportData('P1');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(Object.keys(env.bundles).length, 0);
});

test('file locale : une parcelle en attente reste visible et n’est jamais dupliquée', async () => {
  const pending = { ...PLOT, local_name: 'Modifiée hors ligne', _sync_status: 'PENDING_SYNC' };
  const env = makeEnv({ serverPlots: [PLOT], pending: [pending, { id: 'PLOT-TEST-2', producteur_id: 'P1', _sync_status: 'PENDING_SYNC' }] });
  const p = await env.ctx.passportData('P1');
  assert.deepEqual(JSON.parse(JSON.stringify(p.plots.map((x) => x.id).sort())), ['PLOT-TEST-1', 'PLOT-TEST-2']);
  assert.equal(p.plots.find((x) => x.id === 'PLOT-TEST-1').local_name, 'Modifiée hors ligne', 'la modification locale prime');
});

test('un état local n’est pas gardé en mémoire comme frais : le retour réseau relit le serveur', async () => {
  const env = makeEnv({ serverPlots: [PLOT] });
  await env.ctx.passportData('P1');
  await new Promise((r) => setTimeout(r, 5));
  env.ctx.FBStore.clear();
  env.online = false;
  await env.ctx.passportData('P1');
  await new Promise((r) => setTimeout(r, 5));
  env.online = true;
  env.serverPlots = [PLOT, { id: 'PLOT-TEST-3', producteur_id: 'P1' }];
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'server');
  assert.equal(p.plots.length, 2);
});

test('interface : création bloquée et message exigé quand la liste est inconnue', () => {
  assert.match(src, /Impossible de vérifier les parcelles existantes hors ligne\. Reconnectez-vous avant de créer une nouvelle parcelle\./);
  assert.match(src, /data-plot-add="blocked"/);
  assert.match(src, /inconnue, pas vide/);
});

test('P1-1 : actions des parcelles visibles sur mobile (cartes sous 640 px)', () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.fb-plots-table td\.fb-plot-actions/);
  assert.match(src, /class="fb-plot-actions"/);
});

test('P1-2 : pastille de version masquée pendant un formulaire, actions collées en bas', () => {
  assert.match(css, /:root:has\(#frSubDialog\) \.anx-btn/);
  // La pastille est un enfant de <html> (bridge.js) : un sélecteur body:has(...) ne la vise jamais.
  assert.doesNotMatch(css, /body:has\([^)]*\) \.anx-btn/);
  assert.match(readFileSync(new URL('../android/native-web/bridge.js', import.meta.url), 'utf8'), /document\.documentElement\.appendChild\(btn\)/);
  assert.match(css, /#frSubDialog \.fr-op-actions \{ position: sticky; bottom: 0/);
});

test('P1-3 : un KPI inconnu n’est jamais affiché à zéro', () => {
  assert.match(src, /X\.qualityKnown \? String\(nLow\) : 'Indisponible hors ligne'/);
});

test('P1-6 : plus de troncature silencieuse à 300 producteurs', () => {
  assert.doesNotMatch(src, /list\.slice\(0, 300\)\.map\(function \(f\)/);
  assert.match(src, /Afficher les ' \+ Math\.min\(PF_PAGE/);
});

test('P2 : libellés terrain, la valeur technique reste inchangée en base', () => {
  assert.match(src, /NOT_MAPPED: 'Champ non cartographié'/);
  assert.match(src, /NOT_ASSESSED: 'Non encore évalué'/);
  assert.match(src, /\['overview', TT\('Vue d’ensemble', 'Overview'\)\]/);
  assert.doesNotMatch(src, /\.update\(\{ *gps_status: *'Champ/);
});

/* Écriture itel 21/11/2026 (producteur TEST autorisé) : parcelle créée en ligne
   après la dernière lecture du passeport, puis consultation hors ligne. */
test('hors ligne : une parcelle confirmée par ce téléphone après l’instantané reste visible', async () => {
  const env = makeEnv({ serverPlots: [] });
  await env.ctx.passportData('P1');                     // instantané : 0 parcelle
  env.ctx.FBStore.clear();
  env.pending = [{ ...PLOT, _sync_status: 'SYNCED' }];   // créée et confirmée ensuite
  env.online = false;
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'cache');
  assert.equal(p.plots.length, 1, 'la parcelle confirmée ne doit pas disparaître hors ligne');
  assert.equal(p.plots[0].id, PLOT.id);
});

test('en ligne : la liste serveur reste seule autorité (copie locale confirmée ignorée)', async () => {
  const env = makeEnv({ serverPlots: [], pending: [{ ...PLOT, _sync_status: 'SYNCED' }] });
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'server');
  assert.equal(p.plots.length, 0, 'une parcelle supprimée côté serveur ne doit pas réapparaître en ligne');
});

test('sans instantané : des parcelles locales ne rendent pas la liste « complète »', async () => {
  const env = makeEnv({ online: false, pending: [{ ...PLOT, _sync_status: 'SYNCED' }] });
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plotsState, 'unknown');
  assert.equal(env.ctx.plotsUnknown(p), true, 'création toujours bloquée');
  assert.equal(p.plots.length, 1);
});

test('hors ligne : une ligne locale d’un autre producteur n’est jamais mélangée', async () => {
  const env = makeEnv({ serverPlots: [] });
  await env.ctx.passportData('P1');
  env.ctx.FBStore.clear();
  env.pending = [{ ...PLOT, id: 'X', producteur_id: 'P2', _sync_status: 'SYNCED' }];
  env.online = false;
  const p = await env.ctx.passportData('P1');
  assert.equal(p.plots.length, 0);
});

/* Doublon : même nom local (casse, accents, espaces ignorés) => confirmation. */
const ops = readFileSync(new URL('../shared/farmer-registry-operations.js', import.meta.url), 'utf8');
function opsFn(name, next) {
  const a = ops.indexOf('function ' + name + '('); const b = ops.indexOf(next, a);
  assert.ok(a >= 0 && b > a, 'fonction introuvable : ' + name);
  return ops.slice(a, b);
}
const dupCtx = vm.createContext({ String, Number });
vm.runInContext(opsFn('plotNameKey', 'function similarPlot') + opsFn('similarPlot', 'async function savePlot') +
  '\nthis.similarPlot = similarPlot;', dupCtx);

test('doublon : nom identique (casse et séparateurs ignorés) détecté', () => {
  const plots = [{ id: 'A', local_name: 'TEST_PARCELLE_A', declared_area: 1.2, area_unit: 'HA' }];
  assert.equal(dupCtx.similarPlot(plots, { id: 'B', local_name: 'test parcelle a', declared_area: 1.2, area_unit: 'HA' }).id, 'A');
});
test('doublon : noms différents non signalés ; la parcelle elle-même jamais comparée', () => {
  const plots = [{ id: 'A', local_name: 'Champ du bas', declared_area: 1.2 }];
  assert.equal(dupCtx.similarPlot(plots, { id: 'B', local_name: 'Champ du haut', declared_area: 1.2 }), null);
  assert.equal(dupCtx.similarPlot(plots, { id: 'A', local_name: 'Champ du bas', declared_area: 1.2 }), null);
});
test('doublon : sans nom, même superficie et même unité signalée ; parcelle inactive ignorée', () => {
  const plots = [{ id: 'A', local_name: '', declared_area: 2, area_unit: 'HA' }, { id: 'C', local_name: 'X', status: 'INACTIVE', declared_area: 2 }];
  assert.equal(dupCtx.similarPlot(plots, { id: 'B', local_name: null, declared_area: 2, area_unit: 'HA' }).id, 'A');
  assert.equal(dupCtx.similarPlot([plots[1]], { id: 'B', local_name: 'X', declared_area: 2 }), null);
});
