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
  var S = { sb: null, profil: null, classe: null, flotte: [], flotteLe: null, horsLigne: false, params: {}, beneficiaires: null, catalogue: [], urls: {} };
  var CDN_XLSX = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  var CDN_QR = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

  /* -- Outils --------------------------------------------------------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function peut(d) { return C.peut(S.classe, d); }
  function vue() { return $('#motoVue'); }
  var TONS = { CONFORME: 'ok', APTE: 'ok', REMISE: 'ok', TRANSFEREE: 'ok', CONFIRMEE: 'ok', VERIFIE: 'ok', SYNCHRONISE: 'ok', VALIDE: 'ok', TERMINEE: 'ok', A_JOUR: 'ok', OK: 'ok', NORMAL: 'ok', CLOS: 'ok', REMIS_EN_SERVICE: 'ok', PAYE_DECLARE: 'ok', APPLIQUEE: 'ok', OPERATIONNELLE: 'ok', CLOTUREE: 'ok', EFFECTUEE: 'ok', APPROUVEE: 'ok', VALIDEE: 'ok', ACCEPTEE: 'ok',
    NON_CONFORME: 'ko', IMMOBILISEE: 'ko', ECHOUEE: 'ko', REJETE: 'ko', REJETEE: 'ko', DEPASSEE: 'ko', EXPIRE: 'ko', MANQUANT: 'ko', VERIFICATION_PRIORITAIRE: 'ko', CRITIQUE: 'ko', BLOQUE: 'ko', INVALIDE: 'ko', REFUSEE: 'ko', NON_EFFECTUEE: 'ko', NON_EVALUABLE: 'ko',
    EN_REPARATION: 'warn', EN_VERIFICATION: 'warn', A_CONTROLER: 'warn', PREAFFECTEE: 'warn', REMISE_DECLAREE: 'warn', CONTESTEE: 'warn', A_VERIFIER: 'warn', PROCHE: 'warn', EXPIRE_BIENTOT: 'warn', VERIFICATION: 'warn', EN_ATTENTE: 'warn', PROPOSE: 'warn', DEMANDEE: 'warn', DEMANDE: 'warn', MAJEURE: 'warn', PREVUE: 'neutre', RESERVES: 'warn', EFFECTUEE_HORS_DELAI: 'warn', OUVERTE: 'warn', PLANIFIEE: 'warn', REALISEE: 'warn', PROGRAMMEE: 'neutre', DECLAREE: 'warn', JUSTIFIEE: 'warn', ACCEPTEE_AVEC_RESERVES: 'warn', AFFECTEE: 'warn' };
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
    if (f.t === 'scan') return g.MOTO_SCAN ? g.MOTO_SCAN.champ(f) : champ({ n: f.n, l: f.l, t: 'fichier', req: f.req, large: true, capture: true, aide: f.aide });
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
      else if (el.hasAttribute('data-scan')) o[el.name] = el._scan || null;
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
      var scanManquant = $$('input[data-scan][data-req]', form).filter(function (x) { return !x._scan; })[0];
      if (scanManquant) { err.hidden = false; err.textContent = 'Document obligatoire : scannez-le ou importez le PDF (' + (scanManquant.closest('[data-scan-titre]').getAttribute('data-scan-titre')) + ').'; return; }
      var btn = $('button[type=submit]', form); btn.disabled = true; err.hidden = true;
      try { var r = await soumettre(lireFormulaire(form), form); fermer(); if (r !== false) toast(typeof r === 'string' ? r : 'Enregistré.', 'ok'); }
      catch (ex) { err.hidden = false; err.textContent = messageErreur(ex); btn.disabled = false; }
    });
    if (g.MOTO_SCAN) g.MOTO_SCAN.brancher(d);
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    var premier = $('input:not([type=hidden]),select,textarea', d); if (premier) premier.focus();
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
  async function chargerCatalogue() {
    try { S.catalogue = await lireTable('moto_catalogue_points'); OFF.memoriser('catalogue', S.catalogue); }
    catch (e) { var c = await OFF.relire('catalogue'); S.catalogue = (c && c.valeur) || []; }
  }
  /* Liste des points d'un contrôle : catalogue SERVEUR (la gravité affichée est celle du serveur). */
  function liste(type) { return C.listeControle(type, S.catalogue); }
  function nomMoto(m) { return [m.marque, m.modele].filter(Boolean).join(' ') || 'Marque et modèle non disponibles'; }
  function nd(v, f) { return v == null || v === '' ? C.ND : (f ? f(v) : v); }
  /* Photos : URL signée de courte durée, jamais d'URL publique. */
  async function urlSignee(chemin) {
    if (!chemin) return null;
    var c = S.urls[chemin]; if (c && c.exp > Date.now()) return c.url;
    var r = await S.sb.storage.from('moto-documents').createSignedUrl(chemin, 600);
    if (r.error || !r.data) return null;
    S.urls[chemin] = { url: r.data.signedUrl, exp: Date.now() + 540000 }; return r.data.signedUrl;
  }
  function imgPhoto(chemin, classe, alt) {
    return chemin ? '<img class="' + (classe || 'mm-photo') + '" data-photo="' + esc(chemin) + '" alt="' + esc(alt || 'Photo de la moto') + '" loading="lazy">'
                  : '<div class="' + (classe || 'mm-photo') + ' mm-photo-vide" role="img" aria-label="Photo non disponible"><span>Photo non disponible</span></div>';
  }
  function chargerPhotos(racine) {
    $$('img[data-photo]', racine).forEach(function (img) {
      urlSignee(img.getAttribute('data-photo')).then(function (u) { if (u) img.src = u; else img.replaceWith(Object.assign(document.createElement('div'), { className: img.className + ' mm-photo-vide', innerHTML: '<span>Photo indisponible hors connexion</span>' })); });
    });
  }
  /* Champ photo : caméra du téléphone ou galerie, avec aperçu avant validation. */
  function champPhoto(n, l, req, aide) {
    return '<div class="mm-champ mm-large mm-champ-photo"><label for="f_' + n + '">' + esc(l) + (req ? ' *' : '') + '</label>' +
      '<input id="f_' + n + '" type="file" name="' + n + '" accept="image/*" data-apercu' + (req ? ' required' : '') + '>' +
      '<small class="mm-aide">' + esc(aide || 'Sur téléphone : prise de vue ou galerie. Aperçu ci-dessous avant validation.') + '</small><img class="mm-apercu" alt="" hidden></div>';
  }
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el.matches || !el.matches('input[data-apercu]')) return;
    var img = el.parentNode.querySelector('.mm-apercu'); if (!img) return;
    if (el.files && el.files[0]) { img.src = URL.createObjectURL(el.files[0]); img.hidden = false; img.alt = 'Aperçu : ' + el.files[0].name; } else { img.hidden = true; }
  });
  /* Série de photos datées par catégorie (inspections, états). */
  function champsPhotos(prefixe, categories, obligatoires) {
    return '<fieldset class="mm-champ mm-large mm-photos"><legend>Photographies' + (obligatoires && obligatoires.length ? ' (obligatoires : ' + esc(obligatoires.map(libPhoto).join(', ')) + ')' : '') + '</legend><div class="mm-grille-form">' +
      categories.map(function (c) { return champPhoto(prefixe + c, libPhoto(c), (obligatoires || []).indexOf(c) >= 0); }).join('') + '</div></fieldset>';
  }
  function libPhoto(c) { return { PRINCIPALE: 'Photo principale', AVANT: 'Avant', ARRIERE: 'Arrière', GAUCHE: 'Côté gauche', DROITE: 'Côté droit', COMPTEUR: 'Compteur', ANOMALIE: 'Anomalie', DOCUMENT: 'Document', AUTRE: 'Autre' }[c] || c; }
  async function deposerPhotos(motoId, v, prefixe, categories) {
    var out = [];
    for (var i = 0; i < categories.length; i++) {
      var f = v[prefixe + categories[i]]; if (!f) continue;
      var d = await deposer(motoId, 'controle', f); out.push({ path: d.chemin, categorie: categories[i] });
    }
    return out;
  }
  function fichiersPhotos(motoId, v, prefixe, categories) {  // version hors connexion (file locale)
    return Promise.all(categories.filter(function (c) { return v[prefixe + c]; }).map(function (c) {
      return compresser(v[prefixe + c]).then(function (blob) { return { champ: 'photo_' + c.toLowerCase(), blob: blob, moto_id: motoId, categorie: 'controle', extension: extension(blob, v[prefixe + c].name), liste: 'photos', categorie_photo: c }; });
    }));
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
    { r: 'coordination', l: 'Coordination', ic: 'C', droit: 'coordination' },
    { r: 'maintenance', l: 'Maintenance', ic: 'E', droit: 'maintenance_voir' },
    { r: 'conducteurs', l: 'Conducteurs', ic: 'D', droit: 'permis_voir' },
    { r: 'missions', l: 'Missions', ic: 'K', droit: 'missions' },
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
    vue().innerHTML = '<div class="mm-chargement">Chargement…</div>'; vue().onclick = null;
    try {
      if (r.espace === 'moto' && r.id) await vuePasseport(r.id, r.onglet || 'synthese');
      else if (r.espace === 'operations') await vueOperations();
      else if (r.espace === 'coordination' && peut('coordination')) await vueCoordination();
      else if (r.espace === 'maintenance' && peut('maintenance_voir') && MNT) await MNT.vue(r.id);
      else if (r.espace === 'conducteurs' && peut('permis_voir') && PERMIS) await PERMIS.vue();
      else if (r.espace === 'missions' && peut('missions') && MISSION) await MISSION.vue();
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
    var titre = S.classe === 'UNITE' ? 'Ma moto' : 'Parc AFLP FLEET';
    vue().innerHTML = '<div class="mm-entete"><div><h1>' + titre + '</h1><p>' + (S.classe === 'UNITE' ? 'Passeport numérique de la moto qui vous est remise.' : liste.length + ' moto(s) dans votre périmètre.') + '</p></div>' +
      (peut('inventaire') ? '<a class="mm-btn mm-primaire" href="#/admin">Ajouter ou administrer</a>' : (peut('inventaire_logistique') ? '<a class="mm-btn mm-primaire" href="#/coordination">Enregistrer une moto</a>' : '')) + '</div>' + bandeauHorsLigne() +
      (liste.length ? '<div class="mm-grille-motos" id="mmGrille">' + liste.map(function (m, i) { return carteMoto(m, immos[i]); }).join('') + '</div>'
        : '<div class="mm-vide"><b>Aucune moto à afficher.</b><p>' + (S.classe === 'UNITE' ? 'Aucune moto ne vous a encore été remise. La remise officielle se fait au bureau ANAGROCI de Bouaké.' : 'Aucune moto enregistrée dans votre périmètre.') + '</p></div>');
    chargerPhotos(vue());
    if (PERMIS && peut('mon_permis')) {
      var html = await PERMIS.blocMonPermis();
      if (html) { var e = document.createElement('div'); e.innerHTML = html; var ent = $('.mm-entete', vue()); ent.parentNode.insertBefore(e.firstChild, ent.nextSibling); PERMIS.brancherMonPermis(vue(), vueMotos); }
    }
  }
  function carteMoto(m, immoLocale) {
    var circule = m.autorisee_a_circuler && !immoLocale;
    var sit = C.situationMoto(m);
    return '<a class="mm-carte-moto" href="#/moto/' + esc(m.id) + '">' + imgPhoto(m.photo_path, 'mm-photo mm-photo-carte', 'Photo de ' + m.code) + '<div class="mm-carte-tete"><b class="mm-code">' + esc(m.code) + '</b>' +
      '<span class="mm-circule ' + (circule ? 'mm-ok' : 'mm-ko') + '">' + (m.situation_parc === 'PREVUE' ? 'Pas encore réceptionnée' : circule ? 'Autorisée à circuler' : 'Ne pas circuler') + '</span></div>' +
      '<h2>' + esc(nomMoto(m)) + '</h2><p class="mm-immat">' + esc(m.immatriculation || 'Immatriculation en attente') + '</p>' +
      '<div class="mm-badges">' + badge(sit.code) + (m.dossier_incomplet ? '<span class="mm-badge mm-warn">Dossier à compléter</span>' : '') +
      (Number(m.actions_critiques_ouvertes) ? '<span class="mm-badge mm-ko">' + esc(m.actions_critiques_ouvertes) + ' anomalie(s) critique(s)</span>' : '') + '</div>' +
      (immoLocale ? '<p class="mm-bandeau mm-ko">Immobilisée sur cet appareil depuis ' + esc(C.dateHeureFr(immoLocale.depuis)) + ' (en attente de synchronisation).</p>' : '') +
      '<div class="mm-badges">' + badge(m.statut_administratif, 'Admin') + badge(m.statut_affectation, 'Affectation') + badge(m.statut_technique, 'Technique') + '</div>' +
      '<dl class="mm-mini"><div><dt>Cluster</dt><dd>' + esc(m.cluster_code || m.zone_code || C.ND) + '</dd></div><div><dt>' + (m.situation_parc === 'PREVUE' ? 'Utilisateur prévu' : 'Affectataire') + '</dt><dd>' + esc((m.situation_parc === 'PREVUE' ? m.beneficiaire_prevu_nom : m.beneficiaire_nom) || C.ND) + '</dd></div>' +
      '<div><dt>Compteur</dt><dd>' + esc(C.km(m.compteur_actuel_km)) + '</dd></div><div><dt>Incidents ouverts</dt><dd>' + esc(m.incidents_ouverts) + '</dd></div></dl></a>';
  }

  /* -- Passeport numérique --------------------------------------------------- */
  var ONGLETS = [['synthese', 'Synthèse'], ['carnet', 'Carnet de suivi'], ['documents', 'Documents'], ['affectations', 'Affectations'], ['kilometrage', 'Kilométrage'], ['controles', 'Contrôles'],
                 ['photos', 'Photos'], ['anomalies', 'Anomalies'], ['carburant', 'Carburant'], ['entretiens', 'Entretiens'], ['pneus', 'Pneus'], ['incidents', 'Incidents'], ['journal', 'Journal']];
  async function vuePasseport(id, onglet) {
    // Toujours relire l'état serveur : un autre responsable a pu changer les statuts.
    await chargerFlotte();
    var m = motoParId(id);
    if (!m) { vue().innerHTML = '<div class="mm-vide"><b>Moto introuvable ou hors de votre périmètre.</b></div>'; return; }
    var immo = await OFF.immobilisationLocale(id);
    var sit = C.situationMoto(m);
    vue().innerHTML = '<a class="mm-retour" href="#/motos">← Retour</a><section class="mm-passeport">' + imgPhoto(m.photo_path, 'mm-photo mm-photo-passeport', 'Photo principale de ' + m.code) +
      '<div class="mm-qr" id="mmQr" aria-label="QR code ' + esc(m.code) + '"></div><div class="mm-pass-info">' +
      '<span class="mm-surtitre">Passeport numérique · ' + esc(C.libelle(m.origine || 'NEUVE')) + '</span><h1>' + esc(m.code) + ' · ' + esc(nomMoto(m)) + '</h1>' +
      '<dl class="mm-mini"><div><dt>Immatriculation</dt><dd>' + esc(m.immatriculation || 'En attente') + '</dd></div><div><dt>Châssis</dt><dd class="mm-mono">' + esc(m.numero_chassis || 'Non renseigné') + '</dd></div>' +
      '<div><dt>Moteur</dt><dd class="mm-mono">' + esc(m.numero_moteur || 'Non renseigné') + '</dd></div><div><dt>Réception</dt><dd>' + esc(C.dateFr(m.date_reception)) + '</dd></div>' +
      '<div><dt>Mise en service</dt><dd>' + esc(m.mise_en_service_at ? C.dateFr(m.mise_en_service_at) : 'Non autorisée') + '</dd></div><div><dt>Compteur</dt><dd>' + esc(C.km(m.compteur_actuel_km)) + '</dd></div></dl>' +
      '<div class="mm-badges">' + badge(sit.code) + badge(m.statut_administratif, 'Admin') + badge(m.statut_affectation, 'Affectation') + badge(m.statut_technique, 'Technique') +
      (m.dossier_incomplet ? '<span class="mm-badge mm-warn">Dossier à compléter</span>' : '') + '</div>' +
      (immo ? '<p class="mm-bandeau mm-ko">Immobilisation de sécurité enregistrée sur cet appareil : ne pas circuler.</p>' : '') + '</div></section>' + bandeauHorsLigne() +
      '<nav class="mm-onglets" aria-label="Sections du passeport">' + ONGLETS.filter(function (o) { return o[0] !== 'journal' || peut('journal'); }).map(function (o) {
        return '<a href="#/moto/' + esc(id) + '/' + o[0] + '"' + (o[0] === onglet ? ' class="mm-actif" aria-current="page"' : '') + '>' + o[1] + '</a>';
      }).join('') + '</nav><div id="mmOnglet" class="mm-onglet"><div class="mm-chargement">Chargement…</div></div>';
    dessinerQr(m);
    var cible = $('#mmOnglet');
    var rendu = { synthese: ongletSynthese, carnet: function (x) { return CARNET ? CARNET.onglet(x) : '<div class="mm-vide mm-ko">Carnet non chargé.</div>'; }, documents: ongletDocuments, affectations: ongletAffectations, kilometrage: ongletKm, controles: ongletControles,
                  photos: ongletPhotos, anomalies: ongletAnomalies,
                  carburant: ongletCarburant, entretiens: ongletEntretiens, pneus: ongletPneus, incidents: ongletIncidents, journal: ongletJournal }[onglet] || ongletSynthese;
    chargerPhotos($('.mm-passeport'));
    try { cible.innerHTML = await rendu(m); brancherActions(cible, m); chargerPhotos(cible); }
    catch (e) { cible.innerHTML = '<div class="mm-vide mm-ko">' + esc(messageErreur(e)) + '</div>'; }
  }
  async function dessinerQr(m) {
    var el = $('#mmQr'); if (!el) return;
    // Le QR ouvre la fiche dans l'application ; l'accès reste soumis à la connexion FBMS et au périmètre serveur.
    var texte = location.origin + location.pathname + '#/moto/' + m.id;
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
      ['Remise enregistrée (PV vérifié + état contradictoire accepté)', ['REMISE', 'TRANSFEREE'].indexOf(m.statut_affectation) >= 0], ['Autorisation de circulation du Branch Manager', !!m.mise_en_service_at],
      ['Aucune anomalie critique ouverte', !Number(m.actions_critiques_ouvertes)]
    ];
    var dates = '<section class="mm-bloc"><h2>Dates et historique</h2><dl class="mm-mini">' +
      '<div><dt>Acquisition</dt><dd>' + esc(nd(m.date_acquisition, C.dateFr)) + '</dd></div><div><dt>Réception</dt><dd>' + esc(nd(m.date_reception, C.dateFr)) + '</dd></div>' +
      '<div><dt>Début d\'utilisation</dt><dd>' + esc(nd(m.date_debut_utilisation, C.dateFr)) + '</dd></div><div><dt>Début du suivi fiable</dt><dd>' + esc(nd(m.date_debut_suivi || (m.origine === 'NEUVE' ? m.date_reception : null), C.dateFr)) + '</dd></div>' +
      '<div><dt>Compteur à la réception</dt><dd>' + esc(nd(m.compteur_reception_km, C.km)) + '</dd></div><div><dt>Fournisseur</dt><dd>' + esc(nd(m.fournisseur)) + '</dd></div></dl>' +
      (m.historique_note ? '<p class="mm-note">' + esc(m.historique_note) + '</p>' : '') +
      (m.origine === 'EN_EXPLOITATION' ? '<p class="mm-note">Moto intégrée en cours d\'exploitation : les indicateurs ne couvrent que la période suivie dans AFLP FLEET. Aucune dépense ni vidange antérieure n\'est reconstituée.</p>' : '') + '</section>';
    var actions = [], prevue = m.situation_parc === 'PREVUE', ref = m.origine === 'EN_EXPLOITATION';
    if (prevue && (peut('inventaire') || peut('inventaire_logistique'))) actions.push(action('receptionner', 'Enregistrer la réception physique', { id: m.id }, 'mm-primaire'));
    if (peut('photo_principale') && !prevue) actions.push(action('photo', m.photo_path ? 'Changer la photo' : 'Ajouter la photo', { id: m.id }));
    if (peut('preaffecter') && m.statut_affectation === 'NON_AFFECTEE' && !prevue) actions.push(action('preaffecter', 'Préaffecter', { id: m.id }, 'mm-primaire'));
    if ((peut('inspection') || peut('inventaire')) && !prevue) actions.push(action('inspection', ref ? 'État technique de référence' : 'Inspection mécanique initiale', { id: m.id }));
    if (peut('etat_remise') && m.statut_affectation === 'PREAFFECTEE') actions.push(action('etat_remise', 'État contradictoire avant remise', { id: m.id }, 'mm-primaire'));
    if (peut('remettre') && m.statut_affectation === 'PREAFFECTEE') actions.push(action('remettre', 'Enregistrer la remise', { id: m.id }, 'mm-primaire'));
    if (peut('inspection_mensuelle') && m.mise_en_service_at && m.beneficiaire_id !== S.profil.user_id) actions.push(action('inspection_mensuelle', 'Inspection mensuelle', { id: m.id }, 'mm-primaire'));
    if (!prevue && m.beneficiaire_id !== S.profil.user_id && peut('inspection_independante') && m.beneficiaire_classe === 'LOGISTIQUE' && m.mise_en_service_at) actions.push(action('inspection_mensuelle', 'Contrôle indépendant', { id: m.id, niveau: 'INDEPENDANTE' }));
    if (!prevue && (peut('actions') || peut('inspection_mensuelle') || m.beneficiaire_id === S.profil.user_id)) actions.push(action('signaler', 'Signaler une anomalie', { id: m.id }));
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
      '</ul><p class="mm-note">Prévue, réceptionnée, affectée et opérationnelle sont quatre situations distinctes. La réception physique ou une photo ne valent jamais autorisation de circulation.</p></section>' + dates +
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
      var type = C.libelle(x.type_controle) + (x.niveau ? ' · ' + C.libelleNiveau(x.niveau) : '') + (x.remplace_par ? ' (version corrigée)' : '');
      var res = x.conformite ? badge(x.conformite) : badge(x.resultat === 'APTE' ? 'APTE' : (x.anomalie_critique ? 'CRITIQUE' : 'A_CONTROLER'), x.resultat);
      if (x.confirmation_statut) res += ' ' + badge(x.confirmation_statut, 'Bénéficiaire');
      if (x.compteur_incoherent) res += ' <span class="mm-badge mm-warn">Compteur incohérent</span>';
      return [esc(C.dateHeureFr(x.date_controle)), esc(type), res,
        esc(ko.join(', ') || 'Aucun') + (x.observations ? '<small class="mm-aide">' + esc(x.observations) + '</small>' : ''), esc([x.intervenant_nom, x.garage_nom, x.inspecteur_externe].filter(Boolean).join(' · ') || '—') + (x.avis_mecanicien ? '<small class="mm-aide">Avis mécanicien (non réglementaire) : ' + esc(x.avis_mecanicien) + '</small>' : '')];
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
    if (!MNT) return '<div class="mm-vide mm-ko">Module maintenance non chargé.</div>';
    return MNT.ongletMoto(m);
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
  async function ongletPhotos(m) {
    var r = await lireTable('moto_photos', function (q) { return q.eq('moto_id', m.id).order('prise_at', { ascending: false }).limit(200); });
    var ctl = await lireTable('moto_controles', function (q) { return q.eq('moto_id', m.id).limit(200); }).catch(function () { return []; });
    var typeDe = {}; ctl.forEach(function (c) { typeDe[c.id] = C.libelle(c.type_controle) + (c.niveau ? ' · ' + C.libelleNiveau(c.niveau) : ''); });
    var bouton = peut('photo_principale') || peut('inspection_mensuelle') || m.beneficiaire_id === S.profil.user_id ? '<div class="mm-actions">' + action('photo', 'Ajouter une photo', { id: m.id, galerie: '1' }) + '</div>' : '';
    if (!r.length) return bouton + '<div class="mm-vide">Aucune photo. La photo principale et les photos d\'inspection apparaissent ici, datées.</div>';
    // Regroupement par date : comparaison photographique d'une inspection à l'autre.
    var jours = {}; r.forEach(function (x) { var j = String(x.prise_at).slice(0, 10); (jours[j] = jours[j] || []).push(x); });
    return bouton + Object.keys(jours).map(function (j) {
      return '<section class="mm-bloc"><h2>' + esc(C.dateFr(j)) + '</h2><div class="mm-galerie">' + jours[j].map(function (x) {
        return '<figure>' + imgPhoto(x.storage_path, 'mm-photo mm-photo-galerie', libPhoto(x.categorie) + ' du ' + C.dateFr(x.prise_at)) +
          '<figcaption><b>' + esc(libPhoto(x.categorie)) + '</b>' + (x.controle_id && typeDe[x.controle_id] ? ' · ' + esc(typeDe[x.controle_id]) : '') + (x.legende ? '<br>' + esc(x.legende) : '') +
          ' <button type="button" class="mm-lien" data-action="voir_fichier" data-chemin="' + esc(x.storage_path) + '">Ouvrir</button></figcaption></figure>';
      }).join('') + '</div></section>';
    }).join('');
  }
  async function ongletAnomalies(m) {
    var r = await lireTable('moto_v_actions', function (q) { return q.eq('moto_id', m.id).order('constat_at', { ascending: false }); });
    var bouton = '<div class="mm-actions">' + action('signaler', 'Signaler une anomalie', { id: m.id }, 'mm-primaire') + '</div>';
    return bouton + tableauActions(r, false) + '<p class="mm-note">Une anomalie reste ouverte jusqu\'à sa vérification par une autre personne que celle qui a réalisé la réparation. Une anomalie critique immobilise la moto ; sa clôture ne vaut pas remise en service.</p>';
  }
  function boutonsAction(a) {
    var b = [], mine = S.profil.user_id;
    if (peut('actions') && ['OUVERTE', 'PLANIFIEE'].indexOf(a.statut) >= 0) b.push(action('action_planifier', a.statut === 'OUVERTE' ? 'Planifier' : 'Replanifier', { aid: a.id, moto: a.moto_id }));
    if ((peut('actions') || peut('actions_verifier')) && a.statut === 'PLANIFIEE') b.push(action('action_realiser', 'Déclarer réalisée', { aid: a.id, moto: a.moto_id }));
    if (peut('actions_verifier') && a.statut === 'REALISEE' && a.realise_par !== mine) b.push(action('action_verifier', 'Vérifier', { aid: a.id, moto: a.moto_id }, 'mm-primaire'));
    return b.join(' ');
  }
  function tableauActions(r, avecMoto) {
    return tableau((avecMoto ? ['Moto'] : []).concat(['Problème', 'Gravité', 'Constaté', 'Responsable', 'Échéance', 'Statut', 'Action']), r.map(function (a) {
      return (avecMoto ? ['<a class="mm-lien" href="#/moto/' + esc(a.moto_id) + '/anomalies">' + esc(a.moto_code) + '</a>'] : []).concat([
        esc(a.anomalie) + (a.occurrences > 1 ? ' <span class="mm-badge mm-warn">' + esc(a.occurrences) + ' constats</span>' : '') + (a.recurrente && a.occurrences < 2 ? ' <span class="mm-badge mm-warn">Récurrente</span>' : '') +
          (a.action_prevue ? '<small class="mm-aide">Prévu : ' + esc(a.action_prevue) + (a.prestataire ? ' · ' + esc(a.prestataire) : '') + (a.devis_montant != null ? ' · devis ' + esc(C.fcfa(a.devis_montant)) : '') + '</small>' : '') +
          (a.verification_note ? '<small class="mm-aide">Vérification : ' + esc(a.verification_note) + '</small>' : ''),
        badge(a.gravite), esc(C.dateFr(a.constat_at)), esc(a.responsable_nom || '—'), esc(a.date_cible ? C.dateFr(a.date_cible) : '—') + (a.en_retard ? ' <span class="mm-badge mm-ko">En retard</span>' : ''),
        badge(a.statut), boutonsAction(a)]);
    }), 'Aucune anomalie enregistrée.');
  }
  function brancherActions(zone, m) {
    zone.addEventListener('click', function (e) {
      var b = e.target.closest('[data-action]'); if (!b) return;
      var d = b.dataset, f = ACTIONS[d.action] || (MNT && MNT.actions[d.action]) || (CARNET && CARNET.actions[d.action]); if (f) f(d, m);
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
      var types = S.classe === 'ZONE' ? ['RAPPORT_MECANICIEN', 'PHOTO', 'FACTURE'] : ['CARTE_GRISE', 'PLAQUE', 'ASSURANCE', 'PV_REMISE', 'RAPPORT_MECANICIEN', 'FACTURE', 'PHOTO', 'AUTRE'];
      modale('Déposer un document', '<div class="mm-grille-form">' + champ({ n: 'type_document', l: 'Type', t: 'select', req: true, o: types.map(function (t) { return [t, C.libelle(t)]; }) }) +
        champ({ n: 'numero_reference', l: 'Numéro / référence' }) + champ({ n: 'date_emission', l: 'Date d\'émission', t: 'date' }) + champ({ n: 'date_expiration', l: 'Date d\'expiration', t: 'date', aide: 'Assurance : obligatoire pour l\'alerte d\'expiration.' }) +
        champ({ n: 'fichier', l: 'Document numérisé', t: 'scan', req: true, aide: 'Recto et verso dans un seul PDF. Saisissez les champs ci-dessus en lisant le document : rien n\'est rempli automatiquement.' }) + '</div>' +
        '<p class="mm-note">Le procès-verbal de remise est signé sur papier puis numérisé ici. Le document sera vérifié par un autre responsable. Le permis de conduire se rattache désormais au conducteur : espace « Conducteurs ».</p>',
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
      var ref = m.origine === 'EN_EXPLOITATION', L = liste('INSPECTION_INITIALE'), cats = ['COMPTEUR', 'AVANT', 'ARRIERE', 'GAUCHE', 'DROITE', 'ANOMALIE'];
      var minRef = Number(S.params.photos_reference_min && S.params.photos_reference_min.valeur) || 5;
      modale(ref ? 'État technique de référence · ' + m.code : 'Inspection mécanique initiale · ' + m.code,
        (ref ? '<p class="mm-bandeau mm-info">Moto déjà en exploitation : cet état de référence, réalisé par un intervenant qualifié, ouvre le suivi fiable. Les anomalies constatées deviennent des actions correctives ; une anomalie critique immobilise la moto.</p>' : '') +
        '<div class="mm-grille-form">' + champ({ n: 'intervenant_nom', l: 'Mécanicien qualifié (inspecteur réel)', req: true }) + champ({ n: 'garage_nom', l: 'Garage désigné par ANAGROCI', req: true }) +
        champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true }) + champ({ n: 'inspecteur_externe', l: 'Saisie d\'un rapport externe : précisez', ph: 'Ex. rapport papier du garage saisi par le coordinateur' }) +
        champ({ n: 'avis_mecanicien', l: 'Avis du mécanicien', t: 'textarea' }) + champ({ n: 'observations', l: 'Anomalies existantes constatées', t: 'textarea' }) + '</div>' + itemsHtml(L, 'ins') +
        champsPhotos('ph_', cats, ref ? ['COMPTEUR'] : []) + (ref ? '<p class="mm-note">Inventaire photographique : au moins ' + minRef + ' photos dont le compteur.</p>' : '') +
        champ({ n: 'resultat', l: 'Conclusion', t: 'select', req: true, o: [['APTE', 'Apte'], ['INAPTE', 'Inapte : contrôle complémentaire au garage']] }) +
        '<p class="mm-note">L\'avis d\'un mécanicien n\'est pas un certificat réglementaire officiel. La gravité de chaque point est fixée par le serveur : une anomalie critique rend la moto inapte, quelle que soit la conclusion saisie.</p>',
      async function (v, form) {
        var items = lireItems(form, L, 'ins');
        var photos = await deposerPhotos(m.id, v, 'ph_', cats);
        return rpc('moto_inspection_initiale', { p: { moto_id: m.id, items: items, resultat: v.resultat, intervenant_nom: v.intervenant_nom, garage_nom: v.garage_nom, compteur_km: v.compteur_km,
          avis_mecanicien: v.avis_mecanicien, observations: v.observations, inspecteur_externe: v.inspecteur_externe, photos: photos } })
          .then(function (r) { apres(m.id)(); return r.anomalie_critique ? 'Anomalie critique : moto immobilisée.' : (r.etat_reference ? 'État de référence enregistré : ' : 'Inspection enregistrée : ') + C.libelle(r.resultat) + '.'; });
      });
    },
    receptionner: function (d, m) {
      modale('Réception physique · ' + m.code, '<div class="mm-grille-form">' + [{ n: 'date_reception', l: 'Date de réception effective', t: 'date', req: true, max: aujourdhui() },
        { n: 'compteur_km', l: 'Kilométrage à la réception', t: 'nombre', req: true }, { n: 'marque', l: 'Marque', req: true, v: m.marque }, { n: 'modele', l: 'Modèle', req: true, v: m.modele },
        { n: 'couleur', l: 'Couleur', v: m.couleur }, { n: 'fournisseur', l: 'Fournisseur', v: m.fournisseur },
        { n: 'numero_chassis', l: 'N° de châssis', aide: 'Recopié du document réel uniquement ; sinon laisser vide.' }, { n: 'immatriculation', l: 'Immatriculation', aide: 'Vide tant que la plaque n\'est pas reçue.' }].map(champ).join('') + '</div>' +
        champPhoto('photo', 'Photo principale', false) + champsDocsMoto(), async function (v) {
        var photo = v.photo; delete v.photo; v.moto_id = m.id;
        var docs = extraireDocsMoto(v);
        await rpc('moto_receptionner', { p: v });
        var msg = 'Réception enregistrée. Prochaine étape : ' + (docs.length ? 'vérification des documents' : 'documents') + ' puis inspection mécanique initiale.';
        if (docs.length) msg += await enregistrerDocsMoto(m.id, docs);
        if (photo) { try { var f = await deposer(m.id, 'photo', photo); await rpc('moto_photo_ajouter', { p: { moto_id: m.id, path: f.chemin, principale: true } }); } catch (e) { msg += ' Photo non enregistrée : ' + messageErreur(e); } }
        apres(m.id)(); return msg;
      }, 'Enregistrer la réception');
    },
    photo: function (d, m) {
      var principale = peut('photo_principale') && d.galerie !== '1';
      modale(principale ? 'Photo principale · ' + m.code : 'Ajouter une photo · ' + m.code, champPhoto('photo', 'Photo', true) +
        (principale ? '' : champ({ n: 'categorie', l: 'Vue', t: 'select', req: true, o: ['AVANT', 'ARRIERE', 'GAUCHE', 'DROITE', 'COMPTEUR', 'ANOMALIE', 'DOCUMENT', 'AUTRE'].map(function (c) { return [c, libPhoto(c)]; }) })) +
        champ({ n: 'legende', l: 'Légende' }) + (peut('photo_principale') && !principale ? champ({ n: 'principale', l: 'Utiliser comme photo principale', t: 'checkbox' }) : ''),
      async function (v) {
        var f = await deposer(m.id, 'photo', v.photo);
        await rpc('moto_photo_ajouter', { p: { moto_id: m.id, path: f.chemin, principale: principale || !!v.principale, categorie: v.categorie, legende: v.legende } });
        apres(m.id, principale ? 'synthese' : 'photos')(); return 'Photo enregistrée (stockage privé).';
      });
    },
    etat_remise: async function (d, m) {
      var L = liste('ETAT_REMISE'), req = (S.params.photos_etat_remise_categories && S.params.photos_etat_remise_categories.valeur_json) || ['AVANT', 'ARRIERE', 'GAUCHE', 'DROITE', 'COMPTEUR'];
      var eq = (S.params.equipements_obligatoires && S.params.equipements_obligatoires.valeur_json) || [];
      modale('État contradictoire avant remise · ' + m.code, '<p class="mm-bandeau mm-info">Distinct de l\'inspection mécanique. Le bénéficiaire (' + esc(m.beneficiaire_nom || 'préaffecté') + ') devra l\'accepter depuis son propre compte avant la remise. Le PV papier signé reste obligatoire.</p>' +
        '<div class="mm-grille-form">' + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true }) + champ({ n: 'date_remise_prevue', l: 'Date réelle de remise', t: 'date', req: true, v: aujourdhui() }) + '</div>' +
        itemsHtml(L, 'er') + '<fieldset class="mm-champ mm-large"><legend>Équipements et accessoires remis</legend>' + eq.concat(['CLES', 'TROUSSE_OUTILS']).map(function (k) { return '<label class="mm-case"><input type="checkbox" name="eq_' + esc(k) + '"> ' + esc(k.replace(/_/g, ' ').toLowerCase()) + '</label>'; }).join('') + '</fieldset>' +
        '<fieldset class="mm-champ mm-large"><legend>Documents disponibles remis (copies)</legend>' + ['CARTE_GRISE', 'ASSURANCE', 'PLAQUE'].map(function (k) { return '<label class="mm-case"><input type="checkbox" name="doc_' + k + '"> ' + esc(C.libelle(k)) + '</label>'; }).join('') + '</fieldset>' +
        champsPhotos('ph_', ['AVANT', 'ARRIERE', 'GAUCHE', 'DROITE', 'COMPTEUR', 'ANOMALIE'], req) + champ({ n: 'observations', l: 'Dégradations ou réserves constatées', t: 'textarea' }),
      async function (v, form) {
        var equip = {}; eq.concat(['CLES', 'TROUSSE_OUTILS']).forEach(function (k) { equip[k] = !!v['eq_' + k]; });
        var docs = ['CARTE_GRISE', 'ASSURANCE', 'PLAQUE'].filter(function (k) { return v['doc_' + k]; });
        var photos = await deposerPhotos(m.id, v, 'ph_', ['AVANT', 'ARRIERE', 'GAUCHE', 'DROITE', 'COMPTEUR', 'ANOMALIE']);
        var r = await rpc('moto_etat_remise_enregistrer', { p: { moto_id: m.id, items: lireItems(form, L, 'er'), compteur_km: v.compteur_km, date_remise_prevue: v.date_remise_prevue,
          equipements: equip, documents_presents: docs, observations: v.observations, photos: photos } });
        apres(m.id, 'controles')(); return r.anomalie_critique ? 'Anomalie critique : moto immobilisée, remise impossible.' : 'État enregistré : en attente d\'acceptation par le bénéficiaire.';
      }, 'Enregistrer l\'état');
    },
    inspection_mensuelle: async function (d, m) {
      var L = liste('INSPECTION_MENSUELLE'), immob = ['IMMOBILISEE', 'EN_REPARATION'].indexOf(m.statut_technique) >= 0;
      var hist = await lireTable('moto_controles', function (q) { return q.eq('moto_id', m.id).eq('type_controle', 'INSPECTION_MENSUELLE').is('remplace_par', null).order('date_controle', { ascending: false }).limit(4); }).catch(function () { return []; });
      var ouvertes = await lireTable('moto_v_actions', function (q) { return q.eq('moto_id', m.id).neq('statut', 'CLOTUREE'); }).catch(function () { return []; });
      ouvertes = ouvertes.filter(function (a) { return a.statut !== 'ANNULEE'; });
      var dernier = hist[0], niv = d.niveau || (S.classe === 'ZONE' ? 'ZONE' : S.classe === 'LOGISTIQUE' ? 'COORDINATION' : 'INDEPENDANTE');
      var fen = C.fenetreInspection(niv, new Date(), { zone_fin: S.params.inspection_zone_jour_fin && S.params.inspection_zone_jour_fin.valeur, coordination_debut: S.params.inspection_coordination_jour_debut && S.params.inspection_coordination_jour_debut.valeur });
      var comparaison = hist.length ? '<section class="mm-bloc"><h3>Comparaison avec les inspections précédentes</h3>' + tableau(['Point'].concat(hist.map(function (h) { return C.dateFr(h.date_controle) + ' · ' + C.libelleNiveau(h.niveau); })), L.map(function (it) {
        return [esc(it.libelle)].concat(hist.map(function (h) { var x = (h.items || []).filter(function (i) { return i.code === it.code; })[0]; return x ? (x.ok ? '✓' : '<b class="mm-critique">✗ défaut</b>') : '—'; }));
      })) + '<p class="mm-note">Photos précédentes : onglet Photos du passeport.</p></section>' : '<p class="mm-note">Première inspection mensuelle de cette moto.</p>';
      modale(C.libelleNiveau(niv) + ' · inspection mensuelle · ' + m.code, '<p class="mm-bandeau mm-info">Fenêtre : du ' + esc(C.dateFr(fen.debut)) + ' au ' + esc(C.dateFr(fen.fin)) + '. Le résultat est calculé par le serveur : une visite effectuée ne vaut pas conformité.</p>' +
        (ouvertes.length ? '<div class="mm-bandeau mm-warn"><b>' + ouvertes.length + ' anomalie(s) encore ouverte(s) :</b> ' + esc(ouvertes.map(function (a) { return a.anomalie; }).join(' ; ')) + '. Elles restent ouvertes jusqu\'à vérification.</div>' : '') +
        comparaison + (immob ? champ({ n: 'non_evaluable', l: 'Moto immobilisée ou au garage : contrôle non évaluable (motif en observation)', t: 'checkbox' }) : '') +
        '<div class="mm-grille-form">' + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', aide: 'Dernier relevé : ' + C.km(m.compteur_actuel_km) }) + '</div>' + itemsHtml(L, 'im') +
        champsPhotos('ph_', ['COMPTEUR', 'AVANT', 'ARRIERE', 'GAUCHE', 'DROITE', 'ANOMALIE'], ['COMPTEUR']) +
        champ({ n: 'besoins_entretien', l: 'Nouveaux besoins d\'entretien', t: 'textarea' }) + champ({ n: 'observations', l: 'Observations', t: 'textarea' }) +
        (niv === 'INDEPENDANTE' ? champ({ n: 'intervenant_nom', l: 'Inspecteur réel (si rapport d\'un mécanicien externe)' }) + champ({ n: 'inspecteur_externe', l: 'Précision sur la preuve conservée' }) : ''),
      async function (v, form) {
        var ne = !!v.non_evaluable, items = ne ? [] : lireItems(form, L, 'im');
        if (!ne && items.some(function (i) { return i.ok === null; })) throw new Error('Renseignez chaque point (conforme ou défaut).');
        if (!ne && v.compteur_km == null) throw new Error('Relevé du compteur obligatoire.');
        var payload = { moto_id: m.id, niveau: niv, compteur_km: v.compteur_km, items: ne ? undefined : items, non_evaluable: ne, observations: v.observations, besoins_entretien: v.besoins_entretien,
                        intervenant_nom: v.intervenant_nom, inspecteur_externe: v.inspecteur_externe, date_controle: new Date().toISOString(), photos: [] };
        var fichiers = await fichiersPhotos(m.id, v, 'ph_', ['COMPTEUR', 'AVANT', 'ARRIERE', 'GAUCHE', 'DROITE', 'ANOMALIE']);
        var msg = await mettreEnFile('INSPECTION_MENSUELLE', payload, 'Inspection mensuelle ' + m.code, fichiers);
        if (routeActive().espace === 'moto') apres(m.id, 'controles')(); else router();
        return (C.anomalieCritique(items) ? 'Anomalie critique : moto immobilisée. ' : '') + msg;
      }, 'Enregistrer l\'inspection');
    },
    signaler: function (d, m) {
      modale('Signaler une anomalie · ' + m.code, champ({ n: 'gravite', l: 'Gravité', t: 'select', req: true, o: [['MINEURE', 'Mineure'], ['MAJEURE', 'Majeure'], ['CRITIQUE', 'Critique : élément de sécurité, arrêt immédiat']] }) +
        champ({ n: 'anomalie', l: 'Anomalie constatée', t: 'textarea', req: true, min: 5 }) + champPhoto('photo', 'Photo', false),
      async function (v) {
        var fichiers = v.photo ? [await compresser(v.photo).then(function (b) { return { champ: 'photo_path', blob: b, moto_id: m.id, categorie: 'photo', extension: extension(b, v.photo.name) }; })] : [];
        var msg = await mettreEnFile('ACTION_SIGNALER', { moto_id: m.id, gravite: v.gravite, anomalie: v.anomalie }, 'Anomalie ' + m.code, fichiers);
        if (routeActive().espace === 'moto') apres(m.id, 'anomalies')(); else router();
        return (v.gravite === 'CRITIQUE' ? 'Moto immobilisée : ne pas circuler. ' : '') + msg;
      }, 'Signaler');
    },
    action_planifier: async function (d) {
      var b = await beneficiaires().catch(function () { return []; });
      modale('Planifier l\'action corrective', '<div class="mm-grille-form">' + champ({ n: 'action_prevue', l: 'Action prévue', t: 'textarea', req: true, min: 5 }) +
        champ({ n: 'responsable_id', l: 'Responsable du suivi', t: 'select', o: [[S.profil.user_id, 'Moi-même']].concat(b.filter(function (x) { return x.user_id !== S.profil.user_id; }).map(function (x) { return [x.user_id, x.nom + ' · ' + x.role]; })) }) +
        champ({ n: 'prestataire', l: 'Garage ou prestataire' }) + champ({ n: 'devis_montant', l: 'Devis (FCFA)', t: 'nombre', pas: 1 }) + champ({ n: 'date_cible', l: 'Date cible de résolution', t: 'date', req: true }) +
        champ({ n: 'devis', l: 'Devis numérisé', t: 'fichier', large: true }) + '</div><p class="mm-note">Une dépense à autoriser passe par la demande d\'entretien (décision par un autre responsable) ou par l\'enveloppe d\'entretien.</p>',
      async function (v) {
        if (v.devis) { var f = await deposer(d.moto, 'maintenance', v.devis); v.devis_path = f.chemin; } delete v.devis;
        v.action_id = d.aid; await rpc('moto_action_planifier', { p: v }); router(); return 'Action planifiée.';
      });
    },
    action_realiser: function (d) {
      modale('Réalisation de l\'action', '<div class="mm-grille-form">' + champ({ n: 'realise_at', l: 'Date réelle de réalisation', t: 'date', req: true, v: aujourdhui(), max: aujourdhui() }) +
        champ({ n: 'justificatif', l: 'Photo ou constat', t: 'fichier', large: true, capture: true }) + '</div>' +
        '<p class="mm-note">Aucun montant ici : une réparation payante passe par un dossier de maintenance autorisé par le Branch Manager (espace Maintenance), et son coût est celui de la facture. Une autre personne vérifiera la réparation avant clôture.</p>',
      async function (v) {
        if (v.justificatif) { var f = await deposer(d.moto, 'maintenance', v.justificatif); v.justificatif_path = f.chemin; } delete v.justificatif;
        v.action_id = d.aid; await rpc('moto_action_realiser', { p: v }); router(); return 'Réalisation enregistrée : vérification attendue.';
      });
    },
    action_verifier: function (d) {
      modale('Vérification après réparation', champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['VALIDEE', 'Correction constatée : clôturer'], ['REJETEE', 'Non corrigé : renvoyer en planification']] }) +
        champ({ n: 'note', l: 'Constat de vérification', t: 'textarea', req: true, min: 5 }) + '<p class="mm-note">La clôture ne lève pas une immobilisation : la remise en service suit son propre circuit.</p>',
      function (v) { return rpc('moto_action_verifier', { p_action: d.aid, p_decision: v.decision, p_note: v.note }).then(function (r) { router(); return 'Action ' + C.libelle(r.statut).toLowerCase() + '.'; }); });
    },
    remettre: async function (d, m) {
      var docs = await lireTable('moto_documents', function (q) { return q.eq('moto_id', m.id).eq('type_document', 'PV_REMISE').eq('statut', 'CONFORME'); });
      var eq = (S.params.equipements_obligatoires && S.params.equipements_obligatoires.valeur_json) || [];
      modale('Remise officielle de ' + m.code, '<div class="mm-grille-form">' +
        champ({ n: 'pv_document_id', l: 'Procès-verbal signé, numérisé et vérifié', t: 'select', req: true, large: true, o: docs.map(function (x) { return [x.id, 'PV du ' + C.dateFr(x.depose_at) + (x.numero_reference ? ' · ' + x.numero_reference : '')]; }),
               aide: docs.length ? '' : 'Aucun PV vérifié : déposez le PV numérisé (onglet Documents) et faites-le vérifier par un autre responsable.' }) +
        champ({ n: 'compteur_km', l: 'Compteur à la remise', t: 'nombre', req: true }) + '</div>' + (PERMIS ? await PERMIS.infoRemise(m.beneficiaire_id) : '') +
        '<fieldset class="mm-champ mm-large"><legend>Équipements de sécurité remis</legend>' + eq.map(function (k) { return '<label class="mm-case"><input type="checkbox" name="eq_' + esc(k) + '"> ' + esc(k.replace(/_/g, ' ').toLowerCase()) + '</label>'; }).join('') + '</fieldset>',
      function (v) {
        var equip = {}; eq.forEach(function (k) { equip[k] = !!v['eq_' + k]; });
        return rpc('moto_remettre', { p: { moto_id: m.id, pv_document_id: v.pv_document_id, compteur_km: v.compteur_km, equipements: equip } }).then(function (r) { apres(m.id)(); return r.note; });
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
        champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true }) + '</div><div data-info-permis>' + (PERMIS ? await PERMIS.infoRemise(null) : '') + '</div><fieldset class="mm-champ mm-large"><legend>Équipements</legend>' +
        eq.map(function (k) { return '<label class="mm-case"><input type="checkbox" name="eq_' + esc(k) + '"> ' + esc(k.replace(/_/g, ' ').toLowerCase()) + '</label>'; }).join('') + '</fieldset>' + champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 5 }),
      function (v) { var equip = {}; eq.forEach(function (k) { equip[k] = !!v['eq_' + k]; }); v.equipements = equip; v.moto_id = m.id; return rpc('moto_transferer', { p: v }).then(apres(m.id)); }, 'Transférer');
      var dlg = $$('dialog.mm-modale').pop(), sel = dlg && $('select[name="beneficiaire_id"]', dlg);
      if (sel && PERMIS) sel.addEventListener('change', async function () { $('[data-info-permis]', dlg).innerHTML = await PERMIS.infoRemise(sel.value || null); });
    },
    retirer: function (d, m) {
      modale('Retirer l\'affectation de ' + m.code, '<p class="mm-bandeau mm-warn">La moto redevient non affectée et perd son autorisation de circulation.</p>' + champ({ n: 'motif', l: 'Motif (10 caractères minimum)', t: 'textarea', req: true, min: 10 }),
        function (v) { return rpc('moto_retirer', { p_moto: m.id, p_motif: v.motif }).then(apres(m.id)); }, 'Retirer');
    },
    verifier_justificatif: function (d, m) {
      modale('Vérifier le justificatif', champ({ n: 'statut', l: 'Décision', t: 'select', req: true, o: [['VERIFIE', 'Vérifié : reçu lisible et cohérent'], ['REJETE', 'Rejeté']] }) + champ({ n: 'motif', l: 'Motif (obligatoire si rejet)', t: 'textarea' }),
        function (v) { return rpc('moto_justificatif_verifier', { p_carburant: d.id, p_statut: v.statut, p_motif: v.motif }).then(function () { if (m) apres(m.id, 'carburant')(); else router(); }); });
    },
    controle_remise: function (d, m) {
      var L = liste('REMISE_EN_SERVICE');
      modale('Contrôle de remise en service', champ({ n: 'intervenant_nom', l: 'Intervenant', req: true }) + champ({ n: 'garage_nom', l: 'Garage' }) + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre' }) +
        itemsHtml(L, 'rs') + champ({ n: 'avis_mecanicien', l: 'Avis', t: 'textarea' }),
      function (v, form) { v.items = lireItems(form, L, 'rs'); v.moto_id = m.id; return rpc('moto_controle_remise_en_service', { p: v }).then(function (r) { apres(m.id, 'controles')(); return 'Contrôle enregistré : ' + C.libelle(r.resultat) + '.'; }); });
    },
    incident_avancer: function (d, m) {
      var suite = { SIGNALE: ['IMMOBILISEE', 'DIAGNOSTIC'].concat(d.gravite !== 'CRITIQUE' ? ['CLOS'] : []), IMMOBILISEE: ['DIAGNOSTIC'], DIAGNOSTIC: ['AUTORISATION_DEPENSE', 'REPARATION', 'CONTROLE'].concat(d.gravite !== 'CRITIQUE' ? ['CLOS'] : []),
                    AUTORISATION_DEPENSE: ['REPARATION'], REPARATION: ['CONTROLE'], CONTROLE: ['REMIS_EN_SERVICE'], REMIS_EN_SERVICE: ['CLOS'] }[d.etape] || [];
      modale('Incident : étape suivante', '<p>Étape actuelle : ' + badge(d.etape) + '</p>' + champ({ n: 'etape', l: 'Nouvelle étape', t: 'select', req: true, o: suite.map(function (s) { return [s, C.libelle(s)]; }) }) +
        champ({ n: 'note', l: 'Note', t: 'textarea', req: true, min: 5 }) +
        '<p class="mm-note">Aucun montant ne se saisit ici : le coût passe par un dossier de maintenance lié à l\'incident, autorisé par le Branch Manager (« Dépense autorisée » constate cette autorisation). La remise en service exige un contrôle APTE et des travaux contrôlés conformes.</p>',
      function (v) { return rpc('moto_incident_avancer', { p_incident: d.id, p_etape: v.etape, p_note: v.note, p_cout: null }).then(apres(m.id, 'incidents')); });
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
    pneu_reparer: async function (d, m) {
      var fac = await optFacturesVerifiees(m.id);
      modale('Réparation de pneu', champ({ n: 'description', l: 'Description', req: true }) + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre' }) + champ({ n: 'date_reparation', l: 'Date', t: 'date', v: aujourdhui() }) +
        (fac.length ? champ({ n: 'facture_id', l: 'Facture vérifiée (si payante)', t: 'select', o: fac }) + champ({ n: 'cout', l: 'Part de la facture (FCFA)', t: 'nombre', pas: 1 }) : '') +
        '<p class="mm-note">Une réparation payante doit d\'abord être autorisée par le Branch Manager (dossier de maintenance) ; son coût est une part de la facture vérifiée, jamais un montant de plus.</p>',
        function (v) { v.pneu_id = d.pneu; v.moto_id = m.id; v.cout = C.nombreSaisi(v.cout); return rpc('moto_pneu_reparation', { p: v }).then(apres(m.id, 'pneus')); });
    }
  };

  async function optFacturesVerifiees(motoId) {
    if (!peut('maintenance_finances')) return [];
    var f = await lireTable('moto_factures', function (q) { var x = q.eq('statut', 'VERIFIEE').order('date_facture', { ascending: false }); return motoId ? x.eq('moto_id', motoId) : x; }).catch(function () { return []; });
    return f.map(function (x) { return [x.id, codeMoto(x.moto_id) + ' · ' + x.numero_facture + ' · ' + C.fcfa(x.montant)]; });
  }
  /* -- B. OPÉRATIONS -------------------------------------------------------- */
  async function vueOperations() {
    try { await chargerFlotte(); } catch (e) { /* le cache est déjà tenté dans chargerFlotte */ }
    var liste = mesMotos().filter(function (m) { return S.classe !== 'UNITE' || m.mise_en_service_at; });
    var choix = sessionStorageLire('moto_choisie');
    var m = motoParId(choix) && liste.some(function (x) { return x.id === choix; }) ? motoParId(choix) : liste[0];
    var immo = m ? await OFF.immobilisationLocale(m.id) : null;
    var dot = await mesDotations();
    var etats = await rpc('moto_mes_etats_a_confirmer').catch(function () { return []; });
    var blocMission = MISSION && m ? await MISSION.blocOperations(m).catch(function () { return ''; }) : '';
    var aInspecter = [];
    if (S.classe === 'ZONE') {
      var maZone = String(S.profil.zone || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, '_');
      aInspecter = (await lireTable('moto_v_inspections_exigibles', function (q) { return q.eq('niveau', 'ZONE').eq('periode', aujourdhui().slice(0, 8) + '01'); }).catch(function () { return []; }))
        .filter(function (x) { return !maZone || x.zone_code === maZone; });
    }
    vue().innerHTML = '<div class="mm-entete"><div><h1>Opérations</h1><p>Saisies terrain : elles fonctionnent sans réseau et partent automatiquement au retour de la connexion.</p></div></div>' + bandeauHorsLigne() +
      (liste.length ? '<div class="mm-champ mm-large"><label for="opMoto">Moto</label><select id="opMoto">' + liste.map(function (x) { return '<option value="' + esc(x.id) + '"' + (m && x.id === m.id ? ' selected' : '') + '>' + esc(x.code + ' · ' + (x.immatriculation || 'immatriculation en attente')) + '</option>'; }).join('') + '</select></div>' : '') +
      (m ? (immo || !m.autorisee_a_circuler ? '<div class="mm-bandeau mm-ko" role="alert"><b>Ne pas circuler.</b> ' + (immo ? 'Immobilisation de sécurité enregistrée sur cet appareil le ' + esc(C.dateHeureFr(immo.depuis)) + '.' : 'Moto non autorisée à circuler (' + esc(C.libelle(m.statut_technique)) + ').') + '</div>' : '') +
        blocMission + '<div class="mm-tuiles">' +
        tuile('controle', 'Contrôle avant départ', 'Freins, pneus, direction, équipements', (immo || ['IMMOBILISEE', 'EN_REPARATION'].indexOf(m.statut_technique) >= 0) ? 'Moto immobilisée : un responsable doit d\'abord la remettre en service.' : null) +
        tuile('releve', 'Relevé kilométrique', 'Compteur du jour') + tuile('carburant', 'Achat de carburant', 'Litres, montant, plein, photo du reçu') +
        tuile('incident', 'Déclarer un incident', 'Panne, accident, crevaison, anomalie', null, 'mm-tuile-alerte') + tuile('entretien', 'Demande d\'entretien', 'Vidange, réparation, révision') +
        tuile('anomalie', 'Signaler une anomalie', 'Avec photo ; suivie jusqu\'à correction vérifiée') + '</div>'
        : '<div class="mm-vide"><b>Aucune moto en service pour vous.</b><p>Les saisies terrain s\'ouvrent après la remise officielle et l\'autorisation de circulation.</p></div>') +
      (dot.length ? '<section class="mm-bloc"><h2>Mes dotations à confirmer</h2>' + tableau(['Remise le', 'Mode', 'Montant remis', 'Frais', 'Référence', 'Action'], dot.map(function (x) {
        return [esc(C.dateFr(x.remis_at)), esc(C.libelle(x.mode_paiement)), esc(C.fcfa(x.montant_remis)), esc(C.fcfa(x.frais_transaction)), esc(x.reference || '—'), '<button type="button" class="mm-btn mm-primaire mm-petit" data-confirmer="' + esc(x.id) + '" data-montant="' + esc(x.montant_remis) + '">Confirmer la réception</button>'];
      })) + '<p class="mm-note">Confirmez le montant réellement reçu. Une transaction échouée ou non reçue ne vaut pas dotation : déclarez « non reçu ».</p></section>' : '') +
      (etats.length ? '<section class="mm-bloc mm-bloc-alerte"><h2>État de remise à confirmer</h2>' + tableau(['Moto', 'Établi le', 'Compteur', 'Réserves', 'Action'], etats.map(function (x) {
        return [esc(codeMoto(x.moto_id)), esc(C.dateHeureFr(x.date_controle)), esc(C.km(x.compteur_km)), esc(x.observations || 'Aucune') + ' · ' + esc((x.items || []).filter(function (i) { return !i.ok; }).map(function (i) { return i.libelle; }).join(', ') || 'aucun défaut'),
          '<button type="button" class="mm-btn mm-primaire mm-petit" data-etat="' + esc(x.id) + '" data-moto="' + esc(x.moto_id) + '">Examiner et répondre</button>'];
      })) + '<p class="mm-note">Vérifiez la moto et les photos avec la personne qui vous la remet. Votre réponse est enregistrée à votre nom.</p></section>' : '') +
      (S.classe === 'ZONE' ? '<section class="mm-bloc"><h2>Mes inspections du mois (du 1er au ' + esc((S.params.inspection_zone_jour_fin && S.params.inspection_zone_jour_fin.valeur) || 15) + ')</h2>' +
        tableau(['Moto', 'Chef d\'unité', 'Échéance', 'Statut', 'Action'], aInspecter.map(function (x) {
          return [esc(x.code), esc(x.beneficiaire_nom || '—'), esc(C.dateFr(x.fenetre_fin)), badge(x.statut) + (x.conformite ? ' ' + badge(x.conformite) : ''),
            x.inspection_id ? '' : '<button type="button" class="mm-btn mm-primaire mm-petit" data-inspecter="' + esc(x.moto_id) + '">Inspecter</button>'];
        }), 'Aucune inspection exigible ce mois dans votre zone (motos mises en service après le 1er : aucune inspection rétroactive).') +
        '<p class="mm-note">Utilisez votre visite terrain habituelle. Une inspection après le ' + esc((S.params.inspection_zone_jour_fin && S.params.inspection_zone_jour_fin.valeur) || 15) + ' est enregistrée comme tardive.</p></section>' : '') +
      '<section class="mm-bloc"><h2>Synchronisation</h2><div id="opFile"></div></section>';
    var sel = $('#opMoto'); if (sel) sel.onchange = function () { sessionStorageEcrire('moto_choisie', sel.value); vueOperations(); };
    $$('[data-tuile]').forEach(function (b) { b.onclick = function () { FORMULAIRES_TERRAIN[b.dataset.tuile](m); }; });
    $$('[data-confirmer]').forEach(function (b) { b.onclick = function () { confirmerDotation(b.dataset.confirmer, b.dataset.montant); }; });
    $$('[data-etat]').forEach(function (b) { b.onclick = function () { confirmerEtat(etats.filter(function (x) { return x.id === b.dataset.etat; })[0]); }; });
    $$('[data-inspecter]').forEach(function (b) { b.onclick = function () { var mm = motoParId(b.dataset.inspecter); if (mm) ACTIONS.inspection_mensuelle({ niveau: 'ZONE' }, mm); }; });
    if (MISSION && m) MISSION.brancherOperations(vue(), m, vueOperations);
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
      var L = liste('AVANT_DEPART');
      modale('Contrôle avant départ · ' + m.code, champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre', req: true }) + itemsHtml(L, 'dep') +
        '<p class="mm-note">Un point critique en défaut immobilise la moto immédiatement sur ce téléphone, même sans réseau.</p>',
      async function (v, form) {
        var items = lireItems(form, L, 'dep');
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
    anomalie: function (m) { ACTIONS.signaler({}, m); },
    entretien: function (m) {
      modale('Demande d\'entretien · ' + m.code, champ({ n: 'type_maintenance', l: 'Type', t: 'select', req: true, o: ['VIDANGE', 'ENTRETIEN_PREVENTIF', 'REVISION', 'REPARATION', 'PANNE'].map(function (t) { return [t, C.libelle(t)]; }) }) +
        champ({ n: 'description', l: 'Description', t: 'textarea', req: true, min: 5 }) + champ({ n: 'compteur_km', l: 'Compteur', t: 'nombre' }) + champ({ n: 'cout_estime', l: 'Coût estimé (FCFA)', t: 'nombre' }),
        async function (v) { v.moto_id = m.id; var msg = await mettreEnFile('MAINTENANCE_DEMANDE', v, 'Entretien ' + m.code); apresTerrain(); return msg; }, 'Demander');
    }
  };
  async function confirmerEtat(x) {
    if (!x) return;
    var ph = await lireTable('moto_photos', function (q) { return q.eq('controle_id', x.id); }).catch(function () { return []; });
    var d = modale('État contradictoire · ' + codeMoto(x.moto_id), '<div class="mm-galerie">' + ph.map(function (p) { return '<figure>' + imgPhoto(p.storage_path, 'mm-photo mm-photo-galerie', libPhoto(p.categorie)) + '<figcaption>' + esc(libPhoto(p.categorie)) + '</figcaption></figure>'; }).join('') + '</div>' +
      tableau(['Point', 'Constat'], (x.items || []).map(function (i) { return [esc(i.libelle), i.ok ? '✓ Conforme' : '<b class="mm-critique">Défaut</b>']; })) +
      '<p>Compteur : <b>' + esc(C.km(x.compteur_km)) + '</b> · Remise prévue le ' + esc(C.dateFr(x.date_remise_prevue)) + '</p>' + (x.observations ? '<p class="mm-note">Réserves de l\'agent : ' + esc(x.observations) + '</p>' : '') +
      champ({ n: 'decision', l: 'Ma réponse', t: 'select', req: true, o: [['ACCEPTEE', 'J\'accepte cet état'], ['ACCEPTEE_AVEC_RESERVES', 'J\'accepte avec réserves'], ['CONTESTEE', 'Je conteste cet état']] }) +
      champ({ n: 'commentaire', l: 'Commentaire (obligatoire pour réserves ou contestation)', t: 'textarea' }),
    function (v) { return rpc('moto_etat_remise_confirmer', { p_controle: x.id, p_decision: v.decision, p_commentaire: v.commentaire }).then(function (r) { vueOperations(); return 'Réponse enregistrée : ' + C.libelle(r.confirmation_statut) + '.'; }); }, 'Envoyer ma réponse');
    chargerPhotos(d);
  }
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

  /* -- C bis. COORDINATION LOGISTIQUE (pilote opérationnel du parc) ----------- */
  function paramsFenetres() { return { zone_fin: S.params.inspection_zone_jour_fin && S.params.inspection_zone_jour_fin.valeur, coordination_debut: S.params.inspection_coordination_jour_debut && S.params.inspection_coordination_jour_debut.valeur }; }
  async function donneesCoordination() {
    var q = function (t, f) { return lireTable(t, f).catch(function () { return []; }); };
    var debut12 = new Date(); debut12.setUTCMonth(debut12.getUTCMonth() - 2);
    var r = await Promise.all([q('moto_v_inspections_exigibles', function (x) { return x.order('periode', { ascending: false }); }),
      q('moto_v_actions', function (x) { return x.order('constat_at', { ascending: false }).limit(500); }),
      q('moto_v_enveloppes', function (x) { return x.order('periode', { ascending: false }).limit(24); }),
      q('moto_depenses', function (x) { return x.order('date_depense', { ascending: false }).limit(200); }),
      q('moto_v_disponibilite'), q('moto_v_echeances'), q('moto_v_couts'), q('moto_v_conso_intervalles', function (x) { return x.neq('statut_alerte', 'NORMAL'); }),
      q('moto_v_pneus'), q('moto_v_maintenance_dossiers')]);
    return { exigibles: r[0], actions: r[1], enveloppes: r[2], depenses: r[3], dispo: r[4], echeances: r[5], couts: r[6], conso: r[7], pneus: r[8], maintenances: r[9] };
  }
  async function vueCoordination() {
    await chargerFlotte();
    var D = await donneesCoordination(), mois = aujourdhui().slice(0, 8) + '01', mine = S.profil.user_id;
    var phase = C.phaseDuMois(new Date(), paramsFenetres());
    var flotte = S.flotte, prevues = flotte.filter(function (m) { return m.situation_parc === 'PREVUE'; });
    var actives = flotte.filter(function (m) { return m.mise_en_service_at; });
    var ceMois = D.exigibles.filter(function (x) { return x.periode === mois; });
    var cv = C.couvertureInspections(D.exigibles.filter(function (x) { return x.periode < mois || x.statut !== 'PROGRAMMEE'; }));
    var ouvertes = D.actions.filter(function (a) { return ['OUVERTE', 'PLANIFIEE', 'REALISEE'].indexOf(a.statut) >= 0; });
    var res = C.resolutionActions(D.actions, aujourdhui());
    var jp = D.dispo.reduce(function (t, x) { return t + Number(x.jours_prevus || 0); }, 0), ji = D.dispo.reduce(function (t, x) { return t + Number(x.jours_indisponibles || 0); }, 0);
    var env = D.enveloppes.filter(function (e) { return e.periode === mois; });
    var priorites = ouvertes.slice().sort(function (a, b) { return (a.gravite === 'CRITIQUE' ? 0 : 1) - (b.gravite === 'CRITIQUE' ? 0 : 1) || String(a.date_cible || '9').localeCompare(String(b.date_cible || '9')); });
    ceMois.filter(function (x) { return x.statut === 'PROGRAMMEE' || x.statut === 'NON_EFFECTUEE'; }).forEach(function (x) {
      priorites.push({ anomalie: 'Inspection ' + C.libelleNiveau(x.niveau).toLowerCase() + ' à réaliser', moto_code: x.code, moto_id: x.moto_id, responsable_nom: C.libelleNiveau(x.niveau), date_cible: x.fenetre_fin, statut: x.statut, _insp: x });
    });
    var peutInspecter = function (x) {
      if (x.inspection_id || x.beneficiaire_id === mine) return false;
      if (x.niveau === 'COORDINATION') return S.classe === 'LOGISTIQUE';
      if (x.niveau === 'INDEPENDANTE') return peut('inspection_independante');
      return S.classe === 'ZONE';
    };
    vue().innerHTML = '<div class="mm-entete"><div><h1>Coordination logistique</h1><p>Ce qui demande votre intervention, en premier.</p></div>' +
      (peut('exports') ? '<button type="button" class="mm-btn mm-primaire" id="coExport">Rapport mensuel (Excel)</button>' : '') + '</div>' + bandeauHorsLigne() +
      '<div class="mm-calendrier" role="list" aria-label="Calendrier mensuel des inspections">' + [['ZONE', '1 – ' + (paramsFenetres().zone_fin || 15), 'Chefs de zone : une inspection par moto de Chef d\'unité'],
        ['PREPARATION', ((paramsFenetres().zone_fin || 15) + 1) + ' – ' + ((paramsFenetres().coordination_debut || 20) - 1), 'Coordinateur : analyse, priorisation, programmation des tournées et du garage'],
        ['COORDINATION', (paramsFenetres().coordination_debut || 20) + ' – fin', 'Coordinateur : inspection de toutes les motos actives (sa moto : contrôle indépendant)']].map(function (p) {
        return '<div role="listitem" class="mm-phase' + (p[0] === phase.code ? ' mm-phase-active' : '') + '"><b>' + esc(p[1]) + '</b><span>' + esc(p[2]) + '</span></div>'; }).join('') + '</div>' +
      '<section class="mm-bloc mm-bloc-alerte"><h2>Actions prioritaires (' + priorites.length + ')</h2>' + tableau(['Problème', 'Moto', 'Responsable', 'Échéance', 'Statut', 'Action'], priorites.slice(0, 40).map(function (a) {
        return [esc(a.anomalie) + (a.gravite ? ' ' + badge(a.gravite) : ''), '<a class="mm-lien" href="#/moto/' + esc(a.moto_id) + '">' + esc(a.moto_code) + '</a>', esc(a.responsable_nom || '—'),
          esc(a.date_cible ? C.dateFr(a.date_cible) : '—') + (a.en_retard ? ' <span class="mm-badge mm-ko">En retard</span>' : ''), badge(a.statut),
          a._insp ? (peutInspecter(a._insp) ? '<button type="button" class="mm-btn mm-primaire mm-petit" data-inspecter="' + esc(a.moto_id) + '" data-niveau="' + esc(a._insp.niveau) + '">Inspecter</button>' : '') : boutonsAction(a)];
      }), 'Rien en attente : le parc est à jour.') + '</section>' +
      '<div class="mm-kpis">' + kpi('Couverture des inspections', C.pct(cv.taux), cv.exigibles ? cv.dans_delai + ' / ' + cv.exigibles + ' échues faites dans les délais' + (cv.hors_delai ? ' · ' + cv.hors_delai + ' tardive(s)' : '') : 'Aucune inspection échue à ce jour') +
        kpi('Anomalies résolues à temps', C.pct(res.taux), res.echues ? res.a_temps + ' / ' + res.echues + ' arrivées à échéance' : 'Aucune échéance passée') +
        kpi('Disponibilité technique', C.pct(jp > 0 ? Math.round(1000 * (jp - ji) / jp) / 10 : null), jp ? (jp - ji) + ' / ' + jp + ' jours opérationnels' : 'Aucune moto en service') + '</div>' +
      '<section class="mm-bloc"><h2>A. Flotte</h2><div class="mm-kpis">' + kpi('Actives', String(actives.length), 'mises en service') +
        kpi('Immobilisées', String(flotte.filter(function (m) { return m.statut_technique === 'IMMOBILISEE'; }).length), '') + kpi('En réparation', String(flotte.filter(function (m) { return m.statut_technique === 'EN_REPARATION'; }).length), '') +
        kpi('À acquérir', String(prevues.length), prevues.map(function (m) { return m.beneficiaire_prevu_nom || m.code; }).join(', ')) + kpi('Dossiers incomplets', String(flotte.filter(function (m) { return m.dossier_incomplet; }).length), 'identifiants, photo ou documents') + '</div>' +
        (peut('inventaire_logistique') || peut('inventaire') ? '<div class="mm-actions">' + '<button type="button" class="mm-btn mm-primaire mm-petit" data-admin="creer">Enregistrer une moto</button>' +
          '<button type="button" class="mm-btn mm-secondaire mm-petit" data-admin="integrer">Intégrer une moto en exploitation</button>' + (peut('pneus') ? '<button type="button" class="mm-btn mm-secondaire mm-petit" data-admin="pneu">Pneu en stock</button>' : '') + '</div>' : '') + '</section>' +
      '<section class="mm-bloc"><h2>B. Inspections du mois</h2><div class="mm-kpis">' + kpi('Exigibles', String(ceMois.length), phase.libelle) +
        kpi('Faites dans les délais', String(ceMois.filter(function (x) { return x.statut === 'EFFECTUEE'; }).length), '') +
        kpi('En retard', String(ceMois.filter(function (x) { return x.statut === 'NON_EFFECTUEE' || x.statut === 'EFFECTUEE_HORS_DELAI'; }).length), 'non faites ou tardives') +
        kpi('Coordinateur : restantes', String(ceMois.filter(function (x) { return x.niveau === 'COORDINATION' && !x.inspection_id; }).length), '') +
        kpi('Contrôles indépendants', String(ceMois.filter(function (x) { return x.niveau === 'INDEPENDANTE'; }).length), ceMois.filter(function (x) { return x.niveau === 'INDEPENDANTE' && x.inspection_id; }).length + ' fait(s)') + '</div>' +
        tableau(['Moto', 'Utilisateur', 'Niveau', 'Fenêtre', 'Statut', 'Résultat', 'Action'], ceMois.map(function (x) {
          return ['<a class="mm-lien" href="#/moto/' + esc(x.moto_id) + '/controles">' + esc(x.code) + '</a>', esc(x.beneficiaire_nom || '—'), esc(C.libelleNiveau(x.niveau)), esc(C.dateFr(x.fenetre_debut) + ' → ' + C.dateFr(x.fenetre_fin)),
            badge(x.statut), x.conformite ? badge(x.conformite) + (x.inspecteur_nom ? '<small class="mm-aide">' + esc(x.inspecteur_nom) + '</small>' : '') : '—',
            peutInspecter(x) ? '<button type="button" class="mm-btn mm-primaire mm-petit" data-inspecter="' + esc(x.moto_id) + '" data-niveau="' + esc(x.niveau) + '">Inspecter</button>' : ''];
        }), 'Aucune inspection exigible ce mois (une moto mise en service après le début de la fenêtre n\'a pas d\'inspection rétroactive).') + '</section>' +
      '<section class="mm-bloc"><h2>C. Maintenance et anomalies (' + ouvertes.length + ' ouvertes)</h2>' + tableauActions(ouvertes, true) +
        '<h3>Entretiens et réparations en cours</h3>' + tableau(['Moto', 'Type', 'Description', 'Statut'], D.maintenances.filter(function (x) { return ['CLOTUREE', 'ANNULEE', 'REFUSEE', 'CONTROLEE'].indexOf(x.statut) < 0; }).map(function (x) { return [esc(codeMoto(x.moto_id)), esc(C.libelle(x.type_maintenance)), esc(x.description), badge(x.statut)]; }), 'Aucun entretien en cours.') +
        '<p class="mm-note">Dossiers détaillés, devis et décisions : espace <a class="mm-lien" href="#/maintenance">Maintenance</a>.</p>' +
        '<h3>Échéances</h3>' + tableau(['Moto', 'Règle', 'Statut'], D.echeances.filter(function (e) { return e.statut === 'DEPASSEE' || e.statut === 'PROCHE'; }).map(function (e) { return [esc(e.code), esc(e.libelle), badge(e.statut)]; }),
          'Aucune échéance : les règles d\'entretien ne sont actives qu\'une fois approuvées par le Branch Manager sur source documentée (aucune périodicité inventée).') +
        '<h3>Pneus montés</h3>' + tableau(['Pneu', 'Moto', 'Posé le', 'Km parcourus', 'DOT'], D.pneus.filter(function (p) { return p.statut === 'MONTE'; }).map(function (p) { return [esc(p.code + ' · ' + p.marque + ' ' + p.dimensions), esc(codeMoto(p.moto_actuelle_id) + ' ' + (p.position_actuelle || '')), esc(C.dateFr(p.premiere_pose)), esc(C.km(p.km_parcourus)), esc(p.date_fabrication || C.ND)]; }), 'Aucun pneu suivi.') + '</section>' +
      '<section class="mm-bloc"><h2>D. Dépenses</h2>' + tableau(['Enveloppe', 'Mois', 'Demandé', 'Approuvé', 'Consommé', 'Justifié', 'En attente', 'Solde', 'Statut', 'Action'], D.enveloppes.map(function (e) {
          var act = [];
          if (e.statut === 'DEMANDEE' && peut('valider_enveloppe') && e.demande_par !== mine && e.titulaire_id !== mine) act.push(action('enveloppe_decider', 'Décider', { id: e.id, montant: e.montant_demande }, 'mm-primaire'));
          if (e.statut === 'APPROUVEE' && e.titulaire_id === mine) act.push(action('depense_declarer', 'Déclarer une dépense', { id: e.id }));
          return [esc(C.libelle(e.type_enveloppe)), esc(String(e.periode).slice(0, 7)), esc(C.fcfa(e.montant_demande)), esc(e.montant_approuve == null ? '—' : C.fcfa(e.montant_approuve)), esc(C.fcfa(e.montant_consomme)),
            esc(C.fcfa(e.montant_justifie)), esc(C.fcfa(Number(e.en_attente_justificatif) + Number(e.en_attente_verification))), esc(e.solde_disponible == null ? '—' : C.fcfa(e.solde_disponible)), badge(e.statut), act.join(' ')];
        }), 'Aucune enveloppe. Aucun montant n\'est fixé par l\'application : le coordinateur propose, le Branch Manager approuve.') +
        (peut('enveloppes') ? '<div class="mm-actions"><button type="button" class="mm-btn mm-secondaire mm-petit" data-coord="enveloppe">Demander une enveloppe mensuelle</button></div>' : '') +
        '<h3>Dépenses à justifier ou vérifier</h3>' + tableau(['Date', 'Objet', 'Montant', 'Moto', 'Statut', 'Action'], D.depenses.filter(function (x) { return x.statut === 'DECLAREE' || x.statut === 'JUSTIFIEE'; }).map(function (x) {
          var act = x.statut === 'DECLAREE' && x.declare_par === mine ? action('depense_justifier', 'Ajouter le justificatif', { id: x.id }) :
                    x.statut === 'JUSTIFIEE' && peut('verifier_depense') && x.declare_par !== mine ? action('depense_verifier', 'Vérifier', { id: x.id, chemin: x.justificatif_path }, 'mm-primaire') : '';
          return [esc(C.dateFr(x.date_depense)), esc(x.objet), esc(C.fcfa(x.montant)), esc(x.moto_id ? codeMoto(x.moto_id) : '—'), badge(x.statut), act];
        }), 'Aucune dépense en attente.') +
        '<h3>Coûts d\'entretien documentés par moto</h3>' + tableau(['Moto', 'Entretien', 'Pneus', 'Carburant vérifié'], D.couts.map(function (c) { return [esc(c.code), esc(C.fcfa(c.cout_maintenance)), esc(C.fcfa(c.cout_pneus)), esc(C.fcfa(c.cout_carburant_verifie))]; }), 'Aucune donnée.') +
        '<p class="mm-note">Coûts documentés uniquement : une dépense non enregistrée n\'est pas comptée comme nulle, elle est absente. Pour une moto intégrée en exploitation, le suivi commence à son état de référence.</p>' +
        '<h3>Consommations à examiner</h3>' + tableau(['Moto', 'Km', 'Litres', 'L/100 km', 'Statut'], D.conso.map(function (i) { return [esc(codeMoto(i.moto_id)), esc(C.km(i.km)), esc(i.litres), esc(C.l100(i.l_100km)), badge(i.statut_alerte)]; }),
          'Aucune consommation atypique mesurée (méthode plein à plein, données vérifiées).') + '<p class="mm-note">Une consommation atypique déclenche une vérification, jamais une accusation.</p></section>';
    $$('[data-inspecter]').forEach(function (b) { b.onclick = function () { var mm = motoParId(b.dataset.inspecter); if (mm) ACTIONS.inspection_mensuelle({ niveau: b.dataset.niveau }, mm); }; });
    $$('[data-admin]').forEach(function (b) { b.onclick = function () { beneficiaires().catch(function () { return []; }).then(function (x) { ADMIN[b.dataset.admin](x); }); }; });
    $$('[data-coord]').forEach(function (b) { b.onclick = function () { COORD[b.dataset.coord](); }; });
    vue().onclick = function (e) {
      var b = e.target.closest('[data-action]'); if (!b) return;
      if (ACTIONS[b.dataset.action]) return ACTIONS[b.dataset.action](b.dataset, motoParId(b.dataset.moto));
      if (COORD[b.dataset.action]) return COORD[b.dataset.action](b.dataset);
    };
    var ex = $('#coExport'); if (ex) ex.onclick = function () { exporterCoordination(D); };
  }
  var COORD = {
    enveloppe: function () {
      modale('Demander une enveloppe mensuelle', '<div class="mm-grille-form">' + champ({ n: 'type_enveloppe', l: 'Enveloppe', t: 'select', req: true, o: [['SUPERVISION', 'Déplacements de supervision'], ['ENTRETIEN', 'Entretien et réparation du parc']] }) +
        champ({ n: 'periode', l: 'Mois', t: 'date', req: true, v: aujourdhui().slice(0, 8) + '01', aide: 'Le 1er du mois concerné.' }) + champ({ n: 'montant_demande', l: 'Montant demandé (FCFA)', t: 'nombre', req: true, pas: 1 }) +
        champ({ n: 'justification', l: 'Justification (tournées prévues, besoins identifiés)', t: 'textarea', req: true, min: 10 }) + '</div>' +
        '<p class="mm-note">Enveloppe mensuelle pré-autorisée pour les missions courantes : pas de demande par déplacement. Aucun transfert d\'argent n\'est exécuté par l\'application.</p>',
      function (v) { return rpc('moto_enveloppe_demander', { p: v }).then(function () { vueCoordination(); return 'Enveloppe demandée : décision du Branch Manager.'; }); }, 'Demander');
    },
    enveloppe_decider: function (d) {
      modale('Décision sur l\'enveloppe', champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['APPROUVEE', 'Approuver'], ['REFUSEE', 'Refuser']] }) +
        champ({ n: 'montant', l: 'Montant approuvé (FCFA)', t: 'nombre', pas: 1, v: d.montant, aide: 'Inférieur ou égal au montant demandé ; motif obligatoire si réduit.' }) + champ({ n: 'motif', l: 'Motif', t: 'textarea' }),
      function (v) { return rpc('moto_enveloppe_decider', { p_enveloppe: d.id, p_decision: v.decision, p_montant: C.nombreSaisi(v.montant), p_motif: v.motif }).then(function () { router(); return 'Décision enregistrée.'; }); });
    },
    depense_declarer: async function (d) {
      var fac = await optFacturesVerifiees(null);
      modale('Déclarer une dépense', '<div class="mm-grille-form">' + champ({ n: 'date_depense', l: 'Date', t: 'date', req: true, v: aujourdhui(), max: aujourdhui() }) + champ({ n: 'montant', l: 'Montant (FCFA)', t: 'nombre', req: true, pas: 1 }) +
        champ({ n: 'objet', l: 'Objet', req: true }) + champ({ n: 'facture_id', l: 'Facture de garage réglée (dépense d\'entretien)', t: 'select', o: fac, aide: 'Obligatoire pour toute dépense d\'entretien ou de réparation : la facture doit être vérifiée et relever d\'une autorisation du Branch Manager.' }) +
        champ({ n: 'justificatif', l: 'Justificatif (reçu)', t: 'fichier', large: true, capture: true }) + '</div>' +
        '<p class="mm-note">Supervision : aucune moto ni réparation. Une enveloppe approuvée n\'autorise aucune dépense de réparation.</p>',
      async function (v) {
        if (v.justificatif) { var f = await deposerDepense(v.justificatif); v.justificatif_path = f; } delete v.justificatif;
        v.enveloppe_id = d.id; v.client_op_id = OFF.uuid(); var r = await rpc('moto_depense_declarer', { p: v }); router(); return 'Dépense ' + C.libelle(r.statut).toLowerCase() + '.';
      }, 'Déclarer');
    },
    depense_justifier: function (d) {
      modale('Justificatif de dépense', champ({ n: 'justificatif', l: 'Reçu ou facture', t: 'fichier', req: true, large: true, capture: true }),
        async function (v) { var f = await deposerDepense(v.justificatif); await rpc('moto_depense_justifier', { p_depense: d.id, p_path: f }); router(); return 'Justificatif ajouté : vérification par un tiers.'; });
    },
    depense_verifier: function (d) {
      modale('Vérifier la dépense', '<p><button type="button" class="mm-btn mm-secondaire mm-petit" id="voirJustif">Ouvrir le justificatif</button></p>' +
        champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['VALIDEE', 'Valider'], ['REJETEE', 'Rejeter']] }) + champ({ n: 'motif', l: 'Motif (obligatoire si rejet)', t: 'textarea' }),
        function (v) { return rpc('moto_depense_verifier', { p_depense: d.id, p_decision: v.decision, p_motif: v.motif }).then(function () { router(); return 'Dépense vérifiée.'; }); });
      var b = $('#voirJustif'); if (b) b.onclick = function () { ouvrirFichier(d.chemin); };
    }
  };
  async function deposerDepense(fichier) {
    if (fichier.size > 10 * 1048576) throw new Error('Fichier trop volumineux (10 Mo maximum).');
    var blob = await compresser(fichier), ext = extension(blob, fichier.name), chemin = 'depenses/' + S.profil.user_id + '/' + OFF.uuid() + '.' + ext;
    var r = await S.sb.storage.from('moto-documents').upload(chemin, blob, { upsert: false, contentType: blob.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg') });
    if (r.error) throw new Error('Dépôt du justificatif refusé : ' + messageErreur(r.error));
    return chemin;
  }
  async function exporterCoordination(D) {
    try {
      if (!g.XLSX) await chargerScript(CDN_XLSX);
      var wb = g.XLSX.utils.book_new();
      function feuille(nom, rows) { g.XLSX.utils.book_append_sheet(wb, g.XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: 'Aucune donnée' }]), nom.slice(0, 31)); }
      feuille('Synthese', [{ Rapport: 'AFLP FLEET · Gestion et suivi du parc de motos AFLP', Mois: aujourdhui().slice(0, 7), Genere: new Date().toISOString(), Par: S.profil.nom,
        'Couverture inspections %': C.couvertureInspections(D.exigibles.filter(function (x) { return x.statut !== 'PROGRAMMEE'; })).taux, 'Resolution a temps %': C.resolutionActions(D.actions, aujourdhui()).taux }]);
      feuille('Inspections', D.exigibles.map(function (x) { return { Mois: x.periode, Moto: x.code, Utilisateur: x.beneficiaire_nom, Niveau: C.libelleNiveau(x.niveau), 'Fenetre debut': x.fenetre_debut, 'Fenetre fin': x.fenetre_fin, Statut: C.libelle(x.statut), Resultat: x.conformite ? C.libelle(x.conformite) : '', Inspecteur: x.inspecteur_nom || '', Date: x.date_controle || '' }; }));
      feuille('Anomalies', D.actions.map(function (a) { return { Moto: a.moto_code, Anomalie: a.anomalie, Gravite: C.libelle(a.gravite), Constat: a.constat_at, Occurrences: a.occurrences, Responsable: a.responsable_nom || '', 'Action prevue': a.action_prevue || '', Prestataire: a.prestataire || '', Devis: a.devis_montant, 'Date cible': a.date_cible || '', Realise: a.realise_at || '', 'Cout reel': a.cout_reel, Verifie: a.verifie_at || '', Statut: C.libelle(a.statut) }; }));
      feuille('Enveloppes', D.enveloppes.map(function (e) { return { Enveloppe: C.libelle(e.type_enveloppe), Mois: e.periode, Demande: e.montant_demande, Approuve: e.montant_approuve, Consomme: e.montant_consomme, Justifie: e.montant_justifie, 'En attente': Number(e.en_attente_justificatif) + Number(e.en_attente_verification), Solde: e.solde_disponible, Statut: C.libelle(e.statut) }; }));
      feuille('Flotte', S.flotte.map(function (m) { return { Code: m.code, Situation: C.situationMoto(m).libelle, Origine: C.libelle(m.origine), Marque: m.marque || C.ND, Modele: m.modele || C.ND, Utilisateur: m.beneficiaire_nom || m.beneficiaire_prevu_nom || '', Technique: C.libelle(m.statut_technique), 'Anomalies ouvertes': m.actions_ouvertes, 'Dossier incomplet': m.dossier_incomplet ? 'Oui' : 'Non', 'Debut suivi fiable': m.date_debut_suivi || m.date_reception || C.ND }; }));
      g.XLSX.writeFile(wb, 'ANAGROCI_AFLP_FLEET_Rapport_mensuel_' + aujourdhui().slice(0, 7) + '.xlsx', { compression: true });
      toast('Rapport mensuel généré.', 'ok');
    } catch (e) { toast('Export impossible : ' + messageErreur(e), 'ko'); }
  }

  /* -- C. PILOTAGE ------------------------------------------------------------ */
  async function vuePilotage() {
    await chargerFlotte();
    var q = function (t, f) { return lireTable(t, f).catch(function () { return []; }); };
    var d = await Promise.all([q('moto_v_conso_moto'), q('moto_v_cout_km'), q('moto_v_disponibilite'), q('moto_v_echeances'), q('moto_v_alertes_documents'),
      peut('rapprochement') ? q('moto_v_rapprochement') : Promise.resolve([]), q('moto_v_conso_intervalles', function (x) { return x.order('fin_date', { ascending: false }).limit(200); }),
      q('moto_documents', function (x) { return x.eq('statut', 'EN_VERIFICATION'); }), q('moto_carburant', function (x) { return x.eq('justificatif_statut', 'A_VERIFIER'); }),
      q('moto_budgets', function (x) { return x.eq('statut', 'PROPOSE'); }), q('moto_corrections', function (x) { return x.eq('statut', 'DEMANDEE'); }),
      q('moto_remboursements', function (x) { return x.eq('statut', 'DEMANDE'); }), Promise.resolve([]),
      q('moto_v_pneus'), q('moto_v_qualite_donnees'), q('moto_v_formation'), q('moto_incidents', function (x) { return x.neq('etape', 'CLOS'); }),
      q('moto_v_inspections_exigibles'), q('moto_v_actions'), q('moto_v_enveloppes')]);
    var exceptions = C.exceptionsDirection(S.flotte, d[17], d[18], d[19], aujourdhui());
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
    var decisionsBm = peut('maintenance_autoriser') ? await lireTable('moto_v_decisions_bm', function (x) { return x.eq('statut', 'EN_ATTENTE'); }).catch(function () { return []; }) : [];
    vue().innerHTML = '<div class="mm-entete"><div><h1>Pilotage de la flotte</h1><p>Indicateurs calculés côté serveur sur les données réelles saisies.</p></div>' +
      (peut('exports') ? '<button type="button" class="mm-btn mm-primaire" id="pilExport">Exporter Excel</button>' : '') + '</div>' + bandeauHorsLigne() +
      (avert ? '<div class="mm-bandeau mm-info">' + esc(avert) + '</div>' : '') +
      (peut('maintenance_autoriser') ? '<section class="mm-bloc' + (decisionsBm.length ? ' mm-bloc-alerte' : '') + '"><h2>Décisions de dépense à prendre (' + decisionsBm.length + ')</h2>' +
        (decisionsBm.length ? '<p>' + esc(decisionsBm.length) + ' demande(s) de dépense d\'entretien ou de réparation attendent votre autorisation individuelle.</p>' : '<p>Aucune demande de dépense en attente.</p>') +
        '<a class="mm-btn mm-primaire mm-petit" href="#/maintenance/decisions">Ouvrir « Décisions à prendre »</a></section>' : '') +
      (peut('exceptions') || peut('coordination') ? '<section class="mm-bloc mm-bloc-alerte"><h2>Exceptions à traiter (' + exceptions.length + ')</h2>' + tableau(['Exception', 'Moto', 'Détail', ''], exceptions.map(function (x) {
        return [badge(x.gravite === 1 ? 'CRITIQUE' : x.gravite === 2 ? 'MAJEURE' : 'MINEURE', x.type), esc(x.moto), esc(x.detail), x.moto_id ? '<a class="mm-btn mm-secondaire mm-petit" href="#/moto/' + esc(x.moto_id) + '">Ouvrir</a>' : '<a class="mm-btn mm-secondaire mm-petit" href="#/coordination">Coordination</a>'];
      }), 'Aucune exception : les opérations normales ne demandent pas votre validation.') + '<p class="mm-note">Seules les exceptions remontent ici : moto dangereuse ou immobilisée, réparation en retard, inspection manquante, dépense à autoriser, anomalie récurrente, risque d\'interruption.</p></section>' : '') +
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
    remboursement_decider: function (d) { modale('Remboursement d\'avance personnelle', champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['VALIDE', 'Valider'], ['REJETE', 'Rejeter']] }) + champ({ n: 'motif', l: 'Motif', t: 'textarea' }) + '<p class="mm-note">AFLP FLEET n\'exécute aucun paiement : Finance paie selon ses procédures puis déclare le paiement.</p>', function (v) { return rpc('moto_remboursement_decider', { p_remboursement: d.id, p_decision: v.decision, p_motif: v.motif }).then(router); }); }
  };
  async function exporter(d) {
    try {
      if (!g.XLSX) await chargerScript(CDN_XLSX);
      var wb = g.XLSX.utils.book_new();
      function feuille(nom, rows) { var ws = g.XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: 'Aucune donnée' }]); g.XLSX.utils.book_append_sheet(wb, ws, nom.slice(0, 31)); }
      feuille('AFLP FLEET', [{ Rapport: 'AFLP FLEET · Gestion et suivi du parc de motos AFLP', Genere: new Date().toISOString(), Par: S.profil.nom }]);
      feuille('Flotte', S.flotte.map(function (m) { return { Code: m.code, Situation: C.situationMoto(m).libelle, Marque: m.marque || C.ND, Modele: m.modele, Immatriculation: m.immatriculation || '', Chassis: m.numero_chassis || '', Cluster: m.cluster_code || '', Administratif: C.libelle(m.statut_administratif), Affectation: C.libelle(m.statut_affectation), Technique: C.libelle(m.statut_technique), Affectataire: m.beneficiaire_nom || '', 'Mise en service': m.mise_en_service_at || '', 'Compteur km': m.compteur_actuel_km }; }));
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
      g.XLSX.writeFile(wb, 'ANAGROCI_AFLP_FLEET_' + aujourdhui() + '.xlsx', { compression: true });
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
    S.beneficiaires = b;
    var nom = function (id) { var x = b.filter(function (y) { return y.user_id === id; })[0]; return x ? x.nom : String(id).slice(0, 8); };
    vue().innerHTML = '<div class="mm-entete"><div><h1>Administration</h1><p>Inventaire, dotations, pneus et paramètres. Chaque opération est contrôlée et journalisée par le serveur.</p></div></div>' +
      '<div class="mm-tuiles">' + tuileAdmin('creer', 'Enregistrer une moto', 'Neuve ou acquisition prévue, avec photo') + tuileAdmin('integrer', 'Intégrer une moto en exploitation', 'Sans historique inventé') + tuileAdmin('budget', 'Budget carburant', peut('valider_budget') ? 'Autoriser un budget' : 'Proposer un budget au Branch Manager') +
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
  /* Documents scannés dès l'enregistrement : carte grise, assurance, plaque.
     Facultatifs (le dossier peut rester « à compléter ») ; chacun est vérifié ensuite par un autre responsable. */
  var DOCS_ENREG = [
    { t: 'CARTE_GRISE', l: 'Carte grise', ref: 'N° de la carte grise', emis: true },
    { t: 'ASSURANCE', l: 'Attestation d\'assurance', ref: 'N° de police', exp: true },
    { t: 'PLAQUE', l: 'Plaque d\'immatriculation (photo)', ref: 'N° inscrit sur la plaque' }];
  function champsDocsMoto() {
    return '<fieldset class="mm-champ mm-large mm-docs-enreg"><legend>Documents de la moto (à scanner s\'ils sont disponibles)</legend>' +
      '<p class="mm-note">Scannez chaque document puis recopiez ses références en le lisant. Aucun champ n\'est rempli automatiquement : un numéro mal lu ne doit jamais entrer dans le dossier.</p>' +
      DOCS_ENREG.map(function (d) {
        return '<div class="mm-doc-enreg"><h3>' + esc(d.l) + '</h3><div class="mm-grille-form">' +
          champ({ n: 'scan_' + d.t, l: d.l + ' numérisée', t: 'scan' }) + champ({ n: 'ref_' + d.t, l: d.ref }) +
          (d.emis ? champ({ n: 'emis_' + d.t, l: 'Date de délivrance', t: 'date', max: aujourdhui() }) : '') +
          (d.exp ? champ({ n: 'exp_' + d.t, l: 'Date d\'expiration', t: 'date', aide: 'Obligatoire si l\'assurance est scannée : elle déclenche l\'alerte avant échéance.' }) : '') + '</div></div>';
      }).join('') + '</fieldset>';
  }
  function extraireDocsMoto(v) {
    var docs = DOCS_ENREG.map(function (d) {
      var x = { t: d.t, l: d.l, fichier: v['scan_' + d.t], ref: v['ref_' + d.t], emis: v['emis_' + d.t], exp: v['exp_' + d.t] };
      ['scan_', 'ref_', 'emis_', 'exp_'].forEach(function (k) { delete v[k + d.t]; });
      return x;
    }).filter(function (x) { return x.fichier; });
    docs.forEach(function (x) { if (x.t === 'ASSURANCE' && !x.exp) throw new Error('Assurance scannée : sa date d\'expiration est obligatoire.'); });
    return docs;
  }
  async function enregistrerDocsMoto(motoId, docs) {
    var ok = 0, ko = [];
    for (var i = 0; i < docs.length; i++) {
      var x = docs[i];
      try {
        var f = await deposer(motoId, 'document', x.fichier);
        await rpc('moto_document_enregistrer', { p: { moto_id: motoId, type_document: x.t, numero_reference: x.ref, date_emission: x.emis, date_expiration: x.exp,
          storage_path: f.chemin, nom_fichier: f.nom, motif: 'Document scanné à l\'enregistrement de la moto' } });
        ok++;
      } catch (e) { ko.push(x.l + ' : ' + messageErreur(e)); }
    }
    return (ok ? ' ' + ok + ' document(s) déposé(s), en attente de vérification.' : '') + (ko.length ? ' Non enregistré(s) (à refaire depuis l\'onglet Documents) : ' + ko.join(' ; ') + '.' : '');
  }
  function optClusters() { return [['SAKASSOU', 'Sakassou'], ['BOTRO', 'Botro'], ['BROBO', 'Brobo'], ['DJEBONOUA', 'N\'Djébonoua'], ['BEOUMI', 'Béoumi'], ['DIABO', 'Diabo']]; }
  function optMotos() { return S.flotte.map(function (m) { return [m.id, m.code + ' · ' + (m.immatriculation || 'immat. en attente')]; }); }
  var ADMIN = {
    creer: function (b) {
      b = b || [];
      modale('Enregistrer une moto', '<div class="mm-grille-form">' + [
        { n: 'situation_parc', l: 'Situation', t: 'select', req: true, vide: false, o: [['RECEPTIONNEE', 'Moto réceptionnée physiquement'], ['PREVUE', 'Acquisition prévue (pas encore reçue)']] },
        { n: 'marque', l: 'Marque', ph: 'Ex. APSONIC', aide: 'Obligatoire si réceptionnée.' }, { n: 'modele', l: 'Modèle', ph: 'Ex. AP150-30' },
        { n: 'date_reception', l: 'Date de réception effective', t: 'date', max: aujourdhui(), aide: 'Obligatoire si réceptionnée ; vide si prévue.' },
        { n: 'compteur_km', l: 'Kilométrage à la réception', t: 'nombre' }, { n: 'numero_chassis', l: 'N° de châssis', aide: 'Recopié du document réel ; sinon vide (jamais inventé).' },
        { n: 'immatriculation', l: 'Immatriculation', aide: 'Vide tant que la plaque n\'est pas reçue.' }, { n: 'couleur', l: 'Couleur' }, { n: 'fournisseur', l: 'Fournisseur' },
        { n: 'cluster_code', l: 'Localisation (cluster)', t: 'select', o: optClusters() },
        { n: 'beneficiaire_prevu_id', l: 'Utilisateur prévu', t: 'select', o: b.map(function (x) { return [x.user_id, x.nom + ' · ' + x.role]; }) },
        { n: 'beneficiaire_prevu_libelle', l: 'Utilisateur prévu (sans compte)', ph: 'Ex. Deuxième Chef de zone' },
        { n: 'observations', l: 'Observations', t: 'textarea' }].map(champ).join('') + '</div>' + champPhoto('photo', 'Photo principale de la moto', false) + champsDocsMoto() +
        '<p class="mm-note">Le dossier peut être créé avant toutes les pièces : il reste « Dossier à compléter ». Création ≠ autorisation de circuler. Les documents manquants s\'ajoutent ensuite depuis l\'onglet Documents du passeport.</p>',
      async function (v) {
        var photo = v.photo; delete v.photo;
        var docs = extraireDocsMoto(v);
        if (docs.length && v.situation_parc === 'PREVUE') throw new Error('Moto « acquisition prévue » : scannez ses documents après sa réception.');
        var r = await rpc('moto_creer', { p: v }), msg = 'Moto ' + r.code + ' enregistrée (' + C.libelle(r.situation_parc).toLowerCase() + ').';
        if (docs.length) msg += await enregistrerDocsMoto(r.id, docs);
        if (photo) { try { var f = await deposer(r.id, 'photo', photo); await rpc('moto_photo_ajouter', { p: { moto_id: r.id, path: f.chemin, principale: true } }); } catch (e) { msg += ' Photo non enregistrée : ' + messageErreur(e) + ' (à refaire depuis le passeport).'; } }
        location.hash = '#/moto/' + r.id; return msg;
      }, 'Enregistrer');
    },
    integrer: function (b) {
      b = b || [];
      modale('Intégrer une moto déjà en exploitation', '<p class="mm-bandeau mm-info">Pour une moto ANAGROCI déjà utilisée (ex. moto d\'un Chef de zone). Laissez vide tout ce qui n\'est pas justifié : « Non disponible » n\'est jamais remplacé par zéro. Aucun entretien passé n\'est reconstitué.</p>' +
        '<div class="mm-grille-form">' + [{ n: 'marque', l: 'Marque (si connue)' }, { n: 'modele', l: 'Modèle (si connu)' },
          { n: 'date_acquisition', l: 'Date d\'acquisition (si connue)', t: 'date', max: aujourdhui() }, { n: 'date_debut_utilisation', l: 'Début d\'utilisation (si connu)', t: 'date', max: aujourdhui() },
          { n: 'numero_chassis', l: 'N° de châssis (si lu sur document réel)' }, { n: 'immatriculation', l: 'Immatriculation (si connue)' }, { n: 'couleur', l: 'Couleur' },
          { n: 'zone_code', l: 'Zone', t: 'select', o: [['GBEKE_1', 'GBEKE 1'], ['GBEKE_2', 'GBEKE 2']] }, { n: 'cluster_code', l: 'Cluster', t: 'select', o: optClusters() },
          { n: 'beneficiaire_prevu_id', l: 'Utilisateur actuel', t: 'select', o: b.map(function (x) { return [x.user_id, x.nom + ' · ' + x.role]; }) },
          { n: 'historique_note', l: 'Historique réellement connu', t: 'textarea', aide: 'Ex. « Utilisée depuis février 2026 ; aucun justificatif d\'entretien disponible ».' },
          { n: 'observations', l: 'Observations', t: 'textarea' }].map(champ).join('') + '</div>' + champPhoto('photo', 'Photo principale', false) + champsDocsMoto() +
        '<p class="mm-note">Étape suivante, depuis le passeport : « État technique de référence » par un intervenant qualifié (compteur, inventaire photo, anomalies). Le suivi fiable commence à cette date.</p>',
      async function (v) {
        var photo = v.photo; delete v.photo; v.origine = 'EN_EXPLOITATION';
        var docs = extraireDocsMoto(v);
        var r = await rpc('moto_creer', { p: v }), msg = 'Moto ' + r.code + ' intégrée. Programmez l\'état technique de référence.';
        if (docs.length) msg += await enregistrerDocsMoto(r.id, docs);
        if (photo) { try { var f = await deposer(r.id, 'photo', photo); await rpc('moto_photo_ajouter', { p: { moto_id: r.id, path: f.chemin, principale: true } }); } catch (e) { msg += ' Photo non enregistrée : ' + messageErreur(e); } }
        location.hash = '#/moto/' + r.id; return msg;
      }, 'Intégrer');
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
        '<p class="mm-note">AFLP FLEET enregistre la remise ; il n\'exécute aucun transfert d\'argent. La dotation ne compte comme reçue qu\'après confirmation du bénéficiaire.</p>',
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
        { n: 'numero_serie', l: 'N° de série ou marquage' }, { n: 'date_fabrication', l: 'Date de fabrication DOT (4 chiffres, si lisible)', ph: 'Ex. 2526 = semaine 25 de 2026' }, { n: 'date_achat', l: 'Date d\'achat', t: 'date' }, { n: 'fournisseur', l: 'Fournisseur' }].map(champ).join('') + '</div>' +
        '<p class="mm-note">Coût d\'un pneu acheté : part d\'une facture vérifiée d\'un dossier « Pneumatique » autorisé par le Branch Manager (à renseigner par le coordinateur).</p>',
      function (v) { return rpc('moto_pneu_creer', { p: v }).then(function () { return 'Pneu enregistré en stock.'; }); });
    },
    parametres: function (b, bu, d, regles) {
      var p = S.params;
      modale('Paramètres', '<div class="mm-grille-form">' + champ({ n: 'conso_seuil_verification_1', l: 'Seuil de vérification 1 (L/100 km)', t: 'nombre', pas: '0.1', v: p.conso_seuil_verification_1 && p.conso_seuil_verification_1.valeur }) +
        champ({ n: 'conso_seuil_verification_2', l: 'Seuil de vérification 2 (L/100 km)', t: 'nombre', pas: '0.1', v: p.conso_seuil_verification_2 && p.conso_seuil_verification_2.valeur }) +
        champ({ n: 'jours_operationnels_semaine', l: 'Jours opérationnels / semaine', t: 'nombre', pas: 1, v: p.jours_operationnels_semaine && p.jours_operationnels_semaine.valeur }) +
        '<p class="mm-note mm-large">Règles d\'entretien : espace Maintenance › Règles d\'entretien (versions par modèle, approuvées par le BM).</p>' +
        champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 5 }) + '</div>',
      async function (v) {
        var jobs = [['conso_seuil_verification_1', v.conso_seuil_verification_1], ['conso_seuil_verification_2', v.conso_seuil_verification_2], ['jours_operationnels_semaine', v.jours_operationnels_semaine]]
          .filter(function (x) { return x[1] != null && String(x[1]) !== String(p[x[0]] && p[x[0]].valeur); })
          .map(function (x) { return rpc('moto_parametre_modifier', { p_cle: x[0], p_valeur: C.nombreSaisi(x[1]), p_valeur_json: null, p_motif: v.motif }); });
        // Les règles d'entretien se gèrent désormais par versions dans l'espace Maintenance.
        await Promise.all(jobs); await chargerParametres(); vueAdmin(); return 'Paramètres enregistrés.';
      });
    }
  };

  /* -- Module maintenance (moto-maintenance.js) ------------------------------ */
  var INTERFACE_MODULES = { C: C, OFF: OFF, S: S, esc: esc, $: $, $$: $$, peut: peut, vue: vue, tableau: tableau, action: action, champ: champ, badge: badge,
    modale: modale, rpc: rpc, lireTable: lireTable, kpi: kpi, toast: toast, nomMoto: nomMoto, beneficiaires: beneficiaires, ouvrirFichier: ouvrirFichier,
    aujourdhui: aujourdhui, messageErreur: messageErreur, chargerScript: chargerScript, CDN_XLSX: CDN_XLSX };
  var PERMIS = g.MOTO_PERMIS ? g.MOTO_PERMIS(INTERFACE_MODULES) : null;
  var CARNET = g.MOTO_CARNET ? g.MOTO_CARNET(INTERFACE_MODULES) : null;
  var MISSION = g.MOTO_MISSION ? g.MOTO_MISSION(INTERFACE_MODULES) : null;
  var MNT = g.MOTO_MAINTENANCE ? g.MOTO_MAINTENANCE({ C: C, OFF: OFF, S: S, esc: esc, $: $, $$: $$, peut: peut, vue: vue, tableau: tableau, action: action, champ: champ,
    modale: modale, rpc: rpc, lireTable: lireTable, kpi: kpi, toast: toast, chargerFlotte: chargerFlotte, motoParId: motoParId, codeMoto: codeMoto, router: router,
    ouvrirFichier: ouvrirFichier, aujourdhui: aujourdhui, messageErreur: messageErreur }) : null;

  /* -- Démarrage ------------------------------------------------------------- */
  function etatReseau() {
    var el = $('#motoReseau'); if (!el) return;
    var en = navigator.onLine !== false;
    el.className = 'mm-reseau ' + (en ? 'mm-ok' : 'mm-ko'); el.textContent = en ? 'En ligne' : 'Hors connexion';
  }
  async function demarrer(detail) {
    S.profil = detail.profile; S.classe = C.classeDepuisProfil(S.profil);
    if (!S.classe) {
      $('#motoApp').innerHTML = '<main class="mm-main"><div class="mm-vide"><b>Accès AFLP FLEET non prévu pour votre rôle (' + esc(S.profil.role) + ').</b><p>Contactez le Branch Manager si besoin. Le serveur refuse de toute façon toute donnée moto aux rôles non habilités.</p><a class="mm-btn mm-secondaire" href="../index.html">Retour au portail</a></div></main>';
      return;
    }
    S.sb = await attendreClient();
    if (!g.ANAGROCI_OFFLINE) g.ANAGROCI_OFFLINE = { summary: function () { return OFF.resume().then(function (r) { return { pending: r.EN_ATTENTE, failed: r.BLOQUE, review: 0, conflicts: 0 }; }); } };
    coquille(); etatReseau();
    await chargerParametres(); await chargerCatalogue();
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
