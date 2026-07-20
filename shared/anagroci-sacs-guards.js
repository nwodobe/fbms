/* ANAGROCI Operations Suite - gardes metier Sacs / Sacherie terrain
   Non destructif : bloque les mouvements incoherents et protege la file locale.
*/
(function(){
  'use strict';
  if(window.__ANAGROCI_SACS_GUARDS_SCRIPT) return;
  window.__ANAGROCI_SACS_GUARDS_SCRIPT = true;

  function moduleName(){ return window.ANAGROCI_MODULE || (window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.module) || 'unknown'; }
  function readStore(k, def){ try{ var s=localStorage.getItem(k); return s ? JSON.parse(s) : def; }catch