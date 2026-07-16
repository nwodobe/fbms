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
      "nav.stock": "Stock & BIN", "nav.transfert": "Transfert", "nav.calibrage": "Calibrage",
      "nav.rapports": "Rapports", "nav.audit": "Audit",
      "net.on": "En ligne", "net.off": "Hors connexion",
      "save": "Enregistrer", "send": "Envoyer", "cancel": "Annuler", "back": "Retour",
    },
    en: {
      "brand.sub": "Material traceability", "nav.portal": "ANAGROCI Portal",
      "nav.accueil": "Home", "nav.reception": "Reception", "nav.qualite": "Quality",
      "nav.stock": "Stock & BIN", "nav.transfert": "Transfer", "nav.calibrage": "Grading",
      "nav.rapports": "Reports", "nav.audit": "Audit",
      "net.on": "Online", "net.off": "Offline",
      "save": "Save", "send": "Send", "cancel": "Cancel", "back": "Back",
    }
  };
  function t(k) { return (T[LANG] && T[LANG][k]) || (T.fr[k]) || k; }

  var NAV = [
    { id: "accueil", ni: "01" }, { id: "reception", ni: "02" }, { id: "qualite", ni: "03" },
    { id: "stock", ni: "04" }, { id: "transfert", ni: "05" }, { id: "calibrage", ni: "06" },
    { id: "rapports", ni: "07" }, { id: "audit", ni: "08" }
  ];

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
    el("nav").innerHTML = NAV.map(function (n) {
      return '<a href="#' + n.id + '" class="' + (n.id === active ? "on" : "") + '"><span class="ni">' + n.ni + '</span>' + esc(t("nav." + n.id)) + '</a>';
    }).join("");
    // i18n static bits
    document.querySelectorAll("[data-i18n]").forEach(function (e) { e.textContent = t(e.getAttribute("data-i18n")); });
    el("langbtn").textContent = LANG === "fr" ? "EN" : "FR";
  }

  var CRUMB = {
    accueil: ["Accueil", "Tableau de bord opérationnel"],
    reception: ["Réception", "Module 1 · Dossiers camion & sampling"],
    qualite: ["Qualité", "Module 1 · Sampling, décision GM & libération"],
    stock: ["Stock & BIN", "Module 1 · Cycles, compositions & mouvements"],
    transfert: ["Transfert", "Passage entre modules · contributeurs & triple validation"],
    calibrage: ["Calibrage", "Module 2 · CAL, sorties, arrêts & bilan matière"],
    rapports: ["Rapports", "Indicateurs & cartographie du business"],
    audit: ["Audit", "Journal, corrections & synchronisation"]
  };

  function route() {
    var r = currentRoute();
    renderNav(r.page);
    var cb = CRUMB[r.page] || ["RCN TRACE", ""];
    el("crumb").innerHTML = esc(cb[0]) + "<small>" + esc(cb[1]) + "</small>";
    var fn = PAGES[r.page] || PAGES.accueil;
    try { el("view").innerHTML = fn(r); }
    catch (e) { el("view").innerHTML = '<div class="alert">Erreur d\'affichage : ' + esc(e.message) + '</div>'; console.error(e); }
    el("view").scrollTop = 0; window.scrollTo(0, 0);
    if (el("side").classList.contains("open")) el("side").classList.remove("open");
  }

  /* ================================================================== */
  /*  PAGES                                                             */
  /* ================================================================== */
  var PAGES = {};

  /* ---- ACCUEIL : bienvenue + raccourcis + tableau de bord (slides 2 & 3) */
  PAGES.accueil = function () {
    var d = R.dashboard();
    var u = R.db().user;
    var priorities = buildPriorities();
    return '' +
      '<div class="pagehead"><h1>Bienvenue, ' + esc((u.nom || "").split(" ")[0]) + '</h1>' +
      '<p>Un écran simple selon le métier — les droits dépendent du rôle, pas de la personne qui tient la tablette.</p></div>' +
      '<div class="kpis">' +
        kpi("Camions en attente", d.camionsEnAttente, d.decisionGm + " décision GM requise", d.decisionGm ? "warn" : "") +
        kpi("Lots bloqués", d.lotsBloques, "Écart KOR à traiter", d.lotsBloques ? "danger" : "") +
        kpi("Transferts ouverts", d.transfertsOuverts, d.transfertsARecevoir + " à recevoir", "") +
        kpi("CAL en cours", d.calEnCours, d.calAValider + " à valider", "") +
      '</div>' +
      '<div class="grid2">' +
        '<div class="card"><h2>Actions prioritaires</h2>' + priorityTable(priorities) + '</div>' +
        '<div><div class="card" style="margin-bottom:16px"><h2>Mes raccourcis</h2><div class="cbody" style="display:grid;gap:10px">' +
          shortcut("Nouvelle réception", "Créer le dossier temporaire du camion", "reception/new") +
          shortcut("Sampling en attente", d.camionsEnAttente + " dossier(s) à contrôler", "qualite") +
          shortcut("Transfert à recevoir", d.transfertsARecevoir + " TRF arrivé(s) au calibrage", "calibrage") +
          shortcut("Bilan à valider", d.calAValider + " opération(s) CAL à rapprocher", "calibrage") +
        '</div></div>' +
        '<div class="rule"><b>Règle métier.</b> Un dossier sans responsable et sans prochaine action est considéré incomplet.</div>' +
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
      if (tr.etat === R.ETAT_TRF.EXPEDIE || tr.etat === R.ETAT_TRF.CONTROLE) out.push({ ref: tr.id, etape: "Réception", resp: "Calibrage", statut: "ARRIVÉ", cls: "b-info", hash: "calibrage" });
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
        '<label>Fournisseur</label><select id="f_fournisseur">' + refs.fournisseurs.map(function (f) { return '<option>' + esc(f) + '</option>'; }).join("") + '</select>' +
        '<label>Provenance / origine</label><input id="f_origine" placeholder="Localité d\'origine">' +
        '<div class="row3"><div><label>Poids annoncé (kg)</label><input id="f_poids" type="number" inputmode="decimal" placeholder="—"></div>' +
        '<div><label>Sacs annoncés</label><input id="f_sacs" type="number" placeholder="—"></div>' +
        '<div><label>Réf. document fournisseur</label><input id="f_ref" placeholder="BL-…"></div></div>' +
        '<div class="actions"><button class="btn" onclick="RCNUI.createReception()">Enregistrer & envoyer au labo</button>' +
        '<button class="btn ghost" onclick="__rcngo(\'reception\')">Annuler</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> REC est temporaire. Le champ lot reste vide et verrouillé. Un doublon évident (même camion, même créneau) est refusé.</div>' +
      '</div>';
  }
  function nowLocal() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

  function receptionDetail(id) {
    var rec = R.getRec(id); if (!rec) return notFound(id);
    var curStep = recStep(rec);
    var s = rec.sampling, f = rec.finale, g = rec.gm, dech = rec.dechargement;
    var out = '<div class="pagehead"><h1>' + esc(rec.id) + ' · ' + esc(rec.camion || "camion") + '</h1><p>' + esc(rec.fournisseur) + ' — ' + esc(rec.origine || "origine ?") + ' · arrivée ' + R.fmtDateTime(rec.arriveeAt) + '</p></div>' +
      stepper(STEPS, curStep) +
      '<div class="grid2"><div>' +
        '<div class="card"><h2>Dossier ' + badgeEtat(rec.etat) + '</h2><div class="cbody">' +
          field("Poids annoncé", R.kg(rec.poidsAnnonce)) + field("Sacs annoncés", rec.sacsAnnonce == null ? "—" : rec.sacsAnnonce) +
          field("Réf. fournisseur", rec.refDoc || "—") +
          (s ? '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Sampling ' + esc(s.id) + '</b>' +
            field("KOR sampling", s.korDisplay != null ? s.korDisplay.toFixed(2) : "—") + field("Total Defect", s.totalDefect == null ? "—" : s.totalDefect + " g") + field("Total Kernels", s.totalKernels == null ? "—" : s.totalKernels + " g") + field("Nut Count", s.nc == null ? "—" : s.nc) + field("Humidité", s.humidity == null ? "—" : s.humidity + " %") : "") +
          (g ? '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Décision GM</b>' + field("Décision", g.autorise ? "AUTORISÉ" : "REFUSÉ") + field("Commentaire", g.commentaire || "—") + field("Le", R.fmtDateTime(g.at)) : "") +
          (dech ? '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Déchargement</b>' + field("Net physique", R.kg(dech.net)) + field("Bordereau", dech.bordereau || "—") + field("Poids main-d\'œuvre", dech.poidsMainDoeuvre == null ? "—" : R.kg(dech.poidsMainDoeuvre) + " (séparé du stock)") : "") +
          (f ? '<hr style="border:0;border-top:1px solid var(--n200);margin:14px 0"><b style="font-family:var(--fd);color:var(--forest)">Analyse finale</b>' + field("KOR final", f.korDisplay != null ? f.korDisplay.toFixed(2) : "—") + field("Écart absolu", f.ecartDisplay != null ? f.ecartDisplay.toFixed(2) + (f.conforme ? " (< 1)" : " (≥ 1)") : "—") : "") +
          (rec.lotId ? field("Lot officiel", '<a href="#qualite/' + rec.id + '/fiche">' + esc(rec.lotId) + ' →</a>') : "") +
        '</div></div>' +
        recActionCard(rec) +
      '</div>' +
      '<div class="card"><h2>Parcours du dossier</h2><div class="cbody">' + timeline(rec.events) + '</div></div>' +
      '</div>';
    return out;
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
      return '<div class="card" style="margin-top:16px"><h2>Prochaine action · Qualité</h2><div class="cbody"><p style="margin:0 0 12px;color:var(--n500)">Le laboratoire saisit le sampling avant déchargement.</p><button class="btn" onclick="__rcngo(\'qualite/' + rec.id + '/sampling\')">Saisir le sampling →</button></div></div>';
    if (rec.etat === e.ATTENTE_GM)
      return '<div class="card" style="margin-top:16px"><h2>Prochaine action · GM</h2><div class="cbody"><p style="margin:0 0 12px;color:var(--n500)">Sans autorisation GM, le déchargement reste indisponible.</p><button class="btn" onclick="__rcngo(\'qualite/' + rec.id + '/gm\')">Décision de déchargement →</button></div></div>';
    if (rec.etat === e.AUTORISEE)
      return '<div class="card" style="margin-top:16px"><h2>Prochaine action · Entrepôt</h2><div class="cbody"><button class="btn" onclick="__rcngo(\'reception/' + rec.id + '/dech\')">Enregistrer le déchargement →</button></div></div>';
    if (rec.etat === e.DECHARGE)
      return '<div class="card" style="margin-top:16px"><h2>Prochaine action · Qualité</h2><div class="cbody"><button class="btn" onclick="__rcngo(\'qualite/' + rec.id + '/finale\')">Analyse finale & libération →</button></div></div>';
    if (rec.etat === e.BLOQUE)
      return '<div class="card" style="margin-top:16px"><h2 style="color:var(--danger)">Lot bloqué qualité</h2><div class="cbody"><div class="alert">Écart KOR ≥ 1. Flux d\'exception : nouvelle analyse, justification, décision et éventuel déclassement.</div><button class="btn warn" onclick="__rcngo(\'qualite/' + rec.id + '/finale\')">Nouvelle analyse →</button></div></div>';
    return "";
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
      '<div class="grid2"><div class="card"><h2>Pesée</h2><div class="cbody">' +
        '<div class="row">' + inp("d_bord", "Bordereau", "", "text") + inp("d_ticket", "Ticket de pesée", "", "text") + '</div>' +
        '<div class="row3">' + inp("d_sacs", "Sacs", "", "number") + inp("d_brut", "Poids brut (kg)", "", "number") + inp("d_tare", "Tare (kg)", "", "number") + '</div>' +
        '<div class="row">' + inp("d_net", "Poids net (kg) — auto si vide", "", "number") + inp("d_mo", "Poids main-d\'œuvre (kg)", "", "number") + '</div>' +
        '<div class="row">' + inp("d_prest", "Prestataire", "", "text") + inp("d_dest", "Destination", "", "text") + '</div>' +
        '<div class="actions"><button class="btn" onclick="RCNUI.saveDechargement(\'' + id + '\')">Enregistrer le déchargement</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Le poids net physique commande le stock. Le poids de main-d\'œuvre est conservé séparément et ne modifie jamais le stock physique.</div>' +
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
    var body = cycles.length ? '<div class="tablewrap"><table><thead><tr><th>Cycle BIN</th><th>BIN</th><th>Stock physique</th><th>Contributeurs</th><th>Statut</th><th></th></tr></thead><tbody>' +
      cycles.map(function (c) {
        return '<tr><td class="mono">' + esc(c.id) + '</td><td class="mono">' + esc(c.binId) + '</td><td class="mono">' + R.kg(R.binStock(c)) + '</td><td>' + c.contributors.length + '</td><td>' + badgeEtat(c.etat) + '</td>' +
          '<td><button class="btn ghost sm" onclick="__rcngo(\'stock/' + encodeURIComponent(c.id) + '\')">Ouvrir</button></td></tr>';
      }).join("") + '</tbody></table></div>' : '<div class="empty">Aucun cycle de BIN ouvert.</div>';
    return '<div class="pagehead"><h1>Stock & BIN collectives</h1><p>La BIN est un contenant, pas un nouveau lot. Après mélange, on suit les quantités et les contributeurs, pas chaque noix.</p></div>' +
      '<div class="actions" style="margin:0 0 16px"><button class="btn" onclick="RCNUI.openCycle()">+ Ouvrir un cycle de BIN</button></div>' + body;
  };

  function binDetail(cycleId) {
    var cyc = R.getCycle(cycleId); if (!cyc) return notFound(cycleId);
    var stock = R.binStock(cyc);
    var rows = cyc.contributors.map(function (c) {
      var dispo = R.round2(c.entree - c.sorti);
      var part = stock ? R.round2(dispo / stock * 100) : 0;
      var lot = R.getLot(c.lotId);
      return '<tr><td class="mono">' + esc(c.lotId) + '</td><td class="mono">' + R.kg(c.entree) + '</td><td>' + part + ' %</td><td class="mono">' + R.kg(dispo) + '</td><td>' + badgeEtat((lot || {}).etat || c.qualite) + '</td></tr>';
    }).join("");
    var libLots = R.lots().filter(function (l) { return l.etat === R.ETAT_REC.LIBERE && l.stock > 0; });
    return '<div class="pagehead"><h1>' + esc(cyc.binId) + ' · ' + esc(cyc.id) + ' ' + badgeEtat(cyc.etat) + '</h1><p>Composition théorique du cycle — après mélange, les pourcentages suivent le bilan matière.</p></div>' +
      '<div class="metrics">' +
        '<div class="metric big"><small>Stock physique</small><b>' + R.round2(stock) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Lots contributeurs</small><b>' + pad2(cyc.contributors.length) + '</b></div>' +
        '<div class="metric"><small>Qualité autorisée</small><b style="font-size:15px">' + esc(cyc.qualiteAutorisee || "À valider") + '</b></div>' +
        '<div class="metric"><small>Capacité</small><b>' + (cyc.capaciteKg ? R.round2(cyc.capaciteKg) : "—") + '</b><span>kg</span></div>' +
      '</div>' +
      '<div class="card" style="margin-bottom:16px"><h2>Composition théorique du cycle</h2><div class="cbody" style="padding:0">' +
        (rows ? '<table><thead><tr><th>Lot officiel</th><th>Entrée</th><th>Part</th><th>Disponible</th><th>Statut</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="empty">BIN vide.</div>') +
      '</div></div>' +
      '<div class="grid2"><div class="card"><h2>Ajouter une entrée</h2><div class="cbody">' +
        '<label>Lot libéré</label><select id="bin_lot">' + (libLots.length ? libLots.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.id) + ' · dispo ' + R.round2(l.stock) + ' kg</option>'; }).join("") : '<option value="">Aucun lot libéré disponible</option>') + '</select>' +
        '<label>Poids (kg)</label><input id="bin_qty" type="number" placeholder="—">' +
        '<div class="actions"><button class="btn" onclick="RCNUI.addToBin(\'' + esc(cyc.binId) + '\')" ' + (libLots.length ? "" : "disabled") + '>Ajouter le lot</button></div>' +
      '</div></div>' +
      '<div class="card"><h2>Créer une sortie / transfert</h2><div class="cbody">' +
        '<p style="margin:0 0 10px;color:var(--n500);font-size:13px">Répartition proportionnelle entre contributeurs (R-03).</p>' +
        '<label>Quantité à sortir (kg)</label><input id="bin_out" type="number" placeholder="—">' +
        '<div class="actions"><button class="btn" onclick="RCNUI.prepareTransfer(\'' + encodeURIComponent(cyc.id) + '\')" ' + (stock > 0 ? "" : "disabled") + '>Préparer le transfert →</button></div>' +
      '</div></div></div>';
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

  function transfertDetail(id) {
    var trf = R.getTrf(id); if (!trf) return notFound(id);
    var v = trf.validations;
    var rows = trf.contributors.map(function (c) {
      return '<tr><td class="mono">' + esc(c.lotId) + '</td><td>' + c.share + ' %</td><td class="mono">' + R.kg(c.qty) + '</td><td>' + badgeEtat(c.qualite) + '</td></tr>';
    }).join("");
    var valStep = '<div class="stepper" style="margin-top:6px">' +
      '<div class="st ' + (v.entrepot ? "done" : "cur") + '"><i>' + (v.entrepot ? "✓" : "1") + '</i>Entrepôt</div>' +
      '<div class="st ' + (v.qa && v.qa.ok ? "done" : (v.entrepot ? "cur" : "")) + '"><i>' + (v.qa && v.qa.ok ? "✓" : "2") + '</i>QA / Lab</div>' +
      '<div class="st ' + (v.calibrage ? "done" : "") + '"><i>' + (v.calibrage ? "✓" : "3") + '</i>Calibrage</div></div>';
    var action = "";
    if (trf.etat === R.ETAT_TRF.PREPARE) action = '<button class="btn" onclick="RCNUI.qaApprove(\'' + id + '\')">Contrôle QA / Lab → approuver</button>';
    else if (trf.etat === R.ETAT_TRF.CONTROLE) action = '<button class="btn" onclick="RCNUI.ship(\'' + id + '\')">Expédier vers le calibrage</button>';
    else if (trf.etat === R.ETAT_TRF.ECART) action = '<div class="alert">Écart de ' + R.kg(trf.ecart) + ' à justifier.</div><label>Justification</label><input id="trf_motif" placeholder="Cause de l\'écart"><div class="actions"><button class="btn warn" onclick="RCNUI.resolveEcart(\'' + id + '\')">Valider l\'écart</button></div>';
    else if ([R.ETAT_TRF.EXPEDIE, R.ETAT_TRF.PARTIEL].indexOf(trf.etat) >= 0) action = '<p style="color:var(--n500);font-size:13px;margin:0 0 8px">Réception côté calibrage.</p><button class="btn" onclick="__rcngo(\'calibrage\')">Aller au tableau de bord calibrage →</button>';
    else action = '<div class="okbox">Transfert ' + esc(trf.etat) + '.</div>';
    return '<div class="pagehead"><h1>Préparer le transfert ' + esc(trf.id) + ' ' + badgeEtat(trf.etat) + '</h1><p>CAL hérite des contributeurs de TRF ; aucune origine n\'est ressaisie.</p></div>' +
      '<div class="metrics">' +
        '<div class="metric"><small>BIN source</small><b style="font-size:16px">' + esc(trf.binId) + '</b><span>' + esc(trf.cycleId) + '</span></div>' +
        '<div class="metric big"><small>Quantité envoyée</small><b>' + R.round2(trf.poidsEnvoye) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Reçu</small><b>' + (trf.poidsRecu == null ? "—" : R.round2(trf.poidsRecu)) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Destination</small><b style="font-size:16px">' + esc(trf.destination) + '</b></div>' +
      '</div>' +
      '<div class="grid2"><div class="card"><h2>Contributeurs calculés automatiquement</h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Lot parent</th><th>Part BIN</th><th>Attribué au TRF</th><th>Qualité</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      '<div><div class="card"><h2>Triple validation</h2><div class="cbody">' + valStep + '<div style="margin-top:14px">' + action + '</div></div></div>' +
      '<div class="rule"><b>Règle métier.</b> Un contributeur non libéré bloque le contrôle QA. Tout écart envoyé/reçu passe le transfert en EN_ÉCART et exige une validation.</div>' +
      '</div></div>';
  }

  /* ---- CALIBRAGE (slides 11-14) ----------------------------------- */
  PAGES.calibrage = function (r) {
    if (r.id && r.sub === "sorties") return calSorties(r.id);
    if (r.id && r.sub === "bilan") return calBilan(r.id);
    if (r.id && r.sub === "genealogie") return calGenealogie(r.id);
    if (r.id) return calOperation(r.id);
    return calDashboard();
  };

  function calDashboard() {
    var attendus = R.transfers().filter(function (t) { return [R.ETAT_TRF.EXPEDIE, R.ETAT_TRF.CONTROLE, R.ETAT_TRF.PARTIEL].indexOf(t.etat) >= 0; });
    var enCours = R.cals().filter(function (c) { return [R.ETAT_CAL.EN_COURS, R.ETAT_CAL.PARTIEL, R.ETAT_CAL.PAUSE, R.ETAT_CAL.PRET].indexOf(c.etat) >= 0; });
    var pauses = R.cals().filter(function (c) { return c.etat === R.ETAT_CAL.PAUSE; }).length;
    var aCloturer = R.cals().filter(function (c) { return [R.ETAT_CAL.PARTIEL, R.ETAT_CAL.RAPPROCHER, R.ETAT_CAL.VALIDER].indexOf(c.etat) >= 0; }).length;
    var attRows = attendus.length ? attendus.map(function (t) {
      return '<tr><td class="mono">' + esc(t.id) + '</td><td class="mono">' + esc(t.binId) + '</td><td class="mono">' + R.kg(t.poidsEnvoye) + '</td><td>' + badgeEtat(t.etat) + '</td>' +
        '<td><button class="btn sm" onclick="RCNUI.receiveTrf(\'' + t.id + '\')">Recevoir</button></td></tr>';
    }).join("") : '<tr><td colspan="5" class="empty">Aucun transfert attendu.</td></tr>';
    var opRows = enCours.length ? enCours.map(function (c) {
      return '<tr><td class="mono">' + esc(c.id) + '</td><td class="mono">' + esc(c.machine) + '</td><td>Shift ' + esc(c.shift) + '</td><td>' + badgeEtat(c.etat) + '</td>' +
        '<td><button class="btn ghost sm" onclick="__rcngo(\'calibrage/' + c.id + '\')">Ouvrir</button></td></tr>';
    }).join("") : '<tr><td colspan="5" class="empty">Aucune opération en cours.</td></tr>';
    return '<div class="pagehead"><h1>Tableau de bord calibrage</h1><p>L\'opérateur commence par vérifier ce qui arrive. Une opération CAL ne démarre pas depuis une origine saisie à la main.</p></div>' +
      '<div class="kpis">' +
        kpi("TRF à recevoir", attendus.length, "En attente", attendus.length ? "warn" : "") +
        kpi("CAL en cours", enCours.length, "Opérations actives", "") +
        kpi("Pauses", pauses, "Arrêt machine", pauses ? "warn" : "") +
        kpi("À clôturer", aCloturer, "Écart à expliquer", aCloturer ? "warn" : "") +
      '</div>' +
      '<div class="card" style="margin-bottom:16px"><h2>Transferts attendus</h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>TRF</th><th>BIN source</th><th>Poids envoyé</th><th>Statut</th><th></th></tr></thead><tbody>' + attRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Opérations de calibrage</h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>CAL</th><th>Machine</th><th>Shift</th><th>Statut</th><th></th></tr></thead><tbody>' + opRows + '</tbody></table></div></div>';
  }

  function calOperation(id) {
    var c = R.getCal(id); if (!c) return notFound(id);
    var reste = R.round2(c.recu - c.entreeMachine);
    var openStop = c.stops.filter(function (s) { return !s.endAt; })[0];
    var ctrl;
    if (c.etat === R.ETAT_CAL.PRET) ctrl = '<button class="btn" onclick="RCNUI.calStart(\'' + id + '\')">Démarrer l\'opération</button>';
    else if (c.etat === R.ETAT_CAL.PAUSE) ctrl = '<button class="btn" onclick="RCNUI.calResume(\'' + id + '\')">Reprendre</button>';
    else ctrl = '<button class="btn warn" onclick="RCNUI.calPause(\'' + id + '\')">Mettre en pause</button>';
    return '<div class="pagehead"><h1>' + esc(c.id) + ' · Calibrage ' + badgeEtat(c.etat) + '</h1><p>Machine ' + esc(c.machine) + ' · Shift ' + esc(c.shift) + ' · depuis ' + esc(c.trfId) + '. L\'opération se pilote comme une mission de production.</p></div>' +
      '<div class="metrics">' +
        '<div class="metric"><small>Reçu du TRF</small><b>' + R.round2(c.recu) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Entrée machine</small><b>' + R.round2(c.entreeMachine) + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Reste à traiter</small><b>' + reste + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Arrêts</small><b>' + c.stops.length + '</b><span>' + (openStop ? "en pause" : "cumulés") + '</span></div>' +
      '</div>' +
      '<div class="grid2"><div class="card"><h2>Pilotage</h2><div class="cbody">' +
        '<div class="actions" style="margin-top:0">' + ctrl +
          '<button class="btn ghost" onclick="__rcngo(\'calibrage/' + id + '/sorties\')">Sorties par calibre →</button>' +
          '<button class="btn ghost" onclick="__rcngo(\'calibrage/' + id + '/bilan\')">Bilan matière →</button></div>' +
        '<hr style="border:0;border-top:1px solid var(--n200);margin:16px 0">' +
        '<b style="font-family:var(--fd);color:var(--forest)">Alimentation machine</b>' +
        '<div class="row" style="margin-top:8px">' + inp("feed_qty", "Poids (kg)", "", "number") + inp("feed_bin", "BIN d\'alimentation", "", "text") + '</div>' +
        '<div class="actions"><button class="btn sm" onclick="RCNUI.calFeed(\'' + id + '\')" ' + (c.etat === R.ETAT_CAL.EN_COURS || c.etat === R.ETAT_CAL.PARTIEL ? "" : "disabled") + '>Ajouter une alimentation</button></div>' +
      '</div></div>' +
      '<div class="card"><h2>Derniers événements</h2><div class="cbody">' + timeline(c.events.slice(0, 8).map(function (e) { return e; })) + '</div></div>' +
      '</div>' +
      '<div class="rule"><b>Règle métier.</b> Une pause exige un motif ; une coupure ne doit pas créer de doublon. On ne dépasse jamais le reçu disponible.</div>';
  }

  function calSorties(id) {
    var c = R.getCal(id); if (!c) return notFound(id);
    var refs = R.referentials();
    var rows = refs.calibres.map(function (cal) {
      var o = c.outputs.filter(function (x) { return x.calibre === cal; })[0] || {};
      return '<tr><td class="mono">' + esc(cal) + '</td>' +
        '<td><input id="o_sacs_' + esc(cal) + '" type="number" style="padding:6px;width:80px" value="' + (o.sacs == null ? "" : o.sacs) + '" placeholder="—"></td>' +
        '<td><input id="o_poids_' + esc(cal) + '" type="number" style="padding:6px;width:100px" value="' + (o.poids == null ? "" : o.poids) + '" placeholder="—"></td>' +
        '<td><input id="o_bin_' + esc(cal) + '" type="text" style="padding:6px;width:110px" value="' + esc(o.binDest || "") + '" placeholder="BIN dest."></td>' +
        '<td>' + (o.poids != null ? '<span class="badge b-ok">SAISI</span>' : '<span class="badge b-neutral">OUVERT</span>') + '</td></tr>';
    }).join("");
    var lossInputs = R.CATEGORIES_PERTE.map(function (l) {
      var ex = c.losses.filter(function (x) { return x.code === l.code; })[0] || {};
      return '<div><label>' + esc(l.label) + ' (kg)</label><input id="l_' + l.code + '" type="number" value="' + (ex.poids == null ? "" : ex.poids) + '" placeholder="—"></div>';
    }).join("");
    return '<div class="pagehead"><h1>' + esc(c.id) + ' · Sorties par calibre</h1><p>Chaque kilo doit avoir une catégorie. Saisie partielle autorisée — enregistrez sans attendre la fin.</p></div>' +
      '<div class="card" style="margin-bottom:16px"><h2>Sorties par calibre <span class="badge b-info">' + refs.calibres.length + ' calibres</span></h2><div class="cbody" style="padding:0">' +
        '<table><thead><tr><th>Calibre</th><th>Sacs</th><th>Poids (kg)</th><th>BIN destination</th><th>Statut</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      '<div class="card" style="margin-bottom:16px"><h2>Autres matières à déclarer</h2><div class="cbody"><div class="row3">' + lossInputs + '</div></div></div>' +
      '<div class="actions"><button class="btn" onclick="RCNUI.saveOutputs(\'' + id + '\')">Enregistrer les sorties</button>' +
      '<button class="btn ghost" onclick="__rcngo(\'calibrage/' + id + '/bilan\')">Voir le bilan →</button></div>' +
      '<div class="rule"><b>Règle métier.</b> Les noms exacts des neuf calibres restent à confirmer avec la Production (§9.3). Aucune catégorie libre non contrôlée.</div>';
  }

  function calBilan(id) {
    var c = R.getCal(id); if (!c) return notFound(id);
    var b = R.calBalance(c);
    var eqTxt = b.equilibre ? "Bilan équilibré." : "Écart inexpliqué : " + R.kg(b.ecart) + " — justification requise.";
    return '<div class="pagehead"><h1>' + esc(c.id) + ' · Bilan & clôture ' + badgeEtat(c.etat) + '</h1><p>Une opération ne se ferme pas tant que l\'écart n\'est pas expliqué.</p></div>' +
      '<div class="metrics">' +
        '<div class="metric big"><small>Quantité reçue</small><b>' + b.recu + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Sorties calibres</small><b>' + b.sorties + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Pertes justifiées</small><b>' + b.pertes + '</b><span>kg</span></div>' +
        '<div class="metric"><small>Résidu / encours</small><b>' + b.residu + '</b><span>kg</span></div>' +
      '</div>' +
      '<div class="balance">' + b.recu + '  =  ' + b.sorties + '  +  ' + b.pertes + '  +  ' + b.residu +
        '<small>Reçu = Sorties + Pertes + Restant · ' + esc(eqTxt) + '</small></div>' +
      (b.equilibre ? '<div class="okbox">Écart inexpliqué : 0 kg · bilan équilibré.</div>' : '<div class="alert">' + esc(eqTxt) + '</div>') +
      '<div class="card" style="margin-top:8px"><h2>Validation & clôture</h2><div class="cbody">' +
        '<label>Commentaire de clôture' + (b.equilibre ? " (facultatif)" : " (obligatoire — écart)") + '</label><textarea id="cal_motif" rows="2" placeholder="Observation / justification de l\'écart"></textarea>' +
        '<div class="actions"><button class="btn ghost" onclick="__rcngo(\'calibrage/' + id + '/sorties\')">← Retour aux sorties</button>' +
        (c.etat === R.ETAT_CAL.CLOS ? '<span class="badge b-ok">Opération clôturée</span>' : '<button class="btn" onclick="RCNUI.calClose(\'' + id + '\')">Valider & clôturer</button>') +
        '<button class="btn ghost" onclick="__rcngo(\'calibrage/' + id + '/genealogie\')">Voir la généalogie →</button></div>' +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Aucune tolérance industrielle n\'est inventée : tout écart reste visible jusqu\'à validation. Toute quantité négative est bloquée.</div>';
  }

  function calGenealogie(id) {
    var g = R.genealogy(id); if (!g) return notFound(id);
    var rows = g.contributors.map(function (c) {
      return '<tr><td class="mono">' + esc(c.lotId) + '</td><td>' + (c.share == null ? "—" : c.share + " %") + '</td><td class="mono">' + R.kg(c.qty) + '</td><td class="mono">' + esc(c.rec || "—") + '</td><td>' + esc(c.fournisseur || "—") + '</td><td>' + (c.korFinal != null ? c.korFinal.toFixed(2) : "—") + '</td></tr>';
    }).join("");
    return '<div class="pagehead"><h1>Généalogie de ' + esc(g.cal.id) + '</h1><p>Recherche inverse : d\'une sortie CAL vers le TRF, le cycle de BIN et les lots officiels contributeurs.</p></div>' +
      '<div class="stepper" style="margin-bottom:16px">' +
        '<div class="st done"><i>✓</i>' + esc(g.cal.id) + '</div>' +
        '<div class="st done"><i>✓</i>' + esc(g.trf ? g.trf.id : "TRF ?") + '</div>' +
        '<div class="st done"><i>✓</i>' + esc(g.cycle ? g.cycle.id : "BIN ?") + '</div>' +
        '<div class="st cur"><i>4</i>Lots officiels</div></div>' +
      '<div class="card"><h2>Lots officiels contributeurs</h2><div class="cbody" style="padding:0">' +
        (rows ? '<table><thead><tr><th>Lot (RCN)</th><th>Part</th><th>Attribué</th><th>Réception</th><th>Fournisseur</th><th>KOR final</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="empty">Aucun contributeur.</div>') +
      '</div></div>' +
      '<div class="rule"><b>Règle métier.</b> Les contributions sont présentées comme théoriques après mélange. Une sortie calibrée ne remplace pas ses parents : elle pointe vers CAL → TRF → contributeurs BIN → lots officiels.</div>';
  }

  /* ---- RAPPORTS (§14.1) ------------------------------------------- */
  PAGES.rapports = function () {
    var recs = R.receptions();
    var stockLots = R.lots().filter(function (l) { return l.stock > 0; });
    var totalStock = R.binCycles().reduce(function (t, c) { return t + R.binStock(c); }, 0);
    function count(pred) { return recs.filter(pred).length; }
    var byCalibre = {};
    R.cals().forEach(function (c) { c.outputs.forEach(function (o) { byCalibre[o.calibre] = (byCalibre[o.calibre] || 0) + (o.poids || 0); }); });
    var calRows = Object.keys(byCalibre).length ? Object.keys(byCalibre).map(function (k) { return '<tr><td class="mono">' + esc(k) + '</td><td class="mono">' + R.kg(byCalibre[k]) + '</td></tr>'; }).join("") : '<tr><td colspan="2" class="empty">Aucune sortie calibrée.</td></tr>';
    return '<div class="pagehead"><h1>Rapports opérationnels</h1><p>Les indicateurs servent d\'abord à comprendre le fonctionnement, les délais, les pertes et les responsabilités.</p></div>' +
      '<div class="kpis">' +
        kpi("Réceptions du jour", recs.filter(function (r) { return (r.id || "").indexOf("REC-" + R.today()) === 0; }).length, "Camions enregistrés", "") +
        kpi("Lots libérés", count(function (r) { return r.etat === R.ETAT_REC.LIBERE; }), "Disponibles", "") +
        kpi("Lots bloqués", count(function (r) { return r.etat === R.ETAT_REC.BLOQUE; }), "Qualité", count(function (r) { return r.etat === R.ETAT_REC.BLOQUE; }) ? "danger" : "") +
        kpi("Stock BIN total", R.round2(totalStock), "kg en cycles", "") +
      '</div>' +
      '<div class="grid2"><div class="card"><h2>Sorties par calibre (cumul)</h2><div class="cbody" style="padding:0"><table><thead><tr><th>Calibre</th><th>Poids</th></tr></thead><tbody>' + calRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Rapports disponibles</h2><div class="cbody"><ul style="margin:0;padding-left:18px;line-height:2;color:var(--n700);font-size:14px">' +
        '<li>Réceptions du jour & dossiers en attente</li><li>Lots par statut qualité</li><li>Stock par lot, BIN, cycle et âge</li>' +
        '<li>Composition & historique des BIN</li><li>Transferts préparés, reçus, partiels ou en écart</li>' +
        '<li>Opérations CAL en cours, à rapprocher ou clôturées</li><li>Sorties par calibre, pertes, résidus & rework</li><li>Journal des corrections & validations</li></ul></div></div></div>';
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

  UI.createReception = function () {
    try {
      var rec = R.createReception({ camion: val("f_camion"), fournisseur: val("f_fournisseur"), origine: val("f_origine"), arriveeAt: new Date(val("f_arrivee") || Date.now()).toISOString(), poidsAnnonce: val("f_poids"), sacsAnnonce: val("f_sacs"), refDoc: val("f_ref") });
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
    try { R.saveDechargement(id, { bordereau: val("d_bord"), ticket: val("d_ticket"), sacs: val("d_sacs"), brut: val("d_brut"), tare: val("d_tare"), net: val("d_net"), poidsMainDoeuvre: val("d_mo"), prestataire: val("d_prest"), destination: val("d_dest") }); toast("Déchargement enregistré."); go("qualite/" + id + "/finale"); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.finale = function (id, decision) {
    try {
      var res = R.saveFinaleAndRelease(id, { gk: val("ff_gk"), imm: val("ff_imm"), spotted: val("ff_sp"), nc: val("ff_nc"), humidity: val("ff_hum"), browns: val("ff_browns"), voids: val("ff_voids"), oil: val("ff_oil") }, decision, val("ff_bin"));
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
  UI.addToBin = function (binId) {
    try { R.addLotToBin(binId, val("bin_lot"), val("bin_qty")); toast("Lot ajouté en BIN."); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.prepareTransfer = function (cycleId) {
    try { var trf = R.prepareTransfer(decodeURIComponent(cycleId), val("bin_out"), "Calibrage"); toast("Transfert " + trf.id + " préparé."); go("transfert/" + trf.id); route(); }
    catch (e) { toast(e.message, true); }
  };
  UI.qaApprove = function (id) { try { R.qaApproveTransfer(id, true, "Contrôle OK"); toast("QA approuvé."); route(); } catch (e) { toast(e.message, true); } };
  UI.ship = function (id) { try { R.shipTransfer(id); toast("Transfert expédié."); route(); } catch (e) { toast(e.message, true); } };
  UI.resolveEcart = function (id) { try { R.resolveTransferEcart(id, val("trf_motif")); toast("Écart justifié."); route(); } catch (e) { toast(e.message, true); } };
  UI.receiveTrf = function (id) {
    var trf = R.getTrf(id); if (!trf) return;
    var p = prompt("Poids reçu (kg) pour " + id + " — envoyé " + trf.poidsEnvoye + " kg :", trf.poidsEnvoye); if (p === null) return;
    try {
      R.receiveTransfer(id, p, false);
      var mach = prompt("Machine (ex. CAL-01) :", "CAL-01") || "CAL-01";
      var cal = R.createCal(id, mach, "A", "");
      toast("TRF reçu · " + cal.id + " créé."); go("calibrage/" + cal.id); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.calStart = function (id) { try { R.calStart(id); toast("Opération démarrée."); route(); } catch (e) { toast(e.message, true); } };
  UI.calResume = function (id) { try { R.calResume(id); toast("Reprise."); route(); } catch (e) { toast(e.message, true); } };
  UI.calPause = function (id) {
    var m = prompt("Motif de pause (obligatoire) :\n" + R.MOTIFS_ARRET.join(" · ")); if (!m) return;
    try { R.calPause(id, m); toast("En pause : " + m); route(); } catch (e) { toast(e.message, true); }
  };
  UI.calFeed = function (id) { try { R.calFeed(id, val("feed_qty"), val("feed_bin")); toast("Alimentation enregistrée."); route(); } catch (e) { toast(e.message, true); } };
  UI.saveOutputs = function (id) {
    try {
      R.referentials().calibres.forEach(function (cal) {
        var p = val("o_poids_" + cal);
        if (p !== "" && p != null) R.calOutput(id, cal, val("o_sacs_" + cal), p, val("o_bin_" + cal));
      });
      R.CATEGORIES_PERTE.forEach(function (l) { var p = val("l_" + l.code); if (p !== "" && p != null) R.calLoss(id, l.code, p, "", ""); });
      toast("Sorties enregistrées."); route();
    } catch (e) { toast(e.message, true); }
  };
  UI.calClose = function (id) {
    try { R.calClose(id, val("cal_motif")); toast("Opération clôturée."); route(); }
    catch (e) { toast(e.message, true); }
  };

  global.RCNUI = UI;

  /* ---------------- Live KOR (sampling & finale) ------------------- */
  document.addEventListener("input", function (ev) {
    var id = ev.target.id;
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

  /* ---------------- Boot ------------------------------------------- */
  function boot() {
    if (!global.RCN) { setTimeout(boot, 60); return; }
    R = global.RCN;
    R.seedDemo(false);
    var u = R.db().user;
    if (el("whoName")) el("whoName").textContent = u.nom;
    if (el("whoRole")) el("whoRole").textContent = u.role;
    global.RCNTRACE_ONSAVE = function () { /* hook de resynchro éventuelle */ };
    window.addEventListener("hashchange", route);
    setNet();
    if (!location.hash) location.hash = "accueil";
    route();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

})(window);
