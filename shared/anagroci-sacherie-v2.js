/* ANAGROCI Operations Suite — Sacherie AFLP : workflow SOP-006
   ---------------------------------------------------------------------------
   Demande → plafond calculé par le serveur → décision du Branch Manager →
   remise physique → traçabilité.

   Ce fichier n'affiche plus son propre bandeau ni sa propre barre d'onglets.
   Il enregistre dans la coquille :
   · l'opération « Demande de sacs » ;
   · la section « Demandes » de l'onglet Flux (qui absorbe l'ancien onglet
     « À remettre », devenu un filtre) ;
   · une source de décisions, qui rejoint la file unique ;
   · la section « Paramètres » de l'onglet Contrôles (cycles financés).

   Les règles restent serveur : le plafond vient de sacherie_calculer_plafond,
   la décision de sacherie_decider_demande. Le front ne peut pas mentir.

   Sécurité : escapeHtml() échappe l'apostrophe ; aucune donnée n'est écrite
   dans un attribut onclick.
   ------------------------------------------------------------------------- */
(function () {
'use strict';
if (window.__ANAGROCI_SACHERIE_V2) return;
window.__ANAGROCI_SACHERIE_V2 = true;

var SB = null, AUTH = null, REGISTERED = false;
var STATE = { rt: [], avances: [], requests: [], calc: null, context: {}, filter: '', loaded: false };
var DRAFT_KEY = 'anagroci_sacherie_v2_drafts';

var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (ch) { return ENTITIES[ch]; });
}
function shell() { return window.ANAGROCI_SACHERIE_SHELL; }
function $(id) { return document.getElementById(id); }
function val(id) { var e = $(id); return e ? String(e.value == null ? '' : e.value).trim() : ''; }
function fmt(n) { return Number(n || 0).toLocaleString('fr-FR'); }
function numOf(v) { var n = Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : null; }
function client() {
  if (SB) return SB;
  if (window.supabase && window.ANAGROCI_SUPABASE_URL && window.ANAGROCI_SUPABASE_ANON) {
    SB = window.supabase.createClient(window.ANAGROCI_SUPABASE_URL, window.ANAGROCI_SUPABASE_ANON);
  }
  return SB;
}
function audit(action, details) {
  try { window.ANAGROCI_AUDIT && window.ANAGROCI_AUDIT.log(action, details || {}); } catch (e) {}
}

function op() { return String((STATE.context && STATE.context.fonction_operationnelle) || ''); }
function userCluster() { return String((STATE.context && STATE.context.cluster) || ''); }
function isBM() { return !!(AUTH && AUTH.profile && AUTH.profile.role === 'Branch Manager'); }
function canRequest() { return isBM() || op() === 'Unit Head' || op() === 'Assistant Unit Head'; }
function canExecuteRequest(r) {
  return isBM() || ((op() === 'Warehouse Keeper' || op() === 'Assistant Unit Head') &&
    sameCluster(userCluster(), r && r.cluster));
}
function sameCluster(a, b) { return String(a || '').toUpperCase() === String(b || '').toUpperCase(); }
function labelRT(r) {
  return r.nom || (r.data && (r.data.nom || r.data.rt || r.data.nomComplet)) ||
    (r.village_nom ? 'RT ' + r.village_nom : 'RT');
}
function clusterRT(r) { return r.cluster || (r.data && r.data.cluster) || ''; }

function friendly(err) {
  var s = String((err && err.message) || (err && err.details) || err || '');
  if (/approval|approb/i.test(s)) return 'Mouvement bloqué : la décision du Branch Manager est requise avant toute remise.';
  if (/plafond|10%|autorise|autoris|disponible/i.test(s)) return 'Demande bloquée : quantité supérieure au plafond disponible.';
  if (/stock sacs|insuffisant/i.test(s)) return 'Mouvement bloqué : stock de sacs insuffisant au cluster.';
  if (/expire/i.test(s)) return 'Approbation expirée : créez une nouvelle demande.';
  if (/cluster/i.test(s) && /hors|attribu|diff/i.test(s)) return 'Opération bloquée : RT ou mouvement hors du cluster attribué.';
  if (/row-level security|permission|policy/i.test(s)) return 'Action refusée par les droits d’accès.';
  if (/network|fetch/i.test(s)) return 'Réseau indisponible. La demande peut être gardée en brouillon local.';
  return s || 'Opération impossible.';
}

function readDrafts() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]'); } catch (e) { return []; } }
function writeDrafts(v) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }
function uid(prefix) {
  try { return (prefix || 'req') + '-' + crypto.randomUUID(); }
  catch (e) { return (prefix || 'req') + '-' + Date.now() + '-' + Math.round(Math.random() * 1e9); }
}

async function loadAll() {
  var c = client();
  if (!c) return;
  try {
    var cx = await c.rpc('sacherie_mon_contexte');
    if (!cx.error) STATE.context = cx.data || {};
    var rr = await c.from('rt').select('id,nom,cluster,data,village_nom,statut').eq('deleted', false);
    if (!rr.error) STATE.rt = rr.data || [];
    var av = await c.from('avances')
      .select('id,date,cluster,rt_id,rt_nom,montant,statut,cycle_id,volume_finance_kg,prix_reference_kg,cycle_statut,created_at')
      .order('created_at', { ascending: false }).limit(300);
    if (!av.error) STATE.avances = av.data || [];
    var rq = await c.from('bag_movement_requests').select('*')
      .order('requested_at', { ascending: false }).limit(200);
    if (!rq.error) STATE.requests = rq.data || [];
  } catch (e) {
    /* Les sections affichent leur propre état d'erreur ; on ne laisse plus un
       catch vide produire un écran vide sans explication. */
    STATE.loadError = friendly(e);
  }
  STATE.loaded = true;
  var S = shell();
  if (S) {
    S.setContext(null, null);
    S.setWho(
      (AUTH && AUTH.profile && AUTH.profile.nom) || '',
      [(AUTH && AUTH.profile && AUTH.profile.role) || '', op(), userCluster()].filter(Boolean).join(' · ')
    );
    S.refresh();
    S.refreshBadges();
  }
}

function visibleRT() {
  if (isBM() || !userCluster()) return STATE.rt;
  if (op() === 'Unit Head' || op() === 'Assistant Unit Head' || op() === 'Warehouse Keeper') {
    return STATE.rt.filter(function (r) { return sameCluster(clusterRT(r), userCluster()); });
  }
  return STATE.rt;
}
function cycleOptions(rtId) {
  return STATE.avances.filter(function (a) {
    return a.rt_id === rtId && a.cycle_id && Number(a.volume_finance_kg) > 0 && a.cycle_statut === 'OPEN';
  });
}
function rtOptions() {
  return '<option value="">Choisir un RT</option>' + visibleRT().map(function (r) {
    return '<option value="' + escapeHtml(String(r.id)) + '">' + escapeHtml(labelRT(r)) +
      (clusterRT(r) ? ' — ' + escapeHtml(clusterRT(r)) : '') + '</option>';
  }).join('');
}
function field(label, control, help) {
  return '<div class="sacx-field"><label>' + escapeHtml(label) + '</label>' + control +
    (help ? '<span class="help">' + escapeHtml(help) + '</span>' : '') + '</div>';
}
function primaryBtn(box) { return box.querySelector('.sacx-panelfoot .sacx-btn'); }

/* ------------------------------------------------- Opération : demande de sacs */
function openRequest() {
  var S = shell();
  if (!canRequest()) {
    return S.toast('Votre fonction opérationnelle ne permet pas de créer une demande (attendu : Unit Head, Assistant Unit Head ou Branch Manager).', 'err');
  }
  STATE.calc = null;
  var drafts = readDrafts();
  S.panel({
    title: 'Demande de sacs',
    subtitle: 'Cluster → RT. Le plafond est calculé par le serveur ; une demande locale ne vaut jamais approbation.',
    body:
      '<div class="sacx-recap">Règle SOP en vigueur : <b>80 kg par sac</b>, <b>marge maximale 10 %</b>. ' +
      'La marge ne se cumule jamais : les sacs déjà sous responsabilité du RT sont déduits du plafond.</div>' +
      field('RT', '<select id="v2Rt">' + rtOptions() + '</select>') +
      field('Cycle financé ouvert', '<select id="v2Cycle"><option value="">Choisir d’abord le RT</option></select>') +
      field('Stock RCN physique vérifié (kg)', '<input id="v2Stock" type="number" min="0" step="1" inputmode="numeric" placeholder="Comptage physique du jour">',
        'Aucune valeur n’est préremplie : ce chiffre doit venir d’un comptage réel.') +
      field('Quantité demandée (sacs)', '<input id="v2Qty" type="number" min="1" step="1" inputmode="numeric">') +
      '<button class="sacx-btn secondary" type="button" id="v2Calc">Calculer le plafond</button>' +
      '<div class="sacx-msg warn" id="v2Preview" style="display:block;margin-top:14px">Sélectionnez un RT et un cycle, puis calculez le plafond.</div>' +
      (drafts.length ? '<p class="help" style="margin-top:12px">' + fmt(drafts.length) +
        ' brouillon(s) local(aux) en attente d’envoi. Ils partiront à la reconnexion.</p>' : ''),
    actions: [
      { label: 'Soumettre au Branch Manager', onClick: function (api) { return submitRequest(api); } },
      { label: 'Annuler', variant: 'secondary', onClick: function (api) { api.close(); } }
    ],
    onMount: function (box) {
      var p = primaryBtn(box);
      if (p) p.disabled = true;
      $('v2Rt').addEventListener('change', function () {
        var rt = val('v2Rt'), list = cycleOptions(rt), sel = $('v2Cycle');
        sel.innerHTML = '<option value="">Choisir un cycle ouvert</option>' + list.map(function (a) {
          return '<option value="' + escapeHtml(a.cycle_id) + '">' + escapeHtml(a.cycle_id) + ' · ' + fmt(a.volume_finance_kg) + ' kg</option>';
        }).join('');
        if (!list.length) {
          $('v2Preview').className = 'sacx-msg warn';
          $('v2Preview').textContent = 'Aucun cycle financé ouvert pour ce RT. Un cycle doit être configuré avant toute demande.';
        }
        STATE.calc = null;
        if (p) p.disabled = true;
      });
      $('v2Calc').addEventListener('click', function () { calculate(box); });
      $('v2Qty').addEventListener('input', function () { renderCalc(box); });
    }
  });
}

async function calculate(box) {
  var rt = val('v2Rt'), cycle = val('v2Cycle'), stock = numOf(val('v2Stock'));
  var prev = $('v2Preview');
  if (!rt || !cycle || stock === null || stock < 0) {
    prev.className = 'sacx-msg err';
    prev.textContent = 'RT, cycle et stock RCN vérifié sont requis avant le calcul.';
    return;
  }
  prev.className = 'sacx-msg warn';
  prev.textContent = 'Calcul du plafond par le serveur…';
  var r = await client().rpc('sacherie_calculer_plafond', { p_rt_id: rt, p_cycle_id: cycle, p_stock_rcn_kg: stock });
  if (r.error) {
    STATE.calc = null;
    var p = primaryBtn(box);
    if (p) p.disabled = true;
    prev.className = 'sacx-msg err';
    prev.textContent = friendly(r.error);
    return;
  }
  STATE.calc = r.data;
  renderCalc(box);
}

function renderCalc(box) {
  var x = STATE.calc, prev = $('v2Preview');
  if (!prev || !x) return;
  var q = numOf(val('v2Qty')) || 0;
  var held = Number(x.bags_already_held || 0);
  var reserved = Number(x.reserved_approved_bags || 0);
  var maxAvailable = Number(x.max_new_available || 0);
  var after = held + reserved + q;
  var ok = q > 0 && q <= maxAvailable;
  prev.className = 'sacx-msg ' + (q > 0 ? (ok ? 'ok' : 'err') : 'warn');
  prev.innerHTML =
    '<b>Contrôle serveur</b><br>' +
    'Volume financé ' + fmt(x.volume_finance_kg) + ' kg · acheté sur le cycle ' + fmt(x.volume_achete_cycle_kg) + ' kg · ' +
    'RCN vérifié ' + fmt(x.stock_rcn_kg_verified) + ' kg<br>' +
    'Plafond <b>' + fmt(x.system_max_bags) + ' sacs</b> · déjà détenus ' + fmt(held) +
    ' · réservés par des approbations en cours ' + fmt(reserved) + '<br>' +
    'Nouvelle remise encore autorisée : <b>' + fmt(maxAvailable) + ' sacs</b> · stock cluster ' + fmt(x.cluster_stock) + '<br>' +
    (q
      ? ('Après cette demande : <b>' + fmt(after) + ' / ' + fmt(x.system_max_bags) + '</b> — ' +
         (ok ? 'CONFORME' : 'DÉPASSEMENT SOP. Vous demandez ' + fmt(q) + ' sacs mais ce RT ne peut en recevoir que ' + fmt(maxAvailable) + ' de plus.'))
      : 'Saisissez la quantité demandée.');
  var p = primaryBtn(box);
  if (p) p.disabled = !ok;
}

function submitRequest(api) {
  var rt = val('v2Rt'), cycle = val('v2Cycle'), stock = numOf(val('v2Stock')), qty = numOf(val('v2Qty'));
  if (!rt || !cycle || stock === null || !(qty > 0)) {
    api.message('Complétez le RT, le cycle, le stock RCN vérifié et la quantité.', 'err');
    return;
  }
  if (!STATE.calc || qty > Number(STATE.calc.max_new_available || 0)) {
    api.message('Calculez d’abord un plafond conforme : la quantité demandée dépasse ce qui est autorisé.', 'err');
    return;
  }
  var clientId = uid('bagreq');
  if (!navigator.onLine) {
    saveDraft(clientId, rt, cycle, stock, qty);
    api.close();
    return;
  }
  return client().rpc('sacherie_creer_demande', {
    p_client_request_id: clientId, p_rt_id: rt, p_cycle_id: cycle,
    p_stock_rcn_kg: stock, p_requested_qty: Math.round(qty)
  }).then(function (r) {
    if (r.error) {
      if (/fetch|network/i.test(String(r.error.message || ''))) {
        saveDraft(clientId, rt, cycle, stock, qty);
        api.close();
        return;
      }
      return api.message(friendly(r.error), 'err');
    }
    audit('bag_request_created', { request_id: r.data && r.data.id, rt_id: rt, cycle_id: cycle, qty: qty });
    STATE.calc = null;
    api.close();
    shell().toast('Demande enregistrée. Elle attend maintenant la décision du Branch Manager.');
    return loadAll();
  });
}

function saveDraft(clientId, rt, cycle, stock, qty) {
  var d = readDrafts();
  d.unshift({
    client_request_id: clientId, local_id: clientId, rt_id: rt, cycle_id: cycle,
    stock_rcn_kg_verified: stock, requested_qty: Math.round(qty),
    created_at: new Date().toISOString(), status: 'DRAFT_LOCAL'
  });
  if (writeDrafts(d)) {
    shell().toast('Hors ligne : brouillon gardé localement. Il ne vaut pas approbation.');
    shell().refresh();
  } else {
    shell().toast('Impossible de sauvegarder le brouillon local : espace de stockage saturé.', 'err');
  }
}

async function syncDrafts() {
  if (!navigator.onLine) return;
  var d = readDrafts();
  if (!d.length) return;
  var left = [];
  for (var i = d.length - 1; i >= 0; i--) {
    var x = d[i], clientId = x.client_request_id || x.local_id || uid('bagreq');
    var r = await client().rpc('sacherie_creer_demande', {
      p_client_request_id: clientId, p_rt_id: x.rt_id, p_cycle_id: x.cycle_id,
      p_stock_rcn_kg: x.stock_rcn_kg_verified, p_requested_qty: x.requested_qty
    });
    if (r.error) {
      x.client_request_id = clientId;
      x.last_error = friendly(r.error);
      left.unshift(x);
    } else {
      audit('bag_request_created', { request_id: r.data && r.data.id, from_draft: true });
    }
  }
  writeDrafts(left);
  shell().toast(left.length
    ? fmt(left.length) + ' brouillon(s) restent à corriger.'
    : 'Brouillons synchronisés et soumis au Branch Manager.', left.length ? 'err' : 'ok');
  await loadAll();
}

/* ------------------------------------------------------- Décisions du BM */
function pendingRequests() { return STATE.requests.filter(function (r) { return r.status === 'PENDING_BM'; }); }
function heldRequests() { return STATE.requests.filter(function (r) { return r.status === 'HOLD'; }); }
function approvedRequests() { return STATE.requests.filter(function (r) { return r.status === 'APPROVED'; }); }
function expiringApprovals() {
  var S = shell();
  return approvedRequests().filter(function (r) {
    if (!r.expires_at) return false;
    var h = S.hoursUntil(r.expires_at);
    return h !== null && h <= 24;
  });
}

function requestRecap(r) {
  var S = shell();
  return '<div class="sacx-recap"><dl>' +
    '<dt>RT</dt><dd>' + escapeHtml(r.rt_nom || r.rt_id || '—') + '</dd>' +
    '<dt>Cluster</dt><dd>' + escapeHtml(r.cluster || '—') + '</dd>' +
    '<dt>Cycle financé</dt><dd>' + escapeHtml(r.cycle_id || '—') + '</dd>' +
    '<dt>RCN vérifié</dt><dd>' + fmt(r.stock_rcn_kg_verified) + ' kg</dd>' +
    '<dt>Plafond système</dt><dd>' + fmt(r.system_max_bags) + ' sacs</dd>' +
    '<dt>Déjà détenus</dt><dd>' + fmt(r.bags_already_held) + '</dd>' +
    '<dt>Réservés</dt><dd>' + fmt(r.reserved_approved_bags) + '</dd>' +
    '<dt>Disponible au calcul</dt><dd>' + fmt(r.max_new_available) + '</dd>' +
    '<dt>Quantité demandée</dt><dd><b>' + fmt(r.requested_qty) + ' sacs</b></dd>' +
    '<dt>Total après remise</dt><dd>' + fmt(Number(r.bags_already_held || 0) + Number(r.requested_qty || 0)) +
      ' / ' + fmt(r.system_max_bags) + '</dd>' +
    '<dt>Demandée</dt><dd>' + escapeHtml(r.requested_at ? S.dt(r.requested_at) + ' (' + S.ageLabel(r.requested_at) + ')' : '—') + '</dd>' +
    '</dl></div>';
}

/* Une seule action primaire par écran de décision : Approuver. Réduire, HOLD
   et Rejeter sont secondaires — quatre boutons pleins côte à côte dans une
   cellule de tableau étaient une invitation à l'erreur. */
function openDecision(r) {
  var S = shell();
  if (!isBM()) return S.toast('Seul le Branch Manager décide d’une demande de sacs.', 'err');
  S.panel({
    title: 'Décision sur une demande',
    subtitle: 'Aucun dépassement du plafond de 10 % n’est possible : le serveur refuse une quantité supérieure au disponible.',
    body: requestRecap(r) +
      field('Quantité approuvée', '<input id="v2Approved" type="number" min="1" step="1" inputmode="numeric" value="' +
        escapeHtml(String(r.requested_qty || '')) + '">',
        'Laissez la quantité demandée pour approuver telle quelle, ou réduisez-la.') +
      field('Motif', '<textarea id="v2Comment" placeholder="Obligatoire pour suspendre ou rejeter"></textarea>'),
    actions: [
      { label: 'Approuver', onClick: function (api) { return decide(api, r, 'APPROVE'); } },
      { label: 'Suspendre (HOLD)', variant: 'secondary', onClick: function (api) { return decide(api, r, 'HOLD'); } },
      { label: 'Rejeter', variant: 'secondary', onClick: function (api) { return decide(api, r, 'REJECT'); } }
    ]
  });
}
function decide(api, r, action) {
  var comment = val('v2Comment');
  var qty = null;
  if (action === 'APPROVE') {
    var raw = numOf(val('v2Approved'));
    if (!(raw > 0)) return api.message('Saisissez une quantité approuvée supérieure à zéro.', 'err');
    if (raw > Number(r.requested_qty || 0)) {
      return api.message('La quantité approuvée ne peut pas dépasser la quantité demandée (' + fmt(r.requested_qty) + ').', 'err');
    }
    qty = Math.round(raw) === Number(r.requested_qty) ? null : Math.round(raw);
  } else if (!comment.trim()) {
    return api.message('Un motif est obligatoire pour suspendre ou rejeter une demande.', 'err');
  }
  return client().rpc('sacherie_decider_demande', {
    p_request_id: r.id, p_action: action, p_approved_qty: qty, p_comment: comment
  }).then(function (res) {
    if (res.error) return api.message(friendly(res.error), 'err');
    audit(action === 'APPROVE' ? 'bag_request_approved' : action === 'HOLD' ? 'bag_request_hold' : 'bag_request_rejected',
      { request_id: r.id, approved_qty: qty });
    api.close();
    shell().toast(action === 'APPROVE'
      ? 'Demande approuvée' + (qty ? ' pour ' + fmt(qty) + ' sacs (réduite).' : '.')
      : action === 'HOLD' ? 'Demande suspendue.' : 'Demande rejetée.');
    return loadAll();
  });
}

/* ------------------------------------------------------------- Remise */
function openExecute(r) {
  var S = shell();
  if (!canExecuteRequest(r)) {
    return S.toast('Votre fonction ne permet pas cette remise pour ce cluster.', 'err');
  }
  var expired = r.expires_at && S.hoursUntil(r.expires_at) !== null && S.hoursUntil(r.expires_at) < 0;
  S.panel({
    title: 'Remise physique',
    subtitle: 'Un reliquat non remis est annulé : il ne pourra pas être repris avec cette approbation.',
    body:
      '<div class="sacx-recap"><dl>' +
        '<dt>Demande</dt><dd>' + escapeHtml(r.request_code || String(r.id).slice(0, 8)) + '</dd>' +
        '<dt>RT</dt><dd>' + escapeHtml(r.rt_nom || r.rt_id || '—') + '</dd>' +
        '<dt>Cluster</dt><dd>' + escapeHtml(r.cluster || '—') + '</dd>' +
        '<dt>Quantité approuvée</dt><dd><b>' + fmt(r.approved_qty) + ' sacs</b></dd>' +
        '<dt>Expiration</dt><dd>' + escapeHtml(r.expires_at ? S.dt(r.expires_at) : '—') + '</dd>' +
      '</dl></div>' +
      (expired ? '<div class="sacx-msg err" style="display:block;margin:0 0 14px">Cette approbation est expirée. ' +
        'Le serveur refusera la remise : une nouvelle demande est nécessaire.</div>' : '') +
      field('Quantité réellement remise', '<input id="v2Exec" type="number" min="1" step="1" inputmode="numeric" value="' +
        escapeHtml(String(r.approved_qty || '')) + '">',
        'Maximum ' + fmt(r.approved_qty) + ' sacs. Si vous remettez moins, la différence est annulée et exige une nouvelle demande.'),
    actions: [
      { label: 'Confirmer la remise', onClick: function (api) { return execute(api, r); } },
      { label: 'Annuler', variant: 'secondary', onClick: function (api) { api.close(); } }
    ]
  });
}
function execute(api, r) {
  var q = numOf(val('v2Exec'));
  if (!(q > 0)) return api.message('Saisissez la quantité réellement remise.', 'err');
  q = Math.round(q);
  if (q > Number(r.approved_qty || 0)) {
    return api.message('Quantité supérieure à l’approbation (' + fmt(r.approved_qty) + ' sacs).', 'err');
  }
  return client().rpc('sacherie_executer_demande', {
    p_request_id: r.id, p_executed_qty: q, p_bag_state: 'EMPTY', p_lot_id: null
  }).then(function (res) {
    if (res.error) return api.message(friendly(res.error), 'err');
    audit('bag_movement_executed', {
      request_id: r.id, executed_qty: q,
      bag_movement_code: res.data && res.data.bag_movement_code
    });
    api.close();
    shell().toast('Remise enregistrée : ' + fmt(q) + ' sac(s) · ' +
      ((res.data && res.data.bag_movement_code) || 'mouvement créé') +
      (q < Number(r.approved_qty || 0) ? ' · reliquat annulé.' : '.'));
    return loadAll();
  });
}

/* ----------------------------------------- Section Flux : les demandes */
var FILTERS = [
  { k: '', label: 'Toutes' },
  { k: 'PENDING_BM', label: 'En attente' },
  { k: 'APPROVED', label: 'À remettre' },
  { k: 'EXECUTED', label: 'Remises' },
  { k: 'HOLD', label: 'Suspendues' },
  { k: 'REJECTED', label: 'Rejetées' }
];
function sectionRequests(host, params) {
  var S = shell();
  if (params && params.requestFilter !== undefined) STATE.filter = params.requestFilter;
  var drafts = readDrafts();
  var rows = STATE.requests.filter(function (r) { return !STATE.filter || r.status === STATE.filter; });

  var counts = {};
  STATE.requests.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });

  var inner = '<div class="sacx-cardhead"><h2>Demandes de sacs</h2>' +
    '<span class="sacx-count">' + fmt(STATE.requests.length) + ' demande(s)</span></div>' +
    '<p class="sacx-hint">Un seul tableau, plusieurs filtres. « À remettre » est le filtre des demandes approuvées.</p>' +
    '<div class="sacx-filters">' + FILTERS.map(function (f) {
      var n = f.k ? (counts[f.k] || 0) : STATE.requests.length;
      return '<button class="sacx-btn sm ' + (STATE.filter === f.k ? '' : 'secondary') + '" type="button" data-filter="' +
        escapeHtml(f.k) + '">' + escapeHtml(f.label) + ' · ' + fmt(n) + '</button>';
    }).join('') +
    (drafts.length ? '<button class="sacx-btn sm" type="button" data-sync="1">Envoyer ' + fmt(drafts.length) + ' brouillon(s)</button>' : '') +
    '</div>';

  if (!STATE.loaded) {
    inner += '<span class="sacx-skel" style="width:66%"></span>';
  } else if (STATE.loadError && !STATE.requests.length) {
    inner += '<div class="sacx-empty bad">' + escapeHtml(STATE.loadError) + '</div>';
  } else if (!rows.length && !drafts.length) {
    inner += '<div class="sacx-empty">Aucune demande pour ce filtre.</div>';
  } else {
    inner += '<div class="sacx-tw"><table><thead><tr><th>Demande</th><th>RT / cluster</th><th>Cycle</th>' +
      '<th class="num">Plafond</th><th class="num">Demandé</th><th class="num">Approuvé</th>' +
      '<th>Expiration</th><th>Statut</th><th>Action</th></tr></thead><tbody>';
    if (!STATE.filter) {
      inner += drafts.map(function (d) {
        return '<tr><td class="sacx-strong">' + escapeHtml(d.client_request_id || d.local_id) + '</td>' +
          '<td>' + escapeHtml(d.rt_id || '—') + '</td>' +
          '<td>' + escapeHtml(d.cycle_id || '—') + '</td>' +
          '<td class="num">—</td><td class="num">' + fmt(d.requested_qty) + '</td><td class="num">—</td>' +
          '<td>—</td><td>' + S.pill('surveil', 'Brouillon local') +
            (d.last_error ? '<br><small>' + escapeHtml(d.last_error) + '</small>' : '') + '</td>' +
          '<td><span class="sacx-count">Non transmise</span></td></tr>';
      }).join('');
    }
    inner += rows.map(function (r, i) {
      var h = r.expires_at ? S.hoursUntil(r.expires_at) : null;
      var exp = !r.expires_at ? '—'
        : h === null ? '—'
        : h < 0 ? 'expirée'
        : h <= 24 ? 'dans ' + h + ' h'
        : 'le ' + S.dateOnly(r.expires_at);
      var action = '—';
      if (r.status === 'APPROVED' && canExecuteRequest(r)) {
        action = '<button class="sacx-btn sm" type="button" data-exec="' + i + '">Remettre</button>';
      } else if ((r.status === 'PENDING_BM' || r.status === 'HOLD') && isBM()) {
        action = '<button class="sacx-btn sm" type="button" data-decide="' + i + '">Décider</button>';
      } else if (r.status === 'APPROVED') {
        action = '<span class="sacx-count">Lecture seule</span>';
      }
      return '<tr><td class="sacx-strong" title="' + escapeHtml(String(r.id || '')) + '">' +
          escapeHtml(r.request_code || String(r.id).slice(0, 8)) + '</td>' +
        '<td>' + escapeHtml(r.rt_nom || r.rt_id || '—') + '<br><small>' + escapeHtml(r.cluster || '') + '</small></td>' +
        '<td>' + escapeHtml(r.cycle_id || '—') + '</td>' +
        '<td class="num">' + fmt(r.system_max_bags) + '</td>' +
        '<td class="num">' + fmt(r.requested_qty) + '</td>' +
        '<td class="num">' + (r.approved_qty == null ? '—' : fmt(r.approved_qty)) + '</td>' +
        '<td' + (h !== null && h <= 24 ? ' class="sacx-neg"' : '') + '>' + escapeHtml(exp) + '</td>' +
        '<td title="' + escapeHtml(String(r.status || '')) + '">' + S.pill(S.statusLevel(r.status), S.statusLabel(r.status)) + '</td>' +
        '<td>' + action + '</td></tr>';
    }).join('');
    inner += '</tbody></table></div>';
  }
  host.innerHTML = '<section class="sacx-card">' + inner + '</section>';

  host.querySelectorAll('[data-filter]').forEach(function (b) {
    b.addEventListener('click', function () { STATE.filter = b.getAttribute('data-filter'); S.refresh(); });
  });
  var sy = host.querySelector('[data-sync]');
  if (sy) sy.addEventListener('click', syncDrafts);
  host.querySelectorAll('[data-exec]').forEach(function (b) {
    b.addEventListener('click', function () { openExecute(rows[Number(b.getAttribute('data-exec'))]); });
  });
  host.querySelectorAll('[data-decide]').forEach(function (b) {
    b.addEventListener('click', function () { openDecision(rows[Number(b.getAttribute('data-decide'))]); });
  });
}

/* --------------------------------- Section Contrôles : cycles financés */
function sectionCycles(host) {
  var S = shell();
  if (!isBM()) return;
  var configured = STATE.avances.filter(function (a) { return a.cycle_id; });
  var inner = '<h2>Paramètres — cycles financés</h2>' +
    '<p class="sacx-hint">Le volume en kilogrammes est une autorisation explicite. Il n’est jamais déduit d’un montant ' +
    'divisé par un prix supposé : le prix de référence peut changer en cours de campagne.</p>' +
    field('RT', '<select id="v2CRt">' + rtOptions() + '</select>') +
    field('Avance Cash existante', '<select id="v2CAv"><option value="">Choisir d’abord le RT</option></select>') +
    field('Cycle ID', '<input id="v2CCode" placeholder="Ex. WAVE-2027-BEO-001">') +
    field('Volume financé autorisé (kg)', '<input id="v2CVol" type="number" min="1" step="1" inputmode="numeric">') +
    field('Prix de référence (FCFA/kg)', '<input id="v2CPrix" type="number" min="1" step="1" inputmode="numeric">') +
    '<button class="sacx-btn" type="button" id="v2CSave">Ouvrir le cycle</button>' +
    '<p class="sacx-hint" style="margin-top:10px">Un seul cycle Sacherie peut être ouvert par RT.</p>';
  if (configured.length) {
    inner += '<h3>Cycles configurés</h3><div class="sacx-tw"><table><thead><tr><th>RT</th><th>Cycle</th>' +
      '<th class="num">Volume</th><th>Statut</th><th>Action</th></tr></thead><tbody>' +
      configured.map(function (a, i) {
        return '<tr><td>' + escapeHtml(a.rt_nom || a.rt_id || '—') + '</td>' +
          '<td class="sacx-strong">' + escapeHtml(a.cycle_id) + '</td>' +
          '<td class="num">' + fmt(a.volume_finance_kg) + ' kg</td>' +
          '<td>' + S.pill(S.statusLevel(a.cycle_statut), S.statusLabel(a.cycle_statut)) + '</td>' +
          '<td>' + (a.cycle_statut === 'OPEN'
            ? '<button class="sacx-btn sm secondary" type="button" data-close="' + i + '">Clôturer</button>'
            : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  host.innerHTML = '<section class="sacx-card">' + inner + '</section>';

  var rtSel = host.querySelector('#v2CRt');
  if (rtSel) rtSel.addEventListener('change', function () {
    var rt = rtSel.value;
    var avs = STATE.avances.filter(function (a) { return a.rt_id === rt && !a.cycle_id; });
    host.querySelector('#v2CAv').innerHTML = '<option value="">Choisir une avance non affectée</option>' +
      avs.map(function (a) {
        return '<option value="' + escapeHtml(a.id) + '">' + escapeHtml(a.date || '') + ' · ' + fmt(a.montant) + ' FCFA</option>';
      }).join('');
  });
  var save = host.querySelector('#v2CSave');
  if (save) save.addEventListener('click', saveCycle);
  host.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { closeCycle(configured[Number(b.getAttribute('data-close'))].cycle_id); });
  });
}
async function saveCycle() {
  var S = shell();
  var avance = val('v2CAv'), code = val('v2CCode').toUpperCase(), vol = numOf(val('v2CVol')), prix = numOf(val('v2CPrix'));
  if (!avance || !code || !(vol > 0)) return S.toast('Avance, Cycle ID et volume en kg sont requis.', 'err');
  var r = await client().rpc('sacherie_configurer_cycle', {
    p_avance_id: avance, p_cycle_id: code, p_volume_finance_kg: vol, p_prix_reference_kg: prix
  });
  if (r.error) return S.toast(friendly(r.error), 'err');
  audit('bag_financing_cycle_configured', { avance_id: avance, cycle_id: code, volume_finance_kg: vol });
  S.toast('Cycle financé ouvert : ' + code + '.');
  await loadAll();
}
function closeCycle(code) {
  var S = shell();
  S.panel({
    title: 'Clôturer un cycle financé',
    subtitle: 'Cycle ' + code,
    body: '<div class="sacx-recap">Après clôture, les nouveaux achats ne pourront plus être rattachés à ce cycle, ' +
      'et aucune nouvelle demande de sacs ne pourra s’y appuyer. Les demandes déjà approuvées ne sont pas annulées.</div>',
    actions: [
      { label: 'Clôturer le cycle', onClick: function (api) {
          return client().rpc('sacherie_cloturer_cycle', { p_cycle_id: code }).then(function (r) {
            if (r.error) return api.message(friendly(r.error), 'err');
            audit('bag_financing_cycle_closed', { cycle_id: code });
            api.close();
            S.toast('Cycle ' + code + ' clôturé.');
            return loadAll();
          });
        } },
      { label: 'Annuler', variant: 'secondary', onClick: function (api) { api.close(); } }
    ]
  });
}

/* --------------------------------------------------------- Enregistrement */
function register() {
  var S = shell();
  if (!S || REGISTERED) return !!S;
  REGISTERED = true;

  S.operation({
    key: 'request', order: 10, label: 'Demande de sacs',
    desc: 'Cluster → RT, avec calcul du plafond',
    can: canRequest,
    open: openRequest
  });

  S.decisionSource(function () {
    var out = [];
    pendingRequests().forEach(function (r) {
      out.push({
        id: 'req-' + r.id, type: 'demande', groupLabel: 'Demandes en attente', level: 'traiter',
        at: r.requested_at,
        title: 'Demande de ' + fmt(r.requested_qty) + ' sacs en attente de décision',
        subtitle: (r.rt_nom || r.rt_id || '') + ' · ' + (r.cluster || '') + ' · ' + (r.request_code || ''),
        open: function () { isBM() ? openDecision(r) : S.openTab('flux', { requestFilter: 'PENDING_BM' }); }
      });
    });
    heldRequests().forEach(function (r) {
      out.push({
        id: 'hold-' + r.id, type: 'suspendue', groupLabel: 'Demandes suspendues', level: 'surveil',
        at: r.requested_at,
        title: 'Demande suspendue de ' + fmt(r.requested_qty) + ' sacs',
        subtitle: (r.rt_nom || r.rt_id || '') + ' · ' + (r.cluster || '') + ' · à débloquer ou rejeter',
        open: function () { isBM() ? openDecision(r) : S.openTab('flux', { requestFilter: 'HOLD' }); }
      });
    });
    expiringApprovals().forEach(function (r) {
      var h = S.hoursUntil(r.expires_at);
      out.push({
        id: 'exp-' + r.id, type: 'expiration', groupLabel: 'Approbations qui expirent',
        level: h < 0 ? 'traiter' : 'surveil',
        at: r.expires_at,
        title: h < 0
          ? 'Approbation expirée de ' + fmt(r.approved_qty) + ' sacs'
          : 'Approbation de ' + fmt(r.approved_qty) + ' sacs expire dans ' + h + ' h',
        subtitle: (r.rt_nom || r.rt_id || '') + ' · ' + (r.cluster || '') + ' · demande ' + (r.request_code || ''),
        open: function () { S.openTab('flux', { requestFilter: 'APPROVED' }); }
      });
    });
    return out;
  });

  S.section({ tab: 'flux', key: 'requests', order: 20, render: sectionRequests });
  S.section({ tab: 'controles', key: 'cycles', order: 30, render: sectionCycles });
  return true;
}

function start(auth) {
  AUTH = auth || window.ANAGROCI_AUTH;
  var mod = (AUTH && AUTH.module) || window.ANAGROCI_MODULE;
  if (mod !== 'sacs' || !shell()) return setTimeout(function () { start(auth); }, 140);
  register();
  loadAll();
}
document.addEventListener('anagroci:authenticated', function (e) { setTimeout(function () { start(e.detail); }, 160); });
if (window.ANAGROCI_AUTH) setTimeout(function () { start(window.ANAGROCI_AUTH); }, 160);
window.addEventListener('online', function () { syncDrafts(); loadAll(); });
})();
