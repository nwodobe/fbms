/* ============================================================================
   ASSISTANT IA AFLP — INTERFACE (shared/aflp-ia-ui.js)
   ----------------------------------------------------------------------------
   Panneau d'assistance métier intégré au Command Center BM (terrain/command.html).

   Ce fichier ne calcule RIEN : tous les chiffres viennent de shared/aflp-ia-moteur.js.
   S'il fallait recalculer une valeur ici, ce serait une seconde vérité métier —
   et deux vérités qui divergent valent moins qu'aucune.

   Sécurité d'affichage : toute donnée provenant de la base est échappée avant
   insertion dans le DOM (`esc`). Aucun `innerHTML` ne reçoit de valeur brute.

   API :
     AFLP_IA_UI.monter("aflpIa")     — construit la coquille une seule fois
     AFLP_IA_UI.rafraichir(donnees)  — recalcule et réaffiche
   ========================================================================== */
(function (global) {
  "use strict";

  var ETAT = null, REFI = null, ALERTES = [], SYNTHESE = null;
  var CONTENEUR = null, ONGLET = "synthese", MONTE = false;
  var CONVERSATION = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* Un texte multiligne produit par le moteur : chaque ligne échappée, les
     sauts de ligne rendus en <br>. */
  function escMulti(s) {
    return esc(s).replace(/\n/g, "<br>");
  }

  function $(id) { return document.getElementById(id); }

  var CLASSE_SEVERITE = { critique: "bhi", majeure: "bmd", mineure: "blo" };

  /* ==========================================================================
     Styles — injectés une seule fois, préfixés `aflp-` pour ne rien écraser
     de la feuille du Command Center.
     ====================================================================== */
  var STYLES = [
    "#aflpIa .aflp-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line,#E8E7E7);background:#fbfdfa}",
    "#aflpIa .aflp-tab{border:1px solid #d8e6d6;background:#fff;color:#00712C;border-radius:10px;padding:10px 14px;min-height:44px;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit}",
    "#aflpIa .aflp-tab[aria-selected=\"true\"]{background:#008F37;border-color:#008F37;color:#fff}",
    "#aflpIa .aflp-tab:focus-visible{outline:3px solid #EE9E00;outline-offset:2px}",
    "#aflpIa .aflp-corps{padding:14px}",
    "#aflpIa .aflp-note{background:#FDEFCE;border:1px solid #f0d99a;color:#6b5310;border-radius:12px;padding:10px 12px;font-size:12px;margin-bottom:12px;line-height:1.5}",
    "#aflpIa .aflp-entete{background:linear-gradient(135deg,#03301c,#053B23);color:#eafff2;border-radius:14px;padding:14px 16px;font-size:13.5px;font-weight:700;line-height:1.5;margin-bottom:14px}",
    "#aflpIa .aflp-grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}",
    "#aflpIa .aflp-bloc{border:1px solid var(--line,#E8E7E7);border-radius:14px;padding:12px 14px;background:#fff}",
    "#aflpIa .aflp-bloc h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#00712C;font-family:'Archivo',Arial,sans-serif}",
    "#aflpIa .aflp-bloc dl{margin:0;display:grid;grid-template-columns:1fr auto;gap:5px 10px;font-size:12.5px}",
    "#aflpIa .aflp-bloc dt{color:#7A7878}",
    "#aflpIa .aflp-bloc dd{margin:0;text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:700;color:#053B23}",
    "#aflpIa .aflp-com{margin:9px 0 0;font-size:12px;color:#5c6b60;line-height:1.5;border-top:1px dashed #e5eee3;padding-top:8px}",
    "#aflpIa .aflp-decision{display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-top:1px solid #f0ede4}",
    "#aflpIa .aflp-decision:first-child{border-top:0}",
    "#aflpIa .aflp-rang{min-width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-weight:800;font-family:'IBM Plex Mono',monospace;background:#E0F3DE;color:#00712C;flex:none}",
    "#aflpIa .aflp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}",
    "#aflpIa .aflp-btn{border:0;border-radius:10px;background:#008F37;color:#fff;font-weight:800;padding:11px 14px;min-height:44px;cursor:pointer;font-size:12.5px;font-family:inherit}",
    "#aflpIa .aflp-btn.ghost{background:#fff;color:#00712C;border:1px solid #cfe3cf}",
    "#aflpIa .aflp-btn:focus-visible{outline:3px solid #EE9E00;outline-offset:2px}",
    "#aflpIa table.aflp-t{width:100%;border-collapse:collapse}",
    "#aflpIa table.aflp-t th{background:#053B23;color:#d8ead3;font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:8px;text-align:left}",
    "#aflpIa table.aflp-t td{padding:8px;border-top:1px solid #f0ede4;font-size:12.5px;vertical-align:top}",
    "#aflpIa table.aflp-t td.num,#aflpIa table.aflp-t th.num{text-align:right;font-family:'IBM Plex Mono',monospace}",
    "#aflpIa .aflp-go{color:#00712C;font-weight:800}",
    "#aflpIa .aflp-nogo{color:#C0392B;font-weight:800}",
    "#aflpIa .aflp-motifs{color:#7A7878;font-size:11.5px;margin-top:3px;line-height:1.45}",
    "#aflpIa .aflp-scroll{max-height:46vh;overflow:auto}",
    "#aflpIa .aflp-question{display:flex;gap:8px;flex-wrap:wrap}",
    "#aflpIa .aflp-question input{flex:1;min-width:200px;min-height:44px;border:1px solid #cfe3cf;border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;color:#323131}",
    "#aflpIa .aflp-question input:focus-visible{outline:3px solid #EE9E00;outline-offset:1px}",
    "#aflpIa .aflp-exemples{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px}",
    "#aflpIa .aflp-ex{border:1px solid #d8e6d6;background:#F1F9EF;color:#00712C;border-radius:999px;padding:8px 12px;min-height:36px;font-size:11.5px;cursor:pointer;font-family:inherit}",
    "#aflpIa .aflp-echange{border:1px solid var(--line,#E8E7E7);border-radius:14px;padding:12px 14px;margin-top:12px;background:#fff}",
    "#aflpIa .aflp-dit{font-weight:800;color:#053B23;font-size:13px;margin:0 0 7px}",
    "#aflpIa .aflp-rep{font-size:13px;line-height:1.6;color:#323131;margin:0}",
    "#aflpIa .aflp-chiffres{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
    "#aflpIa .aflp-chiffre{background:#F1F9EF;border-radius:10px;padding:7px 10px;font-size:11.5px;color:#00712C}",
    "#aflpIa .aflp-chiffre b{display:block;font-family:'IBM Plex Mono',monospace;color:#053B23;font-size:13px}",
    "#aflpIa .aflp-source{font-size:11px;color:#7A7878;margin-top:9px}",
    "#aflpIa .aflp-vide{padding:28px 16px;text-align:center;color:#00712C;font-size:13px}",
    "@media(max-width:620px){#aflpIa .aflp-tab{flex:1 1 45%}#aflpIa .aflp-corps{padding:10px}",
    /* Sur mobile, la colonne de droite écrasait les libellés longs : on
       repasse en une seule colonne, valeur sous son libellé. */
    "#aflpIa .aflp-bloc dl{grid-template-columns:1fr;gap:2px}",
    "#aflpIa .aflp-bloc dt{margin-top:6px}",
    "#aflpIa .aflp-bloc dd{text-align:left}}"
  ].join("\n");

  function injecterStyles() {
    if ($("aflp-ia-styles")) return;
    var s = document.createElement("style");
    s.id = "aflp-ia-styles";
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  /* ==========================================================================
     Coquille et navigation
     ====================================================================== */

  var ONGLETS = [
    { cle: "synthese", label: "Synthèse du jour" },
    { cle: "alertes", label: "Alertes" },
    { cle: "refinancement", label: "Refinancement" },
    { cle: "questions", label: "Poser une question" }
  ];

  function monter(idConteneur) {
    CONTENEUR = $(idConteneur || "aflpIa");
    if (!CONTENEUR || MONTE) return;
    injecterStyles();

    var html = '<h2>Assistant IA AFLP <span class="mini">assistance métier · calcul déterministe</span></h2>' +
      '<div class="aflp-tabs" role="tablist" aria-label="Assistant IA AFLP">' +
      ONGLETS.map(function (o) {
        return '<button type="button" class="aflp-tab" role="tab" id="aflp-tab-' + o.cle +
          '" aria-controls="aflp-panneau" aria-selected="' + (o.cle === ONGLET) + '" data-onglet="' +
          o.cle + '">' + esc(o.label) + "</button>";
      }).join("") +
      "</div>" +
      '<div class="aflp-corps" id="aflp-panneau" role="tabpanel" aria-live="polite">' +
      '<p class="aflp-vide">Chargement des données du pilote…</p></div>';
    CONTENEUR.innerHTML = html;

    CONTENEUR.addEventListener("click", function (ev) {
      var t = ev.target.closest("[data-onglet]");
      if (t) { choisirOnglet(t.getAttribute("data-onglet")); return; }
      var ex = ev.target.closest("[data-exemple]");
      if (ex) {
        var champ = $("aflp-champ");
        if (champ) { champ.value = ex.getAttribute("data-exemple"); poser(); }
        return;
      }
      var act = ev.target.closest("[data-action]");
      if (act) executer(act.getAttribute("data-action"));
    });

    CONTENEUR.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && ev.target && ev.target.id === "aflp-champ") {
        ev.preventDefault(); poser();
      }
    });

    MONTE = true;
  }

  function choisirOnglet(cle) {
    ONGLET = cle;
    ONGLETS.forEach(function (o) {
      var b = $("aflp-tab-" + o.cle);
      if (b) b.setAttribute("aria-selected", String(o.cle === cle));
    });
    rendre();
  }

  function executer(action) {
    if (action === "copier") copierSynthese();
    else if (action === "telecharger") telechargerSynthese();
    else if (action === "poser") poser();
  }

  /* ==========================================================================
     Calcul
     ====================================================================== */

  function rafraichir(donnees) {
    if (!global.AFLP_IA) return;
    if (!MONTE) monter("aflpIa");
    ETAT = global.AFLP_IA.construireEtat(donnees || {});
    REFI = global.AFLP_IA.refinancement(ETAT);
    ALERTES = global.AFLP_IA.alertes(ETAT, REFI);
    SYNTHESE = global.AFLP_IA.synthese(ETAT, REFI, ALERTES);
    rendre();
  }

  function rendre() {
    var p = $("aflp-panneau");
    if (!p) return;
    if (!ETAT) { p.innerHTML = '<p class="aflp-vide">Chargement des données du pilote…</p>'; return; }
    if (ONGLET === "synthese") p.innerHTML = vueSynthese();
    else if (ONGLET === "alertes") p.innerHTML = vueAlertes();
    else if (ONGLET === "refinancement") p.innerHTML = vueRefinancement();
    else p.innerHTML = vueQuestions();
  }

  function bandeauHypothese() {
    if (!ETAT || ETAT.referentiel.zonesConfirmees) return "";
    return '<p class="aflp-note"><b>Hypothèse à confirmer.</b> La répartition ' +
      'GBEKE 1 (Djébonoua, Brobo, Diabo) / GBEKE 2 (Sakassou, Béoumi, Botro) n\'a pas été ' +
      'validée par le Branch Manager. Les totaux par cluster sont exacts ; ceux par zone ' +
      'restent indicatifs tant que la répartition n\'est pas confirmée.</p>';
  }

  /* ==========================================================================
     Vue 1 — Synthèse quotidienne
     ====================================================================== */

  function vueSynthese() {
    var f = global.AFLP_IA.format;
    var h = bandeauHypothese();
    h += '<div class="aflp-entete">' + escMulti(SYNTHESE.enTete) + "</div>";
    h += '<div class="aflp-actions">' +
      '<button type="button" class="aflp-btn" data-action="copier">Copier la synthèse</button>' +
      '<button type="button" class="aflp-btn ghost" data-action="telecharger">Télécharger (.txt)</button>' +
      "</div>";

    h += '<div class="aflp-bloc" style="margin-bottom:12px"><h3>Décisions du jour</h3>';
    SYNTHESE.decisions.forEach(function (d, i) {
      h += '<div class="aflp-decision"><span class="aflp-rang">' + (i + 1) + "</span><span>" +
        '<span class="badge ' + (CLASSE_SEVERITE[d.severite] || "blo") + '">' + esc(d.severite) + "</span> " +
        "<b>" + esc(d.action) + "</b>" +
        '<div class="aflp-motifs">' + esc(d.pourquoi) + "</div></span></div>";
    });
    h += "</div>";

    h += '<div class="aflp-grille">';
    SYNTHESE.sections.forEach(function (s) {
      h += '<div class="aflp-bloc"><h3>' + esc(s.titre) + "</h3><dl>";
      s.lignes.forEach(function (l) {
        h += "<dt>" + esc(l.libelle) + "</dt><dd>" + esc(l.valeur) + "</dd>";
      });
      h += "</dl>" + (s.commentaire ? '<p class="aflp-com">' + esc(s.commentaire) + "</p>" : "") + "</div>";
    });
    h += "</div>";

    h += '<div class="aflp-bloc" style="margin-top:12px"><h3>Zones et clusters</h3>' +
      '<div class="aflp-scroll"><table class="aflp-t"><thead><tr>' +
      "<th>Cluster</th><th>Zone</th><th class=\"num\">Volume MT</th><th class=\"num\">Quote-part</th>" +
      "<th class=\"num\">Avances</th><th class=\"num\">Solde</th><th class=\"num\">Sacs</th>" +
      "</tr></thead><tbody>";
    SYNTHESE.clusters.forEach(function (c) {
      h += "<tr><td><b>" + esc(c.label) + "</b></td><td>" + esc(c.zone) + "</td>" +
        '<td class="num">' + esc(f.mt(c.volumeKg)) + "</td>" +
        '<td class="num">' + (c.pctObjectif != null ? esc(f.pourcent(c.pctObjectif)) : "—") + "</td>" +
        '<td class="num">' + esc(f.nombre(c.avances)) + "</td>" +
        '<td class="num"' + (c.solde < 0 ? ' style="color:#C0392B;font-weight:800"' : "") + ">" +
        esc(f.nombre(c.solde)) + "</td>" +
        '<td class="num"' + (c.sacs < 0 ? ' style="color:#C0392B;font-weight:800"' : "") + ">" +
        esc(f.nombre(c.sacs)) + "</td></tr>";
    });
    h += "</tbody></table></div>";
    h += '<p class="aflp-source">Source : ' + esc(SYNTHESE.sources.map(function (s) {
      return s.table + " (" + s.lignes + ")";
    }).join(" · ")) + " · calcul local, sans appel externe.</p></div>";
    return h;
  }

  function copierSynthese() {
    var t = global.AFLP_IA.syntheseTexte(SYNTHESE);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { signaler("Synthèse copiée."); },
        function () { signaler("Copie refusée par le navigateur."); });
    } else {
      signaler("Copie non disponible sur ce navigateur : utilisez le téléchargement.");
    }
  }

  function telechargerSynthese() {
    var t = global.AFLP_IA.syntheseTexte(SYNTHESE);
    var b = new Blob([t], { type: "text/plain;charset=utf-8" });
    var u = URL.createObjectURL(b);
    var a = document.createElement("a");
    a.href = u;
    a.download = "synthese-aflp-" + ETAT.dateRef + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
  }

  function signaler(message) {
    var p = $("aflp-panneau");
    if (!p) return;
    var n = document.createElement("p");
    n.className = "aflp-note";
    n.setAttribute("role", "status");
    n.textContent = message;
    p.insertBefore(n, p.firstChild);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 4000);
  }

  /* ==========================================================================
     Vue 2 — Alertes
     ====================================================================== */

  function vueAlertes() {
    var f = global.AFLP_IA.format;
    if (!ALERTES.length) {
      return bandeauHypothese() +
        '<div class="aflp-vide"><b>Aucune anomalie détectée au ' + esc(ETAT.dateRef) + ".</b>" +
        "<p>Volume, caisse, réconciliation, sacherie et qualité sont cohérents sur les " +
        "contrôles disponibles.</p></div>";
    }
    var compte = { critique: 0, majeure: 0, mineure: 0 };
    ALERTES.forEach(function (a) { compte[a.severite]++; });

    var h = bandeauHypothese();
    h += '<div class="aflp-chiffres" style="margin-bottom:12px">' +
      '<span class="aflp-chiffre">Critiques<b>' + compte.critique + "</b></span>" +
      '<span class="aflp-chiffre">Majeures<b>' + compte.majeure + "</b></span>" +
      '<span class="aflp-chiffre">Mineures<b>' + compte.mineure + "</b></span></div>";

    h += '<div class="aflp-scroll"><table class="aflp-t"><thead><tr>' +
      "<th>Sévérité</th><th>Anomalie</th><th class=\"num\">Nombre</th><th>Code</th>" +
      "</tr></thead><tbody>";
    ALERTES.forEach(function (a) {
      var titre = a.lien
        ? '<a href="' + esc(a.lien) + '" style="color:#00712C;font-weight:800">' + esc(a.titre) + "</a>"
        : "<b>" + esc(a.titre) + "</b>";
      h += "<tr><td><span class=\"badge " + (CLASSE_SEVERITE[a.severite] || "blo") + '">' +
        esc(a.severite) + "</span></td><td>" + titre +
        '<div class="aflp-motifs">' + esc(a.detail) + "</div></td>" +
        '<td class="num">' + esc(f.nombre(a.valeur)) + " " + esc(a.unite) + "</td>" +
        '<td class="aflp-motifs">' + esc(a.code) + "</td></tr>";
    });
    h += "</tbody></table></div>";
    h += '<p class="aflp-source">Chaque code est stable dans le temps : il peut être cité ' +
      "dans un compte rendu ou une consigne terrain.</p>";
    return h;
  }

  /* ==========================================================================
     Vue 3 — Refinancement
     ====================================================================== */

  function vueRefinancement() {
    var f = global.AFLP_IA.format;
    var g = REFI.global;
    var h = bandeauHypothese();

    h += '<div class="aflp-entete">' + esc(REFI.regle) + "<br>" +
      "Statut global au " + esc(REFI.dateRef) + " : <b>" + esc(g.statut) + "</b> · " +
      esc(String(g.rtGo)) + " équipe(s) sur " + esc(String(g.rtEvalues)) + " refinançables</div>";

    h += '<div class="aflp-grille" style="margin-bottom:12px">' +
      '<div class="aflp-bloc"><h3>Débloquable immédiatement</h3><dl>' +
      "<dt>Montant</dt><dd>" + esc(f.francs(g.montantDebloquable)) + "</dd>" +
      "<dt>Équipes GO</dt><dd>" + esc(String(g.rtGo)) + "</dd>" +
      "<dt>Avances couvertes</dt><dd>" + esc(f.francs(g.avancesCouvertes)) + "</dd></dl></div>" +
      '<div class="aflp-bloc"><h3>Bloqué par la règle AFLP</h3><dl>' +
      "<dt>Montant</dt><dd>" + esc(f.francs(g.montantBloque)) + "</dd>" +
      "<dt>Équipes NO-GO</dt><dd>" + esc(String(g.rtNoGo)) + "</dd>" +
      "<dt>Avances non couvertes</dt><dd>" + esc(f.francs(g.avancesNonCouvertes)) + "</dd></dl>" +
      '<p class="aflp-com">Un montant bloqué n\'est pas un montant perdu : il redevient ' +
      "débloquable dès que la réconciliation de l'équipe est saisie et validée.</p></div></div>";

    if (REFI.parCluster.length) {
      h += '<div class="aflp-bloc" style="margin-bottom:12px"><h3>Par cluster</h3>' +
        '<table class="aflp-t"><thead><tr><th>Cluster</th><th>Zone</th><th>Statut</th>' +
        "<th class=\"num\">GO</th><th class=\"num\">NO-GO</th><th class=\"num\">Débloquable</th>" +
        "<th class=\"num\">Bloqué</th></tr></thead><tbody>";
      REFI.parCluster.forEach(function (c) {
        h += "<tr><td><b>" + esc(c.label) + "</b></td><td>" + esc(c.zone) + "</td>" +
          '<td class="' + (c.statut === "GO" ? "aflp-go" : "aflp-nogo") + '">' + esc(c.statut) + "</td>" +
          '<td class="num">' + esc(String(c.rtGo)) + "</td>" +
          '<td class="num">' + esc(String(c.rtNoGo)) + "</td>" +
          '<td class="num">' + esc(f.nombre(c.montantDebloquable)) + "</td>" +
          '<td class="num">' + esc(f.nombre(c.montantBloque)) + "</td></tr>";
      });
      h += "</tbody></table></div>";
    }

    if (!REFI.parRT.length) {
      h += '<div class="aflp-vide">Aucune équipe RT ne porte encore d\'avance ni d\'achat : ' +
        "la question du refinancement ne se pose pas.</div>";
      return h;
    }

    h += '<div class="aflp-bloc"><h3>Par équipe RT</h3><div class="aflp-scroll">' +
      '<table class="aflp-t"><thead><tr><th>Équipe</th><th>Cluster</th><th>Statut</th>' +
      "<th class=\"num\">Avancé</th><th class=\"num\">Payé</th><th class=\"num\">Refinançable</th>" +
      "<th>Dernière réconciliation</th></tr></thead><tbody>";
    REFI.parRT.forEach(function (r) {
      h += "<tr><td><b>" + esc(r.nom) + "</b>" +
        (r.motifs.length ? '<div class="aflp-motifs">' + esc(r.motifs.join(" · ")) + "</div>" : "") +
        "</td><td>" + esc(r.cluster || "—") + "</td>" +
        '<td class="' + (r.statut === "GO" ? "aflp-go" : "aflp-nogo") + '">' + esc(r.statut) + "</td>" +
        '<td class="num">' + esc(f.nombre(r.avances)) + "</td>" +
        '<td class="num">' + esc(f.nombre(r.paye)) + "</td>" +
        '<td class="num">' + esc(f.nombre(r.montantRefinancable)) + "</td>" +
        "<td>" + (r.reconJour ? esc(r.reconJour) + " · " + esc(r.reconStatut) : "aucune") + "</td></tr>";
    });
    h += "</tbody></table></div></div>";
    return h;
  }

  /* ==========================================================================
     Vue 4 — Questions en langage naturel
     ====================================================================== */

  function vueQuestions() {
    var h = bandeauHypothese();
    h += '<div class="aflp-question">' +
      '<label for="aflp-champ" class="aflp-source" style="width:100%;margin:0 0 6px">' +
      "Posez votre question sur les données du pilote AFLP</label>" +
      '<input id="aflp-champ" type="text" autocomplete="off" ' +
      'placeholder="Exemple : quels RT sont bloqués pour refinancement ?">' +
      '<button type="button" class="aflp-btn" data-action="poser">Répondre</button></div>';

    h += '<div class="aflp-exemples">' + global.AFLP_IA.questionsTypes.map(function (q) {
      return '<button type="button" class="aflp-ex" data-exemple="' + esc(q) + '">' + esc(q) + "</button>";
    }).join("") + "</div>";

    if (!CONVERSATION.length) {
      h += '<div class="aflp-vide">L\'assistant répond uniquement à partir des données FBMS ' +
        "chargées dans cette page. Il calcule, il ne devine pas : quand une question sort de " +
        "son périmètre, il le dit.</div>";
      return h;
    }

    CONVERSATION.forEach(function (e) {
      h += '<div class="aflp-echange"><p class="aflp-dit">' + esc(e.question) + "</p>" +
        '<p class="aflp-rep">' + escMulti(e.reponse.texte) + "</p>";
      if (e.reponse.chiffres.length) {
        h += '<div class="aflp-chiffres">' + e.reponse.chiffres.map(function (c) {
          return '<span class="aflp-chiffre">' + esc(c.libelle) + "<b>" + esc(c.valeur) + "</b></span>";
        }).join("") + "</div>";
      }
      if (e.reponse.confiance === "nulle" || e.reponse.confiance === "faible") {
        h += '<p class="aflp-note" style="margin:10px 0 0">Réponse incertaine — l\'assistant ' +
          "préfère le dire plutôt que produire un chiffre non fondé.</p>";
      }
      h += '<p class="aflp-source">' + esc(e.reponse.sources.join(" · ")) + "</p></div>";
    });
    return h;
  }

  function poser() {
    var champ = $("aflp-champ");
    if (!champ || !ETAT) return;
    var question = champ.value.trim();
    if (!question) return;
    var rep = global.AFLP_IA.repondre(question, ETAT, REFI, ALERTES);
    CONVERSATION.unshift({ question: question, reponse: rep });
    if (CONVERSATION.length > 20) CONVERSATION.length = 20;
    rendre();
    var c = $("aflp-champ");
    if (c) c.focus();
  }

  global.AFLP_IA_UI = {
    monter: monter,
    rafraichir: rafraichir,
    /* Exposé pour les contrôles automatisés : permet de vérifier l'état affiché
       sans dépendre du rendu HTML. */
    etatCourant: function () { return { etat: ETAT, refinancement: REFI, alertes: ALERTES }; }
  };

})(typeof window !== "undefined" ? window : this);
