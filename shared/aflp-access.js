/* ============================================================================
   ANAGROCI FBMS — COUCHE D'AUTORISATION AFLP 2027  (shared/aflp-access.js)
   ----------------------------------------------------------------------------
   Source unique de vérité pour :
     · le catalogue des rôles (AFLP 2027 + rôles historiques conservés) ;
     · la hiérarchie des périmètres  GLOBAL > ZONE > CLUSTER > VILLAGE ;
     · la matrice de permissions  ROLE -> [ "ressource:action" ] ;
     · la fonction centrale       can(user, action, resource, cible).

   Principes tenus :
     · aucun test dispersé du type  if (role === "Branch Manager")  ;
     · aucun compte existant ne perd l'accès : tout rôle inconnu ou historique
       conserve ses droits actuels via LEGACY (§5) ;
     · le référentiel géographique reste FBMS : seul le rattachement
       zone -> clusters est déclaré ici (il n'existe nulle part ailleurs).
       Les clusters sont réconciliés avec les fiches villages par
       AFLP_ACCESS.hydrateFromVillages().
     · générique : ajouter une zone ou un cluster = ajouter une entrée dans
       ZONES, rien d'autre dans le code.

   Chargement (aucun build, ordre indifférent, avant l'application) :
       <script src="../shared/aflp-access.js"></script>   depuis /fbms/
       <script src="./shared/aflp-access.js"></script>    depuis la racine
   ========================================================================== */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";

  /* == 1. NIVEAUX D'AUTORITÉ ================================================ */
  /* Un niveau contient tous les niveaux inférieurs. TRANSVERSE = périmètre
     géographique large mais permissions étroites (Logistique, Finance, Audit). */
  var AUTHORITY = {
    GLOBAL:     { code: "GLOBAL",     rang: 4, label: "Programme entier" },
    ZONE:       { code: "ZONE",       rang: 3, label: "Zone" },
    CLUSTER:    { code: "CLUSTER",    rang: 2, label: "Cluster" },
    VILLAGE:    { code: "VILLAGE",    rang: 1, label: "Village" },
    TRANSVERSE: { code: "TRANSVERSE", rang: 3, label: "Transversal (métier)" },
  };

  /* == 2. RÉFÉRENTIEL ZONES -> CLUSTERS ===================================== */
  /* Seule donnée nouvelle : le rattachement d'un cluster à une zone. Les noms
     de clusters portent leurs variantes d'orthographe rencontrées sur le
     terrain pour être appariés aux fiches villages sans double saisie. */
  var ZONES = [
    { code: "GBEKE_1", label: "GBEKE 1", region: "Gbêkê", alias: ["gbeke1", "gbeke a", "zone a"], clusters: [
      { code: "DJEBONOUA", label: "Djébonoua", alias: ["djebonoua", "djebounou", "djebonoa"] },
      { code: "BROBO",     label: "Brobo",     alias: ["brobo"] },
      { code: "SAKASSOU",  label: "Sakassou",  alias: ["sakassou"] },
    ]},
    { code: "GBEKE_2", label: "GBEKE 2", region: "Gbêkê", alias: ["gbeke2", "gbeke b", "zone b"], clusters: [
      { code: "BEOUMI", label: "Béoumi", alias: ["beoumi"] },
      { code: "BOTRO",  label: "Botro",  alias: ["botro"] },
      { code: "DIABO",  label: "Diabo",  alias: ["diabo"] },
    ]},
  ];

  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  var _zoneIndex = {}, _clusterIndex = {};
  function reindex() {
    _zoneIndex = {}; _clusterIndex = {};
    ZONES.forEach(function (z) {
      [z.code, z.label].concat(z.alias || []).forEach(function (k) { _zoneIndex[norm(k)] = z; });
      (z.clusters || []).forEach(function (c) {
        c.zone = z.code;
        [c.code, c.label].concat(c.alias || []).forEach(function (k) { _clusterIndex[norm(k)] = c; });
      });
    });
  }
  reindex();

  function zone(code) { return _zoneIndex[norm(code)] || null; }
  function cluster(code) { return _clusterIndex[norm(code)] || null; }
  function zoneOfCluster(code) { var c = cluster(code); return c ? zone(c.zone) : null; }
  function clustersOfZone(code) { var z = zone(code); return z ? z.clusters.slice() : []; }
  function allClusters() { return ZONES.reduce(function (a, z) { return a.concat(z.clusters); }, []); }

  /* Déclare une zone (extension future : autre région, autre programme). */
  function declareZone(def) {
    var existing = zone(def.code);
    if (existing) { existing.clusters = def.clusters || existing.clusters; }
    else { ZONES.push(def); }
    reindex();
  }

  /* Réconciliation avec le référentiel maître FBMS : les clusters écrits dans
     les fiches villages qui ne sont rattachés à aucune zone sont signalés (et
     jamais inventés). Retourne la liste des clusters orphelins. */
  function hydrateFromVillages(villages) {
    var orphelins = {};
    (villages || []).forEach(function (v) {
      var nom = (v && v.s1 && v.s1.cluster) || v.cluster || "";
      if (!nom) return;
      if (!cluster(nom)) orphelins[norm(nom)] = nom;
    });
    return Object.keys(orphelins).map(function (k) { return orphelins[k]; });
  }

  /* == 3. RESSOURCES ET ACTIONS ============================================= */
  var RESOURCES = [
    "villages", "producteurs", "rt", "achats", "avances", "caisse", "wave",
    "stock", "sacs", "evacuations", "reconciliation", "qualite", "anomalies",
    "objectifs", "referentiel", "reporting", "exports", "utilisateurs",
  ];
  var ACTIONS = ["read", "create", "update", "delete", "validate", "admin"];

  /* == 4. MATRICE DE PERMISSIONS ============================================
     Format : "ressource:action". "*" est accepté des deux côtés.
     Aucune permission implicite : ce qui n'est pas listé est refusé.        */
  var P = {
    BRANCH_MANAGER: ["*:*"],

    ZONAL_HEAD: [
      "villages:read", "villages:update", "villages:validate",
      "producteurs:read", "rt:read", "rt:update", "rt:validate",
      "achats:read", "achats:validate", "avances:read", "avances:validate",
      "caisse:read", "stock:read", "sacs:read", "evacuations:read",
      "reconciliation:read", "reconciliation:validate",
      "qualite:read", "qualite:validate", "anomalies:read", "anomalies:update",
      "objectifs:read", "objectifs:update",
      "reporting:read", "exports:create", "utilisateurs:read",
    ],

    UNIT_HEAD: [
      "villages:read", "villages:create", "villages:update", "villages:validate",
      "producteurs:read", "producteurs:create", "producteurs:update",
      "rt:read", "rt:create", "rt:update", "rt:validate",
      "achats:read", "achats:create", "achats:update", "achats:validate",
      "avances:read", "avances:create",
      "caisse:read", "stock:read", "stock:update", "sacs:read", "sacs:update",
      "evacuations:read", "evacuations:create",
      "reconciliation:read", "reconciliation:create", "reconciliation:validate",
      "qualite:read", "qualite:update", "anomalies:read", "anomalies:create", "anomalies:update",
      "objectifs:read", "reporting:read", "exports:create",
    ],

    /* Assistant : le Unit Head moins TOUTES les validations et moins
       l'engagement d'avances. Les actions retirées passent par une demande de
       validation au Unit Head (voir demandeValidationRequise). */
    ASSISTANT_UNIT_HEAD: [
      "villages:read", "villages:create", "villages:update",
      "producteurs:read", "producteurs:create", "producteurs:update",
      "rt:read", "rt:create", "rt:update",
      "achats:read", "achats:create", "achats:update",
      "avances:read", "caisse:read",
      "stock:read", "stock:update", "sacs:read", "sacs:update",
      "evacuations:read", "reconciliation:read", "reconciliation:create",
      "qualite:read", "qualite:update", "anomalies:read", "anomalies:create",
      "objectifs:read", "reporting:read",
    ],

    LOGISTICS_COORDINATOR: [
      "stock:read", "stock:create", "stock:update", "stock:validate",
      "sacs:read", "sacs:create", "sacs:update", "sacs:validate",
      "evacuations:read", "evacuations:create", "evacuations:update", "evacuations:validate",
      "villages:read", "rt:read", "achats:read", "qualite:read",
      "anomalies:read", "anomalies:create",
      "reporting:read", "exports:create",
    ],

    WAREHOUSE_KEEPER: [
      "stock:read", "stock:create", "stock:update",
      "sacs:read", "sacs:create", "sacs:update",
      "evacuations:read", "evacuations:create",
      "villages:read", "anomalies:create",
    ],

    FINANCE_CONTROLLER: [
      "caisse:read", "caisse:create", "caisse:update", "caisse:validate",
      "avances:read", "avances:create", "avances:update", "avances:validate",
      "wave:read", "wave:create", "wave:update", "wave:validate",
      "reconciliation:read", "reconciliation:create", "reconciliation:validate",
      "achats:read", "stock:read", "sacs:read",
      "villages:read", "producteurs:read", "rt:read", "referentiel:read",
      "anomalies:read", "anomalies:create",
      "reporting:read", "exports:create",
    ],

    RT_FIELD_PARTNER: [
      "achats:read", "achats:create",
      "producteurs:read", "producteurs:create",
      "villages:read", "sacs:read",
    ],

    READ_ONLY_AUDIT: [
      "villages:read", "producteurs:read", "rt:read", "achats:read",
      "avances:read", "caisse:read", "wave:read", "stock:read", "sacs:read",
      "evacuations:read", "reconciliation:read", "qualite:read",
      "anomalies:read", "objectifs:read", "referentiel:read", "reporting:read",
    ],
  };

  /* == 5. CATALOGUE DES RÔLES ==============================================
     `scope` = champs de périmètre exigés à la création du compte.
     `legacy: true` = rôle historique conservé tant que des comptes en
     dépendent ; jamais supprimé automatiquement.                            */
  var ROLES = [
    { code: "BRANCH_MANAGER", label: "Branch Manager / Head of Programme",
      authority: "GLOBAL", scope: [], effectif: 1,
      resume: "Accès global · Administration · Validation · Reporting",
      detail: "Visibilité et autorité sur les 2 zones, 6 clusters, villages, RT, achats, avances, caisse, stocks, sacs, réconciliations, performances, risques et utilisateurs." },

    { code: "ZONAL_HEAD", label: "Zonal Head",
      authority: "ZONE", scope: ["zone"], effectif: 2,
      resume: "Accès limité à sa zone",
      detail: "Supervision des clusters de sa zone : volumes, prix, qualité, fonds, performance des Unit Heads, incidents majeurs." },

    { code: "LOGISTICS_COORDINATOR", label: "Logistics Coordinator",
      authority: "TRANSVERSE", scope: [], effectif: 1,
      resume: "Logistique · Stock · Sacs · Évacuations",
      detail: "Transversal sur les 6 clusters : mouvements, points de stockage, réception / expédition, suivi cluster → usine, hub de Bouaké, reporting logistique. Aucune administration des utilisateurs." },

    { code: "UNIT_HEAD", label: "Unit Head",
      authority: "CLUSTER", scope: ["zone", "cluster"], effectif: 6,
      resume: "Gestion opérationnelle de son cluster",
      detail: "Objectifs cluster, RT, mobilisation terrain, achats, stock, sacs, réconciliation, qualité, anomalies. Aucune écriture hors de son cluster." },

    { code: "ASSISTANT_UNIT_HEAD", label: "Assistant Unit Head",
      authority: "CLUSTER", scope: ["zone", "cluster"], effectif: 6,
      resume: "Support opérationnel du cluster",
      detail: "Mêmes données que le Unit Head, sans les validations ni l'engagement d'avances : ces actions partent en demande de validation." },

    { code: "WAREHOUSE_KEEPER", label: "Warehouse Keeper",
      authority: "CLUSTER", scope: ["zone", "cluster"], effectif: null,
      resume: "Stock · Sacs · Inventaire",
      detail: "Réception, sortie, inventaire, sacs, préparation d'évacuation sur son point de stockage. Aucun accès à l'administration ni au référentiel." },

    { code: "FINANCE_CONTROLLER", label: "Finance / Controller",
      authority: "TRANSVERSE", scope: [], effectif: null,
      resume: "Caisse · Avances · Wave · Réconciliation",
      detail: "Transversal sur les 6 clusters pour les données financières. Lecture seule sur villages, producteurs, RT et cartographie." },

    { code: "RT_FIELD_PARTNER", label: "RT / Field Partner",
      authority: "VILLAGE", scope: ["zone", "cluster", "village"], effectif: null,
      resume: "Accès limité à son village / activité",
      detail: "Partenaire opérationnel terrain, hors chaîne de management. Strictement son village et ses propres opérations." },

    { code: "READ_ONLY_AUDIT", label: "Read Only / Audit",
      authority: "TRANSVERSE", scope: [], effectif: null,
      resume: "Consultation uniquement",
      detail: "Direction, audit, contrôle, observateurs autorisés. Aucune création, modification, suppression ni validation." },
  ];

  /* Rôles historiques : conservés à l'identique tant qu'un compte les porte.
     `migreVers` n'est qu'une SUGGESTION affichée à l'écran de migration —
     aucune conversion automatique n'est faite nulle part. */
  var LEGACY = [
    { code: "LEGACY_ASSISTANT_BM", label: "Assistant Branch Manager", authority: "GLOBAL",
      permissions: P.BRANCH_MANAGER.slice(0, 0).concat(["*:read", "villages:create", "villages:update", "villages:validate", "producteurs:create", "producteurs:update", "rt:create", "rt:update", "rt:validate", "achats:create", "achats:update", "achats:validate", "avances:create", "stock:update", "sacs:update", "reconciliation:create", "reconciliation:validate", "qualite:update", "anomalies:create", "anomalies:update", "objectifs:update", "exports:create"]),
      migreVers: "ZONAL_HEAD", note: "Poste absent de l'architecture AFLP. Vérifier le périmètre réel avant migration." },

    { code: "LEGACY_HEAD_OF_FIELD", label: "Head of Field", authority: "GLOBAL",
      permissions: ["*:read", "villages:create", "villages:update", "villages:validate", "rt:create", "rt:update", "rt:validate", "producteurs:create", "producteurs:update", "exports:create"],
      migreVers: "ZONAL_HEAD", note: "Correspond probablement à Zonal Head. Vérifier la zone réelle du compte." },

    { code: "LEGACY_PROCUREMENT_OFFICER", label: "Procurement Officer", authority: "GLOBAL",
      permissions: ["*:read", "achats:create", "achats:update", "achats:validate", "avances:create", "exports:create"],
      migreVers: null, note: "Conservé comme rôle actif : l'organisation l'utilise encore." },

    { code: "LEGACY_SUPERVISOR", label: "Supervisor", authority: "CLUSTER",
      permissions: ["villages:read", "villages:create", "villages:update", "villages:validate", "producteurs:read", "producteurs:create", "producteurs:update", "rt:read", "rt:create", "rt:update", "rt:validate", "achats:read", "stock:read", "sacs:read", "reporting:read", "exports:create"],
      migreVers: "UNIT_HEAD", note: "Unit Head si le périmètre réel est un cluster, Zonal Head s'il couvre une zone." },

    { code: "LEGACY_AGENT_RECENSEUR", label: "Agent Recenseur", authority: "VILLAGE",
      permissions: ["villages:read", "villages:create", "villages:update", "producteurs:read", "producteurs:create", "producteurs:update", "rt:read"],
      migreVers: null, note: "Conservé : le recensement reste une fonction FBMS active." },

    { code: "LEGACY_CONSULTATION", label: "Consultation uniquement", authority: "TRANSVERSE",
      permissions: P.READ_ONLY_AUDIT,
      migreVers: "READ_ONLY_AUDIT", note: "Équivalent direct de Read Only / Audit." },
  ];

  /* Index rôle : par code ET par libellé (la base stocke profils.role en clair). */
  var ROLE_INDEX = {};
  function indexRoles() {
    ROLE_INDEX = {};
    ROLES.forEach(function (r) {
      r.legacy = false;
      r.permissions = P[r.code] || [];
      ROLE_INDEX[norm(r.code)] = r; ROLE_INDEX[norm(r.label)] = r;
    });
    LEGACY.forEach(function (r) {
      r.legacy = true;
      r.scope = r.scope || [];
      r.resume = r.resume || "Rôle historique — à migrer";
      ROLE_INDEX[norm(r.code)] = r; ROLE_INDEX[norm(r.label)] = r;
    });
    /* Alias d'écriture rencontrés en base. */
    ROLE_INDEX[norm("Zonal head")] = ROLE_INDEX[norm("ZONAL_HEAD")];
    ROLE_INDEX[norm("Unit head")] = ROLE_INDEX[norm("UNIT_HEAD")];
    ROLE_INDEX[norm("RT")] = ROLE_INDEX[norm("RT_FIELD_PARTNER")];
    ROLE_INDEX[norm("Read Only")] = ROLE_INDEX[norm("READ_ONLY_AUDIT")];
  }
  indexRoles();

  function role(any) { return ROLE_INDEX[norm(any)] || null; }
  function isLegacy(any) { var r = role(any); return !!(r && r.legacy); }
  function labelOf(any) { var r = role(any); return r ? r.label : String(any || ""); }

  /* Rôle de repli : un compte dont le rôle est illisible n'est jamais bloqué,
     il tombe en consultation. Il reste connectable et visible en migration. */
  var FALLBACK = ROLE_INDEX[norm("LEGACY_CONSULTATION")];

  /* == 6. UTILISATEUR NORMALISÉ ============================================
     Accepte une ligne `profils` (nom, email, role, actif, zone, cluster,
     village_id, permissions) et renvoie le modèle cible :
       { role, zone, cluster, village, permissions, status, authorityLevel }  */
  function normalizeUser(profil) {
    profil = profil || {};
    var r = role(profil.role) || FALLBACK;
    var z = zone(profil.zone || profil.zone_code || "");
    var c = cluster(profil.cluster || profil.cluster_code || "");
    /* Cohérence : un cluster impose sa zone (jamais GBEKE 1 + DIABO). */
    if (c && (!z || z.code !== c.zone)) z = zone(c.zone);
    var actif = profil.actif !== false && profil.status !== "inactif";
    return {
      email: (profil.email || "").toLowerCase(),
      nom: profil.nom || "",
      role: r.code,
      roleLabel: r.label,
      roleLegacy: !!r.legacy,
      zone: r.authority === "GLOBAL" ? "ALL" : (z ? z.code : null),
      cluster: r.authority === "GLOBAL" ? "ALL"
             : (r.authority === "ZONE" ? "ALL_CLUSTERS_IN_ZONE"
             : (r.authority === "TRANSVERSE" ? "ALL" : (c ? c.code : null))),
      village: profil.village_id || profil.village || null,
      rtId: profil.rt_id || profil.idRt || null,
      permissions: (r.permissions || []).concat(profil.permissions || []),
      status: actif ? "actif" : "inactif",
      authorityLevel: r.authority,
    };
  }

  /* Champs de périmètre exigés par un rôle (formulaire dynamique). */
  function scopeFields(roleAny) { var r = role(roleAny); return r ? (r.scope || []) : []; }

  /* Périmètre effectif d'un utilisateur : liste de clusters accessibles.

     RÈGLE DE NON-RUPTURE (§13) : un compte dont le rôle exige un périmètre
     mais dont AUCUN périmètre n'est encore enregistré n'est pas réduit à
     zéro — il garde le comportement d'aujourd'hui (aucune restriction) et
     ressort dans « Utilisateurs à qualifier ». C'est le seul état où le
     périmètre est absent : dès qu'une zone ou un cluster est saisi, la
     restriction s'applique pleinement. */
  function scopeOf(user) {
    var u = user && user.authorityLevel ? user : normalizeUser(user);
    if (u.authorityLevel === "GLOBAL" || u.authorityLevel === "TRANSVERSE") {
      return { level: u.authorityLevel, unset: false, zones: ZONES.map(function (z) { return z.code; }),
               clusters: allClusters().map(function (c) { return c.code; }), villages: null };
    }
    if (u.authorityLevel === "ZONE") {
      if (!u.zone) return scopeNonRenseigne("ZONE");
      return { level: "ZONE", unset: false, zones: [u.zone],
               clusters: clustersOfZone(u.zone).map(function (c) { return c.code; }), villages: null };
    }
    if (u.authorityLevel === "CLUSTER") {
      if (!u.cluster) return scopeNonRenseigne("CLUSTER");
      return { level: "CLUSTER", unset: false, zones: u.zone ? [u.zone] : [],
               clusters: [u.cluster], villages: null };
    }
    if (!u.cluster && !u.village) return scopeNonRenseigne("VILLAGE");
    return { level: "VILLAGE", unset: false, zones: u.zone ? [u.zone] : [],
             clusters: u.cluster ? [u.cluster] : [], villages: u.village ? [u.village] : [] };
  }
  function scopeNonRenseigne(niveauExige) {
    return { level: niveauExige, unset: true, zones: ZONES.map(function (z) { return z.code; }),
             clusters: allClusters().map(function (c) { return c.code; }), villages: null };
  }
  /* Le périmètre d'un compte est-il encore à qualifier ? */
  function scopeIncomplet(user) { return !!scopeOf(user).unset; }

  /* Lit le périmètre d'une cible hétérogène (fiche village, RT, achat, objet). */
  function targetOf(cible) {
    if (!cible) return null;
    if (typeof cible === "string") { var c0 = cluster(cible); return c0 ? { cluster: c0.code, zone: c0.zone } : null; }
    var s1 = cible.s1 || {};
    var cNom = cible.cluster || s1.cluster || "";
    var c = cluster(cNom);
    var z = zone(cible.zone || (c ? c.zone : ""));
    return {
      zone: z ? z.code : null,
      cluster: c ? c.code : null,
      village: cible.village_id || cible.villageId || cible.id || null,
      clusterBrut: cNom || null,
    };
  }

  /* La cible tombe-t-elle dans le périmètre de l'utilisateur ? */
  function inScope(user, cible) {
    var s = scopeOf(user);
    var tgt = targetOf(cible);
    if (!tgt) return true;                       // objet sans géographie (paramètre global)
    if (s.level === "GLOBAL" || s.level === "TRANSVERSE") return true;
    if (s.unset) return true;                    // périmètre pas encore qualifié : comportement actuel conservé
    if (tgt.cluster) {
      if (s.clusters.indexOf(tgt.cluster) < 0) return false;
    } else if (tgt.zone) {
      if (s.zones.indexOf(tgt.zone) < 0) return false;
    } else {
      /* Cluster inconnu du référentiel OU fiche sans cluster : un rôle à
         périmètre restreint ne la voit pas. Elle doit être rattachée à un
         cluster (écran Administration) avant d'entrer dans un périmètre. */
      return false;
    }
    if (s.level === "VILLAGE") {
      if (!tgt.village) return false;
      return s.villages.indexOf(tgt.village) >= 0;
    }
    return true;
  }

  function matchPerm(perms, resource, action) {
    var want = resource + ":" + action;
    for (var i = 0; i < perms.length; i++) {
      var p = perms[i];
      if (p === want || p === "*:*") return true;
      var parts = p.split(":");
      if ((parts[0] === "*" || parts[0] === resource) && (parts[1] === "*" || parts[1] === action)) return true;
    }
    return false;
  }

  /* == 7. FONCTION CENTRALE ================================================
     can(user, "validate", "achats", ficheOuCluster)
     Vérifie SIMULTANÉMENT : rôle, permission, statut du compte, zone,
     cluster, village. Utilisée aussi bien par l'affichage que par la logique
     de données — masquer un bouton n'est jamais la protection.              */
  function can(user, action, resource, cible) {
    if (!user) return false;
    var u = user.authorityLevel ? user : normalizeUser(user);
    if (u.status !== "actif") return false;
    if (!matchPerm(u.permissions, resource, action)) return false;
    if (action === "read") return inScope(u, cible) || u.authorityLevel === "TRANSVERSE";
    return inScope(u, cible);
  }

  /* Motif de refus lisible (messages d'interface homogènes). */
  function refus(user, action, resource, cible) {
    var u = user && user.authorityLevel ? user : normalizeUser(user);
    if (!u || u.status !== "actif") return "Compte désactivé.";
    if (!matchPerm(u.permissions, resource, action))
      return "Votre rôle (" + u.roleLabel + ") ne permet pas cette action sur « " + resource + " ».";
    var tgt = targetOf(cible);
    var ou = tgt && (tgt.clusterBrut || tgt.cluster || tgt.zone);
    return "Hors de votre périmètre" + (ou ? " (" + ou + ")" : "") + ".";
  }

  /* Une action refusée à un Assistant Unit Head mais permise à son Unit Head
     n'est pas un mur : c'est une demande de validation. */
  function demandeValidationRequise(user, action, resource, cible) {
    var u = user && user.authorityLevel ? user : normalizeUser(user);
    if (u.role !== "ASSISTANT_UNIT_HEAD") return false;
    if (can(u, action, resource, cible)) return false;
    return matchPerm(P.UNIT_HEAD, resource, action) && inScope(u, cible);
  }

  /* Filtre une collection selon le périmètre — à appeler AVANT tout rendu,
     export, statistique ou recherche. */
  function filterByScope(user, rows, lire) {
    var u = user && user.authorityLevel ? user : normalizeUser(user);
    var s = scopeOf(u);
    if (s.level === "GLOBAL" || s.level === "TRANSVERSE" || s.unset) return (rows || []).slice();
    return (rows || []).filter(function (row) { return inScope(u, lire ? lire(row) : row); });
  }

  /* == 8. MIGRATION ========================================================
     Ne convertit rien. Décrit ce qu'il y aurait à faire, compte par compte. */
  function migrationSuggestion(profil) {
    var r = role(profil && profil.role);
    if (!r) return { aMigrer: true, suggestion: null, note: "Rôle inconnu en base : à qualifier avant toute migration." };
    if (!r.legacy) {
      var manquants = (r.scope || []).filter(function (f) {
        return !(profil[f] || profil[f + "_code"] || (f === "village" && profil.village_id));
      });
      return manquants.length
        ? { aMigrer: true, suggestion: r.code, note: "Périmètre incomplet : " + manquants.join(", ") + " à renseigner." }
        : { aMigrer: false, suggestion: null, note: "" };
    }
    return { aMigrer: true, suggestion: r.migreVers, note: r.note };
  }

  /* == 9. AUDIT ============================================================
     Délègue au journal existant (ANAGROCI.audit -> table audit_log). Jamais
     bloquant : une action tracée qui échoue à s'écrire ne casse pas l'action. */
  function audit(action, details) {
    try {
      if (global.ANAGROCI && typeof global.ANAGROCI.audit === "function") return global.ANAGROCI.audit(action, details || null);
      if (global.ANAGROCI_AUDIT && typeof global.ANAGROCI_AUDIT.log === "function") return global.ANAGROCI_AUDIT.log(action, details || null);
    } catch (e) { /* best effort */ }
  }
  /* Trace normalisée d'un changement de compte (avant / après). */
  function auditUser(action, cible, avant, apres) {
    return audit(action, { cible: cible, avant: avant == null ? null : avant, apres: apres == null ? null : apres, at: new Date().toISOString() });
  }

  /* == 10. Compatibilité portail : niveau d'accès module ===================
     auth-gate.js raisonne en niveaux (bm / chef / agent / direction). On
     conserve ce vocabulaire pour ne casser aucun module existant.           */
  function niveauPortail(roleAny) {
    var r = role(roleAny);
    if (!r) return "agent";
    switch (r.code) {
      case "BRANCH_MANAGER":
      case "LEGACY_ASSISTANT_BM":
      case "LEGACY_HEAD_OF_FIELD":
      case "LEGACY_PROCUREMENT_OFFICER": return "bm";
      case "ZONAL_HEAD":
      case "LOGISTICS_COORDINATOR":
      case "FINANCE_CONTROLLER":
      case "UNIT_HEAD":
      case "ASSISTANT_UNIT_HEAD":
      case "LEGACY_SUPERVISOR": return "chef";
      case "WAREHOUSE_KEEPER":
      case "RT_FIELD_PARTNER":
      case "LEGACY_AGENT_RECENSEUR": return "agent";
      case "READ_ONLY_AUDIT":
      case "LEGACY_CONSULTATION": return "direction";
      default: return "agent";
    }
  }

  global.AFLP_ACCESS = {
    VERSION: VERSION,
    AUTHORITY: AUTHORITY, ZONES: ZONES, RESOURCES: RESOURCES, ACTIONS: ACTIONS,
    ROLES: ROLES, LEGACY: LEGACY, PERMISSIONS: P,
    norm: norm, zone: zone, cluster: cluster, zoneOfCluster: zoneOfCluster,
    clustersOfZone: clustersOfZone, allClusters: allClusters,
    declareZone: declareZone, hydrateFromVillages: hydrateFromVillages,
    role: role, roleLabel: labelOf, isLegacy: isLegacy, scopeFields: scopeFields,
    normalizeUser: normalizeUser, scopeOf: scopeOf, targetOf: targetOf,
    inScope: inScope, can: can, refus: refus, scopeIncomplet: scopeIncomplet,
    demandeValidationRequise: demandeValidationRequise, filterByScope: filterByScope,
    migrationSuggestion: migrationSuggestion,
    audit: audit, auditUser: auditUser, niveauPortail: niveauPortail,
  };
})(window);
