/* ============================================================================
   AFLP FLEET — numérisation des documents (moto/moto-scan.js)
   ----------------------------------------------------------------------------
   « Scanner » un document avec l'appareil photo du téléphone (ou la galerie,
   ou un PDF déjà numérisé) : une ou plusieurs pages (recto, verso…), recadrage,
   rotation, « mode document » (gris contrasté, plus lisible et plus léger),
   puis assemblage en UN fichier PDF directement sur l'appareil.
   - Aucune bibliothèque externe : le PDF est écrit ici (images JPEG intégrées),
     ce qui fonctionne aussi sans réseau, avant la synchronisation.
   - Aucune lecture automatique (OCR) : les champs restent saisis par la
     personne, document sous les yeux. Une lecture automatique non éprouvée
     sur nos vrais documents pourrait inventer un numéro de châssis ou de permis.
   Usage : MOTO_SCAN.champ({ n, l, req, aide }) dans un formulaire,
           MOTO_SCAN.brancher(racine) après insertion,
           MOTO_SCAN.fichier(input) → File PDF (ou null).
   ========================================================================== */
(function (g) {
  'use strict';
  var MAX_PAGES = 6, COTE = 1800, QUALITE = 0.8, LIMITE = 9.5 * 1048576, A4_L = 595.28;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* -- Champ de formulaire -------------------------------------------------- */
  function champ(f) {
    return '<div class="mm-champ mm-large mm-scan" data-scan-champ="' + esc(f.n) + '" data-scan-titre="' + esc(f.l) + '">' +
      '<span class="mm-scan-label" id="lbl_scan_' + esc(f.n) + '">' + esc(f.l) + (f.req ? ' *' : '') + '</span>' +
      '<input type="hidden" name="' + esc(f.n) + '" data-scan' + (f.req ? ' data-req="1"' : '') + '>' +
      '<div class="mm-scan-etat" aria-live="polite">Aucun document numérisé.</div>' +
      '<div class="mm-scan-actions">' +
        '<button type="button" class="mm-btn mm-primaire mm-petit" data-scan-ouvrir aria-describedby="lbl_scan_' + esc(f.n) + '">Scanner</button>' +
        '<label class="mm-btn mm-secondaire mm-petit mm-scan-import">Importer un PDF<input type="file" accept="application/pdf" data-scan-pdf></label>' +
        '<button type="button" class="mm-btn mm-secondaire mm-petit" data-scan-vider hidden>Retirer</button>' +
      '</div>' + (f.aide ? '<small class="mm-aide">' + esc(f.aide) + '</small>' : '') + '</div>';
  }

  function brancher(racine) {
    Array.prototype.forEach.call((racine || document).querySelectorAll('[data-scan-champ]'), function (bloc) {
      if (bloc._scanBranche) return; bloc._scanBranche = true;
      var input = bloc.querySelector('input[data-scan]'), etat = bloc.querySelector('.mm-scan-etat'), vider = bloc.querySelector('[data-scan-vider]');
      function definir(file, texte) {
        input._scan = file || null; etat.textContent = texte || 'Aucun document numérisé.'; etat.classList.toggle('mm-scan-ok', !!file); vider.hidden = !file;
        bloc.dispatchEvent(new CustomEvent('scan-change', { bubbles: true, detail: { fichier: file } }));
      }
      bloc.querySelector('[data-scan-ouvrir]').onclick = function () {
        ouvrir(bloc.getAttribute('data-scan-titre'), function (file, pages) {
          definir(file, pages + ' page(s) numérisée(s) · PDF de ' + taille(file.size) + ' prêt à être enregistré.');
        });
      };
      bloc.querySelector('[data-scan-pdf]').onchange = function (e) {
        var f = e.target.files && e.target.files[0]; e.target.value = '';
        if (!f) return;
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { etat.textContent = 'Ce fichier n\'est pas un PDF. Pour une photo, utilisez « Scanner ».'; return; }
        if (f.size > LIMITE) { etat.textContent = 'PDF trop volumineux (' + taille(f.size) + ', 9,5 Mo maximum).'; return; }
        definir(f, 'PDF importé : ' + f.name + ' (' + taille(f.size) + ').');
      };
      vider.onclick = function () { definir(null); };
    });
  }
  function fichier(input) { return input && input._scan ? input._scan : null; }
  function taille(o) { return o > 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(o / 1024)) + ' Ko'; }

  /* -- Fenêtre de numérisation ---------------------------------------------- */
  function ouvrir(titre, valider) {
    var pages = [];   // { img, rot, cadre: {x,y,l,h} en proportions, apercu }
    var d = el('dialog', 'mm-modale mm-scan-dialog');
    d.innerHTML = '<form method="dialog" class="mm-modale-form" novalidate><header><h2>Scanner · ' + esc(titre) + '</h2>' +
      '<button type="button" class="mm-fermer" aria-label="Fermer">×</button></header><div class="mm-modale-corps">' +
      '<p class="mm-note">Posez le document à plat, bien éclairé, sans reflet. Photographiez chaque page (recto, puis verso). Vérifiez la lisibilité avant de valider.</p>' +
      '<div class="mm-scan-boutons">' +
        '<label class="mm-btn mm-primaire">Photographier une page<input type="file" accept="image/*" capture="environment" data-camera></label>' +
        '<label class="mm-btn mm-secondaire">Depuis la galerie<input type="file" accept="image/*" multiple data-galerie></label>' +
      '</div>' +
      '<label class="mm-case mm-scan-mode"><input type="checkbox" data-mode checked> Mode document (gris contrasté, plus lisible et plus léger)</label>' +
      '<ol class="mm-scan-pages" aria-label="Pages numérisées"></ol>' +
      '<p class="mm-erreur" role="alert" hidden></p></div>' +
      '<footer><button type="button" class="mm-btn mm-secondaire mm-annuler">Annuler</button>' +
      '<button type="submit" class="mm-btn mm-primaire" data-valider disabled>Valider le document</button></footer></form>';
    document.body.appendChild(d);
    var liste = d.querySelector('.mm-scan-pages'), err = d.querySelector('.mm-erreur'), btnVal = d.querySelector('[data-valider]'), mode = d.querySelector('[data-mode]');
    function fermer() { try { d.close(); } catch (e) {} d.remove(); }
    d.querySelector('.mm-fermer').onclick = fermer; d.querySelector('.mm-annuler').onclick = fermer;
    function erreur(t) { err.hidden = !t; err.textContent = t || ''; }

    async function ajouter(files) {
      erreur('');
      for (var i = 0; i < files.length; i++) {
        if (pages.length >= MAX_PAGES) { erreur(MAX_PAGES + ' pages au maximum par document.'); break; }
        try { var img = await charger(files[i]); pages.push({ img: img, rot: 0, cadre: { x: 0, y: 0, l: 1, h: 1 } }); }
        catch (e) { erreur('Image illisible : ' + (files[i].name || 'photo') + '.'); }
      }
      dessinerListe();
    }
    d.querySelector('[data-camera]').onchange = function (e) { var f = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; ajouter(f); };
    d.querySelector('[data-galerie]').onchange = function (e) { var f = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; ajouter(f); };
    mode.onchange = dessinerListe;

    function dessinerListe() {
      liste.innerHTML = '';
      pages.forEach(function (p, i) {
        var li = el('li', 'mm-scan-page');
        var c = rendre(p, 360, mode.checked);
        c.className = 'mm-scan-apercu'; c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Page ' + (i + 1));
        li.appendChild(c);
        var barre = el('div', 'mm-scan-barre', '<b>Page ' + (i + 1) + '</b>' +
          '<button type="button" class="mm-btn mm-secondaire mm-petit" data-rot>Pivoter ↻</button>' +
          '<button type="button" class="mm-btn mm-secondaire mm-petit" data-cadre>Recadrer</button>' +
          (i > 0 ? '<button type="button" class="mm-btn mm-secondaire mm-petit" data-haut aria-label="Monter la page ' + (i + 1) + '">↑</button>' : '') +
          '<button type="button" class="mm-btn mm-danger mm-petit" data-suppr>Supprimer</button>');
        barre.querySelector('[data-rot]').onclick = function () { p.rot = (p.rot + 90) % 360; p.cadre = { x: 0, y: 0, l: 1, h: 1 }; dessinerListe(); };
        barre.querySelector('[data-cadre]').onclick = function () { recadrer(p, dessinerListe); };
        barre.querySelector('[data-suppr]').onclick = function () { pages.splice(i, 1); dessinerListe(); };
        var h = barre.querySelector('[data-haut]'); if (h) h.onclick = function () { pages.splice(i - 1, 0, pages.splice(i, 1)[0]); dessinerListe(); };
        li.appendChild(barre); liste.appendChild(li);
      });
      btnVal.disabled = !pages.length;
      btnVal.textContent = pages.length ? 'Valider le document (' + pages.length + ' page' + (pages.length > 1 ? 's' : '') + ')' : 'Valider le document';
    }

    d.querySelector('form').addEventListener('submit', async function (e) {
      e.preventDefault(); if (!pages.length) return;
      btnVal.disabled = true; btnVal.textContent = 'Assemblage du PDF…'; erreur('');
      try {
        var q = QUALITE, cote = COTE, pdf;
        for (var essai = 0; essai < 4; essai++) {
          var jpgs = [];
          for (var i = 0; i < pages.length; i++) jpgs.push(await jpeg(rendre(pages[i], cote, mode.checked), q));
          pdf = construirePdf(jpgs);
          if (pdf.size <= LIMITE) break;
          q -= 0.12; cote = Math.round(cote * 0.85);
        }
        if (pdf.size > LIMITE) throw new Error('Document trop volumineux même compressé : réduisez le nombre de pages.');
        var nom = 'scan-' + new Date().toISOString().slice(0, 10) + '.pdf';
        var file;
        try { file = new File([pdf], nom, { type: 'application/pdf' }); } catch (x) { file = pdf; file.name = nom; }
        var n = pages.length; fermer(); valider(file, n);
      } catch (ex) { erreur(ex.message || String(ex)); btnVal.disabled = false; dessinerListe(); }
    });
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  /* -- Recadrage : rectangle à quatre poignées (doigt ou souris) ------------- */
  function recadrer(p, fin) {
    var d = el('dialog', 'mm-modale mm-scan-dialog mm-scan-cadre');
    d.innerHTML = '<form method="dialog" class="mm-modale-form"><header><h2>Recadrer la page</h2><button type="button" class="mm-fermer" aria-label="Fermer">×</button></header>' +
      '<div class="mm-modale-corps"><p class="mm-note">Faites glisser les coins pour ne garder que le document.</p><div class="mm-cadre-zone"></div></div>' +
      '<footer><button type="button" class="mm-btn mm-secondaire" data-tout>Tout garder</button><button type="submit" class="mm-btn mm-primaire">Appliquer</button></footer></form>';
    document.body.appendChild(d);
    var zone = d.querySelector('.mm-cadre-zone');
    var c = rendre({ img: p.img, rot: p.rot, cadre: { x: 0, y: 0, l: 1, h: 1 } }, 900, false);
    c.className = 'mm-cadre-image'; zone.appendChild(c);
    var r = { x: p.cadre.x, y: p.cadre.y, l: p.cadre.l, h: p.cadre.h };
    if (r.l === 1 && r.h === 1) r = { x: 0.04, y: 0.04, l: 0.92, h: 0.92 };
    var cadre = el('div', 'mm-cadre-rect'); zone.appendChild(cadre);
    var coins = ['nw', 'ne', 'sw', 'se'].map(function (k) { var h = el('span', 'mm-cadre-coin mm-coin-' + k); h.dataset.coin = k; h.setAttribute('aria-hidden', 'true'); zone.appendChild(h); return h; });
    function placer() {
      cadre.style.left = r.x * 100 + '%'; cadre.style.top = r.y * 100 + '%'; cadre.style.width = r.l * 100 + '%'; cadre.style.height = r.h * 100 + '%';
      coins.forEach(function (h) { var k = h.dataset.coin; h.style.left = (k[1] === 'w' ? r.x : r.x + r.l) * 100 + '%'; h.style.top = (k[0] === 'n' ? r.y : r.y + r.h) * 100 + '%'; });
    }
    coins.forEach(function (h) {
      h.addEventListener('pointerdown', function (ev) {
        ev.preventDefault(); h.setPointerCapture(ev.pointerId);
        function bouger(m) {
          var b = zone.getBoundingClientRect(), x = Math.min(1, Math.max(0, (m.clientX - b.left) / b.width)), y = Math.min(1, Math.max(0, (m.clientY - b.top) / b.height));
          var k = h.dataset.coin, x2 = r.x + r.l, y2 = r.y + r.h, MIN = 0.1;
          if (k[1] === 'w') { r.x = Math.min(x, x2 - MIN); r.l = x2 - r.x; } else { r.l = Math.max(MIN, x - r.x); }
          if (k[0] === 'n') { r.y = Math.min(y, y2 - MIN); r.h = y2 - r.y; } else { r.h = Math.max(MIN, y - r.y); }
          placer();
        }
        function lacher() { h.removeEventListener('pointermove', bouger); h.removeEventListener('pointerup', lacher); }
        h.addEventListener('pointermove', bouger); h.addEventListener('pointerup', lacher);
      });
    });
    function fermer() { try { d.close(); } catch (e) {} d.remove(); }
    d.querySelector('.mm-fermer').onclick = fermer;
    d.querySelector('[data-tout]').onclick = function () { p.cadre = { x: 0, y: 0, l: 1, h: 1 }; fermer(); fin(); };
    d.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); p.cadre = r; fermer(); fin(); });
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    placer();
  }

  /* -- Traitement d'image ---------------------------------------------------- */
  function charger(f) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error('image')); };
      img.src = url;
    });
  }
  // Rotation → recadrage → mise à l'échelle → mode document.
  function rendre(p, cote, modeDoc) {
    var iw = p.img.naturalWidth || p.img.width, ih = p.img.naturalHeight || p.img.height, quart = p.rot % 180 !== 0;
    var rw = quart ? ih : iw, rh = quart ? iw : ih;
    var sx = p.cadre.x * rw, sy = p.cadre.y * rh, sw = p.cadre.l * rw, sh = p.cadre.h * rh;
    var k = Math.min(1, cote / Math.max(sw, sh)), cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch);
    x.save(); x.scale(k, k); x.translate(-sx, -sy);
    x.translate(rw / 2, rh / 2); x.rotate(p.rot * Math.PI / 180); x.drawImage(p.img, -iw / 2, -ih / 2);
    x.restore();
    if (modeDoc) documentLisible(x, cw, ch);
    return c;
  }
  // Niveaux de gris + étirement du contraste entre les centiles 2 et 98.
  function documentLisible(x, w, h) {
    var im = x.getImageData(0, 0, w, h), px = im.data, n = w * h, hist = new Uint32Array(256), i, v;
    for (i = 0; i < px.length; i += 4) { v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0; px[i] = v; hist[v]++; }
    var bas = 0, haut = 255, cum = 0;
    for (i = 0; i < 256; i++) { cum += hist[i]; if (cum >= n * 0.02) { bas = i; break; } }
    cum = 0;
    for (i = 255; i >= 0; i--) { cum += hist[i]; if (cum >= n * 0.02) { haut = i; break; } }
    if (haut - bas < 30) { bas = 0; haut = 255; }
    var lut = new Uint8ClampedArray(256);
    for (i = 0; i < 256; i++) { var t = (i - bas) / (haut - bas); lut[i] = 255 * Math.pow(Math.min(1, Math.max(0, t)), 0.9); }
    for (i = 0; i < px.length; i += 4) { v = lut[px[i]]; px[i] = px[i + 1] = px[i + 2] = v; }
    x.putImageData(im, 0, 0);
  }
  function jpeg(canvas, q) {
    return new Promise(function (ok, ko) {
      canvas.toBlob(function (b) {
        if (!b) return ko(new Error('Conversion de l\'image impossible sur cet appareil.'));
        b.arrayBuffer().then(function (buf) { ok({ octets: new Uint8Array(buf), l: canvas.width, h: canvas.height }); }, ko);
      }, 'image/jpeg', Math.max(0.4, q));
    });
  }

  /* -- Écriture du PDF (images JPEG, une page par image, largeur A4) ---------- */
  function construirePdf(images) {
    var morceaux = [], decalages = [], pos = 0, enc = new TextEncoder();
    function txt(s) { var b = enc.encode(s); morceaux.push(b); pos += b.length; }
    function bin(b) { morceaux.push(b); pos += b.length; }
    function objet(n, corps) { decalages[n] = pos; txt(n + ' 0 obj\n' + corps + '\nendobj\n'); }
    var nb = images.length, kids = [];
    for (var i = 0; i < nb; i++) kids.push((3 + i * 3) + ' 0 R');
    txt('%PDF-1.4\n%âãÏÓ\n');
    objet(1, '<< /Type /Catalog /Pages 2 0 R >>');
    objet(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + nb + ' >>');
    images.forEach(function (im, i) {
      var pg = 3 + i * 3, xo = pg + 1, ct = pg + 2, H = Math.round(A4_L * im.h / im.l * 100) / 100, flux = 'q ' + A4_L + ' 0 0 ' + H + ' 0 0 cm /Im' + i + ' Do Q';
      objet(pg, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4_L + ' ' + H + '] /Resources << /XObject << /Im' + i + ' ' + xo + ' 0 R >> >> /Contents ' + ct + ' 0 R >>');
      decalages[xo] = pos;
      txt(xo + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.l + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.octets.length + ' >>\nstream\n');
      bin(im.octets); txt('\nendstream\nendobj\n');
      objet(ct, '<< /Length ' + flux.length + ' >>\nstream\n' + flux + '\nendstream');
    });
    var total = 3 + nb * 3, xref = pos;
    txt('xref\n0 ' + total + '\n0000000000 65535 f \n');
    for (var j = 1; j < total; j++) txt(String(decalages[j]).padStart(10, '0') + ' 00000 n \n');
    txt('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(morceaux, { type: 'application/pdf' });
  }

  g.MOTO_SCAN = { champ: champ, brancher: brancher, fichier: fichier, construirePdf: construirePdf, rendre: rendre };
})(window);
