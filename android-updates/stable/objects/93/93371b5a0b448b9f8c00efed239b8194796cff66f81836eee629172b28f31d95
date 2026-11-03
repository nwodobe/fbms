/* ============================================================================
   ASSISTANT IA AFLP — CATALOGUE DES INTENTIONS (shared/aflp-ia-catalogue.js)
   ----------------------------------------------------------------------------
   ANAGROCI FieldLink Programme (AFLP) 2027.

   Ce fichier est un RÉFÉRENTIEL, pas du code métier. Il ne calcule rien, ne
   touche ni au réseau ni au DOM, et n'expose aucune donnée. Il décrit, pour
   chaque question que l'assistant sait traiter :

     · ce que la question veut dire        (code, nom, description)
     · comment on la reconnaît             (groupes de mots, indices, exclusions)
     · comment les gens la posent vraiment (formulations validées)
     · ce qu'il faut pour y répondre       (données requises, portées, périodes)
     · qui calcule la réponse              (fonction déterministe du moteur)
     · dans quel état de publication elle est (statut, version, validation)

   POURQUOI UN FICHIER SÉPARÉ
   Avant, les intentions vivaient dans un tableau de onze lignes au milieu du
   moteur (`INTENTIONS`, shared/aflp-ia-moteur.js). Aucun mot ne couvrait « RT ».
   Personne ne pouvait le voir sans lire 1 400 lignes de JavaScript, et personne
   ne pouvait ajouter une formulation sans toucher au moteur de calcul. Séparer
   le vocabulaire du calcul, c'est rendre l'un modifiable sans risquer l'autre.

   RÈGLE ABSOLUE, PORTÉE PAR CE FICHIER
   Une intention DÉSIGNE une fonction déterministe du moteur. Elle ne contient
   jamais de chiffre, jamais de phrase de réponse, jamais de SQL. Le catalogue
   dit « cette question se répond avec `couvertureRt` » ; il ne dit jamais ce
   que `couvertureRt` doit répondre.

   LES EXCLUSIONS NE SONT PAS DÉCORATIVES
   Deux intentions voisines qui partagent leurs mots-clés produisent une demande
   de clarification à chaque question — c'est-à-dire un assistant qui ne répond
   plus. Chaque `exclusions` ci-dessous a été ajoutée parce qu'une formulation
   réelle du corpus partait vers la mauvaise intention. Les retirer sans rejouer
   `.github/agent-tests/aflp-ia-corpus.mjs` casse la reconnaissance en silence.

   STATUTS
     · `publie`         — reconnue et répondue.
     · `brouillon`      — reconnue par le banc d'essai, jamais servie en production.
     · `non_disponible` — comprise, mais la donnée n'existe pas dans FBMS. La
                          réponse est un refus explicite qui NOMME la donnée
                          manquante. C'est un état de première classe : simuler
                          une réponse serait pire que ne rien dire.
     · `desactive`      — retirée du service sans être supprimée de l'histoire.
   ========================================================================== */
(function (global) {
  "use strict";

  /* Version du catalogue. Toute modification du contenu ci-dessous exige de
     l'incrémenter : c'est elle qui est journalisée avec chaque question, et
     sans elle une mesure de compréhension n'est comparable à rien. */
  var VERSION_CATALOGUE = "1.0.0";
  var DATE_CATALOGUE = "2026-08-15";
  var VALIDATION = "Branch Manager · AFLP 2027";

  /* Vocabulaire FERMÉ du contrat de compréhension. Toute valeur absente de ces
     listes est refusée par `AFLP_IA_COMPREHENSION.valider`, jamais devinée. */
  var PORTEES = ["global", "zone", "cluster", "village", "rt"];
  var PERIODES = ["day", "week", "campaign"];
  var FILTRES = ["status", "breakdown"];
  var BREAKDOWNS = ["zone", "cluster", "village", "rt"];
  var STATUTS_FILTRE = ["all", "active", "registered", "blocked", "eligible"];

  /* --------------------------------------------------------------------------
     Synonymes réutilisés. Écrits une fois, corrigés une fois.
     Tous en forme NORMALISÉE : minuscules, sans accent, sans apostrophe
     (« d'équipes » devient « d equipes », donc le mot utile est « equipes »).
     ------------------------------------------------------------------------ */
  var G_COMBIEN = ["combien", "nombre", "nb", "effectif", "effectifs", "total", "compte", "denombrer"];
  var G_RT = ["rt", "rts", "equipe", "equipes", "team", "teams", "relais"];
  var G_VILLAGE = ["village", "villages", "localite", "localites"];
  var G_VOLUME = ["volume", "volumes", "tonnage", "tonnages", "tonne", "tonnes", "mt", "kg", "kilos",
    "achete", "achetes", "achetee", "achetees", "acheter", "achat", "achats",
    "collecte", "collectes", "collecter", "ramasse", "quantite"];
  var G_CASH = ["cash", "caisse", "argent", "tresorerie", "fonds", "montant", "montants", "fcfa", "francs"];
  var G_AVANCE = ["avance", "avances", "avancee", "avancees", "decaisse", "decaissee", "decaissees",
    "decaissement", "decaissements", "dote", "dotation"];
  var G_SACS = ["sac", "sacs", "sacherie", "jute", "emballage", "emballages"];
  var G_RECON = ["reconciliation", "reconciliations", "reconcilie", "reconcilies", "reconciliee",
    "reconciliees", "reconcilier", "justification", "justifications", "justifie", "justifies"];
  var G_REFI = ["refinancement", "refinancer", "refinance", "refinances", "refinancee", "refinancees",
    "refinancable", "refinancables", "debloquer", "deblocage", "debloque", "debloquable", "debloquables"];
  var G_LISTE = ["quels", "quelles", "quel", "quelle", "liste", "lister", "lesquels", "lesquelles",
    "donne", "donnez", "cite", "citer", "nomme", "nommer", "affiche"];
  var G_OBJECTIF = ["objectif", "objectifs", "cible", "cibles", "avancement", "progression",
    "atteint", "atteinte", "atteindre", "pourcentage", "taux", "par rapport", "ou en est"];
  var G_RESTE = ["reste", "restant", "restante", "restent", "manque", "manquant", "manquants"];

  /* Vocabulaire des personnes. Il sépare « combien d'équipes » de « combien de
     personnes dans les équipes » — deux questions dont une seule a une réponse
     dans FBMS. C'est la distinction que le moteur d'origine ne faisait pas. */
  var G_PERSONNES = ["personne", "personnes", "membre", "membres", "composent", "compose",
    "composition", "composees", "composee", "gens", "individus", "salaries", "agents"];
  /* « travaillent » n'est PAS un marqueur d'activité : « quelles équipes RT
     travaillent à Béoumi » demande la liste des équipes, pas celles qui ont
     enregistré un achat. Le confondre renvoyait la mauvaise intention dès que
     la formulation s'écartait d'un mot de celle du catalogue. */
  var G_ACTIFS = ["actif", "actifs", "active", "actives", "operationnel", "operationnels",
    "operationnelle", "operationnelles", "produisent"];

  /* Une question de COUVERTURE compte des équipes ou des villages. Dès qu'un
     mot d'argent, de volume, de sacs, de réconciliation ou de qualité apparaît,
     ce n'est plus une question de couverture — c'est une question métier sur un
     autre agrégat, et la laisser au comptage donnerait un chiffre juste à côté
     de la question posée. */
  var X_COUVERTURE = G_AVANCE.concat(G_CASH, G_VOLUME, G_SACS, G_RECON, G_REFI,
    ["recu", "recus", "justificatif", "justificatifs", "qualite", "humidite", "kor",
     "bareme", "alerte", "alertes", "priorite", "bloque", "bloques", "bloquee", "bloquees",
     "eligible", "eligibles"]);

  /* --------------------------------------------------------------------------
     LE CATALOGUE — 30 intentions
     ------------------------------------------------------------------------ */
  var INTENTIONS = [

    /* ===================== COUVERTURE — ÉQUIPES RT ======================== */
    {
      code: "coverage_rt_count",
      nom: "Nombre d'équipes RT",
      description:
        "Nombre d'équipes RT rattachées à une portée. Dans le référentiel AFLP, " +
        "« RT » désigne par défaut une ÉQUIPE RT, pas une personne. Le comptage " +
        "porte sur les équipes enregistrées, dédoublonnées par identifiant serveur, " +
        "et cite en second le nombre d'équipes actives.",
      statut: "publie",
      fonction: "couvertureRt",
      donneesRequises: ["rt"],
      porteesAutorisees: ["global", "zone", "cluster", "village"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: ["breakdown", "status"],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_RT, G_COMBIEN],
      indices: ["avons", "dispose", "disposons", "affectees", "affectes", "affecte",
        "presentes", "terrain", "enregistrees", "enregistres", "referencees"],
      exclusions: X_COUVERTURE.concat(G_PERSONNES, G_ACTIFS),
      formulations: [
        "Combien de RT avons-nous à Béoumi ?",
        "Combien de RT à Beoumi ?",
        "Nombre de RT à Béoumi.",
        "Nombre d'équipes RT à Béoumi",
        "Combien d'équipes sont affectées à Béoumi ?",
        "Effectif RT du cluster Béoumi",
        "Donne-moi le nombre de RT de Béoumi",
        "Il y a combien d'équipes RT à Beoumi ?",
        "COMBIEN DE RT DANS GBEKE 2 ?",
        "Nombre de RT par cluster",
        "Nombre de RT par zone",
        "combien de rt au total",
        "on a combien d equipes rt"
      ]
    },
    {
      code: "coverage_rt_active_count",
      nom: "Nombre d'équipes RT actives",
      description:
        "Nombre d'équipes RT ayant enregistré au moins un achat sur la campagne. " +
        "Une équipe active est une équipe qui a produit une ligne d'achat ; une " +
        "équipe enregistrée sans achat reste comptée comme enregistrée, jamais " +
        "comme active.",
      statut: "publie",
      fonction: "couvertureRt",
      donneesRequises: ["rt", "achats"],
      porteesAutorisees: ["global", "zone", "cluster", "village"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: ["breakdown", "status"],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_RT, G_ACTIFS],
      indices: G_COMBIEN.concat(["reellement", "vraiment", "terrain"]),
      exclusions: X_COUVERTURE.concat(G_PERSONNES),
      formulations: [
        "Combien de RT actifs avons-nous à Béoumi ?",
        "RT actifs de Béoumi",
        "Nombre d'équipes RT actives à Béoumi",
        "combien de rt actifs dans gbeke 2",
        "Quelles équipes RT sont actives à Botro ?",
        "combien d equipes operationnelles a diabo",
        "Effectif des RT actives par cluster"
      ]
    },
    {
      code: "coverage_rt_list",
      nom: "Liste des équipes RT",
      description:
        "Liste nominative des équipes RT d'une portée, avec leur cluster et leur " +
        "activité. Les noms d'équipe sont des noms d'ÉQUIPE, jamais de personnes.",
      statut: "publie",
      fonction: "couvertureRt",
      donneesRequises: ["rt"],
      porteesAutorisees: ["global", "zone", "cluster", "village"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: ["status"],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_RT, G_LISTE],
      indices: ["travaillent", "travaille", "interviennent", "presentes", "noms", "nom"],
      exclusions: X_COUVERTURE.concat(G_PERSONNES, G_ACTIFS),
      formulations: [
        "Quelles équipes RT travaillent à Béoumi ?",
        "Liste des RT de Béoumi",
        "Donne-moi la liste des équipes RT de Botro",
        "quelles rt sont a sakassou",
        "Lister les équipes RT du cluster Brobo",
        "Cite les RT de la zone GBEKE 1"
      ]
    },
    {
      code: "coverage_rt_members",
      nom: "Composition nominative des équipes RT",
      description:
        "Nombre de personnes composant les équipes RT. FBMS enregistre les " +
        "ÉQUIPES, pas leurs membres : aucune table ne porte la composition " +
        "nominative validée. L'intention est comprise et refusée explicitement, " +
        "en nommant la donnée qui manque.",
      statut: "non_disponible",
      fonction: null,
      donneeManquante:
        "la composition nominative des équipes RT — FBMS ne dispose d'aucune " +
        "table `rt_membres` ni d'un champ de composition validé",
      donneesRequises: ["rt_membres"],
      porteesAutorisees: ["global", "zone", "cluster", "village", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.5,
      clarification: null,
      groupes: [G_RT, G_PERSONNES],
      indices: G_COMBIEN,
      exclusions: X_COUVERTURE,
      formulations: [
        "Combien de personnes composent les RT de Béoumi ?",
        "Combien de personnes par équipe RT ?",
        "Quels sont les membres de l'équipe RT de Botro ?",
        "combien de gens dans les rt de beoumi",
        "Composition des équipes RT de GBEKE 2",
        "nombre de membres par rt"
      ]
    },

    /* ===================== COUVERTURE — VILLAGES ========================== */
    {
      code: "coverage_village_count",
      nom: "Nombre de villages",
      description:
        "Nombre de villages référencés dans une portée, nombre de villages " +
        "actifs (au moins un achat) et cible du pilote.",
      statut: "publie",
      fonction: "couvertureVillages",
      donneesRequises: ["villages"],
      porteesAutorisees: ["global", "zone", "cluster"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: ["breakdown", "status"],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_VILLAGE, G_COMBIEN],
      indices: ["recenses", "recense", "recensés", "couverts", "couvert", "references",
        "reference", "avons", "couvre"],
      exclusions: X_COUVERTURE.concat(["inactif", "inactifs", "sommeil", "dormant",
        "dorment", "rien", "aucun", "sans"]),
      formulations: [
        "Combien de villages couvre le pilote ?",
        "Nombre de villages à Béoumi",
        "combien de villages dans gbeke 1",
        "Nombre de villages recensés par cluster",
        "on couvre combien de localites",
        "Effectif villages du cluster Diabo"
      ]
    },
    {
      code: "coverage_inactive_villages",
      nom: "Villages sans achat",
      description:
        "Villages n'ayant enregistré aucun achat depuis le seuil AFLP de mise en " +
        "sommeil (7 jours par défaut), ou n'ayant jamais enregistré d'achat.",
      statut: "publie",
      fonction: "villagesInactifs",
      donneesRequises: ["villages", "achats"],
      porteesAutorisees: ["global", "zone", "cluster"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.5,
      clarification: null,
      groupes: [G_VILLAGE, ["inactif", "inactifs", "inactive", "inactives", "sommeil",
        "dormant", "dorment", "rien", "aucun", "sans", "arrete", "arretes", "endormis"]],
      indices: ["achat", "achats", "achete", "depuis", "jours", "relancer", "relance"],
      exclusions: [],
      formulations: [
        "Quels villages n'ont rien acheté depuis 7 jours ?",
        "Villages inactifs",
        "villages sans achat a beoumi",
        "Quels villages sont en sommeil ?",
        "liste des villages qui dorment dans gbeke 2",
        "Villages sans aucun achat enregistré"
      ]
    },

    /* ===================== VOLUME ========================================= */
    {
      code: "volume_total",
      nom: "Volume acheté",
      description:
        "Volume net acheté sur la campagne pour une portée, en tonnes et en " +
        "kilogrammes, à partir de la colonne `poids_net` des achats.",
      statut: "publie",
      fonction: "volumePortee",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster", "village", "rt"],
      periodesAutorisees: ["campaign", "day", "week"],
      filtresAutorises: ["breakdown"],
      confianceMin: 0.5,
      /* Convention validée : une question de volume SANS portée explicite n'est
         pas répondue d'office sur le périmètre global. Le Branch Manager pilote
         six clusters : lui répondre « 20 MT » quand il pensait à Béoumi est une
         erreur silencieuse. On demande. */
      clarification: {
        quand: "portee_absente",
        question:
          "Sur quel périmètre : l'ensemble du pilote, une zone (GBEKE 1 / GBEKE 2), " +
          "un cluster ou une équipe RT ?",
        options: ["Ensemble du pilote", "Une zone", "Un cluster", "Une équipe RT"]
      },
      groupes: [G_VOLUME],
      indices: G_COMBIEN.concat(["cumul", "cumule", "campagne", "depuis", "debut"]),
      exclusions: ["objectif", "cible", "reste", "restant", "restante", "manque",
        "avancement", "classement", "meilleur", "meilleurs", "pire", "top",
        "aujourd", "hui", "jour", "semaine", "hebdo", "par rapport", "ou en est",
        "rien", "aucun", "inactif", "inactifs", "sommeil", "dorment",
        "recu", "recus", "justificatif", "qualite"],
      formulations: [
        "Combien avons-nous acheté ?",
        "Quel est le volume acheté à Béoumi ?",
        "Combien a acheté Brobo ?",
        "tonnage cumule de gbeke 1",
        "volume collecte par le cluster Botro",
        "On a ramassé combien de tonnes ?"
      ]
    },
    {
      code: "volume_by_scope",
      nom: "Volume ventilé",
      description:
        "Ventilation du volume acheté par zone, cluster ou village, sans " +
        "classement — la ventilation conserve l'ordre du référentiel.",
      statut: "publie",
      fonction: "volumeVentile",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster"],
      periodesAutorisees: ["campaign", "day", "week"],
      filtresAutorises: ["breakdown"],
      confianceMin: 0.55,
      clarification: null,
      /* Les expressions sont VOLONTAIREMENT multi-mots : « par » seul attrapait
         « volume collecté PAR le cluster Botro », qui est une question de
         volume simple et non une ventilation. */
      groupes: [G_VOLUME, ["par cluster", "par clusters", "par zone", "par zones",
        "par village", "par villages", "par equipe", "par equipes", "par rt",
        "chaque cluster", "chaque zone", "chaque village", "chaque equipe",
        "repartition", "ventilation", "ventile", "ventiler"]],
      indices: ["cluster", "clusters", "zone", "zones", "village", "villages", "detail"],
      exclusions: ["meilleur", "meilleurs", "pire", "classement", "top"],
      formulations: [
        "Volume par cluster",
        "Quel est le volume acheté par zone ?",
        "repartition du tonnage par cluster",
        "detail des achats par village",
        "Volume acheté pour chaque cluster",
        "ventile le volume par zone"
      ]
    },
    {
      code: "volume_today",
      nom: "Volume du jour",
      description:
        "Volume net acheté à la DATE DE RÉFÉRENCE DES DONNÉES — jamais à la date " +
        "du navigateur — pour la portée demandée.",
      statut: "publie",
      fonction: "volumePortee",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster", "village", "rt"],
      periodesAutorisees: ["day"],
      filtresAutorises: ["breakdown"],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_VOLUME, ["aujourd", "hui", "jour", "journee", "ce jour", "du jour", "today", "matin"]],
      indices: G_COMBIEN,
      exclusions: ["semaine", "hebdo", "cumul", "campagne", "rien", "aucun",
        "inactif", "inactifs", "sommeil"],
      formulations: [
        "Combien avons-nous acheté aujourd'hui ?",
        "Volume du jour",
        "achat du jour a beoumi",
        "combien de kg achetes aujourd hui",
        "Quel est le tonnage de la journée ?",
        "volume achete ce jour dans gbeke 1"
      ]
    },
    {
      code: "volume_last_7_days",
      nom: "Volume des 7 derniers jours",
      description:
        "Volume net acheté sur la fenêtre glissante de sept jours qui se termine " +
        "à la date de référence des données, incluse.",
      statut: "publie",
      fonction: "volumePortee",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster", "village", "rt"],
      periodesAutorisees: ["week"],
      filtresAutorises: ["breakdown"],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_VOLUME, ["semaine", "hebdo", "hebdomadaire", "7", "sept", "derniers"]],
      indices: G_COMBIEN.concat(["jours"]),
      exclusions: ["aujourd", "hui", "rien", "aucun", "inactif", "inactifs", "sommeil"],
      formulations: [
        "Combien avons-nous acheté cette semaine ?",
        "Volume des 7 derniers jours",
        "tonnage hebdomadaire de gbeke 2",
        "volume sur les sept derniers jours",
        "achats de la semaine a botro",
        "combien de tonnes en 7 jours"
      ]
    },

    /* ===================== OBJECTIF ======================================= */
    {
      code: "progress_to_target",
      nom: "Avancement vers l'objectif",
      description:
        "Part de l'objectif atteinte pour la portée demandée. L'objectif global " +
        "du pilote est de 3 000 MT ; la quote-part par cluster est INDICATIVE et " +
        "signalée comme telle dans la réponse.",
      statut: "publie",
      fonction: "avancementObjectif",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.5,
      clarification: null,
      groupes: [G_OBJECTIF],
      indices: G_VOLUME.concat(["situation", "pourcent"]),
      exclusions: ["reste", "restant", "restante", "restent", "manque", "manquant"],
      formulations: [
        "Où en est le volume par rapport aux 3 000 MT ?",
        "Quel est l'avancement de GBEKE 1 ?",
        "on est a combien de l objectif",
        "taux d atteinte de la cible a beoumi",
        "Pourcentage de l'objectif atteint",
        "avancement du cluster Diabo"
      ]
    },
    {
      code: "remaining_target",
      nom: "Reste à collecter",
      description:
        "Volume restant à collecter pour atteindre l'objectif de la portée, et " +
        "estimation du nombre de jours d'activité au rythme moyen constaté. Le " +
        "rythme est une projection explicite, jamais une promesse.",
      statut: "publie",
      fonction: "avancementObjectif",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.5,
      clarification: null,
      groupes: [G_RESTE],
      indices: G_OBJECTIF.concat(G_VOLUME, ["jours", "rythme", "combien"]),
      exclusions: G_SACS.concat(["caisse", "cash", "tresorerie", "reconcilier",
        "reconciliation", "reconcilies", "reconciliees"]),
      formulations: [
        "Combien reste-t-il à collecter ?",
        "Quel volume reste à acheter pour atteindre l'objectif ?",
        "il reste combien de tonnes a gbeke 2",
        "reste a collecter du cluster Brobo",
        "Combien manque-t-il pour la cible ?",
        "reste a faire sur l objectif"
      ]
    },
    {
      code: "cluster_ranking",
      nom: "Classement des clusters",
      description:
        "Clusters ordonnés par volume acheté, du plus avancé au moins avancé, ou " +
        "l'inverse selon la formulation.",
      statut: "publie",
      fonction: "classementClusters",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [["meilleur", "meilleurs", "meilleure", "meilleures", "top", "classement",
        "classer", "pire", "pires", "premiers", "premier", "performant", "performants",
        "avances", "retard", "moins", "plus"]],
      indices: ["cluster", "clusters", "zone", "zones", "volume", "tonnage"],
      exclusions: G_SACS.concat(["reste", "restant", "caisse", "recu", "recus",
        "dernier", "derniere", "recent", "recente"]),
      formulations: [
        "Quels sont les clusters les plus avancés ?",
        "Classement des clusters",
        "quel cluster est le plus performant",
        "les clusters les moins avances",
        "top des clusters par volume",
        "quel est le pire cluster"
      ]
    },

    /* ===================== ACHATS ========================================= */
    {
      code: "purchase_count",
      nom: "Nombre d'achats",
      description:
        "Nombre de lignes d'achat enregistrées pour la portée demandée. Une ligne " +
        "d'achat n'est pas un producteur : deux achats du même producteur comptent " +
        "pour deux.",
      statut: "publie",
      fonction: "compteurAchats",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster", "village", "rt"],
      periodesAutorisees: ["campaign", "day", "week"],
      filtresAutorises: ["breakdown"],
      confianceMin: 0.55,
      clarification: null,
      groupes: [["achat", "achats", "operation", "operations", "ligne", "lignes",
        "transaction", "transactions"], G_COMBIEN],
      indices: ["saisis", "saisi", "saisies", "enregistres", "enregistre", "faits", "realises"],
      exclusions: ["volume", "tonnage", "tonnes", "tonne", "kg", "kilos", "mt",
        "montant", "prix", "dernier", "derniere", "recent", "recente",
        "recu", "recus", "justificatif", "justificatifs", "qualite", "humidite",
        "kor", "bareme", "sans"],
      formulations: [
        "Combien d'achats ont été enregistrés ?",
        "Nombre de lignes d'achat à Béoumi",
        "combien d operations d achat dans gbeke 1",
        "nombre de transactions saisies",
        "Combien d'achats à Botro ?",
        "on a fait combien d achats"
      ]
    },
    {
      code: "last_purchase",
      nom: "Dernier achat",
      description:
        "Date du dernier achat enregistré pour la portée demandée et ancienneté " +
        "en jours par rapport à la date de référence des données.",
      statut: "publie",
      fonction: "dernierAchat",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster", "village", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [["achat", "achats", "operation", "operations", "activite"],
        ["dernier", "derniere", "recent", "recente", "quand", "date"]],
      indices: ["remonte", "ancien", "anciennete", "lieu", "eu"],
      exclusions: ["combien", "nombre"],
      formulations: [
        "Quel est le dernier achat enregistré ?",
        "Quand remonte le dernier achat de Béoumi ?",
        "date du dernier achat a botro",
        "dernier achat du cluster Diabo",
        "quand a eu lieu la derniere operation d achat",
        "achat le plus recent dans gbeke 2"
      ]
    },

    /* ===================== CAISSE ========================================= */
    {
      code: "cash_advances",
      nom: "Avances aux équipes RT",
      description:
        "Montant cumulé des avances versées aux équipes RT pour la portée " +
        "demandée, et montant du jour.",
      statut: "publie",
      fonction: "caissePortee",
      donneesRequises: ["avances"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign", "day"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_AVANCE],
      indices: G_COMBIEN.concat(G_CASH, ["rt", "equipe", "equipes"]),
      exclusions: ["solde", "soldes", "paye", "payes", "payee", "payees",
        "producteur", "producteurs", "planteur", "planteurs", "paysan", "paysans",
        "reconciliation", "reconciliations", "refinancement", "couvert", "couverte",
        "couverts", "couvertes", "exposition", "expose", "risque"],
      formulations: [
        "Combien avons-nous avancé aux RT ?",
        "Montant des avances de GBEKE 1",
        "avances versees a beoumi",
        "total decaisse pour les equipes",
        "Quelles avances ont été faites à Brobo ?",
        "montant avance aux rt du cluster Botro"
      ]
    },
    {
      code: "cash_paid",
      nom: "Payé aux producteurs",
      description:
        "Montant payé aux producteurs pour la portée demandée, somme de la colonne " +
        "`montant` des achats.",
      statut: "publie",
      fonction: "caissePortee",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster", "village", "rt"],
      periodesAutorisees: ["campaign", "day", "week"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [["paye", "payes", "payee", "payees", "payer", "verse", "verses", "versee",
        "versees", "regle", "regles", "depense", "depenses"],
        ["producteur", "producteurs", "paysan", "paysans", "planteur", "planteurs",
          "combien", "montant"]],
      indices: G_CASH,
      exclusions: ["avance", "avances", "solde", "soldes", "reconciliation"],
      formulations: [
        "Combien avons-nous payé aux producteurs ?",
        "Montant payé aux planteurs de Béoumi",
        "combien verse aux producteurs dans gbeke 1",
        "total paye aux paysans",
        "Quelle dépense pour les producteurs de Brobo ?",
        "montant regle aux producteurs par l equipe"
      ]
    },
    {
      code: "cash_balance",
      nom: "Solde de caisse",
      description:
        "Solde théorique en circulation : avances versées moins montants payés " +
        "aux producteurs. Un solde négatif signale une avance non saisie ou un " +
        "achat mal imputé — il n'est JAMAIS présenté comme un gain.",
      statut: "publie",
      fonction: "caissePortee",
      donneesRequises: ["avances", "achats"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [["solde", "soldes", "reste", "restant", "restante", "circulation",
        "disponible", "dispo", "en main"], G_CASH],
      indices: ["combien", "quel", "quelle", "montant"],
      exclusions: G_SACS.concat(["volume", "tonnage", "tonnes", "couvert", "couverte",
        "couverts", "couvertes", "exposition", "expose", "risque", "non justifie",
        "non justifiees"]),
      formulations: [
        "Quel est le solde de caisse de GBEKE 1 ?",
        "Combien reste-t-il en caisse dans la zone 1 ?",
        "Solde cash GBEKE 1",
        "Quel montant reste en circulation à GBEKE 1 ?",
        "Caisse disponible dans la zone GBEKE 1",
        "solde de tresorerie du cluster Beoumi"
      ]
    },
    {
      code: "cash_open_exposure",
      nom: "Exposition ouverte",
      description:
        "Montant des avances non couvertes par une réconciliation valide : " +
        "l'argent confié aux équipes dont FBMS ne peut pas encore prouver l'emploi.",
      statut: "publie",
      fonction: "expositionOuverte",
      donneesRequises: ["avances", "reconciliations"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.6,
      clarification: null,
      groupes: [["exposition", "exposee", "exposees", "expose", "exposes", "risque",
        "couvert", "couverte", "couverts", "couvertes", "non justifie", "non justifiees",
        "ouverte", "ouvertes"], G_AVANCE.concat(G_CASH)],
      indices: G_AVANCE.concat(["combien", "montant", "reconciliation", "circulation"]),
      exclusions: [],
      formulations: [
        "Quelle est l'exposition de caisse non couverte ?",
        "Combien d'avances ne sont pas couvertes par une réconciliation ?",
        "montant expose sur gbeke 2",
        "avances ouvertes non justifiees",
        "cash a risque du cluster Beoumi",
        "quel montant d avance reste non couvert"
      ]
    },

    /* ===================== RÉCONCILIATION ================================= */
    {
      code: "reconciliation_status",
      nom: "État des réconciliations",
      description:
        "Nombre d'équipes réconciliées et non réconciliées pour la portée " +
        "demandée, selon la dernière réconciliation connue de chaque équipe.",
      statut: "publie",
      fonction: "etatReconciliation",
      donneesRequises: ["reconciliations", "avances"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.5,
      clarification: null,
      groupes: [G_RECON],
      indices: ["etat", "statut", "combien", "point", "situation", "ou en est", "ou en sont"],
      exclusions: ["quels", "quelles", "liste", "lister", "lesquels", "lesquelles"],
      formulations: [
        "Où en sont les réconciliations ?",
        "État des réconciliations de GBEKE 1",
        "point sur la reconciliation a beoumi",
        "combien d equipes sont reconciliees",
        "statut de reconciliation du cluster Brobo",
        "situation des justifications de caisse"
      ]
    },
    {
      code: "unreconciled_rt",
      nom: "Équipes non réconciliées",
      description:
        "Liste des équipes RT dont la dernière réconciliation est absente, non " +
        "validée, antérieure à la dernière avance, ou hors tolérance d'écart.",
      statut: "publie",
      fonction: "rtNonReconcilies",
      donneesRequises: ["reconciliations", "avances"],
      porteesAutorisees: ["global", "zone", "cluster"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_RECON, G_LISTE.concat(["non", "pas", "manque", "manquantes",
        "manquants", "restent", "reste", "sans", "doivent", "encore"])],
      indices: G_RT,
      exclusions: ["exposition", "expose", "couvert", "couverte", "couverts", "couvertes"],
      formulations: [
        "Quelles équipes ne sont pas réconciliées ?",
        "Liste des RT non réconciliés",
        "quels rt restent a reconcilier a beoumi",
        "equipes sans reconciliation dans gbeke 2",
        "lesquelles ne sont pas justifiees",
        "donne les rt qui doivent encore se reconcilier"
      ]
    },

    /* ===================== REFINANCEMENT ================================== */
    {
      code: "refinancing_blocked_rt",
      nom: "Équipes bloquées pour refinancement",
      description:
        "Équipes RT en NO-GO selon la règle AFLP « pas de réconciliation = pas de " +
        "refinancement », avec le motif exact du blocage pour chacune.",
      statut: "publie",
      fonction: "refinancementPortee",
      donneesRequises: ["reconciliations", "avances", "achats"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_REFI.concat(["bloque", "bloques", "bloquee", "bloquees", "blocage",
        "blocages", "no go", "nogo"]),
        ["bloque", "bloques", "bloquee", "bloquees", "blocage", "blocages", "no go",
          "nogo", "refuse", "refuses", "empeche", "quels", "quelles", "lesquels",
          "lesquelles", "qui"]],
      indices: G_RT,
      exclusions: ["eligible", "eligibles", "montant", "montants", "somme",
        "enveloppe", "budget", "argent"],
      formulations: [
        "Quels RT sont bloqués pour refinancement ?",
        "Équipes bloquées pour le refinancement",
        "qui est bloque au refinancement a beoumi",
        "rt en no go pour le refinancement dans gbeke 1",
        "quelles equipes ne peuvent pas etre refinancees",
        "liste des blocages de refinancement du cluster Botro"
      ]
    },
    {
      code: "refinancing_eligible_rt",
      nom: "Équipes éligibles au refinancement",
      description:
        "Équipes RT en GO : réconciliation existante, validée, postérieure à la " +
        "dernière avance et dans la tolérance d'écart.",
      statut: "publie",
      fonction: "refinancementPortee",
      donneesRequises: ["reconciliations", "avances", "achats"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_REFI, ["eligible", "eligibles", "go", "peuvent", "peut", "autorises",
        "autorisees", "prets", "prete", "pretes"]],
      indices: G_RT.concat(["quels", "quelles"]),
      exclusions: ["bloque", "bloques", "bloquee", "bloquees", "no go", "nogo",
        "peuvent pas", "peut pas", "montant", "montants", "somme", "enveloppe", "budget"],
      formulations: [
        "Quels RT sont éligibles au refinancement ?",
        "Équipes prêtes pour le refinancement",
        "qui peut etre refinance a beoumi",
        "quels rt sont en go pour le refinancement",
        "quelles equipes sont autorisees au refinancement",
        "liste des rt eligibles au refinancement du cluster Diabo"
      ]
    },
    {
      code: "refinancing_amount",
      nom: "Montant refinançable",
      description:
        "Montant débloquable immédiatement et montant bloqué pour la portée " +
        "demandée. Un achat sans reçu n'entre dans AUCUNE des deux assiettes.",
      statut: "publie",
      fonction: "refinancementPortee",
      donneesRequises: ["reconciliations", "avances", "achats"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_REFI, ["montant", "montants", "combien", "somme", "enveloppe",
        "budget", "argent"]],
      indices: G_CASH,
      exclusions: [],
      formulations: [
        "Quel montant peut-on refinancer ?",
        "Combien est débloquable au refinancement ?",
        "montant refinancable de gbeke 1",
        "somme debloquable a beoumi",
        "combien d argent est bloque par la regle de refinancement",
        "enveloppe refinancable du cluster Brobo"
      ]
    },

    /* ===================== SACHERIE ======================================= */
    {
      code: "bags_balance",
      nom: "Solde de sacs",
      description:
        "Solde de sacs pour la portée demandée : entrées moins sorties, d'après " +
        "les mouvements de sacherie.",
      statut: "publie",
      fonction: "sacsPortee",
      donneesRequises: ["sacs"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [G_SACS],
      indices: ["solde", "soldes", "combien", "stock", "en main", "restants",
        "disponibles", "distribues", "dechires", "etat"],
      exclusions: ["negatif", "negatifs", "negative", "negatives", "anomalie",
        "anomalies", "incoherence", "incoherences"],
      formulations: [
        "Combien de sacs sont en main des RT ?",
        "Solde de sacs de Béoumi",
        "stock de jute du cluster Brobo",
        "combien de sacs disponibles dans gbeke 1",
        "etat de la sacherie",
        "sacs restants a botro"
      ]
    },
    {
      code: "bags_negative_balance",
      nom: "Soldes de sacs négatifs",
      description:
        "Nombre de soldes de sacs négatifs par niveau (équipe RT, cluster, " +
        "producteur). Un solde négatif est une ANOMALIE DE SAISIE, pas un stock.",
      statut: "publie",
      fonction: "sacsNegatifs",
      donneesRequises: ["sacs"],
      porteesAutorisees: ["global"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.6,
      clarification: null,
      groupes: [G_SACS, ["negatif", "negatifs", "negative", "negatives", "anomalie",
        "anomalies", "incoherence", "incoherences"]],
      indices: ["solde", "soldes", "combien", "quels"],
      exclusions: [],
      formulations: [
        "Y a-t-il des soldes de sacs négatifs ?",
        "Combien de soldes de sacs sont négatifs ?",
        "anomalies de sacherie",
        "sacs en negatif",
        "incoherences sur les sacs",
        "quels soldes de sacs sont negatifs"
      ]
    },

    /* ===================== QUALITÉ ET TRAÇABILITÉ ========================= */
    {
      code: "quality_missing_receipts",
      nom: "Achats sans reçu",
      description:
        "Achats sans numéro de reçu, donc non refinançables par construction, " +
        "avec le montant correspondant.",
      statut: "publie",
      fonction: "qualitePortee",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [["recu", "recus", "justificatif", "justificatifs", "piece", "pieces",
        "ticket", "tickets"],
        ["sans", "manque", "manquant", "manquants", "absent", "absents", "combien",
          "non", "pas", "montant"]],
      indices: ["achat", "achats", "refinancable", "tracabilite"],
      exclusions: [],
      formulations: [
        "Combien d'achats sont sans reçu ?",
        "Achats sans justificatif à Béoumi",
        "combien de recus manquants",
        "achats sans piece dans gbeke 2",
        "quels achats n ont pas de recu",
        "montant des achats sans recu du cluster Brobo"
      ]
    },
    {
      code: "quality_controls",
      nom: "Contrôles qualité en attente",
      description:
        "Achats dont le statut qualité n'est pas « OK » (humidité, KOR, rejet) et " +
        "achats dont le prix exige une validation du Branch Manager. Les seuils " +
        "sont ceux du contrôle amont : l'assistant les LIT, il ne les redéfinit pas.",
      statut: "publie",
      fonction: "qualitePortee",
      donneesRequises: ["achats"],
      porteesAutorisees: ["global", "zone", "cluster", "rt"],
      periodesAutorisees: ["campaign"],
      filtresAutorises: [],
      confianceMin: 0.55,
      clarification: null,
      groupes: [["qualite", "humidite", "kor", "rejet", "rejets", "bareme", "controle",
        "controles", "controler", "conformite", "conforme", "hors bareme", "validation"]],
      indices: ["combien", "achat", "achats", "attente", "prix", "bm"],
      exclusions: ["recu", "recus", "justificatif", "justificatifs", "piece", "pieces"],
      formulations: [
        "Combien d'achats sont à contrôler en qualité ?",
        "Achats hors barème de prix",
        "combien d achats en controle qualite",
        "achats avec un probleme d humidite",
        "quels achats attendent une validation bm",
        "controle qualite du cluster Botro"
      ]
    },

    /* ===================== PILOTAGE ======================================= */
    {
      code: "priority_alerts",
      nom: "Priorités du jour",
      description:
        "Alertes ordonnées par sévérité, telles que produites par le moteur " +
        "d'alertes. Une alerte à compteur nul n'est JAMAIS produite.",
      statut: "publie",
      fonction: "alertesPrioritaires",
      donneesRequises: ["achats", "avances", "reconciliations", "sacs", "villages"],
      porteesAutorisees: ["global"],
      periodesAutorisees: ["campaign", "day"],
      filtresAutorises: [],
      confianceMin: 0.5,
      clarification: null,
      groupes: [["priorite", "priorites", "prioritaire", "prioritaires", "urgent",
        "urgence", "urgences", "alerte", "alertes", "risque", "risques", "anomalie",
        "anomalies", "probleme", "problemes", "critique", "critiques", "traiter",
        "attention"]],
      indices: ["aujourd", "hui", "jour", "dois", "faire", "quoi"],
      exclusions: G_SACS.concat(["qualite", "humidite", "kor", "bareme", "cash",
        "caisse", "exposition"]),
      formulations: [
        "Que dois-je traiter en priorité aujourd'hui ?",
        "Quelles sont les alertes critiques ?",
        "quels sont les risques du jour",
        "qu est ce qui est urgent",
        "anomalies a traiter",
        "sur quoi dois je faire attention"
      ]
    },
    {
      code: "daily_summary",
      nom: "Synthèse du jour",
      description:
        "Synthèse quotidienne complète : volume, caisse, réconciliation, " +
        "sacherie, qualité, couverture, et les trois décisions du jour.",
      statut: "publie",
      fonction: "syntheseJour",
      donneesRequises: ["achats", "avances", "reconciliations", "sacs", "villages", "rt"],
      porteesAutorisees: ["global"],
      periodesAutorisees: ["campaign", "day"],
      filtresAutorises: [],
      confianceMin: 0.5,
      clarification: null,
      groupes: [["synthese", "syntheses", "resume", "resumer", "briefing", "brief",
        "bilan", "rapport", "point", "recapitulatif", "recap", "tableau de bord"]],
      indices: ["jour", "aujourd", "hui", "general", "generale", "global", "ensemble",
        "situation", "pilote", "aflp"],
      exclusions: G_RECON.concat(G_SACS, ["caisse", "cluster", "clusters", "village",
        "villages", "rt", "equipe", "equipes"]),
      formulations: [
        "Fais-moi la synthèse du jour",
        "Résume la situation",
        "point general du pilote",
        "bilan de la journee",
        "donne moi le briefing",
        "recapitulatif aflp"
      ]
    }
  ];

  /* Métadonnées communes. La version et la validation sont celles du CATALOGUE,
     pas de l'intention prise isolément : une intention qui porterait sa propre
     version divergerait tôt ou tard de celle qui est journalisée. */
  INTENTIONS.forEach(function (i) {
    i.version = VERSION_CATALOGUE;
    i.misAJour = DATE_CATALOGUE;
    i.valideePar = VALIDATION;
    if (!i.exclusions) i.exclusions = [];
    if (!i.indices) i.indices = [];
    if (!i.filtresAutorises) i.filtresAutorises = [];
  });

  function parCode(code) {
    for (var i = 0; i < INTENTIONS.length; i++) {
      if (INTENTIONS[i].code === code) return INTENTIONS[i];
    }
    return null;
  }

  function publiees() {
    return INTENTIONS.filter(function (i) {
      return i.statut === "publie" || i.statut === "non_disponible";
    });
  }

  /* Contrôle d'intégrité du catalogue lui-même, appelé par le banc d'essai.
     Un catalogue incohérent est un catalogue qui ment sur ce qu'il sait faire. */
  function verifier() {
    var pbs = [], vus = {};
    INTENTIONS.forEach(function (i) {
      if (vus[i.code]) pbs.push("code dupliqué : " + i.code);
      vus[i.code] = true;
      if (!/^[a-z][a-z0-9_]+$/.test(i.code)) pbs.push("code non conforme : " + i.code);
      if (!i.nom || !i.description) pbs.push(i.code + " : nom ou description manquant");
      if (["publie", "brouillon", "non_disponible", "desactive"].indexOf(i.statut) < 0) {
        pbs.push(i.code + " : statut inconnu « " + i.statut + " »");
      }
      if (i.statut === "publie" && !i.fonction) pbs.push(i.code + " : publiée sans fonction déterministe");
      if (i.statut === "non_disponible" && !i.donneeManquante) {
        pbs.push(i.code + " : non disponible sans donnée manquante nommée");
      }
      if (!i.formulations || i.formulations.length < 5) {
        pbs.push(i.code + " : moins de cinq formulations validées");
      }
      if (!i.groupes || !i.groupes.length) pbs.push(i.code + " : aucun groupe de reconnaissance");
      (i.porteesAutorisees || []).forEach(function (p) {
        if (PORTEES.indexOf(p) < 0) pbs.push(i.code + " : portée inconnue « " + p + " »");
      });
      (i.periodesAutorisees || []).forEach(function (p) {
        if (PERIODES.indexOf(p) < 0) pbs.push(i.code + " : période inconnue « " + p + " »");
      });
      (i.filtresAutorises || []).forEach(function (f) {
        if (FILTRES.indexOf(f) < 0) pbs.push(i.code + " : filtre inconnu « " + f + " »");
      });
      if (typeof i.confianceMin !== "number" || i.confianceMin <= 0 || i.confianceMin >= 1) {
        pbs.push(i.code + " : confiance minimale hors ]0,1[");
      }
    });
    if (INTENTIONS.length < 20 || INTENTIONS.length > 30) {
      pbs.push("le catalogue compte " + INTENTIONS.length + " intentions, hors de la plage 20-30");
    }
    return pbs;
  }

  var API = {
    version: VERSION_CATALOGUE,
    date: DATE_CATALOGUE,
    validation: VALIDATION,
    intentions: INTENTIONS,
    portees: PORTEES,
    periodes: PERIODES,
    filtres: FILTRES,
    breakdowns: BREAKDOWNS,
    statutsFiltre: STATUTS_FILTRE,
    parCode: parCode,
    publiees: publiees,
    verifier: verifier,
    /* Toutes les formulations validées, à plat — corpus de régression. */
    corpus: function () {
      var out = [];
      INTENTIONS.forEach(function (i) {
        (i.formulations || []).forEach(function (f) {
          out.push({ code: i.code, statut: i.statut, question: f });
        });
      });
      return out;
    }
  };

  global.AFLP_IA_CATALOGUE = API;
  if (typeof module === "object" && module.exports) module.exports = API;

})(typeof window !== "undefined" ? window : this);
