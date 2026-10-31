/* ============================================================================
   AFLP MOTO MANAGER — file hors connexion (moto/moto-offline.js)
   ----------------------------------------------------------------------------
   Base IndexedDB DÉDIÉE (anagroci_moto_offline) : la file Field Buying
   existante (shared/offline-field.js) n'est ni lue ni modifiée.
     · operations : file persistante, une opération = un client_op_id unique ;
     · fichiers   : photos de justificatifs en attente d'envoi (supprimées dès
                    la synchronisation confirmée) ;
     · cache      : dernier état serveur connu, pour consulter sans réseau.
   Le serveur reste l'autorité : une opération n'est validée qu'à réception
   du statut SYNCHRONISE renvoyé par public.moto_sync_batch.
   ========================================================================== */
(function (global) {
  'use strict';
  var CORE = global.MOTO_CORE;
  var DB_NAME = 'anagroci_moto_offline', DB_VERSION = 1;
  var dbp = null, syncEnCours = null, abonnes = [];

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    var b = new Uint8Array(16); global.crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function req(r) { return new Promise(function (ok, ko) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { ko(r.error); }; }); }
  function ouvrir() {
    if (dbp) return dbp;
    dbp = new Promise(function (ok, ko) {
      if (!global.indexedDB) return ko(new Error('Stockage local indisponible sur cet appareil : le mode hors connexion est inactif.'));
      var r = global.indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('operations')) db.createObjectStore('operations', { keyPath: 'client_op_id' }).createIndex('statut', 'statut');
        if (!db.objectStoreNames.contains('fichiers')) db.createObjectStore('fichiers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'cle' });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { ko(r.error || new Error('Ouverture du stockage local impossible.')); };
    });
    return dbp;
  }
  function store(nom, mode) { return ouvrir().then(function (db) { return db.transaction(nom, mode).objectStore(nom); }); }
  function lire(nom, cle) { return store(nom, 'readonly').then(function (s) { return req(s.get(cle)); }); }
  function tout(nom) { return store(nom, 'readonly').then(function (s) { return req(s.getAll()); }); }
  function ecrire(nom, val) { return store(nom, 'readwrite').then(function (s) { return req(s.put(val)); }); }
  function effacer(nom, cle) { return store(nom, 'readwrite').then(function (s) { return req(s.delete(cle)); }); }

  function utilisateur() { var a = global.ANAGROCI_AUTH; return a && a.profile ? a.profile.user_id : null; }
  function notifier() { lister().then(function (ops) { var r = CORE.resumeFile(ops); abonnes.forEach(function (f) { try { f(r, ops); } catch (e) {} }); }); }

  function lister() {
    var u = utilisateur();
    return tout('operations').then(function (ops) {
      return ops.filter(function (o) { return !u || o.user_id === u; }).sort(function (a, b) { return String(b.cree_le).localeCompare(String(a.cree_le)); });
    });
  }

  /* Met une opération en file. `fichiers` : [{ champ, blob, moto_id, categorie, extension }]. */
  function ajouter(type, payload, opts) {
    opts = opts || {};
    if (CORE.TYPES_HORS_LIGNE.indexOf(type) < 0) return Promise.reject(new Error('Cette opération exige une connexion : elle ne peut pas être mise en file.'));
    var u = utilisateur();
    if (!u) return Promise.reject(new Error('Session absente : reconnectez-vous.'));
    var op = { client_op_id: uuid(), type: type, payload: payload || {}, user_id: u, libelle: opts.libelle || type, moto_id: payload.moto_id || null,
               statut: 'EN_ATTENTE', tentatives: 0, cree_le: new Date().toISOString(), fichiers: [], message: null };
    var jobs = (opts.fichiers || []).map(function (f) {
      var id = op.client_op_id + ':' + f.champ;
      op.fichiers.push({ id: id, champ: f.champ, moto_id: f.moto_id, categorie: f.categorie, extension: f.extension || 'jpg', type_mime: f.blob.type || 'image/jpeg',
                         liste: f.liste || null, categorie_photo: f.categorie_photo || null });
      return ecrire('fichiers', { id: id, blob: f.blob });
    });
    return estimerEspace().then(function (e) {
      if (e && e.quota && e.usage / e.quota > 0.95) throw new Error('Stockage local presque plein : synchronisez avant toute nouvelle saisie.');
      return Promise.all(jobs);
    }).then(function () { return ecrire('operations', op); }).then(function () {
      if (CORE.exigeImmobilisation(op)) return marquerImmobilisationLocale(op.moto_id, op);
    }).then(function () { notifier(); return op; });
  }
  function estimerEspace() {
    try { return global.navigator && navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }

  /* -- Immobilisation locale : appliquée immédiatement sur l'appareil ------ */
  function marquerImmobilisationLocale(motoId, op) {
    if (!motoId) return Promise.resolve();
    return ecrire('cache', { cle: 'immobilisation:' + motoId, valeur: { depuis: new Date().toISOString(), client_op_id: op.client_op_id, libelle: op.libelle } });
  }
  function immobilisationLocale(motoId) { return lire('cache', 'immobilisation:' + motoId).then(function (x) { return x ? x.valeur : null; }); }
  /* Levée locale uniquement quand le serveur a reçu l'opération ET indique
     que la moto n'est plus immobilisée (remise en service par le circuit). */
  function reconcilierImmobilisation(moto) {
    if (!moto) return Promise.resolve();
    return immobilisationLocale(moto.id).then(function (im) {
      if (!im) return;
      return lire('operations', im.client_op_id).then(function (op) {
        var recu = op && op.statut === 'SYNCHRONISE';
        if (recu && ['IMMOBILISEE', 'EN_REPARATION'].indexOf(moto.statut_technique) < 0) return effacer('cache', 'immobilisation:' + moto.id);
      });
    });
  }

  /* -- Cache de lecture (dernier état serveur) ---------------------------- */
  function memoriser(cle, valeur) { var u = utilisateur(); return ecrire('cache', { cle: (u || 'x') + ':' + cle, valeur: valeur, le: new Date().toISOString() }); }
  function relire(cle) { var u = utilisateur(); return lire('cache', (u || 'x') + ':' + cle).then(function (x) { return x || null; }); }

  /* -- Synchronisation ----------------------------------------------------- */
  function televerser(sb, op) {
    var jobs = (op.fichiers || []).filter(function (f) { return !op.payload[f.champ]; }).map(function (f) {
      var chemin = f.moto_id + '/' + f.categorie + '/' + op.client_op_id + '-' + f.champ + '.' + f.extension;
      return lire('fichiers', f.id).then(function (x) {
        if (!x) throw new Error('Justificatif local introuvable : opération à ressaisir.');
        return sb.storage.from('moto-documents').upload(chemin, x.blob, { upsert: false, contentType: f.type_mime });
      }).then(function (r) {
        // Chemin déterministe : un fichier déjà envoyé lors d'une tentative interrompue n'est pas dupliqué.
        if (r && r.error && !/exist|duplicate|409/i.test(String(r.error.message || r.error.statusCode || ''))) throw r.error;
        op.payload[f.champ] = chemin;
        // Photos multiples (inspections) : ajoutées à la liste attendue par le serveur, rattachées à LA moto de l'opération.
        if (f.liste) {
          var l = op.payload[f.liste] || (op.payload[f.liste] = []);
          if (!l.some(function (x) { return x.path === chemin; })) l.push({ path: chemin, categorie: f.categorie_photo || 'AUTRE' });
        }
      });
    });
    return Promise.all(jobs).then(function () { return ecrire('operations', op); });
  }

  function synchroniser(sb) {
    if (syncEnCours) return syncEnCours;
    if (!sb) return Promise.resolve({ envoyees: 0 });
    if (global.navigator && navigator.onLine === false) return Promise.resolve({ envoyees: 0, horsLigne: true });
    syncEnCours = lister().then(function (ops) {
      var lot = CORE.operationsEligibles(ops, Date.now(), 20);
      if (!lot.length) return { envoyees: 0 };
      var prets = [];
      return lot.reduce(function (p, op) {
        return p.then(function () {
          return televerser(sb, op).then(function () { prets.push(op); }, function (err) {
            return ecrire('operations', CORE.appliquerResultat(op, { statut: 'ERREUR_TEMPORAIRE', message: 'Envoi du justificatif : ' + (err && err.message || err) }));
          });
        });
      }, Promise.resolve()).then(function () {
        if (!prets.length) return { envoyees: 0 };
        return Promise.resolve().then(function () {
          return sb.rpc('moto_sync_batch', { p_operations: prets.map(function (o) { return { client_op_id: o.client_op_id, type: o.type, payload: o.payload }; }) });
        }).then(function (r) {
            if (r.error) throw r.error;
            var parId = {}; (r.data || []).forEach(function (x) { parId[x.client_op_id] = x; });
            return Promise.all(prets.map(function (op) {
              var res = parId[op.client_op_id] || { statut: 'ERREUR_TEMPORAIRE', message: 'Aucune réponse du serveur pour cette opération.' };
              var maj = CORE.appliquerResultat(op, res);
              return ecrire('operations', maj).then(function () {
                if (maj.statut === 'SYNCHRONISE') return Promise.all((op.fichiers || []).map(function (f) { return effacer('fichiers', f.id); }));
              });
            })).then(function () { return { envoyees: prets.length }; });
          }).catch(function (err) {
            /* Réseau coupé ou réponse perdue : rien n'est réputé fait ; l'opération reste
               en file avec le même client_op_id, le renvoi sera reconnu comme doublon. */
            return Promise.all(prets.map(function (op) {
              return ecrire('operations', CORE.appliquerResultat(op, { statut: 'ERREUR_TEMPORAIRE', message: err && err.message }));
            })).then(function () { return { envoyees: 0, erreur: err && err.message }; });
          });
      });
    }).catch(function (err) { return { envoyees: 0, erreur: err && err.message || String(err) }; })
      .finally(function () { syncEnCours = null; notifier(); });
    return syncEnCours;
  }

  function relancer(clientOpId) {
    return lire('operations', clientOpId).then(function (op) {
      if (!op || op.statut !== 'BLOQUE') return;
      op.statut = 'EN_ATTENTE'; op.tentatives = 0; op.prochaine_tentative = null; op.message = 'Relance manuelle.';
      return ecrire('operations', op);
    }).then(notifier);
  }
  /* Retirer de l'appareil une opération rejetée ou synchronisée (jamais une opération en attente). */
  function retirer(clientOpId) {
    return lire('operations', clientOpId).then(function (op) {
      if (!op) return;
      if (op.statut === 'EN_ATTENTE') throw new Error('Une opération en attente ne peut pas être retirée : elle doit d\'abord être synchronisée.');
      return Promise.all((op.fichiers || []).map(function (f) { return effacer('fichiers', f.id); })).then(function () { return effacer('operations', clientOpId); });
    }).then(notifier);
  }
  function abonner(f) { abonnes.push(f); notifier(); }

  global.MOTO_OFFLINE = {
    ajouter: ajouter, lister: lister, synchroniser: synchroniser, relancer: relancer, retirer: retirer, abonner: abonner,
    immobilisationLocale: immobilisationLocale, reconcilierImmobilisation: reconcilierImmobilisation, memoriser: memoriser, relire: relire, uuid: uuid,
    /* Utilisé par auth-gate.js à la déconnexion (même contrat que ANAGROCI_OFFLINE.summary). */
    resume: function () { return lister().then(CORE.resumeFile); }
  };
})(typeof window !== 'undefined' ? window : this);
