(function(){
'use strict';
const URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
const KEY='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
const SB=window.supabase.createClient(URL,KEY);
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c));
const fmt=n=>Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:2});

function injectDashboard(){
  const panel=$('p-control');
  if(!panel||$('traceCompletenessCard'))return false;
  const card=document.createElement('div');
  card.className='card';
  card.id='traceCompletenessCard';
  card.innerHTML='<h2>Complétude de la chaîne 2027</h2><div class="meta" style="margin-bottom:12px">Score opérationnel : Farmer ID → lot terrain → sacs physiques → camion → réception usine → lot RCN usine. La parcelle/GPS reste suivie séparément et non bloquante.</div><div id="traceKpis" class="grid"><div class="empty">Chargement…</div></div><div id="traceIncomplete" class="list" style="margin-top:14px"></div>';
  panel.insertBefore(card,panel.firstChild);
  return true;
}

async function loadDashboard(){
  if(!injectDashboard())return;
  const [d,c]=await Promise.all([
    SB.from('field_traceability_dashboard_v').select('*').single(),
    SB.from('field_traceability_completeness_v').select('achat_id,achat_local_id,farmer_id,producteur_nom,village_nom,poids_net,completeness_score_2027,overall_status,next_action,parcel_trace_status').neq('overall_status','COMPLETE').order('completeness_score_2027',{ascending:true}).limit(100)
  ]);
  const k=$('traceKpis');
  if(d.error){k.innerHTML='<div class="empty">'+esc(d.error.message)+'</div>';return;}
  const x=d.data||{};
  const items=[
    ['Score moyen 2027',fmt(x.average_score_2027)+'%'],
    ['Chaînes complètes',fmt(x.complete_count)+' / '+fmt(x.purchase_count)],
    ['Farmer ID manquant',fmt(x.farmer_missing_count)],
    ['Lots incomplets',fmt(x.lot_incomplete_count)],
    ['Sacs à compléter',fmt(x.bag_incomplete_count)],
    ['Camions à créer',fmt(x.shipment_pending_count)],
    ['Réceptions en attente',fmt(x.reception_pending_count)],
    ['Lots usine à créer',fmt(x.factory_lot_pending_count)],
    ['Parcelles après campagne',fmt(x.parcel_deferred_count)+' (INFO)']
  ];
  k.innerHTML=items.map(i=>'<div class="row"><div class="meta">'+esc(i[0])+'</div><div style="font:700 20px var(--display);color:var(--forest);margin-top:4px">'+esc(i[1])+'</div></div>').join('');
  const box=$('traceIncomplete');
  if(c.error){box.innerHTML='<div class="empty">'+esc(c.error.message)+'</div>';return;}
  const rows=c.data||[];
  box.innerHTML=rows.length?rows.map(r=>'<div class="row"><div class="head"><b>'+esc(r.farmer_id||r.producteur_nom||r.achat_local_id||r.achat_id)+'</b><span class="chip '+(r.overall_status==='ACTION_REQUIRED'?'warn':'dark')+'">'+fmt(r.completeness_score_2027)+'%</span></div><div class="meta">'+esc(r.village_nom||'—')+' · achat '+fmt(r.poids_net)+' kg</div><div class="meta"><b>Prochaine action :</b> '+esc(r.next_action)+'</div>'+(r.parcel_trace_status==='DEFERRED'?'<div class="meta">Parcelle/GPS : À compléter après campagne — non bloquant.</div>':'')+'</div>').join(''):'<div class="empty">Toutes les chaînes opérationnelles 2027 sont complètes.</div>';
}

async function updateBagLotExact(){
  const lotSelect=$('bagLotSelect'),purchaseSelect=$('bagPurchaseSelect'),info=$('bagLotInfo');
  if(!lotSelect||!purchaseSelect)return;
  const lotId=lotSelect.value;
  if(!lotId){purchaseSelect.innerHTML='<option value="">Choisir d’abord un lot</option>';if(info)info.textContent='';return;}
  const [contributors,bags,lot]=await Promise.all([
    SB.from('field_lot_contributors').select('achat_id,qty_kg').eq('lot_id',lotId).eq('status','ACTIVE'),
    SB.from('field_rcn_bags').select('achat_id,net_weight_kg').eq('lot_id',lotId).neq('status','VOID'),
    SB.from('field_lot_bag_control_v').select('*').eq('lot_id',lotId).single()
  ]);
  if(contributors.error||bags.error||lot.error)return;
  const bagByPurchase={};
  (bags.data||[]).forEach(b=>bagByPurchase[b.achat_id]=(bagByPurchase[b.achat_id]||0)+Number(b.net_weight_kg||0));
  const ids=(contributors.data||[]).map(x=>x.achat_id);
  if(!ids.length){purchaseSelect.innerHTML='<option value="">Aucun achat contributeur</option>';return;}
  const purchases=await SB.from('field_traceability_purchase_status_v').select('achat_id,achat_local_id,farmer_id,producteur_nom,poids_net').in('achat_id',ids);
  if(purchases.error)return;
  const qtyByPurchase={};(contributors.data||[]).forEach(x=>qtyByPurchase[x.achat_id]=Number(x.qty_kg||0));
  purchaseSelect.innerHTML='<option value="">Choisir l’achat source du sac</option>'+((purchases.data||[]).map(p=>{
    const allocated=qtyByPurchase[p.achat_id]||0;
    const bagged=bagByPurchase[p.achat_id]||0;
    const remain=Math.max(0,allocated-bagged);
    return '<option value="'+esc(p.achat_id)+'">'+esc((p.farmer_id||p.producteur_nom||p.achat_local_id)+' · reste dans ce lot '+fmt(remain)+' kg')+'</option>';
  }).join(''));
  const l=lot.data||{};
  if(info)info.innerHTML='Lot <b>'+esc(l.lot_code)+'</b> · '+fmt(l.contributor_kg)+' kg composés · '+fmt(l.bag_weight_kg)+' kg en sacs · <b>'+fmt(l.unbagged_kg)+' kg restant(s)</b>';
}

function bindExactBagBalance(){
  const sel=$('bagLotSelect');
  if(!sel)return false;
  sel.onchange=updateBagLotExact;
  return true;
}

function boot(){
  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    const dashboardReady=injectDashboard();
    const bagReady=bindExactBagBalance();
    if(dashboardReady)loadDashboard();
    if((dashboardReady||$('traceCompletenessCard'))&&bagReady){clearInterval(timer);setTimeout(loadDashboard,300);}
    if(tries>30)clearInterval(timer);
  },250);
  document.addEventListener('anagroci:authenticated',()=>setTimeout(loadDashboard,500));
  document.addEventListener('traceability:reconciled',()=>setTimeout(loadDashboard,250));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();