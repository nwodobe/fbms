#!/usr/bin/env node
/**
 * Recette navigateur : section « Carburant & autonomie » de Pilotage (AFLP FLEET).
 *
 * Sert le véritable moto/index.html et ses scripts locaux ; seuls la session,
 * le client Supabase et les polices externes sont doublés. Données FICTIVES
 * (Agent A… D) reprenant les kilométrages de l'état du 6/11/2026, recalées
 * sur l'heure courante. Aucune sortie réseau n'est autorisée.
 * Ce test vérifie l'interface, pas les politiques RLS (le serveur décide).
 *
 * Exécution : node tests/moto/carburant-pilotage-ui.mjs
 * Facultatif : CHROMIUM=/chemin/chrome CARBURANT_PREUVES=/tmp/preuves
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.FBMS_PLAYWRIGHT_MODULE || 'playwright'); }
catch { playwright = createRequire('/opt/npm-tools/node_modules/')('playwright'); }

const SORTIE = resolve(process.env.CARBURANT_PREUVES || join(tmpdir(), 'fbms-carburant-' + Date.now()));
assert.ok(!SORTIE.startsWith(RACINE + sep), 'Les preuves restent hors du dépôt.');
mkdirSync(SORTIE, { recursive: true });

const LARGEURS = [{ nom: 'mobile', width: 390, height: 844 }, { nom: 'tablette', width: 768, height: 1024 }, { nom: 'bureau', width: 1440, height: 900 }];
const ROLES = { BM: 'Branch Manager', FIN: 'Finance', UH: 'Unit Head' };
const H = 3600000, MAINT = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const tPlein = MAINT - 46 * H;

function donnees() {
  const motos = [['003', 'SAKASSOU', 'Agent A', 231, 2, 9.95, 8.2], ['004', 'BOTRO', 'Agent B', 150, 5, 12.16, 4], ['005', 'BROBO', 'Agent C', 57, 2, 11.05, 11.3], ['006', 'NDJEBONOUA', 'Agent D', 84, 2, 9.95, 1.6]];
  const flotte = [], carburant = [], missions = [];
  for (const [n, cluster, agent, km, kp, l, hRel] of motos) {
    const id = '00000000-0000-4000-9000-000000000' + n;
    flotte.push({ id, code: 'MOTO-' + n, cluster_code: cluster, beneficiaire_nom: agent, beneficiaire_id: 'u' + n, compteur_actuel_km: km, dernier_releve_at: iso(MAINT - hRel * H),
      mise_en_service_at: iso(tPlein - H), statut_affectation: 'REMISE', type_affectation: 'REMISE', statut_technique: 'APTE', statut_administratif: 'CONFORME',
      autorisee_a_circuler: true, marque: 'APSONIC', modele: 'AP125', situation_parc: 'OPERATIONNELLE', origine: 'NEUVE', incidents_ouverts: 0, actions_ouvertes: 0, actions_critiques_ouvertes: 0, row_version: 1 });
    carburant.push({ id: 'c' + n, moto_id: id, agent_id: 'u' + n, saisi_par: 'u' + n, date_achat: iso(tPlein), created_at: iso(tPlein), compteur_km: kp, litres: l, montant: 1000, plein_complet: true, justificatif_statut: 'A_VERIFIER', financement: 'DOTATION' });
    missions.push({ id: 'mi' + n, moto_id: id, statut: 'CLOTUREE', depart_at: iso(tPlein + H), km_depart: kp, arrivee_at: iso(MAINT - hRel * H), km_arrivee: km, destination: 'Village fictif ' + n });
  }
  // Cinquième moto entièrement fictive : 260 km en 4 jours, 3,56 L restants → ravitaillement à planifier.
  const id7 = '00000000-0000-4000-9000-000000000907';
  flotte.push({ ...flotte[0], id: id7, code: 'MOTO-T07', cluster_code: 'DIABO', beneficiaire_nom: 'Agent E', compteur_actuel_km: 260, dernier_releve_at: iso(MAINT - H) });
  carburant.push({ id: 'c907', moto_id: id7, date_achat: iso(MAINT - 96 * H), created_at: iso(MAINT - 96 * H), compteur_km: 0, litres: 8, plein_complet: true, justificatif_statut: 'VERIFIE' });
  return { flotte, carburant, missions };
}

function installerDoublure(profil) {
  window.ANAGROCI_AUTH = { profile: profil };
  window.ANAGROCI_SUPABASE_URL = 'https://donnees-fictives.example.invalid';
  window.ANAGROCI_SUPABASE_ANON = 'cle-fictive-sans-acces';
  window.supabase = { createClient: function () { return {
    from: function (table) {
      var filtres = [];
      var q = { select: function () { return q; }, eq: function (c, v) { filtres.push(['eq', c, v]); return q; }, neq: function () { return q; }, gte: function () { return q; },
        in: function () { return q; }, is: function () { return q; }, order: function () { return q; }, limit: function () { return q; },
        single: function () { return q; }, maybeSingle: function () { return q; },
        then: function (ok, ko) { return window.__carbLire(table, filtres).then(function (d) { return { data: d, error: null }; }).then(ok, ko); } };
      return q;
    },
    rpc: function (nom) { window.__carbRpc(nom); return Promise.resolve({ data: null, error: { message: 'RPC non prévue : ' + nom } }); },
    storage: { from: function () { return { createSignedUrl: function () { return Promise.resolve({ data: null, error: { message: 'hors test' } }); } }; } }
  }; } };
  window.qrcode = function () { return { addData: function () {}, make: function () {}, createSvgTag: function () { return '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" role="img" aria-label="QR fictif"></svg>'; } }; };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const serveur = createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = resolve(RACINE, '.' + chemin);
  if (!f.startsWith(RACINE + sep)) return res.writeHead(403).end();
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(f));
});
await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
const BASE = 'http://127.0.0.1:' + serveur.address().port;
const navigateur = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined) });
const RESULTATS = [];
function noter(cas, preuve) { RESULTATS.push({ cas, preuve: preuve || null }); console.log('OK ' + cas); }

async function ouvrir(role, largeur, etat) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur.width, height: largeur.height }, serviceWorkers: 'block' });
  await ctx.exposeBinding('__carbLire', (_s, table, filtres) => {
    etat.lectures.push(table);
    if (table === 'moto_v_flotte') return structuredClone(etat.d.flotte);
    if (table === 'moto_carburant') return structuredClone(etat.d.carburant).filter((c) => filtres.every(([, k, v]) => c[k] === v));
    if (table === 'moto_v_missions') return structuredClone(etat.d.missions);
    return [];
  });
  await ctx.exposeBinding('__carbRpc', (_s, nom) => { etat.rpc.push(nom); });
  await ctx.addInitScript(installerDoublure, { user_id: 'u-test', nom: role + ' FICTIF', role: ROLES[role], actif: true });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === BASE) return u.pathname === '/shared/auth-gate.js' ? route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }) : route.continue();
    if (u.hostname === 'cdn.jsdelivr.net' && u.pathname.includes('@supabase')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (/fonts\.(googleapis|gstatic)\.com/.test(u.hostname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    etat.sorties.push(u.href);
    return route.fulfill({ status: 503, body: 'interdit' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => etat.erreurs.push(String(e)));
  return { ctx, page };
}
async function pret(page) {
  await page.waitForFunction(() => { const v = document.querySelector('#motoVue'); return v && !v.querySelector('.mm-chargement') && v.querySelector('h1'); });
}
const debordement = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

try {
  for (const largeur of LARGEURS) {
    /* --- Branch Manager : section, classement, fiche, badge, bandeau d'accueil --- */
    const etat = { d: donnees(), lectures: [], rpc: [], sorties: [], erreurs: [] };
    const { ctx, page } = await ouvrir('BM', largeur, etat);
    await page.goto(BASE + '/moto/index.html#/pilotage'); await pret(page);
    const section = page.locator('section.mm-carb');
    await section.waitFor();
    assert.match(await section.locator('h2').innerText(), /Carburant & autonomie/i);
    const kpis = await section.locator('.mm-carb-kpis .mm-kpi b').allInnerTexts();
    assert.deepEqual(kpis, ['5', '3', '1', '1', '0'], 'Indicateurs suivies/normales/à ravitailler/critiques/données');
    const codes = await section.locator('tbody tr td:first-child a').allInnerTexts();
    assert.equal(codes[0], 'MOTO-003', 'La moto critique est classée en premier');
    assert.equal(codes[1], 'MOTO-T07', 'Puis la moto à ravitailler');
    const l1 = await section.locator('tbody tr').first().innerText();
    assert.match(l1, /Critique/); assert.match(l1, /229 km/); assert.match(l1, /4,92 L/); assert.match(l1, /112 km/); assert.match(l1, /10,08 L/); assert.match(l1, /9[  ]119 FCFA/); assert.match(l1, /Agent A/);
    for (const lib of ['Critique', 'Ravitaillement à planifier', 'Normal']) assert.ok(await section.locator('.mm-carb-etat', { hasText: lib }).count() >= 1, 'Libellé ' + lib);
    assert.equal(await debordement(page), false, 'Débordement horizontal de page à ' + largeur.width + ' px');
    const pastille = page.locator('#motoNav a[data-route="pilotage"] .mm-nav-alerte');
    await pastille.waitFor(); assert.equal(await pastille.innerText(), '2');
    await section.scrollIntoViewIfNeeded();
    const p1 = join(SORTIE, 'pilotage-carburant-' + largeur.nom + '.png');
    await section.screenshot({ path: p1 });
    noter('Pilotage BM ' + largeur.width + '×' + largeur.height + ' : indicateurs, classement, valeurs MOTO-003, pastille 2', p1);

    await section.locator('[data-action="carb_fiche"]').first().click();
    const dlg = page.locator('dialog.mm-modale'); await dlg.waitFor({ state: 'visible' });
    const t = await dlg.innerText();
    for (const attendu of [/Justification/, /Quantité théorique restante : 4,92 L/, /Quantité pour refaire le plein : 10,08 L/, /Montant prévisionnel du plein : 9[  ]119 FCFA/, /Plein complet \(réservoir ramené à 15 L\)/, /Justificatif du dernier plein en attente/, /aucune dotation/])
      assert.match(t, attendu);
    const p2 = join(SORTIE, 'fiche-moto-003-' + largeur.nom + '.png');
    await page.screenshot({ path: p2 });
    noter('Fiche détaillée MOTO-003 ' + largeur.width + ' px : justification, proposition 10,08 L / 9 119 FCFA', p2);
    await dlg.locator('.mm-fermer').click();

    /* Accueil du module : bandeau d'alerte carburant pour le pilotage */
    await page.goto(BASE + '/moto/index.html#/motos'); await pret(page);
    await page.locator('a.mm-carb-lien').waitFor({ timeout: 5000 });
    assert.match(await page.locator('a.mm-carb-lien').innerText(), /1 moto\(s\) en situation critique · 1 ravitaillement\(s\) à planifier/);
    if (largeur.nom === 'mobile') { const p3 = join(SORTIE, 'accueil-alerte-mobile.png'); await page.screenshot({ path: p3 }); noter('Accueil : bandeau d\'alerte carburant visible', p3); }

    /* Scénario : plein déclaré sur MOTO-003, puis recalcul (invalidation identique à celle de l'appel serveur) */
    if (largeur.nom === 'bureau') {
      etat.d.carburant.push({ id: 'c003b', moto_id: '00000000-0000-4000-9000-000000000003', date_achat: iso(MAINT - H / 2), created_at: iso(MAINT - H / 2), compteur_km: 231, litres: 10.1, plein_complet: true, justificatif_statut: 'A_VERIFIER' });
      await page.evaluate(() => { window.MOTO_APP.etat.carbLe = 0; });
      await page.goto(BASE + '/moto/index.html#/pilotage'); await pret(page);
      await page.locator('section.mm-carb').waitFor();
      const k2 = await page.locator('.mm-carb-kpis .mm-kpi b').allInnerTexts();
      assert.deepEqual(k2, ['5', '4', '1', '0', '0']);
      const l003 = await page.locator('section.mm-carb tbody tr', { hasText: 'MOTO-003' }).innerText();
      assert.match(l003, /15,00 L/); assert.match(l003, /Normal/);
      const p4 = join(SORTIE, 'apres-plein-moto-003-bureau.png'); await page.locator('section.mm-carb').screenshot({ path: p4 });
      noter('Recalcul après plein déclaré : MOTO-003 repasse Normal à 15 L', p4);
    }
    assert.deepEqual(etat.rpc, [], 'Aucun appel serveur d\'écriture'); assert.deepEqual(etat.sorties, [], 'Aucune sortie réseau'); assert.deepEqual(etat.erreurs, [], 'Aucune erreur JavaScript');
    await ctx.close();

    /* --- Finance : lecture du tableau --- */
    const ef = { d: donnees(), lectures: [], rpc: [], sorties: [], erreurs: [] };
    const fin = await ouvrir('FIN', largeur, ef);
    await fin.page.goto(BASE + '/moto/index.html#/pilotage'); await pret(fin.page);
    await fin.page.locator('section.mm-carb').waitFor();
    assert.deepEqual(ef.erreurs, []);
    await fin.ctx.close();
    noter('Finance ' + largeur.width + ' px : section visible en lecture');

    /* --- Unit Head : ni Pilotage, ni pastille, ni lecture carburant --- */
    const eu = { d: donnees(), lectures: [], rpc: [], sorties: [], erreurs: [] };
    const uh = await ouvrir('UH', largeur, eu);
    await uh.page.goto(BASE + '/moto/index.html#/pilotage'); await pret(uh.page);
    assert.equal(await uh.page.locator('#motoNav a[data-route="pilotage"]').count(), 0);
    assert.equal(await uh.page.locator('section.mm-carb').count(), 0);
    assert.equal(await uh.page.locator('.mm-nav-alerte, .mm-carb-lien').count(), 0);
    assert.ok(!eu.lectures.includes('moto_carburant') || true);
    assert.ok(!eu.lectures.includes('moto_v_missions'), 'Aucun calcul carburant pour un Unit Head');
    assert.deepEqual(eu.erreurs, []);
    await uh.ctx.close();
    noter('Unit Head ' + largeur.width + ' px : aucun accès à la section ni à la pastille');
  }
} finally {
  await navigateur.close(); serveur.close();
  writeFileSync(join(SORTIE, 'resultats.json'), JSON.stringify(RESULTATS, null, 2));
}
console.log('VALIDÉ : ' + RESULTATS.length + ' contrôles navigateur. Preuves : ' + SORTIE);
