import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync('operations/sacherie-operational-p1.js','utf8');
const sql = fs.readFileSync('supabase/20260829_sacherie_operational_p1.sql','utf8');
const recv = fs.readFileSync('supabase/20260829_sacherie_operational_p1_receive.sql','utf8');
const html = fs.readFileSync('operations/field-buying.html','utf8');

assert.match(html,/sacherie-operational-p1\.js/,'module P1 doit etre charge');
for (const route of ['network','transfers','history','closure']) assert.match(js,new RegExp("bags/"+route),'onglet '+route+' requis');
for (const rpc of ['sacherie_ops_network_move','sacherie_ops_create_transfer','sacherie_ops_receive_transfer','sacherie_ops_closure_readiness','sacherie_ops_ensure_locations']) assert.match(js,new RegExp(rpc),'RPC '+rpc+' doit etre utilise');
assert.match(js,/localStorage/,'brouillons locaux requis');
assert.match(js,/limit\(300\)/,'historique doit rester borne');
assert.match(js,/p_client_operation_id/,'idempotence client requise');
assert.match(sql,/rcn_jute_movements/,'ledger canonique requis');
assert.match(sql,/JUTE-TRANSIT/,'location transit requise');
assert.match(sql,/PRODUCTEUR_TO_HUB_FULL/,'flux sacs pleins requis');
assert.match(sql,/sacherie_ct_assert_location_access/,'controle serveur des perimetres requis');
assert.match(recv,/reception partielle/i,'reception partielle documentee');
assert.match(recv,/event_key/,'reception idempotente requise');
assert.doesNotMatch(sql,/create\s+table\s+/i,'aucune table de stock parallele dans P1');
assert.doesNotMatch(recv,/create\s+table\s+/i,'aucune table parallele dans reception P1');
console.log('Sacherie operational P1 static: PASS');
