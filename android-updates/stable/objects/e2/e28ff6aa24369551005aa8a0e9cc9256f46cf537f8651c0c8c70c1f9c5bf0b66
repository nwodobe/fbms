/* ============================================================================
   AFLP FIELD PROOF — caméra, GPS, bandeau incrusté (fieldproof/fp-capture.js)
   ----------------------------------------------------------------------------
   Principe retenu (voir docs/aflp-field-proof/ARCHITECTURE.md) :
     · la caméra est ouverte DANS l'application (getUserMedia) : aucune image
       ne peut provenir de la galerie ;
     · le bandeau AFLP est AJOUTÉ SOUS l'image (le cadre est agrandi) : il
       n'en masque aucune partie, et il fait partie des pixels du fichier ;
     · photo : canvas → JPEG + segment EXIF (date, auteur, GPS) ;
     · vidéo : chaque image de la caméra est redessinée sur un canvas avec le
       bandeau (et le compteur de durée), puis réencodée par MediaRecorder
       avec la piste audio. Le bandeau est donc dans le flux vidéo lui-même,
       visible dans n'importe quel lecteur, galerie ou WhatsApp.
   Le GPS n'est lu QUE pendant que l'écran de capture est ouvert, et n'est
   jamais transmis : aucune localisation permanente.
   ========================================================================== */
(function (global) {
  'use strict';
  var C = global.FP_CORE, S = global.FP_STORE;
  var nav = global.navigator || {};

  /* -- 1. Messages d'erreur caméra / micro compréhensibles ----------------- */
  function messageMedia(e, quoi) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Accès ' + quoi + ' refusé. Autorisez-le dans les réglages du navigateur (icône à gauche de l\'adresse, ou Réglages > Safari > Appareil photo / Micro sur iPhone), puis réessayez.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Aucun ' + (quoi === 'à la caméra' ? 'appareil photo' : 'micro') + ' disponible sur ce téléphone.';
    if (n === 'NotReadableError' || n === 'AbortError') return 'La caméra est utilisée par une autre application. Fermez-la puis réessayez.';
    return 'Ouverture ' + quoi + ' impossible : ' + (e && e.message ? e.message : 'erreur inconnue') + '.';
  }
  function cameraDisponible() { return !!(nav.mediaDevices && nav.mediaDevices.getUserMedia); }

  /* Ouvre la caméra. mode PHOTO : image seule. mode VIDEO : image + son ;
     si le micro est refusé, la caméra s'ouvre quand même et la vidéo sera
     muette — l'appelant l'affiche clairement. */
  function ouvrirCamera(opts) {
    opts = opts || {};
    if (!cameraDisponible()) return Promise.reject(new Error('Ce navigateur ne donne pas accès à la caméra. Utilisez Chrome (Android) ou Safari (iPhone) à jour, via l\'adresse https de FBMS.'));
    var q = C.QUALITES[opts.qualite] || C.QUALITES.STANDARD;
    var video = { facingMode: { ideal: opts.face || 'environment' }, width: { ideal: opts.mode === 'PHOTO' ? 1920 : q.largeur }, height: { ideal: opts.mode === 'PHOTO' ? 1080 : q.hauteur }, frameRate: { ideal: 30, max: 30 } };
    if (opts.mode !== 'VIDEO') {
      return nav.mediaDevices.getUserMedia({ video: video, audio: false })
        .then(function (s) { return { flux: s, micro: false, alerteMicro: null }; })
        .catch(function (e) { throw new Error(messageMedia(e, 'à la caméra')); });
    }
    return nav.mediaDevices.getUserMedia({ video: video, audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (s) { return { flux: s, micro: s.getAudioTracks().length > 0, alerteMicro: null }; })
      .catch(function (e) {
        /* Échec global : on retente sans micro pour distinguer les deux refus. */
        return nav.mediaDevices.getUserMedia({ video: video, audio: false })
          .then(function (s) { return { flux: s, micro: false, alerteMicro: 'Micro indisponible (' + messageMedia(e, 'au micro') + ') — la vidéo sera MUETTE.' }; })
          .catch(function (e2) { throw new Error(messageMedia(e2, 'à la caméra')); });
      });
  }
  function fermerCamera(flux) { if (flux) flux.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); }

  /* -- 2. GPS : actif seulement pendant la capture ------------------------- */
  function Localisateur() { this.dernier = null; this.erreur = null; this.id = null; this.abonnes = []; }
  Localisateur.prototype.demarrer = function () {
    var self = this;
    if (!nav.geolocation) { this.erreur = 'Géolocalisation non disponible sur ce navigateur.'; this._notifier(); return; }
    if (this.id != null) return;
    this.id = nav.geolocation.watchPosition(function (p) {
      self.erreur = null;
      self.dernier = { lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy, altitude: p.coords.altitude, horodatage: new Date(p.timestamp || Date.now()).toISOString() };
      self._notifier();
    }, function (e) {
      self.erreur = e.code === 1 ? 'Localisation refusée : les médias porteront la mention LOCALISATION NON VÉRIFIÉE.'
        : e.code === 3 ? 'GPS lent à répondre (ciel couvert, intérieur ?). Vous pouvez capturer quand même.'
        : 'GPS indisponible : les médias porteront la mention LOCALISATION NON VÉRIFIÉE.';
      self._notifier();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  };
  Localisateur.prototype.arreter = function () { if (this.id != null && nav.geolocation) nav.geolocation.clearWatch(this.id); this.id = null; };
  Localisateur.prototype.abonner = function (f) { this.abonnes.push(f); f(this); };
  Localisateur.prototype._notifier = function () { var s = this; this.abonnes.forEach(function (f) { try { f(s); } catch (e) {} }); };
  /* Position utilisable maintenant (null si absente ou trop ancienne : le
     statut ANCIEN est calculé par FP_CORE à partir de l'horodatage). */
  Localisateur.prototype.position = function () { return this.dernier ? Object.assign({}, this.dernier) : null; };
  /* Une lecture ponctuelle (fin de vidéo), bornée dans le temps. */
  function positionPonctuelle(delaiMs) {
    return new Promise(function (ok) {
      if (!nav.geolocation) return ok(null);
      var fini = false, t = setTimeout(function () { if (!fini) { fini = true; ok(null); } }, delaiMs || 6000);
      nav.geolocation.getCurrentPosition(function (p) {
        if (fini) return; fini = true; clearTimeout(t);
        ok({ lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy, horodatage: new Date(p.timestamp || Date.now()).toISOString() });
      }, function () { if (!fini) { fini = true; clearTimeout(t); ok(null); } }, { enableHighAccuracy: true, maximumAge: 15000, timeout: delaiMs || 6000 });
    });
  }

  /* -- 3. Dessin du bandeau ----------------------------------------------- */
  var COUL = { fond: '#053B23', fond2: '#0A4A2C', accent: '#F0A500', texte: '#FFFFFF', doux: '#BFE0CB', alerte: '#FFD27A' };
  /* Hauteur du bandeau pour une largeur d'image donnée : 5 lignes lisibles
     sur un téléphone (≥ 12 px à l'écran) sans écraser la scène. */
  function hauteurBandeau(largeur) { var t = taillePolice(largeur); return Math.round(t * 1.42 * 6 + t * 1.6); }
  function taillePolice(largeur) { return Math.max(11, Math.round(largeur / 62)); }
  function dessinerBandeau(ctx, x, y, largeur, lignes, statutCode, alerteLocalite) {
    var t = taillePolice(largeur), h = hauteurBandeau(largeur), marge = Math.round(t * 0.9);
    var g = ctx.createLinearGradient(x, y, x + largeur, y);
    g.addColorStop(0, COUL.fond); g.addColorStop(1, COUL.fond2);
    ctx.fillStyle = g; ctx.fillRect(x, y, largeur, h);
    ctx.fillStyle = COUL.accent; ctx.fillRect(x, y, largeur, Math.max(2, Math.round(t / 5)));
    ctx.fillRect(x, y, Math.max(4, Math.round(t / 2.6)), h);
    ctx.textBaseline = 'middle';
    var pas = t * 1.42, y0 = y + t * 0.95 + pas / 2;
    lignes.forEach(function (l, i) {
      var gras = i === 0, alerte = (i === 4 && statutCode && statutCode !== 'OK') || (i === 5 && alerteLocalite);
      ctx.font = (gras ? '700 ' : '500 ') + (gras ? Math.round(t * 1.05) : t) + 'px "IBM Plex Sans","Segoe UI",Roboto,Arial,sans-serif';
      ctx.fillStyle = gras ? COUL.texte : (alerte ? COUL.alerte : (i === 3 || i === 5 ? COUL.texte : COUL.doux));
      ajuster(ctx, l, x + marge + Math.round(t / 2.6), y0 + i * pas, largeur - 2 * marge - Math.round(t / 2.6));
    });
    return h;
  }
  /* Réduit le texte s'il dépasse la largeur (jamais tronqué en silence : la
     police diminue jusqu'à 70 %, puis le texte est coupé avec « … »). */
  function ajuster(ctx, texte, x, y, max) {
    var w = ctx.measureText(texte).width;
    if (w <= max) return ctx.fillText(texte, x, y);
    var base = ctx.font, m = /(\d+)px/.exec(base), px = m ? +m[1] : 12, mini = Math.ceil(px * 0.7);
    for (var p = px - 1; p >= mini; p--) { ctx.font = base.replace(/\d+px/, p + 'px'); if (ctx.measureText(texte).width <= max) return ctx.fillText(texte, x, y); }
    var s = texte; while (s.length > 4 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    ctx.fillText(s + '…', x, y);
  }

  /* -- 4. Photo ------------------------------------------------------------ */
  function toBlob(canvas, type, q) {
    return new Promise(function (ok, ko) {
      if (canvas.toBlob) return canvas.toBlob(function (b) { b ? ok(b) : ko(new Error('Création de l\'image impossible (mémoire ?).')); }, type, q);
      try { var u = canvas.toDataURL(type, q), bin = atob(u.split(',')[1]), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); ok(new Blob([a], { type: type })); } catch (e) { ko(e); }
    });
  }
  /* source : élément <video> en lecture ou <img>/ImageBitmap ; meta : champs
     du bandeau (FP_CORE.lignesBandeau). Renvoie { blob, largeur, hauteur }. */
  function composerPhoto(source, meta) {
    var sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return Promise.reject(new Error('Image de la caméra pas encore disponible. Patientez une seconde.'));
    var hb = hauteurBandeau(sw), cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh + hb;
    var ctx = cv.getContext('2d');
    ctx.drawImage(source, 0, 0, sw, sh);
    var st = C.statutGps(meta.gpsDebut, meta.debut);
    dessinerBandeau(ctx, 0, sh, sw, C.lignesBandeau(meta, meta.debut), st.code, C.localiteAlerte(meta.localite));
    return toBlob(cv, 'image/jpeg', 0.9).then(function (b) {
      return S.lireTranche(b, 0, b.size).then(function (buf) {
        var exif = C.segmentExif({
          date: meta.debut, artiste: meta.agent,
          description: meta.idMedia + ' | ' + meta.activite + ' | ' + meta.cluster + ' / ' + meta.village + ' | ' + st.libelle + (meta.localite ? ' | ' + meta.localite.texte : ''),
          gps: meta.gpsDebut && typeof meta.gpsDebut.lat === 'number' ? meta.gpsDebut : null
        });
        var avec = C.insererExif(new Uint8Array(buf), exif);
        cv.width = cv.height = 0; // libère la mémoire du canvas (important sur iOS)
        return { blob: new Blob([avec], { type: 'image/jpeg' }), largeur: sw, hauteur: sh + hb };
      });
    });
  }

  /* -- 5. Vidéo ------------------------------------------------------------ */
  /* Ordre de préférence : H.264 (lu partout, accepté par WhatsApp et l'app
     Photos d'iPhone) avant VP9/VP8. Le conteneur seul ne suffit pas : Chrome
     peut produire du « video/mp4 » contenant du VP9. Le format réellement
     obtenu (mr.mimeType) est inscrit au registre et au manifeste. */
  var TYPES_AVEC_SON = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=avc1.42E01E,opus', 'video/mp4', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  var TYPES_SANS_SON = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'];
  function typeVideo(avecSon) {
    if (!global.MediaRecorder) return null;
    var l = avecSon === false ? TYPES_SANS_SON : TYPES_AVEC_SON;
    for (var i = 0; i < l.length; i++) { try { if (MediaRecorder.isTypeSupported(l[i])) return l[i]; } catch (e) {} }
    return '';
  }
  function videoDisponible() {
    var cv = global.HTMLCanvasElement && global.HTMLCanvasElement.prototype;
    return !!(global.MediaRecorder && cv && (cv.captureStream || cv.mozCaptureStream) && cameraDisponible());
  }

  /* Enregistreur : cfg = { videoEl, flux, micro, meta, qualite, surEtat(etat), surArret(info) } */
  function Enregistreur(cfg) { this.cfg = cfg; this.etat = 'PRET'; this.rang = 0; this.ecritures = Promise.resolve(); this.raisonArret = null; this.erreurStockage = null; }
  Enregistreur.prototype.demarrer = function () {
    var self = this, cfg = this.cfg, v = cfg.videoEl;
    var vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return Promise.reject(new Error('Image de la caméra pas encore disponible. Patientez une seconde.'));
    /* Dimensions paires (exigence des encodeurs H.264 / VP8). */
    var hb = hauteurBandeau(vw); hb += hb % 2;
    var W = vw - (vw % 2), H = vh - (vh % 2);
    this.W = W; this.H = H + hb; this.hb = hb; this.vh = H;
    var cv = this.canvas = document.createElement('canvas'); cv.width = W; cv.height = H + hb;
    var ctx = this.ctx = cv.getContext('2d', { alpha: false });
    /* Bandeau pré-rendu, redessiné une fois par seconde (compteur). */
    var bc = this.bandeau = document.createElement('canvas'); bc.width = W; bc.height = hb;
    this.bctx = bc.getContext('2d');
    this.debut = new Date();
    cfg.meta.debut = this.debut.toISOString();
    this._majBandeau(0);
    this._dessiner();
    var cap = (cv.captureStream || cv.mozCaptureStream).call(cv, 30);
    if (cfg.micro) cfg.flux.getAudioTracks().forEach(function (t) { cap.addTrack(t); });
    this.mime = typeVideo(!!cfg.micro);
    var q = C.QUALITES[cfg.qualite] || C.QUALITES.STANDARD, o = { videoBitsPerSecond: q.debitVideo, audioBitsPerSecond: q.debitAudio,
      /* Image clé chaque seconde : sans elle, Chrome ne livre aucun fragment MP4
         avant l'arrêt quand la source est un canvas (constaté en recette) — la
         protection « au fil de l'eau » serait alors inopérante. Option ignorée
         sans erreur par les navigateurs qui ne la connaissent pas. */
      videoKeyFrameIntervalDuration: 1000 };
    if (this.mime) o.mimeType = this.mime;
    var mr = this.mr = new MediaRecorder(cap, o);
    this.mime = mr.mimeType || this.mime || 'video/webm';
    mr.ondataavailable = function (ev) {
      if (!ev.data || !ev.data.size) return;
      var r = self.rang++;
      /* Écriture AU FIL DE L'EAU : si le stockage sature, ce qui est déjà écrit
         reste récupérable et l'enregistrement s'arrête EXPLICITEMENT. */
      self.ecritures = self.ecritures.then(function () { return S.ajouterMorceau(cfg.meta.idMedia, r, ev.data); }).catch(function (e) {
        self.erreurStockage = S.estQuota(e) ? 'Stockage du téléphone plein : enregistrement arrêté. La partie déjà filmée est conservée.' : 'Écriture locale impossible : ' + (e && e.message || e);
        if (self.etat === 'ENREGISTREMENT') self.arreter('STOCKAGE');
      });
    };
    mr.onerror = function (ev) { self.raisonArret = 'ERREUR'; self.erreurStockage = 'Erreur de l\'enregistreur : ' + (ev && ev.error && ev.error.message || 'inconnue'); if (self.etat === 'ENREGISTREMENT') self.arreter('ERREUR'); };
    this.arretPromesse = new Promise(function (ok) { mr.onstop = function () { ok(); }; });
    /* Fin de piste caméra (autre application, appel entrant…) : arrêt propre. */
    cfg.flux.getVideoTracks().forEach(function (t) { t.onended = function () { if (self.etat === 'ENREGISTREMENT') self.arreter('CAMERA'); }; });
    this._visibilite = function () { if (document.visibilityState === 'hidden' && self.etat === 'ENREGISTREMENT') self.arreter('ARRIERE_PLAN'); };
    document.addEventListener('visibilitychange', this._visibilite);
    mr.start(1000);
    this.etat = 'ENREGISTREMENT';
    this._surveillerStockage();
    this._boucle();
    if (cfg.surEtat) cfg.surEtat(this);
    return Promise.resolve(this);
  };
  Enregistreur.prototype.dureeMs = function () { return this.debut ? (this.fin || new Date()) - this.debut : 0; };
  Enregistreur.prototype._majBandeau = function (ms) {
    var m = Object.assign({}, this.cfg.meta, { type: 'VIDEO', dureeMs: ms });
    this.bctx.clearRect(0, 0, this.W, this.hb);
    dessinerBandeau(this.bctx, 0, 0, this.W, C.lignesBandeau(m), C.statutGps(m.gpsDebut, m.debut).code, C.localiteAlerte(m.localite));
    this.secondeAffichee = Math.floor(ms / 1000);
  };
  Enregistreur.prototype._dessiner = function () {
    var v = this.cfg.videoEl, ctx = this.ctx, W = this.W, H = this.vh;
    var sw = v.videoWidth, sh = v.videoHeight;
    if (sw && sh) {
      if (sw === W && Math.abs(sh - H) <= 1) ctx.drawImage(v, 0, 0, W, H);
      else {
        /* Le téléphone a pivoté pendant l'enregistrement : image entière,
           centrée, sans déformation (bandes noires). */
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        var k = Math.min(W / sw, H / sh), dw = sw * k, dh = sh * k;
        ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
    }
    var ms = this.dureeMs();
    if (Math.floor(ms / 1000) !== this.secondeAffichee) this._majBandeau(ms);
    ctx.drawImage(this.bandeau, 0, H);
  };
  Enregistreur.prototype._boucle = function () {
    var self = this, v = this.cfg.videoEl;
    if (this.etat !== 'ENREGISTREMENT') return;
    this._dessiner();
    if (this.cfg.surTic) this.cfg.surTic(this);
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(function () { self._boucle(); });
    else setTimeout(function () { self._boucle(); }, 33);
  };
  Enregistreur.prototype._surveillerStockage = function () {
    var self = this;
    this._minuterie = setInterval(function () {
      S.espace().then(function (e) {
        if (!e || !e.quota || self.etat !== 'ENREGISTREMENT') return;
        if (e.libre < 25 * 1048576) {
          self.erreurStockage = 'Espace de stockage presque épuisé (' + C.octetsTexte(e.libre) + ' restants) : enregistrement arrêté pour protéger la séquence déjà filmée.';
          self.arreter('STOCKAGE');
        }
      });
    }, 4000);
  };
  /* Arrêt : finalise le fichier à partir des morceaux ÉCRITS (et relus). */
  Enregistreur.prototype.arreter = function (raison) {
    var self = this;
    if (this.etat !== 'ENREGISTREMENT') return this.finale || Promise.reject(new Error('Aucun enregistrement en cours.'));
    this.etat = 'ARRET'; this.raisonArret = this.raisonArret || raison || 'AGENT'; this.fin = new Date();
    clearInterval(this._minuterie);
    document.removeEventListener('visibilitychange', this._visibilite);
    this._majBandeau(this.dureeMs()); this._dessiner();
    try { if (this.mr.state !== 'inactive') this.mr.stop(); } catch (e) {}
    var gpsFin = positionPonctuelle(6000);
    this.finale = this.arretPromesse.then(function () { return self.ecritures; }).then(function () { return S.morceaux(self.cfg.meta.idMedia); })
      .then(function (ms) {
        if (!ms.length) throw new Error(self.erreurStockage || 'Aucune image enregistrée.');
        var blob = new Blob(ms.map(function (m) { return m.blob; }), { type: self.mime.split(';')[0] });
        self.canvas.width = self.canvas.height = 0;
        return gpsFin.then(function (gf) {
          var info = { blob: blob, mime: self.mime, largeur: self.W, hauteur: self.H, debut: self.debut.toISOString(), fin: self.fin.toISOString(), dureeMs: self.dureeMs(), gpsFin: gf, raison: self.raisonArret, alerte: self.erreurStockage, morceaux: ms.length };
          if (self.cfg.surArret) self.cfg.surArret(info);
          return info;
        });
      });
    if (this.cfg.surEtat) this.cfg.surEtat(this);
    return this.finale;
  };
  var RAISONS = {
    AGENT: null,
    STOCKAGE: 'Arrêt automatique : stockage insuffisant. La séquence filmée jusque-là est conservée.',
    ARRIERE_PLAN: 'Enregistrement arrêté car l\'application est passée en arrière-plan (écran verrouillé ou autre application). La séquence filmée jusque-là est conservée.',
    CAMERA: 'La caméra a été coupée par le téléphone (appel, autre application). La séquence filmée jusque-là est conservée.',
    ERREUR: 'L\'enregistreur a rencontré une erreur. La séquence filmée jusque-là est conservée si elle existe.'
  };

  global.FP_CAPTURE = {
    cameraDisponible: cameraDisponible, videoDisponible: videoDisponible, typeVideo: typeVideo,
    ouvrirCamera: ouvrirCamera, fermerCamera: fermerCamera,
    Localisateur: Localisateur, positionPonctuelle: positionPonctuelle,
    hauteurBandeau: hauteurBandeau, dessinerBandeau: dessinerBandeau, composerPhoto: composerPhoto,
    Enregistreur: Enregistreur, RAISONS: RAISONS
  };
})(window);
