/* ANAGROCI Operations Suite - helper audit frontend
   Non destructif: ce fichier trace les actions sensibles dans audit_log.
   Usage direct: window.ANAGROCI_AUDIT.log('action', {module:'achats', id:'...'})
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

  function userEmail(){
    try{
      var auth = window.ANAGROCI_AUTH;
      if(auth && auth.profile && auth.profile.email) return auth.profile.email;
      if(auth && auth.profile && auth.profile.nom) return auth.profile.nom;
    }catch(e){}
    return null;
  }

  function moduleName(){
    return window.ANAGROCI_MODULE || (window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.module) || 'unknown';
  }

  function val(id){
    try{
      var e = document.getElementById(id);
      if(!e) return null;
      if(e.type === 'file') return e.files && e.files.length ? String(e.files.length) + ' file(s)' : null;
      return e.value == null ? null : String(e.value).slice(0,220);
    }catch(e){return null;}
  }

  function snapshot(ids){
    var o = {};
    (ids || []).forEach(function(id){ var v = val(id); if(v !== null && v !== '') o[id] = v; });
    return o;
  }

  async function log(action, details){
    try{
      var SB = getSupabase();
      if(!SB) return {ok:false, reason:'supabase_not_available'};
      var payload = {
        email: userEmail(),
        action: String(action || 'unknown'),
        details: JSON.stringify(Object.assign({module: moduleName(), path: location.pathname, ts_client: new Date().toISOString()}, details || {}))
      };
      var res = await SB.from('audit_log').insert(payload);
      if(res && res.error) return {ok:false, error:res.error.message};
      return {ok:true};
    }catch(e){
      return {ok:false, error:e && e.message ? e.message : String(e)};
    }
  }

  function after(promiseLike, cb){
    try{
      if(promiseLike && typeof promiseLike.then === 'function') return promiseLike.finally(cb);
      cb();
      return promiseLike;
    }catch(e){ cb(); throw e; }
  }

  function wrap(name, action, detailFn){
    try{
      if(typeof window[name] !== 'function' || window[name].__anagroci_audited) return false;
      var original = window[name];
      var wrapped = function(){
        var args = Array.prototype.slice.call(arguments);
        var details = {};
        try{ details = detailFn ? detailFn(args) : {}; }catch(e){ details = {extract_error:String(e && e.message || e)}; }
        details.function_name = name;
        var result = original.apply(this, arguments);
        return after(result, function(){ log(action, details); });
      };
      wrapped.__anagroci_audited = true;
      window[name] = wrapped;
      return true;
    }catch(e){return false;}
  }

  function fbStore(k, def){
    try{ var s = localStorage.getItem(k); return s ? JSON.parse(s) : def; }catch(e){ return def; }
  }

  function fbSave(k, v){
    try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; }
  }

  function fbKey(s){
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  }

  function fbNum(x){
    var v = parseFloat(String(x == null ? '' : x).replace(',','.'));
    return Number.isFinite(v) ? v : null;
  }

  function fbDeviceId(){
    var k = 'anagroci_device_id';
    var id = localStorage.getItem(k);
    if(!id){
      try{ id = 'dev-' + crypto.randomUUID(); }
      catch(e){ id = 'dev-' + Date.now() + '-' + Math.round(Math.random()*1e9); }
      localStorage.setItem(k, id);
    }
    return id;
  }

  function fbField(id){ var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
  function fbOptions(id){
    var d = document.getElementById(id);
    if(!d) return [];
    return Array.prototype.slice.call(d.querySelectorAll('option')).map(function(o){return o.value || '';}).filter(Boolean);
  }

  function fbShowMessage(text, kind){
    try{ if(typeof window.msg === 'function') window.msg(text, kind || 'err'); else alert(text); }catch(e){}
  }

  function cashShowMessage(elId, text, kind){
    try{
      var el = document.getElementById(elId);
      if(typeof window.msg === 'function' && el) window.msg(el, text, kind || 'err');
      else if(el){ el.className = 'alert show ' + (kind || 'err'); el.textContent = text; }
      else alert(text);
    }catch(e){}
  }

  function fbExistingReceipt(queue, receipt){
    var r = fbKey(receipt);
    if(!r) return false;
    return (queue || []).some(function(x){ return fbKey(x && x.numero_recu) === r; });
  }

  function fbRtLabel(r){ return (r && r.data && (r.data.nom || r.data.rt || r.data.nomComplet)) || (r && r.nom) || (r && r.village_nom ? ('RT ' + r.village_nom) : '') || ''; }
  function fbRtKeyForName(name){
    var ref = fbStore('anagroci_ref_cash', {}) || {};
    var found = (ref.rt || []).find(function(r){ return fbKey(fbRtLabel(r)) === fbKey(name); });
    return found && found.id ? String(found.id) : fbKey(name);
  }

  function fbCashBalanceForRt(rtName){
    var ref = fbStore('anagroci_ref_cash', {}) || {};
    var rtKey = fbRtKeyForName(rtName);
    var totalAvance = 0;
    var totalPaye = 0;
    function sameRt(x){ return String(x && x.rt_id || '') === rtKey || fbKey(x && x.rt_nom) === fbKey(rtName) || fbKey(x && x.rt_nom) === rtKey; }
    (ref.avServer || []).forEach(function(a){ if(sameRt(a)) totalAvance += Number(a.montant) || 0; });
    fbStore('anagroci_avances', []).forEach(function(a){ if(sameRt(a)) totalAvance += Number(a.montant) || 0; });
    if(ref.paye && ref.paye[rtKey]) totalPaye += Number(ref.paye[rtKey]) || 0;
    fbStore('anagroci_achats', []).forEach(function(a){ if(a && a._status !== 'synced' && sameRt(a)) totalPaye += Number(a.montant) || 0; });
    return {rt_key:rtKey, avance:totalAvance, paye:totalPaye, solde:totalAvance-totalPaye, has_data:totalAvance>0 || totalPaye>0};
  }

  function fbNormalizeQueue(queue, beforeMap){
    var deviceId = fbDeviceId();
    var now = new Date().toISOString();
    var out = Array.isArray(queue) ? queue.slice() : [];
    var seen = {};
    out.forEach(function(r){ if(r && r.local_id) seen[String(r.local_id)] = true; });

    if(beforeMap){
      Object.keys(beforeMap).forEach(function(id){
        var old = beforeMap[id];
        if(!seen[id] && old && old._status !== 'synced'){
          old._status = old._status || 'pending';
          old.recovered_at = now;
          out.push(old);
        }
      });
    }

    out.forEach(function(r){
      if(!r) return;
      if(!r.device_id) r.device_id = deviceId;
      if(r.sync_attempts == null) r.sync_attempts = 0;
      if(!r._status) r._status = 'pending';
      if(r._status === 'syncing') r._status = 'failed';
      if(r._error && !r.last_error) r.last_error = r._error;
      if(r._status === 'failed' && !r.last_attempt_at) r.last_attempt_at = now;
    });

    out.sort(function(a,b){ return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    return out;
  }

  function fbSyncPayload(queue){
    return (queue || []).map(function(r){
      var x = Object.assign({}, r || {});
      delete x.device_id;
      delete x.sync_attempts;
      delete x.last_attempt_at;
      delete x.last_error;
      delete x.recovered_at;
      delete x._error;
      return x;
    });
  }

  function fbMergeSyncResult(originalQueue, syncQueue){
    var syncMap = {};
    (syncQueue || []).forEach(function(r){ if(r && r.local_id) syncMap[String(r.local_id)] = r; });
    var merged = (originalQueue || []).map(function(r){
      if(!r || !r.local_id) return r;
      var s = syncMap[String(r.local_id)] || {};
      if(s._status === 'synced'){
        r._status = 'synced';
        delete r.recu_photo;
        delete r._error;
        r.last_error = null;
      }else if(s._error){
        r._status = 'failed';
        r._error = s._error;
        r.last_error = s._error;
      }else if(r._status === 'syncing'){
        r._status = 'pending';
      }
      return r;
    });
    return fbNormalizeQueue(merged);
  }

  function fbPendingMap(queue){
    var m = {};
    (queue || []).forEach(function(r){ if(r && r.local_id && r._status !== 'synced') m[String(r.local_id)] = Object.assign({}, r); });
    return m;
  }

  function validateFarmerBuyingPurchase(){
    if(moduleName() !== 'achats') return {ok:true};

    var queue = fbStore('anagroci_achats', []);
    var village = fbField('f_village');
    var rt = fbField('f_rt');
    var cluster = fbField('f_cluster');
    var receipt = fbField('f_recu');
    var mode = fbField('f_mode');
    var date = fbField('f_date');
    var villages = fbOptions('dl_villages');
    var rts = fbOptions('dl_rt');

    if(date){
      var today = new Date(); today.setHours(23,59,59,999);
      var d = new Date(date + 'T00:00:00');
      if(d > today) return {ok:false, reason:'date_future', message:'Date future interdite pour un achat terrain.'};
    }
    if(cluster && villages.length && village && villages.map(fbKey).indexOf(fbKey(village)) === -1){
      return {ok:false, reason:'village_out_of_cluster', message:'Village hors cluster ou non reconnu. Corrigez le cluster ou choisissez un village du référentiel.'};
    }
    if(rts.length && rt && rts.map(fbKey).indexOf(fbKey(rt)) === -1){
      return {ok:false, reason:'rt_out_of_scope', message:'RT hors village/cluster. Choisissez un RT proposé par le référentiel.'};
    }
    if(receipt && fbExistingReceipt(queue, receipt)){
      return {ok:false, reason:'duplicate_receipt', message:'Numéro de reçu déjà utilisé sur cet appareil. Vérifiez avant d’enregistrer.'};
    }
    if(fbKey(mode) === 'VIREMENT'){
      return {ok:false, reason:'bank_payment_disabled', message:'Paiement bancaire désactivé pour Farmer Buying. Utilisez Mobile Money / Wave.'};
    }

    var brut = fbNum(fbField('f_brut')) || 0;
    var tare = fbNum(fbField('f_tare')) || 0;
    var prix = fbNum(fbField('f_prix')) || 0;
    var amount = Math.max(0, brut - tare) * prix;
    var bal = rt ? fbCashBalanceForRt(rt) : {has_data:false};
    if(bal.has_data && amount > 0 && bal.solde < amount){
      return {ok:false, reason:'advance_exceeded', message:'Avance RT insuffisante. Solde disponible : ' + Math.round(bal.solde).toLocaleString('fr-FR') + ' FCFA. Réconciliez ou ajoutez une avance avant achat.'};
    }
    return {ok:true};
  }

  function installFarmerBuyingGuards(){
    if(window.__ANAGROCI_FB_GUARDS_INSTALLED) return false;
    if(moduleName() !== 'achats') return false;
    if(typeof window.save !== 'function' || typeof window.syncAll !== 'function') return false;

    var originalSave = window.save;
    var originalSync = window.syncAll;

    window.save = function(){
      var validation = validateFarmerBuyingPurchase();
      if(!validation.ok){
        log('achat_blocked_by_farmer_buying_guard', {reason:validation.reason, fields:snapshot(['f_date','f_cluster','f_village','f_rt','f_prod','f_prix','f_sacs','f_mode','f_recu'])});
        fbShowMessage(validation.message, 'err');
        return false;
      }
      var before = fbPendingMap(fbStore('anagroci_achats', []));
      var result = originalSave.apply(this, arguments);
      var merged = fbNormalizeQueue(fbStore('anagroci_achats', []), before);
      fbSave('anagroci_achats', merged);
      if(typeof window.render === 'function') try{ window.render(); }catch(e){}
      return result;
    };
    window.save.__anagroci_fb_guarded = true;

    window.syncAll = function(){
      var originalQueue = fbNormalizeQueue(fbStore('anagroci_achats', []));
      var now = new Date().toISOString();
      originalQueue.forEach(function(r){
        if(r && r._status !== 'synced'){
          r._status = 'syncing';
          r.sync_attempts = Number(r.sync_attempts || 0) + 1;
          r.last_attempt_at = now;
          r.last_error = null;
        }
      });
      fbSave('anagroci_achats', fbSyncPayload(originalQueue));
      var result = originalSync.apply(this, arguments);
      return after(result, function(){
        var syncResult = fbStore('anagroci_achats', []);
        fbSave('anagroci_achats', fbMergeSyncResult(originalQueue, syncResult));
        if(typeof window.render === 'function') try{ window.render(); }catch(e){}
      });
    };
    window.syncAll.__anagroci_fb_guarded = true;

    window.__ANAGROCI_FB_GUARDS_INSTALLED = true;
    log('farmer_buying_guards_installed', {module:'achats'});
    return true;
  }

  function cashNormalizeQueue(key, beforeMap){
    return fbNormalizeQueue(fbStore(key, []), beforeMap);
  }

  function cashSanitizeQueue(queue){
    return fbSyncPayload(queue);
  }

  function cashPendingMap(key){
    return fbPendingMap(fbStore(key, []));
  }

  function cashRtOpenBalance(rtName){
    try{
      if(typeof window.findRtByName === 'function' && typeof window.soldeOf === 'function'){
        var r = window.findRtByName(rtName);
        var id = r ? String(r.id || '') : '';
        var s = window.soldeOf(id, rtName);
        var needs = typeof window.needsRecon === 'function' ? window.needsRecon(id, rtName) : false;
        return {avance:Number(s.avance)||0, paye:Number(s.paye)||0, solde:Number(s.solde)||0, needs_recon:!!needs, rt_id:id};
      }
    }catch(e){}
    return fbCashBalanceForRt(rtName);
  }

  function validateCashAdvance(){
    if(moduleName() !== 'cash') return {ok:true};
    var rt = fbField('a_rt');
    var amount = fbNum(fbField('a_montant'));
    var date = fbField('a_date');
    var rts = fbOptions('dl_art');
    if(date){
      var today = new Date(); today.setHours(23,59,59,999);
      var d = new Date(date + 'T00:00:00');
      if(d > today) return {ok:false, reason:'date_future', message:'Date future interdite pour une avance RT.'};
    }
    if(!rt) return {ok:false, reason:'rt_required', message:'RT requis : aucune avance ne peut être créée sans RT.'};
    if(rts.length && rts.map(fbKey).indexOf(fbKey(rt)) === -1) return {ok:false, reason:'rt_out_of_scope', message:'RT hors référentiel ou hors cluster. Choisissez un RT proposé.'};
    if(amount == null || amount <= 0) return {ok:false, reason:'amount_invalid', message:'Montant d’avance invalide.'};
    var bal = cashRtOpenBalance(rt);
    if(bal.needs_recon && bal.solde > 0){
      return {ok:false, reason:'open_balance_not_reconciled', message:'Nouvelle avance bloquée : ce RT a un solde ouvert de ' + Math.round(bal.solde).toLocaleString('fr-FR') + ' FCFA non réconcilié.'};
    }
    return {ok:true};
  }

  function validateCashRecon(){
    if(moduleName() !== 'cash') return {ok:true};
    var rt = fbField('r_rt');
    var cash = fbNum(fbField('r_cash'));
    var stock = fbNum(fbField('r_stock'));
    if(!rt) return {ok:false, reason:'rt_required', message:'RT requis pour réconciliation.'};
    if(cash == null && stock == null) return {ok:false, reason:'recon_values_missing', message:'Saisissez le cash restant et/ou la valeur stock.'};
    if((cash != null && cash < 0) || (stock != null && stock < 0)) return {ok:false, reason:'negative_recon_values', message:'Cash restant et valeur stock ne peuvent pas être négatifs.'};
    var bal = cashRtOpenBalance(rt);
    if(!bal.has_data && bal.avance <= 0 && bal.paye <= 0) return {ok:false, reason:'no_cash_activity', message:'Aucune avance ni achat trouvé pour ce RT. Réconciliation non nécessaire.'};
    return {ok:true};
  }

  function installCashControlGuards(){
    if(window.__ANAGROCI_CASH_GUARDS_INSTALLED) return false;
    if(moduleName() !== 'cash') return false;
    if(typeof window.saveAvance !== 'function' || typeof window.saveRecon !== 'function' || typeof window.syncAll !== 'function') return false;

    var originalSaveAvance = window.saveAvance;
    var originalSaveRecon = window.saveRecon;
    var originalSync = window.syncAll;

    window.saveAvance = function(){
      var validation = validateCashAdvance();
      if(!validation.ok){
        log('cash_advance_blocked_by_guard', {reason:validation.reason, fields:snapshot(['a_date','a_cluster','a_rt','a_source','a_montant','a_motif'])});
        cashShowMessage('a_msg', validation.message, 'err');
        return false;
      }
      var before = cashPendingMap('anagroci_avances');
      var result = originalSaveAvance.apply(this, arguments);
      fbSave('anagroci_avances', cashNormalizeQueue('anagroci_avances', before));
      if(typeof window.render === 'function') try{ window.render(); }catch(e){}
      return result;
    };
    window.saveAvance.__anagroci_cash_guarded = true;

    window.saveRecon = function(){
      var validation = validateCashRecon();
      if(!validation.ok){
        log('cash_reconciliation_blocked_by_guard', {reason:validation.reason, fields:snapshot(['r_rt','r_cluster','r_avance','r_paye','r_cash','r_stock'])});
        cashShowMessage('r_msg', validation.message, 'err');
        return false;
      }
      var before = cashPendingMap('anagroci_recons');
      var result = originalSaveRecon.apply(this, arguments);
      fbSave('anagroci_recons', cashNormalizeQueue('anagroci_recons', before));
      if(typeof window.render === 'function') try{ window.render(); }catch(e){}
      return result;
    };
    window.saveRecon.__anagroci_cash_guarded = true;

    window.syncAll = function(){
      var av = cashNormalizeQueue('anagroci_avances');
      var rc = cashNormalizeQueue('anagroci_recons');
      var now = new Date().toISOString();
      [av, rc].forEach(function(queue){
        queue.forEach(function(r){
          if(r && r._status !== 'synced'){
            r._status = 'syncing';
            r.sync_attempts = Number(r.sync_attempts || 0) + 1;
            r.last_attempt_at = now;
            r.last_error = null;
          }
        });
      });
      fbSave('anagroci_avances', cashSanitizeQueue(av));
      fbSave('anagroci_recons', cashSanitizeQueue(rc));
      var result = originalSync.apply(this, arguments);
      return after(result, function(){
        fbSave('anagroci_avances', fbMergeSyncResult(av, fbStore('anagroci_avances', [])));
        fbSave('anagroci_recons', fbMergeSyncResult(rc, fbStore('anagroci_recons', [])));
        if(typeof window.render === 'function') try{ window.render(); }catch(e){}
      });
    };
    window.syncAll.__anagroci_cash_guarded = true;

    window.__ANAGROCI_CASH_GUARDS_INSTALLED = true;
    log('cash_control_guards_installed', {module:'cash'});
    return true;
  }

  function installBusinessHooks(){
    var installed = 0;
    installed += installFarmerBuyingGuards() ? 1 : 0;
    installed += installCashControlGuards() ? 1 : 0;
    installed += wrap('save', 'achat_create_attempt', function(){return snapshot(['f_date','f_cluster','f_village','f_rt','f_prod','f_net','f_prix','f_montant','f_sacs','f_mode','f_recu','f_hum','f_kor','f_rejet']);}) ? 1 : 0;
    installed += wrap('saveAvance', 'cash_advance_attempt', function(){return snapshot(['a_date','a_cluster','a_rt','a_source','a_montant','a_motif']);}) ? 1 : 0;
    installed += wrap('saveRecon', 'cash_reconciliation_attempt', function(){return snapshot(['r_rt','r_cluster','r_avance','r_paye','r_cash','r_stock']);}) ? 1 : 0;
    installed += wrap('saveMov', 'bag_movement_attempt', function(){return snapshot(['m_date','m_type','m_cluster','m_village','m_rt','m_prod','m_qte','m_obs']);}) ? 1 : 0;
    installed += wrap('saveHub', 'hub_gps_update_attempt', function(){return snapshot(['hub','lat','lng']);}) ? 1 : 0;
    installed += wrap('valide', 'distance_validation_attempt', function(args){var d=snapshot(['hub','seuil']); d.village_id=args && args[0] ? String(args[0]) : null; return d;}) ? 1 : 0;
    installed += wrap('calc', 'alis_simulation_attempt', function(){return snapshot(['mode','hub','village','vol','contrat','camion','objectif']);}) ? 1 : 0;
    installed += wrap('saveBareme', 'alis_bareme_update_attempt', function(){return {note:'bareme_collecte_courte'};}) ? 1 : 0;
    installed += wrap('syncAll', 'sync_requested', function(){return {online:navigator.onLine};}) ? 1 : 0;
    return installed;
  }

  var hookTimer = null;
  function startHooking(){
    if(hookTimer) clearInterval(hookTimer);
    var tries = 0;
    hookTimer = setInterval(function(){
      tries += 1;
      var n = installBusinessHooks();
      if(n > 0 || tries >= 20) clearInterval(hookTimer);
    }, 500);
  }

  window.ANAGROCI_AUDIT = {
    log: log,
    installBusinessHooks: installBusinessHooks,
    installFarmerBuyingGuards: installFarmerBuyingGuards,
    installCashControlGuards: installCashControlGuards
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startHooking);
  else startHooking();
  document.addEventListener('anagroci:authenticated', function(){ setTimeout(startHooking, 300); });
})();
