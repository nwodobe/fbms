/* ============================================================================
   AFLP FIELD PROOF — interface (fieldproof/fp-app.js)
   ----------------------------------------------------------------------------
   Parcours : Accueil → Nouvelle mission (cluster, village, activité) →
   Dossier de mission → PHOTO / VIDÉO → Valider → Galerie / Partager / Exporter.
   Aucun envoi automatique : chaque sortie de fichier est un geste de l'agent.
   ========================================================================== */
(function (global) {
  'use strict';
  var C = global.FP_CORE, S = global.FP_STORE, K = global.FP_CAPTURE;
  var doc = global.document, nav = global.navigator;
  var app = { profil: null, villages: [], refMaj: null, urls: [], flux: null, loc: null, enreg: null, capture: null };
  var LOT_MAX = 450 * 1048576;     // taille maximale d'un ZIP exporté
  var SEUIL_WHATSAPP_MEDIA = 16 * 1048576;

  /* -- Utilitaires --------------------------------------------------------- */
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; }); }
  function vue() { return $('#fpVue'); }
  function liberer() { app.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); app.urls = []; }
  function urlObjet(b) { var u = URL.createObjectURL(b); app.urls.push(u); return u; }
  function estIOS() { return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1); }
  function enLigne() { return nav.onLine !== false; }
  function avis(texte, type, duree) {
    var z = $('#fpAvis'); if (!z) return;
    var d = doc.createElement('div'); d.className = 'fp-avis fp-avis-' + (type || 'info'); d.setAttribute('role', type === 'ko' ? 'alert' : 'status');
    d.textContent = texte; z.appendChild(d);
    setTimeout(function () { d.classList.add('fp-sortie'); setTimeout(function () { d.remove(); }, 400); }, duree || 5200);
  }
  function confirmer(question) { return global.confirm(question); }
  function pref(cle, def) { try { var v = localStorage.getItem('fp_' + cle); return v == null ? def : v; } catch (e) { return def; } }
  function setPref(cle, v) { try { localStorage.setItem('fp_' + cle, v); } catch (e) {} }
  function aller(h) { if (location.hash === h) router(); else location.hash = h; }

  /* -- Réseau -------------------------------------------------------------- */
  function majReseau() {
    var r = $('#fpReseau'); if (!r) return;
    var on = enLigne(); r.textContent = on ? 'En ligne' : 'Hors ligne'; r.className = 'fp-etat ' + (on ? 'fp-ok' : 'fp-ko');
  }

  /* -- Référentiel villages (lecture seule, périmètre RLS) ------------------ */
  function cleRef() { return 'villages:' + (app.profil && app.profil.user_id || 'inconnu'); }
  function client() {
    if (app.sb) return app.sb;
    if (!global.supabase || !global.supabase.createClient) return null;
    app.sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON);
    return app.sb;
  }
  function libelleCluster(brut) { var c = global.AFLP_ACCESS && global.AFLP_ACCESS.cluster(brut); return c ? c.label : (brut || ''); }
  function preparerReferentiel(force) {
    return S.refLire(cleRef()).then(function (r) {
      if (r && r.valeur) { app.villages = r.valeur; app.refMaj = r.maj; }
      if (!enLigne() || (!force && r && Date.now() - new Date(r.maj) < 6 * 3600 * 1000)) return;
      var sb = client(); if (!sb) return;
      return sb.from('villages').select('id,village,cluster,s1:data->s1').eq('deleted', false).then(function (res) {
        if (res.error) throw res.error;
        var l = (res.data || []).map(function (v) {
          var s1 = v.s1 || {};
          return { id: v.id, nom: v.village || s1.village || '', cluster: libelleCluster(v.cluster || s1.cluster || '') };
        }).filter(function (v) {
          if (!v.nom) return false;
          var A = global.AFLP_ACCESS;
          return !(A && A.inScope) || A.inScope(app.profil, { cluster: v.cluster });
        }).sort(function (a, b) { return (a.cluster + a.nom).localeCompare(b.cluster + b.nom, 'fr'); });
        app.villages = l; app.refMaj = new Date().toISOString();
        return S.refEcrire(cleRef(), l);
      }).catch(function (e) {
        if (!(r && r.valeur)) avis('Référentiel des villages non chargé : ' + (e && e.message || e) + '. Reconnectez-vous au réseau pour préparer le mode terrain.', 'warn', 8000);
      });
    });
  }
  function clusters() {
    var vus = {}, l = [];
    app.villages.forEach(function (v) { if (v.cluster && !vus[v.cluster]) { vus[v.cluster] = 1; l.push(v.cluster); } });
    var A = global.AFLP_ACCESS;
    if (A && A.allClusters) A.allClusters().forEach(function (c) { if (!vus[c.label] && (!A.inScope || A.inScope(app.profil, { cluster: c.code }))) { vus[c.label] = 1; l.push(c.label); } });
    return l.sort(function (a, b) { return a.localeCompare(b, 'fr'); });
  }

  /* -- Gabarits communs ---------------------------------------------------- */
  function entete(titre, sousTitre, actions) {
    return '<div class="fp-entete"><div><h1>' + esc(titre) + '</h1>' + (sousTitre ? '<p>' + sousTitre + '</p>' : '') + '</div>' + (actions || '') + '</div>';
  }
  function badgeGalerie(m) {
    var g = m.galerie || 'NON_ENREGISTRE';
    if (g === 'CONFIRME_AGENT') return '<span class="fp-badge fp-b-ok">Galerie : confirmé par l\'agent</span>';
    if (g === 'ENVOI_LANCE') return '<span class="fp-badge fp-b-warn">Galerie : à vérifier</span>';
    return '<span class="fp-badge fp-b-ko">Pas encore dans la galerie</span>';
  }
  function badgeGps(pos, quand) {
    var s = C.statutGps(pos, quand);
    return '<span class="fp-badge ' + (s.code === 'OK' ? 'fp-b-ok' : s.code === 'ABSENT' ? 'fp-b-ko' : 'fp-b-warn') + '">' + esc(s.code === 'ABSENT' ? 'Localisation non vérifiée' : 'GPS ' + s.court.toLowerCase() + ' ' + C.precisionTexte(pos)) + '</span>';
  }

  /* -- Vue : accueil ------------------------------------------------------- */
  /* Jeton de navigation : une vue asynchrone dont la réponse arrive après un
     changement d'écran n'écrase jamais l'écran affiché (constaté en recette). */
  function jeton() { var j = app.jeton; return function () { return j === app.jeton; }; }
  function vueAccueil() {
    liberer(); var actuel = jeton();
    Promise.all([S.missions(app.profil.user_id), S.espace(), S.morceauxOrphelins()]).then(function (r) {
      if (!actuel()) return;
      var miss = r[0], esp = r[1], orph = r[2];
      var h = entete('AFLP FIELD PROOF', 'Preuves photo &amp; vidéo des missions terrain. Les fichiers restent sur votre téléphone : rien n\'est envoyé automatiquement.',
        '<button class="fp-btn fp-btn-principal fp-btn-xl" data-aller="#nouvelle">＋ Nouvelle mission</button>');
      if (orph.length) {
        h += '<section class="fp-carte fp-alerte-carte"><h2>Enregistrement vidéo interrompu</h2><p>' + orph.length + ' vidéo(s) ont été coupées avant leur validation (fermeture, batterie, stockage). Les images déjà filmées sont conservées.</p><div class="fp-actions">' +
          orph.map(function (o) { return '<button class="fp-btn" data-recuperer="' + esc(o.mediaId) + '">Récupérer ' + esc(o.mediaId) + ' (' + C.octetsTexte(o.taille) + ')</button>'; }).join('') + '</div></section>';
      }
      h += '<section class="fp-carte"><h2>Préparation du téléphone</h2><ul class="fp-pret">' +
        ligneEtat(app.villages.length > 0, app.villages.length ? app.villages.length + ' village(s) de votre périmètre disponibles hors ligne' + (app.refMaj ? ' (mis à jour le ' + C.dateHeureAbj(app.refMaj) + ')' : '') : 'Villages non préparés : connectez-vous une fois au réseau') +
        ligneEtat(K.cameraDisponible(), K.cameraDisponible() ? 'Caméra accessible depuis l\'application' : 'Caméra non accessible dans ce navigateur') +
        ligneEtat(K.videoDisponible(), K.videoDisponible() ? 'Vidéo avec bandeau incrusté disponible (' + esc((K.typeVideo() || 'format par défaut').split(';')[0]) + ')' : 'Vidéo avec bandeau non prise en charge par ce navigateur') +
        ligneEtat(!esp || esp.libre > 300 * 1048576, esp ? 'Espace disponible pour l\'application : ' + C.octetsTexte(esp.libre) : 'Espace disponible : inconnu sur ce navigateur') +
        '</ul><div class="fp-actions"><button class="fp-btn" data-preparer>' + (enLigne() ? 'Mettre à jour les villages' : 'Hors ligne : mise à jour impossible') + '</button><a class="fp-btn fp-btn-lien" href="#aide">Autorisations et bonnes pratiques</a>' +
        (app.auth && (app.auth.niveau === 'bm' || app.auth.niveau === 'chef') ? '<a class="fp-btn fp-btn-lien" href="#verifier">Contrôler un dossier reçu</a>' : '') + '</div></section>';
      h += '<section><h2 class="fp-titre-section">Mes missions <small>(' + miss.length + ')</small></h2>';
      if (!miss.length) h += '<p class="fp-vide">Aucune mission sur ce téléphone. Créez une mission avant de prendre des photos ou des vidéos.</p>';
      else h += '<div class="fp-liste-missions">' + miss.map(function (m) {
        return '<a class="fp-mission" href="#mission/' + esc(m.id) + '"><div><strong>' + esc(m.activite) + '</strong><span>' + esc(m.cluster) + ' · ' + esc(m.village) + '</span><small class="fp-mono">' + esc(m.id) + ' · ' + esc(C.dateHeureAbj(m.creeLe)) + '</small></div><div class="fp-compte"><span title="Photos">📷 ' + (m.nbPhotos || 0) + '</span><span title="Vidéos">🎥 ' + (m.nbVideos || 0) + '</span></div></a>';
      }).join('') + '</div>';
      h += '</section>';
      vue().innerHTML = h;
    }).catch(erreurVue);
  }
  function ligneEtat(ok, texte) { return '<li class="' + (ok ? 'fp-li-ok' : 'fp-li-ko') + '">' + esc(texte) + '</li>'; }

  /* -- Vue : nouvelle mission --------------------------------------------- */
  function vueNouvelle() {
    var cl = clusters();
    var h = entete('Nouvelle mission', 'Les informations saisies ici figureront sur chaque photo et chaque vidéo du dossier. Elles ne pourront plus être modifiées après la première capture.');
    h += '<form class="fp-carte fp-form" id="fpForm" novalidate>' +
      '<label>Agent<input value="' + esc(app.profil.nom || '') + ' · ' + esc(app.profil.role || '') + '" readonly aria-readonly="true"></label>' +
      '<label>Cluster <b aria-hidden="true">*</b><select id="fpCluster" required><option value="">— Choisir le cluster —</option>' + cl.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label>Village <b aria-hidden="true">*</b><select id="fpVillage" required disabled><option value="">— Choisir d\'abord le cluster —</option></select></label>' +
      '<label id="fpVillageLibreBloc" hidden>Nom du village (hors référentiel)<input id="fpVillageLibre" maxlength="80" autocomplete="off"><small>Le dossier portera la mention « village saisi manuellement ».</small></label>' +
      '<label>Activité <b aria-hidden="true">*</b><select id="fpActivite" required><option value="">— Choisir l\'activité —</option>' + C.ACTIVITES.map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('') + '</select></label>' +
      '<label>Commentaire (facultatif)<textarea id="fpCommentaire" rows="2" maxlength="500"></textarea></label>' +
      (app.villages.length ? '' : '<p class="fp-note fp-note-warn">Référentiel des villages absent sur ce téléphone : connectez-vous une fois au réseau, ou saisissez le village manuellement.</p>') +
      '<p class="fp-erreur" id="fpErreurForm" role="alert"></p>' +
      '<div class="fp-actions"><a class="fp-btn" href="#accueil">Annuler</a><button class="fp-btn fp-btn-principal" type="submit">Créer la mission</button></div></form>';
    vue().innerHTML = h;
    var sc = $('#fpCluster'), sv = $('#fpVillage');
    sc.addEventListener('change', function () {
      var l = app.villages.filter(function (v) { return v.cluster === sc.value; });
      sv.innerHTML = '<option value="">— Choisir le village —</option>' + l.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.nom) + '</option>'; }).join('') + '<option value="__libre">Village absent de la liste…</option>';
      sv.disabled = !sc.value; $('#fpVillageLibreBloc').hidden = true;
    });
    sv.addEventListener('change', function () { $('#fpVillageLibreBloc').hidden = sv.value !== '__libre'; });
    $('#fpForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = $('#fpErreurForm'), libre = sv.value === '__libre', nomLibre = ($('#fpVillageLibre').value || '').trim();
      if (!sc.value) return (err.textContent = 'Choisissez le cluster.');
      if (!sv.value || (libre && nomLibre.length < 2)) return (err.textContent = 'Choisissez ou saisissez le village.');
      if (!$('#fpActivite').value) return (err.textContent = 'Choisissez l\'activité.');
      var v = libre ? null : app.villages.filter(function (x) { return String(x.id) === sv.value; })[0];
      var m = {
        id: C.idMission(), creeLe: new Date().toISOString(), agent: app.profil.nom || app.profil.email || 'Agent', agentId: app.profil.user_id, role: app.profil.role,
        cluster: sc.value, village: libre ? nomLibre : v.nom, villageId: libre ? null : v.id, villageSaisieLibre: libre,
        activite: $('#fpActivite').value, commentaire: ($('#fpCommentaire').value || '').trim(), nbPhotos: 0, nbVideos: 0
      };
      if (libre) m.commentaire = ('[Village saisi manuellement] ' + m.commentaire).trim();
      S.enregistrerMission(m).then(function () { aller('#mission/' + m.id); }).catch(function (e) { err.textContent = 'Enregistrement local impossible : ' + (e.message || e); });
    });
  }

  /* -- Vue : dossier de mission ------------------------------------------- */
  function vueMission(id) {
    liberer(); var actuel = jeton();
    Promise.all([S.mission(id), S.medias(id)]).then(function (r) {
      if (!actuel()) return;
      var m = r[0], ms = r[1].filter(function (x) { return x.statut !== 'ENREGISTREMENT'; });
      if (!m) return (vue().innerHTML = '<p class="fp-vide">Mission introuvable sur ce téléphone.</p><a class="fp-btn" href="#accueil">Retour</a>');
      var nbP = ms.filter(function (x) { return x.type === 'PHOTO'; }).length, nbV = ms.length - nbP;
      var h = '<a class="fp-retour" href="#accueil">← Mes missions</a>' + entete(m.activite, esc(m.cluster) + ' · ' + esc(m.village) + ' · ' + esc(m.agent) + '<br><span class="fp-mono">' + esc(m.id) + ' · créée le ' + esc(C.dateHeureAbj(m.creeLe)) + '</span>');
      h += '<div class="fp-capture-boutons"><a class="fp-btn fp-btn-principal fp-btn-xl" href="#capture/' + esc(m.id) + '/PHOTO">📷 Prendre photo</a><a class="fp-btn fp-btn-principal fp-btn-xl fp-btn-video" href="#capture/' + esc(m.id) + '/VIDEO">🎥 Enregistrer vidéo</a></div>';
      h += '<section class="fp-carte"><div class="fp-galerie-entete"><h2>Galerie de mission <small>' + nbP + ' photo(s) · ' + nbV + ' vidéo(s)</small></h2>' +
        (ms.length ? '<label class="fp-tout"><input type="checkbox" id="fpTout"> Tout sélectionner</label>' : '') + '</div>';
      if (!ms.length) h += '<p class="fp-vide">Aucun média pour l\'instant. Les photos et vidéos validées apparaîtront ici.</p>';
      else h += '<div class="fp-galerie">' + ms.map(carteMedia).join('') + '</div>';
      h += '</section>';
      if (ms.length) h += '<div class="fp-barre-actions"><button class="fp-btn" data-partager-selection>Partager la sélection</button><button class="fp-btn" data-galerie-selection>Enregistrer la sélection dans la galerie</button><button class="fp-btn fp-btn-principal" data-exporter="' + esc(m.id) + '">Exporter le dossier (ZIP)</button></div>';
      h += '<section class="fp-carte"><h2><label for="fpComMission">Commentaire de mission</label></h2><textarea id="fpComMission" rows="2" maxlength="500">' + esc(m.commentaire || '') + '</textarea><div class="fp-actions"><button class="fp-btn" data-com-mission="' + esc(m.id) + '">Enregistrer le commentaire</button>' +
        '<button class="fp-btn fp-btn-danger" data-supprimer-mission="' + esc(m.id) + '">Supprimer la mission de ce téléphone</button></div></section>';
      vue().innerHTML = h;
      app.missionCourante = m; app.mediasCourants = ms;
    }).catch(erreurVue);
  }
  function carteMedia(x) {
    var video = x.type === 'VIDEO';
    return '<article class="fp-media ' + (video ? 'fp-media-video' : 'fp-media-photo') + '" data-media="' + esc(x.id) + '">' +
      '<label class="fp-select"><input type="checkbox" class="fp-coche" value="' + esc(x.id) + '" aria-label="Sélectionner ' + esc(x.id) + '"></label>' +
      '<button class="fp-vignette" data-ouvrir="' + esc(x.id) + '" aria-label="Ouvrir ' + (video ? 'la vidéo ' : 'la photo ') + esc(x.id) + '">' +
      (x.vignette ? '<img src="' + esc(x.vignette) + '" alt="">' : '<span class="fp-sans-vignette">' + (video ? '🎥' : '📷') + '</span>') +
      '<span class="fp-type ' + (video ? 'fp-type-v' : 'fp-type-p') + '">' + (video ? '▶ VIDÉO ' + C.duree(x.dureeMs) : 'PHOTO') + '</span></button>' +
      '<div class="fp-media-corps"><strong class="fp-mono">' + esc(x.id.split('-').pop()) + '</strong> <span>' + esc(C.heureAbj(x.debut)) + '</span>' +
      (video && !x.micro ? ' <span class="fp-badge fp-b-warn">Muette</span>' : '') + (x.statut === 'RECUPERE' ? ' <span class="fp-badge fp-b-warn">Récupérée</span>' : '') +
      '<div class="fp-badges">' + badgeGps(x.gpsDebut, x.debut) + badgeGalerie(x) + (x.local === 'VERIFIE' ? '' : '<span class="fp-badge fp-b-ko">Copie locale absente</span>') + '</div>' +
      '<div class="fp-media-actions"><button class="fp-btn fp-btn-petit" data-galerie="' + esc(x.id) + '">Galerie</button><button class="fp-btn fp-btn-petit" data-partager="' + esc(x.id) + '">Partager</button><button class="fp-btn fp-btn-petit" data-details="' + esc(x.id) + '">Détails</button></div></div></article>';
  }

  /* -- Détails d'un média -------------------------------------------------- */
  function details(id) {
    S.media(id).then(function (x) {
      if (!x) return;
      var lien = C.lienCarte(x.gpsDebut), lienF = C.lienCarte(x.gpsFin);
      var lignes = [
        ['Identifiant', x.id], ['Type', x.type === 'VIDEO' ? 'Vidéo' : 'Photo'], [x.type === 'VIDEO' ? 'Début' : 'Prise de vue', C.dateHeureAbj(x.debut)],
        x.type === 'VIDEO' ? ['Fin', x.fin ? C.dateHeureAbj(x.fin) : '—'] : null, x.type === 'VIDEO' ? ['Durée réelle', C.duree(x.dureeMs)] : null,
        [x.type === 'VIDEO' ? 'Position au début' : 'Position', x.gpsDebut ? C.coordonnees(x.gpsDebut) + ' ' + C.precisionTexte(x.gpsDebut) : 'Non disponible'],
        ['Statut localisation', C.statutGps(x.gpsDebut, x.debut).libelle],
        x.type === 'VIDEO' ? ['Position à la fin', x.gpsFin ? C.coordonnees(x.gpsFin) + ' ' + C.precisionTexte(x.gpsFin) : 'Non disponible'] : null,
        x.type === 'VIDEO' ? ['Son', x.micro ? 'Enregistré' : 'Vidéo muette (micro indisponible)'] : null,
        ['Format', x.mime + ' · ' + x.largeur + '×' + x.hauteur], ['Taille', C.octetsTexte(x.taille)], ['Empreinte SHA-256', x.sha256],
        ['Copie dans l\'application', x.local === 'VERIFIE' ? 'Conservée et relue (identique)' : 'Absente'],
        ['Galerie du téléphone', x.galerie === 'CONFIRME_AGENT' ? 'Présence confirmée par l\'agent' : x.galerie === 'ENVOI_LANCE' ? 'Enregistrement lancé — à vérifier dans la galerie' : 'Pas encore enregistrée'],
        x.raisonArret && x.raisonArret !== 'AGENT' ? ['Arrêt', K.RAISONS[x.raisonArret] || x.raisonArret] : null
      ].filter(Boolean);
      ouvrirDialogue('Détails ' + x.id, '<dl class="fp-dl">' + lignes.map(function (l) { return '<dt>' + esc(l[0]) + '</dt><dd' + (l[0].indexOf('SHA') >= 0 ? ' class="fp-mono fp-casse"' : '') + '>' + esc(l[1]) + '</dd>'; }).join('') + '</dl>' +
        '<div class="fp-actions">' + (lien ? '<a class="fp-btn" href="' + esc(lien) + '" target="_blank" rel="noopener">Ouvrir la position dans Google Maps</a>' : '') + (lienF ? '<a class="fp-btn" href="' + esc(lienF) + '" target="_blank" rel="noopener">Position de fin</a>' : '') +
        (x.galerie === 'ENVOI_LANCE' ? '<button class="fp-btn" data-confirmer-galerie="' + esc(x.id) + '">J\'ai vérifié : le fichier est dans ma galerie</button>' : '') +
        '<button class="fp-btn fp-btn-danger" data-supprimer-media="' + esc(x.id) + '">Supprimer de l\'application</button></div>' +
        '<p class="fp-note">Date, heure et position proviennent du téléphone. Elles ne constituent pas une preuve certifiée contre la falsification ; l\'empreinte permet de détecter une modification du fichier après sa création.</p>');
    });
  }
  function ouvrirDialogue(titre, html) {
    var d = $('#fpDialogue');
    $('#fpDialogueTitre').textContent = titre; $('#fpDialogueCorps').innerHTML = html;
    if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
  }
  function fermerDialogue() { var d = $('#fpDialogue'); if (d.close) d.close(); else d.removeAttribute('open'); }
  function ouvrirMedia(id) {
    Promise.all([S.media(id), S.fichier(id)]).then(function (r) {
      var x = r[0], b = r[1];
      if (!x) return;
      if (!b) return avis('La copie de ce fichier n\'est plus dans l\'application. Retrouvez-le dans la galerie du téléphone.', 'warn');
      var u = urlObjet(b);
      ouvrirDialogue(x.id, x.type === 'VIDEO' ? '<video class="fp-lecteur" src="' + u + '" controls playsinline></video>' : '<img class="fp-lecteur" src="' + u + '" alt="Photo ' + esc(x.id) + ' avec bandeau AFLP">');
    });
  }

  /* -- Sorties : galerie, partage, export ---------------------------------- */
  function fichierPour(x, blob) {
    var nom = C.nomFichier(x);
    try { return new File([blob], nom, { type: blob.type || x.mime.split(';')[0], lastModified: new Date(x.debut).getTime() }); }
    catch (e) { blob.name = nom; return blob; }
  }
  function peutPartager(fichiers) { try { return !!(nav.share && nav.canShare && nav.canShare({ files: fichiers })); } catch (e) { return false; } }
  function telecharger(blob, nom) {
    var a = doc.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = nom; a.rel = 'noopener'; doc.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(u); }, 60000);
  }
  function chargerFichiers(ids) {
    return Promise.all(ids.map(function (id) { return Promise.all([S.media(id), S.fichier(id)]); })).then(function (l) {
      var manquants = l.filter(function (p) { return !p[1]; }).map(function (p) { return p[0] && p[0].id; });
      if (manquants.length) avis('Copie locale absente pour : ' + manquants.join(', ') + '. Ces fichiers sont à reprendre depuis la galerie.', 'warn', 8000);
      return l.filter(function (p) { return p[0] && p[1]; }).map(function (p) { return { media: p[0], fichier: fichierPour(p[0], p[1]) }; });
    });
  }
  /* Galerie : iPhone → feuille de partage (« Enregistrer l'image / la vidéo ») ;
     Android → téléchargement (dossier Téléchargements, visible dans Google
     Photos / Galerie > Download). Aucun navigateur ne confirme l'écriture
     dans la galerie : le statut reste « à vérifier » tant que l'agent ne l'a
     pas confirmé. */
  function versGalerie(ids) {
    chargerFichiers(ids).then(function (l) {
      if (!l.length) return;
      var fichiers = l.map(function (x) { return x.fichier; });
      var viaPartage = estIOS() && peutPartager(fichiers);
      var p;
      if (viaPartage) {
        avis('Dans la fenêtre qui s\'ouvre, choisissez « Enregistrer ' + (fichiers.length > 1 ? 'les éléments' : (l[0].media.type === 'VIDEO' ? 'la vidéo' : 'l\'image')) + ' ».', 'info', 7000);
        p = nav.share({ files: fichiers });
      } else {
        fichiers.forEach(function (f, i) { setTimeout(function () { telecharger(f, f.name); }, i * 700); });
        p = Promise.resolve();
      }
      return p.then(function () {
        return Promise.all(l.map(function (x) { if (x.media.galerie !== 'CONFIRME_AGENT') { x.media.galerie = 'ENVOI_LANCE'; x.media.galerieLe = new Date().toISOString(); } return S.enregistrerMedia(x.media); }));
      }).then(function () {
        ouvrirDialogue('Vérifiez votre galerie', '<p>' + (viaPartage ? 'Ouvrez l\'application <b>Photos</b>' : 'Ouvrez <b>Galerie</b> ou <b>Google Photos</b> (album « Download » / « Téléchargements »)') + ' et vérifiez que ' + (l.length > 1 ? 'les ' + l.length + ' fichiers sont présents' : 'le fichier est présent') + ', avec le bandeau AFLP.</p><p class="fp-note">Le navigateur ne permet pas à l\'application de le vérifier elle-même. Tant que vous ne confirmez pas, le statut reste « à vérifier ».</p>' +
          '<div class="fp-actions"><button class="fp-btn fp-btn-principal" data-confirmer-galerie="' + esc(l.map(function (x) { return x.media.id; }).join(',')) + '">Oui, c\'est dans ma galerie</button><button class="fp-btn" data-fermer>Pas encore</button></div>');
        rafraichir();
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return avis('Enregistrement annulé : rien n\'a été enregistré dans la galerie.', 'warn');
        avis('Enregistrement dans la galerie impossible : ' + (e && e.message || e), 'ko', 8000);
      });
    });
  }
  function confirmerGalerie(ids) {
    Promise.all(ids.map(function (id) { return S.media(id).then(function (x) { if (x) { x.galerie = 'CONFIRME_AGENT'; x.galerieConfirmeLe = new Date().toISOString(); return S.enregistrerMedia(x); } }); }))
      .then(function () { fermerDialogue(); avis('Présence dans la galerie confirmée.', 'ok'); rafraichir(); });
  }
  function texteMission(m, l) {
    var p = l.filter(function (x) { return x.media.type === 'PHOTO'; }).length;
    return 'AFLP FIELD PROOF · ' + m.activite + ' · ' + m.cluster + ' / ' + m.village + ' · Agent : ' + m.agent + ' · Mission ' + m.id + ' · ' + p + ' photo(s), ' + (l.length - p) + ' vidéo(s).';
  }
  /* Partage (WhatsApp, etc.) : toujours déclenché par l'agent ; l'application
     n'affirme jamais que l'envoi a été reçu. */
  function partager(ids) {
    S.mission((app.missionCourante || {}).id).then(function (m) {
      return chargerFichiers(ids).then(function (l) {
        if (!l.length) return;
        var fichiers = l.map(function (x) { return x.fichier; }), total = fichiers.reduce(function (s, f) { return s + f.size; }, 0);
        var lourd = l.some(function (x) { return x.media.type === 'VIDEO' && x.fichier.size > SEUIL_WHATSAPP_MEDIA; });
        var conseil = '<p class="fp-note">Pour garder le fichier <b>intact et vérifiable</b> (empreinte, coordonnées), choisissez dans WhatsApp <b>📎 → Document</b>. Envoyé « en photo / vidéo », WhatsApp recompresse le fichier : le bandeau reste visible, mais l\'empreinte change et les coordonnées EXIF sont supprimées.</p>' +
          (lourd ? '<p class="fp-note fp-note-warn">Vidéo de plus de ' + C.octetsTexte(SEUIL_WHATSAPP_MEDIA) + ' : WhatsApp peut refuser ou fortement compresser l\'envoi « en vidéo ». Envoyez-la en Document, ou exportez le dossier en ZIP par lots.</p>' : '');
        if (!peutPartager(fichiers)) {
          return ouvrirDialogue('Partage', '<p>Le partage direct de fichiers n\'est pas disponible dans ce navigateur. Téléchargez les fichiers, puis joignez-les depuis WhatsApp (📎 → Document).</p>' + conseil +
            '<div class="fp-actions"><button class="fp-btn fp-btn-principal" data-telecharger="' + esc(ids.join(',')) + '">Télécharger ' + l.length + ' fichier(s) (' + C.octetsTexte(total) + ')</button></div>');
        }
        ouvrirDialogue('Partager ' + l.length + ' fichier(s) · ' + C.octetsTexte(total), conseil + '<div class="fp-actions"><button class="fp-btn fp-btn-principal" data-partage-go="' + esc(ids.join(',')) + '">Ouvrir le partage</button><button class="fp-btn" data-fermer>Annuler</button></div>');
        app.partagePret = { fichiers: fichiers, texte: m ? texteMission(m, l) : '' };
      });
    });
  }
  function lancerPartage() {
    var p = app.partagePret; if (!p) return;
    nav.share({ files: p.fichiers, title: 'AFLP FIELD PROOF', text: p.texte }).then(function () {
      fermerDialogue(); avis('Partage transmis à l\'application choisie. Vérifiez l\'envoi dans celle-ci : FIELD PROOF ne peut pas confirmer la réception.', 'info', 8000);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return avis('Partage annulé.', 'warn');
      avis('Partage impossible : ' + (e && e.message || e) + '. Utilisez « Télécharger » puis joignez le fichier dans WhatsApp.', 'ko', 9000);
    });
  }

  /* Export ZIP par lots : ZIP « stocké » assemblé en Blob à partir des
     fichiers déjà sur disque (aucune copie complète en mémoire). */
  function exporter(idMission) {
    Promise.all([S.mission(idMission), S.medias(idMission)]).then(function (r) {
      var m = r[0], ms = r[1].filter(function (x) { return x.statut !== 'ENREGISTREMENT'; });
      if (!m) return;
      ouvrirDialogue('Préparation de l\'export', '<p id="fpProgExport">Calcul des contrôles des fichiers…</p><progress id="fpBarreExport" max="1" value="0"></progress>');
      var manJson = C.manifesteJson(m, ms), manCsv = C.manifesteCsv(m, ms);
      var lisez = 'AFLP FIELD PROOF — dossier de mission ' + m.id + '\r\n\r\nActivité : ' + m.activite + '\r\nCluster / village : ' + m.cluster + ' / ' + m.village + '\r\nAgent : ' + m.agent + '\r\nCréé le : ' + C.dateHeureAbj(m.creeLe) + '\r\n\r\n' +
        'Contenu : photos et vidéos finales (bandeau AFLP incrusté), manifeste.json, manifeste.csv (séparateur ;).\r\n' +
        'Contrôle : l\'empreinte SHA-256 de chaque fichier figure au manifeste. Un fichier modifié après sa création ne correspond plus.\r\n' +
        'Avertissement : date, heure et position proviennent du téléphone ; elles ne constituent pas une preuve certifiée.\r\n';
      return chargerFichiers(ms.map(function (x) { return x.id; })).then(function (l) {
        var faits = 0, entrees = [];
        function suite(i) {
          if (i >= l.length) return Promise.resolve();
          return S.crcBlob(l[i].fichier).then(function (crc) {
            entrees.push({ nom: 'medias/' + l[i].fichier.name, taille: l[i].fichier.size, crc: crc, quand: l[i].media.debut, blob: l[i].fichier });
            faits++; var b = $('#fpBarreExport'); if (b) b.value = faits / Math.max(1, l.length);
            var t = $('#fpProgExport'); if (t) t.textContent = 'Contrôle des fichiers : ' + faits + ' / ' + l.length;
            return suite(i + 1);
          });
        }
        return suite(0).then(function () {
          var groupes = C.lots(entrees, LOT_MAX), zips = [];
          groupes.forEach(function (g, k) {
            var suffixe = groupes.length > 1 ? '_lot' + (k + 1) + '-sur-' + groupes.length : '';
            var j = Object.assign({}, manJson, { lot: { numero: k + 1, total: groupes.length, fichiers: g.map(function (e) { return e.nom.replace('medias/', ''); }) } });
            var txt = [
              { nom: 'LISEZ-MOI.txt', octets: utf8(lisez) },
              { nom: 'manifeste.json', octets: utf8(JSON.stringify(j, null, 2)) },
              { nom: 'manifeste.csv', octets: utf8(manCsv) }
            ];
            var ent = txt.map(function (t) { return { nom: t.nom, taille: t.octets.length, crc: C.crc32(t.octets), quand: new Date().toISOString(), blob: new Blob([t.octets]) }; }).concat(g);
            var plan = C.planZip(ent);
            var blob = new Blob(plan.segments.map(function (s) { return s.octets ? s.octets : ent[s.fichier].blob; }), { type: 'application/zip' });
            zips.push(new File([blob], 'AFLP_' + m.id + '_' + C.slug(m.village) + suffixe + '.zip', { type: 'application/zip' }));
          });
          app.exportPret = zips;
          var tout = zips.reduce(function (s, z) { return s + z.size; }, 0);
          ouvrirDialogue('Export prêt', '<p>' + zips.length + ' archive(s) ZIP · ' + C.octetsTexte(tout) + ' · ' + ms.length + ' média(s) + manifeste JSON/CSV.</p>' +
            (l.length < ms.length ? '<p class="fp-note fp-note-warn">' + (ms.length - l.length) + ' média(s) sans copie locale ne sont pas dans l\'archive (voir la galerie).</p>' : '') +
            '<ul class="fp-zips">' + zips.map(function (z, i) { return '<li><span class="fp-mono">' + esc(z.name) + '</span> · ' + C.octetsTexte(z.size) + '<div class="fp-actions"><button class="fp-btn fp-btn-petit" data-zip-dl="' + i + '">Télécharger</button>' + (peutPartager([z]) ? '<button class="fp-btn fp-btn-petit" data-zip-share="' + i + '">Partager</button>' : '') + '</div></li>'; }).join('') + '</ul>' +
            '<p class="fp-note">La préparation fonctionne hors ligne. L\'envoi pourra se faire dès que le réseau sera disponible.</p>');
        });
      });
    }).catch(function (e) { avis('Export impossible : ' + (e && e.message || e), 'ko', 9000); });
  }
  function utf8(s) { return new TextEncoder().encode(s); }

  /* -- Vue : capture ------------------------------------------------------- */
  function arreterCapture() {
    if (app.enreg && app.enreg.etat === 'ENREGISTREMENT') app.enreg.arreter('AGENT');
    K.fermerCamera(app.flux); app.flux = null;
    if (app.loc) { app.loc.arreter(); app.loc = null; }
    clearInterval(app.ticBandeau); app.capture = null; doc.body.classList.remove('fp-mode-capture');
  }
  function vueCapture(idMission, mode) {
    liberer(); var actuel = jeton();
    S.mission(idMission).then(function (m) {
      if (!actuel()) return;
      if (!m) return aller('#accueil');
      app.capture = { mission: m, mode: mode };
      doc.body.classList.add('fp-mode-capture');
      var video = mode === 'VIDEO';
      var h = '<div class="fp-capture">' +
        '<div class="fp-capture-haut"><a class="fp-btn fp-btn-petit" href="#mission/' + esc(m.id) + '" data-quitter-capture>← Dossier</a>' +
        '<div class="fp-bascule" role="tablist" aria-label="Mode de capture"><a role="tab" aria-selected="' + !video + '" class="' + (!video ? 'fp-actif' : '') + '" href="#capture/' + esc(m.id) + '/PHOTO">PHOTO</a><a role="tab" aria-selected="' + video + '" class="' + (video ? 'fp-actif' : '') + '" href="#capture/' + esc(m.id) + '/VIDEO">VIDÉO</a></div>' +
        '<span id="fpGps" class="fp-etat">GPS…</span></div>' +
        '<div class="fp-viseur"><video id="fpCam" playsinline muted autoplay></video><div id="fpChrono" class="fp-chrono" hidden>00:00</div><div id="fpCamMsg" class="fp-cam-msg">Ouverture de la caméra…</div></div>' +
        '<div class="fp-bandeau-apercu" id="fpBandeauApercu" aria-label="Aperçu du bandeau qui sera incrusté"></div>' +
        '<p class="fp-alerte" id="fpAlerte" role="alert" hidden></p>' +
        (video ? '<div class="fp-options"><label>Qualité <select id="fpQualite"><option value="STANDARD">' + esc(C.QUALITES.STANDARD.libelle) + '</option><option value="HAUTE">' + esc(C.QUALITES.HAUTE.libelle) + '</option></select></label>' +
          '<label>Durée recommandée <select id="fpDureeReco"><option value="60">1 min</option><option value="120">2 min</option><option value="180">3 min</option><option value="300">5 min</option></select></label><span id="fpEstimation" class="fp-note"></span></div>' : '') +
        '<div class="fp-commandes">' + (video ? '<button class="fp-declencheur fp-rec" id="fpDeclencheur" aria-label="Démarrer l\'enregistrement" disabled><span></span></button>' : '<button class="fp-declencheur" id="fpDeclencheur" aria-label="Prendre la photo" disabled><span></span></button>') +
        '<button class="fp-btn fp-btn-petit" id="fpRetourner" disabled>⟲ Caméra avant / arrière</button></div>' +
        '<p class="fp-note fp-centre">Informez les personnes filmées ou photographiées et respectez leur refus. ' + (video ? 'Le bandeau est incrusté dans la vidéo, avec la position relevée au début.' : 'Le bandeau est ajouté sous la photo, sans masquer la scène.') + '</p>' +
        '<div id="fpRevue"></div></div>';
      vue().innerHTML = h;
      if (video) {
        $('#fpQualite').value = pref('qualite', 'STANDARD');
        $('#fpDureeReco').value = pref('dureeReco', String(C.DUREE_RECOMMANDEE_S));
        var est = function () { $('#fpEstimation').textContent = '≈ ' + C.octetsTexte(C.tailleVideoEstimee($('#fpQualite').value, +$('#fpDureeReco').value)) + ' pour la durée recommandée'; };
        $('#fpQualite').addEventListener('change', function () { setPref('qualite', this.value); est(); demarrerCamera(); });
        $('#fpDureeReco').addEventListener('change', function () { setPref('dureeReco', this.value); est(); });
        est();
        if (!K.videoDisponible()) alerte('Ce navigateur ne permet pas d\'enregistrer une vidéo avec bandeau incrusté. Utilisez Chrome (Android) ou Safari (iPhone, iOS 15 ou plus) à jour.');
      }
      app.loc = new K.Localisateur();
      app.loc.abonner(function (l) {
        var g = $('#fpGps'); if (!g) return;
        var pos = l.position(), s = C.statutGps(pos);
        g.textContent = pos ? 'GPS ' + C.precisionTexte(pos) : (l.erreur ? 'Sans GPS' : 'GPS…');
        g.className = 'fp-etat ' + (s.code === 'OK' ? 'fp-ok' : 'fp-ko');
        g.title = l.erreur || s.libelle;
        if (l.erreur && !pos) alerte(l.erreur, true);
      });
      app.loc.demarrer();
      app.face = app.face || 'environment';
      demarrerCamera();
      app.ticBandeau = setInterval(apercuBandeau, 1000); apercuBandeau();
    }).catch(erreurVue);
  }
  function alerte(t, douce) { var a = $('#fpAlerte'); if (!a) return; a.hidden = !t; a.textContent = t || ''; a.className = 'fp-alerte' + (douce ? ' fp-alerte-douce' : ''); }
  function metaCapture() {
    var c = app.capture, m = c.mission;
    return { type: c.mode, agent: m.agent, cluster: m.cluster, village: m.village, activite: m.activite, gpsDebut: app.loc ? app.loc.position() : null, debut: new Date().toISOString() };
  }
  function apercuBandeau() {
    var z = $('#fpBandeauApercu'); if (!z || !app.capture) return;
    var meta = metaCapture(); meta.idMedia = app.capture.prochainId || '…';
    if (app.enreg && app.enreg.etat === 'ENREGISTREMENT') { meta.debut = app.enreg.cfg.meta.debut; meta.gpsDebut = app.enreg.cfg.meta.gpsDebut; meta.dureeMs = app.enreg.dureeMs(); }
    z.innerHTML = C.lignesBandeau(meta).map(function (l, i) { return '<div class="fp-bl' + (i === 0 ? ' fp-bl-titre' : '') + '">' + esc(l) + '</div>'; }).join('');
  }
  function prochainId() {
    var c = app.capture;
    return S.medias(c.mission.id).then(function (l) {
      var n = l.filter(function (x) { return x.type === c.mode; }).reduce(function (mx, x) { return Math.max(mx, parseInt(x.id.slice(-2), 10) || 0); }, 0);
      c.prochainId = C.idMedia(c.mission.id, c.mode, n + 1); return c.prochainId;
    });
  }
  function demarrerCamera() {
    var c = app.capture; if (!c) return;
    K.fermerCamera(app.flux); app.flux = null;
    var dec = $('#fpDeclencheur'), msg = $('#fpCamMsg'), cam = $('#fpCam');
    if (!dec || !msg || !cam) return;
    dec.disabled = true; msg.hidden = false; msg.textContent = 'Ouverture de la caméra…';
    var q = $('#fpQualite') ? $('#fpQualite').value : 'STANDARD';
    K.ouvrirCamera({ mode: c.mode, qualite: q, face: app.face }).then(function (r) {
      if (!app.capture || !doc.body.contains(cam)) return K.fermerCamera(r.flux);
      app.flux = r.flux; c.micro = r.micro;
      cam.srcObject = r.flux;
      var p = cam.play(); if (p && p.catch) p.catch(function () {});
      cam.onloadedmetadata = function () { msg.hidden = true; dec.disabled = false; $('#fpRetourner').disabled = false; };
      if (c.mode === 'VIDEO') alerte(r.alerteMicro || '', true);
      return prochainId();
    }).catch(function (e) {
      if (!doc.body.contains(msg)) return;
      msg.hidden = false; msg.textContent = e.message;
      alerte(e.message + ' Aucune photo de la galerie ne peut remplacer une capture : la preuve doit être prise maintenant.');
    });
  }

  /* Photo : capture → revue → reprendre ou valider. */
  function prendrePhoto() {
    var c = app.capture, cam = $('#fpCam'), meta = metaCapture();
    meta.idMedia = c.prochainId;
    $('#fpDeclencheur').disabled = true;
    K.composerPhoto(cam, meta).then(function (r) {
      c.enAttente = { meta: meta, blob: r.blob, largeur: r.largeur, hauteur: r.hauteur, mime: 'image/jpeg' };
      revue(urlObjet(r.blob), false);
    }).catch(function (e) { alerte(e.message); $('#fpDeclencheur').disabled = false; });
  }
  function revue(url, video) {
    var z = $('#fpRevue'), c = app.capture, a = c.enAttente;
    z.innerHTML = '<div class="fp-revue"><h2>Vérifiez ' + (video ? 'la vidéo' : 'la photo') + ' avant de l\'enregistrer</h2>' +
      (video ? '<video class="fp-lecteur" src="' + url + '" controls playsinline></video>' : '<img class="fp-lecteur" src="' + url + '" alt="Aperçu de la photo avec bandeau AFLP">') +
      '<p class="fp-note">' + esc(a.meta.idMedia) + ' · ' + C.octetsTexte(a.blob.size) + (video ? ' · ' + C.duree(a.dureeMs) + (c.micro ? '' : ' · <b>muette</b>') : '') + '</p>' +
      (a.alerte ? '<p class="fp-note fp-note-warn">' + esc(a.alerte) + '</p>' : '') +
      '<label>Commentaire (facultatif)<input id="fpComMedia" maxlength="300"></label>' +
      '<div class="fp-actions"><button class="fp-btn" data-reprendre>' + (video ? 'Recommencer' : 'Reprendre la photo') + '</button><button class="fp-btn fp-btn-principal" data-valider>Valider et enregistrer</button></div></div>';
    z.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function reprendre() {
    var c = app.capture, a = c.enAttente;
    c.enAttente = null; $('#fpRevue').innerHTML = '';
    var fin = a && a.meta.type === 'VIDEO' ? S.supprimerMedia(a.meta.idMedia) : Promise.resolve();
    fin.then(function () { $('#fpDeclencheur').disabled = false; $('#fpChrono').hidden = true; });
  }
  /* Vignette légère (≈ 320 px) gardée dans le registre pour la galerie. */
  function vignette(source) {
    try {
      var w = source.videoWidth || source.naturalWidth, h = source.videoHeight || source.naturalHeight; if (!w || !h) return null;
      var k = 320 / w, cv = doc.createElement('canvas'); cv.width = 320; cv.height = Math.round(h * k);
      cv.getContext('2d').drawImage(source, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/jpeg', 0.7);
    } catch (e) { return null; }
  }
  function valider() {
    var c = app.capture, a = c.enAttente, m = c.mission; if (!a) return;
    var bouton = $('[data-valider]'); bouton.disabled = true; bouton.textContent = 'Enregistrement…';
    var img = $('#fpRevue .fp-lecteur');
    var vig = a.vignette || vignette(img);
    S.empreinte(a.blob).then(function (sha) {
      var x = {
        id: a.meta.idMedia, missionId: m.id, type: a.meta.type, statut: a.statut || 'FINAL', agent: m.agent, cluster: m.cluster, village: m.village,
        debut: a.meta.debut, fin: a.fin || null, dureeMs: a.dureeMs != null ? a.dureeMs : null, gpsDebut: a.meta.gpsDebut, gpsFin: a.gpsFin || null,
        micro: a.meta.type === 'VIDEO' ? !!c.micro : null, mime: a.mime, largeur: a.largeur, hauteur: a.hauteur, taille: a.blob.size, sha256: sha,
        qualite: a.qualite || null, raisonArret: a.raison || null, galerie: 'NON_ENREGISTRE', local: 'NON', vignette: vig,
        commentaire: ($('#fpComMedia').value || '').trim(), appareil: nav.userAgent.slice(0, 160), application: 'AFLP FIELD PROOF ' + C.VERSION
      };
      /* Ordre : 1) fichier écrit et relu, 2) registre, 3) morceaux supprimés.
         Les morceaux (l'« original » de la vidéo) ne sont jamais effacés avant
         que le fichier final soit conservé et contrôlé. */
      return S.deposerFichier(x.id, a.blob, sha).then(function () { x.local = 'VERIFIE'; return S.enregistrerMedia(x); })
        .then(function () { return a.meta.type === 'VIDEO' ? S.effacerMorceaux(x.id) : null; })
        .then(function () { m[a.meta.type === 'VIDEO' ? 'nbVideos' : 'nbPhotos'] = (m[a.meta.type === 'VIDEO' ? 'nbVideos' : 'nbPhotos'] || 0) + 1; return S.enregistrerMission(m); })
        .then(function () { return S.persister(); })
        .then(function () {
          c.enAttente = null;
          $('#fpRevue').innerHTML = '<div class="fp-revue fp-revue-ok"><p><b>' + esc(x.id) + '</b> conservé dans l\'application (relu et contrôlé).</p><p class="fp-note fp-note-warn">Il n\'est <b>pas encore</b> dans la galerie du téléphone.</p><div class="fp-actions"><button class="fp-btn fp-btn-principal" data-galerie="' + esc(x.id) + '">Enregistrer dans la galerie</button><button class="fp-btn" data-continuer>Continuer la capture</button></div></div>';
          $('#fpDeclencheur').disabled = false; $('#fpChrono').hidden = true;
          return prochainId();
        });
    }).catch(function (e) {
      bouton.disabled = false; bouton.textContent = 'Valider et enregistrer';
      alerte(S.estQuota(e) ? 'Stockage du téléphone plein : libérez de l\'espace (anciennes vidéos déjà exportées, applications) puis validez à nouveau. Le fichier n\'est PAS enregistré.' : 'Enregistrement impossible : ' + (e.message || e) + '. Le fichier n\'est PAS enregistré.');
    });
  }

  /* Vidéo : démarrer / arrêter. */
  function basculerVideo() {
    var c = app.capture, dec = $('#fpDeclencheur');
    if (app.enreg && app.enreg.etat === 'ENREGISTREMENT') { dec.disabled = true; return app.enreg.arreter('AGENT'); }
    var q = $('#fpQualite').value, reco = +$('#fpDureeReco').value;
    S.espace().then(function (e) {
      var besoin = C.tailleVideoEstimee(q, reco);
      if (e && e.quota && e.libre < besoin && !confirmer('Espace disponible (' + C.octetsTexte(e.libre) + ') inférieur à l\'estimation pour ' + C.duree(reco * 1000) + ' (' + C.octetsTexte(besoin) + ').\nL\'enregistrement s\'arrêtera proprement si l\'espace manque, en conservant la partie filmée.\nDémarrer quand même ?')) return;
      var meta = metaCapture(); meta.idMedia = c.prochainId;
      /* Registre provisoire : permet de récupérer la vidéo si l'application
         est fermée pendant l'enregistrement. */
      return S.enregistrerMedia({ id: meta.idMedia, missionId: c.mission.id, type: 'VIDEO', statut: 'ENREGISTREMENT', debut: meta.debut, gpsDebut: meta.gpsDebut, micro: !!c.micro, qualite: q, agent: c.mission.agent, cluster: c.mission.cluster, village: c.mission.village, galerie: 'NON_ENREGISTRE', local: 'NON' }).then(function () {
        var averti = false;
        app.enreg = new K.Enregistreur({
          videoEl: $('#fpCam'), flux: app.flux, micro: c.micro, meta: meta, qualite: q,
          surEtat: function (en) {
            var rec = en.etat === 'ENREGISTREMENT';
            dec.classList.toggle('fp-en-cours', rec); dec.setAttribute('aria-label', rec ? 'Arrêter l\'enregistrement' : 'Démarrer l\'enregistrement');
            $('#fpChrono').hidden = false; $$('.fp-bascule a, #fpRetourner, #fpQualite, [data-quitter-capture]').forEach(function (b) { b.classList.toggle('fp-bloque', rec); if ('disabled' in b) b.disabled = rec; });
          },
          surTic: function (en) {
            var ms = en.dureeMs(), ch = $('#fpChrono'); if (!ch) return;
            ch.textContent = '● ' + C.duree(ms); ch.classList.toggle('fp-depasse', ms > reco * 1000);
            if (!en.alerteContinue && ms > 6000 && en.rang === 0) { en.alerteContinue = true; alerte('Ce téléphone ne livre pas la vidéo au fil de l\'enregistrement : si l\'application est coupée avant l\'arrêt, la séquence en cours peut être perdue. Préférez des séquences courtes.', true); }
            if (!averti && ms > reco * 1000) { averti = true; avis('Durée recommandée atteinte (' + C.duree(reco * 1000) + '). Vous pouvez continuer si nécessaire.', 'warn', 6000); }
          }
        });
        return app.enreg.demarrer().then(function () { dec.disabled = false; return app.enreg.finale || new Promise(function (ok) { var t = setInterval(function () { if (app.enreg.finale) { clearInterval(t); ok(app.enreg.finale); } }, 200); }); })
          .then(function (info) {
            var cam = $('#fpCam');
            meta.debut = info.debut;
            c.enAttente = { meta: meta, blob: info.blob, largeur: info.largeur, hauteur: info.hauteur, mime: info.mime, fin: info.fin, dureeMs: info.dureeMs, gpsFin: info.gpsFin, raison: info.raison, alerte: info.alerte || K.RAISONS[info.raison], qualite: q, vignette: vignette(cam) };
            if (info.alerte || K.RAISONS[info.raison]) alerte(info.alerte || K.RAISONS[info.raison]);
            revue(urlObjet(info.blob), true);
          });
      });
    }).catch(function (e) { alerte(e.message || String(e)); dec.disabled = false; });
  }

  /* Récupération d'un enregistrement interrompu. */
  function recuperer(mediaId) {
    Promise.all([S.media(mediaId), S.morceaux(mediaId)]).then(function (r) {
      var x = r[0], ms = r[1];
      if (!ms.length) return avis('Rien à récupérer.', 'warn');
      if (!x) { x = { id: mediaId, missionId: mediaId.replace(/-V\d+$/, ''), type: 'VIDEO', debut: new Date().toISOString(), galerie: 'NON_ENREGISTRE' }; }
      var type = (ms[0].blob.type || 'video/webm').split(';')[0], blob = new Blob(ms.map(function (m) { return m.blob; }), { type: type });
      return S.empreinte(blob).then(function (sha) {
        Object.assign(x, { statut: 'RECUPERE', mime: type, taille: blob.size, sha256: sha, raisonArret: 'INTERROMPU', dureeMs: x.dureeMs != null ? x.dureeMs : ms.length * 1000, fin: null, local: 'NON', commentaire: ((x.commentaire || '') + ' [Vidéo interrompue puis récupérée : durée approximative]').trim() });
        return S.deposerFichier(x.id, blob, sha);
      }).then(function () { x.local = 'VERIFIE'; return S.enregistrerMedia(x); })
        .then(function () { return S.effacerMorceaux(mediaId); })
        .then(function () { return S.mission(x.missionId).then(function (m) { if (m) { m.nbVideos = (m.nbVideos || 0) + 1; return S.enregistrerMission(m); } }); })
        .then(function () { avis('Vidéo ' + mediaId + ' récupérée dans son dossier.', 'ok'); aller('#mission/' + x.missionId); });
    }).catch(function (e) { avis('Récupération impossible : ' + (e.message || e), 'ko', 9000); });
  }

  /* -- Vue : contrôle d'un dossier reçu (responsables) --------------------- */
  function vueVerifier() {
    vue().innerHTML = '<a class="fp-retour" href="#accueil">← Accueil</a>' + entete('Contrôler un dossier reçu', 'Sélectionnez l\'archive ZIP exportée par un agent, ou les fichiers reçus avec leur <span class="fp-mono">manifeste.json</span>. Le contrôle se fait sur ce téléphone, sans envoi.') +
      '<section class="fp-carte"><label class="fp-depot">Choisir le ZIP ou les fichiers<input type="file" id="fpVerifFichiers" multiple accept=".zip,.json,.jpg,.jpeg,.mp4,.webm,.mov,application/zip,image/jpeg,video/*"></label><div id="fpVerifRes"></div></section>' +
      '<p class="fp-note">« Conforme » signifie que le fichier est identique à celui produit par FIELD PROOF sur le téléphone de l\'agent. Cela ne certifie ni l\'heure ni le lieu, qui proviennent du téléphone. Un fichier transmis « en photo / vidéo » par WhatsApp est recompressé : il apparaîtra « modifié » alors que son bandeau reste lisible.</p>';
    $('#fpVerifFichiers').addEventListener('change', function () { verifierFichiers(Array.prototype.slice.call(this.files)); });
  }
  function verifierFichiers(fichiers) {
    var z = $('#fpVerifRes'); z.innerHTML = '<p>Contrôle en cours…</p>';
    var calc = {}, manifeste = null;
    function traiterZip(f) {
      return S.lireTranche(f, 0, f.size).then(function (buf) {
        var oct = new Uint8Array(buf), ents = C.lireZip(oct);
        return ents.reduce(function (p, e) {
          return p.then(function () {
            var data = oct.subarray(e.debut, e.debut + e.taille);
            if (e.methode !== 0) throw new Error('Archive compressée par un autre outil : contrôlez les fichiers extraits.');
            if (e.nom === 'manifeste.json') { manifeste = JSON.parse(new TextDecoder().decode(data)); return; }
            if (/^medias\//.test(e.nom)) calc[e.nom.replace(/^medias\//, '')] = C.sha256Hex(data);
          });
        }, Promise.resolve());
      });
    }
    fichiers.reduce(function (p, f) {
      return p.then(function () {
        if (/\.zip$/i.test(f.name)) return traiterZip(f);
        if (/manifeste\.json$/i.test(f.name)) return f.text().then(function (t) { manifeste = JSON.parse(t); });
        return S.empreinte(f).then(function (h) { calc[f.name] = h; });
      });
    }, Promise.resolve()).then(function () {
      if (!manifeste || manifeste.format !== 'AFLP-FIELD-PROOF/1') { z.innerHTML = '<p class="fp-erreur">Manifeste AFLP FIELD PROOF introuvable : ajoutez manifeste.json ou choisissez le ZIP exporté.</p>'; return; }
      var res = C.verifierDossier(manifeste, calc), lot = manifeste.lot;
      if (lot) res = res.filter(function (r) { return r.statut !== 'ABSENT' || lot.fichiers.indexOf(r.fichier) >= 0; });
      var mis = manifeste.mission || {};
      var lib = { CONFORME: ['fp-b-ok', 'Conforme'], MODIFIE: ['fp-b-ko', 'Modifié depuis sa création'], ABSENT: ['fp-b-warn', 'Absent'], HORS_MANIFESTE: ['fp-b-warn', 'Hors manifeste'] };
      z.innerHTML = '<h2>' + esc(mis.activite || '') + ' · ' + esc(mis.cluster || '') + ' / ' + esc(mis.village || '') + '</h2><p>Agent : ' + esc(mis.agent || '') + ' · Mission <span class="fp-mono">' + esc(mis.id || '') + '</span>' + (lot && lot.total > 1 ? ' · lot ' + lot.numero + '/' + lot.total : '') + '</p>' +
        '<div class="fp-table-defil"><table class="fp-table"><thead><tr><th>Fichier</th><th>Statut</th><th>Empreinte calculée</th></tr></thead><tbody>' +
        res.map(function (r) { var l = lib[r.statut]; return '<tr><td class="fp-mono fp-casse">' + esc(r.fichier) + '</td><td><span class="fp-badge ' + l[0] + '">' + l[1] + '</span></td><td class="fp-mono fp-casse">' + esc(r.calcule ? r.calcule.slice(0, 16) + '…' : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }).catch(function (e) { z.innerHTML = '<p class="fp-erreur">Contrôle impossible : ' + esc(e.message || e) + '</p>'; });
  }

  /* -- Vue : aide ---------------------------------------------------------- */
  function vueAide() {
    vue().innerHTML = '<a class="fp-retour" href="#accueil">← Accueil</a>' + entete('Autorisations et bonnes pratiques', '') +
      '<section class="fp-carte fp-texte"><h2>Pourquoi ces autorisations ?</h2><ul>' +
      '<li><b>Caméra</b> : prendre la photo ou la vidéo maintenant, dans l\'application. Une image de la galerie ne peut pas servir de preuve.</li>' +
      '<li><b>Micro</b> (vidéo seulement) : enregistrer le son. Si vous refusez, la vidéo est muette et le dossier l\'indique.</li>' +
      '<li><b>Localisation</b> : lue uniquement pendant l\'écran de capture, pour inscrire la position sur le média. Elle n\'est jamais envoyée ni suivie en continu. Sans GPS, le média porte « LOCALISATION NON VÉRIFIÉE ».</li>' +
      '<li><b>Galerie / fichiers</b> : c\'est vous qui enregistrez chaque fichier dans la galerie et qui choisissez de le partager. Rien ne part tout seul.</li></ul>' +
      '<h2>Personnes photographiées ou filmées</h2><ul><li>Annoncez le but (dossier de mission AFLP) avant de photographier ou de filmer.</li><li>Respectez tout refus. Ne filmez pas d\'enfants sans l\'accord d\'un parent présent.</li><li>N\'utilisez pas ces images hors du cadre ANAGROCI.</li></ul>' +
      '<h2>Sur le terrain</h2><ul><li>Préparez le téléphone au bureau : connexion une fois, villages mis à jour, batterie chargée.</li><li>Gardez l\'écran allumé pendant une vidéo : verrouiller le téléphone arrête l\'enregistrement (la partie filmée est conservée).</li><li>Vidéo recommandée : 2 minutes par séquence (≈ 40 Mo en 720p). Plusieurs séquences courtes valent mieux qu\'une très longue.</li><li>Pour transmettre une preuve vérifiable par WhatsApp : 📎 → <b>Document</b>.</li>' +
      '<li>La copie dans l\'application sert à repartager et exporter. La copie de référence est celle de votre galerie : supprimez la copie de l\'application seulement après un export confirmé.</li></ul>' +
      '<p class="fp-note">Date, heure et position viennent du téléphone : elles ne sont pas une preuve certifiée contre la falsification.</p></section>';
  }

  /* -- Routeur et événements ---------------------------------------------- */
  function erreurVue(e) { vue().innerHTML = '<div class="fp-carte"><p class="fp-erreur">' + esc(e && e.message || e) + '</p><a class="fp-btn" href="#accueil">Accueil</a></div>'; }
  function rafraichir() { if (/^#mission\//.test(location.hash)) vueMission(location.hash.split('/')[1]); }
  function router() {
    var h = location.hash || '#accueil', p = h.split('/');
    app.jeton = (app.jeton || 0) + 1;
    if (app.capture && p[0] !== '#capture') arreterCapture();
    else if (app.capture && p[0] === '#capture') { K.fermerCamera(app.flux); app.flux = null; if (app.loc) { app.loc.arreter(); app.loc = null; } clearInterval(app.ticBandeau); app.capture = null; }
    fermerDialogue();
    $$('.fp-nav a').forEach(function (a) { a.classList.toggle('fp-actif', a.getAttribute('href') === p[0] || (p[0] === '#mission' && a.getAttribute('href') === '#accueil')); });
    if (p[0] === '#nouvelle') vueNouvelle();
    else if (p[0] === '#mission' && p[1]) vueMission(p[1]);
    else if (p[0] === '#capture' && p[1]) vueCapture(p[1], p[2] === 'VIDEO' ? 'VIDEO' : 'PHOTO');
    else if (p[0] === '#verifier') vueVerifier();
    else if (p[0] === '#aide') vueAide();
    else vueAccueil();
    var main = vue(); if (main && main.focus && p[0] !== '#capture') main.focus({ preventScroll: true });
    global.scrollTo(0, 0);
  }
  function selection() { return $$('.fp-coche:checked').map(function (c) { return c.value; }); }
  function clic(ev) {
    var t = ev.target.closest('[data-aller],[data-preparer],[data-recuperer],[data-ouvrir],[data-details],[data-galerie],[data-partager],[data-partager-selection],[data-galerie-selection],[data-exporter],[data-com-mission],[data-supprimer-mission],[data-supprimer-media],[data-confirmer-galerie],[data-fermer],[data-telecharger],[data-partage-go],[data-zip-dl],[data-zip-share],[data-reprendre],[data-valider],[data-continuer],#fpDeclencheur,#fpRetourner,#fpTout,#fpDialogueFermer');
    if (!t) return;
    var d = t.dataset;
    if (t.id === 'fpTout') { $$('.fp-coche').forEach(function (c) { c.checked = t.checked; }); return; }
    if (t.id === 'fpDialogueFermer' || 'fermer' in d) return fermerDialogue();
    if (t.id === 'fpDeclencheur') { if (t.disabled) return; return app.capture.mode === 'VIDEO' ? basculerVideo() : prendrePhoto(); }
    if (t.id === 'fpRetourner') { app.face = app.face === 'user' ? 'environment' : 'user'; return demarrerCamera(); }
    if ('aller' in d) return aller(d.aller);
    if ('preparer' in d) { if (!enLigne()) return avis('Hors ligne : la mise à jour des villages se fera au retour du réseau.', 'warn'); return preparerReferentiel(true).then(function () { avis(app.villages.length + ' village(s) préparés pour le mode hors ligne.', 'ok'); vueAccueil(); }); }
    if ('recuperer' in d) return recuperer(d.recuperer);
    if ('ouvrir' in d) return ouvrirMedia(d.ouvrir);
    if ('details' in d) return details(d.details);
    if ('galerie' in d) return versGalerie([d.galerie]);
    if ('partager' in d) return partager([d.partager]);
    if ('partagerSelection' in d) { var s1 = selection(); return s1.length ? partager(s1) : avis('Cochez d\'abord les photos ou vidéos à partager.', 'warn'); }
    if ('galerieSelection' in d) { var s2 = selection(); return s2.length ? versGalerie(s2) : avis('Cochez d\'abord les photos ou vidéos à enregistrer.', 'warn'); }
    if ('exporter' in d) return exporter(d.exporter);
    if ('partageGo' in d) return lancerPartage();
    if ('telecharger' in d) return chargerFichiers(d.telecharger.split(',')).then(function (l) { l.forEach(function (x, i) { setTimeout(function () { telecharger(x.fichier, x.fichier.name); }, i * 700); }); fermerDialogue(); });
    if ('zipDl' in d) { var z = app.exportPret[+d.zipDl]; return telecharger(z, z.name); }
    if ('zipShare' in d) { var z2 = app.exportPret[+d.zipShare]; return nav.share({ files: [z2], title: z2.name }).catch(function (e) { if (!e || e.name !== 'AbortError') avis('Partage impossible : ' + (e && e.message || e) + '. Utilisez « Télécharger ».', 'ko'); }); }
    if ('confirmerGalerie' in d) return confirmerGalerie(d.confirmerGalerie.split(','));
    if ('comMission' in d) return S.mission(d.comMission).then(function (m) { m.commentaire = $('#fpComMission').value.trim(); return S.enregistrerMission(m); }).then(function () { avis('Commentaire enregistré.', 'ok'); });
    if ('supprimerMedia' in d) { if (!confirmer('Supprimer ' + d.supprimerMedia + ' de l\'application ?\nLa copie déjà enregistrée dans la galerie n\'est pas touchée. Le numéro ne sera pas réattribué.')) return; return S.media(d.supprimerMedia).then(function (x) { return S.supprimerMedia(x.id).then(function () { return S.mission(x.missionId); }).then(function (m) { if (m) { var k = x.type === 'VIDEO' ? 'nbVideos' : 'nbPhotos'; m[k] = Math.max(0, (m[k] || 1) - 1); return S.enregistrerMission(m); } }); }).then(function () { fermerDialogue(); avis('Média supprimé de l\'application.', 'ok'); rafraichir(); }); }
    if ('supprimerMission' in d) { if (!confirmer('Supprimer toute la mission de ce téléphone ?\nLes copies déjà dans la galerie ne sont pas touchées. Exportez d\'abord le dossier si nécessaire.')) return; return S.supprimerMission(d.supprimerMission).then(function () { avis('Mission supprimée de l\'application.', 'ok'); aller('#accueil'); }); }
    if ('reprendre' in d) return reprendre();
    if ('valider' in d) return valider();
    if ('continuer' in d) { $('#fpRevue').innerHTML = ''; return; }
  }

  function demarrer(auth) {
    if (app.profil) return;
    app.auth = auth; app.profil = Object.assign({}, auth.profile);
    if (!app.profil.user_id) app.profil.user_id = app.profil.id || app.profil.email || 'inconnu';
    $('#fpQui').textContent = 'Connecté : ' + (app.profil.nom || app.profil.email || '') + ' · ' + (app.profil.role || '') + ' — identité reprise de FBMS.';
    doc.addEventListener('click', clic);
    global.addEventListener('hashchange', router);
    global.addEventListener('online', function () { majReseau(); preparerReferentiel(false); });
    global.addEventListener('offline', majReseau);
    majReseau();
    S.ouvrir().catch(function (e) { avis(e.message, 'ko', 12000); });
    preparerReferentiel(false).then(router, router);
  }
  if (global.ANAGROCI_AUTH) demarrer(global.ANAGROCI_AUTH);
  doc.addEventListener('anagroci:authenticated', function (ev) { demarrer(ev.detail || global.ANAGROCI_AUTH); });
  global.FP_APP = { app: app, router: router };
})(window);
