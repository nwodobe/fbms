/* REPÈRES GPS · recette de l'écran dans un vrai navigateur (Chromium, écran de téléphone).
   Serveur SIMULÉ dans la page (tests/reperes-gps/banc.html) : ce banc prouve le comportement
   du téléphone (stockage durable, file, messages), pas celui du serveur réel (voir
   serveur_reperes.sql) ni la réception sur Android (voir la recette émulateur).
   Lancer : node tests/reperes-gps/navigateur.mjs [dossier de captures]
   Prérequis : Playwright + Chromium (npm install --no-save playwright@1.49.1). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const captures = process.argv[2] ? path.resolve(process.argv[2]) : path.join(racine, 'tests/reperes-gps/resultats');
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
const base = 'http://127.0.0.1:' + serveur.address().port + '/tests/reperes-gps/banc.html';
const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222', P3 = '33333333-3333-4333-8333-333333333333';
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

const resultats = []; let echecs = 0;
function verdict(nom, ok, detail) { resultats.push({ nom, ok: !!ok, detail: detail || '' }); if (!ok) echecs++; console.log((ok ? 'OK    ' : 'ECHEC ') + nom + (detail ? ' · ' + detail : '')); }
const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const erreursConsole = [];
let horsLigne = false, parametres = '';
/* Hors ligne simulé dans la page (navigator.onLine = false) : le banc lui-même reste servi en local. */
function adr(hash, params) { if (params !== undefined) parametres = params || ''; const q = [parametres, horsLigne ? 'reseau=non' : ''].filter(Boolean).join('&'); return base + (q ? '?' + q : '') + '#' + hash; }
async function ouvrir(hash, params) {
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) erreursConsole.push(m.text()); });
  await page.goto(adr(hash, params || ''));
  await page.waitForSelector('.ops-route-head');
  return page;
}
const texte = (page) => page.locator('#opsRouteView').innerText();
async function saisir(page, lat, lng) {
  await page.getByRole('button', { name: 'Saisir les coordonnées GPS' }).click();
  await page.fill('#rgLat', lat); await page.fill('#rgLng', lng);
}
const enregistrer = (page) => page.getByRole('button', { name: 'Enregistrer', exact: true }).click();

try {
  /* ---------- A. mode avion, carte jamais chargée ---------- */
  horsLigne = true;
  let page = await ouvrir('reperes');
  let t = await texte(page);
  verdict('A1 hors ligne : la liste des champs préparés s\'affiche sans réseau ni carte', /TESTEUR Un/.test(t) && /Champ éloigné B/.test(t) && /Carte indisponible\. Vous pouvez enregistrer les coordonnées sur ce téléphone\./.test(t));
  await page.screenshot({ path: path.join(captures, '01-accueil-hors-ligne-360.png'), fullPage: true });
  await page.goto(adr('reperes/objet/PARCELLE/' + P2)); await page.waitForSelector('.rg-saisie');
  t = await texte(page);
  verdict('A2 fiche : les quatre libellés attendus sont présents', /Utiliser ma position GPS/.test(t) && /Saisir les coordonnées GPS/.test(t) && /Enregistrer/.test(t) && /Position non renseignée/.test(t));
  verdict('A3 « Enregistrer » est inactif tant qu\'aucune coordonnée n\'est fournie', await page.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled());
  await saisir(page, '7,689512', '-5,031245');
  verdict('A4 deux champs distincts Latitude et Longitude', await page.locator('label[for=rgLat]').count() === 1 && await page.locator('label[for=rgLng]').count() === 1);
  await page.screenshot({ path: path.join(captures, '02-saisie-manuelle-360.png'), fullPage: true });
  await enregistrer(page); await page.waitForSelector('.rg-avis-succes');
  t = await texte(page);
  verdict('A5 message après sauvegarde effective', /Enregistré sur ce téléphone\. En attente de synchronisation\./.test(t), '');
  verdict('A6 le point affiché est celui saisi (virgule acceptée, longitude négative préservée)', /7\.689512 ; -5\.031245/.test(t) && /Saisi à la main/.test(t) && /Précision inconnue/.test(t) && /date inconnue/.test(t));
  verdict('A7 compteur exact : 1 repère en attente', /1 repère en attente de synchronisation/.test(t));
  verdict('A8 transmission et validation affichées séparément', /Sur ce téléphone · en attente/.test(t) && /Non vérifié/.test(t));
  await page.screenshot({ path: path.join(captures, '03-enregistre-en-attente-360.png'), fullPage: true });
  const largeur = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
  verdict('A9 petit écran 360 px : aucun débordement horizontal', largeur[0] <= largeur[1] + 1, largeur.join(' / '));
  const cibles = await page.evaluate(() => [...document.querySelectorAll('#opsRouteView button, #opsRouteView a.btn, #opsRouteView input:not([type=checkbox])')].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44));
  verdict('A10 cibles tactiles d\'au moins 44 px', cibles.length === 0, cibles.join(','));

  /* ---------- B. fermeture forcée puis réouverture ---------- */
  await page.close();
  page = await ouvrir('reperes/champ/' + P2);
  t = await texte(page);
  verdict('B1 après fermeture et réouverture : coordonnées, origine et attente conservées', /7\.689512 ; -5\.031245/.test(t) && /Saisi à la main/.test(t) && /1 repère en attente/.test(t));
  /* brouillon de formulaire : saisie interrompue avant « Enregistrer » */
  await page.goto(adr('reperes/objet/ARBRE/' + A2)); await page.waitForSelector('.rg-saisie');
  await saisir(page, '7,6901', '-5,0309'); await page.waitForTimeout(600); await page.close();
  page = await ouvrir('reperes/objet/ARBRE/' + A2);
  verdict('B2 formulaire non enregistré : les valeurs tapées sont retrouvées après fermeture', await page.inputValue('#rgLat') === '7,6901' && await page.inputValue('#rgLng') === '-5,0309');

  /* ---------- C. coordonnées incorrectes ---------- */
  await page.fill('#rgLat', '95'); await page.fill('#rgLng', '-5,03'); await enregistrer(page); await page.waitForSelector('#rgLatErr:not(:empty)');
  verdict('C1 latitude hors bornes : erreur expliquée, rien d\'enregistré', /entre -90 et 90/.test(await page.textContent('#rgLatErr')));
  await page.fill('#rgLat', '7°41\'22"'); await enregistrer(page); await page.waitForSelector('#rgLatErr:not(:empty)');
  verdict('C2 format degrés-minutes refusé avec le format accepté annoncé', /degrés décimaux/.test(await page.textContent('#rgLatErr')));
  await page.fill('#rgLat', '0'); await page.fill('#rgLng', '0'); await enregistrer(page); await page.waitForSelector('.rg-avis-erreur');
  verdict('C3 0 ; 0 refusé', /n'est pas une position/.test(await texte(page)));
  await page.fill('#rgLat', '7,690100'); await page.fill('#rgLng', '5,030900'); await enregistrer(page); await page.waitForSelector('#rgConfirmer');
  t = await texte(page);
  verdict('C4 signe oublié : alerte, valeur NON modifiée, confirmation exigée', /signe moins devant la longitude/.test(t) && await page.inputValue('#rgLng') === '5,030900');
  await page.getByRole('button', { name: 'Changer le signe de la longitude' }).click();
  verdict('C5 bouton ± : le signe est changé par un geste explicite de l\'agent', await page.inputValue('#rgLng') === '-5,030900');
  await enregistrer(page); await page.waitForSelector('.rg-avis-succes');
  t = await texte(page);
  verdict('C6 arbre A002 enregistré ; compteur à 2', /7\.690100 ; -5\.030900/.test(t) && /2 repères en attente/.test(t));

  /* ---------- D. arbres sans position, point existant, contour ---------- */
  await page.goto(adr('reperes/champ/' + P1)); await page.waitForSelector('.rg-objet-arbre');
  t = await texte(page);
  const sansPosition = (t.match(/Position non renseignée/g) || []).length;
  verdict('D1 un arbre sans coordonnées reste listé « Position non renseignée » (aucune position inventée)', sansPosition === 14, sansPosition + ' objets sans repère sur 15 (parcelle, 2 blocs, 12 arbres ; seul A002 a un repère saisi)');
  verdict('D2 identifiants et rattachements visibles (A001…A012, B01/B02, arbre physique)', /A001/.test(t) && /A012/.test(t) && /B01/.test(t) && /B02/.test(t) && /arbre physique B01\/A001/.test(t));
  verdict('D3 le point déjà capturé par Parcelles/Observatoire est montré à part, non remplacé', /Point GPS de référence \(capturé sur le champ\)/.test(t) && /Position marquée près de l'arbre \(Observatoire\)/.test(t));
  verdict('D4 aucune superficie déduite d\'un point', !/\d\s?ha\b/.test(t) && /ne permet pas de calculer une superficie/.test(t));
  await page.screenshot({ path: path.join(captures, '04-liste-champ-observatoire-360.png'), fullPage: true });
  await page.getByRole('button', { name: 'Voir sur la carte' }).click(); await page.waitForTimeout(300);
  verdict('D5 carte indisponible (aucune bibliothèque, hors ligne) : message, la liste reste complète', /Carte indisponible\. Vous pouvez enregistrer les coordonnées sur ce téléphone\./.test(await texte(page)));

  /* ---------- E. GPS refusé ---------- */
  await page.goto(adr('reperes/objet/BLOC/bbbbbbbb-bbbb-4bbb-8bbb-000000000001')); await page.waitForSelector('.rg-saisie');
  await page.getByRole('button', { name: 'Utiliser ma position GPS' }).click(); await page.waitForSelector('.rg-avis-alerte');
  t = await texte(page);
  verdict('E1 GPS refusé ou indisponible : message clair, saisie manuelle toujours proposée', /(refusé|introuvable|à temps)/.test(t) && /La saisie manuelle reste possible/.test(t) && await page.getByRole('button', { name: 'Saisir les coordonnées GPS' }).isEnabled());

  /* ---------- F. accord GPS absent ---------- */
  await page.goto(adr('reperes/objet/PARCELLE/' + P3)); await page.waitForSelector('.rg-avis-alerte');
  t = await texte(page);
  verdict('F1 accord GPS non enregistré : aucune saisie proposée, renvoi vers le recueil de l\'accord', /Accord GPS non enregistré/.test(t) && await page.locator('.rg-saisie').count() === 0);

  /* ---------- G. réseau présent, serveur inaccessible ---------- */
  horsLigne = false;
  await page.evaluate(() => window.BANC.mode('muet'));
  await page.goto(adr('reperes')); await page.waitForSelector('.rg-sync');
  await page.getByRole('button', { name: 'Synchroniser' }).click(); await page.waitForSelector('.rg-avis-alerte');
  t = await texte(page);
  verdict('G1 serveur muet : rien n\'est perdu, toujours 2 en attente', /Le serveur n'a pas répondu/.test(t) && /2 repères en attente/.test(t));
  await page.evaluate(() => window.BANC.mode('absent'));
  await page.getByRole('button', { name: 'Synchroniser' }).click(); await page.waitForSelector('.rg-avis-alerte');
  verdict('G2 serveur pas encore mis à jour (ancienne base) : repères conservés, message explicite', /n'est pas encore prêt/.test(await texte(page)) && /2 repères en attente/.test(await texte(page)));

  /* ---------- H. retour du serveur, reprises répétées ---------- */
  await page.evaluate(() => window.BANC.mode('ok'));
  await page.getByRole('button', { name: 'Synchroniser' }).click(); await page.waitForSelector('.rg-avis-succes');
  t = await texte(page);
  verdict('H1 transmission confirmée par accusé : 2 transmis, 0 en attente', /2 repère\(s\) transmis au serveur/.test(t) && /Aucun repère en attente/.test(t));
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Synchroniser' }).click(); await page.waitForTimeout(250); }
  let srv = await page.evaluate(() => window.BANC.serveur());
  verdict('H2 reprises répétées : aucun doublon côté serveur', srv.lignes.length === 2, srv.lignes.length + ' ligne(s)');
  verdict('H3 chaque repère est relié au bon objet', srv.lignes.some((l) => l.cle === 'PARCELLE:' + P2 && l.payload.latitude === 7.689512 && l.payload.longitude === -5.031245 && l.payload.precision_m === null && l.payload.origine === 'SAISIE_MANUELLE')
    && srv.lignes.some((l) => l.cle === 'ARBRE:' + A2 && l.payload.longitude === -5.0309 && l.payload.confirmer_hors_zone === false));
  await page.goto(adr('reperes/champ/' + P2)); await page.waitForSelector('.rg-objet');
  verdict('H4 après synchronisation : « Transmis au serveur » et toujours « Non vérifié »', /Transmis au serveur/.test(await texte(page)) && /Non vérifié/.test(await texte(page)));
  await page.screenshot({ path: path.join(captures, '05-transmis-non-verifie-360.png'), fullPage: true });

  /* ---------- I. conflit entre deux appareils ---------- */
  await page.evaluate((cle) => window.BANC.poser(cle, { version_no: 2, latitude: 7.6899, longitude: -5.0311, origine: 'GPS_APPAREIL', precision_m: 6.4, releve_le: '2026-11-23T08:10:00Z', created_at: '2026-11-23T08:11:00Z' }), 'PARCELLE:' + P2);
  await page.goto(adr('reperes/objet/PARCELLE/' + P2)); await page.waitForSelector('.rg-saisie');
  await saisir(page, '7,688000', '-5,030000'); await enregistrer(page); await page.waitForSelector('#rgMotifErr:not(:empty)');
  verdict('I1 correction : le motif est obligatoire', /motif/.test(await page.textContent('#rgMotifErr')));
  await page.fill('#rgMotif', 'Relevé corrigé (banc)'); await enregistrer(page); await page.waitForSelector('.rg-compare');
  t = await texte(page);
  verdict('I2 conflit détecté : les DEUX positions sont montrées, rien n\'est écrasé', /Conflit/.test(t) && /7\.688000 ; -5\.030000/.test(t) && /7\.689900 ; -5\.031100/.test(t) && /version 2/.test(t));
  await page.screenshot({ path: path.join(captures, '06-conflit-360.png'), fullPage: true });
  srv = await page.evaluate(() => window.BANC.serveur());
  verdict('I3 côté serveur : la version de l\'autre appareil est intacte', srv.actifs['PARCELLE:' + P2].version_no === 2 && srv.actifs['PARCELLE:' + P2].latitude === 7.6899);
  await page.fill('#rgMotifConflit', 'Maintien après comparaison (banc)');
  await page.getByRole('button', { name: 'Maintenir ma saisie' }).click(); await page.waitForSelector('.rg-avis-succes');
  await page.waitForTimeout(400); await page.goto(adr('reperes/champ/' + P2)); await page.waitForSelector('.rg-objet');
  srv = await page.evaluate(() => window.BANC.serveur());
  verdict('I4 résolution explicite : version 3 sur le serveur, historique complet', srv.actifs['PARCELLE:' + P2].version_no === 3 && srv.actifs['PARCELLE:' + P2].latitude === 7.688 && srv.lignes.filter((l) => l.cle === 'PARCELLE:' + P2).length === 2);

  /* ---------- J. refus du serveur : la saisie est conservée ---------- */
  await page.evaluate(() => window.BANC.mode('refus'));
  await page.goto(adr('reperes/objet/BLOC/bbbbbbbb-bbbb-4bbb-8bbb-000000000002')); await page.waitForSelector('.rg-saisie');
  await saisir(page, '7,6893', '-5,0307'); await enregistrer(page); await page.waitForSelector('.rg-avis-alerte');
  await page.goto(adr('reperes/objet/BLOC/bbbbbbbb-bbbb-4bbb-8bbb-000000000002')); await page.waitForSelector('.rg-actuel');
  t = await texte(page);
  verdict('J1 refus du serveur : motif affiché, saisie conservée, relance proposée', /Le serveur a refusé ce repère/.test(t) && /accord/.test(t) && /7\.689300 ; -5\.030700/.test(t) && /Relancer l'envoi/.test(t));
  await page.goto(adr('reperes/journal')); await page.waitForSelector('.rg-journal-ligne');
  t = await texte(page);
  verdict('J2 journal : erreurs consultables, compteur « à traiter » exact', /Refusé par le serveur/.test(t) && /1 à traiter/.test(t));
  await page.screenshot({ path: path.join(captures, '07-journal-360.png'), fullPage: true });
  await page.evaluate(() => window.BANC.mode('ok'));
  await page.getByRole('button', { name: 'Relancer l\'envoi' }).first().click(); await page.waitForTimeout(600);
  srv = await page.evaluate(() => window.BANC.serveur());
  verdict('J3 relance après correction de la cause : transmis, sans seconde saisie', srv.lignes.some((l) => l.cle.startsWith('BLOC:') && l.payload.latitude === 7.6893));

  /* ---------- K. changement de compte sur le même téléphone ---------- */
  await page.close();
  horsLigne = true;
  page = await ouvrir('reperes/objet/ARBRE/aaaaaaaa-aaaa-4aaa-8aaa-000000000003');
  await saisir(page, '7,6902', '-5,0308'); await enregistrer(page); await page.waitForSelector('.rg-avis-succes'); await page.close();
  horsLigne = false;
  const avant = (await (await ouvrir('reperes')).evaluate(() => window.BANC.serveur())).lignes.length;
  page = await ouvrir('reperes/champ/' + P1, 'compte=u-autre');
  await page.waitForTimeout(500);
  t = await texte(page);
  verdict('K1 autre compte : il ne voit ni le repère ni la file du premier agent', !/7\.690200/.test(t) && /Aucun repère en attente/.test(t));
  await page.getByRole('button', { name: 'Synchroniser' }).click(); await page.waitForTimeout(500);
  srv = await page.evaluate(() => window.BANC.serveur());
  verdict('K2 autre compte : rien n\'est transmis sous son identité', srv.lignes.length === avant && !srv.lignes.some((l) => l.compte === 'u-autre'), srv.lignes.length + ' = ' + avant);
  await page.close();
  page = await ouvrir('reperes/objet/PARCELLE/' + P2, 'compte=aucun');
  verdict('K3 aucun compte connecté : aucune saisie possible (l\'absence d\'utilisateur ne vaut pas autorisation)', await page.locator('.rg-saisie').count() === 0);
  await page.close();
  page = await ouvrir('reperes/objet/PARCELLE/' + P2, 'compte=u-zh&role=Zonal%20Head');
  verdict('K4 profil sans droit de saisie : consultation seule', await page.locator('.rg-saisie').count() === 0 && /Votre profil consulte les repères/.test(await texte(page)));
  await page.close();
  page = await ouvrir('reperes');
  await page.waitForTimeout(700);
  t = await texte(page);
  verdict('K5 retour du premier agent : son repère en attente est intact puis transmis', /Aucun repère en attente|1 repère en attente/.test(t));

  /* ---------- L. référentiel non préparé ---------- */
  await page.close();
  page = await ouvrir('reperes', 'compte=u-neuf&prepare=non');
  t = await texte(page);
  verdict('L1 rien de préparé : l\'écran dit ce qui manque et comment le préparer', /Aucun champ n'est préparé sur ce téléphone/.test(t) && /Préparer mes champs/.test(t) && /Préparer le hors-ligne/.test(t));
  await page.screenshot({ path: path.join(captures, '08-rien-prepare-360.png'), fullPage: true });

  /* ---------- M. trois largeurs ---------- */
  for (const [l, h] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width: l, height: h });
    await page.goto(adr('reperes/champ/' + P1, '')); await page.waitForSelector('.rg-objet-arbre');
    const d = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
    verdict('M  largeur ' + l + ' × ' + h + ' : aucun débordement horizontal', d[0] <= d[1] + 1, d.join(' / '));
    await page.screenshot({ path: path.join(captures, '09-champ-' + l + '.png'), fullPage: true });
  }
  verdict('N  aucune erreur JavaScript pendant tout le parcours', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
} catch (e) {
  verdict('EXCEPTION du banc', false, String(e && e.stack || e).slice(0, 600));
} finally {
  await navigateur.close(); serveur.close();
  fs.writeFileSync(path.join(captures, 'navigateur.json'), JSON.stringify({ le: new Date().toISOString(), environnement: 'Chromium (Playwright), serveur simulé, données fictives', total: resultats.length, echecs, resultats }, null, 1));
  console.log('\n' + resultats.length + ' contrôles · ' + echecs + ' échec(s)');
  process.exit(echecs ? 1 : 0);
}
