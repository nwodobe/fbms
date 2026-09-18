/* ============================================================================
   Banc navigateur LOCAL — Sacherie AFLP, lot 1 (identité, rôles, périmètres)
   ----------------------------------------------------------------------------
   Sert les VRAIS fichiers du dépôt dans Chromium et redirige tout appel
   https://jmbdgpdthzpszfnddwzi.supabase.co vers un backend LOCAL :
     · /rest/v1/*  -> PostgREST local branché sur la réplique PostgreSQL
                      (vraies RLS, vrais triggers, vraies RPC du lot) ;
     · /auth/v1/*  -> émulation GoTrue minimale (jetons HS256 signés par une
                      clé de TEST locale) ;
     · /functions/v1/admin-create-user -> 404 (état réel de la production :
                      fonction non déployée).
   Aucun appel ne part vers la production : toute requête vers un hôte non
   prévu est BLOQUÉE et journalisée.

   Prérequis : réplique construite (tests/sql/), PostgREST sur :3001 avec
   jwt-secret = BANC_JWT_SECRET, Playwright disponible (NODE_PATH).
   Usage : BANC_JWT_SECRET=… NODE_PATH=…/node_modules node tests/navigateur/banc-local.mjs
   ========================================================================== */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url + '/../');
const { chromium } = require('playwright');
const RACINE = process.env.BANC_RACINE || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const NM = process.env.NODE_PATH;
const SECRET = process.env.BANC_JWT_SECRET;
const PGRST = process.env.BANC_PGRST || 'http://127.0.0.1:3001';
const PROD = 'https://jmbdgpdthzpszfnddwzi.supabase.co';
const SITE = 'http://fbms.local';
const MDP = 'Test-Banc-1234';
if (!SECRET || !NM) { console.error('BANC_JWT_SECRET et NODE_PATH requis'); process.exit(2); }

export const COMPTES = {
  bm: ['00000000-0000-0000-0000-0000000000b1', 'bm@test.invalid'],
  zh: ['00000000-0000-0000-0000-0000000000a1', 'zh@test.invalid'],
  fboo: ['00000000-0000-0000-0000-0000000000f1', 'fboo@test.invalid'],
  uh_botro: ['00000000-0000-0000-0000-0000000000c1', 'uh.botro@test.invalid'],
  uh_diabo: ['00000000-0000-0000-0000-0000000000c2', 'uh.diabo@test.invalid'],
  sk_botro: ['00000000-0000-0000-0000-0000000000d1', 'sk.botro@test.invalid'],
  sk_diabo: ['00000000-0000-0000-0000-0000000000d2', 'sk.diabo@test.invalid'],
  sk_sans: ['00000000-0000-0000-0000-0000000000d3', 'sk.sans.cluster@test.invalid'],
  nouveau: ['00000000-0000-0000-0000-0000000000e3', 'nouveau@test.invalid'],
};
const PAR_EMAIL = Object.fromEntries(Object.values(COMPTES).map(([id, e]) => [e, id]));

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url');
  return `${h}.${p}.${s}`;
}
function verifier(tok) {
  try {
    const [h, p, s] = String(tok || '').split('.');
    if (!s || crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url') !== s) return null;
    return JSON.parse(Buffer.from(p, 'base64url').toString());
  } catch { return null; }
}
const ANON = jwt({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 86400 });
function session(id, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token: jwt({ sub: id, role: 'authenticated', email, aud: 'authenticated', exp }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'rt-' + id, user };
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
export const JOURNAL = { bloques: [], erreursConsole: [] };

async function router(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (url.origin === SITE) {
    const f = path.join(RACINE, decodeURIComponent(url.pathname));
    if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'absent' });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' } });
  }
  if (url.hostname === 'cdn.jsdelivr.net') {
    const local = url.pathname.includes('supabase-js') ? path.join(NM, '@supabase/supabase-js/dist/umd/supabase.js')
      : url.pathname.includes('leaflet') && url.pathname.endsWith('.js') ? path.join(NM, 'leaflet/dist/leaflet.js')
      : url.pathname.includes('leaflet') ? path.join(NM, 'leaflet/dist/leaflet.css') : null;
    if (local && fs.existsSync(local)) return route.fulfill({ status: 200, body: fs.readFileSync(local), headers: { 'content-type': local.endsWith('.css') ? 'text/css' : 'application/javascript' } });
    return route.fulfill({ status: 404, body: '' });
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return route.fulfill({ status: 200, body: '', headers: { 'content-type': 'text/css' } });
  if (url.origin === PROD) {
    if (url.pathname.startsWith('/auth/v1/token')) {
      const corps = JSON.parse(req.postData() || '{}');
      let id = null, email = corps.email;
      if (url.searchParams.get('grant_type') === 'password') { id = PAR_EMAIL[String(email || '').toLowerCase()]; if (corps.password !== MDP) id = null; }
      else if (url.searchParams.get('grant_type') === 'refresh_token') { id = String(corps.refresh_token || '').slice(3); email = Object.values(COMPTES).find(([i]) => i === id)?.[1]; }
      if (!id) return route.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) });
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(session(id, email)) });
    }
    if (url.pathname.startsWith('/auth/v1/user')) {
      const c = verifier((req.headers()['authorization'] || '').replace(/^Bearer /i, ''));
      if (!c || !c.sub) return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: '{"msg":"invalid"}' });
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: c.sub, aud: 'authenticated', role: 'authenticated', email: c.email }) });
    }
    if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.startsWith('/rest/v1/')) {
      const h = { ...req.headers() };
      const tok = (h['authorization'] || '').replace(/^Bearer /i, '');
      h['authorization'] = 'Bearer ' + (verifier(tok) ? tok : ANON);
      delete h['apikey']; delete h['host']; delete h['origin']; delete h['referer'];
      const cible = PGRST + url.pathname.replace('/rest/v1', '') + url.search;
      const r = await fetch(cible, { method: req.method(), headers: h, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() });
      const hdrs = { ...cors }; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) hdrs[k] = v; });
      return route.fulfill({ status: r.status, headers: hdrs, body: Buffer.from(await r.arrayBuffer()) });
    }
    if (url.pathname.startsWith('/functions/v1/')) return route.fulfill({ status: 404, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":"Function not found"}' });
    if (url.pathname.startsWith('/storage/v1/')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"Key":"banc/preuve.jpg"}' });
  }
  JOURNAL.bloques.push(req.method() + ' ' + url.origin + url.pathname);
  return route.abort('blockedbyclient');
}

export async function ouvrir(browser, compte, chemin, taille = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport: taille, serviceWorkers: 'block' });
  await ctx.route('**/*', router);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') JOURNAL.erreursConsole.push(`[${compte}] ${m.text().slice(0, 200)}`); });
  page.on('dialog', (d) => d.accept(page._reponseDialogue || ''));
  await page.goto(SITE + chemin);
  await page.waitForSelector('#ag-email', { timeout: 15000 });
  await page.fill('#ag-email', COMPTES[compte][1]);
  await page.fill('#ag-pass', MDP);
  await page.click('#ag-btn');
  await page.waitForSelector('#anagroci-authgate', { state: 'detached', timeout: 20000 });
  return { ctx, page };
}

export async function lancer() { return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true }); }
