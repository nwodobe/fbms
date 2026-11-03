/* ANAGROCI Operations — CAMPAGNES (multi-campagnes).
   Créer, préparer, ouvrir, suivre, clôturer, consulter l'historique, archiver ; simulations analysées puis supprimées.
   Toutes les écritures passent par les fonctions serveur campaign_* (contrôles de rôle, de statut et journal) :
   cet écran ne modifie aucune table directement. */
(function (g) {
  'use strict';
  var root = null, client = null, REFS = null, W = null;
  var ADMIN = ['Branch Manager', 'General Manager'], CONFIG = ['Branch Manager', 'Assistant Branch Manager', 'General Manager'];

  /* ------------------------------------------------------------------ utilitaires */
  function lang() { try { return localStorage.getItem('anagroci_lang') === 'en' ? 'en' : 'fr'; } catch (e) { return 'fr'; } }
  function T(fr, en) { return lang() === 'en' ? en : fr; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { var n = Number(v || 0); return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d == null ? 0 : d }).format(n); }
  function mt(kg) { return num(Number(kg || 0) / 1000, 1) + ' MT'; }
  function fdate(d) { if (!d) return '—'; var x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR'); }
  function fdt(d) { if (!d) return '—'; var x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
  function role() { var a = g.ANAGROCI_AUTH; return a && a.profile ? a.profile.role || '' : ''; }
  function can(list) { return list.indexOf(role()) >= 0; }
  function CTX() { return g.ANAGROCI_CAMPAIGN || null; }
  function statusLabel(s) { var c = CTX(); return c ? c.statusLabel(s) : s; }
  function typeLabel(t) { var c = CTX(); return c ? c.typeLabel(t) : t; }
  function waitClient() {
    if (client) return Promise.resolve(client);
    return new Promise(function (resolve) {
      var n = 0, t = setInterval(function () {
        n++;
        if (g.supabase && g.ANAGROCI_SUPABASE_URL && g.ANAGROCI_SUPABASE_ANON) {
          clearInterval(t); client = g.supabase.createClient(g.ANAGROCI_SUPABASE_URL, g.ANAGROCI_SUPABASE_ANON); resolve(client);
        } else if (n > 120) { clearInterval(t); resolve(null); }
      }, 80);
    });
  }
  function rpc(name, params) {
    return waitClient().then(function (c) {
      if (!c) throw new Error(T('Connexion indisponible.', 'Connection unavailable.'));
      return c.rpc(name, params || {});
    }).then(function (r) { if (r.error) { var e = new Error(r.error.message); e.code = r.error.code; throw e; } return r.data; });
  }
  function q(table, cols, mod) {
    return waitClient().then(function (c) {
      var r = c.from(table).select(cols || '*'); if (mod) r = mod(r); return r;
    }).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data || []; });
  }
  function soft(p, fb) { return p.catch(function (e) { console.warn('[Campagnes]', e && e.message); return fb; }); }
  function badgeStatus(s) {
    var cls = s === 'OPEN' ? 'ok' : s === 'CLOSING' ? 'warn' : (s === 'CLOSED' || s === 'ARCHIVED') ? 'info' : 'info';
    return '<span class="badge ' + cls + '">' + esc(statusLabel(s)) + '</span>';
  }
  function badgeType(t) { return t === 'REAL' ? '<span class="badge ok">' + esc(typeLabel(t)) + '</span>' : '<span class="badge warn camp-sim-badge">' + esc(typeLabel(t).toUpperCase()) + '</span>'; }
  function notice(kind, html) { return '<div class="notice ' + kind + '">' + html + '</div>'; }
  function kpi(label, value, sub) { return '<div class="kpi"><small>' + esc(label) + '</small><b>' + value + '</b><span>' + esc(sub || '') + '</span></div>'; }
  function field(label, html, cls) { return '<div class="ops-field ' + (cls || '') + '"><label>' + esc(label) + '</label>' + html + '</div>'; }
  function paint(html) { root.innerHTML = html; }
  function errBox(e) { return notice('danger', esc(e && e.message ? e.message : String(e))); }

  /* Fenêtre de confirmation forte : texte exact à saisir, motif, case à cocher. */
  function confirmBox(o) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div'); wrap.className = 'camp-modal'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML = '<div class="camp-modal-box"><h3>' + esc(o.title) + '</h3>' + (o.body || '') +
        (o.reasonMin != null ? field(T('Motif', 'Reason') + (o.reasonMin ? ' (' + o.reasonMin + ' ' + T('caractères minimum', 'characters minimum') + ')' : ''), '<textarea id="cmReason" rows="3"></textarea>') : '') +
        (o.check ? '<label class="camp-check"><input type="checkbox" id="cmCheck"> ' + esc(o.check) + '</label>' : '') +
        (o.typed ? field(T('Pour confirmer, saisissez exactement : ', 'To confirm, type exactly: ') + o.typed, '<input id="cmTyped" autocomplete="off" spellcheck="false">') : '') +
        '<p class="camp-modal-msg" id="cmMsg"></p><div class="ops-actions"><button class="btn secondary" type="button" id="cmCancel">' + T('Annuler', 'Cancel') + '</button>' +
        '<button class="btn ' + (o.danger ? 'danger' : 'primary') + '" type="button" id="cmOk">' + esc(o.ok || T('Confirmer', 'Confirm')) + '</button></div></div>';
      document.body.appendChild(wrap);
      var first = wrap.querySelector('textarea,input'); if (first) first.focus();
      function close(v) { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); resolve(v); }
      wrap.querySelector('#cmCancel').onclick = function () { close(null); };
      wrap.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(null); });
      wrap.querySelector('#cmOk').onclick = function () {
        var reason = o.reasonMin != null ? wrap.querySelector('#cmReason').value.trim() : '';
        var typed = o.typed ? wrap.querySelector('#cmTyped').value.trim() : '';
        var m = wrap.querySelector('#cmMsg');
        if (o.reasonMin && reason.length < o.reasonMin) { m.textContent = T('Motif trop court.', 'Reason too short.'); return; }
        if (o.typed && typed.toUpperCase() !== o.typed.toUpperCase()) { m.textContent = T('Le texte saisi ne correspond pas.', 'The text does not match.'); return; }
        close({ reason: reason, typed: typed, checked: o.check ? wrap.querySelector('#cmCheck').checked : false });
      };
    });
  }

  /* ------------------------------------------------------------------ routes */
  function route() { return (location.hash || '').replace(/^#/, '').split('/'); }
  function render() {
    var r = route();
    if (r[0] === 'new') return renderWizard(null);
    if (r[0] === 'edit' && r[1]) return renderWizard(r[1]);
    if (r[0] === 'c' && r[1]) return renderDetail(r[1], r[2] || 'resume');
    return renderDashboard();
  }

  /* ------------------------------------------------------------------ tableau de bord */
  function cardCampaign(c) {
    var perf = c.target_mt ? (Number(c.achats_kg) / 1000) / Number(c.target_mt) * 100 : null;
    return '<article class="camp-card ' + (c.campaign_type !== 'REAL' ? 'is-sim' : '') + '">' +
      '<div class="camp-card-head"><div><b class="mono">' + esc(c.code) + '</b><span>' + esc(c.name) + '</span></div>' +
      '<div class="camp-badges">' + badgeType(c.campaign_type) + badgeStatus(c.status) + (c.is_current ? '<span class="badge ok">' + T('Courante', 'Current') + '</span>' : '') + '</div></div>' +
      '<p class="muted">' + esc(fdate(c.start_date)) + ' → ' + esc(fdate(c.planned_end_date)) + (c.closed_with_reserves ? ' · ' + T('clôturée avec réserve', 'closed with reserve') : '') + '</p>' +
      '<div class="camp-mini"><div><small>' + T('Acheté', 'Bought') + '</small><b>' + mt(c.achats_kg) + '</b></div><div><small>' + T('Reçu Warehouse', 'Received') + '</small><b>' + mt(c.recu_kg) + '</b></div>' +
      '<div><small>' + T('Objectif', 'Target') + '</small><b>' + (c.target_mt ? num(c.target_mt) + ' MT' : '—') + '</b></div><div><small>Performance</small><b>' + (perf == null ? '—' : num(perf, 1) + ' %') + '</b></div></div>' +
      '<div class="ops-actions"><a class="btn secondary" href="#c/' + esc(c.id) + '">' + T('Consulter', 'Open') + '</a>' +
      (CTX() && CTX().isManagement() && (!CTX().get() || CTX().get().id !== c.id) ? '<button class="btn secondary" type="button" data-work="' + esc(c.id) + '">' + T('Travailler dans cette campagne', 'Work in this campaign') + '</button>' : '') +
      (c.campaign_type !== 'REAL' ? '<span class="camp-deletable">' + T('Supprimable', 'Deletable') + '</span>' : '') + '</div></article>';
  }
  function renderDashboard() {
    paint('<div class="ops-pagehead"><div><h1>' + T('Campagnes', 'Campaigns') + '</h1><p>' + T('ANAGROCI gère des campagnes successives : créer, préparer, ouvrir, suivre, clôturer, consulter l’historique. Les simulations se suppriment proprement, jamais les référentiels.', 'ANAGROCI runs successive campaigns: create, prepare, open, monitor, close, review history. Simulations are removed cleanly, master data never.') + '</p></div>' +
      '<div class="ops-actions">' + (can(ADMIN) ? '<a class="btn primary" href="#new">+ ' + T('Nouvelle campagne', 'New campaign') + '</a>' : '') + '</div></div><div class="skeleton skeleton-row"></div>');
    rpc('campaign_dashboard').then(function (rows) {
      var cur = rows.filter(function (x) { return x.is_current; })[0] || null;
      var real = rows.filter(function (x) { return x.campaign_type === 'REAL'; });
      var running = real.filter(function (x) { return ['CLOSED', 'ARCHIVED'].indexOf(x.status) < 0; });
      var past = real.filter(function (x) { return ['CLOSED', 'ARCHIVED'].indexOf(x.status) >= 0; });
      var sims = rows.filter(function (x) { return x.campaign_type !== 'REAL'; });
      var perf = cur && cur.target_mt ? (Number(cur.achats_kg) / 1000) / Number(cur.target_mt) * 100 : null;
      var hero = '<section class="camp-hero"><div class="camp-hero-media"><img src="../assets/operations/modules/lba-purchase.webp" alt="' + esc(T('Sac de noix de cajou brute en toile de jute', 'Raw cashew nut jute bag')) + '" loading="lazy"></div>' +
        '<div class="camp-hero-body"><small>' + T('CAMPAGNE ACTIVE', 'ACTIVE CAMPAIGN') + '</small>' +
        (cur ? '<h2><span class="mono">' + esc(cur.code) + '</span> · ' + esc(cur.name) + '</h2><div class="camp-badges">' + badgeType(cur.campaign_type) + badgeStatus(cur.status) + '</div>' +
          (cur.campaign_type !== 'REAL' ? notice('warn', T('La campagne courante est une simulation : aucune campagne réelle n’est encore ouverte.', 'The current campaign is a simulation: no real campaign is open yet.')) : '') +
          '<section class="kpi-grid camp-kpis">' + kpi(T('Objectif', 'Target'), cur.target_mt ? num(cur.target_mt) + ' MT' : '—', T('niveau campagne', 'campaign level')) +
          kpi(T('Acheté', 'Bought'), mt(cur.achats_kg), num(cur.achats) + ' ' + T('achats', 'purchases')) + kpi(T('Reçu Warehouse', 'Received at warehouse'), mt(cur.recu_kg), num(cur.receptions) + ' ' + T('réceptions', 'receptions')) +
          kpi(T('Stock (LOT actifs)', 'Stock (active lots)'), num(cur.stock_lots), 'LOT') + kpi('Factory', mt(cur.factory_recu_kg), num(cur.transferts) + ' ' + T('transferts', 'transfers')) +
          kpi('Performance', perf == null ? '—' : num(perf, 1) + ' %', T('acheté / objectif', 'bought / target')) + '</section>' +
          '<div class="ops-actions"><a class="btn primary" href="#c/' + esc(cur.id) + '">' + T('Ouvrir la fiche', 'Open') + '</a></div>'
          : '<h2>' + T('Aucune campagne courante', 'No current campaign') + '</h2><p>' + T('Créez puis ouvrez une campagne.', 'Create then open a campaign.') + '</p>') + '</div></section>';
      function section(title, arr, empty) { return '<h2 class="camp-sec">' + esc(title) + '</h2>' + (arr.length ? '<div class="camp-grid">' + arr.map(cardCampaign).join('') + '</div>' : '<div class="ops-empty">' + esc(empty) + '</div>'); }
      paint(root.innerHTML.split('<div class="skeleton skeleton-row"></div>')[0] + hero +
        section(T('Campagnes en cours ou en préparation', 'Running or planned campaigns'), running, T('Aucune campagne réelle en cours.', 'No real campaign running.')) +
        section(T('Campagnes précédentes', 'Previous campaigns'), past, T('Aucune campagne clôturée pour l’instant.', 'No closed campaign yet.')) +
        section(T('Simulations, démonstrations et tests', 'Simulations, demos and tests'), sims, T('Aucune simulation.', 'No simulation.')));
      [].slice.call(root.querySelectorAll('[data-work]')).forEach(function (b) { b.onclick = function () { CTX().select(b.getAttribute('data-work')); }; });
    }).catch(function (e) { paint(root.innerHTML + errBox(e)); });
  }

  /* ------------------------------------------------------------------ référentiels de l'assistant */
  function loadRefs() {
    if (REFS) return Promise.resolve(REFS);
    return Promise.all([
      soft(q('aflp_zones', 'code,label,active', function (r) { return r.order('code'); }), []),
      soft(q('aflp_clusters', 'code,label,zone_code,active', function (r) { return r.order('label'); }), []),
      soft(q('villages_light_v', 'id,village,cluster,cluster_code,deleted', function (r) { return r.order('village').limit(2000); }), []),
      soft(q('rt_light_v', 'id,id_rt,nom,village_id,village_nom,cluster,deleted', function (r) { return r.order('nom').limit(2000); }), []),
      soft(q('profils', 'user_id,nom,role,cluster,zone,actif', function (r) { return r.in('role', ['Zonal Head', 'Unit Head', 'Assistant Unit Head']).limit(500); }), []),
      soft(q('aflp_cooperatives', 'id,code,name,archived,is_qa', function (r) { return r.order('code').limit(1000); }), []),
      soft(q('procurement_suppliers', 'supplier_id,display_name,entity_type,status', function (r) { return r.order('display_name').limit(2000); }), []),
      soft(q('wms_warehouses', 'id,code,name,status,is_factory', function (r) { return r.order('code'); }), []),
      soft(rpc('campaign_dashboard'), [])
    ]).then(function (rs) {
      REFS = { zones: rs[0].filter(function (x) { return x.active !== false; }), clusters: rs[1].filter(function (x) { return x.active !== false; }),
        villages: rs[2].filter(function (x) { return !x.deleted; }), rts: rs[3].filter(function (x) { return !x.deleted; }),
        heads: rs[4].filter(function (x) { return x.actif !== false; }), coops: rs[5].filter(function (x) { return !x.archived && !x.is_qa; }),
        suppliers: rs[6].filter(function (x) { return String(x.status || '').toUpperCase() !== 'INACTIVE'; }), warehouses: rs[7], campaigns: rs[8] };
      return REFS;
    });
  }
  function emptyW() {
    return { id: null, row_version: null, step: 1,
      identity: { code: '', name: '', year: new Date().getFullYear() + 1, campaign_type: 'REAL', start_date: '', planned_end_date: '', season: '', description: '', currency: 'XOF', country: 'CI', copy_from: '' },
      sel: { ZONE: {}, CLUSTER: {}, VILLAGE: {}, RT: {}, ZONE_HEAD: {}, UNIT_HEAD: {}, COOPERATIVE: {}, LBA: {}, SUPPLIER: {}, WAREHOUSE: {}, FACTORY: {} },
      teams: '', targets: { CAMPAIGN: '', CHANNEL: {}, ZONE: {}, CLUSTER: {}, COOPERATIVE: {}, SUPPLIER: {} },
      rules: { price_per_kg: '', min_kor: '', max_moisture_pct: '', rt_commission_per_kg: '', mode_a_rt_required: true, mode_b: '', seuils: '', transport: '', bags_per_mt: '', autres: '' } };
  }
  /* Préremplit l'assistant depuis une campagne existante (édition ou copie) : configuration seulement. */
  function fillFrom(cid, copyOnly) {
    return Promise.all([
      q('campaigns', '*', function (r) { return r.eq('id', cid).limit(1); }),
      q('campaign_participants', 'kind,ref_id,ref_label,meta,active', function (r) { return r.eq('campaign_id', cid).eq('active', true); }),
      q('campaign_targets', 'level,ref_id,target_mt', function (r) { return r.eq('campaign_id', cid); }),
      soft(q('procurement_campaign_rules', 'price_per_kg,min_kor,max_moisture_pct,rt_commission_per_kg,status,channel_code,zone_code', function (r) { return r.eq('campaign_id', cid).eq('status', 'ACTIVE').eq('channel_code', 'FIELD_BUYING').limit(1); }), []),
      soft(q('aflp_campaign_controls', 'control_code,enabled', function (r) { return r.eq('campaign_id', cid); }), [])
    ]).then(function (rs) {
      var c = rs[0][0]; if (!c) throw new Error(T('Campagne introuvable.', 'Campaign not found.'));
      Object.keys(W.sel).forEach(function (k) { W.sel[k] = {}; });
      rs[1].forEach(function (p) { if (W.sel[p.kind]) W.sel[p.kind][p.ref_id] = p.ref_label || p.ref_id; if (p.kind === 'TEAM') W.teams += (W.teams ? '\n' : '') + (p.ref_label || p.ref_id); });
      W.targets = { CAMPAIGN: '', CHANNEL: {}, ZONE: {}, CLUSTER: {}, COOPERATIVE: {}, SUPPLIER: {} };
      rs[2].forEach(function (t) {
        var v = copyOnly ? '' : (t.target_mt == null ? '' : String(t.target_mt));
        if (t.level === 'CAMPAIGN') W.targets.CAMPAIGN = v; else if (W.targets[t.level]) W.targets[t.level][t.ref_id] = v;
      });
      var rule = rs[3][0] || {};
      W.rules.price_per_kg = rule.price_per_kg == null ? '' : String(rule.price_per_kg);
      W.rules.min_kor = rule.min_kor == null ? '' : String(rule.min_kor);
      W.rules.max_moisture_pct = rule.max_moisture_pct == null ? '' : String(rule.max_moisture_pct);
      W.rules.rt_commission_per_kg = rule.rt_commission_per_kg == null ? '' : String(rule.rt_commission_per_kg);
      var ma = rs[4].filter(function (x) { return x.control_code === 'COOP_MODE_A_RT_REQUIRED'; })[0];
      if (ma) W.rules.mode_a_rt_required = !!ma.enabled;
      var cfg = c.config || {};
      ['mode_b', 'seuils', 'transport', 'autres'].forEach(function (k) { if (cfg[k] != null) W.rules[k] = String(cfg[k]); });
      if (cfg.sacherie && cfg.sacherie.bags_per_mt != null) W.rules.bags_per_mt = String(cfg.sacherie.bags_per_mt);
      if (!copyOnly) {
        W.id = c.id; W.row_version = c.row_version; W.status = c.status;
        W.identity = { code: c.code, name: c.name, year: c.year, campaign_type: c.campaign_type, start_date: c.start_date || '', planned_end_date: c.planned_end_date || '',
          season: c.season || '', description: c.description || '', currency: c.currency || 'XOF', country: c.country || 'CI', copy_from: '' };
      }
    });
  }

  /* ------------------------------------------------------------------ assistant (8 étapes) */
  var STEPS = [['1', 'Identité', 'Identity'], ['2', 'Périmètre', 'Scope'], ['3', 'Organisation', 'Organisation'], ['4', 'Partenaires', 'Partners'],
    ['5', 'Infrastructure', 'Infrastructure'], ['6', 'Objectifs', 'Targets'], ['7', 'Règles', 'Rules'], ['8', 'Résumé', 'Summary']];
  function renderWizard(editId) {
    if (!can(ADMIN)) { paint(notice('warn', T('Création et paramétrage réservés au Branch Manager et au General Manager.', 'Creation and set-up are reserved to the Branch Manager and the General Manager.'))); return; }
    paint('<div class="skeleton skeleton-row"></div>');
    var start = W && W._for === (editId || 'new') ? Promise.resolve() : (function () { W = emptyW(); W._for = editId || 'new'; return editId ? loadRefs().then(function () { return fillFrom(editId, false); }) : loadRefs(); })();
    start.then(function () { return loadRefs(); }).then(drawWizard).catch(function (e) { paint(errBox(e)); });
  }
  function checklist(kind, items, filterId) {
    var sel = W.sel[kind];
    return '<div class="camp-pick"><input type="search" class="camp-filter" placeholder="' + T('Filtrer…', 'Filter…') + '" data-filter="' + kind + '">' +
      '<div class="camp-pick-actions"><button type="button" class="btn secondary" data-all="' + kind + '">' + T('Tout sélectionner', 'Select all') + '</button><button type="button" class="btn secondary" data-none="' + kind + '">' + T('Aucun', 'None') + '</button><span class="muted">' + Object.keys(sel).length + ' ' + T('sélectionné(s)', 'selected') + '</span></div>' +
      '<div class="camp-pick-list" id="' + (filterId || 'pick' + kind) + '">' + (items.length ? items.map(function (x) {
        return '<label data-txt="' + esc((x[1] + ' ' + (x[2] || '')).toLowerCase()) + '"><input type="checkbox" data-kind="' + kind + '" value="' + esc(x[0]) + '" data-label="' + esc(x[1]) + '"' + (sel[x[0]] ? ' checked' : '') + '> <span>' + esc(x[1]) + (x[2] ? ' <small>' + esc(x[2]) + '</small>' : '') + '</span></label>';
      }).join('') : '<p class="muted">' + T('Aucun élément disponible.', 'No item available.') + '</p>') + '</div></div>';
  }
  function stepBody(R) {
    var I = W.identity, s = W.step;
    if (s === 1) {
      var sources = R.campaigns.filter(function (c) { return c.id !== W.id; });
      return '<div class="ops-form-grid">' +
        field(T('Année', 'Year') + ' *', '<input id="wYear" type="number" min="2020" max="2100" value="' + esc(I.year) + '">') +
        field(T('Code', 'Code') + ' *', '<input id="wCode" value="' + esc(I.code) + '"' + (W.id ? ' disabled' : '') + ' placeholder="2028" maxlength="24">') +
        field(T('Type', 'Type') + ' *', '<select id="wType"' + (W.id && W.status && ['DRAFT', 'PLANNING', 'READY'].indexOf(W.status) < 0 ? ' disabled' : '') + '>' + ['REAL', 'SIMULATION', 'DEMO', 'TRAINING', 'QA'].map(function (t) { return '<option value="' + t + '"' + (I.campaign_type === t ? ' selected' : '') + '>' + esc(typeLabel(t)) + '</option>'; }).join('') + '</select>') +
        field(T('Nom', 'Name') + ' *', '<input id="wName" value="' + esc(I.name) + '" placeholder="RCN / AFLP 2028">', 'ops-span-2') +
        field(T('Saison', 'Season'), '<input id="wSeason" value="' + esc(I.season) + '" placeholder="2027-2028">') +
        field(T('Début', 'Start') + ' *', '<input id="wStart" type="date" value="' + esc(I.start_date) + '">') +
        field(T('Fin prévue', 'Planned end') + ' *', '<input id="wEnd" type="date" value="' + esc(I.planned_end_date) + '">') +
        field(T('Devise', 'Currency'), '<input id="wCur" value="' + esc(I.currency) + '">') +
        field(T('Description', 'Description'), '<textarea id="wDesc" rows="3">' + esc(I.description) + '</textarea>', 'ops-span-2') +
        (W.id ? '' : field(T('Copier la configuration d’une campagne précédente', 'Copy the set-up of a previous campaign'),
          '<select id="wCopy"><option value="">' + T('— Ne pas copier —', '— Do not copy —') + '</option>' + sources.map(function (c) { return '<option value="' + esc(c.id) + '"' + (I.copy_from === c.id ? ' selected' : '') + '>' + esc(c.code + ' · ' + c.name + ' (' + statusLabel(c.status) + ')') + '</option>'; }).join('') + '</select>', 'ops-span-2')) +
        '</div>' + (W.id ? '' : notice('info', T('<b>Copie = configuration uniquement</b> : zones, clusters, villages, organisation, coopératives, warehouses, règles, structure des objectifs (valeurs remises à zéro). Jamais d’achats, avances, livraisons, stocks, LOT, transferts, réceptions, qualité ni performance.', '<b>Copy = set-up only</b>: zones, clusters, villages, organisation, cooperatives, warehouses, rules, target structure (values reset). Never purchases, advances, deliveries, stock, lots, transfers, receptions, quality or performance.'))) +
        '<p class="muted" style="font-size:11px">' + T('Code : année sur 4 chiffres pour l’instant (ex. 2028). Les codes alphanumériques (RCN-2028) seront acceptés après validation de la migration 4.', 'Code: 4-digit year for now (e.g. 2028). Alphanumeric codes (RCN-2028) will be accepted once migration 4 is approved.') + '</p>';
    }
    if (s === 2) {
      var clusterSel = Object.keys(W.sel.CLUSTER);
      var vil = R.villages.filter(function (v) { return !clusterSel.length || clusterSel.indexOf(v.cluster_code) >= 0 || clusterSel.indexOf(v.cluster) >= 0; });
      return '<h3>' + T('Zones', 'Zones') + '</h3>' + checklist('ZONE', R.zones.map(function (z) { return [z.code, z.label || z.code]; })) +
        '<h3>Clusters</h3>' + checklist('CLUSTER', R.clusters.map(function (c) { return [c.code, c.label || c.code, c.zone_code]; })) +
        '<h3>' + T('Villages', 'Villages') + (clusterSel.length ? ' <small class="muted">(' + T('clusters sélectionnés', 'selected clusters') + ')</small>' : '') + '</h3>' +
        checklist('VILLAGE', vil.map(function (v) { return [v.id, v.village || v.id, v.cluster]; }));
    }
    if (s === 3) {
      var vSel = Object.keys(W.sel.VILLAGE);
      var rts = R.rts.filter(function (r) { return !vSel.length || vSel.indexOf(r.village_id) >= 0; });
      return '<h3>RT ' + (vSel.length ? '<small class="muted">(' + T('villages sélectionnés', 'selected villages') + ')</small>' : '') + '</h3>' +
        checklist('RT', rts.map(function (r) { return [r.id, (r.id_rt ? r.id_rt + ' · ' : '') + (r.nom || r.id), r.village_nom]; })) +
        '<h3>Zone Heads</h3>' + checklist('ZONE_HEAD', R.heads.filter(function (h) { return h.role === 'Zonal Head'; }).map(function (h) { return [h.user_id, h.nom || h.user_id, h.zone || h.cluster]; })) +
        '<h3>Unit Heads</h3>' + checklist('UNIT_HEAD', R.heads.filter(function (h) { return h.role !== 'Zonal Head'; }).map(function (h) { return [h.user_id, h.nom || h.user_id, h.cluster]; })) +
        '<h3>' + T('Équipes (une par ligne)', 'Teams (one per line)') + '</h3><textarea id="wTeams" rows="3" class="camp-textarea">' + esc(W.teams) + '</textarea>';
    }
    if (s === 4) {
      return '<h3>' + T('Coopératives', 'Cooperatives') + '</h3>' + checklist('COOPERATIVE', R.coops.map(function (c) { return [c.id, c.code + ' · ' + c.name]; })) +
        '<h3>LBA</h3>' + checklist('LBA', R.suppliers.filter(function (x) { return /LBA/i.test(String(x.entity_type || '')); }).map(function (x) { return [x.supplier_id, x.display_name, x.entity_type]; })) +
        '<h3>' + T('Fournisseurs', 'Suppliers') + '</h3>' + checklist('SUPPLIER', R.suppliers.filter(function (x) { return !/LBA/i.test(String(x.entity_type || '')); }).map(function (x) { return [x.supplier_id, x.display_name, x.entity_type]; }));
    }
    if (s === 5) {
      return '<h3>Warehouses</h3>' + checklist('WAREHOUSE', R.warehouses.filter(function (w) { return !w.is_factory; }).map(function (w) { return [w.id, w.code + ' · ' + w.name, w.status]; })) +
        '<h3>Factory</h3>' + checklist('FACTORY', R.warehouses.filter(function (w) { return w.is_factory; }).map(function (w) { return [w.id, w.code + ' · ' + w.name, w.status]; }));
    }
    if (s === 6) {
      function tgtRows(level, items) {
        if (!items.length) return '<p class="muted">' + T('Sélectionnez d’abord des éléments aux étapes précédentes.', 'Select items in the previous steps first.') + '</p>';
        return '<div class="camp-target-grid">' + items.map(function (x) { return '<label><span>' + esc(x[1]) + '</span><input type="number" min="0" step="0.1" data-tlevel="' + level + '" data-tref="' + esc(x[0]) + '" value="' + esc(W.targets[level][x[0]] || '') + '"> MT</label>'; }).join('') + '</div>';
      }
      var sel = function (k) { return Object.keys(W.sel[k]).map(function (id) { return [id, W.sel[k][id]]; }); };
      return '<div class="ops-form-grid">' + field(T('Objectif campagne (MT)', 'Campaign target (MT)') + ' *', '<input id="wTargetCampaign" type="number" min="0" step="0.1" value="' + esc(W.targets.CAMPAIGN) + '">') + '</div>' +
        '<h3>' + T('Par canal', 'By channel') + '</h3>' + tgtRows('CHANNEL', [['AFLP_DIRECT', T('Direct RT', 'Direct RT')], ['COOPERATIVE', T('Coopérative', 'Cooperative')], ['LBA', 'LBA'], ['DIRECT_SUPPLIER', T('Fournisseur direct', 'Direct supplier')]]) +
        '<h3>' + T('Par zone', 'By zone') + '</h3>' + tgtRows('ZONE', sel('ZONE')) + '<h3>' + T('Par cluster', 'By cluster') + '</h3>' + tgtRows('CLUSTER', sel('CLUSTER')) +
        '<h3>' + T('Par coopérative', 'By cooperative') + '</h3>' + tgtRows('COOPERATIVE', sel('COOPERATIVE')) + '<h3>' + T('Par fournisseur / LBA', 'By supplier / LBA') + '</h3>' + tgtRows('SUPPLIER', sel('SUPPLIER').concat(sel('LBA')));
    }
    if (s === 7) {
      var r = W.rules;
      return '<div class="ops-form-grid">' +
        field(T('Prix d’achat bord champ (XOF/kg)', 'Farm-gate price (XOF/kg)') + ' *', '<input id="wPrice" type="number" min="0" value="' + esc(r.price_per_kg) + '">') +
        field(T('KOR minimum', 'Minimum KOR'), '<input id="wKor" type="number" min="0" step="0.1" value="' + esc(r.min_kor) + '">') +
        field(T('Humidité maximum (%)', 'Maximum moisture (%)'), '<input id="wHum" type="number" min="0" step="0.1" value="' + esc(r.max_moisture_pct) + '">') +
        field(T('Commission RT (XOF/kg)', 'RT commission (XOF/kg)'), '<input id="wCom" type="number" min="0" value="' + esc(r.rt_commission_per_kg) + '">') +
        field(T('Sacherie : sacs par MT', 'Bags per MT'), '<input id="wBags" type="number" min="0" value="' + esc(r.bags_per_mt) + '">') +
        field(T('Mode A : RT de suivi obligatoire', 'Mode A: follow-up RT required'), '<select id="wModeA"><option value="1"' + (r.mode_a_rt_required ? ' selected' : '') + '>' + T('Oui', 'Yes') + '</option><option value="0"' + (!r.mode_a_rt_required ? ' selected' : '') + '>' + T('Non', 'No') + '</option></select>') +
        field(T('Mode B (livraison groupée coopérative)', 'Mode B (cooperative bulk delivery)'), '<textarea id="wModeB" rows="2">' + esc(r.mode_b) + '</textarea>', 'ops-span-2') +
        field(T('Seuils et avances', 'Thresholds and advances'), '<textarea id="wSeuils" rows="2">' + esc(r.seuils) + '</textarea>') +
        field(T('Transport', 'Transport'), '<textarea id="wTransport" rows="2">' + esc(r.transport) + '</textarea>') +
        field(T('Autres règles existantes', 'Other existing rules'), '<textarea id="wAutres" rows="2">' + esc(r.autres) + '</textarea>', 'ops-span-2') + '</div>' +
        notice('info', T('Le prix, la qualité et la commission alimentent la règle Procurement de la campagne (contrôlée par le serveur à chaque achat). Les autres champs sont conservés comme paramètres documentés de la campagne.', 'Price, quality and commission feed the campaign Procurement rule (checked by the server on every purchase). Other fields are kept as documented campaign parameters.'));
    }
    var cnt = function (k) { return Object.keys(W.sel[k]).length; };
    return '<div class="camp-summary">' +
      '<div><h3>' + T('Identité', 'Identity') + '</h3><p><b class="mono">' + esc(I.code || '—') + '</b> · ' + esc(I.name || '—') + '<br>' + esc(typeLabel(I.campaign_type)) + ' · ' + esc(I.year) + '<br>' + esc(fdate(I.start_date)) + ' → ' + esc(fdate(I.planned_end_date)) + (I.copy_from ? '<br>' + T('Configuration copiée de ', 'Set-up copied from ') + esc((REFS.campaigns.filter(function (c) { return c.id === I.copy_from; })[0] || {}).code || '') : '') + '</p></div>' +
      '<div><h3>' + T('Périmètre', 'Scope') + '</h3><p>' + cnt('ZONE') + ' zone(s) · ' + cnt('CLUSTER') + ' cluster(s) · ' + cnt('VILLAGE') + ' village(s)</p></div>' +
      '<div><h3>' + T('Organisation', 'Organisation') + '</h3><p>' + cnt('RT') + ' RT · ' + cnt('ZONE_HEAD') + ' Zone Head(s) · ' + cnt('UNIT_HEAD') + ' Unit Head(s)</p></div>' +
      '<div><h3>' + T('Partenaires', 'Partners') + '</h3><p>' + cnt('COOPERATIVE') + ' ' + T('coopérative(s)', 'cooperative(s)') + ' · ' + cnt('LBA') + ' LBA · ' + cnt('SUPPLIER') + ' ' + T('fournisseur(s)', 'supplier(s)') + '</p></div>' +
      '<div><h3>Infrastructure</h3><p>' + cnt('WAREHOUSE') + ' warehouse(s) · ' + cnt('FACTORY') + ' factory</p></div>' +
      '<div><h3>' + T('Objectifs', 'Targets') + '</h3><p>' + (W.targets.CAMPAIGN ? num(W.targets.CAMPAIGN, 1) + ' MT' : T('non saisi', 'not set')) + '</p></div>' +
      '<div><h3>' + T('Règles', 'Rules') + '</h3><p>' + (W.rules.price_per_kg ? num(W.rules.price_per_kg) + ' XOF/kg' : T('prix non saisi', 'price not set')) + ' · KOR ≥ ' + esc(W.rules.min_kor || '—') + ' · ' + T('humidité', 'moisture') + ' ≤ ' + esc(W.rules.max_moisture_pct || '—') + ' %<br>Mode A : ' + (W.rules.mode_a_rt_required ? T('RT obligatoire', 'RT required') : T('RT facultatif', 'RT optional')) + '</p></div></div>' +
      notice('info', T('L’enregistrement crée ou met à jour la campagne en préparation. L’ouverture se fait ensuite depuis la fiche, après la liste de contrôle « Préparer l’ouverture ».', 'Saving creates or updates the campaign in preparation. Opening is done afterwards from the campaign page, after the “Prepare opening” checklist.')) +
      '<p id="wMsg" class="muted"></p>';
  }
  function drawWizard(R) {
    var s = W.step;
    paint('<div class="ops-pagehead"><div><h1>' + (W.id ? T('Paramétrer la campagne ', 'Set up campaign ') + esc(W.identity.code) : T('Nouvelle campagne', 'New campaign')) + '</h1><p>' + T('Assistant en 8 étapes. Rien n’est enregistré avant la dernière étape.', '8-step wizard. Nothing is saved before the last step.') + '</p></div><div class="ops-actions"><a class="btn secondary" href="' + (W.id ? '#c/' + esc(W.id) : '#') + '">' + T('Annuler', 'Cancel') + '</a></div></div>' +
      '<ol class="camp-steps">' + STEPS.map(function (x, i) { return '<li class="' + (i + 1 === s ? 'on' : i + 1 < s ? 'done' : '') + '"><button type="button" data-step="' + (i + 1) + '"><b>' + x[0] + '</b> ' + esc(T(x[1], x[2])) + '</button></li>'; }).join('') + '</ol>' +
      '<section class="card camp-wizard"><div class="card-head"><div><h2>' + esc(STEPS[s - 1][0] + '. ' + T(STEPS[s - 1][1], STEPS[s - 1][2])) + '</h2></div></div>' + stepBody(R) +
      '<div class="ops-actions camp-wiz-nav">' + (s > 1 ? '<button type="button" class="btn secondary" id="wPrev">← ' + T('Précédent', 'Previous') + '</button>' : '') +
      (s < 8 ? '<button type="button" class="btn primary" id="wNext">' + T('Suivant', 'Next') + ' →</button>' : '<button type="button" class="btn primary" id="wSave">' + (W.id ? T('Enregistrer les modifications', 'Save changes') : T('Créer la campagne', 'Create the campaign')) + '</button>') + '</div></section>');
    bindWizard(R);
  }
  function collect() {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : null; };
    if (W.step === 1) {
      W.identity.year = Number(v('wYear')) || W.identity.year; if (!W.id) W.identity.code = (v('wCode') || '').toUpperCase();
      W.identity.campaign_type = v('wType') || W.identity.campaign_type; W.identity.name = v('wName') || '';
      W.identity.season = v('wSeason') || ''; W.identity.start_date = v('wStart') || ''; W.identity.planned_end_date = v('wEnd') || '';
      W.identity.currency = v('wCur') || 'XOF'; W.identity.description = v('wDesc') || '';
      if (!W.id) W.identity.copy_from = v('wCopy') || '';
    }
    if (W.step === 3) W.teams = v('wTeams') || '';
    if (W.step === 6) {
      W.targets.CAMPAIGN = v('wTargetCampaign') || '';
      [].slice.call(root.querySelectorAll('[data-tlevel]')).forEach(function (el) { W.targets[el.getAttribute('data-tlevel')][el.getAttribute('data-tref')] = el.value.trim(); });
    }
    if (W.step === 7) {
      W.rules.price_per_kg = v('wPrice') || ''; W.rules.min_kor = v('wKor') || ''; W.rules.max_moisture_pct = v('wHum') || '';
      W.rules.rt_commission_per_kg = v('wCom') || ''; W.rules.bags_per_mt = v('wBags') || ''; W.rules.mode_a_rt_required = v('wModeA') !== '0';
      W.rules.mode_b = v('wModeB') || ''; W.rules.seuils = v('wSeuils') || ''; W.rules.transport = v('wTransport') || ''; W.rules.autres = v('wAutres') || '';
    }
  }
  function validateStep() {
    if (W.step === 1) {
      var I = W.identity;
      if (!I.code) return T('Code obligatoire.', 'Code required.');
      if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(I.code)) return T('Code : lettres majuscules, chiffres et tirets (ex. 2028).', 'Code: capitals, digits and dashes (e.g. 2028).');
      if ((I.name || '').length < 3) return T('Nom obligatoire (3 caractères minimum).', 'Name required (3 characters minimum).');
      if (!I.start_date || !I.planned_end_date) return T('Dates de début et de fin prévue obligatoires.', 'Start and planned end dates required.');
      if (I.planned_end_date < I.start_date) return T('La fin prévue doit suivre le début.', 'Planned end must follow start.');
    }
    return null;
  }
  function bindWizard(R) {
    function go(n) { collect(); var err = n > W.step ? validateStep() : null; if (err) { var m = root.querySelector('.camp-wizard .card-head'); if (m) { var p = document.createElement('div'); p.innerHTML = notice('danger', esc(err)); m.parentNode.insertBefore(p.firstChild, m.nextSibling); } return; } W.step = n; drawWizard(R); window.scrollTo(0, 0); }
    var prev = document.getElementById('wPrev'), next = document.getElementById('wNext'), save = document.getElementById('wSave');
    if (prev) prev.onclick = function () { go(W.step - 1); };
    if (next) next.onclick = function () { go(W.step + 1); };
    [].slice.call(root.querySelectorAll('[data-step]')).forEach(function (b) { b.onclick = function () { go(Number(b.getAttribute('data-step'))); }; });
    var copySel = document.getElementById('wCopy');
    if (copySel) copySel.onchange = function () {
      collect(); if (!copySel.value) return;
      var keepId = W.identity; fillFrom(copySel.value, true).then(function () { W.identity = keepId; W.identity.copy_from = copySel.value; drawWizard(R); })
        .catch(function (e) { alert(e.message); });
    };
    [].slice.call(root.querySelectorAll('input[data-kind]')).forEach(function (cb) {
      cb.onchange = function () { var k = cb.getAttribute('data-kind'); if (cb.checked) W.sel[k][cb.value] = cb.getAttribute('data-label'); else delete W.sel[k][cb.value]; var c = cb.closest('.camp-pick').querySelector('.camp-pick-actions .muted'); if (c) c.textContent = Object.keys(W.sel[k]).length + ' ' + T('sélectionné(s)', 'selected'); };
    });
    [].slice.call(root.querySelectorAll('[data-all],[data-none]')).forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute('data-all') || b.getAttribute('data-none'), on = b.hasAttribute('data-all');
        [].slice.call(b.closest('.camp-pick').querySelectorAll('label:not([hidden]) input[data-kind]')).forEach(function (cb) { cb.checked = on; if (on) W.sel[k][cb.value] = cb.getAttribute('data-label'); else delete W.sel[k][cb.value]; });
        collect(); drawWizard(R); };
    });
    [].slice.call(root.querySelectorAll('.camp-filter')).forEach(function (inp) {
      inp.oninput = function () { var t = inp.value.trim().toLowerCase(); [].slice.call(inp.closest('.camp-pick').querySelectorAll('label[data-txt]')).forEach(function (l) { l.hidden = t && l.getAttribute('data-txt').indexOf(t) < 0; }); };
    });
    if (save) save.onclick = function () { collect(); saveWizard(save); };
  }
  function saveWizard(btn) {
    var msg = document.getElementById('wMsg'); btn.disabled = true; msg.className = 'muted'; msg.textContent = T('Enregistrement…', 'Saving…');
    var I = W.identity, cid = W.id;
    var cfg = { mode_b: W.rules.mode_b || null, seuils: W.rules.seuils || null, transport: W.rules.transport || null, autres: W.rules.autres || null };
    if (W.rules.bags_per_mt) cfg.sacherie = { bags_per_mt: Number(W.rules.bags_per_mt) };
    var step1 = cid
      ? rpc('campaign_update', { p_id: cid, p: { name: I.name, campaign_type: I.campaign_type, start_date: I.start_date, planned_end_date: I.planned_end_date, season: I.season, description: I.description, currency: I.currency, config: cfg }, p_row_version: W.row_version }).then(function () { return cid; })
      : rpc('campaign_create', { p: { code: I.code, name: I.name, year: I.year, campaign_type: I.campaign_type, start_date: I.start_date, planned_end_date: I.planned_end_date, season: I.season, description: I.description, currency: I.currency, config: cfg, copy_from: I.copy_from || null } });
    step1.then(function (id) {
      cid = id;
      var kinds = Object.keys(W.sel), jobs = [];
      kinds.forEach(function (k) { jobs.push(function () { return rpc('campaign_participants_set', { p_id: cid, p_kind: k, p_items: Object.keys(W.sel[k]).map(function (r) { return { ref_id: r, ref_label: W.sel[k][r] }; }), p_replace: true }); }); });
      jobs.push(function () { return rpc('campaign_participants_set', { p_id: cid, p_kind: 'TEAM', p_items: (W.teams || '').split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { return { ref_id: x.toUpperCase().slice(0, 60), ref_label: x }; }), p_replace: true }); });
      var items = [{ level: 'CAMPAIGN', ref_id: '', target_mt: W.targets.CAMPAIGN || null }];
      ['CHANNEL', 'ZONE', 'CLUSTER', 'COOPERATIVE', 'SUPPLIER'].forEach(function (l) { Object.keys(W.targets[l]).forEach(function (r) { if (W.targets[l][r] !== '') items.push({ level: l, ref_id: r, target_mt: W.targets[l][r] }); }); });
      jobs.push(function () { return rpc('campaign_targets_set', { p_id: cid, p_items: items }); });
      if (W.rules.price_per_kg) jobs.push(function () { return rpc('campaign_rule_set', { p_id: cid, p: { price_per_kg: W.rules.price_per_kg, min_kor: W.rules.min_kor, max_moisture_pct: W.rules.max_moisture_pct, rt_commission_per_kg: W.rules.rt_commission_per_kg, mode_a_rt_required: W.rules.mode_a_rt_required } }); });
      return jobs.reduce(function (p, j) { return p.then(j); }, Promise.resolve());
    }).then(function () {
      REFS = null; var id = cid; W = null; location.hash = '#c/' + id + '/ouverture';
    }).catch(function (e) { btn.disabled = false; msg.className = 'ops-danger-text'; msg.textContent = e.message + (cid && !W.id ? ' ' + T('(la campagne a été créée : complétez-la depuis sa fiche)', '(the campaign was created: complete it from its page)') : ''); if (cid && !W.id) { W.id = cid; } });
  }

  /* ------------------------------------------------------------------ fiche campagne */
  var TABS = [['resume', 'Résumé', 'Summary'], ['ouverture', 'Préparer l’ouverture', 'Prepare opening'], ['cloture', 'Clôture', 'Closing'],
    ['perimetre', 'Périmètre', 'Scope'], ['historique', 'Historique', 'History'], ['instantane', 'Instantané final', 'Final snapshot'], ['suppression', 'Archive & suppression', 'Archive & deletion']];
  function renderDetail(id, tab) {
    paint('<div class="skeleton skeleton-row"></div>');
    Promise.all([q('campaigns', '*', function (r) { return r.eq('id', id).limit(1); }), soft(rpc('campaign_dashboard'), [])]).then(function (rs) {
      var c = rs[0][0]; if (!c) { paint(notice('warn', T('Campagne introuvable (peut-être supprimée).', 'Campaign not found (maybe deleted).')) + '<a class="btn secondary" href="#">← ' + T('Campagnes', 'Campaigns') + '</a>'); return; }
      var d = rs[1].filter(function (x) { return x.id === id; })[0] || {};
      var head = '<div class="ops-pagehead"><div><p class="ops-breadcrumbs"><a href="#">' + T('Campagnes', 'Campaigns') + '</a><span class="sep">/</span>' + esc(c.code) + '</p><h1><span class="mono">' + esc(c.code) + '</span> · ' + esc(c.name) + '</h1>' +
        '<div class="camp-badges">' + badgeType(c.campaign_type) + badgeStatus(c.status) + (c.is_current ? '<span class="badge ok">' + T('Campagne courante', 'Current campaign') + '</span>' : '') + (c.closed_with_reserves ? '<span class="badge warn">' + T('Clôturée avec réserve', 'Closed with reserve') + '</span>' : '') + (c.reopened_count ? '<span class="badge warn">' + T('Rouverte ', 'Reopened ') + c.reopened_count + '×</span>' : '') + '</div></div>' +
        '<div class="ops-actions">' + actions(c) + '</div></div>' +
        (c.status === 'CLOSED' || c.status === 'ARCHIVED' ? notice('info', '<b>' + T('CAMPAGNE ', 'CAMPAIGN ') + esc(statusLabel(c.status).toUpperCase()) + '</b> — ' + T('consultation uniquement. Les référentiels permanents peuvent évoluer pour les campagnes futures ; l’historique de cette campagne reste figé.', 'read only. Master data may evolve for future campaigns; this campaign history stays frozen.')) : '') +
        (c.campaign_type !== 'REAL' ? notice('warn', '<b>' + esc(typeLabel(c.campaign_type).toUpperCase()) + '</b> — ' + T('données de test, jamais mélangées aux chiffres d’une campagne réelle. Supprimable par le workflow contrôlé.', 'test data, never mixed with real campaign figures. Deletable through the controlled workflow.')) : '') +
        '<nav class="ops-subtabs">' + TABS.map(function (t) { return '<a href="#c/' + esc(id) + '/' + t[0] + '" class="' + (t[0] === tab ? 'active' : '') + '">' + esc(T(t[1], t[2])) + '</a>'; }).join('') + '</nav><div id="campTab"><div class="skeleton skeleton-row"></div></div>';
      paint(head); bindActions(c);
      var box = document.getElementById('campTab');
      var fn = { resume: tabResume, ouverture: tabOpen, cloture: tabClose, perimetre: tabScope, historique: tabHistory, instantane: tabSnapshot, suppression: tabDeletion }[tab] || tabResume;
      fn(c, d, box);
    }).catch(function (e) { paint(errBox(e)); });
  }
  function actions(c) {
    var a = [], ctx = CTX();
    if (ctx && ctx.isManagement() && (!ctx.get() || ctx.get().id !== c.id)) a.push('<button class="btn secondary" type="button" data-act="work">' + T('Travailler dans cette campagne', 'Work in this campaign') + '</button>');
    if (can(ADMIN) && ['DRAFT', 'PLANNING', 'READY', 'OPEN', 'CLOSING'].indexOf(c.status) >= 0) a.push('<a class="btn secondary" href="#edit/' + esc(c.id) + '">' + T('Paramétrer', 'Set up') + '</a>');
    if (can(ADMIN) && c.status === 'OPEN' && !c.is_current) a.push('<button class="btn secondary" type="button" data-act="current">' + T('Définir comme campagne courante', 'Make current') + '</button>');
    if (can(ADMIN) && ['DRAFT', 'PLANNING', 'READY'].indexOf(c.status) >= 0) a.push('<a class="btn primary" href="#c/' + esc(c.id) + '/ouverture">' + T('Préparer l’ouverture', 'Prepare opening') + '</a>');
    if (can(ADMIN) && c.status === 'OPEN') a.push('<button class="btn primary" type="button" data-act="closing">' + T('Préparer la clôture', 'Prepare closing') + '</button>');
    if (can(ADMIN) && c.status === 'CLOSING') a.push('<a class="btn primary" href="#c/' + esc(c.id) + '/cloture">' + T('Clôturer', 'Close') + '</a>');
    if (can(ADMIN) && c.status === 'CLOSED') a.push('<button class="btn secondary" type="button" data-act="archive">' + T('Archiver', 'Archive') + '</button>');
    if (role() === 'General Manager' && c.status === 'CLOSED') a.push('<button class="btn secondary" type="button" data-act="reopen">' + T('Rouvrir (exceptionnel)', 'Reopen (exceptional)') + '</button>');
    return a.join('');
  }
  function after(id, tab) { REFS = null; location.hash = '#c/' + id + '/' + (tab || 'resume'); render(); }
  function bindActions(c) {
    [].slice.call(root.querySelectorAll('[data-act]')).forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute('data-act');
        if (act === 'work') return CTX().select(c.id);
        if (act === 'current') return confirmBox({ title: T('Campagne courante', 'Current campaign'), body: '<p>' + T('Les nouvelles opérations sans campagne explicite seront rattachées à ', 'New operations without explicit campaign will go to ') + '<b>' + esc(c.code) + '</b>.</p>', ok: T('Définir', 'Set') })
          .then(function (r) { if (!r) return; rpc('campaign_set_current', { p_id: c.id }).then(function () { after(c.id); }).catch(function (e) { alert(e.message); }); });
        if (act === 'closing') return confirmBox({ title: T('Préparer la clôture de ', 'Prepare closing of ') + c.code, body: '<p>' + T('La campagne passe EN CLÔTURE : plus aucun nouvel achat, nouvelle avance, livraison ou réception ; corrections et rapprochements restent possibles. Le système vérifie ensuite automatiquement les points ouverts.', 'The campaign goes to CLOSING: no new purchase, advance, delivery or reception; corrections and reconciliations remain possible. The system then checks open items automatically.') + '</p>', reasonMin: 0, ok: T('Passer en clôture', 'Start closing') })
          .then(function (r) { if (!r) return; rpc('campaign_start_closing', { p_id: c.id, p_reason: r.reason || null }).then(function () { after(c.id, 'cloture'); }).catch(function (e) { alert(e.message); }); });
        if (act === 'archive') return confirmBox({ title: T('Archiver ', 'Archive ') + c.code, body: '<p>' + T('L’archivage ne supprime aucune donnée : la campagne sort de la navigation quotidienne et reste dans l’historique.', 'Archiving deletes nothing: the campaign leaves daily navigation and stays in history.') + '</p>', reasonMin: 0, ok: T('Archiver', 'Archive') })
          .then(function (r) { if (!r) return; rpc('campaign_archive', { p_id: c.id, p_reason: r.reason || null }).then(function () { after(c.id); }).catch(function (e) { alert(e.message); }); });
        if (act === 'reopen') return confirmBox({ title: T('Réouverture exceptionnelle de ', 'Exceptional reopening of ') + c.code, body: '<p>' + T('La campagne repasse EN CLÔTURE (corrections et rapprochements, aucun nouvel achat). Action tracée : motif, auteur, date.', 'The campaign goes back to CLOSING (corrections and reconciliations, no new purchase). Logged: reason, author, date.') + '</p>', reasonMin: 15, typed: 'ROUVRIR ' + c.code, danger: true, ok: T('Rouvrir', 'Reopen') })
          .then(function (r) { if (!r) return; rpc('campaign_reopen', { p_id: c.id, p_reason: r.reason, p_confirm: r.typed }).then(function () { after(c.id, 'cloture'); }).catch(function (e) { alert(e.message); }); });
      };
    });
  }
  function tabResume(c, d, box) {
    var perf = d.target_mt ? (Number(d.achats_kg) / 1000) / Number(d.target_mt) * 100 : null;
    soft(q('campaign_targets', 'level,ref_id,ref_label,target_mt', function (r) { return r.eq('campaign_id', c.id).order('level'); }), []).then(function (tg) {
      box.innerHTML = '<section class="kpi-grid">' + kpi(T('Objectif', 'Target'), d.target_mt ? num(d.target_mt) + ' MT' : '—', T('niveau campagne', 'campaign level')) +
        kpi(T('Acheté', 'Bought'), mt(d.achats_kg), num(d.achats) + ' ' + T('achats', 'purchases') + ' · ' + num(d.producteurs) + ' ' + T('producteurs', 'farmers')) +
        kpi(T('Coopératives', 'Cooperatives'), num(d.coop_membres), num(d.livraisons_coop) + ' ' + T('livraisons', 'deliveries')) +
        kpi(T('Reçu Warehouse', 'Received'), mt(d.recu_kg), num(d.receptions) + ' ' + T('réceptions', 'receptions')) + kpi(T('Stock (LOT actifs)', 'Stock (active lots)'), num(d.stock_lots), 'LOT') +
        kpi('Factory', mt(d.factory_recu_kg), num(d.transferts) + ' ' + T('transferts', 'transfers')) + kpi(T('Avances', 'Advances'), num(d.avances_xof) + ' XOF', '') +
        kpi('Performance', perf == null ? '—' : num(perf, 1) + ' %', T('acheté / objectif', 'bought / target')) + '</section>' +
        '<section class="card"><div class="card-head"><div><h3>' + T('Identité', 'Identity') + '</h3></div></div><div class="ops-def-grid">' +
        [[T('Code', 'Code'), c.code], [T('Année', 'Year'), c.year], [T('Type', 'Type'), typeLabel(c.campaign_type)], [T('Statut', 'Status'), statusLabel(c.status)], [T('Début', 'Start'), fdate(c.start_date)], [T('Fin prévue', 'Planned end'), fdate(c.planned_end_date)],
          [T('Fin réelle', 'Actual end'), fdate(c.actual_end_date)], [T('Saison', 'Season'), c.season || '—'], [T('Devise', 'Currency'), c.currency], [T('Ouverte le', 'Opened on'), fdt(c.opened_at)], [T('Clôturée le', 'Closed on'), fdt(c.closed_at)], [T('Archivée le', 'Archived on'), fdt(c.archived_at)]]
          .map(function (x) { return '<div><small>' + esc(x[0]) + '</small><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>' + (c.description ? '<p class="muted" style="margin-top:10px">' + esc(c.description) + '</p>' : '') + '</section>' +
        (tg.length ? '<section class="card"><div class="card-head"><div><h3>' + T('Objectifs', 'Targets') + '</h3></div></div><div class="table-wrap"><table><thead><tr><th>' + T('Niveau', 'Level') + '</th><th>' + T('Référence', 'Reference') + '</th><th>MT</th></tr></thead><tbody>' +
          tg.map(function (t) { return '<tr><td>' + esc(t.level) + '</td><td>' + esc(t.ref_label || t.ref_id || '—') + '</td><td>' + (t.target_mt == null ? '—' : num(t.target_mt, 1)) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '');
    });
  }
  function tabOpen(c, d, box) {
    rpc('campaign_open_checklist', { p_id: c.id }).then(function (rows) {
      var missing = rows.filter(function (x) { return x.blocking && !x.ok; });
      var ready = !missing.length, openable = ['DRAFT', 'PLANNING', 'READY'].indexOf(c.status) >= 0;
      box.innerHTML = '<section class="card"><div class="card-head"><div><h3>' + T('Liste de contrôle d’ouverture', 'Opening checklist') + '</h3><p>' + T('Les points marqués « requis » doivent être faits pour ouvrir une campagne réelle.', 'Items marked “required” must be done to open a real campaign.') + '</p></div>' +
        '<span class="camp-ready ' + (ready ? 'ok' : 'ko') + '">' + (openable ? (ready ? T('PRÊT À OUVRIR', 'READY TO OPEN') : T('À COMPLÉTER', 'TO COMPLETE')) : esc(statusLabel(c.status))) + '</span></div>' +
        '<ul class="camp-checklist">' + rows.map(function (x) { return '<li class="' + (x.ok ? 'ok' : x.blocking ? 'ko' : 'warn') + '"><span class="dot"></span><div><b>' + esc(x.label) + '</b>' + (x.blocking ? ' <small class="req">' + T('requis', 'required') + '</small>' : '') + '<small>' + esc(x.detail || '') + '</small></div></li>'; }).join('') + '</ul>' +
        (openable && can(ADMIN) ? '<div class="ops-actions"><a class="btn secondary" href="#edit/' + esc(c.id) + '">' + T('Compléter le paramétrage', 'Complete set-up') + '</a><button class="btn primary" type="button" id="btnOpen"' + (ready ? '' : ' disabled') + '>' + T('OUVRIR LA CAMPAGNE', 'OPEN THE CAMPAIGN') + '</button></div>' : '') + '</section>';
      var b = document.getElementById('btnOpen');
      if (b) b.onclick = function () {
        confirmBox({ title: T('Ouvrir la campagne ', 'Open campaign ') + c.code, body: '<p>' + (c.campaign_type === 'REAL' ? T('La campagne devient la campagne courante : les nouveaux achats y seront rattachés. Une seule campagne réelle peut être ouverte.', 'The campaign becomes the current one: new purchases will be attached to it. Only one real campaign can be open.') : T('Simulation ouverte : utilisable en la sélectionnant dans l’en-tête.', 'Simulation opened: usable by selecting it in the header.')) + '</p>', typed: 'OUVRIR ' + c.code, ok: T('Ouvrir', 'Open') })
          .then(function (r) { if (!r) return; rpc('campaign_open', { p_id: c.id, p_confirm: r.typed }).then(function () { after(c.id); }).catch(function (e) { alert(e.message); }); });
      };
    }).catch(function (e) { box.innerHTML = errBox(e); });
  }
  function tabClose(c, d, box) {
    if (['OPEN', 'CLOSING', 'CLOSED', 'ARCHIVED'].indexOf(c.status) < 0) { box.innerHTML = notice('info', T('La clôture concerne une campagne ouverte.', 'Closing applies to an open campaign.')); return; }
    rpc('campaign_close_checklist', { p_id: c.id }).then(function (rows) {
      var block = rows.filter(function (x) { return x.severity === 'BLOQUANT' && Number(x.n) > 0; }), res = rows.filter(function (x) { return x.severity !== 'BLOQUANT' && Number(x.n) > 0; });
      var nb = block.reduce(function (s, x) { return s + Number(x.n); }, 0), nr = res.reduce(function (s, x) { return s + Number(x.n); }, 0);
      var state = nb ? '<span class="camp-ready ko">' + nb + ' ' + T('anomalie(s) empêchent la clôture', 'issue(s) prevent closing') + '</span>' : nr ? '<span class="camp-ready warn">' + nr + ' ' + T('réserve(s) : clôture avec réserve possible', 'reserve(s): closing with reserve possible') + '</span>' : '<span class="camp-ready ok">' + T('CAMPAGNE PRÊTE À CLÔTURER', 'CAMPAIGN READY TO CLOSE') + '</span>';
      var groups = {}; rows.forEach(function (x) { (groups[x.domain] = groups[x.domain] || []).push(x); });
      box.innerHTML = '<section class="card"><div class="card-head"><div><h3>' + T('Contrôles de clôture', 'Closing checks') + '</h3><p>' + T('Vérification automatique des opérations de la campagne. Aucune anomalie n’est masquée.', 'Automatic check of the campaign operations. No issue is hidden.') + '</p></div>' + state + '</div>' +
        '<p class="muted" style="font-size:11px">' + T('Achats non synchronisés : ils restent sur les téléphones et ne sont pas visibles du serveur. Chaque RT doit synchroniser avant la clôture ; un achat hors ligne d’une campagne clôturée est refusé à la synchronisation, jamais rattaché à la campagne suivante.', 'Unsynchronised purchases stay on phones and are not visible to the server. Each RT must sync before closing; an offline purchase of a closed campaign is refused at sync, never attached to the next campaign.') + '</p>' +
        Object.keys(groups).map(function (dm) {
          return '<h4 class="camp-dom">' + esc(dm) + '</h4><ul class="camp-checklist">' + groups[dm].map(function (x) {
            var n = Number(x.n); return '<li class="' + (n === 0 ? 'ok' : x.severity === 'BLOQUANT' ? 'ko' : 'warn') + '"><span class="dot"></span><div><b>' + esc(x.label) + '</b> <small class="req">' + esc(x.severity === 'BLOQUANT' ? T('bloquant', 'blocking') : T('réserve', 'reserve')) + '</small><small>' + (n ? num(n) + ' ' + T('dossier(s)', 'item(s)') + ' · <a href="' + esc(x.link) + '">' + T('ouvrir', 'open') + ' →</a>' : T('aucun', 'none')) + '</small></div></li>';
          }).join('') + '</ul>';
        }).join('') +
        (c.status === 'CLOSING' && can(ADMIN) ? '<div class="ops-actions"><button class="btn primary" type="button" id="btnClose"' + (nb || nr ? ' disabled' : '') + '>' + T('CLÔTURER LA CAMPAGNE', 'CLOSE THE CAMPAIGN') + '</button>' +
          (nr && !nb ? '<button class="btn secondary" type="button" id="btnCloseRes">' + T('Clôturer avec réserve', 'Close with reserve') + '</button>' : '') + '</div>' : '') +
        (c.status === 'OPEN' && can(ADMIN) ? '<div class="ops-actions"><button class="btn primary" type="button" id="btnStartClosing">' + T('Préparer la clôture', 'Prepare closing') + '</button></div>' : '') + '</section>';
      function doClose(withRes) {
        confirmBox({ title: T('Clôturer la campagne ', 'Close campaign ') + c.code, body: '<p>' + T('Un instantané final figé est créé. Ensuite : aucun nouvel achat, avance, livraison, réception ou transfert ; aucune modification des opérations de la campagne.', 'A frozen final snapshot is created. Then: no new purchase, advance, delivery, reception or transfer; no change to the campaign operations.') + '</p>' + (withRes ? notice('warn', T('Réserves : ', 'Reserves: ') + res.map(function (x) { return esc(x.label) + ' (' + num(x.n) + ')'; }).join(' · ')) : ''), reasonMin: withRes ? 10 : 0, typed: 'CLOTURER ' + c.code, danger: true, ok: T('Clôturer', 'Close') })
          .then(function (r) { if (!r) return; rpc('campaign_close', { p_id: c.id, p_confirm: r.typed, p_reason: r.reason || null, p_with_reserves: !!withRes }).then(function () { after(c.id, 'instantane'); }).catch(function (e) { alert(e.message); }); });
      }
      var b1 = document.getElementById('btnClose'), b2 = document.getElementById('btnCloseRes'), b3 = document.getElementById('btnStartClosing');
      if (b1) b1.onclick = function () { doClose(false); }; if (b2) b2.onclick = function () { doClose(true); };
      if (b3) b3.onclick = function () { var x = root.querySelector('[data-act="closing"]'); if (x) x.click(); };
    }).catch(function (e) { box.innerHTML = errBox(e); });
  }
  function tabScope(c, d, box) {
    q('campaign_participants', 'kind,ref_id,ref_label,active,created_at', function (r) { return r.eq('campaign_id', c.id).order('kind'); }).then(function (rows) {
      var act = rows.filter(function (x) { return x.active; }), groups = {};
      act.forEach(function (x) { (groups[x.kind] = groups[x.kind] || []).push(x); });
      var L = { ZONE: 'Zones', CLUSTER: 'Clusters', VILLAGE: 'Villages', RT: 'RT', ZONE_HEAD: 'Zone Heads', UNIT_HEAD: 'Unit Heads', TEAM: T('Équipes', 'Teams'), COOPERATIVE: T('Coopératives', 'Cooperatives'), LBA: 'LBA', SUPPLIER: T('Fournisseurs', 'Suppliers'), WAREHOUSE: 'Warehouses', FACTORY: 'Factory' };
      box.innerHTML = act.length ? '<div class="camp-scope">' + Object.keys(groups).map(function (k) { return '<section class="card"><h3>' + esc(L[k] || k) + ' <small class="muted">(' + groups[k].length + ')</small></h3><p class="camp-tags">' + groups[k].map(function (x) { return '<span>' + esc(x.ref_label || x.ref_id) + '</span>'; }).join('') + '</p></section>'; }).join('') + '</div>' +
        (rows.length > act.length ? '<p class="muted" style="font-size:11px">' + (rows.length - act.length) + ' ' + T('élément(s) retiré(s) du périmètre, conservé(s) dans l’historique.', 'item(s) removed from scope, kept in history.') + '</p>' : '')
        : notice('info', T('Périmètre non défini. ', 'Scope not set. ') + (can(ADMIN) ? '<a href="#edit/' + esc(c.id) + '">' + T('Paramétrer', 'Set up') + ' →</a>' : ''));
    }).catch(function (e) { box.innerHTML = errBox(e); });
  }
  var EVT = { CAMPAIGN_CREATED: ['Campagne créée', 'Campaign created'], CAMPAIGN_CONFIG_UPDATED: ['Paramétrage modifié', 'Set-up updated'], CAMPAIGN_OPENED: ['Campagne ouverte', 'Campaign opened'],
    CAMPAIGN_CURRENT_SET: ['Définie comme courante', 'Set as current'], CAMPAIGN_CLOSING_STARTED: ['Clôture préparée', 'Closing started'], CAMPAIGN_CLOSED: ['Campagne clôturée', 'Campaign closed'],
    CAMPAIGN_REOPENED: ['Réouverture exceptionnelle', 'Exceptional reopening'], CAMPAIGN_ARCHIVED: ['Campagne archivée', 'Campaign archived'], SIMULATION_EXPORTED: ['Archive exportée', 'Archive exported'], SIMULATION_DELETED: ['Simulation supprimée', 'Simulation deleted'] };
  function tabHistory(c, d, box) {
    q('campaign_events', 'event,actor_email,actor_role,reason,at,details', function (r) { return r.eq('campaign_id', c.id).order('at', { ascending: false }).limit(200); }).then(function (rows) {
      box.innerHTML = rows.length ? '<div class="ops-timeline">' + rows.map(function (e) {
        var lbl = EVT[e.event] ? T(EVT[e.event][0], EVT[e.event][1]) : e.event;
        var det = e.details && e.details.participants ? e.details.participants + ' · ' + e.details.count : e.details && e.details.copied ? T('copie : ', 'copy: ') + Object.keys(e.details.copied).map(function (k) { return k + ' ' + e.details.copied[k]; }).join(', ') : '';
        return '<div class="ops-timeline-item"><time>' + esc(fdt(e.at)) + '</time><div><b>' + esc(lbl) + '</b><small>' + esc([e.actor_role, e.actor_email].filter(Boolean).join(' · ')) + (e.reason ? ' — ' + esc(e.reason) : '') + (det ? ' — ' + esc(det) : '') + '</small></div><span></span></div>';
      }).join('') + '</div>' : notice('info', T('Aucun événement.', 'No event.'));
    }).catch(function (e) { box.innerHTML = errBox(e); });
  }
  function tabSnapshot(c, d, box) {
    q('campaign_snapshots', 'kind,payload,created_at', function (r) { return r.eq('campaign_id', c.id).eq('kind', 'FINAL').order('created_at', { ascending: false }).limit(1); }).then(function (rows) {
      var s = rows[0]; if (!s) { box.innerHTML = notice('info', T('L’instantané final est créé à la clôture.', 'The final snapshot is created at closing.')); return; }
      var p = s.payload || {}, fb = p.field_buying || {}, wh = p.warehouse || {}, lt = p.lots || {}, tr = p.transferts || {}, av = p.avances || {};
      box.innerHTML = notice('info', T('Instantané figé le ', 'Snapshot frozen on ') + esc(fdt(s.created_at)) + T(' : ces chiffres ne changent plus, même si les référentiels évoluent.', ': these figures no longer change, even if master data evolves.')) +
        '<section class="kpi-grid">' + kpi(T('Producteurs actifs', 'Active farmers'), num(fb.producteurs_actifs), num(fb.achats) + ' ' + T('achats', 'purchases')) + kpi(T('Volume acheté', 'Bought'), mt(fb.kg_net), num(fb.montant_xof) + ' XOF') +
        kpi(T('Prix moyen', 'Average price'), fb.prix_moyen_xof_kg ? num(fb.prix_moyen_xof_kg, 1) + ' XOF/kg' : '—', 'KOR ' + (fb.kor_moyen || '—') + ' · ' + T('humidité ', 'moisture ') + (fb.humidite_moyenne || '—')) +
        kpi(T('Reçu Warehouse', 'Received'), mt(wh.net_kg), num(wh.receptions) + ' ' + T('réceptions', 'receptions')) + kpi('LOT', num(lt.lots), mt(lt.kg_initial) + ' · ' + num(lt.stock_reporte_lots) + ' ' + T('reportés', 'carried over')) +
        kpi(T('Transferts', 'Transfers'), num(tr.transferts), T('écart ', 'variance ') + num(tr.ecart_kg) + ' kg') + kpi(T('Avances', 'Advances'), num(av.montant_xof) + ' XOF', num(av.nombre) + ' ' + T('avance(s)', 'advance(s)')) + '</section>' +
        (p.par_rt && p.par_rt.length ? '<section class="card"><h3>' + T('Performance RT', 'RT performance') + '</h3><div class="table-wrap"><table><thead><tr><th>RT</th><th>' + T('Achats', 'Purchases') + '</th><th>Volume</th></tr></thead><tbody>' + p.par_rt.slice(0, 50).map(function (x) { return '<tr><td>' + esc(x.rt || x.rt_id || '—') + '</td><td>' + num(x.achats) + '</td><td>' + mt(x.kg) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '') +
        (p.cooperatives && p.cooperatives.length ? '<section class="card"><h3>' + T('Performance coopératives', 'Cooperative performance') + '</h3><div class="table-wrap"><table><thead><tr><th>' + T('Coopérative', 'Cooperative') + '</th><th>' + T('Objectif', 'Target') + '</th><th>' + T('Livré', 'Delivered') + '</th><th>' + T('Membres', 'Members') + '</th></tr></thead><tbody>' + p.cooperatives.map(function (x) { return '<tr><td>' + esc((x.code || '') + ' · ' + (x.nom || '')) + '</td><td>' + (x.target_mt == null ? '—' : num(x.target_mt, 1) + ' MT') + '</td><td>' + mt(x.livre_kg) + '</td><td>' + num(x.membres) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '') +
        (p.exceptions && p.exceptions.length ? '<section class="card"><h3>' + T('Réserves et exceptions à la clôture', 'Reserves and exceptions at closing') + '</h3><ul class="camp-checklist">' + p.exceptions.map(function (x) { return '<li class="warn"><span class="dot"></span><div><b>' + esc(x.label) + '</b><small>' + num(x.n) + ' · ' + esc(x.severity) + '</small></div></li>'; }).join('') + '</ul></section>' : '');
    }).catch(function (e) { box.innerHTML = errBox(e); });
  }
  function download(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function tabDeletion(c, d, box) {
    var sim = c.campaign_type !== 'REAL';
    box.innerHTML = '<section class="card"><div class="card-head"><div><h3>' + T('Exporter l’archive', 'Export the archive') + '</h3><p>' + T('Fichier JSON complet de la campagne : opérations, périmètre, objectifs, instantanés et journal.', 'Full campaign JSON file: operations, scope, targets, snapshots and log.') + '</p></div><button class="btn secondary" type="button" id="btnExport">' + T('Exporter l’archive', 'Export archive') + '</button></div><p id="expMsg" class="muted"></p></section>' +
      '<section class="card"><div class="card-head"><div><h3>' + T('Analyser la suppression', 'Analyse deletion') + '</h3><p>' + T('Compte tout ce qui serait supprimé et tout ce qui serait conservé. Ne supprime rien.', 'Counts everything that would be deleted and kept. Deletes nothing.') + '</p></div><button class="btn secondary" type="button" id="btnPreview">' + T('Analyser', 'Analyse') + '</button></div><div id="prevBox"></div></section>' +
      (sim ? '<section class="card camp-danger"><div class="card-head"><div><h3>' + T('Supprimer définitivement la simulation', 'Permanently delete the simulation') + '</h3><p>' + T('Supprime uniquement les données de cette campagne. Les producteurs, Farmer ID, villages, RT, coopératives réelles, fournisseurs, warehouses et utilisateurs ne sont jamais supprimés.', 'Deletes this campaign data only. Farmers, Farmer IDs, villages, RT, real cooperatives, suppliers, warehouses and users are never deleted.') + '</p></div>' +
        (can(ADMIN) ? '<button class="btn danger" type="button" id="btnPurge">' + T('Supprimer définitivement', 'Delete permanently') + '</button>' : '') + '</div><p id="purgeMsg" class="muted"></p></section>'
        : notice('info', T('Campagne réelle : jamais supprimée. Clôturée, elle s’archive ; l’archive exportée accompagne la clôture.', 'Real campaign: never deleted. Once closed it is archived; the exported archive accompanies the closing.')));
    document.getElementById('btnExport').onclick = function () {
      var m = document.getElementById('expMsg'); m.textContent = T('Préparation…', 'Preparing…');
      rpc('campaign_export', { p_id: c.id }).then(function (j) { download('ANAGROCI_CAMPAGNE_' + c.code + '_' + new Date().toISOString().slice(0, 10) + '.json', j); m.textContent = T('Archive téléchargée.', 'Archive downloaded.'); })
        .catch(function (e) { m.className = 'ops-danger-text'; m.textContent = e.message; });
    };
    var preview = null;
    document.getElementById('btnPreview').onclick = function () {
      var pb = document.getElementById('prevBox'); pb.innerHTML = '<div class="skeleton skeleton-row"></div>';
      rpc('campaign_purge_preview', { p_id: c.id }).then(function (rows) {
        preview = rows;
        pb.innerHTML = '<div class="table-wrap"><table><thead><tr><th>' + T('Objet', 'Object') + '</th><th>' + T('Table', 'Table') + '</th><th>' + T('Nombre', 'Count') + '</th><th>Action</th></tr></thead><tbody>' +
          rows.map(function (x) { var cls = /CONSERVER/.test(x.action) ? 'ok' : /INTERDIT/.test(x.action) ? 'info' : /OPTION/.test(x.action) ? 'warn' : 'danger'; return '<tr><td>' + esc(x.object) + '</td><td class="mono">' + esc(x.table_name) + '</td><td>' + num(x.n) + '</td><td><span class="badge ' + cls + '">' + esc(x.action) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
      }).catch(function (e) { pb.innerHTML = errBox(e); });
    };
    var bp = document.getElementById('btnPurge');
    if (bp) bp.onclick = function () {
      var typeFr = { SIMULATION: 'SIMULATION', DEMO: 'DEMO', TRAINING: 'FORMATION', QA: 'QA' }[c.campaign_type] || c.campaign_type;
      var expected = 'SUPPRIMER ' + typeFr + ' ' + c.code;
      var sumDel = preview ? preview.filter(function (x) { return x.action === 'SUPPRIMER'; }) : null;
      confirmBox({ title: T('Supprimer définitivement ', 'Permanently delete ') + c.code, danger: true,
        body: (sumDel ? '<p>' + T('Cette suppression retirera : ', 'This deletion removes: ') + sumDel.map(function (x) { return num(x.n) + ' ' + esc(x.object.toLowerCase()); }).join(', ') + '.</p>' : notice('warn', T('Lancez d’abord « Analyser la suppression » pour voir les comptages.', 'Run “Analyse deletion” first to see the counts.'))) +
          '<p>' + T('Exportez l’archive avant de supprimer si vous souhaitez la conserver.', 'Export the archive before deleting if you want to keep it.') + '</p>',
        reasonMin: 10, check: T('Supprimer aussi les producteurs et coopératives explicitement marqués QA pour cette campagne (s’ils ne sont plus utilisés ailleurs)', 'Also delete farmers and cooperatives explicitly flagged QA for this campaign (if no longer used elsewhere)'), typed: expected, ok: T('Supprimer définitivement', 'Delete permanently') })
        .then(function (r) {
          if (!r) return; var m = document.getElementById('purgeMsg'); m.className = 'muted'; m.textContent = T('Suppression…', 'Deleting…');
          rpc('campaign_purge', { p_id: c.id, p_confirm: r.typed, p_reason: r.reason, p_include_qa_masters: !!r.checked }).then(function (res) {
            paint(notice('ok', '<b>' + T('Simulation supprimée.', 'Simulation deleted.') + '</b> ' + esc(Object.keys(res.deleted || {}).map(function (k) { return k + ' : ' + res.deleted[k]; }).join(' · '))) + '<a class="btn secondary" href="#">← ' + T('Campagnes', 'Campaigns') + '</a>');
          }).catch(function (e) {
            m.className = 'ops-danger-text';
            m.textContent = /campaign_purge|could not find|PGRST202|schema cache/i.test(e.message + ' ' + (e.code || ''))
              ? T('La suppression définitive attend l’activation de la migration 4 par la direction (validation humaine requise). L’analyse et l’export fonctionnent déjà.', 'Permanent deletion awaits management approval of migration 4. Analysis and export already work.')
              : e.message;
          });
        });
    };
  }

  /* ------------------------------------------------------------------ démarrage */
  function boot() {
    root = document.getElementById('campRoot'); if (!root) return;
    function go() { render(); }
    if (g.ANAGROCI_AUTH) go(); else document.addEventListener('anagroci:authenticated', go, { once: true });
    window.addEventListener('hashchange', render);
    document.addEventListener('anagroci:language', function () { render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
