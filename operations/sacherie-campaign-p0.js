/* Sacherie AFLP P0 — extension opérationnelle campagne longue.
   UI FIELD BUYING unique ; backend canonique ops_bag_* + rcn_jute_*.
   Remplace la demande simple par une demande contrôlée sans réécrire field-buying.js. */
(function (global) {
'use strict';
if (global.__ANAGROCI_SACHERIE_CAMPAIGN_P0__) return;
global.__ANAGROCI_SACHERIE_CAMPAIGN_P0__ = true;

var sb = null, baseRoute = null, profile = {}, state = { readiness:null, requests:[], releases:[], rts:[], avances:[], calc:null };
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){return Number(v||0).toLocaleString('fr-FR');}
function uid(prefix){try{return (prefix||'op')+'-'+crypto.randomUUID();}catch(e){return (prefix||'op')+'-'+Date.now()+'-'+Math.random().toString(36).slice(2);}}
function cli(){
  if(sb)return sb;
  if(global.ANAGROCI_SUPABASE_CLIENT){sb=global.ANAGROCI_SUPABASE_CLIENT;return sb;}
  if(global.supabase&&global.ANAGROCI_SUPABASE_URL&&global.ANAGROCI_SUPABASE_ANON){sb=global.supabase.createClient(global.ANAGROCI_SUPABASE_URL,global.ANAGROCI_SUPABASE_ANON);}
  return sb;
}
function waitClient(){return new Promise(function(resolve){var k=0,t=setInterval(function(){var c=cli();if(c||++k>120){clearInterval(t);resolve(c);}},50);});}
function errText(e){return String(e&&e.message||e&&e.details||e||'Opération impossible.');}
function rpc(name,args){return waitClient().then(function(c){if(!c)throw new Error('Client Supabase indisponible');return c.rpc(name,args||{}).then(function(r){if(r.error)throw r.error;return r.data;});});}
function table(name,cols,mod){return waitClient().then(function(c){var q=c.from(name).select(cols||'*');if(mod)q=mod(q);return q.then(function(r){if(r.error)throw r.error;return r.data||[];});});}
function isBags(){return (location.hash||'').replace(/^#/,'').split('/')[0]==='bags';}
function isBM(){return profile.role==='Branch Manager';}
function pill(s){var x=String(s||'');var c=/REJECT|EXPIRE|DISCREPANCY|CANCEL/i.test(x)?'danger':/APPROV|RELEASE|RECEIV|CONFIRM/i.test(x)?'ok':'warn';return '<span class="badge '+c+'">'+esc(x||'—')+'</span>';}

function loadProfile(){return waitClient().then(function(c){return c.auth.getSession().then(function(s){var u=s.data&&s.data.session&&s.data.session.user;if(!u)return null;return c.from('profils').select('nom,role,fonction_operationnelle,cluster,zone,actif').eq('user_id',u.id).maybeSingle().then(function(r){profile=r.data||{};profile.userId=u.id;return profile;});});});}
function loadState(){
  return Promise.all([
    rpc('sacherie_ops_campaign_readiness').catch(function(e){return {ready:false,error:errText(e),checks:{}};}),
    table('ops_bag_requests','id,request_code,cluster,rt_id,source_location_code,destination_location_code,requested_qty,approved_qty,released_qty,received_qty,status,requested_at,approved_at,expires_at,metadata',function(q){return q.eq('channel','AFLP').eq('campaign','2027').order('requested_at',{ascending:false}).limit(100);}),
    table('ops_bag_releases','id,request_id,client_release_id,qty,received_qty,receipt_status,released_at,received_at,source_location_code,destination_location_code,proof_url,receipt_proof_url',function(q){return q.order('released_at',{ascending:false}).limit(150);}).catch(function(){return [];}),
    table('rt_light_v','id,id_rt,nom,cluster,village_nom,deleted',function(q){return q.eq('deleted',false).order('nom',{ascending:true}).limit(500);}),
    table('avances','id,rt_id,rt_nom,cycle_id,cycle_statut,volume_finance_kg,prix_reference_kg,created_at',function(q){return q.eq('cycle_statut','OPEN').order('created_at',{ascending:false}).limit(500);}),
    loadProfile()
  ]).then(function(r){state.readiness=r[0];state.requests=r[1];state.releases=r[2];state.rts=r[3];state.avances=r[4];return state;});
}

function readinessHtml(){var r=state.readiness||{},c=r.checks||{},miss=c.missing_cluster_locations||[];var ok=!!r.ready;
  return '<section class="card" id="sachP0Readiness"><div class="card-head"><div><h2>Readiness campagne Sacherie</h2><p>Contrôle avant opérations réelles.</p></div>'+pill(ok?'READY':'PARTIAL / MISSING')+'</div>'+
    (r.error?'<div class="notice danger">Migration P0 non déployée : '+esc(r.error)+'</div>':'')+
    '<div class="kpi-grid">'+
      '<div class="kpi"><small>Clusters actifs</small><b>'+num(c.active_clusters)+'</b><span>locations '+num(c.cluster_locations)+'</span></div>'+
      '<div class="kpi"><small>RT actifs</small><b>'+num(c.active_rt)+'</b><span>locations '+num(c.rt_locations)+'</span></div>'+
      '<div class="kpi"><small>Enveloppe 2027</small><b>'+num(c.campaign_envelopes)+'</b><span>allocation(s) '+num(c.cluster_allocations)+'</span></div>'+
      '<div class="kpi"><small>Profils opérationnels</small><b>'+num(c.operational_role_profiles)+'</b><span>fonctions terrain configurées</span></div>'+
      '<div class="kpi"><small>Factory</small><b>'+num(c.factory_locations)+'</b><span>location(s)</span></div>'+
    '</div>'+
    (miss.length?'<div class="notice danger"><b>Clusters non initialisés :</b> '+miss.map(function(x){return esc(x.label||x.code);}).join(', ')+'</div>':'')+
    (!ok?'<div class="notice warn"><b>Protection P0 :</b> la campagne n’est pas déclarée READY. Ne pas contourner ces contrôles avec des écritures manuelles.</div>':'')+
  '</section>';
}
function rtName(id){var r=state.rts.find(function(x){return x.id===id;});return r?(r.nom+' · '+(r.cluster||'—')):id;}
function requestRows(){return state.requests.map(function(r){var rem=Math.max(0,Number(r.approved_qty||0)-Number(r.released_qty||0));return '<tr><td class="mono">'+esc(r.request_code)+'</td><td><b>'+esc(rtName(r.rt_id))+'</b></td><td>'+num(r.requested_qty)+'</td><td>'+num(r.approved_qty)+'</td><td>'+num(r.released_qty)+'</td><td>'+num(r.received_qty)+'</td><td>'+pill(r.status)+'</td><td>'+
  ((isBM()&&/REQUESTED|REVIEWED|CONSOLIDATED/.test(r.status))?'<button class="btn secondary" data-sach-decide="'+esc(r.id)+'">Décider</button> ':'')+
  ((/BM_APPROVED|READY_FOR_RELEASE|PARTIALLY_RELEASED/.test(r.status)&&rem>0)?'<button class="btn secondary" data-sach-release="'+esc(r.id)+'">Sortie ('+num(rem)+')</button>':'')+'</td></tr>';}).join('');}
function releaseRows(){return state.releases.map(function(r){var gap=Number(r.qty||0)-Number(r.received_qty||0);return '<tr><td>'+new Date(r.released_at).toLocaleString('fr-FR')+'</td><td class="mono">'+esc(r.client_release_id)+'</td><td>'+num(r.qty)+'</td><td>'+num(r.received_qty)+'</td><td>'+(r.received_at?pill(r.receipt_status):( '<button class="btn secondary" data-sach-receive="'+esc(r.id)+'">Confirmer réception</button>'))+'</td><td>'+(r.received_at&&gap?'<b class="ops-danger-text">-'+num(gap)+'</b>':'—')+'</td></tr>';}).join('');}
function workflowHtml(){return '<section class="card" id="sachP0Workflow"><div class="card-head"><div><h2>Workflow opérationnel P0</h2><p>Demande contrôlée → décision BM → sorties multiples → réception.</p></div><button class="btn primary" id="sachControlledRequest">+ Demande contrôlée</button></div>'+
  '<div class="notice info"><b>Règle :</b> approbation ≠ sortie physique. Une demande peut avoir plusieurs sorties ; chaque sortie doit ensuite être réceptionnée.</div>'+
  '<h3>Demandes campagne 2027</h3><div class="table-wrap"><table><thead><tr><th>Réf.</th><th>RT</th><th>Demandé</th><th>Approuvé</th><th>Sorti</th><th>Reçu</th><th>Statut</th><th>Action</th></tr></thead><tbody>'+requestRows()+'</tbody></table></div>'+
  '<h3 style="margin-top:18px">Sorties / réceptions</h3><div class="table-wrap"><table><thead><tr><th>Sortie</th><th>Clé idempotence</th><th>Remis</th><th>Reçu</th><th>Réception</th><th>Écart</th></tr></thead><tbody>'+releaseRows()+'</tbody></table></div></section>';}
function inject(){if(!isBags())return;var root=document.getElementById('opsRouteView');if(!root)return;var old=document.getElementById('sachP0');if(old)old.remove();var host=document.createElement('div');host.id='sachP0';host.innerHTML=readinessHtml()+workflowHtml();var firstCard=root.querySelector('.card');if(firstCard)root.insertBefore(host,firstCard);else root.appendChild(host);bind();}

function modal(title,body){var old=document.getElementById('sachP0Modal');if(old)old.remove();var m=document.createElement('div');m.id='sachP0Modal';m.innerHTML='<section class="card" style="position:fixed;z-index:9999;left:5%;right:5%;top:8%;max-height:84vh;overflow:auto;box-shadow:0 20px 80px rgba(0,0,0,.28)"><div class="card-head"><div><h2>'+esc(title)+'</h2></div><button class="btn secondary" id="sachCloseModal">Fermer</button></div>'+body+'</section>';document.body.appendChild(m);m.querySelector('#sachCloseModal').onclick=function(){m.remove();};return m;}
function openRequest(){var r=state.readiness||{};if(!r.ready){alert('Readiness campagne non conforme. Initialisez d’abord enveloppe, allocations, locations et rôles opérationnels.');return;}
  var rtOpts=state.rts.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.nom+' · '+(x.cluster||'—'))+'</option>';}).join('');
  var m=modal('Nouvelle demande RT contrôlée','<div class="ops-form-grid"><div class="ops-field"><label>RT</label><select id="sp_rt"><option value="">Choisir…</option>'+rtOpts+'</select></div><div class="ops-field"><label>Cycle financé ouvert</label><select id="sp_cycle"><option value="">Choisir le RT</option></select></div><div class="ops-field"><label>Stock RCN physique vérifié (kg)</label><input id="sp_stock" type="number" min="0"></div><div class="ops-field"><label>Quantité demandée (sacs)</label><input id="sp_qty" type="number" min="1"></div></div><div id="sp_calc" class="notice info">Le plafond doit être calculé par le serveur avant soumission.</div><div class="ops-actions"><button class="btn secondary" id="sp_calc_btn">Calculer plafond</button><button class="btn primary" id="sp_submit" disabled>Soumettre</button></div>');
  var rt=m.querySelector('#sp_rt'),cy=m.querySelector('#sp_cycle'),box=m.querySelector('#sp_calc'),submit=m.querySelector('#sp_submit');
  rt.onchange=function(){var list=state.avances.filter(function(a){return a.rt_id===rt.value&&a.cycle_id;});cy.innerHTML='<option value="">Choisir…</option>'+list.map(function(a){return '<option value="'+esc(a.cycle_id)+'">'+esc(a.cycle_id)+' · '+num(a.volume_finance_kg)+' kg</option>';}).join('');state.calc=null;submit.disabled=true;};
  m.querySelector('#sp_calc_btn').onclick=function(){var stock=Number(m.querySelector('#sp_stock').value);if(!rt.value||!cy.value||!isFinite(stock)||stock<0){box.className='notice danger';box.textContent='RT, cycle et stock physique sont obligatoires.';return;}rpc('sacherie_calculer_plafond',{p_rt_id:rt.value,p_cycle_id:cy.value,p_stock_rcn_kg:stock}).then(function(x){state.calc=x;box.className='notice ok';box.innerHTML='<b>Plafond serveur :</b> '+num(x.system_max_bags)+' · déjà détenus '+num(x.bags_already_held)+' · réservés '+num(x.reserved_approved_bags)+' · encore disponible <b>'+num(x.max_new_available)+'</b> · stock cluster '+num(x.cluster_stock);submit.disabled=false;}).catch(function(e){box.className='notice danger';box.textContent=errText(e);submit.disabled=true;});};
  submit.onclick=function(){var qty=Math.round(Number(m.querySelector('#sp_qty').value));if(!state.calc||!(qty>0)||qty>Number(state.calc.max_new_available||0)){box.className='notice danger';box.textContent='Quantité invalide ou supérieure au plafond.';return;}submit.disabled=true;rpc('sacherie_ops_create_request',{p_client_request_id:uid('bagreq'),p_rt_id:rt.value,p_cycle_id:cy.value,p_stock_rcn_kg:Number(m.querySelector('#sp_stock').value),p_requested_qty:qty}).then(function(){m.remove();refresh();}).catch(function(e){submit.disabled=false;box.className='notice danger';box.textContent=errText(e);});};
}
function decide(id){var r=state.requests.find(function(x){return x.id===id;});if(!r)return;var qty=Number(prompt('Quantité à approuver (demandé '+r.requested_qty+')',String(r.requested_qty)));if(!isFinite(qty)||qty<=0)return;var comment=prompt('Commentaire (facultatif si approbation)','')||'';rpc('sacherie_ops_decide_request',{p_request_id:id,p_action:'APPROVE',p_approved_qty:Math.round(qty),p_comment:comment||null}).then(refresh).catch(function(e){alert(errText(e));});}
function release(id){var r=state.requests.find(function(x){return x.id===id;});if(!r)return;var rem=Math.max(0,Number(r.approved_qty||0)-Number(r.released_qty||0));var qty=Number(prompt('Quantité à sortir. Reliquat autorisé : '+rem,String(rem)));if(!isFinite(qty)||qty<=0)return;var proof=prompt('URL preuve (facultatif)','')||null;var note=prompt('Note de sortie (facultatif)','')||null;rpc('ops_release_bags',{p_request_id:id,p_client_release_id:uid('release'),p_source_location:r.source_location_code,p_destination_location:r.destination_location_code,p_qty:Math.round(qty),p_proof_url:proof,p_note:note}).then(refresh).catch(function(e){alert(errText(e));});}
function receive(id){var r=state.releases.find(function(x){return x.id===id;});if(!r)return;var qty=Number(prompt('Quantité réellement reçue. Sortie : '+r.qty,String(r.qty)));if(!isFinite(qty)||qty<0)return;var note=qty===Number(r.qty)?'':(prompt('Écart détecté. Motif / commentaire obligatoire','')||'');if(qty!==Number(r.qty)&&!note){alert('Un motif est obligatoire en cas d’écart.');return;}var proof=prompt('URL preuve de réception (facultatif)','')||null;rpc('sacherie_ops_receive_release',{p_release_id:id,p_received_qty:Math.round(qty),p_note:note||null,p_proof_url:proof}).then(refresh).catch(function(e){alert(errText(e));});}
function bind(){var b=document.getElementById('sachControlledRequest');if(b)b.onclick=openRequest;document.querySelectorAll('[data-sach-decide]').forEach(function(x){x.onclick=function(){decide(x.dataset.sachDecide);};});document.querySelectorAll('[data-sach-release]').forEach(function(x){x.onclick=function(){release(x.dataset.sachRelease);};});document.querySelectorAll('[data-sach-receive]').forEach(function(x){x.onclick=function(){receive(x.dataset.sachReceive);};});}
function refresh(){return loadState().then(inject).catch(function(e){var root=document.getElementById('opsRouteView');if(root&&isBags()){var h=document.getElementById('sachP0')||document.createElement('div');h.id='sachP0';h.innerHTML='<div class="notice danger"><b>Sacherie P0 :</b> '+esc(errText(e))+'</div>';if(!h.parentNode)root.prepend(h);}});}
function enhance(){if(!isBags())return Promise.resolve();return refresh();}
function boot(){if(!global.ANAGROCI_FB||!global.ANAGROCI_OPS_ROUTE)return false;baseRoute=global.ANAGROCI_OPS_ROUTE;global.ANAGROCI_FB.openBagRequest=openRequest;global.ANAGROCI_OPS_ROUTE=function(){var p=baseRoute.apply(this,arguments);return Promise.resolve(p).then(function(x){setTimeout(enhance,0);return x;});};enhance();return true;}
var k=0,t=setInterval(function(){if(boot()||++k>120)clearInterval(t);},50);
})(window);
