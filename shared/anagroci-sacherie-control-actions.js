/* ANAGROCI Operations Suite — Sacherie AFLP : opérations de contrôle
   ---------------------------------------------------------------------------
   Comptage physique, traitement des sacs abîmés, déclaration de perte et
   décision du Branch Manager sur les pertes.

   Ce fichier n'affiche plus de bloc autonome avec ses propres onglets. Il
   enregistre dans la coquille :
   · trois opérations, atteignables par le bouton « Nouvelle opération » ET
     depuis la ligne concernée (le contexte est alors pré-rempli) ;
   · une source de décisions, qui rejoint la file unique ;
   · la section « Pertes » de l'onglet Contrôles.

   Sécurité : escapeHtml() échappe l'apostrophe, et aucune donnée n'est écrite
   dans un attribut onclick — les décisions passent par des data-* et des
   écouteurs délégués. Les actions de décision sont réservées au Branch Manager
   côté interface, comme elles le sont déjà côté serveur.
   ------------------------------------------------------------------------- */
(function () {
'use strict';
if (window.__ANAGROCI_SACHERIE_CT_ACTIONS) return;
window.__ANAGROCI_SACHERIE_CT_ACTIONS = true;

var SB = null, LOC = [], LOSSES = [], LOADED = false, LOAD_ERROR = '';

var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (ch) { return ENTITIES[ch]; });
}
function shell() { return window.ANAGROCI_SACHERIE_SHELL; }
function client() {
  if (SB) return SB;
  if (window.supabase && window.ANAGROCI_SUPABASE_URL && window.ANAGROCI_SUPABASE_ANON) {
    SB = window.supabase.createClient(window.ANAGROCI_SUPABASE_URL, window.ANAGROCI_SUPABASE_ANON);
  }
  return SB;
}
function rpc(name, args) {
  var c = client();
  if (!c) return Promise.reject(new Error('Client Supabase indisponible.'));
  return c.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
}
function audit(action, details) {
  try { window.ANAGROCI_AUDIT && window.ANAGROCI_AUDIT.log(action, details || {}); } catch (e) {}
}
/* Le serveur n'accepte la décision que d'un Branch Manager (est_bm()). On
   applique la même règle à l'interface : proposer une action interdite est une
   faute d'interface, même si le serveur la refuse ensuite. */
function isBM() {
  var a = window.ANAGROCI_AUTH;
  return !!(a && a.profile && a.profile.role === 'Branch Manager');
}
function friendly(err) {
  var s = String((err && err.message) || (err && err.details) || err || '');
  if (/row-level security|permission|policy/i.test(s)) return 'Action refusée par les droits d’accès : votre fonction ne permet pas cette opération.';
  if (/stock|insuffis|negative|négatif/i.test(s)) return 'Action bloquée : le stock disponible ne permet pas cette opération.';
  if (/network|fetch|timeout/i.test(s)) return 'Réseau indisponible. Réessayez une fois la connexion revenue.';
  return s || 'Opération impossible.';
}

/* Les états sont proposés avec leur libellé métier, jamais avec le code brut. */
var COUNT_STATES = ['UTILISABLE', 'PLEIN', 'EN_TRANSIT', 'DECHIRE', 'A_REPARER', 'REPARE', 'REFORME'];
var FROM_STATES = ['DECHIRE', 'A_REPARER', 'REPARE'];
var TO_STATES = ['A_REPARER', 'REPARE', 'UTILISABLE', 'REFORME'];
var LOSS_STATES = ['UTILISABLE', 'PLEIN', 'EN_TRANSIT', 'DECHIRE', 'A_REPARER', 'REPARE', 'REFORME'];

function stateOptions(list, selected) {
  var S = shell();
  return list.map(function (s) {
    return '<option value="' + escapeHtml(s) + '"' + (selected === s ? ' selected' : '') + '>' +
      escapeHtml(S.stateLabel(s)) + '</option>';
  }).join('');
}
function locationOptions(selected, cluster) {
  var list = LOC.slice();
  if (cluster) {
    var inCluster = list.filter(function (x) { return String(x.cluster || '') === String(cluster); });
    if (inCluster.length) list = inCluster.concat(list.filter(function (x) { return String(x.cluster || '') !== String(cluster); }));
  }
  return '<option value="">Choisir une localisation</option>' + list.map(function (x) {
    return '<option value="' + escapeHtml(x.code) + '"' + (selected === x.code ? ' selected' : '') + '>' +
      escapeHtml((x.cluster ? x.cluster + ' · ' : '') + (x.nom || x.code)) + '</option>';
  }).join('');
}
/* Rattache une ligne de la Control Tower à une localisation du référentiel.
   Si le rattachement n'est pas certain, on ne présélectionne rien plutôt que
   de risquer une opération sur la mauvaise localisation. */
function findLocation(ctx) {
  if (!ctx) return '';
  if (ctx.location) return ctx.location;
  var id = String(ctx.rtId || '');
  if (!id) return '';
  var hit = '';
  LOC.forEach(function (x) {
    if (hit) return;
    var code = String(x.code || '');
    if (code === id || code === 'AFLP-RT-' + id || code.slice(-id.length) === id) hit = code;
  });
  return hit;
}

async function load() {
  try {
    var rs = await Promise.all([rpc('sacherie_ct_locations'), rpc('sacherie_ct_pertes')]);
    LOC = rs[0] || [];
    LOSSES = rs[1] || [];
    LOAD_ERROR = '';
  } catch (e) {
    LOAD_ERROR = friendly(e);
  }
  LOADED = true;
  var S = shell();
  if (S) { S.refresh(); S.refreshBadges(); }
}
async function refresh() {
  try {
    LOSSES = (await rpc('sacherie_ct_pertes')) || [];
    if (window.ANAGROCI_SACHERIE_CT && window.ANAGROCI_SACHERIE_CT.reload) await window.ANAGROCI_SACHERIE_CT.reload();
    else { var S = shell(); if (S) S.refresh(); }
  } catch (e) { /* le message d'erreur a déjà été montré à l'utilisateur */ }
}

/* --------------------------------------------------------- Opération 1/3 */
function openInventory(ctx) {
  var S = shell();
  var loc = findLocation(ctx);
  S.panel({
    title: 'Comptage physique',
    subtitle: 'Le comptage ne remplace pas le registre : il l’éprouve. L’écart constaté est conservé tel quel.',
    body:
      '<div class="sacx-recap">Tolérance appliquée : <b>' + escapeHtml(S.toleranceLabel()) + '</b>. ' +
      'Au-delà de 3 % ou 50 sacs, l’écart est classé à traiter et doit être expliqué.</div>' +
      field('Localisation', '<select id="opLoc">' + locationOptions(loc, ctx && ctx.cluster) + '</select>') +
      field('État compté', '<select id="opState">' + stateOptions(COUNT_STATES, (ctx && ctx.state) || 'UTILISABLE') + '</select>') +
      field('Quantité physique comptée', '<input id="opQty" type="number" min="0" step="1" inputmode="numeric">') +
      field('Motif si écart', '<textarea id="opReason" placeholder="Expliquez tout écart constaté"></textarea>',
        'Un écart sans explication reste ouvert et remonte dans les exceptions.'),
    actions: [
      { label: 'Enregistrer le comptage', onClick: function (api) { return submitInventory(api); } },
      { label: 'Annuler', variant: 'secondary', onClick: function (api) { api.close(); } }
    ]
  });
}
function submitInventory(api) {
  var loc = val('opLoc'), state = val('opState'), qty = val('opQty'), reason = val('opReason');
  if (!loc) return api.message('Choisissez la localisation comptée.', 'err');
  if (qty === '' || Number(qty) < 0) return api.message('Saisissez la quantité physique comptée.', 'err');
  return rpc('sacherie_ct_inventorier', {
    p_location: loc, p_state: state, p_counted: Number(qty),
    p_reason: reason || null, p_proof: null
  }).then(function (r) {
    audit('bag_inventory_counted', { location: loc, state: state, counted: Number(qty), status: r && r.status });
    api.close();
    shell().toast('Comptage enregistré : ' + (r && r.status ? r.status : 'traité') +
      ' · écart ' + (r && r.difference !== undefined ? r.difference : '—') + ' sac(s).');
    return refresh();
  }, function (e) { api.message(friendly(e), 'err'); });
}

/* --------------------------------------------------------- Opération 2/3 */
function openState(ctx) {
  var S = shell();
  var loc = findLocation(ctx);
  var context = ctx && (ctx.cluster || ctx.rtId)
    ? '<div class="sacx-recap">Origine : <b>' + escapeHtml((ctx.cluster ? 'Cluster ' + ctx.cluster : '') +
        (ctx.rtId ? ' · RT ' + ctx.rtId : '')) + '</b>' +
      (loc ? '' : '<br>La localisation exacte n’a pas pu être rattachée automatiquement : choisissez-la ci-dessous.') +
      '</div>'
    : '';
  S.panel({
    title: 'Traiter des sacs abîmés',
    subtitle: 'Réparation, remise en service ou rebut. Le patrimoine reste compté à chaque étape.',
    body: context +
      field('Localisation', '<select id="opLoc">' + locationOptions(loc, ctx && ctx.cluster) + '</select>') +
      field('État actuel', '<select id="opFrom">' + stateOptions(FROM_STATES, (ctx && ctx.fromState) || 'DECHIRE') + '</select>') +
      field('Nouvel état', '<select id="opTo">' + stateOptions(TO_STATES, 'A_REPARER') + '</select>') +
      field('Quantité', '<input id="opQty" type="number" min="1" step="1" inputmode="numeric">') +
      field('Motif / décision', '<textarea id="opReason" placeholder="Ex. envoyés en réparation, irréparables, contrôle OK"></textarea>'),
    actions: [
      { label: 'Appliquer le changement d’état', onClick: function (api) { return submitState(api); } },
      { label: 'Annuler', variant: 'secondary', onClick: function (api) { api.close(); } }
    ]
  });
}
function submitState(api) {
  var loc = val('opLoc'), from = val('opFrom'), to = val('opTo'), qty = Number(val('opQty')), reason = val('opReason');
  if (!loc) return api.message('Choisissez la localisation concernée.', 'err');
  if (!(qty > 0)) return api.message('Saisissez une quantité supérieure à zéro.', 'err');
  if (from === to) return api.message('L’état d’arrivée doit différer de l’état de départ.', 'err');
  if (!reason.trim()) return api.message('Un motif est obligatoire pour tracer un changement d’état.', 'err');
  return rpc('sacherie_ct_traiter_etat', {
    p_location: loc, p_from_state: from, p_to_state: to, p_qty: qty, p_reason: reason, p_proof: null
  }).then(function () {
    audit('bag_state_changed', { location: loc, from_state: from, to_state: to, qty: qty });
    api.close();
    shell().toast('Changement d’état enregistré : ' + qty + ' sac(s) ' +
      shell().stateLabel(from).toLowerCase() + ' → ' + shell().stateLabel(to).toLowerCase() + '.');
    return refresh();
  }, function (e) { api.message(friendly(e), 'err'); });
}

/* --------------------------------------------------------- Opération 3/3 */
function openLoss(ctx) {
  var S = shell();
  var loc = findLocation(ctx);
  S.panel({
    title: 'Déclarer une perte',
    subtitle: 'La déclaration n’est pas une sortie de stock.',
    body:
      '<div class="sacx-recap">Le stock ne sera diminué <b>qu’après décision du Branch Manager</b>. ' +
      'Jusque-là, les sacs restent comptés au parc et la déclaration apparaît dans la file « À décider ».</div>' +
      field('Localisation responsable', '<select id="opLoc">' + locationOptions(loc, ctx && ctx.cluster) + '</select>') +
      field('État des sacs', '<select id="opState">' + stateOptions(LOSS_STATES, (ctx && ctx.state) || 'UTILISABLE') + '</select>') +
      field('Quantité perdue', '<input id="opQty" type="number" min="1" step="1" inputmode="numeric">') +
      field('Cause / circonstance', '<textarea id="opReason" placeholder="Description obligatoire de l’incident"></textarea>',
        'Description obligatoire : elle sera lue par le Branch Manager au moment de décider.'),
    actions: [
      { label: 'Soumettre au Branch Manager', onClick: function (api) { return submitLoss(api); } },
      { label: 'Annuler', variant: 'secondary', onClick: function (api) { api.close(); } }
    ]
  });
}
function submitLoss(api) {
  var loc = val('opLoc'), state = val('opState'), qty = Number(val('opQty')), reason = val('opReason');
  if (!loc) return api.message('Choisissez la localisation responsable.', 'err');
  if (!(qty > 0)) return api.message('Saisissez une quantité supérieure à zéro.', 'err');
  if (!reason.trim()) return api.message('La description de l’incident est obligatoire.', 'err');
  return rpc('sacherie_ct_declarer_perte', {
    p_location: loc, p_state: state, p_qty: qty, p_reason: reason, p_proof: null
  }).then(function () {
    audit('bag_loss_declared', { location: loc, state: state, qty: qty });
    api.close();
    shell().toast('Perte soumise. Le stock ne sera diminué qu’après décision du Branch Manager.');
    return refresh();
  }, function (e) { api.message(friendly(e), 'err'); });
}

/* ------------------------------------------------ Décision du BM sur une perte */
function openLossDecision(loss) {
  var S = shell();
  if (!isBM()) return S.toast('Seul le Branch Manager décide d’une perte.', 'err');
  S.panel({
    title: 'Décision sur une perte',
    subtitle: 'Approuver sort définitivement les sacs du parc. Refuser ne modifie aucun stock.',
    body:
      '<div class="sacx-recap"><dl>' +
        '<dt>Cluster</dt><dd>' + escapeHtml(loss.cluster || '—') + '</dd>' +
        '<dt>Localisation</dt><dd>' + escapeHtml(loss.location_name || loss.location_code || '—') + '</dd>' +
        '<dt>État des sacs</dt><dd>' + escapeHtml(S.stateLabel(loss.state)) + '</dd>' +
        '<dt>Quantité</dt><dd>' + escapeHtml(S.fmt(loss.qty)) + ' sacs</dd>' +
        '<dt>Déclarée</dt><dd>' + escapeHtml(loss.submitted_at ? S.dt(loss.submitted_at) + ' (' + S.ageLabel(loss.submitted_at) + ')' : '—') + '</dd>' +
      '</dl></div>' +
      '<div class="sacx-field"><label>Motif déclaré</label>' +
        '<div class="help" style="background:#fff;border:1px solid #E8E7E7;border-radius:8px;padding:10px 11px">' +
        escapeHtml(loss.motif || 'Aucun motif saisi.') + '</div></div>' +
      field('Commentaire de décision', '<textarea id="opComment" placeholder="Obligatoire en cas de refus"></textarea>'),
    actions: [
      { label: 'Approuver la sortie', onClick: function (api) { return decide(api, loss, true); } },
      { label: 'Refuser', variant: 'secondary', onClick: function (api) { return decide(api, loss, false); } },
      { label: 'Fermer', variant: 'secondary', onClick: function (api) { api.close(); } }
    ]
  });
}
function decide(api, loss, approve) {
  var comment = val('opComment');
  if (!approve && !comment.trim()) return api.message('Un motif est obligatoire pour refuser une déclaration de perte.', 'err');
  return rpc('sacherie_ct_decider_perte', {
    p_id: loss.id, p_approve: approve, p_comment: comment || null
  }).then(function () {
    audit(approve ? 'bag_loss_approved' : 'bag_loss_rejected', { loss_id: loss.id, qty: loss.qty });
    api.close();
    shell().toast(approve
      ? 'Perte approuvée : ' + shell().fmt(loss.qty) + ' sac(s) sortis du stock canonique.'
      : 'Perte refusée. Aucun stock modifié.');
    return refresh();
  }, function (e) { api.message(friendly(e), 'err'); });
}

/* ------------------------------------------------------------- Fragments */
function field(label, control, help) {
  return '<div class="sacx-field"><label>' + escapeHtml(label) + '</label>' + control +
    (help ? '<span class="help">' + escapeHtml(help) + '</span>' : '') + '</div>';
}
function val(id) {
  var e = document.getElementById(id);
  return e ? String(e.value == null ? '' : e.value).trim() : '';
}
function pendingLosses() {
  return LOSSES.filter(function (x) { return String(x.statut || '').toUpperCase() === 'SOUMIS'; });
}

/* ------------------------------------------- Section « Pertes » (Contrôles) */
function sectionPertes(host) {
  var S = shell();
  var inner = '<div class="sacx-cardhead"><h2>Pertes déclarées</h2>' +
    '<span class="sacx-count">' + S.fmt(LOSSES.length) + ' déclaration(s)</span></div>' +
    '<p class="sacx-hint">Une perte déclarée ne diminue le stock qu’après décision du Branch Manager. ' +
    'Tant qu’elle est soumise, les sacs restent comptés au parc.</p>' +
    '<div class="sacx-filters"><button class="sacx-btn sm" type="button" data-newloss="1">Déclarer une perte</button></div>';
  if (!LOADED) {
    inner += '<span class="sacx-skel" style="width:60%"></span>';
  } else if (LOAD_ERROR) {
    inner += '<div class="sacx-empty bad">' + escapeHtml(LOAD_ERROR) + '</div>';
  } else if (!LOSSES.length) {
    inner += '<div class="sacx-empty good">Aucune perte déclarée.</div>';
  } else {
    inner += '<div class="sacx-tw"><table><thead><tr><th>Date</th><th>Cluster</th><th>Localisation</th>' +
      '<th>État</th><th class="num">Qté</th><th>Motif</th><th>Statut</th><th>Action</th></tr></thead><tbody>' +
      LOSSES.map(function (x, i) {
        var soumis = String(x.statut || '').toUpperCase() === 'SOUMIS';
        var motif = String(x.motif || '—');
        return '<tr><td>' + escapeHtml(x.submitted_at ? S.dt(x.submitted_at) : '—') + '</td>' +
          '<td>' + escapeHtml(x.cluster || '—') + '</td>' +
          '<td>' + escapeHtml(x.location_name || x.location_code || '—') + '</td>' +
          '<td>' + escapeHtml(S.stateLabel(x.state)) + '</td>' +
          '<td class="num">' + escapeHtml(S.fmt(x.qty)) + '</td>' +
          '<td title="' + escapeHtml(motif) + '">' + escapeHtml(motif.length > 70 ? motif.slice(0, 70) + '…' : motif) + '</td>' +
          '<td>' + S.pill(S.statusLevel(x.statut), S.statusLabel(x.statut)) + '</td>' +
          '<td>' + (soumis && isBM()
            ? '<button class="sacx-btn sm" type="button" data-loss="' + i + '">Décider</button>'
            : soumis ? '<span class="sacx-count">Réservé au Branch Manager</span>' : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  host.innerHTML = '<section class="sacx-card">' + inner + '</section>';
  var nl = host.querySelector('[data-newloss]');
  if (nl) nl.addEventListener('click', function () { openLoss({}); });
  host.querySelectorAll('[data-loss]').forEach(function (b) {
    b.addEventListener('click', function () { openLossDecision(LOSSES[Number(b.getAttribute('data-loss'))]); });
  });
}

/* --------------------------------------------------------- Enregistrement */
function register() {
  var S = shell();
  if (!S) return false;

  S.operation({
    key: 'inventory', order: 20, label: 'Comptage physique',
    desc: 'Inventaire d’une localisation',
    open: openInventory
  });
  S.operation({
    key: 'state', order: 30, label: 'Traiter des sacs abîmés',
    desc: 'Réparation, remise en service, rebut',
    open: openState
  });
  S.operation({
    key: 'loss', order: 40, label: 'Déclarer une perte',
    desc: 'Soumise à la décision du Branch Manager',
    open: openLoss
  });

  S.decisionSource(function () {
    return pendingLosses().map(function (x) {
      return {
        id: 'loss-' + x.id,
        type: 'perte',
        groupLabel: 'Pertes à décider',
        level: 'traiter',
        at: x.submitted_at,
        title: 'Perte de ' + S.fmt(x.qty) + ' sac(s) soumise, sans décision',
        subtitle: (x.cluster ? x.cluster + ' · ' : '') + (x.location_name || x.location_code || '') +
          (x.motif ? ' · ' + String(x.motif).slice(0, 60) : ''),
        open: function () { isBM() ? openLossDecision(x) : S.openTab('controles', {}); }
      };
    });
  });

  S.section({ tab: 'controles', key: 'pertes', order: 20, render: sectionPertes });
  return true;
}

window.ANAGROCI_SACHERIE_CT_ACTIONS = {
  reload: load,
  decide: function (id) {
    var hit = null;
    LOSSES.forEach(function (x) { if (String(x.id) === String(id)) hit = x; });
    if (hit) openLossDecision(hit);
  }
};

function boot() {
  var mod = window.ANAGROCI_MODULE || (window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.module);
  if (mod !== 'sacs' || !shell()) return setTimeout(boot, 120);
  if (!register()) return setTimeout(boot, 120);
  load();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 140); });
else setTimeout(boot, 140);
})();
