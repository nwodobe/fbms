-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- P1-01 : périmètre d'écriture sacherie (insertion directe hors périmètre refusée, écrans historiques préservés)
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
declare log jsonb := '[]'::jsonb; u_wm uuid := gen_random_uuid(); u_bm uuid := gen_random_uuid(); u_sk uuid := gen_random_uuid(); r jsonb;
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'jws-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_wm,'wm'),(u_bm,'bm'),(u_sk,'sk')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'jws-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_wm,'wm','Warehouse Manager','BKE-002'),(u_bm,'bm','Branch Manager',null),(u_sk,'sk','Storekeeper','BKE-002')) v(id,k,ro,w);
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,source_type,reference,owner_type,movement_at)
  values ('JWS-0','JWS-0','SOLDE_INITIAL','INTERNE',100,'BAG-WH-BKE-002','UTILISABLE','SIM','t','ANAGROCI',now()),
         ('JWS-00','JWS-00','SOLDE_INITIAL','INTERNE',100,'BAG-WH-BKE-003','UTILISABLE','SIM','t','ANAGROCI',now());

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_wm,'role','authenticated')::text,true);
    set local role authenticated;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('JWS-1','JWS-1','TRANSFERT','INTERNE',10,'BAG-WH-BKE-003','UTILISABLE','BAG-WH-BKE-001','UTILISABLE','SIM','t','ANAGROCI',now());
    reset role;
    log := log || jsonb_build_object('t','WM BKE-002 ecrit en direct BKE-003 -> BKE-001','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','WM BKE-002 ecrit en direct BKE-003 -> BKE-001','res','REFUSE','err',SQLERRM); end;
  reset role;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_wm,'role','authenticated')::text,true);
    set local role authenticated;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('JWS-2','JWS-2','TRANSFERT','INTERNE',10,'BAG-WH-BKE-002','UTILISABLE','JUTE-TRANSIT','EN_TRANSIT','SIM','t','ANAGROCI',now());
    reset role;
    log := log || jsonb_build_object('t','WM BKE-002 expedie depuis son propre emplacement (ecran historique)','res','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','WM BKE-002 expedie depuis son propre emplacement','res','REFUSE','err',SQLERRM); end;
  reset role;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    set local role authenticated;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('JWS-3','JWS-3','TRANSFERT','INTERNE',10,'BAG-WH-BKE-003','UTILISABLE','BAG-WH-BKE-001','UTILISABLE','SIM','t','ANAGROCI',now());
    reset role;
    log := log || jsonb_build_object('t','BM ecrit BKE-003 -> BKE-001 (non limite)','res','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','BM ecrit BKE-003 -> BKE-001','res','REFUSE','err',SQLERRM); end;
  reset role;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    set local role authenticated;
    r := public.wms_bag_move(jsonb_build_object('kind','INTERNAL_USE','qty',5,'location','BAG-WH-BKE-002','idempotency_key','JWS-BM'));
    reset role;
    log := log || jsonb_build_object('t','Storekeeper BKE-002 via wms_bag_move (fonction metier)','res','ACCEPTE','lignes',jsonb_array_length(r->'ids'));
  exception when others then log := log || jsonb_build_object('t','Storekeeper via wms_bag_move','res','REFUSE','err',SQLERRM); end;
  reset role;

  begin
    set local role anon;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,source_type,reference,owner_type,movement_at)
    values ('JWS-4','JWS-4','SOLDE_INITIAL','INTERNE',10,'BAG-WH-BKE-002','UTILISABLE','SIM','t','ANAGROCI',now());
    reset role;
    log := log || jsonb_build_object('t','anon insert','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','anon insert','res','REFUSE','err',SQLERRM); end;
  reset role;

  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
