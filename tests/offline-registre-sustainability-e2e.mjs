#!/usr/bin/env node
/**
 * Hors ligne · Farmer Registry (parcelles, Sustainability, inspections) et file Field Buying.
 * Navigateur réel (Chromium via Playwright), vrais moteurs :
 *   shared/farmer-registry-sync.js et shared/offline-field.js.
 * Serveur Supabase SIMULÉ en mémoire (données 100 % synthétiques, aucune connexion réseau).
 * Ce test ne vaut PAS validation sur téléphone Android physique.
 *
 * Scénarios :
 *  R1 parcelle hors ligne avec précision GPS       R6 précision GPS reçue par le serveur
 *  R2 baseline Sustainability 25 réponses           R7 rejeu : aucun doublon
 *  R3 inspection + réponses hors ligne              R8 changement de compte (registre)
 *  R4 conservation après fermeture de la page       (changement de compte Field Buying : PR #262,
 *                                                    tests/offline-field-multi-user-e2e.mjs)
 *  R5 synchronisation interrompue puis reprise      F2 interruption réseau puis reprise, idempotence
 *
 * Usage : node tests/offline-registre-sustainability-e2e.mjs
 *         CHROMIUM_PATH=/chemin/chrome node tests/offline-registre-sustainability-e2e.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT_OFFLINE_REG || 4341);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const CAMPAIGN = '10000000-0000-4000-8000-000000000001';
const QUESTIONS = Array.from({ length: 25 }, (_, i) => 'Q' + String(i + 1).padStart(2, '0'));

/* Page de banc : bouchon Supabase en mémoire + chargement des vrais moteurs. */
const HARNESS = String.raw`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Banc hors ligne</title>
<script>
(function(){
  var S = window.__srv = { tables: {}, calls: [], failNext: 0, failAt: 0, writes: 0, failRpc: 0, receipts: {}, batches: [], session: '${USER_A}' };
  function tbl(n){ return S.tables[n] || (S.tables[n] = {}); }
  function q(table){
    var st = { table: table, op: null, payload: null, filters: [] };
    var api = {
      upsert: function(p){ st.op='upsert'; st.payload=p; return api; },
      insert: function(p){ st.op='insert'; st.payload=p; return api; },
      select: function(){ if(!st.op) st.op='select'; return api; },
      eq: function(k,v){ st.filters.push([k,v]); return api; },
      order: function(){ return api; }, limit: function(){ return api; },
      maybeSingle: function(){ return run(true); }, single: function(){ return run(true); },
      then: function(res, rej){ return run(false).then(res, rej); }
    };
    function run(one){
      S.calls.push({ table: st.table, op: st.op, id: st.payload && st.payload.id, user: S.session });
      if (st.op==='upsert'||st.op==='insert') S.writes++;
      if ((st.op==='upsert'||st.op==='insert') && ((S.failNext > 0 && S.failNext--) || (S.failAt && S.writes === S.failAt))) { return Promise.resolve({ data:null, error:{ message:'Failed to fetch (coupure simulée)' } }); }
      var t = tbl(st.table);
      if (st.op==='upsert'||st.op==='insert') {
        var row = Object.assign({}, t[st.payload.id] || {}, st.payload, { created_by: (t[st.payload.id]||{}).created_by || S.session });
        t[st.payload.id] = row; return Promise.resolve({ data: one ? row : [row], error: null });
      }
      var rows = Object.values(t).filter(function(r){ return st.filters.every(function(f){ return r[f[0]]===f[1]; }); });
      return Promise.resolve({ data: one ? (rows[0]||null) : rows, error: null });
    }
    return api;
  }
  var client = {
    from: q,
    auth: { getSession: function(){ return Promise.resolve({ data: { session: S.session ? { user: { id: S.session } } : null } }); } },
    rpc: function(name, args){
      S.calls.push({ rpc: name, user: S.session });
      if (name !== 'offline_sync_batch') return Promise.resolve({ data: null, error: null });
      if (S.failRpc > 0) { S.failRpc--; return Promise.reject(new Error('Failed to fetch (coupure simulée)')); }
      var ops = args.p_operations || []; S.batches.push(ops.map(function(o){ return o.idempotency_key; }));
      var results = ops.map(function(o){
        var dup = !!S.receipts[o.idempotency_key];
        if (!dup) S.receipts[o.idempotency_key] = { user: S.session, type: o.operation_type };
        return { idempotency_key: o.idempotency_key, client_operation_id: o.client_operation_id, status: 'SYNCED', replay: dup };
      });
      return Promise.resolve({ data: { results: results }, error: null });
    }
  };
  window.SB = client;
  window.AUTH = { isConnected: function(){ return !!S.session; } };
  window.ANAGROCI_AUTH = { profile: { user_id: S.session } };
  window.supabase = { createClient: function(){ return client; } };
  window.ANAGROCI_SUPABASE_URL = 'https://bouchon.invalid'; window.ANAGROCI_SUPABASE_ANON = 'cle-bouchon';
  window.ANAGROCI_CAMPAIGN = { id: function(){ return '${CAMPAIGN}'; }, code: function(){ return '2097'; } };
  window.__setUser = function(u){ S.session = u; window.ANAGROCI_AUTH.profile.user_id = u; };
})();
</script>
<script src="/shared/farmer-registry-sync.js"></script>
<script src="/shared/offline-field.js"></script>
</head><body>banc</body></html>`;

function server() {
  return createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/__banc_hors_ligne.html') { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(HARNESS); return; }
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
}

async function main() {
  const srv = server(); await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const url = `http://127.0.0.1:${PORT}/__banc_hors_ligne.html`;
  const out = {};
  let page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(url); await page.waitForFunction(() => window.AFLP_FARMER_REGISTRY && window.AFLP_FARMER_REGISTRY.syncEngine && window.ANAGROCI_OFFLINE);
    await ctx.setOffline(true);
    const PID = 'producteur-fictif-1', PLOT = 'aaaaaaaa-0000-4000-8000-000000000001', SB_ID = 'bbbbbbbb-0000-4000-8000-000000000001', IN_ID = 'cccccccc-0000-4000-8000-000000000001';

    /* R1-R3 : saisies hors ligne */
    const local = await page.evaluate(async ({ PID, PLOT, SB_ID, IN_ID, QUESTIONS }) => {
      const E = window.AFLP_FARMER_REGISTRY.syncEngine;
      await E.save('farmer_plots', { id: PLOT, producteur_id: PID, village_id: 'v-fictif', local_name: 'PARCELLE FICTIVE', declared_area: 1.5, area_unit: 'HA',
        latitude: 7.6, longitude: -5.0, gps_accuracy_m: 6.5, gps_captured_at: new Date().toISOString(), gps_status: 'POINT_CAPTURED', area_source: 'DECLARED', evidence_level: 'DECLARED', status: 'ACTIVE' }, { producteur_id: PID });
      await E.save('farmer_sustainability_baselines', { id: SB_ID, producteur_id: PID, plot_id: PLOT, campaign: '2097', catalog_version: 'AFLP-SUST-2026.2', status: 'DRAFT' }, { producteur_id: PID });
      for (const q of QUESTIONS) await E.save('farmer_sustainability_answers', { id: crypto.randomUUID(), baseline_id: SB_ID, question_code: q, catalog_version: 'AFLP-SUST-2026.2', answer: 'NOT_VERIFIED', evidence_level: 'OBSERVED', producteur_id: PID }, { producteur_id: PID });
      await E.save('farmer_inspections', { id: IN_ID, producteur_id: PID, plot_id: PLOT, inspection_type: 'BASELINE_CHECK', catalog_version: 'AFLP-SUST-2026.2', status: 'DRAFT', latitude: 7.6, longitude: -5.0, gps_accuracy_m: 9 }, { producteur_id: PID });
      for (const q of QUESTIONS.slice(0, 5)) await E.save('farmer_inspection_answers', { id: crypto.randomUUID(), inspection_id: IN_ID, question_code: q, catalog_version: 'AFLP-SUST-2026.2', answer: 'YES', evidence_level: 'OBSERVED', producteur_id: PID }, { producteur_id: PID });
      const ob = await E.listOutbox();
      const plots = await E.listCache('farmer_plots', PID);
      return { outbox: ob.length, userIds: [...new Set(ob.map(o => o.user_id))], plotStatus: plots[0] && plots[0]._sync_status, serverCalls: window.__srv.calls.length };
    }, { PID, PLOT, SB_ID, IN_ID, QUESTIONS });
    assert.equal(local.outbox, 1 + 1 + 25 + 1 + 5, 'R1-R3 : 33 opérations locales attendues');
    assert.equal(local.serverCalls, 0, 'aucun appel serveur hors ligne');
    assert.equal(local.plotStatus, 'LOCAL', 'parcelle marquée LOCAL');
    assert.deepEqual(local.userIds, [USER_A], 'chaque opération porte le compte auteur');
    out.R1_R3_saisies_hors_ligne = local;

    /* R4 : fermeture / réouverture hors réseau */
    await page.close(); page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url).catch(() => {});
    const reopened = await page.evaluate(async () => (await window.AFLP_FARMER_REGISTRY.syncEngine.listOutbox()).length).catch(() => null);
    /* La page de banc elle-même n'est pas servie hors ligne (pas de Service Worker ici) : on la recharge en ligne
       mais sans laisser le moteur synchroniser (session coupée), pour lire IndexedDB. */
    let reopenedCount = reopened;
    if (reopenedCount === null) {
      await ctx.setOffline(false);
      await page.goto(url); await page.evaluate(() => window.__setUser(null));
      reopenedCount = await page.evaluate(async () => (await window.AFLP_FARMER_REGISTRY.syncEngine.listOutbox()).length);
    }
    assert.equal(reopenedCount, 33, 'R4 : la file survit à la fermeture de la page');
    out.R4_conservation_file = reopenedCount;

    /* R5 : retour réseau avec coupure au 2e envoi, puis reprise */
    await ctx.setOffline(false);
    const r5 = await page.evaluate(async () => {
      const E = window.AFLP_FARMER_REGISTRY.syncEngine;
      window.__setUser('00000000-0000-4000-8000-00000000000a');
      window.__srv.calls.length = 0; window.__srv.writes = 0; window.__srv.failAt = 2; /* coupure au 2e envoi */
      const ok1 = await E.sync();
      window.__srv.failAt = 0;
      const after1 = await E.listOutbox();
      const ok2 = await E.sync();
      const after2 = await E.listOutbox();
      return { ok1, restant1: after1.length, erreurs1: after1.filter(o => o.status === 'SYNC_ERROR').length, ok2, restant2: after2.length };
    });
    assert.equal(r5.ok1, false, 'R5 : la coupure est signalée');
    assert.ok(r5.restant1 > 0 && r5.restant1 < 33, 'R5 : opérations non envoyées conservées');
    assert.ok(r5.erreurs1 >= 1, 'R5 : erreur visible sur l’opération coupée');
    assert.equal(r5.ok2, true, 'R5 : reprise réussie');
    assert.equal(r5.restant2, 0, 'R5 : file vidée après reprise');
    out.R5_interruption_reprise = r5;

    /* R6-R7 : précision GPS côté serveur, absence de doublons */
    const r67 = await page.evaluate(async ({ PLOT }) => {
      const S = window.__srv, E = window.AFLP_FARMER_REGISTRY.syncEngine;
      const plot = S.tables.farmer_plots[PLOT];
      const counts = Object.fromEntries(Object.entries(S.tables).map(([k, v]) => [k, Object.keys(v).length]));
      await E.save('farmer_plots', { id: PLOT, producteur_id: plot.producteur_id, village_id: 'v-fictif', declared_area: 1.5, gps_accuracy_m: 6.5, latitude: 7.6, longitude: -5.0, gps_status: 'POINT_CAPTURED', status: 'ACTIVE' }, { producteur_id: plot.producteur_id });
      await E.sync();
      return { gps_accuracy_m: plot.gps_accuracy_m, inspection_acc: Object.values(S.tables.farmer_inspections)[0].gps_accuracy_m, counts, plotsApresRejeu: Object.keys(S.tables.farmer_plots).length, auteur: plot.created_by };
    }, { PLOT });
    assert.equal(r67.gps_accuracy_m, 6.5, 'R6 : précision GPS de la parcelle reçue par le serveur');
    assert.equal(r67.inspection_acc, 9, 'R6 : précision GPS de l’inspection reçue');
    assert.equal(r67.counts.farmer_sustainability_answers, 25, 'R7 : 25 réponses, aucune en double');
    assert.equal(r67.counts.farmer_inspection_answers, 5);
    assert.equal(r67.plotsApresRejeu, 1, 'R7 : rejeu de la parcelle sans doublon');
    assert.equal(r67.auteur, USER_A, 'imputation au compte auteur');
    out.R6_R7_gps_doublons = r67;

    /* R8 : changement de compte (registre) */
    await ctx.setOffline(true);
    const r8 = await page.evaluate(async () => {
      const E = window.AFLP_FARMER_REGISTRY.syncEngine, S = window.__srv;
      await E.save('farmer_visits', { id: crypto.randomUUID(), producteur_id: 'producteur-fictif-2', visit_type: 'FOLLOW_UP' }, { producteur_id: 'producteur-fictif-2' });
      return { outbox: (await E.listOutbox()).length };
    });
    /* Changement de compte AVANT le retour réseau : la synchronisation automatique
       déclenchée par l'événement « online » tourne alors sous le compte B. */
    await page.evaluate(() => { window.__setUser('00000000-0000-4000-8000-00000000000b'); window.__srv.calls.length = 0; });
    await ctx.setOffline(false);
    await page.waitForTimeout(800);
    const r8b = await page.evaluate(async () => {
      const E = window.AFLP_FARMER_REGISTRY.syncEngine, S = window.__srv;
      await E.sync();
      const envoyesSousB = S.calls.filter(c => c.table === 'farmer_visits').length;
      const resteSousB = (await E.listOutbox()).length;
      window.__setUser('00000000-0000-4000-8000-00000000000a');
      await E.sync();
      return { envoyesSousB, resteSousB, resteApresRetourA: (await E.listOutbox()).length, auteurServeur: Object.values(S.tables.farmer_visits || {})[0]?.created_by };
    });
    assert.equal(r8.outbox, 1);
    assert.equal(r8b.envoyesSousB, 0, 'R8 : la saisie du compte A n’est jamais envoyée sous le compte B');
    assert.equal(r8b.resteSousB, 1, 'R8 : elle reste conservée localement');
    assert.equal(r8b.resteApresRetourA, 0, 'R8 : envoyée au retour du compte A');
    assert.equal(r8b.auteurServeur, USER_A, 'R8 : imputée au bon compte');
    out.R8_changement_compte_registre = r8b;

    /* F2 : file Field Buying (offline-field.js) : coupure réseau, reprise, idempotence */
    const f = await page.evaluate(async () => {
      const O = window.ANAGROCI_OFFLINE, S = window.__srv;
      await O.ready();
      window.__setUser('00000000-0000-4000-8000-00000000000a');
      const opA = await O.queue('FIELD_PURCHASE_CREATE', { row: { local_id: 'achat-fictif-1', montant: 0 } }, { label: 'Achat fictif' });
      window.__setUser('00000000-0000-4000-8000-00000000000a');
      S.failRpc = 1;
      let interrompu = false; await O.syncNow().catch(() => { interrompu = true; });
      const apresCoupure = (await O.list()).find(o => o.id === opA.id).status;
      await O.retry(opA.id).catch(() => {});
      const apresReprise = (await O.list()).find(o => o.id === opA.id).status;
      const recus = Object.keys(S.receipts).filter(k => k === opA.idempotency_key).length;
      return { interrompu, apresCoupure, apresReprise, recus };
    });
    assert.equal(f.interrompu, true, 'F2 : coupure réseau signalée');
    assert.equal(f.apresCoupure, 'PENDING', 'F2 : opération conservée après coupure');
    assert.equal(f.apresReprise, 'SYNCED', 'F2 : synchronisée à la reprise');
    assert.equal(f.recus, 1, 'F2 : un seul reçu serveur (idempotence)');
    out.F2_field_buying_interruption = f;

    assert.deepEqual(errors, [], 'aucune erreur JavaScript');
    console.log(JSON.stringify({ result: 'PASS', ...out, android_physique: 'NON EXÉCUTÉ', data_real_used: false }, null, 2));
  } finally {
    await browser.close(); srv.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
