#!/usr/bin/env node
/**
 * PARCOURS PARCELLES (21/11/2026) — test navigateur : accord GPS → capture → carte avec carré P1-P4 → superficie.
 *
 * Vrai navigateur (Chromium), vraie page FIELD BUYING, vrais fichiers du dépôt.
 * LIMITE ASSUMÉE : le serveur est une DOUBLURE EN MÉMOIRE (aucune base, aucun Supabase). Elle rejoue les règles
 * utiles à l'écran (dernière décision de consentement, refus d'un point sans accord), mais elle ne prouve RIEN sur
 * la RLS, PostGIS ni les RPC réelles : ces contrôles restent ceux de tests/cartographie/cartographie-e2e.mjs
 * (base locale PostGIS) et de la recette sur téléphone. Ce test ne vaut pas preuve de fonctionnement Android.
 * Positions GPS : émulation de géolocalisation de Chromium (outil de test). Données 100 % fictives.
 * Tuiles Esri : remplacées par une image neutre de 1 pixel ; métadonnées d'image : réponse d'essai fabriquée
 * POUR LE TEST (elle ne décrit aucune image réelle).
 *
 * Usage : LEAFLET_DIR=<dossier dist de leaflet 1.9.4> node tests/cartographie/parcours-gabarit-navigateur.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/playwright')); }
const C = require('../../shared/parcelles-coeur.js');

const ICI = dirname(fileURLToPath(import.meta.url)), ROOT = join(ICI, '..', '..'), OUT = join(ICI, 'resultats', 'parcours-20261122');
const LEAFLET = process.env.LEAFLET_DIR || '/home/claude/work/lf/package/dist';
const PORT = Number(process.env.PORT_PARCOURS || 4361);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const UH = '00000000-0000-4000-8000-0000000000d1';
const PL = { A: '31000000-0000-4000-8000-000000000001', B: '31000000-0000-4000-8000-000000000002', C: '31000000-0000-4000-8000-000000000003' };
const ICI_GPS = { latitude: 7.7003, longitude: -5.0297 };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/* ---------- doublure serveur en mémoire ---------- */
const etat = { consentements: [], lots: [], insertions: [], ordre: 0, identifyKo: false, recus: {}, rejeux: 0,
  parcelles: [
    { plot_id: PL.A, producteur_id: 'P-FICTIF-A', producteur_code: '9101', producteur_nom: 'PRODUCTEUR FICTIF', producteur_prenoms: 'ALPHA', local_name: 'CHAMP FICTIF ALPHA', declared_area: 1.2 },
    { plot_id: PL.B, producteur_id: 'P-FICTIF-B', producteur_code: '9102', producteur_nom: 'PRODUCTEUR FICTIF', producteur_prenoms: 'BRAVO', local_name: 'CHAMP FICTIF BRAVO', declared_area: 2 },
    { plot_id: PL.C, producteur_id: 'P-FICTIF-C', producteur_code: '9103', producteur_nom: 'PRODUCTEUR FICTIF', producteur_prenoms: 'CHARLIE', local_name: 'CHAMP FICTIF CHARLIE', declared_area: 0.8 }
  ].map(p => ({ plot_code: null, village_id: 'V-FICTIF', village_nom: 'VILLAGE FICTIF', cluster_code: 'BROBO', zone_code: 'GBEKE_1', area_unit: 'HA', tree_count: 50,
    latitude: null, longitude: null, gps_accuracy_m: null, gps_captured_at: null, gps_status: 'NOT_MAPPED', mapping_status: null, mapped_area_ha: null, mapped_area_method: null,
    current_geometry_id: null, split_from_plot_id: null, derniere_geometry_id: null, derniere_status: null, derniere_version: null, derniere_area_m2: null, derniere_method: null,
    derniere_le: null, anomalies_ouvertes: 0, village_latitude: 7.704, village_longitude: -5.026, ...p })) };
function derniere(prod) { return etat.consentements.filter(c => c.producteur_id === prod).sort((a, b) => b.event_order - a.event_order)[0] || null; }
function accordGps(prod) { const d = derniere(prod); return !!(d && (d.status === 'GRANTED' || d.status === 'PARTIAL') && d.scopes && d.scopes.gps === true); }
function pont(d) {
  if (d.kind === 'insert') {
    if (d.table !== 'farmer_consents') return null;
    const l = { ...d.ligne, event_order: ++etat.ordre, created_at: new Date().toISOString() };
    if (l.source !== 'FIELD_GPS_DECISION' || l.agent_id !== UH || l.created_by !== UH) throw new Error('new row violates row-level security policy (doublure)');
    if (!['GRANTED', 'PARTIAL', 'REFUSED', 'WITHDRAWN'].includes(l.status) || !['VERBAL', 'WRITTEN', 'DIGITAL', 'WITNESSED'].includes(l.method)) throw new Error('contrainte de statut ou de méthode (doublure)');
    etat.consentements.push(l); etat.insertions.push(l); return null;
  }
  if (d.kind === 'rpc') {
    if (d.name !== 'plot_map_sync_batch') return null;
    etat.lots.push(JSON.parse(JSON.stringify(d.args.p_operations)));
    /* Comme le serveur réel (private.plot_map_sync_recus) : une clé d'idempotence déjà acceptée renvoie le même reçu, sans rejouer l'opération. */
    return { resultats: d.args.p_operations.map(o => { if (etat.recus[o.idempotency_key]) { etat.rejeux++; return etat.recus[o.idempotency_key]; } const r = traiter(o); if (r.statut === 'ACCEPTEE') etat.recus[o.idempotency_key] = r; return r; }), serveur_le: new Date().toISOString() };
    function traiter(o) {
      const p = etat.parcelles.find(x => x.plot_id === o.payload.plot_id), base = { idempotency_key: o.idempotency_key, recu_serveur_le: new Date().toISOString() };
      if (!p) return { ...base, statut: 'REJETEE', code: 'PM002', message: 'Parcelle introuvable.' };
      if (!accordGps(p.producteur_id)) return { ...base, statut: 'REJETEE', code: 'PM001', message: 'Le producteur n\'a pas donné son accord pour l\'enregistrement des données GPS. Recueillez d\'abord son consentement.' };
      if (o.type === 'LOCALISER') {
        if (!(o.payload.precision_m > 0) || o.payload.precision_m > 50) return { ...base, statut: 'REJETEE', code: 'PM002', message: 'Précision insuffisante.' };
        Object.assign(p, { latitude: o.payload.latitude, longitude: o.payload.longitude, gps_accuracy_m: o.payload.precision_m, gps_captured_at: o.payload.capture_le, gps_status: 'POINT_CAPTURED' });
        return { ...base, statut: 'ACCEPTEE', plot_id: p.plot_id };
      }
      if (o.type === 'SOUMETTRE_CONTOUR') { Object.assign(p, { mapping_status: 'SOUMIS', derniere_status: 'SOUMIS', derniere_area_m2: o.payload.area_m2_client, derniere_version: 1 }); return { ...base, statut: 'ACCEPTEE', plot_id: p.plot_id }; }
      return { ...base, statut: 'REJETEE', code: 'PM002', message: 'Type inconnu.' };
    }
  }
  if (d.kind === 'select') {
    let l = [];
    if (d.table === 'profils') l = [{ user_id: UH, id: UH, email: 'uh@example.invalid', nom: 'UH FICTIF', role: 'Unit Head', cluster: 'BROBO', zone: null, actif: true }];
    else if (d.table === 'plot_map_parametres') l = [{ cle: 'activation', valeur: { localisation: true, contours: true, clusters_pilotes: ['BROBO'] } }, { cle: 'imagerie', valeur: { fournisseur: 'esri', licence_confirmee: true, cle: 'CLE-FICTIVE-DE-TEST' } },
      { cle: 'seuils', valeur: { superficie_max_ha: 200, superficie_min_m2: 100, precision_gps_max_m: 30, ecart_superficie_pct: 20, precision_localisation_max_m: 50 } }];
    else if (d.table === 'plot_map_parcelles_v') l = etat.parcelles.map(p => ({ ...p, consentement_gps: accordGps(p.producteur_id) }));
    else if (d.table === 'farmer_consents') l = etat.consentements.slice();
    (d.filters || []).forEach(f => { l = l.filter(x => f.op === 'eq' ? String(x[f.k]) === String(f.v) : f.v.map(String).includes(String(x[f.k]))); });
    (d.order || []).slice().reverse().forEach(o => { l.sort((a, b) => (a[o.k] > b[o.k] ? 1 : a[o.k] < b[o.k] ? -1 : 0) * (o.desc ? -1 : 1)); });
    if (d.range) l = l.slice(d.range[0], d.range[1] + 1);
    return l;
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
  var UH = '${UH}';
  function appel(d){
    if (navigator.onLine === false) return Promise.resolve({ data:null, error:{ message:'Failed to fetch (hors ligne)' } });
    return fetch('/__pont', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(d) }).then(function(r){ return r.json(); })
      .then(function(x){ return x.error ? { data:null, error:x.error, status:400 } : { data:x.data, error:null, status:200 }; })
      .catch(function(e){ return { data:null, error:{ message:'Failed to fetch: ' + e.message } }; });
  }
  function query(table){
    var d = { kind:'select', table:table, cols:'*', filters:[], order:[], range:null }, un = false;
    var q = { select:function(c){ d.cols = c || '*'; return q; }, eq:function(k,v){ d.filters.push({op:'eq',k:k,v:v}); return q; }, in:function(k,v){ d.filters.push({op:'in',k:k,v:v}); return q; },
      order:function(k,o){ d.order.push({k:k,desc:!!(o&&o.ascending===false)}); return q; }, range:function(a,b){ d.range=[a,b]; return q; }, limit:function(n){ d.range=[0,n-1]; return q; },
      neq:function(){return q;}, is:function(){return q;}, not:function(){return q;}, or:function(){return q;}, like:function(){return q;}, ilike:function(){return q;}, gte:function(){return q;}, lte:function(){return q;}, gt:function(){return q;}, lt:function(){return q;}, contains:function(){return q;},
      insert:function(ligne){ return appel({ kind:'insert', table:table, ligne:ligne }); }, update:function(){return q;}, upsert:function(){return q;}, delete:function(){return q;},
      single:function(){ un = true; return fin(); }, maybeSingle:function(){ un = true; return fin(); }, then:function(ok,ko){ return fin().then(ok,ko); } };
    function fin(){ return appel(d).then(function(x){ if (x.error) return x; return { data: un ? ((x.data||[])[0] || null) : x.data, error:null, status:200 }; }); }
    return q;
  }
  var client = {
    auth:{ getSession:function(){ return Promise.resolve({ data:{ session:{ user:{ id:UH, email:'uh@example.invalid' }, access_token:'fictif' } }, error:null }); },
      getUser:function(){ return Promise.resolve({ data:{ user:{ id:UH, email:'uh@example.invalid' } }, error:null }); },
      signOut:function(){ return Promise.resolve({data:null,error:null}); }, signInWithPassword:function(){ return Promise.resolve({data:{session:{user:{id:UH}}},error:null}); },
      onAuthStateChange:function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; }, refreshSession:function(){ return this.getSession(); } },
    from:query,
    rpc:function(name,args){ if (/^plot_map_/.test(name)) return appel({ kind:'rpc', name:name, args:args||{} }); return Promise.resolve({ data:null, error:null }); },
    storage:{ from:function(){ return { upload:function(){ return Promise.resolve({data:null,error:null}); }, list:function(){ return Promise.resolve({data:[],error:null}); }, createSignedUrl:function(){ return Promise.resolve({data:null,error:null}); } }; } },
    channel:function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; }, removeChannel:function(){}
  };
  Object.defineProperty(window,'supabase',{ value:{ createClient:function(){ return client; } }, writable:false, configurable:false });
})();`;

/* ---------- outils ---------- */
const R = [], erreurs = []; let page, ctx, cdp;
function note(id, test, libelle, ok, detail) { R.push({ id, test, libelle, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', detail: String(detail ?? '').slice(0, 300) }); console.log((ok ? 'RÉUSSI  ' : 'ÉCHOUÉ  ') + id + ' ' + libelle + (ok ? '' : ' — ' + String(detail ?? '').slice(0, 260))); }
async function verifier(id, test, libelle, fn) { try { const r = await fn(); note(id, test, libelle, r === true || (r && r.ok), r && r.detail !== undefined ? r.detail : r); } catch (e) { note(id, test, libelle, false, e.message); } }
const texte = () => page.evaluate(() => (document.getElementById('opsRouteView') || {}).innerText || '');
const attendre = (t, ms = 20000) => page.waitForFunction(x => { const r = document.getElementById('opsRouteView'); return r && r.innerText && r.innerText.indexOf(x) >= 0; }, t, { timeout: ms });
const base = `http://127.0.0.1:${PORT}/operations/field-buying.html`;
async function ouvrir(hash, largeur = 390, hauteur = 844) {
  if (page) await page.close().catch(() => {});
  page = await ctx.newPage(); await page.setViewportSize({ width: largeur, height: hauteur });
  page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && /PARCELLES|parcelles|plot_map|Leaflet|geodesic/i.test(m.text())) erreurs.push('console: ' + m.text()); });
  cdp = await ctx.newCDPSession(page);
  await page.goto(base + '#' + hash, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForFunction(() => window.ANAGROCI_AUTH && window.ANAGROCI_PARCELLES && document.querySelector('#opsRouteView .ops-route-head, #opsRouteView .pc-ed-tete'), null, { timeout: 30000 });
  await page.waitForFunction(() => !/Chargement|Préparation/.test(document.getElementById('opsRouteView').innerText.slice(0, 200)), null, { timeout: 30000 });
  await page.waitForTimeout(600);
}
const aller = async (hash, t) => { await page.evaluate(h => { location.hash = h; }, hash); if (t) await attendre(t); await page.waitForTimeout(400); };
async function capture(nom) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: join(OUT, nom + '.png') }); }
const brouillon = id => page.evaluate(async i => await ANAGROCI_PARCELLES_LOCAL.brouillon.lire(i), id);
const file = () => page.evaluate(async () => (await ANAGROCI_PARCELLES_LOCAL.file.toutes()).map(o => ({ type: o.type, etat: o.etat, payload: o.payload, message: o.message || null })));
async function centre(titre) { const b = await page.locator('.leaflet-marker-icon[title="' + titre + '"]').first().boundingBox(); if (!b) throw new Error('repère « ' + titre + ' » introuvable'); return { x: b.x + b.width / 2, y: b.y + b.height / 2, l: b.width }; }
async function glisser(titre, dx, dy) { const c = await centre(titre); await page.mouse.move(c.x, c.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + dx * i / 8, c.y + dy * i / 8); await page.mouse.up(); await page.waitForTimeout(350); }
async function glisserAuDoigt(titre, dx, dy) {
  const c = await centre(titre), pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(c.x, c.y) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(c.x + dx * i / 8, c.y + dy * i / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(350);
}
const surface = () => page.locator('#pcBarre .pc-surface').innerText();
const perimetre = () => page.locator('#pcBarre .pc-perimetre').innerText();
const nbReperes = () => page.locator('.leaflet-marker-icon[title^="Point P"]').count();
const etiquettes = () => page.locator('.leaflet-marker-icon[title^="Point P"] span').allInnerTexts();
const haAttendu = s => C.hectares(C.mesurer(s).area_m2) + ' ha';
async function accorder(id) {
  await aller('parcelles/parcours/' + id, 'Cartographier le champ');
  if (!(await page.locator('[data-pc="accord-choix"][data-v="ACCORDE"]').isVisible().catch(() => false))) await page.locator('.pc-plus > summary').last().click();
  await page.locator('[data-pc="accord-choix"][data-v="ACCORDE"]').click(); await page.locator('#pcAccordMethode').selectOption('VERBAL'); await page.locator('#pcAccordAtteste').check();
  await page.locator('[data-pc="accord-enregistrer"]').click(); await attendre('Consentement GPS accordé');
}

async function main() {
  const srv = serveur(); await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined, args: ['--no-sandbox'] });
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block', geolocation: { ...ICI_GPS, accuracy: 6 }, permissions: ['geolocation'] });
  await ctx.addInitScript({ content: STUB });
  const identify = [];
  await ctx.route(/https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|tile\.openstreetmap\.org|ibasemaps-api\.arcgis\.com|services\.arcgisonline\.com|static-map-tiles-api\.arcgis\.com)\/.*/, async route => {
    const u = route.request().url();
    if (/services\.arcgisonline\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/identify\?/.test(u)) { identify.push(u); if (etat.identifyKo) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ attributes: { SRC_DATE: 99999, SRC_RES: 99999, NICE_DESC: 'SOURCE FICTIVE DE TEST' } }] }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ layerName: 'essai', attributes: { 'DATE (YYYYMMDD)': '20230214', 'RESOLUTION (M)': '0.6', NICE_DESC: 'SOURCE FICTIVE DE TEST' } }] }) }); }
    if (/arcgis\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
    if (/leaflet@1\.9\.4\/dist\/leaflet(\.min)?\.js/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(join(LEAFLET, 'leaflet.js')) });
    if (/leaflet@1\.9\.4\/dist\/leaflet(\.min)?\.css/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: readFileSync(join(LEAFLET, 'leaflet.css')) });
    if (/\.css(?:\?|$)|fonts\.googleapis/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: '/* test */' });
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* dépendance externe neutralisée */' });
  });
  try {
    /* ----- Test A : consentement (aucun, refusé, accordé, retiré) ----- */
    await ouvrir('parcelles/p/' + PL.A);
    await verifier('PG-01', 'A', 'Fiche : une seule action « Cartographier ce champ », plus de renvoi vers le passeport', async () => { const t = await texte(); return { ok: (await page.locator('a[href="#parcelles/parcours/' + PL.A + '"]').count()) === 1 && !/Ouvrir le consentement du producteur/.test(t) && (await page.locator('a[href*="/tracer/"]').count()) === 0, detail: t.slice(0, 200) }; });
    await aller('parcelles/parcours/' + PL.A, 'Cartographier le champ');
    await verifier('PG-02', 'A', 'Aucune décision : phrase d\'accord exacte, « J\'accepte » et « Je refuse », rien de présélectionné, enregistrement désactivé, aucun bouton de capture', async () => {
      const t = await texte(), presses = await page.locator('[data-pc="accord-choix"][aria-pressed="true"]').count();
      return { ok: t.includes('Pour localiser votre plantation et établir sa carte, nous avons besoin de votre accord pour enregistrer ses coordonnées géographiques.') && (await page.locator('[data-pc="accord-choix"]').count()) === 2 && presses === 0
        && await page.locator('[data-pc="accord-enregistrer"]').isDisabled() && (await page.locator('[data-pc="capturer"]').count()) === 0 && (await page.locator('#pcAccordMethode').inputValue()) === '' && !(await page.locator('#pcAccordAtteste').isChecked()), detail: t.slice(0, 300) };
    });
    await capture('01-accord-a-recueillir-390');
    await page.locator('[data-pc="accord-choix"][data-v="REFUSE"]').click(); await page.locator('#pcAccordMethode').selectOption('VERBAL'); await page.locator('#pcAccordAtteste').check();
    await page.locator('[data-pc="accord-enregistrer"]').click(); await attendre('Consentement GPS refusé');
    await verifier('PG-03', 'A', 'Refus : décision historisée (REFUSED, gps=false, méthode, agent, date du jour, texte lu) et localisation bloquée', async () => {
      const l = etat.insertions[0] || {}, t = await texte();
      return { ok: l.status === 'REFUSED' && l.scopes.gps === false && l.method === 'VERBAL' && l.agent_id === UH && l.source === 'FIELD_GPS_DECISION' && Math.abs(Date.now() - Date.parse(l.consent_at)) < 60000 && /Pour localiser votre plantation/.test(l.notes)
        && (await page.locator('[data-pc="capturer"]').count()) === 0 && /bloquées/.test(t) && /La parcelle reste enregistrée/.test(t), detail: JSON.stringify(l).slice(0, 250) };
    });
    await verifier('PG-04', 'A', 'Refus : la carte n\'est pas accessible (retour au parcours)', async () => { await aller('parcelles/tracer/' + PL.A + '/sat'); await attendre('Cartographier le champ'); return (await page.locator('#pcCarte').count()) === 0; });
    await accorder(PL.A);
    await verifier('PG-05', 'A', 'Nouvelle décision « J\'accepte » : ajoutée à l\'historique (la précédente est conservée), mention discrète, bouton de capture unique', async () => {
      const t = await texte(); return { ok: etat.consentements.length === 2 && etat.consentements[0].status === 'REFUSED' && etat.consentements[1].scopes.gps === true && (await page.locator('[data-pc="capturer"]').count()) === 1 && /CAPTURER MA POSITION GPS/.test(t), detail: t.slice(0, 250) };
    });
    await capture('02-accord-donne-390');

    /* ----- Tests B et C : capture automatique, ouverture de la carte ----- */
    await page.locator('[data-pc="capturer"]').click();
    await page.waitForFunction(() => document.querySelector('.pc-ed-tete') && document.querySelectorAll('.leaflet-marker-icon[title^="Point P"]').length >= 1, null, { timeout: 45000 });
    await page.waitForTimeout(700);
    await verifier('PG-06', 'B', 'Un seul appui : latitude, longitude, précision et heure envoyées sans saisie ; aucun statut « vérifié » demandé', async () => {
      const o = etat.lots.flat().find(x => x.type === 'LOCALISER'), p = o && o.payload, pl = etat.parcelles[0];
      return { ok: !!p && Math.abs(p.latitude - ICI_GPS.latitude) < 1e-6 && Math.abs(p.longitude - ICI_GPS.longitude) < 1e-6 && p.precision_m === 6 && Math.abs(Date.now() - Date.parse(p.capture_le)) < 120000 && !('gps_status' in p) && pl.gps_status === 'POINT_CAPTURED', detail: JSON.stringify(p) };
    });
    await verifier('PG-07', 'C', 'La carte s\'ouvre toute seule après la capture reçue par le serveur', async () => /#parcelles\/tracer\//.test(await page.evaluate(() => location.hash)) && (await page.locator('#pcCarte.leaflet-container').count()) === 1);

    /* ----- Test D : carré pré-dessiné ----- */
    const gab = C.gabarit([ICI_GPS.longitude, ICI_GPS.latitude]);
    await verifier('PG-08', 'D', 'Quatre repères P1 à P4 et un polygone fermé apparaissent sans aucun geste', async () => { const e = await etiquettes(); return { ok: e.join(',') === 'P1,P2,P3,P4' && (await page.locator('#pcCarte path.leaflet-interactive, #pcCarte svg path').count()) >= 1, detail: e.join(',') }; });
    await verifier('PG-09', 'D', 'Gabarit identifié comme provisoire : consigne exacte, aucune superficie, « Terminer » et « Enregistrer » désactivés, rien d\'enregistré', async () => {
      const t = await texte(), b = await brouillon(PL.A);
      return { ok: t.includes('Ajustez les points aux limites de votre champ.') && /Gabarit provisoire/.test(t) && (await surface()) === '—' && (await perimetre()) === '—' && await page.locator('[data-pc="terminer"]').isDisabled() && await page.locator('[data-pc="envoyer"]').isDisabled() && !b, detail: (await surface()) + ' / brouillon ' + JSON.stringify(b).slice(0, 80) };
    });
    await verifier('PG-10', 'D', 'Le carré ne dépend pas de la superficie déclarée : côté fixe de ' + C.COTE_GABARIT_M + ' m (0,49 ha) pour 1,2 ha déclarés', async () => { const m = C.mesurer(gab); return { ok: Math.abs(m.area_m2 - 4900) < 1 && Math.abs(m.perimeter_m - 280) < 0.05, detail: m.area_m2 + ' m²' }; });
    await verifier('PG-11', 'D', 'Repères tactiles de 44 px au moins', async () => { const c = await centre('Point P1'); return { ok: c.l >= 44, detail: c.l + ' px' }; });
    await capture('03-carte-gabarit-390');

    /* ----- Test E : déplacement des repères ----- */
    const p3avant = await centre('Point P3');
    await glisser('Point P1', -38, -30);
    await verifier('PG-12', 'E', 'Glisser P1 : le contour suit, la superficie s\'affiche, le gabarit devient un contour, le brouillon est enregistré', async () => {
      const b = await brouillon(PL.A), s = await surface();
      return { ok: !!b && b.gabarit === false && b.sommets.length === 4 && (b.sommets[0][0] !== gab[0][0] || b.sommets[0][1] !== gab[0][1]) && s === haAttendu(b.sommets) && !/Gabarit provisoire/.test(await page.locator('#pcBarre').innerText()), detail: s + ' attendu ' + (b ? haAttendu(b.sommets) : '?') };
    });
    await verifier('PG-13', 'E', 'Glisser un repère ne déplace pas la carte (P3 reste au même endroit de l\'écran)', async () => { const a = await centre('Point P3'); return { ok: Math.abs(a.x - p3avant.x) < 1.5 && Math.abs(a.y - p3avant.y) < 1.5, detail: JSON.stringify([p3avant, a]) }; });
    await verifier('PG-14', 'E', 'Repère sélectionné mis en évidence', async () => (await page.locator('.leaflet-marker-icon.pc-sel[title="Point P1"]').count()) === 1);
    await glisser('Point P2', 34, -22); await glisser('Point P3', 40, 36);
    await glisserAuDoigt('Point P4', -30, 28);
    await verifier('PG-15', 'E', 'Les quatre points se déplacent (P4 au doigt, événements tactiles) ; superficie et périmètre recalculés sur les coordonnées', async () => {
      const b = await brouillon(PL.A), m = C.mesurer(b.sommets), tous = b.sommets.every((s, i) => s[0] !== gab[i][0] || s[1] !== gab[i][1]);
      return { ok: tous && (await surface()) === haAttendu(b.sommets) && (await perimetre()) === C.metres(m.perimeter_m) + ' m', detail: (await surface()) + ' · ' + (await perimetre()) + ' · tous déplacés=' + tous };
    });

    /* ----- Test F : déplacement du polygone ----- */
    const avantDepl = await brouillon(PL.A), mAvant = C.mesurer(avantDepl.sommets);
    await glisser('Déplacer tout le contour', 46, -40);
    await verifier('PG-16', 'F', 'La poignée ✥ déplace tout le contour sans changer ses dimensions (écart < 0,01 %)', async () => {
      const b = await brouillon(PL.A), m = C.mesurer(b.sommets), c0 = C.centroide(avantDepl.sommets), c1 = C.centroide(b.sommets), d = C.distance(c0, c1);
      return { ok: d > 5 && Math.abs(m.area_m2 - mAvant.area_m2) / mAvant.area_m2 < 1e-4 && Math.abs(m.perimeter_m - mAvant.perimeter_m) / mAvant.perimeter_m < 1e-4 && b.sommets.length === 4, detail: 'déplacé de ' + d.toFixed(1) + ' m ; ' + mAvant.area_m2.toFixed(2) + ' → ' + m.area_m2.toFixed(2) + ' m²' };
    });

    /* ----- Test G : plantation irrégulière ----- */
    await page.locator('.leaflet-marker-icon[title="Ajouter un point ici"]').first().click(); await page.waitForTimeout(300);
    await glisser('Point P2', 6, -34);
    await page.locator('.leaflet-marker-icon[title="Ajouter un point ici"]').nth(3).click(); await page.waitForTimeout(300);
    await verifier('PG-17', 'G', 'Cinquième et sixième points ajoutés sur les côtés ; calcul juste sur 6 points', async () => { const b = await brouillon(PL.A), e = await etiquettes(); return { ok: b.sommets.length === 6 && e.join(',') === 'P1,P2,P3,P4,P5,P6' && (await surface()) === haAttendu(b.sommets) && C.verifier(b.sommets).ok, detail: e.join(',') + ' · ' + (await surface()) }; });
    await page.locator('.leaflet-marker-icon[title="Point P5"]').click(); await page.locator('[data-pc="supprimer"]').click(); await page.waitForTimeout(250);
    await verifier('PG-18', 'G', 'Supprimer un point ; Annuler puis Rétablir', async () => {
      const n5 = (await brouillon(PL.A)).sommets.length; await page.locator('[data-pc="annuler"]').click(); await page.waitForTimeout(200); const n6 = (await brouillon(PL.A)).sommets.length;
      await page.locator('[data-pc="retablir"]').click(); await page.waitForTimeout(200); const n5b = (await brouillon(PL.A)).sommets.length; return { ok: n5 === 5 && n6 === 6 && n5b === 5, detail: [n5, n6, n5b].join(' → ') };
    });
    await verifier('PG-19', 'G', 'Impossible de descendre sous trois points', async () => {
      for (let i = 0; i < 2; i++) { await page.locator('.leaflet-marker-icon[title="Point P1"]').click(); await page.locator('[data-pc="supprimer"]').click(); await page.waitForTimeout(200); }
      const n = (await brouillon(PL.A)).sommets.length; await page.locator('.leaflet-marker-icon[title="Point P1"]').click(); await page.waitForTimeout(150);
      return { ok: n === 3 && await page.locator('[data-pc="supprimer"]').isDisabled(), detail: n + ' points' };
    });
    await page.locator('[data-pc="annuler"]').click(); await page.locator('[data-pc="annuler"]').click(); await page.waitForTimeout(250);
    await page.locator('#pcPlus > summary').click();
    const avantEch = C.mesurer((await brouillon(PL.A)).sommets);
    await page.locator('[data-pc="agrandir"]').click(); await page.waitForTimeout(250);
    await verifier('PG-20', 'F', 'Agrandir : même forme, superficie × 1,15² ; Réduire revient à la taille d\'origine', async () => {
      const g = C.mesurer((await brouillon(PL.A)).sommets); await page.locator('[data-pc="reduire"]').click(); await page.waitForTimeout(250); const r = C.mesurer((await brouillon(PL.A)).sommets);
      return { ok: Math.abs(g.area_m2 / avantEch.area_m2 - 1.3225) < 2e-3 && Math.abs(r.area_m2 / avantEch.area_m2 - 1) < 2e-3, detail: (g.area_m2 / avantEch.area_m2).toFixed(4) + ' puis ' + (r.area_m2 / avantEch.area_m2).toFixed(4) };
    });
    await capture('04-contour-ajuste-390');

    /* ----- Tests H (côté écran) et D : terminer, date d'image, enregistrement ----- */
    await page.locator('[data-pc="terminer"]').click(); await attendre('Superficie cartographique :'); await page.waitForTimeout(900);
    await verifier('PG-21', 'H', 'Terminer : « Superficie cartographique : X,XX ha » et « Périmètre : XXX m », en hectares et en mètres', async () => { const b = await brouillon(PL.A), m = C.mesurer(b.sommets), t = await texte(); return { ok: t.includes('Superficie cartographique : ' + C.hectares(m.area_m2) + ' ha') && t.includes('Périmètre : ' + C.metres(m.perimeter_m) + ' m'), detail: C.hectares(m.area_m2) + ' ha · ' + C.metres(m.perimeter_m) + ' m' }; });
    await verifier('PG-22', 'D', 'Imagerie : fournisseur, date de prise de vue, source et résolution lus dans la réponse du service (réponse d\'essai)', async () => { const t = await page.locator('#pcFondImage').innerText(); return { ok: /Fournisseur : Esri World Imagery/.test(t) && /Image du 14\/02\/2023/.test(t) && /Source : SOURCE FICTIVE DE TEST/.test(t) && /Résolution : 0,6 m/.test(t) && identify.length >= 1 && /layers=visible/.test(identify[0]) && !/token=/.test(identify[0]), detail: t }; });
    await verifier('PG-23', 'K', 'Enregistrer reste désactivé tant que la fiabilité et l\'identité de la parcelle ne sont pas confirmées', async () => page.locator('[data-pc="envoyer"]').isDisabled());
    await page.locator('#pcConfirm').selectOption('CONFIRMEE_SUR_PLACE'); await page.locator('input[name=pcConf][value=VISIBLES]').check(); await page.locator('#pcIdentite').check(); await page.waitForTimeout(200);
    const final = await brouillon(PL.A);
    await page.locator('[data-pc="envoyer"]').click(); await attendre('CHAMP FICTIF ALPHA'); await page.waitForTimeout(600);
    await verifier('PG-24', 'J', 'Un seul bouton « Enregistrer » : contour reçu par le serveur avec superficie, périmètre, date et source d\'image ; jamais de statut vérifié', async () => {
      const ops = etat.lots.flat().filter(x => x.type === 'SOUMETTRE_CONTOUR'), p = ops[0] && ops[0].payload, m = C.mesurer(final.sommets);
      return { ok: ops.length === 1 && Math.abs(p.area_m2_client - m.area_m2) < 0.01 && Math.abs(p.perimeter_m_client - m.perimeter_m) < 0.01 && p.imagery_date === '2023-02-14' && /Esri World Imagery/.test(p.imagery_source) && p.geometrie.coordinates[0].length === final.sommets.length + 1 && !/VERIF|VALIDE/i.test(JSON.stringify(Object.keys(p))) && p.identite_confirmee === true, detail: JSON.stringify(p).slice(0, 280) };
    });
    await verifier('PG-25', 'K', 'Aucun doublon : une seule opération de point et une seule de contour ont été envoyées pour cette parcelle', async () => { const t = etat.lots.flat().map(x => x.type); return { ok: t.filter(x => x === 'LOCALISER').length === 1 && t.filter(x => x === 'SOUMETTRE_CONTOUR').length === 1 && etat.parcelles.length === 3, detail: t.join(',') }; });

    /* ----- Recommencer + date d'image indisponible (parcelle B) ----- */
    etat.identifyKo = true;
    await accorder(PL.B);
    await page.locator('[data-pc="capturer"]').click();
    await page.waitForFunction(() => document.querySelector('.pc-ed-tete') && document.querySelectorAll('.leaflet-marker-icon[title^="Point P"]').length === 4, null, { timeout: 45000 }); await page.waitForTimeout(900);
    await verifier('PG-26', 'D', 'Service sans date exploitable (code 99999) : « Date de l\'image satellite non disponible », aucune date inventée', async () => { const t = await page.locator('#pcFondImage').innerText(); return { ok: t.includes('Date de l\'image satellite non disponible') && !/Image du/.test(t), detail: t }; });
    await glisser('Point P1', -30, -30); await page.locator('#pcPlus > summary').click(); await page.locator('[data-pc="effacer"]').click(); await page.locator('[data-pc="effacer-ok"]').click(); await page.waitForTimeout(300);
    await verifier('PG-27', 'D', 'Recommencer (après confirmation) : retour au gabarit provisoire, sans superficie', async () => { const b = await brouillon(PL.B); return { ok: b.gabarit === true && C.estGabarit(b.sommets, [ICI_GPS.longitude, ICI_GPS.latitude]) && (await surface()) === '—' && await page.locator('[data-pc="terminer"]').isDisabled(), detail: JSON.stringify(b.sommets) }; });
    await page.locator('[data-pc="agrandir"]').click(); await page.waitForTimeout(250);
    await verifier('PG-28', 'D', 'Agrandir un gabarit ne le transforme pas en mesure (toujours provisoire, toujours sans superficie)', async () => { const b = await brouillon(PL.B); return { ok: b.gabarit === true && (await surface()) === '—' && await page.locator('[data-pc="envoyer"]').isDisabled(), detail: await surface() }; });
    await capture('05-date-image-indisponible-390');

    /* ----- Retrait du consentement ----- */
    await aller('parcelles/parcours/' + PL.B, 'Cartographier le champ');
    await page.locator('.pc-plus > summary').last().click();
    await page.locator('[data-pc="accord-choix"][data-v="RETIRE"]').click(); await page.locator('#pcAccordMethode').selectOption('WITNESSED'); await page.locator('#pcAccordAtteste').check(); await page.locator('[data-pc="accord-enregistrer"]').click(); await attendre('Consentement GPS retiré');
    await verifier('PG-29', 'A', 'Retrait : historisé (WITHDRAWN), capture et carte bloquées, la parcelle n\'est pas supprimée', async () => {
      const d = derniere('P-FICTIF-B'); await aller('parcelles/tracer/' + PL.B + '/sat'); await attendre('Cartographier le champ');
      return { ok: d.status === 'WITHDRAWN' && d.scopes.gps === false && (await page.locator('[data-pc="capturer"]').count()) === 0 && (await page.locator('#pcCarte').count()) === 0 && etat.parcelles.some(p => p.plot_id === PL.B), detail: JSON.stringify(d).slice(0, 200) };
    });
    await capture('06-retrait-390');

    /* ----- Test I : hors connexion ----- */
    await accorder(PL.C);
    await aller('parcelles', 'parcelle(s)'); await page.waitForTimeout(500);                    // la liste (avec l'accord) est mise en cache sur le téléphone
    await aller('parcelles/parcours/' + PL.C, 'Cartographier le champ');
    await ctx.setOffline(true); await page.waitForTimeout(300);
    await aller('parcelles', 'parcelle(s)'); await aller('parcelles/parcours/' + PL.C, 'Cartographier le champ');
    await verifier('PG-30', 'I', 'Hors ligne, accord déjà connu : il n\'est pas présenté comme confirmé par le serveur à l\'instant', async () => { const t = await texte(); return { ok: /Consentement GPS accordé/.test(t) && /revérifié à la synchronisation/.test(t) && (await page.locator('[data-pc="capturer"]').count()) === 1, detail: t.slice(0, 260) }; });
    const lotsAvant = etat.lots.length;
    await page.locator('[data-pc="capturer"]').click(); await attendre('Position GPS enregistrée. La carte satellite sera disponible au retour de la connexion.', 45000);
    await verifier('PG-31', 'I', 'Hors ligne : position, précision et heure conservées sur le téléphone, rattachées à la parcelle ; message exact ; aucune carte satellite prétendue', async () => {
      const f = (await file()).filter(o => o.type === 'LOCALISER' && o.payload.plot_id === PL.C);
      return { ok: f.length === 1 && f[0].etat === 'ATTENTE' && f[0].payload.precision_m === 6 && !!f[0].payload.capture_le && etat.lots.length === lotsAvant && (await page.locator('a[href*="/tracer/"]').count()) === 0 && /en attente du serveur/.test(await texte()), detail: JSON.stringify(f).slice(0, 220) };
    });
    await capture('07-hors-ligne-390');
    /* 22/11/2026 : hors ligne, point en attente du serveur. La carte du champ reste un BROUILLON : accord non relu,
       point non confirmé, bouton Enregistrer désactivé, aucun envoi de contour dans la file. */
    await page.evaluate(id => { location.hash = '#parcelles/tracer/' + id + '/sat'; }, PL.C); await page.waitForTimeout(2500);
    await verifier('PG-39', 'I', 'Hors ligne, point en attente : la carte s\'ouvre en brouillon uniquement, sans accord présumé ni envoi possible', async () => {
      const t = await texte(), b = page.locator('[data-pc="envoyer"]');
      const contours = (await file()).filter(o => o.type === 'SOUMETTRE_CONTOUR' && o.payload.plot_id === PL.C).length;
      return { ok: /Brouillon uniquement/.test(t) && (await b.count()) === 1 && await b.isDisabled() && contours === 0, detail: t.slice(0, 200) + ' · contours en file : ' + contours };
    });
    await aller('parcelles/parcours/' + PL.C, 'Cartographier le champ');
    await verifier('PG-32', 'I', 'Hors ligne, accord inconnu : aucune capture, aucune décision recueillie', async () => {
      await page.evaluate(async () => { const l = await ANAGROCI_PARCELLES_LOCAL.cache.lire('parcelles'); l.forEach(x => { if (/BRAVO/.test(x.producteur_prenoms)) x.consentement_gps = false; }); await ANAGROCI_PARCELLES_LOCAL.cache.ecrire('parcelles', l); });
      await aller('parcelles', 'parcelle(s)'); await aller('parcelles/parcours/' + PL.B, 'Cartographier le champ'); const t = await texte();
      return { ok: (await page.locator('[data-pc="capturer"]').count()) === 0 && (await page.locator('[data-pc="accord-choix"]').count()) === 0 && /aucune décision ne peut être enregistrée ni présumée/.test(t), detail: t.slice(0, 220) };
    });

    /* ----- Test J : synchronisation au retour du réseau, après fermeture ----- */
    await ctx.setOffline(false);
    await ouvrir('parcelles/parcours/' + PL.C);
    await page.evaluate(() => ANAGROCI_PARCELLES.synchroniser(true)); await page.waitForTimeout(800);
    await verifier('PG-33', 'J', 'Page fermée puis rouverte, réseau revenu : le point en attente est reçu par le serveur ; un renvoi garde la même clé d\'idempotence (une seule écriture)', async () => {
      const f = (await file()).filter(o => o.type === 'LOCALISER' && o.payload.plot_id === PL.C), env = etat.lots.flat().filter(o => o.type === 'LOCALISER' && o.payload.plot_id === PL.C), cles = new Set(env.map(o => o.idempotency_key)), p = etat.parcelles[2];
      /* Un renvoi après coupure est normal (la page a pu être fermée pendant l'envoi) : il porte la MÊME clé d'idempotence, donc une seule écriture. */
      return { ok: f.length === 1 && f[0].etat === 'RECU' && cles.size === 1 && p.gps_status === 'POINT_CAPTURED' && Math.abs(p.latitude - ICI_GPS.latitude) < 1e-6, detail: 'état ' + f[0].etat + ' · ' + env.length + ' envoi(s), ' + cles.size + ' clé(s) d\'idempotence, ' + etat.rejeux + ' rejeu(x) sans effet' };
    });
    await verifier('PG-34', 'A', 'Point envoyé sans accord actif : refusé par le serveur, signalé à l\'agent, non conservé comme repère', async () => {
      etat.consentements.push({ producteur_id: 'P-FICTIF-C', status: 'WITHDRAWN', scopes: { gps: false }, event_order: ++etat.ordre, consent_at: new Date().toISOString() });
      const r = await page.evaluate(async id => { const C = ANAGROCI_PARCELLES_COEUR, L = ANAGROCI_PARCELLES_LOCAL; const o = C.operation('LOCALISER', { plot_id: id, latitude: 7.7003, longitude: -5.0297, precision_m: 6, capture_le: new Date().toISOString() }, L.appareil()); await L.file.ajouter(o, 'essai'); const b = await ANAGROCI_PARCELLES.synchroniser(true); return { b, l: (await L.file.toutes()).filter(z => z.idempotency_key === o.idempotency_key)[0] }; }, PL.C);
      return { ok: r.l.etat === 'REJETE' && /accord/.test(r.l.message), detail: JSON.stringify(r.l).slice(0, 200) };
    });

    /* ----- Affichage : trois largeurs ----- */
    etat.identifyKo = false;
    for (const [l, h] of [[390, 844], [768, 1024], [1440, 900]]) {
      await ouvrir('parcelles/tracer/' + PL.A + '/sat', l, h);
      await page.waitForFunction(() => document.querySelectorAll('.leaflet-marker-icon[title^="Point P"]').length >= 3, null, { timeout: 30000 }); await page.waitForTimeout(500);
      await verifier('PG-35-' + l, 'Affichage', 'Carte du champ à ' + l + '×' + h + ' : pas de défilement horizontal, boutons de la barre non superposés, carte ≥ 260 px', async () => {
        const r = await page.evaluate(() => { const d = document.documentElement, b = [].slice.call(document.querySelectorAll('#pcBarre .pc-cmd-grille .btn')).map(x => x.getBoundingClientRect()), c = document.getElementById('pcCarte').getBoundingClientRect();
          let chevauche = false; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i].left < b[j].right - 1 && b[j].left < b[i].right - 1 && b[i].top < b[j].bottom - 1 && b[j].top < b[i].bottom - 1) chevauche = true;
          return { debord: d.scrollWidth - d.clientWidth, chevauche, carte: Math.round(c.height), hmin: Math.min.apply(null, b.map(x => Math.round(x.height))) }; });
        return { ok: r.debord <= 1 && !r.chevauche && r.carte >= 260 && r.hmin >= 44, detail: JSON.stringify(r) };
      });
      await capture('08-carte-' + l);
      await aller('parcelles/parcours/' + PL.A, 'Cartographier le champ'); await capture('09-parcours-' + l);
    }
    await verifier('PG-36', 'Affichage', 'Aucune erreur JavaScript pendant tout le parcours', async () => ({ ok: erreurs.length === 0, detail: erreurs.slice(0, 3).join(' | ') }));
  } finally {
    await browser.close(); srv.close();
    mkdirSync(OUT, { recursive: true });
    const ok = R.filter(x => x.resultat === 'RÉUSSI').length;
    writeFileSync(join(OUT, 'navigateur.json'), JSON.stringify({ execute_le: new Date().toISOString(), nature: 'Chromium + doublure serveur en mémoire : ne prouve ni la RLS, ni PostGIS, ni le fonctionnement Android', reussis: ok, total: R.length, resultats: R }, null, 1));
    console.log('\n' + ok + ' / ' + R.length + ' réussis');
    process.exitCode = ok === R.length ? 0 : 1;
  }
}
main().catch(e => { console.error(e); process.exit(1); });
