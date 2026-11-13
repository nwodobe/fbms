/* FBMS AFLP 2027 · Six espaces (V2.1, docs/specs/FBMS_AFLP_2027_V2.1.md §1 et §2).
   Couche de navigation seulement : elle ouvre les écrans existants.
   Aucune écriture, aucune donnée, aucune règle serveur ici. La visibilité par
   rôle est un confort d'affichage ; les droits réels restent ceux du serveur. */
(function (global) {
  'use strict';

  var FB = 'field-buying.html';
  /* État d'un écran : ok = disponible, part = disponible, en amélioration,
     todo = pas encore d'écran (aucun bouton n'est affiché). */
  var SPACES = [
    { id: 'E0', name: 'Ma journée', lead: 'Votre point de départ : alertes de votre périmètre, opérations restées sur le téléphone et raccourcis.', screens: [
      { c: 'E0.1', t: 'Tâches du jour', d: 'Validations en attente, BEV à compléter, bilans dus, pièces manquantes.', s: 'todo' },
      { c: 'E0.2', t: 'Alertes', d: 'Alertes et exceptions de votre périmètre.', s: 'part', l: [[FB + '#command', 'Command Center']] },
      { c: 'E0.3', t: "Boîte d'envoi", d: 'Opérations enregistrées hors ligne et état de la synchronisation.', s: 'part', l: [[FB + '#sync', 'Synchronisation']] },
      { c: 'E0.4', t: 'Missions & carburant', d: 'Motos AFLP : mission, compteur, carburant.', s: 'ok', l: [['../moto/index.html', 'AFLP Fleet']] }
    ] },
    { id: 'E1', name: 'Réseau', lead: 'Clusters, villages, RT, producteurs et coopératives.', screens: [
      { c: 'E1.1', t: 'Villages & clusters', d: 'Recensement des villages, potentiel, carte.', s: 'ok', l: [[FB + '#census', 'Recensement'], [FB + '#hubs', 'Carte']] },
      { c: 'E1.2', t: 'RT', d: 'Représentants traders et villages rattachés.', s: 'part', l: [[FB + '#rt', 'RT & Villages']] },
      { c: 'E1.3', t: 'Producteurs', d: 'Fiche producteur, Farmer Passport, RT de rattachement.', s: 'ok', l: [[FB + '#farmers', 'Producteurs']] },
      { c: 'E1.4', t: 'Coopératives', d: 'Coopératives, membres, livraisons consolidées.', s: 'ok', l: [[FB + '#cooperatives', 'Coopératives']] }
    ] },
    { id: 'E2', name: 'Terrain', lead: 'Le travail au village en dehors de l’achat : mobilisation, visites, formations, durabilité.', screens: [
      { c: 'E2.1', t: 'Mobilisation', d: 'Réunions village et présences.', s: 'todo' },
      { c: 'E2.2', t: 'Visites & formations', d: 'Visites producteurs, sessions de formation, présences.', s: 'todo' },
      { c: 'E2.3', t: 'Durabilité', d: 'Suivi de durabilité par village.', s: 'part', l: [[FB + '#sustainability', 'Sustainability']] },
      { c: 'E2.4', t: 'Preuves terrain', d: 'Photos et vidéos géolocalisées des missions.', s: 'ok', l: [['../fieldproof/index.html', 'AFLP Field Proof']] },
      { c: 'E2.5', t: 'Observatoire des vergers', d: 'Floraison et nouaison, en phase pilote.', s: 'todo' }
    ] },
    { id: 'E3', name: 'Achats & comptes RT', lead: 'L’achat bord champ et les trois comptes du RT : argent, noix, sacs.', screens: [
      { c: 'E3.1', t: 'Nouvel achat', d: 'Producteur, pesée, qualité, prix, reçu.', s: 'part', l: [[FB + '#purchases', 'Achat Bord Champ']] },
      { c: 'E3.2', t: 'Achats à valider', d: 'Revue des achats par le Unit Head.', s: 'part', l: [[FB + '#purchases', 'Achats']] },
      { c: 'E3.3', t: 'Financements & caisse', d: 'Avances RT et situation de caisse (indicative tant que le circuit Wave n’est pas activé).', s: 'part', l: [[FB + '#cash', 'Caisse & Avances']] },
      { c: 'E3.4', t: 'Sacherie RT', d: 'Dotations, sacs utilisés, pleins, retours.', s: 'ok', l: [[FB + '#bags', 'Sacherie AFLP']] },
      { c: 'E3.5', t: 'Bilan hebdomadaire', d: 'Fiche hebdomadaire RT / UH : argent, noix, sacs.', s: 'part', l: [['rt-sop-weekly-print.html', 'Fiche hebdomadaire']] }
    ] },
    { id: 'E4', name: 'Expédition', lead: 'Du lot au camion, jusqu’à la remise au transporteur.', screens: [
      { c: 'E4.1', t: 'Lots & départs', d: 'Lots terrain et expéditions depuis les villages.', s: 'part', l: [['procurement.html#evacuations', 'Lots & expéditions']] },
      { c: 'E4.2', t: 'Voyage & BEV', d: 'Un voyage par camion, un BEV signé par RT, transfert de garde.', s: 'todo' },
      { c: 'E4.3', t: 'Suivi aval PJS', d: 'Transport, réception, GRN et écarts, en lecture depuis PJS.', s: 'todo' },
      { c: 'E4.4', t: 'Rapprochement', d: 'Rapprochement actuel des expéditions.', s: 'part', l: [['procurement.html#reconciliation', 'Rapprochement']] }
    ] },
    { id: 'E5', name: 'Pilotage & Administration', lead: 'Tableau de bord, alertes, rapports, campagnes et utilisateurs.', screens: [
      { c: 'E5.1', t: 'Tableau de bord', d: 'Villages, RT, producteurs, achats par zone et cluster.', s: 'ok', l: [[FB + '#overview', 'Vue d’ensemble']] },
      { c: 'E5.2', t: 'Alertes & anomalies', d: 'Exceptions terrain à traiter.', s: 'part', l: [[FB + '#command', 'Command Center']] },
      { c: 'E5.3', t: 'Rapports & exports', d: 'Rapports, AFLP DATA, exports Excel.', s: 'ok', l: [['reports.html', 'Reports & Export'], ['aflp-data.html', 'AFLP DATA']] },
      { c: 'E5.4', t: 'Campagnes & règles', d: 'Campagnes, prix et règles de campagne.', s: 'ok', l: [['campaigns.html', 'Campagnes'], ['procurement.html#settings', 'Règles']] },
      { c: 'E5.5', t: 'Utilisateurs & rôles', d: 'Comptes, rôles et périmètres.', s: 'ok', l: [['../shared/admin.html', 'Administration']] },
      { c: 'E5.6', t: 'Synchronisation & appareils', d: 'État hors ligne et synchronisation.', s: 'part', l: [[FB + '#sync', 'Synchronisation']] },
      { c: 'E5.7', t: 'Traçabilité & audit', d: 'Historique transversal et journal d’audit.', s: 'part', l: [['traceability.html', 'Traceability 360'], ['procurement.html#audit', 'Audit']] }
    ] }
  ];

  /* Visibilité et raccourcis par rôle (V2.1 §2). Valeur : true = espace entier,
     liste = écrans visibles. */
  var ROLES = {
    AUH: { see: { E0: true, E1: true, E2: true, E3: ['E3.1', 'E3.2', 'E3.3', 'E3.4', 'E3.5'], E4: ['E4.1'], E5: ['E5.6'] }, sc: [['E0', 'Ma journée'], ['E1.3', 'Producteurs'], ['E2', 'Terrain'], ['E3.1', 'Achats']] },
    UH: { see: { E0: true, E1: true, E2: true, E3: true, E4: true, E5: ['E5.1', 'E5.2', 'E5.6'] }, sc: [['E0', 'Ma journée'], ['E3.1', 'Achats'], ['E3.5', 'Contrôles RT'], ['E4', 'Expédition']] },
    ZH: { see: { E0: true, E1: true, E2: true, E3: true, E4: true, E5: ['E5.1', 'E5.2', 'E5.3', 'E5.7'] }, sc: [['E0', 'Ma journée'], ['E1.2', 'RT'], ['E3.5', 'Contrôles'], ['E5.3', 'Rapports']] },
    LOG: { see: { E0: true, E1: true, E3: ['E3.4'], E4: true, E5: ['E5.1', 'E5.3'] }, sc: [['E0', 'Ma journée'], ['E4', 'Expédition'], ['E3.4', 'Sacherie'], ['E0.4', 'Fleet']] },
    ABM: { see: { E0: true, E1: true, E2: true, E3: true, E4: true, E5: ['E5.1', 'E5.2', 'E5.3', 'E5.6', 'E5.7'] }, sc: [['E0', 'Ma journée'], ['E5.1', 'Suivi'], ['E5.2', 'Anomalies'], ['E0.4', 'Fleet']] },
    BM: { see: { E0: true, E1: true, E2: true, E3: true, E4: true, E5: true }, sc: [['E0', 'Ma journée'], ['E5.1', 'Pilotage'], ['E5.2', 'Anomalies'], ['E5.5', 'Administration']] },
    FIN: { see: { E0: ['E0.2', 'E0.3'], E1: ['E1.2'], E3: ['E3.3', 'E3.5'], E5: ['E5.1', 'E5.3'] }, sc: [['E0', 'Ma journée'], ['E3.3', 'Financements'], ['E3.5', 'Bilans'], ['E5.3', 'Rapports']] },
    RO: { see: { E0: ['E0.2'], E1: true, E2: true, E3: true, E4: true, E5: ['E5.1', 'E5.3', 'E5.7'] }, sc: [['E0', 'Ma journée'], ['E5.1', 'Tableau de bord'], ['E5.3', 'Rapports'], ['E5.7', 'Traçabilité']] }
  };
  /* Codes de shared/aflp-access.js → profil de navigation. Un rôle inconnu
     tombe en lecture (jamais plus de visibilité que nécessaire). */
  var MAP = { BRANCH_MANAGER: 'BM', ZONAL_HEAD: 'ZH', UNIT_HEAD: 'UH', ASSISTANT_UNIT_HEAD: 'AUH', LOGISTICS_COORDINATOR: 'LOG', FINANCE_CONTROLLER: 'FIN', LEGACY_ASSISTANT_BM: 'ABM', READ_ONLY_AUDIT: 'RO', WAREHOUSE_KEEPER: 'RO', RT_FIELD_PARTNER: 'RO' };
  var LABEL = { BM: 'Branch Manager', ZH: 'Zonal Head', UH: 'Unit Head', AUH: 'Assistant Unit Head', LOG: 'Logistics Coordinator', FIN: 'Finance', ABM: 'Assistant Branch Manager', RO: 'Consultation' };
  var STATE = { ok: ['esp-ok', 'Disponible'], part: ['esp-part', 'Disponible · en amélioration'], todo: ['esp-todo', 'Bientôt disponible'] };

  var state = { role: 'RO', space: 'E0', focus: null };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function roleKey() {
    var a = global.ANAGROCI_AUTH, raw = a && a.profile ? a.profile.role : '';
    var code = '';
    try { var r = global.AFLP_ACCESS && global.AFLP_ACCESS.role(raw); code = r ? r.code : ''; } catch (e) { code = ''; }
    if (!code && a && a.estBM) code = 'BRANCH_MANAGER';
    return MAP[code] || 'RO';
  }
  function visible(space) {
    var v = ROLES[state.role].see[space.id];
    if (!v) return [];
    if (v === true) return space.screens;
    return space.screens.filter(function (x) { return v.indexOf(x.c) >= 0; });
  }
  function spaceOf(code) { return code.slice(0, 2); }

  function renderNav() {
    var h = '';
    SPACES.forEach(function (s) {
      if (!visible(s).length) return;
      h += '<a href="#' + s.id + '" class="esp-navlink' + (s.id === state.space ? ' active' : '') + '"><span>' + s.id.replace('E', '') + '</span>' + esc(s.name) + '</a>';
    });
    h += '<div class="esp-navsep">Accès direct aux espaces actuels</div>' +
      '<a class="esp-navlink sub" href="' + FB + '">Field Buying</a>' +
      '<a class="esp-navlink sub" href="procurement.html">Lots & Expéditions</a>' +
      '<a class="esp-navlink sub" href="warehouse.html">Entrepôts relais</a>' +
      '<a class="esp-navlink sub" href="stock-transfer.html">Transferts relais</a>' +
      '<a class="esp-navlink sub" href="../moto/index.html">AFLP Fleet</a>' +
      '<a class="esp-navlink sub" href="../fieldproof/index.html">AFLP Field Proof</a>';
    document.getElementById('espNav').innerHTML = h;
  }
  function renderBar() {
    var h = '';
    ROLES[state.role].sc.forEach(function (x) {
      var t = x[0];
      var act = t.indexOf('.') > 0 ? state.focus === t : (state.space === t && !state.focus);
      h += '<a href="#' + (t.indexOf('.') > 0 ? spaceOf(t) + '-' + t.replace('.', '-') : t) + '" class="' + (act ? 'active' : '') + '"><i></i>' + esc(x[1]) + '</a>';
    });
    document.getElementById('espBar').innerHTML = h;
  }
  function renderView() {
    var s = SPACES.filter(function (x) { return x.id === state.space; })[0];
    var list = visible(s), h = '';
    h += '<div class="esp-head"><h1>' + esc(s.name) + '</h1><p>' + esc(s.lead) + '</p></div>';
    if (!list.length) {
      h += '<div class="esp-empty">Cet espace n’est pas prévu pour votre rôle.</div>';
    } else {
      h += '<div class="esp-grid">';
      list.forEach(function (x) {
        var b = STATE[x.s];
        h += '<section class="esp-card' + (state.focus === x.c ? ' focus' : '') + '" id="card-' + x.c.replace('.', '-') + '"><div class="esp-card-top"><h2>' + esc(x.t) + '</h2><span class="esp-badge ' + b[0] + '">' + b[1] + '</span></div><p>' + esc(x.d) + '</p>';
        if (x.l && x.l.length) x.l.forEach(function (l, i) { h += '<a class="esp-open' + (i ? ' alt' : '') + '" href="' + l[0] + '">' + esc(l[1]) + ' →</a>'; });
        else h += '<div class="esp-soon">Écran en préparation.</div>';
        h += '</section>';
      });
      h += '</div>';
    }
    document.getElementById('espView').innerHTML = h;
    if (state.focus) { var el = document.getElementById('card-' + state.focus.replace('.', '-')); if (el) el.scrollIntoView({ block: 'center' }); }
  }
  function render() { renderNav(); renderBar(); renderView(); }
  function fromHash() {
    var h = (location.hash || '#E0').slice(1), m = /^(E[0-5])(?:-(E[0-5])-(\d))?$/.exec(h);
    if (!m) { state.space = 'E0'; state.focus = null; return; }
    state.space = m[1]; state.focus = m[2] ? m[2] + '.' + m[3] : null;
    var s = SPACES.filter(function (x) { return x.id === state.space; })[0];
    if (!visible(s).length) { state.space = 'E0'; state.focus = null; }
  }
  function start() {
    state.role = roleKey();
    var who = document.getElementById('espRole'); if (who) who.textContent = 'Vue ' + LABEL[state.role];
    fromHash(); render();
    if (!state.focus) global.scrollTo(0, 0);
  }
  global.addEventListener('hashchange', function () { fromHash(); render(); if (!state.focus) global.scrollTo(0, 0); });
  if (global.ANAGROCI_AUTH) start(); else document.addEventListener('anagroci:authenticated', start, { once: true });
  global.FBMS_ESPACES = { SPACES: SPACES, ROLES: ROLES, MAP: MAP };
})(window);
