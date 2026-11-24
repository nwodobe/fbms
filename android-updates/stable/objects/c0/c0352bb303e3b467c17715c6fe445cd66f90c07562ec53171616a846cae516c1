/* Cartes satellite de mission : contrat public, bornes et intégrité du catalogue.
   Données publiques uniquement. Aucune parcelle, aucun compte ni repère métier ici.
   Le lecteur refuse une grille partielle ; le cache de navigation n'est pas un paquet. */
(function (racine) {
  'use strict';
  var MIO = 1024 * 1024;
  var LIMITES = Object.freeze({ paquet: 20 * MIO, total: 64 * MIO, sansEstimation: 16 * MIO,
    reserve: 64 * MIO, tuile: MIO, tuiles: 2048, catalogue: 256 * 1024, manifeste: 2 * MIO });
  var IDENTIFIANT = /^[a-z0-9][a-z0-9_-]{0,79}$/;
  var VERSION = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
  var EMPREINTE = /^[a-f0-9]{64}$/;
  function exiger(ok, message) { if (!ok) throw new Error(message); }
  function entier(n) { return Number.isSafeInteger(n); }
  function texte(s, max) { return typeof s === 'string' && s.trim().length > 0 && s.length <= max; }
  function date(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s.slice(0, 10); }
  function chemin(s) {
    return texte(s, 220) && /^[a-zA-Z0-9_./-]+$/.test(s) && s[0] !== '/' &&
      !s.split('/').some(function (p) { return !p || p === '.' || p === '..'; });
  }
  function lien(s) { try { var u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password; } catch (e) { return false; } }
  function emprise(b) {
    exiger(Array.isArray(b) && b.length === 4 && b.every(Number.isFinite), 'Emprise de carte invalide.');
    exiger(b[0] >= -180 && b[2] <= 180 && b[1] > -85.05112878 && b[3] < 85.05112878 && b[0] < b[2] && b[1] < b[3], 'Emprise hors des limites cartographiques.');
    exiger(b[2] - b[0] <= 2 && b[3] - b[1] <= 2, 'Zone trop grande : préparez une carte de mission plus petite.');
    return b;
  }
  function contient(b, p) {
    return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) &&
      p[1] >= b[0] && p[1] <= b[2] && p[0] >= b[1] && p[0] <= b[3];
  }
  function intersection(a, b) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]; }
  function ordonnee(lat, n) { var r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; }
  function plage(b, z) {
    var n = Math.pow(2, z);
    return { x0: Math.max(0, Math.floor((b[0] + 180) / 360 * n)),
      x1: Math.min(n - 1, Math.ceil((b[2] + 180) / 360 * n) - 1),
      y0: Math.max(0, Math.floor(ordonnee(b[3], n))), y1: Math.min(n - 1, Math.ceil(ordonnee(b[1], n)) - 1) };
  }
  function cleTuile(t) { return t.z + '/' + t.x + '/' + t.y; }
  function grille(b, min, max) {
    var attendues = Object.create(null), nombre = 0;
    for (var z = min; z <= max; z++) {
      var p = plage(b, z);
      nombre += (p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1);
      exiger(nombre <= LIMITES.tuiles, 'Trop de tuiles : réduisez la zone ou le détail.');
      for (var x = p.x0; x <= p.x1; x++) for (var y = p.y0; y <= p.y1; y++) attendues[z + '/' + x + '/' + y] = true;
    }
    return attendues;
  }
  function validerManifeste(m, zone) {
    exiger(m && m.schemaVersion === 1 && m.kind === 'satellite', 'Format de carte satellite non reconnu.');
    exiger(typeof m.id === 'string' && IDENTIFIANT.test(m.id) && typeof m.version === 'string' && VERSION.test(m.version) && texte(m.name, 150), 'Identité du paquet invalide.');
    emprise(m.bounds);
    exiger(entier(m.minZoom) && entier(m.maxZoom) && m.minZoom >= 1 && m.minZoom <= m.maxZoom && m.maxZoom <= 16, 'Niveaux de détail non pris en charge.');
    exiger(m.tileSize === 256 && m.scheme === 'xyz' && ['png', 'jpg'].indexOf(m.format) !== -1, 'Tuiles incompatibles avec cette version.');
    exiger(date(m.preparedAt), 'Date de préparation absente.');
    var s = m.source;
    exiger(s && texte(s.name, 180) && texte(s.attribution, 1000) && lien(s.url) && lien(s.licenceUrl), 'Source, licence ou attribution absente.');
    exiger(date(s.acquiredAt) && Number.isFinite(s.resolutionMetres) && s.resolutionMetres > 0 && s.resolutionMetres <= 1000, 'Date ou résolution des images inconnue.');
    exiger(s.allowOffline === true && s.allowCommercial === true, 'Droits de conservation et d’usage professionnel non confirmés.');
    var q = m.quality;
    exiger(q && q.reviewStatus === 'verified', 'La qualité de cette carte doit encore être vérifiée avant sa diffusion.');
    ['zoneCloudPercent', 'zoneNoDataPercent', 'zoneUnclassifiedPercent'].forEach(function (k) {
      exiger(Number.isFinite(q[k]) && q[k] >= 0 && q[k] <= 100, 'Contrôle de couverture incomplet.');
    });
    exiger(q.zoneNoDataPercent === 0, 'La zone annoncée contient des pixels sans données : préparez une autre emprise.');
    exiger(q.zoneCloudPercent <= 10, 'Image trop nuageuse pour ce paquet de mission.');
    exiger(Array.isArray(m.tiles) && m.tiles.length > 0 && m.tiles.length <= LIMITES.tuiles && m.tileCount === m.tiles.length, 'Liste des tuiles invalide.');
    var attendues = grille(m.bounds, m.minZoom, m.maxZoom), vues = Object.create(null), total = 0;
    m.tiles.forEach(function (t) {
      exiger(t && entier(t.z) && entier(t.x) && entier(t.y), 'Coordonnée de tuile invalide.');
      var k = cleTuile(t);
      exiger(attendues[k] && !vues[k], 'Tuile en double ou hors de la zone promise.'); vues[k] = true;
      exiger(t.path === 'tiles/' + k + '.' + m.format && chemin(t.path), 'Chemin de tuile interdit.');
      exiger(entier(t.bytes) && t.bytes > 0 && t.bytes <= LIMITES.tuile && typeof t.sha256 === 'string' && EMPREINTE.test(t.sha256), 'Taille ou empreinte de tuile invalide.');
      total += t.bytes;
    });
    exiger(Object.keys(attendues).length === m.tiles.length, 'Paquet incomplet : une partie de la zone ou des zooms manque.');
    exiger(total === m.totalBytes && total <= LIMITES.paquet, 'Volume du paquet incohérent ou supérieur à 20 Mio.');
    if (zone) {
      exiger(m.id === zone.id && m.version === zone.version && m.totalBytes === zone.totalBytes &&
        JSON.stringify(m.bounds) === JSON.stringify(zone.bounds) && m.minZoom === zone.minZoom && m.maxZoom === zone.maxZoom &&
        s.resolutionMetres === zone.resolutionMetres && s.acquiredAt === zone.acquiredAt, 'Le paquet diffère de la carte annoncée.');
    }
    return m;
  }
  function validerCatalogue(c) {
    exiger(c && c.schemaVersion === 1 && Array.isArray(c.zones) && c.zones.length <= 50, 'Catalogue de cartes invalide.');
    var ids = Object.create(null);
    c.zones.forEach(function (z) {
      exiger(z && typeof z.id === 'string' && IDENTIFIANT.test(z.id) && !ids[z.id] && typeof z.version === 'string' && VERSION.test(z.version) && texte(z.name, 150), 'Zone de catalogue invalide.'); ids[z.id] = true;
      emprise(z.bounds);
      exiger(chemin(z.manifest) && z.manifest.endsWith('/manifest.json') && z.manifest.startsWith(z.id + '/'), 'Chemin du paquet interdit.');
      exiger(typeof z.manifestSha256 === 'string' && EMPREINTE.test(z.manifestSha256) && entier(z.totalBytes) && z.totalBytes > 0 && z.totalBytes <= LIMITES.paquet, 'Volume ou intégrité du catalogue invalide.');
      exiger(entier(z.minZoom) && entier(z.maxZoom) && z.minZoom >= 1 && z.maxZoom >= z.minZoom && z.maxZoom <= 16, 'Niveaux de zoom invalides.');
      exiger(date(z.acquiredAt) && Number.isFinite(z.resolutionMetres) && z.resolutionMetres > 0, 'Métadonnées du catalogue absentes.');
    });
    return c;
  }
  function prevoirEspace(volumeNouveau, cartesOccupees, estimation) {
    exiger(Number.isFinite(volumeNouveau) && volumeNouveau >= 0 && Number.isFinite(cartesOccupees) && cartesOccupees >= 0, 'Volume de stockage inconnu.');
    var mesure = estimation && Number.isFinite(estimation.quota) && estimation.quota > 0 && Number.isFinite(estimation.usage) && estimation.usage >= 0;
    var limite = mesure ? LIMITES.total : LIMITES.sansEstimation;
    /* Marge pour index, manifestes et écritures temporaires. Les anciennes versions sont déjà
       comptées dans cartesOccupees et dans l'usage de l'origine ; elles ne sont pas effacées ici. */
    var requis = Math.ceil(volumeNouveau * 1.35) + 1024 * 1024;
    exiger(cartesOccupees + volumeNouveau <= limite, 'Limite prudente des cartes atteinte. Supprimez seulement une carte devenue inutile.');
    if (mesure) exiger(estimation.quota - estimation.usage - requis >= Math.max(LIMITES.reserve, estimation.quota * 0.20),
      'Espace insuffisant : le téléchargement est refusé pour préserver les données terrain.');
    return { mesure: !!mesure, requis: requis, limite: limite };
  }
  function echapper(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var api = { LIMITES: LIMITES, validerCatalogue: validerCatalogue, validerManifeste: validerManifeste,
    contient: contient, intersection: intersection, plage: plage, cleTuile: cleTuile, prevoirEspace: prevoirEspace, echapper: echapper };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  racine.ANAGROCI_CARTES_COEUR = api;
})(typeof window !== 'undefined' ? window : globalThis);
