/* ============================================================================
   RCN TRACE — Interface (rcntrace/rcntrace-ui.js)
   ----------------------------------------------------------------------------
   Shell SPA + router par ancre + rendu des 16 écrans (conception fournie).
   S'appuie sur window.RCN (moteur métier). Bilingue FR/EN (NFR-09) — les codes
   métier (REC, RCN, BIN, TRF, CAL, calibres) ne sont jamais traduits.
   ========================================================================== */
(function (global) {
  "use strict";
  var R = global.RCN;

  /* ---------------- i18n léger (nav + titres + boutons) --------------- */
  var LANG = localStorage.getItem("rcntrace.lang") || "fr";
  var T = {
    fr: {
      "brand.sub": "Traçabilité matière", "nav.portal": "Portail ANAGROCI",
      "nav.accueil": "Accueil", "nav.reception": "Réception", "nav.qualite": "Qualité",
      "nav.stock": "Stock & BIN", "nav.sechage": "Séchage", "nav.sacs": "Sacs jute", "nav.transfert": "Transfert", "nav.calibrage": "Calibrage",
      "nav.fournisseurs": "Fournisseurs", "nav.rapports": "Rapports", "nav.carte": "Cartographie", "nav.audit": "Audit",
      "net.on": "En ligne", "net.off": "Hors connexion",
      "save": "Enregistrer", "send": "Envoyer", "cancel": "Annuler", "back": "Retour",
    },
    en: {
      "brand.sub": "Material traceability", "nav.portal": "ANAGROCI Portal",
      "nav.accueil": "Home", "nav.reception": "Reception", "nav.qualite": "Quality",
      "nav.stock": "Stock & BIN", "nav.sechage": "Drying", "nav.sacs": "Jute bags", "nav.transfert": "Transfer", "nav.calibrage": "Grading",
      "nav.fournisseurs": "Suppliers", "nav.rapports": "Reports", "nav.carte": "Map", "nav.audit": "Audit",
      "net.on": "Online", "net.off": "Offline",
      "save": "Save", "send": "Send", "cancel": "Cancel", "back": "Back",
    }
  };
  function t(k) { return (T[LANG] && T[LANG][k]) || (T.fr[k]) || k; }

  // Espaces de travail (workspaces) : le portail oriente vers un grand module,
  // et la barre latérale n'affiche QUE les sections du module où l'on se trouve.
  var WS = {
    procurement: { titre: "Procurement", ic: "🤝", nav: [
      ["procurement", "Tableau de bord"], ["proceng", "Engagements"], ["procfin", "Financements LBA"],
      ["procplan", "Arrivées prévues"], ["procperf", "Performance fournisseurs"], ["fournisseurs", "Base fournisseurs"]
    ] },
    entrepot: { titre: "Activité entrepôt", ic: "🏭", nav: [
      ["entrepot", "Tableau de bord"], ["reception", "Réception"], ["qualite", "Qualité"],
      ["stock", "Stock & BIN"], ["sechage", "Séchage / triage"], ["sacs", "Sacs de jute"],
      ["transfert", "Transferts"],
      ["rapports", "Rapports entrepôt"], ["carte", "Cartographie"], ["audit", "Audit"]
    ] },
    calibrage: { titre: "Calibrage", ic: "⚙️", nav: [
      ["calibrage", "Vue d'ensemble"], ["caltransferts", "Transferts attendus"], ["calreception", "Réception au calibrage"],
      ["calops", "Opérations de calibrage"], ["calsorties", "Saisie des sorties"], ["calqc", "Contrôle qualité"],
      ["calbins", "BIN de calibre"], ["calstops", "Arrêts & maintenance"], ["caltrace", "Traçabilité"],
      ["calrapports", "Rapports"], ["calaudit", "Journal d'audit"]
    ] }
  };
  var PAGE_WS = {};
  Object.keys(WS).forEach(function (k) { WS[k].nav.forEach(function (it) { PAGE_WS[it[0]] = k; }); });
  function workspaceOf(page) { return PAGE_WS[page] || null; }

  /* ---------------- Helpers DOM ------------------------------------- */
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? e.value : ""; }
  function toast(msg, err) {
    var tt = el("toast"); tt.textContent = msg; tt.className = "toast show" + (err ? " err" : "");
    clearTimeout(toast._t); toast._t = setTimeout(function () { tt.className = "toast"; }, 2600);
  }
  function badgeEtat(etat) {
    var e = R.ETAT_REC, b = R.ETAT_BIN, tr = R.ETAT_TRF, ca = R.ETAT_CAL, cls = "b-neutral";
    var ok = [e.LIBERE, b.OUVERT, b.ACTIF, tr.RECU, tr.CONTROLE, ca.CLOS];
    var warn = [e.ATTENTE_GM, e.SAMPLING, e.DECHARGE, e.AUTORISEE, tr.PREPARE, tr.EXPEDIE, tr.PARTIEL, ca.EN_COURS, ca.PARTIEL, ca.PAUSE, ca.VALIDER, ca.RAPPROCHER, b.RECONCILIER, b.VIDE];
    var danger = [e.BLOQUE, e.REFUSEE, tr.ECART, tr.ANNULE, b.BLOQUE];
    if (ok.indexOf(etat) >= 0) cls = "b-ok"; else if (danger.indexOf(etat) >= 0) cls = "b-danger"; else if (warn.indexOf(etat) >= 0) cls = "b-warn";
    return '<span class="badge ' + cls + '">' + esc(etat) + '</span>';
  }
  function stepper(steps, curIdx) {
    return '<div class="stepper">' + steps.map(function (s, i) {
      var cls = i < curIdx ? "done" : (i === curIdx ? "cur" : "");
      return '<div class="st ' + cls + '"><i>' + (i < curIdx ? "✓" : (i + 1)) + '</i>' + esc(s) + '</div>';
    }).join("") + '</div>';
  }
  var STEPS = ["Camion", "Sampling", "GM", "Déchargement", "Lot"];

  /* ---------------- Router ------------------------------------------ */
  function currentRoute() {
    var h = (location.hash || "#accueil").replace(/^#/, "");
    var parts = h.split("/");
    return { page: parts[0] || "accueil", id: parts[1] ? decodeURIComponent(parts[1]) : null, sub: parts[2] || null };
  }
  function go(hash) { location.hash = hash; }
  global.__rcngo = go;

  function renderNav(active) {
    var ws = workspaceOf(active);
    var html;
    if (!ws) {
      // Portail : aiguillage vers les 8 grands modules (« où voulez-vous travailler ? »).
      html = '<div class="nav-sec">Modules</div>' + CHAIN.map(function (m) {
        var oc = m.soon ? "RCNUI.soon('" + esc(m.t).replace(/'/g, "\\'") + "')" : "location.hash='#" + m.go + "'";
        return '<a href="javascript:void(0)" onclick="' + oc + '" class="' + (m.soon ? "soon" : "") + '"><span class="ni">' + esc(m.n) + '</span>' + esc(m.t) + (m.soon ? ' <em>à venir</em>' : '') + '</a>';
      }).join("");
    } else {
      var w = WS[ws];
      html = '<a href="#accueil" class="nav-back">← Portail</a><div class="nav-sec">' + w.ic + ' ' + esc(w.titre) + '</div>' +
        w.nav.map(function (it) { return '<a href="#' + it[0] + '" class="' + (it[0] === active ? "on" : "") + '">' + esc(it[1]) + '</a>'; }).join("");
    }
    el("nav").innerHTML = html;
    document.querySelectorAll("[data-i18n]").forEach(function (e) { e.textContent = t(e.getAttribute("data-i18n")); });
    el("langbtn").textContent = LANG === "fr" ? "EN" : "FR";
  }

  var CRUMB = {
    accueil: ["Portail", "Chaîne de transformation cajou"],
    procurement: ["Procurement", "Objectifs, engagements et exposition financière"],
    proceng: ["Engagements fournisseurs", "Promesse de volume, prix, qualité et échéance"],
    procfin: ["Financements LBA", "Avances, couverture par livraison et alertes"],
    procplan: ["Arrivées prévues", "Planning camion relié à la réception"],
    procperf: ["Performance fournisseurs", "Volume, qualité, ponctualité, sacs et financement"],
    entrepot: ["Activité entrepôt", "Réception, qualité, stock, séchage, transferts & sacs"],
    reception: ["Réception", "Module 1 · Dossiers camion & sampling"],
    qualite: ["Qualité", "Module 1 · Sampling, décision GM & libération"],
    stock: ["Stock & BIN", "Module 1 · Cycles, compositions & mouvements"],
    sechage: ["Séchage / triage", "Module 1 · Avant/après, BIN après séchage & perte"],
    sacs: ["Sacs de jute", "Dotation, retours, déchirés, rebaging & balance par fournisseur"],
    transfert: ["Transfert", "Passage entre modules · contributeurs & triple validation"],
    calibrage: ["Calibrage", "Vue d'ensemble · quelle matière attend, est en machine, est calibrée"],
    caltransferts: ["Transferts attendus", "Sorties de BIN de Yamoussoukro vers le calibrage"],
    calreception: ["Réception au calibrage", "Rapprochement envoyé / reçu · écart à traiter"],
    calops: ["Opérations de calibrage", "Ouverture, pilotage, sorties, bilan & clôture"],
    calsorties: ["Saisie des sorties", "Neuf calibres · poids, sacs, BIN de destination"],
    calqc: ["Contrôle qualité", "Conformité des sorties · décisions bloquantes"],
    calbins: ["BIN de calibre", "BIN de sortie, capacité & généalogie complète"],
    calstops: ["Arrêts & maintenance", "Motifs, durées & disponibilité machines"],
    caltrace: ["Traçabilité", "Recherche dans les deux sens · contribution théorique"],
    calrapports: ["Rapports calibrage", "Journalier, répartition, bilan, machines, qualité"],
    calaudit: ["Journal d'audit", "Calibrage · corrections tracées après clôture"],
    rapports: ["Rapports", "Indicateurs & cartographie du business"],
    audit: ["Audit", "Journal, corrections & synchronisation"]
  };

  function route() {
    var r = currentRoute();
    // Portail = page d'orientation plein écran : barre latérale masquée.
    var app = document.querySelector(".app"); if (app) app.classList.toggle("portal", r.page === "accueil");
    renderNav(r.page);
    var cb = CRUMB[r.page] || ["RCN TRACE", ""];
    el("crumb").innerHTML = esc(cb[0]) + "<small>" + esc(cb[1]) + "</small>";
    var fn = PAGES[r.page] || PAGES.accueil;
    try { el("view").innerHTML = fn(r); }
    catch (e) { el("view").innerHTML = '<div class="alert">Erreur d\'affichage : ' + esc(e.message) + '</div>'; console.error(e); }
    injectEyebrow(r);
    el("view").scrollTop = 0; window.scrollTo(0, 0);
    if (el("side").classList.contains("open")) el("side").classList.remove("open");
  }

  // Eyebrow éditorial (contexte de section) injecté au-dessus du titre de page.
  var EYEBROW = {
    accueil: "Portail · Chaîne cajou", procurement: "Procurement · Pilotage", proceng: "Procurement · Engagements", procfin: "Procurement · Financements", procplan: "Procurement · Arrivées", procperf: "Procurement · Performance", entrepot: "Portail · Activité entrepôt", reception: "Module 1 · Réception", qualite: "Module 1 · Qualité",
    stock: "Module 1 · Stock & BIN", sechage: "Module 1 · Séchage / triage", sacs: "Entrepôt · Sacs de jute", transfert: "Passage entre modules",
    calibrage: "Module 2 · Calibrage", caltransferts: "Module 2 · Calibrage", calreception: "Module 2 · Calibrage", calops: "Module 2 · Calibrage",
    calsorties: "Module 2 · Calibrage", calqc: "Module 2 · Calibrage", calbins: "Module 2 · Calibrage", calstops: "Module 2 · Calibrage",
    caltrace: "Module 2 · Calibrage", calrapports: "Module 2 · Calibrage", calaudit: "Module 2 · Calibrage",
    fournisseurs: "Procurement · Base fournisseurs", rapports: "Pilotage · Rapports", carte: "Pilotage · Cartographie", audit: "Sécurité · Audit"
  };
  function injectEyebrow(r) {
    var head = el("view") && el("view").querySelector(".pagehead");
    if (!head || head.querySelector(".eyebrow")) return;
    var txt = EYEBROW[r.page] || "RCN TRACE";
    var span = document.createElement("span");
    span.className = "eyebrow"; span.textContent = txt;
    head.insertBefore(span, head.firstChild);
  }
  // Barre de progression pour une part en pourcentage (composition BIN, TRF).
  function bar(pct) {
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    return '<div class="bar"><span class="track"><span class="fill" style="width:' + p + '%"></span></span><b>' + (Math.round(p * 10) / 10) + ' %</b></div>';
  }

  /* ================================================================== */
  /*  PAGES                                                             */
  /* ================================================================== */
  var PAGES = {};

  /* ---- ACCUEIL : bienvenue + raccourcis + tableau de bord (slides 2 & 3) */
  // Chaîne de transformation (portail v2). Étapes réelles + maillons à venir.
  var CHAIN = [
    { key: "procurement", ic: "🤝", t: "Procurement", d: "Base fournisseurs, codes LBA, contrats, financements, banques, prix d'achat, performances et soldes.", n: "01", tint: "procurement", go: "procurement", statut: "Propriétaire des fournisseurs" },
    { key: "entrepot", ic: "🏭", t: "Activité entrepôt", d: "Réceptions physiques, qualité, déchargement, BIN, séchage, transferts et mouvements de sacs.", n: "02", tint: "", go: "entrepot", statut: "Utilise la base fournisseur" },
    { key: "calibrage", ic: "⚙️", t: "Calibrage", d: "Séparation des noix par taille, rendement par calibre et bilan matière.", n: "03", tint: "orange", go: "calibrage", statut: "Actif" },
    { key: "cuisson", ic: "🔥", t: "Cuisson", d: "Lots chargés, cycles vapeur, paramètres et contrôles de sortie.", n: "04", tint: "orange", soon: true, statut: "À connecter" },
    { key: "decorticage", ic: "🥜", t: "Décorticage", d: "Coques, amandes, entiers, brisures et rendement industriel.", n: "05", soon: true, statut: "À connecter" },
    { key: "borma", ic: "🌡️", t: "Borma", d: "Chargement des fours, température, durée et perte de séchage.", n: "06", soon: true, statut: "À connecter" },
    { key: "peeling", ic: "🧽", t: "Peeling & tri", d: "Dépelliculage, défauts, grades et destination des amandes.", n: "07", soon: true, statut: "À connecter" },
    { key: "packing", ic: "📦", t: "Packing", d: "Conditionnement, mise sous vide, cartons, validation et expédition.", n: "08", tint: "orange", soon: true, statut: "Pilote conseillé" },
    { key: "maintenance", ic: "🔧", t: "Maintenance", d: "Arrêts, interventions, pièces, préventif et disponibilité des machines.", n: "—", tint: "neutral", soon: true, statut: "Transversal" }
  ];
  // Hub « Activité entrepôt » : sections granulaires (clic → section dédiée).
  var ENTREPOT_GROUPS = [
    { titre: "Réception & Qualité", items: [
      { id: "reception", ic: "🚚", t: "Réception", d: "Camions, sampling, décision GM" },
      { id: "qualite", ic: "🔬", t: "Qualité", d: "Analyses, KOR, libération des lots" }
    ] },
    { titre: "Entrepôt & Stock", items: [
      { id: "stock", ic: "📦", t: "Stock & BIN", d: "BIN collectives, entrepôts, clôtures" },
      { id: "sechage", ic: "🌤️", t: "Séchage / triage", d: "Humidité, pertes de séchage" },
      { id: "sacs", ic: "🧺", t: "Sacs de jute", d: "Dotation, retours, dette fournisseur" },
      { id: "transfert", ic: "🔁", t: "Transfert", d: "Bouaké → Yamoussoukro, finance transit" }
    ] },
    { titre: "Pilotage & Sécurité", items: [
      { id: "rapports", ic: "📊", t: "Rapports", d: "Stock, qualité, écarts, sacs" },
      { id: "carte", ic: "🗺️", t: "Cartographie", d: "Qualité & volume par localité/région" },
      { id: "audit", ic: "🔐", t: "Audit", d: "Journal inaltérable & synchronisation" }
    ] }
  ];
  function portalBadge(id, d) {
    if (id === "reception" && d.camionsEnAttente) return { n: d.camionsEnAttente, q: false };
    if (id === "qualite" && (d.decisionGm + d.lotsBloques)) return { n: d.decisionGm + d.lotsBloques, q: false };
    if (id === "transfert" && d.transfertsARecevoir) return { n: d.transfertsARecevoir, q: false };
    if (id === "fournisseurs") return { n: (R.referentials().fournisseurs || []).length, q: true };
    return null;
  }
  PAGES.accueil = function () {
    var u = R.db().user;
    var gs = R.geoStats();
    var lots = R.lots();
    var lotRef = lots.length ? lots[lots.length - 1].id : "—";
    var recu = gs.totalVolume;
    var nodes = [
      { ic: "🚚", t: "Réception", s: "Camion · sampling · pesée" },
      { ic: "📦", t: "Stockage", s: "BIN · séchage · transfert" },
      { ic: "⚙️", t: "Transformation", s: "Calibrage · cuisson · tri" },
      { ic: "📦", t: "Packing", s: "Grade · carton · export" }
    ].map(function (n) { return '<div class="rp-node"><span class="e">' + n.ic + '</span><strong>' + esc(n.t) + '</strong><small>' + esc(n.s) + '</small></div>'; }).join("");
    var strip = ["Procurement", "Entrepôt", "Calibrage", "Cuisson", "Décorticage", "Borma", "Peeling", "Tri", "Packing"]
      .map(function (s, i) { return '<span><i>' + pad2(i + 1) + '</i>' + esc(s) + '</span>'; }).join("");
    var mods = CHAIN.map(function (m) {
      var onclick = m.soon ? 'RCNUI.soon(\'' + esc(m.t) + '\')' : '__rcngo(\'' + m.go + '\')';
      return '<button class="rp-mod ' + (m.tint || "") + (m.soon ? " soon" : "") + '" onclick="' + onclick + '">' +
        '<div class="rp-mtop"><span class="rp-micon">' + m.ic + '</span><span class="rp-num">' + esc(m.n) + '</span></div>' +
        '<h3>' + esc(m.t) + '</h3><p>' + esc(m.d) + '</p>' +
        '<div class="rp-mfoot"><span class="rp-stat">' + esc(m.statut) + '</span><span class="rp-go">' + (m.soon ? "+" : "→") + '</span></div></button>';
    }).join("");
    return '' +
      '<div class="rp-hero"><div class="rp-in">' +
        '<div><p class="rp-eyebrow">Centre de contrôle · Transformation cajou</p>' +
          '<h1>Une seule chaîne. Une traçabilité totale.</h1>' +
          '<p class="lead">Bienvenue, ' + esc((u.nom || "").split(" ")[0]) + '. Suivez la relation fournisseur, l\'achat de la noix brute et toute sa transformation jusqu\'au carton export — chaque lot, chaque mouvement et chaque validation restent reliés.</p>' +
          '<div class="rp-acts"><button class="rp-btn pri" onclick="__rcngo(\'entrepot\')">Ouvrir les opérations →</button>' +
          '<button class="rp-btn gho" onclick="__rcngo(\'rapports\')">Voir les rapports</button></div>' +
        '</div>' +
        '<div class="rp-panel"><div class="rp-phead"><small>Parcours de la matière</small><span class="rp-live">Flux actif</span></div>' +
          '<div class="rp-chip"><span><small>Dernier lot officiel</small><br><strong>' + esc(lotRef) + '</strong></span><b>TRAÇABLE ✓</b></div>' +
          '<div class="rp-flowmini">' + nodes + '</div>' +
          '<div class="rp-kpis"><div><strong>' + fmtKg0(recu) + '</strong><small>Matière reçue</small></div>' +
            '<div><strong>09</strong><small>Modules business & production</small></div>' +
            '<div><strong>100 %</strong><small>Traçabilité</small></div></div>' +
        '</div>' +
      '</div></div>' +
      '<div class="rp-strip">' + strip + '</div>' +
      '<div class="section-head" style="display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:18px">' +
        '<div><small style="color:var(--emerald);font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Chaîne business & production</small>' +
        '<h2 style="margin:6px 0 0;color:var(--forest);font-family:var(--fd);font-weight:800;font-size:26px;letter-spacing:-.02em">Choisissez votre espace de travail</h2></div>' +
        '<p style="max-width:440px;margin:0;color:var(--n500);font-size:12.5px;line-height:1.5">Procurement possède le référentiel fournisseur. L\'entrepôt utilise ensuite ces informations sans pouvoir les modifier.</p></div>' +
      '<div class="rp-modules">' + mods + '</div>' +
      '<div class="rp-insight">' +
        '<div class="rp-ins dark"><span class="ic">🧭</span><div><strong>Traçabilité de bout en bout</strong><p>Du fournisseur jusqu\'au packing, retrouvez l\'origine et le parcours complet d\'un lot.</p></div><b>100%</b></div>' +
        '<div class="rp-ins"><span class="ic">🗄️</span><div><strong>Une seule base fournisseur</strong><p>Procurement crée et valide. L\'entrepôt sélectionne le fournisseur sans modifier ses données de référence.</p></div></div>' +
      '</div>';
  };
  function fmtKg0(v) { return v == null ? "—" : Math.round(v).toLocaleString("fr-FR") + " kg"; }

  /* ---- PROCUREMENT : avant la réception physique ------------------ */
  function money(v) { return v == null ? "—" : Math.round(v).toLocaleString("fr-FR") + " FCFA"; }
  function supplierOptions() { return (R.referentials().fournisseurs || []).map(function (f, i) { return '<option value="' + i + '">' + esc(f.lba + " · " + f.nom) + '</option>'; }).join(""); }
  function engagementOptions() { return '<option value="">— Sans engagement —</option>' + R.procEngagements().filter(function (e) { return e.statut === "ACTIF"; }).map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.id + " · " + e.supplierNom) + '</option>'; }).join(""); }

  PAGES.procurement = function () {
    var s = R.procurementSummary(), eng = R.procEngagements(), fin = R.procFinancements(), arr = R.procArrivages();
    var progress = s.promisKg ? Math.min(100, s.livreKg / s.promisKg * 100) : 0;
    var overdue = fin.filter(function (f) { return f.statut === "APPROUVÉ" && f.echeance && new Date(f.echeance) < new Date() && R.supplierDelivered(f.supplierLba, f.supplierNom).valeurFcfa < f.montant; }).length;
    return '<div class="pagehead"><h1>Procurement · Centre de pilotage</h1><p>Avant l’arrivée du camion : combien avons-nous promis, financé et planifié ? Après la réception : combien a réellement été livré et reconnu ?</p></div>' +
      '<div class="kpis">' + kpi("Volume promis", R.round2(s.promisKg / 1000), "tonnes · engagements actifs", "") + kpi("Volume réellement reçu", R.round2(s.livreKg / 1000), progress.toFixed(1) + " % de la promesse", "") + kpi("Reste à livrer", R.round2(s.restantKg / 1000), "tonnes", s.restantKg ? "warn" : "") + kpi("Arrivées sous 7 jours", s.arrivages7j, "camions annoncés", "") + '</div>' +
      '<div class="kpis">' + kpi("Financements approuvés", money(s.financeFcfa), "LBA", "") + kpi("Valeur livrée reconnue", money(s.couvertFcfa), "poids payé × prix", "") + kpi("Exposition non couverte", money(s.expositionFcfa), "à récupérer par livraison", s.expositionFcfa ? "danger" : "") + kpi("Financements en retard", overdue, "échéance dépassée", overdue ? "danger" : "") + '</div>' +
      '<div class="grid2"><div class="card"><h2>Progression de la campagne</h2><div class="cbody"><div class="metric big"><small>Promesse couverte par les réceptions</small><b>' + progress.toFixed(1) + ' %</b><span>' + R.kg(s.livreKg) + ' reçus sur ' + R.kg(s.promisKg) + '</span></div>' + bar(progress) + '<div class="rule" style="margin-top:14px"><b>Lecture simple.</b> Procurement porte la promesse. La Réception et la Qualité confirment le volume réellement accepté.</div></div></div>' +
      '<div class="card"><h2>Actions prioritaires</h2><div class="cbody"><div class="actions" style="display:grid"><button class="btn" onclick="__rcngo(\'proceng\')">+ Nouvel engagement fournisseur</button><button class="btn ghost" onclick="__rcngo(\'procfin\')">Enregistrer un financement LBA</button><button class="btn ghost" onclick="__rcngo(\'procplan\')">Planifier une arrivée camion</button><button class="btn ghost" onclick="__rcngo(\'procperf\')">Comparer les fournisseurs</button></div></div></div></div>' +
      '<div class="grid2" style="margin-top:18px"><div class="card"><h2>Portefeuille actif</h2><div class="cbody"><div class="metrics"><div class="metric"><small>Engagements</small><b>' + eng.length + '</b></div><div class="metric"><small>Financements</small><b>' + fin.length + '</b></div><div class="metric"><small>Arrivées planifiées</small><b>' + arr.filter(function (a) { return a.statut === "ANNONCÉ"; }).length + '</b></div></div></div></div><div class="rule"><b>Quatre valeurs distinctes.</b> Volume promis ≠ poids physique reçu ≠ poids payé ≠ valeur financière reconnue. Le module les rapproche sans les mélanger.</div></div>';
  };

  PAGES.proceng = function () {
    var rows = R.procEngagements().map(function (e) { var d = R.supplierDelivered(e.supplierLba, e.supplierNom), rest = Math.max(0, e.volumeKg - d.accepteKg), p = e.volumeKg ? d.accepteKg / e.volumeKg * 100 : 0; return '<tr><td class="mono">' + esc(e.id) + '</td><td><b>' + esc(e.supplierNom) + '</b><small style="display:block;color:var(--n500)">' + esc(e.supplierLba) + '</small></td><td>' + esc(e.type) + '</td><td class="mono">' + R.kg(e.volumeKg) + '</td><td class="mono">' + R.kg(d.accepteKg) + '</td><td class="mono">' + R.kg(rest) + '</td><td>' + bar(Math.min(100, p)) + '</td><td>' + esc(e.echeance || "—") + '</td></tr>'; }).join("") || '<tr><td colspan="8" class="empty">Aucun engagement. Utilisez le formulaire pour créer le premier.</td></tr>';
    return '<div class="pagehead"><h1>Engagements fournisseurs</h1><p>Ce que le fournisseur s’engage à livrer : volume, prix, qualité, site et date attendue.</p></div><div class="grid2" style="align-items:start"><div class="card"><h2>Nouvel engagement</h2><div class="cbody"><label>Fournisseur</label><select id="pe_supplier">' + supplierOptions() + '</select><div class="row"><div><label>Type</label><select id="pe_type"><option>LBA</option><option>DIS</option></select></div>' + inp("pe_campaign", "Campagne", "2026") + '</div><div class="row">' + inp("pe_qty", "Volume promis (kg)", "", "number") + inp("pe_price", "Prix prévu (FCFA/kg)", "", "number") + '</div><div class="row">' + inp("pe_kor", "KOR minimum", "47", "number") + inp("pe_hum", "Humidité maximum (%)", "10", "number") + '</div><div class="row"><div><label>Site de livraison</label><select id="pe_site">' + R.ENTREPOTS.map(function (e) { return '<option value="' + esc(e.code) + '">' + esc(e.nom) + '</option>'; }).join("") + '</select></div>' + inp("pe_due", "Échéance", "", "date") + '</div><label>Observation</label><textarea id="pe_note" rows="2"></textarea><div class="actions"><button class="btn" onclick="RCNUI.createProcEngagement()">Créer l’engagement</button></div></div></div><div class="rule"><b>Règle.</b> Le volume livré est repris automatiquement des lots acceptés. Une promesse ne crée jamais du stock.</div></div><div class="card" style="margin-top:18px"><h2>Suivi promesse → livraison</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>Engagement</th><th>Fournisseur</th><th>Type</th><th>Promis</th><th>Accepté</th><th>Reste</th><th>Progression</th><th>Échéance</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
  };

  PAGES.procfin = function () {
    var rows = R.procFinancements().map(function (f) { var d = R.supplierDelivered(f.supplierLba, f.supplierNom), exp = Math.max(0, f.montant - d.valeurFcfa), late = f.echeance && new Date(f.echeance) < new Date() && exp > 0; var act = f.statut === "À_APPROUVER" && R.hasPermission("finance_approve") ? '<button class="btn sm" onclick="RCNUI.approveProcFin(\'' + f.id + '\',true)">Approuver</button> <button class="btn danger sm" onclick="RCNUI.approveProcFin(\'' + f.id + '\',false)">Refuser</button>' : badgeEtat(f.statut); return '<tr><td class="mono">' + esc(f.id) + '</td><td>' + esc(f.supplierNom) + '</td><td class="mono">' + money(f.montant) + '</td><td class="mono">' + money(d.valeurFcfa) + '</td><td class="mono" style="color:' + (exp ? 'var(--danger)' : 'var(--ok)') + '">' + money(exp) + '</td><td>' + (late ? '<span class="badge b-danger">EN RETARD</span>' : esc(f.echeance || "—")) + '</td><td>' + act + '</td></tr>'; }).join("") || '<tr><td colspan="7" class="empty">Aucun financement enregistré.</td></tr>';
    return '<div class="pagehead"><h1>Financements LBA</h1><p>Une avance doit être couverte par des livraisons reconnues. L’application montre immédiatement le montant encore exposé.</p></div><div class="grid2" style="align-items:start"><div class="card"><h2>Nouveau financement</h2><div class="cbody"><label>Fournisseur</label><select id="pf_supplier">' + supplierOptions() + '</select><label>Engagement lié</label><select id="pf_eng">' + engagementOptions() + '</select><div class="row">' + inp("pf_amount", "Montant (FCFA)", "", "number") + inp("pf_bank", "Banque", "", "text") + '</div><div class="row">' + inp("pf_ref", "Référence paiement", "", "text") + inp("pf_due", "Échéance livraison", "", "date") + '</div><div class="actions"><button class="btn" onclick="RCNUI.createProcFin()">Soumettre à approbation</button></div></div></div><div class="rule"><b>Séparation des rôles.</b> Procurement prépare le financement. Le Branch Manager l’approuve ou le refuse. La couverture provient des réceptions réelles.</div></div><div class="card" style="margin-top:18px"><h2>Exposition financière par fournisseur</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>FIN</th><th>Fournisseur</th><th>Financé</th><th>Valeur livrée</th><th>Exposition</th><th>Échéance</th><th>Décision</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
  };

  PAGES.procplan = function () {
    var rows = R.procArrivages().slice().sort(function (a, b) { return new Date(a.prevuAt) - new Date(b.prevuAt); }).map(function (a) { var act = a.recId ? '<a href="#reception/' + encodeURIComponent(a.recId) + '">' + esc(a.recId) + ' →</a>' : '<button class="btn sm" onclick="RCNUI.arriveProc(\'' + a.id + '\')">Camion arrivé</button>'; return '<tr><td>' + esc(a.prevuAt ? R.fmtDateTime(a.prevuAt) : "—") + '</td><td>' + esc(a.supplierNom) + '</td><td class="mono">' + esc(a.camion || "—") + '</td><td class="mono">' + R.kg(a.volumeKg) + '</td><td>' + esc(a.site) + '</td><td>' + esc(a.statut) + '</td><td>' + act + '</td></tr>'; }).join("") || '<tr><td colspan="7" class="empty">Aucune arrivée annoncée.</td></tr>';
    return '<div class="pagehead"><h1>Planification des arrivées</h1><p>Le camion est annoncé une seule fois. À son arrivée, son dossier Réception est créé automatiquement avec les informations déjà connues.</p></div><div class="grid2" style="align-items:start"><div class="card"><h2>Annoncer un camion</h2><div class="cbody"><label>Fournisseur</label><select id="pa_supplier">' + supplierOptions() + '</select><label>Engagement lié</label><select id="pa_eng">' + engagementOptions() + '</select><div class="row">' + inp("pa_truck", "Immatriculation", "") + inp("pa_driver", "Chauffeur", "") + '</div><div class="row">' + inp("pa_phone", "Téléphone chauffeur", "") + inp("pa_date", "Date et heure prévues", "", "datetime-local") + '</div><div class="row">' + inp("pa_qty", "Volume annoncé (kg)", "", "number") + inp("pa_bags", "Nombre de sacs", "", "number") + '</div><label>Site prévu</label><select id="pa_site">' + R.ENTREPOTS.map(function (e) { return '<option value="' + esc(e.code) + '">' + esc(e.nom) + '</option>'; }).join("") + '</select><div class="actions"><button class="btn" onclick="RCNUI.createProcArrival()">Planifier l’arrivée</button></div></div></div><div class="rule"><b>Gain terrain.</b> Lorsque le camion se présente, cliquez « Camion arrivé » : Procurement transmet le fournisseur, le camion, le volume, les sacs et le site à la Réception.</div></div><div class="card" style="margin-top:18px"><h2>Planning camion</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>Prévu</th><th>Fournisseur</th><th>Camion</th><th>Volume</th><th>Site</th><th>Statut</th><th>Réception</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
  };

  PAGES.procperf = function () {
    var rows = R.fournisseursBase().filter(function (f) { return f.livraisons > 0 || R.procEngagements().some(function (e) { return e.supplierLba === f.lba; }); }).map(function (f) { var d = R.supplierDelivered(f.lba, f.nom), js = R.juteBalance(f.lba), recs = R.receptions().filter(function (r) { return r.lba === f.lba; }), kors = recs.map(function (r) { return (r.finale || {}).korDisplay; }).filter(function (x) { return x != null; }), kor = kors.length ? kors.reduce(function (a, b) { return a + b; }, 0) / kors.length : null, rejected = recs.filter(function (r) { return r.etat === R.ETAT_REC.REFUSEE || r.etat === R.ETAT_REC.BLOQUE; }).length; return '<tr><td><a href="#sacs/' + encodeURIComponent(f.lba) + '/profil"><b>' + esc(f.nom) + '</b></a><small style="display:block;color:var(--n500)">' + esc(f.lba) + '</small></td><td class="mono">' + d.livraisons + '</td><td class="mono">' + R.kg(d.accepteKg) + '</td><td class="mono">' + (kor == null ? "—" : kor.toFixed(2)) + '</td><td class="mono">' + rejected + '</td><td class="mono">' + js.solde + '</td></tr>'; }).join("") || '<tr><td colspan="6" class="empty">Aucune livraison fournisseur.</td></tr>';
    return '<div class="pagehead"><h1>Performance fournisseurs</h1><p>Une vue commune des livraisons, de la qualité, des blocages et de la dette de sacs.</p></div><div class="card"><h2>Fiche fournisseur simplifiée</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>Fournisseur</th><th>Livraisons</th><th>Volume accepté</th><th>KOR moyen</th><th>Refus/blocages</th><th>Sacs à retourner</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div><div class="rule" style="margin-top:18px"><b>Étape suivante.</b> La note fournisseur sera activée après validation officielle des pondérations : volume, ponctualité, qualité, couverture financière et retour des sacs.</div>';
  };
  // Tableau de bord « Activité entrepôt » (landing du workspace entrepôt).
  PAGES.entrepot = function () {
    var d = R.dashboard();
    var priorities = buildPriorities();
    var lots = R.lots();
    var stockBin = R.binCycles().filter(function (c) { return c.etat !== R.ETAT_BIN.CLOS && !/CAL/.test(c.binId); })
      .reduce(function (a, c) { return a + R.binStock(c); }, 0);
    var korAvg = avg(lots.filter(function (l) { return l.etat === R.ETAT_REC.LIBERE; }).map(function (l) { return l.korFinal; }));
    return '<div class="pagehead"><h1>Activité entrepôt</h1><p>Réception, qualité, stock, séchage, transferts, sacs et pilotage. Choisissez une section dans le menu — voici l\'essentiel du jour.</p></div>' +
      '<div class="kpis">' +
        kpi("Camions en attente", d.camionsEnAttente, d.decisionGm + " décision(s) GM", d.decisionGm ? "warn" : "") +
        kpi("Lots bloqués", d.lotsBloques, "Écart KOR à traiter", d.lotsBloques ? "danger" : "") +
        kpi("Stock en BIN", R.round2(stockBin), "kg (cycles ouverts)", "") +
        kpi("Transferts à recevoir", d.transfertsARecevoir, "arrivées inter-entrepôt", d.transfertsARecevoir ? "warn" : "") +
      '</div>' +
      '<div class="grid2">' +
        '<div class="card"><h2>Actions prioritaires</h2>' + priorityTable(priorities) + '</div>' +
        '<div><div class="card" style="margin-bottom:16px"><h2>Raccourcis</h2><div class="cbody" style="display:grid;gap:10px">' +
          shortcut("Nouvelle réception", "Créer le dossier temporaire du camion", "reception/new") +
          shortcut("Base fournisseurs", (R.referentials().fournisseurs || []).length + " fournisseurs (LBA)", "fournisseurs") +
          shortcut("Cartographie des achats", "Qualité & volume par localité / région", "carte") +
          shortcut("Rapports entrepôt", "Stock, qualité, écarts, sacs", "rapports") +
        '</div></div>' +
        '<div class="rule"><b>KOR moyen (lots libérés) : ' + (korAvg == null ? "—" : korAvg.toFixed(2)) + '.</b> Un dossier sans responsable ni prochaine action est considéré incomplet.</div>' +
        '</div>' +
      '</div>';
  };
  function kpi(lbl, val, sub, cls) {
    return '<div class="kpi ' + (cls || "") + '"><small>' + esc(lbl) + '</small><b>' + (typeof val === "number" ? pad2(val) : esc(val)) + '</b><span>' + esc(sub) + '</span></div>';
  }
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function shortcut(title, sub, hash) {
    return '<button class="shortcut" onclick="__rcngo(\'' + hash + '\')"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span><span class="cta">Ouvrir →</span></button>';
  }
  function buildPriorities() {
    var out = [];
    R.receptions().forEach(function (r) {
      if (r.etat === R.ETAT_REC.ATTENTE_GM) out.push({ ref: r.id, etape: "Autorisation GM", resp: "GM", statut: "À FAIRE", cls: "b-warn", hash: "qualite/" + r.id + "/gm" });
      if (r.etat === R.ETAT_REC.BLOQUE) out.push({ ref: r.lotId || r.id, etape: "Écart KOR", resp: "Qualité", statut: "BLOQUÉ", cls: "b-danger", hash: "qualite/" + r.id + "/finale" });
      if (r.etat === R.ETAT_REC.AUTORISEE) out.push({ ref: r.id, etape: "Déchargement", resp: "Entrepôt", statut: "À FAIRE", cls: "b-warn", hash: "reception/" + r.id });
    });
    R.transfers().forEach(function (tr) {
      var toWh = tr.destinationType === "warehouse";
      if (tr.etat === R.ETAT_TRF.EXPEDIE || tr.etat === R.ETAT_TRF.CONTROLE)
        out.push({ ref: tr.id, etape: toWh ? "Réception entrepôt" : "Réception", resp: toWh ? (tr.destinationSite || "Entrepôt").split(" ")[0] : "Calibrage", statut: "ARRIVÉ", cls: "b-info", hash: toWh ? "transfert/" + tr.id : "calibrage" });
      if (tr.etat === R.ETAT_TRF.ECART) out.push({ ref: tr.id, etape: "Écart transfert", resp: "QA / Entrepôt", statut: "EN ÉCART", cls: "b-danger", hash: "transfert/" + tr.id });
    });
    R.cals().forEach(function (c) {
      if ([R.ETAT_CAL.PARTIEL, R.ETAT_CAL.RAPPROCHER, R.ETAT_CAL.VALIDER].indexOf(c.etat) >= 0) out.push({ ref: c.id, etape: "Bilan matière", resp: "Production", statut: "À VALIDER", cls: "b-warn", hash: "calibrage/" + c.id + "/bilan" });
    });
    return out;
  }
  function priorityTable(rows) {
    if (!rows.length) return '<div class="empty">Aucune action prioritaire — chaîne à jour.</div>';
    return '<div class="tablewrap" style="border:0"><table><thead><tr><th>Dossier</th><th>Étape</th><th>Responsable</th><th>Statut</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="mono">' + esc(r.ref) + '</td><td>' + esc(r.etape) + '</td><td>' + esc(r.resp) + '</td>' +
          '<td><span class="badge ' + r.cls + '">' + esc(r.statut) + '</span></td>' +
          '<td><button class="btn ghost sm" onclick="__rcngo(\'' + r.hash + '\')">Ouvrir</button></td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  /* ---- RÉCEPTION : liste + nouveau (slide 4) + fiche --------------- */
  PAGES.reception = function (r) {
    if (r.id === "new") return receptionForm();
    if (r.id) return receptionDetail(r.id);
    var recs = R.receptions();
    var body = recs.length ? '<div class="tablewrap"><table><thead><tr><th>REC</th><th>Camion</th><th>Fournisseur</th><th>Origine</th><th>Arrivée</th><th>Statut</th><th></th></tr></thead><tbody>' +
      recs.map(function (x) {
        return '<tr><td class="mono">' + esc(x.id) + '</td><td class="mono">' + esc(x.camion || "—") + '</td><td>' + esc(x.fournisseur || "—") + '</td><td>' + esc(x.origine || "—") + '</td><td>' + R.fmtDateTime(x.arriveeAt) + '</td><td>' + badgeEtat(x.etat) + '</td>' +
          '<td><button class="btn ghost sm" onclick="__rcngo(\'reception/' + x.id + '\')">Ouvrir</button></td></tr>';
      }).join("") + '</tbody></table></div>' : '<div class="empty">Aucune réception. Créez le premier dossier camion.</div>';
    return '<div class="pagehead"><h1>Réceptions</h1><p>La réception commence par un dossier temporaire, pas par un lot. REC est temporaire ; RCN n\'existe pas encore.</p></div>' +
      '<div class="actions" style="margin:0 0 16px"><button class="btn" onclick="__rcngo(\'reception/new\')">+ Nouvelle réception</button></div>' + body;
  };

  function receptionForm() {
    var refs = R.referentials();
    return '<div class="pagehead"><h1>Nouvelle réception camion</h1><p>On identifie d\'abord le camion. Aucun numéro de lot officiel n\'est créé à cette étape.</p></div>' +
      stepper(STEPS, 0) +
      '<div class="grid2"><div class="card"><h2>Dossier temporaire ' + badgeEtat(R.ETAT_REC.ARRIVEE) + '</h2><div class="cbody">' +
        '<label>Numéro temporaire</label><input readonly value="Généré à l\'enregistrement (REC-' + R.today() + '-…)">' +
        '<div class="row"><div><label>Immatriculation camion</label><input id="f_camion" placeholder="AA-0000-CI"></div>' +
        '<div><label>Date & heure d\'arrivée</label><input id="f_arrivee" type="datetime-local" value="' + nowLocal() + '"></div></div>' +
        '<div class="row"><div><label>Entrepôt de réception</label><select id="f_site">' + refs.entrepots.filter(function (e) { return e.code !== "ANAGROCI-01"; }).map(function (e) { return '<option value="' + esc(e.code) + '">' + esc(e.code + " · " + e.nom) + '</option>'; }).join("") + '</select>' +
          '<small style="color:var(--n500)"><a href="#stock" onclick="setTimeout(function(){location.hash=\'stock\'},0)" style="color:var(--forest)">+ Créer un entrepôt</a> (onglet Stock)</small></div>' +
        '<div><label>Provenance / origine (localité CI)</label><select id="f_origine">' + localiteOptions() + '</select></div></div>' +
        '<label>Fournisseur (coopérative · code LBA)</label><select id="f_fournisseur">' + refs.fournisseurs.map(function (f, i) { return '<option value="' + i + '">' + esc(f.nom + " · " + f.lba) + '</option>'; }).join("") + '</select>' +
        '<div class="row3"><div><label>Type d\'achat</label><select id="f_type"><option value="LBA">LBA financé</option><option value="DIS">DIS non financé</option></select></div>' +
        '<div><label>Commande / contrat</label><input id="f_po" placeholder="PO-…"></div><div><label>Réf. document fournisseur</label><input id="f_ref" placeholder="BL-…"></div></div>' +
        '<div class="row3"><div><label>Transporteur</label><input id="f_transporteur" placeholder="Société de transport"></div><div><label>Chauffeur</label><input id="f_chauffeur" placeholder="Nom complet"></div><div><label>Téléphone chauffeur</label><input id="f_phone" inputmode="tel" placeholder="+225 …"></div></div>' +
        '<div class="row"><div><label>Poids annoncé (kg)</label><input id="f_poids" type="number" inputmode="decimal" placeholder="—"></div><div><label>Sacs annoncés</label><input id="f_sacs" type="number" placeholder="—"></div></div>' +
        '<div class="actions"><button class="btn" onclick="RCNUI.createReception()">Enregistrer & envoyer au labo</button>' +
        '<button class="btn ghost" onclick="__rcngo(\'reception\')">Annuler</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> REC est temporaire. Le champ lot reste vide et verrouillé. Un doublon évident (même camion, même créneau) est refusé.</div>' +
      '</div>';
  }
  function nowLocal() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  // Options <optgroup> des localités CI groupées par région (pour l'origine).
  function localiteOptions(selected) {
    var locs = R.localites(); var byR = {};
    locs.forEach(function (l) { (byR[l.region] || (byR[l.region] = [])).push(l); });
    return Object.keys(byR).sort().map(function (reg) {
      return '<optgroup label="' + esc(reg) + '">' + byR[reg].sort(function (a, b) { return a.ville.localeCompare(b.ville); }).map(function (l) {
        return '<option value="' + esc(l.ville) + '"' + (selected === l.ville ? " selected" : "") + '>' + esc(l.ville) + '</option>';
      }).join("") + '</optgroup>';
    }).join("");
  }

  function receptionDetail(id) {
    var rec = R.getRec(id); if (!rec) return notFound(id);
    var curStep = recStep(rec);
    var s = rec.sampling, f = rec.finale, g = rec.gm, dech = rec.dechargement;
    var out = '<div class="pagehead"><h1>' + esc(rec.id) + ' · ' + esc(rec.camion || "camion") + '</h1><p>' + esc(rec.fournisseur) + ' — ' + esc(rec.origine || "origine ?") + ' · arrivée ' + R.fmtDateTime(rec.arriveeAt) + '</p></div>' +
      stepper(STEPS, curStep) +
      '<div class="grid2"><div>' +
        '<div class="card"><h2>Dossier ' + badgeEtat(rec.etat) + '</h2><div class="cbody">' +
          field("Poids annoncé", R.kg(rec.poidsAnnonce)) + field("Sacs annoncés", rec.sacsAnnonce == null ? "—" : rec.sacsAnnonce) +
          field("Type d'achat", rec.typeAchat || "—") + field("Commande / contrat", rec.commandeRef || "—") + field("Réf. fournisseur", rec.refDoc || "—") +
          field("Transporteur", rec.transporteur || "—") + field("Chauffeur", (rec.chauffeur || "—") + (rec.telephoneChauffeur ? " · " + rec.telephoneChauffeur : "")) +
          (s ? '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Sampling ' + esc(s.id) + '</b>' +
            field("KOR sampling", s.korDisplay != null ? s.korDisplay.toFixed(2) : "—") + field("Total Defect", s.totalDefect == null ? "—" : s.totalDefect + " g") + field("Total Kernels", s.totalKernels == null ? "—" : s.totalKernels + " g") + field("Nut Count", s.nc == null ? "—" : s.nc) + field("Humidité", s.humidity == null ? "—" : s.humidity + " %") : "") +
          (g ? '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Décision GM</b>' + field("Décision", g.autorise ? "AUTORISÉ" : "REFUSÉ") + field("Commentaire", g.commentaire || "—") + field("Le", R.fmtDateTime(g.at)) : "") +
          (dech ? '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Déchargement</b>' + field("Net physique", R.kg(dech.net)) + field("Réfaction", R.kg(dech.refraction || 0)) + field("Poids payé", R.kg(dech.poidsPaye)) + field("Bordereau", dech.bordereau || "—") + field("Poids main-d\'œuvre", dech.poidsMainDoeuvre == null ? "—" : R.kg(dech.poidsMainDoeuvre) + " (séparé du stock)") : "") +
          (f ? '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Analyse finale</b>' + field("KOR final", f.korDisplay != null ? f.korDisplay.toFixed(2) : "—") + field("Écart absolu", f.ecartDisplay != null ? f.ecartDisplay.toFixed(2) + (f.conforme ? " (< 1)" : " (≥ 1)") : "—") : "") +
          (rec.lotId ? field("Lot officiel", '<a href="#qualite/' + rec.id + '/fiche">' + esc(rec.lotId) + ' →</a>') : "") +
        '</div></div>' +
        recActionCard(rec) +
      '</div>' +
      '<div class="card"><h2>Parcours du dossier</h2><div class="cbody">' + timeline(rec.events) + '</div></div>' +
      receptionDocuments(rec) +
      '</div>';
    return out;
  }
  function receptionDocuments(rec) {
    var docs = R.documentsFor(rec.id);
    var rows = docs.length ? docs.map(function (d) {
      return '<tr><td>' + esc(d.type) + '</td><td><a href="' + esc(d.dataUrl) + '" download="' + esc(d.nom) + '">' + esc(d.nom) + '</a></td><td>' + R.fmtDateTime(d.at) + '</td><td>' + esc(d.auteur || "—") + '</td></tr>';
    }).join("") : '<tr><td colspan="4" class="empty">Aucune pièce jointe.</td></tr>';
    var add = R.hasPermission("document") ? '<div class="row3" style="margin-top:14px"><div><label>Type de pièce</label><select id="doc_type"><option value="ticket_pesee">Ticket de pesée</option><option value="fiche_ccak">Fiche CCAK</option><option value="photo_camion">Photo camion</option><option value="bordereau">Bordereau</option><option value="autre">Autre</option></select></div><div><label>Photo ou PDF (max. 750 Ko)</label><input id="doc_file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></div><div style="align-self:end"><button class="btn" onclick="RCNUI.addDocument(\'' + rec.id + '\')">Joindre au dossier</button></div></div>' : '<div class="alert">Lecture seule : votre rôle ne peut pas ajouter de pièce.</div>';
    var correction = R.hasPermission("correction") ? '<button class="btn ghost sm" onclick="RCNUI.correctReception(\'' + rec.id + '\')">✎ Corriger une valeur</button>' : '';
    return '<div class="card" style="margin-top:18px"><h2>Preuves & pièces justificatives <span class="badge b-neutral">' + docs.length + '</span></h2><div class="cbody"><div class="tablewrap"><table><thead><tr><th>Type</th><th>Fichier</th><th>Ajouté le</th><th>Par</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + add + '<div class="actions">' + correction + '</div><small style="color:var(--n500)">Les pièces restent disponibles hors connexion pendant le pilote. En production, elles seront placées dans un stockage documentaire sécurisé.</small></div></div>';
  }
  function recStep(rec) {
    var e = R.ETAT_REC;
    if (rec.etat === e.ARRIVEE) return 1;
    if ([e.SAMPLING, e.ATTENTE_GM].indexOf(rec.etat) >= 0) return 2;
    if ([e.AUTORISEE, e.REFUSEE].indexOf(rec.etat) >= 0) return 3;
    if (rec.etat === e.DECHARGE) return 4;
    if ([e.LIBERE, e.BLOQUE, e.CLOS].indexOf(rec.etat) >= 0) return 5;
    return 1;
  }
  function recActionCard(rec) {
    var e = R.ETAT_REC;
    if ([e.ARRIVEE, e.SAMPLING].indexOf(rec.etat) >= 0)
      return '<div class="card" style="margin-top:16px"><h2>Prochaine action · Qualité</h2><div class="cbody"><p style="margin:0 0 12px;color:var(--n500)">Le laboratoire saisit le sampling avant déchargement.</p>' + actionButton("sampling", "Saisir le sampling →", "qualite/" + rec.id + "/sampling") + '</div></div>';
    if (rec.etat === e.ATTENTE_GM)
      return '<div class="card" style="margin-top:16px"><h2>Prochaine action · GM</h2><div class="cbody"><p style="margin:0 0 12px;color:var(--n500)">Sans autorisation GM, le déchargement reste indisponible.</p>' + actionButton("gm_decision", "Décision de déchargement →", "qualite/" + rec.id + "/gm") + '</div></div>';
    if (rec.etat === e.AUTORISEE)
      return '<div class="card" style="margin-top:16px"><h2>Prochaine action · Entrepôt</h2><div class="cbody">' + actionButton("unloading", "Enregistrer le déchargement →", "reception/" + rec.id + "/dech") + '</div></div>';
    if (rec.etat === e.DECHARGE)
      return '<div class="card" style="margin-top:16px"><h2>Prochaine action · Qualité</h2><div class="cbody">' + actionButton("lot_release", "Analyse finale & libération →", "qualite/" + rec.id + "/finale") + '</div></div>';
    if (rec.etat === e.BLOQUE)
      return '<div class="card" style="margin-top:16px"><h2 style="color:var(--danger)">Lot bloqué qualité</h2><div class="cbody"><div class="alert">Écart KOR ≥ 1. Flux d\'exception : nouvelle analyse, justification, décision et éventuel déclassement.</div><button class="btn warn" onclick="__rcngo(\'qualite/' + rec.id + '/finale\')">Nouvelle analyse →</button></div></div>';
    return "";
  }
  function actionButton(permission, label, routeTo) {
    return R.hasPermission(permission) ? '<button class="btn" onclick="__rcngo(\'' + routeTo + '\')">' + esc(label) + '</button>' : '<div class="alert">Lecture seule · action réservée au rôle responsable.</div>';
  }

  /* sub-route reception/<id>/dech --------------------------------- */
  PAGES.reception._sub = function (r) { };

  /* ---- QUALITÉ : hub + sampling / gm / finale / fiche ------------- */
  PAGES.qualite = function (r) {
    if (r.id && r.sub === "sampling") return samplingForm(r.id);
    if (r.id && r.sub === "gm") return gmForm(r.id);
    if (r.id && r.sub === "finale") return finaleForm(r.id);
    if (r.id && r.sub === "fiche") return lotFiche(r.id);
    // hub : dossiers nécessitant une action qualité
    var recs = R.receptions();
    var samp = recs.filter(function (x) { return [R.ETAT_REC.ARRIVEE, R.ETAT_REC.SAMPLING].indexOf(x.etat) >= 0; });
    var gm = recs.filter(function (x) { return x.etat === R.ETAT_REC.ATTENTE_GM; });
    var fin = recs.filter(function (x) { return [R.ETAT_REC.DECHARGE, R.ETAT_REC.BLOQUE].indexOf(x.etat) >= 0; });
    var lib = recs.filter(function (x) { return x.etat === R.ETAT_REC.LIBERE; });
    function list(rows, act, lbl) {
      if (!rows.length) return '<div class="empty">Aucun dossier.</div>';
      return '<div class="tablewrap"><table><tbody>' + rows.map(function (x) {
        return '<tr><td class="mono">' + esc(x.id) + '</td><td>' + esc(x.fournisseur) + '</td><td>' + badgeEtat(x.etat) + '</td><td style="text-align:right"><button class="btn ghost sm" onclick="__rcngo(\'qualite/' + x.id + '/' + act + '\')">' + lbl + '</button></td></tr>';
      }).join("") + '</tbody></table></div>';
    }
    return '<div class="pagehead"><h1>Qualité · Laboratoire</h1><p>Le sampling calcule le KOR sans cacher les détails. Le sampling et l\'analyse finale restent deux enregistrements séparés.</p></div>' +
      '<div class="cards">' +
        '<div class="card"><h2>Sampling à saisir <span class="badge b-warn">' + samp.length + '</span></h2><div class="cbody" style="padding:6px 0">' + list(samp, "sampling", "Sampling") + '</div></div>' +
        '<div class="card"><h2>Décision GM <span class="badge b-warn">' + gm.length + '</span></h2><div class="cbody" style="padding:6px 0">' + list(gm, "gm", "Décider") + '</div></div>' +
        '<div class="card"><h2>Analyse finale <span class="badge b-warn">' + fin.length + '</span></h2><div class="cbody" style="padding:6px 0">' + list(fin, "finale", "Analyser") + '</div></div>' +
        '<div class="card"><h2>Lots libérés <span class="badge b-ok">' + lib.length + '</span></h2><div class="cbody" style="padding:6px 0">' + list(lib, "fiche", "Fiche") + '</div></div>' +
      '</div>';
  };

  function samplingForm(id) {
    var rec = R.getRec(id); if (!rec) return notFound(id);
    var s = rec.sampling || {};
    return '<div class="pagehead"><h1>Sampling avant déchargement</h1><p>' + esc(rec.id) + ' · ' + esc(rec.fournisseur) + ' — le laboratoire saisit, l\'application calcule.</p></div>' +
      stepper(STEPS, 1) +
      '<div class="grid2"><div class="card"><h2>Mesures de l\'échantillon</h2><div class="cbody">' +
        '<div class="row3">' +
          inp("s_gk", "Good Kernel (g)", s.gk, "number") + inp("s_imm", "Immature (g)", s.imm, "number") + inp("s_sp", "Spotted (g)", s.spotted, "number") +
        '</div><div class="row3">' +
          inp("s_browns", "Browns/Rejection (g)", s.browns, "number") + inp("s_voids", "Voids (g)", s.voids, "number") + inp("s_oil", "Oil (g)", s.oil, "number") +
        '</div><div class="row">' +
          inp("s_nc", "Nut Count (manuel)", s.nc, "number") + inp("s_hum", "Humidité (%)", s.humidity, "number") +
        '</div>' +
        '<div class="metrics" style="margin-top:16px">' +
          '<div class="metric big"><small>KOR calculé</small><b id="korLive">' + (rec.sampling && rec.sampling.korDisplay != null ? rec.sampling.korDisplay.toFixed(2) : "—") + '</b><span>valeur affichée (2 déc.)</span></div>' +
          '<div class="metric"><small>Total Defect</small><b id="tdLive">—</b><span>Browns+Voids+Oil</span></div>' +
          '<div class="metric"><small>Total Kernels</small><b id="tkLive">—</b><span>GK+IMM+Spotted</span></div>' +
        '</div>' +
        '<div class="pill-formula" style="margin-top:6px">KOR = ' + esc(R.KOR_FORMULA) + '</div>' +
        '<div class="actions"><button class="btn ghost" onclick="RCNUI.saveSampling(\'' + id + '\',false)">Enregistrer</button>' +
        '<button class="btn" onclick="RCNUI.saveSampling(\'' + id + '\',true)">Enregistrer & envoyer au GM</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Le sampling est obligatoirement réalisé avant le déchargement. Une case vide n\'est jamais transformée en zéro : saisissez 0 lorsqu\'un défaut a été recherché et non trouvé.</div>' +
      '</div>';
  }

  function gmForm(id) {
    var rec = R.getRec(id); if (!rec) return notFound(id);
    var s = rec.sampling || {};
    return '<div class="pagehead"><h1>Décision de déchargement</h1><p>' + esc(rec.id) + ' · le GM décide, l\'écran garde la preuve.</p></div>' +
      stepper(STEPS, 2) +
      '<div class="grid2"><div class="card"><h2>Résultats du sampling <span class="badge b-info">Action GM</span></h2><div class="cbody">' +
        '<div class="metrics">' +
          '<div class="metric big"><small>KOR sampling</small><b>' + (s.korDisplay != null ? s.korDisplay.toFixed(2) : "—") + '</b></div>' +
          '<div class="metric"><small>Humidité</small><b>' + (s.humidity == null ? "—" : s.humidity) + '</b><span>%</span></div>' +
          '<div class="metric"><small>Nut Count</small><b>' + (s.nc == null ? "—" : s.nc) + '</b><span>manuel</span></div>' +
        '</div>' +
        '<label>Commentaire (obligatoire en cas de refus)</label><textarea id="gm_comment" rows="3" placeholder="Observation, instruction…"></textarea>' +
        '<label>Délégataire (si le GM est remplacé)</label><input id="gm_deleg" placeholder="Nom du délégataire nominatif — facultatif">' +
        '<div class="actions"><button class="btn danger" onclick="RCNUI.gmDecision(\'' + id + '\',false)">Refuser</button>' +
        '<button class="btn" onclick="RCNUI.gmDecision(\'' + id + '\',true)">Autoriser le déchargement</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Sans autorisation GM, le bouton de déchargement reste indisponible. Le lot officiel n\'est créé qu\'après accord et analyse finale. Toute délégation est nominative et journalisée.</div>' +
      '</div>';
  }

  PAGES.reception._dech = true;
  function dechForm(id) {
    var rec = R.getRec(id); if (!rec) return notFound(id);
    return '<div class="pagehead"><h1>Déchargement & pesée</h1><p>' + esc(rec.id) + ' · le poids net physique alimente le stock ; le poids main-d\'œuvre reste séparé.</p></div>' +
      stepper(STEPS, 3) +
      '<div class="grid2"><div class="card"><h2>Pesée & documents</h2><div class="cbody">' +
        '<div class="row3">' + inp("d_wh", "Reçu magasin (W/H)", "", "text") + inp("d_fiche", "N° fiche CCA", "", "text") + inp("d_bin", "BIN de déchargement", "", "text") + '</div>' +
        '<div class="row">' + inp("d_bord", "Bordereau", "", "text") + inp("d_ticket", "Ticket de pesée", "", "text") + '</div>' +
        '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Sacs par catégorie</b>' +
        '<div class="row" style="margin-top:8px">' + inp("d_sacsBon", "Bons sacs", "", "number") + inp("d_sacsHum", "Sacs humides", "", "number") + '</div>' +
        '<div class="row">' + inp("d_sacsDech", "Sacs déchirés", "", "number") + inp("d_sacsRec", "Sacs reconditionnés", "", "number") + '</div>' +
        '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Poids</b>' +
        '<div class="row3" style="margin-top:8px">' + inp("d_brut", "Poids brut (kg)", "", "number") + inp("d_tare", "Tare (kg)", "", "number") + inp("d_net", "Net (kg) — auto si vide", "", "number") + '</div>' +
        '<div class="row">' + inp("d_refraction", "Réfaction / déduction (kg)", "0", "number") + inp("d_paye", "Poids payé (kg) — auto si vide", "", "number") + '</div>' +
        '<div class="row">' + inp("d_mo", "Poids main-d\'œuvre (kg)", "", "number") + inp("d_prest", "Prestataire / transporteur", "", "text") + '</div>' +
        '<div class="row">' + inp("d_debut", "Début du déchargement", "", "datetime-local") + inp("d_fin", "Fin du déchargement", "", "datetime-local") + '</div>' +
        '<label>Incident / matière renversée / observation</label><textarea id="d_incident" rows="3" placeholder="Aucun incident, ou décrire précisément…"></textarea>' +
        '<div class="actions"><button class="btn" onclick="RCNUI.saveDechargement(\'' + id + '\')">Enregistrer le déchargement</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Le poids net physique commande le stock. Le poids payé = net physique − réfaction. Le poids main-d\'œuvre reste séparé et ne modifie jamais le stock.</div>' +
      '</div>';
  }

  function finaleForm(id) {
    var rec = R.getRec(id); if (!rec) return notFound(id);
    var s = rec.sampling || {};
    var refs = R.referentials();
    var bins = R.binCycles().filter(function (c) { return c.etat !== R.ETAT_BIN.CLOS; });
    return '<div class="pagehead"><h1>Analyse finale & création du lot</h1><p>' + esc(rec.id) + ' · RCN devient l\'identité permanente. Le lot naît après l\'analyse finale acceptée.</p></div>' +
      stepper(STEPS, 4) +
      '<div class="grid2"><div class="card"><h2>Deuxième contrôle qualité</h2><div class="cbody">' +
        '<div class="row3">' + inp("ff_gk", "Good Kernel (g)", "", "number") + inp("ff_imm", "Immature (g)", "", "number") + inp("ff_sp", "Spotted (g)", "", "number") + '</div>' +
        '<div class="row3">' + inp("ff_browns", "Browns/Rejection (g)", "", "number") + inp("ff_voids", "Voids (g)", "", "number") + inp("ff_oil", "Oil (g)", "", "number") + '</div>' +
        '<div class="row">' + inp("ff_nc", "Nut Count", "", "number") + inp("ff_hum", "Humidité (%)", "", "number") + '</div>' +
        '<div class="metrics" style="margin-top:16px">' +
          '<div class="metric"><small>KOR sampling</small><b>' + (s.korDisplay != null ? s.korDisplay.toFixed(2) : "—") + '</b></div>' +
          '<div class="metric big"><small>KOR final</small><b id="ffKor">—</b></div>' +
          '<div class="metric"><small>Écart absolu</small><b id="ffEc">—</b><span id="ffEcTxt">tolérance : &lt; 1</span></div>' +
        '</div>' +
        '<label>Numéro officiel proposé</label><input readonly value="Généré à la libération (RCN-' + R.today() + '-…)">' +
        (rec.prixUnitaire != null
          ? '<label>Prix d\'achat (FCFA/kg)</label><input id="ff_prix" type="number" value="' + rec.prixUnitaire + '"><small style="color:var(--n500)">Hérité du transfert (prix moyen pondéré) — modifiable.</small>'
          : '<label>Prix d\'achat (FCFA/kg) <span style="color:var(--n500)">— facultatif</span></label><input id="ff_prix" type="number" placeholder="ex. 400">') +
        '<label>BIN de destination (facultatif)</label><select id="ff_bin"><option value="">— Rester en stock lot —</option>' +
          bins.map(function (c) { return '<option value="' + esc(c.binId) + '">' + esc(c.binId) + ' · ' + esc(c.id) + '</option>'; }).join("") + '</select>' +
        '<div class="actions"><button class="btn danger" onclick="RCNUI.finale(\'' + id + '\',\'bloquer\')">Bloquer le dossier</button>' +
        '<button class="btn" onclick="RCNUI.finale(\'' + id + '\',\'liberer\')">Créer le lot officiel</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Comparaison sur les valeurs exactes non arrondies (affichage 2 décimales). Si l\'écart KOR est ≥ 1, le dossier passe en BLOQUÉ_QUALITÉ. Le lot reste non mélangeable tant que l\'analyse finale n\'est pas validée.</div>' +
      '</div>';
  }

  /* ---- FICHE & GÉNÉALOGIE DU LOT (slide 8) ------------------------ */
  function lotFiche(recId) {
    var rec = R.getRec(recId); if (!rec) return notFound(recId);
    var lot = rec.lotId ? R.getLot(rec.lotId) : null;
    if (!lot) return '<div class="alert">Ce dossier n\'a pas encore de lot officiel.</div>' + '<button class="btn ghost" onclick="__rcngo(\'reception/' + recId + '\')">← Dossier</button>';
    var cyc = lot.binId ? R.binCycles().filter(function (c) { return c.binId === lot.binId && c.etat !== R.ETAT_BIN.CLOS; })[0] : null;
    var contrib = cyc ? cyc.contributors.filter(function (c) { return c.lotId === lot.id; })[0] : null;
    var binStock = cyc ? R.binStock(cyc) : 0;
    var share = (contrib && binStock) ? R.round2((contrib.entree - contrib.sorti) / binStock * 100) : null;
    return '<div class="pagehead"><h1>Fiche du lot ' + esc(lot.id) + ' ' + badgeEtat(lot.etat) + '</h1><p>Une seule fiche remplace les recherches — origine, qualité, stock, documents et événements.</p></div>' +
      '<div class="metrics">' +
        '<div class="metric big"><small>KOR final</small><b>' + (lot.korDisplay != null ? lot.korDisplay.toFixed(2) : "—") + '</b></div>' +
        '<div class="metric"><small>Poids disponible</small><b>' + R.round2(lot.stock) + '</b><span>kg (solde lot)</span></div>' +
        '<div class="metric"><small>BIN actuelle</small><b>' + esc(lot.binId || "—") + '</b><span>' + (cyc ? esc(cyc.id) : "") + '</span></div>' +
        '<div class="metric"><small>Contribution</small><b>' + (share != null ? share + " %" : "—") + '</b><span>dans le cycle</span></div>' +
      '</div>' +
      '<div class="grid2"><div class="card"><h2>Parcours du lot</h2><div class="cbody">' + timeline(rec.events) + '</div></div>' +
      '<div><div class="card"><h2>Généalogie</h2><div class="cbody">' +
        '<p style="margin:0 0 10px;color:var(--n500);font-size:13px">Parents & enfants matière (§10.3).</p>' +
        field("Réception parent", '<a href="#reception/' + rec.id + '">' + esc(rec.id) + ' →</a>') +
        field("Fournisseur", lot.fournisseur) + field("Sampling", rec.sampling ? esc(rec.sampling.id) : "—") + field("Analyse finale", rec.finale ? esc(rec.finale.id) : "—") +
        (lot.children.length ? '<hr style="border:0;border-top:1px solid var(--n200);margin:12px 0"><b style="font-family:var(--fd);color:var(--forest)">Enfants matière</b>' +
          lot.children.map(function (c) { return field(c.type === "bin" ? "→ BIN " + c.ref : "→ TRF " + c.ref, R.kg(c.qty)); }).join("") : "") +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Les corrections créent une nouvelle version ; elles n\'effacent jamais l\'ancienne.</div>' +
      '</div></div>';
  }

  /* ---- STOCK & BIN (slide 9) -------------------------------------- */
  PAGES.stock = function (r) {
    if (r.id) return binDetail(r.id);
    var cycles = R.binCycles();
    var body = cycles.length ? '<div class="tablewrap"><table><thead><tr><th>Cycle BIN</th><th>BIN</th><th>Stock physique</th><th>Durée</th><th>Perte</th><th>Contributeurs</th><th>Statut</th><th></th></tr></thead><tbody>' +
      cycles.map(function (c) {
        var h = R.binDurationH(c, Date.now()); var dur = h == null ? "—" : (h >= 48 ? Math.round(h / 24) + " j" : h + " h");
        return '<tr><td class="mono">' + esc(c.id) + '</td><td class="mono">' + esc(c.binId) + '</td><td class="mono">' + R.kg(R.binStock(c)) + '</td><td>' + dur + '</td><td class="mono">' + (c.perteKg != null ? R.kg(c.perteKg) : "—") + '</td><td>' + c.contributors.length + '</td><td>' + badgeEtat(c.etat) + '</td>' +
          '<td><button class="btn ghost sm" onclick="__rcngo(\'stock/' + encodeURIComponent(c.id) + '\')">Ouvrir</button></td></tr>';
      }).join("") + '</tbody></table></div>' : '<div class="empty">Aucun cycle de BIN ouvert.</div>';
    return '<div class="pagehead"><h1>Stock & BIN collectives</h1><p>La BIN est un contenant, pas un nouveau lot. Après mélange, on suit les quantités et les contributeurs, pas chaque noix.</p></div>' +
      warehousePanel() +
      '<div class="actions" style="margin:0 0 16px"><button class="btn" onclick="RCNUI.openCycle()">+ Ouvrir un cycle de BIN</button></div>' + body;
  };

  // Gestion des entrepôts de réception : liste + création (localité CI).
  function warehousePanel() {
    var ents = R.referentials().entrepots.filter(function (e) { return e.code !== "ANAGROCI-01"; });
    var byLoc = {};
    R.binCycles().forEach(function (c) { var w = R.warehouseOf(c.binId); byLoc[w] = (byLoc[w] || 0) + (c.etat !== R.ETAT_BIN.CLOS ? 1 : 0); });
    var rows = ents.map(function (e) {
      return '<tr><td class="mono">' + esc(e.code) + '</td><td>' + esc(e.nom) + '</td><td>' + esc(e.location || "—") + '</td><td class="mono">' + (byLoc[e.code] || 0) + '</td></tr>';
    }).join("");
    return '<div class="card" style="margin:0 0 16px"><h2>Entrepôts de réception <span class="badge b-neutral">' + ents.length + '</span></h2><div class="cbody">' +
      '<div class="grid2" style="align-items:start">' +
        '<div class="tablewrap" style="border:0"><table><thead><tr><th>Code</th><th>Nom</th><th>Localité</th><th>BIN actives</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4" class="empty">Aucun entrepôt.</td></tr>') + '</tbody></table></div>' +
        '<div><div class="row"><div><label>Code entrepôt</label><input id="wh_code" placeholder="ex. BKE-004"></div>' +
          '<div><label>Nom (facultatif)</label><input id="wh_nom" placeholder="ex. Bouaké — Entrepôt 4"></div></div>' +
          '<label>Localité (ville CI)</label><select id="wh_loc">' + localiteOptions("Bouaké") + '</select>' +
          '<div class="actions"><button class="btn" onclick="RCNUI.addEntrepot()">+ Créer l\'entrepôt</button></div>' +
          '<small style="color:var(--n500)">L\'identifiant des BIN en découle : <span class="mono">&lt;CODE&gt;-BIN-nn</span>. Le calibrage reste réservé à Yamoussoukro.</small>' +
        '</div>' +
      '</div>' +
    '</div></div>';
  }

  function binDetail(cycleId) {
    var cyc = R.getCycle(cycleId); if (!cyc) return notFound(cycleId);
    var stock = R.binStock(cyc);
    var rows = cyc.contributors.map(function (c) {
      var dispo = R.round2(c.entree - c.sorti);
      var part = stock ? R.round2(dispo / stock * 100) : 0;
      var lot = R.getLot(c.lotId); var q = R.lotQuality(c.lotId);
      return '<tr><td class="mono">' + esc(c.lotId) + '</td><td>' + esc(q.fournisseur || "—") + '</td><td class="mono">' + R.kg(c.entree) + '</td><td>' + bar(part) + '</td><td class="mono">' + R.kg(dispo) + '</td><td class="mono">' + (q.kor != null ? q.kor.toFixed(2) : "—") + '</td><td class="mono">' + (q.sacs == null ? "—" : q.sacs) + '</td><td>' + badgeEtat((lot || {}).etat || c.qualite) + '</td></tr>';
    }).join("");
    var libLots = R.lots().filter(function (l) { return l.etat === R.ETAT_REC.LIBERE && l.stock > 0; });
    var totals = R.binTotals(cyc);
    var dureeH = R.binDurationH(cyc, Date.now());
    var duree = dureeH == null ? "—" : (dureeH >= 48 ? Math.round(dureeH / 24) + " j" : dureeH + " h");
    var closed = cyc.etat === R.ETAT_BIN.CLOS;
    var prixMoyen = R.binPrixMoyen(cyc);
    var perteCls = cyc.perteNiveau === "rouge" ? "alert" : (cyc.perteNiveau === "orange" ? "" : "okbox");
    var closeBox = closed
      ? '<div class="' + (cyc.perteNiveau === "rouge" ? "alert" : "okbox") + '">🔒 Cycle clos (verrouillé) le ' + R.fmtDateTime(cyc.closedAt || cyc.reouvertAt) + ' · résidu ' + R.kg(cyc.residuKg) + ' · <b>perte ' + R.kg(cyc.perteKg) + (cyc.pertePct != null ? " (" + cyc.pertePct + " %, seuil " + R.seuilPerteBin() + " %)" : "") + '</b> · validé par ' + esc(cyc.confirmeur || "—") + (cyc.justification ? ' · justif. : ' + esc(cyc.justification) : "") + (cyc.reouvertures ? ' · réouvertures : ' + cyc.reouvertures : "") + '<div class="actions" style="margin-top:10px"><button class="btn ghost sm" onclick="RCNUI.reopenBin(\'' + encodeURIComponent(cyc.id) + '\')">Réouvrir (autorisation requise)</button></div></div>'
      : '<div class="actions" style="margin:0 0 16px"><button class="btn ghost" onclick="RCNUI.closeBin(\'' + encodeURIComponent(cyc.id) + '\')">Clôturer la BIN (inventaire + validation)</button></div>';
    return '<div class="pagehead"><h1>' + esc(cyc.binId) + ' · ' + esc(cyc.id) + ' ' + badgeEtat(cyc.etat) + '</h1><p>Composition théorique du cycle — après mélange, les pourcentages suivent le bilan matière.</p></div>' +
      closeBox +
      '<div class="metrics">' +
        '<div class="metric big"><small>Stock physique</small><b>' + R.round2(stock) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Entré / Sorti</small><b style="font-size:17px">' + totals.entree + ' / ' + totals.sorti + '</b><span>kg cumulés</span></div>' +
        '<div class="metric"><small>Durée du cycle</small><b>' + duree + '</b><span>' + (closed ? "clos" : "ouvert") + '</span></div>' +
        '<div class="metric"><small>Contributeurs</small><b>' + pad2(cyc.contributors.length) + '</b><span>' + esc(cyc.qualiteAutorisee || "à valider") + '</span></div>' +
        '<div class="metric"><small>Prix moyen pondéré</small><b style="font-size:17px">' + (prixMoyen == null ? "—" : R.round2(prixMoyen)) + '</b><span>' + (prixMoyen == null ? "prix lots non saisi" : "FCFA/kg · valeur " + fcfa(stock * prixMoyen)) + '</span></div>' +
      '</div>' +
      '<div class="card" style="margin-bottom:16px"><h2>Composition théorique du cycle</h2><div class="cbody" style="padding:0">' +
        (rows ? '<div class="tablewrap" style="border:0"><table><thead><tr><th>Lot officiel</th><th>Fournisseur</th><th>Entrée</th><th>Part</th><th>Disponible</th><th>KOR</th><th>Sacs</th><th>Statut</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">BIN vide.</div>') +
      '</div></div>' +
      '<div class="grid2"><div class="card"><h2>Ajouter une entrée</h2><div class="cbody">' +
        '<label>Lot libéré</label><select id="bin_lot">' + (libLots.length ? libLots.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.id) + ' · dispo ' + R.round2(l.stock) + ' kg</option>'; }).join("") : '<option value="">Aucun lot libéré disponible</option>') + '</select>' +
        '<label>Poids (kg)</label><input id="bin_qty" type="number" placeholder="—">' +
        '<div class="actions"><button class="btn" onclick="RCNUI.addToBin(\'' + esc(cyc.binId) + '\')" ' + (libLots.length ? "" : "disabled") + '>Ajouter le lot</button></div>' +
      '</div></div>' +
      '<div class="card"><h2>Créer une sortie / transfert</h2><div class="cbody">' +
        '<p style="margin:0 0 10px;color:var(--n500);font-size:13px">Répartition proportionnelle entre contributeurs (R-03).</p>' +
        '<label>Destination</label><select id="bin_dest">' +
          (R.calibrageAutorise(cyc.binId) ? '<option value="cal">Calibrage · Usine</option>' : "") +
          R.referentials().entrepots.filter(function (e) { return e.code !== "ANAGROCI-01" && e.code !== R.warehouseOf(cyc.binId); }).map(function (e) { return '<option value="wh:' + esc(e.code + " · " + e.nom) + '">Entrepôt ' + esc(e.nom) + ' (' + esc(e.code) + ')</option>'; }).join("") + '</select>' +
          (R.calibrageAutorise(cyc.binId) ? "" : '<div class="hint">Les entrepôts de ' + esc(R.locationOfBin(cyc.binId) || "cette localité") + ' ne calibrent pas : transfert vers un entrepôt uniquement.</div>') +
        '<label>Quantité à sortir (kg)</label><input id="bin_out" type="number" placeholder="—">' +
        '<div class="actions"><button class="btn" onclick="RCNUI.prepareTransfer(\'' + encodeURIComponent(cyc.id) + '\')" ' + (stock > 0 ? "" : "disabled") + '>Préparer le transfert →</button></div>' +
      '</div></div></div>';
  }

  /* ---- SÉCHAGE / TRIAGE (§7.5) ------------------------------------ */
  PAGES.sechage = function () {
    var ops = R.dryings();
    var cycles = R.binCycles().filter(function (c) { return c.etat !== R.ETAT_BIN.CLOS && R.binStock(c) > 0; });
    var rows = ops.length ? ops.map(function (d) {
      return '<tr><td class="mono">' + esc(d.id) + '</td><td>' + esc(d.type) + '</td><td class="mono">' + esc(d.sourceBinId) + ' → ' + esc(d.targetBinId) + '</td>' +
        '<td class="mono">' + R.kg(d.inputKg) + '</td><td class="mono">' + R.kg(d.outputKg) + '</td>' +
        '<td class="mono">' + R.kg(d.lossKg) + ' <span style="color:var(--n500)">(' + d.lossPct + ' %)</span></td>' +
        '<td>' + (d.inputMoisture != null ? d.inputMoisture + '→' + (d.outputMoisture != null ? d.outputMoisture : "—") + ' %' : "—") + '</td>' +
        '<td>' + R.fmtDateTime(d.at) + '</td></tr>';
    }).join("") : '';
    return '<div class="pagehead"><h1>Une BIN est un contenant vivant : séchage & triage</h1><p>Entre le stockage et le transfert, la matière peut être séchée ou triée. On compare avant/après (humidité, NC, KOR, sacs) et on calcule la perte.</p></div>' +
      '<div class="grid2 rev"><div><div class="card"><h2>Nouvelle opération de séchage / triage</h2><div class="cbody">' +
        '<label>Type d\'opération</label><select id="dry_type"><option value="sechage">Séchage</option><option value="triage">Triage</option></select>' +
        '<label>BIN source</label><select id="dry_src">' + (cycles.length ? cycles.map(function (c) { return '<option value="' + encodeURIComponent(c.id) + '">' + esc(c.binId) + ' · dispo ' + R.round2(R.binStock(c)) + ' kg</option>'; }).join("") : '<option value="">Aucune BIN avec stock</option>') + '</select>' +
        '<label>BIN après séchage (destination)</label><input id="dry_target" placeholder="ex. BKE-002-BIN-003-DRIED">' +
        '<div class="row"><div><b style="font-family:var(--fd);color:var(--forest);font-size:13px">ENTRÉE</b>' + inp("dry_inKg", "Poids envoyé (kg)", "", "number") + inp("dry_inSacs", "Sacs envoyés", "", "number") + inp("dry_inMois", "Humidité entrée (%)", "", "number") + inp("dry_inNc", "Nut Count entrée", "", "number") + inp("dry_inKor", "KOR entrée", "", "number") + '</div>' +
        '<div><b style="font-family:var(--fd);color:var(--forest);font-size:13px">SORTIE</b>' + inp("dry_outKg", "Poids récupéré (kg)", "", "number") + inp("dry_outSacs", "Sacs récupérés", "", "number") + inp("dry_outMois", "Humidité sortie (%)", "", "number") + inp("dry_outNc", "Nut Count sortie", "", "number") + inp("dry_outKor", "KOR sortie", "", "number") + '</div></div>' +
        '<div class="balance" id="dryLoss">Perte = envoyé − récupéré</div>' +
        '<div class="actions"><button class="btn" onclick="RCNUI.createDrying()" ' + (cycles.length ? "" : "disabled") + '>Enregistrer l\'opération</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Perte = poids envoyé − poids récupéré (jamais négative). La matière séchée passe dans une nouvelle BIN « after drying » en conservant ses contributeurs (généalogie préservée).</div></div>' +
      '<div class="card"><h2>Opérations enregistrées <span class="badge b-neutral">' + ops.length + '</span></h2><div class="cbody" style="padding:0">' +
        (rows ? '<div class="tablewrap" style="border:0"><table><thead><tr><th>SEC</th><th>Type</th><th>BIN</th><th>Envoyé</th><th>Récupéré</th><th>Perte</th><th>Humidité</th><th>Le</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">Aucune opération de séchage.</div>') +
      '</div></div></div>';
  };

  /* ---- SACS DE JUTE + COMPTE FOURNISSEUR --------------------------- */
  PAGES.sacs = function (r) {
    if (r.id) return supplierAccount(decodeURIComponent(r.id), r.sub || "profil");
    var suppliers = R.juteSuppliers();
    var totDot = 0, totSolde = 0;
    var rows = suppliers.map(function (s) {
      var b = s.balance; var key = s.lba || s.nom; totDot += b.dotation; totSolde += b.solde;
      return '<tr><td><a href="#sacs/' + encodeURIComponent(key) + '" style="font-weight:600">' + esc(s.nom) + '</a><br><span style="font-family:var(--fm);font-size:11px;color:var(--n500)">' + esc(s.lba || "") + '</span></td>' +
        '<td class="mono">' + b.dotation + '</td><td class="mono">' + b.retour + '</td><td class="mono">' + b.perte_approuvee + '</td>' +
        '<td class="mono"><b>' + b.solde + '</b></td>' +
        '<td><button class="btn ghost sm" onclick="__rcngo(\'sacs/' + encodeURIComponent(key) + '\')">Compte →</button></td></tr>';
    }).join("");
    var supOpts = suppliers.map(function (s, i) { return '<option value="' + i + '">' + esc(s.nom + " · " + (s.lba || "")) + '</option>'; }).join("");
    var debtOpts = R.TYPES_JUTE.map(function (t) { return '<option value="' + t.code + '">' + esc(t.label) + '</option>'; }).join("");
    var dispOpts = R.DISPOSITIONS_JUTE.map(function (t) { return '<option value="' + t.code + '">' + esc(t.label) + '</option>'; }).join("");
    var st = R.juteInternalStock();
    return '<div class="pagehead"><h1>Gestion des sacs de jute</h1><p>Deux registres distincts : la <b>dette du fournisseur</b> (dotation − retours − pertes approuvées) et la <b>disposition interne</b> des sacs retournés. Le rebagging est une consommation interne, pas une réduction de dette.</p></div>' +
      '<div class="kpis">' +
        kpi("Fournisseurs suivis", suppliers.length, "avec mouvement", "") +
        kpi("Sacs distribués", totDot, "cumul dotations", "") +
        kpi("Solde en circulation", totSolde, "sacs chez les fournisseurs", totSolde ? "warn" : "") +
        kpi("Retournés à classer", st.aClasser, "disposition interne", st.aClasser ? "warn" : "") +
      '</div>' +
      '<div class="grid2"><div class="card"><h2>Dette par fournisseur</h2><div class="cbody" style="padding:0">' +
        (rows ? '<div class="tablewrap" style="border:0"><table><thead><tr><th>Fournisseur</th><th>Dotation</th><th>Retour</th><th>Perte appr.</th><th>Solde</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">Aucun fournisseur.</div>') +
      '</div></div>' +
      '<div><div class="card" style="margin-bottom:16px"><h2>Mouvement · dette fournisseur</h2><div class="cbody">' +
        '<label>Fournisseur</label><select id="j_sup">' + supOpts + '</select>' +
        '<label>Type</label><select id="j_type">' + debtOpts + '</select>' +
        '<div class="row">' + inp("j_qty", "Nombre de sacs", "", "number") + inp("j_ref", "Référence", "", "text") + '</div>' +
        '<div class="actions"><button class="btn" onclick="RCNUI.juteMove()">Enregistrer</button></div>' +
      '</div></div>' +
      '<div class="card"><h2>Disposition interne (sacs retournés)</h2><div class="cbody">' +
        '<label>Catégorie</label><select id="jd_type">' + dispOpts + '</select>' +
        '<div class="row">' + inp("jd_qty", "Nombre de sacs", "", "number") + inp("jd_ref", "Réf. retour", "", "text") + '</div>' +
        '<div class="actions"><button class="btn ghost" onclick="RCNUI.juteDispose()">Classer</button></div>' +
      '</div></div></div></div>' +
      '<div class="card" style="margin-top:18px"><h2>Stock interne des sacs retournés</h2><div class="cbody"><div class="metrics" style="margin:0">' +
        '<div class="metric"><small>Utilisables</small><b>' + st.utilisable + '</b></div>' +
        '<div class="metric"><small>À réparer</small><b>' + st.a_reparer + '</b></div>' +
        '<div class="metric"><small>Réparés</small><b>' + st.repare + '</b></div>' +
        '<div class="metric"><small>Rebagging</small><b>' + st.rebaging + '</b><span>consommé</span></div>' +
        '<div class="metric"><small>Réformés</small><b>' + st.reforme + '</b></div>' +
        '<div class="metric"><small>Déchirés</small><b>' + st.dechire + '</b></div>' +
      '</div></div></div>';
  };

  // Compte fournisseur — 5 onglets (Profil, Livraisons, Traçabilité, Sacs, Financement).
  function supplierAccount(key, tab) {
    var sups = R.juteSuppliers();
    var sup = sups.filter(function (s) { return (s.lba || s.nom) === key; })[0];
    // Repli sur la base fournisseurs (référentiel) si aucun mouvement jute.
    if (!sup) { var ref = (R.referentials().fournisseurs || []).filter(function (f) { return f.lba === key || f.nom === key; })[0]; sup = ref ? { nom: ref.nom, lba: ref.lba } : { nom: key, lba: "" }; }
    var nom = sup.nom, lba = sup.lba || "";
    var recs = R.receptions().filter(function (r) { return r.fournisseur === nom; });
    var lots = R.lots().filter(function (l) { return l.fournisseur === nom; });
    var b = R.juteBalance(key);
    var volLivre = lots.reduce(function (a, l) { return a + (l.netInitial || 0); }, 0);
    var origines = {}; recs.forEach(function (r) { if (r.origine) origines[r.origine] = 1; });
    var TABS = [["profil", "Profil"], ["livraisons", "Livraisons"], ["tracabilite", "Traçabilité matière"], ["sacs", "Sacs de jute"], ["financement", "Financement"]];
    var tabbar = '<div class="stepper" style="margin:0 0 18px">' + TABS.map(function (t) {
      return '<a href="#sacs/' + encodeURIComponent(key) + '/' + t[0] + '" class="st ' + (tab === t[0] ? "cur" : "") + '" style="text-decoration:none">' + esc(t[1]) + '</a>';
    }).join("") + '</div>';
    var body = "";
    if (tab === "profil") {
      body = '<div class="metrics">' +
        '<div class="metric"><small>Code LBA</small><b style="font-size:16px">' + esc(lba || "—") + '</b></div>' +
        '<div class="metric"><small>Statut financement</small><b style="font-size:15px">À confirmer</b><span>financé / DIS</span></div>' +
        '<div class="metric"><small>Livraisons</small><b>' + recs.length + '</b></div>' +
        '<div class="metric big"><small>Volume livré</small><b>' + R.round2(volLivre) + '</b><span>kg (net)</span></div>' +
      '</div>' + field("Origines", Object.keys(origines).join(", ") || "—") + field("Coordonnées", "— (à compléter)") + field("Solde sacs", b.solde + " sacs en circulation");
    } else if (tab === "livraisons") {
      body = recs.length ? '<div class="tablewrap"><table><thead><tr><th>REC</th><th>Camion</th><th>Lot</th><th>Net</th><th>KOR</th><th>Humidité</th><th>NC</th></tr></thead><tbody>' +
        recs.map(function (r) { var f = r.finale || {}; return '<tr><td class="mono"><a href="#reception/' + r.id + '">' + esc(r.id) + '</a></td><td class="mono">' + esc(r.camion || "—") + '</td><td class="mono">' + esc(r.lotId || "—") + '</td><td class="mono">' + (r.dechargement ? R.kg(r.dechargement.net) : "—") + '</td><td class="mono">' + (f.korDisplay != null ? f.korDisplay.toFixed(2) : "—") + '</td><td>' + (f.humidity == null ? "—" : f.humidity + " %") + '</td><td>' + (f.nc == null ? "—" : f.nc) + '</td></tr>'; }).join("") + '</tbody></table></div>' : '<div class="empty">Aucune livraison enregistrée.</div>';
    } else if (tab === "tracabilite") {
      body = lots.length ? '<div class="tablewrap"><table><thead><tr><th>Lot (RCN)</th><th>KOR</th><th>BIN actuelle</th><th>Stock lot</th><th>Statut</th><th>Destinations</th></tr></thead><tbody>' +
        lots.map(function (l) { var kids = (l.children || []).map(function (c) { return c.type + ":" + c.ref; }).join(", "); return '<tr><td class="mono">' + esc(l.id) + '</td><td class="mono">' + (l.korDisplay != null ? l.korDisplay.toFixed(2) : "—") + '</td><td class="mono">' + esc(l.binId || "—") + '</td><td class="mono">' + R.round2(l.stock) + ' kg</td><td>' + badgeEtat(l.etat) + '</td><td style="font-size:11px;color:var(--n500)">' + esc(kids || "—") + '</td></tr>'; }).join("") + '</tbody></table></div>' : '<div class="empty">Aucun lot pour ce fournisseur.</div>';
    } else if (tab === "sacs") {
      var moves = R.juteMovementsFor(key);
      var tl = moves.length ? '<ul class="timeline">' + moves.map(function (m) { var t = (R.TYPES_JUTE.concat(R.DISPOSITIONS_JUTE)).filter(function (x) { return x.code === m.type; })[0] || {}; return '<li><span class="tl-t">' + R.fmtDateTime(m.at).split(" · ")[0] + '</span><span class="tl-b"><b>' + esc(t.label || m.type) + ' · ' + m.qty + ' sacs</b><span>' + esc(m.ledger || "") + (m.ref ? " · réf. " + esc(m.ref) : "") + " · " + esc(m.auteur || "") + '</span></span></li>'; }).join("") + '</ul>' : '<div class="empty">Aucun mouvement.</div>';
      body = '<div class="metrics">' +
        '<div class="metric"><small>Dotation</small><b>' + b.dotation + '</b></div>' +
        '<div class="metric"><small>Retours physiques</small><b>' + b.retour + '</b></div>' +
        '<div class="metric"><small>Pertes approuvées</small><b>' + b.perte_approuvee + '</b></div>' +
        '<div class="metric big"><small>Solde (dette)</small><b>' + b.solde + '</b><span>sacs chez le fournisseur</span></div>' +
      '</div><div class="card"><h2>Mouvements de dette</h2><div class="cbody">' + tl + '</div></div>';
    } else {
      // Valeur livrée = Σ (net du lot × prix d'achat FCFA/kg). Couverture = part valorisée.
      var valeur = 0, volValorise = 0;
      lots.forEach(function (l) { if (l.prixUnitaire != null && l.netInitial) { valeur += l.netInitial * l.prixUnitaire; volValorise += l.netInitial; } });
      var prixMoy = volValorise > 0 ? R.round2(valeur / volValorise) : null;
      var couvPct = volLivre > 0 ? Math.round(volValorise / volLivre * 100) : 0;
      var rowsFin = lots.map(function (l) {
        var val = (l.prixUnitaire != null && l.netInitial) ? l.netInitial * l.prixUnitaire : null;
        return '<tr><td class="mono">' + esc(l.id) + '</td><td class="mono">' + (l.netInitial == null ? "—" : R.kg(l.netInitial)) + '</td><td class="mono">' + (l.prixUnitaire == null ? "—" : R.round2(l.prixUnitaire)) + '</td><td class="mono">' + fcfa(val) + '</td></tr>';
      }).join("");
      body = '<div class="metrics"><div class="metric big"><small>Valeur livrée</small><b style="font-size:20px">' + fcfa(valeur) + '</b><span>' + (couvPct < 100 ? couvPct + " % du volume valorisé" : "volume entièrement valorisé") + '</span></div>' +
        '<div class="metric"><small>Volume livré</small><b>' + R.round2(volLivre) + '</b><span>kg (net)</span></div>' +
        '<div class="metric"><small>Prix moyen d\'achat</small><b>' + (prixMoy == null ? "—" : R.round2(prixMoy)) + '</b><span>FCFA/kg</span></div>' +
        '<div class="metric"><small>Avances</small><b>—</b><span>module Procurement</span></div></div>' +
        '<div class="card" style="margin-top:14px"><h2>Valorisation des lots</h2><div class="cbody" style="padding:0">' +
        (rowsFin ? '<div class="tablewrap" style="border:0"><table><thead><tr><th>Lot</th><th>Net</th><th>Prix FCFA/kg</th><th>Valeur</th></tr></thead><tbody>' + rowsFin + '</tbody></table></div>' : '<div class="empty">Aucun lot.</div>') +
        '</div></div>' +
        '<div class="rule" style="margin-top:14px"><b>Note.</b> La valeur livrée est calculée au prix d\'achat saisi à la libération du lot (§6). Les avances et limites de financement relèveront du module Procurement.</div>';
    }
    return '<div class="pagehead"><h1>' + esc(nom) + '</h1><p>Compte fournisseur · ' + esc(lba || "—") + '</p></div>' + tabbar + body +
      '<div class="actions" style="margin-top:18px"><button class="btn ghost" onclick="__rcngo(\'sacs\')">← Tous les fournisseurs</button></div>';
  }

  /* ---- TRANSFERT (slide 10) --------------------------------------- */
  PAGES.transfert = function (r) {
    if (r.id) return transfertDetail(r.id);
    var trs = R.transfers();
    var body = trs.length ? '<div class="tablewrap"><table><thead><tr><th>TRF</th><th>BIN source</th><th>Envoyé</th><th>Reçu</th><th>Écart</th><th>Statut</th><th></th></tr></thead><tbody>' +
      trs.map(function (x) {
        return '<tr><td class="mono">' + esc(x.id) + '</td><td class="mono">' + esc(x.binId) + '</td><td class="mono">' + R.kg(x.poidsEnvoye) + '</td><td class="mono">' + (x.poidsRecu == null ? "—" : R.kg(x.poidsRecu)) + '</td><td class="mono">' + (x.ecart == null ? "—" : R.kg(x.ecart)) + '</td><td>' + badgeEtat(x.etat) + '</td>' +
          '<td><button class="btn ghost sm" onclick="__rcngo(\'transfert/' + x.id + '\')">Ouvrir</button></td></tr>';
      }).join("") + '</tbody></table></div>' : '<div class="empty">Aucun transfert. Créez-en un depuis un cycle de BIN.</div>';
    return '<div class="pagehead"><h1>Transferts</h1><p>Le transfert TRF transporte la matière et sa généalogie. C\'est le contrat de passage entre les modules.</p></div>' + body;
  };

  // Réception d'un transfert en ENTREPÔT : ouvre un dossier qui REPASSE par
  // sampling + GM (le stock inter-entrepôt est re-contrôlé à l'arrivée).
  function whReceiveForm(trf) {
    return '<p style="color:var(--n500);font-size:13px;margin:0 0 10px">Réception à ' + esc(trf.destinationSite || "l\'entrepôt") + ' : ouvre un dossier qui repasse par sampling + décision GM, puis déchargement en BIN.</p>' +
      '<div class="row">' + inp("wh_net", "Poids net reçu (kg)", "", "number") + inp("wh_sacs", "Sacs reçus", "", "number") + '</div>' +
      '<div class="row3">' + inp("wh_kor", "KOR arrivée (info)", "", "number") + inp("wh_hum", "Humidité arrivée (%)", "", "number") + inp("wh_nc", "Nut Count arrivée", "", "number") + '</div>' +
      '<div class="actions"><button class="btn" onclick="RCNUI.receiveWh(\'' + trf.id + '\')">Réceptionner → sampling à l\'arrivée</button></div>';
  }

  // Montant en FCFA (séparateur de milliers, arrondi entier).
  function fcfa(v) { return v == null ? "—" : Math.round(v).toLocaleString("fr-FR") + " FCFA"; }

  // Carte « Finance du transfert » (§6) : valorisation au prix moyen pondéré,
  // tolérance de transit, perte tolérée / pénalisable et pénalité.
  function financeCard(trf) {
    var f = trf.finance; if (!f) return "";
    var noPrice = f.prixMoyen == null;
    var pen = f.penalite;
    var penClass = (pen != null && pen > 0) ? "alert" : "okbox";
    var lignes =
      '<div class="metrics" style="margin:0 0 6px">' +
        '<div class="metric"><small>Prix moyen pondéré</small><b style="font-size:16px">' + (noPrice ? "—" : R.round2(f.prixMoyen)) + '</b><span>FCFA/kg' + (f.couvertureKg ? " · " + R.kg(f.couvertureKg) + " valorisés" : "") + '</span></div>' +
        '<div class="metric"><small>Valeur envoyée</small><b style="font-size:15px">' + fcfa(f.valeurEnvoyee) + '</b><span>' + R.kg(trf.poidsEnvoye) + '</span></div>' +
        '<div class="metric"><small>Tolérance transit</small><b style="font-size:15px">' + f.tolerancePct + ' %</b><span>' + R.kg(f.toleranceKg) + ' tolérés</span></div>' +
        (f.pertePenalisable == null ? "" :
          '<div class="metric"><small>Perte tolérée / pénalisable</small><b style="font-size:15px">' + R.kg(f.perteTolerable) + ' / ' + R.kg(f.pertePenalisable) + '</b><span>sur ' + R.kg(Math.max(0, trf.ecart || 0)) + ' de perte</span></div>') +
      '</div>';
    var penBox = (f.pertePenalisable == null) ? '<p style="font-size:12.5px;color:var(--n500);margin:0">Pénalité calculée à la réception.</p>'
      : (noPrice ? '<div class="alert">Prix des lots non renseigné : pénalité non chiffrable. Saisir le prix d\'achat des lots contributeurs.</div>'
      : '<div class="' + penClass + '" style="margin:0"><b>Pénalité de transit : ' + fcfa(pen) + '</b> = ' + R.kg(f.pertePenalisable) + ' × ' + R.round2(f.prixMoyen) + ' FCFA/kg' + (pen > 0 ? "" : " (perte dans la tolérance, aucune pénalité)") + '</div>');
    return '<div class="card"><h2>Finance du transfert</h2><div class="cbody">' + lignes + penBox +
      '<div class="rule" style="margin-top:12px"><b>Règle (§6).</b> Perte de transit ≤ ' + f.tolerancePct + ' % : tolérée. Au-delà : pénalisable, valorisée au prix moyen pondéré des lots (pénalité = perte pénalisable × prix moyen).</div>' +
      '</div></div>';
  }

  function transfertDetail(id) {
    var trf = R.getTrf(id); if (!trf) return notFound(id);
    var v = trf.validations;
    var rows = trf.contributors.map(function (c) {
      return '<tr><td class="mono">' + esc(c.lotId) + '</td><td>' + bar(c.share) + '</td><td class="mono">' + R.kg(c.qty) + '</td><td>' + badgeEtat(c.qualite) + '</td></tr>';
    }).join("");
    var toWh = trf.destinationType === "warehouse";
    var step3 = toWh ? ("Réception " + (trf.destinationSite || "entrepôt").split(" ")[0]) : "Calibrage";
    var valStep = '<div class="stepper" style="margin-top:6px">' +
      '<div class="st ' + (v.entrepot ? "done" : "cur") + '"><i>' + (v.entrepot ? "✓" : "1") + '</i>Départ</div>' +
      '<div class="st ' + (v.qa && v.qa.ok ? "done" : (v.entrepot ? "cur" : "")) + '"><i>' + (v.qa && v.qa.ok ? "✓" : "2") + '</i>QA / Lab</div>' +
      '<div class="st ' + (v.calibrage ? "done" : "") + '"><i>' + (v.calibrage ? "✓" : "3") + '</i>' + esc(step3) + '</div></div>';
    var action = "";
    if (trf.etat === R.ETAT_TRF.PREPARE) action = '<button class="btn" onclick="RCNUI.qaApprove(\'' + id + '\')">Contrôle QA / Lab → approuver</button>';
    else if (trf.etat === R.ETAT_TRF.CONTROLE) action = '<button class="btn" onclick="RCNUI.ship(\'' + id + '\')">Expédier vers ' + (toWh ? esc(trf.destinationSite || "l\'entrepôt") : "le calibrage") + '</button>';
    else if (trf.etat === R.ETAT_TRF.ECART && !toWh) action = '<div class="alert">Écart de ' + R.kg(trf.ecart) + ' à justifier.</div><label>Justification</label><input id="trf_motif" placeholder="Cause de l\'écart"><div class="actions"><button class="btn warn" onclick="RCNUI.resolveEcart(\'' + id + '\')">Valider l\'écart</button></div>';
    else if (toWh && [R.ETAT_TRF.EXPEDIE, R.ETAT_TRF.PARTIEL].indexOf(trf.etat) >= 0) action = whReceiveForm(trf);
    else if (!toWh && [R.ETAT_TRF.EXPEDIE, R.ETAT_TRF.PARTIEL].indexOf(trf.etat) >= 0) action = '<p style="color:var(--n500);font-size:13px;margin:0 0 8px">Réception côté calibrage.</p><button class="btn" onclick="__rcngo(\'calibrage\')">Aller au tableau de bord calibrage →</button>';
    else action = '<div class="okbox">Transfert ' + esc(trf.etat) + (toWh && trf.destinationSite ? " · reçu à " + esc(trf.destinationSite) : "") + '.</div>';
    var logi = (trf.transporteur || trf.voyage) ? '<div style="font-size:12.5px;color:var(--n500);margin:-8px 0 16px">Transporteur <b style="color:var(--ink)">' + esc(trf.transporteur || "—") + '</b> · voyage <b style="color:var(--ink)">' + esc(trf.voyage || "—") + '</b>' + (trf.chauffeur ? ' · chauffeur ' + esc(trf.chauffeur) : "") + (trf.camion ? ' · camion ' + esc(trf.camion) : "") + '</div>' : "";
    var destTxt = toWh ? ("Entrepôt " + esc(trf.destinationSite || "?") + " — chaque déchargement y crée un lot rangé en BIN, avec généalogie.") : "Calibrage (usine) — CAL hérite des contributeurs ; aucune origine ressaisie.";
    return '<div class="pagehead"><h1>Transfert ' + esc(trf.id) + ' → ' + (toWh ? "entrepôt" : "calibrage") + ' ' + badgeEtat(trf.etat) + '</h1><p>' + destTxt + '</p></div>' + logi +
      '<div class="metrics">' +
        '<div class="metric"><small>BIN source</small><b style="font-size:16px">' + esc(trf.binId) + '</b><span>' + esc(trf.cycleId) + '</span></div>' +
        '<div class="metric big"><small>Quantité envoyée</small><b>' + R.round2(trf.poidsEnvoye) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Reçu</small><b>' + (trf.poidsRecu == null ? "—" : R.round2(trf.poidsRecu)) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Perte de transit</small><b>' + (trf.transitLossPct == null ? "—" : trf.transitLossPct + " %") + '</b><span>' + (trf.ecart == null ? "envoyé vs reçu" : R.kg(trf.ecart)) + '</span></div>' +
      '</div>' +
      financeCard(trf) +
      '<div class="grid2"><div class="card"><h2>Contributeurs calculés automatiquement</h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Lot parent</th><th>Part BIN</th><th>Attribué au TRF</th><th>Qualité</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      '<div><div class="card"><h2>Triple validation</h2><div class="cbody">' + valStep + '<div style="margin-top:14px">' + action + '</div></div></div>' +
      '<div class="rule"><b>Règle métier.</b> Un contributeur non libéré bloque le contrôle QA. Tout écart envoyé/reçu passe le transfert en EN_ÉCART et exige une validation.</div>' +
      '</div></div>';
  }

  /* ================================================================== */
  /*  MODULE CALIBRAGE — 11 écrans (prototype fonctionnel)              */
  /* ================================================================== */
  function demoTag(x) { return (x && x.demo) ? ' <span class="badge b-warn" title="Scénario de démonstration">DÉMO</span>' : ''; }
  function qcCls(d) { return d === "conforme" ? "b-ok" : (d === "bloque" || d === "rejete" ? "b-danger" : (d ? "b-warn" : "b-neutral")); }
  function calAttendus() { return R.transfers().filter(function (t) { return t.destinationType !== "warehouse" && [R.ETAT_TRF.EXPEDIE, R.ETAT_TRF.CONTROLE, R.ETAT_TRF.PARTIEL].indexOf(t.etat) >= 0; }); }
  function calRecus() { return R.transfers().filter(function (t) { return t.destinationType !== "warehouse" && t.etat === R.ETAT_TRF.RECU; }); }
  function calActives() { return R.cals().filter(function (c) { return [R.ETAT_CAL.PREPARE, R.ETAT_CAL.PRET, R.ETAT_CAL.EN_COURS, R.ETAT_CAL.PARTIEL, R.ETAT_CAL.PAUSE].indexOf(c.etat) >= 0; }); }
  function today0() { return R.today(); }
  function isToday(iso) { return iso && String(iso).slice(0, 10).replace(/-/g, "") === today0(); }

  /* ---- ÉCRAN 1 · Vue d'ensemble ----------------------------------- */
  PAGES.calibrage = function () {
    var cals = R.cals();
    var attendus = calAttendus(), recusJour = calRecus().filter(function (t) { return isToday((t.recCal || {}).at || t.createdAt); });
    var prepa = cals.filter(function (c) { return [R.ETAT_CAL.PREPARE, R.ETAT_CAL.PRET].indexOf(c.etat) >= 0; });
    var enCours = cals.filter(function (c) { return [R.ETAT_CAL.EN_COURS, R.ETAT_CAL.PARTIEL].indexOf(c.etat) >= 0; });
    var pauses = cals.filter(function (c) { return c.etat === R.ETAT_CAL.PAUSE; });
    var termJour = cals.filter(function (c) { return c.etat === R.ETAT_CAL.CLOS && isToday(c.endedAt); });
    var recuJourKg = recusJour.reduce(function (a, t) { return a + (t.poidsRecu || 0); }, 0) + enCours.reduce(function (a, c) { return a + (c.recu || 0); }, 0);
    var calibreJourKg = enCours.concat(termJour).reduce(function (a, c) { return a + R.calBalance(c).sorties; }, 0);
    var resteKg = enCours.reduce(function (a, c) { return a + Math.max(0, (c.recu || 0) - R.calBalance(c).sorties - R.calBalance(c).pertes); }, 0);
    var ecartsNon = cals.filter(function (c) { var b = R.calBalance(c); return c.etat !== R.ETAT_CAL.CLOS && !b.dansTolerance; }).length;
    var qcEnAttente = 0; enCours.forEach(function (c) { c.outputs.forEach(function (o) { if (o.poids > 0 && !o.qc) qcEnAttente++; }); });
    var binsCal = R.binCycles().filter(function (c) { return c.calibre; });
    var binsProches = binsCal.filter(function (c) { return c.capaciteKg && R.binStock(c) >= c.capaciteKg * 0.85; }).length;
    var machines = {}; enCours.concat(pauses).forEach(function (c) { machines[c.machine] = c.etat === R.ETAT_CAL.PAUSE ? "arrêt" : "marche"; });
    // Visuel du flux : BIN brute → transfert → réception → calibreuse → 9 calibres → BIN de sortie.
    var flow = '<div class="cal-flow">' +
      ['🗄️ BIN brute', '🔁 Transfert', '⚖️ Réception', '⚙️ Calibreuse', '🎚️ 9 calibres', '📦 BIN de sortie']
        .map(function (s, i, a) { return '<span class="cal-step"><b>' + s.split(" ")[0] + '</b>' + esc(s.slice(s.indexOf(" ") + 1)) + '</span>' + (i < a.length - 1 ? '<span class="cal-arr">→</span>' : ''); }).join("") +
      '</div>';
    function q(t, v, s, cls) { return '<div class="kpi ' + (cls || "") + '"><small>' + esc(t) + '</small><b>' + v + '</b><span>' + esc(s) + '</span></div>'; }
    var machTxt = Object.keys(machines).length ? Object.keys(machines).map(function (m) { return m + " (" + machines[m] + ")"; }).join(", ") : "—";
    return '<div class="pagehead"><h1>Vue d\'ensemble du calibrage</h1><p>Trois questions : quelle matière attend d\'être calibrée, quelle matière est dans la machine, où se trouve la matière déjà calibrée.' + (cals.some(function (c) { return c.demo; }) ? ' <b>Comprend des données de démonstration (DÉMO).</b>' : '') + '</p></div>' +
      flow +
      '<div class="kpis">' +
        q("Transferts attendus", attendus.length, "à réceptionner", attendus.length ? "warn" : "") +
        q("Reçus aujourd'hui", recusJour.length, R.round2(recuJourKg) + " kg", "") +
        q("En préparation", prepa.length, "checklist / ouverture", "") +
        q("En cours", enCours.length, "dans la machine", "") +
      '</div>' +
      '<div class="kpis">' +
        q("En pause", pauses.length, "arrêt machine", pauses.length ? "warn" : "") +
        q("Terminées aujourd'hui", termJour.length, "clôturées", "") +
        q("Calibré aujourd'hui", R.round2(calibreJourKg), "kg", "") +
        q("Reste à traiter", R.round2(resteKg), "kg", resteKg ? "warn" : "") +
      '</div>' +
      '<div class="kpis">' +
        q("Écarts non expliqués", ecartsNon, "opérations", ecartsNon ? "danger" : "") +
        q("Contrôles qualité en attente", qcEnAttente, "sorties", qcEnAttente ? "warn" : "") +
        q("Machines", machTxt || "—", "marche / arrêt", "") +
        q("BIN de calibre", binsCal.length, binsProches + " proche(s) capacité", binsProches ? "warn" : "") +
      '</div>' +
      '<div class="grid2" style="align-items:start">' +
        '<div class="card"><h2>① Matière qui attend <span class="badge b-neutral">' + attendus.length + '</span></h2><div class="cbody" style="padding:0">' +
          '<table><thead><tr><th>Transfert</th><th>BIN source</th><th>Envoyé</th><th>Statut</th><th></th></tr></thead><tbody>' +
          (attendus.length ? attendus.map(function (t) { return '<tr><td class="mono">' + esc(t.id) + demoTag(t) + '</td><td class="mono">' + esc(t.binId) + '</td><td class="mono">' + R.kg(t.poidsEnvoye) + '</td><td>' + badgeEtat(t.etat) + '</td><td><button class="btn sm" onclick="__rcngo(\'calreception/' + t.id + '\')">Réceptionner</button></td></tr>'; }).join("") : '<tr><td colspan="5" class="empty">Aucun transfert attendu.</td></tr>') +
          '</tbody></table></div></div>' +
        '<div class="card"><h2>② Matière dans la machine <span class="badge b-neutral">' + enCours.concat(pauses).length + '</span></h2><div class="cbody" style="padding:0">' +
          '<table><thead><tr><th>Opération</th><th>Machine</th><th>Reçu</th><th>Statut</th><th></th></tr></thead><tbody>' +
          (enCours.concat(pauses).length ? enCours.concat(pauses).map(function (c) { return '<tr><td class="mono">' + esc(c.id) + demoTag(c) + '</td><td>' + esc(c.machine) + '</td><td class="mono">' + R.kg(c.recu) + '</td><td>' + badgeEtat(c.etat) + '</td><td><button class="btn ghost sm" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '\')">Ouvrir</button></td></tr>'; }).join("") : '<tr><td colspan="5" class="empty">Aucune opération en cours.</td></tr>') +
          '</tbody></table></div></div>' +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h2>③ Matière déjà calibrée — BIN de sortie <span class="badge b-neutral">' + binsCal.length + '</span></h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>BIN</th><th>Calibre</th><th>Stock</th><th>Capacité</th><th></th></tr></thead><tbody>' +
        (binsCal.length ? binsCal.slice(0, 12).map(function (c) { return '<tr><td class="mono">' + esc(c.binId) + '</td><td>' + esc(c.calibre || "—") + '</td><td class="mono">' + R.kg(R.binStock(c)) + '</td><td class="mono">' + (c.capaciteKg ? R.kg(c.capaciteKg) : "—") + '</td><td><button class="btn ghost sm" onclick="__rcngo(\'calbins/' + encodeURIComponent(c.binId) + '\')">Fiche</button></td></tr>'; }).join("") : '<tr><td colspan="5" class="empty">Aucune BIN de calibre.</td></tr>') +
        '</tbody></table></div></div>';
  };

  /* ---- ÉCRAN 2 · Transferts attendus ------------------------------ */
  PAGES.caltransferts = function () {
    var all = R.transfers().filter(function (t) { return t.destinationType !== "warehouse"; });
    var rows = all.length ? all.map(function (t) {
      var q = t.qualiteDepart || {};
      var sec = (q.humidity != null && q.humidity <= 10) ? "Sec" : (q.humidity != null ? "Humide" : "—");
      var lots = (t.contributors || []).length;
      var act = (t.etat === R.ETAT_TRF.RECU) ? '<span class="badge b-ok">reçu</span>' : '<button class="btn sm" onclick="__rcngo(\'calreception/' + t.id + '\')">Réceptionner</button>';
      return '<tr><td class="mono">' + esc(t.id) + demoTag(t) + '</td><td class="mono">' + esc(R.warehouseOf(t.binId)) + '</td><td class="mono">' + esc(t.binId) + '</td><td class="mono">' + lots + '</td>' +
        '<td class="mono">' + R.kg(t.poidsEnvoye) + '</td><td class="mono">' + ((t.recCal && t.recCal.sacsEnvoye != null) ? t.recCal.sacsEnvoye : "—") + '</td>' +
        '<td class="mono">' + (q.humidity == null ? "—" : q.humidity + " %") + '</td><td class="mono">' + (q.nc == null ? "—" : q.nc) + '</td><td>' + esc(sec) + '</td>' +
        '<td>' + badgeEtat(t.etat) + '</td><td>' + act + '</td></tr>';
    }).join("") : '<tr><td colspan="11" class="empty">Aucun transfert vers le calibrage.</td></tr>';
    return '<div class="pagehead"><h1>Transferts attendus</h1><p>Sorties autorisées de BIN de Yamoussoukro vers le calibrage. Une opération ne peut jamais démarrer sans un transfert reçu.</p></div>' +
      '<div class="card"><h2>Transferts vers le calibrage <span class="badge b-neutral">' + all.length + '</span></h2><div class="cbody" style="padding:0"><div class="tablewrap" style="border:0">' +
      '<table><thead><tr><th>Transfert</th><th>Entrepôt</th><th>BIN source</th><th>Lots</th><th>Envoyé</th><th>Sacs</th><th>Humidité</th><th>NC</th><th>Sec/Humide</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></div></div>' +
      '<div class="rule"><b>Statuts.</b> préparé · autorisé · en route interne · reçu partiellement · reçu · écart à expliquer · refusé · annulé. La liste des lots contributeurs reste attachée au transfert.</div>';
  };

  /* ---- ÉCRAN 3 · Réception au calibrage --------------------------- */
  PAGES.calreception = function (r) {
    if (r.id) return calReceptionForm(r.id);
    var att = calAttendus();
    var rows = att.length ? att.map(function (t) {
      return '<tr><td class="mono">' + esc(t.id) + demoTag(t) + '</td><td class="mono">' + esc(t.binId) + '</td><td class="mono">' + R.kg(t.poidsEnvoye) + '</td><td>' + badgeEtat(t.etat) + '</td><td><button class="btn sm" onclick="__rcngo(\'calreception/' + t.id + '\')">Réceptionner →</button></td></tr>';
    }).join("") : '<tr><td colspan="5" class="empty">Aucun transfert à réceptionner.</td></tr>';
    var tol = R.toleranceReceptionCal();
    return '<div class="pagehead"><h1>Réception au calibrage</h1><p>Rapprochement du poids et des sacs envoyés vs reçus. La différence n\'est jamais appelée « perte » automatiquement.</p></div>' +
      '<div class="card" style="margin-bottom:16px"><h2>À réceptionner <span class="badge b-neutral">' + att.length + '</span></h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Transfert</th><th>BIN source</th><th>Envoyé</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Tolérance de réception (Production & Qualité)</h2><div class="cbody">' +
        '<p style="margin:0 0 8px;color:var(--n500);font-size:13px">Au-delà de cette tolérance, un motif et un responsable sont exigés avant d\'ouvrir l\'opération. Non figée par l\'application.</p>' +
        '<label>Tolérance de différence de réception (%)</label><input id="rec_tol" type="number" step="0.1" value="' + (tol == null ? "" : tol) + '" placeholder="ex. 0,3">' +
        '<div class="actions"><button class="btn ghost sm" onclick="RCNUI.setTolRec()">Enregistrer la tolérance</button></div>' +
      '</div></div>';
  };
  function calReceptionForm(id) {
    var t = R.getTrf(id); if (!t) return notFound(id);
    var rc = t.recCal || {};
    var lots = (t.contributors || []).map(function (c) { var l = R.getLot(c.lotId) || {}; return '<tr><td class="mono">' + esc(c.lotId) + '</td><td>' + esc(l.fournisseur || "—") + '</td><td class="mono">' + (c.share == null ? "—" : c.share + " %") + '</td><td class="mono">' + R.kg(c.qty) + '</td></tr>'; }).join("");
    var done = t.etat === R.ETAT_TRF.RECU && rc.valide;
    return '<div class="pagehead"><h1>Réception ' + esc(t.id) + demoTag(t) + '</h1><p>BIN source ' + esc(t.binId) + ' · ' + (t.contributors || []).length + ' lot(s) contributeur(s). Rapprochez ce qui est réellement reçu.</p></div>' +
      '<div class="grid2" style="align-items:start"><div class="card"><h2>Rapprochement des poids & sacs</h2><div class="cbody">' +
        '<div class="metrics" style="margin:0 0 8px">' +
          '<div class="metric"><small>Poids envoyé</small><b>' + R.round2(t.poidsEnvoye) + '</b><span>kg</span></div>' +
          '<div class="metric"><small>Poids reçu</small><b>' + (t.poidsRecu == null ? "—" : R.round2(t.poidsRecu)) + '</b><span>kg</span></div>' +
          '<div class="metric"><small>Différence</small><b>' + (t.ecart == null ? "—" : R.round2(t.ecart)) + '</b><span>' + (t.transitLossPct == null ? "kg" : t.transitLossPct + " %") + '</span></div>' +
        '</div>' +
        (done ? '' :
        '<div class="row">' + inp("rc_recu", "Poids réellement reçu (kg)", rc.poidsRecu != null ? rc.poidsRecu : "", "number") + inp("rc_sacsE", "Sacs envoyés", rc.sacsEnvoye != null ? rc.sacsEnvoye : "", "number") + '</div>' +
        '<div class="row">' + inp("rc_sacsR", "Sacs reçus", rc.sacsRecu != null ? rc.sacsRecu : "", "number") + '<div><label>État des sacs</label><input id="rc_etat" value="' + esc(rc.etatSacs || "") + '" placeholder="Bon / humide / déchiré"></div></div>' +
        '<div class="row">' + inp("rc_hum", "Humidité (%)", rc.humidity != null ? rc.humidity : "", "number") + inp("rc_nc", "NC", rc.nc != null ? rc.nc : "", "number") + '</div>' +
        '<label>Commentaire</label><input id="rc_com" placeholder="ex. différence de pesée" value="' + esc(rc.commentaire || "") + '">' +
        '<div class="rule" style="margin:12px 0"><b>Écart hors tolérance :</b> motif + responsable obligatoires (bloque l\'ouverture).</div>' +
        '<div class="row">' + '<div><label>Motif (si écart)</label><input id="rc_motif" value="' + esc(rc.motif || "") + '" placeholder="pesée, sac manquant, renversement…"></div>' + '<div><label>Responsable</label><input id="rc_resp" value="' + esc(rc.responsable || "") + '" placeholder="Nom"></div></div>' +
        '<div class="actions"><button class="btn" onclick="RCNUI.receiveAtCal(\'' + t.id + '\')">Valider la réception</button></div>') +
        (done ? '<div class="okbox">Réception validée' + (rc.ecartKg ? ' · différence ' + R.kg(rc.ecartKg) + ' (' + rc.ecartPct + ' %) ' + (rc.horsTolerance ? 'justifiée : ' + esc(rc.motif) : 'dans la tolérance') : '') + '. <a href="#calops">Ouvrir une opération →</a></div>' : '') +
      '</div></div>' +
      '<div class="card"><h2>Lots contributeurs (attachés)</h2><div class="cbody" style="padding:0">' +
        (lots ? '<table><thead><tr><th>Lot</th><th>Fournisseur</th><th>Part</th><th>Attribué</th></tr></thead><tbody>' + lots + '</tbody></table>' : '<div class="empty">—</div>') +
      '</div></div></div>';
  }

  /* ---- ÉCRAN 4-6 · Opérations (liste, création, détail) ----------- */
  PAGES.calops = function (r) {
    if (r.id) return calOpDetail(r.id, r.sub);
    var cals = R.cals();
    var recus = calRecus().filter(function (t) { return t.recCalOk !== false; });
    var opts = recus.length ? recus.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.id) + ' · ' + esc(t.binId) + ' · ' + R.kg(t.poidsRecu != null ? t.poidsRecu : t.poidsEnvoye) + '</option>'; }).join("") : '<option value="">Aucun transfert reçu disponible</option>';
    var rows = cals.length ? cals.map(function (c) {
      var b = R.calBalance(c);
      return '<tr><td class="mono">' + esc(c.id) + demoTag(c) + '</td><td>' + esc(c.machine) + '</td><td>' + esc(c.shift) + '</td><td class="mono">' + R.kg(c.recu) + '</td><td class="mono">' + R.kg(b.sorties) + '</td><td>' + badgeEtat(c.etat) + '</td><td><button class="btn ghost sm" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '\')">Ouvrir</button></td></tr>';
    }).join("") : '<tr><td colspan="7" class="empty">Aucune opération.</td></tr>';
    return '<div class="pagehead"><h1>Opérations de calibrage</h1><p>Une opération naît uniquement d\'un transfert reçu. Numéro généré automatiquement (CAL-BATCH-AAAA-NNNN).</p></div>' +
      '<div class="grid2" style="align-items:start"><div class="card"><h2>Opérations <span class="badge b-neutral">' + cals.length + '</span></h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Opération</th><th>Machine</th><th>Shift</th><th>Reçu</th><th>Calibré</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Nouvelle opération</h2><div class="cbody">' +
        '<label>Transfert reçu (BIN de Yamoussoukro)</label><select id="op_trf">' + opts + '</select>' +
        '<div class="row">' + '<div><label>Machine / ligne</label><input id="op_mach" value="Calibreuse 01"></div>' + '<div><label>Shift</label><input id="op_shift" value="Jour"></div></div>' +
        '<div class="row">' + '<div><label>Opérateurs</label><input id="op_ops" placeholder="Noms"></div>' + '<div><label>Responsable production</label><input id="op_resp" placeholder="Nom"></div></div>' +
        '<label><input type="checkbox" id="op_melange" style="width:auto;margin-right:6px">Autoriser le mélange de plusieurs BIN (motif requis)</label>' +
        '<input id="op_melmotif" placeholder="Motif du mélange (si coché)">' +
        '<div class="actions"><button class="btn" onclick="RCNUI.createCalOp()" ' + (recus.length ? "" : "disabled") + '>Créer l\'opération</button></div>' +
        '<small style="color:var(--n500)">Mélange de BIN interdit par défaut : autorisé seulement avec motif et traçabilité.</small>' +
      '</div></div></div>';
  };
  function calSubnav(id, sub) {
    var tabs = [["", "Opérateur"], ["checklist", "Checklist"], ["sorties", "Sorties"], ["qualite", "Qualité"], ["rejets", "Rejets & restes"], ["bilan", "Bilan"], ["genealogie", "Généalogie"]];
    return '<div class="stepper" style="margin:0 0 16px;flex-wrap:wrap">' + tabs.map(function (t) {
      var h = "calops/" + encodeURIComponent(id) + (t[0] ? "/" + t[0] : "");
      return '<a href="#' + h + '" class="st ' + ((sub || "") === t[0] ? "cur" : "") + '" style="text-decoration:none">' + esc(t[1]) + '</a>';
    }).join("") + '</div>';
  }
  function calOpDetail(id, sub) {
    var c = R.getCal(id); if (!c) return notFound(id);
    var head = '<div class="pagehead"><h1>' + esc(c.id) + demoTag(c) + ' ' + badgeEtat(c.etat) + '</h1><p>Machine ' + esc(c.machine) + ' · Shift ' + esc(c.shift) + ' · reçu ' + R.kg(c.recu) + ' depuis ' + esc(c.trfId) + '.</p></div>' + calSubnav(id, sub);
    if (sub === "checklist") return head + calChecklistView(c);
    if (sub === "sorties") return head + calSortiesView(c);
    if (sub === "qualite") return head + calQCView(c);
    if (sub === "rejets") return head + calRejetsView(c);
    if (sub === "bilan") return head + calBilanView(c);
    if (sub === "genealogie") return head + calGenealogieView(c);
    return head + calOperatorView(c);
  }
  // Écran 6 · Interface opérateur (grand, tablette).
  function calOperatorView(c) {
    var b = R.calBalance(c);
    var reste = R.round2(c.recu - b.sorties - b.pertes);
    var open = c.stops.filter(function (s) { return !s.endAt; })[0];
    var running = c.etat === R.ETAT_CAL.EN_COURS || c.etat === R.ETAT_CAL.PARTIEL;
    var ctrls = '';
    if (c.etat === R.ETAT_CAL.PREPARE) ctrls = '<button class="btn big" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '/checklist\')">Checklist avant démarrage →</button>';
    else if (c.etat === R.ETAT_CAL.PRET) ctrls = '<button class="btn big" onclick="RCNUI.calStart(\'' + c.id + '\')">▶ Démarrer</button>';
    else if (c.etat === R.ETAT_CAL.PAUSE) ctrls = '<button class="btn big" onclick="RCNUI.calResume(\'' + c.id + '\')">▶ Reprendre</button>';
    else if (running) ctrls = '<button class="btn big warn" onclick="RCNUI.calStopPrompt(\'' + c.id + '\')">⏸ Déclarer un arrêt</button><button class="btn big" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '/sorties\')">Saisir les sorties →</button>';
    return '<div class="cal-op">' +
      '<div class="cal-op-metrics">' +
        '<div><small>Poids prévu</small><b>' + R.round2(c.prevu) + '</b><span>kg</span></div>' +
        '<div><small>Chargé (machine)</small><b>' + R.round2(c.entreeMachine || c.recu) + '</b><span>kg</span></div>' +
        '<div><small>Déjà traité</small><b>' + b.sorties + '</b><span>kg</span></div>' +
        '<div><small>Restant</small><b>' + Math.max(0, reste) + '</b><span>kg</span></div>' +
        '<div><small>Marche</small><b>' + Math.floor(b.marcheMin / 60) + 'h' + pad2(b.marcheMin % 60) + '</b><span>fonctionnement</span></div>' +
        '<div><small>Arrêts</small><b>' + b.arretMin + '</b><span>min</span></div>' +
      '</div>' +
      (open ? '<div class="alert" style="margin:12px 0">⏸ En arrêt — motif : <b>' + esc(open.motif) + '</b>. Reprenez pour continuer.</div>' : '') +
      '<div class="cal-op-actions">' + ctrls + '</div>' +
      '</div>' +
      '<div class="rule"><b>Règle métier.</b> Le démarrage exige la checklist ; une pause/arrêt exige un motif ; la durée d\'arrêt est calculée automatiquement. On ne dépasse jamais le reçu.</div>';
  }
  // Écran 4 · Checklist avant démarrage.
  function calChecklistView(c) {
    var items = R.CAL_CHECKLIST.map(function (it) {
      var on = !!(c.checklist || {})[it.code];
      return '<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--n100);text-transform:none;font-size:14px;color:var(--ink);font-weight:500"><input type="checkbox" id="ck_' + it.code + '" ' + (on ? "checked" : "") + ' style="width:auto" ' + (c.etat === R.ETAT_CAL.CLOS ? "disabled" : "") + '>' + esc(it.label) + '</label>';
    }).join("");
    return '<div class="card"><h2>Contrôle avant démarrage — toutes obligatoires</h2><div class="cbody">' +
      items +
      '<div class="actions" style="margin-top:14px">' + (c.etat === R.ETAT_CAL.CLOS ? '<span class="badge b-ok">Opération clôturée</span>' :
        '<button class="btn" onclick="RCNUI.calChecklistSave(\'' + c.id + '\')">Enregistrer la checklist</button>' + (c.checklistOk ? '<button class="btn" onclick="RCNUI.calStart(\'' + c.id + '\')">▶ Démarrer</button>' : '<span class="badge b-warn">Compléter pour démarrer</span>')) + '</div>' +
      '</div></div>';
  }
  // Écran 7 · Saisie des neuf calibres.
  function calSortiesView(c) {
    var cals = R.referentials().calibres;
    var closed = c.etat === R.ETAT_CAL.CLOS;
    var rows = cals.map(function (cal) {
      var o = c.outputs.filter(function (x) { return x.calibre === cal; })[0] || {};
      return '<tr><td class="mono">' + esc(cal) + '</td>' +
        '<td><input id="o_poids_' + esc(cal) + '" type="number" style="padding:6px;width:90px" value="' + (o.poids == null ? "" : o.poids) + '" ' + (closed ? "disabled" : "") + '></td>' +
        '<td><input id="o_sacs_' + esc(cal) + '" type="number" style="padding:6px;width:70px" value="' + (o.sacs == null ? "" : o.sacs) + '" ' + (closed ? "disabled" : "") + '></td>' +
        '<td><input id="o_nc_' + esc(cal) + '" type="number" style="padding:6px;width:70px" value="' + (o.nc == null ? "" : o.nc) + '" ' + (closed ? "disabled" : "") + '></td>' +
        '<td><input id="o_bin_' + esc(cal) + '" type="text" style="padding:6px;width:120px" value="' + esc(o.binDest || "") + '" placeholder="YAK-CAL-BIN-…" ' + (closed ? "disabled" : "") + '></td>' +
        '<td>' + (o.poids != null ? '<span class="badge b-ok">' + (o.pctRecu != null ? "" : "") + R.round2(o.poids) + ' kg</span>' : '<span class="badge b-neutral">—</span>') + '</td>' +
        '<td>' + (o.qc ? '<span class="badge ' + qcCls(o.qc.decision) + '">' + esc(o.qc.decision) + '</span>' : '<span class="badge b-neutral">à contrôler</span>') + '</td></tr>';
    }).join("");
    return '<div class="card"><h2>Neuf sorties de calibre <span class="badge b-info">' + cals.length + ' calibres</span></h2><div class="cbody">' +
      '<p style="margin:0 0 8px;color:var(--n500);font-size:12.5px">Le NC de contrôle du calibrage est distinct du NC de sampling : il vérifie la sortie physique, il ne la remplace pas.</p>' +
      '<div class="tablewrap" style="border:0"><table><thead><tr><th>Calibre</th><th>Poids (kg)</th><th>Sacs</th><th>NC</th><th>BIN destination</th><th>Obtenu</th><th>Qualité</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (closed ? '' : '<div class="actions"><button class="btn" onclick="RCNUI.saveOutputs(\'' + c.id + '\')">Enregistrer les sorties</button><button class="btn ghost" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '/rejets\')">Rejets & restes →</button></div>') +
      '</div></div>';
  }
  // Écran 10 · Contrôle qualité des sorties.
  function calQCView(c) {
    var closed = c.etat === R.ETAT_CAL.CLOS;
    var outs = c.outputs.filter(function (o) { return o.poids > 0; });
    var rows = outs.length ? outs.map(function (o) {
      var qc = o.qc || {};
      var decSel = R.QC_DECISIONS.map(function (d) { return '<option value="' + d.code + '"' + (qc.decision === d.code ? " selected" : "") + '>' + esc(d.label) + '</option>'; }).join("");
      return '<tr><td class="mono">' + esc(o.calibre) + '<br><span style="font-size:10px;color:var(--n500)">' + R.kg(o.poids) + '</span></td>' +
        '<td><input id="qc_imp_' + esc(o.calibre) + '" type="number" step="0.1" style="padding:6px;width:70px" value="' + (qc.impuretes == null ? "" : qc.impuretes) + '" placeholder="%" ' + (closed ? "disabled" : "") + '></td>' +
        '<td><input id="qc_hum_' + esc(o.calibre) + '" type="number" step="0.1" style="padding:6px;width:70px" value="' + (qc.humidity == null ? "" : qc.humidity) + '" ' + (closed ? "disabled" : "") + '></td>' +
        '<td><input id="qc_nc_' + esc(o.calibre) + '" type="number" style="padding:6px;width:70px" value="' + (qc.nc == null ? "" : qc.nc) + '" ' + (closed ? "disabled" : "") + '></td>' +
        '<td><select id="qc_dec_' + esc(o.calibre) + '" style="padding:6px" ' + (closed ? "disabled" : "") + '>' + decSel + '</select></td>' +
        '<td>' + (qc.decision ? '<span class="badge ' + qcCls(qc.decision) + '">' + esc(qc.decision) + '</span>' : '<span class="badge b-neutral">—</span>') + '</td>' +
        (closed ? '' : '<td><button class="btn ghost sm" onclick="RCNUI.calQCSave(\'' + c.id + '\',\'' + esc(o.calibre) + '\')">Valider</button></td>') + '</tr>';
    }).join("") : '<tr><td colspan="7" class="empty">Aucune sortie pesée à contrôler.</td></tr>';
    return '<div class="card"><h2>Contrôle qualité des sorties</h2><div class="cbody"><div class="tablewrap" style="border:0">' +
      '<table><thead><tr><th>Calibre</th><th>Impuretés %</th><th>Humidité %</th><th>NC</th><th>Décision</th><th>Statut</th>' + (closed ? '' : '<th></th>') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="rule" style="margin-top:12px"><b>Décisions.</b> conforme · accepté avec réserve · à recalibrer · bloqué · rejeté. Une sortie bloquée ou rejetée ne peut pas passer à l\'étape suivante.</div>' +
      '</div></div>';
  }
  // Écran 8 · Rejets, résidus et restes.
  function calRejetsView(c) {
    var closed = c.etat === R.ETAT_CAL.CLOS;
    var rows = R.CATEGORIES_PERTE.map(function (cat) {
      var l = c.losses.filter(function (x) { return x.code === cat.code; })[0] || {};
      return '<tr><td>' + esc(cat.label) + '</td>' +
        '<td><input id="l_poids_' + cat.code + '" type="number" style="padding:6px;width:90px" value="' + (l.poids == null ? "" : l.poids) + '" ' + (closed ? "disabled" : "") + '></td>' +
        '<td><input id="l_dest_' + cat.code + '" type="text" style="padding:6px;width:130px" value="' + esc(l.destination || "") + '" placeholder="destination" ' + (closed ? "disabled" : "") + '></td>' +
        '<td><input id="l_com_' + cat.code + '" type="text" style="padding:6px;width:150px" value="' + esc(l.commentaire || "") + '" placeholder="commentaire" ' + (closed ? "disabled" : "") + '></td></tr>';
    }).join("");
    return '<div class="card"><h2>Rejets, résidus et restes</h2><div class="cbody">' +
      '<p style="margin:0 0 8px;color:var(--n500);font-size:12.5px">Ne jamais tout mettre dans une seule case « perte ». La perte inexpliquée est l\'écart du bilan (calculé).</p>' +
      '<div class="tablewrap" style="border:0"><table><thead><tr><th>Catégorie</th><th>Quantité (kg)</th><th>Destination</th><th>Commentaire</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (closed ? '' : '<div class="actions"><button class="btn" onclick="RCNUI.saveLosses(\'' + c.id + '\')">Enregistrer</button><button class="btn ghost" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '/bilan\')">Bilan matière →</button></div>') +
      '</div></div>';
  }
  // Écran 9 · Bilan matière + clôture.
  function calBilanView(c) {
    var b = R.calBalance(c);
    var col = b.equilibre || b.dansTolerance ? "vert" : "rouge";
    var etatEcart = (b.equilibre || b.dansTolerance) ? "okbox" : "alert";
    var blockers = R.calCloseBlockers(c);
    var tolTxt = b.tolerancePct == null ? "non définie" : b.tolerancePct + " % (" + R.kg(b.toleranceKg) + ")";
    var repRows = b.repartition.length ? b.repartition.map(function (o) {
      return '<tr><td class="mono">' + esc(o.calibre) + '</td><td class="mono">' + R.kg(o.poids) + '</td><td class="mono">' + (o.sacs == null ? "—" : o.sacs) + '</td><td>' + bar(o.pctSorties || 0) + '</td><td class="mono">' + (o.pctRecu == null ? "—" : o.pctRecu + " %") + '</td><td class="mono">' + esc(o.binDest || "—") + '</td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">Aucune sortie.</td></tr>';
    var lossRows = b.pertesDetail.filter(function (l) { return l.poids > 0; }).map(function (l) { return '<tr><td>' + esc(l.label) + '</td><td class="mono">' + R.kg(l.poids) + '</td></tr>'; }).join("") || '<tr><td colspan="2" class="empty">—</td></tr>';
    var closed = c.etat === R.ETAT_CAL.CLOS;
    return '<div class="metrics">' +
        '<div class="metric big"><small>Quantité reçue</small><b>' + b.recu + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Total sorties connues</small><b>' + b.connu + '</b><span>' + (b.recu ? R.round2(b.connu / b.recu * 100) + " %" : "kg") + '</span></div>' +
        '<div class="metric"><small>Écart inexpliqué</small><b>' + b.ecart + '</b><span>' + (b.taux == null ? "kg" : b.taux + " %") + '</span></div>' +
        '<div class="metric"><small>Débit</small><b>' + (b.kgH == null ? "—" : R.round2(b.kgH)) + '</b><span>kg/h</span></div>' +
      '</div>' +
      '<div class="balance">Reçu ' + b.recu + '  =  Σ calibres ' + b.sorties + '  +  rejets/restes ' + b.pertes + '  +  écart ' + b.ecart +
        '<small>Total des sorties connues ' + b.connu + ' · tolérance ' + esc(tolTxt) + '</small></div>' +
      '<div class="' + etatEcart + '">' + (b.equilibre ? "Bilan exact (écart 0)." : (b.dansTolerance ? "Écart de " + R.kg(b.ecart) + " (" + (b.taux != null ? b.taux + " %" : "—") + ") — dans la tolérance." : "Écart de " + R.kg(b.ecart) + " (" + (b.taux != null ? b.taux + " %" : "—") + ") — à expliquer avant clôture.")) + '</div>' +
      '<div class="grid2" style="align-items:start"><div class="card"><h2>Répartition par calibre</h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Calibre</th><th>Poids</th><th>Sacs</th><th>Part sorties</th><th>% reçu</th><th>BIN</th></tr></thead><tbody>' + repRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Rejets, résidus & restes</h2><div class="cbody" style="padding:0"><table><thead><tr><th>Catégorie</th><th>Poids</th></tr></thead><tbody>' + lossRows + '</tbody></table></div></div></div>' +
      '<div class="grid2" style="align-items:start;margin-top:16px"><div class="card"><h2>Tolérance de bilan (Production & Qualité)</h2><div class="cbody">' +
        '<label>Tolérance d\'écart (%)</label><input id="cal_tol" type="number" step="0.1" value="' + (b.tolerancePct == null ? "" : b.tolerancePct) + '" placeholder="ex. 0,5">' +
        '<div class="actions"><button class="btn ghost sm" onclick="RCNUI.setTolCal()">Enregistrer la tolérance</button></div>' +
      '</div></div>' +
      '<div class="card"><h2>Validation & clôture</h2><div class="cbody">' +
        (blockers.length && !closed ? '<div class="alert" style="margin-top:0"><b>Clôture bloquée :</b><ul style="margin:6px 0 0;padding-left:18px">' + blockers.slice(0, 6).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul></div>' : '') +
        (closed ? '<div class="okbox">Opération clôturée le ' + R.fmtDateTime(c.endedAt) + (c.validation && c.validation.responsable ? ' · validée par ' + esc(c.validation.responsable) : '') + '. Valeurs verrouillées (§audit).</div>' :
        '<label>Commentaire / justification (si écart)</label><textarea id="cal_motif" rows="2"></textarea>' +
        '<label>Responsable de la validation</label><input id="cal_resp" placeholder="Nom">' +
        '<div class="actions"><button class="btn" onclick="RCNUI.calClose(\'' + c.id + '\')" ' + (blockers.length && b.dansTolerance ? "" : "") + '>Valider & clôturer</button>' +
        '<button class="btn ghost" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '/genealogie\')">Généalogie →</button></div>') +
      '</div></div></div>';
  }
  function calGenealogieView(c) {
    var g = R.genealogy(c.id);
    var rows = g.contributors.map(function (x) {
      var l = R.getLot(x.lotId) || {};
      return '<tr><td class="mono">' + esc(x.lotId) + '</td><td>' + esc(l.fournisseur || "—") + '</td><td>' + esc(l.origine || "—") + '</td><td class="mono">' + (x.share == null ? "—" : x.share + " %") + '</td><td class="mono">' + R.kg(x.qty) + '</td><td class="mono">' + (l.korDisplay != null ? l.korDisplay.toFixed(2) : "—") + '</td></tr>';
    }).join("");
    return '<div class="stepper" style="margin-bottom:16px;flex-wrap:wrap">' +
        '<div class="st done"><i>✓</i>' + esc(g.cal.id) + '</div><div class="st done"><i>✓</i>' + esc(g.trf ? g.trf.id : "TRF") + '</div>' +
        '<div class="st done"><i>✓</i>' + esc(c.binId || "BIN") + '</div><div class="st cur"><i>4</i>Lots & fournisseurs</div></div>' +
      '<div class="card"><h2>Lots contributeurs (contribution théorique)</h2><div class="cbody" style="padding:0">' +
        (rows ? '<table><thead><tr><th>Lot</th><th>Fournisseur</th><th>Origine</th><th>Part</th><th>Attribué</th><th>KOR</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="empty">Aucun contributeur.</div>') +
      '</div></div>' +
      '<div class="rule"><b>Mélange.</b> Les contributions sont théoriques : après mélange, on ne peut pas affirmer qu\'une noix précise appartient encore physiquement à un fournisseur.</div>';
  }

  /* ---- ÉCRAN 5 · Saisie des sorties (choisir une opération) -------- */
  PAGES.calsorties = function () {
    var ops = calActives();
    var rows = ops.length ? ops.map(function (c) {
      var b = R.calBalance(c);
      return '<tr><td class="mono">' + esc(c.id) + demoTag(c) + '</td><td>' + esc(c.machine) + '</td><td class="mono">' + R.kg(b.sorties) + ' / ' + R.kg(c.recu) + '</td><td>' + badgeEtat(c.etat) + '</td><td><button class="btn sm" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '/sorties\')">Saisir les sorties →</button></td></tr>';
    }).join("") : '<tr><td colspan="5" class="empty">Aucune opération active. Ouvrez-en une depuis « Opérations de calibrage ».</td></tr>';
    return '<div class="pagehead"><h1>Saisie des sorties</h1><p>Choisissez l\'opération en cours pour saisir ses neuf calibres, rejets et restes.</p></div>' +
      '<div class="card"><h2>Opérations actives <span class="badge b-neutral">' + ops.length + '</span></h2><div class="cbody" style="padding:0">' +
      '<table><thead><tr><th>Opération</th><th>Machine</th><th>Calibré / reçu</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  };
  /* ---- ÉCRAN 6bis · Contrôle qualité (choisir une opération) ------- */
  PAGES.calqc = function () {
    var ops = R.cals().filter(function (c) { return c.outputs.some(function (o) { return o.poids > 0; }); });
    var rows = ops.length ? ops.map(function (c) {
      var tot = c.outputs.filter(function (o) { return o.poids > 0; }).length, done = c.outputs.filter(function (o) { return o.poids > 0 && o.qc; }).length;
      var bloque = c.outputs.filter(function (o) { return o.qc && (o.qc.decision === "bloque" || o.qc.decision === "rejete"); }).length;
      return '<tr><td class="mono">' + esc(c.id) + demoTag(c) + '</td><td>' + esc(c.machine) + '</td><td class="mono">' + done + ' / ' + tot + '</td><td>' + (bloque ? '<span class="badge b-danger">' + bloque + ' bloqué(s)</span>' : (done === tot ? '<span class="badge b-ok">complet</span>' : '<span class="badge b-warn">en attente</span>')) + '</td><td><button class="btn sm" onclick="__rcngo(\'calops/' + encodeURIComponent(c.id) + '/qualite\')">Contrôler →</button></td></tr>';
    }).join("") : '<tr><td colspan="5" class="empty">Aucune sortie à contrôler.</td></tr>';
    return '<div class="pagehead"><h1>Contrôle qualité des sorties</h1><p>Vérifier la conformité de chaque calibre. Une sortie bloquée ou rejetée ne passe pas à l\'étape suivante.</p></div>' +
      '<div class="card"><h2>Opérations à contrôler <span class="badge b-neutral">' + ops.length + '</span></h2><div class="cbody" style="padding:0">' +
      '<table><thead><tr><th>Opération</th><th>Machine</th><th>Contrôlés</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  };

  /* ---- ÉCRAN 11 · BIN de calibre (fiche + généalogie) ------------- */
  PAGES.calbins = function (r) {
    if (r.id) return calBinFiche(r.id);
    var bins = R.binCycles().filter(function (c) { return c.calibre; });
    var rows = bins.length ? bins.map(function (c) {
      var stock = R.binStock(c), dispo = c.capaciteKg != null ? R.round2(c.capaciteKg - stock) : null;
      var pleine = c.capaciteKg && stock >= c.capaciteKg * 0.99;
      var ops = (c.contributors || []).filter(function (x) { return x.calId; }).length;
      var h = R.binDurationH(c, Date.now()); var age = h == null ? "—" : (h >= 48 ? Math.round(h / 24) + " j" : h + " h");
      return '<tr><td class="mono">' + esc(c.binId) + demoTag(c) + '</td><td>' + esc(c.calibre || "—") + '</td><td class="mono">' + (c.capaciteKg ? R.kg(c.capaciteKg) : "—") + '</td><td class="mono">' + R.kg(stock) + '</td><td class="mono">' + (dispo == null ? "—" : R.kg(dispo)) + '</td><td>' + (pleine ? '<span class="badge b-warn">pleine</span>' : badgeEtat(c.etat)) + '</td><td class="mono">' + ops + '</td><td class="mono">' + age + '</td><td><button class="btn ghost sm" onclick="__rcngo(\'calbins/' + encodeURIComponent(c.binId) + '\')">Fiche</button></td></tr>';
    }).join("") : '<tr><td colspan="9" class="empty">Aucune BIN de calibre.</td></tr>';
    return '<div class="pagehead"><h1>BIN de calibre</h1><p>Une BIN peut recevoir plusieurs opérations, mais sa généalogie n\'est jamais perdue.</p></div>' +
      '<div class="card"><h2>BIN de sortie <span class="badge b-neutral">' + bins.length + '</span></h2><div class="cbody" style="padding:0"><div class="tablewrap" style="border:0">' +
      '<table><thead><tr><th>BIN</th><th>Calibre</th><th>Capacité</th><th>Quantité</th><th>Disponible</th><th>Statut</th><th>Opérations</th><th>Âge</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
  };
  function calBinFiche(binId) {
    var g = R.binCalGenealogy(binId); if (!g) return notFound(binId);
    var c = g.bin, stock = R.binStock(c);
    var opRows = g.ops.map(function (o) {
      var fs = (o.contributors || []).map(function (x) { var l = R.getLot(x.lotId) || {}; return l.fournisseur; }).filter(Boolean);
      return '<tr><td class="mono">' + esc(o.calId) + '</td><td class="mono">' + R.kg(o.entree) + '</td><td class="mono">' + esc(o.binBrute || "—") + '</td><td class="mono">' + esc(o.trf ? o.trf.id : "—") + '</td><td style="font-size:11px;color:var(--n500)">' + esc(fs.join(", ") || "—") + '</td></tr>';
    }).join("") || '<tr><td colspan="5" class="empty">—</td></tr>';
    return '<div class="pagehead"><h1>Fiche BIN ' + esc(c.binId) + demoTag(c) + '</h1><p>Calibre ' + esc(c.calibre || "—") + ' · ouverte le ' + R.fmtDateTime(c.openedAt) + '.</p></div>' +
      '<div class="metrics">' +
        '<div class="metric"><small>Calibre</small><b style="font-size:18px">' + esc(c.calibre || "—") + '</b></div>' +
        '<div class="metric"><small>Quantité</small><b>' + R.round2(stock) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Capacité</small><b>' + (c.capaciteKg ? R.round2(c.capaciteKg) : "—") + '</b><span>' + (c.capaciteKg ? "disponible " + R.kg(c.capaciteKg - stock) : "kg") + '</span></div>' +
        '<div class="metric"><small>Statut</small><b style="font-size:16px">' + esc(c.etat) + '</b></div>' +
      '</div>' +
      '<div class="card"><h2>Généalogie · opérations contributrices <span class="badge b-neutral">' + g.ops.length + '</span></h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Opération CAL</th><th>Entré</th><th>BIN brute</th><th>Transfert</th><th>Fournisseurs d\'origine</th></tr></thead><tbody>' + opRows + '</tbody></table></div></div>' +
      '<div class="rule"><b>Traçabilité conservée.</b> BIN de calibre → opérations CAL → transferts → BIN brutes → lots → fournisseurs (contribution théorique en cas de mélange).</div>';
  }

  /* ---- ÉCRAN 8bis · Arrêts & maintenance -------------------------- */
  PAGES.calstops = function () {
    var stops = [];
    R.cals().forEach(function (c) { (c.stops || []).forEach(function (s) { stops.push({ cal: c, s: s }); }); });
    stops.sort(function (a, b) { return new Date(b.s.startAt) - new Date(a.s.startAt); });
    var byMotif = {}; stops.forEach(function (x) { byMotif[x.s.motif] = (byMotif[x.s.motif] || 0) + (x.s.dureeMin || 0); });
    var rows = stops.length ? stops.map(function (x) {
      return '<tr><td class="mono">' + esc(x.cal.id) + demoTag(x.cal) + '</td><td>' + esc(x.cal.machine) + '</td><td>' + esc(x.s.motif) + '</td><td>' + R.fmtTime(x.s.startAt) + '</td><td>' + (x.s.endAt ? R.fmtTime(x.s.endAt) : '<span class="badge b-warn">en cours</span>') + '</td><td class="mono">' + (x.s.dureeMin == null ? "—" : x.s.dureeMin + " min") + '</td><td style="font-size:11px;color:var(--n500)">' + esc(x.s.commentaire || "") + '</td></tr>';
    }).join("") : '<tr><td colspan="7" class="empty">Aucun arrêt déclaré.</td></tr>';
    var motRows = Object.keys(byMotif).sort(function (a, b) { return byMotif[b] - byMotif[a]; }).map(function (m) { return '<tr><td>' + esc(m) + '</td><td class="mono">' + byMotif[m] + ' min</td></tr>'; }).join("") || '<tr><td colspan="2" class="empty">—</td></tr>';
    var totMin = stops.reduce(function (a, x) { return a + (x.s.dureeMin || 0); }, 0);
    return '<div class="pagehead"><h1>Arrêts & maintenance</h1><p>Chaque arrêt calcule automatiquement sa durée. Motifs normalisés pour le suivi de disponibilité.</p></div>' +
      '<div class="kpis">' + kpi("Arrêts", stops.length, "cumulés", "") + kpi("Durée totale", totMin, "minutes", totMin ? "warn" : "") + kpi("En cours", stops.filter(function (x) { return !x.s.endAt; }).length, "non clôturés", "") + kpi("Machines", Object.keys(R.cals().reduce(function (a, c) { a[c.machine] = 1; return a; }, {})).length, "suivies", "") + '</div>' +
      '<div class="grid2" style="align-items:start"><div class="card"><h2>Journal des arrêts <span class="badge b-neutral">' + stops.length + '</span></h2><div class="cbody" style="padding:0"><div class="tablewrap" style="border:0">' +
      '<table><thead><tr><th>Opération</th><th>Machine</th><th>Motif</th><th>Début</th><th>Fin</th><th>Durée</th><th>Commentaire</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>' +
      '<div class="card"><h2>Durée par motif</h2><div class="cbody" style="padding:0"><table><thead><tr><th>Motif</th><th>Durée</th></tr></thead><tbody>' + motRows + '</tbody></table></div></div></div>';
  };

  /* ---- ÉCRAN 12 · Traçabilité (deux sens) ------------------------- */
  PAGES.caltrace = function (r) {
    var q = r.id ? decodeURIComponent(r.id) : "";
    var res = "";
    if (q) {
      var cal = R.getCal(q);
      var binCyc = R.binCycles().filter(function (c) { return c.binId === q.toUpperCase(); })[0];
      var fr = (R.referentials().fournisseurs || []).filter(function (f) { return f.lba === q || f.nom.toLowerCase() === q.toLowerCase(); })[0];
      if (cal) { var g = R.genealogy(q);
        res = '<div class="card"><h2>Opération ' + esc(cal.id) + ' → amont</h2><div class="cbody" style="padding:0"><table><thead><tr><th>Lot</th><th>Fournisseur</th><th>Origine</th><th>Part</th></tr></thead><tbody>' + g.contributors.map(function (x) { var l = R.getLot(x.lotId) || {}; return '<tr><td class="mono">' + esc(x.lotId) + '</td><td>' + esc(l.fournisseur || "—") + '</td><td>' + esc(l.origine || "—") + '</td><td class="mono">' + (x.share == null ? "—" : x.share + " %") + '</td></tr>'; }).join("") + '</tbody></table></div></div>';
      } else if (binCyc && binCyc.calibre) { var bg = R.binCalGenealogy(q);
        res = '<div class="card"><h2>BIN de calibre ' + esc(q) + ' → amont</h2><div class="cbody" style="padding:0"><table><thead><tr><th>Opération</th><th>BIN brute</th><th>Transfert</th><th>Fournisseurs</th></tr></thead><tbody>' + bg.ops.map(function (o) { var fs = (o.contributors || []).map(function (x) { return (R.getLot(x.lotId) || {}).fournisseur; }).filter(Boolean); return '<tr><td class="mono">' + esc(o.calId) + '</td><td class="mono">' + esc(o.binBrute || "—") + '</td><td class="mono">' + esc(o.trf ? o.trf.id : "—") + '</td><td style="font-size:11px">' + esc(fs.join(", ")) + '</td></tr>'; }).join("") + '</tbody></table></div></div>';
      } else if (fr) { var sc = R.supplierCalibres(fr.lba);
        res = '<div class="card"><h2>Fournisseur ' + esc(fr.nom) + ' (' + esc(fr.lba) + ') → calibres</h2><div class="cbody" style="padding:0"><table><thead><tr><th>Calibre</th><th>Contribution théorique</th></tr></thead><tbody>' + (sc.length ? sc.map(function (x) { return '<tr><td class="mono">' + esc(x.calibre) + '</td><td class="mono">' + R.kg(x.poidsTheorique) + '</td></tr>'; }).join("") : '<tr><td colspan="2" class="empty">Aucune contribution au calibrage.</td></tr>') + '</tbody></table></div></div>';
      } else res = '<div class="alert">Aucun résultat pour « ' + esc(q) +' ». Essayez un identifiant CAL-BATCH, une BIN de calibre (YAK-CAL-BIN-…) ou un code/nom fournisseur.</div>';
    }
    return '<div class="pagehead"><h1>Traçabilité</h1><p>Recherche dans les deux sens : fournisseur → … → calibre, ou BIN de calibre → … → fournisseurs. En cas de mélange : contribution théorique.</p></div>' +
      '<div class="card" style="margin-bottom:16px"><div class="cbody">' +
        '<label>Identifiant à tracer (opération CAL, BIN de calibre, code ou nom fournisseur)</label>' +
        '<div class="row"><input id="trace_q" value="' + esc(q) + '" placeholder="CAL-BATCH-2026-0042 · YAK-CAL-BIN-001 · LBA-006-IMA"><div style="display:flex;align-items:end"><button class="btn" onclick="RCNUI.traceGo()">Rechercher</button></div></div>' +
        '<small style="color:var(--n500)">Exemples : <a href="#caltrace/CAL-BATCH-2026-0042">CAL-BATCH-2026-0042</a> · <a href="#caltrace/YAK-CAL-BIN-001">YAK-CAL-BIN-001</a></small>' +
      '</div></div>' + res;
  };

  /* ---- ÉCRAN 13 · Rapports ---------------------------------------- */
  PAGES.calrapports = function () {
    var cals = R.cals();
    var byCal = {}, totRecu = 0, totSorties = 0, totPertes = 0, totEcart = 0, totMarche = 0, totArret = 0;
    cals.forEach(function (c) { var b = R.calBalance(c); totRecu += b.recu; totSorties += b.sorties; totPertes += b.pertes; totEcart += b.ecart; totMarche += b.marcheMin; totArret += b.arretMin; (c.outputs || []).forEach(function (o) { if (o.poids > 0) byCal[o.calibre] = (byCal[o.calibre] || 0) + o.poids; }); });
    var sommeCal = Object.keys(byCal).reduce(function (a, k) { return a + byCal[k]; }, 0);
    var repRows = R.referentials().calibres.map(function (cal) { var p = byCal[cal] || 0; return '<tr><td class="mono">' + esc(cal) + '</td><td class="mono">' + R.kg(p) + '</td><td>' + bar(sommeCal ? R.round2(p / sommeCal * 100) : 0) + '</td><td class="mono">' + (sommeCal ? R.round2(p / sommeCal * 100) : 0) + ' %</td></tr>'; }).join("");
    var opRows = cals.length ? cals.map(function (c) { var b = R.calBalance(c); return '<tr><td class="mono"><a href="#calops/' + encodeURIComponent(c.id) + '/bilan">' + esc(c.id) + '</a>' + demoTag(c) + '</td><td>' + esc(c.machine) + '</td><td>' + esc(c.shift) + '</td><td class="mono">' + R.kg(b.recu) + '</td><td class="mono">' + R.kg(b.sorties) + '</td><td class="mono">' + b.ecart + (b.taux != null ? " (" + b.taux + "%)" : "") + '</td><td class="mono">' + (b.kgH == null ? "—" : R.round2(b.kgH)) + '</td><td>' + badgeEtat(c.etat) + '</td></tr>'; }).join("") : '<tr><td colspan="8" class="empty">Aucune opération.</td></tr>';
    var reports = ["Rapport journalier", "Répartition par calibre", "Bilan matière", "Traçabilité", "Performance machines", "Arrêts & motifs", "Qualité des sorties", "Stock BIN de calibre"];
    return '<div class="pagehead"><h1>Rapports de calibrage</h1><p>Comparer la qualité achetée au résultat industriel. Filtres : période, shift, machine, opération, BIN, lot, fournisseur, calibre.</p></div>' +
      '<div class="kpis">' +
        kpi("Reçu au calibrage", R.round2(totRecu), "kg cumulés", "") +
        kpi("Calibré", R.round2(totSorties), (totRecu ? R.round2(totSorties / totRecu * 100) + " % du reçu" : "kg"), "") +
        kpi("Rejets / restes", R.round2(totPertes), "kg", "") +
        kpi("Écart cumulé", R.round2(totEcart), (totRecu ? R.round2(totEcart / totRecu * 100) + " %" : "kg"), Math.abs(totEcart) > 0.001 ? "warn" : "") +
      '</div>' +
      '<div class="card" style="margin-bottom:16px"><h2>Rapport journalier</h2><div class="cbody"><div class="metrics" style="margin:0">' +
        '<div class="metric"><small>Reçu</small><b>' + R.round2(totRecu) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Calibré</small><b>' + R.round2(totSorties) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Rejets/restes</small><b>' + R.round2(totPertes) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Écart inexpliqué</small><b>' + R.round2(totEcart) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Marche / arrêt</small><b>' + Math.round(totMarche) + ' / ' + Math.round(totArret) + '</b><span>min</span></div>' +
      '</div></div></div>' +
      '<div class="grid2" style="align-items:start"><div class="card"><h2>Répartition par calibre (cumul)</h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Calibre</th><th>Poids</th><th>Part</th><th>%</th></tr></thead><tbody>' + repRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Détail des opérations <span class="badge b-neutral">' + cals.length + '</span></h2><div class="cbody" style="padding:0"><div class="tablewrap" style="border:0">' +
        '<table><thead><tr><th>CAL</th><th>Machine</th><th>Shift</th><th>Reçu</th><th>Calibré</th><th>Écart</th><th>kg/h</th><th>Statut</th></tr></thead><tbody>' + opRows + '</tbody></table></div></div></div></div>' +
      '<div class="rule" style="margin-top:16px"><b>Exports.</b> Les rapports ci-dessus (' + reports.join(", ") + ') sont disponibles à l\'écran. L\'export Excel/PDF sera activé quand la génération de fichier sera branchée — aucun bouton d\'export non fonctionnel n\'est affiché.</div>';
  };

  /* ---- ÉCRAN 14 · Journal d'audit (calibrage) --------------------- */
  PAGES.calaudit = function () {
    var log = R.auditLog().filter(function (a) { return /calibrage|CAL|sortie|arrêt|QC|correction|tolérance|réception calibrage/i.test((a.objet || "") + " " + (a.champ || "")); });
    var corrs = []; R.cals().forEach(function (c) { (c.corrections || []).forEach(function (x) { corrs.push({ cal: c, x: x }); }); });
    var corrRows = corrs.length ? corrs.map(function (o) { return '<tr><td class="mono">' + esc(o.cal.id) + '</td><td>' + esc(o.x.champ) + '</td><td>' + esc(String(o.x.avant)) + ' → <b>' + esc(String(o.x.apres)) + '</b></td><td>' + esc(o.x.auteur || "—") + '</td><td>' + esc(o.x.motif || "—") + '</td><td>' + esc(o.x.approbateur || "—") + '</td></tr>'; }).join("") : '<tr><td colspan="6" class="empty">Aucune correction après clôture.</td></tr>';
    var rows = log.length ? log.slice(0, 80).map(function (a) { return '<tr><td class="mono">' + R.fmtTime(a.at) + '</td><td class="mono">' + esc(a.objet) + '</td><td>' + esc(a.champ) + '</td><td>' + (a.avant == null ? '—' : esc(String(a.avant))) + ' → <b>' + esc(String(a.apres == null ? "—" : a.apres)) + '</b></td><td>' + esc(a.auteur || "—") + '</td><td>' + esc(a.motif || "") + '</td></tr>'; }).join("") : '<tr><td colspan="6" class="empty">Journal vide.</td></tr>';
    return '<div class="pagehead"><h1>Journal d\'audit — calibrage</h1><p>Après clôture, les valeurs importantes sont verrouillées. Toute correction conserve ancienne/nouvelle valeur, auteur, motif et approbateur.</p></div>' +
      '<div class="card" style="margin-bottom:16px"><h2>Corrections après clôture <span class="badge b-neutral">' + corrs.length + '</span></h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Opération</th><th>Champ</th><th>Ancien → Nouveau</th><th>Auteur</th><th>Motif</th><th>Approbateur</th></tr></thead><tbody>' + corrRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Journal des actions <span class="badge b-neutral">' + log.length + '</span></h2><div class="cbody" style="padding:0"><div class="tablewrap" style="border:0">' +
        '<table><thead><tr><th>Heure</th><th>Objet</th><th>Champ</th><th>Ancien → Nouveau</th><th>Auteur</th><th>Motif</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
  };

  /* ---- RAPPORTS (§14.1) ------------------------------------------- */
  function whOf(binId) { var i = binId.indexOf("-BIN-"); return i > 0 ? binId.slice(0, i) : binId; }
  function avg(arr) { arr = arr.filter(function (x) { return x != null; }); return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }
  PAGES.rapports = function () {
    var recs = R.receptions();
    var ETB = R.ETAT_BIN, ETT = R.ETAT_TRF, ETR = R.ETAT_REC;
    // Stock : total, humide (non séché), sec (BIN « after drying »), par entrepôt.
    var stockTotal = 0, stockHumide = 0, stockSec = 0, byWh = {};
    R.binCycles().filter(function (c) { return c.etat !== ETB.CLOS; }).forEach(function (c) {
      var s = R.binStock(c); stockTotal += s;
      if (/DRIED/i.test(c.binId)) stockSec += s; else stockHumide += s;
      var wh = whOf(c.binId); byWh[wh] = byWh[wh] || { bins: 0, stock: 0 }; byWh[wh].bins++; byWh[wh].stock += s;
    });
    // Transit : expédié non encore reçu. Écarts : transferts en écart + lots bloqués.
    var transfers = R.transfers();
    var enTransit = transfers.filter(function (t) { return [ETT.EXPEDIE, ETT.PARTIEL].indexOf(t.etat) >= 0; }).reduce(function (a, t) { return a + (t.poidsEnvoye - (t.poidsRecu || 0)); }, 0);
    var enEcart = transfers.filter(function (t) { return t.etat === ETT.ECART; });
    var ecartKg = enEcart.reduce(function (a, t) { return a + Math.abs(t.ecart || 0); }, 0);
    var bloques = recs.filter(function (r) { return r.etat === ETR.BLOQUE; }).length;
    // Qualité moyenne (lots libérés) + humidité moyenne (analyses finales).
    var korAvg = avg(R.lots().filter(function (l) { return l.etat === ETR.LIBERE; }).map(function (l) { return l.korFinal; }));
    var moisAvg = avg(recs.map(function (r) { return (r.finale || {}).humidity; }));
    // Sacs jute.
    var jSup = R.juteSuppliers();
    var jDist = jSup.reduce(function (a, s) { return a + s.balance.dotation; }, 0);
    var jSolde = jSup.reduce(function (a, s) { return a + s.balance.solde; }, 0);
    // Sorties par calibre.
    var byCalibre = {}; R.cals().forEach(function (c) { c.outputs.forEach(function (o) { byCalibre[o.calibre] = (byCalibre[o.calibre] || 0) + (o.poids || 0); }); });
    var calRows = Object.keys(byCalibre).length ? Object.keys(byCalibre).sort().map(function (k) { return '<tr><td class="mono">' + esc(k) + '</td><td class="mono">' + R.kg(byCalibre[k]) + '</td></tr>'; }).join("") : '<tr><td colspan="2" class="empty">Aucune sortie calibrée.</td></tr>';
    var whRows = Object.keys(byWh).sort().map(function (w) { return '<tr><td class="mono">' + esc(w) + '</td><td>' + byWh[w].bins + '</td><td class="mono">' + R.kg(byWh[w].stock) + '</td></tr>'; }).join("") || '<tr><td colspan="3" class="empty">Aucun stock.</td></tr>';
    var recRows = recs.slice().sort(function (a, b) { return new Date(b.arriveeAt) - new Date(a.arriveeAt); }).slice(0, 25).map(function (r) {
      var d = r.dechargement || {}, f = r.finale || {};
      return '<tr><td>' + R.fmtDateTime(r.arriveeAt) + '</td><td class="mono">' + esc(r.id) + '</td><td>' + esc(r.warehouse || r.site || "—") + '</td><td>' + esc(r.fournisseur || "—") + '</td><td class="mono">' + esc(r.camion || "—") + '</td><td class="mono">' + R.kg(d.net) + '</td><td class="mono">' + R.kg(d.poidsPaye) + '</td><td class="mono">' + (f.korDisplay == null ? "—" : f.korDisplay.toFixed(2)) + '</td><td>' + badgeEtat(r.etat) + '</td></tr>';
    }).join("") || '<tr><td colspan="9" class="empty">Aucune réception.</td></tr>';
    var now = Date.now();
    var activeCycles = R.binCycles().filter(function (c) { return c.etat !== ETB.CLOS; });
    var agingRows = activeCycles.slice().sort(function (a, b) { return new Date(a.openedAt) - new Date(b.openedAt); }).map(function (c) {
      var days = Math.floor((now - new Date(c.openedAt).getTime()) / 86400000), cls = days >= 90 ? "b-danger" : (days >= 60 ? "b-warn" : "b-ok");
      return '<tr><td class="mono">' + esc(c.binId) + '</td><td>' + esc(whOf(c.binId)) + '</td><td class="mono">' + R.kg(R.binStock(c)) + '</td><td><span class="badge ' + cls + '">' + days + ' jours</span></td><td>' + badgeEtat(c.etat) + '</td></tr>';
    }).join("") || '<tr><td colspan="5" class="empty">Aucune BIN active.</td></tr>';
    var lossRows = R.binCycles().filter(function (c) { return c.etat === ETB.CLOS; }).slice(0, 25).map(function (c) {
      return '<tr><td class="mono">' + esc(c.binId) + '</td><td class="mono">' + R.kg((R.binTotals(c) || {}).entree) + '</td><td class="mono">' + R.kg(c.perteKg) + '</td><td>' + (c.pertePct == null ? "—" : c.pertePct + " %") + '</td><td>' + esc(c.justification || "—") + '</td></tr>';
    }).join("") || '<tr><td colspan="5" class="empty">Aucune BIN clôturée.</td></tr>';
    var dryRows = R.dryings().slice().sort(function (a, b) { return new Date(b.createdAt || b.at) - new Date(a.createdAt || a.at); }).slice(0, 25).map(function (d) {
      return '<tr><td class="mono">' + esc(d.id) + '</td><td>' + esc(d.sourceBinId || d.sourceCycleId || "—") + '</td><td class="mono">' + R.kg(d.inputKg) + '</td><td class="mono">' + R.kg(d.outputKg) + '</td><td>' + (d.lossPct == null ? "—" : d.lossPct + " %") + '</td></tr>';
    }).join("") || '<tr><td colspan="5" class="empty">Aucun séchage enregistré.</td></tr>';
    var trfRows = transfers.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }).slice(0, 25).map(function (t) {
      return '<tr><td class="mono">' + esc(t.id) + '</td><td>' + esc(t.destination || t.destinationSite || "—") + '</td><td class="mono">' + R.kg(t.poidsEnvoye) + '</td><td class="mono">' + R.kg(t.poidsRecu) + '</td><td class="mono">' + R.kg(t.ecart) + '</td><td>' + badgeEtat(t.etat) + '</td></tr>';
    }).join("") || '<tr><td colspan="6" class="empty">Aucun transfert.</td></tr>';
    var oldBins = activeCycles.filter(function (c) { return now - new Date(c.openedAt).getTime() >= 90 * 86400000; }).length;
    var exceptions = bloques + enEcart.length + oldBins;
    return '<div class="pagehead"><h1>Pilotage du stock & de la qualité</h1><p>Vue globale : stock humide/sec, matière en transit, écarts non expliqués et qualité moyenne — par entrepôt.</p></div>' +
      '<div class="actions" style="margin:-10px 0 18px"><button class="btn" onclick="RCNUI.exportWarehouseReport()">⇩ Réceptions CSV</button><button class="btn ghost" onclick="RCNUI.exportControlReport()">⇩ Contrôles CSV</button><button class="btn ghost" onclick="window.print()">Imprimer / PDF</button></div>' +
      '<div class="kpis">' +
        kpi("Stock total", R.round2(stockTotal), "kg en cycles ouverts", "") +
        kpi("Stock humide", R.round2(stockHumide), "non séché", "") +
        kpi("Stock sec", R.round2(stockSec), "après séchage", "") +
        kpi("En transit", R.round2(enTransit), "expédié non reçu", enTransit ? "warn" : "") +
      '</div>' +
      '<div class="kpis">' +
        kpi("Lots bloqués", bloques, "écart KOR", bloques ? "danger" : "") +
        kpi("Transferts en écart", enEcart.length, R.kg(ecartKg) + " à justifier", enEcart.length ? "warn" : "") +
        kpi("KOR moyen", korAvg == null ? "—" : korAvg.toFixed(2), "lots libérés", "") +
        kpi("Humidité moyenne", moisAvg == null ? "—" : moisAvg.toFixed(1) + " %", "analyses finales", "") +
      '</div>' +
      '<div class="alert" style="margin-bottom:18px"><b>' + exceptions + ' exception(s) à traiter :</b> ' + bloques + ' lot(s) bloqué(s), ' + enEcart.length + ' transfert(s) en écart et ' + oldBins + ' BIN âgée(s) de 90 jours ou plus.</div>' +
      '<div class="grid2"><div class="card"><h2>Stock par entrepôt</h2><div class="cbody" style="padding:0"><table><thead><tr><th>Entrepôt</th><th>BIN actives</th><th>Stock</th></tr></thead><tbody>' + whRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Sorties par calibre (cumul)</h2><div class="cbody" style="padding:0"><table><thead><tr><th>Calibre</th><th>Poids</th></tr></thead><tbody>' + calRows + '</tbody></table></div></div></div>' +
      '<div class="card" style="margin-top:18px"><h2>Sacs de jute</h2><div class="cbody"><div class="metrics" style="margin:0">' +
        '<div class="metric"><small>Sacs distribués</small><b>' + jDist + '</b></div>' +
        '<div class="metric"><small>Solde en circulation</small><b>' + jSolde + '</b><span>chez les fournisseurs</span></div>' +
        '<div class="metric"><small>Fournisseurs suivis</small><b>' + jSup.length + '</b></div>' +
      '</div></div></div>' +
      '<div class="card" style="margin-top:18px"><h2>Rapport journalier des réceptions <span class="badge b-neutral">25 dernières</span></h2><div class="cbody" style="padding:0"><div class="tablewrap" style="border:0"><table><thead><tr><th>Arrivée</th><th>REC</th><th>Entrepôt</th><th>Fournisseur</th><th>Camion</th><th>Net physique</th><th>Poids payé</th><th>KOR final</th><th>Statut</th></tr></thead><tbody>' + recRows + '</tbody></table></div></div></div>' +
      '<div class="card" style="margin-top:18px"><h2>Âge des BIN actives</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>BIN</th><th>Entrepôt</th><th>Stock</th><th>Âge</th><th>Statut</th></tr></thead><tbody>' + agingRows + '</tbody></table></div></div></div>' +
      '<div class="grid2" style="margin-top:18px"><div class="card"><h2>Pertes à la clôture des BIN</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>BIN</th><th>Entré</th><th>Perte</th><th>%</th><th>Justification</th></tr></thead><tbody>' + lossRows + '</tbody></table></div></div></div><div class="card"><h2>Séchage · bilan avant/après</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>Opération</th><th>Source</th><th>Entré</th><th>Sorti</th><th>Perte</th></tr></thead><tbody>' + dryRows + '</tbody></table></div></div></div></div>' +
      '<div class="card" style="margin-top:18px"><h2>Rapprochement des transferts</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>TRF</th><th>Destination</th><th>Envoyé</th><th>Reçu</th><th>Écart</th><th>Statut</th></tr></thead><tbody>' + trfRows + '</tbody></table></div></div></div>';
  };

  /* ---- FOURNISSEURS : base LBA + création à code auto -------------- */
  PAGES.fournisseurs = function () {
    var sync = global.RCNSync, status = sync ? sync.status() : { hasSession: false };
    if (!status.hasSession) {
      return '<div class="pagehead"><h1>Base fournisseurs</h1><p>Référentiel Procurement protégé.</p></div>' +
        '<div class="card"><div class="cbody" style="padding:42px;text-align:center"><div style="font-size:42px">🔐</div><h2>Connexion obligatoire</h2>' +
        '<p style="color:var(--n500);max-width:520px;margin:8px auto">Les volumes, indicateurs qualité et historiques fournisseurs sont confidentiels. Connectez-vous avec un compte autorisé pour les consulter.</p></div></div>';
    }
    var base = sync.suppliers();
    if (base === null) {
      sync.loadSuppliers();
      return '<div class="pagehead"><h1>Base fournisseurs</h1><p>Chargement du référentiel sécurisé…</p></div><div class="card"><div class="empty">Synchronisation des fiches fournisseurs…</div></div>';
    }
    var actifs = base.filter(function (f) { return Number(f.nb_livraisons || 0) > 0; }).length;
    var volTotal = base.reduce(function (a, f) { return a + Number(f.volume_livre_kg || 0); }, 0);
    var lbaCount = base.filter(function (f) { return f.categorie === "LBA"; }).length;
    var last = base.reduce(function (m, f) { return !f.derniere_livraison ? m : (!m || f.derniere_livraison > m ? f.derniere_livraison : m); }, null);
    var rows = base.map(function (f) {
      var sites = (f.sites || []).join(", ") || "—";
      var search = [f.code, f.nom, f.categorie, sites].join(" ").toLowerCase();
      return '<tr class="supplier-row" data-search="' + esc(search) + '"><td class="mono"><b>' + esc(f.code) + '</b></td>' +
        '<td><a href="#sacs/' + encodeURIComponent(f.code) + '/profil"><b>' + esc(f.nom) + '</b></a><small style="display:block;color:var(--n500)">' + esc(sites) + '</small></td>' +
        '<td><span class="badge ' + (f.categorie === "LBA" ? "b-ok" : "b-neutral") + '">' + esc(f.categorie) + '</span></td>' +
        '<td class="mono">' + Number(f.nb_livraisons || 0).toLocaleString("fr-FR") + '</td>' +
        '<td class="mono">' + (Number(f.volume_livre_kg || 0) ? R.kg(Number(f.volume_livre_kg)) : "—") + '</td>' +
        '<td class="mono">' + (f.kor_moyen == null ? "—" : Number(f.kor_moyen).toFixed(2)) + '</td>' +
        '<td class="mono">' + (f.humidite_moyenne == null ? "—" : Number(f.humidite_moyenne).toFixed(1) + " %") + '</td>' +
        '<td class="mono">' + esc(f.derniere_livraison || "—") + '</td></tr>';
    }).join("");
    var apercu = R.nextLbaCode("", "LBA");
    return '<div class="pagehead"><h1>Base fournisseurs</h1><p>Référentiel central du Procurement, alimenté depuis le rapport consolidé 2026. Cliquez sur un fournisseur pour consulter sa traçabilité et sa balance de sacs.</p></div>' +
      '<div class="kpis">' +
        kpi("Fournisseurs", base.length, lbaCount + " partenaires LBA", "") +
        kpi("Fournisseurs actifs", actifs, "avec livraison enregistrée", "") +
        kpi("Volume livré", (volTotal / 1000000).toFixed(2), "millions de kg", "") +
        kpi("Dernière livraison", last || "—", "mise à jour du fichier source", "") +
      '</div>' +
      '<div class="card"><h2>Portefeuille fournisseurs <span class="badge b-ok">Accès protégé</span></h2><div class="cbody">' +
        '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><input style="max-width:420px" placeholder="Rechercher par nom, code, catégorie ou site…" oninput="RCNUI.filterSuppliers(this.value)">' +
        '<span id="supplier-count" class="badge b-neutral">' + base.length + ' résultat(s)</span></div>' +
        '<div class="tablewrap"><table><thead><tr><th>Code</th><th>Fournisseur / site</th><th>Type</th><th>Livraisons</th><th>Volume</th><th>KOR moy.</th><th>Humidité</th><th>Dernière livraison</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div></div>' +
      '<div class="grid2" style="align-items:start;margin-top:18px"><div class="card"><h2>Nouveau fournisseur</h2><div class="cbody">' +
        '<label>Nom de la coopérative / du fournisseur</label><input id="fo_nom" placeholder="ex. SCOOPS NOUVELLE ERE" oninput="RCNUI.previewLba()">' +
        '<label>Catégorie</label><select id="fo_prefix" onchange="RCNUI.previewLba()"><option value="LBA">LBA (partenaire financé)</option><option value="DIS">DIS (fournisseur direct)</option></select>' +
        '<div class="metric" style="margin:12px 0"><small>Code proposé</small><b id="fo_preview" style="font-size:18px" class="mono">' + esc(apercu) + '</b></div>' +
        '<div class="actions"><button class="btn" onclick="RCNUI.addFournisseur()">+ Créer dans la base centrale</button></div></div></div>' +
        '<div class="rule"><b>Lecture simple.</b> Les chiffres viennent du rapport consolidé. Une valeur absente reste « — » : elle n’est jamais transformée en zéro.</div></div>';
  };

  /* ---- CARTOGRAPHIE : qualité & volume par localité / région ------ */
  // Palette qualité (KOR) — du meilleur au plus faible.
  function korColor(kor) {
    if (kor == null) return "#9AA0A6";
    if (kor >= 48) return "#1B5E20";
    if (kor >= 46) return "#43A047";
    if (kor >= 44) return "#F9A825";
    return "#E53935";
  }
  function korTier(kor) {
    if (kor == null) return "—";
    if (kor >= 48) return "Excellent";
    if (kor >= 46) return "Bon";
    if (kor >= 44) return "Moyen";
    return "Faible";
  }
  PAGES.carte = function () {
    var G = global.RCN_GEO;
    var st = R.geoStats();
    if (!G) return '<div class="pagehead"><h1>Cartographie</h1></div><div class="empty">Référentiel géographique indisponible.</div>';
    var W = 560, H = 600, PAD = 26;
    function P(lon, lat) { return G.project(lon, lat, W, H, PAD); }
    var outline = G.outline.map(function (p, i) { var q = P(p[0], p[1]); return (i ? "L" : "M") + q.x + " " + q.y; }).join(" ") + " Z";
    var withGeo = st.parLocalite.filter(function (l) { return l.lat != null && l.lon != null && l.volumeKg > 0; });
    var maxVol = Math.max.apply(null, withGeo.map(function (l) { return l.volumeKg; }).concat([1]));
    function radius(v) { return 5 + 22 * Math.sqrt(v / maxVol); }
    // Bulles (grandes derrière), + étiquettes pour les plus gros volumes.
    var sorted = withGeo.slice().sort(function (a, b) { return b.volumeKg - a.volumeKg; });
    var bubbles = sorted.map(function (l) {
      var q = P(l.lon, l.lat), rr = radius(l.volumeKg);
      return '<circle cx="' + q.x + '" cy="' + q.y + '" r="' + rr.toFixed(1) + '" fill="' + korColor(l.korMoyen) + '" fill-opacity="0.68" stroke="#fff" stroke-width="1.2"><title>' + esc(l.ville + " (" + l.region + ") · " + R.kg(l.volumeKg) + " · KOR " + (l.korMoyen == null ? "—" : l.korMoyen.toFixed(2))) + '</title></circle>';
    }).join("");
    var labels = sorted.slice(0, 7).map(function (l) {
      var q = P(l.lon, l.lat), rr = radius(l.volumeKg);
      return '<text x="' + (q.x + rr + 3) + '" y="' + (q.y + 3.5) + '" font-size="11" font-weight="600" fill="#0F2A16" paint-order="stroke" stroke="#fff" stroke-width="2.6">' + esc(l.ville) + '</text>';
    }).join("");
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:520px;display:block;margin:auto" role="img" aria-label="Carte des achats par localité">' +
      '<path d="' + outline + '" fill="#EAF3EC" stroke="#B7CDBC" stroke-width="1.5" stroke-linejoin="round"/>' +
      bubbles + labels + '</svg>';
    var legend = '<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px;font-size:12px;color:var(--n500)">' +
      [["#1B5E20", "KOR ≥ 48 · Excellent"], ["#43A047", "46–48 · Bon"], ["#F9A825", "44–46 · Moyen"], ["#E53935", "< 44 · Faible"]].map(function (c) {
        return '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:11px;height:11px;border-radius:50%;background:' + c[0] + ';display:inline-block"></span>' + c[1] + '</span>';
      }).join("") + '<span style="width:100%;text-align:center;margin-top:2px">Taille du cercle ∝ volume acheté</span></div>';

    var best = st.parRegion.filter(function (r) { return r.korMoyen != null; }).slice().sort(function (a, b) { return b.korMoyen - a.korMoyen; })[0];
    var top = st.parRegion[0];
    var regRows = st.parRegion.length ? st.parRegion.map(function (r) {
      var pctV = st.totalVolume ? Math.round(r.volumeKg / st.totalVolume * 100) : 0;
      return '<tr><td><b>' + esc(r.region) + '</b><div style="font-size:11px;color:var(--n500)">' + esc(r.district) + '</div></td>' +
        '<td class="mono">' + R.kg(r.volumeKg) + '<div style="font-size:11px;color:var(--n500)">' + pctV + ' %</div></td>' +
        '<td><span class="badge" style="background:' + korColor(r.korMoyen) + '22;color:' + korColor(r.korMoyen) + '">' + (r.korMoyen == null ? "—" : r.korMoyen.toFixed(2)) + '</span><div style="font-size:11px;color:var(--n500)">' + korTier(r.korMoyen) + '</div></td>' +
        '<td class="mono">' + r.nbLocalites + '</td><td style="font-size:11px;color:var(--n500)">' + esc(r.villes.slice(0, 4).join(", ")) + (r.villes.length > 4 ? "…" : "") + '</td></tr>';
    }).join("") : '<tr><td colspan="5" class="empty">Aucun achat enregistré.</td></tr>';
    var locRows = st.parLocalite.length ? st.parLocalite.map(function (l) {
      return '<tr><td><b>' + esc(l.ville) + '</b></td><td>' + esc(l.region) + '</td><td class="mono">' + R.kg(l.volumeKg) + '</td>' +
        '<td><span class="badge" style="background:' + korColor(l.korMoyen) + '22;color:' + korColor(l.korMoyen) + '">' + (l.korMoyen == null ? "—" : l.korMoyen.toFixed(2)) + '</span></td>' +
        '<td class="mono">' + (l.humMoyen == null ? "—" : l.humMoyen.toFixed(1) + " %") + '</td><td class="mono">' + l.nbLots + '</td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">Aucun achat enregistré.</td></tr>';

    return '<div class="pagehead"><h1>Cartographie des achats</h1><p>Qualité (KOR) et volume par localité et par région de Côte d\'Ivoire — pour orienter les décisions d\'achat de la direction.</p></div>' +
      '<div class="kpis">' +
        kpi("Volume total acheté", R.round2(st.totalVolume), "kg (net)", "") +
        kpi("Localités actives", st.nbLocalitesActives, "sur " + R.localites().length + " référencées", "") +
        kpi("Région n°1 (volume)", top ? esc(top.region) : "—", top ? R.kg(top.volumeKg) : "", "") +
        kpi("Meilleure qualité", best ? esc(best.region) : "—", best ? "KOR " + best.korMoyen.toFixed(2) : "", "") +
      '</div>' +
      '<div class="grid2" style="align-items:start"><div class="card"><h2>Carte · qualité & volume</h2><div class="cbody">' + svg + legend + '</div></div>' +
      '<div class="card"><h2>Statistiques par région <span class="badge b-neutral">' + st.parRegion.length + '</span></h2><div class="cbody" style="padding:0">' +
        '<div class="tablewrap" style="border:0"><table><thead><tr><th>Région</th><th>Volume</th><th>KOR moyen</th><th>Localités</th><th>Principales</th></tr></thead><tbody>' + regRows + '</tbody></table></div>' +
      '</div></div></div>' +
      '<div class="card" style="margin-top:18px"><h2>Détail par localité <span class="badge b-neutral">' + st.parLocalite.length + '</span></h2><div class="cbody" style="padding:0">' +
        '<div class="tablewrap" style="border:0"><table><thead><tr><th>Localité</th><th>Région</th><th>Volume</th><th>KOR moyen</th><th>Humidité moy.</th><th>Lots</th></tr></thead><tbody>' + locRows + '</tbody></table></div>' +
      '</div></div>' +
      '<div class="rule" style="margin-top:16px"><b>Aide à la décision.</b> Le volume reflète les achats réels (hors mouvements inter-entrepôts). La couleur indique la qualité moyenne pondérée par le volume : la direction repère d\'un coup d\'œil les bassins à fort volume et/ou forte qualité.</div>';
  };

  /* ---- AUDIT (slide 15) ------------------------------------------- */
  PAGES.audit = function () {
    var log = R.auditLog();
    var rows = log.length ? log.slice(0, 60).map(function (a) {
      return '<tr><td class="mono">' + R.fmtTime(a.at) + '</td><td class="mono">' + esc(a.objet) + '</td><td>' + esc(a.champ) + '</td>' +
        '<td>' + (a.avant == null ? '<span style="color:var(--n300)">—</span>' : esc(String(a.avant))) + ' → <b>' + esc(String(a.apres == null ? "—" : a.apres)) + '</b></td>' +
        '<td>' + esc(a.auteur || "—") + '</td><td>' + esc(a.motif || "—") + '</td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">Journal vide.</td></tr>';
    return '<div class="pagehead"><h1>Journal d\'audit & synchronisation</h1><p>Même après une coupure, aucune saisie ni correction ne disparaît. L\'application doit pouvoir prouver chaque action.</p></div>' +
      '<div class="grid2 rev"><div><div class="card"><h2>Mode hors connexion</h2><div class="cbody">' +
        '<div id="offlineBox"></div>' +
        '<p style="font-size:13px;color:var(--n500);margin:10px 0 0">Les brouillons sont conservés sur cette tablette (localStorage) et synchronisés dès le retour du réseau. La reprise se fait sans doublon.</p>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Aucune donnée validée ne peut être remplacée silencieusement. Une correction conserve ancienne valeur, nouvelle valeur, motif, auteur et approbateur.</div></div>' +
      '<div class="card"><h2>Dernières modifications <span class="badge b-neutral">' + log.length + '</span></h2><div class="cbody" style="padding:0">' +
        '<div class="tablewrap" style="border:0"><table><thead><tr><th>Heure</th><th>Objet</th><th>Champ</th><th>Avant → Après</th><th>Auteur</th><th>Motif</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div></div></div>';
  };

  /* ---------------- Petits composants ------------------------------ */
  function field(lbl, val) { return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--n100);font-size:13px"><span style="color:var(--n500)">' + esc(lbl) + '</span><span style="font-weight:600;text-align:right">' + val + '</span></div>'; }
  function inp(id, lbl, v, type) { return '<div><label>' + esc(lbl) + '</label><input id="' + id + '" type="' + (type || "text") + '" value="' + (v == null ? "" : esc(v)) + '" placeholder="—"></div>'; }
  function timeline(events) {
    if (!events || !events.length) return '<div class="empty">Aucun événement.</div>';
    return '<ul class="timeline">' + events.slice().reverse().map(function (e) {
      return '<li><span class="tl-t">' + R.fmtTime(e.at) + '</span><span class="tl-b"><b>' + esc(e.label) + '</b><span>' + esc(e.auteur || "") + (e.qty != null ? " · " + R.kg(e.qty) : "") + '</span></span></li>';
    }).join("") + '</ul>';
  }
  function notFound(id) { return '<div class="alert">Objet introuvable : ' + esc(id) + '</div><button class="btn ghost" onclick="history.back()">← Retour</button>'; }

  /* ================================================================== */
  /*  ACTIONS (liaisons UI → moteur)                                   */
  /* ================================================================== */
  var UI = {};

  UI.toggleLang = function () { LANG = LANG === "fr" ? "en" : "fr"; localStorage.setItem("rcntrace.lang", LANG); route(); };
  UI.confirmReset = function () { if (confirm("Réinitialiser la démonstration ? Les données locales seront effacées et les exemples régénérés.")) { R.reset(); R.seedDemo(true); go("accueil"); route(); toast("Démonstration réinitialisée."); } };

  function pickedSupplier(id) { return (R.referentials().fournisseurs || [])[Number(val(id)) || 0] || {}; }
  UI.createProcEngagement = function () {
    try { var f = pickedSupplier("pe_supplier"); R.createProcEngagement({ supplierNom: f.nom, supplierLba: f.lba, campagne: val("pe_campaign"), type: val("pe_type"), volumeKg: val("pe_qty"), prixKg: val("pe_price"), korMin: val("pe_kor"), humiditeMax: val("pe_hum"), site: val("pe_site"), echeance: val("pe_due"), note: val("pe_note") }); toast("Engagement fournisseur créé."); route(); } catch (e) { toast(e.message, true); }
  };
  UI.createProcFin = function () {
    try { var f = pickedSupplier("pf_supplier"); R.createProcFinancement({ supplierNom: f.nom, supplierLba: f.lba, engagementId: val("pf_eng"), montant: val("pf_amount"), banque: val("pf_bank"), reference: val("pf_ref"), echeance: val("pf_due") }); toast("Financement soumis à approbation."); route(); } catch (e) { toast(e.message, true); }
  };
  UI.approveProcFin = function (id, ok) { var c = prompt(ok ? "Commentaire d’approbation (facultatif)" : "Motif du refus (obligatoire)", "") || ""; if (!ok && !c) return; try { R.approveProcFinancement(id, ok, c); toast(ok ? "Financement approuvé." : "Financement refusé."); route(); } catch (e) { toast(e.message, true); } };
  UI.createProcArrival = function () {
    try { var f = pickedSupplier("pa_supplier"), dt = val("pa_date"); R.createProcArrivage({ supplierNom: f.nom, supplierLba: f.lba, engagementId: val("pa_eng"), camion: val("pa_truck"), chauffeur: val("pa_driver"), telephone: val("pa_phone"), prevuAt: dt ? new Date(dt).toISOString() : null, volumeKg: val("pa_qty"), sacs: val("pa_bags"), site: val("pa_site") }); toast("Arrivée camion planifiée."); route(); } catch (e) { toast(e.message, true); }
  };
  UI.arriveProc = function (id) { if (!confirm("Confirmer que le camion est physiquement arrivé sur le site ?")) return; try { var rec = R.receptionFromProcArrivage(id); toast("Dossier " + rec.id + " créé sans ressaisie."); go("reception/" + rec.id); route(); } catch (e) { toast(e.message, true); } };

  UI.createReception = function () {
    try {
      var f = R.referentials().fournisseurs[Number(val("f_fournisseur")) || 0] || {};
      var rec = R.createReception({ camion: val("f_camion"), fournisseur: f.nom || "", lba: f.lba || "", origine: val("f_origine"), site: val("f_site"), arriveeAt: new Date(val("f_arrivee") || Date.now()).toISOString(), poidsAnnonce: val("f_poids"), sacsAnnonce: val("f_sacs"), refDoc: val("f_ref"), typeAchat: val("f_type"), commandeRef: val("f_po"), transporteur: val("f_transporteur"), chauffeur: val("f_chauffeur"), telephoneChauffeur: val("f_phone") });
      toast("Réception " + rec.id + " créée.");
      go("qualite/" + rec.id + "/sampling"); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.saveSampling = function (id, send) {
    try {
      R.saveSampling(id, { gk: val("s_gk"), imm: val("s_imm"), spotted: val("s_sp"), nc: val("s_nc"), humidity: val("s_hum"), browns: val("s_browns"), voids: val("s_voids"), oil: val("s_oil") });
      if (send) { R.submitToGm(id); toast("Sampling enregistré · envoyé au GM."); go("qualite/" + id + "/gm"); }
      else { toast("Sampling enregistré."); go("reception/" + id); }
      route();
    } catch (e) { toast(e.message, true); }
  };
  UI.gmDecision = function (id, ok) {
    try { R.gmDecision(id, ok, val("gm_comment"), val("gm_deleg")); toast(ok ? "Déchargement autorisé." : "Déchargement refusé."); go(ok ? "reception/" + id + "/dech" : "reception/" + id); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.saveDechargement = function (id) {
    try {
      R.saveDechargement(id, {
        whReceipt: val("d_wh"), ficheCca: val("d_fiche"), binDecharge: val("d_bin"), bordereau: val("d_bord"), ticket: val("d_ticket"),
        sacsBon: val("d_sacsBon"), sacsHumid: val("d_sacsHum"), sacsDechire: val("d_sacsDech"), sacsRecond: val("d_sacsRec"),
        brut: val("d_brut"), tare: val("d_tare"), net: val("d_net"), refraction: val("d_refraction"), poidsPaye: val("d_paye"), poidsMainDoeuvre: val("d_mo"), prestataire: val("d_prest"), debutAt: val("d_debut"), finAt: val("d_fin"), incident: val("d_incident")
      });
      toast("Déchargement enregistré."); go("qualite/" + id + "/finale"); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.addDocument = function (recId) {
    var input = el("doc_file"), file = input && input.files && input.files[0];
    if (!file) return toast("Choisissez une photo ou un PDF.", true);
    var reader = new FileReader();
    reader.onload = function () { try { R.addDocument({ objetId: recId, type: val("doc_type"), nom: file.name, mime: file.type, size: file.size, dataUrl: reader.result }); toast("Pièce jointe ajoutée et tracée."); route(); } catch (e) { toast(e.message, true); } };
    reader.onerror = function () { toast("Lecture du fichier impossible.", true); };
    reader.readAsDataURL(file);
  };
  UI.correctReception = function (recId) {
    var choices = "poidsAnnonce, sacsAnnonce, transporteur, chauffeur, dechargement.net, dechargement.refraction, dechargement.poidsPaye, dechargement.sacs";
    var champ = prompt("Champ à corriger :\n" + choices); if (!champ) return;
    var valeur = prompt("Nouvelle valeur :"); if (valeur === null) return;
    var motif = prompt("Motif précis de la correction :"); if (!motif) return;
    var approbateur = prompt("Nom de l'approbateur :"); if (!approbateur) return;
    try { R.correctReceptionField(recId, champ.trim(), valeur, motif, approbateur); toast("Correction enregistrée dans l'audit."); route(); } catch (e) { toast(e.message, true); }
  };
  UI.exportWarehouseReport = function () {
    try {
      var q = function (v) { v = v == null ? "" : String(v); return '"' + v.replace(/"/g, '""') + '"'; };
      var rows = [["Arrivée", "REC", "Entrepôt", "Type achat", "Fournisseur", "Code LBA", "Camion", "Transporteur", "Chauffeur", "Sacs", "Net physique kg", "Réfaction kg", "Poids payé kg", "KOR sampling", "KOR final", "Humidité finale %", "Statut"]];
      R.receptions().slice().sort(function (a, b) { return new Date(b.arriveeAt) - new Date(a.arriveeAt); }).forEach(function (r) {
        var d = r.dechargement || {}, s = r.sampling || {}, f = r.finale || {};
        rows.push([R.fmtDateTime(r.arriveeAt), r.id, r.warehouse || r.site, r.typeAchat, r.fournisseur, r.lba, r.camion, r.transporteur, r.chauffeur, d.sacs, d.net, d.refraction, d.poidsPaye, s.korDisplay, f.korDisplay, f.humidity, r.etat]);
      });
      var csv = "\uFEFF" + rows.map(function (row) { return row.map(q).join(";"); }).join("\r\n");
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "RCN_TRACE_Rapport_Entrepot_" + R.today() + ".csv"; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); toast("Rapport entrepôt exporté.");
    } catch (e) { toast("Export impossible : " + e.message, true); }
  };
  UI.exportControlReport = function () {
    try {
      var q = function (v) { v = v == null ? "" : String(v); return '"' + v.replace(/"/g, '""') + '"'; };
      var rows = [["Type", "Référence", "Entrepôt/Destination", "Entrée/Envoyé kg", "Sortie/Reçu kg", "Écart/Perte kg", "Écart/Perte %", "Statut/Justification"]];
      R.binCycles().forEach(function (c) { var t = R.binTotals(c); rows.push(["BIN", c.binId, whOf(c.binId), t.entree, c.residuKg, c.perteKg, c.pertePct, c.etat + (c.justification ? " · " + c.justification : "")]); });
      R.dryings().forEach(function (d) { rows.push(["SÉCHAGE", d.id, d.sourceBinId + " → " + d.targetBinId, d.inputKg, d.outputKg, d.lossKg, d.lossPct, d.type]); });
      R.transfers().forEach(function (t) { rows.push(["TRANSFERT", t.id, t.destination || t.destinationSite, t.poidsEnvoye, t.poidsRecu, t.ecart, t.transitLossPct, t.etat]); });
      var csv = "\uFEFF" + rows.map(function (row) { return row.map(q).join(";"); }).join("\r\n");
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "RCN_TRACE_Controles_BIN_Sechage_Transferts_" + R.today() + ".csv"; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); toast("Rapport de contrôle exporté.");
    } catch (e) { toast("Export impossible : " + e.message, true); }
  };
  UI.createDrying = function () {
    try {
      var d = R.createDrying(decodeURIComponent(val("dry_src")), val("dry_target"), {
        type: val("dry_type"), inputKg: val("dry_inKg"), outputKg: val("dry_outKg"),
        inputSacs: val("dry_inSacs"), outputSacs: val("dry_outSacs"),
        inputMoisture: val("dry_inMois"), outputMoisture: val("dry_outMois"),
        inputNc: val("dry_inNc"), outputNc: val("dry_outNc"), inputKor: val("dry_inKor"), outputKor: val("dry_outKor")
      });
      toast(d.id + " · perte " + R.kg(d.lossKg) + " (" + d.lossPct + " %)."); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.finale = function (id, decision) {
    try {
      var res = R.saveFinaleAndRelease(id, { gk: val("ff_gk"), imm: val("ff_imm"), spotted: val("ff_sp"), nc: val("ff_nc"), humidity: val("ff_hum"), browns: val("ff_browns"), voids: val("ff_voids"), oil: val("ff_oil"), prixUnitaire: val("ff_prix") }, decision, val("ff_bin"));
      if (res.bloque) { toast("Dossier bloqué qualité (écart KOR ≥ 1).", true); go("reception/" + id); }
      else { toast("Lot officiel " + res.lot.id + " créé & libéré."); go("qualite/" + id + "/fiche"); }
      route();
    } catch (e) { toast(e.message, true); }
  };
  UI.openCycle = function () {
    var binId = prompt("Identifiant de la BIN physique (ex. BIN-023) :"); if (!binId) return;
    try { var c = R.openBinCycle(binId.trim(), null, null); toast("Cycle " + c.id + " ouvert."); go("stock/" + encodeURIComponent(c.id)); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.addEntrepot = function () {
    try { var e = R.addEntrepot({ code: val("wh_code"), nom: val("wh_nom"), location: val("wh_loc") }); toast("Entrepôt " + e.code + " créé (" + e.location + ")."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.filterSuppliers = function (q) {
    q = String(q || "").toLowerCase().trim();
    var shown = 0;
    document.querySelectorAll(".supplier-row").forEach(function (row) {
      var ok = !q || (row.getAttribute("data-search") || "").indexOf(q) >= 0;
      row.style.display = ok ? "" : "none"; if (ok) shown += 1;
    });
    if (el("supplier-count")) el("supplier-count").textContent = shown + " résultat(s)";
  };
    UI.previewLba = function () {
    var box = el("fo_preview"); if (!box) return;
    box.textContent = R.nextLbaCode(val("fo_nom") || "", val("fo_prefix") || "LBA");
  };
  UI.addFournisseur = function () {
    try {
      var f = R.addFournisseur(val("fo_nom"), val("fo_prefix") || "LBA");
      if (!global.RCNSync || !global.RCNSync.status().hasSession) throw new Error("Connexion requise pour enregistrer le fournisseur.");
      global.RCNSync.saveSupplier(f).then(function () { toast("Fournisseur " + f.lba + " créé dans la base centrale."); route(); })
        .catch(function (e) { toast("Création centrale impossible : " + e.message, true); });
    } catch (e) { toast(e.message, true); }
  };
  UI.addToBin = function (binId) {
    try { R.addLotToBin(binId, val("bin_lot"), val("bin_qty")); toast("Lot ajouté en BIN."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.prepareTransfer = function (cycleId) {
    try {
      var dest = val("bin_dest") || "cal", meta, label;
      if (dest.indexOf("wh:") === 0) { var site = dest.slice(3); meta = { destinationType: "warehouse", destinationSite: site }; label = "Entrepôt " + site; }
      else { meta = { destinationType: "calibrage" }; label = "Calibrage · Usine"; }
      var trf = R.prepareTransfer(decodeURIComponent(cycleId), val("bin_out"), label, meta);
      toast("Transfert " + trf.id + " préparé."); go("transfert/" + trf.id); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.receiveWh = function (id) {
    try {
      var res = R.receiveTransferToWarehouse(id, {
        net: val("wh_net"), sacs: val("wh_sacs"),
        kor: val("wh_kor"), humidity: val("wh_hum"), nc: val("wh_nc")
      });
      toast("Réceptionné · dossier " + res.rec.id + " (sampling requis)."); go("qualite/" + res.rec.id + "/sampling"); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.juteMove = function () {
    try {
      var s = R.juteSuppliers()[Number(val("j_sup")) || 0] || {};
      R.juteMovement({ supplierNom: s.nom, supplierLba: s.lba, type: val("j_type"), qty: val("j_qty"), ref: val("j_ref") });
      toast("Mouvement enregistré."); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.juteDispose = function () {
    try { R.juteMovement({ type: val("jd_type"), qty: val("jd_qty"), ref: val("jd_ref") }); toast("Sacs classés (stock interne)."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.closeBin = function (cycleId) {
    var residu = prompt("Inventaire — résidu pesé restant (kg), vide si stock nul :", "");
    if (residu === null) return;
    var justif = prompt("Justification des pertes (obligatoire si perte > seuil) :", "") || "";
    var confirmeur = prompt("Validation — nom du Warehouse Manager :", R.db().user.nom) || "";
    try { var c = R.closeBinCycle(decodeURIComponent(cycleId), { residuKg: residu, justification: justif, confirmeur: confirmeur }); toast("BIN clôturée · perte " + R.kg(c.perteKg) + " (" + c.perteNiveau + ")."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.reopenBin = function (cycleId) {
    var autorisePar = prompt("Réouverture — autorisation nominative (GM ou profil désigné) :", "");
    if (autorisePar === null) return;
    var motif = prompt("Motif de réouverture :", "") || "";
    try { R.reopenBinCycle(decodeURIComponent(cycleId), { autorisePar: autorisePar, motif: motif }); toast("BIN rouverte (tracée)."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.qaApprove = function (id) { try { R.qaApproveTransfer(id, true, "Contrôle OK"); toast("QA approuvé."); route(); } catch (e) { toast(e.message, true); } };
  UI.ship = function (id) { try { R.shipTransfer(id); toast("Transfert expédié."); route(); } catch (e) { toast(e.message, true); } };
  UI.resolveEcart = function (id) { try { R.resolveTransferEcart(id, val("trf_motif")); toast("Écart justifié."); route(); } catch (e) { toast(e.message, true); } };
  UI.setTolRec = function () {
    try { var p = R.setToleranceReceptionCal(val("rec_tol")); toast(p == null ? "Tolérance effacée." : "Tolérance de réception réglée à " + p + " %."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.receiveAtCal = function (id) {
    try {
      R.receiveAtCalibrage(id, { poidsRecu: val("rc_recu"), sacsEnvoye: val("rc_sacsE"), sacsRecu: val("rc_sacsR"), etatSacs: val("rc_etat"), humidity: val("rc_hum"), nc: val("rc_nc"), commentaire: val("rc_com"), motif: val("rc_motif"), responsable: val("rc_resp") });
      toast("Réception validée."); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.createCalOp = function () {
    try {
      var cal = R.createCal(val("op_trf"), { machine: val("op_mach"), shift: val("op_shift"), operateurs: val("op_ops"), responsable: val("op_resp"), melangeAutorise: el("op_melange") && el("op_melange").checked, melangeMotif: val("op_melmotif") });
      toast("Opération " + cal.id + " créée."); go("calops/" + encodeURIComponent(cal.id)); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.calChecklistSave = function (id) {
    try {
      var obj = {}; R.CAL_CHECKLIST.forEach(function (it) { var e = el("ck_" + it.code); obj[it.code] = !!(e && e.checked); });
      var c = R.calSetChecklist(id, obj); toast(c.checklistOk ? "Checklist complète — prêt à démarrer." : "Checklist enregistrée (incomplète)."); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.calStart = function (id) { try { R.calStart(id); toast("Opération démarrée."); route(); } catch (e) { toast(e.message, true); } };
  UI.calResume = function (id) { try { R.calResume(id); toast("Reprise."); route(); } catch (e) { toast(e.message, true); } };
  UI.calStopPrompt = function (id) {
    var m = prompt("Motif de l'arrêt (obligatoire) :\n" + R.MOTIFS_ARRET.join(" · ")); if (!m) return;
    var com = /autre/i.test(m) ? (prompt("Commentaire (obligatoire pour « Autre ») :") || "") : "";
    try { R.calStop(id, m, com); toast("Arrêt : " + m); route(); } catch (e) { toast(e.message, true); }
  };
  UI.calFeed = function (id) { try { R.calFeed(id, val("feed_qty"), val("feed_bin")); toast("Alimentation enregistrée."); route(); } catch (e) { toast(e.message, true); } };
  UI.saveOutputs = function (id) {
    try {
      var n = 0;
      R.referentials().calibres.forEach(function (cal) {
        var p = val("o_poids_" + cal);
        if (p !== "" && p != null) { R.calOutput(id, cal, { poids: p, sacs: val("o_sacs_" + cal), nc: val("o_nc_" + cal), binDest: val("o_bin_" + cal) }); n++; }
      });
      toast(n + " sortie(s) enregistrée(s)."); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.saveLosses = function (id) {
    try {
      R.CATEGORIES_PERTE.forEach(function (l) { var p = val("l_poids_" + l.code); if (p !== "" && p != null) R.calLoss(id, l.code, { poids: p, destination: val("l_dest_" + l.code), commentaire: val("l_com_" + l.code) }); });
      toast("Rejets & restes enregistrés."); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.calQCSave = function (id, calibre) {
    try {
      R.calOutputQC(id, calibre, { impuretes: val("qc_imp_" + calibre), humidity: val("qc_hum_" + calibre), nc: val("qc_nc_" + calibre), decision: val("qc_dec_" + calibre) });
      toast("Contrôle qualité " + calibre + " enregistré."); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.calClose = function (id) {
    try { R.calClose(id, val("cal_motif"), val("cal_resp")); toast("Opération clôturée."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.setTolCal = function () {
    try { var p = R.setToleranceCalibrage(val("cal_tol")); toast(p == null ? "Tolérance effacée." : "Tolérance réglée à " + p + " %."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.traceGo = function () { var q = val("trace_q"); go("caltrace" + (q ? "/" + encodeURIComponent(q.trim()) : "")); route(); };
  UI.soon = function (nom) { toast("Module « " + nom + " » à venir dans une prochaine version."); };

  global.RCNUI = UI;

  /* ---------------- Live KOR (sampling & finale) ------------------- */
  document.addEventListener("input", function (ev) {
    var id = ev.target.id;
    if (id === "dry_inKg" || id === "dry_outKg") {
      var ink = R.num(val("dry_inKg")), outk = R.num(val("dry_outKg")), box = el("dryLoss");
      if (box) {
        if (ink != null && outk != null) {
          var loss = R.round2(ink - outk), pct = ink ? R.round2(loss / ink * 100) : 0;
          box.innerHTML = R.kg(ink) + " − " + R.kg(outk) + " = <b>" + R.kg(loss) + "</b> de perte (" + pct + " %)" + (loss < 0 ? '<small style="color:var(--danger)">Perte négative interdite</small>' : "");
        } else box.innerHTML = "Perte = envoyé − récupéré";
      }
    }
    if (["s_gk", "s_imm", "s_sp", "s_browns", "s_voids", "s_oil"].indexOf(id) >= 0) {
      var s = { gk: val("s_gk"), imm: val("s_imm"), spotted: val("s_sp"), browns: val("s_browns"), voids: val("s_voids"), oil: val("s_oil") };
      var kor = R.computeKor(s), td = R.totalDefect(s), tk = R.totalKernels(s);
      if (el("korLive")) el("korLive").textContent = kor == null ? "—" : R.round2(kor).toFixed(2);
      if (el("tdLive")) el("tdLive").textContent = td == null ? "—" : td + " g";
      if (el("tkLive")) el("tkLive").textContent = tk == null ? "—" : tk + " g";
    }
    if (["ff_gk", "ff_imm", "ff_sp"].indexOf(id) >= 0) {
      var f = { gk: val("ff_gk"), imm: val("ff_imm"), spotted: val("ff_sp") };
      var korF = R.computeKor(f);
      var r = currentRoute(); var rec = r.id ? R.getRec(r.id) : null;
      var korS = rec && rec.sampling ? rec.sampling.kor : null;
      var ec = R.ecartKor(korS, korF);
      if (el("ffKor")) el("ffKor").textContent = korF == null ? "—" : R.round2(korF).toFixed(2);
      if (el("ffEc")) el("ffEc").textContent = ec == null ? "—" : R.round2(ec).toFixed(2);
      if (el("ffEcTxt")) { var conf = R.ecartConforme(ec); el("ffEcTxt").innerHTML = ec == null ? "tolérance : &lt; 1" : (conf ? "conforme (&lt; 1)" : "≥ 1 → blocage"); el("ffEc").style.color = ec == null ? "" : (conf ? "" : "var(--danger)"); }
    }
  });

  /* ---------------- Réseau + offline box --------------------------- */
  function setNet() {
    if (global.RCNSync) { global.RCNTRACE_SYNCSTATUS(global.RCNSync.status()); return; }
    var on = navigator.onLine;
    var n = el("net"); n.className = "net " + (on ? "on" : "off");
    el("netlbl").textContent = on ? t("net.on") : t("net.off");
    var ob = el("offlineBox");
    if (ob) ob.innerHTML = on ? '<span class="badge b-ok">Synchronisé</span> <span style="font-size:13px;color:var(--n500)">Aucun brouillon en attente.</span>' : '<span class="badge b-warn">Hors connexion</span> <span style="font-size:13px;color:var(--n500)">Les saisies sont conservées localement.</span>';
  }
  window.addEventListener("online", setNet); window.addEventListener("offline", setNet);

  /* ---------------- Sub-route dispatch fix ------------------------- */
  // reception/<id>/dech affiche le formulaire de déchargement
  var _origRecep = PAGES.reception;
  PAGES.reception = function (r) { if (r.id && r.sub === "dech") return dechForm(r.id); return _origRecep(r); };

  /* ---------------- Statut de synchronisation ---------------------- */
  global.RCNTRACE_SYNCSTATUS = function (s) {
    var n = el("net"); if (!n) return;
    var online = navigator.onLine;
    if (s.mode === "online") { n.className = "net on"; el("netlbl").textContent = s.pending ? ("Sync… " + s.pending) : "Synchronisé"; }
    else if (s.mode === "offline") { n.className = "net off"; el("netlbl").textContent = "Hors ligne" + (s.pending ? " · " + s.pending : ""); }
    else { n.className = "net " + (online ? "on" : "off"); el("netlbl").textContent = online ? (s.hasSession ? "En ligne" : "Local (non connecté)") : "Hors ligne"; }
    var ob = el("offlineBox");
    if (ob) {
      if (s.mode === "online" && !s.pending) ob.innerHTML = '<span class="badge b-ok">Synchronisé Supabase</span> <span style="font-size:13px;color:var(--n500)">Aucun brouillon en attente.</span>';
      else if (s.pending) ob.innerHTML = '<span class="badge b-warn">' + s.pending + ' écriture(s) en attente</span> <span style="font-size:13px;color:var(--n500)">Rejeu automatique au retour du réseau.</span>';
      else ob.innerHTML = '<span class="badge b-neutral">Mode local</span> <span style="font-size:13px;color:var(--n500)">Connectez-vous pour synchroniser avec Supabase.</span>';
    }
  };
  // Rafraîchit le nom/rôle affichés (barre latérale) depuis le profil courant.
  function refreshWho() {
    var u = R.db().user || {};
    if (el("whoName")) el("whoName").textContent = u.nom || "—";
    if (el("whoRole")) el("whoRole").textContent = u.role || "";
  }
  // Re-rendu déclenché par une hydratation asynchrone (connexion tardive).
  global.RCNTRACE_RERENDER = function () { try { refreshWho(); route(); } catch (e) {} };
  // Appelé par la couche de sync quand le profil connecté est injecté.
  global.RCNTRACE_USER_SET = function () { try { refreshWho(); } catch (e) {} };

  /* ---------------- Boot ------------------------------------------- */
  function start() {
    var u = R.db().user;
    if (el("whoName")) el("whoName").textContent = u.nom;
    if (el("whoRole")) el("whoRole").textContent = u.role;
    window.addEventListener("hashchange", route);
    setNet();
    if (!location.hash) location.hash = "accueil";
    route();
    if (global.RCNSync) global.RCNTRACE_SYNCSTATUS(global.RCNSync.status());
  }
  function boot() {
    if (!global.RCN) { setTimeout(boot, 60); return; }
    R = global.RCN;
    // La couche de sync hydrate depuis Supabase (ou amorce localement) puis rend.
    if (global.RCNSync) { global.RCNSync.init().then(start, start); }
    else { R.seedDemo(false); start(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

})(window);
