#!/usr/bin/env node
/**
 * Recette émulateur « Synchronisation & Journal » (APK DEBUG uniquement, données FICTIVES).
 *   node recette-journal.mjs <port> <action> [arg]
 *   fixture <ROLE>   session et profil FICTIFS en cache (mode hors ligne), aucun compte réel
 *   injecter         7 opérations fictives (6 enrôlements de statuts variés + 1 d'un autre compte)
 *   enroler          1 enrôlement fictif via le moteur de l'application (ANAGROCI_OFFLINE.queue)
 *   lire             état de la file + contrôles de l'écran courant
 *   aller <url>      navigation dans la WebView
 *   eval <js>        expression libre (diagnostic)
 * Utilisateur fictif : 00000000-0000-4000-8000-0000000000a1. Aucun appel serveur n'aboutit (jeton fictif).
 */
const [port = '9333', action = 'lire', ...rest] = process.argv.slice(2);
let arg = rest.join(' ');
/* « fixture Zonal Head@b2 » : second agent fictif (…0000000000b2) sur le même téléphone. */
let UID = '00000000-0000-4000-8000-0000000000a1';
if (/@b2$/.test(arg)) { UID = '00000000-0000-4000-8000-0000000000b2'; arg = arg.replace(/@b2$/, ''); }
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.type === 'page') || list[0];
if (!target) { console.log('Aucune page WebView'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const evaluate = (expression) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
const out = async (expr) => { const r = await evaluate(expr); console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r, null, 1)); };

const OPEN = `const open = () => new Promise((r, j) => { const q = indexedDB.open('anagroci_ops_offline'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); q.onupgradeneeded = () => { const db = q.result;
  if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  if (!db.objectStoreNames.contains('bundles')) { const b = db.createObjectStore('bundles', { keyPath: 'key' }); b.createIndex('campaign_id','campaign_id'); b.createIndex('cached_at','cached_at'); }
  if (!db.objectStoreNames.contains('operations')) { const o = db.createObjectStore('operations', { keyPath: 'id' }); o.createIndex('status','status'); o.createIndex('campaign_id','campaign_id'); o.createIndex('created_at_client','created_at_client'); o.createIndex('idempotency_key','idempotency_key',{unique:true}); }
  if (!db.objectStoreNames.contains('mappings')) db.createObjectStore('mappings', { keyPath: 'local_id' }); }; });`;

if (action === 'fixture') {
  const role = arg || 'UNIT_HEAD';
  await out(`(() => {
    const key = 'sb-jmbdgpdthzpszfnddwzi-auth-token';
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(key, JSON.stringify({ access_token: 'RECETTE-FICTIF', refresh_token: 'RECETTE-FICTIF', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
      user: { id: '${UID}', email: 'recette.fictive@exemple.invalid', aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('anagroci_profile_${UID}', JSON.stringify({ user_id: '${UID}', nom: 'AGENT RECETTE FICTIF', role: '${role}', actif: true, email: 'recette.fictive@exemple.invalid', cluster: 'BEOUMI' }));
    localStorage.setItem('anagroci_profile_verified_${UID}', String(Date.now()));
    return { fixture: 'ok', role: '${role}' };
  })()`);
} else if (action === 'injecter') {
  await out(`(async () => { ${OPEN}
    const db = await open(); const tx = db.transaction('operations', 'readwrite'), s = tx.objectStore('operations');
    const base = new Date('2026-11-18T09:00:00Z').getTime();
    const mk = (i, status, extra) => Object.assign({ id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), operation_type: 'FARMER_ENROLL',
      campaign_id: '99999999-9999-4999-8999-999999999999', campaign_code: 'RECETTE-FICTIVE', user_id: '${UID}', device_id: '88888888-8888-4888-8888-888888888888',
      payload: { recette: 'RECETTE-SYNTHETIQUE', local_id: 'local-farmer-recette-' + i, row: { nom: 'PRODUCTEUR FICTIF ' + i, village_id: 'v_recette' } },
      dependencies: [], label: 'Enrôlement producteur', entity_label: 'PRODUCTEUR FICTIF ' + i + ' · VILLAGE RECETTE',
      created_at_client: new Date(base + i * 600000).toISOString(), updated_at_local: new Date().toISOString(), attempt_count: 0, status }, extra || {});
    s.put(mk(1, 'PENDING')); s.put(mk(2, 'PENDING'));
    s.put(mk(3, 'FAILED', { attempt_count: 10, last_attempt_at: new Date(base + 7200000).toISOString(), last_error: 'Erreur serveur simulée (recette)' }));
    s.put(mk(4, 'CONFLICT', { attempt_count: 1, last_error: 'Conflit simulé (recette)' }));
    s.put(mk(5, 'NEEDS_REVIEW', { attempt_count: 1, last_error: 'Campagne fermée (simulé)' }));
    s.put(mk(6, 'SYNCED', { attempt_count: 1, result: { status: 'SYNCED', server_id: 'fb-recette-6', farmer_id: 'AFLP-RECETTE-6' } }));
    s.put(mk(7, 'PENDING', { user_id: '00000000-0000-4000-8000-0000000000b2', entity_label: 'AUTRE COMPTE FICTIF' }));
    await new Promise((r) => { tx.oncomplete = r; });
    return 'injecté : 7 opérations fictives';
  })()`);
} else if (action === 'enroler') {
  await out(`(async () => { if (!window.ANAGROCI_OFFLINE) return 'moteur absent sur cette page';
    const op = await ANAGROCI_OFFLINE.queue('FARMER_ENROLL', { recette: 'RECETTE-SYNTHETIQUE', local_id: 'local-farmer-recette-app', row: { nom: 'PRODUCTEUR FICTIF HORS LIGNE', village_id: 'v_recette' } },
      { campaign_id: '99999999-9999-4999-8999-999999999999', entity_label: 'PRODUCTEUR FICTIF HORS LIGNE · VILLAGE RECETTE' });
    return { id: op.id, status: op.status, key: op.idempotency_key }; })()`);
} else if (action === 'lire') {
  await out(`(async () => { ${OPEN}
    const db = await open(); const rows = await new Promise((r) => { const q = db.transaction('operations').objectStore('operations').getAll(); q.onsuccess = () => r(q.result); });
    const by = {}; rows.forEach((o) => { by[o.status] = (by[o.status] || 0) + 1; });
    const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const nav = [...document.querySelectorAll('#opsSidebar a')].map((a) => a.textContent.trim()).slice(0, 3);
    const s = window.ANAGROCI_OFFLINE ? await ANAGROCI_OFFLINE.summary() : null;
    return { url: location.href, online: navigator.onLine, total_idb: rows.length, by_status: by,
      fictives: rows.filter((o) => o.payload && o.payload.recette === 'RECETTE-SYNTHETIQUE').length,
      version: window.ANAGROCI_NATIVE || null, role: window.FBMS_UNIFIED_NAV ? FBMS_UNIFIED_NAV.role() : null,
      menu_3_premiers: nav, bandeau_accueil_visible: vis(document.getElementById('fbmsSyncBanner')),
      pastille_visible: vis(document.querySelector('#opsOfflineSlot .ops-pill')), pastille: (document.querySelector('#opsOfflineSlot .ops-pill') || {}).textContent || null,
      tuiles: document.querySelectorAll('.sj-tile').length, niveaux: [...document.querySelectorAll('.sj-level b')].map((b) => b.textContent),
      lignes_journal: document.querySelectorAll('.sj-op').length, bouton_nettoyer: !!document.getElementById('offClear'),
      titre: (document.querySelector('.ops-route-head h1') || {}).textContent || document.title, resume: s };
  })()`);
} else if (action === 'aller') {
  await out(`(() => { location.href = ${JSON.stringify(arg)}; return 'ok'; })()`);
} else if (action === 'stockage') {
  await out(`(() => ({ online: navigator.onLine, cles: Object.keys(localStorage),
    jeton: !!localStorage.getItem('sb-jmbdgpdthzpszfnddwzi-auth-token'), profil: localStorage.getItem('anagroci_profile_${UID}') }))()`);
} else if (action === 'evalfile') {
  const { readFileSync } = await import('node:fs');
  await out(readFileSync(arg, 'utf8'));
} else if (action === 'eval') {
  await out(arg);
}
ws.close();
