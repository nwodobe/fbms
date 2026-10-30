/* ============================================================================
   AFLP MOTO MANAGER — interface (moto/moto-app.js)
   ----------------------------------------------------------------------------
   Quatre espaces : MES MOTOS · OPÉRATIONS · PILOTAGE · FORMATION
   (+ ADMINISTRATION pour Branch Manager et Assistant Branch Manager).
   Toutes les écritures passent par les fonctions serveur moto_* : l'affichage
   d'un bouton ne confère aucun droit, le serveur décide.
   ========================================================================== */
(function (g) {
  'use strict';
  var C = g.MOTO_CORE, OFF = g.MOTO_OFFLINE, FORM = g.MOTO_FORMATION || [];
  var S = { sb: null, profil: null, classe: null, flotte: [], flotteLe: null, horsLigne: false, params: {}, beneficiaires: null };
  var CDN_XLSX = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  var CDN_QR = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

  /* -- Outils --------------------------------------------------------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function peut(d) { return C.peut(S.classe, d); }
  function vue() { return $('#motoVue'); }
  var TONS = { CONFORME: 'ok', APTE: 'ok', REMISE: 'ok', TRANSFEREE: 'ok', CONFIRMEE: 'ok', VERIFIE: 'ok', SYNCHRONISE: 'ok', VALIDE: 'ok', TERMINEE: 'ok', A_JOUR: 'ok', OK: 'ok', NORMAL: 'ok', CLOS: 'ok', REMIS_EN_SERVICE: 'ok', PAYE_DECLARE: 'ok', APPLIQUEE: 'ok',
    NON_CONFORME: 'ko', IMMOBILISEE: 'ko', ECHOUEE: 'ko', REJETE: 'ko', REJETEE: 'ko', DEPASSEE: 'ko', EXPIRE: 'ko', MANQUANT: 'ko', VERIFICATION_PRIORITAIRE: 'ko', CRITIQUE: 'ko', BLOQUE: 'ko', INVALIDE: 'ko', REFUSEE: 'ko',
    EN_REPARATION: 'warn', EN_VERIFICATION: 'warn', A_CONTROLER: 'warn', PREAFFECTEE: 'warn', REMISE_DECLAREE: 'warn', CONTESTEE: 'warn', A_VERIFIER: 'warn', PROCHE: 'warn', EXPIRE_BIENTOT: 'warn', VERIFICATION: 'warn', EN_ATTENTE: 'warn', PROPOSE: 'warn', DEMANDEE: 'warn', DEMANDE: 'warn', MAJEURE: 'warn' };
  var LIB_FILE = { EN_ATTENTE: 'En attente', SYNCHRONISE: 'Synchronisé', REJETE: 'Rejeté', BLOQUE: 'Bloqué (relance manuelle)' };
  function badgeFile(code, texte) { return '<span class="mm-badge mm-' + (TONS[code] || 'neutre') + '">' + esc(texte || LIB_FILE[code] || code) + '</span>'; }
  function badge(code, prefixe) { return '<span class="mm-badge mm-' + (TONS[code] || 'neutre') + '">' + (prefixe ? esc(prefixe) + ' · ' : '') + esc(C.libelle(code)) + '</span>'; }
  function toast(msg, ton) {
    var t = document.createElement('div'); t.className = 'mm-toast mm-' + (ton || 'info'); t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.classList.add('mm-toast-out'); }, 4200); setTimeout(function () { t.remove(); }, 4800);
  }
  function chargerScript(src) {
    return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('Chargement impossible : ' + src)); }; document.head.appendChild(s); });
  }
  function messageErreur(e) {
    var m = (e && (e.message || e.error_description || e.details)) || String(e || 'Erreur');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Réseau indisponible. Réessayez dès que la connexion revient.';
    return m;
  }
  async function rpc(nom, args) {
    if (!S.sb) throw new Error('Connexion aux données indisponible.');
    var r = await S.sb.rpc(nom, args || {});
    if (r.error) throw new Error(messageErreur(r.error));
    return r.data;
  }
  async function lireTable(table, construire) {
    var q = S.sb.from(table).select('*');
    if (construire) q = construire(q);
    var r = await q;
    if (r.error) throw new Error(messageErreur(r.error));
    return r.data || [];
  }
  function attendreClient() {
    return new Promise(function (ok) {
      var n = 0, t = setInterval(function () {
        n++;
        if (g.supabase && g.ANAGROCI_SUPABASE_URL && g.ANAGROCI_SUPABASE_ANON) { clearInterval(t); ok(g.supabase.createClient(g.ANAGROCI_SUPABASE_URL, g.ANAGROCI_SUPABASE_ANON)); }
        else if (n > 150) { clearInterval(t); ok(null); }
      }, 80);
    });
  }
  function isoDepuisLocal(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function maintenantLocal() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  function aujourdhui() { return maintenantLocal().slice(0, 10); }

  /* -- Formulaires génériques ---------------------------------------------- */
  function champ(f) {
    var id = 'f_' + f.n, req = f.req ? ' required' : '', aide = f.aide ? '<small class="mm-aide">' + esc(f.aide) + '</small>' : '';
    var v = f.v == null ? '' : f.v;
    if (f.t === 'select') {
      return '<div class="mm-champ' + (f.large ? ' mm-large' : '') + '"><label for="' + id + '">' + esc(f.l) + (f.req ? ' *' : '') + '</label><select id="' + id + '" name="' + f.n + '"' + req + '>' +
        (f.vide !== false ? '<option value="">— Choisir —</option>' : '') +
        (f.o || []).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>' + aide + '</div>';
    }
    if (f.t === 'textarea') return '<div class="mm-champ mm-large"><label for="' + id + '">' + esc(f.l) + (f.req ? ' *' : '') + '</label><textarea id="' + id + '" name="' + f.n + '"' + req + (f.min ? ' minlength="' + f.min + '"' : '') + '>' + esc(v) + '</textarea>' + aide + '</div>';
    if (f.t === 'checkbox') return '<div class="mm-champ mm-large mm-case"><label><input type="checkbox" name="' + f.n + '"' + (v ? ' checked' : '') + '> ' + esc(f.l) + '</label>' + aide + '</div>';
    if (f.t === 'oui_non') {
      return '<fieldset class="mm-champ mm-large mm-ouinon"><legend>' + esc(f.l) + (f.req ? ' *' : '') + '</legend>' +
        '<label><input type="radio" name="' + f.n + '" value="true"' + req + '> ' + esc(f.oui || 'Oui') + '</label>' +
        '<label><input type="radio" name="' + f.n + '" value="false"' + req + '> ' + esc(f.non || 'Non') + '</label>' + aide + '</fieldset>';
    }
    var type = { nombre: 'number', date: 'date', dateheure: 'datetime-local', fichier: 'file', texte: 'text' }[f.t || 'texte'] || 'text';
    var extra = (f.t === 'nombre' ? ' inputmode="decimal" step="' + (f.pas || 'any') + '" min="' + (f.mini == null ? 0 : f.mini) + '"' : '') +
      (f.t === 'fichier' ? ' accept="' + (f.accept || 'image/*,application/pdf') + '"' + (f.capture ? ' capture="environment"' : '') : '') +
      (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + (f.max ? ' max="' + esc(f.max) + '"' : '');
    return '<div class="mm-champ' + (f.large ? ' mm-large' : '') + '"><label for="' + id + '">' + esc(f.l) + (f.req ? ' *' : '') + '</label><input id="' + id + '" type="' + type + '" name="' + f.n + '"' +
      (f.t === 'fichier' ? '' : ' value="' + esc(v) + '"') + req + extra + '>' + aide + '</div>';
  }
  function lireFormulaire(form) {
    var o = {};
    $$('input,select,textarea', form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value === 'true' ? true : el.value === 'false' ? false : el.value; }
      else if (el.type === 'file') o[el.name] = el.files && el.files[0] ? el.files[0] : null;
      else o[el.name] = el.value.trim() === '' ? null : el.value.trim();
    });
    return o;
  }
  function itemsHtml(liste, prefixe) {
    return '<div class="mm-items">' + liste.map(function (it, i) {
      return '<div class="mm-item' + (it.critique ? ' mm-item-critique' : '') + '"><span>' + esc(it.libelle) + (it.critique ? ' <b class="mm-critique">critique</b>' : '') + '</span>' +
        '<label><input type="radio" name="' + prefixe + i + '" value="ok" required> Conforme</label>' +
        '<label><input type="radio" name="' + prefixe + i + '" value="ko"> Défaut</label></div>';
    }).join('') + '</div>';
  }
  function lireItems(form, liste, prefixe) {
    return liste.map(function (it, i) {
      var c = form.querySelector('input[name="' + prefixe + i + '"]:checked');
      return { code: it.code, libelle: it.libelle, critique: !!it.critique, ok: c ? c.value === 'ok' : null };
    });
  }

  /* Fenêtre modale : `soumettre(valeurs, form)` renvoie une promesse ; une
     erreur serveur est affichée dans la fenêtre sans perdre la saisie. */
  function modale(titre, corps, soumettre, libelleBouton) {
    var d = document.createElement('dialog'); d.className = 'mm-modale';
    d.innerHTML = '<form method="dialog" class="mm-modale-form" novalidate><header><h2>' + esc(titre) + '</h2><button type="button" class="mm-fermer" aria-label="Fermer">×</button></header>' +
      '<div class="mm-modale-corps">' + corps + '</div><p class="mm-erreur" role="alert" hidden></p>' +
      '<footer><button type="button" class="mm-btn mm-secondaire mm-annuler">Annuler</button>' + (soumettre ? '<button type="submit" class="mm-btn mm-primaire">' + esc(libelleBouton || 'Enregistrer') + '</button>' : '') + '</footer></form>';
    document.body.appendChild(d);
    function fermer() { try { d.close(); } catch (e) {} d.remove(); }
    $('.mm-fermer', d).onclick = fermer; $('.mm-annuler', d).onclick = fermer;
    var form = $('form', d), err = $('.mm-erreur', d);
    form.addEventListener('submit', async function (e) {
      e.preventDefault(); if (!soumettre) return fermer();
      if (!form.checkValidity()) { err.hidden = false; err.textContent = 'Complétez les champs obligatoires (*).'; form.reportValidity(); return; }
      var btn = $('button[type=submit]', form); btn.disabled = true; err.hidden = true;
      try { var r = await soumettre(lireFormulaire(form), form); fermer(); if (r !== false) toast(typeof r === 'string' ? r : 'Enregistré.', 'ok'); }
      catch (ex) { err.hidden = false; err.textContent = messageErreur(ex); btn.disabled = false; }
    });
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    var premier = $('input,select,textarea', d); if (premier) premier.focus();
    return d;
  }

  /* -- Fichiers : compression des photos et dépôt privé --------------------- */
  function compresser(fichier) {
    if (!fichier || !/^image\//.test(fichier.type)) return Promise.resolve(fichier);
    return new Promise(function (ok) {
      var img = new Image(), url = URL.createObjectURL(fichier);
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { ok(b || fichier); }, 'image/jpeg', 0.75);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ok(fichier); };
      img.src = url;
    });
  }
  function extension(blob, nom) { if (blob && blob.type === 'application/pdf') return 'pdf'; if (blob && blob.type === 'image/png') return 'png'; if (blob && blob.type === 'image/webp') return 'webp'; return /\.pdf$/i.test(nom || '') ? 'pdf' : 'jpg'; }
  async function deposer(motoId, categorie, fichier) {
    if (!fichier) return null;
    if (fichier.size > 10 * 1048576) throw new Error('Fichier trop volumineux (10 Mo maximum).');
    var blob = await compresser(fichier), ext = extension(blob, fichier.name);
    var chemin = motoId + '/' + categorie + '/' + OFF.uuid() + '.' + ext;
    var r = await S.sb.storage.from('moto-documents').upload(chemin, blob, { upsert: false, contentType: blob.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg') });
    if (r.error) throw new Error('Dépôt du fichier refusé : ' + messageErreur(r.error));
    return { chemin: chemin, nom: fichier.name };
  }
  async function ouvrirFichier(chemin) {
    var r = await S.sb.storage.from('moto-documents').createSignedUrl(chemin, 300);
    if (r.error) return toast('Accès au fichier refusé : ' + messageErreur(r.error), 'ko');
    g.open(r.data.signedUrl, '_blank', 'noopener');
  }

  /* -- Données ------------------------------------------------------------- */
  async function chargerFlotte() {
    try {
      S.flotte = await lireTable('moto_v_flotte', function (q) { return q.order('code'); });
      S.flotteLe = new Date().toISOString(); S.horsLigne = false;
      OFF.memoriser('flotte', S.flotte);
      await Promise.all(S.flotte.map(function (m) { return OFF.reconcilierImmobilisation(m); }));
    } catch (e) {
      var c = await OFF.relire('flotte');
      if (c) { S.flotte = c.valeur || []; S.flotteLe = c.le; S.horsLigne = true; }
      else throw e;
    }
    return S.flotte;
  }
  async function chargerParametres() {
    try {
      var rows = await lireTable('moto_parametres');
      rows.forEach(function (r) { S.params[r.cle] = r; });
      OFF.memoriser('parametres', rows);
    } catch (e) { var c = await OFF.relire('parametres'); (c && c.valeur || []).forEach(function (r) { S.params[r.cle] = r; }); }
  }
  function seuils() { return { seuil1: S.params.conso_seuil_verification_1 && S.params.conso_seuil_verification_1.valeur, seuil2: S.params.conso_seuil_verification_2 && S.params.conso_seuil_verification_2.valeur }; }
  function motoParId(id) { return S.flotte.filter(function (m) { return m.id === id; })[0] || null; }
  function mesMotos() {
    var uid = S.profil && S.profil.user_id;
    if (S.classe === 'UNITE') return S.flotte.filter(function (m) { return m.beneficiaire_id === uid && ['REMISE', 'TRANSFERT'].indexOf(m.type_affectation) >= 0; });
    return S.flotte;
  }
  async function beneficiaires() {
    if (!S.beneficiaires) S.beneficiaires = await rpc('moto_beneficiaires');
    return S.beneficiaires;
  }

  /* -- Coquille et navigation ---------------------------------------------- */
  var ESPACES = [
    { r: 'motos', l: 'Mes motos', ic: 'M' }, { r: 'operations', l: 'Opérations', ic: 'O' },
    { r: 'pilotage', l: 'Pilotage', ic: 'P', droit: 'pilotage' }, { r: 'formation', l: 'Formation', ic: 'F' },
    { r: 'admin', l: 'Administration', ic: 'A', droit: 'admin' }
  ];
  function coquille() {
    $('#motoNav').innerHTML = ESPACES.filter(function (e) { return !e.droit || peut(e.droit); }).map(function (e) {
      return '<a href="#/' + e.r + '" data-route="' + e.r + '"><span class="mm-nav-ic" aria-hidden="true">' + e.ic + '</span><span>' + esc(e.l) + '</span></a>';
    }).join('');
    $('#motoQui').textContent = (S.profil.nom || '') + ' · ' + (S.profil.role || '');
  }
  function routeActive() {
    var h = (location.hash || '#/motos').replace(/^#\//, '').split('/');
    return { espace: h[0] || 'motos', id: h[1] || null, onglet: h[2] || null };
  }
  async function router() {
    var r = routeActive();
    $$('dialog.mm-modale').forEach(function (d) { try { d.close(); } catch (e) {} d.remove(); }); // retour arrière = fermeture

    $$('#motoNav a').forEach(function (a) { var on = a.getAttribute('data-route') === (r.espace === 'moto' ? 'motos' : r.espace); a.classList.toggle('mm-actif', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    vue().innerHTML = '<div class="mm-chargement">Chargement…</div>';
    try {
      if (r.espace === 'moto' && r.id) await vuePasseport(r.id, r.onglet || 'synthese');
      else if (r.espace === 'operations') await vueOperations();
      else if (r.espace === 'pilotage' && peut('pilotage')) await vuePilotage();
      else if (r.espace === 'formation') await vueFormation(r.id);
      else if (r.espace === 'admin' && peut('admin')) await vueAdmin();
      else await vueMotos();
    } catch (e) {
      vue().innerHTML = '<div class="mm-vide mm-ko"><b>Affichage impossible.</b><p>' + esc(messageErreur(e)) + '</p></div>';
    }
    vue().focus({ preventScroll: true });
  }
  function bandeauHorsLigne() {
    return S.horsLigne ? '<div class="mm-bandeau mm-warn" role="status">Hors connexion : données du ' + esc(C.dateHeureFr(S.flotteLe)) + '. Les saisies sont conservées et seront envoyées au retour du réseau.</div>' : '';
  }

  /* -- A. MES MOTOS --------------------------------------------------------- */
  async function vueMotos() {
    await chargerFlotte();
    var liste = mesMotos();
    var immos = await Promise.all(liste.map(function (m) { return OFF.immobilisationLocale(m.id); }));
    var titre = S.classe === 'UNITE' ? 'Ma moto' : 'Flotte AFLP';
    vue().innerHTML = '<div class="mm-entete"><div><h1>' + titre + '</h1><p>' + (S.classe === 'UNITE' ? 'Passeport numérique de la moto qui vous est remise.' : liste.length + ' moto(s) dans votre périmètre.') + '</p></div>' +
      (peut('inventaire') ? '<a class="mm-btn mm-primaire" href="#/admin">Ajouter ou administrer</a>' : '') + '</div>' + bandeauHorsLigne() +
      (liste.length ? '<div class="mm-grille-motos">' + liste.map(function (m, i) { return carteMoto(m, immos[i]); }).join('') + '</div>'
        : '<div class="mm-vide"><b>Aucune moto à afficher.</b><p>' + (S.classe === 'UNITE' ? 'Aucune moto ne vous a encore été remise. La remise officielle se fait au bureau ANAGROCI de Bouaké.' : 'Aucune moto enregistrée dans votre périmètre.') + '</p></div>');
  }
  function carteMoto(m, immoLocale) {
    var circule = m.autorisee_a_circuler && !immoLocale;
    return '<a class="mm-carte-moto" href="#/moto/' + esc(m.id) + '"><div class="mm-carte-tete"><b class="mm-code">' + esc(m.code) + '</b>' +
      '<span class="mm-circule ' + (circule ? 'mm-ok' : 'mm-ko') + '">' + (circule ? 'Autorisée à circuler' : 'Ne pas circuler') + '</span></div>' +
      '<h2>' + esc(m.marque + ' ' + m.modele) + '</h2><p class="mm-immat">' + esc(m.immatriculation || 'Immatriculation en attente') + '</p>' +
      (immoLocale ? '<p class="mm-bandeau mm-ko">Immobilisée sur cet appareil depuis ' + esc(C.dateHeureFr(immoLocale.depuis)) + ' (en attente de synchronisation).</p>' : '') +
      '<div class="mm-badges">' + badge(m.statut_administratif, 'Admin') + badge(m.statut_affectation, 'Affectation') + badge(m.statut_technique, 'Technique') + '</div>' +
      '<dl class="mm-mini"><div><dt>Cluster</dt><dd>' + esc(m.cluster_code || C.ND) + '</dd></div><div><dt>Affectataire</dt><dd>' + esc(m.beneficiaire_nom || C.ND) + '</dd></div>' +
      '<div><dt>Compteur</dt><dd>' + esc(C.km(m.compteur_actuel_km)) + '</dd></div><div><dt>Incidents ouverts</dt><dd>' + esc(m.incidents_ouverts) + '</dd></div></dl></a>';
  }

  /* -- Passeport numérique --------------------------------------------------- */
  var ONGLETS = [['synthese', 'Synthèse'], ['documents', 'Documents'], ['affectations', 'Affectations'], ['kilometrage', 'Kilométrage'], ['controles', 'Contrôles'],
                 ['carburant', 'Carburant'], ['entretiens', 'Entretiens'], ['pneus', 'Pneus'], ['incidents', 'Incidents'], ['journal', 'Journal']];
  async function vuePasseport(id, onglet) {
    // Toujours relire l'état serveur : un autre responsable a pu changer les statuts.
    await chargerFlotte();
    var m = motoParId(id);
    if (!m) { vue().innerHTML = '<div class="mm-vide"><b>Moto introuvable ou hors de votre périmètre.</b></div>'; return; }
    var immo = await OFF.immobilisationLocale(id);
    vue().innerHTML = '<a class="mm-retour" href="#/motos">← Retour</a><section class="mm-passeport"><div class="mm-qr" id="mmQr" aria-label="QR code ' + esc(m.code) + '"></div><div class="mm-pass-info">' +
      '<span class="mm-surtitre">Passeport numérique</span><h1>' + esc(m.code) + ' · ' + esc(m.marque + ' ' + m.modele) + '</h1>' +
      '<dl class="mm-mini"><div><dt>Immatriculation</dt><dd>' + esc(m.immatriculation || 'En attente') + '</dd></div><div><dt>Châssis</dt><dd class="mm-mono">' + esc(m.numero_chassis || 'Non renseigné') + '</dd></div>' +
      '<div><dt>Moteur</dt><dd class="mm-mono">' + esc(m.numero_moteur || 'Non renseigné') + '</dd></div><div><dt>Réception</dt><dd>' + esc(C.dateFr(m.date_reception)) + '</dd></div>' +
      '<div><dt>Mise en service</dt><dd>' + esc(m.mise_en_service_at ? C.dateFr(m.mise_en_service_at) : 'Non autorisée') + '</dd></div><div><dt>Compteur</dt><dd>' + esc(C.km(m.compteur_actuel_km)) + '</dd></div></dl>' +
      '<div class="mm-badges">' + badge(m.statut_administratif, 'Admin') + badge(m.statut_affectation, 'Affectation') + badge(m.statut_technique, 'Technique') + '</div>' +
      (immo ? '<p class="mm-bandeau mm-ko">Immobilisation de sécurité enregistrée sur cet appareil : ne pas circuler.</p>' : '') + '</div></section>' + bandeauHorsLigne() +
      '<nav class="mm-onglets" aria-label="Sections du passeport">' + ONGLETS.filter(function (o) { return o[0] !== 'journal' || peut('journal'); }).map(function (o) {
        return '<a href="#/moto/' + esc(id) + '/' + o[0] + '"' + (o[0] === onglet ? ' class="mm-actif" aria-current="page"' : '') + '>' + o[1] + '</a>';
      }).join('') + '</nav><div id="mmOnglet" class="mm-onglet"><div class="mm-chargement">Chargement…</div></div>';
    dessinerQr(m);
    var cible = $('#mmOnglet');
    var rendu = { synthese: ongletSynthese, documents: ongletDocuments, affectations: ongletAffectations, kilometrage: ongletKm, controles: ongletControles,
                  carburant: ongletCarburant, entretiens: ongletEntretiens, pneus: ongletPneus, incidents: ongletIncidents, journal: ongletJournal }[onglet] || ongletSynthese;
    try { cible.innerHTML = await rendu(m); brancherActions(cible, m); }
    catch (e) { cible.innerHTML = '<div class="mm-vide mm-ko">' + esc(messageErreur(e)) + '</div>'; }
  }
  async function dessinerQr(m) {
    var el = $('#mmQr'); if (!el) return;
    var texte = 'ANAGROCI-MOTO|' + m.code + '|' + m.qr_token;
    try {
      if (!g.qrcode) await chargerScript(CDN_QR);
      var q = g.qrcode(0, 'M'); q.addData(texte); q.make();
      el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code ' + m.code }) + '<small class="mm-mono">' + esc(m.code) + '</small>';
    } catch (e) { el.innerHTML = '<div class="mm-qr-texte"><small>QR indisponible hors connexion</small><b class="mm-mono">' + esc(m.code) + '</b></div>'; }
  }
  function tableau(entetes, lignes, vide) {
    if (!lignes.length) return '<div class="mm-vide">' + esc(vide || 'Aucune donnée.') + '</div>';
    return '<div class="mm-table-wrap"><table class="mm-table"><thead><tr>' + entetes.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + lignes.map(function (l) { return '<tr>' + l.map(function (c, i) { return '<td data-label="' + esc(entetes[i]) + '">' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function action(code, libelle, data, ton) {
    return '<button type="button" class="mm-btn ' + (ton || 'mm-secondaire') + ' mm-petit" data-action="' + code + '"' +
      Object.keys(data || {}).map(function (k) { return ' data-' + k + '="' + esc(data[k]) + '"'; }).join('') + '>' + esc(libelle) + '</button>';
  }

  async function ongletSynthese(m) {
    var r = await Promise.all([
      lireTable('moto_v_conso_moto', function (q) { return q.eq('moto_id', m.id); }).catch(function () { return []; }),
      lireTable('moto_v_cout_km', function (q) { return q.eq('moto_id', m.id); }).catch(function () { return []; }),
      lireTable('moto_v_disponibilite', function (q) { return q.eq('moto_id', m.id); }).catch(function () { return []; }),
      lireTable('moto_v_alertes_documents', function (q) { return q.eq('moto_id', m.id); }).catch(function () { return []; }),
      lireTable('moto_v_echeances', function (q) { return q.eq('moto_id', m.id); }).catch(function () { return []; })
    ]);
    var co = r[0][0] || {}, ck = r[1][0] || {}, di = r[2][0] || {};
    var conditions = [
      ['Documents administratifs conformes', m.statut_administratif === 'CONFORME'], ['Contrôle technique apte', m.statut_technique === 'APTE'],
      ['Remise enregistrée avec PV vérifié', ['REMISE', 'TRANSFEREE'].indexOf(m.statut_affectation) >= 0], ['Autorisation de circulation du Branch Manager', !!m.mise_en_service_at]
    ];
    var actions = [];
    if (peut('preaffecter') && m.statut_affectation === 'NON_AFFECTEE') actions.push(action('preaffecter', 'Préaffecter', { id: m.id }, 'mm-primaire'));
    if (peut('inspection') || peut('inventaire')) actions.push(action('inspection', 'Inspection initiale', { id: m.id }));
    if (peut('remettre') && m.statut_affectation === 'PREAFFECTEE') actions.push(action('remettre', 'Enregistrer la remise', { id: m.id }, 'mm-primaire'));
    if (peut('mettre_en_service') && ['REMISE', 'TRANSFEREE'].indexOf(m.statut_affectation) >= 0 && !m.mise_en_service_at) actions.push(action('mise_en_service', 'Autoriser la circulation', { id: m.id }, 'mm-primaire'));
    if (peut('transferer') && ['REMISE', 'TRANSFEREE'].indexOf(m.statut_affectation) >= 0) actions.push(action('transferer', 'Transférer', { id: m.id }));
    if (peut('inventaire')) actions.push(action('identite', 'Modifier l\'identité', { id: m.id }));
    if (peut('incident_piloter')) actions.push(action('controle_remise', 'Contrôle de remise en service', { id: m.id }));
    if (peut('transferer') && m.statut_affectation !== 'NON_AFFECTEE') actions.push(action('retirer', 'Retirer l\'affectation', { id: m.id }, 'mm-danger'));
    return '<div class="mm-kpis">' +
      kpi('Consommation réelle', C.l100(co.l_100km), co.nb_intervalles ? co.nb_intervalles + ' intervalle(s) plein à plein' : 'Pas encore deux pleins complets') +
      kpi('Coût direct', ck.fcfa_km != null ? C.fcfa(ck.fcfa_km) + '/km' : C.ND, ck.km_parcourus ? C.km(ck.km_parcourus) + ' depuis la mise en service' : 'Kilométrage insuffisant') +
      kpi('Disponibilité technique', C.pct(di.taux_disponibilite_pct), di.jours_prevus ? (di.jours_prevus - di.jours_indisponibles) + ' / ' + di.jours_prevus + ' jours prévus' : 'Moto non mise en service') +
      kpi('Plein de contrôle', co.dernier_plein_complet ? C.dateFr(co.dernier_plein_complet) : C.ND, co.plein_controle_en_retard ? 'Plein complet de contrôle à faire' : 'À jour') + '</div>' +
      '<section class="mm-bloc"><h2>Conditions de circulation</h2><ul class="mm-conditions">' + conditions.map(function (c) { return '<li class="' + (c[1] ? 'mm-ok' : 'mm-ko') + '">' + (c[1] ? '✓ ' : '✗ ') + esc(c[0]) + '</li>'; }).join('') +
      '</ul><p class="mm-note">La réception physique ne vaut pas autorisation de circulation. Passage en production, remise et autorisation de circulation sont trois décisions distinctes.</p></section>' +
      (actions.length ? '<section class="mm-bloc"><h2>Actions</h2><div class="mm-actions">' + actions.join('') + '</div></section>' : '') +
      '<section class="mm-bloc"><h2>Alertes documentaires</h2>' + tableau(['Document', 'Alerte', 'Expiration'], r[3].map(function (a) { return [esc(C.libelle(a.type_document)), badge(a.alerte), esc(C.dateFr(a.date_expiration))]; }), 'Aucune alerte.') + '</section>' +
      '<section class="mm-bloc"><h2>Échéances de maintenance</h2>' + tableau(['Règle', 'Source', 'Prochaine (km)', 'Prochaine (date)', 'Statut'], r[4].map(function (e) {
        return [esc(e.libelle), esc(e.source === 'CONSTRUCTEUR_VERIFIE' ? 'Constructeur (vérifiée)' : 'Paramètre ANAGROCI'), esc(C.km(e.prochaine_km)), esc(C.dateFr(e.prochaine_date)), badge(e.statut)];
      }), 'Aucune règle de maintenance active : à paramétrer par le Branch Manager après vérification du manuel APSONIC AP150-30.') + '</section>';
  }
  function kpi(t, v, s) { return '<div class="mm-kpi"><small>' + esc(t) + '</small><b>' + esc(v) + '</b><span>' + esc(s || '') + '</span></div>'; }

  async function ongletDocuments(m) {
    var docs = await lireTable('moto_documents', function (q) { return q.eq('moto_id', m.id).order('depose_at', { ascending: false }); });
    var bouton = (peut('documents') || peut('documents_zone')) ? '<div class="mm-actions">' + action('document', 'Déposer un document', { id: m.id }, 'mm-primaire') + '</div>' : '';
    return bouton + tableau(['Type', 'Référence', 'Expiration', 'Statut', 'Déposé le', 'Fichier', 'Action'], docs.map(function (d) {
      return [esc(C.libelle(d.type_document)), esc(d.numero_reference || '—'), esc(C.dateFr(d.date_expiration)), badge(d.statut) + (d.motif_verification ? '<small class="mm-aide">' + esc(d.motif_verification) + '</small>' : ''),
        esc(C.dateFr(d.depose_at)), d.storage_path ? action('voir_fichier', 'Ouvrir', { chemin: d.storage_path }) : '—',
        (peut('verifier_documents') && d.statut === 'EN_VERIFICATION' && d.depose_par !== S.profil.user_id) ? action('verifier_document', 'Vérifier', { doc: d.id }, 'mm-primaire') :
          (d.statut === 'EN_VERIFICATION' && d.depose_par === S.profil.user_id ? '<small class="mm-aide">Vérification par un autre responsable</small>' : '')];
    }), 'Aucun document. Les cartes grises, plaques et assurances sont annoncées par le fournisseur : rien n\'est saisi avant réception réelle.');
  }
  async function ongletAffectations(m) {
    var a = await lireTable('moto_affectations', function (q) { return q.eq('moto_id', m.id).order('created_at', { ascending: false }); });
    return tableau(['Type', 'Statut', 'Cluster', 'Début', 'Fin', 'Compteur', 'Permis vérifié', 'Équipements'], a.map(function (x) {
      return [esc(C.libelle(x.type_affectation)), badge(x.statut), esc(x.cluster_code), esc(C.dateFr(x.date_debut)), esc(C.dateFr(x.date_fin)), esc(C.km(x.compteur_km)),
        x.permis_verifie ? 'Oui (' + esc(x.permis_categorie) + ', ' + esc(x.permis_verifie_par_nom) + ')' : 'Non',
        esc(Object.keys(x.equipements || {}).filter(function (k) { return x.equipements[k]; }).join(', ') || '—')];
    }), 'Aucune affectation.');
  }
  async function ongletKm(m) {
    var r = await lireTable('moto_releves_km', function (q) { return q.eq('moto_id', m.id).order('date_releve', { ascending: false }).limit(200); });
    return tableau(['Date', 'Compteur', 'Source'], r.map(function (x) { return [esc(C.dateHeureFr(x.date_releve)), esc(C.km(x.compteur_km)), esc(x.source)]; }), 'Aucun relevé.') +
      (peut('demander_correction') ? '<p class="mm-note">Un compteur erroné se corrige par une demande validée par un autre responsable (Pilotage → Validations).</p>' : '');
  }
  async function ongletControles(m) {
    var r = await lireTable('moto_controles', function (q) { return q.eq('moto_id', m.id).order('date_controle', { ascending: false }).limit(100); });
    return tableau(['Date', 'Type', 'Résultat', 'Points en défaut', 'Intervenant'], r.map(function (x) {
      var ko = (x.items || []).filter(function (i) { return i.ok === false; }).map(function (i) { return (i.critique ? '⚠ ' : '') + (i.libelle || i.code); });
      return [esc(C.dateHeureFr(x.date_controle)), esc(x.type_controle.replace(/_/g, ' ').toLowerCase()), badge(x.resultat === 'APTE' ? 'APTE' : (x.anomalie_critique ? 'CRITIQUE' : 'A_CONTROLER'), x.resultat),
        esc(ko.join(', ') || 'Aucun'), esc([x.intervenant_nom, x.garage_nom].filter(Boolean).join(' · ') || '—') + (x.avis_mecanicien ? '<small class="mm-aide">Avis mécanicien (non réglementaire) : ' + esc(x.avis_mecanicien) + '</small>' : '')];
    }), 'Aucun contrôle.');
  }
  async function ongletCarburant(m) {
    var achats = await lireTable('moto_carburant', function (q) { return q.eq('moto_id', m.id).order('compteur_km', { ascending: false }).limit(300); });
    var conso = C.consoPleinAPlein(achats, seuils());
    return '<div class="mm-kpis">' + kpi('Consommation mesurée', C.l100(conso.l_100km), conso.nb_intervalles + ' intervalle(s) valides') +
      kpi('Référence de planification', C.l100(S.params.conso_reference_l100 && S.params.conso_reference_l100.valeur), 'Seuils de vérification provisoires : ' + C.l100(seuils().seuil1) + ' / ' + C.l100(seuils().seuil2)) + '</div>' +
      '<p class="mm-note">Une alerte déclenche une vérification (compteur, plein incomplet, fuite, usage). Elle ne constitue jamais une accusation.</p>' +
      '<section class="mm-bloc"><h2>Intervalles plein à plein</h2>' + tableau(['Du (km)', 'Au (km)', 'Km', 'Litres', 'L/100 km', 'Statut'], conso.intervalles.slice().reverse().map(function (i) {
        return [esc(C.km(i.debut_km)), esc(C.km(i.fin_km)), esc(C.km(i.km)), esc(String(i.litres).replace('.', ',')), esc(C.l100(i.l_100km)), badge(i.statut_alerte)];
      }), 'Non disponible : il faut au moins deux pleins complets.') + '</section>' +
      '<section class="mm-bloc"><h2>Achats</h2>' + tableau(['Date', 'Compteur', 'Litres', 'Montant', 'Plein', 'Financement', 'Justificatif', 'Action'], achats.map(function (a) {
        return [esc(C.dateHeureFr(a.date_achat)), esc(C.km(a.compteur_km)), esc(String(a.litres).replace('.', ',')), esc(C.fcfa(a.montant)), a.plein_complet ? 'Complet' : 'Partiel', esc(C.libelle(a.financement)),
          badge(a.justificatif_statut) + (a.justificatif_path ? ' ' + action('voir_fichier', 'Photo', { chemin: a.justificatif_path }) : ''),
          (peut('verifier_justificatifs') && a.justificatif_statut === 'A_VERIFIER' && a.saisi_par !== S.profil.user_id && a.agent_id !== S.profil.user_id) ? action('verifier_justificatif', 'Vérifier', { id: a.id }, 'mm-primaire') : ''];
      }), 'Aucun achat déclaré.') + '</section>';
  }
  async function ongletEntretiens(m) {
    var r = await lireTable('moto_maintenances', function (q) { return q.eq('moto_id', m.id).order('demande_at', { ascending: false }); });
    return tableau(['Demandé le', 'Type', 'Description', 'Statut', 'Garage', 'Coût estimé', 'Coût réel', 'Action'], r.map(function (x) {
      var a = '';
      if (peut('maintenance_decider') && x.statut === 'DEMANDEE' && x.demande_par !== S.profil.user_id) a = action('maintenance_decider', 'Décider', { id: x.id }, 'mm-primaire');
      else if (peut('maintenance_decider') && x.statut === 'AUTORISEE') a = action('maintenance_demarrer', 'Démarrer', { id: x.id }, 'mm-primaire');
      else if (peut('maintenance_decider') && x.statut === 'EN_COURS') a = action('maintenance_terminer', 'Terminer', { id: x.id, moto: m.id }, 'mm-primaire');
      return [esc(C.dateFr(x.demande_at)), esc(C.libelle(x.type_maintenance)), esc(x.description), badge(x.statut), esc(x.garage_nom || '—'), esc(C.fcfa(x.cout_estime)), esc(C.fcfa(x.cout_reel)), a];
    }), 'Aucun entretien.');
  }
  async function ongletPneus(m) {
    var poses = await lireTable('moto_pneu_poses', function (q) { return q.eq('moto_id', m.id).order('pose_date', { ascending: false }); });
    var pneus = peut('pneus') ? await lireTable('moto_v_pneus').catch(function () { return []; }) : [];
    var parId = {}; pneus.forEach(function (p) { parId[p.id] = p; });
    var stock = pneus.filter(function (p) { return p.statut === 'EN_STOCK'; });
    return (peut('pneus') ? '<div class="mm-actions">' + action('pneu_poser', 'Monter un pneu', { id: m.id }, 'mm-primaire') + '</div>' + (stock.length ? '' : '<p class="mm-note">Aucun pneu en stock : enregistrez-le d\'abord (Administration → Pneus).</p>') : '') +
      tableau(['Pneu', 'Position', 'Monté le', 'Km montage', 'Déposé le', 'Km dépose', 'Km parcourus', 'Action'], poses.map(function (p) {
        var pn = parId[p.pneu_id] || {};
        return [esc(pn.code ? pn.code + ' · ' + pn.marque + ' ' + (pn.dimensions || '') : p.pneu_id.slice(0, 8)), esc(p.position), esc(C.dateFr(p.pose_date)), esc(C.km(p.pose_km)), esc(C.dateFr(p.depose_date)), esc(C.km(p.depose_km)),
          esc(C.km(p.depose_km != null ? p.depose_km - p.pose_km : (m.compteur_actuel_km != null ? m.compteur_actuel_km - p.pose_km : null))),
          (peut('pneus') && !p.depose_date) ? action('pneu_deposer', 'Déposer', { pose: p.id }) + ' ' + action('pneu_reparer', 'Réparation', { pneu: p.pneu_id, id: m.id }) : ''];
      }), 'Aucun pneu suivi sur cette moto.');
  }
  async function ongletIncidents(m) {
    var r = await lireTable('moto_incidents', function (q) { return q.eq('moto_id', m.id).order('declare_at', { ascending: false }); });
    return tableau(['Déclaré le', 'Type', 'Gravité', 'Étape', 'Description', 'Registre AFLP', 'Action'], r.map(function (x) {
      return [esc(C.dateHeureFr(x.declare_at)), esc(C.libelle(x.type_incident)), badge(x.gravite), badge(x.etape), esc(x.description), esc(x.aflp_incident_id || '—'),
        (peut('incident_piloter') && x.etape !== 'CLOS') ? action('incident_avancer', 'Faire avancer', { id: x.id, etape: x.etape, gravite: x.gravite, moto: m.id }, 'mm-primaire') : ''];
    }), 'Aucun incident.') + '<p class="mm-note">Circuit d\'un incident critique : arrêt → signalement → immobilisation → diagnostic → autorisation de dépense si nécessaire → réparation → contrôle → remise en service.</p>';
  }
  async function ongletJournal(m) {
    var r = await lireTable('moto_journal', function (q) { return q.order('at', { ascending: false }).limit(300); });
    var lie = r.filter(function (j) { var n = j.nouvelle_valeur || j.ancienne_valeur || {}; return j.enregistrement_id === m.id || n.moto_id === m.id; });
    return tableau(['Date', 'Table', 'Action', 'Auteur', 'Motif', 'Valideur', 'Changement'], lie.map(function (j) {
      var diff = []; var a = j.ancienne_valeur || {}, n = j.nouvelle_valeur || {};
      Object.keys(n).forEach(function (k) { if (['updated_at', 'row_version'].indexOf(k) < 0 && JSON.stringify(a[k]) !== JSON.stringify(n[k]) && j.action === 'UPDATE') diff.push(k + ' : ' + (a[k] == null ? '∅' : a[k]) + ' → ' + (n[k] == null ? '∅' : n[k])); });
      return [esc(C.dateHeureFr(j.at)), esc(j.table_nom), esc(j.action), esc(j.auteur_nom || '—'), esc(j.motif || '—'), esc(j.valideur ? 'Oui' : '—'), '<small>' + esc(diff.join(' · ') || (j.action === 'INSERT' ? 'Création' : '')) + '</small>'];
    }), 'Aucune entrée de journal.');
  }

  /* -- Actions du passeport ------------------------------------------------- */
  function brancherActions(zone, m) {
    zone.addEventListener('click', function (e) {
      var b = e.target.closest('[data-action]'); if (!b) return;
      var d = b.dataset, f = ACTIONS[d.action]; if (f) f(d, m);
    });
  }
  function apres(id, onglet) { return function () { chargerFlotte().then(function () { vuePasseport(id, onglet); }); }; }
  var ACTIONS = {
    voir_fichier: function (d) { ouvrirFichier(d.chemin); },
    preaffecter: async function (d, m) {
      var b = await beneficiaires();
      modale('Préaffecter ' + m.code, champ({ n: 'beneficiaire', l: 'Chef d\'unité ou de zone', t: 'select', req: true, o: b.map(function (x) { return [x.user_id, x.nom + ' · ' + x.role + (x.cluster_code ? ' · ' + x.cluster_code : '')]; }) }) +
        champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 5 }), function (v) { return rpc('moto_preaffecter', { p_moto: m.id, p_beneficiaire: v.beneficiaire, p_motif: v.motif }).then(apres(m.id)); });
    },
    identite: function (d, m) {
      modale('Identité de ' + m.code, '<div class="mm-grille-form">' + [
        { n: 'marque', l: 'Marque', v: m.marque, req: true }, { n: 'modele', l: 'Modèle', v: m.modele, req: true }, { n: 'annee', l: 'Année', t: 'nombre', pas: 1, v: m.annee },
        { n: 'couleur', l: 'Couleur', v: m.couleur }, { n: 'numero_chassis', l: 'N° de châssis (carte grise)', v: m.numero_chassis, aide: 'À recopier de la carte grise réelle uniquement.' },
        { n: 'numero_moteur', l: 'N° moteur', v: m.numero_moteur }, { n: 'immatriculation', l: 'Immatriculation', v: m.immatriculation }, { n: 'date_reception', l: 'Date de réception', t: 'date', v: m.date_reception },
        { n: 'observations', l: 'Observations', t: 'textarea', v: m.observations }, { n: 'motif', l: 'Motif de la modification', t: 'textarea', req: true, min: 5 }].map(champ).join('') + '</div>',
      function (v) { var motif = v.motif; delete v.motif; v.row_version = m.row_version; return rpc('moto_modifier_identite', { p_moto: m.id, p: v, p_motif: motif }).then(apres(m.id)); });
    },
    document: function (d, m) {
      var types = S.classe === 'ZONE' ? ['RAPPORT_MECANICIEN', 'PHOTO', 'FACTURE'] : ['CARTE_GRISE', 'PLAQUE', 'ASSURANCE', 'PV_REMISE', 'RAPPORT_MECANICIEN', 'PERMIS', 'FACTURE', 'PHOTO', 'AUTRE'];
      modale('Déposer un document', '<div class="mm-grille-form">' + champ({ n: 'type_document', l: 'Type', t: 'select', req: true, o: types.map(function (t) { return [t, C.libelle(t)]; }) }) +
        champ({ n: 'numero_reference', l: 'Numéro / référence' }) + champ({ n: 'date_emission', l: 'Date d\'émission', t: 'date' }) + champ({ n: 'date_expiration', l: 'Date d\'expiration', t: 'date', aide: 'Assurance : obligatoire pour l\'alerte d\'expiration.' }) +
        champ({ n: 'fichier', l: 'Fichier numérisé (PDF ou photo)', t: 'fichier', req: true, large: true, capture: true }) + '</div>' +
        '<p class="mm-note">Le procès-verbal de remise est signé sur papier puis numérisé ici. Le document sera vérifié par un autre responsable.</p>',
      async function (v) {
        var cat = { RAPPORT_MECANICIEN: 'controle', FACTURE: 'maintenance', PHOTO: 'photo' }[v.type_document] || 'document';
        var f = await deposer(m.id, cat, v.fichier);
        return rpc('moto_document_enregistrer', { p: { moto_id: m.id, type_document: v.type_document, numero_reference: v.numero_reference, date_emission: v.date_emission, date_expiration: v.date_expiration, storage_path: f.chemin, nom_fichier: f.nom } })
          .then(apres(m.id, 'documents')).then(function () { return 'Document déposé : en attente de vérification.'; });
      }, 'Déposer');
    },
    verifier_document: function (d, m) {
      modale('Vérifier le document', champ({ n: 'statut', l: 'Décision', t: 'select', req: true, o: [['CONFORME', 'Conforme'], ['NON_CONFORME', 'Non conforme']] }) + champ({ n: 'motif', l: 'Motif (obligatoire si non conforme)', t: 'textarea' }),
        function (v) { return rpc('moto_document_verifier', { p_document: d.doc, p_statut: v.statut, p_motif: v.motif }).then(apres(m.id, 'documents')); });
    },
    inspection: function (d, m) {
      modale('Inspection mécanique initiale', '<div class="mm-grille-form">' + champ({ n: 'intervenant_nom', l: 'Mécanicien qualifié', req: true }) + champ({ n: 'garage_nom', l: 'Garage désigné par ANAGROCI', req: true }) +
        champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true }) + champ({ n: 'avis_mecanicien', l: 'Avis du mécanicien', t: 'textarea' }) + '</div>' + itemsHtml(C.INSPECTION_INITIALE, 'ins') +
        champ({ n: 'resultat', l: 'Conclusion', t: 'select', req: true, o: [['APTE', 'Apte'], ['INAPTE', 'Inapte : contrôle complémentaire au garage']] }) +
        '<p class="mm-note">L\'avis d\'un mécanicien n\'est pas un certificat réglementaire officiel. Une anomalie critique rend la moto inapte, quelle que soit la conclusion saisie.</p>',
      function (v, form) {
        var items = lireItems(form, C.INSPECTION_INITIALE, 'ins');
        return rpc('moto_inspection_initiale', { p: { moto_id: m.id, items: items, resultat: v.resultat, intervenant_nom: v.intervenant_nom, garage_nom: v.garage_nom, compteur_km: v.compteur_km, avis_mecanicien: v.avis_mecanicien } })
          .then(function (r) { apres(m.id)(); return r.anomalie_critique ? 'Anomalie critique : moto immobilisée.' : 'Inspection enregistrée : ' + C.libelle(r.resultat) + '.'; });
      });
    },
    remettre: async function (d, m) {
      var docs = await lireTable('moto_documents', function (q) { return q.eq('moto_id', m.id).eq('type_document', 'PV_REMISE').eq('statut', 'CONFORME'); });
      var eq = (S.params.equipements_obligatoires && S.params.equipements_obligatoires.valeur_json) || [];
      modale('Remise officielle de ' + m.code, '<div class="mm-grille-form">' +
        champ({ n: 'pv_document_id', l: 'Procès-verbal signé, numérisé et vérifié', t: 'select', req: true, large: true, o: docs.map(function (x) { return [x.id, 'PV du ' + C.dateFr(x.depose_at) + (x.numero_reference ? ' · ' + x.numero_reference : '')]; }),
               aide: docs.length ? '' : 'Aucun PV vérifié : déposez le PV numérisé (onglet Documents) et faites-le vérifier par un autre responsable.' }) +
        champ({ n: 'compteur_km', l: 'Compteur à la remise', t: 'nombre', req: true }) + champ({ n: 'permis_categorie', l: 'Catégorie de permis', req: true, ph: 'Ex. A' }) +
        champ({ n: 'permis_verifie_par_nom', l: 'Permis vérifié par (RH)', req: true }) + champ({ n: 'permis_verifie_at', l: 'Date de vérification RH', t: 'date', v: aujourdhui() }) +
        champ({ n: 'permis_verifie', l: 'Je confirme que le permis adapté a été vérifié par les RH', t: 'checkbox' }) + '</div>' +
        '<fieldset class="mm-champ mm-large"><legend>Équipements de sécurité remis</legend>' + eq.map(function (k) { return '<label class="mm-case"><input type="checkbox" name="eq_' + esc(k) + '"> ' + esc(k.replace(/_/g, ' ').toLowerCase()) + '</label>'; }).join('') + '</fieldset>',
      function (v) {
        var equip = {}; eq.forEach(function (k) { equip[k] = !!v['eq_' + k]; });
        return rpc('moto_remettre', { p: { moto_id: m.id, pv_document_id: v.pv_document_id, compteur_km: v.compteur_km, permis_verifie: !!v.permis_verifie, permis_categorie: v.permis_categorie,
          permis_verifie_par_nom: v.permis_verifie_par_nom, permis_verifie_at: v.permis_verifie_at, equipements: equip } }).then(function (r) { apres(m.id)(); return r.note; });
      }, 'Enregistrer la remise');
    },
    mise_en_service: function (d, m) {
      modale('Autoriser la circulation de ' + m.code, '<p>Décision distincte de la remise et du passage en production du logiciel. Le serveur vérifie documents, état technique, remise et séparation des tâches.</p>' +
        champ({ n: 'motif', l: 'Motif de la décision', t: 'textarea', req: true, min: 5 }), function (v) { return rpc('moto_mettre_en_service', { p_moto: m.id, p_motif: v.motif }).then(apres(m.id)); }, 'Autoriser');
    },
    transferer: async function (d, m) {
      var b = await beneficiaires();
      var docs = await lireTable('moto_documents', function (q) { return q.eq('moto_id', m.id).eq('type_document', 'PV_REMISE').eq('statut', 'CONFORME'); });
      var eq = (S.params.equipements_obligatoires && S.params.equipements_obligatoires.valeur_json) || [];
      modale('Transférer ' + m.code, '<div class="mm-grille-form">' + champ({ n: 'beneficiaire_id', l: 'Nouveau bénéficiaire', t: 'select', req: true, large: true, o: b.map(function (x) { return [x.user_id, x.nom + ' · ' + (x.cluster_code || x.role)]; }) }) +
        champ({ n: 'pv_document_id', l: 'PV de transfert vérifié', t: 'select', req: true, large: true, o: docs.map(function (x) { return [x.id, 'PV du ' + C.dateFr(x.depose_at)]; }) }) +
        champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true }) + champ({ n: 'permis_categorie', l: 'Catégorie de permis', req: true }) + champ({ n: 'permis_verifie_par_nom', l: 'Permis vérifié par (RH)', req: true }) +
        champ({ n: 'permis_verifie', l: 'Permis vérifié par les RH', t: 'checkbox' }) + '</div><fieldset class="mm-champ mm-large"><legend>Équipements</legend>' +
        eq.map(function (k) { return '<label class="mm-case"><input type="checkbox" name="eq_' + esc(k) + '"> ' + esc(k.replace(/_/g, ' ').toLowerCase()) + '</label>'; }).join('') + '</fieldset>' + champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 5 }),
      function (v) { var equip = {}; eq.forEach(function (k) { equip[k] = !!v['eq_' + k]; }); v.equipements = equip; v.moto_id = m.id; return rpc('moto_transferer', { p: v }).then(apres(m.id)); }, 'Transférer');
    },
    retirer: function (d, m) {
      modale('Retirer l\'affectation de ' + m.code, '<p class="mm-bandeau mm-warn">La moto redevient non affectée et perd son autorisation de circulation.</p>' + champ({ n: 'motif', l: 'Motif (10 caractères minimum)', t: 'textarea', req: true, min: 10 }),
        function (v) { return rpc('moto_retirer', { p_moto: m.id, p_motif: v.motif }).then(apres(m.id)); }, 'Retirer');
    },
    verifier_justificatif: function (d, m) {
      modale('Vérifier le justificatif', champ({ n: 'statut', l: 'Décision', t: 'select', req: true, o: [['VERIFIE', 'Vérifié : reçu lisible et cohérent'], ['REJETE', 'Rejeté']] }) + champ({ n: 'motif', l: 'Motif (obligatoire si rejet)', t: 'textarea' }),
        function (v) { return rpc('moto_justificatif_verifier', { p_carburant: d.id, p_statut: v.statut, p_motif: v.motif }).then(function () { if (m) apres(m.id, 'carburant')(); else router(); }); });
    },
    maintenance_decider: function (d, m) {
      modale('Décision sur la demande d\'entretien', champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['AUTORISEE', 'Autoriser'], ['REFUSEE', 'Refuser']] }) + champ({ n: 'motif', l: 'Motif', t: 'textarea' }),
        function (v) { return rpc('moto_maintenance_decider', { p_maintenance: d.id, p_decision: v.decision, p_motif: v.motif }).then(function () { if (m) apres(m.id, 'entretiens')(); else router(); }); });
    },
    maintenance_demarrer: function (d, m) {
      modale('Début d\'intervention', champ({ n: 'garage', l: 'Garage intervenant', req: true }) + champ({ n: 'date', l: 'Date', t: 'date', v: aujourdhui(), req: true }) + '<p class="mm-note">La moto est immobilisée pendant l\'intervention.</p>',
        function (v) { return rpc('moto_maintenance_demarrer', { p_maintenance: d.id, p_garage: v.garage, p_date: v.date }).then(apres(m.id, 'entretiens')); }, 'Démarrer');
    },
    maintenance_terminer: async function (d, m) {
      var fac = await lireTable('moto_documents', function (q) { return q.eq('moto_id', m.id).eq('type_document', 'FACTURE').order('depose_at', { ascending: false }); });
      modale('Fin d\'intervention', '<div class="mm-grille-form">' + champ({ n: 'cout_reel', l: 'Coût réel (FCFA, 0 si aucun)', t: 'nombre', req: true }) + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre' }) +
        champ({ n: 'facture_document_id', l: 'Facture déposée', t: 'select', large: true, o: fac.map(function (x) { return [x.id, 'Facture du ' + C.dateFr(x.depose_at) + (x.numero_reference ? ' · ' + x.numero_reference : '')]; }), aide: 'Déposez la facture dans l\'onglet Documents avant de clôturer une intervention payante.' }) +
        champ({ n: 'remettre_en_service', l: 'Lever l\'immobilisation liée à cette maintenance', t: 'checkbox', v: true }) + '</div>',
      function (v) { v.maintenance_id = d.id; return rpc('moto_maintenance_terminer', { p: v }).then(apres(m.id, 'entretiens')); }, 'Terminer');
    },
    controle_remise: function (d, m) {
      modale('Contrôle de remise en service', champ({ n: 'intervenant_nom', l: 'Intervenant', req: true }) + champ({ n: 'garage_nom', l: 'Garage' }) + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre' }) +
        itemsHtml(C.INSPECTION_INITIALE, 'rs') + champ({ n: 'avis_mecanicien', l: 'Avis', t: 'textarea' }),
      function (v, form) { v.items = lireItems(form, C.INSPECTION_INITIALE, 'rs'); v.moto_id = m.id; return rpc('moto_controle_remise_en_service', { p: v }).then(function (r) { apres(m.id, 'controles')(); return 'Contrôle enregistré : ' + C.libelle(r.resultat) + '.'; }); });
    },
    incident_avancer: function (d, m) {
      var suite = { SIGNALE: ['IMMOBILISEE', 'DIAGNOSTIC'].concat(d.gravite !== 'CRITIQUE' ? ['CLOS'] : []), IMMOBILISEE: ['DIAGNOSTIC'], DIAGNOSTIC: ['AUTORISATION_DEPENSE', 'REPARATION', 'CONTROLE'].concat(d.gravite !== 'CRITIQUE' ? ['CLOS'] : []),
                    AUTORISATION_DEPENSE: ['REPARATION'], REPARATION: ['CONTROLE'], CONTROLE: ['REMIS_EN_SERVICE'], REMIS_EN_SERVICE: ['CLOS'] }[d.etape] || [];
      modale('Incident : étape suivante', '<p>Étape actuelle : ' + badge(d.etape) + '</p>' + champ({ n: 'etape', l: 'Nouvelle étape', t: 'select', req: true, o: suite.map(function (s) { return [s, C.libelle(s)]; }) }) +
        champ({ n: 'cout', l: 'Montant (autorisation de dépense ou coût réel à la clôture)', t: 'nombre' }) + champ({ n: 'note', l: 'Note', t: 'textarea', req: true, min: 5 }) +
        '<p class="mm-note">La remise en service exige un contrôle de remise en service APTE enregistré après l\'incident.</p>',
      function (v) { return rpc('moto_incident_avancer', { p_incident: d.id, p_etape: v.etape, p_note: v.note, p_cout: C.nombreSaisi(v.cout) }).then(apres(m.id, 'incidents')); });
    },
    pneu_poser: async function (d, m) {
      var stock = (await lireTable('moto_pneus', function (q) { return q.eq('statut', 'EN_STOCK'); }));
      modale('Monter un pneu', champ({ n: 'pneu_id', l: 'Pneu en stock', t: 'select', req: true, o: stock.map(function (p) { return [p.id, p.code + ' · ' + p.marque + ' ' + p.dimensions]; }) }) +
        champ({ n: 'position', l: 'Position', t: 'select', req: true, o: [['AVANT', 'Avant'], ['ARRIERE', 'Arrière']] }) + champ({ n: 'pose_km', l: 'Compteur au montage', t: 'nombre', req: true, v: m.compteur_actuel_km }) +
        champ({ n: 'pose_date', l: 'Date', t: 'date', v: aujourdhui() }), function (v) { v.moto_id = m.id; return rpc('moto_pneu_poser', { p: v }).then(apres(m.id, 'pneus')); });
    },
    pneu_deposer: function (d, m) {
      modale('Déposer le pneu', champ({ n: 'depose_km', l: 'Compteur à la dépose', t: 'nombre', req: true, v: m.compteur_actuel_km }) + champ({ n: 'depose_date', l: 'Date', t: 'date', v: aujourdhui() }) +
        champ({ n: 'destination', l: 'Destination', t: 'select', req: true, o: [['EN_STOCK', 'Retour en stock'], ['EN_REPARATION', 'Réparation'], ['REFORME', 'Réforme (fin de vie)']] }) + champ({ n: 'motif_depose', l: 'Motif', t: 'textarea', req: true }),
        function (v) { v.pose_id = d.pose; return rpc('moto_pneu_deposer', { p: v }).then(apres(m.id, 'pneus')); });
    },
    pneu_reparer: function (d, m) {
      modale('Réparation de pneu', champ({ n: 'description', l: 'Description', req: true }) + champ({ n: 'cout', l: 'Coût (FCFA)', t: 'nombre' }) + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre' }) + champ({ n: 'date_reparation', l: 'Date', t: 'date', v: aujourdhui() }),
        function (v) { v.pneu_id = d.pneu; v.moto_id = m.id; return rpc('moto_pneu_reparation', { p: v }).then(apres(m.id, 'pneus')); });
    }
  };

  /* -- B. OPÉRATIONS -------------------------------------------------------- */
  async function vueOperations() {
    try { await chargerFlotte(); } catch (e) { /* le cache est déjà tenté dans chargerFlotte */ }
    var liste = mesMotos().filter(function (m) { return S.classe !== 'UNITE' || m.mise_en_service_at; });
    var choix = sessionStorageLire('moto_choisie');
    var m = motoParId(choix) && liste.some(function (x) { return x.id === choix; }) ? motoParId(choix) : liste[0];
    var immo = m ? await OFF.immobilisationLocale(m.id) : null;
    var dot = await mesDotations();
    vue().innerHTML = '<div class="mm-entete"><div><h1>Opérations</h1><p>Saisies terrain : elles fonctionnent sans réseau et partent automatiquement au retour de la connexion.</p></div></div>' + bandeauHorsLigne() +
      (liste.length ? '<div class="mm-champ mm-large"><label for="opMoto">Moto</label><select id="opMoto">' + liste.map(function (x) { return '<option value="' + esc(x.id) + '"' + (m && x.id === m.id ? ' selected' : '') + '>' + esc(x.code + ' · ' + (x.immatriculation || 'immatriculation en attente')) + '</option>'; }).join('') + '</select></div>' : '') +
      (m ? (immo || !m.autorisee_a_circuler ? '<div class="mm-bandeau mm-ko" role="alert"><b>Ne pas circuler.</b> ' + (immo ? 'Immobilisation de sécurité enregistrée sur cet appareil le ' + esc(C.dateHeureFr(immo.depuis)) + '.' : 'Moto non autorisée à circuler (' + esc(C.libelle(m.statut_technique)) + ').') + '</div>' : '') +
        '<div class="mm-tuiles">' +
        tuile('controle', 'Contrôle avant départ', 'Freins, pneus, direction, équipements', immo ? 'Moto immobilisée : un responsable doit d\'abord la remettre en service.' : null) +
        tuile('releve', 'Relevé kilométrique', 'Compteur du jour') + tuile('carburant', 'Achat de carburant', 'Litres, montant, plein, photo du reçu') +
        tuile('incident', 'Déclarer un incident', 'Panne, accident, crevaison, anomalie', null, 'mm-tuile-alerte') + tuile('entretien', 'Demande d\'entretien', 'Vidange, réparation, révision') + '</div>'
        : '<div class="mm-vide"><b>Aucune moto en service pour vous.</b><p>Les saisies terrain s\'ouvrent après la remise officielle et l\'autorisation de circulation.</p></div>') +
      (dot.length ? '<section class="mm-bloc"><h2>Mes dotations à confirmer</h2>' + tableau(['Remise le', 'Mode', 'Montant remis', 'Frais', 'Référence', 'Action'], dot.map(function (x) {
        return [esc(C.dateFr(x.remis_at)), esc(C.libelle(x.mode_paiement)), esc(C.fcfa(x.montant_remis)), esc(C.fcfa(x.frais_transaction)), esc(x.reference || '—'), '<button type="button" class="mm-btn mm-primaire mm-petit" data-confirmer="' + esc(x.id) + '" data-montant="' + esc(x.montant_remis) + '">Confirmer la réception</button>'];
      })) + '<p class="mm-note">Confirmez le montant réellement reçu. Une transaction échouée ou non reçue ne vaut pas dotation : déclarez « non reçu ».</p></section>' : '') +
      '<section class="mm-bloc"><h2>Synchronisation</h2><div id="opFile"></div></section>';
    var sel = $('#opMoto'); if (sel) sel.onchange = function () { sessionStorageEcrire('moto_choisie', sel.value); vueOperations(); };
    $$('[data-tuile]').forEach(function (b) { b.onclick = function () { FORMULAIRES_TERRAIN[b.dataset.tuile](m); }; });
    $$('[data-confirmer]').forEach(function (b) { b.onclick = function () { confirmerDotation(b.dataset.confirmer, b.dataset.montant); }; });
    afficherFile();
  }
  function sessionStorageLire(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionStorageEcrire(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function tuile(code, titre, sous, bloque, classe) {
    return '<button type="button" class="mm-tuile ' + (classe || '') + '" data-tuile="' + code + '"' + (bloque ? ' disabled aria-disabled="true" title="' + esc(bloque) + '"' : '') + '><b>' + esc(titre) + '</b><span>' + esc(bloque || sous) + '</span></button>';
  }
  async function mesDotations() {
    if (!S.profil) return [];
    try {
      var d = await lireTable('moto_dotations', function (q) { return q.eq('beneficiaire_id', S.profil.user_id).eq('statut', 'REMISE_DECLAREE').order('remis_at', { ascending: false }); });
      OFF.memoriser('mes_dotations', d); return d;
    } catch (e) { var c = await OFF.relire('mes_dotations'); return (c && c.valeur) || []; }
  }
  /* Toute saisie terrain passe par la file locale, même en ligne : un seul
     chemin, idempotent, et aucune perte si le réseau tombe pendant l'envoi. */
  async function mettreEnFile(type, payload, libelle, fichiers) {
    var op = await OFF.ajouter(type, payload, { libelle: libelle, fichiers: fichiers });
    var r = {};
    try { r = await OFF.synchroniser(S.sb); } catch (e) { r = { erreur: e && e.message }; } // la saisie est déjà sûre sur l'appareil
    var ops = await OFF.lister(), etat = ops.filter(function (o) { return o.client_op_id === op.client_op_id; })[0] || op;
    if (etat.statut === 'SYNCHRONISE') return libelle + ' : synchronisé.';
    if (etat.statut === 'REJETE') throw new Error('Rejeté par le serveur : ' + etat.message);
    return libelle + ' : enregistré sur l\'appareil, en attente de synchronisation' + (r && r.horsLigne ? ' (hors connexion).' : '.');
  }
  function apresTerrain() { chargerFlotte().catch(function () {}).then(vueOperations); }
  var FORMULAIRES_TERRAIN = {
    controle: function (m) {
      modale('Contrôle avant départ · ' + m.code, champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true }) + itemsHtml(C.CONTROLE_DEPART, 'dep') +
        '<p class="mm-note">Un point critique en défaut immobilise la moto immédiatement sur ce téléphone, même sans réseau.</p>',
      async function (v, form) {
        var items = lireItems(form, C.CONTROLE_DEPART, 'dep');
        var msg = await mettreEnFile('CONTROLE_DEPART', { moto_id: m.id, items: items, compteur_km: v.compteur_km, date_controle: new Date().toISOString() }, 'Contrôle avant départ ' + m.code);
        apresTerrain();
        return C.anomalieCritique(items) ? 'Anomalie critique : NE PAS CIRCULER. Moto immobilisée. ' + msg : (C.resultatControle(items) === 'APTE' ? 'Contrôle apte. ' + msg : 'Défaut non critique signalé : faites une demande d\'entretien. ' + msg);
      }, 'Valider le contrôle');
    },
    releve: function (m) {
      modale('Relevé kilométrique · ' + m.code, champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true, aide: 'Dernier relevé connu : ' + C.km(m.compteur_actuel_km) }),
        async function (v) {
          var e = C.validerReleve(v, m.compteur_actuel_km); if (e.length) throw new Error(e.join(' '));
          var msg = await mettreEnFile('RELEVE_KM', { moto_id: m.id, compteur_km: v.compteur_km, date_releve: new Date().toISOString() }, 'Relevé ' + m.code); apresTerrain(); return msg;
        });
    },
    carburant: function (m) {
      var defautAchat = maintenantLocal();
      modale('Achat de carburant · ' + m.code, '<div class="mm-grille-form">' + champ({ n: 'date_achat', l: 'Date et heure', t: 'dateheure', req: true, v: defautAchat, max: defautAchat }) +
        champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true }) + champ({ n: 'litres', l: 'Litres achetés', t: 'nombre', req: true, pas: '0.01' }) + champ({ n: 'montant', l: 'Montant payé (FCFA)', t: 'nombre', req: true, pas: 1 }) +
        champ({ n: 'plein_complet', l: 'Type de plein', t: 'oui_non', req: true, oui: 'Plein complet', non: 'Plein partiel' }) +
        champ({ n: 'financement', l: 'Payé avec', t: 'select', req: true, vide: false, o: [['DOTATION', 'Ma dotation carburant'], ['AVANCE_PERSONNELLE', 'Mon argent personnel (avance)']] }) +
        champ({ n: 'station', l: 'Station' }) + champ({ n: 'justificatif', l: 'Photo du reçu', t: 'fichier', req: true, large: true, accept: 'image/*', capture: true }) + '</div>',
      async function (v) {
        v.moto_id = m.id; v.avec_justificatif = !!v.justificatif;
        var e = C.validerCarburant(v); if (e.length) throw new Error(e.join(' '));
        var blob = await compresser(v.justificatif);
        /* L'heure proposée par défaut est arrondie à la minute (champ datetime-local) : si l'agent ne l'a pas
           modifiée, on enregistre l'instant exact, sinon des relevés de la même minute créeraient un faux conflit de compteur. */
        var dateAchat = v.date_achat === defautAchat ? new Date().toISOString() : isoDepuisLocal(v.date_achat);
        var msg = await mettreEnFile('CARBURANT', { moto_id: m.id, date_achat: dateAchat, compteur_km: v.compteur_km, litres: v.litres, montant: v.montant,
          plein_complet: v.plein_complet, financement: v.financement, station: v.station }, 'Carburant ' + m.code,
          [{ champ: 'justificatif_path', blob: blob, moto_id: m.id, categorie: 'justificatif', extension: extension(blob, v.justificatif.name) }]);
        apresTerrain(); return msg;
      });
    },
    incident: function (m) {
      modale('Déclarer un incident · ' + m.code, '<div class="mm-grille-form">' + champ({ n: 'type_incident', l: 'Type', t: 'select', req: true, o: ['PANNE', 'ACCIDENT', 'CREVAISON', 'ANOMALIE'].map(function (t) { return [t, C.libelle(t)]; }) }) +
        champ({ n: 'gravite', l: 'Gravité', t: 'select', req: true, o: [['MINEURE', 'Mineure : la moto peut rouler'], ['MAJEURE', 'Majeure : rouler avec prudence jusqu\'au garage'], ['CRITIQUE', 'Critique : arrêt immédiat']] }) +
        champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre' }) + champ({ n: 'lieu', l: 'Lieu' }) + champ({ n: 'description', l: 'Description', t: 'textarea', req: true, min: 10 }) +
        champ({ n: 'arret_confirme', l: 'La moto est arrêtée et en sécurité', t: 'checkbox' }) + '</div><p class="mm-note">Accident ou gravité critique : la moto est immobilisée immédiatement sur ce téléphone ; le responsable est notifié à la synchronisation.</p>',
      async function (v) {
        var e = C.validerIncident(v); if (e.length) throw new Error(e.join(' '));
        var msg = await mettreEnFile('INCIDENT', { moto_id: m.id, type_incident: v.type_incident, gravite: v.gravite, compteur_km: v.compteur_km, lieu: v.lieu, description: v.description,
          arret_confirme: !!v.arret_confirme, survenu_at: new Date().toISOString() }, 'Incident ' + m.code);
        apresTerrain(); return msg;
      }, 'Déclarer');
    },
    entretien: function (m) {
      modale('Demande d\'entretien · ' + m.code, champ({ n: 'type_maintenance', l: 'Type', t: 'select', req: true, o: ['VIDANGE', 'ENTRETIEN_PREVENTIF', 'REVISION', 'REPARATION', 'PANNE'].map(function (t) { return [t, C.libelle(t)]; }) }) +
        champ({ n: 'description', l: 'Description', t: 'textarea', req: true, min: 5 }) + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre' }) + champ({ n: 'cout_estime', l: 'Coût estimé (FCFA)', t: 'nombre' }),
        async function (v) { v.moto_id = m.id; var msg = await mettreEnFile('MAINTENANCE_DEMANDE', v, 'Entretien ' + m.code); apresTerrain(); return msg; }, 'Demander');
    }
  };
  function confirmerDotation(id, montant) {
    modale('Confirmer la réception', champ({ n: 'montant_recu', l: 'Montant réellement reçu (FCFA)', t: 'nombre', req: true, v: montant, aide: 'Montant remis : ' + C.fcfa(montant) + '. Mobile Money : indiquez le montant net reçu.' }) +
      champ({ n: 'non_recu', l: 'Je n\'ai rien reçu', t: 'checkbox' }) + champ({ n: 'motif', l: 'Commentaire (obligatoire en cas d\'écart)', t: 'textarea' }),
    async function (v) {
      var msg = await mettreEnFile('DOTATION_CONFIRMER', { dotation_id: id, montant_recu: v.non_recu ? 0 : v.montant_recu, non_recu: !!v.non_recu, motif: v.motif }, 'Confirmation de dotation');
      vueOperations(); return msg + ' La validation financière reste soumise au contrôle du serveur et de l\'ABM.';
    }, 'Confirmer');
  }
  async function afficherFile() {
    var el = $('#opFile'); if (!el) return;
    var ops = await OFF.lister();
    var r = C.resumeFile(ops);
    el.innerHTML = '<div class="mm-file-resume">' + badgeFile('EN_ATTENTE', r.EN_ATTENTE + ' en attente') + badgeFile('SYNCHRONISE', r.SYNCHRONISE + ' synchronisée(s)') + badgeFile('REJETE', r.REJETE + ' rejetée(s)') +
      (r.BLOQUE ? badgeFile('BLOQUE', r.BLOQUE + ' bloquée(s)') : '') + ' <button type="button" class="mm-btn mm-secondaire mm-petit" id="opSync">Synchroniser maintenant</button></div>' +
      tableau(['Saisie', 'Créée le', 'Statut', 'Message', ''], ops.slice(0, 50).map(function (o) {
        return [esc(o.libelle), esc(C.dateHeureFr(o.cree_le)), badgeFile(o.statut), esc(o.message || ''),
          o.statut === 'BLOQUE' ? '<button type="button" class="mm-btn mm-secondaire mm-petit" data-relancer="' + esc(o.client_op_id) + '">Relancer</button>' :
          (o.statut === 'REJETE' || o.statut === 'SYNCHRONISE') ? '<button type="button" class="mm-btn mm-secondaire mm-petit" data-retirer="' + esc(o.client_op_id) + '">Retirer de l\'appareil</button>' : ''];
      }), 'Aucune saisie sur cet appareil.');
    $('#opSync').onclick = function () { OFF.synchroniser(S.sb).then(function (x) { toast(x.horsLigne ? 'Hors connexion : envoi au retour du réseau.' : (x.envoyees || 0) + ' opération(s) envoyée(s).', 'info'); afficherFile(); }); };
    $$('[data-relancer]', el).forEach(function (b) { b.onclick = function () { OFF.relancer(b.dataset.relancer).then(afficherFile); }; });
    $$('[data-retirer]', el).forEach(function (b) { b.onclick = function () { OFF.retirer(b.dataset.retirer).then(afficherFile, function (e) { toast(messageErreur(e), 'ko'); }); }; });
  }

  /* -- C. PILOTAGE ------------------------------------------------------------ */
  async function vuePilotage() {
    await chargerFlotte();
    var q = function (t, f) { return lireTable(t, f).catch(function () { return []; }); };
    var d = await Promise.all([q('moto_v_conso_moto'), q('moto_v_cout_km'), q('moto_v_disponibilite'), q('moto_v_echeances'), q('moto_v_alertes_documents'),
      peut('rapprochement') ? q('moto_v_rapprochement') : Promise.resolve([]), q('moto_v_conso_intervalles', function (x) { return x.order('fin_date', { ascending: false }).limit(200); }),
      q('moto_documents', function (x) { return x.eq('statut', 'EN_VERIFICATION'); }), q('moto_carburant', function (x) { return x.eq('justificatif_statut', 'A_VERIFIER'); }),
      q('moto_budgets', function (x) { return x.eq('statut', 'PROPOSE'); }), q('moto_corrections', function (x) { return x.eq('statut', 'DEMANDEE'); }),
      q('moto_remboursements', function (x) { return x.eq('statut', 'DEMANDE'); }), q('moto_maintenances', function (x) { return x.eq('statut', 'DEMANDEE'); }),
      q('moto_v_pneus'), q('moto_v_qualite_donnees'), q('moto_v_formation'), q('moto_incidents', function (x) { return x.neq('etape', 'CLOS'); })]);
    var conso = d[0], couts = d[1], dispo = d[2], ech = d[3], alertes = d[4], rap = d[5], inter = d[6];
    var enService = S.flotte.filter(function (m) { return m.mise_en_service_at; });
    var parMoto = function (rows, id) { return rows.filter(function (r) { return r.moto_id === id; })[0] || {}; };
    var nbInter = conso.reduce(function (t, c) { return t + Number(c.nb_intervalles || 0); }, 0);
    var kmT = conso.reduce(function (t, c) { return t + Number(c.km_mesures || 0); }, 0), lT = conso.reduce(function (t, c) { return t + Number(c.litres_mesures || 0); }, 0);
    var ckm = couts.filter(function (c) { return c.km_parcourus > 0; }), coutT = ckm.reduce(function (t, c) { return t + Number(c.cout_direct_total || 0); }, 0), kmC = ckm.reduce(function (t, c) { return t + Number(c.km_parcourus || 0); }, 0);
    var jp = dispo.reduce(function (t, x) { return t + Number(x.jours_prevus || 0); }, 0), ji = dispo.reduce(function (t, x) { return t + Number(x.jours_indisponibles || 0); }, 0);
    var avert = C.avertissementEchantillon(enService.length, nbInter);
    var mine = S.profil.user_id;
    var valid = [];
    if (peut('verifier_documents')) d[7].filter(function (x) { return x.depose_par !== mine; }).forEach(function (x) { valid.push(['Document à vérifier', C.libelle(x.type_document) + ' · ' + codeMoto(x.moto_id), '<a class="mm-btn mm-secondaire mm-petit" href="#/moto/' + esc(x.moto_id) + '/documents">Ouvrir</a>']); });
    if (peut('verifier_justificatifs')) d[8].filter(function (x) { return x.saisi_par !== mine && x.agent_id !== mine; }).forEach(function (x) { valid.push(['Justificatif carburant', codeMoto(x.moto_id) + ' · ' + C.fcfa(x.montant) + ' · ' + C.dateFr(x.date_achat), action('verifier_justificatif', 'Vérifier', { id: x.id }, 'mm-primaire') + (x.justificatif_path ? ' ' + action('voir_fichier', 'Photo', { chemin: x.justificatif_path }) : '')]); });
    if (peut('valider_budget')) d[9].filter(function (x) { return x.propose_par !== mine; }).forEach(function (x) { valid.push(['Budget proposé', C.fcfa(x.montant_autorise) + ' · ' + C.dateFr(x.periode_debut) + ' → ' + C.dateFr(x.periode_fin), action('budget_decider', 'Décider', { id: x.id }, 'mm-primaire')]); });
    if (peut('valider_corrections') || (S.profil.role === 'Finance Manager')) d[10].filter(function (x) { return x.demande_par !== mine; }).forEach(function (x) { valid.push(['Correction', x.cible_table.replace('moto_', '') + ' · ' + x.champ + ' : ' + (x.ancienne_valeur || '∅') + ' → ' + x.nouvelle_valeur + ' · ' + x.motif, action('correction_decider', 'Décider', { id: x.id }, 'mm-primaire')]); });
    if (peut('valider_corrections') || S.profil.role === 'Finance Manager') d[11].filter(function (x) { return x.demande_par !== mine; }).forEach(function (x) { valid.push(['Remboursement d\'avance', C.fcfa(x.montant), action('remboursement_decider', 'Décider', { id: x.id }, 'mm-primaire')]); });
    if (peut('maintenance_decider')) d[12].filter(function (x) { return x.demande_par !== mine; }).forEach(function (x) { valid.push(['Demande d\'entretien', codeMoto(x.moto_id) + ' · ' + C.libelle(x.type_maintenance) + ' · ' + x.description, action('maintenance_decider', 'Décider', { id: x.id }, 'mm-primaire')]); });
    vue().innerHTML = '<div class="mm-entete"><div><h1>Pilotage de la flotte</h1><p>Indicateurs calculés côté serveur sur les données réelles saisies.</p></div>' +
      (peut('exports') ? '<button type="button" class="mm-btn mm-primaire" id="pilExport">Exporter Excel</button>' : '') + '</div>' + bandeauHorsLigne() +
      (avert ? '<div class="mm-bandeau mm-info">' + esc(avert) + '</div>' : '') +
      '<div class="mm-kpis">' + kpi('Motos', String(S.flotte.length), enService.length + ' mise(s) en service') +
      kpi('Autorisées à circuler', String(S.flotte.filter(function (m) { return m.autorisee_a_circuler; }).length), S.flotte.filter(function (m) { return ['IMMOBILISEE', 'EN_REPARATION'].indexOf(m.statut_technique) >= 0; }).length + ' immobilisée(s)') +
      kpi('Consommation réelle', C.l100(kmT > 0 ? Math.round(10000 * lT / kmT) / 100 : null), nbInter + ' intervalle(s) plein à plein · référence ' + C.l100(S.params.conso_reference_l100 && S.params.conso_reference_l100.valeur)) +
      kpi('Coût direct', kmC > 0 ? C.fcfa(Math.round(10 * coutT / kmC) / 10) + '/km' : C.ND, kmC > 0 ? C.km(kmC) + ' parcourus' : 'Kilométrage insuffisant') +
      kpi('Disponibilité technique', C.pct(jp > 0 ? Math.round(1000 * (jp - ji) / jp) / 10 : null), jp ? (jp - ji) + ' / ' + jp + ' jours prévus' : 'Aucune moto en service') +
      kpi('Incidents ouverts', String(d[16].length), d[16].filter(function (i) { return i.gravite === 'CRITIQUE'; }).length + ' critique(s)') + '</div>' +
      '<section class="mm-bloc"><h2>Validations en attente (' + valid.length + ')</h2>' + tableau(['Objet', 'Détail', 'Action'], valid.map(function (v) { return [esc(v[0]), esc(v[1]), v[2]]; }), 'Rien à valider. Les opérations que vous avez initiées sont validées par un autre responsable.') + '</section>' +
      '<section class="mm-bloc"><h2>Par moto</h2>' + tableau(['Moto', 'Statuts', 'Conso réelle', 'Coût/km', 'Disponibilité', 'Échéance', 'Documents'], S.flotte.map(function (m) {
        var c = parMoto(conso, m.id), k = parMoto(couts, m.id), di = parMoto(dispo, m.id);
        var e = ech.filter(function (x) { return x.moto_id === m.id; }).sort(function (a, b) { return ['DEPASSEE', 'PROCHE', 'A_JOUR', 'NON_DISPONIBLE'].indexOf(a.statut) - ['DEPASSEE', 'PROCHE', 'A_JOUR', 'NON_DISPONIBLE'].indexOf(b.statut); })[0];
        var al = alertes.filter(function (x) { return x.moto_id === m.id && x.alerte !== 'OK'; });
        return ['<a class="mm-lien" href="#/moto/' + esc(m.id) + '">' + esc(m.code) + '</a>', badge(m.statut_technique), esc(C.l100(c.l_100km)), esc(k.fcfa_km != null ? C.fcfa(k.fcfa_km) : C.ND), esc(C.pct(di.taux_disponibilite_pct)),
          e ? badge(e.statut, e.libelle) : esc(C.ND), al.length ? al.map(function (a) { return badge(a.alerte, C.libelle(a.type_document)); }).join(' ') : badge('OK')];
      }), 'Aucune moto.') + '</section>' +
      '<section class="mm-bloc"><h2>Intervalles plein à plein récents</h2>' + tableau(['Moto', 'Du', 'Au', 'Km', 'Litres', 'L/100 km', 'Statut'], inter.map(function (i) {
        return [esc(codeMoto(i.moto_id)), esc(C.km(i.debut_km)), esc(C.km(i.fin_km)), esc(C.km(i.km)), esc(i.litres), esc(C.l100(i.l_100km)), badge(i.statut_alerte)];
      }), 'Non disponible : pas encore deux pleins complets sur une moto.') + '<p class="mm-note">Les seuils de vérification (' + C.l100(seuils().seuil1) + ', ' + C.l100(seuils().seuil2) + ') sont provisoires et configurables. Ils déclenchent une vérification, jamais une accusation.</p></section>' +
      (peut('rapprochement') ? '<section class="mm-bloc"><h2>Rapprochement des dotations</h2>' + tableau(['Bénéficiaire', 'Autorisé', 'Remis', 'Frais MM', 'Non confirmé', 'Reçu confirmé', 'Achats déclarés', 'Justifiés vérifiés', 'Restitutions', 'Avance à apurer', 'Reste à rembourser'], rap.map(function (r) {
        return [esc(r.beneficiaire_nom || '—'), esc(C.fcfa(r.budget_autorise)), esc(C.fcfa(r.dotations_remises)), esc(C.fcfa(r.frais_mobile_money)), esc(C.fcfa(r.remises_non_confirmees)), esc(C.fcfa(r.dotations_recues)),
          esc(C.fcfa(r.achats_declares)), esc(C.fcfa(r.justifies_verifies)), esc(C.fcfa(r.restitutions)), (Number(r.avance_a_apurer) < 0 ? badge('CONTESTEE', 'Pré-financé par l\'agent : ' + C.fcfa(-r.avance_a_apurer)) : '<b>' + esc(C.fcfa(r.avance_a_apurer)) + '</b>'), esc(C.fcfa(r.reste_a_rembourser))];
      }), 'Aucune dotation.') + '<p class="mm-note">Avance à apurer = reçu confirmé (y compris la part reçue d\'une dotation en écart) − justificatifs vérifiés − restitutions. Un solde négatif signifie que l\'agent a pré-financé : à régulariser, jamais à imputer. Les remboursements d\'avances personnelles sont suivis à part : aucun double comptage.</p></section>' : '') +
      '<section class="mm-bloc"><h2>Pneumatiques</h2>' + tableau(['Pneu', 'Statut', 'Moto', 'Km parcourus', 'Réparations', 'Coût/km (vie complète)'], d[13].map(function (p) {
        return [esc(p.code + ' · ' + p.marque + ' ' + p.dimensions), badge(p.statut), esc(p.moto_actuelle_id ? codeMoto(p.moto_actuelle_id) + ' ' + (p.position_actuelle || '') : '—'), esc(C.km(p.km_parcourus)), esc(p.nb_reparations + ' · ' + C.fcfa(p.cout_reparations)), esc(p.fcfa_km_vie_complete != null ? C.fcfa(p.fcfa_km_vie_complete) : 'Non disponible (pneu non réformé)')];
      }), 'Aucun pneu enregistré.') + '</section>' +
      '<section class="mm-bloc"><h2>Qualité des données</h2>' + tableau(['Moto', 'Achats sans reçu', 'Reçus à vérifier', 'Pleins complets', 'Intervalles invalides', 'Jours sans relevé', 'Corrections en attente'], d[14].map(function (x) {
        return [esc(x.code), esc(x.achats_sans_justificatif), esc(x.justificatifs_a_verifier), esc(x.pleins_complets), esc(x.intervalles_invalides), esc(x.jours_depuis_dernier_releve == null ? C.ND : x.jours_depuis_dernier_releve), esc(x.corrections_en_attente)];
      }), 'Aucune donnée.') + '</section>' +
      '<section class="mm-bloc"><h2>Formation</h2>' + tableau(['Agent', 'Module', 'Tentatives', 'Meilleur score', 'Réussi'], d[15].map(function (f) {
        return [esc(f.nom || '—'), esc(titreModule(f.module_code)), esc(f.tentatives), esc(C.pct(100 * f.meilleur_taux)), f.reussi ? badge('VALIDE', 'Oui') : badge('A_VERIFIER', 'Non')];
      }), 'Aucun résultat de formation.') + '</section>';
    var ex = $('#pilExport'); if (ex) ex.onclick = function () { exporter(d); };
  }
  function codeMoto(id) { var m = motoParId(id); return m ? m.code : String(id || '').slice(0, 8); }
  function titreModule(c) { var f = FORM.filter(function (x) { return x.code === c; })[0]; return f ? f.titre : c; }
  function clicPilotage(e) {
    var b = e.target.closest('[data-action]'); if (!b) return;
    var d = b.dataset;
    if (ACTIONS[d.action]) return ACTIONS[d.action](d, null);
    if (VALIDATIONS[d.action]) return VALIDATIONS[d.action](d);
  }
  var VALIDATIONS = {
    budget_decider: function (d) { modale('Budget proposé', champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['VALIDE', 'Valider'], ['REJETE', 'Rejeter']] }) + champ({ n: 'motif', l: 'Motif', t: 'textarea' }), function (v) { return rpc('moto_budget_decider', { p_budget: d.id, p_decision: v.decision, p_motif: v.motif }).then(router); }); },
    correction_decider: function (d) { modale('Correction demandée', champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['APPLIQUEE', 'Appliquer'], ['REJETEE', 'Rejeter']] }) + champ({ n: 'motif', l: 'Motif', t: 'textarea' }), function (v) { return rpc('moto_correction_decider', { p_correction: d.id, p_decision: v.decision, p_motif: v.motif }).then(router); }); },
    remboursement_decider: function (d) { modale('Remboursement d\'avance personnelle', champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['VALIDE', 'Valider'], ['REJETE', 'Rejeter']] }) + champ({ n: 'motif', l: 'Motif', t: 'textarea' }) + '<p class="mm-note">Moto Manager n\'exécute aucun paiement : Finance paie selon ses procédures puis déclare le paiement.</p>', function (v) { return rpc('moto_remboursement_decider', { p_remboursement: d.id, p_decision: v.decision, p_motif: v.motif }).then(router); }); }
  };
  async function exporter(d) {
    try {
      if (!g.XLSX) await chargerScript(CDN_XLSX);
      var wb = g.XLSX.utils.book_new();
      function feuille(nom, rows) { var ws = g.XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: 'Aucune donnée' }]); g.XLSX.utils.book_append_sheet(wb, ws, nom.slice(0, 31)); }
      feuille('Flotte', S.flotte.map(function (m) { return { Code: m.code, Marque: m.marque, Modele: m.modele, Immatriculation: m.immatriculation || '', Chassis: m.numero_chassis || '', Cluster: m.cluster_code || '', Administratif: C.libelle(m.statut_administratif), Affectation: C.libelle(m.statut_affectation), Technique: C.libelle(m.statut_technique), Affectataire: m.beneficiaire_nom || '', 'Mise en service': m.mise_en_service_at || '', 'Compteur km': m.compteur_actuel_km }; }));
      feuille('Consommation', d[0].map(function (c) { return { Moto: c.code, 'Intervalles': c.nb_intervalles, 'Km mesures': c.km_mesures, 'Litres': c.litres_mesures, 'L/100 km': c.l_100km == null ? C.ND : c.l_100km, 'Dernier plein complet': c.dernier_plein_complet || '' }; }));
      feuille('Intervalles plein a plein', d[6].map(function (i) { return { Moto: codeMoto(i.moto_id), 'Du km': i.debut_km, 'Au km': i.fin_km, Km: i.km, Litres: i.litres, 'L/100 km': i.l_100km, Statut: C.libelle(i.statut_alerte) }; }));
      feuille('Couts', d[1].map(function (c) { return { Moto: c.code, 'Km parcourus': c.km_parcourus, 'Carburant verifie': c.cout_carburant_verifie, 'Carburant a verifier': c.cout_carburant_a_verifier, Maintenance: c.cout_maintenance, Pneus: c.cout_pneus, Incidents: c.cout_incidents, 'FCFA/km': c.fcfa_km == null ? C.ND : c.fcfa_km }; }));
      feuille('Disponibilite', d[2].map(function (x) { return { Moto: codeMoto(x.moto_id), 'Jours prevus': x.jours_prevus, 'Jours indisponibles': x.jours_indisponibles, 'Taux %': x.taux_disponibilite_pct }; }));
      if (peut('rapprochement')) feuille('Rapprochement dotations', d[5].map(function (r) { return { Beneficiaire: r.beneficiaire_nom, Autorise: r.budget_autorise, Remis: r.dotations_remises, 'Frais MM': r.frais_mobile_money, 'Non confirme': r.remises_non_confirmees, 'Recu confirme': r.dotations_recues, 'Ecarts': r.ecarts_contestes, 'Achats declares': r.achats_declares, 'Justifies verifies': r.justifies_verifies, Restitutions: r.restitutions, 'Avance a apurer': r.avance_a_apurer, 'Avances perso verifiees': r.avances_personnelles_verifiees, 'Remboursements valides': r.remboursements_valides, 'Reste a rembourser': r.reste_a_rembourser }; }));
      feuille('Echeances', d[3].map(function (e) { return { Moto: e.code, Regle: e.libelle, Source: e.source, 'Prochaine km': e.prochaine_km, 'Prochaine date': e.prochaine_date, Statut: C.libelle(e.statut) }; }));
      feuille('Alertes documents', d[4].map(function (a) { return { Moto: a.code, Document: C.libelle(a.type_document), Alerte: C.libelle(a.alerte), Expiration: a.date_expiration || '' }; }));
      feuille('Pneus', d[13].map(function (p) { return { Code: p.code, Marque: p.marque, Dimensions: p.dimensions, Statut: C.libelle(p.statut), 'Km parcourus': p.km_parcourus, Reparations: p.cout_reparations, 'FCFA/km': p.fcfa_km_vie_complete == null ? C.ND : p.fcfa_km_vie_complete }; }));
      feuille('Incidents ouverts', d[16].map(function (i) { return { Moto: codeMoto(i.moto_id), Type: C.libelle(i.type_incident), Gravite: C.libelle(i.gravite), Etape: C.libelle(i.etape), Declare: i.declare_at, 'Registre AFLP': i.aflp_incident_id || '' }; }));
      feuille('Limites', [{ Note: C.avertissementEchantillon(S.flotte.filter(function (m) { return m.mise_en_service_at; }).length, d[0].reduce(function (t, c) { return t + Number(c.nb_intervalles || 0); }, 0)) || 'Échantillon suffisant.', Genere: new Date().toISOString(), Par: S.profil.nom }]);
      g.XLSX.writeFile(wb, 'ANAGROCI_AFLP_Moto_Manager_' + aujourdhui() + '.xlsx', { compression: true });
      toast('Classeur Excel généré.', 'ok');
    } catch (e) { toast('Export impossible : ' + messageErreur(e), 'ko'); }
  }

  /* -- D. FORMATION ----------------------------------------------------------- */
  async function vueFormation(code) {
    var mod = FORM.filter(function (f) { return f.code === code; })[0];
    if (mod) return vueModule(mod);
    var hist = await lireTable('moto_v_formation', function (q) { return q.eq('user_id', S.profil.user_id); }).catch(function () { return []; });
    vue().innerHTML = '<div class="mm-entete"><div><h1>Formation</h1><p>Fiches pratiques et quiz. Les résultats sont enregistrés, même sans réseau.</p></div></div>' +
      '<div class="mm-grille-motos">' + FORM.map(function (f) {
        var h = hist.filter(function (x) { return x.module_code === f.code; })[0];
        return '<a class="mm-carte-moto" href="#/formation/' + f.code + '"><span class="mm-surtitre">' + esc(f.duree) + '</span><h2>' + esc(f.titre) + '</h2><p>' + esc(f.fiche[0]) + '</p>' + (h ? badge(h.reussi ? 'VALIDE' : 'A_VERIFIER', h.reussi ? 'Réussi' : 'À reprendre') : badge('EN_ATTENTE', 'Non commencé')) + '</a>';
      }).join('') + '<div class="mm-carte-moto mm-desactive"><span class="mm-surtitre">Vidéo</span><h2>Module vidéo</h2><p>Aucun contenu vidéo réel n\'est disponible à ce jour. Ce module s\'ouvrira quand une vidéo validée par ANAGROCI sera fournie.</p></div></div>';
  }
  function vueModule(mod) {
    vue().innerHTML = '<a class="mm-retour" href="#/formation">← Formation</a><div class="mm-entete"><div><h1>' + esc(mod.titre) + '</h1></div></div>' +
      '<section class="mm-bloc"><h2>Fiche</h2><ul class="mm-fiche">' + mod.fiche.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></section>' +
      '<form class="mm-bloc" id="quiz"><h2>Quiz</h2>' + mod.quiz.map(function (q, i) {
        return '<fieldset class="mm-question"><legend>' + (i + 1) + '. ' + esc(q.q) + '</legend>' + q.r.map(function (r, j) { return '<label><input type="radio" name="q' + i + '" value="' + j + '" required> ' + esc(r) + '</label>'; }).join('') + '</fieldset>';
      }).join('') + '<button class="mm-btn mm-primaire" type="submit">Valider mes réponses</button><p id="quizRes" role="status"></p></form>';
    $('#quiz').onsubmit = async function (e) {
      e.preventDefault();
      var f = e.target; if (!f.checkValidity()) { f.reportValidity(); return; }
      var score = mod.quiz.reduce(function (t, q, i) { var c = f.querySelector('input[name="q' + i + '"]:checked'); return t + (c && Number(c.value) === q.b ? 1 : 0); }, 0);
      $$('button', f).forEach(function (b) { b.disabled = true; });
      mod.quiz.forEach(function (q, i) { var bonne = f.querySelector('input[name="q' + i + '"][value="' + q.b + '"]'); if (bonne) bonne.parentNode.classList.add('mm-bonne'); });
      var res = $('#quizRes'); res.textContent = 'Score : ' + score + ' / ' + mod.quiz.length + (score / mod.quiz.length >= 0.8 ? ' · Réussi.' : ' · À reprendre (80 % requis).');
      try { res.textContent += ' ' + await mettreEnFile('FORMATION', { module_code: mod.code, score: score, total: mod.quiz.length }, 'Quiz ' + mod.titre); }
      catch (ex) { res.textContent += ' ' + messageErreur(ex); }
    };
  }

  /* -- E. ADMINISTRATION ----------------------------------------------------- */
  async function vueAdmin() {
    await chargerFlotte();
    var budgets = await lireTable('moto_budgets', function (q) { return q.order('propose_at', { ascending: false }).limit(100); }).catch(function () { return []; });
    var dots = await lireTable('moto_dotations', function (q) { return q.order('remis_at', { ascending: false }).limit(100); }).catch(function () { return []; });
    var regles = await lireTable('moto_regles_maintenance').catch(function () { return []; });
    var b = await beneficiaires().catch(function () { return []; });
    var nom = function (id) { var x = b.filter(function (y) { return y.user_id === id; })[0]; return x ? x.nom : String(id).slice(0, 8); };
    vue().innerHTML = '<div class="mm-entete"><div><h1>Administration</h1><p>Inventaire, dotations, pneus et paramètres. Chaque opération est contrôlée et journalisée par le serveur.</p></div></div>' +
      '<div class="mm-tuiles">' + tuileAdmin('creer', 'Ajouter une moto', 'Passeport numérique (sans numéro inventé)') + tuileAdmin('budget', 'Budget carburant', peut('valider_budget') ? 'Autoriser un budget' : 'Proposer un budget au Branch Manager') +
      tuileAdmin('dotation', 'Remettre une dotation', 'Espèces ou Mobile Money, sur budget autorisé') + tuileAdmin('restitution', 'Restitution d\'espèces', 'Reçue par l\'ABM') +
      tuileAdmin('remboursement', 'Remboursement d\'avance', 'Avances personnelles justifiées') + tuileAdmin('correction', 'Demander une correction', 'Validée par un autre responsable') +
      tuileAdmin('pneu', 'Pneu en stock', 'Identité propre du pneu') + (peut('parametres') ? tuileAdmin('parametres', 'Paramètres', 'Seuils, équipements, règles d\'entretien') : '') + '</div>' +
      '<section class="mm-bloc"><h2>Budgets</h2>' + tableau(['Bénéficiaire', 'Période', 'Autorisé', 'Statut'], budgets.map(function (x) { return [esc(nom(x.beneficiaire_id)), esc(C.dateFr(x.periode_debut) + ' → ' + C.dateFr(x.periode_fin)), esc(C.fcfa(x.montant_autorise)), badge(x.statut)]; }), 'Aucun budget.') + '</section>' +
      '<section class="mm-bloc"><h2>Dotations</h2>' + tableau(['Bénéficiaire', 'Remise le', 'Mode', 'Remis', 'Frais', 'Reçu', 'Référence', 'Statut', ''], dots.map(function (x) {
        return [esc(nom(x.beneficiaire_id)), esc(C.dateFr(x.remis_at)), esc(C.libelle(x.mode_paiement)), esc(C.fcfa(x.montant_remis)), esc(C.fcfa(x.frais_transaction)), esc(x.montant_recu == null ? '—' : C.fcfa(x.montant_recu)), esc(x.reference || '—'), badge(x.statut),
          ['REMISE_DECLAREE', 'CONTESTEE'].indexOf(x.statut) >= 0 ? '<button type="button" class="mm-btn mm-danger mm-petit" data-echec="' + esc(x.id) + '">Déclarer échouée</button>' : ''];
      }), 'Aucune dotation.') + '</section>' +
      '<section class="mm-bloc"><h2>Règles d\'entretien</h2>' + tableau(['Règle', 'Intervalle km', 'Intervalle jours', 'Source', 'Active'], regles.map(function (r) {
        return [esc(r.libelle), esc(r.intervalle_km == null ? 'Non paramétré' : C.km(r.intervalle_km)), esc(r.intervalle_jours == null ? 'Non paramétré' : r.intervalle_jours + ' j'), esc(r.source === 'CONSTRUCTEUR_VERIFIE' ? 'Constructeur vérifié · ' + (r.reference_documentaire || '') : 'Paramètre ANAGROCI'), r.actif ? badge('VALIDE', 'Oui') : badge('EN_ATTENTE', 'Non')];
      }), 'Aucune règle.') + '<p class="mm-note">Aucune périodicité n\'est présentée comme exigence constructeur sans référence au manuel APSONIC AP150-30 vérifié.</p></section>';
    $$('[data-admin]').forEach(function (x) { x.onclick = function () { ADMIN[x.dataset.admin](b, budgets, dots, regles); }; });
    $$('[data-echec]').forEach(function (x) { x.onclick = function () { modale('Transaction échouée', champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 5 }), function (v) { return rpc('moto_dotation_signaler_echec', { p_dotation: x.dataset.echec, p_motif: v.motif }).then(vueAdmin); }, 'Déclarer échouée'); }; });
  }
  function tuileAdmin(code, t, s) { return '<button type="button" class="mm-tuile" data-admin="' + code + '"><b>' + esc(t) + '</b><span>' + esc(s) + '</span></button>'; }
  function optClusters() { return [['SAKASSOU', 'Sakassou'], ['BOTRO', 'Botro'], ['BROBO', 'Brobo'], ['DJEBONOUA', 'N\'Djébonoua'], ['BEOUMI', 'Béoumi'], ['DIABO', 'Diabo']]; }
  function optMotos() { return S.flotte.map(function (m) { return [m.id, m.code + ' · ' + (m.immatriculation || 'immat. en attente')]; }); }
  var ADMIN = {
    creer: function () {
      modale('Ajouter une moto', '<div class="mm-grille-form">' + [{ n: 'marque', l: 'Marque', req: true, v: 'APSONIC' }, { n: 'modele', l: 'Modèle', req: true, v: 'AP150-30' }, { n: 'date_reception', l: 'Date de réception physique', t: 'date', req: true },
        { n: 'cluster_code', l: 'Cluster prévu', t: 'select', o: optClusters() }, { n: 'fournisseur', l: 'Fournisseur' }, { n: 'couleur', l: 'Couleur' },
        { n: 'numero_chassis', l: 'N° de châssis', aide: 'Laisser vide tant que la carte grise réelle n\'est pas reçue.' }, { n: 'immatriculation', l: 'Immatriculation', aide: 'Vide tant que la plaque n\'est pas reçue.' },
        { n: 'compteur_km', l: 'Compteur à la réception', t: 'nombre' }, { n: 'observations', l: 'Observations', t: 'textarea' }].map(champ).join('') + '</div>',
      function (v) { return rpc('moto_creer', { p: v }).then(function (r) { location.hash = '#/moto/' + r.id; return 'Moto ' + r.code + ' créée.'; }); }, 'Créer');
    },
    budget: function (b) {
      modale('Budget carburant', '<div class="mm-grille-form">' + champ({ n: 'beneficiaire_id', l: 'Bénéficiaire', t: 'select', req: true, large: true, o: b.map(function (x) { return [x.user_id, x.nom + ' · ' + (x.cluster_code || x.role)]; }) }) +
        champ({ n: 'moto_id', l: 'Moto', t: 'select', o: optMotos() }) + champ({ n: 'montant_autorise', l: 'Montant autorisé (FCFA)', t: 'nombre', req: true, pas: 1 }) +
        champ({ n: 'periode_debut', l: 'Début', t: 'date', req: true, v: aujourdhui() }) + champ({ n: 'periode_fin', l: 'Fin', t: 'date', req: true }) + champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 5 }) + '</div>',
      function (v) { return rpc('moto_budget_proposer', { p: v }).then(function (r) { vueAdmin(); return r.statut === 'VALIDE' ? 'Budget autorisé.' : 'Budget proposé : en attente de décision du Branch Manager.'; }); });
    },
    dotation: function (b, budgets) {
      var ok = budgets.filter(function (x) { return x.statut === 'VALIDE'; });
      var nom = function (id) { var x = b.filter(function (y) { return y.user_id === id; })[0]; return x ? x.nom : ''; };
      modale('Remettre une dotation', '<div class="mm-grille-form">' + champ({ n: 'budget_id', l: 'Budget autorisé', t: 'select', req: true, large: true, o: ok.map(function (x) { return [x.id, nom(x.beneficiaire_id) + ' · ' + C.fcfa(x.montant_autorise) + ' · ' + C.dateFr(x.periode_debut) + ' → ' + C.dateFr(x.periode_fin)]; }) }) +
        champ({ n: 'mode_paiement', l: 'Mode', t: 'select', req: true, o: [['ESPECES', 'Espèces'], ['MOBILE_MONEY', 'Mobile Money']] }) + champ({ n: 'montant_remis', l: 'Montant remis (FCFA, hors frais)', t: 'nombre', req: true, pas: 1 }) +
        champ({ n: 'frais_transaction', l: 'Frais de transaction Mobile Money', t: 'nombre', pas: 1 }) + champ({ n: 'operateur_mobile_money', l: 'Opérateur Mobile Money' }) +
        champ({ n: 'reference', l: 'Référence (obligatoire en Mobile Money)' }) + champ({ n: 'motif', l: 'Commentaire', t: 'textarea' }) + '</div>' +
        '<p class="mm-note">Moto Manager enregistre la remise ; il n\'exécute aucun transfert d\'argent. La dotation ne compte comme reçue qu\'après confirmation du bénéficiaire.</p>',
      function (v) { v.client_op_id = OFF.uuid(); return rpc('moto_dotation_remettre', { p: v }).then(function (r) { vueAdmin(); return r.note; }); }, 'Enregistrer la remise');
    },
    restitution: function (b) {
      modale('Restitution d\'espèces', champ({ n: 'beneficiaire_id', l: 'Bénéficiaire', t: 'select', req: true, o: b.map(function (x) { return [x.user_id, x.nom]; }) }) + champ({ n: 'montant', l: 'Montant restitué (FCFA)', t: 'nombre', req: true, pas: 1 }) +
        champ({ n: 'mode_paiement', l: 'Mode', t: 'select', req: true, vide: false, o: [['ESPECES', 'Espèces'], ['MOBILE_MONEY', 'Mobile Money']] }) + champ({ n: 'reference', l: 'Référence' }) + champ({ n: 'motif', l: 'Commentaire', t: 'textarea' }),
        function (v) { return rpc('moto_restitution_enregistrer', { p: v }).then(function (r) { return 'Restitution enregistrée. Avance restant à apurer : ' + C.fcfa(r.solde_restant) + '.'; }); });
    },
    remboursement: async function (b) {
      var c = await lireTable('moto_carburant', function (q) { return q.eq('financement', 'AVANCE_PERSONNELLE').eq('justificatif_statut', 'VERIFIE').is('remboursement_id', null); });
      modale('Remboursement d\'avances personnelles', champ({ n: 'beneficiaire_id', l: 'Bénéficiaire', t: 'select', req: true, o: b.map(function (x) { return [x.user_id, x.nom]; }) }) +
        '<fieldset class="mm-champ mm-large"><legend>Achats justifiés vérifiés, non remboursés</legend>' + (c.length ? c.map(function (x) { return '<label class="mm-case"><input type="checkbox" name="c_' + esc(x.id) + '" data-agent="' + esc(x.agent_id) + '"> ' + esc(codeMoto(x.moto_id) + ' · ' + C.dateFr(x.date_achat) + ' · ' + C.fcfa(x.montant)) + '</label>'; }).join('') : '<p>Aucun achat éligible.</p>') + '</fieldset>' + champ({ n: 'motif', l: 'Commentaire', t: 'textarea' }),
      function (v) { var ids = Object.keys(v).filter(function (k) { return k.indexOf('c_') === 0 && v[k]; }).map(function (k) { return k.slice(2); }); return rpc('moto_remboursement_demander', { p: { beneficiaire_id: v.beneficiaire_id, carburant_ids: ids, motif: v.motif } }).then(function (r) { return 'Demande de ' + C.fcfa(r.montant) + ' transmise pour validation.'; }); }, 'Demander');
    },
    correction: function () {
      modale('Demander une correction', '<div class="mm-grille-form">' + champ({ n: 'cible_table', l: 'Type d\'enregistrement', t: 'select', req: true, o: [['moto_carburant', 'Achat de carburant'], ['moto_releves_km', 'Relevé kilométrique'], ['moto_dotations', 'Dotation']] }) +
        champ({ n: 'cible_id', l: 'Identifiant de l\'enregistrement', req: true, aide: 'Visible dans le journal ou l\'export.' }) +
        champ({ n: 'champ', l: 'Champ', t: 'select', req: true, o: [['litres', 'Litres'], ['montant', 'Montant'], ['compteur_km', 'Compteur'], ['plein_complet', 'Plein complet (true/false)'], ['date_achat', 'Date d\'achat'], ['montant_remis', 'Montant remis'], ['frais_transaction', 'Frais Mobile Money'], ['reference', 'Référence']] }) +
        champ({ n: 'nouvelle_valeur', l: 'Nouvelle valeur', req: true }) + champ({ n: 'motif', l: 'Motif (10 caractères minimum)', t: 'textarea', req: true, min: 10 }) + '</div>',
      function (v) { return rpc('moto_correction_demander', { p: v }).then(function () { return 'Correction demandée : elle sera appliquée après validation par un autre responsable.'; }); }, 'Demander');
    },
    pneu: function () {
      modale('Pneu en stock', '<div class="mm-grille-form">' + [{ n: 'code', l: 'Code interne', req: true, ph: 'PN-001' }, { n: 'marque', l: 'Marque', req: true }, { n: 'modele', l: 'Modèle' }, { n: 'dimensions', l: 'Dimensions', req: true },
        { n: 'numero_serie', l: 'N° de série / DOT' }, { n: 'date_achat', l: 'Date d\'achat', t: 'date' }, { n: 'cout_achat', l: 'Coût d\'achat (FCFA)', t: 'nombre', pas: 1 }, { n: 'fournisseur', l: 'Fournisseur' }].map(champ).join('') + '</div>',
      function (v) { return rpc('moto_pneu_creer', { p: v }).then(function () { return 'Pneu enregistré en stock.'; }); });
    },
    parametres: function (b, bu, d, regles) {
      var p = S.params;
      modale('Paramètres', '<div class="mm-grille-form">' + champ({ n: 'conso_seuil_verification_1', l: 'Seuil de vérification 1 (L/100 km)', t: 'nombre', pas: '0.1', v: p.conso_seuil_verification_1 && p.conso_seuil_verification_1.valeur }) +
        champ({ n: 'conso_seuil_verification_2', l: 'Seuil de vérification 2 (L/100 km)', t: 'nombre', pas: '0.1', v: p.conso_seuil_verification_2 && p.conso_seuil_verification_2.valeur }) +
        champ({ n: 'jours_operationnels_semaine', l: 'Jours opérationnels / semaine', t: 'nombre', pas: 1, v: p.jours_operationnels_semaine && p.jours_operationnels_semaine.valeur }) +
        champ({ n: 'regle', l: 'Règle d\'entretien à paramétrer', t: 'select', o: regles.map(function (r) { return [r.code, r.libelle]; }) }) + champ({ n: 'intervalle_km', l: 'Intervalle (km)', t: 'nombre', pas: 1 }) +
        champ({ n: 'intervalle_jours', l: 'Intervalle (jours)', t: 'nombre', pas: 1 }) + champ({ n: 'source', l: 'Source', t: 'select', vide: false, o: [['PARAMETRE_ANAGROCI', 'Paramètre ANAGROCI'], ['CONSTRUCTEUR_VERIFIE', 'Constructeur (manuel vérifié)']] }) +
        champ({ n: 'reference_documentaire', l: 'Référence du manuel (obligatoire si constructeur)' }) + champ({ n: 'actif', l: 'Activer la règle', t: 'checkbox' }) + champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 5 }) + '</div>',
      async function (v) {
        var jobs = [['conso_seuil_verification_1', v.conso_seuil_verification_1], ['conso_seuil_verification_2', v.conso_seuil_verification_2], ['jours_operationnels_semaine', v.jours_operationnels_semaine]]
          .filter(function (x) { return x[1] != null && String(x[1]) !== String(p[x[0]] && p[x[0]].valeur); })
          .map(function (x) { return rpc('moto_parametre_modifier', { p_cle: x[0], p_valeur: C.nombreSaisi(x[1]), p_valeur_json: null, p_motif: v.motif }); });
        if (v.regle) jobs.push(rpc('moto_regle_maintenance_definir', { p: { code: v.regle, intervalle_km: v.intervalle_km, intervalle_jours: v.intervalle_jours, source: v.source, reference_documentaire: v.reference_documentaire, actif: !!v.actif, motif: v.motif } }));
        await Promise.all(jobs); await chargerParametres(); vueAdmin(); return 'Paramètres enregistrés.';
      });
    }
  };

  /* -- Démarrage ------------------------------------------------------------- */
  function etatReseau() {
    var el = $('#motoReseau'); if (!el) return;
    var en = navigator.onLine !== false;
    el.className = 'mm-reseau ' + (en ? 'mm-ok' : 'mm-ko'); el.textContent = en ? 'En ligne' : 'Hors connexion';
  }
  async function demarrer(detail) {
    S.profil = detail.profile; S.classe = C.classeDepuisRole(S.profil.role);
    if (!S.classe) {
      $('#motoApp').innerHTML = '<main class="mm-main"><div class="mm-vide"><b>Accès Moto Manager non prévu pour votre rôle (' + esc(S.profil.role) + ').</b><p>Contactez le Branch Manager si besoin. Le serveur refuse de toute façon toute donnée moto aux rôles non habilités.</p><a class="mm-btn mm-secondaire" href="../index.html">Retour au portail</a></div></main>';
      return;
    }
    S.sb = await attendreClient();
    if (!g.ANAGROCI_OFFLINE) g.ANAGROCI_OFFLINE = { summary: function () { return OFF.resume().then(function (r) { return { pending: r.EN_ATTENTE, failed: r.BLOQUE, review: 0, conflicts: 0 }; }); } };
    coquille(); etatReseau();
    await chargerParametres();
    OFF.abonner(function (r) { var el = $('#motoFile'); if (el) { el.textContent = r.EN_ATTENTE + r.BLOQUE ? (r.EN_ATTENTE + r.BLOQUE) + ' en attente' : 'À jour'; el.className = 'mm-file ' + (r.EN_ATTENTE + r.BLOQUE ? 'mm-warn' : 'mm-ok'); } });
    g.addEventListener('online', function () { etatReseau(); OFF.synchroniser(S.sb).then(function (x) { if (x.envoyees) { toast(x.envoyees + ' opération(s) synchronisée(s).', 'ok'); router(); } }); });
    g.addEventListener('offline', etatReseau);
    g.addEventListener('hashchange', router);
    vue().addEventListener('click', function (e) { if (routeActive().espace === 'pilotage') clicPilotage(e); });
    setInterval(function () { OFF.synchroniser(S.sb); }, 60000);
    OFF.synchroniser(S.sb).catch(function () {});
    if (!location.hash) location.hash = S.classe === 'UNITE' ? '#/operations' : '#/motos';
    router();
  }
  if (g.ANAGROCI_AUTH && g.ANAGROCI_AUTH.profile) demarrer(g.ANAGROCI_AUTH);
  else document.addEventListener('anagroci:authenticated', function (e) { demarrer(e.detail); });
  g.MOTO_APP = { etat: S, router: router };
})(window);
