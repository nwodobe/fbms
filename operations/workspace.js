/* ANAGROCI Operations Suite — shell partagé des 5 workspaces.
   Réutilise les modules existants et affiche uniquement des KPI dérivés de Supabase.
   Aucune formule métier « À CONFIRMER » n'est inventée ici. */
(function (global) {
  'use strict';

  /* ===================================================================================================
     Finalisation campagne 2027 — messages d'erreur métier et état réel des données.
     1. Les erreurs techniques de la base (RLS, contrainte, doublon, délai, session) ne doivent jamais
        apparaître telles quelles : la réponse de l'API est réécrite AVANT que les modules ne la lisent.
        Les messages métier déjà rédigés côté serveur (DOUBLON_FORT, « Un RT de suivi est requis… ») sont
        conservés tels quels ; le message technique reste disponible dans technical_message (console).
     2. La pastille « Données à jour » reflète désormais la dernière lecture réussie, l'absence de réseau ou
        l'échec de la dernière requête (avant : texte codé en dur, toujours vert).
     Le fetch est enveloppé ici, avant que les modules (scripts defer suivants) ne créent leur client. */
  function lang() { try { return localStorage.getItem('anagroci_lang') === 'en' ? 'en' : 'fr'; } catch (e) { return 'fr'; } }
  var COLS = { nom: ['nom', 'name'], village_id: ['village', 'village'], producteur_id: ['producteur', 'farmer'], poids_net: ['poids net', 'net weight'],
    prix_kg: ['prix', 'price'], montant: ['montant', 'amount'], cooperative_id: ['coopérative', 'cooperative'], name: ['nom', 'name'], full_name: ['nom', 'name'],
    warehouse_id: ['entrepôt', 'warehouse'], truck: ['camion', 'truck'], date: ['date', 'date'] };
  var UNIQUE = {
    achats_numero_recu_unique_idx: ['Ce numéro de reçu existe déjà : vérifiez le reçu ou l’achat déjà saisi.', 'This receipt number already exists: check the receipt or the purchase already recorded.'],
    achats_local_id_key: ['Cet achat a déjà été enregistré (synchronisation déjà faite).', 'This purchase is already recorded (already synchronised).'],
    producteurs_code_key: ['Ce Farmer ID existe déjà.', 'This Farmer ID already exists.'],
    aflp_mbr_member_no: ['Ce numéro de membre existe déjà dans cette coopérative.', 'This member number already exists in this cooperative.'],
    aflp_mbr_one_primary: ['Ce producteur a déjà une coopérative principale pour cette campagne.', 'This farmer already has a main cooperative for this campaign.'],
    aflp_mbr_one_open: ['Ce producteur est déjà membre de cette coopérative.', 'This farmer is already a member of this cooperative.'],
    aflp_coop_deliveries_reception_uidx: ['Cette réception est déjà rattachée à une autre livraison coopérative.', 'This reception is already linked to another cooperative delivery.']
  };
  var CHECKS = [
    [/montant|amount/i, ['Montant incohérent : il doit être égal au poids net × prix.', 'Inconsistent amount: it must equal net weight × price.']],
    [/nb_sacs|bags/i, ['Poids par sac hors norme (40 à 120 kg par sac) : vérifiez le poids ou le nombre de sacs.', 'Weight per bag out of range (40–120 kg): check weight or bag count.']],
    [/poids_net/i, ['Le poids net doit être supérieur à 0.', 'Net weight must be greater than 0.']],
    [/prix_kg/i, ['Le prix doit être supérieur à 0.', 'Price must be greater than 0.']],
    [/periode|end_date/i, ['La date de fin doit être postérieure à la date de début.', 'End date must be after start date.']],
    [/gps_lat|gps_lng/i, ['Coordonnées GPS invalides.', 'Invalid GPS coordinates.']],
    [/html/i, ['Caractères < et > interdits dans ce champ.', 'Characters < and > are not allowed in this field.']]
  ];
  function pick(pair) { return pair[lang() === 'en' ? 1 : 0]; }
  function friendlyError(message, code) {
    var m = String(message || ''), k;
    if (!m) return m;
    if (/row-level security|permission denied for|not allowed to|insufficient_privilege/i.test(m) || (code === '42501' && /permission denied/i.test(m)))
      return pick(['Vous n’avez pas l’autorisation d’effectuer cette opération.', 'You are not allowed to perform this operation.']);
    if ((k = /duplicate key value violates unique constraint "([^"]+)"/i.exec(m)))
      return pick(UNIQUE[k[1]] || ['Cet enregistrement existe déjà.', 'This record already exists.']);
    if ((k = /violates check constraint "([^"]+)"/i.exec(m))) {
      for (var i = 0; i < CHECKS.length; i++) if (CHECKS[i][0].test(k[1])) return pick(CHECKS[i][1]);
      return pick(['Une valeur saisie n’est pas acceptée (contrôle de cohérence). Vérifiez les champs du formulaire.', 'A value is not accepted (consistency check). Please check the form fields.']);
    }
    if (/violates foreign key constraint/i.test(m))
      return pick(['Référence introuvable ou encore utilisée ailleurs : opération refusée.', 'Reference not found or still in use elsewhere: operation refused.']);
    if ((k = /null value in column "([^"]+)"/i.exec(m))) {
      var c = COLS[k[1]]; return pick(['Champ obligatoire manquant : ' + (c ? c[0] : k[1]) + '.', 'Missing required field: ' + (c ? c[1] : k[1]) + '.']);
    }
    if (/statement timeout|canceling statement/i.test(m))
      return pick(['L’opération a pris trop de temps. Réessayez ; si cela persiste, réduisez la sélection ou le fichier.', 'The operation took too long. Retry; if it persists, reduce the selection or file.']);
    if (/JWT expired|invalid JWT|JWSError/i.test(m)) return pick(['Session expirée : reconnectez-vous.', 'Session expired: please sign in again.']);
    if (/invalid input syntax for type/i.test(m)) return pick(['Format de valeur invalide (nombre, date ou identifiant).', 'Invalid value format (number, date or identifier).']);
    if (/Could not find the (function|table)|schema cache/i.test(m)) return pick(['Fonction momentanément indisponible : rechargez la page.', 'Function temporarily unavailable: reload the page.']);
    if (/deadlock detected|could not serialize/i.test(m)) return pick(['Conflit d’enregistrement simultané : réessayez.', 'Simultaneous update conflict: please retry.']);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return pick(['Connexion indisponible : vérifiez le réseau puis réessayez.', 'Connection unavailable: check the network and retry.']);
    return m;
  }
  global.ANAGROCI_ERREUR_METIER = friendlyError;
  var fresh = { ok: null, at: null, fail: null };
  function paintFresh() {
    var en = lang() === 'en', txt, cls;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { txt = en ? 'Offline' : 'Hors ligne'; cls = 'off'; }
    else if (fresh.fail && (!fresh.ok || fresh.fail > fresh.ok)) { txt = en ? 'Connection error' : 'Erreur de connexion'; cls = 'off'; }
    else if (fresh.ok) {
      var d = new Date(fresh.ok), hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      txt = (en ? 'Data read at ' : 'Données lues à ') + hh; cls = 'on';
    } else { txt = en ? 'Loading data…' : 'Chargement des données…'; cls = 'wait'; }
    [].slice.call(document.querySelectorAll('[data-fresh]')).forEach(function (el) {
      if (el.getAttribute('data-fresh-txt') === txt) return;
      el.setAttribute('data-fresh-txt', txt); el.setAttribute('data-state', cls);
      var t = el.querySelector('.fresh-txt'); if (t) t.textContent = txt; else el.textContent = txt;
      el.title = en ? 'Status of the last data request' : 'État de la dernière requête de données';
    });
  }
  global.addEventListener && global.addEventListener('online', paintFresh);
  global.addEventListener && global.addEventListener('offline', paintFresh);
  if (global.fetch && !global.__anagrociFetchWrapped) {
    global.__anagrociFetchWrapped = true;
    var origFetch = global.fetch;
    global.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var isApi = /\/rest\/v1\//.test(url);
      return origFetch.apply(this, arguments).then(function (res) {
        if (!isApi) return res;
        if (res.ok) { fresh.ok = Date.now(); paintFresh(); return res; }
        if (res.status >= 500 || res.status === 0) { fresh.fail = Date.now(); paintFresh(); }
        var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
        if (ct.indexOf('json') < 0) return res;
        return res.clone().text().then(function (txt) {
          var j; try { j = JSON.parse(txt); } catch (e) { return res; }
          if (!j || typeof j.message !== 'string') return res;
          var f = friendlyError(j.message, j.code);
          if (f === j.message) return res;
          if (global.console) console.info('[ANAGROCI] erreur technique remplacée :', j.message);
          j.technical_message = j.message; j.message = f;
          return new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers: res.headers });
        }).catch(function () { return res; });
      }, function (err) { if (isApi) { fresh.fail = Date.now(); paintFresh(); } throw err; });
    };
  }

  var PAGE = document.body && document.body.dataset ? (document.body.dataset.workspace || '') : '';
  var CFG = {
    field: {
      title: 'FIELD BUYING', subtitle: 'Producteurs, achats et opérations terrain',
      nav: [
        ['overview','Overview','../operations/field-buying.html'],
        ['purchases','Purchases','../terrain/achats.html'],
        ['farmers','Farmers','../fbms/index.html#producteurs'],
        ['rt','RT & Villages','../fbms/index.html'],
        ['bags','AFLP Bags','../terrain/sacs.html'],
        ['cash','Cash & Advances','../terrain/cash.html'],
        ['command','Command Center','../terrain/command.html'],
        ['logistics','Map & Logistics','../logistique/alis_fbms.html'],
        ['sustainability','Sustainability','../terrain/sustainability.html']
      ]
    },
    procurement: {
      title: 'PROCUREMENT', subtitle: 'Achat Bord Champ, LBA, fournisseurs et évacuations',
      nav: [
        ['overview','Overview','../operations/procurement.html#overview'],
        ['field','Achat Bord Champ','../operations/procurement.html#field'],
        ['lba','LBA','../operations/procurement.html#lba'],
        ['suppliers','Suppliers','../operations/procurement.html#suppliers'],
        ['arrivals','Arrivages prévus','../operations/procurement.html#arrivals'],
        ['purchases','Achat RCN','../operations/procurement.html#purchases'],
        ['evacuations','Evacuations','../operations/procurement.html#evacuations'],
        ['reconciliation','Reconciliation','../operations/procurement.html#reconciliation'],
        ['settings','Settings','../operations/procurement.html#settings'],
        ['audit','Audit','../operations/procurement.html#audit']
      ]
    },
    lba: {
      title: 'LBA PURCHASE', subtitle: 'Financement, LBA, livraisons et performance',
      nav: [
        ['overview','Overview','../operations/lba-purchase.html'],
        ['registry','LBA Registry','../rcntrace/index.html#procurement'],
        ['limits','Funding Limits','../operations/lba-purchase.html#funding'],
        ['cycles','Funding Cycles','../operations/lba-purchase.html#cycles'],
        ['deliveries','RCN Deliveries','../rcntrace/index.html#procurement'],
        ['bags','Bags','../rcntrace/index.html#jute'],
        ['balances','Balances','../operations/lba-purchase.html#balances'],
        ['performance','Performance','../operations/lba-purchase.html#performance']
      ]
    },
    warehouse: {
      title: 'OPÉRATIONS ENTREPÔT', subtitle: 'Entrepôts externes · réception, lots, BIN et stock',
      nav: [
        ['overview','Vue d’ensemble','../operations/warehouse.html#overview'],
        ['inbound','Réceptions','../operations/warehouse.html#inbound'],
        ['quality','Qualité','../operations/warehouse.html#quality'],
        ['lots','Lots RCN','../operations/warehouse.html#lots'],
        ['bins','Stock & BIN','../operations/warehouse.html#bins'],
        ['drying','Séchage / Tri','../operations/warehouse.html#drying'],
        ['bags','Sacherie','../operations/warehouse.html#bags'],
        ['inventory','Inventaire','../operations/warehouse.html#inventory'],
        ['audit','Audit','../operations/warehouse.html#audit']
      ]
    },
    transfer: {
      title: 'STOCK TRANSFER', subtitle: 'Mouvements inter-sites et réconciliation',
      nav: [
        ['overview','Overview','../operations/stock-transfer.html'],
        ['requests','Requests','../rcntrace/index.html'],
        ['ready','Ready to Load','../rcntrace/index.html'],
        ['transit','In Transit','../rcntrace/index.html'],
        ['arrivals','Arrivals','../rcntrace/index.html'],
        ['reconcile','Reconciliation','../rcntrace/index.html'],
        ['audit','Audit','../rcntrace/index.html']
      ]
    },
    factory: {
      title: 'FACTORY', subtitle: 'Factory Warehouse et process',
      nav: [
        ['overview','Overview','../operations/factory.html'],
        ['reception','Factory Reception','../rcntrace/index.html'],
        ['warehouse','Factory Warehouse','../operations/factory.html#warehouse'],
        ['bins','Factory BIN','../operations/factory.html#bins'],
        ['processing','Processing','../rcntrace/index.html'],
        ['calibration','Calibration','../rcntrace/index.html'],
        ['balance','Mass Balance','../rcntrace/index.html'],
        ['audit','Audit','../rcntrace/index.html']
      ]
    },
    trace: { title:'TRACEABILITY 360', subtitle:'Où est le RCN maintenant ? D’où vient-il ?', nav:[] },
    reports: { title:'REPORTS & EXPORT', subtitle:'Reporting et exports Excel', nav:[] },
    campaigns: { title:'CAMPAGNES', subtitle:'Ouverture, clôture, historique et simulations', nav:[] }
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>\"]/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }
  function num(v, digits) {
    var n = Number(v || 0);
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits == null ? 0 : digits }).format(n);
  }
  function kgToMt(v) { return num(Number(v || 0) / 1000, 1) + ' MT'; }
  function money(v) { return num(v, 0) + ' FCFA'; }
  function badgeClass(value) {
    var s = String(value || '').toUpperCase();
    if (/CLOS|RECU|RECONCIL|ACTIF|APPROUV|VALIDE|TERMINE|OK/.test(s)) return 'ok';
    if (/ECART|REJET|REFUS|BLOQU|ERREUR/.test(s)) return 'danger';
    if (/ATTENT|PENDING|TRANSIT|READY|HOLD|PARTIAL/.test(s)) return 'warn';
    return 'info';
  }
  function routeName() {
    var path = location.pathname.split('/').pop() || '';
    var hash = location.hash.replace('#','');
    if (hash) return hash.split('/')[0].split('?')[0];
    if (/field-buying/.test(path)) return 'overview';
    if (/lba-purchase/.test(path)) return 'overview';
    if (/warehouse/.test(path)) return 'overview';
    if (/stock-transfer/.test(path)) return 'overview';
    if (/factory/.test(path)) return 'overview';
    return 'overview';
  }
  /* Audit campagne 2027 : auth-gate peut créer la pastille utilisateur AVANT que la barre ne soit dessinée ;
     elle restait alors flottante (position fixe) et recouvrait le titre, surtout sur mobile. On la rapatrie. */
  function adoptUserSlot() {
    var top = document.getElementById('opsTopbar'); if (!top) return;
    var actions = top.querySelector('.ops-top-actions'); if (!actions) return;
    var inTop = top.querySelector('#anagroci-userslot');
    var floating = [].slice.call(document.querySelectorAll('#anagroci-userslot.ag-floating')).filter(function (x) { return !top.contains(x); })[0];
    if (!floating) return;
    floating.classList.remove('ag-floating');
    if (inTop) inTop.parentNode.replaceChild(floating, inTop); else actions.appendChild(floating);
  }
  /* Audit campagne 2027 : changement d'espace en 1 clic (avant : retour obligatoire au portail pour passer
     de Procurement à Warehouse, Stock Transfer, Factory, Traceability 360 ou Reports). */
  function wsSwitch() {
    var en = false; try { en = localStorage.getItem('anagroci_lang') === 'en'; } catch (e) {}
    var items = [['field','field-buying.html','FIELD BUYING'],['procurement','procurement.html','PROCUREMENT'],['warehouse','warehouse.html','WAREHOUSE'],
      ['transfer','stock-transfer.html','STOCK TRANSFER'],['factory','factory.html','FACTORY'],['trace','traceability.html','TRACEABILITY 360'],['reports','reports.html','REPORTS & EXPORT'],['campaigns','campaigns.html','CAMPAGNES']];
    return '<details class="ops-ws" data-i18n-ignore><summary>' + (en ? 'Switch workspace' : 'Changer d’espace') + '</summary><div class="ops-ws-menu">' +
      '<a href="../index.html">' + (en ? '← Operations portal' : '← Portail Operations') + '</a>' +
      items.map(function (x) { return '<a href="' + x[1] + '"' + (x[0] === PAGE ? ' class="on" aria-current="page"' : '') + '>' + x[2] + '</a>'; }).join('') + '</div></details>';
  }
  function renderShell() {
    var c = CFG[PAGE] || CFG.field;
    var top = document.getElementById('opsTopbar');
    if (top) top.innerHTML = '<a class="ops-brand" href="../index.html"><img src="../assets/logo-pjs-mark.png" alt="PJS Global"><span><strong>ANAGROCI OPERATIONS</strong><small>Operations Suite</small></span></a>' +
      '<div class="ops-title"><strong>'+esc(c.title)+'</strong><small>'+esc(c.subtitle)+'</small></div>' +
      wsSwitch() +
      '<div class="ops-top-actions"><span id="opsCampaignSlot" class="ops-camp-slot" data-i18n-ignore>'+campPillHtml()+'</span><span class="ops-pill" data-fresh data-i18n-ignore data-state="wait"><span class="dot"></span><span class="fresh-txt">Chargement des données…</span></span><span id="anagroci-lang-slot"></span><span id="anagroci-userslot"></span></div>';
    var side = document.getElementById('opsSidebar');
    if (side) {
      var active = routeName();
      side.innerHTML = '<div class="ops-side-head">'+esc(c.title)+'</div><nav class="ops-nav">' +
        (c.nav || []).map(function (x) { return '<a class="'+(active===x[0]?'active':'')+'" href="'+x[2]+'"><span class="nav-dot"></span>'+esc(x[1])+'</a>'; }).join('') +
        '</nav>';
    }
  }

  function waitClient() {
    return new Promise(function (resolve) {
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) {
          clearInterval(t);
          resolve(global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON));
        } else if (tries > 100) { clearInterval(t); resolve(null); }
      }, 80);
    });
  }
  async function safe(promise, fallback) {
    try { var r = await promise; if (r && r.error) throw r.error; return r && r.data != null ? r.data : fallback; }
    catch (e) { console.warn('[Operations Suite]', e && e.message ? e.message : e); return fallback; }
  }
  async function count(sb, table, filter) {
    try {
      var q = sb.from(table).select('*', { count:'exact', head:true });
      if (filter) q = filter(q);
      var r = await q; return r.error ? null : Number(r.count || 0);
    } catch (e) { return null; }
  }
  async function rows(sb, table, cols, limit) {
    return safe(sb.from(table).select(cols || '*').limit(limit || 50), []);
  }
  function setKpis(items) {
    var root = document.getElementById('kpis');
    if (!root) return;
    root.innerHTML = items.map(function (x) {
      return '<div class="kpi '+(x.cls||'')+'"><small>'+esc(x.label)+'</small><b>'+esc(x.value == null ? '—' : x.value)+'</b><span>'+esc(x.note||'')+'</span></div>';
    }).join('');
  }
  function setTable(id, headers, rowsData) {
    var root = document.getElementById(id); if (!root) return;
    if (!rowsData || !rowsData.length) { root.innerHTML='<div class="empty">Aucune donnée disponible pour ce périmètre.</div>'; return; }
    root.innerHTML='<div class="table-wrap"><table><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+
      rowsData.map(function(row){return '<tr>'+row.map(function(v){return '<td>'+v+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';
  }

  async function loadField(sb) {
    var c1 = await count(sb,'producteurs',function(q){return q.eq('deleted',false);});
    var c2 = await count(sb,'rt',function(q){return q.eq('deleted',false);});
    var c3 = await count(sb,'achats',function(q){return q.eq('rejet',false);});
    var trace = await rows(sb,'field_traceability_completeness_v','poids_net,completeness_score_2027,overall_status,cluster,achat_date',500);
    var totalKg = trace.reduce(function(t,x){return t+Number(x.poids_net||0);},0);
    var avg = trace.length ? trace.reduce(function(t,x){return t+Number(x.completeness_score_2027||0);},0)/trace.length : 0;
    var breaks = trace.filter(function(x){return Number(x.completeness_score_2027||0)<100;}).length;
    setKpis([
      {label:'RCN acheté',value:kgToMt(totalKg),note:'transactions visibles'},
      {label:'Producteurs',value:c1,note:'Farmer Registry'},
      {label:'RT actifs',value:c2,note:'référentiel actif'},
      {label:'Achats',value:c3,note:'hors rejets'},
      {label:'Traçabilité',value:num(avg,0)+' %',note:breaks+' chaîne(s) à compléter',cls:breaks?'attn':''}
    ]);
    var cluster = {};
    trace.forEach(function(x){var k=x.cluster||'Non rattaché';cluster[k]=(cluster[k]||0)+Number(x.poids_net||0);});
    setTable('primaryTable',['Cluster','Volume tracé'],Object.keys(cluster).sort().map(function(k){return ['<b>'+esc(k)+'</b>',kgToMt(cluster[k])];}));
  }
  async function loadLba(sb) {
    var lbas = await rows(sb,'rcn_fournisseurs','code,nom,statut,volume_livre_kg,kor_moyen,humidite_moyenne,derniere_livraison',100);
    lbas = lbas.filter(function(x){return String(x.code||'').indexOf('LBA-')===0;});
    var fin = await rows(sb,'rcn_proc_financements','id,supplier_code,montant,statut,echeance,created_at',100);
    var bag = await rows(sb,'rcn_jute_v_supplier_profile','supplier_code,balance,bucket_90_plus,return_rate',100);
    var vol = lbas.reduce(function(t,x){return t+Number(x.volume_livre_kg||0);},0);
    var exposure = fin.filter(function(x){return /APPROUV|PAYE|DECAISS/i.test(x.statut||'');}).reduce(function(t,x){return t+Number(x.montant||0);},0);
    var bagDebt = bag.reduce(function(t,x){return t+Number(x.balance||0);},0);
    setKpis([
      {label:'LBA actifs',value:lbas.filter(function(x){return x.statut==='ACTIF';}).length,note:lbas.length+' au master'},
      {label:'Financements saisis',value:fin.length,note:'moteur Procurement'},
      {label:'Montant financé',value:money(exposure),note:'somme des statuts actifs',cls:'attn'},
      {label:'RCN historique',value:kgToMt(vol),note:'master 2026'},
      {label:'Sacs chez LBA',value:num(bagDebt),note:'balance ledger central',cls:bagDebt?'attn':''}
    ]);
    var bagMap={}; bag.forEach(function(x){bagMap[x.supplier_code]=x;});
    setTable('primaryTable',['LBA','Volume livré','KOR','Humidité','Sacs dus','Dernière activité'],lbas.slice(0,30).map(function(x){var b=bagMap[x.code]||{};return [
      '<b>'+esc(x.code)+'</b><br><span class="muted">'+esc(x.nom)+'</span>',kgToMt(x.volume_livre_kg),num(x.kor_moyen,2),num(x.humidite_moyenne,2)+' %',
      '<span class="badge '+(Number(b.balance||0)>0?'warn':'ok')+'">'+num(b.balance||0)+'</span>',esc(x.derniere_livraison||'—')
    ];}));
  }
  async function loadWarehouse(sb) {
    var rec = await rows(sb,'rcn_v_receptions','id,camion,fournisseur,origine,arrivee_at,poids_annonce,sacs_annonce,etat,lot_id',100);
    var lots = await rows(sb,'rcn_v_lots','id,fournisseur,origine,stock_kg,bin_id,etat,kor_final',200);
    var bins = await rows(sb,'rcn_bi_stock_bin','bin_id,etat,stock_physique_kg,capacite_kg,taux_remplissage_pct,nb_contributeurs,age_heures',200);
    var stock = bins.reduce(function(t,x){return t+Number(x.stock_physique_kg||0);},0);
    setKpis([
      {label:'Réceptions',value:rec.length,note:'périmètre visible'},
      {label:'RCN lots',value:lots.length,note:'identités matière'},
      {label:'Stock BIN',value:kgToMt(stock),note:'stock physique calculé'},
      {label:'BIN actifs',value:bins.filter(function(x){return Number(x.stock_physique_kg||0)>0;}).length,note:'avec stock'},
      {label:'Contributeurs',value:bins.reduce(function(t,x){return t+Number(x.nb_contributeurs||0);},0),note:'généalogie BIN'}
    ]);
    setTable('primaryTable',['Réception','Fournisseur','Origine','Poids annoncé','Sacs','Statut'],rec.slice(0,30).map(function(x){return [
      '<span class="mono">'+esc(x.id)+'</span>',esc(x.fournisseur),esc(x.origine),kgToMt(x.poids_annonce),num(x.sacs_annonce),'<span class="badge '+badgeClass(x.etat)+'">'+esc(x.etat)+'</span>'
    ];}));
    var binRoot=document.getElementById('binGrid'); if(binRoot) binRoot.innerHTML=bins.slice(0,30).map(function(x){return '<div class="bin '+(Number(x.taux_remplissage_pct||0)>95?'warn':'')+'"><b>'+esc(x.bin_id)+'</b><span>'+kgToMt(x.stock_physique_kg)+' · '+num(x.taux_remplissage_pct,0)+' % · '+num(x.nb_contributeurs)+' contrib.</span></div>';}).join('') || '<div class="empty">Aucun BIN visible.</div>';
  }
  async function loadTransfer(sb) {
    var trf = await rows(sb,'rcn_v_transferts','id,bin_id,destination,poids_envoye,poids_recu,ecart_kg,ecart_motif,etat,created_at',150);
    var inTransit=trf.filter(function(x){return /TRANSIT|EXPED|CHARGE|READY/i.test(x.etat||'');}).length;
    var reconciled=trf.filter(function(x){return /RECONCIL|CLOS|RECU/i.test(x.etat||'');}).length;
    var variances=trf.filter(function(x){return Math.abs(Number(x.ecart_kg||0))>0;}).length;
    setKpis([
      {label:'Transferts',value:trf.length,note:'historique visible'},
      {label:'En transit',value:inTransit,note:'à suivre',cls:inTransit?'attn':''},
      {label:'Réconciliés',value:reconciled,note:'clôturés'},
      {label:'Avec écart',value:variances,note:'écart poids non nul',cls:variances?'attn':''},
      {label:'Généalogie',value:'Préservée',note:'rcn_v_genealogie'}
    ]);
    setTable('primaryTable',['Transfert','BIN origine','Destination','Envoyé','Reçu','Écart','Statut'],trf.slice(0,40).map(function(x){return [
      '<span class="mono">'+esc(x.id)+'</span>',esc(x.bin_id),esc(x.destination),kgToMt(x.poids_envoye),x.poids_recu==null?'—':kgToMt(x.poids_recu),
      '<span class="badge '+(Math.abs(Number(x.ecart_kg||0))?'warn':'ok')+'">'+num(x.ecart_kg,1)+' kg</span>','<span class="badge '+badgeClass(x.etat)+'">'+esc(x.etat)+'</span>'
    ];}));
  }
  async function loadFactory(sb) {
    var cal = await rows(sb,'rcn_v_calibrages','id,trf_id,machine,shift,equipe,recu_kg,entree_machine_kg,etat,started_at,ended_at',120);
    var lots = await rows(sb,'rcn_v_lots','id,stock_kg,bin_id,etat,from_transfer',200);
    var active=cal.filter(function(x){return !/CLOS|TERMINE|RECONCIL/i.test(x.etat||'');}).length;
    var input=cal.reduce(function(t,x){return t+Number(x.entree_machine_kg||0);},0);
    setKpis([
      {label:'Factory lots',value:lots.filter(function(x){return x.from_transfer;}).length,note:'issus transfert'},
      {label:'Process batches',value:cal.length,note:'calibrages visibles'},
      {label:'Batches actifs',value:active,note:'process en cours',cls:active?'attn':''},
      {label:'Entrée process',value:kgToMt(input),note:'cumul visible'},
      {label:'Frontière',value:'Warehouse ≠ Process',note:'règle P0'}
    ]);
    setTable('primaryTable',['Batch','Transfert source','Machine','Entrée','Shift','Statut'],cal.slice(0,35).map(function(x){return [
      '<span class="mono">'+esc(x.id)+'</span>',esc(x.trf_id||'—'),esc(x.machine||'—'),kgToMt(x.entree_machine_kg),esc(x.shift||'—'),'<span class="badge '+badgeClass(x.etat)+'">'+esc(x.etat)+'</span>'
    ];}));
  }
  async function traceSearch(sb, q) {
    q=String(q||'').trim(); var out=document.getElementById('traceResults'); if(!out) return;
    if(q.length<2){out.innerHTML='<div class="empty">Saisissez au moins 2 caractères.</div>';return;}
    var chain=[];
    try {
      var r=await sb.from('field_traceability_chain_v').select('*').or('farmer_id.ilike.%'+q+'%,producteur_nom.ilike.%'+q+'%,lot_code.ilike.%'+q+'%,shipment_code.ilike.%'+q+'%,vehicle_plate.ilike.%'+q+'%').limit(50);
      if(!r.error) chain=r.data||[];
    } catch(e){}
    if(!chain.length){out.innerHTML='<div class="empty">Aucune chaîne terrain trouvée. Pour les lots/BIN usine, ouvrez aussi RCN TRACE.</div>';return;}
    out.innerHTML=chain.map(function(x){return '<div class="card" style="margin-bottom:10px"><div class="card-head"><div><h3>'+esc(x.farmer_id||x.producteur_nom||x.lot_code||'Chaîne')+'</h3><p>'+esc(x.producteur_nom||'')+'</p></div><span class="badge info">'+esc(x.lot_code||'FIELD')+'</span></div><div class="workflow"><span class="step done">Farmer</span><span class="step '+(x.field_lot_id?'done':'pending')+'">Field Lot</span><span class="step '+(x.shipment_id?'done':'pending')+'">Shipment</span><span class="step '+(x.reception_id?'done':'pending')+'">Factory Reception</span><span class="step '+(x.factory_lot_id?'done':'pending')+'">Factory Lot</span></div><p class="muted" style="font-size:11px;margin:12px 0 0">'+esc(x.origin_label||'')+' → '+esc(x.destination_label||'')+' · '+kgToMt(x.achat_poids_net_kg)+'</p></div>';}).join('');
  }
  async function loadTrace(sb){
    var c=await count(sb,'field_traceability_chain_v'); var g=await count(sb,'rcn_v_genealogie');
    setKpis([{label:'Chaînes terrain',value:c,note:'Farmer → Factory'},{label:'Liens généalogie RCN',value:g,note:'parent → enfant'},{label:'Recherche',value:'Cross-module',note:'Farmer / Lot / Shipment'},{label:'Parcelle',value:'Non bloquante',note:'complétable après campagne'},{label:'Source de vérité',value:'Transactions',note:'pas de silo Traceability'}]);
    var form=document.getElementById('traceForm'); if(form) form.addEventListener('submit',function(e){e.preventDefault();traceSearch(sb,document.getElementById('traceQuery').value);});
  }
  async function loadReports(sb){
    var lba=await count(sb,'rcn_fournisseurs',function(q){return q.like('code','LBA-%');}); var trf=await count(sb,'rcn_v_transferts'); var rec=await count(sb,'rcn_v_receptions');
    setKpis([{label:'LBA master',value:lba,note:'référentiel'},{label:'Réceptions',value:rec,note:'reporting physique'},{label:'Transferts',value:trf,note:'reporting logistique'},{label:'Excel',value:'Output',note:'plus de base transactionnelle'},{label:'Metadata',value:'Obligatoire',note:'campagne · filtres · version'}]);
  }


  /* ===================== Multi-campagnes : contexte campagne partagé =====================
     Avant : « Campagne 2027 » était écrit en dur dans l'en-tête et dans chaque module.
     Après : la campagne vient du référentiel public.campaigns. Par défaut, la campagne courante (is_current) ;
     la direction (BM, ABM, GM, Zonal Head, Finance, Auditeur) peut consulter une autre campagne depuis l'en-tête
     (une campagne clôturée s'affiche en lecture seule ; une simulation est signalée en permanence).
     Les autres rôles travaillent toujours dans la campagne courante : un RT ne choisit jamais l'année.
     Le contexte est mis en cache (localStorage) pour être disponible dès le chargement des modules ; il est
     relu au démarrage et la page est rechargée une fois si la campagne a changé entre-temps. */
  var CAMP_SEL = 'anagroci_campaign_id', CAMP_CACHE = 'anagroci_campaign_ctx';
  var MGMT_ROLES = ['Branch Manager','Assistant Branch Manager','General Manager','Zonal Head','Finance','Viewer / Auditor'];
  var campList = [], campSel = null, campLoaded = false, campReadyRes;
  var campReady = new Promise(function (r) { campReadyRes = r; });
  try { campSel = JSON.parse(localStorage.getItem(CAMP_CACHE) || 'null'); } catch (e) { campSel = null; }
  try { campList = JSON.parse(localStorage.getItem(CAMP_CACHE + '_list') || '[]') || []; } catch (e) { campList = []; }
  function campEn() { try { return localStorage.getItem('anagroci_lang') === 'en'; } catch (e) { return false; } }
  function campRole() { var a = global.ANAGROCI_AUTH; return a && a.profile ? a.profile.role || '' : ''; }
  function campIsMgmt() { return MGMT_ROLES.indexOf(campRole()) >= 0; }
  var CAMP_STATUS = { DRAFT:['Brouillon','Draft'], PLANNING:['En préparation','Planning'], READY:['Prête','Ready'], OPEN:['Ouverte','Open'],
    CLOSING:['En clôture','Closing'], CLOSED:['Clôturée','Closed'], ARCHIVED:['Archivée','Archived'] };
  var CAMP_TYPE = { REAL:['Réelle','Real'], DEMO:['Démo','Demo'], SIMULATION:['Simulation','Simulation'], TRAINING:['Formation','Training'], QA:['QA','QA'] };
  function campStatusLabel(s) { var x = CAMP_STATUS[s]; return x ? x[campEn() ? 1 : 0] : (s || ''); }
  function campTypeLabel(t) { var x = CAMP_TYPE[t]; return x ? x[campEn() ? 1 : 0] : (t || ''); }
  function campPillHtml() {
    var c = campSel;
    if (!c) return '<span class="ops-pill light">' + (campEn() ? 'Campaign…' : 'Campagne…') + '</span>';
    var sim = c.campaign_type && c.campaign_type !== 'REAL';
    var badges = (sim ? '<span class="camp-badge sim">' + esc(campTypeLabel(c.campaign_type).toUpperCase()) + '</span>' : '') +
      (c.status !== 'OPEN' ? '<span class="camp-badge st-' + esc(String(c.status).toLowerCase()) + '">' + esc(campStatusLabel(c.status)) + '</span>' : '');
    var label = '<span class="camp-lbl">' + (campEn() ? 'Active campaign' : 'Campagne active') + '</span><b>' + esc(c.code) + '</b>' + badges;
    if (!campLoaded || !campIsMgmt() || campList.length < 2) {
      return '<span class="ops-camp' + (sim ? ' is-sim' : '') + '" title="' + esc(c.name || '') + '">' + label +
        (campLoaded && campIsMgmt() ? ' <a class="camp-manage" href="campaigns.html">' + (campEn() ? 'Manage' : 'Gérer') + '</a>' : '') + '</span>';
    }
    function group(title, arr) {
      if (!arr.length) return '';
      return '<div class="camp-grp">' + esc(title) + '</div>' + arr.map(function (x) {
        return '<button type="button" data-camp="' + esc(x.id) + '" class="' + (x.id === c.id ? 'on' : '') + '"><b>' + esc(x.code) + '</b> ' +
          esc(x.name || '') + ' · ' + esc(campStatusLabel(x.status)) + (x.is_current ? ' · ' + (campEn() ? 'current' : 'courante') : '') + '</button>';
      }).join('');
    }
    var real = campList.filter(function (x) { return x.campaign_type === 'REAL'; });
    var others = campList.filter(function (x) { return x.campaign_type !== 'REAL'; });
    return '<details class="ops-camp' + (sim ? ' is-sim' : '') + '"><summary title="' + esc(c.name || '') + '">' + label + '</summary><div class="ops-camp-menu">' +
      group(campEn() ? 'Open campaigns' : 'Campagnes en cours', real.filter(function (x) { return ['OPEN','CLOSING','READY','PLANNING','DRAFT'].indexOf(x.status) >= 0; })) +
      group(campEn() ? 'History' : 'Historique', real.filter(function (x) { return ['CLOSED','ARCHIVED'].indexOf(x.status) >= 0; })) +
      group(campEn() ? 'Simulations / tests' : 'Simulations / tests', others) +
      '<a class="camp-manage" href="campaigns.html">' + (campEn() ? 'Manage campaigns →' : 'Gérer les campagnes →') + '</a></div></details>';
  }
  function campBanner() {
    var main = document.querySelector('.ops-main'); if (!main) return;
    var old = document.getElementById('opsCampBanner'); if (old) old.parentNode.removeChild(old);
    var c = campSel; if (!c) return;
    var msg = null, cls = '';
    if (c.status === 'CLOSED' || c.status === 'ARCHIVED') {
      cls = 'closed';
      msg = (campEn() ? 'CAMPAIGN ' + c.code + ' ' + campStatusLabel(c.status).toUpperCase() + ' — read only. No purchase, advance, delivery, reception or transfer can be recorded.'
                      : 'CAMPAGNE ' + c.code + ' ' + campStatusLabel(c.status).toUpperCase() + ' — lecture seule. Aucun achat, avance, livraison, réception ou transfert ne peut y être enregistré.');
    } else if (c.status === 'CLOSING') {
      cls = 'closing';
      msg = campEn() ? 'Campaign ' + c.code + ' is closing: corrections and reconciliations only, no new purchase.'
                     : 'Campagne ' + c.code + ' en clôture : corrections et rapprochements uniquement, aucun nouvel achat.';
    } else if (c.status !== 'OPEN') {
      cls = 'closing';
      msg = campEn() ? 'Campaign ' + c.code + ' not open yet (' + campStatusLabel(c.status) + ').' : 'Campagne ' + c.code + ' pas encore ouverte (' + campStatusLabel(c.status) + ').';
    }
    if (c.campaign_type && c.campaign_type !== 'REAL') {
      var s = campEn() ? 'SIMULATION — ' + (c.name || c.code) + ': test data, never mixed with real campaign figures.'
                       : 'SIMULATION — ' + (c.name || c.code) + ' : données de test, jamais mélangées aux chiffres d’une campagne réelle.';
      msg = msg ? s + ' ' + msg : s; cls = cls ? cls + ' sim' : 'sim';
    }
    if (!msg) return;
    var b = document.createElement('div'); b.id = 'opsCampBanner'; b.className = 'camp-banner ' + cls; b.setAttribute('data-i18n-ignore', '');
    b.setAttribute('role', 'status'); b.textContent = msg;
    main.insertBefore(b, main.firstChild);
  }
  function campPaint() {
    var slot = document.getElementById('opsCampaignSlot'); if (slot) slot.innerHTML = campPillHtml();
    campBanner();
    [].slice.call(document.querySelectorAll('[data-camp-code]')).forEach(function (el) { el.textContent = campSel ? campSel.code : '—'; });
    if (slot) [].slice.call(slot.querySelectorAll('button[data-camp]')).forEach(function (bt) {
      bt.onclick = function () { campSelect(bt.getAttribute('data-camp')); };
    });
  }
  function campSave() { try { localStorage.setItem(CAMP_CACHE, JSON.stringify(campSel)); localStorage.setItem(CAMP_CACHE + '_list', JSON.stringify(campList)); } catch (e) {} }
  function campSelect(id) {
    var x = campList.filter(function (c) { return c.id === id; })[0]; if (!x) return;
    try { localStorage.setItem(CAMP_SEL, id); } catch (e) {}
    campSel = x; campSave(); location.reload();
  }
  async function campLoad() {
    var sb = await waitClient(); if (!sb) { campReadyRes(campSel); return; }
    var r = await sb.from('campaigns').select('id,code,name,year,campaign_type,status,is_current,start_date,planned_end_date,closed_at,closed_with_reserves,row_version')
      .order('year', { ascending: false }).order('code');
    if (r.error) { campLoaded = true; campPaint(); campReadyRes(campSel); return; }
    campList = r.data || [];
    var want = null; try { want = localStorage.getItem(CAMP_SEL); } catch (e) {}
    var chosen = (campIsMgmt() && want ? campList.filter(function (c) { return c.id === want; })[0] : null) ||
                 campList.filter(function (c) { return c.is_current; })[0] || campList[0] || null;
    var before = campSel;
    campSel = chosen; campSave(); campLoaded = true; campPaint(); campReadyRes(campSel);
    document.dispatchEvent(new CustomEvent('anagroci:campaign', { detail: campSel }));
    /* Les modules lisent le code au chargement : si la campagne a changé depuis le dernier passage, on recharge une fois. */
    var moved = chosen && (!before || before.id !== chosen.id || before.status !== chosen.status);
    var guard = null; try { guard = sessionStorage.getItem('anagroci_campaign_reload'); } catch (e) {}
    if (moved && guard !== (chosen.id + chosen.status)) {
      try { sessionStorage.setItem('anagroci_campaign_reload', chosen.id + chosen.status); } catch (e) {}
      location.reload();
    }
  }
  function campStart() {
    if (global.ANAGROCI_AUTH) campLoad(); else document.addEventListener('anagroci:authenticated', function () { campLoad(); }, { once: true });
  }
  global.ANAGROCI_CAMPAIGN = {
    ready: campReady,
    get: function () { return campSel; },
    id: function () { return campSel ? campSel.id : null; },
    code: function () { return campSel ? campSel.code : null; },
    list: function () { return campList.slice(); },
    isOpen: function () { return !!campSel && campSel.status === 'OPEN'; },
    isReadOnly: function () { return !!campSel && (campSel.status === 'CLOSED' || campSel.status === 'ARCHIVED'); },
    isSimulation: function () { return !!campSel && campSel.campaign_type !== 'REAL'; },
    canRecordTransactions: function () { return !!campSel && campSel.status === 'OPEN'; },
    statusLabel: campStatusLabel, typeLabel: campTypeLabel, select: campSelect, isManagement: campIsMgmt,
    /* Message à afficher sur un formulaire de saisie quand la campagne choisie n'accepte pas de nouvelle opération. */
    blockedMessage: function () {
      var c = campSel; if (!c) return campEn() ? 'No campaign: ask the Branch Manager to open one.' : 'Aucune campagne : demandez au Branch Manager d’en ouvrir une.';
      if (c.status === 'OPEN') return null;
      return (campEn() ? 'Campaign ' + c.code + ' is ' : 'Campagne ' + c.code + ' ') + campStatusLabel(c.status).toLowerCase() +
        (campEn() ? ': no new operation can be recorded.' : ' : aucune nouvelle opération ne peut y être enregistrée.');
    }
  };

  async function boot() {
    renderShell();
    [].slice.call(document.querySelectorAll('.ops-contextbar span')).forEach(function (el) {
      if (/^\s*(Données à jour|Data up to date)\s*$/i.test(el.textContent)) { el.setAttribute('data-fresh', ''); el.setAttribute('data-i18n-ignore', ''); }
    });
    paintFresh();
    campPaint(); campStart();
    adoptUserSlot(); setTimeout(adoptUserSlot, 400); setTimeout(adoptUserSlot, 1500);
    document.addEventListener('anagroci:authenticated', function () { setTimeout(adoptUserSlot, 50); });
    var sb=await waitClient();
    if(!sb){setKpis([{label:'Connexion',value:'Indisponible',note:'Données indisponibles',cls:'danger'}]);return;}
    /* Finalisation 2027 : ces indicateurs ne sont dessinés que si la page porte un bloc #kpis. Avant, chaque
       ouverture de Field Buying, Warehouse, Stock Transfer ou Factory lançait quand même 3 à 4 lectures
       (dont 500 lignes de traçabilité) dont le résultat n'était jamais affiché, en concurrence avec le module. */
    if(!document.getElementById('kpis') && !document.getElementById('primaryTable') && !document.getElementById('traceForm')) return;
    if(PAGE==='field') return loadField(sb);
    if(PAGE==='lba') return loadLba(sb);
    if(PAGE==='warehouse') return loadWarehouse(sb);
    if(PAGE==='transfer') return loadTransfer(sb);
    if(PAGE==='factory') return loadFactory(sb);
    if(PAGE==='trace') return loadTrace(sb);
    if(PAGE==='reports') return loadReports(sb);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
  global.ANAGROCI_OPS={esc:esc,num:num,kgToMt:kgToMt,money:money};
})(window);
