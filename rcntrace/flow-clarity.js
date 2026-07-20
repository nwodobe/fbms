/* RCN TRACE - Step 3 flow clarity layer.
   Non destructive UI helper: it only adds explanatory banners. */
(function (global) {
  "use strict";
  var MAP = {
    accueil: {
      title: "Chaîne claire Bouaké / Yakro / Calibrage",
      text: "Bouaké et Yakro sont des entrepôts. Le calibrage est un atelier distinct : seule la matière transférée vers calibrage devient disponible pour production.",
      flow: ["Bouaké entrepôt", "Yakro entrepôt", "Calibrage"]
    },
    entrepot: {
      title: "Espace Entrepôt = Bouaké ou Yakro",
      text: "Cet espace suit la réception, le stock BIN, le séchage et les transferts d'entrepôt. Yakro reste un entrepôt tant qu'un transfert vers calibrage n'est pas créé.",
      flow: ["Réception", "Lot officiel", "BIN entrepôt", "Transfert"]
    },
    reception: {
      title: "Réception physique en entrepôt",
      text: "À cette étape, on reçoit un camion dans un site précis : Bouaké ou Yakro. Une livraison directe à Yakro doit être enregistrée comme réception Yakro, pas comme calibrage.",
      flow: ["Camion", "Site de réception", "Sampling", "GM", "Déchargement"]
    },
    qualite: {
      title: "Qualité avant libération du lot",
      text: "Le sampling et l'analyse finale qualifient le lot. Le lot officiel porte l'identité matière ; la BIN porte seulement sa position dans Bouaké ou Yakro.",
      flow: ["Sampling", "Décision GM", "Analyse finale", "Lot RCN"]
    },
    stock: {
      title: "Stock & BIN = position entrepôt",
      text: "Une BIN appartient à un site d'entrepôt. Une BIN Yakro n'est pas automatiquement disponible pour calibrage : elle doit être sortie par transfert vers calibrage.",
      flow: ["Lot", "BIN Bouaké", "BIN Yakro", "Sortie contrôlée"]
    },
    sechage: {
      title: "Séchage / triage en entrepôt",
      text: "Le séchage modifie l'état et le poids de la matière dans l'entrepôt. Il ne transforme pas Yakro en atelier de calibrage.",
      flow: ["BIN avant", "Séchage", "BIN après", "Perte suivie"]
    },
    transfert: {
      title: "Transfert : toujours préciser la destination",
      text: "Un transfert Bouaké -> Yakro reste un transfert entrepôt à entrepôt. Un transfert Yakro -> Calibrage est différent : il alimente l'atelier de production.",
      flow: ["Bouaké", "Yakro entrepôt", "Calibrage"]
    },
    calibrage: {
      title: "Calibrage = atelier de production",
      text: "Le calibrage ne doit consommer que les transferts explicitement destinés au calibrage. Une livraison directe à Yakro ou un stock Yakro non transféré reste en entrepôt.",
      flow: ["TRF vers calibrage", "Réception atelier", "Opération CAL", "Sorties calibres"]
    },
    caltransferts: {
      title: "Matière attendue au calibrage",
      text: "Cette liste doit représenter uniquement les transferts envoyés vers calibrage, pas tout le stock Yakro ni les réceptions fournisseurs directes.",
      flow: ["TRF validé", "En route", "À recevoir", "Contrôle écart"]
    },
    calreception: {
      title: "Réception au calibrage distincte de Yakro entrepôt",
      text: "On rapproche le poids envoyé et le poids reçu par l'atelier. Ce n'est pas une réception fournisseur classique.",
      flow: ["Poids envoyé", "Poids reçu", "Écart", "Acceptation atelier"]
    },
    calops: {
      title: "Opération de calibrage",
      text: "L'opération CAL doit hériter des contributeurs du transfert. Aucune origine fournisseur ne doit être ressaisie manuellement.",
      flow: ["TRF", "CAL", "Sorties", "Bilan matière"]
    },
    calsorties: {
      title: "Sorties de calibrage",
      text: "Les neuf calibres, rejets et restes doivent expliquer la matière reçue. L'écart non expliqué doit rester visible.",
      flow: ["C1-C9", "Rejets", "Restes", "Écart"]
    },
    calqc: {
      title: "Contrôle qualité des sorties",
      text: "Une sortie bloquée ou rejetée ne doit pas alimenter une BIN de calibre sans décision claire.",
      flow: ["Sortie", "QC", "Décision", "BIN calibre"]
    },
    calbins: {
      title: "BIN de calibre",
      text: "Ces BIN sont des BIN de sortie du calibrage. Elles ne doivent pas être confondues avec les BIN RCN de stockage Bouaké ou Yakro.",
      flow: ["Sortie CAL", "BIN calibre", "Généalogie", "Stock fini"]
    },
    caltrace: {
      title: "Traçabilité matière",
      text: "Après mélange, la contribution fournisseur est théorique. L'application doit montrer la généalogie sans prétendre identifier une noix précise.",
      flow: ["Fournisseur", "Lot", "BIN", "TRF", "CAL"]
    },
    rapports: {
      title: "Rapports : séparer entrepôt et calibrage",
      text: "Les indicateurs doivent distinguer stock entrepôt, matière en transfert, matière reçue au calibrage et sorties calibrées.",
      flow: ["Stock", "TRF", "CAL", "Sorties"]
    },
    audit: {
      title: "Audit du flux",
      text: "Les corrections doivent indiquer le site, l'étape et le motif pour éviter toute confusion entre Bouaké, Yakro et calibrage.",
      flow: ["Qui", "Où", "Étape", "Motif"]
    }
  };

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function currentPage() { return (global.location.hash || "#accueil").replace(/^#/, "").split("/")[0] || "accueil"; }
  function injectStyles() {
    if (document.getElementById("rcn-flow-clarity-style")) return;
    var css = ".rcn-flow-note{margin:-12px 0 22px;border:1px solid #B6DC8E;border-left:5px solid #008F37;border-radius:14px;background:linear-gradient(100deg,#E0F3DE,#fff);padding:14px 16px;box-shadow:0 4px 14px rgba(5,59,35,.06)}"+
      ".rcn-flow-note b{display:block;color:#053B23;font-family:var(--fd);font-size:14px;margin-bottom:4px}"+
      ".rcn-flow-note p{margin:0;color:#4F4E4E;font-size:12.5px;line-height:1.45;max-width:900px}"+
      ".rcn-flow-path{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}"+
      ".rcn-flow-path span{display:inline-flex;align-items:center;gap:6px;border:1px solid #CFCECE;border-radius:999px;background:#fff;color:#053B23;font-size:11px;font-weight:700;padding:5px 9px}"+
      ".rcn-flow-path span:not(:last-child):after{content:'->';color:#008F37;font-weight:800;margin-left:2px}";
    var st = document.createElement("style"); st.id = "rcn-flow-clarity-style"; st.textContent = css; document.head.appendChild(st);
  }
  function loadStep4Locks() {
    if (document.getElementById("rcn-transfer-locks-loader")) return;
    var s = document.createElement("script");
    s.id = "rcn-transfer-locks-loader";
    s.defer = true;
    s.src = "./transfer-business-locks.js?v=step4-transfer-locks-20260720";
    document.head.appendChild(s);
  }
  function render() {
    injectStyles();
    loadStep4Locks();
    var view = document.getElementById("view");
    if (!view) return;
    var old = view.querySelector(".rcn-flow-note"); if (old) old.remove();
    var page = currentPage();
    var cfg = MAP[page] || MAP["entrepot"];
    if (!cfg) return;
    var head = view.querySelector(".pagehead");
    if (!head) return;
    var path = (cfg.flow || []).map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("");
    var box = document.createElement("div");
    box.className = "rcn-flow-note";
    box.innerHTML = "<b>" + esc(cfg.title) + "</b><p>" + esc(cfg.text) + "</p><div class=\"rcn-flow-path\">" + path + "</div>";
    head.insertAdjacentElement("afterend", box);
  }
  function schedule() { clearTimeout(schedule.t); schedule.t = setTimeout(render, 80); }
  global.addEventListener("hashchange", schedule);
  global.addEventListener("load", schedule);
  var mo = new MutationObserver(schedule);
  function arm() { var v = document.getElementById("view"); if (v) mo.observe(v, { childList: true, subtree: false }); schedule(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arm); else arm();
})(window);
