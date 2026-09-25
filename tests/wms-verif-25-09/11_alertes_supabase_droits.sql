-- =====================================================================
-- FBMS · vérification du 25/09/2026 · TEST NON DESTRUCTIF
-- Alertes Supabase : droits EXECUTE anon retirés, search_path figé
--   A1 anon ne peut plus appeler sacherie_ops_closure_readiness
--   A2 anon ne peut plus appeler portee_terrain_globale
--   A3 un utilisateur connecté (Branch Manager fictif) appelle toujours
--      sacherie_ops_closure_readiness et portee_terrain_globale
--   A4 search_path figé sur fb_preserve_media_rt / _villages
--   A5 le déclencheur procurement_capture_rejection fonctionne toujours
--      (refus d'une réception de test par un Branch Manager fictif)
-- Se termine TOUJOURS par raise exception 'SIMULATION_RESULT %' :
-- tout est annulé. NE JAMAIS retirer cette dernière instruction.
-- Comptes fictifs (@audit.invalid) annulés avec la transaction.
-- =====================================================================
do $t$
declare log jsonb := '[]'::jsonb; r jsonb; b boolean; rec text;
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';
  u_bm uuid := gen_random_uuid(); u_sk uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'adv-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_bm,'bm'),(u_sk,'sk'),(u_qa,'qa')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'adv-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_bm,'bm','Branch Manager',null),(u_sk,'sk','Storekeeper','BKE-002'),(u_qa,'qa','QA / Lab',null)) v(id,k,ro,w);
  set local role anon;
  perform set_config('request.jwt.claims',json_build_object('role','anon')::text,true);
  begin r := public.sacherie_ops_closure_readiness('WAREHOUSE','BKE-002'); log := log || jsonb_build_object('t','A1 anon sacherie_ops_closure_readiness','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','A1 anon sacherie_ops_closure_readiness','res','REFUSE','code',SQLSTATE); end;
  begin b := public.portee_terrain_globale(); log := log || jsonb_build_object('t','A2 anon portee_terrain_globale','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','A2 anon portee_terrain_globale','res','REFUSE','code',SQLSTATE); end;
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  begin r := public.sacherie_ops_closure_readiness('WAREHOUSE','BKE-002'); b := public.portee_terrain_globale();
    log := log || jsonb_build_object('t','A3 BM connecte appelle les deux fonctions','res','ACCEPTE','portee_globale',b);
  exception when others then log := log || jsonb_build_object('t','A3 BM connecte appelle les deux fonctions','res','REFUSE (regression)','err',SQLERRM,'code',SQLSTATE); end;
  reset role;
  log := log || jsonb_build_object('t','A4 search_path fige','res',(select jsonb_agg(p.proname||'='||coalesce(array_to_string(p.proconfig,','),'NON FIGE')) from pg_proc p where p.proname in ('fb_preserve_media_rt','fb_preserve_media_villages')));
  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test alertes','supplier_code','DIS-008-FOU','origin','Odienne',
     'warehouse_id',wh,'arrival_at',(now()-interval '1 hour')::text,'driver','SIM','truck','ADV1111CI'),'ADV-T-REC');
  rec := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  perform public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',200,'imm_g',15,'spotted_g',10,'moisture_pct',12.5,'idempotency_key','ADV-T-Q1'));
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  begin
    perform public.wms_decide_reception_v2(rec,false,'Test refus alertes','HIGH_MOISTURE');
    log := log || jsonb_build_object('t','A5 refus reception (declencheur procurement_capture_rejection)','res','ACCEPTE','statut',(select status from public.wms_receptions where id=rec));
  exception when others then log := log || jsonb_build_object('t','A5 refus reception (declencheur procurement_capture_rejection)','res','ECHEC','err',SQLERRM); end;
  reset role;
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
