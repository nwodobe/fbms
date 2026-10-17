/* ANAGROCI FIELD BUYING (Android) — adaptations du navigateur intégré.
   Injecté par l'application Android en tête de chaque page servie localement.
   N'existe PAS dans la version Web : le code métier reste strictement identique.
   Rôle :
     1. désactiver le Service Worker (les fichiers sont déjà dans l'APK ; un cache
        SW servirait d'anciens scripts après une mise à jour de l'application) ;
     2. rediriger les exports (lien « download » sur blob:/data:) vers le
        dossier Téléchargements du téléphone ;
     3. brancher window.print() sur l'impression Android ;
     4. exposer window.ANAGROCI_NATIVE pour l'affichage de la version ;
     5. confirmer à l'application le bon démarrage de la version Web active
        (sinon retour automatique à la version précédente) et lui transmettre
        le NOMBRE d'opérations locales non synchronisées (aucune donnée métier) ;
     6. écran « À propos · Version · Synchronisation ». */
(function () {
  'use strict';
  var N = window.AnagrociNative;
  if (!N) return;
  var info = {};
  try { info = JSON.parse(N.appInfo() || '{}'); } catch (e) {}
  window.ANAGROCI_NATIVE = { platform: 'android', app: info.app, version: info.version, web_commit: info.web_commit };
  try { document.documentElement.setAttribute('data-native', 'android'); } catch (e) {}

  /* 1. Service Worker */
  try {
    if (navigator.serviceWorker) {
      var refuse = function () { return Promise.reject(new Error('Service Worker inutile dans l’application Android : fichiers embarqués.')); };
      Object.defineProperty(navigator.serviceWorker, 'register', { value: refuse, configurable: true });
      if (navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
      }
    }
  } catch (e) {}

  /* 2. Exports */
  function save(name, blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || ''), i = s.indexOf(',');
        try { resolve(JSON.parse(N.saveFile(name || 'export-anagroci', blob.type || 'application/octet-stream', i >= 0 ? s.slice(i + 1) : ''))); }
        catch (e) { reject(e); }
      };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function handleAnchor(a) {
    if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
    var href = a.href || '';
    if (!/^(blob:|data:)/.test(href)) return false;
    var name = a.getAttribute('download') || 'export-anagroci';
    fetch(href).then(function (r) { return r.blob(); }).then(function (b) { return save(name, b); })
      .catch(function (e) { alert('Export impossible sur ce téléphone : ' + (e && e.message ? e.message : e)); });
    return true;
  }
  var nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (handleAnchor(this)) return; return nativeClick.apply(this, arguments); };
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[download]') : null;
    if (a && handleAnchor(a)) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);
  /* Les URL blob: sont révoquées très vite par certains exports : on retarde
     la révocation pour laisser le temps à la lecture. */
  var revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = function (u) { setTimeout(function () { revoke.call(URL, u); }, 60000); };

  /* 3. Impression */
  window.print = function () { N.print(document.title || 'ANAGROCI'); };

  /* 5. Confirmation de démarrage + état de la file locale */
  function call(name) { try { return typeof N[name] === 'function' ? N[name].apply(N, [].slice.call(arguments, 1)) : null; } catch (e) { return null; } }
  function json(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }
  function openCount(s) { return s ? (s.pending | 0) + (s.failed | 0) + (s.conflicts | 0) + (s.review | 0) + (s.other_users_open | 0) : -1; }
  var lastSummary = null;
  function reportQueue() {
    var off = window.ANAGROCI_OFFLINE;
    if (!off || typeof off.summary !== 'function') return Promise.resolve(null);
    return off.summary().then(function (s) { lastSummary = s; var n = openCount(s); if (n >= 0) call('reportQueue', n); return s; }).catch(function () { return null; });
  }
  window.addEventListener('anagroci:offline-status', function (ev) {
    lastSummary = ev.detail || lastSummary; var n = openCount(ev.detail); if (n >= 0) call('reportQueue', n); render();
  });
  var mainPage = /\/operations\/field-buying\.html$/.test(location.pathname);
  window.addEventListener('load', function () {
    var t0 = Date.now();
    (function wait() {
      var ready = !mainPage || (window.ANAGROCI_OFFLINE && window.supabase && document.getElementById('opsRouteView'));
      if (ready) { call('confirmBoot'); reportQueue(); return; }
      if (Date.now() - t0 < 30000) setTimeout(wait, 250);
    })();
  });

  /* 6. Écran « À propos · Version · Synchronisation » */
  var panel = null, btn = null, pollTimer = null;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function host(u) { try { return new URL(u).host; } catch (e) { return ''; } }
  function row(k, v) { return '<div class="anx-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; }
  function css() {
    if (document.getElementById('anx-style')) return;
    var st = document.createElement('style'); st.id = 'anx-style';
    st.textContent = '.anx-btn{position:fixed;left:8px;bottom:8px;z-index:2147483000;min-width:44px;min-height:44px;padding:0 12px;border-radius:22px;border:1px solid #0b5d39;background:#053B23;color:#fff;font:600 13px/1 system-ui,sans-serif;opacity:.88;box-shadow:0 2px 6px rgba(0,0,0,.25)}' +
      '.anx-btn.anx-warn{background:#8a4b00;border-color:#8a4b00}.anx-btn:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}' +
      '.anx-ov{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}' +
      '.anx-dlg{background:#fff;color:#1b1b1b;width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:14px 14px 0 0;padding:16px 16px 24px;font:14px/1.45 system-ui,sans-serif;box-sizing:border-box}' +
      '.anx-dlg h2{font-size:17px;margin:0 0 4px;color:#053B23}.anx-dlg h3{font-size:14px;margin:16px 0 6px;color:#053B23;border-bottom:1px solid #e3e3e3;padding-bottom:4px}' +
      '.anx-row{display:flex;justify-content:space-between;gap:12px;padding:3px 0}.anx-row span{color:#555;flex:0 0 auto;max-width:48%}.anx-row b{font-weight:600;text-align:right;overflow-wrap:anywhere;min-width:0}' +
      '.anx-note{margin:6px 0;padding:8px;border-radius:8px;background:#f3f6f4}.anx-note.anx-bad{background:#fdecea;color:#7a1c12}.anx-note.anx-ok{background:#e8f5ec;color:#0b4d2c}' +
      '.anx-act{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.anx-act button{min-height:44px;padding:0 14px;border-radius:8px;border:1px solid #053B23;background:#fff;color:#053B23;font:600 14px system-ui,sans-serif}' +
      '.anx-act button.anx-primary{background:#053B23;color:#fff}.anx-act button[disabled]{opacity:.5}.anx-close{float:right;min-width:44px;min-height:44px;border:0;background:none;font-size:22px;color:#333}';
    document.head.appendChild(st);
  }
  function render() {
    var info = json(call('appInfo')), up = json(call('updateStatus')), s = lastSummary;
    if (btn) {
      var warn = (up.pending_sequence > 0) || (s && (s.failed || s.conflicts || s.review));
      btn.className = 'anx-btn' + (warn ? ' anx-warn' : '');
      btn.textContent = 'v' + String(info.version || '?').split(' ')[0] + (s && openCount(s) > 0 ? ' · ' + openCount(s) : '');
    }
    if (!panel) return;
    var h = '<button type="button" class="anx-close" data-anx="close" aria-label="Fermer">×</button>' +
      '<h2 id="anx-title">À propos · Version · Synchronisation</h2>' +
      '<h3>Application</h3>' + row('Nom', info.app) + row('Version', info.version) + row('Identifiant', info.package) +
      row('Android', (info.android_release || '') + ' (API ' + (info.android_sdk || '?') + ')') +
      row('Signature (SHA-256)', info.signer_sha256 || 'inconnue') +
      '<h3>Version Web active</h3>' + row('Origine', up.active || 'intégrée à l’APK') +
      row('Commit', String(up.active_commit || info.web_commit || '').slice(0, 12)) + row('Numéro', up.active_sequence || '') +
      row('Fichiers mis à jour', up.overlay_files || 0) + row('Format file locale', info.queue_schema || '') +
      '<h3>Mises à jour</h3>';
    if (!up.enabled) h += '<div class="anx-note">Mises à jour Web désactivées dans cet APK' + (up.last_result ? ' (' + esc(String(up.last_result).replace(/^désactivée : /, '')) + ')' : '') + '. La version intégrée reste utilisée.</div>';
    else {
      h += row('Source approuvée', host(up.source)) + row('Canal', up.channel) + row('Dernière vérification', up.last_check_at || 'jamais') +
        row('Résultat', up.checking ? 'vérification en cours…' : (up.last_result || '—'));
      if (up.pending_sequence > 0) h += '<div class="anx-note ' + (up.deferred_reason ? 'anx-bad' : 'anx-ok') + '">Version ' + esc(up.pending_sequence) + ' téléchargée et vérifiée. ' +
        (up.deferred_reason ? 'Activation différée : ' + esc(up.deferred_reason) + '.' : 'Elle sera utilisée au prochain démarrage.') + '</div>';
      var rej = up.rejected || {}, rk = Object.keys(rej);
      if (rk.length) h += '<div class="anx-note anx-bad">Refusée(s) sur ce téléphone : ' + rk.map(function (k) { return esc(k) + ' (' + esc(rej[k]) + ')'; }).join(' ; ') + '</div>';
    }
    h += '<div class="anx-act"><button type="button" data-anx="check"' + (up.enabled && !up.checking ? '' : ' disabled') + '>Vérifier les mises à jour</button>' +
      (up.pending_sequence > 0 && !up.deferred_reason ? '<button type="button" class="anx-primary" data-anx="apply">Redémarrer pour appliquer</button>' : '') + '</div>';
    h += '<h3>Synchronisation</h3>';
    if (!s) h += '<div class="anx-note">État de la file locale indisponible sur cette page.</div>';
    else {
      h += row('Réseau', s.online ? 'en ligne' : 'hors ligne') + row('En attente d’envoi', s.pending | 0) + row('Échecs', s.failed | 0) +
        row('Conflits', s.conflicts | 0) + row('À revoir', s.review | 0) + row('Synchronisées', s.synced | 0) +
        row('Autres utilisateurs du téléphone', s.other_users_open | 0);
      if (s.syncing) h += '<div class="anx-note">Synchronisation en cours (' + esc(s.done | 0) + '/' + esc(s.total | 0) + ')…</div>';
      if (s.lastError) h += '<div class="anx-note anx-bad">Dernière erreur : ' + esc(s.lastError) + '</div>';
      if (openCount(s) > 0) h += '<div class="anx-note anx-bad">Ne désinstallez pas l’application et ne videz pas ses données : ' + esc(openCount(s)) + ' opération(s) ne sont encore que sur ce téléphone.</div>';
      else h += '<div class="anx-note anx-ok">Aucune opération locale en attente.</div>';
    }
    h += '<div class="anx-act"><button type="button" data-anx="sync"' + (s && s.online && !s.syncing ? '' : ' disabled') + '>Synchroniser maintenant</button></div>';
    /* Ne réécrire que si le contenu change, et rendre le focus au même bouton :
       un rafraîchissement ne doit ni avaler un appui ni perdre le focus clavier. */
    var dlg = panel.querySelector('.anx-dlg');
    if (dlg.__html === h) return;
    var f = document.activeElement && dlg.contains(document.activeElement) && document.activeElement.getAttribute('data-anx');
    dlg.innerHTML = h; dlg.__html = h;
    if (f) { var nb = dlg.querySelector('[data-anx="' + f + '"]'); if (nb && !nb.disabled) nb.focus(); else dlg.focus(); }
  }
  function close() {
    if (!panel) return; panel.remove(); panel = null; clearInterval(pollTimer); pollTimer = null; if (btn) btn.focus();
  }
  function open() {
    if (panel) return;
    panel = document.createElement('div'); panel.className = 'anx-ov';
    panel.innerHTML = '<div class="anx-dlg" role="dialog" aria-modal="true" aria-labelledby="anx-title" tabindex="-1"></div>';
    panel.addEventListener('click', function (ev) {
      if (ev.target === panel) return close();
      var a = ev.target.closest && ev.target.closest('[data-anx]'); if (!a) return;
      var k = a.getAttribute('data-anx');
      if (k === 'close') close();
      else if (k === 'check') { call('checkUpdate'); render(); }
      else if (k === 'apply') call('applyUpdate');
      else if (k === 'sync' && window.ANAGROCI_OFFLINE) window.ANAGROCI_OFFLINE.syncNow().catch(function () {}).then(reportQueue).then(render);
    });
    document.body.appendChild(panel);
    reportQueue().then(render); render();
    panel.querySelector('.anx-dlg').focus();
    pollTimer = setInterval(function () { reportQueue().then(render); }, 3000);
  }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && panel) close(); });
  function mount() {
    if (btn || !document.body) return;
    css();
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'anx-btn'; btn.id = 'anx-version';
    btn.setAttribute('aria-label', 'À propos, version et synchronisation');
    btn.addEventListener('click', open);
    document.body.appendChild(btn); render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.ANAGROCI_NATIVE.openAbout = open;
})();
