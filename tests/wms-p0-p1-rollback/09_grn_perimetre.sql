-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- P1-08 : GRN, contrôle de périmètre avant retour idempotent (Storekeeper BKE-003 refusé sur une réception BKE-002, lecture inchangée)
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
do $t$
declare log jsonb := '[]'::jsonb; r jsonb; rec text;
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';
  u_sk uuid := gen_random_uuid(); u_sk3 uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid(); u_bm uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'grn-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_sk,'sk'),(u_sk3,'sk3'),(u_qa,'qa'),(u_bm,'bm')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'grn-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_sk,'sk','Storekeeper','BKE-002'),(u_sk3,'sk3','Storekeeper','BKE-003'),(u_qa,'qa','QA / Lab',null),(u_bm,'bm','Branch Manager',null)) v(id,k,ro,w);
  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test GRN','supplier_code','DIS-008-FOU','origin','Odienne',
     'warehouse_id',wh,'arrival_at',(now()-interval '2 hour')::text,'driver','SIM','truck','GR0808CI'),'GRN-T-REC');
  rec := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',290,'imm_g',15,'spotted_g',10,'moisture_pct',8.5,'idempotency_key','GRN-T-Q1'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  perform public.wms_decide_reception(rec,true,'OK');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  perform public.wms_record_offload(rec, jsonb_build_object('gross_kg',30000,'tare_kg',12000,'bags',240));
  r := public.wms_generate_grn(rec);
  log := log || jsonb_build_object('t','G2 Storekeeper BKE-002 genere le GRN','res',r->>'id','idempotent',r->'idempotent');
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
    r := public.wms_generate_grn(rec);
    log := log || jsonb_build_object('t','G3 Storekeeper BKE-003 sur reception BKE-002','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','G3 Storekeeper BKE-003 sur reception BKE-002','res','REFUSE','err',SQLERRM); end;
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  r := public.wms_generate_grn(rec);
  log := log || jsonb_build_object('t','G4 BM rejoue Generer (idempotent)','res',r->>'id','idempotent',r->'idempotent');
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
  log := log || jsonb_build_object('t','G5 lecture du GRN par Storekeeper BKE-003 (ecran Voir)','res',(select count(*) from public.wms_grns where reception_id=rec));
  reset role;
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
