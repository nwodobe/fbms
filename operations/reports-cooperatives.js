/* REPORTS & EXPORT · Coopératives AFLP — pilotage par canal (Direct RT / Coopérative).
   Lecture seule : aflp_coop_dashboard (agrégats sans données personnelles), aflp_channel_totals,
   aflp_coop_delivery_status_v, aflp_lot_origin_v, aflp_coop_members_v (si le rôle y a accès). */
(function (g) {
'use strict';
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
function num(v, d) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d == null ? 0 : d }).format(n(v)); }
var sb = null;
function client() { if (sb) return Promise.resolve(sb); return new Promise(function (res) { var k = 0, t = setInterval(function () { k++; if (g.supabase && g.ANAGROCI_SUPABASE_URL && g.ANAGROCI_SUPABASE_ANON) { clearInterval(t); sb = g.supabase.createClient(g.ANAGROCI_SUPABASE_URL, g.ANAGROCI_SUPABASE_ANON); res(sb); } else if (k > 120) { clearInterval(t); res(null); } }, 80); }); }
var F = { campaign: '2027', channel: '', coop: '', zone: '', cluster: '', status: '' }, ROWS = [], TOT = {};
var ST = { PROSPECT: 'Prospect', EN_EVALUATION: 'En évaluation', A_COMPLETER: 'À compléter', APPROUVEE: 'Approuvée', ACTIVE: 'Active', SUSPENDUE: 'Suspendue', SORTIE: 'Sortie du programme' };
function filtered() {
  return ROWS.filter(function (r) { return !r.is_qa && !r.archived && (!F.coop || r.cooperative_id === F.coop) && (!F.zone || r.zone_code === F.zone) && (!F.cluster || r.cluster_code === F.cluster) && (!F.status || r.aflp_status === F.status); });
}
function draw() {
  var box = document.getElementById('coopReport'); if (!box) return;
  var rows = filtered(), t = { prod: 0, ver: 0, pot: 0, potF: 0, tgt: 0, buy: 0, area: 0, wom: 0, cons: 0, toAlloc: 0 };
  rows.forEach(function (r) { t.prod += n(r.producers_primary); t.ver += n(r.producers_verified); t.pot += n(r.declared_potential_mt); t.potF += n(r.farmer_potential_kg); t.tgt += n(r.target_mt); t.buy += n(r.purchased_kg); t.area += n(r.area_ha); t.wom += n(r.women); t.cons += n(r.consent_granted); t.toAlloc += n(r.deliveries_to_allocate); });
  function sel(k, lab, list) { return '<label style="display:flex;flex-direction:column;gap:4px;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase">' + lab + '<select data-rf="' + k + '" style="min-height:38px;border:1px solid var(--line);border-radius:9px;padding:6px 8px">' + '<option value="">Tous</option>' + list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (F[k] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'; }
  function uniq(key) { var s = {}; ROWS.forEach(function (r) { if (r[key]) s[r[key]] = 1; }); return Object.keys(s).sort().map(function (x) { return [x, x]; }); }
  var showCoop = F.channel !== 'AFLP_DIRECT';
  box.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px">' +
    sel('channel', 'Canal', [['AFLP_DIRECT', 'Direct RT'], ['COOPERATIVE', 'Coopératives']]) + sel('coop', 'Coopérative', ROWS.filter(function (r) { return !r.is_qa && !r.archived; }).map(function (r) { return [r.cooperative_id, r.code + ' · ' + r.name]; })) +
    sel('zone', 'Zone', uniq('zone_code')) + sel('cluster', 'Cluster', uniq('cluster_code')) + sel('status', 'Statut', Object.keys(ST).map(function (k) { return [k, ST[k]]; })) + '</div>' +
    '<section class="kpi-grid">' +
      '<div class="kpi"><small>Producteurs AFLP</small><b>' + num(TOT.producteurs_total) + '</b><span>Direct RT ' + num(TOT.direct_rt) + ' · Coop ' + num(TOT.cooperatives) + '</span></div>' +
      (showCoop ? '<div class="kpi"><small>Coopératives</small><b>' + num(rows.length) + '</b><span>' + num(rows.filter(function (r) { return r.aflp_status === 'ACTIVE'; }).length) + ' active(s)</span></div>' +
      '<div class="kpi"><small>Producteurs / coop.</small><b>' + (rows.length ? num(t.prod / rows.length, 0) : '—') + '</b><span>' + num(t.ver) + ' vérifiés</span></div>' +
      '<div class="kpi"><small>Potentiel</small><b>' + num(t.pot, 0) + ' MT</b><span>calculé producteurs ' + num(t.potF / 1000, 0) + ' MT</span></div>' +
      '<div class="kpi"><small>Target / Acheté</small><b>' + num(t.buy / 1000, 1) + ' / ' + num(t.tgt, 0) + ' MT</b><span>' + (t.tgt ? num(t.buy / 10 / t.tgt, 1) + ' % réalisés' : 'sans target') + '</span></div>' +
      '<div class="kpi"><small>Volume / producteur</small><b>' + (t.prod ? num(t.buy / t.prod, 0) + ' kg' : '—') + '</b><span>superficie ' + num(t.area, 0) + ' ha</span></div>' +
      '<div class="kpi' + (t.toAlloc ? ' warn' : '') + '"><small>Livraisons à répartir</small><b>' + num(t.toAlloc) + '</b><span>non traçables producteur</span></div>' : '') +
    '</section>' + (showCoop ? '<div class="table-wrap"><table><thead><tr><th>Code</th><th>Coopérative</th><th>Statut</th><th>Producteurs</th><th>Villages</th><th>Potentiel décl.</th><th>Target</th><th>Acheté</th><th>%</th><th>KOR</th><th>Humidité</th><th>Femmes</th><th>Consentement</th><th>Sacs dus</th></tr></thead><tbody>' +
    (rows.length ? rows.map(function (r) { return '<tr><td class="mono">' + esc(r.code) + '</td><td><a class="ops-link" href="field-buying.html#cooperatives/' + encodeURIComponent(r.cooperative_id) + '/overview">' + esc(r.name) + '</a></td><td>' + esc(ST[r.aflp_status] || r.aflp_status) + '</td><td>' + num(r.producers_registered) + '</td><td>' + num(r.villages_covered) + '</td><td>' + (r.declared_potential_mt != null ? num(r.declared_potential_mt, 1) + ' MT' : 'NON COLLECTÉ') + '</td><td>' + (r.target_mt != null ? num(r.target_mt, 1) + ' MT' : '—') + '</td><td>' + num(n(r.purchased_kg) / 1000, 1) + ' MT</td><td>' + (r.achievement_pct != null ? num(r.achievement_pct, 1) + ' %' : '—') + '</td><td>' + (r.kor_avg != null ? num(r.kor_avg, 2) : '—') + '</td><td>' + (r.moisture_avg != null ? num(r.moisture_avg, 1) : '—') + '</td><td>' + num(r.women) + '</td><td>' + num(r.consent_granted) + '</td><td>' + (r.bags_balance != null ? num(r.bags_balance) : '—') + '</td></tr>'; }).join('')
      : '<tr><td colspan="14" class="muted">Aucune coopérative pour ces filtres.</td></tr>') + '</tbody></table></div>' : '<div class="notice info">Canal Direct RT : détail par village, RT et producteur dans AFLP DATA.</div>');
  box.querySelectorAll('[data-rf]').forEach(function (s) { s.onchange = function () { F[s.getAttribute('data-rf')] = s.value; draw(); }; });
}
function load() {
  return client().then(function (c) {
    if (!c) throw new Error('Connexion indisponible');
    return Promise.all([c.rpc('aflp_coop_dashboard', { p_campaign: F.campaign }), c.rpc('aflp_channel_totals', { p_campaign: F.campaign, p_include_qa: false })]);
  }).then(function (rs) { if (rs[0].error) throw rs[0].error; ROWS = rs[0].data || []; TOT = (rs[1] && rs[1].data) || {}; draw(); })
    .catch(function (e) { var b = document.getElementById('coopReport'); if (b) b.innerHTML = '<div class="notice danger">' + esc(e && e.message ? e.message : e) + '</div>'; });
}
function exportCoops() {
  var st = document.getElementById('coopExportStatus'); if (st) st.textContent = 'Préparation…';
  client().then(function (c) {
    return Promise.all([c.from('aflp_coop_delivery_status_v').select('*').limit(10000), c.from('aflp_lot_origin_v').select('*').limit(10000),
      c.from('aflp_coop_members_v').select('cooperative_id,farmer_id,nom,prenoms,village_nom,member_number,section_name,status,is_primary,verified,area_ha,potential_kg,potential_source,passport_stage,consent_status').limit(20000)]);
  }).then(function (rs) {
    var ids = {}; filtered().forEach(function (r) { ids[r.cooperative_id] = r.code; });
    var wb = g.XLSX.utils.book_new();
    function add(name, rows) { var ws = g.XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: 'Aucune donnée pour les filtres sélectionnés' }]); g.XLSX.utils.book_append_sheet(wb, ws, name); }
    add('Metadata', [{ campagne: F.campaign, genere_le: new Date().toISOString(), filtres: JSON.stringify(F), source: 'ANAGROCI Operations Suite · AFLP Coopératives', regle: 'Producteur compté une fois (affiliation principale). Données non collectées laissées vides.' }]);
    add('Canaux', [{ producteurs_total: TOT.producteurs_total, direct_rt: TOT.direct_rt, cooperatives: TOT.cooperatives, cooperatives_avec_rt_suivi: TOT.cooperatives_avec_rt_suivi }]);
    add('Cooperatives', filtered().map(function (r) { var o = Object.assign({}, r); delete o.cooperative_id; return o; }));
    add('Livraisons', (rs[0].data || []).filter(function (d) { return ids[d.cooperative_id]; }).map(function (d) { return { livraison: d.code, cooperative: d.cooperative_code, statut: d.status, prevu_kg: d.planned_kg, livre_kg: d.delivered_kg, alloue_kg: d.allocated_kg, repartition: d.allocation_status, tracable: d.fully_traceable, arrivage: d.arrival_id, reception: d.reception_id_resolved, entrepot: d.warehouse_code }; }));
    add('Origine des lots', (rs[1].data || []).filter(function (l) { return l.cooperative_codes || F.channel !== 'COOPERATIVE'; }));
    add('Membres', (rs[2].error ? [] : (rs[2].data || [])).filter(function (m) { return ids[m.cooperative_id]; }).map(function (m) { var o = Object.assign({ cooperative: ids[m.cooperative_id] }, m); delete o.cooperative_id; return o; }));
    g.XLSX.writeFile(wb, 'AFLP_Cooperatives_' + F.campaign + '_' + new Date().toISOString().slice(0, 10) + '.xlsx', { compression: true });
    if (st) st.textContent = 'Classeur généré.';
  }).catch(function (e) { if (st) st.textContent = 'Échec : ' + (e && e.message ? e.message : e); });
}
g.ANAGROCI_COOP_REPORT = { exportCoops: exportCoops, reload: load };
function init() { if (document.getElementById('coopReport')) load(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
