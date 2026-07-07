(function(){
  'use strict';
  var SUPABASE_URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
  var SUPABASE_ANON='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
  var sb=null, villages=[], rtCache={}, prodCache={}, userId=null;
  function $(id){return document.getElementById(id);}
  function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();}
  function keyc(s){return norm(s).replace(/[^A-Z0-9]/g,'');}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function up(s){return String(s||'').trim().toUpperCase();}
  function rtName(r){return (r.nom||(r.data&&(r.data.nom||r.data.rt||r.data.nomComplet))||r.village_nom||'').trim();}
  function rtText(r){var name=rtName(r);return up((r.id_rt? r.id_rt+' - ':'')+name+(r._source==='census'?' (RECENSEMENT)':''));}
  function prodName(p){return (p.nom||(p.data&&(p.data.nom||p.data.nomComplet||p.data.prenomNom))||'').trim();}
  function prodText(p){var name=prodName(p);return up((p.code? p.code+' - ':'')+name);}
  function prodValue(p){return up((p.code? p.code+' - ':'')+(prodName(p)||p.code||''));}
  function replaceInputWithSelect(id, placeholder){
    var old=$(id); if(!old || old.tagName==='SELECT') return $(id);
    var sel=document.createElement('select'); sel.id=id; sel.className=old.className||'';
    sel.innerHTML='<option value="">'+esc(placeholder)+'</option>';
    old.parentNode.replaceChild(sel,old); return sel;
  }
  function ensureDom(){
    var rt=replaceInputWithSelect('f_rt','Choisir un RT du village');
    var prod=replaceInputWithSelect('f_prod','Choisir un producteur du village');
    if(prod && !$('f_prod_free')){
      var inp=document.createElement('input'); inp.id='f_prod_free'; inp.className='up'; inp.placeholder='Nom producteur non enrôlé'; inp.style.display='none'; inp.style.marginTop='8px';
      prod.parentNode.insertBefore(inp, prod.nextSibling);
      inp.addEventListener('input',function(){setFreeProducerValue(this.value);});
    }
    if(rt && !$('rtDropdownHelp')){var h=document.createElement('div');h.id='rtDropdownHelp';h.style.cssText='font-size:12px;color:#6B6458;margin-top:5px';h.textContent='La liste se charge selon le village sélectionné.';rt.parentNode.appendChild(h);}
    if(prod && !$('prodDropdownHelp')){var hp=document.createElement('div');hp.id='prodDropdownHelp';hp.style.cssText='font-size:12px;color:#6B6458;margin-top:5px';hp.textContent='Les producteurs enrôlés apparaissent ici avec leur code.';prod.parentNode.appendChild(hp);}
  }
  function getVillageByName(){var name=($('f_village')&&$('f_village').value)||'';var k=keyc(name);return villages.find(function(v){var vn=(v.village||(v.data&&v.data.s1&&v.data.s1.village)||'');return keyc(vn)===k;});}
  async function loadVillages(){if(!sb)return;var r=await sb.from('villages').select('id,village,cluster,data').eq('deleted',false);if(!r.error) villages=r.data||[];}
  function censusCandidates(v){
    var out=[], c=((v&&v.data&&v.data.s7&&Array.isArray(v.data.s7.candidats))?v.data.s7.candidats:[]);
    c.forEach(function(x,idx){var name=(x&&x.nom||'').trim(); if(!name)return; out.push({id:'census-'+v.id+'-'+idx,id_rt:'REC-'+String(idx+1).padStart(2,'0'),nom:name,telephone:x.telephone||'',village_id:v.id,village_nom:(v.village||(v.data&&v.data.s1&&v.data.s1.village)||''),cluster:(v.cluster||(v.data&&v.data.s1&&v.data.s1.cluster)||''),_source:'census'});});
    var leader=v&&v.data&&v.data.s2&&v.data.s2.leader; if(leader&&leader.nom){var exists=out.some(function(r){return keyc(r.nom)===keyc(leader.nom);}); if(!exists)out.push({id:'census-'+v.id+'-leader',id_rt:'REC-LD',nom:leader.nom,telephone:leader.telephone||'',village_id:v.id,village_nom:(v.village||(v.data&&v.data.s1&&v.data.s1.village)||''),cluster:(v.cluster||(v.data&&v.data.s1&&v.data.s1.cluster)||''),_source:'census'});}
    return out;
  }
  async function loadRefsForVillage(v){
    if(!sb||!v)return;
    if(!rtCache[v.id]){var rr=await sb.from('rt').select('id,id_rt,nom,data,village_id,village_nom,cluster,statut').eq('deleted',false).eq('village_id',v.id).order('id_rt'); if(!rr.error)rtCache[v.id]=rr.data||[];}
    var fromTable=rtCache[v.id]||[], fromCensus=censusCandidates(v), seen={};
    rtCache[v.id]=fromTable.concat(fromCensus).filter(function(r){var k=keyc(rtName(r)); if(!k||seen[k])return false; seen[k]=1; return true;});
    if(!prodCache[v.id]){var pr=await sb.from('producteurs').select('id,code,nom,telephone,data,village_id,village_nom,rt_id,statut').eq('deleted',false).eq('village_id',v.id).order('code'); if(!pr.error)prodCache[v.id]=pr.data||[];}
  }
  function setFreeProducerValue(val){
    var prod=$('f_prod'); if(!prod)return;
    var clean=up(val); var opt=prod.querySelector('option[data-free="1"]');
    if(!opt){opt=document.createElement('option');opt.setAttribute('data-free','1');prod.appendChild(opt);}
    opt.value=clean||'__FREE__'; opt.textContent=clean?('SAISIE LIBRE - '+clean):'Producteur non enrôlé / saisie libre'; prod.value=opt.value;
  }
  function renderRefs(v){
    ensureDom(); var rt=$('f_rt'), prod=$('f_prod'), rtH=$('rtDropdownHelp'), prodH=$('prodDropdownHelp');
    if(!v){if(rt)rt.innerHTML='<option value="">Choisir un village d’abord</option>'; if(prod)prod.innerHTML='<option value="">Choisir un village d’abord</option><option value="__FREE__">Producteur non enrôlé / saisie libre</option>'; return;}
    var rts=rtCache[v.id]||[]; if(rt){rt.innerHTML='<option value="">Choisir un RT du village</option>'+rts.map(function(r){var val=up(rtName(r));return '<option value="'+esc(val)+'">'+esc(rtText(r))+'</option>';}).join('');}
    if(rtH)rtH.textContent=rts.length?('RT du village : '+rts.length+' (Base RT + recensement si besoin).'):'Aucun RT trouvé pour ce village.';
    var prods=prodCache[v.id]||[]; if(prod){prod.innerHTML='<option value="">Choisir un producteur</option>'+prods.map(function(p){var val=prodValue(p);return '<option value="'+esc(val)+'">'+esc(prodText(p))+'</option>';}).join('')+'<option value="__FREE__">Producteur non enrôlé / saisie libre</option>';prod.addEventListener('change',onProdSelect,{once:true});prod.addEventListener('change',onProdSelect);}
    if(prodH)prodH.textContent=prods.length?('Producteurs enrôlés du village : '+prods.length):'Aucun producteur enrôlé pour ce village : utilisez saisie libre.';
    onProdSelect();
  }
  function onProdSelect(){var prod=$('f_prod'), free=$('f_prod_free'); if(!prod||!free)return; var isFree=prod.value==='__FREE__'||(prod.selectedOptions[0]&&prod.selectedOptions[0].getAttribute('data-free')==='1'); free.style.display=isFree?'block':'none'; if(!isFree)free.value='';}
  async function refreshDropdowns(){try{ensureDom(); if(!villages.length)await loadVillages(); var v=getVillageByName(); await loadRefsForVillage(v); renderRefs(v);}catch(e){console.warn('achats dropdown patch',e);}}
  function patchSync(){
    window.syncAll=async function(){
      var all=[]; try{all=JSON.parse(localStorage.getItem('anagroci_achats')||'[]');}catch(e){all=[];}
      var pend=all.filter(function(r){return r._status!=='synced';}); if(!navigator.onLine||!sb||!pend.length){if(typeof window.render==='function')window.render();return;}
      var btn=$('syncBtn'); if(btn)btn.disabled=true;
      if(!userId){try{var s=await sb.auth.getSession();userId=s.data&&s.data.session&&s.data.session.user?s.data.session.user.id:null;}catch(e){}}
      for(var i=0;i<pend.length;i++){
        var rec=pend[i], payload=Object.assign({},rec); delete payload._status; delete payload._error; delete payload.kor; delete payload.sync_statut;
        if(!payload.created_by && userId) payload.created_by=userId;
        try{var r=await sb.from('achats').upsert(payload,{onConflict:'local_id',ignoreDuplicates:true}); if(!r.error){rec._status='synced';delete rec.recu_photo;} else rec._error=r.error.message;}catch(e){rec._error=String(e&&e.message||e);break;}
      }
      localStorage.setItem('anagroci_achats',JSON.stringify(all)); if(btn)btn.disabled=false; if(typeof window.render==='function')window.render();
    };
  }
  function init(){
    if(!window.supabase||!window.supabase.createClient)return setTimeout(init,200);
    sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON); patchSync(); ensureDom(); loadVillages().then(refreshDropdowns);
    document.addEventListener('input',function(e){if(e.target&&e.target.id==='f_village')setTimeout(refreshDropdowns,80);});
    document.addEventListener('change',function(e){if(e.target&&e.target.id==='f_village')setTimeout(refreshDropdowns,80); if(e.target&&e.target.id==='f_prod')onProdSelect();});
    document.addEventListener('anagroci:authenticated',function(){setTimeout(function(){loadVillages().then(refreshDropdowns);},300);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();