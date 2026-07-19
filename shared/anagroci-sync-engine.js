/* ANAGROCI durable offline transaction queue.
   Keeps every pending business transaction in IndexedDB until server acknowledgement.
   Existing localStorage queues remain compatible with current screens. */
(function(){
  'use strict';
  if(window.ANAGROCI_SYNC) return;

  var DB_NAME='anagroci_operations_v2', DB_VERSION=1;
  var STORE='transactions', LOG='sync_log';
  var MAP={
    anagroci_achats:'achats',
    anagroci_avances:'avances',
    anagroci_recons:'reconciliations',
    anagroci_sacs:'sacs_mouvements'
  };