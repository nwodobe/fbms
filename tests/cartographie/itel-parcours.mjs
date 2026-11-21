#!/usr/bin/env node
/* ESSAI SUR L'ITEL S688LN (22/11/2026) — parcours Parcelles dans le vrai Chrome du téléphone.
   Le PC sert les fichiers du commit e476474 ; le téléphone y accède par « adb reverse » (http://localhost).
   Serveur = DOUBLURE EN MÉMOIRE (aucune écriture Supabase, aucune donnée réelle) ; GPS = vrai GPS du téléphone ;
   gestes = événements tactiles injectés dans Chrome du téléphone + un glisser système « adb input swipe ».
   Pas d'imagerie satellite (aucune clé réelle utilisée) : fond neutre.
   Usage : node itel-parcours.mjs <racine du dépôt> <dossier des preuves> <numéro de série adb> */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { execFileSync } from 'node:child_process';
const [ROOT, OUT, SERIE] = process.argv.slice(2);
/* ESRI_CLE_FICHIER : chemin d'un fichier contenant la clé Esri (hors dépôt). Elle n'est gardée qu'en mémoire,
   servie à la page d'essai, jamais écrite dans un résultat ni dans un journal. Sans elle : fond neutre.
   MODE=MANUEL : aucun geste automatique. La personne manipule le téléphone de ses doigts ; le script enregistre
   l'écran (screenrecord) et relève l'état toutes les 3 s jusqu'à l'enregistrement du contour (ou 20 min). */
const CLE_ESRI = process.env.ESRI_CLE_FICHIER && existsSync(process.env.ESRI_CLE_FICHIER) ? readFileSync(process.env.ESRI_CLE_FICHIER, 'utf8').trim() : null;
const MANUEL = process.env.MODE === 'MANUEL';
const ADB = 'C:\\Dev\\tools\\android-sdk\\platform-tools\\adb.exe';
const PORT = 4371, PCDP = 9446;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const UH = '00000000-0000-4000-8000-0000000000d1';
const PL = { A: '31000000-0000-4000-8000-000000000001', B: '31000000-0000-4000-8000-000000000002', C: '31000000-0000-4000-8000-000000000003' };
const adb = (...a) => execFileSync(ADB, ['-s', SERIE, ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const adbBin = (...a) => execFileSync(ADB, ['-s', SERIE, ...a], { timeout: 30000, maxBuffer: 64 << 20 });
mkdirSync(OUT, { recursive: true });
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
    else if (d.table === 'plot_map_parametres') l = [{ cle: 'activation', valeur: { localisation: true, contours: true, clusters_pilotes: ['BROBO'] } }, { cle: 'imagerie', valeur: CLE_ESRI ? { fournisseur: 'esri', licence_confirmee: true, cle: CLE_ESRI } : { fournisseur: 'aucun' } },
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


function serveur() {
  return createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/__pont' && req.method === 'POST') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        let corps; try { corps = { data: pont(JSON.parse(b)), error: null }; } catch (e) { corps = { data: null, error: { message: e.message } }; }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(corps));
      }); return;
    }
    if (/\/(sw|i18n-sw)\.js$/.test(p)) { res.writeHead(404).end(''); return; }   // aucun Service Worker pendant l'essai
    let file = normalize(join(ROOT, p)); if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end('missing'); return; }
    let corps = readFileSync(file);
    if (/operations[\\/]field-buying\.html$/.test(file)) {
      corps = corps.toString('utf8').replace(/<script[^>]*supabase-js@2[^>]*><\/script>/, '').replace('<head>', () => '<head><script>' + STUB + '</script>');
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(corps);
  });
}

/* ---------- pilotage de Chrome sur le téléphone (CDP) ---------- */
let ws, n = 0; const attente = {};
async function connecter() {
  adb('forward', 'tcp:' + PCDP, 'localabstract:chrome_devtools_remote');
  const url = `http://127.0.0.1:${PORT}/operations/field-buying.html#parcelles/p/${PL.A}`;
  /* L'onglet est ouvert par « am start » (intention Android) ; on s'y attache. */
  let cible = null;
  for (let i = 0; i < 20 && !cible; i++) {
    const l = await (await fetch(`http://127.0.0.1:${PCDP}/json/list`)).json().catch(() => []);
    cible = (Array.isArray(l) ? l : []).find(t => t.type === 'page' && t.url.indexOf('localhost:' + PORT) >= 0) || null;
    if (!cible) await pause(1000);
  }
  if (!cible) throw new Error('onglet Chrome de l\'essai introuvable sur le téléphone');
  ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && attente[d.id]) { attente[d.id](d); delete attente[d.id]; } };
  await cdp('Page.bringToFront'); return cible;
}
function cdp(method, params = {}) { const id = ++n; ws.send(JSON.stringify({ id, method, params })); return new Promise(ok => { attente[id] = ok; setTimeout(() => { if (attente[id]) { delete attente[id]; ok({ error: { message: 'délai' } }); } }, 60000); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception ? r.result.exceptionDetails.exception.description : 'exception'); return r.result && r.result.result ? r.result.result.value : undefined; }
const pause = ms => new Promise(r => setTimeout(r, ms));
async function attendre(js, ms = 30000) { const fin = Date.now() + ms; for (;;) { try { if (await ev(js)) return true; } catch (e) {} if (Date.now() > fin) throw new Error('délai dépassé : ' + js.slice(0, 90)); await pause(400); } }
const texte = () => ev("(document.getElementById('opsRouteView')||{}).innerText||''");
const clic = sel => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('absent : '+${JSON.stringify(sel)});e.scrollIntoView({block:'center'});e.click();return true;})()`);
function capture(nom) { writeFileSync(join(OUT, nom + '.png'), adbBin('exec-out', 'screencap', '-p')); }
async function centre(titre) { return ev(`(function(){var e=document.querySelector('.leaflet-marker-icon[title="${titre}"]');if(!e)return null;var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,l:r.width};})()`); }
async function glisserTactile(titre, dx, dy) {
  const c = await centre(titre); if (!c) throw new Error('repère ' + titre + ' absent');
  const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(c.x, c.y) });
  for (let i = 1; i <= 10; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(c.x + dx * i / 10, c.y + dy * i / 10) }); await pause(25); }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pause(500);
}
/* Calibrage écran : un « tap » système à une position connue, relu par la page, donne le décalage entre pixels écran et pixels CSS. */
async function calibrer() {
  await ev("window.__tap=null;document.addEventListener('touchstart',function(e){window.__tap={x:e.touches[0].clientX,y:e.touches[0].clientY};},{capture:true,once:true});true");
  const W = 540, H = 1500; adb('shell', 'input', 'tap', String(W), String(H)); await pause(800);
  const t = await ev('window.__tap'), dpr = await ev('window.devicePixelRatio');
  if (!t) return null; return { dpr, ox: W - t.x * dpr, oy: H - t.y * dpr };
}
const R = [];
function note(id, test, lib, ok, detail) { R.push({ id, test, libelle: lib, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', detail: String(detail ?? '').slice(0, 400) }); console.log((ok ? 'RÉUSSI  ' : 'ÉCHOUÉ  ') + id + ' ' + lib + ' — ' + String(detail ?? '').slice(0, 300)); }
async function verifier(id, test, lib, fn) { try { const r = await fn(); note(id, test, lib, r === true || (r && r.ok), r && r.detail !== undefined ? r.detail : r); } catch (e) { note(id, test, lib, false, e.message); } }
const brouillon = id => ev(`ANAGROCI_PARCELLES_LOCAL.brouillon.lire('${id}')`);

/* ---------- session manuelle (doigts réels, vidéo de l'écran) ---------- */
async function sessionManuelle(modele, android, vue) {
  const journal = [], videos = [], t0 = Date.now();
  note('MAN-00', 'Contexte', 'Session manuelle ouverte dans Chrome sur le téléphone', true, modele + ' · Android ' + android + ' · ' + JSON.stringify(vue) + ' · imagerie ' + (CLE_ESRI ? 'Esri (clé réelle, gardée en mémoire)' : 'aucune'));
  /* Sonde Esri : une vraie tuile World Imagery demandée par le navigateur du téléphone, depuis la page d'essai. */
  const sonde = await ev(`new Promise(function(ok){ var p=(window.ANAGROCI_PARCELLES&&true); var u='https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/16/32210/32253?token='+encodeURIComponent(${JSON.stringify(CLE_ESRI || '')}); var i=new Image(), t=setTimeout(function(){ok('délai');},15000); i.onload=function(){clearTimeout(t);ok('tuile reçue '+i.naturalWidth+'x'+i.naturalHeight);}; i.onerror=function(){clearTimeout(t);ok('tuile refusée');}; i.src=u; })`);
  note('MAN-01', 'Esri', 'Tuile World Imagery réelle chargée par le téléphone (zone de Bouaké, niveau 16)', /reçue 256x256/.test(sonde), sonde);
  let n = 0, enCours = null;
  const { spawn } = await import('node:child_process');
  let rec = null;
  function lancerVideo() { const f = '/sdcard/fbms-essai-' + (++n) + '.mp4'; videos.push(f); rec = spawn(ADB, ['-s', SERIE, 'shell', 'screenrecord', '--time-limit', '170', '--bit-rate', '4000000', f]); rec.on('exit', () => { rec = null; }); }
  lancerVideo();
  console.log('ESSAI MANUEL EN COURS : la personne manipule le téléphone. Fin automatique à l\'enregistrement du contour (20 min max).');
  let fini = false, dernier = '';
  while (!fini && Date.now() - t0 < 20 * 60000) {
    await pause(3000);
    if (!rec) lancerVideo();
    let e = null;
    try {
      e = await ev(`(async function(){ var r=document.getElementById('opsRouteView'), b=null, pid=(location.hash.match(/(31000000-[0-9a-f-]+)/)||[])[1];
        if (pid && window.ANAGROCI_PARCELLES_LOCAL) b=await ANAGROCI_PARCELLES_LOCAL.brouillon.lire(pid);
        var q=function(s){var x=document.querySelector(s);return x?x.innerText.trim():null;};
        var tu=performance.getEntriesByType('resource').filter(function(x){return /ibasemaps-api\.arcgis\.com.*\/tile\//.test(x.name);}).length;
        return {h:location.hash.replace(/31000000-0000-4000-8000-0000000000/,'P'), titre:q('#opsRouteView h1')||q('.pc-ed-tete b'), sommets:b&&b.sommets?b.sommets.length:null, gabarit:b?!!b.gabarit:null,
          surface:q('#pcBarre .pc-surface'), perimetre:q('#pcBarre .pc-perimetre'), image:q('#pcFondImage'), alerte:q('#pcFondAlerte'), tuiles:tu, zoom:window.L&&document.querySelector('#pcCarte')?null:null};})()`);
    } catch (x) { e = { erreur: x.message }; }
    const cle = JSON.stringify(e);
    if (cle !== dernier) { dernier = cle; journal.push({ t: Math.round((Date.now() - t0) / 1000), ...e }); console.log('[' + Math.round((Date.now() - t0) / 1000) + ' s] ' + cle.slice(0, 260)); }
    if (etat.lots.flat().some(o => o.type === 'SOUMETTRE_CONTOUR')) { fini = true; await pause(4000); }
  }
  if (rec) { try { execFileSync(ADB, ['-s', SERIE, 'shell', 'pkill', '-INT', 'screenrecord']); } catch (e) {} await pause(3000); }
  const vid = [];
  for (const f of videos) { const local = join(OUT, f.split('/').pop()); try { execFileSync(ADB, ['-s', SERIE, 'pull', f, local], { timeout: 120000 }); execFileSync(ADB, ['-s', SERIE, 'shell', 'rm', '-f', f]); vid.push(f.split('/').pop()); } catch (e) {} }
  const loc = etat.lots.flat().find(o => o.type === 'LOCALISER'), cont = etat.lots.flat().find(o => o.type === 'SOUMETTRE_CONTOUR');
  note('MAN-02', 'B', 'Capture GPS réelle (doigt de la personne, GPS du téléphone)', !!loc, loc ? 'précision ' + loc.payload.precision_m + ' m · heure ' + loc.payload.capture_le + ' (coordonnées non recopiées)' : 'aucune capture acceptée');
  note('MAN-03', 'J', 'Contour enregistré après ajustement aux doigts', !!cont, cont ? Math.round(cont.payload.area_m2_client) + ' m² · ' + Math.round(cont.payload.perimeter_m_client) + ' m · ' + (cont.payload.geometrie.coordinates[0].length - 1) + ' sommets · image ' + (cont.payload.imagery_date || 'date non disponible') + ' · ' + (cont.payload.imagery_source || '') : 'pas de contour');
  /* Géométrie gardée HORS des résultats (fichier séparé, à ne pas diffuser) pour la seule comparaison PostGIS. */
  if (cont) writeFileSync(join(OUT, 'NE-PAS-DIFFUSER-geometrie-essai.json'), JSON.stringify({ geojson: cont.payload.geometrie, area_m2_client: cont.payload.area_m2_client, perimeter_m_client: cont.payload.perimeter_m_client }));
  writeFileSync(join(OUT, 'session-manuelle-journal.json'), JSON.stringify({ duree_s: Math.round((Date.now() - t0) / 1000), videos: vid, consentements: etat.insertions.map(x => ({ status: x.status, gps: x.scopes.gps, method: x.method, consent_at: x.consent_at })), journal }, null, 1));
}

async function main() {
  const srv = serveur(); await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  adb('reverse', 'tcp:' + PORT, 'tcp:' + PORT);
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `http://localhost:${PORT}/operations/field-buying.html#parcelles/p/${PL.A}`, 'com.android.chrome');
  await pause(5000);
  const modele = adb('shell', 'getprop', 'ro.product.model'), android = adb('shell', 'getprop', 'ro.build.version.release');
  let cible;
  try {
    cible = await connecter();
    await cdp('Browser.grantPermissions', { origin: `http://localhost:${PORT}`, permissions: ['geolocation'] }).catch(() => {});
    await attendre("!!(window.ANAGROCI_AUTH && window.ANAGROCI_PARCELLES && document.querySelector('#opsRouteView .ops-route-head'))", 60000);
    await pause(1500);
    const ua = await ev('navigator.userAgent'), vue = await ev('({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})');
    if (MANUEL) { await sessionManuelle(modele, android, vue); return; }
    note('IT-00', 'Contexte', 'Page FBMS (commit e476474) ouverte dans Chrome sur le téléphone', true, modele + ' · Android ' + android + ' · ' + JSON.stringify(vue) + ' · ' + ua.slice(0, 120));
    capture('10-itel-fiche-parcelle');
    await verifier('IT-01', 'A', 'Fiche : une seule action « Cartographier ce champ »', async () => (await ev(`document.querySelectorAll('a[href="#parcelles/parcours/${PL.A}"]').length`)) === 1);
    await ev(`location.hash='parcelles/parcours/${PL.A}';true`); await attendre("(document.getElementById('opsRouteView')||{}).innerText.indexOf('Cartographier le champ')>=0"); await pause(800);
    await verifier('IT-02', 'A', 'Aucune décision : phrase d\'accord, J\'accepte / Je refuse, rien de présélectionné, pas de bouton de capture', async () => { const t = await texte(); return { ok: t.includes('nous avons besoin de votre accord pour enregistrer ses coordonnées géographiques') && (await ev("document.querySelectorAll('[data-pc=accord-choix][aria-pressed=true]').length")) === 0 && (await ev("document.querySelectorAll('[data-pc=capturer]').length")) === 0, detail: t.slice(0, 160) }; });
    capture('11-itel-accord-a-recueillir');
    await clic('[data-pc="accord-choix"][data-v="REFUSE"]'); await ev("var s=document.getElementById('pcAccordMethode');s.value='VERBAL';s.dispatchEvent(new Event('change',{bubbles:true}));var c=document.getElementById('pcAccordAtteste');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));true");
    await clic('[data-pc="accord-enregistrer"]'); await attendre("(document.getElementById('opsRouteView')||{}).innerText.indexOf('Consentement GPS refusé')>=0");
    await verifier('IT-03', 'A', 'Refus enregistré : capture et carte bloquées', async () => { await ev(`location.hash='parcelles/tracer/${PL.A}/sat';true`); await pause(2500); return { ok: (await ev("document.querySelectorAll('#pcCarte').length")) === 0 && (await ev("document.querySelectorAll('[data-pc=capturer]').length")) === 0, detail: etat.insertions.map(x => x.status).join(',') }; });
    capture('12-itel-refus-bloque');
    await ev(`location.hash='parcelles/parcours/${PL.A}';true`); await attendre("(document.getElementById('opsRouteView')||{}).innerText.indexOf('Cartographier le champ')>=0"); await pause(600);
    await ev("var d=[].slice.call(document.querySelectorAll('.pc-plus>summary')).pop();if(d)d.click();true");
    await clic('[data-pc="accord-choix"][data-v="ACCORDE"]'); await ev("var s=document.getElementById('pcAccordMethode');s.value='VERBAL';s.dispatchEvent(new Event('change',{bubbles:true}));var c=document.getElementById('pcAccordAtteste');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));true");
    await clic('[data-pc="accord-enregistrer"]'); await attendre("(document.getElementById('opsRouteView')||{}).innerText.indexOf('Consentement GPS accordé')>=0");
    await verifier('IT-04', 'A', 'Accord enregistré (historique : refus puis accord), bouton CAPTURER MA POSITION GPS', async () => ({ ok: etat.insertions.length === 2 && etat.insertions[1].scopes.gps === true && (await ev("document.querySelectorAll('[data-pc=capturer]').length")) === 1, detail: etat.insertions.map(x => x.status + '/gps=' + x.scopes.gps).join(' → ') }));
    capture('13-itel-accord-donne');
    /* Test B : capture avec le VRAI GPS du téléphone */
    /* POSITION_ESSAI=1 : position fictive fournie au navigateur (outil de test, annoncée dans le rapport) quand le
       GPS réel ne peut pas atteindre la précision exigée (intérieur, nuit). Sans cette variable : GPS réel du téléphone. */
    const essai = process.env.POSITION_ESSAI === '1';
    if (essai) await cdp('Emulation.setGeolocationOverride', { latitude: 7.7003, longitude: -5.0297, accuracy: 6 });
    note('IT-04b', 'B', 'Source de la position pour la suite de l\'essai', true, essai ? 'POSITION D\'ESSAI FICTIVE (7.7003, -5.0297, 6 m) injectée dans Chrome : le GPS réel n\'est PAS testé dans ce passage' : 'GPS réel du téléphone');
    const t0 = Date.now(); await clic('[data-pc="capturer"]'); await pause(1500); capture('14-itel-capture-en-cours');
    let issue = 'inconnue';
    try { await attendre("!!document.querySelector('.pc-ed-tete') || /Précision insuffisante|Aucune position|refusée|ne répond pas|introuvable/.test((document.getElementById('opsRouteView')||{}).innerText)", 60000); issue = await ev("document.querySelector('.pc-ed-tete')?'carte':(document.getElementById('opsRouteView').innerText.slice(0,300))"); } catch (e) { issue = 'délai : ' + e.message; }
    const loc = etat.lots.flat().find(o => o.type === 'LOCALISER');
    await verifier('IT-05', 'B', (process.env.POSITION_ESSAI === '1' ? 'Capture (position d\'essai) : ' : 'Capture avec le GPS réel de l\'itel : ') + 'latitude, longitude, précision et heure renseignées seules', async () => ({ ok: !!loc && loc.payload.precision_m > 0 && !!loc.payload.capture_le, detail: loc ? 'précision ' + loc.payload.precision_m + ' m · heure ' + loc.payload.capture_le + ' · durée ' + Math.round((Date.now() - t0) / 1000) + ' s (coordonnées non recopiées dans ce rapport)' : String(issue).slice(0, 250) }));
    if (issue !== 'carte') { capture('15-itel-capture-issue'); throw new Error('Arrêt : pas de carte après la capture (' + String(issue).slice(0, 160) + ')'); }
    await pause(1500);
    await verifier('IT-06', 'C', 'La carte s\'ouvre seule après la capture', async () => (await ev("location.hash")).indexOf('tracer/') >= 0);
    await verifier('IT-07', 'D', 'P1 à P4 posés autour du point, contour en pointillés, aucune superficie, Terminer et Enregistrer grisés', async () => { const e = await ev("[].slice.call(document.querySelectorAll('.leaflet-marker-icon[title^=\"Point P\"] span')).map(function(x){return x.innerText}).join(',')"); return { ok: e === 'P1,P2,P3,P4' && (await ev("document.querySelector('#pcBarre .pc-surface').innerText")) === '—' && (await ev("document.querySelector('[data-pc=terminer]').disabled")) && (await ev("document.querySelector('[data-pc=envoyer]').disabled")), detail: e }; });
    await verifier('IT-08', 'D', 'Repères d\'au moins 44 px CSS sur l\'écran de l\'itel', async () => { const c = await centre('Point P1'); return { ok: c && c.l >= 44, detail: c && (c.l + ' px CSS, soit ' + Math.round(c.l * vue.dpr) + ' px physiques') }; });
    capture('16-itel-carte-gabarit');
    /* Test E : un repère tiré par un VRAI geste système (adb input swipe), puis les autres au toucher injecté */
    const cal = await calibrer(); await pause(400);
    const p3av = await centre('Point P3');
    if (cal) { const c = await centre('Point P1'), x = Math.round(cal.ox + c.x * cal.dpr), y = Math.round(cal.oy + c.y * cal.dpr); adb('shell', 'input', 'swipe', String(x), String(y), String(x - 100), String(y - 90), '900'); await pause(1200); }
    await verifier('IT-09', 'E', 'P1 glissé par un geste système sur l\'écran (adb input swipe) : le contour suit, la superficie apparaît', async () => { const b = await brouillon(PL.A), s = await ev("document.querySelector('#pcBarre .pc-surface').innerText"); return { ok: !!cal && !!b && b.gabarit === false && s !== '—', detail: 'calibrage ' + JSON.stringify(cal) + ' · superficie ' + s }; });
    await verifier('IT-10', 'E', 'Pendant le glisser, la carte ne bouge pas (P3 reste en place)', async () => { const a = await centre('Point P3'); return { ok: Math.abs(a.x - p3av.x) < 2 && Math.abs(a.y - p3av.y) < 2, detail: JSON.stringify([p3av, a]) }; });
    capture('17-itel-p1-deplace');
    await glisserTactile('Point P2', 40, -30); await glisserTactile('Point P3', 45, 40); await glisserTactile('Point P4', -35, 30);
    await verifier('IT-11', 'E', 'Les quatre points déplacés ; superficie et périmètre recalculés', async () => { const b = await brouillon(PL.A); return { ok: b.sommets.length === 4 && b.gabarit === false, detail: (await ev("document.querySelector('#pcBarre .pc-surface').innerText")) + ' · ' + (await ev("document.querySelector('#pcBarre .pc-perimetre').innerText")) }; });
    const av = await brouillon(PL.A);
    await glisserTactile('Déplacer tout le contour', 50, -40);
    await verifier('IT-12', 'F', 'Poignée ✥ : tout le contour déplacé, superficie inchangée', async () => { const b = await brouillon(PL.A); const s1 = await ev(`ANAGROCI_PARCELLES_COEUR.mesurer(${JSON.stringify(av.sommets)}).area_m2`), s2 = await ev(`ANAGROCI_PARCELLES_COEUR.mesurer(${JSON.stringify(b.sommets)}).area_m2`); return { ok: JSON.stringify(av.sommets) !== JSON.stringify(b.sommets) && Math.abs(s1 - s2) / s1 < 1e-4, detail: s1.toFixed(2) + ' → ' + s2.toFixed(2) + ' m²' }; });
    await ev("document.querySelector('.leaflet-marker-icon[title=\"Ajouter un point ici\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true"); await pause(600);
    await verifier('IT-13', 'G', 'Cinquième point ajouté sur un côté (champ irrégulier), calcul sur 5 points', async () => { const b = await brouillon(PL.A); return { ok: b.sommets.length === 5, detail: (await ev("document.querySelector('#pcBarre .pc-surface').innerText")) }; });
    capture('18-itel-contour-ajuste');
    await clic('[data-pc="terminer"]'); await pause(1200);
    await verifier('IT-14', 'H', '« Superficie cartographique : X,XX ha » et « Périmètre : XXX m » affichés', async () => { const t = await texte(); const m = t.match(/Superficie cartographique : [\d ,]+ ha/), p = t.match(/Périmètre : [\d  ]+ m/); return { ok: !!m && !!p, detail: (m && m[0]) + ' · ' + (p && p[0]) }; });
    capture('19-itel-terminer');
    await ev("var c=document.getElementById('pcConfirm');c.value='CONFIRMEE_SUR_PLACE';c.dispatchEvent(new Event('change',{bubbles:true}));true"); await pause(300);
    await ev("var r=document.querySelector('input[name=pcConf][value=PARTIELLES]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));var i=document.getElementById('pcIdentite');i.checked=true;i.dispatchEvent(new Event('change',{bubbles:true}));true"); await pause(400);
    await clic('[data-pc="envoyer"]'); await pause(3000);
    await verifier('IT-15', 'J', 'Enregistrer : un seul contour reçu par la doublure serveur, superficie cohérente', async () => { const o = etat.lots.flat().filter(x => x.type === 'SOUMETTRE_CONTOUR'); return { ok: o.length === 1 && o[0].payload.area_m2_client > 0, detail: o.length + ' envoi(s) · ' + (o[0] ? Math.round(o[0].payload.area_m2_client) + ' m² · ' + Math.round(o[0].payload.perimeter_m_client) + ' m' : '') }; });
    capture('20-itel-enregistre');
    await verifier('IT-16', 'Affichage', 'Aucun défilement horizontal sur l\'écran de l\'itel', async () => { const d = await ev('document.documentElement.scrollWidth-document.documentElement.clientWidth'); return { ok: d <= 1, detail: d + ' px' }; });
  } catch (e) { note('IT-ARRET', 'Déroulé', 'Essai interrompu', false, e.message); }
  finally {
    try { adb('reverse', '--remove', 'tcp:' + PORT); adb('forward', '--remove', 'tcp:' + PCDP); } catch (e) {}
    srv.close();
    writeFileSync(join(OUT, MANUEL ? 'session-manuelle-resultats.json' : process.env.POSITION_ESSAI === '1' ? 'itel-parcours-position-essai.json' : 'itel-parcours-gps-reel.json'), JSON.stringify({ execute_le: new Date().toISOString(), appareil: SERIE.slice(0, 4) + '…', nature: 'Chrome réel sur itel S688LN, GPS réel, doublure serveur en mémoire (aucune écriture Supabase), sans image satellite', resultats: R }, null, 1));
    const ok = R.filter(x => x.resultat === 'RÉUSSI').length; console.log('\n' + ok + ' / ' + R.length + ' réussis'); process.exit(0);
  }
}
main();
