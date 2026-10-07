/* FIELD BUYING · Coopératives AFLP · Enrôlement des producteurs
   ------------------------------------------------------------------------------
   Trois actions distinctes depuis l'onglet Producteurs d'une coopérative :
     1. « + Enrôler un producteur »         formulaire complet → aflp_coop_enroll_producer
     2. « Associer un producteur existant » recherche registre → aflp_coop_add_member
     3. « Importer Excel »                  assistant d'import (aflp-cooperatives.js)
   + la file « À vérifier » (doublons possibles, dossiers à compléter) →
     aflp_coop_review_decide.
   Règles : un seul registre (public.producteurs) ; recherche anti-doublon AVANT
   toute création ; un Farmer ID existant n'est jamais recréé ni modifié ; rien
   n'est déduit (consentement NON RECUEILLI par défaut, champs vides = NON COLLECTÉ).
   La base reste l'arbitre : chaque règle est revérifiée côté serveur. */
(function (global) {
'use strict';

function K() { return global.ANAGROCI_COOP && global.ANAGROCI_COOP._k; }
var LANGS = [['FR', 'Français', 'French'], ['BAOULE', 'Baoulé', 'Baoule'], ['DIOULA', 'Dioula', 'Dioula'], ['SENOUFO', 'Sénoufo', 'Senufo'], ['AUTRE', 'Autre', 'Other']];
var BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
var CONSENT_METHODS = [['VERBAL', 'Verbal', 'Verbal'], ['WRITTEN', 'Écrit (signé)', 'Written (signed)'], ['DIGITAL', 'Numérique', 'Digital'], ['WITNESSED', 'Devant témoin', 'Witnessed']];
var REASON = {
  FARMER_ID: ['Farmer ID identique', 'Same Farmer ID'], TELEPHONE_MEME_VILLAGE: ['Même téléphone, même village', 'Same phone, same village'],
  TELEPHONE: ['Même téléphone', 'Same phone'], TELEPHONE_SECONDAIRE: ['Téléphone secondaire identique', 'Same secondary phone'],
  NOM_PRENOMS_MEME_VILLAGE: ['Même nom et prénoms, même village', 'Same full name, same village'], NOM_PRENOMS_ANNEE_NAISSANCE: ['Même nom, prénoms et année de naissance', 'Same full name and birth year'],
  NOM_PRENOMS_MEME_CLUSTER: ['Même nom et prénoms, même cluster', 'Same full name, same cluster'], NOM_MEME_VILLAGE: ['Même nom, même village', 'Same last name, same village']
};
function reasonLabel(k) { var x = REASON[k]; return x ? K().T(x[0], x[1]) : k; }
function cleanErr(m) { return String(m || '').replace(/^(DOUBLON_FORT|DOUBLON_POSSIBLE|A_COMPLETER): ?/, ''); }
function opt(list, sel, empty) {
  var k = K();
  return (empty != null ? '<option value="">' + k.esc(empty) + '</option>' : '') + list.map(function (x) {
    var v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? k.T(x[1], x[2]) : x;
    return '<option value="' + k.esc(v) + '"' + (String(v) === String(sel == null ? '' : sel) ? ' selected' : '') + '>' + k.esc(l) + '</option>';
  }).join('');
}
function num(v) { return v === '' || v == null ? null : Number(String(v).replace(',', '.')); }
function todayIso() { return new Date().toISOString().slice(0, 10); }

/* ------------------------------------------------------------ GPS du navigateur */
function captureGps(latEl, lngEl, accEl, msgEl) {
  var k = K();
  if (!navigator.geolocation) { if (msgEl) msgEl.textContent = k.T('GPS indisponible sur cet appareil.', 'GPS unavailable on this device.'); return; }
  if (msgEl) msgEl.textContent = k.T('Relevé GPS en cours…', 'Reading GPS…');
  navigator.geolocation.getCurrentPosition(function (p) {
    latEl.value = p.coords.latitude.toFixed(6); lngEl.value = p.coords.longitude.toFixed(6);
    if (accEl) accEl.value = Math.round(p.coords.accuracy);
    if (msgEl) msgEl.textContent = k.T('Position relevée (précision ', 'Position captured (accuracy ') + Math.round(p.coords.accuracy) + ' m).';
  }, function (e) { if (msgEl) msgEl.textContent = k.T('GPS refusé ou indisponible : ', 'GPS denied or unavailable: ') + e.message; }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

/* ---------------------------------------------------- correspondances (affichage) */
function matchesHtml(rows, opts2) {
  var k = K(); opts2 = opts2 || {};
  if (!rows.length) return '<div class="notice ok">' + k.esc(k.T('Aucun producteur correspondant dans le registre.', 'No matching farmer in the registry.')) + '</div>';
  return '<div class="coop-match"><h3>' + k.esc(k.T('Producteur potentiellement déjà enregistré', 'Farmer possibly already registered')) + ' (' + rows.length + ')</h3>' +
    rows.map(function (x) {
      var strong = x.confidence >= 85;
      var who = x.accessible === false || !x.producer_id
        ? '<b>' + k.esc(k.T('Producteur hors de votre périmètre', 'Farmer outside your scope')) + '</b> · ' + k.esc(k.T('contactez la supervision avant toute création', 'contact supervision before any creation'))
        : '<b class="mono">' + k.esc(x.farmer_id) + '</b> · ' + k.esc((x.nom || '') + ' ' + (x.prenoms || '')) + ' · ' + k.esc(x.village_nom || '—') + ' · ' + k.esc(x.telephone_masque || '—') +
          (x.rt_id ? ' · RT ' + k.esc(x.rt_id) : '') + (x.coop_codes ? ' · ' + k.esc(k.T('membre : ', 'member: ') + x.coop_codes) : '');
      return '<div class="coop-match-row"><span>' + who + ' · ' + k.badge(reasonLabel(x.reason) + ' · ' + x.confidence + ' %', strong ? 'danger' : 'warn') + '</span>' +
        (opts2.link && x.producer_id && x.accessible !== false ? '<button class="btn primary" type="button" data-link="' + k.esc(x.producer_id) + '">' + k.esc(k.T('Associer ce producteur à la coopérative', 'Link this farmer to the cooperative')) + '</button>' : '') + '</div>';
    }).join('') + '</div>';
}
function dedupe(rows) {
  var seen = {}, out = [];
  (rows || []).sort(function (a, z) { return z.confidence - a.confidence; }).forEach(function (r) { var key = r.producer_id || ('hors:' + r.farmer_id + r.reason); if (!seen[key]) { seen[key] = 1; out.push(r); } });
  return out;
}

/* ====================================================== 1. ENRÔLER UN PRODUCTEUR */
function enroll(coopId) {
  var k = K(); if (!k) return;
  Promise.all([k.bundle(coopId), k.refs()]).then(function (rs) {
    var b = rs[0], c = rs[1], h = k.host(); if (!h) return;
    var T = k.T, esc = k.esc, field = k.field, sel = k.selectField;
    var cov = {}; b.villages.forEach(function (v) { if (v.active && v.village_id) cov[v.village_id] = 1; });
    var vlist = c.villages.slice().sort(function (a, z) { return (cov[z.id] ? 1 : 0) - (cov[a.id] ? 1 : 0) || String(a.village).localeCompare(String(z.village)); });
    var vOpts = '<option value="">' + esc(T('Choisir…', 'Choose…')) + '</option>' + vlist.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.village + ' · ' + (v.cluster || '')) + (cov[v.id] ? ' ★' : '') + '</option>'; }).join('');
    var sOpts = '<option value="">—</option>' + b.sections.filter(function (x) { return x.active; }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('');
    var yr = new Date().getFullYear();
    h.innerHTML = '<section class="card ops-form-card"><div class="card-head"><div><h2>' + esc(T('Enrôler un producteur', 'Enrol a farmer')) + ' — ' + esc(b.coop.code) + '</h2>' +
      '<p>' + esc(T('Le registre est consulté avant toute création (Farmer ID, téléphones, nom + village, identité + localité). Un champ laissé vide reste « NON COLLECTÉ » : ne rien supposer.',
        'The registry is checked before any creation (Farmer ID, phones, name + village, identity + locality). An empty field stays “NOT RECORDED”: never assume.')) + '</p></div>' +
      '<div class="ops-route-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.closeHost()">' + esc(T('Fermer', 'Close')) + '</button></div></div>' +
      '<form id="enForm" class="coop-form" novalidate>' +
      '<h3>' + esc(T('1. Identité', '1. Identity')) + '</h3>' +
      field(T('Nom *', 'Last name *'), 'nom', '', 'maxlength="120" autocomplete="off"') + field(T('Prénoms', 'First names'), 'prenoms', '', 'maxlength="120" autocomplete="off"') +
      sel(T('Sexe', 'Sex'), 'sexe', opt([['M', 'Homme', 'Male'], ['F', 'Femme', 'Female']], '', T('Non collecté', 'Not recorded'))) +
      field(T('Année de naissance', 'Birth year'), 'birth_year', '', 'type="number" min="1920" max="' + (yr - 15) + '"') +
      sel(T('ou tranche d’âge', 'or age band'), 'age_band', opt(BANDS, '', T('Non collectée', 'Not recorded'))) +
      sel(T('Langue', 'Language'), 'preferred_language', opt(LANGS, '', T('Non collectée', 'Not recorded'))) +
      field(T('Téléphone principal', 'Main phone'), 'telephone', '', 'inputmode="tel" placeholder="07XXXXXXXX"') + field(T('Téléphone secondaire', 'Secondary phone'), 'telephone_alt', '', 'inputmode="tel" placeholder="05XXXXXXXX"') +
      field(T('Farmer ID (si déjà attribué)', 'Farmer ID (if already assigned)'), 'farmer_id', '', 'maxlength="40"') +
      '<h3>' + esc(T('2. Localisation', '2. Location')) + '</h3>' +
      sel(T('Village * (★ couvert par la coopérative)', 'Village * (★ covered by the cooperative)'), 'village_id', vOpts, 'span-2') +
      sel(T('Section', 'Section'), 'section_id', sOpts) +
      '<label>' + esc(T('Cluster', 'Cluster')) + '<input id="enCluster" disabled value="—"></label><label>' + esc(T('Zone', 'Zone')) + '<input id="enZone" disabled value="—"></label>' +
      sel(T('RT de suivi (facultatif)', 'Follow-up RT (optional)'), 'followup_rt_id', '<option value="">' + esc(T('Aucun', 'None')) + '</option>') +
      field(T('GPS domicile — latitude', 'Home GPS — latitude'), 'home_gps_lat', '', 'inputmode="decimal"') + field(T('GPS domicile — longitude', 'Home GPS — longitude'), 'home_gps_lng', '', 'inputmode="decimal"') +
      '<label>&nbsp;<button class="btn secondary" type="button" id="enGps">' + esc(T('Relever ma position', 'Capture my position')) + '</button><small id="enGpsMsg" class="muted"></small></label>' +
      '<h3>' + esc(T('3. Coopérative', '3. Cooperative')) + '</h3>' +
      '<label>' + esc(T('Coopérative', 'Cooperative')) + '<input disabled value="' + esc(b.coop.code + ' · ' + b.coop.name) + '"></label>' +
      '<label>' + esc(T('Campagne', 'Campaign')) + '<input disabled value="' + esc(k.CAMPAIGN) + '"></label>' +
      field('Member ID', 'member_number', '', 'maxlength="40"') +
      field(T('Date d’adhésion', 'Membership date'), 'membership_start', todayIso(), 'type="date" max="' + todayIso() + '"') +
      sel(T('Statut d’affiliation', 'Membership status'), 'membership_status', opt([['ACTIVE', 'Actif', 'Active'], ['PENDING', 'En attente', 'Pending']], 'ACTIVE')) +
      '<label>' + esc(T('Affiliation principale', 'Primary membership')) + '<select name="is_primary"><option value="true">' + esc(T('Oui', 'Yes')) + '</option><option value="false">' + esc(T('Non (secondaire)', 'No (secondary)')) + '</option></select></label>' +
      sel(T('Méthode de vérification', 'Verification method'), 'verification_method', k.opts('verif', '', T('Non vérifiée', 'Not verified'))) +
      '<h3>' + esc(T('4. Production', '4. Production')) + '</h3>' +
      sel(T('Producteur d’anacarde', 'Cashew farmer'), 'cashew_farmer', opt([['OUI', 'Oui', 'Yes'], ['NON', 'Non', 'No'], ['NON_COLLECTE', 'Non collecté', 'Not recorded']], 'NON_COLLECTE')) +
      field(T('Nombre de plantations', 'Number of plantations'), 'plantation_count', '', 'type="number" min="0" step="1"') +
      field(T('Superficie anacarde (ha)', 'Cashew area (ha)'), 'total_area_ha', '', 'type="number" min="0" step="0.01"') +
      field(T('Potentiel ' + k.CAMPAIGN + ' (kg)', k.CAMPAIGN + ' potential (kg)'), 'forecast_kg', '', 'type="number" min="0" step="1"') +
      field(T('Production précédente (kg)', 'Previous production (kg)'), 'previous_production_kg', '', 'type="number" min="0" step="1"') +
      field(T('Année de plantation', 'Planting year'), 'planting_year', '', 'type="number" min="1950" max="' + yr + '"') +
      field(T('Nombre d’arbres', 'Number of trees'), 'tree_count', '', 'type="number" min="0" step="1"') +
      '<div class="span-3"><b style="font-size:11px;color:var(--forest)">' + esc(T('Parcelles relevées (GPS facultatif ; la précision est obligatoire avec des coordonnées)', 'Recorded plots (GPS optional; accuracy required with coordinates)')) + '</b>' +
      '<div id="enPlots"></div><button class="btn secondary" type="button" id="enAddPlot">+ ' + esc(T('Ajouter une parcelle', 'Add a plot')) + '</button></div>' +
      '<h3>' + esc(T('5. Farmer Passport et durabilité', '5. Farmer Passport and sustainability')) + '</h3>' +
      sel(T('Consentement données', 'Data consent'), 'consent_status', opt([['NOT_RECORDED', 'Non recueilli', 'Not recorded'], ['GRANTED', 'Accordé (tous usages)', 'Granted (all uses)'], ['REFUSED', 'Refusé', 'Refused']], 'NOT_RECORDED')) +
      sel(T('Méthode du consentement', 'Consent method'), 'consent_method', opt(CONSENT_METHODS, '', '—')) +
      field(T('Date du consentement', 'Consent date'), 'consent_at', '', 'type="date" max="' + todayIso() + '"') +
      '<div class="span-3 notice info" style="margin:0">' + esc(T('Le stade Farmer Passport est calculé par le registre (jamais saisi). Pratiques agricoles, formations, inspections et risques se saisissent dans le Farmer Passport et l’onglet Durabilité, uniquement lorsqu’ils ont réellement été collectés.',
        'The Farmer Passport stage is computed by the registry (never typed). Farming practices, trainings, inspections and risks are entered in the Farmer Passport and the Sustainability tab, only when actually collected.')) + '</div>' +
      '</form><div id="enMatches"></div>' +
      '<div class="coop-form-actions"><button class="btn primary" type="button" id="enGo">' + esc(T('Vérifier le registre puis enrôler', 'Check the registry then enrol')) + '</button>' +
      '<span id="enMsg" class="muted"></span></div></section>';

    var f = document.getElementById('enForm');
    function syncVillage() {
      var vid = f.village_id.value, v = c.vm[vid] || {}, cl = c.clusters.filter(function (x) { return x.code === v.cluster_code; })[0] || {};
      var z = c.zones.filter(function (x) { return x.code === cl.zone_code; })[0] || {};
      document.getElementById('enCluster').value = v.cluster || v.cluster_code || '—';
      document.getElementById('enZone').value = z.label || cl.zone_code || '—';
      var rts = c.rts.filter(function (r) { return vid && r.village_id === vid; });
      f.followup_rt_id.innerHTML = '<option value="">' + esc(T('Aucun', 'None')) + '</option>' + rts.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc((r.id_rt || r.id) + ' · ' + r.nom) + '</option>'; }).join('');
    }
    f.village_id.onchange = syncVillage;
    document.getElementById('enGps').onclick = function () { captureGps(f.home_gps_lat, f.home_gps_lng, null, document.getElementById('enGpsMsg')); };
    var plotN = 0;
    function addPlot() {
      var i = plotN++, box = document.getElementById('enPlots'), d = document.createElement('div');
      d.className = 'coop-form coop-plot'; d.setAttribute('data-plot', i);
      d.innerHTML = field(T('Nom local', 'Local name'), 'pl_name', '', 'maxlength="80"') + field(T('Superficie (ha)', 'Area (ha)'), 'pl_area', '', 'type="number" min="0" step="0.01"') +
        field(T('Arbres', 'Trees'), 'pl_trees', '', 'type="number" min="0"') + field(T('Année de plantation', 'Planting year'), 'pl_year', '', 'type="number" min="1950" max="' + yr + '"') +
        field('Latitude', 'pl_lat', '', 'inputmode="decimal"') + field('Longitude', 'pl_lng', '', 'inputmode="decimal"') + field(T('Précision (m)', 'Accuracy (m)'), 'pl_acc', '', 'type="number" min="1"') +
        '<label>&nbsp;<button class="btn secondary" type="button" data-gps>' + esc(T('GPS', 'GPS')) + '</button><small class="muted" data-gpsmsg></small></label>' +
        '<label>&nbsp;<button class="btn secondary" type="button" data-rm>' + esc(T('Retirer', 'Remove')) + '</button></label>';
      box.appendChild(d);
      d.querySelector('[data-gps]').onclick = function () { captureGps(d.querySelector('[name=pl_lat]'), d.querySelector('[name=pl_lng]'), d.querySelector('[name=pl_acc]'), d.querySelector('[data-gpsmsg]')); };
      d.querySelector('[data-rm]').onclick = function () { d.remove(); };
    }
    document.getElementById('enAddPlot').onclick = addPlot;

    function payload() {
      var d = k.formData(f);
      var p = { cooperative_id: coopId, campaign: k.CAMPAIGN, nom: d.nom, prenoms: d.prenoms || null, sexe: d.sexe || null,
        birth_year: num(d.birth_year), age_band: d.birth_year ? null : (d.age_band || null), preferred_language: d.preferred_language || null,
        telephone: d.telephone ? k.phoneCI(d.telephone) : null, telephone_alt: d.telephone_alt ? k.phoneCI(d.telephone_alt) : null,
        farmer_id: d.farmer_id ? d.farmer_id.toUpperCase() : null, village_id: d.village_id || null, section_id: d.section_id || null,
        followup_rt_id: d.followup_rt_id || null, home_gps_lat: num(d.home_gps_lat), home_gps_lng: num(d.home_gps_lng),
        member_number: d.member_number || null, membership_start: d.membership_start || null, membership_status: d.membership_status,
        is_primary: d.is_primary === 'true', verification_method: d.verification_method || null, verified: !!d.verification_method,
        cashew_farmer: d.cashew_farmer, plantation_count: num(d.plantation_count), total_area_ha: num(d.total_area_ha), forecast_kg: num(d.forecast_kg),
        previous_production_kg: num(d.previous_production_kg), planting_year: num(d.planting_year), tree_count: num(d.tree_count), plots: [] };
      [].slice.call(document.querySelectorAll('#enPlots [data-plot]')).forEach(function (row) {
        function g(n2) { var e = row.querySelector('[name=' + n2 + ']'); return e ? e.value.trim() : ''; }
        p.plots.push({ local_name: g('pl_name') || null, area_ha: num(g('pl_area')), tree_count: num(g('pl_trees')), planting_year: num(g('pl_year')),
          lat: num(g('pl_lat')), lng: num(g('pl_lng')), accuracy_m: num(g('pl_acc')) });
      });
      if (d.consent_status && d.consent_status !== 'NOT_RECORDED') p.consent = { status: d.consent_status, method: d.consent_method || null, consent_at: d.consent_at || null };
      return p;
    }
    function check(p) {
      if (!p.nom) return T('Le nom est obligatoire.', 'Last name is required.');
      if (!p.village_id) return T('Le village est obligatoire (référentiel AFLP).', 'Village is required (AFLP registry).');
      if (p.telephone && !/^0\d{9}$/.test(p.telephone)) return T('Téléphone principal : 10 chiffres commençant par 0.', 'Main phone: 10 digits starting with 0.');
      if (p.telephone_alt && !/^0\d{9}$/.test(p.telephone_alt)) return T('Téléphone secondaire : 10 chiffres commençant par 0.', 'Secondary phone: 10 digits starting with 0.');
      if ((p.home_gps_lat == null) !== (p.home_gps_lng == null)) return T('GPS domicile : latitude ET longitude.', 'Home GPS: latitude AND longitude.');
      for (var i = 0; i < p.plots.length; i++) {
        var x = p.plots[i];
        if ((x.lat == null) !== (x.lng == null)) return T('Parcelle : latitude ET longitude.', 'Plot: latitude AND longitude.');
        if (x.lat != null && !(x.accuracy_m > 0)) return T('Parcelle : précision GPS (m) obligatoire avec des coordonnées.', 'Plot: GPS accuracy (m) required with coordinates.');
      }
      if (p.consent && (!p.consent.method || !p.consent.consent_at)) return T('Consentement : méthode et date obligatoires (sinon laisser « Non recueilli »).', 'Consent: method and date required (otherwise leave “Not recorded”).');
      return null;
    }
    function send(p, extra) {
      k.msg('enMsg', T('Enregistrement…', 'Saving…'), null);
      return k.rpc('aflp_coop_enroll_producer', { p: Object.assign({}, p, extra || {}) }).then(function (r) {
        if (r.status === 'EN_VERIFICATION') { k.toast(T('Envoyé dans la file À vérifier.', 'Sent to the To-review queue.')); setTimeout(k.refreshFiche, 600); return; }
        k.toast(T('Producteur enrôlé : ', 'Farmer enrolled: ') + r.farmer_id + ' · ' + T('complétude ', 'completeness ') + (r.completeness_pct == null ? '—' : r.completeness_pct + ' %'));
        setTimeout(k.refreshFiche, 600);
      }).catch(function (e) { k.msg('enMsg', cleanErr(e.message), false); });
    }
    document.getElementById('enGo').onclick = function () {
      var p = payload(), err = check(p); if (err) return k.msg('enMsg', err, false);
      k.msg('enMsg', T('Recherche de doublons dans le registre…', 'Searching the registry for duplicates…'), null);
      k.rpc('aflp_coop_match_producers_v2', { p_rows: [{ idx: 0, farmer_id: p.farmer_id, nom: p.nom, prenoms: p.prenoms, telephone: p.telephone, telephone_alt: p.telephone_alt, village_id: p.village_id, birth_year: p.birth_year }] }).then(function (rows) {
        var hits = dedupe(rows), box = document.getElementById('enMatches');
        if (!hits.length) { box.innerHTML = ''; return send(p); }
        var top = hits[0].confidence, fid = hits.some(function (x) { return x.reason === 'FARMER_ID'; });
        box.innerHTML = matchesHtml(hits, { link: true }) +
          '<div class="coop-form coop-decision"><p class="span-3"><b>' + esc(T('Ne créez pas de doublon.', 'Do not create a duplicate.')) + '</b> ' +
          esc(fid ? T('Ce Farmer ID existe déjà : seule l’association est possible.', 'This Farmer ID already exists: only linking is possible.')
            : top >= 85 ? T('Correspondance forte : associez l’existant ou envoyez en vérification. Une création forcée est réservée à la supervision, avec motif.', 'Strong match: link the existing farmer or send for review. Forced creation is reserved to supervision, with a reason.')
            : T('Correspondance possible : associez, envoyez en vérification ou créez avec un motif.', 'Possible match: link, send for review or create with a reason.')) + '</p>' +
          (fid ? '' : field(T('Motif de création malgré la correspondance (10 caractères min.)', 'Reason to create despite the match (10 characters min.)'), 'reason', '', 'id="enReason" maxlength="300"', 'span-2')) +
          '<div class="span-3 ops-actions" style="justify-content:flex-start"><button class="btn secondary" type="button" id="enReview">' + esc(T('Envoyer dans « À vérifier »', 'Send to “To review”')) + '</button>' +
          (fid ? '' : '<button class="btn secondary" type="button" id="enForce">' + esc(T('Créer après justification', 'Create with justification')) + '</button>') + '</div></div>';
        box.querySelectorAll('[data-link]').forEach(function (bt) {
          bt.onclick = function () {
            k.msg('enMsg', T('Association…', 'Linking…'), null);
            k.rpc('aflp_coop_add_member', { p: { cooperative_id: coopId, campaign: k.CAMPAIGN, producer_id: bt.getAttribute('data-link'), member_number: p.member_number, section_id: p.section_id,
              membership_start: p.membership_start, status: p.membership_status, is_primary: p.is_primary, verified: p.verified, verification_method: p.verification_method, source: 'ASSOCIATION_EXISTANT' } })
              .then(function (r) { k.toast(T('Producteur existant associé : ', 'Existing farmer linked: ') + r.farmer_id); setTimeout(k.refreshFiche, 600); })
              .catch(function (e) { k.msg('enMsg', cleanErr(e.message), false); });
          };
        });
        document.getElementById('enReview').onclick = function () { send(p, { send_to_review: true }); };
        var fb = document.getElementById('enForce');
        if (fb) fb.onclick = function () {
          var r = (document.getElementById('enReason') || {}).value || '';
          if (r.trim().length < 10) return k.msg('enMsg', T('Motif obligatoire (10 caractères minimum).', 'Reason required (10 characters minimum).'), false);
          send(p, top >= 85 ? { force_reason: r.trim() } : { confirm_reason: r.trim() });
        };
        k.msg('enMsg', T('Correspondance(s) trouvée(s) : choisissez une décision.', 'Match(es) found: choose a decision.'), false);
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(function (e) { k.msg('enMsg', e.message, false); });
    };
  }).catch(function (e) { alert(e.message); });
}

/* ============================================= 2. ASSOCIER UN PRODUCTEUR EXISTANT */
function link(coopId) {
  var k = K(); if (!k) return;
  Promise.all([k.bundle(coopId), k.refs()]).then(function (rs) {
    var b = rs[0], c = rs[1], h = k.host(); if (!h) return;
    var T = k.T, esc = k.esc, field = k.field, sel = k.selectField;
    var cov = {}; b.villages.forEach(function (v) { if (v.active && v.village_id) cov[v.village_id] = 1; });
    var vOpts = '<option value="">' + esc(T('Tous', 'All')) + '</option>' + c.villages.slice().sort(function (a, z) { return (cov[z.id] ? 1 : 0) - (cov[a.id] ? 1 : 0) || String(a.village).localeCompare(String(z.village)); })
      .map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.village + ' · ' + (v.cluster || '')) + (cov[v.id] ? ' ★' : '') + '</option>'; }).join('');
    var sOpts = '<option value="">—</option>' + b.sections.filter(function (x) { return x.active; }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('');
    h.innerHTML = '<section class="card ops-form-card"><div class="card-head"><div><h2>' + esc(T('Associer un producteur existant', 'Link an existing farmer')) + '</h2>' +
      '<p>' + esc(T('Le producteur garde son Farmer ID, son RT, ses parcelles, son Passport et ses achats. Seule une affiliation coopérative est ajoutée.',
        'The farmer keeps Farmer ID, RT, plots, Passport and purchases. Only a cooperative membership is added.')) + '</p></div>' +
      '<div class="ops-route-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.closeHost()">' + esc(T('Fermer', 'Close')) + '</button></div></div>' +
      '<form id="lkForm" class="coop-form" novalidate>' +
      field('Farmer ID', 'farmer_id', '', 'maxlength="40"') + field(T('Téléphone', 'Phone'), 'telephone', '', 'inputmode="tel" placeholder="07XXXXXXXX"') +
      field(T('Nom', 'Last name'), 'nom', '', 'maxlength="120"') + field(T('Prénoms', 'First names'), 'prenoms', '', 'maxlength="120"') + sel(T('Village', 'Village'), 'village_id', vOpts, 'span-2') +
      '<h3>' + esc(T('Affiliation à créer', 'Membership to create')) + '</h3>' + field('Member ID', 'member_number', '', 'maxlength="40"') + sel(T('Section', 'Section'), 'section_id', sOpts) +
      field(T('Date d’adhésion', 'Membership date'), 'membership_start', todayIso(), 'type="date" max="' + todayIso() + '"') +
      sel(T('Méthode de vérification', 'Verification method'), 'verification_method', k.opts('verif', '', T('Non vérifiée', 'Not verified'))) +
      '</form><div class="coop-form-actions"><button class="btn primary" type="button" id="lkSearch">' + esc(T('Rechercher dans le registre', 'Search the registry')) + '</button><span id="lkMsg" class="muted"></span></div>' +
      '<div id="lkRes"></div></section>';
    var f = document.getElementById('lkForm');
    document.getElementById('lkSearch').onclick = function () {
      var d = k.formData(f), tel = d.telephone ? k.phoneCI(d.telephone) : '';
      if (!d.farmer_id && !tel && !d.nom) return k.msg('lkMsg', T('Saisissez un Farmer ID, un téléphone ou un nom.', 'Enter a Farmer ID, a phone or a name.'), false);
      if (d.nom && !d.village_id && !d.prenoms && !tel && !d.farmer_id) return k.msg('lkMsg', T('Avec un nom seul, précisez le village ou les prénoms.', 'With a last name only, add the village or first names.'), false);
      k.msg('lkMsg', T('Recherche…', 'Searching…'), null);
      k.rpc('aflp_coop_match_producers_v2', { p_rows: [{ idx: 0, farmer_id: d.farmer_id ? d.farmer_id.toUpperCase() : null, telephone: tel || null, nom: d.nom || null, prenoms: d.prenoms || null, village_id: d.village_id || null }] }).then(function (rows) {
        var hits = dedupe(rows), box = document.getElementById('lkRes');
        box.innerHTML = matchesHtml(hits, { link: true });
        box.querySelectorAll('[data-link]').forEach(function (bt) {
          bt.onclick = function () {
            var x = k.formData(f);
            k.rpc('aflp_coop_add_member', { p: { cooperative_id: coopId, campaign: k.CAMPAIGN, producer_id: bt.getAttribute('data-link'), member_number: x.member_number || null, section_id: x.section_id || null,
              membership_start: x.membership_start || null, verified: !!x.verification_method, verification_method: x.verification_method || null, source: 'ASSOCIATION_EXISTANT' } })
              .then(function (r) { k.toast(T('Producteur associé : ', 'Farmer linked: ') + r.farmer_id); setTimeout(k.refreshFiche, 600); })
              .catch(function (e) { k.msg('lkMsg', cleanErr(e.message), false); });
          };
        });
        k.msg('lkMsg', hits.length ? T('Choisissez le producteur à associer.', 'Choose the farmer to link.') : T('Aucun producteur trouvé : utilisez « Enrôler un producteur ».', 'No farmer found: use “Enrol a farmer”.'), hits.length ? true : false);
      }).catch(function (e) { k.msg('lkMsg', e.message, false); });
    };
  }).catch(function (e) { alert(e.message); });
}

/* ======================================================== 3. FILE « À VÉRIFIER » */
function reviewCount(coopId) {
  var k = K();
  return k.client().then(function (cl) {
    return cl.from('aflp_coop_enrollment_reviews').select('id', { count: 'exact', head: true }).eq('cooperative_id', coopId).eq('status', 'OUVERT')
      .then(function (r) { if (r.error) throw new Error(r.error.message); return r.count || 0; });
  });
}
var CAND_FIELDS = [['nom', 'Nom', 'Last name'], ['prenoms', 'Prénoms', 'First names'], ['telephone', 'Téléphone', 'Phone'], ['village_id', 'Village', 'Village'], ['member_number', 'Member ID', 'Member ID'],
  ['sexe', 'Sexe', 'Sex'], ['birth_year', 'Année de naissance', 'Birth year']];
function reviews(coopId) {
  var k = K(); if (!k) return;
  Promise.all([k.q('aflp_coop_enrollment_reviews', 'id,category,candidate,matches,top_confidence,reason,source,row_index,created_at,batch_id', function (r) { return r.eq('cooperative_id', coopId).eq('status', 'OUVERT').order('created_at').limit(500); }), k.refs()]).then(function (rs) {
    var rows = rs[0], c = rs[1], h = k.host(); if (!h) return;
    var T = k.T, esc = k.esc;
    function vname(id) { var v = c.vm[id]; return v ? v.village : (id || ''); }
    h.innerHTML = '<section class="card ops-form-card"><div class="card-head"><div><h2>' + esc(T('À vérifier', 'To review')) + ' (' + rows.length + ')</h2>' +
      '<p>' + esc(T('Candidats qui ne sont PAS encore des producteurs : doublon possible ou dossier incomplet. Aucune ligne n’est perdue ; chaque décision est tracée.',
        'Candidates that are NOT farmers yet: possible duplicate or incomplete file. No row is lost; each decision is logged.')) + '</p></div>' +
      '<div class="ops-route-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.closeHost()">' + esc(T('Fermer', 'Close')) + '</button></div></div>' +
      (rows.length ? rows.map(function (r) {
        var cd = r.candidate || {}, m = r.matches || [];
        return '<article class="coop-review" data-rev="' + r.id + '"><div class="coop-review-head"><div><b>' + esc(((cd.nom || '') + ' ' + (cd.prenoms || '')).trim() || T('(sans nom)', '(no name)')) + '</b> · ' + esc(vname(cd.village_id) || cd.village || T('village ?', 'village ?')) +
          ' · ' + esc(cd.telephone ? k.maskPhone(cd.telephone) : T('sans téléphone', 'no phone')) + (cd.member_number ? ' · ' + esc(cd.member_number) : '') + '</div>' +
          '<div>' + k.badge(r.category === 'DOUBLON_A_VERIFIER' ? T('Doublon à vérifier', 'Duplicate to review') : T('À compléter', 'To complete'), 'warn') +
          (r.top_confidence != null ? ' ' + k.badge(T('score ', 'score ') + r.top_confidence + ' %', r.top_confidence >= 85 ? 'danger' : 'warn') : '') +
          ' <small class="muted">' + esc((r.source === 'IMPORT_EXCEL' ? T('Import, ligne ', 'Import, row ') + (r.row_index || '?') : T('Formulaire', 'Form')) + ' · ' + k.date(r.created_at)) + '</small></div></div>' +
          '<p class="muted" style="margin:6px 0">' + esc(T('Motif : ', 'Reason: ') + cleanErr(r.reason || '—')) + '</p>' +
          (m.length ? '<div class="coop-review-matches">' + m.map(function (x) {
            return '<label class="coop-review-match"><input type="radio" name="pick-' + r.id + '" value="' + esc(x.producer_id) + '"> <b class="mono">' + esc(x.farmer_id || '—') + '</b> · ' + esc(reasonLabel(x.reason)) + ' · ' + x.confidence + ' %</label>';
          }).join('') + '</div>' : '') +
          '<div class="ops-actions" style="justify-content:flex-start;flex-wrap:wrap">' +
          (m.length ? '<button class="btn primary" type="button" data-act="ASSOCIER_EXISTANT">' + esc(T('Associer l’existant', 'Link existing')) + '</button>' : '') +
          '<button class="btn secondary" type="button" data-act="COMPLETER">' + esc(T('Compléter', 'Complete')) + '</button>' +
          (m.length ? '<button class="btn secondary" type="button" data-act="CREER_JUSTIFIE">' + esc(T('Créer après justification', 'Create with justification')) + '</button>' : '') +
          '<button class="btn secondary" type="button" data-act="LAISSER">' + esc(T('Laisser à compléter', 'Leave to complete')) + '</button>' +
          '<button class="btn secondary" type="button" data-act="IGNORER">' + esc(T('Ignorer', 'Ignore')) + '</button></div><div data-zone></div><small data-msg></small></article>';
      }).join('') : '<div class="ops-empty">' + esc(T('Rien à vérifier pour cette coopérative.', 'Nothing to review for this cooperative.')) + '</div>') + '</section>';

    h.querySelectorAll('[data-rev]').forEach(function (art) {
      var id = art.getAttribute('data-rev'), rec = rows.filter(function (x) { return x.id === id; })[0], zone = art.querySelector('[data-zone]'), m = art.querySelector('[data-msg]');
      function say(t, ok) { m.className = ok ? 'ops-ok-text' : 'ops-danger-text'; m.textContent = t; }
      function decide(dec, pid, reason, patch) {
        say(T('Enregistrement…', 'Saving…'), true);
        return k.rpc('aflp_coop_review_decide', { p_review: id, p_decision: dec, p_producer_id: pid || null, p_reason: reason || null, p_patch: patch || null }).then(function (r) {
          if (r.status === 'OUVERT') { say(r.message ? cleanErr(r.message) : T('Complément enregistré ; l’élément reste ouvert.', 'Complement saved; item stays open.'), !r.message); return r; }
          k.toast(T('Décision enregistrée', 'Decision saved') + (r.farmer_id ? ' · ' + r.farmer_id : '')); art.remove(); k.invalidate('coop:' + coopId, 'agg:' + coopId); return r;
        }).catch(function (e) { say(cleanErr(e.message), false); });
      }
      art.querySelectorAll('[data-act]').forEach(function (bt) {
        bt.onclick = function () {
          var act = bt.getAttribute('data-act');
          if (act === 'LAISSER') { say(T('Laissé dans la file : à compléter plus tard.', 'Left in the queue: to complete later.'), true); return; }
          if (act === 'ASSOCIER_EXISTANT') {
            var pick = art.querySelector('input[type=radio]:checked');
            if (!pick) return say(T('Choisissez le producteur existant ci-dessus.', 'Choose the existing farmer above.'), false);
            return decide('ASSOCIER_EXISTANT', pick.value, null);
          }
          if (act === 'CREER_JUSTIFIE' || act === 'IGNORER') {
            zone.innerHTML = '<div class="coop-form">' + k.field(act === 'IGNORER' ? T('Motif *', 'Reason *') : T('Justification de création (10 caractères min.) *', 'Creation justification (10 characters min.) *'), 'why', '', 'maxlength="300"', 'span-2') +
              '<label>&nbsp;<button class="btn primary" type="button" data-ok>' + esc(T('Confirmer', 'Confirm')) + '</button></label></div>';
            zone.querySelector('[data-ok]').onclick = function () {
              var w = zone.querySelector('[name=why]').value.trim();
              if (!w || (act === 'CREER_JUSTIFIE' && w.length < 10)) return say(T('Motif obligatoire.', 'Reason required.'), false);
              decide(act, null, w);
            };
            return;
          }
          /* Compléter : on édite le candidat ; Enrôler relance tous les contrôles anti-doublon. */
          var cd = rec.candidate || {};
          zone.innerHTML = '<form class="coop-form" data-patch>' + CAND_FIELDS.map(function (fd) {
            if (fd[0] === 'village_id') return k.selectField(T(fd[1], fd[2]), 'village_id', '<option value="">—</option>' + c.villages.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === cd.village_id ? ' selected' : '') + '>' + esc(v.village + ' · ' + (v.cluster || '')) + '</option>'; }).join(''));
            if (fd[0] === 'sexe') return k.selectField(T(fd[1], fd[2]), 'sexe', opt([['M', 'Homme', 'Male'], ['F', 'Femme', 'Female']], cd.sexe, T('Non collecté', 'Not recorded')));
            return k.field(T(fd[1], fd[2]), fd[0], cd[fd[0]] == null ? '' : cd[fd[0]]);
          }).join('') + '<div class="span-3 ops-actions" style="justify-content:flex-start"><button class="btn secondary" type="button" data-save>' + esc(T('Enregistrer le complément', 'Save complement')) + '</button>' +
            '<button class="btn primary" type="button" data-enrol>' + esc(T('Enrôler (nouveau contrôle anti-doublon)', 'Enrol (new duplicate check)')) + '</button></div></form>';
          function patch() {
            var d = k.formData(zone.querySelector('[data-patch]')), p = {};
            CAND_FIELDS.forEach(function (fd) { var v = d[fd[0]]; p[fd[0]] = v === '' ? null : v; });
            if (p.telephone) p.telephone = k.phoneCI(p.telephone);
            if (p.nom) p.nom = p.nom.toUpperCase(); if (p.prenoms) p.prenoms = p.prenoms.toUpperCase();
            if (p.birth_year) p.birth_year = Number(p.birth_year);
            return p;
          }
          zone.querySelector('[data-save]').onclick = function () { decide('ENREGISTRER_COMPLEMENT', null, null, patch()); };
          zone.querySelector('[data-enrol]').onclick = function () { decide('ENROLER', null, null, patch()); };
        };
      });
    });
  }).catch(function (e) { alert(e.message); });
}

global.ANAGROCI_COOP_ENROL = { enroll: enroll, link: link, reviews: reviews, reviewCount: reviewCount, reasonLabel: reasonLabel, matchesHtml: matchesHtml };
})(window);
