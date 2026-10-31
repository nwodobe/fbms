/* ============================================================================
   AFLP FIELD PROOF — registre local (fieldproof/fp-store.js)
   ----------------------------------------------------------------------------
   Base IndexedDB DÉDIÉE « anagroci_fieldproof » : aucune autre base FBMS
   (Field Buying, AFLP FLEET) n'est lue ni modifiée, et RIEN n'est envoyé à
   Supabase ni à un autre serveur.
     · missions    : dossiers de mission (un par activité terrain) ;
     · medias      : registre des photos / vidéos (métadonnées + empreinte) ;
     · fichiers    : copie locale du fichier final, pour repartager ou
                     exporter une ancienne mission depuis l'application ;
     · morceaux    : segments vidéo écrits AU FIL de l'enregistrement, pour
                     préserver ce qui a été filmé en cas de stockage plein,
                     de fermeture brutale ou de panne de batterie ;
     · referentiel : villages FBMS du périmètre, préparés pour le hors-ligne.
   ========================================================================== */
(function (global) {
  'use strict';
  var C = global.FP_CORE;
  var DB_NAME = 'anagroci_fieldproof', DB_VERSION = 1, dbp = null;

  function req(r) { return new Promise(function (ok, ko) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { ko(r.error); }; }); }
  function fin(tx) { return new Promise(function (ok, ko) { tx.oncomplete = function () { ok(); }; tx.onabort = tx.onerror = function () { ko(tx.error || new Error('Transaction annulée')); }; }); }
  function ouvrir() {
    if (dbp) return dbp;
    dbp = new Promise(function (ok, ko) {
      if (!global.indexedDB) return ko(new Error('Stockage local indisponible sur ce navigateur.'));
      var r = global.indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('missions')) db.createObjectStore('missions', { keyPath: 'id' }).createIndex('agentId', 'agentId');
        if (!db.objectStoreNames.contains('medias')) db.createObjectStore('medias', { keyPath: 'id' }).createIndex('missionId', 'missionId');
        if (!db.objectStoreNames.contains('fichiers')) db.createObjectStore('fichiers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('morceaux')) db.createObjectStore('morceaux', { keyPath: ['mediaId', 'rang'] }).createIndex('mediaId', 'mediaId');
        if (!db.objectStoreNames.contains('referentiel')) db.createObjectStore('referentiel', { keyPath: 'cle' });
      };
      r.onsuccess = function () { var db = r.result; db.onversionchange = function () { db.close(); }; ok(db); };
      r.onerror = function () { dbp = null; ko(r.error || new Error('Ouverture du stockage local impossible.')); };
      r.onblocked = function () { ko(new Error('Stockage local bloqué par un autre onglet ouvert.')); };
    });
    return dbp;
  }
  function op(nom, mode, f) {
    return ouvrir().then(function (db) {
      var tx = db.transaction(nom, mode), s = tx.objectStore(nom), res = f(s);
      return Promise.all([res && res.onsuccess !== undefined ? req(res) : res, fin(tx)]).then(function (x) { return x[0]; });
    });
  }
  function lire(nom, cle) { return op(nom, 'readonly', function (s) { return s.get(cle); }); }
  function ecrire(nom, val) { return op(nom, 'readwrite', function (s) { return s.put(val); }); }
  function effacer(nom, cle) { return op(nom, 'readwrite', function (s) { return s.delete(cle); }); }
  function parIndex(nom, index, val) { return op(nom, 'readonly', function (s) { return s.index(index).getAll(val); }); }

  /* Erreur de quota reconnaissable quel que soit le navigateur. */
  function estQuota(e) {
    var n = e && (e.name || ''), m = e && (e.message || '');
    return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota|storage.*full|espace/i.test(m) || (e && e.code === 22);
  }

  /* -- Missions ------------------------------------------------------------- */
  function missions(agentId) {
    return (agentId ? parIndex('missions', 'agentId', agentId) : op('missions', 'readonly', function (s) { return s.getAll(); }))
      .then(function (l) { return l.sort(function (a, b) { return String(b.creeLe).localeCompare(String(a.creeLe)); }); });
  }
  function mission(id) { return lire('missions', id); }
  function enregistrerMission(m) { return ecrire('missions', m).then(function () { return m; }); }

  /* -- Médias ---------------------------------------------------------------- */
  function medias(missionId) {
    return parIndex('medias', 'missionId', missionId).then(function (l) { return l.sort(function (a, b) { return String(a.debut).localeCompare(String(b.debut)); }); });
  }
  function media(id) { return lire('medias', id); }
  function enregistrerMedia(m) { return ecrire('medias', m).then(function () { return m; }); }

  /* -- Fichiers : écriture CONTRÔLÉE ----------------------------------------
     Le fichier n'est déclaré « conservé » qu'après relecture : même taille et
     même empreinte que le fichier produit. */
  function deposerFichier(id, blob, sha256Attendu) {
    return ecrire('fichiers', { id: id, blob: blob, taille: blob.size, depose: new Date().toISOString() })
      .then(function () { return lire('fichiers', id); })
      .then(function (r) {
        if (!r || !r.blob || r.blob.size !== blob.size) throw new Error('Relecture du fichier local en échec (taille différente).');
        if (!sha256Attendu) return { verifie: true, taille: r.blob.size };
        return empreinte(r.blob).then(function (h) {
          if (h !== sha256Attendu) throw new Error('Relecture du fichier local en échec (empreinte différente).');
          return { verifie: true, taille: r.blob.size };
        });
      });
  }
  function fichier(id) { return lire('fichiers', id).then(function (r) { return r ? r.blob : null; }); }

  /* -- Morceaux vidéo -------------------------------------------------------- */
  function ajouterMorceau(mediaId, rang, blob) { return ecrire('morceaux', { mediaId: mediaId, rang: rang, blob: blob, taille: blob.size }); }
  function morceaux(mediaId) { return parIndex('morceaux', 'mediaId', mediaId).then(function (l) { return l.sort(function (a, b) { return a.rang - b.rang; }); }); }
  function effacerMorceaux(mediaId) {
    return ouvrir().then(function (db) {
      var tx = db.transaction('morceaux', 'readwrite'), s = tx.objectStore('morceaux');
      s.index('mediaId').openKeyCursor(IDBKeyRange.only(mediaId)).onsuccess = function (ev) {
        var c = ev.target.result; if (c) { s.delete(c.primaryKey); c.continue(); }
      };
      return fin(tx);
    });
  }
  /* Enregistrements interrompus (fermeture, batterie, plantage) : morceaux
     sans fichier final. Ils sont proposés à la récupération, jamais effacés
     en silence. */
  function morceauxOrphelins() {
    return op('morceaux', 'readonly', function (s) { return s.getAll(); }).then(function (l) {
      var parMedia = {};
      l.forEach(function (m) { (parMedia[m.mediaId] = parMedia[m.mediaId] || { mediaId: m.mediaId, nb: 0, taille: 0 }); parMedia[m.mediaId].nb++; parMedia[m.mediaId].taille += m.taille; });
      return Object.keys(parMedia).map(function (k) { return parMedia[k]; });
    });
  }

  /* -- Référentiel ---------------------------------------------------------- */
  function refEcrire(cle, valeur) { return ecrire('referentiel', { cle: cle, valeur: valeur, maj: new Date().toISOString() }); }
  function refLire(cle) { return lire('referentiel', cle); }

  /* -- Suppression (toujours à l'initiative de l'agent) --------------------- */
  function supprimerMedia(id) {
    return Promise.all([effacer('medias', id), effacer('fichiers', id), effacerMorceaux(id)]);
  }
  function supprimerCopieLocale(id) { return effacer('fichiers', id); }
  function supprimerMission(id) {
    return medias(id).then(function (l) { return Promise.all(l.map(function (m) { return supprimerMedia(m.id); })); })
      .then(function () { return effacer('missions', id); });
  }

  /* -- Empreinte SHA-256 d'un Blob ------------------------------------------
     < 48 Mo : crypto.subtle (natif, rapide). Au-delà : lecture par tranches
     de 4 Mo et calcul incrémental, pour ne jamais charger une longue vidéo
     entière en mémoire sur un téléphone d'entrée de gamme. */
  var TRANCHE = 4 * 1048576, SEUIL_NATIF = 48 * 1048576;
  function lireTranche(blob, debut, finT) {
    var b = blob.slice(debut, finT);
    if (b.arrayBuffer) return b.arrayBuffer();
    return new Promise(function (ok, ko) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { ko(r.error); }; r.readAsArrayBuffer(b); });
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function empreinte(blob, progres) {
    if (blob.size <= SEUIL_NATIF && global.crypto && global.crypto.subtle) {
      return lireTranche(blob, 0, blob.size).then(function (b) { return global.crypto.subtle.digest('SHA-256', b); }).then(hex);
    }
    var h = new C.Sha256(), pos = 0;
    function suite() {
      if (pos >= blob.size) return Promise.resolve(h.hex());
      var f = Math.min(blob.size, pos + TRANCHE);
      return lireTranche(blob, pos, f).then(function (b) { h.update(new Uint8Array(b)); pos = f; if (progres) progres(pos / blob.size); return suite(); });
    }
    return suite();
  }
  function crcBlob(blob) {
    var c = 0, pos = 0;
    function suite() {
      if (pos >= blob.size) return Promise.resolve(c);
      var f = Math.min(blob.size, pos + TRANCHE);
      return lireTranche(blob, pos, f).then(function (b) { c = C.crc32(new Uint8Array(b), c); pos = f; return suite(); });
    }
    return suite();
  }

  /* -- Espace de stockage -------------------------------------------------- */
  function espace() {
    var n = global.navigator;
    if (!n || !n.storage || !n.storage.estimate) return Promise.resolve(null);
    return n.storage.estimate().then(function (e) { return { utilise: e.usage || 0, quota: e.quota || 0, libre: Math.max(0, (e.quota || 0) - (e.usage || 0)) }; }).catch(function () { return null; });
  }
  function persister() {
    var n = global.navigator;
    if (!n || !n.storage || !n.storage.persist) return Promise.resolve(null);
    return n.storage.persisted().then(function (deja) { return deja ? true : n.storage.persist(); }).catch(function () { return null; });
  }

  global.FP_STORE = {
    ouvrir: ouvrir, estQuota: estQuota,
    missions: missions, mission: mission, enregistrerMission: enregistrerMission,
    medias: medias, media: media, enregistrerMedia: enregistrerMedia,
    deposerFichier: deposerFichier, fichier: fichier,
    ajouterMorceau: ajouterMorceau, morceaux: morceaux, effacerMorceaux: effacerMorceaux, morceauxOrphelins: morceauxOrphelins,
    refEcrire: refEcrire, refLire: refLire,
    supprimerMedia: supprimerMedia, supprimerCopieLocale: supprimerCopieLocale, supprimerMission: supprimerMission,
    empreinte: empreinte, crcBlob: crcBlob, lireTranche: lireTranche, espace: espace, persister: persister
  };
})(window);
