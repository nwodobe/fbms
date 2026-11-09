#!/usr/bin/env node
/**
 * Recette navigateur : correction directe d'un relevé de compteur (AFLP FLEET, migration 22).
 * Sert le vrai moto/index.html ; seuls la session, le client Supabase (lecture des relevés,
 * appel moto_releve_corriger simulé) et les polices sont doublés. Données FICTIVES.
 * Ce test vérifie l'interface et l'appel envoyé ; les règles serveur sont prouvées par
 * tests/moto/tests_correction_compteur_22.py.
 * Exécution : node tests/moto/correction-compteur-ui.mjs   (CORRECTION_PREUVES=/tmp/x facultatif)
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

const SORTIE = resolve(process.env.CORRECTION_PREUVES || join(tmpdir(), 'fbms-correction-km-' + Date.now()));
assert.ok(!SORTIE.startsWith(RACINE + sep), 'Les preuves restent hors du dépôt.');
mkdirSync(SORTIE, { recursive: true });

const LARGEURS = [{ nom: 'mobile', width: 390, height: 844 }, { nom: 'tablette', width: 768, height: 1024 }, { nom: 'bureau', width: 1440, height: 900 }];
const ROLES = { BM: 'Branch Manager', ABM: 'Assistant Branch Manager', ZH: 'Zonal Head', UH: 'Unit Head' };
const H = 3600000, MAINT = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const tPlein = MAINT - 46 * H;

const MOTO = '00000000-0000-4000-9000-000000000003';
function donnees() {
  const flotte = [{ id: MOTO, code: 'MOTO-003', cluster_code: 'SAKASSOU', beneficiaire_nom: 'Agent A', beneficiaire_id: 'u003', compteur_actuel_km: 2602, dernier_releve_at: iso(MAINT - H),
    mise_en_service_at: iso(MAINT - 120 * H), statut_affectation: 'REMISE', type_affectation: 'REMISE', statut_technique: 'APTE', statut_administratif: 'CONFORME',
    autorisee_a_circuler: true, marque: 'APSONIC', modele: 'AP125', situation_parc: 'OPERATIONNELLE', origine: 'NEUVE', incidents_ouverts: 0, actions_ouvertes: 0, actions_critiques_ouvertes: 0, row_version: 1 }];
  const releves = [
    { id: 'r1', moto_id: MOTO, date_releve: iso(MAINT - 3 * H), compteur_km: 233, source: 'MISSION' },
    { id: 'r2', moto_id: MOTO, date_releve: iso(MAINT - 2 * H), compteur_km: 260, source: 'MISSION' },
    { id: 'r3', moto_id: MOTO, date_releve: iso(MAINT - 2 * H + 60000), compteur_km: 2602, source: 'CONTROLE' }];
  return { flotte, releves };
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
    rpc: function (nom, args) { return window.__carbRpc(nom, args).then(function (r) { return r && r.erreur ? { data: null, error: { message: r.erreur } } : { data: r, error: null }; }); },
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
    if (table === 'moto_releves_km') return structuredClone(etat.d.releves).sort((a, b) => b.date_releve.localeCompare(a.date_releve));
    return [];
  });
  await ctx.exposeBinding('__carbRpc', (_s, nom, args) => {
    etat.rpc.push({ nom, args });
    if (nom !== 'moto_releve_corriger') return null;
    const r = etat.d.releves.find((x) => x.id === args.p_releve); const ancien = r.compteur_km;
    r.compteur_km = args.p_nouveau_km; etat.d.flotte[0].compteur_actuel_km = Math.max(...etat.d.releves.map((x) => x.compteur_km));
    return { correction_id: 'c1', releve_id: r.id, ancien_km: ancien, nouveau_km: args.p_nouveau_km, compteur_actuel_km: etat.d.flotte[0].compteur_actuel_km, missions_alignees: 0, controles_alignes: 1, achats_alignes: 0 };
  });
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
    for (const role of ['BM', 'ABM']) {
      const etat = { d: donnees(), lectures: [], rpc: [], sorties: [], erreurs: [] };
      const { ctx, page } = await ouvrir(role, largeur, etat);
      await page.goto(BASE + '/moto/index.html#/moto/' + MOTO + '/kilometrage'); await pret(page);
      await page.waitForSelector('[data-action="corriger_compteur"]');
      const n = await page.locator('[data-action="corriger_compteur"]').count();
      const suspect = page.locator('tr', { hasText: 'Saut suspect' });
      assert.equal(n, 3, 'Un bouton Corriger par relevé'); assert.equal(await suspect.count(), 1, 'Le relevé 2602 est signalé « Saut suspect »');
      assert.match(await suspect.innerText(), /2[  ]602/);
      if (role === 'BM') { const p0 = join(SORTIE, 'kilometrage-avant-' + largeur.nom + '.png'); await page.screenshot({ path: p0, fullPage: true }); noter(`${role} ${largeur.width} px : 3 boutons « Corriger », 2 602 km signalé « Saut suspect »`, p0); }
      await suspect.locator('[data-action="corriger_compteur"]').click();
      const dlg = page.locator('dialog.mm-modale'); await dlg.waitFor({ state: 'visible' });
      assert.match(await dlg.innerText(), /contrôle avant départ/); assert.match(await dlg.innerText(), /2[  ]602/);
      await dlg.locator('[name="motif"]').fill('Faute de frappe : un chiffre en trop');
      await dlg.locator('[name="km"]').fill('260');
      if (role === 'BM' && largeur.nom === 'mobile') { const p1 = join(SORTIE, 'fenetre-correction-mobile.png'); await page.screenshot({ path: p1 }); noter('Fenêtre de correction (mobile)', p1); }
      await dlg.locator('button[type=submit]').click();
      await page.waitForFunction(() => /Compteur corrigé/.test(document.body.innerText));
      const call = etat.rpc.find((x) => x.nom === 'moto_releve_corriger');
      assert.deepEqual(call.args, { p_releve: 'r3', p_nouveau_km: 260, p_motif: 'Faute de frappe : un chiffre en trop' });
      await page.waitForFunction(() => !/Saut suspect/.test(document.body.innerText));
      const toast = await page.locator('text=/Compteur corrigé/').first().innerText();
      assert.match(toast, /2[  ]602.*→.*260/); assert.match(toast, /contrôle mis à jour/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Débordement horizontal');
      if (role === 'BM') { const p2 = join(SORTIE, 'kilometrage-apres-' + largeur.nom + '.png'); await page.screenshot({ path: p2, fullPage: true }); noter(`${role} ${largeur.width} px : correction 2 602 → 260 envoyée, message « ${toast.trim().slice(0, 90)} »`, p2); }
      else noter(`ABM ${largeur.width} px : correction directe disponible et envoyée`);
      assert.deepEqual(etat.erreurs, []); assert.deepEqual(etat.sorties, []);
      await ctx.close();
    }
    for (const role of ['ZH', 'UH']) {
      const etat = { d: donnees(), lectures: [], rpc: [], sorties: [], erreurs: [] };
      const { ctx, page } = await ouvrir(role, largeur, etat);
      await page.goto(BASE + '/moto/index.html#/moto/' + MOTO + '/kilometrage'); await pret(page);
      await page.waitForTimeout(800);
      assert.equal(await page.locator('[data-action="corriger_compteur"]').count(), 0);
      assert.deepEqual(etat.erreurs, []);
      await ctx.close();
      noter(`${role === 'ZH' ? 'Chef de zone' : 'Unit Head'} ${largeur.width} px : aucun bouton « Corriger »`);
    }
  }
} finally {
  await navigateur.close(); serveur.close();
  writeFileSync(join(SORTIE, 'resultats.json'), JSON.stringify(RESULTATS, null, 2));
}
console.log('VALIDÉ : ' + RESULTATS.length + ' contrôles navigateur (correction du compteur). Preuves : ' + SORTIE);
