/* ANAGROCI Operations Suite - Warehouse WMS MVP. */
(function(global){
'use strict';
if(!document.body || document.body.dataset.workspace!=='warehouse') return;

var root=null,sb=null,seq=0;
var state={permissions:{},warehouses:[],areas:[],suppliers:[],receptions:[],lots:[],bins:[],quality:[],postDry:[],dryings:[],inventory:[],transfers:[],bagMovements:[],bagStock:[],bagDebt:[],locations:[],audit:[],overview:{},closings:[],rejectionReasons:[],grns:[],scope:null,loadErrors:[],whFilter:'',recLimit:200,movFilter:{page:0}};

function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function num(v,d){var x=Number(v);return Number.isFinite(x)?x.toLocaleString('fr-FR',{maximumFractionDigits:d==null?2:d}):'-';}
function kg(v){return num(v,2)+' kg';}
function mt(v){return num(Number(v||0)/1000,3)+' MT';}
function dt(v){if(!v)return'-';try{return new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch(e){return esc(v);}}
function parts(){var h=(location.hash||'#overview').replace(/^#/,'').split('/');return{route:h[0]||'overview',id:decodeURIComponent(h.slice(1).join('/')||'')};}
function badge(s){var x=String(s||'').toUpperCase(),c=/REJECT|REFUS|BLOCK|HOLD|ERROR|VARIANCE/.test(x)?'danger':/CLOSED|RELEASED|ACTIVE|OK|ADJUSTED/.test(x)?'ok':/AWAIT|READY|PENDING|ARRIVED|ACCEPTED|REVIEW/.test(x)?'warn':'info';return'<span class="badge '+c+'">'+esc(s||'-')+'</span>';}
function head(t,s,a){return'<div class="ops-route-head"><div><h1>'+esc(t)+'</h1><p>'+esc(s||'')+'</p></div><div class="ops-route-actions">'+(a||'')+'</div></div>';}
function notice(cls,html){return'<div class="notice '+(cls||'')+'"><div>'+html+'</div></div>';}
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

function swallow(label){return function(e){state.loadErrors.push(label+' : '+(e&&e.message?e.message:e));return[];};}
async function loadProfileScope(){
  if(state.scope)return state.scope;
  var uid=(state.permissions||{}).uid,sc={role:(state.permissions||{}).role||null,warehouse_code:null,warehouse_id:null,scoped:false};
  try{
    var res=await Promise.all([
      uid?q('profils','role,warehouse_code',function(x){return x.eq('user_id',uid).limit(1);}):Promise.resolve([]),
      q('wms_parameters','value,version,governance_status',function(x){return x.eq('key','transferRoleMatrix').eq('active',true).order('version',{ascending:false}).limit(5);})
    ]);
    var pm=res[1],cur=pm.filter(function(v){return v.governance_status==='VALIDE';})[0]||pm.filter(function(v){return v.governance_status!=='ARCHIVE';})[0]||pm[0];
    var scopedRoles=((cur&&cur.value)||{}).warehouse_scoped_roles||[];
    if(res[0][0]){sc.role=res[0][0].role;sc.warehouse_code=res[0][0].warehouse_code||null;}
    sc.scoped=scopedRoles.indexOf(sc.role)>=0;
  }catch(e){state.loadErrors.push('Profil / périmètre : '+e.message);}
  state.scope=sc;return sc;
}
function whFilterId(){
  if(state.scope&&state.scope.scoped)return state.scope.warehouse_id||'00000000-0000-0000-0000-000000000000';
  return state.whFilter||'';
}
async function loadBase(){
  state.loadErrors=[];
  state.permissions=await rpc('wms_my_permissions')||{};
  var first=await Promise.all([q('wms_warehouses','*',function(x){return x.order('site_code').order('code');}),loadProfileScope()]);
  state.warehouses=first[0];
  if(state.scope&&state.scope.warehouse_code){var sw=state.warehouses.filter(function(w){return w.code===state.scope.warehouse_code;})[0];state.scope.warehouse_id=sw?sw.id:null;}
  try{state.whFilter=sessionStorage.getItem('wms-wh-filter')||'';}catch(e){state.whFilter='';}
  var wf=whFilterId();
  function byWh(x){return wf?x.eq('warehouse_id',wf):x;}
  var r=await Promise.all([
    q('wms_physical_areas','*',function(x){return byWh(x).order('code').limit(500);}).catch(swallow('Zones physiques')),
    q('rcn_fournisseurs','code,nom,statut,categorie,origines,sites',function(x){return x.eq('statut','ACTIF').order('code').limit(1000);}).catch(swallow('Fournisseurs')),
    q('wms_v_receptions','*',function(x){return byWh(x).order('arrival_at',{ascending:false}).limit(state.recLimit||200);}).catch(swallow('Réceptions')),
    q('wms_v_lots','*',function(x){return byWh(x).order('created_at',{ascending:false}).limit(500);}).catch(swallow('Lots')),
    q('wms_v_bins','*',function(x){return byWh(x).order('opened_at',{ascending:false}).limit(500);}).catch(swallow('BIN')),
    q('wms_v_quality_current','*',function(x){return x.order('created_at',{ascending:false}).limit(1000);}).catch(swallow('Qualité')),
    q('procurement_purchase_types','code,label,channel_code',function(x){return x.eq('active',true).order('code');}).catch(swallow('Types d’achat')),
    q('procurement_v_pending_receptions','*',function(x){return byWh(x).order('source_date',{ascending:false}).limit(500);}).catch(swallow('Arrivages Procurement')),
    q('procurement_payment_methods','code,label',function(x){return x.eq('active',true).order('code');}).catch(swallow('Modes de paiement')),
    q('procurement_v_rejected_trucks','*',function(x){return x.order('decided_at',{ascending:false}).limit(300);}).catch(swallow('Camions refoulés')),
    q('wms_rejection_reasons','code,label,category,requires_comment,sort_order',function(x){return x.eq('active',true).order('sort_order');}).catch(swallow('Motifs de refus')),
    q('wms_grns','id,reception_id,lot_id,status,issued_at,issued_by_name',function(x){return byWh(x).order('issued_at',{ascending:false}).limit(500);}).catch(swallow('GRN'))
  ]);
  state.areas=r[0];state.suppliers=r[1];state.receptions=r[2];state.lots=r[3];state.bins=r[4];state.quality=r[5];state.purchaseTypes=r[6];
  state.pendingProcurement=r[7];state.paymentMethods=r[8];state.rejectedTrucks=r[9];state.rejectionReasons=r[10];state.grns=r[11];
}
async function fetchRec(idv){
  var r=recById(idv);if(r)return r;
  var x=await q('wms_v_receptions','*',function(b){return b.eq('id',idv).limit(1);});
  if(!x[0])return null;
  state.receptions.push(x[0]);
  var qs=await q('wms_v_quality_current','*',function(b){return b.eq('reception_id',idv);}).catch(swallow('Qualité du dossier'));
  qs.forEach(function(z){if(!state.quality.some(function(y){return y.id===z.id;}))state.quality.push(z);});
  if(x[0].lot_id&&!lotById(x[0].lot_id)){var lx=await q('wms_v_lots','*',function(b){return b.eq('id',x[0].lot_id).limit(1);}).catch(swallow('LOT du dossier'));if(lx[0])state.lots.push(lx[0]);}
  return x[0];
}
async function fetchLot(idv){var l=lotById(idv);if(l)return l;var x=await q('wms_v_lots','*',function(b){return b.eq('id',idv).limit(1);});if(x[0])state.lots.push(x[0]);return x[0]||null;}
async function fetchBin(idv){var b=binById(idv);if(b)return b;var x=await q('wms_v_bins','*',function(z){return z.eq('id',idv).limit(1);});if(x[0])state.bins.push(x[0]);return x[0]||null;}
function grnFor(rid){return (state.grns||[]).filter(function(g){return g.reception_id===rid;})[0]||null;}
async function loadDocStatus(rid){var d=await q('wms_v_reception_documents_status','*',function(x){return x.eq('reception_id',rid).limit(1);});return d[0]||null;}
function whOpts(all){return[['','Sélectionner...']].concat(state.warehouses.filter(function(w){return all||w.status==='ACTIVE';}).map(function(w){return[w.id,w.code+' - '+w.name+(w.status!=='ACTIVE'?' ['+w.status+']':'')];}));}
function whById(v){return state.warehouses.filter(function(w){return String(w.id)===String(v);})[0];}
function recById(v){return state.receptions.filter(function(x){return x.id===v;})[0];}
function lotById(v){return state.lots.filter(function(x){return x.id===v;})[0];}
function binById(v){return state.bins.filter(function(x){return x.id===v;})[0];}
function qualityFor(rec,type){return state.quality.filter(function(x){return x.reception_id===rec&&x.type===type;})[0]||null;}
function statusLabelFr(v){
 var m={
  ARRIVED:'Arrivé · Échantillonnage à effectuer',
  AWAITING_DECISION:'En attente de décision qualité',
  ACCEPTED_WAITING_OFFLOAD:'Accepté · En attente de pesée / déchargement',
  AWAITING_FINAL_QA:'En attente de qualité finale',
  QUALITY_HOLD:'Bloqué pour contrôle qualité',
  RELEASED:'LOT créé et libéré',
  REJECTED:'Réception rejetée',
  CLOSED:'Clôturé',
  BLOCKED:'Bloqué',
  READY:'Prêt pour transfert',
  RE_DRY:'Nouveau séchage requis',
  AWAITING_POST_DRY_QA:'En attente de qualité après séchage',
  ACTIVE:'Actif',
  INACTIVE:'Inactif',
  QUARANTINE:'LOT en quarantaine (qualité finale en attente)',
  HOLD:'LOT bloqué (HOLD)',
  REQUIRES_DECISION:'Décision Branch Manager requise',
  EXHAUSTED:'LOT épuisé'
 };
 return m[String(v||'').toUpperCase()]||String(v||'-').replace(/_/g,' ');
}
function businessBadge(v){return badge(statusLabelFr(v));}
function workflowSteps(r){
 var l=r.lot_id?lotById(r.lot_id):null;
 var released=l?['RELEASED','EXHAUSTED','CLOSED'].indexOf(l.status)>=0:r.status==='RELEASED';
 return[
  {label:'Réception',done:!!r.arrival_at},
  {label:'Échantillonnage',done:!!r.sampling_id},
  {label:'Décision',done:!!r.decision||['ACCEPTED_WAITING_OFFLOAD','AWAITING_FINAL_QA','QUALITY_HOLD','RELEASED','REJECTED'].indexOf(r.status)>=0,blocked:r.status==='REJECTED'&&!r.offloaded_at},
  {label:'Pesée & Déchargement',done:!!r.offloaded_at,current:r.status==='ACCEPTED_WAITING_OFFLOAD'},
  {label:'LOT en stock (quarantaine)',done:!!r.lot_id,locked:!r.offloaded_at},
  {label:'Qualité finale',done:!!r.final_id,current:r.status==='AWAITING_FINAL_QA'&&!r.final_id,locked:!r.offloaded_at,blocked:r.status==='QUALITY_HOLD'},
  {label:'Libération LOT',done:released,current:r.status==='AWAITING_FINAL_QA'&&!!r.final_id,locked:!r.final_id,blocked:!!(l&&['HOLD','REQUIRES_DECISION','REJECTED'].indexOf(l.status)>=0)},
  {label:'Affectation BIN',done:released&&Number((l||{}).bin_kg||0)>0,current:released&&Number((l||{}).staging_kg||0)>0,locked:!released}
 ];
}
function workflowStepper(r){
 var steps=workflowSteps(r);
 return'<section class="card"><div class="card-head"><div><h2>Progression du dossier</h2><p>'+esc(r.id)+' · '+esc(r.truck||'-')+' · '+esc(r.supplier_name||'-')+'</p></div></div><div class="ops-actions" style="gap:8px;flex-wrap:wrap">'+
 steps.map(function(x){
   var icon=x.blocked?'⚠':x.done?'✓':x.current?'●':x.locked?'🔒':'○';
   var cls=x.blocked?'signal':x.done?'primary':x.current?'secondary':'';
   return'<span class="btn '+cls+'" aria-label="'+esc(x.label+' '+(x.done?'terminé':x.current?'en cours':x.locked?'verrouillé':'à venir'))+'" style="pointer-events:none">'+icon+' '+esc(x.label)+'</span>';
 }).join('')+'</div></section>';
}
function nextActionForReception(r){
 var l=r.lot_id?lotById(r.lot_id):null,rid=encodeURIComponent(r.id);
 if(r.status==='REJECTED'){
   if(l&&Number(l.current_kg||0)>0.0005)return{label:'Enregistrer le retour fournisseur du LOT rejeté',explanation:'Le LOT '+l.id+' est rejeté mais toujours en stock ('+kg(l.current_kg)+'). Enregistrez sa sortie physique (bon de sortie).',route:'#lots/'+encodeURIComponent(l.id),allowed:can('lot_return'),owner:'Warehouse'};
   return{terminal:true,label:'Réception rejetée',explanation:'Aucun déchargement ni LOT ne peut être créé pour cette réception. Le dossier de refus suit son traitement (disposition).',route:'#inbound/'+rid,allowed:true};
 }
 if(r.status==='ARRIVED'&&!r.sampling_id)return{label:'Effectuer l’échantillonnage',explanation:'La réception est enregistrée. Effectuez maintenant le contrôle qualité d’échantillonnage.',route:'#quality/'+rid,allowed:can('sampling'),owner:'Qualité'};
 if(r.status==='AWAITING_DECISION')return{label:'Prendre la décision qualité',explanation:'L’échantillonnage est terminé. Acceptez ou refoulez le camion (motif obligatoire en cas de refus).',route:'#quality/'+rid,allowed:can('decision'),owner:'Responsable autorisé'};
 if(r.status==='ACCEPTED_WAITING_OFFLOAD')return{label:'Continuer vers Pesée / Déchargement',explanation:'Le camion est accepté. Procédez maintenant à la pesée et au déchargement.',route:'#inbound/'+rid+'/offload',allowed:can('offload'),owner:'Warehouse'};
 if(r.status==='QUALITY_HOLD')return{label:'Traiter le LOT bloqué',explanation:l?'Le LOT '+l.id+' ('+kg(l.current_kg)+') est en stock mais bloqué : placez-le en BIN HOLD, faites une contre-analyse (motif obligatoire), puis décidez : dérogation tracée, rejet ou levée du blocage par une autre personne que l’analyste.':'Le dossier est bloqué pour contrôle qualité.',route:'#quality/'+rid,allowed:can('quality_hold')||can('final_qa')||can('quality_derogation')||can('lot_reject'),owner:'Qualité / Branch Manager'};
 if(r.status==='AWAITING_FINAL_QA'&&!r.final_id)return{label:'Effectuer la qualité finale',explanation:r.lot_id?'La marchandise est déchargée et comptée en stock dans le LOT '+r.lot_id+' (quarantaine). Effectuez la qualité finale.':'La pesée et le déchargement sont terminés. Effectuez maintenant la qualité finale.',route:'#quality/'+rid+'/final',allowed:can('final_qa'),owner:'Quality Cutter'};
 if(r.status==='AWAITING_FINAL_QA'&&r.final_id)return{label:r.lot_id?'Libérer le LOT':'Créer et libérer le LOT',explanation:'La qualité finale est conforme. Libérez le LOT pour autoriser son stockage en BIN et le circuit d’achat.',route:'#quality/'+rid+'/release',allowed:can('lot_release'),owner:'Qualité'};
 if(r.status==='RELEASED'&&l){
   if(Number(l.staging_kg||0)>0){
     var hasBin=state.bins.some(function(b){return String(b.warehouse_id)===String(l.warehouse_id)&&b.stock_type!=='HOLD'&&['CLOSED','BLOCKED'].indexOf(b.status)<0;});
     return hasBin?
       {label:'Affecter le LOT à un BIN',explanation:'Le LOT est libéré et du stock reste en staging. Affectez-le à un emplacement de stockage.',route:'#lots/'+encodeURIComponent(l.id)+'/allocate',allowed:can('bin_ops'),owner:'Warehouse'}:
       {label:'Créer un BIN pour ce LOT',explanation:'Le LOT est prêt mais aucun BIN disponible n’existe dans cet entrepôt.',route:'#bins/new',allowed:can('bin_ops'),owner:'Warehouse',lot_id:l.id,warehouse_id:l.warehouse_id};
   }
   if(Number(l.bin_kg||0)>0)return{label:'Consulter le LOT',explanation:'Le LOT est stocké en BIN. Le séchage ou le transfert peut maintenant être préparé selon le besoin.',route:'#lots/'+encodeURIComponent(l.id),allowed:true,owner:'Warehouse'};
 }
 return{label:'Consulter le dossier',explanation:'Aucune action automatique supplémentaire n’a été déterminée.',route:'#inbound/'+rid,allowed:true};
}
function nextActionCard(r){
 var a=nextActionForReception(r),btn='';
 if(a.lot_id&&a.warehouse_id){
   btn=a.allowed?'<button class="btn primary" data-action-button="create-bin-for-lot" data-id="'+esc(a.lot_id)+'" data-wh="'+esc(a.warehouse_id)+'">'+esc(a.label)+'</button>':'';
 }else if(a.allowed){
   btn='<a class="btn primary" href="'+esc(a.route)+'">'+esc(a.label)+'</a>';
 }
 return'<section class="card"><div class="card-head"><div><h2>'+(a.terminal?'État du dossier':'Prochaine étape')+'</h2><p>'+esc(a.explanation)+'</p></div></div>'+
 (a.owner?'<div class="ops-def-grid"><div><small>Responsable</small><b>'+esc(a.owner)+'</b></div><div><small>Statut</small><b>'+businessBadge(r.status)+'</b></div></div>':'')+
 '<div class="ops-actions" style="margin-top:12px">'+btn+(!a.allowed&&!a.terminal?'<span class="muted">Action non disponible pour votre rôle.</span>':'')+'</div></section>';
}
function contextualLotsEmpty(){
 var candidates=state.receptions.filter(function(r){return r.status!=='REJECTED'&&!r.lot_id&&['ARRIVED','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD','AWAITING_FINAL_QA','QUALITY_HOLD'].indexOf(r.status)>=0;});
 if(!candidates.length)return'<div class="ops-empty"><b>Aucun LOT n’a encore été créé.</b><br>Un LOT est créé automatiquement au déchargement, en quarantaine, puis libéré après qualité finale conforme.</div>';
 return'<div class="grid-2">'+candidates.slice(0,8).map(function(r){
   var a=nextActionForReception(r);
   return'<section class="card"><h3>'+esc(r.id)+'</h3><p>'+esc(r.truck||'-')+' · '+esc(r.supplier_name||'-')+'</p><p><b>Étape actuelle :</b> '+esc(statusLabelFr(r.status))+'</p><div class="ops-actions">'+(a.allowed?'<a class="btn primary" href="'+esc(a.route)+'">Continuer le traitement du camion</a>':'<span class="muted">Prochaine action : '+esc(a.label)+'</span>')+'</div></section>';
 }).join('')+'</div>';
}


async function overview(){
  state.overview=await rpc('wms_overview',{p_warehouse_id:null})||{};
  var today=new Date().toISOString().slice(0,10);
  var wfo=whFilterId();
  var activeWh=state.warehouses.filter(function(w){return w.status==='ACTIVE'&&(!wfo||String(w.id)===String(wfo));});
  state.closings=await Promise.all(activeWh.map(function(w){return rpc('wms_daily_closing',{p_warehouse_id:w.id,p_date:today}).then(function(x){x.warehouse_code=w.code;return x;}).catch(function(e){state.loadErrors.push('Clôture '+w.code+' : '+(e&&e.message?e.message:e));return null;});}));
  state.closings=state.closings.filter(Boolean);
  state.dryings=await q('wms_dryings','*',function(x){return (wfo?x.eq('warehouse_id',wfo):x).order('created_at',{ascending:false}).limit(300);}).catch(swallow('Séchages'));
  state.postDry=await q('wms_v_post_dry_quality_current','*',function(x){return x.order('created_at',{ascending:false}).limit(500);}).catch(swallow('Qualité après séchage'));
  state.inventory=await q('wms_inventory_counts','*',function(x){return (wfo?x.eq('warehouse_id',wfo):x).gte('counted_at',today+'T00:00:00Z').order('counted_at',{ascending:false}).limit(300);}).catch(swallow('Inventaires'));
  state.transfers=await q('wms_v_transfers','*',function(x){return x.eq('is_test',false).gte('requested_at',today+'T00:00:00Z').order('requested_at',{ascending:false}).limit(300);}).catch(swallow('Transferts'));
  state.bagMovements=await q('rcn_jute_movements','id,movement_type,qty,movement_at,source_type',function(x){return x.in('source_type',['WMS','WMS_RECEPTION','WMS_TRANSFER']).gte('movement_at',today+'T00:00:00Z').order('movement_at',{ascending:false}).limit(500);}).catch(swallow('Mouvements sacs'));
  var o=state.overview,att=state.receptions.filter(function(r){return['ARRIVED','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD','AWAITING_FINAL_QA','QUALITY_HOLD'].indexOf(r.status)>=0;}).sort(function(a,b){return Number(b.age_hours||0)-Number(a.age_hours||0);}).slice(0,15);
  var stagingLots=state.lots.filter(function(l){return Number(l.staging_kg||0)>0.0005&&['RELEASED','EXHAUSTED'].indexOf(l.status)>=0;});
  var blockedLots=state.lots.filter(function(l){return['QUARANTINE','HOLD','REQUIRES_DECISION','REJECTED'].indexOf(l.status)>=0&&Number(l.current_kg||0)>0.0005;});
  var nearBins=state.bins.filter(function(b){return b.status!=='CLOSED'&&Number(b.occupancy_pct||0)>=Number(((o.params||{}).binCapacityAlertPct)||90);});
  var blockedBins=state.bins.filter(function(b){return b.status==='BLOCKED';});
  var dryingExceptions=state.dryings.filter(function(d){return d.loss_alert||['AWAITING_POST_DRY_QA','QUALITY_HOLD','RE_DRY'].indexOf(d.status)>=0;});
  var readyTransfer=state.postDry.filter(function(q){return q.disposition==='READY';});
  var stockActions=[];
  stagingLots.slice(0,10).forEach(function(l){stockActions.push({priority:'HIGH',object:l.id,status:'STAGING',action:'Allocate to BIN',href:'#lots/'+encodeURIComponent(l.id),age:Number(l.age_hours||0)});});
  blockedBins.slice(0,10).forEach(function(b){stockActions.push({priority:'CRITICAL',object:b.id,status:'BLOCKED',action:'Resolve BIN block',href:'#bins/'+encodeURIComponent(b.id),age:Number(b.age_hours||0)});});
  dryingExceptions.slice(0,10).forEach(function(d){stockActions.push({priority:d.loss_alert?'CRITICAL':'HIGH',object:d.id,status:d.status,action:d.status==='RE_DRY'?'Start Re-Dry':d.status==='AWAITING_POST_DRY_QA'?'Qualité après séchage':'Review Drying exception',href:'#drying/'+encodeURIComponent(d.id),age:0});});
  readyTransfer.slice(0,10).forEach(function(q){stockActions.push({priority:'NORMAL',object:q.lot_id||q.drying_id,status:'READY',action:'Préparer le transfert',href:q.lot_id?'#lots/'+encodeURIComponent(q.lot_id):'#drying/'+encodeURIComponent(q.drying_id),age:0});});
  stockActions.sort(function(a,b){var p={CRITICAL:3,HIGH:2,NORMAL:1};return (p[b.priority]||0)-(p[a.priority]||0)||Number(b.age||0)-Number(a.age||0);});
  root.innerHTML=head('Opérations Entrepôt','Control Tower RCN : exceptions, décisions et prochaines actions.',can('reception_create')?'<a class="btn primary ops-cta-create" href="#inbound/new">+ Nouvelle réception</a>':'')+
  '<div class="kpi-grid">'+
  kpi('Échantillonnage en attente',o.awaiting_sampling||0,'#quality','')+
  kpi('Décision en attente',o.awaiting_decision||0,'#quality',(o.awaiting_decision||0)?'attn':'')+
  kpi('Acceptés en attente de pesée / déchargement',o.accepted_waiting_offload||0,'#inbound',(o.accepted_waiting_offload||0)?'attn':'')+
  kpi('Qualité finale en attente',o.final_qa_pending||0,'#quality',(o.final_qa_pending||0)?'attn':'')+
  kpi('Blocage qualité',o.quality_hold||0,'#quality',(o.quality_hold||0)?'danger':'')+
  kpi('LOT non libérés en stock',blockedLots.length,'#lots',blockedLots.length?'danger':'','Quarantaine, HOLD, décision, rejet')+
  kpi('Staging non affecté',stagingLots.length,'#lots',stagingLots.length?'attn':'')+
  kpi('BIN proche de la capacité',nearBins.length,'#bins',nearBins.length?'attn':'')+
  kpi('BIN bloqué',blockedBins.length,'#bins',blockedBins.length?'danger':'')+
  kpi('Exceptions de séchage',dryingExceptions.length,'#drying',dryingExceptions.length?'danger':'')+
  kpi('Prêt pour transfert',readyTransfer.length,'#lots',readyTransfer.length?'ok':'')+
  '</div><div class="grid-2"><section class="card"><div class="card-head"><div><h2>Actions nécessitant une attention</h2><p>Priorité aux dossiers anciens et bloqués.</p></div></div>'+
  table(['Reception','Truck','Supplier','Warehouse','Age','Status','Next'],att.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.id)+'"><td class="mono">'+esc(r.id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||'-')+'</td><td>'+esc(r.warehouse_code||'-')+'</td><td>'+num(r.age_hours,1)+' h</td><td>'+badge(r.status)+'</td><td>'+esc(r.next_action||'-')+'</td></tr>';}))+
  '</section><section class="card"><h2>Stock & controls</h2><div class="ops-def-grid" style="margin-top:12px"><div><small>Wet</small><b>'+mt(o.wet_stock_kg||0)+'</b></div><div><small>Dry</small><b>'+mt(o.dry_stock_kg||0)+'</b></div><div><small>Hold</small><b>'+mt(o.hold_stock_kg||0)+'</b></div><div><small>Active BIN</small><b>'+esc(o.active_bins||0)+'</b></div><div><small>Inventory variance</small><b>'+esc(o.inventory_variances||0)+'</b></div><div><small>Outstanding bags</small><b>'+esc(o.outstanding_bags||0)+'</b></div></div>'+
  notice('info','<b>KOR Factor:</b>&nbsp;'+esc(((o.params||{}).korFactor||{}).factor||'À valider')+' · <b>Tolerance:</b>&nbsp;'+esc(((o.params||{}).korTolerance||{}).value||'À valider'))+'</section></div>'+
  '<section class="card"><div class="card-head"><div><h2>File des exceptions Warehouse</h2><p>Staging, BIN, drying et stock prêt transfert, triés par criticité.</p></div></div>'+
  table(['Priority','Object','Status','Prochaine action'],stockActions.slice(0,25).map(function(a){return'<tr class="ops-click" data-href="'+esc(a.href)+'"><td>'+badge(a.priority)+'</td><td class="mono">'+esc(a.object||'-')+'</td><td>'+badge(a.status)+'</td><td><b>'+esc(a.action)+'</b></td></tr>';}))+
  '</section>'+
  '<section class="card"><div class="card-head"><div><h2>Clôture journalière Warehouse</h2><p>Ouverture + Réceptions + Transferts entrants − Transferts sortants − Pertes process ± Ajustements − Sorties production − Retours fournisseur = Clôture. Le stock non libéré (quarantaine, HOLD, rejet) est inclus et ventilé. Les pertes constatées en transit sont affichées à part, hors bilan physique.</p></div></div>'+
  table(['Entrepôt','Ouverture','Réceptions','Trf entrant','Trf sortant','Perte process','Ajustements','Production','Retours fourn.','Clôture','dont non libéré','Écart','Statut'],state.closings.map(function(c){return'<tr><td><b>'+esc(c.warehouse_code)+'</b></td><td>'+kg(c.opening_stock_kg)+'</td><td>'+kg(c.receipts_kg)+'</td><td>'+kg(c.transfers_in_kg)+'</td><td>'+kg(c.transfers_out_kg)+'</td><td>'+kg(c.process_loss_kg)+'</td><td>'+kg(c.inventory_adjustments_kg)+(Math.abs(Number(c.transit_adjustments_kg||0))>0.0005?'<br><small>perte transit '+kg(c.transit_adjustments_kg)+' (hors stock)</small>':'')+'</td><td>'+kg(c.production_issues_kg)+'</td><td>'+kg(c.supplier_returns_kg)+'</td><td>'+kg(c.closing_stock_kg)+'</td><td>'+kg(c.stock_blocked_kg)+(Number(c.stock_blocked_kg||0)>0?'<br><small>Q '+kg(c.stock_lot_quarantine_kg)+' · HOLD '+kg(Number(c.stock_lot_hold_kg||0)+Number(c.stock_lot_requires_decision_kg||0))+' · rejet '+kg(c.stock_lot_rejected_kg)+'</small>':'')+'</td><td>'+kg(c.variance_kg)+'</td><td>'+badge(c.mass_balance_status)+'</td></tr>';}))+
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
 root.innerHTML=head('Inbound','Arrivée physique, autorisation et déchargement.',can('reception_create')?'<a class="btn primary ops-cta-create" href="#inbound/new">+ Nouvelle réception</a>':'')+
 notice('ok','<b>Règle:</b>&nbsp; aucun offloading avant décision ACCEPTED.')+
 '<div class="kpi-grid">'+kpi('Arrived / Sampling',a.filter(function(r){return r.status==='ARRIVED';}).length,'#quality','')+
 kpi('Décision en attente',a.filter(function(r){return r.status==='AWAITING_DECISION';}).length,'#quality','attn')+
 kpi('Accepted for Offload',accepted.length,'#inbound',accepted.length?'attn':'')+
 kpi('Rejected / Refoulé',rejected.length,'#inbound',rejected.length?'danger':'')+'</div>'+
 '<div class="grid-2"><section class="card"><h2>Acceptés pour pesée / déchargement</h2>'+table(['Reception','Truck','Supplier / Source','KOR','Moisture','Warehouse','Decision'],accepted.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.id)+'"><td class="mono">'+esc(r.id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||r.procurement_source_type||'-')+'</td><td>'+esc(r.sampling_kor==null?'-':r.sampling_kor)+'</td><td>'+esc(r.sampling_moisture==null?'-':r.sampling_moisture+' %')+'</td><td>'+esc(r.warehouse_code||'-')+'</td><td>'+dt(r.decided_at)+'</td></tr>'; }))+'</section>'+
 '<section class="card"><h2>Rejected / Refoulé</h2>'+table(['Reception','Truck','Source','KOR','Moisture','Reason','Disposition'],rejected.map(function(r){return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.reception_id)+'"><td class="mono">'+esc(r.reception_id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.procurement_channel||r.supplier_name||'-')+'</td><td>'+esc(r.sampling_kor==null?'-':r.sampling_kor)+'</td><td>'+esc(r.sampling_moisture==null?'-':r.sampling_moisture+' %')+'</td><td>'+esc(r.rejection_reason||'-')+'</td><td>'+badge(r.disposition_status||'OPEN')+'</td></tr>'; }))+'</section></div>'+
 '<section class="card"><h2>Toutes les réceptions</h2>'+table(['Réception','Camion','Fournisseur / Canal','Provenance','Entrepôt','Prévu','Arrivée','Statut','GRN','Prochaine étape'],a.map(function(r){var g=grnFor(r.id);return'<tr class="ops-click" data-href="#inbound/'+encodeURIComponent(r.id)+'"><td class="mono">'+esc(r.id)+'</td><td>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||r.procurement_channel||'-')+'</td><td>'+esc(r.origin||'-')+'</td><td>'+esc(r.warehouse_code||'-')+'</td><td>'+mt(r.expected_kg||0)+'</td><td>'+dt(r.arrival_at)+'</td><td>'+badge(r.status)+'</td><td class="mono">'+esc(g?g.id:'-')+'</td><td>'+esc(r.next_action||'-')+'</td></tr>';}))+
 (a.length>=(state.recLimit||200)?'<div class="ops-actions" style="margin-top:12px"><button class="btn secondary" data-action-button="more-receptions">Afficher 200 réceptions de plus</button><span class="muted">'+a.length+' affichées (chargement serveur par tranches)</span></div>':'<p class="muted">'+a.length+' réception(s).</p>')+'</section>';
}

function purchaseTypeLabel(v){
 return v==='FIELD_BUYING'?'Achat Bord Champ':v==='LBA'?'Achat LBA':v==='DIRECT'||v==='COOPERATIVE'?'Achat Direct':(v||'-');
}
function receptionSourceRows(type){
 return (state.pendingProcurement||[]).filter(function(x){
   var pt=String(x.purchase_type||'').toUpperCase(),ch=String(x.procurement_channel||'').toUpperCase(),st=String(x.source_type||'').toUpperCase();
   if(type==='FIELD_BUYING')return st==='FIELD_SHIPMENT';
   if(type==='LBA')return st==='LBA_ARRIVAL'||pt==='LBA'||ch==='LBA';
   if(type==='DIRECT')return st==='SUPPLIER_ARRIVAL'&&(['DIRECT','COOPERATIVE'].indexOf(pt)>=0||['DIRECT','COOPERATIVE'].indexOf(ch)>=0);
   return false;
 });
}
function refillReceptionSources(type){
 var form=root&&root.querySelector('form[data-action="reception-create"]');if(!form)return;
 var sel=form.querySelector('[name="procurement_source"]');if(!sel)return;
 var rows=receptionSourceRows(type),old=sel.value;
 sel.innerHTML='<option value="">Sélectionner une référence...</option>'+rows.map(function(x){
   var ref=x.source_ref||x.source_id||'-',partner=x.supplier_name||x.supplier_code||x.origin||'';
   return'<option value="'+esc(x.source_type+'|'+x.source_id)+'">'+esc(ref+' · '+purchaseTypeLabel(x.purchase_type||x.procurement_channel)+' · '+partner+' · '+(x.truck||'camion à compléter'))+'</option>';
 }).join('');
 if([].slice.call(sel.options).some(function(o){return o.value===old;}))sel.value=old;
}
function refillReceptionSuppliers(type){
 var form=root&&root.querySelector('form[data-action="reception-create"]');if(!form)return;
 var sel=form.querySelector('[name="supplier_code"]');if(!sel)return;
 var old=sel.value,rows=(state.suppliers||[]).filter(function(x){
   var isLba=x.categorie==='LBA'||String(x.code||'').indexOf('LBA-')===0;
   return type==='LBA'?isLba:type==='DIRECT'?!isLba:false;
 });
 sel.innerHTML='<option value="">Sélectionner...</option>'+rows.map(function(x){return'<option value="'+esc(x.code)+'">'+esc(x.code+' - '+x.nom)+'</option>';}).join('');
 if(rows.some(function(x){return x.code===old;}))sel.value=old; else sel.value='';
 var disp=form.querySelector('[name="supplier_code_display"]');if(disp)disp.value=sel.value;
}
function refreshReceptionPlanningUI(){
 var form=root&&root.querySelector('form[data-action="reception-create"]');if(!form)return;
 var type=form.querySelector('[name="purchase_type"]').value;
 var planned=form.querySelector('[name="planned"]').value==='true';
 var source=form.querySelector('[name="procurement_source"]');
 var sourceWrap=source&&source.closest('.ops-field');
 var reason=form.querySelector('[name="ad_hoc_reason"]');
 var reasonWrap=reason&&reason.closest('.ops-field');
 var supplier=form.querySelector('[name="supplier_code"]');
 var supplierWrap=supplier&&supplier.closest('.ops-field');
 var supplierDisplay=form.querySelector('[name="supplier_code_display"]');
 var supplierDisplayWrap=supplierDisplay&&supplierDisplay.closest('.ops-field');

 refillReceptionSources(type);
 refillReceptionSuppliers(type);

 if(source){
   source.required=planned||type==='FIELD_BUYING';
   source.disabled=!planned&&type!=='FIELD_BUYING';
 }
 if(sourceWrap)sourceWrap.style.display=(planned||type==='FIELD_BUYING')?'':'none';
 if(reason){reason.required=!planned; if(planned)reason.value='';}
 if(reasonWrap)reasonWrap.style.display=planned?'none':'';
 if(supplier){supplier.required=!planned&&type!=='FIELD_BUYING';supplier.disabled=type==='FIELD_BUYING'||planned;}
 if(supplierWrap)supplierWrap.style.display=type==='FIELD_BUYING'?'none':'';
 if(supplierDisplayWrap)supplierDisplayWrap.style.display=type==='FIELD_BUYING'?'none':'';

 var help=document.getElementById('procurementSourceInfo');
 if(help){
   if(type==='FIELD_BUYING'){
     help.innerHTML='<b>Achat Bord Champ :</b> choisissez l’Evacuation / Field Shipment afin de conserver les lots, achats producteurs et producteurs contributeurs.';
   }else if(planned){
     help.textContent='Sélectionnez l’arrivage prévu dans Procurement. Les informations déjà connues seront préremplies automatiquement.';
   }else{
     help.textContent='Réception non planifiée : choisissez le Fournisseur / LBA et renseignez obligatoirement le motif. La réception sera auditée comme exception de planning.';
   }
 }
}
function inboundNew(){
 var nowLocal=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
 var typeOpts=[['','Sélectionner...'],['FIELD_BUYING','Achat Bord Champ'],['LBA','Achat LBA'],['DIRECT','Achat Direct']];
 root.innerHTML=head('Nouvelle réception','Origine de l’achat → camion → qualité → décision → pesée / déchargement. Les données déjà connues sont préremplies.','<a class="btn secondary" href="#inbound">Retour</a>')+
 '<form class="ops-form-card" data-action="reception-create">'+
 '<h2>1. Origine de l’achat</h2><div class="ops-form-grid" style="margin-top:12px">'+
 select('Type d’achat','purchase_type',typeOpts,'','required')+
 select('Réception planifiée ?','planned',[['true','Oui'],['false','Non']],'true','required')+
 select('Référence d’approvisionnement','procurement_source',[['','Sélectionner une référence...']],'','')+
 field('Motif de la réception non planifiée','ad_hoc_reason','text','','placeholder="Ex. camion arrivé sans planification, changement de camion, livraison urgente..."')+
 '</div><div class="notice info" id="procurementSourceInfo" style="margin-top:12px">Choisissez d’abord le type d’achat.</div>'+
 '<h2 style="margin-top:18px">2. Camion et partenaire</h2><div class="ops-form-grid" style="margin-top:12px">'+
 field('Immatriculation du camion','truck','text','','required')+
 select('Fournisseur / LBA','supplier_code',[['','Sélectionner...']],'','')+
 field('Code fournisseur / LBA','supplier_code_display','text','','readonly aria-readonly="true"')+
 field('Provenance','origin','text','','required')+
 select('Entrepôt','warehouse_id',whOpts(false),'','required')+
 field('Date et heure d’arrivée','arrival_at','datetime-local',nowLocal,'required')+
 '</div>'+
 '<h2 style="margin-top:18px">3. Transport et prévisions</h2><div class="ops-form-grid" style="margin-top:12px">'+
 field('Conducteur','driver','text','','required')+
 field('Transporteur','transporter','text','')+
 field('Poids prévu (kg)','expected_kg','number','','step="0.001" min="0"')+
 field('Nombre de sacs prévu','expected_bags','number','','min="0"')+
 '</div>'+
 '<h2 style="margin-top:18px">4. Documents à l’arrivée</h2><p class="muted">La Référence d’approvisionnement n’est pas un document. Le ticket du pont-bascule ANAGROCI sera renseigné à l’étape Pesée / Déchargement.</p>'+
 '<div class="ops-form-grid" style="margin-top:12px">'+
 select('Fiche de déchargement présente ?','delivery_note_present',[['false','Non'],['true','Oui']],'false','required')+
 field('Numéro de la fiche de déchargement','delivery_note','text','','placeholder="À renseigner si la fiche est présente"')+
 '</div>'+
 '<div class="ops-actions" style="margin-top:14px"><button class="btn primary">Enregistrer la réception</button></div></form>';
 refreshReceptionPlanningUI();
}
function syncReceptionSource(value){
 var form=root&&root.querySelector('form[data-action="reception-create"]');if(!form)return;
 var row=(state.pendingProcurement||[]).filter(function(x){return x.source_type+'|'+x.source_id===value;})[0];
 function set(n,v){var e=form.querySelector('[name="'+n+'"]');if(e&&v!=null)e.value=v;}
 if(row){
   var type=String(row.purchase_type||row.procurement_channel||'').toUpperCase();
   if(type==='COOPERATIVE')type='DIRECT';
   if(row.source_type==='FIELD_SHIPMENT')type='FIELD_BUYING';
   if(row.source_type==='LBA_ARRIVAL')type='LBA';
   set('purchase_type',type);
   set('supplier_code',row.supplier_code||'');
   set('supplier_code_display',row.supplier_code||'');
   set('origin',row.origin||'');
   set('warehouse_id',row.warehouse_id||'');
   set('truck',row.truck||'');
   set('driver',row.driver||'');
   set('transporter',row.transporter||'');
   set('expected_kg',row.expected_kg==null?'':row.expected_kg);
   set('expected_bags',row.expected_bags==null?'':row.expected_bags);
   set('planned','true');
   set('ad_hoc_reason','');
   var info=document.getElementById('procurementSourceInfo');
   if(info)info.innerHTML='<b>'+esc(row.source_ref||row.source_id)+'</b> · '+esc(purchaseTypeLabel(type))+' · '+esc(row.supplier_name||row.supplier_code||row.origin||'')+' · la généalogie Procurement sera liée à cette réception.';
 }else{
   var sup=form.querySelector('[name="supplier_code"]'),disp=form.querySelector('[name="supplier_code_display"]');
   if(disp)disp.value=sup?sup.value:'';
 }
 refreshReceptionPlanningUI();
}
function timelineRec(r){
 var arr=[['Arrivée',r.arrival_at,r.created_by_name],['Échantillonnage',r.sampling_at,'Qualité'],['Décision',r.decided_at,r.decided_by_name],['Déchargement',r.offloaded_at,'Warehouse'],['Qualité finale',r.final_at,'Qualité']].filter(function(x){return x[1];});
 return'<div class="ops-timeline">'+arr.map(function(x){return'<div class="ops-timeline-item"><time>'+dt(x[1])+'</time><div><b>'+esc(x[0])+'</b><small>'+esc(x[2]||'-')+'</small></div></div>';}).join('')+'</div>';
}
function offloadForm(r){
 if(r.status!=='ACCEPTED_WAITING_OFFLOAD'||!can('offload'))return'';
 return'<form class="card" id="offload-section" data-action="offload" data-id="'+esc(r.id)+'"><h2>Pesée / Déchargement</h2><div class="ops-form-grid" style="margin-top:12px">'+
 field('Poids brut (kg)','gross_kg','number','','required step="0.001" min="0.001"')+
 field('Tare (kg)','tare_kg','number','','required step="0.001" min="0"')+
 field('Poids net = Brut − Tare','net_kg','number','','readonly aria-readonly="true" step="0.001"')+
 field('Nombre total de sacs','bags','number','','min="0"')+
 field('Sacs conformes','bags_good','number','','min="0"')+
 field('Sacs humides','bags_wet','number','','min="0"')+
 field('Sacs déchirés','bags_torn','number','','min="0"')+
 field('Sacs reconditionnés','bags_recond','number','','min="0"')+
 field('Ticket pont-bascule ANAGROCI','weighbridge_ticket','text',r.weighbridge_ticket||'')+
 field('Fiche de déchargement','delivery_note','text',r.delivery_note||'')+
 field('Bon / reçu Warehouse','warehouse_receipt','text','')+
 field('Début déchargement','offload_start','datetime-local','')+
 field('Fin déchargement','offload_end','datetime-local','')+
 '</div>'+notice('info','<b>À l’enregistrement :</b>&nbsp;un LOT est créé immédiatement en <b>quarantaine</b> et la marchandise entre au stock (staging). Les sacs pleins sont enregistrés automatiquement en sacherie. Le total des sacs doit être égal au détail bons + humides + déchirés + reconditionnés.')+'<div class="ops-actions" style="margin-top:12px"><button class="btn primary">Enregistrer la pesée et le déchargement</button></div></form>';
}
function fileField(label,name,accept){var i=id(name);return'<div class="ops-field"><label for="'+i+'">'+esc(label)+'</label><input id="'+i+'" name="'+esc(name)+'" type="file" accept="'+esc(accept||'')+'"></div>';}
function docStatusBadge(v){var m={COMPLET:'DOCUMENTS COMPLETS',INCOMPLET:'DOCUMENTS INCOMPLETS',REJETE:'DOCUMENTS REJETÉS',DEROGATION_BM:'DÉROGATION BM'};return badge(m[v]||v||'-');}
function docStatusLabel(v){return v==='NON_SAISI'?'NON SAISI':v==='PRESENT'?'PRÉSENT':v==='ABSENT'?'ABSENT':v==='NON_CONFORME'?'NON CONFORME':(v||'-');}
function documentsSection(r,ds,dsErr){
 if(!ds)return'<section class="card" id="documents-section"><h2>Documents CCA</h2>'+notice('danger','Statut documentaire indisponible'+(dsErr?' : '+esc(dsErr):'')+'.')+'</section>';
 var docs=ds.documents||[],preDecision=['ARRIVED','AWAITING_DECISION'].indexOf(r.status)>=0;
 var rows=docs.map(function(d){return'<tr><td>'+esc(d.label)+(d.mandatory?' <b>· obligatoire</b>':'')+'</td><td>'+badge(docStatusLabel(d.status))+'</td><td>'+esc(d.reference||'-')+'</td><td>'+(d.file_path?'<button type="button" class="btn secondary" data-action-button="open-doc" data-path="'+esc(d.file_path)+'">Voir la pièce</button>':'-')+'</td><td>'+esc(d.recorded_by||'-')+'</td><td>'+dt(d.recorded_at)+'</td></tr>';});
 var form=can('document_record')&&['REJECTED','CLOSED'].indexOf(r.status)<0?'<form class="card" data-action="doc-record" data-id="'+esc(r.id)+'"><h3>Saisir ou mettre à jour un document</h3><div class="ops-form-grid">'+
   select('Document','doc_type',docs.map(function(d){return[d.code,d.label];}),'','required')+
   select('Statut','status',[['PRESENT','Présent'],['ABSENT','Absent'],['NON_CONFORME','Non conforme']],'PRESENT','required')+
   field('Référence du document','reference','text','')+
   fileField('Pièce jointe (PDF ou image, 10 Mo max)','doc_file','application/pdf,image/jpeg,image/png,image/webp')+
   field('Motif / note (obligatoire si non conforme)','note','text','')+
   '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Enregistrer le document</button></div></form>':'';
 var derog=(can('document_derogation')&&['ARRIVED','AWAITING_DECISION'].indexOf(r.status)>=0&&['INCOMPLET','REJETE'].indexOf(ds.doc_status)>=0)?'<form class="card" data-action="doc-derogation" data-id="'+esc(r.id)+'"><h3>Dérogation documentaire (Branch Manager)</h3><p class="muted">Autorise l’acceptation malgré des documents manquants ou non conformes. Tracée avec l’auteur, la date et le motif.</p><div class="ops-form-grid">'+field('Motif de la dérogation','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn signal">Accorder la dérogation</button></div></form>':'';
 return'<section class="card" id="documents-section"><div class="card-head"><div><h2>Documents CCA</h2><p>Checklist du canal '+esc(ds.procurement_channel||'non renseigné')+'. Un document obligatoire manquant ou non conforme bloque l’acceptation du camion (sauf dérogation BM).</p></div>'+docStatusBadge(ds.doc_status)+'</div>'+
  (ds.matrix_validated?'':notice('warn','<b>Liste des documents obligatoires à valider.</b>&nbsp;Tant que le Branch Manager n’a pas validé la matrice par canal (Paramètres), aucun document n’est exigé pour la décision.'))+
  ((ds.missing_mandatory||[]).length?notice(preDecision?'danger':'warn','<b>Obligatoires manquants :</b>&nbsp;'+esc((ds.missing_mandatory||[]).join(', '))):'')+
  ((ds.non_conforming_mandatory||[]).length?notice(preDecision?'danger':'warn','<b>Obligatoires non conformes :</b>&nbsp;'+esc((ds.non_conforming_mandatory||[]).join(', '))):'')+
  (ds.doc_derogation_at?notice('warn','<b>Dérogation BM</b> · '+esc(ds.doc_derogation_by_name||'-')+' · '+dt(ds.doc_derogation_at)+' · '+esc(ds.doc_derogation_reason||'')):'')+
  '<div class="ops-def-grid"><div><small>Fiche de déchargement présente</small><b>'+((r.delivery_note_present||r.delivery_note)?'OUI':'NON')+'</b></div><div><small>N° fiche de déchargement</small><b>'+esc(r.delivery_note||'-')+'</b></div><div><small>Ticket pont-bascule ANAGROCI</small><b>'+esc(r.weighbridge_ticket||'-')+'</b></div></div>'+
  table(['Document','Statut','Référence','Pièce','Saisi par','Date'],rows)+'</section>'+form+derog;
}
function grnSection(r){
 var g=grnFor(r.id);
 if(g)return'<section class="card" id="grn-section"><div class="card-head"><div><h2>GRN officiel</h2><p>Bon de réception émis le '+dt(g.issued_at)+' par '+esc(g.issued_by_name||'-')+'.</p></div>'+badge(g.status==='EMIS'?'GRN ÉMIS':g.status)+'</div><div class="ops-def-grid"><div><small>Numéro</small><b class="mono">'+esc(g.id)+'</b></div><div><small>LOT</small><b class="mono">'+esc(g.lot_id||'-')+'</b></div></div><div class="ops-actions" style="margin-top:12px"><a class="btn primary" href="#grn/'+encodeURIComponent(r.id)+'">Voir / imprimer le GRN</a></div></section>';
 if(!r.offloaded_at)return'<section class="card" id="grn-section"><h2>GRN officiel</h2>'+notice('info','Le GRN est émis après la pesée et le déchargement.')+'</section>';
 return'<section class="card" id="grn-section"><h2>GRN officiel</h2><p class="muted">Numérotation par entrepôt et par année (ex. GRN-BKE002-2026-0001). Émission unique : un nouvel appel renvoie le même numéro.</p><div class="ops-actions">'+(can('grn_generate')?'<button class="btn primary" data-action-button="generate-grn" data-id="'+esc(r.id)+'">Générer le GRN</button>':'<span class="muted">Émission non disponible pour votre rôle.</span>')+'</div></section>';
}
function lotStatusSection(r){
 if(!r.lot_id)return'';
 var l=lotById(r.lot_id);
 return'<section class="card"><div class="card-head"><div><h2>LOT Warehouse</h2><p>Le LOT est créé au déchargement : la marchandise est en stock quel que soit le résultat qualité.</p></div>'+businessBadge(l?l.status:'-')+'</div><div class="ops-def-grid"><div><small>LOT</small><b class="mono"><a href="#lots/'+encodeURIComponent(r.lot_id)+'">'+esc(r.lot_id)+'</a></b></div><div><small>Stock actuel</small><b>'+(l?kg(l.current_kg):'-')+'</b></div><div><small>Staging</small><b>'+(l?kg(l.staging_kg):'-')+'</b></div><div><small>BIN</small><b>'+(l?kg(l.bin_kg):'-')+'</b></div></div>'+
  (l&&['QUARANTINE','HOLD','REQUIRES_DECISION','REJECTED'].indexOf(l.status)>=0?notice('warn','Achat RCN bloqué : la soumission et l’approbation exigent un LOT libéré (qualité conforme ou dérogation tracée).'):'')+'</section>';
}
async function inboundDetail(r){
 var dsErr=null,ds=await loadDocStatus(r.id).catch(function(e){dsErr=e.message;return null;});
 var corrMap={truck:r.truck||'',supplier_code:r.supplier_code||'',origin:r.origin||'',expected_kg:r.expected_kg==null?'':r.expected_kg,expected_bags:r.expected_bags==null?'':r.expected_bags,driver:r.driver||'',transporter:r.transporter||'',weighbridge_ticket:r.weighbridge_ticket||'',delivery_note:r.delivery_note||''};
 var corr=can('correction')?'<form class="card" data-action="reception-correct" data-id="'+esc(r.id)+'" data-current="'+esc(JSON.stringify(corrMap))+'"><h2>Correction contrôlée</h2><p class="muted">Avant → Après est journalisé. Aucun champ stock n’est modifiable ici.</p><div class="ops-form-grid">'+
 select('Champ','field',[['truck','Immatriculation'],['supplier_code','Code fournisseur / LBA'],['origin','Provenance'],['expected_kg','Poids prévu'],['expected_bags','Sacs prévus'],['driver','Conducteur'],['transporter','Transporteur'],['weighbridge_ticket','Ticket pont-bascule'],['delivery_note','Fiche de déchargement']],'','required')+
 field('Valeur actuelle','current_value','text','','readonly aria-readonly="true"')+field('Nouvelle valeur','new_value','text','','required')+field('Motif','reason','text','','required')+field('Approbateur','approver','text','','required')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn secondary">Appliquer la correction contrôlée</button></div></form>':'';
 var rej=(state.rejectedTrucks||[]).filter(function(x){return x.reception_id===r.id;})[0];
 var rejInfo=r.status==='REJECTED'?'<section class="card"><div class="card-head"><div><h2>Camion refusé</h2><p>Le refus crée un dossier de refoulement suivi dans Procurement (liste des refoulés).</p></div>'+badge('REJETÉ')+'</div><div class="ops-def-grid"><div><small>Motif</small><b>'+esc((rej&&rej.rejection_reason)||r.decision_comment||'-')+'</b></div><div><small>Décidé par</small><b>'+esc(r.decided_by_name||'-')+'</b></div><div><small>Date</small><b>'+dt(r.decided_at)+'</b></div><div><small>Dossier de refus</small><b>'+badge((rej&&rej.disposition_status)||'OPEN')+'</b></div></div></section>':'';
 var rejection=(r.status==='REJECTED'&&rej&&rej.disposition_status!=='RESOLVED')?'<form class="card" data-action="resolve-rejection" data-id="'+esc(r.id)+'"><h2>Traitement du camion refoulé</h2><p class="muted">Le refoulement ne ferme pas le dossier. Indiquez la destination ou la décision réelle prise pour le camion.</p><div class="ops-form-grid">'+field('Disposition / Action','resolution_action','text','','required placeholder="Retour à la source / réorientation / décision négociée..."')+field('Motif','resolution_reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn signal">Clôturer le traitement du refoulement</button></div></form>':(rej&&rej.disposition_status==='RESOLVED'?'<section class="card"><h2>Traitement du camion refoulé</h2><div class="ops-def-grid"><div><small>Action</small><b>'+esc(rej.resolution_action||'-')+'</b></div><div><small>Motif</small><b>'+esc(rej.resolution_reason||'-')+'</b></div><div><small>Résolu par</small><b>'+esc(rej.resolved_by_name||'-')+'</b></div><div><small>Date</small><b>'+dt(rej.resolved_at)+'</b></div></div></section>':'');
 var settlement='<section class="card"><h2>Règlement commercial</h2><p class="muted">Warehouse est la vérité physique. Réfaction, prix, approbation et paiement sont gérés uniquement dans Procurement > Achat RCN.</p><div class="ops-def-grid"><div><small>Statut commercial</small><b>'+esc(r.procurement_settlement_status||'-')+'</b></div><div><small>Poids payé</small><b>'+(r.paid_weight_kg==null?'-':kg(r.paid_weight_kg))+'</b></div><div><small>Réfaction</small><b>'+(r.refraction_kg==null?'-':kg(r.refraction_kg))+'</b></div></div><div class="ops-actions" style="margin-top:12px"><a class="btn secondary" href="procurement.html#purchases">Ouvrir Achat RCN</a></div></section>';
 root.innerHTML=head(r.id,r.truck+' · '+(r.supplier_name||'-'),'<a class="btn secondary" href="#inbound">Retour</a><a class="btn secondary" href="#quality/'+encodeURIComponent(r.id)+'">Ouvrir Qualité</a>')+
 '<div class="ops-def-grid"><div><small>Statut</small><b>'+badge(r.status)+'</b></div><div><small>Entrepôt</small><b>'+esc(r.warehouse_code||'-')+'</b></div><div><small>Fournisseur / LBA</small><b>'+esc((r.supplier_code||'-')+' · '+(r.supplier_name||'-'))+'</b></div><div><small>Provenance</small><b>'+esc(r.origin||'-')+'</b></div><div><small>Poids prévu</small><b>'+kg(r.expected_kg||0)+'</b></div><div><small>Poids net</small><b>'+(r.net_kg==null?'-':kg(r.net_kg))+'</b></div><div><small>Lot</small><b>'+esc(r.lot_id||'-')+'</b></div><div><small>Prochaine action</small><b>'+esc(r.next_action||'-')+'</b></div></div>'+
 rejInfo+workflowStepper(r)+nextActionCard(r)+lotStatusSection(r)+grnSection(r)+
 '<section class="card"><h2>Transport et prévisions</h2><div class="ops-def-grid"><div><small>Type d’achat</small><b>'+esc(purchaseTypeLabel(r.purchase_type))+'</b></div><div><small>Conducteur</small><b>'+esc(r.driver||'-')+'</b></div><div><small>Transporteur</small><b>'+esc(r.transporter||'-')+'</b></div><div><small>Poids prévu</small><b>'+kg(r.expected_kg||0)+'</b></div><div><small>Sacs prévus</small><b>'+esc(r.expected_bags==null?'-':r.expected_bags)+'</b></div><div><small>Réception planifiée</small><b>'+(r.ad_hoc?'NON':'OUI')+'</b></div></div></section>'+
 documentsSection(r,ds,dsErr)+
 '<section class="card"><h2>Lien d’approvisionnement</h2><div class="ops-def-grid"><div><small>Canal</small><b>'+esc(r.procurement_channel||'-')+'</b></div><div><small>Type de source</small><b>'+esc(r.procurement_source_type||'-')+'</b></div><div><small>Référence d’approvisionnement</small><b>'+esc(r.procurement_source_id||'-')+'</b></div><div><small>Poids payé</small><b>'+(r.paid_weight_kg==null?'-':kg(r.paid_weight_kg))+'</b></div><div><small>Réfaction</small><b>'+(r.refraction_kg==null?'-':kg(r.refraction_kg))+'</b></div><div><small>Statut commercial</small><b>'+esc(r.procurement_settlement_status||'-')+'</b></div></div></section>'+
 '<section class="card"><h2>Historique de la réception</h2>'+timelineRec(r)+'</section>'+offloadForm(r)+settlement+rejection+corr;
}

function qualityList(){
 var a=state.receptions.filter(function(r){return['ARRIVED','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD','AWAITING_FINAL_QA','QUALITY_HOLD','RELEASED'].indexOf(r.status)>=0;});
 var rows=a.map(function(r){
   var nx=nextActionForReception(r);
   return'<tr class="ops-click" data-href="#quality/'+encodeURIComponent(r.id)+'"><td><span class="mono">'+esc(r.id)+'</span><br>'+esc(r.truck)+'</td><td>'+esc(r.supplier_name||'-')+'</td><td>'+esc(r.sampling_kor==null?'-':r.sampling_kor)+'</td><td>'+esc(r.sampling_moisture==null?'-':r.sampling_moisture+' %')+'</td><td>'+esc(r.decision||'-')+'</td><td>'+esc(r.final_kor==null?'-':r.final_kor)+'</td><td>'+esc(r.kor_delta==null?'-':r.kor_delta)+'</td><td class="mono">'+esc(r.lot_id||'-')+'</td><td>'+businessBadge(r.status)+'</td><td><b>'+esc(nx.label||'-')+'</b></td></tr>';
 });
 root.innerHTML=head('Qualité','File de travail guidée : échantillonnage, décision, pesée/déchargement, qualité finale et libération du LOT.')+
 '<div class="kpi-grid">'+kpi('Échantillonnage en attente',a.filter(function(r){return!r.sampling_id&&r.status==='ARRIVED';}).length,'#quality','')+
 kpi('Décision en attente',a.filter(function(r){return r.status==='AWAITING_DECISION';}).length,'#quality','attn')+
 kpi('Pesée / Déchargement en attente',a.filter(function(r){return r.status==='ACCEPTED_WAITING_OFFLOAD';}).length,'#quality','attn')+
 kpi('Qualité finale en attente',a.filter(function(r){return r.status==='AWAITING_FINAL_QA'&&!r.final_id;}).length,'#quality','attn')+
 kpi('Blocage qualité',a.filter(function(r){return r.status==='QUALITY_HOLD';}).length,'#quality','danger')+
 '</div><section class="card">'+table(['Réception / Camion','Fournisseur','KOR échantillonnage','Humidité','Décision','KOR final','Écart','LOT','Statut','Prochaine action'],rows)+'</section>';
}
function qForm(r,type){
 var allowed=type==='SAMPLING'?can('sampling')&&['ARRIVED','AWAITING_DECISION'].indexOf(r.status)>=0:can('final_qa')&&['AWAITING_FINAL_QA','QUALITY_HOLD'].indexOf(r.status)>=0&&!!r.offloaded_at;
 if(!allowed)return'';
 var prev=qualityFor(r.id,type);
 return'<form class="card" id="quality-'+type.toLowerCase()+'-section" data-action="quality" data-id="'+esc(r.id)+'" data-type="'+type+'"><h2>'+(type==='SAMPLING'?'Échantillonnage':'Qualité finale')+'</h2><div class="ops-form-grid" style="margin-top:12px">'+
 field('Bonnes amandes (g)','gk_g','number','','required step="0.001" min="0"')+field('Immatûres (g)','imm_g','number','','required step="0.001" min="0"')+field('Tachetées (g)','spotted_g','number','','required step="0.001" min="0"')+
 field('Humidité (%)','moisture_pct','number','','step="0.01" min="0"')+field('Nombre de noix','nut_count','number','','min="0"')+textarea('Note','note','')+
 (prev?field('Motif de la nouvelle mesure (obligatoire, l’ancienne est conservée)','reason','text','','required'):'')+
 '</div>'+(prev&&type==='FINAL'&&r.status==='QUALITY_HOLD'?notice('warn','Une nouvelle qualité finale conforme <b>ne lève pas</b> le blocage : la levée se fait par une autre personne que l’analyste, ou par dérogation / rejet tracés.'):'')+'<div class="ops-actions" style="margin-top:12px"><button class="btn primary">Enregistrer '+(type==='SAMPLING'?'l’échantillonnage':'la qualité finale')+'</button></div></form>';
}
function decisionPanel(r,ds){
 if(r.status!=='AWAITING_DECISION'||!can('decision'))return'';
 var reasons=state.rejectionReasons||[];
 var blocked=!!(ds&&['INCOMPLET','REJETE'].indexOf(ds.doc_status)>=0);
 return'<section class="card" id="decision-section"><h2>Décision d’arrivée</h2>'+
  (blocked?notice('danger','<b>Acceptation bloquée :</b>&nbsp;documents obligatoires manquants ou non conformes. Complétez la checklist dans le dossier de réception ou obtenez une dérogation BM. Le refus reste possible.'):'')+
  (reasons.length?'':notice('danger','Catalogue des motifs de refus indisponible : le refus ne peut pas être saisi.'))+
  '<div class="ops-form-grid" style="margin-top:12px">'+
  select('Motif de refus (obligatoire pour refouler)','rejection_reason_code',[['','Sélectionner un motif...']].concat(reasons.map(function(x){return[x.code,x.label+(x.requires_comment?' · commentaire obligatoire':'')];})),'')+
  field('Commentaire','decision_comment','text','','placeholder="Obligatoire pour « Autre » et les motifs marqués"')+
  '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary" data-action-button="accept" data-id="'+esc(r.id)+'"'+(blocked?' disabled title="Documents obligatoires incomplets"':'')+'>Accepter pour déchargement</button><button class="btn signal" data-action-button="reject" data-id="'+esc(r.id)+'">Refouler le camion</button></div></section>';
}
function holdDecisionPanel(r,l){
 if(!l||['HOLD','REQUIRES_DECISION','QUARANTINE'].indexOf(l.status)<0)return'';
 var canDer=can('quality_derogation')&&l.status!=='QUARANTINE',canRej=can('lot_reject'),canEsc=can('quality_hold')&&['QUARANTINE','HOLD'].indexOf(l.status)>=0;
 if(!canDer&&!canRej&&!canEsc)return'';
 if(l.status==='QUARANTINE'&&!canRej&&!canEsc)return'';
 var opts=[['','Sélectionner...']];
 if(canDer)opts.push(['DEROGATION_RELEASE','Dérogation : libérer le LOT (motif tracé)']);
 if(canRej)opts.push(['REJECT','Rejeter le LOT (retour fournisseur)']);
 if(canEsc)opts.push(['ESCALATE','Escalader au Branch Manager']);
 return'<form class="card" id="hold-decision-section" data-action="lot-hold-decision" data-lot="'+esc(l.id)+'"><h2>Décision sur le LOT '+esc(l.id)+'</h2><p class="muted">Statut : '+esc(statusLabelFr(l.status))+(l.hold_reason?' · '+esc(l.hold_reason):'')+'</p>'+
  notice('warn','Le LOT reste en stock et apparaît dans la clôture, mais il ne peut ni entrer dans un BIN normal, ni être transféré, séché ou vendu tant qu’il n’est pas libéré. L’auteur de la qualité finale ne peut pas accorder la dérogation.')+
  '<div class="ops-form-grid">'+select('Décision','decision',opts,'','required')+
  select('Motif de rejet (si rejet)','reason_code',[['','—']].concat((state.rejectionReasons||[]).map(function(x){return[x.code,x.label];})),'')+
  field('Motif / justification (obligatoire)','reason','text','','required')+
  '</div><div class="ops-actions" style="margin-top:12px"><button class="btn signal">Enregistrer la décision</button></div></form>';
}
async function qualityDetail(r){
 var s=qualityFor(r.id,'SAMPLING'),f=qualityFor(r.id,'FINAL'),lq=r.lot_id?lotById(r.lot_id):null;
 var ds=r.status==='AWAITING_DECISION'?await loadDocStatus(r.id).catch(function(e){state.loadErrors.push('Documents : '+e.message);return null;}):null;
 var finalBlock='';
 if(!r.offloaded_at){
   finalBlock='<section class="card"><h2>Qualité finale</h2>'+notice('info','🔒 <b>Étape non encore disponible.</b><br>La qualité finale sera disponible après la pesée et le déchargement du camion.')+'</section>';
 }else{
   finalBlock='<section class="card"><h2>Qualité finale</h2><div class="ops-def-grid"><div><small>GK</small><b>'+esc(f?f.gk_g:'-')+'</b></div><div><small>IMM</small><b>'+esc(f?f.imm_g:'-')+'</b></div><div><small>SP</small><b>'+esc(f?f.spotted_g:'-')+'</b></div><div><small>KOR</small><b>'+esc(f?f.kor_display:'-')+'</b></div><div><small>Écart</small><b>'+esc(f?f.delta_vs_sampling:'-')+'</b></div><div><small>Dans la tolérance</small><b>'+esc(f?(f.within_tolerance?'Oui':'Non'):'-')+'</b></div></div></section>';
 }
 var sample='<section class="card"><h2>Échantillonnage</h2><div class="ops-def-grid"><div><small>GK</small><b>'+esc(s?s.gk_g:'-')+'</b></div><div><small>IMM</small><b>'+esc(s?s.imm_g:'-')+'</b></div><div><small>SP</small><b>'+esc(s?s.spotted_g:'-')+'</b></div><div><small>KOR</small><b>'+esc(s?s.kor_display:'-')+'</b></div><div><small>Facteur</small><b>'+esc(s?s.kor_factor:'-')+'</b></div><div><small>Humidité</small><b>'+esc(s?s.moisture_pct:'-')+'</b></div></div></section>';
 var rel=(r.status==='AWAITING_FINAL_QA'&&r.final_id&&can('lot_release'))?'<section class="card" id="lot-release-section"><h2>Libération du LOT</h2><p>'+(r.lot_id?'La qualité finale est conforme. Libérez le LOT '+esc(r.lot_id)+' (quarantaine levée) pour autoriser son affectation en BIN et le circuit d’achat.':'La qualité finale est terminée. Créez maintenant le LOT officiel.')+'</p><div class="ops-actions"><button class="btn primary" data-action-button="release-lot" data-id="'+esc(r.id)+'">'+(r.lot_id?'Libérer le LOT':'Créer et libérer le LOT')+'</button></div></section>':'';
 var hold=can('quality_hold')?'<section class="card"><h2>Blocage qualité</h2><div class="ops-form-grid">'+field('Motif','hold_reason','text','')+'</div><div class="ops-actions">'+(r.status==='QUALITY_HOLD'?'<button class="btn primary" data-action-button="unhold" data-id="'+esc(r.id)+'">Lever le blocage qualité</button>':'<button class="btn secondary" data-action-button="hold" data-id="'+esc(r.id)+'">Mettre en blocage qualité</button>')+'</div></section>':'';
 root.innerHTML=head('Qualité · '+r.id,r.truck+' · '+(r.supplier_name||'-'),'<a class="btn secondary" href="#quality">Retour</a><a class="btn secondary" href="#inbound/'+encodeURIComponent(r.id)+'">Dossier de réception</a>')+
 workflowStepper(r)+nextActionCard(r)+'<div class="grid-2">'+sample+finalBlock+'</div>'+qForm(r,'SAMPLING')+decisionPanel(r,ds)+qForm(r,'FINAL')+rel+holdDecisionPanel(r,lq)+hold;
}

function lotsList(){
 var content=state.lots.length?table(['LOT','Réception','Fournisseur','Provenance','Initial','Actuel','Staging','BIN','Séchage','Nb BIN','Statut'],state.lots.map(function(l){return'<tr class="ops-click" data-href="#lots/'+encodeURIComponent(l.id)+'"><td class="mono">'+esc(l.id)+'</td><td class="mono">'+esc(l.reception_id)+'</td><td>'+esc(l.supplier_name||'-')+'</td><td>'+esc(l.origin||'-')+'</td><td>'+kg(l.initial_kg)+'</td><td>'+kg(l.current_kg)+'</td><td>'+kg(l.staging_kg)+'</td><td>'+kg(l.bin_kg)+'</td><td>'+kg(l.drying_kg)+'</td><td>'+esc(l.bin_count||0)+'</td><td>'+businessBadge(l.status)+'</td></tr>';})):contextualLotsEmpty();
 root.innerHTML=head('Lots RCN','Passeport matière et généalogie. Le LOT est créé au déchargement (quarantaine) et libéré après qualité finale conforme ou dérogation tracée.')+'<section class="card">'+content+'</section>';
}
var MOV_LABELS={OFFLOAD:'Déchargement',BIN_TRANSFER:'Transfert BIN',DRYING_ISSUE:'Sortie séchage',DRYING_RECEIPT:'Retour séchage',SORTING:'Triage',TRANSFER_OUT:'Transfert sortant',TRANSFER_IN:'Transfert entrant',PRODUCTION_ISSUE:'Sortie production',ADJUSTMENT:'Ajustement inventaire',RETURN_TO_SUPPLIER:'Retour fournisseur'};
function movLabel(t){return MOV_LABELS[t]||t||'-';}
function locLabel(t,i){if(!t)return'-';if(t==='STAGING'){var w=whById(i);return'Staging '+(w?w.code:'');}if(t==='TRUCK')return'Camion · '+(i||'');if(t==='BIN')return'BIN '+(i||'');if(t==='SUPPLIER')return'Fournisseur '+(i||'');if(t==='TRANSIT')return'Transit '+(i||'');if(t==='DRYING')return'Séchage '+(i||'');return t+' '+(i||'');}
function movRef(m){return m.reference_type?(m.reference_type+' · '+(m.reference_id||'')):(m.reason||'-');}
async function lotDetail(l){
 var errs=[];
 function soft(label){return function(e){errs.push(label+' : '+(e&&e.message?e.message:e));return[];};}
 var res=await Promise.all([
   q('wms_v_bin_contributors','*',function(x){return x.eq('lot_id',l.id).gt('remaining_kg',0);}).catch(soft('Positions BIN')),
   q('wms_v_movement_lines','*',function(x){return x.eq('lot_id',l.id).order('posted_at',{ascending:false}).limit(200);}).catch(soft('Historique des mouvements')),
   q('wms_v_post_dry_quality_current','*',function(x){return x.eq('lot_id',l.id).order('created_at',{ascending:false}).limit(50);}).catch(soft('Qualité après séchage')),
   l.derogation_id?q('wms_quality_derogations','*',function(x){return x.eq('id',l.derogation_id).limit(1);}).catch(soft('Dérogation')):Promise.resolve([]),
   q('rcn_jute_movements','id,movement_type,ledger,qty,from_location,to_location,to_state,bag_condition,movement_at,reference',function(x){return x.eq('lot_id',l.id).order('movement_at',{ascending:false}).limit(50);}).catch(soft('Sacs liés'))
 ]);
 var contrib=res[0],mov=res[1],post=res[2],drg=res[3][0],bags=res[4];
 var released=['RELEASED','EXHAUSTED'].indexOf(l.status)>=0;
 var eligible=state.bins.filter(function(b){return String(b.warehouse_id)===String(l.warehouse_id)&&b.stock_type!=='HOLD'&&['CLOSED','BLOCKED'].indexOf(b.status)<0;});
 var holdBins=state.bins.filter(function(b){return String(b.warehouse_id)===String(l.warehouse_id)&&b.stock_type==='HOLD'&&['CLOSED','BLOCKED'].indexOf(b.status)<0;});
 var allocation='';
 if(Number(l.staging_kg||0)>0&&released&&can('bin_ops')){
   if(eligible.length){
     allocation='<form class="card" id="lot-allocation-section" data-action="allocate-lot" data-lot="'+esc(l.id)+'"><h2>Affecter le LOT à un BIN</h2><p class="muted">Stock en staging : '+kg(l.staging_kg)+'. Choisissez directement l’emplacement de stockage.</p><div class="ops-form-grid">'+
       select('BIN de destination','bin_id',[['','Sélectionner...']].concat(eligible.map(function(b){var free=b.capacity_kg==null?'∞':kg(Math.max(0,Number(b.capacity_kg)-Number(b.balance_kg||0)));return[b.id,b.id+' · '+b.stock_type+' · disponible '+free];})),'','required')+
       field('Quantité à affecter (kg)','qty','number',l.staging_kg,'required step="0.001" min="0.001" max="'+esc(l.staging_kg)+'"')+
       '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Affecter ce LOT au BIN</button></div></form>';
   }else{
     allocation='<section class="card" id="lot-allocation-section"><h2>Affectation BIN</h2>'+notice('warn','<b>Aucun BIN disponible dans cet entrepôt.</b><br>Un BIN est nécessaire avant de pouvoir stocker ce LOT.')+
       '<div class="ops-actions"><button class="btn primary" data-action-button="create-bin-for-lot" data-id="'+esc(l.id)+'" data-wh="'+esc(l.warehouse_id)+'">Créer un BIN puis affecter ce LOT</button></div></section>';
   }
 }else if(!released&&l.status!=='CLOSED'){
   allocation=notice('warn','<b>'+esc(statusLabelFr(l.status))+'.</b>&nbsp;Ce LOT est compté en stock mais bloqué : affectation en BIN normal, séchage, transfert et vente sont interdits jusqu’à sa libération.'+(l.hold_reason?' Motif : '+esc(l.hold_reason):''));
   if(Number(l.staging_kg||0)>0&&can('hold_bin_place')){
     allocation+=holdBins.length?'<form class="card" id="lot-hold-bin-section" data-action="hold-bin-place" data-lot="'+esc(l.id)+'"><h2>Isoler le LOT en BIN HOLD</h2><div class="ops-form-grid">'+select('BIN HOLD','bin_id',[['','Sélectionner...']].concat(holdBins.map(function(b){return[b.id,b.id+' · stock '+kg(b.balance_kg)];})),'','required')+field('Quantité (kg)','qty','number',l.staging_kg,'required step="0.001" min="0.001" max="'+esc(l.staging_kg)+'"')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Placer en BIN HOLD</button></div></form>':'<section class="card"><h2>BIN HOLD</h2>'+notice('info','Aucun BIN de type Bloqué (HOLD) ouvert dans cet entrepôt. Créez-en un dans Stock & BIN pour isoler physiquement ce LOT.')+'</section>';
   }
   if(l.status==='REJECTED'&&Number(l.current_kg||0)>0.0005&&can('lot_return')){
     allocation+='<form class="card" id="lot-return-section" data-action="lot-return" data-lot="'+esc(l.id)+'"><h2>Sortie du LOT rejeté (retour fournisseur)</h2><div class="ops-form-grid">'+select('Source','source_bin',[['','Staging · '+kg(l.staging_kg)]].concat(contrib.map(function(c){return[c.bin_id,'BIN '+c.bin_id+' · '+kg(c.remaining_kg)];})),'')+field('Quantité (kg)','qty','number',Number(l.staging_kg||0)>0?l.staging_kg:'','required step="0.001" min="0.001"')+field('N° bon de sortie / reprise','reference','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn signal">Enregistrer la sortie</button></div></form>';
   }
 }
 var transferBtn=released&&Number(l.bin_kg||0)>0?'<button class="btn primary" data-action-button="prepare-transfer-lot" data-id="'+esc(l.id)+'">Préparer le transfert</button>':'';
 root.innerHTML=head(l.id,'Passeport matière · '+(l.supplier_name||'-'),'<a class="btn secondary" href="#lots">Retour</a><button class="btn secondary" data-action-button="lot-journal" data-id="'+esc(l.id)+'">Journal du LOT</button>'+transferBtn)+
 (errs.length?notice('danger','<b>Données partielles :</b><br>'+errs.map(esc).join('<br>')):'')+
 '<section class="card"><div class="ops-def-grid"><div><small>Réception</small><b><a href="#inbound/'+encodeURIComponent(l.reception_id)+'">'+esc(l.reception_id)+'</a></b></div><div><small>Entrepôt</small><b>'+esc(l.warehouse_code||'-')+'</b></div><div><small>Camion</small><b>'+esc(l.truck||'-')+'</b></div><div><small>Fournisseur</small><b>'+esc(l.supplier_name||'-')+'</b></div><div><small>Provenance</small><b>'+esc(l.origin||'-')+'</b></div><div><small>Poids initial</small><b>'+kg(l.initial_kg)+'</b></div><div><small>Stock actuel</small><b>'+kg(l.current_kg)+'</b></div><div><small>Staging</small><b>'+kg(l.staging_kg)+'</b></div><div><small>Stock BIN</small><b>'+kg(l.bin_kg)+'</b></div><div><small>KOR échantillonnage / final</small><b>'+esc((l.kor_sampling==null?'-':num(l.kor_sampling,2))+' / '+(l.kor_final==null?'-':num(l.kor_final,2)))+'</b></div><div><small>Statut</small><b>'+businessBadge(l.status)+'</b></div></div></section>'+
 (drg?notice('warn','<b>LOT libéré par dérogation '+esc(drg.id)+'</b> · '+esc(drg.decided_by_name||'-')+' ('+esc(drg.decided_role||'-')+') · '+dt(drg.created_at)+' · '+esc(drg.reason)):'')+
 allocation+
 '<section class="card"><h2>Positions actuelles / contributeurs BIN</h2>'+(contrib.length?table(['BIN','Restant','Fournisseur','Provenance','Camion','KOR'],contrib.map(function(c){return'<tr><td class="mono"><a href="#bins/'+encodeURIComponent(c.bin_id)+'">'+esc(c.bin_id)+'</a></td><td>'+kg(c.remaining_kg)+'</td><td>'+esc(c.supplier_name||'-')+'</td><td>'+esc(c.origin||'-')+'</td><td>'+esc(c.truck||'-')+'</td><td>'+esc(c.kor_final||'-')+'</td></tr>';})):'<div class="ops-empty">Aucune quantité en BIN pour le moment.</div>')+'</section>'+
 '<section class="card"><h2>Qualité après séchage</h2>'+(post.length?table(['Date','Séchage','Batch','Cycle','BIN','KOR','Humidité','Décision'],post.map(function(pq){return'<tr><td>'+dt(pq.created_at)+'</td><td class="mono">'+esc(pq.drying_id)+'</td><td class="mono">'+esc(pq.batch_id||'-')+'</td><td>'+esc(pq.cycle_no||'-')+'</td><td class="mono">'+esc(pq.dest_bin_id||'-')+'</td><td>'+esc(pq.kor_display||'-')+'</td><td>'+esc(pq.moisture_pct==null?'-':pq.moisture_pct+' %')+'</td><td>'+businessBadge(pq.disposition||'-')+'</td></tr>';})):'<div class="ops-empty">Aucune qualité après séchage enregistrée.</div>')+'</section>'+
 '<section class="card"><h2>Historique des mouvements du LOT</h2>'+(mov.length?table(['Date','Mouvement','Type','Entrepôt','BIN','De → Vers','Sortie','Entrée','Auteur','Référence'],mov.map(function(m){return'<tr><td>'+dt(m.posted_at)+'</td><td class="mono">'+esc(m.movement_id)+'</td><td>'+esc(movLabel(m.type))+'</td><td>'+esc(m.warehouse_code||'-')+'</td><td class="mono">'+esc(m.bin_id||'-')+'</td><td>'+esc(locLabel(m.source_type,m.source_id)+' → '+locLabel(m.dest_type,m.dest_id))+'</td><td>'+kg(m.qty_out)+'</td><td>'+kg(m.qty_in)+'</td><td>'+esc((m.created_by_name||'-')+(m.created_role?' · '+m.created_role:''))+'</td><td>'+esc(movRef(m))+'</td></tr>';})):'<div class="ops-empty">Aucun mouvement enregistré pour ce LOT.</div>')+'</section>'+
 '<section class="card"><h2>Sacs liés au LOT</h2>'+(bags.length?table(['Date','Type','Registre','Qté','De','Vers','État','Condition','Référence'],bags.map(function(b){return'<tr><td>'+dt(b.movement_at)+'</td><td>'+esc(b.movement_type)+'</td><td>'+esc(b.ledger)+'</td><td>'+esc(b.qty)+'</td><td>'+esc(b.from_location||'-')+'</td><td>'+esc(b.to_location||'-')+'</td><td>'+esc(b.to_state||'-')+'</td><td>'+esc(b.bag_condition||'-')+'</td><td>'+esc(b.reference||'-')+'</td></tr>';})):'<div class="ops-empty">Aucun mouvement de sacs visible pour ce LOT.</div>')+'</section>';
}

function binsList(){
 var manage=can('master_data')?'<a class="btn secondary" href="#bins/warehouses">Gérer les entrepôts</a>':'';
 var create=can('bin_ops')?'<a class="btn primary ops-cta-create" href="#bins/new">+ Créer un BIN</a>':'';
 var content=state.bins.length?table(['BIN','Entrepôt','Zone','Type','Stock','Capacité','Occupation','Contributeurs','Âge','Statut'],state.bins.map(function(b){return'<tr class="ops-click" data-href="#bins/'+encodeURIComponent(b.id)+'"><td class="mono">'+esc(b.id)+'</td><td>'+esc(b.warehouse_code||'-')+'</td><td>'+esc(b.area_code||'-')+'</td><td>'+esc(b.stock_type)+'</td><td>'+kg(b.balance_kg)+'</td><td>'+(b.capacity_kg==null?'-':kg(b.capacity_kg))+'</td><td>'+num(b.occupancy_pct,1)+' %</td><td>'+esc(b.contributors||0)+'</td><td>'+num(b.age_hours,1)+' h</td><td>'+businessBadge(b.status)+'</td></tr>';})):'<div class="ops-empty"><b>Aucun BIN disponible.</b><br>Un BIN est nécessaire pour stocker un LOT après sa libération.'+(can('bin_ops')?'<div class="ops-actions" style="margin-top:12px"><a class="btn primary" href="#bins/new">Créer le premier BIN</a></div>':'')+'</div>';
 root.innerHTML=head('Stock & BIN','BIN = localisation physique. Créez et gérez les emplacements de stockage.',manage+create)+'<section class="card">'+content+'</section>';
}

function warehouseManage(){
 root.innerHTML=head('Gérer les entrepôts','Créer, modifier, activer/désactiver et gérer les Physical Areas.','<a class="btn secondary" href="#bins">Retour</a><a class="btn primary" href="#bins/warehouse-new">+ Warehouse</a>')+
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
 '<form class="ops-form-card" data-action="area-save" data-id="'+esc(a.id)+'" data-wh="'+esc(a.warehouse_id)+'"><div class="ops-form-grid">'+field('Area Code','code','text',a.code,'required')+field('Description','description','text',a.description||'')+field('Capacity kg','capacity_kg','number',a.capacity_kg==null?'':a.capacity_kg,'step="0.001" min="0"')+select('Status','status',[['ACTIVE','Active'],['INACTIVE','Inactive']],a.status,'required')+field('Motif','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Save Area</button></div></form>';
}
function binNew(){
 var activeWh=state.warehouses.filter(function(w){return w.status==='ACTIVE';});
 var pre=null;try{pre=JSON.parse(sessionStorage.getItem('wms_bin_prefill')||'null');}catch(e){}
 var areaOpts=[['','Aucune zone physique']].concat(state.areas.filter(function(a){return a.status==='ACTIVE'&&(!pre||!pre.warehouse_id||String(a.warehouse_id)===String(pre.warehouse_id));}).map(function(a){var w=whById(a.warehouse_id);return[a.id,(w?w.code:'')+' / '+a.code+(a.capacity_kg!=null&&a.capacity_kg!==''?' (capacité de la zone : '+kg(a.capacity_kg)+')':'')];}));
 var msg=pre&&pre.lot_id?notice('info','Vous créez un BIN pour poursuivre l’affectation du LOT <b>'+esc(pre.lot_id)+'</b>. Après création, l’application vous ramènera automatiquement vers ce LOT.'):'';
 root.innerHTML=head('Créer un BIN','Un BIN est un emplacement opérationnel unique.','<a class="btn secondary" href="'+(pre&&pre.lot_id?'#lots/'+encodeURIComponent(pre.lot_id):'#bins')+'">Retour</a>')+msg+
 '<form class="ops-form-card" data-action="bin-create"><div class="ops-form-grid">'+select('Entrepôt','warehouse_id',[['','Sélectionner...']].concat(activeWh.map(function(w){return[w.id,w.code+' - '+w.name];})),pre&&pre.warehouse_id?pre.warehouse_id:'','required')+select('Zone physique','physical_area_id',areaOpts,'')+select('Type de stock','stock_type',[['WET','Humide'],['DRY','Sec'],['HOLD','Bloqué']],'WET','required')+'</div><p class="ops-help" style="margin:8px 0 0">Aucune capacité n’est saisie à la création. Si la zone physique a une capacité, elle est reprise automatiquement (lecture seule).</p><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Créer le BIN</button></div></form>';
}

async function binDetail(b){
 var contrib=await q('wms_v_bin_contributors','*',function(x){return x.eq('bin_id',b.id).gt('remaining_kg',0);});
 var lots=state.lots.filter(function(l){return Number(l.staging_kg||0)>0&&String(l.warehouse_id)===String(b.warehouse_id);});
 var dests=state.bins.filter(function(x){return x.id!==b.id&&String(x.warehouse_id)===String(b.warehouse_id)&&x.stock_type===b.stock_type&&['CLOSED','BLOCKED'].indexOf(x.status)<0;});
 var alloc=can('bin_ops')&&b.status!=='CLOSED'&&b.status!=='BLOCKED'?'<form class="card" data-action="allocate" data-bin="'+esc(b.id)+'"><h2>Ajouter un LOT</h2><div class="ops-form-grid">'+select('Lot','lot_id',[['','Sélectionner...']].concat(lots.map(function(l){return[l.id,l.id+' · staging '+kg(l.staging_kg)];})),'','required')+field('Qty kg','qty','number','','required step="0.001" min="0.001"')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Affecter le LOT</button></div></form>':'';
 var transfer=can('bin_ops')&&b.status!=='CLOSED'&&b.status!=='BLOCKED'&&Number(b.balance_kg||0)>0?'<form class="card" data-action="bin-transfer" data-bin="'+esc(b.id)+'"><h2>BIN → BIN Transfer</h2><p class="muted">Les contributeurs LOT sont alloués automatiquement par le ledger.</p><div class="ops-form-grid">'+select('Destination BIN','to_bin',[['','Sélectionner...']].concat(dests.map(function(x){var free=x.capacity_kg==null?'∞':kg(Math.max(0,Number(x.capacity_kg)-Number(x.balance_kg||0)));return[x.id,x.id+' · stock '+kg(x.balance_kg)+' · free '+free];})),'','required')+field('Quantity kg','qty','number','','required step="0.001" min="0.001" max="'+esc(b.balance_kg)+'"')+field('Motif','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Post BIN Transfer</button></div></form>':'';
 var count=can('inventory_count')&&b.status!=='CLOSED'?'<form class="card" data-action="inventory-count" data-bin="'+esc(b.id)+'"><h2>Comptage inventaire</h2><div class="ops-form-grid">'+field('Physical kg','physical_kg','number','','required step="0.001" min="0"')+field('Note','note','text','')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn secondary">Create Count</button></div></form>':'';
 var close=can('bin_close')&&b.status!=='CLOSED'?'<form class="card" data-action="bin-close" data-bin="'+esc(b.id)+'"><h2>Close BIN</h2><div class="ops-form-grid">'+select('Physical Empty','physical_empty',[['false','No'],['true','Yes']],'false','required')+field('Residue kg','residue_kg','number','0','step="0.001" min="0"')+field('Motif','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Close & Lock</button></div></form>':'';
 var lifecycle='<section class="card"><h2>BIN Controls</h2><div class="ops-actions">'+
   (can('bin_close')&&b.status!=='CLOSED'?(b.status==='BLOCKED'?'<button class="btn secondary" data-action-button="bin-status" data-id="'+esc(b.id)+'" data-status="UNBLOCK">Unblock BIN</button>':'<button class="btn secondary" data-action-button="bin-status" data-id="'+esc(b.id)+'" data-status="BLOCKED">Block BIN</button>'):'')+
   (can('bin_reopen')&&b.status==='CLOSED'?'<button class="btn signal" data-action-button="bin-status" data-id="'+esc(b.id)+'" data-status="REOPEN">Reopen BIN</button>':'')+
   (Number(b.balance_kg||0)>0?'<button class="btn primary" data-action-button="prepare-transfer-bin" data-id="'+esc(b.id)+'">Préparer le transfert</button>':'')+
 '</div></section>';
 root.innerHTML=head(b.id,b.warehouse_code+' · '+b.stock_type,'<a class="btn secondary" href="#bins">Retour</a>'+(Number(b.balance_kg||0)>0&&b.status!=='BLOCKED'&&b.status!=='CLOSED'?'<a class="btn secondary" href="#drying/new">Démarrer un séchage</a>':''))+
 '<div class="ops-def-grid"><div><small>Stock</small><b>'+kg(b.balance_kg)+'</b></div><div><small>Capacity</small><b>'+(b.capacity_kg==null?'-':kg(b.capacity_kg))+'</b></div><div><small>Available capacity</small><b>'+(b.capacity_kg==null?'∞':kg(Math.max(0,Number(b.capacity_kg)-Number(b.balance_kg||0))))+'</b></div><div><small>Occupancy</small><b>'+num(b.occupancy_pct,1)+' %</b></div><div><small>Area</small><b>'+esc(b.area_code||'-')+'</b></div><div><small>Contributors</small><b>'+esc(b.contributors||0)+'</b></div><div><small>Statut</small><b>'+badge(b.status)+'</b></div><div><small>Reopen count</small><b>'+esc(b.reopen_count||0)+'</b></div></div>'+
 '<section class="card"><h2>Contributors</h2>'+table(['Lot','Supplier','Origin','Truck','IN','OUT','Remaining','KOR'],contrib.map(function(c){return'<tr><td class="mono"><a href="#lots/'+encodeURIComponent(c.lot_id)+'">'+esc(c.lot_id)+'</a></td><td>'+esc(c.supplier_name||'-')+'</td><td>'+esc(c.origin||'-')+'</td><td>'+esc(c.truck||'-')+'</td><td>'+kg(c.qty_in)+'</td><td>'+kg(c.qty_out)+'</td><td>'+kg(c.remaining_kg)+'</td><td>'+esc(c.kor_final||'-')+'</td></tr>';}))+'</section>'+lifecycle+alloc+transfer+count+close;
}

async function dryingRoute(){
 state.dryings=await q('wms_dryings','*',function(x){return x.order('created_at',{ascending:false}).limit(300);});
 root.innerHTML=head('Séchage / Tri','Before / after, process loss and genealogy.',can('drying')?'<a class="btn primary ops-cta-create" href="#drying/new">+ New Séchage / Tri</a>':'')+
 '<section class="card">'+table(['Operation','Batch','Cycle','Type','Source','Destination','Input','Output','Loss','Moisture','Status'],state.dryings.map(function(d){return'<tr class="ops-click" data-href="#drying/'+encodeURIComponent(d.id)+'"><td class="mono">'+esc(d.id)+'</td><td class="mono">'+esc(d.batch_id)+'</td><td>'+esc(d.cycle_no)+'</td><td>'+esc(d.type)+'</td><td class="mono">'+esc(d.source_bin_id)+'</td><td class="mono">'+esc(d.dest_bin_id)+'</td><td>'+kg(d.input_kg)+'</td><td>'+kg(d.output_kg)+'</td><td>'+kg(d.process_loss_kg)+' ('+num(d.process_loss_pct,2)+'%)</td><td>'+esc(d.moisture_before==null?'-':d.moisture_before+' → '+d.moisture_after)+'</td><td>'+badge(d.loss_alert?'LOSS ALERT':d.status)+'</td></tr>';}))+'</section>';
}
function dryingNew(){
 var avail=state.bins.filter(function(b){return Number(b.balance_kg||0)>0&&['CLOSED','BLOCKED'].indexOf(b.status)<0;}),all=state.bins.filter(function(b){return['CLOSED','BLOCKED'].indexOf(b.status)<0;});
 root.innerHTML=head('New Séchage / Tri','Physical issue + receipt, with declared process loss.','<a class="btn secondary" href="#drying">Retour</a>')+
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
 var form=can('post_dry_qa')&&pending.length?'<form class="card" data-action="post-dry-quality" data-drying="'+esc(d.id)+'"><h2>Qualité après séchage</h2><p class="muted">Snapshot Quality indépendant du Warehouse Coordinator. Blank ≠ 0.</p><div class="ops-form-grid">'+
 select('LOT','lot_id',pending.map(function(x){return[x.lot_id,x.lot_id+' · '+kg(x.qty_in)];}),'','required')+
 field('Bonnes amandes (g)','gk_g','number','','required step="0.001" min="0"')+field('Immatûres (g)','imm_g','number','','required step="0.001" min="0"')+field('Tachetées (g)','spotted_g','number','','required step="0.001" min="0"')+
 field('Humidité (%)','moisture_pct','number','','required step="0.01" min="0"')+field('Nombre de noix','nut_count','number','','min="0"')+
 select('Disposition','disposition',[['READY','READY'],['RE_DRY','RE-DRY'],['HOLD','HOLD']],'READY','required')+field('Decision Reason','decision_reason','text','')+textarea('Quality Note','note','')+
 '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Save Qualité après séchage</button></div></form>':'';
 var redry=d.status==='RE_DRY'&&can('drying')?'<section class="card"><h2>Re-Dry Required</h2><p>Créez le cycle suivant en conservant Batch et généalogie.</p><div class="ops-actions"><button class="btn primary" data-action-button="redry" data-id="'+esc(d.id)+'">Start Re-Dry Cycle</button></div></section>':'';
 root.innerHTML=head(d.id,'Batch '+d.batch_id+' · Cycle '+d.cycle_no,'<a class="btn secondary" href="#drying">Retour</a>')+
 '<div class="ops-def-grid"><div><small>Statut</small><b>'+badge(d.status)+'</b></div><div><small>Type de source</small><b>'+esc(d.source_bin_id)+'</b></div><div><small>Destination</small><b>'+esc(d.dest_bin_id)+'</b></div><div><small>Input</small><b>'+kg(d.input_kg)+'</b></div><div><small>Output</small><b>'+kg(d.output_kg)+'</b></div><div><small>Process Loss</small><b>'+kg(d.process_loss_kg)+' · '+num(d.process_loss_pct,2)+'%</b></div></div>'+
 '<section class="card"><h2>Quality genealogy</h2>'+table(['LOT','Qty after','Post-Dry KOR','Moisture','Disposition'],contributors.map(function(x){var ql=snapMap[x.lot_id];return'<tr><td class="mono">'+esc(x.lot_id)+'</td><td>'+kg(x.qty_in)+'</td><td>'+esc(ql?ql.kor_display:'PENDING')+'</td><td>'+esc(ql&&ql.moisture_pct!=null?ql.moisture_pct+' %':'-')+'</td><td>'+badge(ql?ql.disposition:'AWAITING_POST_DRY_QA')+'</td></tr>';}))+'</section>'+form+redry;
}


var BAG_STATE={UTILISABLE:'Utilisables',PLEIN:'Pleins (RCN)',HUMIDE:'Humides',A_REPARER:'À réparer',REPARE:'Réparés (à vérifier)',DECHIRE:'Déchirés',REFORME:'Rebut',EN_TRANSIT:'En transit',A_CLASSER:'À classer'};
function bagState(v){return BAG_STATE[v]||v||'-';}
var BAG_KINDS=[['DOTATION','Dotation de sacs vides à un fournisseur'],['RETURN','Retour de sacs vides par un fournisseur'],['APPROVED_LOSS','Perte approuvée (dette fournisseur)'],['DAMAGED','Déclassement : utilisable → déchiré'],['REPAIR_OUT','Envoi en réparation (sacs déchirés)'],['RECONDITIONED','Retour de réparation (reconditionnés)'],['SCRAP','Mise au rebut (le sac sort du stock)'],['INTERNAL_USE','Utilisation interne (remplissage)'],['RETURN_FROM_USE','Retour d’usage interne'],['REBAGGING','Réensachage RCN (consommation)'],['PRODUCTION_ISSUE','Sortie vers la production (sacs pleins)'],['PRODUCTION_RETURN','Retour de production'],['PRODUCTION_CONSUMED','Sacs consommés en production'],['PRODUCTION_SCRAP','Sacs mis au rebut en production']];
async function bagsRoute(){
 var errs=[];function soft(label){return function(e){errs.push(label+' : '+(e&&e.message?e.message:e));return[];};}
 var res=await Promise.all([
   q('rcn_jute_v_stock','location_code,state,qty',function(x){return x.order('location_code').limit(1000);}).catch(soft('Stock de sacs')),
   q('jute_v_supplier_balance','*',function(x){return x.order('balance',{ascending:false}).limit(300);}).catch(soft('Soldes fournisseurs')),
   q('rcn_jute_locations','code,nom,actif,scope_type',function(x){return x.eq('actif',true).order('code').limit(500);}).catch(soft('Emplacements')),
   q('jute_v_warehouse_closing_balance','*',function(x){return x.order('location_code');}).catch(soft('Clôture sacherie')),
   q('jute_v_production_balance','*').catch(soft('Solde production')),
   q('rcn_jute_movements','id,movement_type,ledger,qty,from_location,to_location,from_state,to_state,bag_condition,reception_id,lot_id,supplier_code,reference,movement_at',function(x){return x.order('movement_at',{ascending:false}).limit(100);}).catch(soft('Derniers mouvements'))
 ]);
 state.bagStock=res[0];state.bagDebt=res[1];state.locations=res[2];
 var closing=res[3].filter(function(c){return Number(c.closing_actual||0)!==0||Number(c.receipts||0)!==0||Number(c.transfers_in||0)!==0;}),prod=res[4],mv=res[5];
 var stock=state.bagStock.filter(function(x){return x.location_code!=='JUTE-REBUT'&&Number(x.qty||0)!==0;});
 function sum(st){return stock.filter(function(x){return st.indexOf(x.state)>=0;}).reduce(function(t,x){return t+Number(x.qty||0);},0);}
 root.innerHTML=head('Gestion sacherie','Registre unique des sacs jute : stock physique par état, dette fournisseur, production. Les sacs reçus avec une livraison et les transferts sont enregistrés automatiquement.',can('bag_move')||can('jute_production')?'<a class="btn primary ops-cta-create" href="#bags/new">+ Mouvement de sacs</a>':'')+
 (errs.length?notice('danger','<b>Données partielles :</b><br>'+errs.map(esc).join('<br>')):'')+
 '<div class="kpi-grid">'+kpi('Sacs utilisables',sum(['UTILISABLE']),'#bags','')+kpi('Sacs pleins (RCN)',sum(['PLEIN']),'#bags','')+kpi('Déchirés / à réparer',sum(['DECHIRE','A_REPARER','REPARE']),'#bags','')+kpi('Dette fournisseurs',state.bagDebt.reduce(function(t,x){return t+Number(x.balance||0);},0),'#bags','attn')+'</div>'+
 '<section class="card"><div class="card-head"><div><h2>Clôture sacherie par entrepôt</h2><p>Ouverture + Réceptions + Transferts entrants − Sorties − Rebut − Transferts sortants (± ajustements) = Clôture.</p></div></div>'+table(['Emplacement','Réceptions','Trf entrants','Sorties','Rebut','Trf sortants','Ajust.','Clôture attendue','Clôture réelle','Écart','Utilisables','Pleins','Humides','Réparation','Déchirés'],closing.map(function(c){return'<tr><td class="mono">'+esc(c.location_code)+'</td><td>'+esc(c.receipts)+'</td><td>'+esc(c.transfers_in)+'</td><td>'+esc(c.issues)+'</td><td>'+esc(c.damaged_discarded)+'</td><td>'+esc(c.transfers_out)+'</td><td>'+esc(c.adjustments)+'</td><td>'+esc(c.closing_expected)+'</td><td><b>'+esc(c.closing_actual)+'</b></td><td>'+badge(Number(c.variance||0)===0?'0':String(c.variance))+'</td><td>'+esc(c.utilisable)+'</td><td>'+esc(c.plein)+'</td><td>'+esc(c.humide)+'</td><td>'+esc(c.en_reparation)+'</td><td>'+esc(c.dechire)+'</td></tr>';}))+'</section>'+
 '<div class="grid-2"><section class="card"><h2>Stock physique par état</h2>'+table(['Emplacement','État','Quantité'],stock.map(function(x){return'<tr><td class="mono">'+esc(x.location_code)+'</td><td>'+esc(bagState(x.state))+'</td><td>'+esc(x.qty)+'</td></tr>';}))+'</section>'+
 '<section class="card"><h2>Soldes fournisseurs</h2>'+table(['Fournisseur','Dotés','Rendus','Pertes approuvées','Reçus avec livraison','Solde dû'],state.bagDebt.map(function(x){return'<tr><td class="mono">'+esc(x.supplier_code)+'</td><td>'+esc(x.issued)+'</td><td>'+esc(x.returned)+'</td><td>'+esc(x.approved_loss)+'</td><td>'+esc(x.received_with_delivery)+'</td><td><b>'+esc(x.balance)+'</b></td></tr>';}))+'</section></div>'+
 '<section class="card"><h2>Sacs en production</h2>'+table(['Emplacement production','Sortis vers production','Retournés','Consommés','Rebut','Solde en production'],prod.map(function(x){return'<tr><td class="mono">'+esc(x.production_location)+'</td><td>'+esc(x.issued)+'</td><td>'+esc(x.returned)+'</td><td>'+esc(x.consumed)+'</td><td>'+esc(x.damaged)+'</td><td><b>'+esc(x.balance)+'</b></td></tr>';}))+'</section>'+
 '<section class="card"><h2>Derniers mouvements de sacs</h2>'+table(['Date','Type','Registre','Qté','De','Vers','État','Condition','Réception','LOT','Fournisseur','Référence'],mv.map(function(m){return'<tr><td>'+dt(m.movement_at)+'</td><td>'+esc(m.movement_type)+'</td><td>'+esc(m.ledger)+'</td><td>'+esc(m.qty)+'</td><td class="mono">'+esc(m.from_location||'-')+'</td><td class="mono">'+esc(m.to_location||'-')+'</td><td>'+esc(bagState(m.to_state||m.from_state))+'</td><td>'+esc(m.bag_condition||'-')+'</td><td class="mono">'+esc(m.reception_id||'-')+'</td><td class="mono">'+esc(m.lot_id||'-')+'</td><td class="mono">'+esc(m.supplier_code||'-')+'</td><td>'+esc(m.reference||'-')+'</td></tr>';}))+'</section>';
}
function bagNew(){
 var myLoc=state.scope&&state.scope.scoped&&state.scope.warehouse_code?'BAG-WH-'+state.scope.warehouse_code:'';
 var locs=state.locations.filter(function(x){return x.scope_type!=='PRODUCTION'&&x.code!=='JUTE-REBUT'&&x.code!=='JUTE-TRANSIT';}).map(function(x){return[x.code,x.code+' - '+(x.nom||'')];});
 var kinds=BAG_KINDS.filter(function(k){return k[0].indexOf('PRODUCTION_')===0?can('jute_production'):can('bag_move');});
 root.innerHTML=head('Nouveau mouvement de sacs','Mouvement physique sur le registre sacherie. Les contrôles de stock (pas de stock négatif), de dette fournisseur et de périmètre sont faits par le serveur.','<a class="btn secondary" href="#bags">Retour</a>')+
 '<form class="ops-form-card" data-action="bag-move"><div class="ops-form-grid">'+select('Type de mouvement','kind',kinds,kinds.length?kinds[0][0]:'','required')+select('Emplacement (entrepôt)','location',[['','Sélectionner...']].concat(locs),myLoc,'required')+field('Quantité de sacs','qty','number','','required min="1" step="1"')+
 field('Code fournisseur (dotation, retour, perte)','supplier_code','text','','list="bagSupplierList"')+
 select('État des sacs retournés (retour fournisseur / production)','condition',[['','—'],['GOOD','Bon (utilisable)'],['DAMAGED','Déchiré'],['WET','Humide'],['REPAIRABLE','À réparer']],'')+
 select('État d’origine (mise au rebut)','from_state',[['','Déchiré (par défaut)'],['DECHIRE','Déchiré'],['A_REPARER','À réparer'],['HUMIDE','Humide'],['UTILISABLE','Utilisable']],'')+
 select('Reconditionnement vérifié ?','verified',[['false','Non (reste « Réparés à vérifier »)'],['true','Oui : sacs utilisables']],'false')+
 field('Référence','reference','text','')+field('Approuvé par (perte approuvée)','approved_by','text','')+field('BIN (réensachage)','bin_id','text','')+field('LOT','lot_id','text','')+textarea('Note / motif','note','')+
 '</div><datalist id="bagSupplierList">'+(state.suppliers||[]).map(function(x){return'<option value="'+esc(x.code)+'">'+esc(x.nom||'')+'</option>';}).join('')+'</datalist><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Enregistrer le mouvement</button></div></form>';
}

async function inventoryRoute(){
 state.inventory=await q('wms_inventory_counts','*',function(x){return x.order('counted_at',{ascending:false}).limit(300);});
 root.innerHTML=head('Inventory','Cycle Count: physical count never changes stock before approval.')+
 '<section class="card">'+table(['Count','BIN','Theoretical','Physical','Variance','Status','Counted by','Approver','Date'],state.inventory.map(function(i){return'<tr><td class="mono">'+esc(i.id)+'</td><td class="mono">'+esc(i.bin_id)+'</td><td>'+kg(i.theoretical_kg)+'</td><td>'+kg(i.physical_kg)+'</td><td>'+kg(i.variance_kg)+'</td><td>'+badge(i.status)+'</td><td>'+esc(i.counted_by_name||'-')+'</td><td>'+esc(i.approved_by_name||'-')+'</td><td>'+dt(i.counted_at)+'</td></tr>';}))+'</section>'+
 (can('inventory_approve')?'<section class="card"><h2>Resolve open variance</h2><form data-action="inventory-resolve"><div class="ops-form-grid">'+select('Count','count_id',[['','Sélectionner...']].concat(state.inventory.filter(function(i){return i.status==='REVIEW_REQUIRED';}).map(function(i){return[i.id,i.id+' · '+i.bin_id+' · variance '+kg(i.variance_kg)];})),'','required')+select('Decision','approve',[['true','Approve adjustment'],['false','Reject count']],'true','required')+field('Motif','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Resolve</button></div></form></section>':'');
}

async function auditRoute(){
 state.audit=await q('wms_v_audit','*',function(x){return x.order('created_at',{ascending:false}).limit(500);});
 root.innerHTML=head('Audit','Read-only append-only journal.')+'<section class="card">'+table(['Date','Object','Type','Field / Action','Reason','Author','Role','Approver'],state.audit.map(function(a){return'<tr><td>'+dt(a.created_at)+'</td><td class="mono">'+esc(a.objet||'-')+'</td><td>'+esc(a.object_type||'-')+'</td><td>'+esc(a.champ||'-')+'</td><td>'+esc(a.motif||'-')+'</td><td>'+esc(a.auteur||'-')+'</td><td>'+esc(a.role||'-')+'</td><td>'+esc(a.approbateur||'-')+'</td></tr>';}))+'</section>';
}

var MOV_PAGE=50;
function addDay(d){var x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10);}
function movQuery(f,opts){
 var wf=whFilterId(),qb=sb.from('wms_v_movement_lines').select('*',opts||{});
 if(wf)qb=qb.eq('warehouse_id',wf);else if(f.wh)qb=qb.eq('warehouse_id',f.wh);
 if(f.lot)qb=qb.ilike('lot_id','%'+f.lot+'%');
 if(f.bin)qb=qb.ilike('bin_id','%'+f.bin+'%');
 if(f.type)qb=qb.eq('type',f.type);
 if(f.from)qb=qb.gte('posted_at',f.from+'T00:00:00Z');
 if(f.to)qb=qb.lt('posted_at',addDay(f.to)+'T00:00:00Z');
 return qb.order('posted_at',{ascending:false}).order('movement_id',{ascending:false});
}
async function movementsRoute(){
 var f=state.movFilter||{page:0},page=Number(f.page||0);
 var res=await movQuery(f,{count:'exact'}).range(page*MOV_PAGE,page*MOV_PAGE+MOV_PAGE-1);
 var rows=res.data||[],total=res.count||0,pages=Math.max(1,Math.ceil(total/MOV_PAGE));
 var scoped=state.scope&&state.scope.scoped;
 var typeOpts=[['','Tous les types']].concat(Object.keys(MOV_LABELS).map(function(k){return[k,MOV_LABELS[k]];}));
 root.innerHTML=head('Journal des mouvements','Toutes les écritures de stock RCN, une ligne par LOT et par mouvement. Lecture seule : les mouvements ne sont créés que par les fonctions métier contrôlées.')+
  (res.error?notice('danger','<b>Journal indisponible :</b>&nbsp;'+esc(res.error.message)):'')+
  '<form class="card" data-action="mov-filter"><div class="ops-form-grid">'+field('Du','from','date',f.from||'')+field('Au','to','date',f.to||'')+field('LOT','lot','text',f.lot||'')+field('BIN','bin','text',f.bin||'')+select('Type','type',typeOpts,f.type||'')+
  (scoped?'':select('Entrepôt','wh',[['','Tous (ou filtre global)']].concat(state.warehouses.map(function(w){return[w.id,w.code];})),f.wh||''))+
  '</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Filtrer</button><button type="button" class="btn secondary" data-action-button="mov-reset">Réinitialiser</button><button type="button" class="btn secondary" data-action-button="mov-export">Exporter CSV (1 000 lignes max)</button></div></form>'+
  '<section class="card"><div class="card-head"><div><h2>'+total+' ligne(s)</h2><p>Page '+(page+1)+' / '+pages+' · '+MOV_PAGE+' lignes par page (pagination serveur)</p></div></div>'+
  table(['Date','LOT','BIN','Entrepôt','Type','De → Vers','Sortie (kg)','Entrée (kg)','Auteur','Référence','Mouvement'],rows.map(function(m){return'<tr><td>'+dt(m.posted_at)+'</td><td class="mono"><a href="#lots/'+encodeURIComponent(m.lot_id)+'">'+esc(m.lot_id)+'</a></td><td class="mono">'+(m.bin_id?'<a href="#bins/'+encodeURIComponent(m.bin_id)+'">'+esc(m.bin_id)+'</a>':'-')+'</td><td>'+esc(m.warehouse_code||'-')+'</td><td>'+esc(movLabel(m.type))+'</td><td>'+esc(locLabel(m.source_type,m.source_id)+' → '+locLabel(m.dest_type,m.dest_id))+'</td><td>'+num(m.qty_out,3)+'</td><td>'+num(m.qty_in,3)+'</td><td>'+esc((m.created_by_name||'-')+(m.created_role?' · '+m.created_role:''))+'</td><td>'+esc(movRef(m))+'</td><td class="mono">'+esc(m.movement_id)+'</td></tr>';}))+
  '<div class="ops-actions" style="margin-top:12px">'+(page>0?'<button class="btn secondary" data-action-button="mov-page" data-page="'+(page-1)+'">← Page précédente</button>':'')+(page+1<pages?'<button class="btn secondary" data-action-button="mov-page" data-page="'+(page+1)+'">Page suivante →</button>':'')+'</div></section>';
}
async function movementsExport(){
 var res=await movQuery(state.movFilter||{}).limit(1000);
 if(res.error)throw new Error(res.error.message);
 var cols=['posted_at','movement_id','lot_id','bin_id','warehouse_code','type','source_type','source_id','dest_type','dest_id','qty_out','qty_in','created_by_name','created_role','reference_type','reference_id','reason'];
 var csv=[cols.join(';')].concat((res.data||[]).map(function(r){return cols.map(function(c){var v=r[c]==null?'':String(r[c]);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(';');})).join('\n');
 var blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='journal-mouvements-'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},500);
}
async function grnRoute(rid){
 var g=(await q('wms_grns','*',function(x){return x.eq('reception_id',rid).limit(1);}))[0]||null;
 var r=await fetchRec(rid);
 if(!g){root.innerHTML=head('GRN · '+rid,'Aucun GRN émis pour cette réception.','<a class="btn secondary" href="#inbound/'+encodeURIComponent(rid)+'">Retour au dossier</a>')+(r?grnSection(r):notice('danger','Réception introuvable ou hors de votre périmètre.'));return;}
 var c=g.content||{},w=c.warehouse||{},rc=c.reception||{},su=c.supplier||{},we=c.weighing||{},bg=c.bags||{},qu=c.quality||{},lo=c.lot||{},dc=c.documents||{},drg=c.quality_derogation;
 var lotNow=r&&r.lot_id?lotById(r.lot_id):null;
 function row(label,val){return'<tr><th scope="row">'+esc(label)+'</th><td>'+val+'</td></tr>';}
 function na(v){return v==null||v===''?'-':v;}
 root.innerHTML='<style>@media print{body *{visibility:hidden!important}#grn-print,#grn-print *{visibility:visible!important}#grn-print{position:absolute;left:0;top:0;width:100%;padding:10mm;box-shadow:none;border:0}.no-print{display:none!important}}#grn-print table{width:100%;border-collapse:collapse;margin-bottom:12px}#grn-print th,#grn-print td{border:1px solid #cfd6dd;padding:6px 8px;text-align:left;vertical-align:top}#grn-print th{width:38%;background:#f4f6f8;font-weight:600}#grn-print h2{margin:14px 0 6px;font-size:1.05rem}</style>'+
  '<div class="no-print">'+head('GRN '+g.id,'Bon de réception officiel (Goods Received Note), figé à l’émission.','<a class="btn secondary" href="#inbound/'+encodeURIComponent(rid)+'">Retour au dossier</a><button class="btn primary" data-action-button="print-grn">Imprimer / enregistrer en PDF</button>')+'</div>'+
  '<section class="card" id="grn-print"><h1 style="margin:0 0 4px">ANAGROCI · Bon de réception '+esc(g.id)+'</h1><p style="margin:0 0 12px">'+esc(na(w.code))+' · '+esc(na(w.name))+' · émis le '+dt(g.issued_at)+' par '+esc(na(g.issued_by_name))+' ('+esc(na(g.issued_role))+')'+(g.status!=='EMIS'?' · <b>'+esc(g.status)+'</b>':'')+'</p>'+
  '<h2>Réception</h2><table>'+row('Réception',esc(na(rc.id)))+row('Arrivée',dt(rc.arrival_at))+row('Camion',esc(na(rc.truck)))+row('Conducteur / transporteur',esc(na(rc.driver)+' / '+na(rc.transporter)))+row('Canal / type d’achat',esc(na(rc.channel)+' / '+na(rc.purchase_type)))+row('Source Procurement',esc(na(rc.source)+' '+(rc.source_id||'')))+row('Décision d’arrivée',esc(na(rc.decision)+' · '+na(rc.decided_by))+' · '+dt(rc.decided_at))+'</table>'+
  '<h2>Fournisseur</h2><table>'+row('Fournisseur',esc(na(su.code)+' · '+na(su.name)))+row('LBA',esc(na(su.lba_code)))+row('Provenance',esc(na(su.origin)))+'</table>'+
  '<h2>Pesée et déchargement</h2><table>'+row('Poids brut',kg(we.gross_kg))+row('Tare',kg(we.tare_kg))+row('Poids net','<b>'+kg(we.net_kg)+'</b>')+row('Ticket pont-bascule',esc(na(we.weighbridge_ticket)))+row('Déchargement',dt(we.offload_start)+' → '+dt(we.offload_end))+row('Sacs : total / bons / humides / déchirés / reconditionnés',esc([bg.total,bg.good,bg.wet,bg.torn,bg.reconditioned].map(na).join(' / ')))+'</table>'+
  '<h2>Qualité</h2><table>'+row('KOR échantillonnage',esc(na(qu.sampling_kor)))+row('KOR final',esc(qu.final_kor==null?'Non mesuré à l’émission':qu.final_kor))+row('Écart KOR / dans la tolérance',esc(na(qu.kor_delta)+' / '+(qu.within_tolerance==null?'-':(qu.within_tolerance?'oui':'non'))))+row('Humidité finale',esc(qu.final_moisture==null?'-':qu.final_moisture+' %'))+row('Facteur KOR / formule',esc(na(qu.kor_factor)+' / '+na(qu.formula)))+(drg?row('Dérogation qualité',esc(na(drg.id)+' · '+na(drg.decided_by_name)+' · '+na(drg.reason))):'')+'</table>'+
  '<h2>LOT</h2><table>'+row('LOT',esc(na(lo.id||g.lot_id)))+row('Statut à l’émission',esc(statusLabelFr(lo.status_at_issue)))+row('Statut actuel',esc(lotNow?statusLabelFr(lotNow.status):'-'))+row('Poids initial',kg(lo.initial_kg))+'</table>'+
  '<h2>Documents</h2><table>'+row('Fiche de déchargement',esc(na(dc.delivery_note)))+row('Bon / reçu Warehouse',esc(na(dc.warehouse_receipt)))+((dc.checklist||[]).map(function(d){return row(d.label+(d.mandatory?' (obligatoire)':''),esc(docStatusLabel(d.status)+(d.reference?' · '+d.reference:'')));}).join(''))+(dc.derogation_bm?row('Dérogation documentaire BM',esc(na(dc.derogation_bm.by)+' · '+na(dc.derogation_bm.reason))):'')+'</table>'+
  '<p style="margin-top:18px">Signature magasinier : ______________________ &nbsp;&nbsp; Signature fournisseur / transporteur : ______________________</p></section>';
}
async function parametersRoute(){
 var errs=[];function soft(label){return function(e){errs.push(label+' : '+(e&&e.message?e.message:e));return[];};}
 var res=await Promise.all([
   q('wms_v_parameters_governance','*',function(x){return x.order('key').order('version',{ascending:false});}).catch(soft('Paramètres')),
   q('wms_document_types','*',function(x){return x.order('sort_order');}).catch(soft('Types de documents')),
   q('procurement_channels','*').catch(soft('Canaux')),
   can('profile_assign')?q('profils','user_id,nom,email,role,warehouse_code,actif',function(x){return x.order('nom').limit(500);}).catch(soft('Comptes')):Promise.resolve([])
 ]);
 var params=res[0],docs=res[1],channels=res[2],users=res[3],canSet=can('parameter_set');
 var keys=[];params.forEach(function(x){if(keys.indexOf(x.key)<0)keys.push(x.key);});
 function gov(v){return v==='VALIDE'?'VALIDÉ':v==='ARCHIVE'?'ARCHIVÉ':'BROUILLON · À VALIDER';}
 var rows=params.map(function(x){var val=JSON.stringify(x.value);return'<tr><td class="mono">'+esc(x.key)+'</td><td>v'+esc(x.version)+'</td><td>'+badge(gov(x.governance_status))+(x.value_flagged_a_valider?'<br><small>valeur marquée « A_VALIDER »</small>':'')+'</td><td>'+(x.is_current?'<b>En vigueur</b>':'-')+'</td><td><details><summary>'+esc(val.length>60?val.slice(0,60)+'…':val)+'</summary><pre style="white-space:pre-wrap;max-width:520px">'+esc(JSON.stringify(x.value,null,2))+'</pre></details></td><td>'+esc(x.created_by_name||'-')+'<br><small>'+dt(x.created_at)+'</small><br><small>'+esc(x.reason||'')+'</small></td><td>'+esc(x.validated_by_name||'-')+'<br><small>'+dt(x.validated_at)+'</small><br><small>'+esc(x.validation_reason||'')+'</small></td><td>'+(canSet&&x.governance_status==='BROUILLON'?'<form data-action="param-validate" data-id="'+esc(x.id)+'" style="display:flex;gap:6px;flex-wrap:wrap"><input name="reason" type="text" aria-label="Référence de la décision de validation" placeholder="Référence de la décision" required><button class="btn secondary">Valider</button></form>':'-')+'</td></tr>';});
 var chLabel={FIELD_BUYING:'Achat Bord Champ',LBA:'LBA',COOPERATIVE:'Coopérative',DIRECT:'Direct'};
 var docRows=docs.map(function(d){var mc=d.mandatory_channels||[];return'<tr><td>'+esc(d.label)+'</td><td class="mono">'+esc(d.code)+'</td><td>'+esc(mc.length?mc.map(function(c){return c==='*'?'Tous les canaux':(chLabel[c]||c);}).join(', '):'Aucun (facultatif)')+'</td><td>'+badge(d.governance_status==='VALIDE'?'VALIDÉ':'À VALIDER')+'</td><td>'+esc(d.validated_by_name||'-')+'<br><small>'+dt(d.validated_at)+'</small><br><small>'+esc(d.validation_reason||'')+'</small></td></tr>';});
 var docForm=canSet?'<form class="card" data-action="doc-requirement"><h3>Valider la liste des documents obligatoires</h3><p class="muted">Décision métier : cochez les canaux pour lesquels ce document est obligatoire (aucune case = facultatif). La validation est tracée (auteur, date, motif).</p><div class="ops-form-grid">'+select('Document','doc_type',docs.map(function(d){return[d.code,d.label];}),'','required')+'<fieldset class="ops-field"><legend>Obligatoire pour</legend>'+[['*','Tous les canaux']].concat(channels.map(function(c){return[c.code,chLabel[c.code]||c.code];})).map(function(o){var i=id('ch_'+o[0]);return'<label for="'+i+'" style="display:block;font-weight:400"><input id="'+i+'" type="checkbox" name="channels" value="'+esc(o[0])+'"> '+esc(o[1])+'</label>';}).join('')+'</fieldset>'+field('Motif / référence de la décision','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Valider pour ce document</button></div></form>':'';
 var propose=canSet?'<form class="card" data-action="param-propose"><h3>Proposer une nouvelle version d’un paramètre</h3><p class="muted">La nouvelle version est enregistrée en brouillon. Si une version validée existe, elle reste en vigueur jusqu’à la validation du brouillon par une autre personne habilitée ; sinon la version la plus récente s’applique (fonctionnement actuel).</p><div class="ops-form-grid">'+select('Paramètre','key',keys.map(function(k){return[k,k];}),'','required')+textarea('Valeur (JSON)','value','','required rows="6"')+field('Motif','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn secondary">Enregistrer le brouillon</button></div></form>':'';
 var assign=can('profile_assign')?'<form class="card" data-action="profile-assign"><h3>Affecter un profil pilote (rôle et entrepôt)</h3><p class="muted">Le compte doit déjà exister (création par l’administrateur). Branch Manager, General Manager et Finance Manager ne s’attribuent pas ici. Storekeeper, Warehouse Manager et Factory User exigent un entrepôt de rattachement.</p><div class="ops-form-grid">'+select('Compte','user_id',[['','Sélectionner...']].concat(users.filter(function(u){return u.user_id!==(state.permissions||{}).uid;}).map(function(u){return[u.user_id,(u.nom||u.email)+' · '+u.role+(u.warehouse_code?' · '+u.warehouse_code:'')+(u.actif?'':' (inactif)')];})),'','required')+select('Rôle','role',[['','Sélectionner...'],['Storekeeper','Storekeeper (Magasinier)'],['Warehouse Manager','Warehouse Manager'],['Factory User','Factory User'],['QA / Lab','QA / Lab'],['Procurement Officer','Procurement Officer'],['Finance','Finance'],['Viewer / Auditor','Viewer / Auditor'],['Supervisor','Supervisor'],['Assistant Branch Manager','Assistant Branch Manager']],'','required')+select('Entrepôt de rattachement','warehouse_code',[['','Aucun']].concat(state.warehouses.map(function(w){return[w.code,w.code+' - '+w.name];})),'')+field('Motif','reason','text','','required')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Affecter le profil</button></div></form>':'';
 root.innerHTML=head('Paramètres & gouvernance','Chaque paramètre a un statut : brouillon (à valider), validé (décision tracée) ou archivé. Aucune valeur n’est considérée comme validée sans décision explicite.')+
  (errs.length?notice('danger','<b>Données partielles :</b><br>'+errs.map(esc).join('<br>')):'')+
  '<section class="card"><h2>Paramètres WMS</h2>'+table(['Clé','Version','Statut','En vigueur','Valeur','Créé par','Validé par','Action'],rows)+'</section>'+propose+
  '<section class="card"><h2>Documents CCA obligatoires par canal</h2>'+table(['Document','Code','Obligatoire pour','Statut','Validé par'],docRows)+'</section>'+docForm+assign;
}

async function render(){
 if(!root||!sb)return;
 root.innerHTML='<div class="empty">Chargement...</div>';
 await loadBase();
 var isList=await route();
 decorate(isList);
}
function decorate(isList){
 var bar='';
 if(state.scope&&state.scope.scoped){
   bar=notice(state.scope.warehouse_code?'info':'danger',state.scope.warehouse_code?'<b>Périmètre :</b>&nbsp;Warehouse '+esc(state.scope.warehouse_code)+' (rattachement de votre profil). Les listes et les actions sont limitées à cet entrepôt.':'<b>Profil sans Warehouse de rattachement :</b>&nbsp;vos actions Warehouse seront refusées. Demandez au Branch Manager de compléter votre profil.');
 }else if(isList){
   var cur=state.whFilter?whById(state.whFilter):null;
   bar='<form data-action="wh-filter" class="card" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;padding:10px 14px">'+select('Entrepôt affiché','wh',[['','Tous les entrepôts']].concat(state.warehouses.map(function(w){return[w.id,w.code+' - '+w.name];})),state.whFilter||'')+'<button class="btn secondary">Appliquer le filtre</button>'+(cur?'<span class="muted">Filtre actif : '+esc(cur.code)+'</span>':'')+'</form>';
 }
 var errs=(state.loadErrors||[]).length?notice('danger','<b>Certaines données n’ont pas pu être chargées :</b><br>'+state.loadErrors.map(esc).join('<br>')):'';
 if(bar||errs)root.insertAdjacentHTML('afterbegin',bar+errs);
}
async function route(){
 var p=parts(),seg=(location.hash||'#overview').replace(/^#/,'').split('/');
 function scrollToId(idv){setTimeout(function(){var e=document.getElementById(idv);if(e)e.scrollIntoView({behavior:'smooth',block:'start'});},40);}
 if(p.route==='overview'){await overview();return true;}

 if(p.route==='inbound'&&!p.id){inboundList();return true;}
 if(p.route==='inbound'&&seg[1]==='new'){inboundNew();return false;}
 if(p.route==='inbound'&&seg[1]){
   var ir=await fetchRec(decodeURIComponent(seg[1]));
   if(!ir){root.innerHTML=notice('danger','Réception introuvable ou hors de votre périmètre.');return false;}
   await inboundDetail(ir);
   if(seg[2]==='offload')scrollToId('offload-section');
   return false;
 }

 if(p.route==='quality'&&!p.id){qualityList();return true;}
 if(p.route==='quality'&&seg[1]){
   var qr=await fetchRec(decodeURIComponent(seg[1]));
   if(!qr){root.innerHTML=notice('danger','Réception introuvable ou hors de votre périmètre.');return false;}
   await qualityDetail(qr);
   if(seg[2]==='final')scrollToId('quality-final-section');
   if(seg[2]==='release')scrollToId('lot-release-section');
   return false;
 }

 if(p.route==='lots'&&!p.id){lotsList();return true;}
 if(p.route==='lots'&&seg[1]){
   var l=await fetchLot(decodeURIComponent(seg[1]));
   if(!l){root.innerHTML=notice('danger','LOT introuvable ou hors de votre périmètre.');return false;}
   await lotDetail(l);
   if(seg[2]==='allocate')scrollToId('lot-allocation-section');
   return false;
 }

 if(p.route==='bins'&&!p.id){binsList();return true;}
 if(p.route==='bins'&&p.id==='warehouses'){warehouseManage();return false;}
 if(p.route==='bins'&&p.id==='warehouse-new'){warehouseForm(null);return false;}
 if(p.route==='bins'&&p.id.indexOf('warehouse-edit/')===0){warehouseForm(whById(p.id.split('/')[1]));return false;}
 if(p.route==='bins'&&p.id.indexOf('areas/')===0){areasRoute(p.id.split('/')[1]);return false;}
 if(p.route==='bins'&&p.id.indexOf('area-edit/')===0){var ar=state.areas.filter(function(x){return String(x.id)===String(p.id.split('/')[1]);})[0];if(ar)areaEdit(ar);else root.innerHTML=notice('danger','Zone physique introuvable.');return false;}
 if(p.route==='bins'&&p.id==='new'){binNew();return false;}
 if(p.route==='bins'&&p.id){var b=await fetchBin(p.id);if(b)await binDetail(b);else root.innerHTML=notice('danger','BIN introuvable ou hors de votre périmètre.');return false;}

 if(p.route==='drying'&&!p.id){await dryingRoute();return true;}
 if(p.route==='drying'&&p.id.indexOf('new')===0){dryingNew();return false;}
 if(p.route==='drying'&&p.id){state.dryings=await q('wms_dryings','*',function(x){return x.eq('id',p.id).limit(1);});if(state.dryings[0])await dryingDetail(state.dryings[0]);else root.innerHTML=notice('danger','Séchage introuvable.');return false;}
 if(p.route==='bags'&&!p.id){await bagsRoute();return false;}
 if(p.route==='bags'&&p.id==='new'){await bagsRoute();bagNew();return false;}
 if(p.route==='inventory'){await inventoryRoute();return false;}
 if(p.route==='movements'){await movementsRoute();return true;}
 if(p.route==='grn'&&p.id){await grnRoute(p.id);return false;}
 if(p.route==='parameters'){await parametersRoute();return false;}
 if(p.route==='audit'){await auditRoute();return false;}
 await overview();return true;
}

async function submit(ev){
 var f=ev.target.closest('form[data-action]');if(!f)return;ev.preventDefault();var d=formObj(f),a=f.dataset.action,k,r;busy(f,true);
 try{
  if(a==='reception-create'){k=opKey('RECEPTION','NEW');var ps=String(d.procurement_source||'').split('|'),planned=d.planned==='true';r=await rpc('wms_create_reception',{p:{truck:d.truck,supplier_code:d.supplier_code,origin:d.origin,warehouse_id:d.warehouse_id,expected_kg:d.expected_kg,expected_bags:d.expected_bags,arrival_at:d.arrival_at,purchase_type:d.purchase_type,driver:d.driver,transporter:d.transporter,delivery_note_present:d.delivery_note_present==='true',delivery_note:d.delivery_note,procurement_source_type:ps.length>1?ps[0]:null,procurement_source_id:ps.length>1?ps.slice(1).join('|'):null,ad_hoc:!planned,ad_hoc_reason:d.ad_hoc_reason},p_idempotency_key:k.key});doneKey(k);location.hash='#inbound/'+encodeURIComponent(r.id);return;}
  if(a==='offload'){await rpc('wms_record_offload',{p_id:f.dataset.id,p:d});location.hash='#quality/'+encodeURIComponent(f.dataset.id)+'/final';return;}
  if(a==='resolve-rejection'){await rpc('procurement_resolve_rejection',{p_reception_id:f.dataset.id,p_action:d.resolution_action,p_reason:d.resolution_reason});await render();return;}
  if(a==='reception-correct'){await rpc('wms_correct_reception',{p_id:f.dataset.id,p_field:d.field,p_value:d.new_value,p_reason:d.reason,p_approver:d.approver});await render();return;}
  if(a==='quality'){k=opKey('QUALITY-'+f.dataset.type,f.dataset.id);d.idempotency_key=k.key;await rpc('wms_save_quality',{p_reception_id:f.dataset.id,p_type:f.dataset.type,p:d});doneKey(k);if(f.dataset.type==='FINAL'){location.hash='#quality/'+encodeURIComponent(f.dataset.id)+'/release';return;}await render();return;}
  if(a==='warehouse-save'){var payload={id:f.dataset.id||undefined,site_code:d.site_code,code:d.code,name:d.name,location:d.location,capacity_kg:d.capacity_kg,is_factory:d.is_factory==='true',reason:d.reason};await rpc('wms_upsert_warehouse',{p:payload});location.hash='#bins/warehouses';return;}
  if(a==='area-save'){await rpc('wms_upsert_area',{p:{id:f.dataset.id||undefined,warehouse_id:f.dataset.wh,code:d.code,description:d.description,capacity_kg:d.capacity_kg,status:d.status,reason:d.reason}});if(f.dataset.id){location.hash='#bins/areas/'+encodeURIComponent(f.dataset.wh);}else await render();return;}
  if(a==='bin-create'){k=opKey('BIN','NEW');r=await rpc('wms_create_bin',{p:{warehouse_id:d.warehouse_id,physical_area_id:d.physical_area_id,stock_type:d.stock_type,idempotency_key:k.key}});doneKey(k);var bp=null;try{bp=JSON.parse(sessionStorage.getItem('wms_bin_prefill')||'null');}catch(e){}sessionStorage.removeItem('wms_bin_prefill');if(bp&&bp.lot_id){location.hash='#lots/'+encodeURIComponent(bp.lot_id)+'/allocate';return;}location.hash='#bins/'+encodeURIComponent(r.id||'');return;}
  if(a==='allocate'){k=opKey('ALLOCATE',f.dataset.bin);await rpc('wms_allocate_lot_to_bin',{p_lot_id:d.lot_id,p_bin_id:f.dataset.bin,p_qty:Number(d.qty),p_idempotency_key:k.key});doneKey(k);await render();return;}
  if(a==='allocate-lot'){k=opKey('ALLOCATE-LOT',f.dataset.lot);await rpc('wms_allocate_lot_to_bin',{p_lot_id:f.dataset.lot,p_bin_id:d.bin_id,p_qty:Number(d.qty),p_idempotency_key:k.key});doneKey(k);location.hash='#lots/'+encodeURIComponent(f.dataset.lot);return;}
  if(a==='bin-transfer'){k=opKey('BIN-TRANSFER',f.dataset.bin);r=await rpc('wms_bin_transfer',{p_from_bin:f.dataset.bin,p_to_bin:d.to_bin,p_qty:Number(d.qty),p_idempotency_key:k.key,p_reason:d.reason});doneKey(k);alert('Movement posted: '+(r.id||'-'));await render();return;}
  if(a==='inventory-count'){k=opKey('COUNT',f.dataset.bin);await rpc('wms_create_inventory_count',{p_bin_id:f.dataset.bin,p_physical_kg:Number(d.physical_kg),p_note:d.note,p_idempotency_key:k.key});doneKey(k);location.hash='#inventory';return;}
  if(a==='inventory-resolve'){await rpc('wms_resolve_inventory_count',{p_count_id:d.count_id,p_approve:d.approve==='true',p_reason:d.reason});await render();return;}
  if(a==='bin-close'){await rpc('wms_close_bin',{p_bin_id:f.dataset.bin,p_physical_empty:d.physical_empty==='true',p_residue_kg:Number(d.residue_kg||0),p_reason:d.reason});await render();return;}
  if(a==='drying-create'){k=opKey('DRYING','NEW');d.idempotency_key=k.key;await rpc('wms_create_drying',{p:d});doneKey(k);location.hash='#drying';return;}
  if(a==='post-dry-quality'){k=opKey('POST-DRY',f.dataset.drying+'-'+d.lot_id);d.idempotency_key=k.key;await rpc('wms_save_post_dry_quality',{p_drying_id:f.dataset.drying,p_lot_id:d.lot_id,p:d});doneKey(k);await render();return;}
  if(a==='bag-move'){Object.keys(d).forEach(function(x){if(d[x]==='')delete d[x];});if(d.kind!=='RECONDITIONED')delete d.verified;k=opKey('BAG','NEW');d.idempotency_key=k.key;await rpc('wms_bag_move',{p:d});doneKey(k);location.hash='#bags';return;}
  if(a==='doc-record'){var fi=f.querySelector('[name="doc_file"]'),file=fi&&fi.files&&fi.files[0],path=null;
    if(file){if(file.size>10485760)throw new Error('Fichier trop volumineux (10 Mo maximum).');path=f.dataset.id+'/'+d.doc_type+'/'+Date.now()+'-'+file.name.replace(/[^A-Za-z0-9._-]/g,'_');var up=await sb.storage.from('wms-reception-docs').upload(path,file,{upsert:false,contentType:file.type||undefined});if(up.error)throw new Error('Téléversement de la pièce : '+up.error.message);}
    await rpc('wms_record_reception_document',{p_reception_id:f.dataset.id,p_doc_type:d.doc_type,p_status:d.status,p_reference:d.reference||null,p_file_path:path,p_note:d.note||null});await render();return;}
  if(a==='doc-derogation'){await rpc('wms_document_derogation',{p_reception_id:f.dataset.id,p_reason:d.reason});await render();return;}
  if(a==='lot-hold-decision'){if(!d.decision)throw new Error('Choisissez une décision.');if(d.decision==='REJECT'&&!d.reason_code)throw new Error('Motif de rejet obligatoire.');k=opKey('LOT-DECISION',f.dataset.lot);await rpc('wms_decide_hold_lot',{p_lot_id:f.dataset.lot,p_decision:d.decision,p_reason:d.reason,p_reason_code:d.reason_code||null,p_idempotency_key:d.decision==='DEROGATION_RELEASE'?k.key:null});doneKey(k);await render();return;}
  if(a==='hold-bin-place'){k=opKey('HOLD-BIN',f.dataset.lot);await rpc('wms_place_lot_in_hold_bin',{p_lot_id:f.dataset.lot,p_bin_id:d.bin_id,p_qty:Number(d.qty),p_idempotency_key:k.key});doneKey(k);await render();return;}
  if(a==='lot-return'){k=opKey('LOT-RETURN',f.dataset.lot);await rpc('wms_return_rejected_lot',{p_lot_id:f.dataset.lot,p_qty:Number(d.qty),p_reference:d.reference,p_source_bin:d.source_bin||null,p_idempotency_key:k.key});doneKey(k);await render();return;}
  if(a==='mov-filter'){state.movFilter={page:0,from:d.from,to:d.to,lot:d.lot,bin:d.bin,type:d.type,wh:d.wh};await render();return;}
  if(a==='wh-filter'){try{if(d.wh)sessionStorage.setItem('wms-wh-filter',d.wh);else sessionStorage.removeItem('wms-wh-filter');}catch(e){}await render();return;}
  if(a==='param-validate'){await rpc('wms_validate_parameter',{p_id:f.dataset.id,p_reason:d.reason});await render();return;}
  if(a==='param-propose'){var pv;try{pv=JSON.parse(d.value);}catch(e){throw new Error('Valeur JSON invalide : '+e.message);}await rpc('wms_set_parameter',{p_key:d.key,p_value:pv,p_reason:d.reason});await render();return;}
  if(a==='doc-requirement'){var chs=new FormData(f).getAll('channels');await rpc('wms_set_document_requirement',{p_doc_type:d.doc_type,p_mandatory_channels:chs,p_reason:d.reason});await render();return;}
  if(a==='profile-assign'){await rpc('wms_assign_warehouse_profile',{p_user_id:d.user_id,p_role:d.role,p_warehouse_code:d.warehouse_code||null,p_reason:d.reason});await render();return;}
 }catch(e){err(e);}finally{busy(f,false);}
}
async function click(ev){
 var row=ev.target.closest('[data-href]');if(row){location.hash=row.dataset.href;return;}
 var b=ev.target.closest('[data-action-button]');if(!b)return;var a=b.dataset.actionButton,idv=b.dataset.id;b.disabled=true;
 try{
  if(a==='accept'||a==='reject'){
    var c=document.querySelector('[name="decision_comment"]'),txt=c?c.value.trim():'',rc=document.querySelector('[name="rejection_reason_code"]'),code=rc?rc.value:'';
    if(a==='reject'){
      if(!code)throw new Error('Choisissez un motif de refus.');
      var rr=(state.rejectionReasons||[]).filter(function(x){return x.code===code;})[0];
      if(rr&&rr.requires_comment&&!txt)throw new Error('Commentaire obligatoire pour le motif « '+rr.label+' ».');
    }
    await rpc('wms_decide_reception_v2',{p_id:idv,p_accept:a==='accept',p_comment:txt||null,p_reason_code:a==='reject'?code:null});
    location.hash='#inbound/'+encodeURIComponent(idv)+(a==='accept'?'/offload':'');return;
  }
  if(a==='open-doc'){var su=await sb.storage.from('wms-reception-docs').createSignedUrl(b.dataset.path,300);if(su.error)throw new Error(su.error.message);window.open(su.data.signedUrl,'_blank','noopener');return;}
  if(a==='generate-grn'){await rpc('wms_generate_grn',{p_reception_id:idv});location.hash='#grn/'+encodeURIComponent(idv);return;}
  if(a==='print-grn'){window.print();return;}
  if(a==='more-receptions'){state.recLimit=(state.recLimit||200)+200;await render();return;}
  if(a==='mov-page'){state.movFilter=Object.assign({},state.movFilter||{},{page:Number(b.dataset.page||0)});await render();return;}
  if(a==='mov-reset'){state.movFilter={page:0};await render();return;}
  if(a==='mov-export'){await movementsExport();return;}
  if(a==='lot-journal'){state.movFilter={page:0,lot:idv};location.hash='#movements';return;}
  if(a==='release-lot'){var k=opKey('LOT-RELEASE',idv);var released=await rpc('wms_release_lot',{p_reception_id:idv,p_idempotency_key:k.key});doneKey(k);if(released&&released.id){location.hash='#lots/'+encodeURIComponent(released.id)+'/allocate';return;}await render();return;}
  if(a==='hold'||a==='unhold'){var h=document.querySelector('[name="hold_reason"]'),reason=h?h.value:'';if(!reason.trim())throw new Error('Motif obligatoire.');await rpc('wms_set_hold',{p_reception_id:idv,p_hold:a==='hold',p_reason:reason});}
  if(a==='wh-status'){var reason=prompt('Motif du changement de statut :')||'';if(!reason.trim())throw new Error('Motif obligatoire.');await rpc('wms_set_warehouse_status',{p_id:idv,p_status:b.dataset.status,p_reason:reason});}
  if(a==='bin-status'){var br=prompt('Motif de cette action BIN :')||'';if(!br.trim())throw new Error('Motif obligatoire.');await rpc('wms_set_bin_status',{p_bin_id:idv,p_status:b.dataset.status,p_reason:br});}
  if(a==='create-bin-for-lot'){
    sessionStorage.setItem('wms_bin_prefill',JSON.stringify({lot_id:idv,warehouse_id:b.dataset.wh||''}));
    location.hash='#bins/new';return;
  }
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
   if(ev.target.name==='purchase_type'||ev.target.name==='planned')refreshReceptionPlanningUI();
   if(ev.target.name==='supplier_code'){var f=ev.target.closest('form[data-action="reception-create"]'),d=f&&f.querySelector('[name="supplier_code_display"]');if(d)d.value=ev.target.value;}
   if(ev.target.name==='delivery_note_present'){var rf=ev.target.closest('form[data-action="reception-create"]'),dn=rf&&rf.querySelector('[name="delivery_note"]');if(dn){dn.required=ev.target.value==='true';if(ev.target.value!=='true')dn.value='';}}
   if(ev.target.name==='field'){var cf=ev.target.closest('form[data-action="reception-correct"]');if(cf){var cur=cf.querySelector('[name="current_value"]'),map={};try{map=JSON.parse(cf.dataset.current||'{}');}catch(e){}if(cur)cur.value=map[ev.target.value]==null?'':map[ev.target.value];}}
 });
 root.addEventListener('input',function(ev){var f=ev.target.closest('form');if(!f)return;if(f.dataset.action==='offload'&&(ev.target.name==='gross_kg'||ev.target.name==='tare_kg')){var g=Number(f.querySelector('[name="gross_kg"]').value),t=Number(f.querySelector('[name="tare_kg"]').value),nn=f.querySelector('[name="net_kg"]');nn.value=(Number.isFinite(g)&&Number.isFinite(t)&&g>t)?(g-t).toFixed(3):'';}if(f.dataset.action==='procurement-settlement'&&(ev.target.name==='refraction_mode'||ev.target.name==='refraction_value')){var net=Number(f.querySelector('[name="net_snapshot"]').value||0),mode=f.querySelector('[name="refraction_mode"]').value,val=Number(f.querySelector('[name="refraction_value"]').value||0),ref=mode==='KG'?val:mode==='PERCENT'?net*val/100:0,p=f.querySelector('[name="paid_preview"]');p.value=Math.max(0,net-ref).toFixed(3);}});
 root.addEventListener('keydown',function(ev){var row=ev.target.closest('[data-href]');if(row&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();location.hash=row.dataset.href;}});
 global.ANAGROCI_OPS_ROUTE=function(){render().catch(err);};
 await render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){init().catch(err);});else init().catch(err);
})(window);
