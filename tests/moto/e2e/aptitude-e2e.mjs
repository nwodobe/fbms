#!/usr/bin/env node
/**
 * AFLP FLEET 10 — « Aptitude et mise en service » dans un VRAI navigateur, aux 3 largeurs.
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
const CAPTURES = join(SORTIE, 'captures', 'aptitude-10');
mkdirSync(CAPTURES, { recursive: true });
const PORT = Number(process.env.PORT_MOTO_E2E || 4381);
const BASE = `http://127.0.0.1:${PORT}`;
const SUPA = 'https://jmbdgpdthzpszfnddwzi.supabase.co';
const DB = process.env.PGDATABASE_E2E || 'fbms_apt10_e2e';
const emu = creerEmulateur({ host: process.env.PGHOST, port: Number(process.env.PGPORT), database: DB });
const q = (sql, v) => emu.pool.query(sql, v).then(r => r.rows);
const LARGEURS = { mobile: { width: 390, height: 844 }, tablette: { width: 768, height: 1024 }, bureau: { width: 1440, height: 900 } };
const APP_MAIN = execFileSync('git', ['-C', RACINE, 'show', 'main:moto/moto-app.js']);   // écran actuellement en production

const uid = n => `00000000-0000-4000-9100-${String(n).padStart(12, '0')}`;
const U = {
  bm: [uid(1), 'BM APT FICTIF', 'Branch Manager', null], abm: [uid(2), 'ABM APT FICTIF', 'Assistant Branch Manager', null],
  lc: [uid(3), 'COORDINATEUR APT FICTIF', 'Supervisor', null], uh: [uid(4), 'UH APT FICTIF', 'Unit Head', 'SAKASSOU'],
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
  await q('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [id, k + '.apt@example.invalid']);
  await q('insert into public.profils (user_id, email, nom, role, cluster, actif) values ($1,$2,$3,$4,$5,true) on conflict do nothing', [id, k + '.apt@example.invalid', nom, role, cluster]);
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
  await ctx.addInitScript(([cle, s]) => { try { localStorage.setItem(cle, JSON.stringify(s)); } catch (e) {} }, ['sb-jmbdgpdthzpszfnddwzi-auth-token', session(U[compte][0], compte + '.apt@example.invalid')]);
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
  p.on('console', m => { if (m.type() === 'error') ERREURS.push(chemin + ' : ' + m.text().slice(0, 200)); });
  p.on('pageerror', e => ERREURS.push(chemin + ' : pageerror ' + e.message.slice(0, 200)));
  await p.goto(BASE + chemin);
  try { await p.waitForFunction(() => !document.getElementById('anagroci-authgate') && document.querySelector('#motoVue') && !document.querySelector('#motoVue .mm-chargement') && !document.querySelector('#mmOnglet .mm-chargement'), null, { timeout: 20000 }); }
  catch (e) { await capture(p, 'echec-ouverture'); throw new Error('Page non prête : ' + (await p.evaluate(() => (document.querySelector('#mmOnglet') || document.body).innerText.slice(0, 300))) + ' | ' + ERREURS.slice(-3).join(' | ')); }
  return p;
}
async function capture(p, nom) { const f = join(CAPTURES, nom + '.png'); await p.screenshot({ path: f, fullPage: true }); return 'tests/moto/resultats/captures/aptitude-10/' + nom + '.png'; }
async function debordement(p) { return p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); }
const dlg = p => p.locator('dialog.mm-modale').last();
async function soumettre(p) {
  const h = await dlg(p).elementHandle(); await (await h.$('button[type=submit]')).click();
  return (await attendre(async () => { if (!(await h.evaluate(e => e.isConnected && e.open))) return 'ferme'; const err = await h.$('.mm-erreur:not([hidden])'); return err ? 'erreur:' + (await err.textContent()) : null; }, 20000)) || 'délai';
}
const JPG = n => ({ name: `photo-${n}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGBwgHBwcHCAoKCQgJCAcHCAsICQoKCgoKBggLDAsKDAkKCgr/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64') });

/* Compteur d'actions utilisateur : chaque clic, saisie, case cochée ou fichier joint compte pour 1. */
function compteur() { const c = { actions: 0, ecrans: 0 }; return { c, clic: async l => { c.actions++; await l.click(); }, saisir: async (l, v) => { c.actions++; await l.fill(String(v)); }, cocher: async l => { c.actions++; await l.check(); }, fichier: async (l, f) => { c.actions++; await l.setInputFiles(f); }, ecran: () => { c.ecrans++; } }; }

/* ========================================================================= */
const MESURES = {};
try {
  // ---------------------------------------------------------------- 1. Les 3 largeurs
  for (const largeur of Object.keys(LARGEURS)) {
    const mA = await motoPrete('SAKASSOU'), mB = await motoPrete('SAKASSOU');
    const ctx = await contexte('abm', largeur); let p = await ouvrir(ctx, '/moto/index.html#/moto/' + mA + '/synthese');
    await etape(`E2E-01-${largeur}`, 'Section « Aptitude et mise en service » : aptitude et circulation séparées, exigences restantes, bouton principal', `Synthèse à ${LARGEURS[largeur].width}×${LARGEURS[largeur].height}`, '2 cartes, 4 étapes, exigences, bouton « Évaluer l\'aptitude », aucun débordement', async () => {
      await p.waitForSelector('.mm-aptitude', { timeout: 15000 });
      const cartes = await p.locator('.mm-apt-carte').count(), etapes = await p.locator('.mm-etapes li').count(), ex = await p.locator('.mm-exigence').count();
      const btn = await p.locator('.mm-aptitude [data-action="aptitude"]').first().isVisible(), deb = await debordement(p);
      const txt = (await p.locator('.mm-apt-cartes').textContent()).replace(/\s+/g, ' ');
      return { ok: cartes === 2 && etapes === 4 && ex >= 2 && btn && deb <= 0 && /Non autorisée/.test(txt) && /À contrôler/.test(txt), obtenu: `cartes=${cartes} étapes=${etapes} exigences=${ex} bouton=${btn} débordement=${deb}px · ${txt.slice(0, 120)}`, preuve: await capture(p, `synthese-${largeur}`) };
    });
    await etape(`E2E-02-${largeur}`, 'Résultat jamais pré-rempli ; formulaire unique en 4 étapes', 'Ouvrir « Évaluer l\'aptitude »', '4 étapes, 13 points, 0 coché, aperçu « À compléter »', async () => {
      await p.locator('.mm-aptitude [data-action="aptitude"]').first().click(); await dlg(p).waitFor();
      const legendes = await dlg(p).locator('fieldset.mm-etape > legend').allTextContents(), pts = await dlg(p).locator('.mm-item-guide').count();
      const coches = await dlg(p).locator('input[type=radio]:checked').count(), apercu = (await dlg(p).locator('[data-apercu-resultat]').textContent()).trim();
      const sel = await dlg(p).locator('select[name="resultat"]').count();
      return { ok: legendes.length === 4 && pts === 13 && coches === 0 && /À compléter : 13/.test(apercu) && sel === 0, obtenu: `étapes=${legendes.length} points=${pts} cochés=${coches} conclusion manuelle=${sel} · ${apercu}`, preuve: await capture(p, `formulaire-${largeur}`) };
    });
    await etape(`E2E-03-${largeur}`, 'Enregistrement progressif (brouillon local, sans photo)', 'Saisie partielle, fermeture, réouverture', 'brouillon restauré : mécanicien et 5 réponses', async () => {
      await dlg(p).locator('[name="intervenant_nom"]').fill('MECANICIEN QUALIFIE FICTIF');
      for (let i = 0; i < 5; i++) await dlg(p).locator(`input[name="apt${i}"][value="ok"]`).check();
      await p.waitForTimeout(600); await dlg(p).locator('.mm-annuler').click();
      await p.locator('.mm-aptitude [data-action="aptitude"]').first().click(); await dlg(p).waitFor();
      const banniere = await dlg(p).locator('[data-brouillon]').count(), meca = await dlg(p).locator('[name="intervenant_nom"]').inputValue(), coches = await dlg(p).locator('input[type=radio]:checked').count();
      return { ok: banniere === 1 && meca === 'MECANICIEN QUALIFIE FICTIF' && coches === 5, obtenu: `bannière=${banniere} mécanicien=${meca} réponses=${coches}` };
    });
    await etape(`E2E-04-${largeur}`, 'Réserve acceptée seulement si justifiée', 'Batterie en défaut sans description, puis décrite', 'refus explicite, puis « Apte avec réserves »', async () => {
      const L = await dlg(p).locator('.mm-item-guide').count();
      for (let i = 0; i < L; i++) {
        const lib = await dlg(p).locator('.mm-item-guide').nth(i).locator('span').first().textContent();
        await dlg(p).locator(`input[name="apt${i}"][value="${/Batterie/.test(lib) ? 'ko' : 'ok'}"]`).check();
      }
      const apercu1 = (await dlg(p).locator('[data-apercu-resultat]').textContent()).replace(/\s+/g, ' ');
      const r1 = await soumettre(p);
      const iBat = await dlg(p).locator('.mm-item-guide').evaluateAll(els => els.findIndex(e => /Batterie/.test(e.textContent)));
      await dlg(p).locator(`[name="aptobs${iBat}"]`).fill('Démarrage lent, remplacement sous 30 jours (fictif)');
      const apercu2 = (await dlg(p).locator('[data-apercu-resultat]').textContent()).replace(/\s+/g, ' ');
      const r2 = await soumettre(p);
      await p.waitForSelector('.mm-aptitude', { timeout: 15000 });
      const carte = (await p.locator('.mm-apt-carte').first().textContent()).replace(/\s+/g, ' ');
      return { ok: /justifier/.test(apercu1) && /Décrivez le défaut/.test(r1) && /Apte avec réserves/.test(apercu2) && r2 === 'ferme' && /Apte avec réserves/.test(carte), obtenu: `${apercu1.slice(0, 70)} | ${r1.slice(0, 70)} | ${r2} | ${carte.slice(0, 80)}`, preuve: await capture(p, `apte-reserves-${largeur}`) };
    });
    await etape(`E2E-05-${largeur}`, 'Défaut de sécurité non critique : inapte, contre-visite proposée, circulation bloquée', 'Klaxon en défaut sur une autre moto', 'Inapte ; exigences : contre-visite + défaut à corriger', async () => {
      await p.goto(BASE + '/moto/index.html#/moto/' + mB + '/synthese'); await p.waitForSelector('.mm-aptitude', { timeout: 15000 });
      await p.locator('.mm-aptitude [data-action="aptitude"]').first().click(); await dlg(p).waitFor();
      await dlg(p).locator('[name="intervenant_nom"]').fill('MECANICIEN QUALIFIE FICTIF');
      const L = await dlg(p).locator('.mm-item-guide').count();
      for (let i = 0; i < L; i++) { const lib = await dlg(p).locator('.mm-item-guide').nth(i).locator('span').first().textContent(); await dlg(p).locator(`input[name="apt${i}"][value="${/Klaxon/i.test(lib) ? 'ko' : 'ok'}"]`).check(); }
      const apercu = (await dlg(p).locator('[data-apercu-resultat]').textContent()).replace(/\s+/g, ' ');
      const r = await soumettre(p); await p.waitForSelector('.mm-aptitude', { timeout: 15000 }); await p.waitForTimeout(300);
      const ex = (await p.locator('.mm-exigences').textContent()).replace(/\s+/g, ' '), cv = await p.locator('.mm-exigences [data-action="controle_remise"]').count();
      const bandeau = await p.locator('.mm-aptitude .mm-bandeau.mm-ko').count();
      return { ok: /Inapte/.test(apercu) && r === 'ferme' && /contre-visite/i.test(ex) && /Corriger puis faire vérifier/.test(ex) && cv >= 1 && bandeau === 1 && (await debordement(p)) <= 0,
               obtenu: `${apercu.slice(0, 60)} | ${r} | contre-visite=${cv} bandeau=${bandeau} | ${ex.slice(0, 110)}`, preuve: await capture(p, `inapte-exigences-${largeur}`) };
    });
    await ctx.close();
  }

  // ---------------------------------------------------------------- 2. Mesure avant / après
  // Parcours identique joué avec l'écran de production (main) puis le nouvel écran :
  // moto en exploitation, état de référence complet (13 points conformes, compteur, 5 photos).
  async function premiereEvaluation(ancien) {
    const m = await motoPrete('SAKASSOU', 'EN_EXPLOITATION'); const ctx = await contexte('abm', 'mobile', ancien);
    const p = await ouvrir(ctx, '/moto/index.html#/moto/' + m + '/synthese'); const k = compteur(); k.ecran();
    const bouton = ancien ? p.locator('[data-action="inspection"]').first() : p.locator('.mm-aptitude [data-action="aptitude"]').first();
    await k.clic(bouton); await dlg(p).waitFor(); k.ecran();
    const d = dlg(p);
    await k.saisir(d.locator('[name="intervenant_nom"]'), 'MECANICIEN QUALIFIE FICTIF');
    if (ancien) await k.saisir(d.locator('[name="garage_nom"]'), 'GARAGE FICTIF');   // obligatoire dans l'écran actuel
    await k.saisir(d.locator('[name="compteur_km"]'), 18450);
    for (const r of await d.locator('input[type=radio][value=ok]').all()) await k.cocher(r);
    for (const c of ['COMPTEUR', 'AVANT', 'ARRIERE', 'GAUCHE', 'DROITE']) await k.fichier(d.locator(`[name="ph_${c}"]`), JPG(c));
    if (ancien) { k.c.actions++; await d.locator('select[name="resultat"]').selectOption('APTE'); }   // conclusion manuelle
    k.c.actions++; const r = await soumettre(p);
    const st = (await q('select statut_technique from public.moto_motos where id=$1', [m]))[0].statut_technique;
    await ctx.close(); return { ...k.c, resultat: r, statut: st };
  }
  const avant = await premiereEvaluation(true), apres = await premiereEvaluation(false);
  MESURES.premiere_evaluation = { avant, apres };
  await etape('MES-01', 'Mesure réelle : première évaluation (moto en exploitation)', 'Même parcours, écran actuel puis nouvel écran', 'les deux aboutissent à APTE ; actions comptées', async () => ({
    ok: avant.statut === 'APTE' && apres.statut === 'APTE', obtenu: `avant : ${avant.ecrans} écrans, ${avant.actions} actions (${avant.statut}) · après : ${apres.ecrans} écrans, ${apres.actions} actions (${apres.statut})` }));

  // Après réparation d'un défaut : l'écran actuel exige une NOUVELLE inspection initiale complète
  // après la contre-visite ; le nouvel écran s'arrête à la contre-visite.
  const mC = await motoPrete('SAKASSOU');
  const items = (await q("select json_agg(json_build_object('code', code, 'ok', code <> 'KLAXON') order by ordre) j from public.moto_catalogue_points where type_controle='INSPECTION_INITIALE' and actif"))[0].j;
  await rpcEnTantQue('abm', 'moto_inspection_initiale', { p: JSON.stringify({ moto_id: mC, items, intervenant_nom: 'MECANICIEN QUALIFIE FICTIF', compteur_km: 5 }) });
  const ctxC = await contexte('lc', 'mobile'); const pC = await ouvrir(ctxC, '/moto/index.html#/moto/' + mC + '/synthese');
  await etape('MES-02', 'Contre-visite suffit après réparation (fin de la double inspection)', 'Contre-visite APTE depuis la liste « Ce qu\'il reste à faire »', 'moto Apte sans nouvelle inspection initiale', async () => {
    const k = compteur(); k.ecran();
    await k.clic(pC.locator('.mm-exigences [data-action="controle_remise"]').first()); await dlg(pC).waitFor(); k.ecran();
    await k.saisir(dlg(pC).locator('[name="intervenant_nom"]'), 'MECANICIEN QUALIFIE FICTIF');
    for (const r of await dlg(pC).locator('input[type=radio][value=ok]').all()) await k.cocher(r);
    k.c.actions++; const r = await soumettre(pC);
    const st = (await q('select statut_technique, (select count(*) from public.moto_controles where moto_id=$1 and type_controle=\'INSPECTION_INITIALE\')::int n, (select statut from public.moto_actions_correctives where moto_id=$1 and point_code=\'KLAXON\') a from public.moto_motos where id=$1', [mC]))[0];
    MESURES.apres_reparation = { nouvel_ecran: k.c, inspection_supplementaire_evitee: avant };
    return { ok: r === 'ferme' && st.statut_technique === 'APTE' && st.n === 1 && st.a === 'CLOTUREE', obtenu: `${r} · statut=${st.statut_technique} · inspections initiales=${st.n} · action klaxon=${st.a} · contre-visite : ${k.c.ecrans} écrans, ${k.c.actions} actions`, preuve: await capture(pC, 'contre-visite-apte-mobile') };
  });
  await ctxC.close();

  // Circuit manuel de clôture d'un défaut (planifier, déclarer réalisé, vérifier par un tiers) :
  // c'est ce que la contre-visite rend désormais inutile pour un défaut non critique.
  const mD = await motoPrete('SAKASSOU');
  await rpcEnTantQue('abm', 'moto_inspection_initiale', { p: JSON.stringify({ moto_id: mD, items, intervenant_nom: 'MECANICIEN QUALIFIE FICTIF', compteur_km: 5 }) });
  await etape('MES-03', 'Mesure : circuit manuel de clôture évité', 'Planifier, déclarer réalisé (coordinateur) puis vérifier (ABM)', 'action clôturée ; écrans et actions comptés', async () => {
    const k = compteur();
    const ctxL = await contexte('lc', 'mobile'); const pL = await ouvrir(ctxL, '/moto/index.html#/moto/' + mD + '/anomalies'); k.ecran();
    await k.clic(pL.locator('[data-action="action_planifier"]').first()); await dlg(pL).waitFor(); k.ecran();
    await k.saisir(dlg(pL).locator('[name="action_prevue"]'), 'Remplacement du klaxon (fictif)');
    await k.saisir(dlg(pL).locator('[name="date_cible"]'), new Date().toISOString().slice(0, 10));
    k.c.actions++; const r1 = await soumettre(pL); await pL.waitForSelector('[data-action="action_realiser"]', { timeout: 15000 });
    await k.clic(pL.locator('[data-action="action_realiser"]').first()); await dlg(pL).waitFor(); k.ecran();
    k.c.actions++; const r2 = await soumettre(pL); await ctxL.close();
    const ctxV = await contexte('abm', 'mobile'); const pV = await ouvrir(ctxV, '/moto/index.html#/moto/' + mD + '/anomalies'); k.ecran();
    await k.clic(pV.locator('[data-action="action_verifier"]').first()); await dlg(pV).waitFor(); k.ecran();
    await dlg(pV).locator('[name="decision"]').selectOption('VALIDEE'); k.c.actions++;
    await k.saisir(dlg(pV).locator('[name="note"]'), 'Klaxon contrôlé sur place (fictif)');
    k.c.actions++; const r3 = await soumettre(pV); await ctxV.close();
    const a = (await q("select statut from public.moto_actions_correctives where moto_id=$1 and point_code='KLAXON'", [mD]))[0].statut;
    MESURES.cloture_manuelle_evitee = k.c;
    return { ok: [r1, r2, r3].every(x => x === 'ferme') && a === 'CLOTUREE', obtenu: `${r1}/${r2}/${r3} · action=${a} · ${k.c.ecrans} écrans, ${k.c.actions} actions, 2 personnes` };
  });
} finally {
  writeFileSync(join(SORTIE, 'aptitude_10_e2e.json'), JSON.stringify({ base: DB, date: new Date().toISOString(), reussis: RESULTATS.filter(r => r.resultat === 'RÉUSSI').length, total: RESULTATS.length, mesures: MESURES, erreurs_console: ERREURS, resultats: RESULTATS }, null, 1));
  await navigateur.close(); serveur.close(); await emu.pool.end();
}
const ok = RESULTATS.filter(r => r.resultat === 'RÉUSSI').length;
console.log(`\nBilan navigateur : ${ok}/${RESULTATS.length} réussis · erreurs console : ${ERREURS.length}`);
if (ERREURS.length) console.log(ERREURS.slice(0, 10).join('\n'));
console.log('Mesures : ' + JSON.stringify(MESURES));
process.exit(ok === RESULTATS.length ? 0 : 1);
