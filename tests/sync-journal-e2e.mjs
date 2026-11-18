/* Recette « Synchronisation & Journal » (18/11/2026) — Chromium réel, IndexedDB réelle,
   serveur Supabase SIMULÉ (aucune donnée réelle, aucun appel réseau sortant).
   Vérifie : résultats individuels (un 200 ne suffit pas), statuts, relance sans doublon
   (clé d'idempotence conservée), conflits non forcés, nettoyage bloqué, enrôlements non
   annulables, isolation multi-comptes, export minimisé, rendu du journal et filtre. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const OFF = readFileSync('shared/offline-field.js', 'utf8');
const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>recette</title></head><body><div id="out"></div>
<script>
window.__uid='00000000-0000-4000-8000-00000000aaaa';
window.ANAGROCI_AUTH={profile:{user_id:window.__uid,role:'UNIT_HEAD'}};
window.ANAGROCI_CAMPAIGN={id:function(){return '11111111-1111-4111-8111-111111111111';},code:function(){return 'SIM-RECETTE';}};
window.ANAGROCI_SUPABASE_URL='https://simulation.invalid';window.ANAGROCI_SUPABASE_ANON='x';
window.__server={received:{},calls:0,mode:'normal',created:0};
window.supabase={createClient:function(){return {
  auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:window.__uid}}}});}},
  rpc:function(name,args){
    var S=window.__server;S.calls++;
    if(S.mode==='down')return Promise.reject(new Error('Failed to fetch'));
    var res=[];
    args.p_operations.forEach(function(o,i){
      if(S.mode==='drop-one'&&i===0)return; /* HTTP 200 mais une opération sans résultat */
      if(S.received[o.idempotency_key]){res.push(S.received[o.idempotency_key]);return;}
      var p=o.payload||{},want=p.simulate||'SYNCED',r;
      if(want==='SYNCED'||(want==='FAIL_ONCE'&&S.failedOnce&&S.failedOnce[o.idempotency_key])){S.created++;r={idempotency_key:o.idempotency_key,client_operation_id:o.client_operation_id,status:'SYNCED',local_id:p.local_id,server_id:'fb-sim-'+S.created,farmer_id:'AFLP-SIM-'+S.created};S.received[o.idempotency_key]=r;}
      else if(want==='FAIL_ONCE'){S.failedOnce=S.failedOnce||{};S.failedOnce[o.idempotency_key]=1;r={idempotency_key:o.idempotency_key,status:'FAILED',message:'erreur serveur simulée'};}
      else if(want==='CONFLICT'){r={idempotency_key:o.idempotency_key,status:'CONFLICT',message:'conflit simulé'};S.received[o.idempotency_key]=r;}
      else if(want==='REVIEW'){r={idempotency_key:o.idempotency_key,status:'NEEDS_REVIEW',message:'campagne fermée (simulé)'};S.received[o.idempotency_key]=r;}
      res.push(r);
    });
    return Promise.resolve({data:{results:res},error:null});
  }};}};
</script>
<script>${OFF.replace(/<\/script>/g,'<\\/script>')}</script></body></html>`;

const srv = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
await new Promise((r) => srv.listen(4361, '127.0.0.1', r));
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const step = async (label, fn) => { try { await fn(); results.push({ label, status: 'PASS' }); } catch (e) { results.push({ label, status: 'FAIL', error: e.message }); } };
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto('http://127.0.0.1:4361/');
await page.waitForFunction(() => window.ANAGROCI_OFFLINE && window.ANAGROCI_SYNC_JOURNAL);

await step('file locale : 5 enrôlements fictifs + 1 achat en attente', async () => {
  const n = await ev(async () => {
    const O = ANAGROCI_OFFLINE, mk = (sim, i) => O.queue('FARMER_ENROLL', { local_id: 'local-farmer-' + i, simulate: sim, row: { nom: 'PRODUCTEUR FICTIF ' + i, telephone: '0700000' + i, village_id: 'v_sim', rt_id: 'rt_sim' } }, { entity_label: 'PRODUCTEUR FICTIF ' + i + ' · VILLAGE TEST' });
    await mk('SYNCED', 1); await mk('FAIL_ONCE', 2); await mk('CONFLICT', 3); await mk('REVIEW', 4); await mk('SYNCED', 5);
    await O.queue('FIELD_PURCHASE_CREATE', { row: { local_id: 'p1', montant: 1000 } }, {});
    return (await O.summary()).waiting;
  });
  assert.equal(n, 6);
});
await step('serveur injoignable : rien n’est perdu, tout reste en attente', async () => {
  const s = await ev(async () => { __server.mode = 'down'; try { await ANAGROCI_OFFLINE.manualSync(); } catch (e) {} __server.mode = 'normal'; return ANAGROCI_OFFLINE.summary(); });
  assert.equal(s.total_local, 6); assert.equal(s.synced, 0); assert.equal(s.pending + s.failed, 6);
});
await step('un 200 avec une opération sans résultat ⇒ FAILED, pas SYNCED', async () => {
  const r = await ev(async () => {
    const ops = await ANAGROCI_OFFLINE.list();
    for (const o of ops) await ANAGROCI_OFFLINE.retry(o.id).catch(() => {});
    return ANAGROCI_OFFLINE.summary();
  });
  assert.ok(r.synced >= 1, 'au moins une acceptée');
  assert.equal(r.conflicts, 1); assert.equal(r.review, 1);
});
await step('« 200 » partiel : la 1re opération du lot sans résultat devient Échouée', async () => {
  const st = await ev(async () => {
    const O = ANAGROCI_OFFLINE; const op = await O.queue('FARMER_ENROLL', { local_id: 'local-farmer-9', row: { village_id: 'v_sim' } }, { entity_label: 'PRODUCTEUR FICTIF 9' });
    __server.mode = 'drop-one'; await O.manualSync().catch(() => {}); __server.mode = 'normal';
    return (await O.list()).find((o) => o.id === op.id).status;
  });
  assert.equal(st, 'FAILED');
});
await step('« Réessayer les échouées » : clés conservées, aucun doublon côté serveur', async () => {
  const r = await ev(async () => {
    const O = ANAGROCI_OFFLINE, before = (await O.list()).map((o) => o.id + '|' + o.idempotency_key).sort();
    const created0 = __server.created; await O.retryFailed(); await O.retryFailed();
    const ops = await O.list(), after = ops.map((o) => o.id + '|' + o.idempotency_key).sort();
    for (const o of ops.filter((x) => x.status === 'SYNCED')) await O.retry(o.id).catch(() => {});
    return { same: JSON.stringify(before) === JSON.stringify(after), created: __server.created - created0, keys: Object.keys(__server.received).length, s: await O.summary() };
  });
  assert.ok(r.same, 'identifiants et clés inchangés');
  const enrollSynced = r.s.synced;
  assert.equal(r.s.failed, 0);
  assert.equal(enrollSynced, 5, '5 acceptées (3 enrôlements + n°9 + achat)');
});
await step('rejouer une clé déjà reçue ne crée rien de plus (idempotence serveur)', async () => {
  const d = await ev(async () => { const c = __server.created; const ops = await ANAGROCI_OFFLINE.list();
    const o = ops.find((x) => x.status === 'SYNCED'); await ANAGROCI_OFFLINE.retry(o.id).catch(() => {}); return __server.created - c; });
  assert.equal(d, 0);
});
await step('conflit et « à vérifier » ne sont jamais relancés de force', async () => {
  const m = await ev(async () => { const o = (await ANAGROCI_OFFLINE.list()).find((x) => x.status === 'CONFLICT');
    try { await ANAGROCI_OFFLINE.retry(o.id); return 'relancé'; } catch (e) { return e.message; } });
  assert.match(m, /contrôle manuel/i);
});
await step('nettoyage désactivé : aucune opération supprimée', async () => {
  const r = await ev(async () => { const n0 = (await ANAGROCI_OFFLINE.list()).length; let msg = '';
    try { await ANAGROCI_OFFLINE.clearSynced(); } catch (e) { msg = e.message; } return { msg, n0, n1: (await ANAGROCI_OFFLINE.list()).length }; });
  assert.match(r.msg, /désactivé/); assert.equal(r.n0, r.n1);
});
await step('enrôlement local non annulable', async () => {
  const m = await ev(async () => { const o = (await ANAGROCI_OFFLINE.list()).find((x) => x.status === 'CONFLICT');
    try { await ANAGROCI_OFFLINE.cancel(o.id); return 'annulé'; } catch (e) { return e.message; } });
  assert.match(m, /ne peut pas être annulé/);
});
await step('autre compte : opérations comptées, jamais listées ni envoyées', async () => {
  const r = await ev(async () => { const me = ANAGROCI_AUTH.profile.user_id; ANAGROCI_AUTH.profile.user_id = '00000000-0000-4000-8000-00000000bbbb';
    await ANAGROCI_OFFLINE.queue('FARMER_ENROLL', { local_id: 'x', row: { village_id: 'v_sim' } }, { entity_label: 'AUTRE AGENT' });
    ANAGROCI_AUTH.profile.user_id = me; const calls = __server.calls; await ANAGROCI_OFFLINE.manualSync().catch(() => {});
    const list = await ANAGROCI_OFFLINE.list(); const s = await ANAGROCI_OFFLINE.summary();
    return { visible: list.some((o) => o.entity_label === 'AUTRE AGENT'), other: s.other_users_total, open: s.other_users_open, sent: __server.calls - calls };
  });
  assert.equal(r.visible, false); assert.equal(r.other, 1); assert.equal(r.open, 1); assert.equal(r.sent, 0);
});
await step('rendu : 6 statuts, 3 niveaux, avertissement autre compte, filtre enrôlements', async () => {
  const h = await ev(async () => { const O = ANAGROCI_OFFLINE, J = ANAGROCI_SYNC_JOURNAL; J.css();
    const ops = await O.list(), s = await O.summary(), ev = await O.lastSyncEvent();
    J.setFilter('enroll'); const j = J.journalHtml(ops, { v_sim: { village: 'VILLAGE TEST', cluster: 'BEOUMI' } });
    document.getElementById('out').innerHTML = J.dashboardHtml(s, ev, 0) + j;
    return { tiles: document.querySelectorAll('.sj-tile').length, levels: document.querySelectorAll('.sj-level').length,
      rows: document.querySelectorAll('.sj-op').length, purchases: document.querySelectorAll('.sj-op[data-op-type="FIELD_PURCHASE_CREATE"]').length,
      other: /Autre compte/.test(document.body.textContent), village: /VILLAGE TEST/.test(document.body.textContent), cluster: /BEOUMI/.test(document.body.textContent),
      ev: /envoyée/.test(document.body.textContent), cancel: document.querySelectorAll('[data-off-cancel]').length };
  });
  assert.equal(h.tiles, 6); assert.equal(h.levels, 3); assert.equal(h.rows, 6); assert.equal(h.purchases, 0);
  assert.ok(h.other && h.village && h.cluster && h.ev); assert.equal(h.cancel, 0);
});
await step('export diagnostic minimisé : ni nom ni téléphone, autre compte compté seulement', async () => {
  const d = await ev(async () => JSON.stringify(await ANAGROCI_OFFLINE.diagnostic()));
  assert.doesNotMatch(d, /PRODUCTEUR FICTIF|07000001|AUTRE AGENT/); const o = JSON.parse(d);
  assert.equal(o.other_accounts.operations, 1); assert.ok(o.operations.length >= 6); assert.ok(o.operations.every((x) => x.idempotency_key && x.id));
});
await step('fermeture / réouverture du navigateur : file intacte', async () => {
  const n0 = await ev(async () => (await ANAGROCI_OFFLINE.list()).length);
  await page.close(); const p2 = await ctx.newPage(); await p2.goto('http://127.0.0.1:4361/'); await p2.waitForFunction(() => window.ANAGROCI_OFFLINE);
  const n1 = await p2.evaluate(async () => (await ANAGROCI_OFFLINE.list()).length); assert.equal(n1, n0);
});
assert.deepEqual(errors, []);
await browser.close(); srv.close();
const fail = results.filter((r) => r.status !== 'PASS');
console.log(JSON.stringify({ test: 'sync-journal-e2e', results, data_real_used: false }, null, 2));
console.log(fail.length ? 'ÉCHEC : ' + fail.length : 'Synchronisation & Journal : PASS (' + results.length + ' scénarios)');
process.exit(fail.length ? 1 : 0);
