-- =====================================================================
-- FBMS / WMS · vérification du 25/09/2026 · TEST NON DESTRUCTIF
-- Écart 1 : doublon camion avec espaces, tirets ou minuscules
--   D1 création "GH 4455 CI" (plaque stockée normalisée GH4455CI)
--   D2 "GH4455CI" sur le même créneau  -> refusé (doublon probable)
--   D3 "gh-4455-ci" sur le même créneau -> refusé (doublon probable)
--   D4 "GH 4456 CI" (autre camion)      -> accepté
--
-- Exécution : coller tel quel dans l'éditeur SQL Supabase (ou via
-- execute_sql). Le script se termine TOUJOURS par
--   raise exception 'SIMULATION_RESULT %'
-- qui annule l'intégralité de la transaction : aucun compte, aucune
-- réception n'est conservé. NE JAMAIS retirer cette dernière instruction.
-- Comptes : fictifs (@audit.invalid), créés puis annulés dans la même
-- transaction. Aucune donnée personnelle réelle.
-- =====================================================================
do $t$
declare log jsonb := '[]'::jsonb; r jsonb;
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';
  u_sk uuid := gen_random_uuid();
  arr text := (now()-interval '1 hour')::text;
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  values (u_sk,'dup-sk-'||left(u_sk::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000');
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  values (u_sk,'dup-sk-'||left(u_sk::text,8)||'@audit.invalid','SIM Storekeeper','Storekeeper',true,'BKE-002','BKE');
  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test doublon','supplier_code','DIS-008-FOU','origin','Odienne',
     'warehouse_id',wh,'arrival_at',arr,'driver','SIM','truck','GH 4455 CI'),'DUP-T-1');
  log := log || jsonb_build_object('t','D1 creation GH 4455 CI','res','ACCEPTE','truck_stocke',r->>'truck');
  begin
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test doublon','supplier_code','DIS-008-FOU','origin','Odienne',
       'warehouse_id',wh,'arrival_at',arr,'driver','SIM','truck','GH4455CI'),'DUP-T-2');
    log := log || jsonb_build_object('t','D2 GH4455CI meme creneau','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','D2 GH4455CI meme creneau','res','REFUSE','err',SQLERRM,'code',SQLSTATE); end;
  begin
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test doublon','supplier_code','DIS-008-FOU','origin','Odienne',
       'warehouse_id',wh,'arrival_at',arr,'driver','SIM','truck','gh-4455-ci'),'DUP-T-3');
    log := log || jsonb_build_object('t','D3 gh-4455-ci meme creneau','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','D3 gh-4455-ci meme creneau','res','REFUSE','err',SQLERRM,'code',SQLSTATE); end;
  begin
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test doublon','supplier_code','DIS-008-FOU','origin','Odienne',
       'warehouse_id',wh,'arrival_at',arr,'driver','SIM','truck','GH 4456 CI'),'DUP-T-4');
    log := log || jsonb_build_object('t','D4 autre camion GH 4456 CI','res','ACCEPTE','truck_stocke',r->>'truck');
  exception when others then log := log || jsonb_build_object('t','D4 autre camion GH 4456 CI','res','REFUSE (regression)','err',SQLERRM); end;
  reset role;
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
