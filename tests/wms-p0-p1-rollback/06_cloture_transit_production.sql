-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- Clôture journalière avec perte en transit acceptée, sorties production, envoi réparation depuis stock 100 % déchiré
--
-- Exécution : coller tel quel dans l'éditeur SQL Supabase (ou via
-- execute_sql). Le script se termine TOUJOURS par
--   raise exception 'SIMULATION_RESULT %'
-- qui annule l'intégralité de la transaction : aucun compte, aucune
-- réception, aucun LOT, aucun mouvement n'est conservé. Le résultat est
-- le JSON contenu dans le message d'erreur. NE JAMAIS retirer cette
-- dernière instruction.
-- Comptes : fictifs (@audit.invalid), créés puis annulés dans la même
-- transaction. Aucune donnée personnelle réelle.
-- =====================================================================
do $sim$
declare
  log jsonb := '[]'::jsonb;
  u_sk uuid := gen_random_uuid(); u_sk3 uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid();
  u_bm uuid := gen_random_uuid(); u_wm uuid := gen_random_uuid(); u_bm2 uuid := gen_random_uuid();
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';
  wh2 uuid := 'fc36b09a-a75a-451a-a2ea-8bbf7f752bd3';
  r jsonb; rec text; lot text; bin_a text; bin_b text; trf text;
  L text := 'BAG-WH-BKE-002'; L4 text := 'BAG-WH-BKE-004';
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'sim2v2-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_sk,'sk'),(u_sk3,'sk3'),(u_qa,'qa'),(u_bm,'bm'),(u_wm,'wm'),(u_bm2,'bm2')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'sim2v2-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_sk,'sk','Storekeeper','BKE-002'),(u_sk3,'sk3','Storekeeper','BKE-003'),(u_qa,'qa','QA / Lab',null),(u_bm,'bm','Branch Manager',null),
               (u_wm,'wm','Warehouse Manager','BKE-003'),(u_bm2,'bm2','Assistant Branch Manager',null)) v(id,k,ro,w);

  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Prep transfert','supplier_code','DIS-008-FOU','origin','Odienne',
       'warehouse_id',wh,'arrival_at',(now()-interval '6 hour')::text,'driver','SIM','truck','LM9900CI'),'SIM2-C1');
  rec := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',290,'imm_g',15,'spotted_g',10,'moisture_pct',8.5,'idempotency_key','SIM2-Q1'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_decide_reception(rec,true,'OK');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  perform public.wms_record_offload(rec, jsonb_build_object('gross_kg',37000,'tare_kg',12000,'bags',312));
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec,'FINAL',jsonb_build_object('gk_g',289,'imm_g',15,'spotted_g',11,'moisture_pct',8.4,'idempotency_key','SIM2-Q2'));
  r := public.wms_release_lot(rec,'SIM2-REL'); lot := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','DRY','capacity_kg',60000,'idempotency_key','SIM2-BIN-A')); bin_a := r->>'id';
  perform public.wms_allocate_lot_to_bin(lot, bin_a, 25000, 'SIM2-ALLOC');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh2,'stock_type','DRY','capacity_kg',60000,'idempotency_key','SIM2-BIN-B')); bin_b := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_trf_create_request(jsonb_build_object('origin_warehouse_id',wh,'dest_warehouse_id',wh2,'purpose','Consolidation stock','priority','NORMAL',
       'lines',jsonb_build_array(jsonb_build_object('bin_id',bin_a,'lot_id',lot,'qty',10000))),'SIM2-TRF-REQ');
  trf := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_trf_approve(trf,'OK','SIM2-TRF-APP');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  perform public.wms_trf_save_load(trf,jsonb_build_object('truck_plate','NP1122CI','driver_name','SIM','transporter','SIM Transport','seal_no','S-0001','bags_loaded',125,
       'gross_kg',22100,'tare_kg',12100,'net_kg',10000,'weighbridge_ref','PB-T-01','load_doc_ref','BL-T-01'),true,'SIM2-TRF-LOAD');
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm2,'role','authenticated')::text,true);
  perform public.wms_trf_confirm_dispatch(trf,'SIM2-TRF-DISP');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  perform public.wms_trf_register_arrival(trf,jsonb_build_object('warehouse_id',wh2,'receiver','SIM','truck','NP1122CI','seal_status','INTACT','seal_observed','S-0001'),'SIM2-TRF-ARR');
  perform public.wms_trf_confirm_receipt(trf,jsonb_build_object('gross_kg',22050,'tare_kg',12100,'net_kg',9950,'bags_received',124,'ticket','PB-D-01','dest_type','BIN','dest_bin_id',bin_b),'SIM2-TRF-REC');
  perform set_config('request.jwt.claims',json_build_object('sub',u_wm,'role','authenticated')::text,true);
  perform public.wms_trf_resolve_discrepancy(trf,jsonb_build_object('category','WEIGHING_DIFFERENCE','detailed_reason','Ecart pont-bascule','responsible','Transporteur',
       'resolution','Perte transport acceptee','resolution_type','WRITE_OFF'),'SIM2-TRF-RES');
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_trf_decide_resolution(trf,true,'Valide','SIM2-TRF-DEC');
  -- depuis le 25/09/2026 : l'écart de sacs (125 chargés, 124 reçus) doit être régularisé avant la clôture
  perform public.wms_trf_resolve_bag_gap(trf,'1 sac dechire jete a l arrivee','SIM2-TRF-BG');
  perform public.wms_trf_close(trf,'Cloture','SIM2-TRF-CLOSE');
  log := log || jsonb_build_object('s','V2-D1 Cloture BKE-002','res',(select jsonb_build_object('statut',x->>'mass_balance_status','ecart',x->'variance_kg','ajust',x->'inventory_adjustments_kg','transit_ajust',x->'transit_adjustments_kg','cloture',x->'closing_stock_kg') from (select public.wms_daily_closing(wh,current_date) x) z));
  log := log || jsonb_build_object('s','V2-D2 Cloture BKE-003','res',(select jsonb_build_object('statut',x->>'mass_balance_status','ecart',x->'variance_kg','ajust',x->'inventory_adjustments_kg','transit_ajust',x->'transit_adjustments_kg','cloture',x->'closing_stock_kg','attendu',x->'expected_closing_kg') from (select public.wms_daily_closing(wh2,current_date) x) z));
  log := log || jsonb_build_object('s','V2-D3 Mouvement ecart','res',(select jsonb_agg(jsonb_build_object('type',m.type,'src',m.source_type,'dst',m.dest_type,'wh',w.code,'out',ml.qty_out,'in',ml.qty_in)) from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id join public.wms_warehouses w on w.id=m.warehouse_id where ml.lot_id=lot and m.type='ADJUSTMENT'));

  -- E19 bis : sortie production dans la limite du stock PLEIN (187 sacs pleins apres expedition)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_ISSUE','qty',150,'location',L,'idempotency_key','SIM2V2-PI'));
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_RETURN','qty',100,'location',L,'idempotency_key','SIM2V2-PR'));
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_CONSUMED','qty',50,'location',L,'idempotency_key','SIM2V2-PC'));
    log := log || jsonb_build_object('s','V2-E19 Sortie production 150 / retour 100 / consommation 50','ok',true,
      'solde_production',(select to_jsonb(v) from public.jute_v_production_balance v limit 1),
      'stock_bke002',(select jsonb_object_agg(state,qty) from public.rcn_jute_v_stock where location_code=L));
  exception when others then log := log || jsonb_build_object('s','V2-E19','ok',false,'err',SQLERRM); end;

  -- E26 bis : envoi reparation depuis un stock 100 % dechire, par un role non limite a un entrepot
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('SIM-J26','SIM-J26','SOLDE_INITIAL','INTERNE',50,L4,'DECHIRE','SIM','Ouverture BKE-004 dechires','ANAGROCI',now());
    r := public.wms_bag_move(jsonb_build_object('kind','REPAIR_OUT','location',L4,'qty',50,'idempotency_key','SIM2V2-J27'));
    log := log || jsonb_build_object('s','V2-E26 Envoi reparation 50 depuis stock 100 % dechire (BM)','ok',true,'stock_bke004',(select jsonb_object_agg(state,qty) from public.rcn_jute_v_stock where location_code=L4));
  exception when others then log := log || jsonb_build_object('s','V2-E26','ok',false,'err',SQLERRM); end;

  raise exception 'SIMULATION_RESULT %', log::text;
end
$sim$;
