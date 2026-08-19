/* ============================================================================
   AFLP — NIVEAU 3 : COUCHE PRÉDICTIVE (shared/aflp-ia-predictif.js)
   ----------------------------------------------------------------------------
   ANAGROCI FieldLink Programme (AFLP) 2027.

   Ce fichier prolonge shared/aflp-ia-moteur.js (Niveau 2, assistance métier).
   Le Niveau 2 décrit ce qui S'EST PASSÉ. Le Niveau 3 propose ce qui POURRAIT
   se passer — et rien d'autre.

   ------------------------------------------------------------------ CE QU'IL FAIT
     · diagnostic de maturité des données, cas d'usage par cas d'usage (R0→R3)
     · prévisions avec intervalles, comparées à une baseline mesurée
     · scores explicables, signaux à examiner, priorités de contrôle

   -------------------------------------------------------------- CE QU'IL NE FAIT PAS
     Il n'autorise pas une avance, ne modifie pas un plafond, ne déclenche pas
     de transfert, ne lève pas un blocage, ne valide pas une perte, ne sanctionne
     personne, n'accuse personne de fraude, ne touche à aucune transaction.
     Ces interdits ne sont PAS de simples avertissements : ils sont portés par
     `GARDES` et par `executer()`, qui refuse tout verbe d'action et journalise
     le refus. Le fichier n'expose aucune fonction d'écriture, aucun appel
     réseau, aucun accès au DOM, aucune clé.

   ----------------------------------------------------------------- MÉTHODE
     Aucune bibliothèque, aucun modèle entraîné, aucun poids embarqué. Les
     calculs sont des statistiques déterministes, recalculables à la main :
     médiane mobile, moyenne mobile, naïf saisonnier, quantiles empiriques,
     z-score modifié de Iglewicz & Hoaglin. C'est le niveau que les données
     autorisent aujourd'hui (voir `diagnostic()`), pas un choix de facilité.

     Toute donnée postérieure à `dateRef` est écartée à la construction du jeu
     de données : la fuite temporelle est empêchée en amont, pas contrôlée après.

   Déterminisme : mêmes données + même `dateRef` = même sortie, au bit près.
   ========================================================================== */
(function (global) {
  "use strict";

  var VERSION = "3.0.0";
  var VERSION_VARIABLES = "vars-1.0.0";

  /* ==========================================================================
     1. Utilitaires — mêmes conventions de clé que le Niveau 2 et le Command
        Center. Toute autre convention ferait diverger les totaux sur des
        données identiques.
     ====================================================================== */

  function nb(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function txt(x) { return x == null ? "" : String(x); }

  function cle(s) {
    return txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function jour(v) {
    if (!v) return "";
    var s = txt(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var d = new Date(s);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  function ecartJours(a, b) {
    if (!a || !b) return null;
    var da = Date.parse(a + "T00:00:00Z"), db = Date.parse(b + "T00:00:00Z");
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000);
  }

  function decalerJour(ref, n) {
    var d = Date.parse(ref + "T00:00:00Z");
    if (isNaN(d)) return "";
    var x = new Date(d + n * 86400000);
    return x.getUTCFullYear() + "-" + String(x.getUTCMonth() + 1).padStart(2, "0") +
      "-" + String(x.getUTCDate()).padStart(2, "0");
  }

  function fmtNombre(x) {
    if (x == null || !isFinite(Number(x))) return "—";
    return Math.round(Number(x)).toLocaleString("fr-FR");
  }
  function fmtMT(kg) {
    if (kg == null || !isFinite(Number(kg))) return "—";
    return (Math.round((nb(kg) / 1000) * 10) / 10).toLocaleString("fr-FR");
  }
  function fmtF(x) { return fmtNombre(x) + " F"; }
  function fmtPct(x) {
    if (x == null || !isFinite(Number(x))) return "—";
    return (Math.round(Number(x) * 10) / 10).toLocaleString("fr-FR") + " %";
  }

  /* Empreinte déterministe (FNV-1a 32 bits) — sert à versionner un jeu de
     données. Ce n'est pas une empreinte cryptographique et ne prétend pas
     l'être : elle sert à détecter un changement de contenu, pas à résister
     à une falsification. */
  function empreinte(s) {
    var h = 0x811c9dc5, i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  /* ==========================================================================
     2. Statistiques robustes
     --------------------------------------------------------------------------
     Robustes = peu sensibles aux valeurs extrêmes. Sur des séries d'achats
     villageois, une journée de marché exceptionnelle ne doit pas déplacer la
     référence de toutes les autres.
     ====================================================================== */

  function somme(v) { var s = 0, i; for (i = 0; i < v.length; i++) s += nb(v[i]); return s; }
  function moyenne(v) { return v.length ? somme(v) / v.length : null; }

  function mediane(v) {
    if (!v.length) return null;
    var t = v.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(t.length / 2);
    return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
  }

  /* Quantile par interpolation linéaire (méthode 7 de Hyndman & Fan, celle de
     R par défaut). Choisie parce qu'elle est la plus répandue et donc la plus
     facile à reproduire par un tiers qui voudrait vérifier un intervalle. */
  function quantile(v, p) {
    if (!v.length) return null;
    var t = v.slice().sort(function (a, b) { return a - b; });
    if (t.length === 1) return t[0];
    var h = (t.length - 1) * p;
    var lo = Math.floor(h), hi = Math.ceil(h);
    return t[lo] + (h - lo) * (t[hi] - t[lo]);
  }

  function ecartType(v) {
    if (v.length < 2) return null;
    var m = moyenne(v), s = 0, i;
    for (i = 0; i < v.length; i++) s += (v[i] - m) * (v[i] - m);
    return Math.sqrt(s / (v.length - 1));
  }

  /* MAD — écart absolu médian. Le facteur 1.4826 rend la MAD comparable à un
     écart-type sur données normales (constante standard, non inventée ici). */
  function mad(v) {
    var m = mediane(v);
    if (m == null) return null;
    return mediane(v.map(function (x) { return Math.abs(x - m); }));
  }

  /* z modifié de Iglewicz & Hoaglin (1993), seuil publié 3.5.
     Nous ne fixons donc PAS un seuil « au jugé » : nous reprenons un critère
     documenté, et nous l'écrivons ici pour qu'il soit contestable. */
  function zModifie(x, v) {
    var m = mediane(v), d = mad(v);
    if (m == null) return null;
    if (d == null || d === 0) {
      /* MAD nulle : série quasi constante. On retombe sur l'écart moyen absolu
         (facteur 1.253314), sinon toute variation deviendrait « infinie ». */
      var mm = moyenne(v.map(function (y) { return Math.abs(y - m); }));
      if (!mm) return 0;
      return (x - m) / (1.253314 * mm);
    }
    return 0.6745 * (x - m) / d;
  }

  /* Indice de Herfindahl-Hirschman, normalisé [0,1]. 1 = un seul contributeur. */
  function hhi(parts) {
    var tot = somme(parts);
    if (!tot) return null;
    var h = 0, i;
    for (i = 0; i < parts.length; i++) { var p = parts[i] / tot; h += p * p; }
    return h;
  }

  /* ==========================================================================
     3. Seuils — justifiés, versionnés, surchargeables
     --------------------------------------------------------------------------
     Chaque seuil porte sa raison d'être. Un seuil sans justification est un
     seuil qu'on abaissera un jour pour rendre les données « éligibles » ; c'est
     exactement ce que le cadrage interdit.
     ====================================================================== */

  var SEUILS_DEFAUT = {
    /* --- Maturité des données ------------------------------------------- */
    /* R1 (baseline) : il faut au moins deux fenêtres de 7 jours pour qu'une
       moyenne mobile ait un sens, et 8 jours d'activité pour que la médiane ne
       soit pas dictée par 1 ou 2 points. */
    r1MinJoursHistorique: 14,
    r1MinObservations: 8,
    /* R2 (modèle testable) : une validation temporelle honnête exige plusieurs
       origines de repli. Avec un horizon de 7 jours et 4 plis minimum, il faut
       28 jours réservés au test, plus 28 jours d'apprentissage initial : 56,
       arrondi à 60 pour absorber les jours sans achat. */
    r2MinJoursHistorique: 60,
    r2MinObservations: 30,
    r2MinPlis: 4,
    /* Une saisonnalité de campagne ne s'estime pas sur une seule campagne.
       Deux campagnes donnent un écart, trois donnent une tendance. */
    r2MinCampagnes: 2,
    /* Un intervalle empirique à 80 % lu sur les quantiles 10 % et 90 % demande
       au moins 10 résidus pour que chaque borne repose sur plus d'un point. */
    minResidusIntervalle: 10,
    /* Au-delà, les données manquantes ne sont plus un défaut ponctuel mais une
       caractéristique de la colonne : elle cesse d'être utilisable comme
       variable. Valeur alignée sur la pratique courante en préparation de
       données ; elle est configurable et doit être arbitrée par le métier. */
    maxTauxManquant: 0.30,
    /* --- Détection ------------------------------------------------------- */
    zAnomalie: 3.5,               // Iglewicz & Hoaglin
    hhiConcentration: 0.40,       // ~2,5 producteurs équivalents : concentration forte
    /* --- Prévision ------------------------------------------------------- */
    fenetreCourte: 7,
    fenetreLongue: 28,
    /* Au-delà de ce WAPE, la prévision est trop incertaine pour être montrée
       comme un chiffre : elle est montrée comme une fourchette avec réserve. */
    wapeAvertissement: 0.35,
    /* --- Fonds ----------------------------------------------------------- */
    margeSecurite: 0.10,          // 10 % — paramètre Finance, pas une constante
    /* --- Fraîcheur des données ------------------------------------------- */
    retardDonneesJours: 2         // au-delà, la confiance est dégradée d'un cran
  };

  var HORIZONS = [1, 7, 30];

  var SEUILS = JSON.parse(JSON.stringify(SEUILS_DEFAUT));

  function seuils(surcharge) {
    if (surcharge && typeof surcharge === "object") {
      Object.keys(surcharge).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(SEUILS, k)) SEUILS[k] = surcharge[k];
      });
    }
    return SEUILS;
  }

  function reinitialiserSeuils() {
    SEUILS = JSON.parse(JSON.stringify(SEUILS_DEFAUT));
    return SEUILS;
  }

  /* Surcharge par la table `parametres_calcul` (clés `aflp_pred_*`), pour que
     le métier puisse ajuster un seuil sans toucher au code. */
  function appliquerParametres(parametres) {
    if (!parametres || !parametres.length) return;
    parametres.forEach(function (p) {
      var k = txt(p && p.cle);
      if (k.indexOf("aflp_pred_") !== 0) return;
      var nom = k.slice("aflp_pred_".length);
      if (!Object.prototype.hasOwnProperty.call(SEUILS, nom)) return;
      var v = Number(p.valeur);
      if (isFinite(v)) SEUILS[nom] = v;
    });
  }

  /* ==========================================================================
     4. Garde-fous — les limites absolues, imposées techniquement
     --------------------------------------------------------------------------
     `executer()` est le seul point d'entrée qui ressemble à une action. Il
     refuse TOUT, sans exception et sans paramètre d'échappement. Sa présence
     est volontaire : elle rend l'interdit exécutable, donc testable, au lieu
     de le laisser à l'état de phrase dans un document.
     ====================================================================== */

  var GARDES = [
    { code: "G01", interdit: "autoriser une avance", role: "Finance" },
    { code: "G02", interdit: "modifier un plafond de financement", role: "Finance" },
    { code: "G03", interdit: "déclencher un transfert Wave", role: "Finance" },
    { code: "G04", interdit: "lever un blocage", role: "Branch Manager" },
    { code: "G05", interdit: "valider une perte", role: "Quality / Factory" },
    { code: "G06", interdit: "approuver une exception", role: "Branch Manager" },
    { code: "G07", interdit: "modifier une transaction clôturée", role: "Branch Manager" },
    { code: "G08", interdit: "supprimer une transaction ou une preuve", role: "Branch Manager" },
    { code: "G09", interdit: "sanctionner une équipe RT", role: "Ressources humaines" },
    { code: "G10", interdit: "qualifier un utilisateur de fraudeur", role: "Investigation humaine" },
    { code: "G11", interdit: "remplacer une approbation humaine obligatoire", role: "Gouvernance AFLP" },
    { code: "G12", interdit: "créer une mission ou une commande de transport", role: "Logistics Coordinator" },
    { code: "G13", interdit: "modifier un rôle utilisateur", role: "Branch Manager" },
    { code: "G14", interdit: "sortir du stock", role: "Logistics Coordinator" }
  ];

  /* Sorties légitimes de la couche prédictive — la liste est fermée. */
  var SORTIES_AUTORISEES = [
    "prevision", "intervalle", "score", "signal", "recommandation", "priorite"
  ];

  var JOURNAL_REFUS = [];

  function executer(action) {
    var demande = txt(action && (action.type || action)) || "(vide)";
    var refus = {
      accepte: false,
      demande: demande,
      motif: "La couche prédictive AFLP ne produit que des " +
        SORTIES_AUTORISEES.join(", ") + ". Toute décision opérationnelle ou " +
        "financière reste humaine, nominative, motivée et auditée.",
      gardes: GARDES.map(function (g) { return g.code + " · " + g.interdit; }),
      rang: JOURNAL_REFUS.length
    };
    JOURNAL_REFUS.push(refus);
    return refus;
  }

  function journalRefus() { return JOURNAL_REFUS.slice(); }

  /* ==========================================================================
     5. Registre des modèles et interrupteur d'arrêt (kill switch)
     --------------------------------------------------------------------------
     Statuts possibles :
       NOT_READY        — les données ne permettent pas de produire ce modèle
       SHADOW_ONLY      — calculé et enregistré, sans influence sur les décisions
       DECISION_SUPPORT — affiché aux décideurs, jamais automatisé
     Le passage à DECISION_SUPPORT est une décision de gouvernance, pas un
     effet de bord du code : `promouvoir()` exige des validations nominatives.
     ====================================================================== */

  var MODELES_DEFAUT = {
    volumes:     { cle: "volumes",     nom: "Prévision des volumes par village", statutMax: "SHADOW_ONLY", actif: true },
    fonds:       { cle: "fonds",       nom: "Estimation du besoin de fonds",     statutMax: "SHADOW_ONLY", actif: true },
    scorecardRt: { cle: "scorecardRt", nom: "Scorecard des équipes RT",          statutMax: "SHADOW_ONLY", actif: true },
    signaux:     { cle: "signaux",     nom: "Comportements inhabituels",         statutMax: "SHADOW_ONLY", actif: true },
    evacuations: { cle: "evacuations", nom: "Prévision des évacuations",         statutMax: "SHADOW_ONLY", actif: true },
    qualite:     { cle: "qualite",     nom: "Écarts de qualité",                 statutMax: "SHADOW_ONLY", actif: true }
  };

  var MODELES = JSON.parse(JSON.stringify(MODELES_DEFAUT));

  function reinitialiserModeles() {
    MODELES = JSON.parse(JSON.stringify(MODELES_DEFAUT));
    return MODELES;
  }

  /* Interrupteur d'arrêt : désactiver un modèle n'arrête RIEN d'autre. Le reste
     de FBMS — et le Niveau 2 — continuent de fonctionner à l'identique. */
  function desactiver(cleModele, motif) {
    var m = MODELES[cleModele];
    if (!m) return { ok: false, motif: "Modèle inconnu : " + txt(cleModele) };
    m.actif = false;
    m.motifDesactivation = txt(motif) || "non précisé";
    return { ok: true, modele: m.cle, statut: "DESACTIVE", motif: m.motifDesactivation };
  }

  function reactiver(cleModele) {
    var m = MODELES[cleModele];
    if (!m) return { ok: false, motif: "Modèle inconnu : " + txt(cleModele) };
    m.actif = true;
    delete m.motifDesactivation;
    return { ok: true, modele: m.cle, statut: m.statutMax };
  }

  function registre() {
    return Object.keys(MODELES).map(function (k) {
      var m = MODELES[k];
      return {
        cle: m.cle, nom: m.nom, actif: m.actif,
        statutMax: m.statutMax,
        motifDesactivation: m.motifDesactivation || null,
        version: VERSION, versionVariables: VERSION_VARIABLES
      };
    });
  }

  var VALIDATIONS_REQUISES = {
    volumes: ["branchManager"],
    fonds: ["finance", "branchManager"],
    scorecardRt: ["gouvernanceAflp", "branchManager"],
    signaux: ["branchManager"],
    evacuations: ["logistics", "branchManager"],
    qualite: ["quality", "branchManager"]
  };

  /* Une promotion en aide à la décision exige des validations NOMINATIVES.
     Sans elles, la fonction refuse — c'est la procédure de gouvernance rendue
     exécutable, donc testable. */
  function promouvoir(cleModele, validations) {
    var m = MODELES[cleModele];
    if (!m) return { ok: false, motif: "Modèle inconnu" };
    var requises = VALIDATIONS_REQUISES[cleModele] || ["branchManager"];
    var manquantes = requises.filter(function (r) {
      return !(validations && validations[r] && txt(validations[r]).length > 2);
    });
    if (manquantes.length) {
      return {
        ok: false, statut: m.statutMax,
        motif: "Validations nominatives manquantes : " + manquantes.join(", "),
        requises: requises
      };
    }
    if (!validations.performanceSuperieureBaseline) {
      return { ok: false, statut: m.statutMax,
        motif: "Aucune preuve de performance supérieure à la baseline.",
        requises: requises };
    }
    m.statutMax = "DECISION_SUPPORT";
    m.validations = validations;
    return { ok: true, statut: m.statutMax, validations: requises };
  }

  function statutModele(cleModele, readiness) {
    var m = MODELES[cleModele];
    if (!m) return "NOT_READY";
    if (!m.actif) return "DESACTIVE";
    if (!readiness || readiness.niveau === "R0") return "NOT_READY";
    return m.statutMax;
  }

  /* ==========================================================================
     6. Jeu de données — construit « à la date de référence »
     --------------------------------------------------------------------------
     Une seule règle, appliquée une seule fois, ici : rien de postérieur à
     `dateRef` n'entre. La prévention de la fuite temporelle n'est donc pas un
     contrôle a posteriori mais une propriété de construction du jeu de données.
     ====================================================================== */

  function nomVillage(v) { return txt((v && (v.nom || (v.data && v.data.nom))) || ""); }
  function clusterVillage(v) { return txt((v && (v.cluster || (v.data && v.data.cluster))) || ""); }
  function nomRt(r) { return txt((r && (r.nom || (r.data && r.data.nom))) || ""); }
  function cleRt(idOuNom, nom) { return txt(idOuNom) || cle(nom); }

  /* Série journalière complète (zéros compris) entre deux bornes. Sans les
     zéros, une moyenne calculée « sur les jours actifs » surestime le rythme
     réel : un village qui achète 3 jours sur 10 paraîtrait acheter tous les
     jours. C'est l'erreur classique sur la demande intermittente. */
  function serieComplete(parJour, debut, fin) {
    var out = [], d = debut, garde = 0;
    if (!debut || !fin || debut > fin) return out;
    while (d && d <= fin && garde < 4000) {
      out.push({ jour: d, valeur: nb(parJour[d]) });
      d = decalerJour(d, 1);
      garde++;
    }
    return out;
  }

  function construireDataset(donnees) {
    donnees = donnees || {};
    appliquerParametres(donnees.parametres);

    var dateRef = jour(donnees.dateRef) || aujourdhui();
    var achatsBruts = donnees.achats || [];
    var avancesBrutes = donnees.avances || [];
    var reconsBrutes = donnees.reconciliations || [];
    var sacsBruts = donnees.sacs || [];
    var villages = donnees.villages || [];
    var rts = donnees.rt || [];

    /* -- 6.1 Filtre temporel strict + qualification des lignes -------------- */
    var rejets = { sansDate: 0, futur: 0, sansPoids: 0, sansVillage: 0, sansRt: 0 };
    var achats = [];
    achatsBruts.forEach(function (a) {
      var d = jour(a.date);
      if (!d) { rejets.sansDate++; return; }
      if (d > dateRef) { rejets.futur++; return; }      /* <- fuite temporelle */
      if (!(nb(a.poids_net) > 0)) rejets.sansPoids++;
      if (!txt(a.village_nom)) rejets.sansVillage++;
      if (!cleRt(a.rt_id, a.rt_nom)) rejets.sansRt++;
      achats.push({
        jour: d,
        poids: nb(a.poids_net),
        poidsBrut: nb(a.poids_brut),
        tare: nb(a.tare),
        montant: nb(a.montant),
        prixKg: nb(a.prix_kg),
        commission: nb(a.commission_rt),
        village: cle(a.village_nom),
        villageNom: txt(a.village_nom),
        cluster: cle(a.cluster),
        clusterNom: txt(a.cluster),
        rt: cleRt(a.rt_id, a.rt_nom),
        rtNom: txt(a.rt_nom),
        producteur: txt(a.producteur_id) || cle(a.producteur_nom),
        producteurRef: a.producteur_ref !== false,
        humidite: (a.humidite == null || a.humidite === "") ? null : nb(a.humidite),
        kor: (a.kor == null || a.kor === "") ? null : nb(a.kor),
        rejet: a.rejet === true,
        recu: !!txt(a.numero_recu),
        refinancable: a.refinancable !== false && !!txt(a.numero_recu),
        qualiteStatut: txt(a.qualite_statut),
        statutValidation: txt(a.statut_validation),
        nbSacs: nb(a.nb_sacs)
      });
    });

    var avances = avancesBrutes.filter(function (a) {
      var d = jour(a.date); return d && d <= dateRef;
    }).map(function (a) {
      return { jour: jour(a.date), montant: nb(a.montant),
        rt: cleRt(a.rt_id, a.rt_nom), rtNom: txt(a.rt_nom), cluster: cle(a.cluster) };
    });

    var recons = reconsBrutes.filter(function (r) {
      var d = jour(r.date) || jour(r.created_at); return d && d <= dateRef;
    }).map(function (r) {
      return { jour: jour(r.date) || jour(r.created_at), rt: cleRt(r.rt_id, r.rt_nom),
        rtNom: txt(r.rt_nom), cluster: cle(r.cluster), statut: txt(r.statut),
        ecart: nb(r.ecart), cashRestant: nb(r.cash_restant), valeurStock: nb(r.valeur_stock),
        saisie: jour(r.created_at) };
    });

    var sacs = sacsBruts.filter(function (m) {
      var d = jour(m.date); return d && d <= dateRef;
    }).map(function (m) {
      return { jour: jour(m.date), type: txt(m.type), source: txt(m.source),
        destination: txt(m.destination), cluster: cle(m.cluster),
        rt: txt(m.rt_id) || cle(m.rt_nom), quantite: nb(m.quantite) };
    });

    /* -- 6.2 Séries journalières par niveau d'agrégation ------------------- */
    function agreger(champ, libelleChamp) {
      var index = {};
      achats.forEach(function (a) {
        var k = a[champ];
        if (!k) return;
        if (!index[k]) {
          index[k] = {
            cle: k, nom: txt(a[libelleChamp]) || k, cluster: a.clusterNom,
            parJour: {}, montantParJour: {}, total: 0, montant: 0, nbAchats: 0,
            premier: "", dernier: "", producteurs: {}, poidsList: [],
            humidites: [], kors: [], sansRecu: 0, rejets: 0
          };
        }
        var e = index[k];
        e.parJour[a.jour] = (e.parJour[a.jour] || 0) + a.poids;
        e.montantParJour[a.jour] = (e.montantParJour[a.jour] || 0) + a.montant;
        e.total += a.poids;
        e.montant += a.montant;
        e.nbAchats++;
        e.poidsList.push(a.poids);
        if (a.producteur) e.producteurs[a.producteur] = (e.producteurs[a.producteur] || 0) + a.poids;
        if (a.humidite != null) e.humidites.push(a.humidite);
        if (a.kor != null) e.kors.push(a.kor);
        if (!a.recu) e.sansRecu++;
        if (a.rejet) e.rejets++;
        if (!e.premier || a.jour < e.premier) e.premier = a.jour;
        if (!e.dernier || a.jour > e.dernier) e.dernier = a.jour;
      });
      Object.keys(index).forEach(function (k) {
        var e = index[k];
        e.serie = serieComplete(e.parJour, e.premier, dateRef);
        e.joursHistorique = e.serie.length;
        e.joursActifs = Object.keys(e.parJour).length;
        e.serieMontant = serieComplete(e.montantParJour, e.premier, dateRef);
        e.dernierJourSerie = dateRef;
      });
      return index;
    }

    var parVillage = agreger("village", "villageNom");
    var parCluster = agreger("cluster", "clusterNom");
    var parRt = agreger("rt", "rtNom");

    var globalParJour = {};
    achats.forEach(function (a) {
      globalParJour[a.jour] = (globalParJour[a.jour] || 0) + a.poids;
    });
    var joursTries = Object.keys(globalParJour).sort();
    var premierJour = joursTries[0] || "";
    var serieGlobale = premierJour ? serieComplete(globalParJour, premierJour, dateRef) : [];

    /* -- 6.3 Empreinte du jeu de données ----------------------------------- */
    var resume = [
      dateRef, achats.length, avances.length, recons.length, sacs.length,
      villages.length, rts.length,
      Math.round(somme(achats.map(function (a) { return a.poids; }))),
      Math.round(somme(achats.map(function (a) { return a.montant; })))
    ].join("|");

    return {
      version: VERSION,
      versionVariables: VERSION_VARIABLES,
      versionDataset: "ds-" + empreinte(resume),
      dateRef: dateRef,
      dateReferenceDonnees: joursTries.length ? joursTries[joursTries.length - 1] : "",
      retardDonneesJours: joursTries.length ? ecartJours(joursTries[joursTries.length - 1], dateRef) : null,
      achats: achats, avances: avances, recons: recons, sacs: sacs,
      villages: villages, rts: rts,
      parVillage: parVillage, parCluster: parCluster, parRt: parRt,
      serieGlobale: serieGlobale,
      premierJour: premierJour,
      joursHistorique: serieGlobale.length,
      joursActifs: joursTries.length,
      rejets: rejets,
      fileLocale: {
        enAttente: nb(donnees.fileLocale && donnees.fileLocale.enAttente),
        echecs: nb(donnees.fileLocale && donnees.fileLocale.echecs)
      },
      /* Le schéma FBMS ne porte AUCUNE colonne `campagne` : ni sur `achats`,
         ni sur `avances`, ni sur `reconciliations`. Le nombre de campagnes
         exploitables est donc au mieux 1, et c'est un fait de schéma, pas une
         estimation. Toute saisonnalité inter-campagne est hors d'atteinte. */
      campagnesDisponibles: achats.length ? 1 : 0,
      campagneColonnePresente: false
    };
  }

  /* ==========================================================================
     7. Diagnostic de maturité — la matrice R0 → R3
     --------------------------------------------------------------------------
     Ce diagnostic commande tout le reste : un cas d'usage classé R0 ne produit
     aucun modèle, quelle que soit l'élégance de l'algorithme disponible.
     ====================================================================== */

  function tauxManquant(liste, accesseur) {
    if (!liste.length) return 1;
    var n = 0;
    liste.forEach(function (x) {
      var v = accesseur(x);
      if (v == null || v === "" || v !== v) n++;
    });
    return n / liste.length;
  }

  /* Rupture de série : un trou de plus de 14 jours consécutifs sans achat au
     milieu d'un historique. Une prévision qui enjambe une rupture sans le dire
     n'est pas une prévision, c'est une extrapolation. */
  function ruptures(serie) {
    var out = [], courant = 0, i;
    for (i = 0; i < serie.length; i++) {
      if (serie[i].valeur > 0) {
        if (courant > 14) out.push({ fin: serie[i].jour, jours: courant });
        courant = 0;
      } else courant++;
    }
    if (courant > 14) out.push({ fin: "en cours", jours: courant });
    return out;
  }

  function niveauReadiness(okBase, okR1, okR2, okR3) {
    if (!okBase) return "R0";
    if (!okR1) return "R0";
    if (!okR2) return "R1";
    if (!okR3) return "R2";
    return "R3";
  }

  function fusion(a, b) {
    var out = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
    return out;
  }

  function diagnostic(dataset) {
    var d = dataset;
    var S = SEUILS;
    var cas = {};

    var poidsList = d.achats.map(function (a) { return a.poids; });
    var idsValides = d.achats.length
      ? d.achats.filter(function (a) { return !!a.rt && !!a.village; }).length / d.achats.length
      : 0;
    var rtsReconcilies = {};
    d.recons.forEach(function (r) { if (r.statut === "Réconcilié") rtsReconcilies[r.rt] = true; });
    var rtsAvecAvance = {};
    d.avances.forEach(function (a) { if (a.rt) rtsAvecAvance[a.rt] = true; });
    var nbRtAvance = Object.keys(rtsAvecAvance).length;
    var tauxReconcilie = nbRtAvance
      ? Object.keys(rtsAvecAvance).filter(function (k) { return rtsReconcilies[k]; }).length / nbRtAvance
      : null;

    var villagesCouverts = Object.keys(d.parVillage).length;
    var rtCouverts = Object.keys(d.parRt).length;
    var abers = poidsList.length > 3
      ? poidsList.filter(function (p) {
          var z = zModifie(p, poidsList);
          return z != null && Math.abs(z) > S.zAnomalie;
        }).length
      : 0;

    var mesuresCommunes = {
      observations: d.achats.length,
      profondeurJours: d.joursHistorique,
      joursActifs: d.joursActifs,
      campagnes: d.campagnesDisponibles,
      villagesCouverts: villagesCouverts,
      rtCouverts: rtCouverts,
      tauxIdentifiantsValides: idsValides,
      tauxCyclesReconcilies: tauxReconcilie,
      retardDonneesJours: d.retardDonneesJours,
      fileLocaleEnAttente: d.fileLocale.enAttente,
      fileLocaleEchecs: d.fileLocale.echecs,
      valeursAberrantes: abers,
      ruptures: ruptures(d.serieGlobale).length,
      lignesRejetees: d.rejets
    };

    /* ---- Cas 1 : volumes par village ------------------------------------ */
    (function () {
      var manquants = {
        poids: tauxManquant(d.achats, function (a) { return a.poids > 0 ? 1 : null; }),
        village: tauxManquant(d.achats, function (a) { return a.village || null; }),
        date: 0 /* garanti par construction : sans date, la ligne est rejetée */
      };
      var okBase = d.achats.length > 0 && d.joursHistorique > 0;
      var okR1 = d.joursHistorique >= S.r1MinJoursHistorique &&
                 d.joursActifs >= S.r1MinObservations &&
                 manquants.village <= S.maxTauxManquant;
      var okR2 = d.joursHistorique >= S.r2MinJoursHistorique &&
                 d.achats.length >= S.r2MinObservations;
      cas.volumes = {
        cle: "volumes",
        libelle: "Prévision des volumes par village",
        niveau: niveauReadiness(okBase, okR1, okR2, false),
        cible: "poids_net agrégé par jour et par village",
        cibleStable: true,
        mesures: fusion(mesuresCommunes, { manquants: manquants }),
        blocages: [].concat(
          okBase ? [] : ["Aucun achat exploitable à la date de référence."],
          d.joursHistorique >= S.r1MinJoursHistorique ? [] :
            ["Historique de " + d.joursHistorique + " jour(s), minimum " + S.r1MinJoursHistorique + " pour une baseline."],
          d.joursActifs >= S.r1MinObservations ? [] :
            [d.joursActifs + " jour(s) d'activité, minimum " + S.r1MinObservations + "."],
          manquants.village <= S.maxTauxManquant ? [] :
            ["Village manquant sur " + fmtPct(manquants.village * 100) + " des achats."],
          d.joursHistorique >= S.r2MinJoursHistorique ? [] :
            ["Validation temporelle limitée : " + S.r2MinJoursHistorique + " jours requis pour " + S.r2MinPlis + " plis."],
          d.campagnesDisponibles >= S.r2MinCampagnes ? [] :
            ["Aucune colonne `campagne` au schéma : la saisonnalité inter-campagne est hors d'atteinte."]
        ),
        risqueFuite: "Faible — la cible est le poids du jour, connu le jour même. " +
          "Le risque réel serait d'employer un cumul de campagne comme variable : écarté par construction."
      };
    })();

    /* ---- Cas 2 : besoin de fonds ---------------------------------------- */
    (function () {
      var prixManquant = tauxManquant(d.achats, function (a) { return a.prixKg > 0 ? 1 : null; });
      var okBase = d.achats.length > 0;
      var okR1 = cas.volumes.niveau !== "R0" && prixManquant <= S.maxTauxManquant;
      /* R2 exigerait de mesurer la durée de cycle réelle : elle se déduit des
         couples avance → réconciliation. Sans réconciliation, pas de cycle. */
      var cyclesMesurables = d.recons.length;
      var okR2 = okR1 && cyclesMesurables >= S.r2MinObservations;
      cas.fonds = {
        cle: "fonds",
        libelle: "Estimation du besoin de fonds",
        niveau: niveauReadiness(okBase, okR1, okR2, false),
        cible: "besoin de trésorerie = volume prévu × prix observé + commissions",
        cibleStable: true,
        mesures: fusion(mesuresCommunes, {
          prixManquant: prixManquant, cyclesMesurables: cyclesMesurables,
          avancesEnregistrees: d.avances.length
        }),
        blocages: [].concat(
          cas.volumes.niveau === "R0" ? ["Dépend du cas 1, actuellement R0."] : [],
          prixManquant <= S.maxTauxManquant ? [] : ["Prix/kg manquant sur " + fmtPct(prixManquant * 100) + " des achats."],
          cyclesMesurables >= S.r2MinObservations ? [] :
            [cyclesMesurables + " réconciliation(s) : durée de cycle mal estimée (" + S.r2MinObservations + " requis)."],
          ["Aucune table de frais de paiement (Wave) au schéma : les frais sont un paramètre, pas une mesure."],
          ["Ni liquidité disponible ni rythme de refinancement au schéma."]
        ),
        risqueFuite: "Modéré — l'exposition ouverte doit être arrêtée à la date de " +
          "référence, sinon une avance postérieure gonflerait rétroactivement le besoin estimé. Filtre appliqué."
      };
    })();

    /* ---- Cas 3 : scorecard RT ------------------------------------------- */
    (function () {
      var rtAvecAssezDeDonnees = Object.keys(d.parRt).filter(function (k) {
        return d.parRt[k].nbAchats >= S.r1MinObservations;
      }).length;
      var okBase = rtCouverts > 0;
      var okR1 = rtAvecAssezDeDonnees > 0;
      var okR2 = rtAvecAssezDeDonnees >= 10 && d.joursHistorique >= S.r2MinJoursHistorique;
      cas.scorecardRt = {
        cle: "scorecardRt",
        libelle: "Scorecard des équipes RT",
        niveau: niveauReadiness(okBase, okR1, okR2, false),
        cible: "aucune cible unique — 8 dimensions mesurées séparément",
        cibleStable: false,
        mesures: fusion(mesuresCommunes, {
          rtAvecAssezDeDonnees: rtAvecAssezDeDonnees,
          seuilObservationsRt: S.r1MinObservations
        }),
        blocages: [].concat(
          okBase ? [] : ["Aucune équipe RT avec achat."],
          rtAvecAssezDeDonnees ? [] : ["Aucune équipe n'atteint " + S.r1MinObservations + " achats."],
          ["Pas de table d'incidents validés au périmètre AFLP : la dimension « incidents » reste vide."],
          ["Pas de date d'entrée d'équipe RT au schéma : l'audit de biais par ancienneté est incalculable."]
        ),
        risqueFuite: "Élevé si un score servait à prédire un incident futur. Écarté : " +
          "la scorecard est DESCRIPTIVE, elle ne prédit rien et ne classe personne."
      };
    })();

    /* ---- Cas 4 : comportements inhabituels ------------------------------ */
    (function () {
      var okBase = d.achats.length > 0;
      var okR1 = d.achats.length >= S.r1MinObservations * 3;
      var okR2 = d.achats.length >= 500 && rtCouverts >= 10;
      cas.signaux = {
        cle: "signaux",
        libelle: "Comportements inhabituels",
        niveau: niveauReadiness(okBase, okR1, okR2, false),
        cible: "aucune — pas de vérité terrain étiquetée",
        cibleStable: false,
        mesures: fusion(mesuresCommunes, { achatsAnalyses: d.achats.length }),
        blocages: [].concat(
          okR1 ? [] : ["Moins de " + (S.r1MinObservations * 3) + " achats : aucune norme de comparaison estimable."],
          ["Aucun signal historiquement confirmé ou infirmé : le taux de faux positifs ne peut pas être MESURÉ, " +
           "seulement suivi à partir des retours humains à venir."],
          ["Pas d'identifiant d'appareil au schéma : la détection de schémas inter-appareils est hors d'atteinte."]
        ),
        risqueFuite: "Sans objet — détection non supervisée sur le passé uniquement. " +
          "Le risque dominant n'est pas la fuite mais le faux positif."
      };
    })();

    /* ---- Cas 5 : évacuations -------------------------------------------- */
    (function () {
      /* Fait de schéma, vérifié : au périmètre AFLP (achats / avances /
         reconciliations / sacs_mouvements), aucune table n'enregistre une
         sortie de stock village → cluster → usine. Les tables rcn_* couvrent
         la réception usine mais ne portent AUCUNE clé de jointure vers
         `achats`. Le stock « restant » n'est donc pas observable : il ne peut
         qu'être supposé égal au cumul acheté, ce qui est faux dès la première
         évacuation. */
      var evac = (d.evacuations || []).length;
      var capacites = d.capacites || null;
      cas.evacuations = {
        cle: "evacuations",
        libelle: "Prévision des évacuations",
        niveau: (evac > 0 && capacites) ? "R1" : "R0",
        cible: "date de saturation d'un point de stockage",
        cibleStable: false,
        mesures: fusion(mesuresCommunes, {
          evacuationsEnregistrees: evac,
          capacitesFournies: !!capacites
        }),
        blocages: (evac > 0 && capacites) ? [
          "Données d'évacuation fournies hors base : elles ne sont ni auditées ni versionnées."
        ] : [
          "Aucune table d'évacuation au périmètre AFLP : les sorties de stock ne sont pas enregistrées.",
          "Aucune clé de jointure entre `achats` et `rcn_receptions` : la chaîne village → lot → usine est rompue.",
          "Aucune capacité de point de stockage au schéma.",
          "Aucun temps de trajet, ni disponibilité, ni capacité utile de véhicule au schéma."
        ],
        risqueFuite: "Sans objet tant qu'aucun modèle ne peut être construit."
      };
    })();

    /* ---- Cas 6 : écarts de qualité -------------------------------------- */
    (function () {
      var humManquant = tauxManquant(d.achats, function (a) { return a.humidite; });
      var korManquant = tauxManquant(d.achats, function (a) { return a.kor; });
      var mesuresQualite = d.achats.filter(function (a) {
        return a.humidite != null || a.kor != null;
      }).length;
      var okBase = mesuresQualite > 0;
      var okR1 = mesuresQualite >= S.r1MinObservations &&
                 Math.min(humManquant, korManquant) <= S.maxTauxManquant;
      var okR2 = false; /* exigerait la comparaison village ↔ usine, impossible */
      cas.qualite = {
        cle: "qualite",
        libelle: "Écarts de qualité",
        niveau: niveauReadiness(okBase, okR1, okR2, false),
        cible: "écart entre qualité mesurée au village et norme observée",
        cibleStable: false,
        mesures: fusion(mesuresCommunes, {
          mesuresQualite: mesuresQualite,
          humiditeManquante: humManquant,
          korManquant: korManquant
        }),
        blocages: [].concat(
          okBase ? [] : ["Aucune mesure d'humidité ni de KOR renseignée."],
          humManquant <= S.maxTauxManquant ? [] : ["Humidité manquante sur " + fmtPct(humManquant * 100) + " des achats."],
          korManquant <= S.maxTauxManquant ? [] : ["KOR manquant sur " + fmtPct(korManquant * 100) + " des achats."],
          ["Aucune jointure `achats` ↔ `rcn_qualites` : l'écart village ↔ usine, " +
           "le seul économiquement significatif, n'est pas calculable.",
           "Aucune qualité CIBLE arrêtée avec Quality/Factory au schéma : la norme est " +
           "déduite de la population observée, elle n'est pas contractuelle."]
        ),
        risqueFuite: "Modéré — comparer un achat à une norme qui l'inclut lui-même " +
          "est une fuite. La norme est donc calculée en excluant l'entité testée (leave-one-out)."
      };
    })();

    var porteNiveau1 = evaluerPorteNiveau1(d);

    return {
      version: VERSION,
      versionDataset: d.versionDataset,
      dateRef: d.dateRef,
      seuils: JSON.parse(JSON.stringify(S)),
      cas: cas,
      ordre: ["volumes", "fonds", "scorecardRt", "signaux", "evacuations", "qualite"],
      porteNiveau1: porteNiveau1,
      /* Une seule phrase de verdict, pour qu'aucune lecture rapide ne puisse
         conclure l'inverse de ce que disent les mesures. */
      verdict: porteNiveau1.p0Ouverts.length
        ? "Porte du Niveau 1 NON FRANCHIE : " + porteNiveau1.p0Ouverts.length +
          " prérequis P0 ouvert(s). Aucun modèle ne peut passer en aide à la décision."
        : "Porte du Niveau 1 franchie."
    };
  }

  /* ==========================================================================
     8. Porte obligatoire du Niveau 1 — vérifiée sur les données, pas déclarée
     --------------------------------------------------------------------------
     Chaque point est un CONSTAT. Un point que les données ne permettent pas de
     trancher est déclaré « INDÉTERMINÉ », jamais « conforme par défaut ».
     ====================================================================== */

  function evaluerPorteNiveau1(d) {
    var points = [];

    function pt(code, libelle, statut, constat, criticite) {
      points.push({ code: code, libelle: libelle, statut: statut, constat: constat,
        criticite: criticite || "P1" });
    }

    pt("N1-01", "Contraintes d'unicité", "CONFORME",
      "`achats.local_id`, `avances.local_id`, `reconciliations.local_id` et " +
      "`sacs_mouvements.local_id` sont UNIQUE : la synchronisation hors ligne " +
      "est idempotente par construction.", "P0");

    var idsInvalides = d.achats.filter(function (a) { return !a.rt || !a.village; }).length;
    pt("N1-02", "Identifiants stables", "NON CONFORME",
      "`rt_id`, `producteur_id` et `village_nom` sont des colonnes `text` SANS clé " +
      "étrangère. Un renommage casse silencieusement le rattachement historique. " +
      "Sur le jeu courant : " + idsInvalides + " achat(s) sans RT ou sans village exploitable.",
      "P0");

    pt("N1-03", "Journal d'audit", "PARTIEL",
      "`rcn_audit` est append-only mais couvre le seul module RCN TRACE. " +
      "`audit_log` n'est protégé par RLS que « si la table existe » " +
      "(supabase/rls.sql, bloc conditionnel) : son existence n'est pas garantie. " +
      "Aucun journal ne couvre `achats`, `avances`, `reconciliations`.", "P0");

    pt("N1-04", "Transactions clôturées et immuables", "NON CONFORME",
      "La politique `achats_upd` autorise le Branch Manager à modifier " +
      "N'IMPORTE QUEL achat, y compris `statut_validation = 'Validé'`. " +
      "Aucune clôture, aucun verrou, aucune version antérieure conservée. " +
      "Une cible d'apprentissage peut donc changer après coup, sans trace.", "P0");

    var reconStatuts = {};
    d.recons.forEach(function (r) {
      var s = r.statut || "(vide)";
      reconStatuts[s] = (reconStatuts[s] || 0) + 1;
    });
    pt("N1-05", "Réconciliations fiables",
      d.recons.length ? "PARTIEL" : "INDÉTERMINÉ",
      d.recons.length
        ? d.recons.length + " réconciliation(s) au jeu courant, statuts : " +
          Object.keys(reconStatuts).map(function (k) { return k + "=" + reconStatuts[k]; }).join(", ") +
          ". `ecart` n'est pas contraint : rien n'impose au niveau base que " +
          "ecart = total_avance − total_paye − cash_restant − valeur_stock."
        : "Aucune réconciliation dans le jeu courant : la fiabilité ne peut pas être constatée.",
      "P0");

    pt("N1-06", "Données de stock cohérentes", "NON CONFORME",
      "`achats.stock_statut` vaut 'Entrée RT' par défaut et aucun mouvement de " +
      "sortie ne lui est associé au périmètre AFLP. Le stock au niveau cluster " +
      "n'est donc pas observable — seulement le cumul des entrées.", "P0");

    pt("N1-07", "Synchronisation hors ligne maîtrisée",
      d.fileLocale.echecs > 0 ? "NON CONFORME" : "PARTIEL",
      "Idempotence assurée par `local_id`. File locale au moment du calcul : " +
      d.fileLocale.enAttente + " en attente, " + d.fileLocale.echecs + " échec(s). " +
      "Toute donnée non remontée est invisible du modèle.", "P1");

    pt("N1-08", "Dates serveur fiables", "NON CONFORME",
      "`achats.date` est une `date` fournie par le client ; seule `created_at` " +
      "porte `now()`. Un appareil mal réglé, ou une saisie antidatée, décale la " +
      "série temporelle sans qu'aucun contrôle ne s'en aperçoive. C'est le " +
      "prérequis le plus critique pour toute prévision.", "P0");

    pt("N1-09", "Traçabilité bout en bout", "NON CONFORME",
      "La chaîne s'arrête à l'achat. Aucune colonne de `achats` ne référence un " +
      "lot, une évacuation ou une réception usine ; `rcn_receptions.fournisseur` " +
      "est un `text` libre. Les cas d'usage 5 et 6 en dépendent directement.", "P0");

    pt("N1-10", "Règles d'accès", "CONFORME",
      "RLS active sur `achats`, `avances`, `reconciliations`, `sacs_mouvements`, " +
      "avec les fonctions `est_actif()` / `est_bm()` / `peut_editer_config()`.", "P0");

    pt("N1-11", "Dictionnaire des données", "PARTIEL",
      "`docs/DATA_MODEL.md` existe mais ne couvre pas les cibles prédictives ; " +
      "le Niveau 3 en fournit un complément dédié.", "P1");

    pt("N1-12", "Qualité mesurable des données", "CONFORME",
      "Mesurée par `diagnostic()` : taux de manquants, identifiants valides, " +
      "valeurs aberrantes, ruptures de série, retard de synchronisation.", "P1");

    pt("N1-13", "Campagne identifiée", "NON CONFORME",
      "Aucune colonne `campagne` sur `achats`, `avances` ou `reconciliations`. " +
      "Impossible de séparer deux campagnes, donc impossible d'estimer une " +
      "saisonnalité ou de rejouer un historique par campagne.", "P0");

    var p0Ouverts = points.filter(function (p) {
      return p.criticite === "P0" && p.statut !== "CONFORME";
    });

    return {
      points: points,
      p0Ouverts: p0Ouverts,
      p1Ouverts: points.filter(function (p) { return p.criticite === "P1" && p.statut !== "CONFORME"; }),
      franchie: p0Ouverts.length === 0,
      consequence: p0Ouverts.length
        ? "Tant qu'un P0 reste ouvert : aucun modèle en production, statut maximal " +
          "SHADOW_ONLY, et tout chiffre affiché porte la mention « aide à la décision »."
        : "Les modèles peuvent être proposés à la gouvernance pour passage en DECISION_SUPPORT."
    };
  }

  /* ==========================================================================
     9. Baselines et validation temporelle
     --------------------------------------------------------------------------
     Une baseline n'est pas un modèle « pauvre » : c'est le seuil au-dessus
     duquel un modèle a le droit d'exister. Aucune méthode n'est retenue ici
     sans avoir battu la meilleure baseline sur la MÊME validation temporelle.
     ====================================================================== */

  var BASELINES = [
    {
      cle: "naif",
      nom: "Naïf — dernière fenêtre",
      description: "Le total des h derniers jours est reconduit sur les h prochains.",
      predire: function (serie, h) {
        if (serie.length < h) return null;
        return somme(serie.slice(-h).map(function (p) { return p.valeur; }));
      }
    },
    {
      cle: "moyenne7",
      nom: "Moyenne mobile 7 jours",
      description: "Moyenne journalière des 7 derniers jours (zéros compris), × h.",
      predire: function (serie, h) {
        if (serie.length < 7) return null;
        var m = moyenne(serie.slice(-7).map(function (p) { return p.valeur; }));
        return m == null ? null : m * h;
      }
    },
    {
      cle: "mediane7",
      nom: "Médiane mobile 7 jours",
      description: "Médiane journalière des 7 derniers jours, × h. Robuste aux jours de marché exceptionnels.",
      predire: function (serie, h) {
        if (serie.length < 7) return null;
        var m = mediane(serie.slice(-7).map(function (p) { return p.valeur; }));
        return m == null ? null : m * h;
      }
    },
    {
      cle: "moyenne28",
      nom: "Moyenne mobile 28 jours",
      description: "Moyenne journalière des 28 derniers jours, × h. Amortit le rythme hebdomadaire des marchés.",
      predire: function (serie, h) {
        if (serie.length < 28) return null;
        var m = moyenne(serie.slice(-28).map(function (p) { return p.valeur; }));
        return m == null ? null : m * h;
      }
    }
  ];

  /* Validation à origine glissante (rolling origin). Pour chaque origine o :
       apprentissage = série jusqu'à l'indice o exclu
       cible         = somme des valeurs sur [o, o+h[
     Aucune valeur d'indice ≥ o n'entre dans la prédiction. Les origines sont
     espacées de h pour que les cibles ne se chevauchent pas — des cibles
     chevauchantes gonfleraient artificiellement le nombre de plis. */
  function backtest(serie, h, methode, maxPlis) {
    var n = serie.length;
    var plis = [];
    var minApprentissage = Math.max(SEUILS.fenetreCourte, h);
    var limite = maxPlis || 12;
    var o = n - h;
    while (o >= minApprentissage && plis.length < limite) {
      var apprentissage = serie.slice(0, o);
      var prevu = methode.predire(apprentissage, h);
      if (prevu != null) {
        var reel = somme(serie.slice(o, o + h).map(function (p) { return p.valeur; }));
        plis.push({ origine: serie[o - 1].jour, prevu: prevu, reel: reel, erreur: prevu - reel });
      }
      o -= h;
    }
    plis.reverse();
    if (!plis.length) return null;

    var erreurs = plis.map(function (p) { return p.erreur; });
    var reels = plis.map(function (p) { return p.reel; });
    var sommeReels = somme(reels);
    var mae = moyenne(erreurs.map(Math.abs));
    var rmse = Math.sqrt(moyenne(erreurs.map(function (e) { return e * e; })));
    /* WAPE plutôt que MAPE : la demande est intermittente, un jour à zéro fait
       exploser un MAPE. Le WAPE reste défini tant que le total n'est pas nul. */
    var wape = sommeReels > 0 ? somme(erreurs.map(Math.abs)) / sommeReels : null;
    return {
      methode: methode.cle, nom: methode.nom, description: methode.description,
      horizon: h, plis: plis.length, detail: plis,
      mae: mae, rmse: rmse, wape: wape, biais: moyenne(erreurs),
      /* Résidus relatifs : servent à fabriquer un intervalle qui s'adapte au
         niveau de la prévision, plutôt qu'un intervalle en valeur absolue. */
      residusRelatifs: plis.filter(function (p) { return p.reel > 0; })
        .map(function (p) { return p.prevu / p.reel; })
    };
  }

  var ORDRE_SIMPLICITE = ["naif", "moyenne7", "mediane7", "moyenne28"];

  /* Choix du champion : plus petit WAPE. À écart inférieur à 5 % relatif, la
     méthode la plus simple l'emporte — une amélioration minime ne justifie pas
     une méthode moins lisible. */
  function choisirChampion(resultats) {
    var valides = resultats.filter(function (r) { return r && r.wape != null; });
    if (!valides.length) return null;
    var tries = valides.slice().sort(function (a, b) { return a.wape - b.wape; });
    var meilleur = tries[0];
    var proches = tries.filter(function (r) {
      return meilleur.wape > 0
        ? (r.wape - meilleur.wape) / meilleur.wape <= 0.05
        : r.wape === meilleur.wape;
    });
    proches.sort(function (a, b) {
      return ORDRE_SIMPLICITE.indexOf(a.methode) - ORDRE_SIMPLICITE.indexOf(b.methode);
    });
    return proches[0];
  }

  /* Intervalle de prévision empirique à 80 %, construit sur les quantiles des
     résidus relatifs du backtest. Si le nombre de résidus est insuffisant,
     l'intervalle vaut null — nous préférons ne rien afficher qu'afficher une
     fourchette qui inspirerait une confiance qu'elle ne mérite pas. */
  function intervalle(point, residusRelatifs) {
    if (point == null) return { bas: null, haut: null, niveau: null, base: 0 };
    var r = (residusRelatifs || []).filter(function (x) { return isFinite(x) && x > 0; });
    if (r.length < SEUILS.minResidusIntervalle) {
      return { bas: null, haut: null, niveau: null, base: r.length,
        motif: "Moins de " + SEUILS.minResidusIntervalle + " résidus exploitables." };
    }
    var q10 = quantile(r, 0.10), q90 = quantile(r, 0.90);
    /* prevu = ratio × reel  ⇒  reel = prevu / ratio. La borne BASSE du réel
       correspond donc au ratio HAUT, et réciproquement. */
    return {
      bas: Math.max(0, point / q90),
      haut: point / q10,
      niveau: 0.80,
      base: r.length
    };
  }

  /* Couverture de l'intervalle — mesurée, pas supposée.
     --------------------------------------------------------------------------
     Annoncer un intervalle à 80 % sans jamais vérifier qu'il contient 80 % des
     réalisations, c'est publier une affirmation invérifiée. La mesure se fait
     en LAISSANT DE CÔTÉ le pli évalué : pour chaque pli i, l'intervalle est
     reconstruit à partir des résidus des AUTRES plis, puis on regarde si le réel
     de i tombe dedans. Sans cette exclusion, le pli servirait à fabriquer
     l'intervalle censé le juger, et la couverture serait flattée.

     Une couverture nettement inférieure au niveau annoncé signifie que
     l'intervalle est trop étroit — donc rassurant à tort. */
  function couvertureIntervalle(bt) {
    if (!bt || !bt.detail || bt.detail.length < SEUILS.minResidusIntervalle) {
      return { mesurable: false, valeur: null, base: bt && bt.detail ? bt.detail.length : 0,
        motif: "Moins de " + SEUILS.minResidusIntervalle + " plis : la couverture n'est pas estimable." };
    }
    var plis = bt.detail.filter(function (p) { return p.reel > 0; });
    if (plis.length < SEUILS.minResidusIntervalle) {
      return { mesurable: false, valeur: null, base: plis.length,
        motif: "Trop de plis à réel nul pour estimer une couverture." };
    }
    var dedans = 0, i, j, autres, iv;
    for (i = 0; i < plis.length; i++) {
      autres = [];
      for (j = 0; j < plis.length; j++) {
        if (j !== i) autres.push(plis[j].prevu / plis[j].reel);
      }
      /* On contourne `intervalle()` : elle refuserait sous le seuil, alors
         qu'ici on retire volontairement un point d'un ensemble déjà au seuil. */
      var q10 = quantile(autres, 0.10), q90 = quantile(autres, 0.90);
      if (q10 == null || q90 == null || q10 <= 0) continue;
      iv = { bas: Math.max(0, plis[i].prevu / q90), haut: plis[i].prevu / q10 };
      if (plis[i].reel >= iv.bas && plis[i].reel <= iv.haut) dedans++;
    }
    var observee = dedans / plis.length;
    var niveau = 0.80;
    /* Incertitude de la mesure elle-même : erreur type binomiale sur n plis.
       Avec 12 plis, elle vaut déjà ±11 points — assez pour qu'un écart de 13
       points ne prouve rien. Rendre un verdict tranché sur une base pareille
       serait exactement le travers que ce module doit éviter. */
    var erreurType = Math.sqrt(niveau * (1 - niveau) / plis.length);
    var ecart = observee - niveau;
    var significatif = Math.abs(ecart) > 2 * erreurType;
    return {
      mesurable: true,
      valeur: observee,
      base: plis.length,
      niveauAnnonce: niveau,
      erreurType: erreurType,
      ecartSignificatif: significatif,
      motif: significatif
        ? (ecart < 0
            ? "Couverture significativement INFÉRIEURE au niveau annoncé : l'intervalle est " +
              "trop étroit, donc rassurant à tort. À élargir avant tout usage décisionnel."
            : "Couverture significativement supérieure au niveau annoncé : l'intervalle est " +
              "trop large, donc peu informatif.")
        : "Écart au niveau annoncé non significatif sur " + plis.length + " pli(s) " +
          "(erreur type ±" + Math.round(erreurType * 1000) / 10 + " points). " +
          "Cette mesure ne CONFIRME pas la couverture, elle constate seulement qu'on " +
          "ne peut pas la réfuter avec si peu de plis."
    };
  }

  var RANG_INFERIEUR = { bonne: "moyenne", moyenne: "faible", faible: "faible", nulle: "nulle" };

  function confiance(bt, retardJours) {
    if (!bt || bt.wape == null) return { niveau: "nulle", motif: "Aucune validation temporelle possible." };
    var n;
    if (bt.plis < SEUILS.r2MinPlis) n = "faible";
    else if (bt.wape > SEUILS.wapeAvertissement) n = "faible";
    else if (bt.wape > 0.20) n = "moyenne";
    else n = "bonne";
    var motif = bt.plis + " pli(s), WAPE " + fmtPct(bt.wape * 100);
    if (retardJours != null && retardJours > SEUILS.retardDonneesJours) {
      n = RANG_INFERIEUR[n];
      motif += " · données en retard de " + retardJours + " jour(s) : confiance dégradée d'un cran";
    }
    return { niveau: n, motif: motif };
  }

  /* ==========================================================================
     10. Cas d'usage 1 — Prévision des volumes
     ====================================================================== */

  function prevoirEntite(entite, h, retardJours) {
    var serie = entite.serie || [];
    var resultats = BASELINES.map(function (b) { return backtest(serie, h, b); });
    var champion = choisirChampion(resultats);
    if (!champion) {
      return {
        statut: "NOT_READY",
        motif: "Historique insuffisant pour valider la moindre baseline sur un horizon de " + h + " jour(s).",
        horizon: h, valeur: null, bas: null, haut: null, comparaison: [],
        confiance: "nulle"
      };
    }
    var methode = BASELINES.filter(function (b) { return b.cle === champion.methode; })[0];
    var point = methode.predire(serie, h);
    var iv = intervalle(point, champion.residusRelatifs);
    var conf = confiance(champion, retardJours);
    var dernier = entite.dernierJourSerie;
    return {
      statut: "SHADOW_ONLY",
      horizon: h,
      periodePrevue: { debut: decalerJour(dernier, 1), fin: decalerJour(dernier, h) },
      valeur: point,
      bas: iv.bas, haut: iv.haut, niveauIntervalle: iv.niveau, baseIntervalle: iv.base,
      motifIntervalle: iv.motif || null,
      methode: champion.methode, methodeNom: champion.nom, methodeDescription: champion.description,
      metriques: { mae: champion.mae, rmse: champion.rmse, wape: champion.wape,
        biais: champion.biais, plis: champion.plis,
        couvertureIntervalle: couvertureIntervalle(champion) },
      confiance: conf.niveau, motifConfiance: conf.motif,
      /* Toutes les baselines, pas seulement la gagnante : sans la comparaison,
         « meilleur que la baseline » n'est qu'une affirmation. */
      comparaison: resultats.filter(Boolean).map(function (r) {
        return { methode: r.methode, nom: r.nom, wape: r.wape, mae: r.mae,
          biais: r.biais, plis: r.plis, retenue: r.methode === champion.methode };
      }),
      incertain: champion.wape != null && champion.wape > SEUILS.wapeAvertissement
    };
  }

  function prevoirVolumes(dataset, diag) {
    var m = MODELES.volumes;
    var readiness = diag.cas.volumes;
    var statut = statutModele("volumes", readiness);
    var base = {
      casUsage: "volumes",
      libelle: m.nom,
      statut: statut,
      niveauReadiness: readiness.niveau,
      version: VERSION, versionVariables: VERSION_VARIABLES,
      versionDataset: dataset.versionDataset,
      dateCalcul: dataset.dateRef,
      dateReferenceDonnees: dataset.dateReferenceDonnees,
      avertissement: "Aide à la décision. Aucune de ces valeurs n'autorise un achat, " +
        "un financement ou un engagement.",
      horizons: HORIZONS,
      global: [], parCluster: [], parVillage: [],
      villagesTropIncertains: [], nouveauxVillages: [],
      coherenceAgregation: null
    };
    if (statut === "NOT_READY" || statut === "DESACTIVE") {
      base.motif = (statut === "DESACTIVE")
        ? "Modèle désactivé : " + (m.motifDesactivation || "non précisé")
        : "Maturité " + readiness.niveau + " : aucune prévision produite.";
      base.blocages = readiness.blocages;
      return base;
    }

    var retard = dataset.retardDonneesJours;

    var entGlobal = { serie: dataset.serieGlobale, dernierJourSerie: dataset.dateRef };
    HORIZONS.forEach(function (h) {
      var p = prevoirEntite(entGlobal, h, retard);
      p.entite = "PROGRAMME"; p.entiteNom = "Ensemble du pilote"; p.niveau = "programme";
      base.global.push(p);
    });

    function pourIndex(index, niveau, cible) {
      Object.keys(index).sort().forEach(function (k) {
        var e = index[k];
        HORIZONS.forEach(function (h) {
          var p = prevoirEntite(e, h, retard);
          p.entite = k; p.entiteNom = e.nom; p.niveau = niveau;
          p.cluster = e.cluster || "";
          p.observations = e.nbAchats; p.joursHistorique = e.joursHistorique;
          cible.push(p);
          if (h !== 7) return;
          if (p.statut !== "NOT_READY" && p.incertain) {
            base.villagesTropIncertains.push({
              entite: k, nom: e.nom, niveau: niveau, wape: p.metriques.wape,
              motif: "WAPE de " + fmtPct(p.metriques.wape * 100) + " au-delà du seuil d'avertissement (" +
                fmtPct(SEUILS.wapeAvertissement * 100) + ")."
            });
          }
          if (p.statut === "NOT_READY") {
            base.nouveauxVillages.push({
              entite: k, nom: e.nom, niveau: niveau,
              joursHistorique: e.joursHistorique, observations: e.nbAchats,
              repli: "Aucune prévision individuelle. Repli documenté : se rabattre sur " +
                "la prévision du cluster, en le disant explicitement à l'utilisateur."
            });
          }
        });
      });
    }
    pourIndex(dataset.parCluster, "cluster", base.parCluster);
    pourIndex(dataset.parVillage, "village", base.parVillage);

    /* Cohérence d'agrégation : village → cluster → programme. Sur des baselines
       calculées indépendamment, la somme des parties ne fait JAMAIS le tout.
       Nous mesurons l'écart au lieu de le masquer par une réconciliation
       automatique qui donnerait une fausse impression de rigueur. */
    var h7Global = base.global.filter(function (p) { return p.horizon === 7; })[0];
    var sommeClusters = somme(base.parCluster
      .filter(function (p) { return p.horizon === 7 && p.valeur != null; })
      .map(function (p) { return p.valeur; }));
    var sommeVillages = somme(base.parVillage
      .filter(function (p) { return p.horizon === 7 && p.valeur != null; })
      .map(function (p) { return p.valeur; }));
    base.coherenceAgregation = {
      horizon: 7,
      programme: (h7Global && h7Global.valeur != null) ? h7Global.valeur : null,
      sommeClusters: sommeClusters,
      sommeVillages: sommeVillages,
      ecartClustersPct: (h7Global && h7Global.valeur)
        ? ((sommeClusters - h7Global.valeur) / h7Global.valeur) * 100 : null,
      commentaire: "Les trois niveaux sont prévus séparément. L'écart mesuré est " +
        "affiché tel quel, il n'est pas corrigé. Une réconciliation hiérarchique " +
        "(top-down ou MinT) est une évolution possible : elle exige d'abord R2."
    };

    return base;
  }

  /* ==========================================================================
     11. Cas d'usage 2 — Besoin de fonds
     --------------------------------------------------------------------------
     Le mot « besoin » est important : ce n'est ni une autorisation, ni un
     plafond, ni une demande. C'est une estimation soumise à Finance.
     ====================================================================== */

  function besoinFonds(dataset, diag, previsions) {
    var m = MODELES.fonds;
    var readiness = diag.cas.fonds;
    var statut = statutModele("fonds", readiness);
    var out = {
      casUsage: "fonds",
      libelle: m.nom,
      statut: statut,
      niveauReadiness: readiness.niveau,
      version: VERSION, versionDataset: dataset.versionDataset,
      dateCalcul: dataset.dateRef,
      avertissement: "Estimation d'un BESOIN, soumise à Finance. Aucune avance n'est " +
        "créée, aucun plafond n'est modifié, aucun transfert n'est déclenché.",
      gardes: ["G01", "G02", "G03"],
      scenarios: null, facteurs: [], reserves: []
    };
    if (statut === "NOT_READY" || statut === "DESACTIVE") {
      out.blocages = readiness.blocages;
      return out;
    }

    /* Prix moyen pondéré observé — le seul prix que les données connaissent.
       Nous n'inventons ni prix ANAGROCI ni prix marché : ils ne sont pas au schéma. */
    var poidsTotal = somme(dataset.achats.map(function (a) { return a.poids; }));
    var montantTotal = somme(dataset.achats.map(function (a) { return a.montant; }));
    var commissionTotale = somme(dataset.achats.map(function (a) { return a.commission; }));
    var prixMoyen = poidsTotal > 0 ? montantTotal / poidsTotal : null;
    var commissionMoyenne = poidsTotal > 0 ? commissionTotale / poidsTotal : 0;

    /* Exposition ouverte à la date de référence, et part non couverte par une
       réconciliation valide. La règle du Niveau 2 est reprise telle quelle :
       une réconciliation antérieure à la dernière avance ne couvre pas l'argent
       actuellement en circulation. */
    var parRt = {};
    function ligne(k, nom) {
      if (!parRt[k]) parRt[k] = { rt: k, nom: nom || k, avances: 0, paye: 0, derniereAvance: "", recon: null };
      return parRt[k];
    }
    dataset.avances.forEach(function (a) {
      if (!a.rt) return;
      var e = ligne(a.rt, a.rtNom);
      e.avances += a.montant;
      if (a.jour > e.derniereAvance) e.derniereAvance = a.jour;
    });
    dataset.achats.forEach(function (a) {
      if (!a.rt) return;
      ligne(a.rt, a.rtNom).paye += a.montant;
    });
    dataset.recons.forEach(function (r) {
      if (!r.rt) return;
      var e = ligne(r.rt, r.rtNom);
      if (!e.recon || r.jour > e.recon.jour) e.recon = r;
    });

    var expositionOuverte = 0, montantNonFinancable = 0, rtBloques = 0, rtCouverts = 0;
    Object.keys(parRt).forEach(function (k) {
      var e = parRt[k];
      var solde = e.avances - e.paye;
      if (solde > 0) expositionOuverte += solde;
      var couvert = !!e.recon && e.recon.statut === "Réconcilié" &&
        (!e.derniereAvance || e.recon.jour >= e.derniereAvance) &&
        Math.abs(e.recon.ecart) <= 0;
      if (couvert) rtCouverts++;
      else { rtBloques++; if (solde > 0) montantNonFinancable += solde; }
    });

    /* Durée de cycle observée : délai médian entre une avance et la première
       réconciliation postérieure du même RT. Médiane, pas moyenne : un cycle
       oublié à 40 jours ne doit pas déplacer la référence. */
    var delais = [];
    dataset.avances.forEach(function (a) {
      var suivantes = dataset.recons.filter(function (r) { return r.rt === a.rt && r.jour >= a.jour; });
      if (!suivantes.length) return;
      suivantes.sort(function (x, y) { return x.jour < y.jour ? -1 : (x.jour > y.jour ? 1 : 0); });
      var dd = ecartJours(a.jour, suivantes[0].jour);
      if (dd != null) delais.push(dd);
    });
    var dureeCycle = delais.length ? mediane(delais) : null;

    var horizonFonds = 7;
    var prevGlobale = (previsions.global || []).filter(function (p) { return p.horizon === horizonFonds; })[0];
    if (!prevGlobale || prevGlobale.valeur == null) {
      out.statut = "NOT_READY";
      out.blocages = ["Aucune prévision de volume exploitable à l'horizon " + horizonFonds + " jours."];
      return out;
    }

    function chiffrer(volumeKg) {
      if (volumeKg == null) return null;
      return {
        volumeKg: volumeKg,
        achat: prixMoyen != null ? volumeKg * prixMoyen : null,
        commission: volumeKg * commissionMoyenne,
        total: prixMoyen != null ? volumeKg * (prixMoyen + commissionMoyenne) : null
      };
    }

    var central = chiffrer(prevGlobale.valeur);
    var bas = chiffrer(prevGlobale.bas);
    var haut = chiffrer(prevGlobale.haut);
    var marge = SEUILS.margeSecurite;

    out.horizonJours = horizonFonds;
    out.periodePrevue = prevGlobale.periodePrevue;
    out.prixMoyenObserve = prixMoyen;
    out.commissionMoyenneObservee = commissionMoyenne;
    out.dureeCycleJours = dureeCycle;
    out.margeSecurite = marge;
    out.scenarios = {
      bas: bas, central: central, haut: haut,
      centralAvecMarge: (central && central.total != null)
        ? { total: central.total * (1 + marge) } : null
    };
    out.expositionOuverte = expositionOuverte;
    out.montantNonFinancable = montantNonFinancable;
    out.rtBloques = rtBloques;
    out.rtCouverts = rtCouverts;
    /* Besoin SUPPLÉMENTAIRE : ce qu'il faudrait mobiliser EN PLUS, une fois
       déduit l'argent déjà en circulation chez les équipes. L'exposition
       ouverte (avances − achats, quand elle est positive) est du cash que les
       RT détiennent encore et qui financera les prochains achats.
       Ne pas la déduire reviendrait à demander deux fois les mêmes fonds. */
    var besoinAvecMarge = (central && central.total != null) ? central.total * (1 + marge) : null;
    out.besoinSupplementaireTheorique = besoinAvecMarge == null ? null
      : Math.max(0, besoinAvecMarge - expositionOuverte);
    out.detailBesoinSupplementaire = besoinAvecMarge == null ? null : {
      besoinAvecMarge: besoinAvecMarge,
      cashDejaEnCirculation: expositionOuverte,
      commentaire: expositionOuverte >= besoinAvecMarge
        ? "Le cash déjà en circulation couvre le besoin estimé : aucun apport " +
          "supplémentaire n'est théoriquement nécessaire sur cet horizon. Cela ne " +
          "dit RIEN de sa disponibilité réelle chez chaque équipe."
        : "Écart entre le besoin estimé et le cash déjà en circulation. Ce montant " +
          "n'est ni une demande, ni une autorisation : Finance arbitre.",
      reserve: "L'exposition ouverte est déduite au niveau AGRÉGÉ. Du cash bloqué " +
        "chez une équipe non réconciliée ne finance pas les achats d'une autre : " +
        "voir le montant non finançable ci-dessous."
    };
    out.dateProbableBesoin = dureeCycle != null
      ? decalerJour(dataset.dateRef, Math.max(1, Math.round(dureeCycle)))
      : decalerJour(dataset.dateRef, 1);
    out.confiance = prevGlobale.confiance;
    out.motifConfiance = prevGlobale.motifConfiance;
    out.enveloppeVsPic = {
      commentaire: "Deux notions distinctes, souvent confondues : l'ENVELOPPE de campagne " +
        "est le cumul décaissé ; le PIC D'EXPOSITION OUVERTE est le montant maximal " +
        "simultanément en circulation. Seul le second dimensionne la trésorerie.",
      expositionOuverteCourante: expositionOuverte,
      picHistorique: null,
      motifPic: "Le pic historique exigerait la série quotidienne des soldes RT. " +
        "Les réconciliations actuelles ne la datent pas assez finement."
    };
    out.facteurs = [
      { facteur: "Volume prévu à 7 jours", valeur: fmtMT(prevGlobale.valeur) + " MT",
        poids: "déterminant", source: "cas d'usage 1, méthode " + prevGlobale.methode },
      { facteur: "Prix moyen observé", valeur: prixMoyen != null ? fmtNombre(prixMoyen) + " F/kg" : "—",
        poids: "déterminant", source: "achats.montant / achats.poids_net" },
      { facteur: "Commission RT moyenne", valeur: fmtNombre(commissionMoyenne) + " F/kg",
        poids: "secondaire", source: "achats.commission_rt" },
      { facteur: "Exposition ouverte", valeur: fmtF(expositionOuverte),
        poids: "déterminant", source: "avances − achats, arrêté à la date de référence" },
      { facteur: "Montant bloqué par non-réconciliation", valeur: fmtF(montantNonFinancable),
        poids: "bloquant", source: "règle AFLP du Niveau 2, reprise à l'identique" }
    ];
    out.reserves = [
      "Les frais de paiement (Wave) ne sont pas au schéma : ils ne sont PAS inclus.",
      "Le rythme de refinancement et la liquidité disponible ne sont pas au schéma.",
      "Les cycles non réconciliés restent bloquants : " + fmtF(montantNonFinancable) +
        " ne peut pas être refinancé, quelle que soit l'estimation ci-dessus.",
      "Les plafonds validés priment sur cette estimation en toute circonstance."
    ];
    return out;
  }

  /* ==========================================================================
     12. Cas d'usage 3 — Scorecard RT
     --------------------------------------------------------------------------
     Multidimensionnelle par construction. Aucun score composite par défaut :
     un chiffre unique masquerait précisément ce que le métier doit distinguer —
     mauvaise performance, mauvaise qualité de données, comportement inhabituel.
     ====================================================================== */

  var DIMENSIONS_RT = [
    { cle: "volume", nom: "Performance de volume" },
    { cle: "discipline", nom: "Discipline de réconciliation" },
    { cle: "qualiteDonnees", nom: "Qualité des données saisies" },
    { cle: "delais", nom: "Respect des délais" },
    { cle: "coherence", nom: "Cohérence cash — stock — sacs" },
    { cle: "qualiteProduit", nom: "Qualité du produit" },
    { cle: "stabilite", nom: "Stabilité opérationnelle" },
    { cle: "incidents", nom: "Incidents validés" }
  ];

  function scorecardRt(dataset, diag) {
    var m = MODELES.scorecardRt;
    var readiness = diag.cas.scorecardRt;
    var statut = statutModele("scorecardRt", readiness);
    var out = {
      casUsage: "scorecardRt", libelle: m.nom, statut: statut,
      niveauReadiness: readiness.niveau,
      version: VERSION, versionDataset: dataset.versionDataset,
      dateCalcul: dataset.dateRef,
      avertissement: "Lecture de performance et de qualité de données. Ce n'est ni une " +
        "note de personne, ni une sanction, ni une accusation. Aucune donnée protégée " +
        "n'entre dans le calcul.",
      gardes: ["G09", "G10"],
      compositeParDefaut: false,
      dimensions: DIMENSIONS_RT,
      equipes: [], biais: null
    };
    if (statut === "NOT_READY" || statut === "DESACTIVE") {
      out.blocages = readiness.blocages;
      return out;
    }

    var tousVolumes = Object.keys(dataset.parRt).map(function (k) { return dataset.parRt[k].total; });
    var medianeVolume = mediane(tousVolumes);

    var avanceRt = {}, payeRt = {}, reconRt = {}, sacRt = {};
    dataset.avances.forEach(function (a) { if (a.rt) avanceRt[a.rt] = (avanceRt[a.rt] || 0) + a.montant; });
    dataset.achats.forEach(function (a) { if (a.rt) payeRt[a.rt] = (payeRt[a.rt] || 0) + a.montant; });
    dataset.recons.forEach(function (r) {
      if (!r.rt) return;
      if (!reconRt[r.rt] || r.jour > reconRt[r.rt].jour) reconRt[r.rt] = r;
    });
    dataset.sacs.forEach(function (s) {
      if (!s.rt) return;
      if (s.destination === "RT") sacRt[s.rt] = (sacRt[s.rt] || 0) + s.quantite;
      if (s.source === "RT") sacRt[s.rt] = (sacRt[s.rt] || 0) - s.quantite;
    });

    function note(score, motif, donnees, periode, comparaison, conf, facteurs) {
      return { score: score, motif: motif, donnees: donnees, periode: periode,
        comparaison: comparaison, confiance: conf, facteurs: facteurs || [] };
    }

    Object.keys(dataset.parRt).sort().forEach(function (k) {
      var e = dataset.parRt[k];
      var periode = e.premier + " → " + dataset.dateRef;
      /* Confiance statistique : sous le seuil d'observations, TOUTES les
         dimensions sont marquées comme peu fiables. Une équipe peu active ne
         doit pas être mal notée pour cause de faible échantillon. */
      var confStat = e.nbAchats >= SEUILS.r2MinObservations ? "bonne"
        : (e.nbAchats >= SEUILS.r1MinObservations ? "moyenne" : "faible");

      var dims = {};

      dims.volume = note(
        medianeVolume ? e.total / medianeVolume : null,
        medianeVolume ? "Volume rapporté à la médiane des équipes (1,00 = médiane)."
          : "Médiane non calculable.",
        "achats.poids_net", periode,
        "Médiane des " + Object.keys(dataset.parRt).length + " équipes : " + fmtMT(medianeVolume) + " MT",
        confStat,
        [{ facteur: "Volume cumulé", valeur: fmtMT(e.total) + " MT" },
         { facteur: "Jours d'activité", valeur: e.joursActifs + " / " + e.joursHistorique }]
      );

      var r = reconRt[k];
      var derniereAvance = "";
      dataset.avances.forEach(function (a) {
        if (a.rt === k && a.jour > derniereAvance) derniereAvance = a.jour;
      });
      var couvert = !!r && r.statut === "Réconcilié" && (!derniereAvance || r.jour >= derniereAvance);
      dims.discipline = note(
        couvert ? 1 : 0,
        couvert ? "Réconciliation valide et postérieure à la dernière avance."
          : (r ? "Dernière réconciliation du " + r.jour + " (statut « " + (r.statut || "—") + " »)" +
                 (derniereAvance ? ", avance du " + derniereAvance + "." : ".")
               : "Aucune réconciliation enregistrée."),
        "reconciliations, avances", periode,
        "Règle AFLP : pas de réconciliation = pas de refinancement",
        r ? confStat : "faible",
        [{ facteur: "Dernière réconciliation", valeur: r ? r.jour : "aucune" },
         { facteur: "Dernière avance", valeur: derniereAvance || "aucune" },
         { facteur: "Écart déclaré", valeur: r ? fmtF(r.ecart) : "—" }]
      );

      var tauxSansRecu = e.nbAchats ? e.sansRecu / e.nbAchats : null;
      dims.qualiteDonnees = note(
        tauxSansRecu == null ? null : 1 - tauxSansRecu,
        "Part d'achats portant un numéro de reçu.",
        "achats.numero_recu", periode,
        "Cible implicite : 100 % — un achat sans reçu n'est refinançable dans aucun cas",
        confStat,
        [{ facteur: "Achats sans reçu", valeur: e.sansRecu + " / " + e.nbAchats }]
      );

      var delaisRt = [];
      dataset.avances.forEach(function (a) {
        if (a.rt !== k) return;
        var suiv = dataset.recons.filter(function (x) { return x.rt === k && x.jour >= a.jour; })
          .sort(function (x, y) { return x.jour < y.jour ? -1 : (x.jour > y.jour ? 1 : 0); })[0];
        if (suiv) { var dd = ecartJours(a.jour, suiv.jour); if (dd != null) delaisRt.push(dd); }
      });
      dims.delais = note(
        delaisRt.length ? mediane(delaisRt) : null,
        delaisRt.length ? "Délai médian avance → réconciliation, en jours."
          : "Aucun couple avance → réconciliation observable.",
        "avances.date, reconciliations.date", periode,
        "Plus la valeur est basse, mieux c'est. Aucun délai AFLP contractuel n'est au schéma.",
        delaisRt.length >= 3 ? confStat : "faible",
        [{ facteur: "Cycles observés", valeur: String(delaisRt.length) }]
      );

      var solde = (avanceRt[k] || 0) - (payeRt[k] || 0);
      var sacsSolde = sacRt[k] || 0;
      dims.coherence = note(
        (solde >= 0 && sacsSolde >= 0) ? 1 : 0,
        (solde < 0 ? "Dépassement de caisse : payé supérieur à l'avancé de " + fmtF(-solde) + ". " : "") +
        (sacsSolde < 0 ? "Solde de sacs négatif (" + fmtNombre(sacsSolde) + "). " : "") +
        ((solde >= 0 && sacsSolde >= 0) ? "Aucune incohérence arithmétique détectée." : ""),
        "avances, achats, sacs_mouvements", periode,
        "Un solde négatif est une impossibilité comptable, pas une contre-performance",
        confStat,
        [{ facteur: "Solde de caisse", valeur: fmtF(solde) },
         { facteur: "Solde de sacs", valeur: fmtNombre(sacsSolde) }]
      );

      var humMed = e.humidites.length ? mediane(e.humidites) : null;
      var korMed = e.kors.length ? mediane(e.kors) : null;
      dims.qualiteProduit = note(
        (humMed != null || korMed != null) ? 1 : null,
        (humMed != null || korMed != null)
          ? "Humidité médiane " + (humMed != null ? fmtNombre(humMed) + " %" : "—") +
            ", KOR médian " + (korMed != null ? fmtNombre(korMed) : "—") + "."
          : "Aucune mesure de qualité saisie : dimension non évaluable.",
        "achats.humidite, achats.kor", periode,
        "Aucune qualité CIBLE au schéma : cette dimension DÉCRIT, elle ne juge pas",
        (e.humidites.length + e.kors.length) >= SEUILS.r1MinObservations ? confStat : "faible",
        [{ facteur: "Mesures d'humidité", valeur: String(e.humidites.length) },
         { facteur: "Mesures de KOR", valeur: String(e.kors.length) }]
      );

      var vals = (e.serie || []).map(function (p) { return p.valeur; });
      var mv = moyenne(vals), sd = ecartType(vals);
      var cv = (mv && sd != null) ? sd / mv : null;
      dims.stabilite = note(
        cv,
        cv == null ? "Série trop courte."
          : "Coefficient de variation du volume journalier (bas = régulier).",
        "achats.poids_net, série journalière complète", periode,
        "Comparaison entre équipes uniquement — aucune cible absolue",
        vals.length >= SEUILS.r1MinJoursHistorique ? confStat : "faible",
        [{ facteur: "Jours couverts", valeur: String(vals.length) }]
      );

      dims.incidents = note(
        null,
        "Aucune table d'incidents validés au périmètre AFLP. Dimension VIDE — " +
        "elle n'est pas à zéro, elle est INCONNUE.",
        "(aucune)", periode, "—", "nulle", []
      );

      out.equipes.push({
        cle: k, nom: e.nom, cluster: e.cluster,
        observations: e.nbAchats, joursHistorique: e.joursHistorique,
        periode: periode, confianceStatistique: confStat,
        donneesInsuffisantes: e.nbAchats < SEUILS.r1MinObservations,
        dimensions: dims,
        /* Séparation explicite : trois causes distinctes, trois traitements
           distincts. Les confondre produit des injustices. */
        lecture: {
          performance: dims.volume.score,
          qualiteDonnees: dims.qualiteDonnees.score,
          comportementInhabituel: "voir le cas d'usage 4 — jamais mélangé ici"
        },
        contestation: "Toute donnée de cette fiche peut être contestée. La correction " +
          "passe par le workflow FBMS autorisé (Branch Manager), jamais par cette couche."
      });
    });

    /* Audit de biais — par cluster et par disponibilité réseau. L'ancienneté
       n'est pas au schéma : nous le disons plutôt que de l'inventer. */
    var parClusterBiais = {};
    out.equipes.forEach(function (eq) {
      var c = eq.cluster || "(sans cluster)";
      if (!parClusterBiais[c]) parClusterBiais[c] = { cluster: c, n: 0, scores: [], insuffisantes: 0 };
      parClusterBiais[c].n++;
      if (eq.dimensions.volume.score != null) parClusterBiais[c].scores.push(eq.dimensions.volume.score);
      if (eq.donneesInsuffisantes) parClusterBiais[c].insuffisantes++;
    });
    out.biais = {
      parCluster: Object.keys(parClusterBiais).sort().map(function (c) {
        var b = parClusterBiais[c];
        return { cluster: c, equipes: b.n, volumeMedian: mediane(b.scores),
          partDonneesInsuffisantes: b.n ? b.insuffisantes / b.n : null };
      }),
      parAnciennete: null,
      motifAnciennete: "Aucune date d'entrée d'équipe RT au schéma : l'audit par " +
        "ancienneté ne peut pas être calculé. Prérequis à ouvrir.",
      parReseau: {
        fileLocaleEnAttente: dataset.fileLocale.enAttente,
        fileLocaleEchecs: dataset.fileLocale.echecs,
        commentaire: "Une équipe en zone à faible couverture réseau remonte ses données " +
          "plus tard, et paraît donc moins performante. Sans identifiant d'appareil ni " +
          "horodatage de synchronisation par équipe, ce biais est SIGNALÉ mais non mesurable."
      }
    };
    return out;
  }

  /* ==========================================================================
     13. Cas d'usage 4 — Comportements inhabituels
     --------------------------------------------------------------------------
     Vocabulaire imposé : « signal à examiner ». Jamais « fraude », jamais
     « anomalie prouvée », jamais un nom désigné comme responsable.
     ====================================================================== */

  function signauxInhabituels(dataset, diag) {
    var m = MODELES.signaux;
    var readiness = diag.cas.signaux;
    var statut = statutModele("signaux", readiness);
    var out = {
      casUsage: "signaux", libelle: m.nom, statut: statut,
      niveauReadiness: readiness.niveau,
      version: VERSION, versionDataset: dataset.versionDataset,
      dateCalcul: dataset.dateRef,
      avertissement: "Signaux à EXAMINER. Aucun de ces éléments n'établit une faute. " +
        "Une explication opérationnelle légitime existe dans la majorité des cas.",
      gardes: ["G09", "G10"],
      signaux: [], fauxPositifs: null
    };
    if (statut === "NOT_READY" || statut === "DESACTIVE") {
      out.blocages = readiness.blocages;
      return out;
    }

    var S = SEUILS;
    function pousser(code, entite, nom, titre, observation, norme, ecart, facteurs, conf, manquantes, action) {
      out.signaux.push({
        code: code, entite: entite, entiteNom: nom, titre: titre,
        observation: observation, norme: norme, ecart: ecart,
        facteursExplicatifs: facteurs, confiance: conf,
        donneesManquantes: manquantes,
        actionHumaineRecommandee: action,
        qualification: "signal à examiner",
        interdit: "Ce signal ne peut fonder ni sanction, ni accusation, ni blocage automatique."
      });
    }

    /* -- S01 · Poids anormalement ronds ----------------------------------- */
    (function () {
      function estRond(p) { return p > 0 && p % 5 === 0; }
      var partGlobale = dataset.achats.length
        ? dataset.achats.filter(function (a) { return estRond(a.poids); }).length / dataset.achats.length
        : null;
      if (partGlobale == null) return;
      var parts = [];
      Object.keys(dataset.parRt).sort().forEach(function (k) {
        var e = dataset.parRt[k];
        if (e.nbAchats < S.r1MinObservations) return;
        parts.push({ k: k, nom: e.nom, n: e.nbAchats,
          part: e.poidsList.filter(estRond).length / e.nbAchats });
      });
      if (parts.length < 3) return;
      var valeurs = parts.map(function (p) { return p.part; });
      parts.forEach(function (p) {
        var z = zModifie(p.part, valeurs);
        if (z != null && z > S.zAnomalie) {
          pousser("SIG-POIDS-01", p.k, p.nom,
            "Part inhabituelle de poids multiples de 5 kg",
            fmtPct(p.part * 100) + " des " + p.n + " achats",
            "Médiane des équipes : " + fmtPct(mediane(valeurs) * 100) +
              " · population : " + fmtPct(partGlobale * 100),
            "z modifié = " + (Math.round(z * 10) / 10),
            ["Balance à graduation grossière", "Sacs standardisés pesés par lot",
             "Arrondi de saisie sur téléphone", "Pratique de pesée du village"],
            p.n >= S.r2MinObservations ? "moyenne" : "faible",
            ["Aucun modèle de balance au schéma", "Photos de pesée non exploitables automatiquement"],
            "Comparer un bordereau papier à la saisie sur 5 achats tirés au hasard.");
        }
      });
    })();

    /* -- S02 · Concentration sur peu de producteurs ----------------------- */
    (function () {
      Object.keys(dataset.parRt).sort().forEach(function (k) {
        var e = dataset.parRt[k];
        if (e.nbAchats < S.r1MinObservations) return;
        var parts = Object.keys(e.producteurs).map(function (p) { return e.producteurs[p]; });
        var h = hhi(parts);
        if (h != null && h > S.hhiConcentration) {
          pousser("SIG-CONC-01", k, e.nom,
            "Concentration du volume sur peu de producteurs",
            "HHI = " + (Math.round(h * 100) / 100) + " sur " + parts.length + " producteur(s)",
            "Seuil de vigilance : " + S.hhiConcentration + " (≈ " +
              Math.round(1 / S.hhiConcentration) + " producteurs équivalents)",
            "+" + (Math.round((h - S.hhiConcentration) * 100) / 100),
            ["Village à production concentrée", "Producteur collecteur de fait",
             "Démarrage de campagne", "Peu de producteurs référencés dans ce village"],
            parts.length >= 5 ? "moyenne" : "faible",
            ["Aucune surface cultivée par producteur au schéma"],
            "Vérifier auprès du chef de cluster que les gros contributeurs sont bien des producteurs distincts.");
        }
      });
    })();

    /* -- S03 · Volume du jour hors norme du village ----------------------- */
    (function () {
      Object.keys(dataset.parVillage).sort().forEach(function (k) {
        var e = dataset.parVillage[k];
        var vals = (e.serie || []).map(function (p) { return p.valeur; })
          .filter(function (v) { return v > 0; });
        if (vals.length < S.r1MinObservations) return;
        var dernier = e.parJour[dataset.dateRef];
        if (!dernier) return;
        var z = zModifie(dernier, vals);
        if (z != null && Math.abs(z) > S.zAnomalie) {
          pousser("SIG-VOL-01", k, e.nom,
            "Volume du jour éloigné de la norme du village",
            fmtMT(dernier) + " MT le " + dataset.dateRef,
            "Médiane des jours actifs : " + fmtMT(mediane(vals)) + " MT",
            "z modifié = " + (Math.round(z * 10) / 10),
            ["Jour de marché", "Rattrapage après une coupure réseau",
             "Regroupement de plusieurs journées en une saisie", "Arrivée d'un nouveau producteur"],
            vals.length >= S.r2MinObservations ? "moyenne" : "faible",
            ["Aucun calendrier de marché au schéma"],
            "Confirmer avec l'équipe RT que la journée correspond bien à un fait terrain.");
        }
      });
    })();

    /* -- S04 · Arrêt de la saisie ----------------------------------------- */
    (function () {
      Object.keys(dataset.parRt).sort().forEach(function (k) {
        var e = dataset.parRt[k];
        var s = e.serie || [];
        if (s.length < 2 * S.fenetreCourte) return;
        var recent = s.slice(-S.fenetreCourte).filter(function (p) { return p.valeur > 0; }).length;
        var avant = s.slice(-2 * S.fenetreCourte, -S.fenetreCourte)
          .filter(function (p) { return p.valeur > 0; }).length;
        if (avant >= 4 && recent === 0) {
          pousser("SIG-RYTH-01", k, e.nom,
            "Arrêt complet de la saisie",
            "0 jour actif sur les " + S.fenetreCourte + " derniers",
            avant + " jour(s) actif(s) sur les " + S.fenetreCourte + " précédents",
            "-" + avant + " jours actifs",
            ["Fin de collecte dans la zone", "Panne d'appareil", "Absence de l'agent",
             "Données saisies mais non synchronisées"],
            "moyenne",
            ["Aucun journal de connexion par équipe au schéma"],
            "Appeler l'équipe avant toute autre interprétation — l'absence de donnée n'est pas une absence d'activité.");
        }
      });
    })();

    /* -- S05 · Achats sans reçu concentrés -------------------------------- */
    (function () {
      var parts = [];
      Object.keys(dataset.parRt).sort().forEach(function (k) {
        var e = dataset.parRt[k];
        if (e.nbAchats < S.r1MinObservations) return;
        parts.push({ k: k, nom: e.nom, n: e.nbAchats, part: e.sansRecu / e.nbAchats });
      });
      if (parts.length < 3) return;
      var valeurs = parts.map(function (p) { return p.part; });
      parts.forEach(function (p) {
        if (p.part <= 0) return;
        var z = zModifie(p.part, valeurs);
        if (z != null && z > S.zAnomalie) {
          pousser("SIG-TRAC-01", p.k, p.nom,
            "Part inhabituelle d'achats sans reçu",
            fmtPct(p.part * 100) + " des " + p.n + " achats",
            "Médiane des équipes : " + fmtPct(mediane(valeurs) * 100),
            "z modifié = " + (Math.round(z * 10) / 10),
            ["Rupture de carnets de reçus", "Formation insuffisante",
             "Saisie différée sans report du numéro"],
            "moyenne",
            ["Aucun stock de carnets de reçus au schéma"],
            "Vérifier la dotation en carnets avant toute autre lecture.");
        }
      });
    })();

    /* -- S06 · Synchronisation en échec ----------------------------------- */
    if (dataset.fileLocale.echecs > 0) {
      pousser("SIG-SYNC-01", "PROGRAMME", "Ensemble du pilote",
        "Échecs de synchronisation en cours",
        dataset.fileLocale.echecs + " opération(s) en échec",
        "0 attendu",
        "+" + dataset.fileLocale.echecs,
        ["Réseau instable", "Session expirée", "Conflit de données"],
        "bonne", [],
        "Traiter la file locale AVANT de lire toute prévision : les chiffres ci-dessus ignorent ces opérations.");
    }

    /* -- Faux positifs : suivi, pas mesure -------------------------------- */
    out.fauxPositifs = {
      mesurables: false,
      motif: "Aucun signal n'a encore été confirmé ou infirmé par un humain. Le taux " +
        "de faux positifs ne peut donc pas être MESURÉ aujourd'hui — il ne pourra " +
        "l'être qu'après une période d'observation en mode shadow.",
      procedure: "Chaque signal examiné doit être clos par un statut humain " +
        "(confirmé / non confirmé / sans objet). Le taux se calcule sur ces clôtures.",
      volumeSignaux: out.signaux.length,
      seuilDeSaturation: 20,
      saturation: out.signaux.length > 20
        ? "ALERTE : plus de 20 signaux. Un volume d'alertes inutiles est un ÉCHEC, " +
          "pas une preuve d'efficacité. Resserrer les seuils avant tout déploiement."
        : "Volume compatible avec un examen humain."
    };
    return out;
  }

  /* ==========================================================================
     14. Cas d'usage 5 — Évacuations
     --------------------------------------------------------------------------
     Le code existe et fonctionne. Les données, elles, n'existent pas : aucune
     table n'enregistre une sortie de stock au périmètre AFLP. Le module rend
     donc NOT_READY et énumère précisément ce qui manque, plutôt que de calculer
     une date de saturation à partir d'un stock supposé.
     ====================================================================== */

  var PREREQUIS_EVACUATION = [
    { code: "EVAC-P0-1", element: "Table des évacuations (date, origine, destination, tonnage, véhicule)", criticite: "P0" },
    { code: "EVAC-P0-2", element: "Clé de jointure `achats` → lot → `rcn_receptions`", criticite: "P0" },
    { code: "EVAC-P0-3", element: "Capacité (kg) de chaque point de stockage", criticite: "P0" },
    { code: "EVAC-P1-1", element: "Capacité utile et disponibilité des véhicules", criticite: "P1" },
    { code: "EVAC-P1-2", element: "Temps de trajet et état des routes par liaison", criticite: "P1" },
    { code: "EVAC-P1-3", element: "Contraintes de réception usine (créneaux, tonnage/jour)", criticite: "P1" }
  ];

  function prevoirEvacuations(dataset, diag, previsions) {
    var m = MODELES.evacuations;
    var readiness = diag.cas.evacuations;
    var statut = statutModele("evacuations", readiness);
    var out = {
      casUsage: "evacuations", libelle: m.nom, statut: statut,
      niveauReadiness: readiness.niveau,
      version: VERSION, versionDataset: dataset.versionDataset,
      dateCalcul: dataset.dateRef,
      avertissement: "Recommandation. Le Logistics Coordinator décide. Aucune mission, " +
        "aucune commande de transport, aucune sortie de stock n'est créée ici.",
      gardes: ["G12", "G14"],
      clusters: []
    };
    if (statut === "NOT_READY" || statut === "DESACTIVE") {
      out.blocages = readiness.blocages;
      out.prerequis = PREREQUIS_EVACUATION;
      /* Le calcul est néanmoins branché : si un humain fournit `capacites` et
         `evacuations` en entrée, il s'exécute. C'est ce qui distingue une
         architecture prête d'une architecture promise. */
      out.calculDisponible = true;
      out.commentaire = "Le calcul de saturation est implémenté et testé. Il s'active " +
        "dès que `capacites` et `evacuations` sont fournis en entrée. En leur absence, " +
        "aucune date n'est produite : un stock supposé égal au cumul acheté serait faux " +
        "dès la première évacuation.";
      return out;
    }

    var capacites = dataset.capacites || {};
    var sorties = {};
    (dataset.evacuations || []).forEach(function (e) {
      var k = cle(e.cluster);
      var d = jour(e.date);
      if (!k || !d || d > dataset.dateRef) return;
      sorties[k] = (sorties[k] || 0) + nb(e.tonnage_kg);
    });

    Object.keys(dataset.parCluster).sort().forEach(function (k) {
      var e = dataset.parCluster[k];
      var cap = nb(capacites[k] != null ? capacites[k] : capacites[e.nom]);
      var stock = e.total - (sorties[k] || 0);
      var prev7 = (previsions.parCluster || []).filter(function (p) {
        return p.entite === k && p.horizon === 7 && p.valeur != null;
      })[0];
      var rythmeJour = prev7 ? prev7.valeur / 7 : null;
      var joursAvantSaturation = (cap > 0 && rythmeJour > 0)
        ? Math.max(0, (cap - stock) / rythmeJour) : null;
      out.clusters.push({
        cluster: k, nom: e.nom,
        capaciteKg: cap || null,
        stockEstimeKg: stock,
        rythmeJourKg: rythmeJour,
        dateSaturationProbable: joursAvantSaturation != null
          ? decalerJour(dataset.dateRef, Math.floor(joursAvantSaturation)) : null,
        fenetreRecommandee: joursAvantSaturation != null ? {
          debut: decalerJour(dataset.dateRef, Math.max(0, Math.floor(joursAvantSaturation) - 2)),
          fin: decalerJour(dataset.dateRef, Math.floor(joursAvantSaturation))
        } : null,
        tonnageAEvacuerKg: stock,
        risqueRupture: (cap > 0 && stock >= cap) ? "élevé"
          : (joursAvantSaturation != null && joursAvantSaturation < 3 ? "modéré" : "faible"),
        risqueStockageExcessif: (cap > 0 && stock > 0.9 * cap) ? "élevé" : "faible",
        confiance: prev7 ? prev7.confiance : "nulle",
        nombreVehicules: null,
        reserve: "Le nombre de véhicules n'est pas calculé : aucune capacité utile de " +
          "véhicule n'est au schéma. Le donner sans donnée serait une invention."
      });
    });
    return out;
  }

  /* ==========================================================================
     15. Cas d'usage 6 — Écarts de qualité
     --------------------------------------------------------------------------
     La norme est calculée en EXCLUANT l'entité testée (leave-one-out).
     Comparer une mesure à une moyenne qui la contient est une fuite : plus
     l'écart est grand, plus il déplace sa propre référence, et l'écart mesuré
     est mécaniquement sous-estimé.
     ====================================================================== */

  var CAUSES_QUALITE = [
    "Variation naturelle du lot",
    "Erreur de mesure (opérateur)",
    "Dérive d'équipement (humidimètre non étalonné)",
    "Séchage insuffisant au village",
    "Conditions de stockage",
    "Perte pendant le transport",
    "Anomalie à examiner"
  ];

  function ecartsQualite(dataset, diag) {
    var m = MODELES.qualite;
    var readiness = diag.cas.qualite;
    var statut = statutModele("qualite", readiness);
    var out = {
      casUsage: "qualite", libelle: m.nom, statut: statut,
      niveauReadiness: readiness.niveau,
      version: VERSION, versionDataset: dataset.versionDataset,
      dateCalcul: dataset.dateRef,
      avertissement: "Écarts à INVESTIGUER. Aucune perte n'est validée, aucun " +
        "responsable n'est désigné. La cause d'un écart de qualité est établie par " +
        "une investigation humaine, pas par un calcul.",
      gardes: ["G05"],
      ecarts: [], normes: null,
      causesPossibles: CAUSES_QUALITE,
      comparaisonUsine: {
        disponible: false,
        motif: "Aucune clé de jointure entre `achats` (village) et `rcn_qualites` (usine). " +
          "L'écart village ↔ usine — le seul qui porte une conséquence économique directe — " +
          "n'est pas calculable en l'état.",
        prerequis: "Ajouter à `achats` une référence de lot reprise par `rcn_receptions`."
      }
    };
    if (statut === "NOT_READY" || statut === "DESACTIVE") {
      out.blocages = readiness.blocages;
      return out;
    }

    var mesures = ["humidite", "kor"];
    var normes = {};
    mesures.forEach(function (mes) {
      var vals = dataset.achats.map(function (a) { return a[mes]; })
        .filter(function (v) { return v != null; });
      normes[mes] = vals.length ? {
        n: vals.length, mediane: mediane(vals), mad: mad(vals),
        q10: quantile(vals, 0.10), q90: quantile(vals, 0.90),
        source: "population observée des achats à la date de référence",
        reserve: "Norme DESCRIPTIVE. Elle n'est pas la qualité cible : aucune cible " +
          "n'a été arrêtée avec Quality/Factory au schéma."
      } : null;
    });
    out.normes = normes;

    Object.keys(dataset.parVillage).sort().forEach(function (k) {
      var e = dataset.parVillage[k];
      mesures.forEach(function (mes) {
        var liste = (mes === "humidite") ? e.humidites : e.kors;
        if (liste.length < 3) return;
        var med = mediane(liste);
        /* Leave-one-out : la population de référence EXCLUT ce village. */
        var reste = [];
        Object.keys(dataset.parVillage).forEach(function (k2) {
          if (k2 === k) return;
          var l2 = (mes === "humidite") ? dataset.parVillage[k2].humidites : dataset.parVillage[k2].kors;
          reste = reste.concat(l2);
        });
        if (reste.length < SEUILS.r1MinObservations) return;
        var z = zModifie(med, reste);
        if (z == null || Math.abs(z) <= SEUILS.zAnomalie) return;
        var refMed = mediane(reste);
        var ecart = med - refMed;
        /* Importance économique : seule l'humidité a une traduction directe en
           poids (perte de séchage). Pour le KOR, aucune grille de réfaction
           n'est au schéma : nous ne la fabriquons pas. */
        var importance = null;
        if (mes === "humidite" && ecart > 0) {
          importance = {
            natureCalcul: "perte de poids par séchage, approximation linéaire",
            poidsKg: e.total * (ecart / 100),
            reserve: "Approximation. La courbe réelle de perte au séchage n'est pas au " +
              "schéma ; ce chiffre ORDONNE les priorités, il ne chiffre pas une perte."
          };
        }
        out.ecarts.push({
          entite: k, entiteNom: e.nom, cluster: e.cluster, mesure: mes,
          valeurMesuree: med, observations: liste.length,
          normeAttendue: refMed,
          intervalleNormal: { bas: quantile(reste, 0.10), haut: quantile(reste, 0.90), niveau: 0.80 },
          ecart: ecart,
          zModifie: Math.round(z * 10) / 10,
          importanceEconomique: importance,
          confiance: liste.length >= SEUILS.r1MinObservations ? "moyenne" : "faible",
          facteursExplicatifs: CAUSES_QUALITE,
          actionHumaineRecommandee: "Faire vérifier l'étalonnage de l'humidimètre du " +
            "village avant toute autre hypothèse — c'est la cause la plus fréquente et la moins coûteuse à écarter.",
          interdit: "Cet écart ne valide aucune perte et ne désigne aucun responsable."
        });
      });
    });

    return out;
  }

  /* ==========================================================================
     16. Modèle commun de stockage des prédictions
     --------------------------------------------------------------------------
     Une prédiction, quel que soit le cas d'usage, s'écrit sous la MÊME forme.
     C'est ce qui permet de la comparer plus tard au réel, de la rejouer, et de
     la relier à une décision humaine.
     Ces enregistrements correspondent 1:1 aux colonnes de
     docs/migrations/aflp_predictions_20260814.sql (table `aflp_predictions`).
     ====================================================================== */

  var CHAMPS_PREDICTION = [
    "prediction_id", "cas_usage", "entite_type", "entite", "entite_nom",
    "village", "cluster", "rt", "campagne", "horizon_jours", "date_calcul",
    "periode_debut", "periode_fin", "valeur_prevue", "borne_basse", "borne_haute",
    "niveau_confiance", "confiance", "version_modele", "version_variables",
    "version_dataset", "date_reference_donnees", "statut_modele", "methode",
    "explications", "indicateur_derive", "statut_revue_humaine",
    "utilisateur_consultation", "decision_humaine", "motif_decision"
  ];

  function versEnregistrements(resultats, dataset) {
    var out = [];
    var idx = 0;

    function ajouter(o) {
      idx++;
      var rec = {
        prediction_id: dataset.versionDataset + "-" + o.cas_usage + "-" + ("000" + idx).slice(-4),
        campagne: "AFLP 2027",
        date_calcul: dataset.dateRef,
        version_modele: VERSION,
        version_variables: VERSION_VARIABLES,
        version_dataset: dataset.versionDataset,
        date_reference_donnees: dataset.dateReferenceDonnees,
        /* Quatre champs volontairement vides à l'écriture : ils ne peuvent être
           remplis que par un humain, plus tard. Les pré-remplir reviendrait à
           simuler une revue qui n'a pas eu lieu. */
        statut_revue_humaine: "NON_REVUE",
        utilisateur_consultation: null,
        decision_humaine: null,
        motif_decision: null,
        indicateur_derive: null,
        village: null, cluster: null, rt: null,
        borne_basse: null, borne_haute: null, niveau_confiance: null
      };
      Object.keys(o).forEach(function (k) { rec[k] = o[k]; });
      /* Aucun champ hors du modèle commun ne passe : le schéma fait foi. */
      var propre = {};
      CHAMPS_PREDICTION.forEach(function (c) {
        propre[c] = Object.prototype.hasOwnProperty.call(rec, c) ? rec[c] : null;
      });
      out.push(propre);
    }

    ["global", "parCluster", "parVillage"].forEach(function (bloc) {
      (resultats.volumes[bloc] || []).forEach(function (p) {
        if (p.statut === "NOT_READY") return;
        ajouter({
          cas_usage: "volumes", entite_type: p.niveau, entite: p.entite,
          entite_nom: p.entiteNom,
          village: p.niveau === "village" ? p.entiteNom : null,
          cluster: p.cluster || (p.niveau === "cluster" ? p.entiteNom : null),
          horizon_jours: p.horizon,
          periode_debut: p.periodePrevue && p.periodePrevue.debut,
          periode_fin: p.periodePrevue && p.periodePrevue.fin,
          valeur_prevue: p.valeur, borne_basse: p.bas, borne_haute: p.haut,
          niveau_confiance: p.niveauIntervalle, confiance: p.confiance,
          statut_modele: p.statut, methode: p.methode,
          explications: JSON.stringify({
            methode: p.methodeNom, wape: p.metriques.wape, plis: p.metriques.plis,
            biais: p.metriques.biais, motifConfiance: p.motifConfiance,
            comparaisonBaselines: p.comparaison
          })
        });
      });
    });

    if (resultats.fonds.statut !== "NOT_READY" && resultats.fonds.scenarios) {
      ajouter({
        cas_usage: "fonds", entite_type: "programme", entite: "PROGRAMME",
        entite_nom: "Ensemble du pilote",
        horizon_jours: resultats.fonds.horizonJours,
        periode_debut: resultats.fonds.periodePrevue && resultats.fonds.periodePrevue.debut,
        periode_fin: resultats.fonds.periodePrevue && resultats.fonds.periodePrevue.fin,
        valeur_prevue: resultats.fonds.scenarios.central && resultats.fonds.scenarios.central.total,
        borne_basse: resultats.fonds.scenarios.bas && resultats.fonds.scenarios.bas.total,
        borne_haute: resultats.fonds.scenarios.haut && resultats.fonds.scenarios.haut.total,
        niveau_confiance: 0.80, confiance: resultats.fonds.confiance,
        statut_modele: resultats.fonds.statut, methode: "volume prévu × prix moyen observé",
        explications: JSON.stringify({
          facteurs: resultats.fonds.facteurs, reserves: resultats.fonds.reserves,
          expositionOuverte: resultats.fonds.expositionOuverte,
          montantNonFinancable: resultats.fonds.montantNonFinancable
        })
      });
    }

    (resultats.scorecardRt.equipes || []).forEach(function (eq) {
      ajouter({
        cas_usage: "scorecardRt", entite_type: "rt", entite: eq.cle,
        entite_nom: eq.nom, rt: eq.nom, cluster: eq.cluster,
        horizon_jours: 0,
        periode_debut: (eq.periode || "").slice(0, 10),
        periode_fin: dataset.dateRef,
        valeur_prevue: eq.dimensions.volume.score,
        confiance: eq.confianceStatistique,
        statut_modele: resultats.scorecardRt.statut,
        methode: "scorecard multidimensionnelle — aucun score composite",
        explications: JSON.stringify({
          dimensions: Object.keys(eq.dimensions).map(function (d) {
            return { dimension: d, score: eq.dimensions[d].score,
              motif: eq.dimensions[d].motif, confiance: eq.dimensions[d].confiance };
          }),
          donneesInsuffisantes: eq.donneesInsuffisantes
        })
      });
    });

    (resultats.signaux.signaux || []).forEach(function (s) {
      ajouter({
        cas_usage: "signaux", entite_type: "signal", entite: s.entite,
        entite_nom: s.entiteNom, horizon_jours: 0,
        periode_debut: dataset.dateRef, periode_fin: dataset.dateRef,
        valeur_prevue: null, confiance: s.confiance,
        statut_modele: resultats.signaux.statut, methode: s.code,
        explications: JSON.stringify({
          titre: s.titre, observation: s.observation, norme: s.norme, ecart: s.ecart,
          facteurs: s.facteursExplicatifs, manquantes: s.donneesManquantes,
          action: s.actionHumaineRecommandee, qualification: s.qualification
        })
      });
    });

    (resultats.evacuations.clusters || []).forEach(function (c) {
      ajouter({
        cas_usage: "evacuations", entite_type: "cluster", entite: c.cluster,
        entite_nom: c.nom, cluster: c.nom, horizon_jours: 7,
        periode_debut: dataset.dateRef,
        periode_fin: c.dateSaturationProbable || dataset.dateRef,
        valeur_prevue: c.tonnageAEvacuerKg, confiance: c.confiance,
        statut_modele: resultats.evacuations.statut, methode: "saturation linéaire",
        explications: JSON.stringify({ capacite: c.capaciteKg, stock: c.stockEstimeKg,
          rythme: c.rythmeJourKg, risque: c.risqueRupture, reserve: c.reserve })
      });
    });

    (resultats.qualite.ecarts || []).forEach(function (e) {
      ajouter({
        cas_usage: "qualite", entite_type: "village", entite: e.entite,
        entite_nom: e.entiteNom, village: e.entiteNom, cluster: e.cluster,
        horizon_jours: 0, periode_debut: dataset.dateRef, periode_fin: dataset.dateRef,
        valeur_prevue: e.valeurMesuree,
        borne_basse: e.intervalleNormal.bas, borne_haute: e.intervalleNormal.haut,
        niveau_confiance: e.intervalleNormal.niveau, confiance: e.confiance,
        statut_modele: resultats.qualite.statut, methode: "z modifié, norme leave-one-out",
        explications: JSON.stringify({ mesure: e.mesure, norme: e.normeAttendue,
          ecart: e.ecart, z: e.zModifie, importance: e.importanceEconomique,
          action: e.actionHumaineRecommandee })
      });
    });

    return out;
  }

  /* ==========================================================================
     17. Dérive — comparaison de la période récente à la période précédente
     ====================================================================== */

  function derive(dataset) {
    var s = dataset.serieGlobale || [];
    var f = SEUILS.fenetreLongue;
    if (s.length < 2 * f) {
      return { mesurable: false,
        motif: "Historique inférieur à " + (2 * f) + " jours : aucune comparaison de périodes n'est possible." };
    }
    var recent = s.slice(-f).map(function (p) { return p.valeur; });
    var reference = s.slice(-2 * f, -f).map(function (p) { return p.valeur; });
    var mr = mediane(recent), mf = mediane(reference);
    var ratio = mf ? mr / mf : null;
    /* Seuil de dérive : ±30 % de la médiane. Il est arbitraire DANS SA VALEUR
       et nous le disons. Il est destiné à être recalibré après une campagne
       complète d'observation en mode shadow, pas à faire autorité aujourd'hui. */
    var seuil = 0.30;
    var enDerive = ratio != null && Math.abs(ratio - 1) > seuil;
    return {
      mesurable: true,
      medianeRecente: mr, medianeReference: mf, ratio: ratio,
      fenetreJours: f,
      derive: enDerive,
      seuil: seuil,
      reserveSeuil: "Seuil provisoire, à recalibrer après une campagne complète " +
        "d'observation. Il n'est pas justifié statistiquement à ce stade.",
      action: enDerive
        ? "Dérive au-delà du seuil : désactiver le modèle concerné via " +
          "AFLP_PRED.desactiver(cle, motif) et revenir à la baseline."
        : "Aucune action."
    };
  }

  /* ==========================================================================
     18. Point d'entrée unique
     ====================================================================== */

  function analyser(donnees) {
    donnees = donnees || {};
    if (donnees.seuils) seuils(donnees.seuils);

    var dataset = construireDataset(donnees);
    if (donnees.capacites) dataset.capacites = donnees.capacites;
    if (donnees.evacuations) dataset.evacuations = donnees.evacuations;

    var diag = diagnostic(dataset);
    var volumes = prevoirVolumes(dataset, diag);
    var fonds = besoinFonds(dataset, diag, volumes);
    var score = scorecardRt(dataset, diag);
    var signaux = signauxInhabituels(dataset, diag);
    var evac = prevoirEvacuations(dataset, diag, volumes);
    var qual = ecartsQualite(dataset, diag);

    var resultats = {
      volumes: volumes, fonds: fonds, scorecardRt: score,
      signaux: signaux, evacuations: evac, qualite: qual
    };

    return {
      version: VERSION,
      versionDataset: dataset.versionDataset,
      dateRef: dataset.dateRef,
      dateReferenceDonnees: dataset.dateReferenceDonnees,
      retardDonneesJours: dataset.retardDonneesJours,
      diagnostic: diag,
      resultats: resultats,
      registre: registre(),
      derive: derive(dataset),
      predictions: versEnregistrements(resultats, dataset),
      gardes: GARDES,
      sortiesAutorisees: SORTIES_AUTORISEES,
      /* Une seule phrase, en tête de toute sortie : elle doit survivre à une
         copie partielle du rapport. */
      mentionObligatoire: "AIDE À LA DÉCISION — statut SHADOW_ONLY" +
        (diag.porteNiveau1.franchie ? "" : ", porte du Niveau 1 non franchie") +
        ". Aucune valeur de ce rapport n'autorise, ne débloque, ne valide ni ne sanctionne quoi que ce soit."
    };
  }

  /* Résumé lisible — sert au téléchargement et au contrôle humain. */
  function resumeTexte(analyse) {
    var L = [];
    L.push("AFLP — COUCHE PRÉDICTIVE (Niveau 3) · " + analyse.dateRef);
    L.push(analyse.mentionObligatoire);
    L.push("");
    L.push("Version modèle " + analyse.version + " · dataset " + analyse.versionDataset);
    L.push("Données arrêtées au " + (analyse.dateReferenceDonnees || "—") +
      " (retard : " + (analyse.retardDonneesJours == null ? "—" : analyse.retardDonneesJours + " j") + ")");
    L.push("");
    L.push("PORTE DU NIVEAU 1 — " + analyse.diagnostic.verdict);
    analyse.diagnostic.porteNiveau1.p0Ouverts.forEach(function (p) {
      L.push("  [P0] " + p.code + " · " + p.libelle + " — " + p.statut);
    });
    L.push("");
    L.push("MATURITÉ DES DONNÉES PAR CAS D'USAGE");
    analyse.diagnostic.ordre.forEach(function (k) {
      var c = analyse.diagnostic.cas[k];
      L.push("  " + c.niveau + " · " + c.libelle);
      (c.blocages || []).forEach(function (b) { L.push("        - " + b); });
    });
    L.push("");
    L.push("STATUT DES MODÈLES");
    analyse.registre.forEach(function (m) {
      var r = analyse.resultats[m.cle];
      L.push("  " + (r ? r.statut : "—") + " · " + m.nom + (m.actif ? "" : " (DÉSACTIVÉ)"));
    });
    var v7 = (analyse.resultats.volumes.global || []).filter(function (p) { return p.horizon === 7; })[0];
    if (v7 && v7.valeur != null) {
      L.push("");
      L.push("PRÉVISION 7 JOURS (ensemble du pilote) — " + fmtMT(v7.valeur) + " MT" +
        (v7.bas != null ? " [" + fmtMT(v7.bas) + " – " + fmtMT(v7.haut) + "]" : " (intervalle indisponible)"));
      L.push("  méthode " + v7.methodeNom + " · WAPE " + fmtPct(v7.metriques.wape * 100) +
        " sur " + v7.metriques.plis + " pli(s) · confiance " + v7.confiance);
      var cv = v7.metriques.couvertureIntervalle;
      L.push("  couverture de l'intervalle : " +
        (cv && cv.mesurable ? fmtPct(cv.valeur * 100) + " pour 80 % annoncés (" + cv.base + " plis)"
                            : "non mesurable — " + ((cv && cv.motif) || "")));
    }
    L.push("");
    L.push("Toute décision opérationnelle ou financière reste humaine, nominative, motivée et auditée.");
    return L.join("\n");
  }

  /* ==========================================================================
     19. API publique — aucune fonction d'écriture, par construction
     ====================================================================== */

  var API = {
    version: VERSION,
    /* Analyse */
    analyser: analyser,
    construireDataset: construireDataset,
    diagnostic: diagnostic,
    resumeTexte: resumeTexte,
    /* Cas d'usage, exposés séparément pour les tests et l'interface */
    prevoirVolumes: prevoirVolumes,
    besoinFonds: besoinFonds,
    scorecardRt: scorecardRt,
    signauxInhabituels: signauxInhabituels,
    prevoirEvacuations: prevoirEvacuations,
    ecartsQualite: ecartsQualite,
    derive: derive,
    /* Gouvernance des modèles */
    registre: registre,
    desactiver: desactiver,
    reactiver: reactiver,
    promouvoir: promouvoir,
    reinitialiserModeles: reinitialiserModeles,
    VALIDATIONS_REQUISES: VALIDATIONS_REQUISES,
    /* Garde-fous */
    GARDES: GARDES,
    SORTIES_AUTORISEES: SORTIES_AUTORISEES,
    executer: executer,
    journalRefus: journalRefus,
    /* Réglages */
    seuils: seuils,
    reinitialiserSeuils: reinitialiserSeuils,
    SEUILS_DEFAUT: SEUILS_DEFAUT,
    HORIZONS: HORIZONS,
    CHAMPS_PREDICTION: CHAMPS_PREDICTION,
    PREREQUIS_EVACUATION: PREREQUIS_EVACUATION,
    /* Statistiques exposées pour vérification indépendante */
    stats: { mediane: mediane, quantile: quantile, mad: mad, zModifie: zModifie,
      hhi: hhi, moyenne: moyenne, ecartType: ecartType, somme: somme },
    backtest: backtest,
    couvertureIntervalle: couvertureIntervalle,
    choisirChampion: choisirChampion,
    intervalle: intervalle,
    BASELINES: BASELINES
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.AFLP_PRED = API;

})(typeof globalThis !== "undefined" ? globalThis : this);
