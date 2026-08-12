/* ANAGROCI Operations Suite — Sacherie AFLP 2027
   ---------------------------------------------------------------------------
   Ce fichier porte deux choses :

   1. LA COQUILLE (window.ANAGROCI_SACHERIE_SHELL) — en-tête unique, cinq
      onglets, bouton « Nouvelle opération », panneau latéral de décision,
      bande « À décider », pied de page. Les trois modules de la Sacherie s'y
      enregistrent au lieu d'afficher chacun sa propre page avec son propre
      bandeau, sa propre barre d'onglets et sa propre feuille de style.

   2. LA CONTROL TOWER — lecture du registre canonique (sacherie_ct_snapshot)
      et rendu des vues Pilotage, Réseau, Flux (journal), État du parc,
      Contrôles.

   SÉCURITÉ — correctif P0
   L'ancienne fonction esc() n'échappait pas l'apostrophe alors que des noms de
   clusters et de RT étaient injectés dans des attributs onclick délimités par
   des apostrophes : onclick="…openCluster('CLUSTER')". Un nom ivoirien courant
   (N'DA, KOFFI N'GUESSAN) cassait la navigation ; une valeur fabriquée
   permettait d'exécuter du code arbitraire.

   Deux mesures, pas une :
   · escapeHtml() échappe désormais & < > " ' et le rétro-accent ;
   · plus AUCUN gestionnaire en ligne ne reçoit de donnée : le contexte passe
     par des attributs data-* lus par des écouteurs délégués.
   La seconde est celle qui protège réellement : dans un attribut onclick, le
   parseur HTML décode &#39; AVANT que le JavaScript ne soit compilé, donc
   échapper l'apostrophe n'aurait pas suffi.
   ------------------------------------------------------------------------- */
(function () {
'use strict';
if (window.__ANAGROCI_SACHERIE_CT) return;
window.__ANAGROCI_SACHERIE_CT = true;

/* ==========================================================================
   PARTIE 1 — COQUILLE
   ========================================================================== */

var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (ch) { return ENTITIES[ch]; });
}

function num(v) { var x = Number(v); return Number.isFinite(x) ? x : 0; }
function fmt(v) { return num(v).toLocaleString('fr-FR'); }
function signed(v) { var x = num(v); return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toLocaleString('fr-FR'); }
function parseDate(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
function dt(v) { var d = parseDate(v); return d ? d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Jamais'; }
function dateOnly(v) { var d = parseDate(v); return d ? d.toLocaleDateString('fr-FR') : '—'; }
function hhmm(v) { var d = parseDate(v); return d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function daysSince(v) { var d = parseDate(v); return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null; }
function hoursUntil(v) { var d = parseDate(v); return d ? Math.floor((d.getTime() - Date.now()) / 3600000) : null; }
/* Ancienneté lisible. Une échéance à venir n'est pas une ancienneté : une
   approbation qui expire dans 21 h affichait « moins d'1 h », ce qui disait
   exactement le contraire de la réalité. */
function ageLabel(v) {
  var d = parseDate(v); if (!d) return '';
  var h = Math.round((Date.now() - d.getTime()) / 3600000);
  if (h < 0) {
    var futur = -h;
    return futur < 48 ? 'dans ' + futur + ' h' : 'dans ' + Math.floor(futur / 24) + ' j';
  }
  if (h < 1) return 'moins d’1 h';
  if (h < 48) return h + ' h';
  return Math.floor(h / 24) + ' j';
}
function whenLabel(v) {
  var d = parseDate(v); if (!d) return '—';
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var day = new Date(d.getTime()); day.setHours(0, 0, 0, 0);
  var diff = Math.round((today - day) / 86400000);
  if (diff === 0) return hhmm(v);
  if (diff === 1) return 'Hier ' + hhmm(v);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + hhmm(v);
}

/* Échelle unique à quatre niveaux. Aucun statut n'est porté par la seule couleur. */
var LEVELS = {
  normal:   { label: 'Normal',       tone: 'normal' },
  surveil:  { label: 'À surveiller', tone: 'surveil' },
  traiter:  { label: 'À traiter',    tone: 'traiter' },
  suspendu: { label: 'Suspendu',     tone: 'suspendu' }
};
var LEVEL_RANK = { traiter: 0, surveil: 1, normal: 2, suspendu: 3 };
/* Piège évité ici : le rang du niveau le plus grave vaut zéro, et une valeur de
   repli écrite avec l'opérateur « ou » le transformait en 9 — le plus grave se
   retrouvait donc trié en dernier. Toujours passer par cette fonction. */
function rank(level) {
  var r = LEVEL_RANK[level];
  return r === undefined ? 9 : r;
}
function levelOf(k) { return LEVELS[k] || LEVELS.normal; }
function pill(key, text) {
  var l = levelOf(key);
  return '<span class="sacx-pill sacx-' + l.tone + '">' + escapeHtml(text || l.label) + '</span>';
}
function levelFromStatus(s) {
  s = String(s || '').toUpperCase();
  if (s === 'CRITIQUE') return 'traiter';
  if (s === 'ATTENTION') return 'surveil';
  if (s === 'NORMAL') return 'normal';
  return 'suspendu';
}

/* Tolérance d'écart d'inventaire : explicite et affichée, jamais binaire. */
var TOLERANCE = { relative: 0.01, absolute: 5, criticalRelative: 0.03, criticalAbsolute: 50 };
function gapLevel(difference, theoretical) {
  if (difference === null || difference === undefined || difference === '') return 'suspendu';
  var d = Math.abs(num(difference)), t = Math.abs(num(theoretical));
  if (d === 0) return 'normal';
  if (d <= Math.max(TOLERANCE.absolute, t * TOLERANCE.relative)) return 'normal';
  if (d > Math.max(TOLERANCE.criticalAbsolute, t * TOLERANCE.criticalRelative)) return 'traiter';
  return 'surveil';
}
function toleranceLabel() {
  return 'tolérance d’écart ' + (TOLERANCE.relative * 100) + ' % ou ' + TOLERANCE.absolute + ' sacs';
}

/* Vocabulaire unique : les codes techniques ne sont jamais affichés bruts. */
var STATE_LABELS = {
  UTILISABLE: 'Vide', EMPTY: 'Vide', VIDE: 'Vide',
  PLEIN: 'Plein', FULL: 'Plein',
  EN_TRANSIT: 'En transit', IN_TRANSIT: 'En transit',
  DECHIRE: 'Abîmé', DAMAGED: 'Abîmé',
  A_REPARER: 'À réparer', REPARE: 'Réparé',
  REFORME: 'Rebut', REBUT: 'Rebut', RETOURNE: 'Retourné',
  HUMIDE: 'Humide', A_CLASSER: 'À classer'
};
var STATUS_LABELS = {
  DRAFT: 'Brouillon', DRAFT_LOCAL: 'Brouillon local', PENDING_BM: 'En attente',
  APPROVED: 'Approuvée', PARTIALLY_EXECUTED: 'Partiellement remise', EXECUTED: 'Remise',
  HOLD: 'Suspendue', REJECTED: 'Rejetée', FAIL_INCIDENT: 'Incident', CLOSED: 'Clôturée',
  OPEN: 'Ouvert', SOUMIS: 'Soumise', APPROUVE: 'Approuvée', REFUSE: 'Refusée'
};
function stateLabel(s) { return STATE_LABELS[String(s || '').toUpperCase()] || (s ? String(s) : '—'); }
function statusLabel(s) { return STATUS_LABELS[String(s || '').toUpperCase()] || (s ? String(s) : '—'); }
function statusLevel(s) {
  s = String(s || '').toUpperCase();
  if (/APPROVED|EXECUTED|APPROUVE/.test(s)) return 'normal';
  if (/HOLD|REJECTED|FAIL|REFUSE/.test(s)) return 'traiter';
  if (/PENDING|SOUMIS|DRAFT/.test(s)) return 'surveil';
  return 'suspendu';
}
function locLabel(code) {
  if (!code) return 'Extérieur';
  return String(code)
    .replace(/^AFLP-CL-/, 'Cluster ')
    .replace(/^AFLP-RT-/, 'RT ')
    .replace(/^AFLP-PROD-/, 'Producteur ')
    .replace(/^AFLP-HUB-/, 'Hub ')
    .replace(/^AFLP-FACTORY-/, 'Usine ');
}
function isRTLoc(code) { return /^AFLP-RT-/.test(String(code || '')); }

var TABS = [
  { id: 'pilotage',  label: 'Pilotage' },
  { id: 'reseau',    label: 'Réseau' },
  { id: 'flux',      label: 'Flux' },
  { id: 'parc',      label: 'État du parc' },
  { id: 'controles', label: 'Contrôles' }
];

var SECTIONS = [], OPERATIONS = [], DECISION_SOURCES = [], READY_CBS = [];
var SH = { tab: 'pilotage', params: {}, mounted: false };

function $(id) { return document.getElementById(id); }
function el(tag, cls, html) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

function mountShell() {
  if (SH.mounted) return true;
  var host = $('sacherie-app');
  if (!host) return false;
  SH.mounted = true;

  var head = el('div', 'sacx-head');
  head.innerHTML =
    '<div class="sacx-brand"><div>' +
      '<p class="sacx-title">Sacherie AFLP</p>' +
      '<div class="sacx-sub" id="sacxContext">Campagne RCN 2027</div>' +
    '</div></div>' +
    '<div class="sacx-spacer"></div>' +
    '<div class="sacx-who" id="sacxWho"></div>' +
    '<div class="sacx-ops">' +
      '<button class="sacx-btn cta" id="sacxOpsBtn" type="button" aria-haspopup="true" aria-expanded="false">Nouvelle opération</button>' +
      '<div class="sacx-opsmenu" id="sacxOpsMenu" role="menu" hidden></div>' +
    '</div>';

  /* Le portail injecte la puce utilisateur dans #anagroci-userslot. Si elle
     existe déjà, on déplace le nœud plutôt que d'en recréer un : on ne perd ni
     son contenu ni l'écouteur de déconnexion posé par auth-gate.js. */
  var slot = $('anagroci-userslot');
  if (!slot) { slot = document.createElement('span'); slot.id = 'anagroci-userslot'; }
  head.appendChild(slot);

  var nav = el('div', 'sacx-navbar');
  nav.id = 'sacxNav';
  nav.setAttribute('role', 'tablist');

  var main = el('main', 'sacx-main');
  main.id = 'sacxMain';

  var foot = el('footer', 'sacx-foot');
  foot.innerHTML =
    '<span><strong>Règles en vigueur</strong> · 80 kg par sac · marge maximale 10 % · ' + escapeHtml(toleranceLabel()) + '</span>' +
    '<span id="sacxSync">Dernière synchronisation —</span>' +
    '<span class="sacx-spacer"></span>' +
    '<a href="sacs.html?legacy=1">Module historique V1</a>';

  host.innerHTML = '';
  host.id = 'sacx';
  host.appendChild(head);
  host.appendChild(nav);
  host.appendChild(main);
  host.appendChild(foot);

  renderNav();
  wireOps();
  renderTab();
  READY_CBS.splice(0).forEach(function (cb) { try { cb(); } catch (e) {} });
  return true;
}

function renderNav() {
  var nav = $('sacxNav');
  if (!nav) return;
  nav.innerHTML = TABS.map(function (t) {
    return '<button class="sacx-tab" type="button" role="tab" id="sacxTab-' + escapeHtml(t.id) + '"' +
      ' data-tab="' + escapeHtml(t.id) + '" aria-selected="' + (SH.tab === t.id ? 'true' : 'false') + '">' +
      escapeHtml(t.label) +
      '<span class="sacx-tabbadge" data-badge="' + escapeHtml(t.id) + '" hidden></span></button>';
  }).join('');
  nav.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-tab]') : null;
    if (b) openTab(b.getAttribute('data-tab'));
  });
  nav.addEventListener('keydown', function (ev) {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    var i = 0;
    TABS.forEach(function (t, k) { if (t.id === SH.tab) i = k; });
    var next = TABS[(i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    openTab(next.id);
    var b = $('sacxTab-' + next.id);
    if (b) b.focus();
    ev.preventDefault();
  });
  refreshBadges();
}

function refreshBadges() {
  var n = decisions().length;
  TABS.forEach(function (t) {
    var b = document.querySelector('[data-badge="' + t.id + '"]');
    if (!b) return;
    var show = (t.id === 'flux' && n > 0);
    b.hidden = !show;
    if (show) b.textContent = String(n);
  });
}

function availableOps() {
  return OPERATIONS.filter(function (o) {
    try { return !o.can || o.can(); } catch (e) { return false; }
  }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
}
function runOperation(key, ctx) {
  var op = null;
  availableOps().forEach(function (o) { if (o.key === key) op = o; });
  if (!op) return toast('Opération indisponible pour votre fonction.', 'err');
  op.open(ctx || {});
}
function wireOps() {
  var btn = $('sacxOpsBtn'), menu = $('sacxOpsMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', function () {
    if (!menu.hidden) return closeOps();
    var ops = availableOps();
    menu.innerHTML = ops.length
      ? ops.map(function (o, i) {
          return '<button type="button" role="menuitem" data-op="' + i + '">' +
            '<span class="t">' + escapeHtml(o.label) + '</span>' +
            '<span class="d">' + escapeHtml(o.desc || '') + '</span></button>';
        }).join('')
      : '<div style="padding:12px 13px;font-size:12.5px;color:#6F746F">Votre fonction opérationnelle ne permet aucune opération sur ce module.</div>';
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelectorAll('[data-op]').forEach(function (b) {
      b.addEventListener('click', function () {
        var list = availableOps(), op = list[Number(b.getAttribute('data-op'))];
        closeOps();
        if (op && op.open) op.open({});
      });
    });
  });
  document.addEventListener('click', function (ev) {
    if (menu.hidden) return;
    if (!menu.contains(ev.target) && ev.target !== btn) closeOps();
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeOps(); });
}
function closeOps() {
  var btn = $('sacxOpsBtn'), menu = $('sacxOpsMenu');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openTab(id, params) {
  var known = false;
  TABS.forEach(function (t) { if (t.id === id) known = true; });
  if (!known) return;
  SH.tab = id;
  SH.params = params || {};
  document.querySelectorAll('#sacxNav .sacx-tab').forEach(function (b) {
    b.setAttribute('aria-selected', b.getAttribute('data-tab') === id ? 'true' : 'false');
  });
  renderTab();
  if (window.scrollY > 140) window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderTab() {
  var main = $('sacxMain');
  if (!main) return;
  main.innerHTML = '';
  var list = SECTIONS.filter(function (s) { return s.tab === SH.tab; })
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  if (!list.length) {
    main.appendChild(el('section', 'sacx-card', '<div class="sacx-empty">Chargement…</div>'));
    return;
  }
  var params = SH.params;
  list.forEach(function (s) {
    var holder = el('div');
    holder.setAttribute('data-section', s.key);
    holder.style.minWidth = '0';
    main.appendChild(holder);
    try {
      s.render(holder, params);
    } catch (e) {
      holder.innerHTML = '<section class="sacx-card"><h2>Section indisponible</h2>' +
        '<p class="sacx-hint">' + escapeHtml(String((e && e.message) || e)) + '</p></section>';
    }
  });
  /* Les paramètres ne servent qu'une fois : chaque section les a recopiés dans
     son propre état. Les laisser en place rejouerait la navigation d'origine à
     chaque rafraîchissement — et refermerait la fiche que l'on vient d'ouvrir. */
  SH.params = {};
  refreshBadges();
}

function refreshShell() { if (SH.mounted) renderTab(); }

/* Une seule file de décision : demandes en attente, pertes soumises et
   approbations proches de l'expiration, quel que soit le module d'origine. */
function decisions() {
  var out = [];
  DECISION_SOURCES.forEach(function (fn) {
    try { (fn() || []).forEach(function (d) { if (d) out.push(d); }); } catch (e) {}
  });
  return out.sort(function (a, b) {
    var r = rank(a.level) - rank(b.level);
    if (r) return r;
    return (parseDate(a.at) || 0) - (parseDate(b.at) || 0);
  });
}

/* ------------------------------------------------------- Panneau latéral
   Remplace prompt() et confirm() : le contexte de la ligne reste visible
   pendant la saisie, la saisie survit à une erreur serveur, et la mise en page
   est utilisable sur un téléphone. */
var PANEL = null;
function panel(opts) {
  closePanel();
  var scrim = el('div', 'sacx-scrim');
  var box = el('aside', 'sacx-panel');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', String(opts.title || 'Opération'));
  box.innerHTML =
    '<header><div><b>' + escapeHtml(opts.title || '') + '</b>' +
      (opts.subtitle ? '<small>' + escapeHtml(opts.subtitle) + '</small>' : '') +
    '</div><button class="x" type="button" aria-label="Fermer">✕</button></header>' +
    '<div class="sacx-panelbody">' + (opts.body || '') + '<div class="sacx-msg" id="sacxPanelMsg"></div></div>' +
    '<div class="sacx-panelfoot"></div>';

  var foot = box.querySelector('.sacx-panelfoot');
  var actions = opts.actions || [];
  function setBusy(on) {
    foot.querySelectorAll('button').forEach(function (b, i) {
      b.disabled = !!on;
      b.textContent = (on && i === 0) ? 'En cours…' : actions[i].label;
    });
  }
  actions.forEach(function (a) {
    var b = el('button', 'sacx-btn' + (a.variant ? ' ' + a.variant : ''));
    b.type = 'button';
    b.textContent = a.label;
    b.addEventListener('click', function () {
      var api = { close: closePanel, message: panelMessage, busy: setBusy, root: box };
      var res = a.onClick && a.onClick(api);
      if (res && typeof res.then === 'function') {
        setBusy(true);
        res.then(function () { setBusy(false); }, function () { setBusy(false); });
      }
    });
    foot.appendChild(b);
  });

  box.querySelector('.x').addEventListener('click', closePanel);
  scrim.addEventListener('click', closePanel);
  document.body.appendChild(scrim);
  document.body.appendChild(box);
  PANEL = { scrim: scrim, box: box };
  document.addEventListener('keydown', escClose);
  if (opts.onMount) { try { opts.onMount(box); } catch (e) {} }
  var first = box.querySelector('input,select,textarea');
  if (first) { try { first.focus(); } catch (e) {} }
  return { close: closePanel, message: panelMessage, busy: setBusy, root: box };
}
function escClose(ev) { if (ev.key === 'Escape') closePanel(); }
function closePanel() {
  if (!PANEL) return;
  document.removeEventListener('keydown', escClose);
  if (PANEL.scrim.parentNode) PANEL.scrim.parentNode.removeChild(PANEL.scrim);
  if (PANEL.box.parentNode) PANEL.box.parentNode.removeChild(PANEL.box);
  PANEL = null;
}
function panelMessage(text, kind) {
  var m = $('sacxPanelMsg');
  if (!m) return toast(text, kind);
  m.className = 'sacx-msg ' + (kind || 'ok');
  m.textContent = text;
}

var TOAST_TIMER = null;
function toast(text, kind) {
  var old = document.querySelector('.sacx-toast');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  if (TOAST_TIMER) clearTimeout(TOAST_TIMER);
  var t = el('div', 'sacx-toast' + (kind === 'err' ? ' err' : ''));
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.appendChild(t);
  TOAST_TIMER = setTimeout(function () {
    if (t.parentNode) t.parentNode.removeChild(t);
  }, kind === 'err' ? 9000 : 5000);
}

function setContext(campaign, sync) {
  var c = $('sacxContext');
  if (c && campaign) c.textContent = campaign;
  var s = $('sacxSync');
  if (s && sync) s.textContent = sync;
}
function setWho(name, detail) {
  var w = $('sacxWho');
  if (!w) return;
  w.innerHTML = escapeHtml(name || '') + (detail ? '<small>' + escapeHtml(detail) + '</small>' : '');
}

window.ANAGROCI_SACHERIE_SHELL = {
  TABS: TABS,
  escapeHtml: escapeHtml,
  fmt: fmt, num: num, signed: signed, dt: dt, dateOnly: dateOnly, hhmm: hhmm,
  whenLabel: whenLabel, ageLabel: ageLabel, daysSince: daysSince, hoursUntil: hoursUntil,
  parseDate: parseDate,
  pill: pill, levelOf: levelOf, levelFromStatus: levelFromStatus,
  gapLevel: gapLevel, tolerance: TOLERANCE, toleranceLabel: toleranceLabel,
  stateLabel: stateLabel, statusLabel: statusLabel, statusLevel: statusLevel, locLabel: locLabel,
  section: function (s) { SECTIONS.push(s); if (SH.mounted && s.tab === SH.tab) renderTab(); },
  operation: function (o) { OPERATIONS.push(o); },
  operations: availableOps,
  runOperation: runOperation,
  decisionSource: function (fn) { DECISION_SOURCES.push(fn); },
  decisions: decisions,
  openTab: openTab,
  currentTab: function () { return SH.tab; },
  params: function () { return SH.params; },
  refresh: refreshShell,
  refreshBadges: refreshBadges,
  panel: panel,
  closePanel: closePanel,
  toast: toast,
  setContext: setContext,
  setWho: setWho,
  mounted: function () { return SH.mounted; },
  ready: function (cb) { if (SH.mounted) cb(); else READY_CBS.push(cb); }
};

/* ==========================================================================
   PARTIE 2 — CONTROL TOWER (lecture du registre canonique)
   ========================================================================== */

var SB = null, DATA = null, LOAD_ERROR = '', LOADING = true;
var DRILL = { cluster: '', rt: '' };
var FLUX = { q: '', state: '', cluster: '', rt: '', days: '30', page: 0, size: 40 };
var PARC = { cluster: '' };
var DEC = { type: '' };
var PAGE_TITLE_DONE = false;

function client() {
  if (SB) return SB;
  if (window.supabase && window.ANAGROCI_SUPABASE_URL && window.ANAGROCI_SUPABASE_ANON) {
    SB = window.supabase.createClient(window.ANAGROCI_SUPABASE_URL, window.ANAGROCI_SUPABASE_ANON);
  }
  return SB;
}

async function load() {
  var c = client();
  if (!c) { LOADING = false; LOAD_ERROR = 'Client Supabase indisponible.'; return refreshShell(); }
  LOADING = true;
  refreshShell();
  try {
    var r = await c.rpc('sacherie_ct_snapshot');
    if (r.error) throw r.error;
    DATA = r.data || {};
    LOAD_ERROR = '';
    setContext(null, 'Dernière synchronisation ' + hhmm(DATA.generated_at || new Date().toISOString()));
  } catch (e) {
    DATA = null;
    LOAD_ERROR = /sacherie_ct_snapshot/i.test(String((e && e.message) || e))
      ? 'Control Tower non encore activée sur cette base.'
      : String((e && e.message) || e);
  }
  LOADING = false;
  refreshShell();
}

/* ------------------------------------------------------------- Dérivations
   Toutes calculées à partir de ce que le serveur renvoie déjà. Aucun chiffre
   n'est inventé : ce qui n'est pas calculable est affiché comme inconnu. */
function G() { return (DATA && DATA.global) || {}; }
function clusters() { return (DATA && DATA.clusters) || []; }
function rts() { return (DATA && DATA.rts) || []; }
function movements() { return (DATA && DATA.movements) || []; }
function inventories() { return (DATA && DATA.inventories) || []; }
function serverAlerts() { return (DATA && DATA.alerts) || []; }

function clusterOf(name) {
  var found = null;
  clusters().forEach(function (c) { if (String(c.cluster) === String(name)) found = c; });
  return found;
}
function terrainOf(c) { return num(c.stock_chez_rt) + num(c.stock_chez_producteur); }
function immoOf(c) { return num(c.dechires) + num(c.a_reparer) + num(c.rebut); }
function terrainTotal() {
  return clusters().reduce(function (s, c) { return s + terrainOf(c); }, 0);
}
function immobiliseTotal() {
  var g = G();
  return num(g.dechires) + num(g.a_reparer) + num(g.rebut);
}
function clusterLevel(c) {
  if (c.status) return levelFromStatus(c.status);
  return gapLevel(c.inventory_gap, c.total_reseau);
}

/* Rythme de distribution des 30 derniers jours, pour convertir le stock de
   vides en jours de couverture. Non mesurable => affiché comme tel. */
function distributionPerDay() {
  var total = 0;
  movements().forEach(function (m) {
    var d = daysSince(m.movement_at);
    if (d === null || d > 30) return;
    if (isRTLoc(m.to_location)) total += num(m.qty);
  });
  return total > 0 ? total / 30 : 0;
}

/* Couverture en jours de distribution. Au-delà d'un an, le rythme observé est
   trop faible pour être représentatif : on le dit, au lieu d'afficher un nombre
   qui ferait croire à une abondance confortable. */
function coverageLabel(vides, perDay) {
  if (!(perDay > 0)) return 'rythme de distribution non mesurable sur la fenêtre du journal';
  var jours = Math.floor(num(vides) / perDay);
  if (jours > 365) return 'plus d’un an au rythme observé — rythme trop faible pour être représentatif';
  return '≈ ' + fmt(jours) + ' jours de couverture au rythme des 30 derniers jours';
}

/* Transit ouvert : on regroupe le journal par référence de bordereau, et on
   considère ouvert ce qui est entré en transit sans en être ressorti. Sans
   référence, un mouvement n'est pas attribuable : il est compté à part plutôt
   que deviné. */
function openTransit() {
  var byRef = {}, unattributed = 0;
  movements().forEach(function (m) {
    var inTransit = String(m.to_state || '').toUpperCase() === 'EN_TRANSIT';
    var outTransit = String(m.from_state || '').toUpperCase() === 'EN_TRANSIT';
    if (!inTransit && !outTransit) return;
    var ref = String(m.reference || '').trim();
    if (!ref) { if (inTransit) unattributed += num(m.qty); return; }
    if (!byRef[ref]) byRef[ref] = { ref: ref, inQty: 0, outQty: 0, at: null, cluster: m.cluster, from: m.from_location, to: m.to_location };
    if (inTransit) {
      byRef[ref].inQty += num(m.qty);
      if (!byRef[ref].at || parseDate(m.movement_at) < parseDate(byRef[ref].at)) byRef[ref].at = m.movement_at;
    }
    if (outTransit) byRef[ref].outQty += num(m.qty);
  });
  var open = [];
  Object.keys(byRef).forEach(function (k) {
    var x = byRef[k], rest = x.inQty - x.outQty;
    if (rest > 0) open.push({ reference: x.ref, qty: rest, at: x.at, cluster: x.cluster, from: x.from, to: x.to, days: daysSince(x.at) });
  });
  return { lots: open, unattributed: unattributed };
}
function transitOverdue() {
  return openTransit().lots.filter(function (x) { return x.days !== null && x.days > 7; });
}

/* Comptages hors tolérance : la mesure de la qualité du registre. */
function gapsOutsideTolerance() {
  return inventories().filter(function (i) {
    var lvl = gapLevel(i.difference_qty, i.theoretical_qty);
    return lvl === 'surveil' || lvl === 'traiter';
  });
}
function openGapTotal() {
  return gapsOutsideTolerance().reduce(function (s, i) { return s + Math.abs(num(i.difference_qty)); }, 0);
}

/* Exceptions : gravité puis ancienneté. Chaque ligne ouvre l'objet concerné.
   Les décisions en attente en font partie — c'est le même travail. */
function exceptions() {
  var out = [];

  gapsOutsideTolerance().forEach(function (i) {
    out.push({
      level: gapLevel(i.difference_qty, i.theoretical_qty),
      title: 'Écart d’inventaire de ' + fmt(Math.abs(num(i.difference_qty))) + ' sac(s) hors tolérance',
      subtitle: (i.cluster ? 'Cluster ' + i.cluster : 'Périmètre non précisé') +
                ' · ' + stateLabel(i.state) + ' · comptage du ' + dateOnly(i.counted_at),
      at: i.counted_at,
      open: function () { openTab('controles'); }
    });
  });

  transitOverdue().forEach(function (x) {
    out.push({
      level: 'traiter',
      title: fmt(x.qty) + ' sac(s) en transit sans confirmation de réception',
      subtitle: locLabel(x.from) + ' → ' + locLabel(x.to) + ' · bordereau ' + x.reference,
      at: x.at,
      open: function () { openTab('flux', { fluxState: 'EN_TRANSIT', fluxQuery: x.reference, fluxRT: '', fluxCluster: '' }); }
    });
  });

  clusters().forEach(function (c) {
    var d = daysSince(c.last_inventory);
    if (c.last_inventory && d !== null && d <= 30) return;
    out.push({
      level: 'surveil',
      title: c.last_inventory
        ? 'Aucun comptage physique depuis ' + d + ' jours'
        : 'Aucun comptage physique enregistré',
      subtitle: 'Cluster ' + c.cluster,
      at: c.last_inventory,
      open: function () { openTab('controles'); }
    });
  });

  clusters().forEach(function (c) {
    if (num(c.rebut) <= 0) return;
    out.push({
      level: 'surveil',
      title: fmt(c.rebut) + ' sac(s) classés rebut, non sortis du parc',
      subtitle: 'Cluster ' + c.cluster + ' · en attente de traitement final',
      at: null,
      open: function () { openTab('parc', { parcCluster: c.cluster }); }
    });
  });

  /* Alertes du serveur : conservées telles quelles, sans ancienneté connue. */
  serverAlerts().forEach(function (a) {
    out.push({
      level: levelFromStatus(a.severity),
      title: String(a.message || 'Alerte'),
      subtitle: (a.cluster ? 'Cluster ' + a.cluster : 'Global') + ' · alerte du registre',
      at: null,
      open: a.cluster ? function () { openTab('reseau', { cluster: a.cluster }); } : null
    });
  });

  /* Les décisions en attente sont des exceptions comme les autres. */
  decisions().forEach(function (d) {
    out.push({ level: d.level, title: d.title, subtitle: d.subtitle, at: d.at, open: d.open });
  });

  return out.sort(function (a, b) {
    var r = rank(a.level) - rank(b.level);
    if (r) return r;
    var da = parseDate(a.at), db = parseDate(b.at);
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return 0;
  });
}

/* ------------------------------------------------------------ Rendu commun */
function card(inner, cls) {
  return '<section class="sacx-card' + (cls ? ' ' + cls : '') + '">' + inner + '</section>';
}
function guard(host) {
  if (LOADING && !DATA) {
    host.innerHTML = card('<h2>Chargement du registre</h2>' +
      '<p class="sacx-hint">Lecture du registre canonique des sacs…</p>' +
      '<span class="sacx-skel" style="width:72%"></span>');
    return true;
  }
  if (!DATA) {
    host.innerHTML = card('<h2>Control Tower indisponible</h2>' +
      '<p class="sacx-hint">' + escapeHtml(LOAD_ERROR || 'Données non chargées.') + '</p>' +
      '<button class="sacx-btn secondary" type="button" data-retry="1">Réessayer</button>');
    var b = host.querySelector('[data-retry]');
    if (b) b.addEventListener('click', load);
    return true;
  }
  return false;
}
/* --------------------------------------------------------- Onglet Pilotage */

/* Zone 3 — bande « À décider ». */
function sectionDecide(host) {
  var list = decisions();
  var groups = {};
  list.forEach(function (d) {
    var k = d.type || 'autre';
    if (!groups[k]) groups[k] = { type: k, label: d.groupLabel || d.type, items: [], level: d.level };
    groups[k].items.push(d);
    if (rank(d.level) < rank(groups[k].level)) groups[k].level = d.level;
  });
  var keys = Object.keys(groups);
  var inner = '<div class="sacx-decide">' +
    '<div style="min-width:126px;flex:0 0 auto">' +
      '<span class="sacx-eyebrow">À décider</span>' +
      '<div style="font-size:12.5px;color:#6F746F;margin-top:4px">Votre file du jour</div>' +
    '</div>';
  if (!keys.length) {
    inner += '<div class="sacx-empty good" style="padding:6px 0;text-align:left">Aucune décision en attente. ' +
      'Les demandes, pertes et approbations proches de l’expiration apparaîtront ici.</div></div>';
    host.innerHTML = card(inner, 'accent');
    return;
  }
  keys.forEach(function (k) {
    var g = groups[k];
    var oldest = null;
    g.items.forEach(function (it) {
      var d = parseDate(it.at);
      if (d && (!oldest || d < oldest)) oldest = d;
    });
    var sub = g.items.length === 1 && g.items[0].subtitle
      ? g.items[0].subtitle
      : (oldest ? 'la plus ancienne : ' + ageLabel(oldest.toISOString()) : 'sans ancienneté connue');
    inner += '<button type="button" class="sacx-decide-item" data-decide="' + escapeHtml(k) + '">' +
      '<span class="sacx-decide-n" style="color:' + (g.level === 'traiter' ? '#C0392B' : g.level === 'surveil' ? '#EE9E00' : '#008F37') + '">' +
        fmt(g.items.length) + '</span>' +
      '<span><span class="sacx-decide-t">' + escapeHtml(g.label) + '</span>' +
      '<span class="sacx-decide-s">' + escapeHtml(sub) + '</span></span></button>';
  });
  inner += '<div class="sacx-spacer" style="flex:1"></div>' +
    '<button class="sacx-btn secondary sm" type="button" data-openflux="1">Ouvrir la file</button></div>';
  host.innerHTML = card(inner, 'accent');
  host.querySelectorAll('[data-decide]').forEach(function (b) {
    b.addEventListener('click', function () {
      openTab('flux', { decisionType: b.getAttribute('data-decide') });
    });
  });
  var of = host.querySelector('[data-openflux]');
  if (of) of.addEventListener('click', function () { openTab('flux', { decisionType: '' }); });
}

/* Zone 4 — six KPI décisionnels, tous cliquables. */
function kpiCard(k) {
  return '<button type="button" class="sacx-kpi' + (k.signal ? ' signal' : '') + '" data-kpi="' + escapeHtml(k.key) + '">' +
    '<span class="l">' + escapeHtml(k.label) + '</span>' +
    '<span class="v">' + k.value + (k.unit === false ? '' : '<em>sacs</em>') + '</span>' +
    '<span class="s">' + escapeHtml(k.sub) + '</span>' +
    '<span class="go">Détail →</span></button>';
}
function sectionKpis(host) {
  if (guard(host)) return;
  var g = G();
  var perDay = distributionPerDay();
  var immo = immobiliseTotal();
  var overdue = transitOverdue();
  var overdueQty = overdue.reduce(function (s, x) { return s + x.qty; }, 0);
  var transitInfo = openTransit();
  var gaps = gapsOutsideTolerance();

  var cards = [
    { key: 'parc', label: 'Parc total', value: fmt(g.total),
      sub: 'tous états, toutes localisations' },
    { key: 'vides', label: 'Vides disponibles', value: fmt(g.vides),
      sub: coverageLabel(g.vides, perDay) },
    { key: 'terrain', label: 'Sous responsabilité terrain', value: fmt(terrainTotal()),
      sub: 'RT et producteurs' },
    { key: 'immobilise', label: 'Parc immobilisé', value: fmt(immo), signal: immo > 0,
      sub: 'abîmés ' + fmt(g.dechires) + ' · à réparer ' + fmt(g.a_reparer) + ' · rebut ' + fmt(g.rebut) },
    { key: 'transit', label: 'Transit > 7 jours',
      value: overdue.length ? fmt(overdueQty) : (transitInfo.lots.length ? '0' : '—'),
      signal: overdueQty > 0,
      sub: transitInfo.lots.length
        ? 'sur ' + fmt(g.transit) + ' sacs en transit' + (transitInfo.unattributed ? ' · ' + fmt(transitInfo.unattributed) + ' sans bordereau, non attribuables' : '')
        : 'ancienneté non calculable : aucun bordereau de transit dans le journal' },
    { key: 'ecart', label: 'Écart d’inventaire ouvert', value: fmt(openGapTotal()),
      signal: gaps.length > 0,
      sub: gaps.length ? fmt(gaps.length) + ' comptage(s) hors tolérance · ' + toleranceLabel() : 'tous les comptages sont dans la tolérance' }
  ];
  host.innerHTML = '<div class="sacx-kpis">' + cards.map(kpiCard).join('') + '</div>';
  host.querySelectorAll('[data-kpi]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-kpi');
      if (k === 'immobilise') return openTab('parc', { parcCluster: '' });
      if (k === 'ecart') return openTab('controles', {});
      if (k === 'transit') return openTab('flux', { fluxState: 'EN_TRANSIT', fluxRT: '', fluxCluster: '', fluxQuery: '' });
      openTab('reseau', { cluster: '' });
    });
  });
}

/* Zone 5 — exceptions. */
function sectionExceptions(host) {
  if (guard(host)) return;
  var all = exceptions();
  var shown = all.slice(0, 8);
  var inner = '<div class="sacx-cardhead"><h2>Exceptions</h2>' +
    '<span class="sacx-count">' + fmt(all.length) + ' ouverte(s)</span></div>' +
    '<p class="sacx-hint">Triées par gravité, puis par ancienneté. Chaque ligne ouvre l’objet concerné.</p>';
  if (!all.length) {
    inner += '<div class="sacx-empty good">Aucune exception ouverte. Registre, comptages et décisions sont à jour.</div>';
    host.innerHTML = card(inner);
    return;
  }
  inner += shown.map(function (e, i) {
    return '<button type="button" class="sacx-exc ' + escapeHtml(levelOf(e.level).tone) + '" data-exc="' + i + '">' +
      '<span style="flex:1"><span class="t">' + escapeHtml(e.title) + '</span>' +
      '<span class="s">' + escapeHtml(e.subtitle || '') + '</span></span>' +
      '<span class="r">' + pill(e.level) +
        (e.at ? '<span class="age" title="' + escapeHtml(dt(e.at)) + '">' + escapeHtml(ageLabel(e.at)) + '</span>' : '') +
      '</span></button>';
  }).join('');
  if (all.length > shown.length) {
    inner += '<div class="sacx-more"><button type="button" data-allexc="1">Voir les ' + fmt(all.length) + ' exceptions →</button></div>';
  }
  host.innerHTML = card(inner);
  host.querySelectorAll('[data-exc]').forEach(function (b) {
    b.addEventListener('click', function () {
      var e = shown[Number(b.getAttribute('data-exc'))];
      if (e && e.open) e.open();
      else toast('Cette alerte ne désigne pas d’objet ouvrable.', 'err');
    });
  });
  var more = host.querySelector('[data-allexc]');
  if (more) more.addEventListener('click', function () { openExceptionsPanel(all); });
}
function openExceptionsPanel(all) {
  panel({
    title: 'Toutes les exceptions',
    subtitle: fmt(all.length) + ' exception(s) ouvertes, triées par gravité puis ancienneté',
    body: all.map(function (e, i) {
      return '<button type="button" class="sacx-exc ' + escapeHtml(levelOf(e.level).tone) + '" data-pexc="' + i + '" style="margin-bottom:8px">' +
        '<span style="flex:1"><span class="t">' + escapeHtml(e.title) + '</span>' +
        '<span class="s">' + escapeHtml(e.subtitle || '') + '</span></span>' +
        '<span class="r">' + pill(e.level) +
          (e.at ? '<span class="age">' + escapeHtml(ageLabel(e.at)) + '</span>' : '') + '</span></button>';
    }).join(''),
    actions: [{ label: 'Fermer', variant: 'secondary', onClick: function (api) { api.close(); } }],
    onMount: function (box) {
      box.querySelectorAll('[data-pexc]').forEach(function (b) {
        b.addEventListener('click', function () {
          var e = all[Number(b.getAttribute('data-pexc'))];
          closePanel();
          if (e && e.open) e.open();
        });
      });
    }
  });
}

/* Zone 6 — réseau condensé, cinq colonnes, trié par risque. */
function sectionReseauCondense(host) {
  if (guard(host)) return;
  var rows = clusters().slice().sort(function (a, b) {
    return rank(clusterLevel(a)) - rank(clusterLevel(b)) || num(b.total_reseau) - num(a.total_reseau);
  }).slice(0, 8);
  var inner = '<div class="sacx-cardhead"><h2>Réseau</h2><span class="sacx-count">trié par risque</span></div>' +
    '<p class="sacx-hint">Cinq colonnes. Le détail complet est dans l’onglet Réseau.</p>';
  if (!rows.length) {
    inner += '<div class="sacx-empty">Aucun cluster dans le registre.</div>';
    host.innerHTML = card(inner);
    return;
  }
  inner += '<div class="sacx-tw"><table><thead><tr><th style="width:14px"></th><th>Cluster</th>' +
    '<th class="num">Parc</th><th class="num">Terrain</th><th class="num">Immobilisé</th><th class="num">Écart</th>' +
    '</tr></thead><tbody>' +
    rows.map(function (c) {
      var lvl = clusterLevel(c);
      var gap = c.inventory_gap;
      var gl = gapLevel(gap, c.total_reseau);
      return '<tr class="sacx-clickable" data-cluster="' + escapeHtml(c.cluster) + '">' +
        '<td><span class="sacx-dot ' + escapeHtml(levelOf(lvl).tone) + '" title="' + escapeHtml(levelOf(lvl).label) + '"></span></td>' +
        '<td class="sacx-strong">' + escapeHtml(c.cluster) + '</td>' +
        '<td class="num">' + fmt(c.total_reseau) + '</td>' +
        '<td class="num">' + fmt(terrainOf(c)) + '</td>' +
        '<td class="num">' + fmt(immoOf(c)) + '</td>' +
        '<td class="num' + (gl === 'traiter' ? ' sacx-neg' : '') + '">' +
          (gap === null || gap === undefined ? '—' : signed(gap)) + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div class="sacx-more"><button type="button" data-allnet="1">Voir tout le réseau →</button></div>';
  host.innerHTML = card(inner);
  host.querySelectorAll('[data-cluster]').forEach(function (tr) {
    tr.addEventListener('click', function () { openTab('reseau', { cluster: tr.getAttribute('data-cluster') }); });
  });
  var all = host.querySelector('[data-allnet]');
  if (all) all.addEventListener('click', function () { openTab('reseau', { cluster: '' }); });
}

/* Zone 7 — activité récente. */
function moveLabel(m) {
  var t = statusLabel(m.source_type || m.movement_type);
  return t + ' · ' + locLabel(m.from_location) + ' → ' + locLabel(m.to_location) +
    (m.reference ? ' · ' + m.reference : '');
}
function sectionActivite(host) {
  if (guard(host)) return;
  var rows = movements().slice().sort(function (a, b) {
    return (parseDate(b.movement_at) || 0) - (parseDate(a.movement_at) || 0);
  }).slice(0, 5);
  var inner = '<h2>Activité récente</h2><p class="sacx-hint">Les cinq derniers mouvements du registre.</p>';
  if (!rows.length) {
    inner += '<div class="sacx-empty">Aucun mouvement enregistré.</div>';
    host.innerHTML = card(inner);
    return;
  }
  inner += rows.map(function (m) {
    return '<div class="sacx-act"><span class="h">' + escapeHtml(whenLabel(m.movement_at)) + '</span>' +
      '<span class="t">' + escapeHtml(moveLabel(m)) + '</span>' +
      '<span class="q">' + fmt(m.qty) + '</span></div>';
  }).join('');
  inner += '<div class="sacx-more"><button type="button" data-journal="1">Journal complet des mouvements →</button></div>';
  host.innerHTML = card(inner);
  var j = host.querySelector('[data-journal]');
  if (j) j.addEventListener('click', function () { openTab('flux', { decisionType: '' }); });
}

/* Assemblage de la colonne double du pilotage (zones 5, 6 et 7). */
function sectionPilotageCols(host) {
  var left = el('div', 'sacx-stack');
  var right = el('div', 'sacx-stack');
  var cols = el('div', 'sacx-cols');
  cols.appendChild(left);
  cols.appendChild(right);
  host.innerHTML = '';
  host.appendChild(cols);
  var a = el('div'), b = el('div'), c = el('div');
  left.appendChild(a);
  right.appendChild(b);
  right.appendChild(c);
  sectionExceptions(a);
  sectionReseauCondense(b);
  sectionActivite(c);
}

/* ----------------------------------------------------------- Onglet Réseau */
function crumb(parts) {
  return '<div class="sacx-crumb">' + parts.map(function (p, i) {
    if (p.action) return '<button type="button" data-crumb="' + i + '">' + escapeHtml(p.label) + '</button>';
    return '<span>' + escapeHtml(p.label) + '</span>';
  }).join(' <span>›</span> ') + '</div>';
}
function sectionReseau(host, params) {
  if (guard(host)) return;
  if (params && params.cluster !== undefined) { DRILL.cluster = params.cluster || ''; DRILL.rt = ''; }
  if (params && params.rt) DRILL.rt = params.rt;
  if (DRILL.rt) return renderRTSheet(host);
  if (DRILL.cluster) return renderClusterRTs(host);
  return renderNetwork(host);
}

function renderNetwork(host) {
  var rows = clusters().slice().sort(function (a, b) {
    return rank(clusterLevel(a)) - rank(clusterLevel(b)) || num(b.total_reseau) - num(a.total_reseau);
  });
  var inner = crumb([{ label: 'Réseau' }]) +
    '<div class="sacx-cardhead"><h2>Tout le réseau</h2><span class="sacx-count">' + fmt(rows.length) + ' cluster(s)</span></div>' +
    '<p class="sacx-hint">Position du patrimoine et dernière situation physique connue. Le risque est en première colonne, ' +
    'et le tri par défaut place en haut ce qui demande une action.</p>';
  if (!rows.length) {
    inner += '<div class="sacx-empty">Aucun cluster dans le registre.</div>';
    host.innerHTML = card(inner);
    return;
  }
  inner += '<div class="sacx-tw"><table><thead><tr>' +
    '<th>Risque</th><th>Cluster</th><th class="num">Parc</th><th class="num">Au cluster</th>' +
    '<th class="num">Chez RT</th><th class="num">Producteurs</th><th class="num">Hub plein</th>' +
    '<th class="num">Immobilisé</th><th class="num">Compté</th><th class="num">Écart</th><th>Dernier comptage</th>' +
    '</tr></thead><tbody>' +
    rows.map(function (c) {
      var lvl = clusterLevel(c);
      var gl = gapLevel(c.inventory_gap, c.total_reseau);
      return '<tr class="sacx-clickable" data-cluster="' + escapeHtml(c.cluster) + '">' +
        '<td>' + pill(lvl) + '</td>' +
        '<td class="sacx-strong">' + escapeHtml(c.cluster) + '</td>' +
        '<td class="num">' + fmt(c.total_reseau) + '</td>' +
        '<td class="num">' + fmt(c.stock_cluster_vide) + '</td>' +
        '<td class="num">' + fmt(c.stock_chez_rt) + '</td>' +
        '<td class="num">' + fmt(c.stock_chez_producteur) + '</td>' +
        '<td class="num">' + fmt(c.stock_hub_plein) + '</td>' +
        '<td class="num">' + fmt(immoOf(c)) + '</td>' +
        '<td class="num">' + (c.physical_stock == null ? '—' : fmt(c.physical_stock)) + '</td>' +
        '<td class="num' + (gl === 'traiter' ? ' sacx-neg' : '') + '">' +
          (c.inventory_gap == null ? '—' : signed(c.inventory_gap)) + '</td>' +
        '<td>' + escapeHtml(c.last_inventory ? dateOnly(c.last_inventory) + ' (' + ageLabel(c.last_inventory) + ')' : 'Jamais') + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table></div>' +
    '<p class="sacx-hint" style="margin:12px 0 0">Un stock physique absent est affiché comme inconnu, jamais remplacé par le stock théorique.</p>';
  host.innerHTML = card(inner);
  host.querySelectorAll('[data-cluster]').forEach(function (tr) {
    tr.addEventListener('click', function () {
      DRILL.cluster = tr.getAttribute('data-cluster');
      DRILL.rt = '';
      refreshShell();
    });
  });
}

function renderClusterRTs(host) {
  var list = rts().filter(function (r) { return String(r.cluster) === String(DRILL.cluster); });
  var inner = crumb([{ label: 'Réseau', action: true }, { label: 'Cluster ' + DRILL.cluster }]) +
    '<div class="sacx-cardhead"><h2>Responsabilité par RT</h2>' +
    '<span class="sacx-count">' + fmt(list.length) + ' RT</span></div>' +
    '<div class="sacx-filters"><span class="sacx-chip">Cluster ' + escapeHtml(DRILL.cluster) +
      '<button type="button" data-clearcluster="1" aria-label="Retirer le filtre cluster">✕</button></span></div>' +
    '<p class="sacx-hint">Le total reste visible même lorsqu’un sac devient abîmé : un changement d’état ne doit ' +
    'jamais faire disparaître le patrimoine.</p>';
  if (!list.length) {
    inner += '<div class="sacx-empty">Aucun RT rattaché à ce cluster dans le registre.</div>';
  } else {
    list.sort(function (a, b) {
      return rank(levelFromStatus(a.risk_level)) - rank(levelFromStatus(b.risk_level)) ||
        num(b.total_sous_responsabilite) - num(a.total_sous_responsabilite);
    });
    inner += '<div class="sacx-tw"><table><thead><tr>' +
      '<th>Risque</th><th>RT</th><th class="num">Total</th><th class="num">Vides</th><th class="num">Pleins</th>' +
      '<th class="num">Abîmés</th><th class="num">À réparer</th><th class="num">Rebut</th><th>Dernière activité</th>' +
      '</tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr class="sacx-clickable" data-rt="' + escapeHtml(r.rt_id) + '">' +
          '<td>' + pill(levelFromStatus(r.risk_level)) + '</td>' +
          '<td class="sacx-strong">' + escapeHtml(String(r.rt_nom || r.rt_id).replace(/^RT\s+/i, '')) + '</td>' +
          '<td class="num sacx-strong">' + fmt(r.total_sous_responsabilite) + '</td>' +
          '<td class="num">' + fmt(r.vides) + '</td>' +
          '<td class="num">' + fmt(r.pleins) + '</td>' +
          '<td class="num">' + fmt(r.dechires) + '</td>' +
          '<td class="num">' + fmt(r.a_reparer) + '</td>' +
          '<td class="num">' + fmt(r.rebut) + '</td>' +
          '<td>' + escapeHtml(r.derniere_activite ? ageLabel(r.derniere_activite) : 'Jamais') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  host.innerHTML = card(inner);
  host.querySelectorAll('[data-crumb]').forEach(function (b) {
    b.addEventListener('click', function () { DRILL.cluster = ''; DRILL.rt = ''; refreshShell(); });
  });
  var clear = host.querySelector('[data-clearcluster]');
  if (clear) clear.addEventListener('click', function () { DRILL.cluster = ''; DRILL.rt = ''; refreshShell(); });
  host.querySelectorAll('[data-rt]').forEach(function (tr) {
    tr.addEventListener('click', function () { DRILL.rt = tr.getAttribute('data-rt'); refreshShell(); });
  });
}

function renderRTSheet(host) {
  var r = null;
  rts().forEach(function (x) { if (String(x.rt_id) === String(DRILL.rt)) r = x; });
  if (!r) { DRILL.rt = ''; return renderClusterRTs(host); }
  var name = String(r.rt_nom || r.rt_id).replace(/^RT\s+/i, '');
  var tiles = [
    { label: 'Total sous responsabilité', value: r.total_sous_responsabilite, state: '' },
    { label: 'Vides', value: r.vides, state: 'UTILISABLE' },
    { label: 'Pleins', value: r.pleins, state: 'PLEIN' },
    { label: 'Abîmés', value: r.dechires, state: 'DECHIRE' },
    { label: 'À réparer', value: r.a_reparer, state: 'A_REPARER' },
    { label: 'Rebut', value: r.rebut, state: 'REFORME' }
  ];
  var inner = crumb([
      { label: 'Réseau', action: true },
      { label: 'Cluster ' + r.cluster, action: true },
      { label: 'RT ' + name }
    ]) +
    '<div class="sacx-cardhead"><h2>' + escapeHtml(name) + '</h2>' +
    '<span class="sacx-count">' + escapeHtml(String(r.cluster || '')) + '</span></div>' +
    '<p class="sacx-hint">Chaque tuile ouvre le journal des mouvements filtré sur ce RT et cet état.</p>' +
    '<div class="sacx-tiles">' + tiles.map(function (t) {
      return '<button type="button" class="sacx-tile" data-tile="' + escapeHtml(t.state) + '">' +
        '<small>' + escapeHtml(t.label) + '</small><b>' + fmt(t.value) + '</b></button>';
    }).join('') + '</div>' +
    '<h3>Derniers mouvements de ce RT</h3>';
  var ms = movements().filter(function (m) { return String(m.rt_id || '') === String(DRILL.rt); }).slice(0, 30);
  if (!ms.length) {
    inner += '<div class="sacx-empty">Aucun mouvement rattaché à ce RT dans la fenêtre du journal.</div>';
  } else {
    inner += '<div class="sacx-tw"><table><thead><tr><th>Date</th><th>Type</th><th class="num">Qté</th><th>État</th></tr></thead><tbody>' +
      ms.map(function (m) {
        return '<tr><td>' + escapeHtml(dt(m.movement_at)) + '</td>' +
          '<td>' + escapeHtml(statusLabel(m.source_type || m.movement_type)) + '</td>' +
          '<td class="num">' + fmt(m.qty) + '</td>' +
          '<td>' + escapeHtml(stateLabel(m.from_state)) + ' → ' + escapeHtml(stateLabel(m.to_state)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  inner += '<div class="sacx-more"><button type="button" data-allmoves="1">Voir tous les mouvements de ce RT →</button></div>';
  host.innerHTML = card(inner);
  var crumbs = host.querySelectorAll('[data-crumb]');
  if (crumbs[0]) crumbs[0].addEventListener('click', function () { DRILL.cluster = ''; DRILL.rt = ''; refreshShell(); });
  if (crumbs[1]) crumbs[1].addEventListener('click', function () { DRILL.rt = ''; refreshShell(); });
  host.querySelectorAll('[data-tile]').forEach(function (b) {
    b.addEventListener('click', function () {
      openTab('flux', { fluxRT: DRILL.rt, fluxState: b.getAttribute('data-tile') || '', fluxCluster: '', fluxQuery: '' });
    });
  });
  var am = host.querySelector('[data-allmoves]');
  if (am) am.addEventListener('click', function () { openTab('flux', { fluxRT: DRILL.rt, fluxState: '', fluxCluster: '', fluxQuery: '' }); });
}

/* ------------------------------------------------- Onglet Flux — décisions */
function sectionDecisions(host, params) {
  var list = decisions();
  if (params && params.decisionType !== undefined) DEC.type = params.decisionType || '';
  var filter = DEC.type;
  if (filter) list = list.filter(function (d) { return d.type === filter; });
  var inner = '<div class="sacx-cardhead"><h2>Décisions</h2>' +
    '<span class="sacx-count">' + fmt(list.length) + ' en attente</span></div>' +
    '<p class="sacx-hint">Une seule file : demandes de sacs, pertes déclarées et approbations proches de l’expiration.</p>';
  if (filter) {
    inner += '<div class="sacx-filters"><span class="sacx-chip">' + escapeHtml(list.length ? (list[0].groupLabel || filter) : filter) +
      '<button type="button" data-clearfilter="1" aria-label="Retirer le filtre">✕</button></span></div>';
  }
  if (!list.length) {
    inner += '<div class="sacx-empty good">Aucune décision en attente.</div>';
    host.innerHTML = card(inner);
    var cf0 = host.querySelector('[data-clearfilter]');
    if (cf0) cf0.addEventListener('click', function () { openTab('flux', { decisionType: '' }); });
    return;
  }
  inner += list.map(function (d, i) {
    return '<button type="button" class="sacx-exc ' + escapeHtml(levelOf(d.level).tone) + '" data-dec="' + i + '">' +
      '<span style="flex:1"><span class="t">' + escapeHtml(d.title) + '</span>' +
      '<span class="s">' + escapeHtml(d.subtitle || '') + '</span></span>' +
      '<span class="r">' + pill(d.level) +
        (d.at ? '<span class="age" title="' + escapeHtml(dt(d.at)) + '">' + escapeHtml(ageLabel(d.at)) + '</span>' : '') +
      '</span></button>';
  }).join('');
  host.innerHTML = card(inner);
  host.querySelectorAll('[data-dec]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = list[Number(b.getAttribute('data-dec'))];
      if (d && d.open) d.open();
    });
  });
  var cf = host.querySelector('[data-clearfilter]');
  if (cf) cf.addEventListener('click', function () { openTab('flux', { decisionType: '' }); });
}

/* --------------------------------------------------- Onglet Flux — journal */
function fluxRows() {
  var q = FLUX.q.trim().toLowerCase();
  var days = FLUX.days ? Number(FLUX.days) : 0;
  return movements().filter(function (m) {
    if (FLUX.state) {
      var from = String(m.from_state || '').toUpperCase(), to = String(m.to_state || '').toUpperCase();
      if (from !== FLUX.state && to !== FLUX.state) return false;
    }
    if (FLUX.cluster && String(m.cluster || '') !== FLUX.cluster) return false;
    if (FLUX.rt && String(m.rt_id || '') !== FLUX.rt) return false;
    if (days) { var d = daysSince(m.movement_at); if (d === null || d > days) return false; }
    if (q) {
      var hay = [m.reference, m.cluster, m.rt_id, m.movement_type, m.source_type,
        locLabel(m.from_location), locLabel(m.to_location)].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }).sort(function (a, b) { return (parseDate(b.movement_at) || 0) - (parseDate(a.movement_at) || 0); });
}
function sectionJournal(host, params) {
  if (guard(host)) return;
  if (params) {
    if (params.fluxState !== undefined) FLUX.state = params.fluxState || '';
    if (params.fluxRT !== undefined) FLUX.rt = params.fluxRT || '';
    if (params.fluxCluster !== undefined) FLUX.cluster = params.fluxCluster || '';
    if (params.fluxQuery !== undefined) FLUX.q = params.fluxQuery || '';
    if (params.fluxState !== undefined || params.fluxRT !== undefined || params.fluxQuery !== undefined) FLUX.page = 0;
  }
  var rows = fluxRows();
  var pages = Math.max(1, Math.ceil(rows.length / FLUX.size));
  if (FLUX.page >= pages) FLUX.page = pages - 1;
  var slice = rows.slice(FLUX.page * FLUX.size, (FLUX.page + 1) * FLUX.size);

  var states = {};
  movements().forEach(function (m) {
    if (m.from_state) states[m.from_state] = 1;
    if (m.to_state) states[m.to_state] = 1;
  });

  var chips = [];
  if (FLUX.state) chips.push({ k: 'state', label: 'État : ' + stateLabel(FLUX.state) });
  if (FLUX.cluster) chips.push({ k: 'cluster', label: 'Cluster ' + FLUX.cluster });
  if (FLUX.rt) chips.push({ k: 'rt', label: 'RT ' + FLUX.rt });
  if (FLUX.q) chips.push({ k: 'q', label: 'Recherche : ' + FLUX.q });

  var inner = '<div class="sacx-cardhead"><h2>Journal des mouvements</h2>' +
    '<span class="sacx-count">' + fmt(rows.length) + ' sur ' + fmt(movements().length) + '</span></div>' +
    '<p class="sacx-hint">Chaque chiffre du tableau de bord remonte à ce registre transactionnel.</p>' +
    '<div class="sacx-filters">' +
      '<input type="search" id="fluxQ" placeholder="Référence, cluster, RT…" value="' + escapeHtml(FLUX.q) + '">' +
      '<select id="fluxState"><option value="">Tous les états</option>' +
        Object.keys(states).sort().map(function (s) {
          return '<option value="' + escapeHtml(s) + '"' + (FLUX.state === s ? ' selected' : '') + '>' + escapeHtml(stateLabel(s)) + '</option>';
        }).join('') + '</select>' +
      '<select id="fluxCluster"><option value="">Tous les clusters</option>' +
        clusters().map(function (c) {
          return '<option value="' + escapeHtml(c.cluster) + '"' + (FLUX.cluster === String(c.cluster) ? ' selected' : '') + '>' + escapeHtml(c.cluster) + '</option>';
        }).join('') + '</select>' +
      '<select id="fluxDays">' +
        [['7', '7 derniers jours'], ['30', '30 derniers jours'], ['90', '90 derniers jours'], ['', 'Toute la fenêtre']].map(function (o) {
          return '<option value="' + o[0] + '"' + (FLUX.days === o[0] ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>';
        }).join('') + '</select>' +
      chips.map(function (c) {
        return '<span class="sacx-chip">' + escapeHtml(c.label) +
          '<button type="button" data-chip="' + escapeHtml(c.k) + '" aria-label="Retirer ce filtre">✕</button></span>';
      }).join('') +
    '</div>';

  if (!slice.length) {
    inner += '<div class="sacx-empty">Aucun mouvement pour ces filtres.</div>';
  } else {
    inner += '<div class="sacx-tw"><table><thead><tr><th>Date</th><th>Type</th><th>Cluster / RT</th>' +
      '<th class="num">Qté</th><th>Trajet</th><th>État</th><th>Référence</th></tr></thead><tbody>' +
      slice.map(function (m) {
        return '<tr><td>' + escapeHtml(dt(m.movement_at)) + '</td>' +
          '<td>' + escapeHtml(statusLabel(m.source_type || m.movement_type)) + '</td>' +
          '<td>' + escapeHtml(m.cluster || '—') + (m.rt_id ? '<br><small>' + escapeHtml(m.rt_id) + '</small>' : '') + '</td>' +
          '<td class="num sacx-strong">' + fmt(m.qty) + '</td>' +
          '<td>' + escapeHtml(locLabel(m.from_location)) + ' → ' + escapeHtml(locLabel(m.to_location)) + '</td>' +
          '<td>' + escapeHtml(stateLabel(m.from_state)) + ' → ' + escapeHtml(stateLabel(m.to_state)) + '</td>' +
          '<td>' + escapeHtml(m.reference || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (pages > 1) {
      inner += '<div class="sacx-filters" style="margin:12px 0 0;align-items:center">' +
        '<button class="sacx-btn secondary sm" type="button" data-page="prev"' + (FLUX.page === 0 ? ' disabled' : '') + '>Précédent</button>' +
        '<span class="sacx-count">Page ' + (FLUX.page + 1) + ' sur ' + pages + '</span>' +
        '<button class="sacx-btn secondary sm" type="button" data-page="next"' + (FLUX.page >= pages - 1 ? ' disabled' : '') + '>Suivant</button>' +
        '</div>';
    }
  }
  host.innerHTML = card(inner);

  var q = host.querySelector('#fluxQ');
  if (q) q.addEventListener('change', function () { FLUX.q = q.value; FLUX.page = 0; refreshShell(); });
  var st = host.querySelector('#fluxState');
  if (st) st.addEventListener('change', function () { FLUX.state = st.value; FLUX.page = 0; refreshShell(); });
  var cl = host.querySelector('#fluxCluster');
  if (cl) cl.addEventListener('change', function () { FLUX.cluster = cl.value; FLUX.page = 0; refreshShell(); });
  var dy = host.querySelector('#fluxDays');
  if (dy) dy.addEventListener('change', function () { FLUX.days = dy.value; FLUX.page = 0; refreshShell(); });
  host.querySelectorAll('[data-chip]').forEach(function (b) {
    b.addEventListener('click', function () {
      FLUX[b.getAttribute('data-chip')] = '';
      FLUX.page = 0;
      refreshShell();
    });
  });
  host.querySelectorAll('[data-page]').forEach(function (b) {
    b.addEventListener('click', function () {
      FLUX.page += (b.getAttribute('data-page') === 'next' ? 1 : -1);
      refreshShell();
    });
  });
}

/* ---------------------------------------------------- Onglet État du parc */
function sectionParc(host, params) {
  if (guard(host)) return;
  var g = G();
  if (params && params.parcCluster !== undefined) PARC.cluster = params.parcCluster || '';
  var filterCluster = PARC.cluster;
  var list = rts().filter(function (r) {
    if (filterCluster && String(r.cluster) !== String(filterCluster)) return false;
    return num(r.dechires) + num(r.a_reparer) + num(r.rebut) > 0;
  }).sort(function (a, b) {
    return (num(b.dechires) + num(b.a_reparer) + num(b.rebut)) - (num(a.dechires) + num(a.a_reparer) + num(a.rebut));
  });

  var kpis = '<div class="sacx-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
    [{ key: 'dechires', label: 'Abîmés', value: g.dechires, sub: 'à évaluer', signal: num(g.dechires) > 0 },
     { key: 'a_reparer', label: 'À réparer', value: g.a_reparer, sub: 'en attente de réparation' },
     { key: 'repares', label: 'Réparés', value: g.repares, sub: 'à reclasser en vides' },
     { key: 'rebut', label: 'Rebut', value: g.rebut, sub: 'encore comptés au parc' }
    ].map(function (k) {
      return '<div class="sacx-kpi' + (k.signal ? ' signal' : '') + '" style="cursor:default">' +
        '<span class="l">' + escapeHtml(k.label) + '</span>' +
        '<span class="v">' + fmt(k.value) + '<em>sacs</em></span>' +
        '<span class="s">' + escapeHtml(k.sub) + '</span></div>';
    }).join('') + '</div>';

  var inner = '<div class="sacx-cardhead"><h2>File de traitement</h2>' +
    '<span class="sacx-count">' + fmt(list.length) + ' responsable(s)</span></div>' +
    '<p class="sacx-hint">Un sac abîmé reste dans le patrimoine. Il doit ensuite être réparé, classé rebut, ou faire ' +
    'l’objet d’une perte approuvée. L’action part de la ligne : la localisation et l’état sont déjà renseignés.</p>';
  if (filterCluster) {
    inner += '<div class="sacx-filters"><span class="sacx-chip">Cluster ' + escapeHtml(filterCluster) +
      '<button type="button" data-clearparc="1" aria-label="Retirer le filtre">✕</button></span></div>';
  }
  if (!list.length) {
    inner += '<div class="sacx-empty good">Aucun sac abîmé, en réparation ou en rebut dans ce périmètre.</div>';
  } else {
    inner += '<div class="sacx-tw"><table><thead><tr><th>Cluster</th><th>Responsable</th>' +
      '<th class="num">Abîmés</th><th class="num">À réparer</th><th class="num">Réparés</th><th class="num">Rebut</th>' +
      '<th>Dernière activité</th><th>Action</th></tr></thead><tbody>' +
      list.map(function (r) {
        var age = r.derniere_activite ? ageLabel(r.derniere_activite) : 'jamais';
        return '<tr><td>' + escapeHtml(r.cluster || '—') + '</td>' +
          '<td class="sacx-strong">' + escapeHtml(String(r.rt_nom || r.rt_id).replace(/^RT\s+/i, '')) + '</td>' +
          '<td class="num">' + fmt(r.dechires) + '</td>' +
          '<td class="num">' + fmt(r.a_reparer) + '</td>' +
          '<td class="num">' + fmt(r.repares) + '</td>' +
          '<td class="num">' + fmt(r.rebut) + '</td>' +
          '<td>' + escapeHtml(age) + '</td>' +
          '<td><button class="sacx-btn sm" type="button" data-treat="' + escapeHtml(r.rt_id) + '"' +
            ' data-treat-cluster="' + escapeHtml(r.cluster || '') + '">Traiter</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  host.innerHTML = kpis + card(inner);
  var cp = host.querySelector('[data-clearparc]');
  if (cp) cp.addEventListener('click', function () { openTab('parc', { parcCluster: '' }); });
  host.querySelectorAll('[data-treat]').forEach(function (b) {
    b.addEventListener('click', function () {
      runOperation('state', {
        rtId: b.getAttribute('data-treat'),
        cluster: b.getAttribute('data-treat-cluster'),
        fromState: 'DECHIRE'
      });
    });
  });
}

/* ------------------------------------------------------ Onglet Contrôles */
function sectionInventaires(host) {
  if (guard(host)) return;
  var inv = inventories().slice().sort(function (a, b) {
    return (parseDate(b.counted_at) || 0) - (parseDate(a.counted_at) || 0);
  });
  var inner = '<div class="sacx-cardhead"><h2>Comptages physiques</h2>' +
    '<span class="sacx-count">' + fmt(inv.length) + ' comptage(s)</span></div>' +
    '<p class="sacx-hint">Écart = compté moins attendu. La tolérance appliquée est de ' + escapeHtml(toleranceLabel()) +
    ' ; au-delà de 3 % ou 50 sacs, l’écart est à traiter. Un stock physique absent reste inconnu.</p>' +
    '<div class="sacx-filters"><button class="sacx-btn sm" type="button" data-newcount="1">Nouveau comptage</button></div>';
  if (!inv.length) {
    inner += '<div class="sacx-empty bad">Aucun comptage physique enregistré. Sans comptage, l’écart entre le registre ' +
      'et le terrain n’est pas mesurable.</div>';
  } else {
    inner += '<div class="sacx-tw"><table><thead><tr><th>Date</th><th>Cluster</th><th>Niveau</th><th>État</th>' +
      '<th class="num">Attendu</th><th class="num">Compté</th><th class="num">Écart</th><th class="num">%</th><th>Statut</th>' +
      '</tr></thead><tbody>' +
      inv.map(function (i) {
        var lvl = gapLevel(i.difference_qty, i.theoretical_qty);
        var th = num(i.theoretical_qty);
        var pct = th ? (Math.abs(num(i.difference_qty)) / th * 100) : null;
        return '<tr><td>' + escapeHtml(dt(i.counted_at)) + '</td>' +
          '<td>' + escapeHtml(i.cluster || '—') + '</td>' +
          '<td>' + escapeHtml(i.scope_type || '—') + '</td>' +
          '<td>' + escapeHtml(stateLabel(i.state)) + '</td>' +
          '<td class="num">' + fmt(i.theoretical_qty) + '</td>' +
          '<td class="num">' + fmt(i.counted_qty) + '</td>' +
          '<td class="num' + (lvl === 'traiter' ? ' sacx-neg' : '') + '">' + signed(i.difference_qty) + '</td>' +
          '<td class="num">' + (pct === null ? '—' : pct.toFixed(1).replace('.', ',') + ' %') + '</td>' +
          '<td>' + pill(lvl) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  host.innerHTML = card(inner);
  var nc = host.querySelector('[data-newcount]');
  if (nc) nc.addEventListener('click', function () { runOperation('inventory', {}); });
}

/* ------------------------------------------------ Enregistrement des vues */
var SHELL = window.ANAGROCI_SACHERIE_SHELL;
SHELL.section({ tab: 'pilotage', key: 'decide', order: 10, render: sectionDecide });
SHELL.section({ tab: 'pilotage', key: 'kpis', order: 20, render: sectionKpis });
SHELL.section({ tab: 'pilotage', key: 'cols', order: 30, render: sectionPilotageCols });
SHELL.section({ tab: 'reseau', key: 'reseau', order: 10, render: sectionReseau });
SHELL.section({ tab: 'flux', key: 'decisions', order: 10, render: sectionDecisions });
SHELL.section({ tab: 'flux', key: 'journal', order: 30, render: sectionJournal });
SHELL.section({ tab: 'parc', key: 'parc', order: 10, render: sectionParc });
SHELL.section({ tab: 'controles', key: 'inventaires', order: 10, render: sectionInventaires });

/* API publique conservée : d'autres écrans peuvent déjà l'appeler. */
window.ANAGROCI_SACHERIE_CT = {
  reload: load,
  openCluster: function (c) { openTab('reseau', { cluster: c }); },
  openRT: function (id) { openTab('reseau', { rt: id }); },
  backRT: function () { DRILL.rt = ''; openTab('reseau', { cluster: DRILL.cluster }); },
  snapshot: function () { return DATA; }
};

function boot() {
  var mod = window.ANAGROCI_MODULE || (window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.module);
  if (mod !== 'sacs') return setTimeout(boot, 120);
  if (!mountShell()) return setTimeout(boot, 120);
  if (!PAGE_TITLE_DONE) {
    PAGE_TITLE_DONE = true;
    var a = window.ANAGROCI_AUTH;
    if (a && a.profile) setWho(a.profile.nom || '', a.profile.role || '');
  }
  load();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 60); });
else setTimeout(boot, 60);
document.addEventListener('anagroci:authenticated', function (e) {
  if (e && e.detail && e.detail.profile) setWho(e.detail.profile.nom || '', e.detail.profile.role || '');
  setTimeout(boot, 60);
});
})();
