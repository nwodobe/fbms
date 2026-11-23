/* REPÈRES GPS AFLP · cœur (sans écran, sans réseau, sans stockage)
   --------------------------------------------------------------------------------
   Coordonnées saisies ou capturées pour une parcelle, un bloc ou un arbre suivi.
   · Référentiel unique : WGS84, degrés décimaux. Latitude PUIS longitude, toujours
     dans des champs nommés (jamais un couple dont l'ordre serait à deviner).
   · Le point et la virgule sont acceptés comme séparateur décimal. Tout autre format
     (degrés-minutes-secondes, lettres N/S/E/O, deux séparateurs) est REFUSÉ avec une
     explication : rien n'est deviné.
   · Rien n'est corrigé en silence : une valeur suspecte (signe, inversion, hors de la
     Côte d'Ivoire) produit une ALERTE que l'agent lit, jamais une modification.
   · 0 ; 0 n'est jamais une position.
   · Un repère est un POINT : il ne donne ni contour ni superficie.
   Utilisable sous Node (tests) et dans la page. Expose ANAGROCI_REPERES_COEUR. */
(function (global) {
  'use strict';

  var TYPES = { PARCELLE: 'Parcelle', BLOC: 'Bloc', ARBRE: 'Arbre suivi' };
  var ORIGINES = { GPS_APPAREIL: 'Capturé par ce téléphone', SAISIE_MANUELLE: 'Saisi à la main' };
  var ETATS = {
    ATTENTE: 'En attente de synchronisation', ENVOI: 'Envoi en cours', RECU: 'Transmis au serveur',
    CONFLIT: 'Conflit à résoudre', REJETE: 'Refusé par le serveur', ANNULE: 'Abandonné'
  };
  var STATUTS = { BROUILLON: 'Non vérifié', VERIFIE: 'Vérifié', REJETE: 'Écarté' };
  /* Emprise de la Côte d'Ivoire, identique à celle du serveur (plot_map_localiser). */
  var ZONE = { latMin: 4, latMax: 11, lngMin: -9, lngMax: -2 };
  var PRECISION_CAPTURE_MAX_M = 50;   // même seuil que la capture du point de parcelle
  var TOLERANCE_CONTOUR_DEFAUT_M = 10; // erreur courante d'un GPS de téléphone à découvert

  function uuid() {
    var c = global.crypto || (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* Lit UN nombre décimal. Renvoie { ok, valeur, decimales } ou { ok:false, erreur }. */
  function lireNombre(texte, nom) {
    nom = nom || 'La valeur';
    var t = String(texte == null ? '' : texte).replace(/[  \s]+/g, '').replace(/[−–—]/g, '-');
    if (!t) return { ok: false, vide: true, erreur: nom + ' est vide.' };
    if (/[°'"′″]/.test(t) || /[NSEOWnseow]/.test(t)) {
      return { ok: false, erreur: nom + ' : format non accepté. Saisissez des degrés décimaux (exemple : 7,689512), sans °, minutes, secondes ni lettre N/S/E/O.' };
    }
    if ((t.match(/[.,]/g) || []).length > 1) {
      return { ok: false, erreur: nom + ' : deux séparateurs décimaux. Écrivez un seul point ou une seule virgule (exemple : -5,031245).' };
    }
    if (!/^[+-]?\d{1,3}([.,]\d{1,10})?$/.test(t)) {
      return { ok: false, erreur: nom + ' : nombre illisible. Exemple accepté : 7,689512 ou -5.031245.' };
    }
    var v = Number(t.replace(',', '.'));
    if (!isFinite(v)) return { ok: false, erreur: nom + ' : nombre illisible.' };
    var d = t.split(/[.,]/)[1];
    return { ok: true, valeur: v, decimales: d ? d.length : 0 };
  }

  function dansZone(lat, lng) { return lat >= ZONE.latMin && lat <= ZONE.latMax && lng >= ZONE.lngMin && lng <= ZONE.lngMax; }

  /* Valide un couple saisi dans DEUX champs. Ne modifie jamais les valeurs.
     Renvoie { ok, latitude, longitude, erreurs:{latitude,longitude,general}, alertes:[], horsZone }. */
  function lireCoordonnees(latTexte, lngTexte) {
    var r = { ok: false, latitude: null, longitude: null, erreurs: {}, alertes: [], horsZone: false };
    var a = lireNombre(latTexte, 'Latitude'), o = lireNombre(lngTexte, 'Longitude');
    if (!a.ok) r.erreurs.latitude = a.erreur;
    if (!o.ok) r.erreurs.longitude = o.erreur;
    if (a.ok && (a.valeur < -90 || a.valeur > 90)) r.erreurs.latitude = 'Latitude hors limites : elle doit être comprise entre -90 et 90.';
    if (o.ok && (o.valeur < -180 || o.valeur > 180)) r.erreurs.longitude = 'Longitude hors limites : elle doit être comprise entre -180 et 180.';
    if (r.erreurs.latitude || r.erreurs.longitude) return r;
    if (a.valeur === 0 && o.valeur === 0) {
      r.erreurs.general = '0 ; 0 n\'est pas une position. Si la position est inconnue, laissez le repère vide.';
      return r;
    }
    r.latitude = a.valeur; r.longitude = o.valeur; r.ok = true;
    if (!dansZone(a.valeur, o.valeur)) {
      r.horsZone = true;
      var piste = '';
      if (dansZone(o.valeur, a.valeur)) piste = ' Latitude et longitude semblent inversées.';
      else if (dansZone(a.valeur, -o.valeur)) piste = ' Il manque peut-être le signe moins devant la longitude (en Côte d\'Ivoire, la longitude est négative).';
      else if (dansZone(-a.valeur, o.valeur)) piste = ' La latitude ne devrait pas être négative en Côte d\'Ivoire.';
      r.alertes.push('Ces coordonnées sont hors de la Côte d\'Ivoire.' + piste + ' Rien n\'a été modifié : corrigez les champs, ou confirmez si elles sont exactes.');
    }
    if (a.decimales < 4 || o.decimales < 4) {
      var n = Math.min(a.decimales, o.decimales);
      var approx = n === 0 ? '100 km' : n === 1 ? '10 km' : n === 2 ? '1 km' : '100 m';
      r.alertes.push('Peu de décimales (' + n + ') : la position n\'est précise qu\'à environ ' + approx + '. Recopiez toutes les décimales du relevé si vous les avez.');
    }
    return r;
  }

  function fmt(n, dec) { return n == null || n === '' || !isFinite(Number(n)) ? '—' : Number(n).toFixed(dec == null ? 6 : dec); }
  function texteCoordonnees(lat, lng) { return 'Latitude ' + fmt(lat) + ' · Longitude ' + fmt(lng); }

  /* Construit l'opération à transmettre. `objet` : { type, id }. `saisie` : résultat validé. */
  function operation(objet, saisie, contexte) {
    contexte = contexte || {};
    if (!objet || !TYPES[objet.type] || !objet.id) throw new Error('Objet du repère non précisé.');
    if (!ORIGINES[saisie.origine]) throw new Error('Origine des coordonnées inconnue.');
    if (saisie.latitude == null || saisie.longitude == null) throw new Error('Coordonnées manquantes.');
    if (saisie.latitude === 0 && saisie.longitude === 0) throw new Error('0 ; 0 n\'est pas une position.');
    if (saisie.origine === 'GPS_APPAREIL' && !(saisie.precision_m > 0 && saisie.releve_le)) throw new Error('Une capture GPS porte toujours sa précision et son heure.');
    return {
      idempotency_key: uuid(), type: 'REPERE_ENREGISTRER',
      payload: {
        objet_type: objet.type, objet_id: objet.id,
        latitude: Number(saisie.latitude), longitude: Number(saisie.longitude),
        origine: saisie.origine,
        source_externe: saisie.source_externe ? String(saisie.source_externe).trim().slice(0, 200) : null,
        releve_le: saisie.releve_le || null,
        precision_m: saisie.precision_m > 0 ? Number(saisie.precision_m) : null,
        version_base: contexte.version_base || 0,
        motif: saisie.motif ? String(saisie.motif).trim().slice(0, 500) : null,
        confirmer_hors_zone: !!saisie.confirmer_hors_zone
      },
      device_id: contexte.device_id || null,
      created_at_client: contexte.maintenant || new Date().toISOString()
    };
  }

  /* --------- géométrie légère : un point est-il dans un contour ? ---------
     Les sommets GeoJSON sont en [longitude, latitude]. Le point est passé en
     (latitude, longitude) NOMMÉS pour ne jamais confondre l'ordre. */
  function anneaux(geojson) {
    if (!geojson) return [];
    var g = geojson.type === 'Feature' ? geojson.geometry : geojson.type === 'FeatureCollection' ? (geojson.features[0] || {}).geometry : geojson;
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates[0] || []];
    if (g.type === 'MultiPolygon') return g.coordinates.map(function (p) { return p[0] || []; });
    return [];
  }
  function dansAnneau(lat, lng, an) {
    var dedans = false;
    for (var i = 0, j = an.length - 1; i < an.length; j = i++) {
      var xi = an[i][0], yi = an[i][1], xj = an[j][0], yj = an[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dedans = !dedans;
    }
    return dedans;
  }
  function metres(lat1, lng1, lat2, lng2) {
    var k = Math.PI / 180, x = (lng2 - lng1) * k * Math.cos((lat1 + lat2) / 2 * k), y = (lat2 - lat1) * k;
    return Math.sqrt(x * x + y * y) * 6371008.8;
  }
  function distanceSegment(lat, lng, a, b) {
    var k = Math.PI / 180, c = Math.cos(lat * k);
    var px = lng * c, py = lat, ax = a[0] * c, ay = a[1], bx = b[0] * c, by = b[1];
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return metres(lat, lng, ay + t * dy, (ax + t * dx) / c);
  }
  /* Renvoie { connu, dedans, distance_m, tolerance_m, signale }.
     Tolérance : la précision du relevé quand elle est connue, sinon 10 m (erreur courante
     d'un GPS de téléphone). Un arbre signalé n'est NI déplacé NI désélectionné. */
  function positionDansContour(lat, lng, geojson, precisionM) {
    var ans = anneaux(geojson);
    if (!ans.length || lat == null || lng == null) return { connu: false };
    var dedans = ans.some(function (an) { return dansAnneau(lat, lng, an); }), d = 0;
    if (!dedans) {
      d = Infinity;
      ans.forEach(function (an) { for (var i = 0; i < an.length - 1; i++) d = Math.min(d, distanceSegment(lat, lng, an[i], an[i + 1])); });
    }
    var tol = precisionM > 0 ? Number(precisionM) : TOLERANCE_CONTOUR_DEFAUT_M;
    return { connu: true, dedans: dedans, distance_m: Math.round(d), tolerance_m: tol, signale: !dedans && d > tol };
  }

  var API = {
    TYPES: TYPES, ORIGINES: ORIGINES, ETATS: ETATS, STATUTS: STATUTS, ZONE: ZONE,
    PRECISION_CAPTURE_MAX_M: PRECISION_CAPTURE_MAX_M, TOLERANCE_CONTOUR_DEFAUT_M: TOLERANCE_CONTOUR_DEFAUT_M,
    uuid: uuid, lireNombre: lireNombre, lireCoordonnees: lireCoordonnees, dansZone: dansZone,
    fmt: fmt, texteCoordonnees: texteCoordonnees, operation: operation,
    positionDansContour: positionDansContour, metres: metres
  };
  global.ANAGROCI_REPERES_COEUR = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
