#!/usr/bin/env node
/**
 * ANAGROCI FIELD BUYING (APK) — simulation fidèle de l'environnement Android
 * dans Chromium réel (Playwright), sur le PAQUET EMBARQUÉ produit pour l'APK.
 *
 * Ce que reproduit la simulation (mêmes règles qu'AssetServer.java, testées à
 * part par android/tests/jvm/run.sh) :
 *  - origine https://appassets.androidplatform.net servie depuis assets/www,
 *    pont natif injecté en tête de chaque page HTML ;
 *  - bibliothèques CDN servies depuis _vendor (table vendor_map du manifeste),
 *    TOUTE autre requête externe bloquée et journalisée ;
 *  - window.AnagrociNative simulé (shellStatus calculé sur les vrais fichiers,
 *    saveFile / print journalisés) ;
 *  - écrans Android 360×640 et 412×915, tactile, agent utilisateur WebView.
 *
 * Ce qu'elle NE prouve PAS (déclaré dans le rapport) : installation, icône,
 * permissions, appareil photo, retour matériel, mise à jour APK — tests sur
 * téléphone requis.
 *
 * Partie A : vrai supabase-js embarqué + serveur Supabase SIMULÉ (HTTP) → authentification.
 * Partie B : client Supabase synthétique des tests existants → parcours terrain hors ligne.
 * Aucune donnée réelle, aucun appel à la production.
 *
 *   node android/tests/apk-webview-sim.mjs   (depuis la racine, après prepare-web.mjs)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ANDROID = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ANDROID, '..');
const WWW = join(ANDROID, 'app', 'src', 'main', 'assets', 'www');
const ORIGIN = 'https://appassets.androidplatform.net';
const START = ORIGIN + '/operations/field-buying.html';
const SUPA = 'https://jmbdgpdthzpszfnddwzi.supabase.co';
const OUTDIR = join(ANDROID, 'build', 'test-reports');
if (!existsSync(join(WWW, '_native', 'bundle-manifest.json'))) { console.error('Lancez d’abord android/scripts/prepare-web.mjs'); process.exit(2); }
const MANIFEST = JSON.parse(readFileSync(join(WWW, '_native', 'bundle-manifest.json'), 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const DEVICES = {
  'Android 360×640': { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 },
  'Android 412×915': { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625 },
};
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 ANAGROCI-FieldBuying/1.0.0';

const results = [];
function record(id, device, procedure, expected, observed, ok, extra) {
  const status = ok === null ? 'NON TESTABLE ICI' : ok ? 'PASS' : 'FAIL';
  results.push({ id, device, procedure, expected, observed: String(observed), status, ...(extra || {}) });
  console.log(`${status.padEnd(16)} ${id} [${device}] ${procedure} → ${observed}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------- Équivalent JS d'AssetServer.java -------- */
function vendorKey(u) {
  if (u.host === 'fonts.googleapis.com') return 'https://fonts.googleapis.com/css';
  if (['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'].includes(u.host)) return 'https://' + u.host + u.pathname;
  return null;
}
function serveLocal(route, rel, inject) {
  const file = normalize(join(WWW, decodeURIComponent(rel)));
  if (!file.startsWith(WWW) || !existsSync(file)) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'absent : ' + rel });
  const mime = MIME[extname(file)] || 'application/octet-stream';
  let body = readFileSync(file);
  if (inject && mime === 'text/html') {
    const s = body.toString('utf8'); const m = /<head[^>]*>/i.exec(s); const tag = '<script src="/_native/bridge.js"></script>';
    body = m ? s.slice(0, m.index + m[0].length) + tag + s.slice(m.index + m[0].length) : tag + s;
  }
  return route.fulfill({ status: 200, contentType: mime, body, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-cache' } });
}
function nativeStub() {
  const missing = MANIFEST.critical.filter((f) => !existsSync(join(WWW, f)));
  const status = JSON.stringify({ bundled: missing.length === 0, missing, version: '1.1.0 (2)', web_commit: MANIFEST.git_commit, files: MANIFEST.file_count });
  /* Méthodes de mise à jour : même contrat JSON que NativeBridge.java / WebBundleUpdater.status().
     L'état est piloté par le test (window.__native.update) ; les appels sont journalisés. */
  return `(function(){ var saved=[], printed=0, calls={confirmBoot:0,reportQueue:[],checkUpdate:0,applyUpdate:0};
    var update={enabled:false,last_result:'désactivée : aucune URL de publication fournie au build',active:"intégrée à l'APK",active_sequence:${MANIFEST.sequence || 0},active_commit:${JSON.stringify(MANIFEST.git_commit)},overlay_files:0,pending_sequence:0,deferred_reason:'',rejected:{}};
    window.__native={saved:saved,printed:function(){return printed;},calls:calls,setUpdate:function(u){update=Object.assign({},update,u);}};
    window.AnagrociNative={
      shellStatus:function(){return ${JSON.stringify(status)};},
      appInfo:function(){return JSON.stringify({app:'ANAGROCI FIELD BUYING',version:'1.1.0 (2)',android_sdk:33,android_release:'13',package:'ci.anagroci.fieldbuying.debug',signer_sha256:'AA:BB:CC (clé de test simulée)',web_commit:${JSON.stringify(MANIFEST.git_commit)},queue_schema:${JSON.stringify(MANIFEST.queue_schema || '')},updates:update});},
      updateStatus:function(){return JSON.stringify(update);},
      checkUpdate:function(){calls.checkUpdate++;return '{"started":true}';},
      applyUpdate:function(){calls.applyUpdate++;},
      confirmBoot:function(){calls.confirmBoot++;},
      reportQueue:function(n){calls.reportQueue.push(n);},
      saveFile:function(n,m,b){saved.push({name:n,mime:m,bytes:Math.floor(String(b).length*3/4)});try{sessionStorage.setItem('__native_saved',JSON.stringify(saved));}catch(e){}return '{"ok":true}';},
      print:function(){printed++;}
    };})();`;
}
async function apkContext(browser, device, opts) {
  const ctx = await browser.newContext({ ...DEVICES[device], isMobile: true, hasTouch: true, userAgent: UA, locale: 'fr-FR',
    permissions: ['geolocation'], geolocation: { latitude: 7.69, longitude: -5.03 }, serviceWorkers: 'allow' });
  ctx.__external = []; ctx.__offline = false;
  /* Le routage Playwright ignore le mode avion : on coupe aussi « Supabase » à la main,
     comme le ferait la perte réelle du réseau sur le téléphone. */
  const setOffline = ctx.setOffline.bind(ctx);
  ctx.setOffline = async (v) => { ctx.__offline = !!v; return setOffline(v); };
  await ctx.addInitScript({ content: nativeStub() });
  if (opts.stub) await ctx.addInitScript({ content: opts.stub });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === ORIGIN) {
      if (opts.delayAccess && /aflp-access\.js$/.test(u.pathname)) await wait(opts.delayAccess);
      return serveLocal(route, u.pathname.replace(/^\//, '') || 'index.html', true);
    }
    const k = vendorKey(u);
    if (k && MANIFEST.vendor_map[k]) return serveLocal(route, MANIFEST.vendor_map[k], false);
    if (u.origin === SUPA && opts.supabase) return ctx.__offline ? route.abort('internetdisconnected') : opts.supabase(route, u);
    ctx.__external.push(u.host + u.pathname);
    return route.abort('internetdisconnected');
  });
  return ctx;
}
function errorsOf(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(m.text()); });
  return errs;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* -------- Serveur Supabase simulé (Partie A) -------- */
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(uid, email) { const now = Math.floor(Date.now() / 1000); return b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: uid, email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now }) + '.signature-fictive'; }
const ACCOUNTS = {
  'unit.head@example.invalid': { id: 'a1111111-0000-4000-8000-000000000001', pass: 'Correct-123', profile: { nom: 'UNIT HEAD FICTIF', role: 'Unit Head', actif: true, zone: 'GBEKE 1', cluster: 'BROBO' } },
  'desactive@example.invalid': { id: 'a2222222-0000-4000-8000-000000000002', pass: 'Correct-123', profile: { nom: 'COMPTE DESACTIVE', role: 'Unit Head', actif: false } },
  'sansprofil@example.invalid': { id: 'a3333333-0000-4000-8000-000000000003', pass: 'Correct-123', profile: null },
  'banni@example.invalid': { id: 'a4444444-0000-4000-8000-000000000004', pass: 'Correct-123', banned: true },
};
function supabaseMock(route, u) {
  const req = route.request(), json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
    const b = JSON.parse(req.postData() || '{}'); const acc = ACCOUNTS[b.email];
    if (acc && acc.banned) return json(400, { code: 400, error_code: 'user_banned', msg: 'User is banned' });
    if (!acc || acc.pass !== b.password) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    const now = Math.floor(Date.now() / 1000);
    return json(200, { access_token: jwt(acc.id, b.email), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'refresh-fictif',
      user: { id: acc.id, aud: 'authenticated', role: 'authenticated', email: b.email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
  }
  if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (u.pathname === '/auth/v1/user') return json(200, {});
  if (u.pathname === '/rest/v1/profils') {
    const uid = (u.searchParams.get('user_id') || '').replace('eq.', '');
    const acc = Object.values(ACCOUNTS).find((a) => a.id === uid);
    if (!acc || !acc.profile) return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' });
    return json(200, { user_id: uid, email: Object.keys(ACCOUNTS).find((k) => ACCOUNTS[k] === acc), ...acc.profile });
  }
  if (u.pathname.startsWith('/rest/v1/rpc/')) return json(200, null);
  if (u.pathname.startsWith('/rest/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: { 'content-range': '0-0/0', 'access-control-allow-origin': '*' } });
  return json(404, {});
}
async function login(page, email, pass) {
  await page.waitForSelector('#ag-form', { timeout: 20000 });
  await page.fill('#ag-email', email); await page.fill('#ag-pass', pass);
  await page.click('#ag-btn');
}
const gateText = (page) => page.evaluate(() => (document.getElementById('anagroci-authgate') || {}).textContent || '');

async function partA(browser, device) {
  const ctx = await apkContext(browser, device, { supabase: supabaseMock });
  let page = await ctx.newPage(); const errs = errorsOf(page);
  const t0 = Date.now();
  await page.goto(START, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ag-form', { timeout: 20000 });
  const types = await page.evaluate(() => [document.getElementById('ag-email').type, document.getElementById('ag-pass').type, document.getElementById('ag-email').autocomplete]);
  record('T02', device, 'Ouverture de l’application sans réseau externe (CDN bloqués)', 'Page chargée depuis l’APK', `formulaire en ${Date.now() - t0} ms, requêtes externes bloquées : ${ctx.__external.length}`, ctx.__external.length === 0);
  record('T03', device, 'Affichage de l’écran de connexion', 'Email (clavier email) + mot de passe', `types=${types.join('/')}, débordement=${await overflow(page)}px`, types[0] === 'email' && types[1] === 'password' && (await overflow(page)) <= 0);
  const sw = await page.evaluate(async () => { try { await navigator.serviceWorker.register('/sw.js'); return 'enregistré'; } catch (e) { return 'refusé : ' + e.message; } });
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  record('T31', device, 'Service Worker désactivé dans l’APK (pas de cache périmé après mise à jour)', 'register() refusé, 0 enregistrement', `${sw} · enregistrements=${regs}`, /^refusé/.test(sw) && regs === 0);

  await login(page, 'unit.head@example.invalid', 'mauvais-mot-de-passe');
  await page.waitForFunction(() => /incorrect/.test((document.getElementById('anagroci-authgate') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  let g = await gateText(page);
  record('T05', device, 'Mot de passe incorrect', '« Email ou mot de passe incorrect. »', g.match(/Email ou mot de passe incorrect\./) ? 'message affiché' : g.slice(0, 120), /Email ou mot de passe incorrect\./.test(g));
  await login(page, 'inconnu@example.invalid', 'x');
  await wait(800); g = await gateText(page);
  record('T05b', device, 'Compte inexistant', 'Même message que le mot de passe incorrect (anti-énumération)', /incorrect/.test(g) ? 'message identique' : g.slice(0, 120), /Email ou mot de passe incorrect\./.test(g));
  await login(page, 'banni@example.invalid', 'Correct-123');
  await page.waitForFunction(() => /désactivé/.test((document.getElementById('anagroci-authgate') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  g = await gateText(page);
  record('T06', device, 'Compte désactivé dans l’authentification (banni)', '« Compte désactivé »', /Compte désactivé/.test(g) ? 'message affiché' : g.slice(0, 120), /Compte désactivé/.test(g));

  await ctx.setOffline(true);
  await login(page, 'unit.head@example.invalid', 'Correct-123');
  await page.waitForFunction(() => /Internet/.test((document.getElementById('anagroci-authgate') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  g = await gateText(page);
  record('T20b', device, 'Réseau coupé au moment de se connecter', 'Message réseau (pas « mot de passe incorrect »)', /Pas de connexion Internet/.test(g) ? 'message réseau affiché' : g.slice(0, 120), /Pas de connexion Internet/.test(g));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#ag-form');
  g = await gateText(page);
  record('T32', device, 'Première connexion sans Internet (aucune session)', 'Message : connexion Internet nécessaire', /Hors ligne/.test(g) ? 'message affiché' : g.slice(0, 120), /Hors ligne : une connexion Internet est nécessaire/.test(g));
  await ctx.setOffline(false);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await login(page, 'unit.head@example.invalid', 'Correct-123');
  await page.waitForFunction(() => window.ANAGROCI_AUTH && !document.getElementById('anagroci-authgate'), null, { timeout: 20000 }).catch(() => {});
  const auth = await page.evaluate(() => window.ANAGROCI_AUTH ? { role: window.ANAGROCI_AUTH.profile.role, niveau: window.ANAGROCI_AUTH.niveau, estBM: window.ANAGROCI_AUTH.estBM } : null);
  record('T04', device, 'Connexion compte de test valide (Unit Head, serveur simulé)', 'Accès accordé, niveau chef, pas BM', JSON.stringify(auth), !!auth && auth.role === 'Unit Head' && auth.niveau === 'chef' && auth.estBM === false);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ANAGROCI_AUTH, null, { timeout: 20000 }).catch(() => {});
  const kept = await page.evaluate(() => !!window.ANAGROCI_AUTH && !document.getElementById('ag-form'));
  record('T08', device, 'Maintien de la session après rechargement', 'Pas de nouvelle saisie du mot de passe', kept ? 'session conservée' : 'login redemandé', kept);

  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ANAGROCI_AUTH, null, { timeout: 20000 }).catch(() => {});
  const offOpen = await page.evaluate(() => !!window.ANAGROCI_AUTH);
  record('T22a', device, 'Réouverture hors ligne avec session et profil en cache', 'Application accessible', offOpen ? 'accès accordé depuis le cache' : 'bloqué', offOpen);
  await ctx.setOffline(false);

  await page.goto(ORIGIN + '/shared/admin.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Accès non autorisé/.test((document.getElementById('anagroci-authgate') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  g = await gateText(page);
  record('T07', device, 'Unit Head ouvre l’administration (réservée BM)', '« Accès non autorisé »', /Accès non autorisé/.test(g) ? 'refusé' : 'NON REFUSÉ', /Accès non autorisé/.test(g));

  /* Session expirée : jeton supprimé, profil en cache encore présent */
  await page.goto(START, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k)); });
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#ag-form');
  g = await gateText(page);
  record('T33', device, 'Session expirée', 'Message « Session expirée… opérations conservées »', /Session expirée/.test(g) ? 'message affiché' : g.slice(0, 120), /Session expirée/.test(g));

  await login(page, 'desactive@example.invalid', 'Correct-123');
  await page.waitForFunction(() => /désactivé/.test((document.getElementById('anagroci-authgate') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  g = await gateText(page);
  record('T06b', device, 'Profil désactivé dans FBMS (actif = false)', '« Compte désactivé »', /Compte désactivé/.test(g) ? 'message affiché' : g.slice(0, 120), /Compte désactivé/.test(g));
  await login(page, 'sansprofil@example.invalid', 'Correct-123');
  await page.waitForFunction(() => /Profil introuvable/.test((document.getElementById('anagroci-authgate') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  g = await gateText(page);
  record('T34', device, 'Compte sans profil configuré', '« Profil introuvable »', /Profil introuvable/.test(g) ? 'message affiché' : g.slice(0, 120), /Profil introuvable/.test(g));
  /* Course de chargement : aflp-access.js volontairement retardé de 2,5 s */
  const ctx2 = await apkContext(browser, device, { supabase: supabaseMock, delayAccess: 2500 });
  const p2 = await ctx2.newPage();
  await p2.goto(START, { waitUntil: 'domcontentloaded' });
  await login(p2, 'unit.head@example.invalid', 'Correct-123');
  await p2.waitForFunction(() => window.ANAGROCI_AUTH, null, { timeout: 20000 }).catch(() => {});
  const lvl = await p2.evaluate(() => window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.niveau);
  record('T41', device, 'Rôle résolu même si le fichier des rôles arrive en retard (2,5 s)', 'Unit Head = niveau chef', `niveau=${lvl}`, lvl === 'chef');
  await ctx2.close();
  const authErrs = errs.filter((e) => !/aflp-ia|Cannot read properties of null/.test(e));
  record('T35', device, 'Erreurs JavaScript pendant les parcours d’authentification', 'Aucune', authErrs.length ? authErrs.slice(0, 3).join(' | ') : 'aucune', authErrs.length === 0);
  await ctx.close();
}

/* -------- Partie B : parcours terrain (client synthétique des tests existants) -------- */
function stubFromExistingTest() {
  const src = readFileSync(join(REPO, 'tests', 'offline-field-e2e.mjs'), 'utf8');
  const m = /const STUB=String\.raw`([\s\S]*?)`;/.exec(src);
  if (!m) throw new Error('STUB introuvable dans tests/offline-field-e2e.mjs');
  return m[1];
}
async function partB(browser, device) {
  const ctx = await apkContext(browser, device, { stub: stubFromExistingTest() });
  let page = await ctx.newPage(); let errs = errorsOf(page);
  await page.goto(START + '#sync', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#offPrepare', { timeout: 25000 });
  await page.click('#offPrepare');
  const ready = await page.waitForFunction(() => document.body.textContent.includes('Prêt pour le terrain'), null, { timeout: 25000 }).then(() => true).catch(() => false);
  const shell = await page.evaluate(() => ANAGROCI_OFFLINE.prepareShell());
  record('T36', device, 'Préparer le mode terrain (shell embarqué, sans Service Worker)', '« Prêt pour le terrain », native_bundle=true', `${ready ? 'prêt' : 'non prêt'} · ${JSON.stringify({ native_bundle: shell.native_bundle, missing: shell.missing })}`, ready && shell.native_bundle === true);

  const routes = ['overview', 'purchases', 'census', 'farmers', 'cooperatives', 'rt', 'bags', 'cash', 'sync'];
  const nav = [];
  for (const r of routes) {
    await page.evaluate((h) => { location.hash = '#' + h; }, r); await wait(700);
    nav.push(`${r}:${await overflow(page)}`);
  }
  const worst = Math.max(...nav.map((x) => Number(x.split(':')[1])));
  record('T17', device, 'Navigation entre les 9 rubriques FIELD BUYING', 'Chaque rubrique s’affiche', nav.map((x) => x.split(':')[0]).join(', '), errs.length === 0, { errors: errs.slice(0, 3) });
  record('T18', device, 'Petit écran : débordement horizontal de la page', '≤ 0 px sur chaque rubrique', `max ${worst}px (${nav.filter((x) => Number(x.split(':')[1]) > 0).join(' ') || 'aucun'})`, worst <= 0);
  await page.evaluate(() => { location.hash = '#farmers'; }); await wait(600);
  record('T09', device, 'Ouverture du module Producteurs', 'Liste/fiche affichée', (await page.textContent('#opsRouteView')).includes('PRODUCTEUR EXISTANT') ? 'producteur synthétique listé' : 'non listé', (await page.textContent('#opsRouteView')).includes('PRODUCTEUR EXISTANT'));

  /* Recherche producteur */
  await page.fill('#pfQ', 'EXISTANT'); await page.press('#pfQ', 'Enter').catch(() => {}); await wait(800);
  const hit = (await page.textContent('#opsRouteView')).includes('PRODUCTEUR EXISTANT');
  await page.fill('#pfQ', 'ZZZ-INTROUVABLE'); await page.press('#pfQ', 'Enter').catch(() => {}); await wait(800);
  const miss = !(await page.textContent('#opsRouteView')).includes('PRODUCTEUR EXISTANT');
  record('T11', device, 'Recherche d’un producteur', 'Trouvé avec « EXISTANT », absent avec un terme inconnu', `trouvé=${hit} · filtré=${miss}`, hit && miss);
  await page.fill('#pfQ', ''); await page.press('#pfQ', 'Enter').catch(() => {});
  await page.evaluate(() => { location.hash = '#rt'; }); await wait(700);
  const vil = (await page.textContent('#opsRouteView')).includes('VILLAGE FICTIF OFFLINE');
  record('T10', device, 'Consultation des villages (RT & Villages)', 'Village synthétique affiché', vil ? 'affiché' : 'absent', vil);
  await page.evaluate(() => { location.hash = '#census'; }); await wait(600);
  await page.evaluate(() => ANAGROCI_FB.openVillageForm());
  const vf = await page.waitForSelector('#villageForm', { timeout: 15000 }).then(() => page.evaluate(() => ({ sections: document.querySelectorAll('#villageForm details.ops-sec').length, requis: document.querySelectorAll('#villageForm [required]').length }))).catch((e) => ({ err: e.message.slice(0, 80) }));
  record('T13', device, 'Formulaire de recensement village (création)', 'Fiche à sections s1…s9 avec champs obligatoires', JSON.stringify(vf), vf.sections >= 9 && vf.requis > 0);
  await page.evaluate(() => ANAGROCI_FB.openVillageForm('v1'));
  const pre = await page.waitForSelector('#villageForm', { timeout: 15000 }).then(() => page.evaluate(() => [...document.querySelectorAll('#villageForm input')].some((i) => i.value === 'VILLAGE FICTIF OFFLINE'))).catch(() => false);
  record('T14', device, 'Modification d’une fiche existante (préremplie)', 'Valeurs actuelles chargées dans le formulaire', pre ? 'nom du village prérempli' : 'non prérempli', pre);

  await ctx.setOffline(true);
  await page.close(); page = await ctx.newPage(); errs = errorsOf(page);
  await page.goto(START + '#sync', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#offPrepare', { timeout: 20000 });
  const offBody = await page.textContent('body');
  record('T21a', device, 'Fermeture + réouverture complète sans réseau', 'Application utilisable, état « Hors ligne » visible', /Hors ligne/.test(offBody) ? 'utilisable, indicateur Hors ligne affiché' : 'indicateur absent', /Hors ligne/.test(offBody));

  /* Les formulaires s'ouvrent depuis leur rubrique (comme sur le terrain) : la rubrique
     Synchronisation se redessine à chaque changement d'état réseau. */
  await page.evaluate(() => { location.hash = '#farmers'; }); await wait(700);
  await page.evaluate(() => ANAGROCI_FB.openFarmerForm()); await page.waitForSelector('#farmerForm');
  const telMode = await page.getAttribute('#ff_tel', 'inputmode');
  await page.fill('#ff_nom', 'PRODUCTEUR APK FICTIF'); await page.selectOption('#ff_village', 'v1'); await page.selectOption('#ff_rt', 'rt1'); await page.fill('#ff_tel', '0700000888');
  await page.click('#ff_submit');
  const enrolled = await page.waitForFunction(() => document.body.textContent.includes('Farmer ID définitif attribué lors de la synchronisation.'), null, { timeout: 10000 }).then(() => true).catch(() => false);
  let ops = await page.evaluate(() => ANAGROCI_OFFLINE.list());
  const farmerOp = ops.find((x) => x.operation_type === 'FARMER_ENROLL');
  record('T21', device, 'Enrôlement producteur hors ligne', 'Opération PENDING avec identifiant et clé d’idempotence', farmerOp ? `${farmerOp.status} · id=${farmerOp.id.slice(0, 8)}… · clé=${farmerOp.idempotency_key.slice(0, 8)}…` : 'absente', enrolled && farmerOp && farmerOp.status === 'PENDING' && !!farmerOp.idempotency_key);
  record('T16b', device, 'Clavier téléphone pour le numéro', 'inputmode="tel"', `inputmode=${telMode}`, telMode === 'tel');

  await page.evaluate(() => { location.hash = '#purchases'; }); await wait(700);
  await page.evaluate(() => ANAGROCI_FB.openBuyForm()); await page.waitForSelector('#buyForm');
  await page.selectOption('#bf_village', 'v1'); await page.selectOption('#bf_rt', 'rt1');
  const localFarmer = await page.evaluate(async () => { const b = await ANAGROCI_OFFLINE.getBundle('field_base', { campaign_id: ANAGROCI_OFFLINE.campaignId() }); const f = (b.farmers || []).find((x) => x.local_only); return f && f.producteur_id; });
  await page.selectOption('#bf_farmer', localFarmer);
  const opts = await page.$$eval('#bf_farmer option', (o) => o.length);
  record('T16', device, 'Listes déroulantes (village, RT, producteur local)', 'Options sélectionnables', `${opts} options producteur, producteur local sélectionné`, opts >= 2);
  const brutType = await page.getAttribute('#bf_brut', 'type');
  await page.fill('#bf_brut', '100'); await page.fill('#bf_tare', '0'); await page.fill('#bf_sacs', '2'); await page.fill('#bf_ref', 'RECU-APK-FICTIF-001');
  await page.click('#bf_submit');
  const bought = await page.waitForFunction(() => document.body.textContent.includes('Achat sauvegardé sur cet appareil'), null, { timeout: 10000 }).then(() => true).catch(() => false);
  ops = await page.evaluate(() => ANAGROCI_OFFLINE.list());
  const buy = ops.find((x) => x.operation_type === 'FIELD_PURCHASE_CREATE');
  record('T21b', device, 'Achat hors ligne lié au producteur local', 'PENDING, dépend de l’enrôlement', buy ? `${buy.status} · dépend de l’enrôlement : ${buy.dependencies[0] === farmerOp.id} · message « Achat sauvegardé » vu : ${bought}` : 'absent', !!buy && buy.status === 'PENDING' && buy.dependencies.length === 1 && buy.dependencies[0] === farmerOp.id);
  record('T16c', device, 'Clavier numérique pour les poids', 'type="number"', `type=${brutType}`, brutType === 'number');

  const before = ops.map((x) => x.id).sort();
  await page.close(); page = await ctx.newPage(); errs = errorsOf(page);
  await page.goto(START + '#sync', { waitUntil: 'domcontentloaded', timeout: 20000 }); await page.waitForSelector('#offSync');
  const after = (await page.evaluate(() => ANAGROCI_OFFLINE.list())).map((x) => x.id).sort();
  record('T22', device, 'Fermeture et réouverture sans réseau : file conservée', 'Mêmes opérations', `${after.length}/${before.length} opérations`, JSON.stringify(after) === JSON.stringify(before));

  let failed = false; try { await page.evaluate(() => ANAGROCI_OFFLINE.syncNow()); } catch { failed = true; }
  const still = (await page.evaluate(() => ANAGROCI_OFFLINE.list())).filter((o) => o.status === 'PENDING').length;
  record('T27', device, 'Synchronisation tentée sans réseau', 'Échec explicite, aucune perte', `${failed ? 'échec explicite' : 'pas d’échec'} · ${still} PENDING conservées`, failed && still === before.length);
  await pendingScreen(page, device, still);

  page.once('dialog', async (d) => { page.__dialog = d.message(); await d.dismiss(); });
  const chip = await page.$('#ag-logout');
  if (chip) { await chip.click(); await wait(600); }
  record('T28', device, 'Déconnexion avec opérations en attente', 'Avertissement avant déconnexion, file conservée', page.__dialog ? page.__dialog.slice(0, 90) + '…' : (chip ? 'aucun avertissement' : 'bouton déconnexion absent'), !!page.__dialog && /pas encore synchronisée/.test(page.__dialog));

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.evaluate(() => ANAGROCI_OFFLINE.syncNow());
  let pair = false;
  for (let k = 0; k < 60 && !pair; k++) {
    pair = await page.evaluate(async () => { const x = await ANAGROCI_OFFLINE.list(); const p = x.filter((o) => ['FARMER_ENROLL', 'FIELD_PURCHASE_CREATE'].includes(o.operation_type)); return p.length === 2 && p.every((o) => o.status === 'SYNCED'); });
    if (!pair) await wait(150);
  }
  const ev = await page.evaluate(() => { const b = window.__offlineTestState.batches.flat(); const p = b.find((x) => x.operation_type === 'FIELD_PURCHASE_CREATE'); return { calls: window.__offlineTestState.syncCalls, sentFarmer: p && p.payload.row.producteur_id, keys: b.map((x) => x.idempotency_key) }; });
  record('T23', device, 'Retour d’Internet', 'Synchronisation déclenchée', `${ev.calls} appel(s) offline_sync_batch`, ev.calls >= 1);
  record('T24', device, 'Synchronisation : producteur puis achat', 'Les deux SYNCED, achat rattaché au Farmer serveur', `${pair ? 'SYNCED' : 'incomplet'} · farmer envoyé=${ev.sentFarmer}`, pair && ev.sentFarmer && !/^local-farmer-/.test(ev.sentFarmer));
  const callsBefore = ev.calls;
  await page.evaluate(() => ANAGROCI_OFFLINE.syncNow());
  const ev2 = await page.evaluate(() => ({ calls: window.__offlineTestState.syncCalls, keys: window.__offlineTestState.batches.flat().map((x) => x.idempotency_key) }));
  const dup = ev2.keys.length - new Set(ev2.keys).size;
  record('T25', device, 'Rejeu de la synchronisation (doublons)', 'Aucune opération SYNCED renvoyée', `${ev2.calls - callsBefore} nouvel appel, ${dup} clé envoyée deux fois`, dup === 0);

  /* Export : tout export du code (lien download sur blob:) part vers Téléchargements via le pont */
  await page.evaluate(() => { const b = new Blob(['col1;col2\nA;1\n'], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'export-test-apk.csv'; a.click(); });
  await wait(800);
  const saved = await page.evaluate(() => window.__native.saved);
  record('T37', device, 'Export de fichier (lien download blob:)', 'Fichier transmis au pont Android (Téléchargements/ANAGROCI)', saved.length ? `${saved[0].name} · ${saved[0].mime} · ${saved[0].bytes} o` : 'non transmis', saved.length === 1 && saved[0].name === 'export-test-apk.csv');
  await page.evaluate(() => window.print());
  record('T38', device, 'Impression', 'window.print() → impression Android', `${await page.evaluate(() => window.__native.printed())} demande(s)`, (await page.evaluate(() => window.__native.printed())) === 1);
  const gps = await page.evaluate(() => new Promise((r) => navigator.geolocation.getCurrentPosition((p) => r(`${p.coords.latitude.toFixed(2)},${p.coords.longitude.toFixed(2)}`), (e) => r('erreur ' + e.code), { timeout: 5000 })));
  record('T39', device, 'GPS (API navigateur, position simulée)', 'Position fournie à la page', gps, /^7\.69,-5\.03$/.test(gps));
  record('T40', device, 'Requêtes réseau externes non prévues', '0 (tout est local, Supabase simulé)', ctx.__external.length ? [...new Set(ctx.__external)].slice(0, 4).join(' ') : '0', ctx.__external.length === 0);
  await versionScreen(page, device);
  await ctx.close();
}

/* -------- Écran « Version et mises à jour » (bridge.js réel) -------- */
async function openAbout(page) {
  await page.click('#anx-version');
  await page.waitForSelector('.anx-dlg[role="dialog"]', { timeout: 5000 });
  return page.$eval('.anx-dlg', (d) => d.textContent);
}
async function pendingScreen(page, device, still) {
  const boot = await page.evaluate(() => window.__native.calls.confirmBoot);
  record('V01', device, 'Démarrage de la version Web confirmé à l’application', 'confirmBoot() appelé ≥ 1 fois', `${boot} appel(s)`, boot >= 1);
  await page.evaluate(() => ANAGROCI_OFFLINE.emit()); await wait(300);
  const rq = await page.evaluate(() => window.__native.calls.reportQueue.slice(-1)[0]);
  record('V02', device, 'Nombre d’opérations locales transmis à l’application (hors ligne)', `${still} (opérations PENDING)`, `dernier envoi : ${rq}`, rq === still);
  const box = await page.$eval('#anx-version', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, label: b.getAttribute('aria-label'), text: b.textContent }; });
  record('V03', device, 'Bouton Version visible, cible tactile ≥ 44 px, libellé accessible', '≥ 44×44, aria-label', `${Math.round(box.w)}×${Math.round(box.h)} · « ${box.text} » · ${box.label}`, box.w >= 44 && box.h >= 44 && !!box.label && box.text.includes('· ' + still));
  const txt = await openAbout(page);
  const v04 = /1\.1\.0 \(2\)/.test(txt) && /Signature/.test(txt) && txt.includes(String(MANIFEST.git_commit).slice(0, 12)) && /Opérations en attente/.test(txt) && /Format des files locales/.test(txt);
  record('V04', device, 'Écran Version : application, signature, version Web, files locales', 'Version 1.1.0, empreinte, commit, compteurs', v04 ? 'tout affiché' : txt.slice(0, 160), v04);
  record('V05', device, 'Opérations non synchronisées : avertissement « Ne désinstallez pas »', 'Avertissement affiché', /Ne désinstallez pas/.test(txt) ? 'affiché' : 'absent', /Ne désinstallez pas/.test(txt) && txt.includes(still + ' opération(s)'));
  record('V06', device, 'Mises à jour désactivées dans cet APK : message explicite', '« désactivées »', /Mises à jour Web désactivées/.test(txt) ? 'message affiché' : 'absent', /Mises à jour Web désactivées/.test(txt));
  const syncDisabled = await page.$eval('[data-anx="sync"]', (b) => b.disabled);
  record('V07', device, 'Hors ligne : bouton « Synchroniser » désactivé', 'désactivé', syncDisabled ? 'désactivé' : 'actif', syncDisabled === true);
  await page.screenshot({ path: join(OUTDIR, `version-hors-ligne-${device.replace(/[^0-9a-z]+/gi, '_')}.png`) });
  await page.keyboard.press('Escape'); await wait(150);
  const closed = await page.evaluate(() => !document.querySelector('.anx-ov') && document.activeElement && document.activeElement.id === 'anx-version');
  record('V08', device, 'Échap ferme l’écran et rend le focus au bouton', 'fermé, focus sur le bouton', closed ? 'ok' : 'non', closed);
}
async function versionScreen(page, device) {
  const rq = await page.evaluate(() => window.__native.calls.reportQueue.slice(-1)[0]);
  record('V09', device, 'Après synchronisation : 0 opération transmise à l’application', '0', `dernier envoi : ${rq}`, rq === 0);
  await page.evaluate(() => window.__native.setUpdate({ enabled: true, source: 'https://pages.example.test/fbms/', channel: 'stable', last_check_at: '2026-10-16T12:00:00Z', last_result: 'version 1792300000 vérifiée : appliquée au prochain démarrage', pending_sequence: 1792300000 }));
  let txt = await openAbout(page);
  const apply = await page.$('[data-anx="apply"]');
  record('V10', device, 'Version téléchargée et vérifiée : bouton « Redémarrer pour appliquer »', 'bouton présent, source affichée', `${apply ? 'bouton présent' : 'absent'} · ${/pages\.example\.test/.test(txt) ? 'source affichée' : 'source absente'}`, !!apply && /pages\.example\.test/.test(txt));
  await page.click('[data-anx="apply"]'); await page.click('[data-anx="check"]');
  const c = await page.evaluate(() => window.__native.calls);
  record('V11', device, 'Boutons Appliquer / Vérifier reliés à l’application', 'applyUpdate=1, checkUpdate=1', `applyUpdate=${c.applyUpdate}, checkUpdate=${c.checkUpdate}`, c.applyUpdate === 1 && c.checkUpdate === 1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__native.setUpdate({ pending_sequence: 1792400000, deferred_reason: 'format de la file locale modifié : activation après synchronisation complète (3 opération(s) non synchronisée(s))', rejected: { 1792350000: 'démarrage non confirmé : retour à la version précédente' } }));
  txt = await openAbout(page);
  const noApply = !(await page.$('[data-anx="apply"]'));
  record('V12', device, 'Activation différée et version refusée : motifs affichés, pas de bouton Appliquer', 'motifs visibles', `${/Activation différée/.test(txt) ? 'différée affichée' : '—'} · ${/Refusée/.test(txt) ? 'refus affiché' : '—'} · bouton ${noApply ? 'masqué' : 'présent'}`, /Activation différée/.test(txt) && /Refusée/.test(txt) && noApply);
  await page.screenshot({ path: join(OUTDIR, `version-mise-a-jour-${device.replace(/[^0-9a-z]+/gi, '_')}.png`) });
  await page.keyboard.press('Escape');

  /* -------- Unification : champs exigés, nouvel APK, vérification manuelle, ordre au retour du réseau -------- */
  await page.evaluate(() => window.__native.setUpdate({ pending_sequence: 0, deferred_reason: '', rejected: {}, phase: 'a_jour', checking: false,
    active_web_version: '2026.10.25-1131.demo', last_success_at: '2026-10-25T09:00:00Z', last_check_at: '2026-10-25T10:00:00Z', last_result: 'à jour',
    latest: { sequence: 1792927862, web_version: '2026.10.25-1131.demo', published_at: '2026-10-25T08:30:00Z', update_policy: 'recommended' } }));
  txt = await openAbout(page);
  const need = ['Version et mises à jour', 'Version installée', 'Dernière version disponible', 'Statut : À jour', 'Connexion Internet', 'Opérations en attente', 'Synchronisation', 'Dernière mise à jour réussie', 'Vérifier les mises à jour'];
  const miss = need.filter((k) => !txt.includes(k));
  record('V13', device, 'Écran « Version et mises à jour » : tous les champs exigés', need.length + ' champs', miss.length ? 'manque : ' + miss.join(', ') : 'tous présents', miss.length === 0);
  await page.click('[data-anx="check"]'); await wait(1500);
  txt = await page.$eval('.anx-dlg', (d) => d.textContent);
  record('V14', device, 'Vérifier les mises à jour sans nouveauté : réponse claire', '« Aucune mise à jour disponible »', /Aucune mise à jour disponible/.test(txt) ? 'affiché' : txt.slice(-120), /Aucune mise à jour disponible/.test(txt));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__native.setUpdate({ phase: 'nouvel_apk', last_result: 'incompatible : nouvel APK requis (versionCode ≥ 4)',
    latest: { sequence: 1792999999, web_version: '2026.11.01-0800.futur', native_required: true, update_policy: 'recommended',
      native: { latest_version_code: 4, latest_version_name: '1.3.0', procedure: 'Demander le fichier signé au Branch Manager (canal interne).' } } }));
  txt = await openAbout(page);
  const noApply2 = !(await page.$('[data-anx="apply"]'));
  record('V15', device, 'Version exigeant un nouvel APK : statut, procédure autorisée, aucun bouton Appliquer', 'nouvel APK + procédure', /Nouvel APK requis/.test(txt) && /1\.3\.0/.test(txt) && /Branch Manager/.test(txt) && noApply2 ? 'affiché' : txt.slice(0, 160), /Nouvel APK requis/.test(txt) && /1\.3\.0/.test(txt) && /Branch Manager/.test(txt) && noApply2);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__native.setUpdate({ phase: 'prete', pending_sequence: 1792950000, deferred_reason: '', latest: { sequence: 1792950000, web_version: '2026.10.25-1200.secu', update_policy: 'security' } }));
  txt = await openAbout(page);
  record('V16', device, 'Mise à jour de sécurité prête : consigne de redémarrage', 'message sécurité', /Mise à jour de sécurité/.test(txt) ? 'affiché' : 'absent', /Mise à jour de sécurité/.test(txt));
  await page.keyboard.press('Escape');
  /* File du registre comptée + ordre au retour du réseau : synchronisation PUIS vérification */
  await page.evaluate(() => {
    window.__order = [];
    window.AFLP_FARMER_REGISTRY = window.AFLP_FARMER_REGISTRY || {};
    window.__frPending = 3; window.AFLP_FARMER_REGISTRY.pendingCount = function () { return Promise.resolve(window.__frPending); };
    var off = window.ANAGROCI_OFFLINE, s0 = off.syncNow.bind(off);
    off.syncNow = function () { window.__order.push('sync'); window.__frPending = 0; return s0(); };
    var n = window.AnagrociNative, c0 = n.checkUpdate;
    n.checkUpdate = function () { window.__order.push('check'); return c0.apply(n, arguments); };
  });
  await page.evaluate(() => ANAGROCI_OFFLINE.emit()); await wait(500);
  const btnTxt = await page.$eval('#anx-version', (b) => b.textContent);
  record('V17', device, 'Opérations du registre producteurs comptées dans le badge et transmises à l’application', '« · 3 »', btnTxt, / · 3$/.test(btnTxt));
  await page.context().setOffline(true); await wait(500);
  await page.click('#anx-version'); await page.waitForSelector('[data-anx="check"]');
  await page.click('[data-anx="check"]'); await wait(300);
  txt = await page.$eval('.anx-dlg', (d) => d.textContent);
  const offMsg = /Hors ligne : la vérification se fera au retour du réseau/.test(txt);
  await page.keyboard.press('Escape');
  await page.context().setOffline(false); await wait(9000);
  const order = await page.evaluate(() => window.__order.join('>'));
  record('V18', device, 'Hors ligne : vérification reportée ; retour du réseau : synchronisation PUIS vérification', 'message + sync>check', `${offMsg ? 'message' : 'pas de message'} · ${order}`, offMsg && /^sync>check/.test(order));
}

const browser = await chromium.launch();
try {
  for (const d of Object.keys(DEVICES)) { await partA(browser, d); await partB(browser, d); }
} finally { await browser.close(); }
mkdirSync(OUTDIR, { recursive: true });
const summary = { suite: 'apk-webview-sim', run_at: new Date().toISOString(), web_commit: MANIFEST.git_commit, chromium: 'Playwright', data_real_used: false,
  pass: results.filter((r) => r.status === 'PASS').length, fail: results.filter((r) => r.status === 'FAIL').length, results };
writeFileSync(join(OUTDIR, 'apk-webview-sim.json'), JSON.stringify(summary, null, 1));
console.log(`\nRÉSULTAT : ${summary.pass} PASS / ${summary.fail} FAIL → ${join('android', 'build', 'test-reports', 'apk-webview-sim.json')}`);
process.exit(summary.fail ? 1 : 0);
