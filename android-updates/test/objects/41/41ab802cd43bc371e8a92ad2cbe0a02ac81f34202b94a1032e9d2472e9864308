/* RCN TRACE - Step 6 pre-recette workflow guide.
   Non destructive UI helper: displays the end-to-end field workflow checklist. */
(function (global) {
  "use strict";

  var STEPS = [
    { n: "01", label: "Réception camion", page: "reception", rule: "Créer un dossier REC avec site exact : Bouaké ou Yakro." },
    { n: "02", label: "Sampling qualité", page: "qualite", rule: "Saisir GK / Immature / Spotted, humidité, NC et défauts." },
    { n: "03", label: "Décision GM", page: "qualite", rule: "Aucun déchargement sans décision GM claire." },
    { n: "04", label: "Déchargement / pesée", page: "reception", rule: "Capturer poids, sacs, fiche, prestataire et BIN de décharge." },
    { n: "05", label: "Lot officiel RCN", page: "qualite", rule: "Le lot porte l'identité matière ; la BIN porte la position." },
    { n: "06", label: "Mise en BIN", page: "stock", rule: "Contrôler capacité, contributeurs et site de la BIN." },
    { n: "07", label: "Transfert Bouaké -> Yakro", page: "transfert", rule: "Destination entrepôt : ne pas confondre avec calibrage." },
    { n: "08", label: "Réception Yakro entrepôt", page: "reception", rule: "Recréer réception + sampling + GM + lot/BIN Yakro." },
    { n: "09", label: "Transfert Yakro -> Calibrage", page: "transfert", rule: "Seule une BIN Yakro peut alimenter le calibrage." },
    { n: "10", label: "Réception calibrage", page: "calreception", rule: "Rapprocher poids envoyé/reçu et traiter les écarts." },
    { n: "11", label: "Opération CAL", page: "calops", rule: "Créer CAL uniquement depuis un TRF calibrage reçu." },
    { n: "12", label: "Checklist machine", page: "calops", rule: "Toutes les vérifications doivent être complètes avant démarrage." },
    { n: "13", label: "Sorties calibres", page: "calsorties", rule: "Saisir C1-C9, rejets, restes et écart matière." },
    { n: "14", label: "QC sorties", page: "calqc", rule: "Sortie bloquée/rejetée ne doit pas alimenter une BIN conforme." },
    { n: "15", label: "Bilan matière / audit", page: "calrapports", rule: "Clôturer seulement si les écarts sont expliqués et validés." }
  ];

  var NEG = [
    "Tentative Bouaké -> Calibrage directe",
    "Tentative CAL depuis stock Yakro sans TRF calibrage",
    "Réception calibrage d'un transfert entrepôt",
    "Démarrage CAL sans checklist complète",
    "Alimentation machine supérieure au reçu",
    "Clôture avec écart hors tolérance non justifié"
  ];

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function currentPage() { return (global.location.hash || "#accueil").replace(/^#/, "").split("/")[0] || "accueil"; }
  function go(p) { global.location.hash = p; }

  function injectStyles() {
    if (document.getElementById("rcn-workflow-guide-style")) return;
    var css = "#rcn-workflow-toggle{position:fixed;right:18px;bottom:18px;z-index:9998;border:0;border-radius:999px;background:#053B23;color:#fff;font-weight:800;padding:12px 16px;box-shadow:0 12px 30px rgba(0,0,0,.22);cursor:pointer}"+
      "#rcn-workflow-panel{position:fixed;right:18px;bottom:72px;width:min(520px,calc(100vw - 36px));max-height:72vh;overflow:auto;z-index:9998;background:#fff;border:1px solid #B6DC8E;border-radius:18px;box-shadow:0 18px 45px rgba(5,59,35,.22);display:none}"+
      "#rcn-workflow-panel.open{display:block}"+
      ".rw-head{background:#053B23;color:#fff;padding:16px 18px;border-radius:18px 18px 0 0}"+
      ".rw-head b{display:block;font-size:15px}.rw-head small{color:#d8efd8}"+
      ".rw-body{padding:14px 16px}.rw-grid{display:grid;gap:8px}"+
      ".rw-step{display:grid;grid-template-columns:42px 1fr auto;gap:9px;align-items:start;border:1px solid #E0E8E0;border-radius:12px;padding:9px;background:#FAFCFA}"+
      ".rw-step strong{display:block;color:#053B23;font-size:13px}.rw-step small{display:block;color:#59665d;font-size:11.5px;margin-top:2px;line-height:1.35}"+
      ".rw-num{font-family:monospace;font-weight:800;color:#008F37;background:#E0F3DE;border-radius:9px;text-align:center;padding:7px 0}"+
      ".rw-go{border:1px solid #CFCECE;background:#fff;border-radius:9px;padding:6px 8px;cursor:pointer;color:#053B23;font-weight:700}"+
      ".rw-neg{margin-top:14px;border-top:1px solid #E0E8E0;padding-top:12px}.rw-neg b{color:#9A6600}.rw-neg li{font-size:12px;margin:5px 0;color:#4F4E4E}"+
      ".rw-active{outline:2px solid #8DC556;background:#F1FAEE}";
    var st = document.createElement("style"); st.id = "rcn-workflow-guide-style"; st.textContent = css; document.head.appendChild(st);
  }

  function render() {
    injectStyles();
    if (!document.body || document.getElementById("rcn-workflow-toggle")) return;
    var btn = document.createElement("button");
    btn.id = "rcn-workflow-toggle";
    btn.type = "button";
    btn.textContent = "Workflow RCN";

    var panel = document.createElement("div");
    panel.id = "rcn-workflow-panel";
    var page = currentPage();
    var rows = STEPS.map(function (s) {
      var active = s.page === page ? " rw-active" : "";
      return '<div class="rw-step' + active + '"><div class="rw-num">' + esc(s.n) + '</div><div><strong>' + esc(s.label) + '</strong><small>' + esc(s.rule) + '</small></div><button class="rw-go" data-go="' + esc(s.page) + '">Ouvrir</button></div>';
    }).join("");
    var neg = NEG.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
    panel.innerHTML = '<div class="rw-head"><b>RCN Trace · Recette terrain bout-en-bout</b><small>Stock Yakro entrepôt ≠ matière disponible calibrage</small></div><div class="rw-body"><div class="rw-grid">' + rows + '</div><div class="rw-neg"><b>Tests négatifs obligatoires</b><ul>' + neg + '</ul></div></div>';

    btn.onclick = function () { panel.classList.toggle("open"); };
    panel.addEventListener("click", function (ev) { var p = ev.target && ev.target.getAttribute("data-go"); if (p) { go(p); panel.classList.remove("open"); } });
    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }

  function refreshActive() {
    var panel = document.getElementById("rcn-workflow-panel");
    if (!panel) return;
    panel.remove();
    var btn = document.getElementById("rcn-workflow-toggle");
    if (btn) btn.remove();
    render();
  }

  global.addEventListener("hashchange", refreshActive);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})(window);
