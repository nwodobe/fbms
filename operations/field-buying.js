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
/* Sexe : la colonne producteurs.sexe est normalisée M/F côté serveur. */
function sexeCode(v) {
  var s = String(v || '').trim().toUpperCase();
  if (s === 'M' || s === 'HOMME' || s === 'MALE') return 'M';
  if (s === 'F' || s === 'FEMME' || s === 'FEMALE') return 'F';
  return '';
}
function sexeLabel(v) {
  var c = sexeCode(v);
  return c === 'M' ? 'M · Homme' : c === 'F' ? 'F · Femme' : (v || '');
}
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
      /* Vues LIGHT (security_invoker) : mêmes lignes, data sans les images
         base64 héritées du recensement (~21 Mo évités au chargement). Les
         triggers trg_fb_preserve_media_* conservent ces clés côté serveur
         quand un formulaire réécrit data sans elles. */
      q('villages_light_v', 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,data,deleted', 500),
      q('rt_light_v', 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted,data', 500),
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
      /* Demandes triées côté serveur : jamais « récentes » par hasard. */
      q('ops_bag_requests', 'id,request_code,channel,campaign,cluster,rt_id,requested_qty,approved_qty,released_qty,received_qty,status,requested_at,approved_at,expires_at,closed_reason,notes,destination_location_code,source_location_code', 100,
        function (r) { return r.order('requested_at', { ascending: false }); }),
      q('aflp_bag_envelopes', 'id,campaign,approved_qty,status,approved_at', 20),
      q('aflp_bag_cluster_allocations', 'id,envelope_id,cluster,allocated_qty', 60),
      /* Registre des locations : les codes réels (AFLP-CL-…, AFLP-RT-…) sont
         la clé de voûte — une demande sans code réel ne peut pas se libérer. */
      q('rcn_jute_locations', 'code,scope_type,cluster,rt_id,nom,actif', 400),
      /* Colonne canonique de la sortie : released_at (défaut now()). La table
         n'a jamais porté de created_at ; l'ancien nom renvoyait un 400 qui
         faisait échouer tout le Promise.all — donc TOUTE la rubrique Sacherie,
         Pilotage compris, pas seulement « Demandes & sorties ». */
      q('ops_bag_releases', 'id,client_release_id,request_id,qty,source_location_code,destination_location_code,released_by,proof_url,notes,released_at', 60,
        function (r) { return r.order('released_at', { ascending: false }); }),
      q('sacherie_ct_global_stock', '*', 1),
      q('rcn_jute_loss_requests', 'id,location_code,state,qty,motif,statut,submitted_at', 50,
        function (r) { return r.order('submitted_at', { ascending: false }); }),
      q('sacherie_ct_latest_inventory', 'id,location_code,state,theoretical_qty,counted_qty,difference_qty,motif,reconciliation_status,counted_at', 60)
    ]).then(function (rs) {
      return { clusterStock: rs[0], rtStock: rs[1], requests: rs[2], envelopes: rs[3], allocations: rs[4],
        locations: rs[5], releases: rs[6], global: rs[7][0] || {}, pertes: rs[8], inventaires: rs[9] };
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

/* ==================== formulaires riches — recensement complet ====================
   Mêmes données que l'ancien FBMS (villages.data s1…s9, dossier RT, enrôlement
   producteur), présentées en sections progressives : un dossier incomplet reste
   utilisable, la règle 2027 (parcelle/GPS jamais bloquante) est intacte.
   Trois niveaux : Minimum opérationnel → Profil enrichi → Dossier complet. */

/* Référentiel officiel des régions et départements de Côte d'Ivoire — identique
   à celui du recensement historique ; la région est dérivée du département. */
var REGIONS = [
  { region: 'Gbêkê', departements: ['Bouaké', 'Béoumi', 'Botro', 'Sakassou'] },
  { region: 'Bélier', departements: ['Yamoussoukro', 'Attiégouakro', 'Didiévi', 'Djékanou', 'Tiébissou', 'Toumodi'] },
  { region: 'Hambol', departements: ['Katiola', 'Dabakala', 'Niakaramandougou'] },
  { region: 'Worodougou', departements: ['Séguéla', 'Kani'] },
  { region: 'Béré', departements: ['Mankono', 'Dianra', 'Kounahiri'] },
  { region: 'Bagoué', departements: ['Boundiali', 'Kouto', 'Tengréla'] },
  { region: 'Poro', departements: ['Korhogo', 'Dikodougou', "M'Bengué", 'Sinématiali'] },
  { region: 'Tchologo', departements: ['Ferkessédougou', 'Kong', 'Ouangolodougou'] },
  { region: 'Agnéby-Tiassa', departements: ['Agboville', 'Sikensi', 'Taabo', 'Tiassalé'] },
  { region: 'Bafing', departements: ['Touba', 'Koro', 'Ouaninou'] },
  { region: 'Bounkani', departements: ['Bouna', 'Doropo', 'Nassian', 'Téhini'] },
  { region: 'Cavally', departements: ['Guiglo', 'Bloléquin', 'Taï', 'Toulepleu'] },
  { region: 'Folon', departements: ['Minignan', 'Kaniasso'] },
  { region: 'Gbôklé', departements: ['Sassandra', 'Fresco'] },
  { region: 'Gôh', departements: ['Gagnoa', 'Oumé'] },
  { region: 'Gontougo', departements: ['Bondoukou', 'Koun-Fao', 'Sandégué', 'Tanda', 'Transua'] },
  { region: 'Grands-Ponts', departements: ['Dabou', 'Grand-Lahou', 'Jacqueville'] },
  { region: 'Guémon', departements: ['Duékoué', 'Bangolo', 'Facobly', 'Kouibly'] },
  { region: 'Haut-Sassandra', departements: ['Daloa', 'Issia', 'Vavoua', 'Zoukougbeu'] },
  { region: 'Iffou', departements: ['Daoukro', "M'Bahiakro", 'Prikro'] },
  { region: 'Indénié-Djuablin', departements: ['Abengourou', 'Agnibilékrou', 'Bettié'] },
  { region: 'Kabadougou', departements: ['Odienné', 'Gbéléban', 'Madinani', 'Samatiguila', 'Séguélon'] },
  { region: 'La Mé', departements: ['Adzopé', 'Akoupé', 'Alépé', 'Yakassé-Attobrou'] },
  { region: 'Lôh-Djiboua', departements: ['Divo', 'Guitry', 'Lakota'] },
  { region: 'Marahoué', departements: ['Bouaflé', 'Sinfra', 'Zuénoula'] },
  { region: 'Moronou', departements: ['Bongouanou', 'Arrah', "M'Batto"] },
  { region: 'Nawa', departements: ['Soubré', 'Buyo', 'Guéyo', 'Méagui'] },
  { region: "N'Zi", departements: ['Dimbokro', 'Bocanda', 'Kouassi-Kouassikro'] },
  { region: 'San-Pédro', departements: ['San-Pédro', 'Tabou'] },
  { region: 'Sud-Comoé', departements: ['Aboisso', 'Adiaké', 'Grand-Bassam', 'Tiapoum'] },
  { region: 'Tonkpi', departements: ['Man', 'Biankouma', 'Danané', 'Sipilou', 'Zouan-Hounien'] },
  { region: 'Abidjan (district)', departements: ['Abidjan', 'Anyama'] }
];

function val(id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
function numVal(id) { var v = val(id); return v === '' ? null : n(v); }
function chk(id) { var e = document.getElementById(id); return !!(e && e.checked); }
function checkbox(id, label, checked) {
  return '<label class="ops-check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
}
/* Section dépliable d'un formulaire progressif. */
function section(titre, contenu, open, sous) {
  return '<details class="ops-sec"' + (open ? ' open' : '') + '><summary>' + esc(titre) +
    (sous ? ' <span class="muted">' + esc(sous) + '</span>' : '') + '</summary>' +
    '<div class="ops-sec-body">' + contenu + '</div></details>';
}
/* Barre de complétude : compte les champs marqués data-c non vides dans le
   formulaire. Un dossier incomplet reste UTILISABLE — la barre informe, elle ne
   bloque jamais. */
function completenessBar(formId) {
  return '<div class="ops-progressline"><div class="ops-progresstrack"><i id="' + formId + '_fill"></i></div>' +
    '<span id="' + formId + '_pct" class="muted">0 %</span>' +
    '<span id="' + formId + '_level" class="badge info">Minimum opérationnel</span></div>';
}
function bindCompleteness(formId) {
  var form = document.getElementById(formId);
  if (!form) return function () {};
  function refresh() {
    var fields = [].slice.call(form.querySelectorAll('[data-c]'));
    var done = fields.filter(function (e) {
      return e.type === 'checkbox' ? e.checked : String(e.value || '').trim() !== '';
    }).length;
    var pct = fields.length ? Math.round(done / fields.length * 100) : 0;
    var fill = document.getElementById(formId + '_fill');
    var lbl = document.getElementById(formId + '_pct');
    var lvl = document.getElementById(formId + '_level');
    if (fill) fill.style.width = pct + '%';
    if (lbl) lbl.textContent = 'Complétude du dossier : ' + pct + ' %';
    if (lvl) {
      lvl.textContent = pct >= 80 ? 'Dossier complet' : pct >= 45 ? 'Profil enrichi' : 'Minimum opérationnel';
      lvl.className = 'badge ' + (pct >= 80 ? 'ok' : pct >= 45 ? 'info' : 'warn');
    }
    return pct;
  }
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();
  return refresh;
}
/* Bouton « Utiliser ma position » — facultatif, jamais bloquant. */
function geoButton(latId, lngId) {
  return '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.fillGps(\'' + latId + '\',\'' + lngId + '\')">📍 Utiliser ma position</button>';
}
function fillGps(latId, lngId) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(function (p) {
    var la = document.getElementById(latId), lo = document.getElementById(lngId);
    if (la) la.value = p.coords.latitude.toFixed(6);
    if (lo) lo.value = p.coords.longitude.toFixed(6);
    var f = la && la.closest('form');
    if (f) f.dispatchEvent(new Event('input'));
  }, function () {}, { enableHighAccuracy: true, timeout: 8000 });
}
var NOTE20 = [['', '—'], ['0', '0'], ['5', '5'], ['10', '10'], ['15', '15'], ['20', '20']];

/* ------------------------------- VILLAGE — recensement complet s1…s9 ---------- */

function openVillageForm(editId) {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), loadProfile()]).then(function (rs) {
    var c = rs[0];
    if (!guardTerrain(host)) return;
    /* Mode édition : mêmes sections, valeurs préremplies, MÊME ligne mise à jour. */
    var editRow = editId ? c.vm[editId] : null;
    var E = (editRow && editRow.data) || {};
    var E1 = E.s1 || {}, E2 = E.s2 || {}, E3 = E.s3 || {}, E4 = E.s4 || {}, E5 = E.s5 || {},
        E6 = E.s6 || {}, E7 = E.s7 || {}, E8 = E.s8 || {}, E9 = E.s9 || {};
    function pv(x) { return x == null ? '' : esc(x); }
    var clusterOpts = selOptions(c.clusters.map(function (x) { return [x.label, x.label + ' — zone ' + (x.zone_code || '')]; }), '');
    var regionOpts = selOptions(REGIONS.map(function (r) { return [r.region, r.region]; }), 'Gbêkê');
    var influence = selOptions([['', '—'], ['Forte', 'Forte'], ['Moyenne', 'Moyenne'], ['Faible', 'Faible']], '');
    var reput = selOptions([['', '—'], ['Excellente', 'Excellente'], ['Bonne', 'Bonne'], ['Moyenne', 'Moyenne'], ['Faible', 'Faible']], '');

    function candidat(i) {
      return section('Candidat RT n° ' + i, '<div class="ops-form-grid">' +
        field('Nom', '<input id="vc' + i + '_nom" data-c maxlength="120">') +
        field('Téléphone', '<input id="vc' + i + '_tel" data-c inputmode="tel">') +
        field('Activité', '<input id="vc' + i + '_act" data-c placeholder="Ex. Producteur, pisteur">') +
        field('Instruction', '<select id="vc' + i + '_ins" data-c><option value="">—</option><option>Lit et écrit</option><option>Lit seulement</option><option>Aucune</option></select>') +
        field('Réputation', '<select id="vc' + i + '_rep" data-c>' + reput + '</select>') +
        field('Équipement', checkbox('vc' + i + '_smart', 'Smartphone') + checkbox('vc' + i + '_bank', 'Compte bancaire') + checkbox('vc' + i + '_wave', 'Compte Wave')) +
        '</div>', false);
    }

    host.innerHTML = '<div class="card-head"><div><h2>' + (editRow ? 'Modifier le village — ' + esc(editRow.village) : 'Nouveau village — fiche de recensement') + '</h2>' +
      '<p>Les 9 sections du recensement terrain. Seuls le nom et le cluster sont requis pour créer le village ' +
      '(minimum opérationnel) ; le reste enrichit le dossier et peut être complété plus tard.</p></div></div>' +
      '<form id="villageForm">' + completenessBar('villageForm') +

      section('1. Identification', '<div class="ops-form-grid">' +
        field('Nom du village *', '<input id="vf_nom" data-c required maxlength="120" value="' + pv(editRow && editRow.village) + '">', true) +
        field('Cluster (hub de rattachement) *', '<select id="vf_cluster" data-c required><option value="">Choisir…</option>' + clusterOpts + '</select>') +
        field('Région', '<select id="vf_region" data-c>' + regionOpts + '</select>') +
        field('Département', '<select id="vf_dept" data-c></select>') +
        field('Sous-préfecture', '<input id="vf_sp" data-c value="' + pv(E1.sousPrefecture) + '">') +
        field('Date de visite', '<input id="vf_date" data-c type="date" value="' + new Date().toISOString().slice(0, 10) + '">') +
        field('Enquêteur', '<input id="vf_enq" data-c value="' + esc(profile.nom || '') + '">') +
        '</div>', true) +

      section('2. Localisation & GPS', '<div class="ops-form-grid">' +
        field('Latitude', '<input id="vf_lat" data-c type="number" step="any" placeholder="Facultatif — jamais bloquant" value="' + pv(E1.gpsLat) + '">') +
        field('Longitude', '<input id="vf_lng" data-c type="number" step="any" value="' + pv(E1.gpsLng) + '">') +
        field('&nbsp;', geoButton('vf_lat', 'vf_lng')) +
        field('Distance au hub (km, saisie terrain)', '<input id="vf_dist" data-c type="number" step="any" min="0" value="' + pv(E1.distanceHub) + '">') +
        '</div><p class="muted">La distance routière validée reste gérée par l’audit des distances ' +
        '(validation avec motif) ; la valeur saisie ici sert d’estimation initiale.</p>', false) +

      section('3. Potentiel de production', '<div class="ops-form-grid">' +
        field('Nombre de producteurs estimé', '<input id="vf_nbprod" data-c type="number" min="0" value="' + pv(E3.nbProducteurs) + '">') +
        field('Production moyenne / producteur (kg)', '<input id="vf_prodmoy" data-c type="number" min="0" value="' + pv(E3.prodMoyenneKg) + '">') +
        field('Potentiel (MT)', '<input id="vf_pot" data-c type="number" step="any" min="0" value="' + pv(E3.potentielMT) + '"> <button class="btn secondary" type="button" onclick="ANAGROCI_FB.calcPotentiel()">Calculer</button>') +
        field('Potentiel sécurisé ANAGROCI (MT)', '<input id="vf_sec" data-c type="number" step="any" min="0" value="' + pv(E3.potentielSecuriseMT) + '">') +
        field('Période forte de disponibilité', '<input id="vf_periode" data-c placeholder="Ex. Février – Avril" value="' + pv(E3.periodeForte) + '">') +
        '</div>', false) +

      section('4. Concurrence & achat', '<div id="vf_acheteurs"></div>' +
        '<div class="ops-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_FB.addAcheteur()">+ Ajouter un acheteur concurrent</button></div>' +
        '<div class="ops-form-grid" style="margin-top:10px">' +
        field('Acheteur dominant — nom', '<input id="vf_dom_nom" data-c value="' + pv(E4.dominant && E4.dominant.nom) + '">') +
        field('Acheteur dominant — téléphone', '<input id="vf_dom_tel" data-c inputmode="tel" value="' + pv(E4.dominant && E4.dominant.telephone) + '">') +
        field('Commentaires concurrence', '<textarea id="vf_dom_com" data-c>' + pv(E4.dominant && E4.dominant.commentaires) + '</textarea>', true) +
        '</div>', false) +

      section('5. Accessibilité & route', '<div class="ops-form-grid">' +
        field('Type d’accès', '<select id="vf_acces" data-c><option value="">—</option><option>Route praticable</option><option>Piste</option><option>Enclavé</option></select>') +
        field('Note route (/10)', '<input id="vf_noteroute" data-c type="number" min="0" max="10" value="' + pv(E5.noteRoute) + '">') +
        field('Caractéristiques', checkbox('vf_bitume', 'Route bitumée') + checkbox('vf_piste', 'Piste praticable') + checkbox('vf_pluies', 'Accessible en saison des pluies'), true) +
        field('Accès camion', checkbox('vf_c10', 'Camion 10 T') + checkbox('vf_c30', 'Camion 30 T'), true) +
        '</div>', false) +

      section('6. Paiement & services financiers', '<div class="ops-form-grid">' +
        field('Réseau mobile disponible', checkbox('vf_ro', 'Orange') + checkbox('vf_rm', 'MTN') + checkbox('vf_rv', 'Moov'), true) +
        field('Mobile money accepté', checkbox('vf_mo', 'Orange Money') + checkbox('vf_mw', 'Wave') + checkbox('vf_mm', 'MTN Money'), true) +
        field('Banque la plus proche', '<input id="vf_banque" data-c value="' + pv(E6.banque && E6.banque.nom) + '">') +
        field('Distance banque (km)', '<input id="vf_banque_km" data-c type="number" step="any" min="0" value="' + pv(E6.banque && E6.banque.distance) + '">') +
        field('Préférence de paiement', '<select id="vf_pref" data-c><option value="">—</option><option>Cash</option><option>Wave</option><option>Orange Money</option><option>Virement</option></select>') +
        '</div>', false) +

      section('7. Candidats RT identifiés', candidat(1) + candidat(2) + candidat(3) +
        '<p class="muted">Un candidat retenu se crée ensuite comme RT depuis Recensement → + Nouveau RT.</p>', false) +

      section('8. Organisation locale & conformité', '<div class="ops-form-grid">' +
        field('Chef de village — nom', '<input id="vf_chef" data-c value="' + pv(E2.chef && E2.chef.nom) + '">') +
        field('Chef — téléphone', '<input id="vf_chef_tel" data-c inputmode="tel" value="' + pv(E2.chef && E2.chef.telephone) + '">') +
        field('Chef — influence', '<select id="vf_chef_inf" data-c>' + influence + '</select>') +
        field('Leader communautaire — nom', '<input id="vf_lead" data-c value="' + pv(E2.leader && E2.leader.nom) + '">') +
        field('Leader — téléphone', '<input id="vf_lead_tel" data-c inputmode="tel" value="' + pv(E2.leader && E2.leader.telephone) + '">') +
        field('Président coopérative — nom', '<input id="vf_pres" data-c value="' + pv(E2.president && E2.president.nom) + '">') +
        field('Coopérative', '<input id="vf_coop" data-c value="' + pv(E2.president && E2.president.cooperative) + '">') +
        field('Conformité', checkbox('vf_zone_ok', 'Village dans la zone du cluster') + checkbox('vf_carte', 'Carte pisteur disponible') +
          checkbox('vf_foncier', 'Pas de conflit foncier') + checkbox('vf_commu', 'Pas de conflit communautaire'), true) +
        '</div>', false) +

      section('9. Évaluation & risques', '<div class="ops-form-grid">' +
        field('Potentiel (/20)', '<select id="vf_s9_pot" data-c>' + selOptions(NOTE20, '') + '</select>') +
        field('Route (/20)', '<select id="vf_s9_route" data-c>' + selOptions(NOTE20, '') + '</select>') +
        field('Disponibilité RT (/20)', '<select id="vf_s9_rt" data-c>' + selOptions(NOTE20, '') + '</select>') +
        field('Risque concurrentiel (/20)', '<select id="vf_s9_conc" data-c>' + selOptions(NOTE20, '') + '</select>') +
        field('Faisabilité paiement (/20)', '<select id="vf_s9_pay" data-c>' + selOptions(NOTE20, '') + '</select>') +
        field('Score', '<input id="vf_score" readonly class="mono" placeholder="—">') +
        field('Décision / observations', '<textarea id="vf_decision" data-c>' + pv(E9.decision) + '</textarea>', true) +
        '</div>', false) +

      section('10. Photos du recensement (recommandées)', '<div class="notice ok">La photo est recommandée, ' +
        'jamais bloquante : le village peut être créé sans photo et la galerie complétée depuis sa fiche.</div>' +
        '<div class="ops-actions"><button class="btn secondary" type="button" id="vf_photo_btn">📷 Prendre / ajouter des photos</button></div>' +
        '<div id="vf_photos_list" class="muted"></div>', false) +
      '<div id="vf_dup"></div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="vf_submit">' + (editRow ? 'Enregistrer les modifications' : 'Créer le village') + '</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="vf_msg" class="muted" style="margin-top:10px"></div></form>';

    /* Départements dépendants de la région — référentiel officiel. */
    var regSel = document.getElementById('vf_region'), depSel = document.getElementById('vf_dept');
    function syncDept() {
      var r = REGIONS.filter(function (x) { return x.region === regSel.value; })[0];
      depSel.innerHTML = '<option value="">—</option>' +
        selOptions((r ? r.departements : []).map(function (d) { return [d, d]; }), '');
    }
    regSel.addEventListener('change', syncDept);
    if (editRow) {
      regSel.value = E1.region || 'Gbêkê';
    }
    syncDept();
    if (editRow) {
      var setV = function (id, v) { var e = document.getElementById(id); if (e && v != null && v !== '') e.value = v; };
      var setC = function (id, v) { var e = document.getElementById(id); if (e) e.checked = !!v; };
      setV('vf_cluster', E1.cluster || editRow.cluster);
      setV('vf_dept', E1.departement);
      setV('vf_date', E1.dateVisite);
      setV('vf_enq', E1.enqueteur);
      setV('vf_acces', E5.typeAcces);
      setC('vf_bitume', E5.routeBitumee); setC('vf_piste', E5.pistePraticable); setC('vf_pluies', E5.accessiblePluies);
      setC('vf_c10', E5.camion10T); setC('vf_c30', E5.camion30T);
      var res = E6.reseau || {}, mm = E6.mobileMoney || {};
      setC('vf_ro', res.Orange); setC('vf_rm', res.MTN); setC('vf_rv', res.Moov);
      setC('vf_mo', mm.OrangeMoney); setC('vf_mw', mm.Wave); setC('vf_mm', mm.MTNMoney);
      setV('vf_pref', typeof E6.preference === 'string' ? E6.preference : '');
      setC('vf_zone_ok', E8.zoneCluster); setC('vf_carte', E8.cartePisteur);
      setC('vf_foncier', E8.pasConflitFoncier); setC('vf_commu', E8.pasConflitCommunautaire);
      ['potentiel20:vf_s9_pot', 'route20:vf_s9_route', 'dispoRT20:vf_s9_rt',
       'risqueConcurrentiel20:vf_s9_conc', 'faisabilitePaiement20:vf_s9_pay'].forEach(function (m) {
        var kv = m.split(':');
        if (E9[kv[0]] != null) setV(kv[1], String(E9[kv[0]]));
      });
      (E7.candidats || []).slice(0, 3).forEach(function (cd, i) {
        var j = i + 1;
        setV('vc' + j + '_nom', cd.nom); setV('vc' + j + '_tel', cd.telephone);
        setV('vc' + j + '_act', cd.activite); setV('vc' + j + '_ins', cd.instruction);
        setV('vc' + j + '_rep', cd.reputation);
        setC('vc' + j + '_smart', cd.smartphone); setC('vc' + j + '_bank', cd.compteBancaire); setC('vc' + j + '_wave', cd.compteWave);
      });
    }

    /* Score /100 = somme des 5 critères, comme l'ancien recensement. */
    function syncScore() {
      var ids = ['vf_s9_pot', 'vf_s9_route', 'vf_s9_rt', 'vf_s9_conc', 'vf_s9_pay'];
      var vals = ids.map(val);
      document.getElementById('vf_score').value = vals.every(function (v) { return v !== ''; })
        ? vals.reduce(function (t, v) { return t + n(v); }, 0) + ' / 100'
        : (vals.some(function (v) { return v !== ''; }) ? 'notation incomplète' : '');
    }
    ['vf_s9_pot', 'vf_s9_route', 'vf_s9_rt', 'vf_s9_conc', 'vf_s9_pay'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', syncScore);
    });

    var pendingPhotos = [];
    var photoBtn = document.getElementById('vf_photo_btn');
    if (photoBtn) photoBtn.addEventListener('click', function () {
      pickPhoto({ capture: true }).then(function (file) {
        if (!file) return;
        pendingPhotos.push(file);
        document.getElementById('vf_photos_list').textContent =
          pendingPhotos.length + ' photo(s) prête(s) — téléversées à l’enregistrement.';
      });
    });
    var refresh = bindCompleteness('villageForm');
    if (editRow && (E4.acheteurs || []).length) {
      (E4.acheteurs || []).forEach(function (a) { addAcheteur(a); });
    } else addAcheteur();
    refresh();

    var nom = document.getElementById('vf_nom');
    nom.focus();
    nom.addEventListener('input', function () {
      var k = normName(nom.value);
      var hit = c.villages.filter(function (v) { return normName(v.village) === k && (!editRow || v.id !== editRow.id); })[0];
      document.getElementById('vf_dup').innerHTML = hit
        ? '<div class="notice danger"><b>Un village de ce nom existe déjà :</b> ' + esc(hit.village) +
          ' (' + esc(hit.cluster || '—') + ', ' + esc(hit.region || '—') + '). Vérifiez avant de créer un doublon.</div>' : '';
    });

    document.getElementById('villageForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('vf_msg'), btn = document.getElementById('vf_submit');
      var name = val('vf_nom'), cluster = val('vf_cluster');
      if (!name || !cluster) { msg.className = 'ops-danger-text'; msg.textContent = 'Nom et cluster sont le minimum opérationnel.'; return; }
      var id = editRow ? editRow.id : uid();
      var acheteurs = collectAcheteurs();
      var s9vals = ['vf_s9_pot', 'vf_s9_route', 'vf_s9_rt', 'vf_s9_conc', 'vf_s9_pay'].map(val);
      var score = s9vals.every(function (v) { return v !== ''; })
        ? s9vals.reduce(function (t, v) { return t + n(v); }, 0) : null;
      var candidats = [1, 2, 3].map(function (i) {
        return { nom: val('vc' + i + '_nom'), telephone: val('vc' + i + '_tel'), activite: val('vc' + i + '_act'),
          instruction: val('vc' + i + '_ins'), reputation: val('vc' + i + '_rep'),
          smartphone: chk('vc' + i + '_smart'), compteBancaire: chk('vc' + i + '_bank'), compteWave: chk('vc' + i + '_wave') };
      }).filter(function (x) { return x.nom; });
      /* Structure identique à l'ancien recensement : tout vit dans data s1…s9,
         les colonnes plates sont synchronisées. */
      var data = {
        id: id,
        statut: editRow ? (editRow.statut || 'Brouillon') : 'Brouillon',
        createdAt: editRow ? (E.createdAt || null) : new Date().toISOString(),
        createdBy: editRow ? (E.createdBy || '') : (profile.nom || ''),
        updatedAt: editRow ? new Date().toISOString() : undefined,
        updatedBy: editRow ? (profile.nom || '') : undefined,
        galerie: editRow ? (E.galerie || []) : [],
        s1: { village: name, cluster: cluster, region: val('vf_region'), departement: val('vf_dept'),
              sousPrefecture: val('vf_sp'), dateVisite: val('vf_date'), enqueteur: val('vf_enq'),
              gpsLat: numVal('vf_lat'), gpsLng: numVal('vf_lng'), distanceHub: numVal('vf_dist') },
        s2: { chef: { nom: val('vf_chef'), telephone: val('vf_chef_tel'), influence: val('vf_chef_inf') },
              leader: { nom: val('vf_lead'), telephone: val('vf_lead_tel') },
              president: { nom: val('vf_pres'), cooperative: val('vf_coop') } },
        s3: { nbProducteurs: numVal('vf_nbprod'), prodMoyenneKg: numVal('vf_prodmoy'),
              potentielMT: numVal('vf_pot'), potentielSecuriseMT: numVal('vf_sec'), periodeForte: val('vf_periode') },
        s4: { acheteurs: acheteurs,
              dominant: { nom: val('vf_dom_nom'), telephone: val('vf_dom_tel'), commentaires: val('vf_dom_com') } },
        s5: { typeAcces: val('vf_acces'), noteRoute: numVal('vf_noteroute'),
              routeBitumee: chk('vf_bitume'), pistePraticable: chk('vf_piste'), accessiblePluies: chk('vf_pluies'),
              camion10T: chk('vf_c10'), camion30T: chk('vf_c30') },
        s6: { reseau: { Orange: chk('vf_ro'), MTN: chk('vf_rm'), Moov: chk('vf_rv') },
              mobileMoney: { OrangeMoney: chk('vf_mo'), Wave: chk('vf_mw'), MTNMoney: chk('vf_mm') },
              banque: { nom: val('vf_banque'), distance: numVal('vf_banque_km') },
              preference: val('vf_pref') },
        s7: { candidats: candidats },
        s8: { zoneCluster: chk('vf_zone_ok'), cartePisteur: chk('vf_carte'),
              pasConflitFoncier: chk('vf_foncier'), pasConflitCommunautaire: chk('vf_commu') },
        s9: { potentiel20: numVal('vf_s9_pot'), route20: numVal('vf_s9_route'), dispoRT20: numVal('vf_s9_rt'),
              risqueConcurrentiel20: numVal('vf_s9_conc'), faisabilitePaiement20: numVal('vf_s9_pay'),
              decision: val('vf_decision') },
        completude: refresh()
      };
      btn.disabled = true; msg.className = 'muted';
      msg.textContent = editRow ? 'Enregistrement des modifications…' : 'Création en cours…';
      client().then(function (cl) {
        var row = {
          village: name, cluster: cluster,
          region: data.s1.region || null, departement: data.s1.departement || null,
          gps_lat: data.s1.gpsLat, gps_lng: data.s1.gpsLng, score: score, data: data
        };
        /* Édition : la MÊME ligne est mise à jour ; l'id ne change jamais. */
        if (editRow) return cl.from('villages').update(row).eq('id', editRow.id);
        row.id = id; row.statut = 'Brouillon';
        return cl.from('villages').insert(row);
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        msg.className = 'ops-ok-text';
        msg.textContent = editRow
          ? 'Village modifié : ' + name + ' (dossier ' + data.completude + ' %).'
          : 'Village créé : ' + name + ' (dossier ' + data.completude + ' %). Visible dans RT & Villages, la carte et le Command Center.';
        auditLog(editRow ? 'village_modifie' : 'village_cree', id + ' · ' + name);
        /* Photos du recensement : après l'enregistrement, jamais bloquantes. */
        if (pendingPhotos.length) {
          msg.textContent += ' Téléversement de ' + pendingPhotos.length + ' photo(s)…';
          var chain = Promise.resolve();
          pendingPhotos.forEach(function (file) {
            chain = chain.then(function () {
              return compressImage(file, 1280, 0.8).then(function (blob) {
                return client().then(function (cl2) {
                  var path = id + '/gallery/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '.jpg';
                  return cl2.storage.from(BUCKET_PHOTOS).upload(path, blob, { contentType: 'image/jpeg' })
                    .then(function (up) {
                      if (up.error) return;
                      data.galerie = (data.galerie || []).concat([{ path: path, legende: '', categorie: 'Autre',
                        date: new Date().toISOString(), agent: profile.nom || '' }]);
                    });
                });
              }).catch(function () {});
            });
          });
          chain.then(function () {
            client().then(function (cl3) {
              cl3.from('villages').update({ data: data }).eq('id', id).then(function () {
                auditLog('village_photo_ajoutee', id + ' · recensement × ' + pendingPhotos.length);
              });
            });
          });
        }
        FBStore.invalidate('base');
        setTimeout(function () {
          closeForm();
          if (editRow) location.hash = '#villages/' + encodeURIComponent(editRow.id);
          render();
        }, 1100);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Création impossible.';
      });
    });
  });
}

/* Liste dynamique des acheteurs concurrents — reprise de l'ancien s4. */
var acheteurSeq = 0;
function addAcheteur(prefill) {
  var box = document.getElementById('vf_acheteurs');
  if (!box) return;
  var i = ++acheteurSeq;
  var row = document.createElement('div');
  row.className = 'ops-form-grid ops-acheteur';
  row.innerHTML = field('Acheteur concurrent', '<input id="va' + i + '_nom" data-c placeholder="Nom" value="' + esc(prefill && prefill.nom || '') + '">') +
    field('Volume estimé (MT)', '<input id="va' + i + '_vol" data-c type="number" step="any" min="0" value="' + esc(prefill && prefill.volumeEstime != null ? prefill.volumeEstime : '') + '">') +
    field('&nbsp;', '<button class="btn secondary" type="button" onclick="this.closest(\'.ops-acheteur\').remove()">Retirer</button>');
  box.appendChild(row);
}
function collectAcheteurs() {
  return [].slice.call(document.querySelectorAll('#vf_acheteurs .ops-acheteur')).map(function (row) {
    var inp = row.querySelectorAll('input');
    return { nom: String(inp[0].value || '').trim(), volumeEstime: inp[1].value === '' ? null : n(inp[1].value) };
  }).filter(function (a) { return a.nom; });
}
function calcPotentiel() {
  var nb = numVal('vf_nbprod'), moy = numVal('vf_prodmoy');
  var out = document.getElementById('vf_pot');
  if (out && nb != null && moy != null) {
    out.value = Math.round(nb * moy / 1000 * 10) / 10;
    out.closest('form').dispatchEvent(new Event('input'));
  }
}

/* ---------------------------------- RT — dossier complet ---------------------- */

function openRtForm(prefill, editId) {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), loadProfile()]).then(function (rs) {
    var c = rs[0];
    if (!guardTerrain(host)) return;
    var editRow = editId ? c.rm[editId] : null;
    var ED = (editRow && editRow.data) || {};
    var villageOpts = selOptions(c.villages.map(function (v) { return [v.id, v.village + ' · ' + (v.cluster || '—')]; }), prefill && prefill.village_id || '');
    var reput = selOptions([['', '—'], ['Excellente', 'Excellente'], ['Bonne', 'Bonne'], ['Moyenne', 'Moyenne'], ['Faible', 'Faible']], '');

    host.innerHTML = '<div class="card-head"><div><h2>' + (editRow ? 'Modifier le RT — ' + esc(editRow.nom) + ' <span class="mono muted">' + esc(editRow.id_rt || '') + '</span>' : 'Nouveau RT — dossier complet') + '</h2>' +
      '<p>Nom, téléphone et village suffisent pour créer le RT (minimum opérationnel) ; ' +
      'le reste construit la fiche exploitable par le Branch Manager.</p></div></div>' +
      '<form id="rtForm">' + completenessBar('rtForm') +

      section('1. Identité', '<div class="ops-form-grid">' +
        field('Nom du RT *', '<input id="rf_nom" data-c required maxlength="120">', true) +
        field('Téléphone principal *', '<input id="rf_tel" data-c required inputmode="tel" placeholder="10 chiffres — clé de dédoublonnage">') +
        field('Téléphone secondaire', '<input id="rf_tel2" data-c inputmode="tel">') +
        field('Village *', '<select id="rf_village" data-c required><option value="">Choisir…</option>' + villageOpts + '</select>') +
        field('Cluster / zone', '<input id="rf_cluster_ro" readonly class="mono" placeholder="dérivés du village">') +
        '</div>', true) +

      section('2. Activité', '<div class="ops-form-grid">' +
        field('Activité principale', '<select id="rf_act" data-c><option value="">—</option><option>Producteur</option><option>Pisteur</option><option>Commerçant</option><option>Planteur</option><option>Autre</option></select>') +
        field('Producteur lui-même', '<select id="rf_prod" data-c><option value="">—</option><option value="OUI">OUI — pourra être enrôlé comme producteur</option><option value="NON">NON</option></select>') +
        field('Instruction', '<select id="rf_ins" data-c><option value="">—</option><option>Lit et écrit</option><option>Lit seulement</option><option>Aucune</option></select>') +
        field('Moyen de déplacement', '<select id="rf_depl" data-c><option value="">—</option><option>Moto</option><option>Vélo</option><option>Véhicule</option><option>Aucun</option></select>') +
        '</div>', false) +

      section('3. Capacité & terrain', '<div class="ops-form-grid">' +
        field('Expérience achat RCN (années)', '<input id="rf_exp" data-c type="number" min="0">') +
        field('Producteurs connus / mobilisables', '<input id="rf_nbprod" data-c type="number" min="0">') +
        field('Volume potentiel (MT)', '<input id="rf_vol" data-c type="number" step="any" min="0">') +
        field('Zone d’influence', '<input id="rf_zone_inf" data-c placeholder="Villages ou campements couverts">') +
        field('Disponibilité', '<select id="rf_dispo" data-c><option value="">—</option><option>Temps plein</option><option>Temps partiel</option><option>Saisonnier</option></select>') +
        '</div>', false) +

      section('4. Finance & paiement', '<div class="ops-form-grid">' +
        field('Équipement', checkbox('rf_smart', 'Smartphone') + checkbox('rf_bank', 'Compte bancaire') + checkbox('rf_wave', 'Compte Wave'), true) +
        field('Tonnage engagé (MT)', '<input id="rf_teng" data-c type="number" step="any" min="0">') +
        field('Tonnage livré historique (MT)', '<input id="rf_tliv" data-c type="number" step="any" min="0">') +
        field('Avances historiques (FCFA)', '<input id="rf_av" data-c type="number" min="0">') +
        '</div><p class="muted">Les avances réelles et leur réconciliation restent gérées dans Caisse & Avances.</p>', false) +

      section('5. Évaluation', '<div class="ops-form-grid">' +
        field('Réputation', '<select id="rf_rep" data-c>' + reput + '</select>') +
        field('Score (/100)', '<input id="rf_score" data-c type="number" min="0" max="100">') +
        field('Statut', '<select id="rf_statut" data-c><option>Pressenti</option><option>Confirmé</option><option>Actif</option><option>Écarté</option></select>') +
        field('Recommandation / observations', '<textarea id="rf_notes" data-c></textarea>', true) +
        '</div>', false) +

      '<div id="rf_dup"></div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="rf_submit">' + (editRow ? 'Enregistrer les modifications' : 'Créer le RT') + '</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="rf_msg" class="muted" style="margin-top:10px"></div></form>';

    var refresh = bindCompleteness('rtForm');
    var nom = document.getElementById('rf_nom'), tel = document.getElementById('rf_tel');
    var villageSel = document.getElementById('rf_village');
    if (prefill && prefill.nom) nom.value = prefill.nom;
    if (editRow) {
      var setV = function (id, v) { var e = document.getElementById(id); if (e && v != null && v !== '') e.value = v; };
      var setC = function (id, v) { var e = document.getElementById(id); if (e) e.checked = !!v; };
      nom.value = editRow.nom || '';
      tel.value = editRow.telephone || '';
      setV('rf_tel2', ED.telephoneSecondaire);
      villageSel.value = editRow.village_id || '';
      setV('rf_statut', editRow.statut);
      setV('rf_act', ED.activite); setV('rf_prod', ED.estProducteur);
      setV('rf_ins', ED.instruction); setV('rf_depl', ED.deplacement);
      setV('rf_exp', ED.experienceAnnees); setV('rf_nbprod', ED.nbProducteurs);
      setV('rf_vol', ED.volumePotentielMT); setV('rf_zone_inf', ED.zoneInfluence);
      setV('rf_dispo', ED.disponibilite);
      setC('rf_smart', ED.smartphone); setC('rf_bank', ED.compteBancaire); setC('rf_wave', ED.compteWave);
      if (ED.perf) { setV('rf_teng', ED.perf.tonnageEngage); setV('rf_tliv', ED.perf.tonnageLivre); setV('rf_av', ED.perf.avances); }
      setV('rf_rep', ED.reputation); setV('rf_score', editRow.score != null ? editRow.score : ED.score);
      setV('rf_notes', ED.notes);
      refresh();
    }
    nom.focus();
    function syncCluster() {
      var v = c.vm[villageSel.value] || {};
      document.getElementById('rf_cluster_ro').value = v.cluster
        ? v.cluster + ' — ' + zoneOfCluster(c, v.cluster) : '';
    }
    villageSel.addEventListener('change', syncCluster);
    syncCluster();
    function checkDup() {
      var k = normName(nom.value), t = normPhone(tel.value);
      var hit = c.rts.filter(function (r) {
        if (editRow && r.id === editRow.id) return false;
        return (t && t.length >= 8 && normPhone(r.telephone) === t) ||
               (k && normName(r.nom) === k && r.village_id === villageSel.value);
      })[0];
      document.getElementById('rf_dup').innerHTML = hit
        ? '<div class="notice danger"><b>Un RT très proche existe déjà :</b> ' + esc(hit.nom) +
          ' · ' + esc(hit.village_nom || '—') + ' · ' + esc(hit.telephone || '—') + '.</div>' : '';
    }
    nom.addEventListener('input', checkDup);
    tel.addEventListener('input', checkDup);
    villageSel.addEventListener('change', checkDup);

    document.getElementById('rtForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('rf_msg'), btn = document.getElementById('rf_submit');
      var name = val('rf_nom'), vid = villageSel.value, phone = normPhone(val('rf_tel'));
      if (!name || !vid || !phone) { msg.className = 'ops-danger-text'; msg.textContent = 'Nom, téléphone et village sont le minimum opérationnel.'; return; }
      if (phone.length !== 10) { msg.className = 'ops-danger-text'; msg.textContent = 'Le téléphone doit comporter 10 chiffres — c’est la clé de dédoublonnage.'; return; }
      var v = c.vm[vid] || {};
      var id = editRow ? editRow.id : uid();
      var data = {
        id: id, idRt: editRow ? editRow.id_rt : undefined,
        nom: name, telephone: phone, telephoneSecondaire: val('rf_tel2'),
        villageId: vid, villageNom: v.village || '', cluster: v.cluster || '',
        statut: val('rf_statut'), activite: val('rf_act'), estProducteur: val('rf_prod'),
        instruction: val('rf_ins'), deplacement: val('rf_depl'),
        experienceAnnees: numVal('rf_exp'), nbProducteurs: numVal('rf_nbprod'),
        volumePotentielMT: numVal('rf_vol'), zoneInfluence: val('rf_zone_inf'), disponibilite: val('rf_dispo'),
        smartphone: chk('rf_smart'), compteBancaire: chk('rf_bank'), compteWave: chk('rf_wave'),
        perf: { tonnageEngage: numVal('rf_teng'), tonnageLivre: numVal('rf_tliv'), avances: numVal('rf_av') },
        reputation: val('rf_rep'), score: numVal('rf_score'), notes: val('rf_notes'),
        completude: refresh(),
        createdAt: editRow ? (ED.createdAt || null) : new Date().toISOString(),
        createdBy: editRow ? (ED.createdBy || '') : (profile.nom || ''),
        historique: editRow ? ((ED.historique || []).concat([{ date: new Date().toISOString(), par: profile.nom || '', type: 'Modification', note: 'Fiche modifiée' }])) : []
      };
      btn.disabled = true; msg.className = 'muted';
      msg.textContent = editRow ? 'Enregistrement des modifications…' : 'Création en cours…';
      client().then(function (cl) {
        var row = {
          nom: name, telephone: phone, village_id: vid,
          village_nom: v.village || null, cluster: v.cluster || null,
          statut: val('rf_statut'), score: numVal('rf_score'), data: data
        };
        /* Édition : id et id_rt ne changent JAMAIS ; la même ligne est mise à jour. */
        if (editRow) return cl.from('rt').update(row).eq('id', editRow.id);
        row.id = id;
        return cl.from('rt').insert(row);
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        msg.className = 'ops-ok-text';
        msg.textContent = (editRow ? 'RT modifié : ' : 'RT créé : ') + name + ' (dossier ' + data.completude + ' %).' +
          (!editRow && data.estProducteur === 'OUI' ? ' Il pourra être enrôlé comme producteur depuis sa fiche.' : '');
        auditLog(editRow ? 'rt_modifie' : 'rt_cree', id + ' · ' + name);
        FBStore.invalidate('base');
        setTimeout(function () {
          closeForm();
          if (editRow) location.hash = '#rt/' + encodeURIComponent(editRow.id);
          render();
        }, 1100);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Création impossible.';
      });
    });
  });
}

/* ------------------------ PRODUCTEUR — porte d'entrée du Farmer Passport ------ */

function openFarmerForm(prefill, editId) {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), loadProfile(),
    editId ? q('producteurs', 'id,nom,prenoms,sexe,birth_year,telephone,telephone_alt,id_document_type,id_document_number,village_id,rt_id,statut,data', 1,
      function (r) { return r.eq('id', editId); }).catch(function () { return []; }) : Promise.resolve([])
  ]).then(function (rs) {
    var c = rs[0];
    if (!guardTerrain(host)) return;
    var editRow = editId ? (rs[2] || [])[0] : null;
    if (editId && !editRow) { host.innerHTML = danger('Producteur introuvable.'); return; }
    var ED = (editRow && editRow.data) || {};
    var villageOpts = selOptions(c.villages.map(function (v) { return [v.id, v.village + ' · ' + (v.cluster || '—')]; }), prefill && prefill.village_id || '');
    var anneeMax = new Date().getFullYear() - 16;

    host.innerHTML = '<div class="card-head"><div><h2>' + (editRow ? 'Modifier le producteur — ' + esc(editRow.nom) : 'Nouveau producteur — enrôlement Farmer Passport') + '</h2>' +
      '<p>Création rapide : identité + village suffisent. Les sections suivantes enrichissent le dossier ' +
      'maintenant ou plus tard, depuis le Farmer Passport.</p></div></div>' +
      '<form id="farmerForm">' + completenessBar('farmerForm') +

      section('1. Création rapide — identité', '<div class="ops-form-grid">' +
        field('Nom *', '<input id="ff_nom" data-c required maxlength="120">') +
        field('Prénoms', '<input id="ff_prenoms" data-c maxlength="120">') +
        field('Village *', '<select id="ff_village" data-c required><option value="">Choisir…</option>' + villageOpts + '</select>') +
        field('RT référent', '<select id="ff_rt" data-c><option value="">Aucun / à rattacher</option></select>') +
        field('Sexe', '<select id="ff_sexe" data-c><option value="">—</option><option value="M">M · Homme</option><option value="F">F · Femme</option></select>') +
        field('Année de naissance', '<input id="ff_annee" data-c type="number" min="1930" max="' + anneeMax + '" placeholder="1930 – ' + anneeMax + '">') +
        field('Téléphone', '<input id="ff_tel" data-c inputmode="tel" placeholder="10 chiffres">') +
        field('Titulaire du téléphone', '<select id="ff_teltit" data-c><option value="">—</option><option>Propre</option><option>Famille</option><option>Voisin</option><option>RT</option></select>') +
        field('Téléphone alternatif', '<input id="ff_tel2" data-c inputmode="tel">') +
        field('Campement / localité', '<input id="ff_camp" data-c>') +
        '</div>', true) +

      section('2. Pièce d’identité', '<div class="ops-form-grid">' +
        field('Type de pièce', '<select id="ff_piece" data-c><option value="">—</option><option>CNI</option><option>Attestation</option><option>Passeport</option><option>Aucune</option></select>') +
        field('Numéro de pièce', '<input id="ff_piece_num" data-c>') +
        '</div>', false) +

      section('3. Profil agricole', '<div class="ops-form-grid">' +
        field('Années dans l’anacarde', '<input id="ff_exp" data-c type="number" min="0" max="80">') +
        field('Superficie déclarée (ha)', '<input id="ff_ha" data-c type="number" step="any" min="0" max="100">') +
        field('Nombre d’arbres', '<input id="ff_arbres" data-c type="number" min="0">') +
        field('Âge de la plantation (années)', '<input id="ff_age_pl" data-c type="number" min="0" max="80">') +
        field('Production campagne précédente (kg)', '<input id="ff_prodprec" data-c type="number" min="0" max="1000000">') +
        field('Potentiel campagne 2027 (kg)', '<input id="ff_pot27" data-c type="number" min="0">') +
        field('Engagement ANAGROCI (kg)', '<input id="ff_eng" data-c type="number" min="0">') +
        field('Coopérative', '<input id="ff_coop" data-c>') +
        field('Autres cultures', '<input id="ff_cultures" data-c placeholder="Ex. Igname, coton">') +
        field('Acheteur habituel', '<input id="ff_ach_hab" data-c>') +
        field('Prix campagne précédente (FCFA/kg)', '<input id="ff_prix_prec" data-c type="number" min="0">') +
        '</div>', false) +

      section('4. Paiement', '<div class="ops-form-grid">' +
        field('Mode de paiement préféré', '<select id="ff_pay" data-c><option value="">—</option><option>Cash</option><option>Wave</option><option>Orange Money</option><option>MTN Money</option><option>Virement</option></select>') +
        field('Numéro mobile money', '<input id="ff_mm_num" data-c inputmode="tel">') +
        field('Titulaire du compte', '<input id="ff_mm_tit" data-c>') +
        '</div>', false) +

      section('5. Parcelle (facultative — règle 2027)', '<div class="notice ok"><b>Parcelle à compléter après campagne :</b> ' +
        'son absence n’empêche ni l’enrôlement, ni l’achat, ni le lot. Si vous avez les informations, ' +
        'elles alimentent directement le registre des parcelles (farmer_plots).</div>' +
        '<div class="ops-form-grid">' +
        field('Nom local de la parcelle', '<input id="ff_plot_nom" data-c>') +
        field('Superficie déclarée (ha)', '<input id="ff_plot_ha" data-c type="number" step="any" min="0">') +
        field('Latitude', '<input id="ff_plot_lat" data-c type="number" step="any">') +
        field('Longitude', '<input id="ff_plot_lng" data-c type="number" step="any">') +
        field('&nbsp;', geoButton('ff_plot_lat', 'ff_plot_lng')) +
        '</div>', false) +

      section('6. Observations', '<div class="ops-form-grid">' +
        field('Notes', '<textarea id="ff_notes" data-c></textarea>', true) +
        '</div>', false) +

      '<div id="ff_dup"></div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="ff_submit">' + (editRow ? 'Enregistrer les modifications' : 'Créer le producteur') + '</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="ff_msg" class="muted" style="margin-top:10px"></div></form>';

    var refresh = bindCompleteness('farmerForm');
    var nom = document.getElementById('ff_nom'), tel = document.getElementById('ff_tel');
    var villageSel = document.getElementById('ff_village'), rtSel = document.getElementById('ff_rt');
    if (prefill) {
      if (prefill.nom) nom.value = prefill.nom;
      if (prefill.telephone) tel.value = prefill.telephone;
      if (prefill.activite) document.getElementById('ff_notes').value = 'Enrôlement initié depuis la fiche RT' + (prefill.id_rt ? ' ' + prefill.id_rt : '') + '.';
    }
    function syncRt() {
      var vid = villageSel.value;
      rtSel.innerHTML = '<option value="">Aucun / à rattacher</option>' + selOptions(
        c.rts.filter(function (r) { return r.village_id === vid; }).map(function (r) { return [r.id, r.nom]; }),
        prefill && prefill.rt_id || '');
    }
    villageSel.addEventListener('change', syncRt);
    if (editRow) {
      var setV = function (id, v) { var e = document.getElementById(id); if (e && v != null && v !== '') e.value = v; };
      nom.value = editRow.nom || '';
      setV('ff_prenoms', editRow.prenoms);
      villageSel.value = editRow.village_id || '';
      /* La base stocke M/F (normalisation serveur) ; d'anciens dossiers portent Homme/Femme. */
      setV('ff_sexe', sexeCode(editRow.sexe));
      setV('ff_annee', editRow.birth_year);
      tel.value = editRow.telephone || '';
      setV('ff_tel2', editRow.telephone_alt);
      setV('ff_teltit', ED.telTitulaire);
      setV('ff_camp', ED.campement);
      setV('ff_piece', editRow.id_document_type);
      setV('ff_piece_num', editRow.id_document_number);
      setV('ff_exp', ED.anneesAnacarde); setV('ff_ha', ED.superficieHa);
      setV('ff_arbres', ED.nbArbres); setV('ff_age_pl', ED.agePlantation);
      setV('ff_prodprec', ED.prodPrecKg); setV('ff_pot27', ED.potentiel2027Kg);
      setV('ff_eng', ED.engagementKg); setV('ff_coop', ED.cooperative);
      setV('ff_cultures', ED.autresCultures); setV('ff_ach_hab', ED.acheteurHabituel);
      setV('ff_prix_prec', ED.prixPrecedent);
      setV('ff_pay', ED.paiementMode); setV('ff_mm_num', ED.mobileMoneyNum); setV('ff_mm_tit', ED.mobileMoneyTitulaire);
      setV('ff_notes', ED.notes);
    }
    syncRt();
    if (editRow && editRow.rt_id) rtSel.value = editRow.rt_id;
    refresh();
    nom.focus();

    function checkDupLocal() {
      var k = normName(nom.value), t = normPhone(tel.value);
      var hit = c.farmers.filter(function (f) {
        if (editRow && f.producteur_id === editRow.id) return false;
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
      var name = val('ff_nom'), vid = villageSel.value;
      if (!name || !vid) { msg.className = 'ops-danger-text'; msg.textContent = 'Nom et village sont le minimum opérationnel.'; return; }
      var phone = normPhone(val('ff_tel'));
      if (phone && phone.length !== 10) { msg.className = 'ops-danger-text'; msg.textContent = 'Le téléphone doit comporter 10 chiffres (ou rester vide).'; return; }
      var annee = numVal('ff_annee');
      if (annee != null && (annee < 1930 || annee > anneeMax)) {
        msg.className = 'ops-danger-text'; msg.textContent = 'Année de naissance entre 1930 et ' + anneeMax + '.'; return;
      }
      var v = c.vm[vid] || {};
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Contrôle des doublons…';
      client().then(function (cl) {
        return cl.rpc('farmer_possible_duplicates', {
          p_nom: name, p_telephone: phone || null, p_village_id: vid,
          p_exclude_id: editRow ? editRow.id : null
        }).then(function (dup) {
          var hits = (dup.data || []);
          if (!dup.error && hits.length) {
            btn.disabled = false; msg.className = 'ops-danger-text';
            msg.textContent = 'Doublon possible détecté côté référentiel (' + hits.length + '). Vérifiez la liste des producteurs avant de recréer.';
            return null;
          }
          msg.textContent = editRow ? 'Enregistrement des modifications…' : 'Création en cours…';
          var id = editRow ? editRow.id : uid();
          var pct = refresh();
          var data = {
            id: id,
            source: editRow ? (ED.source || null) : (prefill && prefill.sourceRtId ? 'RT_TO_PRODUCER' : 'OPERATIONS_FIELD_BUYING'),
            sourceRtId: editRow ? (ED.sourceRtId || null) : (prefill && prefill.sourceRtId || null),
            campement: val('ff_camp'), cooperative: val('ff_coop'),
            anneesAnacarde: numVal('ff_exp'), superficieHa: numVal('ff_ha'),
            nbArbres: numVal('ff_arbres'), agePlantation: numVal('ff_age_pl'),
            prodPrecKg: numVal('ff_prodprec'), potentiel2027Kg: numVal('ff_pot27'),
            engagementKg: numVal('ff_eng'), autresCultures: val('ff_cultures'),
            acheteurHabituel: val('ff_ach_hab'), prixPrecedent: numVal('ff_prix_prec'),
            paiementMode: val('ff_pay'), mobileMoneyNum: val('ff_mm_num'), mobileMoneyTitulaire: val('ff_mm_tit'),
            telTitulaire: val('ff_teltit'), notes: val('ff_notes'), completude: pct
          };
          var row = {
            nom: name, prenoms: val('ff_prenoms') || null,
            sexe: val('ff_sexe') || null, birth_year: annee,
            telephone: phone || null, telephone_alt: normPhone(val('ff_tel2')) || null,
            id_document_type: val('ff_piece') || null, id_document_number: val('ff_piece_num') || null,
            village_id: vid, village_nom: v.village || null,
            rt_id: rtSel.value || null, data: data
          };
          /* Édition : id et Farmer ID ne changent JAMAIS ; la même personne est mise à jour. */
          var write = editRow
            ? cl.from('producteurs').update(row).eq('id', editRow.id)
            : (row.id = id, row.statut = 'Identifié', cl.from('producteurs').insert(row));
          return write.then(function (r) {
            if (r.error) throw new Error(r.error.message);
            /* Parcelle facultative : registre canonique farmer_plots, jamais data. */
            var plotNom = val('ff_plot_nom'), plotHa = numVal('ff_plot_ha');
            var plotLat = numVal('ff_plot_lat'), plotLng = numVal('ff_plot_lng');
            if (!plotNom && plotHa == null && plotLat == null) return { id: id, pct: pct, plot: false };
            return cl.from('farmer_plots').insert({
              id: uid(), producteur_id: id, village_id: vid,
              local_name: plotNom || 'PARCELLE PRINCIPALE',
              declared_area: plotHa, area_unit: 'HA',
              latitude: plotLat, longitude: plotLng,
              gps_status: (plotLat != null && plotLng != null) ? 'POINT_CAPTURED' : 'DEFERRED',
              gps_captured_at: (plotLat != null && plotLng != null) ? new Date().toISOString() : null,
              area_source: 'DECLARED', evidence_level: 'DECLARED', status: 'ACTIVE'
            }).then(function (pr) {
              if (pr.error) return { id: id, pct: pct, plot: false, plotError: pr.error.message };
              return { id: id, pct: pct, plot: true };
            });
          }).then(function (res) {
            btn.disabled = false;
            if (!res) return;
            msg.className = 'ops-ok-text';
            auditLog(editRow ? 'producteur_modifie' : 'producteur_cree', res.id + ' · ' + name);
            msg.textContent = (editRow ? 'Producteur modifié : ' : 'Producteur créé : ') + name + ' — Opérationnel ✓ · Passport ' + res.pct + ' %' +
              (res.plot ? ' · parcelle enregistrée.' : ' · parcelle à compléter après campagne.') +
              (res.plotError ? ' (parcelle non enregistrée : ' + res.plotError + ')' : '');
            FBStore.invalidate('base');
            var newId = res.id;
            setTimeout(function () { closeForm(); location.hash = '#farmers/' + encodeURIComponent(newId); render(); }, 1200);
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

function renderFarmers(id, tab) {
  if (id) return renderFarmerPassport(id, tab);
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
        ['Farmer ID', 'Nom', 'Téléphone', 'Village', 'RT', 'Cluster', 'Statut', 'Niveau', 'Parcelle', 'Dernier achat'],
        list.slice(0, 200).map(function (f) {
          var rr = c.rm[f.rt_id], vv = c.vm[f.village_id];
          return '<tr class="ops-click" onclick="location.hash=\'#farmers/' + encodeURIComponent(f.producteur_id) + '\'">' +
            '<td><a class="ops-link mono" href="#farmers/' + encodeURIComponent(f.producteur_id) + '">' + esc(f.farmer_id || '—') + '</a></td>' +
            '<td><a class="ops-link" href="#farmers/' + encodeURIComponent(f.producteur_id) + '"><b>' + esc(f.nom) + '</b>' + (f.prenoms ? ' ' + esc(f.prenoms) : '') + '</a></td>' +
            '<td>' + esc(f.telephone || '—') + '</td><td>' + (vv ? villageLink(vv) : esc(f.village_nom || '—')) + '</td>' +
            '<td>' + (rr ? rtLink(rr) : esc(f.rt_nom || '—')) + '</td><td>' + esc(f.cluster_label || f.cluster_code || '—') + '</td>' +
            '<td>' + badge(f.operational_status || 'Enrôlé') + '</td>' +
            '<td>' + badge('Opérationnel ✓') + ' <span class="muted">Passport ' + n(f.passport_completion) + ' %</span></td>' +
            '<td>' + (n(f.gps_mapped_count) > 0 ? badge('GPS levé') : '<span class="muted">à compléter après campagne</span>') + '</td>' +
            '<td>' + date(f.last_purchase_date) + '</td></tr>';
        }));
    }
    document.getElementById('pfQ').addEventListener('input', function () { farmerFilter.q = this.value; apply(); });
    document.getElementById('pfVillage').addEventListener('change', function () { farmerFilter.village = this.value; apply(); });
    apply();
  });
}

/* Farmer Passport — fiche 360° du producteur, 12 sections dans le shell.
   Chaque rubrique lit sa table canonique ; le dossier lourd (parcelles,
   sustainability, visites, inspections, consentements, actions, historique)
   ne se charge que lorsqu'on ouvre le passeport, en un seul Promise.all. */

function passportData(pid) {
  return FBStore.get('passport:' + pid, function () {
    function tq(tableName, cols, col) {
      return q(tableName, cols, 200, function (r) { return r.eq(col || 'producteur_id', pid); })
        .catch(function () { return []; });
    }
    return Promise.all([
      tq('farmer_plots', 'id,local_name,declared_area,area_unit,land_tenure_status,orchard_age_years,tree_count,productive_tree_count,latitude,longitude,gps_status,gps_verified_area,area_source,evidence_level,status,deleted'),
      tq('farmer_production_baselines', 'id,campaign,productive_area_ha,previous_production_kg,forecast_kg,productive_tree_count,previous_sales_channel,already_anagroci_supplier,status,created_at'),
      tq('farmer_sustainability_baselines', 'id,campaign,inspection_date,catalog_version,status,risk_profile,created_at'),
      tq('farmer_consents', 'id,status,scopes,consent_at,agent_name,text_version,method'),
      tq('farmer_visits', 'id,visit_type,visit_date,agent_name,purpose,outcome,next_action'),
      tq('farmer_inspections', 'id,inspection_type,inspection_date,status,notes'),
      tq('farmer_action_plans_effective_v', '*'),
      q('farmer_change_log', 'id,table_name,record_id,operation,actor_email,actor_role,reason,created_at', 100,
        function (r) { return r.eq('record_id', pid).order('created_at', { ascending: false }); })
        .catch(function () { return []; })
    ]).then(function (rs) {
      return { plots: rs[0].filter(function (x) { return !x.deleted; }), baselines: rs[1],
               sustainability: rs[2], consents: rs[3], visits: rs[4],
               inspections: rs[5], actions: rs[6], changes: rs[7] };
    });
  });
}

var PASSPORT_TABS = [
  ['overview', 'Overview'], ['identity', 'Identité'], ['farm', 'Exploitation'],
  ['plots', 'Parcelles'], ['production', 'Production'], ['sustainability', 'Sustainability'],
  ['consents', 'Consentements'], ['visits', 'Visites'], ['inspections', 'Inspections'],
  ['purchases', 'Achats'], ['actions', 'Actions'], ['history', 'Historique']
];

function renderFarmerPassport(id, tab) {
  tab = PASSPORT_TABS.some(function (t) { return t[0] === tab; }) ? tab : 'overview';
  paint(head('Farmer Passport', 'Chargement du producteur…',
    '<a class="btn secondary" href="#farmers">← Producteurs</a>') + skeletonPage(8));

  return base().then(function (c) {
    var f = c.farmers.filter(function (x) { return x.producteur_id === id || x.farmer_id === id; })[0];
    if (!f) {
      paint(head('Farmer Passport', 'Producteur introuvable.',
        '<a class="btn secondary" href="#farmers">← Producteurs</a>') + empty('Aucun producteur ne porte cet identifiant.'));
      return;
    }
    var pid = f.producteur_id;
    return Promise.all([passportData(pid),
      q('producteurs', 'id,data,sexe,birth_year,telephone_alt,id_document_type,id_document_number,consent_status,consent_date', 1,
        function (r) { return r.eq('id', pid); }).catch(function () { return []; })
    ]).then(function (rs) {
      var p = rs[0];
      var row = (rs[1] || [])[0] || {};
      var extra = row.data || {};
      var mine = c.achats.filter(function (a) { return a.producteur_id === pid || a.producteur_code === f.farmer_id; });
      var kg = mine.reduce(function (t, a) { return t + n(a.poids_net); }, 0);
      var valAch = mine.reduce(function (t, a) { return t + n(a.montant); }, 0);

      function tabs() {
        return '<div class="ops-passport-tabs">' + PASSPORT_TABS.map(function (t) {
          return '<a class="' + (tab === t[0] ? 'active' : '') + '" href="#farmers/' +
            encodeURIComponent(pid) + '/' + t[0] + '">' + esc(t[1]) + '</a>';
        }).join('') + '</div>';
      }
      function defGrid(pairs) {
        return '<div class="ops-def-grid">' + pairs.map(function (d) {
          return '<div><small>' + esc(d[0]) + '</small><b>' + esc(d[1] == null || d[1] === '' ? '—' : d[1]) + '</b></div>';
        }).join('') + '</div>';
      }
      var parcelleEtat = p.plots.length
        ? p.plots.length + ' parcelle(s)' + (p.plots.some(function (x) { return x.latitude != null; }) ? ' · GPS' : '')
        : 'À compléter après campagne';

      var body = '';
      if (tab === 'overview') {
        body = kpis([
          ['Statut', 'Opérationnel ✓', esc(f.operational_status || 'Identifié')],
          ['Farmer Passport', n(f.passport_completion) + ' %', esc(f.passport_stage || 'BASIC')],
          ['Parcelle', parcelleEtat, 'jamais bloquante en 2027', p.plots.length ? '' : 'warn'],
          ['Achats campagne', mt(kg), mine.length + ' achat(s) · ' + money(valAch)],
          ['Risque', esc(f.risk_profile || 'NON ÉVALUÉ'), f.review_required ? 'revue requise' : '', f.review_required ? 'warn' : ''],
          ['Actions ouvertes', String(p.actions.filter(function (a) { return /OPEN|IN_PROGRESS|OVERDUE/i.test(String(a.status || '')); }).length), 'plans correctifs']
        ]) +
        '<section class="card"><div class="card-head"><div><h2>Résumé</h2></div></div>' +
        defGrid([['Farmer ID', f.farmer_id], ['Nom', (f.nom + ' ' + (f.prenoms || '')).trim()],
          ['Village', f.village_nom], ['Cluster', f.cluster_label || f.cluster_code],
          ['Zone', f.zone_label || f.zone_code], ['RT', f.rt_nom],
          ['Baselines production', String(p.baselines.length)], ['Baselines durabilité', String(p.sustainability.length)],
          ['Visites', String(p.visits.length)], ['Inspections', String(p.inspections.length)],
          ['Consentements', String(p.consents.length)], ['Dernier achat', date(f.last_purchase_date)]]) + '</section>';
      } else if (tab === 'identity') {
        body = '<section class="card"><div class="card-head"><div><h2>Identité</h2></div></div>' +
          defGrid([['Farmer ID', f.farmer_id], ['Nom', f.nom], ['Prénoms', f.prenoms],
            ['Sexe', sexeLabel(row.sexe)], ['Année de naissance', row.birth_year],
            ['Téléphone', f.telephone], ['Téléphone alternatif', row.telephone_alt],
            ['Titulaire téléphone', extra.telTitulaire],
            ['Pièce', row.id_document_type], ['N° de pièce', row.id_document_number ? '••• (protégé)' : '—'],
            ['Campement', extra.campement], ['Village', f.village_nom],
            ['RT', f.rt_nom], ['Cluster', f.cluster_label || f.cluster_code],
            ['Consentement', row.consent_status], ['Date consentement', date(row.consent_date)]]) + '</section>';
      } else if (tab === 'farm') {
        body = '<section class="card"><div class="card-head"><div><h2>Exploitation</h2>' +
          '<p>Profil agricole déclaré à l’enrôlement — les mesures GPS vivent dans Parcelles.</p></div></div>' +
          defGrid([['Années dans l’anacarde', extra.anneesAnacarde],
            ['Superficie déclarée', extra.superficieHa != null ? num(extra.superficieHa, 2) + ' ha' : null],
            ['Nombre d’arbres', extra.nbArbres], ['Âge plantation', extra.agePlantation != null ? extra.agePlantation + ' ans' : null],
            ['Production précédente', extra.prodPrecKg != null ? num(extra.prodPrecKg) + ' kg' : null],
            ['Potentiel 2027', extra.potentiel2027Kg != null ? num(extra.potentiel2027Kg) + ' kg' : null],
            ['Engagement ANAGROCI', extra.engagementKg != null ? num(extra.engagementKg) + ' kg' : null],
            ['Coopérative', extra.cooperative], ['Autres cultures', extra.autresCultures],
            ['Acheteur habituel', extra.acheteurHabituel],
            ['Prix précédent', extra.prixPrecedent != null ? num(extra.prixPrecedent) + ' F/kg' : null],
            ['Paiement préféré', extra.paiementMode]]) + '</section>';
      } else if (tab === 'plots') {
        body = '<div class="notice ok"><b>Règle 2027 :</b> la parcelle et son GPS sont facultatifs — « à compléter après campagne ».</div>' +
          '<section class="card">' + table(['Parcelle', 'Superficie', 'Arbres', 'GPS', 'Statut GPS', 'Source', 'Niveau de preuve'],
          p.plots.map(function (x) {
            return '<tr><td><b>' + esc(x.local_name || '—') + '</b></td>' +
              '<td>' + (x.declared_area != null ? num(x.declared_area, 2) + ' ' + (x.area_unit || 'ha') : '—') + '</td>' +
              '<td>' + (x.tree_count != null ? num(x.tree_count) : '—') + '</td>' +
              '<td>' + (x.latitude != null ? num(x.latitude, 5) + ', ' + num(x.longitude, 5) : '—') + '</td>' +
              '<td>' + badge(x.gps_status || 'DEFERRED') + '</td>' +
              '<td>' + esc(x.area_source || '—') + '</td><td>' + esc(x.evidence_level || '—') + '</td></tr>';
          })) + '</section>';
      } else if (tab === 'production') {
        body = '<section class="card">' + table(['Campagne', 'Surface productive', 'Production précédente', 'Prévision', 'Arbres productifs', 'Canal précédent', 'Déjà fournisseur', 'Statut'],
          p.baselines.map(function (x) {
            return '<tr><td><b>' + esc(x.campaign) + '</b></td>' +
              '<td>' + (x.productive_area_ha != null ? num(x.productive_area_ha, 2) + ' ha' : '—') + '</td>' +
              '<td>' + (x.previous_production_kg != null ? num(x.previous_production_kg) + ' kg' : '—') + '</td>' +
              '<td>' + (x.forecast_kg != null ? num(x.forecast_kg) + ' kg' : '—') + '</td>' +
              '<td>' + (x.productive_tree_count != null ? num(x.productive_tree_count) : '—') + '</td>' +
              '<td>' + esc(x.previous_sales_channel || '—') + '</td>' +
              '<td>' + (x.already_anagroci_supplier ? 'Oui' : 'Non') + '</td>' +
              '<td>' + badge(x.status) + '</td></tr>';
          })) + '</section>';
      } else if (tab === 'sustainability') {
        body = '<div class="notice info">La durabilité documente les pratiques : elle ne vaut pas certification automatique.</div>' +
          '<section class="card">' + table(['Campagne', 'Date', 'Catalogue', 'Risque', 'Statut'],
          p.sustainability.map(function (x) {
            return '<tr><td><b>' + esc(x.campaign || '—') + '</b></td><td>' + date(x.inspection_date) + '</td>' +
              '<td class="mono">' + esc(x.catalog_version || '—') + '</td>' +
              '<td>' + badge(x.risk_profile || 'NON ÉVALUÉ') + '</td><td>' + badge(x.status) + '</td></tr>';
          })) + '</section>';
      } else if (tab === 'consents') {
        body = '<section class="card">' + table(['Date', 'Statut', 'Périmètres', 'Méthode', 'Agent', 'Version du texte'],
          p.consents.map(function (x) {
            return '<tr><td>' + date(x.consent_at) + '</td><td>' + badge(x.status) + '</td>' +
              '<td>' + esc(Array.isArray(x.scopes) ? x.scopes.join(', ') : (x.scopes || '—')) + '</td>' +
              '<td>' + esc(x.method || '—') + '</td><td>' + esc(x.agent_name || '—') + '</td>' +
              '<td class="mono">' + esc(x.text_version || '—') + '</td></tr>';
          })) + '</section>';
      } else if (tab === 'visits') {
        body = '<section class="card">' + table(['Date', 'Type', 'Agent', 'Objet', 'Résultat', 'Prochaine action'],
          p.visits.map(function (x) {
            return '<tr><td>' + date(x.visit_date) + '</td><td>' + badge(x.visit_type) + '</td>' +
              '<td>' + esc(x.agent_name || '—') + '</td><td>' + esc(x.purpose || '—') + '</td>' +
              '<td>' + esc(x.outcome || '—') + '</td><td>' + esc(x.next_action || '—') + '</td></tr>';
          })) + '</section>';
      } else if (tab === 'inspections') {
        body = '<section class="card">' + table(['Date', 'Type', 'Statut', 'Notes'],
          p.inspections.map(function (x) {
            return '<tr><td>' + date(x.inspection_date) + '</td><td>' + badge(x.inspection_type) + '</td>' +
              '<td>' + badge(x.status) + '</td><td>' + esc(x.notes || '—') + '</td></tr>';
          })) + '</section>';
      } else if (tab === 'purchases') {
        body = '<section class="card"><div class="card-head"><div><h2>Achats Bord Champ</h2></div>' +
          '<div class="ops-route-actions"><a class="btn primary" href="#purchases/new/' + encodeURIComponent(pid) + '">+ Nouvel achat</a></div></div>' +
          table(['Date', 'Poids net', 'Sacs', 'Prix', 'Montant', 'Paiement', 'Reçu', 'Validation', 'Stock'],
          mine.map(function (a) {
            return '<tr><td>' + date(a.date) + '</td><td>' + num(a.poids_net) + ' kg</td>' +
              '<td>' + n(a.nb_sacs) + '</td><td>' + num(a.prix_kg) + ' /kg</td>' +
              '<td>' + money(a.montant) + '</td><td>' + esc(a.mode_paiement || '—') + '</td>' +
              '<td class="mono">' + esc(a.numero_recu || '—') + '</td>' +
              '<td>' + badge(a.statut_validation) + '</td><td>' + badge(a.stock_statut) + '</td></tr>';
          })) + '</section>' +
          '<section class="card"><div class="card-head"><div><h2>Traceability</h2></div></div>' +
          '<p class="muted">Chaîne Farmer → Achat → Sacs → Lot → Warehouse → Factory.</p>' +
          '<div class="ops-actions"><a class="btn secondary" href="#traceability/' + encodeURIComponent(f.farmer_id || f.nom) + '">Tracer ce producteur</a></div></section>';
      } else if (tab === 'actions') {
        body = '<section class="card">' + table(['Catégorie', 'Problème', 'Action corrective', 'Responsable', 'Échéance', 'Priorité', 'Statut'],
          p.actions.map(function (x) {
            return '<tr><td>' + badge(x.category || '—') + '</td><td>' + esc(x.issue || '—') + '</td>' +
              '<td>' + esc(x.corrective_action || '—') + '</td><td>' + esc(x.responsible_name || '—') + '</td>' +
              '<td>' + date(x.due_date) + '</td><td>' + badge(x.priority || '—') + '</td>' +
              '<td>' + badge(x.status) + '</td></tr>';
          })) + '</section>';
      } else if (tab === 'history') {
        body = '<section class="card"><div class="card-head"><div><h2>Historique</h2>' +
          '<p>Journal immuable du Farmer Registry pour ce dossier.</p></div></div>' +
          table(['Date', 'Opération', 'Table', 'Acteur', 'Motif'],
          p.changes.slice(0, 60).map(function (x) {
            return '<tr><td>' + date(x.created_at) + '</td><td>' + badge(x.operation || '—') + '</td>' +
              '<td class="mono">' + esc(x.table_name || '—') + '</td>' +
              '<td>' + esc(x.actor_email || x.actor_role || '—') + '</td>' +
              '<td>' + esc(x.reason || '—') + '</td></tr>';
          })) + '</section>';
      }

      paint(head((f.farmer_id || '—') + ' · ' + f.nom + (f.prenoms ? ' ' + f.prenoms : ''),
        'Farmer Passport · fiche 360° — Opérationnel ✓ · Passport ' + n(f.passport_completion) + ' % · Parcelle : ' + parcelleEtat + '.',
        '<a class="btn primary" href="#purchases/new/' + encodeURIComponent(pid) + '">+ Nouvel achat</a>' +
        (canEditTerrain() ? '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.openFarmerForm(null,\'' + esc(pid) + '\')">Modifier</button>' : '') +
        '<a class="btn secondary" href="#farmers">← Producteurs</a>') +
        tabs() + '<div id="fbFormHost" class="ops-form-card" hidden></div>' + body);
    });
  });
}

/* ------------------------------------------------------------------ RT & Villages */

var rtTab = 'villages';
var rtFilter = { cluster: '', statut: '', q: '' };

var RT_LIST_TABS = ['villages', 'rts', 'assign', 'anomalies'];
function renderRt(sub, fichTab) {
  /* #rt/villages … = vues de gestion ; #rt/<id> = fiche RT 360°. */
  if (sub && RT_LIST_TABS.indexOf(sub) < 0) return renderRtFiche(sub, fichTab);
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
            return '<tr><td>' + villageLink(v) + '</td><td>' + esc(v.cluster || '—') + '</td>' +
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
            var isProd = /producteur/i.test(String(act)) || (r.data && r.data.estProducteur === 'OUI');
            var vv = c.vm[r.village_id];
            return '<tr><td class="mono">' + esc(r.id_rt || '—') + '</td><td>' + rtLink(r) + '</td>' +
              '<td>' + esc(r.telephone || '—') + '</td><td>' + (vv ? villageLink(vv) : esc(r.village_nom || '—')) + '</td>' +
              '<td>' + esc(r.cluster || '—') + '</td><td>' + esc(act) + '</td><td>' + badge(r.statut) + '</td>' +
              '<td>' + (d.farmersByRt[r.id] || 0) + '</td><td>' + mt(d.byRtBuy[r.id] || 0) + '</td>' +
              '<td>' + date(d.lastRtBuy[r.id]) + '</td>' +
              '<td>' + (isProd ? '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.rtToFarmer(\'' + esc(r.id) + '\')">Enrôler comme producteur</button>' : '') + '</td></tr>';
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
    /* Même règle que shared/rt-to-producer.js : si la personne existe déjà
       (même RT source, ou même village + même téléphone + même nom), on OUVRE
       sa fiche au lieu de recréer une deuxième personne. */
    var t = normPhone(r.telephone), k = normName(r.nom);
    var existing = c.farmers.filter(function (f) {
      var fd = null;
      return (f.village_id === r.village_id && t && t.length >= 8 && normPhone(f.telephone) === t && normName(f.nom + ' ' + (f.prenoms || '')) === k);
    })[0];
    if (existing) {
      location.hash = '#farmers/' + encodeURIComponent(existing.producteur_id);
      return;
    }
    location.hash = '#farmers';
    setTimeout(function () {
      openFarmerForm({ nom: r.nom, telephone: r.telephone, village_id: r.village_id, rt_id: r.id,
        sourceRtId: r.id, id_rt: r.id_rt, activite: (r.data && r.data.activite) || '' });
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
          var ff = c.farmers.filter(function (x) { return x.producteur_id === a.producteur_id; })[0];
          var rr = c.rm[a.rt_id], vv = c.vm[a.village_id];
          return '<tr><td>' + date(a.date) + '</td><td class="mono">' + esc(a.producteur_code || '—') + '</td>' +
            '<td>' + (ff ? '<a class="ops-link" href="#farmers/' + encodeURIComponent(ff.producteur_id) + '"><b>' + esc(a.producteur_nom || '—') + '</b></a>' : '<b>' + esc(a.producteur_nom || '—') + '</b>') + '</td>' +
            '<td>' + (rr ? rtLink(rr) : esc(a.rt_nom || '—')) + '</td>' +
            '<td>' + (vv ? villageLink(vv) : esc(a.village_nom || '—')) + '</td><td>' + esc(a.cluster || '—') + '</td>' +
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

/* ------------------------------------------------------- Sacherie AFLP (P0) */
/* Un seul registre canonique (rcn_jute_movements) via le circuit central :
   demande ops_bag_requests → revue → consolidation → approbation BM →
   sorties multi-release ops_release_bags → confirmation de réception.
   Les contrôles patrimoniaux (pertes, inventaires, états) passent par les
   RPC sacherie_ct_* existants. La base reste l'arbitre de chaque action. */

var BAG_CAMPAGNE = '2027';
var BUCKET_SACHERIE = 'rcn-jute-proofs';
var BAG_ROLES = {
  demander: ['Unit Head', 'Assistant Unit Head', 'Branch Manager', 'General Manager',
    'Procurement Officer', 'Field Buying Operations Officer', 'Zonal Head', 'Administrateur'],
  revoir: ['Zonal Head', 'Branch Manager', 'Administrateur'],
  consolider: ['Field Buying Operations Officer', 'Branch Manager', 'Administrateur'],
  approuver: ['Branch Manager', 'Administrateur'],
  liberer: ['Warehouse Manager', 'Storekeeper', 'Procurement Officer', 'Branch Manager',
    'Warehouse Keeper', 'Assistant Unit Head', 'Administrateur'],
  recevoir: ['Unit Head', 'Field Buying Operations Officer', 'Branch Manager', 'Administrateur'],
  cloturer: ['General Manager', 'Branch Manager', 'Procurement Officer',
    'Field Buying Operations Officer', 'Zonal Head', 'Administrateur'],
  bm: ['Branch Manager', 'Administrateur'],
  gm: ['General Manager', 'Branch Manager', 'Administrateur']
};
/* Miroir client des rôles ; le serveur (RLS + triggers + RPC) reste l'arbitre. */
function bagRole(list) { return list.indexOf(profile.role) >= 0; }

function bagLoc(b, scope, key) {
  var k = normName(key || '');
  return (b.locations || []).filter(function (l) {
    if (!l.actif || l.scope_type !== scope) return false;
    if (scope === 'RT') return String(l.rt_id) === String(key);
    return normName(l.cluster || '') === k;
  })[0] || null;
}
function bagReqById(b, id) {
  return (b.requests || []).filter(function (r) { return String(r.id) === String(id); })[0] || null;
}
function bagEnv(b) {
  var open = b.envelopes.filter(function (e) {
    return String(e.campaign) === BAG_CAMPAGNE && /APPROV|ACTIVE|OPEN/i.test(String(e.status || ''));
  });
  return open[0] || b.envelopes.filter(function (e) { return String(e.campaign) === BAG_CAMPAGNE; })[0] || null;
}
function bagProofUpload(file, msg) {
  /* Preuve dans le bucket privé jute existant, chemin (uid)/… ; URL signée à la lecture. */
  if (!file) return Promise.resolve(null);
  if (msg) msg.textContent = 'Compression et envoi de la preuve…';
  return Promise.all([client(), compressImage(file, 1600, 0.85)]).then(function (rs) {
    var cl = rs[0], blob = rs[1];
    return cl.auth.getSession().then(function (s) {
      var uidv = s.data && s.data.session && s.data.session.user && s.data.session.user.id;
      if (!uidv) throw new Error('Session requise pour joindre une preuve.');
      var path = uidv + '/sacherie-' + Date.now() + '.jpg';
      return cl.storage.from(BUCKET_SACHERIE).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
        .then(function (u) { if (u.error) throw new Error(u.error.message); return path; });
    });
  });
}
function bagStatusFr(s) {
  var m = { REQUESTED: 'Demandée', REVIEWED: 'Revue', CONSOLIDATED: 'Consolidée',
    BM_APPROVED: 'Approuvée BM', GM_APPROVED: 'Approuvée GM', PARTIALLY_RELEASED: 'Sortie partielle',
    FULLY_RELEASED: 'Sortie totale', REJECTED: 'Rejetée', CANCELLED: 'Annulée', EXPIRED: 'Expirée' };
  return m[s] || s || '—';
}

function renderBags(sub) {
  var actions = '<button class="btn primary ops-cta-create" id="newBagReqBtn" type="button" onclick="ANAGROCI_FB.openBagRequest()">+ Nouvelle demande RT</button>' +
    '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.openBagControl(\'inventaire\')">Inventaire</button>' +
    '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.openBagControl(\'etat\')">Sacs abîmés</button>' +
    '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.openBagControl(\'perte\')">Déclarer une perte</button>';
  paint(head('Sacherie AFLP', 'Enveloppe GM → allocations clusters → demandes RT → approbation → sorties → balances.',
    actions) + createHost() + skeletonPage(6));

  return Promise.all([base(), bagsData(), loadProfile()]).then(function (rs) {
    var c = rs[0], b = rs[1];
    var env = bagEnv(b) || {};
    var allocated = b.allocations.reduce(function (t, a) { return t + n(a.allocated_qty); }, 0);
    var pending = b.requests.filter(function (r) { return /REQUESTED|REVIEWED|CONSOLIDATED/i.test(String(r.status || '')); });
    var approved = b.requests.filter(function (r) { return /APPROVED|PARTIALLY_RELEASED/i.test(String(r.status || '')); });
    var expiring = approved.filter(function (r) {
      return r.expires_at && new Date(r.expires_at) - Date.now() < 3 * 86400000;
    });
    var ecartsReception = b.requests.filter(function (r) {
      return n(r.released_qty) > 0 && n(r.received_qty) < n(r.released_qty) &&
        /RELEASED/i.test(String(r.status || ''));
    });
    var pertesADecider = (b.pertes || []).filter(function (p) { return p.statut === 'SOUMIS'; });
    var invHold = (b.inventaires || []).filter(function (i) { return i.reconciliation_status === 'HOLD'; });
    var withRt = b.rtStock.reduce(function (t, s) { return t + n(s.total_sous_responsabilite); }, 0);
    var aging = b.rtStock.filter(function (s) { return s.derniere_activite && daysSince(s.derniere_activite) > 30 && n(s.total_sous_responsabilite) > 0; });
    var g = b.global || {};

    /* Initialisation campagne : READY / PARTIAL / MISSING, constaté — jamais supposé. */
    var clustersRef = c.clusters.map(function (x) { return x.label; });
    var allocOk = clustersRef.filter(function (l) {
      return b.allocations.some(function (a) { return normName(a.cluster) === normName(l); });
    });
    var locOk = clustersRef.filter(function (l) { return !!bagLoc(b, 'CLUSTER', l); });
    var rtLocCount = (b.locations || []).filter(function (l) { return l.scope_type === 'RT' && l.actif; }).length;
    function etat3(okN, totalN) { return okN >= totalN ? ['READY', 'ok'] : okN > 0 ? ['PARTIAL', 'warn'] : ['MISSING', 'danger']; }
    var e1 = env.approved_qty > 0 ? ['READY', 'ok'] : ['MISSING', 'danger'];
    var e2 = etat3(allocOk.length, clustersRef.length);
    var e3 = etat3(locOk.length, clustersRef.length);
    var e4 = etat3(rtLocCount, Math.min(c.rts.length, 1) === 0 ? 0 : c.rts.length);
    var initReady = e1[0] === 'READY' && e2[0] === 'READY' && e3[0] === 'READY';

    var initCard = '<section class="card"><div class="card-head"><div><h2>Initialisation campagne ' + BAG_CAMPAGNE + '</h2>' +
      '<p>Sans enveloppe, allocations et locations, aucune sortie physique n’est possible.</p></div>' +
      (bagRole(BAG_ROLES.gm) ? '<div class="ops-route-actions">' +
        (e1[0] !== 'READY' ? '<button class="btn primary" type="button" onclick="ANAGROCI_FB.openBagEnvelope()">Créer l’enveloppe</button>' : '') +
        '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.openBagAllocation()">Allouer un cluster</button></div>' : '') + '</div>' +
      table(['Composant', 'État', 'Détail'], [
        '<tr><td>Enveloppe campagne</td><td><span class="badge ' + e1[1] + '">' + e1[0] + '</span></td><td>' + (env.approved_qty != null ? num(env.approved_qty) + ' sacs · ' + esc(env.status || '') : 'aucune enveloppe ' + BAG_CAMPAGNE) + '</td></tr>',
        '<tr><td>Allocations clusters</td><td><span class="badge ' + e2[1] + '">' + e2[0] + '</span></td><td>' + allocOk.length + ' / ' + clustersRef.length + ' clusters alloués · ' + num(allocated) + ' sacs</td></tr>',
        '<tr><td>Locations clusters</td><td><span class="badge ' + e3[1] + '">' + e3[0] + '</span></td><td>' + locOk.length + ' / ' + clustersRef.length + ' codes AFLP-CL présents</td></tr>',
        '<tr><td>Locations RT</td><td><span class="badge ' + e4[1] + '">' + e4[0] + '</span></td><td>' + rtLocCount + ' / ' + c.rts.length + ' RT — créées automatiquement à la première demande</td></tr>'
      ]) + '</section>';

    function actionsFor(r) {
      var s = String(r.status || ''), btns = [];
      var expired = r.expires_at && new Date(r.expires_at) < new Date();
      function btn2(label, fn, primary) {
        btns.push('<button class="btn ' + (primary ? 'primary' : 'secondary') + '" type="button" onclick="ANAGROCI_FB.' + fn + '(\'' + esc(r.id) + '\')">' + label + '</button>');
      }
      if (s === 'REQUESTED' && bagRole(BAG_ROLES.revoir)) btn2('Marquer revue', 'bagReview');
      if (s === 'REVIEWED' && bagRole(BAG_ROLES.consolider)) btn2('Consolider', 'bagConsolidate');
      if (s === 'CONSOLIDATED' && bagRole(BAG_ROLES.approuver)) btn2('Décision BM', 'openBagApprove', true);
      if (/^(BM_APPROVED|GM_APPROVED|PARTIALLY_RELEASED)$/.test(s)) {
        if (expired) { if (bagRole(BAG_ROLES.cloturer)) btn2('Marquer expirée', 'bagMarkExpired'); }
        else if (bagRole(BAG_ROLES.liberer)) btn2('Libérer', 'openBagRelease', true);
      }
      if (/RELEASED/.test(s) && n(r.received_qty) < n(r.released_qty) && bagRole(BAG_ROLES.recevoir)) btn2('Confirmer réception', 'openBagReceipt');
      if (/^(REQUESTED|REVIEWED|CONSOLIDATED)$/.test(s) && bagRole(BAG_ROLES.cloturer)) btn2('Rejeter', 'openBagReject');
      return btns.join(' ');
    }

    paint(head('Sacherie AFLP', 'Enveloppe GM → allocations clusters → demandes RT → approbation → sorties multi-release → réception → balances.',
      actions) + createHost() +
      kpis([
        ['Parc total', g.total != null ? num(g.total) : '—', 'vides ' + num(g.vides) + ' · pleins ' + num(g.pleins)],
        ['Enveloppe ' + BAG_CAMPAGNE, env.approved_qty != null ? num(env.approved_qty) : '—', num(allocated) + ' alloués', env.approved_qty == null ? 'danger' : ''],
        ['Sacs chez les RT', num(withRt), b.rtStock.length + ' RT'],
        ['Demandes à traiter', String(pending.length), 'revue → consolidation → BM', pending.length ? 'warn' : ''],
        ['Écarts de réception', String(ecartsReception.length), 'libéré ≠ reçu', ecartsReception.length ? 'danger' : ''],
        ['Pertes à décider', String(pertesADecider.length), invHold.length + ' inventaire(s) en écart', (pertesADecider.length || invHold.length) ? 'warn' : ''],
        ['Approbations actives', String(approved.length), expiring.length + ' expire(nt) sous 3 j', expiring.length ? 'warn' : ''],
        ['RT sans mouvement 30 j', String(aging.length), 'balance non nulle', aging.length ? 'warn' : '']
      ]) +
      (initReady ? '' : initCard) +
      '<div class="notice info"><b>Règle :</b> l’approbation n’est pas la sortie physique. Une approbation de 2 000 sacs peut se libérer ' +
      'en plusieurs sorties (700 + 500 + 800) sans jamais se clôturer après la première. La réception est confirmée par le terrain : ' +
      'tout écart libéré / reçu reste visible jusqu’à justification.</div>' +
      '<section class="card"><div class="card-head"><div><h2>Demandes & workflow</h2>' +
      '<p>' + b.requests.length + ' demande(s) chargée(s), plus récentes d’abord. Chaque étape est contrôlée par le serveur.</p></div></div>' +
      table(['Référence', 'Cluster / RT', 'Demandé', 'Approuvé', 'Libéré', 'Reçu', 'Écart', 'Statut', 'Actions'],
        b.requests.slice(0, 20).map(function (r) {
          var ecart = n(r.released_qty) - n(r.received_qty);
          var locBad = r.source_location_code && !/^AFLP-/.test(String(r.source_location_code));
          return '<tr><td class="mono">' + esc(r.request_code || r.id) +
            (locBad ? '<br><span class="badge danger">codes location invalides — recréer</span>' : '') + '</td>' +
            '<td>' + esc(r.cluster || '—') + (r.rt_id ? '<br><span class="muted">' + esc((c.rm[r.rt_id] || {}).nom || r.rt_id) + '</span>' : '') + '</td>' +
            '<td>' + num(r.requested_qty) + '</td><td>' + num(r.approved_qty) + '</td>' +
            '<td>' + num(r.released_qty) + '</td><td>' + num(r.received_qty) + '</td>' +
            '<td>' + (n(r.released_qty) > 0 && ecart > 0 ? '<span class="badge danger">−' + num(ecart) + '</span>' : (n(r.released_qty) > 0 ? '0' : '—')) + '</td>' +
            '<td>' + badge(bagStatusFr(r.status)) + (r.expires_at ? '<br><span class="muted">expire ' + date(r.expires_at) + '</span>' : '') + '</td>' +
            '<td>' + (actionsFor(r) || '—') + '</td></tr>';
        })) + '</section>' +
      '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Stock par cluster</h2></div></div>' +
      table(['Cluster', 'Vides', 'Pleins', 'Chez RT', 'Chez producteur', 'Transit', 'Déchirés', 'À réparer', 'Total réseau'],
        b.clusterStock.map(function (s) {
          return '<tr><td><b>' + esc(s.cluster) + '</b></td><td>' + num(s.stock_cluster_vide) + '</td>' +
            '<td>' + num(s.stock_cluster_plein) + '</td><td>' + num(s.stock_chez_rt) + '</td>' +
            '<td>' + num(s.stock_chez_producteur) + '</td><td>' + num(s.transit) + '</td>' +
            '<td>' + num(s.dechires) + '</td><td>' + num(s.a_reparer) + '</td>' +
            '<td>' + num(s.total_reseau) + '</td></tr>';
        })) +
      '</section><section class="card"><div class="card-head"><div><h2>Dernières sorties physiques</h2>' +
      '<p>Chaque libération est un mouvement du registre canonique.</p></div></div>' +
      table(['Date', 'Demande', 'Qté', 'Trajet', 'Preuve'],
        (b.releases || []).slice(0, 12).map(function (x) {
          var req = bagReqById(b, x.request_id) || {};
          return '<tr><td>' + date(x.released_at) + '</td><td class="mono">' + esc(req.request_code || x.request_id || '—') + '</td>' +
            '<td>' + num(x.qty) + '</td><td class="mono">' + esc(x.source_location_code || '—') + ' → ' + esc(x.destination_location_code || '—') + '</td>' +
            '<td>' + (x.proof_url ? '<a href="#bags" class="ops-link" onclick="ANAGROCI_FB.openBagProof(\'' + esc(x.proof_url) + '\');return false;"><b>voir</b></a>' : '—') + '</td></tr>';
        })) + '</section></div>' +
      '<section class="card"><div class="card-head"><div><h2>RT Bag Account</h2>' +
      '<p>Balance sacherie sous la responsabilité de chaque RT (' + b.rtStock.length + ' RT).</p></div></div>' +
      table(['Cluster', 'RT', 'Sous responsabilité', 'Vides', 'Pleins', 'Déchirés', 'À réparer', 'Dernière activité', 'Ancienneté'],
        b.rtStock.slice(0, 60).map(function (s) {
          var age = daysSince(s.derniere_activite);
          return '<tr><td>' + esc(s.cluster || '—') + '</td><td><b>' + esc(s.rt_nom || s.rt_id) + '</b></td>' +
            '<td>' + num(s.total_sous_responsabilite) + '</td><td>' + num(s.vides) + '</td>' +
            '<td>' + num(s.pleins) + '</td><td>' + num(s.dechires) + '</td><td>' + num(s.a_reparer) + '</td>' +
            '<td>' + date(s.derniere_activite) + '</td>' +
            '<td>' + (age == null ? '—' : (age > 30 ? '<span class="badge warn">' + age + ' j</span>' : age + ' j')) + '</td></tr>';
        })) + '</section>' +
      '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Pertes déclarées</h2>' +
      '<p>Une perte ne diminue le stock qu’après décision du Branch Manager.</p></div></div>' +
      table(['Date', 'Location', 'État', 'Qté', 'Motif', 'Statut', 'Décision'],
        (b.pertes || []).slice(0, 10).map(function (p) {
          return '<tr><td>' + date(p.submitted_at) + '</td><td class="mono">' + esc(p.location_code) + '</td>' +
            '<td>' + esc(p.state) + '</td><td>' + num(p.qty) + '</td><td>' + esc(p.motif || '—') + '</td>' +
            '<td>' + badge(p.statut) + '</td>' +
            '<td>' + (p.statut === 'SOUMIS' && bagRole(BAG_ROLES.bm)
              ? '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.openBagLossDecision(\'' + esc(p.id) + '\')">Examiner</button>' : '—') + '</td></tr>';
        })) +
      '</section><section class="card"><div class="card-head"><div><h2>Derniers inventaires</h2>' +
      '<p>Théorique vs compté — un écart reste en HOLD jusqu’à justification, jamais ajusté en silence.</p></div></div>' +
      table(['Date', 'Location', 'État', 'Théorique', 'Compté', 'Écart', 'Statut'],
        (b.inventaires || []).slice(0, 10).map(function (i) {
          var d = n(i.counted_qty) - n(i.theoretical_qty);
          return '<tr><td>' + date(i.counted_at) + '</td><td class="mono">' + esc(i.location_code) + '</td>' +
            '<td>' + esc(i.state) + '</td><td>' + num(i.theoretical_qty) + '</td><td>' + num(i.counted_qty) + '</td>' +
            '<td>' + (d ? '<span class="badge ' + (i.reconciliation_status === 'HOLD' ? 'danger' : 'warn') + '">' + (d > 0 ? '+' : '') + num(d) + '</span>' : '0') + '</td>' +
            '<td>' + badge(i.reconciliation_status || i.statut || '—') + '</td></tr>';
        })) + '</section></div>');
  });
}

/* --- Demande RT : contrôles SOP restaurés (plafond serveur 80 kg / +10 %). */
function openBagRequest() {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  Promise.all([base(), bagsData(), cashData(), loadProfile()]).then(function (rs) {
    var c = rs[0], b = rs[1], cash = rs[2];
    if (!guardTerrain(host)) return;
    /* Idempotence : la clé est fixée à l'ouverture du formulaire — un double
       clic ou un retry après timeout rejoue LA MÊME demande, jamais deux. */
    var clientRequestId = 'bagreq-' + uid();
    var lastCalc = null;
    var clusterOpts = selOptions(c.clusters.map(function (x) { return [x.label, x.label]; }), '');
    host.innerHTML = '<div class="card-head"><div><h2>Nouvelle demande de sacs RT</h2>' +
      '<p>Règle serveur : 80 kg / sac · marge max 10 %. Le stock RCN provient d’un comptage physique. ' +
      'Une demande n’est jamais une approbation ; la sortie physique reste une étape distincte, en une ou plusieurs libérations.</p></div></div>' +
      '<form id="bagReqForm"><div class="ops-form-grid">' +
      field('Cluster *', '<select id="bq_cluster" required><option value="">Choisir…</option>' + clusterOpts + '</select>') +
      field('RT *', '<select id="bq_rt" required><option value="">Choisir…</option></select>') +
      field('Quantité demandée *', '<input id="bq_qty" type="number" min="1" required>') +
      field('Cycle financé (OPEN)', '<select id="bq_cycle"><option value="">— contrôle SOP —</option></select>') +
      field('Stock RCN vérifié (kg)', '<input id="bq_rcn" type="number" min="0" step="1" placeholder="comptage physique">') +
      '</div><div id="bq_ctx" class="notice info" hidden></div><div id="bq_sop" class="notice" hidden></div>' +
      '<div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="bq_submit">Soumettre la demande</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="bq_msg" class="muted" style="margin-top:10px"></div></form>';

    var clSel = document.getElementById('bq_cluster'), rtSel = document.getElementById('bq_rt'),
      cySel = document.getElementById('bq_cycle'), rcnIn = document.getElementById('bq_rcn'),
      qtyIn = document.getElementById('bq_qty'), ctx = document.getElementById('bq_ctx'),
      sop = document.getElementById('bq_sop');
    function syncRt() {
      var k = normName(clSel.value);
      rtSel.innerHTML = '<option value="">Choisir…</option>' + selOptions(
        c.rts.filter(function (r) { return normName(r.cluster || '') === k; })
          .map(function (r) { return [r.id, r.nom + ' · ' + (r.village_nom || '—')]; }), '');
      syncCycle(); syncCtx();
    }
    function syncCycle() {
      var open = (cash.avances || []).filter(function (a) {
        return a.rt_id === rtSel.value && a.cycle_id && String(a.cycle_statut).toUpperCase() === 'OPEN' && n(a.volume_finance_kg) > 0;
      });
      cySel.innerHTML = '<option value="">— contrôle SOP —</option>' + selOptions(
        open.map(function (a) { return [a.cycle_id, a.cycle_id + ' · ' + num(a.volume_finance_kg) + ' kg financés']; }), '');
      lastCalc = null; sop.hidden = true;
    }
    function syncCtx() {
      var k = normName(clSel.value);
      var stock = b.clusterStock.filter(function (s) { return normName(s.cluster) === k; })[0];
      var rtRow = b.rtStock.filter(function (s) { return s.rt_id === rtSel.value; })[0];
      ctx.hidden = !clSel.value;
      ctx.innerHTML = 'Stock cluster : <b>' + (stock ? num(stock.stock_cluster_vide) + ' vide(s)' : '—') + '</b>' +
        (rtRow ? ' · Sacs déjà sous responsabilité du RT : <b>' + num(rtRow.total_sous_responsabilite) + '</b>' : '');
    }
    function syncSop() {
      lastCalc = null; sop.hidden = true;
      if (!rtSel.value || !cySel.value || rcnIn.value === '') return;
      sop.hidden = false; sop.className = 'notice'; sop.textContent = 'Calcul du plafond SOP…';
      client().then(function (cl) {
        return cl.rpc('sacherie_calculer_plafond', {
          p_rt_id: rtSel.value, p_cycle_id: cySel.value, p_stock_rcn_kg: n(rcnIn.value)
        });
      }).then(function (r) {
        if (r.error) { sop.className = 'notice warn'; sop.textContent = 'Plafond SOP indisponible : ' + r.error.message; return; }
        lastCalc = r.data || null;
        var v = lastCalc || {};
        sop.className = 'notice ' + (n(qtyIn.value) > n(v.max_new_available) ? 'danger' : 'ok');
        sop.innerHTML = '<b>Plafond SOP :</b> financé ' + num(v.volume_finance_kg) + ' kg · acheté ' + num(v.volume_achete_cycle_kg) +
          ' kg · plafond système <b>' + num(v.system_max_bags) + '</b> · détenus ' + num(v.bags_already_held) +
          ' · réservés ' + num(v.reserved_approved_bags) + ' · <b>disponible : ' + num(v.max_new_available) + ' sac(s)</b>' +
          (n(qtyIn.value) > n(v.max_new_available) ? ' — <b>DÉPASSEMENT SOP</b>' : '');
      });
    }
    clSel.addEventListener('change', syncRt);
    rtSel.addEventListener('change', function () { syncCycle(); syncCtx(); });
    cySel.addEventListener('change', syncSop);
    rcnIn.addEventListener('change', syncSop);
    qtyIn.addEventListener('input', function () { if (lastCalc) syncSop(); });

    document.getElementById('bagReqForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('bq_msg'), btn = document.getElementById('bq_submit');
      var cluster = clSel.value, rt = c.rm[rtSel.value], qty = n(qtyIn.value);
      if (!cluster || !rt || qty <= 0) { msg.className = 'ops-danger-text'; msg.textContent = 'Cluster, RT et quantité sont obligatoires.'; return; }
      if (lastCalc && qty > n(lastCalc.max_new_available)) {
        msg.className = 'ops-danger-text';
        msg.textContent = 'DÉPASSEMENT SOP : ' + num(qty) + ' demandé(s) pour ' + num(lastCalc.max_new_available) + ' disponible(s) au plafond.';
        return;
      }
      var srcLoc = bagLoc(b, 'CLUSTER', cluster);
      if (!srcLoc) {
        msg.className = 'ops-danger-text';
        msg.textContent = 'Location cluster absente du registre (AFLP-CL) : initialisation campagne requise avant toute demande.';
        return;
      }
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Envoi de la demande…';
      client().then(function (cl) {
        var dst = bagLoc(b, 'RT', rt.id);
        var ensure = dst ? Promise.resolve(dst.code)
          : cl.rpc('sacherie_ct_location', { p_scope: 'RT', p_cluster: cluster, p_rt_id: rt.id, p_rt_nom: rt.nom, p_producteur_id: null, p_producteur_nom: null })
            .then(function (r) { if (r.error) throw new Error(r.error.message); return typeof r.data === 'string' ? r.data : (r.data && r.data.code); });
        return ensure.then(function (dstCode) {
          if (!dstCode) throw new Error('Location RT introuvable et non créable.');
          return cl.from('ops_bag_requests').insert({
            client_request_id: clientRequestId, channel: 'AFLP', campaign: BAG_CAMPAGNE,
            cluster: cluster, rt_id: rt.id,
            source_location_code: srcLoc.code,
            destination_location_code: dstCode,
            requested_qty: qty,
            notes: lastCalc ? ('SOP: plafond ' + lastCalc.system_max_bags + ', disponible ' + lastCalc.max_new_available + ', cycle ' + cySel.value) : 'SOP non calculé (cycle/stock RCN non fournis)',
            status: 'REQUESTED'
          });
        });
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) {
          if (/duplicate|unique/i.test(r.error.message)) { msg.className = 'ops-ok-text'; msg.textContent = 'Demande déjà enregistrée (idempotence).'; return; }
          msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return;
        }
        msg.className = 'ops-ok-text';
        msg.textContent = 'Demande soumise pour ' + rt.nom + ' : ' + num(qty) + ' sac(s). Circuit : revue → consolidation → décision BM.';
        auditLog('sacs_demande_creee', rt.id + ' · ' + qty + ' sacs · ' + cluster);
        FBStore.invalidate('bags');
        setTimeout(function () { closeForm(); render(); }, 1200);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Envoi impossible.';
      });
    });
  });
}

/* --- Étapes du workflow (le trigger serveur ops_bag_request_guard arbitre). */
function bagStep(id, patch, action, okMsg) {
  return client().then(function (cl) {
    return cl.from('ops_bag_requests').update(patch).eq('id', id);
  }).then(function (r) {
    if (r.error) { alert(r.error.message); return false; }
    auditLog(action, String(id));
    FBStore.invalidate('bags'); render();
    if (okMsg) { /* le rendu rafraîchi porte le nouvel état */ }
    return true;
  });
}
function bagReview(id) { bagStep(id, { status: 'REVIEWED' }, 'sacs_demande_revue'); }
function bagConsolidate(id) { bagStep(id, { status: 'CONSOLIDATED' }, 'sacs_demande_consolidee'); }
function bagMarkExpired(id) { bagStep(id, { status: 'EXPIRED' }, 'sacs_approbation_expiree'); }

function openBagApprove(id) {
  bagsData().then(function (b) {
    var r = bagReqById(b, id); if (!r) return;
    var host = formHost();
    host.innerHTML = '<div class="card-head"><div><h2>Décision Branch Manager — ' + esc(r.request_code || r.id) + '</h2>' +
      '<p>Demandé : <b>' + num(r.requested_qty) + '</b> sac(s) · ' + esc(r.cluster || '') + '. ' +
      'L’approbation réserve les sacs 24 h (durée MVP à revalider métier) ; elle n’est pas la sortie physique.</p></div></div>' +
      '<form id="bagAppForm"><div class="ops-form-grid">' +
      field('Quantité approuvée *', '<input id="ba_qty" type="number" min="1" max="' + n(r.requested_qty) + '" value="' + n(r.requested_qty) + '" required>') +
      field('Commentaire', '<input id="ba_note" type="text" placeholder="obligatoire si quantité réduite">') +
      '</div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit">Approuver</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="ba_msg" class="muted" style="margin-top:10px"></div></form>';
    document.getElementById('bagAppForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var qty = n(document.getElementById('ba_qty').value), note = document.getElementById('ba_note').value.trim();
      var msg = document.getElementById('ba_msg');
      if (qty <= 0 || qty > n(r.requested_qty)) { msg.className = 'ops-danger-text'; msg.textContent = 'Quantité approuvée invalide.'; return; }
      if (qty < n(r.requested_qty) && !note) { msg.className = 'ops-danger-text'; msg.textContent = 'Un commentaire est obligatoire pour une approbation partielle.'; return; }
      bagStep(id, { status: 'BM_APPROVED', approved_qty: qty,
        expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
        notes: note || r.notes || null }, 'sacs_demande_approuvee').then(function (ok) { if (ok) closeForm(); });
    });
  });
}
function openBagReject(id) {
  var motif = prompt('Motif du rejet (obligatoire) :');
  if (motif === null) return;
  if (!motif.trim()) { alert('Le motif de rejet est obligatoire.'); return; }
  bagStep(id, { status: 'REJECTED', closed_reason: motif.trim() }, 'sacs_demande_rejetee');
}

function openBagRelease(id) {
  bagsData().then(function (b) {
    var r = bagReqById(b, id); if (!r) return;
    var reste = Math.max(n(r.approved_qty) - n(r.released_qty), 0);
    var clientReleaseId = 'bagrel-' + uid();
    var host = formHost();
    host.innerHTML = '<div class="card-head"><div><h2>Sortie physique — ' + esc(r.request_code || r.id) + '</h2>' +
      '<p>Approuvé <b>' + num(r.approved_qty) + '</b> · déjà libéré <b>' + num(r.released_qty) + '</b> · ' +
      'reste autorisé <b>' + num(reste) + '</b>. Multi-release : l’autorisation ne se clôt qu’au dernier sac.</p></div></div>' +
      '<form id="bagRelForm"><div class="ops-form-grid">' +
      field('Quantité sortie *', '<input id="br_qty" type="number" min="1" max="' + reste + '" required>') +
      field('Note', '<input id="br_note" type="text" placeholder="bordereau, chauffeur…">') +
      field('Preuve (photo)', '<input id="br_proof" type="file" accept="image/*" capture="environment">') +
      '</div><div class="notice info">Trajet autorisé : <span class="mono">' + esc(r.source_location_code || '—') + ' → ' + esc(r.destination_location_code || '—') + '</span></div>' +
      '<div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="br_submit">Confirmer la sortie</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="br_msg" class="muted" style="margin-top:10px"></div></form>';
    document.getElementById('bagRelForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('br_msg'), btn = document.getElementById('br_submit');
      var qty = n(document.getElementById('br_qty').value);
      if (qty <= 0 || qty > reste) { msg.className = 'ops-danger-text'; msg.textContent = 'Quantité invalide ou supérieure à l’autorisation restante (' + num(reste) + ').'; return; }
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Sortie en cours…';
      var f = document.getElementById('br_proof').files[0] || null;
      bagProofUpload(f, msg).then(function (proofPath) {
        return client().then(function (cl) {
          return cl.rpc('ops_release_bags', {
            p_request_id: r.id, p_client_release_id: clientReleaseId,
            p_source_location: r.source_location_code, p_destination_location: r.destination_location_code,
            p_qty: qty, p_proof_url: proofPath, p_note: document.getElementById('br_note').value.trim() || null
          });
        });
      }).then(function (res) {
        btn.disabled = false;
        if (res.error) { msg.className = 'ops-danger-text'; msg.textContent = res.error.message; return; }
        msg.className = 'ops-ok-text';
        msg.textContent = 'Sortie enregistrée : ' + num(qty) + ' sac(s). Reste autorisé : ' + num(reste - qty) + '.';
        auditLog('sacs_sortie_liberee', String(r.request_code || r.id) + ' · ' + qty);
        FBStore.invalidate('bags');
        setTimeout(function () { closeForm(); render(); }, 1200);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Sortie impossible.';
      });
    });
  });
}

function openBagReceipt(id) {
  bagsData().then(function (b) {
    var r = bagReqById(b, id); if (!r) return;
    var attendu = Math.max(n(r.released_qty) - n(r.received_qty), 0);
    var host = formHost();
    host.innerHTML = '<div class="card-head"><div><h2>Confirmation de réception — ' + esc(r.request_code || r.id) + '</h2>' +
      '<p>Libéré <b>' + num(r.released_qty) + '</b> · déjà confirmé <b>' + num(r.received_qty) + '</b>. ' +
      'Si le compte reçu est inférieur au libéré, l’écart reste affiché et doit être investigué.</p></div></div>' +
      '<form id="bagRecForm"><div class="ops-form-grid">' +
      field('Sacs reçus maintenant *', '<input id="bc_qty" type="number" min="1" max="' + attendu + '" value="' + attendu + '" required>') +
      field('Observation', '<input id="bc_note" type="text" placeholder="obligatoire en cas d’écart">') +
      '</div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit">Je confirme la réception</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="bc_msg" class="muted" style="margin-top:10px"></div></form>';
    document.getElementById('bagRecForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('bc_msg');
      var qty = n(document.getElementById('bc_qty').value), note = document.getElementById('bc_note').value.trim();
      if (qty <= 0 || qty > attendu) { msg.className = 'ops-danger-text'; msg.textContent = 'Quantité invalide (maximum ' + num(attendu) + ').'; return; }
      if (qty < attendu && !note) { msg.className = 'ops-danger-text'; msg.textContent = 'Écart de ' + num(attendu - qty) + ' sac(s) : observation obligatoire.'; return; }
      var total = n(r.received_qty) + qty;
      bagStep(id, { received_qty: total, notes: note ? ('Réception: ' + note) : r.notes || null }, 'sacs_reception_confirmee')
        .then(function (ok) { if (ok) closeForm(); });
    });
  });
}

/* --- Contrôles patrimoniaux : inventaire, états, pertes (RPC sacherie_ct_*). */
var BAG_STATES = ['UTILISABLE', 'PLEIN', 'DECHIRE', 'A_REPARER', 'REPARE', 'REFORME'];
var BAG_TRANSITIONS = [['DECHIRE', 'A_REPARER'], ['DECHIRE', 'REFORME'], ['A_REPARER', 'REPARE'],
  ['A_REPARER', 'REFORME'], ['REPARE', 'UTILISABLE']];
function openBagControl(mode) {
  var host = formHost();
  host.innerHTML = '<p class="muted">Ouverture…</p>';
  Promise.all([bagsData(), loadProfile()]).then(function (rs) {
    var b = rs[0];
    if (!guardTerrain(host)) return;
    var locOpts = selOptions((b.locations || []).filter(function (l) { return l.actif; })
      .map(function (l) { return [l.code, l.code + ' · ' + (l.nom || '')]; }), '');
    var titres = { inventaire: 'Inventaire physique', etat: 'Traiter des sacs abîmés', perte: 'Déclarer une perte' };
    var notes = {
      inventaire: 'La comparaison théorique / physique est calculée par le serveur : tout écart passe en HOLD avec motif obligatoire, jamais d’ajustement silencieux.',
      etat: 'Chemin autorisé : DECHIRE → A_REPARER → REPARE → UTILISABLE, sortie REFORME (Branch Manager). Le total du parc ne change jamais.',
      perte: 'La déclaration ne diminue pas le stock : la diminution n’intervient qu’après décision du Branch Manager.'
    };
    host.innerHTML = '<div class="card-head"><div><h2>' + titres[mode] + '</h2><p>' + notes[mode] + '</p></div></div>' +
      '<form id="bagCtlForm"><div class="ops-form-grid">' +
      field('Location *', '<select id="bx_loc" required><option value="">Choisir…</option>' + locOpts + '</select>') +
      (mode === 'etat'
        ? field('Transition *', '<select id="bx_tr" required>' + BAG_TRANSITIONS.map(function (t, i) {
            return '<option value="' + i + '">' + t[0] + ' → ' + t[1] + '</option>'; }).join('') + '</select>')
        : field('État *', '<select id="bx_state" required>' + BAG_STATES.map(function (s) {
            return '<option' + (s === 'UTILISABLE' ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>')) +
      field(mode === 'inventaire' ? 'Comptage physique *' : 'Quantité *', '<input id="bx_qty" type="number" min="0" required>') +
      field('Motif' + (mode === 'perte' ? ' *' : ''), '<input id="bx_reason" type="text"' + (mode === 'perte' ? ' required' : '') + '>') +
      field('Preuve (photo)', '<input id="bx_proof" type="file" accept="image/*" capture="environment">') +
      '</div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="bx_submit">Enregistrer</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="bx_msg" class="muted" style="margin-top:10px"></div></form>';
    document.getElementById('bagCtlForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('bx_msg'), btn = document.getElementById('bx_submit');
      var loc = document.getElementById('bx_loc').value, qty = n(document.getElementById('bx_qty').value);
      var reason = document.getElementById('bx_reason').value.trim();
      if (!loc || qty < 0 || (mode !== 'inventaire' && qty <= 0)) { msg.className = 'ops-danger-text'; msg.textContent = 'Location et quantité valides requises.'; return; }
      if (mode === 'perte' && !reason) { msg.className = 'ops-danger-text'; msg.textContent = 'Le motif de perte est obligatoire.'; return; }
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Enregistrement…';
      var f = document.getElementById('bx_proof').files[0] || null;
      bagProofUpload(f, msg).then(function (proofPath) {
        return client().then(function (cl) {
          if (mode === 'inventaire') {
            return cl.rpc('sacherie_ct_inventorier', { p_location: loc, p_state: document.getElementById('bx_state').value, p_counted: qty, p_reason: reason || null, p_proof: proofPath });
          }
          if (mode === 'perte') {
            return cl.rpc('sacherie_ct_declarer_perte', { p_location: loc, p_state: document.getElementById('bx_state').value, p_qty: qty, p_reason: reason, p_proof: proofPath });
          }
          var t = BAG_TRANSITIONS[n(document.getElementById('bx_tr').value)];
          return cl.rpc('sacherie_ct_traiter_etat', { p_location: loc, p_from_state: t[0], p_to_state: t[1], p_qty: qty, p_reason: reason || 'Traitement du parc', p_proof: proofPath });
        });
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        msg.className = 'ops-ok-text';
        if (mode === 'inventaire') {
          var d = r.data || {};
          msg.textContent = 'Inventaire enregistré : ' + (d.status || '—') + ' · écart ' + num(d.difference) + ' sac(s).';
        } else if (mode === 'perte') {
          msg.textContent = 'Perte déclarée — le stock reste inchangé jusqu’à la décision du Branch Manager.';
        } else {
          msg.textContent = 'Transition enregistrée dans le registre canonique.';
        }
        auditLog('sacs_' + mode, loc + ' · ' + qty);
        FBStore.invalidate('bags');
        setTimeout(function () { closeForm(); render(); }, 1400);
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Enregistrement impossible.';
      });
    });
  });
}
function openBagLossDecision(id) {
  bagsData().then(function (b) {
    var p = (b.pertes || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p) return;
    var ok = confirm('Perte ' + p.qty + ' sac(s) · ' + p.location_code + ' · motif : ' + (p.motif || '—') +
      '\n\nOK = APPROUVER (le stock canonique diminue) · Annuler = passer au refus');
    var comment = null;
    if (!ok) {
      comment = prompt('Motif du refus (obligatoire) :');
      if (comment === null) return;
      if (!comment.trim()) { alert('Le motif du refus est obligatoire.'); return; }
    }
    client().then(function (cl) {
      return cl.rpc('sacherie_ct_decider_perte', { p_id: id, p_approve: ok, p_comment: comment });
    }).then(function (r) {
      if (r.error) { alert(r.error.message); return; }
      auditLog(ok ? 'sacs_perte_approuvee' : 'sacs_perte_refusee', String(id));
      FBStore.invalidate('bags'); render();
    });
  });
}
function openBagProof(path) {
  signedUrl(path, BUCKET_SACHERIE).then(function (u) {
    if (u) window.open(u, '_blank', 'noopener');
    else alert('Preuve indisponible ou accès refusé.');
  });
}

/* --- Initialisation campagne (enveloppe GM, allocations clusters). */
function openBagEnvelope() {
  var host = formHost();
  host.innerHTML = '<div class="card-head"><div><h2>Enveloppe campagne ' + BAG_CAMPAGNE + '</h2>' +
    '<p>Volume total de sacs autorisé pour la campagne. Le serveur garde l’unicité par campagne.</p></div></div>' +
    '<form id="bagEnvForm"><div class="ops-form-grid">' +
    field('Sacs approuvés *', '<input id="be_qty" type="number" min="1" required placeholder="ex. 15000">') +
    field('Note', '<input id="be_note" type="text">') +
    '</div><div class="ops-actions" style="margin-top:12px">' +
    '<button class="btn primary" type="submit">Créer l’enveloppe</button>' +
    '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
    '<div id="be_msg" class="muted" style="margin-top:10px"></div></form>';
  document.getElementById('bagEnvForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = document.getElementById('be_msg'), qty = n(document.getElementById('be_qty').value);
    if (qty <= 0) { msg.className = 'ops-danger-text'; msg.textContent = 'Quantité invalide.'; return; }
    client().then(function (cl) {
      return cl.from('aflp_bag_envelopes').insert({ campaign: BAG_CAMPAGNE, approved_qty: qty, status: 'APPROVED',
        notes: document.getElementById('be_note').value.trim() || null });
    }).then(function (r) {
      if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
      msg.className = 'ops-ok-text'; msg.textContent = 'Enveloppe ' + BAG_CAMPAGNE + ' créée : ' + num(qty) + ' sacs.';
      auditLog('sacs_enveloppe_creee', BAG_CAMPAGNE + ' · ' + qty);
      FBStore.invalidate('bags');
      setTimeout(function () { closeForm(); render(); }, 1200);
    });
  });
}
function openBagAllocation() {
  Promise.all([base(), bagsData()]).then(function (rs) {
    var c = rs[0], b = rs[1], env = bagEnv(b);
    var host = formHost();
    if (!env) { host.innerHTML = '<div class="notice danger">Créez d’abord l’enveloppe campagne.</div>'; return; }
    var allocated = b.allocations.reduce(function (t, a) { return t + n(a.allocated_qty); }, 0);
    host.innerHTML = '<div class="card-head"><div><h2>Allocation cluster — enveloppe ' + esc(env.campaign) + '</h2>' +
      '<p>Enveloppe ' + num(env.approved_qty) + ' · déjà alloué ' + num(allocated) + ' · restant ' + num(n(env.approved_qty) - allocated) + '. Le serveur refuse tout dépassement.</p></div></div>' +
      '<form id="bagAllForm"><div class="ops-form-grid">' +
      field('Cluster *', '<select id="bl_cluster" required><option value="">Choisir…</option>' +
        selOptions(c.clusters.map(function (x) { return [x.label, x.label]; }), '') + '</select>') +
      field('Sacs alloués *', '<input id="bl_qty" type="number" min="1" required>') +
      '</div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit">Allouer</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.closeForm()">Annuler</button></div>' +
      '<div id="bl_msg" class="muted" style="margin-top:10px"></div></form>';
    document.getElementById('bagAllForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('bl_msg');
      var cluster = document.getElementById('bl_cluster').value, qty = n(document.getElementById('bl_qty').value);
      if (!cluster || qty <= 0) { msg.className = 'ops-danger-text'; msg.textContent = 'Cluster et quantité requis.'; return; }
      client().then(function (cl) {
        return cl.from('aflp_bag_cluster_allocations').insert({ envelope_id: env.id, cluster: cluster, allocated_qty: qty });
      }).then(function (r) {
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        msg.className = 'ops-ok-text'; msg.textContent = 'Allocation enregistrée : ' + esc(cluster) + ' · ' + num(qty) + ' sacs.';
        auditLog('sacs_allocation_cluster', cluster + ' · ' + qty);
        FBStore.invalidate('bags');
        setTimeout(function () { closeForm(); render(); }, 1200);
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
    bagsData().catch(function () { return { clusterStock: [], rtStock: [], requests: [], envelopes: [], allocations: [], locations: [], releases: [], global: {}, pertes: [], inventaires: [] }; }),
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
        if (/REQUESTED|REVIEWED|CONSOLIDATED|PENDING|SUBMITTED/i.test(String(r.status || '')))
          add('orange', 'Demande de sacs en attente', (r.request_code || r.id) + ' · ' + num(r.requested_qty) + ' sac(s)', '#bags', r.cluster);
        if (r.expires_at && new Date(r.expires_at) < new Date() && /APPROVED|PARTIAL/i.test(String(r.status || '')))
          add('rouge', 'Approbation expirée', r.request_code || r.id, '#bags', r.cluster);
        if (n(r.released_qty) > 0 && n(r.received_qty) < n(r.released_qty) && /RELEASED/i.test(String(r.status || '')))
          add('rouge', 'Écart de réception sacs', (r.request_code || r.id) + ' · libéré ' + num(r.released_qty) + ', reçu ' + num(r.received_qty), '#bags', r.cluster);
      });
      (b.pertes || []).forEach(function (p) {
        if (p.statut === 'SOUMIS')
          add('orange', 'Perte de sacs à décider (BM)', p.location_code + ' · ' + num(p.qty) + ' sac(s)', '#bags', null);
      });
      (b.inventaires || []).forEach(function (i) {
        if (i.reconciliation_status === 'HOLD')
          add('rouge', 'Écart d’inventaire sacherie en HOLD', i.location_code + ' · ' + esc(i.state) + ' · écart ' + num(n(i.counted_qty) - n(i.theoretical_qty)), '#bags', null);
      });
      b.clusterStock.forEach(function (s) {
        ['stock_cluster_vide', 'stock_chez_rt', 'stock_chez_producteur'].forEach(function (kcol) {
          if (n(s[kcol]) < 0) add('rouge', 'Stock sacherie négatif', s.cluster + ' · ' + kcol + ' = ' + num(s[kcol]), '#bags', s.cluster);
        });
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

/* ==================== fiches 360°, photos et documents ====================
   Village, RT et Producteur deviennent des fiches individuelles consultables,
   modifiables et enrichissables, dans le shell Operations.

   Stockage des images — architecture existante réutilisée, aucune migration :
   · photo de profil RT et pièces d'identité → bucket PRIVÉ terrain-preuves
     (URL signée temporaire uniquement, jamais d'URL publique, jamais de
     base64 en table) + métadonnées dans la table preuves (entite_type='rt') ;
   · galerie village → bucket public photos (l'emplacement historique des
     photos de recensement) + métadonnées (légende, catégorie, agent, GPS)
     dans villages.data.galerie ;
   · chaque ajout est journalisé dans audit_log (lecture réservée au BM). */

var BUCKET_PRIVE = 'terrain-preuves';
var BUCKET_PHOTOS = 'photos';
var CATEGORIES_PHOTO = ['Entrée du village', 'Route d’accès', 'Pont', 'Piste', 'Zone de stockage',
  'Producteurs', 'Réunion communautaire', 'Point d’achat', 'Infrastructure', 'Autre'];

function auditLog(action, details) {
  client().then(function (c) {
    if (!c) return;
    c.from('audit_log').insert({ action: action, details: String(details || '').slice(0, 900), email: profile.nom || null })
      .then(function () {});
  });
}

/* Compression côté client. Les pièces d'identité gardent une qualité élevée :
   la lisibilité prime sur le poids. */
function compressImage(file, maxDim, quality) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var w = img.width, h = img.height;
      var k = Math.min(1, maxDim / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob); else reject(new Error('Compression impossible'));
      }, 'image/jpeg', quality);
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

/* Sélecteur de photo avec aperçu avant validation : Ajouter → appareil photo
   (capture sur mobile) → APERÇU → Reprendre / Utiliser cette photo. */
function pickPhoto(opts) {
  return new Promise(function (resolve) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (opts && opts.capture) input.setAttribute('capture', 'environment');
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.remove();
      if (!file) return resolve(null);
      var overlay = document.createElement('div');
      overlay.className = 'ops-photo-preview';
      var url = URL.createObjectURL(file);
      overlay.innerHTML = '<div class="ops-photo-preview-box"><img alt="Aperçu de la photo" src="' + url + '">' +
        '<div class="ops-actions"><button class="btn primary" type="button" data-ok>Utiliser cette photo</button>' +
        '<button class="btn secondary" type="button" data-retry>Reprendre</button>' +
        '<button class="btn secondary" type="button" data-cancel>Annuler</button></div></div>';
      document.body.appendChild(overlay);
      overlay.querySelector('[data-ok]').onclick = function () { URL.revokeObjectURL(url); overlay.remove(); resolve(file); };
      overlay.querySelector('[data-retry]').onclick = function () { URL.revokeObjectURL(url); overlay.remove(); pickPhoto(opts).then(resolve); };
      overlay.querySelector('[data-cancel]').onclick = function () { URL.revokeObjectURL(url); overlay.remove(); resolve(null); };
    });
    input.click();
  });
}

/* Téléversement d'un document PRIVÉ (photo RT, pièce d'identité) : bucket
   terrain-preuves + ligne preuves + journal d'audit. Retourne le chemin. */
function uploadPrivateDoc(entiteType, entiteId, typePreuve, file, maxDim, quality) {
  return compressImage(file, maxDim, quality).then(function (blob) {
    return client().then(function (c) {
      var path = (profile.userId || 'agent') + '/' + entiteType + '/' + entiteId + '/' +
        typePreuve + '-' + Date.now().toString(36) + '.jpg';
      return c.storage.from(BUCKET_PRIVE).upload(path, blob, { contentType: 'image/jpeg' })
        .then(function (up) {
          if (up.error) throw new Error(up.error.message);
          return c.from('preuves').insert({
            id: (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : uid(),
            entite_type: entiteType, entite_id: entiteId, type_preuve: typePreuve,
            storage_path: path, horodatage_client: new Date().toISOString(),
            created_by: profile.userId || null
          });
        }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          auditLog('document_ajoute', entiteType + ' ' + entiteId + ' · ' + typePreuve);
          FBStore.invalidate('docs:' + entiteType + ':' + entiteId);
          return path;
        });
    });
  });
}

/* URL signée temporaire (60 min) — la seule façon de voir un document privé. */
var signedCache = Object.create(null);
function signedUrl(path, bucket) {
  var key = (bucket || BUCKET_PRIVE) + '/' + path;
  var hit = signedCache[key];
  if (hit && Date.now() - hit.at < 50 * 60000) return Promise.resolve(hit.url);
  return client().then(function (c) {
    return c.storage.from(bucket || BUCKET_PRIVE).createSignedUrl(path, 3600).then(function (r) {
      if (r.error || !r.data) return null;
      signedCache[key] = { url: r.data.signedUrl, at: Date.now() };
      return r.data.signedUrl;
    });
  });
}

function docsFor(entiteType, entiteId) {
  return FBStore.get('docs:' + entiteType + ':' + entiteId, function () {
    return q('preuves', 'id,entite_type,entite_id,type_preuve,storage_path,horodatage_client,created_by', 60,
      function (r) { return r.eq('entite_type', entiteType).eq('entite_id', entiteId).order('horodatage_client', { ascending: false }); })
      .catch(function () { return []; });
  });
}
function latestDoc(docs, type) {
  return docs.filter(function (d) { return d.type_preuve === type; })[0] || null;
}

function addRtDoc(rtId, typePreuve) {
  pickPhoto({ capture: true }).then(function (file) {
    if (!file) return;
    /* Pièce d'identité : 1600 px / qualité 0,9 — la lisibilité prime.
       Photo de profil : 512 px / 0,72 comme historiquement. */
    var piece = typePreuve !== 'photo_profil';
    var host = document.getElementById('rtDocMsg');
    if (host) { host.className = 'muted'; host.textContent = 'Téléversement…'; }
    uploadPrivateDoc('rt', rtId, typePreuve, file, piece ? 1600 : 512, piece ? 0.9 : 0.72)
      .then(function () { render(); })
      .catch(function (e) {
        if (host) { host.className = 'ops-danger-text'; host.textContent = e.message; }
      });
  });
}

/* Galerie village : bucket public photos (emplacement historique) +
   métadonnées dans villages.data.galerie. */
function addVillagePhoto(villageId) {
  pickPhoto({ capture: true }).then(function (file) {
    if (!file) return;
    var legende = prompt('Légende de la photo (facultatif) :') || '';
    var cat = prompt('Catégorie (' + CATEGORIES_PHOTO.join(' / ') + ') :') || 'Autre';
    var host = document.getElementById('villageGalMsg');
    if (host) { host.className = 'muted'; host.textContent = 'Téléversement…'; }
    compressImage(file, 1280, 0.8).then(function (blob) {
      return client().then(function (c) {
        var path = villageId + '/gallery/' + Date.now().toString(36) + '.jpg';
        return c.storage.from(BUCKET_PHOTOS).upload(path, blob, { contentType: 'image/jpeg' })
          .then(function (up) {
            if (up.error) throw new Error(up.error.message);
            return base().then(function (cc) {
              var v = cc.vm[villageId];
              var data = (v && v.data) || {};
              var galerie = (data.galerie || []).concat([{
                path: path, legende: legende, categorie: cat,
                date: new Date().toISOString(), agent: profile.nom || '',
                gpsLat: null, gpsLng: null
              }]);
              data.galerie = galerie;
              return c.from('villages').update({ data: data }).eq('id', villageId);
            });
          }).then(function (r) {
            if (r.error) throw new Error(r.error.message);
            auditLog('village_photo_ajoutee', villageId + ' · ' + cat);
            FBStore.invalidate('base');
            render();
          });
      });
    }).catch(function (e) {
      if (host) { host.className = 'ops-danger-text'; host.textContent = e.message; }
    });
  });
}
function villagePhotoUrl(path) {
  /* Le bucket photos est public : URL directe, comme historiquement. */
  return (global.ANAGROCI_SUPABASE_URL || '') + '/storage/v1/object/public/' + BUCKET_PHOTOS + '/' + path;
}
function archiveVillagePhoto(villageId, index) {
  if (!canEditTerrain()) return;
  base().then(function (cc) {
    var v = cc.vm[villageId];
    if (!v || !v.data || !v.data.galerie || !v.data.galerie[index]) return;
    v.data.galerie[index].archived = true;
    client().then(function (c) {
      c.from('villages').update({ data: v.data }).eq('id', villageId).then(function (r) {
        if (!r.error) { auditLog('village_photo_archivee', villageId); FBStore.invalidate('base'); render(); }
      });
    });
  });
}

/* Liens cliquables vers les fiches. */
function rtLink(r) {
  if (!r || !r.id) return '—';
  return '<a class="ops-link" href="#rt/' + encodeURIComponent(r.id) + '"><b>' + esc(r.nom || r.id) + '</b>' +
    (r.id_rt ? '<br><span class="muted mono">' + esc(r.id_rt) + '</span>' : '') + '</a>';
}
function villageLink(v) {
  if (!v || !v.id) return '—';
  return '<a class="ops-link" href="#villages/' + encodeURIComponent(v.id) + '"><b>' + esc(v.village || v.id) + '</b></a>';
}
function farmerLink(f) {
  if (!f || !f.producteur_id) return '—';
  return '<a class="ops-link" href="#farmers/' + encodeURIComponent(f.producteur_id) + '">' +
    '<span class="mono">' + esc(f.farmer_id || '—') + '</span> · <b>' + esc(f.nom) + '</b></a>';
}
function avatarHtml(url, alt) {
  return url
    ? '<img class="ops-avatar" alt="' + esc(alt) + '" src="' + esc(url) + '">'
    : '<div class="ops-avatar ops-avatar-empty" aria-label="Aucune photo">👤</div>';
}

/* --------------------------------- FICHE RT 360° ----------------------------- */

var RT_TABS = [['overview', 'Vue d’ensemble'], ['profil', 'Profil terrain'], ['producteurs', 'Producteurs'],
  ['achats', 'Achats'], ['sacherie', 'Sacherie'], ['caisse', 'Caisse'], ['documents', 'Documents & Photos'],
  ['historique', 'Historique']];

function renderRtFiche(rtId, tab) {
  tab = RT_TABS.some(function (t) { return t[0] === tab; }) ? tab : 'overview';
  paint(head('Fiche RT', 'Chargement…', '<a class="btn secondary" href="#rt/rts">← RT & Villages</a>') + skeletonPage(6));

  return Promise.all([base(), docsFor('rt', rtId), loadProfile()]).then(function (rs) {
    var c = rs[0], docs = rs[1];
    var r = c.rm[rtId];
    if (!r) {
      paint(head('Fiche RT', 'RT introuvable.', '<a class="btn secondary" href="#rt/rts">← RT & Villages</a>') +
        empty('Aucun RT ne porte cet identifiant.'));
      return;
    }
    var d = derive(c);
    var rd = r.data || {};
    var act = rd.activite || '—';
    var isProd = /producteur/i.test(String(act)) || rd.estProducteur === 'OUI';
    var t = normPhone(r.telephone), k = normName(r.nom);
    var asFarmer = c.farmers.filter(function (f) {
      return f.village_id === r.village_id && t && t.length >= 8 && normPhone(f.telephone) === t;
    })[0];
    var mesProducteurs = c.farmers.filter(function (f) { return f.rt_id === r.id; });
    var mesAchats = c.achats.filter(function (a) { return a.rt_id === r.id; });
    var photo = latestDoc(docs, 'photo_profil');
    var recto = latestDoc(docs, 'piece_recto');
    var verso = latestDoc(docs, 'piece_verso');
    var village = c.vm[r.village_id];

    var actions =
      (canEditTerrain() ? '<button class="btn primary" type="button" onclick="ANAGROCI_FB.openRtForm(null,\'' + esc(r.id) + '\')">Modifier</button>' : '') +
      (isProd ? (asFarmer
        ? '<a class="btn secondary" href="#farmers/' + encodeURIComponent(asFarmer.producteur_id) + '">Voir sa fiche Producteur</a>'
        : '<button class="btn primary" type="button" onclick="ANAGROCI_FB.rtToFarmer(\'' + esc(r.id) + '\')">Enrôler comme producteur</button>') : '') +
      '<a class="btn secondary" href="#rt/rts">← RT & Villages</a>';

    function headerCard(photoUrl) {
      return '<section class="card ops-fiche-head"><div class="ops-fiche-id">' +
        avatarHtml(photoUrl, 'Photo de ' + r.nom) +
        '<div><h2>' + esc(r.nom) + '</h2>' +
        '<p class="mono muted">' + esc(r.id_rt || r.id) + '</p>' +
        '<p>' + (village ? villageLink(village) : esc(r.village_nom || '—')) +
        ' · ' + esc(r.cluster || '—') + ' · ' + esc(zoneOfCluster(c, r.cluster)) + '</p>' +
        '<p>' + esc(r.telephone || '—') + ' · ' + badge(r.statut) + ' ' +
        (isProd ? badge('Producteur') : '') + ' <span class="muted">' + esc(act) + '</span></p>' +
        '</div></div>' +
        (canEditTerrain() ? '<div class="ops-actions">' +
          '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.addRtDoc(\'' + esc(r.id) + '\',\'photo_profil\')">' +
          (photo ? 'Remplacer la photo' : '📷 Ajouter une photo') + '</button>' +
          '<button class="btn secondary" type="button" onclick="location.hash=\'#rt/' + encodeURIComponent(r.id) + '/documents\'">Pièce d’identité</button>' +
          '</div>' : '') + '</section>';
    }
    function tabsBar() {
      return '<div class="ops-passport-tabs">' + RT_TABS.map(function (x) {
        return '<a class="' + (tab === x[0] ? 'active' : '') + '" href="#rt/' + encodeURIComponent(r.id) + '/' + x[0] + '">' + esc(x[1]) + '</a>';
      }).join('') + '</div>';
    }
    function defGrid(pairs) {
      return '<div class="ops-def-grid">' + pairs.map(function (x) {
        return '<div><small>' + esc(x[0]) + '</small><b>' + esc(x[1] == null || x[1] === '' ? '—' : x[1]) + '</b></div>';
      }).join('') + '</div>';
    }

    var body = '';
    if (tab === 'overview') {
      body = kpis([
        ['Producteurs rattachés', String(mesProducteurs.length), 'Farmer Registry'],
        ['Achats campagne', mt(d.byRtBuy[r.id] || 0), mesAchats.length + ' achat(s)'],
        ['Dernière activité', date(d.lastRtBuy[r.id]), 'dernier achat'],
        ['Score', rd.score != null ? rd.score + ' / 100' : '—', esc(rd.reputation || '')],
        ['Documents', String(docs.length), (recto && verso) ? 'pièce complète ✓' : 'pièce à compléter', (recto && verso) ? '' : 'warn']
      ]) + '<section class="card"><div class="card-head"><div><h2>Identité & rattachement</h2></div></div>' +
        defGrid([['Nom', r.nom], ['RT ID', r.id_rt], ['Téléphone', r.telephone],
          ['Téléphone secondaire', rd.telephoneSecondaire], ['Village', r.village_nom],
          ['Cluster', r.cluster], ['Zone', zoneOfCluster(c, r.cluster)], ['Statut', r.statut],
          ['Activité', act], ['Producteur lui-même', isProd ? 'OUI' : 'NON'],
          ['Créé le', date(rd.createdAt || r.created_at)], ['Créé par', rd.createdBy]]) + '</section>';
    } else if (tab === 'profil') {
      body = '<section class="card"><div class="card-head"><div><h2>Profil terrain</h2></div></div>' +
        defGrid([['Expérience achat RCN', rd.experienceAnnees != null ? rd.experienceAnnees + ' an(s)' : null],
          ['Producteurs mobilisables', rd.nbProducteurs],
          ['Volume potentiel', rd.volumePotentielMT != null ? num(rd.volumePotentielMT, 1) + ' MT' : null],
          ['Zone d’influence', rd.zoneInfluence], ['Disponibilité', rd.disponibilite],
          ['Moyen de déplacement', rd.deplacement], ['Instruction', rd.instruction],
          ['Smartphone', rd.smartphone ? 'Oui' : 'Non'], ['Compte bancaire', rd.compteBancaire ? 'Oui' : 'Non'],
          ['Compte Wave', rd.compteWave ? 'Oui' : 'Non'],
          ['Tonnage engagé', rd.perf && rd.perf.tonnageEngage != null ? num(rd.perf.tonnageEngage, 1) + ' MT' : null],
          ['Tonnage livré', rd.perf && rd.perf.tonnageLivre != null ? num(rd.perf.tonnageLivre, 1) + ' MT' : null],
          ['Réputation', rd.reputation], ['Observations', rd.notes]]) + '</section>';
    } else if (tab === 'producteurs') {
      body = '<section class="card">' + table(['Producteur', 'Village', 'Potentiel', 'Achats campagne', 'Dernière activité'],
        mesProducteurs.map(function (f) {
          var fa = c.achats.filter(function (a) { return a.producteur_id === f.producteur_id; });
          var kg = fa.reduce(function (s, a) { return s + n(a.poids_net); }, 0);
          return '<tr><td>' + farmerLink(f) + '</td><td>' + esc(f.village_nom || '—') + '</td>' +
            '<td>' + (f.last_purchase_kg != null ? num(f.last_purchase_kg) + ' kg' : '—') + '</td>' +
            '<td>' + mt(kg) + '</td><td>' + date(f.last_purchase_date) + '</td></tr>';
        })) + '</section>';
    } else if (tab === 'achats') {
      body = '<section class="card">' + table(['Date', 'Producteur', 'Poids net', 'Sacs', 'Montant', 'Validation', 'Stock'],
        mesAchats.map(function (a) {
          var f = c.farmers.filter(function (x) { return x.producteur_id === a.producteur_id; })[0];
          return '<tr><td>' + date(a.date) + '</td><td>' + (f ? farmerLink(f) : esc(a.producteur_nom || '—')) + '</td>' +
            '<td>' + num(a.poids_net) + ' kg</td><td>' + n(a.nb_sacs) + '</td>' +
            '<td>' + money(a.montant) + '</td><td>' + badge(a.statut_validation) + '</td>' +
            '<td>' + badge(a.stock_statut) + '</td></tr>';
        })) + '</section>';
    } else if (tab === 'sacherie') {
      return bagsData().then(function (b) {
        var stock = b.rtStock.filter(function (s) { return s.rt_id === r.id; })[0];
        var reqs = b.requests.filter(function (x) { return x.rt_id === r.id; });
        paint(headHtml(null) + tabsBar() +
          kpis([
            ['Sous responsabilité', stock ? num(stock.total_sous_responsabilite) : '0', 'sacs'],
            ['Vides', stock ? num(stock.vides) : '0', ''],
            ['Pleins', stock ? num(stock.pleins) : '0', ''],
            ['Dernier mouvement', stock ? date(stock.derniere_activite) : '—', '']
          ]) +
          '<section class="card"><div class="card-head"><div><h2>Demandes de sacs</h2></div></div>' +
          table(['Référence', 'Demandé', 'Approuvé', 'Libéré', 'Reçu', 'Statut'],
            reqs.map(function (x) {
              return '<tr><td class="mono">' + esc(x.request_code || x.id) + '</td><td>' + num(x.requested_qty) + '</td>' +
                '<td>' + num(x.approved_qty) + '</td><td>' + num(x.released_qty) + '</td>' +
                '<td>' + num(x.received_qty) + '</td><td>' + badge(x.status) + '</td></tr>';
            })) + '</section>');
      });
    } else if (tab === 'caisse') {
      return cashData().then(function (cash) {
        var av = cash.avances.filter(function (a) { return a.rt_id === r.id && a.statut !== 'Annulee'; });
        var totalAv = av.reduce(function (s, a) { return s + n(a.montant); }, 0);
        var used = mesAchats.reduce(function (s, a) { return s + n(a.montant); }, 0);
        var lastRecon = lastReconByRt(cash.recons)[r.id];
        paint(headHtml(null) + tabsBar() +
          kpis([
            ['Avances actives', money(totalAv), av.length + ' avance(s)'],
            ['Consommé en achats', money(used), ''],
            ['Solde', money(totalAv - used), '', totalAv - used < 0 ? 'danger' : ''],
            ['Caisse', lastRecon ? esc(lastRecon.statut) : 'À réconcilier', lastRecon ? date(lastRecon.created_at) : '', (!lastRecon || lastRecon.statut !== 'Réconcilié') && totalAv > 0 ? 'warn' : '']
          ]) +
          '<section class="card">' + table(['Date', 'Source', 'Montant', 'Motif', 'Cycle', 'Statut'],
            av.map(function (a) {
              return '<tr><td>' + date(a.date) + '</td><td>' + esc(a.source || '—') + '</td>' +
                '<td>' + money(a.montant) + '</td><td>' + esc(a.motif || '—') + '</td>' +
                '<td class="mono">' + esc(a.cycle_id || '—') + '</td><td>' + badge(a.cycle_statut || a.statut) + '</td></tr>';
            })) + '</section>');
      });
    } else if (tab === 'documents') {
      body = '<div class="notice info"><b>Documents privés :</b> les photos et pièces d’identité sont stockées dans un ' +
        'espace privé et consultées par lien signé temporaire — aucune adresse publique permanente.</div>' +
        '<div class="grid-2">' +
        '<section class="card"><div class="card-head"><div><h2>Photo de profil</h2></div></div>' +
        '<div id="rtPhotoBox" class="ops-doc-box">' + (photo ? '<div class="skeleton skeleton-row"></div>' : avatarHtml(null, '')) + '</div>' +
        (canEditTerrain() ? '<div class="ops-actions">' +
          '<button class="btn primary" type="button" onclick="ANAGROCI_FB.addRtDoc(\'' + esc(r.id) + '\',\'photo_profil\')">📷 ' + (photo ? 'Remplacer' : 'Prendre une photo') + '</button></div>' : '') +
        '</section>' +
        '<section class="card"><div class="card-head"><div><h2>Pièce d’identité</h2></div></div>' +
        defGrid([['Type', rd.pieceType || 'CNI'], ['Recto', recto ? 'disponible ✓' : 'manquant'],
          ['Verso', verso ? 'disponible ✓' : 'manquant'],
          ['Enregistrée le', recto ? date(recto.horodatage_client) : '—']]) +
        '<div id="rtRectoBox" class="ops-doc-box">' + (recto ? '<div class="skeleton skeleton-row"></div>' : '<span class="muted">Recto non fourni</span>') + '</div>' +
        '<div id="rtVersoBox" class="ops-doc-box">' + (verso ? '<div class="skeleton skeleton-row"></div>' : '<span class="muted">Verso non fourni</span>') + '</div>' +
        (canEditTerrain() ? '<div class="ops-actions">' +
          '<button class="btn primary" type="button" onclick="ANAGROCI_FB.addRtDoc(\'' + esc(r.id) + '\',\'piece_recto\')">📷 ' + (recto ? 'Remplacer le recto' : 'Prendre le recto') + '</button>' +
          '<button class="btn primary" type="button" onclick="ANAGROCI_FB.addRtDoc(\'' + esc(r.id) + '\',\'piece_verso\')">📷 ' + (verso ? 'Remplacer le verso' : 'Prendre le verso') + '</button></div>' : '') +
        '<div id="rtDocMsg" class="muted"></div></section></div>' +
        '<section class="card"><div class="card-head"><div><h2>Tous les documents</h2></div></div>' +
        table(['Type', 'Date', 'Chemin'], docs.map(function (x) {
          return '<tr><td>' + badge(x.type_preuve) + '</td><td>' + date(x.horodatage_client) + '</td>' +
            '<td class="mono muted">' + esc(String(x.storage_path).split('/').pop()) + '</td></tr>';
        })) + '</section>';
    } else if (tab === 'historique') {
      var evts = [];
      if (rd.createdAt) evts.push([rd.createdAt, 'Création du RT', rd.createdBy || '—']);
      (rd.historique || []).forEach(function (h) { evts.push([h.date, h.type + ' — ' + (h.note || ''), h.par || '—']); });
      docs.forEach(function (x) { evts.push([x.horodatage_client, 'Document ajouté : ' + x.type_preuve, '—']); });
      if (asFarmer) evts.push([null, 'Enrôlé comme producteur : ' + (asFarmer.farmer_id || ''), '—']);
      evts.sort(function (a, b) { return new Date(b[0] || 0) - new Date(a[0] || 0); });
      body = '<section class="card">' + table(['Date', 'Événement', 'Par'], evts.map(function (e) {
        return '<tr><td>' + date(e[0]) + '</td><td>' + esc(e[1]) + '</td><td>' + esc(e[2]) + '</td></tr>';
      })) + '</section>' +
        '<div class="notice info">Le journal détaillé (lecture Branch Manager) reste dans le registre d’audit central.</div>';
    }

    function headHtml(photoUrl) {
      return head(r.nom, 'Fiche RT 360° · consultation, modification et documents.', actions) + headerCard(photoUrl);
    }
    paint(headHtml(null) + tabsBar() + body);

    /* Chargement paresseux des images signées après le rendu. */
    if (photo) signedUrl(photo.storage_path).then(function (u) {
      var box = document.querySelector('.ops-fiche-id .ops-avatar');
      if (u && box) box.outerHTML = avatarHtml(u, 'Photo de ' + r.nom);
      var b2 = document.getElementById('rtPhotoBox');
      if (u && b2) b2.innerHTML = '<img class="ops-doc-img" alt="Photo de profil" src="' + esc(u) + '">';
    });
    if (tab === 'documents') {
      if (recto) signedUrl(recto.storage_path).then(function (u) {
        var b = document.getElementById('rtRectoBox');
        if (u && b) b.innerHTML = '<img class="ops-doc-img" alt="Pièce d’identité — recto" src="' + esc(u) + '">';
      });
      if (verso) signedUrl(verso.storage_path).then(function (u) {
        var b = document.getElementById('rtVersoBox');
        if (u && b) b.innerHTML = '<img class="ops-doc-img" alt="Pièce d’identité — verso" src="' + esc(u) + '">';
      });
    }
  });
}

/* ------------------------------- FICHE VILLAGE 360° -------------------------- */

var VILLAGE_TABS = [['overview', 'Vue d’ensemble'], ['identification', 'Identification'],
  ['organisation', 'Organisation'], ['production', 'Production'], ['concurrence', 'Concurrence'],
  ['accessibilite', 'Accessibilité'], ['paiement', 'Paiement'], ['rts', 'RT'],
  ['risques', 'Risques & Évaluation'], ['producteurs', 'Producteurs'], ['galerie', 'Galerie'],
  ['historique', 'Historique']];

function renderVillageFiche(vid, tab) {
  tab = VILLAGE_TABS.some(function (t) { return t[0] === tab; }) ? tab : 'overview';
  paint(head('Fiche Village', 'Chargement…', '<a class="btn secondary" href="#rt/villages">← Villages</a>') + skeletonPage(6));

  return Promise.all([base(), loadProfile()]).then(function (rs) {
    var c = rs[0];
    var v = c.vm[vid];
    if (!v) {
      paint(head('Fiche Village', 'Village introuvable.', '<a class="btn secondary" href="#rt/villages">← Villages</a>') +
        empty('Aucun village ne porte cet identifiant.'));
      return;
    }
    var d = derive(c);
    var vd = v.data || {};
    var s1 = vd.s1 || {}, s2 = vd.s2 || {}, s3 = vd.s3 || {}, s4 = vd.s4 || {}, s5 = vd.s5 || {},
        s6 = vd.s6 || {}, s7 = vd.s7 || {}, s8 = vd.s8 || {}, s9 = vd.s9 || {};
    var mesRts = d.rtByVillage[v.id] || [];
    var mesProducteurs = c.farmers.filter(function (f) { return f.village_id === v.id; });
    var galerie = (vd.galerie || []).filter(function (g) { return !g.archived; });

    var actions =
      (canEditTerrain() ? '<button class="btn primary" type="button" onclick="ANAGROCI_FB.openVillageForm(\'' + esc(v.id) + '\')">Modifier</button>' +
        '<button class="btn secondary" type="button" onclick="ANAGROCI_FB.addVillagePhoto(\'' + esc(v.id) + '\')">📷 Ajouter une photo</button>' : '') +
      '<a class="btn secondary" href="#villages/' + encodeURIComponent(v.id) + '/galerie">Galerie (' + galerie.length + ')</a>' +
      '<a class="btn secondary" href="#rt/villages">← Villages</a>';

    function tabsBar() {
      return '<div class="ops-passport-tabs">' + VILLAGE_TABS.map(function (x) {
        return '<a class="' + (tab === x[0] ? 'active' : '') + '" href="#villages/' + encodeURIComponent(v.id) + '/' + x[0] + '">' + esc(x[1]) + '</a>';
      }).join('') + '</div>';
    }
    function defGrid(pairs) {
      return '<div class="ops-def-grid">' + pairs.map(function (x) {
        return '<div><small>' + esc(x[0]) + '</small><b>' + esc(x[1] == null || x[1] === '' ? '—' : x[1]) + '</b></div>';
      }).join('') + '</div>';
    }
    function oui(b) { return b === true ? 'Oui' : b === false ? 'Non' : null; }

    var headHtml = head(v.village, 'Fiche Village 360° · recensement, RT, producteurs et galerie.', actions) +
      kpis([
        ['Cluster', esc(v.cluster || '—'), 'zone ' + esc(zoneOfCluster(c, v.cluster))],
        ['Statut', esc(v.statut || '—'), ''],
        ['Score', v.score != null ? v.score + ' / 100' : '—', 'évaluation s9'],
        ['Potentiel', s3.potentielMT != null ? num(s3.potentielMT, 1) + ' MT' : '—', 'sécurisé : ' + (s3.potentielSecuriseMT != null ? num(s3.potentielSecuriseMT, 1) + ' MT' : '—')],
        ['Producteurs', String(mesProducteurs.length), 'recensés'],
        ['RT', String(mesRts.length), mesRts.map(function (x) { return x.nom; }).join(', ') || 'aucun'],
        ['Acheté campagne', mt(d.byVillageBuy[v.id] || 0), ''],
        ['Photos', String(galerie.length), 'galerie de recensement']
      ]);

    var body = '';
    if (tab === 'overview') {
      body = '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Synthèse</h2></div></div>' +
        defGrid([['Village', v.village], ['Région', v.region || s1.region], ['Département', v.departement || s1.departement],
          ['Sous-préfecture', s1.sousPrefecture], ['GPS', v.gps_lat != null ? num(v.gps_lat, 5) + ', ' + num(v.gps_lng, 5) : null],
          ['Distance hub', s1.distanceHubRoutiere != null ? num(s1.distanceHubRoutiere, 1) + ' km (validée)' : (s1.distanceHub != null ? num(s1.distanceHub, 1) + ' km (saisie)' : null)],
          ['Enquêteur', s1.enqueteur], ['Date de visite', date(s1.dateVisite)],
          ['Décision', s9.decision]]) + '</section>' +
        '<section class="card"><div class="card-head"><div><h2>Accès rapide</h2></div></div><div class="quick-grid">' +
        '<a class="quick" href="#villages/' + encodeURIComponent(v.id) + '/producteurs"><b>Producteurs</b><span>' + mesProducteurs.length + ' recensés</span><em>Ouvrir →</em></a>' +
        '<a class="quick" href="#villages/' + encodeURIComponent(v.id) + '/rts"><b>RT</b><span>' + mesRts.length + ' affecté(s)</span><em>Ouvrir →</em></a>' +
        '<a class="quick" href="#villages/' + encodeURIComponent(v.id) + '/galerie"><b>Galerie</b><span>' + galerie.length + ' photo(s)</span><em>Ouvrir →</em></a>' +
        '<a class="quick" href="#hubs/' + encodeURIComponent(v.cluster || '') + '"><b>Cluster</b><span>' + esc(v.cluster || '—') + '</span><em>Ouvrir →</em></a>' +
        '</div></section></div>';
    } else if (tab === 'identification') {
      body = '<section class="card">' + defGrid([['Village', s1.village || v.village], ['Cluster', s1.cluster || v.cluster],
        ['Région', s1.region], ['Département', s1.departement], ['Sous-préfecture', s1.sousPrefecture],
        ['Latitude', s1.gpsLat], ['Longitude', s1.gpsLng],
        ['Distance hub (saisie)', s1.distanceHub != null ? num(s1.distanceHub, 1) + ' km' : null],
        ['Distance routière validée', s1.distanceHubRoutiere != null ? num(s1.distanceHubRoutiere, 1) + ' km' : null],
        ['Enquêteur', s1.enqueteur], ['Date de visite', date(s1.dateVisite)]]) + '</section>';
    } else if (tab === 'organisation') {
      body = '<section class="card">' + defGrid([
        ['Chef de village', s2.chef && s2.chef.nom], ['Chef — téléphone', s2.chef && s2.chef.telephone],
        ['Chef — influence', s2.chef && s2.chef.influence],
        ['Leader communautaire', s2.leader && s2.leader.nom], ['Leader — téléphone', s2.leader && s2.leader.telephone],
        ['Président coopérative', s2.president && s2.president.nom],
        ['Coopérative', s2.president && s2.president.cooperative]]) + '</section>';
    } else if (tab === 'production') {
      body = '<section class="card">' + defGrid([
        ['Producteurs estimés', s3.nbProducteurs], ['Production moyenne', s3.prodMoyenneKg != null ? num(s3.prodMoyenneKg) + ' kg' : null],
        ['Potentiel', s3.potentielMT != null ? num(s3.potentielMT, 1) + ' MT' : null],
        ['Potentiel sécurisé', s3.potentielSecuriseMT != null ? num(s3.potentielSecuriseMT, 1) + ' MT' : null],
        ['Période forte', s3.periodeForte]]) + '</section>';
    } else if (tab === 'concurrence') {
      body = '<section class="card"><div class="card-head"><div><h2>Acheteurs concurrents</h2></div></div>' +
        table(['Acheteur', 'Volume estimé'], (s4.acheteurs || []).map(function (a) {
          return '<tr><td><b>' + esc(a.nom) + '</b></td><td>' + (a.volumeEstime != null ? num(a.volumeEstime, 1) + ' MT' : '—') + '</td></tr>';
        })) + '</section>' +
        '<section class="card">' + defGrid([['Dominant', s4.dominant && s4.dominant.nom],
          ['Dominant — téléphone', s4.dominant && s4.dominant.telephone],
          ['Commentaires', s4.dominant && s4.dominant.commentaires]]) + '</section>';
    } else if (tab === 'accessibilite') {
      body = '<section class="card">' + defGrid([
        ['Type d’accès', s5.typeAcces], ['Note route', s5.noteRoute != null ? s5.noteRoute + ' / 10' : null],
        ['Route bitumée', oui(s5.routeBitumee)], ['Piste praticable', oui(s5.pistePraticable)],
        ['Accessible en saison des pluies', oui(s5.accessiblePluies)],
        ['Camion 10 T', oui(s5.camion10T)], ['Camion 30 T', oui(s5.camion30T)]]) + '</section>';
    } else if (tab === 'paiement') {
      var res = s6.reseau || {}, mm = s6.mobileMoney || {};
      body = '<section class="card">' + defGrid([
        ['Réseau Orange', oui(res.Orange)], ['Réseau MTN', oui(res.MTN)], ['Réseau Moov', oui(res.Moov)],
        ['Orange Money', oui(mm.OrangeMoney)], ['Wave', oui(mm.Wave)], ['MTN Money', oui(mm.MTNMoney)],
        ['Banque', s6.banque && s6.banque.nom],
        ['Distance banque', s6.banque && s6.banque.distance != null ? num(s6.banque.distance, 1) + ' km' : null],
        ['Préférence', typeof s6.preference === 'string' ? s6.preference : null]]) + '</section>';
    } else if (tab === 'rts') {
      body = '<section class="card"><div class="card-head"><div><h2>RT affectés</h2></div></div>' +
        table(['RT', 'Téléphone', 'Statut', 'Producteurs', 'Achats'], mesRts.map(function (r) {
          return '<tr><td>' + rtLink(r) + '</td><td>' + esc(r.telephone || '—') + '</td>' +
            '<td>' + badge(r.statut) + '</td><td>' + (d.farmersByRt[r.id] || 0) + '</td>' +
            '<td>' + mt(d.byRtBuy[r.id] || 0) + '</td></tr>';
        })) + '</section>' +
        '<section class="card"><div class="card-head"><div><h2>Candidats RT du recensement</h2>' +
        '<p class="muted">Photos et pièces migrées vers le stockage privé — servies par URL signée temporaire.</p></div></div>' +
        table(['Photo', 'Nom', 'Téléphone', 'Activité', 'Réputation', 'Pièce', 'Équipement'], (s7.candidats || []).map(function (x, ci) {
          /* Depuis la migration, les images vivent sous photoPath / pieceRectoPath /
             pieceVersoPath (bucket privé) — plus jamais en base64 dans le JSONB. */
          return '<tr><td>' + (x.photoPath
              ? '<span class="ops-avatar ops-avatar-mini" id="cdPhoto' + ci + '"><span class="ops-avatar-empty">👤</span></span>'
              : '<span class="ops-avatar ops-avatar-mini"><span class="ops-avatar-empty">👤</span></span>') + '</td>' +
            '<td><b>' + esc(x.nom) + '</b></td><td>' + esc(x.telephone || '—') + '</td>' +
            '<td>' + esc(x.activite || '—') + '</td><td>' + esc(x.reputation || '—') + '</td>' +
            '<td>' + [x.pieceRectoPath && 'recto ✓', x.pieceVersoPath && 'verso ✓'].filter(Boolean).join(' · ') + '</td>' +
            '<td>' + [x.smartphone && 'Smartphone', x.compteBancaire && 'Banque', x.compteWave && 'Wave']
              .filter(Boolean).join(' · ') + '</td></tr>';
        })) + '</section>';
    } else if (tab === 'risques') {
      body = '<section class="card"><div class="card-head"><div><h2>Conformité</h2></div></div>' + defGrid([
        ['Village dans la zone du cluster', oui(s8.zoneCluster)], ['Carte pisteur', oui(s8.cartePisteur)],
        ['Pas de conflit foncier', oui(s8.pasConflitFoncier)], ['Pas de conflit communautaire', oui(s8.pasConflitCommunautaire)],
        ['Risques signalés', s8.risques]]) + '</section>' +
        '<section class="card"><div class="card-head"><div><h2>Évaluation</h2></div></div>' + defGrid([
          ['Potentiel', s9.potentiel20 != null ? s9.potentiel20 + ' / 20' : null],
          ['Route', s9.route20 != null ? s9.route20 + ' / 20' : null],
          ['Disponibilité RT', s9.dispoRT20 != null ? s9.dispoRT20 + ' / 20' : null],
          ['Risque concurrentiel', s9.risqueConcurrentiel20 != null ? s9.risqueConcurrentiel20 + ' / 20' : null],
          ['Faisabilité paiement', s9.faisabilitePaiement20 != null ? s9.faisabilitePaiement20 + ' / 20' : null],
          ['Score', v.score != null ? v.score + ' / 100' : null], ['Décision', s9.decision]]) + '</section>';
    } else if (tab === 'producteurs') {
      body = '<section class="card">' + table(['Producteur', 'Téléphone', 'RT', 'Statut', 'Dernier achat'],
        mesProducteurs.map(function (f) {
          var r = c.rm[f.rt_id];
          return '<tr><td>' + farmerLink(f) + '</td><td>' + esc(f.telephone || '—') + '</td>' +
            '<td>' + (r ? rtLink(r) : '—') + '</td><td>' + badge(f.operational_status || 'Identifié') + '</td>' +
            '<td>' + date(f.last_purchase_date) + '</td></tr>';
        })) + '</section>';
    } else if (tab === 'galerie') {
      body = '<div class="notice info">Photos de recensement — recommandées, jamais bloquantes. ' +
        'Prise directe à l’appareil photo sur mobile.</div>' +
        (canEditTerrain() ? '<div class="ops-actions" style="margin-bottom:12px">' +
          '<button class="btn primary" type="button" onclick="ANAGROCI_FB.addVillagePhoto(\'' + esc(v.id) + '\')">📷 Prendre une photo</button>' +
          '</div><div id="villageGalMsg"></div>' : '') +
        (galerie.length ? '<div class="ops-gallery">' + galerie.map(function (g, i) {
          return '<figure class="ops-gallery-item">' +
            '<a href="' + esc(villagePhotoUrl(g.path)) + '" target="_blank" rel="noopener">' +
            '<img loading="lazy" alt="' + esc(g.legende || g.categorie || 'Photo du village') + '" src="' + esc(villagePhotoUrl(g.path)) + '"></a>' +
            '<figcaption><b>' + esc(g.categorie || 'Autre') + '</b><br>' + esc(g.legende || '') +
            '<br><span class="muted">' + date(g.date) + (g.agent ? ' · ' + esc(g.agent) : '') + '</span>' +
            (canEditTerrain() ? '<br><button class="btn secondary" type="button" onclick="ANAGROCI_FB.archiveVillagePhoto(\'' + esc(v.id) + '\',' + i + ')">Archiver</button>' : '') +
            '</figcaption></figure>';
        }).join('') + '</div>' : empty('Aucune photo pour ce village — ajoutez la première.'));
    } else if (tab === 'historique') {
      var evts = [];
      if (vd.createdAt) evts.push([vd.createdAt, 'Recensement du village', vd.createdBy || '—']);
      if (vd.updatedAt) evts.push([vd.updatedAt, 'Fiche modifiée', vd.updatedBy || '—']);
      (vd.galerie || []).forEach(function (g) { evts.push([g.date, 'Photo ajoutée : ' + (g.categorie || 'Autre'), g.agent || '—']); });
      evts.sort(function (a, b) { return new Date(b[0] || 0) - new Date(a[0] || 0); });
      body = '<section class="card">' + table(['Date', 'Événement', 'Par'], evts.map(function (e) {
        return '<tr><td>' + date(e[0]) + '</td><td>' + esc(e[1]) + '</td><td>' + esc(e[2]) + '</td></tr>';
      })) + '</section>';
    }

    paint(headHtml + tabsBar() + body);
    if (tab === 'rts') {
      (s7.candidats || []).forEach(function (x, ci) {
        if (!x.photoPath) return;
        signedUrl(x.photoPath).then(function (u) {
          var slot = document.getElementById('cdPhoto' + ci);
          if (u && slot) slot.innerHTML = '<img loading="lazy" alt="Photo du candidat" src="' + esc(u) + '">';
        });
      });
    }
  });
}

/* ------------------------------------------------------------------- routeur */

function paint(html) { if (root) root.innerHTML = html; }

var ROUTES = {
  overview: function () { return renderOverview(); },
  purchases: function (p) { return renderPurchases(p[1], p[2]); },
  census: function () { return renderCensus(); },
  farmers: function (p) { return renderFarmers(p[1], p[2]); },
  rt: function (p) { return renderRt(p[1], p[2]); },
  villages: function (p) { return renderVillageFiche(p[1], p[2]); },
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
  bagReview: bagReview,
  bagConsolidate: bagConsolidate,
  bagMarkExpired: bagMarkExpired,
  openBagApprove: openBagApprove,
  openBagReject: openBagReject,
  openBagRelease: openBagRelease,
  openBagReceipt: openBagReceipt,
  openBagControl: openBagControl,
  openBagLossDecision: openBagLossDecision,
  openBagProof: openBagProof,
  openBagEnvelope: openBagEnvelope,
  openBagAllocation: openBagAllocation,
  rtToFarmer: rtToFarmer,
  addRtDoc: addRtDoc,
  addVillagePhoto: addVillagePhoto,
  archiveVillagePhoto: archiveVillagePhoto,
  closeForm: closeForm,
  fillGps: fillGps,
  addAcheteur: addAcheteur,
  calcPotentiel: calcPotentiel,
  store: FBStore
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})(window);
