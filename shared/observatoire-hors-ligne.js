/* OBSERVATOIRE AGRONOMIQUE AFLP 2027 (pilote) — stockage local et synchronisation.
   --------------------------------------------------------------------------------
   Base IndexedDB DÉDIÉE (anagroci_observatoire) : la file hors ligne de FIELD BUYING
   (anagroci_ops_offline / offline_sync_batch) n'est ni lue ni modifiée.
   Règles :
     · tout est d'abord enregistré sur l'appareil, puis placé dans une file d'envoi ;
     · chaque opération porte une clé d'idempotence créée sur l'appareil : la renvoyer
       ne crée jamais de doublon ;
     · une opération n'est dite « reçue » que lorsque le SERVEUR a répondu avec son
       accusé (date de réception). Être en ligne ne suffit jamais ;
     · envoi dans l'ordre de création ; une coupure réseau arrête l'envoi et tout
       sera réessayé (même clé) ;
     · un refus ou un conflit est affiché tel quel, jamais masqué.
   Dépend de window.ANAGROCI_OBS_COEUR. Expose window.ANAGROCI_OBS_LOCAL. */
(function (global) {
  'use strict';
  var C = global.ANAGROCI_OBS_COEUR;
  var NOM = 'anagroci_observatoire', VERSION = 1, LOT = 20, BUCKET = 'pheno-preuves';
  var dbPromise = null, enCours = null, ecouteurs = [];

  function ouvrir() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (ok, ko) {
      if (!global.indexedDB) { ko(new Error('Stockage local indisponible sur cet appareil.')); return; }
      var r = indexedDB.open(NOM, VERSION);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('ref')) db.createObjectStore('ref');
        if (!db.objectStoreNames.contains('panels')) db.createObjectStore('panels', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('visites')) db.createObjectStore('visites', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('file')) db.createObjectStore('file', { keyPath: 'idempotency_key' });
        if (!db.objectStoreNames.contains('fichiers')) db.createObjectStore('fichiers', { keyPath: 'chemin' });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { ko(r.error || new Error('Ouverture du stockage local impossible.')); };
    });
    return dbPromise;
  }
  function tx(magasin, mode, fn) {
    return ouvrir().then(function (db) {
      return new Promise(function (ok, ko) {
        var t = db.transaction(magasin, mode), res = fn(t.objectStore(magasin));
        t.oncomplete = function () { ok(res && 'result' in res ? res.result : res); };
        t.onerror = t.onabort = function () { ko(t.error || new Error('Écriture locale impossible.')); };
      });
    });
  }
  function lire(magasin, cle) { return tx(magasin, 'readonly', function (s) { return s.get(cle); }); }
  function tout(magasin) { return tx(magasin, 'readonly', function (s) { return s.getAll(); }).then(function (x) { return x || []; }); }
  function ecrire(magasin, valeur, cle) { return tx(magasin, 'readwrite', function (s) { return cle === undefined ? s.put(valeur) : s.put(valeur, cle); }).then(function () { return valeur; }); }
  function emettre() { ecouteurs.forEach(function (f) { try { f(); } catch (e) {} }); }

  function utilisateur() { var a = global.ANAGROCI_AUTH; return a && a.profile ? (a.profile.user_id || a.profile.id || null) : null; }
  /* Identifiant d'appareil propre à l'Observatoire, synchrone, conservé sur l'appareil. */
  var appareilMemoire = null;
  function appareil() {
    if (appareilMemoire) return appareilMemoire;
    try { var k = 'anagroci_obs_appareil', v = localStorage.getItem(k); if (!v) { v = 'OBS-' + C.uuid(); localStorage.setItem(k, v); } appareilMemoire = v; }
    catch (e) { appareilMemoire = 'OBS-' + C.uuid(); }
    return appareilMemoire;
  }

  /* ---------- file d'envoi ---------- */
  function mettreEnFile(type, payload, info) {
    var op = { idempotency_key: C.uuid(), type: type, payload: payload, device_id: appareil(), user_id: utilisateur(),
      created_at_client: new Date().toISOString(), statut: 'EN_ATTENTE', essais: 0, dernier_message: null, recu_serveur_le: null,
      entite: (info && info.entite) || null, entite_id: (info && info.entite_id) || null, libelle: (info && info.libelle) || type };
    return ecrire('file', op).then(function () { emettre(); return op; });
  }
  function file() { return tout('file').then(function (l) { return l.sort(function (a, b) { return a.created_at_client < b.created_at_client ? -1 : 1; }); }); }
  function enAttente() {
    var u = utilisateur();
    return file().then(function (l) { return l.filter(function (o) { return (o.statut === 'EN_ATTENTE' || o.statut === 'ECHEC_RESEAU' || o.statut === 'ENVOI') && (!u || !o.user_id || o.user_id === u); }); });
  }
  function aDesEnvoisPour(entiteId) { return enAttente().then(function (l) { return l.some(function (o) { return o.entite_id === entiteId; }); }); }

  function appliquerResultat(op, r) {
    op.essais += 1; op.dernier_message = r.message || null; op.recu_serveur_le = r.recu_serveur_le || null; op.reponse = r;
    op.statut = r.statut === 'ACCEPTEE' ? 'RECU' : r.statut === 'CONFLIT' ? 'CONFLIT' : 'REJETE';
    var suite = ecrire('file', op);
    if (op.entite === 'VISITE' && op.entite_id) {
      suite = suite.then(function () { return lire('visites', op.entite_id); }).then(function (v) {
        if (!v) return;
        if (r.statut === 'ACCEPTEE') { v.statut_serveur = r.statut_visite || v.statut_serveur; v.row_version = r.row_version == null ? v.row_version : r.row_version; v.recu_serveur_le = r.recu_serveur_le; v.etat_envoi = 'RECU'; v.dernier_message = null; }
        else { v.etat_envoi = op.statut; v.dernier_message = r.message || null; }
        return ecrire('visites', v);
      });
    }
    if (op.entite === 'PANEL' && op.entite_id) {
      suite = suite.then(function () { return lire('panels', op.entite_id); }).then(function (p) {
        if (!p) return;
        if (r.statut === 'ACCEPTEE') { p.local = false; p.recu_serveur_le = r.recu_serveur_le; if (r.statut_panel) p.statut = r.statut_panel; p.dernier_message = null; }
        else { p.dernier_message = r.message || null; p.etat_envoi = op.statut; }
        return ecrire('panels', p);
      });
    }
    return suite;
  }

  function envoyerFichiers(sb) {
    return tout('fichiers').then(function (l) {
      return l.filter(function (f) { return f.statut !== 'RECU'; }).reduce(function (p, f) {
        return p.then(function () {
          return sb.storage.from(BUCKET).upload(f.chemin, f.blob, { upsert: false, contentType: f.type || 'image/jpeg' }).then(function (x) {
            if (x.error && !/exist|duplicate|409/i.test(String(x.error.message || x.error.statusCode || ''))) { f.statut = 'ECHEC'; f.dernier_message = x.error.message; }
            else { f.statut = 'RECU'; f.recu_le = new Date().toISOString(); f.blob = null; }
            return ecrire('fichiers', f);
          }).catch(function (e) { f.statut = 'ECHEC'; f.dernier_message = e.message; return ecrire('fichiers', f); });
        });
      }, Promise.resolve());
    });
  }

  /* Envoi de la file. Résout { envoyees, recues, conflits, refusees, reseau }. */
  function synchroniser(sb) {
    if (enCours) return enCours;
    var bilan = { envoyees: 0, recues: 0, conflits: 0, refusees: 0, reseau: false };
    enCours = enAttente().then(function boucle(l) {
      if (!l.length || !sb) return bilan;
      var lot = l.slice(0, LOT), reste = l.slice(LOT);
      return Promise.all(lot.map(function (o) { o.statut = 'ENVOI'; return ecrire('file', o); })).then(function () {
        emettre();
        return sb.rpc('pheno_sync_batch', { p_operations: lot.map(function (o) {
          return { idempotency_key: o.idempotency_key, type: o.type, payload: o.payload, device_id: o.device_id, created_at_client: o.created_at_client }; }) });
      }).then(function (x) {
        if (x.error) {
          /* Erreur du serveur sur le lot entier (droit, lot invalide) ou coupure réseau. */
          var reseau = !x.status || x.status === 0 || /fetch|network|réseau|timeout/i.test(String(x.error.message || ''));
          bilan.reseau = reseau;
          return Promise.all(lot.map(function (o) { o.statut = reseau ? 'ECHEC_RESEAU' : 'REJETE'; o.essais += 1; o.dernier_message = reseau ? 'Pas de réponse du serveur.' : x.error.message; return ecrire('file', o); })).then(function () { return bilan; });
        }
        var par = {}; ((x.data && x.data.resultats) || []).forEach(function (r) { par[r.idempotency_key] = r; });
        return lot.reduce(function (p, o) {
          return p.then(function () {
            var r = par[o.idempotency_key];
            if (!r) { o.statut = 'ECHEC_RESEAU'; o.essais += 1; o.dernier_message = 'Réponse du serveur incomplète.'; return ecrire('file', o); }
            bilan.envoyees += 1; if (r.statut === 'ACCEPTEE') bilan.recues += 1; else if (r.statut === 'CONFLIT') bilan.conflits += 1; else bilan.refusees += 1;
            return appliquerResultat(o, r);
          });
        }, Promise.resolve()).then(function () { return reste.length ? boucle(reste) : bilan; });
      }).catch(function (e) {
        bilan.reseau = true;
        return Promise.all(lot.map(function (o) { o.statut = 'ECHEC_RESEAU'; o.essais += 1; o.dernier_message = 'Pas de réseau : ' + (e && e.message ? e.message : 'envoi impossible'); return ecrire('file', o); })).then(function () { return bilan; });
      });
    }).then(function (b) { return b.reseau || !sb ? b : envoyerFichiers(sb).then(function () { return b; }); })
      .then(function (b) { enCours = null; emettre(); return b; }, function (e) { enCours = null; emettre(); throw e; });
    return enCours;
  }
  function reessayer(cle) {
    return lire('file', cle).then(function (o) { if (!o || o.statut !== 'REJETE') return; o.statut = 'EN_ATTENTE'; return ecrire('file', o); }).then(emettre);
  }

  /* ---------- champs (panels) ---------- */
  function panels(campaignId) { return tout('panels').then(function (l) { return l.filter(function (p) { return !campaignId || p.campaign_id === campaignId; }); }); }
  function panel(id) { return lire('panels', id); }
  function enregistrerPanel(p) { return ecrire('panels', p).then(function (x) { emettre(); return x; }); }

  /* ---------- visites ---------- */
  function visites(panelId) { return tout('visites').then(function (l) { return l.filter(function (v) { return !panelId || v.panel_id === panelId; }); }); }
  function visite(id) { return lire('visites', id); }
  function enregistrerVisite(v) { v.modifie_le = new Date().toISOString(); return ecrire('visites', v); }
  /* Enregistre la visite sur l'appareil et la place dans la file (brouillon ou soumission). */
  function envoyerVisite(v, soumettre, libelle) {
    v.saisie_le = v.saisie_le || new Date().toISOString();
    return aDesEnvoisPour(v.id).then(function (dejaEnFile) {
      var charge = C.chargeVisite(v, soumettre);
      if (dejaEnFile) charge.base_version = null;   // la chaîne locale fait foi tant que le serveur n'a pas répondu
      v.etat_envoi = 'EN_ATTENTE'; v.intention = soumettre ? 'SOUMETTRE' : 'BROUILLON'; v.proprietaire = v.proprietaire || utilisateur();
      return enregistrerVisite(v).then(function () { return mettreEnFile('VISITE_ENREGISTRER', charge, { entite: 'VISITE', entite_id: v.id, libelle: libelle }); });
    });
  }
  function ajouterFichier(chemin, blob) { return ecrire('fichiers', { chemin: chemin, blob: blob, type: blob.type, statut: 'EN_ATTENTE', cree_le: new Date().toISOString() }); }

  /* ---------- préparation hors ligne : lecture du serveur vers l'appareil ---------- */
  function pages(req) {
    var out = [], pas = 1000;
    function suite(n) { return req().range(n, n + pas - 1).then(function (x) { if (x.error) throw new Error(x.error.message); out = out.concat(x.data || []); return (x.data || []).length === pas && n < 9000 ? suite(n + pas) : out; }); }
    return suite(0);
  }
  function preparer(sb, campaignId) {
    if (!sb || !campaignId) return Promise.reject(new Error('Connexion ou campagne indisponible.'));
    var res = {};
    return pages(function () { return sb.from('pheno_panels').select('*').eq('campaign_id', campaignId).order('id'); }).then(function (p) {
      res.panels = p; var ids = p.map(function (x) { return x.id; });
      if (!ids.length) { res.blocs = []; res.arbres = []; res.visites = []; res.obs = []; return; }
      return Promise.all([
        pages(function () { return sb.from('pheno_blocs').select('*').in('panel_id', ids).order('id'); }),
        pages(function () { return sb.from('pheno_arbres').select('*').in('panel_id', ids).order('id'); }),
        pages(function () { return sb.from('pheno_visites').select('*').in('panel_id', ids).order('date_observation', { ascending: false }); })
      ]).then(function (r) {
        res.blocs = r[0]; res.arbres = r[1]; res.visites = r[2];
        var ouvertes = r[2].filter(function (v) { return v.statut === 'BROUILLON' || v.statut === 'CORRECTION_DEMANDEE'; }).map(function (v) { return v.id; });
        if (!ouvertes.length) { res.obs = []; return; }
        return pages(function () { return sb.from('pheno_observations').select('*').in('visite_id', ouvertes).order('id'); }).then(function (o) { res.obs = o; });
      });
    }).then(function () {
      /* Parcelles installables : une seule RPC, filtrée par le serveur sur le périmètre de l'agent. */
      return sb.rpc('pheno_parcelles_disponibles', { p_campaign: campaignId }).then(function (x) { if (x.error) throw new Error(x.error.message); return x.data || []; }).catch(function () { return null; });
    }).then(function (rows) {
      if (!rows) { res.plots = null; return []; }
      var vil = {}, pro = {};
      res.plots = rows.map(function (r) { vil[r.village_id] = { id: r.village_id, village: r.village_nom, cluster_code: r.cluster_code }; pro[r.producteur_id] = { id: r.producteur_id, nom: r.producteur_nom, code: r.producteur_code };
        return { id: r.plot_id, producteur_id: r.producteur_id, village_id: r.village_id, local_name: r.parcelle_nom, tree_count: r.arbres_declares, deja_installee: r.deja_installee }; });
      res.villages = Object.keys(vil).map(function (k) { return vil[k]; });
      return Object.keys(pro).map(function (k) { return pro[k]; });
    }).then(function (producteurs) {
      return Promise.all([tout('panels'), tout('visites'), enAttente()]).then(function (loc) {
        var enFile = {}; loc[2].forEach(function (o) { if (o.entite_id) enFile[o.entite_id] = 1; });
        var ecritures = [];
        res.panels.forEach(function (p) {
          if (enFile[p.id]) return;
          p.blocs = res.blocs.filter(function (b) { return b.panel_id === p.id; }).sort(function (a, b) { return a.numero - b.numero; });
          var num = {}; p.blocs.forEach(function (b) { num[b.id] = b.numero; });
          p.arbres = res.arbres.filter(function (a) { return a.panel_id === p.id; }).map(function (a) { a.bloc_numero = num[a.bloc_id]; return a; });
          /* Un inventaire encore en file sur l'appareil ne doit pas être effacé par la copie du serveur. */
          var local = loc[0].filter(function (x) { return x.id === p.id; })[0];
          if (local) p.blocs.forEach(function (b) { var lb = (local.blocs || []).filter(function (x) { return x.id === b.id; })[0]; if (lb && b.nb_arbres_inventories == null && lb.nb_arbres_inventories != null && enFile[b.id]) b.nb_arbres_inventories = lb.nb_arbres_inventories; });
          if (local && !p.arbres.length && (local.arbres || []).length && p.statut === 'TIRAGE_VERROUILLE') { p.arbres = local.arbres; p.statut_local = local.statut_local; }
          p.local = false; ecritures.push(ecrire('panels', p));
        });
        res.visites.forEach(function (v) {
          if (enFile[v.id]) return;
          var local = loc[1].filter(function (x) { return x.id === v.id; })[0];
          var obs = res.obs.filter(function (o) { return o.visite_id === v.id; });
          ecritures.push(ecrire('visites', { id: v.id, panel_id: v.panel_id, date_observation: v.date_observation, semaine_iso: v.semaine_iso, saisie_le: v.saisie_le,
            recu_serveur_le: v.recu_serveur_le, mode_saisie: v.mode_saisie, observateur_id: v.observateur_id, transcripteur_id: v.transcripteur_id,
            ramassage: v.ramassage, anomalies: v.anomalies, latitude: v.latitude, longitude: v.longitude, statut_serveur: v.statut, row_version: v.row_version,
            correction_motif: v.correction_motif, etat_envoi: 'RECU', proprietaire: v.transcripteur_id || v.observateur_id,
            observations: obs.length ? obs.map(function (o) { return { arbre_id: o.arbre_id, retrouve: o.retrouve, f: o.f, n: o.n, p: o.p, pas_vu_motif: o.pas_vu_motif, chute: o.chute, chute_preuve: o.chute_preuve, anomalie: o.anomalie, photo_ref: o.photo_ref }; })
              : (local && local.observations) || [] }));
        });
        if (res.plots) ecritures.push(ecrire('ref', { le: new Date().toISOString(), plots: res.plots, villages: res.villages || [], producteurs: producteurs }, 'parcelles'));
        ecritures.push(ecrire('meta', { le: new Date().toISOString(), campaign_id: campaignId, champs: res.panels.length }, 'preparation'));
        return Promise.all(ecritures);
      });
    }).then(function () { emettre(); return { champs: res.panels.length, parcelles: res.plots ? res.plots.length : null }; });
  }
  function referentiel() { return lire('ref', 'parcelles').then(function (x) { return x || { plots: [], villages: [], producteurs: [] }; }); }
  function derniereePreparation() { return lire('meta', 'preparation'); }

  /* Au démarrage : un envoi interrompu redevient « à renvoyer » (même clé, donc sans doublon). */
  function reprendre() {
    return tout('file').then(function (l) { return Promise.all(l.filter(function (o) { return o.statut === 'ENVOI'; }).map(function (o) { o.statut = 'ECHEC_RESEAU'; return ecrire('file', o); })); }).catch(function () {});
  }

  global.ANAGROCI_OBS_LOCAL = {
    mettreEnFile: mettreEnFile, file: file, enAttente: enAttente, synchroniser: synchroniser, reessayer: reessayer,
    panels: panels, panel: panel, enregistrerPanel: enregistrerPanel, visites: visites, visite: visite, enregistrerVisite: enregistrerVisite,
    envoyerVisite: envoyerVisite, ajouterFichier: ajouterFichier, preparer: preparer, referentiel: referentiel, dernierePreparation: derniereePreparation,
    reprendre: reprendre, utilisateur: utilisateur, appareil: appareil, surChangement: function (f) { ecouteurs.push(f); }, BUCKET: BUCKET
  };
  reprendre();
})(window);
