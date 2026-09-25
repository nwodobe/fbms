/* ANAGROCI Operations — AFLP DATA / AFLP Reports (programme AFLP 2027).
   Chaîne suivie : Village → Producteur → RT → Achat → Paiement → Sacs → Stock terrain
   → Évacuation → Warehouse relay → Usine Yamoussoukro.
   Lecture : vues aflp_v_* et fonctions aflp_rpt_* (security invoker, RLS de l'utilisateur).
   Seule écriture : déclaration et suivi d'incident, via les RPC aflp_declare_incident
   et aflp_update_incident (contrôles de rôle côté base).
   Donnée absente : cellule vide, « À compléter » ou « Non disponible ». Rien n'est inventé. */
(function (g) {
  'use strict';

  var PAGE = 1000;          // taille de page PostgREST
  var MAX_ROWS = 60000;     // garde-fou par onglet
  var EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  var AC = 'À compléter', ND = 'Non disponible';
  var sb = null, root = null;
  var state = { refs: { zones: [], clusters: [], villages: [], rts: [], staff: [], producers: [], campaigns: ['2027'] },
    result: null, tab: 'overview', busy: false };

  /* ---------- onglets (ordre = ordre du classeur) ----------
     Types : s texte, i entier, n décimal, k kg, m tonnes, p pourcentage, f FCFA, g GPS,
             d date, t date et heure, v valeur mixte (onglet Overview).
     4e élément d'une colonne : libellé affiché quand la donnée est absente. */
  var SHEETS = [
    { key: 'overview', name: 'AFLP Overview', rpc: 'aflp_rpt_overview',
      cols: [['KPI', 'kpi', 's'], ['Value', 'value', 'v'], ['Unit', 'unite', 's'], ['Note', 'note', 's']] },
    { key: 'zones', name: 'Zones & Clusters', rpc: 'aflp_rpt_zones_clusters',
      cols: [['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Department', 'department', 's', AC], ['Sous-préfecture', 'sous_prefecture', 's', AC],
        ['Main town', 'main_town', 's', AC], ['Zone Head', 'zone_head', 's', AC], ['Unit Head', 'unit_head', 's', AC], ['Assistant', 'assistant', 's', AC],
        ['Number of villages', 'number_of_villages', 'i'], ['Target MT', 'target_mt', 'm', AC], ['Potential MT', 'potential_mt', 'm'], ['Secured MT', 'secured_mt', 'm'],
        ['Purchased MT', 'purchased_mt', 'm'], ['Evacuated MT', 'evacuated_mt', 'm'], ['Remaining MT', 'remaining_mt', 'm', AC], ['Performance %', 'performance_pct', 'p', AC],
        ['Risk level', 'risk_level', 's'], ['Remarks', 'remarks', 's']] },
    { key: 'villages', name: 'Villages Master Data', view: 'aflp_v_villages', order: ['cluster', 'village_name'],
      f: { geo: true, village: 'village_id', campaign: 'campaign' },
      cols: [['Village ID', 'village_id', 's'], ['Village name', 'village_name', 's'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Department', 'department', 's', AC],
        ['Sous-préfecture', 'sous_prefecture', 's', AC], ['GPS latitude', 'gps_lat', 'g', AC], ['GPS longitude', 'gps_lng', 'g', AC], ['Distance to cluster hub', 'distance_hub_km', 'n', AC],
        ['Road condition', 'road_condition', 's', AC], ['Access 10T', 'access_10t', 's', AC], ['Access 30T', 'access_30t', 's', AC], ['Estimated producers', 'est_producers', 'i', AC],
        ['Estimated potential MT', 'potential_mt', 'm', AC], ['Secured potential MT', 'secured_mt', 'm', AC], ['Competition risk', 'competition_risk', 's', AC],
        ['Assigned RT', 'assigned_rt', 's', AC], ['Unit Head', 'unit_head', 's', AC], ['Last visit date', 'last_visit_date', 'd', AC], ['Village status', 'village_status', 's'],
        ['Remarks', 'remarks', 's']] },
    { key: 'producers', name: 'Producers Registry', rpc: 'aflp_rpt_producers', order: ['cluster', 'village', 'producer_name'],
      cols: [['Producer ID', 'producer_id', 's'], ['Producer name', 'producer_name', 's'], ['Phone number', 'phone_number', 's', AC], ['Village', 'village', 's', AC],
        ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['RT assigned', 'rt_assigned', 's', AC], ['Estimated farm size', 'estimated_farm_size_ha', 'n', AC],
        ['Estimated production kg', 'estimated_production_kg', 'k', AC], ['Secured quantity kg', 'secured_quantity_kg', 'k', AC], ['Producer status', 'producer_status', 's'],
        ['ID document available', 'id_document_available', 's'], ['Payment method', 'payment_method', 's', AC], ['Wave number', 'wave_number', 's', AC],
        ['Last transaction date', 'last_transaction_date', 'd'], ['Total sold kg', 'total_sold_kg', 'k'], ['Total amount paid', 'total_amount_paid', 'f'],
        ['Outstanding balance', 'outstanding_balance', 'f'], ['Traceability status', 'traceability_status', 's'], ['Remarks', 'remarks', 's']] },
    { key: 'teams', name: 'RT & Field Teams', rpc: 'aflp_rpt_field_teams', order: ['cluster', 'role', 'name'],
      cols: [['Staff ID', 'staff_id', 's'], ['Name', 'name', 's'], ['Role', 'role', 's'], ['Zone', 'zone', 's', AC], ['Cluster', 'cluster', 's', AC],
        ['Assigned village', 'assigned_village', 's'], ['Phone', 'phone', 's', AC], ['SIM / Wave number', 'sim_wave', 's', AC], ['Active status', 'active_status', 's'],
        ['Start date', 'start_date', 'd', ND], ['Supervisor', 'supervisor', 's', AC], ['Number of producers assigned', 'producers_assigned', 'i'], ['Target kg', 'target_kg', 'k', AC],
        ['Purchased kg', 'purchased_kg', 'k'], ['Achievement %', 'achievement_pct', 'p'], ['Cash advance received', 'cash_advance_received', 'f'], ['Cash justified', 'cash_justified', 'f'],
        ['Cash balance', 'cash_balance', 'f'], ['Bags issued', 'bags_issued', 'i'], ['Bags returned', 'bags_returned', 'i'], ['Bags balance', 'bags_balance', 'i'],
        ['Incidents', 'incidents', 'i'], ['Remarks', 'remarks', 's']] },
    { key: 'missions', name: 'Field Missions & Village Visits', view: 'aflp_v_missions', order: ['visit_date', 'mission_id', 'village'],
      f: { date: 'visit_date', geo: true, village: 'village_id', campaign: 'campaign' },
      cols: [['Mission ID', 'mission_id', 's'], ['Visit date', 'visit_date', 'd'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Village', 'village', 's'],
        ['Staff involved', 'staff_involved', 's', AC], ['Mission objective', 'mission_objective', 's'], ['Producers met', 'producers_met', 'i', ND],
        ['Estimated volume discussed kg', 'estimated_volume_kg', 'k', ND], ['Commitments secured kg', 'commitments_kg', 'k', ND], ['Issues raised', 'issues_raised', 's'],
        ['GPS check-in', 'gps_checkin', 's'], ['Photos available', 'photos_available', 's', ND], ['Attendance list available', 'attendance_list', 's', ND],
        ['Follow-up action', 'follow_up_action', 's'], ['Next visit date', 'next_visit_date', 'd', AC], ['Mission status', 'mission_status', 's'], ['Remarks', 'remarks', 's']] },
    { key: 'purchases', name: 'AFLP Daily Purchases', view: 'aflp_v_daily_purchases', order: ['purchase_date', 'created_at', 'purchase_id'],
      f: { date: 'purchase_date', geo: true, village: 'village_id', rt: 'rt_id', producer: 'producteur_id', payment: 'payment_status', campaign: 'campaign' },
      cols: [['Purchase ID', 'purchase_id', 's'], ['Purchase date', 'purchase_date', 'd'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Village', 'village', 's'],
        ['Producer name', 'producer_name', 's', AC], ['Producer code', 'producer_code', 's', AC], ['RT name', 'rt_name', 's', AC], ['Unit Head', 'unit_head', 's', AC],
        ['Quantity kg', 'quantity_kg', 'k'], ['Bags count', 'bags_count', 'i'], ['Price CFA/kg', 'price_kg', 'f'], ['Gross amount CFA', 'gross_amount', 'f'],
        ['Quality observation', 'quality_observation', 's'], ['Moisture if available', 'moisture', 'p'], ['KOR if available', 'kor', 'n'], ['Payment method', 'payment_method', 's'],
        ['Payment status', 'payment_status', 's'], ['Wave transaction ref', 'wave_transaction_ref', 's', ND], ['Cash voucher ref', 'cash_voucher_ref', 's', AC],
        ['Purchase status', 'purchase_status', 's'], ['Remarks', 'remarks', 's']] },
    { key: 'cash', name: 'Cash Advances & Payments', view: 'aflp_v_cash_advances', order: ['staff_rt', 'date', 'ord', 'created_at', 'transaction_id'],
      f: { date: 'date', geo: true, village: 'village_id', rt: 'rt_id', campaign: 'campaign' }, control: 'cash',
      cols: [['Transaction ID', 'transaction_id', 's'], ['Date', 'date', 'd'], ['Staff / RT', 'staff_rt', 's'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Village', 'village', 's'],
        ['Transaction type', 'transaction_type', 's'], ['Opening advance', 'opening_advance', 'f'], ['Amount received', 'amount_received', 'f'],
        ['Amount paid to producers', 'amount_paid', 'f'], ['Amount returned', 'amount_returned', 'f'], ['Difference', 'difference', 'f'], ['Current balance', 'current_balance', 'f'],
        ['Payment method', 'payment_method', 's'], ['Supporting document', 'supporting_document', 's', AC], ['Approval status', 'approval_status', 's'],
        ['Approved by', 'approved_by', 's', AC], ['Remarks', 'remarks', 's']] },
    { key: 'jute', name: 'AFLP Jute Bags Ledger', view: 'aflp_v_jute_bags_ledger', order: ['location_code', 'movement_date', 'movement_id'],
      f: { dateTs: 'movement_date', geo: true, village: 'village_id', rt: 'rt_id', producer: 'producteur_id', campaign: 'campaign' }, control: 'jute',
      cols: [['Movement ID', 'movement_id', 's'], ['Movement date', 'movement_date', 't'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Village', 'village', 's'],
        ['RT / Staff', 'rt_staff', 's'], ['Supplier / Producer if applicable', 'supplier_producer', 's'], ['Movement type', 'movement_type', 's'],
        ['Bags opening stock', 'bags_opening_stock', 'i'], ['Bags received', 'bags_received', 'i'], ['Bags issued to producers', 'bags_issued_to_producers', 'i'],
        ['Bags used for purchases', 'bags_used_for_purchases', 'i'], ['Bags returned full', 'bags_returned_full', 'i'], ['Bags returned empty', 'bags_returned_empty', 'i'],
        ['Damaged repairable bags', 'damaged_repairable', 'i'], ['Damaged unusable bags', 'damaged_unusable', 'i'], ['Reconditioned bags', 'reconditioned_bags', 'i'],
        ['Bags transferred out', 'bags_transferred_out', 'i'], ['Bags transferred in', 'bags_transferred_in', 'i'], ['Closing balance', 'closing_balance', 'i'], ['Remarks', 'remarks', 's']] },
    { key: 'stock', name: 'Field Stock - Village Stock', view: 'aflp_v_field_stock', order: ['cluster', 'village', 'date'],
      f: { date: 'date', geo: true, village: 'village_id', stock: 'stock_status', campaign: 'campaign' }, control: 'stock',
      cols: [['Stock ID', 'stock_id', 's'], ['Date', 'date', 'd'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Village', 'village', 's'], ['RT', 'rt', 's', AC],
        ['Stock point', 'stock_point', 's'], ['Opening stock kg', 'opening_stock_kg', 'k'], ['Purchases kg', 'purchases_kg', 'k'], ['Returns kg', 'returns_kg', 'k'],
        ['Evacuated kg', 'evacuated_kg', 'k'], ['Loss / adjustment kg', 'loss_adjustment_kg', 'k'], ['Closing stock kg', 'closing_stock_kg', 'k'], ['Bags in stock', 'bags_in_stock', 'i'],
        ['Stock status', 'stock_status', 's'], ['Last physical check', 'last_physical_check', 'd', ND], ['Variance kg', 'variance_kg', 'k', ND], ['Remarks', 'remarks', 's']] },
    { key: 'evacuations', name: 'Evacuations & Transport', view: 'aflp_v_evacuations', order: ['evacuation_date', 'evacuation_id'],
      f: { date: 'evacuation_date', geo: true, villageArr: 'village_ids', rtArr: 'rt_ids', producerArr: 'producer_ids', evac: 'status_code', campaign: 'campaign' },
      cols: [['Evacuation ID', 'evacuation_id', 's'], ['Evacuation date', 'evacuation_date', 'd'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'],
        ['Origin village / stock point', 'origin', 's'], ['Destination warehouse', 'destination', 's'], ['Truck no', 'truck_no', 's'], ['Driver name', 'driver_name', 's', AC],
        ['Transporter', 'transporter', 's', AC], ['Quantity loaded kg', 'qty_loaded_kg', 'k'], ['Bags loaded', 'bags_loaded', 'i'], ['Quantity received kg', 'qty_received_kg', 'k'],
        ['Bags received', 'bags_received', 'i'], ['Difference kg', 'difference_kg', 'k'], ['Distance km', 'distance_km', 'n', ND], ['Transport cost', 'transport_cost', 'f', ND],
        ['Fuel estimate', 'fuel_estimate', 'n', ND], ['Status', 'status', 's'], ['Incident', 'incident', 's'], ['Remarks', 'remarks', 's']] },
    { key: 'relay', name: 'Warehouse Relay AFLP', rpc: 'aflp_rpt_warehouse_relay', order: ['warehouse_code'],
      cols: [['Warehouse relay', 'warehouse_relay', 's'], ['Zone', 'zone', 's', AC], ['Cluster', 'cluster', 's', AC], ['Location', 'location', 's'],
        ['Opening stock kg', 'opening_stock_kg', 'k'], ['Received from field kg', 'received_from_field_kg', 'k'], ['Transferred to Yamoussoukro kg', 'transferred_to_yamoussoukro_kg', 'k'],
        ['Closing stock kg', 'closing_stock_kg', 'k'], ['Bags received', 'bags_received', 'i'], ['Bags transferred', 'bags_transferred', 'i'], ['Quality status', 'quality_status', 's'],
        ['Lot number', 'lot_number', 's'], ['Bin / location', 'bin_location', 's'], ['Last movement date', 'last_movement_date', 'd'], ['Remarks', 'remarks', 's']] },
    { key: 'quality', name: 'Quality & Traceability', view: 'aflp_v_quality_traceability', order: ['date', 'quality_id'],
      f: { date: 'date', geo: true, village: 'village_id', rt: 'rt_id', producer: 'producteur_id', campaign: 'campaign' },
      cols: [['Quality ID', 'quality_id', 's'], ['Date', 'date', 'd'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Village', 'village', 's'],
        ['Producer / Lot', 'producer_lot', 's'], ['Sample type', 'sample_type', 's'], ['Moisture %', 'moisture_pct', 'p'], ['Nut count', 'nut_count', 'i', ND], ['KOR', 'kor', 'n'],
        ['Defects', 'defects', 's'], ['Decision', 'decision', 's'], ['Quality officer', 'quality_officer', 's'], ['Traceability complete', 'traceability_complete', 's'],
        ['Producer linked', 'producer_linked', 's'], ['Village linked', 'village_linked', 's'], ['RT linked', 'rt_linked', 's'], ['GPS linked', 'gps_linked', 's'], ['Remarks', 'remarks', 's']] },
    { key: 'incidents', name: 'Incidents, Risks & Compliance', view: 'aflp_v_incidents', order: ['date', 'incident_id'],
      f: { date: 'date', geo: true, village: 'village_id', rt: 'rt_id', producer: 'producteur_id', incident: 'status_code', campaign: 'campaign' },
      cols: [['Incident ID', 'incident_id', 's'], ['Date', 'date', 'd'], ['Zone', 'zone', 's'], ['Cluster', 'cluster', 's'], ['Village', 'village', 's'], ['Reported by', 'reported_by', 's'],
        ['Incident type', 'incident_type', 's'], ['Risk category', 'risk_category', 's'], ['Description', 'description', 's'], ['Severity', 'severity', 's'],
        ['Immediate action', 'immediate_action', 's', AC], ['Responsible person', 'responsible_person', 's', AC], ['Status', 'status', 's'], ['Closing date', 'closing_date', 'd'],
        ['Evidence available', 'evidence_available', 's'], ['Remarks', 'remarks', 's']] },
    { key: 'performance', name: 'AFLP Performance Dashboard', rpc: 'aflp_rpt_performance',
      cols: [['Section', 'section', 's'], ['Rank', 'rang', 'i'], ['Indicator', 'indicateur', 's'], ['Value', 'valeur', 'n'], ['Unit', 'unite', 's'], ['Detail', 'detail', 's']] },
    { key: 'audit', name: 'AFLP Audit Log', view: 'aflp_v_audit_log', order: ['date', 'audit_id'],
      f: { dateTs: 'date' },
      cols: [['Audit ID', 'audit_id', 's'], ['Date', 'date', 't'], ['User', 'user_email', 's'], ['Role', 'role', 's'], ['Module', 'module', 's'], ['Action', 'action', 's'],
        ['Object type', 'object_type', 's'], ['Object ID', 'object_id', 's'], ['Before', 'before_value', 's'], ['After', 'after_value', 's'], ['Reason', 'reason', 's'],
        ['Approval', 'approval', 's'], ['Remarks', 'remarks', 's']] }
  ];
  var CONTROL_COLS = [['No', 'ordre', 'i'], ['Code', 'code', 's'], ['Control', 'controle', 's'], ['Status', 'statut', 's'], ['Anomalies', 'anomalies', 'i'],
    ['Value', 'valeur', 'n'], ['Unit', 'unite', 's'], ['Detail', 'detail', 's']];
  var KPI_SHOW = ['Target MT', 'Purchased MT', 'Remaining MT', 'Villages covered', 'Producers registered', 'Active RT', 'Total advances', 'Total paid amount',
    'Total bags issued', 'Field stock kg', 'Evacuated kg', 'Warehouse relay stock kg', 'Final delivered to Yamoussoukro kg', 'Incidents open', 'Data completeness rate'];
  var KPI_FR = { 'Target MT': 'Objectif (MT)', 'Purchased MT': 'Acheté (MT)', 'Remaining MT': 'Reste à acheter (MT)', 'Villages covered': 'Villages couverts',
    'Producers registered': 'Producteurs enregistrés', 'Active RT': 'RT actifs', 'Total advances': 'Avances (FCFA)', 'Total paid amount': 'Payé producteurs (FCFA)',
    'Total bags issued': 'Sacs sortis', 'Field stock kg': 'Stock terrain (kg)', 'Evacuated kg': 'Évacué (kg)', 'Warehouse relay stock kg': 'Stock relais (kg)',
    'Final delivered to Yamoussoukro kg': 'Livré usine (kg)', 'Incidents open': 'Incidents ouverts', 'Data completeness rate': 'Complétude données (%)' };
  var PAYMENT = [['', 'Tous'], ['RECONCILIE', 'Payé · caisse réconciliée'], ['A_RECONCILIER', 'Payé · caisse à réconcilier'], ['REJETE', 'Rejeté (non payé)'], ['MANQUANT', 'Montant manquant']];
  var PAYMENT_LIKE = { RECONCILIE: 'Payé · caisse réconciliée', A_RECONCILIER: 'Payé · caisse non*', REJETE: 'Rejeté*', MANQUANT: 'Montant manquant' };
  var STOCK = [['', 'Tous'], ['En stock', 'En stock'], ['Évacué / vide', 'Évacué / vide'], ['Écart négatif', 'Écart négatif']];
  var EVAC = [['', 'Tous'], ['DRAFT', 'Brouillon'], ['LOADING', 'Chargement'], ['DISPATCHED', 'En route'], ['RECEIVED', 'Reçu'], ['CLOSED', 'Clôturé'], ['CANCELLED', 'Annulé']];
  var INCIDENT_STATUS = [['', 'Tous'], ['NON_CLOS', 'Non clôturés'], ['OUVERT', 'Ouvert'], ['EN_COURS', 'En cours'], ['CLOS', 'Clos']];
  var INCIDENT_TYPES = [['ACCIDENT_MOTO', 'Accident moto'], ['SECURITE_TERRAIN', 'Sécurité terrain'], ['CONFLIT_PRODUCTEUR', 'Conflit producteur'], ['RETARD_PAIEMENT', 'Retard paiement'],
    ['MANQUE_SACS', 'Manque de sacs'], ['PERTE_STOCK', 'Perte de stock'], ['SUSPICION_FRAUDE', 'Suspicion fraude'], ['QUALITE_LITIGIEUSE', 'Qualité litigieuse'],
    ['PROBLEME_TRANSPORT', 'Problème transport'], ['RISQUE_TRAVAIL_ENFANTS', 'Risque travail des enfants'], ['GPS_PREUVE_MANQUANTE', 'Problème GPS ou preuve manquante'], ['AUTRE', 'Autre']];
  var RISKS = [['', 'Non précisée'], ['SECURITE', 'Sécurité'], ['FINANCIER', 'Financier'], ['OPERATIONNEL', 'Opérationnel'], ['QUALITE', 'Qualité'], ['CONFORMITE', 'Conformité'], ['SOCIAL', 'Social'], ['DONNEES', 'Données']];
  var SEVERITIES = [['FAIBLE', 'Faible'], ['MOYENNE', 'Moyenne'], ['ELEVEE', 'Élevée'], ['CRITIQUE', 'Critique']];
  var FILTER_LABELS = { date: 'période', geo: 'zone / cluster / chef', village: 'village', rt: 'RT', producer: 'producteur', payment: 'statut paiement',
    stock: 'statut stock', evac: 'statut évacuation', incident: 'statut incident', campaign: 'campagne' };
  var NOTES = [
    'Campagne : les enregistrements Field Buying sans campagne sont rattachés au programme AFLP 2027.',
    'Cash : Opening + Received − Paid − Returned = Current balance, par RT (colonne « Control (= 0) »). Les retours de fonds ne sont pas encore saisis dans FBMS : comptés à 0.',
    'Sacs jute : Opening + Received + Returned full + Returned empty + Transferred in − Issued to producers − Damaged unusable − Transferred out = Closing. Utilisés pour achats, abîmés réparables et reconditionnés sont des changements d’état sans effet sur le solde.',
    'Stock terrain : Opening + Purchases + Returns − Evacuated − Loss/adjustment = Closing, par village et par jour. Pas d’inventaire physique terrain dans FBMS : « Last physical check » et « Variance kg » non disponibles.',
    'Warehouse relay : seuls les flux AFLP sont comptés (réceptions issues d’une évacuation terrain ou de type Achat Bord Champ, lignes de transfert portant ces lots vers l’usine). N’DJEBONOUA peut transiter par Bouaké.',
    'Incidents : déclarés dans l’écran AFLP DATA, et détectés automatiquement (pertes de sacs, écarts de poids, évacuations non réceptionnées, preuves d’achat manquantes).',
    'Audit : journal réservé au Branch Manager (les autres profils voient un onglet vide).',
    'Donnée absente : « À compléter » (à saisir dans FBMS) ou « Non disponible » (pas encore suivie par l’application).'
  ];

  /* ---------- utilitaires ---------- */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return isoDay(new Date()); }
  function nextDay(s) { var p = s.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function fmtNum(v, dec) { var x = Number(v); return (v === null || v === undefined || v === '' || !isFinite(x)) ? '' : x.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: dec == null ? 2 : dec }); }
  function toDate(v, dateOnly) {
    if (v === null || v === undefined || v === '') return null;
    if (dateOnly || /^\d{4}-\d{2}-\d{2}$/.test(String(v))) { var p = String(v).slice(0, 10).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
    var d = new Date(v); return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(v, type) {
    var d = toDate(v, type === 'd'); if (!d) return '';
    var s = pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
    return type === 't' ? s + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) : s;
  }
  var DEC = { i: 0, n: 2, k: 1, m: 3, p: 1, f: 0, g: 6 };
  function isNumType(t) { return DEC.hasOwnProperty(t); }
  function isEmpty(v) { return v === null || v === undefined || v === ''; }
  function rowType(row) { var u = String(row.unite || ''); return u === 'FCFA' ? 'f' : u === 'MT' ? 'm' : u === 'kg' ? 'k' : u === '%' ? 'p' : 'i'; }
  function display(row, col) {
    var t = col[2], v = row[col[1]];
    if (t === 'v') { if (!isEmpty(row.valeur)) return fmtNum(row.valeur, DEC[rowType(row)]); return isEmpty(row.valeur_texte) ? AC : String(row.valeur_texte); }
    if (isEmpty(v)) return col[3] || '';
    if (t === 'd' || t === 't') return fmtDate(v, t);
    if (isNumType(t)) return fmtNum(v, DEC[t]);
    return String(v);
  }
  function numOrNull(v) { if (isEmpty(v)) return null; var x = Number(v); return isFinite(x) ? x : null; }
  function status(msg, cls) { var el = document.getElementById('afStatus'); if (el) { el.textContent = msg || ''; el.className = 'rap-status' + (cls ? ' ' + cls : ''); } }
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
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function splitNames(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

  /* ---------- filtres ---------- */
  function unitHeads() {
    var m = {};
    state.refs.staff.forEach(function (s) { splitNames(s.unit_head).forEach(function (n) { (m[n] = m[n] || []).push(s.cluster_code); }); });
    return m;
  }
  function zoneHeads() {
    var m = {};
    state.refs.staff.forEach(function (s) { splitNames(s.zone_head).forEach(function (n) { (m[n] = m[n] || []).push(s.cluster_code); }); });
    return m;
  }
  function resolveProducer(v) {
    v = String(v || '').trim(); if (!v) return { id: '' };
    var list = state.refs.producers, lv = v.toLowerCase();
    var hit = list.filter(function (p) { return p.id === v || (p.code && p.code.toLowerCase() === lv) || p.label.toLowerCase() === lv; });
    if (!hit.length) hit = list.filter(function (p) { return p.label.toLowerCase().indexOf(lv) >= 0; });
    if (hit.length === 1) return { id: hit[0].id, label: hit[0].label };
    return { error: hit.length ? 'Plusieurs producteurs correspondent à « ' + v + ' » : choisissez-le dans la liste.' : 'Producteur introuvable : « ' + v + ' ».' };
  }
  function readFilters() {
    var f = {}, form = document.getElementById('afForm'); if (!form) return f;
    new FormData(form).forEach(function (v, k) { f[k] = String(v).trim(); });
    if (!f.end) f.end = today();
    var clusters = null;
    function restrict(list) { clusters = clusters === null ? list.slice() : clusters.filter(function (c) { return list.indexOf(c) >= 0; }); }
    if (f.unit_head) restrict(unitHeads()[f.unit_head] || []);
    if (f.zone_head) restrict(zoneHeads()[f.zone_head] || []);
    f.clusters = clusters;
    var pr = resolveProducer(f.producer); f.producerId = pr.id || ''; f.producerError = pr.error || ''; f.producerLabel = pr.label || '';
    return f;
  }
  function filterErrors(f) {
    if (f.start && f.end < f.start) return 'La date de fin précède la date de début.';
    if (f.producerError) return f.producerError;
    if (f.clusters && !f.clusters.length) return 'Aucun cluster ne correspond à la combinaison Chef d’Unité / Chef de Zone choisie.';
    if (f.clusters && f.cluster && f.clusters.indexOf(f.cluster) < 0) return 'Le cluster choisi n’est pas dans le périmètre du chef sélectionné.';
    return '';
  }
  function rpcParams(f) {
    var p = { to: f.end, campaign: f.campaign || null };
    if (f.start) p.from = f.start;
    if (f.zone) p.zone = f.zone;
    if (f.cluster) p.cluster = f.cluster;
    if (f.clusters) p.clusters = f.clusters;
    if (f.village) p.village = f.village;
    if (f.rt) p.rt = f.rt;
    if (f.producerId) p.producer = f.producerId;
    return p;
  }
  function applyFilters(q, sheet, f, notApplied) {
    var m = sheet.f || {};
    function na(k) { if (notApplied.indexOf(FILTER_LABELS[k]) < 0) notApplied.push(FILTER_LABELS[k]); }
    if (m.date) { if (f.start) q = q.gte(m.date, f.start); q = q.lte(m.date, f.end); }
    else if (m.dateTs) { if (f.start) q = q.gte(m.dateTs, f.start); q = q.lt(m.dateTs, nextDay(f.end)); }
    else if (f.start) na('date');
    if (f.zone || f.cluster || f.clusters) {
      if (m.geo) {
        if (f.zone) q = q.eq('zone_code', f.zone);
        if (f.cluster) q = q.eq('cluster_code', f.cluster);
        if (f.clusters) q = q.in('cluster_code', f.clusters);
      } else na('geo');
    }
    if (f.village) { if (m.village) q = q.eq(m.village, f.village); else if (m.villageArr) q = q.contains(m.villageArr, [f.village]); else na('village'); }
    if (f.rt) { if (m.rt) q = q.eq(m.rt, f.rt); else if (m.rtArr) q = q.contains(m.rtArr, [f.rt]); else na('rt'); }
    if (f.producerId) { if (m.producer) q = q.eq(m.producer, f.producerId); else if (m.producerArr) q = q.contains(m.producerArr, [f.producerId]); else na('producer'); }
    if (f.payment) { if (m.payment) q = q.like(m.payment, PAYMENT_LIKE[f.payment] || f.payment); else na('payment'); }
    if (f.stock) { if (m.stock) q = q.eq(m.stock, f.stock); else na('stock'); }
    if (f.evac) { if (m.evac) q = q.eq(m.evac, f.evac); else na('evac'); }
    if (f.incident) { if (m.incident) q = f.incident === 'NON_CLOS' ? q.neq(m.incident, 'CLOS') : q.eq(m.incident, f.incident); else na('incident'); }
    if (f.campaign) { if (m.campaign) q = q.eq(m.campaign, f.campaign); else na('campaign'); }
    return q;
  }
  function rpcNotApplied(f) {
    var out = [];
    ['payment', 'stock', 'evac', 'incident'].forEach(function (k) { if (f[k]) out.push(FILTER_LABELS[k]); });
    return out;
  }
  async function fetchSheet(sheet, f, progress) {
    var notApplied = sheet.rpc ? rpcNotApplied(f) : [], rows = [], from = 0;
    while (true) {
      var q = sheet.rpc ? sb.rpc(sheet.rpc, { p: rpcParams(f) }) : applyFilters(sb.from(sheet.view).select('*'), sheet, f, notApplied);
      (sheet.order || []).forEach(function (c) { q = q.order(c, { ascending: true, nullsFirst: false }); });
      var r = await q.range(from, from + PAGE - 1);
      if (r.error) throw new Error(sheet.name + ' : ' + errText(r.error));
      rows = rows.concat(r.data || []);
      if (progress) progress(sheet, rows.length);
      if (!r.data || r.data.length < PAGE) break;
      from += PAGE;
      if (rows.length >= MAX_ROWS) throw new Error(sheet.name + ' : plus de ' + MAX_ROWS.toLocaleString('fr-FR') + ' lignes. Réduisez la période ou ajoutez un filtre.');
    }
    return { rows: rows, total: rows.length, notApplied: notApplied };
  }
  async function loadAll(f) {
    var res = { filters: f, sheets: {}, generatedAt: new Date() };
    for (var i = 0; i < SHEETS.length; i++) {
      var s = SHEETS[i];
      res.sheets[s.key] = await fetchSheet(s, f, function (sh, n) { status('Chargement ' + sh.name + ' : ' + n.toLocaleString('fr-FR') + ' ligne(s)…'); });
    }
    status('Calcul des contrôles…');
    var c = await sb.rpc('aflp_rpt_controls', { p: rpcParams(f) });
    if (c.error) throw new Error('Contrôles : ' + errText(c.error));
    res.controls = c.data || [];
    return res;
  }

  /* ---------- rendu ---------- */
  function opt(list, value) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value || '') ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function field(label, name, type, value, extra) { return '<div class="ops-field"><label for="af_' + name + '">' + esc(label) + '</label><input id="af_' + name + '" name="' + name + '" type="' + type + '" value="' + esc(value || '') + '" ' + (extra || '') + '></div>'; }
  function select(label, name, list, value, extra) { return '<div class="ops-field"><label for="af_' + name + '">' + esc(label) + '</label><select id="af_' + name + '" name="' + name + '" ' + (extra || '') + '>' + opt(list, value) + '</select></div>'; }
  function cascadeLists(sel) {
    var R = state.refs;
    var cl = R.clusters.filter(function (c) { return !sel.zone || c.zone_code === sel.zone; });
    var vi = R.villages.filter(function (v) { return (!sel.zone || v.zone_code === sel.zone) && (!sel.cluster || v.cluster_code === sel.cluster); });
    var rt = R.rts.filter(function (r) { return (!sel.zone || r.zone_code === sel.zone) && (!sel.cluster || r.cluster_code === sel.cluster) && (!sel.village || r.village_id === sel.village); });
    return {
      clusters: [['', 'Tous']].concat(cl.map(function (c) { return [c.code, c.label]; })),
      villages: [['', 'Tous']].concat(vi.map(function (v) { return [v.village_id, v.village_name + (sel.cluster ? '' : ' · ' + (v.cluster_code || '?'))]; })),
      rts: [['', 'Tous']].concat(rt.map(function (r) { return [r.rt_id, r.rt_name + ' · ' + (r.village_name || r.cluster_code || '')]; }))
    };
  }
  function refreshCascade(changed) {
    var form = document.getElementById('afForm'); if (!form) return;
    var sel = { zone: form.zone.value, cluster: form.cluster.value, village: form.village.value, rt: form.rt.value };
    if (changed === 'zone') { sel.cluster = ''; sel.village = ''; sel.rt = ''; }
    if (changed === 'cluster') { sel.village = ''; sel.rt = ''; }
    if (changed === 'village') { sel.rt = ''; }
    var L = cascadeLists(sel);
    form.cluster.innerHTML = opt(L.clusters, sel.cluster);
    form.village.innerHTML = opt(L.villages, sel.village);
    form.rt.innerHTML = opt(L.rts, sel.rt);
  }
  function headOptions(map, emptyLabel) {
    var names = Object.keys(map).sort();
    return names.length ? [['', 'Tous']].concat(names.map(function (n) { return [n, n]; })) : [['', emptyLabel]];
  }
  function renderShell() {
    var R = state.refs, L = cascadeLists({});
    var camps = R.campaigns.map(function (c) { return [c, c]; });
    var zones = [['', 'Toutes']].concat(R.zones.map(function (z) { return [z.code, z.label]; }));
    var uh = headOptions(unitHeads(), 'Aucun Chef d’Unité assigné (à compléter)');
    var zh = headOptions(zoneHeads(), 'Aucun Chef de Zone assigné (à compléter)');
    root.innerHTML =
      '<div class="ops-pagehead"><div><h1>AFLP DATA</h1><p>Pilotage du programme AFLP 2027 (objectif 3 000 MT) : producteurs, villages, RT, achats, cash, sacs jute, stocks, évacuations, relais, qualité, incidents et performance. Export Excel 16 onglets.</p></div></div>' +
      '<form class="card rap-filters" id="afForm" autocomplete="off"><div class="card-head"><div><h2>Filtres</h2><p>Date de début vide = depuis le début de la campagne. Un filtre sans objet pour un onglet est ignoré et signalé dans l’aperçu.</p></div></div>' +
      '<div class="rap-quick"><button type="button" class="btn secondary" data-quick="campaign">Toute la campagne</button><button type="button" class="btn secondary" data-quick="today">Aujourd’hui</button><button type="button" class="btn secondary" data-quick="7d">7 derniers jours</button><button type="button" class="btn secondary" data-quick="month">Mois en cours</button></div>' +
      '<div class="ops-form-grid">' +
      select('Campagne', 'campaign', camps, R.campaigns[0]) + field('Date de début', 'start', 'date', '') + field('Date de fin', 'end', 'date', today(), 'required') +
      select('Zone', 'zone', zones, '') + select('Cluster', 'cluster', L.clusters, '') + select('Village', 'village', L.villages, '') + select('RT', 'rt', L.rts, '') +
      select('Chef d’Unité (Unit Head)', 'unit_head', uh, '') + select('Chef de Zone (Zone Head)', 'zone_head', zh, '') +
      field('Producteur (code ou nom)', 'producer', 'text', '', 'list="afProducers" placeholder="choisir dans la liste"') +
      select('Statut paiement', 'payment', PAYMENT, '') + select('Statut stock', 'stock', STOCK, '') + select('Statut évacuation', 'evac', EVAC, '') + select('Statut incident', 'incident', INCIDENT_STATUS, '') +
      '</div><datalist id="afProducers">' + R.producers.map(function (p) { return '<option value="' + esc(p.label) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="rap-actions"><button type="submit" class="btn primary">Prévisualiser</button>' +
      '<button type="button" class="btn primary" data-act="xlsx">Exporter Excel</button><button type="button" class="btn secondary" data-act="csv">Exporter CSV (onglet affiché)</button>' +
      '<button type="button" class="btn secondary" data-act="pdf">Exporter résumé PDF</button><button type="button" class="btn secondary" data-act="reset">Réinitialiser</button></div>' +
      '<p class="rap-status" id="afStatus" role="status" aria-live="polite"></p></form>' +
      '<section class="card"><div class="card-head"><div><h2>Indicateurs AFLP</h2><p id="afKpiPeriod">Lancez « Prévisualiser » pour calculer les indicateurs.</p></div></div><div class="kpi-grid rap-kpis" id="afKpis"></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Contrôles obligatoires</h2><p>Solde cash RT, sacs jute, stocks, écarts, rattachements et incidents. « SANS DONNÉES » : rien à contrôler sur ce périmètre.</p></div></div><div id="afControls"><div class="ops-empty">Aucun contrôle calculé pour le moment.</div></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Aperçu par onglet</h2><p>Aperçu limité aux 50 premières lignes ; l’export contient toutes les lignes.</p></div></div><div class="rap-tabs" role="tablist" id="afTabs"></div><div id="afPreviewBox"><div class="ops-empty">Aucun aperçu pour le moment.</div></div></section>' +
      renderIncidentCard() +
      '<section class="card"><div class="card-head"><div><h2>Notes de lecture</h2></div></div><ul class="rap-note af-notes">' + NOTES.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></section>';
  }
  function renderIncidentCard() {
    var R = state.refs;
    var cls = [['', 'Non précisé']].concat(R.clusters.map(function (c) { return [c.code, c.label]; }));
    var vil = [['', 'Non précisé']].concat(R.villages.map(function (v) { return [v.village_id, v.village_name + ' · ' + (v.cluster_code || '?')]; }));
    var rts = [['', 'Non précisé']].concat(R.rts.map(function (r) { return [r.rt_id, r.rt_name + ' · ' + (r.cluster_code || '')]; }));
    return '<section class="card" id="afIncidentCard"><div class="card-head"><div><h2>Incidents, risques et conformité</h2><p>Déclarer un incident terrain et suivre sa clôture. La clôture exige une note.</p></div></div>' +
      '<details class="af-details"><summary>Déclarer un incident</summary><form id="afIncForm" class="af-inc-form" autocomplete="off"><div class="ops-form-grid">' +
      '<div class="ops-field"><label for="afi_date">Date</label><input id="afi_date" name="incident_date" type="date" value="' + today() + '" required></div>' +
      '<div class="ops-field"><label for="afi_type">Type d’incident</label><select id="afi_type" name="incident_type" required>' + opt(INCIDENT_TYPES, '') + '</select></div>' +
      '<div class="ops-field"><label for="afi_risk">Catégorie de risque</label><select id="afi_risk" name="risk_category">' + opt(RISKS, '') + '</select></div>' +
      '<div class="ops-field"><label for="afi_sev">Gravité</label><select id="afi_sev" name="severity" required>' + opt(SEVERITIES, 'MOYENNE') + '</select></div>' +
      '<div class="ops-field"><label for="afi_cluster">Cluster</label><select id="afi_cluster" name="cluster">' + opt(cls, '') + '</select></div>' +
      '<div class="ops-field"><label for="afi_village">Village</label><select id="afi_village" name="village_id">' + opt(vil, '') + '</select></div>' +
      '<div class="ops-field"><label for="afi_rt">RT</label><select id="afi_rt" name="rt_id">' + opt(rts, '') + '</select></div>' +
      '<div class="ops-field"><label for="afi_resp">Responsable du suivi</label><input id="afi_resp" name="responsible_person" type="text"></div>' +
      '<div class="ops-field af-wide"><label for="afi_desc">Description (10 caractères minimum)</label><textarea id="afi_desc" name="description" rows="3" required minlength="10"></textarea></div>' +
      '<div class="ops-field af-wide"><label for="afi_action">Action immédiate</label><input id="afi_action" name="immediate_action" type="text"></div>' +
      '<div class="ops-field"><label for="afi_evref">Référence de la preuve (photo, PV)</label><input id="afi_evref" name="evidence_ref" type="text"></div>' +
      '<div class="ops-field af-check"><label><input type="checkbox" name="evidence_available" value="true"> Preuve disponible</label></div>' +
      '</div><div class="rap-actions"><button type="submit" class="btn primary">Enregistrer l’incident</button></div><p class="rap-status" id="afIncStatus" role="status" aria-live="polite"></p></form></details>' +
      '<div id="afIncList" class="af-inc-list"><p class="rap-note">Lancez « Prévisualiser » pour afficher les incidents déclarés non clôturés.</p></div></section>';
  }
  function renderKpis() {
    var box = document.getElementById('afKpis'), r = state.result; if (!box || !r) return;
    var rows = r.sheets.overview.rows, by = {};
    rows.forEach(function (x) { by[x.kpi] = x; });
    box.innerHTML = KPI_SHOW.map(function (k) {
      var x = by[k] || {}, v = isEmpty(x.valeur) ? (isEmpty(x.valeur_texte) ? AC : x.valeur_texte) : fmtNum(x.valeur, DEC[rowType(x)]);
      return '<div class="kpi"><small>' + esc(KPI_FR[k] || k) + '</small><b>' + esc(v) + '</b></div>';
    }).join('');
    var f = r.filters, p = document.getElementById('afKpiPeriod');
    if (p) p.textContent = 'Campagne ' + (f.campaign || '2027') + ' · ' + (f.start ? 'du ' + fmtDate(f.start, 'd') : 'depuis le début') + ' au ' + fmtDate(f.end, 'd') + scopeText(f);
  }
  function scopeText(f) {
    var R = state.refs, parts = [];
    if (f.zone) parts.push((R.zones.filter(function (z) { return z.code === f.zone; })[0] || {}).label || f.zone);
    if (f.cluster) parts.push((R.clusters.filter(function (c) { return c.code === f.cluster; })[0] || {}).label || f.cluster);
    if (f.unit_head) parts.push('Chef d’Unité ' + f.unit_head);
    if (f.zone_head) parts.push('Chef de Zone ' + f.zone_head);
    if (f.village) parts.push((R.villages.filter(function (v) { return v.village_id === f.village; })[0] || {}).village_name || f.village);
    if (f.rt) parts.push('RT ' + ((R.rts.filter(function (x) { return x.rt_id === f.rt; })[0] || {}).rt_name || f.rt));
    if (f.producerLabel) parts.push('Producteur ' + f.producerLabel);
    return parts.length ? ' · ' + parts.join(' · ') : ' · tout le périmètre';
  }
  function badge(s) { var c = s === 'ALERTE' ? 'danger' : s === 'OK' ? 'ok' : 'muted'; return '<span class="af-badge af-' + c + '">' + esc(s) + '</span>'; }
  function renderControls() {
    var box = document.getElementById('afControls'), r = state.result; if (!box || !r) return;
    box.innerHTML = '<div class="rap-table-wrap"><table><thead><tr><th>Contrôle</th><th>Statut</th><th class="num">Anomalies</th><th class="num">Valeur</th><th>Détail</th></tr></thead><tbody>' +
      r.controls.map(function (c) {
        return '<tr><td>' + esc(c.controle) + '</td><td>' + badge(c.statut) + '</td><td class="num">' + esc(fmtNum(c.anomalies, 0)) + '</td><td class="num">' +
          esc(isEmpty(c.valeur) ? '' : fmtNum(c.valeur, 1) + (c.unite ? ' ' + c.unite : '')) + '</td><td class="af-wrap">' + esc(c.detail) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function renderTabs() {
    var t = document.getElementById('afTabs'), r = state.result; if (!t || !r) return;
    t.innerHTML = SHEETS.map(function (s, i) {
      return '<button type="button" role="tab" data-tab="' + s.key + '" aria-selected="' + (state.tab === s.key) + '">' + (i + 1) + '. ' + esc(s.name) + '<span>' + esc(r.sheets[s.key].total.toLocaleString('fr-FR')) + '</span></button>';
    }).join('');
  }
  function tableHtml(cols, rows) {
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>';
    var body = rows.slice(0, 50).map(function (row) {
      return '<tr>' + cols.map(function (c) { var empty = c[2] !== 'v' && isEmpty(row[c[1]]) && c[3]; return '<td class="' + (isNumType(c[2]) || c[2] === 'v' ? 'num' : '') + (empty ? ' af-missing' : '') + '">' + esc(display(row, c)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="rap-table-wrap"><table><thead>' + head + '</thead><tbody>' + (body || '<tr><td colspan="' + cols.length + '">Aucune ligne pour ces filtres (l’onglet sera exporté avec ses en-têtes).</td></tr>') + '</tbody></table></div>';
  }
  function renderPreview() {
    var box = document.getElementById('afPreviewBox'), r = state.result; if (!box || !r) return;
    var sh = SHEETS.filter(function (s) { return s.key === state.tab; })[0], data = r.sheets[sh.key];
    var html = tableHtml(sh.cols, data.rows) + '<p class="rap-note">' + esc(data.total.toLocaleString('fr-FR')) + ' ligne(s) exportée(s).' +
      (data.notApplied.length ? ' Filtres sans objet pour cet onglet : ' + esc(data.notApplied.join(', ')) + '.' : '') +
      (sh.key === 'audit' && !data.total ? ' Journal réservé au Branch Manager.' : '') +
      (sh.key === 'performance' ? ' Les contrôles obligatoires sont ajoutés sous les indicateurs dans le classeur.' : '') + '</p>';
    box.innerHTML = html;
  }
  function renderIncidentList() {
    var box = document.getElementById('afIncList'), r = state.result; if (!box || !r) return;
    var open = r.sheets.incidents.rows.filter(function (x) { return x.source_type === 'DECLARE' && x.status_code !== 'CLOS'; });
    var auto = r.sheets.incidents.rows.filter(function (x) { return x.source_type === 'AUTO' && x.status_code !== 'CLOS'; }).length;
    box.innerHTML = '<p class="rap-note">' + open.length + ' incident(s) déclaré(s) non clôturé(s) · ' + auto + ' détection(s) automatique(s) ouverte(s) (voir l’onglet 14).</p>' +
      (open.length ? '<div class="rap-table-wrap"><table><thead><tr><th>Incident</th><th>Date</th><th>Cluster</th><th>Type</th><th>Gravité</th><th>Statut</th><th>Mettre à jour</th></tr></thead><tbody>' +
        open.slice(0, 100).map(function (x) {
          return '<tr><td>' + esc(x.incident_id) + '</td><td>' + esc(fmtDate(x.date, 'd')) + '</td><td>' + esc(x.cluster || '') + '</td><td>' + esc(x.incident_type) + '</td><td>' + esc(x.severity) + '</td><td>' + esc(x.status) + '</td>' +
            '<td><form class="af-inc-upd" data-id="' + esc(x.incident_id) + '"><label class="af-sr" for="afu_s_' + esc(x.incident_id) + '">Nouveau statut</label><select id="afu_s_' + esc(x.incident_id) + '" name="status">' +
            opt([['EN_COURS', 'En cours'], ['CLOS', 'Clos'], ['OUVERT', 'Ouvert']], x.status_code === 'OUVERT' ? 'EN_COURS' : 'CLOS') + '</select>' +
            '<label class="af-sr" for="afu_n_' + esc(x.incident_id) + '">Note</label><input id="afu_n_' + esc(x.incident_id) + '" name="note" type="text" placeholder="Note (obligatoire pour clore)">' +
            '<button type="submit" class="btn secondary">Valider</button></form></td></tr>';
        }).join('') + '</tbody></table></div>' : '');
  }

  /* ---------- incidents (seule écriture, via RPC) ---------- */
  async function declareIncident(form) {
    var st = document.getElementById('afIncStatus');
    var d = {}; new FormData(form).forEach(function (v, k) { d[k] = String(v).trim(); });
    if (d.description.length < 10) { st.textContent = 'Description trop courte (10 caractères minimum).'; st.className = 'rap-status danger'; return; }
    d.evidence_available = d.evidence_available === 'true';
    st.textContent = 'Enregistrement…'; st.className = 'rap-status';
    var r = await sb.rpc('aflp_declare_incident', { p: d });
    if (r.error) { st.textContent = 'Échec : ' + errText(r.error); st.className = 'rap-status danger'; return; }
    st.textContent = 'Incident enregistré : ' + ((r.data && r.data.id) || '') + '.'; st.className = 'rap-status ok';
    form.reset(); form.incident_date.value = today();
    if (state.result) preview();
  }
  async function updateIncident(form) {
    var id = form.dataset.id, s = form.status.value, note = form.note.value.trim();
    if (s === 'CLOS' && note.length < 5) { status('La clôture exige une note (5 caractères minimum).', 'danger'); form.note.focus(); return; }
    var r = await sb.rpc('aflp_update_incident', { p_id: id, p_status: s, p_note: note || null });
    if (r.error) { status('Échec de la mise à jour de ' + id + ' : ' + errText(r.error), 'danger'); return; }
    status('Incident ' + id + ' : statut mis à jour.', 'ok');
    preview();
  }

  /* ---------- exports ---------- */
  function fileStamp() { return today().replace(/-/g, ''); }
  function fileBase(f) { return 'ANAGROCI_AFLP_DATA_' + String((f && f.campaign) || '2027').replace(/[^0-9A-Za-z]/g, '') + '_' + fileStamp(); }
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
  var NUMFMT = { i: '#,##0', n: '#,##0.00', k: '#,##0.0', m: '#,##0.000', p: '0.0', f: '#,##0', g: '0.000000', d: 'dd/mm/yyyy', t: 'dd/mm/yyyy hh:mm' };
  function cellValue(row, col) {
    var t = col[2], v = row[col[1]];
    if (t === 'v') return isEmpty(row.valeur) ? (isEmpty(row.valeur_texte) ? AC : String(row.valeur_texte)) : numOrNull(row.valeur);
    if (isEmpty(v)) return col[3] || null;
    if (t === 'd' || t === 't') return toDate(v, t === 'd');
    if (isNumType(t)) return numOrNull(v);
    return String(v);
  }
  function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function styleHeader(row) {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF053B23' } };
    row.alignment = { vertical: 'middle', wrapText: true }; row.height = 30;
  }
  function addDataSheet(wb, sheet, rows) {
    var cols = sheet.cols.slice(), ctl = sheet.control;
    if (ctl) cols.push(['Control (= 0)', '__ctl', 'n']);
    var ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    styleHeader(ws.addRow(cols.map(function (c) { return c[0]; })));
    var idx = {}; cols.forEach(function (c, i) { idx[c[1]] = colLetter(i + 1); });
    rows.forEach(function (row, i) {
      var xr = ws.addRow(cols.map(function (c) { return c[1] === '__ctl' ? null : cellValue(row, c); }));
      if (sheet.key === 'overview') { var tt = rowType(row); if (!isEmpty(row.valeur)) xr.getCell(2).numFmt = NUMFMT[tt]; }
      if (ctl) {
        var n = i + 2, L = function (k) { return idx[k] + n; }, formula;
        if (ctl === 'cash') formula = L('opening_advance') + '+' + L('amount_received') + '-' + L('amount_paid') + '-' + L('amount_returned') + '-' + L('current_balance');
        if (ctl === 'jute') formula = L('bags_opening_stock') + '+' + L('bags_received') + '+' + L('bags_returned_full') + '+' + L('bags_returned_empty') + '+' + L('bags_transferred_in') +
          '-' + L('bags_issued_to_producers') + '-' + L('damaged_unusable') + '-' + L('bags_transferred_out') + '-' + L('closing_balance');
        if (ctl === 'stock') formula = L('opening_stock_kg') + '+' + L('purchases_kg') + '+' + L('returns_kg') + '-' + L('evacuated_kg') + '-' + L('loss_adjustment_kg') + '-' + L('closing_stock_kg');
        xr.getCell(cols.length).value = { formula: formula, result: 0 };
      }
    });
    cols.forEach(function (c, i) {
      var col = ws.getColumn(i + 1);
      col.width = Math.min(46, Math.max(11, c[0].length + 2, c[2] === 's' ? 16 : 0));
      if (NUMFMT[c[2]]) col.numFmt = NUMFMT[c[2]];
    });
    ws.getRow(1).eachCell(function (cell) { cell.numFmt = '@'; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  }
  function filterSummary(f) {
    var out = [['Campagne', f.campaign || '2027'], ['Période', (f.start ? 'du ' + fmtDate(f.start, 'd') : 'depuis le début de la campagne') + ' au ' + fmtDate(f.end, 'd')], ['Périmètre', scopeText(f).replace(/^ · /, '')]];
    [['payment', 'Statut paiement'], ['stock', 'Statut stock'], ['evac', 'Statut évacuation'], ['incident', 'Statut incident']].forEach(function (k) { if (f[k[0]]) out.push([k[1], f[k[0]]]); });
    return out;
  }
  async function exportXlsx() {
    var r = await ensureData(); if (!r) return;
    status('Préparation du classeur Excel…');
    var ExcelJS = await loadExcelJs();
    var wb = new ExcelJS.Workbook(); wb.creator = 'ANAGROCI Operations Suite · AFLP DATA'; wb.created = new Date();
    SHEETS.forEach(function (s) {
      var ws = addDataSheet(wb, s, r.sheets[s.key].rows);
      if (s.key === 'overview') {
        ws.addRow([]);
        ws.addRow(['Filtres appliqués']).font = { bold: true };
        filterSummary(r.filters).forEach(function (x) { ws.addRow(x); });
        ws.addRow(['Généré le', fmtDate(r.generatedAt.toISOString(), 't') + ' (UTC)']);
        ws.addRow([]);
        ws.addRow(['Notes de lecture']).font = { bold: true };
        NOTES.forEach(function (n) { var x = ws.addRow(['', n]); x.getCell(2).alignment = { wrapText: true, vertical: 'top' }; });
        ws.getColumn(1).width = 36; ws.getColumn(2).width = 60; ws.getColumn(4).width = 60;
      }
      if (s.key === 'performance') {
        ws.addRow([]);
        ws.addRow(['Contrôles obligatoires']).font = { bold: true, size: 12 };
        var h = ws.addRow(CONTROL_COLS.map(function (c) { return c[0]; })); styleHeader(h);
        r.controls.forEach(function (c) {
          var x = ws.addRow(CONTROL_COLS.map(function (col) { return cellValue(c, col); }));
          var color = c.statut === 'ALERTE' ? 'FFF8D7DA' : c.statut === 'OK' ? 'FFD9F2E3' : 'FFEDEDED';
          x.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
          x.getCell(5).numFmt = '#,##0'; x.getCell(6).numFmt = '#,##0.0';
        });
        ws.getColumn(3).width = 44; ws.getColumn(6).width = 16; ws.getColumn(8).width = 70;
      }
    });
    var buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileBase(r.filters) + '.xlsx');
    status('Classeur Excel généré : 16 onglets, ' + SHEETS.reduce(function (t, s) { return t + r.sheets[s.key].total; }, 0).toLocaleString('fr-FR') + ' ligne(s).', 'ok');
  }
  function csvCell(v, t) {
    if (isEmpty(v)) return '';
    var s;
    if (t === 'd' || t === 't') s = fmtDate(v, t);
    else if (isNumType(t)) { var x = Number(v); s = isFinite(x) ? String(x).replace('.', ',') : String(v); }
    else s = String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  async function exportCsv() {
    var r = await ensureData(); if (!r) return;
    var sh = SHEETS.filter(function (s) { return s.key === state.tab; })[0], rows = r.sheets[sh.key].rows;
    var lines = [sh.cols.map(function (c) { return csvCell(c[0], 's'); }).join(';')];
    rows.forEach(function (row) {
      lines.push(sh.cols.map(function (c) {
        if (c[2] === 'v') return csvCell(isEmpty(row.valeur) ? row.valeur_texte : row.valeur, isEmpty(row.valeur) ? 's' : 'n');
        return isEmpty(row[c[1]]) ? csvCell(c[3] || '', 's') : csvCell(row[c[1]], c[2]);
      }).join(';'));
    });
    if (sh.key === 'performance') {
      lines.push(''); lines.push(CONTROL_COLS.map(function (c) { return c[0]; }).join(';'));
      r.controls.forEach(function (c) { lines.push(CONTROL_COLS.map(function (col) { return csvCell(c[col[1]], col[2]); }).join(';')); });
    }
    download(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }), fileBase(r.filters) + '_' + sh.name.replace(/[^A-Za-z0-9]+/g, '_') + '.csv');
    status('CSV « ' + sh.name + ' » généré : ' + rows.length.toLocaleString('fr-FR') + ' ligne(s).', 'ok');
  }
  async function exportPdf() {
    var r = await ensureData(); if (!r) return;
    var p = document.getElementById('rapPrint'); if (!p) return;
    var zones = SHEETS.filter(function (s) { return s.key === 'zones'; })[0];
    var zcols = zones.cols.filter(function (c) { return ['cluster', 'zone', 'number_of_villages', 'purchased_mt', 'evacuated_mt', 'target_mt', 'performance_pct', 'risk_level'].indexOf(c[1]) >= 0; });
    p.innerHTML = '<h1>ANAGROCI · AFLP DATA ' + esc(r.filters.campaign || '2027') + '</h1><p>' + esc(filterSummary(r.filters).map(function (x) { return x[0] + ' : ' + x[1]; }).join(' · ')) + '</p>' +
      '<h2>Indicateurs</h2><table><tbody>' + r.sheets.overview.rows.map(function (x) { return '<tr><th>' + esc(x.kpi) + '</th><td class="num">' + esc(display(x, ['', 'value', 'v'])) + ' ' + esc(x.unite || '') + '</td><td>' + esc(x.note || '') + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2>Contrôles obligatoires</h2><table><thead><tr><th>Contrôle</th><th>Statut</th><th>Anomalies</th><th>Détail</th></tr></thead><tbody>' +
      r.controls.map(function (c) { return '<tr><td>' + esc(c.controle) + '</td><td>' + esc(c.statut) + '</td><td class="num">' + esc(fmtNum(c.anomalies, 0)) + '</td><td>' + esc(c.detail) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2>Zones & clusters</h2><table><thead><tr>' + zcols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      r.sheets.zones.rows.map(function (x) { return '<tr>' + zcols.map(function (c) { return '<td' + (isNumType(c[2]) ? ' class="num"' : '') + '>' + esc(display(x, c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' +
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
      renderKpis(); renderControls(); renderTabs(); renderPreview(); renderIncidentList();
      var alerts = state.result.controls.filter(function (c) { return c.statut === 'ALERTE'; }).length;
      status('Aperçu prêt : ' + SHEETS.reduce(function (t, s) { return t + state.result.sheets[s.key].total; }, 0).toLocaleString('fr-FR') + ' ligne(s) sur 16 onglets · ' + alerts + ' contrôle(s) en alerte.', 'ok');
      return state.result;
    } catch (err) { console.error(err); status('Échec : ' + errText(err), 'danger'); return null; }
    finally { state.busy = false; setBusy(false); }
  }
  function setBusy(on) { var form = document.getElementById('afForm'); if (!form) return; form.querySelectorAll('button').forEach(function (b) { b.disabled = !!on; }); }
  function quick(kind) {
    var s = document.getElementById('af_start'), e = document.getElementById('af_end'), d = new Date();
    if (kind === 'campaign') { s.value = ''; e.value = isoDay(d); }
    if (kind === 'today') { s.value = e.value = isoDay(d); }
    if (kind === '7d') { e.value = isoDay(d); d.setDate(d.getDate() - 6); s.value = isoDay(d); }
    if (kind === 'month') { e.value = isoDay(d); d.setDate(1); s.value = isoDay(d); }
  }

  /* ---------- démarrage ---------- */
  async function loadRefs() {
    var R = state.refs;
    var z = await sb.from('aflp_zones').select('code,label').eq('active', true).order('code'); R.zones = z.data || [];
    var c = await sb.from('aflp_clusters').select('code,label,zone_code').eq('active', true).order('label'); R.clusters = c.data || [];
    var v = await sb.from('aflp_v_village_dim').select('village_id,village_name,cluster_code,zone_code').order('village_name').range(0, 4999); R.villages = v.data || [];
    var r = await sb.from('aflp_v_rt_dim').select('rt_id,rt_name,cluster_code,zone_code,village_id,village_name').order('rt_name').range(0, 4999); R.rts = r.data || [];
    var s = await sb.from('aflp_v_cluster_staff').select('cluster_code,zone_code,unit_head,zone_head'); R.staff = s.data || [];
    var p = await sb.from('producteurs').select('id,code,nom,prenoms').eq('deleted', false).order('nom').range(0, 9999);
    R.producers = (p.data || []).map(function (x) { var n = [x.nom, x.prenoms].filter(Boolean).join(' '); return { id: x.id, code: x.code || '', label: (x.code ? x.code + ' · ' : '') + n }; });
    var t = await sb.from('aflp_program_targets').select('campaign').order('campaign', { ascending: false });
    var camps = uniq((t.data || []).map(function (x) { return x.campaign; })); if (camps.length) R.campaigns = camps;
  }
  async function init() {
    root = document.getElementById('opsRouteView'); if (!root) return;
    sb = await waitClient();
    if (!sb) { root.innerHTML = '<div class="notice danger">Connexion aux données indisponible. Rechargez la page.</div>'; return; }
    try { await loadRefs(); } catch (e) { console.warn('[AFLP DATA] référentiels', e); }
    renderShell();
    root.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var t = ev.target;
      if (t.id === 'afIncForm') { declareIncident(t).catch(function (err) { status('Échec : ' + errText(err), 'danger'); }); return; }
      if (t.classList && t.classList.contains('af-inc-upd')) { updateIncident(t).catch(function (err) { status('Échec : ' + errText(err), 'danger'); }); return; }
      preview();
    });
    root.addEventListener('change', function (ev) { var n = ev.target && ev.target.name; if (ev.target.form && ev.target.form.id === 'afForm' && (n === 'zone' || n === 'cluster' || n === 'village')) refreshCascade(n); });
    root.addEventListener('click', function (ev) {
      var q = ev.target.closest('[data-quick]'); if (q) { quick(q.dataset.quick); return; }
      var t = ev.target.closest('[data-tab]'); if (t) { state.tab = t.dataset.tab; renderTabs(); renderPreview(); return; }
      var a = ev.target.closest('[data-act]'); if (!a) return;
      var act = a.dataset.act;
      if (act === 'reset') { state.result = null; state.tab = 'overview'; renderShell(); return; }
      var run = act === 'xlsx' ? exportXlsx : act === 'csv' ? exportCsv : exportPdf;
      Promise.resolve(run()).catch(function (err) { console.error(err); status('Échec de l’export : ' + errText(err), 'danger'); setBusy(false); });
    });
  }
  g.ANAGROCI_AFLP_DATA = { sheets: SHEETS, controlCols: CONTROL_COLS, fileBase: fileBase };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); }); else init();
})(window);
