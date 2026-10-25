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
     6. écran « Version et mises à jour » (version installée, dernière version
        disponible, statut, connexion, opérations en attente, dernière mise à
        jour réussie, bouton « Vérifier les mises à jour ») ;
     7. au retour du réseau : synchroniser D'ABORD les opérations en attente,
        PUIS vérifier les mises à jour (jamais l'inverse). */
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
  /* Opérations locales non synchronisées : file Field Buying + file du registre
     producteurs (parcelles, Sustainability, inspections). Les deux comptent pour
     protéger une mise à jour qui changerait le format des files. */
  function openCount(s) { return s ? (s.pending | 0) + (s.failed | 0) + (s.conflicts | 0) + (s.review | 0) + (s.other_users_open | 0) + (s.registry_pending | 0) : -1; }
  var lastSummary = null;
  function registryPending() {
    var fr = window.AFLP_FARMER_REGISTRY;
    if (!fr || typeof fr.pendingCount !== 'function') return Promise.resolve(0);
    return Promise.resolve().then(function () { return fr.pendingCount(); }).then(function (n) { return n | 0; }).catch(function () { return 0; });
  }
  function reportQueue() {
    var off = window.ANAGROCI_OFFLINE;
    if (!off || typeof off.summary !== 'function') return Promise.resolve(null);
    return Promise.all([off.summary(), registryPending()]).then(function (r) {
      var s = r[0] || {}; s.registry_pending = r[1]; lastSummary = s;
      var n = openCount(s); if (n >= 0) call('reportQueue', n); return s;
    }).catch(function () { return null; });
  }
  /* 7. Retour du réseau : synchronisation d'abord, vérification des mises à jour ensuite. */
  var onlineBusy = false;
  window.addEventListener('online', function () {
    if (onlineBusy) return; onlineBusy = true;
    setTimeout(function () {
      var off = window.ANAGROCI_OFFLINE;
      reportQueue().then(function (s) {
        if (off && typeof off.syncNow === 'function' && s && openCount(s) > 0 && navigator.onLine) return off.syncNow().catch(function () {});
      }).then(reportQueue).then(function () { if (navigator.onLine) call('checkUpdate'); })
        .then(function () { onlineBusy = false; render(); }, function () { onlineBusy = false; });
    }, 4000);
  });
  window.addEventListener('anagroci:offline-status', function (ev) {
    /* L'événement ne décrit que la file Field Buying : on recompte les deux files avant d'informer l'application. */
    if (ev.detail) { var d = ev.detail; d.registry_pending = lastSummary ? lastSummary.registry_pending | 0 : 0; lastSummary = d; }
    reportQueue().then(render);
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
    st.textContent = '.anx-btn{position:fixed;left:8px;bottom:8px;z-index:2147483647;min-width:44px;min-height:44px;padding:0 12px;border-radius:22px;border:1px solid #0b5d39;background:#053B23;color:#fff;font:600 13px/1 system-ui,sans-serif;opacity:.88;box-shadow:0 2px 6px rgba(0,0,0,.25)}' +
      '.anx-btn.anx-warn{background:#8a4b00;border-color:#8a4b00}.anx-btn:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}' +
      '.anx-ov{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}' +
      '.anx-dlg{background:#fff;color:#1b1b1b;width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:14px 14px 0 0;padding:16px 16px 24px;font:14px/1.45 system-ui,sans-serif;box-sizing:border-box}' +
      '.anx-dlg h2{font-size:17px;margin:0 0 4px;color:#053B23}.anx-dlg h3{font-size:14px;margin:16px 0 6px;color:#053B23;border-bottom:1px solid #e3e3e3;padding-bottom:4px}' +
      '.anx-row{display:flex;justify-content:space-between;gap:12px;padding:3px 0}.anx-row span{color:#555;flex:0 0 auto;max-width:48%}.anx-row b{font-weight:600;text-align:right;overflow-wrap:anywhere;min-width:0}' +
      '.anx-note{margin:6px 0;padding:8px;border-radius:8px;background:#f3f6f4}.anx-note.anx-bad{background:#fdecea;color:#7a1c12}.anx-note.anx-ok{background:#e8f5ec;color:#0b4d2c}' +
      '.anx-act{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.anx-act button{min-height:44px;padding:0 14px;border-radius:8px;border:1px solid #053B23;background:#fff;color:#053B23;font:600 14px system-ui,sans-serif}' +
      '.anx-dlg details{margin-top:12px}.anx-dlg summary{min-height:44px;display:flex;align-items:center;font-weight:600;color:#053B23;cursor:pointer}' +
      '.anx-act button.anx-primary{background:#053B23;color:#fff}.anx-act button[disabled]{opacity:.5}.anx-close{float:right;min-width:44px;min-height:44px;border:0;background:none;font-size:22px;color:#333}';
    document.head.appendChild(st);
  }
  var PHASE = {
    a_jour: ['À jour', 'anx-ok'], disponible: ['Mise à jour disponible', ''], telechargement: ['Téléchargement en cours…', ''],
    prete: ['Prête : appliquée au prochain démarrage', 'anx-ok'], differee: ['Téléchargée, activation différée', 'anx-bad'],
    nouvel_apk: ['Nouvel APK requis', 'anx-bad'], erreur: ['Erreur', 'anx-bad'], desactivee: ['Mises à jour désactivées dans cet APK', '']
  };
  function when(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso; } }
  function render() {
    var info = json(call('appInfo')), up = json(call('updateStatus')), s = lastSummary, latest = up.latest || {};
    var phase = up.checking && !up.downloading_sequence ? 'verif' : (up.phase || (up.enabled ? 'a_jour' : 'desactivee'));
    var open = s ? openCount(s) : -1;
    if (btn) {
      var warn = (up.pending_sequence > 0) || phase === 'nouvel_apk' || phase === 'erreur' || (s && (s.failed || s.conflicts || s.review));
      btn.className = 'anx-btn' + (warn ? ' anx-warn' : '');
      btn.textContent = 'v' + String(info.version || '?').split(' ')[0] + (open > 0 ? ' · ' + open : '');
    }
    if (!panel) return;
    var ph = phase === 'verif' ? ['Vérification en cours…', ''] : (PHASE[phase] || [phase, '']);
    var installedWeb = up.active_web_version || String(up.active_commit || info.web_commit || '').slice(0, 7);
    var latestTxt = latest.sequence ? (latest.web_version || latest.sequence) + (latest.published_at ? ' · publiée le ' + when(latest.published_at) : '') : (up.enabled ? 'aucune annoncée pour l’instant' : '—');
    var h = '<button type="button" class="anx-close" data-anx="close" aria-label="Fermer">×</button>' +
      '<h2 id="anx-title">Version et mises à jour</h2>' +
      row('Version installée', 'Application ' + String(info.version || '?') + ' · Web ' + installedWeb) +
      row('Dernière version disponible', latestTxt) +
      '<div class="anx-note ' + ph[1] + '" role="status">Statut : ' + esc(ph[0]) + (phase === 'erreur' && up.last_result ? ' (' + esc(up.last_result) + ')' : '') + '</div>' +
      row('Connexion Internet', navigator.onLine ? 'en ligne' : 'hors ligne') +
      row('Opérations en attente', open < 0 ? 'inconnu sur cette page' : open) +
      row('Synchronisation', !s ? '—' : (s.syncing ? 'en cours (' + (s.done | 0) + '/' + (s.total | 0) + ')' : (open > 0 ? 'à faire' : 'à jour'))) +
      row('Dernière mise à jour réussie', up.last_success_at ? when(up.last_success_at) : 'aucune (version intégrée à l’APK)') +
      row('Dernière vérification', up.last_check_at ? when(up.last_check_at) : 'jamais');
    if (up.pending_sequence > 0) h += '<div class="anx-note ' + (up.deferred_reason ? 'anx-bad' : 'anx-ok') + '">Version ' + esc(latest.web_version || up.pending_sequence) + ' téléchargée et vérifiée. ' +
      (up.deferred_reason ? 'Activation différée : ' + esc(up.deferred_reason) + '.' : 'Elle sera utilisée au prochain démarrage, sans effacer vos données ni vos opérations en attente.') +
      (latest.update_policy === 'security' ? ' <b>Mise à jour de sécurité : redémarrez l’application dès que possible.</b>' : '') + '</div>';
    if (phase === 'nouvel_apk') {
      var nat = latest.native || {};
      h += '<div class="anx-note anx-bad">Cette version a besoin d’un <b>nouvel APK</b>' + (nat.latest_version_name ? ' (' + esc(nat.latest_version_name) + ')' : '') +
        '. Elle ne peut pas s’installer automatiquement : le code Android de l’application doit être remplacé. ' + esc(nat.procedure || 'Contactez le Branch Manager.') +
        ' En attendant, vous continuez à travailler avec la version actuelle.</div>';
    }
    if (up.revoke_pending) h += '<div class="anx-note anx-bad">La version en cours a été retirée par ANAGROCI : retour automatique à la version précédente au prochain démarrage.</div>';
    if (!up.enabled) h += '<div class="anx-note">Mises à jour Web désactivées dans cet APK' + (up.last_result ? ' (' + esc(String(up.last_result).replace(/^désactivée : /, '')) + ')' : '') + '. La version intégrée reste utilisée.</div>';
    if (open > 0) h += '<div class="anx-note anx-bad">Ne désinstallez pas l’application et ne videz pas ses données : ' + esc(open) + ' opération(s) ne sont encore que sur ce téléphone.</div>';
    h += '<div class="anx-act"><button type="button" class="anx-primary" data-anx="check"' + (up.checking ? ' disabled' : '') + '>Vérifier les mises à jour</button>' +
      (up.pending_sequence > 0 && !up.deferred_reason ? '<button type="button" data-anx="apply">Redémarrer pour appliquer</button>' : '') +
      '<button type="button" data-anx="sync"' + (s && s.online && !s.syncing ? '' : ' disabled') + '>Synchroniser maintenant</button></div>';
    if (lastCheckMsg) h += '<div class="anx-note" role="status">' + esc(lastCheckMsg) + '</div>';
    h += '<details><summary>Détails techniques</summary>' +
      row('Identifiant', info.package) + row('Android', (info.android_release || '') + ' (API ' + (info.android_sdk || '?') + ')') +
      row('Signature (SHA-256)', info.signer_sha256 || 'inconnue') +
      row('Version Web active', (up.active || 'intégrée à l’APK') + ' · n° ' + (up.active_sequence || '')) +
      row('Commit', String(up.active_commit || info.web_commit || '').slice(0, 12)) + row('Fichiers mis à jour', up.overlay_files || 0) +
      row('Format des files locales', info.queue_schema || '') +
      (up.enabled ? row('Source approuvée', host(up.source)) + row('Canal', up.channel) + row('Résultat', up.last_result || '—') : '');
    if (s) h += row('Field Buying en attente', (s.pending | 0) + ' · échecs ' + (s.failed | 0) + ' · conflits ' + (s.conflicts | 0) + ' · à revoir ' + (s.review | 0)) +
      row('Registre en attente', s.registry_pending | 0) + row('Autres utilisateurs du téléphone', s.other_users_open | 0);
    var rej = up.rejected || {}, rk = Object.keys(rej);
    if (rk.length) h += '<div class="anx-note anx-bad">Refusée(s) sur ce téléphone : ' + rk.map(function (k) { return esc(k) + ' (' + esc(rej[k]) + ')'; }).join(' ; ') + '</div>';
    if (s && s.lastError) h += '<div class="anx-note anx-bad">Dernière erreur de synchronisation : ' + esc(s.lastError) + '</div>';
    h += '</details>';
    /* Ne réécrire que si le contenu change, et rendre le focus au même bouton :
       un rafraîchissement ne doit ni avaler un appui ni perdre le focus clavier. */
    var dlg = panel.querySelector('.anx-dlg');
    if (dlg.__html === h) return;
    var f = document.activeElement && dlg.contains(document.activeElement) && document.activeElement.getAttribute('data-anx');
    var det = dlg.querySelector('details'); var detOpen = det && det.open;
    dlg.innerHTML = h; dlg.__html = h;
    if (detOpen) { var d2 = dlg.querySelector('details'); if (d2) d2.open = true; }
    if (f) { var nb = dlg.querySelector('[data-anx="' + f + '"]'); if (nb && !nb.disabled) nb.focus(); else dlg.focus(); }
  }
  var lastCheckMsg = '';
  function manualCheck() {
    if (!navigator.onLine) { lastCheckMsg = 'Hors ligne : la vérification se fera au retour du réseau. Vous pouvez continuer à travailler.'; render(); return; }
    var r = json(call('checkUpdate'));
    lastCheckMsg = r.started ? 'Vérification lancée…' : (r.last_result || 'Vérification impossible');
    render();
    var t0 = Date.now();
    (function poll() {
      var st = json(call('updateStatus'));
      if (st.checking && Date.now() - t0 < 120000) return setTimeout(poll, 1000);
      var ph = st.phase;
      lastCheckMsg = ph === 'a_jour' ? 'Aucune mise à jour disponible : votre version est la plus récente.' :
        ph === 'prete' ? 'Mise à jour téléchargée et vérifiée : elle sera appliquée au prochain démarrage.' :
        ph === 'nouvel_apk' ? 'Une nouvelle version existe mais elle exige un nouvel APK.' :
        ph === 'desactivee' ? 'Mises à jour désactivées dans cet APK.' : (st.last_result || '');
      render();
    })();
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
      else if (k === 'check') manualCheck();
      else if (k === 'apply') call('applyUpdate');
      else if (k === 'sync' && window.ANAGROCI_OFFLINE) window.ANAGROCI_OFFLINE.syncNow().catch(function () {}).then(reportQueue).then(render);
    });
    /* Ajouté hors de <body> : visible même au-dessus de l'écran de connexion (accessible avant toute connexion). */
    document.documentElement.appendChild(panel);
    reportQueue().then(render); render();
    panel.querySelector('.anx-dlg').focus();
    pollTimer = setInterval(function () { reportQueue().then(render); }, 3000);
  }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && panel) close(); });
  function mount() {
    if (btn || !document.body) return;
    css();
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'anx-btn'; btn.id = 'anx-version';
    btn.setAttribute('aria-label', 'Version et mises à jour');
    btn.addEventListener('click', open);
    document.documentElement.appendChild(btn); render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.ANAGROCI_NATIVE.openAbout = open;
})();
