/* ANAGROCI Procurement — canonical RCN purchases control center. */
(function(global){'use strict';
var root,sb,state={page:0,pageSize:50,filters:{}};
function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function n(v){var x=Number(v||0);return isFinite(x)?x:0;}
function num(v,d){return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:d==null?0:d}).format(n(v));}
function money(v){return num(v,0)+' FCFA';}
function kg(v){return num(v,1)+' kg';}
function mt(v){return num(n(v)/1000,2)+' MT';}
function dt(v){if(!v)return'—';try{return new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch(e){return esc(v);}}
function parts(){return(location.hash||'#overview').slice(1).split('?')[0].split('/').filter(Boolean);}
function route(){return parts()[0]||'overview';}
function badge(s){var x=String(s||'').toUpperCase(),c=/REJECT|REFUS|BLOQ|VARIANCE|FAILED|EXCEPTION|MISSING/.test(x)?'danger':/ACTIVE|ACTIF|APPROUV|BALANCED|RECEIVED|CLOSED|PAID|READY/.test(x)?'ok':/PENDING|ATTENT|DISPATCH|TRANSIT|DRAFT|REVIEW|SUBMITTED|PARTIAL|CHANGES/.test(x)?'warn':'info';return'<span class="badge '+c+'">'+esc(s||'—')+'</span>';}
function head(t,s,a){return'<div class="ops-route-head"><div><h1>'+esc(t)+'</h1><p>'+esc(s||'')+'</p></div><div class="ops-route-actions">'+(a||'')+'</div></div>';}
function table(h,r){if(!r.length)return'<div class="ops-empty">Aucune donnée.</div>';return'<div class="table-wrap"><table><thead><tr>'+h.map(function(x){return'<th>'+esc(x)+'</th>';}).join('')+'</tr></thead><tbody>'+r.join('')+'</tbody></table></div>';}
function kpis(a){return'<section class="kpi-grid">'+a.map(function(x){return'<div class="kpi '+(x[3]||'')+'"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b><span>'+esc(x[2]||'')+'</span></div>';}).join('')+'</section>';}
function field(l,nm,type,val,attr){return'<div class="ops-field"><label>'+esc(l)+'</label><input name="'+esc(nm)+'" type="'+(type||'text')+'" value="'+esc(val==null?'':val)+'" '+(attr||'')+'></div>';}
function select(l,nm,opts,val,attr){return'<div class="ops-field"><label>'+esc(l)+'</label><select name="'+esc(nm)+'" '+(attr||'')+'>'+opts.map(function(o){return'<option value="'+esc(o[0])+'" '+(String(o[0])===String(val==null?'':val)?'selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select></div>';}
function formObj(f){var o={};new FormData(f).forEach(function(v,k){o[k]=String(v).trim();});return o;}
function waitClient(){return new Promise(function(resolve){var i=0,t=setInterval(function(){i++;if(global.supabase&&global.ANAGROCI_SUPABASE_URL&&global.ANAGROCI_SUPABASE_ANON){clearInterval(t);resolve(global.supabase.createClient(global.ANAGROCI_SUPABASE_URL,global.ANAGROCI_SUPABASE_ANON));}else if(i>100){clearInterval(t);resolve(null);}},80);});}
async function q(name,cols,build){var x=sb.from(name).select(cols||'*');if(build)x=build(x);var r=await x;if(r.error)throw new Error(r.error.message);return r.data||[];}
async function one(name,cols,build){var a=await q(name,cols,build);return a[0]||null;}
async function rpc(name,args){var r=await sb.rpc(name,args||{});if(r.error)throw new Error(r.error.message);return r.data;}
async function paged(name,build,page,size){var x=sb.from(name).select('*',{count:'exact'});if(build)x=build(x);x=x.range(page*size,page*size+size-1);var r=await x;if(r.error)throw new Error(r.error.message);return{rows:r.data||[],count:r.count||0};}
async function load(){
 var rs=await Promise.all([
  q('procurement_v_purchase_feed','*',function(x){return x.eq('procurement_channel','FIELD_BUYING').order('purchase_at',{ascending:false}).limit(500);}),
  q('rcn_fournisseurs','supplier_id,code,nom,categorie,statut,origines,sites,volume_livre_kg,kor_moyen,humidite_moyenne',function(x){return x.order('code').limit(1000);}),
  q('field_lots','*',function(x){return x.order('created_at',{ascending:false}).limit(500);}),
  q('field_lot_contributors','*',function(x){return x.eq('status','ACTIVE').limit(2000);}),
  q('field_shipments','*',function(x){return x.order('created_at',{ascending:false}).limit(500);}),
  q('procurement_v_pending_receptions','*',function(x){return x.order('source_date',{ascending:false}).limit(500);}),
  q('procurement_v_reconciliation','*',function(x){return x.order('departed_at',{ascending:false}).limit(500);}),
  q('procurement_campaign_rules','*',function(x){return x.order('effective_from',{ascending:false}).limit(200);}),
  q('procurement_purchase_types','*',function(x){return x.eq('active',true).order('code');}),
  q('wms_warehouses','id,code,name,status',function(x){return x.eq('status','ACTIVE').order('code');}),
  q('rcn_proc_prix','id,supplier_code,campagne,prix_propose,prix_bm,prix_approuve,kor_min,humidite_max,site,valide_du,valide_au,statut',function(x){return x.order('created_at',{ascending:false}).limit(300);}),
  q('procurement_v_purchase_action_queue','*',function(x){return x.order('event_at',{ascending:false}).limit(100);}),
  q('procurement_v_purchase_kpis','*')
 ]);
 state.fieldPurchases=rs[0];state.suppliers=rs[1];state.lots=rs[2];state.contributors=rs[3];state.shipments=rs[4];state.pending=rs[5];state.recon=rs[6];state.rules=rs[7];state.types=rs[8];state.warehouses=rs[9];state.priceRules=rs[10];state.actionQueue=rs[11];state.kpi=rs[12][0]||{};
}
function overview(){
 var k=state.kpi||{};
 root.innerHTML=head('Procurement Control Tower','Planning, achats commerciaux, Field Buying et rapprochement sans mélanger les vérités métier.')+
 kpis([['Commercial Weight',mt(k.total_commercial_weight_kg),'tous canaux'],['Purchase Value',money(k.purchase_value_fcfa),'valeur consolidée'],['Weighted Avg Price',money(k.weighted_avg_price_per_kg),'par kg'],['Awaiting Approval',String(k.awaiting_approval||0),'action management','attn'],['Awaiting Payment',String(k.awaiting_payment||0),'action Finance','attn'],['Exceptions',String(k.exceptions||0),'prix / qualité / variance','danger']])+
 '<div class="grid-2"><section class="card"><h2>Actions prioritaires</h2>'+table(['Action','Référence','Canal','Counterparty','Qty','Amount'],state.actionQueue.slice(0,20).map(function(x){return'<tr><td>'+badge(x.action_type)+'</td><td class="mono">'+esc(x.reference)+'</td><td>'+esc(x.procurement_channel||'—')+'</td><td>'+esc(x.counterparty||'—')+'</td><td>'+kg(x.qty_kg)+'</td><td>'+money(x.amount)+'</td></tr>'; }))+'</section>'+
 '<section class="card"><h2>Architecture</h2><div class="notice info"><b>Field Buying</b> = achat terrain · <b>Procurement</b> = vérité commerciale · <b>Warehouse</b> = vérité physique · <b>Finance</b> = vérité paiement.</div><div class="ops-actions" style="margin-top:12px"><a class="btn secondary" href="#arrivals">Arrivages prévus</a><a class="btn secondary" href="#purchases">Achat RCN</a><a class="btn secondary" href="warehouse.html#inbound">Warehouse</a></div></section></div>';
}
function arrivals(){
 var supplierTypes=(state.types||[]).filter(function(x){return x.channel_code!=='FIELD_BUYING';});
 var activeSup=state.suppliers.filter(function(x){return String(x.statut).toUpperCase()==='ACTIF';});
 root.innerHTML=head('Arrivages prévus','Procurement Planning : préparer les Procurement References destinées au Warehouse.','<button class="btn primary" onclick="ANAGROCI_PROC.toggleArrival()">+ Planned Supplier Arrival</button>')+
 '<section id="arrivalFormHost" class="ops-form-card" hidden><h2>Plan LBA / Direct / Cooperative Arrival</h2><p class="muted">Ceci planifie une arrivée. Ce n’est pas encore un Achat RCN commercial.</p><form id="arrivalForm"><div class="ops-form-grid">'+
 select('Purchase Type','purchase_type',[['','Choisir…']].concat(supplierTypes.map(function(x){return[x.code,x.label+' · '+x.channel_code];})),'','required')+
 select('Supplier','supplier_code',[['','Choisir…']].concat(activeSup.map(function(x){return[x.code,x.code+' - '+x.nom];})),'','required')+
 field('Origin','origin','text','','required')+
 select('Destination Warehouse','warehouse_id',[['','Choisir…']].concat(state.warehouses.map(function(w){return[w.id,w.code+' - '+w.name];})),'','required')+
 field('Expected kg','expected_kg','number','','required min="0.001" step="0.001"')+
 field('Expected bags','expected_bags','number','','min="0"')+
 field('Expected Date / Time','expected_at','datetime-local','')+
 field('Truck','truck','text','')+field('Driver','driver','text','')+field('Transporter','transporter','text','')+field('Reference','reference','text','')+
 '</div><div class="ops-actions"><button class="btn primary">Create Planned Arrival</button></div><div id="arrivalMsg" class="muted"></div></form></section>'+
 '<section class="card"><h2>Pending Supplier Arrivals</h2>'+table(['Reference','Channel','Supplier','Origin','Truck','Expected','Warehouse','Date'],state.pending.filter(function(x){return x.source_type!=='FIELD_SHIPMENT';}).map(function(x){return'<tr><td class="mono">'+esc(x.source_ref)+'</td><td>'+badge(x.procurement_channel)+'</td><td>'+esc((x.supplier_code||'')+' '+(x.supplier_name||''))+'</td><td>'+esc(x.origin||'—')+'</td><td>'+esc(x.truck||'À compléter')+'</td><td>'+kg(x.expected_kg)+'</td><td>'+esc(x.warehouse_code||'—')+'</td><td>'+dt(x.source_date)+'</td></tr>'; }))+'</section>';
 bindArrival();
}
function filterForm(){
 var f=state.filters||{};
 return'<form id="purchaseFilters" class="ops-form-card"><div class="ops-form-grid">'+
 field('Date From','date_from','date',f.date_from||'')+field('Date To','date_to','date',f.date_to||'')+
 select('Channel','channel',[['','All'],['LBA','LBA'],['COOPERATIVE','Cooperative'],['DIRECT','Direct']],f.channel||'')+
 select('Supplier','supplier',[['','All']].concat(state.suppliers.map(function(x){return[x.code,x.code+' - '+x.nom];})),f.supplier||'')+
 select('Warehouse','warehouse',[['','All']].concat(state.warehouses.map(function(x){return[x.code,x.code+' - '+x.name];})),f.warehouse||'')+
 select('Approval','approval',[['','All'],['DRAFT','Draft'],['SUBMITTED','Submitted'],['CHANGES_REQUESTED','Changes Requested'],['APPROVED','Approved'],['REJECTED','Rejected']],f.approval||'')+
 select('Payment','payment',[['','All'],['AWAITING_BAP','Awaiting BAP'],['UNPAID','Unpaid'],['PENDING','Pending'],['PARTIAL','Partial'],['PAID','Paid'],['FAILED','Failed'],['REVERSED','Reversed']],f.payment||'')+
 field('Search','search','search',f.search||'','placeholder="Purchase / Supplier / Reception"')+
 '</div><div class="ops-actions"><button class="btn primary">Apply Filters</button><button type="button" class="btn secondary" data-action="reset-filters">Reset</button></div></form>';
}
async function purchaseRegister(){
 var f=state.filters||{},page=state.page||0,size=state.pageSize||50;
 var res=await paged('procurement_v_supplier_purchase_register',function(x){
   x=x.order('purchase_at',{ascending:false});
   if(f.channel)x=x.eq('procurement_channel',f.channel);
   if(f.supplier)x=x.eq('supplier_code',f.supplier);
   if(f.warehouse)x=x.eq('warehouse_code',f.warehouse);
   if(f.approval)x=x.eq('approval_status',f.approval);
   if(f.payment)x=x.eq('payment_status',f.payment);
   if(f.date_from)x=x.gte('purchase_at',f.date_from+'T00:00:00');
   if(f.date_to)x=x.lte('purchase_at',f.date_to+'T23:59:59');
   if(f.search)x=x.or('purchase_code.ilike.%'+f.search+'%,supplier_name.ilike.%'+f.search+'%,reception_id.ilike.%'+f.search+'%');
   return x;
 },page,size);
 var k=state.kpi||{},pages=Math.max(1,Math.ceil(res.count/size));
 root.innerHTML=head('ACHAT RCN','Commercial control of purchased RCN across Field Buying, LBA, Cooperative and Direct Supplier.')+
 kpis([['Paid / Commercial Weight',mt(k.total_commercial_weight_kg),'tous canaux'],['Purchase Value',money(k.purchase_value_fcfa),'FCFA'],['Weighted Avg Price',money(k.weighted_avg_price_per_kg),'par kg'],['Awaiting Approval',String(k.awaiting_approval||0),'management','attn'],['Awaiting Payment',String(k.awaiting_payment||0),'Finance','attn'],['Exceptions',String(k.exceptions||0),'à traiter','danger']])+
 '<section class="card"><h2>Purchases Requiring Action</h2>'+table(['Action','Reference','Channel','Counterparty','Warehouse','Qty','Amount'],state.actionQueue.slice(0,30).map(function(x){
   var click=x.action_type==='READY_FOR_SETTLEMENT'?' data-action="prepare-purchase" data-reception="'+esc(x.object_id)+'"':'';
   return'<tr class="ops-click" '+click+'><td>'+badge(x.action_type)+'</td><td class="mono">'+esc(x.reference)+'</td><td>'+esc(x.procurement_channel||'—')+'</td><td>'+esc(x.counterparty||'—')+'</td><td>'+esc(x.warehouse_code||'—')+'</td><td>'+kg(x.qty_kg)+'</td><td>'+money(x.amount)+'</td></tr>';
 }))+'</section>'+
 filterForm()+
 '<section class="card"><div class="card-head"><div><h2>Supplier Purchase Register</h2><p>'+res.count+' dossier(s) · page '+(page+1)+' / '+pages+'</p></div></div>'+
 table(['Purchase ID','Date','Channel','Counterparty','Warehouse / Reception','Net kg','Paid kg','Price/kg','Amount','Approval','Payment','Action'],res.rows.map(function(x){return'<tr class="ops-click" data-href="#purchases/'+encodeURIComponent(x.purchase_id)+'"><td class="mono"><b>'+esc(x.purchase_code)+'</b></td><td>'+dt(x.purchase_at)+'</td><td>'+badge(x.procurement_channel)+'</td><td><b>'+esc(x.supplier_code||'—')+'</b><br>'+esc(x.supplier_name||'—')+'</td><td>'+esc(x.warehouse_code||'—')+'<br><span class="mono">'+esc(x.reception_id)+'</span></td><td>'+kg(x.warehouse_net_kg)+'</td><td>'+kg(x.paid_weight_kg)+'</td><td>'+money(x.effective_price)+'</td><td>'+money(x.amount_approved||x.amount_submitted)+'</td><td>'+badge(x.approval_status)+'</td><td>'+badge(x.payment_status)+'</td><td>Open</td></tr>'; }))+
 '<div class="ops-actions" style="margin-top:12px"><button class="btn secondary" data-action="page-prev" '+(page<=0?'disabled':'')+'>← Previous</button><button class="btn secondary" data-action="page-next" '+(page+1>=pages?'disabled':'')+'>Next →</button></div></section>'+
 '<section class="card"><h2>Field Buying — vue consolidée par Evacuation</h2><div class="notice info">Les achats producteurs restent dans Field Buying. Procurement affiche ici une consolidation, avec drill-down de traçabilité ailleurs.</div><div id="fieldSummaryHost">Chargement…</div></section>';
 bindPurchaseFilters();
 loadFieldSummary();
}
async function loadFieldSummary(){
 var host=document.getElementById('fieldSummaryHost');if(!host)return;
 try{
   var r=await q('procurement_v_field_purchase_summary','*',function(x){return x.order('purchase_at',{ascending:false}).limit(20);});
   host.innerHTML=table(['Evacuation','Clusters','Villages','Field kg','Warehouse Net','Variance','Value','Status'],r.map(function(x){return'<tr><td class="mono">'+esc(x.shipment_code)+'</td><td>'+esc(x.clusters||'—')+'</td><td>'+esc(x.villages||'—')+'</td><td>'+kg(x.field_weight_kg)+'</td><td>'+kg(x.warehouse_net_kg)+'</td><td>'+kg(x.variance_kg)+'</td><td>'+money(x.field_purchase_value)+'</td><td>'+badge(x.reconciliation_status)+'</td></tr>'; }));
 }catch(e){host.innerHTML='<div class="notice danger">'+esc(e.message)+'</div>';}
}
async function purchasePassport(id){
 var p=await one('procurement_v_supplier_purchase_register','*',function(x){return x.eq('purchase_id',id).limit(1);});
 if(!p){root.innerHTML=head('Purchase introuvable','Aucun dossier correspondant.','<a class="btn secondary" href="#purchases">Retour</a>');return;}
 var auditRows=await q('rcn_audit','id,objet,champ,motif,auteur,role,created_at',function(x){return x.eq('objet',p.reception_id).order('created_at',{ascending:false}).limit(100);}).catch(function(){return[];});
 var pays=p.bap_id?await q('rcn_proc_paiements','*',function(x){return x.eq('bon_payer_id',p.bap_id).order('created_at',{ascending:false}).limit(100);}):[];
 var priceOpts=[['','No Price Reference']].concat(state.priceRules.filter(function(x){return x.supplier_code===p.supplier_code&&x.statut==='APPROUVE';}).map(function(x){return[x.id,x.id+' · '+money(x.prix_approuve||x.prix_bm||x.prix_propose)];}));
 var actions='';
 if(['DRAFT','CHANGES_REQUESTED'].indexOf(p.approval_status)>=0){
   actions+='<form class="card" data-action="save-draft" data-id="'+esc(p.purchase_id)+'" data-reception="'+esc(p.reception_id)+'"><h2>Commercial Settlement</h2><div class="ops-form-grid">'+
   select('Refraction Mode','refraction_mode',[['NONE','None'],['KG','kg'],['PERCENT','%']],p.refraction_mode||'NONE')+
   field('Refraction Value','refraction_value','number',p.refraction_value||0,'step="0.001" min="0"')+
   field('Refraction Reason','refraction_reason','text',p.refraction_reason||'')+
   field('Warehouse Net kg','net_snapshot','number',p.warehouse_net_kg,'readonly')+
   field('Paid Weight kg','paid_weight','number',p.paid_weight_kg,'readonly')+
   select('Price Reference','price_ref',priceOpts,p.price_ref||'')+
   field('Negotiated Price/kg','negotiated_price','number',p.negotiated_price||'','step="0.01" min="0.01"')+
   field('Note','note','text','')+'</div><div class="ops-actions"><button class="btn primary">Save Draft</button></div></form>'+
   '<form class="card" data-action="submit-purchase" data-id="'+esc(p.purchase_id)+'"><h2>Submit for Approval</h2><div class="ops-form-grid">'+field('Submitted Price/kg','submitted_price','number',p.negotiated_price||p.submitted_price||'','required step="0.01" min="0.01"')+field('Reason / Exception Justification','reason','text','')+'</div><div class="ops-actions"><button class="btn primary">Submit Purchase</button></div></form>';
 }
 if(p.approval_status==='SUBMITTED'){
   actions+='<form class="card" data-action="purchase-decision" data-id="'+esc(p.purchase_id)+'"><h2>General Management Decision</h2><div class="ops-form-grid">'+field('Approved Price/kg','approved_price','number',p.submitted_price||'','step="0.01" min="0.01"')+field('Decision Reason','reason','text','','required')+'</div><div class="ops-actions"><button class="btn primary" name="decision" value="approve">Approve</button><button class="btn secondary" name="decision" value="changes">Request Changes</button><button class="btn signal" name="decision" value="reject">Reject</button></div></form>';
 }
 if(p.approval_status==='APPROVED'){
   if(p.bap_status==='BROUILLON'||p.bap_status==='A_CORRIGER'){
     actions+='<form class="card" data-action="submit-bap" data-id="'+esc(p.bap_id)+'"><h2>Bon à Payer</h2><div class="ops-form-grid">'+field('Invoice Reference','facture_ref','text','','required')+field('Invoice Date','facture_date','date','')+field('Comment','comment','text','')+'</div><div class="ops-actions"><button class="btn primary">Submit BAP to Finance</button></div></form>';
   }else if(p.bap_status==='SOUMIS_FINANCE'){
     actions+='<form class="card" data-action="decide-bap" data-id="'+esc(p.bap_id)+'"><h2>Finance Approval</h2><div class="ops-form-grid">'+field('Reason','reason','text','','required')+'</div><div class="ops-actions"><button class="btn primary" name="decision" value="approve">Approve BAP</button><button class="btn secondary" name="decision" value="reject">Request Correction</button></div></form>';
   }else if(['APPROUVE_FINANCE','PARTIELLEMENT_PAYE'].indexOf(p.bap_status)>=0){
     actions+='<form class="card" data-action="record-payment" data-id="'+esc(p.bap_id)+'"><h2>Record Payment</h2><div class="ops-form-grid">'+field('Amount','amount','number',p.outstanding_amount||'','required step="0.01" min="0.01"')+select('Mode','mode',[['VIREMENT','Virement'],['CHEQUE','Chèque'],['ESPECES','Espèces'],['COMPENSATION','Compensation'],['AUTRE','Autre']],'VIREMENT')+field('Payment Date','date','date',new Date().toISOString().slice(0,10),'required')+field('Bank Reference','reference','text','')+field('Bank','bank','text','')+field('Reason','reason','text','')+'</div><div class="ops-actions"><button class="btn primary">Record Payment</button></div></form>';
   }
 }
 root.innerHTML=head('PURCHASE PASSPORT',p.purchase_code+' · '+p.supplier_name,'<a class="btn secondary" href="#purchases">← Achat RCN</a>')+
 '<section class="card"><h2>Identity</h2><div class="ops-def-grid"><div><small>Purchase ID</small><b>'+esc(p.purchase_code)+'</b></div><div><small>Channel</small><b>'+esc(p.procurement_channel)+'</b></div><div><small>Purchase Type</small><b>'+esc(p.purchase_type)+'</b></div><div><small>Supplier</small><b>'+esc(p.supplier_code+' · '+p.supplier_name)+'</b></div><div><small>Reception</small><b>'+esc(p.reception_id)+'</b></div><div><small>Warehouse</small><b>'+esc(p.warehouse_code||'—')+'</b></div></div></section>'+
 '<section class="card"><h2>Physical Truth — Warehouse READ ONLY</h2><div class="ops-def-grid"><div><small>Truck</small><b>'+esc(p.truck||'—')+'</b></div><div><small>Origin</small><b>'+esc(p.origin||'—')+'</b></div><div><small>Warehouse Net</small><b>'+kg(p.warehouse_net_kg)+'</b></div><div><small>Bags</small><b>'+esc(p.bags==null?'—':p.bags)+'</b></div></div></section>'+
 '<section class="card"><h2>Quality — READ ONLY</h2><div class="ops-def-grid"><div><small>Quality Source</small><b>'+esc(p.quality_source||'—')+'</b></div><div><small>Sampling KOR</small><b>'+esc(p.sampling_kor==null?'—':p.sampling_kor)+'</b></div><div><small>Final KOR</small><b>'+esc(p.final_kor==null?'—':p.final_kor)+'</b></div><div><small>Final Moisture</small><b>'+esc(p.final_moisture==null?'—':p.final_moisture+' %')+'</b></div><div><small>Quality Exception</small><b>'+badge(p.quality_exception?'YES':'NO')+'</b></div></div></section>'+
 '<section class="card"><h2>Commercial Settlement</h2><div class="ops-def-grid"><div><small>Warehouse Net</small><b>'+kg(p.warehouse_net_kg)+'</b></div><div><small>Refraction</small><b>'+kg(p.refraction_kg)+'</b></div><div><small>Paid Weight</small><b>'+kg(p.paid_weight_kg)+'</b></div><div><small>Reference Price</small><b>'+money(p.reference_price)+'</b></div><div><small>Negotiated</small><b>'+money(p.negotiated_price)+'</b></div><div><small>Submitted</small><b>'+money(p.submitted_price)+'</b></div><div><small>Approved</small><b>'+money(p.approved_price)+'</b></div><div><small>Amount Approved</small><b>'+money(p.amount_approved)+'</b></div></div></section>'+
 '<section class="card"><h2>Approval</h2><div class="ops-def-grid"><div><small>Status</small><b>'+badge(p.approval_status)+'</b></div><div><small>Submitted by</small><b>'+esc(p.submitted_by_name||'—')+'</b></div><div><small>Submitted at</small><b>'+dt(p.submitted_at)+'</b></div><div><small>Approved by</small><b>'+esc(p.approved_by_name||'—')+'</b></div><div><small>Approved at</small><b>'+dt(p.approved_at)+'</b></div><div><small>Decision</small><b>'+esc(p.decision_reason||'—')+'</b></div></div></section>'+
 '<section class="card"><h2>Finance</h2><div class="ops-def-grid"><div><small>BAP</small><b>'+esc(p.bap_id||'—')+'</b></div><div><small>BAP Status</small><b>'+badge(p.bap_status||'—')+'</b></div><div><small>Amount Payable</small><b>'+money(p.amount_approved)+'</b></div><div><small>Amount Paid</small><b>'+money(p.amount_paid)+'</b></div><div><small>Outstanding</small><b>'+money(p.outstanding_amount)+'</b></div><div><small>Payment</small><b>'+badge(p.payment_status)+'</b></div></div>'+
 table(['Payment','Date','Amount','Mode','Reference','Status','Action'],pays.map(function(x){return'<tr><td class="mono">'+esc(x.id)+'</td><td>'+esc(x.date_paiement)+'</td><td>'+money(x.montant)+'</td><td>'+esc(x.mode)+'</td><td>'+esc(x.reference_bancaire||'—')+'</td><td>'+badge(x.statut)+'</td><td>'+(x.statut==='ENREGISTRE'?'<button class="btn secondary" data-action="reconcile-payment" data-id="'+esc(x.id)+'" data-accept="true">Reconcile</button>':'—')+'</td></tr>'; }))+'</section>'+
 actions+
 '<section class="card"><h2>Audit Timeline</h2>'+table(['Date','Action','Reason','User','Role'],auditRows.map(function(x){return'<tr><td>'+dt(x.created_at)+'</td><td>'+esc(x.champ||'—')+'</td><td>'+esc(x.motif||'—')+'</td><td>'+esc(x.auteur||'—')+'</td><td>'+esc(x.role||'—')+'</td></tr>'; }))+'</section>';
 bindPurchaseActions();
}
async function purchases(){var p=parts();if(p[1])return purchasePassport(decodeURIComponent(p[1]));return purchaseRegister();}
function fieldBuying(){
 var p=state.fieldPurchases||[];
 root.innerHTML=head('Achat Bord Champ','RT → Producteur → Achat → Consolidation → Evacuation → Warehouse.','<a class="btn primary" href="field-buying.html#purchases">Ouvrir Field Buying</a>')+
 kpis([['Achats récents chargés',String(p.length),'transactions terrain'],['Volume terrain chargé',mt(p.reduce(function(t,x){return t+n(x.field_or_net_kg);},0)),'vue opérationnelle'],['Lots terrain',String(state.lots.length),'consolidations'],['Evacuations',String(state.shipments.length),'shipments']])+
 '<section class="card"><h2>Principe</h2><p>Un RT n’est pas un Supplier. Les achats producteurs restent dans Field Buying; Procurement consolide au niveau Evacuation et rapproche Field Weight du Warehouse Net Weight.</p></section>';
}
async function lbaProfile(id){
 var p=await one('procurement_v_supplier_admin_profile','*',function(x){return x.eq('supplier_id',id).limit(1);});
 if(!p){root.innerHTML=head('LBA introuvable','Aucune fiche administrative correspondante.','<a class="btn secondary" href="#lba">← LBA</a>');return;}
 var docs=await q('procurement_supplier_documents','id,supplier_id,document_type,title,document_number,issue_date,expiry_date,campaign,storage_path,original_file_name,mime_type,size_bytes,status,note,created_at',function(x){return x.eq('supplier_id',id).order('created_at',{ascending:false}).limit(100);}).catch(function(){return[];});
 var banks=await q('procurement_v_supplier_bank_masked','*',function(x){return x.eq('supplier_id',id).order('created_at',{ascending:false}).limit(20);}).catch(function(){return[];});
 var primary=banks.filter(function(x){return x.is_primary&&x.status==='ACTIVE';})[0]||null;
 root.innerHTML=head('LBA DIGITAL PROFILE',p.current_code+' · '+p.display_name,'<a class="btn secondary" href="#lba">← Registry LBA</a>')+
 '<section class="card"><h2>Identité & conformité</h2><div class="ops-def-grid">'+
 '<div><small>Code LBA</small><b>'+esc(p.current_code||'—')+'</b></div>'+
 '<div><small>Code CCAK</small><b>'+esc(p.ccak_code||'—')+'</b></div>'+
 '<div><small>Nom</small><b>'+esc(p.display_name||'—')+'</b></div>'+
 '<div><small>Raison sociale</small><b>'+esc(p.legal_name||'—')+'</b></div>'+
 '<div><small>Type entité</small><b>'+esc(p.entity_type||'—')+'</b></div>'+
 '<div><small>Mode Procurement</small><b>'+badge(p.procurement_mode)+'</b></div>'+
 '<div><small>Contact</small><b>'+esc(p.contact_person||'—')+'</b></div>'+
 '<div><small>Téléphone</small><b>'+esc(p.phone||'—')+'</b></div>'+
 '<div><small>Téléphone 2</small><b>'+esc(p.phone_alt||'—')+'</b></div>'+
 '<div><small>Email</small><b>'+esc(p.email||'—')+'</b></div>'+
 '<div><small>RCCM / Registration</small><b>'+esc(p.registration_no||'—')+'</b></div>'+
 '<div><small>Identifiant fiscal</small><b>'+esc(p.tax_id||'—')+'</b></div>'+
 '<div><small>Contrat</small><b>'+badge(p.contract_status)+'</b></div>'+
 '<div><small>Référence contrat</small><b>'+esc(p.contract_reference||'—')+'</b></div>'+
 '</div></section>'+
 '<section class="ops-form-card"><h2>Modifier les informations administratives</h2><form id="lbaAdminForm" data-supplier="'+esc(id)+'" data-version="'+esc(p.row_version)+'"><div class="ops-form-grid">'+
 field('Nom','display_name','text',p.display_name||'','required')+
 field('Raison sociale','legal_name','text',p.legal_name||'')+
 select('Type entité','entity_type',[['COOPERATIVE','Coopérative'],['COMPANY','Société'],['INDIVIDUAL','Individuel'],['OTHER','Autre']],p.entity_type||'COOPERATIVE')+
 field('Code CCAK','ccak_code','text',p.ccak_code||'','placeholder="Code CCAK"')+
 field('Contact principal','contact_person','text',p.contact_person||'')+
 field('Téléphone','phone','tel',p.phone||'')+
 field('Téléphone alternatif','phone_alt','tel',p.phone_alt||'')+
 field('Email','email','email',p.email||'')+
 field('RCCM / N° enregistrement','registration_no','text',p.registration_no||'')+
 field('Identifiant fiscal','tax_id','text',p.tax_id||'')+
 field('Région','region','text',p.region||'')+
 field('Adresse','address','text',p.address||'')+
 select('Statut contrat','contract_status',[['NONE','Aucun'],['ACTIVE','Actif'],['EXPIRED','Expiré'],['CLOSED','Clôturé']],p.contract_status||'NONE')+
 field('Référence contrat','contract_reference','text',p.contract_reference||'')+
 field('Validité contrat - début','contract_valid_from','date',p.contract_valid_from||'')+
 field('Validité contrat - fin','contract_valid_to','date',p.contract_valid_to||'')+
 '</div><div class="ops-actions"><button class="btn primary">Enregistrer les modifications</button></div><div id="lbaAdminMsg" class="muted"></div></form></section>'+
 '<section class="card"><h2>RIB / Coordonnées bancaires</h2>'+
 (primary?'<div class="ops-def-grid"><div><small>Banque</small><b>'+esc(primary.bank_name||'—')+'</b></div><div><small>Titulaire</small><b>'+esc(primary.account_holder||'—')+'</b></div><div><small>Compte</small><b>'+esc(primary.account_number_masked||'—')+'</b></div><div><small>IBAN</small><b>'+esc(primary.iban_masked||'—')+'</b></div><div><small>Clé RIB</small><b>'+esc(primary.rib_key||'—')+'</b></div><div><small>SWIFT/BIC</small><b>'+esc(primary.swift_bic||'—')+'</b></div></div>':'<div class="notice info">Aucun RIB actif enregistré.</div>')+
 '<form id="lbaBankForm" data-supplier="'+esc(id)+'" style="margin-top:14px"><h3>'+(primary?'Remplacer le RIB actif':'Enregistrer le RIB')+'</h3><div class="ops-form-grid">'+
 field('Titulaire du compte','account_holder','text',p.display_name||'','required')+
 field('Banque','bank_name','text','','required')+
 field('Code banque','bank_code','text','')+
 field('Code guichet / agence','branch_code','text','')+
 field('Numéro de compte','account_number','text','','required autocomplete="off"')+
 field('Clé RIB','rib_key','text','')+
 field('IBAN','iban','text','')+
 field('SWIFT / BIC','swift_bic','text','')+
 field('Devise','currency','text','XOF','required maxlength="3"')+
 field('Motif','reason','text',primary?'Remplacement du RIB':'Création du RIB','required')+
 '</div><div class="ops-actions"><button class="btn primary">'+(primary?'Remplacer le RIB':'Enregistrer le RIB')+'</button></div><div id="lbaBankMsg" class="muted"></div></form></section>'+
 '<section class="card"><h2>Coffre documentaire privé</h2><p class="muted">PDF/JPEG/PNG/WEBP · 15 Mo max · liens de consultation temporaires uniquement.</p>'+
 '<form id="lbaDocForm" data-supplier="'+esc(id)+'"><div class="ops-form-grid">'+
 select('Type de document','document_type',[['CONTRAT','Contrat'],['RCCM','RCCM'],['PROCURATION','Procuration'],['DELEGATION_POUVOIR','Délégation de pouvoir'],['AUTORISATION_SIGNATURE','Autorisation de signature'],['DFE','DFE'],['RIB','RIB'],['OTHER','Autre']],'CONTRAT','required')+
 field('Titre','title','text','','required')+
 field('N° document','document_number','text','')+
 field('Date émission','issue_date','date','')+
 field('Date expiration','expiry_date','date','')+
 field('Campagne','campaign','text','2027')+
 field('Note','note','text','')+
 '<div class="ops-field"><label>Fichier</label><input name="file" type="file" accept=".pdf,image/jpeg,image/png,image/webp" required></div>'+
 '</div><div class="ops-actions"><button class="btn primary">Ajouter le document</button></div><div id="lbaDocMsg" class="muted"></div></form>'+
 table(['Type','Titre','N°','Campagne','Émission','Expiration','Fichier','Statut','Action'],docs.map(function(x){return'<tr><td>'+badge(x.document_type)+'</td><td>'+esc(x.title)+'</td><td>'+esc(x.document_number||'—')+'</td><td>'+esc(x.campaign||'—')+'</td><td>'+esc(x.issue_date||'—')+'</td><td>'+esc(x.expiry_date||'—')+'</td><td>'+esc(x.original_file_name||'—')+'</td><td>'+badge(x.status)+'</td><td><button class="btn secondary" data-action="view-lba-doc" data-path="'+esc(x.storage_path)+'">Voir</button> '+(x.status==='ACTIVE'?'<button class="btn secondary" data-action="void-lba-doc" data-id="'+esc(x.id)+'">Invalider</button>':'')+'</td></tr>'; }))+
 '</section>';
 bindLbaProfile();
}
async function lba(){
 var p=parts();if(p[1])return lbaProfile(decodeURIComponent(p[1]));
 var l=state.suppliers.filter(function(x){return x.categorie==='LBA'||String(x.code).indexOf('LBA-')===0;});
 root.innerHTML=head('LBA','Registry LBA et dossiers administratifs/financiers.','<button class="btn primary" onclick="ANAGROCI_PROC.toggleLba()">+ Nouveau LBA</button><a class="btn secondary" href="lba-purchase.html">Workspace LBA</a>')+
 '<section id="procLbaForm" class="ops-form-card" hidden><h2>Créer un LBA</h2><p class="muted">Le code LBA peut être suggéré automatiquement. Les documents sont ajoutés après création dans le dossier LBA.</p><form id="lbaForm"><div class="ops-form-grid">'+
 field('Nom','nom','text','','required')+
 field('Raison sociale','legal_name','text','')+
 select('Type entité','entity_type',[['COOPERATIVE','Coopérative'],['COMPANY','Société'],['INDIVIDUAL','Individuel'],['OTHER','Autre']],'COOPERATIVE')+
 field('Code LBA','code','text','','placeholder="Laisser vide pour génération automatique"')+
 '<div class="ops-field"><label>Suggestion code</label><button type="button" class="btn secondary" data-action="suggest-lba-code">Suggérer</button></div>'+
 field('Code CCAK','ccak_code','text','','placeholder="Code CCAK"')+
 field('Contact principal','contact_person','text','')+
 field('Téléphone','phone','tel','','required')+
 field('Téléphone alternatif','phone_alt','tel','')+
 field('Email','email','email','')+
 field('RCCM / N° enregistrement','registration_no','text','')+
 field('Identifiant fiscal','tax_id','text','')+
 field('Adresse','address','text','')+
 field('Origine','origine','text','','required')+
 field('Site de livraison','site','text','')+
 select('Statut contrat','contract_status',[['NONE','Aucun'],['ACTIVE','Actif'],['EXPIRED','Expiré'],['CLOSED','Clôturé']],'ACTIVE')+
 field('Référence contrat','contract_reference','text','')+
 field('Titulaire RIB','account_holder','text','')+
 field('Banque','bank_name','text','')+
 field('Code banque','bank_code','text','')+
 field('Code agence','branch_code','text','')+
 field('N° compte','account_number','text','','autocomplete="off"')+
 field('Clé RIB','rib_key','text','')+
 field('IBAN','iban','text','')+
 field('SWIFT/BIC','swift_bic','text','')+
 '</div><div class="ops-actions"><button class="btn primary">Créer le LBA</button></div><div id="lbaMsg" class="muted"></div></form></section>'+
 '<section class="card">'+table(['Code','Nom','Origines','Sites','Volume livré','KOR','Moisture','Statut','Dossier'],l.map(function(x){return'<tr><td class="mono"><b>'+esc(x.code)+'</b></td><td><a href="#lba/'+encodeURIComponent(x.supplier_id)+'"><b>'+esc(x.nom)+'</b></a></td><td>'+esc((x.origines||[]).join(', ')||'—')+'</td><td>'+esc((x.sites||[]).join(', ')||'—')+'</td><td>'+mt(x.volume_livre_kg)+'</td><td>'+esc(x.kor_moyen==null?'—':x.kor_moyen)+'</td><td>'+esc(x.humidite_moyenne==null?'—':x.humidite_moyenne+' %')+'</td><td>'+badge(x.statut)+'</td><td><a class="btn secondary" href="#lba/'+encodeURIComponent(x.supplier_id)+'">Ouvrir</a></td></tr>'; }))+'</section>';
 bindLba();
}
function suppliers(){
 root.innerHTML=head('Suppliers','Supplier Master unique utilisé par Procurement et Warehouse.','<button class="btn primary" onclick="ANAGROCI_PROC.toggleSupplier()">+ New Supplier</button>')+
 '<section id="supplierFormHost" class="ops-form-card" hidden><h2>Créer Direct / Cooperative Supplier</h2><p class="muted">Les LBA sont créés dans la rubrique LBA.</p><form id="supplierForm"><div class="ops-form-grid">'+field('Supplier Code','code','text','','required')+field('Supplier Name','name','text','','required')+select('Category','category',[['DIRECT','Direct'],['COOPERATIVE','Cooperative']],'DIRECT','required')+field('Origin','origin','text','')+field('Site','site','text','')+select('Contract','contract',[['false','No'],['true','Yes']],'false')+'</div><div class="ops-actions"><button class="btn primary">Create Supplier</button></div><div id="supplierMsg" class="muted"></div></form></section>'+
 '<section class="card">'+table(['Code','Name','Category','Origins','Sites','Delivered','KOR','Moisture','Status'],state.suppliers.map(function(x){return'<tr><td class="mono"><b>'+esc(x.code)+'</b></td><td>'+esc(x.nom)+'</td><td>'+esc(x.categorie)+'</td><td>'+esc((x.origines||[]).join(', ')||'—')+'</td><td>'+esc((x.sites||[]).join(', ')||'—')+'</td><td>'+mt(x.volume_livre_kg)+'</td><td>'+esc(x.kor_moyen==null?'—':x.kor_moyen)+'</td><td>'+esc(x.humidite_moyenne==null?'—':x.humidite_moyenne+' %')+'</td><td>'+badge(x.statut)+'</td></tr>'; }))+'</section>';
 bindSupplier();
}
function usedMap(){var m={};state.contributors.forEach(function(c){m[c.achat_id]=(m[c.achat_id]||0)+n(c.qty_kg);});return m;}
function evacuations(){
 var used=usedMap(),available=(state.fieldPurchases||[]).filter(function(x){return n(x.field_or_net_kg)-n(used[x.purchase_id])>0;});
 var lotOpts=state.lots.filter(function(x){return['SEALED','IN_STOCK'].indexOf(x.status)>=0;});
 root.innerHTML=head('Evacuations','Consolider les achats producteurs puis expédier les Lots vers un Warehouse.')+
 '<div class="grid-2"><section class="ops-form-card"><h2>1. Nouveau Lot terrain</h2><form id="lotForm"><div class="ops-form-grid">'+select('Scope Type','scope_type',[['VILLAGE','Village'],['CLUSTER','Cluster'],['MIXED','Mixed']],'VILLAGE')+field('Scope ID','scope_id')+field('Scope Label','scope_label','text','','required')+field('Notes','notes')+'</div><h3>Achats disponibles</h3><div class="table-wrap"><table><thead><tr><th></th><th>Purchase</th><th>Producteur</th><th>Village</th><th>Disponible</th><th>Qty Lot</th><th>Sacs</th></tr></thead><tbody>'+available.slice(0,150).map(function(x){var av=n(x.field_or_net_kg)-n(used[x.purchase_id]);return'<tr><td><input type="checkbox" name="pick" value="'+esc(x.purchase_id)+'"></td><td class="mono">'+esc(x.purchase_id)+'</td><td>'+esc(x.counterparty_name||'—')+'</td><td>'+esc(x.village_nom||'—')+'</td><td>'+kg(av)+'</td><td><input name="qty_'+esc(x.purchase_id)+'" type="number" step="0.001" min="0" max="'+av+'" value="'+av+'"></td><td><input name="bags_'+esc(x.purchase_id)+'" type="number" min="0"></td></tr>';}).join('')+'</tbody></table></div><div class="ops-actions"><button class="btn primary">Seal Field Lot</button></div><div id="lotMsg" class="muted"></div></form></section>'+
 '<section class="ops-form-card"><h2>2. Nouvelle Evacuation</h2><form id="shipForm"><div class="ops-form-grid">'+select('Lot','lot_id',[['','Choisir…']].concat(lotOpts.map(function(x){return[x.id,x.lot_code+' · '+x.scope_label];})),'','required')+field('Loaded kg','loaded_qty_kg','number','','required step="0.001" min="0.001"')+select('Origin Type','origin_type',[['VILLAGE','Village'],['OTHER','Other']],'VILLAGE')+field('Origin ID','origin_id')+field('Origin','origin_label','text','','required')+select('Destination Warehouse','destination_id',[['','Choisir…']].concat(state.warehouses.map(function(w){return[w.id,w.code+' - '+w.name];})),'','required')+field('Truck','vehicle_plate','text','','required')+field('Driver','driver_name')+field('Document Ref','document_ref')+field('Departure','departed_at','datetime-local')+'</div><div class="ops-actions"><button class="btn primary">Dispatch Evacuation</button></div><div id="shipMsg" class="muted"></div></form></section></div>'+
 '<section class="card"><h2>Evacuations</h2>'+table(['Shipment','Origin','Destination','Truck','Dispatched','Received','Status','WMS Reception'],state.shipments.map(function(x){return'<tr><td class="mono">'+esc(x.shipment_code)+'</td><td>'+esc(x.origin_label)+'</td><td>'+esc(x.destination_label)+'</td><td>'+esc(x.vehicle_plate||'—')+'</td><td>'+kg(x.dispatched_qty_kg)+'</td><td>'+kg(x.received_qty_kg)+'</td><td>'+badge(x.status)+'</td><td class="mono">'+esc(x.wms_reception_id||'—')+'</td></tr>'; }))+'</section>';
 bindEvac();
}
function reconciliation(){
 root.innerHTML=head('Reconciliation','Comparer le poids expédié terrain au Net Weight certifié Warehouse.')+
 '<section class="card"><div class="notice info">Un écart n’est jamais redistribué automatiquement aux producteurs.</div>'+table(['Shipment','Origin','Truck','Field kg','Warehouse REC','Warehouse Net','Variance kg','Variance %','Status'],state.recon.map(function(x){return'<tr><td class="mono">'+esc(x.shipment_code)+'</td><td>'+esc(x.origin_label)+'</td><td>'+esc(x.vehicle_plate||'—')+'</td><td>'+kg(x.field_dispatched_kg)+'</td><td class="mono">'+esc(x.wms_reception_id||'—')+'</td><td>'+kg(x.warehouse_net_kg)+'</td><td>'+kg(x.variance_kg)+'</td><td>'+esc(x.variance_pct==null?'—':x.variance_pct+' %')+'</td><td>'+badge(x.reconciliation_status)+'</td></tr>'; }))+'</section>';
}
function settings(){
 root.innerHTML=head('Settings','Règles Procurement versionnées et décisions métier explicites.')+
 '<section class="card"><h2>Campaign Rules</h2>'+table(['Campaign','Channel','Zone','Price/kg','RT Commission/kg','Max Moisture','Min KOR','From','To','Source','Status'],state.rules.map(function(x){return'<tr><td>'+esc(x.campaign)+'</td><td>'+esc(x.channel_code)+'</td><td>'+esc(x.zone_code||'GLOBAL')+'</td><td>'+money(x.price_per_kg)+'</td><td>'+money(x.rt_commission_per_kg)+'</td><td>'+esc(x.max_moisture_pct==null?'—':x.max_moisture_pct+' %')+'</td><td>'+esc(x.min_kor==null?'—':x.min_kor)+'</td><td>'+esc(x.effective_from)+'</td><td>'+esc(x.effective_to||'—')+'</td><td>'+esc(x.source||'—')+'</td><td>'+badge(x.status)+'</td></tr>'; }))+'</section>'+
 '<section class="card"><h2>BUSINESS_DECISION_REQUIRED</h2><ul><li>Autorité finale et seuil de Refraction.</li><li>Matrice BM / GM selon montant.</li><li>Seuil officiel d’exception prix.</li><li>Politique paiement partiel / overdue.</li><li>Correction commerciale après paiement.</li><li>Règle de clôture et tolérances commerciales.</li></ul></section>';
}
async function audit(){
 var rows=await q('rcn_audit','id,objet,champ,motif,auteur,role,created_at',function(x){return x.order('created_at',{ascending:false}).limit(300);});
 root.innerHTML=head('Procurement Audit','Historique transverse Procurement/Warehouse/Finance.')+'<section class="card">'+table(['Date','Object','Action','Reason','User','Role'],rows.map(function(x){return'<tr><td>'+dt(x.created_at)+'</td><td class="mono">'+esc(x.objet||'—')+'</td><td>'+esc(x.champ||'—')+'</td><td>'+esc(x.motif||'—')+'</td><td>'+esc(x.auteur||'—')+'</td><td>'+esc(x.role||'—')+'</td></tr>'; }))+'</section>';
}
function bindPurchaseFilters(){var f=document.getElementById('purchaseFilters');if(!f)return;f.onsubmit=function(e){e.preventDefault();state.filters=formObj(f);state.page=0;purchaseRegister();};}
function bindPurchaseActions(){
 root.querySelectorAll('form[data-action]').forEach(function(f){f.onsubmit=async function(e){e.preventDefault();var d=formObj(f),a=f.dataset.action,id=f.dataset.id;try{
   if(a==='save-draft'){await rpc('procurement_save_purchase_draft',{p_reception_id:f.dataset.reception,p:{refraction_mode:d.refraction_mode,refraction_value:d.refraction_value,refraction_reason:d.refraction_reason,negotiated_price:d.negotiated_price,price_ref:d.price_ref||null,note:d.note||null}});}
   else if(a==='submit-purchase'){await rpc('procurement_submit_purchase',{p_purchase_id:id,p_submitted_price:d.submitted_price,p_reason:d.reason||null});}
   else if(a==='purchase-decision'){var decision=e.submitter&&e.submitter.value;if(decision==='approve')await rpc('procurement_approve_purchase',{p_purchase_id:id,p_approved_price:d.approved_price||null,p_reason:d.reason});else if(decision==='changes')await rpc('procurement_request_purchase_changes',{p_purchase_id:id,p_reason:d.reason});else await rpc('procurement_reject_purchase',{p_purchase_id:id,p_reason:d.reason});}
   else if(a==='submit-bap'){await rpc('procurement_submit_bap',{p_bap_id:id,p_facture_ref:d.facture_ref,p_facture_date:d.facture_date||null,p_comment:d.comment||null});}
   else if(a==='decide-bap'){await rpc('procurement_decide_bap',{p_bap_id:id,p_approve:(e.submitter&&e.submitter.value)==='approve',p_reason:d.reason});}
   else if(a==='record-payment'){await rpc('procurement_record_payment',{p_bap_id:id,p_montant:d.amount,p_mode:d.mode,p_date:d.date,p_reference:d.reference||null,p_banque:d.bank||null,p_preuve_url:null,p_motif:d.reason||null});}
   await load();await purchasePassport(id&&a.indexOf('bap')<0&&a!=='record-payment'?id:parts()[1]);
 }catch(err){alert(err.message);}
 };});
}
function bindSupplier(){var f=document.getElementById('supplierForm');if(!f)return;f.onsubmit=async function(e){e.preventDefault();var d=formObj(f),m=document.getElementById('supplierMsg');try{await rpc('procurement_create_supplier',{p:{code:d.code,name:d.name,category:d.category,origin:d.origin||null,site:d.site||null,contract:d.contract==='true'}});m.className='ops-ok-text';m.textContent='Supplier créé.';await load();suppliers();}catch(err){m.className='ops-danger-text';m.textContent=err.message;}};}
function bindArrival(){var f=document.getElementById('arrivalForm');if(!f)return;f.onsubmit=async function(e){e.preventDefault();var d=formObj(f),m=document.getElementById('arrivalMsg');try{await rpc('procurement_schedule_supplier_arrival',{p:{purchase_type:d.purchase_type,supplier_code:d.supplier_code,origin:d.origin,warehouse_id:d.warehouse_id,expected_kg:d.expected_kg,expected_bags:d.expected_bags||null,expected_at:d.expected_at||null,truck:d.truck||null,driver:d.driver||null,transporter:d.transporter||null,reference:d.reference||null}});m.className='ops-ok-text';m.textContent='Arrivage planifié; la référence est disponible dans Warehouse.';await load();arrivals();}catch(err){m.className='ops-danger-text';m.textContent=err.message;}};}
function bindLba(){
 var f=document.getElementById('lbaForm');if(!f)return;
 f.onsubmit=async function(e){
  e.preventDefault();var d=formObj(f),m=document.getElementById('lbaMsg');
  try{
   var bank=null;
   if(d.account_number||d.bank_name||d.account_holder){
    if(!d.account_number||!d.bank_name||!d.account_holder)throw new Error('Pour enregistrer un RIB, Titulaire, Banque et N° compte sont obligatoires.');
    bank={account_holder:d.account_holder,bank_name:d.bank_name,bank_code:d.bank_code||null,branch_code:d.branch_code||null,account_number:d.account_number,rib_key:d.rib_key||null,iban:d.iban||null,swift_bic:d.swift_bic||null,currency:'XOF'};
   }
   var r=await rpc('procurement_create_lba_profile',{p:{
    name:d.nom,legal_name:d.legal_name||null,entity_type:d.entity_type,code:d.code||null,ccak_code:d.ccak_code||null,
    contact_person:d.contact_person||null,phone:d.phone||null,phone_alt:d.phone_alt||null,email:d.email||null,
    registration_no:d.registration_no||null,tax_id:d.tax_id||null,address:d.address||null,
    origin:d.origine,site:d.site||null,contract_status:d.contract_status,contract:d.contract_status==='ACTIVE',
    contract_reference:d.contract_reference||null,bank:bank
   }});
   m.className='ops-ok-text';m.textContent='LBA créé. Ouverture du dossier administratif…';
   await load();location.hash='#lba/'+encodeURIComponent(r.supplier_id);
  }catch(err){m.className='ops-danger-text';m.textContent=err.message;}
 };
}
function bindLbaProfile(){
 var af=document.getElementById('lbaAdminForm');
 if(af)af.onsubmit=async function(e){e.preventDefault();var d=formObj(af),m=document.getElementById('lbaAdminMsg');try{
   await rpc('procurement_update_supplier',{p_supplier_id:af.dataset.supplier,p:{
    row_version:Number(af.dataset.version),display_name:d.display_name,legal_name:d.legal_name||null,entity_type:d.entity_type,
    ccak_code:d.ccak_code||null,contact_person:d.contact_person||null,phone:d.phone||null,phone_alt:d.phone_alt||null,
    email:d.email||null,registration_no:d.registration_no||null,tax_id:d.tax_id||null,region:d.region||null,address:d.address||null,
    contract_status:d.contract_status,contract_reference:d.contract_reference||null,
    contract_valid_from:d.contract_valid_from||null,contract_valid_to:d.contract_valid_to||null
   },p_reason:'Mise à jour dossier administratif LBA'});
   m.className='ops-ok-text';m.textContent='Dossier mis à jour.';await lbaProfile(af.dataset.supplier);
 }catch(err){m.className='ops-danger-text';m.textContent=err.message;}};

 var bf=document.getElementById('lbaBankForm');
 if(bf)bf.onsubmit=async function(e){e.preventDefault();var d=formObj(bf),m=document.getElementById('lbaBankMsg');try{
   await rpc('procurement_save_supplier_bank_account',{p_supplier_id:bf.dataset.supplier,p:{
    account_holder:d.account_holder,bank_name:d.bank_name,bank_code:d.bank_code||null,branch_code:d.branch_code||null,
    account_number:d.account_number,rib_key:d.rib_key||null,iban:d.iban||null,swift_bic:d.swift_bic||null,currency:d.currency||'XOF'
   },p_reason:d.reason});
   m.className='ops-ok-text';m.textContent='RIB enregistré et versionné.';await lbaProfile(bf.dataset.supplier);
 }catch(err){m.className='ops-danger-text';m.textContent=err.message;}};

 var df=document.getElementById('lbaDocForm');
 if(df)df.onsubmit=async function(e){e.preventDefault();var d=formObj(df),m=document.getElementById('lbaDocMsg'),file=df.querySelector('input[name="file"]').files[0];try{
   if(!file)throw new Error('Sélectionnez un fichier.');
   if(file.size>15728640)throw new Error('Fichier supérieur à 15 Mo.');
   if(['application/pdf','image/jpeg','image/png','image/webp'].indexOf(file.type)<0)throw new Error('Format autorisé : PDF, JPEG, PNG ou WEBP.');
   var au=await sb.auth.getUser();var uid=au&&au.data&&au.data.user&&au.data.user.id;if(!uid)throw new Error('Session utilisateur introuvable.');
   var safe=(file.name||'document').replace(/[^a-zA-Z0-9._-]+/g,'_');
   var path=uid+'/'+df.dataset.supplier+'/'+Date.now()+'_'+safe;
   var up=await sb.storage.from('procurement-supplier-docs').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
   if(up.error)throw new Error(up.error.message);
   await rpc('procurement_register_supplier_document',{
    p_supplier_id:df.dataset.supplier,p_document_type:d.document_type,p_title:d.title,p_storage_path:path,
    p_document_number:d.document_number||null,p_issue_date:d.issue_date||null,p_expiry_date:d.expiry_date||null,
    p_campaign:d.campaign||null,p_note:d.note||null
   });
   m.className='ops-ok-text';m.textContent='Document ajouté au coffre privé.';await lbaProfile(df.dataset.supplier);
 }catch(err){m.className='ops-danger-text';m.textContent=err.message;}};
}
function bindEvac(){var lf=document.getElementById('lotForm');if(lf)lf.onsubmit=async function(e){e.preventDefault();var d=formObj(lf),picks=[].slice.call(lf.querySelectorAll('input[name="pick"]:checked')),msg=document.getElementById('lotMsg');try{if(!picks.length)throw new Error('Sélectionnez au moins un achat.');var ps=picks.map(function(x){return{achat_id:x.value,qty_kg:Number(lf.querySelector('[name="qty_'+x.value+'"]').value),bag_count:Number(lf.querySelector('[name="bags_'+x.value+'"]').value||0)};});await rpc('procurement_field_create_lot',{p:{scope_type:d.scope_type,scope_id:d.scope_id||null,scope_label:d.scope_label,notes:d.notes||null,purchases:ps}});msg.className='ops-ok-text';msg.textContent='Lot terrain créé et scellé.';await load();evacuations();}catch(err){msg.className='ops-danger-text';msg.textContent=err.message;}};var sf=document.getElementById('shipForm');if(sf)sf.onsubmit=async function(e){e.preventDefault();var d=formObj(sf),msg=document.getElementById('shipMsg'),wh=state.warehouses.filter(function(w){return String(w.id)===String(d.destination_id);})[0];try{await rpc('procurement_field_create_shipment',{p:{origin_type:d.origin_type,origin_id:d.origin_id||null,origin_label:d.origin_label,destination_type:'WAREHOUSE',destination_id:d.destination_id,destination_label:wh?wh.code:d.destination_id,vehicle_plate:d.vehicle_plate,driver_name:d.driver_name||null,document_ref:d.document_ref||null,departed_at:d.departed_at||null,lots:[{lot_id:d.lot_id,loaded_qty_kg:Number(d.loaded_qty_kg)}]}});msg.className='ops-ok-text';msg.textContent='Evacuation dispatchée.';await load();evacuations();}catch(err){msg.className='ops-danger-text';msg.textContent=err.message;}};}
var ROUTES={overview:overview,field:fieldBuying,lba:lba,suppliers:suppliers,arrivals:arrivals,purchases:purchases,evacuations:evacuations,reconciliation:reconciliation,settings:settings,audit:audit};
async function render(){root=document.getElementById('opsRouteView');try{if(!state.suppliers)await load();await(ROUTES[route()]||overview)();}catch(e){root.innerHTML=head('Rubrique indisponible','Erreur Procurement')+'<div class="notice danger">'+esc(e.message)+'</div>';}}
global.ANAGROCI_OPS_ROUTE=render;
global.ANAGROCI_PROC={render:render,toggleLba:function(){var x=document.getElementById('procLbaForm');if(x)x.hidden=!x.hidden;},toggleArrival:function(){var x=document.getElementById('arrivalFormHost');if(x)x.hidden=!x.hidden;},toggleSupplier:function(){var x=document.getElementById('supplierFormHost');if(x)x.hidden=!x.hidden;}};
async function boot(){root=document.getElementById('opsRouteView');sb=await waitClient();if(!sb){root.innerHTML='<div class="notice danger">Supabase indisponible.</div>';return;}
 root.addEventListener('click',async function(e){var t=e.target.closest('[data-href],[data-action]');if(!t)return;if(t.dataset.href){location.hash=t.dataset.href.replace(/^#/,'');return;}var a=t.dataset.action;
   if(a==='suggest-lba-code'){try{var form=document.getElementById('lbaForm'),name=form&&form.elements.nom&&form.elements.nom.value;if(!name)throw new Error('Saisissez le nom du LBA.');var sg=await rpc('procurement_suggest_supplier_code',{p_name:name,p_mode:'LBA'});form.elements.code.value=sg.code||'';}catch(err){alert(err.message);}}
   else if(a==='view-lba-doc'){try{var su=await sb.storage.from('procurement-supplier-docs').createSignedUrl(t.dataset.path,120);if(su.error)throw new Error(su.error.message);window.open(su.data.signedUrl,'_blank','noopener');}catch(err){alert(err.message);}}
   else if(a==='void-lba-doc'){try{var reason=window.prompt('Motif obligatoire pour invalider ce document :');if(!reason)return;await rpc('procurement_void_supplier_document',{p_document_id:t.dataset.id,p_reason:reason});await lbaProfile(parts()[1]);}catch(err){alert(err.message);}}
   else if(a==='reset-filters'){state.filters={};state.page=0;await purchaseRegister();}
   else if(a==='page-prev'){state.page=Math.max(0,state.page-1);await purchaseRegister();}
   else if(a==='page-next'){state.page++;await purchaseRegister();}
   else if(a==='prepare-purchase'){try{var d=await rpc('procurement_save_purchase_draft',{p_reception_id:t.dataset.reception,p:{refraction_mode:'NONE',refraction_value:0}});await load();location.hash='#purchases/'+d.id;}catch(err){alert(err.message);}}
   else if(a==='reconcile-payment'){try{await rpc('procurement_reconcile_payment',{p_payment_id:t.dataset.id,p_accept:t.dataset.accept==='true',p_reason:'Finance reconciliation'});await load();await purchasePassport(parts()[1]);}catch(err){alert(err.message);}}
 });
 await render();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})(window);
