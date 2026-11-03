/* ============================================================================
   ANAGROCI OPERATIONS SUITE — Couche partagée (shared/anagroci-config.js)
   ----------------------------------------------------------------------------
   Fichier UNIQUE de configuration et de gouvernance de la plateforme mère.
   Chargé par le portail ET par chaque application (FBMS, ALIS, futurs modules).
   Objectif : une seule config, une seule identité, une donnée partagée.

     <script src="../shared/anagroci-config.js"></script>   (depuis /fbms/, /logistique/)
     <script src="./shared/anagroci-config.js"></script>    (depuis la racine)

   Principe Master Data Management :
     · FBMS est le référentiel MAÎTRE (zones, clusters, villages, RT, producteurs).
     · ALIS et les autres modules LISENT ces données via ANAGROCI.data.*,
       ils ne les recréent jamais.
   ========================================================================== */
(function (global) {
  "use strict";

  /* -- 1. Configuration Supabase (clé publique : sécurité par les RLS) ------ */
  const CONFIG = {
    version: "1.0.0",
    supabase: {
      url: "https://jmbdgpdthzpszfnddwzi.supabase.co",
      anonKey: "sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d",
    },
    // Emplacements finaux des applications (liens absolus, robustes en test comme en prod).
    base: "https://nwodobe.github.io/fbms",
    apps: {
      portail:    "/index.html",
      fbms:       "/fbms/index.html",
      logistique: "/logistique/index.html",
    },
  };

  /* -- 2. Rôles et droits (mappage table profils → accès plateforme) -------- */
  // Rôles réels stockés dans Supabase (table profils.role) :
  //   Branch Manager, Assistant Branch Manager, Head of Field,
  //   Procurement Officer, Supervisor, Agent Recenseur, Consultation uniquement
  const ROLES = {
    niveau: function (roleSupabase) {
      switch (roleSupabase) {
        case "Branch Manager":
        case "Assistant Branch Manager":
        case "Head of Field":
        case "Procurement Officer": return "bm";     // accès large
        case "Supervisor":          return "chef";   // chef d'équipe cluster
        case "Agent Recenseur":     return "agent";  // FBMS uniquement
        case "Consultation uniquement": return "direction";
        default:                    return "agent";  // moindre privilège
      }
    },
    // Droit d'accès d'un niveau à un module.
    peutOuvrir: function (niveau, moduleId) {
      const M = {
        fbms:       ["bm", "chef", "agent", "admin"],
        logistique: ["bm", "chef", "admin"],
        achats:     ["bm", "chef", "admin"],
        stocks:     ["bm", "chef", "admin"],
        qualite:    ["bm", "admin"],
        paiements:  ["bm", "admin"],
        reporting:  ["bm", "direction", "admin"],
        admin:      ["bm", "admin"],
      };
      return (M[moduleId] || []).indexOf(niveau) >= 0;
    },
    // Seul le Branch Manager peut supprimer (aligné sur le trigger Supabase).
    peutSupprimer: function (roleSupabase) { return roleSupabase === "Branch Manager"; },
  };

  /* -- 3. Client Supabase partagé (une seule instance par page) -------------- */
  let _sb = null;
  function sb() {
    if (_sb) return _sb;
    if (!global.supabase) throw new Error("supabase-js non chargé (ajoutez le script CDN avant anagroci-config.js).");
    _sb = global.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
    return _sb;
  }
  async function session() {
    try { const { data } = await sb().auth.getSession(); return data.session || null; }
    catch (e) { return null; }
  }
  async function profilCourant() {
    const s = await session();
    if (!s) return null;
    const { data } = await sb().from("profils").select("nom, role, actif").eq("user_id", s.user.id).single();
    if (!data || !data.actif) return null;
    return { email: s.user.email, nom: data.nom, role: data.role, niveau: ROLES.niveau(data.role) };
  }

  /* -- 4. PONT DE DONNÉES — lecture du référentiel maître FBMS --------------- */
  // Les modules (ALIS, Achats, Stocks…) appellent ANAGROCI.data.* pour lire les
  // données terrain. Aucun module ne recrée villages / clusters / RT.
  const data = {
    // Villages actifs (validés ou non selon filtre). Renvoie l'objet métier complet.
    async villages(opts) {
      opts = opts || {};
      let q = sb().from("villages").select("data, region, departement, score, statut, updated_at").eq("deleted", false);
      if (opts.statut) q = q.eq("statut", opts.statut);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return (rows || []).map(r => Object.assign({}, r.data, {
        region: r.region, departement: r.departement, score: r.score, statut: r.statut, updatedAt: r.updated_at,
      }));
    },
    // Clusters déduits des fiches villages (le cluster est un champ de la fiche).
    async clusters() {
      const vs = await this.villages();
      const map = {};
      vs.forEach(v => {
        const c = ((v.s1 && v.s1.cluster) || "").trim();
        if (!c) return;
        if (!map[c]) map[c] = { cluster: c, region: (v.s1 && v.s1.region) || "", departement: (v.s1 && v.s1.departement) || "", villages: 0, potentielMT: 0 };
        map[c].villages += 1;
        map[c].potentielMT += Number(v.s3 && v.s3.potentielMT) || 0;
      });
      return Object.values(map);
    },
    // RT actifs (référentiel maître FBMS).
    async rt(opts) {
      opts = opts || {};
      let q = sb().from("rt").select("data, statut, village_nom").eq("deleted", false);
      if (opts.statut) q = q.eq("statut", opts.statut);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return (rows || []).map(r => Object.assign({}, r.data, { statut: r.statut, villageNom: r.village_nom }));
    },
    // Producteurs d'un village donné (chargement par village, jamais toute la base).
    async producteursDuVillage(villageId) {
      const { data: rows, error } = await sb().from("producteurs")
        .select("data, code, statut").eq("village_id", villageId).eq("deleted", false);
      if (error) throw new Error(error.message);
      return (rows || []).map(r => Object.assign({}, r.data, { code: r.code, statut: r.statut }));
    },
  };

  /* -- 5. Journal d'audit partagé (chaque action sensible) ------------------ */
  async function audit(action, details) {
    try {
      const p = await profilCourant();
      await sb().from("audit_log").insert({ email: p ? p.email : null, action: action, details: details || null });
    } catch (e) { /* audit best-effort, jamais bloquant */ }
  }

  /* -- Export global -------------------------------------------------------- */
  global.ANAGROCI = { CONFIG, ROLES, sb, session, profilCourant, data, audit };
})(window);
