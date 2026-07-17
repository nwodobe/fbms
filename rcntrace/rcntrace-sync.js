/* ============================================================================
   RCN TRACE — Synchronisation Supabase (rcntrace/rcntrace-sync.js)
   ----------------------------------------------------------------------------
   Écriture RÉELLE vers Supabase, offline-first (NFR-02) :
     · Hydratation au démarrage (le serveur est la source partagée).
     · Write-through : chaque mutation du moteur est repoussée (upsert JSONB
       dans rcn_state) ; le journal d'audit alimente rcn_audit (append-only).
     · Hors connexion : les écritures restent locales et sont rejouées au
       retour du réseau (aucune perte, aucun doublon — upsert idempotent).
   Ne bloque JAMAIS l'interface : toute erreur réseau bascule en mode local.
   S'appuie sur window.RCN (moteur) et sur supabase-js (déjà chargé par la page).
   ========================================================================== */
(function (global) {
  "use strict";

  var SUPABASE_URL = "https://jmbdgpdthzpszfnddwzi.supabase.co";
  var SUPABASE_ANON = "sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d";

  var R = null, sb = null;
  var hasSession = false;
  var mode = "local";                 // 'online' | 'offline' | 'local'
  var synced = {};                    // clé 'kind:id' -> hash du payload déjà poussé
  var auditSynced = {};               // id AUD déjà poussé
  var pending = 0;
  var supplierCache = null, supplierLoading = null;
  var flushTimer = null, flushing = false, reflush = false;

  function hash(o) { try { return JSON.stringify(o); } catch (e) { return Math.random(); } }
  function nowISO() { return new Date().toISOString(); }
  function report() {
    if (typeof global.RCNTRACE_SYNCSTATUS === "function") global.RCNTRACE_SYNCSTATUS({ mode: mode, pending: pending, hasSession: hasSession });
  }

  function ensureClient() {
    if (sb) return sb;
    if (!global.supabase || !global.supabase.createClient) return null;
    sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    return sb;
  }

  /* ---- Reconstruction du magasin local à partir du serveur ---------- */
  function rebuildFromRows(rows, auditRows) {
    var db = R.db();
    var buckets = { reception: [], lot: [], binCycle: [], transfer: [], cal: [] };
    var meta = null;
    rows.forEach(function (r) {
      if (r.kind === "meta") meta = r.payload;
      else if (buckets[r.kind]) buckets[r.kind].push(r.payload);
    });
    db.receptions = buckets.reception;
    db.lots = buckets.lot;
    db.binCycles = buckets.binCycle;
    db.transfers = buckets.transfer;
    db.cals = buckets.cal;
    if (meta) {
      db.seq = meta.seq || {};
      db.referentials = meta.referentials || db.referentials;
      db.user = meta.user || db.user;
      db.movements = meta.movements || [];
      db.documents = meta.documents || [];
      db.dryings = meta.dryings || [];
      db.jute = meta.jute || [];
      db.procurement = meta.procurement || db.procurement || { engagements: [], financements: [], arrivages: [] };
    }
    db.audit = (auditRows || []).map(function (a) {
      return { id: a.id, at: a.created_at, objet: a.objet, champ: a.champ, avant: a.avant, apres: a.apres, motif: a.motif, auteur: a.auteur, role: a.role };
    });
    db.seeded = true;
    R.save();
    // marquer comme déjà synchronisé
    synced = {}; auditSynced = {};
    rows.forEach(function (r) { synced[r.kind + ":" + r.id] = hash(r.payload); });
    db.audit.forEach(function (a) { auditSynced[a.id] = 1; });
  }

  function snapshot() {
    var db = R.db();
    var rows = [{ kind: "meta", id: "singleton", payload: { seq: db.seq, referentials: db.referentials, user: db.user, seeded: true, movements: db.movements, documents: db.documents, dryings: db.dryings || [], jute: db.jute || [], procurement: db.procurement || { engagements: [], financements: [], arrivages: [] } } }];
    db.receptions.forEach(function (r) { rows.push({ kind: "reception", id: r.id, payload: r }); });
    db.lots.forEach(function (l) { rows.push({ kind: "lot", id: l.id, payload: l }); });
    db.binCycles.forEach(function (c) { rows.push({ kind: "binCycle", id: c.id, payload: c }); });
    db.transfers.forEach(function (x) { rows.push({ kind: "transfer", id: x.id, payload: x }); });
    db.cals.forEach(function (c) { rows.push({ kind: "cal", id: c.id, payload: c }); });
    return rows;
  }

  /* ---- Flush : pousse les agrégats modifiés + les nouveaux audits ---- */
  function doFlush() {
    if (!sb || !hasSession || !navigator.onLine) { pending = countDirty(); mode = navigator.onLine ? mode : "offline"; report(); return Promise.resolve(); }
    if (flushing) { reflush = true; return Promise.resolve(); }
    flushing = true;
    var rows = snapshot();
    var dirty = rows.filter(function (r) { return synced[r.kind + ":" + r.id] !== hash(r.payload); });
    var db = R.db();
    var newAudit = db.audit.filter(function (a) { return !auditSynced[a.id]; });

    var jobs = [];
    if (dirty.length) {
      jobs.push(sb.from("rcn_state").upsert(dirty.map(function (r) {
        return { kind: r.kind, id: r.id, payload: r.payload, updated_at: nowISO() };
      }), { onConflict: "kind,id" }).then(function (res) {
        if (res.error) throw res.error;
        dirty.forEach(function (r) { synced[r.kind + ":" + r.id] = hash(r.payload); });
      }));
    }
    if (newAudit.length) {
      jobs.push(sb.from("rcn_audit").upsert(newAudit.map(function (a) {
        return { id: a.id, objet: a.objet, champ: a.champ, avant: a.avant, apres: a.apres, motif: a.motif, auteur: a.auteur, role: a.role, created_at: a.at };
      }), { onConflict: "id" }).then(function (res) {
        if (res.error) throw res.error;
        newAudit.forEach(function (a) { auditSynced[a.id] = 1; });
      }));
    }

    // Registres Procurement normalisés : l'ordre engagements → financements /
    // arrivages respecte les clés étrangères et évite les données orphelines.
    var proc = db.procurement || { engagements: [], financements: [], arrivages: [] };
    var engRows = (proc.engagements || []).map(function (e) {
      return { id: e.id, supplier_code: e.supplierLba || null, campagne: e.campagne || "2026", statut: e.statut || "ACTIF", echeance: e.echeance || null, payload: e, updated_at: nowISO() };
    });
    var finRows = (proc.financements || []).map(function (f) {
      return { id: f.id, engagement_id: f.engagementId || null, supplier_code: f.supplierLba || null, statut: f.statut || "À_APPROUVER", echeance: f.echeance || null, montant: Number(f.montant || 0), payload: f, updated_at: nowISO() };
    });
    var arrRows = (proc.arrivages || []).map(function (a) {
      return { id: a.id, engagement_id: a.engagementId || null, supplier_code: a.supplierLba || null, statut: a.statut || "ANNONCÉ", prevu_at: a.prevuAt || null, reception_id: a.recId || null, payload: a, updated_at: nowISO() };
    });
    if (engRows.length || finRows.length || arrRows.length) {
      jobs.push((engRows.length ? sb.from("rcn_proc_engagements").upsert(engRows, { onConflict: "id" }).then(function (res) { if (res.error) throw res.error; }) : Promise.resolve())
        .then(function () {
          return Promise.all([
            finRows.length ? sb.from("rcn_proc_financements").upsert(finRows, { onConflict: "id" }).then(function (res) { if (res.error) throw res.error; }) : Promise.resolve(),
            arrRows.length ? sb.from("rcn_proc_arrivages").upsert(arrRows, { onConflict: "id" }).then(function (res) { if (res.error) throw res.error; }) : Promise.resolve()
          ]);
        }));
    }

    return Promise.all(jobs).then(function () {
      mode = "online"; pending = countDirty(); flushing = false;
      if (reflush) { reflush = false; return doFlush(); }
      report();
    }, function (err) {
      flushing = false; mode = navigator.onLine ? "online" : "offline"; pending = countDirty();
      report();
      // erreur non bloquante : on retentera au prochain save / retour réseau
      if (global.console) console.warn("RCN TRACE sync : écriture différée —", err && err.message);
    });
  }
  function countDirty() {
    try {
      var rows = snapshot();
      var n = rows.filter(function (r) { return synced[r.kind + ":" + r.id] !== hash(r.payload); }).length;
      var db = R.db();
      n += db.audit.filter(function (a) { return !auditSynced[a.id]; }).length;
      return n;
    } catch (e) { return 0; }
  }
  function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(function () { doFlush(); }, 400); pending = countDirty(); report(); }

  /* ---- Hydratation initiale ---------------------------------------- */
  function hydrate() {
    return Promise.all([
      sb.from("rcn_state").select("kind,id,payload"),
      sb.from("rcn_audit").select("*").order("created_at", { ascending: false }).limit(500),
      sb.from("rcn_proc_engagements").select("payload").order("created_at", { ascending: false }),
      sb.from("rcn_proc_financements").select("payload").order("created_at", { ascending: false }),
      sb.from("rcn_proc_arrivages").select("payload").order("created_at", { ascending: false })
    ]).then(function (all) {
      all.forEach(function (res) { if (res.error) throw res.error; });
      var stateRows = all[0].data || [], auditRows = all[1].data || [];
      rebuildFromRows(stateRows, auditRows);
      var db = R.db();
      var pe = (all[2].data || []).map(function (x) { return x.payload; });
      var pf = (all[3].data || []).map(function (x) { return x.payload; });
      var pa = (all[4].data || []).map(function (x) { return x.payload; });
      // Première migration : préserver les anciennes données locales / meta
      // lorsque les nouvelles tables centrales sont encore vides.
      if (pe.length || pf.length || pa.length) {
        db.procurement = { engagements: pe, financements: pf, arrivages: pa };
      } else if (!db.procurement) {
        db.procurement = { engagements: [], financements: [], arrivages: [] };
      }
      R.save();
      return !!(stateRows.length || db.procurement.engagements.length || db.procurement.financements.length || db.procurement.arrivages.length);
    });
  }

  function armWriteThrough() {
    global.RCNTRACE_ONSAVE = function () { scheduleFlush(); };
  }

  /* ---- Acteur : reprendre le profil connecté (nom + rôle) ----------- */
  // Le moteur estampille l'auteur des saisies et de l'audit avec R.db().user.
  // On y injecte le profil Supabase de l'utilisateur connecté (NFR-05, §13.1)
  // pour que « qui a saisi/contrôlé/validé » soit exact. Cache local pour le
  // mode hors connexion.
  function setEngineUser(u) {
    if (!u || !u.nom) return;
    var db = R.db(); db.user = { nom: u.nom, role: u.role || "" };
    R.save();
    try { localStorage.setItem("rcntrace.profil", JSON.stringify(db.user)); } catch (e) {}
    if (typeof global.RCNTRACE_USER_SET === "function") global.RCNTRACE_USER_SET(db.user);
  }
  function applyProfil(uid) {
    if (!uid) return Promise.resolve();
    if (!sb || !navigator.onLine) {
      try { var c = JSON.parse(localStorage.getItem("rcntrace.profil") || "null"); if (c) setEngineUser(c); } catch (e) {}
      return Promise.resolve();
    }
    return sb.from("profils").select("nom, role, actif").eq("user_id", uid).single()
      .then(function (res) { if (res.data && res.data.actif) setEngineUser(res.data); })
      .catch(function () { /* profil non lisible : on garde le défaut */ });
  }

  /* ---- Base fournisseurs sécurisée --------------------------------- */
  function loadSuppliers() {
    if (!hasSession) return Promise.resolve(null);
    if (supplierCache) return Promise.resolve(supplierCache.slice());
    if (supplierLoading) return supplierLoading;
    var client = ensureClient();
    if (!client) return Promise.resolve(null);
    supplierLoading = client.from("rcn_fournisseurs")
      .select("code,nom,categorie,statut,contrat,origines,sites,nb_livraisons,volume_livre_kg,sacs_livres,kor_moyen,humidite_moyenne,nut_count_moyen,premiere_livraison,derniere_livraison")
      .order("code", { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        supplierCache = res.data || [];
        if (global.RCNTRACE_RERENDER) global.RCNTRACE_RERENDER();
        return supplierCache.slice();
      })
      .catch(function (err) {
        console.warn("RCN TRACE : base fournisseurs indisponible", err);
        supplierCache = [];
        return [];
      })
      .then(function (rows) { supplierLoading = null; return rows; });
    return supplierLoading;
  }

  function saveSupplier(f) {
    if (!hasSession) return Promise.reject(new Error("Connexion requise."));
    var client = ensureClient();
    var row = { code: f.lba, nom: f.nom, categorie: /^LBA-/.test(f.lba) ? "LBA" : "DIRECT", statut: "ACTIF", updated_at: nowISO() };
    return client.from("rcn_fournisseurs").upsert(row, { onConflict: "code" }).then(function (res) {
      if (res.error) throw res.error;
      supplierCache = null;
      return loadSuppliers();
    });
  }

  /* ---- API publique ------------------------------------------------- */
  var API = {
    status: function () { return { mode: mode, pending: pending, hasSession: hasSession }; },
    suppliers: function () { return supplierCache ? supplierCache.slice() : null; },
    loadSuppliers: loadSuppliers,
    saveSupplier: saveSupplier,
    flush: function () { return doFlush(); },
    init: function () {
      R = global.RCN;
      if (!R) return Promise.resolve();
      var client = ensureClient();
      var done = function () { armWriteThrough(); report(); };

      if (!client) { R.seedDemo(false); mode = "local"; done(); return Promise.resolve(); }

      return client.auth.getSession().then(function (r) {
        var session = r && r.data && r.data.session;
        hasSession = !!session;
        var uid = session ? session.user.id : null;
        // Ré-hydrater / repousser lors d'une connexion ultérieure (auth-gate).
        client.auth.onAuthStateChange(function (ev, sess) {
          if (ev === "SIGNED_IN" && sess && !hasSession) {
            hasSession = true; supplierCache = null;
            applyProfil(sess.user.id).then(hydrate).then(function (had) { if (!had) doFlush(); else { report(); if (global.RCNTRACE_RERENDER) global.RCNTRACE_RERENDER(); } })
              .catch(function () { doFlush(); });
          }
          if (ev === "SIGNED_OUT") { hasSession = false; supplierCache = null; mode = "local"; report(); }
        });

        if (hasSession && navigator.onLine) {
          return hydrate().then(function (had) {
            if (!had) R.seedDemo(false);
            return applyProfil(uid).then(function () { mode = "online"; done(); return doFlush(); });
          }).catch(function () { R.seedDemo(false); applyProfil(uid); mode = "offline"; done(); });
        }
        R.seedDemo(false); applyProfil(uid); mode = navigator.onLine ? "local" : "offline"; done();
      }).catch(function () { R.seedDemo(false); mode = "offline"; done(); });
    }
  };

  // Rejouer la file au retour du réseau.
  global.addEventListener("online", function () { if (hasSession) doFlush(); else report(); });
  global.addEventListener("offline", function () { mode = "offline"; report(); });

  global.RCNSync = API;
})(window);
