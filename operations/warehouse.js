/* ANAGROCI Operations Suite - Warehouse WMS MVP. */
(function(global){
'use strict';
if(!document.body || document.body.dataset.workspace!=='warehouse') return;

var root=null,sb=null,seq=0;
var state={permissions:{},warehouses:[],areas:[],suppliers:[],receptions:[],lots:[],bins:[],quality:[],postDry:[],dryings:[],inventory:[],transfers:[],bagMovements:[],bagStock:[],bagDebt:[],locations:[],audit:[],overview:{},closings:[]};

function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function num(v,d){var x=Number(v);return Number.isFinite(x)?x.toLocaleString('fr-FR',{maximumFractionDigits:d==null?2:d}):'-';}
function kg(v){return num(v,2)+' kg';}
function mt(v){return num(Number(v||0)/1000,3)+' MT';}
function dt(v){if(!v)return'-';try{return new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch(e){return esc(v);}}
function parts(){var h=(location.hash||'#overview').replace(/^#/,'').split('/');return{route:h[0]||'overview',id:decodeURIComponent(h.slice(1).join('/')||'')};}
function badge(s){var x=String(s||'').toUpperCase(),c=/REJECT|REFUS|BLOCK|HOLD|ERROR|VARIANCE/.test(x)?'danger':/CLOSED|RELEASED|ACTIVE|OK|ADJUSTED/.test(x)?'ok':/AWAIT|READY|PENDING|ARRIVED|ACCEPTED|REVIEW/.test(x)?'warn':'info';return'<span class="badge '+c+'">'+esc(s||'-')+'</span>';}
function head(t,s,a){return'<div class="ops-route-head"><div><h1>'+esc(t)+'</h1><p>'+esc(s||'')+'</p></div><div class="ops-route-actions">'+(a||'')+'</div></div>';}
function notice(cls,html){return'<div class="notice '+(cls||'')+'">'+html+'</div>';}
function table(h,rows){if(!rows.length)return'<div class="ops-empty">Aucune donnée disponible.</div>';return'<div class="table-wrap"><table><thead><tr>'+h.map(function(x){return'<th>'+esc(x)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
function kpi(label,value,href,cls,note){return'<a class="kpi kpi-link '+(cls||'')+'" href="'+esc(href)+'"><small>'+esc(label)+'</small><b>'+esc(String(value))+'</b><span>'+esc(note||'Ouvrir la file')+'</span></a>';}
function id(name){seq++;return'wms_'+String(name).replace(/[^A-Za-z0-9_-]/g,'_')+'_'+seq;}
function field(label,name,type,value,extra){var i=id(name);return'<div class="ops-field"><label for="'+i+'">'+esc(label)+'</label><input id="'+i+'" name="'+esc(name)+'" type="'+esc(type||'text')+'" value="'+esc(value||'')+'" '+(extra||'')+'></div>';}
function textarea(label,name,value,extra){var i=id(name);return'<div class="ops-field"><label for="'+i+'">'+esc(label)+'</label><textarea id="'+i+'" name="'+esc(name)+'" '+(extra||'')+'>'+esc(value||'')+'</textarea></div>';}
function select(label,name,opts,value,extra){var i=id(name);return'<div class="ops-field"><label for="'+i+'">'+esc(label)+'</label><select id="'+i+'" name="'+esc(name)+'" '+(extra||'')+'>'+opts.map(function(o){return'<option value="'+esc(o[0])+'"'+(String(o[0])===String(value||'')?' selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select></div>';}
function can(a){return !!((state.permissions.actions||{})[a]);}
function waitAuth(){return new Promise(function(resolve){
 if(global.ANAGROCI_AUTH&&global.ANAGROCI_AUTH.profile)return resolve(global.ANAGROCI_AUTH);
 function ready(ev){document.removeEventListener('anagroci:authenticated',ready);resolve((ev&&ev.detail)||global.ANAGROCI_AUTH||null);}
 document.addEventListener('anagroci:authenticated',ready);
});}
function waitClient(){return new Promise(function(resolve){var k=0,t=setInterval(function(){k++;if(global.supabase&&global.ANAGROCI_SUPABASE_URL&&global.ANAGROCI_SUPABASE_ANON){clearInterval(t);resolve(global.supabase.createClient(global.ANAGROCI_SUPABASE_URL,global.ANAGROCI_SUPABASE_ANON));}else if(k>120){clearInterval(t);resolve(null);}},80);});}
async function q(name,cols,build){var x=sb.from(name).select(cols||'*');if(build)x=build(x);var r=await x;if(r.error)throw new Error(r.error.message||name);return r.data||[];}
async function rpc(name,args){var r=await sb.rpc(name,args||{});if(r.error)throw new Error(r.error.message||name);return r.data;}
function formObj(f){var x={};new FormData(f).forEach(function(v,k){x[k]=String(v).trim();});return x;}
function busy(f,on){f.querySelectorAll('button,input,select,textarea').forEach(function(e){e.disabled=!!on;});}
function err(e){root.insertAdjacentHTML('afterbegin',notice('danger','<b>Erreur:</b>&nbsp;'+esc(e&&e.message?e.message:e)));window.scrollTo({top:0,behavior:'smooth'});}
function opKey(a,idv){var sk='wms-op:'+a+':'+(idv||'NEW'),v=sessionStorage.getItem(sk);if(!v){v='WEB-'+a+'-'+(idv||'NEW')+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,9);sessionStorage.setItem(sk,v);}return{key:v,storeKey:sk};}
function doneKey(k){if(k)sessionStorage.removeItem(k.storeKey);}

async function loadBase(){
  state.permissions=await rpc('wms_my_permissions')||{};
  state.warehouses=await q('wms_warehouses','*',function(x){return x.order('site_code').order('code');});
  state.areas=await q('wms_physical_areas','*',function(x){return x.order('code').limit(500);});
  state.suppliers=await q('rcn_fournisseurs','code,nom,statut,categorie,origines,sites',function(x){return x.eq('statut','ACTIF').order('code').limit(500);});
  state.receptions=await q('wms_v_receptions','*',function(x){return x.order('arrival_at',{ascending:false}).limit(500);});
  state.lots=await q('wms_v_lots','*',function(x){return x.order('created_at',{ascending:false}).limit(500);});
  state.bins=await q('wms_v_bins','*',function(x){return x.order('opened_at',{ascending:false}).limit(500);});
  state.quality=await q('wms_v_quality_current','*',function(x){return x.order('created_at',{ascending:false}).limit(1000);});
  state.purchaseTypes=await q('procurement_purchase_types','code,label,channel_code',function(x){return x.eq('active',true).order('code');}).catch(function(){return[];});
  state.pendingProcurement=await q('procurement_v_pending_receptions','*',function(x){return x.order('source_date',{ascending:false}).limit(500);}).catch(function(){return[];});
  state.paymentMethods=await q('procurement_payment_methods','code,label',function(x){return x.eq('active',true).order('code');}).catch(function(){return[];});
  state.rejectedTrucks=await q('procurement_v_rejected_trucks','*',function(x){return x.order('decided_at',{ascending:false}).limit(300);}).catch(function(){return[];});
}
function whOpts(all){return[['','Sélectionner...']].concat(state.warehouses.filter(function(w){return all||w.status==='ACTIVE';}).map(function(w){return[w.id,w.code+' - '+w.name+(w.status!=='ACTIVE'?' ['+w.status+']':'')];}));}
function whById(v){return state.warehouses.filter(function(w){return String(w.id)===String(v);})[0];}
function recById(v){return state.receptions.filter(function(x){return x.id===v;})[0];}
function lotById(v){return state.lots.filter(function(x){return x.id===v;})[0];}
function binById(v){return state.bins.filter(function(x){return x.id===v;})[0];}
function qualityFor(rec,type){return state.quality.filter(function(x){return x.reception_id===rec&&x.type===type;})[0]||null;}

async function overview(){
  state.overview=await rpc('wms_overview',{p_warehouse_id:null})||{};
  var today=new Date().toISOString().slice(0,10);
  var activeWh=state.warehouses.filter(function(w){return w.status==='ACTIVE';});
  state.closings=await Promise.all(activeWh.map(function(w){return rpc('wms_daily_closing',{p_warehouse_id:w.id,p_date:today}).then(function(x){x.warehouse_code=w.code;return x;}).catch(function(){return null;});}));
  state.closings=state.closings.filter(Boolean);
  state.dryings=await q('wms_dryings','*',function(x){return x.order('created_at',{ascending:false}).limit(300);}).catch(function(){return[];});
  state.postDry=await q('wms_v_post_dry_quality_current','*',function(x){return x.order('created_at',{ascending:false}).limit(500);}).catch(function(){return[];});
  state.inventory=await q('wms_inventory_counts','*',function(x){return x.gte('counted_at',today+'T00:00:00Z').order('counted_at',{ascending:false}).limit(300);}).catch(function(){return[];});
  state.transfers=await q('wms_v_transfers','*',function(x){return x.eq('is_test',false).gte('requested_at',today+'T00:00:00Z').order('requested_at',{ascending:false}).limit(300);}).catch(function(){return[];});
  state.bagMovements=await q('rcn_jute_movements','id,movement_type,qty,movement_at,source_type',function(x){return x.eq('source_type','WMS').gte('movement_at',today+'T00:00:00Z').order('movement_at',{ascending:false}).limit(500);}).catch(function(){return[];});
  var o=state.overview,att=state.receptions.filter(function(r){return['ARRIVED','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD','AWAITING_FINAL_QA','QUALITY_HOLD'].indexOf(r.status)>=0;}).sort(function(a,b){return Number(b.age_hours||0)-Number(a.age_hours||0);}).slice(0,15);
  var stagingLots=state.lots.filter(function(l){return Number(l.staging_kg||0)>0.0005;});
  var nearBins=state.bins.filter(function(b){return b.status!=='CLOSED'&&Number(b.occupancy_pct||0)>=Number(((o.params||{}).binCapacityAlertPct)||90);});
  var blockedBins=state.bins.filter(function(b){return b.status==='BLOCKED';});
  var dryingExceptions=state.dryings.filter(function(d){return d.loss_alert||['AWAITING_POST_DRY_QA','QUALITY_HOLD','RE_DRY'].indexOf(d.status)>=0;});
  var readyTransfer=state.postDry.filter(function(q){return q.disposition==='READY';});
  var stockActions=[];
  stagingLots.slice(0,10).forEach(function(l){stockActions.push({priority:'HIGH',object:l.id,status:'STAGING',action:'Allocate to BIN',href:'#lots/'+encodeURIComponent(l.id),age:Number(l.age_hours||0)});});
  blockedBins.slice(0,10).forEach(function(b){stockActions.push({priority:'CRITICAL',object:b.id,status:'BLOCKED',action:'Resolve BIN block',href:'#bins/'+encodeURIComponent(b.id),age:Number(b.age_hours||0)});});
  dryingExceptions.slice(0,10).forEach(function(d){stockActions.push({priority:d.loss_alert?'CRITICAL':'HIGH',object:d.id,status:d.status,action:d.status==='RE_DRY'?'Start Re-Dry':d.status==='AWAITING_POST_DRY_QA'?'Post-Dry Quality':'Review Drying exception',href:'#drying/'+encodeURIComponent(d.id),age:0});});
  readyTransfer.slice(0,10).forEach(function(q){stockActions.push({priority:'NORMAL',object:q.lot_id||q.drying_id,status:'READY',action:'Prepare Stock Transfer',href:q.lot_id?'#lots/'+encodeURIComponent(q.lot_id):'#drying/'+encodeURIComponent(q.drying_id),age:0});});
  stockActions.sort(function(a,b){var p={CRITICAL:3,HIGH:2,NORMAL:1};return (p[b.priority]||0)-(p[a.priority]||0)||Number(b.age||0)-Number(a.age||0);});
  root.innerHTML=head('Warehouse Operations','Control Tower RCN : exceptions, décisions et prochaines actions.',can('reception_create')?'<a class="btn primary ops-cta-create" href="#inbound/new">+ New Reception</a>':'')+
  '<div class="kpi-grid">'+
  kpi('Awaiting Sampling',o.awaiting_sampling||0,'#quality','')+
  kpi('Awaiting Decision',o.awaiting_decision||0,'#quality',(o.awaiting_decision||0)?'attn':'')+
  kpi('Accepted Waiting Offload',o.accepted_waiting_offload||0,'#inbound',(o.accepted_waiting_offload||0)?'attn':'')+
  kpi('Final QA Pending',o.final_qa_pending||0,'#quality',(o.final_qa_pending||0)?'attn':'')+
  kpi('Quality Hold',o.quality_hold||0,'#quality',(o.quality_hold||0)?'danger':'')+
  kpi('Staging not allocated',stagingLots.length,'#lots',stagingLots.length?'attn':'')+
  kpi('BIN near capacity',nearBins.length,'#bins',nearBins.length?'attn':'')+
  kpi('BIN blocked',blockedBins.length,'#bins',blockedBins.length?'danger':'')+
  kpi('Drying exceptions',dryingExceptions.length,'#drying',dryingExceptions.length?'danger':'')+
  kpi('Ready for Transfer',readyTransfer.length,'#lots',readyTransfer.length?'ok':'')+
  '</div><div class="grid-2"><section class="card"><div class="card-head"><div><h2>Actions requiring attention</h2><p>Priorité aux dossiers anciens et bloqués.</p></div></div>'+
  table(['Reception','Truck','Supplier','Warehouse','Age','Status','Next'],att.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.id)+'"><td class="mono">'+esc(r.id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||'-')+'</td><td>'+esc(r.warehouse_code||'-')+'</td><td>'+num(r.age_hours,1)+' h</td><td>'+badge(r.status)+'</td><td>'+esc(r.next_action||'-')+'</td></tr>';}))+
  '</section><section class="card"><h2>Stock & controls</h2><div class="ops-def-grid" style="margin-top:12px"><div><small>Wet</small><b>'+mt(o.wet_stock_kg||0)+'</b></div><div><small>Dry</small><b>'+mt(o.dry_stock_kg||0)+'</b></div><div><small>Hold</small><b>'+mt(o.hold_stock_kg||0)+'</b></div><div><small>Active BIN</small><b>'+esc(o.active_bins||0)+'</b></div><div><small>Inventory variance</small><b>'+esc(o.inventory_variances||0)+'</b></div><div><small>Outstanding bags</small><b>'+esc(o.outstanding_bags||0)+'</b></div></div>'+
  notice('info','<b>KOR Factor:</b>&nbsp;'+esc(((o.params||{}).korFactor||{}).factor||'À valider')+' · <b>Tolerance:</b>&nbsp;'+esc(((o.params||{}).korTolerance||{}).value||'À valider'))+'</section></div>'+
  '<section class="card"><div class="card-head"><div><h2>Warehouse Exception Queue</h2><p>Staging, BIN, drying et stock prêt transfert, triés par criticité.</p></div></div>'+
  table(['Priority','Object','Status','Next Action'],stockActions.slice(0,25).map(function(a){return'<tr class="ops-click" data-href="'+esc(a.href)+'"><td>'+badge(a.priority)+'</td><td class="mono">'+esc(a.object||'-')+'</td><td>'+badge(a.status)+'</td><td><b>'+esc(a.action)+'</b></td></tr>';}))+
  '</section>'+
  '<section class="card"><div class="card-head"><div><h2>Daily Warehouse Closing</h2><p>Opening + Receipts + Transfers In − Transfers Out − Process Loss ± Adjustments = Closing.</p></div></div>'+
  table(['Warehouse','Opening','Receipts','Trf In','Trf Out','Process Loss','Adjustments','Closing','Variance','Status'],state.closings.map(function(c){return'<tr><td><b>'+esc(c.warehouse_code)+'</b></td><td>'+kg(c.opening_stock_kg)+'</td><td>'+kg(c.receipts_kg)+'</td><td>'+kg(c.transfers_in_kg)+'</td><td>'+kg(c.transfers_out_kg)+'</td><td>'+kg(c.process_loss_kg)+'</td><td>'+kg(c.inventory_adjustments_kg)+'</td><td>'+kg(c.closing_stock_kg)+'</td><td>'+kg(c.variance_kg)+'</td><td>'+badge(c.mass_balance_status)+'</td></tr>';}))+
  '</section>'+
  '<section class="card"><div class="card-head"><div><h2>Daily Warehouse Report</h2><p>Résumé opérationnel du jour pour Warehouse In-Charge / Branch Manager.</p></div></div>'+
  '<div class="ops-def-grid"><div><small>Trucks received</small><b>'+state.receptions.filter(function(r){return String(r.arrival_at||'').slice(0,10)===today;}).length+'</b></div>'+
  '<div><small>Trucks rejected</small><b>'+state.receptions.filter(function(r){return r.status==='REJECTED'&&String(r.decided_at||'').slice(0,10)===today;}).length+'</b></div>'+
  '<div><small>Total kg received</small><b>'+kg(state.receptions.filter(function(r){return String(r.offloaded_at||'').slice(0,10)===today;}).reduce(function(t,r){return t+Number(r.net_kg||0);},0))+'</b></div>'+
  '<div><small>Average Final KOR</small><b>'+num((function(){var a=state.quality.filter(function(q){return q.type==='FINAL'&&String(q.created_at||'').slice(0,10)===today&&q.kor_exact!=null;});return a.length?a.reduce(function(t,q){return t+Number(q.kor_exact);},0)/a.length:0;})(),2)+'</b></div>'+
  '<div><small>Average Moisture</small><b>'+num((function(){var a=state.quality.filter(function(q){return q.type==='FINAL'&&String(q.created_at||'').slice(0,10)===today&&q.moisture_pct!=null;});return a.length?a.reduce(function(t,q){return t+Number(q.moisture_pct);},0)/a.length:0;})(),2)+' %</b></div>'+
  '<div><small>Drying input</small><b>'+kg(state.dryings.filter(function(d){return String(d.created_at||'').slice(0,10)===today;}).reduce(function(t,d){return t+Number(d.input_kg||0);},0))+'</b></div>'+
  '<div><small>Drying output</small><b>'+kg(state.dryings.filter(function(d){return String(d.created_at||'').slice(0,10)===today;}).reduce(function(t,d){return t+Number(d.output_kg||0);},0))+'</b></div>'+
  '<div><small>Process loss</small><b>'+kg(state.dryings.filter(function(d){return String(d.created_at||'').slice(0,10)===today;}).reduce(function(t,d){return t+Number(d.process_loss_kg||0);},0))+'</b></div>'+
  '<div><small>Inventory variances</small><b>'+state.inventory.filter(function(i){return Math.abs(Number(i.variance_kg||0))>0.001;}).length+'</b></div>'+
  '<div><small>Transfers prepared</small><b>'+state.transfers.length+'</b></div>'+
  '<div><small>Transfers dispatched</small><b>'+state.transfers.filter(function(t){return t.departed_at;}).length+'</b></div>'+
  '<div><small>Bag movements</small><b>'+state.bagMovements.length+'</b></div>'+
  '<div><small>Stock WET / DRY / HOLD</small><b>'+kg(state.closings.reduce(function(t,c){return t+Number(c.stock_wet_kg||0);},0))+' / '+kg(state.closings.reduce(function(t,c){return t+Number(c.stock_dry_kg||0);},0))+' / '+kg(state.closings.reduce(function(t,c){return t+Number(c.stock_hold_kg||0);},0))+'</b></div>'+
  '<div><small>Pending actions</small><b>'+att.length+'</b></div></div></section>';
}

function inboundList(){
 var a=state.receptions;
 var accepted=a.filter(function(r){return r.status==='ACCEPTED_WAITING_OFFLOAD';});
 var rejected=(state.rejectedTrucks||[]);
 root.innerHTML=head('Inbound','Arrivée physique, autorisation et déchargement.',can('reception_create')?'<a class="btn primary ops-cta-create" href="#inbound/new">+ New Reception</a>':'')+
 notice('ok','<b>Règle:</b>&nbsp; aucun offloading avant décision ACCEPTED.')+
 '<div class="kpi-grid">'+kpi('Arrived / Sampling',a.filter(function(r){return r.status==='ARRIVED';}).length,'#quality','')+
 kpi('Awaiting Decision',a.filter(function(r){return r.status==='AWAITING_DECISION';}).length,'#quality','attn')+
 kpi('Accepted for Offload',accepted.length,'#inbound',accepted.length?'attn':'')+
 kpi('Rejected / Refoulé',rejected.length,'#inbound',rejected.length?'danger':'')+'</div>'+
 '<div class="grid-2"><section class="card"><h2>Accepted for Offloading</h2>'+table(['Reception','Truck','Supplier / Source','KOR','Moisture','Warehouse','Decision'],accepted.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.id)+'"><td class="mono">'+esc(r.id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||r.procurement_source_type||'-')+'</td><td>'+esc(r.sampling_kor==null?'-':r.sampling_kor)+'</td><td>'+esc(r.sampling_moisture==null?'-':r.sampling_moisture+' %')+'</td><td>'+esc(r.warehouse_code||'-')+'</td><td>'+dt(r.decided_at)+'</td></tr>'; }))+'</section>'+
 '<section class="card"><h2>Rejected / Refoulé</h2>'+table(['Reception','Truck','Source','KOR','Moisture','Reason','Disposition'],rejected.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.reception_id)+'"><td class="mono">'+esc(r.reception_id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.procurement_channel||r.supplier_name||'-')+'</td><td>'+esc(r.sampling_kor==null?'-':r.sampling_kor)+'</td><td>'+esc(r.sampling_moisture==null?'-':r.sampling_moisture+' %')+'</td><td>'+esc(r.rejection_reason||'-')+'</td><td>'+badge(r.disposition_status||'OPEN')+'</td></tr>'; }))+'</section></div>'+
 '<section class="card"><h2>All Receptions</h2>'+table(['Reception','Truck','Supplier / Channel','Origin','Warehouse','Expected','Arrival','Status','Next'],a.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.id)+'"><td class="mono">'+esc(r.id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||r.procurement_channel||'-')+'</td><td>'+esc(r.origin||'-')+'</td><td>'+esc(r.warehouse_code||'-')+'</td><td>'+mt(r.expected_kg||0)+'</td><td>'+dt(r.arrival_at)+'</td><td>'+badge(r.status)+'</td><td>'+esc(r.next_action||'-')+'</td></tr>';}))+'</section>';
}

function inboundNew(){
 var nowLocal=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
 var srcOpts=[['','Manual / Direct / Cooperative / Ad-Hoc']].concat((state.pendingProcurement||[]).map(function(x){
   return[x.source_type+'|'+x.source_id,x.source_ref+' · '+x.procurement_channel+' · '+(x.truck||'truck à compléter')+' · '+(x.origin||'origine à compléter')];
 }));
 var typeOpts=[['','Sélectionner...']].concat((state.purchaseTypes||[]).map(function(x){return[x.code,x.label+' · '+x.channel_code];}));
 root.innerHTML=head('New Reception','Procurement Reference → camion → qualité → décision → pesée. Les données déjà connues ne sont pas ressaisies.','<a class="btn secondary" href="#inbound">Retour</a>')+
 '<form class="ops-form-card" data-action="reception-create"><h2>Procurement Source</h2><div class="ops-form-grid" style="margin-top:12px">'+
 select('Procurement Reference','procurement_source',srcOpts,'','')+
 select('Purchase Type','purchase_type',typeOpts,'','required')+
 select('Ad-Hoc Reception','ad_hoc',[['false','No'],['true','Yes · unplanned exception']],'false','required')+
 field('Reason for Ad-Hoc','ad_hoc_reason','text','')+
 '</div><h2 style="margin-top:18px">Truck & Counterparty</h2><div class="ops-form-grid" style="margin-top:12px">'+
 field('Truck Number','truck','text','','required')+
 select('Supplier','supplier_code',[['','Sélectionner un fournisseur actif...']].concat(state.suppliers.map(function(x){return[x.code,x.code+' - '+x.nom];})),'','')+
 field('Supplier Code','supplier_code_display','text','','readonly aria-readonly="true"')+
 field('Origin','origin','text','','required')+
 select('Warehouse','warehouse_id',whOpts(false),'','required')+
 field('Arrival Date / Time','arrival_at','datetime-local',nowLocal,'required')+
 '</div><h2 style="margin-top:18px">Document Check</h2><p class="muted">La Procurement Reference et les documents restent distincts. Un Field Shipment conserve ses producteurs contributeurs.</p>'+
 '<div class="ops-form-grid" style="margin-top:12px">'+
 field('Delivery Note','delivery_note','text','')+field('Weighbridge Ticket','weighbridge_ticket','text','')+
 field('Driver','driver','text','','required')+field('Transporter','transporter','text','')+
 field('Expected Weight kg','expected_kg','number','','step="0.001" min="0"')+field('Expected Bags','expected_bags','number','','min="0"')+
 field('Reference','reference','text','')+
 '</div><div class="notice info" id="procurementSourceInfo" style="margin-top:12px">Sélectionnez une Procurement Reference pour préremplir les données connues, ou utilisez le mode manuel contrôlé.</div>'+
 '<div class="ops-actions" style="margin-top:14px"><button class="btn primary">Create Reception</button></div></form>';
 syncReceptionSource('');
}
function syncReceptionSource(value){
 var form=root&&root.querySelector('form[data-action="reception-create"]');if(!form)return;
 var row=(state.pendingProcurement||[]).filter(function(x){return x.source_type+'|'+x.source_id===value;})[0];
 function set(n,v){var e=form.querySelector('[name="'+n+'"]');if(e&&v!=null)e.value=v;}
 if(row){
   set('purchase_type',row.purchase_type);set('supplier_code',row.supplier_code||'');set('supplier_code_display',row.supplier_code||'MULTI-PRODUCER');
   set('origin',row.origin||'');set('warehouse_id',row.warehouse_id||'');set('truck',row.truck||'');
   set('driver',row.driver||'');set('transporter',row.transporter||'');set('expected_kg',row.expected_kg==null?'':row.expected_kg);
   set('expected_bags',row.expected_bags==null?'':row.expected_bags);set('reference',row.source_ref||'');set('ad_hoc','false');set('ad_hoc_reason','');
   var info=document.getElementById('procurementSourceInfo');if(info)info.innerHTML='<b>'+esc(row.source_ref)+'</b> · '+esc(row.procurement_channel)+' · '+esc(row.source_type)+' · la généalogie Procurement sera liée à cette réception.';
 }else{
   var sup=form.querySelector('[name="supplier_code"]'),disp=form.querySelector('[name="supplier_code_display"]');if(disp)disp.value=sup?sup.value:'';
   var info2=document.getElementById('procurementSourceInfo');if(info2)info2.textContent='Mode manuel : Supplier obligatoire pour Direct/Cooperative; utilisez Ad-Hoc = Yes si le camion n’était pas planifié.';
 }
}

function timelineRec(r){
 var arr=[['Arrival',r.arrival_at,r.created_by_name],['Sampling',r.sampling_at,'Quality'],['Decision',r.decided_at,r.decided_by_name],['Offloading',r.offloaded_at,'Warehouse'],['Final QA',r.final_at,'Quality']].filter(function(x){return x[1];});
 return'<div class="ops-timeline">'+arr.map(function(x){return'<div class="ops-timeline-item"><time>'+dt(x[1])+'</time><div><b>'+esc(x[0])+'</b><small>'+esc(x[2]||'-')+'</small></div></div>';}).join('')+'</div>';
}
function offloadForm(r){
 if(r.status!=='ACCEPTED_WAITING_OFFLOAD'||!can('offload'))return'';
 return'<form class="card" data-action="offload" data-id="'+esc(r.id)+'"><h2>Offloading / Weighing</h2><div class="ops-form-grid" style="margin-top:12px">'+
 field('Gross kg','gross_kg','number','','required step="0.001" min="0.001"')+field('Tare kg','tare_kg','number','','required step="0.001" min="0"')+field('Net kg = Gross − Tare','net_kg','number','','readonly aria-readonly="true" step="0.001"')+
 field('Bags total','bags','number','','min="0"')+field('Bags good','bags_good','number','','min="0"')+field('Bags wet','bags_wet','number','','min="0"')+field('Bags torn','bags_torn','number','','min="0"')+field('Bags reconditioned','bags_recond','number','','min="0"')+
 field('Weighbridge ticket','weighbridge_ticket','text','')+field('Delivery note','delivery_note','text','')+field('Warehouse receipt','warehouse_receipt','text','')+
 field('Offload start','offload_start','datetime-local','')+field('Offload end','offload_end','datetime-local','')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Record Offloading</button></div></form>';
}
function inboundDetail(r){
 var docsOk=!!(r.delivery_note&&r.weighbridge_ticket&&r.driver&&r.transporter&&r.purchase_type&&r.supplier_code&&r.origin);
 var corrMap={truck:r.truck||'',supplier_code:r.supplier_code||'',origin:r.origin||'',expected_kg:r.expected_kg==null?'':r.expected_kg,expected_bags:r.expected_bags==null?'':r.expected_bags,driver:r.driver||'',transporter:r.transporter||'',reference:r.reference||'',weighbridge_ticket:r.weighbridge_ticket||'',delivery_note:r.delivery_note||''};
 var corr=can('correction')?'<form class="card" data-action="reception-correct" data-id="'+esc(r.id)+'" data-current="'+esc(JSON.stringify(corrMap))+'"><h2>Controlled Correction</h2><p class="muted">Before → After est journalisé. Aucun champ stock n’est modifiable ici.</p><div class="ops-form-grid">'+
 select('Field','field',[['truck','Truck'],['supplier_code','Supplier Code'],['origin','Origin'],['expected_kg','Expected Weight'],['expected_bags','Expected Bags'],['driver','Driver'],['transporter','Transporter'],['reference','Reference'],['weighbridge_ticket','Weighbridge Ticket'],['delivery_note','Delivery Note']],'','required')+
 field('Current Value','current_value','text','','readonly aria-readonly="true"')+field('New Value','new_value','text','','required')+field('Reason','reason','text','','required')+field('Approver','approver','text','','required')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn secondary">Apply Controlled Correction</button></div></form>':'';
 var rej=(state.rejectedTrucks||[]).filter(function(x){return x.reception_id===r.id;})[0];
 var rejection=(r.status==='REJECTED'&&rej&&rej.disposition_status!=='RESOLVED')?'<form class="card" data-action="resolve-rejection" data-id="'+esc(r.id)+'"><h2>Rejection Disposition</h2><p class="muted">Le rejet ne ferme pas le dossier. Indiquez la destination ou décision réelle prise pour le camion.</p><div class="ops-form-grid">'+field('Disposition / Action','resolution_action','text','','required placeholder="Return to source / reroute / negotiated decision..."')+field('Reason','resolution_reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn signal">Resolve Rejection</button></div></form>':(rej&&rej.disposition_status==='RESOLVED'?'<section class="card"><h2>Rejection Disposition</h2><div class="ops-def-grid"><div><small>Action</small><b>'+esc(rej.resolution_action||'-')+'</b></div><div><small>Reason</small><b>'+esc(rej.resolution_reason||'-')+'</b></div><div><small>Resolved by</small><b>'+esc(rej.resolved_by_name||'-')+'</b></div><div><small>Date</small><b>'+dt(rej.resolved_at)+'</b></div></div></section>':'');
 var settlement='<section class="card"><h2>Commercial Settlement</h2><p class="muted">Warehouse est la vérité physique. Refraction, prix, approbation et paiement sont gérés uniquement dans Procurement > Achat RCN.</p><div class="ops-def-grid"><div><small>Commercial status</small><b>'+esc(r.procurement_settlement_status||'-')+'</b></div><div><small>Paid Weight</small><b>'+(r.paid_weight_kg==null?'-':kg(r.paid_weight_kg))+'</b></div><div><small>Refraction</small><b>'+(r.refraction_kg==null?'-':kg(r.refraction_kg))+'</b></div></div><div class="ops-actions" style="margin-top:12px"><a class="btn secondary" href="procurement.html#purchases">Open Achat RCN</a></div></section>';
 root.innerHTML=head(r.id,r.truck+' · '+(r.supplier_name||'-'),'<a class="btn secondary" href="#inbound">Retour</a><a class="btn secondary" href="#quality/'+encodeURIComponent(r.id)+'">Open Quality</a>')+
 '<div class="ops-def-grid"><div><small>Status</small><b>'+badge(r.status)+'</b></div><div><small>Warehouse</small><b>'+esc(r.warehouse_code||'-')+'</b></div><div><small>Supplier</small><b>'+esc(r.supplier_code+' · '+r.supplier_name)+'</b></div><div><small>Origin</small><b>'+esc(r.origin||'-')+'</b></div><div><small>Expected</small><b>'+kg(r.expected_kg||0)+'</b></div><div><small>Net</small><b>'+(r.net_kg==null?'-':kg(r.net_kg))+'</b></div><div><small>Lot</small><b>'+esc(r.lot_id||'-')+'</b></div><div><small>Next action</small><b>'+esc(r.next_action||'-')+'</b></div></div>'+
 '<section class="card"><div class="card-head"><div><h2>Document Check</h2><p>Delivery Note · Weighbridge · Driver · Transporter · Purchase Type.</p></div>'+badge(docsOk?'DOCUMENTS COMPLETE':'DOCUMENTS INCOMPLETE')+'</div>'+
 '<div class="ops-def-grid"><div><small>Delivery Note</small><b>'+esc(r.delivery_note||'-')+'</b></div><div><small>Weighbridge Ticket</small><b>'+esc(r.weighbridge_ticket||'-')+'</b></div><div><small>Driver</small><b>'+esc(r.driver||'-')+'</b></div><div><small>Transporter</small><b>'+esc(r.transporter||'-')+'</b></div><div><small>Purchase Type</small><b>'+esc(r.purchase_type||'-')+'</b></div><div><small>Expected Bags</small><b>'+esc(r.expected_bags==null?'-':r.expected_bags)+'</b></div></div></section>'+
 '<section class="card"><h2>Procurement Link</h2><div class="ops-def-grid"><div><small>Channel</small><b>'+esc(r.procurement_channel||'-')+'</b></div><div><small>Source</small><b>'+esc(r.procurement_source_type||'-')+'</b></div><div><small>Source ID</small><b>'+esc(r.procurement_source_id||'-')+'</b></div><div><small>Paid Weight</small><b>'+(r.paid_weight_kg==null?'-':kg(r.paid_weight_kg))+'</b></div><div><small>Refraction</small><b>'+(r.refraction_kg==null?'-':kg(r.refraction_kg))+'</b></div><div><small>Commercial status</small><b>'+esc(r.procurement_settlement_status||'-')+'</b></div></div></section>'+ '<section class="card"><h2>Timeline</h2>'+timelineRec(r)+'</section>'+offloadForm(r)+settlement+rejection+corr;
}

function qualityList(){
 var a=state.receptions.filter(function(r){return['ARRIVED','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD','AWAITING_FINAL_QA','QUALITY_HOLD','RELEASED'].indexOf(r.status)>=0;});
 root.innerHTML=head('Quality','Work Queue Sampling, décision, Final Quality et Hold.')+
 '<div class="kpi-grid">'+kpi('Sampling Pending',a.filter(function(r){return!r.sampling_id&&r.status==='ARRIVED';}).length,'#quality','')+
 kpi('Awaiting Decision',a.filter(function(r){return r.status==='AWAITING_DECISION';}).length,'#quality','attn')+
 kpi('Final QA Pending',a.filter(function(r){return r.status==='AWAITING_FINAL_QA'&&!r.final_id;}).length,'#quality','attn')+
 kpi('Quality Hold',a.filter(function(r){return r.status==='QUALITY_HOLD';}).length,'#quality','danger')+
 '</div><section class="card">'+table(['REC / Truck','Supplier','Sampling KOR','Moisture','Decision','Final KOR','Delta','Lot','Status','Action'],a.map(function(r){return'<tr class="ops-click" data-href="#quality/'+encodeURIComponent(r.id)+'"><td><span class="mono">'+esc(r.id)+'</span><br>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||'-')+'</td><td>'+esc(r.sampling_kor==null?'-':r.sampling_kor)+'</td><td>'+esc(r.sampling_moisture==null?'-':r.sampling_moisture+' %')+'</td><td>'+esc(r.decision||'-')+'</td><td>'+esc(r.final_kor==null?'-':r.final_kor)+'</td><td>'+esc(r.kor_delta==null?'-':r.kor_delta)+'</td><td class="mono">'+esc(r.lot_id||'-')+'</td><td>'+badge(r.status)+'</td><td>'+esc(r.next_action||'-')+'</td></tr>';}))+'</section>';
}
function qForm(r,type){
 var allowed=type==='SAMPLING'?can('sampling')&&['ARRIVED','AWAITING_DECISION'].indexOf(r.status)>=0:can('final_qa')&&['AWAITING_FINAL_QA','QUALITY_HOLD'].indexOf(r.status)>=0;
 if(!allowed)return'';
 return'<form class="card" data-action="quality" data-id="'+esc(r.id)+'" data-type="'+type+'"><h2>'+type+'</h2><div class="ops-form-grid" style="margin-top:12px">'+
 field('Good Kernel g','gk_g','number','','required step="0.001" min="0"')+field('Immature g','imm_g','number','','required step="0.001" min="0"')+field('Spotted g','spotted_g','number','','required step="0.001" min="0"')+
 field('Moisture %','moisture_pct','number','','step="0.01" min="0"')+field('Nut Count','nut_count','number','','min="0"')+textarea('Note','note','')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Save '+type+'</button></div></form>';
}
function decisionPanel(r){
 if(r.status!=='AWAITING_DECISION'||!can('decision'))return'';
 return'<section class="card"><h2>Decision</h2><div class="ops-form-grid" style="margin-top:12px">'+field('Comment / Reject reason','decision_comment','text','')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary" data-action-button="accept" data-id="'+esc(r.id)+'">Accept</button><button class="btn signal" data-action-button="reject" data-id="'+esc(r.id)+'">Reject</button></div></section>';
}
function qualityDetail(r){
 var s=qualityFor(r.id,'SAMPLING'),f=qualityFor(r.id,'FINAL');
 var compare='<div class="grid-2"><section class="card"><h2>Sampling</h2><div class="ops-def-grid"><div><small>GK</small><b>'+esc(s?s.gk_g:'-')+'</b></div><div><small>IMM</small><b>'+esc(s?s.imm_g:'-')+'</b></div><div><small>SP</small><b>'+esc(s?s.spotted_g:'-')+'</b></div><div><small>KOR</small><b>'+esc(s?s.kor_display:'-')+'</b></div><div><small>Factor</small><b>'+esc(s?s.kor_factor:'-')+'</b></div><div><small>Moisture</small><b>'+esc(s?s.moisture_pct:'-')+'</b></div></div></section><section class="card"><h2>Final Quality</h2><div class="ops-def-grid"><div><small>GK</small><b>'+esc(f?f.gk_g:'-')+'</b></div><div><small>IMM</small><b>'+esc(f?f.imm_g:'-')+'</b></div><div><small>SP</small><b>'+esc(f?f.spotted_g:'-')+'</b></div><div><small>KOR</small><b>'+esc(f?f.kor_display:'-')+'</b></div><div><small>Delta</small><b>'+esc(f?f.delta_vs_sampling:'-')+'</b></div><div><small>Within tolerance</small><b>'+esc(f?(f.within_tolerance?'YES':'NO'):'-')+'</b></div></div></section></div>';
 var rel=(r.status==='AWAITING_FINAL_QA'&&r.final_id&&can('lot_release'))?'<section class="card"><h2>Lot Release</h2><div class="ops-actions"><button class="btn primary" data-action-button="release-lot" data-id="'+esc(r.id)+'">Release official Lot</button></div></section>':'';
 var hold=can('quality_hold')?'<section class="card"><h2>Quality Hold</h2><div class="ops-form-grid">'+field('Reason','hold_reason','text','')+'</div><div class="ops-actions">'+(r.status==='QUALITY_HOLD'?'<button class="btn primary" data-action-button="unhold" data-id="'+esc(r.id)+'">Release Hold</button>':'<button class="btn secondary" data-action-button="hold" data-id="'+esc(r.id)+'">Place on Hold</button>')+'</div></section>':'';
 root.innerHTML=head('Quality · '+r.id,r.truck+' · '+(r.supplier_name||'-'),'<a class="btn secondary" href="#quality">Retour</a><a class="btn secondary" href="#inbound/'+encodeURIComponent(r.id)+'">Inbound dossier</a>')+
 compare+qForm(r,'SAMPLING')+decisionPanel(r)+qForm(r,'FINAL')+rel+hold;
}

function lotsList(){
 root.innerHTML=head('RCN Lots','Passeport matière et généalogie.')+'<section class="card">'+table(['Lot','Reception','Supplier','Origin','Initial','Current','Staging','BIN','Drying','BIN count','Status'],state.lots.map(function(l){return'<tr class="ops-click" data-href="#lots/'+encodeURIComponent(l.id)+'"><td class="mono">'+esc(l.id)+'</td><td class="mono">'+esc(l.reception_id)+'</td><td>'+esc(l.supplier_name||'-')+'</td><td>'+esc(l.origin||'-')+'</td><td>'+kg(l.initial_kg)+'</td><td>'+kg(l.current_kg)+'</td><td>'+kg(l.staging_kg)+'</td><td>'+kg(l.bin_kg)+'</td><td>'+kg(l.drying_kg)+'</td><td>'+esc(l.bin_count||0)+'</td><td>'+badge(l.status)+'</td></tr>';}))+'</section>';
}
async function lotDetail(l){
 var contrib=await q('wms_v_bin_contributors','*',function(x){return x.eq('lot_id',l.id).gt('remaining_kg',0);});
 var mov=await q('wms_v_movements','*',function(x){return x.contains('lots',[{lot_id:l.id}]).order('posted_at',{ascending:false}).limit(100);}).catch(function(){return[];});
 var transferBtn=Number(l.bin_kg||0)>0?'<button class="btn primary" data-action-button="prepare-transfer-lot" data-id="'+esc(l.id)+'">Prepare Stock Transfer</button>':'';
 var post=await q('wms_v_post_dry_quality_current','*',function(x){return x.eq('lot_id',l.id).order('created_at',{ascending:false}).limit(50);}).catch(function(){return[];});
 var proc=await q('wms_v_lot_procurement_contributors','*',function(x){return x.eq('wms_lot_id',l.id).order('producer_name').limit(500);}).catch(function(){return[];});
 root.innerHTML=head(l.id,'Lot passport · '+(l.supplier_name||'-'),'<a class="btn secondary" href="#lots">Retour</a>'+transferBtn)+
 '<div class="ops-def-grid"><div><small>Reception</small><b>'+esc(l.reception_id)+'</b></div><div><small>Truck</small><b>'+esc(l.truck||'-')+'</b></div><div><small>Initial</small><b>'+kg(l.initial_kg)+'</b></div><div><small>Current</small><b>'+kg(l.current_kg)+'</b></div><div><small>Final KOR</small><b>'+esc(l.kor_final||'-')+'</b></div><div><small>Status</small><b>'+badge(l.status)+'</b></div></div>'+
 (proc.length?'<section class="card"><h2>Procurement Genealogy</h2><p class="muted">Quantités terrain conservées séparément du Net Warehouse; aucun écart n’est redistribué automatiquement.</p>'+table(['Producer','RT','Village','Field Purchase','Field kg','Bags','Field ↔ Warehouse variance'],proc.map(function(p){return'<tr><td><b>'+esc(p.producer_code||'-')+'</b><br>'+esc(p.producer_name||'-')+'</td><td>'+esc(p.rt_name||p.rt_id||'-')+'</td><td>'+esc(p.village_name||'-')+'</td><td class="mono">'+esc(p.achat_id||'-')+'</td><td>'+kg(p.field_qty_kg)+'</td><td>'+esc(p.field_bag_count==null?'-':p.field_bag_count)+'</td><td>'+kg(p.field_warehouse_variance_kg)+'</td></tr>';}))+'</section>':'')+
 '<section class="card"><h2>Current positions / BIN contributors</h2>'+table(['BIN','Remaining','Supplier','Origin','Truck','KOR'],contrib.map(function(c){return'<tr><td class="mono"><a href="#bins/'+encodeURIComponent(c.bin_id)+'">'+esc(c.bin_id)+'</a></td><td>'+kg(c.remaining_kg)+'</td><td>'+esc(c.supplier_name||'-')+'</td><td>'+esc(c.origin||'-')+'</td><td>'+esc(c.truck||'-')+'</td><td>'+esc(c.kor_final||'-')+'</td></tr>';}))+'</section>'+
 '<section class="card"><h2>Post-Dry Quality</h2>'+table(['Date','Drying','Batch','Cycle','BIN','KOR','Moisture','Disposition'],post.map(function(p){return'<tr><td>'+dt(p.created_at)+'</td><td class="mono">'+esc(p.drying_id)+'</td><td class="mono">'+esc(p.batch_id||'-')+'</td><td>'+esc(p.cycle_no||'-')+'</td><td class="mono">'+esc(p.dest_bin_id||'-')+'</td><td>'+esc(p.kor_display||'-')+'</td><td>'+esc(p.moisture_pct==null?'-':p.moisture_pct+' %')+'</td><td>'+badge(p.disposition||'-')+'</td></tr>';}))+'</section>'+
 '<section class="card"><h2>Recent movements</h2>'+table(['Date','Movement','Type','From','To','OUT','IN','Loss'],mov.map(function(m){return'<tr><td>'+dt(m.posted_at)+'</td><td class="mono">'+esc(m.id)+'</td><td>'+esc(m.type)+'</td><td>'+esc(m.source_type+':'+(m.source_id||''))+'</td><td>'+esc(m.dest_type+':'+(m.dest_id||''))+'</td><td>'+kg(m.qty_out)+'</td><td>'+kg(m.qty_in)+'</td><td>'+kg(m.process_loss_kg)+'</td></tr>';}))+'</section>';
}

function binsList(){
 var manage=can('master_data')?'<a class="btn secondary" href="#bins/warehouses">Manage Warehouses</a>':'';
 var create=can('bin_ops')?'<a class="btn primary ops-cta-create" href="#bins/new">+ Create BIN</a>':'';
 root.innerHTML=head('Stock & BIN','Position physique, capacité, contributeurs et cycle de vie.',manage+create)+
 '<section class="card">'+table(['BIN','Warehouse','Area','Type','Stock','Capacity','Occupancy','Contributors','Age','Status'],state.bins.map(function(b){return'<tr class="ops-click" data-href="#bins/'+encodeURIComponent(b.id)+'"><td class="mono">'+esc(b.id)+'</td><td>'+esc(b.warehouse_code||'-')+'</td><td>'+esc(b.area_code||'-')+'</td><td>'+esc(b.stock_type)+'</td><td>'+kg(b.balance_kg)+'</td><td>'+(b.capacity_kg==null?'-':kg(b.capacity_kg))+'</td><td>'+num(b.occupancy_pct,1)+' %</td><td>'+esc(b.contributors||0)+'</td><td>'+num(b.age_hours,1)+' h</td><td>'+badge(b.status)+'</td></tr>';}))+'</section>';
}
function warehouseManage(){
 root.innerHTML=head('Manage Warehouses','Créer, modifier, activer/désactiver et gérer les Physical Areas.','<a class="btn secondary" href="#bins">Retour</a><a class="btn primary" href="#bins/warehouse-new">+ Warehouse</a>')+
 '<section class="card">'+table(['Code','Site','Name','Location','Capacity','Status','Action'],state.warehouses.map(function(w){return'<tr><td class="mono">'+esc(w.code)+'</td><td>'+esc(w.site_code)+'</td><td>'+esc(w.name)+'</td><td>'+esc(w.location||'-')+'</td><td>'+(w.capacity_kg==null?'-':kg(w.capacity_kg))+'</td><td>'+badge(w.status)+'</td><td><a href="#bins/warehouse-edit/'+encodeURIComponent(w.id)+'">Edit</a> · <a href="#bins/areas/'+encodeURIComponent(w.id)+'">Areas</a></td></tr>';}))+'</section>';
}
function warehouseForm(w){
 root.innerHTML=head(w?'Edit Warehouse':'New Warehouse','Master Data WMS.','<a class="btn secondary" href="#bins/warehouses">Retour</a>')+
 '<form class="ops-form-card" data-action="warehouse-save" data-id="'+esc(w?w.id:'')+'"><div class="ops-form-grid">'+field('Site Code','site_code','text',w?w.site_code:'','required')+field('Warehouse Code','code','text',w?w.code:'','required')+field('Name','name','text',w?w.name:'','required')+field('Location','location','text',w?w.location:'')+field('Capacity kg','capacity_kg','number',w&&w.capacity_kg!=null?w.capacity_kg:'','step="0.001" min="0"')+select('Factory?','is_factory',[['false','No'],['true','Yes']],w&&w.is_factory?'true':'false')+(w?textarea('Reason','reason','','required'):'')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Save</button>'+(w?'<button type="button" class="btn secondary" data-action-button="wh-status" data-id="'+esc(w.id)+'" data-status="'+(w.status==='ACTIVE'?'INACTIVE':'ACTIVE')+'">'+(w.status==='ACTIVE'?'Deactivate':'Activate')+'</button>':'')+'</div></form>';
}
function areasRoute(wid){
 var w=whById(wid),arr=state.areas.filter(function(a){return String(a.warehouse_id)===String(wid);});
 root.innerHTML=head('Physical Areas · '+(w?w.code:''),'Reusable physical locations; Operational BIN IDs are never reused.','<a class="btn secondary" href="#bins/warehouses">Retour</a>')+
 '<form class="card" data-action="area-save" data-wh="'+esc(wid)+'"><h2>New / update area</h2><div class="ops-form-grid">'+field('Area Code','code','text','','required')+field('Description','description','text','')+field('Capacity kg','capacity_kg','number','','step="0.001" min="0"')+select('Status','status',[['ACTIVE','Active'],['INACTIVE','Inactive']],'ACTIVE')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Save Area</button></div></form>'+
 notice('info','<b>Protection:</b>&nbsp; une Physical Area ne peut pas être désactivée tant qu’un BIN lié n’est pas CLOSED.')+
 '<section class="card">'+table(['Code','Description','Capacity','Status','Action'],arr.map(function(a){return'<tr><td class="mono">'+esc(a.code)+'</td><td>'+esc(a.description||'-')+'</td><td>'+(a.capacity_kg==null?'-':kg(a.capacity_kg))+'</td><td>'+badge(a.status)+'</td><td><a href="#bins/area-edit/'+encodeURIComponent(a.id)+'">Edit</a></td></tr>';}))+'</section>';
}
function areaEdit(a){
 var openBins=state.bins.filter(function(b){return String(b.physical_area_id)===String(a.id)&&b.status!=='CLOSED';});
 root.innerHTML=head('Edit Physical Area · '+a.code,'Statut protégé par les BIN opérationnels.','<a class="btn secondary" href="#bins/areas/'+encodeURIComponent(a.warehouse_id)+'">Retour</a>')+
 (openBins.length?notice('warn','<b>'+openBins.length+' BIN non fermé(s).</b> La désactivation sera refusée tant qu’ils ne sont pas CLOSED.'):'')+
 '<form class="ops-form-card" data-action="area-save" data-id="'+esc(a.id)+'" data-wh="'+esc(a.warehouse_id)+'"><div class="ops-form-grid">'+field('Area Code','code','text',a.code,'required')+field('Description','description','text',a.description||'')+field('Capacity kg','capacity_kg','number',a.capacity_kg==null?'':a.capacity_kg,'step="0.001" min="0"')+select('Status','status',[['ACTIVE','Active'],['INACTIVE','Inactive']],a.status,'required')+field('Reason','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Save Area</button></div></form>';
}
function binNew(){
 var activeWh=state.warehouses.filter(function(w){return w.status==='ACTIVE';}),areaOpts=[['','No physical area']].concat(state.areas.filter(function(a){return a.status==='ACTIVE';}).map(function(a){var w=whById(a.warehouse_id);return[a.id,(w?w.code:'')+' / '+a.code];}));
 root.innerHTML=head('Create BIN','Operational BIN unique; Physical Area may be reused only after closure.','<a class="btn secondary" href="#bins">Retour</a>')+
 '<form class="ops-form-card" data-action="bin-create"><div class="ops-form-grid">'+select('Warehouse','warehouse_id',[['','Sélectionner...']].concat(activeWh.map(function(w){return[w.id,w.code+' - '+w.name];})),'','required')+select('Physical Area','physical_area_id',areaOpts,'')+select('Stock Type','stock_type',[['WET','WET'],['DRY','DRY'],['HOLD','HOLD']],'WET','required')+field('Capacity kg','capacity_kg','number','','step="0.001" min="0"')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Create BIN</button></div></form>';
}
async function binDetail(b){
 var contrib=await q('wms_v_bin_contributors','*',function(x){return x.eq('bin_id',b.id).gt('remaining_kg',0);});
 var lots=state.lots.filter(function(l){return Number(l.staging_kg||0)>0&&String(l.warehouse_id)===String(b.warehouse_id);});
 var dests=state.bins.filter(function(x){return x.id!==b.id&&String(x.warehouse_id)===String(b.warehouse_id)&&x.stock_type===b.stock_type&&['CLOSED','BLOCKED'].indexOf(x.status)<0;});
 var alloc=can('bin_ops')&&b.status!=='CLOSED'&&b.status!=='BLOCKED'?'<form class="card" data-action="allocate" data-bin="'+esc(b.id)+'"><h2>Add Lot</h2><div class="ops-form-grid">'+select('Lot','lot_id',[['','Sélectionner...']].concat(lots.map(function(l){return[l.id,l.id+' · staging '+kg(l.staging_kg)];})),'','required')+field('Qty kg','qty','number','','required step="0.001" min="0.001"')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Allocate Lot</button></div></form>':'';
 var transfer=can('bin_ops')&&b.status!=='CLOSED'&&b.status!=='BLOCKED'&&Number(b.balance_kg||0)>0?'<form class="card" data-action="bin-transfer" data-bin="'+esc(b.id)+'"><h2>BIN → BIN Transfer</h2><p class="muted">Les contributeurs LOT sont alloués automatiquement par le ledger.</p><div class="ops-form-grid">'+select('Destination BIN','to_bin',[['','Sélectionner...']].concat(dests.map(function(x){var free=x.capacity_kg==null?'∞':kg(Math.max(0,Number(x.capacity_kg)-Number(x.balance_kg||0)));return[x.id,x.id+' · stock '+kg(x.balance_kg)+' · free '+free];})),'','required')+field('Quantity kg','qty','number','','required step="0.001" min="0.001" max="'+esc(b.balance_kg)+'"')+field('Reason','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Post BIN Transfer</button></div></form>':'';
 var count=can('inventory_count')&&b.status!=='CLOSED'?'<form class="card" data-action="inventory-count" data-bin="'+esc(b.id)+'"><h2>Inventory Count</h2><div class="ops-form-grid">'+field('Physical kg','physical_kg','number','','required step="0.001" min="0"')+field('Note','note','text','')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn secondary">Create Count</button></div></form>':'';
 var close=can('bin_close')&&b.status!=='CLOSED'?'<form class="card" data-action="bin-close" data-bin="'+esc(b.id)+'"><h2>Close BIN</h2><div class="ops-form-grid">'+select('Physical Empty','physical_empty',[['false','No'],['true','Yes']],'false','required')+field('Residue kg','residue_kg','number','0','step="0.001" min="0"')+field('Reason','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Close & Lock</button></div></form>':'';
 var lifecycle='<section class="card"><h2>BIN Controls</h2><div class="ops-actions">'+
   (can('bin_close')&&b.status!=='CLOSED'?(b.status==='BLOCKED'?'<button class="btn secondary" data-action-button="bin-status" data-id="'+esc(b.id)+'" data-status="UNBLOCK">Unblock BIN</button>':'<button class="btn secondary" data-action-button="bin-status" data-id="'+esc(b.id)+'" data-status="BLOCKED">Block BIN</button>'):'')+
   (can('bin_reopen')&&b.status==='CLOSED'?'<button class="btn signal" data-action-button="bin-status" data-id="'+esc(b.id)+'" data-status="REOPEN">Reopen BIN</button>':'')+
   (Number(b.balance_kg||0)>0?'<button class="btn primary" data-action-button="prepare-transfer-bin" data-id="'+esc(b.id)+'">Prepare Stock Transfer</button>':'')+
 '</div></section>';
 root.innerHTML=head(b.id,b.warehouse_code+' · '+b.stock_type,'<a class="btn secondary" href="#bins">Retour</a>'+(Number(b.balance_kg||0)>0&&b.status!=='BLOCKED'&&b.status!=='CLOSED'?'<a class="btn secondary" href="#drying/new">Start Drying</a>':''))+
 '<div class="ops-def-grid"><div><small>Stock</small><b>'+kg(b.balance_kg)+'</b></div><div><small>Capacity</small><b>'+(b.capacity_kg==null?'-':kg(b.capacity_kg))+'</b></div><div><small>Available capacity</small><b>'+(b.capacity_kg==null?'∞':kg(Math.max(0,Number(b.capacity_kg)-Number(b.balance_kg||0))))+'</b></div><div><small>Occupancy</small><b>'+num(b.occupancy_pct,1)+' %</b></div><div><small>Area</small><b>'+esc(b.area_code||'-')+'</b></div><div><small>Contributors</small><b>'+esc(b.contributors||0)+'</b></div><div><small>Status</small><b>'+badge(b.status)+'</b></div><div><small>Reopen count</small><b>'+esc(b.reopen_count||0)+'</b></div></div>'+
 '<section class="card"><h2>Contributors</h2>'+table(['Lot','Supplier','Origin','Truck','IN','OUT','Remaining','KOR'],contrib.map(function(c){return'<tr><td class="mono"><a href="#lots/'+encodeURIComponent(c.lot_id)+'">'+esc(c.lot_id)+'</a></td><td>'+esc(c.supplier_name||'-')+'</td><td>'+esc(c.origin||'-')+'</td><td>'+esc(c.truck||'-')+'</td><td>'+kg(c.qty_in)+'</td><td>'+kg(c.qty_out)+'</td><td>'+kg(c.remaining_kg)+'</td><td>'+esc(c.kor_final||'-')+'</td></tr>';}))+'</section>'+lifecycle+alloc+transfer+count+close;
}

async function dryingRoute(){
 state.dryings=await q('wms_dryings','*',function(x){return x.order('created_at',{ascending:false}).limit(300);});
 root.innerHTML=head('Drying / Sorting','Before / after, process loss and genealogy.',can('drying')?'<a class="btn primary ops-cta-create" href="#drying/new">+ New Drying / Sorting</a>':'')+
 '<section class="card">'+table(['Operation','Batch','Cycle','Type','Source','Destination','Input','Output','Loss','Moisture','Status'],state.dryings.map(function(d){return'<tr class="ops-click" data-href="#drying/'+encodeURIComponent(d.id)+'"><td class="mono">'+esc(d.id)+'</td><td class="mono">'+esc(d.batch_id)+'</td><td>'+esc(d.cycle_no)+'</td><td>'+esc(d.type)+'</td><td class="mono">'+esc(d.source_bin_id)+'</td><td class="mono">'+esc(d.dest_bin_id)+'</td><td>'+kg(d.input_kg)+'</td><td>'+kg(d.output_kg)+'</td><td>'+kg(d.process_loss_kg)+' ('+num(d.process_loss_pct,2)+'%)</td><td>'+esc(d.moisture_before==null?'-':d.moisture_before+' → '+d.moisture_after)+'</td><td>'+badge(d.loss_alert?'LOSS ALERT':d.status)+'</td></tr>';}))+'</section>';
}
function dryingNew(){
 var avail=state.bins.filter(function(b){return Number(b.balance_kg||0)>0&&['CLOSED','BLOCKED'].indexOf(b.status)<0;}),all=state.bins.filter(function(b){return['CLOSED','BLOCKED'].indexOf(b.status)<0;});
 root.innerHTML=head('New Drying / Sorting','Physical issue + receipt, with declared process loss.','<a class="btn secondary" href="#drying">Retour</a>')+
 '<form class="ops-form-card" data-action="drying-create"><div class="ops-form-grid">'+select('Type','type',[['DRYING','Drying'],['SORTING','Sorting']],'DRYING','required')+select('Source BIN','source_bin_id',[['','Sélectionner...']].concat(avail.map(function(b){return[b.id,b.id+' · '+kg(b.balance_kg)];})),'','required')+select('Destination BIN','dest_bin_id',[['','Same as source']].concat(all.map(function(b){return[b.id,b.id];})),'')+
 field('Input kg','input_kg','number','','required step="0.001" min="0.001"')+field('Output kg','output_kg','number','','required step="0.001" min="0"')+field('Input Bags','input_bags','number','','min="0"')+field('Output Bags','output_bags','number','','min="0"')+
 field('Moisture Before','moisture_before','number','','step="0.01"')+field('Moisture After','moisture_after','number','','step="0.01"')+field('NC Before','nc_before','number','','min="0"')+field('NC After','nc_after','number','','min="0"')+
 field('KOR Before','kor_before','number','','step="0.01"')+field('KOR After','kor_after','number','','step="0.01"')+field('Parent Drying ID (Re-Dry)','parent_drying_id','text','')+textarea('Note','note','')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Post operation</button></div></form>';
 var pre=sessionStorage.getItem('wms_redry_prefill');
 if(pre){try{var p=JSON.parse(pre);Object.keys(p).forEach(function(k){var el=root.querySelector('[name="'+k+'"]');if(el)el.value=p[k];});sessionStorage.removeItem('wms_redry_prefill');}catch(e){}}
}
async function dryingDetail(d){
 var contributors=await q('wms_movement_lots','lot_id,qty_in',function(x){return x.eq('movement_id',d.receipt_movement_id).gt('qty_in',0);}).catch(function(){return[];});
 var snaps=await q('wms_v_post_dry_quality_current','*',function(x){return x.eq('drying_id',d.id).order('created_at',{ascending:false});}).catch(function(){return[];});
 var snapMap={};snaps.forEach(function(x){snapMap[x.lot_id]=x;});
 var pending=contributors.filter(function(x){return !snapMap[x.lot_id];});
 var form=can('post_dry_qa')&&pending.length?'<form class="card" data-action="post-dry-quality" data-drying="'+esc(d.id)+'"><h2>Post-Dry Quality</h2><p class="muted">Snapshot Quality indépendant du Warehouse Coordinator. Blank ≠ 0.</p><div class="ops-form-grid">'+
 select('LOT','lot_id',pending.map(function(x){return[x.lot_id,x.lot_id+' · '+kg(x.qty_in)];}),'','required')+
 field('Good Kernel g','gk_g','number','','required step="0.001" min="0"')+field('Immature g','imm_g','number','','required step="0.001" min="0"')+field('Spotted g','spotted_g','number','','required step="0.001" min="0"')+
 field('Moisture %','moisture_pct','number','','required step="0.01" min="0"')+field('Nut Count','nut_count','number','','min="0"')+
 select('Disposition','disposition',[['READY','READY'],['RE_DRY','RE-DRY'],['HOLD','HOLD']],'READY','required')+field('Decision Reason','decision_reason','text','')+textarea('Quality Note','note','')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Save Post-Dry Quality</button></div></form>':'';
 var redry=d.status==='RE_DRY'&&can('drying')?'<section class="card"><h2>Re-Dry Required</h2><p>Créez le cycle suivant en conservant Batch et généalogie.</p><div class="ops-actions"><button class="btn primary" data-action-button="redry" data-id="'+esc(d.id)+'">Start Re-Dry Cycle</button></div></section>':'';
 root.innerHTML=head(d.id,'Batch '+d.batch_id+' · Cycle '+d.cycle_no,'<a class="btn secondary" href="#drying">Retour</a>')+
 '<div class="ops-def-grid"><div><small>Status</small><b>'+badge(d.status)+'</b></div><div><small>Source</small><b>'+esc(d.source_bin_id)+'</b></div><div><small>Destination</small><b>'+esc(d.dest_bin_id)+'</b></div><div><small>Input</small><b>'+kg(d.input_kg)+'</b></div><div><small>Output</small><b>'+kg(d.output_kg)+'</b></div><div><small>Process Loss</small><b>'+kg(d.process_loss_kg)+' · '+num(d.process_loss_pct,2)+'%</b></div></div>'+
 '<section class="card"><h2>Quality genealogy</h2>'+table(['LOT','Qty after','Post-Dry KOR','Moisture','Disposition'],contributors.map(function(x){var ql=snapMap[x.lot_id];return'<tr><td class="mono">'+esc(x.lot_id)+'</td><td>'+kg(x.qty_in)+'</td><td>'+esc(ql?ql.kor_display:'PENDING')+'</td><td>'+esc(ql&&ql.moisture_pct!=null?ql.moisture_pct+' %':'-')+'</td><td>'+badge(ql?ql.disposition:'AWAITING_POST_DRY_QA')+'</td></tr>';}))+'</section>'+form+redry;
}


async function bagsRoute(){
 state.bagStock=await q('rcn_jute_v_stock','location_code,state,qty',function(x){return x.order('location_code').limit(500);});
 state.bagDebt=await q('wms_v_bag_supplier_balance','*',function(x){return x.order('balance',{ascending:false}).limit(300);});
 state.locations=await q('rcn_jute_locations','code,nom,actif',function(x){return x.eq('actif',true).order('code').limit(500);});
 var usable=state.bagStock.filter(function(x){return x.state==='UTILISABLE';}).reduce(function(t,x){return t+Number(x.qty||0);},0),dam=state.bagStock.filter(function(x){return['DECHIRE','A_REPARER'].indexOf(x.state)>=0;}).reduce(function(t,x){return t+Number(x.qty||0);},0),use=state.bagStock.filter(function(x){return x.state==='PLEIN';}).reduce(function(t,x){return t+Number(x.qty||0);},0);
 root.innerHTML=head('Bag Management','Ledger sacherie unique; Approval ≠ Physical Movement.',can('bag_move')?'<a class="btn primary ops-cta-create" href="#bags/new">+ Bag Movement</a>':'')+
 '<div class="kpi-grid">'+kpi('Physical Usable',usable,'#bags','')+kpi('Supplier Debt',state.bagDebt.reduce(function(t,x){return t+Number(x.balance||0);},0),'#bags','attn')+kpi('Damaged / Repair',dam,'#bags','')+kpi('In Use',use,'#bags','')+'</div>'+
 '<div class="grid-2"><section class="card"><h2>Physical stock</h2>'+table(['Location','State','Qty'],state.bagStock.map(function(x){return'<tr><td>'+esc(x.location_code)+'</td><td>'+esc(x.state)+'</td><td>'+esc(x.qty)+'</td></tr>';}))+'</section><section class="card"><h2>Supplier balance</h2>'+table(['Supplier','Issued','Returned','Approved loss','Outstanding'],state.bagDebt.map(function(x){return'<tr><td>'+esc(x.supplier_code)+'</td><td>'+esc(x.issued)+'</td><td>'+esc(x.returned)+'</td><td>'+esc(x.approved_loss)+'</td><td>'+esc(x.balance)+'</td></tr>';}))+'</section></div>';
}
function bagNew(){
 var locs=state.locations.map(function(x){return[x.code,x.code+' - '+(x.nom||'')];});
 root.innerHTML=head('New Bag Movement','Physical movement on the existing jute ledger.','<a class="btn secondary" href="#bags">Retour</a>')+
 '<form class="ops-form-card" data-action="bag-move"><div class="ops-form-grid">'+select('Kind','kind',[['DOTATION','Dotation'],['RETURN','Return'],['APPROVED_LOSS','Approved Loss'],['DAMAGED','Damaged'],['REPAIR_OUT','Repair'],['RECONDITIONED','Reconditioned'],['SCRAP','Scrapped'],['INTERNAL_USE','In Use / Drying'],['RETURN_FROM_USE','Return from Use'],['REBAGGING','Rebagging']],'DOTATION','required')+select('Location','location',[['','Sélectionner...']].concat(locs),'','required')+field('Qty','qty','number','','required min="1"')+field('Supplier Code','supplier_code','text','')+field('Reference','reference','text','')+field('Approved By','approved_by','text','')+field('BIN ID','bin_id','text','')+field('Lot ID','lot_id','text','')+textarea('Note','note','')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Post Bag Movement</button></div></form>';
}

async function inventoryRoute(){
 state.inventory=await q('wms_inventory_counts','*',function(x){return x.order('counted_at',{ascending:false}).limit(300);});
 root.innerHTML=head('Inventory','Cycle Count: physical count never changes stock before approval.')+
 '<section class="card">'+table(['Count','BIN','Theoretical','Physical','Variance','Status','Counted by','Approver','Date'],state.inventory.map(function(i){return'<tr><td class="mono">'+esc(i.id)+'</td><td class="mono">'+esc(i.bin_id)+'</td><td>'+kg(i.theoretical_kg)+'</td><td>'+kg(i.physical_kg)+'</td><td>'+kg(i.variance_kg)+'</td><td>'+badge(i.status)+'</td><td>'+esc(i.counted_by_name||'-')+'</td><td>'+esc(i.approved_by_name||'-')+'</td><td>'+dt(i.counted_at)+'</td></tr>';}))+'</section>'+
 (can('inventory_approve')?'<section class="card"><h2>Resolve open variance</h2><form data-action="inventory-resolve"><div class="ops-form-grid">'+select('Count','count_id',[['','Sélectionner...']].concat(state.inventory.filter(function(i){return i.status==='REVIEW_REQUIRED';}).map(function(i){return[i.id,i.id+' · '+i.bin_id+' · variance '+kg(i.variance_kg)];})),'','required')+select('Decision','approve',[['true','Approve adjustment'],['false','Reject count']],'true','required')+field('Reason','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Resolve</button></div></form></section>':'');
}

async function auditRoute(){
 state.audit=await q('wms_v_audit','*',function(x){return x.order('created_at',{ascending:false}).limit(500);});
 root.innerHTML=head('Audit','Read-only append-only journal.')+'<section class="card">'+table(['Date','Object','Type','Field / Action','Reason','Author','Role','Approver'],state.audit.map(function(a){return'<tr><td>'+dt(a.created_at)+'</td><td class="mono">'+esc(a.objet||'-')+'</td><td>'+esc(a.object_type||'-')+'</td><td>'+esc(a.champ||'-')+'</td><td>'+esc(a.motif||'-')+'</td><td>'+esc(a.auteur||'-')+'</td><td>'+esc(a.role||'-')+'</td><td>'+esc(a.approbateur||'-')+'</td></tr>';}))+'</section>';
}

async function render(){
 if(!root||!sb)return;
 root.innerHTML='<div class="empty">Chargement...</div>';
 await loadBase();
 var p=parts();
 if(p.route==='overview')return overview();
 if(p.route==='inbound'&&!p.id)return inboundList();
 if(p.route==='inbound'&&p.id==='new')return inboundNew();
 if(p.route==='inbound'&&p.id){var r=recById(p.id);return r?inboundDetail(r):root.innerHTML=notice('danger','Réception introuvable.');}
 if(p.route==='quality'&&!p.id)return qualityList();
 if(p.route==='quality'&&p.id){var qr=recById(p.id);return qr?qualityDetail(qr):root.innerHTML=notice('danger','Réception introuvable.');}
 if(p.route==='lots'&&!p.id)return lotsList();
 if(p.route==='lots'&&p.id){var l=lotById(p.id);return l?lotDetail(l):root.innerHTML=notice('danger','Lot introuvable.');}
 if(p.route==='bins'&&!p.id)return binsList();
 if(p.route==='bins'&&p.id==='warehouses')return warehouseManage();
 if(p.route==='bins'&&p.id==='warehouse-new')return warehouseForm(null);
 if(p.route==='bins'&&p.id.indexOf('warehouse-edit/')===0)return warehouseForm(whById(p.id.split('/')[1]));
 if(p.route==='bins'&&p.id.indexOf('areas/')===0)return areasRoute(p.id.split('/')[1]);
 if(p.route==='bins'&&p.id.indexOf('area-edit/')===0){var ar=state.areas.filter(function(x){return String(x.id)===String(p.id.split('/')[1]);})[0];return ar?areaEdit(ar):root.innerHTML=notice('danger','Physical Area introuvable.');}
 if(p.route==='bins'&&p.id==='new')return binNew();
 if(p.route==='bins'&&p.id){var b=binById(p.id);return b?binDetail(b):root.innerHTML=notice('danger','BIN introuvable.');}
 if(p.route==='drying'&&!p.id)return dryingRoute();
 if(p.route==='drying'&&p.id.indexOf('new')===0)return dryingNew();
 if(p.route==='drying'&&p.id){state.dryings=await q('wms_dryings','*',function(x){return x.eq('id',p.id).limit(1);});return state.dryings[0]?dryingDetail(state.dryings[0]):root.innerHTML=notice('danger','Drying introuvable.');}
 if(p.route==='bags'&&!p.id)return bagsRoute();
 if(p.route==='bags'&&p.id==='new'){await bagsRoute();return bagNew();}
 if(p.route==='inventory')return inventoryRoute();
 if(p.route==='audit')return auditRoute();
 return overview();
}

async function submit(ev){
 var f=ev.target.closest('form[data-action]');if(!f)return;ev.preventDefault();var d=formObj(f),a=f.dataset.action,k,r;busy(f,true);
 try{
  if(a==='reception-create'){k=opKey('RECEPTION','NEW');var ps=String(d.procurement_source||'').split('|');r=await rpc('wms_create_reception',{p:{truck:d.truck,supplier_code:d.supplier_code,origin:d.origin,warehouse_id:d.warehouse_id,expected_kg:d.expected_kg,expected_bags:d.expected_bags,arrival_at:d.arrival_at,purchase_type:d.purchase_type,reference:d.reference,driver:d.driver,transporter:d.transporter,delivery_note:d.delivery_note,weighbridge_ticket:d.weighbridge_ticket,procurement_source_type:ps.length>1?ps[0]:null,procurement_source_id:ps.length>1?ps.slice(1).join('|'):null,ad_hoc:d.ad_hoc==='true',ad_hoc_reason:d.ad_hoc_reason},p_idempotency_key:k.key});doneKey(k);location.hash='#inbound/'+encodeURIComponent(r.id);return;}
  if(a==='offload'){await rpc('wms_record_offload',{p_id:f.dataset.id,p:d});await render();return;}
  if(a==='resolve-rejection'){await rpc('procurement_resolve_rejection',{p_reception_id:f.dataset.id,p_action:d.resolution_action,p_reason:d.resolution_reason});await render();return;}
  if(a==='reception-correct'){await rpc('wms_correct_reception',{p_id:f.dataset.id,p_field:d.field,p_value:d.new_value,p_reason:d.reason,p_approver:d.approver});await render();return;}
  if(a==='quality'){k=opKey('QUALITY-'+f.dataset.type,f.dataset.id);d.idempotency_key=k.key;await rpc('wms_save_quality',{p_reception_id:f.dataset.id,p_type:f.dataset.type,p:d});doneKey(k);await render();return;}
  if(a==='warehouse-save'){var payload={id:f.dataset.id||undefined,site_code:d.site_code,code:d.code,name:d.name,location:d.location,capacity_kg:d.capacity_kg,is_factory:d.is_factory==='true',reason:d.reason};await rpc('wms_upsert_warehouse',{p:payload});location.hash='#bins/warehouses';return;}
  if(a==='area-save'){await rpc('wms_upsert_area',{p:{id:f.dataset.id||undefined,warehouse_id:f.dataset.wh,code:d.code,description:d.description,capacity_kg:d.capacity_kg,status:d.status,reason:d.reason}});if(f.dataset.id){location.hash='#bins/areas/'+encodeURIComponent(f.dataset.wh);}else await render();return;}
  if(a==='bin-create'){k=opKey('BIN','NEW');await rpc('wms_create_bin',{p:{warehouse_id:d.warehouse_id,physical_area_id:d.physical_area_id,stock_type:d.stock_type,capacity_kg:d.capacity_kg,idempotency_key:k.key}});doneKey(k);location.hash='#bins';return;}
  if(a==='allocate'){k=opKey('ALLOCATE',f.dataset.bin);await rpc('wms_allocate_lot_to_bin',{p_lot_id:d.lot_id,p_bin_id:f.dataset.bin,p_qty:Number(d.qty),p_idempotency_key:k.key});doneKey(k);await render();return;}
  if(a==='bin-transfer'){k=opKey('BIN-TRANSFER',f.dataset.bin);r=await rpc('wms_bin_transfer',{p_from_bin:f.dataset.bin,p_to_bin:d.to_bin,p_qty:Number(d.qty),p_idempotency_key:k.key,p_reason:d.reason});doneKey(k);alert('Movement posted: '+(r.id||'-'));await render();return;}
  if(a==='inventory-count'){k=opKey('COUNT',f.dataset.bin);await rpc('wms_create_inventory_count',{p_bin_id:f.dataset.bin,p_physical_kg:Number(d.physical_kg),p_note:d.note,p_idempotency_key:k.key});doneKey(k);location.hash='#inventory';return;}
  if(a==='inventory-resolve'){await rpc('wms_resolve_inventory_count',{p_count_id:d.count_id,p_approve:d.approve==='true',p_reason:d.reason});await render();return;}
  if(a==='bin-close'){await rpc('wms_close_bin',{p_bin_id:f.dataset.bin,p_physical_empty:d.physical_empty==='true',p_residue_kg:Number(d.residue_kg||0),p_reason:d.reason});await render();return;}
  if(a==='drying-create'){k=opKey('DRYING','NEW');d.idempotency_key=k.key;await rpc('wms_create_drying',{p:d});doneKey(k);location.hash='#drying';return;}
  if(a==='post-dry-quality'){k=opKey('POST-DRY',f.dataset.drying+'-'+d.lot_id);d.idempotency_key=k.key;await rpc('wms_save_post_dry_quality',{p_drying_id:f.dataset.drying,p_lot_id:d.lot_id,p:d});doneKey(k);await render();return;}
  if(a==='bag-move'){k=opKey('BAG','NEW');d.idempotency_key=k.key;await rpc('wms_bag_move',{p:d});doneKey(k);location.hash='#bags';return;}
 }catch(e){err(e);}finally{busy(f,false);}
}
async function click(ev){
 var row=ev.target.closest('[data-href]');if(row){location.hash=row.dataset.href;return;}
 var b=ev.target.closest('[data-action-button]');if(!b)return;var a=b.dataset.actionButton,idv=b.dataset.id;b.disabled=true;
 try{
  if(a==='accept'||a==='reject'){var c=document.querySelector('[name="decision_comment"]'),txt=c?c.value:'';if(a==='reject'&&!txt.trim())throw new Error('Motif obligatoire pour Reject.');await rpc('wms_decide_reception',{p_id:idv,p_accept:a==='accept',p_comment:txt});}
  if(a==='release-lot'){var k=opKey('LOT-RELEASE',idv);await rpc('wms_release_lot',{p_reception_id:idv,p_idempotency_key:k.key});doneKey(k);}
  if(a==='hold'||a==='unhold'){var h=document.querySelector('[name="hold_reason"]'),reason=h?h.value:'';if(!reason.trim())throw new Error('Motif obligatoire.');await rpc('wms_set_hold',{p_reception_id:idv,p_hold:a==='hold',p_reason:reason});}
  if(a==='wh-status'){var reason=prompt('Motif du changement de statut :')||'';if(!reason.trim())throw new Error('Motif obligatoire.');await rpc('wms_set_warehouse_status',{p_id:idv,p_status:b.dataset.status,p_reason:reason});}
  if(a==='bin-status'){var br=prompt('Motif de cette action BIN :')||'';if(!br.trim())throw new Error('Motif obligatoire.');await rpc('wms_set_bin_status',{p_bin_id:idv,p_status:b.dataset.status,p_reason:br});}
  if(a==='prepare-transfer-bin'){
    var bb=binById(idv);if(!bb)throw new Error('BIN introuvable.');
    sessionStorage.setItem('wms_transfer_prefill',JSON.stringify({origin_warehouse_id:bb.warehouse_id,bin_id:bb.id,available_kg:Number(bb.balance_kg||0),stock_type:bb.stock_type}));
    location.href='stock-transfer.html#requests/new';return;
  }
  if(a==='prepare-transfer-lot'){
    var ll=lotById(idv);if(!ll)throw new Error('LOT introuvable.');
    var cc=await q('wms_v_bin_contributors','*',function(x){return x.eq('lot_id',ll.id).gt('remaining_kg',0).order('remaining_kg',{ascending:false}).limit(1);});
    if(!cc.length)throw new Error('Aucun stock BIN disponible pour ce LOT.');
    var bx=binById(cc[0].bin_id);
    sessionStorage.setItem('wms_transfer_prefill',JSON.stringify({origin_warehouse_id:ll.warehouse_id,bin_id:cc[0].bin_id,lot_id:ll.id,available_kg:Number(cc[0].remaining_kg||0),stock_type:bx?bx.stock_type:''}));
    location.href='stock-transfer.html#requests/new';return;
  }
  if(a==='redry'){
    var dd=state.dryings.filter(function(x){return x.id===idv;})[0]||await q('wms_dryings','*',function(x){return x.eq('id',idv).limit(1);}).then(function(x){return x[0];});
    if(!dd)throw new Error('Drying introuvable.');
    sessionStorage.setItem('wms_redry_prefill',JSON.stringify({source_bin_id:dd.dest_bin_id,dest_bin_id:dd.dest_bin_id,parent_drying_id:dd.id,input_kg:dd.output_kg}));
    location.hash='#drying/new';return;
  }
  await render();
 }catch(e){err(e);}finally{b.disabled=false;}
}
async function init(){
 root=document.getElementById('opsRouteView');
 await waitAuth();
 sb=await waitClient();
 if(!sb){if(root)root.innerHTML=notice('danger','Connexion Supabase indisponible.');return;}
 var sess=await sb.auth.getSession();
 if(!sess||sess.error||!sess.data||!sess.data.session){if(root)root.innerHTML=notice('danger','Session utilisateur non disponible. Reconnectez-vous.');return;}
 root.addEventListener('submit',submit);root.addEventListener('click',click);
 root.addEventListener('change',function(ev){
   if(ev.target.name==='procurement_source')syncReceptionSource(ev.target.value);
   if(ev.target.name==='supplier_code'){var f=ev.target.closest('form[data-action="reception-create"]'),d=f&&f.querySelector('[name="supplier_code_display"]');if(d)d.value=ev.target.value;}
   if(ev.target.name==='field'){var cf=ev.target.closest('form[data-action="reception-correct"]');if(cf){var cur=cf.querySelector('[name="current_value"]'),map={};try{map=JSON.parse(cf.dataset.current||'{}');}catch(e){}if(cur)cur.value=map[ev.target.value]==null?'':map[ev.target.value];}}
 });
 root.addEventListener('input',function(ev){var f=ev.target.closest('form');if(!f)return;if(f.dataset.action==='offload'&&(ev.target.name==='gross_kg'||ev.target.name==='tare_kg')){var g=Number(f.querySelector('[name="gross_kg"]').value),t=Number(f.querySelector('[name="tare_kg"]').value),nn=f.querySelector('[name="net_kg"]');nn.value=(Number.isFinite(g)&&Number.isFinite(t)&&g>t)?(g-t).toFixed(3):'';}if(f.dataset.action==='procurement-settlement'&&(ev.target.name==='refraction_mode'||ev.target.name==='refraction_value')){var net=Number(f.querySelector('[name="net_snapshot"]').value||0),mode=f.querySelector('[name="refraction_mode"]').value,val=Number(f.querySelector('[name="refraction_value"]').value||0),ref=mode==='KG'?val:mode==='PERCENT'?net*val/100:0,p=f.querySelector('[name="paid_preview"]');p.value=Math.max(0,net-ref).toFixed(3);}});
 root.addEventListener('keydown',function(ev){var row=ev.target.closest('[data-href]');if(row&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();location.hash=row.dataset.href;}});
 global.ANAGROCI_OPS_ROUTE=function(){render().catch(err);};
 await render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){init().catch(err);});else init().catch(err);
})(window);
