/* ANAGROCI Operations Suite - helper audit frontend
   Non destructif: trace les actions sensibles et transforme les erreurs serveur
   Farmer Buying en messages terrain lisibles.
*/
(function(){
  'use strict';
  if(window.ANAGROCI_AUDIT) return;

  function getSupabase(){
    if(window.ANAGROCI_AUDIT_SUPABASE) return window.ANAGROCI_AUDIT_SUPABASE;
    if(window.supabase && window.ANAGROCI_SUPABASE_URL && window.ANAGROCI_SUPABASE_ANON){
      window.ANAGROCI_AUDIT_SUPABASE = window.supabase.createClient(window.ANAGROCI_SUPABASE_URL, window.ANAGROCI_SUPABASE_ANON);
      return window.ANAGROCI_AUDIT_SUPABASE;
    }
    return null;
  }
  function userEmail(){ try{ var a=window.ANAGROCI_AUTH; return (a&&a.profile&&(a.profile.email||a.profile.nom))||null; }catch(e){ return null; } }
  function moduleName(){ return window.ANAGROCI_MODULE || (window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.module) || 'unknown'; }
  function val(id){ try{ var e=document.getElementById(id); if(!e) return null; if(e.type==='file') return e.files&&e.files.length?String(e.files.length)+' file(s)':null; return e.value==null?null:String(e.value).slice(0,220); }catch(e){ return null; } }
  function snapshot(ids){ var o={}; (ids||[]).forEach(function(id){ var v=val(id); if(v!==null && v!=='') o[id]=v; }); return o; }

  async function log(action, details){
    try{
      var SB=getSupabase(); if(!SB) return {ok:false, reason:'supabase_not_available'};
      var payload={email:userEmail(), action:String(action||'unknown'), details:JSON.stringify(Object.assign({module:moduleName(), path:location.pathname, ts_client:new Date().toISOString()}, details||{}))};
      var res=await SB.from('audit_log').insert(payload);
      if(res&&res.error) return {ok:false, error:res.error.message};
      return {ok:true};
    }catch(e){ return {ok:false, error:e&&e.message?e.message:String(e)}; }
  }
  function after(promiseLike, cb){ try{ if(promiseLike&&typeof promiseLike.then==='function') return promiseLike.finally(cb); cb(); return promiseLike; }catch(e){ cb(); throw e; } }
  function wrap(name, action, detailFn){
    try{
      if(typeof window[name] !== 'function' || window[name].__anagroci_audited) return false;
      var original=window[name];
      var wrapped=function(){ var args=Array.prototype.slice.call(arguments), details={}; try{ details=detailFn?detailFn(args):{}; }catch(e){ details={extract_error:String(e&&e.message||e)}; } details.function_name=name; var result=original.apply(this, arguments); return after(result, function(){ log(action, details); }); };
      wrapped.__anagroci_audited=true; window[name]=wrapped; return true;
    }catch(e){ return false; }
  }

  function store(k, def){ try{ var s=localStorage.getItem(k); return s?JSON.parse(s):def; }catch(e){ return def; } }
  function saveStore(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  function key(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
  function num(x){ var v=parseFloat(String(x==null?'':x).replace(',','.')); return Number.isFinite(v)?v:null; }
  function field(id){ var e=document.getElementById(id); return e?String(e.value||'').trim():''; }
  function options(id){ var d=document.getElementById(id); if(!d) return []; return Array.prototype.slice.call(d.querySelectorAll('option')).map(function(o){return o.value||'';}).filter(Boolean); }
  function deviceId(){ var k='anagroci_device_id', id=localStorage.getItem(k); if(!id){ try{id='dev-'+crypto.randomUUID();}catch(e){id='dev-'+Date.now()+'-'+Math.round(Math.random()*1e9);} localStorage.setItem(k,id); } return id; }
  function showPageMessage(text, kind, targets){
    kind=kind||'err';
    var ids=targets||['f_msg','a_msg','r_msg','m_msg'];
    for(var i=0;i<ids.length;i++){
      var el=document.getElementById(ids[i]);
      if(el){
        try{ if(typeof window.msg==='function' && window.msg.length>=2) window.msg(el, text, kind); else { el.className='alert show '+kind; el.textContent=text; } }
        catch(e){ el.className='alert show '+kind; el.textContent=text; }
        return;
      }
    }
    try{ alert(text); }catch(e){}
  }
  function friendlyServerError(raw){
    var s=String(raw&&raw.message||raw&&raw.details||raw||'');
    var low=s.toLowerCase();
    if(low.indexOf('avance rt insuffisante')>=0 || low.indexOf('fb_prevent_achat_over_advance')>=0){
      return 'Synchronisation bloquée : avance RT insuffisante. Vérifiez le solde du RT, ajoutez une avance ou faites la réconciliation avant de synchroniser cet achat.';
    }
    if(low.indexOf('stock sacs insuffisant')>=0 || low.indexOf('fb_prevent_negative_bag_stock')>=0){
      return 'Synchronisation bloquée : stock de sacs insuffisant. Enregistrez d’abord la réception ou la dotation qui alimente ce stock, puis resynchronisez.';
    }
    if(low.indexOf('achats_numero_recu_unique_idx')>=0 || low.indexOf('duplicate key')>=0 || low.indexOf('unique constraint')>=0){
      return 'Synchronisation bloquée : ce numéro de reçu existe déjà. Vérifiez le reçu papier/photo et corrigez le numéro avant de resynchroniser.';
    }
    if(low.indexOf('row-level security')>=0 || low.indexOf('violates row-level security')>=0){
      return 'Synchronisation refusée par les droits d’accès. Déconnectez-vous/reconnectez-vous ou contactez le Branch Manager.';
    }
    if(low.indexOf('network')>=0 || low.indexOf('failed to fetch')>=0){
      return 'Synchronisation impossible : réseau instable. Gardez les données sur le téléphone et réessayez quand la connexion revient.';
    }
    return 'Synchronisation non finalisée : '+(s||'erreur serveur inconnue')+'. Gardez la donnée en attente et contactez le Branch Manager si le problème persiste.';
  }
  function toastSyncErrors(queue, targets){
    var failed=(queue||[]).filter(function(r){return r&&r._status==='failed'&&(r.last_error||r._error);});
    if(failed.length){ showPageMessage(friendlyServerError(failed[0].last_error||failed[0]._error), 'err', targets); }
  }
  function normalizeQueue(queue, beforeMap){
    var dev=deviceId(), now=new Date().toISOString(), out=Array.isArray(queue)?queue.slice():[], seen={};
    out.forEach(function(r){ if(r&&r.local_id) seen[String(r.local_id)]=true; });
    if(beforeMap){ Object.keys(beforeMap).forEach(function(id){ var old=beforeMap[id]; if(!seen[id]&&old&&old._status!=='synced'){ old._status=old._status||'pending'; old.recovered_at=now; out.push(old); } }); }
    out.forEach(function(r){ if(!r) return; if(!r.device_id) r.device_id=dev; if(r.sync_attempts==null) r.sync_attempts=0; if(!r._status) r._status='pending'; if(r._status==='syncing') r._status='failed'; if(r._error&&!r.last_error) r.last_error=r._error; if(r._status==='failed'&&!r.last_attempt_at) r.last_attempt_at=now; });
    out.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); });
    return out;
  }
  function payload(queue, chronological){
    var arr=(queue||[]).slice();
    if(chronological) arr.sort(function(a,b){ return String(a.created_at||a.date||'').localeCompare(String(b.created_at||b.date||'')); });
    return arr.map(function(r){ var x=Object.assign({}, r||{}); delete x.device_id; delete x.sync_attempts; delete x.last_attempt_at; delete x.last_error; delete x.recovered_at; delete x._error; return x; });
  }
  function pendingMap(queue){ var m={}; (queue||[]).forEach(function(r){ if(r&&r.local_id&&r._status!=='synced') m[String(r.local_id)]=Object.assign({},r); }); return m; }
  function mergeSyncResult(originalQueue, syncQueue){
    var sm={}; (syncQueue||[]).forEach(function(r){ if(r&&r.local_id) sm[String(r.local_id)]=r; });
    var merged=(originalQueue||[]).map(function(r){ if(!r||!r.local_id) return r; var s=sm[String(r.local_id)]||{}; if(s._status==='synced'){ r._status='synced'; delete r.recu_photo; delete r._error; r.last_error=null; } else if(s._error){ r._status='failed'; r._error=s._error; r.last_error=s._error; } else if(r._status==='syncing'){ r._status='pending'; } return r; });
    return normalizeQueue(merged);
  }
  async function syncQueueWithErrors(keyName, tableName, optionsSync){
    var opts=optionsSync||{}, SB=getSupabase();
    var queue=normalizeQueue(store(keyName, []));
    var now=new Date().toISOString();
    if(!navigator.onLine||!SB) return queue;
    queue.forEach(function(r){ if(r&&r._status!=='synced'){ r._status='syncing'; r.sync_attempts=Number(r.sync_attempts||0)+1; r.last_attempt_at=now; r.last_error=null; delete r._error; } });
    saveStore(keyName, payload(queue, !!opts.chronological));
    var current=store(keyName, []);
    for(var i=0;i<current.length;i++){
      var rec=current[i]; if(!rec||rec._status==='synced') continue;
      var p=Object.assign({},rec); delete p._status;
      try{
        var res=await SB.from(tableName).upsert(p,{onConflict:'local_id',ignoreDuplicates:true});
        if(res&&res.error){ rec._status='failed'; rec._error=friendlyServerError(res.error); rec.last_error=rec._error; }
        else { rec._status='synced'; delete rec._error; rec.last_error=null; }
      }catch(e){ rec._status='failed'; rec._error=friendlyServerError(e); rec.last_error=rec._error; break; }
    }
    saveStore(keyName, normalizeQueue(current));
    return store(keyName, []);
  }

  function existingReceipt(queue, receipt){ var r=key(receipt); return !!r && (queue||[]).some(function(x){return key(x&&x.numero_recu)===r;}); }
  function rtLabel(r){ return (r&&r.data&&(r.data.nom||r.data.rt||r.data.nomComplet))||(r&&r.nom)||(r&&r.village_nom?('RT '+r.village_nom):'')||''; }
  function rtKeyForName(name){ var ref=store('anagroci_ref_cash',{})||{}; var found=(ref.rt||[]).find(function(r){return key(rtLabel(r))===key(name);}); return found&&found.id?String(found.id):key(name); }
  function cashBalanceForRt(rtName){
    var ref=store('anagroci_ref_cash',{})||{}, rtKey=rtKeyForName(rtName), totalAvance=0, totalPaye=0;
    function sameRt(x){ return String(x&&x.rt_id||'')===rtKey || key(x&&x.rt_nom)===key(rtName) || key(x&&x.rt_nom)===rtKey; }
    (ref.avServer||[]).forEach(function(a){ if(sameRt(a)) totalAvance+=Number(a.montant)||0; });
    store('anagroci_avances',[]).forEach(function(a){ if(sameRt(a)) totalAvance+=Number(a.montant)||0; });
    if(ref.paye&&ref.paye[rtKey]) totalPaye+=Number(ref.paye[rtKey])||0;
    store('anagroci_achats',[]).forEach(function(a){ if(a&&a._status!=='synced'&&sameRt(a)) totalPaye+=Number(a.montant)||0; });
    return {rt_key:rtKey,avance:totalAvance,paye:totalPaye,solde:totalAvance-totalPaye,has_data:totalAvance>0||totalPaye>0};
  }
  function validatePurchase(){
    if(moduleName()!=='achats') return {ok:true};
    var q=store('anagroci_achats',[]), village=field('f_village'), rt=field('f_rt'), cluster=field('f_cluster'), receipt=field('f_recu'), mode=field('f_mode'), date=field('f_date'), villages=options('dl_villages'), rts=options('dl_rt');
    if(date){ var today=new Date(); today.setHours(23,59,59,999); if(new Date(date+'T00:00:00')>today) return {ok:false,reason:'date_future',message:'Date future interdite pour un achat terrain.'}; }
    if(cluster&&villages.length&&village&&villages.map(key).indexOf(key(village))===-1) return {ok:false,reason:'village_out_of_cluster',message:'Village hors cluster ou non reconnu. Corrigez le cluster ou choisissez un village du référentiel.'};
    if(rts.length&&rt&&rts.map(key).indexOf(key(rt))===-1) return {ok:false,reason:'rt_out_of_scope',message:'RT hors village/cluster. Choisissez un RT proposé par le référentiel.'};
    if(receipt&&existingReceipt(q,receipt)) return {ok:false,reason:'duplicate_receipt',message:'Numéro de reçu déjà utilisé sur cet appareil. Vérifiez avant d’enregistrer.'};
    if(key(mode)==='VIREMENT') return {ok:false,reason:'bank_payment_disabled',message:'Paiement bancaire désactivé pour Farmer Buying. Utilisez Mobile Money / Wave.'};
    var amount=Math.max(0,(num(field('f_brut'))||0)-(num(field('f_tare'))||0))*(num(field('f_prix'))||0), bal=rt?cashBalanceForRt(rt):{has_data:false};
    if(bal.has_data&&amount>0&&bal.solde<amount) return {ok:false,reason:'advance_exceeded',message:'Avance RT insuffisante. Solde disponible : '+Math.round(bal.solde).toLocaleString('fr-FR')+' FCFA. Réconciliez ou ajoutez une avance avant achat.'};
    return {ok:true};
  }
  function installFarmerBuyingGuards(){
    if(window.__ANAGROCI_FB_GUARDS_INSTALLED) return false;
    if(moduleName()!=='achats') return false;
    if(typeof window.save!=='function'||typeof window.syncAll!=='function') return false;
    var originalSave=window.save, originalSync=window.syncAll;
    window.save=function(){ var v=validatePurchase(); if(!v.ok){ log('achat_blocked_by_farmer_buying_guard',{reason:v.reason,fields:snapshot(['f_date','f_cluster','f_village','f_rt','f_prod','f_prix','f_sacs','f_mode','f_recu'])}); showPageMessage(v.message,'err',['f_msg']); return false; } var before=pendingMap(store('anagroci_achats',[])); var result=originalSave.apply(this,arguments); saveStore('anagroci_achats', normalizeQueue(store('anagroci_achats',[]),before)); if(typeof window.render==='function') try{window.render();}catch(e){} return result; };
    window.save.__anagroci_fb_guarded=true;
    window.syncAll=function(){
      var base=normalizeQueue(store('anagroci_achats',[]));
      return syncQueueWithErrors('anagroci_achats','achats').then(function(q){
        toastSyncErrors(q,['f_msg']);
        if(!q.some(function(r){return r&&r._status==='failed';})){ return after(originalSync.apply(this,arguments), function(){ saveStore('anagroci_achats', mergeSyncResult(base, store('anagroci_achats',[]))); if(typeof window.render==='function') try{window.render();}catch(e){}; }); }
        if(typeof window.render==='function') try{window.render();}catch(e){};
      });
    };
    window.syncAll.__anagroci_fb_guarded=true;
    window.__ANAGROCI_FB_GUARDS_INSTALLED=true; log('farmer_buying_guards_installed',{module:'achats',step:'8'}); return true;
  }

  function cashShow(elId,text,kind){ showPageMessage(text,kind,[elId]); }
  function cashOpenBalance(rtName){ try{ if(typeof window.findRtByName==='function'&&typeof window.soldeOf==='function'){ var r=window.findRtByName(rtName), id=r?String(r.id||''):''; var s=window.soldeOf(id,rtName); var needs=typeof window.needsRecon==='function'?window.needsRecon(id,rtName):false; return {avance:Number(s.avance)||0,paye:Number(s.paye)||0,solde:Number(s.solde)||0,needs_recon:!!needs,rt_id:id,has_data:(Number(s.avance)||0)>0||(Number(s.paye)||0)>0}; } }catch(e){} return cashBalanceForRt(rtName); }
  function validateCashAdvance(){ if(moduleName()!=='cash') return {ok:true}; var rt=field('a_rt'), amount=num(field('a_montant')), date=field('a_date'), rts=options('dl_art'); if(date){ var today=new Date(); today.setHours(23,59,59,999); if(new Date(date+'T00:00:00')>today) return {ok:false,reason:'date_future',message:'Date future interdite pour une avance RT.'}; } if(!rt) return {ok:false,reason:'rt_required',message:'RT requis : aucune avance ne peut être créée sans RT.'}; if(rts.length&&rts.map(key).indexOf(key(rt))===-1) return {ok:false,reason:'rt_out_of_scope',message:'RT hors référentiel ou hors cluster. Choisissez un RT proposé.'}; if(amount==null||amount<=0) return {ok:false,reason:'amount_invalid',message:'Montant d’avance invalide.'}; var bal=cashOpenBalance(rt); if(bal.needs_recon&&bal.solde>0) return {ok:false,reason:'open_balance_not_reconciled',message:'Nouvelle avance bloquée : ce RT a un solde ouvert de '+Math.round(bal.solde).toLocaleString('fr-FR')+' FCFA non réconcilié.'}; return {ok:true}; }
  function validateCashRecon(){ if(moduleName()!=='cash') return {ok:true}; var rt=field('r_rt'), cash=num(field('r_cash')), stock=num(field('r_stock')); if(!rt) return {ok:false,reason:'rt_required',message:'RT requis pour réconciliation.'}; if(cash==null&&stock==null) return {ok:false,reason:'recon_values_missing',message:'Saisissez le cash restant et/ou la valeur stock.'}; if((cash!=null&&cash<0)||(stock!=null&&stock<0)) return {ok:false,reason:'negative_recon_values',message:'Cash restant et valeur stock ne peuvent pas être négatifs.'}; var bal=cashOpenBalance(rt); if(!bal.has_data&&bal.avance<=0&&bal.paye<=0) return {ok:false,reason:'no_cash_activity',message:'Aucune avance ni achat trouvé pour ce RT. Réconciliation non nécessaire.'}; return {ok:true}; }
  function installCashControlGuards(){
    if(window.__ANAGROCI_CASH_GUARDS_INSTALLED) return false;
    if(moduleName()!=='cash') return false;
    if(typeof window.saveAvance!=='function'||typeof window.saveRecon!=='function'||typeof window.syncAll!=='function') return false;
    var originalSaveAvance=window.saveAvance, originalSaveRecon=window.saveRecon, originalSync=window.syncAll;
    window.saveAvance=function(){ var v=validateCashAdvance(); if(!v.ok){ log('cash_advance_blocked_by_guard',{reason:v.reason,fields:snapshot(['a_date','a_cluster','a_rt','a_source','a_montant','a_motif'])}); cashShow('a_msg',v.message,'err'); return false; } var before=pendingMap(store('anagroci_avances',[])); var result=originalSaveAvance.apply(this,arguments); saveStore('anagroci_avances', normalizeQueue(store('anagroci_avances',[]),before)); if(typeof window.render==='function') try{window.render();}catch(e){} return result; };
    window.saveRecon=function(){ var v=validateCashRecon(); if(!v.ok){ log('cash_reconciliation_blocked_by_guard',{reason:v.reason,fields:snapshot(['r_rt','r_cluster','r_avance','r_paye','r_cash','r_stock'])}); cashShow('r_msg',v.message,'err'); return false; } var before=pendingMap(store('anagroci_recons',[])); var result=originalSaveRecon.apply(this,arguments); saveStore('anagroci_recons', normalizeQueue(store('anagroci_recons',[]),before)); if(typeof window.render==='function') try{window.render();}catch(e){} return result; };
    window.syncAll=function(){ var result=originalSync.apply(this,arguments); return after(result,function(){ saveStore('anagroci_avances', mergeSyncResult(normalizeQueue(store('anagroci_avances',[])), store('anagroci_avances',[]))); saveStore('anagroci_recons', mergeSyncResult(normalizeQueue(store('anagroci_recons',[])), store('anagroci_recons',[]))); if(typeof window.render==='function') try{window.render();}catch(e){}; }); };
    window.__ANAGROCI_CASH_GUARDS_INSTALLED=true; log('cash_control_guards_installed',{module:'cash',step:'8'}); return true;
  }
  function installBusinessHooks(){ var installed=0; installed+=installFarmerBuyingGuards()?1:0; installed+=installCashControlGuards()?1:0; installed+=wrap('save','achat_create_attempt',function(){return snapshot(['f_date','f_cluster','f_village','f_rt','f_prod','f_net','f_prix','f_montant','f_sacs','f_mode','f_recu','f_hum','f_kor','f_rejet']);})?1:0; installed+=wrap('saveAvance','cash_advance_attempt',function(){return snapshot(['a_date','a_cluster','a_rt','a_source','a_montant','a_motif']);})?1:0; installed+=wrap('saveRecon','cash_reconciliation_attempt',function(){return snapshot(['r_rt','r_cluster','r_avance','r_paye','r_cash','r_stock']);})?1:0; installed+=wrap('saveMov','bag_movement_attempt',function(){return snapshot(['m_date','m_type','m_cluster','m_village','m_rt','m_prod','m_qte','m_obs']);})?1:0; installed+=wrap('saveHub','hub_gps_update_attempt',function(){return snapshot(['hub','lat','lng']);})?1:0; installed+=wrap('valide','distance_validation_attempt',function(args){var d=snapshot(['hub','seuil']); d.village_id=args&&args[0]?String(args[0]):null; return d;})?1:0; installed+=wrap('calc','alis_simulation_attempt',function(){return snapshot(['mode','hub','village','vol','contrat','camion','objectif']);})?1:0; installed+=wrap('saveBareme','alis_bareme_update_attempt',function(){return {note:'bareme_collecte_courte'};})?1:0; installed+=wrap('syncAll','sync_requested',function(){return {online:navigator.onLine};})?1:0; return installed; }
  var hookTimer=null;
  function startHooking(){ if(hookTimer) clearInterval(hookTimer); var tries=0; hookTimer=setInterval(function(){ tries+=1; var n=installBusinessHooks(); if(n>0||tries>=20) clearInterval(hookTimer); },500); }
  window.ANAGROCI_AUDIT={log:log, installBusinessHooks:installBusinessHooks, installFarmerBuyingGuards:installFarmerBuyingGuards, installCashControlGuards:installCashControlGuards, friendlyServerError:friendlyServerError};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',startHooking); else startHooking();
  document.addEventListener('anagroci:authenticated',function(){ setTimeout(startHooking,300); });
})();
