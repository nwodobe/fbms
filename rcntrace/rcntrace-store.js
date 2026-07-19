/* ============================================================================
   RCN TRACE — Magasin local IndexedDB (rcntrace/rcntrace-store.js)
   ----------------------------------------------------------------------------
   Remplace le plafond ~5 Mo du localStorage par IndexedDB (quota bien plus
   large), sans changer le moteur synchrone :
     · l'état vit en mémoire (_db du moteur) ; ici on ne fait que PERSISTER ;
     · écriture « write-behind » déboucée (200 ms), clonage structuré au moment
       du flush (dernier état gagne) ; flush forcé sur pagehide ;
     · lecture au démarrage (RCNStore.ready) : IndexedDB fait AUTORITÉ ; si
       vide, migration transparente depuis localStorage (rcntrace.db.v4) ;
     · tout échec d'écriture est REMONTÉ (RCNTRACE_STORAGE_FAIL) — plus de
       perte silencieuse ; un succès ultérieur efface l'alerte
       (RCNTRACE_STORAGE_OK).
   Le localStorage reste un miroir best-effort (petites installations,
   navigateurs sans IndexedDB) — géré par le moteur, pas ici.
   ========================================================================== */
(function (global) {
  "use strict";

  var DB_NAME = "rcntrace-idb", STORE = "state", KEY = "db", LS_KEY = "rcntrace.db.v4";
  var dbp = null, pending = null, timer = null, lastErr = null, waiters = [];

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      if (!global.indexedDB) { res(null); return; }
      try {
        var rq = global.indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
        rq.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }

  function get() {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          var rq = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    });
  }

  function put(val) {
    return open().then(function (db) {
      if (!db) throw new Error("IndexedDB indisponible sur ce navigateur");
      return new Promise(function (res, rej) {
        try {
          var tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(val, KEY);
          tx.oncomplete = function () { res(true); };
          tx.onerror = function () { rej(tx.error || new Error("écriture locale refusée")); };
          tx.onabort = function () { rej(tx.error || new Error("écriture locale interrompue")); };
        } catch (e) { rej(e); }
      });
    });
  }

  function flushNow() {
    if (pending == null) return Promise.resolve(true);
    var val = pending; pending = null;
    var ws = waiters.splice(0);
    return put(val).then(
      function () { lastErr = null; ws.forEach(function (w) { w.res(true); }); return true; },
      function (e) { lastErr = e; ws.forEach(function (w) { w.rej(e); }); throw e; }
    );
  }

  // Écriture déboucée : on retient le DERNIER état, on l'écrit 200 ms plus tard.
  function save(obj) {
    pending = obj;
    clearTimeout(timer);
    var p = new Promise(function (res, rej) { waiters.push({ res: res, rej: rej }); });
    timer = setTimeout(function () { flushNow().catch(function () {}); }, 200);
    return p;
  }

  // Dernière chance avant fermeture/masquage de l'onglet.
  global.addEventListener("pagehide", function () { clearTimeout(timer); flushNow().catch(function () {}); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { clearTimeout(timer); flushNow().catch(function () {}); }
  });

  // Lecture initiale : IndexedDB fait autorité ; sinon migration localStorage.
  var ready = get().then(function (state) {
    if (state && state.seq) return { state: state, source: "indexeddb" };
    try {
      var raw = global.localStorage && localStorage.getItem(LS_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.seq) {
          return put(obj).then(
            function () { return { state: obj, source: "migration" }; },
            function () { return { state: obj, source: "localstorage" }; }
          );
        }
      }
    } catch (e) {}
    return { state: null, source: "vide" };
  });

  global.RCNStore = {
    ready: ready,
    get: get,
    save: save,
    flush: flushNow,
    lastError: function () { return lastErr; }
  };
})(window);
