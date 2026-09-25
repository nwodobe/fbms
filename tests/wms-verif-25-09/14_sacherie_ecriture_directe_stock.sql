-- =====================================================================
-- FBMS / WMS · vérification du 25/09/2026 · TEST NON DESTRUCTIF
-- Écart 4 : écriture directe dans le grand livre sacherie (API REST)
-- Le déclencheur private.rcn_jute_guard contrôle déjà le stock disponible
-- pour toute écriture INTERNE, y compris hors RPC. Ce test le prouve :
--   J0 Storekeeper : aucune écriture directe (RPC uniquement) -> refusée
--   J1 Warehouse Manager BKE-002, sortie directe de 999 999 sacs pleins de
--      son magasin -> refusée (stock insuffisant)
--   J2 Warehouse Manager BKE-002, écriture directe sur le magasin BKE-003
--      -> refusée (périmètre, politique restrictive)
--   J3 anon, écriture directe -> refusée
--   J4 Warehouse Manager BKE-002, sortie directe de 10 sacs avec 50 en
--      stock -> acceptée (contrôle, pas de blocage abusif)
-- Se termine TOUJOURS par raise exception 'SIMULATION_RESULT %' :
-- tout est annulé. NE JAMAIS retirer cette dernière instruction.
-- =====================================================================
do $t$
declare log jsonb := '[]'::jsonb;
  u_sk uuid := gen_random_uuid(); u_wm uuid := gen_random_uuid(); u_bm uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'jd-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_sk,'sk'),(u_wm,'wm'),(u_bm,'bm')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code,site_code)
  select v.id,'jd-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.w,'BKE'
  from (values (u_sk,'sk','Storekeeper','BKE-002'),(u_wm,'wm','Warehouse Manager','BKE-002'),(u_bm,'bm','Branch Manager',null)) v(id,k,ro,w);
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,reference,note,owner_type)
  values ('JUT-TEST-JD','TEST-JD-SEED','AJUSTEMENT_INVENTAIRE','INTERNE',50,'BAG-WH-BKE-002','PLEIN','TEST','Stock de test (rollback)','ANAGROCI');
  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  begin
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,to_location,to_state,reference,owner_type)
    values ('JUT-TEST-JD0','TEST-JD-0','TRANSFERT','INTERNE',1,'BAG-WH-BKE-002','PLEIN','JUTE-TRANSIT','EN_TRANSIT','TEST','ANAGROCI');
    log := log || jsonb_build_object('t','J0 Storekeeper ecriture directe','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','J0 Storekeeper ecriture directe','res','REFUSE','err',SQLERRM); end;
  perform set_config('request.jwt.claims',json_build_object('sub',u_wm,'role','authenticated')::text,true);
  begin
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,to_location,to_state,reference,owner_type)
    values ('JUT-TEST-JD1','TEST-JD-1','TRANSFERT','INTERNE',999999,'BAG-WH-BKE-002','PLEIN','JUTE-TRANSIT','EN_TRANSIT','TEST','ANAGROCI');
    log := log || jsonb_build_object('t','J1 sortie directe 999 999 sacs','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','J1 sortie directe 999 999 sacs','res','REFUSE','err',SQLERRM); end;
  begin
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,reference,owner_type)
    values ('JUT-TEST-JD2','TEST-JD-2','AJUSTEMENT_INVENTAIRE','INTERNE',5,'BAG-WH-BKE-003','PLEIN','TEST','ANAGROCI');
    log := log || jsonb_build_object('t','J2 ecriture directe hors perimetre (BKE-003)','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','J2 ecriture directe hors perimetre (BKE-003)','res','REFUSE','err',SQLERRM); end;
  begin
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,to_location,to_state,reference,owner_type)
    values ('JUT-TEST-JD4','TEST-JD-4','TRANSFERT','INTERNE',10,'BAG-WH-BKE-002','PLEIN','JUTE-TRANSIT','EN_TRANSIT','TEST','ANAGROCI');
    log := log || jsonb_build_object('t','J4 sortie directe 10 sacs sur 50 en stock','res','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','J4 sortie directe 10 sacs sur 50 en stock','res','REFUSE (blocage abusif)','err',SQLERRM); end;
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims',json_build_object('role','anon')::text,true);
  begin
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,reference,owner_type)
    values ('JUT-TEST-JD3','TEST-JD-3','AJUSTEMENT_INVENTAIRE','INTERNE',5,'BAG-WH-BKE-002','PLEIN','TEST','ANAGROCI');
    log := log || jsonb_build_object('t','J3 anon ecriture directe','res','ACCEPTE (faille)');
  exception when others then log := log || jsonb_build_object('t','J3 anon ecriture directe','res','REFUSE','code',SQLSTATE); end;
  reset role;
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
