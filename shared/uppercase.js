/* ============================================================================
   ANAGROCI — MAJUSCULES OBLIGATOIRES (shared/uppercase.js)
   ----------------------------------------------------------------------------
   Force les champs texte en MAJUSCULES sur toute la page, y compris les
   formulaires générés dynamiquement (délégation d'événements sur document).
   Objectif : cohérence des données de référence et de transaction
   (ex. éviter "Diabo" vs "DIABO").

   Inclusion :
     <script defer src="../shared/uppercase.js"></script>

   EXCLUSIONS (jamais mises en majuscules) :
     · types non-texte : email, password, number, search, tel, url, date…
     · identifiants sensibles : id/name contenant pin, mail, pass, search,
       login, otp, token (protège connexion + PIN générés)
     · autocomplete username / current-password / email / one-time-code
     · valeur ressemblant à un email (contient « @ »)
     · champs marqués class="no-up"
   ========================================================================== */
(function () {
  "use strict";

  var BLOCK_TYPES = {
    email:1, password:1, number:1, search:1, tel:1, url:1, date:1, time:1,
    "datetime-local":1, month:1, week:1, file:1, checkbox:1, radio:1,
    range:1, color:1, hidden:1
  };
  var SENSITIVE = /(pin|mail|pass|search|recherche|login|otp|token)/i;

  function skip(el) {
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return true;
    if (el.tagName === "INPUT" && BLOCK_TYPES[(el.type || "text").toLowerCase()]) return true;
    if (el.classList && el.classList.contains("no-up")) return true;
    var ac = (el.getAttribute && (el.getAttribute("autocomplete") || "")).toLowerCase();
    if (ac.indexOf("password") >= 0 || ac === "username" || ac === "email" || ac === "one-time-code") return true;
    var idn = ((el.id || "") + " " + (el.name || ""));
    if (SENSITIVE.test(idn)) return true;
    if ((el.value || "").indexOf("@") >= 0) return true;   // ressemble à un email
    return false;
  }

  function upcase(el) {
    if (skip(el)) return;
    var s = el.value;
    if (!s) return;
    var u = s.toUpperCase();
    if (u === s) return;
    var a = el.selectionStart, b = el.selectionEnd;
    el.value = u;
    try { if (a != null) el.setSelectionRange(a, b); } catch (e) { /* selection non supportée */ }
  }

  // Capture : on normalise avant les gestionnaires de la page (recherche, filtres…).
  document.addEventListener("input", function (e) { upcase(e.target); }, true);
  document.addEventListener("change", function (e) { upcase(e.target); }, true);

  // Hardening FIELD BUYING : injecté seulement sur le référentiel FBMS.
  // Le chargement reste non destructif et ne touche pas aux autres modules.
  function loadFieldBuyingHardening(){
    try {
      if (!/\/fbms\/index\.html$/.test(location.pathname)) return;
      if (document.getElementById("fbms-field-hardening-script")) return;
      var s = document.createElement("script");
      s.id = "fbms-field-hardening-script";
      s.defer = true;
      s.src = "../shared/fbms-field-hardening.js?v=20260721-hardening";
      document.head.appendChild(s);
    } catch (e) { /* ignorer */ }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadFieldBuyingHardening);
  else loadFieldBuyingHardening();
})();
