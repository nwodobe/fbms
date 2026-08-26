(function(){
'use strict';
const URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
const KEY='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
const SB=window.supabase.createClient(URL,KEY);
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c));
const fmt=n=>Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:2});
const code=p=>p+'-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+String(Date.now()).slice(-6);
let LOTS=[], PURCHASES=[], BALANCES=[], MOVEMENTS=[];
function msg(id,text,kind='ok'){const e=$(id);if(!e)return;e.className='msg show '+kind;e.textContent=text;}
function clear(id){const e=$(id);if(e){e.className='msg';e.textContent='';}}
async function loadData(){
  const [lots,purchases,balances,moves]=await Promise.all([
    SB.from('field_lot_bag_control_v').select('*').order('created_at',{ascending:false}).limit(400),
    SB.from('field_traceability_purchase_status_v').select('achat_id,achat_local_id,farmer_id,producteur_nom,village_nom,poids_net,lot_allocated_kg,rcn_bag_count,rcn_bag_weight_kg').order('achat_date',{ascending:false}).limit(500),
    SB.from('field_stock_balance_v').select('*').limit(1000),
    SB.from('field_stock_movements').select('id,movement_code,lot_id,movement_type,from_type,from_label,to_type,to_label,qty_sent_kg,qty_received_kg,status,departed_at,received_at,variance_reason,document_ref,created_at').order('created_at',{ascending:false}).limit(300)
  ]);
  if(lots.error)return msg('physicalMsg',lots.error.message,'err');
  if(purchases.error)return msg('physicalMsg',purchases.error.message,'err');
  if(balances.error)return msg('stockMsg',balances.error.message,'err');
  if(moves.error)return msg('stockMsg',moves.error.message,'err');
  LOTS=lots.data||[];PURCHASES=purchases.data||[];BALANCES=balances.data||[];MOVEMENTS=moves.data||[];
  renderBagSelectors();renderStockSelectors();renderControls();
}
function renderBagSelectors(){
  const ls=$('bagLotSelect');if(!ls)return;
  ls.innerHTML='<option value="">Choisir un lot</option>'+LOTS.filter(l=>l.lot_status!=='CANCELLED').map(l=>'<option value="'+esc(l.lot_id)+'">'+esc(l.lot_code+' · '+l.scope_label+' · '+fmt(l.unbagged_kg)+' kg non identifiés')+'</option>').join('');
  if(!$('bagCode').value)$('bagCode').value=code('BAG');
}
async function updateBagLot(){
  const lot=LOTS.find(x=>x.lot_id===$('bagLotSelect').value),sel=$('bagPurchaseSelect');
  if(!lot){sel.innerHTML='<option value="">Choisir d’abord un lot</option>';$('bagLotInfo').textContent='';return;}
  const c=await SB.from('field_lot_contributors').select('achat_id,qty_kg').eq('lot_id',lot.lot_id).eq('status','ACTIVE');
  if(c.error)return msg('physicalMsg',c.error.message,'err');
  const ids=(c.data||[]).map(x=>x.achat_id),map={};(c.data||[]).forEach(x=>map[x.achat_id]=Number(x.qty_kg||0));
  const rows=PURCHASES.filter(p=>ids.includes(p.achat_id));
  sel.innerHTML='<option value="">Choisir l’achat source du sac</option>'+rows.map(p=>{
    const remain=Math.max(0,Math.min(map[p.achat_id]||0,Number(p.poids_net||0))-Number(p.rcn_bag_weight_kg||0));
    return '<option value="'+esc(p.achat_id)+'">'+esc((p.farmer_id||p.producteur_nom||p.achat_local_id)+' · reste sacifiable '+fmt(remain)+' kg')+'</option>';
  }).join('');
  $('bagLotInfo').innerHTML='Lot <b>'+esc(lot.lot_code)+'</b> · '+fmt(lot.contributor_kg)+' kg composés · '+lot.bag_count+' sac(s) identifiés · <b>'+fmt(lot.unbagged_kg)+' kg restant(s)</b>';
}
async function addBag(){
  clear('physicalMsg');
  const lotId=$('bagLotSelect').value,achatId=$('bagPurchaseSelect').value,bagCode=$('bagCode').value.trim().toUpperCase(),seal=$('bagSeal').value.trim().toUpperCase(),weight=Number($('bagWeight').value);
  if(!lotId||!achatId||!bagCode||!(weight>0))return msg('physicalMsg','Lot, achat source, code sac et poids sont requis.','err');
  if(weight<40||weight>120)return msg('physicalMsg','Le poids d’un sac rempli doit être compris entre 40 et 120 kg.','err');
  const r=await SB.from('field_rcn_bags').insert({bag_code:bagCode,seal_number:seal||null,achat_id:achatId,lot_id:lotId,net_weight_kg:weight,status:'IN_LOT'});
  if(r.error)return msg('physicalMsg',r.error.message,'err');
  msg('physicalMsg','Sac RCN identifié et rattaché au producteur, à l’achat et au lot.');
  $('bagCode').value=code('BAG');$('bagSeal').value='';$('bagWeight').value='';await loadData();
}
function renderStockSelectors(){
  const sel=$('stockLotSelect');if(!sel)return;
  sel.innerHTML='<option value="">Choisir un lot</option>'+LOTS.filter(l=>l.lot_status!=='CANCELLED').map(l=>'<option value="'+esc(l.lot_id)+'">'+esc(l.lot_code+' · '+l.scope_label)+'</option>').join('');
  if(!$('movementCode').value)$('movementCode').value=code('MOV');
}
function updateStockLot(){
  const id=$('stockLotSelect').value,lot=LOTS.find(x=>x.lot_id===id),rows=BALANCES.filter(x=>x.lot_id===id);
  $('stockBalanceList').innerHTML=rows.length?rows.map(x=>'<div class="row"><div class="head"><b>'+esc(x.location_label)+'</b><span class="mono">'+fmt(x.balance_kg)+' kg</span></div><div class="meta">'+esc(x.location_type)+'</div></div>').join(''):'<div class="empty">Aucun stock disponible pour ce lot.</div>';
  if(lot&&rows.length){const source=rows.sort((a,b)=>Number(b.balance_kg)-Number(a.balance_kg))[0];$('fromType').value=source.location_type;$('fromLabel').value=source.location_label;$('moveQty').value=Number(source.balance_kg)||'';}
}
function movementType(from,to){if(from==='VILLAGE'&&to==='WAREHOUSE')return'VILLAGE_TO_WAREHOUSE';if(from==='WAREHOUSE'&&to==='WAREHOUSE')return'WAREHOUSE_TO_WAREHOUSE';if(from==='WAREHOUSE'&&to==='FACTORY')return'WAREHOUSE_TO_FACTORY';if(to==='FACTORY')return'FACTORY_RECEIPT';return'ADJUSTMENT';}
async function dispatchStock(){
  clear('stockMsg');
  const lotId=$('stockLotSelect').value,fromType=$('fromType').value,fromLabel=$('fromLabel').value.trim(),toType=$('toType').value,toLabel=$('toLabel').value.trim(),qty=Number($('moveQty').value),mcode=$('movementCode').value.trim().toUpperCase(),doc=$('moveDoc').value.trim();
  if(!lotId||!fromLabel||!toLabel||!(qty>0)||!mcode)return msg('stockMsg','Lot, origine, destination, quantité et code mouvement sont requis.','err');
  const r=await SB.from('field_stock_movements').insert({movement_code:mcode,lot_id:lotId,movement_type:movementType(fromType,toType),from_type:fromType,from_label:fromLabel,to_type:toType,to_label:toLabel,qty_sent_kg:qty,status:'DISPATCHED',departed_at:new Date().toISOString(),document_ref:doc||null});
  if(r.error)return msg('stockMsg',r.error.message,'err');
  msg('stockMsg','Mouvement expédié. Le stock de départ a été décrémenté et la réception reste à confirmer.');$('movementCode').value=code('MOV');await loadData();
}
function renderControls(){
  const box=$('movementList');if(!box)return;
  const open=MOVEMENTS.filter(m=>m.status==='DISPATCHED');
  box.innerHTML=open.length?open.map(m=>'<div class="row"><div class="head"><b>'+esc(m.movement_code)+'</b><span class="mono">'+fmt(m.qty_sent_kg)+' kg</span></div><div class="meta">'+esc(m.from_label)+' → '+esc(m.to_label)+' · '+esc(m.movement_type)+'</div><div class="grid" style="margin-top:10px"><div class="field"><label>Poids reçu (kg)</label><input id="recv-'+esc(m.id)+'" type="number" min="0" step="0.01" value="'+esc(m.qty_sent_kg)+'"></div><div class="field"><label>Motif écart (si différence)</label><input id="reason-'+esc(m.id)+'" placeholder="Ex. perte humidité / pesée"></div></div><div class="actions"><button class="btn" data-receive="'+esc(m.id)+'">Confirmer réception</button></div></div>').join(''):'<div class="empty">Aucun mouvement en attente de réception.</div>';
  box.querySelectorAll('[data-receive]').forEach(b=>b.onclick=()=>receiveStock(b.dataset.receive));
}
async function receiveStock(id){
  clear('stockMsg');const m=MOVEMENTS.find(x=>x.id===id),qty=Number($('recv-'+id).value),reason=$('reason-'+id).value.trim();if(!m||!(qty>=0))return;
  if(Math.abs(Number(m.qty_sent_kg)-qty)>0.01&&!reason)return msg('stockMsg','Un motif est obligatoire lorsqu’il y a un écart de poids.','err');
  const r=await SB.from('field_stock_movements').update({qty_received_kg:qty,status:'RECEIVED',received_at:new Date().toISOString(),variance_reason:reason||null}).eq('id',id);
  if(r.error)return msg('stockMsg',r.error.message,'err');
  msg('stockMsg','Réception confirmée. Le stock de destination est maintenant mis à jour.');await loadData();
}
function wire(){
  if(!$('bagLotSelect'))return;
  $('bagLotSelect').onchange=updateBagLot;$('addBagBtn').onclick=addBag;$('stockLotSelect').onchange=updateStockLot;$('dispatchStockBtn').onclick=dispatchStock;
  document.addEventListener('anagroci:authenticated',()=>setTimeout(loadData,300));setTimeout(loadData,850);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();

(function(){
  if(document.querySelector('script[data-e2e4-reconciliation]'))return;
  const s=document.createElement('script');
  s.src='traceability-reconciliation.js?v=e2e4';
  s.defer=true;
  s.dataset.e2e4Reconciliation='1';
  document.head.appendChild(s);
})();
