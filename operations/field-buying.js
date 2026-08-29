/* FIELD BUYING — moteur unique du workspace.
   Remplace field-buying-v2.js (vitrine en lecture seule) en réintégrant les
   capacités métier de l'ancien FBMS dans le shell Operations Suite.

   Principes hérités du correctif LBA Purchase :
   1. Le routeur ANAGROCI_OPS_ROUTE est publié AVANT tout appel réseau.
   2. L'en-tête d'une rubrique (titre + actions) est peint immédiatement ; les
      boutons de création font partie du premier rendu, jamais injectés après.
   3. FBStore : les référentiels (villages, RT, producteurs, achats, géographie)
      se chargent UNE fois en parallèle et se partagent entre rubriques ; le
      reste (sacherie, caisse, hubs, sustainability) se charge à la demande.

   Côté données, RIEN n'est recréé : les tables villages / rt / producteurs /
   achats / avances, la sacherie centrale (ops_bag_requests + ops_release_bags),
   la géographie AFLP (aflp_zones, aflp_clusters, log_hubs, hubs_clusters) et le
   Farmer Registry (farmer_passport_summary_v, next_producteur_code,
   farmer_possible_duplicates) sont réutilisés tels quels. Les règles d'écriture
   restent appliquées par la base (peut_editer_terrain, garde achat ≤ avances,
   stock sacs jamais négatif, anti-doublon RT).
*/
(function (global) {
'use strict';

var OBJECTIF_CAMPAGNE_MT = 3000; /* objectif global campagne 2027 */
/* Barème de l'ancien moteur d'achats, conservé à l'identique. */
var PRIX_CAMPAGNE = 400, COMMISSION_RT = 10, SEUIL_HUMIDITE = 10, SEUIL_KOR = 45;

/* ------------------------------------------------------------------ utilitaires */

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function n(v) { var x = Number(v || 0); return isFinite(x) ? x : 0; }
function num(v, d) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d == null ? 0 : d }).format(n(v));
}
function money(v) { return num(v) + ' FCFA'; }
function mt(kg, d) { return num(n(kg) / 1000, d == null ? 1 : d) + ' MT'; }
function date(v) {
  if (!v) return '—';
  try { return new Intl.DateTimeFormat('fr-FR').format(new Date(v)); } catch (e) { return esc(v); }
}
function daysSince(v) {
  if (!v) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 86400000));
}
function routeParts() {
  return (location.hash || '#overview').slice(1).split('/').map(function (p) {
    try { return decodeURIComponent(p); } catch (e) { return p; }
  });
}
function route() { return routeParts()[0] || 'overview'; }
function badge(s) {
  var x = String(s || '').toUpperCase();
  var c = /REFUS|BLOQ|ERREUR|REJET|RETIRE|ANNUL|EXPIR|ROUGE/.test(x) ? 'danger'
    : /APPROUV|ACTIF|ACTIVE|CONFIRM|ENR|VALID|OK|VERT|RELEASED|RECEIVED|LIBERE/.test(x) ? 'ok'
    : /BROUILLON|ATTENT|PENDING|PRESSENTI|CONTROL|ORANGE|PARTIEL|SUBMITTED|REQUESTED|APPROVED/.test(x) ? 'warn' : 'info';
  return '<span class="badge ' + c + '">' + esc(s || '—') + '</span>';
}
function normName(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
function normPhone(v) { return String(v || '').replace(/[^0-9]/g, ''); }
function uid() { return 'fb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

/* --------------------------------------------------------------------- fragments */

function head(title, sub, actions) {
  return '<div class="ops-route-head"><div><h1>' + esc(title) + '</h1><p>' + esc(sub || '') +
    '</p></div><div class="ops-route-actions">' + (actions || '') + '</div></div>';
}
function empty(msg) { return '<div class="ops-empty">' + esc(msg) + '</div>'; }
function danger(msg) { return '<div class="notice danger"><b>Problème :</b>&nbsp;' + esc(msg) + '</div>'; }
function table(headers, rows) {
  if (!rows.length) return empty('Aucune donnée disponible pour ce périmètre.');
  return '<div class="table-wrap"><table><thead><tr>' +
    headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}
function kpis(items) {
  return '<section class="kpi-grid">' + items.map(function (x) {
    return '<div class="kpi ' + (x[3] || '') + '"><small>' + esc(x[0]) + '</small><b>' +
      esc(x[1]) + '</b><span>' + esc(x[2] || '') + '</span></div>';
  }).join('') + '</section>';
}
function skeletonKpis(count) {
  var out = '';
  for (var i = 0; i < (count || 5); i++) out += '<div class="kpi"><div class="skeleton"></div></div>';
  return '<section class="kpi-grid">' + out + '</section>';
}
function skeletonRows(count) {
  var out = '';
  for (var i = 0; i < (count || 6); i++) out += '<div class="skeleton skeleton-row"></div>';
  return '<section class="card"><div class="ops-skeleton-stack">' + out + '</div></section>';
}
function skeletonPage(k) { return skeletonKpis(k) + skeletonRows(6); }
function field(label, input, span) {
  return '<div class="ops-field' + (span ? ' ops-span-2' : '') + '"><label>' + label + '</label>' + input + '</div>';
}
function selOptions(list, sel) {
  return list.map(function (v) {
    return '<option value="' + esc(v[0]) + '"' + (String(sel) === String(v[0]) ? ' selected' : '') + '>' + esc(v[1]) + '</option>';
  }).join('');
}

/* ------------------------------------------------------------ client et identité */

var root = null, sb = null, profile = {}, clientPromise = null, profilePromise = null;

function makeClient() {
  if (sb) return sb;
  if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) {
    sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON);
  }
  return sb;
}
function client() {
  if (sb) return Promise.resolve(sb);
  if (clientPromise) return clientPromise;
  clientPromise = new Promise(function (resolve) {
    if (makeClient()) return resolve(sb);
    var k = 0;
    var t = setInterval(function () {
      k++;
      if (makeClient()) { clearInterval(t); resolve(sb); }
      else if (k > 120) { clearInterval(t); resolve(null); }
    }, 50);
  });
  return clientPromise;
}
function loadProfile() {
  if (profilePromise) return profilePromise;
  profilePromise = client().then(function (c) {
    if (!c) return null;
    return c.auth.getSession().then(function (s) {
      var u = s.data && s.data.session && s.data.session.user;
      if (!u) return null;
      profile.userId = u.id;
      return c.from('profils').select('nom,role,actif').eq('user_id', u.id).maybeSingle()
        .then(function (r) {
          if (!r.error && r.data) { profile.nom = r.data.nom; profile.role = r.data.role; profile.actif = r.data.actif; }
          return profile;
        });
    });
  }).catch(function () { return null; });
  return profilePromise;
}
/* Miroir client de peut_editer_terrain() ; la base reste l'arbitre. */
var ROLES_TERRAIN = ['Branch Manager', 'Assistant Branch Manager', 'Head of Field',
  'Procurement Officer', 'Supervisor', 'Agent Recenseur', "Chef d'equipe", "Chef d'équipe", 'Administrateur'];
function canEditTerrain() { return ROLES_TERRAIN.indexOf(profile.role) >= 0; }

/* --------------------------------------------------------------------- FBStore */

var TTL = 45000;
var store = Object.create(null);
var FBStore = {
  get: function (key, loader, ttl) {
    var life = ttl || TTL, slot = store[key], now = Date.now();
    if (slot && slot.data !== undefined && (now - slot.at) < life) return Promise.resolve(slot.data);
    if (slot && slot.promise) return slot.promise;
    var p = Promise.resolve().then(loader).then(function (data) {
      store[key] = { data: data, at: Date.now() };
      return data;
    }).catch(function (e) { delete store[key]; throw e; });
    store[key] = { promise: p, at: now };
    return p;
  },
  invalidate: function () { [].slice.call(arguments).forEach(function (k) { delete store[k]; }); },
  clear: function () { store = Object.create(null); }
};

function q(tableName, cols, limit, mod) {
  return client().then(function (c) {
    if (!c) return [];
    var req = c.from(tableName).select(cols || '*');
    if (mod) req = mod(req);
    if (limit) req = req.limit(limit);
    return req.then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return r.data || [];
    });
  });
}

/* Référentiels communs — un seul aller-retour parallèle, partagé partout. */
function base() {
  return FBStore.get('base', function () {
    return Promise.all([
      q('villages', 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,data,deleted', 500),
      q('rt', 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted,data', 500),
      q('farmer_passport_summary_v', 'producteur_id,farmer_id,nom,prenoms,telephone,village_id,village_nom,rt_id,rt_nom,cluster_code,cluster_label,zone_code,zone_label,operational_status,passport_stage,passport_completion,risk_profile,possible_duplicate,review_required,plot_count,gps_mapped_count,last_purchase_date,last_purchase_kg,deleted', 1200),
      q('achats', 'id,date,cluster,village_id,village_nom,rt_id,rt_nom,producteur_id,producteur_code,producteur_nom,poids_net,nb_sacs,prix_kg,montant,mode_paiement,numero_recu,qualite_statut,statut_validation,stock_statut,cash_statut,rejet,kor,humidite,created_at', 1000),
      q('aflp_zones', 'code,label,region,active', 20),
      q('aflp_clusters', 'code,label,zone_code,active', 30)
    ]).then(function (rs) {
      var villages = rs[0].filter(function (x) { return !x.deleted; });
      var rts = rs[1].filter(function (x) { return !x.deleted; });
      var farmers = rs[2].filter(function (x) { return !x.deleted; });
      var achats = rs[3].filter(function (x) { return !x.rejet; });
      villages.sort(function (a, b) { return String(a.village || '').localeCompare(String(b.village || '')); });
      rts.sort(function (a, b) { return String(a.nom || '').localeCompare(String(b.nom || '')); });
      var vm = {}, rm = {};
      villages.forEach(function (v) { vm[v.id] = v; });
      rts.forEach(function (r) { rm[r.id] = r; });
      var clusters = rs[5].filter(function (c) { return c.active !== false; });
      var zones = rs[4].filter(function (z) { return z.active !== false; });
      var zoneOf = {};
      clusters.forEach(function (c) { zoneOf[normName(c.code)] = c.zone_code; zoneOf[normName(c.label)] = c.zone_code; });
      return { villages: villages, rts: rts, farmers: farmers, achats: achats,
               zones: zones, clusters: clusters, vm: vm, rm: rm, zoneOf: zoneOf };
    });
  });
}
function zoneOfCluster(c, cluster) {
  return c.zoneOf[normName(cluster)] || '—';
}

/* Chargements à la demande. */
function bagsData() {
  return FBStore.get('bags', function () {
    return Promise.all([
      q('sacherie_ct_cluster_stock', '*', 50),
      q('sacherie_ct_rt_stock', '*', 400),
      q('ops_bag_requests', 'id,request_code,channel,campaign,cluster,rt_id,requested_qty,approved_qty,released_qty,received_qty,status,requested_at,approved_at,expires_at,destination_location_code,source_location_code', 400),
      q('aflp_bag_envelopes', 'id,campaign,approved_qty,status,approved_at', 20),
      q('aflp_bag_cluster_allocations', 'id,envelope_id,cluster,allocated_qty', 60)
    ]).then(function (rs) {
      return { clusterStock: rs[0], rtStock: rs[1], requests: rs[2], envelopes: rs[3], allocations: rs[4] };
    });
  });
}
function cashData() {
  return FBStore.get('cash', function () {
    return Promise.all([
      q('avances', 'id,date,cluster,rt_id,rt_nom,source,montant,motif,statut,cycle_id,cycle_statut,volume_finance_kg,prix_reference_kg,created_by_nom,created_at', 500),
      q('reconciliations', 'id,date,cluster,rt_id,rt_nom,cash_restant,valeur_stock,total_avance,total_paye,ecart,statut,created_at', 500)
        .catch(function () { return []; })
    ]).then(function (rs) { return { avances: rs[0], recons: rs[1] }; });
  });
}
/* Règle caisse conservée : une nouvelle avance exige la réconciliation de la précédente. */
function lastReconByRt(recons) {
  var m = {};
  recons.forEach(function (r) {
    var k = r.rt_id || normName(r.rt_nom);
    if (!m[k] || new Date(r.created_at) > new Date(m[k].created_at)) m[k] = r;
  });
  return m;
}
function hubsData() {
  return FBStore.get('hubs', function () {
    return Promise.all([
      q('log_hubs', 'cluster,zone,hub_nom,statut_hub,potentiel_mt,distance_km,etat_route,commentaire,updated_at', 50),
      q('hubs_clusters', 'id_hub,nom,region,departement,localite,gps_lat,gps_lng,distance_usine_gps,distance_usine_routiere,statut,deleted', 100)
    ]).then(function (rs) {
      return { logHubs: rs[0], hubs: rs[1].filter(function (h) { return !h.deleted; }) };
    });
  });
}
function sustainabilityData() {
  return FBStore.get('sust', function () {
    return q('farmer_sustainability_dashboard_v', '*', 400);
  });
}

/* Agrégats dérivés des référentiels — calculés une fois par cache. */
function derive(c) {
  var byVillageBuy = {}, byRtBuy = {}, lastRtBuy = {};
  var buyKg = 0, buyVal = 0, dayKg = 0, weekKg = 0;
  var now = Date.now();
  c.achats.forEach(function (a) {
    var kg = n(a.poids_net);
    buyKg += kg; buyVal += n(a.montant);
    byVillageBuy[a.village_id] = (byVillageBuy[a.village_id] || 0) + kg;
    if (a.rt_id) {
      byRtBuy[a.rt_id] = (byRtBuy[a.rt_id] || 0) + kg;
      var d = a.date || a.created_at;
      if (d && (!lastRtBuy[a.rt_id] || new Date(d) > new Date(lastRtBuy[a.rt_id]))) lastRtBuy[a.rt_id] = d;
    }
    var t = new Date(a.date || a.created_at || 0).getTime();
    if (now - t < 86400000) dayKg += kg;
    if (now - t < 7 * 86400000) weekKg += kg;
  });
  var rtByVillage = {};
  c.rts.forEach(function (r) { if (r.village_id) (rtByVillage[r.village_id] = rtByVillage[r.village_id] || []).push(r); });
  var farmersByRt = {}, farmersByVillage = {};
  c.farmers.forEach(function (f) {
    if (f.rt_id) farmersByRt[f.rt_id] = (farmersByRt[f.rt_id] || 0) + 1;
    if (f.village_id) farmersByVillage[f.village_id] = (farmersByVillage[f.village_id] || 0) + 1;
  });
  var potMT = 0, secMT = 0;
  c.villages.forEach(function (v) {
    var s3 = (v.data && v.data.s3) || {};
    potMT += n(s3.potentielMT);
    secMT += n(s3.potentielSecuriseMT);
  });
  return { buyKg: buyKg, buyVal: buyVal, dayKg: dayKg, weekKg: weekKg,
           byVillageBuy: byVillageBuy, byRtBuy: byRtBuy, lastRtBuy: lastRtBuy,
           rtByVillage: rtByVillage, farmersByRt: farmersByRt, farmersByVillage: farmersByVillage,
           potMT: potMT, secMT: secMT };
}

/* ------------------------------------------------------------------ vue d'ensemble */

function renderOverview() {
  paint(head('Vue d’ensemble',
    'Pilotage de la campagne Achat Bord Champ : recensement, achats, sacherie et alertes.',
    '<a class="btn primary" href="#purchases/new">+ Nouvel achat</a><a class="btn secondary" href="#census">Recensement</a>') +
    skeletonPage(6));

  return base().then(function (c) {
    var d = derive(c);
    var activeV = c.villages.filter(function (v) { return v.statut === 'Approuvé BM'; }).length;
    var activeRt = c.rts.filter(function (r) { return r.statut === 'Confirmé'; }).length;
    var noRt = c.villages.filter(function (v) { return !(d.rtByVillage[v.id] || []).length; });
    var noBuy = c.villages.filter(function (v) { return !d.byVillageBuy[v.id]; });
    var idleRt = c.rts.filter(function (r) {
      var last = d.lastRtBuy[r.id];
      return !last || daysSince(last) > 14;
    });
    var pct = OBJECTIF_CAMPAGNE_MT > 0 ? (d.buyKg / 1000) / OBJECTIF_CAMPAGNE_MT * 100 : 0;

    /* Vue par zone puis par cluster : mêmes référentiels, deux niveaux de lecture. */
    var perCluster = {};
    c.villages.forEach(function (v) {
      var k = v.cluster || '—';
      var s = perCluster[k] = perCluster[k] || { zone: zoneOfCluster(c, k), villages: 0, rts: 0, farmers: 0, pot: 0, sec: 0, buy: 0 };
      s.villages++;
      s.rts += (d.rtByVillage[v.id] || []).length;
      s.farmers += d.farmersByVillage[v.id] || 0;
      var s3 = (v.data && v.data.s3) || {};
      s.pot += n(s3.potentielMT); s.sec += n(s3.potentielSecuriseMT);
      s.buy += d.byVillageBuy[v.id] || 0;
    });

    paint(head('Vue d’ensemble',
      'Pilotage de la campagne Achat Bord Champ : recensement, achats, sacherie et alertes.',
      '<a class="btn primary" href="#purchases/new">+ Nouvel achat</a><a class="btn secondary" href="#census">Recensement</a>') +
      kpis([
        ['Objectif campagne', mt(d.buyKg) + ' / ' + num(OBJECTIF_CAMPAGNE_MT) + ' MT', num(pct, 1) + ' % réalisés'],
        ['Achats du jour', mt(d.dayKg), 'semaine : ' + mt(d.weekKg)],
        ['Montant acheté', money(d.buyVal), c.achats.length + ' achat(s)'],
        ['Villages', String(c.villages.length), activeV + ' approuvé(s) BM'],
        ['RT', String(c.rts.length), activeRt + ' confirmé(s)'],
        ['Producteurs recensés', String(c.farmers.length), 'Farmer Registry']
      ]) +
      kpis([
        ['Volume potentiel', mt(d.potMT * 1000), 'recensement villages'],
        ['Volume sécurisé', mt(d.secMT * 1000), 'engagements RT'],
        ['Villages sans RT', String(noRt.length), noRt.length ? 'à couvrir' : 'tous couverts', noRt.length ? 'warn' : ''],
        ['Villages sans achat', String(noBuy.length), 'depuis le début de campagne', noBuy.length > c.villages.length / 2 ? 'warn' : ''],
        ['RT sans activité 14 j', String(idleRt.length), 'aucun achat récent', idleRt.length ? 'warn' : ''],
        ['Alertes', String(noRt.length + idleRt.length), 'détail au Command Center', (noRt.length + idleRt.length) ? 'warn' : '']
      ]) +
      '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Par zone et cluster</h2>' +
      '<p>Villages, RT, producteurs, potentiel et achats par cluster AFLP.</p></div>' +
      '<div class="ops-route-actions"><a class="btn secondary" href="#hubs">Carte →</a></div></div>' +
      table(['Zone', 'Cluster', 'Villages', 'RT', 'Producteurs', 'Potentiel', 'Sécurisé', 'Acheté'],
        Object.keys(perCluster).sort().map(function (k) {
          var s = perCluster[k];
          return '<tr class="ops-click" onclick="location.hash=\'#hubs/' + encodeURIComponent(k) + '\'">' +
            '<td>' + esc(s.zone) + '</td><td><b>' + esc(k) + '</b></td><td>' + s.villages + '</td>' +
            '<td>' + s.rts + '</td><td>' + s.farmers + '</td><td>' + num(s.pot, 1) + ' MT</td>' +
            '<td>' + num(s.sec, 1) + ' MT</td><td>' + mt(s.buy) + '</td></tr>';
        })) +
      '</section><section class="card"><div class="card-head"><div><h2>Accès rapide</h2>' +
      '<p>Toutes les rubriques restent dans FIELD BUYING.</p></div></div><div class="quick-grid">' +
      '<a class="quick" href="#census"><b>Recensement</b><span>Villages, RT et producteurs.</span><em>Ouvrir →</em></a>' +
      '<a class="quick" href="#purchases"><b>Achat Bord Champ</b><span>Saisir et suivre les achats.</span><em>Ouvrir →</em></a>' +
      '<a class="quick" href="#bags"><b>Sacherie AFLP</b><span>Demandes, sorties et balances RT.</span><em>Ouvrir →</em></a>' +
      '<a class="quick" href="#command"><b>Command Center</b><span>Alertes et exceptions terrain.</span><em>Ouvrir →</em></a>' +
      '</div></section></div>');
  });
}

/* ------------------------------------------------------------------- recensement */

function censusActions() {
  return '<button class="btn primary ops-cta-create" type="button" onclick="ANAGROCI_FB.openVillageForm()">+ Nouveau village</button>' +
    '<button class="btn primary" type="button" onclick="ANAGROCI_FB.openFarmerForm()">+ Nouveau producteur</button>' +
    '<button class="btn primary" type="button" onclick="ANAGROCI_FB.openRtForm()">+ Nouveau RT</button>';
}
function createHost() { return '<section id="fbFormHost" class="ops-form-card" hidden></section>'; }

function renderCensus() {
  paint(head('Recensement', 'Créer et suivre villages, RT et producteurs — la porte d’entrée du terrain.',
    censusActions()) + createHost() + skeletonPage(4));

  return base().then(function (c) {
    var d = derive(c);
    var recentV = c.villages.slice().sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); }).slice(0, 8);
    paint(head('Recensement', 'Créer et suivre villages, RT et producteurs — la porte d’entrée du terrain.',
      censusActions()) + createHost() +
      kpis([
        ['Villages', String(c.villages.length), c.villages.filter(function (v) { return v.statut === 'Brouillon'; }).length + ' brouillon(s)'],
        ['RT', String(c.rts.length), c.rts.filter(function (r) { return r.statut === 'Pressenti'; }).length + ' pressenti(s)'],
        ['Producteurs', String(c.farmers.length), c.farmers.filter(function (f) { return f.review_required; }).length + ' à revoir'],
        ['Sans parcelle GPS', String(c.farmers.filter(function (f) { return !n(f.gps_mapped_count); }).length), 'parcelle à compléter après campagne — jamais bloquant']
      ]) +
      '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Derniers villages</h2>' +
      '<p>Le détail complet est dans RT &amp; Villages.</p></div>' +
      '<div class="ops-route-actions"><a class="btn secondary" href="#rt">Tout voir</a></div></div>' +
      table(['Village', 'Cluster', 'RT', 'Producteurs', 'Statut'], recentV.map(function (v) {
        return '<tr><td><b>' + esc(v.village) + '</b></td><td>' + esc(v.cluster || '—') + '</td>' +
          '<td>' + (d.rtByVillage[v.id] || []).length + '</td><td>' + (d.farmersByVillage[v.id] || 0) + '</td>' +
          '<td>' + badge(v.statut) + '</td></tr>';
      })) +
      '</section><section class="card"><div class="card-head"><div><h2>Règles du recensement</h2></div></div>' +
      '<div class="notice ok"><b>Règle campagne 2027 :</b> la parcelle/GPS est facultative. Son absence ne bloque ' +
      'jamais la création du producteur ni l’achat — afficher « Parcelle à compléter après campagne ».</div>' +
      '<div class="notice info">Le code producteur est généré automatiquement par village. ' +
      'Les doublons (nom, téléphone) sont détectés avant enregistrement.</div></section></div>');
  });
}

/* --- Formulaire village : réutilise la structure s1…s9 du recensement FBMS. --- */

function openVillageForm() {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), loadProfile()]).then(function (rs) {
    var c = rs[0];
    if (!guardTerrain(host)) return;
    var clusterOpts = selOptions(c.clusters.map(function (x) { return [x.label, x.label + ' (' + (x.zone_code || '') + ')']; }), '');
    host.innerHTML = '<div class="card-head"><div><h2>Nouveau village</h2>' +
      '<p>Mêmes sections que le recensement terrain : identité, potentiel, accès, risques.</p></div></div>' +
      '<form id="villageForm"><div class="ops-form-grid">' +
      field('Nom du village *', '<input id="vf_nom" required maxlength="120">', true) +
      field('Cluster *', '<select id="vf_cluster" required><option value="">Choisir…</option>' + clusterOpts + '</select>') +
      field('Région', '<input id="vf_region" placeholder="Ex. Gbêkê">') +
      field('Département', '<input id="vf_dept" placeholder="Ex. Bouaké">') +
      field('Sous-préfecture', '<input id="vf_sp">') +
      field('GPS latitude', '<input id="vf_lat" type="number" step="any" placeholder="Facultatif">') +
      field('GPS longitude', '<input id="vf_lng" type="number" step="any" placeholder="Facultatif">') +
      field('Distance au hub (km)', '<input id="vf_dist" type="number" step="any" min="0">') +
      field('Potentiel (MT)', '<input id="vf_pot" type="number" step="any" min="0">') +
      field('Potentiel sécurisé (MT)', '<input id="vf_sec" type="number" step="any" min="0">') +
      field('Nombre de producteurs estimé', '<input id="vf_nbprod" type="number" min="0">') +
      field('État de la route', '<select id="vf_route"><option value="">—</option><option>Bitumée</option><option>Piste praticable</option><option>Piste difficile</option></select>') +
      field('Accès camion', '<select id="vf_camion"><option value="">—</option><option value="10T">Camion 10T</option><option value="30T">Camion 30T</option><option value="Aucun">Aucun</option></select>') +
      field('Acheteur dominant (concurrence)', '<input id="vf_conc">') +
      field('Risques', '<input id="vf_risques" placeholder="Ex. conflit foncier, zone hors cluster">', true) +
      '</div><div id="vf_dup"></div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="vf_submit">Créer le village</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="vf_msg" class="muted" style="margin-top:10px"></div></form>';

    var nom = document.getElementById('vf_nom');
    nom.focus();
    nom.addEventListener('input', function () {
      var k = normName(nom.value);
      var hit = c.villages.filter(function (v) { return normName(v.village) === k; })[0];
      document.getElementById('vf_dup').innerHTML = hit
        ? '<div class="notice danger"><b>Un village de ce nom existe déjà :</b> ' + esc(hit.village) +
          ' (' + esc(hit.cluster || '—') + '). Vérifiez avant de créer un doublon.</div>' : '';
    });

    document.getElementById('villageForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('vf_msg'), btn = document.getElementById('vf_submit');
      var name = nom.value.trim(), cluster = document.getElementById('vf_cluster').value;
      if (!name || !cluster) { msg.className = 'ops-danger-text'; msg.textContent = 'Nom et cluster sont obligatoires.'; return; }
      var lat = document.getElementById('vf_lat').value, lng = document.getElementById('vf_lng').value;
      var id = uid();
      /* Même structure que l'ancien recensement : colonnes synchronisées + data s1…s9. */
      var data = {
        id: id, statut: 'Brouillon', createdAt: new Date().toISOString(), createdBy: profile.nom || '',
        s1: { village: name, cluster: cluster, region: document.getElementById('vf_region').value.trim(),
              departement: document.getElementById('vf_dept').value.trim(),
              sousPrefecture: document.getElementById('vf_sp').value.trim(),
              gpsLat: lat ? Number(lat) : null, gpsLng: lng ? Number(lng) : null,
              distanceHub: n(document.getElementById('vf_dist').value) || null,
              enqueteur: profile.nom || '', dateVisite: new Date().toISOString().slice(0, 10) },
        s3: { potentielMT: n(document.getElementById('vf_pot').value) || null,
              potentielSecuriseMT: n(document.getElementById('vf_sec').value) || null,
              nbProducteurs: n(document.getElementById('vf_nbprod').value) || null },
        s4: { dominant: document.getElementById('vf_conc').value.trim() },
        s5: { typeAcces: document.getElementById('vf_route').value,
              camion10T: document.getElementById('vf_camion').value === '10T' || document.getElementById('vf_camion').value === '30T',
              camion30T: document.getElementById('vf_camion').value === '30T' },
        s8: { risques: document.getElementById('vf_risques').value.trim() }
      };
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Création en cours…';
      client().then(function (cl) {
        return cl.from('villages').insert({
          id: id, village: name, cluster: cluster, statut: 'Brouillon',
          region: data.s1.region || null, departement: data.s1.departement || null,
          gps_lat: data.s1.gpsLat, gps_lng: data.s1.gpsLng, data: data
        });
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        msg.className = 'ops-ok-text'; msg.textContent = 'Village créé : ' + name + '. Visible dans RT & Villages, la carte et le Command Center.';
        FBStore.invalidate('base');
        setTimeout(function () { closeForm(); render(); }, 900);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Création impossible.';
      });
    });
  });
}

/* --- Formulaire RT : réutilise la table rt et son anti-doublon serveur. --- */

function openRtForm(prefill) {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), loadProfile()]).then(function (rs) {
    var c = rs[0];
    if (!guardTerrain(host)) return;
    var villageOpts = selOptions(c.villages.map(function (v) { return [v.id, v.village + ' · ' + (v.cluster || '—')]; }), prefill && prefill.village_id || '');
    host.innerHTML = '<div class="card-head"><div><h2>Nouveau RT</h2>' +
      '<p>Le RT est rattaché à un village ; son cluster en découle.</p></div></div>' +
      '<form id="rtForm"><div class="ops-form-grid">' +
      field('Nom du RT *', '<input id="rf_nom" required maxlength="120">', true) +
      field('Téléphone', '<input id="rf_tel" inputmode="tel" placeholder="Ex. 07 00 00 00 00">') +
      field('Village *', '<select id="rf_village" required><option value="">Choisir…</option>' + villageOpts + '</select>') +
      field('Statut', '<select id="rf_statut"><option>Pressenti</option><option>Confirmé</option><option>Actif</option></select>') +
      field('Activité', '<select id="rf_act"><option value="">—</option><option>Producteur</option><option>Pisteur</option><option>Commerçant</option><option>Autre</option></select>') +
      '</div><div id="rf_dup"></div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="rf_submit">Créer le RT</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="rf_msg" class="muted" style="margin-top:10px"></div></form>';

    var nom = document.getElementById('rf_nom'), tel = document.getElementById('rf_tel');
    if (prefill && prefill.nom) nom.value = prefill.nom;
    nom.focus();
    function checkDup() {
      var k = normName(nom.value), t = normPhone(tel.value);
      var hit = c.rts.filter(function (r) {
        return (k && normName(r.nom) === k) || (t && t.length >= 8 && normPhone(r.telephone) === t);
      })[0];
      document.getElementById('rf_dup').innerHTML = hit
        ? '<div class="notice danger"><b>Un RT très proche existe déjà :</b> ' + esc(hit.nom) +
          ' · ' + esc(hit.village_nom || '—') + '. Vérifiez avant de créer un doublon.</div>' : '';
    }
    nom.addEventListener('input', checkDup);
    tel.addEventListener('input', checkDup);

    document.getElementById('rtForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('rf_msg'), btn = document.getElementById('rf_submit');
      var name = nom.value.trim(), vid = document.getElementById('rf_village').value;
      if (!name || !vid) { msg.className = 'ops-danger-text'; msg.textContent = 'Nom et village sont obligatoires.'; return; }
      var v = c.vm[vid] || {};
      var id = uid();
      var data = { id: id, nom: name, telephone: tel.value.trim(), villageId: vid, villageNom: v.village || '',
        cluster: v.cluster || '', statut: document.getElementById('rf_statut').value,
        activite: document.getElementById('rf_act').value, createdAt: new Date().toISOString(), createdBy: profile.nom || '' };
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Création en cours…';
      client().then(function (cl) {
        return cl.from('rt').insert({
          id: id, nom: name, telephone: tel.value.trim() || null, village_id: vid,
          village_nom: v.village || null, cluster: v.cluster || null,
          statut: document.getElementById('rf_statut').value, data: data
        });
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        msg.className = 'ops-ok-text'; msg.textContent = 'RT créé : ' + name + '.';
        FBStore.invalidate('base');
        setTimeout(function () { closeForm(); render(); }, 900);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Création impossible.';
      });
    });
  });
}

/* --- Formulaire producteur : Farmer Registry existant, code auto, anti-doublon serveur. --- */

function openFarmerForm(prefill) {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), loadProfile()]).then(function (rs) {
    var c = rs[0];
    if (!guardTerrain(host)) return;
    var villageOpts = selOptions(c.villages.map(function (v) { return [v.id, v.village + ' · ' + (v.cluster || '—')]; }), prefill && prefill.village_id || '');
    host.innerHTML = '<div class="card-head"><div><h2>Nouveau producteur</h2>' +
      '<p>Le Farmer ID est généré automatiquement par village. La parcelle/GPS est facultative et ne bloque jamais.</p></div></div>' +
      '<form id="farmerForm"><div class="ops-form-grid">' +
      field('Nom *', '<input id="ff_nom" required maxlength="120">') +
      field('Prénoms', '<input id="ff_prenoms" maxlength="120">') +
      field('Téléphone', '<input id="ff_tel" inputmode="tel">') +
      field('Village *', '<select id="ff_village" required><option value="">Choisir…</option>' + villageOpts + '</select>') +
      field('RT', '<select id="ff_rt"><option value="">Aucun / à rattacher</option></select>') +
      field('Sexe', '<select id="ff_sexe"><option value="">—</option><option value="H">Homme</option><option value="F">Femme</option></select>') +
      '</div>' +
      '<div class="notice info">Parcelle à compléter après campagne : l’absence de parcelle/GPS n’empêche ni la création, ni l’achat, ni le lot.</div>' +
      '<div id="ff_dup"></div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="ff_submit">Créer le producteur</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="ff_msg" class="muted" style="margin-top:10px"></div></form>';

    var nom = document.getElementById('ff_nom'), tel = document.getElementById('ff_tel');
    var villageSel = document.getElementById('ff_village'), rtSel = document.getElementById('ff_rt');
    if (prefill) {
      if (prefill.nom) nom.value = prefill.nom;
      if (prefill.telephone) tel.value = prefill.telephone;
    }
    function syncRt() {
      var vid = villageSel.value;
      var list = c.rts.filter(function (r) { return r.village_id === vid; });
      rtSel.innerHTML = '<option value="">Aucun / à rattacher</option>' +
        selOptions(list.map(function (r) { return [r.id, r.nom]; }), prefill && prefill.rt_id || '');
    }
    villageSel.addEventListener('change', syncRt);
    syncRt();
    nom.focus();

    /* Anti-doublon : d'abord local (instantané), puis la routine serveur avant l'envoi. */
    function checkDupLocal() {
      var k = normName(nom.value), t = normPhone(tel.value);
      var hit = c.farmers.filter(function (f) {
        return (k && normName(f.nom + ' ' + (f.prenoms || '')) === k) ||
               (t && t.length >= 8 && normPhone(f.telephone) === t);
      })[0];
      document.getElementById('ff_dup').innerHTML = hit
        ? '<div class="notice danger"><b>Un producteur très proche existe déjà :</b> ' +
          esc(hit.farmer_id || hit.producteur_id) + ' · ' + esc(hit.nom) + ' (' + esc(hit.village_nom || '—') + ').</div>' : '';
    }
    nom.addEventListener('input', checkDupLocal);
    tel.addEventListener('input', checkDupLocal);

    document.getElementById('farmerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('ff_msg'), btn = document.getElementById('ff_submit');
      var name = nom.value.trim(), vid = villageSel.value;
      if (!name || !vid) { msg.className = 'ops-danger-text'; msg.textContent = 'Nom et village sont obligatoires.'; return; }
      var v = c.vm[vid] || {};
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Contrôle des doublons…';
      client().then(function (cl) {
        return cl.rpc('farmer_possible_duplicates', {
          p_nom: name, p_telephone: tel.value.trim() || null, p_village_id: vid, p_exclude_id: null
        }).then(function (dup) {
          var hits = (dup.data || []);
          if (!dup.error && hits.length) {
            btn.disabled = false; msg.className = 'ops-danger-text';
            msg.textContent = 'Doublon possible détecté côté référentiel (' + hits.length + '). Vérifiez la liste des producteurs avant de recréer.';
            return null;
          }
          msg.textContent = 'Création en cours…';
          var id = uid();
          return cl.from('producteurs').insert({
            id: id, nom: name, prenoms: document.getElementById('ff_prenoms').value.trim() || null,
            telephone: tel.value.trim() || null, village_id: vid, village_nom: v.village || null,
            rt_id: rtSel.value || null, sexe: document.getElementById('ff_sexe').value || null,
            statut: 'Identifié', data: { id: id, source: 'OPERATIONS_FIELD_BUYING' }
          }).then(function (r) {
            btn.disabled = false;
            if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
            msg.className = 'ops-ok-text';
            msg.textContent = 'Producteur créé : ' + name + '. Le Farmer ID est attribué par le référentiel.';
            FBStore.invalidate('base');
            setTimeout(function () { closeForm(); location.hash = '#farmers'; render(); }, 900);
          });
        });
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Création impossible.';
      });
    });
  });
}

function formHost() {
  var host = document.getElementById('fbFormHost');
  if (!host) {
    host = document.createElement('section');
    host.id = 'fbFormHost';
    host.className = 'ops-form-card';
    var h = document.querySelector('.ops-route-head');
    if (h) h.insertAdjacentElement('afterend', host); else if (root) root.prepend(host);
  }
  host.hidden = false;
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return host;
}
function guardTerrain(host) {
  if (canEditTerrain()) return true;
  host.innerHTML = '<div class="notice danger"><b>Création non autorisée.</b> Votre profil (' +
    esc(profile.role || 'non identifié') + ') ne permet pas de modifier le référentiel terrain.</div>' +
    '<div class="ops-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Fermer</button></div>';
  return false;
}
function closeForm() {
  var host = document.getElementById('fbFormHost');
  if (host) { host.hidden = true; host.innerHTML = ''; }
}

/* ------------------------------------------------------------------- producteurs */

var farmerFilter = { q: '', village: '', statut: '' };

function renderFarmers(id) {
  if (id) return renderFarmerPassport(id);
  paint(head('Producteurs', 'Farmer Registry : identité, passeport et activité de chaque producteur.',
    '<button class="btn primary ops-cta-create" id="newFarmerBtn" type="button" onclick="ANAGROCI_FB.openFarmerForm()">+ Nouveau producteur</button>') +
    createHost() + skeletonPage(4));

  return base().then(function (c) {
    var villages = selOptions(c.villages.map(function (v) { return [v.id, v.village]; }), farmerFilter.village);
    paint(head('Producteurs', 'Farmer Registry : identité, passeport et activité de chaque producteur.',
      '<button class="btn primary ops-cta-create" id="newFarmerBtn" type="button" onclick="ANAGROCI_FB.openFarmerForm()">+ Nouveau producteur</button>') +
      createHost() +
      kpis([
        ['Producteurs', String(c.farmers.length), 'au référentiel'],
        ['Parcelle GPS levée', String(c.farmers.filter(function (f) { return n(f.gps_mapped_count) > 0; }).length), 'facultative — jamais bloquante'],
        ['À revoir', String(c.farmers.filter(function (f) { return f.review_required; }).length), 'contrôle doublon / identité'],
        ['Avec achats', String(c.farmers.filter(function (f) { return f.last_purchase_date; }).length), 'campagne en cours']
      ]) +
      '<section class="card"><div class="card-head"><div><h2>Recherche</h2></div></div><div class="ops-form-grid">' +
      field('Nom, Farmer ID ou téléphone', '<input id="pfQ" value="' + esc(farmerFilter.q) + '" placeholder="Rechercher…">') +
      field('Village', '<select id="pfVillage"><option value="">Tous</option>' + villages + '</select>') +
      '</div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Producteurs</h2>' +
      '<p>Cliquez sur une ligne pour ouvrir le Farmer Passport.</p></div></div><div id="farmerTable"></div></section>');

    function apply() {
      var k = normName(farmerFilter.q), t = normPhone(farmerFilter.q);
      var list = c.farmers.filter(function (f) {
        if (farmerFilter.village && f.village_id !== farmerFilter.village) return false;
        if (!farmerFilter.q) return true;
        return normName(f.nom + ' ' + (f.prenoms || '') + ' ' + (f.farmer_id || '')).indexOf(k) >= 0 ||
               (t.length >= 4 && normPhone(f.telephone).indexOf(t) >= 0);
      });
      document.getElementById('farmerTable').innerHTML = table(
        ['Farmer ID', 'Nom', 'Téléphone', 'Village', 'RT', 'Cluster', 'Statut', 'Parcelle', 'Dernier achat'],
        list.slice(0, 200).map(function (f) {
          return '<tr class="ops-click" onclick="location.hash=\'#farmers/' + encodeURIComponent(f.producteur_id) + '\'">' +
            '<td class="mono">' + esc(f.farmer_id || '—') + '</td>' +
            '<td><b>' + esc(f.nom) + '</b>' + (f.prenoms ? ' ' + esc(f.prenoms) : '') + '</td>' +
            '<td>' + esc(f.telephone || '—') + '</td><td>' + esc(f.village_nom || '—') + '</td>' +
            '<td>' + esc(f.rt_nom || '—') + '</td><td>' + esc(f.cluster_label || f.cluster_code || '—') + '</td>' +
            '<td>' + badge(f.operational_status || 'Enrôlé') + '</td>' +
            '<td>' + (n(f.gps_mapped_count) > 0 ? badge('GPS levé') : '<span class="muted">à compléter après campagne</span>') + '</td>' +
            '<td>' + date(f.last_purchase_date) + '</td></tr>';
        }));
    }
    document.getElementById('pfQ').addEventListener('input', function () { farmerFilter.q = this.value; apply(); });
    document.getElementById('pfVillage').addEventListener('change', function () { farmerFilter.village = this.value; apply(); });
    apply();
  });
}

/* Farmer Passport — le passeport existant, rendu dans le shell Operations. */
function renderFarmerPassport(id) {
  paint(head('Farmer Passport', 'Chargement du producteur…',
    '<a class="btn secondary" href="#farmers">← Producteurs</a>') + skeletonPage(8));

  return Promise.all([base(), client()]).then(function (rs) {
    var c = rs[0];
    var f = c.farmers.filter(function (x) { return x.producteur_id === id || x.farmer_id === id; })[0];
    if (!f) {
      paint(head('Farmer Passport', 'Producteur introuvable.',
        '<a class="btn secondary" href="#farmers">← Producteurs</a>') + empty('Aucun producteur ne porte cet identifiant.'));
      return;
    }
    var mine = c.achats.filter(function (a) { return a.producteur_id === f.producteur_id || a.producteur_code === f.farmer_id; });
    var kg = mine.reduce(function (t, a) { return t + n(a.poids_net); }, 0);
    var val = mine.reduce(function (t, a) { return t + n(a.montant); }, 0);

    paint(head((f.farmer_id || '—') + ' · ' + f.nom + (f.prenoms ? ' ' + f.prenoms : ''),
      'Farmer Passport · identité, achats, sacherie, sustainability et traçabilité.',
      '<a class="btn secondary" href="#purchases/new/' + encodeURIComponent(f.producteur_id) + '">+ Nouvel achat</a>' +
      '<a class="btn secondary" href="#farmers">← Producteurs</a>') +

      '<section class="card"><div class="card-head"><div><h2>Identité</h2></div></div><div class="ops-def-grid">' +
      [['Farmer ID', f.farmer_id || '—'], ['Nom', f.nom + (f.prenoms ? ' ' + f.prenoms : '')],
       ['Téléphone', f.telephone || '—'], ['Village', f.village_nom || '—'],
       ['Cluster', f.cluster_label || f.cluster_code || '—'], ['Zone', f.zone_label || f.zone_code || '—'],
       ['RT', f.rt_nom || '—'], ['Statut', f.operational_status || 'Enrôlé']].map(function (d) {
        return '<div><small>' + esc(d[0]) + '</small><b>' + esc(d[1]) + '</b></div>';
      }).join('') + '</div></section>' +

      kpis([
        ['Passeport', esc(f.passport_stage || '—'), n(f.passport_completion) + ' % complet'],
        ['Parcelles', String(n(f.plot_count)), n(f.gps_mapped_count) > 0 ? n(f.gps_mapped_count) + ' GPS levée(s)' : 'parcelle à compléter après campagne'],
        ['Achats campagne', mt(kg), mine.length + ' achat(s)'],
        ['Montant', money(val), 'Achat Bord Champ'],
        ['Risque', esc(f.risk_profile || '—'), f.review_required ? 'revue requise' : 'aucune revue demandée', f.review_required ? 'warn' : ''],
        ['Dernier achat', date(f.last_purchase_date), f.last_purchase_kg ? num(f.last_purchase_kg) + ' kg' : '']
      ]) +

      '<section class="card"><div class="card-head"><div><h2>Achats Bord Champ</h2>' +
      '<p>Volet commercial du producteur — le détail complet est dans la rubrique Achat Bord Champ.</p></div></div>' +
      table(['Date', 'Poids net', 'Sacs', 'Prix', 'Montant', 'Paiement', 'Validation', 'Stock'],
        mine.slice(0, 15).map(function (a) {
          return '<tr><td>' + date(a.date) + '</td><td>' + num(a.poids_net) + ' kg</td>' +
            '<td>' + n(a.nb_sacs) + '</td><td>' + num(a.prix_kg) + ' /kg</td>' +
            '<td>' + money(a.montant) + '</td><td>' + esc(a.mode_paiement || '—') + '</td>' +
            '<td>' + badge(a.statut_validation) + '</td><td>' + badge(a.stock_statut) + '</td></tr>';
        })) + '</section>' +

      '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Sustainability</h2></div></div>' +
      '<p class="muted">Baselines et formations du producteur — vue détaillée dans la rubrique Sustainability.</p>' +
      '<div class="ops-actions"><a class="btn secondary" href="#sustainability">Ouvrir Sustainability</a></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Traceability</h2></div></div>' +
      '<p class="muted">Chaîne Farmer → Achat → Sacs → Lot → Warehouse → Factory.</p>' +
      '<div class="ops-actions"><a class="btn secondary" href="#traceability/' + encodeURIComponent(f.farmer_id || f.nom) + '">Tracer ce producteur</a></div></section></div>');
  });
}

/* ------------------------------------------------------------------ RT & Villages */

var rtTab = 'villages';
var rtFilter = { cluster: '', statut: '', q: '' };

function renderRt(sub) {
  if (sub) rtTab = sub;
  paint(head('RT & Villages', 'Gestion du référentiel : villages, RT, affectations et anomalies.',
    censusActions()) + createHost() + skeletonPage(4));

  return base().then(function (c) {
    var d = derive(c);
    function tabs() {
      return '<div class="ops-actions" style="margin-bottom:14px">' +
        [['villages', 'Villages'], ['rts', 'RT'], ['assign', 'Producteurs par RT'], ['anomalies', 'Anomalies']].map(function (t) {
          return '<a class="btn ' + (rtTab === t[0] ? 'primary' : 'secondary') + '" href="#rt/' + t[0] + '">' + t[1] + '</a>';
        }).join('') + '</div>';
    }
    var clusterOpts = selOptions(c.clusters.map(function (x) { return [x.label, x.label]; }), rtFilter.cluster);
    var html = head('RT & Villages', 'Gestion du référentiel : villages, RT, affectations et anomalies.',
      censusActions()) + createHost() + tabs() +
      '<section class="card"><div class="card-head"><div><h2>Filtres</h2></div></div><div class="ops-form-grid">' +
      field('Recherche', '<input id="rtQ" value="' + esc(rtFilter.q) + '" placeholder="Nom, village, téléphone…">') +
      field('Cluster', '<select id="rtCluster"><option value="">Tous</option>' + clusterOpts + '</select>') +
      '</div></section><div id="rtBody"></div>';
    paint(html);

    function match(txt) {
      if (!rtFilter.q) return true;
      return normName(txt).indexOf(normName(rtFilter.q)) >= 0;
    }
    function draw() {
      var body = document.getElementById('rtBody'), out = '';
      if (rtTab === 'villages') {
        var list = c.villages.filter(function (v) {
          return (!rtFilter.cluster || v.cluster === rtFilter.cluster) && match(v.village + ' ' + (v.cluster || ''));
        });
        out = '<section class="card">' + table(
          ['Village', 'Cluster', 'Région', 'Statut', 'RT', 'Producteurs', 'Potentiel', 'Acheté', 'GPS'],
          list.map(function (v) {
            var s3 = (v.data && v.data.s3) || {};
            return '<tr><td><b>' + esc(v.village) + '</b></td><td>' + esc(v.cluster || '—') + '</td>' +
              '<td>' + esc(v.region || '—') + '</td><td>' + badge(v.statut) + '</td>' +
              '<td>' + (d.rtByVillage[v.id] || []).map(function (r) { return esc(r.nom); }).join(', ') + '</td>' +
              '<td>' + (d.farmersByVillage[v.id] || 0) + '</td>' +
              '<td>' + (s3.potentielMT != null ? num(s3.potentielMT, 1) + ' MT' : '—') + '</td>' +
              '<td>' + mt(d.byVillageBuy[v.id] || 0) + '</td>' +
              '<td>' + (v.gps_lat != null ? badge('GPS') : '—') + '</td></tr>';
          })) + '</section>';
      } else if (rtTab === 'rts') {
        var list2 = c.rts.filter(function (r) {
          return (!rtFilter.cluster || r.cluster === rtFilter.cluster) && match(r.nom + ' ' + (r.village_nom || '') + ' ' + (r.telephone || ''));
        });
        out = '<section class="card">' + table(
          ['RT ID', 'Nom', 'Téléphone', 'Village', 'Cluster', 'Activité', 'Statut', 'Producteurs', 'Achats', 'Dernière activité', ''],
          list2.map(function (r) {
            var act = (r.data && r.data.activite) || '—';
            var isProd = /producteur/i.test(String(act));
            return '<tr><td class="mono">' + esc(r.id_rt || '—') + '</td><td><b>' + esc(r.nom) + '</b></td>' +
              '<td>' + esc(r.telephone || '—') + '</td><td>' + esc(r.village_nom || '—') + '</td>' +
              '<td>' + esc(r.cluster || '—') + '</td><td>' + esc(act) + '</td><td>' + badge(r.statut) + '</td>' +
              '<td>' + (d.farmersByRt[r.id] || 0) + '</td><td>' + mt(d.byRtBuy[r.id] || 0) + '</td>' +
              '<td>' + date(d.lastRtBuy[r.id]) + '</td>' +
              '<td>' + (isProd ? '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.rtToFarmer(\'' + esc(r.id) + '\')">→ Producteur</button>' : '') + '</td></tr>';
          })) + '</section>';
      } else if (rtTab === 'assign') {
        var rows = c.rts.filter(function (r) { return !rtFilter.cluster || r.cluster === rtFilter.cluster; })
          .map(function (r) {
            var mine = c.farmers.filter(function (f) { return f.rt_id === r.id; });
            return '<tr><td><b>' + esc(r.nom) + '</b><br><span class="muted">' + esc(r.village_nom || '—') + '</span></td>' +
              '<td>' + mine.length + '</td><td>' + mine.slice(0, 6).map(function (f) {
                return '<a href="#farmers/' + encodeURIComponent(f.producteur_id) + '">' + esc(f.farmer_id || f.nom) + '</a>';
              }).join(' · ') + (mine.length > 6 ? ' · …' : '') + '</td></tr>';
          });
        out = '<section class="card">' + table(['RT', 'Producteurs', 'Rattachés'], rows) + '</section>';
      } else {
        var an = [];
        c.villages.forEach(function (v) {
          if (!(d.rtByVillage[v.id] || []).length) an.push(['Village sans RT', v.village, '#rt/villages', 'danger']);
        });
        c.rts.forEach(function (r) {
          if (!r.village_id) an.push(['RT sans village', r.nom, '#rt/rts', 'danger']);
          var last = d.lastRtBuy[r.id];
          if (!last || daysSince(last) > 14) an.push(['RT sans activité récente', r.nom + ' · ' + (r.village_nom || '—'), '#rt/rts', 'warn']);
        });
        c.farmers.forEach(function (f) {
          if (f.possible_duplicate) an.push(['Doublon producteur possible', (f.farmer_id || '') + ' · ' + f.nom, '#farmers/' + encodeURIComponent(f.producteur_id), 'warn']);
        });
        out = '<section class="card">' + table(['Anomalie', 'Objet', ''], an.map(function (a) {
          return '<tr><td>' + badge(a[0]) + '</td><td>' + esc(a[1]) + '</td>' +
            '<td><a class="btn secondary" href="' + a[2] + '">Ouvrir</a></td></tr>';
        })) + '</section>';
      }
      body.innerHTML = out;
    }
    document.getElementById('rtQ').addEventListener('input', function () { rtFilter.q = this.value; draw(); });
    document.getElementById('rtCluster').addEventListener('change', function () { rtFilter.cluster = this.value; draw(); });
    draw();
  });
}

/* Pont RT → Producteur : préremplit le Farmer Registry depuis la fiche RT. */
function rtToFarmer(rtId) {
  base().then(function (c) {
    var r = c.rm[rtId];
    if (!r) return;
    location.hash = '#farmers';
    setTimeout(function () {
      openFarmerForm({ nom: r.nom, telephone: r.telephone, village_id: r.village_id, rt_id: r.id });
    }, 250);
  });
}

/* --------------------------------------------------------------- Achat Bord Champ */

var buyFilter = { village: '', rt: '', statut: '', from: '', to: '' };

function renderPurchases(sub, farmerId) {
  var openForm = sub === 'new';
  paint(head('Achat Bord Champ',
    'Producteur → Achat → Sacs → Poids → Prix → Paiement → Lot → Stock → Traceability.',
    '<button class="btn primary ops-cta-create" id="newBuyBtn" type="button" onclick="ANAGROCI_FB.openBuyForm()">+ Nouvel achat</button>') +
    createHost() + skeletonPage(6));

  return base().then(function (c) {
    var d = derive(c);
    var villages = selOptions(c.villages.map(function (v) { return [v.id, v.village]; }), buyFilter.village);
    var statuts = {};
    c.achats.forEach(function (a) { if (a.statut_validation) statuts[a.statut_validation] = 1; });

    paint(head('Achat Bord Champ',
      'Producteur → Achat → Sacs → Poids → Prix → Paiement → Lot → Stock → Traceability.',
      '<button class="btn primary ops-cta-create" id="newBuyBtn" type="button" onclick="ANAGROCI_FB.openBuyForm()">+ Nouvel achat</button>') +
      createHost() +
      kpis([
        ['Volume jour', mt(d.dayKg), 'dernières 24 h'],
        ['Volume semaine', mt(d.weekKg), '7 derniers jours'],
        ['Volume campagne', mt(d.buyKg), num((d.buyKg / 1000) / OBJECTIF_CAMPAGNE_MT * 100, 1) + ' % de ' + num(OBJECTIF_CAMPAGNE_MT) + ' MT'],
        ['Valeur', money(d.buyVal), c.achats.length + ' achat(s)'],
        ['Producteurs vendeurs', String(Object.keys(c.achats.reduce(function (m, a) { if (a.producteur_id) m[a.producteur_id] = 1; return m; }, {})).length), 'campagne'],
        ['RT actifs', String(Object.keys(d.byRtBuy).length), 'avec au moins un achat']
      ]) +
      '<section class="card"><div class="card-head"><div><h2>Filtres</h2></div></div><div class="ops-form-grid">' +
      field('Village', '<select id="bfVillage"><option value="">Tous</option>' + villages + '</select>') +
      field('Statut', '<select id="bfStatut"><option value="">Tous</option>' +
        selOptions(Object.keys(statuts).sort().map(function (s) { return [s, s]; }), buyFilter.statut) + '</select>') +
      field('Du', '<input id="bfFrom" type="date" value="' + esc(buyFilter.from) + '">') +
      field('Au', '<input id="bfTo" type="date" value="' + esc(buyFilter.to) + '">') +
      '</div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Achats</h2>' +
      '<p>La validation, la libération du stock et la caisse suivent leurs circuits existants.</p></div></div>' +
      '<div id="buyTable"></div></section>');

    function apply() {
      var list = c.achats.filter(function (a) {
        if (buyFilter.village && a.village_id !== buyFilter.village) return false;
        if (buyFilter.statut && a.statut_validation !== buyFilter.statut) return false;
        var dt = a.date || a.created_at;
        if (buyFilter.from && (!dt || new Date(dt) < new Date(buyFilter.from))) return false;
        if (buyFilter.to && (!dt || new Date(dt) > new Date(buyFilter.to + 'T23:59:59'))) return false;
        return true;
      });
      document.getElementById('buyTable').innerHTML = table(
        ['Date', 'Farmer ID', 'Producteur', 'RT', 'Village', 'Cluster', 'Poids net', 'Sacs', 'Prix', 'Montant', 'Paiement', 'Validation', 'Stock'],
        list.slice(0, 200).map(function (a) {
          return '<tr><td>' + date(a.date) + '</td><td class="mono">' + esc(a.producteur_code || '—') + '</td>' +
            '<td><b>' + esc(a.producteur_nom || '—') + '</b></td><td>' + esc(a.rt_nom || '—') + '</td>' +
            '<td>' + esc(a.village_nom || '—') + '</td><td>' + esc(a.cluster || '—') + '</td>' +
            '<td>' + num(a.poids_net) + ' kg</td><td>' + n(a.nb_sacs) + '</td>' +
            '<td>' + num(a.prix_kg) + ' /kg</td><td>' + money(a.montant) + '</td>' +
            '<td>' + esc(a.mode_paiement || '—') + '</td><td>' + badge(a.statut_validation) + '</td>' +
            '<td>' + badge(a.stock_statut) + '</td></tr>';
        }));
    }
    ['bfVillage', 'bfStatut', 'bfFrom', 'bfTo'].forEach(function (id, i) {
      var key = ['village', 'statut', 'from', 'to'][i];
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () { buyFilter[key] = this.value; apply(); });
    });
    apply();
    if (openForm) openBuyForm(farmerId);
  });
}

/* Formulaire d'achat : mêmes colonnes que le moteur achats existant.
   La garde « montant ≤ avances du RT » et la validation restent côté base. */
function openBuyForm(farmerId) {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), loadProfile()]).then(function (rs) {
    var c = rs[0];
    if (!guardTerrain(host)) return;
    var pre = farmerId ? c.farmers.filter(function (f) { return f.producteur_id === farmerId; })[0] : null;
    var villageOpts = selOptions(c.villages.map(function (v) { return [v.id, v.village + ' · ' + (v.cluster || '—')]; }), pre ? pre.village_id : '');

    host.innerHTML = '<div class="card-head"><div><h2>Nouvel achat Bord Champ</h2>' +
      '<p>Village → RT → producteur, puis poids, prix et paiement. La parcelle absente ne bloque jamais.</p></div></div>' +
      '<form id="buyForm"><div class="ops-form-grid">' +
      field('Village *', '<select id="bf_village" required><option value="">Choisir…</option>' + villageOpts + '</select>') +
      field('RT', '<select id="bf_rt"><option value="">—</option></select>') +
      field('Producteur *', '<select id="bf_farmer" required><option value="">Choisir…</option></select>') +
      field('Date *', '<input id="bf_date" type="date" required value="' + new Date().toISOString().slice(0, 10) + '">') +
      field('Poids brut (kg) *', '<input id="bf_brut" type="number" step="any" min="0" required>') +
      field('Tare (kg)', '<input id="bf_tare" type="number" step="any" min="0" value="0">') +
      field('Poids net (kg)', '<input id="bf_net" type="number" step="any" readonly class="mono">') +
      field('Nombre de sacs *', '<input id="bf_sacs" type="number" min="0" required>') +
      field('Prix (FCFA/kg) *', '<input id="bf_prix" type="number" step="any" min="0" required value="' + PRIX_CAMPAGNE + '">') +
      field('Montant (FCFA)', '<input id="bf_montant" type="number" readonly class="mono">') +
      field('Motif prix hors barème', '<input id="bf_motif_prix" placeholder="Obligatoire si prix ≠ ' + PRIX_CAMPAGNE + '" hidden>') +
      field('Mode de paiement', '<select id="bf_pay"><option>Wave</option><option>Mobile Money</option><option>Espèces exceptionnel</option><option>Autre validé BM</option></select>') +
      field('N° de reçu', '<input id="bf_ref" placeholder="Obligatoire pour un achat complet">') +
      field('Humidité (%)', '<input id="bf_hum" type="number" step="any" min="0" max="100" placeholder="Facultatif">') +
      field('KOR', '<input id="bf_kor" type="number" step="any" min="0" placeholder="Facultatif">') +
      field('Observations', '<textarea id="bf_obs"></textarea>', true) +
      '</div><div id="bf_ctx" class="notice info" hidden></div>' +
      '<div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="bf_submit">Enregistrer l’achat</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="bf_msg" class="muted" style="margin-top:10px"></div></form>';

    var vSel = document.getElementById('bf_village'), rSel = document.getElementById('bf_rt'),
        fSel = document.getElementById('bf_farmer'), ctx = document.getElementById('bf_ctx');
    function syncRt() {
      var vid = vSel.value;
      rSel.innerHTML = '<option value="">—</option>' + selOptions(
        c.rts.filter(function (r) { return r.village_id === vid; }).map(function (r) { return [r.id, r.nom]; }),
        pre ? pre.rt_id : '');
      syncFarmers();
    }
    function syncFarmers() {
      var vid = vSel.value, rid = rSel.value;
      fSel.innerHTML = '<option value="">Choisir…</option>' + selOptions(
        c.farmers.filter(function (f) { return f.village_id === vid && (!rid || f.rt_id === rid); })
          .map(function (f) { return [f.producteur_id, (f.farmer_id || '—') + ' · ' + f.nom]; }),
        pre ? pre.producteur_id : '');
      syncCtx();
    }
    function syncCtx() {
      var f = c.farmers.filter(function (x) { return x.producteur_id === fSel.value; })[0];
      if (!f) { ctx.hidden = true; return; }
      ctx.hidden = false;
      ctx.innerHTML = '<b>' + esc(f.farmer_id || '—') + '</b> · ' + esc(f.nom) +
        ' · RT ' + esc(f.rt_nom || '—') + ' · ' + esc(f.village_nom || '—') +
        ' · Cluster ' + esc(f.cluster_label || f.cluster_code || '—') +
        (n(f.gps_mapped_count) > 0 ? '' : ' · <i>parcelle à compléter après campagne (non bloquant)</i>');
    }
    function syncMontant() {
      var net = Math.max(0, n(document.getElementById('bf_brut').value) - n(document.getElementById('bf_tare').value));
      document.getElementById('bf_net').value = net || '';
      document.getElementById('bf_montant').value = Math.round(net * n(document.getElementById('bf_prix').value)) || '';
      var horsBareme = n(document.getElementById('bf_prix').value) !== PRIX_CAMPAGNE;
      var motif = document.getElementById('bf_motif_prix');
      motif.hidden = !horsBareme;
      motif.closest('.ops-field').hidden = !horsBareme;
    }
    syncMontant();
    vSel.addEventListener('change', syncRt);
    rSel.addEventListener('change', syncFarmers);
    fSel.addEventListener('change', syncCtx);
    ['bf_brut', 'bf_tare', 'bf_prix'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', syncMontant);
    });
    if (pre) { syncRt(); }

    document.getElementById('buyForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('bf_msg'), btn = document.getElementById('bf_submit');
      var f = c.farmers.filter(function (x) { return x.producteur_id === fSel.value; })[0];
      var v = c.vm[vSel.value] || {};
      var rt = c.rm[rSel.value] || {};
      var net = Math.max(0, n(document.getElementById('bf_brut').value) - n(document.getElementById('bf_tare').value));
      var prix = n(document.getElementById('bf_prix').value);
      var sacs = n(document.getElementById('bf_sacs').value);
      var recu = document.getElementById('bf_ref').value.trim();
      var motifPrix = document.getElementById('bf_motif_prix').value.trim();
      if (!f || net <= 0 || prix <= 0) {
        msg.className = 'ops-danger-text'; msg.textContent = 'Producteur, poids et prix sont obligatoires.'; return;
      }
      if (sacs < 1) { msg.className = 'ops-danger-text'; msg.textContent = 'Au moins un sac est requis.'; return; }
      if (!recu) { msg.className = 'ops-danger-text'; msg.textContent = 'Le n° de reçu est obligatoire pour un achat complet.'; return; }
      var horsBareme = prix !== PRIX_CAMPAGNE;
      if (horsBareme && !motifPrix) {
        msg.className = 'ops-danger-text';
        msg.textContent = 'Prix hors barème (' + PRIX_CAMPAGNE + ' FCFA/kg) : le motif est obligatoire et l’achat partira en validation BM.';
        return;
      }
      /* Statut qualité et échelle de validation : mêmes règles que l'ancien moteur. */
      var hum = document.getElementById('bf_hum').value ? n(document.getElementById('bf_hum').value) : null;
      var kor = document.getElementById('bf_kor').value ? n(document.getElementById('bf_kor').value) : null;
      var qualite = (hum != null && hum > SEUIL_HUMIDITE) ? 'À sécher'
        : (kor != null && kor < SEUIL_KOR) ? 'À trier' : 'OK';
      var statutValidation = horsBareme ? 'Validation BM requise'
        : (qualite !== 'OK' ? 'À contrôler' : 'À valider');
      var stockOk = qualite === 'OK';
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Enregistrement…';
      var montant = Math.round(net * prix);
      client().then(function (cl) {
        return cl.from('achats').insert({
          id: uid(), local_id: uid(), date: document.getElementById('bf_date').value,
          cluster: v.cluster || f.cluster_label || null,
          village_id: v.id || f.village_id, village_nom: v.village || f.village_nom,
          rt_id: rt.id || f.rt_id || null, rt_nom: rt.nom || f.rt_nom || null,
          producteur_id: f.producteur_id, producteur_code: f.farmer_id || null,
          producteur_nom: f.nom, producteur_tel: f.telephone || null,
          poids_brut: n(document.getElementById('bf_brut').value),
          tare: n(document.getElementById('bf_tare').value), poids_net: net,
          prix_kg: n(document.getElementById('bf_prix').value), montant: montant,
          nb_sacs: n(document.getElementById('bf_sacs').value),
          mode_paiement: document.getElementById('bf_pay').value,
          numero_recu: recu, humidite: hum, kor: kor,
          observation: document.getElementById('bf_obs').value.trim() || null,
          prix_hors_bareme: horsBareme, motif_prix: horsBareme ? motifPrix : null,
          commission_rt: Math.round(net * COMMISSION_RT),
          qualite_statut: qualite, statut_validation: statutValidation,
          refinancable: !!recu, stock_libere: stockOk,
          stock_statut: stockOk ? 'Entrée RT' : 'Stock non libéré',
          saisie_mode: 'OPERATIONS_FIELD_BUYING', created_by: profile.userId || null,
          created_by_nom: profile.nom || null
        });
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        msg.className = 'ops-ok-text';
        msg.textContent = 'Achat enregistré : ' + num(net) + ' kg · ' + money(montant) + '. Statut « ' + statutValidation + ' ».';
        FBStore.invalidate('base');
        setTimeout(function () { closeForm(); render(); }, 1000);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Enregistrement impossible.';
      });
    });
  });
}

/* --------------------------------------------------------- Hubs & Cartographie */

/* Coordonnées : villages via colonnes synchronisées puis repli data.s1 (texte,
   virgule décimale tolérée) ; hubs via hubs_clusters (PK id_hub) ; usine via
   parametres_calcul. Cascade de distance : routière validée > saisie > vol d'oiseau. */
function coordNum(v) {
  if (v == null || v === '') return null;
  var x = Number(String(v).replace(',', '.'));
  return isFinite(x) ? x : null;
}
function villageCoords(v) {
  var lat = coordNum(v.gps_lat), lng = coordNum(v.gps_lng);
  if (lat == null || lng == null) {
    var s1 = (v.data && v.data.s1) || {};
    lat = coordNum(s1.gpsLat); lng = coordNum(s1.gpsLng);
  }
  return (lat != null && lng != null) ? [lat, lng] : null;
}
function haversine(a, b) {
  var R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function villageDistance(v, hubPos) {
  var s1 = (v.data && v.data.s1) || {};
  if (n(s1.distanceHubRoutiere)) return { km: n(s1.distanceHubRoutiere), src: 'validée' };
  if (n(s1.distanceHub)) return { km: n(s1.distanceHub), src: 'saisie' };
  var pos = villageCoords(v);
  if (pos && hubPos) return { km: haversine(pos, hubPos), src: 'estimée' };
  return null;
}
/* Couleur du village sur la carte : vert = normal, orange = attention, rouge = problème. */
function villageColor(v, d) {
  var hasRt = (d.rtByVillage[v.id] || []).length > 0;
  if (!hasRt) return '#C0392B';
  var s5 = (v.data && v.data.s5) || {};
  var attention = v.statut === 'Brouillon' || s5.typeAcces === 'Enclavé' ||
    (s5.noteRoute != null && n(s5.noteRoute) <= 3) || !d.byVillageBuy[v.id];
  return attention ? '#EE9E00' : '#1F9D6E';
}

var USINE_DEFAUT = { lat: 6.741972, lng: -5.34575 };
var BOUAKE = { lat: 7.6906, lng: -5.0304 };

function renderHubs(clusterCode) {
  if (clusterCode) return renderClusterPassport(clusterCode);
  paint(head('Hubs & Cartographie', 'Géographie opérationnelle AFLP : zones, clusters, hubs, villages et usine.',
    '<a class="btn secondary" href="#rt/villages">Villages en liste</a>') + skeletonPage(4));

  return Promise.all([base(), hubsData(),
    q('parametres_calcul', 'cle,valeur', 10, function (r) { return r.in('cle', ['usine_lat', 'usine_lng']); })
  ]).then(function (rs) {
    var c = rs[0], hd = rs[1], params = rs[2] || [];
    var d = derive(c);
    var usine = { lat: USINE_DEFAUT.lat, lng: USINE_DEFAUT.lng };
    params.forEach(function (p) {
      if (p.cle === 'usine_lat' && coordNum(p.valeur) != null) usine.lat = coordNum(p.valeur);
      if (p.cle === 'usine_lng' && coordNum(p.valeur) != null) usine.lng = coordNum(p.valeur);
    });

    /* Position de chaque hub : hubs_clusters, sinon barycentre des villages du cluster. */
    var hubPos = {}, hubRow = {};
    hd.hubs.forEach(function (h) {
      var k = normName(h.nom);
      hubRow[k] = h;
      var lat = coordNum(h.gps_lat), lng = coordNum(h.gps_lng);
      if (lat != null && lng != null) hubPos[k] = [lat, lng];
    });
    var byCluster = {};
    c.villages.forEach(function (v) {
      var k = normName(v.cluster || '');
      (byCluster[k] = byCluster[k] || []).push(v);
    });
    Object.keys(byCluster).forEach(function (k) {
      if (hubPos[k]) return;
      var pts = byCluster[k].map(villageCoords).filter(Boolean);
      if (pts.length) {
        hubPos[k] = [pts.reduce(function (t, p) { return t + p[0]; }, 0) / pts.length,
                     pts.reduce(function (t, p) { return t + p[1]; }, 0) / pts.length];
      }
    });

    var geoRows = c.clusters.map(function (cl) {
      var k = normName(cl.label);
      var vs = byCluster[k] || byCluster[normName(cl.code)] || [];
      var pot = 0, sec = 0, buy = 0, rts = 0;
      vs.forEach(function (v) {
        var s3 = (v.data && v.data.s3) || {};
        pot += n(s3.potentielMT); sec += n(s3.potentielSecuriseMT);
        buy += d.byVillageBuy[v.id] || 0;
        rts += (d.rtByVillage[v.id] || []).length;
      });
      var h = hubRow[k] || {};
      return { cluster: cl, villages: vs.length, rts: rts, pot: pot, sec: sec, buy: buy,
               distUsine: h.distance_usine_routiere || h.distance_usine_gps || null, hub: h };
    });

    paint(head('Hubs & Cartographie', 'Géographie opérationnelle AFLP : zones, clusters, hubs, villages et usine.',
      '<a class="btn secondary" href="#rt/villages">Villages en liste</a>') +
      kpis([
        ['Zones', String(c.zones.length), c.zones.map(function (z) { return z.label; }).join(' · ')],
        ['Clusters', String(c.clusters.length), 'hubs relais'],
        ['Villages géolocalisés', String(c.villages.filter(function (v) { return villageCoords(v); }).length), 'sur ' + c.villages.length],
        ['Destination finale', 'Usine ANAGROCI', 'Yamoussoukro']
      ]) +
      '<section class="card"><div class="card-head"><div><h2>Carte opérationnelle</h2>' +
      '<p><span class="ops-dot ok"></span> normal &nbsp; <span class="ops-dot warn"></span> attention &nbsp; ' +
      '<span class="ops-dot danger"></span> problème (village sans RT)</p></div></div>' +
      '<div id="fbMap" class="ops-map"></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Zones et clusters</h2>' +
      '<p>Cliquez sur un cluster pour ouvrir son passeport.</p></div></div>' +
      table(['Zone', 'Cluster', 'Villages', 'RT', 'Potentiel', 'Sécurisé', 'Acheté', 'Distance usine', 'Statut hub'],
        geoRows.map(function (g) {
          return '<tr class="ops-click" onclick="location.hash=\'#hubs/' + encodeURIComponent(g.cluster.label) + '\'">' +
            '<td>' + esc(g.cluster.zone_code || '—') + '</td><td><b>' + esc(g.cluster.label) + '</b></td>' +
            '<td>' + g.villages + '</td><td>' + g.rts + '</td>' +
            '<td>' + num(g.pot, 1) + ' MT</td><td>' + num(g.sec, 1) + ' MT</td><td>' + mt(g.buy) + '</td>' +
            '<td>' + (g.distUsine ? num(g.distUsine, 1) + ' km' : '—') + '</td>' +
            '<td>' + badge(g.hub.statut || 'À géolocaliser') + '</td></tr>';
        })) + '</section>');

    drawMap(c, d, hubPos, usine);
  });
}

function drawMap(c, d, hubPos, usine) {
  var el = document.getElementById('fbMap');
  if (!el || !global.L) return;
  try {
    var map = L.map('fbMap').setView([7.52, -5.08], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);

    L.marker([usine.lat, usine.lng]).addTo(map).bindPopup('<b>Usine ANAGROCI</b><br>Yamoussoukro');
    L.circleMarker([BOUAKE.lat, BOUAKE.lng], { radius: 8, fillColor: '#053B23', color: '#fff', weight: 2, fillOpacity: 0.9 })
      .addTo(map).bindPopup('<b>Bouaké</b><br>Base opérationnelle');

    Object.keys(hubPos).forEach(function (k) {
      var pos = hubPos[k];
      L.circleMarker(pos, { radius: 13, fillColor: '#053B23', color: '#fff', weight: 3, fillOpacity: 0.95 })
        .addTo(map).bindPopup('<b>' + esc(k) + '</b><br>Hub relais');
      L.polyline([pos, [usine.lat, usine.lng]],
        { color: '#EE9E00', weight: 3, dashArray: '8 7', opacity: 0.8 }).addTo(map);
    });

    c.villages.forEach(function (v) {
      var pos = villageCoords(v);
      if (!pos) return;
      var k = normName(v.cluster || '');
      var hub = hubPos[k] || null;
      var dist = villageDistance(v, hub);
      var s5 = (v.data && v.data.s5) || {};
      var rts = (d.rtByVillage[v.id] || []);
      var m = L.circleMarker(pos, {
        radius: 7, weight: 2, color: '#fff', fillOpacity: 0.95, fillColor: villageColor(v, d)
      }).addTo(map);
      m.bindPopup('<b>' + esc(v.village) + '</b><br>' +
        'Zone : ' + esc(zoneOfCluster(c, v.cluster)) + ' · Cluster : ' + esc(v.cluster || '—') + '<br>' +
        'RT : ' + (rts.length ? rts.map(function (r) { return esc(r.nom); }).join(', ') : '<b>aucun</b>') + '<br>' +
        'Producteurs : ' + (d.farmersByVillage[v.id] || 0) + '<br>' +
        'Potentiel : ' + num(((v.data || {}).s3 || {}).potentielMT || 0, 1) + ' MT · ' +
        'Sécurisé : ' + num(((v.data || {}).s3 || {}).potentielSecuriseMT || 0, 1) + ' MT<br>' +
        'Acheté : ' + mt(d.byVillageBuy[v.id] || 0) + '<br>' +
        'Route : ' + esc(s5.typeAcces || '—') +
        ' · Camion : ' + (s5.camion30T ? '30T' : s5.camion10T ? '10T' : '—') + '<br>' +
        (dist ? 'Distance hub : ' + num(dist.km, 1) + ' km (' + dist.src + ')' : 'Distance hub : —'));
      if (hub) {
        L.polyline([pos, hub], dist && dist.src === 'validée'
          ? { color: '#1F9D6E', weight: 3, opacity: 0.8 }
          : { color: '#1d6fa5', weight: 2, dashArray: '7 6', opacity: 0.7 }).addTo(map);
      }
    });
  } catch (e) { console.warn('[FB carte]', e.message); }
}

/* Cluster Passport */
function renderClusterPassport(label) {
  paint(head(label, 'Cluster Passport', '<a class="btn secondary" href="#hubs">← Hubs & Cartographie</a>') + skeletonPage(6));
  return Promise.all([base(), hubsData(), bagsData().catch(function () { return null; })]).then(function (rs) {
    var c = rs[0], hd = rs[1], bg = rs[2];
    var d = derive(c);
    var k = normName(label);
    var cl = c.clusters.filter(function (x) { return normName(x.label) === k || normName(x.code) === k; })[0] || { label: label };
    var vs = c.villages.filter(function (v) { return normName(v.cluster || '') === k; });
    var rts = c.rts.filter(function (r) { return normName(r.cluster || '') === k; });
    var pot = 0, sec = 0, buy = 0;
    vs.forEach(function (v) {
      var s3 = (v.data && v.data.s3) || {};
      pot += n(s3.potentielMT); sec += n(s3.potentielSecuriseMT); buy += d.byVillageBuy[v.id] || 0;
    });
    var farmers = vs.reduce(function (t, v) { return t + (d.farmersByVillage[v.id] || 0); }, 0);
    var hub = hd.hubs.filter(function (h) { return normName(h.nom) === k; })[0] || {};
    var stock = bg && bg.clusterStock.filter(function (s) { return normName(s.cluster) === k; })[0];

    paint(head(cl.label + ' · ' + (cl.zone_code || '—'), 'Cluster Passport · villages, RT, potentiel, achats, sacs et logistique.',
      '<a class="btn secondary" href="#hubs">← Hubs & Cartographie</a>') +
      kpis([
        ['Villages', String(vs.length), vs.filter(function (v) { return v.statut === 'Approuvé BM'; }).length + ' approuvé(s)'],
        ['RT', String(rts.length), rts.filter(function (r) { return r.statut === 'Confirmé'; }).length + ' confirmé(s)'],
        ['Producteurs', String(farmers), 'recensés'],
        ['Potentiel', num(pot, 1) + ' MT', 'sécurisé : ' + num(sec, 1) + ' MT'],
        ['Acheté', mt(buy), 'campagne'],
        ['Distance usine', hub.distance_usine_routiere ? num(hub.distance_usine_routiere, 1) + ' km' : (hub.distance_usine_gps ? num(hub.distance_usine_gps, 1) + ' km (GPS)' : '—'), esc(hub.statut || '—')],
        ['Sacs au cluster', stock ? num(n(stock.stock_cluster_vide) + n(stock.stock_cluster_plein)) : '—', stock ? num(stock.stock_chez_rt) + ' chez les RT' : 'sacherie'],
        ['Alertes', String(vs.filter(function (v) { return !(d.rtByVillage[v.id] || []).length; }).length), 'villages sans RT']
      ]) +
      '<section class="card"><div class="card-head"><div><h2>Villages du cluster</h2></div></div>' +
      table(['Village', 'Statut', 'RT', 'Producteurs', 'Potentiel', 'Acheté', 'Route'],
        vs.map(function (v) {
          var s3 = (v.data && v.data.s3) || {}, s5 = (v.data && v.data.s5) || {};
          return '<tr><td><b>' + esc(v.village) + '</b></td><td>' + badge(v.statut) + '</td>' +
            '<td>' + (d.rtByVillage[v.id] || []).map(function (r) { return esc(r.nom); }).join(', ') + '</td>' +
            '<td>' + (d.farmersByVillage[v.id] || 0) + '</td>' +
            '<td>' + (s3.potentielMT != null ? num(s3.potentielMT, 1) + ' MT' : '—') + '</td>' +
            '<td>' + mt(d.byVillageBuy[v.id] || 0) + '</td>' +
            '<td>' + esc(s5.typeAcces || '—') + '</td></tr>';
        })) + '</section>');
  });
}

/* ---------------------------------------------------------------- Sacherie AFLP */

function renderBags(sub) {
  var actions = '<button class="btn primary ops-cta-create" id="newBagReqBtn" type="button" onclick="ANAGROCI_FB.openBagRequest()">+ Nouvelle demande RT</button>';
  paint(head('Sacherie AFLP', 'Enveloppe GM → allocations clusters → demandes RT → approbation → sorties → balances.',
    actions) + createHost() + skeletonPage(6));

  return Promise.all([base(), bagsData()]).then(function (rs) {
    var c = rs[0], b = rs[1];
    var env = b.envelopes.filter(function (e) { return /APPROV|ACTIVE|OPEN/i.test(String(e.status || '')); })[0] || b.envelopes[0] || {};
    var allocated = b.allocations.reduce(function (t, a) { return t + n(a.allocated_qty); }, 0);
    var pending = b.requests.filter(function (r) { return /PENDING|SUBMITTED|REQUESTED/i.test(String(r.status || '')); });
    var approved = b.requests.filter(function (r) { return /APPROVED|PARTIAL/i.test(String(r.status || '')); });
    var expiring = approved.filter(function (r) {
      return r.expires_at && daysSince(r.expires_at) == 0 && new Date(r.expires_at) - Date.now() < 3 * 86400000;
    });
    var withRt = b.rtStock.reduce(function (t, s) { return t + n(s.total_sous_responsabilite); }, 0);
    var aging = b.rtStock.filter(function (s) { return s.derniere_activite && daysSince(s.derniere_activite) > 30 && n(s.total_sous_responsabilite) > 0; });

    paint(head('Sacherie AFLP', 'Enveloppe GM → allocations clusters → demandes RT → approbation → sorties → balances.',
      actions) + createHost() +
      kpis([
        ['Enveloppe campagne', env.approved_qty != null ? num(env.approved_qty) : '—', esc(env.campaign || '')],
        ['Sacs alloués clusters', num(allocated), b.allocations.length + ' allocation(s)'],
        ['Sacs chez les RT', num(withRt), b.rtStock.length + ' RT'],
        ['Demandes en attente', String(pending.length), 'à approuver', pending.length ? 'warn' : ''],
        ['Approbations en cours', String(approved.length), expiring.length + ' expire(nt) sous 3 j', expiring.length ? 'warn' : ''],
        ['RT sans mouvement 30 j', String(aging.length), 'balance non nulle', aging.length ? 'warn' : '']
      ]) +
      '<div class="notice info"><b>Règle :</b> l’approbation n’est pas la sortie physique. Une approbation de 2 000 sacs peut se libérer ' +
      'en plusieurs sorties (700 + 500 + 800) sans jamais se clôturer après la première.</div>' +
      '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Stock par cluster</h2></div></div>' +
      table(['Cluster', 'Vides', 'Pleins', 'Chez RT', 'Chez producteur', 'Transit', 'Total réseau'],
        b.clusterStock.map(function (s) {
          return '<tr><td><b>' + esc(s.cluster) + '</b></td><td>' + num(s.stock_cluster_vide) + '</td>' +
            '<td>' + num(s.stock_cluster_plein) + '</td><td>' + num(s.stock_chez_rt) + '</td>' +
            '<td>' + num(s.stock_chez_producteur) + '</td><td>' + num(s.transit) + '</td>' +
            '<td>' + num(s.total_reseau) + '</td></tr>';
        })) +
      '</section><section class="card"><div class="card-head"><div><h2>Demandes récentes</h2>' +
      '<p>Le circuit d’approbation et de sortie reste celui du moteur central.</p></div></div>' +
      table(['Référence', 'Cluster / RT', 'Demandé', 'Approuvé', 'Libéré', 'Reçu', 'Statut'],
        b.requests.slice(0, 12).map(function (r) {
          return '<tr><td class="mono">' + esc(r.request_code || r.id) + '</td>' +
            '<td>' + esc(r.cluster || '—') + (r.rt_id ? '<br><span class="muted">' + esc((c.rm[r.rt_id] || {}).nom || r.rt_id) + '</span>' : '') + '</td>' +
            '<td>' + num(r.requested_qty) + '</td><td>' + num(r.approved_qty) + '</td>' +
            '<td>' + num(r.released_qty) + '</td><td>' + num(r.received_qty) + '</td>' +
            '<td>' + badge(r.status) + '</td></tr>';
        })) + '</section></div>' +
      '<section class="card"><div class="card-head"><div><h2>RT Bag Account</h2>' +
      '<p>Balance sacherie sous la responsabilité de chaque RT.</p></div></div>' +
      table(['Cluster', 'RT', 'Sous responsabilité', 'Vides', 'Pleins', 'Déchirés', 'Dernière activité', 'Ancienneté'],
        b.rtStock.slice(0, 60).map(function (s) {
          var age = daysSince(s.derniere_activite);
          return '<tr><td>' + esc(s.cluster || '—') + '</td><td><b>' + esc(s.rt_nom || s.rt_id) + '</b></td>' +
            '<td>' + num(s.total_sous_responsabilite) + '</td><td>' + num(s.vides) + '</td>' +
            '<td>' + num(s.pleins) + '</td><td>' + num(s.dechires) + '</td>' +
            '<td>' + date(s.derniere_activite) + '</td>' +
            '<td>' + (age == null ? '—' : (age > 30 ? '<span class="badge warn">' + age + ' j</span>' : age + ' j')) + '</td></tr>';
        })) + '</section>');
  });
}

/* Demande de sacs pour un RT — réutilise le circuit central ops_bag_requests. */
function openBagRequest() {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), bagsData(), loadProfile()]).then(function (rs) {
    var c = rs[0], b = rs[1];
    if (!guardTerrain(host)) return;
    var clusterOpts = selOptions(c.clusters.map(function (x) { return [x.label, x.label]; }), '');
    host.innerHTML = '<div class="card-head"><div><h2>Nouvelle demande de sacs RT</h2>' +
      '<p>La demande part au circuit d’approbation ; la sortie physique reste une étape distincte, en une ou plusieurs libérations.</p></div></div>' +
      '<form id="bagReqForm"><div class="ops-form-grid">' +
      field('Cluster *', '<select id="bq_cluster" required><option value="">Choisir…</option>' + clusterOpts + '</select>') +
      field('RT *', '<select id="bq_rt" required><option value="">Choisir…</option></select>') +
      field('Quantité demandée *', '<input id="bq_qty" type="number" min="1" required>') +
      '</div><div id="bq_ctx" class="notice info" hidden></div>' +
      '<div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="bq_submit">Soumettre la demande</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="bq_msg" class="muted" style="margin-top:10px"></div></form>';

    var clSel = document.getElementById('bq_cluster'), rtSel = document.getElementById('bq_rt'), ctx = document.getElementById('bq_ctx');
    function syncRt() {
      var k = normName(clSel.value);
      rtSel.innerHTML = '<option value="">Choisir…</option>' + selOptions(
        c.rts.filter(function (r) { return normName(r.cluster || '') === k; })
          .map(function (r) { return [r.id, r.nom + ' · ' + (r.village_nom || '—')]; }), '');
      syncCtx();
    }
    function syncCtx() {
      var k = normName(clSel.value);
      var stock = b.clusterStock.filter(function (s) { return normName(s.cluster) === k; })[0];
      var rtRow = b.rtStock.filter(function (s) { return s.rt_id === rtSel.value; })[0];
      ctx.hidden = !clSel.value;
      ctx.innerHTML = 'Stock cluster : <b>' + (stock ? num(stock.stock_cluster_vide) + ' vide(s)' : '—') + '</b>' +
        (rtRow ? ' · Balance actuelle du RT : <b>' + num(rtRow.total_sous_responsabilite) + '</b>' : '');
    }
    clSel.addEventListener('change', syncRt);
    rtSel.addEventListener('change', syncCtx);

    document.getElementById('bagReqForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('bq_msg'), btn = document.getElementById('bq_submit');
      var cluster = clSel.value, rt = c.rm[rtSel.value], qty = n(document.getElementById('bq_qty').value);
      if (!cluster || !rt || qty <= 0) { msg.className = 'ops-danger-text'; msg.textContent = 'Cluster, RT et quantité sont obligatoires.'; return; }
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Envoi de la demande…';
      client().then(function (cl) {
        return cl.from('ops_bag_requests').insert({
          client_request_id: uid(), channel: 'AFLP', campaign: '2027',
          cluster: cluster, rt_id: rt.id,
          source_location_code: 'CLUSTER:' + cluster,
          destination_location_code: 'RT:' + rt.id,
          requested_qty: qty, status: 'PENDING'
        });
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        msg.className = 'ops-ok-text';
        msg.textContent = 'Demande soumise pour ' + rt.nom + ' : ' + num(qty) + ' sac(s). En attente d’approbation.';
        FBStore.invalidate('bags');
        setTimeout(function () { closeForm(); render(); }, 1000);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Envoi impossible.';
      });
    });
  });
}

/* --------------------------------------------------------------- Caisse & Avances */

function renderCash() {
  paint(head('Caisse & Avances', 'Avances RT, cycles de financement terrain et contrôle des fonds.') + skeletonPage(5));
  return Promise.all([base(), cashData()]).then(function (rs) {
    var c = rs[0], av = rs[1].avances, recons = rs[1].recons;
    var lastRecon = lastReconByRt(recons);
    var active = av.filter(function (a) { return a.statut !== 'Annulee'; });
    var total = active.reduce(function (t, a) { return t + n(a.montant); }, 0);
    var d = derive(c);
    var usedByRt = {};
    c.achats.forEach(function (a) { if (a.rt_id) usedByRt[a.rt_id] = (usedByRt[a.rt_id] || 0) + n(a.montant); });
    var byRt = {};
    active.forEach(function (a) {
      var k = a.rt_id || normName(a.rt_nom);
      var s = byRt[k] = byRt[k] || { nom: a.rt_nom, cluster: a.cluster, avance: 0, cycle: a.cycle_id, statut: a.cycle_statut || a.statut };
      s.avance += n(a.montant);
    });

    paint(head('Caisse & Avances', 'Avances RT, cycles de financement terrain et contrôle des fonds.') +
      kpis([
        ['Avances actives', money(total), active.length + ' avance(s)'],
        ['Utilisé en achats', money(c.achats.reduce(function (t, a) { return t + n(a.montant); }, 0)), 'campagne'],
        ['RT financés', String(Object.keys(byRt).length), 'avec avance active'],
        ['Cycles en cours', String(active.filter(function (a) { return a.cycle_id && a.cycle_statut !== 'Clôturé'; }).length), 'financement terrain'],
        ['RT en écart caisse', String(Object.keys(byRt).filter(function (k) {
          var r = lastRecon[k];
          return byRt[k].avance > 0 && (!r || r.statut !== 'Réconcilié');
        }).length), 'réconciliation attendue avant nouvelle avance', 'warn'],
        ['Garde-fou', 'Achat ≤ avance', 'contrôle appliqué à l’enregistrement de l’achat']
      ]) +
      '<section class="card"><div class="card-head"><div><h2>Balance par RT</h2>' +
      '<p>Avance versée, achats réalisés et disponible restant.</p></div></div>' +
      table(['RT', 'Cluster', 'Avance', 'Achats', 'Disponible', 'Caisse', 'Cycle', 'Statut'],
        Object.keys(byRt).map(function (k) {
          var s = byRt[k];
          var used = usedByRt[k] || 0;
          var left = s.avance - used;
          var r = lastRecon[k];
          var caisse = !r ? 'À réconcilier' : r.statut;
          return '<tr><td><b>' + esc(s.nom || '—') + '</b></td><td>' + esc(s.cluster || '—') + '</td>' +
            '<td>' + money(s.avance) + '</td><td>' + money(used) + '</td>' +
            '<td class="' + (left < 0 ? 'ops-danger-text' : '') + '">' + money(left) + '</td>' +
            '<td>' + badge(caisse) + '</td>' +
            '<td class="mono">' + esc(s.cycle || '—') + '</td><td>' + badge(s.statut) + '</td></tr>';
        })) + '</section>' +
      '<section class="card"><div class="card-head"><div><h2>Avances</h2></div></div>' +
      table(['Date', 'RT', 'Cluster', 'Montant', 'Source', 'Motif', 'Cycle', 'Statut'],
        av.slice(0, 100).map(function (a) {
          return '<tr><td>' + date(a.date) + '</td><td><b>' + esc(a.rt_nom || '—') + '</b></td>' +
            '<td>' + esc(a.cluster || '—') + '</td><td>' + money(a.montant) + '</td>' +
            '<td>' + esc(a.source || '—') + '</td><td>' + esc(a.motif || '—') + '</td>' +
            '<td class="mono">' + esc(a.cycle_id || '—') + '</td><td>' + badge(a.cycle_statut || a.statut) + '</td></tr>';
        })) + '</section>');
  });
}

/* --------------------------------------------------------------- Command Center */

var cmdFilter = { cluster: '', sev: '' };

function renderCommand() {
  paint(head('Command Center', 'Supervision Field Buying : chaque alerte renvoie vers l’objet concerné.') + skeletonPage(4));
  return Promise.all([base(),
    bagsData().catch(function () { return { clusterStock: [], rtStock: [], requests: [], envelopes: [], allocations: [] }; }),
    cashData().catch(function () { return { avances: [], recons: [] }; })])
    .then(function (rs) {
      var c = rs[0], b = rs[1], cash = rs[2];
      var d = derive(c);
      var lastRecon = lastReconByRt(cash.recons);
      var avanceByRt = {};
      cash.avances.forEach(function (a) {
        if (a.statut === 'Annulee') return;
        var k = a.rt_id || normName(a.rt_nom);
        avanceByRt[k] = (avanceByRt[k] || 0) + n(a.montant);
      });
      var alerts = [];
      function add(sev, type, objet, lien, cluster) {
        alerts.push({ sev: sev, type: type, objet: objet, lien: lien, cluster: cluster || '' });
      }
      c.villages.forEach(function (v) {
        if (!(d.rtByVillage[v.id] || []).length) add('rouge', 'Village sans RT', v.village, '#rt/villages', v.cluster);
        else if (!d.byVillageBuy[v.id]) add('orange', 'Village sans achat', v.village, '#rt/villages', v.cluster);
      });
      c.rts.forEach(function (r) {
        var last = d.lastRtBuy[r.id];
        if (!last || daysSince(last) > 14) add('orange', 'RT sans activité récente', r.nom + ' · ' + (r.village_nom || '—'), '#rt/rts', r.cluster);
      });
      c.farmers.forEach(function (f) {
        if (f.possible_duplicate) add('orange', 'Producteur doublon possible', (f.farmer_id || '') + ' · ' + f.nom, '#farmers/' + encodeURIComponent(f.producteur_id), f.cluster_label);
        if (f.review_required) add('orange', 'Producteur à revoir', (f.farmer_id || '') + ' · ' + f.nom, '#farmers/' + encodeURIComponent(f.producteur_id), f.cluster_label);
      });
      /* Alertes reprises du cockpit BM historique. */
      c.achats.forEach(function (a) {
        if (!a.numero_recu) add('rouge', 'Achat sans reçu', (a.producteur_nom || '—') + ' · ' + date(a.date), '#purchases', a.cluster);
        if (a.statut_validation === 'Validation BM requise') add('orange', 'Achat prix hors barème', (a.producteur_nom || '—') + ' · ' + num(a.prix_kg) + ' F/kg', '#purchases', a.cluster);
        if (a.qualite_statut && a.qualite_statut !== 'OK') add('orange', 'Achat qualité à contrôler', (a.producteur_nom || '—') + ' · ' + a.qualite_statut, '#purchases', a.cluster);
      });
      Object.keys(avanceByRt).forEach(function (k) {
        var r = lastRecon[k];
        if (avanceByRt[k] > 0 && (!r || r.statut !== 'Réconcilié')) {
          var rt = c.rm[k] || {};
          add('rouge', 'RT en écart caisse', (rt.nom || (r && r.rt_nom) || k) + ' · avance non réconciliée', '#cash', rt.cluster);
        }
      });
      c.villages.forEach(function (v) {
        if (!villageCoords(v)) add('orange', 'Village sans GPS', v.village, '#hubs', v.cluster);
      });
      b.rtStock.forEach(function (s) {
        var age = daysSince(s.derniere_activite);
        if (n(s.total_sous_responsabilite) > 0 && age != null && age > 30)
          add('orange', 'Sacs trop longtemps chez le RT', (s.rt_nom || s.rt_id) + ' · ' + num(s.total_sous_responsabilite) + ' sac(s), ' + age + ' j', '#bags', s.cluster);
      });
      b.clusterStock.forEach(function (s) {
        if (n(s.stock_cluster_vide) < 100) add('orange', 'Stock cluster faible', s.cluster + ' · ' + num(s.stock_cluster_vide) + ' sac(s) vide(s)', '#bags', s.cluster);
      });
      b.requests.forEach(function (r) {
        if (/PENDING|SUBMITTED|REQUESTED/i.test(String(r.status || '')))
          add('orange', 'Demande de sacs en attente', (r.request_code || r.id) + ' · ' + num(r.requested_qty) + ' sac(s)', '#bags', r.cluster);
        if (r.expires_at && new Date(r.expires_at) < new Date() && /APPROVED|PARTIAL/i.test(String(r.status || '')))
          add('rouge', 'Approbation expirée', r.request_code || r.id, '#bags', r.cluster);
      });

      var clusters = selOptions(c.clusters.map(function (x) { return [x.label, x.label]; }), cmdFilter.cluster);
      paint(head('Command Center', 'Supervision Field Buying : chaque alerte renvoie vers l’objet concerné.') +
        kpis([
          ['Alertes', String(alerts.length), 'au total'],
          ['Problèmes', String(alerts.filter(function (a) { return a.sev === 'rouge'; }).length), 'à traiter en priorité', alerts.some(function (a) { return a.sev === 'rouge'; }) ? 'danger' : ''],
          ['Attention', String(alerts.filter(function (a) { return a.sev === 'orange'; }).length), 'à surveiller', 'warn'],
          ['Périmètre', String(c.villages.length) + ' villages', c.rts.length + ' RT · ' + c.farmers.length + ' producteurs']
        ]) +
        '<section class="card"><div class="card-head"><div><h2>Filtres</h2></div></div><div class="ops-form-grid">' +
        field('Cluster', '<select id="cmdCluster"><option value="">Tous</option>' + clusters + '</select>') +
        field('Sévérité', '<select id="cmdSev"><option value="">Toutes</option>' +
          selOptions([['rouge', 'Problème'], ['orange', 'Attention']], cmdFilter.sev) + '</select>') +
        '</div></section>' +
        '<section class="card"><div class="card-head"><div><h2>Alertes</h2></div></div><div id="cmdTable"></div></section>');

      function apply() {
        var list = alerts.filter(function (a) {
          if (cmdFilter.cluster && normName(a.cluster) !== normName(cmdFilter.cluster)) return false;
          if (cmdFilter.sev && a.sev !== cmdFilter.sev) return false;
          return true;
        });
        list.sort(function (a, b) { return a.sev === b.sev ? 0 : a.sev === 'rouge' ? -1 : 1; });
        document.getElementById('cmdTable').innerHTML = table(['Sévérité', 'Alerte', 'Objet', 'Cluster', ''],
          list.slice(0, 300).map(function (a) {
            return '<tr><td>' + badge(a.sev === 'rouge' ? 'Problème' : 'Attention') + '</td>' +
              '<td>' + esc(a.type) + '</td><td><b>' + esc(a.objet) + '</b></td>' +
              '<td>' + esc(a.cluster || '—') + '</td>' +
              '<td><a class="btn secondary" href="' + a.lien + '">Ouvrir</a></td></tr>';
          }));
      }
      document.getElementById('cmdCluster').addEventListener('change', function () { cmdFilter.cluster = this.value; apply(); });
      document.getElementById('cmdSev').addEventListener('change', function () { cmdFilter.sev = this.value; apply(); });
      apply();
    });
}

/* ------------------------------------------------ Sustainability et Traceability */

function renderSustainability() {
  paint(head('Sustainability', 'Baselines, formations et actions correctives du Farmer Registry.') + skeletonPage(4));
  return sustainabilityData().then(function (rows) {
    var reg = rows.reduce(function (t, r) { return t + n(r.producers_registered); }, 0);
    var baseline = rows.reduce(function (t, r) { return t + n(r.sustainability_baseline_completed); }, 0);
    var trained = rows.reduce(function (t, r) { return t + n(r.trained_farmers); }, 0);
    var open = rows.reduce(function (t, r) { return t + n(r.open_corrective_actions); }, 0);
    paint(head('Sustainability', 'Baselines, formations et actions correctives du Farmer Registry.') +
      '<div class="notice info">La durabilité documente les pratiques : elle ne vaut pas certification automatique.</div>' +
      kpis([
        ['Producteurs couverts', num(reg), 'référentiel'],
        ['Baseline durabilité', num(baseline), reg ? num(baseline / reg * 100, 0) + ' % des producteurs' : ''],
        ['Producteurs formés', num(trained), 'formations enregistrées'],
        ['Actions correctives ouvertes', num(open), open ? 'à suivre' : 'aucune', open ? 'warn' : '']
      ]) +
      '<section class="card"><div class="card-head"><div><h2>Par village</h2></div></div>' +
      table(['Zone', 'Cluster', 'Village', 'Producteurs', 'Baseline', 'Formés', 'Actions ouvertes', 'Risque élevé'],
        rows.slice(0, 100).map(function (r) {
          return '<tr><td>' + esc(r.zone_label || r.zone_code || '—') + '</td>' +
            '<td>' + esc(r.cluster_label || r.cluster_code || '—') + '</td>' +
            '<td><b>' + esc(r.village_nom || '—') + '</b></td>' +
            '<td>' + num(r.producers_registered) + '</td><td>' + num(r.sustainability_baseline_completed) + '</td>' +
            '<td>' + num(r.trained_farmers) + '</td><td>' + num(r.open_corrective_actions) + '</td>' +
            '<td>' + num(r.high_risk_farmers) + '</td></tr>';
        })) + '</section>');
  });
}

function renderTraceability(seed) {
  paint(head('Traceability', 'Chaîne Farmer → Achat → Sacs → Lot → Warehouse → Transfer → Factory.') + skeletonRows(4));
  var html = head('Traceability', 'Chaîne Farmer → Achat → Sacs → Lot → Warehouse → Transfer → Factory.') +
    '<section class="card"><form class="searchbar" id="fbTraceForm">' +
    '<input id="fbTraceQ" type="search" placeholder="Farmer ID, producteur, RT, village, lot, sac…" value="' + esc(seed || '') + '" autocomplete="off">' +
    '<button class="btn primary" type="submit">Rechercher</button></form>' +
    '<div id="fbTraceOut">' + empty('Lancez une recherche pour suivre un élément de la chaîne.') + '</div></section>' +
    '<section class="card"><div class="card-head"><div><h2>Vue transversale</h2></div></div>' +
    '<p class="muted">La recherche complète multi-modules reste disponible dans Traceability 360.</p>' +
    '<div class="ops-actions"><a class="btn secondary" href="traceability.html">Ouvrir Traceability 360</a></div></section>';
  paint(html);
  function run(query) {
    var out = document.getElementById('fbTraceOut');
    if (!query) return;
    out.innerHTML = '<div class="empty">Recherche…</div>';
    /* Réutilise la routine de recherche E2E existante du module terrain. */
    client().then(function (cl) {
      return cl.rpc('field_traceability_search', { p_query: query });
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var rows = r.data || [];
      out.innerHTML = rows.length ? table(
        ['Farmer ID', 'Producteur', 'Achat', 'Poids', 'Lot', 'Expédition', 'Camion', 'Réception', 'Sacs'],
        rows.map(function (x) {
          return '<tr><td class="mono">' + esc(x.farmer_id || '—') + '</td>' +
            '<td><b>' + esc(((x.producteur_nom || '') + ' ' + (x.producteur_prenoms || '')).trim() || '—') + '</b></td>' +
            '<td class="mono">' + esc(x.achat_local_id || x.achat_id || '—') + '</td>' +
            '<td>' + (x.achat_poids_net_kg != null ? num(x.achat_poids_net_kg) + ' kg' : '—') + '</td>' +
            '<td class="mono">' + esc(x.lot_code || '—') + '</td>' +
            '<td class="mono">' + esc(x.shipment_code || '—') + '</td>' +
            '<td>' + esc(x.vehicle_plate || '—') + '</td>' +
            '<td class="mono">' + esc(x.reception_id || '—') + '</td>' +
            '<td>' + (Array.isArray(x.bags) ? x.bags.length : '—') + '</td></tr>';
        })) : empty('Aucun élément trouvé pour « ' + query + ' ».');
    }).catch(function (e) {
      out.innerHTML = danger(e.message);
    });
  }
  var form = document.getElementById('fbTraceForm');
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    run(document.getElementById('fbTraceQ').value.trim());
  });
  if (seed) run(seed);
  return Promise.resolve();
}

/* ------------------------------------------------------------------- routeur */

function paint(html) { if (root) root.innerHTML = html; }

var ROUTES = {
  overview: function () { return renderOverview(); },
  purchases: function (p) { return renderPurchases(p[1], p[2]); },
  census: function () { return renderCensus(); },
  farmers: function (p) { return renderFarmers(p[1]); },
  rt: function (p) { return renderRt(p[1]); },
  hubs: function (p) { return renderHubs(p[1]); },
  bags: function (p) { return renderBags(p[1]); },
  cash: function () { return renderCash(); },
  command: function () { return renderCommand(); },
  sustainability: function () { return renderSustainability(); },
  traceability: function (p) { return renderTraceability(p[1]); }
};

var renderToken = 0;
function render() {
  root = root || document.getElementById('opsRouteView');
  if (!root) return Promise.resolve();
  var p = routeParts();
  var r = ROUTES[p[0]] ? p[0] : 'overview';
  var token = ++renderToken;
  return Promise.resolve()
    .then(function () { return ROUTES[r](p); })
    .catch(function (e) {
      if (token !== renderToken) return;
      console.error('[FIELD BUYING]', e);
      paint(head('Rubrique indisponible', 'Cette rubrique n’a pas pu être affichée.') +
        danger(e && e.message ? e.message : 'Erreur inconnue') +
        '<div class="ops-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_FB.reload()">Réessayer</button></div>');
    });
}
function reload() { FBStore.clear(); render(); }

function preload() {
  var idle = global.requestIdleCallback || function (fn) { return setTimeout(fn, 400); };
  idle(function () {
    base().then(function () {
      idle(function () { bagsData().catch(function () {}); });
    }).catch(function () {});
  });
}

function boot() {
  root = document.getElementById('opsRouteView');
  makeClient();
  loadProfile();
  render().then(preload);
}

/* Publication synchrone du routeur, avant tout appel réseau — la leçon du
   défaut LBA : le dernier init() asynchrone ne doit jamais pouvoir écraser
   un routeur enveloppé par un autre script. */
global.ANAGROCI_OPS_ROUTE = render;
global.ANAGROCI_FB = {
  render: render,
  reload: reload,
  openVillageForm: openVillageForm,
  openRtForm: openRtForm,
  openFarmerForm: openFarmerForm,
  openBuyForm: openBuyForm,
  openBagRequest: openBagRequest,
  rtToFarmer: rtToFarmer,
  closeForm: closeForm,
  store: FBStore
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})(window);
