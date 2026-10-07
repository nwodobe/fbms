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
    if ((el.value || "").indexOf("@") >= 0) return true;
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

  document.addEventListener("input", function (e) { upcase(e.target); }, true);
  document.addEventListener("change", function (e) { upcase(e.target); }, true);

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

  function loadFieldBuyingDashboardAudit(){
    try {
      if (!/\/fbms\/index\.html$/.test(location.pathname)) return;
      if (document.getElementById("fbms-dashboard-audit-script")) return;
      var s = document.createElement("script");
      s.id = "fbms-dashboard-audit-script";
      s.defer = true;
      s.src = "../shared/fbms-dashboard-audit.js?v=20260807-audit";
      document.head.appendChild(s);
    } catch (e) { /* ignorer */ }
  }

  function appendScript(id, src){
    if (document.getElementById(id)) return;
    var s = document.createElement("script");
    s.id = id;
    s.defer = true;
    s.src = src;
    document.head.appendChild(s);
  }

  function loadFarmerRegistryPhase1(){
    try {
      if (!/\/fbms\/index\.html$/.test(location.pathname)) return;
      appendScript(
        "farmer-enrollment-phase1-script",
        "../shared/farmer-enrollment-phase1.js?v=20260818-phase1-1"
      );
      appendScript(
        "farmer-registry-read-phase1-script",
        "../shared/farmer-registry-read-phase1.js?v=20260818-phase1"
      );
      appendScript(
        "farmer-registry-privacy-phase1-script",
        "../shared/farmer-registry-privacy-phase1.js?v=20260818-phase1-2"
      );
      appendScript(
        "farmer-registry-sync-script",
        "../shared/farmer-registry-sync.js?v=20260818-complete-2"
      );
      appendScript(
        "farmer-registry-sync-policy-script",
        "../shared/farmer-registry-sync-policy.js?v=20260818-complete-1"
      );
      appendScript(
        "farmer-registry-assessment-script",
        "../shared/farmer-registry-assessment.js?v=20260818-complete-1"
      );
      appendScript(
        "farmer-registry-passport-script",
        "../shared/farmer-registry-passport.js?v=20260818-complete-1"
      );
      appendScript(
        "farmer-registry-operations-script",
        "../shared/farmer-registry-operations.js?v=20260818-complete-1"
      );
      appendScript(
        "rt-to-producer-script",
        "../shared/rt-to-producer.js?v=20260828-rt-to-producer-1"
      );
      appendScript(
        "farmer-passport-hierarchy-fix-script",
        "../shared/farmer-passport-hierarchy-fix.js?v=20260828-hierarchy-1"
      );
    } catch (e) { /* ignorer */ }
  }

  function loadALISHardening(){
    try {
      if (!/\/logistique\/alis_fbms\.html$/.test(location.pathname)) return;
      if (document.getElementById("alis-hardening-script")) return;
      var s = document.createElement("script");
      s.id = "alis-hardening-script";
      s.defer = true;
      s.src = "../shared/alis-hardening.js?v=20260722-hardening";
      document.head.appendChild(s);
    } catch (e) { /* ignorer */ }
  }

  function loadAuditDistancesFix(){
    try {
      if (!/\/fbms\/audit_distances\.html$/.test(location.pathname)) return;
      if (document.getElementById("audit-distances-fix-script")) return;
      var s = document.createElement("script");
      s.id = "audit-distances-fix-script";
      s.defer = true;
      s.src = "../shared/audit-distances-fix.js?v=20260730-audit-supabase-global";
      document.head.appendChild(s);
    } catch (e) { /* ignorer */ }
  }

  function loadRuntimeHardening(){
    loadFieldBuyingHardening();
    loadFieldBuyingDashboardAudit();
    loadFarmerRegistryPhase1();
    loadALISHardening();
    loadAuditDistancesFix();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadRuntimeHardening);
  else loadRuntimeHardening();
})();
