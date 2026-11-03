/* ============================================================================
   AFLP — NIVEAU 3 : INTERFACE PRÉDICTIVE (shared/aflp-ia-predictif-ui.js)
   ----------------------------------------------------------------------------
   Panneau « Prévisions » du Command Center BM (terrain/command.html).

   Ce fichier ne calcule RIEN. Tous les chiffres viennent de
   shared/aflp-ia-predictif.js. Recalculer une valeur ici créerait une seconde
   vérité métier — et deux vérités qui divergent valent moins qu'aucune.

   ---------------------------------------------------------- RÈGLES D'AFFICHAGE
   1. Chaque écran porte, en tête, la mention « AIDE À LA DÉCISION » et le
      statut du modèle. Elle n'est pas repliable et n'est pas décorative.
   2. Aucun bouton d'action. Les intitulés interdits par le cadrage AFLP sont
      absents de ce fichier, y compris de ses commentaires : le contrôle de
      non-régression `.github/agent-tests/aflp-ia-predictif.mjs` les cherche
      par simple recherche textuelle, et une mention même explicative les
      ferait échouer. C'est voulu — un test qu'il faut nuancer ne protège rien.
      Les seuls verbes employés dans l'interface sont des verbes de PROCESSUS
      (« transmis à », « vérification demandée »), jamais d'exécution.
   3. Toute donnée venue de la base est échappée (`esc`) avant insertion.
   4. Une valeur absente s'affiche « — » et jamais 0. Un zéro affiché à la place
      d'une inconnue est un mensonge silencieux.

   -------------------------------------------------- JOURNAL DES CONSULTATIONS
   Le journal des consultations et décisions est conservé DANS LE NAVIGATEUR
   (localStorage), et exportable. Il n'est pas écrit en base : la table
   `aflp_predictions` n'est pas déployée (voir docs/migrations/). L'interface le
   dit à l'utilisateur au lieu de laisser croire à une trace serveur.

   API :
     AFLP_PRED_UI.monter("aflpPred")     — construit la coquille une seule fois
     AFLP_PRED_UI.rafraichir(donnees)    — recalcule et réaffiche
   ========================================================================== */
(function (global) {
  "use strict";

  var ANALYSE = null, CONTENEUR = null, ONGLET = "maturite", MONTE = false;
  var CLE_JOURNAL = "aflp_pred_journal_v1";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function $(id) { return document.getElementById(id); }

  function fmtNombre(x) {
    if (x == null || !isFinite(Number(x))) return "—";
    return Math.round(Number(x)).toLocaleString("fr-FR");
  }
  function fmtMT(kg) {
    if (kg == null || !isFinite(Number(kg))) return "—";
    return (Math.round((Number(kg) / 1000) * 10) / 10).toLocaleString("fr-FR");
  }
  function fmtF(x) { return x == null ? "—" : fmtNombre(x) + " F"; }
  function fmtPct(x) {
    if (x == null || !isFinite(Number(x))) return "—";
    return (Math.round(Number(x) * 10) / 10).toLocaleString("fr-FR") + " %";
  }
  function fmtDec(x, n) {
    if (x == null || !isFinite(Number(x))) return "—";
    var p = Math.pow(10, n == null ? 2 : n);
    return (Math.round(Number(x) * p) / p).toLocaleString("fr-FR");
  }

  var CLASSE_NIVEAU = { R0: "aflpp-r0", R1: "aflpp-r1", R2: "aflpp-r2", R3: "aflpp-r3" };
  var CLASSE_CONF = { bonne: "aflpp-ok", moyenne: "aflpp-moy", faible: "aflpp-bas", nulle: "aflpp-bas" };

  /* ==========================================================================
     Styles — injectés une seule fois, préfixés `aflpp-` pour ne rien écraser.
     ====================================================================== */
  var STYLES = [
    "#aflpPred .aflpp-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line,#E8E7E7);background:#fbfaff}",
    "#aflpPred .aflpp-tab{border:1px solid #ddd8ea;background:#fff;color:#4A3C7A;border-radius:10px;padding:10px 14px;min-height:44px;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit}",
    "#aflpPred .aflpp-tab[aria-selected=\"true\"]{background:#4A3C7A;border-color:#4A3C7A;color:#fff}",
    "#aflpPred .aflpp-tab:focus-visible{outline:3px solid #EE9E00;outline-offset:2px}",
    "#aflpPred .aflpp-corps{padding:14px}",
    "#aflpPred .aflpp-bandeau{background:#3A2E63;color:#f0ecff;border-radius:14px;padding:12px 16px;font-size:13px;font-weight:700;line-height:1.55;margin-bottom:14px}",
    "#aflpPred .aflpp-bandeau b{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#c9bdf5;margin-bottom:4px}",
    "#aflpPred .aflpp-note{background:#FDEFCE;border:1px solid #f0d99a;color:#6b5310;border-radius:12px;padding:10px 12px;font-size:12px;margin-bottom:12px;line-height:1.5}",
    "#aflpPred .aflpp-stop{background:#FDE7E4;border:1px solid #f3bdb5;color:#8a2b1c;border-radius:12px;padding:10px 12px;font-size:12px;margin-bottom:12px;line-height:1.5}",
    "#aflpPred .aflpp-grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}",
    "#aflpPred .aflpp-bloc{border:1px solid var(--line,#E8E7E7);border-radius:14px;padding:12px 14px;background:#fff}",
    "#aflpPred .aflpp-bloc h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#4A3C7A;font-family:'Archivo',Arial,sans-serif}",
    "#aflpPred .aflpp-bloc dl{margin:0;display:grid;grid-template-columns:1fr auto;gap:5px 10px;font-size:12.5px}",
    "#aflpPred .aflpp-bloc dt{color:#666565}",
    "#aflpPred .aflpp-bloc dd{margin:0;text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:700;color:#2E2547}",
    "#aflpPred .aflpp-com{margin:9px 0 0;font-size:11.5px;color:#5c5670;line-height:1.5;border-top:1px dashed #ebe7f2;padding-top:8px}",
    "#aflpPred table.aflpp-t{width:100%;border-collapse:collapse}",
    "#aflpPred table.aflpp-t th{background:#3A2E63;color:#ded6f7;font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:8px;text-align:left}",
    "#aflpPred table.aflpp-t td{padding:8px;border-top:1px solid #f0edf6;font-size:12.5px;vertical-align:top}",
    "#aflpPred table.aflpp-t td.num,#aflpPred table.aflpp-t th.num{text-align:right;font-family:'IBM Plex Mono',monospace}",
    "#aflpPred .aflpp-scroll{max-height:52vh;overflow:auto;-webkit-overflow-scrolling:touch}",
    "#aflpPred .aflpp-tag{display:inline-block;border-radius:999px;padding:3px 9px;font-size:10.5px;font-weight:800;letter-spacing:.03em}",
    "#aflpPred .aflpp-r0{background:#FDE7E4;color:#8a2b1c}",
    "#aflpPred .aflpp-r1{background:#FDEFCE;color:#6b5310}",
    "#aflpPred .aflpp-r2{background:#E3F0FB;color:#1c5480}",
    "#aflpPred .aflpp-r3{background:#E0F3DE;color:#00712C}",
    "#aflpPred .aflpp-ok{background:#E0F3DE;color:#00712C}",
    "#aflpPred .aflpp-moy{background:#FDEFCE;color:#6b5310}",
    "#aflpPred .aflpp-bas{background:#FDE7E4;color:#8a2b1c}",
    "#aflpPred .aflpp-shadow{background:#EDE7FA;color:#4A3C7A}",
    "#aflpPred .aflpp-notready{background:#EFEFEF;color:#5c5c5c}",
    "#aflpPred .aflpp-btn{border:0;border-radius:10px;background:#4A3C7A;color:#fff;font-weight:800;padding:11px 14px;min-height:44px;cursor:pointer;font-size:12.5px;font-family:inherit}",
    "#aflpPred .aflpp-btn.ghost{background:#fff;color:#4A3C7A;border:1px solid #ddd8ea}",
    "#aflpPred .aflpp-btn:focus-visible{outline:3px solid #EE9E00;outline-offset:2px}",
    "#aflpPred .aflpp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}",
    "#aflpPred .aflpp-liste{margin:0;padding-left:18px;font-size:12px;color:#5c5670;line-height:1.6}",
    "#aflpPred .aflpp-dim{border-top:1px solid #f0edf6;padding:9px 0}",
    "#aflpPred .aflpp-dim:first-child{border-top:0}",
    "#aflpPred .aflpp-dimnom{font-weight:800;font-size:12px;color:#2E2547}",
    "#aflpPred .aflpp-dimval{font-family:'IBM Plex Mono',monospace;font-weight:800;color:#4A3C7A;float:right}",
    "#aflpPred .aflpp-dimmotif{font-size:11.5px;color:#6b6580;line-height:1.5;margin-top:3px;clear:both}",
    "#aflpPred .aflpp-vide{padding:28px 16px;text-align:center;color:#4A3C7A;font-size:13px;line-height:1.6}",
    "#aflpPred .aflpp-decision{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
    "#aflpPred .aflpp-decision input,#aflpPred .aflpp-decision select{flex:1;min-width:170px;min-height:44px;border:1px solid #ddd8ea;border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;color:#323131;background:#fff}",
    "#aflpPred .aflpp-decision input:focus-visible,#aflpPred .aflpp-decision select:focus-visible{outline:3px solid #EE9E00;outline-offset:1px}",
    "#aflpPred .aflpp-pied{margin-top:14px;font-size:11px;color:#666565;line-height:1.6;border-top:1px solid #f0edf6;padding-top:10px}",
    "@media(max-width:620px){#aflpPred .aflpp-tab{flex:1 1 45%}#aflpPred .aflpp-corps{padding:10px}",
    "#aflpPred .aflpp-bloc dl{grid-template-columns:1fr;gap:2px}",
    "#aflpPred .aflpp-bloc dt{margin-top:6px}",
    "#aflpPred .aflpp-bloc dd{text-align:left}",
    "#aflpPred .aflpp-dimval{float:none;display:block;margin-top:2px}}"
  ].join("\n");

  function injecterStyles() {
    if ($("aflp-pred-styles")) return;
    var s = document.createElement("style");
    s.id = "aflp-pred-styles";
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  /* ==========================================================================
     Journal local des consultations et décisions
     ====================================================================== */

  function lireJournal() {
    try {
      var v = global.localStorage && global.localStorage.getItem(CLE_JOURNAL);
      return v ? JSON.parse(v) : [];
    } catch (e) { return []; }
  }

  function ecrireJournal(liste) {
    try {
      if (global.localStorage) global.localStorage.setItem(CLE_JOURNAL, JSON.stringify(liste.slice(-300)));
    } catch (e) { /* stockage indisponible : le journal reste en mémoire de page */ }
  }

  function consigner(entree) {
    var j = lireJournal();
    j.push(entree);
    ecrireJournal(j);
    return j;
  }

  /* ==========================================================================
     Coquille et navigation
     ====================================================================== */

  var ONGLETS = [
    { cle: "maturite", label: "Maturité des données" },
    { cle: "volumes", label: "Volumes" },
    { cle: "fonds", label: "Besoin de fonds" },
    { cle: "equipes", label: "Équipes RT" },
    { cle: "signaux", label: "Signaux" },
    { cle: "evacuations", label: "Évacuations" },
    { cle: "qualite", label: "Qualité" },
    { cle: "journal", label: "Journal" }
  ];

  function monter(idConteneur) {
    CONTENEUR = $(idConteneur || "aflpPred");
    if (!CONTENEUR || MONTE) return;
    injecterStyles();

    var html = '<h2>Prévisions AFLP <span class="mini">niveau 3 · aide à la décision · statistiques déterministes</span></h2>' +
      '<div class="aflpp-tabs" role="tablist" aria-label="Prévisions AFLP">' +
      ONGLETS.map(function (o) {
        return '<button type="button" class="aflpp-tab" role="tab" id="aflpp-t-' + o.cle +
          '" data-onglet="' + o.cle + '" aria-selected="' + (o.cle === ONGLET) + '">' +
          esc(o.label) + '</button>';
      }).join("") +
      '</div><div class="aflpp-corps" id="aflpp-corps" role="tabpanel">' +
      '<div class="aflpp-vide">Chargement des données…</div></div>';

    CONTENEUR.innerHTML = html;
    CONTENEUR.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-onglet]") : null;
      if (t) { ONGLET = t.getAttribute("data-onglet"); rendre(); return; }
      var a = ev.target.closest ? ev.target.closest("[data-action]") : null;
      if (a) actionner(a.getAttribute("data-action"), a);
    });
    MONTE = true;
  }

  function rafraichir(donnees) {
    if (!MONTE) monter("aflpPred");
    if (!global.AFLP_PRED) return;
    try {
      ANALYSE = global.AFLP_PRED.analyser(donnees);
    } catch (e) {
      ANALYSE = null;
      if (CONTENEUR) {
        var c = $("aflpp-corps");
        if (c) c.innerHTML = '<div class="aflpp-stop"><b>La couche prédictive n\'a pas pu ' +
          's\'exécuter.</b> Le reste de FBMS et l\'Assistant IA de niveau 2 fonctionnent ' +
          'normalement : cette couche est facultative par construction.</div>';
      }
      return;
    }
    rendre();
  }

  function actionner(action, el) {
    if (!ANALYSE) return;
    if (action === "telecharger") {
      var txt = global.AFLP_PRED.resumeTexte(ANALYSE);
      var blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "aflp-previsions-" + ANALYSE.dateRef + ".txt";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      consigner({ horodatage: new Date().toISOString(), type: "export",
        dataset: ANALYSE.versionDataset, dateRef: ANALYSE.dateRef });
      return;
    }
    if (action === "consigner") {
      var cas = $("aflpp-dec-cas"), suite = $("aflpp-dec-suite"), motif = $("aflpp-dec-motif");
      var qui = $("aflpp-dec-qui");
      if (!cas || !suite || !motif || !qui) return;
      if (!qui.value.trim() || !motif.value.trim()) {
        var av = $("aflpp-dec-avis");
        if (av) av.textContent = "Le nom du décideur et le motif sont obligatoires : " +
          "une décision anonyme ou non motivée n'est pas une décision auditée.";
        return;
      }
      consigner({
        horodatage: new Date().toISOString(), type: "decision",
        dataset: ANALYSE.versionDataset, dateRef: ANALYSE.dateRef,
        casUsage: cas.value, suite: suite.value,
        decideur: qui.value.trim(), motif: motif.value.trim(),
        versionModele: ANALYSE.version
      });
      motif.value = ""; qui.value = "";
      ONGLET = "journal";
      rendre();
      return;
    }
    if (action === "exporter-journal") {
      var j = lireJournal();
      var b = new Blob([JSON.stringify(j, null, 2)], { type: "application/json;charset=utf-8" });
      var u = URL.createObjectURL(b);
      var x = document.createElement("a");
      x.href = u; x.download = "aflp-journal-decisions.json";
      document.body.appendChild(x); x.click(); document.body.removeChild(x);
      setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
      return;
    }
    if (action === "detail") {
      var cible = $(el.getAttribute("data-cible"));
      if (cible) cible.hidden = !cible.hidden;
    }
  }

  /* ==========================================================================
     Fragments communs
     ====================================================================== */

  function bandeau() {
    var d = ANALYSE.diagnostic;
    return '<div class="aflpp-bandeau"><b>Aide à la décision — statut SHADOW_ONLY</b>' +
      esc(ANALYSE.mentionObligatoire) +
      '<div style="margin-top:7px;font-weight:400;font-size:11.5px;color:#c9bdf5">' +
      'Modèle ' + esc(ANALYSE.version) +
      ' · jeu de données ' + esc(ANALYSE.versionDataset) +
      ' · calculé le ' + esc(ANALYSE.dateRef) +
      ' · données arrêtées au ' + esc(ANALYSE.dateReferenceDonnees || "—") +
      (ANALYSE.retardDonneesJours != null ? ' (retard ' + esc(String(ANALYSE.retardDonneesJours)) + ' j)' : '') +
      '</div>' +
      (d.porteNiveau1.franchie ? '' :
        '<div style="margin-top:7px;font-weight:400;font-size:11.5px;color:#ffd9d2">' +
        '⚠ Porte du Niveau 1 non franchie : ' + d.porteNiveau1.p0Ouverts.length +
        ' prérequis P0 ouvert(s). Aucun modèle ne peut dépasser SHADOW_ONLY.</div>') +
      '</div>';
  }

  /* Le statut du modèle est visible partout où un chiffre l'est. C'est
     l'exigence qui empêche qu'un tableau recopié dans un compte rendu perde
     en route l'information qu'il ne s'agit que d'un calcul en mode shadow. */
  function tagStatut(statut) {
    var cl = statut === "SHADOW_ONLY" ? "aflpp-shadow"
      : statut === "DECISION_SUPPORT" ? "aflpp-r3" : "aflpp-notready";
    return '<span class="aflpp-tag ' + cl + '">' + esc(statut) + '</span>';
  }

  function tagConfiance(c) {
    return '<span class="aflpp-tag ' + (CLASSE_CONF[c] || "aflpp-bas") + '">confiance ' + esc(c || "—") + '</span>';
  }

  function blocIndisponible(res) {
    return '<div class="aflpp-note"><b>' + esc(res.libelle) + '</b> ' + tagStatut(res.statut) +
      ' <span class="aflpp-tag ' + (CLASSE_NIVEAU[res.niveauReadiness] || "") + '">maturité ' +
      esc(res.niveauReadiness) + '</span><br>' +
      'Aucun chiffre n\'est produit : les données ne le permettent pas. ' +
      'Ce qui manque, précisément :</div>' +
      '<ul class="aflpp-liste">' +
      (res.blocages || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join("") +
      '</ul>' +
      (res.prerequis ? '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:16px 0 6px">Prérequis à ouvrir</h3>' +
        '<table class="aflpp-t"><thead><tr><th>Code</th><th>Élément manquant</th><th>Criticité</th></tr></thead><tbody>' +
        res.prerequis.map(function (p) {
          return '<tr><td>' + esc(p.code) + '</td><td>' + esc(p.element) + '</td><td>' + esc(p.criticite) + '</td></tr>';
        }).join("") + '</tbody></table>' : '') +
      (res.commentaire ? '<p class="aflpp-com">' + esc(res.commentaire) + '</p>' : '');
  }

  /* ==========================================================================
     Onglet 1 — Maturité des données
     ====================================================================== */

  function vueMaturite() {
    var d = ANALYSE.diagnostic;
    var h = bandeau();

    h += '<div class="aflpp-actions">' +
      '<button type="button" class="aflpp-btn" data-action="telecharger">Télécharger le résumé (.txt)</button>' +
      '</div>';

    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:0 0 8px">' +
      'Matrice de maturité — six cas d\'usage</h3>' +
      '<div class="aflpp-scroll"><table class="aflpp-t"><thead><tr>' +
      '<th>Niveau</th><th>Cas d\'usage</th><th>Cible</th><th>Ce qui bloque</th>' +
      '</tr></thead><tbody>';
    d.ordre.forEach(function (k) {
      var c = d.cas[k];
      h += '<tr><td><span class="aflpp-tag ' + (CLASSE_NIVEAU[c.niveau] || "") + '">' +
        esc(c.niveau) + '</span></td>' +
        '<td><b>' + esc(c.libelle) + '</b></td>' +
        '<td style="font-size:11.5px;color:#6b6580">' + esc(c.cible) + '</td>' +
        '<td><ul class="aflpp-liste">' +
        (c.blocages || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join("") +
        '</ul></td></tr>';
    });
    h += '</tbody></table></div>';

    h += '<p class="aflpp-com"><b>R0</b> données insuffisantes, aucun modèle · ' +
      '<b>R1</b> baseline seulement · <b>R2</b> modèle testable en mode shadow · ' +
      '<b>R3</b> aide à la décision autorisable après validation métier.</p>';

    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
      'Porte du Niveau 1 — ' + esc(d.porteNiveau1.franchie ? "franchie" : "NON franchie") + '</h3>' +
      '<div class="aflpp-scroll"><table class="aflpp-t"><thead><tr>' +
      '<th>Code</th><th>Prérequis</th><th>Statut</th><th>Constat</th>' +
      '</tr></thead><tbody>';
    d.porteNiveau1.points.forEach(function (p) {
      var cl = p.statut === "CONFORME" ? "aflpp-ok" : (p.statut === "PARTIEL" ? "aflpp-moy" : "aflpp-bas");
      h += '<tr><td>' + esc(p.code) + ' <span class="aflpp-tag aflpp-notready">' + esc(p.criticite) + '</span></td>' +
        '<td><b>' + esc(p.libelle) + '</b></td>' +
        '<td><span class="aflpp-tag ' + cl + '">' + esc(p.statut) + '</span></td>' +
        '<td style="font-size:11.5px;color:#6b6580">' + esc(p.constat) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="aflpp-com">' + esc(d.porteNiveau1.consequence) + '</p>';

    /* Mesures de qualité réellement observées */
    var m = d.cas.volumes.mesures;
    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
      'Mesures de qualité du jeu de données</h3><div class="aflpp-grille">' +
      '<div class="aflpp-bloc"><h3>Volumétrie</h3><dl>' +
      '<dt>Achats exploitables</dt><dd>' + fmtNombre(m.observations) + '</dd>' +
      '<dt>Profondeur d\'historique</dt><dd>' + fmtNombre(m.profondeurJours) + ' j</dd>' +
      '<dt>Jours avec activité</dt><dd>' + fmtNombre(m.joursActifs) + '</dd>' +
      '<dt>Campagnes disponibles</dt><dd>' + fmtNombre(m.campagnes) + '</dd>' +
      '</dl><p class="aflpp-com">Aucune colonne <code>campagne</code> n\'existe au schéma : ' +
      'le nombre de campagnes ne peut pas dépasser 1.</p></div>' +
      '<div class="aflpp-bloc"><h3>Couverture</h3><dl>' +
      '<dt>Villages avec achat</dt><dd>' + fmtNombre(m.villagesCouverts) + '</dd>' +
      '<dt>Équipes RT avec achat</dt><dd>' + fmtNombre(m.rtCouverts) + '</dd>' +
      '<dt>Identifiants valides</dt><dd>' + fmtPct(m.tauxIdentifiantsValides * 100) + '</dd>' +
      '<dt>Cycles réconciliés</dt><dd>' + (m.tauxCyclesReconcilies == null ? "—" : fmtPct(m.tauxCyclesReconcilies * 100)) + '</dd>' +
      '</dl></div>' +
      '<div class="aflpp-bloc"><h3>Intégrité</h3><dl>' +
      '<dt>Valeurs aberrantes</dt><dd>' + fmtNombre(m.valeursAberrantes) + '</dd>' +
      '<dt>Ruptures de série</dt><dd>' + fmtNombre(m.ruptures) + '</dd>' +
      '<dt>Retard des données</dt><dd>' + (m.retardDonneesJours == null ? "—" : fmtNombre(m.retardDonneesJours) + " j") + '</dd>' +
      '<dt>File locale en attente</dt><dd>' + fmtNombre(m.fileLocaleEnAttente) + '</dd>' +
      '<dt>Échecs de synchronisation</dt><dd>' + fmtNombre(m.fileLocaleEchecs) + '</dd>' +
      '</dl><p class="aflpp-com">Aberrantes = z modifié &gt; 3,5 (Iglewicz &amp; Hoaglin). ' +
      'Elles ne sont pas supprimées : les méthodes retenues sont robustes.</p></div>' +
      '<div class="aflpp-bloc"><h3>Lignes écartées</h3><dl>' +
      '<dt>Sans date</dt><dd>' + fmtNombre(m.lignesRejetees.sansDate) + '</dd>' +
      '<dt>Postérieures à la date de référence</dt><dd>' + fmtNombre(m.lignesRejetees.futur) + '</dd>' +
      '<dt>Sans poids</dt><dd>' + fmtNombre(m.lignesRejetees.sansPoids) + '</dd>' +
      '<dt>Sans village</dt><dd>' + fmtNombre(m.lignesRejetees.sansVillage) + '</dd>' +
      '</dl><p class="aflpp-com">Les lignes postérieures à la date de référence sont écartées ' +
      'à la construction du jeu de données : c\'est ainsi que la fuite temporelle est empêchée.</p></div>' +
      '</div>';

    /* Dérive */
    var dr = ANALYSE.derive;
    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">Dérive</h3>';
    if (!dr.mesurable) {
      h += '<div class="aflpp-note">' + esc(dr.motif) + '</div>';
    } else {
      h += '<div class="aflpp-bloc"><dl>' +
        '<dt>Médiane journalière récente</dt><dd>' + fmtMT(dr.medianeRecente) + ' MT</dd>' +
        '<dt>Médiane de la période précédente</dt><dd>' + fmtMT(dr.medianeReference) + ' MT</dd>' +
        '<dt>Rapport</dt><dd>' + fmtDec(dr.ratio, 3) + '</dd>' +
        '<dt>Dérive détectée</dt><dd>' + (dr.derive ? "OUI" : "non") + '</dd>' +
        '</dl><p class="aflpp-com">' + esc(dr.reserveSeuil) + '<br>' + esc(dr.action) + '</p></div>';
    }
    return h;
  }

  /* ==========================================================================
     Onglet 2 — Volumes
     ====================================================================== */

  function ligneComparaison(p) {
    if (!p.comparaison || !p.comparaison.length) return "";
    return '<table class="aflpp-t" style="margin-top:8px"><thead><tr>' +
      '<th>Méthode</th><th class="num">WAPE</th><th class="num">MAE</th>' +
      '<th class="num">Biais</th><th class="num">Plis</th><th>Retenue</th></tr></thead><tbody>' +
      p.comparaison.map(function (c) {
        return '<tr><td>' + esc(c.nom) + '</td>' +
          '<td class="num">' + fmtPct(c.wape * 100) + '</td>' +
          '<td class="num">' + fmtNombre(c.mae) + '</td>' +
          '<td class="num">' + fmtNombre(c.biais) + '</td>' +
          '<td class="num">' + fmtNombre(c.plis) + '</td>' +
          '<td>' + (c.retenue ? '<span class="aflpp-tag aflpp-ok">oui</span>' : '—') + '</td></tr>';
      }).join("") + '</tbody></table>';
  }

  function vueVolumes() {
    var r = ANALYSE.resultats.volumes;
    var h = bandeau();
    if (r.statut === "NOT_READY" || r.statut === "DESACTIVE") return h + blocIndisponible(r);

    h += '<div class="aflpp-note">' + tagStatut(r.statut) + ' <span class="aflpp-tag ' +
      (CLASSE_NIVEAU[r.niveauReadiness] || "") + '">maturité ' + esc(r.niveauReadiness) + '</span> ' +
      esc(r.avertissement) + '</div>';

    h += '<div class="aflpp-grille">';
    r.global.forEach(function (p) {
      h += '<div class="aflpp-bloc"><h3>Ensemble du pilote — ' + esc(String(p.horizon)) + ' jour(s)</h3>';
      if (p.statut === "NOT_READY") {
        h += '<p class="aflpp-com">' + esc(p.motif) + '</p></div>';
        return;
      }
      h += '<dl>' +
        '<dt>Période prévue</dt><dd>' + esc(p.periodePrevue.debut) + ' → ' + esc(p.periodePrevue.fin) + '</dd>' +
        '<dt>Valeur prévue</dt><dd>' + fmtMT(p.valeur) + ' MT</dd>' +
        '<dt>Intervalle ' + (p.niveauIntervalle ? fmtPct(p.niveauIntervalle * 100) : "—") + '</dt>' +
        '<dd>' + (p.bas == null ? "indisponible" : fmtMT(p.bas) + " – " + fmtMT(p.haut) + " MT") + '</dd>' +
        '<dt>WAPE (validation temporelle)</dt><dd>' + fmtPct(p.metriques.wape * 100) + '</dd>' +
        '<dt>Plis de backtest</dt><dd>' + fmtNombre(p.metriques.plis) + '</dd>' +
        '<dt>Biais moyen</dt><dd>' + fmtNombre(p.metriques.biais) + ' kg</dd>' +
        '<dt>Couverture de l\'intervalle</dt><dd>' +
          (p.metriques.couvertureIntervalle && p.metriques.couvertureIntervalle.mesurable
            ? fmtPct(p.metriques.couvertureIntervalle.valeur * 100)
            : "non mesurable") + '</dd>' +
        '</dl>' +
        '<p class="aflpp-com">' + tagConfiance(p.confiance) + ' ' + esc(p.motifConfiance) + '<br>' +
        '<b>Méthode retenue :</b> ' + esc(p.methodeNom) + ' — ' + esc(p.methodeDescription) +
        (p.motifIntervalle ? '<br><b>Intervalle :</b> ' + esc(p.motifIntervalle) : '') +
        (p.metriques.couvertureIntervalle && p.metriques.couvertureIntervalle.mesurable
          ? '<br><b>Couverture :</b> ' + esc(p.metriques.couvertureIntervalle.motif) : '') +
        (p.incertain ? '<br><b>⚠ Prévision trop incertaine</b> pour être lue comme un chiffre : ' +
          'à lire comme une fourchette.' : '') + '</p>' +
        ligneComparaison(p) + '</div>';
    });
    h += '</div>';

    /* Cohérence d'agrégation */
    var ca = r.coherenceAgregation;
    if (ca) {
      h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
        'Cohérence d\'agrégation (horizon 7 jours)</h3><div class="aflpp-bloc"><dl>' +
        '<dt>Prévision programme</dt><dd>' + fmtMT(ca.programme) + ' MT</dd>' +
        '<dt>Somme des clusters</dt><dd>' + fmtMT(ca.sommeClusters) + ' MT</dd>' +
        '<dt>Somme des villages</dt><dd>' + fmtMT(ca.sommeVillages) + ' MT</dd>' +
        '<dt>Écart clusters / programme</dt><dd>' + fmtPct(ca.ecartClustersPct) + '</dd>' +
        '</dl><p class="aflpp-com">' + esc(ca.commentaire) + '</p></div>';
    }

    /* Tableau clusters et villages, horizon 7 */
    function tableau(titre, liste) {
      var l = liste.filter(function (p) { return p.horizon === 7; });
      if (!l.length) return "";
      return '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
        esc(titre) + ' — horizon 7 jours</h3><div class="aflpp-scroll">' +
        '<table class="aflpp-t"><thead><tr><th>Entité</th><th class="num">Prévu (MT)</th>' +
        '<th class="num">Intervalle</th><th class="num">WAPE</th><th>Confiance</th>' +
        '<th class="num">Obs.</th><th>Méthode</th></tr></thead><tbody>' +
        l.map(function (p) {
          if (p.statut === "NOT_READY") {
            return '<tr><td><b>' + esc(p.entiteNom) + '</b></td>' +
              '<td colspan="6" style="color:#8a2b1c;font-size:11.5px">' + esc(p.motif) + '</td></tr>';
          }
          return '<tr><td><b>' + esc(p.entiteNom) + '</b>' +
            (p.cluster ? '<div style="font-size:11px;color:#666565">' + esc(p.cluster) + '</div>' : '') + '</td>' +
            '<td class="num">' + fmtMT(p.valeur) + '</td>' +
            '<td class="num">' + (p.bas == null ? "—" : fmtMT(p.bas) + " – " + fmtMT(p.haut)) + '</td>' +
            '<td class="num">' + fmtPct(p.metriques.wape * 100) + '</td>' +
            '<td>' + tagConfiance(p.confiance) + '</td>' +
            '<td class="num">' + fmtNombre(p.observations) + '</td>' +
            '<td style="font-size:11.5px">' + esc(p.methode) + '</td></tr>';
        }).join("") + '</tbody></table></div>';
    }
    h += tableau("Clusters", r.parCluster);
    h += tableau("Villages", r.parVillage);

    if (r.villagesTropIncertains.length) {
      h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
        'Entités trop incertaines pour un chiffre</h3><ul class="aflpp-liste">' +
        r.villagesTropIncertains.map(function (v) {
          return '<li><b>' + esc(v.nom) + '</b> — ' + esc(v.motif) + '</li>';
        }).join("") + '</ul>';
    }
    if (r.nouveauxVillages.length) {
      h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
        'Entités sans historique suffisant — repli contrôlé</h3><ul class="aflpp-liste">' +
        r.nouveauxVillages.map(function (v) {
          return '<li><b>' + esc(v.nom) + '</b> (' + fmtNombre(v.joursHistorique) + ' j, ' +
            fmtNombre(v.observations) + ' achats) — ' + esc(v.repli) + '</li>';
        }).join("") + '</ul>';
    }
    return h + pied();
  }

  /* ==========================================================================
     Onglet 3 — Besoin de fonds
     ====================================================================== */

  function vueFonds() {
    var r = ANALYSE.resultats.fonds;
    var h = bandeau();
    if (r.statut === "NOT_READY" || r.statut === "DESACTIVE") return h + blocIndisponible(r);

    h += '<div class="aflpp-stop">' + tagStatut(r.statut) + ' <b>Ce n\'est pas une demande de fonds.</b> ' +
      esc(r.avertissement) + ' Garde-fous actifs : ' + esc((r.gardes || []).join(", ")) + '.</div>';

    h += '<div class="aflpp-grille">' +
      '<div class="aflpp-bloc"><h3>Scénarios — horizon ' + esc(String(r.horizonJours)) + ' jours</h3><dl>' +
      '<dt>Scénario bas</dt><dd>' + fmtF(r.scenarios.bas && r.scenarios.bas.total) + '</dd>' +
      '<dt>Besoin central</dt><dd>' + fmtF(r.scenarios.central && r.scenarios.central.total) + '</dd>' +
      '<dt>Scénario haut</dt><dd>' + fmtF(r.scenarios.haut && r.scenarios.haut.total) + '</dd>' +
      '<dt>Central + marge ' + fmtPct(r.margeSecurite * 100) + '</dt>' +
      '<dd>' + fmtF(r.scenarios.centralAvecMarge && r.scenarios.centralAvecMarge.total) + '</dd>' +
      '<dt>Date probable du besoin</dt><dd>' + esc(r.dateProbableBesoin) + '</dd>' +
      '</dl><p class="aflpp-com">' + tagConfiance(r.confiance) + ' ' + esc(r.motifConfiance || "") + '</p></div>' +

      '<div class="aflpp-bloc"><h3>Exposition actuelle</h3><dl>' +
      '<dt>Exposition ouverte</dt><dd>' + fmtF(r.expositionOuverte) + '</dd>' +
      '<dt>Non finançable (non réconcilié)</dt><dd>' + fmtF(r.montantNonFinancable) + '</dd>' +
      '<dt>Équipes couvertes</dt><dd>' + fmtNombre(r.rtCouverts) + '</dd>' +
      '<dt>Équipes bloquées</dt><dd>' + fmtNombre(r.rtBloques) + '</dd>' +
      '<dt>Durée de cycle médiane</dt><dd>' + (r.dureeCycleJours == null ? "—" : fmtNombre(r.dureeCycleJours) + " j") + '</dd>' +
      '<dt>Besoin <b>supplémentaire</b></dt><dd>' + fmtF(r.besoinSupplementaireTheorique) + '</dd>' +
      '</dl><p class="aflpp-com">' +
      (r.detailBesoinSupplementaire ? esc(r.detailBesoinSupplementaire.commentaire) + '<br>' +
        esc(r.detailBesoinSupplementaire.reserve) + '<br>' : '') +
      'Les cycles non réconciliés restent bloquants, quelle que soit ' +
      'l\'estimation ci-contre. La règle AFLP prime.</p></div>' +

      '<div class="aflpp-bloc"><h3>Hypothèses de calcul</h3><dl>' +
      '<dt>Prix moyen observé</dt><dd>' + (r.prixMoyenObserve == null ? "—" : fmtNombre(r.prixMoyenObserve) + " F/kg") + '</dd>' +
      '<dt>Commission RT moyenne</dt><dd>' + fmtNombre(r.commissionMoyenneObservee) + ' F/kg</dd>' +
      '<dt>Marge de sécurité</dt><dd>' + fmtPct(r.margeSecurite * 100) + '</dd>' +
      '</dl><p class="aflpp-com">Prix et commission sont ceux <b>observés</b> dans les achats. ' +
      'Aucun prix ANAGROCI ni prix marché n\'est au schéma : rien n\'est inventé ici.</p></div>' +
      '</div>';

    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
      'Facteurs explicatifs</h3><table class="aflpp-t"><thead><tr>' +
      '<th>Facteur</th><th>Valeur</th><th>Poids</th><th>Source</th></tr></thead><tbody>' +
      r.facteurs.map(function (f) {
        return '<tr><td><b>' + esc(f.facteur) + '</b></td><td class="num">' + esc(f.valeur) + '</td>' +
          '<td>' + esc(f.poids) + '</td><td style="font-size:11.5px;color:#6b6580">' + esc(f.source) + '</td></tr>';
      }).join("") + '</tbody></table>';

    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
      'Enveloppe de campagne ≠ pic d\'exposition</h3><div class="aflpp-bloc">' +
      '<p class="aflpp-com" style="border:0;padding:0;margin:0">' + esc(r.enveloppeVsPic.commentaire) +
      '<br><br><b>Exposition ouverte courante :</b> ' + fmtF(r.enveloppeVsPic.expositionOuverteCourante) +
      '<br><b>Pic historique :</b> non calculable — ' + esc(r.enveloppeVsPic.motifPic) + '</p></div>';

    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
      'Réserves</h3><ul class="aflpp-liste">' +
      r.reserves.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>';

    return h + blocDecision("fonds") + pied();
  }

  /* ==========================================================================
     Onglet 4 — Équipes RT
     ====================================================================== */

  function vueEquipes() {
    var r = ANALYSE.resultats.scorecardRt;
    var h = bandeau();
    if (r.statut === "NOT_READY" || r.statut === "DESACTIVE") return h + blocIndisponible(r);

    h += '<div class="aflpp-stop">' + tagStatut(r.statut) + ' <b>Ceci n\'est pas une notation de personnes.</b> ' +
      esc(r.avertissement) + '</div>';
    h += '<div class="aflpp-note">Aucun score composite n\'est produit. Les huit dimensions ' +
      'restent séparées, volontairement : un chiffre unique confondrait mauvaise performance, ' +
      'mauvaise qualité de données et comportement inhabituel — trois causes qui appellent ' +
      'trois traitements différents.</div>';

    r.equipes.forEach(function (eq, i) {
      var idDet = "aflpp-eq-" + i;
      h += '<div class="aflpp-bloc" style="margin-bottom:10px">' +
        '<h3>' + esc(eq.nom) + (eq.cluster ? ' <span style="text-transform:none;color:#666565;font-weight:400">· ' + esc(eq.cluster) + '</span>' : '') + '</h3>' +
        '<p class="aflpp-com" style="border:0;padding:0;margin:0 0 8px">' +
        tagConfiance(eq.confianceStatistique) + ' ' +
        fmtNombre(eq.observations) + ' achat(s) · période ' + esc(eq.periode) +
        (eq.donneesInsuffisantes
          ? ' · <b style="color:#8a2b1c">données insuffisantes : à lire avec réserve</b>' : '') + '</p>' +
        '<button type="button" class="aflpp-btn ghost" data-action="detail" data-cible="' + idDet + '">' +
        'Voir les huit dimensions</button>' +
        '<div id="' + idDet + '" hidden style="margin-top:10px">';
      r.dimensions.forEach(function (dim) {
        var d = eq.dimensions[dim.cle];
        if (!d) return;
        h += '<div class="aflpp-dim">' +
          '<span class="aflpp-dimnom">' + esc(dim.nom) + '</span>' +
          '<span class="aflpp-dimval">' + (d.score == null ? "—" : fmtDec(d.score, 2)) + '</span>' +
          '<div class="aflpp-dimmotif">' + esc(d.motif) +
          '<br><i>Données : ' + esc(d.donnees) + ' · comparaison : ' + esc(d.comparaison) +
          ' · ' + esc("confiance " + d.confiance) + '</i>' +
          (d.facteurs && d.facteurs.length
            ? '<br>' + d.facteurs.map(function (f) {
                return esc(f.facteur) + " : " + esc(f.valeur);
              }).join(" · ")
            : '') +
          '</div></div>';
      });
      h += '<p class="aflpp-com">' + esc(eq.contestation) + '</p></div></div>';
    });

    /* Audit de biais */
    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
      'Audit de biais</h3><div class="aflpp-scroll"><table class="aflpp-t"><thead><tr>' +
      '<th>Cluster</th><th class="num">Équipes</th><th class="num">Volume médian (indice)</th>' +
      '<th class="num">Part à données insuffisantes</th></tr></thead><tbody>' +
      r.biais.parCluster.map(function (b) {
        return '<tr><td>' + esc(b.cluster) + '</td><td class="num">' + fmtNombre(b.equipes) + '</td>' +
          '<td class="num">' + fmtDec(b.volumeMedian, 2) + '</td>' +
          '<td class="num">' + (b.partDonneesInsuffisantes == null ? "—" : fmtPct(b.partDonneesInsuffisantes * 100)) + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<p class="aflpp-com"><b>Ancienneté :</b> ' + esc(r.biais.motifAnciennete) +
      '<br><b>Réseau :</b> ' + esc(r.biais.parReseau.commentaire) + '</p>';

    return h + blocDecision("scorecardRt") + pied();
  }

  /* ==========================================================================
     Onglet 5 — Signaux
     ====================================================================== */

  function vueSignaux() {
    var r = ANALYSE.resultats.signaux;
    var h = bandeau();
    if (r.statut === "NOT_READY" || r.statut === "DESACTIVE") return h + blocIndisponible(r);

    h += '<div class="aflpp-stop">' + tagStatut(r.statut) + ' <b>Signaux à examiner — jamais une preuve.</b> ' +
      esc(r.avertissement) + '</div>';

    if (!r.signaux.length) {
      h += '<div class="aflpp-vide">Aucun signal à examiner sur ce jeu de données.<br>' +
        '<span style="font-size:11.5px;color:#666565">Une absence de signal n\'est pas une ' +
        'attestation de conformité : elle signifie que les règles et statistiques appliquées ' +
        'n\'ont rien relevé.</span></div>';
    } else {
      r.signaux.forEach(function (s, i) {
        var idDet = "aflpp-sig-" + i;
        h += '<div class="aflpp-bloc" style="margin-bottom:10px">' +
          '<h3>' + esc(s.code) + ' — ' + esc(s.titre) + '</h3>' +
          '<p style="margin:0 0 6px;font-size:13px;color:#2E2547"><b>' + esc(s.entiteNom) + '</b> · ' +
          tagConfiance(s.confiance) + ' <span class="aflpp-tag aflpp-moy">' + esc(s.qualification) + '</span></p>' +
          '<dl style="margin:0;display:grid;grid-template-columns:1fr auto;gap:5px 10px;font-size:12.5px">' +
          '<dt style="color:#666565">Observation</dt><dd style="margin:0;text-align:right">' + esc(s.observation) + '</dd>' +
          '<dt style="color:#666565">Norme de comparaison</dt><dd style="margin:0;text-align:right">' + esc(s.norme) + '</dd>' +
          '<dt style="color:#666565">Écart</dt><dd style="margin:0;text-align:right">' + esc(s.ecart) + '</dd>' +
          '</dl>' +
          '<button type="button" class="aflpp-btn ghost" style="margin-top:9px" data-action="detail" data-cible="' + idDet + '">' +
          'Explications et action recommandée</button>' +
          '<div id="' + idDet + '" hidden style="margin-top:9px">' +
          '<p class="aflpp-com" style="border:0;padding:0"><b>Explications possibles, à écarter une par une :</b></p>' +
          '<ul class="aflpp-liste">' +
          s.facteursExplicatifs.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join("") + '</ul>' +
          (s.donneesManquantes && s.donneesManquantes.length
            ? '<p class="aflpp-com"><b>Données manquantes :</b> ' +
              esc(s.donneesManquantes.join(" · ")) + '</p>' : '') +
          '<p class="aflpp-com"><b>Action humaine recommandée :</b> ' + esc(s.actionHumaineRecommandee) + '</p>' +
          '<p class="aflpp-com" style="color:#8a2b1c"><b>' + esc(s.interdit) + '</b></p>' +
          '</div></div>';
      });
    }

    var fp = r.fauxPositifs;
    h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
      'Faux positifs</h3><div class="aflpp-bloc"><dl>' +
      '<dt>Mesurables aujourd\'hui</dt><dd>' + (fp.mesurables ? "oui" : "non") + '</dd>' +
      '<dt>Signaux produits</dt><dd>' + fmtNombre(fp.volumeSignaux) + '</dd>' +
      '<dt>Seuil de saturation</dt><dd>' + fmtNombre(fp.seuilDeSaturation) + '</dd>' +
      '</dl><p class="aflpp-com">' + esc(fp.motif) + '<br>' + esc(fp.procedure) +
      '<br><b>' + esc(fp.saturation) + '</b></p></div>';

    return h + blocDecision("signaux") + pied();
  }

  /* ==========================================================================
     Onglet 6 — Évacuations
     ====================================================================== */

  function vueEvacuations() {
    var r = ANALYSE.resultats.evacuations;
    var h = bandeau();
    if (r.statut === "NOT_READY" || r.statut === "DESACTIVE") return h + blocIndisponible(r);

    h += '<div class="aflpp-stop">' + tagStatut(r.statut) + ' <b>Recommandation — le Logistics Coordinator décide.</b> ' +
      esc(r.avertissement) + '</div>';
    h += '<div class="aflpp-scroll"><table class="aflpp-t"><thead><tr>' +
      '<th>Cluster</th><th class="num">Stock estimé</th><th class="num">Capacité</th>' +
      '<th class="num">Rythme/jour</th><th>Saturation probable</th><th>Fenêtre conseillée</th>' +
      '<th>Risque rupture</th><th>Confiance</th></tr></thead><tbody>' +
      r.clusters.map(function (c) {
        return '<tr><td><b>' + esc(c.nom) + '</b></td>' +
          '<td class="num">' + fmtMT(c.stockEstimeKg) + ' MT</td>' +
          '<td class="num">' + (c.capaciteKg == null ? "—" : fmtMT(c.capaciteKg) + " MT") + '</td>' +
          '<td class="num">' + fmtMT(c.rythmeJourKg) + ' MT</td>' +
          '<td>' + esc(c.dateSaturationProbable || "—") + '</td>' +
          '<td>' + (c.fenetreRecommandee ? esc(c.fenetreRecommandee.debut + " → " + c.fenetreRecommandee.fin) : "—") + '</td>' +
          '<td>' + esc(c.risqueRupture) + '</td>' +
          '<td>' + tagConfiance(c.confiance) + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<p class="aflpp-com">Le nombre de véhicules n\'est volontairement pas calculé : aucune ' +
      'capacité utile de véhicule n\'est enregistrée. Un chiffre donné sans donnée serait une invention.</p>';

    return h + blocDecision("evacuations") + pied();
  }

  /* ==========================================================================
     Onglet 7 — Qualité
     ====================================================================== */

  function vueQualite() {
    var r = ANALYSE.resultats.qualite;
    var h = bandeau();
    if (r.statut === "NOT_READY" || r.statut === "DESACTIVE") return h + blocIndisponible(r);

    h += '<div class="aflpp-stop">' + tagStatut(r.statut) + ' <b>Écarts à investiguer — aucune perte n\'est validée.</b> ' +
      esc(r.avertissement) + '</div>';

    if (r.normes) {
      h += '<div class="aflpp-grille">';
      ["humidite", "kor"].forEach(function (m) {
        var n = r.normes[m];
        h += '<div class="aflpp-bloc"><h3>Norme observée — ' + esc(m === "humidite" ? "Humidité" : "KOR") + '</h3>';
        if (!n) { h += '<p class="aflpp-com">Aucune mesure exploitable.</p></div>'; return; }
        h += '<dl><dt>Observations</dt><dd>' + fmtNombre(n.n) + '</dd>' +
          '<dt>Médiane</dt><dd>' + fmtDec(n.mediane, 2) + '</dd>' +
          '<dt>Intervalle normal (80 %)</dt><dd>' + fmtDec(n.q10, 2) + ' – ' + fmtDec(n.q90, 2) + '</dd>' +
          '</dl><p class="aflpp-com">' + esc(n.reserve) + '</p></div>';
      });
      h += '</div>';
    }

    if (!r.ecarts.length) {
      h += '<div class="aflpp-vide">Aucun écart de qualité au-delà du seuil sur ce jeu de données.</div>';
    } else {
      h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
        'Écarts relevés</h3><div class="aflpp-scroll"><table class="aflpp-t"><thead><tr>' +
        '<th>Village</th><th>Mesure</th><th class="num">Mesurée</th><th class="num">Attendue</th>' +
        '<th class="num">Intervalle normal</th><th class="num">Écart</th><th class="num">z</th>' +
        '<th>Importance</th><th>Confiance</th></tr></thead><tbody>' +
        r.ecarts.map(function (e) {
          return '<tr><td><b>' + esc(e.entiteNom) + '</b>' +
            (e.cluster ? '<div style="font-size:11px;color:#666565">' + esc(e.cluster) + '</div>' : '') + '</td>' +
            '<td>' + esc(e.mesure) + '</td>' +
            '<td class="num">' + fmtDec(e.valeurMesuree, 2) + '</td>' +
            '<td class="num">' + fmtDec(e.normeAttendue, 2) + '</td>' +
            '<td class="num">' + fmtDec(e.intervalleNormal.bas, 2) + ' – ' + fmtDec(e.intervalleNormal.haut, 2) + '</td>' +
            '<td class="num">' + fmtDec(e.ecart, 2) + '</td>' +
            '<td class="num">' + fmtDec(e.zModifie, 1) + '</td>' +
            '<td style="font-size:11.5px">' + (e.importanceEconomique
              ? esc(fmtMT(e.importanceEconomique.poidsKg) + " MT — " + e.importanceEconomique.natureCalcul)
              : "non chiffrable") + '</td>' +
            '<td>' + tagConfiance(e.confiance) + '</td></tr>';
        }).join("") + '</tbody></table></div>';

      h += '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
        'Causes possibles — à distinguer avant toute conclusion</h3><ul class="aflpp-liste">' +
        r.causesPossibles.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join("") + '</ul>' +
        '<p class="aflpp-com">' + esc(r.ecarts[0].actionHumaineRecommandee) + '</p>';
    }

    h += '<div class="aflpp-note"><b>Comparaison village ↔ usine : indisponible.</b> ' +
      esc(r.comparaisonUsine.motif) + '<br><b>Prérequis :</b> ' + esc(r.comparaisonUsine.prerequis) + '</div>';

    return h + blocDecision("qualite") + pied();
  }

  /* ==========================================================================
     Onglet 8 — Journal des consultations et décisions
     ====================================================================== */

  function vueJournal() {
    var j = lireJournal();
    var h = bandeau();
    h += '<div class="aflpp-note"><b>Journal conservé dans ce navigateur.</b> Il n\'est pas ' +
      'écrit en base : la table <code>aflp_predictions</code> n\'est pas déployée ' +
      '(voir <code>docs/migrations/</code>). Exportez-le si vous devez le conserver.</div>';
    h += '<div class="aflpp-actions">' +
      '<button type="button" class="aflpp-btn ghost" data-action="exporter-journal">Exporter le journal (.json)</button>' +
      '</div>';
    if (!j.length) {
      h += '<div class="aflpp-vide">Aucune consultation ni décision consignée.</div>';
      return h;
    }
    h += '<div class="aflpp-scroll"><table class="aflpp-t"><thead><tr>' +
      '<th>Horodatage</th><th>Type</th><th>Cas d\'usage</th><th>Décideur</th>' +
      '<th>Suite donnée</th><th>Motif</th><th>Jeu de données</th></tr></thead><tbody>' +
      j.slice().reverse().map(function (e) {
        return '<tr><td style="font-size:11.5px">' + esc(e.horodatage) + '</td>' +
          '<td>' + esc(e.type) + '</td>' +
          '<td>' + esc(e.casUsage || "—") + '</td>' +
          '<td>' + esc(e.decideur || "—") + '</td>' +
          '<td>' + esc(e.suite || "—") + '</td>' +
          '<td style="font-size:11.5px">' + esc(e.motif || "—") + '</td>' +
          '<td style="font-size:11px;color:#666565">' + esc(e.dataset || "—") + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    return h;
  }

  /* ==========================================================================
     Bloc « suite donnée par un humain »
     --------------------------------------------------------------------------
     Ce bloc n'exécute AUCUNE action métier. Il enregistre ce qu'un humain
     nommé a décidé, et pourquoi. Les intitulés de suite sont volontairement
     des verbes de PROCESSUS (« transmis à Finance »), jamais des verbes
     d'exécution (« autorisé », « débloqué »).
     ====================================================================== */

  var SUITES = [
    "Pris connaissance, aucune suite",
    "Transmis à Finance pour arbitrage",
    "Transmis au Logistics Coordinator",
    "Transmis à Quality / Factory",
    "Vérification terrain demandée",
    "Donnée contestée, correction demandée au Branch Manager",
    "Écarté : explication opérationnelle trouvée"
  ];

  function blocDecision(casUsage) {
    return '<h3 style="font-size:12px;text-transform:uppercase;color:#4A3C7A;margin:18px 0 8px">' +
      'Consigner la suite donnée</h3>' +
      '<div class="aflpp-bloc">' +
      '<p class="aflpp-com" style="border:0;padding:0;margin:0 0 8px">La couche prédictive ' +
      'n\'exécute rien. Ce formulaire consigne une décision <b>humaine, nominative et motivée</b> ' +
      'prise ailleurs, dans les outils prévus pour cela.</p>' +
      '<input type="hidden" id="aflpp-dec-cas" value="' + esc(casUsage) + '">' +
      '<div class="aflpp-decision">' +
      '<select id="aflpp-dec-suite" aria-label="Suite donnée">' +
      SUITES.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join("") +
      '</select>' +
      '<input id="aflpp-dec-qui" type="text" placeholder="Nom du décideur (obligatoire)" aria-label="Nom du décideur">' +
      '</div><div class="aflpp-decision">' +
      '<input id="aflpp-dec-motif" type="text" placeholder="Motif de la décision (obligatoire)" aria-label="Motif de la décision">' +
      '<button type="button" class="aflpp-btn" data-action="consigner">Consigner</button>' +
      '</div><p class="aflpp-com" id="aflpp-dec-avis"></p></div>';
  }

  function pied() {
    var reg = ANALYSE.registre;
    return '<div class="aflpp-pied">' +
      '<b>Registre des modèles :</b> ' +
      reg.map(function (m) {
        var r = ANALYSE.resultats[m.cle];
        return esc(m.nom) + " " + tagStatut(m.actif ? (r ? r.statut : m.statutMax) : "DESACTIVE");
      }).join(" &nbsp;·&nbsp; ") +
      '<br><b>Limites absolues appliquées :</b> ' +
      ANALYSE.gardes.map(function (g) { return esc(g.code); }).join(" ") +
      ' — la couche ne peut ' + esc(ANALYSE.gardes.slice(0, 4).map(function (g) { return g.interdit; }).join(", ")) +
      ', ni aucune des autres actions listées.' +
      '<br><b>Sorties autorisées :</b> ' + esc(ANALYSE.sortiesAutorisees.join(", ")) + '.' +
      '</div>';
  }

  /* ==========================================================================
     Rendu
     ====================================================================== */

  var VUES = {
    maturite: vueMaturite, volumes: vueVolumes, fonds: vueFonds,
    equipes: vueEquipes, signaux: vueSignaux, evacuations: vueEvacuations,
    qualite: vueQualite, journal: vueJournal
  };

  function rendre() {
    if (!CONTENEUR) return;
    var corps = $("aflpp-corps");
    if (!corps) return;
    ONGLETS.forEach(function (o) {
      var b = $("aflpp-t-" + o.cle);
      if (b) b.setAttribute("aria-selected", String(o.cle === ONGLET));
    });
    if (!ANALYSE) {
      corps.innerHTML = '<div class="aflpp-vide">Aucune donnée chargée.</div>';
      return;
    }
    var vue = VUES[ONGLET] || vueMaturite;
    try {
      corps.innerHTML = vue();
    } catch (e) {
      corps.innerHTML = '<div class="aflpp-stop"><b>Affichage impossible pour cet onglet.</b> ' +
        'Le reste de FBMS n\'est pas affecté.</div>';
    }
  }

  /* Résumé en une ligne pour un en-tête replié. Ne recalcule rien : il relit
     l'analyse déjà produite. null tant qu'aucune analyse n'a abouti — un
     en-tête muet vaut mieux qu'un en-tête qui invente un verdict. */
  function resume() {
    if (!ANALYSE) return null;
    var d = ANALYSE.diagnostic, porte = d && d.porteNiveau1;
    return {
      verdict: d ? d.verdict : null,
      porteFranchie: porte ? !!porte.franchie : null,
      p0Ouverts: porte && porte.p0Ouverts ? porte.p0Ouverts.length : null,
      retardJours: ANALYSE.retardDonneesJours,
      dateRef: ANALYSE.dateRef,
      version: ANALYSE.version,
      /* Ajout purement additif : l'appelant qui affiche un encart « dérive »
         hors du module doit pouvoir en citer le MOTIF tel que le moteur l'a
         rédigé, plutôt que d'en inventer un. Rien n'est calculé ici — c'est
         l'objet déjà produit par `derive(dataset)`. */
      derive: ANALYSE.derive || null
    };
  }

  global.AFLP_PRED_UI = { monter: monter, rafraichir: rafraichir, resume: resume, journal: lireJournal };

})(typeof globalThis !== "undefined" ? globalThis : this);
