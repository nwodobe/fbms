/* FIELD BUYING performance bootstrap.
   Chargé immédiatement après supabase-js et avant auth-gate / workspace / FIELD BUYING.
   Objectifs sûrs et rétrocompatibles :
   1. une seule instance Supabase pour la page ;
   2. empêcher base() de télécharger les gros JSON legacy villages.data / rt.data ;
   3. ne PAS toucher aux requêtes détaillées ni au loadRefs() des fiches 360°.

   Ce fichier est volontairement une couche de compatibilité courte. Les médias legacy
   restent en base ; aucune donnée n'est supprimée ni migrée ici.
*/
(function (global) {
'use strict';
if (global.__ANAGROCI_FB_PERF_BOOTSTRAP__) return;
global.__ANAGROCI_FB_PERF_BOOTSTRAP__ = true;

if (!global.supabase || typeof global.supabase.createClient !== 'function') return;

var originalCreateClient = global.supabase.createClient.bind(global.supabase);
var singleton = null;
var singletonKey = '';

var BASE_VILLAGES = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,data,deleted';
var BASE_RT = 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted,data';
var LIGHT_VILLAGES = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,deleted';
var LIGHT_RT = 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted';

function optimizeSelect(tableName, columns) {
  if (tableName === 'villages' && columns === BASE_VILLAGES) return LIGHT_VILLAGES;
  if (tableName === 'rt' && columns === BASE_RT) return LIGHT_RT;
  return columns;
}

function proxyBuilder(builder, tableName) {
  if (!builder || typeof Proxy === 'undefined') return builder;
  return new Proxy(builder, {
    get: function (target, prop) {
      var value = target[prop];
      if (prop === 'then' && typeof value === 'function') return value.bind(target);
      if (typeof value !== 'function') return value;
      return function () {
        var args = Array.prototype.slice.call(arguments);
        if (prop === 'select' && args.length) args[0] = optimizeSelect(tableName, args[0]);
        var out = value.apply(target, args);
        return out && typeof out === 'object' ? proxyBuilder(out, tableName) : out;
      };
    }
  });
}

function wrapClient(client) {
  if (!client || client.__ANAGROCI_FB_PERF_WRAPPED__) return client;
  var originalFrom = client.from.bind(client);
  client.from = function (tableName) {
    return proxyBuilder(originalFrom(tableName), tableName);
  };
  try {
    Object.defineProperty(client, '__ANAGROCI_FB_PERF_WRAPPED__', { value: true });
  } catch (e) {
    client.__ANAGROCI_FB_PERF_WRAPPED__ = true;
  }
  return client;
}

global.supabase.createClient = function (url, anonKey, options) {
  var key = String(url || '') + '|' + String(anonKey || '');
  if (singleton && key === singletonKey) return singleton;
  singleton = wrapClient(originalCreateClient(url, anonKey, options));
  singletonKey = key;
  global.ANAGROCI_SUPABASE_CLIENT = singleton;
  return singleton;
};

/* Diagnostic léger utilisable dans DevTools sans bruit console en production. */
global.ANAGROCI_FB_PERF = {
  version: '2026-08-29.1',
  baseSelectorsOptimized: true,
  sharedSupabaseClient: true,
  getClient: function () { return singleton; }
};
})(window);
