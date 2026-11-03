/* ============================================================================
   AFLP FLEET — lecture du compteur sur la photo (moto/moto-ocr.js)
   ----------------------------------------------------------------------------
   LA MACHINE PROPOSE, L'AGENT CONFIRME. Gratuit, hors connexion, aucune
   dépendance, aucun envoi de la photo à un tiers.

   Principe (volontairement simple et vérifiable) :
     1. l'agent cadre les chiffres du compteur dans la bande de visée ;
     2. la bande est mise en niveaux de gris, seuillée (méthode d'Otsu), dans
        les deux polarités (chiffres clairs sur fond sombre : compteur à
        tambour ; chiffres sombres sur fond clair : afficheur) ;
     3. les chiffres sont isolés (composantes connexes regroupées par
        colonne : les segments d'un afficheur 7 segments forment un chiffre) ;
     4. chaque chiffre est comparé à des modèles dessinés au démarrage
        (plusieurs polices + 7 segments) par corrélation ;
     5. la valeur n'est PROPOSÉE que si chaque chiffre est reconnu avec une
        marge suffisante ET si elle est vraisemblable au regard du dernier
        relevé connu de la moto (jamais inférieure, pas d'écart démesuré).
   Sinon : aucune proposition, l'agent saisit le chiffre en lisant le compteur.
   Ce module ne décide de rien : le serveur contrôle tout (migration 8).
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MOTO_OCR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var GW = 12, GH = 20;                       // grille normalisée d'un chiffre
  var SEUIL_SCORE = 0.62, SEUIL_MARGE = 0.06;  // en deçà : chiffre incertain
  var ECART_MAX_KM = 1500;                    // au-delà du dernier relevé : invraisemblable
  var modeles = null;

  /* -- Modèles ------------------------------------------------------------- */
  function canvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function septSegments(ctx, chiffre, w, h) {
    var S = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' }[chiffre];
    var e = Math.max(2, Math.round(w * 0.16)), m = Math.round(w * 0.12), H = h - 2 * m, W = w - 2 * m;
    var seg = {
      a: [m, m, W, e], g: [m, m + H / 2 - e / 2, W, e], d: [m, m + H - e, W, e],
      f: [m, m, e, H / 2], b: [m + W - e, m, e, H / 2], e: [m, m + H / 2, e, H / 2], c: [m + W - e, m + H / 2, e, H / 2]
    };
    ctx.fillStyle = '#000';
    S.split('').forEach(function (k) { var r = seg[k]; ctx.fillRect(r[0], r[1], r[2], r[3]); });
  }
  function grille(data, w, h, x0, y0, bw, bh, fg) {
    // Densité de pixels « chiffre » par cellule de la grille GW × GH.
    var g = new Float32Array(GW * GH);
    for (var gy = 0; gy < GH; gy++) {
      for (var gx = 0; gx < GW; gx++) {
        var xa = x0 + Math.floor(gx * bw / GW), xb = x0 + Math.max(Math.floor((gx + 1) * bw / GW), Math.floor(gx * bw / GW) + 1);
        var ya = y0 + Math.floor(gy * bh / GH), yb = y0 + Math.max(Math.floor((gy + 1) * bh / GH), Math.floor(gy * bh / GH) + 1);
        var n = 0, t = 0;
        for (var y = ya; y < yb && y < h; y++) for (var x = xa; x < xb && x < w; x++) { t++; if (fg[y * w + x]) n++; }
        g[gy * GW + gx] = t ? n / t : 0;
      }
    }
    return normaliser(g);
  }
  function normaliser(g) {
    var m = 0, i; for (i = 0; i < g.length; i++) m += g[i]; m /= g.length;
    var s = 0; for (i = 0; i < g.length; i++) { g[i] -= m; s += g[i] * g[i]; }
    s = Math.sqrt(s) || 1; for (i = 0; i < g.length; i++) g[i] /= s;
    return g;
  }
  function correlation(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  function preparerModeles() {
    if (modeles) return modeles;
    modeles = [];
    var polices = ['bold 64px sans-serif', '64px sans-serif', 'bold 64px monospace', '64px monospace', 'bold 64px serif',
                   'bold 64px "DejaVu Sans Mono", monospace', '600 64px "IBM Plex Mono", monospace', 'bold 64px Arial, sans-serif',
                   'bold 64px "Arial Narrow", "Roboto Condensed", sans-serif'];
    for (var c = 0; c <= 9; c++) {
      polices.forEach(function (p) {
        var cv = canvas(60, 80), ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 60, 80); ctx.fillStyle = '#000'; ctx.font = p; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillText(String(c), 30, 42);
        var mod = depuisCanvas(cv);
        if (mod) modeles.push({ c: c, g: mod });
      });
      [[40, 70], [34, 70], [46, 70]].forEach(function (dim) {
        var cv = canvas(dim[0], dim[1]), ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim[0], dim[1]); septSegments(ctx, c, dim[0], dim[1]);
        var mod = depuisCanvas(cv);
        if (mod) modeles.push({ c: c, g: mod });
      });
    }
    return modeles;
  }
  function depuisCanvas(cv) {
    var w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data, fg = new Uint8Array(w * h);
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (d[(y * w + x) * 4] < 128) { fg[y * w + x] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    return grille(fg, w, h, x0, y0, x1 - x0 + 1, y1 - y0 + 1, fg);
  }

  /* -- Image → binaire --------------------------------------------------- */
  function niveauxGris(img) {
    var w = img.width, h = img.height, d = img.data, g = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
    return g;
  }
  function otsu(g) {
    var hist = new Array(256).fill(0), i; for (i = 0; i < g.length; i++) hist[g[i]]++;
    var total = g.length, sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = 0, seuil = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; var wF = total - wB; if (!wF) break;
      sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; seuil = i; }
    }
    return seuil;
  }
  function composantes(fg, w, h) {
    var lab = new Int32Array(w * h), boites = [], pile = [], n = 0;
    for (var s = 0; s < w * h; s++) {
      if (!fg[s] || lab[s]) continue;
      n++; var b = { x0: w, y0: h, x1: 0, y1: 0, px: 0 }; pile.push(s); lab[s] = n;
      while (pile.length) {
        var p = pile.pop(), x = p % w, y = (p - x) / w; b.px++;
        if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
        var v = [p - 1, p + 1, p - w, p + w];
        for (var k = 0; k < 4; k++) {
          var q = v[k]; if (q < 0 || q >= w * h) continue;
          if ((k === 0 && x === 0) || (k === 1 && x === w - 1)) continue;
          if (fg[q] && !lab[q]) { lab[q] = n; pile.push(q); }
        }
      }
      boites.push(b);
    }
    return boites;
  }
  /* Regroupe les morceaux d'un même chiffre (segments) par recouvrement de colonnes. */
  function regrouper(boites, w, h) {
    var hMin = h * 0.12;
    var b = boites.filter(function (x) {
      var bw = x.x1 - x.x0 + 1, bh = x.y1 - x.y0 + 1;
      if (x.px < 6) return false;                         // bruit
      if (bw > w * 0.5) return false;                     // cadre, reflet horizontal
      if (bh >= h * 0.97 && bw > w * 0.25) return false;  // bord
      return bh >= hMin || bw >= h * 0.12;
    }).sort(function (a, c) { return a.x0 - c.x0; });
    var g = [];
    b.forEach(function (x) {
      var der = g[g.length - 1];
      if (der && x.x0 <= der.x1 + Math.max(1, (der.x1 - der.x0) * 0.08)) {
        der.x0 = Math.min(der.x0, x.x0); der.x1 = Math.max(der.x1, x.x1); der.y0 = Math.min(der.y0, x.y0); der.y1 = Math.max(der.y1, x.y1); der.px += x.px;
      } else g.push({ x0: x.x0, y0: x.y0, x1: x.x1, y1: x.y1, px: x.px });
    });
    // Les chiffres d'un compteur ont tous la même hauteur : on garde les groupes proches de la
    // hauteur médiane des groupes significatifs (au moins 20 % de la bande).
    var hauts = g.map(function (x) { return x.y1 - x.y0 + 1; }).filter(function (v) { return v >= h * 0.2; }).sort(function (a, c) { return a - c; });
    var hMed = hauts[Math.floor(hauts.length / 2)] || 0;
    return g.filter(function (x) {
      var bh = x.y1 - x.y0 + 1, bw = x.x1 - x.x0 + 1;
      return bh >= Math.max(h * 0.2, hMed * 0.75) && bh <= hMed * 1.3 && bw / bh <= 1.0 && bw / bh >= 0.08;
    });
  }

  function lirePolarite(gris, w, h, seuil, clair) {
    var fg = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) fg[i] = clair ? (gris[i] > seuil ? 1 : 0) : (gris[i] <= seuil ? 1 : 0);
    var chiffres = regrouper(composantes(fg, w, h), w, h);
    if (!chiffres.length || chiffres.length > 9) return null;
    var M = preparerModeles();
    var lus = chiffres.map(function (b) {
      var bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, x0 = b.x0, gw = bw;
      // « 1 » étroit : centré dans une boîte de proportion standard pour ne pas l'étirer.
      if (bw / bh < 0.32) { gw = Math.round(bh * 0.55); x0 = Math.max(0, b.x0 - Math.round((gw - bw) / 2)); }
      var gr = grille(fg, w, h, x0, b.y0, gw, bh, fg);
      var meilleur = {}, k;
      for (k = 0; k < M.length; k++) {
        var s = correlation(gr, M[k].g);
        if (meilleur[M[k].c] === undefined || s > meilleur[M[k].c]) meilleur[M[k].c] = s;
      }
      var classe = Object.keys(meilleur).map(function (c) { return { c: +c, s: meilleur[c] }; }).sort(function (a, c) { return c.s - a.s; });
      return { c: classe[0].c, score: classe[0].s, marge: classe[0].s - classe[1].s, second: classe[1].c };
    });
    var qualite = lus.reduce(function (a, x) { return a + x.score; }, 0) / lus.length;
    return { chiffres: lus, qualite: qualite };
  }

  /* Interprétations possibles d'une suite de chiffres (tambour avec dixièmes). */
  function interpretations(texte) {
    var v = [];
    if (texte.length) v.push(parseInt(texte, 10));
    if (texte.length >= 2) v.push(parseInt(texte.slice(0, -1), 10) + parseInt(texte.slice(-1), 10) / 10);
    return v;
  }
  function vraisemblable(v, dernier) {
    if (!(v >= 0) || !isFinite(v)) return false;
    if (dernier == null) return true;
    return v >= dernier && v - dernier <= ECART_MAX_KM;
  }

  /* imageData : la bande cadrée. opts : { dernierKm }.
     Renvoie { valeur|null, texte, confiance, raison, chiffres }. */
  function lire(imageData, opts) {
    opts = opts || {};
    var w = imageData.width, h = imageData.height;
    if (!w || !h) return { valeur: null, raison: 'IMAGE_VIDE', texte: '' };
    var gris = niveauxGris(imageData), seuil = otsu(gris);
    var essais = [lirePolarite(gris, w, h, seuil, true), lirePolarite(gris, w, h, seuil, false)].filter(Boolean)
      .sort(function (a, b) { return b.qualite - a.qualite; });
    if (!essais.length) return { valeur: null, raison: 'AUCUN_CHIFFRE', texte: '' };
    var dernier = opts.dernierKm == null || opts.dernierKm === '' ? null : Number(opts.dernierKm);
    for (var i = 0; i < essais.length; i++) {
      var e = essais[i], texte = e.chiffres.map(function (x) { return x.c; }).join('');
      var douteux = e.chiffres.filter(function (x) { return x.score < SEUIL_SCORE || x.marge < SEUIL_MARGE; });
      var cands = interpretations(texte).filter(function (v) { return vraisemblable(v, dernier); });
      if (douteux.length) { if (i === essais.length - 1) return { valeur: null, raison: 'CHIFFRE_INCERTAIN', texte: texte, chiffres: e.chiffres, confiance: e.qualite }; continue; }
      if (!cands.length) { if (i === essais.length - 1) return { valeur: null, raison: 'INVRAISEMBLABLE', texte: texte, chiffres: e.chiffres, confiance: e.qualite }; continue; }
      // Plusieurs lectures vraisemblables : la plus proche du dernier relevé.
      cands.sort(function (a, b) { return dernier == null ? 0 : (a - dernier) - (b - dernier); });
      return { valeur: cands[0], raison: 'LU', texte: texte, chiffres: e.chiffres, confiance: e.qualite };
    }
    return { valeur: null, raison: 'AUCUN_CHIFFRE', texte: '' };
  }

  return { lire: lire, preparerModeles: preparerModeles, _interne: { otsu: otsu, interpretations: interpretations, vraisemblable: vraisemblable },
           SEUIL_SCORE: SEUIL_SCORE, SEUIL_MARGE: SEUIL_MARGE, ECART_MAX_KM: ECART_MAX_KM };
});
