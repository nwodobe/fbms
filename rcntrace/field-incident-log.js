/* RCN TRACE - Step 7 field incident log.
   Non destructive helper: stores recette incidents locally in the browser only. */
(function (global) {
  "use strict";

  var KEY = "rcntrace:field_incidents:v1";
  var SEVERITIES = ["Bloquant", "Majeur", "Mineur", "Question métier"];
  var STEPS = [
    "01 Réception camion", "02 Sampling qualité", "03 Décision GM", "04 Déchargement / pesée",
    "05 Analyse finale", "06 Lot officiel RCN", "07 Mise en BIN", "08 Transfert Bouaké -> Yakro",
    "09 Réception Yakro entrepôt", "10 Transfert Yakro -> Calibrage", "11 Réception calibrage",
    "12 Opération CAL", "13 Checklist machine", "14 Sorties / QC", "15 Bilan matière / audit"
  ];
  var SCREENS = ["reception", "qualite", "stock", "transfert", "calibrage", "caltransferts", "calreception", "calops", "calsorties", "calqc", "calbins", "rapports", "audit"];

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>\"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function now() { return new Date().toISOString(); }
  function page() { return (global.location.hash || "#accueil").replace(/^#/, "").split("/")[0] || "accueil"; }
  function read() {
    try { return JSON.parse(global.localStorage.getItem(KEY) || "[]") || []; }
    catch (e) { return []; }
  }
  function write(rows) { global.localStorage.setItem(KEY, JSON.stringify(rows || [])); }
  function opt(arr, val) { return arr.map(function (x) { return '<option value="' + esc(x) + '"' + (x === val ? " selected" : "") + '>' + esc(x) + '</option>'; }).join(""); }
  function severityClass(s) {
    if (s === "Bloquant") return "rcn-inc-red";
    if (s === "Majeur") return "rcn-inc-orange";
    if (s === "Mineur") return "rcn-inc-yellow";
    return "rcn-inc-green";
  }

  function injectStyles() {
    if (document.getElementById("rcn-field-incident-style")) return;
    var css =
      ".rcn-inc-toggle{position:fixed;right:18px;bottom:74px;z-index:9998;border:0;border-radius:999px;background:#053B23;color:#fff;padding:10px 14px;font-weight:800;box-shadow:0 8px 22px rgba(5,59,35,.22);cursor:pointer}"+
      ".rcn-inc-panel{position:fixed;right:18px;bottom:122px;z-index:9998;width:min(430px,calc(100vw - 28px));max-height:74vh;overflow:auto;background:#fff;border:1px solid #CFCECE;border-radius:18px;box-shadow:0 14px 34px rgba(5,59,35,.22);padding:14px;display:none}"+
      ".rcn-inc-panel.open{display:block}"+
      ".rcn-inc-panel h3{margin:0 0 4px;color:#053B23;font-size:16px}"+
      ".rcn-inc-panel p{margin:0 0 10px;color:#4F4E4E;font-size:12.5px;line-height:1.4}"+
      ".rcn-inc-panel label{display:block;margin:8px 0 4px;font-size:11px;font-weight:800;color:#053B23;text-transform:uppercase}"+
      ".rcn-inc-panel input,.rcn-inc-panel select,.rcn-inc-panel textarea{width:100%;box-sizing:border-box;border:1px solid #CFCECE;border-radius:10px;padding:8px;font-size:12.5px}"+
      ".rcn-inc-panel textarea{min-height:62px;resize:vertical}"+
      ".rcn-inc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}"+
      ".rcn-inc-actions button{border:0;border-radius:10px;padding:8px 10px;font-weight:800;cursor:pointer;background:#008F37;color:#fff}"+
      ".rcn-inc-actions button.ghost{background:#E0F3DE;color:#053B23}"+
      ".rcn-inc-list{margin-top:12px;border-top:1px solid #E6E6E6;padding-top:10px}"+
      ".rcn-inc-item{border:1px solid #E6E6E6;border-radius:12px;padding:9px;margin:0 0 8px;background:#FAFAFA}"+
      ".rcn-inc-item b{display:block;color:#053B23;font-size:12px;margin-bottom:3px}"+
      ".rcn-inc-item small{display:block;color:#4F4E4E;font-size:11px;margin-bottom:5px}"+
      ".rcn-inc-badge{display:inline-block;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:900;margin-right:5px}"+
      ".rcn-inc-red{background:#FDE2E2;color:#9B1C1C}.rcn-inc-orange{background:#FFE8CC;color:#9A4A00}.rcn-inc-yellow{background:#FFF6BF;color:#705D00}.rcn-inc-green{background:#E0F3DE;color:#053B23}";
    var st = document.createElement("style"); st.id = "rcn-field-incident-style"; st.textContent = css; document.head.appendChild(st);
  }

  function renderList(rows) {
    if (!rows.length) return '<div class="rcn-inc-item"><small>Aucun incident enregistré sur ce navigateur.</small></div>';
    return rows.slice(0, 12).map(function (r) {
      return '<div class="rcn-inc-item"><b><span class="rcn-inc-badge ' + severityClass(r.severity) + '">' + esc(r.severity) + '</span>' + esc(r.step) + '</b>'+
        '<small>' + esc(r.screen) + ' · ' + esc(r.when) + ' · ' + esc(r.owner || "responsable non renseigné") + '</small>'+
        '<div style="font-size:12px;color:#242424;line-height:1.35">' + esc(r.note) + '</div></div>';
    }).join("");
  }

  function render() {
    injectStyles();
    if (document.getElementById("rcn-inc-toggle")) return;
    var btn = document.createElement("button"); btn.id = "rcn-inc-toggle"; btn.className = "rcn-inc-toggle"; btn.type = "button"; btn.textContent = "Incidents recette";
    var panel = document.createElement("div"); panel.id = "rcn-inc-panel"; panel.className = "rcn-inc-panel";
    document.body.appendChild(btn); document.body.appendChild(panel);
    btn.addEventListener("click", function () { panel.classList.toggle("open"); paint(); });
    paint();
  }

  function paint() {
    var panel = document.getElementById("rcn-inc-panel"); if (!panel) return;
    var rows = read();
    panel.innerHTML = '<h3>Registre incidents recette</h3><p>À utiliser pendant la recette terrain. Stockage local uniquement : aucune écriture Supabase.</p>'+
      '<label>Étape du flux</label><select id="inc_step">' + opt(STEPS, STEPS[0]) + '</select>'+
      '<label>Écran concerné</label><select id="inc_screen">' + opt(SCREENS, page()) + '</select>'+
      '<label>Gravité</label><select id="inc_sev">' + opt(SEVERITIES, "Majeur") + '</select>'+
      '<label>Responsable / observateur</label><input id="inc_owner" placeholder="Nom">'+
      '<label>Observation terrain</label><textarea id="inc_note" placeholder="Décrire précisément le blocage, l’écran, le bouton, la donnée et le résultat attendu."></textarea>'+
      '<div class="rcn-inc-actions"><button type="button" id="inc_save">Enregistrer</button><button type="button" class="ghost" id="inc_copy">Copier synthèse</button><button type="button" class="ghost" id="inc_clear">Vider local</button></div>'+
      '<div class="rcn-inc-list"><b style="font-size:12px;color:#053B23">Incidents enregistrés (' + rows.length + ')</b>' + renderList(rows) + '</div>';
    document.getElementById("inc_save").onclick = saveIncident;
    document.getElementById("inc_copy").onclick = copySummary;
    document.getElementById("inc_clear").onclick = clearAll;
  }

  function saveIncident() {
    var note = (document.getElementById("inc_note") || {}).value || "";
    if (!note.trim()) { alert("Observation obligatoire."); return; }
    var rows = read();
    rows.unshift({ when: now(), step: val("inc_step"), screen: val("inc_screen"), severity: val("inc_sev"), owner: val("inc_owner"), note: note.trim(), url: global.location.hash || "" });
    write(rows); paint();
  }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ""; }
  function clearAll() { if (confirm("Vider les incidents locaux de ce navigateur ?")) { write([]); paint(); } }
  function copySummary() {
    var txt = read().map(function (r, i) { return (i + 1) + ". [" + r.severity + "] " + r.step + " / " + r.screen + " - " + r.note + " (" + (r.owner || "N/A") + ")"; }).join("\n");
    if (!txt) txt = "Aucun incident enregistré.";
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { alert("Synthèse copiée."); });
    else prompt("Copier la synthèse", txt);
  }

  function boot() { try { render(); } catch (e) { console.warn("RCN incident log disabled", e); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(window);
