#!/usr/bin/env node
/**
 * FIELD BUYING hors ligne — isolation multi-utilisateurs et shell Android embarqué.
 * Navigateur réel (Chromium), vraie IndexedDB, données 100 % synthétiques,
 * aucune connexion à Supabase (client simulé dans la page).
 *
 * Preuves :
 *  1. une opération créée par l'utilisateur A n'est PAS envoyée quand B est connecté ;
 *  2. B ne voit pas la file de A, mais le compteur other_users_open la signale ;
 *  3. A, reconnecté, synchronise bien sa propre opération ;
 *  4. le cache de référentiels de A n'est pas lisible par B ;
 *  5. un cache préparé AVANT cette garde (sans propriétaire) reste lisible (pas de régression) ;
 *  6. prepareShell() : pont natif complet => native_bundle true ; pont incomplet => false ;
 *     sans pont (navigateur) => chemin Service Worker inchangé.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT_OFFLINE_MU || 4351);
const CAMP = '10000000-0000-4000-8000-000000000097';
const UA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const UB = 'bbbbbbbb-0000-4000-8000-00000000000b';

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Test isolation</title></head>
<body><p id="t">test</p><script src="/shared/offline-field.js"></script></body></html>`;

function server() {
  return createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/__mu_test__.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
}

/* Utilisateur et pont natif pilotés par sessionStorage (persistant entre rechargements). */
const STUB = String.raw`
(function(){
  var cfg = JSON.parse(sessionStorage.getItem('mu_cfg') || '{}');
  var uid = cfg.uid || null;
  window.ANAGROCI_SUPABASE_URL = 'https://example.invalid';
  window.ANAGROCI_SUPABASE_ANON = 'cle-fictive';
  window.ANAGROCI_CAMPAIGN = { id: function(){ return '${CAMP}'; }, code: function(){ return '2097'; } };
  if (uid) window.ANAGROCI_AUTH = { profile: { user_id: uid, nom: 'QA FICTIF', role: 'Unit Head', actif: true } };
  if (cfg.native) window.AnagrociNative = { shellStatus: function(){ return JSON.stringify(cfg.native); } };
  var sent = JSON.parse(sessionStorage.getItem('mu_sent') || '[]');
  var client = {
    auth: { getSession: function(){ return Promise.resolve({ data: { session: uid ? { user: { id: uid } } : null }, error: null }); } },
    rpc: function(name, args){
      if (name !== 'offline_sync_batch') return Promise.resolve({ data: null, error: null });
      var ops = args.p_operations || [];
      ops.forEach(function(o){ sent.push({ by: uid, key: o.idempotency_key }); });
      sessionStorage.setItem('mu_sent', JSON.stringify(sent));
      return Promise.resolve({ data: { results: ops.map(function(o){ return { idempotency_key: o.idempotency_key, client_operation_id: o.client_operation_id, status: 'SYNCED' }; }) }, error: null });
    },
    from: function(){ var q = { select: function(){ return q; }, eq: function(){ return q; }, then: function(ok){ return Promise.resolve({ data: [], error: null }).then(ok); } }; return q; }
  };
  window.supabase = { createClient: function(){ return client; } };
})();
`;

async function main() {
  const srv = server(); await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ content: STUB });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = `http://127.0.0.1:${PORT}/__mu_test__.html`;
  const as = async (cfg) => {
    await page.evaluate(c => sessionStorage.setItem('mu_cfg', JSON.stringify(c)), cfg);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ANAGROCI_OFFLINE);
    await page.evaluate(() => ANAGROCI_OFFLINE.ready());
  };
  const results = [];
  const ok = (id, label) => { results.push({ id, label, status: 'PASS' }); console.log('PASS', id, label); };

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => { sessionStorage.clear(); indexedDB.deleteDatabase('anagroci_ops_offline'); });

    /* Cache "ancien format" sans propriétaire, écrit directement (simulation d'une version antérieure). */
    await as({});
    await page.evaluate(async (camp) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('anagroci_ops_offline', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      await new Promise((res, rej) => { const t = db.transaction('bundles', 'readwrite'); t.objectStore('bundles').put({ key: 'legacy_ref:' + camp, name: 'legacy_ref', campaign_id: camp, cached_at: new Date().toISOString(), value: { villages: 1 } }); t.oncomplete = res; t.onerror = () => rej(t.error); });
      db.close();
    }, CAMP);

    /* Utilisateur A, hors ligne : crée une opération et un cache. */
    await as({ uid: UA });
    await ctx.setOffline(true);
    const opA = await page.evaluate(async () => {
      await ANAGROCI_OFFLINE.setBundle('field_base', { owner: 'A', villages: ['V-FICTIF-A'] });
      const op = await ANAGROCI_OFFLINE.queue('FIELD_GPS_UPDATE', { row: { producteur_id: 'p-fictif' } }, { label: 'op A' });
      return op;
    });
    assert.equal(opA.user_id, UA, 'opération horodatée au nom de A');
    const legacyA = await page.evaluate(() => ANAGROCI_OFFLINE.getBundle('legacy_ref'));
    assert.deepEqual(legacyA, { villages: 1 }, 'cache sans propriétaire toujours lisible');
    ok('MU-05', 'Cache préparé avant la garde (sans propriétaire) toujours lisible');

    /* Utilisateur B se connecte sur le même téléphone, réseau revenu. */
    await ctx.setOffline(false);
    await as({ uid: UB });
    const sB = await page.evaluate(async () => {
      const r = await ANAGROCI_OFFLINE.syncNow().catch(e => ({ err: e.message }));
      return { r, list: (await ANAGROCI_OFFLINE.list()).length, sum: await ANAGROCI_OFFLINE.summary(), bundle: await ANAGROCI_OFFLINE.getBundle('field_base') };
    });
    const sentAfterB = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mu_sent') || '[]'));
    assert.equal(sentAfterB.length, 0, 'aucune opération de A envoyée sous la session de B');
    ok('MU-01', 'Opération de A non envoyée sous la session de B');
    assert.equal(sB.list, 0, 'B ne voit pas la file de A');
    assert.equal(sB.sum.pending, 0);
    assert.equal(sB.sum.other_users_open, 1, 'la file de A reste signalée');
    ok('MU-02', 'B ne voit pas la file de A ; other_users_open = 1');
    assert.equal(sB.bundle, null, 'cache de A illisible par B');
    ok('MU-04', 'Cache référentiel de A illisible par B');

    /* A revient : sa propre opération part, une seule fois. */
    await as({ uid: UA });
    const sA = await page.evaluate(async () => {
      await ANAGROCI_OFFLINE.syncNow();
      const ops = await ANAGROCI_OFFLINE.list();
      return { status: ops.map(o => o.status), bundle: await ANAGROCI_OFFLINE.getBundle('field_base') };
    });
    const sent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mu_sent') || '[]'));
    assert.equal(sent.length, 1); assert.equal(sent[0].by, UA); assert.equal(sent[0].key, opA.idempotency_key);
    assert.deepEqual(sA.status, ['SYNCED']);
    assert.equal(sA.bundle.owner, 'A');
    ok('MU-03', 'A reconnecté synchronise sa propre opération (1 envoi, clé conservée)');

    /* Pont natif Android. */
    await as({ uid: UA, native: { bundled: true, version: '1.0.0', missing: [] } });
    const nOk = await page.evaluate(() => ANAGROCI_OFFLINE.prepareShell());
    assert.equal(nOk.native_bundle, true); assert.equal(nOk.precache_confirmed, true);
    await as({ uid: UA, native: { bundled: false, missing: ['operations/field-buying.js'] } });
    const nKo = await page.evaluate(() => ANAGROCI_OFFLINE.prepareShell());
    assert.equal(nKo.native_bundle, false); assert.deepEqual(nKo.missing, ['operations/field-buying.js']);
    await as({ uid: UA });
    const web = await page.evaluate(() => ANAGROCI_OFFLINE.nativeShell());
    assert.equal(web, null, 'navigateur : chemin Service Worker inchangé');
    ok('MU-06', 'prepareShell : pont natif complet/incomplet/absent');

    assert.deepEqual(errors, [], 'aucune erreur JavaScript');
    console.log(JSON.stringify({ suite: 'offline-field-multi-user', results, data_real_used: false }, null, 2));
  } finally {
    await browser.close(); srv.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
