#!/usr/bin/env node
/**
 * AFLP FIELD PROOF 1.2.0 — recette navigateur : rafale et appareil photo du téléphone.
 *
 * Réel : pages et scripts fieldproof/* tels que servis, caméra factice de Chromium,
 * IndexedDB, canvas, lecture EXIF. Substitué : auth-gate (profil FICTIF), SDK
 * Supabase (villages fictifs), polices, et — pour les cas « caméra refusée » —
 * l'autorisation caméra (retirée du contexte) ou getUserMedia (bloqué).
 * L'APK est SIMULÉ par window.ANAGROCI_NATIVE ; ce test ne remplace pas un essai
 * sur un vrai téléphone avec l'APK.
 *
 * Usage : CHROMIUM=/usr/bin/google-chrome node tests/fieldproof/e2e/rafale-repli-e2e.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = normalize(join(ICI, '..', '..', '..'));
const SORTIE = process.env.FP_PREUVES || join(RACINE, 'tests', 'fieldproof', 'resultats', 'rafale-repli');
mkdirSync(SORTIE, { recursive: true });
const PORT = Number(process.env.PORT_FP_RAFALE || 4393), BASE = `http://127.0.0.1:${PORT}`;
const LARGEURS = { mobile: { width: 390, height: 844 }, tablette: { width: 768, height: 1024 }, bureau: { width: 1440, height: 900 } };
const GPS = { latitude: 7.5, longitude: -5.0, accuracy: 12 };     // coordonnée FICTIVE ronde
const DOUBLURE_AUTH = readFileSync(join(ICI, 'doublures', 'auth-gate.js'));
const DOUBLURE_SUPA = readFileSync(join(ICI, 'doublures', 'supabase.js'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg' };
const serveur = createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, BASE).pathname);
  if (chemin === '/shared/auth-gate.js') { res.writeHead(200, { 'content-type': TYPES['.js'] }); return res.end(DOUBLURE_AUTH); }
  let f = normalize(join(RACINE, chemin)); if (!f.startsWith(RACINE)) { res.writeHead(403); return res.end(); }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404); return res.end('introuvable'); }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f));
});
await new Promise(ok => serveur.listen(PORT, '127.0.0.1', ok));
const navigateur = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
});

const R = [], CONSOLE = [];
function noter(id, scenario, ok, obtenu, preuve) { R.push({ id, scenario, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', obtenu: String(obtenu).slice(0, 400), preuve: preuve || '' }); console.log(`${ok ? '✓' : '✗'} ${id} ${scenario} — ${String(obtenu).slice(0, 200)}`); }
async function etape(id, scenario, f) {
  try { const r = await f(); noter(id, scenario, r.ok, r.obtenu, r.preuve); }
  catch (e) { let p = ''; try { if (globalThis.__page) { p = join(SORTIE, `echec-${id}.png`); await globalThis.__page.screenshot({ path: p, fullPage: true }); } } catch {} noter(id, scenario, false, 'exception : ' + (e && e.message || e), p); }
}
const attendre = ms => new Promise(ok => setTimeout(ok, ms));
async function contexte(opts = {}) {
  const ctx = await navigateur.newContext({ viewport: opts.viewport || LARGEURS.mobile, acceptDownloads: true, serviceWorkers: 'block', locale: 'fr-FR', timezoneId: 'Africa/Abidjan',
    permissions: opts.permissions || ['geolocation', 'camera', 'microphone'], geolocation: GPS });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: DOUBLURE_SUPA }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/nominatim\.openstreetmap\.org/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"address":{"village":"Localité Fictive OSM"}}' }));
  if (opts.init) await ctx.addInitScript(opts.init.f, opts.init.arg);
  return ctx;
}
async function nouvellePage(ctx) {
  const p = await ctx.newPage(); globalThis.__page = p;
  p.on('console', m => { if (m.type() === 'error') CONSOLE.push(m.text()); });
  p.on('pageerror', e => CONSOLE.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  return p;
}
const registre = (page, mid) => page.evaluate(mid => FP_STORE.medias(mid), mid);
async function creerMission(page) {
  await page.goto(BASE + '/fieldproof/index.html#nouvelle');
  await page.waitForSelector('#fpCluster');
  await page.selectOption('#fpCluster', 'Botro');
  await page.selectOption('#fpVillage', { label: 'Village Fictif Alpha' });
  await page.selectOption('#fpActivite', 'Formation des producteurs');
  await page.click('button[type=submit]');
  await page.waitForURL(/#mission\/FP-/);
  return page.url().split('#mission/')[1];
}
/* JPEG FICTIF fabriqué dans la page : mire + EXIF (date de prise de vue = il y a `ageMin` min ; sans EXIF si ageMin === null). */
async function jpeg(page, ageMin, couleur = '#3a7') {
  const b64 = await page.evaluate(([ageMin, couleur]) => new Promise(ok => {
    const cv = document.createElement('canvas'); cv.width = 800; cv.height = 600; const g = cv.getContext('2d');
    g.fillStyle = couleur; g.fillRect(0, 0, 800, 600); g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText('PHOTO FICTIVE', 200, 300);
    cv.toBlob(b => b.arrayBuffer().then(buf => {
      let u = new Uint8Array(buf);
      if (ageMin !== null) u = FP_CORE.insererExif(u, FP_CORE.segmentExif({ date: new Date(Date.now() - ageMin * 60000).toISOString(), artiste: 'Appareil fictif' }));
      let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); ok(btoa(s));
    }), 'image/jpeg', 0.85);
  }), [ageMin, couleur]);
  return Buffer.from(b64, 'base64');
}
async function ouvrirCapture(page, mid) {
  await page.goto(BASE + `/fieldproof/index.html#capture/${mid}/PHOTO`);
  await page.waitForSelector('#fpDeclencheur', { timeout: 20000 });
}

/* ============================================================================ */
const ctx = await contexte(); const page = await nouvellePage(ctx);
await page.goto(BASE + '/fieldproof/index.html'); await page.waitForSelector('text=Préparation du téléphone', { timeout: 20000 });
const MID = await creerMission(page);

await etape('R01', 'Rafale activée par défaut : 8 appuis rapides → 8 photos enregistrées, sans écran de validation', async () => {
  await ouvrirCapture(page, MID);
  await page.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  const coche = await page.isChecked('#fpRafale');
  for (let i = 0; i < 8; i++) { await page.click('#fpDeclencheur'); await attendre(150); }
  await page.waitForFunction(() => document.querySelector('#fpSerieNb') && document.querySelector('#fpSerieNb').textContent === '8' && !/en cours/.test(document.querySelector('#fpSerieEtat').textContent), null, { timeout: 30000 });
  const l = (await registre(page, MID)).filter(x => x.type === 'PHOTO');
  const ids = l.map(x => x.id).sort(), uniques = new Set(ids).size;
  const revue = await page.$('[data-valider]');
  const vig = await page.$$eval('#fpSerieVig img', x => x.length);
  const p = join(SORTIE, 'rafale-mobile.png'); await page.screenshot({ path: p, fullPage: true });
  return { ok: coche && l.length === 8 && uniques === 8 && !revue && vig === 8 && l.every(x => x.local === 'VERIFIE' && /^[0-9a-f]{64}$/.test(x.sha256) && x.source === 'CAMERA_INTEGREE'),
    obtenu: `case rafale cochée : ${coche} · ${l.length} photos, ${uniques} identifiants uniques (${ids[0]} … ${ids[ids.length - 1]}) · écran de validation : ${!!revue} · vignettes : ${vig}`, preuve: p };
});

await etape('R02', 'Compteur de mission à jour (8 photos) après la rafale', async () => {
  const m = await page.evaluate(mid => FP_STORE.mission(mid), MID);
  return { ok: m.nbPhotos === 8, obtenu: `nbPhotos = ${m.nbPhotos}` };
});

await etape('R03', 'Sans limite : après P99, la photo suivante est P100 (aucun écrasement)', async () => {
  const mid = await creerMission(page);
  await page.evaluate(mid => FP_STORE.enregistrerMedia({ id: mid + '-P99', missionId: mid, type: 'PHOTO', statut: 'FINAL', debut: new Date().toISOString(), mime: 'image/jpeg', taille: 1, sha256: '0'.repeat(64), local: 'VERIFIE' }), mid);
  await ouvrirCapture(page, mid); await page.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  await page.click('#fpDeclencheur'); await attendre(200); await page.click('#fpDeclencheur');
  await page.waitForFunction(() => document.querySelector('#fpSerieNb').textContent === '2' && !/en cours/.test(document.querySelector('#fpSerieEtat').textContent), null, { timeout: 20000 });
  const ids = (await registre(page, mid)).map(x => x.id).sort();
  return { ok: ids.length === 3 && ids.some(i => i.endsWith('-P100')) && ids.some(i => i.endsWith('-P101')) && ids.some(i => i.endsWith('-P99')), obtenu: ids.map(i => i.slice(-5)).join(', ') };
});

await etape('R04', 'Rafale désactivable : l\'écran « Vérifiez la photo » revient', async () => {
  await ouvrirCapture(page, MID); await page.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  await page.uncheck('#fpRafale'); await page.click('#fpDeclencheur');
  await page.waitForSelector('[data-valider]', { timeout: 15000 });
  await page.click('[data-valider]'); await page.waitForSelector('.fp-revue-ok', { timeout: 20000 });
  const n = (await registre(page, MID)).length;
  await page.check('#fpRafale');
  return { ok: n === 9, obtenu: `écran de validation affiché puis validé · ${n} photos` };
});

await etape('R05', 'Bouton « Prendre les photos autrement » : panneau appareil photo du téléphone, sans réglage demandé', async () => {
  await page.click('#fpAutreMoyen');
  const t = await page.textContent('#fpRepli');
  const direct = await page.isVisible('#fpRepliDirect'), imp = await page.isVisible('#fpRepliImport');
  const capture = await page.getAttribute('#fpFichierCamera', 'capture'), multiple = await page.getAttribute('#fpFichierImport', 'multiple');
  return { ok: direct && imp && capture === 'environment' && multiple !== null && !/[Rr]églages|[Pp]aramètres/.test(t.replace('Aucun réglage', '')), obtenu: `prendre : ${direct} (capture=${capture}) · ajouter plusieurs : ${imp} (multiple) · « ${t.replace(/\s+/g, ' ').slice(0, 120)}… »` };
});

await etape('R06', 'Import de 3 photos récentes (EXIF < 30 min) → 3 photos ajoutées, bandeau et mention « appareil photo du téléphone »', async () => {
  const f = [await jpeg(page, 2, '#286'), await jpeg(page, 10, '#468'), await jpeg(page, 25, '#642')];
  const avant = (await registre(page, MID)).length;
  await page.setInputFiles('#fpFichierImport', f.map((b, i) => ({ name: `IMG_FICTIVE_${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: b })));
  await page.waitForFunction(n => document.querySelector('#fpSerieNb') && +document.querySelector('#fpSerieNb').textContent >= n && !/en cours/.test(document.querySelector('#fpSerieEtat').textContent), 3, { timeout: 30000 });
  await attendre(500);
  const l = (await registre(page, MID)).filter(x => x.source === 'APPAREIL_TELEPHONE');
  const x = l[0];
  const buf = Buffer.from(await page.evaluate(id => FP_STORE.fichier(id).then(b => b.arrayBuffer()).then(a => { const u = new Uint8Array(a); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }), x.id), 'base64');
  const fic = join(SORTIE, x.id + '-import.jpg'); writeFileSync(fic, buf);
  let ocr = '';
  try { execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${fic}'); w,h=im.size; im.crop((0,int(h*0.6),w,h)).resize((w*2,int(h*0.8))).save('${fic}.bande.png')`]); ocr = execFileSync('tesseract', [fic + '.bande.png', '-', '-l', 'fra'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) { ocr = '(OCR indisponible)'; }
  const dims = execFileSync('python3', ['-c', `from PIL import Image; print(Image.open('${fic}').size)`]).toString().trim();
  return { ok: (await registre(page, MID)).length === avant + 3 && l.length === 3 && l.every(y => y.importeLe && y.origineCle && y.local === 'VERIFIE') && /Appareil photo du t[ée]l[ée]phone/i.test(ocr.replace(/\s+/g, ' ')),
    obtenu: `${l.length} photos importées (${l.map(y => y.id.slice(-3)).join(', ')}) · fichier ${dims} · OCR bandeau : « ${(ocr.split('\n').find(s => /Appareil/i.test(s)) || ocr.slice(0, 80)).trim()} »`, preuve: fic };
});

await etape('R07', 'Anti-fraude : photo sans date (WhatsApp / capture d\'écran), photo de 2 h, et même photo réimportée → refusées', async () => {
  const neuve = await jpeg(page, 3, '#357');
  await page.setInputFiles('#fpFichierImport', [{ name: 'neuve.jpg', mimeType: 'image/jpeg', buffer: neuve }]);
  await page.waitForFunction(() => !/en cours/.test(document.querySelector('#fpSerieEtat').textContent), null, { timeout: 15000 }); await attendre(600);
  const avant = (await registre(page, MID)).length;
  await page.setInputFiles('#fpFichierImport', [
    { name: 'whatsapp.jpg', mimeType: 'image/jpeg', buffer: await jpeg(page, null) },
    { name: 'ancienne.jpg', mimeType: 'image/jpeg', buffer: await jpeg(page, 120) },
    { name: 'neuve-encore.jpg', mimeType: 'image/jpeg', buffer: neuve }]);
  await page.waitForFunction(() => /refusée/.test(document.querySelector('#fpAlerte').textContent), null, { timeout: 15000 });
  const t = await page.textContent('#fpAlerte'), apres = (await registre(page, MID)).length;
  const p = join(SORTIE, 'refus-anti-fraude-mobile.png'); await page.screenshot({ path: p, fullPage: true });
  return { ok: apres === avant && /3 photo\(s\) refusée/.test(t) && /sans date/.test(t) && /il y a 2 h/.test(t) && /déjà ajoutée/.test(t), obtenu: `${apres - avant} ajoutée · « ${t.trim().slice(0, 230)} »`, preuve: p };
});

await etape('R08', 'Export du dossier : manifeste avec capture_source (CAMERA_INTEGREE / APPAREIL_TELEPHONE)', async () => {
  const m = await page.evaluate(mid => FP_STORE.mission(mid), MID), l = await registre(page, MID);
  const csv = await page.evaluate(([m, l]) => FP_CORE.manifesteCsv(m, l), [m, l]);
  const n1 = (csv.match(/;APPAREIL_TELEPHONE;/g) || []).length, n2 = (csv.match(/;CAMERA_INTEGREE;/g) || []).length;
  return { ok: n1 === 4 && n2 === 9, obtenu: `APPAREIL_TELEPHONE : ${n1} · CAMERA_INTEGREE : ${n2}` };
});
await ctx.close();

/* -- Caméra refusée -------------------------------------------------------- */
async function casRefus(id, scenario, natif, attenduDirect) {
  await etape(id, scenario, async () => {
    /* Refus simulé au niveau de getUserMedia (Chromium accepte tout avec la caméra factice). */
    const c = await contexte({ init: { f: v => {
      if (v) window.ANAGROCI_NATIVE = { platform: 'android', version: v };
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    }, arg: natif } });
    const p = await nouvellePage(c);
    await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone', { timeout: 20000 });
    const mid = await creerMission(p); await ouvrirCapture(p, mid);
    await p.waitForSelector('#fpRepli:not([hidden])', { timeout: 25000 });
    const direct = await p.isVisible('#fpRepliDirect'), imp = await p.isVisible('#fpRepliImport');
    const a = await p.textContent('#fpAlerte');
    const preuve = join(SORTIE, `camera-refusee-${id}.png`); await p.screenshot({ path: preuve, fullPage: true });
    await c.close();
    return { ok: imp && direct === attenduDirect && !/réglages|Paramètres/.test(a), obtenu: `prendre une photo : ${direct} · ajouter les photos récentes : ${imp} · message « ${a.trim().slice(0, 140)} »`, preuve };
  });
}
await casRefus('R09', 'Navigateur, caméra refusée : panneau ouvert automatiquement, aucun renvoi vers les réglages', null, true);
await casRefus('R10', 'APK 1.3.1 simulé, caméra refusée : seul « ajouter les photos récentes » (le bouton direct ferait planter l\'ancien APK)', '1.3.1 (6)', false);
await casRefus('R11', 'APK 1.4.0 simulé, caméra refusée : les deux boutons', '1.4.0 (7)', true);

await etape('R12', 'Caméra qui ne répond jamais (WebView) : panneau proposé après 15 s au lieu d\'un écran figé', async () => {
  const c = await contexte({ init: { f: () => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => new Promise(() => {}); }, arg: null } });
  const p = await nouvellePage(c);
  await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone', { timeout: 20000 });
  const mid = await creerMission(p); const t0 = Date.now(); await ouvrirCapture(p, mid);
  await p.waitForSelector('#fpRepli:not([hidden])', { timeout: 30000 });
  const s = Math.round((Date.now() - t0) / 1000), msg = await p.textContent('#fpCamMsg');
  await c.close();
  return { ok: s >= 14 && s <= 25 && /ne répond pas/.test(msg), obtenu: `panneau après ${s} s · « ${msg} »` };
});

/* -- Trois largeurs -------------------------------------------------------- */
for (const [nom, vp] of Object.entries(LARGEURS)) {
  await etape('R13-' + nom, `Affichage ${vp.width}×${vp.height} : rafale + panneau, sans débordement horizontal`, async () => {
    const c = await contexte({ viewport: vp }); const p = await nouvellePage(c);
    await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone', { timeout: 20000 });
    const mid = await creerMission(p); await ouvrirCapture(p, mid); await p.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
    for (let i = 0; i < 3; i++) { await p.click('#fpDeclencheur'); await attendre(200); }
    await p.waitForFunction(() => document.querySelector('#fpSerieNb').textContent === '3', null, { timeout: 20000 });
    await p.click('#fpAutreMoyen'); await attendre(400);
    const deb = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const preuve = join(SORTIE, `capture-${nom}.png`); await p.screenshot({ path: preuve, fullPage: true });
    await c.close();
    return { ok: deb <= 1, obtenu: `débordement : ${deb} px`, preuve };
  });
}

await etape('R14', 'Aucune erreur JavaScript sur l\'ensemble des parcours', async () => {
  const utiles = CONSOLE.filter(m => !/favicon|Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m));
  return { ok: utiles.length === 0, obtenu: utiles.length ? utiles.slice(0, 3).join(' || ') : '0 erreur' };
});

await navigateur.close(); serveur.close();
writeFileSync(join(SORTIE, 'resultats.json'), JSON.stringify({ date: new Date().toISOString(), resultats: R }, null, 2));
const ko = R.filter(r => r.resultat !== 'RÉUSSI').length;
console.log(`\n${R.length - ko}/${R.length} réussis. Preuves : ${SORTIE}`);
process.exit(ko ? 1 : 0);
