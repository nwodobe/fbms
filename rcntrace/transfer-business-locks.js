/* RCN TRACE - Step 4 transfer business locks.
   Non destructive runtime guard: no data migration, no schema change. */
(function (global) {
  "use strict";
  var installed = false;

  function ready() { return !!(global.RCN && global.RCNUI); }
  function norm(v) { return String(v == null ? "" : v).trim().toUpperCase(); }
  function isWarehouseTransfer(t) { return t && t.destinationType === "warehouse"; }
  function isCalTransfer(t) { return t && t.destinationType !== "warehouse"; }
  function isReceivedAtCal(t) { return !!(t && (t.etat === global.RCN.ETAT_TRF.RECU || t.etat === global.RCN.ETAT_TRF.PARTIEL) && t.recCal && t.recCal.valide !== false); }
  function isYakroBin(binId) { return /^(YAK|YAM|YAKRO)/.test(norm(binId)); }
  function msg(text) { throw new Error(text); }

  function validateTransferForCal(trfId, action) {
    var R = global.RCN;
    var t = R.getTrf(trfId);
    if (!t) msg("Transfert introuvable : impossible de " + action + ".");
    if (isWarehouseTransfer(t)) msg("Blocage métier : ce transfert est destiné à un entrepôt (" + (t.destinationSite || "site non précisé") + "), pas au calibrage. Il doit être réceptionné, analysé et rangé en BIN d'entrepôt.");
    if (!isCalTransfer(t)) msg("Blocage métier : destination calibrage non confirmée.");
    if (!isReceivedAtCal(t)) msg("Blocage métier : le transfert " + t.id + " doit être reçu et validé au calibrage avant toute opération CAL.");
    return t;
  }

  function validateCycleForCalTransfer(cycleId, meta) {
    var R = global.RCN;
    meta = meta || {};
    if (meta.destinationType !== "calibrage") return;
    var c = R.getCycle(cycleId);
    if (!c) msg("Cycle BIN introuvable : impossible de préparer un transfert vers calibrage.");
    if (!isYakroBin(c.binId)) msg("Blocage métier : seul un stock BIN Yakro peut être envoyé vers calibrage. Transférez d'abord la matière vers Yakro entrepôt, puis créez un transfert Yakro -> Calibrage.");
  }

  function wrapCore() {
    var R = global.RCN;
    if (!R || R.__step4TransferLocks) return;
    var oldPrepare = R.prepareTransfer;
    var oldReceive = R.receiveAtCalibrage;
    var oldCreate = R.createCal;
    R.prepareTransfer = function (cycleId, poids, destination, meta) {
      validateCycleForCalTransfer(cycleId, meta || {});
      return oldPrepare.apply(R, arguments);
    };
    R.receiveAtCalibrage = function (trfId, d) {
      var t = R.getTrf(trfId);
      if (!t) msg("Transfert introuvable : réception calibrage impossible.");
      if (isWarehouseTransfer(t)) msg("Blocage métier : réception calibrage refusée. Ce transfert est destiné à l'entrepôt " + (t.destinationSite || "non précisé") + ".");
      return oldReceive.apply(R, arguments);
    };
    R.createCal = function (trfId, d) {
      validateTransferForCal(trfId, "créer une opération de calibrage");
      return oldCreate.apply(R, arguments);
    };
    R.__step4TransferLocks = true;
  }

  function addStyles() {
    if (document.getElementById("rcn-transfer-locks-style")) return;
    var css = ".rcn-lock-note{margin:10px 0 16px;border:1px solid #F5B229;border-left:5px solid #EE9E00;border-radius:12px;background:#FDEFCE;padding:11px 13px;color:#053B23;font-size:12.5px;line-height:1.45}"+
      ".rcn-lock-note b{display:block;font-family:var(--fd);font-size:13px;margin-bottom:3px}"+
      ".rcn-lock-disabled{opacity:.55;pointer-events:none;filter:grayscale(.25)}";
    var st = document.createElement("style"); st.id = "rcn-transfer-locks-style"; st.textContent = css; document.head.appendChild(st);
  }

  function currentPage() { return (global.location.hash || "#accueil").replace(/^#/, "").split("/")[0] || "accueil"; }
  function enhanceScreen() {
    if (!ready()) return;
    addStyles();
    var page = currentPage();
    var view = document.getElementById("view");
    if (!view) return;
    var old = view.querySelector(".rcn-lock-note"); if (old) old.remove();
    var txt = "";
    if (page === "calops") txt = "Verrou actif : une opération CAL ne peut être créée qu'après réception validée d'un transfert Yakro -> Calibrage. Un simple stock Yakro entrepôt ne suffit pas.";
    else if (page === "calreception") txt = "Verrou actif : cette réception concerne uniquement les transferts explicitement destinés au calibrage. Les transferts Bouaké -> Yakro restent des réceptions entrepôt.";
    else if (page === "caltransferts") txt = "Verrou actif : cette liste doit contenir seulement les transferts vers calibrage, jamais les BIN simplement stockées à Yakro.";
    else if (page === "transfert") txt = "Verrou actif : distinguer destination entrepôt et destination calibrage avant toute expédition ou réception.";
    if (!txt) return;
    var head = view.querySelector(".pagehead");
    if (!head) return;
    var box = document.createElement("div");
    box.className = "rcn-lock-note";
    box.innerHTML = "<b>Verrou métier Bouaké / Yakro / Calibrage</b>" + txt;
    head.insertAdjacentElement("afterend", box);
  }

  function install() {
    if (installed || !ready()) return;
    installed = true;
    wrapCore();
    enhanceScreen();
  }
  function schedule() { clearTimeout(schedule.t); schedule.t = setTimeout(function () { install(); enhanceScreen(); }, 120); }

  global.addEventListener("hashchange", schedule);
  global.addEventListener("load", schedule);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule); else schedule();
  var mo = new MutationObserver(schedule);
  function arm() { var v = document.getElementById("view"); if (v) mo.observe(v, { childList: true, subtree: false }); schedule(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arm); else arm();
})(window);
