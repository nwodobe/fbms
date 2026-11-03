(function(){
'use strict';
const URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
const KEY='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
const SB=window.supabase.createClient(URL,KEY);
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c));
const fmt=n=>Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:2});
let QUEUE=[];
function msg(id,text,kind='ok'){const e=$(id);if(!e)return;e.className='msg show '+kind;e.textContent=text;}
function clear(id){const e=$(id);if(e){e.className='msg';e.textContent='';}}
function injectUI(){
  if(!$('varianceReason')){
    const grid=$('p-receive')?.querySelector('.grid');
    if(grid){const d=document.createElement('div');d.className='field';d.innerHTML='<label>Motif écart de poids <span class="opt">(obligatoire si différence)</span></label><input id="varianceReason" placeholder="Ex. perte humidité, pesée, sac endommagé">';grid.appendChild(d);}
    const actions=$('p-receive')?.querySelector('.actions');
    if(actions){const n=document.createElement('div');n.className='meta';n.style.marginTop='10px';n.textContent='E2E-4 : le calcul et la répartition des poids sont contrôlés côté serveur. Un poids reçu supérieur au poids expédié est bloqué pour investigation.';actions.parentNode.insertBefore(n,actions);}
  }
  if(!$('p-control')){
    const tabs=document.querySelector('.tabs');
    const btn=document.createElement('button');btn.className='tab';btn.dataset.p='control';btn.textContent='Contrôle & alertes';tabs.appendChild(btn);
    const panel=document.createElement('section');panel.id='p-control';panel.className='panel';
    panel.innerHTML='<div class="card"><h2>File de réconciliation usine</h2><div id="reconcileMsg" class="msg"></div><div id="reconcileList" class="list"><div class="empty">Chargement…</div></div></div><div class="card"><h2>Alertes de rupture de chaîne</h2><div class="meta" style="margin-bottom:10px">HIGH = action immédiate · MEDIUM = contrôle opérationnel · INFO = suivi non bloquant.</div><div id="alertList" class="list"><div class="empty">Chargement…</div></div></div>';
    document.querySelector('main.wrap').appendChild(panel);
    btn.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));document.querySelectorAll('.panel').forEach(x=>x.classList.remove('on'));btn.classList.add('on');panel.classList.add('on');loadControl();};
  }
}
async function enhancedBindReception(){
  clear('receiveMsg');
  const sid=$('shipmentSelect')?.value,rid=$('receptionSelect')?.value,qty=Number($('receivedQty')?.value),reason=$('varianceReason')?.value.trim()||null;
  if(!sid||!rid||!(qty>=0))return msg('receiveMsg','Expédition, réception et quantité reçue sont requises.','err');
  const attach=await SB.from('field_shipments').update({reception_id:rid,arrived_at:new Date().toISOString()}).eq('id',sid);
  if(attach.error)return msg('receiveMsg',attach.error.message,'err');
  const r=await SB.rpc('field_reconcile_shipment',{p_shipment_id:sid,p_received_qty_kg:qty,p_reason:reason});
  if(r.error)return msg('receiveMsg',r.error.message,'err');
  const out=r.data||{};
  const variance=Number(out.variance_kg||0);
  msg('receiveMsg','Réception réconciliée côté serveur · envoyé '+fmt(out.sent_kg)+' kg · reçu '+fmt(out.received_kg)+' kg · écart '+fmt(variance)+' kg.','ok');
  if($('varianceReason'))$('varianceReason').value='';
  document.dispatchEvent(new CustomEvent('traceability:reconciled',{detail:out}));
  setTimeout(()=>location.reload(),700);
}
async function loadControl(){
  const [q,a]=await Promise.all([
    SB.from('field_reconciliation_queue_v').select('*').order('created_at',{ascending:false}).limit(300),
    SB.from('field_traceability_alerts_v').select('*').order('created_at',{ascending:false}).limit(500)
  ]);
  if(q.error)msg('reconcileMsg',q.error.message,'err');else{QUEUE=q.data||[];renderQueue();}
  if(a.error){$('alertList').innerHTML='<div class="empty">'+esc(a.error.message)+'</div>';}else renderAlerts(a.data||[]);
}
function renderQueue(){
  const box=$('reconcileList');if(!box)return;
  const rows=QUEUE.filter(x=>x.reconciliation_status!=='BALANCED');
  if(!rows.length){box.innerHTML='<div class="empty">Aucune réconciliation en attente.</div>';return;}
  box.innerHTML=rows.map(x=>{
    const status=x.reconciliation_status||'—';
    const can=!!x.reception_id && status==='TO_RECONCILE';
    return '<div class="row"><div class="head"><b>'+esc(x.shipment_code)+'</b><span class="chip '+(status==='TO_RECONCILE'?'warn':'dark')+'">'+esc(status)+'</span></div><div class="meta">'+esc(x.origin_label)+' → '+esc(x.destination_label)+' · camion '+esc(x.vehicle_plate||'—')+' · envoyé '+fmt(x.dispatched_qty_kg)+' kg · reçu '+fmt(x.received_qty_kg)+' kg</div>'+(x.reception_id?'<div class="meta">Réception '+esc(x.reception_id)+(x.factory_lot_id?' · Lot usine '+esc(x.factory_lot_id):' · Lot usine à créer')+'</div>':'<div class="meta">Réception usine à rattacher.</div>')+(can?'<div class="grid" style="margin-top:10px"><div class="field"><label>Poids reçu final (kg)</label><input id="rq-'+esc(x.shipment_id)+'" type="number" min="0" step="0.01" value="'+esc(x.received_qty_kg??x.dispatched_qty_kg)+'"></div><div class="field"><label>Motif de l’écart</label><input id="rr-'+esc(x.shipment_id)+'" value="'+esc(x.variance_reason||'')+'" placeholder="Motif obligatoire si écart"></div></div><div class="actions"><button class="btn" data-reconcile="'+esc(x.shipment_id)+'">Réconcilier</button></div>':'')+'</div>';
  }).join('');
  box.querySelectorAll('[data-reconcile]').forEach(b=>b.onclick=()=>reconcileExisting(b.dataset.reconcile));
}
async function reconcileExisting(id){
  clear('reconcileMsg');
  const qty=Number($('rq-'+id)?.value),reason=$('rr-'+id)?.value.trim()||null;
  if(!(qty>=0))return msg('reconcileMsg','Poids reçu invalide.','err');
  const r=await SB.rpc('field_reconcile_shipment',{p_shipment_id:id,p_received_qty_kg:qty,p_reason:reason});
  if(r.error)return msg('reconcileMsg',r.error.message,'err');
  msg('reconcileMsg','Réconciliation enregistrée côté serveur.','ok');
  await loadControl();
}
function renderAlerts(rows){
  const box=$('alertList');if(!box)return;
  if(!rows.length){box.innerHTML='<div class="empty">Aucune alerte active.</div>';return;}
  box.innerHTML=rows.map(x=>{
    const cls=x.severity==='HIGH'?'warn':(x.severity==='INFO'?'dark':'');
    return '<div class="row"><div class="head"><b>'+esc(x.reference||x.alert_type)+'</b><span class="chip '+cls+'">'+esc(x.severity)+'</span></div><div class="meta">'+esc(x.message)+'</div><div class="meta"><b>Action :</b> '+esc(x.action_required)+'</div></div>';
  }).join('');
}
function wire(){
  injectUI();
  const btn=$('bindReceptionBtn');if(btn)btn.onclick=enhancedBindReception;
  document.addEventListener('anagroci:authenticated',()=>setTimeout(loadControl,350));
  document.addEventListener('traceability:reconciled',()=>setTimeout(loadControl,100));
  setTimeout(loadControl,950);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();

(function(){
  if(document.querySelector('script[data-e2e5-completeness]'))return;
  const s=document.createElement('script');
  s.src='traceability-completeness.js?v=e2e5';
  s.defer=true;
  s.dataset.e2e5Completeness='1';
  document.head.appendChild(s);
})();
