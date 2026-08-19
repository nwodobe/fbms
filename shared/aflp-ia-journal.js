/* ============================================================================
   ASSISTANT IA AFLP — JOURNAL DES QUESTIONS (shared/aflp-ia-journal.js)
   ----------------------------------------------------------------------------
   Enregistre CE QUE L'ASSISTANT A COMPRIS, pour pouvoir le mesurer et le
   corriger. Sans ce journal, la seule mesure disponible serait l'absence de
   plainte — c'est-à-dire aucune mesure.

   CE QUI EST ENREGISTRÉ
     · la question, caviardée (voir `caviarder`) ;
     · l'intention, la portée, la période et la confiance détectées ;
     · le statut du résultat et un résumé borné de la réponse ;
     · les versions du moteur et du catalogue, la latence, la date de référence.

   CE QUI N'EST JAMAIS ENREGISTRÉ
     · aucun détail ligne à ligne d'achat, d'avance ou de réconciliation ;
     · aucun nom de producteur, aucun numéro de téléphone, aucun montant
       individuel — le caviardage retire les suites de chiffres longues avant
       même que la question quitte le navigateur ;
     · aucune clé, aucun jeton.

   MODE HORS LIGNE — la contrainte structurante de ce fichier
   Le terrain travaille sans réseau. Une question posée hors ligne doit être
   répondue (le moteur déterministe le fait) ET journalisée plus tard. D'où :
     · une file locale dans `localStorage` ;
     · une `cle_idempotence` générée AU MOMENT DE LA QUESTION, pas à l'envoi ;
     · une entrée locale qui n'est effacée QU'APRÈS accusé de réception serveur.
   Si l'ordre était inversé, une coupure au mauvais moment perdrait la question
   ou la compterait deux fois. Les deux faussent la mesure.

   INERTE PAR DÉFAUT
   Tant que la migration `docs/migrations/aflp_ia_journal_20260815.sql` n'est
   pas appliquée, la table n'existe pas : le premier envoi échoue avec un code
   PostgREST de table inconnue, et le journal se met en veille définitivement
   pour la session. L'assistant continue de répondre normalement. Le frontend
   peut donc être livré AVANT la migration, sans livraison coordonnée.
   ========================================================================== */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";
  var CLE_FILE = "aflp_ia_journal_file";
  var CLE_ARRET = "aflp_ia_journal_arret";
  var TABLE = "aflp_ia_questions";
  var TABLE_FEEDBACK = "aflp_ia_feedback";
  var MAX_FILE = 200;          // entrées conservées localement au maximum
  var MAX_LOT = 25;            // entrées envoyées par lot

  var CLIENT = null;           // client Supabase fourni par la page
  var PROFIL = null;           // { role: "Branch Manager" } — jamais l'e-mail
  var ACTIF = true;
  var INDISPONIBLE = false;    // table absente : on se tait pour la session
  var DERNIERE_ERREUR = "";

  /* --------------------------------------------------------------------------
     Stockage local — toujours défensif : `localStorage` peut être indisponible
     (mode privé, quota plein). Un journal qui casse la page qu'il observe est
     pire que pas de journal.
     ------------------------------------------------------------------------ */

  function lire() {
    try {
      var brut = global.localStorage && global.localStorage.getItem(CLE_FILE);
      var v = brut ? JSON.parse(brut) : [];
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function ecrire(file) {
    try {
      if (file.length > MAX_FILE) file = file.slice(file.length - MAX_FILE);
      global.localStorage && global.localStorage.setItem(CLE_FILE, JSON.stringify(file));
      return true;
    } catch (e) { return false; }
  }

  /* Identifiant d'idempotence. `crypto.randomUUID` quand il existe ; sinon une
     composition horodatée. Ce n'est pas un secret : c'est une clé de
     déduplication, et elle n'a besoin que d'être unique. */
  function identifiant() {
    try {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    } catch (e) { /* certains navigateurs refusent randomUUID hors HTTPS */ }
    return "q-" + Date.now().toString(36) + "-" +
      Math.floor(Math.random() * 1e9).toString(36);
  }

  /* --------------------------------------------------------------------------
     Caviardage
     --------------------------------------------------------------------------
     Une question est un texte libre : rien n'empêche d'y écrire un numéro de
     téléphone ou un identifiant de producteur. On retire donc, AVANT tout
     envoi :
       · les suites de 6 chiffres ou plus (identifiants, montants saisis,
         numéros de reçu) ;
       · les numéros de téléphone ivoiriens, avec ou sans indicatif ;
       · les adresses électroniques.
     Les nombres courts sont conservés : « 7 jours », « GBEKE 1 », « 3000 MT »
     sont porteurs de sens et sans risque.
     ------------------------------------------------------------------------ */
  function caviarder(texte) {
    return String(texte == null ? "" : texte)
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[courriel]")
      .replace(/(\+?225[\s.-]?)?(?:\d[\s.-]?){10,}/g, "[numéro]")
      .replace(/\b\d{6,}\b/g, "[nombre]")
      .slice(0, 500);
  }

  /* --------------------------------------------------------------------------
     Statut du résultat — dérivé de la réponse du moteur, jamais saisi à la main
     ------------------------------------------------------------------------ */
  function statutResultat(reponse) {
    if (!reponse) return "erreur_technique";
    var c = reponse.contrat;
    if (!c || !c.intent) return "non_compris";
    if (c.requires_clarification) return "clarification_demandee";
    if (reponse.intention && reponse.intention.statut === "non_disponible") return "donnee_indisponible";
    if (reponse.confiance === "nulle") return "non_compris";
    if (reponse.confiance === "faible" || reponse.confiance === "moyenne") return "partiellement_compris";
    return "reponse_produite";
  }

  function typeReponse(reponse) {
    if (!reponse) return "aucune";
    var c = reponse.contrat;
    if (c && c.requires_clarification) return "clarification";
    if (reponse.confiance === "nulle") return "refus";
    if (reponse.chiffres && reponse.chiffres.length > 1) return "liste";
    if (reponse.chiffres && reponse.chiffres.length === 1) return "chiffre";
    return "texte";
  }

  /* --------------------------------------------------------------------------
     Enregistrement
     ------------------------------------------------------------------------ */

  function configurer(options) {
    options = options || {};
    if (options.client) CLIENT = options.client;
    if (options.profil) PROFIL = { role: options.profil.role || "" };
    if (options.actif === false) ACTIF = false;
    if (options.actif === true) { ACTIF = true; INDISPONIBLE = false; }
    /* Interrupteur d'arrêt persistant : une fois posé, il survit au
       rechargement. C'est ce qui permet de couper la journalisation depuis un
       poste, sans redéploiement. */
    try {
      if (global.localStorage && global.localStorage.getItem(CLE_ARRET) === "1") ACTIF = false;
    } catch (e) { /* stockage indisponible : on reste sur la valeur en mémoire */ }
    return etat();
  }

  function arreter(motif) {
    ACTIF = false;
    DERNIERE_ERREUR = motif || "arrêt demandé";
    try { global.localStorage && global.localStorage.setItem(CLE_ARRET, "1"); } catch (e) { }
    return etat();
  }

  function reprendre() {
    ACTIF = true;
    INDISPONIBLE = false;
    DERNIERE_ERREUR = "";
    try { global.localStorage && global.localStorage.removeItem(CLE_ARRET); } catch (e) { }
    return etat();
  }

  /* Construit et met en file une entrée de journal.
     `question` est le texte brut saisi, `reponse` le retour de
     AFLP_IA.repondre, `latenceMs` la durée mesurée par l'appelant. */
  function enregistrer(question, reponse, latenceMs) {
    if (!ACTIF) return null;
    var c = (reponse && reponse.contrat) || null;
    var entree = {
      cle_idempotence: identifiant(),
      user_role: (PROFIL && PROFIL.role) || null,
      question_raw: caviarder(question),
      question_normalized: caviarder(
        (reponse && reponse.trace && reponse.trace.normalise) || ""),
      detected_intent: c ? c.intent : null,
      detected_scope_type: c && c.scope ? c.scope.type : null,
      detected_scope_id: c && c.scope ? (c.scope.id || null) : null,
      detected_period: c ? c.period : null,
      confidence: c ? c.confidence : null,
      result_status: statutResultat(reponse),
      answer_type: typeReponse(reponse),
      answer_summary: reponse && reponse.texte ? String(reponse.texte).slice(0, 500) : null,
      data_reference_date: (reponse && reponse.dateReference) || null,
      engine_version: (reponse && reponse.versionMoteur) || null,
      catalog_version: (reponse && reponse.versionCatalogue) || null,
      language_layer_used: !!(reponse && reponse.coucheLinguistique),
      latency_ms: latenceMs == null ? null : Math.max(0, Math.round(latenceMs)),
      error_code: (reponse && reponse.erreurCode) || null,
      origine: estEnLigne() ? "en_ligne" : "file_locale"
    };
    /* `question_normalized` est obligatoire côté base : à défaut de trace, on
       retombe sur la question caviardée plutôt que d'envoyer une ligne que la
       contrainte rejettera. */
    if (!entree.question_normalized) entree.question_normalized = entree.question_raw;

    var file = lire();
    file.push(entree);
    ecrire(file);
    /* Envoi opportuniste. Un échec n'a aucune conséquence visible : l'entrée
       reste en file et repartira au prochain passage. */
    synchroniser();
    return entree.cle_idempotence;
  }

  function estEnLigne() {
    try { return global.navigator ? global.navigator.onLine !== false : true; }
    catch (e) { return true; }
  }

  /* --------------------------------------------------------------------------
     Synchronisation
     --------------------------------------------------------------------------
     Règle non négociable : on ne retire une entrée de la file locale QU'APRÈS
     accusé de réception du serveur. L'ordre inverse perd des questions dès la
     première coupure au mauvais moment.
     ------------------------------------------------------------------------ */

  function synchroniser() {
    if (!ACTIF || INDISPONIBLE || !CLIENT || !estEnLigne()) {
      return Promise.resolve({ envoyees: 0, restantes: lire().length });
    }
    var file = lire();
    if (!file.length) return Promise.resolve({ envoyees: 0, restantes: 0 });

    var lot = file.slice(0, MAX_LOT);
    var cles = {};
    lot.forEach(function (e) { cles[e.cle_idempotence] = true; });

    return CLIENT.from(TABLE)
      /* `ignoreDuplicates` sur la clé d'idempotence : un rejeu après coupure ne
         crée pas de doublon, et n'échoue pas non plus. */
      .upsert(lot, { onConflict: "cle_idempotence", ignoreDuplicates: true })
      .then(function (res) {
        if (res && res.error) return echec(res.error);
        var reste = lire().filter(function (e) { return !cles[e.cle_idempotence]; });
        ecrire(reste);
        DERNIERE_ERREUR = "";
        return { envoyees: lot.length, restantes: reste.length };
      }, function (err) { return echec(err); });
  }

  /* Codes PostgREST de « table ou colonne inconnue ». Ils signifient que la
     migration n'est pas appliquée — pas qu'il y a un incident. On se met en
     veille sans rien signaler à l'utilisateur, qui n'y peut rien. */
  var CODES_ABSENCE = ["PGRST202", "PGRST205", "42P01", "42703"];

  function echec(err) {
    var code = (err && (err.code || err.status)) || "";
    DERNIERE_ERREUR = code || (err && err.message) || "erreur inconnue";
    if (CODES_ABSENCE.indexOf(String(code)) >= 0) {
      INDISPONIBLE = true;
      DERNIERE_ERREUR = "journal serveur non installé (migration non appliquée)";
    }
    return { envoyees: 0, restantes: lire().length, erreur: DERNIERE_ERREUR };
  }

  /* --------------------------------------------------------------------------
     Retour utilisateur
     --------------------------------------------------------------------------
     Un retour n'est PAS une preuve d'exactitude : un utilisateur satisfait
     d'un chiffre faux le valide tout aussi volontiers qu'un chiffre juste.
     Le retour sert à ORIENTER LA REVUE HUMAINE, jamais à conclure seul.
     ------------------------------------------------------------------------ */
  function retour(cleIdempotence, type, commentaire) {
    if (!CLIENT || INDISPONIBLE) {
      return Promise.resolve({ ok: false, motif: "journal serveur indisponible" });
    }
    var TYPES = ["reponse_correcte", "reponse_incorrecte", "intention_incorrecte",
      "portee_incorrecte", "periode_incorrecte", "hors_perimetre", "a_entrainer"];
    if (TYPES.indexOf(type) < 0) {
      return Promise.resolve({ ok: false, motif: "type de retour inconnu : " + type });
    }
    return CLIENT.from(TABLE).select("id").eq("cle_idempotence", cleIdempotence).limit(1)
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) {
          return { ok: false, motif: "question non encore synchronisée" };
        }
        return CLIENT.from(TABLE_FEEDBACK).insert({
          question_id: res.data[0].id,
          feedback_type: type,
          comment: commentaire ? caviarder(commentaire).slice(0, 1000) : null,
          approval_status: "en_attente"
        }).then(function (r2) {
          return r2.error ? { ok: false, motif: r2.error.message } : { ok: true };
        });
      });
  }

  /* --------------------------------------------------------------------------
     Métriques locales
     --------------------------------------------------------------------------
     Calculées sur la file NON ENCORE SYNCHRONISÉE : elles ne remplacent pas la
     vue `aflp_ia_metriques`, qui seule voit l'ensemble. Elles servent au mode
     hors ligne et à vérifier que le dispositif tourne.
     ------------------------------------------------------------------------ */
  function metriquesLocales() {
    var file = lire();
    var m = {
      enFile: file.length,
      parStatut: {}, parIntention: {}, parPortee: {},
      latenceMoyenneMs: null, coucheLinguistique: 0
    };
    var sommeLatence = 0, nLatence = 0;
    file.forEach(function (e) {
      m.parStatut[e.result_status] = (m.parStatut[e.result_status] || 0) + 1;
      var i = e.detected_intent || "(non reconnue)";
      m.parIntention[i] = (m.parIntention[i] || 0) + 1;
      var p = e.detected_scope_type || "(aucune)";
      m.parPortee[p] = (m.parPortee[p] || 0) + 1;
      if (e.latency_ms != null) { sommeLatence += e.latency_ms; nLatence++; }
      if (e.language_layer_used) m.coucheLinguistique++;
    });
    if (nLatence) m.latenceMoyenneMs = Math.round(sommeLatence / nLatence);
    return m;
  }

  function etat() {
    return {
      version: VERSION,
      actif: ACTIF,
      clientConfigure: !!CLIENT,
      journalServeurDisponible: !ACTIF ? null : !INDISPONIBLE,
      enFile: lire().length,
      derniereErreur: DERNIERE_ERREUR
    };
  }

  global.AFLP_IA_JOURNAL = {
    version: VERSION,
    configurer: configurer,
    enregistrer: enregistrer,
    synchroniser: synchroniser,
    retour: retour,
    metriquesLocales: metriquesLocales,
    etat: etat,
    arreter: arreter,
    reprendre: reprendre,
    /* Exposés pour le banc d'essai : le caviardage et la dérivation du statut
       sont des règles, elles doivent être testables sans navigateur. */
    caviarder: caviarder,
    statutResultat: statutResultat,
    typeReponse: typeReponse
  };
  if (typeof module === "object" && module.exports) module.exports = global.AFLP_IA_JOURNAL;

})(typeof window !== "undefined" ? window : this);
