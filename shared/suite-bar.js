/* ============================================================================
   ANAGROCI — BARRE DE SUITE COMMUNE (shared/suite-bar.js)
   ----------------------------------------------------------------------------
   Navigation transversale présente en haut de CHAQUE module de la suite :
   logo → portail, accès direct aux modules, menu « Tous les modules », état
   de synchronisation. Répond à la recommandation §5·1 de l'audit design.

   Intégration : une ligne dans le <head> de chaque page, APRÈS auth-gate.js :
     <script defer src="../shared/suite-bar.js" data-module="ACH"></script>
   (chemin relatif : ./shared/ à la racine, ../shared/ dans les sous-dossiers ;
   data-module = code du module courant).

   Pour les applications plein écran (conteneur en 100dvh/100vh), ajouter
   data-shrink="#app" : la barre réduit ce conteneur de sa propre hauteur
   pour ne rien rogner.
   ========================================================================== */
(function () {
  'use strict';

  var SCRIPT = document.currentScript;
  var ACTIF = (SCRIPT && SCRIPT.getAttribute('data-module')) || '';
  var SHRINK = (SCRIPT && SCRIPT.getAttribute('data-shrink')) || '';
  var BAR_H = 50; // hauteur de la barre (px)

  // Racine du site déduite de l'URL du script (…/shared/suite-bar.js)
  var ROOT = SCRIPT ? SCRIPT.src.replace(/shared\/suite-bar\.js.*$/, '') : './';

  /* ---- Registre des modules --------------------------------------------
     acces : niveaux autorisés — ALIGNÉ sur la matrice ACCESS d'auth-gate.js.
     Niveaux (auth-gate niveau()) : 'bm', 'chef', 'agent', 'direction'. */
  var MODULES = [
    { code: 'CMD', nom: 'Command Center',   url: 'terrain/command.html',      desc: 'Pilotage BM du jour',              acces: ['bm', 'direction'] },
    { code: 'ACH', nom: 'Achats Terrain',   url: 'terrain/achats.html',       desc: 'Saisie journalière RCN',           acces: ['bm', 'chef', 'agent'] },
    { code: 'CFA', nom: 'Caisse & Avances', url: 'terrain/cash.html',         desc: 'Cash control RT',                  acces: ['bm', 'chef'] },
    { code: 'SAC', nom: 'Stock & Sacs',     url: 'terrain/sacs.html',         desc: 'Traçabilité des sacs',             acces: ['bm', 'chef', 'agent'] },
    { code: 'REF', nom: 'FBMS Référentiel', url: 'fbms/index.html',           desc: 'Zones, villages, RT, producteurs', acces: ['bm', 'chef', 'agent'] },
    { code: 'HUB', nom: 'Hubs / Clusters',  url: 'fbms/fbms_hubs.html',       desc: 'GPS hubs & distances usine',       acces: ['bm', 'chef', 'agent', 'direction'] },
    { code: 'MAP', nom: 'Cartographie',     url: 'fbms/fbms_carte.html',      desc: 'Carte interactive terrain',        acces: ['bm', 'chef', 'agent', 'direction'] },
    { code: 'AUD', nom: 'Audit Distances',  url: 'fbms/audit_distances.html', desc: 'Validation distances routières',   acces: ['bm', 'chef'] },
    { code: 'LOG', nom: 'ALIS Logistique',  url: 'logistique/alis_fbms.html', desc: 'Coût rendu usine',                 acces: ['bm', 'chef'] },
    { code: 'RCN', nom: 'RCN TRACE',        url: 'rcntrace/index.html',       desc: 'Traçabilité & bilan matière',      acces: ['bm', 'chef', 'agent', 'direction'] }
  ];

  /* ---- Niveau courant --------------------------------------------------
     Reprend exactement le mapping niveau() d'auth-gate. La source de vérité
     est window.ANAGROCI_AUTH (exposé après connexion). Tant qu'auth-gate n'a
     pas résolu la session, aucun filtrage (tout est visible). */
  function niveauDe(role) {
    switch (role) {
      case 'Branch Manager':
      case 'Assistant Branch Manager':
      case 'Head of Field':
      case 'Procurement Officer': return 'bm';
      case 'Supervisor': return 'chef';
      case 'Agent Recenseur': return 'agent';
      case 'Consultation uniquement': return 'direction';
      default: return role ? 'agent' : null;
    }
  }
  function niveauCourant() {
    try {
      if (window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.niveau) return window.ANAGROCI_AUTH.niveau;
      if (window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.profile) return niveauDe(window.ANAGROCI_AUTH.profile.role);
    } catch (e) { /* ignorer */ }
    return null; // null = pas de filtrage
  }

  /* ---- File de synchronisation ----------------------------------------
     Cumule les enregistrements NON synchronisés (_status !== "synced") des
     files locales réelles des modules terrain. */
  function enAttente() {
    var total = 0;
    ['anagroci_achats', 'anagroci_avances', 'anagroci_recons', 'anagroci_sacs'].forEach(function (k) {
      try {
        var q = JSON.parse(localStorage.getItem(k) || '[]');
        if (Array.isArray(q)) total += q.filter(function (r) { return r && r._status !== 'synced'; }).length;
      } catch (e) { /* ignorer */ }
    });
    return total;
  }

  /* ---- Styles ----------------------------------------------------------- */
  var CSS = [
    '#anagroci-suite-bar{position:sticky;top:0;z-index:2147483001;height:' + BAR_H + 'px;display:flex;align-items:center;gap:10px;padding:0 14px;',
    'background:linear-gradient(120deg,#03301c,#053B23 60%,#0a4a2c);font-family:"IBM Plex Sans",Arial,sans-serif;box-shadow:0 2px 12px rgba(5,59,35,.32);border-bottom:2px solid #8DC556}',
    '#anagroci-suite-bar *{box-sizing:border-box}',
    '#anagroci-suite-bar a{text-decoration:none}',
    '.asb-logo{display:flex;align-items:center;gap:8px;color:#fff;flex:none}',
    '.asb-logo .asb-badge{width:26px;height:26px;border-radius:7px;background:#fff;display:grid;place-items:center;overflow:hidden}',
    '.asb-logo .asb-badge img{height:18px;display:block}',
    '.asb-logo b{font-size:13px;line-height:1.05;display:block}',
    '.asb-logo small{font-size:8.5px;letter-spacing:.12em;color:#8DC556;display:block}',
    '.asb-sep{width:1px;height:22px;background:rgba(255,255,255,.18);flex:none}',
    '.asb-nav{display:flex;align-items:center;gap:3px;flex:1;min-width:0;overflow:hidden}',
    '.asb-nav a{flex:none;white-space:nowrap;font-size:12.5px;font-weight:600;color:#cfe6d6;padding:6px 11px;border-radius:8px}',
    '.asb-nav a:hover{background:rgba(255,255,255,.14);color:#fff}',
    '.asb-nav a.asb-actif{background:#8DC556;color:#053B23;font-weight:700}',
    '.asb-tous{flex:none;display:flex;align-items:center;gap:6px;background:transparent;border:1px solid rgba(255,255,255,.25);color:#cfe6d6;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}',
    '.asb-tous:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.asb-sync{flex:none;border:0;cursor:pointer;border-radius:999px;padding:6px 12px;font-size:11.5px;font-weight:700;font-family:inherit}',
    '.asb-sync.asb-ok{background:rgba(141,197,86,.2);color:#8DC556}',
    '.asb-sync.asb-wait{background:#FDEFCE;color:#8a6a12}',
    '#anagroci-suite-menu{position:fixed;top:' + (BAR_H + 6) + 'px;left:14px;right:14px;max-width:760px;background:#fff;border-radius:14px;box-shadow:0 30px 70px rgba(5,59,35,.3);padding:14px;z-index:2147483002;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px}',
    '#anagroci-suite-menu a{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:10px}',
    '#anagroci-suite-menu a:hover{background:#F1F9EF}',
    '#anagroci-suite-menu .asb-chip{flex:none;width:36px;height:36px;border-radius:9px;display:grid;place-items:center;font-size:10.5px;font-weight:700;color:#fff;background:#0A5531;font-family:"IBM Plex Mono",Consolas,monospace}',
    '#anagroci-suite-menu a.asb-actif .asb-chip{background:#8DC556;color:#053B23}',
    '#anagroci-suite-menu b{display:block;font-size:13px;color:#053B23}',
    '#anagroci-suite-menu span.asb-d{font-size:11px;color:#6b756e}',
    '@media(max-width:1100px){.asb-nav a:nth-of-type(n+4){display:none}}',
    '@media(max-width:900px){.asb-nav a:nth-of-type(n+3){display:none}}',
    '@media(max-width:700px){.asb-nav a{display:none!important}.asb-logo small{display:none}}'
  ].join('');

  var built = false;
  function render() {
    var niveau = niveauCourant();
    var visibles = MODULES.filter(function (m) { return !niveau || m.acces.indexOf(niveau) !== -1; });
    var n = enAttente();

    // Nav rapide : 5 modules, en garantissant que le module courant y figure
    // toujours (même s'il n'est pas dans les 5 premiers) pour marquer la page active.
    var quick = visibles.slice(0, 5);
    if (ACTIF && !quick.some(function (m) { return m.code === ACTIF; })) {
      var act = visibles.filter(function (m) { return m.code === ACTIF; })[0];
      if (act) { quick = quick.slice(0, 4).concat([act]); }
    }
    var nav = quick.map(function (m) {
      return '<a href="' + ROOT + m.url + '"' + (m.code === ACTIF ? ' class="asb-actif"' : '') + ' title="' + m.desc + '">' + m.nom + '</a>';
    }).join('');
    document.querySelector('#anagroci-suite-bar .asb-nav').innerHTML = nav;

    var sync = document.querySelector('#anagroci-suite-bar .asb-sync');
    sync.className = 'asb-sync ' + (n > 0 ? 'asb-wait' : 'asb-ok');
    sync.innerHTML = '&#9679; ' + (n > 0 ? n + ' en attente' : 'Synchronisé');

    document.getElementById('anagroci-suite-menu').innerHTML = visibles.map(function (m) {
      return '<a href="' + ROOT + m.url + '"' + (m.code === ACTIF ? ' class="asb-actif"' : '') + '><span class="asb-chip">' + m.code + '</span><span><b>' + m.nom + '</b><span class="asb-d">' + m.desc + '</span></span></a>';
    }).join('');
  }

  function construire() {
    if (built) return; built = true;

    var style = document.createElement('style');
    style.textContent = CSS;
    // Compensation pour les apps plein écran : réduire le conteneur de BAR_H.
    if (SHRINK) {
      style.textContent += SHRINK + '{height:calc(100dvh - ' + BAR_H + 'px)!important;max-height:calc(100dvh - ' + BAR_H + 'px)!important}';
    }
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'anagroci-suite-bar';
    bar.innerHTML =
      '<a class="asb-logo" href="' + ROOT + 'index.html" title="Portail ANAGROCI">' +
        '<span class="asb-badge"><img src="' + ROOT + 'assets/logo-pjs-mark.png" alt="PJS"></span>' +
        '<span><b>ANAGROCI</b><small>OPERATIONS SUITE</small></span></a>' +
      '<span class="asb-sep"></span><nav class="asb-nav"></nav>' +
      '<button type="button" class="asb-tous">Tous les modules <span style="font-size:9px">&#9660;</span></button>' +
      '<button type="button" class="asb-sync asb-ok">&#9679; Synchronisé</button>';

    var menu = document.createElement('div');
    menu.id = 'anagroci-suite-menu';
    menu.style.display = 'none';

    document.body.insertBefore(bar, document.body.firstChild);
    document.body.appendChild(menu);

    bar.querySelector('.asb-tous').addEventListener('click', function (e) {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'grid' : 'none';
    });
    document.addEventListener('click', function () { menu.style.display = 'none'; });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });

    render();

    // Re-filtrage dès qu'auth-gate a résolu la session (rôle connu).
    document.addEventListener('anagroci:authenticated', render);
    // Rafraîchit le compteur de synchro quand la page reprend le focus.
    window.addEventListener('focus', render);
    window.addEventListener('online', render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', construire);
  } else {
    construire();
  }
})();
