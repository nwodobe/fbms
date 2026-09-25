-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- Simulation 1 v2 : réception RCN complète (script d'audit du 24/09, seul changement : le Storekeeper de test est rattaché au Warehouse BKE-002, rattachement désormais obligatoire)
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
  u_proc uuid := gen_random_uuid(); u_sk uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid();
  u_bm uuid := gen_random_uuid(); u_gm uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_view uuid := gen_random_uuid();
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';   -- BKE-002
  wh2 uuid := 'fc36b09a-a75a-451a-a2ea-8bbf7f752bd3';  -- BKE-003
  sup text := 'DIS-003-DEM';
  r jsonb; x jsonb; n int; t text;
  arr_id text; rec_id text; lot text; area uuid; bin_wet text; bin_dry text; bin_other text;
  pur uuid; bap text; pay1 text; dry text; rec2 text; lot2 text; pur2 uuid; rec3 text;
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'sim-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_proc,'proc'),(u_sk,'sk'),(u_qa,'qa'),(u_bm,'bm'),(u_gm,'gm'),(u_fin,'fin'),(u_view,'view')) v(id,k);
  -- Seule difference avec la version du 24/09 : le Storekeeper est rattache a BKE-002 (configuration pilote).
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code)
  select v.id,'sim-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,case when v.ro='Storekeeper' then 'BKE-002' end
  from (values (u_proc,'proc','Procurement Officer'),(u_sk,'sk','Storekeeper'),(u_qa,'qa','QA / Lab'),(u_bm,'bm','Branch Manager'),
               (u_gm,'gm','General Manager'),(u_fin,'fin','Finance'),(u_view,'view','Viewer / Auditor')) v(id,k,ro);

  -- S01 Delivery plan
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_schedule_supplier_arrival(jsonb_build_object('purchase_type','DIRECT','supplier_code',sup,'origin','Dabakala',
         'warehouse_id',wh,'expected_kg',30000,'expected_bags',380,'expected_at',(now()+interval '2 hour')::text,'truck','AB 1234 CI',
         'driver','SIM Chauffeur','transporter','SIM Transport','reference','SIM-PLAN-001'));
    arr_id := r->>'id';
    log := log || jsonb_build_object('s','S01 Delivery Plan (Procurement Officer)','ok',true,'id',arr_id,'statut',r->>'statut','truck_payload',r->'payload'->>'truck');
  exception when others then log := log || jsonb_build_object('s','S01 Delivery Plan','ok',false,'err',SQLERRM); end;

  -- S02 Confirmation arrivage
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_confirm_supplier_arrival(arr_id,'Confirme par telephone');
    log := log || jsonb_build_object('s','S02 Confirmation arrivage','ok',true,'statut',r->>'statut');
  exception when others then log := log || jsonb_build_object('s','S02 Confirmation arrivage','ok',false,'err',SQLERRM); end;

  -- S03 Visible cote Warehouse ?
  begin
    select count(*) into n from public.procurement_v_pending_receptions where source_id=arr_id;
    log := log || jsonb_build_object('s','S03 Arrivage visible dans procurement_v_pending_receptions','ok',n>0,'rows',n);
  exception when others then log := log || jsonb_build_object('s','S03 Pending view','ok',false,'err',SQLERRM); end;

  -- S04 Arrivee camion (Storekeeper)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','procurement_source_type','SUPPLIER_ARRIVAL','procurement_source_id',arr_id,
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM Chauffeur','truck','AB 1234 CI','delivery_note_present',true,'delivery_note','BL-SIM-001'),'SIM-IDEM-REC-1');
    rec_id := r->>'id';
    select statut into t from public.rcn_proc_arrivages where id=arr_id;
    log := log || jsonb_build_object('s','S04 Arrivee camion / reception','ok',true,'id',rec_id,'status',r->>'status','truck_stocke',r->>'truck',
           'expected_kg',r->>'expected_kg','expected_bags',r->>'expected_bags','supplier',r->>'supplier_code','statut_arrivage_apres',t);
  exception when others then log := log || jsonb_build_object('s','S04 Arrivee camion','ok',false,'err',SQLERRM); end;

  -- S05 Idempotence
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','procurement_source_type','SUPPLIER_ARRIVAL','procurement_source_id',arr_id,
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM Chauffeur','truck','AB 1234 CI'),'SIM-IDEM-REC-1');
    log := log || jsonb_build_object('s','S05 Rejeu meme cle idempotence','ok',(r->>'id')=rec_id,'id',r->>'id');
  exception when others then log := log || jsonb_build_object('s','S05 Idempotence','ok',false,'err',SQLERRM); end;

  -- S06 Doublon camion (meme plaque sans espaces, 10 min apres)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test doublon','supplier_code',sup,'origin','Dabakala',
         'warehouse_id',wh,'arrival_at',(now()+interval '10 minute')::text,'driver','SIM','truck','AB1234CI'),'SIM-IDEM-DUP');
    log := log || jsonb_build_object('s','S06 Detection doublon camion AB 1234 CI vs AB1234CI','ok',false,'constat','ACCEPTE : doublon NON detecte','id',r->>'id','truck',r->>'truck');
  exception when others then log := log || jsonb_build_object('s','S06 Detection doublon camion','ok',true,'refus',SQLERRM); end;

  -- S07 Dechargement avant decision
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec_id, jsonb_build_object('gross_kg',42350,'tare_kg',12150));
    log := log || jsonb_build_object('s','S07 Dechargement avant decision','ok',false,'constat','ACCEPTE (anomalie)');
  exception when others then log := log || jsonb_build_object('s','S07 Dechargement avant decision bloque','ok',true,'refus',SQLERRM); end;

  -- S08 Echantillonnage
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec_id,'SAMPLING',jsonb_build_object('gk_g',280,'imm_g',20,'spotted_g',10,'moisture_pct',9.5,'nut_count',195,'idempotency_key','SIM-Q1'));
    log := log || jsonb_build_object('s','S08 Echantillonnage qualite (QA)','ok',true,'kor',r->'snapshot'->>'kor_display','status',r->'reception'->>'status');
  exception when others then log := log || jsonb_build_object('s','S08 Echantillonnage','ok',false,'err',SQLERRM); end;

  -- S09 Decision par Storekeeper (doit etre refusee)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_decide_reception(rec_id,true,'x');
    log := log || jsonb_build_object('s','S09 Decision par Storekeeper','ok',false,'constat','ACCEPTE (anomalie SoD)');
  exception when others then log := log || jsonb_build_object('s','S09 Decision par Storekeeper refusee','ok',true,'refus',SQLERRM); end;

  -- S10 Decision Accepted (BM)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception(rec_id,true,'Conforme a l echantillon');
    log := log || jsonb_build_object('s','S10 Decision ACCEPTED (BM)','ok',true,'status',r->>'status');
  exception when others then log := log || jsonb_build_object('s','S10 Decision','ok',false,'err',SQLERRM); end;

  -- S11 Pesee + dechargement
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec_id, jsonb_build_object('gross_kg',42350,'tare_kg',12150,'net_kg',30200,'bags',380,'bags_good',370,'bags_wet',5,'bags_torn',5,
         'weighbridge_ticket','PB-SIM-001','warehouse_receipt','GRN-MANUEL-001','offload_start',now()::text,'offload_end',(now()+interval '90 minute')::text));
    log := log || jsonb_build_object('s','S11 Pesee brut/tare/net + dechargement','ok',true,'net',r->>'net_kg','bags',r->>'bags','status',r->>'status');
  exception when others then log := log || jsonb_build_object('s','S11 Pesee/dechargement','ok',false,'err',SQLERRM); end;

  -- S11b Stock visible apres dechargement mais avant liberation du LOT ?
  begin
    log := log || jsonb_build_object('s','S11b Stock ledger apres dechargement (avant LOT)','ok',true,
      'mouvements_stock_pour_reception',(select count(*) from public.wms_movements where reference_id=rec_id),
      'net_kg_reception',(select net_kg from public.wms_receptions where id=rec_id));
  exception when others then log := log || jsonb_build_object('s','S11b','ok',false,'err',SQLERRM); end;

  -- S12 Reglement commercial (brouillon) avant qualite finale
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_save_purchase_draft(rec_id, jsonb_build_object('refraction_mode','PERCENT','refraction_value',1,'refraction_reason','Humidite / impuretes','negotiated_price',400));
    pur := (r->>'id')::uuid;
    log := log || jsonb_build_object('s','S12 Refraction + Paid weight (brouillon achat)','ok',true,'code',r->>'purchase_code','net_snapshot',r->>'net_kg_snapshot',
          'refraction_kg',r->>'refraction_kg','paid_weight',r->>'paid_weight_kg','montant',r->>'amount_payable','status',r->>'status');
  exception when others then log := log || jsonb_build_object('s','S12 Brouillon achat','ok',false,'err',SQLERRM); end;

  -- S13 Qualite finale
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec_id,'FINAL',jsonb_build_object('gk_g',276,'imm_g',22,'spotted_g',12,'moisture_pct',9.8,'nut_count',198,'idempotency_key','SIM-Q2'));
    log := log || jsonb_build_object('s','S13 Qualite finale','ok',true,'kor',r->'snapshot'->>'kor_display','delta',r->'snapshot'->>'delta_vs_sampling','within_tol',r->'snapshot'->>'within_tolerance','status',r->'reception'->>'status');
  exception when others then log := log || jsonb_build_object('s','S13 Qualite finale','ok',false,'err',SQLERRM); end;

  -- S14 Liberation LOT
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_release_lot(rec_id,'SIM-REL-1');
    lot := r->>'id';
    log := log || jsonb_build_object('s','S14 Creation / liberation LOT','ok',true,'lot',lot,'initial_kg',r->>'initial_kg','initial_bags',r->>'initial_bags','movement',r->>'movement');
  exception when others then log := log || jsonb_build_object('s','S14 Liberation LOT','ok',false,'err',SQLERRM); end;

  -- S15 Zone physique + BIN
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_upsert_area(jsonb_build_object('warehouse_id',wh,'code','SIM-Z01','description','Allee A rangee 1','capacity_kg',150000));
    area := (r->>'id')::uuid;
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'physical_area_id',area,'stock_type','WET','capacity_kg',100000,'idempotency_key','SIM-BIN-1'));
    bin_wet := r->>'id';
    log := log || jsonb_build_object('s','S15 Zone physique + BIN','ok',true,'area',area,'bin',bin_wet,'bin_status',r->>'status');
  exception when others then log := log || jsonb_build_object('s','S15 Zone + BIN','ok',false,'err',SQLERRM); end;

  -- S16 Affectation LOT -> BIN
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_allocate_lot_to_bin(lot, bin_wet, 30200, 'SIM-ALLOC-1');
    log := log || jsonb_build_object('s','S16 Affectation LOT -> BIN','ok',true,'mov',r->>'id','type',r->>'type',
      'localisation',(select jsonb_agg(jsonb_build_object('type',location_type,'id',location_id,'kg',qty)) from public.wms_v_balances where lot_id=lot and qty<>0));
  exception when others then log := log || jsonb_build_object('s','S16 Affectation','ok',false,'err',SQLERRM); end;

  -- S17 Circuit reglement : soumission, approbation, BAP, paiement
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.procurement_submit_purchase(pur,null,null);
    perform set_config('request.jwt.claims',json_build_object('sub',u_gm,'role','authenticated')::text,true);
    r := public.procurement_approve_purchase(pur,null,'OK');
    bap := r->>'bap_id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_submit_bap(bap,'FAC-SIM-001',current_date,null);
    perform set_config('request.jwt.claims',json_build_object('sub',u_fin,'role','authenticated')::text,true);
    r := public.procurement_decide_bap(bap,true,'Conforme');
    r := public.procurement_record_payment(bap,6000000,'VIREMENT',current_date,'VIR-SIM-1','SIM Bank',null,'Acompte');
    pay1 := r->>'id';
    log := log || jsonb_build_object('s','S17 Soumission/approbation/BAP/paiement 1','ok',true,'bap',bap,
      'montant_bap',(select montant_approuve from public.rcn_proc_bons_payer where id=bap),'paiement1',pay1);
  exception when others then log := log || jsonb_build_object('s','S17 Circuit reglement','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_fin,'role','authenticated')::text,true);
    r := public.procurement_record_payment(bap,6000000,'VIREMENT',current_date,'VIR-SIM-2','SIM Bank',null,'Solde');
    log := log || jsonb_build_object('s','S17b Surpaiement (12 000 000 > montant BAP)','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('s','S17b Surpaiement bloque','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_gm,'role','authenticated')::text,true);
    r := public.procurement_reconcile_payment(pay1,true,'Releve bancaire OK');
    log := log || jsonb_build_object('s','S17c Rapprochement (GM)','ok',true,'paiement',r->>'statut','bap',(select statut from public.rcn_proc_bons_payer where id=bap));
  exception when others then log := log || jsonb_build_object('s','S17c Rapprochement','ok',false,'err',SQLERRM); end;

  -- S18 Sechage
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','DRY','capacity_kg',100000,'idempotency_key','SIM-BIN-2'));
    bin_dry := r->>'id';
    r := public.wms_create_drying(jsonb_build_object('type','DRYING','source_bin_id',bin_wet,'dest_bin_id',bin_dry,'input_kg',10000,'output_kg',9650,
         'input_bags',125,'output_bags',121,'moisture_before',11.5,'moisture_after',8.2,'idempotency_key','SIM-DRY-1'));
    dry := r->>'id';
    log := log || jsonb_build_object('s','S18 Sechage (enregistre en une fois)','ok',true,'dry',dry,'loss_kg',r->>'process_loss_kg','loss_pct',r->>'process_loss_pct',
       'status_apres',(select status from public.wms_dryings where id=dry));
  exception when others then log := log || jsonb_build_object('s','S18 Sechage','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_post_dry_quality(dry, lot, jsonb_build_object('gk_g',278,'imm_g',20,'spotted_g',10,'moisture_pct',8.2,'disposition','READY','idempotency_key','SIM-PDQ-1'));
    log := log || jsonb_build_object('s','S18b Qualite apres sechage READY','ok',true,'kor',r->>'kor_display','drying_status',r->>'drying_status');
  exception when others then log := log || jsonb_build_object('s','S18b Post-dry QA','ok',false,'err',SQLERRM); end;

  -- S19 Triage
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_drying(jsonb_build_object('type','SORTING','source_bin_id',bin_dry,'dest_bin_id',bin_dry,'input_kg',2000,'output_kg',1985,'idempotency_key','SIM-SORT-1'));
    log := log || jsonb_build_object('s','S19 Triage (SORTING)','ok',true,'id',r->>'id','loss_kg',r->>'process_loss_kg');
  exception when others then log := log || jsonb_build_object('s','S19 Triage','ok',false,'err',SQLERRM); end;

  -- S20 Transfert BIN -> BIN vers un AUTRE entrepot (hors circuit transfert)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh2,'stock_type','WET','capacity_kg',50000,'idempotency_key','SIM-BIN-3'));
    bin_other := r->>'id';
    r := public.wms_bin_transfer(bin_wet, bin_other, 1000, 'SIM-XFER-1', 'Test inter-entrepot');
    log := log || jsonb_build_object('s','S20 BIN->BIN inter-entrepots sans workflow transfert','ok',false,'constat','ACCEPTE par le serveur','mov',r->>'id','wh_mouvement',r->>'warehouse_id');
  exception when others then log := log || jsonb_build_object('s','S20 BIN->BIN inter-entrepots bloque','ok',true,'refus',SQLERRM); end;

  -- S21 Ecriture directe du ledger par un role en lecture seule
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_view,'role','authenticated')::text,true);
    r := public.wms_post_movement(jsonb_build_object('type','OFFLOAD','idempotency_key','SIM-PHANTOM-1','warehouse_id',wh,'source_type','TRUCK','source_id','FAUX',
         'dest_type','STAGING','dest_id',wh::text,'lots',jsonb_build_array(jsonb_build_object('lot_id',lot,'qty_out',5000,'qty_in',5000))));
    log := log || jsonb_build_object('s','S21 Viewer/Auditor cree 5 000 kg fantomes via wms_post_movement','ok',false,'constat','ACCEPTE','mov',r->>'id',
      'staging_kg',(select sum(qty) from public.wms_v_balances where lot_id=lot and location_type='STAGING'));
  exception when others then log := log || jsonb_build_object('s','S21 Ecriture directe ledger bloquee','ok',true,'refus',SQLERRM); end;

  -- S22 Localisation actuelle et statut final
  begin
    log := log || jsonb_build_object('s','S22 Localisation actuelle / statut final','ok',true,
      'lot',(select jsonb_build_object('status',status,'current_kg',current_kg,'staging',staging_kg,'bin',bin_kg,'bins',bin_count) from public.wms_v_lots where id=lot),
      'positions',(select jsonb_agg(jsonb_build_object('type',location_type,'id',location_id,'kg',qty)) from public.wms_v_balances where lot_id=lot and qty>0.0005),
      'reception',(select status from public.wms_receptions where id=rec_id),
      'arrivage',(select statut from public.rcn_proc_arrivages where id=arr_id),
      'achat',(select status||' / paiement '||coalesce(payment_status,'-') from public.procurement_reception_settlements where id=pur));
  exception when others then log := log || jsonb_build_object('s','S22','ok',false,'err',SQLERRM); end;

  -- S23 Cloture journaliere
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    log := log || jsonb_build_object('s','S23 Cloture journaliere BKE-002','ok',true,'res',public.wms_daily_closing(wh,current_date));
    log := log || jsonb_build_object('s','S23b Cloture journaliere BKE-003','ok',true,'res',public.wms_daily_closing(wh2,current_date),
       'stock_reel_bin_bke003',(select sum(qty) from public.wms_v_balances where location_type='BIN' and location_id=bin_other));
  exception when others then log := log || jsonb_build_object('s','S23 Cloture','ok',false,'err',SQLERRM); end;

  -- S24 Scenario QUALITY HOLD (ecart KOR sampling / final)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Livraison non annoncee','supplier_code','DIS-004-ANA','origin','Katiola',
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','CD5678CI'),'SIM-REC-2');
    rec2 := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec2,'SAMPLING',jsonb_build_object('gk_g',300,'imm_g',10,'spotted_g',10,'idempotency_key','SIM-Q3'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception(rec2,true,'OK');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec2, jsonb_build_object('gross_kg',30000,'tare_kg',11000,'bags',240,'bags_good',300,'bags_torn',25));
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec2,'FINAL',jsonb_build_object('gk_g',285,'imm_g',15,'spotted_g',10,'idempotency_key','SIM-Q4'));
    x := jsonb_build_object('bags_total_vs_detail',(select bags||' total / '||coalesce(bags_good,0)+coalesce(bags_torn,0)||' detail' from public.wms_receptions where id=rec2),'kor_final',r->'snapshot'->>'kor_display','delta',r->'snapshot'->>'delta_vs_sampling','status',r->'reception'->>'status');
    r := public.wms_set_hold(rec2,false,'Levee du blocage apres revue');
    x := x || jsonb_build_object('status_apres_levee',r->>'status');
    log := log || jsonb_build_object('s','S24 Ecart KOR 2,2 lb -> QUALITY_HOLD','ok',true,'res',x);
  exception when others then log := log || jsonb_build_object('s','S24 Quality hold','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_release_lot(rec2,'SIM-REL-2');
    log := log || jsonb_build_object('s','S24b Liberation LOT apres levee du blocage','ok',true,'lot',r->>'id');
  exception when others then log := log || jsonb_build_object('s','S24b Liberation LOT apres levee du blocage','ok',false,'err',SQLERRM,
     'kg_decharges_hors_stock',(select net_kg from public.wms_receptions where id=rec2)); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_save_purchase_draft(rec2, jsonb_build_object('negotiated_price',400));
    pur2 := (r->>'id')::uuid;
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.procurement_submit_purchase(pur2,null,null);
    perform set_config('request.jwt.claims',json_build_object('sub',u_gm,'role','authenticated')::text,true);
    r := public.procurement_approve_purchase(pur2,null,'OK');
    log := log || jsonb_build_object('s','S24c Achat approuve alors que la marchandise n entre jamais en stock','ok',false,'constat','ACCEPTE','achat',r->>'status','montant',r->>'amount_approved','bap',r->>'bap_id');
  exception when others then log := log || jsonb_build_object('s','S24c Achat sur reception bloquee refuse','ok',true,'refus',SQLERRM); end;

  -- S25 Scenario REJET (tel que l ecran l appelle : wms_decide_reception sans code motif)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test rejet','supplier_code','DIS-005-SOV','origin','Mankono',
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','EF9012CI'),'SIM-REC-3');
    rec3 := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec3,'SAMPLING',jsonb_build_object('gk_g',230,'imm_g',40,'spotted_g',30,'moisture_pct',14,'idempotency_key','SIM-Q5'));
    log := log || jsonb_build_object('s','S25 Reception a rejeter prete','ok',true,'id',rec3,'kor',r->'snapshot'->>'kor_display');
  exception when others then log := log || jsonb_build_object('s','S25 Prep rejet','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception(rec3,false,'Humidite 14 pourcent');
    log := log || jsonb_build_object('s','S25b Rejet via wms_decide_reception (appel de l ecran)','ok',true,'status',r->>'status');
  exception when others then log := log || jsonb_build_object('s','S25b Rejet via wms_decide_reception (appel de l ecran)','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception_v2(rec3,false,'Humidite 14 pourcent',(select code from public.wms_rejection_reasons where active order by code limit 1));
    x := (select to_jsonb(c) - 'created_by' from public.procurement_rejection_cases c where reception_id=rec3);
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_resolve_rejection(rec3,'RETOUR_FOURNISSEUR','Camion reparti chez le fournisseur');
    log := log || jsonb_build_object('s','S25c Rejet via v2 + dossier + disposition','ok',true,'cas',x->>'status','motif',x->>'rejection_reason','resolution',r->>'status');
  exception when others then log := log || jsonb_build_object('s','S25c Rejet v2','ok',false,'err',SQLERRM); end;

  -- S26 Lecture sacherie par un Storekeeper (RLS)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    set local role authenticated;
    x := jsonb_build_object('rcn_jute_locations',(select count(*) from public.rcn_jute_locations),
                            'rcn_jute_v_stock',(select count(*) from public.rcn_jute_v_stock),
                            'wms_v_lots',(select count(*) from public.wms_v_lots),
                            'wms_v_bag_supplier_balance',(select count(*) from public.wms_v_bag_supplier_balance));
    reset role;
    log := log || jsonb_build_object('s','S26 Lignes visibles par un Storekeeper','ok',true,'res',x);
  exception when others then reset role; log := log || jsonb_build_object('s','S26 RLS Storekeeper','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    set local role authenticated;
    x := jsonb_build_object('rcn_jute_locations',(select count(*) from public.rcn_jute_locations),'rcn_jute_v_stock',(select count(*) from public.rcn_jute_v_stock));
    reset role;
    log := log || jsonb_build_object('s','S26b Lignes visibles par un Branch Manager (temoin)','ok',true,'res',x);
  exception when others then reset role; log := log || jsonb_build_object('s','S26b','ok',false,'err',SQLERRM); end;

  -- S27 Retour de sacs avec la livraison (370 bons) sans dotation prealable
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_bag_move(jsonb_build_object('kind','RETURN','location','BAG-WH-BKE-002','qty',370,'supplier_code',sup,'condition','GOOD','reference',rec_id,'idempotency_key','SIM-BAG-RET-1'));
    log := log || jsonb_build_object('s','S27 Sacs recus avec la livraison (RETURN 370)','ok',true,'ids',r->'ids');
  exception when others then log := log || jsonb_build_object('s','S27 Sacs recus avec la livraison (RETURN 370)','ok',false,'err',SQLERRM); end;

  begin
    log := log || jsonb_build_object('s','S28 Mouvements sacs crees automatiquement par la reception','ok',true,
      'rcn_jute_lies_reception',(select count(*) from public.rcn_jute_movements where reference=rec_id or source_id=rec_id or reception_id=rec_id),
      'stock_sacs_BKE002',(select coalesce(jsonb_agg(jsonb_build_object('etat',state,'qty',qty)),'[]'::jsonb) from public.rcn_jute_v_stock where location_code='BAG-WH-BKE-002'));
  exception when others then log := log || jsonb_build_object('s','S28','ok',false,'err',SQLERRM); end;

  raise exception 'SIMULATION_RESULT %', log::text;
end
$sim$;
