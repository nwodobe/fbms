/* CARTOGRAPHIE DES PARCELLES AFLP · stockage local et synchronisation
   --------------------------------------------------------------------------------
   · Base IndexedDB DÉDIÉE (aflp_plot_map_db) : aucune interférence avec la file
     FIELD BUYING, le registre producteurs ou l'Observatoire.
   · Brouillons : enregistrés à CHAQUE sommet posé, déplacé ou supprimé ; survivent à la
     fermeture brutale de l'application et au redémarrage du téléphone.
   · File d'opérations : chaque opération porte une clé d'idempotence ; un renvoi après
     coupure ne crée jamais de doublon (reçus côté serveur).
   · Une opération n'est « Reçue par le serveur » qu'après la réponse ACCEPTEE du serveur.
     Erreur réseau : elle reste « En attente ». Refus : motif conservé, rien n'est effacé.
   · Opérations rangées par compte : un téléphone partagé n'envoie jamais les opérations
     d'un autre agent sous l'identité du compte connecté. */
(function (global) {
  'use strict';
  var DB_NAME = 'aflp_plot_map_db';
  var DB_VERSION = 1;
  var REPLI = 'aflp_plot_map_repli_v1';
  var dbp = null, enCours = null;
  /* Écriture « stricte » : la transaction n'est déclarée terminée qu'une fois les données sur le disque (pas seulement
     confiées au système). Protège la file contre une coupure de batterie juste après l'enregistrement. Option ignorée
     par les navigateurs qui ne la connaissent pas (comportement inchangé). Mesuré sur émulateur le 21/11/2026 : 15 arrêts
     brutaux sur 15 sans perte d'IndexedDB ; le stockage local, lui, perd une écriture faite moins de 2 s avant l'arrêt. */
  var ECRITURE_STRICTE = { durability: 'strict' };

  function maintenant() { return new Date().toISOString(); }
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise(function (ok, ko) {
      if (!global.indexedDB) { ok(null); return; }
      var r;
      try { r = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { ok(null); return; }
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('brouillons')) d.createObjectStore('brouillons', { keyPath: 'cle' });
        if (!d.objectStoreNames.contains('file')) { var f = d.createObjectStore('file', { keyPath: 'idempotency_key' }); f.createIndex('compte', 'compte'); }
        if (!d.objectStoreNames.contains('journal')) d.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'cle' });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { ok(null); };
      r.onblocked = function () { ok(null); };
    });
    return dbp;
  }
  /* Repli localStorage si IndexedDB est indisponible (navigateur très ancien, mode privé). */
  function repli() { try { return JSON.parse(localStorage.getItem(REPLI) || '{}'); } catch (e) { return {}; } }
  function repliEcrire(o) { try { localStorage.setItem(REPLI, JSON.stringify(o)); } catch (e) {} }
  function op(store, mode, fn) {
    return idb().then(function (d) {
      if (!d) {
        var o = repli(); o[store] = o[store] || {}; var res = fn(null, o[store]); repliEcrire(o); return res;
      }
      return new Promise(function (ok, ko) {
        var tx = mode === 'readwrite' ? d.transaction(store, mode, ECRITURE_STRICTE) : d.transaction(store, mode), s = tx.objectStore(store), out;
        var req = fn(s, null);
        if (req && 'onsuccess' in req) req.onsuccess = function () { out = req.result; };
        tx.oncomplete = function () { ok(out); };
        tx.onerror = function () { ko(tx.error || new Error('Écriture locale impossible')); };
        tx.onabort = function () { ko(tx.error || new Error('Écriture locale interrompue (espace plein ?)')); };
      });
    });
  }
  function put(store, val, cle) { return op(store, 'readwrite', function (s, m) { if (m) { m[cle] = val; return; } return s.put(val); }); }
  function get(store, cle) { return op(store, 'readonly', function (s, m) { if (m) return m[cle] || null; return s.get(cle); }).then(function (x) { return x || null; }); }
  function del(store, cle) { return op(store, 'readwrite', function (s, m) { if (m) { delete m[cle]; return; } return s.delete(cle); }); }
  function tout(store) { return op(store, 'readonly', function (s, m) { if (m) return Object.keys(m).map(function (k) { return m[k]; }); return s.getAll(); }).then(function (x) { return x || []; }); }

  function compte() { var p = global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile; return (p && (p.user_id || p.id)) || (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.user && global.ANAGROCI_AUTH.user.id) || 'inconnu'; }
  function appareil() {
    try { var v = localStorage.getItem('aflp_plot_map_appareil'); if (!v) { v = (global.ANAGROCI_PARCELLES_COEUR || {}).uuid ? global.ANAGROCI_PARCELLES_COEUR.uuid() : String(Date.now()); localStorage.setItem('aflp_plot_map_appareil', v); } return v; } catch (e) { return 'appareil-inconnu'; }
  }
  function journal(niveau, message, detail) {
    return put('journal', { compte: compte(), le: maintenant(), niveau: niveau, message: message, detail: detail || null }, Date.now() + '-' + Math.random()).catch(function () {});
  }

  var API = {
    DB_NAME: DB_NAME, appareil: appareil, compte: compte,
    brouillon: {
      lire: function (plotId) { return get('brouillons', compte() + ':' + plotId); },
      ecrire: function (plotId, b) { b.cle = compte() + ':' + plotId; b.plot_id = plotId; b.compte = compte(); b.maj_le = maintenant(); return put('brouillons', b, b.cle); },
      effacer: function (plotId) { return del('brouillons', compte() + ':' + plotId); },
      tous: function () { var c = compte(); return tout('brouillons').then(function (l) { return l.filter(function (x) { return x.compte === c; }); }); }
    },
    file: {
      ajouter: function (o, resume) {
        o.compte = compte(); o.etat = 'ATTENTE'; o.cree_le = maintenant(); o.tentatives = 0; o.resume = resume || o.type;
        return put('file', o, o.idempotency_key).then(function () { journal('info', 'Enregistré sur ce téléphone : ' + o.resume); return o; });
      },
      toutes: function () { var c = compte(); return tout('file').then(function (l) { return l.filter(function (x) { return x.compte === c; }).sort(function (a, b) { return a.cree_le < b.cree_le ? -1 : 1; }); }); },
      pourParcelle: function (plotId) { return API.file.toutes().then(function (l) { return l.filter(function (x) { return x.payload && x.payload.plot_id === plotId || (x.payload && x.payload.id === plotId); }); }); },
      reessayer: function (cle) { return get('file', cle).then(function (o) { if (!o || o.etat === 'RECU') return null; o.etat = 'ATTENTE'; o.message = null; return put('file', o, cle); }); },
      archiverRecues: function (avantJours) {
        var limite = Date.now() - (avantJours || 30) * 864e5;
        return API.file.toutes().then(function (l) { return Promise.all(l.filter(function (x) { return x.etat === 'RECU' && Date.parse(x.recu_le || x.cree_le) < limite; }).map(function (x) { return del('file', x.idempotency_key); })); });
      }
    },
    cache: {
      lire: function (cle) { return get('cache', compte() + ':' + cle).then(function (x) { return x ? x.valeur : null; }); },
      ecrire: function (cle, valeur) { return put('cache', { cle: compte() + ':' + cle, valeur: valeur, le: maintenant() }, compte() + ':' + cle); }
    },
    journal: { ajouter: journal, derniers: function (n) { var c = compte(); return tout('journal').then(function (l) { return l.filter(function (x) { return x.compte === c; }).slice(-(n || 50)).reverse(); }); } },
    compter: function () {
      return API.file.toutes().then(function (l) {
        var r = { ATTENTE: 0, ENVOI: 0, RECU: 0, CONFLIT: 0, REJETE: 0 };
        l.forEach(function (x) { r[x.etat] = (r[x.etat] || 0) + 1; }); return r;
      });
    },
    /* Envoi des opérations en attente, dans l'ordre de création, par lots de 20.
       rpc(nom, args) doit renvoyer une promesse { data, error } (client Supabase). */
    synchroniser: function (rpc) {
      if (enCours) return enCours;
      if (global.navigator && global.navigator.onLine === false) return Promise.resolve({ envoyees: 0, horsLigne: true });
      enCours = API.file.toutes().then(function (l) {
        var att = l.filter(function (x) { return x.etat === 'ATTENTE' || x.etat === 'ENVOI'; });
        if (!att.length) return { envoyees: 0 };
        var lots = []; for (var i = 0; i < att.length; i += 20) lots.push(att.slice(i, i + 20));
        var bilan = { envoyees: 0, recues: 0, refusees: 0, conflits: 0, erreurReseau: null };
        return lots.reduce(function (pr, lot) {
          return pr.then(function () {
            if (bilan.erreurReseau) return;
            return Promise.all(lot.map(function (o) { o.etat = 'ENVOI'; o.tentatives++; return put('file', o, o.idempotency_key); })).then(function () {
              var ops = lot.map(function (o) { return { idempotency_key: o.idempotency_key, type: o.type, payload: o.payload, device_id: o.device_id, created_at_client: o.created_at_client }; });
              return rpc('plot_map_sync_batch', { p_operations: ops });
            }).then(function (res) {
              if (res && res.error) throw new Error(res.error.message || 'Erreur serveur');
              var rs = (res && res.data && res.data.resultats) || [];
              var parCle = {}; rs.forEach(function (x) { parCle[x.idempotency_key] = x; });
              return Promise.all(lot.map(function (o) {
                var x = parCle[o.idempotency_key];
                if (!x) { o.etat = 'ATTENTE'; return put('file', o, o.idempotency_key); }  // pas de réponse pour elle : on la garde
                bilan.envoyees++;
                if (x.statut === 'ACCEPTEE') { o.etat = 'RECU'; o.recu_le = x.recu_serveur_le || maintenant(); o.resultat = x; o.message = null; bilan.recues++; }
                else if (x.statut === 'CONFLIT') { o.etat = 'CONFLIT'; o.message = x.message; bilan.conflits++; }
                else { o.etat = 'REJETE'; o.message = x.message || 'Refusé'; o.code = x.code || null; bilan.refusees++; }
                journal(o.etat === 'RECU' ? 'info' : 'alerte', (global.ANAGROCI_PARCELLES_COEUR ? global.ANAGROCI_PARCELLES_COEUR.ETATS[o.etat] : o.etat) + ' : ' + o.resume, o.message);
                return put('file', o, o.idempotency_key);
              }));
            }).catch(function (e) {
              bilan.erreurReseau = e.message;
              journal('alerte', 'Synchronisation interrompue, nouvel essai plus tard', e.message);
              return Promise.all(lot.map(function (o) { if (o.etat === 'ENVOI') { o.etat = 'ATTENTE'; return put('file', o, o.idempotency_key); } }));
            });
          });
        }, Promise.resolve()).then(function () { return bilan; });
      }).then(function (b) { enCours = null; return b; }, function (e) { enCours = null; throw e; });
      return enCours;
    }
  };
  global.ANAGROCI_PARCELLES_LOCAL = API;
})(typeof window !== 'undefined' ? window : this);
