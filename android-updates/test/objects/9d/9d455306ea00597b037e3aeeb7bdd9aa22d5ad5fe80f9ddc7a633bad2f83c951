/* REPORTS & EXPORT · Coopératives AFLP — pilotage par canal (Direct RT / Coopérative).
   Toutes les mesures viennent du serveur (RPC aflp_coop_report) : les filtres se
   combinent côté base, chaque producteur est compté UNE fois (registre unique),
   les données QA sont exclues et une information absente reste « NON COLLECTÉ ».
   Filtres : campagne, canal, coopérative, statut, zone, cluster, village, section,
   producteur, période du / au (achats et livraisons). */
(function (g) {
'use strict';
function lang() { try { return localStorage.getItem('anagroci_lang') === 'en' ? 'en' : 'fr'; } catch (e) { return 'fr'; } }
function T(fr, en) { return lang() === 'en' ? en : fr; }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
function num(v, d) { return new Intl.NumberFormat(lang() === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: d == null ? 0 : d }).format(n(v)); }
function na() { return '<span class="coop-na">' + esc(T('NON COLLECTÉ', 'NOT RECORDED')) + '</span>'; }
var sb = null;
function client() { if (sb) return Promise.resolve(sb); return new Promise(function (res) { var k = 0, t = setInterval(function () { k++; if (g.supabase && g.ANAGROCI_SUPABASE_URL && g.ANAGROCI_SUPABASE_ANON) { clearInterval(t); sb = g.supabase.createClient(g.ANAGROCI_SUPABASE_URL, g.ANAGROCI_SUPABASE_ANON); res(sb); } else if (k > 120) { clearInterval(t); res(null); } }, 80); }); }
var F = { campaign: (window.ANAGROCI_CAMPAIGN && window.ANAGROCI_CAMPAIGN.code()) || '', channel: '', coop: '', coop_status: '', zone: '', cluster: '', village_id: '', section_id: '', producer: '', date_from: '', date_to: '' };
var REF = null, R = null, SECTIONS = [];
var ST = { PROSPECT: ['Prospect', 'Prospect'], EN_EVALUATION: ['En évaluation', 'Under review'], A_COMPLETER: ['À compléter', 'To complete'], APPROUVEE: ['Approuvée', 'Approved'], ACTIVE: ['Active', 'Active'], SUSPENDUE: ['Suspendue', 'Suspended'], SORTIE: ['Sortie du programme', 'Exited programme'] };
function st(k) { return ST[k] ? T(ST[k][0], ST[k][1]) : (k || '—'); }
function payload() { var p = {}; Object.keys(F).forEach(function (k) { if (F[k]) p[k] = F[k]; }); return p; }

function refs(c) {
  if (REF) return Promise.resolve(REF);
  function get(t, cols, mod) { var r = c.from(t).select(cols); if (mod) r = mod(r); return r.then(function (x) { return x.error ? [] : (x.data || []); }); }
  return Promise.all([get('aflp_zones', 'code,label,active'), get('aflp_clusters', 'code,label,zone_code,active'),
    get('villages_light_v', 'id,village,cluster_code,deleted', function (r) { return r.limit(3000); }),
    get('aflp_cooperatives', 'id,code,name,is_qa,archived', function (r) { return r.order('code'); })]).then(function (rs) {
    REF = { zones: rs[0].filter(function (z) { return z.active !== false; }), clusters: rs[1].filter(function (x) { return x.active !== false; }),
      villages: rs[2].filter(function (v) { return !v.deleted; }).sort(function (a, b) { return String(a.village).localeCompare(String(b.village)); }),
      coops: rs[3].filter(function (x) { return !x.is_qa && !x.archived; }) };
    return REF;
  });
}
function sections(c) {
  if (!F.coop) { SECTIONS = []; return Promise.resolve(); }
  return c.from('aflp_coop_sections').select('id,name,active').eq('cooperative_id', F.coop).order('name').then(function (x) { SECTIONS = (x.data || []).filter(function (s) { return s.active; }); });
}
function filterBar() {
  function sel(k, lab, list, all) {
    return '<label>' + esc(lab) + '<select data-rf="' + k + '">' + (all === false ? '' : '<option value="">' + esc(T('Tous', 'All')) + '</option>') +
      list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (F[k] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  }
  var cl = REF.clusters.filter(function (x) { return !F.zone || x.zone_code === F.zone; });
  var clCodes = {}; cl.forEach(function (x) { clCodes[x.code] = 1; });
  var vil = REF.villages.filter(function (v) { return F.cluster ? v.cluster_code === F.cluster : (!F.zone || clCodes[v.cluster_code]); });
  return '<div class="coop-filters coop-report-filters" style="margin-bottom:12px">' +
    sel('campaign', T('Campagne', 'Campaign'), (window.ANAGROCI_CAMPAIGN ? window.ANAGROCI_CAMPAIGN.list() : []).map(function (c) { return [c.code, c.code + ' · ' + (c.name || '')]; }), false) +
    sel('channel', T('Canal', 'Channel'), [['AFLP_DIRECT', T('Direct AFLP (RT)', 'Direct AFLP (RT)')], ['COOPERATIVE', T('Coopératives', 'Cooperatives')]]) +
    sel('coop', T('Coopérative', 'Cooperative'), REF.coops.map(function (r) { return [r.id, r.code + ' · ' + r.name]; })) +
    sel('coop_status', T('Statut coopérative', 'Cooperative status'), Object.keys(ST).map(function (k) { return [k, st(k)]; })) +
    sel('zone', T('Zone', 'Zone'), REF.zones.map(function (z) { return [z.code, z.label || z.code]; })) +
    sel('cluster', T('Cluster', 'Cluster'), cl.map(function (x) { return [x.code, x.label || x.code]; })) +
    sel('village_id', T('Village', 'Village'), vil.map(function (v) { return [v.id, v.village]; })) +
    sel('section_id', T('Section', 'Section'), SECTIONS.map(function (s) { return [s.id, s.name]; })) +
    '<label>' + esc(T('Producteur', 'Farmer')) + '<input type="search" data-rf="producer" value="' + esc(F.producer) + '" placeholder="' + esc(T('Farmer ID ou nom', 'Farmer ID or name')) + '"></label>' +
    '<label>' + esc(T('Période du', 'Period from')) + '<input type="date" data-rf="date_from" value="' + esc(F.date_from) + '"></label>' +
    '<label>' + esc(T('au', 'to')) + '<input type="date" data-rf="date_to" value="' + esc(F.date_to) + '"></label>' +
    '<label>&nbsp;<button class="btn secondary" type="button" id="rfReset">' + esc(T('Réinitialiser', 'Reset')) + '</button></label></div>';
}
function kpi(label, value, sub, tone) { return '<div class="kpi' + (tone ? ' ' + tone : '') + '"><small>' + esc(label) + '</small><b>' + value + '</b><span>' + (sub || '') + '</span></div>'; }
function draw() {
  var box = document.getElementById('coopReport'); if (!box) return;
  box.setAttribute('data-i18n-ignore', '');
  var r = R || {}, p = n(r.producteurs);
  function share(k) { return p ? num(k) + ' / ' + num(p) : na(); }
  var showCoop = F.channel !== 'AFLP_DIRECT';
  var rate = n(r.target_mt) ? (n(r.achats_kg) / 1000 + n(r.livraisons_recues_kg) / 1000) / n(r.target_mt) * 100 : null;
  box.innerHTML = filterBar() +
    (R ? '<p class="muted" style="margin:0 0 8px">' + esc(T('Chaque producteur est compté une fois ; données QA exclues ; filtres combinés côté serveur.', 'Each farmer counted once; QA data excluded; filters combined server-side.')) + '</p>' +
    '<section class="kpi-grid">' +
      kpi(T('Producteurs', 'Farmers'), num(p), T('Direct RT ', 'Direct RT ') + num(r.direct_rt) + ' · ' + T('Coop ', 'Coop ') + num(r.cooperative)) +
      kpi(T('Membres vérifiés', 'Verified members'), num(r.membres_verifies), T('affiliation coopérative vérifiée', 'verified cooperative membership')) +
      kpi(T('Femmes / hommes', 'Women / men'), num(r.femmes) + ' / ' + num(r.hommes), num(r.sexe_non_collecte) + ' ' + T('sexe non collecté', 'sex not recorded')) +
      kpi(T('Jeunes (< 35 ans)', 'Youth (< 35)'), num(r.jeunes_moins_35), num(r.age_non_collecte) + ' ' + T('âge non collecté', 'age not recorded')) + '</section>' +
    '<section class="kpi-grid">' +
      kpi(T('Consentement accordé', 'Consent granted'), share(r.consentement_accorde), num(r.consentement_non_recueilli) + ' ' + T('non recueilli(s)', 'not recorded')) +
      kpi(T('Avec GPS', 'With GPS'), share(r.avec_gps), T('domicile ou parcelle', 'home or plot')) +
      kpi(T('Avec superficie', 'With area'), share(r.avec_superficie), '') +
      kpi(T('Complétude moyenne', 'Average completeness'), r.completude_moyenne == null ? '—' : num(r.completude_moyenne) + ' %', num(r.dossiers_complets) + ' ' + T('dossier(s) complet(s)', 'complete file(s)')) + '</section>' +
    '<section class="kpi-grid">' +
      kpi(T('Achats (mode A)', 'Purchases (mode A)'), num(n(r.achats_kg) / 1000, 1) + ' MT', num(r.achats_nombre) + ' ' + T('achat(s)', 'purchase(s)') + ' · ' + T('canal coop ', 'coop channel ') + num(n(r.achats_kg_canal_coop) / 1000, 1) + ' MT') +
      (showCoop ? kpi(T('Livraisons coop. (mode B)', 'Coop deliveries (mode B)'), num(n(r.livraisons_recues_kg) / 1000, 1) + ' MT', num(r.livraisons) + ' ' + T('livraison(s)', 'delivery(ies)') + ' · ' + num(r.livraisons_tracables) + ' ' + T('traçable(s)', 'traceable')) +
        kpi(T('Livraisons à répartir', 'Deliveries to allocate'), num(r.livraisons_a_repartir), T('non traçables producteur', 'not farmer-traceable'), n(r.livraisons_a_repartir) ? 'warn' : '') +
        kpi(T('Target / réalisation', 'Target / achievement'), r.target_mt == null ? T('non fixée', 'not set') : num(r.target_mt, 0) + ' MT', rate == null ? '' : num(rate, 1) + ' % ' + T('(achats + livraisons reçues)', '(purchases + received deliveries)')) : '') + '</section>' +
    (showCoop ? '<h3 style="margin:14px 0 6px">' + esc(T('Par coopérative', 'By cooperative')) + ' (' + num((r.par_cooperative || []).length) + ')</h3><div class="table-wrap"><table><thead><tr><th>Code</th><th>' + esc(T('Coopérative', 'Cooperative')) + '</th><th>' + esc(T('Statut', 'Status')) + '</th><th>Cluster</th><th>' + esc(T('Producteurs', 'Farmers')) + '</th><th>' + esc(T('Vérifiés', 'Verified')) + '</th><th>' + esc(T('Complétude', 'Completeness')) + '</th><th>' + esc(T('Achats', 'Purchases')) + '</th><th>' + esc(T('Livré', 'Delivered')) + '</th><th>' + esc(T('À répartir', 'To allocate')) + '</th><th>Target</th></tr></thead><tbody>' +
      ((r.par_cooperative || []).length ? r.par_cooperative.map(function (x) {
        return '<tr><td class="mono">' + esc(x.code) + '</td><td><a class="ops-link" href="field-buying.html#cooperatives/' + encodeURIComponent(x.cooperative_id) + '/overview">' + esc(x.name) + '</a></td><td>' + esc(st(x.statut)) + '</td><td>' + esc(x.cluster || '—') + '</td>' +
          '<td>' + num(x.producteurs) + '</td><td>' + num(x.verifies) + '</td><td>' + (x.completude == null ? '—' : num(x.completude) + ' %') + '</td><td>' + num(n(x.achats_kg) / 1000, 1) + ' MT</td><td>' + num(n(x.livre_kg) / 1000, 1) + ' MT</td>' +
          '<td>' + num(x.a_repartir) + '</td><td>' + (x.target_mt == null ? esc(T('non fixée', 'not set')) : num(x.target_mt, 1) + ' MT') + '</td></tr>';
      }).join('') : '<tr><td colspan="11" class="muted">' + esc(T('Aucune coopérative pour ces filtres.', 'No cooperative for these filters.')) + '</td></tr>') + '</tbody></table></div>' : '') +
    '<h3 style="margin:14px 0 6px">' + esc(T('Par cluster', 'By cluster')) + '</h3><div class="table-wrap"><table><thead><tr><th>Zone</th><th>Cluster</th><th>' + esc(T('Producteurs', 'Farmers')) + '</th><th>Direct RT</th><th>' + esc(T('Coopérative', 'Cooperative')) + '</th></tr></thead><tbody>' +
      ((r.par_cluster || []).length ? r.par_cluster.map(function (x) { return '<tr><td>' + esc(x.zone) + '</td><td>' + esc(x.cluster) + '</td><td>' + num(x.producteurs) + '</td><td>' + num(x.direct_rt) + '</td><td>' + num(x.cooperative) + '</td></tr>'; }).join('')
        : '<tr><td colspan="5" class="muted">' + esc(T('Aucun producteur pour ces filtres.', 'No farmer for these filters.')) + '</td></tr>') + '</tbody></table></div>'
    : '<div class="skeleton skeleton-row"></div>');
  var t = null;
  box.querySelectorAll('[data-rf]').forEach(function (el) {
    var ev = el.type === 'search' ? 'input' : 'change';
    el.addEventListener(ev, function () {
      var k = el.getAttribute('data-rf'); F[k] = el.value;
      if (k === 'zone') { F.cluster = ''; F.village_id = ''; } if (k === 'cluster') F.village_id = ''; if (k === 'coop') F.section_id = '';
      clearTimeout(t); t = setTimeout(load, ev === 'input' ? 400 : 0);
    });
  });
  var rs = document.getElementById('rfReset'); if (rs) rs.onclick = function () { Object.keys(F).forEach(function (k) { F[k] = k === 'campaign' ? ((window.ANAGROCI_CAMPAIGN && window.ANAGROCI_CAMPAIGN.code()) || '') : ''; }); load(); };
}
function load() {
  return client().then(function (c) {
    if (!c) throw new Error(T('Connexion indisponible', 'Connection unavailable'));
    if (F.date_from && F.date_to && F.date_from > F.date_to) throw new Error(T('Période invalide : la date de début est après la date de fin.', 'Invalid period: start date is after end date.'));
    return refs(c).then(function () { return sections(c); }).then(function () { R = null; draw(); return c.rpc('aflp_coop_report', { p: payload() }); });
  }).then(function (x) { if (x.error) throw x.error; R = x.data || {}; draw(); })
    .catch(function (e) { var b = document.getElementById('coopReport'); if (b) { if (REF) { R = R || {}; draw(); } b.insertAdjacentHTML('afterbegin', '<div class="notice danger">' + esc(e && e.message ? e.message : e) + '</div>'); } });
}
function exportCoops() {
  var stEl = document.getElementById('coopExportStatus'); if (stEl) stEl.textContent = T('Préparation…', 'Preparing…');
  client().then(function (c) {
    var ids = {}; ((R && R.par_cooperative) || []).forEach(function (r) { ids[r.cooperative_id] = r.code; });
    return Promise.all([c.from('aflp_coop_delivery_status_v').select('*').eq('is_qa', false).limit(10000), c.from('aflp_lot_origin_v').select('*').limit(10000),
      c.from('aflp_coop_members_v').select('cooperative_id,farmer_id,nom,prenoms,village_nom,member_number,section_name,status,is_primary,verified,area_ha,potential_kg,potential_source,passport_stage,consent_status,completeness_pct,missing_fields,is_qa').eq('is_qa', false).limit(20000)])
      .then(function (rs) { return { rs: rs, ids: ids }; });
  }).then(function (o) {
    var rs = o.rs, ids = o.ids, wb = g.XLSX.utils.book_new();
    function add(name, rows) { var ws = g.XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: T('Aucune donnée pour les filtres sélectionnés', 'No data for the selected filters') }]); g.XLSX.utils.book_append_sheet(wb, ws, name); }
    var r = R || {};
    add('Metadata', [{ campagne: F.campaign, genere_le: new Date().toISOString(), filtres: JSON.stringify(payload()), source: 'ANAGROCI Operations Suite · AFLP Coopératives (aflp_coop_report)', regle: 'Producteur compté une fois. QA exclues. Données non collectées laissées vides.' }]);
    add('Indicateurs', [Object.keys(r).filter(function (k) { return typeof r[k] !== 'object'; }).reduce(function (a, k) { a[k] = r[k]; return a; }, {})]);
    add('Cooperatives', (r.par_cooperative || []).map(function (x) { var y = Object.assign({}, x); delete y.cooperative_id; return y; }));
    add('Clusters', r.par_cluster || []);
    add('Livraisons', (rs[0].data || []).filter(function (d) { return ids[d.cooperative_id]; }).map(function (d) {
      return { livraison: d.code, cooperative: d.cooperative_code, supplier: d.supplier_name, origine: d.origin, statut: d.status, prevu_kg: d.planned_kg, livre_kg: d.delivered_kg, sacs: d.delivered_bags != null ? d.delivered_bags : d.planned_bags,
        camion: d.truck, chauffeur: d.driver, alloue_kg: d.allocated_kg, repartition: d.allocation_status, tracabilite: d.traceability_level, arrivage: d.arrival_id, reception: d.reception_id_resolved, entrepot: d.warehouse_code };
    }));
    add('Origine des lots', (rs[1].data || []).filter(function (l) { return l.cooperative_codes || F.channel !== 'COOPERATIVE'; }));
    add('Membres', (rs[2].error ? [] : (rs[2].data || [])).filter(function (m) { return ids[m.cooperative_id]; }).map(function (m) { var y = Object.assign({ cooperative: ids[m.cooperative_id] }, m); delete y.cooperative_id; delete y.is_qa; y.missing_fields = (m.missing_fields || []).join(', '); return y; }));
    g.XLSX.writeFile(wb, 'AFLP_Cooperatives_' + F.campaign + '_' + new Date().toISOString().slice(0, 10) + '.xlsx', { compression: true });
    if (stEl) stEl.textContent = T('Classeur généré.', 'Workbook generated.');
  }).catch(function (e) { if (stEl) stEl.textContent = T('Échec : ', 'Failed: ') + (e && e.message ? e.message : e); });
}
g.ANAGROCI_COOP_REPORT = { exportCoops: exportCoops, reload: load };
document.addEventListener('anagroci:language', function () { if (document.getElementById('coopReport')) draw(); });
function init() { if (document.getElementById('coopReport')) load(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
