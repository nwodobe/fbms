/* ANAGROCI Operations Suite - helper audit frontend
   Non destructif: ce fichier trace les actions sensibles dans audit_log.
   Usage direct: window.ANAGROCI_AUDIT.log('action', {module:'achats', id:'...'})
*/
(function(){
  'use strict';
  if(window.ANAGROCI_AUDIT) return;

  function getSupabase(){
    if(window.ANAGROCI_AUDIT_SUPABASE) return window.ANAGROCI_AUDIT_SUPABASE;
   