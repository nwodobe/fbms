/* SIGNALEMENTS GPS · recette de l'écran dans un vrai navigateur (Chromium).
   Serveur SIMULÉ dans la page (tests/signalements-gps/banc.html), qui reprend les règles de la
   migration : ce banc prouve l'écran (boutons par profil, motif obligatoire, point jamais
   modifié, liste du Chef d'Unité, résolution motivée), pas le serveur réel (voir
   serveur_signalements.sql, joué sur la recette) ni Android.
   Lancer : node tests/signalements-gps/navigateur.mjs [dossier de captures]
   Prérequis : Playwright + Chromium (PLAYWRIGHT_DIR si hors du dépôt). Données 100 % fictives. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const captures = process.argv[2] ? path.resolve(process.argv[2]) : path.join(racine, 'tests/signalements-gps/resultats');
fs.mkdirSync(captures, { recursive: true });
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright')); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const serveur = http.createServer((req, res) => {
  const f = path.join(racine, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(racine) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
});
await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
const base = 'http://127.0.0.1:' + serveur.address().port + '/tests/signalements-gps/banc.html';
const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222';

const resultats = []; let echecs = 0;
function verdict(nom, ok, detail) { resultats.push({ nom, ok: !!ok, detail: detail || '' }); if (!ok) echecs++; console.log((ok ? 'OK    ' : 'ECHEC ') + nom + (detail ? ' · ' + detail : '')); }
const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const erreursConsole = [];
async function ouvrir(params, hash) {
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) erreursConsole.push(m.text()); });
  await page.goto(base + '?' + params + '#' + hash);
  await page.waitForSelector('.ops-route-head');
  await page.waitForTimeout(250);
  return page;
}
const texte = (page) => page.locator('#opsRouteView').innerText();
const serveurEtat = (page) => page.evaluate(() => window.BANC.serveur());
async function mesures(page, nom) {
  const l = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
  const petites = await page.evaluate(() => [...document.querySelectorAll('.sg-section button, .sg-liste a, .sg-section textarea, .sg-section summary, .sg-radio')].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44));
  verdict(nom + ' : aucun débordement horizontal, cibles ≥ 44 px', l[0] <= l[1] + 1 && petites.length === 0, l.join(' / ') + (petites.length ? ' · petites : ' + petites.join(',') : ''));
}

try {
  /* ---------- A. Branch Manager, Repères GPS : signaler le point de référence ---------- */
  let page = await ouvrir('role=Branch Manager', 'reperes/objet/PARCELLE/' + P1);
  await page.evaluate(() => localStorage.removeItem('banc_sg')); await page.reload(); await page.waitForSelector('.ops-route-head'); await page.waitForTimeout(250);
  let t = await texte(page);
  verdict('A1 BM : « Signaler ce point » visible sous le point GPS de référence', await page.getByRole('button', { name: 'Signaler ce point' }).count() === 1);
  await page.getByRole('button', { name: 'Signaler ce point' }).click();
  await page.waitForSelector('.sg-form');
  t = await texte(page);
  verdict('A2 formulaire : point concerné, distance au village calculée, « pas modifié » annoncé', /7\.689200 ; -5\.031200/.test(t) && /du centre du village/.test(t) && /ne sera pas modifié/.test(t));
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click();
  verdict('A3 sans motif choisi : refus à l\'écran, rien envoyé', /Choisissez le motif/.test(await texte(page)) && !((await serveurEtat(page)).appels || []).some((a) => a.nom === 'geo_signalement_creer'));
  await page.getByLabel('Point pris hors du champ (au village, sur la route…)').check();
  await page.fill('#sgMotif', 'court');
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click();
  verdict('A4 motif trop court : refus à l\'écran', /10 caractères au moins/.test(await texte(page)));
  await page.screenshot({ path: path.join(captures, '01-formulaire-signalement-390.png'), fullPage: true });
  await page.fill('#sgMotif', 'Point pris au village, le champ est à environ 4 km');
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click();
  await page.waitForSelector('.sg-avis-succes');
  t = await texte(page);
  const s1 = await serveurEtat(page), appel = (s1.appels || []).filter((a) => a.nom === 'geo_signalement_creer').pop();
  verdict('A5 envoyé : message de succès, signalement ouvert affiché', /Point signalé\./.test(t) && /Point GPS signalé par la supervision/.test(t) && /97 m du centre du village/.test(t));
  verdict('A6 demande envoyée : cible, motif, point vu à l\'écran', appel && appel.args.p.cible_type === 'POINT_PARCELLE' && appel.args.p.plot_id === P1 && appel.args.p.motif_code === 'CAPTURE_HORS_CHAMP' && appel.args.p.point_latitude === 7.6892 && appel.args.p.point_longitude === -5.0312);
  verdict('A7 le point n\'est jamais modifié : aucun envoi de repère ni de point', !(s1.appels || []).some((a) => a.nom !== 'geo_signalement_creer'));
  verdict('A8 un signalement ouvert : plus de bouton « Signaler ce point », formulaire de résolution présent', await page.getByRole('button', { name: 'Signaler ce point' }).count() === 0 && await page.getByRole('button', { name: 'Résoudre' }).count() === 1);
  await page.screenshot({ path: path.join(captures, '02-signalement-ouvert-bm-390.png'), fullPage: true });
  await mesures(page, 'A9 390 px');
  await page.close();

  /* ---------- B. Chef d'Unité : liste, réponse, pas de résolution ---------- */
  page = await ouvrir('role=Unit Head', 'reperes');
  t = await texte(page);
  verdict('B1 Chef d\'Unité : liste « Points GPS signalés à faire vérifier (1) »', /Points GPS signalés à faire vérifier \(1\)/.test(t) && /Sans réponse/.test(t));
  await page.screenshot({ path: path.join(captures, '03-liste-chef-unite-390.png'), fullPage: true });
  await page.locator('a.sg-item').first().click();
  await page.waitForSelector('.sg-section');
  t = await texte(page);
  verdict('B2 la fiche s\'ouvre sur le signalement, motif lisible', /Point GPS signalé par la supervision/.test(t) && /le champ est à environ 4 km/.test(t));
  verdict('B3 Chef d\'Unité : peut répondre, ne peut ni résoudre ni signaler', await page.getByRole('button', { name: 'Envoyer la réponse' }).count() === 1 && await page.getByRole('button', { name: 'Résoudre' }).count() === 0 && await page.getByRole('button', { name: 'Signaler ce point' }).count() === 0);
  const idSg = (await serveurEtat(page)).liste[0].id;
  await page.fill('#sgRep_' + idSg, 'ok');
  await page.getByRole('button', { name: 'Envoyer la réponse' }).click();
  verdict('B4 réponse trop courte : refus à l\'écran', /au moins 10 caractères/.test(await texte(page)));
  await page.fill('#sgRep_' + idSg, 'Agent envoyé sur le champ demain pour reprendre le point');
  await page.getByRole('button', { name: 'Envoyer la réponse' }).click();
  await page.waitForSelector('.sg-avis-succes');
  t = await texte(page);
  verdict('B5 réponse enregistrée, visible dans le journal, signalement toujours ouvert', /Réponse enregistrée/.test(t) && /Agent envoyé sur le champ demain/.test(t) && /Point GPS signalé par la supervision/.test(t));
  await page.screenshot({ path: path.join(captures, '04-reponse-chef-unite-390.png'), fullPage: true });
  await page.close();

  /* ---------- C. Chef de Zone : résolution motivée ---------- */
  page = await ouvrir('role=Zonal Head', 'reperes/objet/PARCELLE/' + P1);
  await page.getByRole('button', { name: 'Résoudre' }).click();
  verdict('C1 résolution non choisie : refus à l\'écran', /Choisissez la résolution/.test(await texte(page)));
  await page.getByLabel('Point corrigé (repris sur le champ)').check();
  await page.fill('#sgResM_' + idSg, 'Point repris sur le champ');
  await page.getByRole('button', { name: 'Résoudre' }).click();
  await page.waitForSelector('.sg-avis-erreur');
  verdict('C2 « Point corrigé » alors que le point n\'a pas changé : refus du serveur affiché', /n'a pas changé depuis le signalement/.test(await texte(page)));
  await page.getByLabel('Point confirmé exact').check();
  await page.fill('#sgResM_' + idSg, 'Contrôle sur place : le point est bien sur le champ');
  await page.getByRole('button', { name: 'Résoudre' }).click();
  await page.waitForSelector('.sg-avis-succes');
  t = await texte(page);
  verdict('C3 point confirmé : signalement classé, historique « Signalements clos (1) », bouton de nouveau signalement', /Signalement classé/.test(t) && /Signalements clos \(1\)/.test(t) && await page.getByRole('button', { name: 'Signaler ce point' }).count() === 1);
  await page.locator('.sg-historique summary').click();
  verdict('C4 historique : résolution motivée, rôle et motif d\'origine', /Classé · Point confirmé exact/.test(await texte(page)) && /le point est bien sur le champ/.test(await texte(page)));
  await page.screenshot({ path: path.join(captures, '05-classe-chef-zone-390.png'), fullPage: true });
  await page.close();

  /* ---------- D. fiche parcelle (operations/parcelles.js), signalement puis correction réelle ---------- */
  page = await ouvrir('page=parcelles&role=Branch Manager', 'parcelles/p/' + P1);
  await page.waitForSelector('.pc-point');
  verdict('D1 fiche parcelle : « Signaler ce point » sous le point GPS de référence', await page.locator('.pc-point').getByRole('button', { name: 'Signaler ce point' }).count() === 1);
  await page.getByRole('button', { name: 'Signaler ce point' }).click();
  await page.getByLabel('Position incohérente avec le champ connu').check();
  await page.fill('#sgMotif', 'Point à 97 m du centre du village, champ à 4 km');
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click();
  await page.waitForSelector('.sg-avis-succes');
  verdict('D2 fiche parcelle : signalement ouvert affiché', /Point GPS signalé par la supervision/.test(await texte(page)));
  await page.screenshot({ path: path.join(captures, '06-fiche-parcelle-390.png'), fullPage: true });
  await page.goto(base + '?page=parcelles&role=Unit Head#parcelles'); await page.waitForSelector('.ops-route-head'); await page.waitForTimeout(300);
  verdict('D3 accueil Parcelles du Chef d\'Unité : liste des points signalés', /Points GPS signalés à faire vérifier \(1\)/.test(await texte(page)));
  await page.evaluate(() => window.BANC.deplacerPoint());
  await page.goto(base + '?page=parcelles&role=Branch Manager#parcelles/p/' + P1); await page.waitForSelector('.pc-point'); await page.waitForTimeout(300);
  const id2 = (await serveurEtat(page)).liste.filter((x) => x.statut === 'OUVERT')[0].id;
  await page.getByLabel('Point corrigé (repris sur le champ)').check();
  await page.fill('#sgResM_' + id2, 'Point repris sur le champ par l\'agent');
  await page.getByRole('button', { name: 'Résoudre' }).click();
  await page.waitForSelector('.sg-avis-succes');
  verdict('D4 point réellement repris : « Point corrigé » accepté, signalement résolu', /Signalement résolu/.test(await texte(page)));
  for (const [l, h] of [[768, 1024], [1440, 900]]) { await page.setViewportSize({ width: l, height: h }); await page.waitForTimeout(150); await mesures(page, 'D5 fiche parcelle ' + l + ' px'); await page.screenshot({ path: path.join(captures, '07-fiche-parcelle-' + l + '.png'), fullPage: true }); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.close();

  /* ---------- E. repère reçu par le serveur : signalable séparément ---------- */
  page = await ouvrir('role=Branch Manager&repere=oui', 'reperes/champ/' + P1);
  await page.goto(base + '?role=Branch Manager&repere=oui#reperes/objet/PARCELLE/' + P1); await page.waitForSelector('.rg-actuel'); await page.waitForTimeout(300);
  verdict('E1 repère reçu et point de référence : deux boutons « Signaler ce point »', await page.getByRole('button', { name: 'Signaler ce point' }).count() === 2, String(await page.getByRole('button', { name: 'Signaler ce point' }).count()));
  await page.locator('.rg-actuel').first().getByRole('button', { name: 'Signaler ce point' }).click();
  await page.getByLabel('Précision douteuse').check();
  await page.fill('#sgMotif', 'Repère saisi à la main, source inconnue');
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click();
  await page.waitForSelector('.sg-avis-succes');
  const a2 = ((await serveurEtat(page)).appels || []).filter((a) => a.nom === 'geo_signalement_creer').pop();
  verdict('E2 repère signalé : cible REPERE avec l\'identifiant du serveur', a2 && a2.args.p.cible_type === 'REPERE' && a2.args.p.repere_id === 'rep-1' && a2.args.p.point_latitude === 7.7101);
  await page.close();

  /* ---------- F. hors ligne, serveur sans migration, serveur muet ---------- */
  page = await ouvrir('role=Branch Manager&reseau=non', 'reperes/objet/PARCELLE/' + P1);
  t = await texte(page);
  verdict('F1 hors ligne : aucun bouton, message clair, la fiche reste utilisable', await page.getByRole('button', { name: 'Signaler ce point' }).count() === 0 && /seront affichés au retour du réseau/.test(t) && /Saisir les coordonnées GPS/.test(t));
  await page.close();
  page = await ouvrir('role=Branch Manager', 'reperes');
  await page.evaluate(() => window.BANC.mode('absent'));
  await page.goto(base + '?role=Branch Manager#reperes/objet/PARCELLE/' + P1); await page.waitForSelector('.rg-actuel'); await page.waitForTimeout(250);
  t = await texte(page);
  verdict('F2 serveur sans la migration : « indisponible », pas de bouton, fiche intacte', /indisponible sur ce serveur/.test(t) && await page.getByRole('button', { name: 'Signaler ce point' }).count() === 0 && /Saisir les coordonnées GPS/.test(t));
  await page.evaluate(() => window.BANC.mode(null));
  await page.goto(base + '?role=Branch Manager#reperes/objet/PARCELLE/' + P2); await page.waitForSelector('.rg-actuel'); await page.waitForTimeout(250);
  verdict('F3 parcelle sans point : rien à signaler', await page.getByRole('button', { name: 'Signaler ce point' }).count() === 0);
  await page.close();

  verdict('G1 aucune erreur de console', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
} catch (e) {
  verdict('EXCEPTION du banc', false, String(e && e.stack || e).slice(0, 400));
} finally {
  await navigateur.close(); serveur.close();
  fs.writeFileSync(path.join(captures, 'navigateur.json'), JSON.stringify({ date: new Date().toISOString(), total: resultats.length, echecs, resultats }, null, 2));
  console.log('\n' + (resultats.length - echecs) + '/' + resultats.length + ' conformes');
  process.exit(echecs ? 1 : 0);
}
