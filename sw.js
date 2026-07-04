/* ============================================================================
   ANAGROCI FBMS — Service Worker (PWA)
   ----------------------------------------------------------------------------
   Stratégies :
   · Navigation (index.html)      → réseau d'abord (mises à jour immédiates),
                                    cache en secours (démarrage hors ligne).
   · Backend Apps Script          → réseau uniquement, jamais de cache
                                    (données vivantes ; les POST ne sont de
                                    toute façon jamais interceptés).
   · Photos Drive / tuiles carte /
     polices Google               → cache d'abord, rafraîchi en arrière-plan.
   · Librairies CDN + manifeste   → cache d'abord, réseau en secours.
   Pour forcer une purge du cache chez tous les agents : incrémenter
   CACHE_VERSION puis republier ce fichier.
   ========================================================================== */

var CACHE_VERSION = "v0.16.2";
var SHELL_CACHE = "fbms-shell-" + CACHE_VERSION;
var RUNTIME_CACHE = "fbms-runtime-" + CACHE_VERSION;

var PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/lucide@latest/dist/umd/lucide.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
];

/* Installation : pré-cache de la coquille applicative et des librairies.
   allSettled : un CDN indisponible ne bloque pas l'installation. */
self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function(cache){
      return Promise.allSettled(PRECACHE.map(function(url){
        var req = url.indexOf("http") === 0 ? new Request(url, { mode: "no-cors" }) : url;
        return cache.add(req);
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

/* Activation : purge des caches des versions précédentes. */
self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){
        return k !== SHELL_CACHE && k !== RUNTIME_CACHE;
      }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event){
  var req = event.request;
  if (req.method !== "GET") return; // les POST (backend) ne sont jamais interceptés

  var url = new URL(req.url);

  // Backends vivants (Apps Script, Supabase) : toujours le réseau, jamais de
  // cache — des données ou jetons mis en cache seraient dangereux.
  if (url.hostname.indexOf("script.google.com") >= 0 || url.hostname.indexOf("script.googleusercontent.com") >= 0) return;
  if (url.hostname.indexOf(".supabase.co") >= 0 && url.pathname.indexOf("/storage/v1/object/public/") < 0) return;
  // Photos Supabase Storage (publiques) : cache d'abord, rafraîchi en arrière-plan.
  if (url.hostname.indexOf(".supabase.co") >= 0){
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Navigation : réseau d'abord (mises à jour), cache en secours (hors ligne).
  // v0.15.1 : cache par URL (multi-pages : index.html, logistique.html, …) —
  // l'ancienne version écrasait ./index.html avec la page visitée.
  if (req.mode === "navigate"){
    event.respondWith(
      fetch(req).then(function(resp){
        var copy = resp.clone();
        caches.open(SHELL_CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
        return resp;
      }).catch(function(){
        return caches.match(req).then(function(r){
          if (r) return r;
          return caches.match("./index.html").then(function(r2){ return r2 || caches.match("./"); });
        });
      })
    );
    return;
  }

  // Photos Drive, tuiles OpenStreetMap, polices : cache d'abord, rafraîchi en arrière-plan.
  if (url.hostname.indexOf("lh3.googleusercontent.com") >= 0
   || url.hostname.indexOf("tile.openstreetmap.org") >= 0
   || url.hostname.indexOf("fonts.gstatic.com") >= 0){
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Coquille + librairies CDN : cache d'abord, réseau en secours (et mise en cache).
  event.respondWith(
    caches.match(req).then(function(cached){
      if (cached) return cached;
      return fetch(req).then(function(resp){
        var copy = resp.clone();
        caches.open(RUNTIME_CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
        return resp;
      });
    })
  );
});

/** Sert le cache immédiatement et met à jour en arrière-plan. */
function staleWhileRevalidate(req){
  return caches.open(RUNTIME_CACHE).then(function(cache){
    return cache.match(req).then(function(cached){
      var fetching = fetch(req).then(function(resp){
        cache.put(req, resp.clone()).catch(function(){});
        return resp;
      }).catch(function(){ return cached; });
      return cached || fetching;
    });
  });
}
