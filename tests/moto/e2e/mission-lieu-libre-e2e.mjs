#!/usr/bin/env node
/**
 * AFLP FLEET — départ de mission vers un lieu absent de la liste des villages, par l'écran (caméra simulée), dans un VRAI navigateur, aux 3 largeurs.
 *
 * Interface réelle (moto/*.js servis tels quels) → émulateur local de l'API Supabase
 * → vraies fonctions et RLS (migrations 1 à 10) sur la réplique LOCALE.
 * Données 100 % fictives. Aucune connexion à Supabase production.
 *
 * Mesure aussi la réduction réelle d'écrans et d'actions : le même parcours est joué
 * avec l'écran ACTUEL de production (moto-app.js de la branche main, servi à la place)
 * et avec le nouvel écran, en comptant chaque clic, saisie et fichier.
 *
 * Prérequis :
 *   npm install --no-save pg@8 @supabase/supabase-js@2 xlsx@0.18.5 qrcode-generator@1.4.4   (Playwright préinstallé)
 *   base : réplique + migrations 1-10 (voir tests/moto/executer_tests_aptitude_10.sh)
 *   PGHOST=… PGPORT=… PGDATABASE_E2E=fbms_apt10_e2e node tests/moto/e2e/aptitude-e2e.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { creerEmulateur, session } from './postgrest-local.mjs';

const require = createRequire(import.meta.url);
const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = normalize(join(ICI, '..', '..', '..'));
const SORTIE = join(RACINE, 'tests', 'moto', 'resultats');
const CAPTURES = join(SORTIE, 'captures', 'mission-lieu-libre');
mkdirSync(CAPTURES, { recursive: true });
const PORT = Number(process.env.PORT_MOTO_E2E || 4399);
const BASE = `http://127.0.0.1:${PORT}`;
const SUPA = 'https://jmbdgpdthzpszfnddwzi.supabase.co';
const DB = process.env.PGDATABASE_E2E || 'fbms_apt10_e2e';
const emu = creerEmulateur({ host: process.env.PGHOST, port: Number(process.env.PGPORT), database: DB });
const q = (sql, v) => emu.pool.query(sql, v).then(r => r.rows);
const LARGEURS = { mobile: { width: 390, height: 844 }, tablette: { width: 768, height: 1024 }, bureau: { width: 1440, height: 900 } };
const APP_MAIN = execFileSync('git', ['-C', RACINE, 'show', 'main:moto/moto-app.js']);   // écran actuellement en production

const uid = n => `00000000-0000-4000-9210-${String(n).padStart(12, '0')}`;
const U = {
  bm: [uid(1), 'BM APT FICTIF', 'Branch Manager', null], abm: [uid(2), 'ABM APT FICTIF', 'Assistant Branch Manager', null],
  lc: [uid(3), 'COORDINATEUR APT FICTIF', 'Supervisor', null], uh: [uid(4), 'UH APT FICTIF', 'Unit Head', 'SAKASSOU'],
  uh_mobile: [uid(5), 'UH MOBILE FICTIF', 'Unit Head', 'SAKASSOU'], uh_tablette: [uid(6), 'UH TABLETTE FICTIF', 'Unit Head', 'SAKASSOU'], uh_bureau: [uid(7), 'UH BUREAU FICTIF', 'Unit Head', 'SAKASSOU'],
};
const RESULTATS = []; const ERREURS = [];
function noter(id, exigence, action, attendu, ok, obtenu, preuve) {
  RESULTATS.push({ id, exigence, action, attendu, obtenu: String(obtenu).slice(0, 300), resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', preuve: preuve || '' });
  console.log(`${ok ? '✓' : '✗'} ${id} ${action} — ${String(obtenu).slice(0, 160)}`);
}
async function etape(id, exigence, action, attendu, fn) {
  try { const r = await fn(); noter(id, exigence, action, attendu, r.ok, r.obtenu, r.preuve); return r; }
  catch (e) { noter(id, exigence, action, attendu, false, 'EXCEPTION : ' + String(e && e.message || e).split('\n')[0]); return { ok: false }; }
}
async function attendre(f, ms = 15000, pas = 200) { const fin = Date.now() + ms; let v; while (Date.now() < fin) { v = await f(); if (v) return v; await new Promise(r => setTimeout(r, pas)); } return v; }

/* -- Serveur statique ----------------------------------------------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const serveur = createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]); let f = normalize(join(RACINE, p));
  if (!f.startsWith(RACINE)) { res.writeHead(403).end(); return; }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404).end('absent'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f));
});
await new Promise(r => serveur.listen(PORT, '127.0.0.1', r));

/* -- Données fictives : comptes et motos préparés par les vraies fonctions -- */
for (const [k, [id, nom, role, cluster]] of Object.entries(U)) {
  await q('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [id, k + '.m21@example.invalid']);
  await q('insert into public.profils (user_id, email, nom, role, cluster, actif) values ($1,$2,$3,$4,$5,true) on conflict do nothing', [id, k + '.m21@example.invalid', nom, role, cluster]);
}
await q("update public.profils set fonction_operationnelle = 'Logistics Coordinator' where user_id = $1", [U.lc[0]]);
async function rpcEnTantQue(compte, fonction, args) {
  const c = await emu.pool.connect();
  try {
    await c.query('begin'); await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[compte][0], role: 'authenticated' })]);
    const noms = Object.keys(args); const r = await c.query(`select public.${fonction}(${noms.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`, noms.map(n => args[n]));
    await c.query('commit'); return r.rows[0].r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
let nSerie = 0; const RUN = Date.now().toString(36).toUpperCase();   // identifiants fictifs uniques par exécution
async function motoPrete(cluster, origine = 'NEUVE') {
  nSerie++;
  const p = origine === 'NEUVE' ? { marque: 'APSONIC', modele: 'AP150-30 FICTIF', cluster_code: cluster, date_reception: new Date().toISOString().slice(0, 10), compteur_km: 3, motif: 'Recette navigateur' }
                                : { origine: 'EN_EXPLOITATION', marque: 'APSONIC', modele: 'AP150-30 FICTIF', cluster_code: cluster, date_debut_utilisation: '2026-02-01', motif: 'Recette navigateur' };
  const m = await rpcEnTantQue('abm', 'moto_creer', { p: JSON.stringify(p) });
  await rpcEnTantQue('abm', 'moto_modifier_identite', { p_moto: m.id, p: JSON.stringify({ numero_chassis: `APT-FICTIF-${RUN}-${nSerie}`, immatriculation: `APT ${RUN} ${nSerie} FICTIF` }), p_motif: 'Saisie identité recette' });
  for (const typ of ['CARTE_GRISE', 'PLAQUE', 'ASSURANCE']) {
    const chemin = `${m.id}/document/${typ.toLowerCase()}-${RUN}-${nSerie}.pdf`;
    await q("insert into storage.objects (bucket_id, name, owner) values ('moto-documents', $1, $2) on conflict do nothing", [chemin, U.abm[0]]);
    const d = await rpcEnTantQue('abm', 'moto_document_enregistrer', { p: JSON.stringify({ moto_id: m.id, type_document: typ, storage_path: chemin, ...(typ === 'ASSURANCE' ? { date_expiration: '2027-10-01' } : {}) }) });
    await rpcEnTantQue('bm', 'moto_document_verifier', { p_document: d.id, p_statut: 'CONFORME' });
  }
  return m.id;
}

/* -- Navigateur ------------------------------------------------------------ */
const CDN = { 'supabase.min.js': require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), 'xlsx.full.min.js': require.resolve('xlsx/dist/xlsx.full.min.js'), 'qrcode.js': require.resolve('qrcode-generator/qrcode.js') };
const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function contexte(compte, largeur, ancienEcran = false) {
  const ctx = await navigateur.newContext({ viewport: LARGEURS[largeur], serviceWorkers: 'block' });
  await ctx.addInitScript(([cle, s]) => { try { localStorage.setItem(cle, JSON.stringify(s)); } catch (e) {} }, ['sb-jmbdgpdthzpszfnddwzi-auth-token', session(U[compte][0], compte + '.m21@example.invalid')]);
  await ctx.route(SUPA + '/**', async route => {
    const r = route.request(); const rep = await emu.traiter({ methode: r.method(), url: r.url(), entetes: r.headers(), corps: r.postDataBuffer() });
    return route.fulfill({ status: rep.status, headers: rep.headers, body: rep.body });
  });
  await ctx.route(/cdn\.jsdelivr\.net\/.*/, route => { const nom = Object.keys(CDN).find(k => route.request().url().endsWith(k)); return nom ? route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(CDN[nom]) }) : route.fulfill({ status: 404, body: '' }); });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (ancienEcran) await ctx.route(BASE + '/moto/moto-app.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: APP_MAIN }));
  return ctx;
}
async function ouvrir(ctx, chemin) {
  const p = await ctx.newPage();
  if (process.env.DEBUG_APT) { p.on('request', r => { if (r.url().includes('supabase')) console.log('REQ', r.method(), r.url().replace(SUPA, '').slice(0, 120)); }); p.on('requestfinished', r => { if (r.url().includes('supabase')) console.log('FIN', r.url().replace(SUPA, '').slice(0, 120)); }); p.on('requestfailed', r => console.log('ECHEC', r.url().slice(0, 120), r.failure() && r.failure().errorText)); p.on('console', m => console.log('CONSOLE', m.type(), m.text().slice(0, 200))); }
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) ERREURS.push(chemin + ' : ' + m.text().slice(0, 200)); });
  p.on('pageerror', e => ERREURS.push(chemin + ' : pageerror ' + e.message.slice(0, 200)));
  // Les 404 sur les photos fictives (métadonnées sans fichier) sont attendues dans ce banc.
  p.on('response', r => { if (r.status() >= 400 && !/\/controle\/.*\.jpg/.test(r.url())) ERREURS.push(chemin + ' : HTTP ' + r.status() + ' ' + r.url().replace(SUPA, '').slice(0, 140)); });
  await p.goto(BASE + chemin);
  try { await p.waitForFunction(() => !document.getElementById('anagroci-authgate') && document.querySelector('#motoVue') && !document.querySelector('#motoVue .mm-chargement') && !document.querySelector('#mmOnglet .mm-chargement'), null, { timeout: 20000 }); }
  catch (e) { await capture(p, 'echec-ouverture'); throw new Error('Page non prête : ' + (await p.evaluate(() => (document.querySelector('#mmOnglet') || document.body).innerText.slice(0, 300))) + ' | ' + ERREURS.slice(-3).join(' | ')); }
  return p;
}
async function capture(p, nom) { const f = join(CAPTURES, nom + '.png'); await p.screenshot({ path: f, fullPage: true }); return 'tests/moto/resultats/captures/mission-lieu-libre/' + nom + '.png'; }
async function debordement(p) { return p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); }
const dlg = p => p.locator('dialog.mm-modale').last();
async function soumettre(p) {
  const h = await dlg(p).elementHandle(); await (await h.$('button[type=submit]')).click();
  return (await attendre(async () => { if (!(await h.evaluate(e => e.isConnected && e.open))) return 'ferme'; const err = await h.$('.mm-erreur:not([hidden])'); return err ? 'erreur:' + (await err.textContent()) : null; }, 20000)) || 'délai';
}
const JPG = n => ({ name: `photo-${n}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGBwgHBwcHCAoKCQgJCAcHCAsICQoKCgoKBggLDAsKDAkKCgr/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64') });


async function imageCompteur(valeur) {
  const pg = await navigateur.newPage({ viewport: { width: 720, height: 960 } });
  const chiffres = String(valeur).padStart(6, '0').split('').map(c => `<span>${c}</span>`).join('');
  await pg.setContent(`<body style="margin:0;background:#1c1f22;height:960px"><div style="position:absolute;top:400px;left:180px;width:360px;height:130px;background:#000;border:4px solid #777;display:flex;gap:6px;align-items:center;justify-content:center"><style>span{display:inline-block;width:48px;height:100px;background:#111;color:#f2f2f2;font:bold 84px monospace;line-height:100px;text-align:center}</style>${chiffres}</div><p style="position:absolute;top:600px;color:#888">TABLEAU DE BORD FICTIF · TEST E2E</p></body>`);
  const b = await pg.screenshot({ type: 'jpeg', quality: 92 }); await pg.close();
  const f = join(SORTIE, `camera-compteur-lieu-${valeur}.mjpeg`); writeFileSync(f, Buffer.concat([b, b, b, b, b])); return f;
}
const GPS = { latitude: 7.69, longitude: -5.03, accuracy: 15 };
try {
  for (const largeur of Object.keys(LARGEURS)) {
    const benef = 'uh_' + largeur;
    const pp = `permis/${U[benef][0]}/${crypto.randomUUID()}.pdf`;
    await q("insert into storage.objects (bucket_id, name, owner) values ('moto-documents', $1, $2)", [pp, U.bm[0]]);
    await rpcEnTantQue('bm', 'moto_permis_enregistrer', { p: JSON.stringify({ titulaire_id: U[benef][0], nom_titulaire: U[benef][1], numero_permis: 'M21-' + RUN + '-' + largeur.toUpperCase(), categories: ['A'], sans_expiration: true, document_path: pp }) });
    const m = await motoPrete('SAKASSOU');
    const items = (await q("select json_agg(json_build_object('code', code, 'ok', true) order by ordre) j from public.moto_catalogue_points where type_controle='INSPECTION_INITIALE' and actif"))[0].j;
    await rpcEnTantQue('abm', 'moto_inspection_initiale', { p: JSON.stringify({ moto_id: m, items, intervenant_nom: 'MECANICIEN QUALIFIE FICTIF', compteur_km: 5 }) });
    await rpcEnTantQue('bm', 'moto_preaffecter', { p_moto: m, p_beneficiaire: U[benef][0], p_motif: 'Affectation recette' });
    await rpcEnTantQue('bm', 'moto_remettre', { p: JSON.stringify({ moto_id: m, compteur_km: 5, equipements: { CASQUE: true, GILET_HAUTE_VISIBILITE: true } }) });
    await rpcEnTantQue('bm', 'moto_mettre_en_service', { p_moto: m, p_motif: 'Autorisation recette' });
    const cam = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + await imageCompteur(12)] });
    const ctx = await cam.newContext({ viewport: LARGEURS[largeur], serviceWorkers: 'block', geolocation: GPS, permissions: ['geolocation', 'camera'] });
    await ctx.addInitScript(([cle, s]) => { try { localStorage.setItem(cle, JSON.stringify(s)); } catch (e) {} }, ['sb-jmbdgpdthzpszfnddwzi-auth-token', session(U[benef][0], benef + '.m21@example.invalid')]);
    await ctx.route(SUPA + '/**', async route => { const r = route.request(); const rep = await emu.traiter({ methode: r.method(), url: r.url(), entetes: r.headers(), corps: r.postDataBuffer() }); return route.fulfill({ status: rep.status, headers: rep.headers, body: rep.body }); });
    await ctx.route(/cdn\.jsdelivr\.net\/.*/, route => { const nom = Object.keys(CDN).find(k => route.request().url().endsWith(k)); return nom ? route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(CDN[nom]) }) : route.fulfill({ status: 404, body: '' }); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const p = await ouvrir(ctx, '/moto/index.html#/operations');
    await etape(`LL-01-${largeur}`, 'Départ de mission vers un lieu hors liste', `Démarrer → photo → case « pas dans la liste » → lieu écrit (${LARGEURS[largeur].width} px)`, 'mission OUVERTE avec la destination écrite', async () => {
      await p.locator('[data-mission="depart"]').waitFor({ timeout: 15000 }); await p.click('[data-mission="depart"]');
      const camd = p.locator('dialog.mm-camera'); await camd.waitFor();
      await p.locator('dialog.mm-camera [data-photo]:not([disabled])').waitFor({ timeout: 15000 }); await p.waitForTimeout(600);
      await p.click('dialog.mm-camera [data-photo]'); await camd.waitFor({ state: 'detached' });
      const d = dlg(p); await d.waitFor();
      if (!(await d.locator('[name="compteur_km"]').inputValue())) await d.locator('[name="compteur_km"]').fill('12');
      await d.locator('[name="objet"]').selectOption({ index: 1 });
      const libreAvant = await d.locator('[data-dest-libre]').isHidden();
      await d.locator('[data-dest-coche]').check();
      const listeCachee = await d.locator('[data-dest-liste]').isHidden();
      await d.locator('[name="destination_libre"]').fill('Campement fictif hors liste ' + largeur);
      const preuve = await capture(p, `formulaire-${largeur}`);
      const r = await soumettre(p);
      const mi = await attendre(async () => (await q("select destination, statut from public.moto_missions where moto_id = $1 order by created_at desc limit 1", [m]))[0], 20000);
      return { ok: libreAvant && listeCachee && r === 'ferme' && mi && mi.destination === 'Campement fictif hors liste ' + largeur && mi.statut === 'OUVERTE' && (await debordement(p)) <= 0,
               obtenu: `champ libre caché au départ=${libreAvant} liste masquée=${listeCachee} fenêtre=${r} mission=${mi ? mi.statut + ' → ' + mi.destination : 'absente'}`, preuve };
    });
    await ctx.close(); await cam.close();
  }
} finally {
  writeFileSync(join(SORTIE, 'mission_lieu_libre_e2e.json'), JSON.stringify({ base: DB, date: new Date().toISOString(), resultats: RESULTATS, erreurs_console: ERREURS }, null, 1));
  await navigateur.close(); serveur.close(); await emu.pool.end();
}
const ok = RESULTATS.filter(r => r.resultat === 'RÉUSSI').length;
console.log(`\nBilan navigateur : ${ok}/${RESULTATS.length} réussis · erreurs console : ${ERREURS.length}`);
if (ERREURS.length) console.log(ERREURS.slice(0, 10).join('\n'));
process.exit(ok === RESULTATS.length ? 0 : 1);
