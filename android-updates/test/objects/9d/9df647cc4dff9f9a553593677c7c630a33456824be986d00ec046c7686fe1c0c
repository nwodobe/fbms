/* ============================================================================
   ASSISTANT IA AFLP — COMPRÉHENSION (shared/aflp-ia-comprehension.js)
   ----------------------------------------------------------------------------
   Transforme une question en langage naturel en un CONTRAT structuré, validé
   contre un schéma FERMÉ. C'est tout ce qu'il fait.

     question (texte libre)  →  { intent, scope, period, filters, confidence,
                                  requires_clarification, clarification_question }

   Ce fichier ne calcule AUCUN chiffre, ne lit AUCUNE donnée financière, ne
   touche ni au réseau ni au DOM. Il ne connaît des données que les NOMS des
   zones, clusters, villages et équipes — le strict nécessaire pour situer une
   question. Il ignore les montants, les volumes et les soldes.

   POURQUOI CETTE SÉPARATION
   Le contrat est le seul point de passage entre « comprendre » et « calculer ».
   Tant qu'il est validé contre un schéma fermé, peu importe d'où il vient : du
   moteur déterministe ci-dessous, ou plus tard d'une couche linguistique. Une
   intention inconnue, une portée inconnue, une période inconnue ou un filtre
   inconnu sont REFUSÉS — jamais interprétés au mieux, jamais complétés d'office.

   ÉTAPES, dans l'ordre et sans raccourci :
     1. normalisation           7. clarification si nécessaire
     2. détection d'intention   8. (le moteur appelle sa fonction déterministe)
     3. extraction des entités
     4. détection de portée
     5. détection de période
     6. validation du contrat
   ========================================================================== */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";

  function catalogue() {
    return global.AFLP_IA_CATALOGUE ||
      (typeof require === "function" ? require("./aflp-ia-catalogue.js") : null);
  }

  /* ==========================================================================
     1. Normalisation
     --------------------------------------------------------------------------
     Une seule forme canonique pour tout le reste : minuscules, accents retirés,
     apostrophes et ponctuation remplacées par des espaces. « Béoumi », « BEOUMI »
     et « beoumi » deviennent le même mot ; « d'équipes » devient « d equipes »,
     ce qui isole « equipes » comme un mot à part entière.
     ====================================================================== */

  function normaliser(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function jetons(normalise) {
    return normalise ? normalise.split(" ").filter(Boolean) : [];
  }

  /* Distance d'édition bornée : on s'arrête dès qu'elle dépasse `max`, ce qui
     évite de calculer une matrice complète pour des mots sans rapport. */
  function distance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prec = [], cour = [], i, j;
    for (j = 0; j <= b.length; j++) prec[j] = j;
    for (i = 1; i <= a.length; i++) {
      cour[0] = i;
      var mini = cour[0];
      for (j = 1; j <= b.length; j++) {
        cour[j] = Math.min(
          prec[j] + 1,
          cour[j - 1] + 1,
          prec[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)
        );
        if (cour[j] < mini) mini = cour[j];
      }
      if (mini > max) return max + 1;
      for (j = 0; j <= b.length; j++) prec[j] = cour[j];
    }
    return prec[b.length];
  }

  /* Tolérance aux fautes mineures, calibrée sur la longueur du mot : aucune
     tolérance sous 5 lettres (sinon « sac » et « sas » se confondent), une
     faute jusqu'à 7 lettres, deux au-delà. */
  function toleranceDe(mot) {
    if (mot.length >= 8) return 2;
    if (mot.length >= 5) return 1;
    return 0;
  }

  /* Un mot-clé du catalogue peut être une expression de plusieurs mots
     (« aujourd hui », « no go »). Renvoie 1 pour une correspondance exacte,
     0.7 pour une correspondance approchée, 0 sinon. */
  function apparier(motCle, jetonsQuestion, normaliseQuestion) {
    if (motCle.indexOf(" ") >= 0) {
      return normaliseQuestion.indexOf(motCle) >= 0 ? 1 : 0;
    }
    var i, tol = toleranceDe(motCle), meilleur = 0;
    for (i = 0; i < jetonsQuestion.length; i++) {
      var t = jetonsQuestion[i];
      if (t === motCle) return 1;
      if (tol > 0 && Math.abs(t.length - motCle.length) <= tol &&
          distance(t, motCle, tol) <= tol) {
        meilleur = Math.max(meilleur, 0.7);
      }
    }
    return meilleur;
  }

  function apparierGroupe(groupe, jetonsQuestion, normaliseQuestion) {
    var meilleur = 0;
    for (var i = 0; i < groupe.length; i++) {
      var s = apparier(groupe[i], jetonsQuestion, normaliseQuestion);
      if (s > meilleur) meilleur = s;
      if (meilleur === 1) break;
    }
    return meilleur;
  }

  /* ==========================================================================
     2. Détection d'intention
     --------------------------------------------------------------------------
     Toutes les conditions d'une intention doivent être réunies : chaque groupe
     de mots-clés est un ET, chaque groupe est un OU interne. Une exclusion
     rencontrée disqualifie l'intention — c'est ce qui sépare « combien de RT »
     de « combien de personnes dans les RT ».
     ====================================================================== */

  function scorerIntention(intention, jq, nq) {
    var i, s;
    /* Les exclusions tolèrent la faute de frappe au même titre que les groupes.
       Sans cette symétrie, « quel montan peut-on refinancer » échappait à
       l'exclusion « montant » et partait vers l'intention voisine : la faute
       de frappe désactivait le garde-fou tout en gardant le rapprochement. */
    for (i = 0; i < intention.exclusions.length; i++) {
      if (apparier(intention.exclusions[i], jq, nq) >= 0.7) return null;
    }
    var scoreGroupes = 0;
    for (i = 0; i < intention.groupes.length; i++) {
      s = apparierGroupe(intention.groupes[i], jq, nq);
      if (!s) return null;                 // un groupe non satisfait = intention écartée
      scoreGroupes += s;
    }
    var scoreIndices = 0;
    for (i = 0; i < intention.indices.length; i++) {
      if (apparier(intention.indices[i], jq, nq) === 1) scoreIndices += 1;
    }
    /* Les indices comptent, mais ne peuvent jamais remplacer un groupe : leur
       apport total est plafonné à un demi-groupe. */
    var apportIndices = Math.min(0.5, scoreIndices * 0.12);
    return {
      code: intention.code,
      intention: intention,
      groupes: intention.groupes.length,
      exact: scoreGroupes === intention.groupes.length,
      score: scoreGroupes + apportIndices
    };
  }

  function detecterIntention(question, nq, jq) {
    var cat = catalogue();
    var candidats = [];
    cat.publiees().forEach(function (i) {
      var c = scorerIntention(i, jq, nq);
      if (c) candidats.push(c);
    });

    /* Une formulation validée reconnue mot pour mot l'emporte sur tout le
       reste : c'est une question que le Branch Manager a lui-même approuvée. */
    var exacte = null;
    cat.publiees().forEach(function (i) {
      if (exacte) return;
      for (var k = 0; k < i.formulations.length; k++) {
        if (normaliser(i.formulations[k]) === nq) { exacte = i; return; }
      }
    });
    if (exacte) {
      var deja = null;
      candidats.forEach(function (c) { if (c.code === exacte.code) deja = c; });
      if (!deja) {
        deja = { code: exacte.code, intention: exacte, groupes: exacte.groupes.length, exact: true, score: 0 };
        candidats.push(deja);
      }
      deja.score += 10;
      deja.formulationValidee = true;
    }

    candidats.sort(function (a, b) {
      return (b.score - a.score) || (b.groupes - a.groupes) || a.code.localeCompare(b.code);
    });
    return candidats;
  }

  /* Confiance : bornée, explicable, et jamais égale à 1. Un moteur qui affiche
     une certitude absolue sur une phrase humaine se trompe sur la nature du
     problème. */
  function confianceDe(candidat) {
    if (!candidat) return 0;
    if (candidat.formulationValidee) return 0.98;
    var base = candidat.exact ? 0.82 : 0.62;
    var bonus = Math.min(0.12, Math.max(0, candidat.score - candidat.groupes) * 0.24);
    var profondeur = Math.min(0.04, (candidat.groupes - 1) * 0.02);
    return Math.round(Math.min(0.97, base + bonus + profondeur) * 100) / 100;
  }

  /* ==========================================================================
     3-4. Entités et portée
     --------------------------------------------------------------------------
     `contexte` ne contient que des NOMS : zones, clusters, villages, équipes.
     Aucune valeur métier n'y entre, et rien n'en sort qui puisse servir à
     autre chose qu'à situer la question.
     ====================================================================== */

  function contientExpression(nq, expr) {
    if (!expr) return false;
    var i = nq.indexOf(expr);
    while (i >= 0) {
      var avant = i === 0 || nq.charAt(i - 1) === " ";
      var apres = i + expr.length === nq.length || nq.charAt(i + expr.length) === " ";
      if (avant && apres) return true;
      i = nq.indexOf(expr, i + 1);
    }
    return false;
  }

  /* Priorité en cas d'égalité de longueur : du plus spécifique au plus large.
     Une équipe nommée porte plus d'information qu'un cluster, qui en porte
     plus qu'une zone. */
  var RANG_PORTEE = { rt: 4, village: 3, cluster: 2, zone: 1 };

  function detecterPortee(nq, contexte) {
    contexte = contexte || {};
    var candidats = [];

    /* Zones AFLP : « GBEKE 1 », « GBEKE 2 », et les raccourcis « zone 1/2 ». */
    var mz = nq.match(/\bgbeke\s*([12])\b/) || nq.match(/\bzone\s*([12])\b/);
    if (mz) {
      var codeZone = "GBEKE " + mz[1];
      if (!contexte.zones || contexte.zones.indexOf(codeZone) >= 0) {
        candidats.push({ type: "zone", id: codeZone, label: codeZone, longueur: 7 });
      }
    }
    (contexte.zones || []).forEach(function (z) {
      var n = normaliser(z);
      if (n.length >= 4 && contientExpression(nq, n)) {
        candidats.push({ type: "zone", id: z, label: z, longueur: n.length });
      }
    });
    (contexte.clusters || []).forEach(function (c) {
      var n = normaliser(c.label);
      if (n.length >= 4 && contientExpression(nq, n)) {
        candidats.push({ type: "cluster", id: c.cle, label: c.label, longueur: n.length });
      }
    });
    (contexte.villages || []).forEach(function (v) {
      var n = normaliser(v.nom);
      if (n.length >= 4 && contientExpression(nq, n)) {
        candidats.push({ type: "village", id: v.nom, label: v.nom, longueur: n.length });
      }
    });
    (contexte.rt || []).forEach(function (r) {
      var n = normaliser(r.nom);
      if (n.length >= 4 && contientExpression(nq, n)) {
        candidats.push({ type: "rt", id: r.cle, label: r.nom, longueur: n.length });
      }
    });

    /* Rattrapage approché : « beoumy », « brobbo », « sakasou ». Un nom de lieu
       mal orthographié est le cas le plus fréquent sur un téléphone de terrain,
       et refuser la portée pour une lettre transposée revient à répondre sur le
       pilote entier — un chiffre juste, à la mauvaise question. Ce rattrapage
       ne s'applique qu'aux libellés d'un seul mot : sur une expression, une
       lettre de différence peut désigner un autre lieu. */
    var approche = false;
    if (!candidats.length) {
      var jq = jetons(nq);
      var essayer = function (type, id, label) {
        var n = normaliser(label);
        if (n.length < 5 || n.indexOf(" ") >= 0) return;
        var tol = toleranceDe(n);
        for (var k = 0; k < jq.length; k++) {
          if (jq[k].length < 4) continue;
          if (distance(jq[k], n, tol) <= tol) {
            candidats.push({ type: type, id: id, label: label, longueur: n.length });
            return;
          }
        }
      };
      (contexte.clusters || []).forEach(function (c) { essayer("cluster", c.cle, c.label); });
      (contexte.villages || []).forEach(function (v) { essayer("village", v.nom, v.nom); });
      (contexte.rt || []).forEach(function (r) { essayer("rt", r.cle, r.nom); });
      approche = candidats.length > 0;
    }

    if (!candidats.length) return { type: "global", id: null, label: "ensemble du pilote" };
    candidats.sort(function (a, b) {
      return (b.longueur - a.longueur) || (RANG_PORTEE[b.type] - RANG_PORTEE[a.type]);
    });
    var g = candidats[0];
    return { type: g.type, id: g.id, label: g.label, approche: approche };
  }

  /* Marqueurs explicites d'un périmètre global. Sans eux, une question sans
     portée reste une question sans portée — et certaines intentions demandent
     alors une clarification plutôt que de supposer. */
  var MOTS_GLOBAL = ["global", "globale", "total", "totale", "ensemble", "partout",
    "general", "generale", "pilote", "programme", "aflp", "tout", "toutes", "tous"];

  function porteeExpliciteGlobale(nq, jq) {
    for (var i = 0; i < MOTS_GLOBAL.length; i++) {
      if (apparier(MOTS_GLOBAL[i], jq, nq) === 1) return true;
    }
    return false;
  }

  /* ==========================================================================
     5. Période et filtres
     ====================================================================== */

  var MOTS_PERIODE = [
    { code: "day", mots: ["aujourd hui", "aujourdhui", "ce jour", "du jour", "de la journee", "journee", "today"] },
    { code: "week", mots: ["semaine", "hebdo", "hebdomadaire", "7 jours", "sept jours", "derniers jours"] },
    { code: "campaign", mots: ["cumul", "cumule", "campagne", "depuis le debut", "global", "total"] }
  ];

  function detecterPeriode(nq, jq, intention) {
    var trouve = null;
    MOTS_PERIODE.forEach(function (p) {
      p.mots.forEach(function (m) {
        if (apparier(m, jq, nq) === 1) trouve = p.code;
      });
    });
    var permises = (intention && intention.periodesAutorisees) || ["campaign"];
    if (trouve && permises.indexOf(trouve) >= 0) return trouve;
    /* Période demandée mais non permise pour cette intention : on ne la force
       pas en silence, on retombe sur la seule période autorisée. */
    return permises.indexOf("campaign") >= 0 ? "campaign" : permises[0];
  }

  var MOTS_VENTILATION = [
    { code: "cluster", mots: ["par cluster", "par clusters", "chaque cluster", "des clusters"] },
    { code: "zone", mots: ["par zone", "par zones", "chaque zone", "des zones"] },
    { code: "village", mots: ["par village", "par villages", "chaque village"] },
    { code: "rt", mots: ["par rt", "par equipe", "par equipes", "chaque equipe"] }
  ];

  function detecterFiltres(nq, jq, intention) {
    var f = {}, permis = (intention && intention.filtresAutorises) || [];
    if (permis.indexOf("breakdown") >= 0) {
      MOTS_VENTILATION.forEach(function (v) {
        v.mots.forEach(function (m) { if (contientExpression(nq, m)) f.breakdown = v.code; });
      });
    }
    if (permis.indexOf("status") >= 0) {
      if (apparier("actif", jq, nq) === 1 || apparier("actifs", jq, nq) === 1 ||
          apparier("active", jq, nq) === 1 || apparier("actives", jq, nq) === 1) {
        f.status = "active";
      } else if (apparier("enregistrees", jq, nq) === 1 || apparier("enregistres", jq, nq) === 1 ||
                 apparier("referencees", jq, nq) === 1) {
        f.status = "registered";
      }
    }
    if (f.status === undefined && permis.indexOf("status") >= 0) f.status = "all";
    return f;
  }

  /* ==========================================================================
     6. Validation du contrat contre un schéma FERMÉ
     --------------------------------------------------------------------------
     Cette fonction est le point de contrôle unique. Le contrat produit ici et
     celui que renverrait un jour une couche linguistique passent tous deux par
     elle, sans exception et sans variante « de confiance ».
     ====================================================================== */

  var CLES_CONTRAT = ["intent", "scope", "period", "filters", "confidence",
    "requires_clarification", "clarification_question"];
  var CLES_PORTEE = ["type", "id", "label"];

  function valider(contrat) {
    var cat = catalogue(), erreurs = [];
    if (!contrat || typeof contrat !== "object") return ["contrat absent ou non structuré"];

    Object.keys(contrat).forEach(function (k) {
      if (CLES_CONTRAT.indexOf(k) < 0) erreurs.push("clé inconnue dans le contrat : " + k);
    });

    var intention = contrat.intent == null ? null : cat.parCode(contrat.intent);
    if (contrat.intent != null) {
      if (!intention) erreurs.push("intention inconnue : " + contrat.intent);
      else if (intention.statut === "desactive") erreurs.push("intention désactivée : " + contrat.intent);
      else if (intention.statut === "brouillon") erreurs.push("intention non publiée : " + contrat.intent);
    }

    var p = contrat.scope;
    if (!p || typeof p !== "object") erreurs.push("portée absente");
    else {
      Object.keys(p).forEach(function (k) {
        if (CLES_PORTEE.indexOf(k) < 0) erreurs.push("clé inconnue dans la portée : " + k);
      });
      if (cat.portees.indexOf(p.type) < 0) erreurs.push("type de portée inconnu : " + p.type);
      else if (intention && intention.porteesAutorisees.indexOf(p.type) < 0) {
        erreurs.push("portée « " + p.type + " » non autorisée pour " + contrat.intent);
      }
      if (p.type !== "global" && !p.id) erreurs.push("portée « " + p.type + " » sans identifiant");
    }

    if (cat.periodes.indexOf(contrat.period) < 0) {
      erreurs.push("période inconnue : " + contrat.period);
    } else if (intention && intention.periodesAutorisees.indexOf(contrat.period) < 0) {
      erreurs.push("période « " + contrat.period + " » non autorisée pour " + contrat.intent);
    }

    var f = contrat.filters;
    if (f == null || typeof f !== "object" || Array.isArray(f)) erreurs.push("filtres absents ou non structurés");
    else {
      Object.keys(f).forEach(function (k) {
        if (cat.filtres.indexOf(k) < 0) { erreurs.push("filtre inconnu : " + k); return; }
        if (intention && intention.filtresAutorises.indexOf(k) < 0) {
          erreurs.push("filtre « " + k + " » non autorisé pour " + contrat.intent);
        }
        if (k === "breakdown" && f[k] != null && cat.breakdowns.indexOf(f[k]) < 0) {
          erreurs.push("ventilation inconnue : " + f[k]);
        }
        if (k === "status" && f[k] != null && cat.statutsFiltre.indexOf(f[k]) < 0) {
          erreurs.push("statut de filtre inconnu : " + f[k]);
        }
      });
    }

    var c = contrat.confidence;
    if (typeof c !== "number" || !isFinite(c) || c < 0 || c > 1) {
      erreurs.push("confiance hors [0,1]");
    }
    if (typeof contrat.requires_clarification !== "boolean") {
      erreurs.push("requires_clarification doit être un booléen");
    }
    if (contrat.requires_clarification && !contrat.clarification_question) {
      erreurs.push("clarification demandée sans question de clarification");
    }
    if (contrat.clarification_question != null && typeof contrat.clarification_question !== "string") {
      erreurs.push("clarification_question doit être une chaîne ou null");
    }
    return erreurs;
  }

  /* ==========================================================================
     7. Compréhension complète
     ====================================================================== */

  var QUESTION_HORS_PERIMETRE =
    "Je ne sais pas répondre à cette question à partir des données FBMS chargées. " +
    "Je ne devine pas : reformulez avec un mot-clé métier (volume, avance, " +
    "réconciliation, refinancement, sacs, village, RT).";

  function comprendre(question, contexte) {
    var brut = String(question == null ? "" : question);
    var nq = normaliser(brut);
    var jq = jetons(nq);

    var contrat = {
      intent: null,
      scope: { type: "global", id: null, label: "ensemble du pilote" },
      period: "campaign",
      filters: {},
      confidence: 0,
      requires_clarification: false,
      clarification_question: null
    };
    var trace = { normalise: nq, candidats: [], motif: "" };

    if (!nq) {
      contrat.requires_clarification = true;
      contrat.clarification_question =
        "Posez une question sur le volume, la caisse, la réconciliation, le " +
        "refinancement, la sacherie, les équipes RT ou la couverture terrain.";
      trace.motif = "question vide";
      return { contrat: contrat, trace: trace, erreurs: [] };
    }

    var candidats = detecterIntention(brut, nq, jq);
    trace.candidats = candidats.slice(0, 3).map(function (c) {
      return { code: c.code, score: Math.round(c.score * 100) / 100, exact: c.exact };
    });

    if (!candidats.length) {
      contrat.requires_clarification = true;
      contrat.clarification_question = QUESTION_HORS_PERIMETRE;
      trace.motif = "aucune intention reconnue";
      return { contrat: contrat, trace: trace, erreurs: [] };
    }

    var tete = candidats[0];
    var intention = tete.intention;
    contrat.intent = tete.code;
    contrat.confidence = confianceDe(tete);
    var portee = detecterPortee(nq, contexte);
    if (portee.approche) {
      /* Nom de lieu reconnu de façon approchée : la portée est retenue, mais la
         confiance plafonne et la trace le dit. */
      trace.porteeApprochee = portee.label;
      contrat.confidence = Math.min(contrat.confidence, 0.84);
      delete portee.approche;
    } else {
      delete portee.approche;
    }
    contrat.scope = portee;
    if (intention.porteesAutorisees.indexOf(contrat.scope.type) < 0) {
      /* Portée détectée mais interdite pour cette intention (ex. : un solde de
         sacs par village, que FBMS n'agrège pas). On remonte au niveau
         immédiatement autorisé plutôt que de répondre à côté. */
      trace.porteeRamenee = contrat.scope.type;
      contrat.scope = { type: "global", id: null, label: "ensemble du pilote" };
    }
    contrat.period = detecterPeriode(nq, jq, intention);
    contrat.filters = detecterFiltres(nq, jq, intention);

    /* Ambiguïté : deux intentions séparées par moins de 10 % de score et de
       même profondeur. Le moteur ne tranche pas à pile ou face. */
    if (candidats.length > 1 && !tete.formulationValidee) {
      var suivant = candidats[1];
      var ecart = tete.score ? (tete.score - suivant.score) / tete.score : 0;
      if (ecart < 0.1 && suivant.groupes === tete.groupes) {
        contrat.requires_clarification = true;
        contrat.clarification_question =
          "Votre question peut vouloir dire deux choses : « " + intention.nom +
          " » ou « " + suivant.intention.nom + " ». Laquelle vous intéresse ?";
        contrat.confidence = Math.min(contrat.confidence, 0.5);
        trace.motif = "ambiguïté entre " + tete.code + " et " + suivant.code;
      }
    }

    /* Clarification propre à l'intention : portée obligatoire non fournie. */
    if (!contrat.requires_clarification && intention.clarification &&
        intention.clarification.quand === "portee_absente" &&
        contrat.scope.type === "global" && !porteeExpliciteGlobale(nq, jq)) {
      contrat.requires_clarification = true;
      contrat.clarification_question = intention.clarification.question;
      trace.motif = "portée non précisée";
    }

    /* Confiance sous le seuil de l'intention : on préfère demander. */
    if (!contrat.requires_clarification && contrat.confidence < intention.confianceMin) {
      contrat.requires_clarification = true;
      contrat.clarification_question =
        "Je comprends « " + intention.nom + " » sans en être sûr. Confirmez-vous, " +
        "ou reformulez avec le mot métier exact ?";
      trace.motif = "confiance sous le seuil de l'intention";
    }

    var erreurs = valider(contrat);
    if (erreurs.length) {
      trace.motif = "contrat refusé : " + erreurs.join(" ; ");
      contrat.intent = null;
      contrat.confidence = 0;
      contrat.requires_clarification = true;
      contrat.clarification_question = QUESTION_HORS_PERIMETRE;
    }
    return { contrat: contrat, trace: trace, erreurs: erreurs };
  }

  var API = {
    version: VERSION,
    normaliser: normaliser,
    jetons: jetons,
    distance: distance,
    comprendre: comprendre,
    valider: valider,
    detecterPortee: detecterPortee,
    clesContrat: CLES_CONTRAT,
    questionHorsPerimetre: QUESTION_HORS_PERIMETRE
  };

  global.AFLP_IA_COMPREHENSION = API;
  if (typeof module === "object" && module.exports) module.exports = API;

})(typeof window !== "undefined" ? window : this);
