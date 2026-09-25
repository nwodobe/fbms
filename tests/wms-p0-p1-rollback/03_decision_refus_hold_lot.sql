-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- Lots 1-2 : décision qualité, 6 motifs de refus, LOT en quarantaine/HOLD, dérogation, blocage achat (P0-01, P0-02, P0-03, P1-10, P1-11)
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
  u_proc uuid := gen_random_uuid(); u_sk uuid := gen_random_uuid(); u_sk0 uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid(); u_qa2 uuid := gen_random_uuid();
  u_bm uuid := gen_random_uuid(); u_gm uuid := gen_random_uuid(); u_view uuid := gen_random_uuid();
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';   -- BKE-002
  wh2 uuid := 'fc36b09a-a75a-451a-a2ea-8bbf7f752bd3';  -- BKE-003
  r jsonb; x jsonb; n int; t text; i int; code text;
  rec1 text; lot1 text; rec2 text; lot2 text; rec3 text; lot3 text; bin_wet text; bin_hold text; bin_other text; pur2 uuid; pur3 uuid;
  codes text[] := array['LOW_KOR','HIGH_MOISTURE','QUALITY_NON_CONFORMITY','DOCUMENTATION','SUPPLIER_ISSUE','OTHER'];
  procedure_ok boolean;
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'sim-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_proc,'proc'),(u_sk,'sk'),(u_sk0,'sk0'),(u_qa,'qa'),(u_qa2,'qa2'),(u_bm,'bm'),(u_gm,'gm'),(u_view,'view')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code)
  select v.id,'sim-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.k,v.ro,true,v.whc
  from (values (u_proc,'proc','Procurement Officer',null),(u_sk,'sk','Storekeeper','BKE-002'),(u_sk0,'sk0','Storekeeper',null),(u_qa,'qa','QA / Lab',null),
               (u_qa2,'qa2','QA / Lab',null),(u_bm,'bm','Branch Manager',null),(u_gm,'gm','General Manager',null),(u_view,'view','Viewer / Auditor',null)) v(id,k,ro,whc);

  -- T1 appel direct wms_post_movement (Viewer, Storekeeper, BM) -> refus
  foreach t in array array['view','sk','bm'] loop
    begin
      perform set_config('request.jwt.claims',json_build_object('sub',case t when 'view' then u_view when 'sk' then u_sk else u_bm end,'role','authenticated')::text,true);
      set local role authenticated;
      r := public.wms_post_movement(jsonb_build_object('type','OFFLOAD','idempotency_key','SIM-PHANTOM-'||t,'warehouse_id',wh,'source_type','TRUCK','source_id','FAUX',
           'dest_type','STAGING','dest_id',wh::text,'lots',jsonb_build_array(jsonb_build_object('lot_id','RCN-20260923-001','qty_out',5000,'qty_in',5000))));
      reset role;
      log := log || jsonb_build_object('t','T1 appel direct wms_post_movement '||t,'ok',false,'constat','ACCEPTE');
    exception when others then reset role; log := log || jsonb_build_object('t','T1 appel direct wms_post_movement '||t,'ok',true,'refus',SQLERRM); end;
  end loop;

  -- T2 insertion directe dans le ledger
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    set local role authenticated;
    insert into public.wms_movements(id,idempotency_key,type,qty_out,qty_in,process_loss_kg,variance_kg,status) values ('MOV-FAUX','SIM-FAUX','OFFLOAD',0,5000,0,0,'POSTED');
    reset role;
    log := log || jsonb_build_object('t','T2 insert direct wms_movements','ok',false,'constat','ACCEPTE');
  exception when others then reset role; log := log || jsonb_build_object('t','T2 insert direct wms_movements','ok',true,'refus',SQLERRM); end;

  -- T3 parcours conforme
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test conforme','supplier_code','DIS-003-DEM','origin','Dabakala',
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','SIM0001'),'SIM-T3-REC');
    rec1 := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec1,'SAMPLING',jsonb_build_object('gk_g',280,'imm_g',20,'spotted_g',10,'moisture_pct',9.5,'nut_count',195,'idempotency_key','SIM-T3-Q1'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception_v2(rec1,true,'Conforme',null);
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec1, jsonb_build_object('gross_kg',42350,'tare_kg',12150,'bags_good',370,'bags_wet',5,'bags_torn',5));
    lot1 := r->>'lot_id';
    x := jsonb_build_object('offload_status',r->>'status','lot',lot1,'lot_status',(select status from public.wms_lots where id=lot1),
          'staging_kg',(select sum(qty) from public.wms_v_balances where lot_id=lot1 and location_type='STAGING'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec1,'FINAL',jsonb_build_object('gk_g',276,'imm_g',22,'spotted_g',12,'moisture_pct',9.8,'nut_count',198,'idempotency_key','SIM-T3-Q2'));
    x := x || jsonb_build_object('final_status',r->'reception'->>'status','lot_after_final',(select status from public.wms_lots where id=lot1));
    r := public.wms_release_lot(rec1,'SIM-T3-REL');
    x := x || jsonb_build_object('release',r->>'status','idempotent',r->>'idempotent','rec_status',(select status from public.wms_receptions where id=rec1));
    r := public.wms_release_lot(rec1,'SIM-T3-REL');
    x := x || jsonb_build_object('release_rejeu_idempotent',r->>'idempotent');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','WET','capacity_kg',100000,'idempotency_key','SIM-T3-BIN'));
    bin_wet := r->>'id';
    r := public.wms_allocate_lot_to_bin(lot1, bin_wet, 30200, 'SIM-T3-ALLOC');
    x := x || jsonb_build_object('allocation',r->>'id','bin_kg',(select sum(qty) from public.wms_v_balances where lot_id=lot1 and location_type='BIN'));
    log := log || jsonb_build_object('t','T3 parcours conforme (lot cree au dechargement)','ok',(x->>'lot_status')='QUARANTINE' and (x->>'release')='RELEASED','res',x);
  exception when others then log := log || jsonb_build_object('t','T3 parcours conforme','ok',false,'err',SQLERRM,'res',x); end;

  -- T4 ecart KOR 2,2 lb -> LOT HOLD 19 000 kg
  begin
    x := '{}'::jsonb;
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test HOLD','supplier_code','DIS-004-ANA','origin','Katiola',
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','SIM0002'),'SIM-T4-REC');
    rec2 := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec2,'SAMPLING',jsonb_build_object('gk_g',300,'imm_g',10,'spotted_g',10,'idempotency_key','SIM-T4-Q1'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception_v2(rec2,true,'OK',null);
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec2, jsonb_build_object('gross_kg',30000,'tare_kg',11000,'bags_good',230,'bags_torn',10));
    lot2 := r->>'lot_id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec2,'FINAL',jsonb_build_object('gk_g',285,'imm_g',15,'spotted_g',10,'idempotency_key','SIM-T4-Q2'));
    x := jsonb_build_object('delta',r->'snapshot'->>'delta_vs_sampling','rec_status',r->'reception'->>'status','lot',lot2,
          'lot_status',(select status from public.wms_lots where id=lot2),
          'staging_kg',(select sum(qty) from public.wms_v_balances where lot_id=lot2 and location_type='STAGING'));
    log := log || jsonb_build_object('t','T4a ecart KOR 2,2 lb -> LOT HOLD en stock','ok',(x->>'lot_status')='HOLD' and (x->>'staging_kg')::numeric=19000,'res',x);
  exception when others then log := log || jsonb_build_object('t','T4a HOLD','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    x := public.wms_daily_closing(wh,current_date);
    log := log || jsonb_build_object('t','T4b cloture : stock HOLD visible','ok',(x->>'stock_lot_hold_kg')::numeric=19000 and x->>'mass_balance_status'='BALANCED',
       'res',jsonb_build_object('receipts',x->'receipts_kg','closing',x->'closing_stock_kg','hold',x->'stock_lot_hold_kg','quarantine',x->'stock_lot_quarantine_kg','released',x->'stock_lot_released_kg','balance',x->'mass_balance_status'));
  exception when others then log := log || jsonb_build_object('t','T4b cloture','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_allocate_lot_to_bin(lot2, bin_wet, 1000, 'SIM-T4-ALLOC');
    log := log || jsonb_build_object('t','T4c LOT HOLD vers BIN normal','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T4c LOT HOLD vers BIN normal refuse','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','HOLD','capacity_kg',50000,'idempotency_key','SIM-T4-BINH'));
    bin_hold := r->>'id';
    r := public.wms_place_lot_in_hold_bin(lot2, bin_hold, null, 'SIM-T4-HOLDBIN');
    log := log || jsonb_build_object('t','T4d LOT HOLD place en BIN HOLD','ok',true,'mov',r->>'id',
       'positions',(select jsonb_agg(jsonb_build_object('type',location_type,'id',location_id,'kg',qty)) from public.wms_v_balances where lot_id=lot2 and qty>0.0005));
  exception when others then log := log || jsonb_build_object('t','T4d BIN HOLD','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_bin_transfer(bin_hold, bin_wet, 1000, 'SIM-T4-XFER', 'test');
    log := log || jsonb_build_object('t','T4e sortie BIN HOLD vers BIN normal','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T4e sortie BIN HOLD vers BIN normal refusee','ok',true,'refus',SQLERRM); end;

  -- Brouillon d'achat créé dans un bloc séparé (sinon le refus attendu en T4f l'annulerait)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_proc,'role','authenticated')::text,true);
    r := public.procurement_save_purchase_draft(rec2, jsonb_build_object('negotiated_price',400));
    pur2 := (r->>'id')::uuid;
    log := log || jsonb_build_object('t','T4f0 brouillon d achat sur LOT HOLD (autorise, non soumis)','ok',pur2 is not null,'statut',r->>'status');
  exception when others then log := log || jsonb_build_object('t','T4f0 brouillon d achat','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.procurement_submit_purchase(pur2,null,null);
    log := log || jsonb_build_object('t','T4f soumission achat LOT HOLD','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T4f soumission achat LOT HOLD refusee','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec2,'FINAL',jsonb_build_object('gk_g',300,'imm_g',10,'spotted_g',10,'idempotency_key','SIM-T4-Q3'));
    log := log || jsonb_build_object('t','T4g nouvelle QA finale sans motif','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T4g nouvelle QA finale sans motif refusee','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec2,'FINAL',jsonb_build_object('gk_g',300,'imm_g',10,'spotted_g',10,'idempotency_key','SIM-T4-Q4','reason','Contre-analyse'));
    x := jsonb_build_object('within',r->'snapshot'->>'within_tolerance','hold_maintained',r->>'hold_maintained','rec',r->'reception'->>'status','lot',(select status from public.wms_lots where id=lot2));
    log := log || jsonb_build_object('t','T4h QA finale conforme ressaisie : HOLD maintenu','ok',(x->>'lot')='HOLD','res',x);
  exception when others then log := log || jsonb_build_object('t','T4h ressaisie','ok',false,'err',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_set_hold(rec2,false,'Je leve mon propre HOLD');
    log := log || jsonb_build_object('t','T4i levee HOLD par l auteur de la QA','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T4i levee HOLD par l auteur de la QA refusee','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_decide_hold_lot(lot2,'DEROGATION_RELEASE','Derogation par l analyste',null,'SIM-T4-DRG0');
    log := log || jsonb_build_object('t','T4j derogation par l auteur de la QA','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T4j derogation par l auteur de la QA refusee','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_hold_lot(lot2,'DEROGATION_RELEASE','Contre-analyse conforme, lot accepte sous reserve',null,'SIM-T4-DRG1');
    x := jsonb_build_object('lot',r->>'status','derogation',r->'derogation'->>'id','rec',(select status from public.wms_receptions where id=rec2));
    r := public.procurement_submit_purchase(pur2,null,null);
    x := x || jsonb_build_object('achat',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_gm,'role','authenticated')::text,true);
    r := public.procurement_approve_purchase(pur2,null,'OK');
    x := x || jsonb_build_object('achat_approuve',r->>'status','bap',r->>'bap_id');
    log := log || jsonb_build_object('t','T4k derogation BM tracee puis achat','ok',(x->>'lot')='RELEASED','res',x);
  exception when others then log := log || jsonb_build_object('t','T4k derogation BM','ok',false,'err',SQLERRM,'res',x); end;

  -- T5 rejet apres dechargement -> REJECTED + dossier + retour fournisseur
  begin
    x := '{}'::jsonb;
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test rejet apres dechargement','supplier_code','DIS-005-SOV','origin','Mankono',
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','SIM0003'),'SIM-T5-REC');
    rec3 := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec3,'SAMPLING',jsonb_build_object('gk_g',300,'imm_g',10,'spotted_g',10,'idempotency_key','SIM-T5-Q1'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception_v2(rec3,true,'OK',null);
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec3, jsonb_build_object('gross_kg',25000,'tare_kg',10000));
    lot3 := r->>'lot_id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec3,'FINAL',jsonb_build_object('gk_g',250,'imm_g',30,'spotted_g',20,'idempotency_key','SIM-T5-Q2'));
    r := public.wms_decide_hold_lot(lot3,'ESCALATE','Ecart important, decision BM',null,null);
    x := jsonb_build_object('apres_escalade',r->>'status');
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_hold_lot(lot3,'REJECT','KOR tres inferieur a l echantillon','LOW_KOR',null);
    x := x || jsonb_build_object('lot',r->>'status','rec',(select status from public.wms_receptions where id=rec3),
          'dossier',(select status||' / '||rejection_reason from public.procurement_rejection_cases where reception_id=rec3),
          'refoules',(select count(*) from public.procurement_v_rejected_trucks where reception_id=rec3),
          'stock_rejete_kg',(select sum(qty) from public.wms_v_balances where lot_id=lot3 and location_type in ('STAGING','BIN')));
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_return_rejected_lot(lot3, 15000, 'BS-SIM-001', null, 'SIM-T5-RET');
    x := x || jsonb_build_object('retour',r->>'type','stock_apres_retour',(select coalesce(sum(qty),0) from public.wms_v_balances where lot_id=lot3 and location_type in ('STAGING','BIN')));
    log := log || jsonb_build_object('t','T5 rejet apres dechargement + retour fournisseur','ok',(x->>'lot')='REJECTED' and (x->>'rec')='REJECTED','res',x);
  exception when others then log := log || jsonb_build_object('t','T5 rejet apres dechargement','ok',false,'err',SQLERRM,'res',x); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    x := public.wms_daily_closing(wh,current_date);
    log := log || jsonb_build_object('t','T5b cloture apres retour','ok',x->>'mass_balance_status'='BALANCED','res',jsonb_build_object('receipts',x->'receipts_kg','returns',x->'supplier_returns_kg','closing',x->'closing_stock_kg','expected',x->'expected_closing_kg','variance',x->'variance_kg'));
  exception when others then log := log || jsonb_build_object('t','T5b cloture','ok',false,'err',SQLERRM); end;

  -- T6 six refus avant dechargement, un par motif (appel v2) + refus v1 sans motif
  for i in 1..6 loop
    begin
      code := codes[i];
      perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
      r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test refus '||code,'supplier_code','DIS-003-DEM','origin','Dabakala',
           'warehouse_id',wh,'arrival_at',(now()+(i||' hour')::interval)::text,'driver','SIM','truck','SIMR0'||i),'SIM-T6-REC-'||i);
      t := r->>'id';
      perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
      r := public.wms_save_quality(t,'SAMPLING',jsonb_build_object('gk_g',230,'imm_g',40,'spotted_g',30,'idempotency_key','SIM-T6-Q-'||i));
      perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
      r := public.wms_decide_reception_v2(t,false,case when code in ('LOW_KOR','HIGH_MOISTURE') then null else 'Commentaire test '||code end,code);
      log := log || jsonb_build_object('t','T6 refus motif '||code,'ok',(r->>'status')='REJECTED' and exists(select 1 from public.procurement_rejection_cases where reception_id=t)
          and exists(select 1 from public.procurement_v_rejected_trucks where reception_id=t),
          'res',jsonb_build_object('status',r->>'status','code',(select rejection_reason_code from public.wms_receptions where id=t),'dossier',(select rejection_reason from public.procurement_rejection_cases where reception_id=t)));
    exception when others then log := log || jsonb_build_object('t','T6 refus motif '||code,'ok',false,'err',SQLERRM); end;
  end loop;

  -- Réception créée dans un bloc séparé (sinon le refus attendu en T6b l'annulerait)
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test refus v1','supplier_code','DIS-003-DEM','origin','Dabakala',
       'warehouse_id',wh,'arrival_at',(now()+interval '9 hour')::text,'driver','SIM','truck','SIMR09'),'SIM-T6-REC-V1');
  t := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  r := public.wms_save_quality(t,'SAMPLING',jsonb_build_object('gk_g',230,'imm_g',40,'spotted_g',30,'idempotency_key','SIM-T6-Q-V1'));

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception_v2(t,false,null,'OTHER');
    log := log || jsonb_build_object('t','T6b motif Autre sans commentaire','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T6b motif Autre sans commentaire refuse','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception(t,false,'Refus via ancien ecran');
    log := log || jsonb_build_object('t','T6c refus via ancienne RPC (ecran actuel)','ok',(r->>'status')='REJECTED','res',jsonb_build_object('status',r->>'status','code',r->>'rejection_reason_code'));
  exception when others then log := log || jsonb_build_object('t','T6c refus via ancienne RPC','ok',false,'err',SQLERRM); end;

  -- T7 transfert BIN -> BIN inter-entrepots (BM, non rattache)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh2,'stock_type','WET','capacity_kg',50000,'idempotency_key','SIM-T7-BIN'));
    bin_other := r->>'id';
    r := public.wms_bin_transfer(bin_wet, bin_other, 1000, 'SIM-T7-XFER', 'Test inter-entrepot');
    log := log || jsonb_build_object('t','T7 BIN->BIN inter-entrepots','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T7 BIN->BIN inter-entrepots refuse','ok',true,'refus',SQLERRM); end;

  -- T8 perimetre : Storekeeper BKE-002 sur BKE-003, Storekeeper sans rattachement
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Hors perimetre','supplier_code','DIS-003-DEM','origin','Dabakala',
         'warehouse_id',wh2,'arrival_at',now()::text,'driver','SIM','truck','SIM0008'),'SIM-T8-REC');
    log := log || jsonb_build_object('t','T8 Storekeeper BKE-002 cree une reception BKE-003','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T8 Storekeeper BKE-002 sur BKE-003 refuse','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk0,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Sans rattachement','supplier_code','DIS-003-DEM','origin','Dabakala',
         'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','SIM0009'),'SIM-T8-REC0');
    log := log || jsonb_build_object('t','T8b Storekeeper sans Warehouse','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','T8b Storekeeper sans Warehouse refuse','ok',true,'refus',SQLERRM); end;

  raise exception 'SIMULATION_RESULT %', log::text;
end
$sim$;
