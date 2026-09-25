-- =====================================================================
-- FBMS · Rapports d'activité · 25/09/2026 · TEST NON DESTRUCTIF
-- Jeu de données fictif (transaction annulée) puis contrôle des vues
-- reports_v_* et des fonctions reports_activity_summary / reports_jute_balance.
--   R1 BKE-002 DIS-008-FOU accepté, déchargé, GRN, CCAK, LOT en BIN, séchage
--   R2 BKE-002 DIS-008-FOU refusé (humidité)
--   R3 BKE-002 DIS-004-ANA accepté, écart KOR -> LOT HOLD
--   R4 BKE-003 DIS-003-DEM accepté, déchargé, arrivé il y a 3 jours
--   Sacherie BAG-WH-BKE-002 : 50 avant la période, puis 1 000 achat,
--   200 dotation, 10 réforme, 100 transfert vers BKE-003, -5 ajustement
--   (les déchargements R1, R3 et R4 ajoutent automatiquement les sacs reçus)
-- Scénarios : F1 journée, F2 période, F3 warehouse, F4 fournisseur,
-- F5 refusée, F6 LOT HOLD, F7 séchage, F8 sacherie, F9 aucun résultat,
-- F10 formule sacherie, S1 périmètre Storekeeper BKE-003, S2 anon refusé.
-- Se termine TOUJOURS par raise exception 'SIMULATION_RESULT %' :
-- tout est annulé. NE JAMAIS retirer cette dernière instruction.
-- Comptes fictifs (@audit.invalid) annulés avec la transaction.
-- =====================================================================
do $t$
declare log jsonb := '[]'::jsonb; r jsonb; x jsonb; k jsonb;
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281'; wh3 uuid := 'fc36b09a-a75a-451a-a2ea-8bbf7f752bd3';
  u_sk uuid := gen_random_uuid(); u_sk3 uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid(); u_bm uuid := gen_random_uuid();
  r1 text; r2 text; r3 text; r4 text; lot1 text; lot3 text; bin_w text; bin_d text; dry text;
  ids text[]; d0 date := current_date;
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'rep-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_sk,'sk'),(u_sk3,'sk3'),(u_qa,'qa'),(u_bm,'bm')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'rep-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_sk,'sk','Storekeeper','BKE-002'),(u_sk3,'sk3','Storekeeper','BKE-003'),(u_qa,'qa','QA / Lab',null),(u_bm,'bm','Branch Manager',null)) v(id,k,ro,w);

  -- Sacherie fictive (écritures directes BM, contrôlées par rcn_jute_guard)
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,supplier_code,reference,note,owner_type,movement_at) values
   ('JUT-REP-0','REP-0','ACHAT','INTERNE',50,null,'BAG-WH-BKE-002',null,'UTILISABLE',null,'REP','Test rapport (rollback)','ANAGROCI',now()-interval '10 day'),
   ('JUT-REP-1','REP-1','ACHAT','INTERNE',1000,null,'BAG-WH-BKE-002',null,'UTILISABLE',null,'REP','Test rapport (rollback)','ANAGROCI',now()),
   ('JUT-REP-2','REP-2','DOTATION','INTERNE',200,'BAG-WH-BKE-002',null,'UTILISABLE',null,'DIS-008-FOU','REP','Test rapport (rollback)','ANAGROCI',now()),
   ('JUT-REP-3','REP-3','REFORME','INTERNE',10,'BAG-WH-BKE-002','JUTE-REBUT','UTILISABLE','REFORME',null,'REP','Test rapport (rollback)','ANAGROCI',now()),
   ('JUT-REP-4','REP-4','TRANSFERT','INTERNE',100,'BAG-WH-BKE-002','BAG-WH-BKE-003','UTILISABLE','UTILISABLE',null,'REP','Test rapport (rollback)','ANAGROCI',now()),
   ('JUT-REP-5','REP-5','AJUSTEMENT_INVENTAIRE','INTERNE',5,'BAG-WH-BKE-002',null,'UTILISABLE',null,null,'REP','Test rapport (rollback)','ANAGROCI',now());

  set local role authenticated;
  -- R1 : circuit complet + GRN + CCAK + BIN + séchage
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r1 := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test rapport','supplier_code','DIS-008-FOU','origin','Odienne',
        'warehouse_id',wh,'arrival_at',(now()-interval '4 hour')::text,'driver','SIM','truck','RP 0001 CI'),'REP-R1')->>'id';
  perform public.wms_record_reception_document(r1,'CCAK','PRESENT','CCAK-SIM-R1',null,null);
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(r1,'SAMPLING',jsonb_build_object('gk_g',290,'imm_g',15,'spotted_g',10,'moisture_pct',8.5,'nut_count',190,'idempotency_key','REP-Q1'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_decide_reception_v2(r1,true,'OK',null);
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  lot1 := public.wms_record_offload(r1, jsonb_build_object('gross_kg',32000,'tare_kg',12000,'bags',253,'bags_good',240,'bags_wet',6,'bags_torn',4,'bags_recond',3,
          'weighbridge_ticket','PB-REP-1','warehouse_receipt','BR-REP-1','offload_start',now()::text,'offload_end',(now()+interval '1 hour')::text))->>'lot_id';
  perform public.wms_generate_grn(r1);
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(r1,'FINAL',jsonb_build_object('gk_g',289,'imm_g',15,'spotted_g',10,'moisture_pct',8.4,'nut_count',192,'idempotency_key','REP-Q2'));
  lot1 := coalesce(lot1, public.wms_release_lot(r1,'REP-REL1')->>'id');
  begin perform public.wms_release_lot(r1,'REP-REL1b'); exception when others then null; end;
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  bin_w := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','WET','idempotency_key','REP-BIN-W'))->>'id';
  bin_d := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','DRY','idempotency_key','REP-BIN-D'))->>'id';
  perform public.wms_allocate_lot_to_bin(lot1, bin_w, 20000, 'REP-ALLOC1');
  dry := public.wms_create_drying(jsonb_build_object('type','DRYING','source_bin_id',bin_w,'dest_bin_id',bin_d,'input_kg',10000,'output_kg',9650,
         'input_bags',125,'output_bags',121,'moisture_before',11.5,'moisture_after',8.2,'idempotency_key','REP-DRY1'))->>'id';
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    perform public.procurement_save_purchase_draft(r1, jsonb_build_object('refraction_mode','PERCENT','refraction_value',1,'refraction_reason','Humidite','negotiated_price',400));
  exception when others then log := log || jsonb_build_object('t','note achat R1 non cree','err',SQLERRM); end;

  -- R2 : refusé
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r2 := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test rapport','supplier_code','DIS-008-FOU','origin','Odienne',
        'warehouse_id',wh,'arrival_at',(now()-interval '3 hour')::text,'driver','SIM','truck','RP0002CI'),'REP-R2')->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(r2,'SAMPLING',jsonb_build_object('gk_g',200,'imm_g',15,'spotted_g',10,'moisture_pct',13.5,'idempotency_key','REP-Q3'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_decide_reception_v2(r2,false,'Humidite 13,5 %','HIGH_MOISTURE');

  -- R3 : écart KOR -> HOLD
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r3 := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test rapport','supplier_code','DIS-004-ANA','origin','Katiola',
        'warehouse_id',wh,'arrival_at',(now()-interval '2 hour')::text,'driver','SIM','truck','RP0003CI'),'REP-R3')->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(r3,'SAMPLING',jsonb_build_object('gk_g',300,'imm_g',10,'spotted_g',10,'idempotency_key','REP-Q4'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_decide_reception_v2(r3,true,'OK',null);
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  lot3 := public.wms_record_offload(r3, jsonb_build_object('gross_kg',30000,'tare_kg',11000,'bags_good',230,'bags_torn',10))->>'lot_id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(r3,'FINAL',jsonb_build_object('gk_g',285,'imm_g',15,'spotted_g',10,'idempotency_key','REP-Q5'));

  -- R4 : BKE-003, arrivé il y a 3 jours
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  r4 := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test rapport','supplier_code','DIS-003-DEM','origin','Dabakala',
        'warehouse_id',wh3,'arrival_at',(now()-interval '3 day')::text,'driver','SIM','truck','RP0004CI'),'REP-R4')->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(r4,'SAMPLING',jsonb_build_object('gk_g',290,'imm_g',15,'spotted_g',10,'idempotency_key','REP-Q6'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_decide_reception_v2(r4,true,'OK',null);
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  perform public.wms_record_offload(r4, jsonb_build_object('gross_kg',22000,'tare_kg',12000,'bags',125));
  ids := array[r1,r2,r3,r4];

  -- Contrôles en Branch Manager (portée globale)
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  log := log || jsonb_build_object('t','F1 journee (aujourd''hui)','attendu','R1,R2,R3',
    'obtenu',(select jsonb_agg(reception_id order by reception_id) from public.reports_v_truck_reception where report_date = d0 and reception_id = any(ids)));
  log := log || jsonb_build_object('t','F2 periode (7 jours)','attendu','R1,R2,R3,R4',
    'obtenu',(select jsonb_agg(reception_id order by reception_id) from public.reports_v_truck_reception where report_date between d0-7 and d0 and reception_id = any(ids)));
  log := log || jsonb_build_object('t','F3 warehouse BKE-002 (7 jours)','attendu','R1,R2,R3',
    'obtenu',(select jsonb_agg(reception_id order by reception_id) from public.reports_v_truck_reception where report_date between d0-7 and d0 and warehouse_code='BKE-002' and reception_id = any(ids)));
  log := log || jsonb_build_object('t','F4 fournisseur DIS-003-DEM','attendu','R4',
    'obtenu',(select jsonb_agg(reception_id) from public.reports_v_truck_reception where supplier_code ilike '%DIS-003-DEM%' and reception_id = any(ids)),
    'plaque_normalisee_R1',(select truck_norm from public.reports_v_truck_reception where reception_id=r1));
  log := log || jsonb_build_object('t','F5 reception refusee','attendu','R2 REJETE HIGH_MOISTURE',
    'obtenu',(select jsonb_agg(jsonb_build_object('id',reception_id,'groupe',status_group,'motif',rejection_reason_code)) from public.reports_v_truck_reception where status_group='REJETE' and reception_id = any(ids)));
  k := public.reports_activity_summary(jsonb_build_object('start',d0,'end',d0,'warehouse_code','BKE-002','supplier','DIS-00'));
  log := log || jsonb_build_object('t','F6 LOT HOLD + KPI BKE-002 journee','attendu','arrives 3, acceptes 2, refuses 1, lots_hold 1',
    'obtenu',jsonb_build_object('arrives',k->'trucks_arrived','acceptes',k->'trucks_accepted','refuses',k->'trucks_rejected','en_attente',k->'trucks_pending',
      'net_kg',k->'net_kg','sacs',k->'bags_received','bons',k->'good_bags','humides',k->'humid_bags','dechires',k->'torn_bags','recond',k->'reconditioned_bags',
      'lots_hold',k->'lots_hold','lots_liberes',k->'lots_released','lots_non_bines',k->'lots_not_binned','sans_grn',k->'receptions_without_grn',
      'refraction',k->'refraction_kg','paye',k->'paid_weight_kg','stock_rcn',k->'rcn_closing_kg','stock_sacs',k->'jute_closing_bags'),
    'hold_R3',(select status_group from public.reports_v_truck_reception where reception_id=r3));
  log := log || jsonb_build_object('t','F7 sechage BKE-002 journee','attendu','1 ligne, perte 350 kg',
    'obtenu',(select jsonb_agg(jsonb_build_object('lot',lot_no_raw,'entree',issued_net_weight_kg,'sortie',received_net_weight_kg,'perte',drying_loss_kg,'humidite',moisture_loss_pct))
              from public.reports_v_drying_batch where report_date=d0 and warehouse_code='BKE-002' and drying_id=dry),
    'grand_livre',(select jsonb_agg(jsonb_build_object('type',activity_type,'mt',quantity_mt,'sacs',bags) order by activity_type)
              from public.reports_v_warehouse_activity_ledger where report_date=d0 and warehouse_code='BKE-002' and (lot_no=lot1 or reception_id=r1)));
  log := log || jsonb_build_object('t','F8 mouvements sacherie BKE-002 journee','attendu','5 lignes, emis 315, recus 1000',
    'obtenu',(select jsonb_build_object('lignes',count(*),'emis',sum(bags_issued),'recus',sum(bags_received)) from public.reports_v_jute_bags_movement
              where report_date=d0 and warehouse_code='BKE-002' and reference='REP'));
  log := log || jsonb_build_object('t','F9 aucun resultat (fournisseur inexistant)','attendu','0 partout',
    'obtenu',jsonb_build_object('camions',(select count(*) from public.reports_v_truck_reception where supplier_code ilike '%ZZZ-INEXISTANT%'),
      'kpi_arrives',public.reports_activity_summary(jsonb_build_object('start',d0,'end',d0,'supplier','ZZZ-INEXISTANT'))->'trucks_arrived'));
  log := log || jsonb_build_object('t','F10 formule sacherie periode du jour','attendu','BKE-002 : 50 + 1493 (1000 achat + 253 et 240 sacs recus avec R1 et R3) + 0 - 200 - 10 - 100 = 1233, reel 1228, ecart -5 (ajustement) ; BKE-003 : 125 (R4) + 100 = 225',
    'obtenu',(select jsonb_agg(to_jsonb(j)) from public.reports_jute_balance(d0, d0, null) j where j.location_code in ('BAG-WH-BKE-002','BAG-WH-BKE-003')));
  log := log || jsonb_build_object('t','F11 qualite (inspections des 4 receptions)','obtenu',
    (select jsonb_agg(jsonb_build_object('rec',reception_id,'etape',inspection_stage,'kor',kor,'decision',decision) order by reception_id, inspection_date) from public.reports_v_quality_inspection where reception_id = any(ids)));
  log := log || jsonb_build_object('t','F12 warehouse receiving R1','obtenu',
    (select jsonb_build_object('bin_initial',initial_bin_no,'cca',cca_no,'ccak_valide',ccak_validated,'grn_qty',grn_qty_kg,'q1_kor',q1_kor,'q2_kor',q2_kor,'recond',reconditioned_bags,'lot_bags',total_bags_lot) from public.reports_v_warehouse_receiving where reception_id=r1));

  -- S1 périmètre Storekeeper BKE-003
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  log := log || jsonb_build_object('t','S1 perimetre Storekeeper BKE-003','attendu','R4 seul ; sacherie BKE-003 seul',
    'receptions',(select jsonb_agg(reception_id) from public.reports_v_truck_reception where reception_id = any(ids)),
    'warehouses_vus',(select jsonb_agg(distinct warehouse_code) from public.reports_v_truck_reception),
    'sacherie',(select jsonb_agg(distinct warehouse_code) from public.reports_v_jute_bags_movement),
    'kpi_scope',public.reports_activity_summary(jsonb_build_object('start',d0-7,'end',d0))->>'scope');
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims',json_build_object('role','anon')::text,true);
  begin
    perform count(*) from public.reports_v_truck_reception;
    log := log || jsonb_build_object('t','S2 anon','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','S2 anon','res','REFUSE','code',SQLSTATE); end;
  reset role;
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
