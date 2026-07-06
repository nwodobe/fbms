/* ============================================================================
   ANAGROCI — PORTAIL D'AUTHENTIFICATION PARTAGÉ (shared/auth-gate.js)
   ----------------------------------------------------------------------------
   Verrou d'accès unique posé sur CHAQUE page de la plateforme.
   Tant que l'utilisateur n'est pas connecté ET autorisé pour le module,
   la page est masquée par une surcouche plein écran.

   Inclusion (dans le <head> de préférence) :
     <script defer src="../shared/auth-gate.js" data-module="logistique"></script>
     <script defer src="./shared/auth-gate.js"  data-module="portail"></script>

   IMPORTANT — DOUBLE COUCHE DE SÉCURITÉ :
     · Ce script masque l'INTERFACE (couche client).
     · La vraie serrure est la RLS Supabase (voir supabase/rls.sql) qui refuse
       toute requête de données à un utilisateur non authentifié / hors rôle,
       même en contournant cette page. Les deux sont nécessaires.

   Modèle de données (aligné sur shared/anagroci-config.js) :
     table profils : user_id (uuid), nom (text), role (text), actif (bool).
   ========================================================================== */
(function () {
  "use strict";

  var SCRIPT = document.currentScript;
  var MODULE = (SCRIPT && SCRIPT.getAttribute("data-module")) || "portail";

  var SUPABASE_URL = "https://jmbdgpdthzpszfnddwzi.supabase.co";
  var SUPABASE_ANON = "sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d";
  var CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

  /* -- Rôle Supabase → niveau de droits (identique à ANAGROCI.ROLES.niveau) -- */
  function niveau(role) {
    switch (role) {
      case "Branch Manager":
      case "Assistant Branch Manager":
      case "Head of Field":
      case "Procurement Officer": return "bm";
      case "Supervisor":          return "chef";
      case "Agent Recenseur":     return "agent";
      case "Consultation uniquement": return "direction";
      default:                    return "agent";
    }
  }
  function estBM(role) { return role === "Branch Manager"; }

  /* -- Droits d'accès par module (niveaux autorisés) ------------------------ */
  var ACCESS = {
    portail:    ["bm", "chef", "agent", "direction"],
    fbms:       ["bm", "chef", "agent"],
    hubs:       ["bm", "chef", "agent", "direction"],
    carte:      ["bm", "chef", "agent", "direction"],
    audit:      ["bm", "chef"],
    logistique: ["bm", "chef"],
    admin:      ["bm"],
  };

  /* -- Surcouche plein écran (posée immédiatement, avant tout affichage) ----- */
  var GREEN = "#053B23";
  var overlay = document.createElement("div");
  overlay.id = "anagroci-authgate";
  overlay.setAttribute("style", [
    "position:fixed", "inset:0", "z-index:2147483647",
    "background:radial-gradient(1000px 500px at 80% -10%,#0d6b3e,transparent 55%),linear-gradient(135deg,#03301c,#053B23 55%,#0a4a2c)",
    "display:flex", "align-items:center", "justify-content:center",
    "font-family:'Segoe UI',system-ui,Arial,sans-serif", "color:#eafff2", "padding:20px"
  ].join(";"));
  overlay.innerHTML =
    '<div style="text-align:center">' +
    '<div style="width:44px;height:44px;margin:auto;border:4px solid rgba(255,255,255,.25);border-top-color:#8DC556;border-radius:50%;animation:agspin 1s linear infinite"></div>' +
    '<p style="margin-top:14px;font-size:13px;opacity:.85">Vérification de l\'accès…</p></div>';

  // Styles persistants (posés dans <head> pour survivre aux remplacements d'innerHTML).
  var css = document.createElement("style");
  css.textContent =
    '@keyframes agspin{to{transform:rotate(360deg)}}' +
    '#anagroci-authgate input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.25);' +
    'background:rgba(255,255,255,.08);color:#fff;border-radius:10px;padding:12px 13px;font-size:15px;margin-top:6px}' +
    '#anagroci-authgate input::placeholder{color:#bfe0cb}' +
    '#anagroci-authgate label{display:block;text-align:left;font-size:11px;font-weight:800;' +
    'letter-spacing:.5px;text-transform:uppercase;color:#bff0cf;margin-top:14px}' +
    '#anagroci-authgate button.ag-primary{width:100%;margin-top:18px;border:0;border-radius:10px;' +
    'background:linear-gradient(135deg,#1f8e3e,#00712C);color:#fff;font-weight:800;font-size:15px;padding:13px;cursor:pointer}' +
    '#anagroci-authgate button.ag-primary:disabled{opacity:.6;cursor:default}';
  (document.head || document.documentElement).appendChild(css);

  function mount() {
    if (!document.body) { return void requestAnimationFrame(mount); }
    document.body.appendChild(overlay);
  }
  mount();

  function box(inner) {
    return '<div style="width:100%;max-width:380px;background:rgba(255,255,255,.06);' +
      'border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:26px 24px;' +
      'box-shadow:0 24px 60px rgba(0,0,0,.35);backdrop-filter:blur(8px)">' + inner + '</div>';
  }
  function logoSvg() {
    return '<svg width="52" height="52" viewBox="0 0 64 64" style="display:block;margin:0 auto 6px">' +
      '<circle cx="32" cy="32" r="30" fill="#fff"/>' +
      '<path d="M46 14 A21 21 0 1 0 51 42" fill="none" stroke="#F0A500" stroke-width="9" stroke-linecap="round"/>' +
      '<path d="M31 50 C22 39 22 25 30 13 C38 25 38 39 31 50 Z" transform="rotate(-14 31 50)" fill="#1E8E3E"/>' +
      '<path d="M31 50 C22 39 22 25 30 13 C38 25 38 39 31 50 Z" transform="rotate(8 31 50)" fill="#34A853"/>' +
      '<path d="M31 50 C24 40 25 28 31 17 C37 28 37 40 31 50 Z" transform="rotate(30 31 50)" fill="#7CB342"/></svg>';
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* -- Vues -------------------------------------------------------------------- */
  function showLogin(message, kind) {
    var note = message
      ? '<div style="margin-top:14px;font-size:13px;border-radius:10px;padding:10px 12px;' +
        (kind === "ok"
          ? 'background:rgba(141,197,86,.18);border:1px solid rgba(141,197,86,.5);color:#dff5d6"'
          : 'background:rgba(224,90,74,.16);border:1px solid rgba(224,90,74,.5);color:#ffd9d2"') +
        '>' + esc(message) + '</div>'
      : "";
    overlay.innerHTML = box(
      logoSvg() +
      '<div style="text-align:center;font-weight:800;font-size:19px;margin-bottom:2px">ANAGROCI Operations Suite</div>' +
      '<div style="text-align:center;font-size:12px;color:#bff0cf;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">Accès sécurisé</div>' +
      '<form id="ag-form">' +
      '<label>Email</label><input id="ag-email" type="email" autocomplete="username" placeholder="vous@anagroci.ci" required>' +
      '<label>Mot de passe</label><input id="ag-pass" type="password" autocomplete="current-password" placeholder="••••••••" required>' +
      '<button class="ag-primary" id="ag-btn" type="submit">Se connecter</button>' +
      note +
      '<p style="margin:16px 0 0;font-size:11.5px;color:#a9d9ba;text-align:center;line-height:1.5">' +
      'Pas encore d\'accès ? Le <b>Branch Manager</b> (administrateur) crée votre compte et vous attribue vos droits.</p>' +
      '</form>'
    );
    var form = document.getElementById("ag-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("ag-email").value.trim().toLowerCase();
      var pass = document.getElementById("ag-pass").value;
      var btn = document.getElementById("ag-btn");
      btn.disabled = true; btn.textContent = "Connexion…";
      SB.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
        if (r.error) { btn.disabled = false; btn.textContent = "Se connecter"; return showLogin("Email ou mot de passe incorrect.", "err"); }
        // Session posée : on recharge pour que la page réinitialise avec l'identité.
        location.reload();
      });
    });
  }

  function showDenied(prof) {
    overlay.innerHTML = box(
      logoSvg() +
      '<div style="text-align:center;font-weight:800;font-size:18px;margin-bottom:6px">Accès non autorisé</div>' +
      '<p style="font-size:13.5px;color:#dcefe1;line-height:1.55;text-align:center">Bonjour <b>' + esc(prof.nom || "") + '</b>.<br>' +
      'Votre rôle (<b>' + esc(prof.role || "") + '</b>) ne permet pas d\'ouvrir ce module.<br>' +
      'Contactez le Branch Manager si besoin.</p>' +
      '<button class="ag-primary" onclick="location.href=\'' + portailHref() + '\'">Retour au portail</button>' +
      '<button class="ag-primary" style="background:transparent;border:1px solid rgba(255,255,255,.3);margin-top:10px" id="ag-out">Se déconnecter</button>'
    );
    document.getElementById("ag-out").addEventListener("click", function () {
      SB.auth.signOut().then(function () { location.reload(); });
    });
  }

  function portailHref() {
    // Chemin relatif robuste vers la racine (le portail est /index.html).
    return /\/(fbms|logistique|suite|shared)\//.test(location.pathname) ? "../index.html" : "index.html";
  }

  /* -- Chip utilisateur + déconnexion (une fois autorisé) -------------------- */
  function injectChip(prof) {
    var chip = document.createElement("div");
    chip.id = "anagroci-userchip";
    chip.setAttribute("style", [
      "position:fixed", "top:12px", "right:12px", "z-index:2147483000",
      "display:flex", "align-items:center", "gap:8px",
      "background:rgba(5,59,35,.92)", "color:#eafff2", "border:1px solid rgba(255,255,255,.16)",
      "border-radius:999px", "padding:6px 8px 6px 12px", "font:600 12px 'Segoe UI',Arial,sans-serif",
      "box-shadow:0 8px 22px rgba(0,0,0,.25)", "backdrop-filter:blur(6px)"
    ].join(";"));
    var initials = (prof.nom || "?").split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
    chip.innerHTML =
      '<span style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      esc(prof.nom || prof.role) + ' · <span style="color:#8DC556">' + esc(prof.role) + '</span></span>' +
      (estBM(prof.role)
        ? '<a href="' + portailHref().replace("index.html", "shared/admin.html") + '" title="Administration" ' +
          'style="text-decoration:none;width:26px;height:26px;border-radius:50%;background:#8DC556;color:#053B23;' +
          'display:grid;place-items:center;font-weight:800">⚙</a>'
        : '') +
      '<button id="ag-logout" title="Déconnexion" style="width:26px;height:26px;border:0;border-radius:50%;' +
      'background:rgba(255,255,255,.14);color:#fff;cursor:pointer;font-size:13px">⏻</button>';
    document.body.appendChild(chip);
    document.getElementById("ag-logout").addEventListener("click", function () {
      SB.auth.signOut().then(function () { location.reload(); });
    });
  }

  function reveal(prof) {
    var chip;
    try { injectChip(prof); } catch (e) {}
    // Expose au reste de la page.
    window.ANAGROCI_AUTH = {
      profile: prof, niveau: niveau(prof.role), estBM: estBM(prof.role),
      signOut: function () { return SB.auth.signOut().then(function () { location.reload(); }); }
    };
    document.dispatchEvent(new CustomEvent("anagroci:authenticated", { detail: window.ANAGROCI_AUTH }));
    overlay.parentNode && overlay.parentNode.removeChild(overlay);
  }

  /* -- Contrôle d'accès -------------------------------------------------------- */
  var SB;
  function run() {
    SB = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    SB.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) { return showLogin(); }
      SB.from("profils").select("nom, role, actif").eq("user_id", session.user.id).single().then(function (r) {
        if (r.error || !r.data) { return SB.auth.signOut().then(function () { showLogin("Profil introuvable. Contactez le Branch Manager."); }); }
        if (!r.data.actif) { return SB.auth.signOut().then(function () { showLogin("Compte désactivé. Contactez le Branch Manager."); }); }
        var lvl = niveau(r.data.role);
        var allowed = ACCESS[MODULE] || [];
        if (allowed.indexOf(lvl) < 0) { return showDenied(r.data); }
        reveal(r.data);
      });
    });
  }

  function ensureSupabase(cb) {
    if (window.supabase && window.supabase.createClient) { return cb(); }
    var sc = document.createElement("script");
    sc.src = CDN; sc.onload = cb;
    sc.onerror = function () {
      overlay.innerHTML = box('<p style="text-align:center">Impossible de charger le module de sécurité (réseau).<br>Réessayez.</p>');
    };
    document.head.appendChild(sc);
  }
  ensureSupabase(run);
})();
