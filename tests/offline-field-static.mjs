import fs from 'node:fs';
import assert from 'node:assert/strict';

const off=fs.readFileSync('shared/offline-field.js','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const html=fs.readFileSync('operations/field-buying.html','utf8');
const fb=fs.readFileSync('operations/field-buying.js','utf8');
const coop=fs.readFileSync('operations/aflp-cooperatives-enrolement.js','utf8');
const sql=fs.readFileSync('supabase/20261013190000_offline_first_field_buying.sql','utf8');

assert.match(off,/indexedDB\.open\(DB_NAME,\s*DB_VERSION\)/,'IndexedDB réel requis');
assert.match(off,/operations_queue|STORE_OPS\s*=\s*'operations'/,'file persistante requise');
assert.match(off,/idempotency_key/,'clé idempotence client requise');
assert.match(off,/dependencies/,'dépendances entre opérations requises');
assert.match(off,/offline_sync_batch/,'RPC de synchronisation requise');
assert.match(off,/setInterval/,'reprise périodique requise');
assert.match(off,/addEventListener\('online'/,'reprise au retour réseau requise');
assert.match(off,/prepareDeviceLease/,'lease appareil RT requis pour la caisse offline');
assert.match(off,/navigator\.storage\.persist/,'demande stockage persistant requise');

assert.match(html,/offline-field\.js\?v=20261016-android-1/);
assert.match(html,/navigator\.serviceWorker\.register\("\.\.\/sw\.js"/,'Service Worker Operations requis');
assert.match(sw,/offline-field\.js/,'shell terrain doit précacher le moteur offline');
assert.match(sw,/field-buying\.html/,'shell terrain requis');
assert.match(sw,/isSupabaseApi/,'API Supabase explicitement exclue du cache SW');
assert.doesNotMatch(sw,/caches\.keys\(\).*caches\.delete\(k\).*return Promise\.all\(keys\.map\(function\(k\)\{ return caches\.delete\(k\)/s,'ne pas supprimer tous les caches du domaine');

for(const op of ['FARMER_ENROLL','COOP_FARMER_ENROLL','COOP_FARMER_LINK','FIELD_PURCHASE_CREATE','BAG_MOVEMENT_CREATE','FIELD_GPS_UPDATE'])
  assert.match(sql,new RegExp("'"+op+"'"),op+' requis côté serveur');
assert.match(sql,/create table if not exists private\.offline_sync_receipts/i);
assert.match(sql,/idempotency_key uuid primary key/i);
assert.match(sql,/jsonb_array_length[\s\S]*> 50/,'lot limité à 50');
assert.match(sql,/security definer[\s\S]*set search_path = public, private, pg_temp/i,'search_path sécurisé');
assert.match(sql,/revoke all on function public\.offline_sync_batch\(jsonb\) from anon/i);
assert.match(sql,/grant execute on function public\.offline_sync_batch\(jsonb\) to authenticated/i);
assert.match(sql,/create table if not exists private\.offline_device_leases/i,'protection multi-appareils caisse');
assert.match(sql,/pg_advisory_xact_lock/,'claim RT sérialisé');
assert.match(sql,/v_lease\.device_id<>v_device/,'lease vérifiée à la synchro');
assert.match(sql,/status='OPEN'/,'campagne ouverte obligatoire');
assert.doesNotMatch(off,/service_role/i,'aucune clé service_role côté client');
assert.doesNotMatch(sql,/execute\s+format\s*\([^)]*insert\s+into/i,'pas de RPC générique table/payload');

assert.match(fb,/Achat sauvegardé sur cet appareil/,'UX achat offline');
assert.match(fb,/Farmer ID définitif attribué lors de la synchronisation/,'UX enrôlement offline');
assert.match(fb,/leaseAllows\(row\.rt_id\)/,'garde appareil RT côté client');
assert.match(coop,/COOP_FARMER_ENROLL/,'enrôlement coop offline');

console.log('Offline FIELD BUYING static: PASS');
