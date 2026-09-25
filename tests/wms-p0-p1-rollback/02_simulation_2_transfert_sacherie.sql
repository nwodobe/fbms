-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- Simulation 2 : transfert inter-entrepôts et sacherie (script d'audit du 24/09, inchangé)
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
  r jsonb; x jsonb; t text; n int;
  rec text; lot text; bin_a text; bin_b text; trf text; st text;
  j_before jsonb; j_after jsonb; d3_before int; d4_before int;
  L text := 'BAG-WH-BKE-002'; L3 text := 'BAG-WH-BKE-003'; L4 text := 'BAG-WH-BKE-004'; LF text := 'BAG-WH-YAK-FWH'; L1 text := 'BAG-WH-BKE-001';
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'sim2-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_sk,'sk'),(u_sk3,'sk3'),(u_qa,'qa'),(u_bm,'bm'),(u_wm,'wm'),(u_bm2,'bm2')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'sim2-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_sk,'sk','Storekeeper','BKE-002'),(u_sk3,'sk3','Storekeeper','BKE-003'),(u_qa,'qa','QA / Lab',null),(u_bm,'bm','Branch Manager',null),
               (u_wm,'wm','Warehouse Manager','BKE-003'),(u_bm2,'bm2','Assistant Branch Manager',null)) v(id,k,ro,w);

  -- A. Doublon camion : plaque saisie avec espaces
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test','supplier_code','DIS-006-DIE','origin','Bouna',
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','GH 4455 CI'),'SIM2-A1');
    t := r->>'truck';
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test','supplier_code','DIS-006-DIE','origin','Bouna',
         'warehouse_id',wh,'arrival_at',(now()+interval '5 minute')::text,'driver','SIM','truck','GH4455CI'),'SIM2-A2');
    log := log || jsonb_build_object('s','A1 Doublon camion saisi "GH 4455 CI" puis "GH4455CI" (5 min)','ok',false,'constat','2e reception ACCEPTEE : doublon non detecte','truck1_stocke',t,'truck2_stocke',r->>'truck');
  exception when others then log := log || jsonb_build_object('s','A1 Doublon camion avec espaces','ok',true,'refus',SQLERRM,'truck1_stocke',t); end;

  -- B. Portee entrepot : un magasinier de BKE-003 opere une reception de BKE-002
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test portee','supplier_code','DIS-007-SPA','origin','Bondoukou',
         'warehouse_id',wh,'arrival_at',(now()+interval '3 hour')::text,'driver','SIM','truck','JK7788CI'),'SIM2-B1');
    log := log || jsonb_build_object('s','B1 Storekeeper affecte BKE-003 cree une reception a BKE-002','ok',false,'constat','ACCEPTE (pas de controle de perimetre entrepot)','id',r->>'id');
  exception when others then log := log || jsonb_build_object('s','B1 Perimetre entrepot','ok',true,'refus',SQLERRM); end;

  -- C. Preparation d un LOT en BIN a BKE-002 pour le transfert
  begin
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
    r := public.wms_release_lot(rec,'SIM2-REL');
    lot := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','DRY','capacity_kg',60000,'idempotency_key','SIM2-BIN-A'));
    bin_a := r->>'id';
    perform public.wms_allocate_lot_to_bin(lot, bin_a, 25000, 'SIM2-ALLOC');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh2,'stock_type','DRY','capacity_kg',60000,'idempotency_key','SIM2-BIN-B'));
    bin_b := r->>'id';
    log := log || jsonb_build_object('s','C1 LOT 25 000 kg en BIN BKE-002 + BIN destination BKE-003','ok',true,'lot',lot,'bin_origine',bin_a,'bin_dest',bin_b);
  exception when others then log := log || jsonb_build_object('s','C1 Preparation','ok',false,'err',SQLERRM); end;

  -- D. Transfert entrepot -> entrepot complet
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_trf_create_request(jsonb_build_object('origin_warehouse_id',wh,'dest_warehouse_id',wh2,'purpose','Consolidation stock','priority','NORMAL',
         'lines',jsonb_build_array(jsonb_build_object('bin_id',bin_a,'lot_id',lot,'qty',10000))),'SIM2-TRF-REQ');
    trf := r->>'id'; x := jsonb_build_object('D1_request',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_trf_approve(trf,'OK','SIM2-TRF-APP'); x := x || jsonb_build_object('D2_approve',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_trf_save_load(trf,jsonb_build_object('truck_plate','NP1122CI','driver_name','SIM','transporter','SIM Transport','seal_no','S-0001','bags_loaded',125,
         'gross_kg',22100,'tare_kg',12100,'net_kg',10000,'weighbridge_ref','PB-T-01','load_doc_ref','BL-T-01'),true,'SIM2-TRF-LOAD');
    x := x || jsonb_build_object('D3_load',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm2,'role','authenticated')::text,true);
    r := public.wms_trf_confirm_dispatch(trf,'SIM2-TRF-DISP'); x := x || jsonb_build_object('D4_dispatch',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
    r := public.wms_trf_register_arrival(trf,jsonb_build_object('warehouse_id',wh2,'receiver','SIM','truck','NP1122CI','seal_status','INTACT','seal_observed','S-0001'),'SIM2-TRF-ARR');
    x := x || jsonb_build_object('D5_arrival',r->>'status');
    r := public.wms_trf_confirm_receipt(trf,jsonb_build_object('gross_kg',22050,'tare_kg',12100,'net_kg',9950,'bags_received',124,'ticket','PB-D-01','dest_type','BIN','dest_bin_id',bin_b),'SIM2-TRF-REC');
    x := x || jsonb_build_object('D6_receipt',r->>'status','variance',r->>'variance_kg');
    log := log || jsonb_build_object('s','D Transfert BKE-002 -> BKE-003 (10 000 kg, recu 9 950)','ok',true,'res',x);
  exception when others then log := log || jsonb_build_object('s','D Transfert','ok',false,'etapes',x,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_wm,'role','authenticated')::text,true);
    r := public.wms_trf_resolve_discrepancy(trf,jsonb_build_object('category','WEIGHING_DIFFERENCE','detailed_reason','Ecart pont-bascule','responsible','Transporteur',
         'resolution','Perte transport acceptee','resolution_type','WRITE_OFF'),'SIM2-TRF-RES');
    x := jsonb_build_object('D7_resolve',coalesce(r->>'status',r::text));
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_trf_decide_resolution(trf,true,'Valide','SIM2-TRF-DEC'); x := x || jsonb_build_object('D8_decision',coalesce(r->>'status',r::text));
    r := public.wms_trf_close(trf,'Cloture','SIM2-TRF-CLOSE'); x := x || jsonb_build_object('D9_close',r->>'status');
    x := x || jsonb_build_object('stock_origine_bin',(select sum(qty) from public.wms_v_balances where location_type='BIN' and location_id=bin_a),
                                 'stock_dest_bin',(select sum(qty) from public.wms_v_balances where location_type='BIN' and location_id=bin_b),
                                 'transit',(select coalesce(sum(qty),0) from public.wms_v_balances where location_type='TRANSIT' and lot_id=lot),
                                 'mvts_sacs_lies_transfert',(select count(*) from public.rcn_jute_movements where reference=trf or source_id=trf));
    log := log || jsonb_build_object('s','D Resolution ecart + cloture','ok',true,'res',x);
  exception when others then log := log || jsonb_build_object('s','D Resolution/cloture','ok',false,'etapes',x,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    log := log || jsonb_build_object('s','D Cloture journaliere BKE-002','ok',true,'res',public.wms_daily_closing(wh,current_date)-'warehouse_id'-'date');
    log := log || jsonb_build_object('s','D Cloture journaliere BKE-003','ok',true,'res',public.wms_daily_closing(wh2,current_date)-'warehouse_id'-'date');
  exception when others then log := log || jsonb_build_object('s','D Clotures','ok',false,'err',SQLERRM); end;

  -- E. SACHERIE : 24 operations
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  select coalesce(jsonb_object_agg(state,qty),'{}'::jsonb) into j_before from public.rcn_jute_v_stock where location_code=L;
  select coalesce(balance,0) into d3_before from public.rcn_jute_v_supplier_balance where supplier_code='DIS-003-DEM';
  select coalesce(balance,0) into d4_before from public.rcn_jute_v_supplier_balance where supplier_code='DIS-004-ANA';
  d3_before := coalesce(d3_before,0); d4_before := coalesce(d4_before,0);
  log := log || jsonb_build_object('s','E00 Etat initial BKE-002 / dettes','ok',true,'stock',j_before,'dette_DIS003',d3_before,'dette_DIS004',d4_before);

  begin
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('SIM-J01','SIM-J01','SOLDE_INITIAL','INTERNE',5000,L,'UTILISABLE','SIM','Ouverture campagne','ANAGROCI',now()),
           ('SIM-J02','SIM-J02','SOLDE_INITIAL','INTERNE',300,L,'DECHIRE','SIM','Ouverture campagne','ANAGROCI',now()),
           ('SIM-J03','SIM-J03','ACHAT','INTERNE',2000,L,'UTILISABLE','SIM','Achat sacs neufs','ANAGROCI',now()),
           ('SIM-J04a','SIM-J04a','SOLDE_INITIAL','INTERNE',1500,L3,'UTILISABLE','SIM','Ouverture BKE-003','ANAGROCI',now());
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('SIM-J04','SIM-J04','TRANSFERT','INTERNE',1000,L3,'UTILISABLE',L,'UTILISABLE','SIM','Transfert entrant BKE-003','ANAGROCI',now());
    log := log || jsonb_build_object('s','E01-E04 Ouverture 5000 bons + 300 dechires, achat 2000, transfert entrant 1000 (hors ecran WMS)','ok',true);
  exception when others then log := log || jsonb_build_object('s','E01-E04','ok',false,'err',SQLERRM); end;

  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  declare
    ops jsonb := jsonb_build_array(
      jsonb_build_object('n','E05 Dotation fournisseur DIS-003 1200','kind','DOTATION','qty',1200,'supplier_code','DIS-003-DEM'),
      jsonb_build_object('n','E06 Dotation fournisseur DIS-004 800','kind','DOTATION','qty',800,'supplier_code','DIS-004-ANA'),
      jsonb_build_object('n','E07 Retour DIS-003 1000 (sans etat = defaut GOOD)','kind','RETURN','qty',1000,'supplier_code','DIS-003-DEM'),
      jsonb_build_object('n','E08 Retour DIS-003 150 endommages','kind','RETURN','qty',150,'supplier_code','DIS-003-DEM','condition','DAMAGED'),
      jsonb_build_object('n','E09 Retour DIS-004 30 humides','kind','RETURN','qty',30,'supplier_code','DIS-004-ANA','condition','WET'),
      jsonb_build_object('n','E10 Perte approuvee DIS-003 20','kind','APPROVED_LOSS','qty',20,'supplier_code','DIS-003-DEM','approved_by','BM','note','Sacs perdus en brousse'),
      jsonb_build_object('n','E11 Usage interne 400','kind','INTERNAL_USE','qty',400),
      jsonb_build_object('n','E12 Retour d usage 100','kind','RETURN_FROM_USE','qty',100),
      jsonb_build_object('n','E13 Declasses endommages 60','kind','DAMAGED','qty',60),
      jsonb_build_object('n','E14 Envoi reparation 200','kind','REPAIR_OUT','qty',200),
      jsonb_build_object('n','E15 Reconditionnes verifies 150','kind','RECONDITIONED','qty',150,'verified',true),
      jsonb_build_object('n','E16 Reconditionnes non verifies 30 (defaut ecran)','kind','RECONDITIONED','qty',30),
      jsonb_build_object('n','E17 Rebut 100','kind','SCRAP','qty',100),
      jsonb_build_object('n','E18 Re-ensachage RCN 250','kind','REBAGGING','qty',250,'bin_id','BIN-X','lot_id','LOT-X'),
      jsonb_build_object('n','E19 Sortie vers production 600','kind','PRODUCTION_ISSUE','qty',600),
      jsonb_build_object('n','E20 Dotation 99999 (stock negatif)','kind','DOTATION','qty',99999,'supplier_code','DIS-003-DEM'),
      jsonb_build_object('n','E21 Retour DIS-003 5000 (> dette)','kind','RETURN','qty',5000,'supplier_code','DIS-003-DEM')
    );
    o jsonb;
  begin
    for o in select * from jsonb_array_elements(ops) loop
      begin
        r := public.wms_bag_move((o - 'n') || jsonb_build_object('location',L,'idempotency_key','SIM2-'||(o->>'n')));
        log := log || jsonb_build_object('s',o->>'n','ok',true,'lignes',jsonb_array_length(r->'ids'));
      exception when others then log := log || jsonb_build_object('s',o->>'n','ok',false,'refus',SQLERRM); end;
    end loop;
  end;

  -- Production (pas de type dedie) : via transferts directs vers l usine
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('SIM-J19','SIM-J19','TRANSFERT','INTERNE',600,L,'UTILISABLE',LF,'UTILISABLE','SIM','Sortie production (contournement)','ANAGROCI',now()),
           ('SIM-J20','SIM-J20','TRANSFERT','INTERNE',100,LF,'UTILISABLE',L,'UTILISABLE','SIM','Retour production (contournement)','ANAGROCI',now()),
           ('SIM-J21','SIM-J21','TRANSFERT','INTERNE',500,L,'UTILISABLE',L1,'UTILISABLE','SIM','Transfert sortant BKE-001','ANAGROCI',now()),
           ('SIM-J22','SIM-J22','AJUSTEMENT_INVENTAIRE','INTERNE',10,L,'UTILISABLE',null,null,'SIM','Ecart inventaire -10','ANAGROCI',now());
    log := log || jsonb_build_object('s','E22-E25 Production 600 / retour 100 / transfert sortant 500 / ajustement -10 (hors ecran WMS)','ok',true);
  exception when others then log := log || jsonb_build_object('s','E22-E25','ok',false,'err',SQLERRM); end;

  -- Bug pre-controle REPAIR_OUT : emplacement avec uniquement des sacs dechires
  begin
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('SIM-J26','SIM-J26','SOLDE_INITIAL','INTERNE',50,L4,'DECHIRE','SIM','Ouverture BKE-004 dechires','ANAGROCI',now());
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_bag_move(jsonb_build_object('kind','REPAIR_OUT','location',L4,'qty',50,'idempotency_key','SIM2-J27'));
    log := log || jsonb_build_object('s','E26 Envoi reparation 50 depuis un stock 100 % dechire','ok',true);
  exception when others then log := log || jsonb_build_object('s','E26 Envoi reparation 50 depuis un stock 100 % dechire','ok',false,'refus',SQLERRM); end;

  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  select coalesce(jsonb_object_agg(state,qty),'{}'::jsonb) into j_after from public.rcn_jute_v_stock where location_code=L;
  log := log || jsonb_build_object('s','E99 Stock final BKE-002 par etat (rcn_jute_v_stock)','ok',true,'stock',j_after,
     'total',(select sum(qty) from public.rcn_jute_v_stock where location_code=L),
     'dette_DIS003_delta',(select coalesce(balance,0) from public.rcn_jute_v_supplier_balance where supplier_code='DIS-003-DEM')-d3_before,
     'dette_DIS004_delta',(select coalesce(balance,0) from public.rcn_jute_v_supplier_balance where supplier_code='DIS-004-ANA')-d4_before,
     'usine_YAK',(select coalesce(jsonb_object_agg(state,qty),'{}'::jsonb) from public.rcn_jute_v_stock where location_code=LF and state='UTILISABLE'),
     'mvts_par_type',(select jsonb_object_agg(k,c) from (select movement_type||'/'||ledger k,count(*) c from public.rcn_jute_movements where (from_location=L or to_location=L or event_key like 'WMS:SIM2-%') group by 1) z));

  raise exception 'SIMULATION_RESULT %', log::text;
end
$sim$;
