/* ANAGROCI service worker: injects FR/EN switch into every HTML module */
const I18N_SCRIPT = '<script id="anagroci-i18n-js" defer src="/fbms/shared/i18n.js?v=ede4aed"></script>';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const req = event.request;
  const accept = req.headers.get('accept') || '';
  if (req.method !== 'GET' || (!req.mode.includes('navigate') && !accept.includes('text/html'))) return;
  event.respondWith((async () => {
    // Toujours recuperer le HTML frais depuis le reseau (sans passer par le cache
    // HTTP de GitHub Pages, max-age=600) : sinon une page deja visitee restait en
    // cache jusqu'a 10 min et les nouvelles versions n'apparaissaient pas.
    let res;
    try { res = await fetch(req, { cache: 'no-store' }); }
    catch (e) { res = await fetch(req); }   // repli (ex. hors ligne)
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html')) return res;
    let html = await res.text();
    if (!html.includes('anagroci-i18n-js')) {
      html = html.replace(/<\/head>/i, I18N_SCRIPT + '</head>');
    }
    return new Response(html, { status: res.status, statusText: res.statusText, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  })());
});
