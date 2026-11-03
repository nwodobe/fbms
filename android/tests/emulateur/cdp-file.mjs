#!/usr/bin/env node
/**
 * Aide de recette émulateur (APK DEBUG uniquement) : parle à la WebView par le protocole
 * de débogage Chrome (adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>).
 *   node cdp-file.mjs <port> injecter   -> ajoute 3 opérations SYNTHÉTIQUES « PENDING » dans la file locale
 *   node cdp-file.mjs <port> lire       -> nombre d'opérations par statut, version Web servie, marqueur de démo
 * Aucune donnée réelle : opérations marquées RECETTE-SYNTHETIQUE, jamais synchronisables (aucune session).
 * Node 22+ (WebSocket natif).
 */
const [port = '9333', action = 'lire'] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => /field-buying\.html/.test(t.url)) || list[0];
if (!target) { console.log('Aucune page WebView'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const evaluate = (expression) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });

const READ = `(async () => {
  const open = () => new Promise((r, j) => { const q = indexedDB.open('anagroci_ops_offline'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const db = await open(); const stores = [...db.objectStoreNames];
  const st = 'operations';
  const rows = await new Promise((r) => { const q = db.transaction(st).objectStore(st).getAll(); q.onsuccess = () => r(q.result); });
  const by = {}; rows.forEach((o) => { by[o.status] = (by[o.status] || 0) + 1; });
  const synth = rows.filter((o) => o.payload && o.payload.recette === 'RECETTE-SYNTHETIQUE').map((o) => o.client_operation_id + ':' + o.status);
  const src = await (await fetch('/operations/field-buying.html')).text();
  return { store: st, total: rows.length, by_status: by, synthetiques: synth, marqueur_demo: (src.match(/DEMO-UNIFICATION[^<]*/) || [null])[0],
    web_version: (window.AnagrociNative ? JSON.parse(AnagrociNative.updateStatus()).active_web_version : null) };
})()`;
const INJECT = `(async () => {
  const open = () => new Promise((r, j) => { const q = indexedDB.open('anagroci_ops_offline'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const db = await open(); const st = 'operations';
  const tx = db.transaction(st, 'readwrite'); const s = tx.objectStore(st);
  for (let i = 1; i <= 3; i++) s.put({ id: crypto.randomUUID(), client_operation_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), operation_type: 'RECETTE_SYNTHETIQUE',
    status: 'PENDING', created_at_client: new Date().toISOString(), payload: { recette: 'RECETTE-SYNTHETIQUE', n: i } });
  await new Promise((r) => { tx.oncomplete = r; });
  return 'ok';
})()`;
if (action === 'injecter') console.log(JSON.stringify((await evaluate(INJECT)).result?.result?.value));
console.log(JSON.stringify((await evaluate(READ)).result?.result?.value, null, 1));
ws.close();
