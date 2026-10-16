#!/usr/bin/env node
/**
 * Récupération de mot de passe FBMS — parcours complet en navigateur réel (Chromium).
 *
 * Les pages sont servies depuis le dépôt sous l'origine de PRODUCTION
 * (https://nwodobe.github.io/fbms/…, interceptée localement) : mêmes chemins,
 * même Service Worker, même URL de redirection que sur le site publié.
 *
 * Supabase Auth est remplacé par une DOUBLURE d'API (GoTrue) en mémoire :
 *   /recover, /verify, /user (GET/PUT), /token, /logout
 * avec jetons à usage unique, expiration, liste de redirections autorisées
 * (sinon repli sur l'URL du site, comme GoTrue) et une boîte d'envoi SIMULÉE.
 * AUCUN e-mail réel n'est envoyé ni reçu ; aucun compte réel n'est utilisé.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/password-recovery-e2e.mjs
 */
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
/* Requêtes émises par le Service Worker interceptées elles aussi (Chromium). */
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';

const RACINE = resolve(process.cwd());
const SITE = 'https://nwodobe.github.io/fbms/';
const RECOVERY_URL = SITE + 'shared/password-reset.html';
const SUPA = 'https://jmbdgpdthzpszfnddwzi.supabase.co';
const SITE_URL_GOTRUE = 'http://localhost:3000';            // repli GoTrue si la redirection n'est pas autorisée
const CAPTURES = join(RACINE, '.captures-recuperation');
mkdirSync(CAPTURES, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const SUPABASE_JS = [join(RACINE, 'android/.vendor-cache/@supabase__supabase-js@2.118.0/package/dist/umd/supabase.js'),
  join(RACINE, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js')].find(existsSync);
if (!SUPABASE_JS) throw new Error('supabase-js introuvable : npm install --no-save @supabase/supabase-js@2.118.0');

let ok = 0; const echecs = []; const journal = [];
function verifier(c, libelle) { journal.push((c ? 'PASS ' : 'FAIL ') + libelle); if (c) ok++; else echecs.push(libelle); }
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ doublure GoTrue */
const tok = () => randomBytes(18).toString('hex');
const AUTH = {
  users: new Map([
    ['agent.test@exemple.test', { id: '00000000-0000-4000-8000-0000000000a1', email: 'agent.test@exemple.test', password: 'AncienMotDePasse!2026', role: 'Unit Head', cluster: 'BOTRO' }],
    ['autre.test@exemple.test', { id: '00000000-0000-4000-8000-0000000000a2', email: 'autre.test@exemple.test', password: 'AutreCompte!2026', role: 'Zonal Head', cluster: null }],
  ]),
  allow: [RECOVERY_URL],
  links: new Map(), sessions: new Map(), outbox: [], recoverCalls: [], ttlMs: 60 * 60 * 1000,
  overridePage: null, horsLigne: false,
};
const profilsAvant = JSON.stringify([...AUTH.users.values()].map(({ id, role, cluster }) => ({ id, role, cluster })));
function sessionFor(user, amr) {
  const access = 'jeton-' + tok(), refresh = tok();
  AUTH.sessions.set(access, { email: user.email, amr });
  return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 };
}
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
/* Redirection 303 de GoTrue : Chromium derrière un proxy refuse une redirection simulée sur
   navigation ; on la reproduit par location.replace (même adresse finale, même fragment). */
const rediriger = (route, location) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!doctype html><script>location.replace(${JSON.stringify(location)})</script>` });
function json(route, status, body, headers) {
  return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...(headers || {}) }, body: JSON.stringify(body) });
}
async function gotrue(route) {
  const req = route.request(); const u = new URL(req.url()); const p = u.pathname.replace('/auth/v1', '');
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const body = req.postData() ? JSON.parse(req.postData()) : {};
  const bearer = (req.headers()['authorization'] || '').replace(/^Bearer /, '');
  if (p === '/recover' && req.method() === 'POST') {
    const redirect = u.searchParams.get('redirect_to') || '';
    AUTH.recoverCalls.push({ email: body.email, redirect_to: redirect });
    const user = AUTH.users.get(String(body.email || '').toLowerCase());
    if (user) {
      const target = AUTH.allow.includes(redirect) ? redirect : SITE_URL_GOTRUE;
      const t = tok(); AUTH.links.set(t, { email: user.email, target, exp: Date.now() + AUTH.ttlMs, used: false });
      AUTH.outbox.push({ to: user.email, link: `${SUPA}/auth/v1/verify?token=${t}&type=recovery&redirect_to=${encodeURIComponent(target)}`, token: t });
    }
    return json(route, 200, {});
  }
  if (p === '/verify' && req.method() === 'GET') {
    const l = AUTH.links.get(u.searchParams.get('token')); const target = (l && l.target) || SITE_URL_GOTRUE;
    if (!l || l.used || Date.now() > l.exp) {
      return rediriger(route, `${target}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    }
    l.used = true;
    const s = sessionFor(AUTH.users.get(l.email), 'recovery');
    const h = new URLSearchParams({ access_token: s.access_token, expires_at: String(s.expires_at), expires_in: '3600', refresh_token: s.refresh_token, token_type: 'bearer', type: 'recovery' });
    return rediriger(route, `${target}#${h}`);
  }
  if (p === '/user') {
    const s = AUTH.sessions.get(bearer); if (!s) return json(route, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    const user = AUTH.users.get(s.email);
    if (req.method() === 'PUT') {
      if (body.password) {
        if (body.password.length < 6) return json(route, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
        if (body.password === user.password) return json(route, 422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' });
        user.password = body.password; AUTH.passwordChanges = (AUTH.passwordChanges || 0) + 1;
      }
    }
    return json(route, 200, userJson(user));
  }
  if (p === '/token' && u.searchParams.get('grant_type') === 'password') {
    const user = AUTH.users.get(String(body.email || '').toLowerCase());
    if (!user || user.password !== body.password) return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return json(route, 200, { ...sessionFor(user, 'password'), user: userJson(user) });
  }
  if (p === '/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  return json(route, 404, { msg: 'doublure : ' + p });
}

/* ------------------------------------------------------------------ site */
function servirSite(route) {
  const u = new URL(route.request().url());
  let chemin = decodeURIComponent(u.pathname.replace(/^\/fbms\//, '/'));
  if (chemin.endsWith('/')) chemin += 'index.html';
  if (AUTH.overridePage && chemin === '/shared/password-reset.html') {
    return route.fulfill({ status: 200, contentType: TYPES['.html'], body: AUTH.overridePage, headers: { 'cache-control': 'max-age=600' } });
  }
  const cible = normalize(join(RACINE, chemin));
  if (!cible.startsWith(RACINE) || !existsSync(cible) || statSync(cible).isDirectory()) return route.fulfill({ status: 404, body: 'introuvable' });
  return route.fulfill({ status: 200, contentType: TYPES[extname(cible)] || 'application/octet-stream', body: readFileSync(cible), headers: { 'cache-control': 'max-age=600' } });
}
async function contexte(navigateur, largeur, opts = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 500 ? 844 : 900 }, serviceWorkers: opts.sw ? 'allow' : 'block',
    isMobile: largeur < 500, hasTouch: largeur < 500 });
  ctx.__externes = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(SITE)) return AUTH.horsLigne ? route.abort('internetdisconnected') : servirSite(route);
    if (url.startsWith(SUPA + '/auth/v1/')) return gotrue(route);
    if (url.startsWith(SUPA + '/rest/v1/')) {
      if (/\/profils/.test(url)) {
        const profil = { user_id: '00000000-0000-4000-8000-0000000000a1', email: 'agent.test@exemple.test', nom: 'AGENT FICTIF', role: 'Unit Head', actif: true, cluster: 'BOTRO', zone: null };
        const objet = /vnd\.pgrst\.object/.test(route.request().headers()['accept'] || '');
        return json(route, 200, objet ? profil : [profil]);
      }
      return json(route, 200, []);
    }
    if (/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/.test(url)) return route.fulfill({ status: 200, contentType: TYPES['.js'], body: readFileSync(SUPABASE_JS) });
    if (/cdn\.tailwindcss\.com/.test(url)) return route.fulfill({ status: 200, contentType: TYPES['.js'], body: 'window.tailwind={config:{}};' });
    if (/jsdelivr|unpkg|cdnjs|tailwindcss|fonts\.(googleapis|gstatic)|openstreetmap/.test(url)) return route.fulfill({ status: 200, contentType: url.includes('.css') || url.includes('fonts.googleapis') ? 'text/css' : TYPES['.js'], body: '' });
    ctx.__externes.push(url);
    return route.fulfill({ status: 404, body: '' });
  });
  return ctx;
}
async function page(ctx) {
  const p = await ctx.newPage(); p.__erreurs = [];
  p.on('pageerror', (e) => p.__erreurs.push(e.message));
  return p;
}
const boite = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, visible: !!(r.width && r.height) && getComputedStyle(e).visibility !== 'hidden' }; });
const debordement = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const notice = (p) => p.$eval('#notice', (n) => n.hidden ? '' : n.textContent);

async function demanderLien(p, email) {
  await p.fill('#recover-email', email);
  await p.click('#request-button');
  await p.waitForFunction(() => /Si un compte|indisponible|Impossible/.test(document.getElementById('notice').textContent), null, { timeout: 10000 });
  return notice(p);
}

async function main() {
  const navigateur = await chromium.launch();
  try {
    /* ============ 1-3 + 16 : lien visible sans connexion, trois interfaces, trois largeurs ============ */
    for (const L of [390, 768, 1440]) {
      const ctx = await contexte(navigateur, L); const p = await page(ctx);
      for (const [nom, url] of [['portail', SITE + 'index.html'], ['FIELD BUYING', SITE + 'operations/field-buying.html']]) {
        await p.goto(url, { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('#ag-forgot', { timeout: 15000 });
        const btn = await boite(p, '#ag-btn'), lien = await boite(p, '#ag-forgot');
        const libelles = await p.$eval('#ag-form', (f) => f.textContent);
        verifier(lien.visible && lien.y >= btn.bottom && lien.y - btn.bottom < 40 && /Email/.test(libelles) && /Mot de passe/.test(libelles),
          `${L}px · ${nom} : « Mot de passe oublié ? » visible sans session, juste sous « Se connecter » (écart ${Math.round(lien.y - btn.bottom)} px)`);
        verifier(lien.h >= 24 && lien.w >= 24, `${L}px · ${nom} : cible tactile ≥ 24 px (${Math.round(lien.w)}×${Math.round(lien.h)} px)`);
        if (L === 390) await p.screenshot({ path: join(CAPTURES, `connexion-${nom.replace(/\s/g, '-').toLowerCase()}-${L}.png`) });
        const href = await p.$eval('#ag-forgot', (a) => a.href);
        verifier(href === RECOVERY_URL, `${L}px · ${nom} : le lien pointe vers la page publique HTTPS (${href})`);
      }
      /* Ancienne interface FBMS : son propre formulaire de connexion */
      await p.goto(SITE + 'fbms/index.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => typeof window.openLoginModal === 'function', null, { timeout: 15000 });
      await p.evaluate(() => window.openLoginModal());
      await p.waitForSelector('#loginForgotLink', { timeout: 10000 });
      const b2 = await boite(p, '#loginSubmitBtn'), l2 = await boite(p, '#loginForgotLink');
      verifier(l2.visible && l2.y >= b2.bottom && l2.y - b2.bottom < 40, `${L}px · ancienne interface FBMS : lien sous « Se connecter » (écart ${Math.round(l2.y - b2.bottom)} px)`);
      if (L === 390) await p.screenshot({ path: join(CAPTURES, `connexion-ancienne-fbms-${L}.png`) });

      /* Clic réel → page de récupération (erreurs JS comptées à partir d'ici : portail + récupération) */
      p.__erreurs = [];
      await p.goto(SITE + 'index.html', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#ag-forgot');
      await Promise.all([p.waitForURL(RECOVERY_URL), p.click('#ag-forgot')]);
      await p.waitForSelector('#request-form:not([hidden])');
      const champ = await p.$eval('#recover-email', (i) => ({ type: i.type, required: i.required, auto: i.autocomplete }));
      verifier(p.url() === RECOVERY_URL && champ.type === 'email' && champ.required, `${L}px · clic : page de récupération ouverte, champ e-mail obligatoire`);
      verifier(!(await debordement(p)), `${L}px · page de récupération sans défilement horizontal`);
      if (L === 390) await p.screenshot({ path: join(CAPTURES, `recuperation-demande-${L}.png`) });
      verifier(p.__erreurs.length === 0, `${L}px · aucune erreur JavaScript (${p.__erreurs.slice(0, 2).join(' | ')})`);
      await ctx.close();
    }

    /* ============ 4-11 : parcours complet sur smartphone ============ */
    {
      const ctx = await contexte(navigateur, 390); const p = await page(ctx);
      await p.goto(RECOVERY_URL + '?redirect_to=https://evil.example/', { waitUntil: 'domcontentloaded' });
      const m1 = await demanderLien(p, 'Agent.Test@exemple.test');
      const appel = AUTH.recoverCalls.at(-1);
      verifier(/Si un compte correspond/.test(m1) && appel.email === 'agent.test@exemple.test', 'Demande valide : message neutre, e-mail normalisé envoyé à Supabase');
      verifier(appel.redirect_to === RECOVERY_URL, `Redirection demandée = page publique fixe, paramètre d’URL « redirect_to » ignoré (${appel.redirect_to})`);
      const nbAvant = AUTH.outbox.length;
      const m2 = await demanderLien(p, 'personne.inconnue@exemple.test');
      verifier(m2 === m1 && AUTH.outbox.length === nbAvant, 'Adresse inexistante : message identique, aucun e-mail (pas d’énumération)');
      const mail = AUTH.outbox.find((m) => m.to === 'agent.test@exemple.test');
      verifier(!!mail && mail.link.includes(encodeURIComponent(RECOVERY_URL)), 'E-mail SIMULÉ déposé dans la boîte de la doublure avec un lien vers la page publique (aucun e-mail réel)');

      await p.goto(mail.link);
      await p.waitForSelector('#update-form:not([hidden])', { timeout: 15000 });
      const href = p.url();
      verifier(href === RECOVERY_URL, `Lien valide : page HTTPS ouverte, jetons retirés de l’adresse (${href})`);
      verifier(/Lien v.rifi/.test(await notice(p)), 'Lien valide : formulaire « nouveau mot de passe » affiché');
      await p.screenshot({ path: join(CAPTURES, 'recuperation-nouveau-mdp-390.png') });
      await p.fill('#new-password', 'court'); await p.fill('#confirm-password', 'court'); await p.click('#update-button');
      await attendre(300);
      const valide = await p.$eval('#update-form', (f) => f.checkValidity());
      verifier(!valide && !AUTH.passwordChanges, 'Mot de passe trop court (< 12) : bloqué par le formulaire, rien envoyé');
      await p.fill('#new-password', 'NouveauMotDePasse!2026'); await p.fill('#confirm-password', 'NouveauMotDePasse!2027'); await p.click('#update-button');
      verifier(/ne correspondent pas/.test(await notice(p)) && !AUTH.passwordChanges, 'Confirmation différente : refusée avant envoi');
      await p.fill('#new-password', 'NouveauMotDePasse!2026'); await p.fill('#confirm-password', 'NouveauMotDePasse!2026'); await p.click('#update-button');
      await p.waitForSelector('#completed:not([hidden])', { timeout: 10000 });
      verifier(AUTH.users.get('agent.test@exemple.test').password === 'NouveauMotDePasse!2026' && AUTH.passwordChanges === 1, 'Nouveau mot de passe enregistré par updateUser() (1 seule modification)');
      const stockage = await p.evaluate(() => JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)));
      verifier(!/jeton-|access_token|refresh_token/.test(stockage) && !/access_token/.test(p.url()), 'Aucun jeton conservé : ni dans l’adresse, ni dans localStorage / sessionStorage');
      await p.screenshot({ path: join(CAPTURES, 'recuperation-terminee-390.png') });

      /* Reconnexion par le VRAI formulaire du portail */
      const p2 = await page(ctx);
      await p2.goto(SITE + 'index.html', { waitUntil: 'domcontentloaded' });
      await p2.waitForSelector('#ag-form');
      await p2.fill('#ag-email', 'agent.test@exemple.test'); await p2.fill('#ag-pass', 'AncienMotDePasse!2026'); await p2.click('#ag-btn');
      await p2.waitForFunction(() => /incorrect/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
      verifier(/incorrect/.test(await p2.textContent('body')), 'Ancien mot de passe : connexion refusée par le portail');
      await p2.fill('#ag-email', 'agent.test@exemple.test'); await p2.fill('#ag-pass', 'NouveauMotDePasse!2026');
      await Promise.all([p2.waitForEvent('load', { timeout: 15000 }).catch(() => null), p2.click('#ag-btn')]);
      await attendre(1500);
      await p2.waitForFunction(() => !document.getElementById('ag-form') && /Operations Suite/.test(document.body.textContent), null, { timeout: 15000 }).catch(() => {});
      const connecte = await p2.evaluate(() => !document.getElementById('ag-form') && /Où voulez-vous travailler/.test(document.body.textContent));
      verifier(connecte, 'Nouveau mot de passe : connexion acceptée par le portail (session créée)');

      /* 13 : lien déjà utilisé */
      const p3 = await page(ctx);
      await p3.goto(mail.link);
      await p3.waitForFunction(() => /invalide ou a expir/.test(document.getElementById('notice').textContent), null, { timeout: 15000 });
      verifier(await p3.$eval('#update-form', (f) => f.hidden) && !/error/.test(p3.url()), 'Lien déjà utilisé : refusé, formulaire masqué, paramètres d’erreur retirés de l’adresse');
      /* 8 + session ordinaire présente : la session de l’app ne permet PAS de changer le mot de passe */
      verifier(connecte && await p3.$eval('#update-form', (f) => f.hidden), 'Lien invalide refusé alors qu’une session FBMS ordinaire existe dans le navigateur');
      await ctx.close();
    }

    /* ============ 12 : lien expiré ; jeton forgé ; paramètre arbitraire ============ */
    {
      const ctx = await contexte(navigateur, 390); const p = await page(ctx);
      AUTH.ttlMs = -1000;
      await p.goto(RECOVERY_URL); await demanderLien(p, 'autre.test@exemple.test');
      AUTH.ttlMs = 60 * 60 * 1000;
      const expire = AUTH.outbox.filter((m) => m.to === 'autre.test@exemple.test').at(-1);
      await p.goto(expire.link);
      await p.waitForFunction(() => /invalide ou a expir/.test(document.getElementById('notice').textContent), null, { timeout: 15000 });
      verifier(await p.$eval('#update-form', (f) => f.hidden), 'Lien expiré : refusé');
      const p2 = await page(ctx);
      await p2.goto(RECOVERY_URL + '#access_token=forge&refresh_token=forge&expires_in=3600&token_type=bearer&type=recovery');
      await p2.waitForFunction(() => /invalide ou a expir/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });
      verifier(await p2.$eval('#update-form', (f) => f.hidden) && !/access_token/.test(p2.url()), 'Jeton forgé dans l’adresse : refusé (vérifié auprès de Supabase), adresse nettoyée');
      const p3 = await page(ctx);
      await p3.goto(RECOVERY_URL + '?type=recovery');
      await p3.waitForFunction(() => /invalide ou a expir/.test(document.getElementById('notice').textContent), null, { timeout: 30000 });
      verifier(await p3.$eval('#update-form', (f) => f.hidden), 'Paramètre « type=recovery » sans lien : refusé');
      const avant = AUTH.passwordChanges;
      await p3.evaluate(() => { const f = document.getElementById('update-form'); f.hidden = false; document.getElementById('new-password').value = 'Pirate!Pirate!2026'; document.getElementById('confirm-password').value = 'Pirate!Pirate!2026'; f.requestSubmit(); });
      await attendre(800);
      verifier(AUTH.passwordChanges === avant, 'Formulaire forcé dans la page sans lien valide : aucune modification envoyée');
      await ctx.close();
    }

    /* ============ 14 : redirection non autorisée (comportement serveur reproduit) ============ */
    {
      const avant = AUTH.outbox.length;
      AUTH.allow = [];
      const ctx = await contexte(navigateur, 1440); const p = await page(ctx);
      await p.goto(RECOVERY_URL); await demanderLien(p, 'autre.test@exemple.test');
      const m = AUTH.outbox.slice(avant).at(-1);
      verifier(m && m.link.includes(encodeURIComponent(SITE_URL_GOTRUE)) && !m.link.includes('nwodobe'),
        'URL absente de la liste Supabase : le lien part vers l’URL du site (localhost:3000) — d’où l’obligation de l’ajouter');
      AUTH.allow = [RECOVERY_URL];
      await ctx.close();
    }

    /* ============ 18 : Service Worker : jamais d’ancienne copie de la page de récupération ============ */
    {
      const ctx = await contexte(navigateur, 390, { sw: true }); const p = await page(ctx);
      await p.goto(SITE + 'operations/field-buying.html', { waitUntil: 'load' });
      await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});
      const ctrl = await p.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
      const version = await p.evaluate(() => caches.keys());
      verifier(ctrl && version.some((k) => /ops-offline-v2-auth-recovery/.test(k)), `Service Worker actif, caches de la nouvelle version (${version.join(', ')})`);
      await p.goto(RECOVERY_URL);
      AUTH.overridePage = '<!doctype html><title>v2</title><p id="marqueur">VERSION-2</p>';
      await p.goto(RECOVERY_URL);
      verifier(await p.$('#marqueur') !== null, 'Page de récupération modifiée côté serveur : nouvelle version servie immédiatement (pas de cache SW)');
      AUTH.overridePage = null;
      const enCache = await p.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) if (/password-reset/.test(r.url)) out.push(r.url); } return out; });
      verifier(enCache.length === 0, `Aucune ressource de récupération dans les caches hors ligne (${enCache.length})`);
      AUTH.horsLigne = true;
      await p.goto(RECOVERY_URL).catch(() => {});
      const txt = await p.textContent('body').catch(() => '');
      verifier(/Connexion Internet requise/.test(txt), 'Hors ligne : message explicite, jamais une copie périmée');
      AUTH.horsLigne = false;
      await ctx.close();
    }

    const profilsApres = JSON.stringify([...AUTH.users.values()].map(({ id, role, cluster }) => ({ id, role, cluster })));
    verifier(profilsApres === profilsAvant, 'Rôles et affectations des comptes de test inchangés après récupération');
  } finally {
    await navigateur.close();
  }
  console.log(journal.join('\n'));
  console.log(JSON.stringify({ resultat: echecs.length ? 'FAIL' : 'PASS', reussis: ok, echecs: echecs.length, captures: '.captures-recuperation/', emails_reels: 0 }));
  if (echecs.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
