// Banc d'essai de la lecture gratuite du compteur (moto/moto-ocr.js) sur des
// images SYNTHÉTIQUES (aucune photo réelle) : polices, polarités, bruit, flou,
// rotation, reflet. Mesure : lecture juste, lecture FAUSSE proposée, abstention.
// Usage : node tests/moto/ocr/banc_ocr.mjs [n]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const ici = path.dirname(url.fileURLToPath(import.meta.url));
const ocr = fs.readFileSync(path.join(ici, '../../../moto/moto-ocr.js'), 'utf8');
const N = Number(process.argv[2] || 400); const DUR = process.argv[3] === 'difficile' ? 1 : 0;
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent('<html><body></body></html>');
await p.addScriptTag({ content: ocr });
const r = await p.evaluate(([N, DUR]) => {
  let graine = 7; const rnd = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  const polices = ['bold 54px sans-serif', 'bold 54px monospace', '54px monospace', 'bold 54px serif', '600 54px sans-serif'];
  const stats = { juste: 0, faux: 0, abstention: 0, parType: {} , faux_ex: [] };
  function seg(ctx, ch, x, y, w, h) {
    const S = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' }[ch];
    const e = Math.max(3, w * 0.17), H = h, W = w;
    const s = { a: [x, y, W, e], g: [x, y + H / 2 - e / 2, W, e], d: [x, y + H - e, W, e], f: [x, y, e, H / 2], b: [x + W - e, y, e, H / 2], e: [x, y + H / 2, e, H / 2], c: [x + W - e, y + H / 2, e, H / 2] };
    S.split('').forEach(k => { const q = s[k]; ctx.fillRect(q[0] + 1, q[1] + 1, q[2] - 2, q[3] - 2); });
  }
  for (let i = 0; i < N; i++) {
    const type = ['TAMBOUR', 'LCD', 'TAMBOUR_DIXIEMES'][i % 3];
    const dernier = Math.floor(rnd() * 40000) + 300, km = dernier + Math.floor(rnd() * 120);
    const nbChiffres = 5 + (type === 'TAMBOUR_DIXIEMES' ? 1 : 0);
    const txt = type === 'TAMBOUR_DIXIEMES' ? String(km).padStart(5, '0') + String(Math.floor(rnd() * 10)) : String(km).padStart(nbChiffres, '0');
    const attendu = type === 'TAMBOUR_DIXIEMES' ? km + Number(txt.slice(-1)) / 10 : km;
    const W = 420, H = 96, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    const sombre = type !== 'LCD';
    x.fillStyle = sombre ? `rgb(${20 + rnd() * 30},${20 + rnd() * 30},${20 + rnd() * 30})` : `rgb(${150 + rnd() * 60},${170 + rnd() * 50},${140 + rnd() * 40})`;
    x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H / 2); x.rotate((rnd() - 0.5) * (DUR ? 0.3 : 0.08)); x.translate(-W / 2, -H / 2);
    x.filter = `blur(${(rnd() * (DUR ? 3.2 : 1.4)).toFixed(2)}px)`;
    const pas = 330 / txt.length, x0 = 45 + (rnd() - 0.5) * 20;
    for (let k = 0; k < txt.length; k++) {
      const dix = type === 'TAMBOUR_DIXIEMES' && k === txt.length - 1;
      x.fillStyle = sombre ? (dix ? '#f2f2f2' : `rgb(${215 + rnd() * 40},${215 + rnd() * 40},${215 + rnd() * 40})`) : '#141414';
      if (sombre) { x.fillStyle = sombre ? '#000' : x.fillStyle; x.fillRect(x0 + k * pas - 4, 8, pas - 6, H - 16); x.fillStyle = dix ? '#eee' : '#ddd'; }
      if (type === 'LCD') seg(x, +txt[k], x0 + k * pas, 18, pas * 0.62, H - 36);
      else { x.font = polices[Math.floor(rnd() * polices.length)]; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(txt[k], x0 + k * pas + pas / 2 - 6, H / 2 + (rnd() - 0.5) * 6); }
    }
    x.restore(); x.filter = 'none';
    // reflet et bruit
    if (DUR && rnd() < 0.3) { x.fillStyle = 'rgba(0,0,0,0.85)'; x.fillRect(rnd() * W, 0, 18 + rnd() * 30, H); }
    if (rnd() < (DUR ? 0.8 : 0.4)) { const gr = x.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(rnd(), 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, W, H); }
    const im = x.getImageData(0, 0, W, H);
    for (let q = 0; q < im.data.length; q += 4) { const n = (rnd() - 0.5) * (DUR ? 110 : 40); im.data[q] += n; im.data[q + 1] += n; im.data[q + 2] += n; }
    const res = MOTO_OCR.lire(im, { dernierKm: dernier });
    const t = stats.parType[type] || (stats.parType[type] = { juste: 0, faux: 0, abstention: 0 });
    if (res.valeur == null) { stats.abstention++; t.abstention++; }
    else if (Math.abs(res.valeur - attendu) < 1e-6) { stats.juste++; t.juste++; }
    else { stats.faux++; t.faux++; if (stats.faux_ex.length < 8) stats.faux_ex.push({ type, attendu, lu: res.valeur, texte: res.texte }); }
  }
  return stats;
}, [N, DUR]);
await b.close();
const pc = (x) => (100 * x / N).toFixed(1) + ' %';
console.log(JSON.stringify(r.parType));
console.log(`SYNTHÉTIQUE${DUR ? ' DIFFICILE' : ''} n=${N} : juste ${pc(r.juste)} · FAUX proposé ${pc(r.faux)} · abstention ${pc(r.abstention)}`);
if (r.faux_ex.length) console.log('Exemples de lectures fausses :', JSON.stringify(r.faux_ex));
fs.mkdirSync(path.join(ici, '../resultats'), { recursive: true });
fs.writeFileSync(path.join(ici, DUR ? '../resultats/banc_ocr_synthetique_difficile.json' : '../resultats/banc_ocr_synthetique.json'), JSON.stringify({ n: N, ...r }, null, 1));
