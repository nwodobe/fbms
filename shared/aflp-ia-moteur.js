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
      "GBEKE 1": ["Djébonoua", "Brobo", "Diabo"],
      "GBEKE 2": ["Sakassou", "Béoumi", "Botro"]
    },
    /* Confirmée par le Branch Manager le 2026-08-14 : les totaux par zone ne
       sont plus indicatifs. Repasser à `false` si le découpage redevient
       incertain — le bandeau d'avertissement réapparaîtra de lui-même. */
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
          cle: k, nom: nom || "—", cluster: clusterNom || "",
          avances: 0, paye: 0, solde: 0, volumeKg: 0,
          achatsRefinancables: 0, montantRefinancable: 0, sansRecu: 0,
          sacs: 0, recon: null, derniereAvance: "", dernierAchat: "", nbAchats: 0
        };
      }
      if (nom && parRt[k].nom === "—") parRt[k].nom = nom;
      if (clusterNom && !parRt[k].cluster) parRt[k].cluster = clusterNom;
      return parRt[k];
    }

    rts.forEach(function (r) {
      ligneRt(cleRt(r.id, nomRt(r)), nomRt(r), clusterRt(r, villages));
    });
    achats.forEach(function (a) {
      var l = ligneRt(cleRt(a.rt_id, a.rt_nom), a.rt_nom, a.cluster);
      l.paye += nb(a.montant);
      l.volumeKg += nb(a.poids_net);
      l.nbAchats++;
      var d = jour(a.date);
      if (d && d > l.dernierAchat) l.dernierAchat = d;
      if (a.refinancable === false || !a.numero_recu) l.sansRecu++;
      else { l.achatsRefinancables++; l.montantRefinancable += nb(a.montant); }
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
          villages: 0, rt: 0, rtActifs: 0, volumeKg: 0, volumeMT: 0, avances: 0,
          paye: 0, solde: 0, sacs: sacClus[k] || 0, dernierAchat: "", nbAchats: 0,
          sansRecu: 0, objectifMT: 0, pctObjectif: null, estAFLP: false
        };
      }
      return parCluster[k];
    }
    CLUSTERS_AFLP.forEach(function (c) { ligneCluster(c.cle); });
    villages.forEach(function (v) { ligneCluster(clusterVillage(v)).villages++; });
    rts.forEach(function (r) { ligneCluster(clusterRt(r, villages)).rt++; });
    achats.forEach(function (a) {
      var l = ligneCluster(a.cluster);
      l.volumeKg += nb(a.poids_net);
      l.paye += nb(a.montant);
      l.nbAchats++;
      if (a.refinancable === false || !a.numero_recu) l.sansRecu++;
      var d = jour(a.date);
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
          code: c.zone, clusters: [], villages: 0, rt: 0, volumeKg: 0, volumeMT: 0,
          avances: 0, paye: 0, solde: 0, objectifMT: 0, pctObjectif: null
        };
      }
      var l = parZone[c.zone];
      l.clusters.push(c.label);
      l.villages += c.villages; l.rt += c.rt;
      l.volumeKg += c.volumeKg; l.avances += c.avances; l.paye += c.paye;
      l.objectifMT += c.objectifMT;
    });
    Object.keys(parZone).forEach(function (z) {
      var l = parZone[z];
      l.solde = l.avances - l.paye;
      l.volumeMT = l.volumeKg / 1000;
      l.pctObjectif = l.objectifMT ? (l.volumeMT / l.objectifMT) * 100 : null;
    });

    /* -- 3.6 Couverture du pilote ----------------------------------------- */
    var rtActifs = 0;
    Object.keys(parRt).forEach(function (k) { if (parRt[k].nbAchats > 0) rtActifs++; });
    etat.couverture = {
      villages: villages.length, villagesCibles: REFERENTIEL.villagesCibles,
      villagesActifs: etat.villages.actifs,
      rt: rts.length, rtCibles: REFERENTIEL.equipesRtCibles, rtActifs: rtActifs,
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
     Compréhension déterministe : la question est réduite à une intention et à
     une portée (zone, cluster, RT), puis la réponse est CALCULÉE sur l'état.
     Aucune réponse n'est produite sans chiffre ni source. Quand l'intention
     n'est pas reconnue, le moteur le dit — il n'improvise pas.
     ====================================================================== */

  var INTENTIONS = [
    { code: "refinancement", mots: ["refinancement", "refinancer", "refinancable", "debloquer", "deblocage", "bloque", "blocage"] },
    { code: "reconciliation", mots: ["reconciliation", "reconcilie", "reconcilier", "justifie", "justification"] },
    { code: "objectif", mots: ["objectif", "cible", "reste", "atteindre", "avancement", "plan", "retard"] },
    { code: "volume", mots: ["volume", "tonnage", "tonne", "achete", "achat", "collecte", "quantite", "kg", "mt"] },
    { code: "cash", mots: ["cash", "avance", "argent", "caisse", "solde", "decaisse", "paiement", "paye", "fcfa"] },
    { code: "sacs", mots: ["sac", "sacs", "sacherie", "jute", "emballage", "dechire"] },
    { code: "qualite", mots: ["qualite", "humidite", "kor", "rejet", "recu", "bareme", "prix", "controle"] },
    { code: "risque", mots: ["risque", "alerte", "anomalie", "probleme", "urgence", "critique", "prioritaire", "priorite"] },
    { code: "couverture", mots: ["village", "villages", "equipe", "equipes", "couverture", "inactif", "sommeil"] },
    { code: "classement", mots: ["meilleur", "meilleurs", "top", "classement", "pire", "dernier", "premiers", "performant"] },
    { code: "synthese", mots: ["synthese", "resume", "point", "situation", "bilan", "rapport", "briefing"] }
  ];

  var PERIODES = [
    { code: "jour", mots: ["aujourd hui", "aujourdhui", "ce jour", "du jour"] },
    { code: "semaine", mots: ["semaine", "7 jours", "sept jours", "hebdo"] },
    { code: "cumul", mots: ["cumul", "total", "depuis le debut", "campagne", "global"] }
  ];

  function detecterIntention(q) {
    var meilleur = "", score = 0;
    INTENTIONS.forEach(function (i) {
      var s = 0;
      i.mots.forEach(function (m) { if (q.indexOf(m) >= 0) s += m.length; });
      if (s > score) { score = s; meilleur = i.code; }
    });
    return { code: meilleur, score: score };
  }

  function detecterPeriode(q) {
    var trouve = "cumul";
    PERIODES.forEach(function (p) {
      p.mots.forEach(function (m) { if (q.indexOf(m) >= 0) trouve = p.code; });
    });
    return trouve;
  }

  /* Portée : zone AFLP, cluster, ou équipe RT nommée dans la question. */
  function detecterPortee(q, etat) {
    var mz = q.match(/\bgbeke\s*([12])\b/) || q.match(/\bzone\s*([12])\b/);
    if (mz && etat.zones["GBEKE " + mz[1]]) {
      return { type: "zone", cle: "GBEKE " + mz[1], label: "GBEKE " + mz[1] };
    }
    var zones = Object.keys(etat.zones);
    for (var i = 0; i < zones.length; i++) {
      var zk = motsCles(zones[i]);
      if (zk && zk.length > 3 && q.indexOf(zk) >= 0) {
        return { type: "zone", cle: zones[i], label: zones[i] };
      }
    }
    var cks = Object.keys(etat.clusters);
    for (var j = 0; j < cks.length; j++) {
      var c = etat.clusters[cks[j]];
      var lk = motsCles(c.label);
      if (lk && lk.length > 3 && q.indexOf(lk) >= 0) {
        return { type: "cluster", cle: c.cle, label: c.label };
      }
    }
    var rks = Object.keys(etat.rt);
    for (var k = 0; k < rks.length; k++) {
      var r = etat.rt[rks[k]];
      var rk = motsCles(r.nom);
      if (rk && rk.length > 3 && q.indexOf(rk) >= 0) {
        return { type: "rt", cle: r.cle, label: r.nom };
      }
    }
    return { type: "global", cle: "", label: "ensemble du pilote" };
  }

  /* Agrégat correspondant à la portée demandée. */
  function agregatPortee(portee, etat) {
    if (portee.type === "zone") {
      var z = etat.zones[portee.cle] || {};
      return {
        libelle: "la zone " + portee.label,
        volumeKg: nb(z.volumeKg), avances: nb(z.avances), paye: nb(z.paye),
        solde: nb(z.solde), objectifMT: nb(z.objectifMT),
        pctObjectif: z.pctObjectif, villages: nb(z.villages), rt: nb(z.rt),
        sacs: 0, sansRecu: 0
      };
    }
    if (portee.type === "cluster") {
      var c = etat.clusters[portee.cle] || {};
      return {
        libelle: "le cluster " + portee.label,
        volumeKg: nb(c.volumeKg), avances: nb(c.avances), paye: nb(c.paye),
        solde: nb(c.solde), objectifMT: nb(c.objectifMT),
        pctObjectif: c.pctObjectif, villages: nb(c.villages), rt: nb(c.rt),
        sacs: nb(c.sacs), sansRecu: nb(c.sansRecu), dernierAchat: c.dernierAchat
      };
    }
    if (portee.type === "rt") {
      var r = etat.rt[portee.cle] || {};
      return {
        libelle: "l'équipe " + portee.label,
        volumeKg: nb(r.volumeKg), avances: nb(r.avances), paye: nb(r.paye),
        solde: nb(r.solde), sacs: nb(r.sacs), recon: r.recon, objectifMT: 0,
        pctObjectif: null, villages: 0, rt: 1,
        montantRefinancable: nb(r.montantRefinancable), sansRecu: nb(r.sansRecu),
        dernierAchat: r.dernierAchat, derniereAvance: r.derniereAvance
      };
    }
    return {
      libelle: "l'ensemble du pilote",
      volumeKg: etat.volume.cumulKg, avances: etat.cash.avances,
      paye: etat.cash.paye, solde: etat.cash.solde,
      objectifMT: etat.objectifMT, pctObjectif: etat.volume.pctObjectif,
      villages: etat.couverture.villages, rt: etat.couverture.rt,
      sacs: etat.sacs.rtTotal, sansRecu: etat.qualite.sansRecu
    };
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
    "Où en est le volume par rapport aux 3 000 MT ?",
    "Quels RT sont bloqués pour refinancement ?",
    "Combien a acheté Brobo ?",
    "Quel est le solde de caisse de GBEKE 1 ?",
    "Quels villages n'ont rien acheté depuis 7 jours ?",
    "Quels sont les clusters les plus avancés ?",
    "Que dois-je traiter en priorité aujourd'hui ?"
  ];

  function repondre(question, etat, refi, listeAlertes) {
    var q = motsCles(question);
    if (!q) {
      return reponse("Posez une question sur le volume, la caisse, la réconciliation, le refinancement, la sacherie ou la couverture terrain.",
        [], [], "haute", QUESTIONS_TYPES);
    }
    refi = refi || refinancement(etat);
    listeAlertes = listeAlertes || alertes(etat, refi);

    var intention = detecterIntention(q);
    var periode = detecterPeriode(q);
    var portee = detecterPortee(q, etat);
    var agg = agregatPortee(portee, etat);
    var src = ["FBMS · données arrêtées au " + etat.dateRef];

    if (!intention.code) {
      return reponse(
        "Je ne sais pas répondre à cette question à partir des données FBMS chargées. " +
        "Je ne devine pas : reformulez avec un mot-clé métier (volume, avance, réconciliation, " +
        "refinancement, sacs, village, RT).",
        [], src, "nulle", QUESTIONS_TYPES);
    }

    /* -- Volume ------------------------------------------------------------ */
    if (intention.code === "volume") {
      var kg = agg.volumeKg, libPeriode = "cumulé campagne";
      if (portee.type === "global") {
        if (periode === "jour") { kg = etat.volume.jourKg; libPeriode = "du jour"; }
        else if (periode === "semaine") { kg = etat.volume.semaineKg; libPeriode = "des 7 derniers jours"; }
      } else if (periode !== "cumul") {
        /* Le détail jour / semaine n'est agrégé qu'au niveau global : le dire,
           plutôt que de renvoyer un cumul en le faisant passer pour la période
           demandée. */
        return reponse(
          "Le volume " + (periode === "jour" ? "du jour" : "de la semaine") +
          " n'est pas ventilé à ce niveau dans les données chargées. Pour " + agg.libelle +
          ", le cumul campagne est de " + fmtMT(agg.volumeKg) + " MT.",
          [{ libelle: "Cumul " + agg.libelle, valeur: fmtMT(agg.volumeKg) + " MT" }],
          src, "moyenne", QUESTIONS_TYPES);
      }
      var ch = [{ libelle: "Volume " + libPeriode, valeur: fmtMT(kg) + " MT (" + fmtNombre(kg) + " kg)" }];
      if (agg.objectifMT) {
        ch.push({ libelle: "Quote-part objectif", valeur: fmtNombre(agg.objectifMT) + " MT" });
        ch.push({ libelle: "Avancement", valeur: fmtPct(agg.pctObjectif) });
      }
      return reponse(
        "Pour " + agg.libelle + ", le volume " + libPeriode + " est de " + fmtMT(kg) + " MT" +
        (agg.objectifMT ? ", soit " + fmtPct(agg.pctObjectif) + " de la quote-part de " +
          fmtNombre(agg.objectifMT) + " MT." : "."),
        ch, src);
    }

    /* -- Objectif et rythme ------------------------------------------------- */
    if (intention.code === "objectif") {
      var reste = agg.objectifMT ? Math.max(0, agg.objectifMT - agg.volumeKg / 1000) : null;
      var jours = (etat.volume.moyenneJourKg && reste != null)
        ? Math.ceil((reste * 1000) / etat.volume.moyenneJourKg) : null;
      return reponse(
        "Pour " + agg.libelle + " : " + fmtMT(agg.volumeKg) + " MT collectés" +
        (agg.objectifMT
          ? " sur " + fmtNombre(agg.objectifMT) + " MT, soit " + fmtPct(agg.pctObjectif) +
            ". Reste " + fmtNombre(reste) + " MT" +
            (jours ? ", environ " + fmtNombre(jours) + " jour(s) au rythme moyen actuel." : ".")
          : "."),
        [
          { libelle: "Collecté", valeur: fmtMT(agg.volumeKg) + " MT" },
          { libelle: "Objectif", valeur: agg.objectifMT ? fmtNombre(agg.objectifMT) + " MT" : "—" },
          { libelle: "Reste", valeur: reste != null ? fmtNombre(reste) + " MT" : "—" },
          { libelle: "Moyenne par jour actif", valeur: fmtNombre(etat.volume.moyenneJourKg) + " kg" }
        ], src);
    }

    /* -- Cash --------------------------------------------------------------- */
    if (intention.code === "cash") {
      var chCash = [
        { libelle: "Avances RT", valeur: fmtF(agg.avances) },
        { libelle: "Payé producteurs", valeur: fmtF(agg.paye) },
        { libelle: "Solde en circulation", valeur: fmtF(agg.solde) }
      ];
      if (portee.type === "rt" && agg.derniereAvance) {
        chCash.push({ libelle: "Dernière avance", valeur: agg.derniereAvance });
      }
      return reponse(
        "Pour " + agg.libelle + " : " + fmtF(agg.avances) + " avancés, " + fmtF(agg.paye) +
        " payés aux producteurs, solde de " + fmtF(agg.solde) + "." +
        (agg.solde < 0 ? " Solde négatif : une avance manque à la saisie, ou un achat est mal imputé." : ""),
        chCash, src);
    }

    /* -- Réconciliation ------------------------------------------------------ */
    if (intention.code === "reconciliation") {
      if (portee.type === "rt") {
        var r = etat.rt[portee.cle] || {};
        if (!r.recon) {
          return reponse(
            "L'équipe " + portee.label + " n'a aucune réconciliation enregistrée. Avec " +
            fmtF(r.avances) + " d'avance ouverte, elle ne peut pas être refinancée.",
            [{ libelle: "Avance ouverte", valeur: fmtF(r.avances) }], src);
        }
        return reponse(
          "Dernière réconciliation de " + portee.label + " : " + (r.recon.jour || "date inconnue") +
          ", statut « " + r.recon.statut + " », écart " + fmtF(r.recon.ecart) + ".",
          [
            { libelle: "Statut", valeur: r.recon.statut || "—" },
            { libelle: "Écart", valeur: fmtF(r.recon.ecart) },
            { libelle: "Dernière avance", valeur: r.derniereAvance || "—" }
          ], src);
      }
      var champ = refi.parRT.filter(function (x) {
        if (portee.type === "global") return true;
        if (portee.type === "cluster") return cle(x.cluster) === portee.cle;
        return x.zone === portee.cle;
      });
      var nonRec = champ.filter(function (x) { return x.statut === "NO-GO"; });
      return reponse(
        "Sur " + agg.libelle + " : " + (champ.length - nonRec.length) + " équipe(s) réconciliée(s) sur " +
        champ.length + ". " + nonRec.length + " reste(nt) à réconcilier" +
        (nonRec.length
          ? " : " + nonRec.slice(0, 8).map(function (x) { return x.nom; }).join(", ") +
            (nonRec.length > 8 ? " (+" + (nonRec.length - 8) + ")" : "") + "."
          : "."),
        [
          { libelle: "Réconciliées", valeur: String(champ.length - nonRec.length) },
          { libelle: "À réconcilier", valeur: String(nonRec.length) }
        ], src);
    }

    /* -- Refinancement -------------------------------------------------------- */
    if (intention.code === "refinancement") {
      var lignes = refi.parRT.filter(function (x) {
        if (portee.type === "global") return true;
        if (portee.type === "cluster") return cle(x.cluster) === portee.cle;
        if (portee.type === "zone") return x.zone === portee.cle;
        return x.cle === portee.cle;
      });
      var bloques = lignes.filter(function (x) { return x.statut === "NO-GO"; });
      var mBloque = bloques.reduce(function (s, x) { return s + nb(x.montantRefinancable); }, 0);
      var mLibre = lignes.filter(function (x) { return x.statut === "GO"; })
        .reduce(function (s, x) { return s + nb(x.montantRefinancable); }, 0);
      var detail = bloques.slice(0, 10).map(function (x) {
        return "· " + x.nom + " (" + (x.cluster || "cluster inconnu") + ") — " + x.motifs[0];
      }).join("\n");
      return reponse(
        "Règle AFLP : pas de réconciliation = pas de refinancement.\n" +
        "Sur " + agg.libelle + ", " + bloques.length + " équipe(s) sur " + lignes.length +
        " sont bloquées, soit " + fmtF(mBloque) + " non débloquables. " +
        fmtF(mLibre) + " peuvent être refinancés immédiatement." +
        (detail ? "\n" + detail + (bloques.length > 10 ? "\n(+" + (bloques.length - 10) + " autres)" : "") : ""),
        [
          { libelle: "Débloquable", valeur: fmtF(mLibre) },
          { libelle: "Bloqué", valeur: fmtF(mBloque) },
          { libelle: "RT bloqués", valeur: bloques.length + " / " + lignes.length }
        ], src);
    }

    /* -- Sacherie -------------------------------------------------------------- */
    if (intention.code === "sacs") {
      if (portee.type === "rt" || portee.type === "cluster") {
        return reponse(
          "Solde de sacs pour " + agg.libelle + " : " + fmtNombre(agg.sacs) + " sac(s)." +
          (nb(agg.sacs) < 0 ? " Solde négatif : un mouvement d'entrée manque." : ""),
          [{ libelle: "Solde sacs", valeur: fmtNombre(agg.sacs) }], src);
      }
      return reponse(
        "Sacherie : " + fmtNombre(etat.sacs.rtTotal) + " sacs en main RT, " +
        fmtNombre(etat.sacs.clusterTotal) + " en cluster, " + fmtNombre(etat.sacs.distribues) +
        " distribués, " + fmtNombre(etat.sacs.dechires) + " déchirés. " +
        (etat.sacs.negRt + etat.sacs.negCluster + etat.sacs.negProd) + " solde(s) négatif(s) à corriger.",
        [
          { libelle: "En main RT", valeur: fmtNombre(etat.sacs.rtTotal) },
          { libelle: "En cluster", valeur: fmtNombre(etat.sacs.clusterTotal) },
          { libelle: "Déchirés", valeur: fmtNombre(etat.sacs.dechires) },
          { libelle: "Soldes négatifs", valeur: String(etat.sacs.negRt + etat.sacs.negCluster + etat.sacs.negProd) }
        ], src);
    }

    /* -- Qualité et traçabilité ------------------------------------------------ */
    if (intention.code === "qualite") {
      return reponse(
        "Sur " + fmtNombre(etat.qualite.lignes) + " lignes d'achat : " +
        fmtNombre(etat.qualite.sansRecu) + " sans reçu (" + fmtF(etat.qualite.montantSansRecu) +
        ", non refinançables), " + fmtNombre(etat.qualite.aControler) + " en contrôle qualité, " +
        fmtNombre(etat.qualite.horsBareme) + " hors barème de prix." +
        (portee.type === "cluster"
          ? " Pour " + agg.libelle + " : " + fmtNombre(agg.sansRecu) + " achat(s) sans reçu." : ""),
        [
          { libelle: "Sans reçu", valeur: fmtNombre(etat.qualite.sansRecu) },
          { libelle: "Qualité à contrôler", valeur: fmtNombre(etat.qualite.aControler) },
          { libelle: "Hors barème", valeur: fmtNombre(etat.qualite.horsBareme) }
        ], src);
    }

    /* -- Risques et priorités --------------------------------------------------- */
    if (intention.code === "risque") {
      if (!listeAlertes.length) {
        return reponse("Aucune anomalie détectée au " + etat.dateRef +
          " sur les contrôles disponibles.", [], src);
      }
      var top = listeAlertes.slice(0, 5);
      return reponse(
        "À traiter en priorité au " + etat.dateRef + " :\n" + top.map(function (a, i) {
          return (i + 1) + ". [" + a.severite + "] " + a.titre + " — " +
            fmtNombre(a.valeur) + " " + a.unite + ". " + a.detail;
        }).join("\n"),
        top.map(function (a) {
          return { libelle: a.titre, valeur: fmtNombre(a.valeur) + " " + a.unite };
        }), src);
    }

    /* -- Couverture terrain ------------------------------------------------------ */
    if (intention.code === "couverture") {
      var inactifs = etat.villages.inactifs;
      if (portee.type === "cluster") {
        inactifs = inactifs.filter(function (v) { return cle(v.cluster) === portee.cle; });
      }
      var liste = inactifs.slice(0, 10).map(function (v) {
        return "· " + (v.nom || "village sans nom") + " (" + (v.cluster || "cluster inconnu") + ") — " +
          (v.dernierAchat ? v.joursSansAchat + " jour(s) sans achat" : "aucun achat enregistré");
      }).join("\n");
      return reponse(
        "Couverture de " + agg.libelle + " : " + fmtNombre(agg.villages) + " village(s), " +
        fmtNombre(agg.rt) + " équipe(s) RT" +
        (portee.type === "global"
          ? " (cibles : " + etat.couverture.villagesCibles + " villages, " +
            etat.couverture.rtCibles + " équipes)" : "") + ". " +
        inactifs.length + " village(s) sans achat depuis plus de " +
        REFERENTIEL.seuils.villageInactifJours + " jours." + (liste ? "\n" + liste : ""),
        [
          { libelle: "Villages", valeur: fmtNombre(agg.villages) },
          { libelle: "Équipes RT", valeur: fmtNombre(agg.rt) },
          { libelle: "Villages en sommeil", valeur: String(inactifs.length) }
        ], src);
    }

    /* -- Classement ---------------------------------------------------------------- */
    if (intention.code === "classement") {
      var pire = /pire|dernier|faible|mauvais|retard|moins/.test(q);
      var cls = Object.keys(etat.clusters).map(function (k) { return etat.clusters[k]; })
        .filter(function (c) { return c.estAFLP || c.nbAchats > 0; });
      cls = trier(cls, function (c) { return c.volumeKg; }, !pire).slice(0, 6);
      return reponse(
        (pire ? "Clusters les moins avancés" : "Clusters les plus avancés") + " au " + etat.dateRef + " :\n" +
        cls.map(function (c, i) {
          return (i + 1) + ". " + c.label + " (" + c.zone + ") — " + fmtMT(c.volumeKg) + " MT" +
            (c.pctObjectif != null ? " · " + fmtPct(c.pctObjectif) + " de la quote-part" : "");
        }).join("\n"),
        cls.map(function (c) { return { libelle: c.label, valeur: fmtMT(c.volumeKg) + " MT" }; }),
        src);
    }

    /* -- Synthèse ------------------------------------------------------------------- */
    if (intention.code === "synthese") {
      var syn = synthese(etat, refi, listeAlertes);
      return reponse(
        syn.enTete + "\n\n" + syn.decisions.map(function (d, i) {
          return (i + 1) + ". " + d.action;
        }).join("\n"),
        [
          { libelle: "Cumul", valeur: fmtMT(etat.volume.cumulKg) + " MT" },
          { libelle: "Avancement", valeur: fmtPct(etat.volume.pctObjectif) },
          { libelle: "RT bloqués", valeur: String(refi.global.rtNoGo) }
        ], src);
    }

    return reponse(
      "Question comprise partiellement, mais aucun calcul correspondant n'est disponible " +
      "dans les données chargées.", [], src, "faible", QUESTIONS_TYPES);
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
    /* Utilitaires exposés pour que l'interface formate exactement comme le
       moteur, sans redéfinir ses propres arrondis. */
    format: { nombre: fmtNombre, mt: fmtMT, francs: fmtF, pourcent: fmtPct, jour: jour, cle: cle }
  };

  global.AFLP_IA = API;
  if (typeof module === "object" && module.exports) module.exports = API;

})(typeof window !== "undefined" ? window : this);
