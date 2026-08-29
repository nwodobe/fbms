#!/usr/bin/env node
/**
 * FIELD BUYING — contrôle en navigateur réel.
 *
 * Vérifie que la restauration fonctionnelle est réellement visible :
 *   · les 11 rubriques de la sidebar rendent dans le shell Operations, sans
 *     jamais quitter operations/field-buying.html ;
 *   · les actions critiques (+ Nouveau village / producteur / RT, + Nouvel
 *     achat, + Nouvelle demande RT) sont visibles, ≥ 44 px, dans l'écran ;
 *   · les formulaires s'ouvrent et portent leurs champs ; l'anti-doublon
 *     réagit ; un achat au prix hors barème exige un motif ;
 *   · la carte s'initialise (Leaflet réel en local) et les villages géolocalisés
 *     produisent des marqueurs ;
 *   · le cache partagé évite de relancer les référentiels à chaque rubrique ;
 *   · aucune erreur console, aucun débordement horizontal, à 7 largeurs.
 *
 * Données FICTIVES servies par une doublure locale — aucun nom réel, aucun
 * montant réel, aucune coordonnée réelle de parcelle.
 *
 * Usage : node tests/field-buying-e2e.mjs [--screenshots dossier]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const RACINE = process.cwd();
const PORT = Number(process.env.PORT_FBMS ?? 4331);
const SEUIL_TACTILE = 44;
const LARGEURS = [1920, 1440, 1366, 1024, 768, 390, 360];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function servir() {
  return createServer((req, res) => {
    const chemin = decodeURIComponent((req.url || '/').split('?')[0]);
    let cible = normalize(join(RACINE, chemin));
    if (!cible.startsWith(RACINE)) { res.writeHead(403).end(); return; }
    if (existsSync(cible) && statSync(cible).isDirectory()) cible = join(cible, 'index.html');
    if (!existsSync(cible)) { res.writeHead(404).end('introuvable'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(cible)] ?? 'application/octet-stream' });
    res.end(readFileSync(cible));
  });
}

/* Doublure de données : mêmes formes que les tables réelles, contenu inventé. */
const DOUBLURE = `
(function () {
  'use strict';
  window.__lectures = [];
  var CL = [
    { code: 'DJEBONOUA', label: 'Djébonoua', zone_code: 'GBEKE_1', active: true },
    { code: 'BROBO', label: 'Brobo', zone_code: 'GBEKE_1', active: true },
    { code: 'SAKASSOU', label: 'Sakassou', zone_code: 'GBEKE_1', active: true },
    { code: 'BEOUMI', label: 'Béoumi', zone_code: 'GBEKE_2', active: true },
    { code: 'BOTRO', label: 'Botro', zone_code: 'GBEKE_2', active: true },
    { code: 'DIABO', label: 'Diabo', zone_code: 'GBEKE_2', active: true }
  ];
  var ZN = [
    { code: 'GBEKE_1', label: 'GBEKE 1', region: 'Gbêkê', active: true },
    { code: 'GBEKE_2', label: 'GBEKE 2', region: 'Gbêkê', active: true }
  ];
  var VILLAGES = [], RTS = [], FARMERS = [], ACHATS = [];
  for (var i = 1; i <= 12; i++) {
    var cl = CL[i % 6].label;
    VILLAGES.push({ id: 'v_test_' + i, village: 'VILLAGE FICTIF ' + i, region: 'Gbêkê',
      departement: 'Bouaké', cluster: cl, cluster_code: CL[i % 6].code,
      statut: i % 3 ? 'Approuvé BM' : 'Brouillon', score: 60 + i,
      gps_lat: i % 4 ? (7.4 + i * 0.02) : null, gps_lng: i % 4 ? (-5.1 + i * 0.02) : null,
      deleted: false,
      data: { s1: { village: 'VILLAGE FICTIF ' + i, cluster: cl, distanceHub: 10 + i,
                    distanceHubRoutiere: i % 2 ? 12 + i : null },
              s3: { potentielMT: 20 + i, potentielSecuriseMT: 10 + i, nbProducteurs: 30 },
              s5: { typeAcces: i % 5 ? 'Piste' : 'Enclavé', noteRoute: (i % 10) + 1, camion10T: true } } });
    if (i <= 10) RTS.push({ id: 'rt_test_' + i, id_rt: 'RT-FIC-' + i, nom: 'RT FICTIF ' + i,
      telephone: '07000000' + String(10 + i), village_id: 'v_test_' + i,
      village_nom: 'VILLAGE FICTIF ' + i, cluster: cl,
      statut: i % 4 ? 'Confirmé' : 'Pressenti', score: 70, deleted: false,
      data: { activite: i % 3 ? 'Producteur' : 'Pisteur' } });
    FARMERS.push({ producteur_id: 'p_test_' + i, farmer_id: 'FICT-' + String(1000 + i),
      nom: 'PRODUCTEUR FICTIF ' + i, prenoms: '', telephone: '05000000' + String(10 + i),
      village_id: 'v_test_' + i, village_nom: 'VILLAGE FICTIF ' + i,
      rt_id: i <= 10 ? 'rt_test_' + i : null, rt_nom: i <= 10 ? 'RT FICTIF ' + i : null,
      cluster_code: CL[i % 6].code, cluster_label: cl, zone_code: CL[i % 6].zone_code,
      zone_label: CL[i % 6].zone_code.replace('_', ' '), operational_status: 'Enrôlé',
      passport_stage: 'BASIC', passport_completion: 40, risk_profile: 'LOW',
      possible_duplicate: false, review_required: false, plot_count: i % 2,
      gps_mapped_count: i % 2, last_purchase_date: i % 2 ? '2026-08-20' : null,
      last_purchase_kg: 100, deleted: false });
    ACHATS.push({ id: 'a_test_' + i, date: '2026-08-2' + (i % 9), cluster: cl,
      village_id: 'v_test_' + i, village_nom: 'VILLAGE FICTIF ' + i,
      rt_id: 'rt_test_' + Math.min(i, 10), rt_nom: 'RT FICTIF ' + Math.min(i, 10),
      producteur_id: 'p_test_' + i, producteur_code: 'FICT-' + String(1000 + i),
      producteur_nom: 'PRODUCTEUR FICTIF ' + i, poids_net: 500, nb_sacs: 6, prix_kg: 400,
      montant: 200000, mode_paiement: 'Wave', numero_recu: i % 3 ? 'RC-' + i : null,
      qualite_statut: i % 5 ? 'OK' : 'À sécher', statut_validation: i % 5 ? 'À valider' : 'À contrôler',
      stock_statut: 'Entrée RT', cash_statut: null, rejet: false, kor: 47, humidite: 8,
      created_at: '2026-08-2' + (i % 9) + 'T09:00:00Z' });
  }
  FARMERS.push({ producteur_id: 'p_rt4', farmer_id: 'FICT-2004', nom: 'RT FICTIF 4', prenoms: '',
    telephone: '0700000014', village_id: 'v_test_4', village_nom: 'VILLAGE FICTIF 4',
    rt_id: 'rt_test_4', rt_nom: 'RT FICTIF 4', cluster_code: 'DJEBONOUA', cluster_label: 'Djébonoua',
    zone_code: 'GBEKE_1', zone_label: 'GBEKE 1', operational_status: 'Enrôlé', passport_stage: 'BASIC',
    passport_completion: 30, risk_profile: 'LOW', possible_duplicate: false, review_required: false,
    plot_count: 0, gps_mapped_count: 0, last_purchase_date: null, last_purchase_kg: 0, deleted: false });
  VILLAGES[1].data.galerie = [
    { path: 'v_test_2/gallery/a.jpg', legende: 'ENTREE TEST', categorie: 'Entrée du village', date: '2026-08-20', agent: 'AGENT TEST' },
    { path: 'v_test_2/gallery/b.jpg', legende: 'ROUTE TEST', categorie: 'Route d’accès', date: '2026-08-21', agent: 'AGENT TEST' }
  ];
  var TABLES = {
    villages: VILLAGES, rt: RTS, farmer_passport_summary_v: FARMERS, achats: ACHATS,
    aflp_zones: ZN, aflp_clusters: CL,
    avances: [{ id: 'av1', date: '2026-08-20', cluster: 'Brobo', rt_id: 'rt_test_2',
      rt_nom: 'RT FICTIF 2', source: 'Finance', montant: 500000, motif: 'CAMPAGNE',
      statut: 'Active', cycle_id: 'CYC-1', cycle_statut: 'Ouvert', created_at: '2026-08-20' }],
    reconciliations: [],
    sacherie_ct_cluster_stock: CL.map(function (c, k) {
      return { cluster: c.label, stock_cluster_vide: 400 - k * 60, stock_cluster_plein: 40,
        stock_chez_rt: 120, stock_chez_producteur: 30, stock_hub_plein: 0,
        dechires: 2, a_reparer: 1, repares: 0, rebut: 0, transit: 5, total_reseau: 600 };
    }),
    sacherie_ct_rt_stock: RTS.map(function (r, k) {
      return { cluster: r.cluster, rt_id: r.id, rt_nom: r.nom,
        total_sous_responsabilite: 20 + k, vides: 15, pleins: 5, dechires: 0,
        a_reparer: 0, repares: 0, rebut: 0,
        derniere_activite: k % 2 ? '2026-08-25' : '2026-06-01' };
    }),
    ops_bag_requests: [{ id: 'br1', request_code: 'BAG-2027-001', channel: 'AFLP',
      campaign: '2027', cluster: 'Brobo', rt_id: 'rt_test_2', requested_qty: 200,
      approved_qty: 200, released_qty: 120, received_qty: 120, status: 'PARTIAL',
      requested_at: '2026-08-20', approved_at: '2026-08-21', expires_at: '2026-09-30',
      source_location_code: 'CLUSTER:Brobo', destination_location_code: 'RT:rt_test_2' }],
    aflp_bag_envelopes: [{ id: 'env1', campaign: '2027', approved_qty: 5000, status: 'APPROVED', approved_at: '2026-08-01' }],
    aflp_bag_cluster_allocations: CL.map(function (c, k) {
      return { id: 'al' + k, envelope_id: 'env1', cluster: c.label, allocated_qty: 700 };
    }),
    log_hubs: CL.map(function (c) {
      return { cluster: c.label, zone: c.zone_code, hub_nom: c.label, statut_hub: 'Actif',
        potentiel_mt: 300, distance_km: 40, etat_route: 'Praticable', commentaire: '' };
    }),
    hubs_clusters: CL.map(function (c, k) {
      return { id_hub: 'h' + k, nom: c.label, region: 'Gbêkê', departement: 'Bouaké',
        localite: c.label, gps_lat: 7.5 + k * 0.05, gps_lng: -5.2 + k * 0.05,
        distance_usine_gps: 60 + k, distance_usine_routiere: k % 2 ? 70 + k : null,
        statut: 'Approuvé Branch Manager', deleted: false };
    }),
    farmer_sustainability_dashboard_v: VILLAGES.map(function (v, k) {
      return { zone_code: 'GBEKE_1', zone_label: 'GBEKE 1', cluster_code: v.cluster_code,
        cluster_label: v.cluster, village_id: v.id, village_nom: v.village,
        producers_registered: 8, sustainability_baseline_completed: 4, trained_farmers: 3,
        open_corrective_actions: k % 3, high_risk_farmers: 0 };
    }),
    parametres_calcul: [{ cle: 'usine_lat', valeur: '6.741972' }, { cle: 'usine_lng', valeur: '-5.34575' }],
    preuves: [{ id: 'pr1', entite_type: 'rt', entite_id: 'rt_test_5', type_preuve: 'photo_profil',
      storage_path: 'agent/rt/rt_test_5/photo_profil-x.jpg', horodatage_client: '2026-08-20T10:00:00Z' }],
    audit_log: [],
    producteurs: FARMERS.map(function (f) {
      /* La colonne sexe est normalisée M/F par le serveur (trigger prepare_producteur). */
      return { id: f.producteur_id, nom: f.nom, prenoms: f.prenoms, sexe: 'M', birth_year: 1980,
        telephone: f.telephone, telephone_alt: null, id_document_type: 'CNI', id_document_number: null,
        village_id: f.village_id, rt_id: f.rt_id, statut: 'Identifié',
        data: { campement: 'CAMPEMENT TEST', superficieHa: 3 } };
    }),
    profils: { nom: 'PROFIL DE TEST', role: 'Procurement Officer', actif: true }
  };
  function requete(nom) {
    window.__lectures.push(nom);
    var data = TABLES[nom];
    var liste = Array.isArray(data) ? data.slice() : [];
    var unique = Array.isArray(data) ? null : (data || null);
    var filtres = [];
    var c = {
      select: f, insert: function (row) { window.__lectures.push('insert:' + nom); return c; },
      update: function (row) {
        window.__lectures.push('update:' + nom);
        if (row && row.sexe) window.__lectures.push('update-sexe:' + row.sexe);
        return c;
      },
      upsert: f, delete: f,
      eq: function (col, v) { filtres.push([col, v]); return c; },
      neq: f, in: f, like: f, ilike: f, gte: f, lte: f, order: f, limit: f, range: f,
      single: function () { return Promise.resolve({ data: unique, error: null }); },
      maybeSingle: function () { return Promise.resolve({ data: unique, error: null }); },
      then: function (r) {
        var out = liste.filter(function (x) {
          return filtres.every(function (fl) { return x[fl[0]] === fl[1]; });
        });
        return Promise.resolve({ data: out, error: null }).then(r);
      }
    };
    function f() { return c; }
    return c;
  }
  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'utilisateur-de-test' } } }, error: null }); },
          getUser: function () { return Promise.resolve({ data: { user: { id: 'utilisateur-de-test' } }, error: null }); },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signOut: function () { return Promise.resolve({ data: null, error: null }); }
        },
        from: requete,
        rpc: function (nom, args) {
          window.__lectures.push('rpc:' + nom);
          if (nom === 'farmer_possible_duplicates') return Promise.resolve({ data: [], error: null });
          if (nom === 'field_traceability_search') {
            return Promise.resolve({ data: [{ farmer_id: 'FICT-1001', producteur_nom: 'PRODUCTEUR FICTIF 1',
              achat_id: 'a_test_1', achat_local_id: 'a_test_1', achat_poids_net_kg: 500,
              lot_code: 'LOT-20260820-000001', shipment_code: 'SHP-1', vehicle_plate: 'TEST 01',
              reception_id: 'REC-1', bags: ['BAG-1', 'BAG-2'] }], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        storage: { from: function (bucket) { return {
          list: function () { return Promise.resolve({ data: [], error: null }); },
          upload: function (path) { window.__lectures.push('storage-upload:' + bucket); return Promise.resolve({ data: { path: path }, error: null }); },
          createSignedUrl: function (path) { window.__lectures.push('signed:' + bucket); return Promise.resolve({ data: { signedUrl: 'https://signed.local/' + bucket + '/' + path }, error: null }); },
          getPublicUrl: function (path) { window.__lectures.push('publicurl:' + bucket); return { data: { publicUrl: 'https://public.local/' + path } }; }
        }; } },
        channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
        removeChannel: function () {}
      };
    }
  };
  window.prompt = function () { return 'LEGENDE TEST'; };
  window.ANAGROCI_SUPABASE_URL = 'https://doublure.local';
  window.ANAGROCI_SUPABASE_ANON = 'doublure';
})();
`;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const echecs = [];
const notes = [];
function verifier(condition, message) {
  if (condition) notes.push('  ok   ' + message);
  else { echecs.push(message); notes.push('  ÉCHEC ' + message); }
}

async function allerA(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction(() => !document.querySelector('#opsRouteView .skeleton'), null, { timeout: 15000 });
}
async function mesurerBouton(page, id) {
  return page.evaluate((sel) => {
    const b = document.getElementById(sel.id) ||
      [...document.querySelectorAll('.ops-route-actions .btn')].find((x) => x.textContent.includes(sel.txt));
    if (!b) return { present: false };
    const r = b.getBoundingClientRect();
    const s = getComputedStyle(b);
    return { present: true, hauteur: Math.round(r.height), assezHaut: r.height >= 44,
      visible: s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0,
      dansEcran: r.left >= -1 && r.right <= window.innerWidth + 1,
      debordement: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }, id);
}

async function main() {
  const dossierCaptures = process.argv.includes('--screenshots')
    ? process.argv[process.argv.indexOf('--screenshots') + 1] : null;
  if (dossierCaptures) mkdirSync(dossierCaptures, { recursive: true });

  const serveur = servir();
  await new Promise((r) => serveur.listen(PORT, r));
  const navigateur = await chromium.launch();
  const base = `http://127.0.0.1:${PORT}/operations/field-buying.html`;

  try {
    for (const largeur of LARGEURS) {
      const hauteur = largeur < 500 ? 844 : 900;
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } });
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
      page.on('pageerror', (e) => erreurs.push('JS: ' + e.message));
      await page.addInitScript(DOUBLURE);
      /* Leaflet local est REEL (servi par ce serveur) ; les autres CDN sont neutralisés. */
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (/tile\.openstreetmap\.org/.test(url)) {
          return route.fulfill({ status: 200, contentType: 'image/png',
            body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
        }
        if (/leaflet/.test(url) && /cdn\.jsdelivr/.test(url)) {
          const isCss = /\.css/.test(url);
          const local = isCss ? 'node_modules/leaflet/dist/leaflet.css' : 'node_modules/leaflet/dist/leaflet.js';
          if (existsSync(join(RACINE, local))) {
            return route.fulfill({ status: 200,
              contentType: isCss ? 'text/css' : 'text/javascript',
              body: readFileSync(join(RACINE, local)) });
          }
          return route.fulfill({ status: 200, contentType: isCss ? 'text/css' : 'text/javascript', body: '/* absent */' });
        }
        if (/supabase|jsdelivr|cdnjs|tailwindcss|fonts\.(googleapis|gstatic)/i.test(url)) {
          return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* doublure */' });
        }
        return route.continue();
      });

      notes.push(`\n── ${largeur} px ──`);

      // 1. Vue d'ensemble : action + Nouvel achat visible
      await page.goto(base + '#overview', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.querySelector('#opsRouteView .skeleton'), null, { timeout: 20000 });
      let b = await mesurerBouton(page, { id: '', txt: '+ Nouvel achat' });
      verifier(b.present && b.visible, `${largeur}px · Vue d'ensemble : « + Nouvel achat » visible`);
      verifier(!b.debordement, `${largeur}px · Vue d'ensemble : aucun défilement horizontal`);
      const kpiObjectif = await page.evaluate(() => {
        const k = [...document.querySelectorAll('.kpi small')].find((x) => /Objectif campagne/i.test(x.textContent));
        return k ? k.parentElement.textContent : '';
      });
      verifier(/3\s*000\s*MT/.test(kpiObjectif), `${largeur}px · objectif campagne 3 000 MT affiché`);

      // 2. Recensement : les 3 actions critiques visibles
      await allerA(page, '#census');
      const actions = await page.evaluate(() =>
        [...document.querySelectorAll('.ops-route-actions .btn')].map((x) => x.textContent.trim()));
      for (const a of ['+ Nouveau village', '+ Nouveau producteur', '+ Nouveau RT']) {
        verifier(actions.some((t) => t.includes(a)), `${largeur}px · Recensement : « ${a} » visible`);
      }
      b = await mesurerBouton(page, { id: '', txt: '+ Nouveau village' });
      verifier(b.assezHaut, `${largeur}px · Recensement : bouton ${b.hauteur}px ≥ 44px`);
      verifier(b.dansEcran && !b.debordement, `${largeur}px · Recensement : dans l'écran, sans débordement`);

      // 3. Navigation complète : 11 rubriques, jamais hors du shell
      if (largeur === 1440 || largeur === 360) {
        for (const [hash, attendu] of [
          ['#purchases', 'Achat Bord Champ'], ['#census', 'Recensement'], ['#farmers', 'Producteurs'],
          ['#rt', 'RT & Villages'], ['#hubs', 'Hubs & Cartographie'], ['#bags', 'Sacherie AFLP'],
          ['#cash', 'Caisse & Avances'], ['#command', 'Command Center'],
          ['#sustainability', 'Sustainability'], ['#traceability', 'Traceability'], ['#overview', 'Vue d’ensemble']]) {
          await allerA(page, hash);
          const etat = await page.evaluate(() => ({
            titre: (document.querySelector('.ops-route-head h1') || {}).textContent || '',
            path: location.pathname,
            shell: !!document.getElementById('opsSidebar') && !!document.getElementById('opsTopbar')
          }));
          verifier(etat.titre.indexOf(attendu) >= 0,
            `${largeur}px · ${hash} rend « ${attendu} » (vu « ${etat.titre.trim() || '∅'} »)`);
          verifier(etat.path.endsWith('/operations/field-buying.html') && etat.shell,
            `${largeur}px · ${hash} reste dans le shell Operations`);
        }
      }

      if (largeur === 1440) {
      async function ouvrirSections(formId) {
        await page.evaluate((f) => {
          document.querySelectorAll('#' + f + ' details.ops-sec').forEach((d) => { d.open = true; });
        }, formId);
      }
        // SCÉNARIOS 1-2 — Village : recensement complet s1…s9, minimum opérationnel
        await allerA(page, '#census');
        await page.evaluate(() => { ANAGROCI_FB.openVillageForm(); });
        await page.waitForSelector('#villageForm', { timeout: 15000 });
        const vf = await page.evaluate(() => ({
          sections: document.querySelectorAll('#villageForm details.ops-sec').length,
          barre: !!document.getElementById('villageForm_fill'),
          requis: [...document.querySelectorAll('#villageForm [required]')].map((x) => x.id),
          clusters: document.querySelectorAll('#vf_cluster option').length,
          champsRiches: ['vf_sp', 'vf_periode', 'vf_dom_nom', 'vf_noteroute', 'vf_banque', 'vf_chef',
                         'vc1_nom', 'vf_s9_pot', 'vf_decision'].filter((i) => document.getElementById(i)).length
        }));
        verifier(vf.sections >= 9, `village : ${vf.sections} sections de recensement (≥ 9)`);
        verifier(vf.barre, 'village : barre de complétude affichée');
        verifier(vf.requis.length === 2 && vf.requis.includes('vf_nom') && vf.requis.includes('vf_cluster'),
          'village : minimum opérationnel = nom + cluster seulement');
        verifier(vf.champsRiches === 9, `village : champs riches présents dans toutes les sections (${vf.champsRiches}/9)`);
        await ouvrirSections('villageForm');
        // dépendance région → département (référentiel officiel)
        await page.selectOption('#vf_region', 'Gbêkê');
        const depts = await page.evaluate(() => [...document.querySelectorAll('#vf_dept option')].map((o) => o.value));
        verifier(depts.includes('Bouaké') && depts.includes('Sakassou'), 'village : départements dérivés de la région');
        // score s9 = somme des 5 critères
        for (const [id, v] of [['vf_s9_pot', '15'], ['vf_s9_route', '10'], ['vf_s9_rt', '20'], ['vf_s9_conc', '5'], ['vf_s9_pay', '10']]) {
          await page.selectOption('#' + id, v);
        }
        const score = await page.evaluate(() => document.getElementById('vf_score').value);
        verifier(score === '60 / 100', `village : score s9 calculé (vu « ${score} »)`);
        // complétude progresse
        await page.fill('#vf_nom', 'VILLAGE NEUF TEST');
        await page.selectOption('#vf_cluster', 'Brobo');
        const pctV = await page.evaluate(() => document.getElementById('villageForm_pct').textContent);
        verifier(/\d+ %/.test(pctV), `village : complétude mesurée (« ${pctV} »)`);
        // anti-doublon
        await page.fill('#vf_nom', 'VILLAGE FICTIF 3');
        await page.waitForTimeout(120);
        const dupV = await page.evaluate(() => (document.getElementById('vf_dup') || {}).innerHTML || '');
        verifier(/existe déjà/i.test(dupV), 'village : alerte anti-doublon sur nom existant');
        // SCÉNARIO 2 : création avec seulement le minimum opérationnel
        await page.fill('#vf_nom', 'VILLAGE MINIMUM TEST');
        await page.click('#vf_submit');
        await page.waitForTimeout(250);
        const insV = await page.evaluate(() => window.__lectures.filter((x) => x === 'insert:villages').length);
        verifier(insV === 1, 'village : création au minimum opérationnel acceptée (insert villages)');
        await page.waitForTimeout(1300);

        // SCÉNARIOS 3-4 — RT : dossier complet, producteur lui-même
        await allerA(page, '#census');
        await page.evaluate(() => { ANAGROCI_FB.openRtForm(); });
        await page.waitForSelector('#rtForm', { timeout: 15000 });
        const rf = await page.evaluate(() => ({
          sections: document.querySelectorAll('#rtForm details.ops-sec').length,
          estProd: !!document.getElementById('rf_prod'),
          capacite: ['rf_exp', 'rf_nbprod', 'rf_vol', 'rf_zone_inf', 'rf_dispo'].filter((i) => document.getElementById(i)).length,
          evaluation: ['rf_rep', 'rf_score', 'rf_notes'].filter((i) => document.getElementById(i)).length
        }));
        verifier(rf.sections >= 5, `RT : ${rf.sections} sections du dossier (≥ 5)`);
        verifier(rf.estProd, 'RT : champ « Producteur lui-même » présent');
        verifier(rf.capacite === 5 && rf.evaluation === 3, 'RT : capacité et évaluation complètes');
        await ouvrirSections('rtForm');
        await page.fill('#rf_nom', 'RT NEUF TEST');
        await page.fill('#rf_tel', '0701020304');
        await page.selectOption('#rf_village', 'v_test_2');
        await page.selectOption('#rf_prod', 'OUI');
        await page.click('#rf_submit');
        await page.waitForTimeout(250);
        const insR = await page.evaluate(() => window.__lectures.filter((x) => x === 'insert:rt').length);
        verifier(insR === 1, 'RT : création acceptée (insert rt)');
        const msgR = await page.evaluate(() => document.getElementById('rf_msg').textContent);
        verifier(/enrôlé comme producteur/i.test(msgR), 'RT producteur : passerelle annoncée à la création');
        await page.waitForTimeout(1300);

        // SCÉNARIO 5 — RT → Producteur : préremplissage
        await allerA(page, '#rt/rts');
        const btnEnroler = await page.evaluate(() =>
          [...document.querySelectorAll('#rtBody button')].some((b) => /Enrôler comme producteur/.test(b.textContent)));
        verifier(btnEnroler, 'RT → Producteur : bouton « Enrôler comme producteur » visible sur les RT producteurs');
        await page.evaluate(() => { ANAGROCI_FB.rtToFarmer('rt_test_3'); });
        await page.waitForSelector('#farmerForm', { timeout: 15000 });
        const pre = await page.evaluate(() => ({
          nom: document.getElementById('ff_nom').value,
          tel: document.getElementById('ff_tel').value,
          village: document.getElementById('ff_village').value
        }));
        verifier(pre.nom === 'RT FICTIF 3' && pre.village === 'v_test_3' && pre.tel.length > 0,
          'RT → Producteur : identité et village prérenseignés depuis la fiche RT');
        await page.evaluate(() => ANAGROCI_FB.closeForm());

        // SCÉNARIOS 6-8 — Producteur : quick create, parcelle facultative, doublon
        await page.evaluate(() => { ANAGROCI_FB.openFarmerForm(); });
        await page.waitForSelector('#farmerForm', { timeout: 15000 });
        const ff = await page.evaluate(() => ({
          sections: document.querySelectorAll('#farmerForm details.ops-sec').length,
          requis: [...document.querySelectorAll('#farmerForm [required]')].map((x) => x.id),
          barre: !!document.getElementById('farmerForm_fill'),
          parcelle: /parcelle à compléter après campagne/i.test(document.getElementById('fbFormHost').textContent),
          agricole: ['ff_ha', 'ff_arbres', 'ff_prodprec', 'ff_pot27', 'ff_eng'].filter((i) => document.getElementById(i)).length,
          parcelleChamps: ['ff_plot_nom', 'ff_plot_ha', 'ff_plot_lat', 'ff_plot_lng'].filter((i) => document.getElementById(i)).length
        }));
        verifier(ff.sections >= 6, `producteur : ${ff.sections} sections du passeport (≥ 6)`);
        verifier(ff.requis.length === 2 && ff.requis.includes('ff_nom') && ff.requis.includes('ff_village'),
          'producteur : quick create = nom + village seulement (règle 2027)');
        verifier(ff.barre && ff.parcelle, 'producteur : barre de complétude + mention parcelle après campagne');
        verifier(ff.agricole === 5 && ff.parcelleChamps === 4, 'producteur : profil agricole et parcelle facultative présents');
        // SCÉNARIO 8 : doublon local signalé
        await page.fill('#ff_nom', 'PRODUCTEUR FICTIF 3');
        await page.waitForTimeout(120);
        const dupF = await page.evaluate(() => (document.getElementById('ff_dup') || {}).innerHTML || '');
        verifier(/existe déjà/i.test(dupF), 'producteur : alerte anti-doublon sur nom existant');
        // SCÉNARIO 6 : création SANS parcelle — doit réussir
        await page.fill('#ff_nom', 'PRODUCTEUR SANS PARCELLE');
        await page.selectOption('#ff_village', 'v_test_2');
        await page.click('#ff_submit');
        await page.waitForTimeout(350);
        let ins = await page.evaluate(() => ({
          prod: window.__lectures.filter((x) => x === 'insert:producteurs').length,
          plot: window.__lectures.filter((x) => x === 'insert:farmer_plots').length
        }));
        verifier(ins.prod === 1 && ins.plot === 0, 'producteur sans parcelle : créé, aucune parcelle exigée');
        await page.waitForTimeout(1400);
        await allerA(page, '#census');
        // SCÉNARIO 7 : création AVEC parcelle + GPS → farmer_plots alimenté
        await page.evaluate(() => { ANAGROCI_FB.openFarmerForm(); });
        await page.waitForSelector('#farmerForm', { timeout: 15000 });
        await ouvrirSections('farmerForm');
        await page.fill('#ff_nom', 'PRODUCTEUR AVEC PARCELLE');
        await page.selectOption('#ff_village', 'v_test_4');
        await page.fill('#ff_plot_nom', 'PARCELLE TEST');
        await page.fill('#ff_plot_ha', '2.5');
        await page.fill('#ff_plot_lat', '7.51');
        await page.fill('#ff_plot_lng', '-5.11');
        await page.click('#ff_submit');
        await page.waitForTimeout(350);
        ins = await page.evaluate(() => ({
          prod: window.__lectures.filter((x) => x === 'insert:producteurs').length,
          plot: window.__lectures.filter((x) => x === 'insert:farmer_plots').length
        }));
        verifier(ins.prod === 2 && ins.plot === 1, 'producteur avec parcelle : farmer_plots alimenté (registre canonique)');
        await page.waitForTimeout(1400);

        // ===== FICHES 360° — scénarios 1 à 17 de la restauration fiches/photos =====
        async function prendrePhoto(triggerFn, nomFichier) {
          const [chooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 10000 }),
            page.evaluate(triggerFn)
          ]);
          const captureAttr = await chooser.element().getAttribute('capture');
          await chooser.setFiles({ name: nomFichier, mimeType: 'image/png', buffer: PNG_1PX });
          await page.waitForSelector('.ops-photo-preview [data-ok]', { timeout: 10000 });
          await page.click('.ops-photo-preview [data-ok]');
          return captureAttr;
        }

        // S1 — clic sur un RT depuis la liste → Fiche RT
        await allerA(page, '#rt/rts');
        const lienRt = await page.evaluate(() =>
          [...document.querySelectorAll('#rtBody a.ops-link')].some((a) => /^#rt\//.test(a.getAttribute('href'))));
        verifier(lienRt, 'S1 · liste RT : noms cliquables vers la fiche');
        await allerA(page, '#rt/rt_test_5');
        const ficheRt = await page.evaluate(() => ({
          titre: (document.querySelector('.ops-route-head h1') || {}).textContent || '',
          tabs: document.querySelectorAll('.ops-passport-tabs a').length,
          avatar: !!document.querySelector('.ops-avatar'),
          shell: location.pathname.endsWith('/operations/field-buying.html')
        }));
        verifier(/RT FICTIF 5/.test(ficheRt.titre) && ficheRt.shell, 'S1 · fiche RT ouverte dans le shell');
        verifier(ficheRt.tabs === 8 && ficheRt.avatar, `S1 · fiche RT : 8 onglets + avatar (vu ${ficheRt.tabs})`);
        // photo existante affichée par URL SIGNÉE
        await page.waitForTimeout(300);
        const avatarSrc = await page.evaluate(() => {
          const img = document.querySelector('img.ops-avatar');
          return img ? img.src : '';
        });
        verifier(/signed\.local\/terrain-preuves/.test(avatarSrc), 'S17a · photo RT servie par URL signée (bucket privé)');

        // S2 — Modifier le RT : même moteur, même ligne mise à jour
        await page.click('.ops-route-actions .btn.primary');
        await page.waitForSelector('#rtForm', { timeout: 10000 });
        const editPrefill = await page.evaluate(() => ({
          nom: document.getElementById('rf_nom').value,
          titre: document.getElementById('fbFormHost').textContent.includes('Modifier le RT')
        }));
        verifier(editPrefill.nom === 'RT FICTIF 5' && editPrefill.titre, 'S2 · formulaire RT en mode édition, prérempli');
        await page.evaluate(() => { window.__lectures.length = 0; });
        await page.click('#rf_submit');
        await page.waitForTimeout(250);
        const ecritures = await page.evaluate(() => ({
          upd: window.__lectures.filter((x) => x === 'update:rt').length,
          ins: window.__lectures.filter((x) => x === 'insert:rt').length
        }));
        verifier(ecritures.upd === 1 && ecritures.ins === 0, 'S2 · modification = update de la même ligne, jamais un insert');
        await page.waitForTimeout(1300);

        // S3/S4/S5 — photo profil + pièce recto + verso (appareil photo mobile)
        await allerA(page, '#rt/rt_test_4/documents');
        await page.evaluate(() => { window.__lectures.length = 0; });
        const cap1 = await prendrePhoto(() => ANAGROCI_FB.addRtDoc('rt_test_4', 'photo_profil'), 'photo.png');
        await page.waitForTimeout(400);
        const cap2 = await prendrePhoto(() => ANAGROCI_FB.addRtDoc('rt_test_4', 'piece_recto'), 'recto.png');
        await page.waitForTimeout(400);
        const cap3 = await prendrePhoto(() => ANAGROCI_FB.addRtDoc('rt_test_4', 'piece_verso'), 'verso.png');
        await page.waitForTimeout(600);
        const docsEcr = await page.evaluate(() => ({
          uploadsPrives: window.__lectures.filter((x) => x === 'storage-upload:terrain-preuves').length,
          preuves: window.__lectures.filter((x) => x === 'insert:preuves').length,
          audit: window.__lectures.filter((x) => x === 'insert:audit_log').length,
          publicPrive: window.__lectures.filter((x) => x === 'publicurl:terrain-preuves').length
        }));
        verifier(docsEcr.uploadsPrives === 3 && docsEcr.preuves === 3,
          `S3-S5 · photo + recto + verso téléversés dans le bucket privé (${docsEcr.uploadsPrives} uploads, ${docsEcr.preuves} preuves)`);
        verifier(docsEcr.audit >= 3, 'S3-S5 · chaque document journalisé dans audit_log');
        verifier(cap1 === 'environment' && cap2 === 'environment' && cap3 === 'environment',
          'S15 · l’appareil photo mobile est sollicité (attribut capture)');
        verifier(docsEcr.publicPrive === 0, 'S17b · AUCUNE URL publique demandée pour le bucket privé');

        // S7 — RT déjà producteur → « Voir sa fiche Producteur »
        await allerA(page, '#rt/rt_test_4');
        const dejaProd = await page.evaluate(() =>
          [...document.querySelectorAll('.ops-route-actions a')].some((a) => /Voir sa fiche Producteur/.test(a.textContent)));
        verifier(dejaProd, 'S7 · RT déjà producteur : « Voir sa fiche Producteur » (aucune re-création)');

        // S9 — Modifier le producteur depuis le passeport
        await allerA(page, '#farmers/p_test_2');
        await page.evaluate(() => { window.__lectures.length = 0; });
        await page.click('.ops-route-actions button.btn.secondary');
        await page.waitForSelector('#farmerForm', { timeout: 10000 });
        const fpre = await page.evaluate(() => document.getElementById('ff_nom').value);
        verifier(fpre === 'PRODUCTEUR FICTIF 2', 'S9 · formulaire producteur prérempli en édition');
        const fsexe = await page.evaluate(() => document.getElementById('ff_sexe').value);
        verifier(fsexe === 'M', 'S9 · sexe prérempli depuis le code base M (affiché Homme)');
        await page.click('#ff_submit');
        await page.waitForTimeout(350);
        const fEcr = await page.evaluate(() => ({
          upd: window.__lectures.filter((x) => x === 'update:producteurs').length,
          ins: window.__lectures.filter((x) => x === 'insert:producteurs').length,
          sexe: window.__lectures.filter((x) => x === 'update-sexe:M').length
        }));
        verifier(fEcr.upd === 1 && fEcr.ins === 0, 'S9 · producteur modifié sans re-création (Farmer ID conservé)');
        verifier(fEcr.sexe === 1, 'S9 · le sexe est réenregistré au format base (M) et survit au rechargement');
        await page.waitForTimeout(1300);

        // S10 — clic sur un village → Fiche Village 360°
        await allerA(page, '#rt/villages');
        const lienV = await page.evaluate(() =>
          [...document.querySelectorAll('#rtBody a.ops-link')].some((a) => /^#villages\//.test(a.getAttribute('href'))));
        verifier(lienV, 'S10 · liste villages : noms cliquables');
        await allerA(page, '#villages/v_test_2');
        const ficheV = await page.evaluate(() => ({
          titre: (document.querySelector('.ops-route-head h1') || {}).textContent || '',
          tabs: document.querySelectorAll('.ops-passport-tabs a').length
        }));
        verifier(/VILLAGE FICTIF 2/.test(ficheV.titre) && ficheV.tabs === 12,
          `S10 · fiche Village : 12 onglets (vu ${ficheV.tabs})`);

        // S11 — Modifier le village : formulaire s1…s9 prérempli, update même ligne
        await page.click('.ops-route-actions button.btn.primary');
        await page.waitForSelector('#villageForm', { timeout: 10000 });
        const vpre = await page.evaluate(() => ({
          nom: document.getElementById('vf_nom').value,
          cluster: document.getElementById('vf_cluster').value,
          pot: document.getElementById('vf_pot').value
        }));
        verifier(vpre.nom === 'VILLAGE FICTIF 2' && vpre.cluster && vpre.pot !== '',
          'S11 · village en édition : s1 et s3 préremplis');
        await page.evaluate(() => { window.__lectures.length = 0; });
        await page.click('#vf_submit');
        await page.waitForTimeout(300);
        const vEcr = await page.evaluate(() => ({
          upd: window.__lectures.filter((x) => x === 'update:villages').length,
          ins: window.__lectures.filter((x) => x === 'insert:villages').length
        }));
        verifier(vEcr.upd === 1 && vEcr.ins === 0, 'S11 · village modifié : update de la même ligne');
        await page.waitForTimeout(1300);

        // S12/S13/S14 — galerie village : 2 photos existantes + ajouts multiples
        await allerA(page, '#villages/v_test_2/galerie');
        const gal = await page.evaluate(() => ({
          items: document.querySelectorAll('.ops-gallery-item').length,
          lazy: [...document.querySelectorAll('.ops-gallery-item img')].every((i) => i.loading === 'lazy'),
          legende: /ENTREE TEST/.test(document.getElementById('opsRouteView').textContent)
        }));
        verifier(gal.items === 2 && gal.legende, `S14 · galerie : ${gal.items} photos avec légendes et catégories`);
        verifier(gal.lazy, 'S19-perf · miniatures en lazy loading');
        await page.evaluate(() => { window.__lectures.length = 0; });
        await prendrePhoto(() => ANAGROCI_FB.addVillagePhoto('v_test_2'), 'village1.png');
        await page.waitForTimeout(500);
        const gEcr = await page.evaluate(() => ({
          up: window.__lectures.filter((x) => x === 'storage-upload:photos').length,
          upd: window.__lectures.filter((x) => x === 'update:villages').length
        }));
        verifier(gEcr.up === 1 && gEcr.upd === 1, 'S12 · photo village téléversée (bucket photos) + métadonnées enregistrées');
        await prendrePhoto(() => ANAGROCI_FB.addVillagePhoto('v_test_2'), 'village2.png');
        await page.waitForTimeout(500);
        const gEcr2 = await page.evaluate(() => window.__lectures.filter((x) => x === 'storage-upload:photos').length);
        verifier(gEcr2 === 2, 'S13 · plusieurs photos ajoutées à la galerie');

        // SCÉNARIOS 9-10 — Farmer Passport 360° : 12 sections, enrichissement progressif
        await allerA(page, '#farmers/p_test_2');
        const pass = await page.evaluate(() => ({
          tabs: [...document.querySelectorAll('.ops-passport-tabs a')].map((a) => a.textContent.trim()),
          niveau: /Opérationnel ✓/.test(document.querySelector('.ops-route-head p').textContent),
          parcelleMention: /Parcelle/.test(document.querySelector('.ops-route-head p').textContent)
        }));
        verifier(pass.tabs.length === 12, `passport : 12 sections (vu ${pass.tabs.length})`);
        for (const t of ['Identité', 'Exploitation', 'Parcelles', 'Production', 'Sustainability',
                         'Consentements', 'Visites', 'Inspections', 'Achats', 'Actions', 'Historique']) {
          verifier(pass.tabs.includes(t), `passport : section « ${t} »`);
        }
        verifier(pass.niveau && pass.parcelleMention, 'passport : niveaux « Opérationnel ✓ » et état parcelle affichés');
        await allerA(page, '#farmers/p_test_2/plots');
        const plotsTab = await page.evaluate(() => document.getElementById('opsRouteView').textContent);
        verifier(/à compléter après campagne|Règle 2027/i.test(plotsTab), 'passport : onglet Parcelles avec règle 2027');

        // SCÉNARIO 11 — Achat à un producteur sans parcelle : doit fonctionner
        // (p_test_2 a gps_mapped_count=0 dans la doublure)
        await allerA(page, '#purchases');
        await page.click('#newBuyBtn');
        await page.waitForSelector('#buyForm', { timeout: 15000 });
        await page.selectOption('#bf_village', 'v_test_2');
        await page.selectOption('#bf_farmer', 'p_test_2');
        await page.fill('#bf_brut', '500');
        await page.fill('#bf_sacs', '6');
        const prixDefaut = await page.evaluate(() => document.getElementById('bf_prix').value);
        verifier(prixDefaut === '400', `formulaire achat : prix campagne 400 par défaut (vu ${prixDefaut})`);
        await page.fill('#bf_prix', '450');
        await page.waitForTimeout(80);
        const motifVisible = await page.evaluate(() => !document.getElementById('bf_motif_prix').closest('.ops-field').hidden);
        verifier(motifVisible, 'formulaire achat : motif exigé quand le prix sort du barème');
        await page.fill('#bf_prix', '400');
        await page.click('#bf_submit');
        await page.waitForTimeout(200);
        const msgRecu = await page.evaluate(() => document.getElementById('bf_msg').textContent);
        verifier(/reçu/i.test(msgRecu), 'formulaire achat : le n° de reçu est exigé pour un achat complet');
        const ctxSansParcelle = await page.evaluate(() => document.getElementById('bf_ctx').textContent);
        verifier(/parcelle à compléter après campagne/i.test(ctxSansParcelle),
          'achat : producteur sans parcelle signalé comme NON bloquant');
        await page.fill('#bf_ref', 'RC-TEST-11');
        await page.click('#bf_submit');
        await page.waitForTimeout(300);
        const insA = await page.evaluate(() => window.__lectures.filter((x) => x === 'insert:achats').length);
        verifier(insA === 1, 'SCÉNARIO 11 : achat enregistré pour un producteur sans parcelle');
        await page.waitForTimeout(1300);

        // 7. Carte : Leaflet initialisé, marqueurs villages présents
        await allerA(page, '#hubs');
        await page.waitForTimeout(600);
        const carte = await page.evaluate(() => ({
          leaflet: !!window.L,
          conteneur: !!document.querySelector('#fbMap.leaflet-container'),
          marqueurs: document.querySelectorAll('#fbMap path.leaflet-interactive').length,
          usine: document.querySelectorAll('#fbMap .leaflet-marker-icon').length
        }));
        verifier(carte.leaflet && carte.conteneur, 'carte : Leaflet initialisé dans le shell');
        verifier(carte.marqueurs >= 9, `carte : villages et hubs dessinés (${carte.marqueurs} éléments)`);
        verifier(carte.usine >= 1, 'carte : marqueur usine Yamoussoukro présent');

        // 8. Sacherie : demande RT + règle approval ≠ sortie
        await allerA(page, '#bags');
        const sac = await page.evaluate(() => ({
          action: [...document.querySelectorAll('.ops-route-actions .btn')].some((x) => /Nouvelle demande RT/.test(x.textContent)),
          regle: /l’approbation n’est pas la sortie physique/i.test(document.getElementById('opsRouteView').textContent),
          multi: /700 \+ 500 \+ 800/.test(document.getElementById('opsRouteView').textContent),
          rtAccount: /RT Bag Account/i.test(document.getElementById('opsRouteView').textContent)
        }));
        verifier(sac.action, 'sacherie : « + Nouvelle demande RT » visible');
        verifier(sac.regle && sac.multi, 'sacherie : règle approbation ≠ sortie et multi-release affichées');
        verifier(sac.rtAccount, 'sacherie : RT Bag Account présent');

        // 9. Command Center : alertes cliquables
        await allerA(page, '#command');
        const cmd = await page.evaluate(() => ({
          lignes: document.querySelectorAll('#cmdTable tbody tr').length,
          liens: document.querySelectorAll('#cmdTable a.btn').length,
          sansRecu: /Achat sans reçu/.test(document.getElementById('cmdTable').textContent)
        }));
        verifier(cmd.lignes > 0 && cmd.liens > 0, `command center : ${cmd.lignes} alerte(s), chacune avec lien`);
        verifier(cmd.sansRecu, 'command center : alerte « Achat sans reçu » héritée du cockpit BM');

        // 10. Traceability : la routine E2E répond
        await allerA(page, '#traceability');
        await page.fill('#fbTraceQ', 'FICT-1001');
        await page.click('#fbTraceForm button[type=submit]');
        await page.waitForTimeout(300);
        const trace = await page.evaluate(() => document.getElementById('fbTraceOut').textContent);
        verifier(/LOT-20260820-000001/.test(trace), 'traceability : chaîne Farmer → Lot → Expédition restituée');

        // 11. Cache : retour sur 4 rubriques sans relire les référentiels
        await allerA(page, '#overview');
        await page.evaluate(() => { window.__lectures.length = 0; });
        const chrono = {};
        for (const [lib, h] of [['Vue d’ensemble → Recensement', '#census'],
                                ['Recensement → Achats', '#purchases'],
                                ['Achats → RT & Villages', '#rt'],
                                ['RT & Villages → Vue d’ensemble', '#overview']]) {
          const t0 = Date.now();
          await allerA(page, h);
          chrono[lib] = Date.now() - t0;
        }
        const lectures = await page.evaluate(() => window.__lectures.filter((x) => x === 'villages' || x === 'achats').length);
        notes.push('  chronos (cache chaud) : ' + JSON.stringify(chrono));
        verifier(lectures === 0, `cache : référentiels non relus au changement de rubrique (relus ${lectures} fois)`);
        for (const [lib, ms] of Object.entries(chrono)) {
          verifier(ms < 300, `changement « ${lib} » en ${ms} ms (< 300 ms)`);
        }
      }

      // S18 — fiche RT lisible en mobile
      if (largeur === 390) {
        await allerA(page, '#rt/rt_test_5');
        const mob = await page.evaluate(() => ({
          avatar: !!document.querySelector('.ops-avatar'),
          debordement: document.documentElement.scrollWidth > window.innerWidth + 1,
          tabs: document.querySelectorAll('.ops-passport-tabs a').length
        }));
        verifier(mob.avatar && !mob.debordement && mob.tabs === 8,
          'S18 · fiche RT mobile 390px : avatar, onglets, aucun débordement');
      }

      // Captures
      if (dossierCaptures && (largeur === 1440 || largeur === 390 || largeur === 360)) {
        for (const [nom, hash] of [['overview', '#overview'], ['census', '#census'],
                                   ['purchases', '#purchases'], ['hubs', '#hubs'], ['bags', '#bags']]) {
          await allerA(page, hash);
          if (hash === '#hubs') await page.waitForTimeout(600);
          await page.screenshot({ path: join(dossierCaptures, `fb-${nom}-${largeur}.png`) });
        }
      }

      const dures = erreurs.filter((e) => !/favicon|manifest|Failed to load resource|leaflet/i.test(e));
      verifier(dures.length === 0, `${largeur}px · aucune erreur console` + (dures.length ? ' — ' + dures[0] : ''));
      await contexte.close();
    }
  } finally {
    await navigateur.close();
    serveur.close();
  }

  console.log(notes.join('\n'));
  console.log('\n' + (echecs.length ? `${echecs.length} ÉCHEC(S)\n- ` + echecs.join('\n- ')
    : `FIELD BUYING E2E : PASS (${LARGEURS.length} largeurs)`));
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
