-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- P0-03 : appel direct du grand livre sous le rôle API authenticated (Viewer/Auditor, Storekeeper, BM) + opération normale + motif HOLD visible
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
declare log jsonb := '[]'::jsonb; u uuid; ro text; w text; r jsonb; rec text; lotid text;
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';
  u_sk uuid; u_qa uuid; u_bm uuid; u_view uuid;
begin
  for ro, w in select * from (values ('Viewer / Auditor',null),('Storekeeper','BKE-002'),('Branch Manager',null)) v(a,b) loop
    u := gen_random_uuid();
    insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
    values (u,'p003-'||left(u::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000');
    insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code) values (u,'p003-'||left(u::text,8)||'@audit.invalid','SIM '||ro,ro,true,w,'BKE');
    if ro='Storekeeper' then u_sk := u; elsif ro='Branch Manager' then u_bm := u; else u_view := u; end if;
  end loop;
  u_qa := gen_random_uuid();
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  values (u_qa,'p003qa-'||left(u_qa::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000');
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code) values (u_qa,'p003qa-'||left(u_qa::text,8)||'@audit.invalid','SIM QA','QA / Lab',true,null,'BKE');

  -- operation normale via RPC metier, sous role API authenticated
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test P0-03','supplier_code','DIS-008-FOU','origin','Odienne',
       'warehouse_id',wh,'arrival_at',(now()-interval '2 hour')::text,'driver','SIM','truck','ZZ0303CI'),'P003-REC');
    rec := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    perform public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',290,'imm_g',15,'spotted_g',10,'moisture_pct',8.5,'idempotency_key','P003-Q1'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    perform public.wms_decide_reception(rec,true,'OK');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec, jsonb_build_object('gross_kg',30000,'tare_kg',12000,'bags',240));
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    perform public.wms_save_quality(rec,'FINAL',jsonb_build_object('gk_g',270,'imm_g',15,'spotted_g',10,'moisture_pct',8.5,'net_kg',18000,'idempotency_key','P003-Q2'));
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    select lot_id into lotid from public.wms_receptions where id=rec;
    log := log || jsonb_build_object('t','Operation normale Storekeeper (RPC metier, role API authenticated) + ecart KOR','res','OK',
      'lot_vu_par_storekeeper',(select jsonb_build_object('id',id,'statut',status,'kg',current_kg,'motif_hold',hold_reason,'staging',staging_kg) from public.wms_v_lots where id=lotid),
      'reception',(select status from public.wms_receptions where id=rec));
    reset role;
  exception when others then log := log || jsonb_build_object('t','Operation normale','res','KO','err',SQLERRM); end;
  reset role;

  -- P0-03 : appel direct du grand livre par 3 roles, role API authenticated
  foreach u in array array[u_view,u_sk,u_bm] loop
    begin
      perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
      set local role authenticated;
      r := public.wms_post_movement(jsonb_build_object('type','OFFLOAD','idempotency_key','P003-PH-'||u,'warehouse_id',wh,'source_type','TRUCK','source_id','FAUX',
           'dest_type','STAGING','dest_id',wh::text,'lots',jsonb_build_array(jsonb_build_object('lot_id',lotid,'qty_out',5000,'qty_in',5000))));
      reset role;
      log := log || jsonb_build_object('role',(select role from public.profils where user_id=u),'wms_post_movement','ACCEPTE (faille)');
    exception when others then log := log || jsonb_build_object('role',(select role from public.profils where user_id=u),'wms_post_movement','REFUSE','err',SQLERRM); end;
    reset role;
  end loop;
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
