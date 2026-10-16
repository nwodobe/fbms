/* ANAGROCI FIELD BUYING (Android) — adaptations du navigateur intégré.
   Injecté par l'application Android en tête de chaque page servie localement.
   N'existe PAS dans la version Web : le code métier reste strictement identique.
   Rôle :
     1. désactiver le Service Worker (les fichiers sont déjà dans l'APK ; un cache
        SW servirait d'anciens scripts après une mise à jour de l'application) ;
     2. rediriger les exports (lien « download » sur blob:/data:) vers le
        dossier Téléchargements du téléphone ;
     3. brancher window.print() sur l'impression Android ;
     4. exposer window.ANAGROCI_NATIVE pour l'affichage de la version. */
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
})();
