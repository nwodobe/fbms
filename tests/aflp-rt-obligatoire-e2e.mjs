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
const PORT = Number(process.env.PORT_FBMS ?? 4341);
const SEUIL_TACTILE = 44;
const LARGEURS = [390, 768, 1440];

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
  /* Candidat RT dont les images ont été migrées : chemins de stockage privés,
     plus aucun base64 dans le JSONB (clés photo/pieceRecto/pieceVerso à null). */
  VILLAGES[1].data.s7 = { candidats: [{ nom: 'CANDIDAT TEST', telephone: '0700000099',
    activite: 'Producteur', reputation: 'Bonne', smartphone: true,
    photo: null, pieceRecto: null, pieceVerso: null,
    photoPath: 'migration/aaaa1111.jpg', pieceRectoPath: 'migration/bbbb2222.jpg',
    pieceVersoPath: 'migration/cccc3333.jpg' }] };
  VILLAGES[1].data.galerie = [
    { path: 'v_test_2/gallery/a.jpg', legende: 'ENTREE TEST', categorie: 'Entrée du village', date: '2026-08-20', agent: 'AGENT TEST' },
    { path: 'v_test_2/gallery/b.jpg', legende: 'ROUTE TEST', categorie: 'Route d’accès', date: '2026-08-21', agent: 'AGENT TEST' }
  ];
  /* Expose le jeu de villages a l'assertion des etiquettes de carte. */
  window.__FB_VILLAGES = VILLAGES;
  var TABLES = {
    villages: VILLAGES, rt: RTS,
    /* Les vues LIGHT servent les mêmes lignes que les tables (la doublure
       n'embarque pas d'images base64, la projection est donc identique). */
    villages_light_v: VILLAGES, rt_light_v: RTS,
    farmer_passport_summary_v: FARMERS, achats: ACHATS,
    aflp_zones: ZN, aflp_clusters: CL,
    avances: [{ id: 'av1', date: '2026-08-20', cluster: 'Brobo', rt_id: 'rt_test_2',
      rt_nom: 'RT FICTIF 2', source: 'Finance', montant: 500000, motif: 'CAMPAGNE',
      statut: 'Active', cycle_id: 'CYC-1', cycle_statut: 'OPEN', volume_finance_kg: 2000,
      created_at: '2026-08-20' }],
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
    ops_bag_requests: [
      /* Approbation BM active, sortie partielle en cours (multi-release). */
      { id: 'br1', request_code: 'BAG-2027-001', channel: 'AFLP',
        campaign: '2027', cluster: 'Brobo', rt_id: 'rt_test_2', requested_qty: 200,
        approved_qty: 200, released_qty: 120, received_qty: 120, status: 'PARTIALLY_RELEASED',
        requested_at: '2026-08-20', approved_at: '2026-08-21', expires_at: '2099-09-30',
        source_location_code: 'AFLP-CL-BROBO', destination_location_code: 'AFLP-RT-rt_test_2' },
      /* Demande fraîche : à faire avancer (revue → consolidation → BM). */
      { id: 'br2', request_code: 'BAG-2027-002', channel: 'AFLP',
        campaign: '2027', cluster: 'Diabo', rt_id: 'rt_test_6', requested_qty: 100,
        approved_qty: null, released_qty: 0, received_qty: 0, status: 'REQUESTED',
        requested_at: '2026-08-28',
        source_location_code: 'AFLP-CL-DIABO', destination_location_code: 'AFLP-RT-rt_test_6' },
      /* Consolidée : décision BM attendue. */
      { id: 'br3', request_code: 'BAG-2027-003', channel: 'AFLP',
        campaign: '2027', cluster: 'Botro', rt_id: 'rt_test_3', requested_qty: 80,
        approved_qty: null, released_qty: 0, received_qty: 0, status: 'CONSOLIDATED',
        requested_at: '2026-08-27',
        source_location_code: 'AFLP-CL-BOTRO', destination_location_code: 'AFLP-RT-rt_test_3' },
      /* Sortie totale avec écart de réception : 60 libérés, 58 reçus. */
      { id: 'br4', request_code: 'BAG-2027-004', channel: 'AFLP',
        campaign: '2027', cluster: 'Sakassou', rt_id: 'rt_test_4', requested_qty: 60,
        approved_qty: 60, released_qty: 60, received_qty: 58, status: 'FULLY_RELEASED',
        requested_at: '2026-08-22', approved_at: '2026-08-22', expires_at: '2099-09-30',
        source_location_code: 'AFLP-CL-SAKASSOU', destination_location_code: 'AFLP-RT-rt_test_4' },
      /* Héritée du premier moteur : codes de location invalides, à re-créer. */
      { id: 'br5', request_code: 'BAG-2027-005', channel: 'AFLP',
        campaign: '2027', cluster: 'Brobo', rt_id: 'rt_test_2', requested_qty: 40,
        approved_qty: null, released_qty: 0, received_qty: 0, status: 'REQUESTED',
        requested_at: '2026-08-19',
        source_location_code: 'CLUSTER:Brobo', destination_location_code: 'RT:rt_test_2' }],
    rcn_jute_locations: CL.map(function (c, k) {
      return { code: 'AFLP-CL-' + c.label.toUpperCase(), scope_type: 'CLUSTER', cluster: c.label,
        rt_id: null, nom: 'Cluster ' + c.label, actif: true };
    }).concat(RTS.map(function (r) {
      return { code: 'AFLP-RT-' + r.id, scope_type: 'RT', cluster: r.cluster,
        rt_id: r.id, nom: r.nom, actif: true };
    })),
    ops_bag_releases: [
      { id: 'rel1', client_release_id: 'k-rel1', request_id: 'br1', qty: 70,
        source_location_code: 'AFLP-CL-BROBO', destination_location_code: 'AFLP-RT-rt_test_2',
        released_by: 'u1', proof_url: 'u1/sacherie-1.jpg', notes: 'Sortie 1', created_at: '2026-08-23' },
      { id: 'rel2', client_release_id: 'k-rel2', request_id: 'br1', qty: 50,
        source_location_code: 'AFLP-CL-BROBO', destination_location_code: 'AFLP-RT-rt_test_2',
        released_by: 'u1', proof_url: null, notes: 'Sortie 2', created_at: '2026-08-24' }],
    sacherie_ct_global_stock: [{ total: 3600, vides: 3195, pleins: 300, transit: 5,
      dechires: 2, a_reparer: 5, repares: 0, rebut: 0 }],
    rcn_jute_loss_requests: [{ id: 'jls1', location_code: 'AFLP-RT-rt_test_2', state: 'UTILISABLE',
      qty: 5, motif: 'PLUIE ENTREPOT TEST', statut: 'SOUMIS', submitted_at: '2026-08-26' }],
    sacherie_ct_latest_inventory: [{ id: 'inv1', location_code: 'AFLP-CL-DIABO', state: 'UTILISABLE',
      theoretical_qty: 855, counted_qty: 850, difference_qty: -5, motif: 'ECART TEST',
      reconciliation_status: 'HOLD', counted_at: '2026-08-25' }],
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
    /* Branch Manager : le rôle qui voit toutes les actions du workflow sacherie. */
    profils: { nom: 'PROFIL DE TEST', role: 'Branch Manager', actif: true }
  };
  function requete(nom) {
    window.__lectures.push(nom);
    var data = TABLES[nom];
    var liste = Array.isArray(data) ? data.slice() : [];
    var unique = Array.isArray(data) ? null : (data || null);
    var filtres = [];
    var c = {
      select: f, insert: function (row) {
        window.__lectures.push('insert:' + nom);
        window.__writes = window.__writes || [];
        window.__writes.push({ op: 'insert', t: nom, row: row });
        return c;
      },
      update: function (row) {
        window.__lectures.push('update:' + nom);
        if (row && row.sexe) window.__lectures.push('update-sexe:' + row.sexe);
        window.__writes = window.__writes || [];
        window.__writes.push({ op: 'update', t: nom, row: row });
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
          window.__rpcArgs = window.__rpcArgs || [];
          window.__rpcArgs.push({ nom: nom, args: args });
          if (nom === 'sacherie_calculer_plafond') {
            /* Règle serveur réelle : plafond = floor(((rcn + restant) × 1,10) / 80). */
            var fin = 2000, achete = 400, restant = fin - achete;
            var plafond = Math.floor(((Number(args.p_stock_rcn_kg) + restant) * 1.10) / 80);
            return Promise.resolve({ data: { volume_finance_kg: fin, volume_achete_cycle_kg: achete,
              volume_finance_restant_kg: restant, stock_rcn_kg_verified: args.p_stock_rcn_kg,
              bags_already_held: 10, reserved_approved_bags: 0, system_max_bags: plafond,
              max_new_bags: Math.max(plafond - 10, 0), max_new_available: Math.max(plafond - 10, 0),
              cluster_stock: 400 }, error: null });
          }
          if (nom === 'ops_release_bags') {
            window.__releases = window.__releases || [];
            var deja = window.__releases.filter(function (x) { return x.cle === args.p_client_release_id; })[0];
            if (deja) return Promise.resolve({ data: deja.ligne, error: null });
            var ligne = { id: 'rel-' + (window.__releases.length + 1), client_release_id: args.p_client_release_id, qty: args.p_qty };
            window.__releases.push({ cle: args.p_client_release_id, ligne: ligne });
            return Promise.resolve({ data: ligne, error: null });
          }
          if (nom === 'sacherie_ct_inventorier') {
            var theo = 100, diff = Number(args.p_counted) - theo;
            return Promise.resolve({ data: { id: 'inv-x', theoretical: theo, counted: args.p_counted,
              difference: diff, status: diff === 0 ? 'PASS' : 'HOLD' }, error: null });
          }
          if (nom === 'sacherie_ct_declarer_perte') return Promise.resolve({ data: 'JLS-CT-TEST', error: null });
          if (nom === 'sacherie_ct_decider_perte') return Promise.resolve({ data: 'JUT-LOSS-TEST', error: null });
          if (nom === 'sacherie_ct_traiter_etat') return Promise.resolve({ data: 'JUT-CT-TEST', error: null });
          if (nom === 'sacherie_ct_location') return Promise.resolve({ data: 'AFLP-RT-CREE-TEST', error: null });
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
/* Refonte « Jute Bag Control Tower » : la sacherie n'est plus une page unique
   mais cinq ecrans. Les assertions suivent donc l'ecran qui porte desormais
   chaque information, et les decisions d'un dossier se prennent dans son
   detail (#bags/flow/{id}), plus dans une liste geante. */
async function texteEcran(page, hash) {
  await allerA(page, hash);
  await page.waitForTimeout(350);
  return page.evaluate(() => document.getElementById('opsRouteView').textContent);
}
async function ouvrirDossierSacherie(page, motifBouton) {
  await allerA(page, '#bags/flows');
  const liens = await page.evaluate(() => [...document.querySelectorAll('#opsRouteView a')]
    .map((x) => x.getAttribute('href') || '').filter((h) => /#bags\/flow\//.test(h)));
  if (!liens.length) throw new Error('aucun dossier sacherie liste dans Flux');
  for (const href of liens) {
    await page.evaluate((h) => { location.hash = h; }, href);
    await page.waitForFunction(() => !document.querySelector('#opsRouteView .skeleton'), null, { timeout: 15000 });
    await page.waitForTimeout(200);
    if (!motifBouton) return;
    const trouve = await page.evaluate((m) => [...document.querySelectorAll('#opsRouteView button')]
      .some((b) => new RegExp(m).test(b.textContent)), motifBouton);
    if (trouve) return;
  }
  throw new Error('aucun dossier ne propose l\'action ' + motifBouton);
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

/* =====================================================================
   AFLP 08/11/2026 · RT obligatoire + indicateur « Sans RT »
   Banc : copie du harnais de field-buying-e2e.mjs (doublure Supabase,
   données 100 % fictives). Villages 1-10 : 1 RT chacun ; 11-12 : aucun RT ;
   producteurs fictifs 11 et 12 sans RT.
   ===================================================================== */
async function main() {
  const serveur = servir();
  await new Promise((r) => serveur.listen(PORT, r));
  const navigateur = await chromium.launch();
  const base = `http://127.0.0.1:${PORT}/operations/field-buying.html`;
  try {
    for (const largeur of LARGEURS) {
      const hauteur = largeur === 390 ? 844 : (largeur === 768 ? 1024 : 900);
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } });
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push('JS: ' + e.message));
      await page.addInitScript(DOUBLURE);
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (/supabase|jsdelivr|cdnjs|tailwindcss|fonts\.(googleapis|gstatic)|openstreetmap/i.test(url))
          return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* doublure */' });
        return route.continue();
      });
      notes.push(`\n── ${largeur} px ──`);

      // 1. Indicateur « Sans RT » et filtre
      await page.goto(base + '#farmers', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.querySelector('#opsRouteView .skeleton'), null, { timeout: 20000 });
      const kpi = await page.evaluate(() => {
        const k = [...document.querySelectorAll('.kpi small')].find((x) => x.textContent.trim() === 'Sans RT');
        return k ? { val: k.parentElement.querySelector('b').textContent, attn: k.parentElement.classList.contains('attn'),
                     det: k.parentElement.querySelector('span').textContent } : null;
      });
      verifier(kpi && kpi.val === '2', `${largeur}px · KPI « Sans RT » = 2 (vu ${kpi && kpi.val})`);
      verifier(kpi && kpi.attn && /\d/.test(kpi.det), `${largeur}px · KPI mis en alerte avec détail par cluster (« ${kpi && kpi.det} »)`);
      await page.selectOption('#pfFlag', 'NO_RT');
      await page.waitForTimeout(300);
      const lignes = await page.evaluate(() => document.querySelectorAll('#farmerTable tbody tr').length);
      verifier(lignes === 2, `${largeur}px · filtre « Sans RT » : 2 lignes (vu ${lignes})`);

      // 2. Formulaire : RT unique présélectionné
      await page.evaluate(() => { ANAGROCI_FB.openFarmerForm(); });
      await page.waitForSelector('#farmerForm', { timeout: 15000 });
      await page.selectOption('#ff_village', 'v_test_4');
      const pre = await page.evaluate(() => ({ v: document.getElementById('ff_rt').value, h: document.getElementById('ff_rt_hint').textContent }));
      verifier(pre.v === 'rt_test_4', `${largeur}px · RT unique présélectionné (vu « ${pre.v} »)`);
      verifier(/présélectionné/.test(pre.h), `${largeur}px · aide affichée sous le champ RT`);

      // 3. Refus sans RT (village avec RT)
      await page.fill('#ff_nom', 'PRODUCTEUR TEST SANS RT');
      await page.selectOption('#ff_rt', '');
      const avant = await page.evaluate(() => window.__lectures.filter((x) => x === 'insert:producteurs').length);
      await page.click('#ff_submit');
      await page.waitForTimeout(300);
      let r = await page.evaluate(() => ({ m: document.getElementById('ff_msg').textContent,
        n: window.__lectures.filter((x) => x === 'insert:producteurs').length }));
      verifier(/Choisissez le RT/.test(r.m) && r.n === avant, `${largeur}px · création refusée sans RT, aucun envoi serveur`);

      // 4. Village sans aucun RT
      await page.selectOption('#ff_village', 'v_test_11');
      const opt = await page.evaluate(() => document.querySelector('#ff_rt option').textContent);
      verifier(/Aucun RT enregistré/.test(opt), `${largeur}px · village sans RT signalé dans la liste`);
      await page.click('#ff_submit');
      await page.waitForTimeout(300);
      r = await page.evaluate(() => ({ m: document.getElementById('ff_msg').textContent,
        n: window.__lectures.filter((x) => x === 'insert:producteurs').length }));
      verifier(/aucun RT dans FBMS/.test(r.m) && r.n === avant, `${largeur}px · village sans RT : message clair, aucun envoi`);

      // 5. Avec RT : création acceptée
      await page.selectOption('#ff_village', 'v_test_4');
      await page.click('#ff_submit');
      await page.waitForTimeout(500);
      r = await page.evaluate(() => window.__lectures.filter((x) => x === 'insert:producteurs').length);
      verifier(r === avant + 1, `${largeur}px · avec RT : producteur envoyé au serveur`);

      const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      verifier(!ov, `${largeur}px · aucun défilement horizontal`);
      verifier(erreurs.length === 0, `${largeur}px · aucune erreur JavaScript` + (erreurs.length ? ' — ' + erreurs[0] : ''));
      await contexte.close();
    }
  } finally { await navigateur.close(); serveur.close(); }
  console.log(notes.join('\n'));
  console.log('\n' + (echecs.length ? `${echecs.length} ÉCHEC(S)\n- ` + echecs.join('\n- ') : `AFLP RT OBLIGATOIRE E2E : PASS (${LARGEURS.length} largeurs)`));
  process.exit(echecs.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
