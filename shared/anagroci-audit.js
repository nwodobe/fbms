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

  function installBusinessHooks(){
    var installed = 0;
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
    var tries = 0;
    hookTimer = setInterval(function(){
      tries += 1;
      var n = installBusinessHooks();
      if(n > 0 || tries >= 20) clearInterval(hookTimer);
    }, 500);
  }

  window.ANAGROCI_AUDIT = { log: log, installBusinessHooks: installBusinessHooks };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startHooking);
  else startHooking();
  document.addEventListener('anagroci:authenticated', function(){ setTimeout(startHooking, 300); });
})();
