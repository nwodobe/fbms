/* CARTES HORS LIGNE · recette dans un vrai navigateur (Chromium), aux trois tailles du dépôt.
   Ce banc exécute le VRAI gestionnaire (shared/cartes-hors-ligne*.js), le vrai Leaflet 1.9.4,
   le vrai IndexedDB sur disque (profil persistant, navigateur fermé puis relancé) et le vrai
   décodage des sept images du pilote. Seuls sont simulés : l'identité, le serveur des repères
   (tests/cartes-hors-ligne/banc.html) et le transport vers l'adresse publique des paquets,
   servie depuis le dépôt local pour pouvoir injecter coupure, lenteur et corruption.
   Il ne prouve NI la WebView Android, NI la réception OTA, NI la publication du catalogue.
   Lancer : node tests/cartes-hors-ligne/navigateur.mjs [dossier de captures]
   Prérequis : Playwright + Chromium (npm install --no-save playwright@1.49.1). */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const captures = process.argv[2] ? path.resolve(process.argv[2]) : path.join(racine, 'tests/cartes-hors-ligne/resultats');
fs.mkdirSync(captures, { recursive: true });
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright')); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const serveur = http.createServer((req, res) => {
  const f = path.join(racine, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(racine) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
});
await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
const base = 'http://127.0.0.1:' + serveur.address().port + '/tests/cartes-hors-ligne/banc.html';
const PUBLIC = 'https://nwodobe.github.io/fbms/cartes-hors-ligne/';
const ZONE = 'bouake-pilote-sentinel2', P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222';
const dossierPaquets = path.join(racine, 'cartes-hors-ligne');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* Leaflet : chargé une fois depuis le CDN par Node, puis servi de mémoire, pour que la
   « coupure réseau » du banc ne dépende d'aucun hôte extérieur. Dans l'APK, il est embarqué. */
const leaflet = {};
for (const f of ['leaflet.min.js', 'leaflet.min.css']) leaflet[f] = Buffer.from(await (await fetch('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/' + f)).arrayBuffer());

/* Seconde version du même paquet, fabriquée en mémoire pour l'essai de mise à jour. */
const catalogueV1 = JSON.parse(fs.readFileSync(path.join(dossierPaquets, 'catalogue.json'), 'utf8'));
const manifesteV1 = JSON.parse(fs.readFileSync(path.join(dossierPaquets, catalogueV1.zones[0].manifest), 'utf8'));
const manifesteV2 = Buffer.from(JSON.stringify(Object.assign({}, manifesteV1, { version: 'banc-v2' })));
const catalogueV2 = Buffer.from(JSON.stringify({ schemaVersion: 1, zones: [Object.assign({}, catalogueV1.zones[0], { version: 'banc-v2', manifest: ZONE + '/banc-v2/manifest.json', manifestSha256: sha(manifesteV2) })] }));

const transport = { coupe: false, lenteurMs: 0, corrompre: null, v2: false, bloquerTuilesApres: null, demandes: [] };
async function servirPaquets(route) {
  const url = route.request().url(), rel = url.slice(PUBLIC.length);
  transport.demandes.push(rel);
  if (transport.coupe) return route.abort('internetdisconnected');
  const tuile = /\/tiles\//.test(rel);
  if (tuile && transport.bloquerTuilesApres != null && transport.demandes.filter((d) => /\/tiles\//.test(d)).length > transport.bloquerTuilesApres) return route.abort('internetdisconnected');
  if (tuile && transport.lenteurMs) await new Promise((ok) => setTimeout(ok, transport.lenteurMs));
  let corps;
  if (rel === 'catalogue.json') corps = transport.v2 ? catalogueV2 : fs.readFileSync(path.join(dossierPaquets, rel));
  else if (rel === ZONE + '/banc-v2/manifest.json') corps = manifesteV2;
  else {
    const f = path.join(dossierPaquets, rel.replace('/banc-v2/', '/2026-02-20/'));
    if (!f.startsWith(dossierPaquets) || !fs.existsSync(f)) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    corps = fs.readFileSync(f);
  }
  if (transport.corrompre && rel.endsWith(transport.corrompre)) { corps = Buffer.from(corps); corps[corps.length - 20] ^= 0xff; }
  return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': TYPES[path.extname(rel)] || 'application/octet-stream' }, body: corps });
}

const resultats = []; let echecs = 0;
function verdict(nom, ok, detail) { resultats.push({ nom, ok: !!ok, detail: detail || '' }); if (!ok) echecs++; console.log((ok ? 'OK    ' : 'ECHEC ') + nom + (detail ? ' · ' + detail : '')); }
const erreursConsole = [];
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'fbms-cartes-'));
let contexte = null;
async function lancer(viewport) {
  if (contexte) await contexte.close();
  contexte = await chromium.launchPersistentContext(profil, { viewport, locale: 'fr-FR', deviceScaleFactor: 1 });
  await contexte.route(PUBLIC + '**', servirPaquets);
  await contexte.route('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/*', (r) => { const f = r.request().url().split('/').pop(); return r.fulfill({ status: 200, headers: { 'content-type': TYPES[path.extname(f)] }, body: leaflet[f] }); });
}
async function ouvrir(hash, params) {
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) erreursConsole.push(m.text()); });
  await page.goto(base + (params ? '?' + params : '') + '#' + hash);
  await page.waitForSelector('.ops-route-head');
  return page;
}
const texte = (page) => page.locator('#opsRouteView').innerText();
const etatZone = (page) => page.locator('[data-zone="' + ZONE + '"] .chl-etat').innerText();
const attendreEtat = (page, motif, delai) => page.waitForFunction(([z, m]) => { const e = document.querySelector('[data-zone="' + z + '"] .chl-etat'); return e && new RegExp(m).test(e.textContent); }, [ZONE, motif], { timeout: delai || 15000 });
/* Photographie des bases métier (repères, file, brouillons) pour comparer avant / après. */
const metier = (page) => page.evaluate(async () => {
  const d = await new Promise((ok, ko) => { const r = indexedDB.open('aflp_reperes_gps_db'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const out = {};
  for (const n of Array.from(d.objectStoreNames)) out[n] = await new Promise((ok) => { const r = d.transaction(n).objectStore(n).getAll(); r.onsuccess = () => ok(r.result); });
  d.close(); return JSON.stringify(out);
});
/* Dessine la zone avec la vraie couche du gestionnaire et relève, tuile par tuile, si des
   pixels ont réellement été peints (décodage ImageBitmap + Canvas du navigateur). */
const peindreToutesLesTuiles = (page) => page.evaluate(async (zone) => {
  const M = window.ANAGROCI_CARTES_HORS_LIGNE, p = (await M.liste()).find((x) => x.id === zone && x.actif), m = p.manifeste, b = m.bounds;
  const div = document.createElement('div'); div.style.cssText = 'width:600px;height:600px;position:fixed;left:0;top:0;z-index:9999'; document.body.appendChild(div);
  const vues = {};
  for (let z = m.minZoom; z <= m.maxZoom; z++) {
    const map = L.map(div, { zoomAnimation: false, fadeAnimation: false }).fitBounds([[b[1], b[0]], [b[3], b[2]]]).setZoom(z);
    const f = await M.fond(map, { id: zone, centre: [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2] });
    if (!f) { map.remove(); return { erreur: 'fond indisponible au zoom ' + z }; }
    await new Promise((ok) => { let fini = false; const t = setTimeout(() => { if (!fini) ok(); }, 6000); f.couche.on('load', () => { fini = true; clearTimeout(t); ok(); }); });
    for (const k of Object.keys(f.couche._tiles)) {
      const t = f.couche._tiles[k], c = t.el, d = c.getContext('2d').getImageData(0, 0, 256, 256).data;
      let opaques = 0, couleurs = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) { if (d[i + 3] > 0) opaques++; couleurs.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); }
      vues[t.coords.z + '/' + t.coords.x + '/' + t.coords.y] = { opaques, couleurs: couleurs.size };
    }
    map.remove();
  }
  div.remove();
  return { attendues: m.tiles.map((t) => t.z + '/' + t.x + '/' + t.y), vues };
}, ZONE);

const TAILLES = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
try {
  /* ---------- A. sans compte : rien ne se télécharge ---------- */
  await lancer(TAILLES[0]);
  let page = await ouvrir('parcelles/cartes-hors-ligne', 'compte=aucun');
  await attendreEtat(page, 'À télécharger');
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click();
  await page.waitForFunction(() => /Connectez-vous à FBMS/.test(document.getElementById('chlMessage').textContent));
  verdict('A1 sans compte : téléchargement refusé, aucune image demandée', !transport.demandes.some((d) => /tiles\//.test(d)) && /À télécharger/.test(await etatZone(page)));
  await page.close();

  /* ---------- B. ouverture, lisibilité et commandes aux trois tailles ---------- */
  for (const t of TAILLES) {
    await lancer(t);
    page = await ouvrir('parcelles/cartes-hors-ligne');
    await attendreEtat(page, 'À télécharger');
    const mesures = await page.evaluate(() => ({
      debord: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      petits: Array.from(document.querySelectorAll('.chl button, .chl a.btn, .chl input, .chl summary')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44); }).map((e) => e.textContent.trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)),
      titre: document.querySelector('.chl h1').textContent }));
    const tt = await texte(page);
    verdict('B' + t.width + ' gestionnaire ouvert à ' + t.width + '×' + t.height + ' : zone, date, résolution, emprise et volume lisibles, sans débordement',
      mesures.titre === 'Mes cartes hors ligne' && /Bouaké/.test(tt) && /2026-02-20/.test(tt) && /10 m\/pixel/.test(tt) && /180 Kio/.test(tt) && /latitude 7,6700 à 7,6900/.test(tt) && mesures.debord <= 0 && !mesures.petits.length,
      'débordement ' + mesures.debord + ' px' + (mesures.petits.length ? ' · cibles < 44 px : ' + mesures.petits.join(' | ') : ''));
    await page.screenshot({ path: path.join(captures, '01-gestionnaire-a-telecharger-' + t.width + '.png'), fullPage: true });
    await page.close();
  }

  /* ---------- C. interruption, reprise, corruption pendant le transport ---------- */
  await lancer(TAILLES[0]);
  page = await ouvrir('parcelles/cartes-hors-ligne');
  await attendreEtat(page, 'À télécharger');
  transport.demandes.length = 0; transport.lenteurMs = 700;
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click();
  await attendreEtat(page, 'En cours');
  await page.waitForFunction(() => { const p = document.querySelector('.chl progress'); return p && p.value >= 2; });
  await page.screenshot({ path: path.join(captures, '02-telechargement-en-cours-390.png'), fullPage: true });
  await page.getByRole('button', { name: 'Interrompre' }).click();
  await attendreEtat(page, 'Interrompu');
  let avancement = await page.evaluate(() => document.querySelector('.chl progress').value);
  verdict('C1 interruption : état « Interrompu », images vérifiées conservées, carte non déclarée disponible', avancement >= 2 && avancement < 7 && !(await page.evaluate((z) => window.ANAGROCI_CARTES_HORS_LIGNE.disponible([7.68, -5.05]))), avancement + ' / 7 images');
  await page.screenshot({ path: path.join(captures, '03-interrompu-390.png'), fullPage: true });
  /* Fermeture complète du navigateur au milieu, puis reprise : l'avancement vient du disque. */
  await lancer(TAILLES[0]);
  page = await ouvrir('parcelles/cartes-hors-ligne');
  await attendreEtat(page, 'Interrompu');
  const avantReprise = await page.evaluate(() => document.querySelector('.chl progress').value);
  transport.demandes.length = 0; transport.lenteurMs = 0; transport.corrompre = 'tiles/14/7962/7841.png';
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await attendreEtat(page, 'Incomplet');
  let tt = await texte(page);
  verdict('C2 reprise après fermeture du navigateur : avancement retrouvé sur disque, seules les images manquantes sont redemandées', avantReprise === avancement && transport.demandes.filter((d) => /tiles\//.test(d)).length <= 7 - avancement,
    avantReprise + ' images retrouvées · ' + transport.demandes.filter((d) => /tiles\//.test(d)).length + ' image(s) redemandée(s)');
  verdict('C3 image corrompue pendant le transport : refusée, carte « Incomplet », jamais activée', /Image corrompue/.test(tt) && !(await page.evaluate(() => window.ANAGROCI_CARTES_HORS_LIGNE.disponible([7.68, -5.05]))));
  await page.screenshot({ path: path.join(captures, '04-image-corrompue-390.png'), fullPage: true });
  transport.corrompre = null; transport.demandes.length = 0;
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await attendreEtat(page, 'Disponible hors ligne');
  verdict('C4 téléchargement complet : « Disponible hors ligne » après contrôle des 7 images, sans afficher la carte', (await page.locator('#chlApercu').isHidden()) && (await page.evaluate(() => window.ANAGROCI_CARTES_HORS_LIGNE.disponible([7.68, -5.05]))),
    transport.demandes.filter((d) => /tiles\//.test(d)).length + ' image(s) demandée(s) à cette reprise');
  const volumes = await page.evaluate(async (z) => { const p = (await window.ANAGROCI_CARTES_HORS_LIGNE.liste()).find((x) => x.id === z); const e = await navigator.storage.estimate(); return { octets: p.octets, nombre: p.nombre, persiste: await navigator.storage.persisted(), quota: e.quota, usage: e.usage }; }, ZONE);
  verdict('C5 volume écrit égal au volume annoncé', volumes.octets === 184144 && volumes.nombre === 7, volumes.octets + ' octets, ' + volumes.nombre + ' images · stockage persistant accordé : ' + volumes.persiste);
  await page.close();

  /* ---------- D. aperçu, vraies images, limites de couverture, aux trois tailles ---------- */
  for (const t of TAILLES) {
    await lancer(t);
    page = await ouvrir('parcelles/cartes-hors-ligne');
    await attendreEtat(page, 'Disponible hors ligne');
    await page.getByRole('button', { name: 'Ouvrir la carte' }).click();
    await page.waitForSelector('#chlCarte canvas.leaflet-tile');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#chlCarte canvas.leaflet-tile')).some((c) => c.getContext('2d').getImageData(128, 128, 1, 1).data[3] > 0), null, { timeout: 8000 });
    await page.waitForTimeout(500);
    tt = await texte(page);
    const attribution = await page.locator('#chlCarte .leaflet-control-attribution').innerText();
    let notice = await page.locator('#chlCarte .chl-couverture').innerText();
    verdict('D' + t.width + ' aperçu à ' + t.width + '×' + t.height + ' : image Sentinel-2 réellement peinte, attribution et résolution affichées',
      /Copernicus Sentinel/.test(attribution) && /Satellite téléchargé/.test(tt) && /10 m\/pixel/.test(notice + tt), notice.replace(/\s+/g, ' '));
    await page.screenshot({ path: path.join(captures, '05-apercu-satellite-' + t.width + '.png'), fullPage: true });
    if (t.width === 390) {
      for (let i = 0; i < 4; i++) await page.locator('#chlCarte .leaflet-control-zoom-out').click();
      await page.waitForTimeout(600);
      notice = await page.locator('#chlCarte .chl-couverture').innerText();
      verdict('D-limite hors de l\'emprise : la carte annonce que le fond n\'est pas téléchargé en dehors du cadre vert', /non téléchargé pour cette zone/.test(notice), notice);
      await page.screenshot({ path: path.join(captures, '06-hors-emprise-390.png') });
    }
    await page.close();
  }

  /* ---------- E. sans réseau, navigateur relancé : chaque image, chaque zoom ---------- */
  transport.coupe = true; transport.demandes.length = 0;
  await lancer(TAILLES[0]);
  page = await ouvrir('parcelles/cartes-hors-ligne', 'reseau=non');
  await attendreEtat(page, 'Disponible hors ligne');
  tt = await texte(page);
  verdict('E1 sans réseau après relance du navigateur : catalogue et carte retrouvés sur le disque', /Catalogue conservé sur ce téléphone/.test(tt) && /2026-02-20/.test(tt));
  const peint = await peindreToutesLesTuiles(page);
  /* Hors des bornes annoncées, une tuile est transparente : seuls quelques pixels peuvent être opaques. */
  const manquantes = peint.erreur ? ['?'] : peint.attendues.filter((k) => !peint.vues[k] || peint.vues[k].opaques < 5 || peint.vues[k].couleurs < 5);
  verdict('E2 sans réseau : les 7 images des zooms 12, 13 et 14 sont décodées et peintes depuis le stockage local, y compris celles jamais affichées', !peint.erreur && !manquantes.length && transport.demandes.length === 0,
    peint.erreur || (peint.attendues.length + ' attendues · ' + manquantes.length + ' manquante(s) · ' + transport.demandes.length + ' requête(s) réseau'));
  await page.screenshot({ path: path.join(captures, '07-gestionnaire-hors-ligne-390.png'), fullPage: true });
  /* Repères GPS : parcelle, bloc et arbres fictifs sur le fond local, objets sans position signalés. */
  await page.goto(base + '?reseau=non#reperes/champ/' + P1 + '/carte'); await page.reload();
  await page.waitForSelector('#rgCarte .leaflet-marker-icon');
  await page.waitForFunction(() => /Carte téléchargée/.test((document.getElementById('rgFond') || {}).textContent || ''), null, { timeout: 8000 });
  await page.waitForTimeout(600);
  tt = await texte(page);
  const marqueurs = await page.locator('#rgCarte .leaflet-marker-icon').count();
  const fondPeint = await page.evaluate(() => Array.from(document.querySelectorAll('#rgCarte canvas.leaflet-tile')).some((c) => c.getContext('2d').getImageData(128, 128, 1, 1).data[3] > 0));
  verdict('E3 sans réseau : parcelle et arbres fictifs affichés à leurs coordonnées sur le fond satellite local ; les objets sans position restent signalés', marqueurs === 3 && fondPeint && /Position non renseignée/.test(tt) && /Résolution native : 10 m/.test(tt), marqueurs + ' repères · fond peint : ' + fondPeint);
  await page.screenshot({ path: path.join(captures, '08-reperes-sur-fond-local-390.png'), fullPage: true });
  /* Champ hors de toute carte : fond neutre annoncé, saisie manuelle possible et durable. */
  await page.goto(base + '?reseau=non#reperes/objet/PARCELLE/' + P2); await page.reload(); await page.waitForSelector('.rg-saisie');
  await page.getByRole('button', { name: 'Saisir les coordonnées GPS' }).click();
  await page.fill('#rgLat', '7,6850'); await page.fill('#rgLng', '-5,0450');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForFunction(() => /Enregistré sur ce téléphone\. En attente de synchronisation\./.test(document.getElementById('opsRouteView').innerText));
  const metierAvant = await metier(page);
  await lancer(TAILLES[0]);
  page = await ouvrir('reperes/champ/' + P2, 'reseau=non');
  await page.waitForFunction(() => /7[.,]685/.test(document.getElementById('opsRouteView').innerText));
  const metierApresRelance = await metier(page);
  verdict('E4 saisie GPS manuelle sans réseau : retrouvée en attente après fermeture et relance du navigateur', metierApresRelance === metierAvant && JSON.parse(metierAvant).file.length === 1, 'file : ' + JSON.parse(metierAvant).file.length + ' opération');
  await page.screenshot({ path: path.join(captures, '09-saisie-hors-ligne-conservee-390.png'), fullPage: true });
  await page.close();

  /* ---------- F. espace insuffisant, mise à jour interrompue, suppression ---------- */
  transport.coupe = false; transport.v2 = true; transport.demandes.length = 0;
  page = await ouvrir('parcelles/cartes-hors-ligne', 'espace=faible');
  await page.getByRole('button', { name: 'Actualiser le catalogue' }).click();
  await attendreEtat(page, 'Mise à jour à télécharger');
  await page.getByRole('button', { name: 'Mettre à jour' }).click();
  await page.waitForFunction(() => /Espace insuffisant/.test(document.getElementById('chlMessage').textContent));
  verdict('F1 espace insuffisant : téléchargement refusé avant toute image, ancienne carte et données terrain intactes', !transport.demandes.some((d) => /tiles\//.test(d)) && (await metier(page)) === metierAvant && (await page.evaluate(() => window.ANAGROCI_CARTES_HORS_LIGNE.disponible([7.68, -5.05]))));
  await page.screenshot({ path: path.join(captures, '10-espace-insuffisant-390.png'), fullPage: true });
  await page.close();
  page = await ouvrir('parcelles/cartes-hors-ligne');
  await attendreEtat(page, 'Mise à jour à télécharger');
  transport.demandes.length = 0; transport.bloquerTuilesApres = 3;
  await page.getByRole('button', { name: 'Mettre à jour' }).click();
  await attendreEtat(page, 'Incomplet');
  tt = await texte(page);
  const ancienne = await page.evaluate(async (z) => { const M = window.ANAGROCI_CARTES_HORS_LIGNE, l = await M.liste(); const a = l.find((x) => x.id === z && x.actif); return { version: a && a.manifeste.version, dispo: await M.disponible([7.68, -5.05]), versions: l.length }; }, ZONE);
  verdict('F2 mise à jour coupée au milieu : l\'ancienne version reste active et utilisable', ancienne.version === '2026-02-20' && ancienne.dispo && ancienne.versions === 2 && /La dernière carte complète reste disponible/.test(tt), 'active : ' + ancienne.version + ' · ' + ancienne.versions + ' versions sur disque');
  await page.screenshot({ path: path.join(captures, '11-mise-a-jour-interrompue-390.png'), fullPage: true });
  transport.bloquerTuilesApres = null;
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await attendreEtat(page, 'Disponible hors ligne');
  const nouvelle = await page.evaluate(async (z) => { const l = await window.ANAGROCI_CARTES_HORS_LIGNE.liste(); return l.find((x) => x.id === z && x.actif).manifeste.version; }, ZONE);
  verdict('F3 reprise de la mise à jour : bascule sur la nouvelle version seulement après contrôle complet', nouvelle === 'banc-v2', 'active : ' + nouvelle);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Supprimer du téléphone' }).click();
  await attendreEtat(page, 'À télécharger');
  const reste = await page.evaluate(async () => { const M = window.ANAGROCI_CARTES_HORS_LIGNE; const d = await new Promise((ok) => { const r = indexedDB.open('fbms_cartes_satellite_v1'); r.onsuccess = () => ok(r.result); }); const n = await new Promise((ok) => { const r = d.transaction('tuiles').objectStore('tuiles').count(); r.onsuccess = () => ok(r.result); }); d.close(); return { tuiles: n, paquets: (await M.liste()).length }; });
  verdict('F4 suppression : toutes les versions de la carte retirées, repères et file en attente identiques avant / après', reste.tuiles === 0 && reste.paquets === 0 && (await metier(page)) === metierAvant, reste.tuiles + ' image(s) restante(s)');
  await page.screenshot({ path: path.join(captures, '12-carte-supprimee-390.png'), fullPage: true });

  /* ---------- G. retour du réseau : synchronisation sans doublon ---------- */
  await page.goto(base + '#reperes/champ/' + P2); await page.reload(); await page.waitForSelector('.ops-route-head');
  await page.evaluate(() => window.ANAGROCI_REPERES.synchroniser(true)); await page.evaluate(() => window.ANAGROCI_REPERES.synchroniser(true));
  await page.reload(); await page.waitForSelector('.ops-route-head'); await page.evaluate(() => window.ANAGROCI_REPERES.synchroniser(true));
  const srv = await page.evaluate(() => window.BANC.serveur());
  const fileApres = JSON.parse(await metier(page)).file.filter((o) => o.etat !== 'RECU' && o.etat !== 'ACCEPTEE');
  verdict('G1 retour du réseau : le repère saisi hors ligne est reçu une seule fois malgré trois synchronisations', (srv.lignes || []).length === 1 && fileApres.length === 0, (srv.lignes || []).length + ' ligne serveur · ' + (srv.appels || 0) + ' appel(s)');
  await page.close();

  verdict('Z aucune erreur de console pendant tous les parcours', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
} catch (e) {
  verdict('EXCEPTION du banc', false, String(e && e.stack || e).slice(0, 600));
} finally {
  if (contexte) await contexte.close();
  serveur.close();
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) {}
}
const version = chromium.executablePath ? path.basename(path.dirname(path.dirname(chromium.executablePath()))) : '';
fs.writeFileSync(path.join(captures, 'resultats.json'), JSON.stringify({ date: new Date().toISOString(), navigateur: 'Chromium (Playwright) ' + version, systeme: os.platform() + ' ' + os.release(), tailles: TAILLES, resultats, echecs }, null, 2));
console.log('\n' + resultats.length + ' contrôles · ' + echecs + ' échec(s)');
process.exit(echecs ? 1 : 0);
