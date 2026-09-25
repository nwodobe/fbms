/* ANAGROCI Operations — Rapports d'activité (Warehouse / Procurement).
   Lecture seule : les données viennent des vues reports_v_* (security_invoker,
   RLS et périmètre Warehouse appliqués côté base). L'export Excel reprend
   l'ordre des onglets et les en-têtes du modèle « ANAGROCI DATA PROCUREMENT ».
   Une colonne absente de la base reste vide : aucune valeur n'est inventée. */
(function (g) {
  'use strict';

  var PAGE = 1000;          // taille de page PostgREST
  var MAX_ROWS = 60000;     // garde-fou par onglet (au-delà : message, pas de troncature silencieuse)
  var EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  var sb = null, root = null, state = { warehouses: [], suppliers: [], campaigns: [], result: null, tab: 'truck', busy: false };

  /* ---------- définitions des onglets (ordre = ordre du classeur) ---------- */
  // Types : '#' numéro de ligne, 's' texte, 'i' entier, 'n' décimal, 'k' poids kg, 'm' tonnes,
  //         'p' pourcentage, 'd' date, 't' date et heure, 'j' date jj-mm-aaaa
  var SHEETS = [
    { key: 'suppliers', name: 'Suppliers', view: 'reports_v_suppliers', order: ['supplier_code'],
      f: { supplier: ['supplier_code', 'supplier_name'], channel: 'channel' },
      cols: [['No', '', '#'], ['supplier name', 'supplier_name', 's'], ['supplier code', 'supplier_code', 's']] },
    { key: 'plan', name: 'Delivery Plan', view: 'reports_v_delivery_plan', order: ['report_date', 'delivery_plan_id'],
      f: { date: 'report_date', warehouse: 'warehouse_code', supplier: ['supplier_code', 'supplier'], truck: 'truck_norm', reception: 'reception_id', status: 'status_group', channel: 'channel', campaign: 'campaign' },
      cols: [['delivery plan id', 'delivery_plan_id', 's'], ['planned delivery date', 'planned_delivery_date', 'd'], ['supplier', 'supplier', 's'], ['supplier code', 'supplier_code', 's'],
        ['expected quantity kg', 'expected_quantity_kg', 'k'], ['expected truck type', 'expected_truck_type', 's'], ['expected arrival date', 'expected_arrival_date', 't'],
        ['destination warehouse', 'destination_warehouse', 's'], ['actual arrival date', 'actual_arrival_date', 't'], ['delivery status', 'delivery_status', 's'], ['truck no', 'truck_no', 's'], ['remarks', 'remarks', 's']] },
    { key: 'truck', name: 'Truck Reception', view: 'reports_v_truck_reception', order: ['arrival_date', 'reception_id'],
      f: { date: 'report_date', warehouse: 'warehouse_code', supplier: ['supplier_code', 'supplier_name'], truck: 'truck_norm', lot: 'lot_no', reception: 'reception_id', grn: 'grn_no', ccak: 'ccak_code', status: 'status_group', channel: 'channel', campaign: 'campaign' },
      cols: [['No', '', '#'], ['arrival date', 'arrival_date', 't'], ['offloading date', 'offloading_date', 't'], ['payment type', 'payment_type', 's'], ['warehouse location', 'warehouse_location', 's'],
        ['warehouse code', 'warehouse_code', 's'], ['supplier name', 'supplier_name', 's'], ['supplier code', 'supplier_code', 's'], ['truck no', 'truck_no', 's'], ['fiche code', 'fiche_code', 's'],
        ['fiche offloading no', 'fiche_offloading_no', 's'], ['bags count', 'bags_count', 'i'], ['gross weight kg', 'gross_weight_kg', 'k'], ['net weight kg', 'net_weight_kg', 'k'],
        ['good bags', 'good_bags', 'i'], ['humid bags', 'humid_bags', 'i'], ['torn bags', 'torn_bags', 'i'], ['refraction kg', 'refraction_kg', 'k'], ['paid weight kg', 'paid_weight_kg', 'k'],
        ['price cfa per kg', 'price_cfa_per_kg', 'n'], ['amount cfa', 'amount_cfa', 'n'], ['moisture pct', 'moisture_pct', 'p'], ['nut count', 'nut_count', 'i'], ['kor', 'kor', 'n'],
        ['final kor', 'final_kor', 'n'], ['origin', 'origin', 's'], ['remarks', 'remarks', 's'], ['week', 'week', 's']] },
    { key: 'receiving', name: 'Warehouse Receiving', view: 'reports_v_warehouse_receiving', order: ['report_date', 'reception_id'],
      f: { date: 'report_date', warehouse: 'warehouse_code', supplier: ['supplier_code', 'supplier_name'], truck: 'truck_norm', lot: 'lot_no', reception: 'reception_id', grn: 'grn_no', ccak: 'ccak_code', status: 'status_group', channel: 'channel', campaign: 'campaign' },
      cols: [['No', '', '#'], ['warehouse site', 'warehouse_site', 's'], ['warehouse', 'warehouse', 's'], ['initial bin no', 'initial_bin_no', 's'], ['after drying bin no', 'after_drying_bin_no', 's'],
        ['lot no', 'lot_no', 's'], ['lot dry', 'lot_dry', 's'], ['delivery note no', 'delivery_note_no', 's'], ['scale location', 'scale_location', 's'], ['warehouse receipt no', 'warehouse_receipt_no', 's'],
        ['fiche date', 'fiche_date', 'd'], ['activity', 'activity', 's'], ['ccak validated', 'ccak_validated', 's'], ['storage area', 'storage_area', 's'], ['fiche cca no', 'fiche_cca_no', 's'],
        ['truck no', 'truck_no', 's'], ['arrival date', 'arrival_date', 't'], ['discharge date', 'discharge_date', 't'], ['origin', 'origin', 's'], ['supplier name', 'supplier_name', 's'],
        ['cca no', 'cca_no', 's'], ['supplier code', 'supplier_code', 's'], ['good bags offloaded', 'good_bags_offloaded', 'i'], ['damaged bags offloaded', 'damaged_bags_offloaded', 'i'],
        ['total bags discharged', 'total_bags_discharged', 'i'], ['recondition bags', 'recondition_bags', 'i'], ['total bags stock', 'total_bags_stock', 'i'], ['new bags used recondition', 'new_bags_used_recondition', 'i'],
        ['good bags', 'good_bags', 'i'], ['humid bags', 'humid_bags', 'i'], ['torn bags', 'torn_bags', 'i'], ['recondition flag', 'recondition_flag', 's'], ['reconditioned bags', 'reconditioned_bags', 'i'],
        ['total bags lot', 'total_bags_lot', 'i'], ['export bags', 'export_bags', 'i'], ['bio bags', 'bio_bags', 'i'], ['brousse bags', 'brousse_bags', 'i'], ['total received bags', 'total_received_bags', 'i'],
        ['gross weight kg', 'gross_weight_kg', 'k'], ['total refraction kg', 'total_refraction_kg', 'k'], ['grn qty kg', 'grn_qty_kg', 'k'], ['paid weight kg', 'paid_weight_kg', 'k'],
        ['net weight kg', 'net_weight_kg', 'k'], ['weight difference kg', 'weight_difference_kg', 'k'], ['net weight book kg', 'net_weight_book_kg', 'k'], ['grn fresh qty kg', 'grn_fresh_qty_kg', 'k'],
        ['grn dried qty kg', 'grn_dried_qty_kg', 'k'],
        ['q1 rejection g', 'q1_rejection_g', 'n'], ['q1 void g', 'q1_void_g', 'n'], ['q1 oil g', 'q1_oil_g', 'n'], ['q1 total defect g', 'q1_total_defect_g', 'n'], ['q1 good kernel g', 'q1_good_kernel_g', 'n'],
        ['q1 immature g', 'q1_immature_g', 'n'], ['q1 spotted g', 'q1_spotted_g', 'n'], ['q1 total kernels g', 'q1_total_kernels_g', 'n'], ['q1 kor', 'q1_kor', 'n'], ['q1 murli', 'q1_murli', 'n'],
        ['q1 shot', 'q1_shot', 'n'], ['q1 fot', 'q1_fot', 'n'], ['q1 useful kernel yield pct', 'q1_useful_kernel_yield_pct', 'p'], ['q1 total yield pct', 'q1_total_yield_pct', 'p'],
        ['q1 moisture pct', 'q1_moisture_pct', 'p'], ['q1 nut count', 'q1_nut_count', 'i'], ['q1 shell g', 'q1_shell_g', 'n'],
        ['q2 rejection g', 'q2_rejection_g', 'n'], ['q2 murli total pct', 'q2_murli_total_pct', 'p'], ['q2 void g', 'q2_void_g', 'n'], ['q2 oil g', 'q2_oil_g', 'n'], ['q2 total defect g', 'q2_total_defect_g', 'n'],
        ['q2 good kernel g', 'q2_good_kernel_g', 'n'], ['q2 immature g', 'q2_immature_g', 'n'], ['q2 spotted g', 'q2_spotted_g', 'n'], ['q2 total kernels g', 'q2_total_kernels_g', 'n'], ['q2 kor', 'q2_kor', 'n'],
        ['q2 murli', 'q2_murli', 'n'], ['q2 after dry kor', 'q2_after_dry_kor', 'n'], ['q2 shot', 'q2_shot', 'n'], ['q2 fot', 'q2_fot', 'n'], ['q2 useful kernel yield pct', 'q2_useful_kernel_yield_pct', 'p'],
        ['q2 total yield pct', 'q2_total_yield_pct', 'p'], ['q2 moisture pct', 'q2_moisture_pct', 'p'], ['q2 nut count', 'q2_nut_count', 'i'], ['q2 shell g', 'q2_shell_g', 'n']] },
    { key: 'quality', name: 'Quality Inspection', view: 'reports_v_quality_inspection', order: ['inspection_date', 'quality_inspection_id'],
      f: { date: 'report_date', warehouse: 'warehouse_code', supplier: ['supplier_code', 'supplier_name'], truck: 'truck_norm', lot: 'lot_no', reception: 'reception_id', ccak: 'ccak_code', status: 'status_group', channel: 'channel', campaign: 'campaign' },
      cols: [['quality inspection id', 'quality_inspection_id', 's'], ['reception id', 'reception_id', 's'], ['inspection stage', 'inspection_stage', 's'], ['warehouse', 'warehouse', 's'],
        ['activity type', 'activity_type', 's'], ['inspection date', 'inspection_date', 't'], ['supplier name', 'supplier_name', 's'], ['ccak code', 'ccak_code', 's'], ['anagroci code', 'anagroci_code', 's'],
        ['truck no', 'truck_no', 's'], ['lot no', 'lot_no', 's'], ['origin', 'origin', 's'], ['moisture pct', 'moisture_pct', 'p'], ['nut count', 'nut_count', 'i'], ['good kernel g', 'good_kernel_g', 'n'],
        ['spotted g', 'spotted_g', 'n'], ['immature g', 'immature_g', 'n'], ['void g', 'void_g', 'n'], ['oil g', 'oil_g', 'n'], ['browns rejection g', 'browns_rejection_g', 'n'], ['kor', 'kor', 'n'],
        ['decision', 'decision', 's'], ['quality head', 'quality_head', 's'], ['remarks', 'remarks', 's']] },
    { key: 'drying', name: 'Drying Batch', view: 'reports_v_drying_batch', order: ['drying_date', 'drying_id'],
      f: { date: 'report_date', warehouse: 'warehouse_code', supplier: ['supplier_code_raw', 'supplier_name_raw'], lotLike: 'lot_no', activity: 'drying_or_picking', campaign: 'campaign' },
      cols: [['No', '', '#'], ['drying date', 'drying_date', 't'], ['warehouse site', 'warehouse_site', 's'], ['warehouse', 'warehouse', 's'], ['source bin no', 'source_bin_no', 's'],
        ['destination bin no', 'destination_bin_no', 's'], ['lot no raw', 'lot_no_raw', 's'], ['warehouse receipt no raw', 'warehouse_receipt_no_raw', 's'], ['fiche no raw', 'fiche_no_raw', 's'],
        ['origin raw', 'origin_raw', 's'], ['supplier name raw', 'supplier_name_raw', 's'], ['supplier code raw', 'supplier_code_raw', 's'], ['ccak supplier code raw', 'ccak_supplier_code_raw', 's'],
        ['status', 'status', 's'], ['dry type', 'dry_type', 's'], ['destination raw', 'destination_raw', 's'], ['issued gross with bags pallets kg', 'issued_gross_with_bags_pallets_kg', 'k'],
        ['issued pallet weight kg', 'issued_pallet_weight_kg', 'k'], ['issued gross with bags kg', 'issued_gross_with_bags_kg', 'k'], ['issued bags', 'issued_bags', 'i'],
        ['issued net weight kg', 'issued_net_weight_kg', 'k'], ['received gross with bags pallets kg', 'received_gross_with_bags_pallets_kg', 'k'], ['received pallet weight kg', 'received_pallet_weight_kg', 'k'],
        ['received gross with bags kg', 'received_gross_with_bags_kg', 'k'], ['received bags', 'received_bags', 'i'], ['received net weight kg', 'received_net_weight_kg', 'k'],
        ['input moisture pct', 'input_moisture_pct', 'p'], ['input nut count', 'input_nut_count', 'i'], ['input kor', 'input_kor', 'n'], ['output moisture pct', 'output_moisture_pct', 'p'],
        ['output nut count', 'output_nut_count', 'i'], ['output kor', 'output_kor', 'n'], ['oil', 'oil', 'n'], ['rejection', 'rejection', 'n'], ['good kernel', 'good_kernel', 'n'], ['immature', 'immature', 'n'],
        ['spotted', 'spotted', 'n'], ['shell', 'shell', 'n'], ['void', 'void', 'n'], ['moisture loss pct', 'moisture_loss_pct', 'p'], ['drying loss kg', 'drying_loss_kg', 'k'], ['drying loss pct', 'drying_loss_pct', 'p'],
        ['triage loss kg', 'triage_loss_kg', 'k'], ['triage loss pct', 'triage_loss_pct', 'p'], ['damaged nuts kg', 'damaged_nuts_kg', 'k'], ['input bags for drying', 'input_bags_for_drying', 'i'],
        ['output bags after drying', 'output_bags_after_drying', 'i'], ['drying or picking', 'drying_or_picking', 's'], ['remarks', 'remarks', 's'], ['issued to production', 'issued_to_production', 'k'],
        ['re drying date', 're_drying_date', 't'], ['moisture first redry pct', 'moisture_first_redry_pct', 'p'], ['moisture second dry pct', 'moisture_second_dry_pct', 'p'],
        ['issued to production 3', 'issued_to_production_3', 'k'], ['remarks 4', 'remarks_4', 's'], ['needs lot allocation clarification', 'needs_lot_allocation_clarification', 's']] },
    { key: 'ledger', name: 'Warehouse Activity Ledger', view: 'reports_v_warehouse_activity_ledger', order: ['activity_date', 'reference_no'],
      f: { date: 'report_date', warehouse: 'warehouse_code', supplier: ['supplier_code', 'vendor'], truck: 'truck_norm', lot: 'lot_no', reception: 'reception_id', activity: 'activity_type', channel: 'channel', campaign: 'campaign' },
      cols: [['activity date', 'activity_date', 't'], ['activity type', 'activity_type', 's'], ['particulars', 'particulars', 's'], ['offloaded', 'offloaded', 's'], ['bags', 'bags', 'i'],
        ['quantity mt', 'quantity_mt', 'm'], ['fiche no', 'fiche_no', 's'], ['lot no', 'lot_no', 's'], ['vendor', 'vendor', 's'], ['rate', 'rate', 'n'], ['total', 'total', 'n'], ['reference no', 'reference_no', 's'],
        ['remarks', 'remarks', 's'], ['gross weight with pallet kg', 'gross_weight_with_pallet_kg', 'k'], ['pallet count', 'pallet_count', 'i'], ['gross weight kg', 'gross_weight_kg', 'k'],
        ['gross weight without pallet kg', 'gross_weight_without_pallet_kg', 'k'], ['net weight kg', 'net_weight_kg', 'k']] },
    { key: 'jute', name: 'Jute Bags Movement', view: 'reports_v_jute_bags_movement', order: ['movement_date', 'movement_id', 'side'],
      f: { date: 'report_date', warehouse: 'warehouse_code', supplier: ['supplier_code'], truck: 'truck_norm', lot: 'lot_no', reception: 'reception_id', channel: 'channel', campaign: 'campaign' },
      cols: [['No', '', '#'], ['movement date', 'movement_date', 'j'], ['activity type', 'activity_type', 's'], ['supplier code', 'supplier_code', 's'], ['warehouse location', 'warehouse_code', 's'],
        ['truck no', 'truck_no', 's'], ['warehouse receipt no', 'warehouse_receipt_no', 's'], ['bags issued', 'bags_issued', 'i'], ['bags received', 'bags_received', 'i']] }
  ];
  var BALANCE_COLS = [['warehouse location', 'location_code', 's'], ['warehouse code', 'warehouse_code', 's'], ['opening', 'opening', 'i'], ['receipts', 'receipts', 'i'], ['transfers in', 'transfers_in', 'i'],
    ['issues', 'issues', 'i'], ['damaged/discarded', 'damaged_discarded', 'i'], ['transfers out', 'transfers_out', 'i'], ['closing', 'closing', 'i'], ['closing actual (ledger)', 'closing_actual', 'i'], ['variance', 'variance', 'i']];
  var ACTIVITIES = ['Offloading', 'Staking', 'Destaking', 'Drying', 'Triage', 'Rebagging', 'Reconditioning', 'Transfer Out', 'Transfer In', 'Production Issue', 'Return from Production', 'Return to Supplier', 'Adjustment', 'Closing Balance'];
  var STATUSES = [['', 'Tous'], ['ACCEPTE', 'Accepté'], ['REJETE', 'Rejeté'], ['EN_ATTENTE', 'En attente (pending)'], ['HOLD', 'HOLD'], ['LIBERE', 'Libéré (released)']];
  var CHANNELS = [['', 'Tous'], ['FIELD_BUYING', 'Field Buying'], ['LBA', 'LBA'], ['DIRECT', 'Direct'], ['COOPERATIVE', 'Coopérative']];
  var FILTER_LABELS = { date: 'période', warehouse: 'warehouse', supplier: 'fournisseur', truck: 'camion', lot: 'LOT', reception: 'réception', grn: 'GRN', ccak: 'CCAK', status: 'statut', channel: 'canal', campaign: 'campagne', activity: "type d'activité" };
  var KPIS = [['trucks_planned', 'Camions prévus', 'i'], ['trucks_arrived', 'Camions arrivés', 'i'], ['trucks_accepted', 'Camions acceptés', 'i'], ['trucks_rejected', 'Camions rejetés', 'i'],
    ['trucks_pending', 'Camions en attente', 'i'], ['net_kg', 'Poids net (kg)', 'k'], ['paid_weight_kg', 'Poids payé (kg)', 'k'], ['refraction_kg', 'Réfaction (kg)', 'k'], ['bags_received', 'Sacs reçus', 'i'],
    ['good_bags', 'Sacs bons', 'i'], ['humid_bags', 'Sacs humides', 'i'], ['torn_bags', 'Sacs déchirés', 'i'], ['reconditioned_bags', 'Sacs reconditionnés', 'i'], ['rcn_closing_kg', 'Stock RCN clôture (kg)', 'k'],
    ['jute_closing_bags', 'Stock sacs clôture', 'i'], ['lots_hold', 'LOT en HOLD', 'i'], ['lots_released', 'LOT libérés', 'i'], ['lots_not_binned', 'LOT non affectés en BIN', 'i'],
    ['receptions_without_grn', 'Réceptions sans GRN', 'i'], ['documents_missing', 'Documents manquants', 'i']];

  /* ---------- utilitaires ---------- */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return isoDay(new Date()); }
  function normTruck(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function clean(v) { return String(v || '').replace(/[,()*%"\\]/g, ' ').trim(); }
  function fmtNum(v, dec) { var x = Number(v); return (v === null || v === undefined || v === '' || !isFinite(x)) ? '' : x.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: dec == null ? 2 : dec }); }
  function toDate(v, dateOnly) {
    if (v === null || v === undefined || v === '') return null;
    if (dateOnly || /^\d{4}-\d{2}-\d{2}$/.test(String(v))) { var p = String(v).slice(0, 10).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
    var d = new Date(v); return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(v, type) {
    var d = toDate(v, type === 'd' || type === 'j'); if (!d) return '';
    var s = pad(d.getUTCDate()) + (type === 'j' ? '-' : '/') + pad(d.getUTCMonth() + 1) + (type === 'j' ? '-' : '/') + d.getUTCFullYear();
    return type === 't' ? s + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) : s;
  }
  function isNumType(t) { return 'iknmp#'.indexOf(t) >= 0; }
  function display(row, col, i) {
    var t = col[2]; if (t === '#') return String(i + 1);
    var v = row[col[1]];
    if (t === 'd' || t === 't' || t === 'j') return fmtDate(v, t);
    if (t === 'i') return fmtNum(v, 0);
    if (t === 'm') return fmtNum(v, 3);
    if (isNumType(t)) return fmtNum(v, t === 'k' ? 3 : 2);
    return v == null ? '' : String(v);
  }
  function numOrNull(v) { if (v === null || v === undefined || v === '') return null; var x = Number(v); return isFinite(x) ? x : null; }
  function status(msg, cls) { var el = document.getElementById('rapStatus'); if (el) { el.textContent = msg || ''; el.className = 'rap-status' + (cls ? ' ' + cls : ''); } }
  function waitClient() {
    return new Promise(function (resolve) {
      var k = 0, t = setInterval(function () {
        k += 1;
        if (g.supabase && g.ANAGROCI_SUPABASE_URL && g.ANAGROCI_SUPABASE_ANON) { clearInterval(t); resolve(g.supabase.createClient(g.ANAGROCI_SUPABASE_URL, g.ANAGROCI_SUPABASE_ANON)); }
        else if (k > 120) { clearInterval(t); resolve(null); }
      }, 80);
    });
  }
  function errText(e) { return (e && (e.message || e.details || e.hint)) ? (e.message || e.details || e.hint) : String(e); }

  /* ---------- filtres ---------- */
  function readFilters() {
    var f = {}, form = document.getElementById('rapForm'); if (!form) return f;
    new FormData(form).forEach(function (v, k) { f[k] = String(v).trim(); });
    if (!f.start) f.start = today();
    if (!f.end) f.end = f.start;
    return f;
  }
  function filterErrors(f) {
    if (f.end < f.start) return 'La date de fin précède la date de début.';
    var days = (toDate(f.end, true) - toDate(f.start, true)) / 86400000;
    if (days > 1100) return 'Période trop longue : 3 ans maximum.';
    return '';
  }
  function applyFilters(q, sheet, f, notApplied) {
    var m = sheet.f;
    function na(k) { if (notApplied.indexOf(FILTER_LABELS[k]) < 0) notApplied.push(FILTER_LABELS[k]); }
    if (m.date) q = q.gte(m.date, f.start).lte(m.date, f.end); else if (sheet.key !== 'suppliers') na('date');
    if (f.warehouse) { if (m.warehouse) q = q.eq(m.warehouse, f.warehouse); else na('warehouse'); }
    if (f.supplier) { var s = clean(f.supplier); if (m.supplier && s) q = q.or(m.supplier.map(function (c) { return c + '.ilike."*' + s + '*"'; }).join(',')); else na('supplier'); }
    if (f.truck) { if (m.truck) q = q.ilike(m.truck, '%' + normTruck(f.truck) + '%'); else na('truck'); }
    if (f.lot) { if (m.lot) q = q.eq(m.lot, f.lot); else if (m.lotLike) q = q.ilike(m.lotLike, '%' + clean(f.lot) + '%'); else na('lot'); }
    if (f.reception) { if (m.reception) q = q.eq(m.reception, f.reception); else na('reception'); }
    if (f.grn) { if (m.grn) q = q.eq(m.grn, f.grn); else na('grn'); }
    if (f.ccak) { if (m.ccak) q = q.ilike(m.ccak, '%' + clean(f.ccak) + '%'); else na('ccak'); }
    if (f.status) { if (m.status) q = q.eq(m.status, f.status); else na('status'); }
    if (f.channel) { if (m.channel) q = q.eq(m.channel, f.channel); else na('channel'); }
    if (f.campaign) { if (m.campaign) q = q.eq(m.campaign, f.campaign); else na('campaign'); }
    if (f.activity) {
      if (m.activity) { var a = f.activity; if (sheet.key === 'drying') a = a === 'Drying' ? 'Drying' : (a === 'Triage' ? 'Picking' : '__aucun__'); q = q.eq(m.activity, a); }
      else na('activity');
    }
    return q;
  }
  async function fetchSheet(sheet, f, progress) {
    var notApplied = [], rows = [], from = 0, total = null;
    while (true) {
      var q = sb.from(sheet.view).select('*', from === 0 ? { count: 'exact' } : undefined);
      q = applyFilters(q, sheet, f, notApplied);
      sheet.order.forEach(function (c) { q = q.order(c, { ascending: true, nullsFirst: false }); });
      var r = await q.range(from, from + PAGE - 1);
      if (r.error) throw new Error(sheet.name + ' : ' + errText(r.error));
      if (from === 0 && typeof r.count === 'number') total = r.count;
      rows = rows.concat(r.data || []);
      if (progress) progress(sheet, rows.length, total);
      if (!r.data || r.data.length < PAGE) break;
      from += PAGE;
      if (rows.length >= MAX_ROWS) throw new Error(sheet.name + ' : plus de ' + MAX_ROWS.toLocaleString('fr-FR') + ' lignes. Réduisez la période ou ajoutez un filtre (warehouse, fournisseur).');
    }
    return { rows: rows, total: total == null ? rows.length : total, notApplied: notApplied };
  }
  function kpiParams(f) {
    return { start: f.start, end: f.end, warehouse_code: f.warehouse || null, supplier: f.supplier || null, truck: f.truck || null, lot_no: f.lot || null, reception_id: f.reception || null,
      grn_no: f.grn || null, ccak_code: f.ccak || null, status_group: f.status || null, channel: f.channel || null, campaign: f.campaign || null };
  }
  function closingRows(summary, f) {
    if (f.activity && f.activity !== 'Closing Balance') return [];
    if (f.supplier || f.truck || f.lot || f.reception) return [];
    return (summary.rcn_closing_by_warehouse || []).map(function (x) {
      var kg = Number(x.rcn_closing_kg || 0);
      return { activity_date: f.end, activity_type: 'Closing Balance', particulars: 'Stock RCN physique (staging, BIN, séchage) à la date de fin', offloaded: x.warehouse_code,
        bags: null, quantity_mt: Math.round(kg) / 1000, fiche_no: null, lot_no: null, vendor: null, rate: null, total: null, reference_no: 'CLOSING-' + x.warehouse_code + '-' + f.end.replace(/-/g, ''),
        remarks: 'Calculé à partir du grand livre (mouvements postés)', net_weight_kg: kg, warehouse_code: x.warehouse_code };
    });
  }
  async function loadAll(f) {
    var res = { filters: f, sheets: {}, generatedAt: new Date() };
    status('Calcul des indicateurs…');
    var k = await sb.rpc('reports_activity_summary', { p: kpiParams(f) });
    if (k.error) throw new Error('Indicateurs : ' + errText(k.error));
    res.summary = k.data || {};
    for (var i = 0; i < SHEETS.length; i++) {
      var s = SHEETS[i];
      if (s.key === 'ledger' && f.activity === 'Closing Balance') { res.sheets[s.key] = { rows: [], total: 0, notApplied: [] }; }
      else {
        res.sheets[s.key] = await fetchSheet(s, f, function (sh, n, tot) { status('Chargement ' + sh.name + ' : ' + n.toLocaleString('fr-FR') + (tot != null ? ' / ' + tot.toLocaleString('fr-FR') : '') + ' lignes…'); });
      }
      if (s.key === 'ledger') { var cr = closingRows(res.summary, f); res.sheets.ledger.rows = res.sheets.ledger.rows.concat(cr); res.sheets.ledger.total += cr.length; }
    }
    res.balance = res.summary.jute_balance || [];
    var daily = sb.from('reports_v_activity_summary').select('*').gte('report_date', f.start).lte('report_date', f.end).order('report_date').order('warehouse_code');
    if (f.warehouse) daily = daily.eq('warehouse_code', f.warehouse);
    var d = await daily.range(0, 4999);
    res.daily = d.error ? [] : (d.data || []);
    return res;
  }

  /* ---------- rendu ---------- */
  function opt(list, value) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value || '') ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function field(label, name, type, value, extra) { return '<div class="ops-field"><label for="rap_' + name + '">' + esc(label) + '</label><input id="rap_' + name + '" name="' + name + '" type="' + type + '" value="' + esc(value || '') + '" ' + (extra || '') + '></div>'; }
  function select(label, name, list, value) { return '<div class="ops-field"><label for="rap_' + name + '">' + esc(label) + '</label><select id="rap_' + name + '" name="' + name + '">' + opt(list, value) + '</select></div>'; }
  function renderShell() {
    var f = { start: today(), end: today() };
    var whs = [['', 'Tous les warehouses de mon périmètre']].concat(state.warehouses.map(function (w) { return [w.code, w.code + ' · ' + (w.name || '')]; }));
    var camps = [['', 'Toutes']].concat(state.campaigns.map(function (c) { return [c, c]; }));
    var acts = [['', 'Toutes']].concat(ACTIVITIES.map(function (a) { return [a, a]; }));
    root.innerHTML =
      '<div class="ops-pagehead"><div><h1>Rapports d’activité</h1><p>Filtrer une journée ou une période, contrôler les indicateurs, prévisualiser puis exporter le classeur Excel au format du modèle ANAGROCI (8 onglets).</p></div></div>' +
      '<form class="card rap-filters" id="rapForm" autocomplete="off"><div class="card-head"><div><h2>Filtres</h2><p>Les filtres sans objet pour un onglet sont ignorés pour cet onglet (signalé dans l’aperçu).</p></div></div>' +
      '<div class="rap-quick"><button type="button" class="btn secondary" data-quick="today">Aujourd’hui</button><button type="button" class="btn secondary" data-quick="yesterday">Hier</button><button type="button" class="btn secondary" data-quick="7d">7 derniers jours</button><button type="button" class="btn secondary" data-quick="month">Mois en cours</button></div>' +
      '<div class="ops-form-grid">' +
      field('Date de début', 'start', 'date', f.start, 'required') + field('Date de fin', 'end', 'date', f.end, 'required') +
      select('Campagne', 'campaign', camps, '') + select('Warehouse (code)', 'warehouse', whs, '') +
      field('Fournisseur ou code fournisseur', 'supplier', 'text', '', 'list="rapSuppliers" placeholder="ex. DIS-008-FOU"') +
      field('N° camion', 'truck', 'text', '', 'placeholder="espaces ignorés"') + field('N° LOT', 'lot', 'text', '') + field('ID réception', 'reception', 'text', '') +
      field('N° GRN', 'grn', 'text', '') + field('Code CCAK', 'ccak', 'text', '') + select("Type d'activité", 'activity', acts, '') +
      select('Statut', 'status', STATUSES, '') + select('Canal', 'channel', CHANNELS, '') +
      '</div><datalist id="rapSuppliers">' + state.suppliers.map(function (s) { return '<option value="' + esc(s.supplier_code) + '">' + esc(s.supplier_name) + '</option>'; }).join('') + '</datalist>' +
      '<div class="rap-actions"><button type="submit" class="btn primary" id="rapPreview">Prévisualiser</button>' +
      '<button type="button" class="btn primary" data-act="xlsx">Exporter Excel</button><button type="button" class="btn secondary" data-act="csv">Exporter CSV (onglet affiché)</button>' +
      '<button type="button" class="btn secondary" data-act="pdf">Exporter résumé PDF</button><button type="button" class="btn secondary" data-act="reset">Réinitialiser</button></div>' +
      '<p class="rap-status" id="rapStatus" role="status" aria-live="polite"></p></form>' +
      '<section class="card"><div class="card-head"><div><h2>Indicateurs</h2><p id="rapKpiPeriod">Lancez « Prévisualiser » pour calculer les indicateurs.</p></div></div><div class="kpi-grid rap-kpis" id="rapKpis"></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Aperçu par onglet</h2><p>Aperçu limité aux 50 premières lignes ; l’export contient toutes les lignes.</p></div></div><div class="rap-tabs" role="tablist" id="rapTabs"></div><div id="rapPreviewBox"><div class="ops-empty">Aucun aperçu pour le moment.</div></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Exports</h2></div></div><ul class="rap-note" style="margin:0;padding-left:18px">' +
      '<li><b>Excel</b> : 8 onglets dans l’ordre du modèle (Suppliers, Delivery Plan, Truck Reception, Warehouse Receiving, Quality Inspection, Drying Batch, Warehouse Activity Ledger, Jute Bags Movement), puis « Jute Bags Balance » (formule Opening + Receipts + Transfers In − Issues − Damaged/Discarded − Transfers Out = Closing) et « Summary ».</li>' +
      '<li><b>CSV</b> : onglet affiché, séparateur point-virgule, virgule décimale (Excel français).</li>' +
      '<li><b>Résumé PDF</b> : ouvre l’impression ; choisir « Enregistrer au format PDF ».</li>' +
      '<li>Colonnes du modèle non encore saisies dans l’application : laissées vides (liste dans l’onglet Summary).</li></ul></section>';
  }
  function renderKpis(sum, f) {
    var box = document.getElementById('rapKpis'); if (!box) return;
    box.innerHTML = KPIS.map(function (k) { var v = sum[k[0]]; return '<div class="kpi"><small>' + esc(k[1]) + '</small><b>' + esc(fmtNum(v, k[2] === 'k' ? 0 : 0) || '0') + '</b></div>'; }).join('');
    var p = document.getElementById('rapKpiPeriod');
    if (p) p.textContent = 'Période du ' + fmtDate(f.start, 'd') + ' au ' + fmtDate(f.end, 'd') + (f.warehouse ? ' · ' + f.warehouse : ' · tous les warehouses du périmètre') + (sum.scope ? ' · périmètre ' + sum.scope : '');
  }
  function tabList() {
    var r = state.result; if (!r) return [];
    return SHEETS.map(function (s) { return { key: s.key, name: s.name, count: r.sheets[s.key].total }; })
      .concat([{ key: 'balance', name: 'Jute Bags Balance', count: r.balance.length }, { key: 'summary', name: 'Summary', count: null }]);
  }
  function renderTabs() {
    var t = document.getElementById('rapTabs'); if (!t) return;
    t.innerHTML = tabList().map(function (x) { return '<button type="button" role="tab" data-tab="' + x.key + '" aria-selected="' + (state.tab === x.key) + '">' + esc(x.name) + (x.count == null ? '' : '<span>' + esc(x.count.toLocaleString('fr-FR')) + '</span>') + '</button>'; }).join('');
  }
  function tableHtml(cols, rows) {
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>';
    var body = rows.slice(0, 50).map(function (row, i) { return '<tr>' + cols.map(function (c) { return '<td' + (isNumType(c[2]) ? ' class="num"' : '') + '>' + esc(display(row, c, i)) + '</td>'; }).join('') + '</tr>'; }).join('');
    return '<div class="rap-table-wrap"><table><thead>' + head + '</thead><tbody>' + (body || '<tr><td colspan="' + cols.length + '">Aucune ligne pour ces filtres (l’onglet sera exporté avec ses en-têtes).</td></tr>') + '</tbody></table></div>';
  }
  function summaryRows() {
    var r = state.result, f = r.filters, s = r.summary;
    var out = [['Rapport', 'ANAGROCI Activity Report'], ['Période', fmtDate(f.start, 'd') + ' au ' + fmtDate(f.end, 'd')], ['Warehouse', f.warehouse || 'Tous (périmètre du profil)'],
      ['Généré le', fmtDate(r.generatedAt.toISOString(), 't') + ' (UTC)']];
    ['campaign', 'supplier', 'truck', 'lot', 'reception', 'grn', 'ccak', 'activity', 'status', 'channel'].forEach(function (k) { if (f[k]) out.push(['Filtre ' + (FILTER_LABELS[k] || k), f[k]]); });
    KPIS.forEach(function (k) { out.push([k[1], s[k[0]] == null ? 0 : Number(s[k[0]])]); });
    return out;
  }
  function renderPreview() {
    var box = document.getElementById('rapPreviewBox'); if (!box || !state.result) return;
    var r = state.result, k = state.tab, html = '';
    if (k === 'balance') html = tableHtml(BALANCE_COLS, r.balance) + '<p class="rap-note">Closing = Opening + Receipts + Transfers In − Issues − Damaged/Discarded − Transfers Out. « Variance » = stock réel du grand livre − Closing (ajustements d’inventaire, pertes approuvées).</p>';
    else if (k === 'summary') html = '<div class="rap-table-wrap"><table><tbody>' + summaryRows().map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td>' + esc(typeof x[1] === 'number' ? fmtNum(x[1], 3) : x[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    else {
      var sh = SHEETS.filter(function (s) { return s.key === k; })[0], data = r.sheets[k];
      html = tableHtml(sh.cols, data.rows) + '<p class="rap-note">' + esc(data.total.toLocaleString('fr-FR')) + ' ligne(s) exportée(s).' + (data.notApplied.length ? ' Filtres sans objet pour cet onglet : ' + esc(data.notApplied.join(', ')) + '.' : '') + '</p>';
    }
    box.innerHTML = html;
  }

  /* ---------- exports ---------- */
  function fileBase(f) {
    var d = f.start === f.end ? f.start.replace(/-/g, '') : f.start.replace(/-/g, '') + '-' + f.end.replace(/-/g, '');
    return 'ANAGROCI_Activity_Report_' + d + '_' + (f.warehouse ? f.warehouse.replace(/[^A-Za-z0-9-]/g, '') : 'ALL');
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function loadExcelJs() {
    if (g.ExcelJS) return Promise.resolve(g.ExcelJS);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = EXCELJS_URL; s.async = true;
      s.onload = function () { g.ExcelJS ? resolve(g.ExcelJS) : reject(new Error('Moteur Excel indisponible.')); };
      s.onerror = function () { reject(new Error('Moteur Excel indisponible (connexion au CDN impossible).')); };
      document.head.appendChild(s);
    });
  }
  var NUMFMT = { i: '#,##0', k: '#,##0.000', m: '#,##0.000', n: '#,##0.00', p: '0.00', d: 'dd/mm/yyyy', t: 'dd/mm/yyyy hh:mm', j: 'dd-mm-yyyy', '#': '0' };
  function cellValue(row, col, i) {
    var t = col[2];
    if (t === '#') return i + 1;
    var v = row[col[1]];
    if (t === 'd' || t === 't' || t === 'j') return toDate(v, t !== 't');
    if (isNumType(t)) return numOrNull(v);
    return v == null ? null : String(v);
  }
  function styleSheet(ws, cols) {
    var h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF053B23' } };
    h.alignment = { vertical: 'middle', wrapText: true }; h.height = 30;
    cols.forEach(function (c, idx) { var col = ws.getColumn(idx + 1); col.width = Math.min(40, Math.max(10, c[0].length + 2)); if (NUMFMT[c[2]]) col.numFmt = NUMFMT[c[2]]; });
    ws.getRow(1).eachCell(function (cell) { cell.numFmt = '@'; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  function addDataSheet(wb, name, cols, rows) {
    var ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(cols.map(function (c) { return c[0]; }));
    rows.forEach(function (row, i) { ws.addRow(cols.map(function (c) { return cellValue(row, c, i); })); });
    styleSheet(ws, cols);
    return ws;
  }
  var UNMAPPED = {
    'Delivery Plan': ['expected truck type'],
    'Warehouse Receiving': ['scale location', 'fiche cca no', 'new bags used recondition', 'export bags', 'bio bags', 'brousse bags', 'weight difference kg', 'grn dried qty kg', 'q1/q2 total defect g', 'q1/q2 total kernels g', 'q1/q2 murli', 'q1/q2 shot', 'q1/q2 fot', 'q1/q2 useful kernel yield pct', 'q1/q2 total yield pct', 'q1/q2 shell g', 'q2 murli total pct'],
    'Drying Batch': ['fiche no raw', 'poids bruts avec sacs/palettes (émis et reçus)', 'poids palettes', 'shell', 'damaged nuts kg', 'issued to production', 'moisture first redry pct', 'moisture second dry pct', 'issued to production 3', 'remarks 4'],
    'Warehouse Activity Ledger': ['rate', 'total', 'gross weight with pallet kg', 'pallet count', 'gross weight without pallet kg']
  };
  async function exportXlsx() {
    var r = await ensureData(); if (!r) return;
    status('Préparation du classeur Excel…');
    var ExcelJS = await loadExcelJs();
    var wb = new ExcelJS.Workbook(); wb.creator = 'ANAGROCI Operations Suite'; wb.created = new Date();
    SHEETS.forEach(function (s) { addDataSheet(wb, s.name, s.cols, r.sheets[s.key].rows); });
    var wsB = addDataSheet(wb, 'Jute Bags Balance', BALANCE_COLS, r.balance);
    r.balance.forEach(function (b, i) {
      var n = i + 2;
      wsB.getCell('I' + n).value = { formula: 'C' + n + '+D' + n + '+E' + n + '-F' + n + '-G' + n + '-H' + n, result: Number(b.closing || 0) };
      wsB.getCell('K' + n).value = { formula: 'J' + n + '-I' + n, result: Number(b.variance || 0) };
    });
    var wsS = wb.addWorksheet('Summary');
    wsS.addRow(['Indicateur', 'Valeur']);
    summaryRows().forEach(function (x) { wsS.addRow(x); });
    wsS.addRow([]);
    wsS.addRow(['Synthèse quotidienne', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    var dailyCols = [['report date', 'report_date', 'd'], ['warehouse code', 'warehouse_code', 's'], ['trucks arrived', 'trucks_arrived', 'i'], ['trucks accepted', 'trucks_accepted', 'i'], ['trucks rejected', 'trucks_rejected', 'i'],
      ['trucks pending', 'trucks_pending', 'i'], ['net kg', 'net_kg', 'k'], ['paid weight kg', 'paid_weight_kg', 'k'], ['refraction kg', 'refraction_kg', 'k'], ['bags received', 'bags_received', 'i'],
      ['good bags', 'good_bags', 'i'], ['humid bags', 'humid_bags', 'i'], ['torn bags', 'torn_bags', 'i'], ['reconditioned bags', 'reconditioned_bags', 'i']];
    wsS.addRow(dailyCols.map(function (c) { return c[0]; })).font = { bold: true };
    r.daily.forEach(function (row, i) { var xr = wsS.addRow(dailyCols.map(function (c) { return cellValue(row, c, i); })); dailyCols.forEach(function (c, j) { if (NUMFMT[c[2]]) xr.getCell(j + 1).numFmt = NUMFMT[c[2]]; }); });
    wsS.addRow([]);
    wsS.addRow(['Colonnes du modèle non encore saisies dans l’application (laissées vides)']).font = { bold: true };
    Object.keys(UNMAPPED).forEach(function (k) { wsS.addRow([k, UNMAPPED[k].join(', ')]); });
    wsS.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; wsS.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF053B23' } };
    wsS.getColumn(1).width = 34; wsS.getColumn(2).width = 40;
    var buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileBase(r.filters) + '.xlsx');
    status('Classeur Excel généré : ' + (SHEETS.length + 2) + ' onglets, ' + SHEETS.reduce(function (t, s) { return t + r.sheets[s.key].total; }, 0).toLocaleString('fr-FR') + ' lignes.', 'ok');
  }
  function csvCell(v, t) {
    if (v === null || v === undefined || v === '') return '';
    var s;
    if (t === 'd' || t === 't' || t === 'j') s = fmtDate(v, t);
    else if (isNumType(t) && t !== '#') { var x = Number(v); s = isFinite(x) ? String(x).replace('.', ',') : String(v); }
    else s = String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  async function exportCsv() {
    var r = await ensureData(); if (!r) return;
    var k = state.tab, cols, rows, name;
    if (k === 'summary') { cols = [['Indicateur', 0, 's'], ['Valeur', 1, 's']]; rows = summaryRows(); name = 'Summary'; }
    else if (k === 'balance') { cols = BALANCE_COLS; rows = r.balance; name = 'Jute Bags Balance'; }
    else { var sh = SHEETS.filter(function (s) { return s.key === k; })[0]; cols = sh.cols; rows = r.sheets[k].rows; name = sh.name; }
    var lines = [cols.map(function (c) { return csvCell(c[0], 's'); }).join(';')];
    rows.forEach(function (row, i) { lines.push(cols.map(function (c) { return c[2] === '#' ? String(i + 1) : csvCell(row[c[1]], c[2]); }).join(';')); });
    download(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }), fileBase(r.filters) + '_' + name.replace(/\s+/g, '_') + '.csv');
    status('CSV « ' + name + ' » généré : ' + rows.length.toLocaleString('fr-FR') + ' ligne(s).', 'ok');
  }
  async function exportPdf() {
    var r = await ensureData(); if (!r) return;
    var p = document.getElementById('rapPrint'); if (!p) return;
    var f = r.filters;
    p.innerHTML = '<h1>ANAGROCI · Rapport d’activité</h1><p>Période du ' + esc(fmtDate(f.start, 'd')) + ' au ' + esc(fmtDate(f.end, 'd')) + ' · ' + esc(f.warehouse || 'Tous les warehouses du périmètre') + '</p>' +
      '<h2>Indicateurs</h2><table><tbody>' + summaryRows().slice(4).map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td class="num">' + esc(typeof x[1] === 'number' ? fmtNum(x[1], 3) : x[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2>Volume par onglet</h2><table><tbody>' + SHEETS.map(function (s) { return '<tr><th>' + esc(s.name) + '</th><td class="num">' + esc(r.sheets[s.key].total.toLocaleString('fr-FR')) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2>Balance sacherie</h2>' + (r.balance.length ? '<table><thead><tr>' + BALANCE_COLS.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.balance.map(function (b) { return '<tr>' + BALANCE_COLS.map(function (c) { return '<td' + (isNumType(c[2]) ? ' class="num"' : '') + '>' + esc(display(b, c, 0)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' : '<p>Aucun magasin de sacs dans le périmètre.</p>') +
      '<p>Généré le ' + esc(fmtDate(r.generatedAt.toISOString(), 't')) + ' (UTC) · ANAGROCI Operations Suite</p>';
    status('Résumé prêt : choisissez « Enregistrer au format PDF » dans la fenêtre d’impression.', 'ok');
    g.print();
  }
  function sameFilters(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  async function ensureData() {
    var f = readFilters(), e = filterErrors(f);
    if (e) { status(e, 'danger'); return null; }
    if (state.result && sameFilters(state.result.filters, f)) return state.result;
    return preview();
  }
  async function preview() {
    if (state.busy) return null;
    var f = readFilters(), e = filterErrors(f);
    if (e) { status(e, 'danger'); return null; }
    state.busy = true; setBusy(true);
    try {
      state.result = await loadAll(f);
      renderKpis(state.result.summary, f); renderTabs(); renderPreview();
      status('Aperçu prêt : ' + SHEETS.reduce(function (t, s) { return t + state.result.sheets[s.key].total; }, 0).toLocaleString('fr-FR') + ' ligne(s) sur 8 onglets.', 'ok');
      return state.result;
    } catch (err) { console.error(err); status('Échec : ' + errText(err), 'danger'); return null; }
    finally { state.busy = false; setBusy(false); }
  }
  function setBusy(on) { var form = document.getElementById('rapForm'); if (!form) return; form.querySelectorAll('button').forEach(function (b) { b.disabled = !!on; }); }
  function quick(kind) {
    var s = document.getElementById('rap_start'), e = document.getElementById('rap_end'), d = new Date();
    if (kind === 'today') { s.value = e.value = isoDay(d); }
    if (kind === 'yesterday') { d.setDate(d.getDate() - 1); s.value = e.value = isoDay(d); }
    if (kind === '7d') { e.value = isoDay(d); d.setDate(d.getDate() - 6); s.value = isoDay(d); }
    if (kind === 'month') { e.value = isoDay(d); d.setDate(1); s.value = isoDay(d); }
  }

  /* ---------- démarrage ---------- */
  async function loadRefs() {
    var w = await sb.from('wms_warehouses').select('id,code,name,status').order('code');
    state.warehouses = (w.data || []).filter(function (x) { return x.status !== 'INACTIVE'; });
    var s = await sb.from('reports_v_suppliers').select('supplier_code,supplier_name').order('supplier_code').range(0, 4999);
    state.suppliers = s.data || [];
    var c = await sb.from('procurement_campaigns').select('code').order('code');
    state.campaigns = (c.data || []).map(function (x) { return x.code; });
    if (!state.campaigns.length) { var y = new Date().getFullYear(); state.campaigns = [String(y - 1), String(y), String(y + 1)]; }
  }
  async function init() {
    root = document.getElementById('opsRouteView'); if (!root) return;
    sb = await waitClient();
    if (!sb) { root.innerHTML = '<div class="notice danger">Connexion aux données indisponible. Rechargez la page.</div>'; return; }
    try { await loadRefs(); } catch (e) { console.warn('[Rapports] référentiels', e); }
    renderShell();
    root.addEventListener('submit', function (ev) { ev.preventDefault(); preview(); });
    root.addEventListener('click', function (ev) {
      var q = ev.target.closest('[data-quick]'); if (q) { quick(q.dataset.quick); return; }
      var t = ev.target.closest('[data-tab]'); if (t) { state.tab = t.dataset.tab; renderTabs(); renderPreview(); return; }
      var a = ev.target.closest('[data-act]'); if (!a) return;
      var act = a.dataset.act;
      if (act === 'reset') { state.result = null; renderShell(); return; }
      var run = act === 'xlsx' ? exportXlsx : act === 'csv' ? exportCsv : exportPdf;
      Promise.resolve(run()).catch(function (err) { console.error(err); status('Échec de l’export : ' + errText(err), 'danger'); setBusy(false); });
    });
  }
  g.ANAGROCI_ACTIVITY_REPORT = { sheets: SHEETS, balanceCols: BALANCE_COLS, fileBase: fileBase };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); }); else init();
})(window);
