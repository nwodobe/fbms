/* Sacherie AFLP P1 — poste de travail opérationnel longue campagne.
   Complète le P0 sans créer de registre parallèle. */
(function (global) {
'use strict';

var root, baseRoute = global.ANAGROCI_OPS_ROUTE, sb = null;
var BUCKET = 'rcn-jute-proofs';
var NET_DRAFT = 'fb_sacherie_p1_network_draft';
var TR_DRAFT = 'fb_sacherie_p1_transfer_draft';

function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function n(v){var x=Number(v||0);return isFinite(x)?x:0;}
function num(v){return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(n(v));}
function dt(v){if(!v)return '—';try{return new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch(e){return String(v);}}
function uid(prefix){return (prefix||'op')+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);}
function parts(){return (location.hash||'#overview').slice(1).split('/').map(function(x){try{return decodeURIComponent(x);}catch(e){return x;}});}
function client(){
  if(sb)return Promise.resolve(sb);
  if(!global.supabase||!global.ANAGROCI_SUPABASE_URL||!global.ANAGROCI_SUPABASE_ANON)return Promise.reject(new Error('Supabase indisponible'));
  sb=global.supabase.createClient(global.ANAGROCI_SUPABASE_URL,global.ANAGROCI_SUPABASE_ANON,{auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
  return Promise.resolve(sb);
}
function q(table,cols,mod){return client().then(function(c){var r=c.from(table).select(cols||'*');if(mod)r=mod(r);return r.then(function(x){if(x.error)throw new Error(x.error.message);return x.data||[];});});}
function rpc(name,args){return client().then(function(c){return c.rpc(name,args).then(function(r){if(r.error)throw new Error(r.error.message);return r.data;});});}
function paint(html){root=document.getElementById('opsRouteView');if(root)root.innerHTML=html;}
function card(title,body,actions){return '<section class="card"><div class="card-head"><div><h2>'+esc(title)+'</h2></div>'+(actions?'<div class="ops-route-actions">'+actions+'</div>':'')+'</div>'+body+'</section>';}
function table(headers,rows){if(!rows.length)return '<div class="ops-empty">Aucune donnée.</div>';return '<div class="table-wrap"><table><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
function notice(kind,msg){return '<div class="notice '+(kind||'info')+'">'+msg+'</div>';}
function badge(v){var s=String(v||'—'),u=s.toUpperCase(),c=/CLOS|RECU|OK|CONFIRM|READY/.test(u)?'ok':/ECART|HOLD|ATTENT|EXPED|PART/.test(u)?'warn':/ERREUR|PERTE|BLOQ/.test(u)?'danger':'info';return '<span class="badge '+c+'">'+esc(s)+'</span>';}
function tabs(active){
  var ts=[['pilotage','Pilotage','#bags'],['requests','Demandes & sorties','#bags/requests'],['network','Réseau terrain','#bags/network'],['transfers','Transferts','#bags/transfers'],['history','Historique','#bags/history'],['closure','Clôture','#bags/closure']];
  return '<div class="ops-passport-tabs ops-sacherie-tabs">'+ts.map(function(t){return '<a class="'+(active===t[0]?'active':'')+'" href="'+t[2]+'">'+t[1]+'</a>';}).join('')+'</div>';
}
function shell(title,sub,active,body,actions){paint('<div class="ops-route-head"><div><h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p></div><div class="ops-route-actions">'+(actions||'')+'</div></div>'+tabs(active)+body);}
function draftGet(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(e){return null;}}
function draftSet(key,obj){try{localStorage.setItem(key,JSON.stringify(obj));}catch(e){}}
function draftClear(key){try{localStorage.removeItem(key);}catch(e){}}
function values(ids){var o={};ids.forEach(function(id){var e=document.getElementById(id);if(e)o[id]=e.value;});return o;}
function applyValues(o){if(!o)return;Object.keys(o).forEach(function(id){var e=document.getElementById(id);if(e&&o[id]!=null)e.value=o[id];});}
function opt(rows,value,label){return rows.map(function(x){return '<option value="'+esc(value(x))+'">'+esc(label(x))+'</option>';}).join('');}
function uploadProof(file,prefix){
  if(!file)return Promise.resolve(null);
  if(file.size>5*1024*1024)return Promise.reject(new Error('Photo trop lourde : maximum 5 Mo'));
  return client().then(function(c){return c.auth.getSession().then(function(s){var u=s.data&&s.data.session&&s.data.session.user;if(!u)throw new Error('Session requise');var ext=(file.name.split('.').pop()||'jpg').toLowerCase();var path=u.id+'/p1/'+(prefix||'preuve')+'-'+Date.now().toString(36)+'.'+ext;return c.storage.from(BUCKET).upload(path,file,{contentType:file.type||'image/jpeg',upsert:false}).then(function(r){if(r.error)throw new Error(r.error.message);return path;});});});
}

function decorateBase(active){
  root=document.getElementById('opsRouteView');if(!root)return;
  var old=root.querySelector('.ops-sacherie-tabs');if(old)old.remove();
  var head=root.querySelector('.ops-route-head');if(head)head.insertAdjacentHTML('afterend',tabs(active));
  if(active==='requests'){
    var hs=[].slice.call(root.querySelectorAll('h2'));var target=hs.filter(function(h){return /Demandes & workflow/i.test(h.textContent);})[0];if(target)setTimeout(function(){target.scrollIntoView({block:'start'});},50);
  }
}

function renderNetwork(){
  shell('Sacherie AFLP','Mouvements RT ↔ Producteur ↔ Cluster / Hub.','network','<div class="empty">Chargement du réseau…</div>');
  return Promise.all([
    q('aflp_clusters','code,label,active',function(r){return r.eq('active',true).order('label');}),
    q('rt_light_v','id,nom,cluster,deleted',function(r){return r.eq('deleted',false).order('nom');}),
    q('producteurs','id,nom,prenoms,rt_id,village_nom,deleted',function(r){return r.eq('deleted',false).order('nom').limit(1500);}),
    q('sacherie_ct_rt_stock','rt_id,rt_nom,cluster,total_sous_responsabilite,vides,pleins,dechires,a_reparer,derniere_activite',function(r){return r.order('cluster').limit(500);})
  ]).then(function(rs){
    var clusters=rs[0],rts=rs[1],farmers=rs[2],stock=rs[3],d=draftGet(NET_DRAFT)||{};
    var form='<form id="p1NetForm"><div class="ops-form-grid">'+
      '<div class="ops-field"><label>Flux *</label><select id="p1_flow"><option value="RT_TO_PRODUCTEUR">RT → Producteur · sacs vides</option><option value="PRODUCTEUR_TO_RT">Producteur → RT · retour vides</option><option value="RT_TO_CLUSTER">RT → Cluster · retour vides</option><option value="PRODUCTEUR_TO_HUB_FULL">Producteur → Hub · sacs pleins</option></select></div>'+
      '<div class="ops-field"><label>Cluster *</label><select id="p1_cluster"><option value="">Choisir…</option>'+opt(clusters,function(x){return x.code;},function(x){return x.label;})+'</select></div>'+
      '<div class="ops-field"><label>RT *</label><select id="p1_rt"><option value="">Choisir…</option></select></div>'+
      '<div class="ops-field"><label>Producteur</label><select id="p1_prod"><option value="">Choisir…</option></select></div>'+
      '<div class="ops-field"><label>Quantité *</label><input id="p1_qty" type="number" min="1" required></div>'+
      '<div class="ops-field"><label>Réceptionnaire</label><input id="p1_receiver" placeholder="Nom de la personne qui reçoit"></div>'+
      '<div class="ops-field ops-span-2"><label>Observation</label><input id="p1_note" placeholder="Motif, état, contexte…"></div>'+
      '<div class="ops-field ops-span-2"><label>Preuve photo</label><input id="p1_proof" type="file" accept="image/*" capture="environment"></div></div>'+
      '<div class="ops-actions"><button class="btn primary" type="submit">Enregistrer le mouvement</button><button class="btn secondary" type="button" id="p1ClearNet">Effacer brouillon</button></div><div id="p1NetMsg" class="muted"></div></form>';
    var rows=stock.slice(0,100).map(function(s){return '<tr><td>'+esc(s.cluster||'—')+'</td><td><b>'+esc(s.rt_nom||s.rt_id)+'</b></td><td>'+num(s.total_sous_responsabilite)+'</td><td>'+num(s.vides)+'</td><td>'+num(s.pleins)+'</td><td>'+num(s.dechires)+'</td><td>'+num(s.a_reparer)+'</td><td>'+dt(s.derniere_activite)+'</td></tr>';});
    shell('Sacherie AFLP','Mouvements RT ↔ Producteur ↔ Cluster / Hub.','network',
      notice('info','<b>Terrain :</b> le formulaire conserve un brouillon local tant que le serveur n’a pas confirmé l’opération.')+
      card('Nouveau mouvement terrain',form)+card('RT Bag Account',table(['Cluster','RT','Responsabilité','Vides','Pleins','Déchirés','À réparer','Dernière activité'],rows)));

    var ids=['p1_flow','p1_cluster','p1_rt','p1_prod','p1_qty','p1_receiver','p1_note'];
    function fillRt(){var cl=document.getElementById('p1_cluster').value,sel=document.getElementById('p1_rt'),cur=sel.value;sel.innerHTML='<option value="">Choisir…</option>'+opt(rts.filter(function(x){return !cl||String(x.cluster||'').toUpperCase().indexOf(String(cl).toUpperCase())>=0||String(cl).toUpperCase().indexOf(String(x.cluster||'').toUpperCase())>=0;}),function(x){return x.id;},function(x){return x.nom+' · '+(x.cluster||'');});if(cur)sel.value=cur;fillProd();}
    function fillProd(){var rid=document.getElementById('p1_rt').value,sel=document.getElementById('p1_prod'),cur=sel.value;sel.innerHTML='<option value="">Choisir…</option>'+opt(farmers.filter(function(x){return !rid||x.rt_id===rid;}),function(x){return x.id;},function(x){return (x.nom||'')+' '+(x.prenoms||'')+' · '+(x.village_nom||'');});if(cur)sel.value=cur;}
    applyValues(d.values);fillRt();applyValues(d.values);fillProd();applyValues(d.values);
    ids.forEach(function(id){var e=document.getElementById(id);if(e)e.addEventListener('change',function(){draftSet(NET_DRAFT,{operation_id:d.operation_id||uid('net'),values:values(ids)});});});
    document.getElementById('p1_cluster').addEventListener('change',fillRt);document.getElementById('p1_rt').addEventListener('change',fillProd);
    document.getElementById('p1ClearNet').onclick=function(){draftClear(NET_DRAFT);renderNetwork();};
    document.getElementById('p1NetForm').onsubmit=function(e){e.preventDefault();var msg=document.getElementById('p1NetMsg'),v=values(ids),flow=v.p1_flow,needsProd=/PRODUCTEUR/.test(flow);if(!v.p1_cluster||!v.p1_rt||!v.p1_qty||(needsProd&&!v.p1_prod)){msg.className='ops-danger-text';msg.textContent='Cluster, RT, quantité et producteur si applicable sont obligatoires.';return;}var draft=draftGet(NET_DRAFT)||{},op=draft.operation_id||uid('net'),file=document.getElementById('p1_proof').files[0];msg.className='muted';msg.textContent='Enregistrement…';uploadProof(file,'reseau').then(function(path){return rpc('sacherie_ops_network_move',{p_client_operation_id:op,p_flow:flow,p_cluster:v.p1_cluster,p_rt_id:v.p1_rt,p_producteur_id:v.p1_prod||null,p_qty:Number(v.p1_qty),p_receiver_name:v.p1_receiver||null,p_note:v.p1_note||null,p_proof_url:path});}).then(function(){draftClear(NET_DRAFT);msg.className='notice ok';msg.textContent='Mouvement enregistré dans le registre canonique.';setTimeout(renderNetwork,500);}).catch(function(err){draftSet(NET_DRAFT,{operation_id:op,values:v});msg.className='ops-danger-text';msg.textContent=err.message;});};
  }).catch(function(e){shell('Sacherie AFLP','Réseau terrain','network',notice('danger','<b>Erreur :</b> '+esc(e.message)));});
}

function renderTransfers(){
  shell('Sacherie AFLP','Transferts entre emplacements avec transit et réception partielle.','transfers','<div class="empty">Chargement…</div>');
  return Promise.all([
    q('rcn_jute_locations','code,nom,scope_type,cluster,actif',function(r){return r.eq('actif',true).order('nom').limit(500);}),
    q('rcn_jute_transfers','id,from_location,to_location,state,qty_sent,qty_received,vehicle,driver,document_ref,statut,sent_at,received_at,ecart,motif_ecart,proof_url',function(r){return r.order('created_at',{ascending:false}).limit(150);})
  ]).then(function(rs){var locs=rs[0].filter(function(x){return x.code!=='JUTE-TRANSIT';}),trs=rs[1],d=draftGet(TR_DRAFT)||{};
    var form='<form id="p1TrForm"><div class="ops-form-grid">'+
      '<div class="ops-field"><label>Origine *</label><select id="tr_from"><option value="">Choisir…</option>'+opt(locs,function(x){return x.code;},function(x){return x.nom+' · '+(x.cluster||x.scope_type||'');})+'</select></div>'+
      '<div class="ops-field"><label>Destination *</label><select id="tr_to"><option value="">Choisir…</option>'+opt(locs,function(x){return x.code;},function(x){return x.nom+' · '+(x.cluster||x.scope_type||'');})+'</select></div>'+
      '<div class="ops-field"><label>État *</label><select id="tr_state"><option>UTILISABLE</option><option>PLEIN</option><option>DECHIRE</option><option>A_REPARER</option><option>REPARE</option></select></div>'+
      '<div class="ops-field"><label>Quantité *</label><input id="tr_qty" type="number" min="1" required></div>'+
      '<div class="ops-field"><label>Véhicule</label><input id="tr_vehicle"></div><div class="ops-field"><label>Chauffeur</label><input id="tr_driver"></div>'+
      '<div class="ops-field"><label>Document *</label><input id="tr_doc" required placeholder="BL / bordereau"></div><div class="ops-field"><label>Preuve</label><input id="tr_proof" type="file" accept="image/*" capture="environment"></div>'+
      '<div class="ops-field ops-span-2"><label>Note</label><input id="tr_note"></div></div><div class="ops-actions"><button class="btn primary" type="submit">Expédier</button><button class="btn secondary" type="button" id="trClear">Effacer brouillon</button></div><div id="trMsg" class="muted"></div></form>';
    var rows=trs.map(function(t){var remain=n(t.qty_sent)-n(t.qty_received);var receive=remain>0&&t.statut!=='CLOS'&&t.statut!=='ANNULE'?'<button class="btn secondary" type="button" data-receive="'+esc(t.id)+'" data-remain="'+remain+'">Réceptionner</button>':'—';return '<tr><td class="mono">'+esc(t.document_ref||t.id)+'</td><td>'+esc(t.from_location)+' → '+esc(t.to_location)+'</td><td>'+esc(t.state)+'</td><td>'+num(t.qty_sent)+'</td><td>'+num(t.qty_received)+'</td><td>'+(t.ecart!=null?num(t.ecart):'—')+'</td><td>'+badge(t.statut)+'</td><td>'+esc(t.vehicle||'—')+'<br>'+esc(t.driver||'—')+'</td><td>'+receive+'</td></tr>';});
    shell('Sacherie AFLP','Transferts entre emplacements avec transit et réception partielle.','transfers',notice('info','<b>Principe :</b> expédition = EN_TRANSIT. Le stock n’arrive à destination qu’après confirmation de réception.')+card('Nouveau transfert',form)+card('Transferts',table(['Référence','Trajet','État','Envoyé','Reçu','Écart','Statut','Transport','Action'],rows)));
    var ids=['tr_from','tr_to','tr_state','tr_qty','tr_vehicle','tr_driver','tr_doc','tr_note'];applyValues(d.values);ids.forEach(function(id){var e=document.getElementById(id);if(e)e.addEventListener('change',function(){draftSet(TR_DRAFT,{operation_id:d.operation_id||uid('tr'),values:values(ids)});});});
    document.getElementById('trClear').onclick=function(){draftClear(TR_DRAFT);renderTransfers();};
    document.getElementById('p1TrForm').onsubmit=function(e){e.preventDefault();var v=values(ids),msg=document.getElementById('trMsg');if(!v.tr_from||!v.tr_to||!v.tr_qty||!v.tr_doc){msg.className='ops-danger-text';msg.textContent='Origine, destination, quantité et document sont obligatoires.';return;}var dr=draftGet(TR_DRAFT)||{},op=dr.operation_id||uid('tr'),file=document.getElementById('tr_proof').files[0];msg.textContent='Expédition…';uploadProof(file,'transfert').then(function(path){return rpc('sacherie_ops_create_transfer',{p_client_operation_id:op,p_from_location:v.tr_from,p_to_location:v.tr_to,p_state:v.tr_state,p_qty:Number(v.tr_qty),p_vehicle:v.tr_vehicle||null,p_driver:v.tr_driver||null,p_document_ref:v.tr_doc,p_proof_url:path,p_note:v.tr_note||null});}).then(function(){draftClear(TR_DRAFT);msg.className='notice ok';msg.textContent='Transfert expédié et placé EN_TRANSIT.';setTimeout(renderTransfers,500);}).catch(function(err){draftSet(TR_DRAFT,{operation_id:op,values:v});msg.className='ops-danger-text';msg.textContent=err.message;});};
    [].slice.call(document.querySelectorAll('[data-receive]')).forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-receive'),remain=Number(b.getAttribute('data-remain')),qty=Number(prompt('Quantité reçue maintenant (reste '+remain+') :',String(remain)));if(!qty||qty<1)return;var motif=qty<remain?(prompt('Motif de réception partielle :')||''):'';if(qty<remain&&!motif)return alert('Motif obligatoire.');var doc=prompt('Référence réception / BL :')||'';rpc('sacherie_ops_receive_transfer',{p_client_operation_id:uid('recv'),p_transfer_id:id,p_qty:qty,p_motif:motif||null,p_document_ref:doc||null,p_proof_url:null}).then(function(){renderTransfers();}).catch(function(err){alert(err.message);});};});
  }).catch(function(e){shell('Sacherie AFLP','Transferts','transfers',notice('danger','<b>Erreur :</b> '+esc(e.message)));});
}

function renderHistory(){
  shell('Sacherie AFLP','Journal borné des mouvements du registre canonique.','history','<div class="empty">Chargement…</div>');
  return q('rcn_jute_movements','id,event_key,movement_type,qty,from_location,to_location,from_state,to_state,cluster,rt_id,producteur_id,reference,note,proof_url,movement_at,source_type',function(r){return r.eq('ledger','INTERNE').order('movement_at',{ascending:false}).limit(300);}).then(function(rows){
    var body='<div class="ops-form-grid"><div class="ops-field"><label>Recherche</label><input id="histQ" placeholder="RT, producteur, référence, lieu…"></div><div class="ops-field"><label>Type</label><select id="histType"><option value="">Tous</option><option>TRANSFERT</option><option>CLASSEMENT</option><option>PERTE_APPROUVEE</option></select></div></div><div id="histRows"></div>';
    shell('Sacherie AFLP','Journal borné des 300 derniers mouvements du registre canonique.','history',card('Historique & traçabilité',body));
    function draw(){var qv=(document.getElementById('histQ').value||'').toLowerCase(),typ=document.getElementById('histType').value;var list=rows.filter(function(x){var txt=[x.event_key,x.reference,x.from_location,x.to_location,x.cluster,x.rt_id,x.producteur_id,x.note,x.source_type].join(' ').toLowerCase();return (!qv||txt.indexOf(qv)>=0)&&(!typ||x.movement_type===typ);});document.getElementById('histRows').innerHTML=table(['Date','Type','Quantité','Origine → Destination','État','Cluster','RT','Producteur','Référence'],list.map(function(x){return '<tr><td>'+dt(x.movement_at)+'</td><td>'+badge(x.movement_type)+'</td><td>'+num(x.qty)+'</td><td class="mono">'+esc(x.from_location||'—')+' → '+esc(x.to_location||'—')+'</td><td>'+esc(x.from_state||'—')+' → '+esc(x.to_state||'—')+'</td><td>'+esc(x.cluster||'—')+'</td><td class="mono">'+esc(x.rt_id||'—')+'</td><td class="mono">'+esc(x.producteur_id||'—')+'</td><td>'+esc(x.reference||'—')+'</td></tr>'; }));}
    document.getElementById('histQ').oninput=draw;document.getElementById('histType').onchange=draw;draw();
  }).catch(function(e){shell('Sacherie AFLP','Historique','history',notice('danger','<b>Erreur :</b> '+esc(e.message)));});
}

function renderClosure(){
  shell('Sacherie AFLP','Vérifie si un cluster ou la campagne peut être clôturé sans reliquat caché.','closure','<div class="empty">Calcul…</div>');
  return Promise.all([q('aflp_clusters','code,label,active',function(r){return r.eq('active',true).order('label');}),rpc('sacherie_ops_closure_readiness',{p_scope:'CAMPAIGN',p_code:null}).catch(function(){return null;})]).then(function(rs){var clusters=rs[0],camp=rs[1];return Promise.all(clusters.map(function(c){return rpc('sacherie_ops_closure_readiness',{p_scope:'CLUSTER',p_code:c.code}).then(function(x){x.label=c.label;return x;}).catch(function(){return {code:c.code,label:c.label,error:true};});})).then(function(cr){var crow=camp?[['Campagne 2027',camp]]:[];var rows=crow.concat(cr.map(function(x){return [x.label||x.code,x];})).map(function(pair){var x=pair[1];if(x.error)return '<tr><td><b>'+esc(pair[0])+'</b></td><td>'+badge('INDISPONIBLE')+'</td><td colspan="5">RPC P1 non déployé</td></tr>';return '<tr><td><b>'+esc(pair[0])+'</b></td><td>'+badge(x.ready?'READY':'BLOCKED')+'</td><td>'+num(x.stock_residual)+'</td><td>'+num(x.open_requests)+'</td><td>'+num(x.open_transfers)+'</td><td>'+num(x.pending_losses)+'</td><td>'+num(x.inventory_holds)+'</td></tr>';});shell('Sacherie AFLP','Clôture contrôlée : aucun stock, transfert, demande, perte ou inventaire HOLD ne doit rester ouvert.','closure',notice('warn','<b>À VALIDER MÉTIER :</b> cette page vérifie la capacité de clôture mais ne clôt pas automatiquement la campagne.')+card('Readiness de clôture',table(['Périmètre','État','Stock résiduel','Demandes ouvertes','Transferts ouverts','Pertes à décider','Inventaires HOLD'],rows),'')+card('Initialisation technique','<p>Crée uniquement les emplacements techniques manquants (clusters + transit). Aucun volume de sacs n’est inventé.</p>','<button class="btn secondary" id="ensureLoc">Initialiser emplacements</button>'));var b=document.getElementById('ensureLoc');if(b)b.onclick=function(){if(!confirm('Créer les emplacements techniques manquants sans modifier les volumes ?'))return;rpc('sacherie_ops_ensure_locations',{}).then(function(){renderClosure();}).catch(function(e){alert(e.message);});};});});
}

function route(){
  var p=parts();if(p[0]!=='bags')return baseRoute?baseRoute():Promise.resolve();var sub=p[1]||'pilotage';
  if(sub==='network')return renderNetwork();if(sub==='transfers')return renderTransfers();if(sub==='history')return renderHistory();if(sub==='closure')return renderClosure();
  return Promise.resolve(baseRoute?baseRoute():null).then(function(){decorateBase(sub==='requests'?'requests':'pilotage');});
}

if(baseRoute){global.ANAGROCI_OPS_ROUTE=route;if(global.ANAGROCI_FB)global.ANAGROCI_FB.render=route;}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){var p=parts();if(p[0]==='bags'&&p[1])route();});
global.addEventListener('hashchange',function(){var p=parts();if(p[0]==='bags'&&['network','transfers','history','closure','requests'].indexOf(p[1])>=0)route();});

})(window);
