#!/usr/bin/env node
/**
 * OBSERVATOIRE AGRONOMIQUE AFLP 2027 — test navigateur de bout en bout.
 * Vrai navigateur (Chromium), vraie page FIELD BUYING, vrai Service Worker, vraie base
 * PostgreSQL LOCALE avec les migrations de l'Observatoire et la RLS active.
 * Données 100 % fictives. Aucune connexion à Supabase : le client Supabase est remplacé par
 * un pont local qui exécute chaque lecture et chaque RPC SOUS LE RÔLE `authenticated`,
 * avec l'identité du compte fictif choisi. Refuse toute cible Supabase.
 *
 * Usage : PGHOST=127.0.0.1 PGPORT=54329 node tests/observatoire/observatoire-e2e.mjs
 * Prérequis : base fbms_pheno_e2e construite par executer_tests_observatoire.sh (variable OBS_E2E=1).
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
const C = require('../../shared/observatoire-coeur.js');

const ROOT = process.cwd(), ICI = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.PGHOST || '', PGPORT = process.env.PGPORT || '', DB = process.env.OBS_E2E_DB || 'fbms_pheno_e2e';
if (!HOST || /supabase/i.test(HOST)) { console.error('REFUS : cible absente ou Supabase détectée'); process.exit(2); }
const PORT = Number(process.env.PORT_OBS_E2E || 4347);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const U = { bm: '00000000-0000-4000-8000-0000000000a1', zh1: '00000000-0000-4000-8000-0000000000a2', uh_bro: '00000000-0000-4000-8000-0000000000a3',
  auh_bro: '00000000-0000-4000-8000-0000000000a4', uh_bot: '00000000-0000-4000-8000-0000000000a5', rt: '00000000-0000-4000-8000-0000000000a6' };
const CAMP = '10000000-0000-4000-8000-000000000001';

/* ---------- pont PostgreSQL local ---------- */
function psql(sql) {
  const r = spawnSync('psql', ['-h', HOST, '-p', PGPORT, '-U', 'postgres', '-d', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) { const l = (r.stderr || '').split('\n').find(x => x.includes('ERROR')) || r.stderr || 'erreur'; throw new Error(l.split('ERROR:').pop().trim()); }
  return r.stdout.trim();
}
const lit = v => v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const ident = v => { if (!/^[a-z_][a-z0-9_]*$/.test(v)) throw new Error('identifiant refusé : ' + v); return v; };
const TABLES_OK = /^(pheno_[a-z_]+|farmer_plots|villages|producteurs|profils|campaigns|aflp_clusters|aflp_zones)$/;
function commeUtilisateur(user, sql) {
  const claims = JSON.stringify({ sub: user, role: 'authenticated' });
  const out = psql(`begin;\n\\o /dev/null\nset local role authenticated; select set_config('request.jwt.claims','${claims}',true); select set_config('request.jwt.claim.sub','${user}',true);\n\\o\n${sql};\ncommit;`);
  return out;   // json_agg peut s'étaler sur plusieurs lignes : on garde toute la sortie
}
function pont(d) {
  if (!Object.values(U).includes(d.user)) throw new Error('compte fictif inconnu');
  if (d.kind === 'rpc') {
    if (!/^pheno_[a-z_]+$/.test(d.name)) return [];
    const args = Object.entries(d.args || {}).map(([k, v]) => `${ident(k)} => ${typeof v === 'object' && v !== null ? lit(JSON.stringify(v)) + '::jsonb' : typeof v === 'number' ? Number(v) : lit(v)}`).join(', ');
    const setof = ['pheno_observateurs_du_cluster', 'pheno_parcelles_disponibles'].includes(d.name);
    const out = commeUtilisateur(d.user, setof ? `select coalesce(json_agg(t), '[]') from public.${d.name}(${args}) t` : `select to_json(public.${d.name}(${args}))`);
    return out ? JSON.parse(out) : null;
  }
  if (d.kind === 'select') {
    if (!TABLES_OK.test(d.table)) return [];
    const cols = !d.cols || d.cols === '*' ? '*' : d.cols.split(',').map(c => ident(c.trim())).join(', ');
    const where = (d.filters || []).map(f => f.op === 'eq' ? `${ident(f.k)}::text = ${lit(f.v)}` : `${ident(f.k)}::text in (${f.v.length ? f.v.map(lit).join(',') : "''"})`).join(' and ');
    const order = (d.order || []).map(o => `${ident(o.k)} ${o.desc ? 'desc' : 'asc'}`).join(', ');
    const range = d.range ? ` offset ${Number(d.range[0])} limit ${Number(d.range[1]) - Number(d.range[0]) + 1}` : '';
    const out = commeUtilisateur(d.user, `select coalesce(json_agg(t), '[]') from (select ${cols} from public.${ident(d.table)}${where ? ' where ' + where : ''}${order ? ' order by ' + order : ''}${range}) t`);
    return JSON.parse(out || '[]');
  }
  if (d.kind === 'depot') { commeUtilisateur(d.user, `insert into storage.objects (bucket_id, name, owner) values ('pheno-preuves', ${lit(d.path)}, ${lit(d.user)})`); return { path: d.path }; }
  throw new Error('demande inconnue');
}
function serveur() {
  return createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/__pont' && req.method === 'POST') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        let corps;
        try { corps = { data: pont(JSON.parse(b)), error: null }; } catch (e) { corps = { data: null, error: { message: e.message }, status: 400 }; }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(corps));
      }); return;
    }
    let file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end('missing'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(file));
  });
}

/* ---------- faux client Supabase : tout passe par le pont, sous l'identité fictive courante ---------- */
const STUB = String.raw`
(function(){
  'use strict';
  function user(){ try { return localStorage.getItem('obs_e2e_user') || '${U.auh_bro}'; } catch(e){ return '${U.auh_bro}'; } }
  function appel(d){
    d.user = user();
    if (navigator.onLine === false) return Promise.resolve({ data:null, error:{ message:'Failed to fetch (hors ligne)' } });
    return fetch('/__pont', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(d) }).then(function(r){ return r.json(); })
      .then(function(x){ return x.error ? { data:null, error:x.error, status:x.status||400 } : { data:x.data, error:null, status:200 }; })
      .catch(function(e){ return { data:null, error:{ message:'Failed to fetch: ' + e.message } }; });
  }
  window.__obsAppels = { rpc:0, lots:[] };
  function query(table){
    var d = { kind:'select', table:table, cols:'*', filters:[], order:[], range:null }, un = false;
    var q = {
      select:function(c){ d.cols = c || '*'; return q; }, eq:function(k,v){ d.filters.push({op:'eq',k:k,v:v}); return q; }, in:function(k,v){ d.filters.push({op:'in',k:k,v:v}); return q; },
      order:function(k,o){ d.order.push({k:k,desc:!!(o&&o.ascending===false)}); return q; }, range:function(a,b){ d.range=[a,b]; return q; }, limit:function(n){ d.range=[0,n-1]; return q; },
      neq:function(){return q;}, is:function(){return q;}, not:function(){return q;}, or:function(){return q;}, like:function(){return q;}, ilike:function(){return q;}, gte:function(){return q;}, lte:function(){return q;}, gt:function(){return q;}, lt:function(){return q;}, contains:function(){return q;},
      insert:function(){ return Promise.resolve({data:null,error:null}); }, update:function(){return q;}, upsert:function(){return q;}, delete:function(){return q;},
      single:function(){ un = true; return fin(); }, maybeSingle:function(){ un = true; return fin(); }, then:function(ok,ko){ return fin().then(ok,ko); }
    };
    function fin(){ return appel(d).then(function(x){ if (x.error) return x; return { data: un ? (x.data[0] || null) : x.data, error:null, status:200 }; }); }
    return q;
  }
  var client = {
    auth:{ getSession:function(){ return Promise.resolve({ data:{ session:{ user:{ id:user(), email:'fictif@example.invalid' }, access_token:'fictif' } }, error:null }); },
      getUser:function(){ return Promise.resolve({ data:{ user:{ id:user(), email:'fictif@example.invalid' } }, error:null }); },
      signOut:function(){ return Promise.resolve({data:null,error:null}); }, signInWithPassword:function(){ return Promise.resolve({data:{session:{user:{id:user()}}},error:null}); },
      onAuthStateChange:function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; } },
    from:query,
    rpc:function(name,args){ if (/^pheno_/.test(name)) { window.__obsAppels.rpc++; if (name==='pheno_sync_batch') window.__obsAppels.lots.push(JSON.parse(JSON.stringify(args.p_operations))); return appel({ kind:'rpc', name:name, args:args||{} }); } return Promise.resolve({ data:[], error:null }); },
    storage:{ from:function(b){ return { upload:function(path){ return b==='pheno-preuves' ? appel({ kind:'depot', path:path }) : Promise.resolve({data:null,error:null}); }, list:function(){ return Promise.resolve({data:[],error:null}); }, getPublicUrl:function(){ return {data:{publicUrl:''}}; } }; } },
    channel:function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; }, removeChannel:function(){}
  };
  Object.defineProperty(window,'supabase',{ value:{ createClient:function(){ return client; } }, writable:false, configurable:false });
})();`;

/* ---------- déroulé ---------- */
const R = [], erreurs = []; let page, ctx;
function note(id, famille, libelle, ok, detail) { R.push({ id, famille, libelle, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', detail: String(detail ?? '').slice(0, 300) }); console.log((ok ? 'RÉUSSI  ' : 'ÉCHOUÉ  ') + id + ' ' + libelle + (ok ? '' : ' — ' + String(detail ?? '').slice(0, 300))); }
async function verifier(id, famille, libelle, fn) { try { const r = await fn(); note(id, famille, libelle, r === undefined || r === true || (r && r.ok), r && r.detail !== undefined ? r.detail : r); } catch (e) { note(id, famille, libelle, false, e.message); } }
const egal = (a, b) => ({ ok: JSON.stringify(a) === JSON.stringify(b), detail: `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}` });
const texte = () => page.evaluate(() => document.getElementById('opsRouteView').innerText);
const attendre = (t, ms = 15000) => page.waitForFunction(x => (document.getElementById('opsRouteView') || {}).innerText && document.getElementById('opsRouteView').innerText.includes(x), t, { timeout: ms });
const base = `http://127.0.0.1:${PORT}/operations/field-buying.html`;
function brancher() {
  page.on('pageerror', e => { erreurs.push(e.message); if (process.env.OBS_E2E_DEBUG) console.log('  pageerror:', e.message); });
  page.on('console', m => { if (m.type() === 'error' && /observatoire|OBSERVATOIRE|pheno/i.test(m.text())) { erreurs.push(m.text()); if (process.env.OBS_E2E_DEBUG) console.log('  console:', m.text()); } });
}
/* Ouvre une page NEUVE (comme un agent qui rouvre l'application), sous l'identité fictive voulue.
   FIELD BUYING se recharge une fois de lui-même quand il découvre la campagne : on attend que ce soit fait. */
async function ouvrir(hash, user) {
  if (page) await page.close().catch(() => {});
  page = await ctx.newPage(); brancher();
  if (user) await ctx.addInitScript(u => { try { localStorage.setItem('obs_e2e_user', u); } catch (e) {} }, U[user]);
  for (let essai = 0; essai < 3; essai++) {
    try {
      await page.goto(base + '#' + hash, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForFunction(() => window.ANAGROCI_AUTH && window.ANAGROCI_OBSERVATOIRE && document.querySelector('#opsRouteView .obs'), null, { timeout: 25000 });
      if (await page.evaluate(() => navigator.onLine)) await page.waitForFunction(() => window.ANAGROCI_CAMPAIGN && ANAGROCI_CAMPAIGN.id(), null, { timeout: 15000 });
      await page.waitForTimeout(600);
      await page.waitForFunction(() => window.ANAGROCI_AUTH && document.querySelector('#opsRouteView .obs'), null, { timeout: 25000 });
      return;
    } catch (e) { if (essai === 2) throw e; await page.waitForTimeout(800).catch(() => {}); }
  }
}
/* Attend que toutes les opérations aient reçu une réponse du serveur (reçue, conflit ou refus). */
async function fileVide(ms = 30000) { const fin = Date.now() + ms; for (;;) { const n = await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.enAttente()).length); if (n === 0) return; if (Date.now() > fin) throw new Error('file d’envoi non vidée : ' + n + ' en attente'); await page.waitForTimeout(250); } }
/* waitForFunction ne sait pas attendre une promesse : sondage explicite d'une condition asynchrone. */
async function sonder(fn, msg, ms = 30000) { const fin = Date.now() + ms; for (;;) { if (await page.evaluate(fn)) return; if (Date.now() > fin) throw new Error(msg); await page.waitForTimeout(250); } }
const clic = async (sel) => { await page.locator(sel).first().click(); };
const dialogueOk = async () => { await page.locator('.obs-dialogue .btn.primary').click(); };
const F = 'Parcours terrain', S = 'Synchronisation', X = 'Sécurité', V = 'Validation', G = 'Affichage', N = 'Non-régression';

async function main() {
  const srv = serveur(); await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: process.env.OBS_E2E_CHANNEL || undefined, executablePath: process.env.OBS_E2E_CHROME || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), args: ['--no-sandbox'] });
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', geolocation: { latitude: 7.6901, longitude: -5.0303, accuracy: 6 }, permissions: ['geolocation'] });
  await ctx.addInitScript({ content: STUB });
  await ctx.route(/https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\/.*/, async route => {
    const u = route.request().url();
    if (/\.css(?:\?|$)|fonts\.googleapis/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: '/* test */' });
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* dépendance externe neutralisée */' });
  });

  try {
    /* ----- A. Assistant Unit Head, en ligne : menu, préparation ----- */
    await ouvrir('observatoire', 'auh_bro');
    await verifier('E2E-01', F, 'Entrée « Observatoire agronomique » dans la navigation unique V2.2 (menu Terrain)', async () => (await page.locator('a[href$="#observatoire"]').count()) >= 1 && /Observatoire agronomique/.test(await page.locator('body').innerText()));
    await verifier('E2E-02', F, 'Bandeau pilote : aucun indicateur officiel', async () => /Collecte pilote/.test(await texte()) && /aucun indicateur officiel/.test(await texte()));
    await verifier('E2E-03', F, 'Onglets de l’Assistant Unit Head : collecte seulement (ni Validation ni Affectations)', async () => egal(await page.locator('.obs-onglets a').allInnerTexts(), ['Mes champs', 'Envois']));
    await clic('[data-act="preparer"]'); await attendre('Appareil prêt');
    await verifier('E2E-04', F, 'Préparation hors-ligne : seules les 2 parcelles du cluster de l’agent sont copiées sur l’appareil', async () => /2 parcelle/.test(await texte()));
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
    await ouvrir('observatoire');   // 2e ouverture en ligne : la page et les scripts du module sont maintenant dans le cache du Service Worker

    /* ----- B. Mode avion : installation, tirage, inventaire, visite ----- */
    await ctx.setOffline(true);
    await verifier('E2E-05', F, 'Hors ligne : l’application fermée puis rouverte se recharge depuis le cache, module compris', async () => { await ouvrir('observatoire'); return /Mes champs/.test(await texte()); });
    await page.evaluate(() => { location.hash = 'observatoire/installer'; }); await page.waitForSelector('#obsInstall');
    await verifier('E2E-06', F, 'Installation : seules les parcelles du cluster de l’agent sont proposées', async () => egal((await page.locator('#obsPlot option').allInnerTexts()).filter(x => /FICTI/.test(x)).length, 2));
    await page.selectOption('#obsPlot', '20000000-0000-4000-8000-000000000001');
    await page.fill('#obsB', '4'); await page.fill('#obsb', '2');
    for (let i = 1; i <= 4; i++) await page.fill('#obsRep' + i, 'REPÈRE FICTIF ' + i);
    await clic('#obsInstall button[type=submit]'); await page.waitForSelector('.obs-dialogue');
    await verifier('E2E-07', F, 'Avertissement avant verrouillage : b ne pourra plus être changé', async () => /définitif/.test(await page.locator('.obs-dialogue').innerText()));
    await dialogueOk(); await attendre('Tirage verrouillé');
    const panel = await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.panels())[0]);
    const tires = C.tirage('ab'.repeat(32) + ':' + panel.plot_id + ':BLOCS', 4, 2);
    await verifier('E2E-08', F, 'Blocs tirés hors ligne = tirage reproductible (recalcul indépendant)', async () => egal(panel.blocs.filter(b => b.tire).sort((a, b) => a.rang_tirage - b.rang_tirage).map(b => b.numero), tires));
    await verifier('E2E-09', S, 'Hors ligne : « Non encore sauvegardée sur le serveur » affiché, jamais « reçu »', async () => /Non encore sauvegardée sur le serveur/.test(await texte()) && !/reçu par le serveur le/.test(await texte()));
    for (const [num, n] of [[tires[0], 7], [tires[1], 9]]) { await page.fill('#obsInv' + num, String(n)); await clic(`[data-act="inventaire"][data-num="${num}"]`); await page.waitForSelector('.obs-dialogue'); await dialogueOk(); await page.waitForFunction(k => !document.getElementById('obsInv' + k), num); }
    await attendre('Arbres marqués');
    const p2 = await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.panels())[0]);
    await verifier('E2E-10', F, 'Après inventaire : 10 titulaires et 2 réserves tirés hors ligne, codes permanents', async () => egal([p2.arbres.filter(a => a.role === 'TITULAIRE').length, p2.arbres.filter(a => a.role === 'RESERVE').length, new Set(p2.arbres.map(a => a.code)).size], [10, 2, 12]));
    await verifier('E2E-11', F, 'Inventaire non modifiable à l’écran après enregistrement', async () => (await page.locator('[data-act="inventaire"]').count()) === 0);
    await clic('[data-act="marquer"]'); await attendre('Position enregistrée');
    await verifier('E2E-12', F, 'Marquage GPS d’un arbre enregistré sur l’appareil', async () => /précision 6 m/.test(await texte()));

    await page.evaluate(id => { location.hash = 'observatoire/visite/' + id + '/nouvelle'; }, panel.id); await page.waitForSelector('.obs-arbre');
    await verifier('E2E-13', F, 'Visite : aucune réponse présélectionnée à l’ouverture', async () => (await page.locator('.obs-choix button[aria-checked="true"]').count()) === 0);
    await verifier('E2E-14', F, 'Visite : dix arbres 01 à 10 (réserves exclues)', async () => egal(await page.locator('.obs-pastilles button').allInnerTexts(), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']));
    const rep = async (champ, val) => { await clic(`.obs-choix button[data-champ="${champ}"][data-val="${val}"]`); await page.waitForFunction(([c, v]) => { const b = document.querySelector(`.obs-choix button[data-champ="${c}"][data-val="${v}"]`); return b && b.getAttribute('aria-checked') === 'true'; }, [champ, val]); };
    for (let i = 0; i < 10; i++) {
      await page.waitForFunction(k => document.querySelector('.obs-numero') && document.querySelector('.obs-numero').innerText === ('0' + (k + 1)).slice(-2), i);
      if (i === 9) { await rep('retrouve', 'false'); await rep('pas_vu_motif', 'Marque effacée ou arbre introuvable'); }
      else {
        await rep('retrouve', 'true'); await rep('f', i < 3 ? 'OUI' : 'NON'); await rep('n', i === 4 ? 'PAS_VU' : 'NON'); await rep('p', 'NON');
        if (i === 1) { await rep('chute', 'MURE'); await rep('chute_preuve', 'VUE_AGENT'); } else if (i === 2) { await rep('chute', 'PREMATUREE'); await rep('chute_preuve', 'DECLAREE_PRODUCTEUR'); } else await rep('chute', 'ABSENCE');
        if (i === 4) await rep('pas_vu_motif', 'Branches trop hautes');
      }
      if (i === 0) await verifier('E2E-15', F, 'Résumé inaccessible à la soumission tant que la visite est incomplète', async () => { await page.evaluate(() => { location.hash += '/resume'; }); await page.waitForSelector('[data-act="soumettre"]'); const d = await page.locator('[data-act="soumettre"]').isDisabled(); await clic('[data-act="aller"][data-i="0"]'); await page.waitForSelector('.obs-arbre'); return d; });
      if (i < 9) await clic('[data-act="suiv"]'); else await clic('[data-act="resume"]');
    }
    await page.waitForSelector('[data-act="soumettre"]');
    await verifier('E2E-16', F, 'Soumission encore bloquée : question du ramassage sans réponse', async () => page.locator('[data-act="soumettre"]').isDisabled());
    await clic('.obs-choix button[data-act="repv"][data-val="NON"]'); await page.waitForFunction(() => { const b = document.querySelector('[data-act="soumettre"]'); return b && !b.disabled; });
    await clic('[data-act="soumettre"]'); await attendre('Non encore sauvegardé sur le serveur');
    await verifier('E2E-17', S, 'Visite terminée hors ligne : « Enregistré sur ce téléphone. Non encore sauvegardé sur le serveur. »', async () => /Enregistré sur ce téléphone/.test(await texte()));
    await verifier('E2E-18', S, 'Hors ligne : rien n’est arrivé en base (0 champ, 0 visite)', async () => egal(psql('select (select count(*) from pheno_panels) + (select count(*) from pheno_visites)'), '0'));
    await page.evaluate(() => { location.hash = 'observatoire/envois'; }); await attendre('Ce qui est sur ce téléphone');
    await verifier('E2E-19', S, 'File d’envoi : 5 opérations en attente, aucune « reçue »', async () => { const l = await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.file()).map(o => o.statut)); return egal([l.length, l.filter(s => s === 'RECU').length], [5, 0]); });
    await ouvrir('observatoire/envois');
    await verifier('E2E-20', S, 'La file survit à la fermeture et à la réouverture de l’application hors ligne', async () => egal(await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.file()).length), 5));

    /* ----- C. Retour du réseau : envoi, accusés serveur, idempotence ----- */
    await ctx.setOffline(false);
    await fileVide();
    await verifier('E2E-21', S, 'Retour du réseau : envoi automatique, 5 accusés de réception du serveur', async () => { const l = await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.file()).map(o => [o.statut, !!o.recu_serveur_le])); const m = await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.file()).map(o => o.statut + ':' + (o.dernier_message || '')).join(' ; ')); return { ok: l.filter(x => x[0] === 'RECU' && x[1]).length === 5, detail: m }; });
    await verifier('E2E-22', S, 'Serveur : champ actif, mêmes blocs tirés que hors ligne', async () => egal(psql(`select statut || '|' || (select string_agg(numero::text, ',' order by rang_tirage) from pheno_blocs where panel_id = p.id and tire) from pheno_panels p where id = '${panel.id}'`), 'ACTIF|' + tires.join(',')));
    await verifier('E2E-23', S, 'Serveur : mêmes arbres (identifiants et codes) que ceux tirés hors ligne', async () => egal(psql(`select string_agg(id::text || ':' || code, ',' order by id) from pheno_arbres where panel_id = '${panel.id}'`), p2.arbres.map(a => a.id + ':' + a.code).sort().join(',')));
    await verifier('E2E-24', S, 'Serveur : visite SOUMISE, 10 observations, trois dates, appareil tracé', async () => egal(psql(`select statut || '|' || (select count(*) from pheno_observations o where o.visite_id = v.id) || '|' || (date_observation is not null and saisie_le is not null and recu_serveur_le is not null) || '|' || (device_id is not null) from pheno_visites v`), 'SOUMIS|10|true|true'));
    await verifier('E2E-25', S, 'Serveur : réponses conformes à la saisie (3 F Oui, 1 mûre vue, 1 prématurée déclarée, 1 non retrouvé sans stade)', async () => egal(psql(`select count(*) filter (where f = 'OUI') || '|' || count(*) filter (where chute = 'MURE' and chute_preuve = 'VUE_AGENT') || '|' || count(*) filter (where chute = 'PREMATUREE' and chute_preuve = 'DECLAREE_PRODUCTEUR') || '|' || count(*) filter (where retrouve is false and f is null and chute is null) from pheno_observations`), '3|1|1|1'));
    await verifier('E2E-26', S, 'Serveur : marquage GPS reçu', async () => egal(psql('select count(*) from pheno_arbres where latitude is not null'), '1'));
    const lotsAvant = await page.evaluate(() => window.__obsAppels.lots.length);
    await page.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('anagroci_observatoire'); q.onsuccess = () => r(q.result); }); const l = await ANAGROCI_OBS_LOCAL.file();
      await new Promise(r => { const t = db.transaction('file', 'readwrite'); l.forEach(o => { o.statut = 'EN_ATTENTE'; t.objectStore('file').put(o); }); t.oncomplete = r; }); await ANAGROCI_OBSERVATOIRE.synchroniser(true); });
    await verifier('E2E-27', S, 'Renvoi forcé des 5 mêmes opérations : aucun doublon en base', async () => egal(psql('select (select count(*) from pheno_panels) || \'|\' || (select count(*) from pheno_visites) || \'|\' || (select count(*) from pheno_observations) || \'|\' || (select count(*) from pheno_arbres)'), '1|1|10|12'));
    await verifier('E2E-28', S, 'Renvoi : le serveur a bien été rappelé et a répondu « rejoué »', async () => { const r = await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.file()).map(o => [o.statut, !!(o.reponse && o.reponse.rejoue)])); const n = await page.evaluate(() => window.__obsAppels.lots.length); return { ok: n > lotsAvant && r.every(x => x[0] === 'RECU' && x[1]), detail: JSON.stringify(r) }; });
    await page.evaluate(id => { location.hash = 'observatoire/champ/' + id; }, panel.id); await attendre('Visites');
    await verifier('E2E-29', S, 'Fiche du champ : visite « Soumis », « Reçue par le serveur le … »', async () => /Soumis/.test(await texte()) && /Reçue par le serveur le/.test(await texte()));
    const vid = psql('select id from pheno_visites');
    await page.evaluate(([p, v]) => { location.hash = 'observatoire/visite/' + p + '/' + v; }, [panel.id, vid]); await attendre('Résumé de la visite');
    await verifier('E2E-30', F, 'Visite soumise : lecture seule sur l’appareil', async () => (await page.locator('[data-act="soumettre"], [data-act="rep"]').count()) === 0 && /ne peut plus être modifiée/.test(await texte()));

    /* ----- D. Sécurité par profil ----- */
    await ouvrir('observatoire', 'rt');
    await verifier('E2E-31', X, 'RT : accès refusé à l’écran, aucun onglet', async () => /n’a pas accès/.test(await texte()) && (await page.locator('.obs-onglets a').count()) === 0);
    await verifier('E2E-32', X, 'RT : la base ne renvoie aucun champ, aucune visite, aucune observation (RLS)', async () => egal(await page.evaluate(async () => { const c = supabase.createClient(); const a = await c.from('pheno_panels').select('id'), b = await c.from('pheno_visites').select('id'), d = await c.from('pheno_observations').select('id'); return [a.data.length, b.data.length, d.data.length]; }), [0, 0, 0]));
    await verifier('E2E-33', X, 'RT : synchronisation refusée par le serveur', async () => { const r = await page.evaluate(async () => (await supabase.createClient().rpc('pheno_sync_batch', { p_operations: [] })).error); return { ok: !!r && /refusé/.test(r.message), detail: JSON.stringify(r) }; });
    await ouvrir('observatoire', 'uh_bot'); await clic('[data-act="preparer"]'); await attendre('Appareil prêt');
    await verifier('E2E-34', X, 'Unit Head d’un autre cluster : 0 champ après préparation', async () => /0 champ/.test(await texte()) && egal(await page.evaluate(async () => (await supabase.createClient().from('pheno_observations').select('id')).data.length), 0).ok);
    await ouvrir('observatoire/validation', 'auh_bro');
    await verifier('E2E-35', X, 'Assistant Unit Head : écran de validation refusé', async () => /n’a pas accès/.test(await texte()));
    await verifier('E2E-36', X, 'Assistant Unit Head : validation refusée par le serveur même en appel direct', async () => { const r = await page.evaluate(async v => (await supabase.createClient().rpc('pheno_visite_valider', { p_visite: v })).error, vid); return { ok: !!r && /observée ou saisie|non autorisée/.test(r.message), detail: JSON.stringify(r) }; });

    /* ----- E. Affectation et validation ----- */
    await ouvrir('observatoire/validation', 'zh1'); await attendre('Visites à traiter (1)');
    await clic('a[href^="#observatoire/validation/"]'); await page.waitForSelector('[data-act="dec"][data-dec="valider"]');
    await clic('[data-act="dec"][data-dec="valider"]'); await page.waitForSelector('.obs-dialogue'); await dialogueOk(); await attendre('affectation agronomique requise');
    await verifier('E2E-37', V, 'Zonal Head sans affectation : validation refusée, message clair', async () => egal(psql('select statut from pheno_visites'), 'SOUMIS'));
    await ouvrir('observatoire/affectations', 'bm'); await page.waitForSelector('#obsAff');
    await page.selectOption('#affUser', U.zh1); await page.check('input[name=cl][value=BROBO]'); await page.fill('#affMotif', 'Affectation fictive de test'); await clic('#obsAff button[type=submit]'); await attendre('Affectation accordée');
    await verifier('E2E-38', V, 'Branch Manager : affectation de validation accordée au Zonal Head (BROBO)', async () => egal(psql(`select droit || '|' || cluster_codes::text || '|' || actif from pheno_affectations where user_id = '${U.zh1}'`), 'VALIDATION|{BROBO}|true'));
    await ouvrir('observatoire/validation/' + vid, 'zh1'); await page.waitForSelector('[data-act="dec"][data-dec="corriger"]');
    await clic('[data-act="dec"][data-dec="corriger"]'); await page.waitForSelector('.obs-dialogue'); await dialogueOk();
    await verifier('E2E-39', V, 'Demande de correction sans motif : bloquée à l’écran', async () => (await page.locator('.obs-dialogue').count()) === 1 && egal(psql('select statut from pheno_visites'), 'SOUMIS').ok);
    await page.fill('.obs-dialogue textarea', 'Arbre 05 : jeunes noix à revoir'); await dialogueOk(); await attendre('Correction demandée');
    await verifier('E2E-40', V, 'Correction demandée avec motif, tracée', async () => egal(psql(`select statut || '|' || correction_motif from pheno_visites`), 'CORRECTION_DEMANDEE|Arbre 05 : jeunes noix à revoir'));

    await ouvrir('observatoire', 'auh_bro'); await clic('[data-act="preparer"]'); await attendre('Appareil prêt');
    await page.evaluate(([p, v]) => { location.hash = 'observatoire/visite/' + p + '/' + v; }, [panel.id, vid]); await page.waitForSelector('.obs-arbre');
    await verifier('E2E-41', V, 'L’agent voit la demande de correction et son motif', async () => /Correction demandée/.test(await texte()) && /Arbre 05/.test(await texte()));
    await clic('[data-act="aller"][data-i="4"]'); await page.waitForFunction(() => document.querySelector('.obs-numero').innerText === '05');
    await rep('n', 'OUI'); await clic('[data-act="aller"][data-i="9"]').catch(() => {}); await page.evaluate(() => { location.hash += '/resume'; }); await page.waitForSelector('[data-act="soumettre"]');
    await clic('[data-act="soumettre"]'); await attendre('Indiquez ce que vous avez corrigé');
    await verifier('E2E-42', V, 'Nouvelle soumission sans dire ce qui a été corrigé : bloquée', async () => egal(psql('select statut from pheno_visites'), 'CORRECTION_DEMANDEE'));
    await page.fill('#obsMotif', 'Jeunes noix confirmées sur l’arbre 05'); await page.locator('#obsMotif').dispatchEvent('change');
    await clic('[data-act="soumettre"]');
    await sonder(async () => (await ANAGROCI_OBS_LOCAL.file()).some(o => o.payload && o.payload.motif_correction && ['RECU', 'CONFLIT', 'REJETE'].indexOf(o.statut) >= 0), 'correction non envoyée');
    await verifier('E2E-43', V, 'Correction soumise : historique avec ancienne valeur, nouvelle valeur, motif, auteur', async () => egal(psql(`select v.statut || '|' || (j.ancienne->>'valeur') || '>' || (j.nouvelle->>'valeur') || '|' || j.motif || '|' || (j.acteur = '${U.auh_bro}') from pheno_visites v, pheno_journal j where j.action = 'CORRECTION_AUTEUR' and j.nouvelle->>'champ' = 'n'`), 'SOUMIS|PAS_VU>OUI|Jeunes noix confirmées sur l’arbre 05|true'));
    await ouvrir('observatoire/validation/' + vid, 'zh1'); await page.waitForSelector('[data-act="dec"][data-dec="valider"]');
    await clic('[data-act="dec"][data-dec="valider"]'); await page.waitForSelector('.obs-dialogue'); await dialogueOk(); await attendre('Décision enregistrée');
    await verifier('E2E-44', V, 'Zonal Head affecté : visite validée', async () => egal(psql(`select statut || '|' || (valide_par = '${U.zh1}') from pheno_visites`), 'VALIDE|true'));
    await page.evaluate(() => { location.hash = 'observatoire/qualite'; }); await attendre('Chute de fruits mûrs');
    await verifier('E2E-45', V, 'Qualité : suivi étiqueté « Non officiel », paliers expérimentaux, aucune prévision', async () => /Non officiel/.test(await texte()) && /expérimentaux/.test(await texte()) && !/tonnes|prévision de récolte/i.test((await texte()).replace(/Aucune prévision ni tonnage/g, '').replace(/aucune prévision/g, '')));

    /* ----- E bis. Téléphone partagé : un brouillon non envoyé reste à son auteur ----- */
    await ouvrir('observatoire', 'auh_bro');
    await ctx.setOffline(true);
    const vPart = await page.evaluate(async pid => {
      const v = { id: ANAGROCI_OBS_COEUR.uuid(), panel_id: pid, date_observation: (() => { const d = new Date(Date.now() - 7 * 864e5); return d.toISOString().slice(0, 10); })(), mode_saisie: 'DIRECT', ramassage: 'NON', observations: [] };
      await ANAGROCI_OBS_LOCAL.envoyerVisite(v, false, 'Brouillon fictif téléphone partagé'); return v.id; }, panel.id);
    await ctx.setOffline(false);
    await ouvrir('observatoire', 'uh_bro');
    await page.evaluate(async () => { await ANAGROCI_OBSERVATOIRE.synchroniser(true); });
    await verifier('E2E-58', X, 'Téléphone partagé : l’envoi en attente d’un autre compte n’est pas envoyé sous la session courante', async () => { const st = await page.evaluate(async id => (await ANAGROCI_OBS_LOCAL.file()).filter(o => o.entite_id === id).map(o => o.statut).join(), vPart); return egal([['EN_ATTENTE', 'ECHEC_RESEAU'].includes(st), psql(`select count(*) from pheno_visites where id = '${vPart}'`)], [true, '0']); });
    await page.evaluate(([p, v]) => { location.hash = 'observatoire/visite/' + p + '/' + v; }, [panel.id, vPart]); await attendre('autre compte');
    await verifier('E2E-59', X, 'Téléphone partagé : le brouillon d’un autre compte ne peut pas être repris', async () => (await page.locator('.obs-arbre, [data-act="soumettre"]').count()) === 0);
    await ouvrir('observatoire', 'auh_bro'); await fileVide();
    await verifier('E2E-60', S, 'Téléphone partagé : rendu à son auteur, l’envoi part sous sa propre identité', async () => egal(psql(`select (observateur_id = '${U.auh_bro}')::text || '|' || statut from pheno_visites where id = '${vPart}'`), 'true|BROUILLON'));

    /* ----- F. Affichage aux trois largeurs, non-régression FIELD BUYING ----- */
    for (const [i, [w, h]] of [[390, 844], [768, 1024], [1440, 900]].entries()) {
      await page.setViewportSize({ width: w, height: h });
      for (const [j, r] of ['observatoire/qualite', 'observatoire/validation'].entries()) {
        await page.evaluate(x => { location.hash = x; }, r); await page.waitForTimeout(700);
        await verifier(`E2E-${46 + i * 2 + j}`, G, `${w}×${h} · ${r} : pas de débordement horizontal`, async () => { const d = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); return { ok: d[0] <= d[1] + 1, detail: d.join(' > ') }; });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir('observatoire', 'auh_bro'); await page.screenshot({ path: join(ICI, 'resultats', 'ecran-mes-champs-390.png') });
    await verifier('E2E-52', G, '390×844 · Mes champs : pas de débordement, boutons d’au moins 40 px', async () => { const d = await page.evaluate(() => [document.documentElement.scrollWidth <= innerWidth + 1, [...document.querySelectorAll('#opsRouteView .btn')].every(b => b.getBoundingClientRect().height >= 40)]); return egal(d, [true, true]); });
    await page.evaluate(([p, v]) => { location.hash = 'observatoire/visite/' + p + '/' + v; }, [panel.id, vid]); await attendre('Résumé de la visite'); await page.screenshot({ path: join(ICI, 'resultats', 'ecran-visite-validee-390.png'), fullPage: true });
    await verifier('E2E-57', G, '390×844 · résumé de visite : chaque valeur reste dans l’écran (lecture en cartes)', async () => { const d = await page.evaluate(() => [...document.querySelectorAll('.obs-table td')].filter(td => { const r = td.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length); return egal(d, 0); });
    await page.evaluate(() => { location.hash = 'sync'; }); await page.waitForTimeout(1500);
    await verifier('E2E-53', N, 'FIELD BUYING : la rubrique Synchronisation existante s’affiche toujours', async () => (await page.locator('#opsRouteView .obs').count()) === 0 && (await texte()).length > 50);
    await page.evaluate(() => { location.hash = 'overview'; }); await page.waitForTimeout(1500);
    await verifier('E2E-54', N, 'FIELD BUYING : la vue d’ensemble existante s’affiche toujours', async () => (await page.locator('#opsRouteView .obs').count()) === 0 && (await texte()).length > 50);
    await verifier('E2E-55', N, 'File hors ligne FIELD BUYING intacte : aucune opération de l’Observatoire dans anagroci_ops_offline', async () => egal(await page.evaluate(async () => { const l = await ANAGROCI_OFFLINE.listOperations ? await ANAGROCI_OFFLINE.listOperations() : []; return (l || []).filter(o => /pheno|VISITE_ENREGISTRER|PANEL_INSTALLER/i.test(JSON.stringify(o))).length; }), 0));
    await verifier('E2E-56', N, 'Aucune erreur JavaScript du module pendant tout le parcours', async () => ({ ok: erreurs.length === 0, detail: erreurs.slice(0, 3).join(' | ') }));
  } catch (e) {
    note('E2E-XX', 'Exécution', 'Le parcours s’est interrompu', false, e.message + ' @ ' + (await page.url())); if (process.env.OBS_E2E_DEBUG) console.log(e.stack);
    try { mkdirSync(join(ICI, 'resultats'), { recursive: true }); await page.screenshot({ path: join(ICI, 'resultats', 'echec-e2e.png'), fullPage: true }); console.log((await texte()).slice(-900)); } catch (x) {}
  }
  await browser.close(); srv.close();
  mkdirSync(join(ICI, 'resultats'), { recursive: true });
  const ok = R.filter(r => r.resultat === 'RÉUSSI').length;
  writeFileSync(join(ICI, 'resultats', 'navigateur' + (process.env.OBS_SUFFIXE || '') + '.json'), JSON.stringify({ date: new Date().toISOString(), base: DB, total: R.length, reussis: ok, echoues: R.length - ok, tests: R }, null, 1));
  console.log(`Navigateur : ${R.length} tests, ${ok} réussis, ${R.length - ok} échoués.`);
  process.exit(ok === R.length ? 0 : 1);
}
main();
