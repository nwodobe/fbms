/* ANAGROCI Operations Suite - helper audit frontend
   Non destructif: ce fichier n'est pas encore branche automatiquement.
   Usage futur: window.ANAGROCI_AUDIT.log('action', {module:'achats', id:'...'})
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

  async function log(action, details){
    try{
      var SB = getSupabase();
      if(!SB) return {ok:false, reason:'supabase_not_available'};
      var payload = {
        email: userEmail(),
        action: String(action || 'unknown'),
        details: JSON.stringify(details || {})
      };
      var res = await SB.from('audit_log').insert(payload);
      if(res && res.error) return {ok:false, error:res.error.message};
      return {ok:true};
    }catch(e){
      return {ok:false, error:e && e.message ? e.message : String(e)};
    }
  }

  window.ANAGROCI_AUDIT = { log: log };
})();
