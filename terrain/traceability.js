(function(){
'use strict';
const URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
const KEY='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
const SB=window.supabase.createClient(URL,KEY);
let PURCHASES=[],LOTS=[],SHIPMENTS=[];
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:2});
function show(id,text,kind){const e=$(id);if(!e)return;e.className='msg show '+(kind||'ok');e.textContent=text;}
function clearMsg(id){const e=$(id);if(e){e.className='msg';e.textContent='';}}
function code(prefix){return prefix+'-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+String(Date.now()).slice(-6);}
function wireTabs(){document.querySelectorAll('.tab').forEach(b=>{b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));document.querySelectorAll('.panel').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('p-'+b.dataset.p).classList.add('on');};});}
async function loadPurchases(){
  const r=await SB.from('field_traceability_purchase_status_v').select('*').order('achat_date',{ascending:false}).limit(500);
  if(r.error){show('lotMsg',r.error.message,'err');return;}
  PURCHASES=r.data||[];
  const opts=['<option value="">Choisir un achat</option>'];
  PURCHASES.forEach(p=>{
    const remain=Math.max(0,Number(p.poids_net||0)-Number(p.lot_allocated_kg||0));
    const disabled=!p.producteur_id||remain<=0;
    opts.push('<option '+(disabled?'disabled ':'')+'value="'+esc(p.achat_id)+'">'+esc((p.farmer_id||p.producteur_nom||'Sans Farmer ID')+' · '+(p.village_nom||'—')+' · reste '+fmt(remain)+' kg')+'</option>');
  });
  $('purchaseSelect').innerHTML=opts.join('');
}
function updatePurchase(){
  const p=PURCHASES.find(x=>x.achat_id===$('purchaseSelect').value);
  if(!p){$('purchaseInfo').textContent='';return;}
  const remain=Math.max(0,Number(p.poids_net||0)-Number(p.lot_allocated_kg||0));
  $('lotQty').value=remain||'';
  $('scopeLabel').value=p.village_nom||p.cluster||'';
  $('lotCode').value=code('LOT');
  $('purchaseInfo').innerHTML='Parcelle : <b>'+(p.parcel_trace_status==='DEFERRED'?'À compléter après campagne':esc(p.parcel_trace_status))+'</b> · Achat '+fmt(p.poids_net)+' kg · Déjà en lot '+fmt(p.lot_allocated_kg)+' kg';
}
async function createLot(){
  clearMsg('lotMsg');
  const p=PURCHASES.find(x=>x.achat_id===$('purchaseSelect').value);
  const qty=Number($('lotQty').value),lotCode=$('lotCode').value.trim().toUpperCase(),label=$('scopeLabel').value.trim();
  if(!p||!(qty>0)||!lotCode||!label)return show('lotMsg','Achat, quantité, code lot et origine sont requis.','err');
  const remaining=Math.max(0,Number(p.poids_net||0)-Number(p.lot_allocated_kg||0));
  if(qty>remaining+0.01)return show('lotMsg','Quantité supérieure au solde disponible de cet achat.','err');
  const ins=await SB.from('field_lots').insert({lot_code:lotCode,scope_type:$('scopeType').value,scope_id:$('scopeType').value==='VILLAGE'?p.village_id:null,scope_label:label,status:'FORMING'}).select('id').single();
  if(ins.error)return show('lotMsg',ins.error.message,'err');
  const c=await SB.from('field_lot_contributors').insert({lot_id:ins.data.id,achat_id:p.achat_id,qty_kg:qty});
  if(c.error){await SB.from('field_lots').update({status:'CANCELLED',notes:'Création contributeur échouée: '+c.error.message}).eq('id',ins.data.id);return show('lotMsg',c.error.message,'err');}
  const seal=await SB.from('field_lots').update({status:'SEALED',sealed_at:new Date().toISOString()}).eq('id',ins.data.id);
  if(seal.error)return show('lotMsg',seal.error.message,'err');
  show('lotMsg','Lot créé et achat rattaché. La parcelle peut rester différée en 2027.','ok');
  await refreshAll();
}
async function loadLots(){
  const r=await SB.from('field_lots').select('id,lot_code,scope_label,status,created_at').neq('status','CANCELLED').order('created_at',{ascending:false}).limit(300);
  if(r.error){show('shipMsg',r.error.message,'err');return;}
  LOTS=r.data||[];
  $('lotSelect').innerHTML='<option value="">Choisir un lot</option>'+LOTS.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.lot_code+' · '+l.scope_label+' · '+l.status)+'</option>').join('');
  if(!$('shipmentCode').value)$('shipmentCode').value=code('SHP');
}
async function updateLot(){
  const id=$('lotSelect').value;if(!id)return;
  const r=await SB.from('field_lot_contributors').select('qty_kg').eq('lot_id',id).eq('status','ACTIVE');
  if(r.error)return show('shipMsg',r.error.message,'err');
  const total=(r.data||[]).reduce((s,x)=>s+Number(x.qty_kg||0),0);
  $('shipQty').value=total||'';
  const l=LOTS.find(x=>x.id===id);if(l)$('originLabel').value=l.scope_label||'';
}
async function createShipment(){
  clearMsg('shipMsg');
  const lot=$('lotSelect').value,qty=Number($('shipQty').value),scode=$('shipmentCode').value.trim().toUpperCase();
  const origin=$('originLabel').value.trim(),dest=$('destinationLabel').value.trim(),plate=$('vehiclePlate').value.trim().toUpperCase();
  if(!lot||!(qty>0)||!scode||!origin||!dest||!plate)return show('shipMsg','Lot, quantité, code expédition, origine, destination et camion sont requis.','err');
  const s=await SB.from('field_shipments').insert({shipment_code:scode,origin_type:'WAREHOUSE',origin_label:origin,destination_type:'FACTORY',destination_label:dest,vehicle_plate:plate,driver_name:$('driverName').value.trim()||null,planned_qty_kg:qty,dispatched_qty_kg:qty,status:'DISPATCHED',departed_at:new Date().toISOString()}).select('id').single();
  if(s.error)return show('shipMsg',s.error.message,'err');
  const sl=await SB.from('field_shipment_lots').insert({shipment_id:s.data.id,lot_id:lot,planned_qty_kg:qty,loaded_qty_kg:qty});
  if(sl.error){await SB.from('field_shipments').update({status:'CANCELLED',notes:'Rattachement lot échoué: '+sl.error.message}).eq('id',s.data.id);return show('shipMsg',sl.error.message,'err');}
  await SB.from('field_lots').update({status:'IN_TRANSIT'}).eq('id',lot);
  show('shipMsg','Expédition créée. Le camion est maintenant traçable jusqu’à Yamoussoukro.','ok');
  $('shipmentCode').value=code('SHP');
  await refreshAll();
}
async function loadReceive(){
  const s=await SB.from('field_shipments').select('id,shipment_code,vehicle_plate,origin_label,dispatched_qty_kg,status,created_at').eq('status','DISPATCHED').order('created_at',{ascending:false}).limit(300);
  if(s.error){show('receiveMsg',s.error.message,'err');return;}
  SHIPMENTS=s.data||[];
  $('shipmentSelect').innerHTML='<option value="">Choisir une expédition</option>'+SHIPMENTS.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.shipment_code+' · '+(x.vehicle_plate||'—')+' · '+fmt(x.dispatched_qty_kg)+' kg')+'</option>').join('');
  const r=await SB.from('rcn_receptions').select('id,camion,origine,arrivee_at,poids_annonce,ref_doc,etat').order('arrivee_at',{ascending:false}).limit(200);
  if(r.error){show('receiveMsg','Réceptions RCN indisponibles : '+r.error.message,'err');return;}
  $('receptionSelect').innerHTML='<option value="">Choisir une réception</option>'+((r.data||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.id+' · '+(x.camion||'—')+' · '+fmt(x.poids_annonce)+' kg')+'</option>').join(''));
}
function updateShipment(){const s=SHIPMENTS.find(x=>x.id===$('shipmentSelect').value);$('receivedQty').value=s?Number(s.dispatched_qty_kg||0):'';}
async function bindReception(){
  clearMsg('receiveMsg');
  const sid=$('shipmentSelect').value,rid=$('receptionSelect').value,qty=Number($('receivedQty').value);
  if(!sid||!rid||!(qty>=0))return show('receiveMsg','Expédition, réception et quantité reçue sont requises.','err');
  const u=await SB.from('field_shipments').update({received_qty_kg:qty,status:'RECEIVED',arrived_at:new Date().toISOString(),reception_id:rid}).eq('id',sid);
  if(u.error)return show('receiveMsg',u.error.message,'err');
  const links=await SB.from('field_shipment_lots').select('id,lot_id,loaded_qty_kg').eq('shipment_id',sid);
  if(links.error)return show('receiveMsg',links.error.message,'err');
  const rows=links.data||[],loaded=rows.reduce((s,x)=>s+Number(x.loaded_qty_kg||0),0);
  for(const x of rows){
    const share=loaded>0?qty*Number(x.loaded_qty_kg||0)/loaded:0;
    const lu=await SB.from('field_shipment_lots').update({received_qty_kg:share}).eq('id',x.id);
    if(lu.error)return show('receiveMsg',lu.error.message,'err');
    await SB.from('field_lots').update({status:'RECEIVED'}).eq('id',x.lot_id);
  }
  show('receiveMsg','Réception usine rattachée. La chaîne terrain → usine est fermée pour cette expédition.','ok');
  await refreshAll();
}
async function search(){
  const q=$('q').value.trim();show('searchMsg','Recherche en cours…','ok');
  const r=await SB.rpc('field_traceability_search',{p_query:q});
  if(r.error)return show('searchMsg',r.error.message,'err');
  clearMsg('searchMsg');
  const data=r.data||[];
  if(!data.length){$('results').innerHTML='<div class="empty">Aucun résultat.</div>';return;}
  $('results').innerHTML=data.map(x=>{
    const bags=Array.isArray(x.bags)?x.bags:[],plots=Array.isArray(x.plot_sources)?x.plot_sources:[];
    return '<div class="row"><div class="head"><b>'+esc(x.farmer_id||x.producteur_nom||'Producteur non régularisé')+'</b><span class="mono">'+fmt(x.achat_poids_net_kg)+' kg</span></div><div class="meta">'+esc(((x.producteur_nom||'')+' '+(x.producteur_prenoms||'')).trim())+' · Achat '+esc(x.achat_local_id||x.achat_id||'—')+'</div><div class="chips"><span class="chip '+(plots.length?'':'warn')+'">'+(plots.length?plots.length+' parcelle(s)':'Parcelle après campagne')+'</span><span class="chip '+(x.lot_code?'':'warn')+'">'+esc(x.lot_code||'Lot non créé')+'</span><span class="chip '+(x.shipment_code?'dark':'warn')+'">'+esc(x.shipment_code||'Camion non affecté')+'</span><span class="chip">'+bags.length+' sac(s) identifié(s)</span></div><div class="chain"><div class="node"><small>Producteur</small><b>'+esc(x.farmer_id||'—')+'</b></div><div class="node"><small>Achat</small><b>'+esc(x.achat_local_id||String(x.achat_id||'—').slice(0,12))+'</b></div><div class="node"><small>Lot terrain</small><b>'+esc(x.lot_code||'En attente')+'</b></div><div class="node"><small>Camion</small><b>'+esc(x.vehicle_plate||'En attente')+'</b></div><div class="node"><small>Réception usine</small><b>'+esc(x.reception_id||'En attente')+'</b></div><div class="node"><small>Lot usine</small><b>'+esc(x.factory_lot_id||'En attente')+'</b></div></div></div>';
  }).join('');
}
async function refreshAll(){await Promise.all([loadPurchases(),loadLots(),loadReceive()]);}
function wire(){
  wireTabs();
  $('purchaseSelect').onchange=updatePurchase;
  $('createLotBtn').onclick=createLot;
  $('lotSelect').onchange=updateLot;
  $('createShipmentBtn').onclick=createShipment;
  $('shipmentSelect').onchange=updateShipment;
  $('bindReceptionBtn').onclick=bindReception;
  $('searchBtn').onclick=search;
  $('q').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
  document.addEventListener('anagroci:authenticated',()=>setTimeout(refreshAll,250));
  setTimeout(refreshAll,700);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();
