-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- Lots 3-4 : rôles, rattachement Warehouse, séparation des tâches, sacherie automatique (P0-04, P1-01 à P1-05)
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
  u_proc uuid := gen_random_uuid(); u_sk uuid := gen_random_uuid(); u_sk3 uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid();
  u_bm uuid := gen_random_uuid(); u_bm2 uuid := gen_random_uuid(); u_gm uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid();
  u_finm uuid := gen_random_uuid(); u_view uuid := gen_random_uuid(); u_tgt uuid := gen_random_uuid(); u_fac uuid := gen_random_uuid(); u_wm3 uuid := gen_random_uuid();
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281'; wh2 uuid := 'fc36b09a-a75a-451a-a2ea-8bbf7f752bd3';
  L text := 'BAG-WH-BKE-002'; L3 text := 'BAG-WH-BKE-003'; LF text := 'BAG-WH-YAK-FWH';
  r jsonb; x jsonb; t text; n int; rec text; lot text; pur uuid; bap text; pay text; bin_a text; bin_b text; trf text; d_before int;
  pr record;
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'sim3-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_proc,'proc'),(u_sk,'sk'),(u_sk3,'sk3'),(u_qa,'qa'),(u_bm,'bm'),(u_bm2,'bm2'),(u_gm,'gm'),(u_fin,'fin'),(u_finm,'finm'),(u_view,'view'),(u_tgt,'tgt'),(u_fac,'fac'),(u_wm3,'wm3')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code)
  select v.id,'sim3-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.k,v.ro,true,v.w
  from (values (u_proc,'proc','Procurement Officer',null),(u_sk,'sk','Storekeeper','BKE-002'),(u_sk3,'sk3','Storekeeper','BKE-003'),(u_qa,'qa','QA / Lab',null),
               (u_bm,'bm','Branch Manager',null),(u_bm2,'bm2','Assistant Branch Manager',null),(u_gm,'gm','General Manager',null),(u_fin,'fin','Finance',null),
               (u_finm,'finm','Finance Manager',null),(u_view,'view','Viewer / Auditor',null),(u_tgt,'tgt','Viewer / Auditor',null),(u_fac,'fac','Factory User','YAK-FWH'),
               (u_wm3,'wm3','Warehouse Manager','BKE-003')) v(id,k,ro,w);
  log := log || jsonb_build_object('t','L3-0 profil Finance Manager cree par procedure administrateur (SQL)','ok',exists(select 1 from public.profils where user_id=u_finm and role='Finance Manager'));

  -- L3a affectation des profils
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_assign_warehouse_profile(u_tgt,'Storekeeper','bke-002','Pilote BKE-002');
    log := log || jsonb_build_object('t','L3a BM affecte Storekeeper BKE-002','ok',(r->>'warehouse_code')='BKE-002','res',r);
  exception when others then log := log || jsonb_build_object('t','L3a affectation','ok',false,'err',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_assign_warehouse_profile(u_tgt,'Finance Manager',null,'test');
    log := log || jsonb_build_object('t','L3b BM attribue Finance Manager','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','L3b BM attribue Finance Manager refuse','ok',true,'refus',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_assign_warehouse_profile(u_tgt,'Warehouse Manager',null,'test');
    log := log || jsonb_build_object('t','L3c role rattache sans Warehouse','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','L3c role rattache sans Warehouse refuse','ok',true,'refus',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_view,'role','authenticated')::text,true);
    r := public.wms_assign_warehouse_profile(u_tgt,'QA / Lab',null,'test');
    log := log || jsonb_build_object('t','L3d Viewer affecte un profil','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','L3d Viewer affecte un profil refuse','ok',true,'refus',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    set local role authenticated;
    update public.profils set role='Finance Manager' where user_id=u_tgt;
    reset role;
    log := log || jsonb_build_object('t','L3e BM passe un compte en Finance Manager par mise a jour directe','ok',false,'constat','ACCEPTE');
  exception when others then reset role; log := log || jsonb_build_object('t','L3e mise a jour directe Finance Manager refusee','ok',true,'refus',SQLERRM); end;

  -- Amorce sacherie (procedure administrateur hors ecran) : 1 000 sacs utilisables + 50 dechires a BKE-002, 300 pleins a l usine
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,source_type,reference,owner_type,movement_at)
  values ('SIM3-J01','SIM3-J01','SOLDE_INITIAL','INTERNE',1000,L,'UTILISABLE','SIM','Ouverture test','ANAGROCI',now()),
         ('SIM3-J02','SIM3-J02','SOLDE_INITIAL','INTERNE',50,L,'DECHIRE','SIM','Ouverture test','ANAGROCI',now()),
         ('SIM3-J03','SIM3-J03','SOLDE_INITIAL','INTERNE',300,LF,'PLEIN','SIM','Ouverture test usine','ANAGROCI',now());
  select coalesce(sum(case when movement_type in ('SOLDE_INITIAL','DOTATION') then qty when movement_type in ('RETOUR','PERTE_APPROUVEE') then -qty else 0 end),0)
    into d_before from public.rcn_jute_movements where ledger='FOURNISSEUR' and supplier_code='DIS-003-DEM';
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_bag_move(jsonb_build_object('kind','DOTATION','location',L,'qty',200,'supplier_code','DIS-003-DEM','idempotency_key','SIM3-DOT'));
    log := log || jsonb_build_object('t','L4-0 dotation 200 sacs au fournisseur','ok',true,'dette_avant',d_before);
  exception when others then log := log || jsonb_build_object('t','L4-0 dotation','ok',false,'err',SQLERRM); end;

  -- L3f chaine SoD complete (bon role : succes / mauvais role : refus)
  begin
    x := '{}'::jsonb;
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Chaine SoD','supplier_code','DIS-003-DEM','origin','Dabakala',
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','SIM3001'),'SIM3-REC');
    rec := r->>'id'; x := x || jsonb_build_object('1_PO_reception',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',280,'imm_g',20,'spotted_g',10,'moisture_pct',9.5,'idempotency_key','SIM3-Q1'));
    x := x || jsonb_build_object('2_QA_sampling',r->'reception'->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception_v2(rec,true,'OK',null); x := x || jsonb_build_object('3_BM_decision',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec, jsonb_build_object('gross_kg',42350,'tare_kg',12150,'bags',380,'bags_good',370,'bags_wet',5,'bags_torn',5));
    lot := r->>'lot_id'; x := x || jsonb_build_object('4_SK_offload',r->>'status','lot',lot);
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec,'FINAL',jsonb_build_object('gk_g',276,'imm_g',22,'spotted_g',12,'moisture_pct',9.8,'idempotency_key','SIM3-Q2'));
    r := public.wms_release_lot(rec,'SIM3-REL'); x := x || jsonb_build_object('5_QA_release',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_save_purchase_draft(rec, jsonb_build_object('negotiated_price',400)); pur := (r->>'id')::uuid; x := x || jsonb_build_object('6_PO_draft',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.procurement_submit_purchase(pur,null,null); x := x || jsonb_build_object('7_BM_submit',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_gm,'role','authenticated')::text,true);
    r := public.procurement_approve_purchase(pur,null,'OK'); bap := r->>'bap_id'; x := x || jsonb_build_object('8_GM_approve',r->>'status','bap',bap);
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_submit_bap(bap,'FAC-SIM3-001',current_date,null); x := x || jsonb_build_object('9_PO_submit_bap',coalesce(r->>'statut',r->>'status'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_fin,'role','authenticated')::text,true);
    r := public.procurement_decide_bap(bap,true,'Conforme'); x := x || jsonb_build_object('10_FIN_decide_bap',coalesce(r->>'statut',r->>'status'));
    r := public.procurement_record_payment(bap,6000000,'VIREMENT',current_date,'VIR-SIM3-1','SIM Bank',null,'Acompte'); pay := r->>'id';
    x := x || jsonb_build_object('11_FIN_payment',pay);
    perform set_config('request.jwt.claims',json_build_object('sub',u_finm,'role','authenticated')::text,true);
    r := public.procurement_reconcile_payment(pay,true,'Releve bancaire OK'); x := x || jsonb_build_object('12_FINM_reconcile',r->>'statut');
    log := log || jsonb_build_object('t','L3f chaine SoD PO > SK > QA > BM > GM > Finance > Finance Manager','ok',true,'res',x);
  exception when others then log := log || jsonb_build_object('t','L3f chaine SoD','ok',false,'err',SQLERRM,'res',x); end;

  -- Mauvais roles
  for pr in select * from (values
      ('PO decharge', u_proc, 'offload'), ('Storekeeper decide arrivee', u_sk, 'decide'), ('Finance soumet achat', u_fin, 'submit'),
      ('BM approuve achat', u_bm, 'approve'), ('QA approuve achat', u_qa, 'approve'), ('Storekeeper decide BAP', u_sk, 'bap'),
      ('Finance rapproche paiement', u_fin, 'reconcile'), ('Viewer libere lot', u_view, 'release')) v(label, uid, act) loop
    begin
      perform set_config('request.jwt.claims',json_build_object('sub',pr.uid,'role','authenticated')::text,true);
      if pr.act = 'offload' then r := public.wms_record_offload(rec, jsonb_build_object('gross_kg',2,'tare_kg',1));
      elsif pr.act = 'decide' then r := public.wms_decide_reception_v2(rec,true,'x',null);
      elsif pr.act = 'submit' then r := public.procurement_submit_purchase(pur,null,null);
      elsif pr.act = 'approve' then r := public.procurement_approve_purchase(pur,null,'x');
      elsif pr.act = 'bap' then r := public.procurement_decide_bap(bap,true,'x');
      elsif pr.act = 'reconcile' then r := public.procurement_reconcile_payment(pay,true,'x');
      elsif pr.act = 'release' then r := public.wms_release_lot(rec,'x');
      end if;
      log := log || jsonb_build_object('t','L3g mauvais role : '||pr.label,'ok',false,'constat','ACCEPTE');
    exception when others then log := log || jsonb_build_object('t','L3g mauvais role : '||pr.label,'ok',true,'refus',SQLERRM); end;
  end loop;

  -- L4a sacs automatiques au dechargement
  begin
    log := log || jsonb_build_object('t','L4a mouvements sacs automatiques au dechargement','ok',
       (select count(*) from public.rcn_jute_movements where reception_id=rec and ledger='INTERNE' and movement_type='RECU_LIVRAISON')=3,
       'lignes',(select jsonb_agg(jsonb_build_object('type',movement_type,'ledger',ledger,'qty',qty,'to',to_location,'etat',to_state,'condition',bag_condition,'lot',lot_id,'fournisseur',supplier_code,'source',source_type||':'||source_id,'ref',reference) order by ledger, movement_type) from public.rcn_jute_movements where reception_id=rec),
       'dette_avant_dotation',d_before,
       'dette_apres',(select balance from public.jute_v_supplier_balance where supplier_code='DIS-003-DEM'),
       'recu_avec_livraison',(select received_with_delivery from public.jute_v_supplier_balance where supplier_code='DIS-003-DEM'));
  exception when others then log := log || jsonb_build_object('t','L4a','ok',false,'err',SQLERRM); end;

  -- L4b visibilite Storekeeper (RLS)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    set local role authenticated;
    x := jsonb_build_object('emplacements',(select jsonb_agg(code order by code) from public.rcn_jute_locations),
                            'mouvements_visibles',(select count(*) from public.rcn_jute_movements),
                            'mouvements_hors_perimetre',(select count(*) from public.rcn_jute_movements where coalesce(from_location,'')<>L and coalesce(to_location,'')<>L and reception_id is null),
                            'stock',(select jsonb_agg(jsonb_build_object('loc',location_code,'etat',state,'qty',qty)) from public.rcn_jute_v_stock));
    reset role;
    log := log || jsonb_build_object('t','L4b lecture sacherie Storekeeper BKE-002','ok',(x->>'mouvements_visibles')::int>0 and (x->>'mouvements_hors_perimetre')::int=0,'res',x);
  exception when others then reset role; log := log || jsonb_build_object('t','L4b RLS Storekeeper','ok',false,'err',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_bag_move(jsonb_build_object('kind','DAMAGED','location',L3,'qty',1,'idempotency_key','SIM3-HORS'));
    log := log || jsonb_build_object('t','L4c Storekeeper BKE-002 mouvemente les sacs de BKE-003','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','L4c mouvement sacs hors perimetre refuse','ok',true,'refus',SQLERRM); end;

  -- L4d etats : reparation, reconditionnement verifie, rebut hors stock
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_bag_move(jsonb_build_object('kind','REPAIR_OUT','location',L,'qty',50,'idempotency_key','SIM3-REP'));
    r := public.wms_bag_move(jsonb_build_object('kind','RECONDITIONED','location',L,'qty',40,'verified',true,'idempotency_key','SIM3-RECOND'));
    r := public.wms_bag_move(jsonb_build_object('kind','SCRAP','location',L,'qty',10,'from_state','A_REPARER','idempotency_key','SIM3-SCRAP'));
    log := log || jsonb_build_object('t','L4d reparation 50 / reconditionnes verifies 40 / rebut 10','ok',true,
      'stock_BKE002',(select jsonb_object_agg(state,qty) from public.rcn_jute_v_stock where location_code=L),
      'rebut',(select jsonb_object_agg(state,qty) from public.rcn_jute_v_stock where location_code='JUTE-REBUT'));
  exception when others then log := log || jsonb_build_object('t','L4d etats sacs','ok',false,'err',SQLERRM); end;

  -- L4e production
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_fac,'role','authenticated')::text,true);
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_ISSUE','location',LF,'qty',300,'idempotency_key','SIM3-PI'));
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_RETURN','location',LF,'qty',100,'condition','GOOD','idempotency_key','SIM3-PR1'));
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_RETURN','location',LF,'qty',20,'condition','DAMAGED','idempotency_key','SIM3-PR2'));
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_CONSUMED','location',LF,'qty',150,'idempotency_key','SIM3-PC'));
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_SCRAP','location',LF,'qty',10,'idempotency_key','SIM3-PS'));
    x := (select to_jsonb(v) from public.jute_v_production_balance v where production_location='JUTE-PRODUCTION-YAK');
    log := log || jsonb_build_object('t','L4e production : sortie 300, retour 100+20, consomme 150, rebut 10','ok',(x->>'balance')::int=20,'res',x,
      'usine',(select jsonb_object_agg(state,qty) from public.rcn_jute_v_stock where location_code=LF));
  exception when others then log := log || jsonb_build_object('t','L4e production','ok',false,'err',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_fac,'role','authenticated')::text,true);
    r := public.wms_bag_move(jsonb_build_object('kind','PRODUCTION_CONSUMED','location',LF,'qty',500,'idempotency_key','SIM3-PC2'));
    log := log || jsonb_build_object('t','L4e2 consommation superieure au solde production','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','L4e2 consommation superieure au solde production refusee','ok',true,'refus',SQLERRM); end;

  -- L4f transfert avec sacs
  begin
    x := '{}'::jsonb;
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','DRY','capacity_kg',60000,'idempotency_key','SIM3-BIN-A'));
    bin_a := r->>'id';
    perform public.wms_allocate_lot_to_bin(lot, bin_a, 25000, 'SIM3-ALLOC');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh2,'stock_type','DRY','capacity_kg',60000,'idempotency_key','SIM3-BIN-B'));
    bin_b := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_trf_create_request(jsonb_build_object('origin_warehouse_id',wh,'dest_warehouse_id',wh2,'purpose','Consolidation stock','priority','NORMAL',
         'lines',jsonb_build_array(jsonb_build_object('bin_id',bin_a,'lot_id',lot,'qty',10000))),'SIM3-TRF-REQ');
    trf := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_trf_approve(trf,'OK','SIM3-TRF-APP');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_trf_save_load(trf,jsonb_build_object('truck_plate','SIM3T01','driver_name','SIM','transporter','SIM Transport','seal_no','S-0001','bags_loaded',125,
         'gross_kg',22100,'tare_kg',12100,'net_kg',10000,'weighbridge_ref','PB-T-01','load_doc_ref','BL-T-01'),true,'SIM3-TRF-LOAD');
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm2,'role','authenticated')::text,true);
    r := public.wms_trf_confirm_dispatch(trf,'SIM3-TRF-DISP'); x := x || jsonb_build_object('dispatch',r->>'status');
    x := x || jsonb_build_object('sacs_en_transit_apres_depart',(select coalesce(sum(qty),0) from public.rcn_jute_movements where event_key='WMS-TRF:'||trf||':OUT'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
    r := public.wms_trf_register_arrival(trf,jsonb_build_object('warehouse_id',wh2,'receiver','SIM','truck','SIM3T01','seal_status','INTACT','seal_observed','S-0001'),'SIM3-TRF-ARR');
    r := public.wms_trf_confirm_receipt(trf,jsonb_build_object('gross_kg',22100,'tare_kg',12100,'net_kg',10000,'bags_received',124,'ticket','PB-D-01','dest_type','BIN','dest_bin_id',bin_b),'SIM3-TRF-REC');
    x := x || jsonb_build_object('receipt',r->>'status','sacs_recus_BKE003',(select coalesce(sum(qty),0) from public.rcn_jute_movements where event_key='WMS-TRF:'||trf||':IN'),
       'sacs_restant_transit',(select coalesce(sum(qty),0) from public.rcn_jute_movements where event_key='WMS-TRF:'||trf||':OUT')-(select coalesce(sum(qty),0) from public.rcn_jute_movements where event_key='WMS-TRF:'||trf||':IN'),
       'plein_BKE002',(select qty from public.rcn_jute_v_stock where location_code=L and state='PLEIN'),
       'plein_BKE003',(select qty from public.rcn_jute_v_stock where location_code=L3 and state='PLEIN'));
    log := log || jsonb_build_object('t','L4f transfert 125 sacs charges, 124 recus','ok',(x->>'sacs_recus_BKE003')::int=124,'res',x);
  exception when others then log := log || jsonb_build_object('t','L4f transfert avec sacs','ok',false,'err',SQLERRM,'res',x); end;

  -- L4g soldes
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    log := log || jsonb_build_object('t','L4g solde de cloture sacherie BKE-002 (vue + fonction)','ok',
      (select variance from public.jute_v_warehouse_closing_balance where location_code=L)=0,
      'vue',(select to_jsonb(v) from public.jute_v_warehouse_closing_balance v where location_code=L),
      'periode',public.jute_warehouse_closing(L,current_date,current_date));
  exception when others then log := log || jsonb_build_object('t','L4g soldes','ok',false,'err',SQLERRM); end;

  raise exception 'SIMULATION_RESULT %', log::text;
end
$sim$;
