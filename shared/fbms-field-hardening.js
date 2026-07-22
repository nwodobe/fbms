/* ============================================================================
   ANAGROCI FBMS - FIELD BUYING HARDENING
   Non-destructive runtime controls for fbms/index.html
   ========================================================================== */
(function(){
  'use strict';
  if(!/\/fbms\/index\.html$/.test(location.pathname)) return;

  var CSS = ''+
  '#fbmsHardBtn{position:fixed;right:18px;bottom:86px;z-index:2147482500;border:0;border-radius:999px;background:#053B23;color:#fff;padding:12px 16px;font:700 13px IBM Plex Sans,Arial;box-shadow:0 14px 36px rgba(5,59,35,.28);cursor:pointer;border-bottom:3px solid #8DC556}'+
  '#fbmsHardPanel{position:fixed;inset:0;z-index:2147482600;background:rgba(0,0,0,.55);display:none;align-items:stretch;justify-content:flex-end}'+
  '#fbmsHardPanel.on{display:flex}#fbmsHardBox{width:min(980px,100vw);height:100%;background:#F4F4F3;overflow:auto;font-family:IBM Plex Sans,Arial;color:#323131;box-shadow:-18px 0 50px rgba(0,0,0,.25)}'+
  '#fbmsHardHead{position:sticky;top:0;background:#053B23;color:#fff;padding:18px 22px;border-bottom:3px solid #8DC556;display:flex;gap:12px;align-items:center;z-index:2}'+
  '#fbmsHardHead h2{margin:0;font:800 20px Archivo,Arial}#fbmsHardHead p{margin:4px 0 0;color:#CFE3D3;font-size:12px}#fbmsHardHead .sp{flex:1}'+
  '.fhbtn{border:0;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer}.fhclose{background:#fff;color:#053B23}.fhcopy{background:#8DC556;color:#053B23}'+
  '#fbmsHardBody{padding:18px;display:flex;flex-direction:column;gap:14px}.fhgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.fhcard{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:14px}.fhcard small{display:block;color:#7A7878;text-transform:uppercase;letter-spacing:.08em;font-size:10px;font-weight:700}.fhcard b{display:block;margin-top:5px;font:700 24px IBM Plex Mono,monospace;color:#053B23}.fhtable{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}.fhtable th{text-align:left;font-size:10px;text-transform:uppercase;color:#7A7878;letter-spacing:.08em;border-bottom:2px solid #008F37;padding:10px}.fhtable td{border-bottom:1px solid #E8E7E7;padding:10px;font-size:13px;vertical-align:top}.fhpill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:800}.fhok{background:#E3F5E8;color:#1c7a3f}.fhwarn{background:#FDEFCE;color:#8a6a12}.fhbad{background:#FDECE9;color:#B23A2A}.fhinfo{background:#E9F1FB;color:#2b5f9e}.fhmono{font-family:IBM Plex Mono,monospace}.fhlist{margin:6px 0 0;padding-left:18px;color:#7A7878}.fhdiag{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:14px;line-height:1.55;font-size:13px}'+
  '@media(max-width:700px){#fbmsHardBtn{right:12px;bottom:76px;padding:10px 12px}#fbmsHardHead{padding:14px}#fbmsHardBody{padding:12px}.fhtable{min-width:880px}}';

  function addStyle(){ if(document.getElementById('fbmsHardStyle')) return; var s=document.createElement('style'); s.id='fbmsHardStyle'; s.textContent=CSS; document.head.appendChild(s); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];}); }
  function key(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
  function n(x){ var v=Number(String(x==null?'':x).replace(',','.')); return isFinite(v)?v:0; }
  function statut(v){ return (v&&v.statut)||'Brouillon'; }
  function photosOk(v){ var p=(v&&v.photos)||{}; return ['entree','chef','route','lieuCollecte','rt','gps'].filter(function(k){return !!p[k];}); }
  function villageName(v){ return (v&&v.s1&&v.s1.village)||'Village sans nom'; }
  function villageId(v){ return v&&v.id; }
  function villageCluster(v){ return (v&&v.s1&&v.s1.cluster)||''; }
  function villageWave(v){ return !!(v&&v.s6&&v.s6.mobileMoney&&v.s6.mobileMoney.Wave); }
  function villageRT(v){ return (v&&v.s7&&Array.isArray(v.s7.candidats)) ? v.s7.candidats.filter(function(c){return c&&c.nom;}) : []; }
  function producteursFor(v){ try{ return (STATE.producteurs||[]).filter(function(p){return p.villageId===v.id || key(p.villageNom)===key(villageName(v));}); }catch(e){ return []; } }
  function rtsFor(v){ try{ return (STATE.rt||[]).filter(function(r){return r.villageId===v.id || key(r.villageNom)===key(villageName(v));}); }catch(e){ return []; } }

  function auditVillage(v){
    var miss=[];
    if(!v||!v.s1) miss.push('fiche village invalide');
    if(!villageName(v)||villageName(v)==='Village sans nom') miss.push('nom village');
    if(!v.s1||!v.s1.cluster) miss.push('cluster');
    if(!v.s1||!v.s1.gpsLat||!v.s1.gpsLng) miss.push('coordonnees GPS');
    if(!v.s1||!v.s1.distanceHub) miss.push('distance hub');
    if(!v.s3||!n(v.s3.potentielMT)) miss.push('potentiel MT');
    if(!villageRT(v).length && !rtsFor(v).length) miss.push('au moins un RT');
    if(!v.s5||(!v.s5.typeAcces && !v.s5.camion10T && !v.s5.camion30T)) miss.push('accessibilite route');
    if(!v.s8 || v.s8.pasConflitFoncier!==true || v.s8.pasConflitCommunautaire!==true) miss.push('conflits foncier/communautaire a valider');
    if(!villageWave(v)) miss.push('Wave non confirme');
    if(photosOk(v).length<4) miss.push('photos terrain insuffisantes '+photosOk(v).length+'/6');
    var approved=/Approuve|Approuvé/i.test(statut(v));
    var ready = approved && miss.length===0;
    return {missing:miss, ready:ready, approved:approved, photoCount:photosOk(v).length};
  }

  function autoScore(v){
    var pot=n(v&&v.s3&&v.s3.potentielMT), route=v&&v.s5||{}, comp=(v&&v.s4&&v.s4.acheteurs)||[], rt=villageRT(v), pay=v&&v.s6&&v.s6.mobileMoney||{};
    return Math.max(0,Math.min(100,
      Math.min(20,Math.round(pot/15))+
      (route.camion30T?20:route.camion10T?15:route.accessiblePluies?11:route.pistePraticable?8:3)+
      Math.min(20, rt.length*7 + (rt.some(function(c){return c.smartphone;})?3:0) + (rt.some(function(c){return c.compteWave;})?3:0))+
      Math.max(2,20-(comp.length*4))+
      ((pay.Wave?12:0)+(pay.OrangeMoney?5:0)+(pay.MTNMoney?3:0))
    ));
  }

  function opStatusVillage(v){ var a=auditVillage(v); if(a.ready) return ['Prêt campagne','fhok']; if(a.approved) return ['Approuvé mais incomplet','fhwarn']; if(/Rejet/i.test(statut(v))) return ['Rejeté','fhbad']; return ['Non prêt','fhbad']; }
  function rtReady(r){ var ok=(/Actif|Confirmé|Confirme/i.test(r.statut||'')) && !!r.telephone && !!r.villageId; return ok; }
  function prodReady(p){ return /Actif|Enrôlé|Enrole/i.test(p.statut||'') && !!(p.telephone||p.tel); }
  function planFor(v){ var pot=n(v&&v.s3&&v.s3.potentielSecuriseMT)||n(v&&v.s3&&v.s3.potentielMT)||0; var rt=Math.max(1,rtsFor(v).filter(rtReady).length||villageRT(v).length||1); return {objectif:Math.round(pot), objectifRt:Math.round(pot/rt), avance:Math.max(100000,Math.round((pot/rt)*35000)), sacs:Math.max(20,Math.round((pot*1000/80)*1.08))}; }

  function pendingCount(){
    var out=0;
    try{ out+=(STATE.villages||[]).filter(function(v){return v._sync&&v._sync!=='synced';}).length; }catch(e){}
    try{ out+=(STATE.rt||[]).filter(function(v){return v._sync&&v._sync!=='synced';}).length; }catch(e){}
    try{ out+=(STATE.producteurs||[]).filter(function(v){return v._sync&&v._sync!=='synced';}).length; }catch(e){}
    return out;
  }

  function duplicateWarnings(){
    var warns=[];
    try{
      var phones={}, names={};
      (STATE.rt||[]).forEach(function(r){var ph=String(r.telephone||'').replace(/\D/g,''); if(ph){if(phones[ph]) warns.push('RT doublon probable par telephone : '+(r.nom||ph)); phones[ph]=1;} var nk=key((r.nom||'')+' '+(r.villageNom||'')); if(nk){if(names[nk]) warns.push('RT similaire : '+(r.nom||'')); names[nk]=1;}});
      var pphones={}, pnames={};
      (STATE.producteurs||[]).forEach(function(p){var ph=String(p.telephone||p.tel||'').replace(/\D/g,''); if(ph){if(pphones[ph]) warns.push('Producteur doublon probable par telephone : '+(p.nom||ph)); pphones[ph]=1;} var nk=key((p.nom||'')+' '+(p.villageNom||'')+' '+(p.campement||'')); if(nk){if(pnames[nk]) warns.push('Producteur similaire : '+(p.nom||'')); pnames[nk]=1;}});
    }catch(e){}
    return warns;
  }

  function renderActivation(){
    var villages=(typeof STATE!=='undefined'&&STATE.villages)||[];
    var rts=(typeof STATE!=='undefined'&&STATE.rt)||[];
    var prods=(typeof STATE!=='undefined'&&STATE.producteurs)||[];
    var audits=villages.map(function(v){return {v:v,a:auditVillage(v),p:planFor(v),s:opStatusVillage(v)};});
    var ready=audits.filter(function(x){return x.a.ready;}).length;
    var bad=audits.filter(function(x){return !x.a.ready;}).length;
    var pend=pendingCount();
    var dups=duplicateWarnings();
    var rows=audits.sort(function(a,b){return (b.a.ready?1:0)-(a.a.ready?1:0) || villageName(a.v).localeCompare(villageName(b.v),'fr');}).slice(0,120).map(function(x){
      return '<tr><td><b>'+esc(villageName(x.v))+'</b><br><span class="fhmono">'+esc(villageCluster(x.v)||'—')+'</span></td><td>'+esc(statut(x.v))+'</td><td><span class="fhpill '+x.s[1]+'">'+x.s[0]+'</span></td><td>'+rtsFor(x.v).filter(rtReady).length+' / '+rtsFor(x.v).length+'</td><td>'+producteursFor(x.v).filter(prodReady).length+' / '+producteursFor(x.v).length+'</td><td class="fhmono">'+x.p.objectif+' MT<br>'+x.p.objectifRt+' MT/RT</td><td class="fhmono">'+x.p.avance.toLocaleString('fr-FR')+' FCFA<br>'+x.p.sacs+' sacs</td><td>'+(x.a.missing.length?'<ul class="fhlist"><li>'+x.a.missing.map(esc).join('</li><li>')+'</li></ul>':'<span class="fhpill fhok">OK</span>')+'</td></tr>';
    }).join('');
    return '<div class="fhgrid"><div class="fhcard"><small>Villages prêts campagne</small><b>'+ready+'</b></div><div class="fhcard"><small>Villages à corriger</small><b>'+bad+'</b></div><div class="fhcard"><small>RT actifs/confirmés</small><b>'+rts.filter(rtReady).length+'/'+rts.length+'</b></div><div class="fhcard"><small>Producteurs actifs/enrôlés</small><b>'+prods.filter(prodReady).length+'/'+prods.length+'</b></div><div class="fhcard"><small>Non synchronisés</small><b>'+pend+'</b></div></div>'+
      '<div class="fhdiag"><b>Diagnostic hors ligne / qualité</b><br>'+ (pend?'<span class="fhpill fhwarn">'+pend+' élément(s) non synchronisé(s)</span> ':'<span class="fhpill fhok">Aucune file locale critique</span> ') + (dups.length?'<br><br><b>Alertes doublons</b><ul class="fhlist"><li>'+dups.slice(0,20).map(esc).join('</li><li>')+'</li></ul>':'<br>Aucun doublon probable détecté dans le cache chargé.') + '</div>'+
      '<div class="fhdiag"><b>Règles opérationnelles appliquées</b><ul class="fhlist"><li>Village non approuvé ou incomplet = non prêt campagne.</li><li>RT non actif/confirmé = ne devrait pas recevoir avance ni sacs.</li><li>Producteur non enrôlé/actif = achat provisoire seulement.</li><li>Suppression locale bloquée s’il existe des éléments non synchronisés.</li><li>Soumission serveur d’une fiche village incomplète bloquée par garde-fou.</li></ul></div>'+
      '<div style="overflow:auto"><table class="fhtable"><thead><tr><th>Village</th><th>Statut fiche</th><th>Activation</th><th>RT prêts</th><th>Producteurs prêts</th><th>Objectif</th><th>Prépa caisse/sacs</th><th>Points bloquants</th></tr></thead><tbody>'+ (rows||'<tr><td colspan="8">Aucun village chargé.</td></tr>') +'</tbody></table></div>';
  }

  function openActivation(){
    var p=document.getElementById('fbmsHardPanel'); if(!p) buildUI();
    document.getElementById('fbmsHardContent').innerHTML=renderActivation();
    document.getElementById('fbmsHardPanel').classList.add('on');
  }
  function closeActivation(){ var p=document.getElementById('fbmsHardPanel'); if(p) p.classList.remove('on'); }
  function copyActivation(){ var txt=document.getElementById('fbmsHardContent').innerText; navigator.clipboard&&navigator.clipboard.writeText(txt).then(function(){alert('Plan Activation Terrain copié.');}); }

  function buildUI(){
    addStyle();
    if(!document.getElementById('fbmsHardBtn')){ var b=document.createElement('button'); b.id='fbmsHardBtn'; b.textContent='Activation Terrain'; b.onclick=openActivation; document.body.appendChild(b); }
    if(!document.getElementById('fbmsHardPanel')){ var p=document.createElement('div'); p.id='fbmsHardPanel'; p.innerHTML='<div id="fbmsHardBox"><div id="fbmsHardHead"><div><h2>Activation Terrain</h2><p>Contrôle qualité FBMS · villages · RT · producteurs · préparation achats/caisse/sacs</p></div><div class="sp"></div><button class="fhbtn fhcopy" onclick="FBMSHardening.copyActivation()">Copier</button><button class="fhbtn fhclose" onclick="FBMSHardening.closeActivation()">Fermer</button></div><div id="fbmsHardBody"><div id="fbmsHardContent"></div></div></div>'; p.addEventListener('click',function(e){if(e.target===p) closeActivation();}); document.body.appendChild(p); }
  }

  function patchClearLocal(){
    if(typeof clearLocalData!=='function'||clearLocalData.__fbmsHard) return;
    var old=clearLocalData;
    clearLocalData=function(){
      var pc=pendingCount();
      if(pc>0){ alert('Suppression locale bloquée : '+pc+' élément(s) non synchronisé(s). Synchronisez ou sauvegardez d’abord.'); return; }
      var phrase=prompt('Action sensible. Tapez exactement SUPPRIMER MES DONNÉES LOCALES pour continuer.');
      if(phrase!=='SUPPRIMER MES DONNÉES LOCALES') return;
      return old.apply(this,arguments);
    };
    clearLocalData.__fbmsHard=true;
  }

  function patchRemote(){
    try{
      if(typeof RemoteVillages!=='undefined' && RemoteVillages.upsert && !RemoteVillages.upsert.__fbmsHard){
        var oldV=RemoteVillages.upsert;
        RemoteVillages.upsert=function(v,baseUpdatedAt,force){
          var a=auditVillage(v);
          if(!force && /Soumis|Validé|Valide|Approuvé|Approuve/i.test(statut(v)) && a.missing.length){
            throw new Error('Fiche village incomplète : '+a.missing.join(', ')+'. Corrigez avant soumission/validation.');
          }
          return oldV.apply(this,arguments);
        };
        RemoteVillages.upsert.__fbmsHard=true;
      }
    }catch(e){}
  }

  function init(){ buildUI(); patchClearLocal(); patchRemote(); window.FBMSHardening={openActivation:openActivation,closeActivation:closeActivation,copyActivation:copyActivation,auditVillage:auditVillage,autoScore:autoScore,renderActivation:renderActivation}; }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){setTimeout(init,600);}); else setTimeout(init,600);
})();
