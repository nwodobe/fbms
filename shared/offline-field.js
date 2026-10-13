/* ANAGROCI Operations — Offline First terrain.
   Couche unique pour FIELD BUYING : IndexedDB, file persistante, idempotence,
   cache de référentiels et synchronisation au retour du réseau.
   Le serveur reste l'autorité : aucune permission, avance ou règle métier n'est
   considérée définitive tant que l'opération n'est pas synchronisée. */
(function (global) {
'use strict';

var DB_NAME = 'anagroci_ops_offline';
var DB_VERSION = 1;
var STORE_META = 'meta';
var STORE_BUNDLES = 'bundles';
var STORE_OPS = 'operations';
var STORE_MAP = 'mappings';
var MAX_BATCH = 50;
var SYNC_INTERVAL = 60000;
var dbPromise = null;
var syncPromise = null;
var syncTimer = null;
var runtime = { syncing: false, done: 0, total: 0, lastError: null };

function nowIso() { return new Date().toISOString(); }
function uuid() {
  if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 3 | 8); return v.toString(16);
  });
}
function isOnline() { return typeof navigator === 'undefined' ? true : navigator.onLine !== false; }
function campaignId() {
  try { return global.ANAGROCI_CAMPAIGN && global.ANAGROCI_CAMPAIGN.id && global.ANAGROCI_CAMPAIGN.id(); } catch (e) { return null; }
}
function campaignCode() {
  try { return global.ANAGROCI_CAMPAIGN && global.ANAGROCI_CAMPAIGN.code && global.ANAGROCI_CAMPAIGN.code(); } catch (e) { return null; }
}
function profile() {
  return global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile ? global.ANAGROCI_AUTH.profile : {};
}
function idbReq(req) {
  return new Promise(function (resolve, reject) {
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('IndexedDB indisponible')); };
  });
}
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function (resolve, reject) {
    if (!global.indexedDB) return reject(new Error('IndexedDB indisponible sur cet appareil.'));
    var req = global.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_BUNDLES)) {
        var b = db.createObjectStore(STORE_BUNDLES, { keyPath: 'key' });
        b.createIndex('campaign_id', 'campaign_id', { unique: false });
        b.createIndex('cached_at', 'cached_at', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_OPS)) {
        var o = db.createObjectStore(STORE_OPS, { keyPath: 'id' });
        o.createIndex('status', 'status', { unique: false });
        o.createIndex('campaign_id', 'campaign_id', { unique: false });
        o.createIndex('created_at_client', 'created_at_client', { unique: false });
        o.createIndex('idempotency_key', 'idempotency_key', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORE_MAP)) db.createObjectStore(STORE_MAP, { keyPath: 'local_id' });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('Ouverture IndexedDB impossible.')); };
  });
  return dbPromise;
}
function tx(store, mode, fn) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tr = db.transaction(store, mode);
      var st = tr.objectStore(store), out;
      try { out = fn(st, tr); } catch (e) { reject(e); return; }
      tr.oncomplete = function () { resolve(out); };
      tr.onerror = function () { reject(tr.error || new Error('Transaction locale impossible.')); };
      tr.onabort = function () { reject(tr.error || new Error('Transaction locale annulée.')); };
    });
  });
}
function get(store, key) { return openDb().then(function (db) { return idbReq(db.transaction(store, 'readonly').objectStore(store).get(key)); }); }
function put(store, row) { return tx(store, 'readwrite', function (st) { st.put(row); return row; }); }
function del(store, key) { return tx(store, 'readwrite', function (st) { st.delete(key); return true; }); }
function all(store) { return openDb().then(function (db) { return idbReq(db.transaction(store, 'readonly').objectStore(store).getAll()); }); }

function setMeta(key, value) { return put(STORE_META, { key: key, value: value, updated_at: nowIso() }); }
function getMeta(key) { return get(STORE_META, key).then(function (x) { return x ? x.value : null; }); }
function deviceId() {
  return getMeta('device_id').then(function (x) {
    if (x) return x;
    var id = uuid(); return setMeta('device_id', id).then(function () { return id; });
  });
}
function bundleKey(name, cid) { return name + ':' + (cid || campaignId() || 'none'); }
function setBundle(name, value, opts) {
  opts = opts || {}; var cid = opts.campaign_id === undefined ? campaignId() : opts.campaign_id;
  return put(STORE_BUNDLES, { key: bundleKey(name, cid), name: name, campaign_id: cid || null, cached_at: nowIso(), value: value });
}
function getBundle(name, opts) {
  opts = opts || {}; var cid = opts.campaign_id === undefined ? campaignId() : opts.campaign_id;
  return get(STORE_BUNDLES, bundleKey(name, cid)).then(function (x) { return x ? x.value : null; });
}
function setTable(name, rows, opts) { return setBundle('table:' + name, rows || [], opts); }
function getTable(name, opts) { return getBundle('table:' + name, opts).then(function (x) { return x || []; }); }
function updateBundle(name, updater, opts) {
  opts = opts || {}; var cid = opts.campaign_id === undefined ? campaignId() : opts.campaign_id;
  var key = bundleKey(name, cid);
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tr = db.transaction(STORE_BUNDLES, 'readwrite'), st = tr.objectStore(STORE_BUNDLES), req = st.get(key), out;
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var row = req.result || { key: key, name: name, campaign_id: cid || null, value: null };
        try { out = updater(row.value); } catch (e) { reject(e); tr.abort(); return; }
        row.value = out; row.cached_at = nowIso(); st.put(row);
      };
      tr.oncomplete = function () { resolve(out); };
      tr.onerror = function () { reject(tr.error); };
    });
  });
}

function statusRank(s) { return { PENDING: 1, SYNCING: 2, FAILED: 3, CONFLICT: 4, NEEDS_REVIEW: 5, SYNCED: 6, CANCELLED: 7 }[s] || 99; }
function summary() {
  return all(STORE_OPS).then(function (ops) {
    var s = { online: isOnline(), syncing: runtime.syncing, done: runtime.done, total: runtime.total, pending: 0, failed: 0, conflicts: 0, review: 0, synced: 0, cancelled: 0, lastError: runtime.lastError };
    ops.forEach(function (o) {
      if (o.status === 'PENDING' || o.status === 'SYNCING') s.pending++;
      else if (o.status === 'FAILED') s.failed++;
      else if (o.status === 'CONFLICT') s.conflicts++;
      else if (o.status === 'NEEDS_REVIEW') s.review++;
      else if (o.status === 'SYNCED') s.synced++;
      else if (o.status === 'CANCELLED') s.cancelled++;
    });
    return s;
  });
}
function emit() {
  summary().then(function (s) {
    try { global.dispatchEvent(new CustomEvent('anagroci:offline-status', { detail: s })); } catch (e) {}
  });
}

function queueOperation(type, payload, opts) {
  opts = opts || {};
  var cid = opts.campaign_id || campaignId();
  if (!cid) return Promise.reject(new Error('Aucune campagne active : impossible de conserver cette opération hors ligne.'));
  return deviceId().then(function (did) {
    var p = profile();
    var op = {
      id: opts.id || uuid(),
      idempotency_key: opts.idempotency_key || uuid(),
      operation_type: type,
      campaign_id: cid,
      campaign_code: opts.campaign_code || campaignCode() || null,
      user_id: p.user_id || p.userId || null,
      device_id: did,
      payload: payload || {},
      dependencies: Array.isArray(opts.dependencies) ? opts.dependencies.slice() : [],
      label: opts.label || type,
      entity_label: opts.entity_label || null,
      created_at_client: opts.created_at_client || nowIso(),
      updated_at_local: nowIso(),
      attempt_count: 0,
      last_attempt_at: null,
      next_attempt_at: null,
      status: 'PENDING',
      last_error: null,
      result: null
    };
    return put(STORE_OPS, op).then(function () { emit(); return op; });
  });
}
function listOperations() {
  return all(STORE_OPS).then(function (rows) {
    return rows.sort(function (a, b) {
      var ra = statusRank(a.status), rb = statusRank(b.status);
      if (ra !== rb) return ra - rb;
      return new Date(b.created_at_client || 0) - new Date(a.created_at_client || 0);
    });
  });
}
function updateOperation(id, patch) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tr = db.transaction(STORE_OPS, 'readwrite'), st = tr.objectStore(STORE_OPS), req = st.get(id), out;
      req.onsuccess = function () {
        if (!req.result) { out = null; return; }
        out = Object.assign({}, req.result, patch || {}, { updated_at_local: nowIso() }); st.put(out);
      };
      req.onerror = function () { reject(req.error); };
      tr.oncomplete = function () { emit(); resolve(out); };
      tr.onerror = function () { reject(tr.error); };
    });
  });
}
function cancelOperation(id) {
  return listOperations().then(function (ops) {
    var dep = ops.filter(function (o) { return o.status !== 'CANCELLED' && o.status !== 'SYNCED' && (o.dependencies || []).indexOf(id) >= 0; });
    if (dep.length) throw new Error('Cette opération est utilisée par ' + dep.length + ' autre(s) opération(s) locale(s). Annulez d’abord les dépendances.');
    var row = ops.filter(function (o) { return o.id === id; })[0];
    if (!row) throw new Error('Opération introuvable.');
    if (row.status === 'SYNCED') throw new Error('Une opération déjà synchronisée ne peut pas être annulée localement.');
    return updateOperation(id, { status: 'CANCELLED', last_error: null });
  });
}
function mappingSet(localId, serverId, farmerId) {
  if (!localId || !serverId) return Promise.resolve();
  return put(STORE_MAP, { local_id: localId, server_id: serverId, farmer_id: farmerId || null, mapped_at: nowIso() });
}
function mappingsObject() {
  return all(STORE_MAP).then(function (rows) { var m = {}; rows.forEach(function (x) { m[x.local_id] = x; }); return m; });
}
function resolveRefs(value, maps) {
  if (typeof value === 'string' && maps[value]) return maps[value].server_id;
  if (Array.isArray(value)) return value.map(function (x) { return resolveRefs(x, maps); });
  if (value && typeof value === 'object') {
    var o = {}; Object.keys(value).forEach(function (k) { o[k] = resolveRefs(value[k], maps); }); return o;
  }
  return value;
}
function depsDone(op, byId) {
  return (op.dependencies || []).every(function (id) { return byId[id] && byId[id].status === 'SYNCED'; });
}
function nextBackoff(attempt) {
  var sec = Math.min(Math.pow(2, Math.max(0, attempt || 0)), 300);
  var jitter = 0.8 + Math.random() * 0.4;
  return new Date(Date.now() + sec * 1000 * jitter).toISOString();
}
function getClient() {
  if (!global.supabase || !global.supabase.createClient || !global.ANAGROCI_SUPABASE_URL || !global.ANAGROCI_SUPABASE_ANON) return null;
  if (!getClient._client) getClient._client = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON);
  return getClient._client;
}
function resetStaleSyncing() {
  return listOperations().then(function (ops) {
    var stale = ops.filter(function (o) { return o.status === 'SYNCING'; });
    return Promise.all(stale.map(function (o) { return updateOperation(o.id, { status: 'PENDING', last_error: 'Synchronisation interrompue : reprise automatique.' }); }));
  });
}

function applyResult(op, res) {
  var status = String(res.status || 'FAILED').toUpperCase();
  var patch = { status: status, result: res, last_error: res.message || null };
  if (status === 'SYNCED') patch.last_error = null;
  return updateOperation(op.id, patch).then(function () {
    if (res.local_id && res.server_id) return mappingSet(res.local_id, res.server_id, res.farmer_id);
  }).then(function () {
    if (status !== 'SYNCED') return;
    if (op.operation_type === 'FARMER_ENROLL' || op.operation_type === 'COOP_FARMER_ENROLL') {
      return updateBundle('field_base', function (b) {
        if (!b || !b.farmers) return b;
        b.farmers = b.farmers.map(function (f) {
          if (f.producteur_id !== (res.local_id || (op.payload && op.payload.local_id))) return f;
          return Object.assign({}, f, { producteur_id: res.server_id || f.producteur_id, farmer_id: res.farmer_id || f.farmer_id, local_only: false, pending_sync: false });
        });
        return b;
      }, { campaign_id: op.campaign_id }).catch(function () {});
    }
    if (op.operation_type === 'FIELD_PURCHASE_CREATE') {
      return updateBundle('field_base', function (b) {
        if (!b || !b.achats) return b;
        var lid = op.payload && op.payload.row && op.payload.row.local_id;
        b.achats = b.achats.map(function (a) {
          if (!lid || a.local_id !== lid) return a;
          return Object.assign({}, a, { id: res.purchase_id || a.id, pending_sync: false, local_only: false, statut_validation: a.statut_validation === 'LOCAL · EN ATTENTE' ? 'À valider' : a.statut_validation });
        });
        return b;
      }, { campaign_id: op.campaign_id }).catch(function () {});
    }
  });
}

function syncNow() {
  if (syncPromise) return syncPromise;
  if (!isOnline()) { emit(); return Promise.reject(new Error('Hors ligne : les opérations restent conservées sur cet appareil.')); }
  var cl = getClient();
  if (!cl) return Promise.reject(new Error('Client Supabase indisponible.'));

  syncPromise = cl.auth.getSession().then(function (s) {
    if (!(s.data && s.data.session)) throw new Error('Session expirée : reconnectez-vous. Vos opérations locales sont conservées.');
    return Promise.all([listOperations(), mappingsObject()]);
  }).then(function (rs) {
    var ops = rs[0], maps = rs[1], byId = {}; ops.forEach(function (o) { byId[o.id] = o; });
    var now = Date.now();
    var eligible = ops.filter(function (o) {
      if (o.status !== 'PENDING' && o.status !== 'FAILED') return false;
      if (o.next_attempt_at && new Date(o.next_attempt_at).getTime() > now) return false;
      return depsDone(o, byId);
    }).slice(0, MAX_BATCH);
    if (!eligible.length) return { empty: true };

    runtime.syncing = true; runtime.done = 0; runtime.total = eligible.length; runtime.lastError = null; emit();
    return Promise.all(eligible.map(function (o) {
      return updateOperation(o.id, { status: 'SYNCING', attempt_count: Number(o.attempt_count || 0) + 1, last_attempt_at: nowIso(), last_error: null });
    })).then(function () {
      return cl.rpc('offline_sync_batch', { p_operations: eligible.map(function (o) {
        return {
          client_operation_id: o.id,
          idempotency_key: o.idempotency_key,
          operation_type: o.operation_type,
          campaign_id: o.campaign_id,
          device_id: o.device_id,
          created_at_client: o.created_at_client,
          payload: resolveRefs(o.payload, maps)
        };
      }) });
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var results = r.data && r.data.results ? r.data.results : [];
      var byKey = {}; results.forEach(function (x) { byKey[x.idempotency_key] = x; });
      return eligible.reduce(function (p, op) {
        return p.then(function () {
          var res = byKey[op.idempotency_key] || { status: 'FAILED', message: 'Aucun résultat serveur pour cette opération.' };
          return applyResult(op, res).then(function () { runtime.done++; emit(); });
        });
      }, Promise.resolve()).then(function () { return { synced: results.length }; });
    });
  }).catch(function (err) {
    runtime.lastError = err && err.message ? err.message : String(err);
    return listOperations().then(function (ops) {
      var affected = ops.filter(function (o) { return o.status === 'SYNCING'; });
      return Promise.all(affected.map(function (o) {
        return updateOperation(o.id, { status: 'PENDING', last_error: runtime.lastError, next_attempt_at: nextBackoff(o.attempt_count || 1) });
      })).then(function () { throw err; });
    });
  }).finally(function () {
    runtime.syncing = false; runtime.done = 0; runtime.total = 0; syncPromise = null; emit();
  });

  return syncPromise.then(function (x) {
    if (x && !x.empty) {
      setTimeout(function () { if (isOnline()) syncNow().catch(function () {}); }, 100);
    }
    return x;
  });
}

function pendingSpend(rtId) {
  return listOperations().then(function (ops) {
    return ops.filter(function (o) {
      if (['PENDING','SYNCING','FAILED'].indexOf(o.status) < 0 || o.operation_type !== 'FIELD_PURCHASE_CREATE') return false;
      var r = o.payload && o.payload.row; return r && r.rt_id === rtId;
    }).reduce(function (t, o) { return t + Number((o.payload.row && o.payload.row.montant) || 0); }, 0);
  });
}
function estimatedCashAvailable(rtId, base, cash) {
  var av = cash && cash.avances ? cash.avances : [], buys = base && base.achats ? base.achats : [];
  var total = av.filter(function (a) { return a.rt_id === rtId && a.statut !== 'Annulee'; }).reduce(function (t, a) { return t + Number(a.montant || 0); }, 0);
  var used = buys.filter(function (a) { return a.rt_id === rtId && !a.rejet && !a.pending_sync; }).reduce(function (t, a) { return t + Number(a.montant || 0); }, 0);
  return pendingSpend(rtId).then(function (p) { return { advance: total, server_used: used, pending: p, available: total - used - p }; });
}

function appendLocalFarmer(row, opts) {
  opts = opts || {}; var cid = opts.campaign_id || campaignId();
  return updateBundle('field_base', function (b) {
    if (!b) return b;
    b.farmers = b.farmers || [];
    if (!b.farmers.some(function (f) { return f.producteur_id === row.producteur_id; })) b.farmers.push(row);
    return b;
  }, { campaign_id: cid });
}
function appendPendingPurchase(row, opts) {
  opts = opts || {}; var cid = opts.campaign_id || campaignId();
  return updateBundle('field_base', function (b) {
    if (!b) return b;
    b.achats = b.achats || [];
    if (!b.achats.some(function (a) { return a.local_id === row.local_id; })) b.achats.unshift(row);
    return b;
  }, { campaign_id: cid });
}

function readiness() {
  var cid = campaignId();
  return Promise.all([
    getBundle('field_base', { campaign_id: cid }),
    getBundle('field_rule', { campaign_id: cid }),
    getBundle('cash', { campaign_id: cid }),
    getBundle('bags', { campaign_id: cid }),
    getBundle('coop_dashboard', { campaign_id: cid }),
    getMeta('last_prepared')
  ]).then(function (rs) {
    var b = rs[0] || {}, last = rs[5] || null;
    return {
      campaign_id: cid,
      campaign_code: campaignCode(),
      last_prepared: last,
      ready: !!(cid && rs[0] && rs[1] && rs[2]),
      villages: (b.villages || []).length,
      rts: (b.rts || []).length,
      producers: (b.farmers || []).length,
      cooperatives: Array.isArray(rs[4]) ? rs[4].length : 0,
      purchases: (b.achats || []).length,
      bags_cached: !!rs[3],
      cash_cached: !!rs[2],
      rule_cached: !!rs[1]
    };
  });
}
function markPrepared(extra) {
  return setMeta('last_prepared', Object.assign({ at: nowIso(), campaign_id: campaignId(), campaign_code: campaignCode() }, extra || {})).then(emit);
}
function prepareShell() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return Promise.resolve({ service_worker: false });
  return navigator.serviceWorker.register('../sw.js', { scope: '../' }).then(function (reg) {
    return navigator.serviceWorker.ready.then(function (ready) {
      var target = ready.active || reg.active || reg.waiting || reg.installing;
      if (target) target.postMessage({ type: 'PRECACHE_FIELD' });
      return new Promise(function (resolve) {
        setTimeout(function () { resolve({ service_worker: true, scope: ready.scope || reg.scope }); }, 700);
      });
    });
  });
}
function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve({ usage: null, quota: null, persisted: null });
  return Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted ? navigator.storage.persisted().catch(function(){return null;}) : Promise.resolve(null)
  ]).then(function (x) { return { usage: x[0].usage || 0, quota: x[0].quota || 0, persisted: x[1] }; });
}
function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
  return navigator.storage.persist().catch(function () { return false; });
}
function clearSynced() {
  return listOperations().then(function (ops) {
    return Promise.all(ops.filter(function (o) { return o.status === 'SYNCED' || o.status === 'CANCELLED'; })
      .map(function (o) { return del(STORE_OPS, o.id); }));
  }).then(function () { emit(); return true; });
}

function htmlEscape(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function journalHtml(ops) {
  if (!ops.length) return '<div class="ops-empty">Aucune opération locale pour le moment.</div>';
  return '<div class="table-wrap"><table><thead><tr><th>État</th><th>Type</th><th>Créée</th><th>Objet</th><th>Message</th><th></th></tr></thead><tbody>' +
    ops.map(function (o) {
      var cls = o.status === 'SYNCED' ? 'ok' : (o.status === 'CONFLICT' || o.status === 'NEEDS_REVIEW' || o.status === 'FAILED') ? 'danger' : 'warn';
      var canCancel = o.status !== 'SYNCED' && o.status !== 'CANCELLED';
      return '<tr><td><span class="badge ' + cls + '">' + htmlEscape(o.status) + '</span></td><td><b>' + htmlEscape(o.operation_type) + '</b></td>' +
        '<td>' + htmlEscape(new Date(o.created_at_client).toLocaleString('fr-FR')) + '</td><td>' + htmlEscape(o.entity_label || o.label || '—') + '</td>' +
        '<td>' + htmlEscape(o.last_error || (o.status === 'PENDING' ? 'En attente de synchronisation' : '—')) + '</td><td>' +
        ((o.status === 'FAILED' || o.status === 'PENDING') ? '<button class="btn secondary" type="button" data-off-retry="' + o.id + '">Réessayer</button> ' : '') +
        (canCancel ? '<button class="btn secondary" type="button" data-off-cancel="' + o.id + '">Annuler</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function startTimer() {
  if (syncTimer) return;
  syncTimer = global.setInterval(function () {
    if (isOnline()) summary().then(function (s) { if (s.pending || s.failed) syncNow().catch(function () {}); });
  }, SYNC_INTERVAL);
}

global.addEventListener && global.addEventListener('online', function () { emit(); setTimeout(function () { syncNow().catch(function () {}); }, 1000); });
global.addEventListener && global.addEventListener('offline', emit);
global.addEventListener && global.addEventListener('focus', function () { if (isOnline()) syncNow().catch(function () {}); });

var API = {
  ready: function () { return openDb().then(resetStaleSyncing).then(function () { startTimer(); emit(); return true; }); },
  isOnline: isOnline,
  uuid: uuid,
  deviceId: deviceId,
  campaignId: campaignId,
  campaignCode: campaignCode,
  setMeta: setMeta,
  getMeta: getMeta,
  setBundle: setBundle,
  getBundle: getBundle,
  updateBundle: updateBundle,
  setTable: setTable,
  getTable: getTable,
  queue: queueOperation,
  list: listOperations,
  summary: summary,
  syncNow: syncNow,
  retry: function (id) { return updateOperation(id, { status: 'PENDING', next_attempt_at: null, last_error: null }).then(syncNow); },
  cancel: cancelOperation,
  mappingSet: mappingSet,
  pendingSpend: pendingSpend,
  estimatedCashAvailable: estimatedCashAvailable,
  appendLocalFarmer: appendLocalFarmer,
  appendPendingPurchase: appendPendingPurchase,
  readiness: readiness,
  markPrepared: markPrepared,
  prepareShell: prepareShell,
  storageEstimate: storageEstimate,
  requestPersistentStorage: requestPersistentStorage,
  clearSynced: clearSynced,
  journalHtml: journalHtml,
  emit: emit
};
global.ANAGROCI_OFFLINE = API;
API.ready().catch(function (e) { runtime.lastError = e.message; emit(); });
})(window);
