/* ANAGROCI Operations Suite - Warehouse WMS MVP. */
(function(global){
'use strict';
if(!document.body || document.body.dataset.workspace!=='warehouse') return;

var root=null,sb=null,seq=0;
var state={permissions:{},warehouses:[],areas:[],receptions:[],lots:[],bins:[],quality:[],dryings:[],inventory:[],bagStock:[],bagDebt:[],locations:[],audit:[],overview:{}};

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
  state.receptions=await q('wms_v_receptions','*',function(x){return x.order('arrival_at',{ascending:false}).limit(500);});
  state.lots=await q('wms_v_lots','*',function(x){return x.order('created_at',{ascending:false}).limit(500);});
  state.bins=await q('wms_v_bins','*',function(x){return x.order('opened_at',{ascending:false}).limit(500);});
  state.quality=await q('wms_v_quality_current','*',function(x){return x.order('created_at',{ascending:false}).limit(1000);});
}
function whOpts(all){return[['','Sélectionner...']].concat(state.warehouses.filter(function(w){return all||w.status==='ACTIVE';}).map(function(w){return[w.id,w.code+' - '+w.name+(w.status!=='ACTIVE'?' ['+w.status+']':'')];}));}
function whById(v){return state.warehouses.filter(function(w){return String(w.id)===String(v);})[0];}
function recById(v){return state.receptions.filter(function(x){return x.id===v;})[0];}
function lotById(v){return state.lots.filter(function(x){return x.id===v;})[0];}
function binById(v){return state.bins.filter(function(x){return x.id===v;})[0];}
function qualityFor(rec,type){return state.quality.filter(function(x){return x.reception_id===rec&&x.type===type;})[0]||null;}

async function overview(){
  state.overview=await rpc('wms_overview',{p_warehouse_id:null})||{};
  var o=state.overview,att=state.receptions.filter(function(r){return['ARRIVED','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD','AWAITING_FINAL_QA','QUALITY_HOLD'].indexOf(r.status)>=0;}).sort(function(a,b){return Number(b.age_hours||0)-Number(a.age_hours||0);}).slice(0,15);
  root.innerHTML=head('Warehouse Operations','Control Tower RCN : exceptions, décisions et prochaines actions.',can('reception_create')?'<a class="btn primary ops-cta-create" href="#inbound/new">+ New Reception</a>':'')+
  '<div class="kpi-grid">'+
  kpi('Awaiting Sampling',o.awaiting_sampling||0,'#quality','')+
  kpi('Awaiting Decision',o.awaiting_decision||0,'#quality',(o.awaiting_decision||0)?'attn':'')+
  kpi('Accepted Waiting Offload',o.accepted_waiting_offload||0,'#inbound',(o.accepted_waiting_offload||0)?'attn':'')+
  kpi('Final QA Pending',o.final_qa_pending||0,'#quality',(o.final_qa_pending||0)?'attn':'')+
  kpi('Quality Hold',o.quality_hold||0,'#quality',(o.quality_hold||0)?'danger':'')+
  '</div><div class="grid-2"><section class="card"><div class="card-head"><div><h2>Actions requiring attention</h2><p>Priorité aux dossiers anciens et bloqués.</p></div></div>'+
  table(['Reception','Truck','Supplier','Warehouse','Age','Status','Next'],att.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.id)+'"><td class="mono">'+esc(r.id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||'-')+'</td><td>'+esc(r.warehouse_code||'-')+'</td><td>'+num(r.age_hours,1)+' h</td><td>'+badge(r.status)+'</td><td>'+esc(r.next_action||'-')+'</td></tr>';}))+
  '</section><section class="card"><h2>Stock & controls</h2><div class="ops-def-grid" style="margin-top:12px"><div><small>Wet</small><b>'+mt(o.wet_stock_kg||0)+'</b></div><div><small>Dry</small><b>'+mt(o.dry_stock_kg||0)+'</b></div><div><small>Hold</small><b>'+mt(o.hold_stock_kg||0)+'</b></div><div><small>Active BIN</small><b>'+esc(o.active_bins||0)+'</b></div><div><small>Inventory variance</small><b>'+esc(o.inventory_variances||0)+'</b></div><div><small>Outstanding bags</small><b>'+esc(o.outstanding_bags||0)+'</b></div></div>'+
  notice('info','<b>KOR Factor:</b>&nbsp;'+esc(((o.params||{}).korFactor||{}).factor||'À valider')+' · <b>Tolerance:</b>&nbsp;'+esc(((o.params||{}).korTolerance||{}).value||'À valider'))+'</section></div>';
}

function inboundList(){
 var a=state.receptions;
 root.innerHTML=head('Inbound','Arrivée physique, autorisation et déchargement.',can('reception_create')?'<a class="btn primary ops-cta-create" href="#inbound/new">+ New Reception</a>':'')+
 notice('ok','<b>Règle:</b>&nbsp; aucun offloading avant décision ACCEPTED.')+
 '<section class="card">'+table(['Reception','Truck','Supplier','Origin','Warehouse','Expected','Arrival','Status','Next'],a.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.id)+'"><td class="mono">'+esc(r.id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||'-')+'</td><td>'+esc(r.origin||'-')+'</td><td>'+esc(r.warehouse_code||'-')+'</td><td>'+mt(r.expected_kg||0)+'</td><td>'+dt(r.arrival_at)+'</td><td>'+badge(r.status)+'</td><td>'+esc(r.next_action||'-')+'</td></tr>';}))+'</section>';
}
function inboundNew(){
 root.innerHTML=head('New Reception','Création d’un dossier camion RCN.','<a class="btn secondary" href="#inbound">Retour</a>')+
 '<form class="ops-form-card" data-action="reception-create"><div class="ops-form-grid">'+
 field('Truck Number','truck','text','','required')+field('Supplier','supplier_name','text','','required')+field('Supplier Code','supplier_code','text','')+field('Origin','origin','text','','required')+
 select('Warehouse','warehouse_id',whOpts(false),'','required')+field('Expected Weight kg','expected_kg','number','','step="0.001" min="0"')+field('Expected Bags','expected_bags','number','','min="0"')+
 field('Arrival','arrival_at','datetime-local','')+field('Purchase Type','purchase_type','text','')+field('Reference','reference','text','')+field('Driver','driver','text','')+field('Transporter','transporter','text','')+
 '</div><div class="ops-actions" style="margin-top:14px"><button class="btn primary">Create Reception</button></div></form>';
}
function timelineRec(r){
 var arr=[['Arrival',r.arrival_at,r.created_by_name],['Sampling',r.sampling_at,'Quality'],['Decision',r.decided_at,r.decided_by_name],['Offloading',r.offloaded_at,'Warehouse'],['Final QA',r.final_at,'Quality']].filter(function(x){return x[1];});
 return'<div class="ops-timeline">'+arr.map(function(x){return'<div class="ops-timeline-item"><time>'+dt(x[1])+'</time><div><b>'+esc(x[0])+'</b><small>'+esc(x[2]||'-')+'</small></div></div>';}).join('')+'</div>';
}
function offloadForm(r){
 if(r.status!=='ACCEPTED_WAITING_OFFLOAD'||!can('offload'))return'';
 return'<form class="card" data-action="offload" data-id="'+esc(r.id)+'"><h2>Offloading / Weighing</h2><div class="ops-form-grid" style="margin-top:12px">'+
 field('Gross kg','gross_kg','number','','step="0.001"')+field('Tare kg','tare_kg','number','','step="0.001"')+field('Net kg','net_kg','number','','step="0.001"')+
 field('Bags total','bags','number','','min="0"')+field('Bags good','bags_good','number','','min="0"')+field('Bags wet','bags_wet','number','','min="0"')+field('Bags torn','bags_torn','number','','min="0"')+field('Bags reconditioned','bags_recond','number','','min="0"')+
 field('Weighbridge ticket','weighbridge_ticket','text','')+field('Delivery note','delivery_note','text','')+field('Warehouse receipt','warehouse_receipt','text','')+
 field('Offload start','offload_start','datetime-local','')+field('Offload end','offload_end','datetime-local','')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Record Offloading</button></div></form>';
}
function inboundDetail(r){
 root.innerHTML=head(r.id,r.truck+' · '+(r.supplier_name||'-'),'<a class="btn secondary" href="#inbound">Retour</a><a class="btn secondary" href="#quality/'+encodeURIComponent(r.id)+'">Open Quality</a>')+
 '<div class="ops-def-grid"><div><small>Status</small><b>'+badge(r.status)+'</b></div><div><small>Warehouse</small><b>'+esc(r.warehouse_code||'-')+'</b></div><div><small>Expected</small><b>'+kg(r.expected_kg||0)+'</b></div><div><small>Net</small><b>'+(r.net_kg==null?'-':kg(r.net_kg))+'</b></div><div><small>Lot</small><b>'+esc(r.lot_id||'-')+'</b></div><div><small>Next action</small><b>'+esc(r.next_action||'-')+'</b></div></div>'+
 '<section class="card"><h2>Timeline</h2>'+timelineRec(r)+'</section>'+offloadForm(r);
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
 root.innerHTML=head(l.id,'Lot passport · '+(l.supplier_name||'-'),'<a class="btn secondary" href="#lots">Retour</a>')+
 '<div class="ops-def-grid"><div><small>Reception</small><b>'+esc(l.reception_id)+'</b></div><div><small>Truck</small><b>'+esc(l.truck||'-')+'</b></div><div><small>Initial</small><b>'+kg(l.initial_kg)+'</b></div><div><small>Current</small><b>'+kg(l.current_kg)+'</b></div><div><small>Final KOR</small><b>'+esc(l.kor_final||'-')+'</b></div><div><small>Status</small><b>'+badge(l.status)+'</b></div></div>'+
 '<section class="card"><h2>Current positions / BIN contributors</h2>'+table(['BIN','Remaining','Supplier','Origin','Truck','KOR'],contrib.map(function(c){return'<tr><td class="mono"><a href="#bins/'+encodeURIComponent(c.bin_id)+'">'+esc(c.bin_id)+'</a></td><td>'+kg(c.remaining_kg)+'</td><td>'+esc(c.supplier_name||'-')+'</td><td>'+esc(c.origin||'-')+'</td><td>'+esc(c.truck||'-')+'</td><td>'+esc(c.kor_final||'-')+'</td></tr>';}))+'</section>'+
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
 '<section class="card">'+table(['Code','Description','Capacity','Status'],arr.map(function(a){return'<tr><td class="mono">'+esc(a.code)+'</td><td>'+esc(a.description||'-')+'</td><td>'+(a.capacity_kg==null?'-':kg(a.capacity_kg))+'</td><td>'+badge(a.status)+'</td></tr>';}))+'</section>';
}
function binNew(){
 var activeWh=state.warehouses.filter(function(w){return w.status==='ACTIVE';}),areaOpts=[['','No physical area']].concat(state.areas.filter(function(a){return a.status==='ACTIVE';}).map(function(a){var w=whById(a.warehouse_id);return[a.id,(w?w.code:'')+' / '+a.code];}));
 root.innerHTML=head('Create BIN','Operational BIN unique; Physical Area may be reused only after closure.','<a class="btn secondary" href="#bins">Retour</a>')+
 '<form class="ops-form-card" data-action="bin-create"><div class="ops-form-grid">'+select('Warehouse','warehouse_id',[['','Sélectionner...']].concat(activeWh.map(function(w){return[w.id,w.code+' - '+w.name];})),'','required')+select('Physical Area','physical_area_id',areaOpts,'')+select('Stock Type','stock_type',[['WET','WET'],['DRY','DRY'],['HOLD','HOLD']],'WET','required')+field('Capacity kg','capacity_kg','number','','step="0.001" min="0"')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Create BIN</button></div></form>';
}
async function binDetail(b){
 var contrib=await q('wms_v_bin_contributors','*',function(x){return x.eq('bin_id',b.id).gt('remaining_kg',0);});
 var lots=state.lots.filter(function(l){return Number(l.staging_kg||0)>0&&String(l.warehouse_id)===String(b.warehouse_id);});
 var alloc=can('bin_ops')&&b.status!=='CLOSED'&&b.status!=='BLOCKED'?'<form class="card" data-action="allocate" data-bin="'+esc(b.id)+'"><h2>Add Lot</h2><div class="ops-form-grid">'+select('Lot','lot_id',[['','Sélectionner...']].concat(lots.map(function(l){return[l.id,l.id+' · staging '+kg(l.staging_kg)];})),'','required')+field('Qty kg','qty','number','','required step="0.001" min="0.001"')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Allocate Lot</button></div></form>':'';
 var count=can('inventory_count')&&b.status!=='CLOSED'?'<form class="card" data-action="inventory-count" data-bin="'+esc(b.id)+'"><h2>Inventory Count</h2><div class="ops-form-grid">'+field('Physical kg','physical_kg','number','','required step="0.001" min="0"')+field('Note','note','text','')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn secondary">Create Count</button></div></form>':'';
 var close=can('bin_close')&&b.status!=='CLOSED'?'<form class="card" data-action="bin-close" data-bin="'+esc(b.id)+'"><h2>Close BIN</h2><div class="ops-form-grid">'+select('Physical Empty','physical_empty',[['false','No'],['true','Yes']],'false','required')+field('Residue kg','residue_kg','number','0','step="0.001" min="0"')+field('Reason','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Close & Lock</button></div></form>':'';
 root.innerHTML=head(b.id,b.warehouse_code+' · '+b.stock_type,'<a class="btn secondary" href="#bins">Retour</a><a class="btn secondary" href="#drying/new?bin='+encodeURIComponent(b.id)+'">Start Drying</a>')+
 '<div class="ops-def-grid"><div><small>Stock</small><b>'+kg(b.balance_kg)+'</b></div><div><small>Capacity</small><b>'+(b.capacity_kg==null?'-':kg(b.capacity_kg))+'</b></div><div><small>Occupancy</small><b>'+num(b.occupancy_pct,1)+' %</b></div><div><small>Area</small><b>'+esc(b.area_code||'-')+'</b></div><div><small>Contributors</small><b>'+esc(b.contributors||0)+'</b></div><div><small>Status</small><b>'+badge(b.status)+'</b></div></div>'+
 '<section class="card"><h2>Contributors</h2>'+table(['Lot','Supplier','Origin','Truck','IN','OUT','Remaining','KOR'],contrib.map(function(c){return'<tr><td class="mono"><a href="#lots/'+encodeURIComponent(c.lot_id)+'">'+esc(c.lot_id)+'</a></td><td>'+esc(c.supplier_name||'-')+'</td><td>'+esc(c.origin||'-')+'</td><td>'+esc(c.truck||'-')+'</td><td>'+kg(c.qty_in)+'</td><td>'+kg(c.qty_out)+'</td><td>'+kg(c.remaining_kg)+'</td><td>'+esc(c.kor_final||'-')+'</td></tr>';}))+'</section>'+alloc+count+close;
}

async function dryingRoute(){
 state.dryings=await q('wms_dryings','*',function(x){return x.order('created_at',{ascending:false}).limit(300);});
 root.innerHTML=head('Drying / Sorting','Before / after, process loss and genealogy.',can('drying')?'<a class="btn primary ops-cta-create" href="#drying/new">+ New Drying / Sorting</a>':'')+
 '<section class="card">'+table(['Operation','Batch','Cycle','Type','Source','Destination','Input','Output','Loss','Moisture','Status'],state.dryings.map(function(d){return'<tr><td class="mono">'+esc(d.id)+'</td><td class="mono">'+esc(d.batch_id)+'</td><td>'+esc(d.cycle_no)+'</td><td>'+esc(d.type)+'</td><td class="mono">'+esc(d.source_bin_id)+'</td><td class="mono">'+esc(d.dest_bin_id)+'</td><td>'+kg(d.input_kg)+'</td><td>'+kg(d.output_kg)+'</td><td>'+kg(d.process_loss_kg)+' ('+num(d.process_loss_pct,2)+'%)</td><td>'+esc(d.moisture_before==null?'-':d.moisture_before+' → '+d.moisture_after)+'</td><td>'+badge(d.loss_alert?'LOSS ALERT':d.status)+'</td></tr>';}))+'</section>';
}
function dryingNew(){
 var avail=state.bins.filter(function(b){return Number(b.balance_kg||0)>0&&['CLOSED','BLOCKED'].indexOf(b.status)<0;}),all=state.bins.filter(function(b){return['CLOSED','BLOCKED'].indexOf(b.status)<0;});
 root.innerHTML=head('New Drying / Sorting','Physical issue + receipt, with declared process loss.','<a class="btn secondary" href="#drying">Retour</a>')+
 '<form class="ops-form-card" data-action="drying-create"><div class="ops-form-grid">'+select('Type','type',[['DRYING','Drying'],['SORTING','Sorting']],'DRYING','required')+select('Source BIN','source_bin_id',[['','Sélectionner...']].concat(avail.map(function(b){return[b.id,b.id+' · '+kg(b.balance_kg)];})),'','required')+select('Destination BIN','dest_bin_id',[['','Same as source']].concat(all.map(function(b){return[b.id,b.id];})),'')+
 field('Input kg','input_kg','number','','required step="0.001" min="0.001"')+field('Output kg','output_kg','number','','required step="0.001" min="0"')+field('Input Bags','input_bags','number','','min="0"')+field('Output Bags','output_bags','number','','min="0"')+
 field('Moisture Before','moisture_before','number','','step="0.01"')+field('Moisture After','moisture_after','number','','step="0.01"')+field('NC Before','nc_before','number','','min="0"')+field('NC After','nc_after','number','','min="0"')+
 field('KOR Before','kor_before','number','','step="0.01"')+field('KOR After','kor_after','number','','step="0.01"')+field('Parent Drying ID (Re-Dry)','parent_drying_id','text','')+textarea('Note','note','')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Post operation</button></div></form>';
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
 if(p.route==='bins'&&p.id==='new')return binNew();
 if(p.route==='bins'&&p.id){var b=binById(p.id);return b?binDetail(b):root.innerHTML=notice('danger','BIN introuvable.');}
 if(p.route==='drying'&&!p.id)return dryingRoute();
 if(p.route==='drying'&&p.id.indexOf('new')===0)return dryingNew();
 if(p.route==='bags'&&!p.id)return bagsRoute();
 if(p.route==='bags'&&p.id==='new'){await bagsRoute();return bagNew();}
 if(p.route==='inventory')return inventoryRoute();
 if(p.route==='audit')return auditRoute();
 return overview();
}

async function submit(ev){
 var f=ev.target.closest('form[data-action]');if(!f)return;ev.preventDefault();var d=formObj(f),a=f.dataset.action,k,r;busy(f,true);
 try{
  if(a==='reception-create'){k=opKey('RECEPTION','NEW');r=await rpc('wms_create_reception',{p:{truck:d.truck,supplier_name:d.supplier_name,supplier_code:d.supplier_code,origin:d.origin,warehouse_id:d.warehouse_id,expected_kg:d.expected_kg,expected_bags:d.expected_bags,arrival_at:d.arrival_at||null,purchase_type:d.purchase_type,reference:d.reference,driver:d.driver,transporter:d.transporter},p_idempotency_key:k.key});doneKey(k);location.hash='#inbound/'+encodeURIComponent(r.id);return;}
  if(a==='offload'){await rpc('wms_record_offload',{p_id:f.dataset.id,p:d});await render();return;}
  if(a==='quality'){k=opKey('QUALITY-'+f.dataset.type,f.dataset.id);d.idempotency_key=k.key;await rpc('wms_save_quality',{p_reception_id:f.dataset.id,p_type:f.dataset.type,p:d});doneKey(k);await render();return;}
  if(a==='warehouse-save'){var payload={id:f.dataset.id||undefined,site_code:d.site_code,code:d.code,name:d.name,location:d.location,capacity_kg:d.capacity_kg,is_factory:d.is_factory==='true',reason:d.reason};await rpc('wms_upsert_warehouse',{p:payload});location.hash='#bins/warehouses';return;}
  if(a==='area-save'){await rpc('wms_upsert_area',{p:{warehouse_id:f.dataset.wh,code:d.code,description:d.description,capacity_kg:d.capacity_kg,status:d.status}});await render();return;}
  if(a==='bin-create'){k=opKey('BIN','NEW');await rpc('wms_create_bin',{p:{warehouse_id:d.warehouse_id,physical_area_id:d.physical_area_id,stock_type:d.stock_type,capacity_kg:d.capacity_kg,idempotency_key:k.key}});doneKey(k);location.hash='#bins';return;}
  if(a==='allocate'){k=opKey('ALLOCATE',f.dataset.bin);await rpc('wms_allocate_lot_to_bin',{p_lot_id:d.lot_id,p_bin_id:f.dataset.bin,p_qty:Number(d.qty),p_idempotency_key:k.key});doneKey(k);await render();return;}
  if(a==='inventory-count'){k=opKey('COUNT',f.dataset.bin);await rpc('wms_create_inventory_count',{p_bin_id:f.dataset.bin,p_physical_kg:Number(d.physical_kg),p_note:d.note,p_idempotency_key:k.key});doneKey(k);location.hash='#inventory';return;}
  if(a==='inventory-resolve'){await rpc('wms_resolve_inventory_count',{p_count_id:d.count_id,p_approve:d.approve==='true',p_reason:d.reason});await render();return;}
  if(a==='bin-close'){await rpc('wms_close_bin',{p_bin_id:f.dataset.bin,p_physical_empty:d.physical_empty==='true',p_residue_kg:Number(d.residue_kg||0),p_reason:d.reason});await render();return;}
  if(a==='drying-create'){k=opKey('DRYING','NEW');d.idempotency_key=k.key;await rpc('wms_create_drying',{p:d});doneKey(k);location.hash='#drying';return;}
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
 root.addEventListener('submit',submit);root.addEventListener('click',click);root.addEventListener('keydown',function(ev){var row=ev.target.closest('[data-href]');if(row&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();location.hash=row.dataset.href;}});
 global.ANAGROCI_OPS_ROUTE=function(){render().catch(err);};
 await render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){init().catch(err);});else init().catch(err);
})(window);
