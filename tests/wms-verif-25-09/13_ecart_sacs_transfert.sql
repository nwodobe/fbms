-- =====================================================================
-- FBMS / WMS · vérification du 25/09/2026 · TEST NON DESTRUCTIF
-- Écart 2 : écart de sacs au transfert (poids conforme)
--   S1 transfert 10 000 kg, 125 sacs chargés, 10 000 kg et 120 sacs reçus
--      -> DISCREPANCY (plus RECONCILED), bag_gap = 5, requires BAG_GAP_RESOLUTION
--   S2 clôture avant régularisation -> refusée
--   S3 régularisation par le réceptionnaire -> refusée (séparation des tâches)
--   S4 régularisation sans motif -> refusée
--   S5 régularisation BM avec motif -> RECONCILED, 5 sacs sortis du transit
--      en perte approuvée, reste en transit sacherie du transfert = 0
--   S6 rejeu même clé -> idempotent, aucun double mouvement
--   S7 clôture -> CLOSED
--   S8 transfert 2 : écart kg ET écart de sacs ; après résolution kg
--      (RECONCILED) la clôture reste refusée tant que les sacs ne sont
--      pas régularisés, puis passe
--   S9 non-régression : transfert 3 sans écart -> RECONCILED direct
-- Se termine TOUJOURS par raise exception 'SIMULATION_RESULT %' :
-- tout est annulé. NE JAMAIS retirer cette dernière instruction.
-- Comptes fictifs (@audit.invalid) annulés avec la transaction.
-- =====================================================================
do $t$
declare log jsonb := '[]'::jsonb; r jsonb;
  u_sk uuid := gen_random_uuid(); u_sk3 uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid();
  u_bm uuid := gen_random_uuid(); u_wm uuid := gen_random_uuid(); u_bm2 uuid := gen_random_uuid();
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281'; wh2 uuid := 'fc36b09a-a75a-451a-a2ea-8bbf7f752bd3';
  rec text; lot text; bin_a text; bin_b text; trf text; trf2 text; trf3 text; n_before int;
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'gap-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_sk,'sk'),(u_sk3,'sk3'),(u_qa,'qa'),(u_bm,'bm'),(u_wm,'wm'),(u_bm2,'bm2')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'gap-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_sk,'sk','Storekeeper','BKE-002'),(u_sk3,'sk3','Storekeeper','BKE-003'),(u_qa,'qa','QA / Lab',null),(u_bm,'bm','Branch Manager',null),
               (u_wm,'wm','Warehouse Manager','BKE-003'),(u_bm2,'bm2','Assistant Branch Manager',null)) v(id,k,ro,w);
  -- Stock de sacs pleins de test au magasin d'origine (annulé avec la transaction)
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,reference,note,owner_type)
  values ('JUT-TEST-GAP','TEST-GAP-SEED','AJUSTEMENT_INVENTAIRE','INTERNE',400,'BAG-WH-BKE-002','PLEIN','TEST','Stock de test (rollback)','ANAGROCI');
  set local role authenticated;
  -- Préparation : LOT de 30 000 kg en BIN BKE-002, BIN destination BKE-003
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Prep transfert','supplier_code','DIS-008-FOU','origin','Odienne',
       'warehouse_id',wh,'arrival_at',(now()-interval '6 hour')::text,'driver','SIM','truck','GAP0001CI'),'GAP-REC');
  rec := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',290,'imm_g',15,'spotted_g',10,'moisture_pct',8.5,'idempotency_key','GAP-Q1'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_decide_reception_v2(rec,true,'OK',null);
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  perform public.wms_record_offload(rec, jsonb_build_object('gross_kg',42000,'tare_kg',12000,'bags',375));
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec,'FINAL',jsonb_build_object('gk_g',289,'imm_g',15,'spotted_g',11,'moisture_pct',8.4,'idempotency_key','GAP-Q2'));
  lot := public.wms_release_lot(rec,'GAP-REL')->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  bin_a := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','DRY','idempotency_key','GAP-BIN-A'))->>'id';
  perform public.wms_allocate_lot_to_bin(lot, bin_a, 30000, 'GAP-ALLOC');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  bin_b := public.wms_create_bin(jsonb_build_object('warehouse_id',wh2,'stock_type','DRY','idempotency_key','GAP-BIN-B'))->>'id';

  -- S1 transfert 1 : poids conforme, 5 sacs manquants
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  trf := public.wms_trf_create_request(jsonb_build_object('origin_warehouse_id',wh,'dest_warehouse_id',wh2,'purpose','Consolidation stock','priority','NORMAL',
         'lines',jsonb_build_array(jsonb_build_object('bin_id',bin_a,'lot_id',lot,'qty',10000))),'GAP-T1-REQ')->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_trf_approve(trf,'OK','GAP-T1-APP');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  perform public.wms_trf_save_load(trf,jsonb_build_object('truck_plate','GP1122CI','driver_name','SIM','transporter','SIM Transport','seal_no','S-G1','bags_loaded',125,
         'gross_kg',22100,'tare_kg',12100,'net_kg',10000,'weighbridge_ref','PB-G1','load_doc_ref','BL-G1'),true,'GAP-T1-LOAD');
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm2,'role','authenticated')::text,true);
  perform public.wms_trf_confirm_dispatch(trf,'GAP-T1-DISP');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  perform public.wms_trf_register_arrival(trf,jsonb_build_object('warehouse_id',wh2,'receiver','SIM','truck','GP1122CI','seal_status','INTACT','seal_observed','S-G1'),'GAP-T1-ARR');
  r := public.wms_trf_confirm_receipt(trf,jsonb_build_object('gross_kg',22100,'tare_kg',12100,'net_kg',10000,'bags_received',120,'ticket','PB-G1R','dest_type','BIN','dest_bin_id',bin_b),'GAP-T1-REC');
  log := log || jsonb_build_object('t','S1 reception poids conforme, 120/125 sacs','statut',r->>'status','bag_gap',r->'bag_gap','requires',r->>'requires',
     'ok',(r->>'status')='DISCREPANCY' and (r->>'bag_gap')='5' and (r->>'requires')='BAG_GAP_RESOLUTION');
  -- S2 clôture avant régularisation
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  begin perform public.wms_trf_close(trf,'Cloture','GAP-T1-CLOSE-A'); log := log || jsonb_build_object('t','S2 cloture avant regularisation','ok',false,'res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','S2 cloture avant regularisation','ok',true,'res','REFUSE','err',SQLERRM); end;
  -- S3 séparation des tâches (le réceptionnaire)
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  begin perform public.wms_trf_resolve_bag_gap(trf,'Sacs vides retrouves','GAP-T1-BG-SK'); log := log || jsonb_build_object('t','S3 regularisation par le receptionnaire','ok',false,'res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','S3 regularisation par le receptionnaire','ok',true,'res','REFUSE','err',SQLERRM); end;
  -- S4 sans motif
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  begin perform public.wms_trf_resolve_bag_gap(trf,'  ','GAP-T1-BG-0'); log := log || jsonb_build_object('t','S4 regularisation sans motif','ok',false,'res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','S4 regularisation sans motif','ok',true,'res','REFUSE','err',SQLERRM); end;
  -- S5 régularisation BM
  r := public.wms_trf_resolve_bag_gap(trf,'5 sacs perdus pendant le transport, constat chauffeur','GAP-T1-BG');
  log := log || jsonb_build_object('t','S5 regularisation BM','statut',r->>'status','sacs_manquants_sortis',r->'bags_missing_written_off',
     'transit_sacherie_restant',(select coalesce(sum(case when event_key like 'WMS-TRF:'||trf||':OUT' then qty else 0 end),0)
                                  - coalesce(sum(case when event_key in ('WMS-TRF:'||trf||':IN','WMS-TRF:'||trf||':GAP-MISSING') then qty else 0 end),0)
                                from public.rcn_jute_movements where source_id=trf),
     'ok',(r->>'status')='RECONCILED' and (r->>'bags_missing_written_off')='5');
  -- S6 rejeu
  select count(*) into n_before from public.rcn_jute_movements where source_id=trf;
  r := public.wms_trf_resolve_bag_gap(trf,'5 sacs perdus pendant le transport, constat chauffeur','GAP-T1-BG');
  log := log || jsonb_build_object('t','S6 rejeu meme cle','idempotent',r->'idempotent','mouvements_sacherie_inchanges',(select count(*) from public.rcn_jute_movements where source_id=trf)=n_before,
     'ok',(r->>'idempotent')='true');
  -- S7 clôture
  r := public.wms_trf_close(trf,'Cloture','GAP-T1-CLOSE');
  log := log || jsonb_build_object('t','S7 cloture apres regularisation','statut',r->>'status','ok',(r->>'status')='CLOSED');

  -- S8 transfert 2 : écart kg (50 kg) et écart de sacs (1)
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  trf2 := public.wms_trf_create_request(jsonb_build_object('origin_warehouse_id',wh,'dest_warehouse_id',wh2,'purpose','Consolidation stock','priority','NORMAL',
         'lines',jsonb_build_array(jsonb_build_object('bin_id',bin_a,'lot_id',lot,'qty',10000))),'GAP-T2-REQ')->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_trf_approve(trf2,'OK','GAP-T2-APP');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  perform public.wms_trf_save_load(trf2,jsonb_build_object('truck_plate','GP2233CI','driver_name','SIM','transporter','SIM Transport','seal_no','S-G2','bags_loaded',125,
         'gross_kg',22100,'tare_kg',12100,'net_kg',10000,'weighbridge_ref','PB-G2','load_doc_ref','BL-G2'),true,'GAP-T2-LOAD');
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm2,'role','authenticated')::text,true);
  perform public.wms_trf_confirm_dispatch(trf2,'GAP-T2-DISP');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  perform public.wms_trf_register_arrival(trf2,jsonb_build_object('warehouse_id',wh2,'receiver','SIM','truck','GP2233CI','seal_status','INTACT','seal_observed','S-G2'),'GAP-T2-ARR');
  r := public.wms_trf_confirm_receipt(trf2,jsonb_build_object('gross_kg',22050,'tare_kg',12100,'net_kg',9950,'bags_received',124,'ticket','PB-G2R','dest_type','BIN','dest_bin_id',bin_b),'GAP-T2-REC');
  perform set_config('request.jwt.claims',json_build_object('sub',u_wm,'role','authenticated')::text,true);
  perform public.wms_trf_resolve_discrepancy(trf2,jsonb_build_object('category','WEIGHING_DIFFERENCE','detailed_reason','Ecart pont-bascule','responsible','Transporteur',
         'resolution','Perte transport acceptee','resolution_type','WRITE_OFF'),'GAP-T2-RES');
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  r := public.wms_trf_decide_resolution(trf2,true,'Valide','GAP-T2-DEC');
  begin perform public.wms_trf_close(trf2,'Cloture','GAP-T2-CLOSE-A'); log := log || jsonb_build_object('t','S8a cloture kg resolu, sacs non regularises','ok',false,'statut_kg',r->>'status','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','S8a cloture kg resolu, sacs non regularises','ok',true,'statut_kg',r->>'status','res','REFUSE','err',SQLERRM); end;
  perform public.wms_trf_resolve_bag_gap(trf2,'1 sac dechire jete a l arrivee','GAP-T2-BG');
  r := public.wms_trf_close(trf2,'Cloture','GAP-T2-CLOSE');
  log := log || jsonb_build_object('t','S8b cloture apres regularisation des sacs','statut',r->>'status','ok',(r->>'status')='CLOSED');

  -- S9 non-régression : transfert 3 sans écart
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  trf3 := public.wms_trf_create_request(jsonb_build_object('origin_warehouse_id',wh,'dest_warehouse_id',wh2,'purpose','Consolidation stock','priority','NORMAL',
         'lines',jsonb_build_array(jsonb_build_object('bin_id',bin_a,'lot_id',lot,'qty',5000))),'GAP-T3-REQ')->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_trf_approve(trf3,'OK','GAP-T3-APP');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  perform public.wms_trf_save_load(trf3,jsonb_build_object('truck_plate','GP3344CI','driver_name','SIM','transporter','SIM Transport','seal_no','S-G3','bags_loaded',62,
         'gross_kg',17100,'tare_kg',12100,'net_kg',5000,'weighbridge_ref','PB-G3','load_doc_ref','BL-G3'),true,'GAP-T3-LOAD');
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm2,'role','authenticated')::text,true);
  perform public.wms_trf_confirm_dispatch(trf3,'GAP-T3-DISP');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  perform public.wms_trf_register_arrival(trf3,jsonb_build_object('warehouse_id',wh2,'receiver','SIM','truck','GP3344CI','seal_status','INTACT','seal_observed','S-G3'),'GAP-T3-ARR');
  r := public.wms_trf_confirm_receipt(trf3,jsonb_build_object('gross_kg',17100,'tare_kg',12100,'net_kg',5000,'bags_received',62,'ticket','PB-G3R','dest_type','BIN','dest_bin_id',bin_b),'GAP-T3-REC');
  log := log || jsonb_build_object('t','S9 transfert sans ecart','statut',r->>'status','bag_gap',r->'bag_gap','ok',(r->>'status')='RECONCILED');
  log := log || jsonb_build_object('t','Vue wms_v_transfers','lignes',(select jsonb_agg(jsonb_build_object('id',id,'statut',status,'bag_gap',bag_gap,'regularise',bag_gap_resolved_at is not null) order by id) from public.wms_v_transfers where id in (trf,trf2,trf3)));
  reset role;
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
