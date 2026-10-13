/* ANAGROCI Operations — Service Worker Offline First */
var CACHE_VERSION = 'ops-offline-v1';
var SHELL_CACHE = 'anagroci-shell-' + CACHE_VERSION;
var RUNTIME_CACHE = 'anagroci-runtime-' + CACHE_VERSION;
var OWN_PREFIXES = ['anagroci-', 'fbms-'];

var SHELL = [
  './index.html',
  './manifest.webmanifest',
  './assets/logo-pjs-mark.png',
  './operations/field-buying.html',
  './operations/operations.css',
  './operations/operations-v2.css',
  './operations/cooperatives.css',
  './operations/workspace.js',
  './operations/navigation-v2.js',
  './operations/field-buying.js',
  './operations/aflp-cooperatives.js',
  './operations/aflp-cooperatives-enrolement.js',
  './operations/rt-farmer-rights.js',
  './operations/sacherie-operational-p1.js',
  './shared/auth-gate.js',
  './shared/aflp-access.js',
  './shared/i18n.js',
  './shared/anagroci-audit.js',
  './shared/offline-field.js',
  './shared/farmer-registry-sync.js',
  './shared/farmer-registry-assessment.js',
  './shared/farmer-registry-operations.js',
  './shared/pjs-theme.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css',
  'https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap'
];

function shellUrl(path) { return new URL(path, self.registration.scope).toString(); }
function isOwnCache(name) { return OWN_PREFIXES.some(function (p) { return name.indexOf(p) === 0; }); }
function isSupabaseApi(url) {
  return /\.supabase\.co$/i.test(url.hostname) &&
    (/\/rest\/v1\//.test(url.pathname) || /\/auth\/v1\//.test(url.pathname) ||
     /\/functions\/v1\//.test(url.pathname) || /\/realtime\/v1\//.test(url.pathname) ||
     /\/storage\/v1\//.test(url.pathname));
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (p) {
        var u = shellUrl(p);
        return fetch(u, { cache: 'reload' }).then(function (r) {
          if (r && r.ok) return cache.put(u, r.clone());
        }).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (isOwnCache(k) && k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
        return Promise.resolve(false);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(req, fallbackUrl) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return fetch(req, { cache: 'no-store' }).then(function (resp) {
      if (resp && resp.ok) cache.put(req, resp.clone()).catch(function () {});
      return resp;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (fallbackUrl) return caches.match(shellUrl(fallbackUrl));
        return null;
      }).then(function (resp) {
        return resp || new Response(
          '<!doctype html><meta charset="utf-8"><title>ANAGROCI Operations</title><body><h1>Hors ligne</h1><p>Cette page n’a pas encore été préparée pour le mode terrain.</p></body>',
          { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
        );
      });
    });
  });
}

function cacheFirst(req) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    /* caches.match cherche aussi dans SHELL_CACHE : les assets précachés doivent
       être utilisables avant d'avoir eu une première réponse runtime. */
    return caches.match(req).then(function (hit) {
      var update = fetch(req).then(function (resp) {
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone()).catch(function () {});
        return resp;
      }).catch(function () { return null; });
      return hit || update.then(function (resp) {
        return resp || new Response('', { status: 504, statusText: 'Offline' });
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  /* Les API et données privées Supabase ne sont jamais mises en cache par le SW.
     Les écritures offline passent exclusivement par IndexedDB + offline_sync_batch. */
  if (isSupabaseApi(url)) return;

  if (req.mode === 'navigate' || /\.html$/i.test(url.pathname)) {
    var fieldPage = /\/operations\/field-buying\.html$/i.test(url.pathname);
    var rootPage = /\/fbms\/(?:index\.html)?$/i.test(url.pathname) || /\/index\.html$/i.test(url.pathname);
    if (fieldPage || rootPage) {
      event.respondWith(networkFirst(req, fieldPage ? './operations/field-buying.html' : './index.html'));
    } else if (/\/operations\//.test(url.pathname)) {
      event.respondWith(fetch(req,{cache:'no-store'}).catch(function(){
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ANAGROCI Operations</title>'+
          '<body style="font-family:system-ui;padding:32px;background:#f1f9ef;color:#053b23"><h1>Connexion Internet requise</h1>'+
          '<p>Ce module est actuellement online-first. FIELD BUYING reste disponible en mode terrain hors ligne après préparation.</p>'+
          '<p><a href="./field-buying.html#sync">Ouvrir FIELD BUYING</a></p></body>',
          {status:503,headers:{'content-type':'text/html; charset=utf-8'}}
        );
      }));
    } else {
      event.respondWith(networkFirst(req, null));
    }
    return;
  }

  if (url.hostname.indexOf('tile.openstreetmap.org') >= 0) {
    event.respondWith(cacheFirst(req));
    return;
  }

  /* Assets locaux et dépendances CDN chargées une première fois en ligne :
     cache-first pour pouvoir rouvrir FIELD BUYING sans réseau. */
  if (url.origin === self.location.origin ||
      /(^|\.)jsdelivr\.net$|(^|\.)unpkg\.com$|(^|\.)cdnjs\.cloudflare\.com$|(^|\.)googleapis\.com$|(^|\.)gstatic\.com$/i.test(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'PRECACHE_FIELD') {
    event.waitUntil(caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (p) {
        var u = shellUrl(p);
        return fetch(u).then(function (r) {
          if (r && r.ok) return cache.put(u, r.clone());
        }).catch(function () { return null; });
      }));
    }));
  }
});
