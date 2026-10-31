/* ============================================================================
   AFLP FIELD PROOF — cœur métier pur (fieldproof/fp-core.js)
   ----------------------------------------------------------------------------
   Aucune dépendance au navigateur : chargé par la page ET par les tests Node
   (tests/fieldproof/core.test.mjs). Regroupe tout ce qui doit être exact et
   vérifiable hors téléphone :
     · horodatage affiché en Africa/Abidjan (GMT, sans heure d'été) ;
     · identifiants de mission et de média ;
     · statut de localisation (jamais présenté comme une preuve certifiée) ;
     · texte du bandeau AFLP (photo et vidéo) ;
     · nommage des fichiers, manifeste JSON / CSV ;
     · empreinte SHA-256 incrémentale (gros fichiers vidéo sans tout charger) ;
     · CRC-32 et structures ZIP (mode « stocké », sans compression) ;
     · segment EXIF (date, auteur, GPS) inséré dans le JPEG final.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FP_CORE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* -- 1. Référentiels fonctionnels --------------------------------------- */
  /* Activités proposées à l'agent. Aucune n'est présélectionnée : l'agent
     choisit explicitement (rien n'est prérempli comme « réalisé »). */
  var ACTIVITES = [
    'Formation des producteurs',
    'Recensement / enrôlement des producteurs',
    'Visite de plantation',
    'Réunion communautaire',
    'Achat bord champ',
    'Pesée et contrôle qualité',
    'Distribution de sacherie',
    'Visite d\'entrepôt',
    'Suivi des RT',
    'Autre activité (préciser en commentaire)'
  ];

  var QUALITES = {
    STANDARD: { code: 'STANDARD', libelle: 'Standard 720p (recommandé)', largeur: 1280, hauteur: 720, debitVideo: 2500000, debitAudio: 96000 },
    HAUTE:    { code: 'HAUTE',    libelle: 'Haute 1080p (fichiers ~2× plus lourds)', largeur: 1920, hauteur: 1080, debitVideo: 5000000, debitAudio: 128000 }
  };
  var DUREE_RECOMMANDEE_S = 120;
  var SEUIL_PRECISION_M = 50;        // au-delà : « GPS imprécis »
  var AGE_MAX_POSITION_MS = 120000;  // au-delà : « position ancienne »

  /* -- 2. Dates : affichage Africa/Abidjan ---------------------------------
     Abidjan = UTC+0 toute l'année (pas d'heure d'été). Le calcul se fait donc
     en UTC, sans dépendre des données de fuseau du téléphone. */
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function d(x) { return x instanceof Date ? x : new Date(x); }
  function dateAbj(x) { var t = d(x); return p2(t.getUTCDate()) + '/' + p2(t.getUTCMonth() + 1) + '/' + t.getUTCFullYear(); }
  function heureAbj(x) { var t = d(x); return p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes()) + ':' + p2(t.getUTCSeconds()); }
  function dateHeureAbj(x) { return dateAbj(x) + ' ' + heureAbj(x) + ' GMT'; }
  function compactAbj(x) { var t = d(x); return t.getUTCFullYear() + p2(t.getUTCMonth() + 1) + p2(t.getUTCDate()) + '-' + p2(t.getUTCHours()) + p2(t.getUTCMinutes()) + p2(t.getUTCSeconds()); }
  function duree(ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + p2(m) : p2(m)) + ':' + p2(r);
  }

  /* -- 3. Identifiants ------------------------------------------------------ */
  var B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : lisibles à voix haute
  function aleatoire(n, rnd) {
    var s = '';
    for (var i = 0; i < n; i++) s += B32.charAt(Math.floor((rnd ? rnd() : Math.random()) * B32.length));
    return s;
  }
  function idMission(quand, rnd) { var t = d(quand || Date.now()); return 'FP-' + compactAbj(t).slice(0, 8) + '-' + aleatoire(6, rnd); }
  /* Numéro d'ordre par type : P01, P02… / V01, V02… */
  function idMedia(idMis, type, rang) { return idMis + '-' + (type === 'VIDEO' ? 'V' : 'P') + p2(rang); }

  /* -- 4. Localisation ------------------------------------------------------ */
  function arrondi(x, n) { var f = Math.pow(10, n); return Math.round(x * f) / f; }
  /* pos : { lat, lon, precision, horodatage } | null */
  function statutGps(pos, maintenant) {
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number' || isNaN(pos.lat) || isNaN(pos.lon)) {
      return { code: 'ABSENT', libelle: 'LOCALISATION NON VÉRIFIÉE', court: 'Non vérifiée' };
    }
    var age = (maintenant != null ? +d(maintenant) : Date.now()) - (pos.horodatage ? +d(pos.horodatage) : 0);
    if (pos.horodatage && age > AGE_MAX_POSITION_MS) {
      return { code: 'ANCIEN', libelle: 'POSITION ANCIENNE (' + Math.round(age / 60000) + ' MIN) · NON VÉRIFIÉE', court: 'Ancienne' };
    }
    if (typeof pos.precision === 'number' && pos.precision > SEUIL_PRECISION_M) {
      return { code: 'IMPRECIS', libelle: 'GPS DU TÉLÉPHONE · IMPRÉCIS', court: 'Imprécise' };
    }
    return { code: 'OK', libelle: 'GPS DU TÉLÉPHONE', court: 'Obtenue' };
  }
  function coordonnees(pos) {
    if (!pos || typeof pos.lat !== 'number') return '';
    return arrondi(pos.lat, 5).toFixed(5) + ', ' + arrondi(pos.lon, 5).toFixed(5);
  }
  function precisionTexte(pos) { return pos && typeof pos.precision === 'number' ? '±' + Math.round(pos.precision) + ' m' : ''; }
  function lienCarte(pos) {
    if (!pos || typeof pos.lat !== 'number') return '';
    return 'https://www.google.com/maps?q=' + arrondi(pos.lat, 6) + ',' + arrondi(pos.lon, 6);
  }

  /* -- 5. Bandeau ----------------------------------------------------------- */
  /* Renvoie les lignes du bandeau. Le dessin (canvas) est fait par
     fp-capture.js : le texte est ici, pour être testé à l'identique.
     m = { idMedia, type, agent, cluster, village, activite,
           debut, fin?, gpsDebut, gpsFin?, dureeMs? } */
  function lignesBandeau(m, maintenant) {
    var video = m.type === 'VIDEO';
    var st = statutGps(m.gpsDebut, video ? m.debut : (maintenant || m.debut));
    var l1 = 'AFLP · ANAGROCI  |  FIELD PROOF  |  ' + (m.idMedia || '');
    var l2 = 'Agent : ' + (m.agent || 'Non identifié') + '   ·   Cluster : ' + (m.cluster || '—') + '   ·   Village : ' + (m.village || '—');
    var l3 = 'Activité : ' + (m.activite || '—');
    var l4, l5;
    if (!video) {
      l4 = dateAbj(m.debut) + '   ' + heureAbj(m.debut) + ' GMT (Abidjan)';
      l5 = st.code === 'ABSENT' ? st.libelle
         : 'GPS ' + coordonnees(m.gpsDebut) + '  ' + precisionTexte(m.gpsDebut) + '   ·   ' + st.libelle;
    } else {
      l4 = 'Début : ' + dateAbj(m.debut) + ' ' + heureAbj(m.debut) + ' GMT (Abidjan)   ·   Durée : ' + duree(m.dureeMs || 0);
      l5 = st.code === 'ABSENT' ? st.libelle + ' AU DÉBUT DE L\'ENREGISTREMENT'
         : 'Position au DÉBUT de l\'enregistrement : ' + coordonnees(m.gpsDebut) + '  ' + precisionTexte(m.gpsDebut) + '   ·   ' + st.libelle;
    }
    return [l1, l2, l3, l4, l5];
  }

  /* -- 6. Fichiers et manifeste --------------------------------------------- */
  function slug(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 24) || 'NA';
  }
  function extension(mime) {
    mime = String(mime || '');
    if (/jpeg/.test(mime)) return 'jpg';
    if (/mp4/.test(mime)) return 'mp4';
    if (/webm/.test(mime)) return 'webm';
    if (/quicktime/.test(mime)) return 'mov';
    if (/png/.test(mime)) return 'png';
    return 'bin';
  }
  function nomFichier(media) {
    return 'AFLP_' + media.id + '_' + slug(media.cluster) + '_' + slug(media.village) + '_' + compactAbj(media.debut) + '.' + extension(media.mime);
  }

  var COLONNES_CSV = ['mission_id', 'media_id', 'type', 'fichier', 'agent', 'agent_id', 'cluster', 'village', 'village_id', 'activite',
    'debut_gmt', 'fin_gmt', 'duree_s', 'gps_debut_lat', 'gps_debut_lon', 'gps_debut_precision_m', 'gps_debut_statut',
    'gps_fin_lat', 'gps_fin_lon', 'gps_fin_precision_m', 'gps_fin_statut', 'micro', 'mime', 'largeur', 'hauteur',
    'taille_octets', 'sha256', 'galerie_statut', 'commentaire'];
  function csvCellule(v) {
    if (v == null) return '';
    var s = String(v);
    /* Neutralise l'injection de formule à l'ouverture dans Excel. */
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = '\'' + s;
    return /[";\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function ligneMedia(mission, m) {
    var gd = m.gpsDebut || {}, gf = m.gpsFin || {};
    return {
      mission_id: mission.id, media_id: m.id, type: m.type, fichier: nomFichier(m),
      agent: mission.agent, agent_id: mission.agentId, cluster: mission.cluster, village: mission.village, village_id: mission.villageId,
      activite: mission.activite,
      debut_gmt: m.debut, fin_gmt: m.fin || '', duree_s: m.dureeMs != null ? Math.round(m.dureeMs / 1000) : '',
      gps_debut_lat: gd.lat != null ? gd.lat : '', gps_debut_lon: gd.lon != null ? gd.lon : '',
      gps_debut_precision_m: gd.precision != null ? Math.round(gd.precision) : '', gps_debut_statut: statutGps(m.gpsDebut, m.debut).code,
      gps_fin_lat: gf.lat != null ? gf.lat : '', gps_fin_lon: gf.lon != null ? gf.lon : '',
      gps_fin_precision_m: gf.precision != null ? Math.round(gf.precision) : '',
      gps_fin_statut: m.type === 'VIDEO' ? statutGps(m.gpsFin, m.fin).code : '',
      micro: m.type === 'VIDEO' ? (m.micro ? 'OUI' : 'NON (vidéo muette)') : '',
      mime: m.mime, largeur: m.largeur, hauteur: m.hauteur, taille_octets: m.taille, sha256: m.sha256,
      galerie_statut: m.galerie || 'NON_ENREGISTRE', commentaire: m.commentaire || ''
    };
  }
  function manifesteCsv(mission, medias) {
    var lignes = [COLONNES_CSV.join(';')];
    medias.forEach(function (m) { var o = ligneMedia(mission, m); lignes.push(COLONNES_CSV.map(function (c) { return csvCellule(o[c]); }).join(';')); });
    return '﻿' + lignes.join('\r\n') + '\r\n';
  }
  function manifesteJson(mission, medias, contexte) {
    return {
      format: 'AFLP-FIELD-PROOF/1',
      genere_le: (contexte && contexte.genereLe) || new Date().toISOString(),
      application: 'AFLP FIELD PROOF ' + VERSION,
      avertissement: 'Horodatage et position proviennent du téléphone de l\'agent. Ils ne constituent pas une preuve certifiée contre la falsification. L\'empreinte SHA-256 permet seulement de détecter une modification du fichier après sa création.',
      fuseau_affichage: 'Africa/Abidjan (GMT)',
      mission: {
        id: mission.id, cree_le: mission.creeLe, agent: mission.agent, agent_id: mission.agentId, role: mission.role,
        cluster: mission.cluster, village: mission.village, village_id: mission.villageId, activite: mission.activite,
        commentaire: mission.commentaire || ''
      },
      medias: medias.map(function (m) { return ligneMedia(mission, m); })
    };
  }

  /* -- 7. SHA-256 incrémental (FIPS 180-4) ---------------------------------
     Utilisé pour les fichiers trop lourds pour crypto.subtle.digest, qui
     exige le fichier entier en mémoire. Vérifié contre les vecteurs NIST. */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function Sha256() {
    this.h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    this.buf = new Uint8Array(64); this.lenBuf = 0; this.total = 0; this.w = new Int32Array(64);
  }
  Sha256.prototype._bloc = function (b, o) {
    var w = this.w, h = this.h, i, t1, t2;
    for (i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
    for (i = 16; i < 64; i++) {
      var x = w[i - 15], y = w[i - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var a = h[0], bb = h[1], c = h[2], dd = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & bb) ^ (a & c) ^ (bb & c);
      t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + dd) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  };
  Sha256.prototype.update = function (data) {
    var i = 0, n = data.length;
    this.total += n;
    if (this.lenBuf) {
      while (i < n && this.lenBuf < 64) this.buf[this.lenBuf++] = data[i++];
      if (this.lenBuf === 64) { this._bloc(this.buf, 0); this.lenBuf = 0; }
    }
    for (; i + 64 <= n; i += 64) this._bloc(data, i);
    while (i < n) this.buf[this.lenBuf++] = data[i++];
    return this;
  };
  Sha256.prototype.hex = function () {
    var bits = this.total * 8;
    var pad = new Uint8Array(((this.lenBuf < 56) ? 56 : 120) - this.lenBuf + 8);
    pad[0] = 0x80;
    var hi = Math.floor(bits / 0x100000000), lo = bits >>> 0, L = pad.length;
    pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi;
    pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
    var total = this.total; this.update(pad); this.total = total;
    return this.h.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  };
  function sha256Hex(bytes) { return new Sha256().update(bytes).hex(); }

  /* -- 8. CRC-32 (ZIP) ------------------------------------------------------ */
  var TABLE_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(octets, precedent) {
    var c = (precedent == null ? 0 : precedent) ^ 0xFFFFFFFF;
    for (var i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* -- 9. ZIP « stocké » ----------------------------------------------------
     Les photos (JPEG) et vidéos sont déjà compressées : les recompresser ne
     gagne presque rien et coûte batterie et mémoire. Format ZIP standard
     (PKWARE APPNOTE), noms UTF-8 (bit 11). Limite : 4 Go par archive (pas
     de ZIP64) — fp-app.js découpe l'export en lots bien en deçà. */
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  }
  function dosHeureDate(x) {
    var t = d(x);
    var heure = (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | (Math.floor(t.getUTCSeconds() / 2));
    var date = ((t.getUTCFullYear() - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate();
    return { heure: heure, date: date };
  }
  function ecr16(v, o, x) { v.setUint16(o, x, true); }
  function ecr32(v, o, x) { v.setUint32(o, x >>> 0, true); }
  function zipEnteteLocale(nom, taille, crc, quand) {
    var n = utf8(nom), b = new Uint8Array(30 + n.length), v = new DataView(b.buffer), t = dosHeureDate(quand);
    ecr32(v, 0, 0x04034b50); ecr16(v, 4, 20); ecr16(v, 6, 0x0800); ecr16(v, 8, 0);
    ecr16(v, 10, t.heure); ecr16(v, 12, t.date); ecr32(v, 14, crc); ecr32(v, 18, taille); ecr32(v, 22, taille);
    ecr16(v, 26, n.length); ecr16(v, 28, 0); b.set(n, 30);
    return b;
  }
  function zipEnteteCentrale(nom, taille, crc, quand, decalage) {
    var n = utf8(nom), b = new Uint8Array(46 + n.length), v = new DataView(b.buffer), t = dosHeureDate(quand);
    ecr32(v, 0, 0x02014b50); ecr16(v, 4, 20); ecr16(v, 6, 20); ecr16(v, 8, 0x0800); ecr16(v, 10, 0);
    ecr16(v, 12, t.heure); ecr16(v, 14, t.date); ecr32(v, 16, crc); ecr32(v, 20, taille); ecr32(v, 24, taille);
    ecr16(v, 28, n.length); ecr16(v, 30, 0); ecr16(v, 32, 0); ecr16(v, 34, 0); ecr16(v, 36, 0); ecr32(v, 38, 0);
    ecr32(v, 42, decalage); b.set(n, 46);
    return b;
  }
  function zipFin(nbEntrees, tailleCentrale, decalageCentrale) {
    var b = new Uint8Array(22), v = new DataView(b.buffer);
    ecr32(v, 0, 0x06054b50); ecr16(v, 4, 0); ecr16(v, 6, 0); ecr16(v, 8, nbEntrees); ecr16(v, 10, nbEntrees);
    ecr32(v, 12, tailleCentrale); ecr32(v, 16, decalageCentrale); ecr16(v, 20, 0);
    return b;
  }
  /* Plan d'archive : à partir de [{nom, taille, crc, quand}] renvoie la liste
     ordonnée des segments (« octets » ou « fichier:index »). L'assemblage en
     Blob se fait côté navigateur sans copier les médias en mémoire. */
  function planZip(entrees) {
    var segs = [], centrales = [], decalage = 0;
    entrees.forEach(function (e, i) {
      var loc = zipEnteteLocale(e.nom, e.taille, e.crc, e.quand);
      segs.push({ octets: loc }); segs.push({ fichier: i });
      centrales.push(zipEnteteCentrale(e.nom, e.taille, e.crc, e.quand, decalage));
      decalage += loc.length + e.taille;
    });
    var tailleC = 0;
    centrales.forEach(function (c) { segs.push({ octets: c }); tailleC += c.length; });
    segs.push({ octets: zipFin(entrees.length, tailleC, decalage) });
    return { segments: segs, tailleTotale: decalage + tailleC + 22 };
  }
  /* Répartition en lots : aucun lot ne dépasse `max` octets (sauf un média
     seul plus gros, qui forme alors son propre lot). */
  function lots(entrees, max) {
    var res = [], cur = [], t = 0;
    entrees.forEach(function (e) {
      var poids = e.taille + 200;
      if (cur.length && t + poids > max) { res.push(cur); cur = []; t = 0; }
      cur.push(e); t += poids;
    });
    if (cur.length) res.push(cur);
    return res;
  }
  /* Lecture d'un ZIP stocké (vérification d'un dossier reçu). */
  function lireZip(octets) {
    var v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength), fin = -1;
    for (var i = octets.length - 22; i >= Math.max(0, octets.length - 65557); i--) { if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; } }
    if (fin < 0) throw new Error('Archive ZIP illisible (fin de répertoire introuvable).');
    var nb = v.getUint16(fin + 10, true), pos = v.getUint32(fin + 16, true), res = [];
    var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
    for (var k = 0; k < nb; k++) {
      if (v.getUint32(pos, true) !== 0x02014b50) throw new Error('Répertoire ZIP corrompu.');
      var methode = v.getUint16(pos + 10, true), crc = v.getUint32(pos + 16, true), tc = v.getUint32(pos + 20, true);
      var ln = v.getUint16(pos + 28, true), lx = v.getUint16(pos + 30, true), lc = v.getUint16(pos + 32, true), off = v.getUint32(pos + 42, true);
      var nomO = octets.subarray(pos + 46, pos + 46 + ln);
      var nom = dec ? dec.decode(nomO) : Buffer.from(nomO).toString('utf8');
      var lnl = v.getUint16(off + 26, true), lxl = v.getUint16(off + 28, true), deb = off + 30 + lnl + lxl;
      res.push({ nom: nom, methode: methode, crc: crc, taille: tc, debut: deb });
      pos += 46 + ln + lx + lc;
    }
    return res;
  }

  /* -- 10. EXIF minimal -----------------------------------------------------
     Le canvas produit un JPEG sans métadonnées. On réinsère un segment APP1
     Exif (TIFF little-endian) : date de prise de vue, description, auteur,
     logiciel et, si disponible, la position GPS. Les galeries Android/iOS
     l'affichent ; WhatsApp le supprime à l'envoi « en photo ». */
  function asciiZ(s) { var u = utf8(String(s || '').replace(/[^\x20-\x7E]/g, '?')); var b = new Uint8Array(u.length + 1); b.set(u); return b; }
  function exifDate(x) { var t = d(x); return t.getUTCFullYear() + ':' + p2(t.getUTCMonth() + 1) + ':' + p2(t.getUTCDate()) + ' ' + p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes()) + ':' + p2(t.getUTCSeconds()); }
  function rationnels(vals) {
    var b = new Uint8Array(8 * vals.length), v = new DataView(b.buffer);
    vals.forEach(function (r, i) { v.setUint32(8 * i, r[0], true); v.setUint32(8 * i + 4, r[1], true); });
    return b;
  }
  function dms(deg) {
    var a = Math.abs(deg), dd = Math.floor(a), mf = (a - dd) * 60, mm = Math.floor(mf), ss = Math.round((mf - mm) * 60 * 10000);
    if (ss >= 600000) { ss -= 600000; mm += 1; }
    if (mm >= 60) { mm -= 60; dd += 1; }
    return [[dd, 1], [mm, 1], [ss, 10000]];
  }
  /* Construit un IFD. entrees : [{tag, type, count, data(Uint8Array) | valeur}] ; base = décalage TIFF de l'IFD. */
  function construireIfd(entrees, base, suivant) {
    entrees.sort(function (a, b) { return a.tag - b.tag; });
    var tailleTable = 2 + 12 * entrees.length + 4, extra = [], decExtra = base + tailleTable;
    var table = new Uint8Array(tailleTable), v = new DataView(table.buffer);
    v.setUint16(0, entrees.length, true);
    entrees.forEach(function (e, i) {
      var o = 2 + 12 * i;
      v.setUint16(o, e.tag, true); v.setUint16(o + 2, e.type, true); v.setUint32(o + 4, e.count, true);
      if (e.data && e.data.length > 4) {
        v.setUint32(o + 8, decExtra, true); extra.push(e.data); decExtra += e.data.length + (e.data.length % 2);
        if (e.data.length % 2) extra.push(new Uint8Array(1));
      } else if (e.data) { table.set(e.data, o + 8); }
      else if (e.type === 3) v.setUint16(o + 8, e.valeur, true);
      else v.setUint32(o + 8, e.valeur, true);
    });
    v.setUint32(tailleTable - 4, suivant || 0, true);
    var tot = tailleTable; extra.forEach(function (x) { tot += x.length; });
    var res = new Uint8Array(tot); res.set(table, 0); var p = tailleTable;
    extra.forEach(function (x) { res.set(x, p); p += x.length; });
    return res;
  }
  function segmentExif(meta) {
    var desc = asciiZ(meta.description), artiste = asciiZ(meta.artiste), logiciel = asciiZ(meta.logiciel || ('AFLP FIELD PROOF ' + VERSION));
    var dt = asciiZ(exifDate(meta.date));
    /* Passe 1 : tailles (les décalages dépendent des tailles des IFD précédents). */
    function ifd0(decExif, decGps) {
      var e = [
        { tag: 0x010E, type: 2, count: desc.length, data: desc },
        { tag: 0x0131, type: 2, count: logiciel.length, data: logiciel },
        { tag: 0x0132, type: 2, count: dt.length, data: dt },
        { tag: 0x013B, type: 2, count: artiste.length, data: artiste },
        { tag: 0x8769, type: 4, count: 1, valeur: decExif }
      ];
      if (decGps != null) e.push({ tag: 0x8825, type: 4, count: 1, valeur: decGps });
      return e;
    }
    function exifIfd() {
      return [
        { tag: 0x9000, type: 7, count: 4, data: utf8('0232') },
        { tag: 0x9003, type: 2, count: dt.length, data: dt },
        { tag: 0x9004, type: 2, count: dt.length, data: dt },
        { tag: 0x9010, type: 2, count: 7, data: asciiZ('+00:00') },
        { tag: 0x9011, type: 2, count: 7, data: asciiZ('+00:00') }
      ];
    }
    function gpsIfd() {
      var g = meta.gps, t = d(meta.date);
      var e = [
        { tag: 0x0000, type: 1, count: 4, data: new Uint8Array([2, 3, 0, 0]) },
        { tag: 0x0001, type: 2, count: 2, data: asciiZ(g.lat >= 0 ? 'N' : 'S') },
        { tag: 0x0002, type: 5, count: 3, data: rationnels(dms(g.lat)) },
        { tag: 0x0003, type: 2, count: 2, data: asciiZ(g.lon >= 0 ? 'E' : 'W') },
        { tag: 0x0004, type: 5, count: 3, data: rationnels(dms(g.lon)) },
        { tag: 0x0007, type: 5, count: 3, data: rationnels([[t.getUTCHours(), 1], [t.getUTCMinutes(), 1], [t.getUTCSeconds(), 1]]) },
        { tag: 0x001D, type: 2, count: 11, data: asciiZ(t.getUTCFullYear() + ':' + p2(t.getUTCMonth() + 1) + ':' + p2(t.getUTCDate())) }
      ];
      if (typeof g.precision === 'number') e.push({ tag: 0x001F, type: 5, count: 1, data: rationnels([[Math.max(0, Math.round(g.precision * 100)), 100]]) });
      return e;
    }
    var aGps = meta.gps && typeof meta.gps.lat === 'number';
    var t0 = construireIfd(ifd0(0, aGps ? 0 : null), 8, 0).length;
    var t1 = construireIfd(exifIfd(), 8 + t0, 0).length;
    var b0 = construireIfd(ifd0(8 + t0, aGps ? 8 + t0 + t1 : null), 8, 0);
    var b1 = construireIfd(exifIfd(), 8 + t0, 0);
    var b2 = aGps ? construireIfd(gpsIfd(), 8 + t0 + t1, 0) : new Uint8Array(0);
    var tiff = new Uint8Array(8 + b0.length + b1.length + b2.length), tv = new DataView(tiff.buffer);
    tiff[0] = 0x49; tiff[1] = 0x49; tv.setUint16(2, 42, true); tv.setUint32(4, 8, true);
    tiff.set(b0, 8); tiff.set(b1, 8 + b0.length); tiff.set(b2, 8 + b0.length + b1.length);
    var entete = utf8('Exif\0\0');
    var lg = 2 + entete.length + tiff.length;
    if (lg > 65535) throw new Error('Segment EXIF trop long.');
    var seg = new Uint8Array(2 + lg);
    seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = lg >> 8; seg[3] = lg & 0xFF;
    seg.set(entete, 4); seg.set(tiff, 4 + entete.length);
    return seg;
  }
  /* Insère le segment juste après SOI, en retirant tout APP1 Exif existant. */
  function insererExif(jpeg, seg) {
    if (jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) throw new Error('Fichier JPEG invalide.');
    var morceaux = [jpeg.subarray(0, 2), seg], i = 2;
    while (i + 4 <= jpeg.length && jpeg[i] === 0xFF) {
      var marq = jpeg[i + 1];
      if (marq === 0xDA) break; // début des données d'image
      var lg = (jpeg[i + 2] << 8) | jpeg[i + 3];
      var estExif = marq === 0xE1 && jpeg[i + 4] === 0x45 && jpeg[i + 5] === 0x78 && jpeg[i + 6] === 0x69 && jpeg[i + 7] === 0x66;
      if (!estExif) morceaux.push(jpeg.subarray(i, i + 2 + lg));
      i += 2 + lg;
    }
    morceaux.push(jpeg.subarray(i));
    var tot = 0; morceaux.forEach(function (m) { tot += m.length; });
    var res = new Uint8Array(tot), p = 0;
    morceaux.forEach(function (m) { res.set(m, p); p += m.length; });
    return res;
  }

  /* -- 11. Estimations et contrôles ---------------------------------------- */
  function tailleVideoEstimee(qualite, secondes) {
    var q = QUALITES[qualite] || QUALITES.STANDARD;
    return Math.round((q.debitVideo + q.debitAudio) / 8 * secondes * 1.05);
  }
  function octetsTexte(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' o';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' Ko';
    if (n < 1073741824) return (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
    return (n / 1073741824).toFixed(2).replace('.', ',') + ' Go';
  }
  /* Comparaison d'un dossier reçu avec son manifeste. calc : { nomFichier: sha256 } */
  function verifierDossier(manifeste, calc) {
    var lignes = (manifeste && manifeste.medias) || [], vus = {};
    var res = lignes.map(function (l) {
      vus[l.fichier] = true;
      var h = calc[l.fichier];
      var statut = h == null ? 'ABSENT' : (String(h).toLowerCase() === String(l.sha256).toLowerCase() ? 'CONFORME' : 'MODIFIE');
      return { fichier: l.fichier, media_id: l.media_id, type: l.type, attendu: l.sha256, calcule: h || null, statut: statut };
    });
    Object.keys(calc).forEach(function (n) { if (!vus[n]) res.push({ fichier: n, media_id: '', type: '', attendu: null, calcule: calc[n], statut: 'HORS_MANIFESTE' }); });
    return res;
  }

  return {
    VERSION: VERSION, ACTIVITES: ACTIVITES, QUALITES: QUALITES, DUREE_RECOMMANDEE_S: DUREE_RECOMMANDEE_S,
    SEUIL_PRECISION_M: SEUIL_PRECISION_M, AGE_MAX_POSITION_MS: AGE_MAX_POSITION_MS,
    dateAbj: dateAbj, heureAbj: heureAbj, dateHeureAbj: dateHeureAbj, compactAbj: compactAbj, duree: duree,
    idMission: idMission, idMedia: idMedia,
    statutGps: statutGps, coordonnees: coordonnees, precisionTexte: precisionTexte, lienCarte: lienCarte,
    lignesBandeau: lignesBandeau, slug: slug, extension: extension, nomFichier: nomFichier,
    COLONNES_CSV: COLONNES_CSV, manifesteCsv: manifesteCsv, manifesteJson: manifesteJson,
    Sha256: Sha256, sha256Hex: sha256Hex, crc32: crc32,
    planZip: planZip, lots: lots, lireZip: lireZip, zipEnteteLocale: zipEnteteLocale,
    segmentExif: segmentExif, insererExif: insererExif,
    tailleVideoEstimee: tailleVideoEstimee, octetsTexte: octetsTexte, verifierDossier: verifierDossier
  };
});
