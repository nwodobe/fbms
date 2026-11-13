/* OBSERVATOIRE AGRONOMIQUE AFLP 2027 (pilote) — cœur métier, sans interface ni réseau.
   --------------------------------------------------------------------------------
   Mêmes règles que le serveur (supabase/20261113100200_aflp_observatoire_3_rpc_sync.sql) :
   le serveur fait foi et recalcule ; ce module permet de travailler HORS LIGNE.
     · tirage reproductible : ordre croissant de sha256('<graine>:<numéro>') ;
     · graine des blocs = '<panel_id>:BLOCS' ; graine des arbres = '<bloc_id>:ARBRES' ;
     · identifiant d'arbre déterministe = 32 premiers hexadécimaux de sha256('<bloc_id>:ARBRE:<numéro>') ;
     · aucune réponse n'est préremplie : une réponse absente vaut null, jamais « Non ».
   Utilisable dans le navigateur (window.ANAGROCI_OBS_COEUR) et sous Node (tests). */
(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.ANAGROCI_OBS_COEUR = fabrique();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- SHA-256 synchrone (UTF-8), pour un tirage identique partout ---------- */
  var K = [];
  (function () {
    var n = 2, i = 0;
    function premier(x) { for (var d = 2; d * d <= x; d++) if (x % d === 0) return false; return true; }
    while (i < 64) { if (premier(n)) { K[i++] = (Math.pow(n, 1 / 3) * 4294967296) | 0; } n++; }
  })();
  function utf8(s) {
    var o = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.codePointAt(i); if (c > 0xffff) i++;
      if (c < 0x80) o.push(c);
      else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return o;
  }
  function sha256(texte) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var m = utf8(String(texte)), l = m.length * 8, i, j, w = new Array(64);
    m.push(0x80); while (m.length % 64 !== 56) m.push(0);
    for (i = 7; i >= 0; i--) m.push(i > 3 ? 0 : (l >>> (i * 8)) & 255);
    function r(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (i = 0; i < m.length; i += 64) {
      for (j = 0; j < 16; j++) w[j] = (m[i + j * 4] << 24) | (m[i + j * 4 + 1] << 16) | (m[i + j * 4 + 2] << 8) | m[i + j * 4 + 3];
      for (j = 16; j < 64; j++) {
        var s0 = r(w[j - 15], 7) ^ r(w[j - 15], 18) ^ (w[j - 15] >>> 3), s1 = r(w[j - 2], 17) ^ r(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        var t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
        var t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  /* ---------- tirage ---------- */
  function tirage(graine, n, k) {
    var t = [], i;
    for (i = 1; i <= n; i++) t.push([sha256(graine + ':' + i), i]);
    t.sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]; });
    return t.slice(0, Math.max(0, k)).map(function (x) { return x[1]; });
  }
  function arbreId(blocId, numero) {
    var h = sha256(blocId + ':ARBRE:' + numero).slice(0, 32);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var o = new Uint8Array(16), i;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(o); else for (i = 0; i < 16; i++) o[i] = Math.floor(Math.random() * 256);
    o[6] = (o[6] & 15) | 64; o[8] = (o[8] & 63) | 128;
    var h = Array.prototype.map.call(o, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* Répartition des titulaires et des réserves sur les blocs tirés, par rang de tirage (1..b). */
  function repartition(titulaires, reserves, b) {
    var out = [], rang, k;
    for (rang = 1; rang <= b; rang++) {
      var m = Math.floor(titulaires / b) + (rang <= titulaires % b ? 1 : 0), r = 0;
      for (k = 1; k <= reserves; k++) if (((k - 1) % b) + 1 === rang) r++;
      out.push({ rang: rang, titulaires: m, reserves: r });
    }
    return out;
  }

  /* Installation : contrôle des paramètres puis tirage des blocs. b est fixé AVANT le tirage. */
  function installer(p) {
    var T = p.titulaires || 10, R = p.reserves == null ? 2 : p.reserves, B = +p.nb_blocs_total, b = +p.nb_blocs_tires, erreurs = [];
    if (!(B >= 1) || !(b >= 1) || b > B || b > T || B !== Math.floor(B) || b !== Math.floor(b)) erreurs.push('Nombre de blocs invalide : 1 ≤ b ≤ B et b ≤ ' + T + '.');
    var blocs = p.blocs || [];
    if (blocs.length !== B) erreurs.push('Décrivez exactement ' + B + ' blocs.');
    blocs.forEach(function (x, i) { if (!String(x.repere || '').trim()) erreurs.push('Bloc ' + (i + 1) + ' : repère physique obligatoire.'); });
    if (erreurs.length) return { erreurs: erreurs };
    var ordre = tirage(p.id + ':BLOCS', B, b), rep = repartition(T, R, b);
    return {
      erreurs: [], blocs_tires: ordre, graine: p.id + ':BLOCS',
      blocs: blocs.map(function (x, i) {
        var numero = i + 1, rang = ordre.indexOf(numero) + 1;
        return { id: x.id || uuid(), numero: numero, repere: String(x.repere).trim(), latitude: x.latitude == null ? null : x.latitude, longitude: x.longitude == null ? null : x.longitude,
          tire: rang > 0, rang_tirage: rang > 0 ? rang : null, nb_titulaires_prevus: rang > 0 ? rep[rang - 1].titulaires : 0, nb_reserves_prevues: rang > 0 ? rep[rang - 1].reserves : 0, nb_arbres_inventories: null };
      })
    };
  }

  /* Tirage des arbres quand tous les blocs tirés sont inventoriés.
     Bloc trop petit : incompatibilité signalée, on ne gonfle jamais N et on ne change pas de bloc. */
  function tirerArbres(panel) {
    var tires = panel.blocs.filter(function (x) { return x.tire; }).sort(function (x, y) { return x.rang_tirage - y.rang_tirage; });
    if (tires.some(function (x) { return x.nb_arbres_inventories == null; })) return { statut: 'TIRAGE_VERROUILLE', arbres: [] };
    var petits = tires.filter(function (x) { return x.nb_arbres_inventories < x.nb_titulaires_prevus; });
    if (petits.length) {
      return { statut: 'INCOMPATIBLE', arbres: [], incompatibilite: petits.map(function (x) {
        return 'bloc ' + x.numero + ' : ' + x.nb_arbres_inventories + ' arbres inventoriés pour ' + x.nb_titulaires_prevus + ' titulaires prévus'; }).join(' ; ') };
    }
    var arbres = [], rt = 0, rr = 0, manque = 0;
    tires.forEach(function (bl) {
      var N = bl.nb_arbres_inventories, ordre = tirage(bl.id + ':ARBRES', N, Math.min(N, bl.nb_titulaires_prevus + bl.nb_reserves_prevues));
      var proba = (panel.nb_blocs_tires / panel.nb_blocs_total) * (bl.nb_titulaires_prevus / N);
      ordre.forEach(function (numero, i) {
        var tit = i < bl.nb_titulaires_prevus;
        arbres.push({ id: arbreId(bl.id, numero), bloc_id: bl.id, bloc_numero: bl.numero, numero_inventaire: numero,
          code: 'B' + bl.numero + '-' + ('00' + numero).slice(-3), role: tit ? 'TITULAIRE' : 'RESERVE', rang: tit ? ++rt : ++rr,
          statut: tit ? 'ACTIF' : 'RESERVE_EN_ATTENTE', proba_dans_champ: tit ? proba : null });
      });
      manque += Math.max(0, bl.nb_titulaires_prevus + bl.nb_reserves_prevues - N);
    });
    return { statut: 'ACTIF', arbres: arbres, reserves_manquantes: manque };
  }

  /* ---------- visite ---------- */
  function semaineIso(dateIso) {
    var d = new Date(dateIso + 'T00:00:00Z'), j = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - j + 3);
    var an = d.getUTCFullYear(), p = new Date(Date.UTC(an, 0, 4)), pj = (p.getUTCDay() + 6) % 7;
    var s;
    s = 1 + Math.round(((d - p) / 86400000 - 3 + pj) / 7);
    return an + '-W' + ('0' + s).slice(-2);
  }
  function aujourdhui() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function observationVide(arbreId_) {
    return { arbre_id: arbreId_, retrouve: null, f: null, n: null, p: null, pas_vu_motif: null, chute: null, chute_preuve: null, anomalie: null, photo_ref: null };
  }
  function arbresObserves(arbres) {
    return (arbres || []).filter(function (a) { return a.statut === 'ACTIF' || a.statut === 'RESERVE_ACTIVEE'; })
      .sort(function (x, y) { return (x.role === y.role ? 0 : x.role === 'TITULAIRE' ? -1 : 1) || x.rang - y.rang; });
  }
  function observationComplete(o) {
    if (!o || o.retrouve == null) return false;
    if (o.retrouve === false) return !!String(o.pas_vu_motif || '').trim();
    if (!o.f || !o.n || !o.p || !o.chute) return false;
    if ([o.f, o.n, o.p, o.chute].indexOf('PAS_VU') >= 0 && !String(o.pas_vu_motif || '').trim()) return false;
    if ((o.chute === 'MURE' || o.chute === 'PREMATUREE') && !o.chute_preuve) return false;
    return true;
  }
  /* Mêmes contrôles que le serveur avant « Terminer et soumettre ». */
  function controlerVisite(visite, arbres) {
    var e = [], obs = {}; (visite.observations || []).forEach(function (o) { obs[o.arbre_id] = o; });
    if (!visite.date_observation) e.push('Date d’observation manquante.');
    else if (visite.date_observation > aujourdhui()) e.push('La date d’observation est dans le futur.');
    if (!visite.ramassage) e.push('Répondez à la question sur le ramassage.');
    arbresObserves(arbres).forEach(function (a) {
      var o = obs[a.id];
      if (!o || o.retrouve == null) { e.push('Arbre ' + a.code + ' : « Retrouvé » non renseigné.'); return; }
      if (o.retrouve === false) { if (!String(o.pas_vu_motif || '').trim()) e.push('Arbre ' + a.code + ' : indiquez pourquoi il n’a pas été retrouvé.'); return; }
      if (!o.f || !o.n || !o.p || !o.chute) e.push('Arbre ' + a.code + ' : fleurs, jeunes noix, pommes ou chute non renseignés.');
      if ([o.f, o.n, o.p, o.chute].indexOf('PAS_VU') >= 0 && !String(o.pas_vu_motif || '').trim()) e.push('Arbre ' + a.code + ' : raison du « Pas vu » obligatoire.');
      if ((o.chute === 'MURE' || o.chute === 'PREMATUREE') && !o.chute_preuve) e.push('Arbre ' + a.code + ' : source de preuve de la chute obligatoire.');
    });
    return e;
  }
  /* Charge utile envoyée au serveur : un arbre non retrouvé ne porte aucun stade. */
  function chargeVisite(visite, soumettre) {
    return {
      id: visite.id, panel_id: visite.panel_id, date_observation: visite.date_observation, semaine_iso: semaineIso(visite.date_observation),
      saisie_le: visite.saisie_le, mode_saisie: visite.mode_saisie || 'DIRECT', observateur_id: visite.mode_saisie === 'TRANSCRIPTION_PAPIER' ? visite.observateur_id : undefined,
      soumettre: !!soumettre, ramassage: visite.ramassage || null, anomalies: visite.anomalies || null,
      latitude: visite.latitude == null ? null : visite.latitude, longitude: visite.longitude == null ? null : visite.longitude,
      base_version: visite.row_version == null ? null : visite.row_version, motif_correction: visite.motif_correction || null,
      observations: (visite.observations || []).map(function (o) {
        var x = { arbre_id: o.arbre_id, retrouve: o.retrouve, pas_vu_motif: o.pas_vu_motif || null, anomalie: o.anomalie || null, photo_ref: o.photo_ref || null };
        if (o.retrouve !== false) { x.f = o.f; x.n = o.n; x.p = o.p; x.chute = o.chute; x.chute_preuve = (o.chute === 'MURE' || o.chute === 'PREMATUREE') ? o.chute_preuve : null; }
        return x;
      })
    };
  }

  var LIBELLES = {
    statut_visite: { LOCAL: 'Brouillon sur ce téléphone', BROUILLON: 'Brouillon', SOUMIS: 'Soumis', EN_VERIFICATION: 'En vérification', VALIDE: 'Validé', CORRECTION_DEMANDEE: 'Correction demandée' },
    statut_envoi: { EN_ATTENTE: 'Enregistré sur ce téléphone. Non encore sauvegardé sur le serveur.', ENVOI: 'Envoi en cours…', RECU: 'Envoyé et reçu par le serveur',
      ECHEC_RESEAU: 'Pas de réseau : nouvel essai automatique', REJETE: 'Refusé par le serveur', CONFLIT: 'Conflit : à traiter avec votre Unit Head' },
    chute: { MURE: 'Oui, des fruits mûrs', PREMATUREE: 'Seulement des fruits non mûrs', ABSENCE: 'Non, rien au sol', NON_CONFIRME: 'Je ne peux pas confirmer', PAS_VU: 'Pas vu' },
    preuve: { VUE_AGENT: 'Je l’ai vue moi-même', DECLAREE_PRODUCTEUR: 'Le producteur me l’a dit' },
    pas_vu: ['Branches trop hautes', 'Feuillage trop dense', 'Accès impossible (eau, clôture, animal)', 'Lumière insuffisante', 'Marque effacée ou arbre introuvable', 'Plusieurs raisons']
  };

  return { sha256: sha256, tirage: tirage, arbreId: arbreId, uuid: uuid, repartition: repartition, installer: installer, tirerArbres: tirerArbres,
    semaineIso: semaineIso, aujourdhui: aujourdhui, observationVide: observationVide, arbresObserves: arbresObserves, observationComplete: observationComplete,
    controlerVisite: controlerVisite, chargeVisite: chargeVisite, LIBELLES: LIBELLES, PROTOCOLE: 'AFLP2027-OBS v0.9' };
});
