-- =====================================================================
-- FBMS / WMS · vérification du 25/09/2026 · TEST NON DESTRUCTIF
-- Écart 5 : message de blocage documentaire sans liste vide « () »
--   M1 acceptation sans CCAK obligatoire : refusée, message cite CCAK et
--      ne contient ni « () » ni « non conformes » quand rien n'est non conforme
-- Écart 3 : prochaine étape d'une réception libérée
--   N1 LOT libéré, stock en staging  -> next_action = ALLOCATE_BIN
--   N2 LOT entièrement affecté en BIN -> next_action vide (plus d'action)
-- Se termine TOUJOURS par raise exception 'SIMULATION_RESULT %' :
-- tout est annulé. NE JAMAIS retirer cette dernière instruction.
-- Comptes fictifs (@audit.invalid) annulés avec la transaction.
-- =====================================================================
do $t$
declare log jsonb := '[]'::jsonb; r jsonb; rec text; rec2 text; lot text; bin text;
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';
  u_sk uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid(); u_bm uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'e35-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_sk,'sk'),(u_qa,'qa'),(u_bm,'bm')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'e35-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_sk,'sk','Storekeeper','BKE-002'),(u_qa,'qa','QA / Lab',null),(u_bm,'bm','Branch Manager',null)) v(id,k,ro,w);
  set local role authenticated;
  -- M1 : CCAK rendu obligatoire (valeur de test, annulée)
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_set_document_requirement('CCAK', array['*'], 'Test uniquement (rollback)');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test message','supplier_code','DIS-008-FOU','origin','Odienne',
     'warehouse_id',wh,'arrival_at',(now()-interval '3 hour')::text,'driver','SIM','truck','MSG0001CI'),'E35-REC-1');
  rec := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',290,'imm_g',15,'spotted_g',10,'moisture_pct',8.5,'idempotency_key','E35-Q1'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  begin
    perform public.wms_decide_reception_v2(rec,true,'OK',null);
    log := log || jsonb_build_object('t','M1 acceptation sans CCAK','res','ACCEPTE (faille)');
  exception when others then
    log := log || jsonb_build_object('t','M1 acceptation sans CCAK','res','REFUSE','message',SQLERRM,
      'sans_parentheses_vides',position('()' in SQLERRM)=0,'cite_CCAK',position('CCAK' in SQLERRM)>0,'pas_de_non_conformes',position('non conformes' in SQLERRM)=0);
  end;
  -- N1/N2 : circuit complet (CCAK saisi pour lever le blocage documentaire)
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test etape','supplier_code','DIS-008-FOU','origin','Odienne',
     'warehouse_id',wh,'arrival_at',(now()-interval '2 hour')::text,'driver','SIM','truck','NXT0001CI'),'E35-REC-2');
  rec2 := r->>'id';
  perform public.wms_record_reception_document(rec2,'CCAK','PRESENT','CCAK-SIM-E35',null,null);
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec2,'SAMPLING',jsonb_build_object('gk_g',290,'imm_g',15,'spotted_g',10,'moisture_pct',8.5,'idempotency_key','E35-Q2'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_decide_reception_v2(rec2,true,'OK',null);
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  perform public.wms_record_offload(rec2, jsonb_build_object('gross_kg',22000,'tare_kg',12000,'net_kg',10000,'bags',125,'bags_good',125,'bags_wet',0,'bags_torn',0,
     'weighbridge_ticket','PB-E35','offload_start',now()::text,'offload_end',(now()+interval '30 minute')::text));
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec2,'FINAL',jsonb_build_object('gk_g',288,'imm_g',16,'spotted_g',10,'moisture_pct',8.6,'idempotency_key','E35-Q3'));
  r := public.wms_release_lot(rec2,'E35-REL');
  lot := r->>'id';
  log := log || jsonb_build_object('t','N1 LOT libere en staging','next_action',(select next_action from public.wms_v_receptions where id=rec2),'attendu','ALLOCATE_BIN');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_bin(jsonb_build_object('warehouse_id',wh,'stock_type','WET','idempotency_key','E35-BIN'));
  bin := r->>'id';
  log := log || jsonb_build_object('t','N0 BIN cree sans capacite','capacity_kg',r->'capacity_kg');
  perform public.wms_allocate_lot_to_bin(lot, bin, (select staging_kg from public.wms_v_lots where id=lot), 'E35-ALLOC');
  log := log || jsonb_build_object('t','N2 LOT entierement en BIN','next_action',(select next_action from public.wms_v_receptions where id=rec2),'attendu',null,
     'staging_kg',(select staging_kg from public.wms_v_lots where id=lot),'bin_kg',(select bin_kg from public.wms_v_lots where id=lot));
  reset role;
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
