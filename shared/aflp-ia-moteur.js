/* ============================================================================
   ASSISTANT IA AFLP — MOTEUR (shared/aflp-ia-moteur.js)
   ----------------------------------------------------------------------------
   ANAGROCI FieldLink Programme (AFLP) 2027 — assistance métier au Branch Manager.

   Ce fichier ne contient AUCUN appel réseau, AUCUN accès au DOM, AUCUNE clé.
   Il transforme les données déjà chargées par la page appelante en :

     · une synthèse quotidienne          → AFLP_IA.synthese(etat)
     · des alertes et anomalies datées   → AFLP_IA.alertes(etat)
     · un statut de refinancement        → AFLP_IA.refinancement(etat)
     · une réponse aux questions du BM   → AFLP_IA.repondre(question, etat)

   Règle fondamentale appliquée telle quelle :
     PAS DE RÉCONCILIATION = PAS DE REFINANCEMENT.

   Déterminisme : à données identiques et date de référence identique, la sortie
   est identique. Aucun aléa, aucun appel de modèle de langage. Le moteur est
   donc vérifiable ligne à ligne par un humain, et fonctionne hors ligne.

   Ce n'est PAS un agent de maintenance du dépôt (voir .claude/agents/).
   ========================================================================== */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";

  /* ==========================================================================
     1. Utilitaires
     ====================================================================== */

  function nb(x) { var n = Number(x); return isFinite(n) ? n : 0; }

  function txt(x) { return x == null ? "" : String(x); }

  /* Clé de comparaison insensible aux accents, à la casse et à la ponctuation.
     Même convention que terrain/command.html, pour que les regroupements faits
     ici donnent exactement les mêmes totaux que le tableau de bord. */
  function cle(s) {
    return txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /* Forme normalisée d'une phrase : accents retirés, mots séparés par un espace. */
  function motsCles(s) {
    return txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  /* Un jour au format AAAA-MM-JJ, à partir d'une date, d'un timestamptz ou
     d'une chaîne déjà au bon format. Retourne "" si la valeur est inutilisable. */
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

  /* Nombre de jours entiers entre deux jours AAAA-MM-JJ (b - a). */
  function ecartJours(a, b) {
    if (!a || !b) return null;
    var da = Date.parse(a + "T00:00:00Z"), db = Date.parse(b + "T00:00:00Z");
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000);
  }

  function joursAvant(ref, n) {
    var d = Date.parse(ref + "T00:00:00Z");
    if (isNaN(d)) return "";
    return jour(new Date(d - n * 86400000).toISOString());
  }

  function fmtNombre(x) {
    if (x == null || !isFinite(Number(x))) return "—";
    return Math.round(Number(x)).toLocaleString("fr-FR");
  }

  function fmtMT(kg) {
    return (Math.round((nb(kg) / 1000) * 10) / 10).toLocaleString("fr-FR");
  }

  function fmtF(x) { return fmtNombre(x) + " F"; }

  var MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
    "août", "septembre", "octobre", "novembre", "décembre"];

  /* Date en toutes lettres, pour les phrases de réponse. La forme AAAA-MM-JJ
     reste celle des sources : une source doit être vérifiable, pas jolie. */
  function fmtDateLongue(j) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(j));
    if (!m) return txt(j);
    var jour1 = Number(m[3]);
    return (jour1 === 1 ? "1er" : String(jour1)) + " " + MOIS_FR[Number(m[2]) - 1] + " " + m[1];
  }

  /* Accord en nombre. Une réponse qui écrit « 1 équipes » perd la confiance du
     lecteur sur le chiffre lui-même. */
  function pluriel(n, singulier, plurielMot) {
    return Math.abs(nb(n)) >= 2 ? (plurielMot || (singulier + "s")) : singulier;
  }

  function fmtPct(x) {
    if (x == null || !isFinite(Number(x))) return "—";
    return (Math.round(Number(x) * 10) / 10).toLocaleString("fr-FR") + " %";
  }

  function trier(liste, extracteur, decroissant) {
    return liste.slice().sort(function (a, b) {
      var va = nb(extracteur(a)), vb = nb(extracteur(b));
      return decroissant ? vb - va : va - vb;
    });
  }

  /* ==========================================================================
     2. Référentiel AFLP 2027
     --------------------------------------------------------------------------
     Cadrage du pilote fourni par le Branch Manager : 3 000 MT, 2 zones,
     6 clusters, 60 villages, 60 équipes RT.

     La répartition des 6 clusters entre GBEKE 1 et GBEKE 2 a été CONFIRMÉE par
     le Branch Manager le 2026-08-14. Elle était auparavant une hypothèse de
     travail, signalée par un bandeau dans l'interface ; ce bandeau ne s'affiche
     plus. Elle reste surchargeable sans toucher à ce fichier :
       · par le paramètre `aflp_zones` de la table `parametres_calcul`
         (valeur JSON : {"GBEKE 1":["Djébonoua",…],"GBEKE 2":[…]}) ;
       · ou par AFLP_IA.referentiel({zones:…}) depuis la page appelante.
     ====================================================================== */

  var CLUSTERS_AFLP = [
    { cle: "DJEBONOUA", label: "Djébonoua" },
    { cle: "BROBO", label: "Brobo" },
    { cle: "SAKASSOU", label: "Sakassou" },
    { cle: "BEOUMI", label: "Béoumi" },
    { cle: "BOTRO", label: "Botro" },
    { cle: "DIABO", label: "Diabo" }
  ];

  var REFERENTIEL_DEFAUT = {
    campagne: "AFLP 2027",
    objectifMT: 3000,
    villagesCibles: 60,
    equipesRtCibles: 60,
    zones: {
      "GBEKE 1": ["Djébonoua", "Brobo", "Sakassou"],
      "GBEKE 2": ["Béoumi", "Botro", "Diabo"]
    },
    /* Confirmee par le Branch Manager le 2026-08-14, puis RECTIFIEE par lui le
       2026-08-16 : Sakassou et Diabo etaient intervertis. C'est cette version
       qui fait foi, et c'est elle que reprend la gouvernance AFLP de
       fbms/index.html (AFLP_ZONES_DEFAUT) — les deux doivent rester identiques.
       Repasser `zonesConfirmees` a `false` si le decoupage redevient incertain :
       le bandeau d'avertissement reapparaitra de lui-meme. */
    zonesConfirmees: true,
    /* Seuils d'alerte. Aucun seuil qualité n'est défini ici : la qualité est
       déjà arbitrée en amont par les colonnes `qualite_statut` et
       `statut_validation` des achats. Le moteur les lit, il ne les redéfinit
       pas — inventer un seuil d'humidité ou de KOR ici créerait une deuxième
       vérité métier. */
    seuils: {
      toleranceEcartRecon: 0,        // F — écart de réconciliation toléré
      avanceNonReconcilieeJours: 2,  // jours avant alerte sur une avance ouverte
      villageInactifJours: 7,        // jours sans achat = village en sommeil
      partSansRecuAlerte: 5          // % d'achats sans reçu déclenchant l'alerte
    }
  };

  var REFERENTIEL = JSON.parse(JSON.stringify(REFERENTIEL_DEFAUT));

  /* Lecture / surcharge du référentiel. Appelée sans argument, elle retourne
     simplement l'état courant. */
  function referentiel(surcharge) {
    if (surcharge && typeof surcharge === "object") {
      if (surcharge.objectifMT) REFERENTIEL.objectifMT = nb(surcharge.objectifMT);
      if (surcharge.villagesCibles) REFERENTIEL.villagesCibles = nb(surcharge.villagesCibles);
      if (surcharge.equipesRtCibles) REFERENTIEL.equipesRtCibles = nb(surcharge.equipesRtCibles);
      if (surcharge.zones && typeof surcharge.zones === "object") {
        REFERENTIEL.zones = surcharge.zones;
        REFERENTIEL.zonesConfirmees = surcharge.zonesConfirmees !== false;
      }
      if (surcharge.seuils) {
        Object.keys(surcharge.seuils).forEach(function (k) {
          if (surcharge.seuils[k] != null) REFERENTIEL.seuils[k] = nb(surcharge.seuils[k]);
        });
      }
    }
    return REFERENTIEL;
  }

  /* Applique le paramètre `aflp_zones` s'il existe dans parametres_calcul.
     Une valeur illisible est ignorée sans faire échouer le chargement. */
  function appliquerParametres(parametres) {
    (parametres || []).forEach(function (p) {
      if (!p || p.cle !== "aflp_zones") return;
      try {
        var v = typeof p.valeur === "string" ? JSON.parse(p.valeur) : p.valeur;
        if (v && typeof v === "object") referentiel({ zones: v, zonesConfirmees: true });
      } catch (e) { /* paramètre mal formé : on conserve l'hypothèse par défaut */ }
    });
    return REFERENTIEL;
  }

  /* Zone d'un cluster, d'après le référentiel courant. */
  function zoneDuCluster(nomCluster) {
    var k = cle(nomCluster);
    var zones = REFERENTIEL.zones || {};
    var trouve = "";
    Object.keys(zones).forEach(function (z) {
      (zones[z] || []).forEach(function (c) { if (cle(c) === k) trouve = z; });
    });
    return trouve || "Hors périmètre AFLP";
  }

  function libelleCluster(k) {
    for (var i = 0; i < CLUSTERS_AFLP.length; i++) {
      if (CLUSTERS_AFLP[i].cle === k) return CLUSTERS_AFLP[i].label;
    }
    return "";
  }

  /* ==========================================================================
     3. Construction de l'état — agrégation des données brutes
     --------------------------------------------------------------------------
     Entrée attendue (toutes les listes sont facultatives) :
       {
         achats:[], avances:[], reconciliations:[], sacs:[],
         villages:[], rt:[], parametres:[],
         fileLocale:{enAttente:n, echecs:n},
         dateRef:"AAAA-MM-JJ"
       }
     ====================================================================== */

  function nomVillage(v) {
    return (v && v.data && v.data.s1 && v.data.s1.village) || (v && v.village) || "";
  }
  function clusterVillage(v) {
    return (v && v.data && v.data.s1 && v.data.s1.cluster) || (v && v.cluster) || "";
  }
  function gpsVillage(v) {
    return !!(v && v.data && v.data.s1 && v.data.s1.gpsLat);
  }
  function nomRt(r) {
    return (r && r.data && (r.data.nom || r.data.rt)) || (r && r.nom) || "";
  }
  function clusterRt(r, villages) {
    if (r && r.data && r.data.cluster) return r.data.cluster;
    var k = cle(r && r.village_nom);
    for (var i = 0; i < villages.length; i++) {
      if (cle(nomVillage(villages[i])) === k) return clusterVillage(villages[i]);
    }
    return "";
  }
  /* Même clé RT que le Command Center : identifiant serveur si présent, sinon
     nom normalisé. Toute autre convention ferait diverger les deux écrans. */
  function cleRt(idOuNom, nom) {
    return String(idOuNom || cle(nom || ""));
  }

  function construireEtat(donnees) {
    donnees = donnees || {};
    var achats = donnees.achats || [];
    var avances = donnees.avances || [];
    var recons = donnees.reconciliations || [];
    var sacs = donnees.sacs || [];
    var villages = donnees.villages || [];
    var rts = donnees.rt || [];
    var dateRef = jour(donnees.dateRef) || aujourdhui();

    appliquerParametres(donnees.parametres);

    var etat = {
      version: VERSION,
      dateRef: dateRef,
      campagne: REFERENTIEL.campagne,
      objectifMT: REFERENTIEL.objectifMT,
      referentiel: REFERENTIEL,
      volume: {
        jourKg: 0, cumulKg: 0, cumulMT: 0, pctObjectif: 0, resteMT: 0,
        semaineKg: 0, joursActifs: 0, moyenneJourKg: 0,
        premierJour: "", dernierJour: ""
      },
      cash: { avances: 0, paye: 0, solde: 0, commission: 0, avancesJour: 0 },
      qualite: { aControler: 0, horsBareme: 0, sansRecu: 0, montantSansRecu: 0, lignes: achats.length },
      sacs: { rtTotal: 0, clusterTotal: 0, dechires: 0, distribues: 0, negRt: 0, negCluster: 0, negProd: 0 },
      clusters: {},
      zones: {},
      rt: {},
      villagesDetail: {},
      villages: { total: villages.length, sansRt: 0, sansGps: 0, actifs: 0, inactifs: [] },
      couverture: {},
      fileLocale: {
        enAttente: nb(donnees.fileLocale && donnees.fileLocale.enAttente),
        echecs: nb(donnees.fileLocale && donnees.fileLocale.echecs)
      },
      sources: []
    };

    /* -- 3.1 Volume, cash, qualité ---------------------------------------- */
    var joursVus = {};
    var debutSemaine = joursAvant(dateRef, 6);
    achats.forEach(function (a) {
      var poids = nb(a.poids_net), montant = nb(a.montant), d = jour(a.date);
      etat.volume.cumulKg += poids;
      etat.cash.paye += montant;
      etat.cash.commission += nb(a.commission_rt);
      if (d) {
        joursVus[d] = true;
        if (d === dateRef) etat.volume.jourKg += poids;
        if (debutSemaine && d >= debutSemaine && d <= dateRef) etat.volume.semaineKg += poids;
        if (!etat.volume.premierJour || d < etat.volume.premierJour) etat.volume.premierJour = d;
        if (!etat.volume.dernierJour || d > etat.volume.dernierJour) etat.volume.dernierJour = d;
      }
      /* Un achat sans reçu n'est pas refinançable : c'est la définition portée
         par la colonne `refinancable` du schéma achats. */
      if (a.refinancable === false || !a.numero_recu) {
        etat.qualite.sansRecu++;
        etat.qualite.montantSansRecu += montant;
      }
      if (a.qualite_statut && a.qualite_statut !== "OK") etat.qualite.aControler++;
      if (a.statut_validation === "Validation BM requise") etat.qualite.horsBareme++;
    });
    etat.volume.joursActifs = Object.keys(joursVus).length;
    etat.volume.cumulMT = etat.volume.cumulKg / 1000;
    etat.volume.pctObjectif = REFERENTIEL.objectifMT ? (etat.volume.cumulMT / REFERENTIEL.objectifMT) * 100 : 0;
    etat.volume.resteMT = Math.max(0, REFERENTIEL.objectifMT - etat.volume.cumulMT);
    etat.volume.moyenneJourKg = etat.volume.joursActifs ? etat.volume.cumulKg / etat.volume.joursActifs : 0;

    avances.forEach(function (a) {
      etat.cash.avances += nb(a.montant);
      if (jour(a.date) === dateRef) etat.cash.avancesJour += nb(a.montant);
    });
    etat.cash.solde = etat.cash.avances - etat.cash.paye;

    /* -- 3.2 Agrégats par RT ---------------------------------------------- */
    var parRt = etat.rt;
    function ligneRt(k, nom, clusterNom) {
      if (!parRt[k]) {
        parRt[k] = {
          cle: k, nom: nom || "—", cluster: clusterNom || "", village: "",
          /* `enregistre` distingue une équipe du référentiel `rt` d'une équipe
             seulement DEVINÉE à partir d'un achat ou d'une avance. Sans cette
             distinction, un achat imputé à un identifiant inconnu ferait
             apparaître une équipe qui n'existe pas au référentiel — et le
             comptage « combien de RT » deviendrait faux sans prévenir. */
          enregistre: false,
          avances: 0, paye: 0, solde: 0, volumeKg: 0,
          volumeJourKg: 0, volumeSemaineKg: 0,
          achatsRefinancables: 0, montantRefinancable: 0, sansRecu: 0,
          aControler: 0, horsBareme: 0, montantSansRecu: 0,
          sacs: 0, recon: null, derniereAvance: "", dernierAchat: "", nbAchats: 0
        };
      }
      if (nom && parRt[k].nom === "—") parRt[k].nom = nom;
      if (clusterNom && !parRt[k].cluster) parRt[k].cluster = clusterNom;
      return parRt[k];
    }

    rts.forEach(function (r) {
      /* Dédoublonnage : `cleRt` retient l'identifiant serveur s'il existe, le
         nom normalisé sinon. Deux lignes `rt` portant le même identifiant ne
         créent donc qu'une seule équipe. */
      var l = ligneRt(cleRt(r.id, nomRt(r)), nomRt(r), clusterRt(r, villages));
      l.enregistre = true;
      if (!l.village) l.village = txt(r.village_nom);
    });
    achats.forEach(function (a) {
      var l = ligneRt(cleRt(a.rt_id, a.rt_nom), a.rt_nom, a.cluster);
      l.paye += nb(a.montant);
      l.volumeKg += nb(a.poids_net);
      l.nbAchats++;
      var d = jour(a.date);
      if (d === dateRef) l.volumeJourKg += nb(a.poids_net);
      if (debutSemaine && d && d >= debutSemaine && d <= dateRef) l.volumeSemaineKg += nb(a.poids_net);
      if (d && d > l.dernierAchat) l.dernierAchat = d;
      if (!l.village) l.village = txt(a.village_nom);
      if (a.refinancable === false || !a.numero_recu) {
        l.sansRecu++;
        l.montantSansRecu += nb(a.montant);
      } else { l.achatsRefinancables++; l.montantRefinancable += nb(a.montant); }
      if (a.qualite_statut && a.qualite_statut !== "OK") l.aControler++;
      if (a.statut_validation === "Validation BM requise") l.horsBareme++;
    });
    avances.forEach(function (a) {
      var l = ligneRt(cleRt(a.rt_id, a.rt_nom), a.rt_nom, a.cluster);
      l.avances += nb(a.montant);
      var d = jour(a.date);
      if (d && d > l.derniereAvance) l.derniereAvance = d;
    });

    /* Dernière réconciliation connue par RT. `recons` peut arriver dans
       n'importe quel ordre : on retient explicitement la plus récente. */
    recons.forEach(function (x) {
      var k = cleRt(x.rt_id, x.rt_nom);
      var l = ligneRt(k, x.rt_nom, x.cluster);
      var d = jour(x.date) || jour(x.created_at);
      if (!l.recon || d > (l.recon.jour || "")) {
        l.recon = {
          jour: d, statut: txt(x.statut), ecart: nb(x.ecart),
          cashRestant: nb(x.cash_restant), valeurStock: nb(x.valeur_stock)
        };
      }
    });

    Object.keys(parRt).forEach(function (k) {
      parRt[k].solde = parRt[k].avances - parRt[k].paye;
    });

    /* -- 3.3 Sacherie ------------------------------------------------------ */
    var sacRt = {}, sacClus = {}, sacProd = {};
    sacs.forEach(function (m) {
      var qn = nb(m.quantite);
      var rk = m.rt_id || cle(m.rt_nom);
      if (rk) {
        if (m.destination === "RT") sacRt[rk] = (sacRt[rk] || 0) + qn;
        if (m.source === "RT") sacRt[rk] = (sacRt[rk] || 0) - qn;
      }
      var ck = cle(m.cluster);
      if (ck && (m.source === "CLUSTER" || m.destination === "CLUSTER")) {
        if (m.destination === "CLUSTER") sacClus[ck] = (sacClus[ck] || 0) + qn;
        if (m.source === "CLUSTER") sacClus[ck] = (sacClus[ck] || 0) - qn;
      }
      var pk = m.producteur_id || cle(m.producteur_nom);
      if (pk && (m.source === "PRODUCTEUR" || m.destination === "PRODUCTEUR")) {
        if (m.destination === "PRODUCTEUR") sacProd[pk] = (sacProd[pk] || 0) + qn;
        if (m.source === "PRODUCTEUR") sacProd[pk] = (sacProd[pk] || 0) - qn;
      }
      if (m.type === "DECHIRE_RT" || m.type === "DECHIRE_PROD") etat.sacs.dechires += qn;
      if (m.type === "DISTRIBUTION") etat.sacs.distribues += qn;
    });
    Object.keys(sacRt).forEach(function (k) {
      etat.sacs.rtTotal += sacRt[k];
      if (sacRt[k] < 0) etat.sacs.negRt++;
      if (parRt[k]) parRt[k].sacs = sacRt[k];
    });
    Object.keys(sacClus).forEach(function (k) {
      etat.sacs.clusterTotal += sacClus[k];
      if (sacClus[k] < 0) etat.sacs.negCluster++;
    });
    Object.keys(sacProd).forEach(function (k) { if (sacProd[k] < 0) etat.sacs.negProd++; });

    /* -- 3.4 Villages ------------------------------------------------------ */
    var villagesAvecRt = {};
    rts.forEach(function (r) { villagesAvecRt[cle(r.village_nom)] = true; });
    var dernierAchatVillage = {};
    achats.forEach(function (a) {
      var k = cle(a.village_nom);
      if (!k) return;
      var d = jour(a.date);
      if (d && d > (dernierAchatVillage[k] || "")) dernierAchatVillage[k] = d;
    });
    var seuilInactif = REFERENTIEL.seuils.villageInactifJours;
    villages.forEach(function (v) {
      var k = cle(nomVillage(v));
      if (!villagesAvecRt[k]) etat.villages.sansRt++;
      if (!gpsVillage(v)) etat.villages.sansGps++;
      var d = dernierAchatVillage[k] || "";
      if (d) etat.villages.actifs++;
      var age = d ? ecartJours(d, dateRef) : null;
      if (!d || (age != null && age > seuilInactif)) {
        etat.villages.inactifs.push({
          nom: nomVillage(v), cluster: clusterVillage(v),
          dernierAchat: d, joursSansAchat: age
        });
      }
    });
    etat.villages.inactifs = trier(etat.villages.inactifs, function (x) {
      return x.joursSansAchat == null ? 1e9 : x.joursSansAchat;
    }, true);

    /* -- 3.5 Agrégats par cluster puis par zone ---------------------------- */
    var parCluster = etat.clusters;
    function ligneCluster(nomC) {
      var k = cle(nomC) || "HORSCLUSTER";
      if (!parCluster[k]) {
        parCluster[k] = {
          cle: k, label: libelleCluster(k) || txt(nomC).toUpperCase() || "Hors cluster",
          zone: zoneDuCluster(k),
          villages: 0, villagesActifs: 0,
          rt: 0, rtActifs: 0, volumeKg: 0, volumeMT: 0,
          volumeJourKg: 0, volumeSemaineKg: 0, avances: 0,
          paye: 0, solde: 0, sacs: sacClus[k] || 0, dernierAchat: "", nbAchats: 0,
          sansRecu: 0, montantSansRecu: 0, aControler: 0, horsBareme: 0,
          objectifMT: 0, pctObjectif: null, estAFLP: false
        };
      }
      return parCluster[k];
    }
    CLUSTERS_AFLP.forEach(function (c) { ligneCluster(c.cle); });
    villages.forEach(function (v) {
      var l = ligneCluster(clusterVillage(v));
      l.villages++;
      if (dernierAchatVillage[cle(nomVillage(v))]) l.villagesActifs++;
    });
    /* Le comptage des équipes par cluster passe par `parRt` et non par la liste
       brute : c'est la seule façon de dédoublonner deux lignes `rt` de même
       identifiant, et de ne compter que les équipes RÉELLEMENT enregistrées. */
    Object.keys(parRt).forEach(function (k) {
      if (parRt[k].enregistre) ligneCluster(parRt[k].cluster).rt++;
    });
    achats.forEach(function (a) {
      var l = ligneCluster(a.cluster);
      l.volumeKg += nb(a.poids_net);
      l.paye += nb(a.montant);
      l.nbAchats++;
      var d = jour(a.date);
      if (d === dateRef) l.volumeJourKg += nb(a.poids_net);
      if (debutSemaine && d && d >= debutSemaine && d <= dateRef) l.volumeSemaineKg += nb(a.poids_net);
      if (a.refinancable === false || !a.numero_recu) {
        l.sansRecu++;
        l.montantSansRecu += nb(a.montant);
      }
      if (a.qualite_statut && a.qualite_statut !== "OK") l.aControler++;
      if (a.statut_validation === "Validation BM requise") l.horsBareme++;
      if (d && d > l.dernierAchat) l.dernierAchat = d;
    });
    avances.forEach(function (a) { ligneCluster(a.cluster).avances += nb(a.montant); });
    Object.keys(parRt).forEach(function (k) {
      if (parRt[k].nbAchats > 0) ligneCluster(parRt[k].cluster).rtActifs++;
    });

    /* Quote-part indicative : l'objectif de 3 000 MT est réparti à parts égales
       entre les 6 clusters AFLP tant qu'aucun plan par cluster n'est fourni.
       C'est une référence de pilotage, pas un objectif contractuel. */
    var partCluster = CLUSTERS_AFLP.length ? REFERENTIEL.objectifMT / CLUSTERS_AFLP.length : 0;
    Object.keys(parCluster).forEach(function (k) {
      var c = parCluster[k];
      c.solde = c.avances - c.paye;
      c.volumeMT = c.volumeKg / 1000;
      c.estAFLP = CLUSTERS_AFLP.some(function (x) { return x.cle === k; });
      c.objectifMT = c.estAFLP ? partCluster : 0;
      c.pctObjectif = c.objectifMT ? (c.volumeMT / c.objectifMT) * 100 : null;
    });

    var parZone = etat.zones;
    Object.keys(parCluster).forEach(function (k) {
      var c = parCluster[k];
      if (!parZone[c.zone]) {
        parZone[c.zone] = {
          code: c.zone, clusters: [], villages: 0, villagesActifs: 0,
          rt: 0, rtActifs: 0, volumeKg: 0, volumeMT: 0,
          volumeJourKg: 0, volumeSemaineKg: 0, nbAchats: 0, sacs: 0,
          sansRecu: 0, montantSansRecu: 0, aControler: 0, horsBareme: 0,
          avances: 0, paye: 0, solde: 0, objectifMT: 0, pctObjectif: null,
          dernierAchat: ""
        };
      }
      var l = parZone[c.zone];
      l.clusters.push(c.label);
      l.villages += c.villages; l.villagesActifs += c.villagesActifs;
      l.rt += c.rt; l.rtActifs += c.rtActifs;
      l.volumeKg += c.volumeKg; l.avances += c.avances; l.paye += c.paye;
      l.volumeJourKg += c.volumeJourKg; l.volumeSemaineKg += c.volumeSemaineKg;
      l.nbAchats += c.nbAchats; l.sacs += c.sacs;
      l.sansRecu += c.sansRecu; l.montantSansRecu += c.montantSansRecu;
      l.aControler += c.aControler; l.horsBareme += c.horsBareme;
      l.objectifMT += c.objectifMT;
      if (c.dernierAchat && c.dernierAchat > l.dernierAchat) l.dernierAchat = c.dernierAchat;
    });
    Object.keys(parZone).forEach(function (z) {
      var l = parZone[z];
      l.solde = l.avances - l.paye;
      l.volumeMT = l.volumeKg / 1000;
      l.pctObjectif = l.objectifMT ? (l.volumeMT / l.objectifMT) * 100 : null;
    });

    /* -- 3.5 bis  Agrégats par village -------------------------------------
       Sans cet index, une question portant sur un village retombait sur son
       cluster : le chiffre était juste, mais pas celui qu'on demandait. */
    var parVillage = etat.villagesDetail;
    function ligneVillage(nomV, clusterV) {
      var k = cle(nomV);
      if (!k) return null;
      if (!parVillage[k]) {
        parVillage[k] = {
          cle: k, nom: txt(nomV), cluster: txt(clusterV || ""),
          zone: zoneDuCluster(clusterV || ""),
          rt: 0, rtActifs: 0, volumeKg: 0, volumeJourKg: 0, volumeSemaineKg: 0,
          nbAchats: 0, paye: 0, sansRecu: 0, montantSansRecu: 0, dernierAchat: ""
        };
      }
      if (clusterV && !parVillage[k].cluster) {
        parVillage[k].cluster = txt(clusterV);
        parVillage[k].zone = zoneDuCluster(clusterV);
      }
      return parVillage[k];
    }
    villages.forEach(function (v) { ligneVillage(nomVillage(v), clusterVillage(v)); });
    Object.keys(parRt).forEach(function (k) {
      var r = parRt[k];
      if (!r.village) return;
      var l = ligneVillage(r.village, r.cluster);
      if (!l) return;
      if (r.enregistre) l.rt++;
      if (r.nbAchats > 0) l.rtActifs++;
    });
    achats.forEach(function (a) {
      var l = ligneVillage(a.village_nom, a.cluster);
      if (!l) return;
      var d = jour(a.date);
      l.volumeKg += nb(a.poids_net);
      l.paye += nb(a.montant);
      l.nbAchats++;
      if (d === dateRef) l.volumeJourKg += nb(a.poids_net);
      if (debutSemaine && d && d >= debutSemaine && d <= dateRef) l.volumeSemaineKg += nb(a.poids_net);
      if (a.refinancable === false || !a.numero_recu) {
        l.sansRecu++;
        l.montantSansRecu += nb(a.montant);
      }
      if (d && d > l.dernierAchat) l.dernierAchat = d;
    });

    /* -- 3.6 Couverture du pilote ----------------------------------------- */
    var rtActifs = 0, rtEnregistrees = 0;
    Object.keys(parRt).forEach(function (k) {
      if (parRt[k].nbAchats > 0) rtActifs++;
      if (parRt[k].enregistre) rtEnregistrees++;
    });
    etat.couverture = {
      villages: villages.length, villagesCibles: REFERENTIEL.villagesCibles,
      villagesActifs: etat.villages.actifs,
      /* Équipes DISTINCTES du référentiel, pas lignes brutes : deux lignes de
         même identifiant sont la même équipe. */
      rt: rtEnregistrees, rtCibles: REFERENTIEL.equipesRtCibles, rtActifs: rtActifs,
      clustersAvecAchat: Object.keys(parCluster).filter(function (k) {
        return parCluster[k].estAFLP && parCluster[k].nbAchats > 0;
      }).length,
      clustersCibles: CLUSTERS_AFLP.length
    };

    etat.sources = [
      { table: "achats", lignes: achats.length },
      { table: "avances", lignes: avances.length },
      { table: "reconciliations", lignes: recons.length },
      { table: "sacs_mouvements", lignes: sacs.length },
      { table: "villages", lignes: villages.length },
      { table: "rt", lignes: rts.length }
    ];

    return etat;
  }

  /* ==========================================================================
     4. Refinancement — PAS DE RÉCONCILIATION = PAS DE REFINANCEMENT
     --------------------------------------------------------------------------
     Un RT est refinançable si et seulement si les quatre conditions suivantes
     sont réunies :
       R1. une réconciliation existe pour ce RT ;
       R2. son statut est « Réconcilié » ;
       R3. elle est postérieure ou égale à la dernière avance reçue
           (sinon elle ne couvre pas l'argent actuellement en circulation) ;
       R4. son écart est dans la tolérance (0 F par défaut).
     Le montant débloquable est la somme des achats refinançables du RT, soit
     les achats portant un reçu — les autres sont exclus par construction.
     ====================================================================== */

  function refinancement(etat) {
    var tol = Math.abs(nb(REFERENTIEL.seuils.toleranceEcartRecon));
    var parRT = [], parCluster = {};
    var bilan = {
      rtEvalues: 0, rtGo: 0, rtNoGo: 0,
      montantDebloquable: 0, montantBloque: 0,
      avancesCouvertes: 0, avancesNonCouvertes: 0,
      tauxCouverture: null, statut: "SANS OBJET"
    };

    Object.keys(etat.rt).forEach(function (k) {
      var r = etat.rt[k];
      /* Un RT sans avance ni achat n'a rien à refinancer : il n'entre pas dans
         le décompte, pour ne pas gonfler artificiellement le taux de blocage. */
      if (r.avances <= 0 && r.paye <= 0) return;

      var motifs = [];
      if (!r.recon) {
        motifs.push("Aucune réconciliation enregistrée");
      } else {
        if (r.recon.statut !== "Réconcilié") {
          motifs.push("Réconciliation au statut « " + (r.recon.statut || "inconnu") + " »");
        }
        if (r.derniereAvance && r.recon.jour && r.recon.jour < r.derniereAvance) {
          motifs.push("Réconciliation du " + r.recon.jour + " antérieure à l'avance du " + r.derniereAvance);
        }
        if (Math.abs(nb(r.recon.ecart)) > tol) {
          motifs.push("Écart de " + fmtF(r.recon.ecart) + " hors tolérance");
        }
      }
      if (r.solde < 0) {
        motifs.push("Dépassement de caisse : payé supérieur à l'avancé de " + fmtF(-r.solde));
      }
      var statut = motifs.length ? "NO-GO" : "GO";

      parRT.push({
        cle: k, nom: r.nom, cluster: r.cluster,
        zone: zoneDuCluster(r.cluster),
        statut: statut, motifs: motifs,
        avances: r.avances, paye: r.paye, solde: r.solde,
        montantRefinancable: r.montantRefinancable,
        sansRecu: r.sansRecu,
        derniereAvance: r.derniereAvance,
        reconJour: r.recon ? r.recon.jour : "",
        reconStatut: r.recon ? r.recon.statut : "",
        reconEcart: r.recon ? r.recon.ecart : null,
        ageAvanceJours: r.derniereAvance ? ecartJours(r.derniereAvance, etat.dateRef) : null
      });

      bilan.rtEvalues++;
      if (statut === "GO") {
        bilan.rtGo++;
        bilan.montantDebloquable += r.montantRefinancable;
        bilan.avancesCouvertes += r.avances;
      } else {
        bilan.rtNoGo++;
        bilan.montantBloque += r.montantRefinancable;
        bilan.avancesNonCouvertes += r.avances;
      }

      var ck = cle(r.cluster) || "HORSCLUSTER";
      if (!parCluster[ck]) {
        parCluster[ck] = {
          cle: ck, label: libelleCluster(ck) || txt(r.cluster).toUpperCase() || "Hors cluster",
          zone: zoneDuCluster(ck), rtGo: 0, rtNoGo: 0,
          montantDebloquable: 0, montantBloque: 0, bloquants: [], statut: "GO"
        };
      }
      var c = parCluster[ck];
      if (statut === "GO") { c.rtGo++; c.montantDebloquable += r.montantRefinancable; }
      else {
        c.rtNoGo++; c.montantBloque += r.montantRefinancable;
        c.bloquants.push(r.nom);
      }
    });

    Object.keys(parCluster).forEach(function (k) {
      var c = parCluster[k];
      c.statut = c.rtNoGo === 0 ? "GO" : (c.rtGo === 0 ? "NO-GO" : "PARTIEL");
    });

    bilan.tauxCouverture = bilan.rtEvalues ? (bilan.rtGo / bilan.rtEvalues) * 100 : null;
    bilan.statut = bilan.rtEvalues === 0 ? "SANS OBJET"
      : (bilan.rtNoGo === 0 ? "GO" : (bilan.rtGo === 0 ? "NO-GO" : "PARTIEL"));

    return {
      regle: "PAS DE RÉCONCILIATION = PAS DE REFINANCEMENT",
      dateRef: etat.dateRef,
      global: bilan,
      parCluster: trier(Object.keys(parCluster).map(function (k) { return parCluster[k]; }),
        function (x) { return x.montantBloque; }, true),
      parRT: parRT.sort(function (a, b) {
        if (a.statut !== b.statut) return a.statut === "NO-GO" ? -1 : 1;
        return nb(b.avances) - nb(a.avances);
      })
    };
  }

  /* ==========================================================================
     5. Alertes et anomalies
     --------------------------------------------------------------------------
     Chaque alerte porte un code stable, une sévérité, le chiffre qui la
     déclenche et le lien vers l'écran où la traiter. Une alerte sans compteur
     n'est pas produite : le BM ne doit voir que ce qui existe réellement.
     ====================================================================== */

  function alertes(etat, refi) {
    refi = refi || refinancement(etat);
    var s = REFERENTIEL.seuils;
    var out = [];

    function pousser(code, sev, titre, detail, valeur, lien, unite) {
      if (!valeur) return;
      out.push({
        code: code, severite: sev, titre: titre, detail: detail,
        valeur: valeur, unite: unite || "", lien: lien || ""
      });
    }

    /* -- Refinancement (le cœur de la règle AFLP) -------------------------- */
    pousser("AFLP-REFI-01", "critique",
      "RT bloqués pour refinancement",
      "Avance ouverte sans réconciliation valide — " + fmtF(refi.global.montantBloque) +
      " non débloquables tant que la réconciliation n'est pas faite.",
      refi.global.rtNoGo, "cash.html", "RT");

    var clustersBloques = refi.parCluster.filter(function (c) { return c.statut === "NO-GO"; });
    pousser("AFLP-REFI-02", "critique",
      "Clusters entièrement bloqués",
      "Aucun RT réconcilié dans : " + clustersBloques.map(function (c) { return c.label; }).join(", "),
      clustersBloques.length, "cash.html", "cluster(s)");

    var avancesAgees = refi.parRT.filter(function (r) {
      return r.statut === "NO-GO" && r.ageAvanceJours != null &&
        r.ageAvanceJours > s.avanceNonReconcilieeJours;
    });
    pousser("AFLP-REFI-03", "critique",
      "Avances ouvertes depuis plus de " + s.avanceNonReconcilieeJours + " jours",
      "Le délai de réconciliation AFLP est dépassé pour ces équipes.",
      avancesAgees.length, "cash.html", "RT");

    /* -- Caisse ------------------------------------------------------------ */
    var depassements = refi.parRT.filter(function (r) { return r.solde < 0; });
    pousser("AFLP-CASH-01", "critique",
      "RT en dépassement de caisse",
      "Montant payé aux producteurs supérieur à l'avance reçue : avance non saisie ou achat mal imputé.",
      depassements.length, "cash.html", "RT");

    var aControler = refi.parRT.filter(function (r) {
      return r.reconStatut && r.reconStatut !== "Réconcilié";
    });
    pousser("AFLP-CASH-02", "majeure",
      "Réconciliations à contrôler",
      "Réconciliation saisie mais non validée : elle n'ouvre pas le refinancement.",
      aControler.length, "cash.html", "RT");

    /* -- Traçabilité et qualité ------------------------------------------- */
    var partSansRecu = etat.qualite.lignes
      ? (etat.qualite.sansRecu / etat.qualite.lignes) * 100 : 0;
    pousser("AFLP-TRAC-01", "critique",
      "Achats sans reçu",
      "Non refinançables : " + fmtF(etat.qualite.montantSansRecu) + " (" +
      fmtPct(partSansRecu) + " des lignes)" +
      (partSansRecu > s.partSansRecuAlerte
        ? " — au-dessus du seuil de " + s.partSansRecuAlerte + " %." : "."),
      etat.qualite.sansRecu, "achats.html", "achat(s)");

    pousser("AFLP-QUAL-01", "majeure",
      "Achats qualité à contrôler",
      "Humidité, KOR ou rejet hors seuil selon le contrôle amont.",
      etat.qualite.aControler, "achats.html", "achat(s)");

    pousser("AFLP-QUAL-02", "majeure",
      "Achats prix hors barème",
      "Validation Branch Manager requise avant refinancement.",
      etat.qualite.horsBareme, "achats.html", "achat(s)");

    /* -- Sacherie ---------------------------------------------------------- */
    pousser("AFLP-SAC-01", "critique",
      "Soldes de sacs négatifs",
      "Sorties supérieures aux entrées : " + etat.sacs.negRt + " RT, " +
      etat.sacs.negCluster + " cluster(s), " + etat.sacs.negProd + " producteur(s).",
      etat.sacs.negRt + etat.sacs.negCluster + etat.sacs.negProd, "sacs.html", "solde(s)");

    /* -- Rythme et couverture ---------------------------------------------- */
    var clustersRetard = Object.keys(etat.clusters).map(function (k) { return etat.clusters[k]; })
      .filter(function (c) { return c.estAFLP && c.pctObjectif != null && c.pctObjectif < 50; });
    pousser("AFLP-PLAN-01", "majeure",
      "Clusters sous la moitié de leur quote-part",
      "Quote-part indicative de " + fmtNombre(REFERENTIEL.objectifMT / CLUSTERS_AFLP.length) +
      " MT par cluster : " + clustersRetard.map(function (c) { return c.label; }).join(", "),
      clustersRetard.length, "", "cluster(s)");

    pousser("AFLP-PLAN-02", "majeure",
      "Villages sans achat depuis plus de " + s.villageInactifJours + " jours",
      "Couverture terrain à relancer.",
      etat.villages.inactifs.length, "achats.html", "village(s)");

    pousser("AFLP-PLAN-03", "mineure",
      "Villages sans équipe RT",
      "Cible du pilote : " + REFERENTIEL.equipesRtCibles + " équipes sur " +
      REFERENTIEL.villagesCibles + " villages.",
      etat.villages.sansRt, "../fbms/index.html", "village(s)");

    pousser("AFLP-PLAN-04", "mineure",
      "Villages sans coordonnées GPS",
      "Distance non fiable pour l'audit logistique.",
      etat.villages.sansGps, "../fbms/audit_distances.html", "village(s)");

    /* -- Synchronisation --------------------------------------------------- */
    pousser("AFLP-SYNC-01", "critique",
      "Échecs de synchronisation",
      "Données terrain non remontées : la synthèse reste incomplète tant qu'ils subsistent.",
      etat.fileLocale.echecs, "", "opération(s)");

    pousser("AFLP-SYNC-02", "majeure",
      "Opérations locales en attente",
      "À synchroniser avant la clôture journalière.",
      etat.fileLocale.enAttente, "", "opération(s)");

    var rang = { critique: 0, majeure: 1, mineure: 2 };
    return out.sort(function (a, b) {
      return (rang[a.severite] - rang[b.severite]) || (nb(b.valeur) - nb(a.valeur));
    });
  }

  /* ==========================================================================
     6. Synthèse quotidienne
     --------------------------------------------------------------------------
     Rendu structuré, destiné à l'affichage comme à l'export texte. Le moteur
     produit les phrases : aucune interprétation n'est laissée à l'interface.
     ====================================================================== */

  function synthese(etat, refi, listeAlertes) {
    refi = refi || refinancement(etat);
    listeAlertes = listeAlertes || alertes(etat, refi);

    var v = etat.volume, c = etat.cash;
    var rythmeRequis = v.moyenneJourKg
      ? Math.ceil((v.resteMT * 1000) / v.moyenneJourKg) : null;

    var sections = [];

    sections.push({
      titre: "Volume",
      lignes: [
        { libelle: "Achat du jour", valeur: fmtNombre(v.jourKg) + " kg" },
        { libelle: "7 derniers jours", valeur: fmtMT(v.semaineKg) + " MT" },
        { libelle: "Cumul campagne", valeur: fmtMT(v.cumulKg) + " MT sur " + fmtNombre(etat.objectifMT) + " MT" },
        { libelle: "Avancement", valeur: fmtPct(v.pctObjectif) },
        { libelle: "Reste à collecter", valeur: fmtNombre(v.resteMT) + " MT" },
        { libelle: "Moyenne par jour actif", valeur: fmtNombre(v.moyenneJourKg) + " kg sur " + v.joursActifs + " jour(s)" }
      ],
      commentaire: rythmeRequis
        ? "Au rythme moyen constaté, il reste environ " + fmtNombre(rythmeRequis) +
          " jour(s) d'activité pour atteindre les " + fmtNombre(etat.objectifMT) + " MT."
        : "Pas encore assez d'historique pour projeter une date d'atteinte de l'objectif."
    });

    sections.push({
      titre: "Cash et avances RT",
      lignes: [
        { libelle: "Avances RT cumulées", valeur: fmtF(c.avances) },
        { libelle: "Avances du jour", valeur: fmtF(c.avancesJour) },
        { libelle: "Payé aux producteurs", valeur: fmtF(c.paye) },
        { libelle: "Solde théorique en circulation", valeur: fmtF(c.solde) },
        { libelle: "Commission RT provisionnée", valeur: fmtF(c.commission) }
      ],
      commentaire: c.solde < 0
        ? "Le montant payé dépasse les avances enregistrées : une avance n'a pas été saisie, ou un achat est imputé au mauvais RT."
        : "Le solde correspond à l'argent confié aux équipes et non encore justifié par un achat."
    });

    sections.push({
      titre: "Réconciliation et refinancement",
      lignes: [
        { libelle: "Statut global", valeur: refi.global.statut },
        { libelle: "RT réconciliés", valeur: refi.global.rtGo + " / " + refi.global.rtEvalues +
          (refi.global.tauxCouverture != null ? " (" + fmtPct(refi.global.tauxCouverture) + ")" : "") },
        { libelle: "Montant débloquable", valeur: fmtF(refi.global.montantDebloquable) },
        { libelle: "Montant bloqué", valeur: fmtF(refi.global.montantBloque) },
        { libelle: "Avances non couvertes", valeur: fmtF(refi.global.avancesNonCouvertes) }
      ],
      commentaire: refi.global.rtNoGo
        ? "Règle AFLP appliquée : " + refi.global.rtNoGo +
          " équipe(s) ne peuvent pas être refinancées tant que leur réconciliation n'est pas validée."
        : "Toutes les équipes disposant d'une avance sont réconciliées : le refinancement peut être engagé."
    });

    sections.push({
      titre: "Sacherie",
      lignes: [
        { libelle: "Sacs en main RT", valeur: fmtNombre(etat.sacs.rtTotal) },
        { libelle: "Sacs en cluster", valeur: fmtNombre(etat.sacs.clusterTotal) },
        { libelle: "Distribués aux producteurs", valeur: fmtNombre(etat.sacs.distribues) },
        { libelle: "Déchirés / pertes", valeur: fmtNombre(etat.sacs.dechires) },
        { libelle: "Soldes négatifs", valeur: (etat.sacs.negRt + etat.sacs.negCluster + etat.sacs.negProd) +
          " (RT " + etat.sacs.negRt + " · cluster " + etat.sacs.negCluster + " · producteur " + etat.sacs.negProd + ")" }
      ],
      commentaire: (etat.sacs.negRt + etat.sacs.negCluster + etat.sacs.negProd)
        ? "Un solde négatif signale une sortie non couverte par une entrée : mouvement manquant ou double comptage."
        : "Aucun solde négatif : les mouvements de sacs sont cohérents."
    });

    sections.push({
      titre: "Qualité et traçabilité",
      lignes: [
        { libelle: "Lignes d'achat", valeur: fmtNombre(etat.qualite.lignes) },
        { libelle: "Sans reçu (non refinançables)", valeur: fmtNombre(etat.qualite.sansRecu) + " · " + fmtF(etat.qualite.montantSansRecu) },
        { libelle: "Qualité à contrôler", valeur: fmtNombre(etat.qualite.aControler) },
        { libelle: "Prix hors barème", valeur: fmtNombre(etat.qualite.horsBareme) }
      ],
      commentaire: etat.qualite.sansRecu
        ? "Chaque achat sans reçu est retiré de l'assiette de refinancement, quel que soit son montant."
        : "Tous les achats enregistrés portent un reçu."
    });

    sections.push({
      titre: "Couverture du pilote",
      lignes: [
        { libelle: "Villages", valeur: fmtNombre(etat.couverture.villages) + " référencés · " +
          fmtNombre(etat.couverture.villagesActifs) + " actifs · cible " + etat.couverture.villagesCibles },
        { libelle: "Équipes RT", valeur: fmtNombre(etat.couverture.rt) + " référencées · " +
          fmtNombre(etat.couverture.rtActifs) + " actives · cible " + etat.couverture.rtCibles },
        { libelle: "Clusters avec achat", valeur: etat.couverture.clustersAvecAchat + " / " + etat.couverture.clustersCibles },
        { libelle: "Villages en sommeil", valeur: fmtNombre(etat.villages.inactifs.length) }
      ],
      commentaire: etat.referentiel.zonesConfirmees
        ? "Répartition des clusters par zone confirmée."
        : "Répartition GBEKE 1 / GBEKE 2 encore à confirmer par le Branch Manager : les totaux par zone sont indicatifs."
    });

    /* Décisions du jour : les trois alertes les plus graves, formulées en
       actions. Une synthèse qui ne débouche pas sur une décision n'a pas
       d'utilité pour le BM. */
    var decisions = listeAlertes.slice(0, 3).map(function (a) {
      return {
        severite: a.severite,
        action: a.titre + " — " + fmtNombre(a.valeur) + " " + a.unite,
        pourquoi: a.detail,
        lien: a.lien
      };
    });
    if (!decisions.length) {
      decisions.push({
        severite: "mineure",
        action: "Aucune anomalie détectée",
        pourquoi: "Volume, caisse, réconciliation, sacherie et qualité sont cohérents à la date du " + etat.dateRef + ".",
        lien: ""
      });
    }

    var enTete = "Synthèse " + etat.campagne + " — " + etat.dateRef +
      " · " + fmtMT(v.cumulKg) + " MT cumulés (" + fmtPct(v.pctObjectif) + " de l'objectif) · " +
      refi.global.rtNoGo + " RT bloqué(s) pour refinancement";

    return {
      dateRef: etat.dateRef,
      campagne: etat.campagne,
      enTete: enTete,
      sections: sections,
      decisions: decisions,
      clusters: trier(Object.keys(etat.clusters).map(function (k) { return etat.clusters[k]; })
        .filter(function (c) { return c.estAFLP || c.nbAchats > 0 || c.avances > 0; }),
        function (c) { return c.volumeKg; }, true),
      zones: Object.keys(etat.zones).map(function (z) { return etat.zones[z]; }),
      sources: etat.sources
    };
  }

  /* Version texte brut de la synthèse — destinée au copier-coller dans un
     rapport ou un message. Aucune donnée nominative de producteur n'y figure. */
  function syntheseTexte(syn) {
    var l = [];
    l.push(syn.enTete);
    l.push("");
    syn.sections.forEach(function (s) {
      l.push("## " + s.titre);
      s.lignes.forEach(function (x) { l.push("- " + x.libelle + " : " + x.valeur); });
      if (s.commentaire) l.push("  -> " + s.commentaire);
      l.push("");
    });
    l.push("## Décisions du jour");
    syn.decisions.forEach(function (d, i) {
      l.push((i + 1) + ". [" + d.severite + "] " + d.action);
      if (d.pourquoi) l.push("   " + d.pourquoi);
    });
    l.push("");
    l.push("## Par cluster");
    syn.clusters.forEach(function (c) {
      l.push("- " + c.label + " (" + c.zone + ") : " + fmtMT(c.volumeKg) + " MT" +
        (c.pctObjectif != null ? " · " + fmtPct(c.pctObjectif) + " de la quote-part" : "") +
        " · avances " + fmtF(c.avances) + " · solde " + fmtF(c.solde));
    });
    l.push("");
    l.push("Source : FBMS · " + syn.sources.map(function (s) {
      return s.table + " (" + s.lignes + ")";
    }).join(" · "));
    return l.join("\n");
  }

  /* ==========================================================================
     7. Questions en langage naturel
     --------------------------------------------------------------------------
     Trois responsabilités, strictement séparées :

       COMPRENDRE  shared/aflp-ia-comprehension.js produit un CONTRAT validé
                   contre un schéma fermé. Il ne voit aucun chiffre.
       CALCULER    le registre `FONCTIONS` ci-dessous. Chaque intention publiée
                   du catalogue désigne l'une de ces fonctions par son nom, et
                   AUCUNE autre ne peut être appelée depuis un contrat.
       RÉPONDRE    les phrases sont construites ici, à partir des chiffres
                   calculés ici. Ni le catalogue ni la couche linguistique
                   n'écrivent jamais un chiffre.

     Ce que le moteur ne fait jamais : deviner un chiffre absent, répondre sur
     une portée qu'on ne lui a pas demandée, ou produire une phrase sans source.
     Quand il ne sait pas, il le dit.
     ====================================================================== */

  function comprehension() {
    if (global.AFLP_IA_COMPREHENSION) return global.AFLP_IA_COMPREHENSION;
    if (typeof require === "function") return require("./aflp-ia-comprehension.js");
    return null;
  }

  function catalogue() {
    if (global.AFLP_IA_CATALOGUE) return global.AFLP_IA_CATALOGUE;
    if (typeof require === "function") return require("./aflp-ia-catalogue.js");
    return null;
  }

  /* --------------------------------------------------------------------------
     7.1  Contexte de compréhension
     --------------------------------------------------------------------------
     Uniquement des NOMS : zones, clusters, villages, équipes. Aucun montant,
     aucun volume, aucun solde. La couche de compréhension — déterministe
     aujourd'hui, éventuellement linguistique demain — n'a besoin que de cela
     pour situer une question, et ne doit rien recevoir de plus.
     ------------------------------------------------------------------------ */

  function contexteComprehension(etat) {
    var ctx = { zones: [], clusters: [], villages: [], rt: [] };
    if (!etat) return ctx;
    ctx.zones = Object.keys(etat.zones || {}).filter(function (z) {
      return z && z !== "Hors périmètre AFLP";
    });
    Object.keys(etat.clusters || {}).forEach(function (k) {
      var c = etat.clusters[k];
      if (c && c.label && c.label !== "Hors cluster") ctx.clusters.push({ cle: c.cle, label: c.label });
    });
    Object.keys(etat.villagesDetail || {}).forEach(function (k) {
      var v = etat.villagesDetail[k];
      if (v && v.nom) ctx.villages.push({ nom: v.nom, cluster: v.cluster });
    });
    Object.keys(etat.rt || {}).forEach(function (k) {
      var r = etat.rt[k];
      if (r && r.nom && r.nom !== "—") ctx.rt.push({ cle: r.cle, nom: r.nom });
    });
    return ctx;
  }

  /* --------------------------------------------------------------------------
     7.2  Périmètre — l'agrégat correspondant à la portée du contrat
     --------------------------------------------------------------------------
     Une seule forme, quelle que soit la portée. Les fonctions de calcul n'ont
     ainsi pas à savoir si elles travaillent sur une zone ou sur un village :
     elles ne peuvent donc pas se tromper de champ selon le cas.
     ------------------------------------------------------------------------ */

  function perimetreVide(type, label, libelle, court) {
    return {
      type: type, label: label, libelle: libelle, court: court, existe: false,
      volumeKg: 0, volumeJourKg: 0, volumeSemaineKg: 0,
      avances: 0, paye: 0, solde: 0, objectifMT: 0, pctObjectif: null,
      villages: 0, villagesActifs: 0, rt: 0, rtActifs: 0, rtObservees: 0,
      sacs: 0, nbAchats: 0, sansRecu: 0, montantSansRecu: 0,
      aControler: 0, horsBareme: 0, dernierAchat: "", derniereAvance: "", recon: null
    };
  }

  function perimetre(etat, scope) {
    var type = (scope && scope.type) || "global";

    if (type === "zone") {
      var z = etat.zones[scope.id];
      var pz = perimetreVide("zone", scope.label, "la zone " + scope.label, "La zone " + scope.label);
      if (!z) return pz;
      pz.existe = true;
      pz.volumeKg = nb(z.volumeKg); pz.volumeJourKg = nb(z.volumeJourKg);
      pz.volumeSemaineKg = nb(z.volumeSemaineKg);
      pz.avances = nb(z.avances); pz.paye = nb(z.paye); pz.solde = nb(z.solde);
      pz.objectifMT = nb(z.objectifMT); pz.pctObjectif = z.pctObjectif;
      pz.villages = nb(z.villages); pz.villagesActifs = nb(z.villagesActifs);
      pz.rt = nb(z.rt); pz.rtActifs = nb(z.rtActifs);
      pz.sacs = nb(z.sacs); pz.nbAchats = nb(z.nbAchats);
      pz.sansRecu = nb(z.sansRecu); pz.montantSansRecu = nb(z.montantSansRecu);
      pz.aControler = nb(z.aControler); pz.horsBareme = nb(z.horsBareme);
      pz.dernierAchat = txt(z.dernierAchat);
      return pz;
    }

    if (type === "cluster") {
      var c = etat.clusters[scope.id];
      var pc = perimetreVide("cluster", scope.label, "le cluster de " + scope.label,
        "Le cluster de " + scope.label);
      if (!c) return pc;
      pc.existe = true;
      pc.volumeKg = nb(c.volumeKg); pc.volumeJourKg = nb(c.volumeJourKg);
      pc.volumeSemaineKg = nb(c.volumeSemaineKg);
      pc.avances = nb(c.avances); pc.paye = nb(c.paye); pc.solde = nb(c.solde);
      pc.objectifMT = nb(c.objectifMT); pc.pctObjectif = c.pctObjectif;
      pc.villages = nb(c.villages); pc.villagesActifs = nb(c.villagesActifs);
      pc.rt = nb(c.rt); pc.rtActifs = nb(c.rtActifs);
      pc.sacs = nb(c.sacs); pc.nbAchats = nb(c.nbAchats);
      pc.sansRecu = nb(c.sansRecu); pc.montantSansRecu = nb(c.montantSansRecu);
      pc.aControler = nb(c.aControler); pc.horsBareme = nb(c.horsBareme);
      pc.dernierAchat = txt(c.dernierAchat);
      return pc;
    }

    if (type === "village") {
      var v = etat.villagesDetail[cle(scope.id)] || etat.villagesDetail[cle(scope.label)];
      var pv = perimetreVide("village", scope.label, "le village de " + scope.label,
        "Le village de " + scope.label);
      if (!v) return pv;
      pv.existe = true;
      pv.volumeKg = nb(v.volumeKg); pv.volumeJourKg = nb(v.volumeJourKg);
      pv.volumeSemaineKg = nb(v.volumeSemaineKg);
      pv.paye = nb(v.paye); pv.villages = 1; pv.villagesActifs = v.nbAchats > 0 ? 1 : 0;
      pv.rt = nb(v.rt); pv.rtActifs = nb(v.rtActifs);
      pv.nbAchats = nb(v.nbAchats);
      pv.sansRecu = nb(v.sansRecu); pv.montantSansRecu = nb(v.montantSansRecu);
      pv.dernierAchat = txt(v.dernierAchat);
      return pv;
    }

    if (type === "rt") {
      var r = etat.rt[scope.id];
      var pr = perimetreVide("rt", scope.label, "l'équipe " + scope.label, "L'équipe " + scope.label);
      if (!r) return pr;
      pr.existe = true;
      pr.volumeKg = nb(r.volumeKg); pr.volumeJourKg = nb(r.volumeJourKg);
      pr.volumeSemaineKg = nb(r.volumeSemaineKg);
      pr.avances = nb(r.avances); pr.paye = nb(r.paye); pr.solde = nb(r.solde);
      pr.rt = r.enregistre ? 1 : 0; pr.rtActifs = r.nbAchats > 0 ? 1 : 0;
      pr.rtObservees = r.enregistre ? 0 : 1;
      pr.sacs = nb(r.sacs); pr.nbAchats = nb(r.nbAchats);
      pr.sansRecu = nb(r.sansRecu); pr.montantSansRecu = nb(r.montantSansRecu);
      pr.aControler = nb(r.aControler); pr.horsBareme = nb(r.horsBareme);
      pr.dernierAchat = txt(r.dernierAchat); pr.derniereAvance = txt(r.derniereAvance);
      pr.recon = r.recon;
      return pr;
    }

    var pg = perimetreVide("global", "AFLP 2027", "l'ensemble du pilote", "Le pilote AFLP 2027");
    pg.existe = true;
    pg.volumeKg = etat.volume.cumulKg;
    pg.volumeJourKg = etat.volume.jourKg;
    pg.volumeSemaineKg = etat.volume.semaineKg;
    pg.avances = etat.cash.avances; pg.paye = etat.cash.paye; pg.solde = etat.cash.solde;
    pg.objectifMT = etat.objectifMT; pg.pctObjectif = etat.volume.pctObjectif;
    pg.villages = etat.couverture.villages; pg.villagesActifs = etat.couverture.villagesActifs;
    pg.rt = etat.couverture.rt; pg.rtActifs = etat.couverture.rtActifs;
    pg.sacs = etat.sacs.rtTotal; pg.nbAchats = etat.qualite.lignes;
    pg.sansRecu = etat.qualite.sansRecu; pg.montantSansRecu = etat.qualite.montantSansRecu;
    pg.aControler = etat.qualite.aControler; pg.horsBareme = etat.qualite.horsBareme;
    pg.dernierAchat = etat.volume.dernierJour;
    return pg;
  }

  /* Équipes RT du périmètre demandé, dédoublonnées. Une seule définition, faute
     de quoi le comptage et la liste divergeraient. */
  function equipesDuPerimetre(etat, scope) {
    var type = (scope && scope.type) || "global";
    var out = [];
    Object.keys(etat.rt).forEach(function (k) {
      var r = etat.rt[k];
      if (type === "cluster" && cle(r.cluster) !== scope.id) return;
      if (type === "zone" && zoneDuCluster(r.cluster) !== scope.id) return;
      if (type === "village" && cle(r.village) !== cle(scope.id)) return;
      if (type === "rt" && r.cle !== scope.id) return;
      out.push(r);
    });
    return out;
  }

  function reponse(texte, chiffres, sources, confiance, suggestions) {
    return {
      texte: texte,
      chiffres: chiffres || [],
      sources: sources || [],
      confiance: confiance || "haute",
      suggestions: suggestions || []
    };
  }

  var QUESTIONS_TYPES = [
    "Combien de RT avons-nous à Béoumi ?",
    "Où en est le volume par rapport aux 3 000 MT ?",
    "Quels RT sont bloqués pour refinancement ?",
    "Quel est le solde de caisse de GBEKE 1 ?",
    "Quels villages n'ont rien acheté depuis 7 jours ?",
    "Quels sont les clusters les plus avancés ?",
    "Que dois-je traiter en priorité aujourd'hui ?"
  ];

  /* Source unique, apposée à toute réponse. Une réponse sans source n'est pas
     une réponse : c'est une opinion. */
  function sourcesDe(etat) {
    return ["FBMS · données arrêtées au " + etat.dateRef];
  }

  /* --------------------------------------------------------------------------
     7.3  Registre des fonctions déterministes
     --------------------------------------------------------------------------
     Une intention du catalogue ne peut désigner qu'une clé de cet objet. Toute
     autre valeur est refusée par `repondre` : c'est ce qui garantit qu'aucun
     contrat — d'où qu'il vienne — ne peut déclencher autre chose qu'un calcul
     de lecture prévu ici.
     ------------------------------------------------------------------------ */

  var FONCTIONS = {

    /* ---- Couverture : équipes RT ---------------------------------------- */
    couvertureRt: function (ctx) {
      var etat = ctx.etat, per = ctx.per, code = ctx.contrat.intent;
      var equipes = equipesDuPerimetre(etat, ctx.contrat.scope);
      var enregistrees = equipes.filter(function (r) { return r.enregistre; });
      var actives = equipes.filter(function (r) { return r.nbAchats > 0; });
      var observees = equipes.filter(function (r) { return !r.enregistre; });
      var nE = enregistrees.length, nA = actives.length;
      var dateLongue = fmtDateLongue(etat.dateRef);
      var chiffres = [
        { libelle: "Équipes RT enregistrées", valeur: fmtNombre(nE) },
        { libelle: "Équipes RT actives", valeur: fmtNombre(nA) }
      ];

      /* Ventilation demandée : le détail remplace la phrase unique. */
      var vent = ctx.contrat.filters && ctx.contrat.filters.breakdown;
      if (vent === "cluster" || vent === "zone") {
        var lignes = [];
        if (vent === "cluster") {
          Object.keys(etat.clusters).forEach(function (k) {
            var c = etat.clusters[k];
            if (!c.estAFLP && !c.rt) return;
            lignes.push({ nom: c.label, enr: c.rt, act: c.rtActifs });
          });
        } else {
          Object.keys(etat.zones).forEach(function (z) {
            lignes.push({ nom: z, enr: etat.zones[z].rt, act: etat.zones[z].rtActifs });
          });
        }
        var totalE = lignes.reduce(function (s, x) { return s + nb(x.enr); }, 0);
        return reponse(
          "Équipes RT par " + (vent === "cluster" ? "cluster" : "zone") + " au " + dateLongue + " :\n" +
          lignes.map(function (x) {
            return "· " + x.nom + " — " + fmtNombre(x.enr) + " " +
              pluriel(x.enr, "équipe") + " " + pluriel(x.enr, "enregistrée") +
              ", dont " + fmtNombre(x.act) + " " + pluriel(x.act, "active");
          }).join("\n") +
          "\nTotal : " + fmtNombre(totalE) + " " + pluriel(totalE, "équipe") + " RT.",
          lignes.map(function (x) {
            return { libelle: x.nom, valeur: fmtNombre(x.enr) + " RT" };
          }), ctx.src);
      }

      /* Liste nominative. */
      if (code === "coverage_rt_list") {
        if (!enregistrees.length) {
          return reponse(
            per.court + " ne compte aucune équipe RT enregistrée. Données FBMS " +
            "arrêtées au " + dateLongue + ".", chiffres, ctx.src);
        }
        var noms = enregistrees.slice(0, 30).map(function (r) {
          return "· " + r.nom + " (" + (r.cluster || "cluster non renseigné") + ") — " +
            (r.nbAchats > 0
              ? fmtNombre(r.nbAchats) + " " + pluriel(r.nbAchats, "achat") + " enregistré" +
                (r.nbAchats >= 2 ? "s" : "")
              : "aucun achat enregistré");
        }).join("\n");
        return reponse(
          per.court + " compte " + fmtNombre(nE) + " " + pluriel(nE, "équipe") + " RT " +
          pluriel(nE, "enregistrée") + " :\n" + noms +
          (enregistrees.length > 30 ? "\n(+" + (enregistrees.length - 30) + " autres)" : "") +
          "\nDonnées FBMS arrêtées au " + dateLongue + ".",
          chiffres, ctx.src);
      }

      /* Comptage des équipes actives. */
      if (code === "coverage_rt_active_count") {
        return reponse(
          per.court + " compte " + fmtNombre(nA) + " " + pluriel(nA, "équipe") + " RT " +
          pluriel(nA, "active") + " sur " + fmtNombre(nE) + " " + pluriel(nE, "enregistrée") +
          ". Une équipe est dite active dès qu'elle a enregistré au moins un achat sur la " +
          "campagne. Données FBMS arrêtées au " + dateLongue + ".",
          chiffres, ctx.src);
      }

      /* Comptage par défaut : les équipes ENREGISTRÉES. C'est la lecture du
         référentiel AFLP, où « RT » désigne une équipe. */
      var phrase = per.court + " compte " + fmtNombre(nE) + " " + pluriel(nE, "équipe") +
        " RT " + pluriel(nE, "enregistrée") + ". Données FBMS arrêtées au " + dateLongue + ".";
      phrase += " " + fmtNombre(nA) + " " + pluriel(nA, "équipe") + " " +
        pluriel(nA, "a", "ont") + " enregistré au moins un achat sur la campagne.";
      if (observees.length) {
        phrase += " " + fmtNombre(observees.length) + " " + pluriel(observees.length, "équipe") +
          " " + pluriel(observees.length, "apparaît", "apparaissent") +
          " dans les achats sans figurer au référentiel des équipes : " +
          pluriel(observees.length, "elle n'est", "elles ne sont") + " pas " +
          pluriel(observees.length, "comptée") + " ci-dessus.";
      }
      if (per.type === "global") {
        phrase += " Cible du pilote : " + etat.couverture.rtCibles + " équipes.";
        chiffres.push({ libelle: "Cible du pilote", valeur: String(etat.couverture.rtCibles) });
      }
      return reponse(phrase, chiffres, ctx.src);
    },

    /* ---- Couverture : villages ------------------------------------------ */
    couvertureVillages: function (ctx) {
      var etat = ctx.etat, per = ctx.per;
      var vent = ctx.contrat.filters && ctx.contrat.filters.breakdown;
      if (vent === "cluster" || vent === "zone") {
        var lignes = [];
        if (vent === "cluster") {
          Object.keys(etat.clusters).forEach(function (k) {
            var c = etat.clusters[k];
            if (!c.estAFLP && !c.villages) return;
            lignes.push({ nom: c.label, total: c.villages, actifs: c.villagesActifs });
          });
        } else {
          Object.keys(etat.zones).forEach(function (z) {
            lignes.push({ nom: z, total: etat.zones[z].villages, actifs: etat.zones[z].villagesActifs });
          });
        }
        return reponse(
          "Villages par " + vent + " au " + fmtDateLongue(etat.dateRef) + " :\n" +
          lignes.map(function (x) {
            return "· " + x.nom + " — " + fmtNombre(x.total) + " " + pluriel(x.total, "village") +
              ", dont " + fmtNombre(x.actifs) + " " + pluriel(x.actifs, "actif");
          }).join("\n"),
          lignes.map(function (x) { return { libelle: x.nom, valeur: fmtNombre(x.total) }; }),
          ctx.src);
      }
      var phrase = per.court + " compte " + fmtNombre(per.villages) + " " +
        pluriel(per.villages, "village") + " " + pluriel(per.villages, "référencé") + ", dont " +
        fmtNombre(per.villagesActifs) + " " + pluriel(per.villagesActifs, "actif") +
        " (au moins un achat enregistré).";
      if (per.type === "global") {
        phrase += " Cible du pilote : " + etat.couverture.villagesCibles + " villages.";
      }
      phrase += " Données FBMS arrêtées au " + fmtDateLongue(etat.dateRef) + ".";
      return reponse(phrase, [
        { libelle: "Villages référencés", valeur: fmtNombre(per.villages) },
        { libelle: "Villages actifs", valeur: fmtNombre(per.villagesActifs) }
      ], ctx.src);
    },

    villagesInactifs: function (ctx) {
      var etat = ctx.etat, scope = ctx.contrat.scope;
      var liste = etat.villages.inactifs.filter(function (v) {
        if (scope.type === "cluster") return cle(v.cluster) === scope.id;
        if (scope.type === "zone") return zoneDuCluster(v.cluster) === scope.id;
        return true;
      });
      var seuil = REFERENTIEL.seuils.villageInactifJours;
      if (!liste.length) {
        return reponse(
          "Aucun village " + (ctx.per.type === "global" ? "" : "de " + ctx.per.label + " ") +
          "n'est sans achat depuis plus de " + seuil + " jours au " +
          fmtDateLongue(etat.dateRef) + ".",
          [{ libelle: "Villages en sommeil", valeur: "0" }], ctx.src);
      }
      var detail = liste.slice(0, 12).map(function (v) {
        return "· " + (v.nom || "village sans nom") + " (" + (v.cluster || "cluster non renseigné") +
          ") — " + (v.dernierAchat
            ? v.joursSansAchat + " " + pluriel(v.joursSansAchat, "jour") + " sans achat"
            : "aucun achat enregistré");
      }).join("\n");
      return reponse(
        fmtNombre(liste.length) + " " + pluriel(liste.length, "village") + " " +
        pluriel(liste.length, "est", "sont") + " sans achat depuis plus de " + seuil +
        " jours pour " + ctx.per.libelle + " au " + fmtDateLongue(etat.dateRef) + " :\n" + detail +
        (liste.length > 12 ? "\n(+" + (liste.length - 12) + " autres)" : ""),
        [{ libelle: "Villages en sommeil", valeur: fmtNombre(liste.length) }], ctx.src);
    },

    /* ---- Volume ---------------------------------------------------------- */
    volumePortee: function (ctx) {
      var per = ctx.per, periode = ctx.contrat.period;
      var kg = periode === "day" ? per.volumeJourKg
        : periode === "week" ? per.volumeSemaineKg : per.volumeKg;
      var libPeriode = periode === "day" ? "à la date du " + fmtDateLongue(ctx.etat.dateRef)
        : periode === "week" ? "sur les 7 derniers jours"
        : "en cumul campagne";
      var ch = [{ libelle: "Volume " + (periode === "day" ? "du jour" : periode === "week" ? "7 jours" : "cumulé"),
        valeur: fmtMT(kg) + " MT (" + fmtNombre(kg) + " kg)" }];
      var phrase = "Pour " + per.libelle + ", le volume net acheté " + libPeriode + " est de " +
        fmtMT(kg) + " MT, soit " + fmtNombre(kg) + " kg.";
      if (periode === "campaign" && per.objectifMT) {
        ch.push({ libelle: "Quote-part objectif", valeur: fmtNombre(per.objectifMT) + " MT" });
        ch.push({ libelle: "Avancement", valeur: fmtPct(per.pctObjectif) });
        phrase += " Cela représente " + fmtPct(per.pctObjectif) + " d'une quote-part de " +
          fmtNombre(per.objectifMT) + " MT" + (per.type === "cluster" ? " (répartition indicative)" : "") + ".";
      }
      phrase += " Données FBMS arrêtées au " + fmtDateLongue(ctx.etat.dateRef) + ".";
      return reponse(phrase, ch, ctx.src);
    },

    volumeVentile: function (ctx) {
      var etat = ctx.etat, periode = ctx.contrat.period;
      var vent = (ctx.contrat.filters && ctx.contrat.filters.breakdown) || "cluster";
      var champ = periode === "day" ? "volumeJourKg" : periode === "week" ? "volumeSemaineKg" : "volumeKg";
      var lignes = [];
      if (vent === "zone") {
        Object.keys(etat.zones).forEach(function (z) {
          lignes.push({ nom: z, kg: nb(etat.zones[z][champ]) });
        });
      } else if (vent === "village") {
        Object.keys(etat.villagesDetail).forEach(function (k) {
          var v = etat.villagesDetail[k];
          if (v.nbAchats > 0) lignes.push({ nom: v.nom + " (" + (v.cluster || "—") + ")", kg: nb(v[champ]) });
        });
        lignes = trier(lignes, function (x) { return x.kg; }, true).slice(0, 20);
      } else if (vent === "rt") {
        Object.keys(etat.rt).forEach(function (k) {
          var r = etat.rt[k];
          if (r.nbAchats > 0) lignes.push({ nom: r.nom, kg: nb(r[champ]) });
        });
        lignes = trier(lignes, function (x) { return x.kg; }, true).slice(0, 20);
      } else {
        Object.keys(etat.clusters).forEach(function (k) {
          var c = etat.clusters[k];
          if (!c.estAFLP && !c.nbAchats) return;
          lignes.push({ nom: c.label, kg: nb(c[champ]) });
        });
      }
      if (!lignes.length) {
        return reponse("Aucun volume à ventiler par " + vent + " dans les données chargées au " +
          fmtDateLongue(etat.dateRef) + ".", [], ctx.src);
      }
      var total = lignes.reduce(function (s, x) { return s + x.kg; }, 0);
      return reponse(
        "Volume net acheté par " + vent + " au " + fmtDateLongue(etat.dateRef) + " :\n" +
        lignes.map(function (x) { return "· " + x.nom + " — " + fmtMT(x.kg) + " MT"; }).join("\n") +
        "\nTotal : " + fmtMT(total) + " MT.",
        lignes.map(function (x) { return { libelle: x.nom, valeur: fmtMT(x.kg) + " MT" }; }),
        ctx.src);
    },

    avancementObjectif: function (ctx) {
      var per = ctx.per, etat = ctx.etat;
      if (!per.objectifMT) {
        return reponse(
          "Aucun objectif n'est défini pour " + per.libelle + " : FBMS ne répartit " +
          "l'objectif AFLP qu'entre les six clusters du pilote et leurs deux zones. " +
          "Le volume collecté y est de " + fmtMT(per.volumeKg) + " MT au " +
          fmtDateLongue(etat.dateRef) + ".",
          [{ libelle: "Collecté", valeur: fmtMT(per.volumeKg) + " MT" }], ctx.src, "moyenne");
      }
      var reste = Math.max(0, per.objectifMT - per.volumeKg / 1000);
      var jours = etat.volume.moyenneJourKg
        ? Math.ceil((reste * 1000) / etat.volume.moyenneJourKg) : null;
      var indicatif = per.type === "cluster" || per.type === "zone"
        ? " La quote-part par " + per.type + " est une répartition indicative de l'objectif " +
          "global de " + fmtNombre(etat.objectifMT) + " MT, pas un objectif contractuel." : "";
      return reponse(
        "Pour " + per.libelle + " : " + fmtMT(per.volumeKg) + " MT collectés sur " +
        fmtNombre(per.objectifMT) + " MT, soit " + fmtPct(per.pctObjectif) + ". Reste " +
        fmtNombre(reste) + " MT" +
        (jours ? ", environ " + fmtNombre(jours) + " " + pluriel(jours, "jour") +
          " d'activité au rythme moyen constaté de " + fmtNombre(etat.volume.moyenneJourKg) +
          " kg par jour actif." : ".") + indicatif +
        " Données FBMS arrêtées au " + fmtDateLongue(etat.dateRef) + ".",
        [
          { libelle: "Collecté", valeur: fmtMT(per.volumeKg) + " MT" },
          { libelle: "Objectif", valeur: fmtNombre(per.objectifMT) + " MT" },
          { libelle: "Avancement", valeur: fmtPct(per.pctObjectif) },
          { libelle: "Reste", valeur: fmtNombre(reste) + " MT" }
        ], ctx.src);
    },

    classementClusters: function (ctx) {
      var etat = ctx.etat;
      var pire = /\b(pire|pires|dernier|derniers|faible|faibles|mauvais|retard|moins)\b/
        .test(ctx.normalise);
      var cls = Object.keys(etat.clusters).map(function (k) { return etat.clusters[k]; })
        .filter(function (c) {
          if (ctx.contrat.scope.type === "zone" && c.zone !== ctx.contrat.scope.id) return false;
          return c.estAFLP || c.nbAchats > 0;
        });
      if (!cls.length) return reponse("Aucun cluster à classer dans les données chargées.", [], ctx.src);
      cls = trier(cls, function (c) { return c.volumeKg; }, !pire).slice(0, 6);
      return reponse(
        (pire ? "Clusters les moins avancés" : "Clusters les plus avancés") + " au " +
        fmtDateLongue(etat.dateRef) + " :\n" +
        cls.map(function (c, i) {
          return (i + 1) + ". " + c.label + " (" + c.zone + ") — " + fmtMT(c.volumeKg) + " MT" +
            (c.pctObjectif != null ? " · " + fmtPct(c.pctObjectif) + " de la quote-part indicative" : "");
        }).join("\n"),
        cls.map(function (c) { return { libelle: c.label, valeur: fmtMT(c.volumeKg) + " MT" }; }),
        ctx.src);
    },

    /* ---- Achats ---------------------------------------------------------- */
    compteurAchats: function (ctx) {
      var per = ctx.per;
      return reponse(
        "Pour " + per.libelle + ", FBMS a enregistré " + fmtNombre(per.nbAchats) + " " +
        pluriel(per.nbAchats, "ligne") + " d'achat au " + fmtDateLongue(ctx.etat.dateRef) +
        ". Une ligne d'achat n'est pas un producteur : deux achats du même producteur " +
        "comptent pour deux.",
        [{ libelle: "Lignes d'achat", valeur: fmtNombre(per.nbAchats) }], ctx.src);
    },

    dernierAchat: function (ctx) {
      var per = ctx.per;
      if (!per.dernierAchat) {
        return reponse(
          "Aucun achat n'est enregistré pour " + per.libelle + " dans les données chargées au " +
          fmtDateLongue(ctx.etat.dateRef) + ".",
          [{ libelle: "Dernier achat", valeur: "aucun" }], ctx.src);
      }
      var age = ecartJours(per.dernierAchat, ctx.etat.dateRef);
      return reponse(
        "Le dernier achat enregistré pour " + per.libelle + " date du " +
        fmtDateLongue(per.dernierAchat) +
        (age != null ? ", soit " + (age === 0 ? "le jour même de la date de référence"
          : "il y a " + fmtNombre(age) + " " + pluriel(age, "jour")) : "") +
        ". Données FBMS arrêtées au " + fmtDateLongue(ctx.etat.dateRef) + ".",
        [
          { libelle: "Dernier achat", valeur: per.dernierAchat },
          { libelle: "Ancienneté", valeur: age != null ? fmtNombre(age) + " j" : "—" }
        ], ctx.src);
    },

    /* ---- Caisse ---------------------------------------------------------- */
    caissePortee: function (ctx) {
      var per = ctx.per, code = ctx.contrat.intent, etat = ctx.etat;
      var ch = [
        { libelle: "Avances RT", valeur: fmtF(per.avances) },
        { libelle: "Payé producteurs", valeur: fmtF(per.paye) },
        { libelle: "Solde en circulation", valeur: fmtF(per.solde) }
      ];
      if (code === "cash_advances") {
        var jourTxt = per.type === "global" && ctx.contrat.period === "day"
          ? " Dont " + fmtF(etat.cash.avancesJour) + " versés à la date de référence." : "";
        return reponse(
          "Pour " + per.libelle + ", " + fmtF(per.avances) + " ont été avancés aux équipes RT." +
          jourTxt + " Données FBMS arrêtées au " + fmtDateLongue(etat.dateRef) + ".", ch, ctx.src);
      }
      if (code === "cash_paid") {
        return reponse(
          "Pour " + per.libelle + ", " + fmtF(per.paye) + " ont été payés aux producteurs sur " +
          fmtNombre(per.nbAchats) + " " + pluriel(per.nbAchats, "ligne") + " d'achat. " +
          "Données FBMS arrêtées au " + fmtDateLongue(etat.dateRef) + ".", ch, ctx.src);
      }
      var alerte = per.solde < 0
        ? " Ce solde est NÉGATIF : le montant payé dépasse les avances enregistrées. " +
          "Ce n'est pas un excédent — c'est une avance non saisie, ou un achat imputé à la " +
          "mauvaise équipe."
        : " Ce solde est l'argent confié aux équipes et non encore justifié par un achat.";
      return reponse(
        "Pour " + per.libelle + ", le solde théorique en circulation est de " + fmtF(per.solde) +
        " : " + fmtF(per.avances) + " avancés moins " + fmtF(per.paye) + " payés aux producteurs." +
        alerte + " Données FBMS arrêtées au " + fmtDateLongue(etat.dateRef) + ".", ch, ctx.src);
    },

    expositionOuverte: function (ctx) {
      var lignes = ctx.refi.parRT.filter(function (x) { return filtrerRefi(x, ctx.contrat.scope); });
      var ouverts = lignes.filter(function (x) { return x.statut === "NO-GO"; });
      var montant = ouverts.reduce(function (s, x) { return s + nb(x.avances); }, 0);
      var couvert = lignes.filter(function (x) { return x.statut === "GO"; })
        .reduce(function (s, x) { return s + nb(x.avances); }, 0);
      return reponse(
        "Pour " + ctx.per.libelle + ", " + fmtF(montant) + " d'avances ne sont pas couvertes par " +
        "une réconciliation valide, portées par " + fmtNombre(ouverts.length) + " " +
        pluriel(ouverts.length, "équipe") + " sur " + fmtNombre(lignes.length) + ". " +
        fmtF(couvert) + " sont couverts. Données FBMS arrêtées au " +
        fmtDateLongue(ctx.etat.dateRef) + ".",
        [
          { libelle: "Exposition ouverte", valeur: fmtF(montant) },
          { libelle: "Avances couvertes", valeur: fmtF(couvert) },
          { libelle: "Équipes exposées", valeur: fmtNombre(ouverts.length) + " / " + fmtNombre(lignes.length) }
        ], ctx.src);
    },

    /* ---- Réconciliation --------------------------------------------------- */
    etatReconciliation: function (ctx) {
      if (ctx.contrat.scope.type === "rt") {
        var r = ctx.etat.rt[ctx.contrat.scope.id] || {};
        if (!r.recon) {
          return reponse(
            "L'équipe " + ctx.contrat.scope.label + " n'a aucune réconciliation enregistrée. " +
            "Avec " + fmtF(r.avances) + " d'avance ouverte, elle ne peut pas être refinancée. " +
            "Données FBMS arrêtées au " + fmtDateLongue(ctx.etat.dateRef) + ".",
            [{ libelle: "Avance ouverte", valeur: fmtF(r.avances) }], ctx.src);
        }
        return reponse(
          "Dernière réconciliation de " + ctx.contrat.scope.label + " : " +
          (r.recon.jour ? fmtDateLongue(r.recon.jour) : "date inconnue") + ", statut « " +
          r.recon.statut + " », écart " + fmtF(r.recon.ecart) + ". Données FBMS arrêtées au " +
          fmtDateLongue(ctx.etat.dateRef) + ".",
          [
            { libelle: "Statut", valeur: r.recon.statut || "—" },
            { libelle: "Écart", valeur: fmtF(r.recon.ecart) },
            { libelle: "Dernière avance", valeur: r.derniereAvance || "—" }
          ], ctx.src);
      }
      var champ = ctx.refi.parRT.filter(function (x) { return filtrerRefi(x, ctx.contrat.scope); });
      var nonRec = champ.filter(function (x) { return x.statut === "NO-GO"; });
      var rec = champ.length - nonRec.length;
      return reponse(
        "Sur " + ctx.per.libelle + " : " + fmtNombre(rec) + " " + pluriel(rec, "équipe") + " " +
        pluriel(rec, "réconciliée") + " sur " + fmtNombre(champ.length) + " portant une avance " +
        "ou un achat. " + fmtNombre(nonRec.length) + " " + pluriel(nonRec.length, "reste", "restent") +
        " à réconcilier. Données FBMS arrêtées au " + fmtDateLongue(ctx.etat.dateRef) + ".",
        [
          { libelle: "Réconciliées", valeur: fmtNombre(rec) },
          { libelle: "À réconcilier", valeur: fmtNombre(nonRec.length) }
        ], ctx.src);
    },

    rtNonReconcilies: function (ctx) {
      var champ = ctx.refi.parRT.filter(function (x) { return filtrerRefi(x, ctx.contrat.scope); });
      var nonRec = champ.filter(function (x) { return x.statut === "NO-GO"; });
      if (!nonRec.length) {
        return reponse(
          "Toutes les équipes de " + ctx.per.libelle + " disposant d'une avance sont " +
          "réconciliées au " + fmtDateLongue(ctx.etat.dateRef) + ".",
          [{ libelle: "À réconcilier", valeur: "0" }], ctx.src);
      }
      return reponse(
        fmtNombre(nonRec.length) + " " + pluriel(nonRec.length, "équipe") + " " +
        pluriel(nonRec.length, "reste", "restent") + " à réconcilier sur " + ctx.per.libelle + " :\n" +
        nonRec.slice(0, 12).map(function (x) {
          return "· " + x.nom + " (" + (x.cluster || "cluster non renseigné") + ") — " + x.motifs[0];
        }).join("\n") +
        (nonRec.length > 12 ? "\n(+" + (nonRec.length - 12) + " autres)" : "") +
        "\nDonnées FBMS arrêtées au " + fmtDateLongue(ctx.etat.dateRef) + ".",
        [{ libelle: "À réconcilier", valeur: fmtNombre(nonRec.length) + " / " + fmtNombre(champ.length) }],
        ctx.src);
    },

    /* ---- Refinancement ---------------------------------------------------- */
    refinancementPortee: function (ctx) {
      var code = ctx.contrat.intent;
      var lignes = ctx.refi.parRT.filter(function (x) { return filtrerRefi(x, ctx.contrat.scope); });
      var bloques = lignes.filter(function (x) { return x.statut === "NO-GO"; });
      var libres = lignes.filter(function (x) { return x.statut === "GO"; });
      var mBloque = bloques.reduce(function (s, x) { return s + nb(x.montantRefinancable); }, 0);
      var mLibre = libres.reduce(function (s, x) { return s + nb(x.montantRefinancable); }, 0);
      var regle = "Règle AFLP : pas de réconciliation = pas de refinancement.";
      var ch = [
        { libelle: "Débloquable", valeur: fmtF(mLibre) },
        { libelle: "Bloqué", valeur: fmtF(mBloque) },
        { libelle: "Équipes bloquées", valeur: fmtNombre(bloques.length) + " / " + fmtNombre(lignes.length) }
      ];
      var dateTxt = " Données FBMS arrêtées au " + fmtDateLongue(ctx.etat.dateRef) + ".";

      if (code === "refinancing_eligible_rt") {
        if (!libres.length) {
          return reponse(regle + "\nAucune équipe de " + ctx.per.libelle + " n'est éligible au " +
            "refinancement : " + fmtNombre(lignes.length) + " " + pluriel(lignes.length, "équipe") +
            " " + pluriel(lignes.length, "évaluée") + ", toutes bloquées." + dateTxt, ch, ctx.src);
        }
        return reponse(regle + "\n" + fmtNombre(libres.length) + " " + pluriel(libres.length, "équipe") +
          " sur " + fmtNombre(lignes.length) + " " + pluriel(libres.length, "est", "sont") +
          " éligible" + (libres.length >= 2 ? "s" : "") + " au refinancement pour " +
          ctx.per.libelle + ", soit " + fmtF(mLibre) + " débloquables :\n" +
          libres.slice(0, 12).map(function (x) {
            return "· " + x.nom + " (" + (x.cluster || "cluster non renseigné") + ") — " +
              fmtF(x.montantRefinancable);
          }).join("\n") + dateTxt, ch, ctx.src);
      }

      if (code === "refinancing_amount") {
        return reponse(regle + "\nPour " + ctx.per.libelle + " : " + fmtF(mLibre) +
          " sont débloquables immédiatement et " + fmtF(mBloque) + " sont bloqués. " +
          "Un achat sans reçu n'entre dans aucune de ces deux assiettes : " +
          fmtNombre(ctx.per.sansRecu) + " " + pluriel(ctx.per.sansRecu, "achat") +
          " dans ce cas, pour " + fmtF(ctx.per.montantSansRecu) + "." + dateTxt, ch, ctx.src);
      }

      if (!bloques.length) {
        return reponse(regle + "\nAucune équipe n'est bloquée pour " + ctx.per.libelle + " : les " +
          fmtNombre(lignes.length) + " " + pluriel(lignes.length, "équipe") + " portant une avance " +
          "sont réconciliées." + dateTxt, ch, ctx.src);
      }
      return reponse(
        regle + "\nSur " + ctx.per.libelle + ", " + fmtNombre(bloques.length) + " " +
        pluriel(bloques.length, "équipe") + " sur " + fmtNombre(lignes.length) + " " +
        pluriel(bloques.length, "est", "sont") + " bloquée" + (bloques.length >= 2 ? "s" : "") +
        ", soit " + fmtF(mBloque) + " non débloquables. " + fmtF(mLibre) +
        " peuvent être refinancés immédiatement.\n" +
        bloques.slice(0, 12).map(function (x) {
          return "· " + x.nom + " (" + (x.cluster || "cluster non renseigné") + ") — " + x.motifs[0];
        }).join("\n") +
        (bloques.length > 12 ? "\n(+" + (bloques.length - 12) + " autres)" : "") + dateTxt,
        ch, ctx.src);
    },

    /* ---- Sacherie --------------------------------------------------------- */
    sacsPortee: function (ctx) {
      var etat = ctx.etat, per = ctx.per;
      if (per.type === "global") {
        return reponse(
          "Sacherie au " + fmtDateLongue(etat.dateRef) + " : " + fmtNombre(etat.sacs.rtTotal) +
          " sacs en main des équipes RT, " + fmtNombre(etat.sacs.clusterTotal) + " en cluster, " +
          fmtNombre(etat.sacs.distribues) + " distribués aux producteurs, " +
          fmtNombre(etat.sacs.dechires) + " déchirés ou perdus.",
          [
            { libelle: "En main RT", valeur: fmtNombre(etat.sacs.rtTotal) },
            { libelle: "En cluster", valeur: fmtNombre(etat.sacs.clusterTotal) },
            { libelle: "Distribués", valeur: fmtNombre(etat.sacs.distribues) },
            { libelle: "Déchirés", valeur: fmtNombre(etat.sacs.dechires) }
          ], ctx.src);
      }
      return reponse(
        "Le solde de sacs de " + per.libelle + " est de " + fmtNombre(per.sacs) + " " +
        pluriel(per.sacs, "sac") + "." +
        (per.sacs < 0 ? " Solde NÉGATIF : une entrée de sacs manque à la saisie." : "") +
        " Données FBMS arrêtées au " + fmtDateLongue(etat.dateRef) + ".",
        [{ libelle: "Solde sacs", valeur: fmtNombre(per.sacs) }], ctx.src);
    },

    sacsNegatifs: function (ctx) {
      var s = ctx.etat.sacs, total = s.negRt + s.negCluster + s.negProd;
      if (!total) {
        return reponse(
          "Aucun solde de sacs négatif au " + fmtDateLongue(ctx.etat.dateRef) +
          " : les mouvements de sacherie sont cohérents.",
          [{ libelle: "Soldes négatifs", valeur: "0" }], ctx.src);
      }
      return reponse(
        fmtNombre(total) + " " + pluriel(total, "solde") + " de sacs " + pluriel(total, "est", "sont") +
        " négatif" + (total >= 2 ? "s" : "") + " au " + fmtDateLongue(ctx.etat.dateRef) + " : " +
        s.negRt + " côté équipes RT, " + s.negCluster + " côté clusters, " + s.negProd +
        " côté producteurs. Un solde négatif est une anomalie de saisie — sortie non couverte " +
        "par une entrée, ou double comptage — jamais un stock.",
        [
          { libelle: "Équipes RT", valeur: String(s.negRt) },
          { libelle: "Clusters", valeur: String(s.negCluster) },
          { libelle: "Producteurs", valeur: String(s.negProd) }
        ], ctx.src);
    },

    /* ---- Qualité et traçabilité -------------------------------------------- */
    qualitePortee: function (ctx) {
      var per = ctx.per, code = ctx.contrat.intent;
      var part = per.nbAchats ? (per.sansRecu / per.nbAchats) * 100 : 0;
      if (code === "quality_missing_receipts") {
        return reponse(
          "Pour " + per.libelle + " : " + fmtNombre(per.sansRecu) + " " +
          pluriel(per.sansRecu, "achat") + " sans reçu sur " + fmtNombre(per.nbAchats) + " " +
          pluriel(per.nbAchats, "ligne") + " (" + fmtPct(part) + "), pour " +
          fmtF(per.montantSansRecu) + ". Un achat sans reçu est retiré de l'assiette de " +
          "refinancement, quel que soit son montant. Données FBMS arrêtées au " +
          fmtDateLongue(ctx.etat.dateRef) + ".",
          [
            { libelle: "Achats sans reçu", valeur: fmtNombre(per.sansRecu) },
            { libelle: "Montant concerné", valeur: fmtF(per.montantSansRecu) },
            { libelle: "Part des lignes", valeur: fmtPct(part) }
          ], ctx.src);
      }
      return reponse(
        "Pour " + per.libelle + " : " + fmtNombre(per.aControler) + " " +
        pluriel(per.aControler, "achat") + " en contrôle qualité (humidité, KOR ou rejet hors " +
        "seuil du contrôle amont) et " + fmtNombre(per.horsBareme) + " " +
        pluriel(per.horsBareme, "achat") + " hors barème de prix, en attente de validation du " +
        "Branch Manager. Les seuils sont ceux du contrôle amont : l'assistant les lit, il ne " +
        "les redéfinit pas. Données FBMS arrêtées au " + fmtDateLongue(ctx.etat.dateRef) + ".",
        [
          { libelle: "Qualité à contrôler", valeur: fmtNombre(per.aControler) },
          { libelle: "Hors barème", valeur: fmtNombre(per.horsBareme) }
        ], ctx.src);
    },

    /* ---- Pilotage ---------------------------------------------------------- */
    alertesPrioritaires: function (ctx) {
      if (!ctx.alertes.length) {
        return reponse(
          "Aucune anomalie détectée au " + fmtDateLongue(ctx.etat.dateRef) +
          " sur les contrôles disponibles. Il n'y a donc rien à traiter en priorité.",
          [], ctx.src);
      }
      var top = ctx.alertes.slice(0, 5);
      return reponse(
        "À traiter en priorité au " + fmtDateLongue(ctx.etat.dateRef) + " :\n" +
        top.map(function (a, i) {
          return (i + 1) + ". [" + a.severite + "] " + a.titre + " — " + fmtNombre(a.valeur) +
            " " + a.unite + ". " + a.detail;
        }).join("\n"),
        top.map(function (a) {
          return { libelle: a.titre, valeur: fmtNombre(a.valeur) + " " + a.unite };
        }), ctx.src);
    },

    syntheseJour: function (ctx) {
      var syn = synthese(ctx.etat, ctx.refi, ctx.alertes);
      return reponse(
        syn.enTete + "\n\n" + syn.decisions.map(function (d, i) {
          return (i + 1) + ". " + d.action + " — " + d.pourquoi;
        }).join("\n"),
        [
          { libelle: "Cumul", valeur: fmtMT(ctx.etat.volume.cumulKg) + " MT" },
          { libelle: "Avancement", valeur: fmtPct(ctx.etat.volume.pctObjectif) },
          { libelle: "Équipes bloquées", valeur: String(ctx.refi.global.rtNoGo) }
        ], ctx.src);
    }
  };

  /* Filtre commun aux fonctions qui travaillent sur `refi.parRT`. Écrit une
     seule fois : deux filtres divergents donneraient deux réponses différentes
     à la même question selon l'intention détectée. */
  function filtrerRefi(x, scope) {
    if (!scope || scope.type === "global") return true;
    if (scope.type === "cluster") return cle(x.cluster) === scope.id;
    if (scope.type === "zone") return x.zone === scope.id;
    if (scope.type === "rt") return x.cle === scope.id;
    return true;
  }

  /* --------------------------------------------------------------------------
     7.4  Répondre
     ------------------------------------------------------------------------ */

  /* Traduit la confiance numérique du contrat en niveau affichable. Les seuils
     sont exposés pour que l'interface et les métriques emploient les mêmes. */
  var SEUILS_CONFIANCE = { haute: 0.8, moyenne: 0.6, faible: 0.3 };

  function niveauConfiance(c) {
    if (!c) return "nulle";
    if (c >= SEUILS_CONFIANCE.haute) return "haute";
    if (c >= SEUILS_CONFIANCE.moyenne) return "moyenne";
    if (c >= SEUILS_CONFIANCE.faible) return "faible";
    return "nulle";
  }

  /* Point d'entrée unique.

     `contratImpose` permet à un appelant — et à lui seul, la couche linguistique
     étant elle-même serveur — de fournir un contrat déjà construit. Il est
     REVALIDÉ ici contre le même schéma fermé : un contrat venu d'ailleurs n'a
     aucun privilège. */
  function repondre(question, etat, refi, listeAlertes, contratImpose) {
    var CO = comprehension(), CAT = catalogue();
    var src = sourcesDe(etat);

    if (!CO || !CAT) {
      /* Sans catalogue ni couche de compréhension, le moteur ne devine pas :
         il le dit. Ce cas se produit si une page charge le moteur seul. */
      return enrichir(reponse(
        "L'assistant n'est pas complètement chargé : le catalogue des intentions " +
        "est absent de cette page. Rechargez la page.", [], src, "nulle", QUESTIONS_TYPES),
        null, null, etat);
    }

    refi = refi || refinancement(etat);
    listeAlertes = listeAlertes || alertes(etat, refi);

    var lu;
    if (contratImpose) {
      var erreurs = CO.valider(contratImpose);
      if (erreurs.length) {
        return enrichir(reponse(
          "Interprétation refusée : " + erreurs[0] + ". L'assistant ne répond que sur un " +
          "contrat conforme au catalogue publié.", [], src, "nulle", QUESTIONS_TYPES),
          { contrat: contratImpose, trace: { motif: "contrat externe refusé" }, erreurs: erreurs },
          null);
      }
      lu = { contrat: contratImpose, trace: { motif: "contrat fourni par l'appelant" }, erreurs: [] };
    } else {
      lu = CO.comprendre(question, contexteComprehension(etat));
    }

    var contrat = lu.contrat;
    var intention = contrat.intent ? CAT.parCode(contrat.intent) : null;

    /* -- Aucune intention : refus explicite -------------------------------- */
    if (!intention) {
      var texte = contrat.clarification_question || CO.questionHorsPerimetre;
      return enrichir(reponse(texte, [], src, "nulle", QUESTIONS_TYPES), lu, null, etat);
    }

    /* -- Clarification demandée -------------------------------------------- */
    if (contrat.requires_clarification) {
      return enrichir(reponse(
        contrat.clarification_question, [], src,
        niveauConfiance(contrat.confidence), QUESTIONS_TYPES), lu, intention, etat);
    }

    /* -- Donnée absente : refus qui NOMME ce qui manque -------------------- */
    if (intention.statut === "non_disponible") {
      return enrichir(reponse(
        "FBMS ne dispose pas de cette information : " + intention.donneeManquante + ". " +
        "Je préfère le dire plutôt que produire un chiffre voisin — le nombre d'ÉQUIPES RT " +
        "n'est pas le nombre de personnes qui les composent. Données FBMS arrêtées au " +
        fmtDateLongue(etat.dateRef) + ".",
        [], src, niveauConfiance(contrat.confidence), QUESTIONS_TYPES), lu, intention, etat);
    }

    /* -- La fonction déterministe doit exister dans le registre ------------ */
    var fn = Object.prototype.hasOwnProperty.call(FONCTIONS, intention.fonction)
      ? FONCTIONS[intention.fonction] : null;
    if (typeof fn !== "function") {
      return enrichir(reponse(
        "L'intention « " + intention.nom + " » est publiée mais sa fonction de calcul « " +
        intention.fonction + " » n'existe pas dans le moteur. Aucune réponse n'est produite : " +
        "un chiffre inventé serait pire qu'une absence de réponse.",
        [], src, "nulle", QUESTIONS_TYPES), lu, intention, etat);
    }

    var ctx = {
      etat: etat, refi: refi, alertes: listeAlertes, contrat: contrat,
      intention: intention, per: perimetre(etat, contrat.scope), src: src,
      normalise: (lu.trace && lu.trace.normalise) || CO.normaliser(question || "")
    };

    /* Portée nommée mais introuvable dans les données chargées : on le dit. */
    if (!ctx.per.existe) {
      return enrichir(reponse(
        "Aucune donnée n'est chargée pour " + ctx.per.libelle + ". La question est comprise, " +
        "mais FBMS n'a rien à agréger sur ce périmètre au " + fmtDateLongue(etat.dateRef) + ".",
        [], src, "faible", QUESTIONS_TYPES), lu, intention, etat);
    }

    var rep;
    try {
      rep = fn(ctx);
    } catch (e) {
      return enrichir(reponse(
        "Le calcul a échoué sur les données chargées. Aucun chiffre n'est produit.",
        [], src, "nulle", QUESTIONS_TYPES), lu, intention, etat);
    }
    if (!rep.confiance || rep.confiance === "haute") rep.confiance = niveauConfiance(contrat.confidence);
    return enrichir(rep, lu, intention, etat);
  }

  /* Attache au résultat la trace de compréhension. C'est elle qui est
     journalisée : sans elle, on mesure la satisfaction, jamais la
     compréhension. Aucun chiffre métier n'y figure. */
  function enrichir(rep, lu, intention, etat) {
    rep.contrat = lu ? lu.contrat : null;
    rep.trace = lu ? lu.trace : null;
    rep.intention = intention ? {
      code: intention.code, nom: intention.nom, statut: intention.statut,
      fonction: intention.fonction
    } : null;
    rep.confianceNum = lu && lu.contrat ? lu.contrat.confidence : 0;
    rep.versionCatalogue = catalogue() ? catalogue().version : null;
    rep.versionMoteur = VERSION;
    rep.dateReference = etat ? etat.dateRef : null;
    return rep;
  }

  /* ==========================================================================
     8. Interface publique
     ====================================================================== */

  var API = {
    version: VERSION,
    CLUSTERS_AFLP: CLUSTERS_AFLP,
    referentiel: referentiel,
    appliquerParametres: appliquerParametres,
    zoneDuCluster: zoneDuCluster,
    construireEtat: construireEtat,
    refinancement: refinancement,
    alertes: alertes,
    synthese: synthese,
    syntheseTexte: syntheseTexte,
    repondre: repondre,
    questionsTypes: QUESTIONS_TYPES,
    /* Exposés pour la couche linguistique et pour les contrôles automatisés.
       `contexteComprehension` est volontairement le SEUL point par lequel des
       noms de lieux sortent du moteur : il ne laisse passer aucun chiffre. */
    contexteComprehension: contexteComprehension,
    perimetre: perimetre,
    niveauConfiance: niveauConfiance,
    seuilsConfiance: SEUILS_CONFIANCE,
    /* Liste blanche des calculs atteignables depuis un contrat. Le banc d'essai
       vérifie qu'aucune intention publiée ne désigne autre chose, et qu'aucune
       de ces fonctions ne mute quoi que ce soit. */
    fonctionsDisponibles: Object.keys(FONCTIONS),
    /* Utilitaires exposés pour que l'interface formate exactement comme le
       moteur, sans redéfinir ses propres arrondis. */
    format: {
      nombre: fmtNombre, mt: fmtMT, francs: fmtF, pourcent: fmtPct,
      jour: jour, cle: cle, dateLongue: fmtDateLongue, pluriel: pluriel
    }
  };

  global.AFLP_IA = API;
  if (typeof module === "object" && module.exports) module.exports = API;

})(typeof window !== "undefined" ? window : this);
