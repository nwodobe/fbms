/* ANAGROCI FBMS - Service Worker refresh */
var CACHE_VERSION = "v0.16.6";
var SHELL_CACHE = "fbms-shell-" + CACHE_VERSION;
var RUNTIME_CACHE = "fbms-runtime-" + CACHE_VERSION;
self.addEventListener("install", function(event){ self.skipWaiting(); });
self.addEventListener("activate", function(event){
  event.waitUntil(caches.keys().then(function(keys){ return Promise.all(keys.map(function(k){ return caches.delete(k); })); }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("fetch", function(event){
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.hostname.indexOf(".supabase.co") >= 0 && url.pathname.indexOf("/storage/v1/object/public/") < 0) return;
  if (req.mode === "navigate" || url.pathname.endsWith(".html")){
    event.respondWith(fetch(req, { cache: "no-store" }).catch(function(){ return caches.match(req); }));
    return;
  }
  if (url.hostname.indexOf("tile.openstreetmap.org") >= 0){
    event.respondWith(caches.open(RUNTIME_CACHE).then(function(cache){ return cache.match(req).then(function(cached){ var f=fetch(req).then(function(resp){ cache.put(req, resp.clone()).catch(function(){}); return resp; }).catch(function(){ return cached; }); return cached || f; }); }));
    return;
  }
  event.respondWith(fetch(req).catch(function(){ return caches.match(req); }));
});
