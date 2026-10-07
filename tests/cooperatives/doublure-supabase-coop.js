/* Doublure Supabase AVEC session pour la recette visuelle du module Coopératives.
   Données 100 % fictives (préfixe QA), aucune donnée réelle : règle CLAUDE.md §5.4.
   Le constructeur de requête applique réellement eq / neq / in / range / limit / order
   pour que les écrans reçoivent des sous-ensembles cohérents. */
(function () {
  'use strict';
  var C1 = '11111111-1111-4111-8111-111111111111', C2 = '22222222-2222-4222-8222-222222222222', C3 = '33333333-3333-4333-8333-333333333333';
  var S1 = 'aaaaaaaa-0000-4000-8000-000000000001', S2 = 'aaaaaaaa-0000-4000-8000-000000000002', WH = 'bbbbbbbb-0000-4000-8000-000000000001';
  var villages = [{ id: 'v-qa-1', village: 'QA BROBO', departement: 'BOUAKE', cluster: 'Brobo', cluster_code: 'BROBO', gps_lat: 7.63, gps_lng: -4.95, deleted: false },
    { id: 'v-qa-2', village: 'QA TAKIKRO', departement: 'BOUAKE', cluster: 'Brobo', cluster_code: 'BROBO', gps_lat: 7.66, gps_lng: -4.91, deleted: false },
    { id: 'v-qa-3', village: 'QA ALLOUKRO', departement: 'SAKASSOU', cluster: 'Sakassou', cluster_code: 'SAKASSOU', gps_lat: 7.45, gps_lng: -5.29, deleted: false }];
  function dash(id, code, name, st, extra) {
    return Object.assign({ cooperative_id: id, code: code, name: name, acronym: 'QA', locality: 'Brobo', departement: 'BOUAKE', sous_prefecture: 'BROBO', cluster_code: 'BROBO', zone_code: 'GBEKE_1',
      aflp_status: st, compliance_status: 'PARTIEL', producer_registry_status: 'PARTIEL', is_qa: false, archived: false, payment_model: 'INDIVIDUAL_FARMER', supplier_linked: false,
      declared_members: 500, producers_registered: 245, producers_verified: 180, producers_primary: 240, villages_covered: 12, sections: 3, declared_potential_mt: 380, farmer_potential_kg: 312000,
      farmer_potential_missing: 21, area_ha: 610, target_mt: 300, secured_volume_mt: 200, purchased_kg_mode_a: 125000, delivered_kg_mode_b: 0, purchased_kg: 125000, achievement_pct: 41.7,
      passport_complete: 90, consent_granted: 150, women: 61, youth: 44, birth_year_missing: 30, gps_plots: 120, documents_valid: 3, documents_expired: 1, documents_missing_categories: 3,
      deliveries_to_allocate: 1, kor_avg: 47.8, moisture_avg: 8.6, rejected_receptions: 0, bags_balance: 280, last_activity: '2026-10-05T10:00:00Z' }, extra || {});
  }
  var D = {
    profils: [{ user_id: 'u-qa', nom: 'QA BRANCH MANAGER', role: 'Branch Manager', actif: true }],
    aflp_clusters: [{ code: 'BROBO', label: 'Brobo', zone_code: 'GBEKE_1', active: true }, { code: 'SAKASSOU', label: 'Sakassou', zone_code: 'GBEKE_1', active: true }, { code: 'BEOUMI', label: 'Béoumi', zone_code: 'GBEKE_2', active: true }],
    aflp_zones: [{ code: 'GBEKE_1', label: 'Gbêkê 1', active: true }, { code: 'GBEKE_2', label: 'Gbêkê 2', active: true }],
    villages_light_v: villages,
    rt_light_v: [{ id: 'rt-qa-1', id_rt: 'RT-BRO-02', nom: 'QA RT DEUX', village_id: 'v-qa-1', cluster: 'Brobo', deleted: false }],
    wms_warehouses: [{ id: WH, code: 'WH-BROBO', name: 'QA Entrepôt Brobo', status: 'ACTIVE', is_factory: false }],
    aflp_cooperatives: [{ id: C1, code: 'COOP-001', name: 'QA COOP BROBO AVEC UN NOM TRES LONG POUR TESTER LE RETOUR A LA LIGNE', acronym: 'QACB', org_type: 'SCOOPS', region: 'GBEKE', departement: 'BOUAKE',
      sous_prefecture: 'BROBO', locality: 'Brobo', cluster_code: 'BROBO', gps_lat: 7.64, gps_lng: -4.94, phone: null, email: null, declared_members: 500, aflp_status: 'ACTIVE',
      compliance_status: 'PARTIEL', producer_registry_status: 'PARTIEL', aflp_join_date: '2026-10-01', supplier_id: null, is_qa: false, archived: false, row_version: 3 }],
    aflp_coop_campaigns: [{ id: 'cc1', cooperative_id: C1, campaign: '2027', payment_model: 'INDIVIDUAL_FARMER', declared_potential_mt: 380, target_mt: 300, secured_volume_mt: 200, zone_head_name: 'QA CHEF ZONE', unit_head_name: 'QA CHEF UNITE', referent_rt_id: 'rt-qa-1', destination_warehouse_id: WH }],
    aflp_coop_contacts: [{ id: 'k1', cooperative_id: C1, role: 'PRESIDENT', full_name: 'QA PRESIDENT', phone: '0700000001', active: true, is_primary: true }, { id: 'k2', cooperative_id: C1, role: 'MAGASINIER', full_name: 'QA MAGASINIER', phone: null, active: true }],
    aflp_coop_sections: [{ id: S1, cooperative_id: C1, name: 'Section QA Brobo', code: 'S1', leader_name: 'QA RESP', active: true }, { id: S2, cooperative_id: C1, name: 'Section QA Takikro', active: true }],
    aflp_coop_villages: [{ id: 'cv1', cooperative_id: C1, village_id: 'v-qa-1', section_id: S1, declared_producers: 95, active: true }, { id: 'cv2', cooperative_id: C1, village_id: 'v-qa-2', section_id: S2, declared_producers: 70, active: true },
      { id: 'cv3', cooperative_id: C1, village_id: null, village_name: 'QA CAMPEMENT', active: true }],
    aflp_coop_collection_points: [{ id: 'cp1', cooperative_id: C1, name: 'PC QA Brobo', village_id: 'v-qa-1', gps_lat: 7.635, gps_lng: -4.945, capacity_mt: 50, destination_warehouse_id: WH, active: true }],
    aflp_coop_documents: [{ id: 'd1', cooperative_id: C1, category: 'AGREMENT', file_name: 'agrement-qa.pdf', storage_path: C1 + '/x-agrement.pdf', issued_on: '2025-01-10', expires_on: '2026-11-01', voided: false, created_at: '2026-10-01' },
      { id: 'd2', cooperative_id: C1, category: 'STATUTS', file_name: 'statuts-qa.pdf', storage_path: C1 + '/y.pdf', expires_on: '2025-01-01', voided: false, created_at: '2026-10-01' }],
    aflp_coop_audit: [{ id: 1, cooperative_id: C1, entity: 'aflp_cooperatives', entity_id: C1, operation: 'INSERT', after_data: { code: 'COOP-001' }, actor_email: 'qa@example.org', actor_role: 'Branch Manager', created_at: '2026-10-01T08:00:00Z' },
      { id: 2, cooperative_id: C1, entity: 'aflp_cooperatives', entity_id: C1, operation: 'UPDATE', before_data: { aflp_status: 'APPROUVEE' }, after_data: { aflp_status: 'ACTIVE' }, actor_email: 'qa@example.org', created_at: '2026-10-02T08:00:00Z' },
      { id: 3, cooperative_id: C1, entity: 'import_producteurs', operation: 'IMPORT', after_data: { importes: 200, existants_associes: 40, rejetes: 5 }, actor_email: 'qa@example.org', created_at: '2026-10-03T08:00:00Z' }],
    farmer_passport_summary_v: [{ producteur_id: 'p-qa-1', farmer_id: 'QABR-0001', nom: 'QA PRODUCTEUR 1', prenoms: 'TEST', village_id: 'v-qa-1', village_nom: 'QA BROBO', rt_id: 'rt-qa-1', rt_nom: 'QA RT DEUX',
      cluster_code: 'BROBO', cluster_label: 'Brobo', zone_code: 'GBEKE_1', operational_status: 'ACTIVE', passport_stage: 'BASIC', passport_completion: 45, risk_profile: 'NOT_ASSESSED', deleted: false }],
    aflp_coop_members_v: [], aflp_coop_memberships: [{ id: 'mh1', producer_id: 'p-qa-1', campaign: '2027', status: 'ACTIVE', is_primary: true, member_number: 'CXYZ-00452', membership_start: '2026-10-01', verified: true, source: 'IMPORT_EXCEL', cooperative_id: C1, aflp_cooperatives: { code: 'COOP-001', name: 'QA COOP BROBO' } },
      { id: 'mh0', producer_id: 'p-qa-1', campaign: '2027', status: 'ENDED', is_primary: false, member_number: 'OLD-01', membership_start: '2026-06-01', membership_end: '2026-09-30', verified: false, source: 'MANUEL', cooperative_id: C2, aflp_cooperatives: { code: 'COOP-002', name: 'QA COOP SAKASSOU' } }],
    aflp_producer_channel_v: [{ producer_id: 'p-qa-1', farmer_id: 'QABR-0001', sourcing_channel: 'COOPERATIVE', primary_cooperative_id: C1, primary_cooperative_code: 'COOP-001', primary_cooperative_name: 'QA COOP BROBO', member_number: 'CXYZ-00452', section_name: 'BROBO 2', followup_rt_id: 'rt-qa-1', enrollment_channel: 'AFLP_DIRECT' }],
    aflp_coop_delivery_status_v: [{ id: 'dl1', code: 'LIV-COOP-2027-00001', cooperative_id: C1, cooperative_code: 'COOP-001', status: 'RECUE', planned_date: '2026-12-10', planned_kg: 20000, delivered_kg: 20000, delivered_at: '2026-12-10T10:00:00Z',
      allocated_kg: 12000, allocated_producers: 6, allocation_status: 'ALLOCATION_A_COMPLETER', arrival_id: 'ARR-QA-1', reception_id_resolved: 'RCV-QA-1', warehouse_code: 'WH-BROBO', campaign: '2027',
      supplier_name: 'QA SUPPLIER COOP', origin: 'QA BROBO', truck: 'QA-0001-AB', driver: 'QA CHAUFFEUR', delivered_bags: 250, planned_bags: 250, traceability_level: 'ORGANISATION_SEULEMENT', is_qa: false, cooperative_name: 'QA COOP BROBO' }],
    achats: [{ id: 'a1', date: '2026-12-01', producteur_id: 'p-qa-1', producteur_code: 'QABR-0001', producteur_nom: 'QA PRODUCTEUR 1', village_nom: 'QA BROBO', rt_nom: 'QA RT DEUX', poids_net: 1500, nb_sacs: 19, coop_member_number: 'CXYZ-00452', statut_validation: 'VALIDE', stock_statut: 'EN_LOT', kor: 48, humidite: 8, rejet: false, village_id: 'v-qa-1' }],
    aflp_coop_enrollment_reviews: [{ id: 'rv1', cooperative_id: C1, status: 'OUVERT', category: 'DOUBLON_A_VERIFIER', source: 'IMPORT_EXCEL', row_index: 12, created_at: '2026-10-05T09:00:00Z',
        candidate: { nom: 'QA CANDIDAT', prenoms: 'DOUBLON', telephone: '0700010011', village_id: 'v-qa-1', member_number: 'CXYZ-09001' }, top_confidence: 95, reason: 'Correspondance forte (téléphone) avec un producteur existant',
        matches: [{ producer_id: 'p-qa-11', farmer_id: 'QABR-0011', reason: 'TELEPHONE_MEME_VILLAGE', confidence: 95 }] },
      { id: 'rv2', cooperative_id: C1, status: 'OUVERT', category: 'A_COMPLETER', source: 'FORMULAIRE', created_at: '2026-10-05T10:00:00Z', candidate: { nom: 'QA SANS VILLAGE', village: 'QA INCONNU' }, top_confidence: null, reason: 'A_COMPLETER: village manquant ou absent du référentiel AFLP', matches: [] }],
    aflp_coop_import_batches: [{ id: 'ib1', cooperative_id: C1, file_name: 'qa-import.xlsx', total_rows: 520, nouveaux: 468, existants_associes: 40, a_completer: 4, doublons_a_verifier: 6, rejetes: 1, ignores: 1, status: 'TERMINE', created_at: '2026-10-04T08:00:00Z', created_by_email: 'qa@example.org' }],
    aflp_coop_trainings: [{ id: 't1', cooperative_id: C1, topic: 'QA Bonnes pratiques de récolte', category: 'BONNES_PRATIQUES', training_date: '2026-09-20', trainer: 'QA FORMATEUR', location: 'QA BROBO', active: true }],
    aflp_coop_training_attendance: [{ training_id: 't1', producer_id: 'p-qa-1' }, { training_id: 't1', producer_id: 'p-qa-2' }],
    farmer_sustainability_baselines: [{ producteur_id: 'p-qa-1', status: 'FINAL', risk_profile: 'LOW', answered_count: 20, required_count: 20 }],
    farmer_action_plans: [{ producteur_id: 'p-qa-3', status: 'OPEN', priority: 'HIGH' }],
    aflp_producer_quality_v: [{ producer_id: 'p-qa-1', farmer_id: 'QABR-0001', completeness_pct: 75, missing_fields: ['GPS', 'POTENTIEL'] }],
    aflp_coop_sections_all: [],
    procurement_v_pending_receptions: [], aflp_lot_origin_v: [],
    farmer_inspections: [], rcn_jute_v_supplier_profile: [], rcn_jute_movements: [], procurement_suppliers: [], procurement_supplier_code_history: [], operations_traceability_search_v: []
  };
  for (var i = 1; i <= 120; i++) D.aflp_coop_members_v.push({ membership_id: 'm' + i, cooperative_id: C1, campaign: '2027', producer_id: 'p-qa-' + i, farmer_id: 'QABR-' + String(i).padStart(4, '0'), nom: 'QA PRODUCTEUR ' + i, prenoms: 'TEST',
    village_id: i % 2 ? 'v-qa-1' : 'v-qa-2', village_nom: i % 2 ? 'QA BROBO' : 'QA TAKIKRO', telephone: i % 3 ? '07000' + String(10000 + i) : null, sexe: i % 4 ? 'M' : 'F', birth_year: i % 5 ? 1970 + (i % 40) : null,
    consent_status: i % 3 ? 'GRANTED' : 'NOT_RECORDED', passport_stage: i % 2 ? 'BASIC' : 'MAPPED', passport_completion: 40 + (i % 50), member_number: 'CXYZ-' + String(i).padStart(5, '0'),
    section_id: i % 2 ? S1 : S2, section_name: i % 2 ? 'Section QA Brobo' : 'Section QA Takikro', status: 'ACTIVE', is_primary: i !== 7, verified: i % 4 !== 0, area_ha: i % 6 ? 2.5 : null,
    potential_kg: i % 7 ? 1300 : null, potential_source: i % 7 ? 'DECLARE' : 'NON_COLLECTE', plot_count: 1, gps_plots: i % 3 ? 1 : 0, last_purchase_date: i % 2 ? '2026-12-01' : null, possible_duplicate: i === 9,
    age_band: null, review_required: i === 9, is_qa: false,
    completeness_pct: [100, 88, 75, 63, 50, 38][i % 6], missing_fields: [[], ['GPS'], ['GPS', 'POTENTIEL'], ['GPS', 'POTENTIEL', 'CONSENTEMENT'], ['TELEPHONE', 'GPS', 'SUPERFICIE', 'CONSENTEMENT'], ['TELEPHONE', 'AGE', 'GPS', 'SUPERFICIE', 'CONSENTEMENT']][i % 6] });
  var RPC = {
    aflp_coop_dashboard: [dash(C1, 'COOP-001', 'QA COOP BROBO AVEC UN NOM TRES LONG POUR TESTER LE RETOUR A LA LIGNE', 'ACTIVE'), dash(C2, 'COOP-002', 'QA COOP SAKASSOU', 'EN_EVALUATION', { target_mt: null, achievement_pct: null, purchased_kg: 0, declared_potential_mt: null, cluster_code: 'SAKASSOU', locality: 'Sakassou', compliance_status: 'NON_EVALUE' }),
      dash(C3, 'COOP-003', 'QA COOP BEOUMI', 'SUSPENDUE', { cluster_code: 'BEOUMI', zone_code: 'GBEKE_2', achievement_pct: 92, purchased_kg: 276000, locality: 'Béoumi', compliance_status: 'CONFORME' }),
      dash('44444444-4444-4444-8444-444444444444', 'QA-COOP-001', 'QA COOP TEST', 'PROSPECT', { is_qa: true })],
    aflp_channel_totals: { campaign: '2027', producteurs_total: 3850, direct_rt: 2430, cooperatives: 1420, cooperatives_avec_rt_suivi: 310, sans_rt_ni_coop: 0 },
    aflp_coop_chain: { cooperative: { code: 'COOP-001' }, producteurs: { ouverts: 245, verifies: 180, historique: 260 }, achats_mode_a: { nombre: 410, kg: 125000, producteurs: 190 },
      achats_vers_lots_terrain: { lots: 12, kg: 118000 }, livraisons: [], lots: [{ lot: 'RCN-2027-00452', reception: 'RCV-QA-1', kg: 35800, statut: 'RELEASED', canal: 'COOPERATIVE', producteurs: 47, villages: 5, tracabilite: 'TRACABLE_PRODUCTEUR', kor: 47.9, humidite: 8.4, bins: ['BIN-BRO-01'], transferts: [{ id: 'TRF-QA-1', statut: 'IN_TRANSIT', destination: 'YAK-FWH', usine: true }] }] },
    aflp_coop_match_producers_v2: function (a) {
      var out = [];
      (a.p_rows || []).forEach(function (r) {
        if (r.telephone === '0700010011' || /^QA PRODUCTEUR 11$/.test(r.nom || '')) out.push({ idx: r.idx, producer_id: 'p-qa-11', farmer_id: 'QABR-0011', nom: 'QA PRODUCTEUR 11', prenoms: 'TEST', village_id: 'v-qa-1', village_nom: 'QA BROBO', telephone_masque: '******0011', reason: 'TELEPHONE_MEME_VILLAGE', confidence: 95, coop_codes: 'COOP-001', rt_id: 'rt-qa-1', accessible: true });
        if (/^QA HOMONYME/.test(r.nom || '')) out.push({ idx: r.idx, producer_id: null, farmer_id: 'QAXX-0099', nom: 'PRODUCTEUR HORS PÉRIMÈTRE', village_nom: 'QA ALLOUKRO', reason: 'NOM_MEME_VILLAGE', confidence: 60, accessible: false });
      });
      return out;
    },
    aflp_coop_enroll_producer: function () { return { status: 'ENROLE', producer_id: 'p-qa-new', farmer_id: 'QABR-0999', completeness_pct: 63 }; },
    aflp_coop_add_member: function () { return { created: false, farmer_id: 'QABR-0011', membership: { id: 'm-new' } }; },
    aflp_coop_review_decide: function () { return { status: 'RESOLU', decision: 'ASSOCIER_EXISTANT', farmer_id: 'QABR-0011' }; },
    aflp_coop_import_rows: function (a) {
      var M = { CREATE: 'NOUVEAU_ENROLE', LINK: 'EXISTANT_ASSOCIE', COMPLETE: 'A_COMPLETER', REVIEW: 'DOUBLON_A_VERIFIER', REJECT: 'REJETE', SKIP: 'IGNORE' };
      return { batch_id: 'ib-qa', details: (a.p_rows || []).map(function (r) { return { idx: r.idx, statut: M[r.action] || 'REJETE', farmer_id: r.action === 'CREATE' ? 'QABR-1' + r.idx : null }; }) };
    },
    aflp_coop_report: { producteurs: 3850, direct_rt: 2430, cooperative: 1420, membres_verifies: 900, femmes: 800, hommes: 2500, sexe_non_collecte: 550, jeunes_moins_35: 610, age_non_collecte: 700,
      consentement_accorde: 2100, consentement_non_recueilli: 1700, avec_gps: 1200, avec_superficie: 2600, completude_moyenne: 64, dossiers_complets: 420, cooperatives: 3, cooperatives_actives: 1,
      achats_nombre: 410, achats_kg: 125000, achats_kg_canal_coop: 98000, livraisons: 1, livraisons_recues_kg: 20000, livraisons_a_repartir: 1, livraisons_tracables: 0, target_mt: 300,
      par_cooperative: [{ cooperative_id: C1, code: 'COOP-001', name: 'QA COOP BROBO', statut: 'ACTIVE', cluster: 'BROBO', producteurs: 245, verifies: 180, completude: 66, achats_kg: 125000, livre_kg: 20000, a_repartir: 1, target_mt: 300 }],
      par_cluster: [{ zone: 'GBEKE_1', cluster: 'BROBO', producteurs: 2000, direct_rt: 1200, cooperative: 800 }] },
    aflp_coop_match_producers: [{ idx: 0, producer_id: 'p-qa-1', farmer_id: 'QABR-0001', nom: 'QA PRODUCTEUR 1', prenoms: 'TEST', village_nom: 'QA BROBO', telephone_masque: '******0011', reason: 'TELEPHONE_MEME_VILLAGE', confidence: 95, coop_codes: 'COOP-001' }]
  };
  function builder(table) {
    var f = [], rng = null, lim = null, head = false, countMode = null;
    var b = {
      select: function (c, o) { if (o && o.count) countMode = o.count; if (o && o.head) head = true; return b; }, insert: function () { return b; }, update: function () { return b; }, upsert: function () { return b; }, delete: function () { return b; },
      eq: function (k, v) { f.push(function (r) { return r[k] === v; }); return b; }, neq: function (k, v) { f.push(function (r) { return r[k] !== v; }); return b; },
      contains: function (k, v) { f.push(function (r) { return v.every(function (x) { return (r[k] || []).indexOf(x) >= 0; }); }); return b; },
      in: function (k, v) { f.push(function (r) { return v.indexOf(r[k]) >= 0; }); return b; }, not: function () { return b; }, or: function () { return b; }, ilike: function () { return b; },
      gte: function () { return b; }, lte: function () { return b; }, gt: function () { return b; }, lt: function () { return b; }, order: function () { return b; },
      limit: function (n) { lim = n; return b; }, range: function (a, z) { rng = [a, z]; return b; },
      single: function () { return run().then(function (r) { return { data: r.data[0] || null, error: null }; }); }, maybeSingle: function () { return b.single(); },
      then: function (res, rej) { return run().then(res, rej); }
    };
    function run() {
      var rows = (D[table] || []).filter(function (r) { return f.every(function (fn) { return fn(r); }); }), total = rows.length;
      if (head) return Promise.resolve({ data: null, error: null, count: total });
      if (rng) rows = rows.slice(rng[0], rng[1] + 1); if (lim != null) rows = rows.slice(0, lim);
      return Promise.resolve({ data: rows, error: null, count: countMode ? total : null });
    }
    return b;
  }
  window.supabase = { createClient: function () {
    return {
      auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'u-qa', email: 'qa@example.org' }, access_token: 'qa' } }, error: null }); },
        getUser: function () { return Promise.resolve({ data: { user: { id: 'u-qa' } }, error: null }); }, onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signInWithPassword: function () { return Promise.resolve({ data: null, error: null }); }, signOut: function () { return Promise.resolve({ error: null }); } },
      from: builder,
      rpc: function (name, args) { var v = RPC.hasOwnProperty(name) ? RPC[name] : []; if (typeof v === 'function') v = v(args || {}); return Promise.resolve({ data: JSON.parse(JSON.stringify(v)), error: null }); },
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [], error: null }); }, upload: function () { return Promise.resolve({ data: {}, error: null }); }, createSignedUrl: function () { return Promise.resolve({ data: { signedUrl: 'about:blank' }, error: null }); } }; } },
      channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; }, removeChannel: function () {}
    };
  } };
})();
