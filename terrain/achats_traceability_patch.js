(function(){
  'use strict';
  var SB=null;
  var URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
  var KEY='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function mount(){
    if(document.getElementById('e2eTraceBanner')) return;
    var panel=document.getElementById('panel_saisie'); if(!panel) return;
    var box=document.createElement('div');
    box.id='e2eTraceBanner';
    box.style.cssText='margin:0 0 18px;padding:14px 16px;border:1px solid #bfe3b6;border-radius:10px;background:#f3faf1;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    box.innerHTML='<div style="flex:1;min-width:260px"><b style="color:#053B23">Traçabilité E2E activée</b><div style="font-size:12.5px;color:#5f6d63;margin-top:3px">En 2027, la parcelle GPS peut rester <b>à compléter après campagne</b>. Elle ne bloque pas l’achat. Le suivi continue par Producteur → Achat → Lot → Camion → Usine.</div><div id="e2eTraceStats" style="font-size:12px;color:#00712C;margin-top:6px">Chargement du statut…</div></div><a href="traceability.html" style="text-decoration:none;background:#053B23;color:#fff;border-radius:8px;padding:9px 13px;font-size:12.5px;font-weight:700">Ouvrir Traceability 360</a>';
    panel.insertBefore(box,panel.firstChild);
  }
  async function refresh(){
    mount(); var el=document.getElementById('e2eTraceStats'); if(!el||!SB) return;
    try{
      var r=await SB.from('field_traceability_purchase_status_v').select('parcel_trace_status,lot_count,rcn_bag_count').order('created_at',{ascending:false}).limit(200);
      if(r.error){el.textContent='Statut disponible après synchronisation.';return;}
      var a=r.data||[], deferred=0, allocated=0, inLot=0;
      a.forEach(function(x){if(x.parcel_trace_status==='DEFERRED')deferred++;if(x.parcel_trace_status==='ALLOCATED')allocated++;if((x.lot_count||0)>0)inLot++;});
      el.innerHTML=esc(String(a.length))+' achats suivis · '+esc(String(deferred))+' parcelles différées · '+esc(String(allocated))+' parcelles rattachées · '+esc(String(inLot))+' achats déjà en lot';
    }catch(e){el.textContent='Statut disponible après synchronisation.';}
  }
  function init(){
    mount();
    if(!window.supabase||!window.supabase.createClient) return setTimeout(init,200);
    SB=window.supabase.createClient(URL,KEY); refresh();
    document.addEventListener('anagroci:authenticated',function(){setTimeout(refresh,250);});
    window.addEventListener('online',refresh);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
