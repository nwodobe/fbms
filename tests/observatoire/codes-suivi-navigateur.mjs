#!/usr/bin/env node
/**
 * OBSERVATOIRE AFLP 2027 — démonstration navigateur du formulaire « 12 arbres, codes A001 à A012 ».
 * Vrai Chromium, vraie page FIELD BUYING, vraie base PostgreSQL LOCALE (staging fidèle + migrations
 * 1 à 7, RLS active). Le client Supabase est remplacé par le pont local du test e2e existant
 * (observatoire-e2e.mjs) : chaque lecture et chaque RPC s'exécute SOUS LE RÔLE `authenticated`.
 * Données 100 % fictives. Refuse toute cible Supabase.
 * Usage : PGHOST=/tmp PGPORT=54329 node tests/observatoire/codes-suivi-navigateur.mjs [base]
 * Prérequis : base construite par executer_tests_codes_suivi.sh (fbms_obs_codes).
 * Sorties : tests/observatoire/resultats/codes_suivi_navigateur.json et captures *.png.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/playwright')); }

const ROOT = process.cwd(), ICI = dirname(fileURLToPath(import.meta.url)), OUT = join(ICI, 'resultats');
const HOST = process.env.PGHOST || '', PGPORT = process.env.PGPORT || '', DB = process.argv[2] || 'fbms_obs_codes';
if (!HOST || /supabase/i.test(HOST)) { console.error('REFUS : cible absente ou Supabase détectée'); process.exit(2); }
const PORT = Number(process.env.PORT_OBS_CODES || 4351);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const U = { uh_dia: '00000000-0000-4000-9000-000000000002', bm: '00000000-0000-4000-9000-000000000001' };

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
  function user(){ try { return localStorage.getItem('obs_e2e_user') || '${U.uh_dia}'; } catch(e){ return '${U.uh_dia}'; } }
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
    rpc:function(name,args){ var p = /^pheno_/.test(name) ? (window.__obsAppels.rpc++, name==='pheno_sync_batch' && window.__obsAppels.lots.push(JSON.parse(JSON.stringify(args.p_operations))), null) : Promise.resolve({ data:[], error:null }); var debut = 0; var q = { order:function(){ return q; }, range:function(a){ debut = a; return q; }, then:function(ok,ko){ return (p || (debut > 0 ? Promise.resolve({ data:[], error:null }) : appel({ kind:'rpc', name:name, args:args||{} }))).then(ok,ko); } }; return q; },
    storage:{ from:function(b){ return { upload:function(path){ return b==='pheno-preuves' ? appel({ kind:'depot', path:path }) : Promise.resolve({data:null,error:null}); }, list:function(){ return Promise.resolve({data:[],error:null}); }, getPublicUrl:function(){ return {data:{publicUrl:''}}; } }; } },
    channel:function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; }, removeChannel:function(){}
  };
  Object.defineProperty(window,'supabase',{ value:{ createClient:function(){ return client; } }, writable:false, configurable:false });
})();`;


/* ---------- jeu fictif : trois champs DIABO (B01..B04 = 3 arbres), inventoriés, sans arbres désignés ---------- */
function installerChamp(lettre) {
  const id = randomUUID(), suf = lettre + '-' + id.slice(0, 6);   // nouveau champ à chaque exécution
  psql(`select set_config('request.jwt.claim.sub', '${U.bm}', false);
    insert into public.producteurs (id, data, nom, prenoms, village_id, rt_id) values ('P-FICTIF-NAV-${suf}', '{}', 'PRODUCTEUR FICTIF', 'NAVIGATEUR ${suf}', 'V-FICTIF-DIA', 'RT-FICTIF-DIA');
    update public.producteurs set code = coalesce(nullif(code, ''), '9' || lpad((floor(random() * 900) + 100)::int::text, 3, '0')) where id = 'P-FICTIF-NAV-${suf}';
    insert into public.farmer_plots (id, producteur_id, village_id, local_name, latitude, longitude, gps_status, tree_count, status)
    values ('${id}', 'P-FICTIF-NAV-${suf}', 'V-FICTIF-DIA', 'PARCELLE FICTIVE NAV ${suf}', 0.5, 0.5, 'POINT_CAPTURED', 40, 'ACTIVE');`);
  const plot = id;
  const camp = psql(`select id from campaigns where is_current and status = 'OPEN' limit 1`);
  const blocs = [1, 2, 3, 4].map(n => ({ id: randomUUID(), numero: n, repere: 'REPÈRE FICTIF ' + n, suivi: true }));
  const pid = randomUUID();
  commeUtilisateur(U.uh_dia, `select public.pheno_panel_installer(${lit(JSON.stringify({ id: pid, campaign_id: camp, plot_id: plot, nb_blocs_total: 4, nb_blocs_tires: 4, blocs }))}::jsonb)`);
  for (const b of blocs) commeUtilisateur(U.uh_dia, `select public.pheno_bloc_inventorier(${lit(JSON.stringify({ bloc_id: b.id, nb_arbres: 3 }))}::jsonb)`);
  return pid;
}

/* ---------- déroulé ---------- */
const R = [], erreurs = []; let page, ctx, browser;
function note(id, libelle, ok, detail) { R.push({ id, libelle, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', detail: String(detail ?? '').slice(0, 300) }); console.log((ok ? 'RÉUSSI  ' : 'ÉCHOUÉ  ') + id + ' ' + libelle + (ok ? '' : ' — ' + String(detail ?? '').slice(0, 300))); }
async function verifier(id, libelle, fn) { try { const r = await fn(); note(id, libelle, r === true || (r && r.ok), r && r.detail !== undefined ? r.detail : r); } catch (e) { note(id, libelle, false, e.message); } }
const egal = (a, b) => ({ ok: JSON.stringify(a) === JSON.stringify(b), detail: `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}` });
const texte = () => page.evaluate(() => document.getElementById('opsRouteView').innerText);
const attendre = (t, ms = 20000) => page.waitForFunction(x => (document.getElementById('opsRouteView') || {}).innerText && document.getElementById('opsRouteView').innerText.includes(x), t, { timeout: ms });
const base = `http://127.0.0.1:${PORT}/operations/field-buying.html`;
async function ouvrir(hash) {
  if (page) await page.close().catch(() => {});
  page = await ctx.newPage();
  page.on('pageerror', e => erreurs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /observatoire|OBSERVATOIRE|pheno/i.test(m.text())) erreurs.push(m.text()); });
  for (let essai = 0; essai < 3; essai++) {
    try {
      await page.goto(base + '#' + hash, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForFunction(() => window.ANAGROCI_AUTH && window.ANAGROCI_OBSERVATOIRE && document.querySelector('#opsRouteView .obs'), null, { timeout: 25000 });
      if (await page.evaluate(() => navigator.onLine)) await page.waitForFunction(() => window.ANAGROCI_CAMPAIGN && ANAGROCI_CAMPAIGN.id(), null, { timeout: 15000 });
      await page.waitForTimeout(700);
      await page.waitForFunction(() => document.querySelector('#opsRouteView .obs'), null, { timeout: 25000 });
      return;
    } catch (e) { if (essai === 2) throw e; await page.waitForTimeout(800).catch(() => {}); }
  }
}
const compteur = () => page.locator('#obsChoixCompteur').innerText();
const enregistrable = () => page.evaluate(() => !document.getElementById('obsChoixEnregistrer').disabled);
const codeLigne = (i) => page.locator('.obs-choix-arbre').nth(i).locator('[data-choix=code]');
async function choisirCode(i, code) { await codeLigne(i).selectOption(code); await page.waitForTimeout(150); }
async function capture(nom) { await page.screenshot({ path: join(OUT, nom), fullPage: false }); }
async function sansDebordement() { return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); }
async function fileVide(ms = 30000) { const fin = Date.now() + ms; for (;;) { const n = await page.evaluate(async () => (await ANAGROCI_OBS_LOCAL.enAttente()).length); if (n === 0) return; if (Date.now() > fin) throw new Error('file non vidée : ' + n); await page.waitForTimeout(250); } }

async function main() {
  mkdirSync(OUT, { recursive: true });
  psql(`update campaigns set is_current = (status = 'OPEN' and code = '2098')`);
  const champs = ['F', 'G', 'H'].map(installerChamp);
  const srv = serveur(); await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: process.env.OBS_E2E_CHROME || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), args: ['--no-sandbox'] });
  const largeurs = [[390, 844], [768, 1024], [1440, 900]];
  try {
    for (let k = 0; k < largeurs.length; k++) {
      const [w, h] = largeurs[k], L = `${w}x${h}`, pid = champs[k];
      ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await ctx.addInitScript({ content: STUB });
      await ctx.addInitScript(u => { try { localStorage.setItem('obs_e2e_user', u); } catch (e) {} }, U.uh_dia);
      await ctx.route(/https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\/.*/, async route => {
        const u = route.request().url();
        if (/\.css(?:\?|$)|fonts\.googleapis/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: '/* test */' });
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* dépendance externe neutralisée */' });
      });
      page = null;
      await ouvrir('observatoire');
      await page.locator('[data-act="preparer"]').first().click(); await attendre('prêt').catch(async e => { console.log('TEXTE:', (await texte()).slice(0, 800), erreurs); throw e; });
      await ouvrir('observatoire/champ/' + pid);
      await page.waitForSelector('#obsChoixArbres');
      await verifier(`NAV-${L}-01`, `[${L}] Formulaire : 12 lignes (Arbre suivi 01..10, Réserve R1, R2) avec bloc, arbre physique et code de suivi`, async () => {
        const noms = await page.locator('.obs-choix-nom').allInnerTexts();
        return egal([noms.length, noms[0], noms[9], noms[10], noms[11], await page.locator('[data-choix=code]').count()], [12, 'Arbre suivi 01', 'Arbre suivi 10', 'Réserve R1', 'Réserve R2', 12]); });
      await verifier(`NAV-${L}-02`, `[${L}] Avant saisie : enregistrement désactivé, compteur 0/12`, async () => egal([await enregistrable(), await compteur()], [false, '0/12 arbres identifiés, 0 doublon.']));
      await page.locator('[data-act="auto-designer"]').click();
      await page.locator('[data-act="auto-codes"]').click();
      await verifier(`NAV-${L}-03`, `[${L}] « Attribuer automatiquement A001 à A012 » : 12/12 arbres identifiés, 0 doublon ; enregistrement actif`, async () => egal([await compteur(), await enregistrable()], ['12/12 arbres identifiés, 0 doublon.', true]));
      await verifier(`NAV-${L}-04`, `[${L}] Aucun débordement horizontal`, async () => sansDebordement());
      await page.locator('#obsChoixArbres').scrollIntoViewIfNeeded(); await capture(`codes_suivi_${L}_1_auto.png`);
      await page.locator('#obsChoixCompteur').scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, 200)); await capture(`codes_suivi_${L}_1b_compteur.png`);
      if (k > 0) { await ctx.close(); continue; }

      /* Parcours complet sur téléphone (390 × 844). */
      await choisirCode(0, 'A008');
      await verifier('NAV-05', 'Code déjà utilisé (A008) : erreur immédiate sur la ligne, échange proposé, enregistrement bloqué', async () => {
        const l = page.locator('.obs-choix-arbre').nth(0);
        return { ok: /A008 est déjà attribué à « Arbre suivi 08 »/.test(await l.innerText()) && (await l.locator('[data-act="echanger-code"]').count()) === 1 && !(await enregistrable()) && /1 doublon/.test(await compteur()), detail: await l.innerText() + ' | ' + await compteur() }; });
      await page.locator('.obs-choix-arbre').nth(0).scrollIntoViewIfNeeded(); await capture('codes_suivi_390x844_2_doublon_echange.png');
      await page.locator('.obs-choix-arbre').nth(0).locator('[data-act="echanger-code"]').click();
      await verifier('NAV-06', 'Échange accepté : suivi 01 = A008, suivi 08 = A001, 12/12 et 0 doublon', async () => egal([await codeLigne(0).inputValue(), await codeLigne(7).inputValue(), await compteur(), await enregistrable()], ['A008', 'A001', '12/12 arbres identifiés, 0 doublon.', true]));
      const l2 = page.locator('.obs-choix-arbre').nth(1), ancienNum = await l2.locator('[data-choix=num]').inputValue();
      await l2.locator('[data-choix=num]').fill('1'); await page.waitForTimeout(150);
      await verifier('NAV-07', 'Deux lignes sur le même arbre physique (B01/1) : erreur, enregistrement bloqué', async () => ({ ok: /déjà désigné/.test(await l2.innerText()) && !(await enregistrable()), detail: await l2.innerText() }));
      await l2.locator('[data-choix=num]').fill(ancienNum); await page.waitForTimeout(150);
      await l2.locator('[data-choix=num]').fill('4'); await page.waitForTimeout(150);
      await verifier('NAV-08', 'Numéro hors inventaire (4 dans un bloc de 3 arbres) : refusé', async () => ({ ok: /ne contient que 3 arbres/.test(await l2.innerText()) && !(await enregistrable()), detail: await l2.innerText() }));
      await l2.locator('[data-choix=num]').fill(ancienNum); await page.waitForTimeout(300);
      await ouvrir('observatoire/champ/' + pid);   // fermeture puis réouverture pendant la saisie
      await page.waitForSelector('#obsChoixArbres'); await page.waitForTimeout(800);
      await verifier('NAV-09', 'Fermeture puis réouverture pendant la saisie : brouillon conservé (codes et arbres)', async () => egal([await codeLigne(0).inputValue(), await codeLigne(7).inputValue(), await compteur()], ['A008', 'A001', '12/12 arbres identifiés, 0 doublon.']));
      await ctx.setOffline(true);
      await page.locator('#obsChoixEnregistrer').click(); await page.waitForSelector('.obs-dialogue');
      await verifier('NAV-10', 'Confirmation : récapitulatif code → arbre physique', async () => /A008 = B01\/A001 \(suivi 01\)/.test(await page.locator('.obs-dialogue').innerText()));
      await page.locator('.obs-dialogue .btn.primary').click(); await attendre('enregistrés sur ce téléphone');
      await verifier('NAV-11', 'Hors connexion : enregistré sur le téléphone, rien sur le serveur', async () => egal(psql(`select count(*) from pheno_arbres where panel_id = '${pid}'`), '0'));
      await ctx.setOffline(false);
      await page.evaluate(() => ANAGROCI_OBSERVATOIRE.synchroniser(true)); await fileVide();
      await page.evaluate(() => ANAGROCI_OBSERVATOIRE.synchroniser(true)); await page.waitForTimeout(500);   // second passage : aucun doublon
      await verifier('NAV-12', 'Retour du réseau : 12 arbres reçus, 12 codes distincts, aucun doublon', async () => egal(psql(`select count(*) || '|' || count(distinct code_suivi) from pheno_arbres where panel_id = '${pid}'`), '12|12'));
      await verifier('NAV-13', 'Codes conservés après synchronisation : B01/A001 = A008, B03/A002 = A001', async () => egal(psql(`select string_agg(code || '=' || code_suivi, ',' order by code) from pheno_arbres where panel_id = '${pid}' and code in ('B01/A001', 'B03/A002')`), 'B01/A001=A008,B03/A002=A001'));
      await page.evaluate(async () => { const c = ANAGROCI_CAMPAIGN.id(); return ANAGROCI_OBS_LOCAL.preparer(window.supabase.createClient(), c); });
      await ouvrir('observatoire/champ/' + pid);
      await page.waitForSelector('.obs-code-suivi', { timeout: 20000 });
      await verifier('NAV-14', 'Fiche du champ : codes affichés de A001 à A012 avec l’arbre physique', async () => {
        const codes = await page.locator('.obs-code-suivi').allInnerTexts();
        return egal(codes.slice(0, 12), ['A001', 'A002', 'A003', 'A004', 'A005', 'A006', 'A007', 'A008', 'A009', 'A010', 'A011', 'A012']); });
      await page.locator('.obs-table').last().scrollIntoViewIfNeeded().catch(() => {});
      await page.locator('[data-act="codes-modifier"]').scrollIntoViewIfNeeded(); await capture('codes_suivi_390x844_3_fiche_champ.png');
      await page.locator('[data-act="codes-modifier"]').click(); await page.waitForSelector('.obs-codes-dialogue');
      const sel = page.locator('.obs-code-ligne').nth(0).locator('select');
      await sel.selectOption('A001'); await page.waitForTimeout(150);
      await verifier('NAV-15', 'Modification motivée : code déjà pris signalé et échange proposé', async () => (await page.locator('.obs-code-ligne').nth(0).locator('[data-act="echanger-code"]').count()) === 1);
      await page.locator('.obs-code-ligne').nth(0).locator('[data-act="echanger-code"]').click();
      await capture('codes_suivi_390x844_4_modification_motivee.png');
      await page.locator('.obs-dialogue [data-champ]').fill('Étiquettes inversées (essai fictif)');
      await page.locator('.obs-dialogue .btn.primary').click();
      await attendre('Codes de suivi enregistrés');
      await verifier('NAV-16', 'Modification historisée : journal immuable avec motif', async () => egal(psql(`select action || '|' || motif from pheno_journal where entite_id = '${pid}' and action like 'CODES_SUIVI%'`), 'CODES_SUIVI_MODIFIES|Étiquettes inversées (essai fictif)'));
      await verifier('NAV-17', 'Après modification : B01/A001 = A001, B03/A002 = A008', async () => egal(psql(`select string_agg(code || '=' || code_suivi, ',' order by code) from pheno_arbres where panel_id = '${pid}' and code in ('B01/A001', 'B03/A002')`), 'B01/A001=A001,B03/A002=A008'));
      await ouvrir('observatoire/visite/' + pid + '/nouvelle');
      await attendre('Arbre 1 sur');
      await verifier('NAV-18', 'Visite hebdomadaire : l’arbre 1 est A001, avec son arbre physique', async () => ({ ok: /Code de suivi A001 · arbre physique B01\/A001/.test(await texte()), detail: (await texte()).slice(0, 300) }));
      await capture('codes_suivi_390x844_5_visite.png');
      await ctx.close();
    }
    note('NAV-99', 'Aucune erreur JavaScript du module pendant les parcours', erreurs.length === 0, erreurs.join(' | '));
  } finally { await browser.close(); srv.close(); }
  const ok = R.filter(r => r.resultat === 'RÉUSSI').length;
  writeFileSync(join(OUT, 'codes_suivi_navigateur.json'), JSON.stringify({ le: new Date().toISOString(), base: DB, reussis: ok, echoues: R.length - ok, tests: R }, null, 1));
  console.log(`Navigateur codes de suivi : ${ok} réussis, ${R.length - ok} échoués.`);
  process.exit(R.length === ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
