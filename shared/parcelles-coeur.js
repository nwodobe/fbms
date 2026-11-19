/* CARTOGRAPHIE DES PARCELLES AFLP · cœur de calcul (sans écran, sans réseau)
   --------------------------------------------------------------------------------
   · Superficie et périmètre GÉODÉSIQUES sur l'ellipsoïde WGS84 (GeographicLib, algorithme
     de Karney) : aucune conversion de pixels, aucune approximation sphérique. Le serveur
     recalcule avec PostGIS (geography, sphéroïde) et refuse un écart supérieur à la
     tolérance : les deux valeurs doivent concorder.
   · Contrôles de forme : polygone fermé, au moins 3 sommets distincts, aucun croisement.
   · Les coordonnées sont arrondies AVANT le calcul : la surface affichée est celle du
     contour réellement envoyé.
   Utilisable dans le navigateur (window.ANAGROCI_PARCELLES_COEUR) et sous Node (tests). */
(function (global, fabrique) {
  'use strict';
  var geo = (typeof module === 'object' && module.exports) ? require('./vendor/geographiclib-geodesic-2.2.0.min.js') : global.geodesic;
  var api = fabrique(geo);
  if (typeof module === 'object' && module.exports) module.exports = api; else global.ANAGROCI_PARCELLES_COEUR = api;
})(typeof window !== 'undefined' ? window : this, function (geodesic) {
  'use strict';
  var DECIMALES = 8;                       // ≈ 1 mm : bien au-delà de la précision d'un GPS de téléphone
  var WGS84 = geodesic ? geodesic.Geodesic.WGS84 : null;

  function arrondi(v) { var f = Math.pow(10, DECIMALES); return Math.round(Number(v) * f) / f; }
  /* Sommets au format [longitude, latitude] (ordre GeoJSON), sans répétition du premier point. */
  function nettoyer(sommets) {
    var out = [];
    (sommets || []).forEach(function (s) {
      var lng = arrondi(s[0]), lat = arrondi(s[1]);
      if (!isFinite(lng) || !isFinite(lat)) return;
      var d = out[out.length - 1];
      if (d && d[0] === lng && d[1] === lat) return;          // point répété consécutif
      out.push([lng, lat]);
    });
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out;
  }
  function geojson(sommets) {
    var s = nettoyer(sommets); if (s.length < 3) return null;
    return { type: 'Polygon', coordinates: [s.concat([s[0].slice()])] };
  }
  /* Surface (m²) et périmètre (m) géodésiques. */
  function mesurer(sommets) {
    var s = nettoyer(sommets);
    if (!WGS84) throw new Error('Bibliothèque géodésique absente.');
    if (s.length < 2) return { area_m2: 0, perimeter_m: 0, sommets: s.length };
    var p = WGS84.Polygon(s.length < 3);
    s.forEach(function (x) { p.AddPoint(x[1], x[0]); });
    var r = p.Compute(false, true);
    return { area_m2: s.length >= 3 ? Math.abs(r.area) : 0, perimeter_m: r.perimeter, sommets: s.length };
  }
  function distance(a, b) { return WGS84.Inverse(a[1], a[0], b[1], b[0]).s12; }

  /* Croisement de deux segments (calcul plan, suffisant à l'échelle d'une parcelle). */
  function orient(a, b, c) { var v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]); return v > 1e-15 ? 1 : (v < -1e-15 ? 2 : 0); }
  function surSegment(a, b, c) { return Math.min(a[0], c[0]) <= b[0] && b[0] <= Math.max(a[0], c[0]) && Math.min(a[1], c[1]) <= b[1] && b[1] <= Math.max(a[1], c[1]); }
  function secoupent(p1, q1, p2, q2) {
    var o1 = orient(p1, q1, p2), o2 = orient(p1, q1, q2), o3 = orient(p2, q2, p1), o4 = orient(p2, q2, q1);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && surSegment(p1, p2, q1)) return true; if (o2 === 0 && surSegment(p1, q2, q1)) return true;
    if (o3 === 0 && surSegment(p2, p1, q2)) return true; if (o4 === 0 && surSegment(p2, q1, q2)) return true;
    return false;
  }
  function croisements(sommets) {
    var s = nettoyer(sommets), n = s.length, out = [];
    if (n < 4) return out;
    for (var i = 0; i < n; i++) {
      var a = s[i], b = s[(i + 1) % n];
      for (var j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;   // segments voisins
        if (secoupent(a, b, s[j], s[(j + 1) % n])) out.push([i, j]);
      }
    }
    return out;
  }
  /* Contrôle complet, messages en français simple pour l'agent. */
  function verifier(sommets, seuils) {
    seuils = seuils || {};
    var s = nettoyer(sommets), erreurs = [], m = { area_m2: 0, perimeter_m: 0 };
    if (s.length < 3) erreurs.push('Placez au moins 3 sommets pour fermer le contour.');
    else {
      m = mesurer(s);
      if (croisements(s).length) erreurs.push('Les lignes du contour se croisent : déplacez un sommet pour supprimer le croisement.');
      var min = seuils.superficie_min_m2 != null ? Number(seuils.superficie_min_m2) : 100;
      var max = (seuils.superficie_max_ha != null ? Number(seuils.superficie_max_ha) : 200) * 10000;
      if (m.area_m2 < min) erreurs.push('Contour trop petit (' + Math.round(m.area_m2) + ' m²) : vérifiez les sommets.');
      if (m.area_m2 > max) erreurs.push('Contour trop grand (' + hectares(m.area_m2) + ' ha) : vérifiez les sommets.');
      if (s.some(function (x) { return x[1] < 4 || x[1] > 11 || x[0] < -9 || x[0] > -2; })) erreurs.push('Un sommet est hors de la Côte d\'Ivoire.');
    }
    return { ok: erreurs.length === 0, erreurs: erreurs, area_m2: m.area_m2, perimeter_m: m.perimeter_m, sommets: s.length, geojson: geojson(s) };
  }
  function hectares(m2, dec) { return (Number(m2) / 10000).toFixed(dec == null ? 2 : dec).replace('.', ','); }
  function metres(v) { return Math.round(Number(v)).toLocaleString('fr-FR').replace(/ | /g, ' '); }
  /* Écart (%) entre superficie calculée et superficie déclarée ; null si la déclaration manque. */
  function ecartDeclare(area_m2, declaree, unite) {
    if (declaree == null || !(Number(declaree) > 0)) return null;
    var u = String(unite || 'HA').toUpperCase(), m2 = u === 'HA' ? declaree * 10000 : u === 'M2' ? Number(declaree) : u === 'ACRE' ? declaree * 4046.8564224 : null;
    if (!m2) return null;
    return Math.round((area_m2 - m2) / m2 * 1000) / 10;
  }
  /* Lectures GPS d'un même sommet : on garde les meilleures (précision ≤ 1,5 × la meilleure),
     moyenne pondérée par 1/précision². La précision annoncée est la PIRE des lectures retenues
     (prudence : aucune précision n'est inventée). */
  function combinerLectures(lectures) {
    var l = (lectures || []).filter(function (x) { return x && isFinite(x.lat) && isFinite(x.lng) && x.precision > 0; });
    if (!l.length) return null;
    var best = Math.min.apply(null, l.map(function (x) { return x.precision; }));
    var garde = l.filter(function (x) { return x.precision <= best * 1.5; });
    var sw = 0, sl = 0, sg = 0;
    garde.forEach(function (x) { var w = 1 / (x.precision * x.precision); sw += w; sl += x.lat * w; sg += x.lng * w; });
    return { lat: arrondi(sl / sw), lng: arrondi(sg / sw), precision: Math.max.apply(null, garde.map(function (x) { return x.precision; })), lectures: garde.length, total: l.length };
  }
  function statsPrecision(valeurs) {
    var v = (valeurs || []).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    return { min: v[0], mediane: Math.round(med * 100) / 100, max: v[v.length - 1], n: v.length };
  }
  var ETATS = {
    LOCAL: 'Enregistré sur ce téléphone', ATTENTE: 'En attente de synchronisation', ENVOI: 'Envoi en cours',
    RECU: 'Reçu par le serveur', CONFLIT: 'Conflit à résoudre', REJETE: 'Refusé par le serveur'
  };
  var STATUTS = {
    NON_LOCALISEE: 'Non localisée', LOCALISEE: 'Localisée (point GPS)', SOUMIS: 'Soumis au Chef de Zone',
    A_CORRIGER: 'À corriger', VALIDE: 'Validé', REMPLACE: 'Remplacé', ARCHIVE: 'Archivé'
  };
  var CONFIANCE = { VISIBLES: 'Limites clairement visibles', PARTIELLES: 'Limites partiellement visibles', INCERTAINES: 'Limites incertaines', VERIFICATION_TERRAIN: 'Vérification terrain nécessaire' };
  var METHODES = { SATELLITE: 'Tracé sur image', GPS_POINTS: 'Mesure GPS', IMPORT_FICHIER: 'Import de fichier', MIXTE: 'Mixte' };
  var SUPERFICIES = {
    SATELLITE_ESTIMEE: 'Superficie cartographique estimée (image)', GPS_MESUREE: 'Superficie mesurée par GPS',
    IMPORT_FICHIER: 'Superficie importée (fichier)', MIXTE: 'Superficie mixte (image et GPS)'
  };
  function uuid() {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  /* Opérations de la file (format attendu par public.plot_map_sync_batch). */
  function operation(type, payload, appareil) {
    return { idempotency_key: uuid(), type: type, payload: payload, device_id: appareil || null, created_at_client: new Date().toISOString() };
  }
  function soumission(plotId, brouillon, mesure, appareil) {
    var st = statsPrecision((brouillon.sommets_gps || []).map(function (x) { return x.precision; }));
    return {
      id: brouillon.geometry_id || uuid(), plot_id: plotId, geometrie: mesure.geojson, method: brouillon.methode,
      boundary_confidence: brouillon.confiance, base_geometry_id: brouillon.base_geometry_id || null,
      area_m2_client: Math.round(mesure.area_m2 * 100) / 100, perimeter_m_client: Math.round(mesure.perimeter_m * 100) / 100,
      imagery_source: brouillon.fond || null, imagery_date: brouillon.date_image || null,
      gps_points: st ? st.n : null, gps_accuracy_min_m: st ? st.min : null, gps_accuracy_median_m: st ? st.mediane : null, gps_accuracy_max_m: st ? st.max : null,
      producer_confirmation: brouillon.confirmation || 'NON_DEMANDEE', producer_confirmation_note: brouillon.confirmation_note || null,
      notes: brouillon.notes || null, device_id: appareil || null
    };
  }
  /* Import : premier polygone d'un GeoJSON (Feature, FeatureCollection, Polygon, MultiPolygon à 1 élément) ou d'un KML. */
  function sommetsDepuisGeoJSON(obj) {
    var g = obj && obj.type === 'FeatureCollection' ? (obj.features || []).map(function (f) { return f.geometry; }).filter(Boolean)[0] : obj && obj.type === 'Feature' ? obj.geometry : obj;
    if (!g) throw new Error('Fichier sans contour.');
    if (g.type === 'MultiPolygon') { if (g.coordinates.length !== 1) throw new Error('Le fichier contient plusieurs contours : un seul par parcelle.'); g = { type: 'Polygon', coordinates: g.coordinates[0] }; }
    if (g.type !== 'Polygon') throw new Error('Le fichier ne contient pas de polygone.');
    if (g.coordinates.length > 1) throw new Error('Contour avec un trou : non accepté.');
    return nettoyer(g.coordinates[0].map(function (c) { return [Number(c[0]), Number(c[1])]; }));
  }
  function sommetsDepuisKML(texte) {
    var m = String(texte).match(/<Polygon[\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (!m) throw new Error('Aucun polygone trouvé dans le fichier KML.');
    var n = (String(texte).match(/<Polygon/gi) || []).length;
    if (n > 1) throw new Error('Le fichier contient plusieurs contours : un seul par parcelle.');
    return nettoyer(m[1].trim().split(/\s+/).map(function (t) { var p = t.split(','); return [Number(p[0]), Number(p[1])]; }));
  }
  function csv(lignes, colonnes) {
    function c(v) { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    return '﻿' + [colonnes.map(function (x) { return c(x[1]); }).join(';')].concat(lignes.map(function (l) {
      return colonnes.map(function (x) { var v = l[x[0]]; return c(typeof v === 'number' ? String(v).replace('.', ',') : v); }).join(';');
    })).join('\n');
  }
  return {
    nettoyer: nettoyer, geojson: geojson, mesurer: mesurer, distance: distance, croisements: croisements, verifier: verifier,
    hectares: hectares, metres: metres, ecartDeclare: ecartDeclare, combinerLectures: combinerLectures, statsPrecision: statsPrecision,
    ETATS: ETATS, STATUTS: STATUTS, CONFIANCE: CONFIANCE, METHODES: METHODES, SUPERFICIES: SUPERFICIES,
    uuid: uuid, operation: operation, soumission: soumission, sommetsDepuisGeoJSON: sommetsDepuisGeoJSON, sommetsDepuisKML: sommetsDepuisKML, csv: csv
  };
});
