#!/usr/bin/env node
/**
 * CARTOGRAPHIE DES PARCELLES — test navigateur de bout en bout.
 * Vrai navigateur (Chromium), vraie page FIELD BUYING, vrais fichiers du dépôt, vraie base
 * PostgreSQL LOCALE avec les migrations, la RLS et les RPC de la cartographie.
 * Aucune connexion à Supabase : le client Supabase est remplacé par un pont local qui exécute
 * chaque lecture et chaque RPC SOUS LE RÔLE `authenticated`, avec l'identité du compte fictif.
 * Positions GPS : fournies par l'émulation de géolocalisation de Chromium (outil de TEST) ;
 * le code de l'application ne contient aucune position simulée. Données 100 % fictives.
 *
 * Usage : PGHOST=/tmp PGPORT=54329 node tests/cartographie/cartographie-e2e.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/playwright')); }
const geodesic = require('../../shared/vendor/geographiclib-geodesic-2.2.0.min.js'); const G = geodesic.Geodesic.WGS84;

const ICI = dirname(fileURLToPath(import.meta.url)), ROOT = join(ICI, '..', '..'), OUT = join(ICI, 'resultats');
const HOST = process.env.PGHOST || '', PGPORT = process.env.PGPORT || '', DB = process.env.CARTO_E2E_DB || 'fbms_carto_e2e';
if (!HOST || /supabase/i.test(HOST)) { console.error('REFUS : cible absente ou Supabase détectée'); process.exit(2); }
const LEAFLET = process.env.LEAFLET_DIR || '/home/claude/work/lf/package/dist';
const PORT = Number(process.env.PORT_CARTO_E2E || 4351);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const U = { bm: '00000000-0000-4000-8000-0000000000c1', zh1: '00000000-0000-4000-8000-0000000000c2', uh_bro: '00000000-0000-4000-8000-0000000000c3',
  auh_bro: '00000000-0000-4000-8000-0000000000c4', uh_bot: '00000000-0000-4000-8000-0000000000c5', zh2: '00000000-0000-4000-8000-0000000000c6' };
const PL = { A: '30000000-0000-4000-8000-000000000001', B: '30000000-0000-4000-8000-000000000002', C: '30000000-0000-4000-8000-000000000003', N: '30000000-0000-4000-8000-000000000004' };

/* ---------- base locale ---------- */
function psql(sql, db = DB) {
  const r = spawnSync('psql', ['-h', HOST, '-p', PGPORT, '-U', 'postgres', '-d', db, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) { const l = (r.stderr || '').split('\n').find(x => x.includes('ERROR')) || r.stderr || 'erreur'; throw new Error(l.split('ERROR:').pop().trim()); }
  return r.stdout.trim();
}
function construire() {
  const r = spawnSync(join(ICI, 'construire_recette.sh'), [DB], { encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error('construction recette : ' + r.stderr);
  psql(`
insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@example.invalid')`).join(',')} on conflict do nothing;
insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values
 ('${U.bm}', 'bm@example.invalid', 'BM FICTIF', 'Branch Manager', null, null, true),
 ('${U.zh1}', 'zh1@example.invalid', 'ZH GBEKE 1 FICTIF', 'Zonal Head', null, 'GBEKE_1', true),
 ('${U.zh2}', 'zh2@example.invalid', 'ZH GBEKE 2 FICTIF', 'Zonal Head', null, 'GBEKE_2', true),
 ('${U.uh_bro}', 'uh.bro@example.invalid', 'UH BROBO FICTIF', 'Unit Head', 'BROBO', null, true),
 ('${U.auh_bro}', 'auh.bro@example.invalid', 'AUH BROBO FICTIF', 'Assistant Unit Head', 'BROBO', 'GBEKE_1', true),
 ('${U.uh_bot}', 'uh.bot@example.invalid', 'UH BOTRO FICTIF', 'Unit Head', 'BOTRO', null, true) on conflict do nothing;
select set_config('request.jwt.claim.sub', '${U.bm}', false);
insert into public.campaigns (id, code, name, year, status, is_current, campaign_type) values ('10000000-0000-4000-8000-000000000009', '2097', 'CAMPAGNE FICTIVE E2E', 2097, 'OPEN', true, 'SIMULATION') on conflict do nothing;
insert into public.villages (id, data, village, cluster, cluster_code) values ('V-CE2E-BRO', '{}', 'VILLAGE FICTIF BROBO', 'Brobo', 'BROBO'), ('V-CE2E-BOT', '{}', 'VILLAGE FICTIF BOTRO', 'Botro', 'BOTRO') on conflict do nothing;
insert into public.rt (id, data, nom, village_id) values ('RT-CE2E-BRO', '{}', 'RT FICTIF BROBO', 'V-CE2E-BRO'), ('RT-CE2E-BOT', '{}', 'RT FICTIF BOTRO', 'V-CE2E-BOT') on conflict do nothing;
insert into public.producteurs (id, code, data, nom, prenoms, village_id, rt_id) values
 ('P-CE2E-A', '9001', '{}', 'PRODUCTEUR FICTIF', 'ALPHA', 'V-CE2E-BRO', 'RT-CE2E-BRO'), ('P-CE2E-B', '9002', '{}', 'PRODUCTEUR FICTIF', 'BRAVO', 'V-CE2E-BRO', 'RT-CE2E-BRO'),
 ('P-CE2E-C', '9003', '{}', 'PRODUCTEUR FICTIF', 'CHARLIE', 'V-CE2E-BOT', 'RT-CE2E-BOT'), ('P-CE2E-N', '9004', '{}', 'PRODUCTEUR FICTIF', 'SANS ACCORD', 'V-CE2E-BRO', 'RT-CE2E-BRO') on conflict do nothing;
insert into public.farmer_plots (id, producteur_id, village_id, local_name, declared_area, tree_count) values
 ('${PL.A}', 'P-CE2E-A', 'V-CE2E-BRO', 'CHAMP FICTIF ALPHA', 1.2, 100), ('${PL.B}', 'P-CE2E-B', 'V-CE2E-BRO', 'CHAMP FICTIF BRAVO', 2.0, 90),
 ('${PL.C}', 'P-CE2E-C', 'V-CE2E-BOT', 'CHAMP FICTIF CHARLIE', 3.0, 80), ('${PL.N}', 'P-CE2E-N', 'V-CE2E-BRO', 'CHAMP FICTIF SANS ACCORD', 1.0, 70) on conflict do nothing;
insert into public.farmer_consents (producteur_id, status, scopes, consent_at, text_version, method, created_at) values
 ('P-CE2E-A', 'GRANTED', '{"gps": true}', now(), 'AFLP-DATA-CONSENT-2026.1', 'VERBAL', now()), ('P-CE2E-B', 'GRANTED', '{"gps": true}', now(), 'AFLP-DATA-CONSENT-2026.1', 'VERBAL', now()),
 ('P-CE2E-C', 'GRANTED', '{"gps": true}', now(), 'AFLP-DATA-CONSENT-2026.1', 'VERBAL', now());`);
}
function activer(objet) {
  psql(`begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"${U.bm}","role":"authenticated"}',true); select set_config('request.jwt.claim.sub','${U.bm}',true);
        select public.plot_map_parametre_definir('activation', '${JSON.stringify(objet)}'::jsonb); commit;`);
}

/* ---------- pont : lectures et RPC sous l'identité fictive ---------- */
const lit = v => v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const ident = v => { if (!/^[a-z_][a-z0-9_]*$/.test(v)) throw new Error('identifiant refusé : ' + v); return v; };
const TABLES_OK = /^(plot_map_[a-z_]+|farmer_plot_anomalies|farmer_plot_map_events|pheno_[a-z_]+|farmer_plots|villages|producteurs|profils|campaigns|aflp_clusters|aflp_zones)$/;
function commeUtilisateur(user, sql) {
  const claims = JSON.stringify({ sub: user, role: 'authenticated' });
  return psql(`begin;\n\\o /dev/null\nset local role authenticated; select set_config('request.jwt.claims','${claims}',true); select set_config('request.jwt.claim.sub','${user}',true);\n\\o\n${sql};\ncommit;`);
}
function pont(d) {
  if (!Object.values(U).includes(d.user)) throw new Error('compte fictif inconnu');
  if (d.kind === 'rpc') {
    if (!/^(plot_map|pheno)_[a-z_]+$/.test(d.name)) return null;
    const args = Object.entries(d.args || {}).map(([k, v]) => `${ident(k)} => ${typeof v === 'object' && v !== null ? lit(JSON.stringify(v)) + '::jsonb' : typeof v === 'number' ? Number(v) : typeof v === 'boolean' ? String(v) : lit(v)}`).join(', ');
    const out = commeUtilisateur(d.user, `select to_json(public.${d.name}(${args}))`);
    return out ? JSON.parse(out) : null;
  }
  if (d.kind === 'select') {
    if (!TABLES_OK.test(d.table)) return [];
    const cols = !d.cols || d.cols === '*' ? '*' : d.cols.split(',').map(c => ident(c.trim())).join(', ');
    const where = (d.filters || []).map(f => f.op === 'eq' ? `${ident(f.k)}::text = ${lit(f.v)}` : `${ident(f.k)}::text in (${f.v.length ? f.v.map(lit).join(',') : "''"})`).join(' and ');
    const order = (d.order || []).map(o => `${ident(o.k)} ${o.desc ? 'desc' : 'asc'}`).join(', ');
    const range = d.range ? ` offset ${Number(d.range[0])} limit ${Number(d.range[1]) - Number(d.range[0]) + 1}` : '';
    return JSON.parse(commeUtilisateur(d.user, `select coalesce(json_agg(t), '[]') from (select ${cols} from public.${ident(d.table)}${where ? ' where ' + where : ''}${order ? ' order by ' + order : ''}${range}) t`) || '[]');
  }
  throw new Error('demande inconnue');
}
function serveur() {
  return createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/__pont' && req.method === 'POST') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        let corps; try { corps = { data: pont(JSON.parse(b)), error: null }; } catch (e) { corps = { data: null, error: { message: e.message } }; }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(corps));
      }); return;
    }
    let file = normalize(join(ROOT, p)); if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end('missing'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(file));
  });
}
const STUB = String.raw`
(function(){
  'use strict';
  function user(){ try { return localStorage.getItem('carto_e2e_user') || '${U.auh_bro}'; } catch(e){ return '${U.auh_bro}'; } }
  function appel(d){
    d.user = user();
    if (navigator.onLine === false) return Promise.resolve({ data:null, error:{ message:'Failed to fetch (hors ligne)' } });
    return fetch('/__pont', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(d) }).then(function(r){ return r.json(); })
      .then(function(x){ return x.error ? { data:null, error:x.error, status:400 } : { data:x.data, error:null, status:200 }; })
      .catch(function(e){ return { data:null, error:{ message:'Failed to fetch: ' + e.message } }; });
  }
  window.__cartoLots = [];
  function query(table){
    var d = { kind:'select', table:table, cols:'*', filters:[], order:[], range:null }, un = false;
    var q = { select:function(c){ d.cols = c || '*'; return q; }, eq:function(k,v){ d.filters.push({op:'eq',k:k,v:v}); return q; }, in:function(k,v){ d.filters.push({op:'in',k:k,v:v}); return q; },
      order:function(k,o){ d.order.push({k:k,desc:!!(o&&o.ascending===false)}); return q; }, range:function(a,b){ d.range=[a,b]; return q; }, limit:function(n){ d.range=[0,n-1]; return q; },
      neq:function(){return q;}, is:function(){return q;}, not:function(){return q;}, or:function(){return q;}, like:function(){return q;}, ilike:function(){return q;}, gte:function(){return q;}, lte:function(){return q;}, gt:function(){return q;}, lt:function(){return q;}, contains:function(){return q;},
      insert:function(){ return Promise.resolve({data:null,error:null}); }, update:function(){return q;}, upsert:function(){return q;}, delete:function(){return q;},
      single:function(){ un = true; return fin(); }, maybeSingle:function(){ un = true; return fin(); }, then:function(ok,ko){ return fin().then(ok,ko); } };
    function fin(){ return appel(d).then(function(x){ if (x.error) return x; return { data: un ? ((x.data||[])[0] || null) : x.data, error:null, status:200 }; }); }
    return q;
  }
  var client = {
    auth:{ getSession:function(){ return Promise.resolve({ data:{ session:{ user:{ id:user(), email:'fictif@example.invalid' }, access_token:'fictif' } }, error:null }); },
      getUser:function(){ return Promise.resolve({ data:{ user:{ id:user(), email:'fictif@example.invalid' } }, error:null }); },
      signOut:function(){ return Promise.resolve({data:null,error:null}); }, signInWithPassword:function(){ return Promise.resolve({data:{session:{user:{id:user()}}},error:null}); },
      onAuthStateChange:function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; }, refreshSession:function(){ return this.getSession(); } },
    from:query,
    rpc:function(name,args){ if (/^(plot_map|pheno)_/.test(name)) { if (name==='plot_map_sync_batch') window.__cartoLots.push(JSON.parse(JSON.stringify(args.p_operations))); return appel({ kind:'rpc', name:name, args:args||{} }); } return Promise.resolve({ data:null, error:null }); },
    storage:{ from:function(){ return { upload:function(){ return Promise.resolve({data:null,error:null}); }, list:function(){ return Promise.resolve({data:[],error:null}); }, createSignedUrl:function(){ return Promise.resolve({data:null,error:null}); } }; } },
    channel:function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; }, removeChannel:function(){}
  };
  Object.defineProperty(window,'supabase',{ value:{ createClient:function(){ return client; } }, writable:false, configurable:false });
})();`;

/* ---------- déroulé ---------- */
const R = [], erreurs = []; let page, ctx;
function note(id, famille, libelle, ok, detail) { R.push({ id, famille, libelle, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', detail: String(detail ?? '').slice(0, 300) }); console.log((ok ? 'RÉUSSI  ' : 'ÉCHOUÉ  ') + id + ' ' + libelle + (ok ? '' : ' — ' + String(detail ?? '').slice(0, 220))); }
async function verifier(id, famille, libelle, fn) { try { const r = await fn(); note(id, famille, libelle, r === true || (r && r.ok), r && r.detail !== undefined ? r.detail : r); } catch (e) { note(id, famille, libelle, false, e.message); } }
const egal = (a, b) => ({ ok: JSON.stringify(a) === JSON.stringify(b), detail: `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}` });
const texte = () => page.evaluate(() => (document.getElementById('opsRouteView') || {}).innerText || '');
const attendre = (t, ms = 20000) => page.waitForFunction(x => { const r = document.getElementById('opsRouteView'); return r && r.innerText && r.innerText.indexOf(x) >= 0; }, t, { timeout: ms });
const base = `http://127.0.0.1:${PORT}/operations/field-buying.html`;
function brancher() {
  page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && /PARCELLES|parcelles|plot_map|Leaflet|geodesic/i.test(m.text())) erreurs.push('console: ' + m.text()); });
}
async function ouvrir(hash, user, largeur = 390, hauteur = 844) {
  if (page) await page.close().catch(() => {});
  page = await ctx.newPage(); await page.setViewportSize({ width: largeur, height: hauteur }); brancher();
  if (user) await ctx.addInitScript(u => { try { localStorage.setItem('carto_e2e_user', u); } catch (e) {} }, U[user]);
  for (let essai = 0; essai < 3; essai++) {
    try {
      await page.goto(base + '#' + hash, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForFunction(() => window.ANAGROCI_AUTH && window.ANAGROCI_PARCELLES && document.querySelector('#opsRouteView .ops-route-head'), null, { timeout: 30000 });
      await page.waitForTimeout(900);
      await page.waitForFunction(() => document.querySelector('#opsRouteView .ops-route-head') && !/Chargement/.test(document.getElementById('opsRouteView').innerText.slice(0, 200)), null, { timeout: 30000 });
      return;
    } catch (e) { if (essai === 2) throw e; await page.waitForTimeout(1000).catch(() => {}); }
  }
}
async function capture(nom) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: join(OUT, nom + '.png'), fullPage: true }); }
async function fileVidee(ms = 30000) { const fin = Date.now() + ms; for (;;) { const n = await page.evaluate(async () => { const l = await ANAGROCI_PARCELLES_LOCAL.file.toutes(); return l.filter(o => o.etat === 'ATTENTE' || o.etat === 'ENVOI').length; }); if (!n) return; if (Date.now() > fin) throw new Error('file non vidée'); await page.waitForTimeout(400); } }
function point(x, y) { const d = Math.hypot(x, y), az = Math.atan2(x, y) * 180 / Math.PI; const r = G.Direct(7.7003, -5.0297, az, d); return { latitude: r.lat2, longitude: r.lon2 }; }
const F = 'Parcours terrain', S = 'Synchronisation', V = 'Validation', P = 'Pilotage', X = 'Sécurité', A = 'Affichage';

async function main() {
  construire();
  const srv = serveur(); await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CARTO_E2E_CHROME || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), args: ['--no-sandbox'] });
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', geolocation: { ...point(0, 0), accuracy: 6 }, permissions: ['geolocation'], acceptDownloads: true });
  await ctx.addInitScript({ content: STUB });
  await ctx.route(/https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|tile\.openstreetmap\.org|ibasemaps-api\.arcgis\.com)\/.*/, async route => {
    const u = route.request().url();
    if (/leaflet@1\.9\.4\/dist\/leaflet(\.min)?\.js/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(join(LEAFLET, 'leaflet.js')) });
    if (/leaflet@1\.9\.4\/dist\/leaflet(\.min)?\.css/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: readFileSync(join(LEAFLET, 'leaflet.css')) });
    if (/tile\.openstreetmap|arcgis/.test(u)) { erreurs.push('TUILE DEMANDÉE ALORS QU\'AUCUN FOND N\'EST ACTIVÉ : ' + u); return route.fulfill({ status: 404, body: '' }); }
    if (/\.css(?:\?|$)|fonts\.googleapis/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: '/* test */' });
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* dépendance externe neutralisée */' });
  });
  try {
    /* ----- A. Fonction désactivée par défaut ----- */
    await ouvrir('parcelles', 'auh_bro');
    await verifier('E2E-01', A, 'Entrée « Parcelles & cartographie » dans la navigation unique (espace Réseau)', async () => (await page.locator('a[href$="#parcelles"]').count()) >= 1);
    await verifier('E2E-02', A, 'Fonction désactivée par défaut : bandeau explicite, aucune action de saisie', async () => { await page.waitForFunction(() => /pas encore activés/i.test((document.getElementById('opsRouteView') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {}); const t = await texte(); return { ok: /pas encore activés/i.test(t), detail: t.slice(0, 300) }; });
    await page.evaluate(id => { location.hash = 'parcelles/p/' + id; }, PL.A); await attendre('Point GPS de référence').catch(() => attendre('Champ non localisé'));
    await verifier('E2E-03', X, 'Désactivée : bouton « Localiser mon champ » absent', async () => (await page.locator('[data-pc="localiser"]').count()) === 0);
    activer({ localisation: true, contours: true, clusters_pilotes: ['BROBO'] });

    /* ----- B. Accueil et périmètre ----- */
    await ouvrir('parcelles', 'auh_bro');
    await verifier('E2E-04', A, 'Pilote BROBO annoncé', async () => /pilote pour : BROBO/i.test(await texte()));
    await verifier('E2E-05', X, 'Liste : seulement les parcelles du cluster de l\'agent (3 BROBO, aucune BOTRO)', async () => { const t = await texte(); return { ok: /3 parcelle\(s\)/.test(t) && !/CHARLIE/.test(t), detail: t.slice(0, 400) }; });
    await verifier('E2E-06', A, 'Accès rapide aux parcelles non localisées', async () => { await page.locator('[data-pc="filtre"][data-v="NON_LOCALISEE"]').click(); await page.waitForTimeout(500); return /3 parcelle\(s\)/i.test(await texte()); });
    await capture('01-accueil-390');

    /* ----- C. Consentement ----- */
    await page.evaluate(id => { location.hash = 'parcelles/p/' + id; }, PL.N); await attendre('Consentement GPS');
    await verifier('E2E-07', X, 'Producteur sans consentement GPS : message clair, aucun bouton de localisation ni de tracé', async () => (await page.locator('[data-pc="localiser"]').count()) === 0 && (await page.locator('a[href*="/tracer/"]').count()) === 0);

    /* ----- D. Localiser mon champ ----- */
    await page.evaluate(id => { location.hash = 'parcelles/p/' + id; }, PL.A); await attendre('Champ non localisé');
    await page.locator('[data-pc="localiser"]').click(); await attendre('Position obtenue', 30000);
    await verifier('E2E-08', F, 'Localisation sans parcours du contour : précision affichée', async () => /précision 6 m/i.test(await texte()));
    await page.locator('[data-pc="enregistrer-point"]').click(); await attendre('Point GPS de référence', 30000);
    await fileVidee();
    await verifier('E2E-09', S, 'Point reçu par le serveur : statut POINT_CAPTURED en base', async () => egal(psql(`select gps_status||'|'||round(gps_accuracy_m) from farmer_plots where id='${PL.A}'`), 'POINT_CAPTURED|6'));
    await verifier('E2E-10', A, 'Fiche parcelle : point GPS de référence et mention « ne mesure pas sa superficie »', async () => { await ouvrir('parcelles/p/' + PL.A); const t = await texte(); return /Point GPS de référence/.test(t) && /ne mesure pas sa superficie/.test(t); });
    await capture('02-fiche-390');

    /* ----- E. Mesure GPS hors ligne, fermeture brutale, reprise ----- */
    await page.evaluate(id => { location.hash = 'parcelles/tracer/' + id + '/gps'; }, PL.A); await page.waitForSelector('#pcPanneau [data-pc="gps-sommet"]');
    await ctx.setOffline(true);
    const coins = [[0, 0], [110, 0], [110, 90], [0, 90]];
    for (let i = 0; i < 3; i++) {
      await ctx.setGeolocation({ ...point(...coins[i]), accuracy: 5 });
      await page.locator('[data-pc="gps-sommet"]').click();
      await page.waitForFunction(n => document.querySelectorAll('.pc-sommet:not(.pc-milieu)').length === n, i + 1, { timeout: 30000 });
    }
    await verifier('E2E-11', F, 'Hors ligne : 3 sommets GPS posés, superficie calculée sur le téléphone', async () => { const t = await page.locator('#pcPanneau').innerText(); return { ok: /Calcul provisoire sur ce téléphone/i.test(t), detail: t.slice(0, 300) }; });
    await verifier('E2E-12', S, 'Brouillon enregistré sur ce téléphone à chaque sommet', async () => /Enregistré sur ce téléphone/.test(await page.locator('#pcSauve').innerText()));
    /* Fermeture brutale : la page est détruite sans aucune action d'enregistrement, puis rouverte. */
    await page.close(); page = null; await ctx.setOffline(false);
    await ouvrir('parcelles/p/' + PL.A, 'auh_bro');
    await verifier('E2E-13', S, 'Après fermeture brutale : « Reprendre le tracé (3 sommets) » proposé', async () => /Reprendre le tracé \(3 sommets\)/i.test(await texte()));
    await page.evaluate(id => { location.hash = 'parcelles/tracer/' + id + '/gps'; }, PL.A); await page.waitForSelector('[data-pc="gps-sommet"]');
    await ctx.setOffline(true);
    await ctx.setGeolocation({ ...point(...coins[3]), accuracy: 5 }); await page.locator('[data-pc="gps-sommet"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.pc-sommet:not(.pc-milieu)').length === 4, null, { timeout: 30000 });
    const refArea = (() => { const p = G.Polygon(); coins.forEach(c => { const q = point(...c); p.AddPoint(q.latitude, q.longitude); }); return Math.abs(p.Compute(false, true).area); })();
    await verifier('E2E-14', F, 'Superficie affichée = référence géodésique indépendante (0,99 ha, à 0,01 ha près)', async () => { const t = await page.locator('.pc-surface').innerText(); const v = Number(t.replace(' ha', '').replace(',', '.')); return { ok: Math.abs(v - refArea / 10000) < 0.011, detail: `écran ${t}, référence ${(refArea / 10000).toFixed(4)} ha` }; });
    await verifier('E2E-15', F, 'Envoi bloqué tant que la visibilité des limites n\'est pas indiquée', async () => page.locator('[data-pc="envoyer"]').isDisabled());
    await page.locator('input[name=pcConf][value="PARTIELLES"]').check({ force: true }); await page.waitForTimeout(300);
    await capture('03-mesure-gps-390');
    await page.locator('[data-pc="envoyer"]').click(); await attendre('Envois depuis ce téléphone', 30000);
    await verifier('E2E-16', S, 'Hors ligne : « En attente de synchronisation », jamais « Reçu »', async () => { const t = await page.locator('.pc-envoi').first().innerText(); return { ok: /En attente de synchronisation/i.test(t) && /Contour/i.test(t) && !/Reçu par le serveur/i.test(t), detail: t }; });
    await verifier('E2E-17', S, 'Hors ligne : rien n\'est arrivé en base', async () => egal(psql(`select count(*) from farmer_plot_geometries`), '0'));
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online'))); await fileVidee();
    await verifier('E2E-18', S, 'Retour du réseau : contour reçu par le serveur, une seule version', async () => egal(psql(`select count(*)||'|'||min(status)||'|'||min(method) from farmer_plot_geometries where plot_id='${PL.A}'`), '1|SOUMIS|GPS_POINTS'));
    await verifier('E2E-19', S, 'Superficie serveur = superficie du téléphone (écart < 0,01 %)', async () => { const r = psql(`select area_m2||'|'||area_m2_client from farmer_plot_geometries where plot_id='${PL.A}'`).split('|').map(Number); return { ok: Math.abs(r[0] - r[1]) / r[0] < 1e-4, detail: r.join(' / ') }; });
    await page.evaluate(async () => { await ANAGROCI_PARCELLES.synchroniser(true); });
    await verifier('E2E-20', S, 'Synchronisation répétée : aucun doublon', async () => egal(psql(`select count(*) from farmer_plot_geometries`), '1'));
    await verifier('E2E-21', S, 'Brouillon effacé après réception par le serveur', async () => { await ouvrir('parcelles/p/' + PL.A); const t = await texte(); const br = await page.evaluate(async id => JSON.stringify({ br: await ANAGROCI_PARCELLES_LOCAL.brouillon.lire(id), f: (await ANAGROCI_PARCELLES_LOCAL.file.toutes()).map(o => [o.type, o.etat, o.idempotency_key]) }), PL.A); return { ok: !/Reprendre le tracé/i.test(t) && /Reçu par le serveur/i.test(t), detail: br.slice(0, 280) }; });

    /* ----- F. Tracé sur carte (sans imagerie : fond neutre) ----- */
    await page.evaluate(id => { location.hash = 'parcelles/tracer/' + id + '/sat'; }, PL.B); await page.waitForSelector('#pcCarte .leaflet-container, #pcCarte.leaflet-container', { timeout: 20000 });
    await verifier('E2E-22', X, 'Aucune imagerie sans licence : message explicite, aucune tuile demandée', async () => /licence à confirmer/i.test(await texte()) && !erreurs.some(e => /TUILE/.test(e)));
    await page.locator('#pcCarte').scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    for (let z = 0; z < 4; z++) { await page.locator('#pcCarte .leaflet-control-zoom-in').click(); await page.waitForTimeout(450); } const box = await page.locator('#pcCarte').boundingBox();
    for (const [dx, dy] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]) { await page.mouse.click(box.x + box.width * dx, box.y + box.height * dy); await page.waitForTimeout(250); }
    await verifier('E2E-23', F, 'Tracé au doigt : 4 sommets, contour fermé automatiquement, superficie affichée', async () => (await page.locator('.pc-sommet:not(.pc-milieu)').count()) === 4 && /ha/.test(await page.locator('.pc-surface').innerText()));
    await page.locator('.pc-milieu').first().click(); await page.waitForTimeout(250);
    await verifier('E2E-24', F, 'Ajout d\'un sommet sur un côté (« + »)', async () => (await page.locator('.pc-sommet:not(.pc-milieu)').count()) === 5);
    await page.locator('[data-pc="supprimer"]').click(); await page.waitForTimeout(250);
    await verifier('E2E-25', F, 'Suppression du sommet sélectionné', async () => (await page.locator('.pc-sommet:not(.pc-milieu)').count()) === 4);
    await page.locator('[data-pc="annuler"]').click(); await page.waitForTimeout(250);
    await verifier('E2E-26', F, 'Annulation de la dernière action', async () => (await page.locator('.pc-sommet:not(.pc-milieu)').count()) === 5);
    const avant = await page.locator('.pc-surface').innerText(); const trAvant = await page.locator('.pc-sommet:not(.pc-milieu)').nth(1).evaluate(e => e.style.transform);
    const mk = page.locator('.pc-sommet:not(.pc-milieu)').nth(1); await mk.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const mb = await mk.boundingBox();
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.move(mb.x + mb.width / 2 + 6, mb.y + mb.height / 2 + 6, { steps: 3 }); await page.mouse.move(mb.x + 70, mb.y - 50, { steps: 12 }); await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(600);
    await verifier('E2E-27', F, 'Déplacement d\'un sommet : superficie recalculée', async () => { const ap = await page.locator('.pc-surface').innerText(); const trAp = await page.locator('.pc-sommet:not(.pc-milieu)').nth(1).evaluate(e => e.style.transform); return { ok: ap !== avant, detail: avant + ' → ' + ap + ' | ' + trAvant + ' → ' + trAp }; });
    await page.locator('input[name=pcConf][value="VISIBLES"]').check({ force: true }); await page.selectOption('#pcConfirm', 'CONFIRMEE_SUR_PLACE');
    await capture('04-trace-carte-390');
    await page.locator('[data-pc="envoyer"]').click(); await attendre('Envois depuis ce téléphone', 30000); await fileVidee();
    await verifier('E2E-28', S, 'Contour du tracé au doigt reçu (méthode, confiance, confirmation producteur)', async () => { const r = egal(psql(`select method||'|'||boundary_confidence||'|'||producer_confirmation from farmer_plot_geometries where plot_id='${PL.B}'`), 'SATELLITE|VISIBLES|CONFIRMEE_SUR_PLACE'); if (!r.ok) r.detail += ' | file : ' + JSON.stringify(await page.evaluate(async () => (await ANAGROCI_PARCELLES_LOCAL.file.toutes()).map(o => [o.type, o.etat, o.code, o.message]))); return r; });

    /* ----- G. Validation par le Chef de Zone ----- */
    await ouvrir('parcelles/pilotage', 'auh_bro');
    await verifier('E2E-29', X, 'Tableau de bord refusé à l\'assistant (contrôle serveur)', async () => /réservé|Réservé/i.test(await texte()));
    await ouvrir('parcelles/validation', 'zh2');
    await verifier('E2E-30', X, 'Chef de Zone GBEKE 2 : aucun contour BROBO à valider', async () => /Aucun contour en attente/i.test(await texte()));
    await ouvrir('parcelles/validation', 'zh1');
    await verifier('E2E-31', V, 'Chef de Zone GBEKE 1 : 2 contours en attente', async () => (await page.locator('a.pc-ligne').count()) === 2);
    await capture('05-validation-390');
    await page.locator('a.pc-ligne').first().click(); await attendre('Décision');
    await capture('06-verifier-contour-390');
    await page.locator('[data-pc="decider"][data-v="A_CORRIGER"]').click(); await page.waitForTimeout(800);
    await verifier('E2E-32', V, 'Demande de correction sans commentaire refusée par le serveur, message affiché', async () => /Expliquez/i.test(await texte()));
    await page.locator('[data-pc="decider"][data-v="VALIDER"]').click(); await attendre('Contours à valider', 30000);
    await verifier('E2E-33', V, 'Contour validé : parcelle VALIDE en base, superficie validée renseignée, déclaré intact', async () => {
      const r = psql(`select count(*) from farmer_plots where mapping_status='VALIDE' and mapped_area_ha > 0 and declared_area is not null`); return egal(r, '1'); });

    /* ----- H. Pilotage Branch Manager ----- */
    await ouvrir('parcelles/pilotage', 'bm', 1440, 900);
    await verifier('E2E-34', P, 'Tableau de bord BM : 1 validée, 1 soumise, 1 parcelle localisée', async () => {
      const t = await page.evaluate(() => { const o = {}; document.querySelectorAll('.pc-kpi .kpi').forEach(k => { o[k.querySelector('span').innerText] = k.querySelector('b').innerText; }); return o; });
      return { ok: t['Validées'] === '1' && t['Soumises'] === '1' && /^1 \//.test(t['Parcelles localisées']), detail: JSON.stringify(t) }; });
    await verifier('E2E-35', P, 'Somme et emprise unique affichées séparément', async () => /Emprise unique validée/i.test(await texte()) && /Superficie validée \(somme\)/i.test(await texte()));
    await capture('07-pilotage-1440');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('[data-pc="export-csv"]').click()]);
    const contenu = readFileSync(await dl.path(), 'utf8');
    await verifier('E2E-36', P, 'Export CSV : colonnes de superficies distinctes, aucune coordonnée', async () => ({ ok: /Superficie déclarée \(ha\);Superficie cartographiée \(ha\)/.test(contenu) && !/7\.70|latitude/i.test(contenu), detail: contenu.slice(0, 200) }));
    const [dg] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('[data-pc="export-geojson"]').click()]);
    const gj = JSON.parse(readFileSync(await dg.path(), 'utf8'));
    await verifier('E2E-37', P, 'Export GeoJSON : contours validés seulement, avertissement non cadastral', async () => ({ ok: gj.type === 'FeatureCollection' && gj.features.length === 1 && /non cadastrale/.test(gj.features[0].properties.avertissement), detail: gj.features.length }));

    /* ----- I. Affichage aux trois largeurs ----- */
    for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
      await ouvrir('parcelles/p/' + PL.B, 'uh_bro', w, h);
      await verifier('E2E-L' + w, A, `Fiche parcelle à ${w} px : aucun débordement horizontal`, async () => { const r = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); return { ok: r[0] <= r[1] + 1, detail: r.join(' / ') }; });
      await capture('08-fiche-validee-' + w);
    }
    await verifier('E2E-99', A, 'Aucune erreur JavaScript de la rubrique pendant le parcours', async () => ({ ok: erreurs.length === 0, detail: erreurs.slice(0, 5).join(' | ') }));
  } finally {
    await browser.close(); srv.close();
    mkdirSync(OUT, { recursive: true });
    const ok = R.filter(r => r.resultat === 'RÉUSSI').length;
    writeFileSync(join(OUT, 'navigateur.json'), JSON.stringify({ total: R.length, reussis: ok, echoues: R.length - ok, erreurs, tests: R }, null, 1));
    console.log(`Navigateur cartographie : ${R.length} tests, ${ok} réussis, ${R.length - ok} échoués.`);
    process.exitCode = ok === R.length ? 0 : 1;
  }
}
main().catch(e => { console.error(e); process.exit(1); });
