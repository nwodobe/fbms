#!/usr/bin/env node
/**
 * AFLP FIELD PROOF — recette de bout en bout dans un VRAI navigateur (Chromium).
 *
 * Ce qui est réel : les pages et scripts fieldproof/* servis tels quels, la
 * caméra et le micro SIMULÉS par Chromium (--use-fake-device-for-media-stream :
 * mire animée + bip sonore), la géolocalisation émulée, IndexedDB, MediaRecorder,
 * le canvas, les téléchargements. Les fichiers produits sont ensuite contrôlés
 * HORS du navigateur (ffprobe, ffmpeg, Python/PIL, unzip, sha256).
 *
 * Ce qui est substitué : shared/auth-gate.js (profil FICTIF, même contrat
 * public), le SDK Supabase (table villages fictive, lecture seule) et les polices.
 * Ce test NE remplace PAS un essai sur téléphone Android et iPhone réels.
 *
 * Prérequis : npm install --no-save playwright@1.49.1 ; ffmpeg/ffprobe ; python3 + Pillow ; unzip.
 * Usage     : CHROMIUM=/usr/bin/google-chrome node tests/fieldproof/e2e/fieldproof-e2e.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = normalize(join(ICI, '..', '..', '..'));
const SORTIE = join(RACINE, 'tests', 'fieldproof', 'resultats');
const CAPTURES = join(SORTIE, 'captures'), FICHIERS = join(SORTIE, 'fichiers');
rmSync(FICHIERS, { recursive: true, force: true });
mkdirSync(CAPTURES, { recursive: true }); mkdirSync(FICHIERS, { recursive: true });
const PORT = Number(process.env.PORT_FP_E2E || 4391), BASE = `http://127.0.0.1:${PORT}`;
const LARGEURS = { mobile: { width: 390, height: 844 }, tablette: { width: 768, height: 1024 }, bureau: { width: 1440, height: 900 } };
const GPS = { latitude: 7.5, longitude: -5.0, accuracy: 12 };           // coordonnée FICTIVE ronde, aucune parcelle
const DOUBLURE_AUTH = readFileSync(join(ICI, 'doublures', 'auth-gate.js'));
const DOUBLURE_SUPA = readFileSync(join(ICI, 'doublures', 'supabase.js'));

/* -- Serveur statique (racine du dépôt), auth-gate remplacé par la doublure -- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg' };
const serveur = createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, BASE).pathname);
  if (chemin === '/shared/auth-gate.js') { res.writeHead(200, { 'content-type': TYPES['.js'] }); return res.end(DOUBLURE_AUTH); }
  let f = normalize(join(RACINE, chemin)); if (!f.startsWith(RACINE)) { res.writeHead(403); return res.end(); }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404); return res.end('introuvable'); }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f));
});
await new Promise(ok => serveur.listen(PORT, '127.0.0.1', ok));

/* -- Journal de recette ------------------------------------------------------ */
const R = [], CONSOLE = [], REQUETES_ECRITURE = [], OSM_APPELS = [], TELECHARGEMENTS = [];
function noter(id, scenario, ok, obtenu, preuve, nature = 'SIMULÉ (Chromium, caméra/micro factices)') {
  R.push({ id, scenario, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', obtenu: String(obtenu).slice(0, 400), preuve: preuve || '', nature });
  console.log(`${ok ? '✓' : '✗'} ${id} ${scenario} — ${String(obtenu).slice(0, 180)}`);
}
async function etape(id, scenario, f, nature) {
  try { const r = await f(); noter(id, scenario, r.ok, r.obtenu, r.preuve, nature); return r; }
  catch (e) {
    let preuve = '';
    try { if (globalThis.__page) { const p = join(CAPTURES, `echec-${id}.png`); await globalThis.__page.screenshot({ path: p, fullPage: true }); preuve = `tests/fieldproof/resultats/captures/echec-${id}.png`; } } catch {}
    noter(id, scenario, false, 'EXCEPTION : ' + String(e && e.message || e).split('\n')[0], preuve, nature); return { ok: false };
  }
}
const sha = b => createHash('sha256').update(b).digest('hex');
const py = code => execFileSync('python3', ['-c', code]).toString().trim();
const attendre = ms => new Promise(ok => setTimeout(ok, ms));

const navigateur = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
});
async function contexte(opts = {}) {
  const ctx = await navigateur.newContext({
    viewport: opts.viewport || LARGEURS.mobile, acceptDownloads: true, serviceWorkers: 'block', locale: 'fr-FR',
    permissions: opts.permissions || ['geolocation', 'camera', 'microphone'], geolocation: GPS
  });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: DOUBLURE_SUPA }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  /* Doublure OpenStreetMap : réponse Nominatim FICTIVE ; chaque appel est consigné pour contrôler ce qui est envoyé. */
  await ctx.route(/nominatim\.openstreetmap\.org/, r => { OSM_APPELS.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ address: { village: 'Localité Fictive OSM', county: 'Sous-préfecture Fictive' } }) }); });
  if (opts.init) await ctx.addInitScript(opts.init);
  return ctx;
}
async function nouvellePage(ctx) {
  const p = await ctx.newPage(); globalThis.__page = p;
  p.on('console', m => { if (m.type() === 'error') CONSOLE.push(m.text()); });
  p.on('pageerror', e => CONSOLE.push('pageerror: ' + e.message));
  p.on('request', q => { if (q.method() !== 'GET') REQUETES_ECRITURE.push(q.method() + ' ' + q.url()); });
  p.on('dialog', d => d.accept());
  p.on('download', d => TELECHARGEMENTS.push(d));
  return p;
}
/* Lecture, depuis la page, d'un fichier conservé dans IndexedDB. */
async function lireFichier(page, id) {
  const b64 = await page.evaluate(id => new Promise((ok, ko) => {
    FP_STORE.fichier(id).then(b => { if (!b) return ok(null); const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(b); });
  }), id);
  return b64 ? Buffer.from(b64, 'base64') : null;
}
const registre = (page, mid) => page.evaluate(mid => FP_STORE.medias(mid), mid);
async function creerMission(page, village = 'Village Fictif Alpha', activite = 'Formation des producteurs') {
  await page.goto(BASE + '/fieldproof/index.html#nouvelle');
  await page.waitForSelector('#fpCluster');
  await page.selectOption('#fpCluster', 'Botro');
  await page.selectOption('#fpVillage', { label: village });
  await page.selectOption('#fpActivite', activite);
  await page.click('button[type=submit]');
  await page.waitForURL(/#mission\/FP-/);
  return page.url().split('#mission/')[1];
}
async function photo(page, mid) {
  await page.goto(BASE + `/fieldproof/index.html#capture/${mid}/PHOTO`);
  await page.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  await page.waitForFunction(() => /±|Sans GPS/.test(document.querySelector('#fpGps').textContent), null, { timeout: 15000 });
  await page.click('#fpDeclencheur');
  await page.waitForSelector('[data-valider]', { timeout: 15000 });
  await page.click('[data-valider]');
  await page.waitForSelector('.fp-revue-ok', { timeout: 20000 });
}
async function video(page, mid, ms) {
  await page.goto(BASE + `/fieldproof/index.html#capture/${mid}/VIDEO`);
  await page.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  await page.waitForFunction(() => /±|Sans GPS/.test(document.querySelector('#fpGps').textContent), null, { timeout: 15000 });
  await page.click('#fpDeclencheur');
  await page.waitForSelector('#fpDeclencheur.fp-en-cours', { timeout: 10000 });
  await attendre(ms);
  await page.click('#fpDeclencheur');
  await page.waitForSelector('[data-valider]', { timeout: 30000 });
  await page.click('[data-valider]');
  await page.waitForSelector('.fp-revue-ok', { timeout: 30000 });
}
/* Pixel moyen d'une zone, mesuré par PIL sur le fichier produit. */
function zone(fichier, x0, y0, x1, y1) {
  return JSON.parse(py(`from PIL import Image; import json
im=Image.open('${fichier}').convert('RGB'); c=im.crop((${x0},${y0},${x1},${y1})); px=list(c.getdata()); n=len(px)
print(json.dumps([round(sum(p[i] for p in px)/n) for i in range(3)]))`));
}
const estBandeau = rgb => rgb[1] > rgb[0] && rgb[1] > rgb[2] && rgb[0] < 60 && rgb[1] < 110;   // vert forêt #053B23 → #0A4A2C
function ffprobe(f) { return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString()); }
function imageVideo(f, t, sortie) { execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', f, '-frames:v', '1', sortie]); return sortie; }

/* ============================================================================ */
const ctx = await contexte();
const page = await nouvellePage(ctx);
let MID = null, medias = [];

await etape('T00', 'Ouverture du module, identité reprise de FBMS, villages du périmètre préparés', async () => {
  await page.goto(BASE + '/fieldproof/index.html');
  await page.waitForSelector('text=Préparation du téléphone');
  const t = await page.textContent('#fpVue'); const qui = await page.textContent('#fpQui');
  return { ok: /2 village\(s\) de votre périmètre/.test(t) && /2 village\(s\) géolocalisé\(s\) et 1 hub\(s\) de la carte FBMS/.test(t) && /AGENT FICTIF E2E/.test(qui), obtenu: (t.match(/\d+ village\(s\)[^(]*/) || ['?'])[0] + ' | ' + (t.match(/\d+ village\(s\) géolocalisé[^:]*/) || ['?'])[0] + ' | ' + qui + ' (Diabo exclu : hors périmètre Botro)' };
});

await etape('T01', 'Création d\'une mission HORS LIGNE (cluster, village, activité ; rien de prérempli)', async () => {
  await ctx.setOffline(true);
  await page.goto(BASE + '/fieldproof/index.html#nouvelle');
  await page.waitForSelector('#fpActivite');
  const vide = await page.$eval('#fpActivite', s => s.value === '' && s.options[0].value === '');
  const reseau = await page.textContent('#fpReseau');
  MID = await creerMission(page);
  const m = await page.evaluate(id => FP_STORE.mission(id), MID);
  return { ok: vide && /Hors ligne/.test(reseau) && m && m.cluster === 'Botro' && m.village === 'Village Fictif Alpha' && m.agent === 'AGENT FICTIF E2E', obtenu: `${MID} · réseau « ${reseau} » · activité non présélectionnée : ${vide}` };
});

await etape('T02', 'Capture de plusieurs photos (hors ligne), bandeau ajouté sous l\'image', async () => {
  await photo(page, MID); await page.click('[data-continuer]');
  await photo(page, MID);
  const l = (await registre(page, MID)).filter(x => x.type === 'PHOTO');
  return { ok: l.length === 2 && l.every(x => x.local === 'VERIFIE' && /^[0-9a-f]{64}$/.test(x.sha256)), obtenu: l.map(x => `${x.id} ${x.largeur}×${x.hauteur} ${x.taille} o`).join(' | ') };
});

await etape('T02b', 'Galerie AUTOMATIQUE dès « Valider » : fichier final remis au téléphone sans geste supplémentaire, statut « à vérifier »', async () => {
  const l = (await registre(page, MID)).filter(x => x.type === 'PHOTO');
  const noms = []; let identiques = 0;
  for (const d of TELECHARGEMENTS.slice(0, 2)) { const f = join(FICHIERS, 'auto-' + d.suggestedFilename()); await d.saveAs(f); noms.push(d.suggestedFilename()); if (l.some(x => x.sha256 === sha(readFileSync(f)))) identiques++; }
  const texte = await page.textContent('.fp-revue-ok');
  return { ok: TELECHARGEMENTS.length >= 2 && identiques === 2 && l.every(x => x.galerie === 'ENVOI_LANCE') && /album « Download »/.test(texte), obtenu: `${TELECHARGEMENTS.length} fichier(s) remis automatiquement · ${identiques}/2 identiques au registre · statuts ${l.map(x => x.galerie).join(',')} · ${noms.join(', ')}` };
}, 'SIMULÉ — Chromium : « galerie » = dossier Téléchargements (Android) ; iPhone : feuille « Enregistrer » non testable ici');

await etape('T03', 'Enregistrement de plusieurs vidéos (hors ligne)', async () => {
  await video(page, MID, 4200);
  await video(page, MID, 2200);
  const l = (await registre(page, MID)).filter(x => x.type === 'VIDEO');
  return { ok: l.length === 2 && l.every(x => x.statut === 'FINAL' && x.micro === true && x.dureeMs > 1500), obtenu: l.map(x => `${x.id} ${x.mime} ${Math.round(x.dureeMs / 100) / 10}s ${x.taille} o`).join(' | ') };
});

medias = await registre(page, MID);
for (const x of medias) { const b = await lireFichier(page, x.id); x.chemin = join(FICHIERS, x.id + '.' + (x.mime.includes('mp4') ? 'mp4' : x.mime.includes('webm') ? 'webm' : 'jpg')); writeFileSync(x.chemin, b); x.octets = b; }
const P1 = medias.find(x => x.type === 'PHOTO'), V1 = medias.find(x => x.type === 'VIDEO');

await etape('T04a', 'Photo : bandeau incrusté dans les PIXELS du fichier final (lu par PIL)', async () => {
  const dims = JSON.parse(py(`from PIL import Image; import json; im=Image.open('${P1.chemin}'); print(json.dumps(im.size))`));
  const bas = zone(P1.chemin, 0, dims[1] - 20, Math.round(dims[0] * 0.9), dims[1] - 4);
  const haut = zone(P1.chemin, 0, 0, dims[0], 40);
  return { ok: estBandeau(bas) && !estBandeau(haut) && dims[0] === P1.largeur && dims[1] === P1.hauteur, obtenu: `fichier ${dims.join('×')} · couleur bas ${bas} (bandeau) · couleur haut ${haut} (scène)`, preuve: 'tests/fieldproof/resultats/fichiers/' + P1.id + '.jpg' };
});
await etape('T04b', 'Photo : EXIF date, auteur et GPS relus hors navigateur ; empreinte identique au registre', async () => {
  const out = py(`from PIL import Image
im=Image.open('${P1.chemin}'); e=im.getexif(); g=e.get_ifd(0x8825)
lat=float(g[2][0])+float(g[2][1])/60+float(g[2][2])/3600; lon=float(g[4][0])+float(g[4][1])/60+float(g[4][2])/3600
print(e[0x013B]+'|'+g[1]+str(round(lat,4))+'|'+g[3]+str(round(lon,4))+'|'+e[0x0132])`);
  return { ok: out.startsWith('AGENT FICTIF E2E|N7.5|W5.0|') && sha(P1.octets) === P1.sha256, obtenu: out + ' · sha256 registre = fichier : ' + (sha(P1.octets) === P1.sha256) };
});
let PROBE;
await etape('T05', 'Vidéo lisible hors navigateur (ffprobe) : image + son, durée cohérente', async () => {
  PROBE = ffprobe(V1.chemin);
  const v = PROBE.streams.find(s => s.codec_type === 'video'), a = PROBE.streams.find(s => s.codec_type === 'audio');
  const d = parseFloat(PROBE.format.duration || v.duration || '0');
  return { ok: !!v && !!a && v.width === V1.largeur && v.height === V1.hauteur && (isNaN(d) || Math.abs(d - V1.dureeMs / 1000) < 1.5), obtenu: `${PROBE.format.format_name} · vidéo ${v && v.codec_name} ${v && v.width}×${v && v.height} · audio ${a ? a.codec_name : 'ABSENT'} · durée fichier ${d}s / registre ${V1.dureeMs / 1000}s`, preuve: 'tests/fieldproof/resultats/fichiers/' + V1.id + extname(V1.chemin) };
});
await etape('T06', 'Vidéo : bandeau incrusté sur les images décodées par ffmpeg (début ET fin), compteur qui évolue', async () => {
  const i1 = imageVideo(V1.chemin, 0.6, join(FICHIERS, 'v1-0.6s.png')), i2 = imageVideo(V1.chemin, Math.max(1.6, V1.dureeMs / 1000 - 0.6), join(FICHIERS, 'v1-fin.png'));
  const H = V1.hauteur, W = V1.largeur;
  const b1 = zone(i1, 0, H - 14, Math.round(W * 0.9), H - 3), b2 = zone(i2, 0, H - 14, Math.round(W * 0.9), H - 3);
  /* La ligne « Durée : 00:0x » change : les pixels du bandeau diffèrent entre les deux images. */
  const diff = py(`from PIL import Image, ImageChops
a=Image.open('${i1}').convert('L'); b=Image.open('${i2}').convert('L'); h=a.size[1]; w=a.size[0]
box=(0,h-${Math.round(H * 0.32)},w,h); d=ImageChops.difference(a.crop(box),b.crop(box)).getbbox(); print(d is not None)`);
  return { ok: estBandeau(b1) && estBandeau(b2) && diff === 'True', obtenu: `bandeau début ${b1} · bandeau fin ${b2} · zone texte modifiée entre les deux images : ${diff}`, preuve: 'tests/fieldproof/resultats/fichiers/v1-0.6s.png' };
});
function ocr(fichier, hauteurBandeau) {
  const crop = fichier.replace(/\.(jpg|png)$/, '-bandeau.png');
  py(`from PIL import Image, ImageOps
im=Image.open('${fichier}').convert('L'); w,h=im.size; b=im.crop((0,h-${hauteurBandeau},w,h)); b=ImageOps.invert(b).resize((w*2,${hauteurBandeau}*2)); b.save('${crop}')`);
  return execFileSync('tesseract', [crop, '-', '-l', 'fra', '--psm', '6']).toString();
}
await etape('T07b', 'HORS LIGNE : nom de la localité tiré des villages FBMS, inscrit dans les PIXELS de la photo (OCR Tesseract)', async () => {
  const loc = P1.localite || {};
  const texte = ocr(P1.chemin, 320);
  const lu = /Localit[ée] GPS ?: ?Village Fictif Alpha/i.test(texte.replace(/\s+/g, ' '));
  return { ok: loc.source === 'FBMS' && loc.nom === 'Village Fictif Alpha' && loc.conformite === 'CONFORME' && lu && OSM_APPELS.length === 0, obtenu: `registre : « ${loc.texte} » · OCR : « ${(texte.split('\n').find(x => /Localit/i.test(x)) || '?').trim()} » · appels OpenStreetMap hors ligne : ${OSM_APPELS.length}`, preuve: 'tests/fieldproof/resultats/fichiers/' + P1.id + '-bandeau.png' };
});
await etape('T07', 'GPS activé : position et précision enregistrées (photo) ; début ET fin (vidéo)', async () => {
  return { ok: P1.gpsDebut && Math.abs(P1.gpsDebut.lat - 7.5) < 1e-6 && P1.gpsDebut.precision === 12 && V1.gpsDebut && V1.gpsFin && V1.fin > V1.debut, obtenu: `photo ${P1.gpsDebut.lat},${P1.gpsDebut.lon} ±${P1.gpsDebut.precision} · vidéo début ${JSON.stringify(V1.gpsDebut && [V1.gpsDebut.lat, V1.gpsDebut.lon])} fin ${JSON.stringify(V1.gpsFin && [V1.gpsFin.lat, V1.gpsFin.lon])} · ${V1.debut} → ${V1.fin}` };
});

await etape('T08', 'Sans GPS (autorisation retirée) : capture autorisée, avertissement, statut LOCALISATION NON VÉRIFIÉE', async () => {
  await ctx.clearPermissions(); await ctx.grantPermissions(['camera', 'microphone']);
  await page.goto(BASE + `/fieldproof/index.html#capture/${MID}/PHOTO`);
  await page.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  await page.waitForFunction(() => /Sans GPS/.test(document.querySelector('#fpGps').textContent), null, { timeout: 35000 });
  const alerteTxt = await page.textContent('#fpAlerte'); const apercu = await page.textContent('#fpBandeauApercu');
  await page.click('#fpDeclencheur'); await page.waitForSelector('[data-valider]'); await page.click('[data-valider]'); await page.waitForSelector('.fp-revue-ok');
  const l = (await registre(page, MID)).filter(x => x.type === 'PHOTO');
  const p3 = l[l.length - 1];
  const b = await lireFichier(page, p3.id); const f = join(FICHIERS, p3.id + '-sans-gps.jpg'); writeFileSync(f, b);
  const gpsExif = py(`from PIL import Image; print(0x8825 in Image.open('${f}').getexif())`);
  await ctx.grantPermissions(['geolocation']);
  return { ok: p3.gpsDebut === null && /LOCALISATION NON VÉRIFIÉE/.test(apercu) && /Localisation refusée/.test(alerteTxt) && gpsExif === 'False', obtenu: `${p3.id} gps=${p3.gpsDebut} · alerte « ${alerteTxt.trim().slice(0, 70)}… » · bandeau « …${apercu.slice(apercu.indexOf('LOCALISATION'), apercu.indexOf('LOCALISATION') + 26)} » · EXIF GPS présent : ${gpsExif}`, preuve: 'tests/fieldproof/resultats/fichiers/' + p3.id + '-sans-gps.jpg' };
});

await etape('T09', 'Enregistrement « galerie » : téléchargement du fichier final identique, statut « à vérifier » puis confirmé par l\'agent', async () => {
  await page.goto(BASE + `/fieldproof/index.html#mission/${MID}`);
  await page.waitForSelector(`[data-galerie="${P1.id}"]`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-galerie="${P1.id}"]`)]);
  const f = join(FICHIERS, 'galerie-' + dl.suggestedFilename()); await dl.saveAs(f);
  await page.waitForSelector('text=Vérifiez votre galerie');
  const avant = (await page.evaluate(id => FP_STORE.media(id), P1.id)).galerie;
  await page.click('#fpDialogueCorps [data-confirmer-galerie]');
  await page.waitForFunction(id => FP_STORE.media(id).then(x => x.galerie === 'CONFIRME_AGENT'), P1.id);
  return { ok: sha(readFileSync(f)) === P1.sha256 && avant === 'ENVOI_LANCE' && /^AFLP_FP-\d{8}-[A-Z0-9]{6}-P01_BOTRO_VILLAGE-FICTIF-ALPHA_\d{8}-\d{6}\.jpg$/.test(dl.suggestedFilename()), obtenu: `${dl.suggestedFilename()} · empreinte identique · statut avant confirmation : ${avant}` };
}, 'SIMULÉ — sur Chromium bureau, « galerie » = dossier Téléchargements');

await etape('T10', 'Partage : jamais automatique ; repli « Télécharger » quand le partage de fichiers est indisponible', async () => {
  await page.goto(BASE + `/fieldproof/index.html#mission/${MID}`);
  await page.waitForSelector('.fp-coche');
  await page.check('#fpTout');
  await page.click('[data-partager-selection]');
  await page.waitForSelector('#fpDialogueCorps');
  const t = await page.textContent('#fpDialogueCorps');
  const partageNatif = await page.evaluate(() => !!(navigator.share && navigator.canShare));
  return { ok: /Document/.test(t) && (partageNatif ? /Ouvrir le partage/.test(t) : /Télécharger 5 fichier/.test(t)), obtenu: `partage natif disponible : ${partageNatif} · dialogue : « ${t.replace(/\s+/g, ' ').slice(0, 140)}… »` };
}, 'SIMULÉ — WhatsApp non testable hors téléphone');

let ZIP;
await etape('T11', 'Export du dossier HORS LIGNE : ZIP valide (unzip -t), 3 photos + 2 vidéos + manifestes, empreintes conformes', async () => {
  await page.click('#fpDialogueFermer').catch(() => {});
  await page.click(`[data-exporter="${MID}"]`);
  await page.waitForSelector('text=Export prêt', { timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-zip-dl="0"]')]);
  ZIP = join(FICHIERS, dl.suggestedFilename()); await dl.saveAs(ZIP);
  const test = execFileSync('unzip', ['-t', ZIP]).toString();
  const liste = execFileSync('unzip', ['-Z1', ZIP]).toString().trim().split('\n');
  const dir = join(FICHIERS, 'zip'); rmSync(dir, { recursive: true, force: true }); execFileSync('unzip', ['-q', ZIP, '-d', dir]);
  const man = JSON.parse(readFileSync(join(dir, 'manifeste.json'), 'utf8'));
  const conformes = man.medias.filter(l => sha(readFileSync(join(dir, 'medias', l.fichier))) === l.sha256).length;
  const csv = readFileSync(join(dir, 'manifeste.csv'), 'utf8').split('\r\n').filter(Boolean).length;
  return { ok: /No errors detected/.test(test) && liste.filter(n => n.startsWith('medias/')).length === 5 && conformes === 5 && csv === 6 && man.format === 'AFLP-FIELD-PROOF/1', obtenu: `${dl.suggestedFilename()} · ${statSync(ZIP).size} o · ${liste.length} entrées · ${conformes}/5 empreintes conformes · CSV ${csv - 1} lignes · ${test.trim().split('\n').pop()}` };
});

await etape('T12', 'Contrôle d\'un dossier reçu : ZIP conforme ; fichier altéré détecté « Modifié »', async () => {
  await page.goto(BASE + '/fieldproof/index.html#verifier');
  await page.setInputFiles('#fpVerifFichiers', ZIP);
  await page.waitForSelector('.fp-table', { timeout: 20000 });
  const ok1 = await page.$$eval('.fp-table tbody tr', l => l.map(r => r.children[1].textContent));
  const dir = join(FICHIERS, 'zip'), man = JSON.parse(readFileSync(join(dir, 'manifeste.json'), 'utf8'));
  const alt = join(FICHIERS, man.medias[0].fichier); const b = readFileSync(join(dir, 'medias', man.medias[0].fichier)); b[b.length - 10] ^= 0xFF; writeFileSync(alt, b);
  await page.goto(BASE + '/fieldproof/index.html#accueil'); await page.goto(BASE + '/fieldproof/index.html#verifier');
  await page.setInputFiles('#fpVerifFichiers', [join(dir, 'manifeste.json'), alt]);
  await page.waitForSelector('.fp-table');
  const ok2 = await page.$$eval('.fp-table tbody tr', l => l.map(r => r.children[1].textContent));
  return { ok: ok1.length === 5 && ok1.every(s => s === 'Conforme') && ok2.includes('Modifié depuis sa création'), obtenu: `ZIP : ${ok1.join(', ')} · fichier altéré : ${ok2.join(', ')}` };
});

await etape('T24', 'EN LIGNE : nom du lieu OpenStreetMap + contrôle FBMS ; position au village Beta pour une mission déclarée à Alpha → ÉCART inscrit sur la photo', async () => {
  await ctx.setOffline(false); await ctx.setGeolocation({ latitude: 7.56, longitude: -5.0, accuracy: 10 });
  await page.goto(BASE + `/fieldproof/index.html#capture/${MID}/PHOTO`);
  await page.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  await page.waitForFunction(() => /Localité Fictive OSM/.test(document.querySelector('#fpBandeauApercu').textContent), null, { timeout: 20000 });
  await page.click('#fpDeclencheur'); await page.waitForSelector('[data-valider]'); await page.click('[data-valider]'); await page.waitForSelector('.fp-revue-ok');
  const l = (await registre(page, MID)).filter(x => x.type === 'PHOTO'); const x = l[l.length - 1];
  const b = await lireFichier(page, x.id); const f = join(FICHIERS, x.id + '-osm-ecart.jpg'); writeFileSync(f, b);
  const texte = ocr(f, 320).replace(/\s+/g, ' ');
  const urlOk = OSM_APPELS.every(u => { const q = new URL(u).searchParams; return [...q.keys()].sort().join(',') === 'accept-language,addressdetails,format,lat,lon,zoom'; });
  const desc = py(`from PIL import Image; print(Image.open('${f}').getexif().get(0x010E,''))`);
  await ctx.setGeolocation(GPS); await ctx.setOffline(true);
  return { ok: x.localite.source === 'OSM' && x.localite.conformite === 'ECART' && /Localit[ée] Fictive OSM/i.test(texte) && /[ÉE]CART/.test(texte) && urlOk && OSM_APPELS.length >= 1 && /Localite Fictive OSM/.test(desc),
    obtenu: `registre : « ${x.localite.texte} » · OCR contient OSM + ÉCART : ${/[ÉE]CART/.test(texte)} · ${OSM_APPELS.length} appel(s) OSM, paramètres envoyés = coordonnées et options seulement : ${urlOk} · EXIF : « ${desc.slice(desc.indexOf('Localite'), desc.indexOf('Localite') + 60)}… »`, preuve: 'tests/fieldproof/resultats/fichiers/' + x.id + '-osm-ecart-bandeau.png' };
});

await etape('T13', 'Persistance après fermeture et réouverture (retour réseau) : mission, registre et fichiers retrouvés', async () => {
  await ctx.setOffline(false);
  await page.close();
  globalThis.__page = await nouvellePage(ctx); const p = globalThis.__page;
  await p.goto(BASE + '/fieldproof/index.html');
  await p.waitForSelector(`a[href="#mission/${MID}"]`);
  await p.click(`a[href="#mission/${MID}"]`);
  await p.waitForSelector('.fp-media');
  const n = await p.$$eval('.fp-media', l => l.length);
  const b = await lireFichier(p, V1.id);
  return { ok: n === 6 && b && sha(b) === V1.sha256, obtenu: `${n} médias affichés · vidéo ${V1.id} relue, empreinte identique : ${b && sha(b) === V1.sha256}` };
});
const page2 = globalThis.__page;
await etape('T14', 'Miniatures distinctes photo / vidéo dans la galerie de mission', async () => {
  const types = await page2.$$eval('.fp-type', l => l.map(e => e.textContent));
  return { ok: types.filter(t => t === 'PHOTO').length === 4 && types.filter(t => /^▶ VIDÉO \d\d:\d\d$/.test(t)).length === 2, obtenu: types.join(' | ') };
});

await etape('T15', 'Vidéo interrompue (fermeture pendant l\'enregistrement) : séquence préservée puis récupérée', async () => {
  await page2.goto(BASE + `/fieldproof/index.html#capture/${MID}/VIDEO`);
  await page2.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  await page2.click('#fpDeclencheur'); await page2.waitForSelector('#fpDeclencheur.fp-en-cours');
  await attendre(3500);
  /* Les segments doivent être sur disque AVANT la coupure (écriture au fil de l'eau). */
  const avant = await page2.evaluate(() => FP_STORE.morceauxOrphelins());
  if (!avant.length || avant[0].nb < 2) throw new Error('segments non écrits pendant l\'enregistrement : ' + JSON.stringify(avant));
  await page2.goto('about:blank');
  await page2.goto(BASE + '/fieldproof/index.html#accueil');
  await page2.waitForSelector('text=Enregistrement vidéo interrompu', { timeout: 15000 });
  await page2.click('[data-recuperer]');
  await page2.waitForURL(/#mission\//);
  await page2.waitForSelector('text=Récupérée');
  const l = (await registre(page2, MID)).filter(x => x.statut === 'RECUPERE');
  const b = await lireFichier(page2, l[0].id); const f = join(FICHIERS, l[0].id + '-recuperee' + (l[0].mime.includes('mp4') ? '.mp4' : '.webm')); writeFileSync(f, b);
  let lisible = false, detail = '';
  try { const pr = ffprobe(f); lisible = pr.streams.some(s => s.codec_type === 'video'); detail = pr.format.format_name; } catch (e) { detail = 'ffprobe : ' + String(e.message).slice(0, 80); }
  return { ok: l.length === 1 && b.length > 10000 && lisible, obtenu: `${avant[0].nb} segments écrits avant la coupure · ${l[0].id} récupérée · ${b.length} o · lisible ffprobe : ${lisible} (${detail})` };
});
await page2.close();

/* -- Contextes dédiés : refus et stockage ---------------------------------- */
await etape('T16', 'Micro refusé : la vidéo est enregistrée MUETTE et le signale (ffprobe : pas de piste audio)', async () => {
  const c = await contexte({ init: () => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = c => c && c.audio ? Promise.reject(new DOMException('refus simulé', 'NotAllowedError')) : g(c); } });
  const p = await nouvellePage(c); await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone');
  const mid = await creerMission(p, 'Village Fictif Beta', 'Visite de plantation');
  await p.goto(BASE + `/fieldproof/index.html#capture/${mid}/VIDEO`);
  await p.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  const al = await p.textContent('#fpAlerte');
  await p.click('#fpDeclencheur'); await p.waitForSelector('#fpDeclencheur.fp-en-cours'); await attendre(2200); await p.click('#fpDeclencheur');
  await p.waitForSelector('[data-valider]', { timeout: 30000 }); const rev = await p.textContent('#fpRevue'); await p.click('[data-valider]'); await p.waitForSelector('.fp-revue-ok');
  const x = (await registre(p, mid))[0]; const b = await lireFichier(p, x.id); const f = join(FICHIERS, x.id + '-muette' + extname(x.mime.includes('mp4') ? '.mp4' : '.webm')); writeFileSync(f, b);
  const pr = ffprobe(f); const audio = pr.streams.some(s => s.codec_type === 'audio');
  await c.close();
  return { ok: /MUETTE/.test(al) && /muette/.test(rev) && x.micro === false && !audio, obtenu: `alerte « ${al.trim().slice(0, 90)} » · registre micro=${x.micro} · piste audio dans le fichier : ${audio}` };
});
await etape('T17', 'Caméra refusée : message clair, aucune capture possible, aucun recours à la galerie', async () => {
  const c = await contexte({ init: () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refus simulé', 'NotAllowedError')); } });
  const p = await nouvellePage(c); await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone');
  const mid = await creerMission(p);
  await p.goto(BASE + `/fieldproof/index.html#capture/${mid}/PHOTO`);
  await p.waitForFunction(() => /refusé/.test((document.querySelector('#fpAlerte') || {}).textContent || ''), null, { timeout: 15000 });
  const t = await p.textContent('#fpAlerte'); const desactive = await p.$eval('#fpDeclencheur', b => b.disabled);
  const input = await p.$$eval('input[type=file]', l => l.length);
  await c.close();
  return { ok: desactive && input === 0, obtenu: `déclencheur désactivé : ${desactive} · champ d'import de fichier : ${input} · « ${t.trim().slice(0, 120)}… »` };
});
await etape('T18', 'Stockage presque plein pendant une vidéo : arrêt EXPLICITE, séquence conservée et validable', async () => {
  const c = await contexte({ init: () => {
    const vrai = navigator.storage.estimate.bind(navigator.storage); let n = 0;
    navigator.storage.estimate = () => vrai().then(e => { n++; return n <= 1 ? e : { usage: 990 * 1048576, quota: 1000 * 1048576 }; });
  } });
  const p = await nouvellePage(c); await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone');
  const mid = await creerMission(p);
  await p.goto(BASE + `/fieldproof/index.html#capture/${mid}/VIDEO`);
  await p.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 });
  await p.click('#fpDeclencheur');                           // la confirmation d'espace insuffisant est acceptée par le test
  await p.waitForSelector('[data-valider]', { timeout: 30000 });  // arrêt automatique sans action de l'agent
  const al = await p.textContent('#fpAlerte');
  await p.click('[data-valider]'); await p.waitForSelector('.fp-revue-ok');
  const x = (await registre(p, mid))[0];
  await c.close();
  return { ok: x.raisonArret === 'STOCKAGE' && /stockage|Espace/i.test(al) && x.taille > 5000 && x.local === 'VERIFIE', obtenu: `raison ${x.raisonArret} · ${Math.round(x.dureeMs / 100) / 10}s conservées · ${x.taille} o · « ${al.trim().slice(0, 110)} »` };
});

await etape('T19', 'Aucune transmission : zéro écriture Supabase, zéro requête POST/PUT pendant toute la recette', async () => {
  const n = await (async () => { const c = await contexte(); const p = await nouvellePage(c); await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone'); const v = await p.evaluate(() => window.__FP_ECRITURES_SUPABASE); await c.close(); return v; })();
  return { ok: n === 0 && REQUETES_ECRITURE.length === 0, obtenu: `écritures Supabase : ${n} · requêtes non-GET : ${REQUETES_ECRITURE.length}${REQUETES_ECRITURE.length ? ' → ' + REQUETES_ECRITURE.slice(0, 3).join(', ') : ''}` };
});

/* -- Interfaces aux trois largeurs ---------------------------------------- */
for (const [nom, vp] of Object.entries(LARGEURS)) {
  await etape(`T20-${nom}`, `Interfaces ${vp.width}×${vp.height} : accueil, mission, capture photo/vidéo, portail — sans débordement horizontal`, async () => {
    const c = await contexte({ viewport: vp }); const p = await nouvellePage(c);
    await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone');
    const mid = await creerMission(p);
    await photo(p, mid); await p.click('[data-continuer]');
    const deb = [];
    const vues = [['accueil', '#accueil', 'text=Mes missions'], ['mission', `#mission/${mid}`, '.fp-media'], ['capture-photo', `#capture/${mid}/PHOTO`, '#fpDeclencheur:not([disabled])'], ['capture-video', `#capture/${mid}/VIDEO`, '#fpDeclencheur:not([disabled])'], ['nouvelle', '#nouvelle', '#fpCluster']];
    for (const [v, h, sel] of vues) {
      await p.goto(BASE + '/fieldproof/index.html' + h); await p.waitForSelector(sel, { timeout: 20000 }); await attendre(400);
      const d = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (d > 1) deb.push(`${v}:+${d}px`);
      await p.screenshot({ path: join(CAPTURES, `${nom}-${v}.png`), fullPage: v !== 'capture-video' });
    }
    await p.goto(BASE + '/index.html'); await p.waitForSelector('a[href="fieldproof/index.html"]');
    const dp = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (dp > 1) deb.push(`portail:+${dp}px`);
    const carte = await p.$eval('a[href="fieldproof/index.html"]', a => a.textContent);
    await p.$eval('a[href="fieldproof/index.html"]', a => a.scrollIntoView()); await attendre(300);
    await p.screenshot({ path: join(CAPTURES, `${nom}-portail.png`), fullPage: true });
    await p.click('a[href="fieldproof/index.html"]'); await p.waitForURL(/fieldproof\/index\.html/);
    await c.close();
    return { ok: deb.length === 0 && /AFLP FIELD PROOF/.test(carte) && /Preuves photo & vidéo des missions terrain/.test(carte), obtenu: (deb.length ? 'débordements : ' + deb.join(', ') : 'aucun débordement') + ' · carte portail OK, clic → module', preuve: `tests/fieldproof/resultats/captures/${nom}-*.png` };
  });
}

await etape('T22', 'Accessibilité axe-core (WCAG 2.1 A/AA) sur les écrans réels du module, 390×844', async () => {
  const AXE = readFileSync(join(RACINE, '.github', 'vendor', 'axe.min.js'), 'utf8');
  const c = await contexte(); const p = await nouvellePage(c);
  await p.goto(BASE + '/fieldproof/index.html'); await p.waitForSelector('text=Préparation du téléphone');
  const mid = await creerMission(p); await photo(p, mid); await p.click('[data-continuer]');
  const res = [];
  for (const [v, h, sel] of [['accueil', '#accueil', 'text=Mes missions'], ['nouvelle', '#nouvelle', '#fpCluster'], ['mission', `#mission/${mid}`, '.fp-media'], ['capture', `#capture/${mid}/VIDEO`, '#fpDeclencheur:not([disabled])'], ['aide', '#aide', 'text=Pourquoi ces autorisations'], ['verifier', '#verifier', '#fpVerifFichiers']]) {
    await p.goto(BASE + '/fieldproof/index.html' + h); await p.waitForSelector(sel, { timeout: 20000 });
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }).then(x => x.violations.map(v => v.id + ':' + v.impact + ':' + v.nodes.length)));
    res.push(v + ' → ' + (r.length ? r.join(', ') : '0'));
  }
  await c.close();
  const graves = res.filter(l => /:(serious|critical):/.test(l));
  return { ok: graves.length === 0, obtenu: res.join(' | ') };
});

await etape('T21', 'Aucune erreur console sur l\'ensemble des parcours', async () => {
  const utiles = CONSOLE.filter(m => !/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m));
  return { ok: utiles.length === 0, obtenu: utiles.length ? utiles.slice(0, 4).join(' || ') : `0 erreur (${CONSOLE.length} message(s) réseau attendus en mode hors ligne ignorés)` };
});

await navigateur.close(); serveur.close();
const nbOk = R.filter(r => r.resultat === 'RÉUSSI').length;
writeFileSync(join(SORTIE, 'resultats.json'), JSON.stringify({ date: new Date().toISOString(), navigateur: 'Chromium ' + (process.env.CHROMIUM || '/usr/bin/google-chrome'), mime_video: V1 && V1.mime, ffprobe_video: PROBE && PROBE.format && PROBE.format.format_name, reussis: nbOk, total: R.length, resultats: R }, null, 2));
console.log(`\n${nbOk}/${R.length} scénarios réussis`);
process.exit(nbOk === R.length ? 0 : 1);
