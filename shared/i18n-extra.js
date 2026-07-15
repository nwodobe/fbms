/* ANAGROCI FR/EN extra translations - UI hotfix */
(function(){
  'use strict';
  if(window.ANAGROCI_I18N_EXTRA_READY) return;
  window.ANAGROCI_I18N_EXTRA_READY=true;
  var KEY='anagroci_lang', busy=false, timer=null;
  var originals=new WeakMap(), attrOriginals=new WeakMap();
  var D={
    'FBMS Referentiel':'FBMS Master Data','FBMS Référentiel':'FBMS Master Data','Référentiel FBMS':'FBMS Master Data',
    'Accès total : validation, exports, administration.':'Full access: validation, exports, administration.',