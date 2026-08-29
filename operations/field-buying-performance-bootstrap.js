/* FIELD BUYING performance bootstrap.
   Charge immediatement apres supabase-js et avant auth-gate / workspace / FIELD BUYING.

   Objectifs :
   1. une seule instance Supabase pour la page ;
   2. listes RT/Villages sans les gros JSON legacy `data` ;
   3. references des fiches 360 en version LIGHT ;
   4. lorsqu'une fiche RT/Village est ouverte, recuperer `data` uniquement pour l'ID ouvert ;
   5. aucune suppression ou migration de donnees.
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
var PROFILE_VILLAGES = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,data,deleted';
var PROFILE_RT = 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,data,deleted';

var LIGHT_BASE_VILLAGES = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,farmer_code_prefix,deleted';
var LIGHT_VILLAGES = 'id,village,region,departement,cluster,cluster_code,statut,score,gps_lat,gps_lng,deleted';
var LIGHT_RT = 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,deleted';

function routeParts() {
  var raw = global.location && global.location.hash ? global.location.hash : '';
  return raw.replace(/^#/, '').split('/').map(function (x) {
    try { return decodeURIComponent(x); } catch (e) { return x; }
  });
}

function targetIdFor(tableName) {
  var p = routeParts();
  if (tableName === 'rt' && p[0] === 'rt' && p[1]) return p[1];
  if (tableName === 'villages' && p[0] === 'villages' && p[1]) return p[1];
  return '';
}

function selectPlan(tableName, columns) {
  if (tableName === 'villages' && columns === BASE_VILLAGES) {
    return { columns: LIGHT_BASE_VILLAGES, detailId: '' };
  }
  if (tableName === 'rt' && columns === BASE_RT) {
    return { columns: LIGHT_RT, detailId: '' };
  }
  if (tableName === 'villages' && columns === PROFILE_VILLAGES) {
    return { columns: LIGHT_VILLAGES, detailId: targetIdFor('villages') };
  }
  if (tableName === 'rt' && columns === PROFILE_RT) {
    return { columns: LIGHT_RT, detailId: targetIdFor('rt') };
  }
  return { columns: columns, detailId: '' };
}

function mergeDetail(result, detail) {
  if (!result || !Array.isArray(result.data) || !detail || !detail.data) return result;
  result.data = result.data.map(function (row) {
    return row && row.id === detail.data.id ? Object.assign({}, row, { data: detail.data.data }) : row;
  });
  return result;
}

function proxyBuilder(builder, tableName, state, fetchDetail) {
  if (!builder || typeof Proxy === 'undefined') return builder;
  state = state || { detailId: '' };
  return new Proxy(builder, {
    get: function (target, prop) {
      var value = target[prop];
      if (prop === 'then' && typeof value === 'function') {
        return function (resolve, reject) {
          var base = new Promise(function (res, rej) { value.call(target, res, rej); });
          if (state.detailId) {
            base = Promise.all([base, fetchDetail(tableName, state.detailId)]).then(function (pair) {
              return mergeDetail(pair[0], pair[1]);
            });
          }
          return base.then(resolve, reject);
        };
      }
      if (typeof value !== 'function') return value;
      return function () {
        var args = Array.prototype.slice.call(arguments);
        if (prop === 'select' && args.length) {
          var plan = selectPlan(tableName, args[0]);
          args[0] = plan.columns;
          state.detailId = plan.detailId || '';
        }
        var out = value.apply(target, args);
        return out && typeof out === 'object' ? proxyBuilder(out, tableName, state, fetchDetail) : out;
      };
    }
  });
}

function wrapClient(client) {
  if (!client || client.__ANAGROCI_FB_PERF_WRAPPED__) return client;
  var originalFrom = client.from.bind(client);

  function fetchDetail(tableName, id) {
    if (!id || (tableName !== 'rt' && tableName !== 'villages')) {
      return Promise.resolve({ data: null, error: null });
    }
    return originalFrom(tableName).select('id,data').eq('id', id).maybeSingle().then(function (r) {
      return r && !r.error ? r : { data: null, error: r && r.error };
    }).catch(function () { return { data: null, error: null }; });
  }

  client.from = function (tableName) {
    return proxyBuilder(originalFrom(tableName), tableName, { detailId: '' }, fetchDetail);
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

global.ANAGROCI_FB_PERF = {
  version: '2026-08-29.2',
  baseSelectorsOptimized: true,
  profileRefsOptimized: true,
  targetedLegacyData: true,
  sharedSupabaseClient: true,
  getClient: function () { return singleton; }
};
})(window);
