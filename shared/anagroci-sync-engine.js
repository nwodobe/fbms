/* ANAGROCI Operations Suite - durable offline transaction engine
   --------------------------------------------------------------------------
   Guarantees:
   - every pending business transaction is copied to IndexedDB;
   - pending/failed records are never removed by local history caps;
   - retries are resumable and idempotent through local_id upserts;
   - every state transition is written to an append-only local journal;
   - legacy localStorage queues remain compatible with existing screens.
*/
(function(){
  'use strict';
  if(window.ANAGROCI_SYNC) return;

  var DB_NAME = 'anagroci_operations_v2';
  var DB_VERSION = 1;
  var TX_STORE = 'transactions';
  var LOG_STORE = 'sync_log';
  var DEVICE_KEY = 'anagroci_device_id';
  var ORIGINAL_SET_ITEM = Storage.prototype.setItem;
  var ORIGINAL_REMOVE_ITEM = Storage.prototype.removeItem;
  var syncing = false;
  var dbPromise = null;
  var timer = null;

  var QUEUES = {
    anagroci_achats: {table:'achats', module:'achats'},
    anagroci_avances: {table:'avances', module:'cash'},
    anagroci_recons: {table:'reconciliations', module:'cash'},
    anagroci_sacs: {table:'sacs_mouvements', module:'sacs'}
  };

  function uuid(){
    try{return crypto.randomUUID();}
    catch(e){return 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2);}
  }

  function now(){return new Date().toISOString();}

  function deviceId(){
    var id = null;
    try