/* RCN TRACE - Step 8 incident review board.
   Non destructive helper: reviews local recette incidents and prepares correction decisions. */
(function (global) {
  "use strict";

  var INCIDENT_KEY = "rcntrace:field_incidents:v1";
  var REVIEW_KEY = "rcntrace:incident_reviews:v1";
  var STATUSES = ["À analyser", "Validé métier", "Rejeté", "Correction préparée", "Corrigé à vérifier"];
  var PRIORITIES = ["P0 Bloquant", "P1 Majeur", "P2 Mineur", "P3 Question métier"];

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>\"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function readJson(key) { try { return JSON.parse(global.localStorage.getItem(key) || "[]") || []; } catch (e) { return []; } }
  function writeJson(key, rows) { global.localStorage.setItem(key, JSON.stringify(rows || [])); }
  function incidentId(r, i) { return r.id || [r.when || "na", r.step || "", r.screen || "", i].join("|"); }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ""; }
  function severityToPriority(sev) {
    if (sev === "Bloquant") return "P0 Bloquant";
    if (sev === "Majeur") return "P1 Majeur";
    if (sev === "Mineur") return "P2 Mineur";
    return "P3 Question métier";
  }
  function opt(arr, selected) { return arr.map(function (x) { return '<option value="' + esc(x) + '"' + (x === selected ? " selected" : "") + '>' + esc(x) + '</option>'; }).join(""); }

  function injectStyles() {
    if (document.getElementById("rcn-incident-review-style")) return;
    var css =
      ".rcn-review-toggle{position:fixed;right:18px;bottom:122px;z-index:9997;border:0;border-radius:999px;background:#008F37;color:#fff;padding:10px 14px;font-weight:900;box-shadow:0 8px 22px rgba(0,143,55,.24);cursor:pointer}"+
      ".rcn-review-panel{position:fixed;right:18px;bottom:170px;z-index:9997;width:min(520px,calc(100vw - 28px));max-height:76vh;overflow:auto;background:#fff;border:1px solid #CFCECE;border-radius:18px;box-shadow:0 14px 34px rgba(5,59,35,.22);padding:14px;display:none}"+
      ".rcn-review-panel.open{display:block}"+
      ".rcn-review-panel h3{margin:0 0 4px;color:#053B23;font-size:16px}"+
      ".rcn-review-panel p{margin:0 0 10px;color:#4F4E4E;font-size:12.5px;line-height:1.4}"+
      ".rcn-review-card{border:1px solid #E6E6E6;border-radius:13px;padding:10px;margin:0 0 10px;background:#FAFAFA}"+
      ".rcn-review-card b{display:block;color:#053B23;font-size:12px;margin-bottom:4px}"+
      ".rcn-review-card small{display:block;color:#4F4E4E;font-size:11px;margin-bottom:7px}"+
      ".rcn-review-card label{display:block;margin:7px 0 3px;font-size:10.5px;font-weight:900;color:#053B23;text-transform:uppercase}"+
      ".rcn-review-card input,.rcn-review-card select,.rcn-review-card textarea{width:100%;box-sizing:border-box;border:1px solid #CFCECE;border-radius:9px;padding:7px;font-size:12px;background:#fff}"+
      ".rcn-review-card textarea{min-height:50px;resize:vertical}"+
      ".rcn-review-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}"+
      ".rcn-review-actions button,.rcn-review-card button{border:0;border-radius:10px;padding:8px 10px;font-weight:900;cursor:pointer;background:#053B23;color:#fff}"+
      ".rcn-review-actions button.ghost,.rcn-review-card button.ghost{background:#E0F3DE;color:#053B23}"+
      ".rcn-review-empty{border:1px dashed #CFCECE;border-radius:12px;padding:12px;color:#4F4E4E;font-size:12px;background:#FAFAFA}";
    var st = document.createElement("style"); st.id = "rcn-incident-review-style"; st.textContent = css; document.head.appendChild(st);
  }

  function render() {
    injectStyles();
    if (document.getElementById("rcn-review-toggle")) return;
    var btn = document.createElement("button"); btn.id = "rcn-review-toggle"; btn.className = "rcn-review-toggle"; btn.type = "button"; btn.textContent = "Revue incidents";
    var panel = document.createElement("div"); panel.id = "rcn-review-panel"; panel.className = "rcn-review-panel";
    document.body.appendChild(btn); document.body.appendChild(panel);
    btn.addEventListener("click", function () { panel.classList.toggle("open"); paint(); });
    paint();
  }

  function paint() {
    var panel = document.getElementById("rcn-review-panel"); if (!panel) return;
    var incidents = readJson(INCIDENT_KEY);
    var reviews = readJson(REVIEW_KEY);
    var reviewById = {};
    reviews.forEach(function (r) { reviewById[r.incidentId] = r; });
    var summary = buildSummary(incidents, reviews);
    panel.innerHTML = '<h3>Revue incidents terrain</h3><p>Valider les incidents collectés avant toute correction code. Stockage local uniquement.</p>'+
      '<div class="rcn-review-actions"><button type="button" id="review_copy">Copier plan correction</button><button type="button" class="ghost" id="review_clear">Vider revues locales</button></div>'+
      '<p><b style="color:#053B23">Synthèse :</b> ' + esc(summary) + '</p>' + renderCards(incidents, reviewById);
    var copy = document.getElementById("review_copy"); if (copy) copy.onclick = copyPlan;
    var clear = document.getElementById("review_clear"); if (clear) clear.onclick = clearReviews;
  }

  function buildSummary(incidents, reviews) {
    var valid = reviews.filter(function (r) { return r.status === "Validé métier" || r.status === "Correction préparée" || r.status === "Corrigé à vérifier"; }).length;
    return incidents.length + " incident(s) collecté(s), " + valid + " validé(s) ou préparé(s) pour correction.";
  }

  function renderCards(incidents, reviewById) {
    if (!incidents.length) return '<div class="rcn-review-empty">Aucun incident Step 7 trouvé sur ce navigateur. Exécuter la recette terrain puis revenir ici.</div>';
    return incidents.slice(0, 20).map(function (inc, i) {
      var id = incidentId(inc, i);
      var r = reviewById[id] || {};
      var priority = r.priority || severityToPriority(inc.severity);
      var status = r.status || "À analyser";
      return '<div class="rcn-review-card" data-id="' + esc(id) + '">'+
        '<b>' + esc(inc.step || "Étape non renseignée") + '</b><small>' + esc(inc.severity || "") + ' · ' + esc(inc.screen || "") + ' · ' + esc(inc.when || "") + '</small>'+
        '<div style="font-size:12px;line-height:1.35;color:#242424">' + esc(inc.note || "") + '</div>'+
        '<label>Statut décision</label><select class="review_status">' + opt(STATUSES, status) + '</select>'+
        '<label>Priorité correction</label><select class="review_priority">' + opt(PRIORITIES, priority) + '</select>'+
        '<label>Décision métier</label><textarea class="review_decision" placeholder="Ex : incident confirmé, règle métier à préciser, faux problème...">' + esc(r.decision || "") + '</textarea>'+
        '<label>Action corrective proposée</label><textarea class="review_action" placeholder="Ex : libellé à changer, blocage à ajouter, contrôle à renforcer...">' + esc(r.action || "") + '</textarea>'+
        '<div class="rcn-review-actions"><button type="button" onclick="window.RCNIncidentReview.save(this)">Enregistrer revue</button></div>'+
      '</div>';
    }).join("");
  }

  function save(btn) {
    var card = btn && btn.closest ? btn.closest(".rcn-review-card") : null; if (!card) return;
    var id = card.getAttribute("data-id");
    var reviews = readJson(REVIEW_KEY).filter(function (r) { return r.incidentId !== id; });
    reviews.unshift({
      incidentId: id,
      reviewedAt: new Date().toISOString(),
      status: card.querySelector(".review_status").value,
      priority: card.querySelector(".review_priority").value,
      decision: card.querySelector(".review_decision").value.trim(),
      action: card.querySelector(".review_action").value.trim()
    });
    writeJson(REVIEW_KEY, reviews);
    alert("Revue enregistrée localement.");
    paint();
  }

  function copyPlan() {
    var incidents = readJson(INCIDENT_KEY);
    var reviews = readJson(REVIEW_KEY);
    var byId = {}; reviews.forEach(function (r) { byId[r.incidentId] = r; });
    var txt = incidents.map(function (inc, i) {
      var id = incidentId(inc, i); var r = byId[id] || {};
      return (i + 1) + ". " + (r.priority || severityToPriority(inc.severity)) + " | " + (r.status || "À analyser") + " | " + (inc.step || "") + " / " + (inc.screen || "") + "\nIncident: " + (inc.note || "") + "\nDécision: " + (r.decision || "N/A") + "\nAction: " + (r.action || "N/A");
    }).join("\n\n");
    if (!txt) txt = "Aucun incident à revoir.";
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { alert("Plan de correction copié."); });
    else prompt("Copier le plan de correction", txt);
  }

  function clearReviews() { if (confirm("Vider les décisions de revue locales ? Les incidents Step 7 restent conservés.")) { writeJson(REVIEW_KEY, []); paint(); } }

  global.RCNIncidentReview = { save: save, paint: paint, copyPlan: copyPlan };
  function boot() { try { render(); } catch (e) { console.warn("RCN incident review disabled", e); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(window);
