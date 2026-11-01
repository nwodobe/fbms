#!/usr/bin/env node
/**
 * AFLP MOTO MANAGER — démonstration de bout en bout dans un VRAI navigateur.
 *
 * Interface réelle (moto/*.js servis tels quels) → émulateur local de l'API
 * Supabase → VRAIES fonctions et RLS de la migration sur la réplique locale.
 * Seuls auth-gate (session injectée), les CDN (servis depuis node_modules) et
 * les polices sont substitués. Aucune connexion à Supabase production.
 * Données 100 % fictives (comptes *.example.invalid, numéros « E2E-FICTIF »).
 *
 * Prérequis :
 *   npm install --no-save playwright@1.49.1 pg@8 @supabase/supabase-js@2 xlsx@0.18.5 qrcode-generator@1.4.4
 *   PGHOST=… PGPORT=… ./tests/moto/e2e/preparer_base_e2e.sh fbms_moto_e2e
 *   PGHOST=… PGPORT=… CHROMIUM=/chemin/chrome node tests/moto/e2e/moto-e2e.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { creerEmulateur, session } from './postgrest-local.mjs';

const require = createRequire(import.meta.url);
const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = normalize(join(ICI, '..', '..', '..'));
const SORTIE = join(RACINE, 'tests', 'moto', 'resultats');
const CAPTURES = join(SORTIE, 'captures');
mkdirSync(CAPTURES, { recursive: true });
const PORT = Number(process.env.PORT_MOTO_E2E || 4371);
const BASE = `http://127.0.0.1:${PORT}`;
const SUPA = 'https://jmbdgpdthzpszfnddwzi.supabase.co';
const DB = process.env.PGDATABASE_E2E || 'fbms_moto_e2e';
const emu = creerEmulateur({ host: process.env.PGHOST, port: Number(process.env.PGPORT), database: DB });
const q = (sql, v) => emu.pool.query(sql, v).then(r => r.rows);
const LARGEURS = { mobile: { width: 390, height: 844 }, tablette: { width: 768, height: 1024 }, bureau: { width: 1440, height: 900 } };

const uid = n => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const U = {
  bm: [uid(1), 'BM E2E FICTIF', 'Branch Manager', null], abm: [uid(2), 'ABM E2E FICTIF', 'Assistant Branch Manager', null],
  zh: [uid(3), 'ZH E2E FICTIF', 'Zonal Head', null], uh: [uid(4), 'UH SAKASSOU E2E FICTIF', 'Unit Head', 'SAKASSOU'],
  uh2: [uid(5), 'UH BOTRO E2E FICTIF', 'Unit Head', 'BOTRO'], fin: [uid(6), 'FINANCE E2E FICTIF', 'Finance', null],
  agent: [uid(7), 'AGENT E2E FICTIF', 'Agent Recenseur', 'BROBO'], sup: [uid(8), 'SUPERVISOR E2E FICTIF', 'Supervisor', 'BROBO'],
  lc: [uid(9), 'COORDINATEUR E2E FICTIF', 'Supervisor', null],
};

const RESULTATS = []; const ERREURS_CONSOLE = [];
function noter(id, exigence, action, attendu, ok, obtenu, preuve) {
  RESULTATS.push({ id, exigence, action, attendu, obtenu: String(obtenu).slice(0, 300), resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', preuve: preuve || '' });
  console.log(`${ok ? '✓' : '✗'} ${id} ${action} — ${String(obtenu).slice(0, 140)}`);
}
async function etape(id, exigence, action, attendu, fn) {
  try { const r = await fn(); noter(id, exigence, action, attendu, r.ok, r.obtenu, r.preuve); return r; }
  catch (e) {
    let preuve = '';
    try { if (globalThis.__derniere) { const f = join(CAPTURES, 'echec-' + id + '.png'); await globalThis.__derniere.screenshot({ path: f, fullPage: true }); preuve = 'tests/moto/resultats/captures/echec-' + id + '.png'; } } catch {}
    noter(id, exigence, action, attendu, false, 'EXCEPTION : ' + (e && e.message || e).split('\n')[0], preuve); return { ok: false };
  }
}
async function attendre(f, ms = 15000, pas = 250) {
  const fin = Date.now() + ms; let v;
  while (Date.now() < fin) { v = await f(); if (v) return v; await new Promise(r => setTimeout(r, pas)); }
  return v;
}

/* -- Serveur statique (fichiers du dépôt tels quels) -------------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const serveur = createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  let f = normalize(join(RACINE, p));
  if (!f.startsWith(RACINE)) { res.writeHead(403).end(); return; }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404).end('absent'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f));
});
await new Promise(r => serveur.listen(PORT, '127.0.0.1', r));

/* -- Données de départ : comptes fictifs uniquement --------------------- */
for (const [k, [id, nom, role, cluster]] of Object.entries(U)) {
  await q('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [id, k + '.e2e@example.invalid']);
  await q('insert into public.profils (user_id, email, nom, role, cluster, actif) values ($1,$2,$3,$4,$5,true) on conflict do nothing', [id, k + '.e2e@example.invalid', nom, role, cluster]);
}

// Coordinateur logistique : fonction opérationnelle FBMS existante ; Chef de zone : zone de responsabilité renseignée.
await q("update public.profils set fonction_operationnelle = 'Logistics Coordinator' where user_id = $1", [U.lc[0]]);
await q("update public.profils set zone = 'GBEKE 1' where user_id = $1", [U.zh[0]]);

const CDN = {
  'supabase.min.js': require.resolve('@supabase/supabase-js/dist/umd/supabase.js'),
  'xlsx.full.min.js': require.resolve('xlsx/dist/xlsx.full.min.js'),
  'qrcode.js': require.resolve('qrcode-generator/qrcode.js'),
};
const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let blocageSync = 0; // nombre de réponses moto_sync_batch à « perdre » après traitement serveur
async function contexte(compte, largeur = 'bureau') {
  const [id] = U[compte];
  const ctx = await navigateur.newContext({ viewport: LARGEURS[largeur], acceptDownloads: true, serviceWorkers: 'block' });
  await ctx.addInitScript(([cle, s]) => { try { localStorage.setItem(cle, JSON.stringify(s)); } catch (e) {} }, ['sb-jmbdgpdthzpszfnddwzi-auth-token', session(id, compte + '.e2e@example.invalid')]);
  await ctx.route(SUPA + '/**', async route => {
    const r = route.request();
    if (r.method() === 'POST' && /\/storage\/v1\/object\/moto-documents\//.test(r.url())) (globalThis.__depots = globalThis.__depots || []).push({ url: r.url(), corps: r.postDataBuffer() });
    const rep = await emu.traiter({ methode: r.method(), url: r.url(), entetes: r.headers(), corps: r.postDataBuffer() });
    if (blocageSync > 0 && /\/rpc\/moto_sync_batch$/.test(r.url())) { blocageSync--; return route.abort('connectionreset'); }
    return route.fulfill({ status: rep.status, headers: rep.headers, body: rep.body });
  });
  await ctx.route(/cdn\.jsdelivr\.net\/.*/, route => {
    const nom = Object.keys(CDN).find(k => route.request().url().endsWith(k));
    return nom ? route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(CDN[nom]) }) : route.fulfill({ status: 404, body: '' });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  return ctx;
}
async function page(ctx, chemin) {
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') ERREURS_CONSOLE.push({ page: chemin, message: m.text().slice(0, 300) }); });
  p.on('response', r => { if (r.status() >= 400) ERREURS_CONSOLE.push({ page: chemin, message: 'HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url().replace(SUPA, '').slice(0, 160) }); });
  p.on('pageerror', e => ERREURS_CONSOLE.push({ page: chemin, message: 'pageerror: ' + e.message.slice(0, 300) }));
  await p.goto(BASE + chemin);
  return p;
}
async function pret(p) { globalThis.__derniere = p; await p.waitForFunction(() => !document.getElementById('anagroci-authgate') && document.querySelector('#motoVue') && !document.querySelector('#motoVue .mm-chargement'), null, { timeout: 20000 }); }
async function remplir(p, valeurs) {
  const d = p.locator('dialog.mm-modale').last();
  await d.waitFor();
  for (const [n, v] of Object.entries(valeurs)) {
    const blocScan = d.locator(`[data-scan-champ="${n}"]`);
    if (await blocScan.count()) { await scanner(p, blocScan, v); continue; }
    const el = d.locator(`[name="${n}"]`).first();
    const tag = await el.evaluate(e => e.tagName + ':' + (e.type || ''));
    if (tag.startsWith('SELECT')) { if (typeof v === 'object' && v.libelle) await el.selectOption({ label: v.libelle }); else if (typeof v === 'object' && v.contient) { const opt = await el.locator('option', { hasText: v.contient }).first().getAttribute('value'); await el.selectOption(opt); } else await el.selectOption(String(v)); }
    else if (tag === 'INPUT:checkbox') { if (v) await el.check(); else await el.uncheck(); }
    else if (tag === 'INPUT:radio') await d.locator(`[name="${n}"][value="${v}"]`).check();
    else if (tag === 'INPUT:file') await el.setInputFiles(v);
    else await el.fill(String(v));
  }
  return d;
}
// Champ « scan » : un PDF est importé tel quel ; une ou plusieurs images passent par le scanner (recadrage, mode document, PDF).
async function scanner(p, bloc, v) {
  const fichiers = Array.isArray(v) ? v : [v];
  if (fichiers.length === 1 && fichiers[0].mimeType === 'application/pdf') { await bloc.locator('[data-scan-pdf]').setInputFiles(fichiers[0]); return; }
  await bloc.locator('[data-scan-ouvrir]').click();
  const sd = p.locator('dialog.mm-scan-dialog').last(); await sd.waitFor();
  await sd.locator('[data-galerie]').setInputFiles(fichiers);
  await sd.locator('.mm-scan-page').nth(fichiers.length - 1).waitFor();
  await sd.locator('[data-valider]').click();
  await bloc.locator('.mm-scan-etat.mm-scan-ok').waitFor({ timeout: 15000 });
}
async function valider(p) {
  // On suit LA fenêtre soumise (poignée fixe), et non « la dernière fenêtre » : l'application peut
  // fermer celle-ci puis rouvrir aussitôt le dossier, qu'un sélecteur réévalué confondrait avec elle.
  const h = await p.locator('dialog.mm-modale').last().elementHandle();
  await (await h.$('button[type=submit]')).click();
  const r = await attendre(async () => {
    if (!(await h.evaluate(e => e.isConnected && e.open))) return 'ferme';
    const err = await h.$('.mm-erreur:not([hidden])');
    return err ? 'erreur:' + (await err.textContent()) : null;
  }, 20000);
  return r || 'délai dépassé';
}
async function toutConforme(p) { for (const r of await p.locator('dialog.mm-modale input[type=radio][value=ok]').all()) await r.check(); }
async function capture(p, nom) { const f = join(CAPTURES, nom + '.png'); await p.screenshot({ path: f, fullPage: true }); return 'tests/moto/resultats/captures/' + nom + '.png'; }
async function debordement(p) { return p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); }

const PDF = { name: 'scan-fictif.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% document fictif de test E2E\n%%EOF\n') };
const PNG = { name: 'recu-fictif.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };

async function imageDocument(texte, l, h) {
  const pg = await navigateur.newPage({ viewport: { width: l, height: h } });
  await pg.setContent(`<body style="margin:0;background:#cfd8cf;display:grid;place-items:center;height:100vh;font-family:sans-serif"><div style="background:#fbfbf6;width:82%;height:76%;border:2px solid #556;padding:18px;box-sizing:border-box"><h1 style="margin:0 0 10px;font-size:26px">${texte}</h1><p>DOCUMENT FICTIF DE TEST — AUCUNE DONNÉE RÉELLE</p><p>N° E2E-0001 · Catégorie A</p></div></body>`);
  const b = await pg.screenshot({ type: 'jpeg', quality: 85 }); await pg.close(); return b;
}
function verifierPdf(buf) {
  const f = join(SORTIE, 'scan-e2e-verif.pdf'); writeFileSync(f, buf);
  const r = spawnSync('python3', ['-I', '-c', 'import sys,pypdf; r=pypdf.PdfReader(sys.argv[1]); print(len(r.pages))', f], { encoding: 'utf8' });
  return r.status === 0 ? `PDF valide · ${r.stdout.trim()} page(s)` : 'PDF invalide : ' + (r.stderr || '').trim().split('\n').pop();
}
const IMG_RECTO = { name: 'recto-fictif.jpg', mimeType: 'image/jpeg', buffer: await imageDocument('PERMIS DE CONDUIRE (FICTIF) · RECTO', 1200, 800) };
const IMG_VERSO = { name: 'verso-fictif.jpg', mimeType: 'image/jpeg', buffer: await imageDocument('VERSO (FICTIF)', 1200, 800) };

/* ======================================================================= */
let motoId = null;
try {
  // 1. Portail : nouvelle carte illustrée
  for (const [l] of Object.entries(LARGEURS)) {
    const ctx = await contexte('bm', l); const p = await page(ctx, '/index.html');
    await p.waitForFunction(() => !document.getElementById('anagroci-authgate'), null, { timeout: 20000 });
    await etape('UI-PORT-' + l, 'Carte AFLP FLEET sur le portail (scénario 1)', 'Portail à ' + JSON.stringify(LARGEURS[l]), 'carte visible, lien moto/index.html, aucun débordement', async () => {
      const carte = p.locator('a.portal-card-moto'); await carte.scrollIntoViewIfNeeded(); await p.waitForFunction(() => { const i = document.querySelector('a.portal-card-moto img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {}); const vis = await carte.isVisible(); const href = await carte.getAttribute('href'); const img = await carte.locator('img').evaluate(i => i.complete && i.naturalWidth > 0);
      const deb = await debordement(p);
      const titre = await carte.locator('h2').textContent();
      return { ok: vis && href === 'moto/index.html' && img && deb <= 1 && titre === 'AFLP FLEET', obtenu: `titre=${titre} visible=${vis} href=${href} image=${img} débordement=${deb}px`, preuve: await capture(p, 'portail-' + l) };
    });
    await ctx.close();
  }

  // 2. ABM : création au passeport
  let ctxA = await contexte('abm'); let pA = await page(ctxA, '/moto/index.html#/admin'); await pret(pA);
  await etape('UI-INV-01', 'Passeport numérique : création', 'ABM crée une moto par le formulaire', 'redirection vers le passeport, code MOTO-001, QR affiché', async () => {
    await pA.click('[data-admin="creer"]');
    await remplir(pA, { marque: 'APSONIC', modele: 'AP150-30', date_reception: '2026-10-30', cluster_code: 'SAKASSOU', compteur_km: '1', photo: { ...PNG, name: 'photo-moto-fictive.png' } });
    const apercu = await pA.locator('dialog.mm-modale .mm-apercu:not([hidden])').count();
    const r = await valider(pA);
    await pA.waitForSelector('.mm-passeport h1', { timeout: 15000 });
    globalThis.__apercu = apercu;
    motoId = (await q("select id from public.moto_motos where code = 'MOTO-001'"))[0]?.id;
    const h1 = await pA.textContent('.mm-passeport h1');
    const qr = await attendre(() => pA.locator('#mmQr svg').count(), 8000);
    const chassis = (await q('select numero_chassis from public.moto_motos where id = $1', [motoId]))[0]?.numero_chassis;
    return { ok: r === 'ferme' && /MOTO-001/.test(h1) && qr > 0 && chassis === null, obtenu: `${r} · ${h1} · QR=${qr} · châssis=${chassis}`, preuve: await capture(pA, 'passeport-creation-bureau') };
  });
  await etape('UI-FL-03', 'Photo principale enregistrée à la création (scénario 3)', 'Photo jointe au formulaire avec aperçu', 'aperçu affiché, photo en stockage privé, visible au passeport', async () => {
    const m = (await q('select photo_path from public.moto_motos where id=$1', [motoId]))[0];
    const vis = await attendre(() => pA.locator('.mm-passeport img.mm-photo-passeport').evaluate(i => i.complete && i.naturalWidth > 0).catch(() => false), 8000);
    return { ok: globalThis.__apercu === 1 && !!m.photo_path && m.photo_path.startsWith(motoId + '/photo/') && vis, obtenu: `aperçu=${globalThis.__apercu} chemin=${m.photo_path} affichée=${vis}` };
  });
  await etape('UI-INV-02', 'Identité depuis la carte grise', 'ABM saisit châssis et immatriculation fictifs', 'enregistré et journalisé avec motif', async () => {
    await pA.click('[data-action="identite"]');
    await remplir(pA, { numero_chassis: 'E2E-FICTIF-CH-01', immatriculation: 'E2E 0001 FICTIF', motif: 'Recopie carte grise (test E2E)' });
    const r = await valider(pA);
    const j = await q("select count(*)::int n from public.moto_journal where table_nom='moto_motos' and motif like 'Recopie carte grise%'");
    return { ok: r === 'ferme' && j[0].n === 1, obtenu: `${r} · journal=${j[0].n}` };
  });
  for (const [t, extra] of [['CARTE_GRISE', {}], ['PLAQUE', {}], ['ASSURANCE', { date_expiration: '2027-10-30' }]]) {
    await etape('UI-DOC-' + t, 'Documents dans le stockage privé', 'ABM dépose ' + t, 'fichier déposé, statut En vérification', async () => {
      await pA.goto(BASE + '/moto/index.html#/moto/' + motoId + '/documents'); await pA.waitForSelector('[data-action="document"]');
      await pA.click('[data-action="document"]');
      await remplir(pA, { type_document: t, fichier: t === 'PLAQUE' ? PNG : PDF, ...extra });
      const r = await valider(pA);
      const d = await q("select d.statut, (select count(*) from storage.objects o where o.name = d.storage_path)::int f from public.moto_documents d where moto_id=$1 and type_document=$2", [motoId, t]);
      return { ok: r === 'ferme' && d[0]?.statut === 'EN_VERIFICATION' && d[0]?.f === 1, obtenu: `${r} · ${JSON.stringify(d[0])}` };
    });
  }
  await etape('UI-DOC-AUTO', 'Auto-validation interdite (interface)', 'ABM consulte ses propres dépôts', 'aucun bouton Vérifier, mention d\'un autre responsable', async () => {
    await pA.reload(); await pA.waitForSelector('.mm-table');
    const n = await pA.locator('[data-action="verifier_document"]').count(); const t = await pA.locator('text=Vérification par un autre responsable').count();
    return { ok: n === 0 && t >= 3, obtenu: `boutons vérifier=${n} · mentions=${t}`, preuve: await capture(pA, 'documents-abm-bureau') };
  });

  // 3. BM : vérification des documents, préaffectation
  let ctxB = await contexte('bm'); let pB = await page(ctxB, '/moto/index.html#/moto/' + motoId + '/documents'); await pret(pB);
  await etape('UI-DOC-VERIF', 'Vérification par un tiers', 'BM déclare conformes les 3 documents', 'statut administratif CONFORME', async () => {
    for (let i = 0; i < 3; i++) {
      await pB.waitForSelector('[data-action="verifier_document"]', { timeout: 10000 });
      await pB.locator('[data-action="verifier_document"]').first().click();
      await remplir(pB, { statut: 'CONFORME' }); const r = await valider(pB); if (r !== 'ferme') return { ok: false, obtenu: r };
      await pB.waitForTimeout(400);
    }
    const s = (await q('select statut_administratif from public.moto_motos where id=$1', [motoId]))[0].statut_administratif;
    return { ok: s === 'CONFORME', obtenu: s };
  });

  // 4. ABM : inspection initiale
  await etape('UI-INS-01', 'Inspection mécanique initiale', 'ABM saisit l\'inspection, tous points conformes', 'statut technique APTE', async () => {
    await pA.goto(BASE + '/moto/index.html#/moto/' + motoId); await pA.waitForSelector('[data-action="inspection"]');
    await pA.click('[data-action="inspection"]');
    await remplir(pA, { intervenant_nom: 'MECANICIEN E2E FICTIF', garage_nom: 'GARAGE E2E FICTIF', compteur_km: '2', avis_mecanicien: 'Avis de test, non réglementaire', resultat: 'APTE' });
    await toutConforme(pA);
    const r = await valider(pA);
    const s = (await q('select statut_technique from public.moto_motos where id=$1', [motoId]))[0].statut_technique;
    return { ok: r === 'ferme' && s === 'APTE', obtenu: `${r} · ${s}` };
  });

  await etape('UI-AFF-01', 'Préaffectation par le Branch Manager', 'BM préaffecte au Chef d\'unité Sakassou', 'PREAFFECTEE', async () => {
    await pB.goto(BASE + '/moto/index.html#/moto/' + motoId); await pB.waitForSelector('[data-action="preaffecter"]');
    await pB.click('[data-action="preaffecter"]');
    await remplir(pB, { beneficiaire: { contient: 'UH SAKASSOU' }, motif: 'Pilote Sakassou (test E2E)' });
    const r = await valider(pB);
    const s = (await q('select statut_affectation from public.moto_motos where id=$1', [motoId]))[0].statut_affectation;
    return { ok: r === 'ferme' && s === 'PREAFFECTEE', obtenu: `${r} · ${s}` };
  });

  // 5. PV papier numérisé, remise, mise en service
  await etape('UI-REM-01', 'PV papier signé, numérisé et vérifié', 'ABM dépose le PV, BM le vérifie', 'PV CONFORME', async () => {
    await pA.goto(BASE + '/moto/index.html#/moto/' + motoId + '/documents'); await pA.waitForSelector('[data-action="document"]');
    await pA.click('[data-action="document"]'); await remplir(pA, { type_document: 'PV_REMISE', fichier: PDF, numero_reference: 'PV-E2E-001' }); const r1 = await valider(pA);
    await pB.goto(BASE + '/moto/index.html#/moto/' + motoId + '/documents'); await pB.waitForSelector('[data-action="verifier_document"]');
    await pB.click('[data-action="verifier_document"]'); await remplir(pB, { statut: 'CONFORME' }); const r2 = await valider(pB);
    const s = (await q("select statut from public.moto_documents where moto_id=$1 and type_document='PV_REMISE'", [motoId]))[0]?.statut;
    return { ok: r1 === 'ferme' && r2 === 'ferme' && s === 'CONFORME', obtenu: `${r1} · ${r2} · ${s}` };
  });
  await etape('UI-REM-02', 'Remise : équipements obligatoires', 'ABM tente la remise sans gilet', 'refus serveur affiché dans la fenêtre', async () => {
    await pA.goto(BASE + '/moto/index.html#/moto/' + motoId); await pA.waitForSelector('[data-action="remettre"]');
    await pA.click('[data-action="remettre"]');
    await remplir(pA, { pv_document_id: { contient: 'PV-E2E-001' }, compteur_km: '5', eq_CASQUE: true });
    const r = await valider(pA);
    await pA.locator('dialog.mm-modale .mm-annuler').click().catch(() => {});
    return { ok: /GILET/.test(r), obtenu: r };
  });
  await etape('UI-ETAT-01', 'État contradictoire avant remise (scénario 9)', 'ABM enregistre l\'état avec 5 photos', 'état EN_ATTENTE, 5 photos datées, distinct du PV et de l\'inspection', async () => {
    await pA.goto(BASE + '/moto/index.html#/moto/' + motoId); await pA.waitForSelector('[data-action="etat_remise"]');
    await pA.click('[data-action="etat_remise"]');
    const ph = n => ({ ...PNG, name: n + '-fictif.png' });
    await remplir(pA, { compteur_km: '5', ph_AVANT: ph('avant'), ph_ARRIERE: ph('arriere'), ph_GAUCHE: ph('gauche'), ph_DROITE: ph('droite'), ph_COMPTEUR: ph('compteur'), observations: 'Rayure légère (fictif)', eq_CASQUE: true, eq_GILET_HAUTE_VISIBILITE: true });
    await toutConforme(pA); const r = await valider(pA);
    const e = (await q("select c.confirmation_statut, (select count(*)::int from public.moto_photos p where p.controle_id=c.id) n from public.moto_controles c where moto_id=$1 and type_controle='ETAT_REMISE'", [motoId]))[0];
    return { ok: r === 'ferme' && e?.confirmation_statut === 'EN_ATTENTE' && e?.n === 5, obtenu: `${r} · ${JSON.stringify(e)}` };
  });
  await etape('UI-ETAT-02', 'Le bénéficiaire accepte l\'état depuis son téléphone', 'Chef d\'unité examine photos et points, accepte avec réserve', 'ACCEPTEE_AVEC_RESERVES à son nom', async () => {
    const c = await contexte('uh', 'mobile'); const p = await page(c, '/moto/index.html#/operations'); await pret(p);
    await p.waitForSelector('[data-etat]'); await p.click('[data-etat]');
    await p.waitForFunction(() => [...document.querySelectorAll('dialog.mm-modale img.mm-photo-galerie')].some(i => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => {});
    const preuve = await capture(p, 'etat-remise-beneficiaire-mobile');
    await remplir(p, { decision: 'ACCEPTEE_AVEC_RESERVES', commentaire: 'Rayure notée au PV papier' }); const r = await valider(p);
    const e = (await q("select confirmation_statut, beneficiaire_id from public.moto_controles where moto_id=$1 and type_controle='ETAT_REMISE'", [motoId]))[0];
    await c.close();
    return { ok: r === 'ferme' && e.confirmation_statut === 'ACCEPTEE_AVEC_RESERVES' && e.beneficiaire_id === U.uh[0], obtenu: `${r} · ${e.confirmation_statut}`, preuve };
  });
  // Migration 7 : le conducteur scanne son permis, le BM le contrôle sur l'original ; la remise reprend ce permis.
  await etape('UI-PRM-01', 'Permis scanné par le conducteur lui-même (migration 7)', 'Chef d\'unité : « Scanner mon permis » (recto + verso), saisie des informations', 'permis EN_VERIFICATION, scan PDF de 2 pages dans permis/<titulaire>/', async () => {
    const c = await contexte('uh', 'mobile'); const p = await page(c, '/moto/index.html#/motos'); await pret(p);
    await p.waitForSelector('[data-mon-permis]'); const avant = await p.locator('.mm-mon-permis .mm-badge').textContent();
    await p.click('[data-mon-permis]');
    globalThis.__depots = [];
    await remplir(p, { scan: [IMG_RECTO, IMG_VERSO], numero_permis: 'E2E-PERMIS-0001', date_delivrance: '2024-01-15', date_expiration: '2034-01-14', cat_A: true });
    const preuve = await capture(p, 'permis-saisie-mobile');
    const r = await valider(p);
    const x = (await q("select statut, document_path, pages, array_to_string(categories, ',') cats from public.moto_permis where titulaire_id=$1", [U.uh[0]]))[0] || {};
    const dep = (globalThis.__depots || []).filter(d => /\/permis\//.test(d.url)).pop();
    const pdf = dep ? verifierPdf(dep.corps) : 'aucun dépôt';
    await c.close();
    return { ok: r === 'ferme' && x.statut === 'EN_VERIFICATION' && (x.document_path || '').startsWith('permis/' + U.uh[0] + '/') && pdf === 'PDF valide · 2 page(s)' && /Aucun permis/.test(avant),
      obtenu: `${r} · ${x.statut} · ${x.cats} · ${pdf} · avant=${avant}`, preuve };
  });
  await etape('UI-PRM-02', 'Contrôle sur original par le Branch Manager (migration 7)', 'BM ouvre « Conducteurs », ouvre le scan et déclare le permis conforme', 'permis CONFORME, vérificateur RH enregistré', async () => {
    const c = await contexte('bm', 'bureau'); const p = await page(c, '/moto/index.html#/conducteurs'); await pret(p);
    const lien = await p.locator('#motoNav a[data-route="conducteurs"]').count();
    await p.click('[data-action="pm_verifier"]');
    await remplir(p, { statut: 'CONFORME', rh: 'RH E2E FICTIF', adaptee: true });
    const preuve = await capture(p, 'permis-verification-bureau');
    const r = await valider(p);
    const x = (await q("select statut, verification_rh_nom from public.moto_permis where titulaire_id=$1", [U.uh[0]]))[0] || {};
    await c.close();
    return { ok: lien === 1 && r === 'ferme' && x.statut === 'CONFORME' && x.verification_rh_nom === 'RH E2E FICTIF', obtenu: `menu=${lien} · ${r} · ${x.statut} · ${x.verification_rh_nom}`, preuve };
  });
  await etape('UI-PRM-03', 'Chef de zone : aucun accès aux permis des autres', 'Chef de zone ouvre l\'application puis #/conducteurs', 'pas de menu Conducteurs, aucune donnée de permis affichée', async () => {
    const c = await contexte('zh', 'mobile'); const p = await page(c, '/moto/index.html#/conducteurs'); await pret(p);
    const lien = await p.locator('#motoNav a[data-route="conducteurs"]').count(); const txt = await p.locator('#motoVue').textContent(); await c.close();
    return { ok: lien === 0 && !/E2E-PERMIS-0001/.test(txt), obtenu: `menu=${lien} · numéro visible=${/E2E-PERMIS-0001/.test(txt)}` };
  });
  await etape('UI-REM-03', 'Remise officielle complète', 'ABM enregistre la remise ; le permis vérifié est repris automatiquement', 'REMISE, permis repris (A, RH E2E FICTIF), pas encore autorisée à circuler', async () => {
    await pA.goto(BASE + '/moto/index.html#/moto/' + motoId); await pA.reload(); await pret(pA); await pA.waitForSelector('[data-action="remettre"]');
    await pA.click('[data-action="remettre"]');
    const info = await pA.locator('dialog.mm-modale .mm-bandeau.mm-ok').textContent().catch(() => '');
    await remplir(pA, { pv_document_id: { contient: 'PV-E2E-001' }, compteur_km: '5', eq_CASQUE: true, eq_GILET_HAUTE_VISIBILITE: true });
    const r = await valider(pA);
    const a = (await q("select permis_categorie, permis_verifie_par_nom, permis_id is not null lie from public.moto_affectations where moto_id=$1 and type_affectation='REMISE'", [motoId]))[0] || {};
    globalThis.__remise = { info, a };
    const m = (await q('select statut_affectation, mise_en_service_at from public.moto_motos where id=$1', [motoId]))[0];
    const a2 = globalThis.__remise.a;
    return { ok: r === 'ferme' && m.statut_affectation === 'REMISE' && !m.mise_en_service_at && /conforme/.test(globalThis.__remise.info) && a2.permis_categorie === 'A' && a2.permis_verifie_par_nom === 'RH E2E FICTIF' && a2.lie,
      obtenu: `${r} · ${m.statut_affectation} · service=${!!m.mise_en_service_at} · permis repris=${a2.permis_categorie}/${a2.permis_verifie_par_nom}` };
  });
  await etape('UI-MES-01', 'Autorisation de circulation : décision distincte', 'BM autorise la circulation', 'autorisée à circuler', async () => {
    await pB.goto(BASE + '/moto/index.html#/moto/' + motoId); await pB.waitForSelector('[data-action="mise_en_service"]');
    await pB.click('[data-action="mise_en_service"]'); await remplir(pB, { motif: 'Autorisation de circulation (test E2E)' }); const r = await valider(pB);
    const a = (await q('select autorisee_a_circuler from public.moto_v_flotte where id=$1', [motoId]))[0].autorisee_a_circuler;
    await pB.reload(); await pret(pB);
    return { ok: r === 'ferme' && a === true, obtenu: `${r} · autorisée=${a}`, preuve: await capture(pB, 'passeport-en-service-bureau') };
  });

  // 6. Chef d'unité sur téléphone : opérations, hors connexion, idempotence
  let ctxU = await contexte('uh', 'mobile'); let pU = await page(ctxU, '/moto/index.html#/operations'); await pret(pU);
  await etape('UI-OP-01', 'Écrans courts pour l\'agent (390 px)', 'Opérations sur téléphone', '6 tuiles, aucun débordement horizontal', async () => {
    const n = await pU.locator('.mm-tuile').count(); const deb = await debordement(pU);
    return { ok: n === 6 && deb <= 1, obtenu: `tuiles=${n} · débordement=${deb}px`, preuve: await capture(pU, 'operations-mobile') };
  });
  await etape('UI-OP-02', 'Contrôle de sécurité avant départ', 'Chef d\'unité valide le contrôle', 'contrôle APTE synchronisé', async () => {
    await pU.click('[data-tuile="controle"]'); await remplir(pU, { compteur_km: '10' }); await toutConforme(pU); const r = await valider(pU);
    const c = await attendre(async () => (await q("select resultat from public.moto_controles where moto_id=$1 and type_controle='AVANT_DEPART'", [motoId]))[0]?.resultat);
    return { ok: r === 'ferme' && c === 'APTE', obtenu: `${r} · ${c}` };
  });
  await etape('UI-OFF-01', 'Saisie sans réseau', 'Achat de carburant (plein complet initial) hors connexion', 'en attente sur l\'appareil, rien en base', async () => {
    await pU.goto(BASE + '/moto/index.html#/operations'); await pret(pU);
    await ctxU.setOffline(true);
    await pU.click('[data-tuile="carburant"]');
    await remplir(pU, { compteur_km: '60', litres: '3', montant: '2550', plein_complet: 'true', financement: 'DOTATION', justificatif: PNG });
    const r = await valider(pU);
    await pU.waitForSelector('#opFile .mm-table', { timeout: 10000 });
    const attente = await pU.locator('#opFile').textContent();
    const n = (await q('select count(*)::int n from public.moto_carburant where moto_id=$1', [motoId]))[0].n;
    return { ok: r === 'ferme' && /1 en attente/.test(attente) && n === 0, obtenu: `${r} · base=${n} · file="${attente.slice(0, 80)}"`, preuve: await capture(pU, 'hors-connexion-en-attente-mobile') };
  });
  await etape('UI-OFF-02', 'Persistance locale', 'Fermeture et réouverture de la page (sans synchroniser)', 'l\'opération est toujours en file', async () => {
    const n = await pU.evaluate(() => window.MOTO_OFFLINE.lister().then(o => o.filter(x => x.statut === 'EN_ATTENTE').length));
    await pU.close();
    pU = await ctxU.newPage(); await pU.addInitScript(() => { window.__horsLigneTest = true; });
    // Réouverture en ligne mais réseau Supabase coupé : la page charge, la file est relue depuis IndexedDB.
    await ctxU.setOffline(false); blocageSync = 0;
    await ctxU.route(SUPA + '/rest/v1/rpc/moto_sync_batch', r => r.abort('internetdisconnected'));
    await pU.goto(BASE + '/moto/index.html#/operations'); await pret(pU);
    const n2 = await attendre(() => pU.evaluate(() => window.MOTO_OFFLINE.lister().then(o => o.filter(x => x.statut === 'EN_ATTENTE' && x.type === 'CARBURANT').length)), 8000);
    await ctxU.unroute(SUPA + '/rest/v1/rpc/moto_sync_batch');
    return { ok: n === 1 && n2 === 1, obtenu: `avant=${n} · après réouverture=${n2}` };
  });
  await etape('UI-OFF-03', 'Synchronisation au retour du réseau', 'Synchronisation de la file', 'Synchronisé, 1 ligne en base, justificatif dans le stockage privé', async () => {
    // La tentative avortée à la réouverture a programmé une reprise différée : on la rend immédiate.
    await pU.evaluate(() => new Promise(ok => { const r = indexedDB.open('anagroci_moto_offline'); r.onsuccess = () => { const st = r.result.transaction('operations', 'readwrite').objectStore('operations'); const g = st.getAll(); g.onsuccess = () => { g.result.filter(o => o.statut === 'EN_ATTENTE').forEach(o => { o.prochaine_tentative = null; st.put(o); }); ok(); }; }; }));
    await pU.click('#opSync');
    const n = await attendre(async () => (await q('select count(*)::int n from public.moto_carburant where moto_id=$1', [motoId]))[0].n === 1 ? 1 : 0, 15000);
    const st = await attendre(() => pU.evaluate(() => window.MOTO_OFFLINE.lister().then(o => o.find(x => x.type === 'CARBURANT')?.statut === 'SYNCHRONISE' ? 'SYNCHRONISE' : null)), 10000);
    const p = (await q("select justificatif_path from public.moto_carburant where moto_id=$1", [motoId]))[0]?.justificatif_path || '';
    const f = (await q("select count(*)::int n from storage.objects where bucket_id='moto-documents' and name=$1", [p]))[0].n;
    const blobs = await pU.evaluate(() => new Promise(ok => { const r = indexedDB.open('anagroci_moto_offline'); r.onsuccess = () => { const t = r.result.transaction('fichiers').objectStore('fichiers').count(); t.onsuccess = () => ok(t.result); }; }));
    return { ok: n === 1 && st === 'SYNCHRONISE' && f === 1 && blobs === 0, obtenu: `base=${n} · statut=${st} · fichier=${f} · photos locales restantes=${blobs}` };
  });
  await etape('UI-OFF-04', 'Idempotence : réponse perdue après traitement serveur', 'Plein partiel ; la réponse du serveur est coupée, puis renvoi', '1 seule ligne en base, statut Synchronisé (doublon reconnu)', async () => {
    await pU.goto(BASE + '/moto/index.html#/operations'); await pret(pU);
    blocageSync = 1;
    await pU.click('[data-tuile="carburant"]');
    await remplir(pU, { compteur_km: '120', litres: '1.5', montant: '1275', plein_complet: 'false', financement: 'DOTATION', justificatif: PNG });
    await valider(pU);
    const apres1 = (await q('select count(*)::int n from public.moto_carburant where moto_id=$1 and compteur_km=120', [motoId]))[0].n;
    const stLocal1 = await pU.evaluate(() => window.MOTO_OFFLINE.lister().then(o => o.find(x => x.type === 'CARBURANT' && x.payload.compteur_km === '120')?.statut));
    await pU.evaluate(() => window.MOTO_OFFLINE.lister().then(async ops => { const o = ops.find(x => x.payload.compteur_km === '120'); }));
    // Forcer la reprise immédiate (sans attendre le délai de reprise exponentiel)
    await pU.evaluate(() => new Promise(ok => { const r = indexedDB.open('anagroci_moto_offline'); r.onsuccess = () => { const st = r.result.transaction('operations', 'readwrite').objectStore('operations'); const g = st.getAll(); g.onsuccess = () => { g.result.filter(o => o.statut === 'EN_ATTENTE').forEach(o => { o.prochaine_tentative = null; st.put(o); }); ok(); }; }; }));
    await pU.evaluate(() => window.MOTO_OFFLINE.synchroniser(window.MOTO_APP.etat.sb));
    const apres2 = (await q('select count(*)::int n from public.moto_carburant where moto_id=$1 and compteur_km=120', [motoId]))[0].n;
    const op = await pU.evaluate(() => window.MOTO_OFFLINE.lister().then(o => o.find(x => x.payload.compteur_km === '120')));
    return { ok: apres1 === 1 && stLocal1 === 'EN_ATTENTE' && apres2 === 1 && op.statut === 'SYNCHRONISE' && /aucun doublon/.test(op.message || ''),
             obtenu: `après coupure : base=${apres1}, local=${stLocal1} · après renvoi : base=${apres2}, local=${op.statut} (${op.message})` };
  });
  await etape('UI-CAR-01', 'Consommation plein à plein vérifiable', 'Plein complet de contrôle puis lecture du passeport', '100 × (1,5 + 2,0) / (160 − 60) = 3,50 L/100 km', async () => {
    await pU.goto(BASE + '/moto/index.html#/operations'); await pret(pU);
    await pU.click('[data-tuile="carburant"]');
    await remplir(pU, { compteur_km: '160', litres: '2', montant: '1700', plein_complet: 'true', financement: 'DOTATION', justificatif: PNG });
    await valider(pU);
    await attendre(async () => (await q('select count(*)::int n from public.moto_carburant where moto_id=$1', [motoId]))[0].n === 3, 10000);
    await pU.goto(BASE + '/moto/index.html#/moto/' + motoId + '/carburant'); await pU.waitForSelector('.mm-kpi');
    const t = await pU.locator('.mm-kpi').first().textContent();
    const srv = (await q('select l_100km from public.moto_v_conso_intervalles where moto_id=$1', [motoId]))[0]?.l_100km;
    return { ok: /3,50 L\/100 km/.test(t) && String(srv) === '3.50', obtenu: `interface="${t.trim().slice(0, 60)}" · serveur=${srv}`, preuve: await capture(pU, 'carburant-plein-a-plein-mobile') };
  });
  await etape('UI-INC-01', 'Immobilisation sans attendre Internet', 'Incident critique déclaré hors connexion', 'bandeau « Ne pas circuler » immédiat, contrôle de départ bloqué', async () => {
    await pU.goto(BASE + '/moto/index.html#/operations'); await pret(pU);
    await ctxU.setOffline(true);
    await pU.click('[data-tuile="incident"]');
    await remplir(pU, { type_incident: 'PANNE', gravite: 'CRITIQUE', description: 'Perte de freinage simulée (test E2E fictif)', arret_confirme: true });
    const r = await valider(pU);
    await pU.waitForSelector('.mm-bandeau.mm-ko', { timeout: 8000 });
    const bandeau = await pU.locator('.mm-bandeau.mm-ko').first().textContent();
    const bloque = await pU.locator('[data-tuile="controle"]').isDisabled();
    const srv = (await q('select statut_technique from public.moto_motos where id=$1', [motoId]))[0].statut_technique;
    return { ok: r === 'ferme' && /Ne pas circuler/.test(bandeau) && bloque && srv === 'APTE', obtenu: `${r} · bandeau="${bandeau.slice(0, 70)}" · contrôle bloqué=${bloque} · serveur encore=${srv}`, preuve: await capture(pU, 'immobilisation-locale-mobile') };
  });
  await etape('UI-INC-02', 'Notification synchronisée ultérieurement', 'Retour du réseau', 'incident reçu, moto IMMOBILISEE côté serveur', async () => {
    await ctxU.setOffline(false);
    await pU.evaluate(() => window.dispatchEvent(new Event('online')));
    const s = await attendre(async () => (await q('select statut_technique from public.moto_motos where id=$1', [motoId]))[0].statut_technique === 'IMMOBILISEE' ? 'IMMOBILISEE' : null, 15000);
    const i = (await q("select etape from public.moto_incidents where moto_id=$1", [motoId]))[0]?.etape;
    return { ok: s === 'IMMOBILISEE' && i === 'IMMOBILISEE', obtenu: `moto=${s} · incident=${i}` };
  });

  // 7. Dotations : budget BM, remise ABM, confirmation agent
  await etape('UI-DOT-01', 'Budget autorisé', 'BM autorise un budget de 30 000 FCFA (fictif)', 'budget VALIDE', async () => {
    await pB.goto(BASE + '/moto/index.html#/admin'); await pret(pB);
    await pB.click('[data-admin="budget"]');
    await remplir(pB, { beneficiaire_id: { contient: 'UH SAKASSOU' }, moto_id: { contient: 'MOTO-001' }, montant_autorise: '30000', periode_debut: '2026-10-01', periode_fin: '2026-12-31', motif: 'Dotation pilote (test E2E)' });
    const r = await valider(pB);
    const s = (await q('select statut from public.moto_budgets'))[0]?.statut;
    return { ok: r === 'ferme' && s === 'VALIDE', obtenu: `${r} · ${s}` };
  });
  await etape('UI-DOT-02', 'Remise de dotation Mobile Money', 'ABM remet 10 000 FCFA, frais 100, référence', 'REMISE_DECLAREE, frais distincts', async () => {
    await pA.goto(BASE + '/moto/index.html#/admin'); await pret(pA);
    await pA.click('[data-admin="dotation"]');
    await remplir(pA, { budget_id: { contient: '30 000' }, mode_paiement: 'MOBILE_MONEY', montant_remis: '10000', frais_transaction: '100', operateur_mobile_money: 'OPERATEUR FICTIF', reference: 'MM-E2E-0001' });
    const r = await valider(pA);
    const d = (await q('select statut, montant_remis::int m, frais_transaction::int f from public.moto_dotations'))[0];
    return { ok: r === 'ferme' && d?.statut === 'REMISE_DECLAREE' && d.f === 100, obtenu: `${r} · ${JSON.stringify(d)}` };
  });
  await etape('UI-DOT-03', 'Confirmation de réception par l\'agent', 'Chef d\'unité confirme 9 900 reçus (écart)', 'CONTESTEE, montant reçu 9 900', async () => {
    // Même URL que l'étape précédente : un simple goto ne déclenche aucun changement de route, on recharge.
    await pU.reload(); await pret(pU);
    await pU.waitForSelector('[data-confirmer]'); await pU.click('[data-confirmer]');
    await remplir(pU, { montant_recu: '9900', motif: 'Montant net reçu inférieur (test)' });
    const r = await valider(pU);
    const d = await attendre(async () => { const x = (await q('select statut, montant_recu::int m from public.moto_dotations'))[0]; return x.statut !== 'REMISE_DECLAREE' ? x : null; }, 10000);
    return { ok: r === 'ferme' && d?.statut === 'CONTESTEE' && d.m === 9900, obtenu: `${r} · ${JSON.stringify(d)}` };
  });

  // 8. Finance et pilotage
  let ctxF = await contexte('fin'); let pF = await page(ctxF, '/moto/index.html#/pilotage'); await pret(pF);
  await etape('UI-PIL-01', 'Tableau de bord et limites d\'observation', 'Finance ouvre le pilotage', 'KPI affichés, avertissement d\'échantillon, rapprochement visible', async () => {
    const k = await pF.locator('.mm-kpi').count(); const av = await pF.locator('.mm-bandeau.mm-info').textContent().catch(() => '');
    const rap = await pF.locator('h2', { hasText: 'Rapprochement des dotations' }).count();
    return { ok: k >= 6 && /Observation limitée/.test(av) && rap === 1, obtenu: `kpi=${k} · rapprochement=${rap} · "${av.slice(0, 70)}"`, preuve: await capture(pF, 'pilotage-finance-bureau') };
  });
  await etape('UI-PIL-02', 'Vérification des justificatifs par un tiers', 'Finance vérifie un justificatif depuis les validations', 'justificatif VERIFIE', async () => {
    await pF.locator('[data-action="verifier_justificatif"]').first().click();
    await remplir(pF, { statut: 'VERIFIE' }); const r = await valider(pF);
    const n = (await q("select count(*)::int n from public.moto_carburant where justificatif_statut='VERIFIE'"))[0].n;
    return { ok: r === 'ferme' && n === 1, obtenu: `${r} · vérifiés=${n}` };
  });
  await etape('UI-PIL-03', 'Export Excel', 'BM exporte le classeur', 'fichier .xlsx avec les onglets de pilotage', async () => {
    await pB.goto(BASE + '/moto/index.html#/pilotage'); await pret(pB);
    const [dl] = await Promise.all([pB.waitForEvent('download', { timeout: 20000 }), pB.click('#pilExport')]);
    const f = join(SORTIE, 'export-pilotage-e2e.xlsx'); await dl.saveAs(f);
    const XLSX = require('xlsx'); const wb = XLSX.readFile(f);
    const att = ['Flotte', 'Consommation', 'Intervalles plein a plein', 'Couts', 'Disponibilite', 'Rapprochement dotations', 'Echeances', 'Alertes documents', 'Pneus', 'Incidents ouverts', 'Limites'];
    const manque = att.filter(n => wb.SheetNames.indexOf(n) < 0);
    return { ok: manque.length === 0, obtenu: `onglets=${wb.SheetNames.join(', ')}${manque.length ? ' · manquants=' + manque : ''}`, preuve: 'tests/moto/resultats/export-pilotage-e2e.xlsx' };
  });

  // 9. Formation
  await etape('UI-FOR-01', 'Formation : fiche et quiz', 'Chef d\'unité réussit le quiz Contrôle de sécurité', 'résultat réussi enregistré', async () => {
    await pU.goto(BASE + '/moto/index.html#/formation/CONTROLE_SECURITE'); await pret(pU);
    const bonnes = await pU.evaluate(() => window.MOTO_FORMATION.find(m => m.code === 'CONTROLE_SECURITE').quiz.map(q => q.b));
    for (let i = 0; i < bonnes.length; i++) await pU.check(`input[name="q${i}"][value="${bonnes[i]}"]`);
    await pU.click('#quiz button[type=submit]');
    const t = await attendre(async () => { const x = await pU.textContent('#quizRes'); return /synchronisé|attente/.test(x) ? x : null; }, 10000);
    const n = (await q("select count(*)::int n from public.moto_formation_resultats where reussi"))[0].n;
    return { ok: /Réussi/.test(t || '') && n === 1, obtenu: `"${(t || '').slice(0, 90)}" · base=${n}` };
  });

  // 10. Accès refusés et périmètres
  for (const compte of ['agent', 'sup']) {
    const c = await contexte(compte, 'mobile'); const p = await page(c, '/moto/index.html');
    await etape('UI-SEC-' + compte, 'Rôles non habilités', 'Ouverture par ' + U[compte][2], 'message d\'accès non prévu, aucune donnée moto', async () => {
      await p.waitForSelector('text=Accès AFLP FLEET non prévu', { timeout: 15000 });
      const motos = await p.locator('.mm-carte-moto').count();
      return { ok: motos === 0, obtenu: `cartes moto affichées=${motos}` };
    });
    await c.close();
  }
  { const c = await contexte('uh2', 'mobile'); const p = await page(c, '/moto/index.html#/motos'); await pret(p);
    await etape('UI-SEC-perimetre', 'Périmètre serveur', 'Chef d\'unité Botro ouvre la flotte', 'aucune moto de Sakassou visible', async () => {
      const n = await p.locator('.mm-carte-moto').count();
      return { ok: n === 0, obtenu: `motos visibles=${n}` };
    }); await c.close(); }

  // 10 bis. AFLP FLEET : inspections mensuelles, coordination, exceptions
  // Donnée de test : la moto est datée en service le 20 du mois précédent pour rendre le mois courant exigible.
  await q("update public.moto_motos set mise_en_service_at = date_trunc('month', current_date) - interval '11 days' where id = $1", [motoId]);
  await etape('UI-FL-01', 'Identité AFLP FLEET et anciennes routes (scénarios 1-2)', 'Ouverture de #/motos et #/moto/<id>', 'titre et en-tête AFLP FLEET, routes existantes fonctionnelles', async () => {
    const c = await contexte('bm', 'bureau'); const p = await page(c, '/moto/index.html#/motos'); await pret(p);
    const t = await p.title(), h = await p.textContent('.mm-marque strong'), n = await p.locator('.mm-carte-moto').count();
    await p.goto(BASE + '/moto/index.html#/moto/' + motoId); await pret(p); const h1 = await p.textContent('.mm-passeport h1');
    await c.close();
    return { ok: /AFLP FLEET/.test(t) && h === 'AFLP FLEET' && n >= 1 && /MOTO-001/.test(h1), obtenu: `titre=${t} · en-tête=${h} · cartes=${n} · passeport=${h1}` };
  });
  await etape('UI-FL-10', 'Chef de zone : liste et inspection du mois (scénarios 10, 12)', 'ZH inspecte MOTO-001 depuis Opérations, éclairage en défaut', 'inspection ZONE enregistrée, résultat calculé par le serveur, tardive après le 15', async () => {
    const c = await contexte('zh', 'mobile'); const p = await page(c, '/moto/index.html#/operations'); await pret(p);
    await p.waitForSelector('[data-inspecter]'); const preuveListe = await capture(p, 'zone-inspections-mobile');
    await p.click('[data-inspecter]');
    await remplir(p, { compteur_km: '300', ph_COMPTEUR: { ...PNG, name: 'compteur.png' }, ph_AVANT: { ...PNG, name: 'avant.png' } });
    await toutConforme(p);
    const d = p.locator('dialog.mm-modale').last(); const items = await d.locator('.mm-item').all();
    for (const it of items) if (/Phare, feu arrière/.test(await it.textContent())) await it.locator('input[value=ko]').check();
    const r = await valider(p);
    const x = await attendre(async () => (await q("select niveau, conformite, periode from public.moto_controles where moto_id=$1 and type_controle='INSPECTION_MENSUELLE'", [motoId]))[0]);
    const st = (await q("select statut from public.moto_v_inspections_exigibles where moto_id=$1 and niveau='ZONE' and periode=date_trunc('month', current_date)::date", [motoId]))[0]?.statut;
    await c.close();
    const attenduStatut = new Date().getUTCDate() > 15 ? 'EFFECTUEE_HORS_DELAI' : 'EFFECTUEE';
    return { ok: r === 'ferme' && x?.niveau === 'ZONE' && x?.conformite !== 'CONFORME' && st === attenduStatut, obtenu: `${r} · ${JSON.stringify(x)} · statut=${st}`, preuve: preuveListe };
  });
  await etape('UI-FL-13', 'Coordinateur : espace Coordination et inspection (scénarios 13, 19)', 'Coordinateur ouvre Coordination et inspecte MOTO-001', 'priorités visibles ; anomalie toujours ouverte : résultat au mieux « avec réserves »', async () => {
    const c = await contexte('lc', 'mobile'); const p = await page(c, '/moto/index.html#/coordination'); await pret(p);
    const h = await p.textContent('h1'); const prio = await p.locator('.mm-bloc-alerte .mm-table tbody tr').count();
    await p.locator('[data-inspecter][data-niveau="COORDINATION"]').first().click();
    await remplir(p, { compteur_km: '301', ph_COMPTEUR: { ...PNG, name: 'compteur2.png' }, ph_AVANT: { ...PNG, name: 'avant2.png' } });
    await toutConforme(p); const r = await valider(p);
    const x = await attendre(async () => (await q("select conformite from public.moto_controles where moto_id=$1 and niveau='COORDINATION'", [motoId]))[0]);
    const a = (await q("select count(*)::int n from public.moto_actions_correctives where moto_id=$1 and point_code='ECLAIRAGE' and statut='OUVERTE'", [motoId]))[0].n;
    await p.reload(); await pret(p); const preuve = await capture(p, 'coordination-mobile');
    await c.close();
    return { ok: h === 'Coordination logistique' && prio >= 1 && r === 'ferme' && x?.conformite === 'RESERVES' && a === 1, obtenu: `${h} · priorités=${prio} · ${r} · ${x?.conformite} · anomalie ouverte=${a}`, preuve };
  });
  await etape('UI-FL-20', 'Action corrective planifiée depuis la coordination (scénario 20)', 'Coordinateur planifie la réparation de l\'éclairage', 'statut PLANIFIEE, garage et date cible enregistrés', async () => {
    const c = await contexte('lc', 'bureau'); const p = await page(c, '/moto/index.html#/coordination'); await pret(p);
    await p.locator('[data-action="action_planifier"]').first().click();
    const cible = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    await remplir(p, { action_prevue: 'Remplacement ampoule feu arrière', prestataire: 'GARAGE E2E FICTIF', devis_montant: '2000', date_cible: cible });
    const r = await valider(p);
    const a = (await q("select statut, prestataire from public.moto_actions_correctives where moto_id=$1 and point_code='ECLAIRAGE'", [motoId]))[0];
    await c.close();
    return { ok: r === 'ferme' && a.statut === 'PLANIFIEE' && a.prestataire === 'GARAGE E2E FICTIF', obtenu: `${r} · ${JSON.stringify(a)}` };
  });
  await etape('UI-FL-06', 'Intégrer une moto déjà en exploitation (scénarios 6, 7)', 'Coordinateur intègre une moto sans marque connue', 'marque et compteur « Non disponible », aucune dépense ou vidange créée', async () => {
    const c = await contexte('lc', 'bureau'); const p = await page(c, '/moto/index.html#/coordination'); await pret(p);
    await p.click('[data-admin="integrer"]');
    await remplir(p, { zone_code: 'GBEKE_1', date_debut_utilisation: '2026-02-01', historique_note: 'Utilisée depuis février 2026, historique non disponible (fictif)' });
    const r = await valider(p); await p.waitForSelector('.mm-passeport h1', { timeout: 15000 });
    const h1 = await p.textContent('.mm-passeport h1'); const nd = await p.locator('text=Non disponible').count();
    const m = (await q("select id, marque, compteur_actuel_km from public.moto_motos where origine='EN_EXPLOITATION'"))[0];
    const dep = (await q('select (select count(*) from public.moto_maintenances where moto_id=$1) + (select count(*) from public.moto_carburant where moto_id=$1) n', [m.id]))[0].n;
    const preuve = await capture(p, 'moto-en-exploitation-bureau'); await c.close();
    return { ok: r === 'ferme' && /Marque et modèle non disponibles/.test(h1) && nd >= 3 && m.marque === null && m.compteur_actuel_km === null && Number(dep) === 0, obtenu: `${r} · ${h1} · mentions Non disponible=${nd} · dépenses=${dep}`, preuve };
  });
  await etape('UI-FL-BM', 'Vue Branch Manager centrée sur les exceptions', 'BM ouvre le pilotage', 'section Exceptions à traiter, avec les motos immobilisées et inspections manquantes', async () => {
    const c = await contexte('bm', 'bureau'); const p = await page(c, '/moto/index.html#/pilotage'); await pret(p);
    const t = await p.locator('h2', { hasText: 'Exceptions à traiter' }).count(); const preuve = await capture(p, 'pilotage-exceptions-bureau'); await c.close();
    return { ok: t === 1, obtenu: `section=${t}`, preuve };
  });

  // 10. Migration 6 : maintenance, garages, autorisation individuelle du BM
  async function ouvrirDossier(p, id) { await p.evaluate(i => { const b = document.createElement('button'); b.dataset.action = 'mnt_dossier'; b.dataset.id = i; b.hidden = true; document.querySelector('#motoVue').appendChild(b); b.click(); }, id); await p.locator('dialog.mm-modale-large').waitFor(); }
  async function boutonDossier(p, texte) { await p.locator('dialog.mm-modale-large [data-action]', { hasText: texte }).first().click(); await p.locator('dialog.mm-modale').last().waitFor(); }
  await etape('UI-MNT-01', 'Tableau de bord du coordinateur (§14)', 'Coordinateur ouvre l\'espace Maintenance sur téléphone', '4 sections ; moto sans modèle : diagnostic initial à établir, aucune échéance inventée', async () => {
    const c = await contexte('lc', 'mobile'); const p = await page(c, '/moto/index.html#/maintenance'); await pret(p);
    const h = await p.textContent('h1'); const sec = await p.locator('section.mm-bloc h2').allTextContents();
    const diag = await p.locator('text=Diagnostic initial et historique d\'entretien à établir').count();
    const deb = await debordement(p); const preuve = await capture(p, 'maintenance-coordinateur-mobile'); await c.close();
    const att = ['Maintenance à programmer', 'Autorisations en attente', 'Réparations en cours', 'Dépenses et performance'];
    return { ok: h === 'Maintenance du parc' && att.every(t => sec.includes(t)) && diag >= 1 && deb <= 1, obtenu: `${h} · ${sec.join(' | ')} · diagnostic=${diag} · débordement=${deb}`, preuve };
  });
  await etape('UI-MNT-02', 'Modèle technique et règle proposée (§5)', 'Coordinateur associe MOTO-001 au modèle APSONIC et propose la vidange en politique interne', 'modèle enregistré ; version BROUILLON inactive', async () => {
    const c = await contexte('lc', 'bureau'); const p = await page(c, '/moto/index.html#/maintenance/regles'); await pret(p);
    const hyp = await p.locator('text=Hypothèse non validée').count();
    await p.locator('[data-action="mnt_modele"]').first().click();
    await remplir(p, { code: 'APSONIC_AP150_30', motif: 'Plaque constructeur vérifiée (scénario E2E fictif)' }); const r1 = await valider(p);
    await pret(p); await p.click('[data-mnt="version"]');
    await remplir(p, { regle_code: 'VIDANGE', modele_code: 'APSONIC_AP150_30', intervalle_km: '1500', intervalle_jours: '60', rappel_avant_km: '400', proche_avant_km: '200',
      nature_source: 'POLITIQUE_INTERNE', reference_source: 'Avis technique garage E2E FICTIF n° 1', motif: 'Validation technique obtenue (fictif)' });
    const r2 = await valider(p);
    const m = (await q('select modele_technique_code from public.moto_motos where id=$1', [motoId]))[0];
    const v = (await q("select statut, nature_source from public.moto_regles_versions where nature_source='POLITIQUE_INTERNE' and regle_code='VIDANGE'"))[0];
    const e = (await q("select statut from public.moto_v_echeances where moto_id=$1 and regle='VIDANGE'", [motoId]))[0];
    await c.close();
    return { ok: hyp >= 3 && r1 === 'ferme' && r2 === 'ferme' && m.modele_technique_code === 'APSONIC_AP150_30' && v?.statut === 'BROUILLON' && e?.statut === 'REGLE_NON_APPROUVEE', obtenu: `hypothèses=${hyp} · ${r1}/${r2} · ${m.modele_technique_code} · ${JSON.stringify(v)} · échéance=${e?.statut}` };
  });
  await etape('UI-MNT-03', 'Approbation BM d\'une règle ; hypothèse refusée (§4)', 'BM tente d\'approuver une hypothèse puis approuve la version requalifiée', 'hypothèse refusée ; version APPROUVEE, échéance calculée', async () => {
    const c = await contexte('bm', 'bureau'); const p = await page(c, '/moto/index.html#/maintenance/regles'); await pret(p);
    await p.locator('tr', { hasText: 'Hypothèse non validée' }).first().locator('[data-action="mnt_version_approuver"]').click();
    const toast = await attendre(async () => (await p.locator('text=Une hypothèse non validée ne peut pas être approuvée').count()) || null, 5000);
    await p.locator('tr', { hasText: 'Politique interne' }).first().locator('[data-action="mnt_version_approuver"]').click();
    await remplir(p, { motif: 'Décision BM de test E2E (fictive)' }); const r = await valider(p);
    const v = (await q("select statut from public.moto_regles_versions where nature_source='POLITIQUE_INTERNE' and regle_code='VIDANGE'"))[0];
    const e = (await q("select statut, prochaine_km from public.moto_v_echeances where moto_id=$1 and regle='VIDANGE'", [motoId]))[0];
    await c.close();
    return { ok: !!toast && r === 'ferme' && v.statut === 'APPROUVEE' && e.prochaine_km != null && e.statut !== 'REGLE_NON_APPROUVEE', obtenu: `refus hypothèse=${!!toast} · ${r} · ${v.statut} · ${JSON.stringify(e)}` };
  });
  await etape('UI-MNT-04', 'Garage enregistré ≠ agréé (§9)', 'Coordinateur enregistre un garage', 'statut CANDIDAT', async () => {
    const c = await contexte('lc', 'bureau'); const p = await page(c, '/moto/index.html#/maintenance/garages'); await pret(p);
    await p.click('[data-mnt="garage"]');
    await remplir(p, { nom: 'GARAGE E2E FICTIF', localisation: 'VILLAGE FICTIF', clusters: 'SAKASSOU', types_interventions: 'VIDANGE, REPARATION' }); const r = await valider(p);
    const g = (await q("select statut from public.moto_garages where nom='GARAGE E2E FICTIF'"))[0];
    const preuve = await capture(p, 'maintenance-garages-bureau'); await c.close();
    return { ok: r === 'ferme' && g?.statut === 'CANDIDAT', obtenu: `${r} · ${g?.statut}`, preuve };
  });
  let dossierId = null;
  await etape('UI-MNT-05', 'Coordinateur : besoin, devis avec pièce, soumission au BM (§10, scénario 9)', 'Coordinateur crée le dossier, enregistre un devis de 20 000 et le soumet', 'EN_ATTENTE_BM, pièce dans finmaint/, aucun engagement', async () => {
    const c = await contexte('lc', 'mobile'); const p = await page(c, '/moto/index.html#/maintenance'); await pret(p);
    await p.click('[data-mnt="nouveau"]');
    await remplir(p, { moto_id: motoId, type_maintenance: 'REPARATION', description: 'Plaquettes de frein usées (fictif)' }); const r1 = await valider(p);
    dossierId = (await attendre(async () => (await q("select id from public.moto_maintenances where moto_id=$1 and type_maintenance='REPARATION' order by demande_at desc limit 1", [motoId]))[0]?.id));
    await p.locator('dialog.mm-modale-large').waitFor();
    await boutonDossier(p, 'Enregistrer le devis');
    await remplir(p, { garage_id: { contient: 'GARAGE E2E FICTIF' }, devis_montant: '20000', op1: 'REPARATION', lib1: 'Plaquettes avant', justification: 'Usure constatée à l\'inspection (fictif)',
      consequence_report: 'Freinage dégradé', fichier: PDF }); const r2 = await valider(p);
    await p.locator('dialog.mm-modale-large').waitFor();
    await boutonDossier(p, 'Soumettre au Branch Manager');
    await remplir(p, { perimetre: 'Remplacement plaquettes avant selon devis', consequence_report: 'Freinage dégradé, risque de chute' }); const r3 = await valider(p);
    const x = (await q('select statut, montant_engage, devis_path from public.moto_maintenances where id=$1', [dossierId]))[0];
    const preuve = await capture(p, 'maintenance-dossier-mobile'); await c.close();
    return { ok: [r1, r2, r3].every(v => v === 'ferme') && x.statut === 'EN_ATTENTE_BM' && Number(x.montant_engage) === 0 && /^finmaint\//.test(x.devis_path || ''), obtenu: `${r1}/${r2}/${r3} · ${JSON.stringify(x)}`, preuve };
  });
  await etape('UI-MNT-06', 'Chef de zone : aucun pouvoir financier proposé (scénario 11)', 'Chef de zone ouvre l\'espace Maintenance et le dossier', 'pas d\'onglet Décisions, pas de bouton Autoriser ni Programmer, montants masqués', async () => {
    const c = await contexte('zh', 'mobile'); const p = await page(c, '/moto/index.html#/maintenance'); await pret(p);
    const onglet = await p.locator('nav.mm-onglets a', { hasText: 'Décisions' }).count();
    await ouvrirDossier(p, dossierId);
    const d = p.locator('dialog.mm-modale-large');
    const aut = await d.locator('[data-action="mnt_decider"], [data-action="mnt_programmer"]').count(); const masque = await d.locator('text=accès réservé').count();
    await c.close();
    return { ok: onglet === 0 && aut === 0 && masque === 1, obtenu: `onglet=${onglet} · boutons financiers=${aut} · montants masqués=${masque}` };
  });
  await etape('UI-MNT-07', '« Décisions à prendre » : autorisation BM plafonnée (§15, scénario 15)', 'BM ouvre ses décisions sur téléphone et autorise 15 000 sur 20 000 demandés', 'carte concise ; autorisation nominative de 15 000', async () => {
    const c = await contexte('bm', 'mobile'); const p = await page(c, '/moto/index.html#/maintenance'); await pret(p);
    const carte = await p.locator('.mm-decision').count(); const txt = await p.locator('.mm-decision').first().textContent();
    const preuve = await capture(p, 'maintenance-decisions-bm-mobile');
    await p.locator('.mm-decision [data-action="mnt_decider"]').first().click();
    await remplir(p, { decision: 'AUTORISEE', montant: '15000', commentaire: 'Plaquettes seules, disque à revoir (fictif)' }); const r = await valider(p);
    const a = (await q('select statut, montant_autorise, decide_par from public.moto_autorisations where maintenance_id=$1', [dossierId]))[0];
    const deb = await debordement(p); await c.close();
    return { ok: carte === 1 && /Conséquence d'un report/.test(txt) && /20\s?000/.test(txt) && r === 'ferme' && a.statut === 'AUTORISEE' && Number(a.montant_autorise) === 15000 && a.decide_par === U.bm[0] && deb <= 1,
             obtenu: `cartes=${carte} · ${r} · ${JSON.stringify(a)} · débordement=${deb}`, preuve };
  });
  await etape('UI-MNT-08', 'Engagement limité au plafond autorisé (scénario 15)', 'Coordinateur tente d\'engager 20 000 puis engage 15 000', 'refus serveur affiché ; PROGRAMMEE à 15 000', async () => {
    const c = await contexte('lc', 'bureau'); const p = await page(c, '/moto/index.html#/maintenance/dossiers'); await pret(p);
    await ouvrirDossier(p, dossierId); await boutonDossier(p, 'Programmer les travaux');
    await remplir(p, { montant_engage: '20000' }); const r1 = await valider(p);
    await remplir(p, { montant_engage: '15000' }); const r2 = await valider(p);
    const x = (await q('select statut, montant_engage from public.moto_maintenances where id=$1', [dossierId]))[0];
    await c.close();
    return { ok: /plafond/.test(r1) && r2 === 'ferme' && x.statut === 'PROGRAMMEE' && Number(x.montant_engage) === 15000, obtenu: `${r1.slice(0, 120)} · ${r2} · ${JSON.stringify(x)}` };
  });
  await etape('UI-MNT-09', 'Pilotage BM : décisions de dépense en tête', 'BM ouvre le pilotage', 'bloc « Décisions de dépense à prendre (0) » et lien vers ses décisions', async () => {
    const c = await contexte('bm', 'bureau'); const p = await page(c, '/moto/index.html#/pilotage'); await pret(p);
    const t = await p.locator('h2', { hasText: 'Décisions de dépense à prendre (0)' }).count(); const l = await p.locator('a[href="#/maintenance/decisions"]').count(); await c.close();
    return { ok: t === 1 && l === 1, obtenu: `bloc=${t} · lien=${l}` };
  });

  // 10 bis. Carnet de suivi et documents scannés à l'enregistrement (migration 7)
  await etape('UI-CARNET-01', 'Carnet de suivi complet (Branch Manager)', 'BM ouvre le carnet de MOTO-001, filtre « Décisions et factures », exporte', 'remise avec permis, entretien, décision BM chiffrée ; filtre ; fichier Excel', async () => {
    const c = await contexte('bm', 'bureau'); const p = await page(c, '/moto/index.html#/moto/' + motoId + '/carnet'); await pret(p);
    await p.waitForSelector('[data-carnet]');
    const tout = await p.locator('.mm-carnet-ev').count();
    const remise = await p.locator('.mm-carnet-ev', { hasText: 'Remise officielle' }).filter({ hasText: 'permis vérifié' }).count();
    const decision = await p.locator('.mm-carnet-ev', { hasText: 'Décision du Branch Manager' }).locator('.mm-carnet-montant').count();
    const preuve = await capture(p, 'carnet-bm-bureau');
    await p.click('[data-action="carnet_filtre"][data-f="FINANCES"]');
    const filtres = await p.locator('.mm-carnet-ev').count(); const autres = await p.locator('.mm-carnet-ev:not(.mm-cat-finances)').count();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('[data-action="carnet_export"]')]);
    const f = join(SORTIE, 'carnet-e2e.xlsx'); await dl.saveAs(f);
    const X = require('xlsx'); const wb = X.readFile(f); const lignes = X.utils.sheet_to_json(wb.Sheets['Carnet']).length;
    await c.close();
    return { ok: tout >= 8 && remise === 1 && decision >= 1 && filtres >= 1 && autres === 0 && wb.SheetNames.join(',') === 'Synthèse,Carnet' && lignes === tout,
      obtenu: `événements=${tout} · remise+permis=${remise} · décision chiffrée=${decision} · filtre=${filtres}/${autres} hors rubrique · Excel ${wb.SheetNames.join('+')} ${lignes} lignes`, preuve };
  });
  await etape('UI-CARNET-02', 'Carnet vu par le Chef d\'unité : historique sans montants d\'entretien', 'Chef d\'unité ouvre le carnet de sa moto', 'chronologie visible, aucune décision ni facture, coût « Accès réservé »', async () => {
    const c = await contexte('uh', 'mobile'); const p = await page(c, '/moto/index.html#/moto/' + motoId + '/carnet'); await pret(p);
    await p.waitForSelector('[data-carnet]');
    const n = await p.locator('.mm-carnet-ev').count(); const fin = await p.locator('.mm-carnet-ev', { hasText: /Décision du Branch Manager|Facture n°/ }).count();
    const reserve = await p.locator('.mm-kpi', { hasText: 'Accès réservé' }).count(); const deb = await debordement(p);
    const preuve = await capture(p, 'carnet-uh-mobile'); await c.close();
    return { ok: n >= 5 && fin === 0 && reserve === 1 && deb <= 1, obtenu: `événements=${n} · financiers=${fin} · accès réservé=${reserve} · débordement=${deb}px`, preuve };
  });
  await etape('UI-SCAN-01', 'Documents scannés dès l\'enregistrement d\'une moto', 'Coordinateur enregistre une moto avec la carte grise scannée (2 pages, recadrage, rotation)', 'moto créée, carte grise EN_VERIFICATION, PDF valide de 2 pages', async () => {
    const c = await contexte('lc', 'mobile'); const p = await page(c, '/moto/index.html#/coordination'); await pret(p);
    await p.click('[data-admin="creer"]');
    await remplir(p, { situation_parc: 'RECEPTIONNEE', marque: 'APSONIC', modele: 'AP150-30', date_reception: '2026-10-31', cluster_code: 'BOTRO', ref_CARTE_GRISE: 'E2E-CG-0002' });
    const bloc = p.locator('[data-scan-champ="scan_CARTE_GRISE"]');
    await bloc.locator('[data-scan-ouvrir]').click();
    const sd = p.locator('dialog.mm-scan-dialog').last(); await sd.waitFor();
    await sd.locator('[data-galerie]').setInputFiles([IMG_RECTO, IMG_VERSO]); await sd.locator('.mm-scan-page').nth(1).waitFor();
    await sd.locator('.mm-scan-page').nth(1).locator('[data-rot]').click();
    await sd.locator('.mm-scan-page').nth(0).locator('[data-cadre]').click();
    const cd = p.locator('dialog.mm-scan-cadre'); await cd.waitFor();
    const coin = cd.locator('.mm-coin-se'); const bb = await coin.boundingBox();
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x - 40, bb.y - 30, { steps: 5 }); await p.mouse.up();
    await cd.locator('button[type=submit]').click(); await cd.waitFor({ state: 'detached' });
    const preuveScan = await capture(p, 'scanner-mobile');
    await sd.locator('[data-valider]').click(); await bloc.locator('.mm-scan-etat.mm-scan-ok').waitFor({ timeout: 15000 });
    globalThis.__depots = [];
    const r = await valider(p);
    const doc = (await q("select d.statut, d.numero_reference, d.storage_path from public.moto_documents d join public.moto_motos m on m.id=d.moto_id where d.type_document='CARTE_GRISE' and d.numero_reference='E2E-CG-0002'"))[0] || {};
    const dep = (globalThis.__depots || []).filter(d => /\/document\//.test(d.url)).pop();
    const pdf = dep ? verifierPdf(dep.corps) : 'aucun dépôt';
    await c.close();
    return { ok: r === 'ferme' && doc.statut === 'EN_VERIFICATION' && /\.pdf$/.test(doc.storage_path || '') && pdf === 'PDF valide · 2 page(s)', obtenu: `${r} · ${doc.statut} · ${doc.storage_path} · ${pdf}`, preuve: preuveScan };
  });

  // 11. Trois largeurs : écrans principaux
  for (const [l] of Object.entries(LARGEURS)) {
    for (const [compte, chemin, nom] of [['bm', '#/motos', 'flotte'], ['bm', '#/moto/' + motoId, 'passeport'], ['bm', '#/pilotage', 'pilotage'], ['uh', '#/operations', 'operations'], ['uh', '#/formation', 'formation'], ['bm', '#/conducteurs', 'conducteurs'], ['bm', '#/moto/' + motoId + '/carnet', 'carnet'], ['uh', '#/motos', 'mon-permis'], ['abm', '#/admin', 'administration'], ['lc', '#/coordination', 'coordination'], ['bm', '#/moto/' + motoId + '/photos', 'photos'], ['lc', '#/maintenance', 'maintenance'], ['bm', '#/maintenance/decisions', 'decisions-bm'], ['lc', '#/moto/' + motoId + '/entretiens', 'entretiens']]) {
      const c = await contexte(compte, l); const p = await page(c, '/moto/index.html' + chemin); await pret(p);
      await etape(`UI-RWD-${nom}-${l}`, 'Mobile, tablette, ordinateur', `${nom} à ${LARGEURS[l].width}×${LARGEURS[l].height}`, 'rendu sans débordement horizontal', async () => {
        const deb = await debordement(p);
        return { ok: deb <= 1, obtenu: `débordement=${deb}px`, preuve: await capture(p, `${nom}-${l}`) };
      });
      await c.close();
    }
  }
} finally {
  /* Refus serveur VOULUS par les scénarios négatifs (ex. UI-REM-02 : remise sans gilet) : le navigateur
     les journalise comme « Failed to load resource : 400 ». On les isole, tout le reste doit être nul. */
  const ATTENDUS = [/HTTP 400 POST \/rest\/v1\/rpc\/moto_remettre/, /HTTP 400 POST \/rest\/v1\/rpc\/moto_maintenance_programmer/];
  const reseau = ERREURS_CONSOLE.filter(e => /^HTTP /.test(e.message));
  const reseauInattendu = reseau.filter(e => !ATTENDUS.some(r => r.test(e.message)));
  const console_ = ERREURS_CONSOLE.filter(e => !/^HTTP /.test(e.message) && !/favicon/i.test(e.message)
    && !(/Failed to load resource: the server responded with a status of 400/.test(e.message) && reseau.length > reseauInattendu.length));
  noter('UI-CONSOLE', 'Aucune erreur console', 'Erreurs JavaScript et réponses HTTP en erreur sur toutes les pages', '0 inattendue',
        console_.length === 0 && reseauInattendu.length === 0,
        `console=${console_.length} · réseau inattendu=${reseauInattendu.length} · refus attendus=${reseau.length - reseauInattendu.length}` + (console_.length + reseauInattendu.length ? ' · ' + JSON.stringify(console_.concat(reseauInattendu).slice(0, 5)) : ''));
  writeFileSync(join(SORTIE, 'navigateur.json'), JSON.stringify({ date: new Date().toISOString(), base: DB, resultats: RESULTATS, erreurs_console: ERREURS_CONSOLE }, null, 1));
  const ok = RESULTATS.filter(r => r.resultat === 'RÉUSSI').length;
  console.log(`\nTOTAL : ${ok}/${RESULTATS.length} réussis`);
  await navigateur.close(); serveur.close(); await emu.fermer();
  process.exitCode = ok === RESULTATS.length ? 0 : 1;
}
