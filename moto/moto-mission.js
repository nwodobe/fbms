/* ============================================================================
   AFLP FLEET — journal de mission et kilométrage contrôlé par photo
   (moto/moto-mission.js · migration 8)
   ----------------------------------------------------------------------------
   Terrain (moins de 30 secondes, hors connexion) :
     ouvrir → viser le compteur → photographier → confirmer le chiffre → valider.
     · caméra d'AFLP FIELD PROOF ouverte DANS l'application (getUserMedia) :
       aucune image ne peut venir de la galerie ;
     · LA MACHINE PROPOSE, L'AGENT CONFIRME : lecture gratuite sur le téléphone
       (moto-ocr.js), origine conservée (LU_CONFIRME, LU_CORRIGE, SAISI) ;
     · photo partagée compressée (≤ 60 Ko visés) : bande du compteur nette +
       vue du tableau de bord + bandeau date, heure, moto, agent, localité.
       AUCUNE coordonnée GPS dans l'image : la position part dans des champs
       séparés, lisibles par le seul Chef de zone, coordinateur, ABM et BM ;
     · empreinte SHA-256 calculée à la capture (une photo ne sert qu'une fois).
   Suivi : missions, kilomètres de mission et hors mission, écarts à vérifier
   (jamais une sanction automatique), coût par km de mission, export Excel.
   Le serveur décide de tout : ce module ne fait qu'afficher et mettre en file.
   ========================================================================== */
(function (g) {
  'use strict';
  g.MOTO_MISSION = function (I) {
    var C = I.C, OFF = I.OFF, S = I.S, esc = I.esc, $ = I.$, $$ = I.$$, rpc = I.rpc, lire = I.lireTable, kpi = I.kpi, ND = C.ND;
    var FPC = g.FP_CAPTURE, FPK = g.FP_CORE, FPS = g.FP_STORE, OCR = g.MOTO_OCR;
    var OBJETS = [['ACHAT_COLLECTE', 'Achat et collecte'], ['SENSIBILISATION', 'Sensibilisation'], ['RECENSEMENT', 'Recensement'],
      ['SUPERVISION', 'Supervision'], ['LIVRAISON', 'Livraison'], ['GARAGE', 'Garage ou entretien'], ['CARBURANT', 'Carburant'],
      ['ADMINISTRATIF', 'Administratif'], ['AUTRE', 'Autre (préciser)']];
    var LIB_OBJET = {}; OBJETS.forEach(function (o) { LIB_OBJET[o[0]] = o[1]; });
    var LIB_ECART = { HORS_MISSION: 'Km hors mission', CONTINUITE: 'Continuité du compteur', VITESSE: 'Vitesse impossible', DISTANCE: 'Distance hors norme',
      HORLOGE: 'Horloge du téléphone', GPS_ABSENT: 'GPS absent', CLOTURE_TARDIVE: 'Clôture tardive',
      SAISIE_DIFFEREE_DEPART: 'Départ envoyé tardivement', SAISIE_DIFFEREE_ARRIVEE: 'Arrivée envoyée tardivement',
      ORDRE_RELEVES: 'Relevés reçus dans le désordre', EMPREINTE_DIFFERENTE: 'Photo modifiée ou remplacée', PHOTO_ATYPIQUE: 'Photo de taille inhabituelle', CHEVAUCHEMENT: 'Missions qui se chevauchent' };
    var LIB_ORIGINE = { LU_CONFIRME: 'Lu, confirmé', LU_CORRIGE: 'Lu, corrigé', SAISI: 'Saisi' };
    var LIB_STATUT = { OUVERTE: 'En cours', CLOTUREE: 'Clôturée', ANNULEE: 'Annulée' };
    var CIBLE_OCTETS = 60000;
    var etat = { mois: null, moto: '', agent: '', donnees: null };

    function km(v) { return v == null ? ND : C.km(v); }
    function moi() { return S.profil && S.profil.user_id; }
    function badgeStatut(s) { var t = { OUVERTE: 'warn', CLOTUREE: 'ok', ANNULEE: 'neutre' }[s] || 'neutre'; return '<span class="mm-badge mm-' + t + '">' + esc(LIB_STATUT[s] || s) + '</span>'; }
    function badgeOrigine(o) { if (!o) return ''; var t = { LU_CONFIRME: 'ok', LU_CORRIGE: 'warn', SAISI: 'neutre' }[o]; return '<span class="mm-badge mm-' + t + '">' + esc(LIB_ORIGINE[o]) + '</span>'; }
    function heureAbj(d) { return FPK ? FPK.dateHeureAbj(d) : new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' GMT'; }
    function moisCourant() { var d = new Date(); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-01'; }

    /* -- Villages (référentiel FIELD PROOF partagé, hors connexion) ---------- */
    function cleVillages() { return 'villages:v2:' + (moi() || 'inconnu'); }
    async function villages() {
      var l = [];
      try { var r = FPS && await FPS.refLire(cleVillages()); if (r && r.valeur) l = r.valeur; } catch (e) {}
      if (!l.length && S.sb && navigator.onLine !== false) {
        try {
          var res = await S.sb.from('villages').select('id,village,cluster,gps_lat,gps_lng,s1:data->s1').eq('deleted', false);
          if (!res.error) {
            l = (res.data || []).map(function (v) {
              var s1 = v.s1 || {}, lat = Number(v.gps_lat != null ? v.gps_lat : s1.gpsLat), lon = Number(v.gps_lng != null ? v.gps_lng : s1.gpsLng);
              return { id: v.id, nom: v.village || s1.village || '', cluster: v.cluster || s1.cluster || '', lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null, sp: s1.sousPrefecture || '', dep: s1.departement || '' };
            }).filter(function (v) { return v.nom; });
            if (FPS) FPS.refEcrire(cleVillages(), l).catch(function () {});
          }
        } catch (e) {}
      }
      return l;
    }

    /* -- État local de la mission ouverte -------------------------------------- */
    async function missionLocale() { var r = await OFF.relire('mission_ouverte'); return r && r.valeur ? r.valeur : null; }
    function memoriserMission(m) { return OFF.memoriser('mission_ouverte', m); }
    async function derniereArriveeLocale(motoId) { var r = await OFF.relire('mission_dernier_km:' + motoId); return r && r.valeur != null ? Number(r.valeur) : null; }
    async function missionOuverte() {
      var loc = await missionLocale(), srv = null;
      try {
        var l = await lire('moto_v_missions', function (q) { return q.eq('conducteur_id', moi()).eq('statut', 'OUVERTE').limit(1); });
        srv = l[0] || null;
      } catch (e) { return loc; }   // hors connexion : l'appareil fait foi jusqu'à la synchronisation
      if (loc) {
        var ops = await OFF.lister(), dep = ops.filter(function (o) { return o.client_op_id === loc.depart_client_op_id; })[0];
        if (dep && dep.statut === 'REJETE') { await memoriserMission(null); return { rejet: dep.message, moto_id: loc.moto_id }; }
        if (!srv && dep && dep.statut === 'SYNCHRONISE') { await memoriserMission(null); return null; }   // clôturée ailleurs ou annulée
        return loc;
      }
      if (srv) return { id: srv.id, moto_id: srv.moto_id, moto_code: srv.moto_code, depart_at: srv.depart_at, km_depart: Number(srv.km_depart), objet: srv.objet, destination: srv.destination, serveur: true };
      return null;
    }

    /* -- Caméra : capture + lecture + composition ------------------------------ */
    function capturer(opts) {
      return new Promise(function (ok) {
        var d = document.createElement('dialog'); d.className = 'mm-camera';
        d.innerHTML = '<div class="mm-camera-scene"><video playsinline muted autoplay></video><div class="mm-visee" aria-hidden="true"><span>Alignez les chiffres du compteur dans ce cadre</span></div></div>' +
          '<div class="mm-camera-barre"><p class="mm-camera-gps" role="status">Localisation en cours…</p>' +
          '<div class="mm-camera-actions"><button type="button" class="mm-btn mm-secondaire" data-annuler>Annuler</button><button type="button" class="mm-btn mm-primaire mm-declencheur" data-photo disabled>Photographier le compteur</button></div>' +
          '<p class="mm-erreur" role="alert" hidden></p></div>';
        document.body.appendChild(d); try { d.showModal(); } catch (e) { d.setAttribute('open', ''); }
        var video = $('video', d), btn = $('[data-photo]', d), err = $('.mm-erreur', d), gpsEl = $('.mm-camera-gps', d), flux = null, loc = null, fini = false;
        function fermer(res) { if (fini) return; fini = true; if (loc) loc.arreter(); if (flux) FPC.fermerCamera(flux); try { d.close(); } catch (e) {} d.remove(); ok(res); }
        $('[data-annuler]', d).onclick = function () { fermer(null); };
        d.addEventListener('cancel', function (e) { e.preventDefault(); fermer(null); });
        if (!FPC || !FPC.cameraDisponible()) { err.hidden = false; err.textContent = 'Caméra indisponible sur ce navigateur : utilisez Chrome (Android) ou Safari (iPhone) à jour, via l\'adresse https de FBMS.'; return; }
        loc = new FPC.Localisateur(); loc.abonner(function (l) {
          var st = FPK.statutGps(l.position());
          gpsEl.textContent = l.erreur && st.code === 'ABSENT' ? l.erreur : 'Localisation : ' + st.court + (l.position() ? ' (' + FPK.precisionTexte(l.position()) + ')' : '');
          gpsEl.className = 'mm-camera-gps ' + (st.code === 'OK' ? 'mm-ok' : 'mm-warn');
        }); loc.demarrer();
        FPC.ouvrirCamera({ mode: 'PHOTO', face: 'environment' }).then(function (r) {
          flux = r.flux; video.srcObject = flux;
          video.onloadedmetadata = function () { btn.disabled = false; };
          if (OCR) setTimeout(function () { try { OCR.preparerModeles(); } catch (e) {} }, 0);
        }, function (e) { err.hidden = false; err.textContent = e.message; });
        btn.onclick = function () {
          if (!video.videoWidth) return;
          btn.disabled = true; btn.textContent = 'Lecture…';
          try {
            var res = figer(video, $('.mm-visee', d)); res.position = loc.position(); res.gps = FPK.statutGps(res.position);
            fermer(res);
          } catch (e) { err.hidden = false; err.textContent = 'Capture impossible : ' + (e && e.message || e); btn.disabled = false; btn.textContent = 'Photographier le compteur'; }
        };
      });
    }
    /* Fige l'image ; renvoie l'image entière et la bande de visée (coordonnées vidéo). */
    function figer(video, visee) {
      var vw = video.videoWidth, vh = video.videoHeight;
      var cv = document.createElement('canvas'); cv.width = vw; cv.height = vh; cv.getContext('2d').drawImage(video, 0, 0, vw, vh);
      // Correspondance écran → vidéo (object-fit: cover).
      var rv = video.getBoundingClientRect(), rb = visee.getBoundingClientRect();
      var e = Math.max(rv.width / vw, rv.height / vh), dx = (rv.width - vw * e) / 2, dy = (rv.height - vh * e) / 2;
      var bx = Math.max(0, Math.round((rb.left - rv.left - dx) / e)), by = Math.max(0, Math.round((rb.top - rv.top - dy) / e));
      var bw = Math.min(vw - bx, Math.round(rb.width / e)), bh = Math.min(vh - by, Math.round(rb.height / e));
      return { image: cv, bande: { x: bx, y: by, w: bw, h: bh }, at: new Date().toISOString() };
    }
    function lireCompteur(cap, dernierKm) {
      if (!OCR) return { valeur: null, raison: 'INDISPONIBLE' };
      var b = cap.bande, H = 96, W = Math.max(40, Math.round(b.w * H / Math.max(1, b.h)));
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d'); ctx.drawImage(cap.image, b.x, b.y, b.w, b.h, 0, 0, W, H);
      try { return OCR.lire(ctx.getImageData(0, 0, W, H), { dernierKm: dernierKm }); } catch (e) { return { valeur: null, raison: 'ERREUR' }; }
    }
    function blobJpeg(cv, q) { return new Promise(function (ok, ko) { cv.toBlob(function (b) { b ? ok(b) : ko(new Error('Image impossible (mémoire ?).')); }, 'image/jpeg', q); }); }
    /* Photo partagée : bande nette + tableau de bord réduit + bandeau SANS coordonnées. */
    async function composer(cap, infos) {
      var L = 640, b = cap.bande;
      var hb = Math.round(L * b.h / Math.max(1, b.w)); hb = Math.max(110, Math.min(220, hb));
      var hv = Math.round(L * cap.image.height / cap.image.width); hv = Math.min(hv, 420);
      var lignes = ['AFLP FLEET · ' + infos.moment + ' DE MISSION · compteur', heureAbj(cap.at) + ' (Abidjan)', 'Moto ' + infos.moto + ' · ' + infos.agent, infos.localite || 'Localité non déterminée'];
      var t = 15, hl = Math.round(lignes.length * t * 1.45 + 14);
      var cv = document.createElement('canvas'); cv.width = L; cv.height = hb + hv + hl;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, L, cv.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cap.image, b.x, b.y, b.w, b.h, 0, 0, L, hb);                      // bande du compteur, nette
      var sy = Math.max(0, Math.round((cap.image.height - cap.image.width * hv / L) / 2));
      ctx.drawImage(cap.image, 0, sy, cap.image.width, Math.round(cap.image.width * hv / L), 0, hb, L, hv);   // tableau de bord
      ctx.strokeStyle = '#F0A500'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, L - 3, hb - 3);
      ctx.fillStyle = '#053B23'; ctx.fillRect(0, hb + hv, L, hl);
      ctx.fillStyle = '#FFFFFF'; ctx.font = '600 ' + t + 'px "IBM Plex Sans", Arial, sans-serif'; ctx.textBaseline = 'top';
      lignes.forEach(function (l, i) { ctx.fillStyle = i === 0 ? '#F0A500' : '#FFFFFF'; ctx.fillText(l, 10, hb + hv + 7 + i * t * 1.45, L - 20); });
      var q = 0.62, blob = await blobJpeg(cv, q);
      while (blob.size > CIBLE_OCTETS && q > 0.3) { q -= 0.08; blob = await blobJpeg(cv, q); }
      if (blob.size > CIBLE_OCTETS * 2.5) {   // téléphone très détaillé : on réduit encore
        var p = document.createElement('canvas'); p.width = Math.round(L * 0.8); p.height = Math.round(cv.height * 0.8);
        p.getContext('2d').drawImage(cv, 0, 0, p.width, p.height); blob = await blobJpeg(p, 0.5);
      }
      return blob;
    }
    async function empreinte(blob) {
      var buf = await blob.arrayBuffer();
      if (g.crypto && g.crypto.subtle) {
        var h = await g.crypto.subtle.digest('SHA-256', buf);
        return Array.prototype.map.call(new Uint8Array(h), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      }
      return FPK.sha256Hex(new Uint8Array(buf));
    }

    /* -- Départ et arrivée ----------------------------------------------------- */
    async function saisir(moment, m, mission, apres) {
      var dernier = Math.max(Number(m.compteur_actuel_km || 0), Number(await derniereArriveeLocale(m.id) || 0), mission ? Number(mission.km_depart || 0) : 0);
      var cap = await capturer(); if (!cap) return;
      var lu = lireCompteur(cap, dernier);
      var vill = await villages(), loc = FPK.localiteGps(cap.position, vill, {}, null);
      var localite = loc && loc.nom ? (loc.code === 'AU_VILLAGE' ? loc.nom : (loc.code === 'ENVIRONS' ? 'environs de ' + loc.nom : 'hors villages connus')) : null;
      var blob = await composer(cap, { moment: moment === 'DEPART' ? 'DÉPART' : 'ARRIVÉE', moto: m.code, agent: S.profil.nom || '', localite: localite });
      var sha = await empreinte(blob), url = URL.createObjectURL(blob);
      var prec = (await OFF.relire('mission_preferences')) || {}; prec = prec.valeur || {};
      var listeVillages = vill.slice(0, 400).map(function (v) { return '<option value="' + esc(v.nom) + '">'; }).join('');
      var corps = '<figure class="mm-photo-compteur"><img src="' + url + '" alt="Photo du compteur qui sera partagée (sans coordonnées)"><figcaption>' +
          esc(Math.round(blob.size / 1024) + ' Ko · ' + (cap.gps.code === 'OK' ? 'position obtenue' : 'position : ' + cap.gps.court.toLowerCase())) + ' · cette image sera visible par vos responsables</figcaption></figure>' +
        (lu.valeur != null ? '<p class="mm-bandeau mm-ok" role="status">Lecture proposée : <b>' + esc(C.km(lu.valeur)) + '</b>. Vérifiez sur le compteur, corrigez si besoin.</p>'
          : '<p class="mm-bandeau mm-warn" role="status">Lecture automatique impossible (' + esc({ CHIFFRE_INCERTAIN: 'chiffres incertains', INVRAISEMBLABLE: 'valeur invraisemblable', AUCUN_CHIFFRE: 'aucun chiffre trouvé' }[lu.raison] || 'indisponible') + ') : saisissez le chiffre en lisant le compteur.</p>') +
        I.champ({ n: 'compteur_km', l: 'Compteur (km)', t: 'nombre', req: true, v: lu.valeur != null ? lu.valeur : '', pas: '0.1', aide: 'Dernier relevé connu : ' + km(dernier) + (mission ? ' · départ de la mission : ' + km(mission.km_depart) : '') }) +
        (moment === 'DEPART' ? I.champ({ n: 'objet', l: 'Objet de la mission', t: 'select', req: true, o: OBJETS, v: prec.objet || '' }) +
          '<div class="mm-champ mm-large" data-detail hidden><label for="f_objet_detail">Précisez l\'objet *</label><input id="f_objet_detail" name="objet_detail" minlength="5"></div>' +
          '<div class="mm-champ mm-large"><label for="f_destination">Destination (village ou cluster) *</label><input id="f_destination" name="destination" required minlength="2" list="mmVillages" value="' + esc(prec.destination || '') + '" autocomplete="off"><datalist id="mmVillages">' + listeVillages + '</datalist></div>' : '');
      I.modale(moment === 'DEPART' ? 'Départ de mission · ' + m.code : 'Fin de mission · ' + m.code, corps, async function (v) {
        var compteur = C.nombreSaisi ? C.nombreSaisi(v.compteur_km) : Number(String(v.compteur_km).replace(',', '.'));
        if (!(compteur >= 0)) throw new Error('Compteur invalide.');
        if (moment === 'ARRIVEE' && compteur < Number(mission.km_depart)) throw new Error('Le compteur d\'arrivée est inférieur à celui du départ (' + km(mission.km_depart) + ').');
        if (moment === 'DEPART' && compteur < dernier) throw new Error('Le compteur ne recule pas : le dernier relevé connu de cette moto est ' + km(dernier) + '. Vérifiez le chiffre ou demandez une correction au Chef de zone.');
        var origine = lu.valeur == null ? 'SAISI' : (Math.abs(compteur - lu.valeur) < 1e-9 ? 'LU_CONFIRME' : 'LU_CORRIGE');
        var p = { moto_id: m.id, compteur_km: compteur, capture_at: cap.at, origine: origine, localite: localite, photo_sha256: sha, gps_statut: cap.gps.code };
        if (origine !== 'SAISI') p.lu_km = lu.valeur;
        if (cap.position) { p.latitude = Math.round(cap.position.lat * 1e6) / 1e6; p.longitude = Math.round(cap.position.lon * 1e6) / 1e6; p.precision_m = cap.position.precision; p.gps_at = cap.position.horodatage; }
        var fichiers = [{ champ: 'photo_path', blob: blob, moto_id: m.id, categorie: 'mission', extension: 'jpg' }];
        if (moment === 'DEPART') {
          if (v.objet === 'AUTRE' && (!v.objet_detail || v.objet_detail.length < 5)) throw new Error('Précisez l\'objet de la mission (5 caractères au moins).');
          p.mission_id = OFF.uuid(); p.objet = v.objet; p.objet_detail = v.objet_detail || null; p.destination = v.destination;
          var op = await OFF.ajouter('MISSION_DEPART', p, { libelle: 'Départ de mission ' + m.code, fichiers: fichiers });
          await memoriserMission({ id: p.mission_id, moto_id: m.id, moto_code: m.code, depart_at: cap.at, km_depart: compteur, objet: v.objet, destination: v.destination, depart_client_op_id: op.client_op_id });
          OFF.memoriser('mission_preferences', { objet: v.objet, destination: v.destination });
        } else {
          p.mission_id = mission.id;
          await OFF.ajouter('MISSION_ARRIVEE', p, { libelle: 'Fin de mission ' + m.code, fichiers: fichiers });
          await memoriserMission(null); OFF.memoriser('mission_dernier_km:' + m.id, compteur);
        }
        var r = {}; try { r = await OFF.synchroniser(S.sb); } catch (e) {}
        URL.revokeObjectURL(url);
        setTimeout(apres, 50);
        var distance = moment === 'ARRIVEE' ? ' · ' + km(compteur - Number(mission.km_depart)) + ' parcourus' : '';
        return (moment === 'DEPART' ? 'Départ enregistré' : 'Mission clôturée') + distance + (r && r.horsLigne ? ' (hors connexion : envoi au retour du réseau).' : '.');
      }, moment === 'DEPART' ? 'Valider le départ' : 'Valider l\'arrivée');
      var sel = document.querySelector('dialog.mm-modale select[name="objet"]');
      if (sel) { var maj = function () { var dz = document.querySelector('dialog.mm-modale [data-detail]'); if (dz) dz.hidden = sel.value !== 'AUTRE'; }; sel.onchange = maj; maj(); }
      var champKm = document.querySelector('dialog.mm-modale input[name="compteur_km"]'); if (champKm) champKm.focus();
    }

    /* -- Bloc « Ma mission » (espace Opérations) ------------------------------ */
    async function blocOperations(m) {
      if (!C.peut(S.classe, 'missions') || !m) return '';
      var mo = await missionOuverte(), html;
      if (mo && mo.rejet) {
        html = '<div class="mm-bandeau mm-ko" role="alert"><b>Départ refusé par le serveur.</b> ' + esc(mo.rejet) + '</div>' +
          '<button type="button" class="mm-btn mm-primaire mm-mission-btn" data-mission="depart">Démarrer une mission</button>';
      } else if (mo) {
        var ici = mo.moto_id === m.id;
        html = '<p class="mm-mission-cours"><b>Mission en cours</b> · ' + esc(mo.moto_code || '') + ' · ' + esc(LIB_OBJET[mo.objet] || mo.objet || '') + ' → ' + esc(mo.destination || '') +
          '<br><small>Départ le ' + esc(C.dateHeureFr(mo.depart_at)) + ' à ' + esc(km(mo.km_depart)) + (mo.serveur ? '' : ' · enregistré sur l\'appareil') + '</small></p>' +
          (ici ? '<button type="button" class="mm-btn mm-primaire mm-mission-btn" data-mission="arrivee">Terminer la mission</button>' : '<p class="mm-note">Sélectionnez la moto ' + esc(mo.moto_code || '') + ' pour clôturer cette mission.</p>');
      } else {
        html = '<button type="button" class="mm-btn mm-primaire mm-mission-btn" data-mission="depart">Démarrer une mission</button>' +
          '<p class="mm-note">Photo du compteur au départ et à l\'arrivée. Le téléphone propose le chiffre, vous confirmez.</p>';
      }
      var resume = '';
      try {
        var l = await lire('moto_v_missions_mois', function (q) { return q.eq('conducteur_id', moi()).eq('mois', moisCourant()); });
        var x = l.reduce(function (a, r) { a.n += Number(r.missions || 0); a.km += Number(r.km_mission || 0); a.hm += Number(r.km_hors_mission || 0); a.ec += Number(r.ecarts_a_verifier || 0); return a; }, { n: 0, km: 0, hm: 0, ec: 0 });
        resume = '<div class="mm-kpis mm-kpis-mission">' + kpi('Missions du mois', String(x.n)) + kpi('Km de mission', C.km(x.km)) + kpi('Km hors mission', C.km(x.hm)) + kpi('Écarts à vérifier', String(x.ec)) + '</div>' +
          '<a class="mm-lien" href="#/missions">Voir mes missions</a>';
      } catch (e) { resume = '<p class="mm-note">Synthèse du mois indisponible hors connexion.</p>'; }
      return '<section class="mm-bloc mm-bloc-mission" aria-labelledby="mmMissionTitre"><h2 id="mmMissionTitre">Ma mission</h2>' + html + resume + '</section>';
    }
    function brancherOperations(zone, m, rafraichir) {
      $$('[data-mission]', zone).forEach(function (b) {
        b.onclick = async function () {
          if (b.dataset.mission === 'depart') {
            if (m.autorisee_a_circuler === false) return I.toast('Moto non autorisée à circuler : mission impossible.', 'ko');
            if (await OFF.immobilisationLocale(m.id)) return I.toast('Moto immobilisée sur cet appareil : mission impossible.', 'ko');
            return saisir('DEPART', m, null, rafraichir);
          }
          var mo = await missionOuverte(); if (!mo || mo.rejet) return rafraichir();
          return saisir('ARRIVEE', m, mo, rafraichir);
        };
      });
    }

    /* -- Espace « Missions » : suivi et contrôle ------------------------------ */
    async function charger() {
      var mois = etat.mois || moisCourant();
      var r = await Promise.all([
        lire('moto_v_missions', function (q) { return q.eq('mois', mois).order('depart_at', { ascending: false }).limit(1000); }),
        lire('moto_v_mission_ecarts', function (q) { return q.eq('statut', 'A_VERIFIER').order('created_at', { ascending: false }).limit(300); }),
        lire('moto_v_missions_mois', function (q) { return q.eq('mois', mois); }),
        C.peut(S.classe, 'missions_couts') ? lire('moto_v_missions_couts', function (q) { return q.eq('mois', mois); }).catch(function () { return []; }) : Promise.resolve([])
      ]);
      etat.donnees = { missions: r[0], ecarts: r[1], agents: r[2], couts: r[3], mois: mois };
      return etat.donnees;
    }
    function filtrer(l) { return l.filter(function (x) { return (!etat.moto || x.moto_id === etat.moto) && (!etat.agent || x.conducteur_id === etat.agent); }); }
    function lienPhoto(chemin, sha, texte) {
      return chemin ? '<button type="button" class="mm-btn mm-lien-btn mm-petit" data-photo-mission="' + esc(chemin) + '" data-sha="' + esc(sha || '') + '">' + esc(texte) + '</button>' : esc(texte);
    }
    async function vue() {
      var d = await charger();
      var suivi = C.peut(S.classe, 'missions_suivi'), traiter = C.peut(S.classe, 'missions_traiter');
      var missions = filtrer(d.missions), ecarts = filtrer(d.ecarts), agents = filtrer(d.agents);
      var tot = agents.reduce(function (a, r) {
        a.n += +r.missions || 0; a.km += +r.km_mission || 0; a.hm += +r.km_hors_mission || 0; a.nc += +r.missions_non_cloturees_a_temps || 0;
        a.cor += +r.releves_lus_corriges || 0; a.sai += +r.releves_saisis || 0; a.conf += +r.releves_lus_confirmes || 0; return a;
      }, { n: 0, km: 0, hm: 0, nc: 0, cor: 0, sai: 0, conf: 0 });
      var nbRel = tot.cor + tot.sai + tot.conf;
      var motos = {}, gens = {};
      d.missions.forEach(function (x) { motos[x.moto_id] = x.moto_code; gens[x.conducteur_id] = x.conducteur_nom; });
      var moisOpts = []; for (var i = 0; i < 12; i++) { var x = new Date(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - i); var v = x.toISOString().slice(0, 8) + '01'; moisOpts.push([v, x.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })]); }
      I.vue().innerHTML = '<div class="mm-entete"><div><h1>' + (suivi ? 'Missions et kilométrage' : 'Mes missions') + '</h1><p>Chaque mission : compteur photographié au départ et à l\'arrivée. Les écarts déclenchent une vérification, jamais une sanction automatique.</p></div>' +
        '<div class="mm-actions-entete">' + (suivi ? '<button type="button" class="mm-btn mm-secondaire" data-mission-controle>Contrôler les photos du mois</button> ' : '') +
        '<button type="button" class="mm-btn mm-secondaire" data-mission-export>Exporter (Excel)</button></div></div>' +
        '<div class="mm-filtres">' + I.champ({ n: 'mm_mois', l: 'Mois', t: 'select', o: moisOpts, v: d.mois, vide: false }) +
        (suivi ? I.champ({ n: 'mm_moto', l: 'Moto', t: 'select', o: Object.keys(motos).map(function (k) { return [k, motos[k]]; }), v: etat.moto }) +
          I.champ({ n: 'mm_agent', l: 'Agent', t: 'select', o: Object.keys(gens).map(function (k) { return [k, gens[k]]; }), v: etat.agent }) : '') + '</div>' +
        '<div class="mm-kpis">' + kpi('Missions', String(tot.n)) + kpi('Km de mission', C.km(tot.km)) + kpi('Km hors mission', C.km(tot.hm), tot.km ? Math.round(100 * tot.hm / (tot.km + tot.hm)) + ' % du total' : '') +
          kpi('Non clôturées à temps', String(tot.nc)) + kpi('Écarts à vérifier', String(ecarts.length)) +
          kpi('Relevés corrigés ou saisis', nbRel ? Math.round(100 * (tot.cor + tot.sai) / nbRel) + ' %' : ND, nbRel ? (tot.cor + ' corrigé(s), ' + tot.sai + ' saisi(s) sur ' + nbRel) : '') + '</div>' +
        (ecarts.length ? '<section class="mm-bloc mm-bloc-alerte"><h2>Écarts à vérifier</h2>' + I.tableau(['Date', 'Agent', 'Moto', 'Écart', 'Détail', traiter ? 'Décision' : 'Statut'], ecarts.map(function (e) {
          return [esc(C.dateHeureFr(e.depart_at)), esc(e.conducteur_nom || ND), esc(e.moto_code), '<span class="mm-badge mm-warn">' + esc(LIB_ECART[e.type_anomalie] || e.type_anomalie) + '</span>', esc(e.detail),
            traiter && e.conducteur_id !== moi() ? I.action('mission_ecart', 'Justifié', { id: e.id, decision: 'JUSTIFIEE' }) + ' ' + I.action('mission_ecart', 'Non justifié', { id: e.id, decision: 'NON_JUSTIFIEE' }, 'mm-danger') : '<span class="mm-badge mm-warn">À vérifier</span>'];
        })) + '<p class="mm-note">Un écart est une question, pas une faute : trajet vers le garage, retour autorisé, panne. Décidez après avoir regardé les photos et entendu l\'agent.</p></section>' : '') +
        '<section class="mm-bloc"><h2>Missions du mois</h2>' + I.tableau(['Départ', 'Agent', 'Moto', 'Objet → destination', 'Compteur départ', 'Compteur arrivée', 'Distance', 'Hors mission avant', 'Écarts', 'Statut', ''], missions.map(function (x) {
          return [esc(C.dateHeureFr(x.depart_at)), esc(x.conducteur_nom || ND), esc(x.moto_code), esc((LIB_OBJET[x.objet] || x.objet) + (x.objet_detail ? ' (' + x.objet_detail + ')' : '') + ' → ' + x.destination),
            lienPhoto(x.photo_depart, x.sha256_depart, km(x.km_depart)) + ' ' + badgeOrigine(x.depart_origine),
            x.km_arrivee != null ? lienPhoto(x.photo_arrivee, x.sha256_arrivee, km(x.km_arrivee)) + ' ' + badgeOrigine(x.arrivee_origine) : (x.non_cloturee_a_temps ? '<span class="mm-badge mm-ko">Non clôturée à temps</span>' : '—'),
            esc(km(x.distance_km)), x.km_hors_mission_avant == null ? '—' : esc(km(x.km_hors_mission_avant)),
            (x.types_ecarts || []).map(function (t) { return '<span class="mm-badge mm-warn">' + esc(LIB_ECART[t] || t) + '</span>'; }).join(' ') || '—',
            badgeStatut(x.statut) + (x.statut === 'ANNULEE' && x.annule_motif ? '<br><small>' + esc(x.annule_motif) + '</small>' : ''),
            traiter && x.statut === 'OUVERTE' && x.conducteur_id !== moi() ? I.action('mission_annuler', 'Annuler', { id: x.id }, 'mm-danger') : ''];
        }), 'Aucune mission ce mois.') + '</section>' +
        (suivi ? '<section class="mm-bloc"><h2>Par agent et par moto</h2>' + I.tableau(['Agent', 'Moto', 'Missions', 'Km de mission', 'Km hors mission', 'Non clôturées à temps', 'Annulées', 'Relevés corrigés / saisis'], agents.map(function (a) {
          return [esc(a.conducteur_nom || ND), esc(a.moto_code), esc(a.missions), esc(km(a.km_mission)), esc(km(a.km_hors_mission)), esc(a.missions_non_cloturees_a_temps), esc(a.missions_annulees), esc(a.releves_lus_corriges + ' / ' + a.releves_saisis)];
        }), 'Aucune donnée ce mois.') + '</section>' : '') +
        (d.couts.length ? '<section class="mm-bloc"><h2>Coût par kilomètre de mission</h2>' + I.tableau(['Moto', 'Km de mission', 'Carburant vérifié', 'Litres vérifiés', 'L / 100 km de mission', 'Entretien vérifié', 'FCFA / km de mission'], filtrer(d.couts).map(function (c) {
          return [esc(c.moto_code), esc(km(c.km_mission)), esc(C.fcfa(c.cout_carburant_verifie)), esc(c.litres_verifies), c.litres_100_km_mission == null ? ND : esc(String(c.litres_100_km_mission).replace('.', ',')),
            c.entretien_inclus ? esc(C.fcfa(c.cout_entretien_verifie)) : 'Non visible pour votre rôle', c.fcfa_km_mission == null ? ND : esc(String(c.fcfa_km_mission).replace('.', ',') + ' FCFA')];
        })) + '<p class="mm-note">Carburant : justificatifs vérifiés du mois. Entretien : factures vérifiées du mois. « Non disponible » sans kilomètre de mission clôturée.</p></section>' : '') +
        '<p class="mm-note">Photos : cliquez sur un compteur pour voir la photo partagée et vérifier son empreinte. Les coordonnées GPS exactes ne figurent jamais sur les photos.</p>';
      $$('select[name="mm_mois"],select[name="mm_moto"],select[name="mm_agent"]').forEach(function (s) {
        s.onchange = function () { etat.mois = $('select[name="mm_mois"]').value; var a = $('select[name="mm_moto"]'), b = $('select[name="mm_agent"]'); etat.moto = a ? a.value : ''; etat.agent = b ? b.value : ''; vue(); };
      });
      $$('[data-photo-mission]').forEach(function (b) { b.onclick = function () { voirPhoto(b.dataset.photoMission, b.dataset.sha); }; });
      $$('[data-action]', I.vue()).forEach(function (b) { b.onclick = function () { var f = ACTIONS[b.dataset.action]; if (f) f(b.dataset); }; });
      var ex = $('[data-mission-export]'); if (ex) ex.onclick = exporter;
      var ct = $('[data-mission-controle]'); if (ct) ct.onclick = function () { controlerTout(missions, ct); };
    }
    async function voirPhoto(chemin, sha) {
      var r = await S.sb.storage.from('moto-documents').createSignedUrl(chemin, 300);
      if (r.error) return I.toast('Photo inaccessible : ' + I.messageErreur(r.error), 'ko');
      var url = r.data.signedUrl;
      I.modale('Photo du compteur', '<figure class="mm-photo-compteur"><img src="' + esc(url) + '" alt="Photo du compteur"></figure><p class="mm-note" data-empreinte>Empreinte : vérification…</p>', null);
      try {
        var blob = await (await fetch(url)).blob(), h = await empreinte(blob), el = document.querySelector('dialog.mm-modale [data-empreinte]');
        // Contrôle enregistré par une personne autre que le déposant (le serveur ignore le déposant).
        if (C.peut(S.classe, 'missions_suivi')) rpc('moto_mission_photo_controler', { p_chemin: chemin, p_sha256: h }).catch(function () {});
        if (el) { var bon = sha && h === sha; el.className = 'mm-bandeau ' + (bon ? 'mm-ok' : 'mm-ko'); el.textContent = bon ? 'Empreinte conforme : la photo est celle prise au moment du relevé, non modifiée.' : 'Empreinte DIFFÉRENTE de celle enregistrée : photo modifiée ou remplacée. Signalez-le au Branch Manager.'; }
      } catch (e) { var el2 = document.querySelector('dialog.mm-modale [data-empreinte]'); if (el2) el2.textContent = 'Empreinte non vérifiable hors connexion.'; }
    }
    /* Recalcule l'empreinte de chaque photo du mois et l'enregistre (écart si différente). */
    async function controlerTout(missions, bouton) {
      var chemins = []; missions.forEach(function (x) { if (x.photo_depart) chemins.push(x.photo_depart); if (x.photo_arrivee) chemins.push(x.photo_arrivee); });
      var ok = 0, ko = 0, err = 0; bouton.disabled = true;
      for (var i = 0; i < chemins.length; i++) {
        bouton.textContent = 'Contrôle ' + (i + 1) + ' / ' + chemins.length + '…';
        try {
          var r = await S.sb.storage.from('moto-documents').createSignedUrl(chemins[i], 120); if (r.error) throw r.error;
          var h = await empreinte(await (await fetch(r.data.signedUrl)).blob());
          var res = await rpc('moto_mission_photo_controler', { p_chemin: chemins[i], p_sha256: h });
          if (res && res.conforme === false) ko++; else ok++;
        } catch (e) { err++; }
      }
      I.toast(chemins.length + ' photo(s) contrôlée(s) : ' + ok + ' conforme(s), ' + ko + ' différente(s)' + (err ? ', ' + err + ' non vérifiable(s)' : '') + '.', ko ? 'ko' : 'ok');
      setTimeout(vue, 300);
    }
    async function exporter() {
      try {
        if (!g.XLSX) await I.chargerScript(I.CDN_XLSX);
        var d = etat.donnees || await charger(), wb = g.XLSX.utils.book_new();
        var lm = filtrer(d.missions).map(function (x) { return { 'Départ (GMT)': x.depart_at, 'Agent': x.conducteur_nom, 'Moto': x.moto_code, 'Objet': LIB_OBJET[x.objet] || x.objet, 'Précision': x.objet_detail || '', 'Destination': x.destination,
          'Compteur départ': x.km_depart, 'Origine départ': LIB_ORIGINE[x.depart_origine], 'Arrivée (GMT)': x.arrivee_at || '', 'Compteur arrivée': x.km_arrivee, 'Origine arrivée': LIB_ORIGINE[x.arrivee_origine] || '',
          'Distance (km)': x.distance_km, 'Durée (min)': x.duree_min, 'Km hors mission avant': x.km_hors_mission_avant, 'Écarts': (x.types_ecarts || []).map(function (t) { return LIB_ECART[t] || t; }).join(', '), 'Statut': LIB_STATUT[x.statut] }; });
        g.XLSX.utils.book_append_sheet(wb, g.XLSX.utils.json_to_sheet(lm.length ? lm : [{ 'Information': 'Aucune mission' }]), 'Missions');
        g.XLSX.utils.book_append_sheet(wb, g.XLSX.utils.json_to_sheet(filtrer(d.agents).map(function (a) { return { 'Agent': a.conducteur_nom, 'Moto': a.moto_code, 'Missions': +a.missions, 'Km de mission': +a.km_mission, 'Km hors mission': +a.km_hors_mission, 'Non clôturées à temps': +a.missions_non_cloturees_a_temps, 'Annulées': +a.missions_annulees, 'Relevés corrigés': +a.releves_lus_corriges, 'Relevés saisis': +a.releves_saisis }; }).concat([]) || []), 'Par agent');
        if (d.couts.length) g.XLSX.utils.book_append_sheet(wb, g.XLSX.utils.json_to_sheet(filtrer(d.couts).map(function (c) { return { 'Moto': c.moto_code, 'Km de mission': +c.km_mission, 'Carburant vérifié (FCFA)': +c.cout_carburant_verifie, 'Litres vérifiés': +c.litres_verifies, 'L/100 km de mission': c.litres_100_km_mission == null ? 'Non disponible' : +c.litres_100_km_mission, 'Entretien vérifié (FCFA)': c.entretien_inclus ? +c.cout_entretien_verifie : 'Non visible', 'FCFA par km de mission': c.fcfa_km_mission == null ? 'Non disponible' : +c.fcfa_km_mission }; })), 'Coûts');
        g.XLSX.utils.book_append_sheet(wb, g.XLSX.utils.json_to_sheet(filtrer(d.ecarts).map(function (e) { return { 'Date': e.depart_at, 'Agent': e.conducteur_nom, 'Moto': e.moto_code, 'Écart': LIB_ECART[e.type_anomalie], 'Détail': e.detail, 'Statut': 'À vérifier' }; }).concat([]) || []), 'Écarts');
        g.XLSX.writeFile(wb, 'AFLP_FLEET_missions_' + d.mois.slice(0, 7) + '.xlsx');
      } catch (e) { I.toast('Export impossible : ' + I.messageErreur(e), 'ko'); }
    }
    var ACTIONS = {
      mission_ecart: function (dd) {
        I.modale(dd.decision === 'JUSTIFIEE' ? 'Écart justifié' : 'Écart non justifié', I.champ({ n: 'motif', l: 'Motif (ce que vous avez vérifié)', t: 'textarea', req: true, min: 10 }), async function (v) {
          await rpc('moto_mission_anomalie_traiter', { p_anomalie: dd.id, p_decision: dd.decision, p_motif: v.motif }); setTimeout(vue, 50); return 'Décision enregistrée.';
        }, 'Enregistrer la décision');
      },
      mission_annuler: function (dd) {
        I.modale('Annuler la mission', '<p class="mm-note">La mission ne sera jamais estimée : ses kilomètres apparaîtront comme « hors mission » au départ suivant.</p>' + I.champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 10 }), async function (v) {
          await rpc('moto_mission_annuler', { p_mission: dd.id, p_motif: v.motif }); setTimeout(vue, 50); return 'Mission annulée.';
        }, 'Annuler la mission');
      }
    };
    return { blocOperations: blocOperations, brancherOperations: brancherOperations, vue: vue, actions: ACTIONS,
             _test: { composer: composer, lireCompteur: lireCompteur, empreinte: empreinte } };
  };
})(window);
