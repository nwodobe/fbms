/* ============================================================================
   ANAGROCI FBMS - FIELD BUYING HARDENING
   Non-destructive runtime controls for fbms/index.html
   ========================================================================== */
(function(){
  'use strict';
  if(!/\/fbms\/index\.html$/.test(location.pathname)) return;

  var CSS = ''+
  '#fbmsHardBtn{position:fixed;right:18px;bottom:86px;z-index:2147482500;border:0;border-radius:999px;background:#053B23;color:#fff;padding:12px 16px;font:700 13px IBM Plex Sans,Arial;box-shadow:0 14px 36px rgba(5,59,35,.28);cursor:pointer;border-bottom:3px solid #8DC556;white-space:nowrap;max-width:calc(100vw - 24px)}'+
  /* Reserve la hauteur du bouton flottant : la derniere ligne ne passe plus dessous. */
  '#content{padding-bottom:140px}'+
  '#fbmsHardPanel{position:fixed;inset:0;z-index:2147482600;background:rgba(0,0,0,.55);display:none;align-items:stretch;justify-content:flex-end}'+
  '#fbmsHardPanel.on{display:flex}#fbmsHardBox{width:min(980px,100vw);height:100%;background:#F4F4F3;overflow:auto;font-family:IBM Plex Sans,Arial;color:#323131;box-shadow:-18px 0 50px rgba(0,0,0,.25)}'+
  '#fbmsHardHead{position:sticky;top:0;background:#053B23;color:#fff;padding:18px 22px;border-bottom:3px solid #8DC556;display:flex;gap:12px;align-items:center;z-index:2}'+
  '#fbmsHardHead h2{margin:0;font:800 20px Archivo,Arial}#fbmsHardHead p{margin:4px 0 0;color:#CFE3D3;font-size:12px}#fbmsHardHead .sp{flex:1}'+
  '.fhbtn{border:0;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer}.fhclose{background:#fff;color:#053B23}.fhcopy{background:#8DC556;color:#053B23}'+
  '#fbmsHardBody{padding:18px;display:flex;flex-direction:column;gap:14px}.fhgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.fhcard{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:14px}.fhcard small{display:block;color:#7A7878;text-transform:uppercase;letter-spacing:.08em;font-size:10px;font-weight:700}.fhcard b{display:block;margin-top:5px;font:700 24px IBM Plex Mono,monospace;color:#053B23}.fhtable{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}.fhtable th{text-align:left;font-size:10px;text-transform:uppercase;color:#7A7878;letter-spacing:.08em;border-bottom:2px solid #008F37;padding:10px}.fhtable td{border-bottom:1px solid #E8E7E7;padding:10px;font-size:13px;vertical-align:top}.fhpill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:800}.fhok{background:#E3F5E8;color:#1c7a3f}.fhwarn{background:#FDEFCE;color:#8a6a12}.fhbad{background:#FDECE9;color:#B23A2A}.fhinfo{background:#E9F1FB;color:#2b5f9e}.fhmono{font-family:IBM Plex Mono,monospace}.fhlist{margin:6px 0 0;padding-left:18px;color:#7A7878}.fhdiag{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:14px;line-height:1.55;font-size:13px}'+
  '#fbmsVillageValidationWarning{max-width:48rem;margin:0 0 14px;padding:13px 14px;border:1px solid #E7BF5A;border-radius:10px;background:#FFF8E6;color:#6B4D08;font-family:IBM Plex Sans,Arial;box-shadow:0 2px 8px rgba(107,77,8,.06)}'+
  '#fbmsVillageValidationWarning .fvwTop{display:flex;align-items:flex-start;gap:10px}#fbmsVillageValidationWarning .fvwIcon{font-size:17px;line-height:1.2}#fbmsVillageValidationWarning .fvwTitle{font-weight:800;font-size:13px;color:#704D00}#fbmsVillageValidationWarning .fvwSub{font-size:12px;color:#855F0A;margin-top:2px}#fbmsVillageValidationWarning ul{margin:8px 0 0 27px;padding:0;font-size:12px;line-height:1.5}#fbmsVillageValidationWarning .fvwAction{margin:10px 0 0 27px;border:1px solid #D7A62C;border-radius:7px;background:#fff;color:#704D00;padding:6px 10px;font-size:11px;font-weight:800;cursor:pointer}'+
  '@media(max-width:700px){#fbmsHardBtn{right:12px;bottom:76px;padding:10px 12px}#fbmsHardHead{padding:14px}#fbmsHardBody{padding:12px}.fhtable{min-width:880px}#fbmsVillageValidationWarning{margin-left:0;margin-right:0}}';

  var SYNC_CONTEXT=false;
  var UI_LISTENERS_BOUND=false;

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
    v=v||{};
    var miss=[], items=[];
    function add(code,label,section){ miss.push(label); items.push({code:code,label:label,section:section}); }
    if(!v.s1) add('invalid','Fiche village invalide','sec1');
    if(!v.s1||!v.s1.village) add('village','Nom du village manquant','sec1');
    if(!v.s1||!v.s1.cluster) add('cluster','Cluster manquant','sec1');
    if(!v.s1||!v.s1.gpsLat||!v.s1.gpsLng) add('gps','Coordonnées GPS manquantes','sec1');
    if(!v.s1||!v.s1.distanceHub) add('distance','Distance du hub manquante','sec1');
    if(!v.s3||!n(v.s3.potentielMT)) add('potential','Potentiel village (MT) manquant','sec3');
    if(!villageRT(v).length && !rtsFor(v).length) add('rt','Au moins un RT requis','sec7');
    if(!v.s5||(!v.s5.typeAcces && !v.s5.camion10T && !v.s5.camion30T)) add('road','Accessibilité route à renseigner','sec5');
    if(!v.s8 || v.s8.pasConflitFoncier!==true || v.s8.pasConflitCommunautaire!==true) add('conflict','Conflits foncier/communautaire à valider','sec8');
    if(!villageWave(v)) add('wave','Confirmation Wave manquante','sec6');
    var photoCount=photosOk(v).length;
    // Règle métier existante conservée : 4 photos minimum parmi les 6 emplacements.
    if(photoCount<4) add('photos','Photos terrain : '+photoCount+' / 6 (minimum requis : 4)','secPhotos');
    var approved=/Approuve|Approuvé/i.test(statut(v));
    var ready = approved && miss.length===0;
    return {missing:miss,items:items,ready:ready,approved:approved,photoCount:photoCount};
  }

  function needsWorkflowValidation(v){ return /Soumis|Validé|Valide|Approuvé|Approuve/i.test(statut(v)); }
  function villageValidationError(v){
    var e=new Error('Validation de la fiche village incomplète.');
    e.name='VillageValidationError';
    e.code='FBMS_VILLAGE_VALIDATION';
    e.audit=auditVillage(v);
    e.villageId=villageId(v);
    return e;
  }
  function isVillageValidationError(e){ return !!(e && (e.code==='FBMS_VILLAGE_VALIDATION' || /Fiche village incomplète|Validation de la fiche village/i.test(e.message||''))); }

  function currentFormVillage(){
    try{
      if(typeof STATE==='undefined' || STATE.active!=='form' || !STATE.formId || typeof collectFormData!=='function') return null;
      var base=STATE.formId==='new' ? (typeof blankVillage==='function'?blankVillage():{}) : (STATE.villages||[]).find(function(v){return v.id===STATE.formId;});
      if(!base) return null;
      return collectFormData(base);
    }catch(e){ return null; }
  }

  function warningBox(){ return document.getElementById('fbmsVillageValidationWarning'); }
  function removeVillageWarning(){ var el=warningBox(); if(el&&el.parentNode) el.parentNode.removeChild(el); }
  function focusVillageRequirement(){
    var box=warningBox();
    var section=box&&box.getAttribute('data-first-section');
    var target=section&&document.getElementById(section);
    if(target){ try{ if(target.tagName==='DETAILS') target.open=true; }catch(e){} target.scrollIntoView({behavior:'smooth',block:'start'}); }
  }

  function renderVillageWarning(a,attempted,v){
    var form=document.getElementById('recensement-form');
    if(!form){ removeVillageWarning(); return; }
    a=a||auditVillage(v||currentFormVillage());
    if(!a || !a.missing.length){ removeVillageWarning(); return; }
    var box=warningBox();
    if(!box){
      box=document.createElement('div'); box.id='fbmsVillageValidationWarning'; box.setAttribute('role','status');
      var statusSelect=form.querySelector('[data-path="statut"]');
      var anchor=statusSelect;
      while(anchor && anchor.parentNode!==form) anchor=anchor.parentNode;
      if(anchor && anchor.parentNode===form) form.insertBefore(box,anchor.nextSibling);
      else form.insertBefore(box,form.firstChild?form.firstChild.nextSibling:null);
    }
    var first=(a.items&&a.items[0])||{};
    box.setAttribute('data-first-section',first.section||'sec1');
    var sub=(attempted?'Action bloquée : ':'')+a.missing.length+' prérequis manquant'+(a.missing.length>1?'s':'')+' avant soumission/validation.';
    box.innerHTML='<div class="fvwTop"><span class="fvwIcon" aria-hidden="true">⚠</span><div><div class="fvwTitle">Fiche à compléter</div><div class="fvwSub">'+esc(sub)+'</div></div></div>'+
      '<ul><li>'+a.missing.map(esc).join('</li><li>')+'</li></ul>'+
      '<button type="button" class="fvwAction" onclick="FBMSHardening.focusVillageRequirement()">Compléter la fiche</button>';
  }

  function updateVillageWarning(attempted){
    var v=currentFormVillage();
    if(!v){ removeVillageWarning(); return; }
    renderVillageWarning(auditVillage(v),!!attempted,v);
  }

  function clearVillageHeaderValidation(){
    var el=document.getElementById('syncStatus');
    if(el && /Fiche village incomplète|Validation de la fiche village/i.test(el.textContent||'')){ el.textContent=''; try{ el.style.color=(typeof T!=='undefined'&&T.inkSoft)||''; }catch(e){} }
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
      '<div class="fhdiag"><b>Règles opérationnelles appliquées</b><ul class="fhlist"><li>Village non approuvé ou incomplet = non prêt campagne.</li><li>RT non actif/confirmé = ne devrait pas recevoir avance ni sacs.</li><li>Producteur non enrôlé/actif = achat provisoire seulement.</li><li>Suppression locale bloquée s’il existe des éléments non synchronisés.</li><li>Soumission/validation d’une fiche village incomplète bloquée avant persistance du statut.</li></ul></div>'+
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
          if(!force && needsWorkflowValidation(v) && a.missing.length){
            // En synchro de fond, ne pas transformer une validation locale en erreur globale.
            // On renvoie un conflit sentinelle : syncNow conserve la fiche pending, poursuit les
            // autres éléments, puis la sentinelle est nettoyée sans polluer le header.
            if(SYNC_CONTEXT) return Promise.resolve({conflict:true,server:{__fbmsValidationDeferred:true,villageId:villageId(v)}});
            throw villageValidationError(v);
          }
          return oldV.apply(this,arguments);
        };
        RemoteVillages.upsert.__fbmsHard=true;
        RemoteVillages.upsert.__fbmsHardOriginal=oldV;
      }
    }catch(e){}
  }

  function patchSaveForm(){
    if(typeof saveForm!=='function' || saveForm.__fbmsVillageValidation) return;
    var old=saveForm;
    saveForm=async function(){
      var v=currentFormVillage();
      if(v){
        var a=auditVillage(v);
        renderVillageWarning(a,needsWorkflowValidation(v)&&a.missing.length,v);
        if(needsWorkflowValidation(v) && a.missing.length){
          clearVillageHeaderValidation();
          var box=warningBox(); if(box) box.scrollIntoView({behavior:'smooth',block:'center'});
          return false;
        }
      }
      return old.apply(this,arguments);
    };
    saveForm.__fbmsVillageValidation=true;
  }

  function patchSetVillageStatut(){
    if(typeof setVillageStatut!=='function' || setVillageStatut.__fbmsVillageValidation) return;
    var old=setVillageStatut;
    setVillageStatut=async function(id,newStatut){
      var source=(typeof STATE!=='undefined'&&STATE.villages||[]).find(function(v){return v.id===id;});
      if(source){
        var candidate;
        try{ candidate=typeof structuredClone==='function'?structuredClone(source):JSON.parse(JSON.stringify(source)); }catch(e){ candidate=source; }
        candidate.statut=newStatut;
        var a=auditVillage(candidate);
        if(needsWorkflowValidation(candidate) && a.missing.length){
          clearVillageHeaderValidation();
          if(typeof canEditVillages!=='function' || canEditVillages()){
            if(typeof openEdit==='function') openEdit(id);
            setTimeout(function(){
              var sel=document.querySelector('#recensement-form [data-path="statut"]');
              if(sel){
                for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===newStatut && !sel.options[i].disabled){ sel.value=newStatut; break; } }
              }
              updateVillageWarning(true);
              var box=warningBox(); if(box) box.scrollIntoView({behavior:'smooth',block:'center'});
            },0);
          }else{
            alert('Fiche à compléter : '+a.missing.length+' prérequis manquant'+(a.missing.length>1?'s':'')+' avant validation.');
          }
          return false;
        }
      }
      return old.apply(this,arguments);
    };
    setVillageStatut.__fbmsVillageValidation=true;
  }

  function patchSetSyncStatus(){
    if(typeof setSyncStatus!=='function' || setSyncStatus.__fbmsVillageValidation) return;
    var old=setSyncStatus;
    setSyncStatus=function(msg,color){
      if(/Fiche village incomplète|Validation de la fiche village/i.test(String(msg||''))){ return old('',(typeof T!=='undefined'&&T.inkSoft)||color); }
      return old.apply(this,arguments);
    };
    setSyncStatus.__fbmsVillageValidation=true;
  }

  async function cleanupValidationDeferrals(){
    if(typeof ADAPTER==='undefined' || !ADAPTER.list || !ADAPTER.upsert) return {deferred:0,conflicts:0};
    var list=await ADAPTER.list(), deferred=0;
    for(var i=0;i<list.length;i++){
      var v=list[i];
      if(v && v._conflictServer && v._conflictServer.__fbmsValidationDeferred){
        delete v._conflictServer;
        if(v._sync==='synced') v._sync='pending';
        await ADAPTER.upsert(v);
        deferred++;
      }
    }
    list=await ADAPTER.list();
    try{ if(typeof STATE!=='undefined') STATE.villages=list; }catch(e){}
    var conflicts=list.filter(function(v){return !!(v&&v._conflictServer);}).length;
    return {deferred:deferred,conflicts:conflicts};
  }

  function patchSyncNow(){
    if(typeof syncNow!=='function' || syncNow.__fbmsVillageValidation) return;
    var old=syncNow;
    syncNow=async function(){
      SYNC_CONTEXT=true;
      var out;
      try{ out=await old.apply(this,arguments); }
      finally{
        SYNC_CONTEXT=false;
        try{
          var c=await cleanupValidationDeferrals();
          if(c.deferred>0 && typeof setSyncStatus==='function'){
            if(c.conflicts>0) setSyncStatus('✔ Synchronisé — '+c.conflicts+' conflit(s) à arbitrer (Base de données)',(typeof T!=='undefined'&&T.orange)||'');
            else setSyncStatus('✔ Synchronisé à '+new Date().toLocaleTimeString('fr-FR'),(typeof T!=='undefined'&&T.emerald)||'');
            if(typeof isEditing==='function' && !isEditing() && typeof renderContent==='function') renderContent();
          }
        }catch(e){ console.warn('[FBMS] Nettoyage validation différée :',e&&e.message); }
        clearVillageHeaderValidation();
      }
      return out;
    };
    syncNow.__fbmsVillageValidation=true;
  }

  function patchRenderContent(){
    if(typeof renderContent!=='function' || renderContent.__fbmsVillageValidation) return;
    var old=renderContent;
    renderContent=function(){
      var out=old.apply(this,arguments);
      setTimeout(function(){
        clearVillageHeaderValidation();
        if(typeof STATE!=='undefined' && STATE.active==='form') updateVillageWarning(false);
        else removeVillageWarning();
      },0);
      return out;
    };
    renderContent.__fbmsVillageValidation=true;
  }

  function bindVillageWarningListeners(){
    if(UI_LISTENERS_BOUND) return;
    UI_LISTENERS_BOUND=true;
    function refresh(e){
      var form=document.getElementById('recensement-form');
      if(!form || !e.target || !form.contains(e.target)) return;
      setTimeout(function(){updateVillageWarning(false);},0);
    }
    document.addEventListener('input',refresh,true);
    document.addEventListener('change',refresh,true);
  }

  function init(){
    buildUI();
    patchClearLocal();
    patchRemote();
    patchSetSyncStatus();
    patchSaveForm();
    patchSetVillageStatut();
    patchSyncNow();
    patchRenderContent();
    bindVillageWarningListeners();
    clearVillageHeaderValidation();
    if(typeof STATE!=='undefined' && STATE.active==='form') setTimeout(function(){updateVillageWarning(false);},0);
    window.FBMSHardening={
      openActivation:openActivation,
      closeActivation:closeActivation,
      copyActivation:copyActivation,
      auditVillage:auditVillage,
      autoScore:autoScore,
      renderActivation:renderActivation,
      updateVillageWarning:updateVillageWarning,
      focusVillageRequirement:focusVillageRequirement,
      isVillageValidationError:isVillageValidationError
    };
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){setTimeout(init,600);}); else setTimeout(init,600);
})();
