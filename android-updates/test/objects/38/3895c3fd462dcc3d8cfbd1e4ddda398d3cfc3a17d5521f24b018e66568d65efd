/* ANAGROCI FBMS - AFLP Farmer Registry 360 passport UI */
(function (global) {
  'use strict';
  var FR = global.AFLP_FARMER_REGISTRY = global.AFLP_FARMER_REGISTRY || {};
  if (FR.passportUI) return;

  var STATE_FR = FR.state = FR.state || {
    producerId: null,
    producer: null,
    summary: null,
    data: {},
    tab: 'overview',
    loading: false,
    error: null,
    pending: 0
  };
  var originalView = null;
  var map = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>\"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c];
    });
  }
  function fmt(value, digits) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('fr-FR', { maximumFractionDigits: digits == null ? 1 : digits });
  }
  function dateFmt(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleDateString('fr-FR'); }
    catch (e) { return String(value); }
  }
  function dateTimeFmt(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleString('fr-FR'); }
    catch (e) { return String(value); }
  }
  function profile() {
    return (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile)
      || (typeof AUTH !== 'undefined' && AUTH.session) || {};
  }
  function supervisor() {
    var role = String(profile().role || '');
    return ['Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor','Zonal Head','Unit Head'].indexOf(role) >= 0;
  }
  function online() { return FR.syncEngine && FR.syncEngine.online(); }
  function producerFromState(id) {
    return typeof STATE !== 'undefined' && STATE.producteurs
      ? STATE.producteurs.find(function (p) { return p.id === id; }) : null;
  }
  async function safeQuery(promise, fallback) {
    try {
      var response = await promise;
      if (response && response.error) throw response.error;
      return response && response.data != null ? response.data : fallback;
    } catch (e) { return fallback; }
  }
  function riskClass(value) {
    return value === 'REVIEW_REQUIRED' || value === 'HIGH' ? 'fr-bad'
      : value === 'MEDIUM' ? 'fr-warn' : value === 'LOW' ? 'fr-ok' : 'fr-neutral';
  }
  function stageClass(value) {
    return value === 'VERIFIED' ? 'fr-ok' : value === 'BASELINE' || value === 'MAPPED'
      ? 'fr-info' : value === 'BASIC' ? 'fr-warn' : 'fr-neutral';
  }
  function syncLabel(value) {
    var v = String(value || 'SYNCED').toUpperCase();
    if (v === 'LOCAL') return ['LOCAL','fr-neutral'];
    if (v === 'PENDING_SYNC' || v === 'PENDING') return ['PENDING SYNC','fr-warn'];
    if (v === 'SYNC_ERROR' || v === 'FAILED') return ['SYNC ERROR','fr-bad'];
    return ['SYNCED','fr-ok'];
  }
  function badge(text, cls) { return '<span class="fr-badge ' + (cls || 'fr-neutral') + '">' + esc(text || '—') + '</span>'; }
  function actionButton(label, handler, kind, disabled) {
    return '<button class="fr-btn ' + (kind || '') + '" onclick="' + handler + '" '
      + (disabled ? 'disabled' : '') + '>' + esc(label) + '</button>';
  }

  function injectStyle() {
    if (document.getElementById('farmer-registry-complete-style')) return;
    var style = document.createElement('style');
    style.id = 'farmer-registry-complete-style';
    style.textContent = [
      '#frPassportOverlay{position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.58);display:flex;justify-content:flex-end}',
      '#frPassportPanel{width:min(1180px,100vw);height:100%;background:#F4F4F3;display:flex;flex-direction:column;box-shadow:-18px 0 55px rgba(0,0,0,.28)}',
      '.fr-head{background:linear-gradient(135deg,#053B23,#0A5531);color:#fff;padding:16px 18px;border-bottom:3px solid #8DC556;display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
      '.fr-head h2{margin:0;font:800 20px Archivo,Arial}.fr-head p{margin:3px 0 0;font-size:12px;color:#CFE3D3}.fr-head .grow{flex:1}',
      '.fr-close{border:0;border-radius:8px;background:#fff;color:#053B23;padding:9px 12px;font-weight:800;cursor:pointer}',
      '.fr-sync{font-size:11px;font-weight:800;border-radius:999px;padding:5px 9px;background:rgba(255,255,255,.14)}',
      '.fr-tabs{display:flex;gap:3px;overflow-x:auto;background:#fff;border-bottom:1px solid #E8E7E7;padding:0 12px;scrollbar-width:none}',
      '.fr-tabs::-webkit-scrollbar{display:none}.fr-tab{flex:none;border:0;background:none;padding:13px 12px;border-bottom:3px solid transparent;font-weight:750;font-size:12px;color:#626160;cursor:pointer}',
      '.fr-tab.on{color:#053B23;border-bottom-color:#008F37}.fr-body{padding:16px;overflow:auto;flex:1}.fr-loading{padding:48px;text-align:center;color:#7A7878}',
      '.fr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.fr-kpi{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:13px;border-top:3px solid #8DC556}',
      '.fr-kpi small{display:block;color:#7A7878;font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:800}.fr-kpi b{display:block;margin-top:5px;color:#053B23;font:750 21px IBM Plex Mono,monospace}',
      '.fr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px}.fr-card{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:14px}',
      '.fr-card h3{margin:0 0 10px;font:750 14px Archivo,Arial;color:#053B23;border-left:4px solid #8DC556;padding-left:9px}.fr-card h4{margin:0 0 8px;color:#053B23}',
      '.fr-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #F0EFED;font-size:12px}.fr-row:last-child{border-bottom:0}.fr-row span:first-child{color:#7A7878}.fr-row b{text-align:right}',
      '.fr-badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:850;white-space:nowrap}.fr-ok{background:#E3F5E8;color:#1C7A3F}.fr-warn{background:#FDEFCE;color:#8A5B00}.fr-bad{background:#FDECE9;color:#B23A2A}.fr-info{background:#E9F1FB;color:#2B5F9E}.fr-neutral{background:#EEEDEA;color:#5F5D5D}',
      '.fr-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.fr-btn{border:0;border-radius:8px;padding:9px 12px;font:750 12px IBM Plex Sans,Arial;background:#008F37;color:#fff;cursor:pointer}.fr-btn:hover{background:#00712C}.fr-btn.secondary{background:#fff;color:#053B23;border:1px solid #CBD4C8}.fr-btn.warn{background:#EE9E00;color:#fff}.fr-btn.danger{background:#B23A2A}.fr-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.fr-table-wrap{overflow:auto;background:#fff;border:1px solid #E8E7E7;border-radius:12px}.fr-table{width:100%;border-collapse:collapse;min-width:760px}.fr-table th{text-align:left;padding:10px;font-size:9.5px;text-transform:uppercase;color:#7A7878;border-bottom:2px solid #008F37}.fr-table td{padding:10px;border-bottom:1px solid #EEEDEA;font-size:12px;vertical-align:top}',
      '.fr-empty{background:#fff;border:1px dashed #CBD4C8;border-radius:12px;padding:28px;text-align:center;color:#7A7878;font-size:12px}',
      '.fr-progress{height:8px;border-radius:999px;background:#E8E7E7;overflow:hidden}.fr-progress i{display:block;height:100%;background:linear-gradient(90deg,#008F37,#8DC556)}',
      '.fr-stage-line{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.fr-stage-step{border-radius:9px;padding:8px;text-align:center;font-size:10px;font-weight:800;background:#EEEDEA;color:#777}.fr-stage-step.done{background:#E0F3DE;color:#053B23}',
      '.fr-list-item{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:13px;margin-bottom:9px}.fr-list-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.fr-list-head b{color:#053B23}.fr-meta{font-size:11px;color:#7A7878;line-height:1.5;margin-top:5px}',
      '.frq-domain{margin-bottom:14px}.frq-domain-head{display:flex;justify-content:space-between;align-items:center;background:#053B23;color:#fff;border-radius:10px 10px 0 0;padding:10px 12px}.frq-domain-head h4{margin:0;font-size:13px}.frq-domain-head span{font-size:10px;color:#CFE3D3}.frq-question{background:#fff;border:1px solid #E8E7E7;border-top:0;padding:12px}.frq-question-title{display:flex;gap:9px;align-items:flex-start}.frq-question-title>div{flex:1}.frq-question-title b{font-size:12px}.frq-question-title small{display:block;color:#7A7878;font-size:10px;margin-top:3px}.frq-code{font:800 10px IBM Plex Mono,monospace;color:#008F37}.frq-risk{font-size:9px;font-weight:800}.frq-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.frq-question label{font-size:10px;font-weight:750;color:#5F5D5D}.frq-question select,.frq-question textarea{width:100%;margin-top:4px;border:1px solid #CBD4C8;border-radius:7px;padding:8px;font:12px IBM Plex Sans,Arial;background:#fff}.frq-observation{display:block;margin-top:8px}.frq-observation textarea{min-height:48px}',
      '.fr-map{height:320px;border-radius:12px;border:1px solid #CBD4C8;background:#E8E7E7;margin-top:12px}',
      '.fr-register-kpis{margin-bottom:16px}.fr-passport-list-chip{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}.fr-passport-open{margin-right:4px}',
      '@media(max-width:700px){.fr-body{padding:11px}.fr-head{padding:13px}.fr-kpis{grid-template-columns:repeat(2,1fr)}.fr-grid{grid-template-columns:1fr}.fr-stage-line{grid-template-columns:repeat(2,1fr)}.frq-grid{grid-template-columns:1fr}#frPassportPanel{width:100vw}}'
    ].join('');
    document.head.appendChild(style);
  }

  async function loadData(producerId) {
    STATE_FR.loading = true;
    STATE_FR.error = null;
    renderPassport();
    var producer = producerFromState(producerId);
    STATE_FR.producer = producer || { id: producerId };
    var code = producer && producer.code ? producer.code : '';

    if (!online()) {
      STATE_FR.summary = producer ? {
        producteur_id: producer.id, farmer_id: producer.code, nom: producer.nom,
        prenoms: producer.prenoms, village_nom: producer.villageNom,
        passport_stage: producer.passportStage || 'INCOMPLETE',
        passport_completion: producer.passportCompletion || 0,
        risk_profile: producer.riskProfile || 'NOT_ASSESSED'
      } : null;
      STATE_FR.data = {
        plots: await FR.syncEngine.listCache('farmer_plots', producerId),
        production: await FR.syncEngine.listCache('farmer_production_baselines', producerId),
        sustainability: await FR.syncEngine.listCache('farmer_sustainability_baselines', producerId),
        inspections: await FR.syncEngine.listCache('farmer_inspections', producerId),
        actions: await FR.syncEngine.listCache('farmer_action_plans', producerId),
        visits: await FR.syncEngine.listCache('farmer_visits', producerId),
        verifications: await FR.syncEngine.listCache('farmer_verifications', producerId),
        catalog: await FR.syncEngine.listCache('sustainability_question_catalog')
      };
    } else {
      var results = await Promise.all([
        safeQuery(SB.from('farmer_passport_summary_v').select('*').eq('producteur_id', producerId).maybeSingle(), null),
        safeQuery(SB.from('farmer_plots').select('*').eq('producteur_id', producerId).eq('deleted', false).order('created_at'), []),
        safeQuery(SB.from('farmer_production_baselines').select('*').eq('producteur_id', producerId).order('campaign', { ascending: false }).order('version', { ascending: false }), []),
        safeQuery(SB.from('farmer_sustainability_baselines').select('*').eq('producteur_id', producerId).order('created_at', { ascending: false }), []),
        safeQuery(SB.from('farmer_inspections').select('*').eq('producteur_id', producerId).order('inspection_date', { ascending: false }), []),
        safeQuery(SB.from('farmer_action_plans_effective_v').select('*').eq('producteur_id', producerId).order('created_at', { ascending: false }), []),
        safeQuery(SB.from('farmer_visits').select('*').eq('producteur_id', producerId).order('visit_date', { ascending: false }), []),
        safeQuery(SB.from('farmer_verifications').select('*').eq('producteur_id', producerId).order('verified_at', { ascending: false }), []),
        safeQuery(SB.from('sustainability_question_catalog').select('*').eq('active', true).order('sequence_no'), []),
        safeQuery(SB.from('achats').select('id,date,poids_net,prix_kg,montant,qualite_statut,statut_validation,numero_recu,producteur_id').in('producteur_id', [producerId, code]).order('date', { ascending: false }).limit(100), []),
        safeQuery(SB.from('sacs_mouvements').select('id,date,type,source,destination,quantite,producteur_id,observation,business_status').in('producteur_id', [producerId, code]).order('date', { ascending: false }).limit(100), []),
        safeQuery(SB.from('participants_formation').select('*').eq('producteur_id', producerId), [])
      ]);

      STATE_FR.summary = results[0];
      STATE_FR.data = {
        plots: await FR.syncEngine.mergeRows('farmer_plots', results[1], producerId),
        production: await FR.syncEngine.mergeRows('farmer_production_baselines', results[2], producerId),
        sustainability: await FR.syncEngine.mergeRows('farmer_sustainability_baselines', results[3], producerId),
        inspections: await FR.syncEngine.mergeRows('farmer_inspections', results[4], producerId),
        actions: await FR.syncEngine.mergeRows('farmer_action_plans', results[5], producerId),
        visits: await FR.syncEngine.mergeRows('farmer_visits', results[6], producerId),
        verifications: await FR.syncEngine.mergeRows('farmer_verifications', results[7], producerId),
        catalog: results[8], purchases: results[9], bags: results[10], training: results[11]
      };
      await FR.syncEngine.cacheRows('sustainability_question_catalog', results[8]);

      var sessionIds = (results[11] || []).map(function (x) { return x.session_id; }).filter(Boolean);
      STATE_FR.data.trainingSessions = sessionIds.length
        ? await safeQuery(SB.from('sessions_formation').select('*').in('id', sessionIds), []) : [];

      var entityIds = [producerId]
        .concat((STATE_FR.data.plots || []).map(function (x) { return String(x.id); }))
        .concat((STATE_FR.data.sustainability || []).map(function (x) { return String(x.id); }))
        .concat((STATE_FR.data.inspections || []).map(function (x) { return String(x.id); }))
        .concat((STATE_FR.data.actions || []).map(function (x) { return String(x.id); }));
      STATE_FR.data.documents = entityIds.length
        ? await safeQuery(SB.from('preuves').select('*').in('entite_id', entityIds).order('horodatage_serveur', { ascending: false }), []) : [];
    }

    STATE_FR.pending = await FR.syncEngine.pendingCount(producerId);
    STATE_FR.loading = false;
    renderPassport();
  }

  function headerHtml() {
    var s = STATE_FR.summary || {};
    var p = STATE_FR.producer || {};
    var sync = STATE_FR.pending ? 'PENDING SYNC ' + STATE_FR.pending : online() ? 'SYNCED' : 'LOCAL';
    return '<div class="fr-head"><div><h2>' + esc(s.nom || p.nom || 'Farmer Passport')
      + '</h2><p>' + esc(s.farmer_id || p.code || 'ID en attente') + ' · '
      + esc(s.village_nom || p.villageNom || 'Village non renseigné') + ' · '
      + esc(s.rt_nom || 'RT non renseigné') + '</p></div><div class="grow"></div>'
      + badge(s.passport_stage || p.passportStage || 'INCOMPLETE', stageClass(s.passport_stage || p.passportStage))
      + badge((s.passport_completion != null ? s.passport_completion : p.passportCompletion || 0) + '%', 'fr-info')
      + badge(s.risk_profile || p.riskProfile || 'NOT_ASSESSED', riskClass(s.risk_profile || p.riskProfile))
      + '<span class="fr-sync">' + esc(sync) + '</span>'
      + '<button class="fr-close" onclick="closeFarmerPassport()">Fermer</button></div>';
  }

  var TABS = [
    ['overview','Overview'],['plots','Parcelles'],['production','Production'],
    ['sustainability','Sustainability'],['training','Formations'],['inspections','Inspections'],
    ['actions','Plans d’action'],['visits','Visites'],['purchases','Achats'],
    ['bags','Sacs'],['documents','Documents']
  ];
  function tabsHtml() {
    return '<div class="fr-tabs">' + TABS.map(function (tab) {
      return '<button class="fr-tab ' + (STATE_FR.tab === tab[0] ? 'on' : '')
        + '" onclick="setFarmerPassportTab(\'' + tab[0] + '\')">' + esc(tab[1]) + '</button>';
    }).join('') + '</div>';
  }

  function kpi(label, value, sub) {
    return '<div class="fr-kpi"><small>' + esc(label) + '</small><b>' + esc(value) + '</b>'
      + (sub ? '<div class="fr-meta">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function row(label, value) { return '<div class="fr-row"><span>' + esc(label) + '</span><b>' + esc(value == null || value === '' ? '—' : value) + '</b></div>'; }

  function overviewHtml() {
    var s = STATE_FR.summary || {};
    var p = STATE_FR.producer || {};
    var d = STATE_FR.data || {};
    var stage = s.passport_stage || p.passportStage || 'INCOMPLETE';
    var stages = ['BASIC','MAPPED','BASELINE','VERIFIED'];
    var rank = { INCOMPLETE: 0, BASIC: 1, MAPPED: 2, BASELINE: 3, VERIFIED: 4 }[stage] || 0;
    return '<div class="fr-kpis">'
      + kpi('Complétude', (s.passport_completion || 0) + '%', 'Documentaire')
      + kpi('Parcelles', String(s.plot_count || (d.plots || []).length), 'Exploitations enregistrées')
      + kpi('Surface déclarée', fmt(s.declared_area_ha || 0) + ' ha', 'DECLARED')
      + kpi('GPS mappé', String(s.gps_mapped_count || 0), 'Points capturés')
      + kpi('Baseline production', String(s.production_baseline_count || 0), s.production_campaign || '')
      + kpi('Baseline Sustainability', String(s.sustainability_baseline_count || 0), s.latest_sustainability_risk || '')
      + kpi('Formations', String(s.training_count || (d.training || []).length), dateFmt(s.last_training_date))
      + kpi('Actions ouvertes', String(s.open_action_count || 0), (s.overdue_action_count || 0) + ' en retard')
      + '</div><div class="fr-grid">'
      + '<section class="fr-card"><h3>Identité et rattachement AFLP</h3>'
      + row('Farmer ID', s.farmer_id || p.code) + row('Nom complet', (s.nom || p.nom || '') + ' ' + (s.prenoms || p.prenoms || ''))
      + row('Téléphone', s.telephone || p.telephone) + row('Village', s.village_nom || p.villageNom)
      + row('Cluster', s.cluster_label) + row('Zone', s.zone_label) + row('RT', s.rt_nom)
      + row('Consentement', s.consent_status || p.consentStatus) + '</section>'
      + '<section class="fr-card"><h3>Maturité du Farmer Passport</h3><div class="fr-stage-line">'
      + stages.map(function (x, i) { return '<div class="fr-stage-step ' + (rank >= i + 1 ? 'done' : '') + '">' + x + '</div>'; }).join('')
      + '</div><div style="margin-top:14px"><div class="fr-progress"><i style="width:' + Math.min(100, Number(s.passport_completion || 0)) + '%"></i></div></div>'
      + '<div class="fr-meta">BASIC : identité, rattachement et consentement. MAPPED : parcelle + GPS. BASELINE : production + Sustainability. VERIFIED : validation terrain explicite.</div></section>'
      + '<section class="fr-card"><h3>Risque et traçabilité</h3>'
      + row('Risk Profile', s.risk_profile || p.riskProfile) + row('Dernier achat', dateFmt(s.last_purchase_date))
      + row('Dernier volume', s.last_purchase_kg != null ? fmt(s.last_purchase_kg) + ' kg' : '—')
      + row('Inspections', s.inspection_count || 0) + row('Visites', s.visit_count || 0)
      + row('Mouvements de sacs', s.bag_movement_count || 0) + '</section>'
      + '<section class="fr-card"><h3>Actions rapides</h3><div class="fr-actions">'
      + actionButton('+ Parcelle','openFarmerPlotForm()', '')
      + actionButton('+ Baseline production','openProductionBaselineForm()', 'secondary')
      + actionButton('+ Sustainability','openSustainabilityBaselineForm()', 'secondary')
      + actionButton('+ Inspection','openFarmerInspectionForm()', 'secondary')
      + actionButton('+ Visite','openFarmerVisitForm()', 'secondary')
      + (supervisor() ? actionButton('Vérifier le passeport','openFarmerVerificationForm()', 'warn', stage !== 'BASELINE' && stage !== 'VERIFIED') : '')
      + '</div></section></div>';
  }

  function plotsHtml() {
    var rows = STATE_FR.data.plots || [];
    return '<div class="fr-actions">' + actionButton('+ Ajouter une parcelle','openFarmerPlotForm()', '') + '</div>'
      + (rows.length ? rows.map(function (x) {
        var sync = syncLabel(x._sync_status);
        return '<article class="fr-list-item"><div class="fr-list-head"><div><b>' + esc(x.local_name || 'Parcelle sans nom') + '</b>'
          + '<div class="fr-meta">' + esc(fmt(x.declared_area) + ' ' + (x.area_unit || 'HA')) + ' · ' + esc(x.land_tenure_status || 'UNKNOWN')
          + ' · ' + esc(x.evidence_level || 'DECLARED') + '</div></div><div>' + badge(x.gps_status, x.gps_status === 'GPS_VERIFIED' ? 'fr-ok' : x.gps_status === 'POINT_CAPTURED' ? 'fr-info' : 'fr-warn')
          + ' ' + badge(sync[0], sync[1]) + '</div></div><div class="fr-meta">GPS : '
          + (x.latitude != null ? fmt(x.latitude, 6) + ', ' + fmt(x.longitude, 6) + ' · précision ' + fmt(x.gps_accuracy_m, 0) + ' m' : 'non capturé')
          + '</div><div class="fr-actions">' + actionButton('Modifier','openFarmerPlotForm(\'' + x.id + '\')','secondary') + '</div></article>';
      }).join('') : '<div class="fr-empty">Aucune parcelle. Le passeport ne peut pas atteindre MAPPED sans parcelle et point GPS.</div>')
      + (rows.some(function (x) { return x.latitude != null && x.longitude != null; }) ? '<div id="frPlotMap" class="fr-map"></div>' : '');
  }

  function productionHtml() {
    var rows = STATE_FR.data.production || [];
    return '<div class="fr-actions">' + actionButton('+ Nouvelle baseline production','openProductionBaselineForm()', '') + '</div>'
      + (rows.length ? '<div class="fr-table-wrap"><table class="fr-table"><thead><tr><th>Campagne</th><th>Version</th><th>Surface productive</th><th>Production précédente</th><th>Prévision</th><th>Rendement</th><th>Preuve</th><th>Statut</th><th></th></tr></thead><tbody>'
      + rows.map(function (x) { var sync=syncLabel(x._sync_status); return '<tr><td><b>' + esc(x.campaign) + '</b></td><td>v' + esc(x.version || 1) + '</td><td>' + fmt(x.productive_area_ha) + ' ha</td><td>' + fmt(x.previous_production_kg) + ' kg</td><td>' + fmt(x.forecast_kg) + ' kg</td><td>' + fmt(x.yield_kg_ha) + ' kg/ha</td><td>' + badge(x.evidence_level,'fr-info') + '</td><td>' + badge(x.status,x.status==='FINAL'?'fr-ok':'fr-warn') + ' ' + badge(sync[0],sync[1]) + '</td><td>' + (x.status==='DRAFT'?actionButton('Ouvrir','openProductionBaselineForm(\''+x.id+'\')','secondary'):'') + '</td></tr>'; }).join('')
      + '</tbody></table></div>' : '<div class="fr-empty">Aucune baseline production finalisée.</div>');
  }

  function sustainabilityHtml() {
    var rows = STATE_FR.data.sustainability || [];
    return '<div class="fr-actions">' + actionButton('+ Nouvelle baseline Sustainability','openSustainabilityBaselineForm()', '') + '</div>'
      + (rows.length ? rows.map(function (x) { var sync=syncLabel(x._sync_status); return '<article class="fr-list-item"><div class="fr-list-head"><div><b>' + esc(x.campaign) + ' · version ' + esc(x.version || 1) + '</b><div class="fr-meta">' + dateFmt(x.inspection_date) + ' · catalogue ' + esc(x.catalog_version) + ' · ' + esc(x.answered_count || 0) + '/' + esc(x.required_count || 25) + ' réponses</div></div><div>' + badge(x.risk_profile,riskClass(x.risk_profile)) + ' ' + badge(x.status,x.status==='FINAL'?'fr-ok':'fr-warn') + ' ' + badge(sync[0],sync[1]) + '</div></div><div class="fr-actions">' + actionButton(x.status==='DRAFT'?'Continuer':'Consulter','openSustainabilityBaselineForm(\''+x.id+'\')',x.status==='DRAFT'?'':'secondary') + '</div></article>'; }).join('')
      : '<div class="fr-empty">Aucune baseline Sustainability. Le risque reste NOT_ASSESSED.</div>');
  }

  function trainingHtml() {
    var rows = STATE_FR.data.training || [], sessions = STATE_FR.data.trainingSessions || [];
    var smap = {}; sessions.forEach(function (x) { smap[x.id]=x; });
    return '<div class="fr-actions">' + actionButton('+ Rattacher une formation','openFarmerTrainingForm()', '') + '</div>'
      + (rows.length ? rows.map(function (x) { var s=smap[x.session_id]||{}; return '<article class="fr-list-item"><div class="fr-list-head"><b>' + esc(s.theme || x.competency_topic || 'Formation AFLP') + '</b>' + badge(x.attendance_status || 'PRESENT',x.attendance_status==='PRESENT'?'fr-ok':'fr-warn') + '</div><div class="fr-meta">' + dateFmt(s.date_session || x.created_at) + ' · ' + esc(x.location || s.village_id || '') + ' · contrôle ' + esc(x.controle_statut || 'non_controle') + '</div></article>'; }).join('')
      : '<div class="fr-empty">Aucune formation rattachée au Farmer ID.</div>');
  }

  function inspectionsHtml() {
    var rows=STATE_FR.data.inspections||[];
    return '<div class="fr-actions">'+actionButton('+ Nouvelle inspection','openFarmerInspectionForm()','')+'</div>'
      +(rows.length?rows.map(function(x){var sync=syncLabel(x._sync_status);return '<article class="fr-list-item"><div class="fr-list-head"><div><b>'+esc(x.inspection_type)+'</b><div class="fr-meta">'+dateFmt(x.inspection_date)+' · '+esc(x.inspector_name||'Inspecteur')+'</div></div><div>'+badge(x.risk_profile,riskClass(x.risk_profile))+' '+badge(x.status,x.status==='FINAL'?'fr-ok':'fr-warn')+' '+badge(sync[0],sync[1])+'</div></div><div class="fr-actions">'+actionButton(x.status==='DRAFT'?'Continuer':'Consulter','openFarmerInspectionForm(\''+x.id+'\')',x.status==='DRAFT'?'':'secondary')+'</div></article>';}).join(''):'<div class="fr-empty">Aucune inspection terrain enregistrée.</div>');
  }

  function actionsHtml() {
    var rows=STATE_FR.data.actions||[];
    return '<div class="fr-actions">'+actionButton('+ Action manuelle','openFarmerActionForm()','')+'</div>'
      +(rows.length?'<div class="fr-table-wrap"><table class="fr-table"><thead><tr><th>Priorité</th><th>Catégorie</th><th>Problème</th><th>Action</th><th>Responsable</th><th>Échéance</th><th>Statut</th><th></th></tr></thead><tbody>'
      +rows.map(function(x){var st=x.effective_status||x.status;return '<tr><td>'+badge(x.priority,x.priority==='CRITICAL'?'fr-bad':x.priority==='HIGH'?'fr-warn':'fr-info')+'</td><td>'+esc(x.category)+'</td><td>'+esc(x.issue)+'</td><td>'+esc(x.corrective_action)+'</td><td>'+esc(x.responsible_name||'—')+'</td><td>'+dateFmt(x.due_date)+'</td><td>'+badge(st,st==='CLOSED'?'fr-ok':st==='OVERDUE'?'fr-bad':'fr-warn')+'</td><td>'+actionButton('Mettre à jour','openFarmerActionForm(\''+x.id+'\')','secondary')+'</td></tr>';}).join('')+'</tbody></table></div>'
      :'<div class="fr-empty">Aucune action corrective ouverte.</div>');
  }

  function visitsHtml(){var rows=STATE_FR.data.visits||[];return '<div class="fr-actions">'+actionButton('+ Nouvelle visite','openFarmerVisitForm()','')+'</div>'+(rows.length?rows.map(function(x){return '<article class="fr-list-item"><div class="fr-list-head"><b>'+esc(x.visit_type)+'</b>'+badge(dateFmt(x.visit_date),'fr-info')+'</div><div class="fr-meta">'+esc(x.purpose||'')+(x.outcome?' · Résultat : '+esc(x.outcome):'')+(x.next_action?' · Suite : '+esc(x.next_action):'')+'</div></article>';}).join(''):'<div class="fr-empty">Aucune visite terrain enregistrée.</div>');}

  function purchasesHtml(){var rows=STATE_FR.data.purchases||[];return rows.length?'<div class="fr-table-wrap"><table class="fr-table"><thead><tr><th>Date</th><th>Poids net</th><th>Prix</th><th>Montant</th><th>Qualité</th><th>Validation</th><th>Reçu</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+dateFmt(x.date)+'</td><td>'+fmt(x.poids_net)+' kg</td><td>'+fmt(x.prix_kg)+' F/kg</td><td>'+fmt(x.montant,0)+' F</td><td>'+esc(x.qualite_statut||'—')+'</td><td>'+esc(x.statut_validation||'—')+'</td><td>'+esc(x.numero_recu||'—')+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="fr-empty">Aucun achat rattaché à ce Farmer ID.</div>';}
  function bagsHtml(){var rows=STATE_FR.data.bags||[];return rows.length?'<div class="fr-table-wrap"><table class="fr-table"><thead><tr><th>Date</th><th>Type</th><th>Flux</th><th>Quantité</th><th>Statut</th><th>Observation</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+dateFmt(x.date)+'</td><td>'+esc(x.type)+'</td><td>'+esc((x.source||'')+' → '+(x.destination||''))+'</td><td>'+fmt(x.quantite,0)+'</td><td>'+esc(x.business_status||'—')+'</td><td>'+esc(x.observation||'—')+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="fr-empty">Aucun mouvement de sacs rattaché à ce Farmer ID.</div>';}
  function documentsHtml(){var rows=STATE_FR.data.documents||[];return '<div class="fr-actions">'+actionButton('+ Ajouter une preuve','openFarmerDocumentForm()','')+'</div>'+(rows.length?rows.map(function(x){return '<article class="fr-list-item"><div class="fr-list-head"><div><b>'+esc(x.type_preuve||'Document')+'</b><div class="fr-meta">'+esc(x.entite_type)+' · '+dateTimeFmt(x.horodatage_serveur||x.horodatage_client)+'</div></div>'+badge(x.sha256?'HASHED':'NO HASH',x.sha256?'fr-ok':'fr-warn')+'</div><div class="fr-meta">'+esc(x.storage_path)+'</div></article>';}).join(''):'<div class="fr-empty">Aucune preuve ou document rattaché.</div>');}

  function bodyHtml(){
    if(STATE_FR.loading)return '<div class="fr-loading">Chargement du Farmer Passport…</div>';
    if(STATE_FR.error)return '<div class="fr-empty">'+esc(STATE_FR.error)+'</div>';
    var mapTab={overview:overviewHtml,plots:plotsHtml,production:productionHtml,sustainability:sustainabilityHtml,training:trainingHtml,inspections:inspectionsHtml,actions:actionsHtml,visits:visitsHtml,purchases:purchasesHtml,bags:bagsHtml,documents:documentsHtml};
    return (mapTab[STATE_FR.tab]||overviewHtml)();
  }

  function renderPassport(){
    var root=document.getElementById('frPassportRoot');if(!root)return;
    root.innerHTML='<div id="frPassportOverlay" onclick="if(event.target.id===\'frPassportOverlay\')closeFarmerPassport()"><div id="frPassportPanel" onclick="event.stopPropagation()">'+headerHtml()+tabsHtml()+'<main class="fr-body">'+bodyHtml()+'</main></div></div>';
    if(STATE_FR.tab==='plots')setTimeout(mountPlotMap,30);
  }
  function mountPlotMap(){
    var el=document.getElementById('frPlotMap');if(!el||!global.L)return;
    if(map){try{map.remove();}catch(e){}map=null;}
    var points=(STATE_FR.data.plots||[]).filter(function(x){return x.latitude!=null&&x.longitude!=null;});
    if(!points.length)return;
    map=L.map(el).setView([Number(points[0].latitude),Number(points[0].longitude)],15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
    var markers=[];points.forEach(function(x){var m=L.marker([Number(x.latitude),Number(x.longitude)]).addTo(map).bindPopup('<b>'+esc(x.local_name||'Parcelle')+'</b><br>'+esc(fmt(x.declared_area)+' '+(x.area_unit||'HA'))+'<br>'+esc(x.gps_status));markers.push(m);});
    if(markers.length>1)map.fitBounds(L.featureGroup(markers).getBounds().pad(.2));
  }

  async function openPassport(id){
    injectStyle();
    var root=document.getElementById('frPassportRoot');
    if(!root){root=document.createElement('div');root.id='frPassportRoot';document.body.appendChild(root);}
    STATE_FR.producerId=id;STATE_FR.tab='overview';STATE_FR.data={};STATE_FR.summary=null;STATE_FR.producer=producerFromState(id);renderPassport();
    await loadData(id);
  }
  function closePassport(){var root=document.getElementById('frPassportRoot');if(root)root.innerHTML='';if(map){try{map.remove();}catch(e){}map=null;}STATE_FR.producerId=null;}
  function setTab(tab){STATE_FR.tab=tab;renderPassport();}
  async function refresh(){if(STATE_FR.producerId)await loadData(STATE_FR.producerId);}

  async function registryKpis(){
    var el=document.getElementById('frRegistryKpis');if(!el)return;
    var rows=[];
    if(online()&&typeof STATE!=='undefined'&&STATE.prodVillageId){rows=await safeQuery(SB.from('farmer_passport_summary_v').select('*').eq('village_id',STATE.prodVillageId).eq('deleted',false),[]);}else if(typeof STATE!=='undefined'){rows=(STATE.producteurs||[]).filter(function(p){return !STATE.prodVillageId||p.villageId===STATE.prodVillageId;});}
    var total=rows.length,active=rows.filter(function(x){return (x.operational_status||x.operationalStatus||'ACTIVE')==='ACTIVE';}).length;
    var complete=rows.filter(function(x){return ['MAPPED','BASELINE','VERIFIED'].indexOf(x.passport_stage||x.passportStage)>=0;}).length;
    var gps=rows.filter(function(x){return Number(x.gps_mapped_count||0)>0;}).length;
    var sust=rows.filter(function(x){return Number(x.sustainability_baseline_count||0)>0;}).length;
    var trained=rows.filter(function(x){return Number(x.training_count||0)>0;}).length;
    var review=rows.filter(function(x){return x.review_required||x.reviewRequired||(x.risk_profile||x.riskProfile)==='REVIEW_REQUIRED';}).length;
    var actions=rows.reduce(function(n,x){return n+Number(x.open_action_count||0);},0);
    el.innerHTML='<div class="fr-kpis">'+kpi('Total producteurs',String(total))+kpi('Actifs',String(active))+kpi('Passport avancé',String(complete))+kpi('GPS mappé',String(gps))+kpi('Sustainability',String(sust))+kpi('Formés',String(trained))+kpi('À revoir',String(review))+kpi('Actions ouvertes',String(actions))+'</div>';
  }

  function enhanceListDom(){
    if(typeof STATE==='undefined'||STATE.active!=='producteurs')return;
    var rows=document.querySelectorAll('#content table tbody tr');
    rows.forEach(function(tr){
      var cells=tr.querySelectorAll('td');if(cells.length<2)return;
      var code=(cells[0].textContent||'').trim().split(/\s+/)[0];
      var p=(STATE.producteurs||[]).find(function(x){return x.code===code;});if(!p)return;
      if(!cells[1].querySelector('.fr-passport-list-chip')){
        var chips=document.createElement('div');chips.className='fr-passport-list-chip';
        chips.innerHTML=badge(p.passportStage||'INCOMPLETE',stageClass(p.passportStage))+badge((p.passportCompletion||0)+'%','fr-info')+badge(p.riskProfile||'NOT_ASSESSED',riskClass(p.riskProfile));
        cells[1].appendChild(chips);
      }
      var last=cells[cells.length-1];if(last&&!last.querySelector('.fr-passport-open')){
        var btn=document.createElement('button');btn.className='fr-passport-open fr-btn secondary';btn.textContent='Passport';btn.onclick=function(){openPassport(p.id);};last.insertBefore(btn,last.firstChild);
      }
    });
  }

  function patchView(){
    if(typeof global.ProducteursView!=='function'||originalView)return false;
    originalView=global.ProducteursView;
    global.ProducteursView=function(){
      var html=String(originalView.apply(this,arguments));
      html=html.replace(/<h1([^>]*)>Producteurs<\/h1>/,'<h1$1>AFLP Farmer Registry</h1>');
      html=html.replace('AFLP Farmer Registry · Farmer Passport · consentement · traçabilité, avec cache par village.','Producteurs · Parcelles · GPS · Production · Sustainability · Traçabilité');
      html=html.replace('<div class="flex items-center gap-2 flex-wrap">','<div id="frRegistryKpis" class="fr-register-kpis"></div><div class="flex items-center gap-2 flex-wrap">');
      setTimeout(function(){registryKpis();enhanceListDom();},0);
      return html;
    };
    return true;
  }

  function install(){
    if(!FR.syncEngine||!FR.assessment||typeof global.ProducteursView!=='function')return false;
    injectStyle();patchView();
    global.openFarmerPassport=openPassport;global.closeFarmerPassport=closePassport;global.setFarmerPassportTab=setTab;
    document.addEventListener('aflp:farmer-registry-synced',refresh);
    document.addEventListener('aflp:farmer-registry-status',async function(){if(STATE_FR.producerId){STATE_FR.pending=await FR.syncEngine.pendingCount(STATE_FR.producerId);renderPassport();}});
    FR.passportUI={version:'1.0.0',open:openPassport,close:closePassport,refresh:refresh,render:renderPassport,loadData:loadData,supervisor:supervisor,escape:esc,format:fmt,dateFmt:dateFmt};
    return true;
  }
  var attempts=0,timer=setInterval(function(){attempts+=1;if(install()||attempts>120)clearInterval(timer);},100);
})(window);
