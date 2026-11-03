/* LBA Purchase — moteur unique du module.
   Consolide lba-purchase-v2.js et lba-purchase-ux-fix.js en une seule implémentation.

   Trois principes qui expliquent la structure du fichier :

   1. Le routeur est publié AVANT le premier appel réseau. L'ancienne version publiait
      ANAGROCI_OPS_ROUTE à la fin de son init() asynchrone : elle écrasait donc le
      routeur du patch UX chargé après elle, et le bouton « + Nouveau LBA » disparaissait.
   2. L'en-tête d'une rubrique (titre + actions) est peint immédiatement, avant les
      données. Le bouton « + Nouveau LBA » fait partie de ce premier rendu : il n'est
      jamais injecté après coup, donc jamais victime d'une course.
   3. Les données passent par LBAStore : un seul chargement de base en parallèle, mis en
      cache, réutilisé d'une rubrique à l'autre. Le reste est chargé à la demande.
*/
(function (global) {
'use strict';

/* ------------------------------------------------------------------ utilitaires */

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function n(v) { var x = Number(v || 0); return isFinite(x) ? x : 0; }
function money(v) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n(v)) + ' FCFA';
}
function num(v, d) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d == null ? 0 : d }).format(n(v));
}
function date(v) {
  if (!v) return '—';
  try { return new Intl.DateTimeFormat('fr-FR').format(new Date(v)); } catch (e) { return esc(v); }
}
function routeParts() {
  return (location.hash || '#overview').slice(1).split('/').map(function (p) {
    try { return decodeURIComponent(p); } catch (e) { return p; }
  });
}
function route() { return routeParts()[0] || 'overview'; }
function badge(s) {
  var x = String(s || '').toUpperCase();
  var c = /OVER|REFUS|BLOQ|ERREUR/.test(x) ? 'danger'
        : /APPROUV|ACTIF|AVAILABLE|CLOS|PAYE|LIBERE/.test(x) ? 'ok'
        : /ATTENT|PENDING|PARTIAL|AT_LIMIT|SOUMIS/.test(x) ? 'warn' : 'info';
  return '<span class="badge ' + c + '">' + esc(s || '—') + '</span>';
}
/* Normalisation utilisée pour l'anti-doublon côté écran. La règle qui fait foi reste
   celle de la base : ce contrôle ne fait qu'éviter un aller-retour inutile. */
function normName(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

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
/* Squelettes : au-delà de ~500 ms d'attente, l'écran doit montrer qu'il travaille. */
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
function skeletonPage(kpiCount) { return skeletonKpis(kpiCount) + skeletonRows(6); }

/* Le bouton de création. Rendu dans l'en-tête, jamais injecté après le rendu. */
function createButton() {
  return '<button class="btn primary ops-cta-create" id="newLbaBtn" type="button" ' +
    'onclick="ANAGROCI_LBA.openCreate()">+ Nouveau LBA</button>';
}

/* ------------------------------------------------------------ client et identité */

var root = null;
var sb = null;
var profile = {};
var clientPromise = null;

function makeClient() {
  if (sb) return sb;
  if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) {
    sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON);
  }
  return sb;
}
/* auth-gate.js publie l'URL et la clé de façon asynchrone : on attend, mais sans
   bloquer le premier rendu de l'écran. */
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

var ROLES_CREATE = ['Procurement Officer', 'Supervisor', 'Branch Manager',
  'Assistant Branch Manager', 'Coordination', 'Administrateur'];
var ROLES_APPROVE = ['Branch Manager', 'Assistant Branch Manager', 'Coordination', 'Administrateur'];

function canCreate() { return ROLES_CREATE.indexOf(profile.role) >= 0; }
function canApprove() { return ROLES_APPROVE.indexOf(profile.role) >= 0; }

var profilePromise = null;
function loadProfile() {
  if (profilePromise) return profilePromise;
  profilePromise = client().then(function (c) {
    if (!c) return null;
    return c.auth.getSession().then(function (s) {
      var u = s.data && s.data.session && s.data.session.user;
      if (!u) return null;
      return c.from('profils').select('nom,role,actif').eq('user_id', u.id).maybeSingle()
        .then(function (r) { if (!r.error && r.data) profile = r.data; return profile; });
    });
  }).catch(function () { return null; });
  return profilePromise;
}

/* ------------------------------------------------------------------- LBAStore */
/* Cache mémoire à durée de vie courte, partagé par toutes les rubriques.
   Deux appels concurrents sur la même clé partagent la même requête. */

var TTL = 45000;
var store = Object.create(null);

var LBAStore = {
  get: function (key, loader, ttl) {
    var life = ttl || TTL;
    var slot = store[key];
    var now = Date.now();
    if (slot && slot.data !== undefined && (now - slot.at) < life) return Promise.resolve(slot.data);
    if (slot && slot.promise) return slot.promise;
    var p = Promise.resolve().then(loader).then(function (data) {
      store[key] = { data: data, at: Date.now() };
      return data;
    }).catch(function (e) { delete store[key]; throw e; });
    store[key] = { promise: p, at: now };
    return p;
  },
  /* Invalidation ciblée : on ne vide jamais tout le cache pour une seule écriture. */
  invalidate: function () {
    [].slice.call(arguments).forEach(function (k) { delete store[k]; });
  },
  clear: function () { store = Object.create(null); },
  has: function (key) {
    var s = store[key];
    return !!(s && s.data !== undefined && (Date.now() - s.at) < TTL);
  }
};

function q(tableName, cols, limit) {
  return client().then(function (c) {
    if (!c) return [];
    var req = c.from(tableName).select(cols || '*');
    if (limit) req = req.limit(limit);
    return req.then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return r.data || [];
    });
  });
}

/* Données de base : un seul aller-retour parallèle, réutilisé par la plupart des
   rubriques (vue d'ensemble, registry, balances, performance, sacherie…). */
function base() {
  return LBAStore.get('base', function () {
    return Promise.all([
      q('lba_funding_capacity_v', '*', 200),
      q('rcn_fournisseurs', 'code,nom,categorie,statut,contrat,origines,sites,volume_livre_kg,sacs_livres,nb_livraisons,kor_moyen,humidite_moyenne,premiere_livraison,derniere_livraison', 400),
      q('rcn_jute_v_supplier_profile', 'supplier_code,balance,issued,returned,bucket_90_plus,return_rate,last_movement', 400),
      q('lba_funding_cycle_status_v', '*', 300)
    ]).then(function (rs) {
      var caps = rs[0];
      var lbas = rs[1].filter(function (x) {
        return x.categorie === 'LBA' || String(x.code || '').indexOf('LBA-') === 0;
      });
      var bags = rs[2], cycles = rs[3], cm = {}, bm = {};
      caps.forEach(function (x) { cm[x.lba_code] = x; });
      bags.forEach(function (x) { bm[x.supplier_code] = x; });
      lbas.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
      return { caps: caps, lbas: lbas, bags: bags, cycles: cycles, cm: cm, bm: bm };
    });
  });
}

/* Chargements à la demande — jamais au démarrage. */
function financings() {
  return LBAStore.get('fin', function () {
    return q('rcn_proc_financements', 'id,supplier_code,montant,statut,echeance,payload,created_at,updated_at', 500);
  });
}
function deliveries() {
  return LBAStore.get('arr', function () {
    return q('rcn_proc_arrivages', 'id,supplier_code,statut,prevu_at,reception_id,payload,created_at', 500);
  });
}
function limitHistory() {
  return LBAStore.get('limits', function () {
    return q('lba_funding_limit_history', 'id,lba_code,approved_limit,status,effective_from,effective_to,approved_by,reason,created_at,supersedes_id,document_url', 500);
  });
}
function auditRows() {
  return LBAStore.get('audit', function () {
    return q('lba_funding_limit_audit', 'id,limit_id,lba_code,action,actor_id,changed_at,old_row,new_row', 400);
  });
}
/* Achats RCN : les dossiers d'achat, plus les réceptions pour connaître le site. */
function purchases() {
  return LBAStore.get('purchases', function () {
    return Promise.all([
      q('rcn_proc_validations_achat', 'id,reception_id,supplier_code,supplier_name,poids_net_kg,refraction_kg,poids_paye_kg,prix_negocie,prix_soumis_bm,montant_soumis,prix_approuve_gm,montant_approuve,kor_sampling,kor_final,humidite_finale,statut,submitted_at,decided_at', 800),
      q('rcn_receptions', 'id,site_code,warehouse_code,origine,camion,arrivee_at', 800)
    ]).then(function (rs) {
      var rows = rs[0].filter(function (x) { return String(x.supplier_code || '').indexOf('LBA-') === 0; });
      var rm = {};
      rs[1].forEach(function (r) { rm[r.id] = r; });
      rows.sort(function (a, b) {
        return new Date(b.submitted_at || b.decided_at || 0) - new Date(a.submitted_at || a.decided_at || 0);
      });
      return { rows: rows, receptions: rm };
    });
  });
}

/* Valeurs consolidées d'un dossier d'achat : le prix approuvé prime sur le prix soumis. */
function buyPrice(x) { return n(x.prix_approuve_gm || x.prix_soumis_bm || x.prix_negocie); }
function buyAmount(x) {
  var a = n(x.montant_approuve || x.montant_soumis);
  return a || (buyPrice(x) * n(x.poids_paye_kg));
}
function buySite(x, rm) {
  var r = rm[x.reception_id];
  if (!r) return '—';
  return r.warehouse_code || r.site_code || r.origine || '—';
}

/* --------------------------------------------------------- rubriques (rendus) */

function renderOverview() {
  paint(head('Vue d’ensemble',
    'Portefeuille LBA : financement, achats RCN, livraisons et sacherie dans un seul écran.',
    createButton()) + createHost() + skeletonPage(5));

  return base().then(function (c) {
    var active = c.lbas.filter(function (x) { return x.statut === 'ACTIF'; }).length;
    var totalLimit = c.caps.reduce(function (t, x) { return t + n(x.approved_limit); }, 0);
    var exp = c.caps.reduce(function (t, x) { return t + n(x.current_exposure); }, 0);
    var avail = c.caps.reduce(function (t, x) { return t + n(x.available_capacity); }, 0);
    var over = c.caps.filter(function (x) { return x.capacity_status === 'OVER_LIMIT'; }).length;

    paint(head('Vue d’ensemble',
      'Portefeuille LBA : financement, achats RCN, livraisons et sacherie dans un seul écran.',
      createButton()) + createHost() +
      kpis([
        ['LBA actifs', String(active), c.lbas.length + ' au référentiel'],
        ['Limites approuvées', money(totalLimit), 'limites en vigueur'],
        ['Exposition actuelle', money(exp), 'financement non couvert'],
        ['Capacité disponible', money(avail), 'selon les limites en vigueur'],
        ['LBA au-delà de leur limite', String(over), over ? 'nouveau financement bloqué' : 'aucun', over ? 'danger' : '']
      ]) +
      '<div class="grid-2"><section class="card"><div class="card-head"><div><h2>Portefeuille LBA</h2>' +
      '<p>Limite, exposition, capacité disponible et sacs détenus.</p></div></div>' +
      table(['LBA', 'Limite', 'Exposition', 'Disponible', 'Sacs', 'Statut'],
        c.lbas.slice(0, 40).map(function (x) {
          var z = c.cm[x.code] || {}, b = c.bm[x.code] || {};
          return '<tr class="ops-click" onclick="location.hash=\'#registry/' + encodeURIComponent(x.code) + '\'">' +
            '<td><b>' + esc(x.code) + '</b><br><span class="muted">' + esc(x.nom) + '</span></td>' +
            '<td>' + (z.approved_limit == null ? 'Aucune limite' : money(z.approved_limit)) + '</td>' +
            '<td>' + money(z.current_exposure || 0) + '</td>' +
            '<td>' + (z.available_capacity == null ? '—' : money(z.available_capacity)) + '</td>' +
            '<td>' + n(b.balance) + '</td><td>' + badge(z.capacity_status || 'SANS LIMITE') + '</td></tr>';
        })) +
      '</section><section class="card"><div class="card-head"><div><h2>Accès rapide</h2>' +
      '<p>Tout reste dans LBA Purchase.</p></div></div><div class="quick-grid">' +
      '<a class="quick" href="#registry"><b>LBA Registry</b><span>Référentiel et passeport de chaque LBA.</span><em>Ouvrir →</em></a>' +
      '<a class="quick" href="#purchases"><b>Achats RCN</b><span>Ce que chaque LBA a acheté.</span><em>Ouvrir →</em></a>' +
      '<a class="quick" href="#limits"><b>Limites de financement</b><span>Créer et historiser les limites.</span><em>Ouvrir →</em></a>' +
      '<a class="quick" href="#deliveries"><b>Livraisons RCN</b><span>Camions, réceptions et destinations.</span><em>Ouvrir →</em></a>' +
      '</div></section></div>');
  });
}

function renderRegistry(code) {
  if (code) return renderPassport(code);

  paint(head('LBA Registry', 'Référentiel des LBA et accès au LBA Passport.', createButton()) +
    createHost() + skeletonRows(8));

  return base().then(function (c) {
    paint(head('LBA Registry', 'Référentiel des LBA et accès au LBA Passport.', createButton()) +
      createHost() +
      '<section class="card"><div class="card-head"><div><h2>' + c.lbas.length + ' LBA au référentiel</h2>' +
      '<p>Cliquez sur une ligne pour ouvrir le LBA Passport.</p></div></div>' +
      table(['Code', 'Nom', 'Statut', 'RCN livré', 'Limite', 'Exposition', 'Disponible', 'Sacs'],
        c.lbas.map(function (x) {
          var z = c.cm[x.code] || {}, b = c.bm[x.code] || {};
          return '<tr class="ops-click" onclick="location.hash=\'#registry/' + encodeURIComponent(x.code) + '\'">' +
            '<td><b>' + esc(x.code) + '</b></td><td>' + esc(x.nom) + '</td><td>' + badge(x.statut) + '</td>' +
            '<td>' + num(n(x.volume_livre_kg) / 1000, 1) + ' MT</td>' +
            '<td>' + (z.approved_limit == null ? 'Aucune limite' : money(z.approved_limit)) + '</td>' +
            '<td>' + money(z.current_exposure || 0) + '</td>' +
            '<td>' + (z.available_capacity == null ? '—' : money(z.available_capacity)) + '</td>' +
            '<td>' + n(b.balance) + '</td></tr>';
        })) + '</section>');
  });
}

/* LBA Passport — identité, indicateurs, et les achats RCN du LBA. */
function renderPassport(code) {
  paint(head(code, 'LBA Passport', '<a class="btn secondary" href="#registry">← Registry</a>') + skeletonPage(8));

  return Promise.all([base(), purchases()]).then(function (rs) {
    var c = rs[0], pu = rs[1];
    var x = c.lbas.filter(function (a) { return a.code === code; })[0];
    if (!x) {
      paint(head('LBA Passport', 'LBA introuvable.', '<a class="btn secondary" href="#registry">← Registry</a>') +
        empty('Aucun LBA ne porte le code ' + code + '.'));
      return;
    }
    var z = c.cm[code] || {}, b = c.bm[code] || {};
    var cy = c.cycles.filter(function (a) { return a.lba_code === code && a.status === 'OPEN'; })[0];
    var mine = pu.rows.filter(function (r) { return r.supplier_code === code; });
    var buyKg = mine.reduce(function (t, r) { return t + n(r.poids_paye_kg); }, 0);
    var buyVal = mine.reduce(function (t, r) { return t + buyAmount(r); }, 0);
    var lastAct = [x.derniere_livraison, b.last_movement, mine[0] && mine[0].submitted_at]
      .filter(Boolean).sort(function (a, d) { return new Date(d) - new Date(a); })[0];

    paint(head(code + ' · ' + x.nom, 'LBA Passport · identité, financement, achats, livraisons et sacherie.',
      '<a class="btn secondary" href="#purchases/' + encodeURIComponent(code) + '">Achats RCN</a>' +
      '<a class="btn secondary" href="#registry">← Registry</a>') +

      '<section class="card"><div class="card-head"><div><h2>Identité</h2></div></div>' +
      '<div class="ops-def-grid">' +
      [['Code', x.code], ['Nom', x.nom], ['Statut', String(x.statut || '—')],
       ['Zone / origine', (x.origines || []).join(', ') || '—'],
       ['Site habituel', (x.sites || []).join(', ') || '—'],
       ['Contrat', x.contrat ? 'Disponible' : 'Non renseigné'],
       ['Première livraison', date(x.premiere_livraison)],
       ['Dernière activité', date(lastAct)]].map(function (d) {
        return '<div><small>' + esc(d[0]) + '</small><b>' + esc(d[1]) + '</b></div>';
      }).join('') + '</div></section>' +

      kpis([
        ['Limite de financement', z.approved_limit == null ? 'Aucune limite' : money(z.approved_limit), 'limite en vigueur'],
        ['Exposition actuelle', money(z.current_exposure || 0), 'financement non couvert'],
        ['Capacité disponible', z.approved_limit == null ? '—' : money(z.available_capacity || 0), z.capacity_status || 'SANS LIMITE'],
        ['Volume RCN livré', num(n(x.volume_livre_kg) / 1000, 1) + ' MT', n(x.nb_livraisons) + ' livraison(s)'],
        ['Achats RCN', num(buyKg / 1000, 1) + ' MT', mine.length + ' dossier(s)'],
        ['Valeur des achats', money(buyVal), 'tous statuts'],
        ['Balance sacs', String(n(b.balance)), n(b.bucket_90_plus) + ' à 90 j et plus'],
        ['Cycle en cours', cy ? String(cy.cycle_code) : 'Aucun', cy ? 'ouvert' : '—']
      ]) +

      '<div class="grid-2"><section class="card"><h2>Financement</h2><div class="cbody">' +
      '<p><b>Utilisation :</b> ' + (z.utilization_pct == null ? '—' : num(z.utilization_pct, 1) + ' %') + '</p>' +
      '<div class="ops-progress ' + (z.capacity_status === 'OVER_LIMIT' ? 'over' : '') + '">' +
      '<i style="width:' + Math.min(100, n(z.utilization_pct)) + '%"></i></div>' +
      '<p class="muted">Prochaine limite : ' +
      (z.next_limit ? money(z.next_limit) + ' le ' + date(z.next_limit_from) : 'aucune programmée') + '</p>' +
      '</div></section><section class="card"><h2>Qualité et livraisons</h2>' +
      '<p>Dernière livraison : <b>' + date(x.derniere_livraison) + '</b></p>' +
      '<p>KOR moyen : <b>' + (x.kor_moyen == null ? '—' : esc(x.kor_moyen)) + '</b> · Humidité moyenne : <b>' +
      (x.humidite_moyenne == null ? '—' : esc(x.humidite_moyenne) + ' %') + '</b></p>' +
      '<p>Sacs livrés : <b>' + num(x.sacs_livres) + '</b></p></section></div>' +

      '<section class="card"><div class="card-head"><div><h2>Derniers achats RCN</h2>' +
      '<p>Volet commercial : poids payé, prix et montant.</p></div>' +
      '<div class="ops-route-actions"><a class="btn secondary" href="#purchases/' +
      encodeURIComponent(code) + '">Tout voir</a></div></div>' +
      table(['Date', 'Réception', 'Poids payé', 'Prix', 'Montant', 'Statut'],
        mine.slice(0, 10).map(function (r) {
          return '<tr><td>' + date(r.submitted_at) + '</td><td class="mono">' + esc(r.reception_id || '—') + '</td>' +
            '<td>' + num(r.poids_paye_kg) + ' kg</td><td>' + num(buyPrice(r)) + ' / kg</td>' +
            '<td>' + money(buyAmount(r)) + '</td><td>' + badge(r.statut) + '</td></tr>';
        })) + '</section>');
  });
}

/* Achats RCN — volet commercial et financier, distinct des Livraisons RCN. */
var purchaseState = { lba: '', from: '', to: '', statut: '', site: '' };

function renderPurchases(preselect) {
  if (preselect) purchaseState.lba = preselect;

  paint(head('Achats RCN',
    'Ce que les LBA ont acheté : poids payé, prix, montant et validation. Le volet physique (camion, réception, entrepôt) est dans Livraisons RCN.',
    '<a class="btn secondary" href="#deliveries">Voir les livraisons RCN</a>') + skeletonPage(6));

  return Promise.all([base(), purchases()]).then(function (rs) {
    var c = rs[0], pu = rs[1];
    var names = {};
    c.lbas.forEach(function (x) { names[x.code] = x.nom; });

    var sites = {};
    pu.rows.forEach(function (r) { var s = buySite(r, pu.receptions); if (s !== '—') sites[s] = 1; });
    var statuts = {};
    pu.rows.forEach(function (r) { if (r.statut) statuts[r.statut] = 1; });

    function opts(list, sel) {
      return list.map(function (v) {
        return '<option value="' + esc(v[0]) + '"' + (sel === v[0] ? ' selected' : '') + '>' + esc(v[1]) + '</option>';
      }).join('');
    }

    paint(head('Achats RCN',
      'Ce que les LBA ont acheté : poids payé, prix, montant et validation. Le volet physique (camion, réception, entrepôt) est dans Livraisons RCN.',
      '<a class="btn secondary" href="#deliveries">Voir les livraisons RCN</a>') +
      '<div id="purchaseKpis">' + skeletonKpis(6) + '</div>' +
      '<section class="card"><div class="card-head"><div><h2>Filtres</h2>' +
      '<p>Le tableau et les indicateurs suivent les filtres.</p></div></div>' +
      '<div class="ops-form-grid">' +
      '<div class="ops-field"><label for="pfLba">LBA</label><select id="pfLba"><option value="">Tous les LBA</option>' +
      opts(c.lbas.map(function (x) { return [x.code, x.code + ' · ' + x.nom]; }), purchaseState.lba) + '</select></div>' +
      '<div class="ops-field"><label for="pfFrom">Du</label><input id="pfFrom" type="date" value="' + esc(purchaseState.from) + '"></div>' +
      '<div class="ops-field"><label for="pfTo">Au</label><input id="pfTo" type="date" value="' + esc(purchaseState.to) + '"></div>' +
      '<div class="ops-field"><label for="pfStatut">Statut</label><select id="pfStatut"><option value="">Tous les statuts</option>' +
      opts(Object.keys(statuts).sort().map(function (s) { return [s, s]; }), purchaseState.statut) + '</select></div>' +
      '<div class="ops-field"><label for="pfSite">Site / destination</label><select id="pfSite"><option value="">Tous les sites</option>' +
      opts(Object.keys(sites).sort().map(function (s) { return [s, s]; }), purchaseState.site) + '</select></div>' +
      '<div class="ops-field"><label>&nbsp;</label><button class="btn secondary" type="button" id="pfReset">Réinitialiser</button></div>' +
      '</div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Dossiers d’achat</h2>' +
      '<p>Un dossier par validation d’achat.</p></div></div><div id="purchaseTable"></div></section>');

    function apply() {
      var list = pu.rows.filter(function (r) {
        if (purchaseState.lba && r.supplier_code !== purchaseState.lba) return false;
        if (purchaseState.statut && r.statut !== purchaseState.statut) return false;
        if (purchaseState.site && buySite(r, pu.receptions) !== purchaseState.site) return false;
        var d = r.submitted_at || r.decided_at;
        if (purchaseState.from && (!d || new Date(d) < new Date(purchaseState.from))) return false;
        if (purchaseState.to && (!d || new Date(d) > new Date(purchaseState.to + 'T23:59:59'))) return false;
        return true;
      });

      var kg = list.reduce(function (t, r) { return t + n(r.poids_paye_kg); }, 0);
      var val = list.reduce(function (t, r) { return t + buyAmount(r); }, 0);
      /* Prix moyen pondéré par le poids payé, pas une moyenne des prix unitaires. */
      var avgPrice = kg > 0 ? val / kg : 0;
      var korRows = list.filter(function (r) { return r.kor_final != null || r.kor_sampling != null; });
      var kor = korRows.length
        ? korRows.reduce(function (t, r) { return t + n(r.kor_final != null ? r.kor_final : r.kor_sampling); }, 0) / korRows.length : null;
      var humRows = list.filter(function (r) { return r.humidite_finale != null; });
      var hum = humRows.length
        ? humRows.reduce(function (t, r) { return t + n(r.humidite_finale); }, 0) / humRows.length : null;

      document.getElementById('purchaseKpis').innerHTML = kpis([
        ['Nombre d’achats', num(list.length), 'dossiers'],
        ['Volume acheté', num(kg / 1000, 1) + ' MT', num(kg) + ' kg payés'],
        ['Valeur', money(val), 'montant retenu'],
        ['Prix moyen pondéré', kg > 0 ? num(avgPrice, 1) + ' FCFA / kg' : '—', 'pondéré par le poids payé'],
        ['KOR moyen', kor == null ? '—' : num(kor, 2), korRows.length + ' mesure(s)'],
        ['Humidité moyenne', hum == null ? '—' : num(hum, 1) + ' %', humRows.length + ' mesure(s)']
      ]);

      document.getElementById('purchaseTable').innerHTML = table(
        ['Date', 'LBA', 'Nom du LBA', 'Réception', 'Poids net', 'Poids payé', 'Prix', 'Montant', 'KOR', 'Humidité', 'Statut', 'Site / destination'],
        list.map(function (r) {
          var k = r.kor_final != null ? r.kor_final : r.kor_sampling;
          return '<tr><td>' + date(r.submitted_at || r.decided_at) + '</td>' +
            '<td><b>' + esc(r.supplier_code) + '</b></td>' +
            '<td>' + esc(r.supplier_name || names[r.supplier_code] || '—') + '</td>' +
            '<td class="mono">' + esc(r.reception_id || '—') + '</td>' +
            '<td>' + (r.poids_net_kg == null ? '—' : num(r.poids_net_kg) + ' kg') + '</td>' +
            '<td>' + num(r.poids_paye_kg) + ' kg</td>' +
            '<td>' + num(buyPrice(r)) + ' / kg</td>' +
            '<td>' + money(buyAmount(r)) + '</td>' +
            '<td>' + (k == null ? '—' : num(k, 2)) + '</td>' +
            '<td>' + (r.humidite_finale == null ? '—' : num(r.humidite_finale, 1) + ' %') + '</td>' +
            '<td>' + badge(r.statut) + '</td>' +
            '<td>' + esc(buySite(r, pu.receptions)) + '</td></tr>';
        }));
    }

    function bind(id, key) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () { purchaseState[key] = this.value; apply(); });
    }
    bind('pfLba', 'lba'); bind('pfFrom', 'from'); bind('pfTo', 'to');
    bind('pfStatut', 'statut'); bind('pfSite', 'site');
    var reset = document.getElementById('pfReset');
    if (reset) reset.addEventListener('click', function () {
      purchaseState = { lba: '', from: '', to: '', statut: '', site: '' };
      renderPurchases();
    });
    apply();
  });
}

function renderLimits() {
  var actions = '<button class="btn primary" type="button" onclick="ANAGROCI_LBA.toggleLimitForm()">+ Nouvelle limite</button>';
  paint(head('Limites de financement',
    'Limites évolutives et historisées. Une seule limite approuvée peut être en vigueur à une date donnée.',
    actions) + skeletonPage(5));

  return Promise.all([base(), limitHistory()]).then(function (rs) {
    var c = rs[0];
    var limits = rs[1].slice().sort(function (a, b) {
      return new Date(b.effective_from) - new Date(a.effective_from);
    });
    var options = c.lbas.map(function (x) {
      return '<option value="' + esc(x.code) + '">' + esc(x.code + ' · ' + x.nom) + '</option>';
    }).join('');
    var over = c.caps.filter(function (x) { return x.capacity_status === 'OVER_LIMIT'; }).length;

    paint(head('Limites de financement',
      'Limites évolutives et historisées. Une seule limite approuvée peut être en vigueur à une date donnée.',
      actions) +
      kpis([
        ['LBA avec une limite', String(c.caps.filter(function (x) { return x.approved_limit != null; }).length), 'sur ' + c.lbas.length],
        ['Total des limites', money(c.caps.reduce(function (t, x) { return t + n(x.approved_limit); }, 0)), 'limites en vigueur'],
        ['Exposition', money(c.caps.reduce(function (t, x) { return t + n(x.current_exposure); }, 0)), 'actuelle'],
        ['Disponible', money(c.caps.reduce(function (t, x) { return t + n(x.available_capacity); }, 0)), 'capacité restante'],
        ['Au-delà de la limite', String(over), over ? 'nouveau financement bloqué' : 'aucun', over ? 'danger' : '']
      ]) +
      '<section class="ops-form-card" id="limitForm" hidden><h3>Nouvelle limite approuvée</h3>' +
      '<p class="muted">La nouvelle limite conserve l’historique. Le motif est obligatoire.</p>' +
      '<form id="limitCreate"><div class="ops-form-grid">' +
      '<div class="ops-field"><label for="fl_lba">LBA</label><select id="fl_lba" required>' + options + '</select></div>' +
      '<div class="ops-field"><label for="fl_amount">Montant FCFA</label><input id="fl_amount" type="number" min="1" step="1" required></div>' +
      '<div class="ops-field"><label for="fl_from">Date d’effet</label><input id="fl_from" type="date" required></div>' +
      '<div class="ops-field"><label for="fl_to">Date de fin (facultatif)</label><input id="fl_to" type="date"></div>' +
      '<div class="ops-field ops-span-2"><label for="fl_reason">Motif</label><textarea id="fl_reason" required></textarea></div>' +
      '<div class="ops-field"><label for="fl_doc">Lien du document (facultatif)</label><input id="fl_doc" type="url"></div>' +
      '</div><div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit">Enregistrer la limite</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_LBA.toggleLimitForm(false)">Annuler</button></div>' +
      '<div id="limitMsg" class="muted" style="margin-top:10px"></div></form></section>' +
      '<section class="card" style="margin-top:14px"><div class="card-head"><div><h2>Capacité actuelle par LBA</h2>' +
      '<p>Aucune limite fictive n’est créée : « Aucune limite » signifie qu’aucune limite n’a été définie.</p></div></div>' +
      table(['LBA', 'Limite', 'Exposition', 'Disponible', 'Utilisation', 'En vigueur depuis', 'Prochain changement', 'Statut'],
        c.caps.map(function (x) {
          return '<tr><td><b>' + esc(x.lba_code) + '</b><br><span class="muted">' + esc(x.lba_name) + '</span></td>' +
            '<td>' + (x.approved_limit == null ? 'Aucune limite' : money(x.approved_limit)) + '</td>' +
            '<td>' + money(x.current_exposure) + '</td>' +
            '<td>' + (x.available_capacity == null ? '—' : money(x.available_capacity)) + '</td>' +
            '<td>' + (x.utilization_pct == null ? '—' : num(x.utilization_pct, 1) + ' %') + '</td>' +
            '<td>' + date(x.effective_from) + '</td>' +
            '<td>' + (x.next_limit ? money(x.next_limit) + ' · ' + date(x.next_limit_from) : '—') + '</td>' +
            '<td>' + badge(x.capacity_status) + '</td></tr>';
        })) + '</section>' +
      '<section class="card"><div class="card-head"><div><h2>Historique</h2>' +
      '<p>Une nouvelle limite ne remplace jamais silencieusement le passé.</p></div></div>' +
      table(['LBA', 'Limite', 'Du', 'Au', 'Statut', 'Motif'], limits.map(function (x) {
        return '<tr><td><b>' + esc(x.lba_code) + '</b></td><td>' + money(x.approved_limit) + '</td>' +
          '<td>' + date(x.effective_from) + '</td><td>' + date(x.effective_to) + '</td>' +
          '<td>' + badge(x.status) + '</td><td>' + esc(x.reason || '—') + '</td></tr>';
      })) + '</section>');

    bindLimitForm();
  });
}

function toggleLimitForm(force) {
  var e = document.getElementById('limitForm');
  if (!e) return;
  e.hidden = force === false ? true : !e.hidden;
  if (!e.hidden) { var f = document.getElementById('fl_lba'); if (f) f.focus(); }
}

function bindLimitForm() {
  var f = document.getElementById('limitCreate');
  if (!f || f.dataset.bound) return;
  f.dataset.bound = '1';
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = document.getElementById('limitMsg');
    msg.className = 'muted';
    msg.textContent = 'Enregistrement…';
    var args = {
      p_lba_code: document.getElementById('fl_lba').value,
      p_approved_limit: Number(document.getElementById('fl_amount').value),
      p_effective_from: document.getElementById('fl_from').value,
      p_effective_to: document.getElementById('fl_to').value || null,
      p_reason: document.getElementById('fl_reason').value,
      p_document_url: document.getElementById('fl_doc').value || null
    };
    client().then(function (c) { return c.rpc('lba_create_funding_limit', args); }).then(function (r) {
      if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
      msg.className = 'ops-ok-text';
      msg.textContent = 'Limite enregistrée.';
      LBAStore.invalidate('base', 'limits', 'audit');
      setTimeout(render, 400);
    });
  });
}

function renderFinancing() {
  paint(head('Financements',
    'Une demande peut être préparée même si la capacité est insuffisante ; son approbation reste contrôlée.') +
    skeletonPage(4));

  return Promise.all([base(), financings(), loadProfile()]).then(function (rs) {
    var c = rs[0], fin = rs[1];
    var options = c.lbas.map(function (x) {
      return '<option value="' + esc(x.code) + '">' + esc(x.code + ' · ' + x.nom) + '</option>';
    }).join('');

    paint(head('Financements',
      'Une demande peut être préparée même si la capacité est insuffisante ; son approbation reste contrôlée.') +
      '<div class="grid-2"><section class="ops-form-card"><h3>Nouveau financement</h3>' +
      '<form id="financeCreate"><div class="ops-form-grid">' +
      '<div class="ops-field"><label for="fi_lba">LBA</label><select id="fi_lba" required><option value="">Choisir…</option>' + options + '</select></div>' +
      '<div class="ops-field"><label for="fi_amount">Montant FCFA</label><input id="fi_amount" type="number" min="1" required></div>' +
      '<div class="ops-field"><label for="fi_date">Date de décaissement</label><input id="fi_date" type="date"></div>' +
      '<div class="ops-field"><label for="fi_bank">Banque</label><input id="fi_bank"></div>' +
      '<div class="ops-field"><label for="fi_ref">Référence</label><input id="fi_ref"></div>' +
      '<div class="ops-field"><label for="fi_due">Échéance</label><input id="fi_due" type="date"></div>' +
      '<div class="ops-field ops-span-2"><label for="fi_note">Commentaire</label><textarea id="fi_note"></textarea></div>' +
      '</div><div id="financePreview" class="ops-fin-preview"></div>' +
      '<div class="ops-actions" style="margin-top:12px"><button class="btn primary" type="submit">Créer la demande</button></div>' +
      '<div id="financeMsg" class="muted" style="margin-top:10px"></div></form></section>' +
      '<section class="card"><h2>Règle de capacité</h2>' +
      '<p>Une demande peut être préparée au-delà de la capacité, mais son approbation est refusée si :</p>' +
      '<div class="notice info">aucune limite n’est en vigueur, ou exposition actuelle + montant demandé dépasse la limite en vigueur.</div>' +
      '<p class="muted">Ce contrôle est appliqué au moment de l’approbation, pas seulement à l’écran.</p></section></div>' +
      '<section class="card"><div class="card-head"><div><h2>Financements</h2>' +
      '<p>L’approbation reste soumise à la limite du LBA.</p></div></div>' +
      table(['Référence', 'LBA', 'Montant', 'Statut', 'Échéance', 'Action'], fin.map(function (x) {
        var action;
        if (x.statut === 'À_APPROUVER' && canApprove()) {
          action = '<button class="btn primary" onclick="ANAGROCI_LBA.approveFin(\'' + esc(x.id) + '\',true)">Approuver</button> ' +
            '<button class="btn secondary" onclick="ANAGROCI_LBA.approveFin(\'' + esc(x.id) + '\',false)">Refuser</button>';
        } else action = badge(x.statut);
        return '<tr><td class="mono">' + esc(x.id) + '</td><td>' + esc(x.supplier_code || '—') + '</td>' +
          '<td>' + money(x.montant) + '</td><td>' + badge(x.statut) + '</td>' +
          '<td>' + date(x.echeance) + '</td><td>' + action + '</td></tr>';
      })) + '</section>');

    bindFinance(c);
  });
}

function bindFinance(c) {
  var sel = document.getElementById('fi_lba');
  var amt = document.getElementById('fi_amount');
  var form = document.getElementById('financeCreate');
  if (!form) return;

  function preview() {
    var z = c.cm[sel.value] || {}, a = n(amt.value);
    var limit = z.approved_limit, exp = n(z.current_exposure), after = exp + a;
    var over = limit == null ? null : Math.max(0, after - n(limit));
    document.getElementById('financePreview').innerHTML = [
      ['Limite', limit == null ? 'Aucune limite' : money(limit)],
      ['Exposition', money(exp)],
      ['Demandé', money(a)],
      ['Après financement', money(after)],
      ['Décision', limit == null ? 'REFUSÉ : aucune limite' : over > 0 ? 'REFUSÉ : dépassement de ' + money(over) : 'ÉLIGIBLE']
    ].map(function (x) {
      return '<div><small>' + esc(x[0]) + '</small><b class="' +
        (/REFUS/.test(x[1]) ? 'ops-danger-text' : '') + '">' + esc(x[1]) + '</b></div>';
    }).join('');
  }
  if (sel) sel.addEventListener('change', preview);
  if (amt) amt.addEventListener('input', preview);
  preview();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = document.getElementById('financeMsg');
    var code = sel.value, amount = n(amt.value);
    if (!code || amount <= 0) return;
    var id = 'FIN-' + new Date().getFullYear() + '-' + Date.now().toString(36).toUpperCase();
    var payload = {
      banque: document.getElementById('fi_bank').value,
      reference: document.getElementById('fi_ref').value,
      decaisseAt: document.getElementById('fi_date').value || new Date().toISOString(),
      commentaire: document.getElementById('fi_note').value
    };
    msg.className = 'muted';
    msg.textContent = 'Enregistrement…';
    client().then(function (c2) {
      return c2.from('rcn_proc_financements').insert({
        id: id, supplier_code: code, statut: 'À_APPROUVER',
        echeance: document.getElementById('fi_due').value || null,
        montant: amount, payload: payload
      });
    }).then(function (r) {
      if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
      msg.className = 'ops-ok-text';
      msg.textContent = 'Demande créée : ' + id;
      LBAStore.invalidate('fin', 'base');
      setTimeout(render, 400);
    });
  });
}

function approveFin(id, ok) {
  return client().then(function (c) {
    return c.from('rcn_proc_financements').update({ statut: ok ? 'APPROUVÉ' : 'REFUSÉ' }).eq('id', id);
  }).then(function (r) {
    if (r.error) { alert(r.error.message + (r.error.details ? '\n' + r.error.details : '')); return; }
    LBAStore.invalidate('fin', 'base');
    render();
  });
}

function renderCycles() {
  paint(head('Cycles de financement',
    'Financement → première livraison → livraisons → couverture → clôture.') + skeletonRows(6));
  return base().then(function (c) {
    paint(head('Cycles de financement',
      'Financement → première livraison → livraisons → couverture → clôture.') +
      table(['Cycle', 'LBA', 'Statut', 'Ouvert le', 'Financé', 'Livraisons', 'Délai 1re livraison', 'Ancienneté'],
        c.cycles.map(function (x) {
          return '<tr><td><b>' + esc(x.cycle_code) + '</b></td><td>' + esc(x.lba_code) + '</td>' +
            '<td>' + badge(x.status) + '</td><td>' + date(x.opened_at) + '</td>' +
            '<td>' + money(x.financed_amount) + '</td><td>' + n(x.delivery_count) + '</td>' +
            '<td>' + (x.first_delivery_delay_days == null ? '—' : x.first_delivery_delay_days + ' j') + '</td>' +
            '<td>' + n(x.cycle_age_days) + ' j</td></tr>';
        })));
  });
}

function renderDeliveries() {
  var actions = '<a class="btn secondary" href="#purchases">Voir les achats RCN</a>';
  paint(head('Livraisons RCN',
    'Volet physique : camion, réception, entrepôt et destination. Le volet commercial est dans Achats RCN.',
    actions) + skeletonRows(6));

  return Promise.all([deliveries(), purchases()]).then(function (rs) {
    var arr = rs[0], rm = rs[1].receptions;
    paint(head('Livraisons RCN',
      'Volet physique : camion, réception, entrepôt et destination. Le volet commercial est dans Achats RCN.',
      actions) +
      table(['Arrivage', 'LBA', 'Prévu le', 'Statut', 'Réception', 'Camion', 'Destination'],
        arr.map(function (x) {
          var p = x.payload || {}, r = rm[x.reception_id] || {};
          var dest = r.warehouse_code || r.site_code || p.destination || p.site || p.warehouse || 'À confirmer';
          return '<tr><td class="mono">' + esc(x.id) + '</td><td>' + esc(x.supplier_code || '—') + '</td>' +
            '<td>' + date(x.prevu_at) + '</td><td>' + badge(x.statut) + '</td>' +
            '<td class="mono">' + esc(x.reception_id || '—') + '</td>' +
            '<td>' + esc(r.camion || p.camion || '—') + '</td><td>' + esc(dest) + '</td></tr>';
        })));
  });
}

function renderBags() {
  paint(head('Gestion sacherie',
    'Balance sacherie par LBA, mouvements et ancienneté, sans quitter LBA Purchase.') + skeletonPage(5));
  return base().then(function (c) {
    paint(head('Gestion sacherie',
      'Balance sacherie par LBA, mouvements et ancienneté, sans quitter LBA Purchase.') +
      kpis([
        ['Sacs remis', num(c.bags.reduce(function (t, x) { return t + n(x.issued); }, 0)), 'cumul'],
        ['Sacs retournés', num(c.bags.reduce(function (t, x) { return t + n(x.returned); }, 0)), 'cumul'],
        ['Balance', num(c.bags.reduce(function (t, x) { return t + n(x.balance); }, 0)), 'encore détenus'],
        ['90 jours et plus', num(c.bags.reduce(function (t, x) { return t + n(x.bucket_90_plus); }, 0)), 'ancienneté'],
        ['LBA débiteurs', String(c.bags.filter(function (x) { return n(x.balance) > 0; }).length), 'balance positive']
      ]) +
      table(['LBA', 'Remis', 'Retournés', 'Balance', '90 j et plus', 'Taux de retour', 'Dernier mouvement'],
        c.bags.map(function (x) {
          return '<tr><td><b>' + esc(x.supplier_code) + '</b></td><td>' + n(x.issued) + '</td>' +
            '<td>' + n(x.returned) + '</td><td>' + n(x.balance) + '</td><td>' + n(x.bucket_90_plus) + '</td>' +
            '<td>' + (x.return_rate == null ? '—' : num(x.return_rate, 1) + ' %') + '</td>' +
            '<td>' + date(x.last_movement) + '</td></tr>';
        })));
  });
}

function renderBalances() {
  paint(head('Balances', 'Exposition de financement, RCN, sacs et compte restent des soldes distincts.') + skeletonRows(6));
  return base().then(function (c) {
    paint(head('Balances', 'Exposition de financement, RCN, sacs et compte restent des soldes distincts.') +
      table(['LBA', 'Exposition', 'Limite', 'Disponible', 'Balance sacs', 'Statut'],
        c.lbas.map(function (x) {
          var z = c.cm[x.code] || {}, b = c.bm[x.code] || {};
          return '<tr><td><b>' + esc(x.code) + '</b></td><td>' + money(z.current_exposure || 0) + '</td>' +
            '<td>' + (z.approved_limit == null ? '—' : money(z.approved_limit)) + '</td>' +
            '<td>' + (z.available_capacity == null ? '—' : money(z.available_capacity)) + '</td>' +
            '<td>' + n(b.balance) + '</td><td>' + badge(z.capacity_status || 'SANS LIMITE') + '</td></tr>';
        })) +
      '<div class="notice info" style="margin-top:14px">Les soldes financiers, RCN et de compte attendent encore la convention Finance / Procurement définitive avant de devenir bloquants.</div>');
  });
}

function renderAging() {
  paint(head('Aging & Alertes', 'Ancienneté calculée sans seuil métier arbitraire.') + skeletonRows(6));
  return financings().then(function (fin) {
    var rows = fin.filter(function (x) { return x.statut === 'APPROUVÉ' || x.statut === 'APPROUVE'; })
      .map(function (x) {
        var age = Math.max(0, Math.floor((Date.now() - new Date(x.created_at).getTime()) / 86400000));
        return '<tr><td>' + esc(x.supplier_code || '—') + '</td><td>' + money(x.montant) + '</td>' +
          '<td>' + age + ' j</td><td>' + date(x.echeance) + '</td><td>' + badge(x.statut) + '</td></tr>';
      });
    paint(head('Aging & Alertes', 'Ancienneté calculée sans seuil métier arbitraire.') +
      table(['LBA', 'Financement', 'Ancienneté', 'Échéance', 'Statut'], rows));
  });
}

function renderPerformance() {
  paint(head('Performance', 'Rotation, volume, qualité, exposition et sacherie par LBA.') + skeletonRows(6));
  return Promise.all([base(), purchases()]).then(function (rs) {
    var c = rs[0], pu = rs[1];
    var byLba = {};
    pu.rows.forEach(function (r) {
      var s = byLba[r.supplier_code] || (byLba[r.supplier_code] = { kg: 0, val: 0, count: 0 });
      s.kg += n(r.poids_paye_kg); s.val += buyAmount(r); s.count++;
    });
    paint(head('Performance', 'Rotation, volume, qualité, exposition et sacherie par LBA.') +
      table(['LBA', 'RCN livré', 'Achats RCN', 'Valeur achats', 'KOR', 'Humidité', 'Exposition', 'Utilisation', 'Balance sacs'],
        c.lbas.map(function (x) {
          var z = c.cm[x.code] || {}, b = c.bm[x.code] || {}, s = byLba[x.code] || { kg: 0, val: 0, count: 0 };
          return '<tr><td><b>' + esc(x.code) + '</b><br><span class="muted">' + esc(x.nom) + '</span></td>' +
            '<td>' + num(n(x.volume_livre_kg) / 1000, 1) + ' MT</td>' +
            '<td>' + num(s.kg / 1000, 1) + ' MT<br><span class="muted">' + s.count + ' dossier(s)</span></td>' +
            '<td>' + money(s.val) + '</td>' +
            '<td>' + (x.kor_moyen == null ? '—' : esc(x.kor_moyen)) + '</td>' +
            '<td>' + (x.humidite_moyenne == null ? '—' : esc(x.humidite_moyenne) + ' %') + '</td>' +
            '<td>' + money(z.current_exposure || 0) + '</td>' +
            '<td>' + (z.utilization_pct == null ? '—' : num(z.utilization_pct, 1) + ' %') + '</td>' +
            '<td>' + n(b.balance) + '</td></tr>';
        })));
  });
}

function renderAudit() {
  paint(head('Audit', 'Historique immuable des changements de limites.') + skeletonRows(6));
  return auditRows().then(function (a) {
    paint(head('Audit', 'Historique immuable des changements de limites.') +
      table(['Date', 'LBA', 'Action', 'Ancienne limite', 'Nouvelle limite'], a.map(function (x) {
        return '<tr><td>' + date(x.changed_at) + '</td><td>' + esc(x.lba_code) + '</td>' +
          '<td>' + badge(x.action) + '</td>' +
          '<td>' + money(x.old_row && x.old_row.approved_limit || 0) + '</td>' +
          '<td>' + money(x.new_row && x.new_row.approved_limit || 0) + '</td></tr>';
      })));
  });
}

function renderDocuments() {
  paint(head('Documents', 'Documents LBA, financements et justificatifs, sans dupliquer la source de vérité.') +
    empty('Les documents rattachés aux limites sont accessibles depuis la rubrique Limites de financement.'));
  return Promise.resolve();
}

/* ------------------------------------------------------------- création d'un LBA */
/* Le formulaire s'appuie sur la fonction lba_create déjà en place côté base :
   elle vérifie la session et le rôle, génère le code suivant sous verrou, refuse les
   doublons de nom et de code, force la catégorie LBA et le statut ACTIF, le tout dans
   une seule transaction. Rien n'est réimplémenté ici. */

function createHost() { return '<section id="lbaCreateHost" class="ops-form-card" hidden></section>'; }

function nextCodePreview(lbas, name) {
  var mx = 0;
  (lbas || []).forEach(function (x) {
    var m = String(x.code || '').match(/^LBA-(\d+)-/);
    if (m) mx = Math.max(mx, Number(m[1]));
  });
  var suffix = normName(name).replace(/[^A-Z0-9]/g, '').slice(0, 3);
  while (suffix.length < 3) suffix += 'X';
  return 'LBA-' + String(mx + 1).padStart(3, '0') + '-' + suffix;
}

function openCreate() {
  var host = document.getElementById('lbaCreateHost');
  if (!host) {
    host = document.createElement('section');
    host.id = 'lbaCreateHost';
    host.className = 'ops-form-card';
    var h = document.querySelector('.ops-route-head');
    if (h) h.insertAdjacentElement('afterend', host); else if (root) root.prepend(host);
  }
  host.hidden = false;
  host.innerHTML = '<p class="muted">Ouverture du formulaire…</p>';
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  Promise.all([base(), loadProfile()]).then(function (rs) {
    var c = rs[0];
    if (!canCreate()) {
      host.innerHTML = '<div class="notice danger"><b>Création non autorisée.</b> ' +
        'Votre profil (' + esc(profile.role || 'non identifié') + ') ne permet pas de créer un LBA.</div>' +
        '<div class="ops-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_LBA.closeCreate()">Fermer</button></div>';
      return;
    }

    host.innerHTML = '<div class="card-head"><div><h2>Créer un nouveau LBA</h2>' +
      '<p>Le code est proposé automatiquement. Aucune limite ni aucun financement n’est créé avec le LBA.</p></div></div>' +
      '<form id="lbaCreateForm"><div class="ops-form-grid">' +
      '<div class="ops-field ops-span-2"><label for="nl_nom">Nom / raison sociale *</label>' +
      '<input id="nl_nom" required maxlength="160" autocomplete="off" placeholder="Ex. COOPERATIVE EXEMPLE"></div>' +
      '<div class="ops-field"><label for="nl_code">Code LBA</label>' +
      '<input id="nl_code" autocomplete="off" placeholder="Proposé automatiquement"></div>' +
      '<div class="ops-field"><label for="nl_zone">Zone / origine</label><input id="nl_zone" placeholder="Ex. Bouaké"></div>' +
      '<div class="ops-field"><label for="nl_site">Site habituel de livraison</label><input id="nl_site" placeholder="Ex. Yamoussoukro"></div>' +
      '<div class="ops-field"><label for="nl_contrat">Contrat disponible</label>' +
      '<select id="nl_contrat"><option value="false">Non</option><option value="true">Oui</option></select></div>' +
      '</div>' +
      '<div class="notice info" id="nl_gap">Le responsable, le téléphone, la banque, le compte bancaire et les commentaires ' +
      'ne sont pas encore enregistrés : le référentiel LBA ne dispose pas de ces champs. Ils seront ajoutés dans une évolution dédiée.</div>' +
      '<div id="nl_dup"></div>' +
      '<div class="ops-actions" style="margin-top:12px">' +
      '<button class="btn primary" type="submit" id="nl_submit">Créer le LBA</button>' +
      '<button class="btn secondary" type="button" onclick="ANAGROCI_LBA.closeCreate()">Annuler</button></div>' +
      '<div id="nl_msg" class="muted" style="margin-top:10px"></div></form>';

    var nom = document.getElementById('nl_nom');
    var code = document.getElementById('nl_code');
    var dup = document.getElementById('nl_dup');
    nom.focus();

    /* Alerte anti-doublon pendant la saisie : nom normalisé, puis code. */
    function checkDup() {
      var nk = normName(nom.value);
      var ck = String(code.value || '').trim().toUpperCase();
      var hit = c.lbas.filter(function (x) {
        return (nk && normName(x.nom) === nk) || (ck && String(x.code).toUpperCase() === ck);
      })[0];
      dup.innerHTML = hit
        ? '<div class="notice danger"><b>Un LBA très proche existe déjà :</b> ' +
          esc(hit.code) + ' · ' + esc(hit.nom) + '. Vérifiez avant de créer un doublon.</div>'
        : '';
      return hit;
    }
    nom.addEventListener('input', function () {
      if (!code.dataset.touched) code.value = nextCodePreview(c.lbas, nom.value);
      checkDup();
    });
    code.addEventListener('input', function () { code.dataset.touched = '1'; checkDup(); });
    code.value = nextCodePreview(c.lbas, '');

    document.getElementById('lbaCreateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('nl_msg');
      var btn = document.getElementById('nl_submit');
      var name = nom.value.trim();
      var wanted = String(code.value || '').trim().toUpperCase();
      if (!name) { msg.className = 'ops-danger-text'; msg.textContent = 'Le nom est obligatoire.'; return; }
      if (wanted && !/^LBA-\d{3,}-[A-Z0-9]{3,}$/.test(wanted)) {
        msg.className = 'ops-danger-text';
        msg.textContent = 'Format attendu pour le code : LBA-024-ABC.';
        return;
      }
      checkDup();
      btn.disabled = true;
      msg.className = 'muted';
      msg.textContent = 'Création en cours…';

      client().then(function (cl) {
        return cl.rpc('lba_create', {
          p_nom: name,
          /* Code vide ⇒ la base génère le suivant sous verrou. On ne lui impose un code
             que si l'utilisateur l'a explicitement modifié. */
          p_code: code.dataset.touched ? wanted : null,
          p_origine: document.getElementById('nl_zone').value.trim() || null,
          p_site: document.getElementById('nl_site').value.trim() || null,
          p_contrat: document.getElementById('nl_contrat').value === 'true'
        });
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.className = 'ops-danger-text'; msg.textContent = r.error.message; return; }
        var created = Array.isArray(r.data) ? r.data[0] : r.data;
        var newCode = created && created.code ? created.code : wanted;
        msg.className = 'ops-ok-text';
        msg.textContent = 'LBA créé avec succès — Code : ' + newCode;
        /* Le registry doit refléter la création sans rechargement manuel. */
        LBAStore.invalidate('base');
        setTimeout(function () {
          closeCreate();
          if (route() === 'registry') render();
          else location.hash = '#registry';
        }, 900);
      }).catch(function (err) {
        btn.disabled = false;
        msg.className = 'ops-danger-text';
        msg.textContent = err && err.message ? err.message : 'Création impossible.';
      });
    });
  });
}

function closeCreate() {
  var host = document.getElementById('lbaCreateHost');
  if (host) { host.hidden = true; host.innerHTML = ''; }
}

/* ------------------------------------------------------------------- routeur */

function paint(html) { if (root) root.innerHTML = html; }

var ROUTES = {
  overview: function () { return renderOverview(); },
  registry: function (p) { return renderRegistry(p[1]); },
  purchases: function (p) { return renderPurchases(p[1]); },
  limits: function () { return renderLimits(); },
  financing: function () { return renderFinancing(); },
  cycles: function () { return renderCycles(); },
  deliveries: function () { return renderDeliveries(); },
  bags: function () { return renderBags(); },
  balances: function () { return renderBalances(); },
  aging: function () { return renderAging(); },
  performance: function () { return renderPerformance(); },
  documents: function () { return renderDocuments(); },
  audit: function () { return renderAudit(); }
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
      /* Une rubrique en échec ne doit pas laisser un squelette qui tourne indéfiniment. */
      if (token !== renderToken) return;
      console.error('[LBA Purchase]', e);
      paint(head('Rubrique indisponible', 'Cette rubrique n’a pas pu être affichée.') +
        danger(e && e.message ? e.message : 'Erreur inconnue') +
        '<div class="ops-actions"><button class="btn secondary" type="button" onclick="ANAGROCI_LBA.reload()">Réessayer</button></div>');
    });
}

function reload() { LBAStore.clear(); render(); }

/* Préchargement discret après le premier affichage : les deux rubriques les plus
   probables (Registry via les données de base, puis Achats RCN). Ne bloque rien. */
function preload() {
  var idle = global.requestIdleCallback || function (fn) { return setTimeout(fn, 400); };
  idle(function () {
    base().then(function () {
      idle(function () { purchases().catch(function () {}); });
    }).catch(function () {});
  });
}

/* --------------------------------------------------------------------- démarrage */

function boot() {
  root = document.getElementById('opsRouteView');
  makeClient();
  loadProfile();
  render().then(preload);
}

/* Publication synchrone du routeur, avant tout appel réseau : navigation-v2.js
   appelle ANAGROCI_OPS_ROUTE à chaque changement de hash et doit toujours trouver
   ce routeur-ci, jamais un routeur partiel installé plus tard. */
global.ANAGROCI_OPS_ROUTE = render;
global.ANAGROCI_LBA = {
  render: render,
  reload: reload,
  openCreate: openCreate,
  closeCreate: closeCreate,
  toggleLimitForm: toggleLimitForm,
  approveFin: approveFin,
  store: LBAStore
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})(window);
