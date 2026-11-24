/**
 * Banc commun du module Réseau (recherche, accès « Nouveau village » / « Nouveau RT »).
 *
 * Réutilise la doublure Supabase de tests/field-buying-e2e.mjs (données FICTIVES) et
 * l'enrichit de cas difficiles pour la recherche : homonymes dans deux clusters,
 * accents, apostrophes (droite et typographique), traits d'union, et 650 producteurs
 * supplémentaires pour qu'une fiche se trouve au-delà de la première page.
 * Aucune donnée réelle : tous les noms portent « FICTIF » ou sont des toponymes
 * génériques inventés.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

export const RACINE = process.cwd();
export const MODE_APK = process.env.FBMS_MODE_APK === '1';
export const WEB = MODE_APK ? resolve(RACINE, 'android/app/src/main/assets/www') : RACINE;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const NATIF = `window.AnagrociNative={shellStatus:function(){return JSON.stringify({bundled:true,missing:[],version:'1.4.3 (banc)'});},
  appInfo:function(){return JSON.stringify({app:'ANAGROCI FIELD BUYING',version:'1.4.3 (banc)',package:'ci.anagroci.fieldbuying.banc'});},
  updateStatus:function(){return '{"enabled":false}';},confirmBoot:function(){},reportQueue:function(n){window.__queue=n;},
  saveFile:function(){return '{"ok":true}';},print:function(){}};`;

const source = readFileSync(join(RACINE, 'tests/field-buying-e2e.mjs'), 'utf8');
const m = source.match(/const DOUBLURE = `([\s\S]*?)`;\n/);
if (!m) throw new Error('Doublure introuvable dans tests/field-buying-e2e.mjs');
const LIGNE_PROFIL = "profils: { nom: 'PROFIL DE TEST', role: 'Branch Manager', actif: true }";
const ANCRE = "  FARMERS.push({ producteur_id: 'p_rt4'";
if (!m[1].includes(LIGNE_PROFIL) || !m[1].includes(ANCRE)) throw new Error('Ancres de la doublure introuvables');

/* Cas de recherche ajoutés AVANT le producteur p_rt4 (même portée de variables). */
const CAS = `
  /* --- cas Réseau : homonymes, accents, apostrophes --- */
  [['v_hom_1', 'KONANKRO FICTIF', 'Botro', 'BOTRO'], ['v_hom_2', 'KONANKRO FICTIF', 'Diabo', 'DIABO'],
   ['v_apo_1', "N'GUESSANKRO FICTIF", 'Botro', 'BOTRO'], ['v_apo_2', 'N’ZIKRO FICTIF', 'Sakassou', 'SAKASSOU'],
   ['v_acc_1', 'Élèvekro Fictif', 'Béoumi', 'BEOUMI']].forEach(function (x, j) {
    VILLAGES.push({ id: x[0], village: x[1], region: 'Gbêkê', departement: 'Bouaké', cluster: x[2], cluster_code: x[3],
      /* N'ZIKRO (j = 3) reste SANS coordonnées : cas « village non placé sur la carte ». */
      statut: 'Approuvé BM', score: 50, gps_lat: j === 3 ? null : 7.55 + j * 0.03, gps_lng: j === 3 ? null : -5.2 + j * 0.03, deleted: false, farmer_code_prefix: 'VF' + (90 + j),
      data: { s1: { village: x[1], cluster: x[2] } } });
  });
  RTS.push({ id: 'rt_hom_1', id_rt: 'RT-HOM-1', nom: 'KOUAME FICTIF YAO', telephone: '0700000091', village_id: 'v_hom_1',
    village_nom: 'KONANKRO FICTIF', cluster: 'Botro', statut: 'Confirmé', score: 70, deleted: false, data: {} });
  RTS.push({ id: 'rt_hom_2', id_rt: 'RT-HOM-2', nom: 'KOUAME FICTIF YAO', telephone: '0700000092', village_id: 'v_hom_2',
    village_nom: 'KONANKRO FICTIF', cluster: 'Diabo', statut: 'Confirmé', score: 70, deleted: false, data: {} });
  RTS.push({ id: 'rt_apo_1', id_rt: 'RT-APO-1', nom: "N'DRI FICTIF Aké", telephone: '0700000093', village_id: 'v_apo_1',
    village_nom: "N'GUESSANKRO FICTIF", cluster: 'Botro', statut: 'Pressenti', score: 60, deleted: false, data: {} });
  for (var k = 1; k <= 650; k++) {
    var vk = k % 2 ? 'v_hom_1' : 'v_apo_1';
    FARMERS.push({ producteur_id: 'p_masse_' + k, farmer_id: 'FICT-M' + String(10000 + k), nom: 'MASSE FICTIF ' + k,
      prenoms: k === 650 ? 'Adjoua Éléonore' : '', telephone: '01' + String(20000000 + k), village_id: vk,
      village_nom: k % 2 ? 'KONANKRO FICTIF' : "N'GUESSANKRO FICTIF", rt_id: k % 2 ? 'rt_hom_1' : (k % 3 ? 'rt_apo_1' : null),
      rt_nom: null, cluster_code: 'BOTRO', cluster_label: 'Botro', zone_code: 'GBEKE_2', zone_label: 'GBEKE 2',
      operational_status: 'Enrôlé', passport_stage: 'BASIC', passport_completion: 20, risk_profile: 'LOW',
      possible_duplicate: false, review_required: false, plot_count: 0, gps_mapped_count: 0,
      last_purchase_date: null, last_purchase_kg: 0, deleted: false });
  }
`;

export const doublure = (profil) => m[1].replace(LIGNE_PROFIL, 'profils: ' + JSON.stringify(profil)).replace(ANCRE, CAS + ANCRE);

const LEAFLET_DEF = 'C:/Dev/fbms-officiel/android/.vendor-cache/leaflet@1.9.4/package/dist';
export const LEAFLET = process.env.FBMS_LEAFLET_DIR || (existsSync(LEAFLET_DEF) ? LEAFLET_DEF : '');

export const PROFILS = {
  UH_BOTRO: { nom: 'UH FICTIF BOTRO', role: 'Unit Head', actif: true, cluster: 'BOTRO', zone: null },
  AUH_BOTRO: { nom: 'AUH FICTIF BOTRO', role: 'Assistant Unit Head', actif: true, cluster: 'BOTRO', zone: null },
  UH_SANS: { nom: 'UH FICTIF SANS CLUSTER', role: 'Unit Head', actif: true, cluster: null, zone: null },
  SUP: { nom: 'SUPERVISEUR FICTIF', role: 'Supervisor', actif: true, cluster: null, zone: null },
  BM: { nom: 'BM FICTIF', role: 'Branch Manager', actif: true, cluster: null, zone: null },
  RO: { nom: 'CONSULTATION FICTIVE', role: 'Consultation uniquement', actif: true, cluster: null, zone: null },
};

export function servir() {
  return createServer((req, res) => {
    const chemin = decodeURIComponent((req.url || '/').split('?')[0]);
    let cible = normalize(join(WEB, chemin));
    if (!cible.startsWith(WEB)) { res.writeHead(403).end(); return; }
    if (existsSync(cible) && statSync(cible).isDirectory()) cible = join(cible, 'index.html');
    if (!existsSync(cible)) { res.writeHead(404).end('introuvable'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(cible)] ?? 'application/octet-stream' });
    let corps = readFileSync(cible);
    if (MODE_APK && extname(cible) === '.html') {
      const t = corps.toString('utf8'), h = /<head[^>]*>/i.exec(t), tag = '<script src="/_native/bridge.js"></script>';
      corps = h ? t.slice(0, h.index + h[0].length) + tag + t.slice(h.index + h[0].length) : tag + t;
    }
    res.end(corps);
  });
}

/* opts.regle === false : la doublure NE répond PAS à procurement_active_rule (cas d'une
   campagne sans règle de prix, ou d'un téléphone hors ligne sans règle locale). */
export async function ouvrir(navigateur, { port, largeur = 360, hauteur = 780, profil, hash = '#census', regle = true, echelle = 1 }) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: echelle, isMobile: largeur < 500, hasTouch: largeur < 500 });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('console', (x) => { if (x.type() === 'error') erreurs.push(x.text()); });
  page.on('pageerror', (e) => erreurs.push('JS: ' + e.message));
  if (MODE_APK) await page.addInitScript(NATIF);
  await page.addInitScript(doublure(profil));
  await page.addInitScript((avecRegle) => {
    const cc = window.supabase.createClient;
    window.supabase.createClient = function () {
      const c = cc.apply(this, arguments), rpc = c.rpc;
      c.rpc = function (nom, args) {
        if (nom === 'procurement_active_rule') {
          return Promise.resolve(avecRegle
            ? { data: { price_per_kg: 400, rt_commission_per_kg: 10, max_moisture_pct: 10, min_kor: 46 }, error: null }
            : { data: null, error: null });
        }
        return rpc.call(this, nom, args);
      };
      return c;
    };
  }, regle);
  await page.route('**/*', (route) => {
    const url = route.request().url();
    /* Leaflet réel (copie npm 1.9.4 du cache de construction de l'APK), pour observer la carte. */
    if (LEAFLET && /leaflet@1\.9\.4\/dist\/leaflet(\.min)?\.(js|css)$/.test(url)) {
      const css = /\.css$/.test(url);
      return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript; charset=utf-8', body: readFileSync(join(LEAFLET, css ? 'leaflet.css' : 'leaflet.js')) });
    }
    if (/supabase|jsdelivr|cdnjs|tailwindcss|fonts\.(googleapis|gstatic)|tile\.openstreetmap/i.test(url)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* doublure */' });
    }
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/operations/field-buying.html${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ANAGROCI_FB && !document.querySelector('#opsRouteView .skeleton'), null, { timeout: 25000 });
  return { contexte, page, erreurs };
}

/* Coupe le réseau côté page (navigator.onLine) puis recharge : context.setOffline couperait
   aussi le serveur local du banc. */
export async function passerHorsLigne(contexte, page) {
  /* Session gardée par supabase-js après une connexion en ligne : auth-gate.js ouvre l'accès
     local à partir d'elle et du profil mis en cache (shared/auth-gate.js, tryLocalAccess). */
  /* auth-gate.js calcule la clé depuis SA constante (la doublure remplace seulement l'URL publique). */
  const url = (readFileSync(join(WEB, 'shared/auth-gate.js'), 'utf8').match(/var SUPABASE_URL = "([^"]+)"/) || [])[1] || '';
  const cle = 'sb-' + url.replace(/^https:\/\//, '').split('.')[0] + '-auth-token';
  await page.evaluate((cle) => {
    localStorage.setItem(cle, JSON.stringify({ access_token: 'fictif', refresh_token: 'fictif', user: { id: 'utilisateur-de-test' } }));
  }, cle);
  await contexte.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ANAGROCI_FB && window.ANAGROCI_OFFLINE && !window.ANAGROCI_OFFLINE.isOnline(), null, { timeout: 25000 });
  /* Certaines vues restent en chargement hors ligne : on le constate, on n'échoue pas ici. */
  await page.waitForFunction(() => !document.querySelector('#opsRouteView .skeleton'), null, { timeout: 15000 }).catch(() => {});
}

export function compteur() {
  let ok = 0; const echecs = []; const journal = [];
  return {
    verifier(c, libelle) { journal.push((c ? 'PASS ' : 'FAIL ') + libelle); console.log((c ? 'PASS ' : 'FAIL ') + libelle); if (c) ok++; else echecs.push(libelle); },
    bilan() { return { resultat: echecs.length ? 'FAIL' : 'PASS', reussis: ok, echecs: echecs.length, liste_echecs: echecs }; },
    journal,
  };
}
