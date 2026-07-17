/* ============================================================================
   RCN TRACE — Moteur métier & magasin local (rcntrace/rcntrace.js)
   ----------------------------------------------------------------------------
   Prototype V1 · Modules 1 & 2 (Réception, Qualité, Stock/BIN, Transfert,
   Calibrage). Fidèle au cahier des charges consolidé v2.0 et à la conception
   des écrans (16 écrans). Fonctionne hors connexion : toutes les données sont
   conservées dans localStorage. Aucune quantité ne disparaît, aucune correction
   n'efface le passé (journal d'audit versionné).

   Principes appliqués (cf. §1.2) :
     · Le lot officiel (RCN) porte l'identité ; la BIN porte la position.
     · Après mélange : traçabilité par contributeurs + bilan matière.
     · Une valeur vide n'est PAS un zéro.
     · Toute correction crée une version avec motif et auteur.
   ========================================================================== */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  0. Constantes métier                                              */
  /* ------------------------------------------------------------------ */
  var KOR_FACTOR = 0.17637;                       // §6.1 formule confirmée
  var KOR_FORMULA = "(GK + Spotted/2 + Immature/2) × 0.17637";
  var KOR_FORMULA_VERSION = "v1.0";
  var KOR_TOLERANCE = 1;                          // écart conforme si strictement < 1

  // Neuf calibres officiels RCN — grille retenue au nombre de noix/kg (§9.3).
  var CALIBRES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"];
  var CALIBRE_LABELS = {
    C1: "Très gros · ≤ 180 noix/kg", C2: "181–190 noix/kg", C3: "191–200 noix/kg",
    C4: "201–210 noix/kg", C5: "211–220 noix/kg", C6: "221–230 noix/kg",
    C7: "231–240 noix/kg", C8: "241–250 noix/kg", C9: "Petit · > 250 noix/kg"
  };

  // Catégories de sorties non-calibre (§M2-FR-08).
  var CATEGORIES_PERTE = [
    { code: "rejet", label: "Rejet" },
    { code: "poussiere", label: "Poussière" },
    { code: "perte", label: "Perte" },
    { code: "rework", label: "Rework" },
    { code: "residu_machine", label: "Résidu machine" }
  ];

  // Motifs d'arrêt configurables (§M2-FR-06).
  var MOTIFS_ARRET = ["Maintenance", "Changement de calibre", "Nettoyage", "Panne", "Pause équipe", "Manque matière"];

  // Catégories de sacs constatées sur le terrain (rapports Bouaké/Yakro).
  var CATEGORIES_SAC = [
    { code: "bon", label: "Bons sacs" },
    { code: "humide", label: "Sacs humides" },
    { code: "dechire", label: "Sacs déchirés" },
    { code: "recond", label: "Sacs reconditionnés" }
  ];

  // Référentiels RÉELS extraits des rapports d'exploitation 2026 (configurables).
  // Fournisseurs = coopératives avec leur code LBA.
  var FOURNISSEURS = [
    { nom: "RCN SCOOP IMANE", lba: "LBA-006-IMA" },
    { nom: "RCN CASP-S SCOOPS", lba: "LBA-007-CAS" },
    { nom: "RCN SCOOPS HERE B", lba: "LBA-003-HER" },
    { nom: "RCN SCOOPS-SOCOSIDJI", lba: "LBA-001-SOC" },
    { nom: "RCN COP JAVA SCOOPS", lba: "LBA-005-JAV" },
    { nom: "RCN SCAAMT COOP CA", lba: "LBA-008-SCA" },
    { nom: "RCN SCOOPS WEBE", lba: "LBA-010-WEB" },
    { nom: "DAGNOGO KARIM / SCOPPA", lba: "LBA-013-DAG" }
  ];
  var ORIGINES = ["Dianra", "Mankono", "Niakara", "Bouaké", "Vavoua", "Dabakala", "Kounahiri", "Korhogo", "Séguéla"];
  // Entrepôts par localité (une localité a plusieurs entrepôts).
  // Format d'identifiant BIN dérivé : <ENTREPÔT>-BIN-nn (ex. BKE-002-BIN-017).
  var ENTREPOTS = [
    { code: "BKE-001", nom: "Bouaké — Entrepôt 1", location: "Bouaké" },
    { code: "BKE-002", nom: "Bouaké — Entrepôt 2", location: "Bouaké" },
    { code: "BKE-003", nom: "Bouaké — Entrepôt 3", location: "Bouaké" },
    { code: "YAKRO-01", nom: "Yamoussoukro — Entrepôt 1", location: "Yamoussoukro" },
    { code: "YAKRO-02", nom: "Yamoussoukro — Entrepôt 2", location: "Yamoussoukro" },
    { code: "ANAGROCI-01", nom: "Usine (calibrage)", location: "Yamoussoukro" }
  ];

  // Statuts (cf. §5).
  var ETAT_REC = {
    ARRIVEE: "ARRIVÉE_ENREGISTRÉE",
    SAMPLING: "SAMPLING_EN_COURS",
    ATTENTE_GM: "ATTENTE_GM",
    REFUSEE: "REFUSÉE",
    AUTORISEE: "AUTORISÉE",
    DECHARGE: "DÉCHARGÉ_EN_ATTENTE_QUALITÉ",
    LIBERE: "LIBÉRÉ",
    BLOQUE: "BLOQUÉ_QUALITÉ",
    CLOS: "CLOS"
  };
  var ETAT_BIN = { OUVERT: "OUVERT", ACTIF: "ACTIF", BLOQUE: "BLOQUÉ", RECONCILIER: "À_RÉCONCILIER", VIDE: "VIDE_À_CONFIRMER", CLOS: "CLOS" };
  var ETAT_TRF = { BROUILLON: "BROUILLON", PREPARE: "PRÉPARÉ", CONTROLE: "CONTRÔLÉ_QA", EXPEDIE: "EXPÉDIÉ", PARTIEL: "PARTIELLEMENT_REÇU", RECU: "REÇU", ECART: "EN_ÉCART", CLOS: "CLOS", ANNULE: "ANNULÉ" };
  var ETAT_CAL = { PRET: "PRÊT", EN_COURS: "EN_COURS", PAUSE: "EN_PAUSE", PARTIEL: "PARTIEL", RAPPROCHER: "À_RAPPROCHER", VALIDER: "À_VALIDER", CLOS: "CLOS", ROUVERT: "ROUVERT_AUTORISÉ" };

  /* ------------------------------------------------------------------ */
  /*  1. Magasin persistant (localStorage)                              */
  /* ------------------------------------------------------------------ */
  var DB_KEY = "rcntrace.db.v4";
  var _db = null;

  function emptyDb() {
    return {
      seq: {},                 // compteurs de séquence par préfixe et par jour
      receptions: [],          // dossier REC (inclut sampling, analyse finale, décision GM)
      lots: [],                // lots officiels RCN
      bins: {},                // état courant par identifiant de BIN physique
      binCycles: [],           // cycles de BIN
      movements: [],           // mouvements MOV (entrées/sorties/séchage/triage)
      dryings: [],             // opérations de séchage / triage SEC (avant/après)
      transfers: [],           // transferts TRF
      cals: [],                // opérations de calibrage CAL
      documents: [],           // pièces jointes DOC (métadonnées)
      audit: [],               // journal d'audit AUD (non modifiable)
      referentials: {
        calibres: CALIBRES.slice(),
        motifsArret: MOTIFS_ARRET.slice(),
        fournisseurs: FOURNISSEURS.slice(),
        origines: ORIGINES.slice(),
        entrepots: ENTREPOTS.slice(),
        categoriesSac: CATEGORIES_SAC.slice()
      },
      user: { nom: "Innocent K.", role: "Coordination" },
      seeded: false
    };
  }

  function loadDb() {
    if (_db) return _db;
    try {
      var raw = localStorage.getItem(DB_KEY);
      _db = raw ? JSON.parse(raw) : emptyDb();
    } catch (e) { _db = emptyDb(); }
    if (!_db.seq) _db = emptyDb();
    return _db;
  }
  function saveDb() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(_db)); }
    catch (e) { console.warn("RCN TRACE : sauvegarde locale impossible", e); }
    if (typeof global.RCNTRACE_ONSAVE === "function") global.RCNTRACE_ONSAVE();
  }
  function resetDb() { _db = emptyDb(); saveDb(); return _db; }

  /* ------------------------------------------------------------------ */
  /*  2. Utilitaires                                                    */
  /* ------------------------------------------------------------------ */
  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
  function today(d) { d = d || new Date(); return "" + d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2); }
  function nowISO() { return new Date().toISOString(); }
  function fmtDateTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return pad(d.getDate(), 2) + "/" + pad(d.getMonth() + 1, 2) + "/" + d.getFullYear() + " · " + pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2);
  }
  function fmtTime(iso) { if (!iso) return "—"; var d = new Date(iso); return pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2); }
  // Une valeur vide n'est PAS un zéro (§1.2). num() distingue null (vide) de 0.
  function num(v) {
    if (v === "" || v === null || v === undefined) return null;
    var n = Number(String(v).replace(",", "."));
    return isNaN(n) ? null : n;
  }
  function kg(v) {
    if (v === null || v === undefined || v === "") return "—";
    return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " kg";
  }
  function pct(v) { if (v === null || v === undefined) return "—"; return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %"; }
  function round2(v) { return Math.round(v * 100) / 100; }

  function nextSeq(prefix, daily) {
    var db = loadDb();
    var key = daily ? prefix + ":" + today() : prefix;
    db.seq[key] = (db.seq[key] || 0) + 1;
    return db.seq[key];
  }
  function genId(prefix, daily, width) {
    var s = nextSeq(prefix, daily);
    return daily ? prefix + "-" + today() + "-" + pad(s, width || 3) : prefix + "-" + pad(s, width || 4);
  }

  /* ------------------------------------------------------------------ */
  /*  3. Journal d'audit (§13.1) — jamais d'écrasement silencieux        */
  /* ------------------------------------------------------------------ */
  function audit(objet, champ, avant, apres, motif) {
    var db = loadDb();
    var user = db.user || { nom: "—", role: "—" };
    db.audit.unshift({
      id: genId("AUD"),
      at: nowISO(),
      objet: objet, champ: champ,
      avant: avant === undefined ? null : avant,
      apres: apres === undefined ? null : apres,
      motif: motif || null,
      auteur: user.nom, role: user.role
    });
    if (db.audit.length > 500) db.audit.length = 500;
  }

  /* ------------------------------------------------------------------ */
  /*  4. Calculs qualité (§6.1)                                          */
  /* ------------------------------------------------------------------ */
  // KOR = (GK + Spotted/2 + Immature/2) × 0.17637 — valeur EXACTE conservée
  // (non arrondie). La comparaison d'écart utilise cette valeur exacte (§6.3) ;
  // seul l'affichage est arrondi à deux décimales.
  function computeKor(sample) {
    var gk = num(sample.gk), imm = num(sample.imm), sp = num(sample.spotted);
    if (gk === null && imm === null && sp === null) return null;
    var base = (gk || 0) + (sp || 0) / 2 + (imm || 0) / 2;
    return base * KOR_FACTOR;
  }
  function totalDefect(s) {
    var b = num(s.browns), v = num(s.voids), o = num(s.oil);
    if (b === null && v === null && o === null) return null;
    return (b || 0) + (v || 0) + (o || 0);
  }
  function totalKernels(s) {
    var gk = num(s.gk), imm = num(s.imm), sp = num(s.spotted);
    if (gk === null && imm === null && sp === null) return null;
    return (gk || 0) + (imm || 0) + (sp || 0);
  }
  // Écart KOR = |final − sampling| (valeurs exactes) ; conforme si strictement < 1.
  function ecartKor(korSampling, korFinal) {
    if (korSampling === null || korFinal === null) return null;
    return Math.abs(korFinal - korSampling);
  }
  function ecartConforme(ec) { return ec !== null && ec < KOR_TOLERANCE; }

  /* ------------------------------------------------------------------ */
  /*  5. Accès collections                                              */
  /* ------------------------------------------------------------------ */
  function receptions() { return loadDb().receptions; }
  function lots() { return loadDb().lots; }
  function transfers() { return loadDb().transfers; }
  function cals() { return loadDb().cals; }
  function binCycles() { return loadDb().binCycles; }
  function auditLog() { return loadDb().audit; }
  function referentials() { return loadDb().referentials; }
  function movements() { return loadDb().movements; }
  function dryings() { return loadDb().dryings || (loadDb().dryings = []); }

  function getRec(id) { return receptions().filter(function (r) { return r.id === id; })[0] || null; }
  function getLot(id) { return lots().filter(function (l) { return l.id === id; })[0] || null; }
  function getCycle(id) { return binCycles().filter(function (c) { return c.id === id; })[0] || null; }
  function getTrf(id) { return transfers().filter(function (t) { return t.id === id; })[0] || null; }
  function getDrying(id) { return dryings().filter(function (d) { return d.id === id; })[0] || null; }
  // Qualité « portée » d'un lot (pour l'affichage BIN : fournisseur, KOR, sacs, NC, humidité).
  function lotQuality(lotId) {
    var lot = getLot(lotId); if (!lot) return {};
    var rec = getRec(lot.recId) || {};
    var q = rec.finale || rec.sampling || {};
    return { fournisseur: lot.fournisseur, kor: lot.korDisplay, sacs: lot.sacs, nc: q.nc, humidity: q.humidity };
  }
  function getCal(id) { return cals().filter(function (c) { return c.id === id; })[0] || null; }

  /* ------------------------------------------------------------------ */
  /*  6. MODULE 1 — Réception, qualité, lot                              */
  /* ------------------------------------------------------------------ */

  // M1-FR-02 · Créer la réception temporaire (lot vide et verrouillé).
  function createReception(data) {
    var db = loadDb();
    var rec = {
      id: genId("REC", true),
      createdAt: nowISO(),
      camion: data.camion || "", fournisseur: data.fournisseur || "", lba: data.lba || "",
      origine: data.origine || "", site: data.site || "", warehouse: data.warehouse || data.site || "",
      arriveeAt: data.arriveeAt || nowISO(),
      poidsAnnonce: num(data.poidsAnnonce), sacsAnnonce: num(data.sacsAnnonce),
      refDoc: data.refDoc || "",
      source: data.fromTransfer ? "inter-entrepôt" : "fournisseur",
      fromTransfer: data.fromTransfer || null,         // transfert d'origine (arrivée inter-entrepôt)
      parents: data.parents || null,                    // lots contributeurs d'origine (généalogie)
      binSuggeree: data.binSuggeree || null,
      etat: ETAT_REC.ARRIVEE,
      lotId: null,               // reste vide et verrouillé (§M1-FR-02)
      sampling: null, finale: null, gm: null, dechargement: null,
      events: []
    };
    // Anti-doublon évident (§M1-FR-02) : même camion + même créneau (±30 min).
    var dup = receptions().filter(function (r) {
      return r.camion && r.camion === rec.camion &&
        Math.abs(new Date(r.arriveeAt) - new Date(rec.arriveeAt)) < 30 * 60000;
    })[0];
    if (dup) throw new Error("Doublon probable : le camion " + rec.camion + " est déjà enregistré sur ce créneau (" + dup.id + ").");
    db.receptions.unshift(rec);
    pushEvent(rec, "REC créé");
    audit(rec.id, "réception", null, rec.etat, "Création réception temporaire");
    saveDb();
    return rec;
  }

  function pushEvent(rec, label, qty) {
    var db = loadDb();
    rec.events.push({ at: nowISO(), label: label, qty: qty === undefined ? null : qty, auteur: (db.user || {}).nom });
  }

  // M1-FR-04 · Saisir & calculer le sampling (avant déchargement).
  function saveSampling(recId, s) {
    var rec = getRec(recId); if (!rec) throw new Error("Réception introuvable");
    var kor = computeKor(s);
    rec.sampling = {
      id: rec.sampling && rec.sampling.id ? rec.sampling.id : genId("QLT"),
      type: "sampling",
      gk: num(s.gk), imm: num(s.imm), spotted: num(s.spotted),
      nc: num(s.nc), humidity: num(s.humidity),
      browns: num(s.browns), voids: num(s.voids), oil: num(s.oil),
      totalDefect: totalDefect(s), totalKernels: totalKernels(s),
      kor: kor, korDisplay: kor === null ? null : round2(kor),
      formula: KOR_FORMULA, formulaVersion: KOR_FORMULA_VERSION,
      analyste: (loadDb().user || {}).nom, at: nowISO()
    };
    if (rec.etat === ETAT_REC.ARRIVEE) rec.etat = ETAT_REC.SAMPLING;
    audit(rec.id, "sampling.kor", null, rec.sampling.korDisplay, "Saisie sampling");
    pushEvent(rec, "Sampling KOR " + (rec.sampling.korDisplay !== null ? rec.sampling.korDisplay.toFixed(2) : "—"));
    saveDb();
    return rec.sampling;
  }

  // M1-FR-04 (suite) · Soumettre au GM.
  function submitToGm(recId) {
    var rec = getRec(recId); if (!rec) throw new Error("Réception introuvable");
    if (!rec.sampling || rec.sampling.kor === null) throw new Error("Le sampling doit être saisi avant la décision GM.");
    rec.etat = ETAT_REC.ATTENTE_GM;
    audit(rec.id, "réception", ETAT_REC.SAMPLING, ETAT_REC.ATTENTE_GM, "Envoi au GM");
    pushEvent(rec, "Envoyé au GM");
    saveDb();
    return rec;
  }

  // M1-FR-05 · Décision du GM (autorise/refuse). Le lot est créé seulement après accord.
  function gmDecision(recId, autorise, commentaire, delegataire) {
    var rec = getRec(recId); if (!rec) throw new Error("Réception introuvable");
    if (rec.etat !== ETAT_REC.ATTENTE_GM && rec.etat !== ETAT_REC.SAMPLING)
      throw new Error("La décision GM n'est possible qu'après le sampling.");
    if (!autorise && !(commentaire && commentaire.trim()))
      throw new Error("Un commentaire est obligatoire en cas de refus.");
    rec.gm = { autorise: !!autorise, commentaire: commentaire || "", delegataire: delegataire || null, at: nowISO(), auteur: (loadDb().user || {}).nom };
    rec.etat = autorise ? ETAT_REC.AUTORISEE : ETAT_REC.REFUSEE;
    audit(rec.id, "décision GM", null, autorise ? "AUTORISÉ" : "REFUSÉ", commentaire || "");
    pushEvent(rec, autorise ? "Déchargement autorisé" : "Déchargement refusé");
    saveDb();
    return rec;
  }

  // M1-FR-07 · Enregistrer le déchargement (le net physique alimente le stock).
  function saveDechargement(recId, d) {
    var rec = getRec(recId); if (!rec) throw new Error("Réception introuvable");
    if (rec.etat !== ETAT_REC.AUTORISEE && rec.etat !== ETAT_REC.DECHARGE)
      throw new Error("Le déchargement exige l'autorisation du GM.");
    var brut = num(d.brut), tare = num(d.tare);
    var net = num(d.net); if (net === null && brut !== null && tare !== null) net = round2(brut - tare);
    // Sacs par catégorie (terrain) ; total = somme si non fourni explicitement.
    var sBon = num(d.sacsBon), sHum = num(d.sacsHumid), sDech = num(d.sacsDechire), sRec = num(d.sacsRecond);
    var sacsTotal = num(d.sacs);
    if (sacsTotal === null && (sBon !== null || sHum !== null || sDech !== null || sRec !== null))
      sacsTotal = (sBon || 0) + (sHum || 0) + (sDech || 0) + (sRec || 0);
    rec.dechargement = {
      bordereau: d.bordereau || "", ticket: d.ticket || "",
      whReceipt: d.whReceipt || "", ficheCca: d.ficheCca || "",   // reçu magasin & fiche CCA
      binDecharge: d.binDecharge || "", balance: d.balance || "",  // BIN de déchargement, emplacement balance
      sacs: sacsTotal, sacsBon: sBon, sacsHumid: sHum, sacsDechire: sDech, sacsRecond: sRec,
      brut: brut, tare: tare, net: net,
      poidsMainDoeuvre: num(d.poidsMainDoeuvre),   // conservé séparément (§1.2)
      prestataire: d.prestataire || "", destination: d.destination || "",
      at: nowISO(), auteur: (loadDb().user || {}).nom
    };
    rec.etat = ETAT_REC.DECHARGE;
    audit(rec.id, "déchargement.net", null, net, "Pesée déchargement");
    pushEvent(rec, "Déchargé — net " + kg(net), net);
    saveDb();
    return rec;
  }

  // M1-FR-08 · Analyse finale (sans écraser le sampling) + M1-FR-09 libération.
  // M1-FR-06 · Création du lot officiel après analyse finale acceptée.
  function saveFinaleAndRelease(recId, f, decision, binId) {
    var rec = getRec(recId); if (!rec) throw new Error("Réception introuvable");
    if (!rec.gm || !rec.gm.autorise) throw new Error("Le GM doit avoir autorisé le déchargement.");
    var korFinal = computeKor(f);
    var korSampling = rec.sampling ? rec.sampling.kor : null;
    var ec = ecartKor(korSampling, korFinal);
    rec.finale = {
      id: genId("QLT"), type: "final",
      gk: num(f.gk), imm: num(f.imm), spotted: num(f.spotted),
      nc: num(f.nc), humidity: num(f.humidity),
      browns: num(f.browns), voids: num(f.voids), oil: num(f.oil),
      totalDefect: totalDefect(f), totalKernels: totalKernels(f),
      kor: korFinal, korDisplay: korFinal === null ? null : round2(korFinal),
      ecart: ec, ecartDisplay: ec === null ? null : round2(ec), conforme: ecartConforme(ec),
      formula: KOR_FORMULA, formulaVersion: KOR_FORMULA_VERSION,
      analyste: (loadDb().user || {}).nom, at: nowISO()
    };
    // Écart ≥ 1 → blocage systématique quel que soit le choix (§M1-FR-09).
    var bloquer = (decision === "bloquer") || !ecartConforme(ec);
    if (bloquer) {
      rec.etat = ETAT_REC.BLOQUE;
      audit(rec.id, "analyse finale", ETAT_REC.DECHARGE, ETAT_REC.BLOQUE,
        ecartConforme(ec) ? "Blocage manuel" : "Écart KOR ≥ 1 (" + (ec !== null ? ec.toFixed(2) : "—") + ")");
      pushEvent(rec, "Bloqué qualité — écart " + (ec !== null ? ec.toFixed(2) : "—"));
      saveDb();
      return { rec: rec, lot: null, bloque: true };
    }
    // Libération → création du lot officiel RCN.
    var lot = {
      id: genId("RCN", true), recId: rec.id,
      fournisseur: rec.fournisseur, origine: rec.origine, site: rec.site || "", warehouse: rec.warehouse || rec.site || "",
      sacs: rec.dechargement ? rec.dechargement.sacs : null,   // sacs portés (affichage BIN)
      korSampling: korSampling, korFinal: korFinal, korDisplay: round2(korFinal),
      ecart: ec, netInitial: rec.dechargement ? rec.dechargement.net : null,
      stock: rec.dechargement ? rec.dechargement.net : 0,   // solde du lot (kg)
      etat: ETAT_REC.LIBERE, binId: binId || null, createdAt: nowISO(),
      fromTransfer: rec.fromTransfer || null, parents: rec.parents || null,   // généalogie ascendante
      children: []   // contributions vers BIN/TRF (généalogie descendante)
    };
    // Généalogie : lots d'origine (arrivée inter-entrepôt) → ce lot.
    if (rec.parents) rec.parents.forEach(function (p) { var src = getLot(p.lotId); if (src) src.children.push({ type: "lot", ref: lot.id, qty: p.qty, via: rec.fromTransfer, at: nowISO() }); });
    rec.lotId = lot.id;
    rec.etat = ETAT_REC.LIBERE;
    loadDb().lots.unshift(lot);
    audit(rec.id, "lot officiel", null, lot.id, "Création & libération du lot");
    pushEvent(rec, lot.id + " créé · KOR " + round2(korFinal).toFixed(2));
    // Si une BIN de destination est choisie, on y ajoute directement le lot.
    if (binId && lot.stock) {
      try { addLotToBin(binId, lot.id, lot.stock); } catch (e) { /* laissé au stock lot */ }
    }
    saveDb();
    return { rec: rec, lot: lot, bloque: false };
  }

  /* ------------------------------------------------------------------ */
  /*  7. Stock, BIN collectives (§7)                                    */
  /* ------------------------------------------------------------------ */

  // Ouvre un cycle de BIN sur un identifiant physique (§7.1).
  function openBinCycle(binId, qualiteAutorisee, capaciteKg) {
    var db = loadDb();
    var existing = binCycles().filter(function (c) { return c.binId === binId && c.etat !== ETAT_BIN.CLOS; })[0];
    if (existing) return existing;
    var cycle = {
      // Format §10.1 : <BIN>/AAAAMMJJ-SEQ (ex. BIN-017/20260716-01)
      id: binId + "/" + today() + "-" + pad(nextSeq("BINCYCLE:" + binId, false), 2),
      binId: binId, qualiteAutorisee: qualiteAutorisee || null, capaciteKg: capaciteKg || null,
      openedAt: nowISO(), closedAt: null, etat: ETAT_BIN.OUVERT,
      contributors: [],   // {lotId, entree, sorti} — composition théorique
      residuKg: null
    };
    db.binCycles.unshift(cycle);
    db.bins[binId] = cycle.id;
    audit(cycle.id, "cycle BIN", null, ETAT_BIN.OUVERT, "Ouverture cycle");
    saveDb();
    return cycle;
  }

  function binStock(cycle) {
    return round2(cycle.contributors.reduce(function (t, c) { return t + (c.entree - c.sorti); }, 0));
  }
  // Cumuls d'un cycle : total entré, total sorti, stock théorique restant.
  function binTotals(cycle) {
    var entree = cycle.contributors.reduce(function (t, c) { return t + c.entree; }, 0);
    var sorti = cycle.contributors.reduce(function (t, c) { return t + c.sorti; }, 0);
    return { entree: round2(entree), sorti: round2(sorti), restant: round2(entree - sorti) };
  }
  // Durée d'un cycle en heures (ouverture → clôture ou maintenant). now optionnel.
  function binDurationH(cycle, nowMs) {
    var start = new Date(cycle.openedAt).getTime();
    var end = cycle.closedAt ? new Date(cycle.closedAt).getTime() : (nowMs || null);
    if (!end) return null;
    return Math.round((end - start) / 3600000 * 10) / 10;
  }
  // M1-FR-16 · Fermeture du cycle de BIN : clôturer après confirmation du stock
  // nul ou du résidu pesé. La perte de poids = restant théorique − résidu réel.
  function closeBinCycle(cycleId, d) {
    var cycle = getCycle(cycleId); if (!cycle) throw new Error("Cycle BIN introuvable");
    if (cycle.etat === ETAT_BIN.CLOS) throw new Error("Ce cycle est déjà clos.");
    var totals = binTotals(cycle);
    if (totals.restant < -0.001) throw new Error("Stock BIN négatif : impossible de clôturer.");
    var residu = num(d.residuKg); if (residu === null) residu = totals.restant;
    if (residu < 0) throw new Error("Résidu négatif interdit.");
    var perte = round2(totals.restant - residu);   // perte de poids de la BIN (shrinkage)
    cycle.residuKg = residu;
    cycle.perteKg = perte;
    cycle.pertePct = totals.entree ? round2(perte / totals.entree * 100) : null;
    cycle.closedAt = nowISO();
    cycle.dureeH = binDurationH(cycle);
    cycle.confirmeur = d.confirmeur || (loadDb().user || {}).nom;
    cycle.clotureMotif = d.motif || "";
    cycle.etat = ETAT_BIN.CLOS;
    audit(cycle.id, "cycle BIN", ETAT_BIN.ACTIF, ETAT_BIN.CLOS, "Clôture · résidu " + kg(residu) + " · perte " + kg(perte));
    saveDb();
    return cycle;
  }

  // M1-FR-11 · Ajouter un lot dans une BIN (refuse un lot non libéré, §M1-FR-11).
  function addLotToBin(binId, lotId, poids) {
    var lot = getLot(lotId); if (!lot) throw new Error("Lot introuvable");
    if (lot.etat !== ETAT_REC.LIBERE) throw new Error("Lot non libéré : mélange interdit (R-01).");
    poids = num(poids); if (poids === null || poids <= 0) throw new Error("Poids invalide.");
    if (poids > lot.stock + 0.001) throw new Error("Quantité (" + kg(poids) + ") supérieure au stock du lot (" + kg(lot.stock) + ").");
    var cycle = binCycles().filter(function (c) { return c.binId === binId && c.etat !== ETAT_BIN.CLOS; })[0];
    if (!cycle) cycle = openBinCycle(binId, null, null);
    if (cycle.capaciteKg && binStock(cycle) + poids > cycle.capaciteKg + 0.001)
      throw new Error("Capacité de la BIN dépassée (" + kg(cycle.capaciteKg) + ").");
    var contrib = cycle.contributors.filter(function (c) { return c.lotId === lotId; })[0];
    if (!contrib) { contrib = { lotId: lotId, entree: 0, sorti: 0, qualite: lot.etat }; cycle.contributors.push(contrib); }
    contrib.entree = round2(contrib.entree + poids);
    lot.stock = round2(lot.stock - poids);
    lot.binId = binId;
    if (cycle.etat === ETAT_BIN.OUVERT) cycle.etat = ETAT_BIN.ACTIF;
    var mov = { id: genId("MOV"), type: "entree_bin", cycleId: cycle.id, binId: binId, lotId: lotId, qty: poids, at: nowISO(), auteur: (loadDb().user || {}).nom };
    loadDb().movements.unshift(mov);
    lot.children.push({ type: "bin", ref: cycle.id, qty: poids, at: nowISO() });
    audit(cycle.id, "entrée BIN", null, lotId + " · " + kg(poids), "Ajout lot en BIN");
    saveDb();
    return cycle;
  }

  // M1-FR-13 · Retrait proportionnel d'une BIN mélangée (R-03).
  function allocateFromCycle(cycle, poids) {
    var stock = binStock(cycle);
    if (poids > stock + 0.001) throw new Error("Sortie (" + kg(poids) + ") supérieure au stock BIN (" + kg(stock) + ").");
    var parts = [];
    cycle.contributors.forEach(function (c) {
      var dispo = c.entree - c.sorti;
      if (dispo <= 0) return;
      var share = dispo / stock;
      parts.push({ lotId: c.lotId, share: share, qty: round2(share * poids), dispoAvant: round2(dispo) });
    });
    // Ajustement d'arrondi sur la plus grosse part.
    var somme = parts.reduce(function (t, p) { return t + p.qty; }, 0);
    if (parts.length && round2(somme) !== round2(poids)) {
      parts.sort(function (a, b) { return b.qty - a.qty; });
      parts[0].qty = round2(parts[0].qty + (poids - somme));
    }
    return parts;
  }

  // Crédite un cycle de BIN sans toucher au solde du lot (matière déjà en BIN,
  // simple déplacement — utilisé par le séchage : BIN source → BIN après séchage).
  function addContributorRaw(cycle, lotId, qty) {
    var c = cycle.contributors.filter(function (x) { return x.lotId === lotId; })[0];
    if (!c) { c = { lotId: lotId, entree: 0, sorti: 0, qualite: (getLot(lotId) || {}).etat }; cycle.contributors.push(c); }
    c.entree = round2(c.entree + qty);
    if (cycle.etat === ETAT_BIN.OUVERT) cycle.etat = ETAT_BIN.ACTIF;
  }

  /* ------------------------------------------------------------------ */
  /*  7bis. Séchage / triage (§7.5) — opération intermédiaire sur la BIN */
  /*  Confirmé par les rapports terrain : humidité/NC/KOR avant & après, */
  /*  BIN « after drying », et perte de séchage = envoyé − récupéré.     */
  /* ------------------------------------------------------------------ */
  // M1-FR-15 · Séchage ou triage : consomme une quantité d'une BIN source
  // (répartie proportionnellement entre contributeurs), produit une quantité
  // séchée versée dans une BIN destination, et calcule la perte.
  function createDrying(sourceCycleId, targetBinId, d) {
    var src = getCycle(sourceCycleId); if (!src) throw new Error("Cycle BIN source introuvable");
    var inputKg = num(d.inputKg); if (inputKg === null || inputKg <= 0) throw new Error("Poids envoyé invalide.");
    var outputKg = num(d.outputKg);
    if (outputKg === null) throw new Error("Poids récupéré requis.");
    var lossKg = round2(inputKg - outputKg);
    if (lossKg < 0) throw new Error("Perte négative interdite : le poids récupéré (" + kg(outputKg) + ") dépasse l'envoyé (" + kg(inputKg) + ").");
    var typeOp = d.type === "triage" ? "triage" : "sechage";
    // Débit proportionnel de la BIN source.
    var parts = allocateFromCycle(src, inputKg);
    parts.forEach(function (p) {
      var c = src.contributors.filter(function (x) { return x.lotId === p.lotId; })[0];
      if (c) c.sorti = round2(c.sorti + p.qty);
    });
    // BIN destination (après séchage) : crédit des mêmes contributeurs, mis à
    // l'échelle du récupéré (la perte est répartie proportionnellement).
    var target = targetBinId ? (binCycles().filter(function (c) { return c.binId === targetBinId && c.etat !== ETAT_BIN.CLOS; })[0] || openBinCycle(targetBinId, src.qualiteAutorisee, src.capaciteKg)) : src;
    var ratio = inputKg > 0 ? outputKg / inputKg : 0;
    parts.forEach(function (p) { addContributorRaw(target, p.lotId, round2(p.qty * ratio)); });
    var op = {
      id: genId("SEC"), type: typeOp,
      sourceCycleId: src.id, sourceBinId: src.binId, targetBinId: target.binId, targetCycleId: target.id,
      inputKg: inputKg, outputKg: outputKg, lossKg: lossKg,
      lossPct: inputKg ? round2(lossKg / inputKg * 100) : 0,
      inputSacs: num(d.inputSacs), outputSacs: num(d.outputSacs),
      inputMoisture: num(d.inputMoisture), outputMoisture: num(d.outputMoisture),
      inputNc: num(d.inputNc), outputNc: num(d.outputNc),
      inputKor: num(d.inputKor), outputKor: num(d.outputKor),
      contributors: parts.map(function (p) { return { lotId: p.lotId, inKg: p.qty, outKg: round2(p.qty * ratio) }; }),
      at: nowISO(), auteur: (loadDb().user || {}).nom
    };
    dryings().unshift(op);
    var mov = { id: genId("MOV"), type: typeOp, cycleId: src.id, binId: src.binId, qty: inputKg, perte: lossKg, at: nowISO(), auteur: op.auteur };
    loadDb().movements.unshift(mov);
    audit(op.id, typeOp, kg(inputKg) + " → " + kg(outputKg), "perte " + kg(lossKg) + " (" + op.lossPct + "%)", "Opération de " + typeOp);
    saveDb();
    return op;
  }

  /* ------------------------------------------------------------------ */
  /*  8. Transfert (§8)                                                 */
  /* ------------------------------------------------------------------ */

  // TRF-FR-01 · Préparer le transfert (calcule les lots contributeurs, R-04).
  function prepareTransfer(cycleId, poids, destination, meta) {
    var cycle = getCycle(cycleId); if (!cycle) throw new Error("Cycle BIN introuvable");
    poids = num(poids); if (poids === null || poids <= 0) throw new Error("Quantité invalide.");
    var parts = allocateFromCycle(cycle, poids);
    // Débit des contributeurs.
    parts.forEach(function (p) {
      var c = cycle.contributors.filter(function (x) { return x.lotId === p.lotId; })[0];
      if (c) c.sorti = round2(c.sorti + p.qty);
    });
    meta = meta || {};
    var trf = {
      id: genId("TRF"), createdAt: nowISO(),
      cycleId: cycle.id, binId: cycle.binId,
      // Destination typée : 'warehouse' (autre entrepôt) ou 'calibrage' (usine).
      destinationType: meta.destinationType === "warehouse" ? "warehouse" : "calibrage",
      destinationSite: meta.destinationSite || "", destination: destination || "Calibrage",
      transporteur: meta.transporteur || "", voyage: meta.voyage || "", chauffeur: meta.chauffeur || "", camion: meta.camion || "",
      poidsEnvoye: poids, poidsRecu: null, ecart: null, transitLossPct: null,
      // Qualité au départ (héritée de la BIN) et à l'arrivée (saisie à la réception).
      qualiteDepart: { kor: num(meta.korDepart), humidity: num(meta.humDepart), nc: num(meta.ncDepart) },
      qualiteArrivee: null,
      contributors: parts.map(function (p) { return { lotId: p.lotId, share: round2(p.share * 100), qty: p.qty, qualite: (getLot(p.lotId) || {}).etat }; }),
      etat: ETAT_TRF.PREPARE,
      validations: { entrepot: { ok: true, at: nowISO(), auteur: (loadDb().user || {}).nom }, qa: null, calibrage: null },
      voyages: []
    };
    loadDb().transfers.unshift(trf);
    var mov = { id: genId("MOV"), type: "sortie_bin", cycleId: cycle.id, binId: cycle.binId, trfId: trf.id, qty: poids, at: nowISO() };
    loadDb().movements.unshift(mov);
    trf.contributors.forEach(function (c) {
      var lot = getLot(c.lotId); if (lot) lot.children.push({ type: "trf", ref: trf.id, qty: c.qty, at: nowISO() });
    });
    audit(trf.id, "transfert", null, ETAT_TRF.PREPARE, "Préparation transfert depuis " + cycle.id);
    saveDb();
    return trf;
  }

  // TRF-FR-02 · Contrôle QA/Lab (bloque les lots non libérés).
  function qaApproveTransfer(trfId, ok, note) {
    var trf = getTrf(trfId); if (!trf) throw new Error("Transfert introuvable");
    var nonLibere = trf.contributors.filter(function (c) { return c.qualite !== ETAT_REC.LIBERE; });
    if (ok && nonLibere.length) throw new Error("Contributeur(s) non libéré(s) : " + nonLibere.map(function (c) { return c.lotId; }).join(", "));
    trf.validations.qa = { ok: !!ok, note: note || "", at: nowISO(), auteur: (loadDb().user || {}).nom };
    trf.etat = ok ? ETAT_TRF.CONTROLE : ETAT_TRF.BROUILLON;
    audit(trf.id, "QA transfert", null, ok ? "APPROUVÉ" : "REJETÉ", note || "");
    saveDb();
    return trf;
  }

  // TRF-FR-03 · Expédier / recevoir (réception partielle possible, calcule l'écart).
  function shipTransfer(trfId) {
    var trf = getTrf(trfId); if (!trf) throw new Error("Transfert introuvable");
    if (!trf.validations.qa || !trf.validations.qa.ok) throw new Error("Contrôle QA requis avant expédition.");
    trf.etat = ETAT_TRF.EXPEDIE;
    audit(trf.id, "transfert", ETAT_TRF.CONTROLE, ETAT_TRF.EXPEDIE, "Expédition");
    saveDb();
    return trf;
  }
  function receiveTransfer(trfId, poidsRecu, partiel, arrivee) {
    var trf = getTrf(trfId); if (!trf) throw new Error("Transfert introuvable");
    poidsRecu = num(poidsRecu);
    trf.voyages.push({ recu: poidsRecu, at: nowISO(), auteur: (loadDb().user || {}).nom });
    var totalRecu = trf.voyages.reduce(function (t, v) { return t + (v.recu || 0); }, 0);
    trf.poidsRecu = round2(totalRecu);
    trf.ecart = round2(trf.poidsEnvoye - trf.poidsRecu);   // = perte de transit (kg)
    trf.transitLossPct = trf.poidsEnvoye ? round2(trf.ecart / trf.poidsEnvoye * 100) : null;
    if (arrivee) trf.qualiteArrivee = { kor: num(arrivee.kor), humidity: num(arrivee.humidity), nc: num(arrivee.nc), at: nowISO() };
    trf.validations.calibrage = { at: nowISO(), auteur: (loadDb().user || {}).nom };
    if (partiel) { trf.etat = ETAT_TRF.PARTIEL; }
    else if (Math.abs(trf.ecart) > 0.001) { trf.etat = ETAT_TRF.ECART; }
    else { trf.etat = ETAT_TRF.RECU; }
    audit(trf.id, "réception TRF", trf.poidsEnvoye, trf.poidsRecu, partiel ? "Réception partielle" : "Réception");
    saveDb();
    return trf;
  }
  // TRF-FR-04 · Traiter un écart (justifier & valider).
  function resolveTransferEcart(trfId, motif) {
    var trf = getTrf(trfId); if (!trf) throw new Error("Transfert introuvable");
    trf.ecartMotif = motif || "";
    trf.etat = ETAT_TRF.RECU;
    audit(trf.id, "écart TRF", trf.ecart, "justifié", motif || "");
    saveDb();
    return trf;
  }

  // Réception d'un transfert ENTREPÔT→ENTREPÔT (ex. Bouaké → Yakro).
  // Le stock inter-entrepôt REPASSE par le cycle qualité complet (re-sampling +
  // décision GM) : on crée donc une RÉCEPTION à destination, reliée au transfert
  // et portant la généalogie vers les lots d'origine. Le lot officiel naîtra
  // après sampling → GM → déchargement → analyse finale, comme une réception
  // fournisseur, mais sa généalogie remonte aux lots d'origine.
  function receiveTransferToWarehouse(trfId, d) {
    var trf = getTrf(trfId); if (!trf) throw new Error("Transfert introuvable");
    if (trf.destinationType !== "warehouse") throw new Error("Ce transfert n'est pas destiné à un entrepôt (destination : " + trf.destinationType + ").");
    var net = num(d.net); if (net === null || net <= 0) throw new Error("Poids net reçu invalide.");
    // Voyage + perte de transit cumulée.
    trf.voyages.push({ recu: net, at: nowISO(), auteur: (loadDb().user || {}).nom });
    var totalRecu = trf.voyages.reduce(function (t, v) { return t + (v.recu || 0); }, 0);
    trf.poidsRecu = round2(totalRecu);
    trf.ecart = round2(trf.poidsEnvoye - trf.poidsRecu);
    trf.transitLossPct = trf.poidsEnvoye ? round2(trf.ecart / trf.poidsEnvoye * 100) : null;
    if (d.kor || d.humidity || d.nc) trf.qualiteArrivee = { kor: num(d.kor), humidity: num(d.humidity), nc: num(d.nc), at: nowISO() };
    trf.etat = d.partiel ? ETAT_TRF.PARTIEL : (Math.abs(trf.ecart) > 0.001 ? ETAT_TRF.ECART : ETAT_TRF.RECU);
    // Création de la réception à destination (repasse par sampling + GM).
    var ratio = trf.poidsEnvoye ? net / trf.poidsEnvoye : 0;
    var rec = createReception({
      camion: trf.camion || trf.voyage || "", fournisseur: "Transfert " + trf.binId,
      origine: "Inter-entrepôt (" + trf.binId + ")", site: trf.destinationSite || d.site || "",
      poidsAnnonce: net, sacsAnnonce: num(d.sacs), refDoc: trf.id,
      fromTransfer: trf.id, binSuggeree: d.binId,
      parents: (trf.contributors || []).map(function (c) { return { lotId: c.lotId, qty: round2(c.qty * ratio) }; })
    });
    audit(trf.id, "réception entrepôt", trf.destinationSite, rec.id, "Transfert reçu → dossier " + rec.id + " (re-sampling requis)");
    saveDb();
    return { trf: trf, rec: rec };
  }

  /* ------------------------------------------------------------------ */
  /*  9. MODULE 2 — Calibrage (§9)                                      */
  /* ------------------------------------------------------------------ */

  // M2-FR-03 · Créer l'opération CAL à partir d'un TRF reçu (hérite contributeurs).
  function createCal(trfId, machine, shift, equipe) {
    var trf = getTrf(trfId); if (!trf) throw new Error("Transfert introuvable");
    if (trf.destinationType === "warehouse")
      throw new Error("Ce transfert est destiné à un entrepôt (" + (trf.destinationSite || "?") + "), pas au calibrage : il doit y être réceptionné (déchargement → lot → BIN).");
    if (trf.etat !== ETAT_TRF.RECU && trf.etat !== ETAT_TRF.PARTIEL && trf.etat !== ETAT_TRF.EXPEDIE)
      throw new Error("Le transfert doit être reçu ou autorisé pour créer une opération CAL (§8.2).");
    var recu = trf.poidsRecu !== null ? trf.poidsRecu : trf.poidsEnvoye;
    var cal = {
      id: genId("CAL"), trfId: trf.id, createdAt: nowISO(),
      machine: machine || "CAL-01", shift: shift || "A", equipe: equipe || "",
      contributors: trf.contributors.slice(),   // hérités, jamais ressaisis (§10.3)
      recu: recu, entreeMachine: 0,
      etat: ETAT_CAL.PRET,
      startedAt: null, endedAt: null,
      feeds: [],       // alimentations machine
      stops: [],       // arrêts
      outputs: [],     // sorties par calibre
      losses: [],      // rejets/pertes/résidus
      events: [],
      validation: null
    };
    loadDb().cals.unshift(cal);
    audit(cal.id, "calibrage", null, ETAT_CAL.PRET, "Création CAL depuis " + trf.id);
    calEvent(cal, "Création CAL");
    saveDb();
    return cal;
  }
  function calEvent(cal, label, qty) {
    cal.events.unshift({ at: nowISO(), label: label, qty: qty === undefined ? null : qty, auteur: (loadDb().user || {}).nom });
  }

  // M2-FR-04 · Démarrer / pause / reprise.
  function calStart(calId) { var c = getCal(calId); if (!c) throw new Error("CAL introuvable"); c.etat = ETAT_CAL.EN_COURS; if (!c.startedAt) c.startedAt = nowISO(); calEvent(c, "Démarrage"); audit(c.id, "calibrage", ETAT_CAL.PRET, ETAT_CAL.EN_COURS, "Démarrage"); saveDb(); return c; }
  function calPause(calId, motif) {
    var c = getCal(calId); if (!c) throw new Error("CAL introuvable");
    if (!motif) throw new Error("Un motif de pause est obligatoire (§M2-FR-04).");
    c.etat = ETAT_CAL.PAUSE; c.stops.push({ id: genId("MOV"), motif: motif, startAt: nowISO(), endAt: null });
    calEvent(c, "Pause : " + motif); audit(c.id, "calibrage", ETAT_CAL.EN_COURS, ETAT_CAL.PAUSE, motif); saveDb(); return c;
  }
  function calResume(calId) {
    var c = getCal(calId); if (!c) throw new Error("CAL introuvable");
    var open = c.stops.filter(function (s) { return !s.endAt; })[0]; if (open) open.endAt = nowISO();
    c.etat = ETAT_CAL.EN_COURS; calEvent(c, "Reprise"); audit(c.id, "calibrage", ETAT_CAL.PAUSE, ETAT_CAL.EN_COURS, "Reprise"); saveDb(); return c;
  }

  // M2-FR-05 · Enregistrer une alimentation machine (ne dépasse pas le reçu).
  function calFeed(calId, poids, binSource) {
    var c = getCal(calId); if (!c) throw new Error("CAL introuvable");
    poids = num(poids); if (poids === null || poids <= 0) throw new Error("Poids invalide.");
    if (c.entreeMachine + poids > c.recu + 0.001) throw new Error("Alimentation supérieure au reçu disponible (" + kg(c.recu - c.entreeMachine) + ").");
    c.feeds.push({ id: genId("MOV"), qty: poids, binSource: binSource || "", at: nowISO() });
    c.entreeMachine = round2(c.entreeMachine + poids);
    calEvent(c, "Alimentation", poids); audit(c.id, "alimentation", null, kg(poids), "Entrée machine"); saveDb(); return c;
  }

  // M2-FR-07 · Sorties par calibre.
  function calOutput(calId, calibre, sacs, poids, binDest) {
    var c = getCal(calId); if (!c) throw new Error("CAL introuvable");
    poids = num(poids); if (poids === null || poids < 0) throw new Error("Poids invalide.");
    var o = { id: c.id + "/" + calibre, calibre: calibre, sacs: num(sacs), poids: poids, binDest: binDest || "", at: nowISO() };
    var ex = c.outputs.filter(function (x) { return x.calibre === calibre; })[0];
    if (ex) { Object.assign(ex, o); } else { c.outputs.push(o); }
    if (c.etat === ETAT_CAL.EN_COURS) c.etat = ETAT_CAL.PARTIEL;
    calEvent(c, "Sortie " + calibre, poids); audit(c.id, "sortie " + calibre, null, kg(poids), "Sortie calibre"); saveDb(); return c;
  }

  // M2-FR-08 · Rejets/pertes/résidus (catégories contrôlées).
  function calLoss(calId, code, poids, destination, justification) {
    var c = getCal(calId); if (!c) throw new Error("CAL introuvable");
    poids = num(poids);
    var l = c.losses.filter(function (x) { return x.code === code; })[0];
    if (!l) { l = { code: code, poids: 0, destination: "", justification: "" }; c.losses.push(l); }
    l.poids = poids; l.destination = destination || ""; l.justification = justification || ""; l.at = nowISO();
    calEvent(c, "Déclaration " + code, poids); saveDb(); return c;
  }

  // M2-FR-10 · Bilan matière : reçu = sorties + pertes + résidu.
  function calBalance(cal) {
    var sorties = cal.outputs.reduce(function (t, o) { return t + (o.poids || 0); }, 0);
    var pertes = cal.losses.filter(function (l) { return l.code !== "residu_machine"; }).reduce(function (t, l) { return t + (l.poids || 0); }, 0);
    var residu = cal.losses.filter(function (l) { return l.code === "residu_machine"; }).reduce(function (t, l) { return t + (l.poids || 0); }, 0);
    var recu = cal.recu || 0;
    var ecart = round2(recu - sorties - pertes - residu);
    return { recu: round2(recu), sorties: round2(sorties), pertes: round2(pertes), residu: round2(residu), ecart: ecart, equilibre: Math.abs(ecart) < 0.001 };
  }

  // M2-FR-11 · Valider & clôturer (bloque quantité négative & écart inexpliqué).
  function calClose(calId, motif) {
    var c = getCal(calId); if (!c) throw new Error("CAL introuvable");
    var b = calBalance(c);
    if (b.sorties < 0 || b.pertes < 0 || b.residu < 0) throw new Error("Quantité négative interdite (§M2-FR-10).");
    if (!b.equilibre && !(motif && motif.trim())) throw new Error("Écart de " + kg(b.ecart) + " : justification obligatoire avant clôture (§9.1).");
    c.etat = ETAT_CAL.CLOS; c.endedAt = nowISO(); c.clotureMotif = motif || "";
    c.validation = { at: nowISO(), auteur: (loadDb().user || {}).nom, bilan: b };
    calEvent(c, "Clôture — bilan " + (b.equilibre ? "équilibré" : "écart " + kg(b.ecart)));
    audit(c.id, "calibrage", c.etat, ETAT_CAL.CLOS, motif || "Bilan équilibré");
    saveDb();
    return c;
  }

  // M2-FR-12 · Généalogie inverse : d'une opération CAL vers les lots officiels.
  function genealogy(calId) {
    var cal = getCal(calId); if (!cal) return null;
    var trf = getTrf(cal.trfId);
    var cycle = trf ? getCycle(trf.cycleId) : null;
    var contributors = (cal.contributors || []).map(function (c) {
      var lot = getLot(c.lotId);
      return { lotId: c.lotId, share: c.share, qty: c.qty, rec: lot ? lot.recId : null, fournisseur: lot ? lot.fournisseur : null, korFinal: lot ? lot.korDisplay : null };
    });
    return { cal: cal, trf: trf, cycle: cycle, contributors: contributors };
  }

  /* ------------------------------------------------------------------ */
  /* 10. Indicateurs / tableau de bord                                  */
  /* ------------------------------------------------------------------ */
  function dashboard() {
    var recs = receptions();
    return {
      camionsEnAttente: recs.filter(function (r) { return [ETAT_REC.ARRIVEE, ETAT_REC.SAMPLING, ETAT_REC.ATTENTE_GM].indexOf(r.etat) >= 0; }).length,
      decisionGm: recs.filter(function (r) { return r.etat === ETAT_REC.ATTENTE_GM; }).length,
      lotsBloques: recs.filter(function (r) { return r.etat === ETAT_REC.BLOQUE; }).length,
      transfertsOuverts: transfers().filter(function (t) { return [ETAT_TRF.PREPARE, ETAT_TRF.CONTROLE, ETAT_TRF.EXPEDIE, ETAT_TRF.PARTIEL].indexOf(t.etat) >= 0; }).length,
      transfertsARecevoir: transfers().filter(function (t) { return [ETAT_TRF.EXPEDIE, ETAT_TRF.CONTROLE].indexOf(t.etat) >= 0; }).length,
      calEnCours: cals().filter(function (c) { return [ETAT_CAL.EN_COURS, ETAT_CAL.PARTIEL, ETAT_CAL.PAUSE].indexOf(c.etat) >= 0; }).length,
      calAValider: cals().filter(function (c) { return [ETAT_CAL.RAPPROCHER, ETAT_CAL.VALIDER, ETAT_CAL.PARTIEL].indexOf(c.etat) >= 0; }).length
    };
  }

  /* ------------------------------------------------------------------ */
  /* 11. Données de démonstration (reprennent les exemples du cahier)   */
  /* ------------------------------------------------------------------ */
  function seedDemo(force) {
    var db = loadDb();
    if (db.seeded && !force) return;
    if (force) { _db = emptyDb(); db = _db; }

    // Fournisseurs réels (coopératives + code LBA), site Bouaké, BIN <WH>-BIN-nn.
    var F = FOURNISSEURS; var SITE = "BKE-002";
    // Exemple fourni §6.2 : ligne 1 → GK 267, IMM 0, SP 15 → KOR 48.41
    var rec1 = createReception({ camion: "827KT01", fournisseur: F[0].nom, lba: F[0].lba, origine: "Korhogo", site: SITE, poidsAnnonce: 12000, sacsAnnonce: 150, refDoc: "0401-0007" });
    saveSampling(rec1.id, { gk: 267, imm: 0, spotted: 15, nc: 210, humidity: 7.2, browns: 4, voids: 3, oil: 1 });
    submitToGm(rec1.id);
    gmDecision(rec1.id, true, "Déchargement autorisé", null);
    saveDechargement(rec1.id, { whReceipt: "72515", ficheCca: "0401-0007", binDecharge: "BKE-002-BIN-017", sacsBon: 143, sacsHumid: 0, sacsDechire: 7, brut: 12100, tare: 100, poidsMainDoeuvre: 45, prestataire: "SONEL TRANS", destination: "BKE-002" });
    // Analyse finale §7 slide : KOR final 47.80, écart 0.61 → libéré
    var r1 = saveFinaleAndRelease(rec1.id, { gk: 262, imm: 0, spotted: 18, nc: 208, humidity: 7.0, browns: 5, voids: 3, oil: 2 }, "liberer", null);

    // Deux autres lots pour la BIN collective (60/25/15)
    var rec2 = createReception({ camion: "793LT03", fournisseur: F[1].nom, lba: F[1].lba, origine: "Séguéla", site: SITE, poidsAnnonce: 5000, sacsAnnonce: 62, refDoc: "0429-0040" });
    saveSampling(rec2.id, { gk: 261, imm: 0, spotted: 11, nc: 199, humidity: 6.8, browns: 6, voids: 2, oil: 1 });
    submitToGm(rec2.id); gmDecision(rec2.id, true, "OK", null);
    saveDechargement(rec2.id, { whReceipt: "72533", ficheCca: "0429-0040", binDecharge: "BKE-002-BIN-017", sacsBon: 60, sacsHumid: 0, sacsDechire: 2, brut: 2520, tare: 20, poidsMainDoeuvre: 18, prestataire: "SONEL TRANS", destination: "BKE-002" });
    var r2 = saveFinaleAndRelease(rec2.id, { gk: 258, imm: 0, spotted: 18, nc: 197, humidity: 6.9, browns: 6, voids: 3, oil: 1 }, "liberer", null);

    var rec3 = createReception({ camion: "3334FN01", fournisseur: F[7].nom, lba: F[7].lba, origine: "Mankono", site: SITE, poidsAnnonce: 2000, sacsAnnonce: 25, refDoc: "0525-0068" });
    saveSampling(rec3.id, { gk: 266, imm: 0, spotted: 12, nc: 205, humidity: 7.1, browns: 3, voids: 2, oil: 1 });
    submitToGm(rec3.id); gmDecision(rec3.id, true, "OK", null);
    saveDechargement(rec3.id, { whReceipt: "72534", ficheCca: "0525-0068", binDecharge: "BKE-002-BIN-017", sacsBon: 24, sacsHumid: 0, sacsDechire: 1, brut: 1520, tare: 20, poidsMainDoeuvre: 10, prestataire: "SONEL TRANS", destination: "BKE-002" });
    // Analyse finale proche du sampling (écart < 1) → lot libéré.
    var r3 = saveFinaleAndRelease(rec3.id, { gk: 265, imm: 0, spotted: 12, nc: 202, humidity: 7.1, browns: 4, voids: 3, oil: 1 }, "liberer", null);

    // BIN BKE-002-BIN-017 : compositions (poids ajustés pour 60/25/15 sur 10 000 kg)
    var cycle = openBinCycle("BKE-002-BIN-017", "RCN standard Nord", 12000);
    if (r1.lot) { r1.lot.stock = 6000; addLotToBin("BKE-002-BIN-017", r1.lot.id, 6000); }
    if (r2.lot) { r2.lot.stock = 2500; addLotToBin("BKE-002-BIN-017", r2.lot.id, 2500); }
    if (r3.lot) { r3.lot.stock = 1500; addLotToBin("BKE-002-BIN-017", r3.lot.id, 1500); }

    // Un dossier en attente de décision GM (dashboard : 1 décision requise).
    var rec4 = createReception({ camion: "8287GH03", fournisseur: F[2].nom, lba: F[2].lba, origine: "Niakara", site: SITE, poidsAnnonce: 9000, sacsAnnonce: 112, refDoc: "0426-0187" });
    saveSampling(rec4.id, { gk: 259, imm: 0, spotted: 14, nc: 201, humidity: 7.3, browns: 5, voids: 3, oil: 2 });
    submitToGm(rec4.id);

    // Un lot bloqué qualité (écart KOR ≥ 1).
    var rec5 = createReception({ camion: "4731CR04", fournisseur: F[4].nom, lba: F[4].lba, origine: "Dabakala", site: SITE, poidsAnnonce: 8000, sacsAnnonce: 100, refDoc: "0429-0041" });
    saveSampling(rec5.id, { gk: 270, imm: 0, spotted: 10, nc: 214, humidity: 6.5, browns: 3, voids: 2, oil: 1 });
    submitToGm(rec5.id); gmDecision(rec5.id, true, "OK", null);
    saveDechargement(rec5.id, { whReceipt: "72540", ficheCca: "0429-0041", binDecharge: "BKE-002-BIN-020", sacsBon: 95, sacsHumid: 3, sacsDechire: 2, brut: 8050, tare: 50, poidsMainDoeuvre: 30, prestataire: "CAMARA MAGAH", destination: "BKE-002" });
    saveFinaleAndRelease(rec5.id, { gk: 250, imm: 0, spotted: 20, nc: 190, humidity: 7.6, browns: 8, voids: 5, oil: 3 }, "liberer", null); // écart ≥ 1 → bloqué

    // TRF-0001 : Bouaké → ENTREPÔT Yakro (pas l'usine), 5 000 kg (60/25/15).
    var trf = prepareTransfer(cycle.id, 5000, "Entrepôt YAKRO", { destinationType: "warehouse", destinationSite: "YAKRO-01", transporteur: "SONEL TRANS", voyage: "BKT001", chauffeur: "TRAORE BAKARY", camion: "1796GC01", korDepart: 47.6, humDepart: 9.5, ncDepart: 172 });
    qaApproveTransfer(trf.id, true, "Contrôle OK");
    shipTransfer(trf.id);
    // Réception à Yakro : le transfert crée un dossier qui REPASSE par sampling + GM.
    var yakroCyc = openBinCycle("YAKRO-BIN-01", "RCN standard", 20000);
    var arr = receiveTransferToWarehouse(trf.id, { net: 4950, sacs: 300, kor: 47.5, humidity: 9.4, nc: 174 });
    resolveTransferEcart(trf.id, "Perte de transit constatée et validée");
    // Re-sampling + décision GM + déchargement + analyse finale à Yakro.
    saveSampling(arr.rec.id, { gk: 262, imm: 0, spotted: 14, nc: 174, humidity: 9.4, browns: 5, voids: 3, oil: 1 });
    submitToGm(arr.rec.id); gmDecision(arr.rec.id, true, "OK", null);
    saveDechargement(arr.rec.id, { whReceipt: "82001", ficheCca: trf.id, binDecharge: "YAKRO-BIN-01", sacsBon: 295, sacsHumid: 3, sacsDechire: 2, brut: 5000, tare: 50, net: 4950 });
    saveFinaleAndRelease(arr.rec.id, { gk: 260, imm: 0, spotted: 15, nc: 176, humidity: 9.2, browns: 5, voids: 3, oil: 2 }, "liberer", "YAKRO-BIN-01");

    // Livraison DIRECTE d'un fournisseur à Yakro (cycle complet sampling + GM).
    var recy = createReception({ camion: "5521YK02", fournisseur: F[5].nom, lba: F[5].lba, origine: "Bouaké", site: "YAKRO-01", poidsAnnonce: 6000, sacsAnnonce: 75, refDoc: "YK-0001" });
    saveSampling(recy.id, { gk: 264, imm: 0, spotted: 13, nc: 176, humidity: 9.2, browns: 5, voids: 3, oil: 1 });
    submitToGm(recy.id); gmDecision(recy.id, true, "OK", null);
    saveDechargement(recy.id, { whReceipt: "81001", ficheCca: "YK-0001", binDecharge: "YAKRO-BIN-01", sacsBon: 73, sacsHumid: 0, sacsDechire: 2, brut: 6050, tare: 50, poidsMainDoeuvre: 20, prestataire: "MAGAH TRANS", destination: "YAKRO" });
    saveFinaleAndRelease(recy.id, { gk: 262, imm: 0, spotted: 14, nc: 174, humidity: 9.0, browns: 5, voids: 3, oil: 2 }, "liberer", "YAKRO-BIN-01");

    // Séchage à Bouaké : 2 000 kg de BIN-017 (humidité 11 %→9,5 %), perte ~1,7 %.
    createDrying(cycle.id, "BKE-002-BIN-003-DRIED", { type: "sechage", inputKg: 2000, outputKg: 1966, inputSacs: 120, outputSacs: 118, inputMoisture: 11, outputMoisture: 9.5, inputNc: 161, outputNc: 176, inputKor: 47.97, outputKor: 47.26 });

    // TRF-0002 : Yakro → CALIBRAGE (usine), 4 000 kg depuis YAKRO-BIN-01.
    var trf2 = prepareTransfer(yakroCyc.id, 4000, "Calibrage · Usine", { destinationType: "calibrage", transporteur: "USINE LOG", voyage: "YKT001" });
    qaApproveTransfer(trf2.id, true, "Contrôle OK");
    shipTransfer(trf2.id);

    // BIN planifiées.
    openBinCycle("BKE-002-BIN-019", "RCN standard", 10000);

    db.seeded = true;
    saveDb();
  }

  /* ------------------------------------------------------------------ */
  /* 12. Export API                                                     */
  /* ------------------------------------------------------------------ */
  global.RCN = {
    // constantes
    KOR_FACTOR: KOR_FACTOR, KOR_FORMULA: KOR_FORMULA, KOR_TOLERANCE: KOR_TOLERANCE,
    CALIBRES: CALIBRES, CALIBRE_LABELS: CALIBRE_LABELS, CATEGORIES_PERTE: CATEGORIES_PERTE, MOTIFS_ARRET: MOTIFS_ARRET, FOURNISSEURS: FOURNISSEURS, ORIGINES: ORIGINES, ENTREPOTS: ENTREPOTS, CATEGORIES_SAC: CATEGORIES_SAC,
    ETAT_REC: ETAT_REC, ETAT_BIN: ETAT_BIN, ETAT_TRF: ETAT_TRF, ETAT_CAL: ETAT_CAL,
    // magasin
    db: loadDb, save: saveDb, reset: resetDb, seedDemo: seedDemo,
    // utilitaires exposés à l'UI
    num: num, kg: kg, pct: pct, round2: round2, fmtDateTime: fmtDateTime, fmtTime: fmtTime, today: today,
    // qualité
    computeKor: computeKor, totalDefect: totalDefect, totalKernels: totalKernels, ecartKor: ecartKor, ecartConforme: ecartConforme,
    // collections
    receptions: receptions, lots: lots, transfers: transfers, cals: cals, binCycles: binCycles, auditLog: auditLog, referentials: referentials, movements: movements, dryings: dryings,
    getRec: getRec, getLot: getLot, getCycle: getCycle, getTrf: getTrf, getCal: getCal, getDrying: getDrying, binStock: binStock, lotQuality: lotQuality,
    // module 1
    createReception: createReception, saveSampling: saveSampling, submitToGm: submitToGm, gmDecision: gmDecision,
    saveDechargement: saveDechargement, saveFinaleAndRelease: saveFinaleAndRelease,
    // BIN & séchage
    openBinCycle: openBinCycle, addLotToBin: addLotToBin, allocateFromCycle: allocateFromCycle, createDrying: createDrying,
    closeBinCycle: closeBinCycle, binTotals: binTotals, binDurationH: binDurationH,
    // transfert
    prepareTransfer: prepareTransfer, qaApproveTransfer: qaApproveTransfer, shipTransfer: shipTransfer, receiveTransfer: receiveTransfer, receiveTransferToWarehouse: receiveTransferToWarehouse, resolveTransferEcart: resolveTransferEcart,
    // calibrage
    createCal: createCal, calStart: calStart, calPause: calPause, calResume: calResume, calFeed: calFeed, calOutput: calOutput, calLoss: calLoss, calBalance: calBalance, calClose: calClose, genealogy: genealogy,
    // dashboard / audit
    dashboard: dashboard, audit: audit
  };
})(window);
