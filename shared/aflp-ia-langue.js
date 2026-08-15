/* ============================================================================
   ASSISTANT IA AFLP — COUCHE LINGUISTIQUE (shared/aflp-ia-langue.js)
   ----------------------------------------------------------------------------
   Client d'une fonction serveur d'interprétation. DÉSACTIVÉE PAR DÉFAUT.

   CE QU'ELLE A LE DROIT DE FAIRE
     Transformer une question mal formulée en un CONTRAT structuré :
     intention, portée, période, filtres, confiance, besoin de clarification.
     C'est tout. Le contrat est ensuite revalidé contre le schéma fermé du
     catalogue, puis exécuté par le moteur déterministe.

   CE QU'ELLE NE PEUT PAS FAIRE, par construction et non par consigne
     · produire un chiffre — elle n'en reçoit aucun (voir `charge utile` §3) ;
     · générer du SQL — elle ne parle à aucune base ;
     · appeler une fonction de mutation — le moteur n'expose que des lectures,
       et `AFLP_IA.fonctionsDisponibles` en est la liste close ;
     · être jointe depuis le navigateur sans passer par le serveur — aucune clé
       de fournisseur n'existe côté client, et ce fichier n'en lit aucune.

   ÉTAT AU 2026-08-15 : AUCUN FOURNISSEUR N'EST CONFIGURÉ SUR CE PROJET.
   Le drapeau est à `false`, la fonction Edge n'est pas déployée, et aucun
   secret serveur n'existe. Ce fichier est donc l'INTERFACE TECHNIQUE prête à
   l'emploi, et rien d'autre : tant que `activee()` retourne faux, aucun appel
   réseau n'est émis. La configuration restante est décrite dans
   docs/aflp_ia_langue_apprentissage_20260815.md §« Activation ».

   ORDRE DE TRAITEMENT
     question
       → moteur déterministe
       → si confiance suffisante : calcul déterministe, on s'arrête là
       → sinon couche linguistique (si activée)
       → validation stricte du contrat
       → fonction déterministe autorisée
       → réponse
   ========================================================================== */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";
  var FONCTION = "aflp-ia-langue";     // nom de la fonction Edge côté serveur

  /* -- Réglages. Tous modifiables par `configurer`, aucun n'est un secret. -- */
  var CFG = {
    active: false,          // FEATURE FLAG — faux tant que le serveur n'existe pas
    tueur: false,           // KILL SWITCH — vrai coupe tout, y compris si active=true
    seuilAppel: 0.62,       // en dessous, on tente l'interprétation linguistique
    timeoutMs: 6000,        // au-delà, on abandonne et on retombe sur le déterministe
    minIntervalleMs: 1500,  // limitation de débit : un appel au plus par 1,5 s
    maxParSession: 60,      // plafond dur par session de navigation
    journaliserCout: true
  };

  var ETAT = {
    appels: 0, refus: 0, echecs: 0, expirations: 0,
    dernierAppelMs: 0, derniereErreur: "", tokens: 0, coutEstime: 0,
    indisponible: false     // le serveur a répondu « fonction inconnue »
  };

  var CLIENT = null;        // client Supabase — c'est LUI qui porte la session

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

  function configurer(options) {
    options = options || {};
    if (options.client) CLIENT = options.client;
    ["active", "tueur", "journaliserCout"].forEach(function (k) {
      if (typeof options[k] === "boolean") CFG[k] = options[k];
    });
    ["seuilAppel", "timeoutMs", "minIntervalleMs", "maxParSession"].forEach(function (k) {
      if (typeof options[k] === "number" && isFinite(options[k])) CFG[k] = options[k];
    });
    return etat();
  }

  /* Lecture du drapeau depuis `parametres_calcul`. Le paramètre serveur PEUT
     désactiver, il ne peut jamais activer à lui seul : sans fonction Edge
     déployée, `active` reste faux et le premier appel se solderait par une
     mise en veille. C'est volontaire — un drapeau en base ne doit pas pouvoir
     mettre en service un composant qui n'existe pas. */
  function appliquerParametres(parametres) {
    (parametres || []).forEach(function (p) {
      if (!p) return;
      if (p.cle === "aflp_ia_langue_active") CFG.active = String(p.valeur) === "true";
      if (p.cle === "aflp_ia_langue_kill") CFG.tueur = String(p.valeur) === "true";
      if (p.cle === "aflp_ia_langue_timeout_ms") {
        var t = Number(p.valeur);
        if (isFinite(t) && t > 0) CFG.timeoutMs = t;
      }
    });
    return etat();
  }

  function couper(motif) {
    CFG.tueur = true;
    ETAT.derniereErreur = motif || "kill switch actionné";
    return etat();
  }

  function activee() {
    return !!(CFG.active && !CFG.tueur && !ETAT.indisponible && CLIENT);
  }

  /* --------------------------------------------------------------------------
     Limitation de débit — côté client, en complément de celle du serveur.
     Deux barrières valent mieux qu'une : celle-ci protège le coût même si la
     fonction serveur est mal configurée.
     ------------------------------------------------------------------------ */
  function debitAutorise() {
    if (ETAT.appels >= CFG.maxParSession) return "plafond de session atteint";
    var maintenant = Date.now();
    if (maintenant - ETAT.dernierAppelMs < CFG.minIntervalleMs) return "appels trop rapprochés";
    return null;
  }

  /* --------------------------------------------------------------------------
     Charge utile — le point le plus important de ce fichier
     --------------------------------------------------------------------------
     On envoie : la question caviardée, et le VOCABULAIRE du catalogue publié
     (codes d'intention, noms métier, types de portée, périodes). Plus les noms
     des zones et clusters, sans lesquels « Béoumi » ne peut pas être situé.

     On n'envoie JAMAIS : un volume, un montant, un solde, un nom de producteur,
     un identifiant de transaction, la réponse déterministe, ni le contenu de
     l'état FBMS. Le fournisseur ne peut donc pas produire un chiffre : il n'en
     a aucun.
     ------------------------------------------------------------------------ */
  function chargeUtile(question, contexte) {
    var cat = catalogue();
    var caviarder = (global.AFLP_IA_JOURNAL && global.AFLP_IA_JOURNAL.caviarder)
      || function (s) { return String(s || "").slice(0, 500); };
    return {
      question: caviarder(question),
      catalogue: {
        version: cat.version,
        intentions: cat.publiees().map(function (i) {
          return {
            code: i.code, nom: i.nom, description: i.description,
            portees: i.porteesAutorisees, periodes: i.periodesAutorisees,
            filtres: i.filtresAutorises,
            exemples: (i.formulations || []).slice(0, 3)
          };
        }),
        portees: cat.portees, periodes: cat.periodes,
        filtres: cat.filtres, breakdowns: cat.breakdowns, statuts: cat.statutsFiltre
      },
      /* Uniquement des NOMS de lieux et d'équipes : de quoi situer une
         question, jamais de quoi en déduire un chiffre. */
      lieux: {
        zones: (contexte && contexte.zones) || [],
        clusters: ((contexte && contexte.clusters) || []).map(function (c) { return c.label; }),
        villages: ((contexte && contexte.villages) || []).map(function (v) { return v.nom; }).slice(0, 200),
        equipes: ((contexte && contexte.rt) || []).map(function (r) { return r.nom; }).slice(0, 200)
      }
    };
  }

  /* --------------------------------------------------------------------------
     Interprétation
     --------------------------------------------------------------------------
     Retourne toujours une promesse résolue. Un échec n'est jamais propagé à
     l'appelant : il se traduit par `{ contrat: null, motif: … }`, et l'appelant
     retombe sur le résultat déterministe. C'est la règle du repli : la couche
     linguistique est un CONFORT, jamais une dépendance.
     ------------------------------------------------------------------------ */
  function interpreter(question, contexte) {
    if (!activee()) {
      return Promise.resolve({ contrat: null, motif: "couche linguistique désactivée" });
    }
    var frein = debitAutorise();
    if (frein) {
      ETAT.refus++;
      return Promise.resolve({ contrat: null, motif: frein });
    }
    var CO = comprehension();
    if (!CO) return Promise.resolve({ contrat: null, motif: "couche de compréhension absente" });

    ETAT.appels++;
    ETAT.dernierAppelMs = Date.now();

    var expire = false;
    var minuteur = null;
    var chrono = Date.now();

    var appel = new Promise(function (resoudre) {
      minuteur = setTimeout(function () {
        expire = true;
        ETAT.expirations++;
        resoudre({ contrat: null, motif: "délai dépassé (" + CFG.timeoutMs + " ms)" });
      }, CFG.timeoutMs);

      CLIENT.functions.invoke(FONCTION, { body: chargeUtile(question, contexte) })
        .then(function (res) {
          if (expire) return;
          clearTimeout(minuteur);
          if (res && res.error) return resoudre(traiterErreur(res.error));

          var corps = res && res.data;
          if (!corps || typeof corps !== "object") {
            ETAT.echecs++;
            return resoudre({ contrat: null, motif: "réponse serveur non structurée" });
          }
          if (CFG.journaliserCout && corps.usage) {
            ETAT.tokens += Number(corps.usage.total_tokens) || 0;
            ETAT.coutEstime += Number(corps.usage.cout_estime) || 0;
          }

          /* VALIDATION STRICTE. Le contrat venu du serveur n'a AUCUN privilège :
             il passe par le même `valider` que le contrat déterministe. Une
             intention inventée, une portée inconnue, un filtre en trop, une
             confiance hors [0,1] — tout est refusé, et l'on retombe sur le
             déterministe. */
          var contrat = corps.contrat;
          var erreurs = CO.valider(contrat);
          if (erreurs.length) {
            ETAT.refus++;
            ETAT.derniereErreur = erreurs[0];
            return resoudre({ contrat: null, motif: "contrat refusé : " + erreurs[0], erreurs: erreurs });
          }
          /* Garde supplémentaire : la portée retournée doit exister réellement
             dans les données chargées. Un modèle peut halluciner un cluster. */
          if (contrat.scope && contrat.scope.type !== "global") {
            if (!porteeExiste(contrat.scope, contexte)) {
              ETAT.refus++;
              return resoudre({
                contrat: null,
                motif: "portée « " + contrat.scope.label + " » inconnue du référentiel FBMS"
              });
            }
          }
          resoudre({ contrat: contrat, motif: "", latenceMs: Date.now() - chrono });
        }, function (err) {
          if (expire) return;
          clearTimeout(minuteur);
          resoudre(traiterErreur(err));
        });
    });

    return appel;
  }

  function porteeExiste(scope, contexte) {
    contexte = contexte || {};
    var listes = {
      zone: (contexte.zones || []),
      cluster: (contexte.clusters || []).map(function (c) { return c.cle; }),
      village: (contexte.villages || []).map(function (v) { return v.nom; }),
      rt: (contexte.rt || []).map(function (r) { return r.cle; })
    };
    var l = listes[scope.type] || [];
    for (var i = 0; i < l.length; i++) if (String(l[i]) === String(scope.id)) return true;
    return false;
  }

  function traiterErreur(err) {
    ETAT.echecs++;
    var msg = (err && (err.message || err.error || err.code)) || "erreur inconnue";
    ETAT.derniereErreur = String(msg).slice(0, 200);
    /* Fonction Edge absente : on se met en veille pour la session. Réessayer à
       chaque question ferait payer une latence à chaque fois, pour rien. */
    if (/not found|404|non trouv|introuvable|Failed to send/i.test(String(msg))) {
      ETAT.indisponible = true;
      ETAT.derniereErreur = "fonction serveur « " + FONCTION + " » non déployée";
    }
    return { contrat: null, motif: ETAT.derniereErreur };
  }

  /* --------------------------------------------------------------------------
     Point d'entrée pour l'interface
     --------------------------------------------------------------------------
     Décide s'il faut appeler, appelle, revalide, et rend la main au moteur.
     Le moteur reste l'unique producteur de chiffres, quel que soit le chemin.
     ------------------------------------------------------------------------ */
  function repondreAvecRepli(question, etatFbms) {
    var IA = global.AFLP_IA || (typeof require === "function" ? require("./aflp-ia-moteur.js") : null);
    if (!IA) return Promise.resolve(null);

    var deterministe = IA.repondre(question, etatFbms);
    var confiance = deterministe.confianceNum || 0;
    var doitAppeler = activee() && (
      confiance < CFG.seuilAppel ||
      (deterministe.contrat && deterministe.contrat.requires_clarification && !deterministe.contrat.intent)
    );
    if (!doitAppeler) {
      deterministe.coucheLinguistique = false;
      return Promise.resolve(deterministe);
    }

    var contexte = IA.contexteComprehension(etatFbms);
    return interpreter(question, contexte).then(function (r) {
      if (!r.contrat) {
        deterministe.coucheLinguistique = false;
        deterministe.motifRepli = r.motif;
        return deterministe;
      }
      /* Le contrat interprété est exécuté par le MÊME chemin que le contrat
         déterministe : `repondre` le revalide une seconde fois avant d'appeler
         quoi que ce soit. Double validation assumée — la première est du
         client, la seconde du moteur, et elles ne partagent aucun état. */
      var rep = IA.repondre(question, etatFbms, null, null, r.contrat);
      rep.coucheLinguistique = true;
      rep.latenceLangueMs = r.latenceMs || null;
      return rep;
    });
  }

  function etat() {
    return {
      version: VERSION,
      active: CFG.active,
      tueur: CFG.tueur,
      operationnelle: activee(),
      fonction: FONCTION,
      seuilAppel: CFG.seuilAppel,
      timeoutMs: CFG.timeoutMs,
      appels: ETAT.appels,
      refusContrat: ETAT.refus,
      echecs: ETAT.echecs,
      expirations: ETAT.expirations,
      tokens: ETAT.tokens,
      coutEstime: ETAT.coutEstime,
      indisponible: ETAT.indisponible,
      derniereErreur: ETAT.derniereErreur
    };
  }

  global.AFLP_IA_LANGUE = {
    version: VERSION,
    configurer: configurer,
    appliquerParametres: appliquerParametres,
    activee: activee,
    interpreter: interpreter,
    repondreAvecRepli: repondreAvecRepli,
    couper: couper,
    etat: etat,
    /* Exposée pour le banc d'essai : c'est LA fonction qui garantit qu'aucun
       chiffre ne quitte le navigateur. Elle doit être testable hors réseau. */
    chargeUtile: chargeUtile
  };
  if (typeof module === "object" && module.exports) module.exports = global.AFLP_IA_LANGUE;

})(typeof window !== "undefined" ? window : this);
