/* ANAGROCI FBMS - AFLP Farmer Registry complete offline/sync engine */
(function (global) {
  'use strict';
  var FR = global.AFLP_FARMER_REGISTRY = global.AFLP_FARMER_REGISTRY || {};
  if (FR.syncEngine) return;

  var DB_NAME = 'aflp_farmer_registry_db';
  var DB_VERSION = 1;
  var CACHE_STORE = 'cache';
  var OUTBOX_STORE = 'outbox';
  var FALLBACK_CACHE = 'aflp_farmer_registry_cache_v1';
  var FALLBACK_OUTBOX = 'aflp_farmer_registry_outbox_v1';
  var dbPromise = null;
  var syncRunning = false;

  var ORDER = {
    farmer_plots: 10,
    farmer_production_baselines: 20,
    farmer_sustainability_baselines: 30,
    farmer_sustainability_answers: 40,
    farmer_inspections: 50,
    farmer_inspection_answers: 60,
    farmer_action_plans: 70,
    farmer_visits: 80,
    participants_formation: 90,
    preuves: 100,
    farmer_verifications: 110,
    rpc: 200
  };

  var SERVER_COLUMNS = {
    farmer_plots: [
      'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version',
      'gps_captured_by'
    ],
    farmer_production_baselines: [
      'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version',
      'captured_by', 'finalized_at', 'finalized_by', 'yield_kg_ha'
    ],
    farmer_sustainability_baselines: [
      'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version',
      'captured_by', 'finalized_at', 'finalized_by', 'answered_count',
      'required_count', 'risk_profile', 'risk_reasons'
    ],
    farmer_sustainability_answers: [
      'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version'
    ],
    farmer_inspections: [
      'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version',
      'inspector_id', 'finalized_at', 'finalized_by', 'risk_profile', 'risk_reasons'
    ],
    farmer_inspection_answers: [
      'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version'
    ],
    farmer_action_plans: [
      'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version',
      'effective_status', 'closed_at', 'closed_by'
    ],
    farmer_visits: [
      'created_at', 'created_by', 'updated_at', 'updated_by', 'record_version',
      'agent_id'
    ],
    participants_formation: ['created_at', 'created_by'],
    farmer_verifications: [
      'created_at', 'created_by', 'verified_at', 'verified_by'
    ]
  };

  function uuid() {
    try { return crypto.randomUUID(); }
    catch (e) {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 3 | 8);
        return v.toString(16);
      });
    }
  }

  function nowIso() { return new Date().toISOString(); }
  function online() {
    return navigator.onLine !== false
      && typeof SB !== 'undefined' && !!SB
      && typeof AUTH !== 'undefined'
      && typeof AUTH.isConnected === 'function'
      && AUTH.isConnected();
  }
  function cleanPayload(table, value) {
    var result = {};
    var excluded = SERVER_COLUMNS[table] || [];
    Object.keys(value || {}).forEach(function (key) {
      if (key.indexOf('_') === 0) return;
      if (['sync_status', 'sync_error', 'local_updated_at', 'operation_id'].indexOf(key) >= 0) return;
      if (excluded.indexOf(key) >= 0) return;
      var v = value[key];
      if (v !== undefined) result[key] = v;
    });
    return result;
  }
  function producerIdOf(row, fallback) {
    return (row && (row.producteur_id || row.producteurId)) || fallback || null;
  }
  function tableKey(table, id) { return table + ':' + id; }

  function fallbackRead(key, defaultValue) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(defaultValue)); }
    catch (e) { return defaultValue; }
  }
  function fallbackWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error('IndexedDB indisponible'));
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          var cache = db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
          cache.createIndex('table', 'table', { unique: false });
          cache.createIndex('producteur_id', 'producteur_id', { unique: false });
        }
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          var outbox = db.createObjectStore(OUTBOX_STORE, { keyPath: 'operation_id' });
          outbox.createIndex('status', 'status', { unique: false });
          outbox.createIndex('producteur_id', 'producteur_id', { unique: false });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Erreur IndexedDB')); };
    });
    return dbPromise;
  }

  async function idbPut(storeName, value) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = function () { resolve(value); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  async function idbDelete(storeName, key) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  async function idbAll(storeName) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readonly');
      var request = tx.objectStore(storeName).getAll();
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function putCache(table, row, status, producteurId) {
    if (!row || !row.id) return row;
    var entry = {
      key: tableKey(table, row.id),
      table: table,
      id: row.id,
      producteur_id: producerIdOf(row, producteurId),
      row: Object.assign({}, row, {
        _sync_status: status || row._sync_status || 'SYNCED',
        _local_updated_at: nowIso()
      }),
      updated_at: nowIso()
    };
    try { await idbPut(CACHE_STORE, entry); }
    catch (e) {
      var cache = fallbackRead(FALLBACK_CACHE, {});
      cache[entry.key] = entry;
      fallbackWrite(FALLBACK_CACHE, cache);
    }
    return entry.row;
  }

  async function cacheRows(table, rows, producteurId) {
    for (var i = 0; i < (rows || []).length; i += 1) {
      await putCache(table, rows[i], 'SYNCED', producteurId);
    }
    return rows || [];
  }

  async function listCache(table, producteurId) {
    var entries;
    try { entries = await idbAll(CACHE_STORE); }
    catch (e) { entries = Object.values(fallbackRead(FALLBACK_CACHE, {})); }
    return (entries || []).filter(function (entry) {
      return entry.table === table && (!producteurId || entry.producteur_id === producteurId);
    }).map(function (entry) { return entry.row; });
  }

  async function mergeRows(table, serverRows, producteurId) {
    var locals = await listCache(table, producteurId);
    var pending = {};
    var map = {};
    locals.forEach(function (row) {
      if (row && row.id && row._sync_status && row._sync_status !== 'SYNCED') pending[row.id] = row;
    });
    (serverRows || []).forEach(function (row) {
      if (row && row.id && !pending[row.id]) map[row.id] = row;
    });
    locals.forEach(function (row) {
      if (!row || !row.id) return;
      if (pending[row.id] || !map[row.id]) map[row.id] = row;
    });
    await cacheRows(table, (serverRows || []).filter(function (row) {
      return row && row.id && !pending[row.id];
    }), producteurId);
    var pendingRows = Object.values(pending);
    for (var i = 0; i < pendingRows.length; i += 1) {
      await putCache(table, pendingRows[i], pendingRows[i]._sync_status, producteurId);
    }
    return Object.values(map);
  }

  async function enqueue(type, table, payload, options) {
    options = options || {};
    var operation = {
      operation_id: options.operation_id || uuid(),
      type: type,
      table: table || 'rpc',
      payload: payload || {},
      rpc_name: options.rpc_name || null,
      rpc_args: options.rpc_args || null,
      producteur_id: options.producteur_id || producerIdOf(payload),
      status: options.status || 'PENDING_SYNC',
      attempts: options.attempts || 0,
      last_error: options.last_error || null,
      created_at: options.created_at || nowIso(),
      updated_at: nowIso(),
      order_no: options.order_no || ORDER[table] || ORDER.rpc
    };
    try { await idbPut(OUTBOX_STORE, operation); }
    catch (e) {
      var outbox = fallbackRead(FALLBACK_OUTBOX, []);
      var index = outbox.findIndex(function (x) { return x.operation_id === operation.operation_id; });
      if (index >= 0) outbox[index] = operation; else outbox.push(operation);
      fallbackWrite(FALLBACK_OUTBOX, outbox);
    }
    dispatchStatus();
    return operation;
  }

  async function updateOperation(operation) {
    operation.updated_at = nowIso();
    try { await idbPut(OUTBOX_STORE, operation); }
    catch (e) {
      var outbox = fallbackRead(FALLBACK_OUTBOX, []);
      var index = outbox.findIndex(function (x) { return x.operation_id === operation.operation_id; });
      if (index >= 0) outbox[index] = operation; else outbox.push(operation);
      fallbackWrite(FALLBACK_OUTBOX, outbox);
    }
  }

  async function removeOperation(operationId) {
    try { await idbDelete(OUTBOX_STORE, operationId); }
    catch (e) {
      fallbackWrite(FALLBACK_OUTBOX, fallbackRead(FALLBACK_OUTBOX, []).filter(function (x) {
        return x.operation_id !== operationId;
      }));
    }
  }

  async function listOutbox(producteurId) {
    var rows;
    try { rows = await idbAll(OUTBOX_STORE); }
    catch (e) { rows = fallbackRead(FALLBACK_OUTBOX, []); }
    return (rows || []).filter(function (row) {
      return !producteurId || row.producteur_id === producteurId;
    }).sort(function (a, b) {
      return Number(a.order_no || 999) - Number(b.order_no || 999)
        || String(a.created_at).localeCompare(String(b.created_at));
    });
  }

  async function pendingCount(producteurId) {
    var rows = await listOutbox(producteurId);
    return rows.filter(function (row) { return row.status !== 'SYNCED'; }).length;
  }

  function dispatchStatus() {
    try { document.dispatchEvent(new CustomEvent('aflp:farmer-registry-status')); }
    catch (e) { /* navigateur ancien */ }
  }

  async function save(table, row, options) {
    options = options || {};
    var payload = Object.assign({}, row || {});
    if (!payload.id) payload.id = uuid();
    var producteurId = options.producteur_id || producerIdOf(payload);
    payload._sync_status = online() ? 'PENDING_SYNC' : 'LOCAL';
    await putCache(table, payload, payload._sync_status, producteurId);

    var operation = await enqueue(options.insertOnly ? 'insert' : 'upsert', table, cleanPayload(table, payload), {
      producteur_id: producteurId,
      order_no: options.order_no || ORDER[table]
    });

    if (online() && options.deferSync !== true) {
      await sync();
      var cached = await listCache(table, producteurId);
      return cached.find(function (x) { return x.id === payload.id; }) || payload;
    }
    return Object.assign(payload, { operation_id: operation.operation_id });
  }

  async function queueRpc(name, args, producteurId, options) {
    options = options || {};
    var operation = await enqueue('rpc', 'rpc', {}, {
      rpc_name: name,
      rpc_args: args || {},
      producteur_id: producteurId,
      order_no: options.order_no || ORDER.rpc
    });
    if (online() && options.deferSync !== true) await sync();
    return operation;
  }

  async function markCacheError(operation) {
    if (!operation || !operation.table || !operation.payload || !operation.payload.id) return;
    var rows = await listCache(operation.table, operation.producteur_id);
    var row = rows.find(function (item) { return item.id === operation.payload.id; }) || operation.payload;
    row._sync_error = operation.last_error;
    await putCache(operation.table, row, 'SYNC_ERROR', operation.producteur_id);
  }

  async function processOperation(operation) {
    operation.status = 'SYNCING';
    operation.attempts = Number(operation.attempts || 0) + 1;
    operation.last_error = null;
    await updateOperation(operation);

    try {
      if (operation.type === 'rpc') {
        var rpcResponse = await SB.rpc(operation.rpc_name, operation.rpc_args || {});
        if (rpcResponse.error) throw rpcResponse.error;
      } else {
        var response;
        if (operation.type === 'insert') {
          response = await SB.from(operation.table)
            .upsert(operation.payload, { onConflict: 'id', ignoreDuplicates: true })
            .select('*').maybeSingle();
          if (response.error) throw response.error;
          if (!response.data) {
            response = await SB.from(operation.table)
              .select('*').eq('id', operation.payload.id).maybeSingle();
            if (response.error) throw response.error;
          }
        } else {
          response = await SB.from(operation.table)
            .upsert(operation.payload, { onConflict: 'id' })
            .select('*').single();
          if (response.error) throw response.error;
        }
        if (response.data && response.data.id) {
          await putCache(operation.table, response.data, 'SYNCED', operation.producteur_id);
        }
      }
      operation.status = 'SYNCED';
      await updateOperation(operation);
      await removeOperation(operation.operation_id);
      return true;
    } catch (error) {
      operation.status = 'SYNC_ERROR';
      operation.last_error = error && error.message ? error.message : String(error);
      await updateOperation(operation);
      await markCacheError(operation);
      return false;
    }
  }

  async function sync() {
    if (syncRunning || !online()) return false;
    syncRunning = true;
    dispatchStatus();
    try {
      var rows = await listOutbox();
      var blockedProducers = {};
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].status === 'SYNCED') continue;
        if (rows[i].producteur_id && blockedProducers[rows[i].producteur_id]) continue;
        var ok = await processOperation(rows[i]);
        if (!ok && rows[i].producteur_id) blockedProducers[rows[i].producteur_id] = true;
      }
      try { document.dispatchEvent(new CustomEvent('aflp:farmer-registry-synced')); }
      catch (e) { /* ignore */ }
      return Object.keys(blockedProducers).length === 0;
    } finally {
      syncRunning = false;
      dispatchStatus();
    }
  }

  async function sessionUserId() {
    if (typeof SB === 'undefined' || !SB) return null;
    try {
      var response = await SB.auth.getSession();
      return response.data && response.data.session && response.data.session.user
        ? response.data.session.user.id : null;
    } catch (e) { return null; }
  }

  async function sha256(file) {
    if (!global.crypto || !crypto.subtle || !file || !file.arrayBuffer) return null;
    var digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map(function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  async function uploadEvidence(file, producteurId, entityType, entityId, proofType) {
    if (!online()) throw new Error('La preuve doit être envoyée avec une connexion disponible.');
    if (!file) throw new Error('Fichier de preuve absent.');
    var userId = await sessionUserId();
    if (!userId) throw new Error('Session utilisateur absente.');
    var safeName = String(file.name || 'preuve')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-100);
    var objectPath = userId + '/' + producteurId + '/' + entityType + '/'
      + entityId + '/' + uuid() + '-' + safeName;
    var upload = await SB.storage.from('terrain-preuves').upload(objectPath, file, {
      cacheControl: '3600', upsert: false, contentType: file.type || undefined
    });
    if (upload.error) throw upload.error;
    var proof = {
      id: uuid(),
      entite_type: entityType,
      entite_id: String(entityId),
      type_preuve: proofType || 'document',
      storage_path: objectPath,
      horodatage_client: nowIso(),
      sha256: await sha256(file)
    };
    var inserted = await SB.from('preuves').insert(proof).select('*').single();
    if (inserted.error) throw inserted.error;
    return inserted.data;
  }

  global.addEventListener('online', function () { sync(); });
  document.addEventListener('anagroci:authenticated', function () { sync(); });

  FR.syncEngine = {
    version: '1.1.0',
    uuid: uuid,
    online: online,
    putCache: putCache,
    cacheRows: cacheRows,
    listCache: listCache,
    mergeRows: mergeRows,
    listOutbox: listOutbox,
    pendingCount: pendingCount,
    save: save,
    queueRpc: queueRpc,
    sync: sync,
    uploadEvidence: uploadEvidence,
    cleanPayload: cleanPayload
  };
})(window);
