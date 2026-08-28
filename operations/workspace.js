/* ANAGROCI Operations Suite — shell partagé des 5 workspaces.
   Réutilise les modules existants et affiche uniquement des KPI dérivés de Supabase.
   Aucune formule métier « À CONFIRMER » n'est inventée ici. */
(function (global) {
  'use strict';

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
      title: 'WAREHOUSE OPERATIONS', subtitle: 'Entrepôts externes · réception, lots, BIN et stock',
      nav: [
        ['overview','Overview','../operations/warehouse.html'],
        ['inbound','Inbound','../rcntrace/index.html'],
        ['quality','Quality','../rcntrace/index.html'],
        ['lots','RCN Lots','../rcntrace/index.html'],
        ['stock','Stock & BIN','../rcntrace/index.html'],
        ['drying','Drying / Sorting','../rcntrace/index.html'],
        ['bags','Bags','../rcntrace/index.html#jute'],
        ['inventory','Inventory','../rcntrace/index.html'],
        ['audit','Audit','../rcntrace/index.html']
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
    reports: { title:'REPORTS & EXPORT', subtitle:'Reporting Supabase et exports Excel', nav:[] }
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
    if (hash) return hash;
    if (/field-buying/.test(path)) return 'overview';
    if (/lba-purchase/.test(path)) return 'overview';
    if (/warehouse/.test(path)) return 'overview';
    if (/stock-transfer/.test(path)) return 'overview';
    if (/factory/.test(path)) return 'overview';
    return 'overview';
  }
  function renderShell() {
    var c = CFG[PAGE] || CFG.field;
    var top = document.getElementById('opsTopbar');
    if (top) top.innerHTML = '<a class="ops-brand" href="../index.html"><img src="../assets/logo-pjs-mark.png" alt="PJS Global"><span><strong>ANAGROCI OPERATIONS</strong><small>Operations Suite</small></span></a>' +
      '<div class="ops-title"><strong>'+esc(c.title)+'</strong><small>'+esc(c.subtitle)+'</small></div>' +
      '<div class="ops-top-actions"><span class="ops-pill light">Campagne 2027</span><span class="ops-pill"><span class="dot"></span>Supabase</span><span id="anagroci-userslot"></span></div>';
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
    setKpis([{label:'Chaînes terrain',value:c,note:'Farmer → Factory'},{label:'Liens généalogie RCN',value:g,note:'parent → enfant'},{label:'Recherche',value:'Cross-module',note:'Farmer / Lot / Shipment'},{label:'Parcelle 2027',value:'Non bloquante',note:'complétable après campagne'},{label:'Source de vérité',value:'Transactions',note:'pas de silo Traceability'}]);
    var form=document.getElementById('traceForm'); if(form) form.addEventListener('submit',function(e){e.preventDefault();traceSearch(sb,document.getElementById('traceQuery').value);});
  }
  async function loadReports(sb){
    var lba=await count(sb,'rcn_fournisseurs',function(q){return q.like('code','LBA-%');}); var trf=await count(sb,'rcn_v_transferts'); var rec=await count(sb,'rcn_v_receptions');
    setKpis([{label:'LBA master',value:lba,note:'source Supabase'},{label:'Réceptions',value:rec,note:'reporting physique'},{label:'Transferts',value:trf,note:'reporting logistique'},{label:'Excel',value:'Output',note:'plus de base transactionnelle'},{label:'Metadata',value:'Obligatoire',note:'campagne · filtres · version'}]);
  }

  async function boot() {
    renderShell();
    var sb=await waitClient();
    if(!sb){setKpis([{label:'Connexion',value:'Indisponible',note:'Supabase non chargé',cls:'danger'}]);return;}
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
