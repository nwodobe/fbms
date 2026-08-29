import fs from 'node:fs';

const js = fs.readFileSync('operations/sacherie-campaign-p0.js','utf8');
const html = fs.readFileSync('operations/field-buying.html','utf8');
const sql = fs.readFileSync('supabase/20260829_sacherie_campaign_p0.sql','utf8') + '\n' + fs.readFileSync('supabase/20260829_sacherie_campaign_p0_hardening.sql','utf8');

function ok(cond,msg){ if(!cond){ console.error('FAIL:',msg); process.exitCode=1; } else console.log('PASS:',msg); }

ok(html.includes('sacherie-campaign-p0.js'), 'le module P0 est chargé par FIELD BUYING');
ok(js.includes("global.ANAGROCI_FB.openBagRequest=openRequest"), 'la demande simple est remplacée par le workflow contrôlé');
ok(js.includes("sacherie_calculer_plafond"), 'calcul du plafond serveur avant demande');
ok(js.includes("sacherie_ops_create_request"), 'création canonique de demande contrôlée');
ok(js.includes("sacherie_ops_decide_request"), 'décision Branch Manager exposée');
ok(js.includes("ops_release_bags"), 'multi-release utilise le moteur idempotent ops_release_bags');
ok(js.includes("sacherie_ops_receive_release"), 'confirmation de réception exposée');
ok(js.includes("sacherie_ops_campaign_readiness"), 'readiness campagne visible dans le cockpit');
ok(sql.includes("client_request_id"), 'idempotence demande conservée');
ok(sql.includes("client_release_id"), 'idempotence sortie conservée');
ok(sql.includes("receipt_status"), 'statut de réception stocké par release');
ok(sql.includes("DISCREPANCY"), 'écart de réception explicitement géré');
ok(sql.includes("Enveloppe Sacherie 2027 approuvée par GM requise"), 'demande bloquée sans enveloppe GM');
ok(sql.includes("Allocation Sacherie du cluster absente"), 'demande bloquée sans allocation cluster');
ok(sql.includes("status=case when v_discrepancies=0 and v_pending=0 and released_qty=approved_qty and v_total=released_qty then 'RECEIVED'"), 'RECEIVED seulement après chaîne soldée sans écart');
ok(!js.includes("bag_movement_requests').insert") && !js.includes('bag_movement_requests\").insert'), 'la nouvelle UI ne crée pas une seconde vérité dans bag_movement_requests');

if(process.exitCode) process.exit(process.exitCode);
console.log('Sacherie campaign P0 static checks OK');
