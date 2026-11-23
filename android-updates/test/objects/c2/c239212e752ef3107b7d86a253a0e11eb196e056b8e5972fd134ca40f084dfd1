/* REPÈRES GPS AFLP · stockage local durable et synchronisation
   --------------------------------------------------------------------------------
   · Base IndexedDB DÉDIÉE (aflp_reperes_gps_db). Les bases existantes
     (anagroci_ops_offline, aflp_farmer_registry_db, aflp_plot_map_db,
     anagroci_observatoire) ne sont ni modifiées ni migrées : leurs noms et versions
     restent identiques, la mise à jour de l'application ne touche donc à aucune file.
   · « Enregistré » n'est annoncé qu'après la fin de la transaction sur le disque
     (durability 'strict'). Le repère ET l'opération à transmettre sont écrits dans
     LA MÊME transaction : jamais l'un sans l'autre.
   · Aucun repli en mémoire ou en localStorage : si le stockage durable est
     indisponible, l'enregistrement est REFUSÉ avec un message, pas simulé.
   · Tout est rangé par compte. Sans compte identifié, rien n'est enregistré ni envoyé.
   · Une opération n'est « transmise » qu'après la réponse ACCEPTEE du serveur.
     Réseau présent mais serveur muet : elle reste « en attente ». Refus ou conflit :
     la saisie est conservée, avec son motif.
   Dépend de ANAGROCI_REPERES_COEUR. Expose ANAGROCI_REPERES_LOCAL. */
(function (global) {
  'use strict';
  var C = global.ANAGROCI_REPERES_COEUR;
  var DB_NAME = 'aflp_reperes_gps_db', DB_VERSION = 1, LOT = 20, RPC = 'geo_reperes_sync_batch';
  var STRICT = { durability: 'strict' };
  var dbp = null, enCours = null, ecouteurs = [];

  function maintenant() { return new Date().toISOString(); }
  function ouvrir() {
    if (dbp) return dbp;
    dbp = new Promise(function (ok, ko) {
      if (!global.indexedDB) { ko(new Error('Le stockage durable de ce téléphone est indisponible.')); return; }
      var r;
      try { r = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { ko(new Error('Le stockage durable de ce téléphone est indisponible.')); return; }
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('reperes')) { var s = d.createObjectStore('reperes', { keyPath: 'cle' }); s.createIndex('compte', 'compte'); }
        if (!d.objectStoreNames.contains('file')) { var f = d.createObjectStore('file', { keyPath: 'idempotency_key' }); f.createIndex('compte', 'compte'); }
        if (!d.objectStoreNames.contains('brouillons')) d.createObjectStore('brouillons', { keyPath: 'cle' });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'cle' });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { ko(r.error || new Error('Ouverture du stockage local impossible.')); };
      r.onblocked = function () { ko(new Error('Stockage local occupé : fermez les autres fenêtres de l\'application.')); };
    }).catch(function (e) { dbp = null; throw e; });
    return dbp;
  }
  /* Transaction sur un ou plusieurs magasins. fn(magasins) peut renvoyer une requête dont
     le résultat sera rendu. La promesse n'aboutit qu'à oncomplete : données sur le disque. */
  function tx(noms, mode, fn) {
    return ouvrir().then(function (d) {
      return new Promise(function (ok, ko) {
        var t = mode === 'readwrite' ? d.transaction(noms, mode, STRICT) : d.transaction(noms, mode), m = {}, out;
        [].concat(noms).forEach(function (n) { m[n] = t.objectStore(n); });
        var req;
        try { req = fn(m); } catch (e) { try { t.abort(); } catch (x) {} ko(e); return; }
        if (req && typeof req === 'object' && 'onsuccess' in req) req.onsuccess = function () { out = req.result; };
        t.oncomplete = function () { ok(out); };
        t.onerror = function () { ko(t.error || new Error('Écriture locale impossible.')); };
        t.onabort = function () { ko(t.error || new Error('Écriture locale interrompue (espace plein ?).')); };
      });
    });
  }
  function tout(nom) { return tx(nom, 'readonly', function (m) { return m[nom].getAll(); }).then(function (x) { return x || []; }); }
  function lire(nom, cle) { return tx(nom, 'readonly', function (m) { return m[nom].get(cle); }).then(function (x) { return x || null; }); }
  function emettre() { ecouteurs.forEach(function (f) { try { f(); } catch (e) {} }); }

  /* Compte connecté. null = personne : aucune écriture, aucun envoi. */
  function compte() {
    var a = global.ANAGROCI_AUTH, p = a && a.profile;
    return (p && (p.user_id || p.id)) || (a && a.user && a.user.id) || null;
  }
  function exigerCompte() { var c = compte(); if (!c) throw new Error('Aucun compte connecté sur ce téléphone : connectez-vous avant d\'enregistrer.'); return c; }
  function appareil() {
    try { var k = 'aflp_reperes_gps_appareil', v = localStorage.getItem(k); if (!v) { v = 'REP-' + C.uuid(); localStorage.setItem(k, v); } return v; }
    catch (e) { return 'REP-inconnu'; }
  }
  function cleObjet(c, type, id) { return c + ':' + type + ':' + id; }

  /* ---------- repères connus sur ce téléphone ---------- */
  function repere(type, id) { var c = compte(); return c ? lire('reperes', cleObjet(c, type, id)) : Promise.resolve(null); }
  function reperes() { var c = compte(); if (!c) return Promise.resolve([]); return tout('reperes').then(function (l) { return l.filter(function (x) { return x.compte === c; }); }); }

  /* Enregistre la saisie ET son opération dans une seule transaction durable.
     `objet` : { type, id, plot_id, panel_id, bloc_id, libelle }. */
  function enregistrer(objet, saisie, options) {
    var c;
    try { c = exigerCompte(); } catch (e) { return Promise.reject(e); }
    var cle = cleObjet(c, objet.type, objet.id);
    options = options || {};
    return lire('reperes', cle).then(function (avant) {
      /* version_base : version du serveur que l'agent avait sous les yeux. Après un conflit,
         l'agent qui maintient sa saisie repart explicitement de la version du serveur. */
      var base = options.version_base != null ? options.version_base : (avant && avant.version_no ? avant.version_no : 0);
      if (options.confirme && avant) avant = Object.assign({}, avant, { confirme: options.confirme, etat: avant.etat === 'RECU' ? 'ATTENTE' : avant.etat });
      var op = C.operation({ type: objet.type, id: objet.id }, saisie, { version_base: base, device_id: appareil(), maintenant: maintenant() });
      op.compte = c; op.etat = 'ATTENTE'; op.cree_le = op.created_at_client; op.tentatives = 0; op.message = null;
      op.libelle = objet.libelle || (C.TYPES[objet.type] + ' ' + objet.id);
      op.plot_id = objet.plot_id || null; op.panel_id = objet.panel_id || null;
      var r = {
        cle: cle, compte: c, objet_type: objet.type, objet_id: objet.id, plot_id: objet.plot_id || null,
        panel_id: objet.panel_id || null, bloc_id: objet.bloc_id || null, libelle: op.libelle,
        latitude: op.payload.latitude, longitude: op.payload.longitude, origine: op.payload.origine,
        source_externe: op.payload.source_externe, releve_le: op.payload.releve_le, precision_m: op.payload.precision_m,
        motif: op.payload.motif, hors_zone: !!op.payload.confirmer_hors_zone,
        version_no: base, statut: 'BROUILLON', etat: 'ATTENTE', op_cle: op.idempotency_key, message: null, serveur: null,
        saisi_le: op.created_at_client, maj_le: op.created_at_client,
        /* Dernière valeur confirmée par le serveur : restituée si la saisie est abandonnée. */
        confirme: avant ? (avant.etat === 'RECU' ? instantane(avant) : avant.confirme || null) : null
      };
      return tx(['reperes', 'file', 'brouillons'], 'readwrite', function (m) {
        /* Une saisie plus récente remplace celle qui n'est pas encore partie pour le même objet. */
        if (avant && avant.op_cle && (avant.etat === 'ATTENTE' || avant.etat === 'REJETE' || avant.etat === 'CONFLIT')) m.file.delete(avant.op_cle);
        m.reperes.put(r); m.file.put(op); m.brouillons.delete(cle);
      }).then(function () { emettre(); return { repere: r, operation: op }; });
    });
  }
  function instantane(x) {
    return { latitude: x.latitude, longitude: x.longitude, origine: x.origine, source_externe: x.source_externe, releve_le: x.releve_le,
      precision_m: x.precision_m, version_no: x.version_no, statut: x.statut };
  }

  /* ---------- brouillon du formulaire (rien n'est perdu si l'application se ferme) ---------- */
  function brouillon(type, id) { var c = compte(); return c ? lire('brouillons', cleObjet(c, type, id)) : Promise.resolve(null); }
  function ecrireBrouillon(type, id, champs) {
    var c = compte(); if (!c) return Promise.resolve(null);
    var b = { cle: cleObjet(c, type, id), compte: c, champs: champs, maj_le: maintenant() };
    return tx('brouillons', 'readwrite', function (m) { m.brouillons.put(b); }).then(function () { return b; });
  }
  function effacerBrouillon(type, id) { var c = compte(); if (!c) return Promise.resolve(); return tx('brouillons', 'readwrite', function (m) { m.brouillons.delete(cleObjet(c, type, id)); }); }

  /* ---------- file ---------- */
  function file() { var c = compte(); if (!c) return Promise.resolve([]); return tout('file').then(function (l) { return l.filter(function (x) { return x.compte === c; }).sort(function (a, b) { return a.cree_le < b.cree_le ? -1 : 1; }); }); }
  function compter() {
    return file().then(function (l) {
      var n = { ATTENTE: 0, ENVOI: 0, RECU: 0, CONFLIT: 0, REJETE: 0, ANNULE: 0 };
      l.forEach(function (o) { n[o.etat] = (n[o.etat] || 0) + 1; });
      n.enAttente = n.ATTENTE + n.ENVOI; n.aTraiter = n.CONFLIT + n.REJETE; return n;
    });
  }
  function majEtat(op, changements) {
    return tx(['reperes', 'file'], 'readwrite', function (m) {
      m.file.put(op);
      var cle = cleObjet(op.compte, op.payload.objet_type, op.payload.objet_id), q = m.reperes.get(cle);
      q.onsuccess = function () {
        var r = q.result; if (!r || r.op_cle !== op.idempotency_key) return;   // une saisie plus récente existe : on ne l'écrase pas
        for (var k in changements) r[k] = changements[k];
        r.maj_le = maintenant(); m.reperes.put(r);
      };
    });
  }
  /* Relance : un refus technique ou une attente repart avec la MÊME clé (aucun doublon). */
  function reessayer(cle) {
    return lire('file', cle).then(function (o) {
      if (!o || o.compte !== compte() || o.etat === 'RECU' || o.etat === 'ANNULE') return null;
      o.etat = 'ATTENTE'; o.message = null;
      return majEtat(o, { etat: 'ATTENTE', message: null }).then(function () { emettre(); return o; });
    });
  }
  /* Abandon explicite d'une saisie refusée ou en conflit : on revient à la dernière valeur
     confirmée par le serveur (ou à « position non renseignée »). L'opération reste au journal. */
  function abandonner(cle, valeurServeur) {
    return lire('file', cle).then(function (o) {
      if (!o || o.compte !== compte() || o.etat === 'RECU') return null;
      o.etat = 'ANNULE'; o.annule_le = maintenant();
      var cleR = cleObjet(o.compte, o.payload.objet_type, o.payload.objet_id);
      return tx(['reperes', 'file'], 'readwrite', function (m) {
        m.file.put(o);
        var q = m.reperes.get(cleR);
        q.onsuccess = function () {
          var r = q.result; if (!r || r.op_cle !== o.idempotency_key) return;
          var v = valeurServeur || r.confirme;
          if (!v) { m.reperes.delete(cleR); return; }
          r.latitude = Number(v.latitude); r.longitude = Number(v.longitude); r.origine = v.origine; r.source_externe = v.source_externe || null;
          r.releve_le = v.releve_le || null; r.precision_m = v.precision_m == null ? null : Number(v.precision_m);
          r.version_no = v.version_no; r.statut = v.statut || 'BROUILLON'; r.etat = 'RECU'; r.op_cle = null; r.message = null; r.serveur = null; r.motif = null;
          r.confirme = null; r.maj_le = maintenant(); m.reperes.put(r);
        };
      }).then(function () { emettre(); return o; });
    });
  }

  /* Dépendance : le repère d'un bloc ou d'un arbre attend que le champ (panel) soit lui-même
     reçu par le serveur. Tant que l'installation est en file côté Observatoire, on patiente. */
  function panelsEnAttente() {
    var O = global.ANAGROCI_OBS_LOCAL;
    if (!O || !O.panels) return Promise.resolve({});
    return O.panels().then(function (l) { var m = {}; (l || []).forEach(function (p) { if (p.local) m[p.id] = 1; }); return m; }).catch(function () { return {}; });
  }

  /* Envoi de la file du compte connecté. rpc(nom, args) -> promesse { data, error }. */
  function synchroniser(rpc) {
    if (enCours) return enCours;
    if (!compte()) return Promise.resolve({ envoyees: 0, sansCompte: true });
    if (global.navigator && global.navigator.onLine === false) return Promise.resolve({ envoyees: 0, horsLigne: true });
    var bilan = { envoyees: 0, recues: 0, refusees: 0, conflits: 0, retenues: 0, erreurReseau: null, serveurPasPret: false };
    enCours = Promise.all([file(), panelsEnAttente()]).then(function (r) {
      var att = r[0].filter(function (o) { return o.etat === 'ATTENTE' || o.etat === 'ENVOI'; });
      var pret = att.filter(function (o) { if (o.panel_id && r[1][o.panel_id]) { bilan.retenues++; return false; } return true; });
      var lots = []; for (var i = 0; i < pret.length; i += LOT) lots.push(pret.slice(i, i + LOT));
      return lots.reduce(function (pr, lot) {
        return pr.then(function () {
          if (bilan.erreurReseau) return;
          return Promise.all(lot.map(function (o) { o.etat = 'ENVOI'; o.tentatives = (o.tentatives || 0) + 1; return majEtat(o, { etat: 'ENVOI' }); })).then(function () {
            return rpc(RPC, { p_operations: lot.map(function (o) { return { idempotency_key: o.idempotency_key, type: o.type, payload: o.payload, device_id: o.device_id, created_at_client: o.created_at_client }; }) });
          }).then(function (res) {
            if (res && res.error) {
              var msg = String(res.error.message || 'Erreur serveur'), code = String(res.error.code || '');
              if (code === 'PGRST202' || /could not find the function|schema cache/i.test(msg)) { bilan.serveurPasPret = true; throw new Error('Le serveur n\'est pas encore prêt à recevoir les repères GPS. Ils restent enregistrés sur ce téléphone.'); }
              throw new Error(msg);
            }
            var rs = (res && res.data && res.data.resultats) || [], par = {};
            rs.forEach(function (x) { par[x.idempotency_key] = x; });
            return Promise.all(lot.map(function (o) {
              var x = par[o.idempotency_key];
              if (!x) { o.etat = 'ATTENTE'; return majEtat(o, { etat: 'ATTENTE' }); }   // pas d'accusé pour elle : elle reste en attente
              bilan.envoyees++;
              if (x.statut === 'ACCEPTEE') {
                o.etat = 'RECU'; o.recu_le = x.recu_serveur_le || maintenant(); o.resultat = x; o.message = null; bilan.recues++;
                return majEtat(o, { etat: 'RECU', version_no: x.version_no, recu_le: o.recu_le, message: null, serveur: null, confirme: null });
              }
              if (x.statut === 'CONFLIT') {
                o.etat = 'CONFLIT'; o.message = x.message; o.serveur = x.serveur || null; bilan.conflits++;
                return majEtat(o, { etat: 'CONFLIT', message: x.message, serveur: x.serveur || null });
              }
              o.etat = 'REJETE'; o.message = x.message || 'Refusé par le serveur.'; o.code = x.code || null; bilan.refusees++;
              return majEtat(o, { etat: 'REJETE', message: o.message });
            }));
          }).catch(function (e) {
            bilan.erreurReseau = e && e.message || 'Pas de réponse du serveur.';
            return Promise.all(lot.map(function (o) { if (o.etat === 'ENVOI') { o.etat = 'ATTENTE'; return majEtat(o, { etat: 'ATTENTE' }); } }));
          });
        });
      }, Promise.resolve());
    }).then(function () { enCours = null; emettre(); return bilan; }, function (e) { enCours = null; throw e; });
    return enCours;
  }
  /* Au démarrage : un envoi interrompu (fermeture forcée) redevient « en attente », même clé. */
  function reprendre() {
    return tout('file').then(function (l) {
      return Promise.all(l.filter(function (o) { return o.etat === 'ENVOI'; }).map(function (o) { o.etat = 'ATTENTE'; return majEtat(o, { etat: 'ATTENTE' }); }));
    }).catch(function () {});
  }

  /* ---------- repères du serveur (lecture) : fusion sans écraser une saisie locale ---------- */
  function integrerServeur(lignes) {
    var c = compte(); if (!c || !lignes || !lignes.length) return Promise.resolve(0);
    return tx('reperes', 'readwrite', function (m) {
      lignes.forEach(function (s) {
        var cle = cleObjet(c, s.objet_type, s.objet_id), q = m.reperes.get(cle);
        q.onsuccess = function () {
          var r = q.result;
          if (r && r.etat !== 'RECU') return;   // saisie locale non encore confirmée : jamais écrasée par la copie du serveur
          m.reperes.put({ cle: cle, compte: c, objet_type: s.objet_type, objet_id: s.objet_id, plot_id: s.plot_id, panel_id: s.panel_id || null, bloc_id: s.bloc_id || null,
            libelle: (r && r.libelle) || null, latitude: Number(s.latitude), longitude: Number(s.longitude), origine: s.origine, source_externe: s.source_externe || null,
            releve_le: s.releve_le || null, precision_m: s.precision_m == null ? null : Number(s.precision_m), motif: s.motif || null, hors_zone: !!s.hors_zone_attendue,
            version_no: s.version_no, statut: s.statut || 'BROUILLON', etat: 'RECU', op_cle: null, message: null, serveur: null,
            saisi_le: s.saisi_le_client || s.created_at, recu_le: s.created_at, maj_le: maintenant(), confirme: null });
        };
      });
    }).then(function () { emettre(); return lignes.length; });
  }

  /* ---------- petit cache par compte (références préparées, contours) ---------- */
  var cache = {
    lire: function (cle) { var c = compte(); return c ? lire('cache', c + ':' + cle).then(function (x) { return x ? x : null; }) : Promise.resolve(null); },
    ecrire: function (cle, valeur) { var c = compte(); if (!c) return Promise.resolve(null); return tx('cache', 'readwrite', function (m) { m.cache.put({ cle: c + ':' + cle, valeur: valeur, le: maintenant() }); }); }
  };

  global.ANAGROCI_REPERES_LOCAL = {
    DB_NAME: DB_NAME, DB_VERSION: DB_VERSION, RPC: RPC, compte: compte, appareil: appareil,
    repere: repere, reperes: reperes, enregistrer: enregistrer,
    brouillon: brouillon, ecrireBrouillon: ecrireBrouillon, effacerBrouillon: effacerBrouillon,
    file: file, compter: compter, reessayer: reessayer, abandonner: abandonner,
    synchroniser: synchroniser, reprendre: reprendre, integrerServeur: integrerServeur, cache: cache,
    surChangement: function (f) { ecouteurs.push(f); }
  };
  reprendre();
})(typeof window !== 'undefined' ? window : globalThis);
