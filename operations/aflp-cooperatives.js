/* FIELD BUYING · Coopératives AFLP 2027
   ------------------------------------------------------------------------------
   Canal 2 de l'AFLP : Coopérative → Section/Village → Producteur (registre UNIQUE).
   Ce module n'a aucune donnée propre côté navigateur : il lit et écrit les tables
   aflp_cooperatives / aflp_coop_* et les RPC aflp_coop_* (Supabase, RLS + audit).
   Les producteurs restent dans public.producteurs ; les achats dans public.achats ;
   les livraisons consolidées rejoignent le Delivery Plan Procurement puis le WMS.

   Rendu :
     #cooperatives                    tableau de bord (KPI, filtres, cartes / tableau)
     #cooperatives/new                création
     #cooperatives/<id>/<onglet>      fiche (10 onglets)
     #cooperatives/<id>/edit          modification
     #cooperatives/<id>/import        import Excel des producteurs (assistant)
   Langue : FR/EN via localStorage « anagroci_lang » ; la zone est marquée
   data-i18n-ignore pour que le traducteur global ne retraduise pas nos libellés. */
(function (global) {
'use strict';

var CAMPAIGN = '2027';
var PHOTO = '../assets/operations/modules/field-buying-real-photo.webp';
var XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
var DOC_BUCKET = 'aflp-coop-docs';
var PAGE_SIZE = 50;

/* ------------------------------------------------------------------ langue */
function lang() { try { return localStorage.getItem('anagroci_lang') === 'en' ? 'en' : 'fr'; } catch (e) { return 'fr'; } }
function T(fr, en) { return lang() === 'en' ? (en == null ? fr : en) : fr; }
var LBL = {
  status: { PROSPECT: ['Prospect', 'Prospect'], EN_EVALUATION: ['En évaluation', 'Under review'], A_COMPLETER: ['À compléter', 'To complete'],
    APPROUVEE: ['Approuvée', 'Approved'], ACTIVE: ['Active', 'Active'], SUSPENDUE: ['Suspendue', 'Suspended'], SORTIE: ['Sortie du programme', 'Exited programme'] },
  compliance: { NON_EVALUE: ['Non évaluée', 'Not assessed'], CONFORME: ['Conforme', 'Compliant'], PARTIEL: ['Partiellement conforme', 'Partially compliant'], NON_CONFORME: ['Non conforme', 'Non-compliant'] },
  registry: { NON_FOURNI: ['Liste non fournie', 'List not provided'], PARTIEL: ['Liste partielle', 'Partial list'], COMPLET: ['Liste complète', 'Complete list'], VERIFIE: ['Liste vérifiée', 'Verified list'] },
  payment: { INDIVIDUAL_FARMER: ['Achat individuel au producteur membre', 'Individual purchase from member farmer'],
    COOPERATIVE_CONSOLIDATED: ['Livraison consolidée par la coopérative', 'Consolidated delivery by the cooperative'] },
  orgType: { SCOOPS: ['SCOOPS (société coopérative simplifiée)', 'SCOOPS (simplified cooperative)'], COOP_CA: ['COOP-CA (avec conseil d’administration)', 'COOP-CA (with board)'],
    UNION: ['Union de coopératives', 'Union of cooperatives'], FEDERATION: ['Fédération', 'Federation'], GIE: ['GIE', 'Economic interest group'], ASSOCIATION: ['Association / groupement', 'Association / group'], AUTRE: ['Autre', 'Other'] },
  memberStatus: { PENDING: ['En attente', 'Pending'], ACTIVE: ['Actif', 'Active'], SUSPENDED: ['Suspendu', 'Suspended'], ENDED: ['Sorti', 'Ended'] },
  verif: { LISTE_COOPERATIVE: ['Liste de la coopérative', 'Cooperative list'], CARTE_MEMBRE: ['Carte de membre', 'Membership card'],
    REGISTRE_COOPERATIVE: ['Registre de la coopérative', 'Cooperative register'], VISITE_TERRAIN: ['Visite terrain', 'Field visit'],
    APPEL_TELEPHONIQUE: ['Appel téléphonique', 'Phone call'], AUTRE: ['Autre', 'Other'] },
  source: { MANUEL: ['Saisie manuelle', 'Manual entry'], IMPORT_EXCEL: ['Import Excel', 'Excel import'], ASSOCIATION_EXISTANT: ['Producteur existant associé', 'Existing farmer linked'], TRANSFERT: ['Transfert depuis une autre coopérative', 'Transfer from another cooperative'] },
  contact: { PRESIDENT: ['Président', 'President'], VICE_PRESIDENT: ['Vice-président', 'Vice-president'], DIRECTEUR: ['Directeur / gérant', 'Director / manager'],
    SECRETAIRE: ['Secrétaire', 'Secretary'], TRESORIER: ['Trésorier', 'Treasurer'], RESP_COLLECTE: ['Responsable collecte', 'Collection manager'],
    RESP_QUALITE: ['Responsable qualité', 'Quality manager'], MAGASINIER: ['Magasinier', 'Storekeeper'], COMPTABLE: ['Comptable', 'Accountant'], AUTRE: ['Autre', 'Other'] },
  doc: { AGREMENT: ['Agrément', 'Approval'], RCCM: ['RCCM', 'Trade register (RCCM)'], STATUTS: ['Statuts', 'Articles of association'], REGLEMENT_INTERIEUR: ['Règlement intérieur', 'Internal rules'],
    LISTE_MEMBRES: ['Liste des membres', 'Member list'], RIB: ['RIB', 'Bank details (RIB)'], PIECE_PRESIDENT: ['Pièce du président', 'President ID'], CONTRAT_AFLP: ['Contrat AFLP', 'AFLP contract'],
    ACCORD_COMMERCIAL: ['Accord commercial', 'Commercial agreement'], PREFINANCEMENT: ['Préfinancement', 'Pre-financing'], ATTESTATION: ['Attestation', 'Certificate of good standing'],
    CERTIFICATION: ['Certification', 'Certification'], AUTRE: ['Autre', 'Other'] },
  delivery: { PLANIFIEE: ['Planifiée', 'Planned'], EN_ROUTE: ['En route', 'In transit'], RECUE: ['Reçue', 'Received'], ANNULEE: ['Annulée', 'Cancelled'] },
  alloc: { ALLOCATION_A_COMPLETER: ['Allocation à compléter', 'Allocation to complete'], ALLOUEE_PREVISION: ['Allouée (prévision)', 'Allocated (planned)'], TRACABLE: ['Traçable producteur', 'Farmer-traceable'], ANNULEE: ['Annulée', 'Cancelled'] },
  channel: { AFLP_DIRECT: ['Direct RT', 'Direct RT'], COOPERATIVE: ['Coopérative', 'Cooperative'], MIXTE: ['Mixte', 'Mixed'], NON_RENSEIGNE: ['Non renseigné', 'Not recorded'] },
  passport: { INCOMPLETE: ['Incomplet', 'Incomplete'], BASIC: ['Basique', 'Basic'], MAPPED: ['Cartographié', 'Mapped'], BASELINE: ['Baseline', 'Baseline'], VERIFIED: ['Vérifié', 'Verified'] },
  trace: { TRACABLE_PRODUCTEUR: ['Traçable producteur', 'Farmer-traceable'], ORGANISATION_SEULEMENT: ['Organisation seulement', 'Organisation only'], EN_ATTENTE_RECEPTION: ['En attente de réception', 'Awaiting reception'], ANNULEE: ['Annulée', 'Cancelled'] },
  consent: { NOT_RECORDED: ['Non recueilli', 'Not recorded'], GRANTED: ['Accordé', 'Granted'], PARTIAL: ['Partiel', 'Partial'], REFUSED: ['Refusé', 'Refused'], WITHDRAWN: ['Retiré', 'Withdrawn'] }
};
var REQUIRED_DOCS = ['AGREMENT', 'STATUTS', 'LISTE_MEMBRES', 'RIB', 'PIECE_PRESIDENT', 'CONTRAT_AFLP'];
function L(group, code) { var x = (LBL[group] || {})[code]; return x ? T(x[0], x[1]) : (code == null || code === '' ? '—' : String(code)); }
function opts(group, sel, withEmpty) {
  return (withEmpty ? '<option value="">' + esc(withEmpty) + '</option>' : '') + Object.keys(LBL[group]).map(function (k) {
    return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(L(group, k)) + '</option>';
  }).join('');
}

/* ------------------------------------------------------------------ utilitaires */
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
function has(v) { return v !== null && v !== undefined && v !== ''; }
function loc() { return lang() === 'en' ? 'en-GB' : 'fr-FR'; }
function num(v, d) { return new Intl.NumberFormat(loc(), { maximumFractionDigits: d == null ? 0 : d }).format(n(v)); }
function mt(kg, d) { return num(n(kg) / 1000, d == null ? 1 : d) + ' MT'; }
function mtv(v, d) { return has(v) ? num(v, d == null ? 1 : d) + ' MT' : na(); }
function pct(v) { return has(v) ? num(v, 1) + ' %' : '—'; }
function na() { return '<span class="coop-na">' + esc(T('NON COLLECTÉ', 'NOT RECORDED')) + '</span>'; }
function val(v) { return has(v) ? esc(v) : na(); }
function date(v) { if (!v) return '—'; try { return new Intl.DateTimeFormat(loc()).format(new Date(v)); } catch (e) { return esc(v); } }
function dtime(v) { if (!v) return '—'; try { return new Intl.DateTimeFormat(loc(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)); } catch (e) { return esc(v); } }
function norm(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
function digits(v) { return String(v == null ? '' : v).replace(/[^0-9]/g, ''); }
function phoneCI(v) { var d = digits(v); if (d.length === 12 && d.indexOf('225') === 0) d = d.slice(2); if (d.length === 9) d = '0' + d; return d; }
function maskPhone(v) { var d = digits(v); return d ? '••••••' + d.slice(-4) : '—'; }
function routeParts() { return (location.hash || '#').slice(1).split('/').map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } }); }
function go(h) { if (location.hash === h) render(routeParts()); else location.hash = h; }
function uuid() { return (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
function badge(text, tone) { return '<span class="badge ' + (tone || 'info') + '">' + esc(text) + '</span>'; }
function statusTone(s) { return { ACTIVE: 'ok', APPROUVEE: 'ok', PROSPECT: 'info', EN_EVALUATION: 'info', A_COMPLETER: 'warn', SUSPENDUE: 'danger', SORTIE: 'danger' }[s] || 'info'; }
function complianceTone(s) { return { CONFORME: 'ok', PARTIEL: 'warn', NON_CONFORME: 'danger' }[s] || 'info'; }
function stBadge(s) { return badge(L('status', s), statusTone(s)); }
function setRoot(html) { var r = root(); if (r) r.innerHTML = '<div data-i18n-ignore>' + html + '</div>'; }
function root() { return document.getElementById('opsRouteView'); }
function table(headers, rows, emptyMsg) {
  if (!rows.length) return '<div class="ops-empty">' + esc(emptyMsg || T('Aucune donnée pour ce périmètre.', 'No data for this scope.')) + '</div>';
  return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}
function kpi(label, value, sub, tone, href) {
  var inner = '<small>' + esc(label) + '</small><b>' + value + '</b><span>' + (sub || '') + '</span>';
  return href ? '<a class="kpi kpi-link ' + (tone || '') + '" href="' + esc(href) + '">' + inner + '</a>' : '<div class="kpi ' + (tone || '') + '">' + inner + '</div>';
}
function defGrid(pairs) {
  return '<div class="ops-def-grid">' + pairs.map(function (d) {
    return '<div><small>' + esc(d[0]) + '</small><b>' + (d[2] ? d[1] : (has(d[1]) ? esc(d[1]) : na())) + '</b></div>';
  }).join('') + '</div>';
}
function card(title, sub, body, actions) {
  return '<section class="card"><div class="card-head"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' +
    (actions ? '<div class="ops-route-actions">' + actions + '</div>' : '') + '</div>' + body + '</section>';
}
function skeleton() { return '<section class="kpi-grid">' + '<div class="kpi"><div class="skeleton"></div></div>'.repeat(4) + '</section><section class="card">' + '<div class="skeleton skeleton-row"></div>'.repeat(5) + '</section>'; }
function errBox(e) { return '<div class="notice danger"><b>' + esc(T('Problème', 'Problem')) + ' :</b>&nbsp;' + esc(e && e.message ? e.message : String(e)) + '</div>'; }
function msg(id, text, ok) { var e = document.getElementById(id); if (e) { e.className = ok ? 'ops-ok-text' : (ok === null ? 'muted' : 'ops-danger-text'); e.textContent = text; } }
function formData(form) {
  var o = {};
  [].slice.call(form.elements).forEach(function (el) {
    if (!el.name || el.disabled) return;
    if (el.type === 'checkbox') o[el.name] = el.checked; else o[el.name] = String(el.value || '').trim();
  });
  return o;
}
function loadScript(src) {
  return new Promise(function (resolve, reject) {
    if (src === XLSX_SRC && global.XLSX) return resolve();
    var s = document.createElement('script'); s.src = src; s.async = true; s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error(T('Bibliothèque Excel indisponible (réseau).', 'Excel library unavailable (network).'))); };
    document.head.appendChild(s);
  });
}

/* ------------------------------------------------------------------ client et rôle */
var sb = null, clientPromise = null, profile = null, profilePromise = null;
function client() {
  if (sb) return Promise.resolve(sb);
  if (clientPromise) return clientPromise;
  clientPromise = new Promise(function (resolve) {
    var k = 0, t = setInterval(function () {
      k++;
      if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) {
        clearInterval(t); sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON); resolve(sb);
      } else if (k > 150) { clearInterval(t); resolve(null); }
    }, 50);
  });
  return clientPromise;
}
function getProfile() {
  if (profilePromise) return profilePromise;
  profilePromise = client().then(function (c) {
    if (!c) return {};
    return c.auth.getSession().then(function (s) {
      var u = s.data && s.data.session && s.data.session.user;
      if (!u) return {};
      return c.from('profils').select('nom,role,actif,cluster,zone').eq('user_id', u.id).maybeSingle().then(function (r) {
        profile = (r && r.data) || {}; return profile;
      });
    });
  }).catch(function () { profile = {}; return profile; });
  return profilePromise;
}
/* Miroirs client des règles serveur (private.aflp_coop_roles_*) — la base reste l'arbitre. */
var EDITORS = ['Branch Manager', 'Assistant Branch Manager', 'Head of Field', 'Procurement Officer', 'Zonal Head', 'Field Buying Operations Officer', 'Unit Head', 'Assistant Unit Head', 'Supervisor', 'Administrateur'];
var DIRECTION = ['Branch Manager', 'Assistant Branch Manager', 'Head of Field', 'Administrateur'];
function role() { return (profile && profile.role) || (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile && global.ANAGROCI_AUTH.profile.role) || ''; }
function canEdit() { return EDITORS.indexOf(role()) >= 0; }
function isDirection() { return DIRECTION.indexOf(role()) >= 0; }

function q(tableName, cols, mod) {
  return client().then(function (c) {
    if (!c) throw new Error(T('Connexion aux données indisponible.', 'Data connection unavailable.'));
    var r = c.from(tableName).select(cols || '*'); if (mod) r = mod(r);
    return r.then(function (x) { if (x.error) throw new Error(x.error.message); return x.data || []; });
  });
}
function rpc(name, args) {
  return client().then(function (c) {
    if (!c) throw new Error(T('Connexion aux données indisponible.', 'Data connection unavailable.'));
    return c.rpc(name, args || {}).then(function (x) { if (x.error) throw new Error(x.error.message); return x.data; });
  });
}

/* Cache court : les référentiels se partagent entre rubriques. */
var cache = Object.create(null);
function cached(key, ttl, loader) {
  var s = cache[key], now = Date.now();
  if (s && s.data !== undefined && now - s.at < ttl) return Promise.resolve(s.data);
  if (s && s.p) return s.p;
  var p = loader().then(function (d) { cache[key] = { data: d, at: Date.now() }; return d; }, function (e) { delete cache[key]; throw e; });
  cache[key] = { p: p, at: now }; return p;
}
function invalidate() { [].slice.call(arguments).forEach(function (k) { Object.keys(cache).forEach(function (x) { if (x === k || x.indexOf(k + ':') === 0) delete cache[x]; }); }); }
function refs() {
  return cached('refs', 300000, function () {
    return Promise.all([
      q('aflp_clusters', 'code,label,zone_code,active'), q('aflp_zones', 'code,label,active'),
      q('villages_light_v', 'id,village,departement,cluster,cluster_code,gps_lat,gps_lng,deleted', function (r) { return r.limit(2000); }),
      q('rt_light_v', 'id,id_rt,nom,village_id,cluster,deleted', function (r) { return r.limit(2000); }),
      q('wms_warehouses', 'id,code,name,status,is_factory').catch(function () { return []; })
    ]).then(function (rs) {
      var villages = rs[2].filter(function (v) { return !v.deleted; }).sort(function (a, b) { return String(a.village).localeCompare(String(b.village)); });
      var vm = {}, vByName = {}; villages.forEach(function (v) { vm[v.id] = v; (vByName[norm(v.village)] = vByName[norm(v.village)] || []).push(v); });
      var rts = rs[3].filter(function (r) { return !r.deleted; }), rm = {}; rts.forEach(function (r) { rm[r.id] = r; });
      return { clusters: rs[0].filter(function (c) { return c.active !== false; }), zones: rs[1].filter(function (z) { return z.active !== false; }),
        villages: villages, vm: vm, vByName: vByName, rts: rts, rm: rm, warehouses: rs[4].filter(function (w) { return w.status === 'ACTIVE'; }) };
    });
  });
}
function dashboard(campaign) {
  return cached('dash:' + campaign, 30000, function () {
    return Promise.all([rpc('aflp_coop_dashboard', { p_campaign: campaign }),
      /* Président : contact de la coopérative (jamais un RT) ; illisible pour Warehouse/Factory par RLS. */
      q('aflp_coop_contacts', 'cooperative_id,full_name,phone', function (r) { return r.eq('role', 'PRESIDENT').eq('active', true); }).catch(function () { return []; })
    ]).then(function (rs) {
      var pm = {}; rs[1].forEach(function (x) { pm[x.cooperative_id] = x; });
      return (rs[0] || []).map(function (r) { var p = pm[r.cooperative_id] || {}; r.president_name = p.full_name || null; r.president_phone = p.phone || null; return r; });
    });
  });
}

/* ================================================================ TABLEAU DE BORD */
var F = { campaign: CAMPAIGN, zone: '', cluster: '', departement: '', sp: '', status: '', coop: '', perf: '', compliance: '', q: '', qa: false };
var VIEW = (function () { try { return localStorage.getItem('aflp_coop_view') || 'cards'; } catch (e) { return 'cards'; } })();
function setView(v) { VIEW = v; try { localStorage.setItem('aflp_coop_view', v); } catch (e) {} renderDashboard(); }

function perfBand(r) {
  if (!has(r.target_mt) || n(r.target_mt) === 0) return 'NO_TARGET';
  var p = n(r.achievement_pct); return p >= 80 ? 'HIGH' : p >= 50 ? 'MID' : 'LOW';
}
function applyFilters(rows) {
  var qq = norm(F.q);
  return rows.filter(function (r) {
    if (!F.qa && (r.is_qa || r.archived)) return false;
    if (F.zone && r.zone_code !== F.zone) return false;
    if (F.cluster && r.cluster_code !== F.cluster) return false;
    if (F.departement && norm(r.departement) !== norm(F.departement)) return false;
    if (F.sp && norm(r.sous_prefecture) !== norm(F.sp)) return false;
    if (F.status && r.aflp_status !== F.status) return false;
    if (F.coop && r.cooperative_id !== F.coop) return false;
    if (F.compliance && r.compliance_status !== F.compliance) return false;
    if (F.perf && perfBand(r) !== F.perf) return false;
    if (qq && norm([r.code, r.name, r.acronym, r.locality, r.president_name, r.president_phone].join(' ')).indexOf(qq) < 0
        && digits(r.president_phone).indexOf(digits(F.q) || '#') < 0) return false;
    return true;
  });
}
function totals(rows) {
  var t = { n: rows.length, active: 0, producers: 0, verified: 0, potDecl: 0, potFarm: 0, target: 0, bought: 0, potDeclKnown: 0 };
  rows.forEach(function (r) {
    if (r.aflp_status === 'ACTIVE') t.active++;
    /* Affiliation principale uniquement : un producteur membre de 2 coopératives n'est compté qu'une fois. */
    t.producers += n(r.producers_primary); t.verified += n(r.producers_verified);
    if (has(r.declared_potential_mt)) { t.potDecl += n(r.declared_potential_mt); t.potDeclKnown++; }
    t.potFarm += n(r.farmer_potential_kg); t.target += n(r.target_mt); t.bought += n(r.purchased_kg);
  });
  return t;
}
function filterBar(rows, c) {
  var all = rows.filter(function (r) { return F.qa || (!r.is_qa && !r.archived); });
  function uniq(key) { var s = {}; all.forEach(function (r) { if (r[key]) s[r[key]] = 1; }); return Object.keys(s).sort(); }
  function sel(name, label, options, cur) {
    return '<label>' + esc(label) + '<select data-f="' + name + '"><option value="">' + esc(T('Tous', 'All')) + '</option>' +
      options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  }
  return '<section class="card"><div class="coop-filters">' +
    sel('campaign', T('Campagne', 'Campaign'), [['2027', '2027'], ['2028', '2028'], ['2026', '2026']], F.campaign).replace('<option value="">' + esc(T('Tous', 'All')) + '</option>', '') +
    sel('zone', T('Zone', 'Zone'), c.zones.map(function (z) { return [z.code, z.label || z.code]; }), F.zone) +
    sel('cluster', T('Cluster', 'Cluster'), c.clusters.filter(function (k) { return !F.zone || k.zone_code === F.zone; }).map(function (k) { return [k.code, k.label]; }), F.cluster) +
    sel('departement', T('Département', 'Department'), uniq('departement').map(function (x) { return [x, x]; }), F.departement) +
    sel('sp', T('Sous-préfecture', 'Sub-prefecture'), uniq('sous_prefecture').map(function (x) { return [x, x]; }), F.sp) +
    sel('status', T('Statut', 'Status'), Object.keys(LBL.status).map(function (k) { return [k, L('status', k)]; }), F.status) +
    sel('coop', T('Coopérative', 'Cooperative'), all.map(function (r) { return [r.cooperative_id, r.code + ' · ' + r.name]; }), F.coop) +
    sel('perf', T('Performance', 'Performance'), [['HIGH', T('≥ 80 % de la target', '≥ 80% of target')], ['MID', '50 – 80 %'], ['LOW', T('< 50 %', '< 50%')], ['NO_TARGET', T('Sans target', 'No target')]], F.perf) +
    sel('compliance', T('Conformité', 'Compliance'), Object.keys(LBL.compliance).map(function (k) { return [k, L('compliance', k)]; }), F.compliance) +
    '<label class="coop-search">' + esc(T('Recherche', 'Search')) + '<input type="search" data-f="q" value="' + esc(F.q) + '" placeholder="' +
      esc(T('Nom, code, président, téléphone, localité…', 'Name, code, president, phone, locality…')) + '"></label>' +
    '</div></section>';
}
function coopCard(r) {
  var p = Math.min(100, n(r.achievement_pct));
  return '<article class="coop-card"><div class="coop-card-top"><div style="min-width:0"><div class="coop-code">' + esc(r.code) + (r.acronym ? ' · ' + esc(r.acronym) : '') + '</div>' +
    '<h3>' + esc(r.name) + '</h3><div class="coop-loc">' + esc([r.locality, r.sous_prefecture, r.cluster_code].filter(Boolean).join(' · ') || '—') + '</div></div>' +
    stBadge(r.aflp_status) + '</div>' +
    '<div class="coop-metrics">' +
      '<span>' + esc(T('Producteurs', 'Farmers')) + '</span><b>' + num(r.producers_registered) + (has(r.declared_members) ? ' / ' + num(r.declared_members) + ' ' + esc(T('décl.', 'decl.')) : '') + '</b>' +
      '<span>' + esc(T('Villages', 'Villages')) + '</span><b>' + num(r.villages_covered) + '</b>' +
      '<span>' + esc(T('Potentiel déclaré', 'Declared potential')) + '</span><b>' + mtv(r.declared_potential_mt) + '</b>' +
      '<span>' + esc(T('Potentiel producteurs', 'Farmer potential')) + '</span><b>' + (n(r.farmer_potential_kg) ? mt(r.farmer_potential_kg) : na()) + '</b>' +
      '<span>' + esc(T('Target AFLP', 'AFLP target')) + '</span><b>' + (has(r.target_mt) ? mtv(r.target_mt) : esc(T('non fixée', 'not set'))) + '</b>' +
      '<span>' + esc(T('Acheté', 'Purchased')) + '</span><b>' + mt(r.purchased_kg) + '</b>' +
    '</div>' +
    '<div><div class="coop-progress-row"><span>' + esc(T('Progression', 'Progress')) + '</span><b>' + (has(r.achievement_pct) ? pct(r.achievement_pct) : esc(T('sans target', 'no target'))) + '</b></div>' +
    '<div class="coop-progress"><i style="width:' + p + '%"></i></div></div>' +
    '<div class="coop-card-foot">' + badge(L('compliance', r.compliance_status), complianceTone(r.compliance_status)) +
    (r.is_qa ? badge('QA', 'warn') : '') + (r.archived ? badge(T('Archivée', 'Archived'), 'danger') : '') +
    (canEdit() && !r.archived ? '<a class="btn secondary" href="#cooperatives/' + encodeURIComponent(r.cooperative_id) + '/edit">✎ ' + esc(T('Modifier', 'Edit')) + '</a>' : '') +
    '<a class="btn secondary" href="#cooperatives/' + encodeURIComponent(r.cooperative_id) + '/overview">' + esc(T('Ouvrir', 'Open')) + ' →</a></div></article>';
}
function coopRow(r) {
  return '<tr class="ops-click" onclick="location.hash=\'#cooperatives/' + encodeURIComponent(r.cooperative_id) + '/overview\'">' +
    '<td class="mono">' + esc(r.code) + '</td><td><b>' + esc(r.name) + '</b>' + (r.is_qa ? ' ' + badge('QA', 'warn') : '') + '</td><td>' + esc(r.locality || '—') + '</td>' +
    '<td>' + stBadge(r.aflp_status) + '</td><td>' + num(r.producers_registered) + '</td><td>' + num(r.producers_verified) + '</td><td>' + num(r.villages_covered) + '</td>' +
    '<td>' + mtv(r.declared_potential_mt) + '</td><td>' + (n(r.farmer_potential_kg) ? mt(r.farmer_potential_kg) : na()) + '</td><td>' + (has(r.target_mt) ? mtv(r.target_mt) : esc(T('non fixée', 'not set'))) + '</td>' +
    '<td>' + mt(r.purchased_kg) + '</td><td>' + pct(r.achievement_pct) + '</td><td>' + badge(L('compliance', r.compliance_status), complianceTone(r.compliance_status)) + '</td>' +
    '<td>' + (canEdit() && !r.archived ? '<a class="btn secondary" onclick="event.stopPropagation()" href="#cooperatives/' + encodeURIComponent(r.cooperative_id) + '/edit">✎ ' + esc(T('Modifier', 'Edit')) + '</a>' : '') + '</td></tr>';
}
function bannerHtml(actions) {
  return '<div class="coop-banner"><img src="' + PHOTO + '" alt="' + esc(T('Productrice de cajou portant un sac en jute dans un verger d’anacardiers', 'Cashew farmer carrying a jute bag in a cashew orchard')) + '" loading="lazy" decoding="async">' +
    '<div class="coop-banner-in"><small>FIELD BUYING · ' + esc(T('Canal coopératives', 'Cooperative channel')) + '</small><h1>' + esc(T('COOPÉRATIVES AFLP', 'AFLP COOPERATIVES')) + '</h1>' +
    '<p>' + esc(T('Gérer les organisations partenaires, leurs producteurs, leur potentiel et leur performance AFLP.',
      'Manage partner organisations, their member farmers, their potential and their AFLP performance.')) + '</p>' +
    '<div class="coop-banner-actions">' + (actions || '') + '</div></div></div>';
}
function renderDashboard() {
  setRoot(bannerHtml('') + skeleton());
  return Promise.all([dashboard(F.campaign), refs(), getProfile()]).then(function (rs) {
    var rows = rs[0] || [], c = rs[1];
    var shown = applyFilters(rows), t = totals(shown);
    var actions = (canEdit() ? '<a class="btn primary" href="#cooperatives/new">+ ' + esc(T('Nouvelle coopérative', 'New cooperative')) + '</a>' : '') +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.exportList()">' + esc(T('Exporter Excel', 'Export to Excel')) + '</button>' +
      '<a class="btn secondary" href="procurement.html#arrivals">' + esc(T('Delivery Plan', 'Delivery Plan')) + '</a>';
    var rate = t.target > 0 ? (t.bought / 1000) / t.target * 100 : null;
    setRoot(bannerHtml(actions) +
      '<section class="kpi-grid">' +
        kpi(T('Coopératives recensées', 'Cooperatives registered'), num(t.n), T('hors QA et archivées', 'excluding QA and archived')) +
        kpi(T('Coopératives actives', 'Active cooperatives'), num(t.active), T('statut ACTIVE', 'ACTIVE status')) +
        kpi(T('Producteurs affiliés', 'Affiliated farmers'), num(t.producers), T('affiliation principale, sans double comptage', 'primary affiliation, no double count')) +
        kpi(T('Producteurs vérifiés', 'Verified farmers'), num(t.verified), T('affiliation vérifiée', 'verified membership')) +
      '</section><section class="kpi-grid">' +
        kpi(T('Potentiel estimé', 'Estimated potential'), t.potDeclKnown ? num(t.potDecl, 0) + ' MT' : na(), T('déclaré · producteurs : ', 'declared · farmers: ') + mt(t.potFarm, 0)) +
        kpi(T('Target AFLP', 'AFLP target'), num(t.target, 0) + ' MT', T('campagne ', 'campaign ') + esc(F.campaign)) +
        kpi(T('Volume acheté', 'Volume purchased'), mt(t.bought), T('achats membres + livraisons reçues', 'member purchases + received deliveries')) +
        kpi(T('Taux de réalisation', 'Achievement rate'), rate == null ? '—' : num(rate, 1) + ' %', T('acheté / target', 'purchased / target'), rate != null && rate < 50 ? 'warn' : '') +
      '</section>' + filterBar(rows, c) +
      '<div class="coop-toolbar"><span class="muted">' + esc(num(shown.length) + ' ' + T('coopérative(s) affichée(s)', 'cooperative(s) shown')) + '</span>' +
      '<span style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="muted" style="font-size:11px;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-f="qa"' + (F.qa ? ' checked' : '') + '> ' + esc(T('Afficher QA et archivées', 'Show QA and archived')) + '</label>' +
      '<span class="coop-seg"><button type="button" class="' + (VIEW === 'cards' ? 'on' : '') + '" onclick="ANAGROCI_COOP.view(\'cards\')">' + esc(T('Cartes', 'Cards')) + '</button>' +
      '<button type="button" class="' + (VIEW === 'table' ? 'on' : '') + '" onclick="ANAGROCI_COOP.view(\'table\')">' + esc(T('Tableau', 'Table')) + '</button></span></span></div>' +
      (shown.length ? (VIEW === 'table'
        ? '<section class="card">' + table([T('Code', 'Code'), T('Coopérative', 'Cooperative'), T('Localité', 'Locality'), T('Statut', 'Status'), T('Producteurs', 'Farmers'), T('Vérifiés', 'Verified'),
            T('Villages', 'Villages'), T('Potentiel déclaré', 'Declared potential'), T('Potentiel producteurs', 'Farmer potential'), T('Target', 'Target'), T('Acheté', 'Purchased'), T('Réalisation', 'Achievement'), T('Conformité', 'Compliance'), ''], shown.map(coopRow)) + '</section>'
        : '<div class="coop-grid">' + shown.map(coopCard).join('') + '</div>')
        : '<section class="card"><div class="ops-empty">' + esc(rows.length ? T('Aucune coopérative ne correspond aux filtres.', 'No cooperative matches the filters.')
          : T('Aucune coopérative enregistrée pour le moment. Une coopérative peut être créée avant que la liste de ses producteurs soit disponible.',
              'No cooperative registered yet. A cooperative can be created before its farmer list is available.')) + '</div></section>'));
    bindFilters();
  }).catch(function (e) { setRoot(bannerHtml('') + errBox(e)); });
}
function bindFilters() {
  var r = root(); if (!r) return;
  r.querySelectorAll('[data-f]').forEach(function (el) {
    var ev = el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change';
    var t = null;
    el.addEventListener(ev, function () {
      var k = el.getAttribute('data-f'); F[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'zone') F.cluster = '';
      clearTimeout(t);
      if (k === 'q') { t = setTimeout(function () { var pos = el.selectionStart; renderDashboard().then(function () { var x = root().querySelector('[data-f="q"]'); if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch (e) {} } }); }, 250); }
      else renderDashboard();
    });
  });
}

/* ================================================== Field Buying : vue d'ensemble et Passport */
function fillOverview() {
  if (!document.getElementById('fbChannelKpis') && !document.getElementById('fbCoopEntry')) return;
  /* Les éléments sont relus AU MOMENT d'écrire : la vue d'ensemble peut être repeinte
     entre l'appel et la réponse réseau (rendu initial puis rechargement du profil). */
  Promise.all([rpc('aflp_channel_totals', { p_campaign: CAMPAIGN, p_include_qa: false }), dashboard(CAMPAIGN)]).then(function (rs) {
    var t = rs[0] || {}, rows = (rs[1] || []).filter(function (r) { return !r.is_qa && !r.archived; }), s = totals(rows);
    var k = document.getElementById('fbChannelKpis'), e = document.getElementById('fbCoopEntry');
    if (k) k.innerHTML = '<div data-i18n-ignore><section class="kpi-grid">' +
      kpi(T('Producteurs AFLP 2027', 'AFLP 2027 farmers'), num(t.producteurs_total), T('total unique (registre)', 'unique total (registry)')) +
      kpi(T('Canal Direct RT', 'Direct RT channel'), num(t.direct_rt), T('Village → RT → Producteur', 'Village → RT → Farmer')) +
      kpi(T('Canal Coopératives', 'Cooperative channel'), num(t.cooperatives), num(t.cooperatives_avec_rt_suivi) + ' ' + T('avec RT de suivi', 'with follow-up RT'), '', '#cooperatives') +
      kpi(T('Coopératives actives', 'Active cooperatives'), num(s.active) + ' / ' + num(s.n), T('acheté : ', 'purchased: ') + mt(s.bought), '', '#cooperatives') +
      '</section></div>';
    if (e) e.innerHTML = '<div data-i18n-ignore>' + entryCard(s) + '</div>';
  }).catch(function () {
    var e = document.getElementById('fbCoopEntry'); if (e) e.innerHTML = '<div data-i18n-ignore>' + entryCard(null) + '</div>';
  });
}
function entryCard(s) {
  return '<a class="coop-hero" href="#cooperatives"><div class="coop-hero-media"><img src="' + PHOTO + '" alt="' +
    esc(T('Productrice de cajou dans un verger d’anacardiers, sac de jute sur le dos', 'Cashew farmer in a cashew orchard carrying a jute bag')) + '" loading="lazy" decoding="async"></div>' +
    '<div class="coop-hero-body"><small>FIELD BUYING · ' + esc(T('Canal 2', 'Channel 2')) + '</small><h2>' + esc(T('COOPÉRATIVES AFLP', 'AFLP COOPERATIVES')) + '</h2>' +
    '<p>' + esc(T('Organisations partenaires, producteurs membres, potentiel, achats, livraisons et performance.',
      'Partner organisations, member farmers, potential, purchases, deliveries and performance.')) + '</p>' +
    (s ? '<div class="coop-hero-stats"><div><b>' + num(s.n) + '</b><span>' + esc(T('coopératives', 'cooperatives')) + '</span></div><div><b>' + num(s.producers) +
      '</b><span>' + esc(T('producteurs', 'farmers')) + '</span></div><div><b>' + num(s.target, 0) + ' MT</b><span>target</span></div></div>' : '') +
    '<span class="coop-hero-cta">' + esc(T('Gérer les coopératives', 'Manage cooperatives')) + ' →</span></div></a>';
}
function fillChannel(pid) {
  var box = document.getElementById('fbCoopChannel'); if (!box) return;
  Promise.all([
    q('aflp_producer_channel_v', '*', function (r) { return r.eq('producer_id', pid).limit(1); }),
    q('aflp_coop_memberships', 'id,campaign,status,is_primary,member_number,membership_start,membership_end,verified,source,cooperative_id,aflp_cooperatives(code,name)', function (r) { return r.eq('producer_id', pid).order('membership_start', { ascending: false }); }),
    refs(),
    q('aflp_producer_quality_v', 'completeness_pct,missing_fields', function (r) { return r.eq('producer_id', pid).limit(1); }).catch(function () { return []; })
  ]).then(function (rs) {
    var qual = rs[3][0];
    box = document.getElementById('fbCoopChannel') || box;
    var ch = rs[0][0] || {}, hist = rs[1] || [], c = rs[2], coop = ch.sourcing_channel === 'COOPERATIVE';
    var rt = c.rm[ch.followup_rt_id];
    box.innerHTML = '<div data-i18n-ignore><div class="card-head"><div><h2>' + esc(T('Canal AFLP ', 'AFLP channel ') + CAMPAIGN) + '</h2><p>' +
      esc(T('Le canal découle de l’affiliation principale ouverte ; la source d’enrôlement reste figée.', 'The channel derives from the open primary affiliation; the enrolment source stays fixed.')) + '</p></div></div>' +
      '<div class="coop-channel"><div class="coop-channel-badge ' + (coop ? '' : 'direct') + '"><small>' + esc(T('CANAL', 'CHANNEL')) + '</small>' +
      esc(coop ? T('COOPÉRATIVE', 'COOPERATIVE') : T('DIRECT RT', 'DIRECT RT')) + '</div>' +
      defGrid([[T('Coopérative principale', 'Primary cooperative'), coop ? '<a class="ops-link" href="#cooperatives/' + encodeURIComponent(ch.primary_cooperative_id) + '/producers">' + esc(ch.primary_cooperative_code + ' · ' + ch.primary_cooperative_name) + '</a>' : '—', true],
        [T('Member ID', 'Member ID'), coop ? ch.member_number : '—'], [T('Section', 'Section'), coop ? ch.section_name : '—'],
        [T('RT de suivi', 'Follow-up RT'), rt ? (rt.id_rt || rt.id) + ' · ' + rt.nom : (ch.followup_rt_id || T('aucun', 'none'))],
        [T('Source d’enrôlement', 'Enrolment source'), L('channel', ch.enrollment_channel)],
        [T('Affiliations (historique)', 'Affiliations (history)'), String(hist.length)],
        [T('Complétude du dossier', 'File completeness'), qual ? badge(num(qual.completeness_pct) + ' %', n(qual.completeness_pct) === 100 ? 'ok' : n(qual.completeness_pct) < 50 ? 'danger' : 'warn') +
          ((qual.missing_fields || []).length ? ' <small class="muted">' + esc(T('manque : ', 'missing: ') + qual.missing_fields.map(missingLabel).join(', ')) + '</small>' : '') : '—', true]]) + '</div>' +
      (hist.length ? '<div style="margin-top:12px">' + table([T('Campagne', 'Campaign'), T('Coopérative', 'Cooperative'), T('Statut', 'Status'), T('Principale', 'Primary'), T('Member ID', 'Member ID'), T('Début', 'Start'), T('Fin', 'End'), T('Vérifiée', 'Verified')],
        hist.map(function (m) {
          var co = m.aflp_cooperatives || {};
          return '<tr><td>' + esc(m.campaign) + '</td><td>' + esc((co.code || '') + ' · ' + (co.name || '')) + '</td><td>' + badge(L('memberStatus', m.status), m.status === 'ACTIVE' ? 'ok' : m.status === 'ENDED' ? 'info' : 'warn') + '</td>' +
            '<td>' + (m.is_primary ? '✓' : '—') + '</td><td class="mono">' + esc(m.member_number || '—') + '</td><td>' + date(m.membership_start) + '</td><td>' + date(m.membership_end) + '</td><td>' + (m.verified ? '✓' : '—') + '</td></tr>';
        })) + '</div>' : '') + '</div>';
  }).catch(function (e) { box.innerHTML = '<div data-i18n-ignore>' + errBox(e) + '</div>'; });
}

/* ======================================================= CRÉATION / MODIFICATION */
function field(label, name, value, attrs, cls) {
  return '<label class="' + (cls || '') + '">' + esc(label) + '<input name="' + name + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '></label>';
}
function selectField(label, name, optionsHtml, cls) { return '<label class="' + (cls || '') + '">' + esc(label) + '<select name="' + name + '">' + optionsHtml + '</select></label>'; }
function renderForm(id) {
  setRoot(skeleton());
  return Promise.all([refs(), getProfile(), id ? bundle(id) : Promise.resolve(null)]).then(function (rs) {
    var c = rs[0], b = rs[2], co = b ? b.coop : {}, cc = b ? (b.campaign || {}) : {}, pres = b ? (b.contacts.filter(function (x) { return x.role === 'PRESIDENT' && x.active; })[0] || {}) : {};
    if (!canEdit()) { setRoot(errBox(T('Votre rôle ne permet pas de créer ou modifier une coopérative.', 'Your role cannot create or edit a cooperative.'))); return; }
    var title = id ? T('Modifier la coopérative', 'Edit cooperative') + ' — ' + co.code : T('Nouvelle coopérative', 'New cooperative');
    var clusterOpts = '<option value="">' + esc(T('— Non rattachée —', '— Not assigned —')) + '</option>' + c.clusters.map(function (k) { return '<option value="' + k.code + '"' + (k.code === co.cluster_code ? ' selected' : '') + '>' + esc(k.label + ' · ' + k.zone_code) + '</option>'; }).join('');
    var villageOpts = '<option value="">—</option>' + c.villages.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === co.locality_village_id ? ' selected' : '') + '>' + esc(v.village + ' · ' + (v.cluster || '')) + '</option>'; }).join('');
    var whOpts = '<option value="">—</option>' + c.warehouses.map(function (w) { return '<option value="' + w.id + '"' + (w.id === cc.destination_warehouse_id ? ' selected' : '') + '>' + esc(w.code + ' · ' + (w.name || '')) + '</option>'; }).join('');
    var rtOpts = '<option value="">—</option>' + c.rts.map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === cc.referent_rt_id ? ' selected' : '') + '>' + esc((r.id_rt || r.id) + ' · ' + r.nom) + '</option>'; }).join('');
    setRoot('<div class="ops-route-head"><div><h1>' + esc(title) + '</h1><p>' + esc(T('Une coopérative est une organisation partenaire : ses responsables ne deviennent jamais des RT et ses producteurs rejoignent le registre unique.',
      'A cooperative is a partner organisation: its officers never become RTs and its farmers join the single registry.')) + '</p></div><div class="ops-route-actions"><a class="btn secondary" href="' +
      (id ? '#cooperatives/' + encodeURIComponent(id) + '/overview' : '#cooperatives') + '">← ' + esc(T('Retour', 'Back')) + '</a></div></div>' +
      '<section class="card"><form id="coopForm" class="coop-form" novalidate>' +
      '<h3>' + esc(T('Identité', 'Identity')) + '</h3>' +
      field(T('Nom officiel *', 'Official name *'), 'name', co.name, 'required maxlength="160"', 'span-2') +
      field(T('Sigle', 'Acronym'), 'acronym', co.acronym, 'maxlength="30"') +
      field(T('Dénomination légale', 'Legal name'), 'legal_name', co.legal_name, 'maxlength="200"', 'span-2') +
      selectField(T('Type d’organisation', 'Organisation type'), 'org_type', opts('orgType', co.org_type || 'SCOOPS')) +
      field(T('N° d’immatriculation', 'Registration no.'), 'registration_no', co.registration_no) +
      field(T('N° d’agrément', 'Approval no.'), 'approval_no', co.approval_no) +
      field('RCCM', 'rccm', co.rccm) +
      field(T('Date de création', 'Creation date'), 'creation_date', co.creation_date, 'type="date"') +
      field(T('Date d’intégration AFLP', 'AFLP joining date'), 'aflp_join_date', co.aflp_join_date, 'type="date"') +
      field(T('Membres déclarés', 'Declared members'), 'declared_members', co.declared_members, 'type="number" min="0" step="1"') +
      '<h3>' + esc(T('Localisation', 'Location')) + '</h3>' +
      field(T('Siège', 'Head office'), 'head_office', co.head_office) +
      field(T('Adresse', 'Address'), 'address', co.address, '', 'span-2') +
      field(T('Région', 'Region'), 'region', co.region || 'GBEKE') +
      field(T('Département', 'Department'), 'departement', co.departement) +
      field(T('Sous-préfecture', 'Sub-prefecture'), 'sous_prefecture', co.sous_prefecture) +
      field(T('Localité', 'Locality'), 'locality', co.locality) +
      selectField(T('Village du siège (référentiel AFLP)', 'Head-office village (AFLP registry)'), 'locality_village_id', villageOpts) +
      selectField(T('Cluster AFLP', 'AFLP cluster'), 'cluster_code', clusterOpts) +
      field(T('Latitude GPS', 'GPS latitude'), 'gps_lat', co.gps_lat, 'type="number" step="0.000001" min="-90" max="90"') +
      field(T('Longitude GPS', 'GPS longitude'), 'gps_lng', co.gps_lng, 'type="number" step="0.000001" min="-180" max="180"') +
      '<label>&nbsp;<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.gps(\'coopForm\')">' + esc(T('Capter ma position', 'Use my position')) + '</button></label>' +
      '<h3>' + esc(T('Organisation et contacts', 'Organisation and contacts')) + '</h3>' +
      field(T('Président (nom)', 'President (name)'), 'president_name', pres.full_name, 'maxlength="120"') +
      field(T('Téléphone du président', 'President phone'), 'president_phone', pres.phone, 'inputmode="tel" placeholder="07XXXXXXXX"') +
      field(T('Téléphone coopérative', 'Cooperative phone'), 'phone', co.phone, 'inputmode="tel" placeholder="07XXXXXXXX"') +
      field('Email', 'email', co.email, 'type="email"') +
      '<h3>' + esc(T('Programme AFLP · campagne ', 'AFLP programme · campaign ') + CAMPAIGN) + '</h3>' +
      selectField(T('Modèle de paiement', 'Payment model'), 'payment_model', opts('payment', cc.payment_model || 'INDIVIDUAL_FARMER'), 'span-2') +
      selectField(T('Conformité', 'Compliance'), 'compliance_status', opts('compliance', co.compliance_status || 'NON_EVALUE')) +
      selectField(T('Liste des producteurs', 'Farmer list'), 'producer_registry_status', opts('registry', co.producer_registry_status || 'NON_FOURNI')) +
      field(T('Potentiel déclaré (MT)', 'Declared potential (MT)'), 'declared_potential_mt', cc.declared_potential_mt, 'type="number" min="0" step="0.1"') +
      field(T('Volume sécurisé (MT)', 'Secured volume (MT)'), 'secured_volume_mt', cc.secured_volume_mt, 'type="number" min="0" step="0.1"') +
      field(T('Target AFLP (MT)', 'AFLP target (MT)'), 'target_mt', cc.target_mt, 'type="number" min="0" step="0.1"' + (isDirection() ? '' : ' disabled title="' + esc(T('Fixée par la direction', 'Set by management')) + '"')) +
      field(T('Chef de Zone référent', 'Referent Zone Head'), 'zone_head_name', cc.zone_head_name) +
      field(T('Chef d’Unité référent', 'Referent Unit Head'), 'unit_head_name', cc.unit_head_name) +
      selectField(T('RT AFLP de suivi', 'AFLP follow-up RT'), 'referent_rt_id', rtOpts) +
      selectField(T('Entrepôt de destination', 'Destination warehouse'), 'destination_warehouse_id', whOpts) +
      (id ? '' : selectField(T('Statut initial', 'Initial status'), 'aflp_status', ['PROSPECT', 'EN_EVALUATION', 'A_COMPLETER'].concat(isDirection() ? ['APPROUVEE', 'ACTIVE'] : []).map(function (k) { return '<option value="' + k + '">' + esc(L('status', k)) + '</option>'; }).join(''))) +
      '<label class="span-3">' + esc(T('Notes', 'Notes')) + '<textarea name="notes" rows="2" maxlength="1000">' + esc(co.notes || '') + '</textarea></label>' +
      '</form><div class="coop-form-actions"><button class="btn primary" type="button" id="coopSave">' + esc(id ? T('Enregistrer les modifications', 'Save changes') : T('Créer la coopérative', 'Create cooperative')) + '</button>' +
      '<span id="coopMsg" class="muted">' + esc(T('Les données non collectées restent vides : elles seront affichées « NON COLLECTÉ ».', 'Uncollected data stays empty and is shown as “NOT RECORDED”.')) + '</span></div></section>');
    document.getElementById('coopSave').addEventListener('click', function () {
      var f = document.getElementById('coopForm'), d = formData(f), btn = this;
      if (!d.name) return msg('coopMsg', T('Le nom officiel est obligatoire.', 'Official name is required.'), false);
      ['phone', 'president_phone'].forEach(function (k) { if (d[k]) d[k] = phoneCI(d[k]); });
      if (d.phone && !/^0\d{9}$/.test(d.phone)) return msg('coopMsg', T('Téléphone coopérative : 10 chiffres.', 'Cooperative phone: 10 digits.'), false);
      if (d.president_phone && !/^0\d{9}$/.test(d.president_phone)) return msg('coopMsg', T('Téléphone du président : 10 chiffres.', 'President phone: 10 digits.'), false);
      if (id) { d.id = id; d.row_version = co.row_version; }
      if (!isDirection()) delete d.target_mt;
      d.campaign = CAMPAIGN; btn.disabled = true; msg('coopMsg', T('Enregistrement…', 'Saving…'), null);
      rpc('aflp_coop_save', { p: d }).then(function (r) {
        invalidate('dash', 'coop'); msg('coopMsg', T('Coopérative enregistrée : ', 'Cooperative saved: ') + r.code, true);
        setTimeout(function () { go('#cooperatives/' + encodeURIComponent(r.id) + '/overview'); }, 500);
      }).catch(function (e) { btn.disabled = false; msg('coopMsg', e.message, false); });
    });
  }).catch(function (e) { setRoot(errBox(e)); });
}
function gps(formId) {
  var f = document.getElementById(formId); if (!f || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(function (p) {
    f.elements.gps_lat.value = p.coords.latitude.toFixed(6); f.elements.gps_lng.value = p.coords.longitude.toFixed(6);
  }, function () { alert(T('Position indisponible.', 'Position unavailable.')); }, { enableHighAccuracy: true, timeout: 15000 });
}

/* ================================================================== FICHE */
function bundle(id) {
  return cached('coop:' + id, 20000, function () {
    return Promise.all([
      q('aflp_cooperatives', '*', function (r) { return r.eq('id', id).limit(1); }),
      q('aflp_coop_campaigns', '*', function (r) { return r.eq('cooperative_id', id).eq('campaign', CAMPAIGN).limit(1); }),
      q('aflp_coop_contacts', '*', function (r) { return r.eq('cooperative_id', id).order('role'); }).catch(function () { return []; }),
      q('aflp_coop_sections', '*', function (r) { return r.eq('cooperative_id', id).order('name'); }),
      q('aflp_coop_villages', '*', function (r) { return r.eq('cooperative_id', id); }),
      q('aflp_coop_collection_points', '*', function (r) { return r.eq('cooperative_id', id).order('name'); }),
      dashboard(CAMPAIGN)
    ]).then(function (rs) {
      var coop = rs[0][0];
      if (!coop) throw new Error(T('Coopérative introuvable ou hors de votre périmètre.', 'Cooperative not found or outside your scope.'));
      var stats = (rs[6] || []).filter(function (x) { return x.cooperative_id === id; })[0] || {};
      var sup = coop.supplier_id ? Promise.all([
        q('procurement_suppliers', 'supplier_id,display_name,entity_type,procurement_mode,status', function (r) { return r.eq('supplier_id', coop.supplier_id).limit(1); }),
        q('procurement_supplier_code_history', 'code,is_current', function (r) { return r.eq('supplier_id', coop.supplier_id).eq('is_current', true).limit(1); })
      ]).then(function (x) { return Object.assign({}, x[0][0] || {}, { code: (x[1][0] || {}).code }); }).catch(function () { return null; }) : Promise.resolve(null);
      return sup.then(function (supplier) {
        return { coop: coop, campaign: rs[1][0] || null, contacts: rs[2], sections: rs[3], villages: rs[4], points: rs[5], stats: stats, supplier: supplier };
      });
    });
  });
}
var TABS = [['overview', 'Vue générale', 'Overview'], ['producers', 'Producteurs', 'Farmers'], ['villages', 'Villages & Sections', 'Villages & Sections'],
  ['contacts', 'Responsables', 'Officers'], ['potential', 'Production & Potentiel', 'Production & Potential'], ['purchases', 'Achats & Livraisons', 'Purchases & Deliveries'],
  ['bags', 'Sacherie', 'Bags'], ['sustainability', 'Durabilité', 'Sustainability'], ['documents', 'Documents', 'Documents'], ['history', 'Historique', 'History']];
function ficheHead(b, tab) {
  var co = b.coop, s = b.stats, cc = b.campaign || {};
  /* Finalisation 2027 : hiérarchie d'actions. Deux actions principales toujours visibles (Modifier la coopérative,
     Enrôler un producteur) ; les actions secondaires sont regroupées dans « Plus d'actions » pour ne pas empiler
     six boutons pleine largeur avant le contenu sur mobile. */
  var cid = encodeURIComponent(co.id), edit = canEdit() && !co.archived, acts = '', more = '';
  if (edit) acts += '<a class="btn primary" id="coopEditBtn" href="#cooperatives/' + cid + '/edit">✎ ' + esc(T('Modifier la coopérative', 'Edit cooperative')) + '</a>' +
    '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.enroll(\'' + co.id + '\')">+ ' + esc(T('Enrôler un producteur', 'Enrol a farmer')) + '</button>';
  if (edit) more += '<button type="button" onclick="ANAGROCI_COOP.linkExisting(\'' + co.id + '\')">' + esc(T('Associer un producteur existant', 'Link an existing farmer')) + '</button>' +
    '<a href="#cooperatives/' + cid + '/import">' + esc(T('Importer une liste Excel', 'Import an Excel list')) + '</a>' +
    '<a href="#cooperatives/' + cid + '/villages">' + esc(T('Villages, sections et points de collecte', 'Villages, sections and collection points')) + '</a>' +
    '<a href="#cooperatives/' + cid + '/contacts">' + esc(T('Responsables', 'Officers')) + '</a>' +
    '<a href="#cooperatives/' + cid + '/documents">' + esc(T('Documents', 'Documents')) + '</a>' +
    '<button type="button" onclick="ANAGROCI_COOP.statusDialog(\'' + co.id + '\')">' + esc(T('Changer le statut AFLP', 'Change AFLP status')) + '</button>';
  more += '<a href="#cooperatives/' + cid + '/history">' + esc(T('Historique des modifications', 'Change history')) + '</a>';
  if (isDirection() && !co.archived) more += '<button type="button" class="danger" onclick="ANAGROCI_COOP.archive(\'' + co.id + '\')">' + esc(T('Archiver la coopérative…', 'Archive cooperative…')) + '</button>';
  acts += '<details class="coop-more" data-i18n-ignore><summary class="btn secondary">' + esc(T('Plus d’actions', 'More actions')) + '</summary><div class="coop-more-menu">' + more + '</div></details>';
  return '<div class="ops-route-head coop-head"><div><h1>' + esc(T('Coopérative', 'Cooperative')) + '</h1><p>' + esc(T('Fiche 360° : organisation, producteurs, potentiel, achats, livraisons, stock et traçabilité.',
      'Full profile: organisation, farmers, potential, purchases, deliveries, stock and traceability.')) + '</p></div>' +
    '<div class="ops-route-actions coop-head-actions">' + acts + '<a class="btn secondary" href="#cooperatives">← ' + esc(T('Coopératives', 'Cooperatives')) + '</a></div></div>' +
    '<div class="coop-fiche"><div class="coop-fiche-top"><div style="min-width:0"><div class="coop-code">' + esc(co.code) + (co.acronym ? ' · ' + esc(co.acronym) : '') + '</div>' +
    '<h1>' + esc(co.name) + '</h1><p>' + esc([co.locality, co.sous_prefecture, co.departement, co.cluster_code].filter(Boolean).join(' · ') || T('Localisation à compléter', 'Location to complete')) + '</p>' +
    '<div class="coop-chip-row"><span class="coop-chip">' + esc(L('status', co.aflp_status).toUpperCase() + ' AFLP') + '</span><span class="coop-chip">' + esc(L('payment', cc.payment_model || 'INDIVIDUAL_FARMER')) + '</span>' +
    '<span class="coop-chip">' + esc(L('registry', co.producer_registry_status)) + '</span>' + (co.is_qa ? '<span class="coop-chip">QA</span>' : '') +
    (co.archived ? '<span class="coop-chip">' + esc(T('ARCHIVÉE', 'ARCHIVED')) + '</span>' : '') + '</div></div>' +
    '<div>' + badge(L('compliance', co.compliance_status), complianceTone(co.compliance_status)) + '</div></div>' +
    '<div class="coop-fiche-stats"><div><b>' + num(s.producers_registered) + '</b><span>' + esc(T('Producteurs', 'Farmers')) + '</span></div>' +
    '<div><b>' + num(s.villages_covered) + '</b><span>' + esc(T('Villages', 'Villages')) + '</span></div>' +
    '<div><b>' + (has(cc.declared_potential_mt) ? num(cc.declared_potential_mt, 1) + ' MT' : '—') + '</b><span>' + esc(T('Potentiel', 'Potential')) + '</span></div>' +
    '<div><b>' + (has(cc.target_mt) ? num(cc.target_mt, 1) + ' MT' : '—') + '</b><span>Target</span></div>' +
    '<div><b>' + mt(s.purchased_kg) + '</b><span>' + esc(T('Achat', 'Purchased')) + '</span></div></div></div>' +
    (co.archived ? '<div class="notice danger"><b>' + esc(T('Archivée', 'Archived')) + ' :</b>&nbsp;' + esc(co.archive_reason || '') + ' — ' + esc(T('l’historique (membres, achats, livraisons, lots) reste consultable et traçable.', 'history (members, purchases, deliveries, lots) remains available and traceable.')) + '</div>' : '') +
    (co.aflp_status === 'SUSPENDUE' ? '<div class="notice"><b>' + esc(T('Suspendue', 'Suspended')) + ' :</b>&nbsp;' + esc(co.status_reason || '') + ' — ' + esc(T('aucun achat au titre de la coopérative n’est accepté.', 'no purchase on behalf of the cooperative is accepted.')) + '</div>' : '') +
    '<div class="ops-passport-tabs">' + TABS.map(function (t) {
      return '<a class="' + (t[0] === tab ? 'active' : '') + '" href="#cooperatives/' + encodeURIComponent(co.id) + '/' + t[0] + '">' + esc(T(t[1], t[2])) + '</a>';
    }).join('') + '</div><div id="coopFormHost"></div>';
}
function renderFiche(id, tab) {
  tab = TABS.some(function (t) { return t[0] === tab; }) ? tab : 'overview';
  setRoot(skeleton());
  return Promise.all([bundle(id), refs(), getProfile()]).then(function (rs) {
    var b = rs[0], c = rs[1];
    var body = TAB_RENDER[tab](b, c);
    return Promise.resolve(body).then(function (html) {
      setRoot(ficheHead(b, tab) + html);
      if (TAB_AFTER[tab]) TAB_AFTER[tab](b, c);
    });
  }).catch(function (e) { setRoot('<div class="ops-route-head"><div><h1>' + esc(T('Coopérative', 'Cooperative')) + '</h1></div><div class="ops-route-actions"><a class="btn secondary" href="#cooperatives">← ' + esc(T('Coopératives', 'Cooperatives')) + '</a></div></div>' + errBox(e)); });
}
var TAB_RENDER = {}, TAB_AFTER = {};

/* ---------------------------------------------------------------- 1. Vue générale */
TAB_RENDER.overview = function (b, c) {
  var co = b.coop, cc = b.campaign || {}, s = b.stats, pres = b.contacts.filter(function (x) { return x.role === 'PRESIDENT' && x.active; })[0];
  var dir = b.contacts.filter(function (x) { return (x.role === 'DIRECTEUR' || x.role === 'SECRETAIRE') && x.active; })[0];
  var wh = c.warehouses.filter(function (w) { return w.id === cc.destination_warehouse_id; })[0];
  var rt = c.rm[cc.referent_rt_id];
  var supplierBlock = b.supplier
    ? defGrid([[T('Identité Procurement', 'Procurement identity'), (b.supplier.code || '—') + ' · ' + (b.supplier.display_name || '')], [T('Mode', 'Mode'), b.supplier.procurement_mode], [T('Statut Supplier', 'Supplier status'), b.supplier.status],
        [T('Delivery Plan', 'Delivery Plan'), '<a class="ops-link" href="procurement.html#arrivals">' + esc(T('Arrivages prévus (canal Coopérative)', 'Planned arrivals (Cooperative channel)')) + ' →</a>', true]])
    : '<div class="notice info">' + esc(T('Cette coopérative n’est pas encore contrepartie commerciale. Si ANAGROCI lui achète directement (livraison consolidée), créez ou liez son identité Procurement : une seule organisation, deux rôles, aucun doublon.',
        'This cooperative is not yet a commercial counterpart. If ANAGROCI buys from it directly (consolidated delivery), create or link its Procurement identity: one organisation, two roles, no duplicate.')) + '</div>' +
      (canEdit() && !co.is_qa ? '<div class="ops-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.createSupplier(\'' + co.id + '\')">' + esc(T('Créer l’identité Procurement', 'Create Procurement identity')) + '</button>' +
        '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.linkSupplier(\'' + co.id + '\')">' + esc(T('Lier un Supplier existant', 'Link an existing Supplier')) + '</button></div>' : '');
  return '<div class="grid-2">' +
    card(T('Identité', 'Identity'), '', defGrid([[T('Nom', 'Name'), co.name], [T('Sigle', 'Acronym'), co.acronym], ['Code', co.code], [T('Statut', 'Status'), stBadge(co.aflp_status), true],
      [T('Type', 'Type'), L('orgType', co.org_type)], [T('Dénomination légale', 'Legal name'), co.legal_name], [T('Immatriculation', 'Registration'), co.registration_no],
      [T('Agrément', 'Approval'), co.approval_no], ['RCCM', co.rccm], [T('Création', 'Created'), co.creation_date ? date(co.creation_date) : null],
      [T('Intégration AFLP', 'AFLP joining'), co.aflp_join_date ? date(co.aflp_join_date) : null], [T('Conformité', 'Compliance'), L('compliance', co.compliance_status)]])) +
    card(T('Localisation', 'Location'), '', defGrid([[T('Région', 'Region'), co.region], [T('Département', 'Department'), co.departement], [T('Sous-préfecture', 'Sub-prefecture'), co.sous_prefecture],
      [T('Localité', 'Locality'), co.locality], [T('Siège', 'Head office'), co.head_office], [T('Cluster', 'Cluster'), co.cluster_code],
      ['GPS', has(co.gps_lat) ? num(co.gps_lat, 5) + ', ' + num(co.gps_lng, 5) : null], [T('Villages couverts', 'Villages covered'), String(b.villages.filter(function (v) { return v.active; }).length)]]) +
      '<div id="coopMap" class="coop-map" style="margin-top:12px"></div>') + '</div>' +
    '<div class="grid-2">' +
    card(T('Organisation', 'Organisation'), T('Responsables de la coopérative (contacts, pas des RT).', 'Cooperative officers (contacts, not RTs).'), defGrid([
      [T('Président', 'President'), pres ? pres.full_name : null], [T('Téléphone président', 'President phone'), pres && pres.phone ? pres.phone : null],
      [T('Directeur / secrétaire', 'Director / secretary'), dir ? dir.full_name + ' · ' + L('contact', dir.role) : null], [T('Téléphone', 'Phone'), co.phone], ['Email', co.email],
      [T('Membres déclarés', 'Declared members'), has(co.declared_members) ? num(co.declared_members) : null]])) +
    card('AFLP · ' + CAMPAIGN, '', defGrid([[T('Campagne', 'Campaign'), CAMPAIGN], [T('Modèle de paiement', 'Payment model'), L('payment', cc.payment_model || 'INDIVIDUAL_FARMER')],
      [T('Target', 'Target'), has(cc.target_mt) ? num(cc.target_mt, 1) + ' MT' : null], [T('Potentiel déclaré', 'Declared potential'), has(cc.declared_potential_mt) ? num(cc.declared_potential_mt, 1) + ' MT' : null],
      [T('Volume sécurisé', 'Secured volume'), has(cc.secured_volume_mt) ? num(cc.secured_volume_mt, 1) + ' MT' : null], [T('Producteurs enregistrés', 'Registered farmers'), num(s.producers_registered)],
      [T('Chef de Zone', 'Zone Head'), cc.zone_head_name], [T('Chef d’Unité', 'Unit Head'), cc.unit_head_name], [T('RT de suivi', 'Follow-up RT'), rt ? (rt.id_rt || rt.id) + ' · ' + rt.nom : null],
      [T('Points de collecte', 'Collection points'), String(b.points.filter(function (p) { return p.active; }).length)], [T('Entrepôt destination', 'Destination warehouse'), wh ? wh.code + ' · ' + (wh.name || '') : null]])) + '</div>' +
    card(T('Rôles métier de l’organisation', 'Business roles of the organisation'), T('Coopérative AFLP et, éventuellement, Supplier Procurement : une seule identité.', 'AFLP cooperative and, optionally, Procurement supplier: a single identity.'), supplierBlock);
};
TAB_AFTER.overview = function (b, c) { drawMap(b, c); };
function drawMap(b, c) {
  var el = document.getElementById('coopMap'); if (!el) return;
  if (!global.L || !global.L.map) { el.innerHTML = '<div class="ops-empty">' + esc(T('Carte indisponible.', 'Map unavailable.')) + '</div>'; return; }
  var pts = [];
  if (has(b.coop.gps_lat)) pts.push({ lat: n(b.coop.gps_lat), lng: n(b.coop.gps_lng), label: T('Siège', 'Head office') + ' · ' + b.coop.name, kind: 'hq' });
  b.villages.filter(function (v) { return v.active && v.village_id; }).forEach(function (v) { var x = c.vm[v.village_id]; if (x && has(x.gps_lat)) pts.push({ lat: n(x.gps_lat), lng: n(x.gps_lng), label: x.village, kind: 'v' }); });
  b.points.filter(function (p) { return p.active && has(p.gps_lat); }).forEach(function (p) { pts.push({ lat: n(p.gps_lat), lng: n(p.gps_lng), label: T('Point de collecte', 'Collection point') + ' · ' + p.name, kind: 'cp' }); });
  if (!pts.length) { el.innerHTML = '<div class="ops-empty">' + esc(T('Aucune coordonnée GPS : siège, villages et points de collecte à géolocaliser.', 'No GPS coordinates yet: head office, villages and collection points to geolocate.')) + '</div>'; el.style.height = 'auto'; return; }
  try {
    if (el._map) el._map.remove();
    var m = global.L.map(el, { scrollWheelZoom: false }); el._map = m;
    global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(m);
    var colors = { hq: '#053B23', v: '#008F37', cp: '#EE9E00' };
    var bounds = pts.map(function (p) { global.L.circleMarker([p.lat, p.lng], { radius: p.kind === 'hq' ? 9 : 7, color: '#fff', weight: 2, fillColor: colors[p.kind], fillOpacity: .95 }).addTo(m).bindTooltip(esc(p.label)); return [p.lat, p.lng]; });
    if (bounds.length === 1) m.setView(bounds[0], 12); else m.fitBounds(bounds, { padding: [24, 24] });
  } catch (e) { el.innerHTML = errBox(e); }
}

/* ---------------------------------------------------------------- 2. Producteurs */
var MF = { q: '', section: '', village: '', status: 'OPEN', verified: '', quality: '', page: 0 };
function membersPage(coopId) {
  return client().then(function (cl) {
    var r = cl.from('aflp_coop_members_v').select('*', { count: 'exact' }).eq('cooperative_id', coopId).eq('campaign', CAMPAIGN);
    if (MF.status === 'OPEN') r = r.neq('status', 'ENDED'); else if (MF.status) r = r.eq('status', MF.status);
    if (MF.section) r = r.eq('section_id', MF.section);
    if (MF.village) r = r.eq('village_id', MF.village);
    if (MF.verified === 'yes') r = r.eq('verified', true); else if (MF.verified === 'no') r = r.eq('verified', false);
    if (MF.quality === 'LT50') r = r.lt('completeness_pct', 50); else if (MF.quality === 'LT100') r = r.lt('completeness_pct', 100); else if (MF.quality === 'FULL') r = r.eq('completeness_pct', 100);
    else if (MF.quality === 'NO_PHONE') r = r.contains('missing_fields', ['TELEPHONE']); else if (MF.quality === 'NO_GPS') r = r.contains('missing_fields', ['GPS']);
    else if (MF.quality === 'NO_CONSENT') r = r.contains('missing_fields', ['CONSENTEMENT']); else if (MF.quality === 'REVIEW') r = r.eq('review_required', true);
    if (MF.q) {
      var s = MF.q.replace(/[%,()]/g, ' ').trim();
      r = r.or('nom.ilike.%' + s + '%,prenoms.ilike.%' + s + '%,farmer_id.ilike.%' + s + '%,member_number.ilike.%' + s + '%' + (digits(s).length >= 4 ? ',telephone.ilike.%' + digits(s) + '%' : ''));
    }
    return r.order('nom').range(MF.page * PAGE_SIZE, MF.page * PAGE_SIZE + PAGE_SIZE - 1).then(function (x) {
      if (x.error) throw new Error(x.error.message); return { rows: x.data || [], count: x.count || 0 };
    });
  });
}
TAB_RENDER.producers = function (b, c) {
  var co = b.coop;
  /* Trois actions distinctes : enrôler (nouveau), associer (existant), importer (lot). */
  var acts = canEdit() && !co.archived ? '<button class="btn primary" type="button" onclick="ANAGROCI_COOP.enroll(\'' + co.id + '\')">+ ' + esc(T('Enrôler un producteur', 'Enrol a farmer')) + '</button>' +
    '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.linkExisting(\'' + co.id + '\')">' + esc(T('Associer un producteur existant', 'Link an existing farmer')) + '</button>' +
    '<a class="btn secondary" href="#cooperatives/' + encodeURIComponent(co.id) + '/import">' + esc(T('Importer Excel', 'Import Excel')) + '</a>' +
    '<button class="btn secondary" type="button" id="mfReviews" onclick="ANAGROCI_COOP.reviews(\'' + co.id + '\')">' + esc(T('À vérifier', 'To review')) + ' <span id="mfReviewN">…</span></button>' : '';
  acts += '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.exportMembers(\'' + co.id + '\')">' + esc(T('Exporter', 'Export')) + '</button>';
  var secOpts = '<option value="">' + esc(T('Toutes', 'All')) + '</option>' + b.sections.filter(function (x) { return x.active; }).map(function (x) { return '<option value="' + x.id + '"' + (MF.section === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
  var vilOpts = '<option value="">' + esc(T('Tous', 'All')) + '</option>' + b.villages.filter(function (v) { return v.active && v.village_id; }).map(function (v) { var x = c.vm[v.village_id] || {}; return '<option value="' + esc(v.village_id) + '"' + (MF.village === v.village_id ? ' selected' : '') + '>' + esc(x.village || v.village_id) + '</option>'; }).join('');
  return (b.coop.producer_registry_status === 'NON_FOURNI' ? '<div class="notice info">' + esc(T('Liste des producteurs non fournie par la coopérative : la coopérative peut être active administrativement, ses producteurs seront ajoutés ou importés à réception de la liste.',
      'Farmer list not provided by the cooperative: it can be administratively active; farmers will be added or imported when the list is received.')) + '</div>' : '') +
    card(T('Producteurs membres', 'Member farmers'), T('Registre unique : un membre est un producteur du Farmer Registry, jamais une copie.', 'Single registry: a member is a Farmer Registry farmer, never a copy.'),
    '<div class="coop-filters" style="margin-bottom:12px"><label class="coop-search">' + esc(T('Recherche', 'Search')) + '<input type="search" id="mfQ" value="' + esc(MF.q) + '" placeholder="' + esc(T('Nom, Farmer ID, Member ID, téléphone…', 'Name, Farmer ID, Member ID, phone…')) + '"></label>' +
    '<label>' + esc(T('Section', 'Section')) + '<select id="mfSection">' + secOpts + '</select></label><label>' + esc(T('Village', 'Village')) + '<select id="mfVillage">' + vilOpts + '</select></label>' +
    '<label>' + esc(T('Statut', 'Status')) + '<select id="mfStatus"><option value="OPEN"' + (MF.status === 'OPEN' ? ' selected' : '') + '>' + esc(T('Ouverts', 'Open')) + '</option>' +
      ['ACTIVE', 'PENDING', 'SUSPENDED', 'ENDED'].map(function (k) { return '<option value="' + k + '"' + (MF.status === k ? ' selected' : '') + '>' + esc(L('memberStatus', k)) + '</option>'; }).join('') + '<option value=""' + (MF.status === '' ? ' selected' : '') + '>' + esc(T('Tous (historique)', 'All (history)')) + '</option></select></label>' +
    '<label>' + esc(T('Vérification', 'Verification')) + '<select id="mfVerified"><option value="">' + esc(T('Tous', 'All')) + '</option><option value="yes"' + (MF.verified === 'yes' ? ' selected' : '') + '>' + esc(T('Vérifiés', 'Verified')) + '</option><option value="no"' + (MF.verified === 'no' ? ' selected' : '') + '>' + esc(T('Non vérifiés', 'Not verified')) + '</option></select></label>' +
    '<label>' + esc(T('Qualité du dossier', 'File quality')) + '<select id="mfQuality">' + [['', T('Tous', 'All')], ['LT50', T('Complétude < 50 %', 'Completeness < 50%')], ['LT100', T('Incomplets (< 100 %)', 'Incomplete (< 100%)')], ['FULL', T('Complets (100 %)', 'Complete (100%)')],
      ['NO_PHONE', T('Sans téléphone', 'No phone')], ['NO_GPS', T('Sans GPS', 'No GPS')], ['NO_CONSENT', T('Consentement non recueilli', 'Consent not recorded')], ['REVIEW', T('Doublon possible signalé', 'Possible duplicate flagged')]]
      .map(function (o) { return '<option value="' + o[0] + '"' + (MF.quality === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label></div>' +
    '<div id="mfQualityPanel"></div><div id="mfTable"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>', acts);
};
TAB_AFTER.producers = function (b, c) {
  function reload() { MF.page = MF.page || 0; drawMembers(b, c); }
  var t = null;
  document.getElementById('mfQ').addEventListener('input', function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { MF.q = v; MF.page = 0; reload(); }, 300); });
  [['mfSection', 'section'], ['mfVillage', 'village'], ['mfStatus', 'status'], ['mfVerified', 'verified'], ['mfQuality', 'quality']].forEach(function (x) {
    document.getElementById(x[0]).addEventListener('change', function () { MF[x[1]] = this.value; MF.page = 0; reload(); });
  });
  reload();
  drawQuality(b);
  var rn = document.getElementById('mfReviewN');
  if (rn && global.ANAGROCI_COOP_ENROL) global.ANAGROCI_COOP_ENROL.reviewCount(b.coop.id).then(function (k) { rn.textContent = '(' + k + ')'; var bt = document.getElementById('mfReviews'); if (bt && k) bt.className = 'btn primary'; }).catch(function () { rn.textContent = ''; });
};
/* Qualité des données : mesure la COMPLÉTUDE du dossier (8 éléments), jamais une note du producteur. */
var MISSING = { TELEPHONE: ['Téléphone', 'Phone'], SEXE: ['Sexe', 'Sex'], AGE: ['Âge', 'Age'], VILLAGE: ['Village', 'Village'], GPS: ['GPS', 'GPS'], SUPERFICIE: ['Superficie', 'Area'], POTENTIEL: ['Potentiel', 'Potential'], CONSENTEMENT: ['Consentement', 'Consent'] };
function missingLabel(k) { return MISSING[k] ? T(MISSING[k][0], MISSING[k][1]) : k; }
function drawQuality(b) {
  var box = document.getElementById('mfQualityPanel'); if (!box) return;
  memberAgg(b.coop.id).then(function (A) {
    var m = A.members, t = m.length; if (!t) { box.innerHTML = ''; return; }
    var miss = {}; Object.keys(MISSING).forEach(function (k) { miss[k] = 0; });
    var sum = 0, full = 0, low = 0;
    m.forEach(function (x) { sum += n(x.completeness_pct); if (n(x.completeness_pct) === 100) full++; if (n(x.completeness_pct) < 50) low++; (x.missing_fields || []).forEach(function (k) { miss[k] = (miss[k] || 0) + 1; }); });
    box.innerHTML = '<div class="coop-quality"><div class="coop-quality-head"><b>' + esc(T('Qualité des données', 'Data quality')) + '</b> <small class="muted">' + esc(T('complétude du dossier (8 éléments), pas une note du producteur', 'file completeness (8 items), not a farmer rating')) + '</small></div>' +
      '<div class="coop-quality-kpis"><span><b>' + num(sum / t, 0) + ' %</b>' + esc(T('complétude moyenne', 'average completeness')) + '</span><span><b>' + num(full) + '</b>' + esc(T('dossiers complets', 'complete files')) + '</span><span><b>' + num(low) + '</b>' + esc(T('sous 50 %', 'below 50%')) + '</span></div>' +
      '<div class="coop-quality-bars">' + Object.keys(MISSING).map(function (k) {
        var have = t - miss[k], p = Math.round(have / t * 100);
        return '<div><span>' + esc(missingLabel(k)) + '</span><i><em style="width:' + p + '%"></em></i><b>' + num(have) + ' / ' + num(t) + '</b></div>';
      }).join('') + '</div></div>';
  }).catch(function () { box.innerHTML = ''; });
}
function drawMembers(b, c) {
  var box = document.getElementById('mfTable'); if (!box) return;
  membersPage(b.coop.id).then(function (res) {
    var edit = canEdit() && !b.coop.archived;
    box.innerHTML = '<div class="coop-wide">' + table([T('Farmer ID', 'Farmer ID'), T('Nom', 'Name'), T('Village', 'Village'), T('Téléphone', 'Phone'), 'Member ID', T('Section', 'Section'), T('Superficie', 'Area'), T('Potentiel', 'Potential'),
        'Passport', T('Consentement', 'Consent'), T('Complétude', 'Completeness'), T('Statut', 'Status'), T('Dernière activité', 'Last activity'), ''],
      res.rows.map(function (m) {
        var a = '';
        if (edit && m.status !== 'ENDED') {
          if (!m.verified) a += '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.verify(\'' + m.membership_id + '\')">' + esc(T('Vérifier', 'Verify')) + '</button>';
          if (!m.is_primary && m.status === 'ACTIVE') a += '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.primary(\'' + m.membership_id + '\')">' + esc(T('Principale', 'Primary')) + '</button>';
          a += '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.editMember(\'' + m.membership_id + '\')">' + esc(T('Modifier', 'Edit')) + '</button>' +
            '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.transfer(\'' + m.membership_id + '\')">' + esc(T('Changer de coop.', 'Change coop.')) + '</button>' +
            '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.endMember(\'' + m.membership_id + '\')">' + esc(T('Retirer', 'Remove')) + '</button>';
        }
        return '<tr><td class="mono"><a class="ops-link" href="#farmers/' + encodeURIComponent(m.producer_id) + '">' + esc(m.farmer_id || '—') + '</a></td>' +
          '<td><b>' + esc((m.nom || '') + ' ' + (m.prenoms || '')) + '</b>' + (m.is_primary ? '' : ' ' + badge(T('secondaire', 'secondary'), 'info')) + (m.possible_duplicate ? ' ' + badge(T('doublon ?', 'duplicate?'), 'warn') : '') + '</td>' +
          '<td>' + esc(m.village_nom || '—') + '</td><td>' + (m.telephone ? esc(maskPhone(m.telephone)) : na()) + '</td><td class="mono">' + esc(m.member_number || '—') + '</td>' +
          '<td>' + esc(m.section_name || '—') + '</td><td>' + (has(m.area_ha) ? num(m.area_ha, 2) + ' ha' : na()) + '</td>' +
          '<td>' + (has(m.potential_kg) ? num(m.potential_kg) + ' kg' + (m.potential_source === 'DECLARE' ? ' <small class="muted">' + esc(T('décl.', 'decl.')) + '</small>' : '') : na()) + '</td>' +
          '<td>' + esc(L('passport', m.passport_stage)) + ' · ' + num(m.passport_completion) + '%</td><td>' + badge(L('consent', m.consent_status), m.consent_status === 'GRANTED' ? 'ok' : 'warn') + '</td>' +
          '<td>' + (has(m.completeness_pct) ? badge(num(m.completeness_pct) + ' %', n(m.completeness_pct) === 100 ? 'ok' : n(m.completeness_pct) < 50 ? 'danger' : 'warn') +
            ((m.missing_fields || []).length ? '<br><small class="muted">' + esc(T('manque : ', 'missing: ') + m.missing_fields.map(missingLabel).join(', ')) + '</small>' : '') : '—') + '</td>' +
          '<td>' + badge(L('memberStatus', m.status), m.status === 'ACTIVE' ? 'ok' : m.status === 'ENDED' ? 'info' : 'warn') + (m.verified ? ' ' + badge('✓ ' + T('vérifié', 'verified'), 'ok') : '') + '</td>' +
          '<td>' + date(m.last_purchase_date) + '</td><td><div class="coop-actions-cell">' + a + '</div></td></tr>';
      }), T('Aucun producteur pour ces filtres.', 'No farmer for these filters.')) + '</div>' +
      '<div class="coop-pager"><span>' + esc(num(res.count) + ' ' + T('affiliation(s)', 'membership(s)') + ' · ' + T('page', 'page') + ' ' + (MF.page + 1) + ' / ' + Math.max(1, Math.ceil(res.count / PAGE_SIZE))) + '</span>' +
      '<span class="ops-actions"><button class="btn secondary" type="button" ' + (MF.page ? '' : 'disabled ') + 'id="mfPrev">←</button><button class="btn secondary" type="button" ' + ((MF.page + 1) * PAGE_SIZE < res.count ? '' : 'disabled ') + 'id="mfNext">→</button></span></div>';
    var p = document.getElementById('mfPrev'), nx = document.getElementById('mfNext');
    if (p) p.onclick = function () { MF.page = Math.max(0, MF.page - 1); drawMembers(b, c); };
    if (nx) nx.onclick = function () { MF.page++; drawMembers(b, c); };
  }).catch(function (e) { box.innerHTML = errBox(e); });
}
function host() { var h = document.getElementById('coopFormHost'); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); return h; }
function closeHost() { var h = document.getElementById('coopFormHost'); if (h) h.innerHTML = ''; }
function currentCoopId() { var p = routeParts(); return p[0] === 'cooperatives' ? p[1] : null; }
function refreshFiche() { var id = currentCoopId(); invalidate('coop:' + id, 'dash'); render(routeParts()); }

function simpleRpc(name, args, okText) {
  return rpc(name, args).then(function () { if (okText) toast(okText); refreshFiche(); }).catch(function (e) { alert(e.message); });
}
function toast(t) { var d = document.createElement('div'); d.className = 'notice ok'; d.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;max-width:360px;box-shadow:0 10px 30px rgba(0,0,0,.15)'; d.setAttribute('data-i18n-ignore', ''); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3500); }
function verify(mid) {
  var h = host(); if (!h) return;
  h.innerHTML = '<section class="card ops-form-card"><div class="card-head"><div><h2>' + esc(T('Vérifier l’affiliation', 'Verify membership')) + '</h2><p>' +
    esc(T('Vérifié = ANAGROCI a contrôlé l’appartenance du producteur à la coopérative.', 'Verified = ANAGROCI checked the farmer belongs to the cooperative.')) + '</p></div></div>' +
    '<form id="vfForm" class="coop-form">' + selectField(T('Méthode de vérification', 'Verification method'), 'method', opts('verif', 'LISTE_COOPERATIVE'), 'span-2') + '</form>' +
    '<div class="coop-form-actions"><button class="btn primary" type="button" id="vfGo">' + esc(T('Confirmer', 'Confirm')) + '</button><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.closeHost()">' + esc(T('Annuler', 'Cancel')) + '</button></div></section>';
  document.getElementById('vfGo').onclick = function () { simpleRpc('aflp_coop_verify_member', { p_membership: mid, p_method: formData(document.getElementById('vfForm')).method }, T('Affiliation vérifiée.', 'Membership verified.')); };
}
function primary(mid) { simpleRpc('aflp_coop_set_primary', { p_membership: mid }, T('Affiliation principale mise à jour.', 'Primary affiliation updated.')); }
function endMember(mid) { var r = prompt(T('Motif du retrait (l’affiliation est clôturée, jamais supprimée) :', 'Reason for removal (membership is closed, never deleted):')); if (!r) return; simpleRpc('aflp_coop_end_member', { p_membership: mid, p_reason: r }, T('Affiliation clôturée.', 'Membership closed.')); }
function transfer(mid) {
  dashboard(CAMPAIGN).then(function (rows) {
    var cur = currentCoopId(), h = host(); if (!h) return;
    var list = rows.filter(function (r) { return r.cooperative_id !== cur && !r.archived && r.aflp_status !== 'SORTIE'; });
    h.innerHTML = '<section class="card ops-form-card"><div class="card-head"><div><h2>' + esc(T('Changer de coopérative', 'Change cooperative')) + '</h2><p>' +
      esc(T('L’ancienne affiliation est clôturée avec une date de fin ; l’historique est conservé.', 'The previous membership is closed with an end date; history is kept.')) + '</p></div></div>' +
      '<form id="trForm" class="coop-form">' + selectField(T('Nouvelle coopérative *', 'New cooperative *'), 'coop', '<option value="">—</option>' + list.map(function (r) { return '<option value="' + r.cooperative_id + '">' + esc(r.code + ' · ' + r.name) + '</option>'; }).join(''), 'span-2') +
      field(T('Nouveau Member ID', 'New Member ID'), 'member', '') + field(T('Motif *', 'Reason *'), 'reason', '', 'maxlength="200"', 'span-3') + '</form>' +
      '<div class="coop-form-actions"><button class="btn primary" type="button" id="trGo">' + esc(T('Transférer', 'Transfer')) + '</button><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.closeHost()">' + esc(T('Annuler', 'Cancel')) + '</button><span id="trMsg"></span></div></section>';
    document.getElementById('trGo').onclick = function () {
      var d = formData(document.getElementById('trForm'));
      if (!d.coop || !d.reason) return msg('trMsg', T('Coopérative et motif obligatoires.', 'Cooperative and reason required.'), false);
      rpc('aflp_coop_transfer_member', { p_membership: mid, p_new_coop: d.coop, p_reason: d.reason, p_member_number: d.member || null, p_section: null })
        .then(function () { toast(T('Transfert enregistré.', 'Transfer recorded.')); refreshFiche(); }).catch(function (e) { msg('trMsg', e.message, false); });
    };
  });
}

/* ================================================================ IMPORT EXCEL */
/* Assistant en 10 étapes. Aucune ligne n'est perdue : chaque ligne finit dans UNE
   catégorie (Nouveau enrôlé, Existant associé, À compléter, Doublon à vérifier,
   Rejeté, Ignoré). « À compléter » et « Doublon à vérifier » rejoignent la file
   « À vérifier » (staging serveur) et ne deviennent des producteurs qu'après décision. */
var IMPORT_FIELDS = [
  ['nom', 'Nom', 'Last name', true], ['prenoms', 'Prénoms', 'First names'], ['sexe', 'Sexe (M/F)', 'Sex (M/F)'], ['birth_year', 'Année de naissance', 'Birth year'],
  ['age_band', 'Tranche d’âge', 'Age band'], ['telephone', 'Téléphone principal', 'Main phone'], ['telephone_alt', 'Téléphone secondaire', 'Secondary phone'],
  ['preferred_language', 'Langue', 'Language'], ['farmer_id', 'Farmer ID (si connu)', 'Farmer ID (if known)'], ['village', 'Village', 'Village', true],
  ['section', 'Section', 'Section'], ['member_number', 'Member ID', 'Member ID'], ['membership_start', 'Date d’adhésion', 'Membership date'],
  ['cashew_farmer', 'Producteur d’anacarde (OUI/NON)', 'Cashew farmer (YES/NO)'], ['plantation_count', 'Nombre de plantations', 'Number of plantations'],
  ['total_area_ha', 'Superficie anacarde (ha)', 'Cashew area (ha)'], ['forecast_kg', 'Potentiel (kg)', 'Potential (kg)'], ['previous_production_kg', 'Production précédente (kg)', 'Previous production (kg)'],
  ['planting_year', 'Année de plantation', 'Planting year'], ['tree_count', 'Nombre d’arbres', 'Number of trees'], ['home_gps_lat', 'GPS latitude', 'GPS latitude'], ['home_gps_lng', 'GPS longitude', 'GPS longitude'],
  ['consent_status', 'Consentement (ACCORDE/REFUSE)', 'Consent (GRANTED/REFUSED)'], ['consent_method', 'Méthode consentement', 'Consent method'], ['consent_at', 'Date consentement', 'Consent date']
];
var IMP_CAT = {
  NOUVEAU_ENROLE: ['Nouveau enrôlé', 'New enrolled', 'ok'], EXISTANT_ASSOCIE: ['Producteur existant associé', 'Existing farmer linked', 'ok'],
  A_COMPLETER: ['À compléter', 'To complete', 'warn'], DOUBLON_A_VERIFIER: ['Doublon à vérifier', 'Duplicate to review', 'warn'], REJETE: ['Rejeté', 'Rejected', 'danger'], IGNORE: ['Ignoré', 'Ignored', 'info']
};
var ACTION_CAT = { CREATE: 'NOUVEAU_ENROLE', LINK: 'EXISTANT_ASSOCIE', COMPLETE: 'A_COMPLETER', REVIEW: 'DOUBLON_A_VERIFIER', REJECT: 'REJETE', SKIP: 'IGNORE' };
function catLabel(k) { var x = IMP_CAT[k]; return x ? T(x[0], x[1]) : k; }
function catBadge(k) { var x = IMP_CAT[k] || ['', '', 'info']; return badge(catLabel(k), x[2]); }
var IMP = null;
function renderImport(id) {
  setRoot(skeleton());
  return Promise.all([bundle(id), refs(), getProfile()]).then(function (rs) {
    var b = rs[0];
    if (!canEdit() || b.coop.archived) { setRoot(ficheHead(b, 'producers') + errBox(T('Import réservé aux rôles d’encadrement terrain, sur une coopérative non archivée.', 'Import is reserved to field supervisors, on a non-archived cooperative.'))); return; }
    if (!IMP || IMP.coop !== id) IMP = { coop: id, step: 1, rows: [], headers: [], map: {}, file: '', vmap: {} };
    setRoot(ficheHead(b, 'producers') + '<div id="impBox"></div>');
    drawImport(b, rs[1]);
  }).catch(function (e) { setRoot(errBox(e)); });
}
function impSteps() {
  var s = [T('1 Modèle', '1 Template'), T('2 Fichier', '2 File'), T('3 Colonnes', '3 Columns'), T('4 Aperçu', '4 Preview'), T('5 Villages', '5 Villages'), T('6 Doublons', '6 Duplicates'),
    T('7 Classement', '7 Classification'), T('8 Décisions', '8 Decisions'), T('9 Import', '9 Import'), T('10 Rapport', '10 Report')];
  return '<div class="coop-steps">' + s.map(function (x, i) { return '<span class="' + (IMP.step === i + 1 ? 'on' : IMP.step > i + 1 ? 'done' : '') + '">' + esc(x) + '</span>'; }).join('') + '</div>';
}
function impBatches(coopId) {
  return q('aflp_coop_import_batches', 'id,file_name,total_rows,nouveaux,existants_associes,a_completer,doublons_a_verifier,rejetes,ignores,status,created_at,created_by_email',
    function (r) { return r.eq('cooperative_id', coopId).order('created_at', { ascending: false }).limit(20); }).catch(function () { return []; });
}
function drawImport(b, c) {
  var box = document.getElementById('impBox'); if (!box) return;
  var back = '<a class="btn secondary" href="#cooperatives/' + encodeURIComponent(b.coop.id) + '/producers">← ' + esc(T('Producteurs', 'Farmers')) + '</a>';
  if (IMP.step <= 2) {
    box.innerHTML = card(T('Import des producteurs', 'Farmer import'), T('Aucune ligne n’est perdue : chaque ligne finit Nouveau enrôlé, Existant associé, À compléter, Doublon à vérifier, Rejeté ou Ignoré.',
        'No row is lost: each row ends New enrolled, Existing linked, To complete, Duplicate to review, Rejected or Ignored.'),
      impSteps() + '<div class="ops-actions" style="justify-content:flex-start;margin-bottom:12px"><button class="btn secondary" type="button" id="impTpl">' + esc(T('Télécharger le modèle Excel', 'Download Excel template')) + '</button></div>' +
      '<label class="coop-form" style="display:block"><span style="font-size:11px;font-weight:700;color:var(--forest)">' + esc(T('Fichier Excel (.xlsx, .xls) ou CSV de la coopérative — 5 000 lignes maximum', 'Cooperative Excel (.xlsx, .xls) or CSV file — 5,000 rows max')) + '</span>' +
      '<input type="file" id="impFile" accept=".xlsx,.xls,.csv" style="margin-top:6px"></label><p id="impMsg" class="muted"></p>', back) +
      '<div id="impHist"></div>';
    document.getElementById('impTpl').onclick = function () { downloadTemplate(b); };
    document.getElementById('impFile').onchange = function () { readFile(this.files[0], b, c); };
    impBatches(b.coop.id).then(function (rows) {
      var hh = document.getElementById('impHist'); if (!hh || !rows.length) return;
      hh.innerHTML = card(T('Historique des imports', 'Import history'), T('Chaque import garde son détail ligne à ligne.', 'Each import keeps its row-by-row detail.'),
        table([T('Date', 'Date'), T('Fichier', 'File'), T('Lignes', 'Rows'), catLabel('NOUVEAU_ENROLE'), catLabel('EXISTANT_ASSOCIE'), catLabel('A_COMPLETER'), catLabel('DOUBLON_A_VERIFIER'), catLabel('REJETE'), catLabel('IGNORE'), T('Statut', 'Status'), T('Par', 'By')],
          rows.map(function (x) {
            return '<tr><td>' + dtime(x.created_at) + '</td><td>' + esc(x.file_name || '—') + '</td><td>' + num(x.total_rows) + '</td><td>' + num(x.nouveaux) + '</td><td>' + num(x.existants_associes) + '</td><td>' + num(x.a_completer) + '</td>' +
              '<td>' + num(x.doublons_a_verifier) + '</td><td>' + num(x.rejetes) + '</td><td>' + num(x.ignores) + '</td><td>' + badge(x.status === 'TERMINE' ? T('Terminé', 'Done') : T('Interrompu', 'Interrupted'), x.status === 'TERMINE' ? 'ok' : 'warn') + '</td><td>' + esc(x.created_by_email || '—') + '</td></tr>';
          })));
    });
    return;
  }
  if (IMP.step === 3) {
    box.innerHTML = card(T('Correspondance des colonnes', 'Column mapping'), IMP.file + ' · ' + num(IMP.rows.length) + ' ' + T('ligne(s)', 'row(s)'),
      impSteps() + '<form id="impMap" class="coop-form">' + IMPORT_FIELDS.map(function (f) {
        return selectField(T(f[1], f[2]) + (f[3] ? ' *' : ''), f[0], '<option value="">' + esc(T('— non fourni —', '— not provided —')) + '</option>' +
          IMP.headers.map(function (h) { return '<option value="' + esc(h) + '"' + (IMP.map[f[0]] === h ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join(''));
      }).join('') + '</form><div class="coop-form-actions"><button class="btn primary" type="button" id="impNext">' + esc(T('Aperçu', 'Preview')) + ' →</button>' +
      '<button class="btn secondary" type="button" id="impRestart">' + esc(T('Changer de fichier', 'Change file')) + '</button><span id="impMsg"></span></div>', back);
    document.getElementById('impRestart').onclick = function () { IMP.step = 1; drawImport(b, c); };
    document.getElementById('impNext').onclick = function () {
      IMP.map = formData(document.getElementById('impMap'));
      if (!IMP.map.nom || !IMP.map.village) return msg('impMsg', T('Les colonnes Nom et Village sont obligatoires.', 'Name and Village columns are required.'), false);
      prepareRows(b, c); IMP.step = 4; drawImport(b, c);
    };
    return;
  }
  if (IMP.step === 4) {
    var prev = IMP.prepared.slice(0, 20);
    box.innerHTML = card(T('Aperçu des données lues', 'Preview of the data read'), T('20 premières lignes, telles qu’elles seront envoyées. Une valeur vide reste NON COLLECTÉE.', 'First 20 rows, as they will be sent. An empty value stays NOT RECORDED.'),
      impSteps() + '<div class="coop-wide">' + table(['#', T('Nom', 'Name'), T('Prénoms', 'First names'), T('Sexe', 'Sex'), T('Âge', 'Age'), T('Téléphone', 'Phone'), T('Village (fichier)', 'Village (file)'), 'Member ID', T('Superficie', 'Area'), T('Potentiel', 'Potential'), T('Remarques', 'Notes')],
        prev.map(function (r) {
          return '<tr><td>' + r.idx + '</td><td>' + esc(r.nom || '—') + '</td><td>' + esc(r.prenoms || '—') + '</td><td>' + (r.sexe ? esc(r.sexe) : na()) + '</td><td>' + (r.birth_year || r.age_band ? esc(r.birth_year || r.age_band) : na()) + '</td>' +
            '<td>' + (r.telephone ? esc(maskPhone(r.telephone)) : na()) + '</td><td>' + esc(r.village || '—') + '</td><td class="mono">' + esc(r.member_number || '—') + '</td>' +
            '<td>' + (r.total_area_ha != null ? num(r.total_area_ha, 2) + ' ha' : na()) + '</td><td>' + (r.forecast_kg != null ? num(r.forecast_kg) + ' kg' : na()) + '</td><td><small class="muted">' + esc(r.problems.join(' · ')) + '</small></td></tr>';
        })) + '</div>' +
      '<div class="coop-form-actions"><button class="btn primary" type="button" id="impNext">' + esc(T('Valider les villages', 'Validate villages')) + ' →</button><button class="btn secondary" type="button" id="impBack">' + esc(T('Revoir les colonnes', 'Review columns')) + '</button></div>', back);
    document.getElementById('impBack').onclick = function () { IMP.step = 3; drawImport(b, c); };
    document.getElementById('impNext').onclick = function () { IMP.step = 5; drawImport(b, c); };
    return;
  }
  if (IMP.step === 5) {
    /* Villages du fichier → référentiel AFLP. Un village non reconnu n'est jamais deviné :
       on choisit le village du référentiel, ou la ligne part « À compléter ». */
    var names = {}; IMP.prepared.forEach(function (r) { var k = norm(r.village); if (!k) return; (names[k] = names[k] || { label: r.village, n: 0 }).n++; });
    var cov = {}; b.villages.forEach(function (v) { if (v.active && v.village_id) cov[v.village_id] = 1; });
    var keys = Object.keys(names).sort();
    function auto(k) { var cands = c.vByName[k] || []; if (cands.length > 1) { var inCoop = cands.filter(function (v) { return cov[v.id]; }); if (inCoop.length === 1) return inCoop[0].id; return ''; } return cands[0] ? cands[0].id : ''; }
    keys.forEach(function (k) { if (!(k in IMP.vmap)) IMP.vmap[k] = auto(k); });
    var vopts = c.villages.slice().sort(function (a, z) { return (cov[z.id] ? 1 : 0) - (cov[a.id] ? 1 : 0) || String(a.village).localeCompare(String(z.village)); });
    var unresolved = keys.filter(function (k) { return !IMP.vmap[k]; }).length;
    box.innerHTML = card(T('Validation des villages', 'Village validation'), T('Chaque village du fichier doit correspondre à un village du référentiel AFLP. Sinon, ses lignes partent « À compléter » (jamais créées sur une supposition).',
        'Each file village must match an AFLP registry village. Otherwise its rows go “To complete” (never created on a guess).'),
      impSteps() + '<section class="kpi-grid">' + kpi(T('Villages dans le fichier', 'Villages in file'), num(keys.length), '') + kpi(T('Reconnus', 'Matched'), num(keys.length - unresolved), '') +
        kpi(T('À rattacher', 'To map'), num(unresolved), T('sinon lignes « À compléter »', 'otherwise rows “To complete”'), unresolved ? 'warn' : '') + '</section>' +
      table([T('Village (fichier)', 'Village (file)'), T('Lignes', 'Rows'), T('Village du référentiel', 'Registry village')], keys.map(function (k) {
        var cands = c.vByName[k] || [];
        return '<tr><td><b>' + esc(names[k].label) + '</b>' + (cands.length > 1 ? ' ' + badge(T('homonymes', 'homonyms') + ' : ' + cands.length, 'warn') : '') + '</td><td>' + num(names[k].n) + '</td><td><select data-vk="' + esc(k) + '"><option value="">' + esc(T('— non rattaché (À compléter) —', '— not mapped (To complete) —')) + '</option>' +
          vopts.map(function (v) { return '<option value="' + esc(v.id) + '"' + (IMP.vmap[k] === v.id ? ' selected' : '') + '>' + esc(v.village + ' · ' + (v.cluster || '')) + (cov[v.id] ? ' ★' : '') + '</option>'; }).join('') + '</select></td></tr>';
      }), T('Aucun village dans le fichier.', 'No village in the file.')) +
      '<div class="coop-form-actions"><button class="btn primary" type="button" id="impNext">' + esc(T('Rechercher les doublons', 'Search duplicates')) + ' →</button><button class="btn secondary" type="button" id="impBack">' + esc(T('Retour', 'Back')) + '</button><span id="impMsg"></span></div>', back);
    box.querySelectorAll('select[data-vk]').forEach(function (s) { s.onchange = function () { IMP.vmap[s.getAttribute('data-vk')] = s.value; }; });
    document.getElementById('impBack').onclick = function () { IMP.step = 4; drawImport(b, c); };
    document.getElementById('impNext').onclick = function () { IMP.step = 6; drawImport(b, c); dedupRows(b, c); };
    return;
  }
  if (IMP.step === 6) {
    box.innerHTML = card(T('Recherche des doublons', 'Duplicate search'), T('Registre complet : Farmer ID, téléphones, nom + prénoms + village, nom + année de naissance, nom + cluster ; et doublons internes au fichier.',
        'Full registry: Farmer ID, phones, full name + village, name + birth year, name + cluster; and duplicates within the file.'),
      impSteps() + '<div class="ops-progressline"><div class="ops-progresstrack"><i id="impBar" style="width:0%"></i></div><b id="impPct">0 %</b></div><p id="impMsg" class="muted"></p>', back);
    return;
  }
  if (IMP.step === 7) {
    var cnt = {}; Object.keys(IMP_CAT).forEach(function (k) { cnt[k] = 0; });
    IMP.prepared.forEach(function (r) { cnt[ACTION_CAT[r.action]]++; });
    box.innerHTML = card(T('Classement proposé', 'Proposed classification'), T('Classement automatique, modifiable à l’étape suivante. Aucune création sur un doublon possible sans décision.', 'Automatic classification, editable at the next step. No creation on a possible duplicate without a decision.'),
      impSteps() + '<section class="kpi-grid">' + Object.keys(IMP_CAT).map(function (k) { return kpi(catLabel(k), num(cnt[k]), '', IMP_CAT[k][2] === 'ok' ? '' : cnt[k] ? 'warn' : ''); }).join('') + '</section>' +
      '<p class="muted">' + esc(T('Total : ', 'Total: ') + num(IMP.prepared.length) + T(' ligne(s) — aucune ligne perdue.', ' row(s) — no row lost.')) + '</p>' +
      '<div class="coop-form-actions"><button class="btn primary" type="button" id="impNext">' + esc(T('Revoir les décisions', 'Review decisions')) + ' →</button><button class="btn secondary" type="button" id="impBack">' + esc(T('Villages', 'Villages')) + '</button></div>', back);
    document.getElementById('impBack').onclick = function () { IMP.step = 5; drawImport(b, c); };
    document.getElementById('impNext').onclick = function () { IMP.step = 8; IMP.page = 0; drawImport(b, c); };
    return;
  }
  if (IMP.step === 8) {
    var per = 100, pg = IMP.page || 0, filt = IMP.filter || '';
    var list = IMP.prepared.filter(function (r) { return !filt || ACTION_CAT[r.action] === filt; });
    var show = list.slice(pg * per, pg * per + per);
    box.innerHTML = card(T('Décisions ligne par ligne', 'Row-by-row decisions'), T('Associer l’existant, créer (motif si correspondance faible), envoyer en vérification, compléter plus tard, rejeter ou ignorer.',
        'Link existing, create (reason if weak match), send for review, complete later, reject or ignore.'),
      impSteps() + '<div class="coop-filters" style="margin-bottom:10px"><label>' + esc(T('Catégorie', 'Category')) + '<select id="impFilt"><option value="">' + esc(T('Toutes', 'All')) + '</option>' +
        Object.keys(IMP_CAT).map(function (k) { return '<option value="' + k + '"' + (filt === k ? ' selected' : '') + '>' + esc(catLabel(k)) + '</option>'; }).join('') + '</select></label>' +
        '<label>&nbsp;<button class="btn secondary" type="button" id="impErr">' + esc(T('Télécharger le contrôle (Excel)', 'Download check (Excel)')) + '</button></label></div>' +
      '<div class="coop-wide">' + table(['#', T('Nom', 'Name'), T('Village', 'Village'), T('Téléphone', 'Phone'), 'Member ID', T('Correspondances', 'Matches'), T('Décision', 'Decision'), T('Motif', 'Reason')],
        show.map(function (r) {
          var top = r.matches[0], strong = top && top.confidence >= 85;
          var o = [];
          if (r.check !== 'A_COMPLETER' && !(r.matches.some(function (m) { return m.reason === 'FARMER_ID'; })) && !strong && !r.internalDup) o.push(['CREATE', r.matches.length ? T('Créer (motif obligatoire)', 'Create (reason required)') : T('Créer', 'Create')]);
          r.matches.forEach(function (m) { if (m.producer_id && m.accessible !== false) o.push(['LINK:' + m.producer_id, T('Associer ', 'Link ') + m.farmer_id + ' (' + m.confidence + ' %)']); });
          if (r.check !== 'A_COMPLETER') o.push(['REVIEW', T('Envoyer en vérification', 'Send for review')]);
          o.push(['COMPLETE', T('À compléter', 'To complete')], ['REJECT', T('Rejeter', 'Reject')], ['SKIP', T('Ignorer', 'Ignore')]);
          var cur = r.action === 'LINK' ? 'LINK:' + r.producer_id : r.action;
          return '<tr><td>' + r.idx + '</td><td>' + esc((r.nom || '') + ' ' + (r.prenoms || '')) + '</td><td>' + esc(r.village_label || r.village || '—') + '</td><td>' + esc(r.telephone ? maskPhone(r.telephone) : '—') + '</td><td class="mono">' + esc(r.member_number || '—') + '</td>' +
            '<td>' + (r.matches.length ? r.matches.slice(0, 3).map(function (m) { return '<small>' + esc((m.farmer_id || '?') + ' · ' + (global.ANAGROCI_COOP_ENROL ? global.ANAGROCI_COOP_ENROL.reasonLabel(m.reason) : m.reason) + ' · ' + m.confidence + ' %' + (m.accessible === false ? ' · ' + T('hors périmètre', 'out of scope') : '') + (m.coop_codes ? ' · ' + m.coop_codes : '')) + '</small>'; }).join('<br>') : '—') +
              (r.internalDup ? '<br><small class="ops-danger-text">' + esc(T('doublon dans le fichier (ligne ', 'duplicate in file (row ') + r.internalDup + ')') + '</small>' : '') +
              (r.problems.length ? '<br><small class="muted">' + esc(r.problems.join(' · ')) + '</small>' : '') + '</td>' +
            '<td>' + catBadge(ACTION_CAT[r.action]) + '<br><select data-row="' + r.idx + '">' + o.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === cur ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></td>' +
            '<td><input data-why="' + r.idx + '" value="' + esc(r.why || '') + '" maxlength="200" placeholder="' + esc(T('motif', 'reason')) + '" style="min-width:140px"></td></tr>';
        }), T('Aucune ligne dans cette catégorie.', 'No row in this category.')) + '</div>' +
      '<div class="coop-pager"><span>' + esc(num(list.length) + ' ' + T('ligne(s)', 'row(s)') + ' · ' + T('page', 'page') + ' ' + (pg + 1) + ' / ' + Math.max(1, Math.ceil(list.length / per))) + '</span>' +
      '<span class="ops-actions"><button class="btn secondary" type="button" id="impPrev"' + (pg ? '' : ' disabled') + '>←</button><button class="btn secondary" type="button" id="impNextP"' + ((pg + 1) * per < list.length ? '' : ' disabled') + '>→</button></span></div>' +
      '<div class="coop-form-actions"><button class="btn primary" type="button" id="impGo">' + esc(T('Importer les ', 'Import the ') + num(IMP.prepared.length) + T(' ligne(s)', ' row(s)')) + '</button>' +
      '<button class="btn secondary" type="button" id="impBack">' + esc(T('Classement', 'Classification')) + '</button><span id="impMsg"></span></div>', back);
    box.querySelectorAll('select[data-row]').forEach(function (s) {
      s.onchange = function () { var r = IMP.prepared[Number(s.getAttribute('data-row')) - 1], v = s.value; if (v.indexOf('LINK:') === 0) { r.action = 'LINK'; r.producer_id = v.slice(5); } else { r.action = v; r.producer_id = null; } drawImport(b, c); };
    });
    box.querySelectorAll('input[data-why]').forEach(function (i) { i.oninput = function () { IMP.prepared[Number(i.getAttribute('data-why')) - 1].why = i.value; }; });
    document.getElementById('impFilt').onchange = function () { IMP.filter = this.value; IMP.page = 0; drawImport(b, c); };
    document.getElementById('impPrev').onclick = function () { IMP.page = Math.max(0, pg - 1); drawImport(b, c); };
    document.getElementById('impNextP').onclick = function () { IMP.page = pg + 1; drawImport(b, c); };
    document.getElementById('impErr').onclick = function () { exportRows('Controle_import_' + b.coop.code, IMP.prepared.map(reportRow)); };
    document.getElementById('impBack').onclick = function () { IMP.step = 7; drawImport(b, c); };
    document.getElementById('impGo').onclick = function () {
      var bad = IMP.prepared.filter(function (r) { return r.action === 'CREATE' && r.matches.length && String(r.why || '').trim().length < 10; });
      if (bad.length) return msg('impMsg', T('Ligne(s) ', 'Row(s) ') + bad.slice(0, 10).map(function (r) { return r.idx; }).join(', ') + T(' : motif de création obligatoire (10 caractères min.) malgré la correspondance.', ': creation reason required (10 characters min.) despite the match.'), false);
      commitImport(b, c);
    };
    return;
  }
  if (IMP.step === 9) { box.innerHTML = card(T('Import en cours', 'Import in progress'), T('Ne fermez pas la page. Chaque lot est enregistré dès son envoi.', 'Do not close the page. Each batch is saved as soon as it is sent.'), impSteps() + '<div class="ops-progressline"><div class="ops-progresstrack"><i id="impBar" style="width:0%"></i></div><b id="impPct">0 %</b></div><p id="impMsg" class="muted"></p>'); return; }
  if (IMP.step === 10) {
    var R = IMP.result;
    box.innerHTML = card(T('Rapport d’import', 'Import report'), IMP.file + ' · ' + num(IMP.prepared.length) + ' ' + T('ligne(s) — toutes classées', 'row(s) — all classified'), impSteps() + '<section class="kpi-grid">' +
      Object.keys(IMP_CAT).map(function (k) { return kpi(catLabel(k), num(R[k] || 0), '', IMP_CAT[k][2] === 'ok' ? '' : (R[k] ? 'warn' : '')); }).join('') + '</section>' +
      ((R.A_COMPLETER || R.DOUBLON_A_VERIFIER) ? '<div class="notice info">' + esc(T('Les lignes « À compléter » et « Doublon à vérifier » sont dans la file « À vérifier » de l’onglet Producteurs.', '“To complete” and “Duplicate to review” rows are in the “To review” queue of the Farmers tab.')) + '</div>' : '') +
      '<div class="coop-form-actions"><button class="btn primary" type="button" id="impRep">' + esc(T('Télécharger le rapport ligne à ligne (Excel)', 'Download row-by-row report (Excel)')) + '</button>' +
      '<a class="btn secondary" href="#cooperatives/' + encodeURIComponent(b.coop.id) + '/producers">' + esc(T('Voir les producteurs', 'View farmers')) + '</a>' +
      '<button class="btn secondary" type="button" id="impNew">' + esc(T('Nouvel import', 'New import')) + '</button></div>');
    document.getElementById('impRep').onclick = function () { exportRows('Rapport_import_' + b.coop.code, IMP.prepared.map(reportRow)); };
    document.getElementById('impNew').onclick = function () { IMP = null; refreshFiche(); };
  }
}
function reportRow(r) {
  return { Ligne: r.idx, Nom: r.nom, Prenoms: r.prenoms, Village_fichier: r.village, Village_referentiel: r.village_label || '', Telephone: r.telephone, Member_ID: r.member_number,
    Correspondances: r.matches.map(function (m) { return (m.farmer_id || '?') + ' ' + m.reason + ' ' + m.confidence + '%'; }).join(' | '), Remarques: r.problems.join(' | '),
    Decision: catLabel(ACTION_CAT[r.action]), Motif: r.why || '', Categorie_finale: r.final ? catLabel(r.final) : '', Message: r.message || '', Farmer_ID: r.farmer_id_final || '' };
}
function downloadTemplate(b) {
  loadScript(XLSX_SRC).then(function () {
    var head = IMPORT_FIELDS.map(function (f) { return T(f[1], f[2]); });
    var ex = ['EXEMPLE KOUAME', 'YAO', 'M', '1980', '', '0700000000', '', 'BAOULE', '', 'BROBO', 'Section 1', 'M-0001', '2027-01-15', 'OUI', '2', '2.5', '1500', '1200', '2012', '250', '', '', '', '', ''];
    var ws = global.XLSX.utils.aoa_to_sheet([head, ex]); ws['!cols'] = head.map(function () { return { wch: 20 }; });
    var wb = global.XLSX.utils.book_new(); global.XLSX.utils.book_append_sheet(wb, ws, 'Producteurs');
    var info = global.XLSX.utils.aoa_to_sheet([[T('Consignes', 'Instructions')], [T('Une ligne par producteur. Supprimer la ligne EXEMPLE.', 'One row per farmer. Delete the EXEMPLE row.')],
      [T('Obligatoires : Nom et Village (nom du village du référentiel AFLP).', 'Required: Name and Village (AFLP registry village name).')], [T('Téléphone : 10 chiffres (07…, 05…, 01…).', 'Phone: 10 digits (07…, 05…, 01…).')],
      [T('Âge : année de naissance OU tranche (18-24, 25-34, 35-44, 45-54, 55-64, 65+).', 'Age: birth year OR band (18-24, 25-34, 35-44, 45-54, 55-64, 65+).')],
      [T('Consentement : seulement s’il a réellement été recueilli (méthode VERBAL, WRITTEN, DIGITAL, WITNESSED + date).', 'Consent: only if actually collected (method VERBAL, WRITTEN, DIGITAL, WITNESSED + date).')],
      [T('Ne pas inventer de données : laisser vide ce qui n’est pas connu (NON COLLECTÉ).', 'Do not invent data: leave unknown values empty (NOT RECORDED).')], ['Coop : ' + b.coop.code + ' · ' + b.coop.name]]);
    global.XLSX.utils.book_append_sheet(wb, info, 'Consignes');
    global.XLSX.writeFile(wb, 'Modele_import_producteurs_' + b.coop.code + '.xlsx');
  }).catch(function (e) { alert(e.message); });
}
function readFile(file, b, c) {
  if (!file) return;
  msg('impMsg', T('Lecture du fichier…', 'Reading file…'), null);
  loadScript(XLSX_SRC).then(function () {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var wb = global.XLSX.read(new Uint8Array(fr.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = global.XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
        rows = rows.filter(function (r) { return Object.keys(r).some(function (k) { return String(r[k]).trim() !== ''; }) && !/^EXEMPLE/i.test(String(Object.values(r)[0] || '')); });
        if (!rows.length) return msg('impMsg', T('Aucune ligne exploitable dans la première feuille.', 'No usable row in the first sheet.'), false);
        if (rows.length > 5000) return msg('impMsg', T('Plus de 5 000 lignes : découpez le fichier.', 'More than 5,000 rows: split the file.'), false);
        IMP.rows = rows; IMP.file = file.name; IMP.headers = Object.keys(rows[0]); IMP.map = {}; IMP.vmap = {};
        var guess = { nom: /^(nom|name|last)/, prenoms: /^(prenom|first)/, sexe: /^(sexe|genre|sex)/, birth_year: /(naiss|birth)/, age_band: /(tranche|age band)/,
          telephone_alt: /(tel|phone).*(2|sec|alt)/, telephone: /(tel|phone|contact|cel)/, preferred_language: /(langue|language)/, farmer_id: /(farmer|code ?prod|id ?anagroci)/,
          village: /(village|localit)/, section: /section/, member_number: /(membre|member|matricule|n.?adh)/, membership_start: /(adhes|joined|membership date)/,
          cashew_farmer: /(anacard|cashew)/, plantation_count: /(nombre de plantation|plantation count|nb ?plant)/, total_area_ha: /(superf|surface|area|ha$)/,
          forecast_kg: /(potent|forecast)/, previous_production_kg: /(prec|previous|derniere)/, planting_year: /(annee de plantation|planting)/, tree_count: /(arbre|tree)/,
          home_gps_lat: /(lat)/, home_gps_lng: /(lon|lng)/, consent_method: /(methode cons|consent method)/, consent_at: /(date cons|consent date)/, consent_status: /(consent)/ };
        IMP.headers.forEach(function (h) { var x = norm(h).toLowerCase(); Object.keys(guess).forEach(function (k) { if (!IMP.map[k] && !Object.keys(IMP.map).some(function (z) { return IMP.map[z] === h; }) && guess[k].test(x)) IMP.map[k] = h; }); });
        IMP.step = 3; drawImport(b, c);
      } catch (e) { msg('impMsg', T('Fichier illisible : ', 'Unreadable file: ') + e.message, false); }
    };
    fr.readAsArrayBuffer(file);
  }).catch(function (e) { msg('impMsg', e.message, false); });
}
/* Lecture des lignes : normalisation prudente, aucune valeur inventée. Une valeur
   invalide est retirée (et signalée), jamais remplacée par une autre. */
function prepareRows(b) {
  var secByName = {}; b.sections.forEach(function (s) { if (s.active) secByName[norm(s.name)] = s.id; });
  var yr = new Date().getFullYear(), memberSeen = {};
  function numOrNull(v, problems, label) { if (v === '') return null; var x = Number(String(v).replace(/\s/g, '').replace(',', '.')); if (!isFinite(x) || x < 0) { problems.push(label + T(' invalide (ignoré)', ' invalid (ignored)')); return null; } return x; }
  IMP.prepared = IMP.rows.map(function (raw, i) {
    function g(k) { return IMP.map[k] ? String(raw[IMP.map[k]] == null ? '' : raw[IMP.map[k]]).trim() : ''; }
    var pb = [];
    var r = { idx: i + 1, nom: g('nom').toUpperCase(), prenoms: g('prenoms').toUpperCase(), village: g('village'), member_number: g('member_number'), section: g('section'), problems: pb, matches: [] };
    var sx = g('sexe').toUpperCase().slice(0, 1); r.sexe = sx === 'M' || sx === 'H' ? 'M' : sx === 'F' ? 'F' : null; if (g('sexe') && !r.sexe) pb.push(T('sexe illisible (ignoré)', 'unreadable sex (ignored)'));
    var by = g('birth_year'); if (by) { if (/^(19|20)\d\d$/.test(by) && Number(by) <= yr - 15 && Number(by) >= 1920) r.birth_year = Number(by); else pb.push(T('année de naissance invalide (ignorée)', 'invalid birth year (ignored)')); }
    var band = g('age_band').replace(/\s/g, ''); if (band && !r.birth_year) { if (['18-24', '25-34', '35-44', '45-54', '55-64', '65+'].indexOf(band) >= 0) r.age_band = band; else pb.push(T('tranche d’âge invalide (ignorée)', 'invalid age band (ignored)')); }
    ['telephone', 'telephone_alt'].forEach(function (k) { var t = g(k); if (!t) return; var p = phoneCI(t); if (/^0\d{9}$/.test(p)) r[k] = p; else pb.push((k === 'telephone' ? T('téléphone', 'phone') : T('téléphone secondaire', 'secondary phone')) + T(' invalide (ignoré)', ' invalid (ignored)')); });
    var lg = norm(g('preferred_language')); if (lg) { var map = { FR: 'FR', FRANCAIS: 'FR', FRENCH: 'FR', BAOULE: 'BAOULE', DIOULA: 'DIOULA', SENOUFO: 'SENOUFO' }; r.preferred_language = map[lg] || 'AUTRE'; }
    r.farmer_id = g('farmer_id').toUpperCase() || null;
    if (r.section) { r.section_id = secByName[norm(r.section)] || null; if (!r.section_id) pb.push(T('section inconnue (ignorée)', 'unknown section (ignored)')); }
    var ms = g('membership_start'); if (ms) { var d = new Date(ms); if (!isNaN(d) && d <= new Date()) r.membership_start = d.toISOString().slice(0, 10); else pb.push(T('date d’adhésion invalide (ignorée)', 'invalid membership date (ignored)')); }
    var cf = norm(g('cashew_farmer')); r.cashew_farmer = /^(OUI|YES|O|Y|1)$/.test(cf) ? 'OUI' : /^(NON|NO|N|0)$/.test(cf) ? 'NON' : 'NON_COLLECTE';
    r.plantation_count = numOrNull(g('plantation_count'), pb, T('nombre de plantations', 'plantation count'));
    r.total_area_ha = numOrNull(g('total_area_ha'), pb, T('superficie', 'area')); if (r.total_area_ha === 0) r.total_area_ha = null;
    r.forecast_kg = numOrNull(g('forecast_kg'), pb, T('potentiel', 'potential'));
    r.previous_production_kg = numOrNull(g('previous_production_kg'), pb, T('production précédente', 'previous production'));
    r.tree_count = numOrNull(g('tree_count'), pb, T('nombre d’arbres', 'tree count'));
    var py = g('planting_year'); if (py) { if (/^(19|20)\d\d$/.test(py) && Number(py) <= yr && Number(py) >= 1950) r.planting_year = Number(py); else pb.push(T('année de plantation invalide (ignorée)', 'invalid planting year (ignored)')); }
    var la = g('home_gps_lat'), lo = g('home_gps_lng');
    if (la || lo) { var a = Number(la.replace(',', '.')), o = Number(lo.replace(',', '.')); if (la && lo && isFinite(a) && isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180) { r.home_gps_lat = a; r.home_gps_lng = o; } else pb.push(T('GPS incomplet ou invalide (ignoré)', 'incomplete or invalid GPS (ignored)')); }
    var cs = norm(g('consent_status')), cm = norm(g('consent_method')), ca = g('consent_at');
    if (cs) {
      var st = /^(ACCORDE|GRANTED|OUI|YES)$/.test(cs) ? 'GRANTED' : /^(REFUSE|REFUSED|NON|NO)$/.test(cs) ? 'REFUSED' : null;
      var mth = { VERBAL: 'VERBAL', ORAL: 'VERBAL', WRITTEN: 'WRITTEN', ECRIT: 'WRITTEN', DIGITAL: 'DIGITAL', NUMERIQUE: 'DIGITAL', WITNESSED: 'WITNESSED', TEMOIN: 'WITNESSED' }[cm] || null;
      var dt = ca ? new Date(ca) : null;
      if (st && mth && dt && !isNaN(dt) && dt <= new Date()) r.consent = { status: st, method: mth, consent_at: dt.toISOString().slice(0, 10) };
      else pb.push(T('consentement incomplet (statut, méthode et date requis) : NON RECUEILLI', 'incomplete consent (status, method and date required): NOT RECORDED'));
    }
    if (r.member_number) { var k = norm(r.member_number); if (memberSeen[k]) pb.push(T('Member ID en double dans le fichier', 'Member ID duplicated in file')); memberSeen[k] = 1; }
    return r;
  });
}
function dedupRows(b, c) {
  var coopCode = b.coop.code;
  /* villages validés à l'étape 5 */
  IMP.prepared.forEach(function (r) {
    r.matches = []; r.internalDup = null; r.why = r.why || '';
    r.village_id = IMP.vmap[norm(r.village)] || null; r.village_label = r.village_id && c.vm[r.village_id] ? c.vm[r.village_id].village : '';
    r.check = (!r.nom || !r.village_id) ? 'A_COMPLETER' : 'OK';
  });
  /* doublons internes au fichier : même téléphone, ou même nom + prénoms + village */
  var seenTel = {}, seenName = {};
  IMP.prepared.forEach(function (r) {
    if (r.check !== 'OK') return;
    var kt = r.telephone, kn = norm(r.nom + ' ' + (r.prenoms || '')) + '|' + r.village_id;
    var first = (kt && seenTel[kt]) || seenName[kn];
    if (first) r.internalDup = first; else { if (kt) seenTel[kt] = r.idx; seenName[kn] = r.idx; }
  });
  var payload = IMP.prepared.filter(function (r) { return r.check === 'OK'; }).map(function (r) {
    return { idx: r.idx, farmer_id: r.farmer_id, nom: r.nom, prenoms: r.prenoms, telephone: r.telephone || null, telephone_alt: r.telephone_alt || null, village_id: r.village_id, birth_year: r.birth_year || null };
  });
  var size = 500, batches = []; for (var i = 0; i < payload.length; i += size) batches.push(payload.slice(i, i + size));
  var done = 0;
  batches.reduce(function (p, bt) {
    return p.then(function () {
      return rpc('aflp_coop_match_producers_v2', { p_rows: bt }).then(function (hits) {
        (hits || []).forEach(function (h) { var r = IMP.prepared[h.idx - 1]; if (r && !r.matches.some(function (m) { return (m.producer_id || m.farmer_id) === (h.producer_id || h.farmer_id); })) r.matches.push(h); });
        done += bt.length; var pc = payload.length ? Math.round(done / payload.length * 100) : 100;
        var bar = document.getElementById('impBar'), t = document.getElementById('impPct'); if (bar) bar.style.width = pc + '%'; if (t) t.textContent = pc + ' %';
      });
    });
  }, Promise.resolve()).then(function () {
    /* classement proposé */
    IMP.prepared.forEach(function (r) {
      r.matches.sort(function (a, z) { return z.confidence - a.confidence; });
      var top = r.matches[0];
      if (r.check === 'A_COMPLETER') { r.action = 'COMPLETE'; r.why = !r.nom ? T('nom manquant', 'missing name') : T('village non rattaché au référentiel', 'village not mapped to registry'); return; }
      if (r.internalDup) { r.action = 'REVIEW'; r.why = T('doublon dans le fichier (ligne ', 'duplicate in file (row ') + r.internalDup + ')'; return; }
      if (!top) { r.action = 'CREATE'; return; }
      var linkable = top.producer_id && top.accessible !== false;
      if (linkable && (top.reason === 'FARMER_ID' || top.confidence >= 95 || (top.coop_codes && top.coop_codes.split(', ').indexOf(coopCode) >= 0))) { r.action = 'LINK'; r.producer_id = top.producer_id; return; }
      r.action = 'REVIEW'; r.why = (global.ANAGROCI_COOP_ENROL ? global.ANAGROCI_COOP_ENROL.reasonLabel(top.reason) : top.reason) + ' · ' + top.confidence + ' %' + (linkable ? '' : ' · ' + T('hors périmètre', 'out of scope'));
    });
    IMP.step = 7; drawImport(b, c);
  }).catch(function (e) { msg('impMsg', e.message, false); });
}
function commitImport(b, c) {
  var FIELDS_OUT = ['nom', 'prenoms', 'sexe', 'birth_year', 'age_band', 'telephone', 'telephone_alt', 'preferred_language', 'farmer_id', 'village_id', 'section_id', 'member_number', 'membership_start',
    'cashew_farmer', 'plantation_count', 'total_area_ha', 'forecast_kg', 'previous_production_kg', 'planting_year', 'tree_count', 'home_gps_lat', 'home_gps_lng', 'consent'];
  var rows = IMP.prepared.map(function (r) {
    var x = { idx: r.idx, action: r.action };
    FIELDS_OUT.forEach(function (k) { if (r[k] != null && r[k] !== '') x[k] = r[k]; });
    if (!x.village_id && r.village) x.village = r.village;
    if (r.action === 'LINK') x.producer_id = r.producer_id;
    if (r.action === 'CREATE' && r.matches.length) x.confirm_reason = String(r.why || '').trim();
    if (['SKIP', 'REJECT', 'COMPLETE', 'REVIEW'].indexOf(r.action) >= 0) x.reason = String(r.why || '').trim() || null;
    return x;
  });
  IMP.step = 9; drawImport(b, c);
  /* Finalisation 2027 : lots de 100 (avant 200) — chaque lot reste loin de la limite serveur de 8 s, même pour
     un village de plus de 1 000 membres (mesures : 2,2 à 6,4 s par lot de 200 dans le pire cas). */
  var size = 100, done = 0, agg = {}, batchId = null;
  Object.keys(IMP_CAT).forEach(function (k) { agg[k] = 0; });
  var batches = []; for (var i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size));
  batches.reduce(function (p, bt, bi) {
    return p.then(function () {
      return rpc('aflp_coop_import_rows', { p_coop: b.coop.id, p_campaign: CAMPAIGN, p_batch: batchId, p_file: IMP.file, p_total: rows.length, p_rows: bt, p_final: bi === batches.length - 1 }).then(function (r) {
        batchId = r.batch_id;
        (r.details || []).forEach(function (d) {
          var row = IMP.prepared[Number(d.idx) - 1]; if (!row) return;
          row.final = d.statut; row.message = d.message || ''; row.farmer_id_final = d.farmer_id || '';
          agg[d.statut] = (agg[d.statut] || 0) + 1;
        });
        done += bt.length; var pc = Math.round(done / rows.length * 100);
        var bar = document.getElementById('impBar'), t = document.getElementById('impPct'); if (bar) bar.style.width = pc + '%'; if (t) t.textContent = pc + ' % · ' + num(done) + ' / ' + num(rows.length);
      });
    });
  }, Promise.resolve()).then(function () {
    IMP.result = agg; IMP.step = 10; invalidate('coop:' + b.coop.id, 'agg:' + b.coop.id, 'dash'); drawImport(b, c);
  }).catch(function (e) { msg('impMsg', T('Import interrompu : ', 'Import interrupted: ') + e.message + ' — ' + T('les lots déjà envoyés sont enregistrés (historique des imports) ; relancez le fichier : les lignes déjà importées seront reconnues comme existantes.', 'batches already sent are saved (import history); rerun the file: already imported rows will be recognised as existing.'), false); });
}
function exportRows(name, rows) {
  loadScript(XLSX_SRC).then(function () {
    var wb = global.XLSX.utils.book_new(), ws = global.XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: T('Aucune donnée', 'No data') }]);
    global.XLSX.utils.book_append_sheet(wb, ws, 'Data'); global.XLSX.writeFile(wb, name + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }).catch(function (e) { alert(e.message); });
}

/* -------------------------------------------------------- 3. Villages & Sections */
function memberAgg(coopId) {
  /* Agrégats par village / section, sur l'ensemble des membres ouverts (pagination serveur 1000). */
  return cached('agg:' + coopId, 20000, function () {
    function page(from, acc) {
      return q('aflp_coop_members_v', 'membership_id,producer_id,village_id,village_nom,section_id,area_ha,potential_kg,verified,is_primary,sexe,birth_year,age_band,consent_status,passport_stage,gps_plots,plot_count,telephone,completeness_pct,missing_fields',
        function (r) { return r.eq('cooperative_id', coopId).eq('campaign', CAMPAIGN).neq('status', 'ENDED').range(from, from + 999); })
        .then(function (rows) { acc = acc.concat(rows); return rows.length === 1000 ? page(from + 1000, acc) : acc; });
    }
    return Promise.all([page(0, []), q('achats', 'id,producteur_id,village_id,poids_net,date,coop_section_id,rejet', function (r) { return r.eq('cooperative_id', coopId).limit(5000); }).catch(function () { return []; })])
      .then(function (rs) { return { members: rs[0], buys: rs[1].filter(function (a) { return !a.rejet; }) }; });
  });
}
TAB_RENDER.villages = function () { return '<div id="vsBox">' + skeleton() + '</div>'; };
TAB_AFTER.villages = function (b, c) {
  memberAgg(b.coop.id).then(function (A) {
    var byV = {}, byS = {};
    A.members.forEach(function (m) {
      var k = m.village_id || '—'; var v = byV[k] = byV[k] || { n: 0, area: 0, pot: 0, potKnown: 0 }; v.n++; v.area += n(m.area_ha); if (has(m.potential_kg)) { v.pot += n(m.potential_kg); v.potKnown++; }
      var s = byS[m.section_id || '—'] = byS[m.section_id || '—'] || { n: 0 }; s.n++;
    });
    var buyV = {}; A.buys.forEach(function (a) { buyV[a.village_id] = (buyV[a.village_id] || 0) + n(a.poids_net); });
    var act = b.villages.filter(function (v) { return v.active; });
    function vRow(v) {
      var x = c.vm[v.village_id] || {}, s = byV[v.village_id] || { n: 0, area: 0, pot: 0, potKnown: 0 };
      return '<div class="coop-tree-row"><div><b>' + esc(x.village || v.village_name || '—') + '</b>' + (v.village_id ? '' : ' ' + badge(T('hors référentiel', 'not in registry'), 'warn')) +
        '<small>' + esc(T('Déclarés : ', 'Declared: ') + (has(v.declared_producers) ? num(v.declared_producers) : '—') + (v.leader_name ? ' · ' + T('Resp. ', 'Lead ') + v.leader_name : '')) + '</small></div>' +
        '<div><small>' + esc(T('Producteurs', 'Farmers')) + '</small>' + num(s.n) + '</div><div><small>' + esc(T('Superficie', 'Area')) + '</small>' + (s.area ? num(s.area, 1) + ' ha' : na()) + '</div>' +
        '<div><small>' + esc(T('Potentiel', 'Potential')) + '</small>' + (s.potKnown ? mt(s.pot) : na()) + '</div><div><small>' + esc(T('Acheté', 'Purchased')) + '</small>' + mt(buyV[v.village_id] || 0) + '</div>' +
        (edit ? '<div class="coop-row-acts">' + (v.active
          ? '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.editVillage(\'' + v.id + '\')">' + esc(T('Modifier', 'Edit')) + '</button><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.toggleRow(\'aflp_coop_villages\',\'' + v.id + '\',false)">' + esc(T('Retirer', 'Remove')) + '</button>'
          : '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.toggleRow(\'aflp_coop_villages\',\'' + v.id + '\',true)">' + esc(T('Réactiver', 'Reactivate')) + '</button>') + '</div>' : '') + '</div>';
    }
    var edit = canEdit() && !b.coop.archived;
    var tree = b.sections.filter(function (s) { return s.active; }).map(function (s) {
      var vs = act.filter(function (v) { return v.section_id === s.id; });
      return '<div class="coop-tree-section"><h3>' + esc(s.name) + (s.code ? ' <span class="coop-code">' + esc(s.code) + '</span>' : '') + ' · ' + num((byS[s.id] || {}).n || 0) + ' ' + esc(T('producteurs', 'farmers')) +
        (edit ? ' <span class="coop-row-acts"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.editSection(\'' + s.id + '\')">' + esc(T('Modifier', 'Edit')) + '</button><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.toggleRow(\'aflp_coop_sections\',\'' + s.id + '\',false)">' + esc(T('Désactiver', 'Deactivate')) + '</button></span>' : '') + '</h3>' +
        (s.leader_name ? '<p class="muted" style="margin:0 0 6px;font-size:11px">' + esc(T('Responsable : ', 'Leader: ') + s.leader_name) + '</p>' : '') + (vs.length ? vs.map(vRow).join('') : '<div class="ops-empty">' + esc(T('Aucun village rattaché à cette section.', 'No village attached to this section.')) + '</div>') + '</div>';
    }).join('');
    var loose = act.filter(function (v) { return !v.section_id; });
    if (loose.length) tree += '<div class="coop-tree-section"><h3>' + esc(T('Villages sans section', 'Villages without section')) + '</h3>' + loose.map(vRow).join('') + '</div>';
    /* Historique conservé : sections, villages et points désactivés restent visibles et réactivables. */
    var offS = b.sections.filter(function (x) { return !x.active; }), offV = b.villages.filter(function (x) { return !x.active; }), offP = b.points.filter(function (x) { return !x.active; });
    var hist = (offS.length || offV.length || offP.length) ? '<details class="coop-history"><summary>' + esc(T('Éléments retirés ou désactivés (historique)', 'Removed or deactivated items (history)')) + ' · ' + (offS.length + offV.length + offP.length) + '</summary>' +
      offS.map(function (x) { return '<div class="coop-tree-row off"><div><b>' + esc(T('Section', 'Section') + ' ' + x.name) + '</b><small>' + esc(T('désactivée', 'deactivated')) + '</small></div>' + (edit ? '<div class="coop-row-acts"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.toggleRow(\'aflp_coop_sections\',\'' + x.id + '\',true)">' + esc(T('Réactiver', 'Reactivate')) + '</button></div>' : '') + '</div>'; }).join('') +
      offV.map(vRow).join('') +
      offP.map(function (x) { return '<div class="coop-tree-row off"><div><b>' + esc(T('Point', 'Point') + ' ' + x.name) + '</b><small>' + esc(T('désactivé', 'deactivated')) + '</small></div>' + (edit ? '<div class="coop-row-acts"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.toggleRow(\'aflp_coop_collection_points\',\'' + x.id + '\',true)">' + esc(T('Réactiver', 'Reactivate')) + '</button></div>' : '') + '</div>'; }).join('') + '</details>' : '';
    tree += hist;
    document.getElementById('vsBox').innerHTML = '<div class="grid-2">' +
      card(T('Coopérative → Sections → Villages', 'Cooperative → Sections → Villages'), T('Les sections sont facultatives ; une coopérative couvre autant de villages que nécessaire.', 'Sections are optional; a cooperative covers as many villages as needed.'),
        '<div class="coop-tree">' + (tree || '<div class="ops-empty">' + esc(T('Aucun village couvert pour le moment.', 'No village covered yet.')) + '</div>') + '</div>',
        edit ? '<button class="btn primary" type="button" onclick="ANAGROCI_COOP.addVillage()">+ ' + esc(T('Village', 'Village')) + '</button><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.addSection()">+ ' + esc(T('Section', 'Section')) + '</button>' : '') +
      card(T('Carte', 'Map'), T('Siège, villages et points de collecte.', 'Head office, villages and collection points.'), '<div id="coopMap" class="coop-map"></div>') + '</div>' +
      card(T('Points de collecte', 'Collection points'), '', table([T('Point', 'Point'), T('Village', 'Village'), 'GPS', T('Capacité', 'Capacity'), T('Responsable', 'Manager'), T('Entrepôt destination', 'Destination warehouse'), ''],
        b.points.filter(function (p) { return p.active; }).map(function (p) {
          var w = c.warehouses.filter(function (x) { return x.id === p.destination_warehouse_id; })[0];
          return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc((c.vm[p.village_id] || {}).village || p.village_name || '—') + '</td><td>' + (has(p.gps_lat) ? num(p.gps_lat, 5) + ', ' + num(p.gps_lng, 5) : na()) + '</td>' +
            '<td>' + (has(p.capacity_mt) ? num(p.capacity_mt, 1) + ' MT' : na()) + '</td><td>' + val(p.manager_name) + (p.manager_phone ? '<br><small class="muted">' + esc(maskPhone(p.manager_phone)) + '</small>' : '') + '</td><td>' + esc(w ? w.code : '—') + '</td>' +
            '<td>' + (edit ? '<div class="coop-actions-cell"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.editPoint(\'' + p.id + '\')">' + esc(T('Modifier', 'Edit')) + '</button><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.toggleRow(\'aflp_coop_collection_points\',\'' + p.id + '\',false)">' + esc(T('Désactiver', 'Deactivate')) + '</button></div>' : '') + '</td></tr>';
        }), T('Aucun point de collecte déclaré.', 'No collection point declared.')), edit ? '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.addPoint()">+ ' + esc(T('Point de collecte', 'Collection point')) + '</button>' : '');
    drawMap(b, c);
  }).catch(function (e) { document.getElementById('vsBox').innerHTML = errBox(e); });
};
function simpleForm(title, sub, fieldsHtml, onSave) {
  var h = host(); if (!h) return;
  h.innerHTML = '<section class="card ops-form-card"><div class="card-head"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div></div>' +
    '<form id="sfForm" class="coop-form" novalidate>' + fieldsHtml + '</form><div class="coop-form-actions"><button class="btn primary" type="button" id="sfGo">' + esc(T('Enregistrer', 'Save')) + '</button>' +
    '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.closeHost()">' + esc(T('Annuler', 'Cancel')) + '</button><span id="sfMsg"></span></div></section>';
  document.getElementById('sfGo').onclick = function () {
    var d = formData(document.getElementById('sfForm')), btn = this; btn.disabled = true; msg('sfMsg', T('Enregistrement…', 'Saving…'), null);
    Promise.resolve().then(function () { return onSave(d); }).then(function () { toast(T('Enregistré.', 'Saved.')); refreshFiche(); })
      .catch(function (e) { btn.disabled = false; msg('sfMsg', e.message, false); });
  };
}
function insertRow(tableName, row) { return client().then(function (cl) { return cl.from(tableName).insert(row).then(function (r) { if (r.error) throw new Error(r.error.message); }); }); }
function updateRow(tableName, id, patch) { return client().then(function (cl) { return cl.from(tableName).update(patch).eq('id', id).then(function (r) { if (r.error) throw new Error(r.error.message); }); }); }

/* Finalisation 2027 : modification sûre de la structure. Verrou optimiste par updated_at : si quelqu'un a modifié
   la ligne entre la lecture et l'enregistrement, aucune ligne n'est mise à jour et l'utilisateur est prévenu
   (jamais d'écrasement silencieux). Chaque modification est journalisée côté serveur (avant / après, auteur). */
var CONFLIT = ['Cette fiche a été modifiée par un autre utilisateur. Rechargez les données avant d’enregistrer.', 'This record was changed by another user. Reload the data before saving.'];
function updateSafe(tableName, row, patch) {
  return client().then(function (cl) {
    var r = cl.from(tableName).update(patch).eq('id', row.id);
    if (row.updated_at) r = r.eq('updated_at', row.updated_at);
    return r.select('id').then(function (x) {
      if (x.error) throw new Error(x.error.message);
      if (!x.data || !x.data.length) throw new Error(T(CONFLIT[0], CONFLIT[1]));
    });
  });
}
function findIn(b, key, id) { return (b[key] || []).filter(function (x) { return x.id === id; })[0]; }
var TABLE_KEY = { aflp_coop_villages: 'villages', aflp_coop_sections: 'sections', aflp_coop_collection_points: 'points', aflp_coop_contacts: 'contacts' };
function toggleRow(tableName, id, active) {
  var cid = currentCoopId();
  bundle(cid).then(function (b) {
    var row = findIn(b, TABLE_KEY[tableName], id); if (!row) return;
    if (!active && !confirm(T('Désactiver cet élément ? Il reste dans l’historique et pourra être réactivé.', 'Deactivate this item? It stays in history and can be reactivated.'))) return;
    var patch = { active: !!active };
    if (tableName === 'aflp_coop_contacts') patch.end_date = active ? null : new Date().toISOString().slice(0, 10);
    return updateSafe(tableName, row, patch).then(function () { toast(active ? T('Réactivé.', 'Reactivated.') : T('Désactivé (historique conservé).', 'Deactivated (history kept).')); refreshFiche(); });
  }).catch(function (e) { alert(e.message); });
}
function sectionOpts(b, cur) { return '<option value="">—</option>' + b.sections.filter(function (s) { return s.active || s.id === cur; }).map(function (s) { return '<option value="' + s.id + '"' + (s.id === cur ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join(''); }
function pointOpts(b, cur) { return '<option value="">—</option>' + b.points.filter(function (p) { return p.active || p.id === cur; }).map(function (p) { return '<option value="' + p.id + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join(''); }
function whOpts(c, cur) { return '<option value="">—</option>' + c.warehouses.map(function (w) { return '<option value="' + w.id + '"' + (w.id === cur ? ' selected' : '') + '>' + esc(w.code + ' · ' + (w.name || '')) + '</option>'; }).join(''); }
function numOrNullV(v) { return v === '' || v == null ? null : Number(v); }
function editVillage(id) {
  var cid = currentCoopId();
  Promise.all([bundle(cid), refs()]).then(function (rs) {
    var b = rs[0], c = rs[1], v = findIn(b, 'villages', id); if (!v) return;
    var x = c.vm[v.village_id] || {};
    simpleForm(T('Modifier le village couvert', 'Edit covered village') + ' — ' + (x.village || v.village_name || ''), T('Le village du référentiel ne se change pas ici : retirez-le puis ajoutez le bon village (l’historique est conservé).', 'The registry village is not changed here: remove it and add the right one (history is kept).'),
      selectField(T('Section', 'Section'), 'section_id', sectionOpts(b, v.section_id)) +
      field(T('Producteurs déclarés', 'Declared farmers'), 'declared_producers', v.declared_producers, 'type="number" min="0"') +
      field(T('Potentiel déclaré (MT)', 'Declared potential (MT)'), 'declared_potential_mt', v.declared_potential_mt, 'type="number" min="0" step="0.1"') +
      field(T('Responsable local', 'Local leader'), 'leader_name', v.leader_name) +
      selectField(T('Point de collecte', 'Collection point'), 'collection_point_id', pointOpts(b, v.collection_point_id)) +
      field(T('Observations', 'Notes'), 'notes', v.notes, 'maxlength="500"', 'span-3'),
      function (d) {
        return updateSafe('aflp_coop_villages', v, { section_id: d.section_id || null, declared_producers: numOrNullV(d.declared_producers), declared_potential_mt: numOrNullV(d.declared_potential_mt),
          leader_name: d.leader_name || null, collection_point_id: d.collection_point_id || null, notes: d.notes || null });
      });
  }).catch(function (e) { alert(e.message); });
}
function editSection(id) {
  var cid = currentCoopId();
  bundle(cid).then(function (b) {
    var s = findIn(b, 'sections', id); if (!s) return;
    simpleForm(T('Modifier / renommer la section', 'Edit / rename section'), '',
      field(T('Nom *', 'Name *'), 'name', s.name, 'maxlength="80"') + field('Code', 'code', s.code, 'maxlength="20"') +
      field(T('Responsable', 'Leader'), 'leader_name', s.leader_name) + field(T('Téléphone responsable', 'Leader phone'), 'leader_phone', s.leader_phone, 'inputmode="tel"') +
      selectField(T('Point de collecte', 'Collection point'), 'collection_point_id', pointOpts(b, s.collection_point_id)) +
      field(T('Observations', 'Notes'), 'notes', s.notes, 'maxlength="500"', 'span-3'),
      function (d) {
        if (!d.name) throw new Error(T('Nom obligatoire.', 'Name required.'));
        if (d.leader_phone) { d.leader_phone = phoneCI(d.leader_phone); if (!/^0\d{9}$/.test(d.leader_phone)) throw new Error(T('Téléphone : 10 chiffres.', 'Phone: 10 digits.')); }
        return updateSafe('aflp_coop_sections', s, { name: d.name, code: d.code || null, leader_name: d.leader_name || null, leader_phone: d.leader_phone || null,
          collection_point_id: d.collection_point_id || null, notes: d.notes || null });
      });
  }).catch(function (e) { alert(e.message); });
}
function editPoint(id) {
  var cid = currentCoopId();
  Promise.all([bundle(cid), refs()]).then(function (rs) {
    var b = rs[0], c = rs[1], p = findIn(b, 'points', id); if (!p) return;
    simpleForm(T('Modifier le point de collecte', 'Edit collection point'), '',
      field(T('Nom *', 'Name *'), 'name', p.name) +
      selectField(T('Village', 'Village'), 'village_id', '<option value="">—</option>' + c.villages.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === p.village_id ? ' selected' : '') + '>' + esc(v.village) + '</option>'; }).join('')) +
      field(T('Latitude', 'Latitude'), 'gps_lat', p.gps_lat, 'type="number" step="0.000001" min="-90" max="90"') + field(T('Longitude', 'Longitude'), 'gps_lng', p.gps_lng, 'type="number" step="0.000001" min="-180" max="180"') +
      '<label>&nbsp;<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.gps(\'sfForm\')">' + esc(T('Capter ma position', 'Use my position')) + '</button></label>' +
      field(T('Capacité (MT)', 'Capacity (MT)'), 'capacity_mt', p.capacity_mt, 'type="number" min="0" step="0.1"') + field(T('Responsable', 'Manager'), 'manager_name', p.manager_name) +
      field(T('Téléphone responsable', 'Manager phone'), 'manager_phone', p.manager_phone, 'inputmode="tel"') +
      selectField(T('Entrepôt destination', 'Destination warehouse'), 'destination_warehouse_id', whOpts(c, p.destination_warehouse_id)) +
      field(T('Observations', 'Notes'), 'notes', p.notes, 'maxlength="500"', 'span-3'),
      function (d) {
        if (!d.name) throw new Error(T('Nom obligatoire.', 'Name required.'));
        if (d.manager_phone) { d.manager_phone = phoneCI(d.manager_phone); if (!/^0\d{9}$/.test(d.manager_phone)) throw new Error(T('Téléphone : 10 chiffres.', 'Phone: 10 digits.')); }
        return updateSafe('aflp_coop_collection_points', p, { name: d.name, village_id: d.village_id || null, gps_lat: numOrNullV(d.gps_lat), gps_lng: numOrNullV(d.gps_lng),
          capacity_mt: numOrNullV(d.capacity_mt), manager_name: d.manager_name || null, manager_phone: d.manager_phone || null,
          destination_warehouse_id: d.destination_warehouse_id || null, notes: d.notes || null });
      });
  }).catch(function (e) { alert(e.message); });
}
function editContact(id) {
  var cid = currentCoopId();
  bundle(cid).then(function (b) {
    var x = findIn(b, 'contacts', id); if (!x) return;
    simpleForm(T('Modifier le responsable', 'Edit officer'), T('Un responsable de coopérative reste un contact : il ne devient jamais RT et n’a pas accès à l’application.', 'A cooperative officer stays a contact: never an RT, no application access.'),
      selectField(T('Fonction *', 'Role *'), 'role', opts('contact', x.role)) + field(T('Nom complet *', 'Full name *'), 'full_name', x.full_name, 'maxlength="120"') +
      field(T('Téléphone', 'Phone'), 'phone', x.phone, 'inputmode="tel"') + field('Email', 'email', x.email, 'type="email"') +
      selectField(T('Section', 'Section'), 'section_id', sectionOpts(b, x.section_id)) +
      field(T('Début de fonction', 'Start date'), 'start_date', x.start_date, 'type="date"') + field(T('Fin de fonction', 'End date'), 'end_date', x.end_date, 'type="date"') +
      '<label class="coop-check"><input type="checkbox" name="is_primary"' + (x.is_primary ? ' checked' : '') + '> ' + esc(T('Contact principal', 'Main contact')) + '</label>',
      function (d) {
        if (!d.full_name) throw new Error(T('Nom obligatoire.', 'Name required.'));
        if (d.phone) { d.phone = phoneCI(d.phone); if (!/^0\d{9}$/.test(d.phone)) throw new Error(T('Téléphone : 10 chiffres.', 'Phone: 10 digits.')); }
        if (d.start_date && d.end_date && d.end_date < d.start_date) throw new Error(T('La date de fin doit être postérieure à la date de début.', 'End date must be after start date.'));
        return updateSafe('aflp_coop_contacts', x, { role: d.role, full_name: d.full_name.toUpperCase(), phone: d.phone || null, email: d.email || null, section_id: d.section_id || null,
          start_date: d.start_date || null, end_date: d.end_date || null, is_primary: !!d.is_primary, active: d.end_date ? d.end_date > new Date().toISOString().slice(0, 10) : x.active });
      });
  }).catch(function (e) { alert(e.message); });
}
var MEMBER_STATUS_EDIT = ['ACTIVE', 'PENDING', 'SUSPENDED'];
function editMember(mid) {
  var cid = currentCoopId();
  Promise.all([bundle(cid), refs(), q('aflp_coop_memberships', '*', function (r) { return r.eq('id', mid).limit(1); })]).then(function (rs) {
    var b = rs[0], c = rs[1], m = rs[2][0]; if (!m) throw new Error(T('Affiliation introuvable.', 'Membership not found.'));
    var vids = {}; b.villages.forEach(function (v) { if (v.village_id) vids[v.village_id] = 1; });
    var rts = c.rts.filter(function (r) { return vids[r.village_id] || r.id === m.followup_rt_id; });
    if (!rts.length) rts = c.rts;
    simpleForm(T('Modifier l’affiliation', 'Edit membership'), T('Le Farmer ID ne change jamais. Pour changer de coopérative, utilisez « Changer de coop. » (l’ancienne affiliation est clôturée et conservée).',
        'The Farmer ID never changes. To change cooperative, use “Change coop.” (the previous membership is closed and kept).'),
      field('Member ID', 'member_number', m.member_number, 'maxlength="40"') +
      selectField(T('Section', 'Section'), 'section_id', sectionOpts(b, m.section_id)) +
      selectField(T('RT de suivi (contrôle de caisse en mode A)', 'Follow-up RT (cash control in mode A)'), 'followup_rt_id', '<option value="">—</option>' + rts.map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === m.followup_rt_id ? ' selected' : '') + '>' + esc((r.id_rt || r.id) + ' · ' + r.nom) + '</option>'; }).join(''), 'span-2') +
      selectField(T('Statut d’adhésion', 'Membership status'), 'status', MEMBER_STATUS_EDIT.map(function (k) { return '<option value="' + k + '"' + (k === m.status ? ' selected' : '') + '>' + esc(L('memberStatus', k)) + '</option>'; }).join('')) +
      field(T('Observations', 'Notes'), 'notes', m.notes, 'maxlength="500"', 'span-3'),
      function (d) {
        return updateSafe('aflp_coop_memberships', m, { member_number: d.member_number || null, section_id: d.section_id || null, followup_rt_id: d.followup_rt_id || null,
          status: d.status, notes: d.notes || null });
      });
  }).catch(function (e) { alert(e.message); });
}
function addVillage() {
  var id = currentCoopId();
  Promise.all([bundle(id), refs()]).then(function (rs) {
    var b = rs[0], c = rs[1], used = {}; b.villages.forEach(function (v) { if (v.active && v.village_id) used[v.village_id] = 1; });
    simpleForm(T('Ajouter un village couvert', 'Add a covered village'), T('Choisissez un village du référentiel AFLP ; à défaut, saisissez la localité (elle restera signalée « hors référentiel »).', 'Pick an AFLP registry village; otherwise type the locality (it will stay flagged “not in registry”).'),
      selectField(T('Village du référentiel', 'Registry village'), 'village_id', '<option value="">—</option>' + c.villages.filter(function (v) { return !used[v.id]; }).map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.village + ' · ' + (v.cluster || '')) + '</option>'; }).join(''), 'span-2') +
      field(T('ou localité hors référentiel', 'or locality not in registry'), 'village_name', '') +
      selectField(T('Section', 'Section'), 'section_id', '<option value="">—</option>' + b.sections.filter(function (s) { return s.active; }).map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('')) +
      field(T('Producteurs déclarés', 'Declared farmers'), 'declared_producers', '', 'type="number" min="0"') + field(T('Potentiel déclaré (MT)', 'Declared potential (MT)'), 'declared_potential_mt', '', 'type="number" min="0" step="0.1"') +
      field(T('Responsable local', 'Local leader'), 'leader_name', '') +
      selectField(T('Point de collecte', 'Collection point'), 'collection_point_id', '<option value="">—</option>' + b.points.filter(function (p) { return p.active; }).map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('')),
      function (d) {
        if (!d.village_id && !d.village_name) throw new Error(T('Village obligatoire (référentiel ou localité).', 'Village required (registry or locality).'));
        return insertRow('aflp_coop_villages', { cooperative_id: id, village_id: d.village_id || null, village_name: d.village_id ? null : d.village_name, section_id: d.section_id || null,
          declared_producers: d.declared_producers || null, declared_potential_mt: d.declared_potential_mt || null, leader_name: d.leader_name || null, collection_point_id: d.collection_point_id || null });
      });
  });
}
function addSection() {
  var id = currentCoopId();
  simpleForm(T('Ajouter une section', 'Add a section'), T('Exemple : Section Brobo, Section Takikro.', 'Example: Brobo section, Takikro section.'),
    field(T('Nom *', 'Name *'), 'name', '', 'maxlength="80"') + field('Code', 'code', '', 'maxlength="20"') + field(T('Responsable', 'Leader'), 'leader_name', '') + field(T('Téléphone responsable', 'Leader phone'), 'leader_phone', '', 'inputmode="tel"'),
    function (d) {
      if (!d.name) throw new Error(T('Nom obligatoire.', 'Name required.'));
      if (d.leader_phone) { d.leader_phone = phoneCI(d.leader_phone); if (!/^0\d{9}$/.test(d.leader_phone)) throw new Error(T('Téléphone : 10 chiffres.', 'Phone: 10 digits.')); }
      return insertRow('aflp_coop_sections', { cooperative_id: id, name: d.name, code: d.code || null, leader_name: d.leader_name || null, leader_phone: d.leader_phone || null });
    });
}
function addPoint() {
  var id = currentCoopId();
  refs().then(function (c) {
    simpleForm(T('Ajouter un point de collecte', 'Add a collection point'), '',
      field(T('Nom *', 'Name *'), 'name', '') + selectField(T('Village', 'Village'), 'village_id', '<option value="">—</option>' + c.villages.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.village) + '</option>'; }).join('')) +
      field(T('Latitude', 'Latitude'), 'gps_lat', '', 'type="number" step="0.000001"') + field(T('Longitude', 'Longitude'), 'gps_lng', '', 'type="number" step="0.000001"') +
      '<label>&nbsp;<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.gps(\'sfForm\')">' + esc(T('Capter ma position', 'Use my position')) + '</button></label>' +
      field(T('Capacité (MT)', 'Capacity (MT)'), 'capacity_mt', '', 'type="number" min="0" step="0.1"') + field(T('Responsable', 'Manager'), 'manager_name', '') +
      selectField(T('Entrepôt destination', 'Destination warehouse'), 'destination_warehouse_id', '<option value="">—</option>' + c.warehouses.map(function (w) { return '<option value="' + w.id + '">' + esc(w.code + ' · ' + (w.name || '')) + '</option>'; }).join('')),
      function (d) {
        if (!d.name) throw new Error(T('Nom obligatoire.', 'Name required.'));
        return insertRow('aflp_coop_collection_points', { cooperative_id: id, name: d.name, village_id: d.village_id || null, gps_lat: d.gps_lat || null, gps_lng: d.gps_lng || null,
          capacity_mt: d.capacity_mt || null, manager_name: d.manager_name || null, destination_warehouse_id: d.destination_warehouse_id || null });
      });
  });
}

/* ------------------------------------------------------------------- 4. Responsables */
TAB_RENDER.contacts = function (b, c) {
  var cc = b.campaign || {}, rt = c.rm[cc.referent_rt_id], edit = canEdit() && !b.coop.archived;
  return '<div class="notice info">' + esc(T('Les responsables de la coopérative sont des contacts : ils ne deviennent jamais des RT et n’ont aucun accès à l’application.', 'Cooperative officers are contacts: they never become RTs and have no access to the application.')) + '</div>' +
    card(T('Responsables de la coopérative', 'Cooperative officers'), '', table([T('Fonction', 'Role'), T('Nom', 'Name'), T('Téléphone', 'Phone'), 'Email', T('Section', 'Section'), T('Période', 'Period'), T('Statut', 'Status'), ''],
      b.contacts.map(function (x) {
        var s = b.sections.filter(function (z) { return z.id === x.section_id; })[0];
        return '<tr><td>' + esc(L('contact', x.role)) + (x.is_primary ? ' ' + badge(T('principal', 'main'), 'ok') : '') + '</td><td><b>' + esc(x.full_name) + '</b></td><td>' + val(x.phone) + '</td><td>' + val(x.email) + '</td>' +
          '<td>' + esc(s ? s.name : '—') + '</td><td>' + (x.start_date || x.end_date ? esc((x.start_date ? date(x.start_date) : '…') + ' → ' + (x.end_date ? date(x.end_date) : T('en cours', 'ongoing'))) : na()) + '</td>' +
          '<td>' + badge(x.active ? T('Actif', 'Active') : T('Inactif', 'Inactive'), x.active ? 'ok' : 'info') + '</td>' +
          '<td>' + (edit ? '<div class="coop-actions-cell"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.editContact(\'' + x.id + '\')">' + esc(T('Modifier', 'Edit')) + '</button>' +
            (x.active ? '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.deactivateContact(\'' + x.id + '\')">' + esc(T('Désactiver', 'Deactivate')) + '</button>' : '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.toggleRow(\'aflp_coop_contacts\',\'' + x.id + '\',true)">' + esc(T('Réactiver', 'Reactivate')) + '</button>') + '</div>' : '') + '</td></tr>';
      }), T('Aucun responsable enregistré (président à compléter).', 'No officer recorded (president to complete).')),
      edit ? '<button class="btn primary" type="button" onclick="ANAGROCI_COOP.addContact()">+ ' + esc(T('Responsable', 'Officer')) + '</button>' : '') +
    card(T('Encadrement AFLP', 'AFLP supervision'), T('Référents ANAGROCI de la coopérative pour la campagne.', 'ANAGROCI referents for this cooperative during the campaign.'),
      defGrid([[T('Chef de Zone', 'Zone Head'), cc.zone_head_name], [T('Chef d’Unité', 'Unit Head'), cc.unit_head_name], [T('RT de suivi', 'Follow-up RT'), rt ? (rt.id_rt || rt.id) + ' · ' + rt.nom : null]]),
      edit ? '<a class="btn secondary" href="#cooperatives/' + encodeURIComponent(b.coop.id) + '/edit">' + esc(T('Modifier', 'Edit')) + '</a>' : '');
};
function addContact() {
  var id = currentCoopId();
  bundle(id).then(function (b) {
    simpleForm(T('Ajouter un responsable', 'Add an officer'), '', selectField(T('Fonction *', 'Role *'), 'role', opts('contact', 'SECRETAIRE')) + field(T('Nom complet *', 'Full name *'), 'full_name', '', 'maxlength="120"') +
      field(T('Téléphone', 'Phone'), 'phone', '', 'inputmode="tel"') + field('Email', 'email', '', 'type="email"') +
      selectField(T('Section', 'Section'), 'section_id', '<option value="">—</option>' + b.sections.filter(function (s) { return s.active; }).map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('')) +
      field(T('Début de fonction', 'Start date'), 'start_date', '', 'type="date"'),
      function (d) {
        if (!d.full_name) throw new Error(T('Nom obligatoire.', 'Name required.'));
        if (d.phone) { d.phone = phoneCI(d.phone); if (!/^0\d{9}$/.test(d.phone)) throw new Error(T('Téléphone : 10 chiffres.', 'Phone: 10 digits.')); }
        return insertRow('aflp_coop_contacts', { cooperative_id: id, role: d.role, full_name: d.full_name.toUpperCase(), phone: d.phone || null, email: d.email || null, section_id: d.section_id || null, start_date: d.start_date || null });
      });
  });
}
function deactivateContact(cid) { toggleRow('aflp_coop_contacts', cid, false); }

/* -------------------------------------------------------- 5. Production & Potentiel */
TAB_RENDER.potential = function () { return '<div id="ppBox">' + skeleton() + '</div>'; };
TAB_AFTER.potential = function (b) {
  memberAgg(b.coop.id).then(function (A) {
    var cc = b.campaign || {}, s = b.stats, m = A.members;
    var potKnown = m.filter(function (x) { return has(x.potential_kg); }), area = m.filter(function (x) { return has(x.area_ha); });
    var pot = potKnown.reduce(function (t, x) { return t + n(x.potential_kg); }, 0), bought = n(s.purchased_kg);
    var target = n(cc.target_mt) * 1000;
    document.getElementById('ppBox').innerHTML = '<section class="kpi-grid">' +
      kpi(T('Producteurs', 'Farmers'), num(m.length), T('affiliations ouvertes (chaque producteur une fois)', 'open memberships (each farmer once)')) +
      kpi(T('Superficie', 'Area'), area.length ? num(area.reduce(function (t, x) { return t + n(x.area_ha); }, 0), 1) + ' ha' : na(), num(m.length - area.length) + ' ' + T('non collectée(s)', 'not recorded')) +
      kpi(T('Potentiel déclaré coopérative', 'Cooperative declared potential'), has(cc.declared_potential_mt) ? num(cc.declared_potential_mt, 1) + ' MT' : na(), T('déclaration de la coopérative', 'cooperative statement')) +
      kpi(T('Potentiel calculé producteurs', 'Farmer-computed potential'), potKnown.length ? mt(pot) : na(), num(m.length - potKnown.length) + ' ' + T('producteur(s) sans potentiel', 'farmer(s) without potential'), m.length - potKnown.length ? 'warn' : '') +
      '</section><section class="kpi-grid">' +
      kpi(T('Volume AFLP engagé', 'AFLP committed volume'), has(cc.secured_volume_mt) ? num(cc.secured_volume_mt, 1) + ' MT' : na(), T('volume sécurisé', 'secured volume')) +
      kpi('Target', has(cc.target_mt) ? num(cc.target_mt, 1) + ' MT' : '—', T('fixée par la direction', 'set by management')) +
      kpi(T('Achats', 'Purchases'), mt(bought), T('mode A ', 'mode A ') + mt(s.purchased_kg_mode_a) + ' · ' + T('mode B ', 'mode B ') + mt(s.delivered_kg_mode_b)) +
      kpi(T('Reste à acheter', 'Remaining to buy'), target ? mt(Math.max(0, target - bought)) : '—', target ? pct(bought / target * 100) + ' ' + T('réalisés', 'achieved') : T('sans target', 'no target')) + '</section>' +
      '<div class="notice info">' + esc(T('Le potentiel déclaré par la coopérative et le potentiel calculé à partir des producteurs ne sont jamais additionnés ni substitués : l’écart est un indicateur de fiabilité de la déclaration.',
        'The cooperative’s declared potential and the farmer-computed potential are never added or substituted: the gap indicates how reliable the statement is.')) + '</div>' +
      card(T('Déclaré vs vérifié', 'Declared vs verified'), '', defGrid([[T('Membres déclarés', 'Declared members'), has(b.coop.declared_members) ? num(b.coop.declared_members) : null],
        [T('Producteurs enregistrés', 'Registered farmers'), num(m.length)], [T('Producteurs vérifiés', 'Verified farmers'), num(m.filter(function (x) { return x.verified; }).length)],
        [T('Potentiel déclaré', 'Declared potential'), has(cc.declared_potential_mt) ? num(cc.declared_potential_mt, 1) + ' MT' : null], [T('Potentiel producteurs vérifiés', 'Verified farmers potential'),
          mt(m.filter(function (x) { return x.verified && has(x.potential_kg); }).reduce(function (t, x) { return t + n(x.potential_kg); }, 0))]]));
  }).catch(function (e) { document.getElementById('ppBox').innerHTML = errBox(e); });
};

/* ------------------------------------------------------- 6. Achats & Livraisons */
TAB_RENDER.purchases = function () { return '<div id="plBox">' + skeleton() + '</div>'; };
TAB_AFTER.purchases = function (b, c) {
  var id = b.coop.id, cc = b.campaign || {}, edit = canEdit() && !b.coop.archived;
  Promise.all([
    q('achats', 'id,date,producteur_id,producteur_code,producteur_nom,village_nom,rt_nom,poids_net,nb_sacs,coop_member_number,statut_validation,stock_statut,kor,humidite,rejet', function (r) { return r.eq('cooperative_id', id).order('date', { ascending: false }).limit(300); }),
    q('aflp_coop_delivery_status_v', '*', function (r) { return r.eq('cooperative_id', id).order('planned_date', { ascending: false }); }),
    rpc('aflp_coop_chain', { p_coop: id, p_campaign: CAMPAIGN })
  ]).then(function (rs) {
    var buys = rs[0].filter(function (a) { return !a.rejet; }), dl = rs[1], ch = rs[2] || {};
    var model = cc.payment_model || 'INDIVIDUAL_FARMER';
    var lots = ch.lots || [];
    var chain = '<div class="coop-chain">' + [
      [T('Producteurs', 'Farmers'), num((ch.producteurs || {}).ouverts), num((ch.producteurs || {}).verifies) + ' ' + T('vérifiés', 'verified')],
      [T('Achats membres', 'Member purchases'), mt((ch.achats_mode_a || {}).kg), num((ch.achats_mode_a || {}).nombre) + ' ' + T('achat(s)', 'purchase(s)')],
      [T('Lots terrain', 'Field lots'), num((ch.achats_vers_lots_terrain || {}).lots), mt((ch.achats_vers_lots_terrain || {}).kg)],
      [T('Livraisons', 'Deliveries'), num(dl.length), mt(dl.reduce(function (t, d) { return t + n(d.delivered_kg); }, 0)) + ' ' + T('reçus', 'received')],
      [T('Lots Warehouse', 'Warehouse lots'), num(lots.length), mt(lots.reduce(function (t, l) { return t + n(l.kg); }, 0))],
      ['BIN / ' + T('Transferts', 'Transfers'), num(lots.reduce(function (t, l) { return t + (l.bins || []).length; }, 0)), num(lots.reduce(function (t, l) { return t + (l.transferts || []).length; }, 0)) + ' ' + T('transfert(s)', 'transfer(s)')]
    ].map(function (x, i) { return (i ? '<span class="coop-chain-arrow">→</span>' : '') + '<div class="coop-chain-step"><small>' + esc(x[0]) + '</small><b>' + x[1] + '</b><span>' + esc(x[2]) + '</span></div>'; }).join('') + '</div>';
    document.getElementById('plBox').innerHTML =
      '<div class="notice ' + (model === 'COOPERATIVE_CONSOLIDATED' ? 'info' : 'ok') + '"><b>' + esc(T('Modèle de paiement', 'Payment model')) + ' :</b>&nbsp;' + esc(L('payment', model)) + ' — ' +
      esc(model === 'COOPERATIVE_CONSOLIDATED'
        ? T('la coopérative est la contrepartie : livraisons consolidées planifiées dans le Delivery Plan, réceptionnées au Warehouse, puis réparties par producteur.', 'the cooperative is the counterpart: consolidated deliveries planned in the Delivery Plan, received at the Warehouse, then allocated per farmer.')
        : T('ANAGROCI achète au producteur membre via Achat Bord Champ ; l’achat porte automatiquement la coopérative, le Member ID et la section.', 'ANAGROCI buys from the member farmer through Field Buying; the purchase automatically carries cooperative, Member ID and section.')) + '</div>' +
      card(T('Chaîne de traçabilité', 'Traceability chain'), T('Coopérative → producteurs → achats → livraisons → lots → BIN → transferts → usine.', 'Cooperative → farmers → purchases → deliveries → lots → BIN → transfers → factory.'), chain,
        '<a class="btn secondary" href="traceability.html#coop=' + encodeURIComponent(b.coop.code) + '">Traceability 360 →</a>') +
      card(T('Livraisons de la coopérative', 'Cooperative deliveries'), T('Une livraison n’est entièrement traçable que lorsque la répartition par producteur égale le poids livré.', 'A delivery is fully traceable only when the per-farmer allocation equals the delivered weight.'),
        '<div class="coop-wide">' + table([T('Livraison', 'Delivery'), T('Date', 'Date'), 'Supplier', T('Origine', 'Origin'), T('Prévu', 'Planned'), T('Livré', 'Delivered'), T('Sacs', 'Bags'), T('Camion / chauffeur', 'Truck / driver'), T('Alloué', 'Allocated'), T('Répartition', 'Allocation'), T('Arrivage', 'Arrival'), T('Réception WMS', 'WMS reception'), T('Entrepôt', 'Warehouse'), T('Traçabilité', 'Traceability'), T('Statut', 'Status'), ''],
          dl.map(function (d) {
            var a = edit && d.status !== 'ANNULEE' ? '<div class="coop-actions-cell">' + (d.status !== 'RECUE' ? '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.receive(\'' + d.id + '\')">' + esc(T('Réception', 'Receive')) + '</button>' : '') +
              '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.allocate(\'' + d.id + '\')">' + esc(T('Répartir', 'Allocate')) + '</button></div>' : '';
            return '<tr><td class="mono">' + esc(d.code) + '</td><td>' + date(d.delivered_at || d.planned_date) + '</td><td>' + esc(d.supplier_name || T('non lié', 'not linked')) + '</td><td>' + (d.origin ? esc(d.origin) : na()) + '</td>' +
              '<td>' + (has(d.planned_kg) ? mt(d.planned_kg) : '—') + '</td><td>' + (has(d.delivered_kg) ? mt(d.delivered_kg) : '—') + '</td><td>' + (has(d.delivered_bags) ? num(d.delivered_bags) : has(d.planned_bags) ? num(d.planned_bags) + ' ' + esc(T('prévus', 'planned')) : '—') + '</td>' +
              '<td>' + esc([d.truck, d.driver].filter(Boolean).join(' · ') || '—') + '</td>' +
              '<td>' + mt(d.allocated_kg) + ' · ' + num(d.allocated_producers) + ' ' + esc(T('prod.', 'farm.')) + '</td><td>' + badge(L('alloc', d.allocation_status), d.allocation_status === 'TRACABLE' ? 'ok' : 'warn') + '</td>' +
              '<td class="mono">' + esc(d.arrival_id || '—') + '</td><td class="mono">' + esc(d.reception_id_resolved || '—') + '</td><td>' + esc(d.warehouse_code || '—') + '</td>' +
              '<td>' + badge(L('trace', d.traceability_level), d.traceability_level === 'TRACABLE_PRODUCTEUR' ? 'ok' : d.traceability_level === 'ANNULEE' ? 'danger' : 'warn') + '</td>' +
              '<td>' + badge(L('delivery', d.status), d.status === 'RECUE' ? 'ok' : d.status === 'ANNULEE' ? 'danger' : 'info') + '</td><td>' + a + '</td></tr>';
          }), T('Aucune livraison planifiée.', 'No delivery planned.')) + '</div>',
        edit && ['APPROUVEE', 'ACTIVE'].indexOf(b.coop.aflp_status) >= 0 ? '<button class="btn primary" type="button" onclick="ANAGROCI_COOP.planDelivery()">+ ' + esc(T('Planifier une livraison', 'Plan a delivery')) + '</button>' : '') +
      card(T('Lots Warehouse d’origine coopérative', 'Warehouse lots from this cooperative'), '', table(['LOT', T('Réception', 'Reception'), T('Poids', 'Weight'), T('Canal', 'Channel'), T('Producteurs', 'Farmers'), T('Villages', 'Villages'), 'KOR', T('Humidité', 'Moisture'), 'BIN', T('Traçabilité', 'Traceability')],
        lots.map(function (l) {
          return '<tr><td class="mono">' + esc(l.lot) + '</td><td class="mono">' + esc(l.reception || '—') + '</td><td>' + mt(l.kg) + '</td><td>' + esc(L('channel', l.canal)) + '</td><td>' + num(l.producteurs) + '</td><td>' + num(l.villages) + '</td>' +
            '<td>' + (has(l.kor) ? num(l.kor, 2) : '—') + '</td><td>' + (has(l.humidite) ? num(l.humidite, 1) + ' %' : '—') + '</td><td class="mono">' + esc((l.bins || []).join(', ') || '—') + '</td>' +
            '<td>' + badge(l.tracabilite === 'TRACABLE_PRODUCTEUR' ? T('Traçable producteur', 'Farmer-traceable') : l.tracabilite === 'ALLOCATION_A_COMPLETER' ? T('Allocation à compléter', 'Allocation to complete') : T('Organisation seulement', 'Organisation only'), l.tracabilite === 'TRACABLE_PRODUCTEUR' ? 'ok' : 'warn') + '</td></tr>';
        }), T('Aucun lot Warehouse rattaché pour l’instant.', 'No Warehouse lot linked yet.'))) +
      card(T('Achats Bord Champ des membres (mode A)', 'Member field purchases (mode A)'), T('Saisis dans Achat Bord Champ ; la coopérative est renseignée automatiquement depuis l’affiliation principale.', 'Entered in Field Buying; the cooperative is filled automatically from the primary affiliation.'),
        table([T('Date', 'Date'), 'Farmer ID', T('Producteur', 'Farmer'), 'Member ID', T('Village', 'Village'), 'RT', T('Poids', 'Weight'), T('Sacs', 'Bags'), 'KOR', T('Humidité', 'Moisture'), T('Validation', 'Validation'), 'Stock'],
          buys.map(function (a) {
            return '<tr><td>' + date(a.date) + '</td><td class="mono">' + esc(a.producteur_code || '—') + '</td><td>' + esc(a.producteur_nom || '—') + '</td><td class="mono">' + esc(a.coop_member_number || '—') + '</td><td>' + esc(a.village_nom || '—') + '</td>' +
              '<td>' + esc(a.rt_nom || '—') + '</td><td>' + mt(a.poids_net, 2) + '</td><td>' + num(a.nb_sacs) + '</td><td>' + (has(a.kor) ? num(a.kor, 2) : '—') + '</td><td>' + (has(a.humidite) ? num(a.humidite, 1) : '—') + '</td>' +
              '<td>' + esc(a.statut_validation || '—') + '</td><td>' + esc(a.stock_statut || '—') + '</td></tr>';
          }), T('Aucun achat de membre enregistré.', 'No member purchase recorded.')),
        '<a class="btn secondary" href="#purchases/new">+ ' + esc(T('Nouvel achat', 'New purchase')) + '</a>');
  }).catch(function (e) { document.getElementById('plBox').innerHTML = errBox(e); });
};
function planDelivery() {
  var id = currentCoopId();
  Promise.all([bundle(id), refs()]).then(function (rs) {
    var b = rs[0], c = rs[1], cc = b.campaign || {};
    simpleForm(T('Planifier une livraison', 'Plan a delivery'), b.supplier ? T('La livraison est ajoutée au Delivery Plan Procurement (canal Coopérative) et apparaîtra dans les arrivages attendus du Warehouse.', 'The delivery is added to the Procurement Delivery Plan (Cooperative channel) and will appear in the Warehouse expected arrivals.')
        : T('Coopérative sans identité Procurement : la livraison est suivie ici ; liez un Supplier pour l’envoyer au Delivery Plan.', 'Cooperative without Procurement identity: the delivery is tracked here; link a Supplier to send it to the Delivery Plan.'),
      field(T('Date prévue *', 'Planned date *'), 'planned_date', '', 'type="date"') + field(T('Quantité prévue (kg) *', 'Planned quantity (kg) *'), 'planned_kg', '', 'type="number" min="1"') +
      field(T('Sacs prévus', 'Planned bags'), 'planned_bags', '', 'type="number" min="0"') +
      selectField(T('Entrepôt *', 'Warehouse *'), 'warehouse_id', c.warehouses.map(function (w) { return '<option value="' + w.id + '"' + (w.id === cc.destination_warehouse_id ? ' selected' : '') + '>' + esc(w.code + ' · ' + (w.name || '')) + '</option>'; }).join('')) +
      selectField(T('Section', 'Section'), 'section_id', '<option value="">—</option>' + b.sections.filter(function (s) { return s.active; }).map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('')) +
      selectField(T('Point de collecte', 'Collection point'), 'collection_point_id', '<option value="">—</option>' + b.points.filter(function (p) { return p.active; }).map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('')) +
      field(T('Camion', 'Truck'), 'truck', '') + field(T('Chauffeur', 'Driver'), 'driver', '') + field(T('Transporteur', 'Transporter'), 'transporter', '') +
      field(T('Origine (localité de collecte)', 'Origin (collection locality)'), 'origin', '', 'maxlength="120"', 'span-2'),
      function (d) {
        if (!d.planned_date || !d.planned_kg) throw new Error(T('Date et quantité obligatoires.', 'Date and quantity required.'));
        d.cooperative_id = id; d.campaign = CAMPAIGN;
        return rpc('aflp_coop_plan_delivery', { p: d });
      });
  });
}
function receive(did) {
  simpleForm(T('Enregistrer la réception', 'Record reception'), T('Le poids reçu est celui du pont-bascule / de la réception Warehouse. Laisser la réception vide si elle est reliée par l’arrivage.', 'Received weight comes from the weighbridge / Warehouse reception. Leave reception empty if linked through the arrival.'),
    field(T('Poids livré (kg) *', 'Delivered weight (kg) *'), 'kg', '', 'type="number" min="1"') + field(T('Sacs', 'Bags'), 'bags', '', 'type="number" min="0"') + field(T('N° réception Warehouse', 'Warehouse reception no.'), 'rcv', '', 'placeholder="RCV-…"'),
    function (d) { if (!d.kg) throw new Error(T('Poids obligatoire.', 'Weight required.')); return rpc('aflp_coop_record_delivery', { p_delivery: did, p_delivered_kg: Number(d.kg), p_bags: d.bags ? Number(d.bags) : null, p_reception_id: d.rcv || null, p_status: 'RECUE' }); });
}
function allocate(did) {
  var id = currentCoopId();
  Promise.all([q('aflp_coop_delivery_status_v', '*', function (r) { return r.eq('id', did).limit(1); }), q('aflp_coop_delivery_allocations', 'id,producer_id,qty_kg,bags', function (r) { return r.eq('delivery_id', did); }), memberAgg(id),
    q('aflp_coop_members_v', 'producer_id,farmer_id,nom,prenoms,member_number', function (r) { return r.eq('cooperative_id', id).eq('campaign', CAMPAIGN).limit(5000); })]).then(function (rs) {
    var d = rs[0][0], al = rs[1], mem = rs[3], mm = {}; mem.forEach(function (m) { mm[m.producer_id] = m; });
    var ref = n(d.delivered_kg || d.planned_kg), sum = al.reduce(function (t, x) { return t + n(x.qty_kg); }, 0);
    var h = host(); if (!h) return;
    h.innerHTML = '<section class="card ops-form-card"><div class="card-head"><div><h2>' + esc(T('Répartition par producteur', 'Per-farmer allocation')) + ' — ' + esc(d.code) + '</h2><p>' +
      esc(T('Alloué ', 'Allocated ') + num(sum) + ' / ' + num(ref) + ' kg · ' + T('reste ', 'remaining ') + num(Math.max(0, ref - sum)) + ' kg') + '</p></div>' +
      '<div class="ops-route-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.closeHost()">' + esc(T('Fermer', 'Close')) + '</button></div></div>' +
      table(['Farmer ID', T('Producteur', 'Farmer'), 'Member ID', 'kg', T('Sacs', 'Bags'), ''], al.map(function (x) {
        var m = mm[x.producer_id] || {};
        return '<tr><td class="mono">' + esc(m.farmer_id || x.producer_id) + '</td><td>' + esc((m.nom || '') + ' ' + (m.prenoms || '')) + '</td><td class="mono">' + esc(m.member_number || '—') + '</td><td>' + num(x.qty_kg) + '</td><td>' + num(x.bags) + '</td>' +
          '<td>' + (d.status !== 'RECUE' ? '<button class="btn secondary" type="button" data-del="' + x.id + '">' + esc(T('Retirer', 'Remove')) + '</button>' : '') + '</td></tr>';
      }), T('Aucune allocation : livraison « ALLOCATION À COMPLÉTER ».', 'No allocation: delivery “ALLOCATION TO COMPLETE”.')) +
      '<form id="alForm" class="coop-form" style="margin-top:12px">' + selectField(T('Producteur membre *', 'Member farmer *'), 'producer_id', '<option value="">—</option>' + mem.map(function (m) { return '<option value="' + esc(m.producer_id) + '">' + esc((m.farmer_id || '') + ' · ' + m.nom + ' ' + (m.prenoms || '') + (m.member_number ? ' · ' + m.member_number : '')) + '</option>'; }).join(''), 'span-2') +
      field('kg *', 'qty_kg', ref > sum ? Math.round(ref - sum) : '', 'type="number" min="1"') + field(T('Sacs', 'Bags'), 'bags', '', 'type="number" min="0"') + '</form>' +
      '<div class="coop-form-actions"><button class="btn primary" type="button" id="alGo">' + esc(T('Ajouter l’allocation', 'Add allocation')) + '</button><span id="alMsg"></span></div></section>';
    h.querySelectorAll('[data-del]').forEach(function (bt) { bt.onclick = function () {
      client().then(function (cl) { return cl.from('aflp_coop_delivery_allocations').delete().eq('id', bt.getAttribute('data-del')); }).then(function (r) { if (r.error) throw new Error(r.error.message); invalidate('coop:' + id); allocate(did); }).catch(function (e) { alert(e.message); });
    }; });
    document.getElementById('alGo').onclick = function () {
      var x = formData(document.getElementById('alForm'));
      if (!x.producer_id || !x.qty_kg) return msg('alMsg', T('Producteur et poids obligatoires.', 'Farmer and weight required.'), false);
      insertRow('aflp_coop_delivery_allocations', { delivery_id: did, producer_id: x.producer_id, qty_kg: Number(x.qty_kg), bags: x.bags ? Number(x.bags) : null })
        .then(function () { invalidate('coop:' + id, 'dash'); allocate(did); }).catch(function (e) { msg('alMsg', e.message, false); });
    };
  }).catch(function (e) { alert(e.message); });
}

/* ------------------------------------------------------------------- 7. Sacherie */
TAB_RENDER.bags = function () { return '<div id="bgBox">' + skeleton() + '</div>'; };
TAB_AFTER.bags = function (b) {
  var box = document.getElementById('bgBox');
  if (!b.supplier || !b.supplier.code) {
    box.innerHTML = '<div class="notice info">' + esc(T('La sacherie d’une coopérative est suivie dans le grand livre jute existant (un seul système), au nom de son identité Procurement. Créez ou liez cette identité pour ouvrir le compte sacs de la coopérative. Pour un achat individuel aux membres (mode A), les sacs restent suivis par RT dans Sacherie AFLP.',
      'Cooperative bags are tracked in the existing jute ledger (one system), under its Procurement identity. Create or link that identity to open the cooperative bag account. For individual member purchases (mode A), bags stay tracked per RT in AFLP Bags.')) + '</div>' +
      '<div class="ops-actions" style="justify-content:flex-start"><a class="btn secondary" href="#bags">' + esc(T('Sacherie AFLP', 'AFLP Bags')) + ' →</a></div>';
    return;
  }
  Promise.all([q('rcn_jute_v_supplier_profile', '*', function (r) { return r.eq('supplier_code', b.supplier.code).limit(1); }),
    q('rcn_jute_movements', 'id,movement_type,ledger,qty,from_location,to_location,to_state,reception_id,movement_at,reference', function (r) { return r.eq('supplier_code', b.supplier.code).order('movement_at', { ascending: false }).limit(200); })]).then(function (rs) {
    var p = rs[0][0] || {}, mv = rs[1];
    function sumBy(re) { return mv.filter(function (m) { return re.test(String(m.movement_type || '') + ' ' + String(m.to_state || '')); }).reduce(function (t, m) { return t + n(m.qty); }, 0); }
    box.innerHTML = '<section class="kpi-grid">' + kpi(T('Sacs remis', 'Bags issued'), num(p.issued), T('grand livre jute', 'jute ledger')) + kpi(T('Sacs retournés', 'Bags returned'), num(p.returned), T('pleins ou vides', 'full or empty')) +
      kpi(T('Pertes approuvées', 'Approved losses'), num(p.approved_loss), '') + kpi(T('Solde dû', 'Balance due'), num(p.balance), T('taux de retour ', 'return rate ') + pct(p.return_rate), n(p.balance) > 0 ? 'warn' : '') + '</section>' +
      '<section class="kpi-grid">' + kpi(T('Sacs pleins reçus', 'Full bags received'), num(sumBy(/PLEIN|FULL|RECEPTION/i)), T('réceptions', 'receptions')) + kpi(T('Sacs vides', 'Empty bags'), num(sumBy(/VIDE|EMPTY|RETOUR|RETURN/i)), '') +
      kpi(T('Ancienneté > 90 j', 'Age > 90 d'), num(p.bucket_90_plus), '', n(p.bucket_90_plus) ? 'warn' : '') + kpi(T('Dernier mouvement', 'Last movement'), date(p.last_movement), '') + '</section>' +
      card(T('Mouvements de sacherie', 'Bag movements'), T('Lecture du grand livre central (rcn_jute) — aucun second système.', 'Read from the central ledger (rcn_jute) — no second system.'),
        table([T('Date', 'Date'), T('Type', 'Type'), T('Quantité', 'Quantity'), T('De', 'From'), T('Vers', 'To'), T('État', 'State'), T('Réception', 'Reception'), T('Référence', 'Reference')],
          mv.map(function (m) { return '<tr><td>' + dtime(m.movement_at) + '</td><td>' + esc(m.movement_type) + '</td><td>' + num(m.qty) + '</td><td>' + esc(m.from_location || '—') + '</td><td>' + esc(m.to_location || '—') + '</td><td>' + esc(m.to_state || '—') + '</td><td class="mono">' + esc(m.reception_id || '—') + '</td><td>' + esc(m.reference || '—') + '</td></tr>'; }),
          T('Aucun mouvement de sacs pour cette coopérative.', 'No bag movement for this cooperative.')));
  }).catch(function (e) { box.innerHTML = errBox(e); });
};

/* ------------------------------------------------------------------ 8. Durabilité */
var TRN_CAT = { BONNES_PRATIQUES: ['Bonnes pratiques agricoles', 'Good agricultural practices'], QUALITE_POST_RECOLTE: ['Qualité post-récolte', 'Post-harvest quality'],
  SECURITE_PHYTOSANITAIRE: ['Sécurité phytosanitaire', 'Pesticide safety'], ENVIRONNEMENT: ['Environnement', 'Environment'], SOCIAL_DROITS: ['Social et droits', 'Social and rights'],
  GOUVERNANCE_COOP: ['Gouvernance coopérative', 'Cooperative governance'], AUTRE: ['Autre', 'Other'] };
function trnLabel(k) { return TRN_CAT[k] ? T(TRN_CAT[k][0], TRN_CAT[k][1]) : k; }
TAB_RENDER.sustainability = function () { return '<div id="suBox">' + skeleton() + '</div>'; };
TAB_AFTER.sustainability = function (b) {
  var edit = canEdit() && !b.coop.archived;
  memberAgg(b.coop.id).then(function (A) {
    var m = A.members, total = m.length, yr = new Date().getFullYear();
    function cnt(fn) { return m.filter(fn).length; }
    var ids = m.map(function (x) { return x.producer_id; });
    var chunks = []; for (var i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
    function per(tableName, cols, mod) { return Promise.all(chunks.map(function (ch) { return q(tableName, cols, function (r) { r = r.in('producteur_id', ch); return mod ? mod(r) : r; }).catch(function () { return []; }); })).then(function (x) { return [].concat.apply([], x); }); }
    return Promise.all([
      per('farmer_inspections', 'producteur_id,status,risk_profile,inspection_date'),
      per('farmer_sustainability_baselines', 'producteur_id,status,risk_profile,answered_count,required_count,catalog_version', function (r) { return r.eq('status', 'FINAL'); }),
      per('farmer_action_plans', 'producteur_id,status,priority', function (r) { return r.in('status', ['OPEN', 'IN_PROGRESS', 'OVERDUE']); }),
      q('aflp_coop_trainings', 'id,topic,category,training_date,trainer,location,active', function (r) { return r.eq('cooperative_id', b.coop.id).eq('active', true).order('training_date', { ascending: false }); }).catch(function () { return []; })
    ]).then(function (rs) {
      var ins = rs[0], bas = rs[1], plans = rs[2], trn = rs[3];
      var tIds = trn.map(function (t) { return t.id; });
      return (tIds.length ? q('aflp_coop_training_attendance', 'training_id,producer_id', function (r) { return r.in('training_id', tIds); }).catch(function () { return []; }) : Promise.resolve([])).then(function (att) {
        var trained = {}, perT = {}; att.forEach(function (a) { trained[a.producer_id] = 1; perT[a.training_id] = (perT[a.training_id] || 0) + 1; });
        var risky = {}; ins.concat(bas).forEach(function (x) { if (/HIGH|REVIEW/.test(String(x.risk_profile || ''))) risky[x.producteur_id] = 1; });
        var basP = {}; bas.forEach(function (x) { basP[x.producteur_id] = 1; });
        var insP = {}; ins.forEach(function (x) { insP[x.producteur_id] = 1; });
        var sexKnown = cnt(function (x) { return x.sexe === 'M' || x.sexe === 'F'; });
        function young(x) { return has(x.birth_year) ? n(x.birth_year) > yr - 35 : ['18-24', '25-34'].indexOf(x.age_band) >= 0; }
        var ageKnown = cnt(function (x) { return has(x.birth_year) || (x.age_band && x.age_band !== 'UNKNOWN'); });
        function ratio(k, d) { return d ? num(k) + ' / ' + num(d) : na(); }
        function nc(k) { return num(k) + ' ' + T('non collecté(s)', 'not recorded'); }
        var box = document.getElementById('suBox');
        box.innerHTML = '<div class="notice info">' + esc(T('Aucune donnée n’est déduite : une information non collectée reste « NON COLLECTÉ ». Pratiques, inspections et risques proviennent du Farmer Passport (baselines finalisées, inspections) ; les formations, des sessions réellement tenues.',
            'No data is inferred: uncollected information stays “NOT RECORDED”. Practices, inspections and risks come from the Farmer Passport (finalised baselines, inspections); trainings from sessions actually held.')) + '</div>' +
          '<section class="kpi-grid">' + kpi(T('Producteurs membres', 'Member farmers'), num(total), '') +
          kpi('Farmer Passport', ratio(cnt(function (x) { return ['MAPPED', 'BASELINE', 'VERIFIED'].indexOf(x.passport_stage) >= 0; }), total), T('cartographié ou plus', 'mapped or beyond')) +
          kpi(T('Consentement', 'Consent'), ratio(cnt(function (x) { return x.consent_status === 'GRANTED'; }), total), num(cnt(function (x) { return x.consent_status === 'NOT_RECORDED' || !x.consent_status; })) + ' ' + T('non recueilli(s)', 'not recorded')) +
          kpi(T('GPS', 'GPS'), total ? num(cnt(function (x) { return n(x.gps_plots) > 0; })) : na(), nc(cnt(function (x) { return !n(x.gps_plots); })) + ' · ' + num(m.reduce(function (t, x) { return t + n(x.gps_plots); }, 0)) + ' ' + T('parcelle(s) GPS', 'GPS plot(s)')) + '</section>' +
          '<section class="kpi-grid">' + kpi(T('Superficie', 'Area'), cnt(function (x) { return has(x.area_ha); }) ? num(m.reduce(function (t, x) { return t + n(x.area_ha); }, 0), 1) + ' ha' : na(), nc(cnt(function (x) { return !has(x.area_ha); }))) +
          kpi(T('Femmes', 'Women'), sexKnown ? num(cnt(function (x) { return x.sexe === 'F'; })) : na(), num(total - sexKnown) + ' ' + T('sexe non collecté', 'sex not recorded')) +
          kpi(T('Jeunes (< 35 ans)', 'Youth (< 35)'), ageKnown ? num(cnt(young)) : na(), num(total - ageKnown) + ' ' + T('âge non collecté', 'age not recorded')) +
          kpi(T('Formés', 'Trained'), trn.length ? ratio(Object.keys(trained).length, total) : na(), num(trn.length) + ' ' + T('session(s)', 'session(s)')) + '</section>' +
          '<section class="kpi-grid">' + kpi(T('Bonnes pratiques', 'Good practices'), bas.length ? ratio(Object.keys(basP).length, total) : na(), T('baseline durabilité finalisée', 'finalised sustainability baseline') + ' · ' + nc(total - Object.keys(basP).length)) +
          kpi(T('Inspections', 'Inspections'), ins.length ? num(ins.length) : na(), num(Object.keys(insP).length) + ' ' + T('producteur(s) inspecté(s)', 'farmer(s) inspected')) +
          kpi(T('Risques', 'Risks'), (ins.length || bas.length) ? num(Object.keys(risky).length) : na(), T('producteur(s) à risque élevé / revue', 'farmer(s) high risk / review'), Object.keys(risky).length ? 'warn' : '') +
          kpi(T('Plans d’action ouverts', 'Open action plans'), num(plans.length), num(plans.filter(function (p) { return p.priority === 'CRITICAL' || p.priority === 'HIGH'; }).length) + ' ' + T('prioritaire(s)', 'high priority'), plans.length ? 'warn' : '') + '</section>' +
          card(T('Formations', 'Trainings'), T('Sessions réellement tenues et présences nominatives. Un producteur non listé n’est pas « non formé » : son statut est inconnu.', 'Sessions actually held and named attendance. A farmer not listed is not “untrained”: status is unknown.'),
            table([T('Date', 'Date'), T('Thème', 'Topic'), T('Catégorie', 'Category'), T('Formateur', 'Trainer'), T('Lieu', 'Location'), T('Présents', 'Attendees'), ''], trn.map(function (t) {
              return '<tr><td>' + date(t.training_date) + '</td><td><b>' + esc(t.topic) + '</b></td><td>' + esc(trnLabel(t.category)) + '</td><td>' + esc(t.trainer || '—') + '</td><td>' + esc(t.location || '—') + '</td><td>' + num(perT[t.id] || 0) + '</td>' +
                '<td>' + (edit ? '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.attendance(\'' + t.id + '\')">' + esc(T('Présences', 'Attendance')) + '</button>' : '') + '</td></tr>';
            }), T('Aucune formation enregistrée : NON COLLECTÉ.', 'No training recorded: NOT RECORDED.')),
            edit ? '<button class="btn primary" type="button" onclick="ANAGROCI_COOP.addTraining()">+ ' + esc(T('Enregistrer une formation tenue', 'Record a training held')) + '</button>' : '') +
          card(T('Dossiers incomplets', 'Incomplete files'), T('À compléter en priorité, dans le Farmer Passport ou par un nouvel enrôlement.', 'To complete first, in the Farmer Passport or through enrolment.'),
            defGrid([[T('Passport incomplet ou basique', 'Incomplete or basic passport'), num(cnt(function (x) { return x.passport_stage === 'INCOMPLETE' || x.passport_stage === 'BASIC'; }))],
              [T('Consentement non recueilli', 'Consent not recorded'), num(cnt(function (x) { return !x.consent_status || x.consent_status === 'NOT_RECORDED'; }))], [T('Sans téléphone', 'Without phone'), num(cnt(function (x) { return !x.telephone; }))],
              [T('Sans GPS', 'Without GPS'), num(cnt(function (x) { return !n(x.gps_plots); }))], [T('Sans superficie', 'Without area'), num(cnt(function (x) { return !has(x.area_ha); }))],
              [T('Complétude < 50 %', 'Completeness < 50%'), num(cnt(function (x) { return n(x.completeness_pct) < 50; }))]]));
      });
    });
  }).catch(function (e) { document.getElementById('suBox').innerHTML = errBox(e); });
};
function addTraining() {
  var id = currentCoopId();
  simpleForm(T('Enregistrer une formation tenue', 'Record a training held'), T('Uniquement une session réellement tenue (pas de formation planifiée ici).', 'Only a session actually held (no planned training here).'),
    field(T('Thème *', 'Topic *'), 'topic', '', 'maxlength="160"', 'span-2') + selectField(T('Catégorie', 'Category'), 'category', Object.keys(TRN_CAT).map(function (k) { return '<option value="' + k + '">' + esc(trnLabel(k)) + '</option>'; }).join('')) +
    field(T('Date *', 'Date *'), 'training_date', '', 'type="date" max="' + new Date().toISOString().slice(0, 10) + '"') + field(T('Formateur', 'Trainer'), 'trainer', '') + field(T('Lieu', 'Location'), 'location', ''),
    function (d) {
      if (!d.topic || !d.training_date) throw new Error(T('Thème et date obligatoires.', 'Topic and date required.'));
      return insertRow('aflp_coop_trainings', { cooperative_id: id, campaign: CAMPAIGN, topic: d.topic, category: d.category, training_date: d.training_date, trainer: d.trainer || null, location: d.location || null })
        .then(function () { invalidate('agg:' + id); });
    });
}
function attendance(tid) {
  var id = currentCoopId();
  Promise.all([q('aflp_coop_members_v', 'producer_id,farmer_id,nom,prenoms,member_number', function (r) { return r.eq('cooperative_id', id).eq('campaign', CAMPAIGN).neq('status', 'ENDED').order('nom').limit(5000); }),
    q('aflp_coop_training_attendance', 'producer_id', function (r) { return r.eq('training_id', tid); })]).then(function (rs) {
    var here = {}; rs[1].forEach(function (a) { here[a.producer_id] = 1; });
    var h = host(); if (!h) return;
    h.innerHTML = '<section class="card ops-form-card"><div class="card-head"><div><h2>' + esc(T('Présences à la formation', 'Training attendance')) + '</h2><p>' + esc(T('Cochez les producteurs présents. Une présence enregistrée n’est pas retirée (journal).', 'Tick attending farmers. A recorded attendance is not removed (log).')) + '</p></div>' +
      '<div class="ops-route-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_COOP.closeHost()">' + esc(T('Fermer', 'Close')) + '</button></div></div>' +
      '<div class="coop-filters" style="margin-bottom:8px"><label class="coop-search">' + esc(T('Recherche', 'Search')) + '<input type="search" id="atQ"></label></div>' +
      '<div class="coop-attendance" id="atList">' + rs[0].map(function (m) {
        return '<label data-s="' + esc(norm((m.farmer_id || '') + ' ' + m.nom + ' ' + (m.prenoms || '') + ' ' + (m.member_number || ''))) + '"><input type="checkbox" value="' + esc(m.producer_id) + '"' + (here[m.producer_id] ? ' checked disabled' : '') + '> <span class="mono">' + esc(m.farmer_id || '') + '</span> ' + esc(m.nom + ' ' + (m.prenoms || '')) + '</label>';
      }).join('') + '</div><div class="coop-form-actions"><button class="btn primary" type="button" id="atGo">' + esc(T('Enregistrer les présences', 'Save attendance')) + '</button><span id="atMsg"></span></div></section>';
    document.getElementById('atQ').oninput = function () { var s = norm(this.value); h.querySelectorAll('#atList label').forEach(function (l) { l.style.display = !s || l.getAttribute('data-s').indexOf(s) >= 0 ? '' : 'none'; }); };
    document.getElementById('atGo').onclick = function () {
      var ids = [].slice.call(h.querySelectorAll('#atList input:checked:not(:disabled)')).map(function (i) { return i.value; });
      if (!ids.length) return msg('atMsg', T('Aucune nouvelle présence cochée.', 'No new attendance ticked.'), false);
      insertRow('aflp_coop_training_attendance', ids.map(function (p) { return { training_id: tid, producer_id: p }; })).then(function () { toast(num(ids.length) + ' ' + T('présence(s) enregistrée(s).', 'attendance(s) saved.')); invalidate('agg:' + id); refreshFiche(); })
        .catch(function (e) { msg('atMsg', e.message, false); });
    };
  }).catch(function (e) { alert(e.message); });
}

/* ------------------------------------------------------------------- 9. Documents */
TAB_RENDER.documents = function () { return '<div id="dcBox">' + skeleton() + '</div>'; };
function docStatus(d) {
  if (!d) return ['MANQUANT', T('Manquant', 'Missing'), 'danger'];
  if (d.expires_on) { var days = (new Date(d.expires_on) - new Date()) / 86400000; if (days < 0) return ['EXPIRE', T('Expiré', 'Expired'), 'danger']; if (days <= 60) return ['A_RENOUVELER', T('À renouveler', 'To renew'), 'warn']; }
  return ['VALIDE', T('Valide', 'Valid'), 'ok'];
}
TAB_AFTER.documents = function (b) {
  var edit = canEdit() && !b.coop.archived;
  q('aflp_coop_documents', '*', function (r) { return r.eq('cooperative_id', b.coop.id).order('created_at', { ascending: false }); }).then(function (docs) {
    var live = docs.filter(function (d) { return !d.voided; }), byCat = {};
    live.forEach(function (d) { if (!byCat[d.category]) byCat[d.category] = d; });
    var cats = Object.keys(LBL.doc).filter(function (k) { return REQUIRED_DOCS.indexOf(k) >= 0 || byCat[k]; });
    document.getElementById('dcBox').innerHTML = card(T('Documents de la coopérative', 'Cooperative documents'), T('Stockage privé ; lecture interdite aux rôles Warehouse/Factory.', 'Private storage; Warehouse/Factory roles cannot read.'),
      table(['Document', T('Fichier', 'File'), T('Date', 'Date'), T('Expiration', 'Expiry'), T('Statut', 'Status'), ''], cats.map(function (k) {
        var d = byCat[k], st = docStatus(d);
        return '<tr><td><b>' + esc(L('doc', k)) + '</b>' + (REQUIRED_DOCS.indexOf(k) >= 0 ? ' <small class="muted">' + esc(T('requis', 'required')) + '</small>' : '') + '</td><td>' + esc(d ? (d.title || d.file_name || '—') : '—') + '</td>' +
          '<td>' + (d ? date(d.issued_on || d.created_at) : '—') + '</td><td>' + (d && d.expires_on ? date(d.expires_on) : '—') + '</td><td>' + badge(st[1], st[2]) + '</td>' +
          '<td><div class="coop-actions-cell">' + (d && d.storage_path ? '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.openDoc(\'' + esc(d.storage_path) + '\')">' + esc(T('Télécharger', 'Download')) + '</button>' : '') +
          (edit ? '<button class="btn secondary" type="button" onclick="ANAGROCI_COOP.uploadDoc(\'' + k + '\',' + (d ? '\'' + d.id + '\'' : 'null') + ')">' + esc(d ? T('Remplacer', 'Replace') : T('Ajouter', 'Add')) + '</button>' : '') + '</div></td></tr>';
      })), edit ? '<button class="btn primary" type="button" onclick="ANAGROCI_COOP.uploadDoc(\'AUTRE\',null)">+ Document</button>' : '') +
      (docs.length > live.length ? card(T('Versions remplacées', 'Replaced versions'), '', table(['Document', T('Fichier', 'File'), T('Ajouté le', 'Added on'), T('Motif', 'Reason')],
        docs.filter(function (d) { return d.voided; }).map(function (d) { return '<tr><td>' + esc(L('doc', d.category)) + '</td><td>' + esc(d.file_name || '—') + '</td><td>' + date(d.created_at) + '</td><td>' + esc(d.void_reason || '—') + '</td></tr>'; }))) : '');
  }).catch(function (e) { document.getElementById('dcBox').innerHTML = errBox(e); });
};
function uploadDoc(cat, replacesId) {
  var id = currentCoopId();
  simpleForm(T('Document', 'Document') + ' — ' + L('doc', cat), T('PDF, image, Excel ou Word ; 10 Mo maximum.', 'PDF, image, Excel or Word; 10 MB max.'),
    selectField(T('Catégorie', 'Category'), 'category', opts('doc', cat)) + field(T('Titre', 'Title'), 'title', '') + field(T('Date du document', 'Document date'), 'issued_on', '', 'type="date"') +
    field(T('Date d’expiration', 'Expiry date'), 'expires_on', '', 'type="date"') + '<label class="span-2">' + esc(T('Fichier *', 'File *')) + '<input type="file" id="docFile" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx"></label>',
    function (d) {
      var file = document.getElementById('docFile').files[0];
      if (!file) throw new Error(T('Fichier obligatoire.', 'File required.'));
      if (file.size > 10485760) throw new Error(T('Fichier trop volumineux (10 Mo max).', 'File too large (10 MB max).'));
      var path = id + '/' + uuid() + '-' + file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
      return client().then(function (cl) {
        return cl.storage.from(DOC_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined }).then(function (up) {
          if (up.error) throw new Error(up.error.message);
          return cl.from('aflp_coop_documents').insert({ cooperative_id: id, category: d.category, title: d.title || null, storage_path: path, file_name: file.name, mime_type: file.type || null,
            size_bytes: file.size, issued_on: d.issued_on || null, expires_on: d.expires_on || null, replaces_id: replacesId || null }).then(function (r) {
            if (r.error) throw new Error(r.error.message);
            if (replacesId) return cl.from('aflp_coop_documents').update({ voided: true, void_reason: T('Remplacé par une nouvelle version', 'Replaced by a new version') }).eq('id', replacesId).then(function (u) { if (u.error) throw new Error(u.error.message); });
          });
        });
      });
    });
}
function openDoc(path) {
  client().then(function (cl) { return cl.storage.from(DOC_BUCKET).createSignedUrl(path, 120); }).then(function (r) {
    if (r.error) throw new Error(r.error.message); global.open(r.data.signedUrl, '_blank', 'noopener');
  }).catch(function (e) { alert(e.message); });
}

/* ------------------------------------------------------------------- 10. Historique */
var ENTITY = { aflp_cooperatives: ['Coopérative', 'Cooperative'], aflp_coop_campaigns: ['Paramètres campagne', 'Campaign settings'], aflp_coop_contacts: ['Responsable', 'Officer'],
  aflp_coop_sections: ['Section', 'Section'], aflp_coop_villages: ['Village', 'Village'], aflp_coop_collection_points: ['Point de collecte', 'Collection point'],
  aflp_coop_memberships: ['Affiliation producteur', 'Farmer membership'], aflp_coop_documents: ['Document', 'Document'], aflp_coop_deliveries: ['Livraison', 'Delivery'],
  aflp_coop_delivery_allocations: ['Répartition livraison', 'Delivery allocation'], import_producteurs: ['Import Excel', 'Excel import'] };
var FIELDS = { aflp_status: ['statut', 'status'], target_mt: ['target', 'target'], name: ['nom', 'name'], producer_registry_status: ['liste producteurs', 'farmer list'], compliance_status: ['conformité', 'compliance'],
  status: ['statut', 'status'], is_primary: ['principale', 'primary'], verified: ['vérification', 'verification'], member_number: ['Member ID', 'Member ID'], supplier_id: ['identité Procurement', 'Procurement identity'],
  payment_model: ['modèle de paiement', 'payment model'], declared_potential_mt: ['potentiel déclaré', 'declared potential'], archived: ['archivage', 'archiving'], delivered_kg: ['poids livré', 'delivered weight'], active: ['actif', 'active'], voided: ['remplacé', 'replaced'] };
function describe(a) {
  var ent = ENTITY[a.entity] ? T(ENTITY[a.entity][0], ENTITY[a.entity][1]) : a.entity, op = a.operation, after = a.after_data || {}, before = a.before_data || {};
  if (op === 'INSERT') {
    if (a.entity === 'aflp_cooperatives') return T('Coopérative créée', 'Cooperative created') + ' (' + (after.code || '') + ')';
    if (a.entity === 'aflp_coop_memberships') return T('Producteur ajouté', 'Farmer added') + (after.member_number ? ' · ' + after.member_number : '') + ' · ' + L('source', after.source);
    return ent + ' ' + T('ajouté(e)', 'added') + (after.name || after.full_name || after.village_name || after.code ? ' : ' + (after.name || after.full_name || after.village_name || after.code) : '');
  }
  if (op === 'IMPORT') return T('Import Excel : ', 'Excel import: ') + num(after.importes) + ' ' + T('importés', 'imported') + ', ' + num(after.existants_associes) + ' ' + T('associés', 'linked') + ', ' + num(after.rejetes) + ' ' + T('rejetés', 'rejected');
  if (op === 'ARCHIVE') return T('Coopérative archivée', 'Cooperative archived') + (a.note ? ' : ' + a.note : '');
  var ch = Object.keys(FIELDS).filter(function (k) { return JSON.stringify(before[k]) !== JSON.stringify(after[k]) && (k in after); }).map(function (k) {
    var lbl = T(FIELDS[k][0], FIELDS[k][1]), bv = before[k], av = after[k];
    if (k === 'aflp_status') { bv = L('status', bv); av = L('status', av); } if (k === 'status') { bv = L('memberStatus', bv); av = L('memberStatus', av); }
    return lbl + ' : ' + (bv == null ? '—' : bv) + ' → ' + (av == null ? '—' : av);
  });
  if (a.entity === 'aflp_coop_memberships' && after.status === 'ENDED' && before.status !== 'ENDED') return T('Producteur retiré / transféré', 'Farmer removed / transferred') + (after.member_number ? ' · ' + after.member_number : '');
  return ent + ' ' + T('modifié(e)', 'updated') + (ch.length ? ' — ' + ch.join(' · ') : '');
}
TAB_RENDER.history = function () { return '<div id="hiBox">' + skeleton() + '</div>'; };
TAB_AFTER.history = function (b) {
  q('aflp_coop_audit', 'id,entity,entity_id,operation,before_data,after_data,note,actor_email,actor_role,created_at', function (r) { return r.eq('cooperative_id', b.coop.id).order('created_at', { ascending: false }).limit(300); }).then(function (rows) {
    document.getElementById('hiBox').innerHTML = card(T('Historique', 'History'), T('Journal d’audit serveur : chaque création, modification, ajout ou retrait est tracé.', 'Server audit log: each creation, change, addition or removal is recorded.'),
      table([T('Date / heure', 'Date / time'), T('Objet', 'Object'), T('Événement', 'Event'), T('Utilisateur', 'User')], rows.map(function (a) {
        return '<tr><td>' + dtime(a.created_at) + '</td><td>' + esc(ENTITY[a.entity] ? T(ENTITY[a.entity][0], ENTITY[a.entity][1]) : a.entity) + '</td><td>' + esc(describe(a)) + '</td><td>' + esc((a.actor_email || '—') + (a.actor_role ? ' · ' + a.actor_role : '')) + '</td></tr>';
      }), T('Aucun événement.', 'No event.')));
  }).catch(function (e) { document.getElementById('hiBox').innerHTML = errBox(e); });
};

/* ------------------------------------------------- statut, archivage, Procurement */
function statusDialog(id) {
  bundle(id).then(function (b) {
    var allowed = ['PROSPECT', 'EN_EVALUATION', 'A_COMPLETER', 'SUSPENDUE', 'SORTIE'].concat(isDirection() ? ['APPROUVEE', 'ACTIVE'] : []);
    simpleForm(T('Changer le statut AFLP', 'Change AFLP status'), T('Approuvée et Active : direction (BM, ABM, Head of Field). Suspension et sortie : motif obligatoire.', 'Approved and Active: management (BM, ABM, Head of Field). Suspension and exit: reason required.'),
      selectField(T('Nouveau statut', 'New status'), 'status', allowed.map(function (k) { return '<option value="' + k + '"' + (k === b.coop.aflp_status ? ' selected' : '') + '>' + esc(L('status', k)) + '</option>'; }).join('')) +
      field(T('Motif', 'Reason'), 'reason', '', 'maxlength="300"', 'span-2'),
      function (d) { return rpc('aflp_coop_set_status', { p_coop: id, p_status: d.status, p_reason: d.reason || null }); });
  });
}
function archive(id) {
  var r = prompt(T('Motif d’archivage (la coopérative n’est jamais supprimée ; membres, achats, livraisons et lots restent traçables) :', 'Archiving reason (the cooperative is never deleted; members, purchases, deliveries and lots stay traceable):'));
  if (!r) return;
  rpc('aflp_coop_archive', { p_coop: id, p_reason: r }).then(function () { invalidate('dash', 'coop'); toast(T('Coopérative archivée.', 'Cooperative archived.')); go('#cooperatives'); }).catch(function (e) { alert(e.message); });
}
function createSupplier(id) {
  if (!confirm(T('Créer l’identité Procurement (Supplier Direct de type Coopérative) à partir de cette fiche ?', 'Create the Procurement identity (Direct Supplier, Cooperative type) from this profile?'))) return;
  simpleRpc('aflp_coop_create_supplier', { p_coop: id }, T('Identité Procurement créée et liée.', 'Procurement identity created and linked.'));
}
function linkSupplier(id) {
  Promise.all([q('procurement_suppliers', 'supplier_id,display_name,status', function (r) { return r.eq('entity_type', 'COOPERATIVE').order('display_name'); }),
    q('aflp_cooperatives', 'supplier_id', function (r) { return r.not('supplier_id', 'is', null); })]).then(function (rs) {
    var used = {}; rs[1].forEach(function (x) { used[x.supplier_id] = 1; });
    var list = rs[0].filter(function (s) { return !used[s.supplier_id]; });
    simpleForm(T('Lier un Supplier Procurement existant', 'Link an existing Procurement supplier'), T('Seuls les Suppliers de type Coopérative non encore liés sont proposés.', 'Only Cooperative-type suppliers not yet linked are listed.'),
      selectField('Supplier *', 'supplier', '<option value="">—</option>' + list.map(function (s) { return '<option value="' + s.supplier_id + '">' + esc(s.display_name + ' · ' + (s.status || '')) + '</option>'; }).join(''), 'span-2'),
      function (d) { if (!d.supplier) throw new Error(T('Choisissez un Supplier.', 'Choose a supplier.')); return rpc('aflp_coop_link_supplier', { p_coop: id, p_supplier: d.supplier }); });
  }).catch(function (e) { alert(e.message); });
}

/* ------------------------------------------------------------------------ exports */
function exportList() {
  dashboard(F.campaign).then(function (rows) {
    exportRows('Cooperatives_AFLP_' + F.campaign, applyFilters(rows).map(function (r) {
      return { Code: r.code, Cooperative: r.name, Sigle: r.acronym, Localite: r.locality, Sous_prefecture: r.sous_prefecture, Departement: r.departement, Cluster: r.cluster_code, Zone: r.zone_code,
        Statut: L('status', r.aflp_status), Conformite: L('compliance', r.compliance_status), Liste_producteurs: L('registry', r.producer_registry_status), Modele_paiement: L('payment', r.payment_model),
        Membres_declares: r.declared_members, Producteurs_enregistres: r.producers_registered, Producteurs_verifies: r.producers_verified, Villages: r.villages_covered,
        Potentiel_declare_MT: r.declared_potential_mt, Potentiel_producteurs_MT: r.farmer_potential_kg != null ? n(r.farmer_potential_kg) / 1000 : null, Producteurs_sans_potentiel: r.farmer_potential_missing,
        Target_MT: r.target_mt, Achete_MT: n(r.purchased_kg) / 1000, Realisation_pct: r.achievement_pct, Femmes: r.women, Jeunes: r.youth, Consentements: r.consent_granted,
        KOR_moyen: r.kor_avg, Humidite_moyenne: r.moisture_avg, Livraisons_a_repartir: r.deliveries_to_allocate, Solde_sacs: r.bags_balance, QA: r.is_qa ? 'OUI' : '' };
    }));
  });
}
function exportMembers(id) {
  q('aflp_coop_members_v', '*', function (r) { return r.eq('cooperative_id', id).eq('campaign', CAMPAIGN).order('nom').limit(10000); }).then(function (rows) {
    exportRows('Membres_' + id.slice(0, 8), rows.map(function (m) {
      return { Farmer_ID: m.farmer_id, Nom: m.nom, Prenoms: m.prenoms, Village: m.village_nom, Member_ID: m.member_number, Section: m.section_name, Statut: L('memberStatus', m.status),
        Principale: m.is_primary ? 'OUI' : 'NON', Verifiee: m.verified ? 'OUI' : 'NON', Superficie_ha: m.area_ha, Potentiel_kg: m.potential_kg, Source_potentiel: m.potential_source,
        Passport: L('passport', m.passport_stage), Consentement: L('consent', m.consent_status), Debut: m.membership_start, Fin: m.membership_end };
    }));
  }).catch(function (e) { alert(e.message); });
}

/* ------------------------------------------------------------------------ routeur */
function render(p) {
  p = p || routeParts();
  var id = p[1], tab = p[2];
  if (!id) return renderDashboard();
  if (id === 'new') return renderForm(null);
  if (tab === 'edit') return renderForm(id);
  if (tab === 'import') return renderImport(id);
  return renderFiche(id, tab);
}
document.addEventListener('anagroci:language', function () { if (routeParts()[0] === 'cooperatives') setTimeout(function () { render(routeParts()); }, 80); });

global.ANAGROCI_COOP = {
  render: render, fillOverview: fillOverview, fillChannel: fillChannel, view: setView, exportList: exportList, exportMembers: exportMembers,
  addMember: function (id, linkOnly) { enrolMod(linkOnly ? 'link' : 'enroll', id); }, verify: verify, primary: primary, endMember: endMember, transfer: transfer, closeHost: closeHost, gps: gps,
  addVillage: addVillage, addSection: addSection, addPoint: addPoint, addContact: addContact, deactivateContact: deactivateContact,
  editVillage: editVillage, editSection: editSection, editPoint: editPoint, editContact: editContact, editMember: editMember, toggleRow: toggleRow,
  planDelivery: planDelivery, addTraining: addTraining, attendance: attendance, receive: receive, allocate: allocate, uploadDoc: uploadDoc, openDoc: openDoc,
  statusDialog: statusDialog, archive: archive, createSupplier: createSupplier, linkSupplier: linkSupplier,
  enroll: function (id) { enrolMod('enroll', id); }, linkExisting: function (id) { enrolMod('link', id); }, reviews: function (id) { enrolMod('reviews', id); },
  _t: T, _labels: LBL,
  /* Boîte à outils partagée avec aflp-cooperatives-enrolement.js (même rendu, mêmes contrôles). */
  _k: { T: T, L: L, esc: esc, opts: opts, table: table, kpi: kpi, card: card, badge: badge, na: na, date: date, field: field, selectField: selectField, formData: formData,
    msg: msg, rpc: rpc, q: q, client: client, bundle: bundle, refs: refs, host: host, closeHost: closeHost, refreshFiche: refreshFiche, toast: toast, invalidate: invalidate,
    phoneCI: phoneCI, maskPhone: maskPhone, norm: norm, canEdit: canEdit, isDirection: isDirection, CAMPAIGN: CAMPAIGN }
};
function enrolMod(fn, id) {
  if (global.ANAGROCI_COOP_ENROL) return global.ANAGROCI_COOP_ENROL[fn](id);
  alert(T('Module d’enrôlement non chargé : rechargez la page.', 'Enrolment module not loaded: reload the page.'));
}
/* Pas de rendu au chargement : le routeur FIELD BUYING (field-buying.js) appelle render(). */
/* Garde-fou : si une rubrique Field Buying est repeinte par un autre script, les
   emplacements Coopératives vides sont remplis à nouveau (une seule fois par emplacement). */
(function watch() {
  function scan() {
    var k = document.getElementById('fbChannelKpis'), e = document.getElementById('fbCoopEntry'), ch = document.getElementById('fbCoopChannel');
    if ((k && !k.childElementCount && !k.dataset.coopPending) || (e && !e.childElementCount && !e.dataset.coopPending)) {
      if (k) k.dataset.coopPending = '1'; if (e) e.dataset.coopPending = '1'; fillOverview();
    }
    if (ch && !ch.dataset.coopPending && ch.querySelector('.skeleton')) { ch.dataset.coopPending = '1'; fillChannel(ch.getAttribute('data-pid')); }
  }
  function start() { var v = document.getElementById('opsRouteView'); if (!v) return; new MutationObserver(function () { setTimeout(scan, 30); }).observe(v, { childList: true }); scan(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
})(window);
