/* ANAGROCI Operations Suite - Stock Transfer MVP (WMS ledger canonical). */
(function (global) {
  'use strict';

  if (!document.body || document.body.dataset.workspace !== 'transfer') return;

  var root = null, sb = null;
  var state = { permissions: {}, settings: {}, transfers: [], warehouses: [], stock: [] };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v) { var x = Number(v); return Number.isFinite(x) ? x : 0; }
  function kg(v) { return num(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' kg'; }
  function mt(v) { return (num(v) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' MT'; }
  function dt(v) {
    if (!v) return '-';
    try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)); }
    catch (e) { return esc(v); }
  }
  function routeParts() {
    var h = (location.hash || '#overview').replace(/^#/, '').split('/');
    return { route: h[0] || 'overview', id: h.slice(1).join('/') || '' };
  }
  function badge(s) {
    var x = String(s || '').toUpperCase();
    var c = /DISCREPANCY|REJECT|CANCEL|BROKEN|MISMATCH/.test(x) ? 'danger' :
      /CLOSED|RECONCILED|APPROVED/.test(x) ? 'ok' :
      /IN_TRANSIT|ARRIVED|READY|LOADED|PENDING|REQUESTED/.test(x) ? 'warn' : 'info';
    return '<span class="badge ' + c + '">' + esc(s || '-') + '</span>';
  }
  function head(title, sub, actions) {
    return '<div class="ops-route-head"><div><h1>' + esc(title) + '</h1><p>' + esc(sub || '') + '</p></div>' +
      '<div class="ops-route-actions">' + (actions || '') + '</div></div>';
  }
  function notice(cls, html) { return '<div class="notice ' + (cls || '') + '">' + html + '</div>'; }
  function table(headers, rows) {
    if (!rows.length) return '<div class="ops-empty">Aucune donnee disponible.</div>';
    return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function field(label, name, type, value, extra) {
    extra = extra || '';
    if (type === 'textarea') return '<div class="ops-field"><label>' + esc(label) + '</label><textarea name="' + esc(name) + '" ' + extra + '>' + esc(value || '') + '</textarea></div>';
    return '<div class="ops-field"><label>' + esc(label) + '</label><input name="' + esc(name) + '" type="' + esc(type || 'text') + '" value="' + esc(value || '') + '" ' + extra + '></div>';
  }
  function selectField(label, name, options, value, extra) {
    extra = extra || '';
    return '<div class="ops-field"><label>' + esc(label) + '</label><select name="' + esc(name) + '" ' + extra + '>' +
      options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value || '') ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select></div>';
  }
  function kpi(label, value, href, cls, note) {
    return '<a class="kpi kpi-link ' + (cls || '') + '" href="' + esc(href) + '"><small>' + esc(label) + '</small><b>' + esc(value) + '</b><span>' + esc(note || 'Ouvrir la file') + '</span></a>';
  }
  function can(action) { return !!((state.permissions.actions || {})[action]); }

  function waitClient() {
    return new Promise(function (resolve) {
      var k = 0, t = setInterval(function () {
        k += 1;
        if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) {
          clearInterval(t);
          resolve(global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON));
        } else if (k > 120) { clearInterval(t); resolve(null); }
      }, 80);
    });
  }
  async function query(name, columns, build) {
    var q = sb.from(name).select(columns || '*');
    if (build) q = build(q);
    var r = await q;
    if (r.error) throw new Error(r.error.message || ('Lecture impossible: ' + name));
    return r.data || [];
  }
  async function rpc(name, args) {
    var r = await sb.rpc(name, args || {});
    if (r.error) throw new Error(r.error.message || name);
    return r.data;
  }
  function opKey(action, id) {
    var storeKey = 'wms-trf-op:' + action + ':' + (id || 'NEW');
    var k = sessionStorage.getItem(storeKey);
    if (!k) {
      k = 'WEB-' + action + '-' + (id || 'NEW') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
      sessionStorage.setItem(storeKey, k);
    }
    return { key: k, storeKey: storeKey };
  }
  function doneKey(k) { if (k && k.storeKey) sessionStorage.removeItem(k.storeKey); }
  function formObj(form) {
    var x = {}, fd = new FormData(form);
    fd.forEach(function (v, k) { x[k] = String(v).trim(); });
    return x;
  }
  function setBusy(form, on) {
    form.querySelectorAll('button,input,select,textarea').forEach(function (el) { el.disabled = !!on; });
  }
  function errorBox(e) {
    root.insertAdjacentHTML('afterbegin', notice('danger', '<b>Erreur:</b>&nbsp;' + esc(e && e.message ? e.message : e)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadBase() {
    var p = await rpc('wms_trf_my_permissions');
    state.permissions = p || {};
    state.settings = (p && p.settings) || {};
    state.warehouses = await query('wms_warehouses', 'id,site_code,code,name,location,status,capacity_kg,is_factory', function (q) { return q.eq('status', 'ACTIVE').order('code'); });
    state.transfers = await query('wms_v_transfers', '*', function (q) { return q.eq('is_test', false).order('requested_at', { ascending: false }).limit(500); });
  }
  async function loadStock() {
    state.stock = await query('wms_v_bin_lot_available', '*', function (q) { return q.gt('available_kg', 0).order('warehouse_code').order('bin_id').order('lot_id'); });
  }
  function transferById(id) { return state.transfers.filter(function (x) { return x.id === id; })[0] || null; }

  function rowTransfer(t, target) {
    return '<tr class="ops-click" data-href="#' + esc(target) + '/' + encodeURIComponent(t.id) + '">' +
      '<td class="mono"><b>' + esc(t.id) + '</b><br><span class="muted">' + esc(t.priority || '') + '</span></td>' +
      '<td>' + esc(t.origin_code || '-') + '</td><td>' + esc(t.dest_code || '-') + '</td>' +
      '<td>' + mt(t.planned_qty) + '</td><td>' + (t.dispatched_qty == null ? '-' : mt(t.dispatched_qty)) + '</td>' +
      '<td>' + (t.received_qty == null ? '-' : mt(t.received_qty)) + '</td><td>' + (t.variance_kg == null ? '-' : kg(t.variance_kg)) + '</td>' +
      '<td>' + esc(t.truck_plate || '-') + '</td><td>' + badge(t.status) + '</td></tr>';
  }

  function timeline(t) {
    var items = [
      ['REQUESTED', t.requested_at, t.requested_by_name], ['APPROVED', t.approved_at, t.approved_by_name],
      ['LOADED', t.loaded_at, t.loaded_by_name], ['DISPATCHED', t.departed_at, t.dispatched_by_name],
      ['ARRIVED', t.arrived_at, t.arrival_by_name], ['RECEIVED', t.received_at, t.received_by_name],
      ['RECONCILED', t.reconciled_at, t.reconciled_by_name], ['CLOSED', t.closed_at, t.closed_by_name]
    ].filter(function (x) { return x[1]; });
    if (!items.length) return '';
    return '<div class="ops-timeline">' + items.map(function (x) {
      return '<div class="ops-timeline-item"><time>' + esc(dt(x[1])) + '</time><div><b>' + esc(x[0]) + '</b><small>' + esc(x[2] || '-') + '</small></div></div>';
    }).join('') + '</div>';
  }

  function overview() {
    function count(s) { return state.transfers.filter(function (t) { return s.indexOf(t.status) >= 0; }).length; }
    var today = new Date().toISOString().slice(0, 10);
    var closedToday = state.transfers.filter(function (t) { return t.closed_at && String(t.closed_at).slice(0, 10) === today; }).length;
    var att = state.transfers.filter(function (t) { return ['REQUESTED','APPROVED','READY_TO_LOAD','LOADED','IN_TRANSIT','ARRIVED','DISCREPANCY','RESOLUTION_PENDING'].indexOf(t.status) >= 0; }).slice(0, 15);
    root.innerHTML = head('Stock Transfer', 'Control Tower des mouvements inter-sites. Reservation != mouvement physique; Arrival != Receipt.', can('transfer_request') ? '<a class="btn primary ops-cta-create" href="#requests/new">+ New Transfer Request</a>' : '') +
      '<div class="kpi-grid">' +
        kpi('Pending approval', count(['REQUESTED']), '#requests', count(['REQUESTED']) ? 'attn' : '') +
        kpi('Ready / Loaded', count(['APPROVED','READY_TO_LOAD','LOADED']), '#ready', '') +
        kpi('In Transit', count(['IN_TRANSIT']), '#transit', count(['IN_TRANSIT']) ? 'attn' : '') +
        kpi('Arrival pending', count(['ARRIVED']), '#arrivals', count(['ARRIVED']) ? 'attn' : '') +
        kpi('Discrepancy', count(['DISCREPANCY','RESOLUTION_PENDING']), '#reconciliation', count(['DISCREPANCY','RESOLUTION_PENDING']) ? 'danger' : '') +
      '</div>' +
      '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Actions requiring attention</h2><p>Dossiers ouverts tries par recence.</p></div></div>' +
      table(['Transfer','Origin','Destination','Planned','Sent','Received','Variance','Truck','Status'], att.map(function (t) { return rowTransfer(t, routeForStatus(t.status)); })) +
      '</section><section class="card"><h2>Regles de stock</h2><div style="margin-top:12px">' +
      notice('ok','<b>Dispatch:</b>&nbsp; seule etape qui debite physiquement la source et credite IN TRANSIT.') +
      notice('info','<b>Receipt:</b>&nbsp; seule etape qui credite la destination.') +
      '<div class="ops-def-grid"><div><small>Closed today</small><b>' + closedToday + '</b></div><div><small>Role</small><b>' + esc(state.permissions.role || '-') + '</b></div><div><small>Warehouse scope</small><b>' + esc(state.permissions.warehouse_scope || 'Global') + '</b></div></div></div></section></div>';
  }
  function routeForStatus(s) {
    if (s === 'REQUESTED' || s === 'REJECTED' || s === 'CANCELLED') return 'requests';
    if (s === 'APPROVED' || s === 'READY_TO_LOAD' || s === 'LOADED') return 'ready';
    if (s === 'IN_TRANSIT') return 'transit';
    if (s === 'ARRIVED') return 'arrivals';
    return 'reconciliation';
  }

  function requestsList() {
    var a = state.transfers.filter(function (t) { return ['REQUESTED','REJECTED','CANCELLED'].indexOf(t.status) >= 0; });
    root.innerHTML = head('Transfer Requests','Creer, approuver ou refuser une demande sans mouvement de stock.', can('transfer_request') ? '<a class="btn primary ops-cta-create" href="#requests/new">+ New Transfer Request</a>' : '') +
      notice('ok','<b>Controle:</b>&nbsp; REQUESTED ne modifie ni Physical Stock ni Reserved Stock.') +
      '<section class="card">' + table(['Transfer','Origin','Destination','Planned','Sent','Received','Variance','Truck','Status'], a.map(function (t) { return rowTransfer(t, 'requests'); })) + '</section>';
  }

  async function requestNew() {
    if (!can('transfer_request')) { root.innerHTML = head('New Transfer Request','') + notice('danger','Permission transfer_request requise.'); return; }
    await loadStock();
    var whOpts = [['','Selectionner...']].concat(state.warehouses.map(function (w) { return [w.id, w.code + ' - ' + w.name + (w.is_factory ? ' [Factory]' : '')]; }));
    var stockOpts = state.stock.map(function (s) { return [s.bin_id + '||' + s.lot_id, s.warehouse_code + ' / ' + s.bin_id + ' / ' + s.lot_id + ' / available ' + kg(s.available_kg)]; });
    root.innerHTML = head('New Transfer Request','Selectionner une origine, une destination et les lignes BIN/Lot. Aucun stock ne bouge a cette etape.', '<a class="btn secondary" href="#requests">Retour</a>') +
      '<form id="trfCreate" class="ops-form-card" data-action="create-request"><div class="ops-form-grid">' +
      selectField('Origin Warehouse','origin_warehouse_id',whOpts,'','required') + selectField('Destination Warehouse','dest_warehouse_id',whOpts,'','required') +
      field('Purpose','purpose','text','','required') + selectField('Priority','priority',[['NORMAL','Normal'],['LOW','Low'],['HIGH','High'],['URGENT','Urgent']],'NORMAL') +
      field('Planned Dispatch','planned_dispatch_at','datetime-local','') + field('Request Document','request_doc_ref','text','') +
      field('Request Note','request_note','text','') + '</div>' +
      '<div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Material lines</h3><p>Chaque ligne conserve BIN + Lot + quantite.</p></div><button type="button" class="btn secondary" id="addTrfLine">+ Ajouter ligne</button></div>' +
      '<div id="trfLines" data-stock-options="' + esc(JSON.stringify(stockOpts)) + '"></div></div>' +
      '<div class="ops-actions" style="margin-top:14px"><button class="btn primary" type="submit">Create Request</button></div></form>';
    addLineRow(stockOpts);
  }
  function addLineRow(stockOpts) {
    var box = document.getElementById('trfLines'); if (!box) return;
    var i = box.children.length + 1;
    var opts = [['','Selectionner BIN / Lot...']].concat(stockOpts);
    var row = document.createElement('div'); row.className = 'ops-form-grid trf-line'; row.style.marginBottom = '10px';
    row.innerHTML = selectField('BIN / Lot','stock_ref',opts,'','required') + field('Qty kg','qty','number','','required step="0.001" min="0.001"') +
      '<div class="ops-field"><label>Action</label><button type="button" class="btn secondary trf-remove-line">Retirer ligne ' + i + '</button></div>';
    box.appendChild(row);
  }

  async function detail(id, context) {
    var t = transferById(id);
    if (!t) {
      var rows = await query('wms_v_transfers','*',function(q){return q.eq('id',id).limit(1);}); t = rows[0];
      if (!t) { root.innerHTML = head('Transfer','') + notice('danger','Transfert introuvable.'); return; }
    }
    var lines = await query('wms_v_transfer_lines','*',function(q){return q.eq('transfer_id',id).order('line_no');});
    var actions = '<a class="btn secondary" href="#' + esc(context) + '">Retour</a>';
    root.innerHTML = head(t.id, (t.origin_code || '-') + ' -> ' + (t.dest_code || '-') + ' | ' + (t.purpose || ''), actions) +
      '<div class="ops-def-grid"><div><small>Status</small><b>' + badge(t.status) + '</b></div><div><small>Planned</small><b>' + mt(t.planned_qty) + '</b></div>' +
      '<div><small>Reserved</small><b>' + mt(t.reserved_qty) + '</b></div><div><small>Dispatched</small><b>' + (t.dispatched_qty == null ? '-' : mt(t.dispatched_qty)) + '</b></div>' +
      '<div><small>Received</small><b>' + (t.received_qty == null ? '-' : mt(t.received_qty)) + '</b></div><div><small>Variance</small><b>' + (t.variance_kg == null ? '-' : kg(t.variance_kg)) + '</b></div></div>' +
      '<section class="card" style="margin-top:14px"><h2>Genealogie matiere</h2><div style="margin-top:12px">' +
      table(['#','Source BIN','Lot','Supplier','Origin','Available at request','Requested','Reserved','Dispatched','Received'], lines.map(function(l){return '<tr><td>'+l.line_no+'</td><td class="mono">'+esc(l.source_bin_id)+'</td><td class="mono">'+esc(l.lot_id)+'</td><td>'+esc(l.supplier_name||'-')+'</td><td>'+esc(l.lot_origin||'-')+'</td><td>'+kg(l.available_at_request)+'</td><td>'+kg(l.requested_qty)+'</td><td>'+kg(l.reserved_qty)+'</td><td>'+kg(l.dispatched_qty)+'</td><td>'+kg(l.received_qty)+'</td></tr>';})) + '</div></section>' +
      '<section class="card"><h2>Timeline</h2><div style="margin-top:12px">' + timeline(t) + '</div></section>' +
      actionPanel(t, context);
  }

  function actionPanel(t, context) {
    var html = '';
    if (context === 'requests' && t.status === 'REQUESTED') {
      html += '<section class="card"><h2>Decision</h2><div class="ops-form-grid" style="margin-top:12px">' + field('Comment / Reason','comment','text','') + '</div><div class="ops-actions" style="margin-top:12px">' +
        (can('transfer_approve') ? '<button class="btn primary" data-action-button="approve" data-id="'+esc(t.id)+'">Approve + Reserve</button>' : '') +
        (can('transfer_approve') ? '<button class="btn signal" data-action-button="reject" data-id="'+esc(t.id)+'">Reject</button>' : '') +
        (can('transfer_cancel') ? '<button class="btn secondary" data-action-button="cancel" data-id="'+esc(t.id)+'">Cancel</button>' : '') + '</div></section>';
    }
    if (context === 'ready' && ['APPROVED','READY_TO_LOAD','LOADED'].indexOf(t.status) >= 0) {
      html += '<form class="card" data-action="save-load" data-id="'+esc(t.id)+'"><h2>Loading</h2><div class="ops-form-grid" style="margin-top:12px">' +
        field('Truck Plate','truck_plate','text',t.truck_plate||'','required') + field('Transporter','transporter','text',t.transporter||'','required') + field('Driver Name','driver_name','text',t.driver_name||'','required') +
        field('Driver Phone','driver_phone','text',t.driver_phone||'') + field('Seal Number','seal_no','text',t.seal_no||'') + field('Bags Loaded','bags_loaded','number',t.bags_loaded||'','min="0"') +
        field('Gross kg','gross_kg','number',t.gross_kg||'','step="0.001"') + field('Tare kg','tare_kg','number',t.tare_kg||'','step="0.001"') + field('Net kg','net_kg','number',t.net_kg||'','step="0.001"') +
        field('Weighbridge Ref','weighbridge_ref','text',t.weighbridge_ref||'') + field('Load Document','load_doc_ref','text',t.load_doc_ref||'') + field('Difference reason','load_diff_reason','text',t.load_diff_reason||'') +
        field('Loading Start','loading_start','datetime-local','') + field('Loading End','loading_end','datetime-local','') + field('Notes','load_notes','text',t.load_notes||'') + '</div>' +
        '<div class="ops-actions" style="margin-top:12px"><button class="btn secondary" name="mode" value="save">Save Load</button><button class="btn primary" name="mode" value="confirm">Confirm Loaded</button>' +
        (t.status === 'LOADED' && can('transfer_dispatch') ? '<button type="button" class="btn signal" data-action-button="dispatch" data-id="'+esc(t.id)+'">Confirm Dispatch</button>' : '') + '</div></form>';
    }
    if (context === 'transit' && t.status === 'IN_TRANSIT' && can('transfer_arrival')) {
      html += '<form class="card" data-action="arrival" data-id="'+esc(t.id)+'"><h2>Register Arrival</h2><div class="ops-form-grid" style="margin-top:12px">' +
        field('Receiver','receiver','text','','required') + field('Truck observed','truck','text',t.truck_plate||'') + selectField('Seal Status','seal_status',[['','Auto'],['INTACT','Intact'],['BROKEN','Broken'],['MISMATCH','Mismatch'],['NOT_APPLICABLE','Not applicable']],'') +
        field('Seal observed','seal_observed','text','') + field('Gate Reference','gate_ref','text','') + field('Comment','comment','text','') + '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Register Arrival</button></div></form>';
    }
    if (context === 'arrivals' && t.status === 'ARRIVED' && can('transfer_receive')) {
      var bins = state._destBins || [];
      var bop = [['','Selectionner...']].concat(bins.filter(function(b){return String(b.warehouse_id)===String(t.dest_warehouse_id)&&['CLOSED','BLOCKED'].indexOf(b.status)<0;}).map(function(b){return[b.id,b.id+' ['+b.stock_type+']'];}));
      html += '<form class="card" data-action="receipt" data-id="'+esc(t.id)+'"><h2>Confirm Receipt</h2><div class="ops-form-grid" style="margin-top:12px">' +
        field('Gross kg','gross_kg','number','','step="0.001"') + field('Tare kg','tare_kg','number','','step="0.001"') + field('Net kg','net_kg','number','','required step="0.001" min="0.001"') +
        field('Bags Received','bags_received','number','','min="0"') + field('Ticket','ticket','text','') + field('Quality Ref','quality_ref','text','') +
        selectField('Destination Type','dest_type',[['BIN','BIN'],['STAGING','Controlled Staging']],'BIN','required') + selectField('Destination BIN','dest_bin_id',bop,'') + field('Note','note','text','') +
        '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Confirm Receipt</button></div></form>';
    }
    if (context === 'reconciliation' && t.status === 'DISCREPANCY' && can('transfer_resolve')) {
      var cats = (state.settings.reasonCategories || []).map(function(x){return[x,x.replace(/_/g,' ')];});
      html += '<form class="card" data-action="resolve" data-id="'+esc(t.id)+'"><h2>Resolve Discrepancy</h2><div class="ops-form-grid" style="margin-top:12px">' +
        selectField('Reason Category','category',[['','Selectionner...']].concat(cats),'','required') + field('Detailed Reason','detailed_reason','text','','required') + field('Responsible','responsible','text','','required') +
        field('Investigation','investigation','text','') + field('Evidence Ref','evidence_ref','text','') + field('Resolution','resolution','text','','required') +
        selectField('Resolution Type','resolution_type',[['REWEIGH_CORRECTION','Reweigh correction'],['STOCK_GAIN','Stock gain'],['COMPENSATION','Compensation'],['WRITE_OFF','Write off']],'REWEIGH_CORRECTION') +
        '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Submit Resolution</button></div></form>';
    }
    if (context === 'reconciliation' && t.status === 'RESOLUTION_PENDING' && can('transfer_resolve_approve')) {
      html += '<section class="card"><h2>Resolution Approval</h2><div class="ops-form-grid" style="margin-top:12px">' + field('Approval Comment','resolution_comment','text','') + '</div><div class="ops-actions" style="margin-top:12px">' +
        '<button class="btn primary" data-action-button="resolution-approve" data-id="'+esc(t.id)+'">Approve Resolution</button>' +
        '<button class="btn signal" data-action-button="resolution-reject" data-id="'+esc(t.id)+'">Reject Resolution</button></div></section>';
    }
    if (context === 'reconciliation' && t.status === 'RECONCILED' && can('transfer_close')) {
      html += '<form class="card" data-action="close" data-id="'+esc(t.id)+'"><h2>Close Transfer</h2><div class="ops-form-grid" style="margin-top:12px">'+field('Close Note','note','text','')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Close & Lock</button></div></form>';
    }
    return html;
  }

  function listRoute(route) {
    var cfg = {
      requests: [['REQUESTED','REJECTED','CANCELLED'],'Transfer Requests','Demandes de transfert et decisions.'],
      ready: [['APPROVED','READY_TO_LOAD','LOADED'],'Ready to Load','Reservation, chargement et Confirm Dispatch.'],
      transit: [['IN_TRANSIT'],'In Transit','Matiere sortie de la source, non encore creditee a destination.'],
      arrivals: [['ARRIVED'],'Arrivals','Arrival enregistre; Receipt reste une operation distincte.'],
      reconciliation: [['DISCREPANCY','RESOLUTION_PENDING','RECONCILED','CLOSED'],'Reconciliation','Ecarts, resolutions et cloture verrouillee.']
    }[route];
    var a = state.transfers.filter(function(t){return cfg[0].indexOf(t.status)>=0;});
    root.innerHTML = head(cfg[1],cfg[2], route==='requests'&&can('transfer_request')?'<a class="btn primary ops-cta-create" href="#requests/new">+ New Transfer Request</a>':'') +
      '<section class="card">'+table(['Transfer','Origin','Destination','Planned','Sent','Received','Variance','Truck','Status'],a.map(function(t){return rowTransfer(t,route);}))+'</section>';
  }

  async function auditRoute() {
    var rows = await query('wms_v_transfer_audit','*',function(q){return q.order('created_at',{ascending:false}).limit(300);});
    root.innerHTML = head('Audit','Journal append-only des operations Stock Transfer.') + '<section class="card">' +
      table(['Date','Transfer','Action','Reason','Author','Role','Approver'], rows.map(function(a){return '<tr><td>'+esc(dt(a.created_at))+'</td><td class="mono">'+esc(a.transfer_id||'-')+'</td><td>'+esc(a.action||'-')+'</td><td>'+esc(a.motif||'-')+'</td><td>'+esc(a.auteur||'-')+'</td><td>'+esc(a.role||'-')+'</td><td>'+esc(a.approbateur||'-')+'</td></tr>';})) + '</section>';
  }

  async function render() {
    if (!root || !sb) return;
    root.innerHTML = '<div class="empty">Chargement...</div>';
    await loadBase();
    state._destBins = await query('wms_bins','id,warehouse_id,stock_type,status,capacity_kg',function(q){return q.order('id').limit(500);});
    var p = routeParts();
    if (p.route === 'overview') return overview();
    if (p.route === 'audit') return auditRoute();
    if (p.route === 'requests' && p.id === 'new') return requestNew();
    if (['requests','ready','transit','arrivals','reconciliation'].indexOf(p.route)>=0 && p.id) return detail(decodeURIComponent(p.id),p.route);
    if (['requests','ready','transit','arrivals','reconciliation'].indexOf(p.route)>=0) return listRoute(p.route);
    overview();
  }

  async function doRpc(action, id, args, keyAction) {
    var key = opKey(keyAction || action, id);
    try { var r = await rpc(action, Object.assign({}, args || {}, { p_idempotency_key: key.key })); doneKey(key); return r; }
    catch (e) { throw e; }
  }

  async function handleSubmit(ev) {
    var form = ev.target.closest('form[data-action]'); if (!form) return;
    ev.preventDefault();
    var d=formObj(form), submitter=ev.submitter, act=form.dataset.action, id=form.dataset.id, r;
    setBusy(form,true);
    try {
      if (act==='create-request') {
        var lines=[]; form.querySelectorAll('.trf-line').forEach(function(row){
          var ref=row.querySelector('[name="stock_ref"]').value.split('||'); var qty=row.querySelector('[name="qty"]').value;
          if(ref[0]&&ref[1]&&qty) lines.push({bin_id:ref[0],lot_id:ref[1],qty:Number(qty)});
        });
        var payload={origin_warehouse_id:d.origin_warehouse_id,dest_warehouse_id:d.dest_warehouse_id,purpose:d.purpose,priority:d.priority,planned_dispatch_at:d.planned_dispatch_at||null,request_doc_ref:d.request_doc_ref||null,request_note:d.request_note||null,lines:lines};
        var k=opKey('REQUEST','NEW'); r=await rpc('wms_trf_create_request',{p:payload,p_idempotency_key:k.key}); doneKey(k); location.hash='#requests/'+encodeURIComponent(r.id); return;
      }
      if (act==='save-load') {
        var submitMode=submitter && submitter.value; var confirm=submitMode==='confirm';
        var p={truck_plate:d.truck_plate,transporter:d.transporter,driver_name:d.driver_name,driver_phone:d.driver_phone,seal_no:d.seal_no,bags_loaded:d.bags_loaded||null,gross_kg:d.gross_kg||null,tare_kg:d.tare_kg||null,net_kg:d.net_kg||null,weighbridge_ref:d.weighbridge_ref,load_doc_ref:d.load_doc_ref,load_diff_reason:d.load_diff_reason,loading_start:d.loading_start||null,loading_end:d.loading_end||null,load_notes:d.load_notes};
        var kk=opKey(confirm?'LOAD_CONFIRM':'LOAD_SAVE',id); await rpc('wms_trf_save_load',{p_id:id,p:p,p_confirm:confirm,p_idempotency_key:kk.key}); doneKey(kk); await render(); return;
      }
      if (act==='arrival') { await doRpc('wms_trf_register_arrival',id,{p_id:id,p:{warehouse_id:transferById(id).dest_warehouse_id,receiver:d.receiver,truck:d.truck,seal_status:d.seal_status,seal_observed:d.seal_observed,gate_ref:d.gate_ref,comment:d.comment}},'ARRIVAL'); await render(); return; }
      if (act==='receipt') { await doRpc('wms_trf_confirm_receipt',id,{p_id:id,p:{gross_kg:d.gross_kg||null,tare_kg:d.tare_kg||null,net_kg:d.net_kg,bags_received:d.bags_received||null,ticket:d.ticket,quality_ref:d.quality_ref,dest_type:d.dest_type,dest_bin_id:d.dest_bin_id,note:d.note}},'RECEIPT'); await render(); return; }
      if (act==='resolve') { await doRpc('wms_trf_resolve_discrepancy',id,{p_id:id,p:{category:d.category,detailed_reason:d.detailed_reason,responsible:d.responsible,investigation:d.investigation,evidence_ref:d.evidence_ref,resolution:d.resolution,resolution_type:d.resolution_type}},'RESOLVE'); await render(); return; }
      if (act==='close') { await doRpc('wms_trf_close',id,{p_id:id,p_note:d.note},'CLOSE'); await render(); return; }
    } catch(e) { errorBox(e); } finally { setBusy(form,false); }
  }

  async function handleClick(ev) {
    var row=ev.target.closest('[data-href]'); if(row){location.hash=row.dataset.href; return;}
    if(ev.target.id==='addTrfLine'){ var box=document.getElementById('trfLines'); var opts=JSON.parse(box.dataset.stockOptions||'[]'); addLineRow(opts); return; }
    var rm=ev.target.closest('.trf-remove-line'); if(rm){ var rr=rm.closest('.trf-line'); if(rr&&rr.parentNode.children.length>1) rr.remove(); return; }
    var b=ev.target.closest('[data-action-button]'); if(!b)return;
    var action=b.dataset.actionButton,id=b.dataset.id; b.disabled=true;
    try{
      if(action==='approve'){var c=document.querySelector('[name="comment"]');await doRpc('wms_trf_approve',id,{p_id:id,p_comment:c?c.value:''},'APPROVE');}
      if(action==='reject'){var r=document.querySelector('[name="comment"]');if(!r||!r.value.trim())throw new Error('Motif obligatoire pour Reject.');await doRpc('wms_trf_reject',id,{p_id:id,p_reason:r.value},'REJECT');}
      if(action==='cancel'){var x=document.querySelector('[name="comment"]');if(!x||!x.value.trim())throw new Error('Motif obligatoire pour Cancel.');await doRpc('wms_trf_cancel',id,{p_id:id,p_reason:x.value},'CANCEL');}
      if(action==='dispatch'){await doRpc('wms_trf_confirm_dispatch',id,{p_id:id},'DISPATCH');}
      if(action==='resolution-approve'){var ac=document.querySelector('[name="resolution_comment"]');await doRpc('wms_trf_decide_resolution',id,{p_id:id,p_approve:true,p_comment:ac?ac.value:''},'RESOLVE_DECISION');}
      if(action==='resolution-reject'){var rc=document.querySelector('[name="resolution_comment"]');if(!rc||!rc.value.trim())throw new Error('Commentaire obligatoire pour refuser une resolution.');await doRpc('wms_trf_decide_resolution',id,{p_id:id,p_approve:false,p_comment:rc.value},'RESOLVE_DECISION');}
      await render();
    }catch(e){errorBox(e);}finally{b.disabled=false;}
  }

  async function init() {
    root=document.getElementById('opsRouteView');
    sb=await waitClient();
    if(!sb){ if(root)root.innerHTML=notice('danger','Connexion Supabase indisponible.'); return; }
    root.addEventListener('submit',handleSubmit);
    root.addEventListener('click',handleClick);
    global.ANAGROCI_OPS_ROUTE=function(){render().catch(errorBox);};
    await render();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){init().catch(errorBox);});
  else init().catch(errorBox);
})(window);
