-- =====================================================================
-- FBMS / WMS · correctifs P0/P1 du 25/09/2026 · TEST NON DESTRUCTIF
-- Lot 6 : GRN officiel, checklist documentaire CCA, gouvernance des paramètres (P1-08, P1-09, P1-13)
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
  u_sk uuid := gen_random_uuid(); u_sk3 uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid(); u_bm uuid := gen_random_uuid(); u_bm2 uuid := gen_random_uuid();
  wh uuid := 'b6026ebc-018b-47c4-82ec-592a50162281';
  r jsonb; x jsonb; rec text; rec2 text; lot text; pid uuid; pid2 uuid;
begin
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'sim6-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_sk,'sk'),(u_sk3,'sk3'),(u_qa,'qa'),(u_bm,'bm'),(u_bm2,'bm2')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,warehouse_code)
  select v.id,'sim6-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.k,v.ro,true,v.w
  from (values (u_sk,'sk','Storekeeper','BKE-002'),(u_sk3,'sk3','Storekeeper','BKE-003'),(u_qa,'qa','QA / Lab',null),(u_bm,'bm','Branch Manager',null),(u_bm2,'bm2','Assistant Branch Manager',null)) v(id,k,ro,w);

  -- D1 matrice documentaire validee par le BM (valeur de test : CCAK obligatoire pour tous les canaux)
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_set_document_requirement('CCAK', array['*'], 'Test uniquement (rollback)');
    log := log || jsonb_build_object('t','D1 BM rend CCAK obligatoire (test)','ok',(r->>'governance_status')='VALIDE');
  exception when others then log := log || jsonb_build_object('t','D1','ok',false,'err',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_set_document_requirement('BORDEREAU', array['*'], 'x');
    log := log || jsonb_build_object('t','D1b Storekeeper modifie la matrice','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','D1b Storekeeper modifie la matrice refuse','ok',true,'refus',SQLERRM); end;

  -- Réception créée hors du bloc de test (sinon le refus attendu en D2 l'annulerait)
  perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
  r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test documents','supplier_code','DIS-003-DEM','origin','Dabakala',
       'warehouse_id',wh,'arrival_at',now()::text,'driver','SIM','truck','SIM6001'),'SIM6-REC');
  rec := r->>'id';
  perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
  r := public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',280,'imm_g',20,'spotted_g',10,'idempotency_key','SIM6-Q1'));

  begin
    x := (select jsonb_build_object('doc_status',doc_status,'manquants',missing_mandatory,'canal',procurement_channel) from public.wms_v_reception_documents_status where reception_id=rec);
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception_v2(rec,true,'OK',null);
    log := log || jsonb_build_object('t','D2 acceptation sans CCAK','ok',false,'constat','ACCEPTE','etat',x);
  exception when others then log := log || jsonb_build_object('t','D2 acceptation sans CCAK refusee','ok',true,'refus',SQLERRM,'etat',x); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_reception_document(rec,'CCAK','PRESENT',null,null,null);
    log := log || jsonb_build_object('t','D3 CCAK present sans reference','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','D3 CCAK present sans reference refuse','ok',true,'refus',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_reception_document(rec,'CCAK','PRESENT','CCAK-SIM-001',null,null);
    x := (select jsonb_build_object('doc_status',doc_status) from public.wms_v_reception_documents_status where reception_id=rec);
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception_v2(rec,true,'OK',null);
    log := log || jsonb_build_object('t','D4 CCAK saisi : statut COMPLET puis acceptation','ok',(x->>'doc_status')='COMPLET' and (r->>'status')='ACCEPTED_WAITING_OFFLOAD','res',x);
  exception when others then log := log || jsonb_build_object('t','D4','ok',false,'err',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
    r := public.wms_record_reception_document(rec,'BORDEREAU','PRESENT','X',null,null);
    log := log || jsonb_build_object('t','D5 Storekeeper BKE-003 saisit un document BKE-002','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','D5 saisie document hors perimetre refusee','ok',true,'refus',SQLERRM); end;

  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','DIRECT','ad_hoc',true,'ad_hoc_reason','Test derogation','supplier_code','DIS-003-DEM','origin','Dabakala',
         'warehouse_id',wh,'arrival_at',(now()+interval '4 hour')::text,'driver','SIM','truck','SIM6002'),'SIM6-REC2');
    rec2 := r->>'id';
    r := public.wms_record_reception_document(rec2,'CCAK','NON_CONFORME','CCAK-SIM-002',null,'Cachet illisible');
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec2,'SAMPLING',jsonb_build_object('gk_g',280,'imm_g',20,'spotted_g',10,'idempotency_key','SIM6-Q2'));
    x := (select jsonb_build_object('doc_status',doc_status,'non_conformes',non_conforming_mandatory) from public.wms_v_reception_documents_status where reception_id=rec2);
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm2,'role','authenticated')::text,true);
    begin
      r := public.wms_document_derogation(rec2,'x');
      x := x || jsonb_build_object('derogation_abm','ACCEPTEE');
    exception when others then x := x || jsonb_build_object('derogation_abm_refusee',SQLERRM); end;
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_document_derogation(rec2,'Original presente au bureau CCA, copie a suivre');
    x := x || jsonb_build_object('apres_derogation',r->>'doc_status');
    r := public.wms_decide_reception_v2(rec2,true,'OK',null);
    x := x || jsonb_build_object('decision',r->>'status');
    log := log || jsonb_build_object('t','D6 document non conforme : REJETE, derogation BM tracee, acceptation','ok',(x->>'apres_derogation')='DEROGATION_BM','res',x);
  exception when others then log := log || jsonb_build_object('t','D6','ok',false,'err',SQLERRM,'res',x); end;

  -- G GRN
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_generate_grn(rec);
    log := log || jsonb_build_object('t','G1 GRN avant dechargement','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','G1 GRN avant dechargement refuse','ok',true,'refus',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec, jsonb_build_object('gross_kg',42350,'tare_kg',12150,'bags_good',375,'bags_torn',5,'weighbridge_ticket','PB-SIM6','warehouse_receipt','BR-SIM6'));
    lot := r->>'lot_id';
    r := public.wms_generate_grn(rec);
    x := jsonb_build_object('grn',r->>'id','lot',r->>'lot_id','net',r->'content'->'weighing'->>'net_kg','sacs',r->'content'->'bags','ccak',(select d->>'status' from jsonb_array_elements(r->'content'->'documents'->'checklist') d where d->>'code'='CCAK'),
          'qualite',r->'content'->'quality','fournisseur',r->'content'->'supplier'->>'code');
    r := public.wms_generate_grn(rec);
    x := x || jsonb_build_object('rejeu_idempotent',r->>'idempotent','meme_numero',(r->>'id')=(x->>'grn'));
    log := log || jsonb_build_object('t','G2 GRN officiel apres dechargement','ok',(x->>'grn') ~ '^GRN-BKE002-[0-9]{4}-[0-9]{4}$','res',x);
  exception when others then log := log || jsonb_build_object('t','G2 GRN','ok',false,'err',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk3,'role','authenticated')::text,true);
    r := public.wms_generate_grn(rec2);
    log := log || jsonb_build_object('t','G3 GRN par Storekeeper BKE-003','ok',false,'constat','ACCEPTE');
  exception when others then log := log || jsonb_build_object('t','G3 GRN hors perimetre refuse','ok',true,'refus',SQLERRM); end;

  -- J journal / historique lot
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    set local role authenticated;
    x := (select jsonb_agg(jsonb_build_object('mvt',movement_id,'type',type,'entrepot',warehouse_code,'bin',bin_id,'qty_in',qty_in,'auteur',created_by_name,'ref',reference_id)) from public.wms_v_movement_lines where lot_id=lot);
    reset role;
    log := log || jsonb_build_object('t','J1 historique du lot via wms_v_movement_lines (Storekeeper)','ok',jsonb_array_length(coalesce(x,'[]'::jsonb))>=1,'res',x);
  exception when others then reset role; log := log || jsonb_build_object('t','J1','ok',false,'err',SQLERRM); end;

  -- P parametres
  begin
    select id into pid from public.wms_parameters where key='korTolerance' order by version desc limit 1;
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_validate_parameter(pid,'Decision test (rollback)');
    x := jsonb_build_object('statut',r->>'governance_status','valide_par',r->>'validated_by_name');
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm2,'role','authenticated')::text,true);
    r := public.wms_set_parameter('korTolerance','{"unit":"lb","value":1.5}'::jsonb,'Proposition test');
    pid2 := (r->>'id')::uuid;
    x := x || jsonb_build_object('nouvelle_version',r->>'version','nouveau_statut',(select governance_status from public.wms_parameters where id=pid2),
          'valeur_en_vigueur',public.wms_param('korTolerance')->>'value');
    begin
      r := public.wms_validate_parameter(pid2,'auto');
      x := x || jsonb_build_object('auto_validation','ACCEPTEE');
    exception when others then x := x || jsonb_build_object('auto_validation_refusee',SQLERRM); end;
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_validate_parameter(pid2,'Decision test 2');
    x := x || jsonb_build_object('valeur_apres_validation',public.wms_param('korTolerance')->>'value','ancienne',(select governance_status from public.wms_parameters where id=pid));
    log := log || jsonb_build_object('t','P1 gouvernance parametres (brouillon, validation, archive, SoD)','ok',(x->>'valeur_en_vigueur')='1' and (x->>'valeur_apres_validation')='1.5','res',x);
  exception when others then log := log || jsonb_build_object('t','P1 parametres','ok',false,'err',SQLERRM,'res',x); end;
  begin
    log := log || jsonb_build_object('t','P2 vue gouvernance','ok',true,'res',(select jsonb_agg(jsonb_build_object('key',key,'v',version,'statut',governance_status,'courant',is_current,'a_valider',value_flagged_a_valider) order by key, version) from public.wms_v_parameters_governance));
  exception when others then log := log || jsonb_build_object('t','P2','ok',false,'err',SQLERRM); end;

  raise exception 'SIMULATION_RESULT %', log::text;
end
$sim$;
