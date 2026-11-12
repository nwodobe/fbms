-- =============================================================================
-- Faisabilité technique de l'enrôlement direct à Béoumi, Brobo et Diabo
-- (clusters sans aucun producteur enrôlé directement au 25/10/2026, et sans compte Unit Head).
-- Simule, dans une transaction annulée (RAISE final), la synchronisation hors ligne d'un
-- enrôlement direct (FARMER_ENROLL) puis l'enregistrement du consentement :
--   E1-E3  Zonal Head, un village par cluster          -> attendu : enrôlement accepté
--   E4     Unit Head d'un autre cluster (Botro) à Béoumi -> attendu : refusé (périmètre)
--   E5     consentement par le Zonal Head, règle ACTUELLE -> attendu : refusé (P0-1 non appliqué)
--   E6     même consentement après P0-1 (dans la transaction) -> attendu : accepté
-- Aucune donnée n'est conservée : ce ne sont pas des enrôlements réels.
-- Observé le 25/10/2026 : E1 SYNCED, E2 SYNCED, E3 SYNCED, E4 NEEDS_REVIEW
--   (« Village ou RT hors de votre périmètre. », sqlstate 42501, aucun producteur créé),
--   E5 REFUSÉ, E6 ACCEPTÉ.
-- Remplacer <…> par les identifiants réels.
-- =============================================================================
do $t$
declare
  zh uuid := '<UUID_ZONAL_HEAD>'; uhbo uuid := '<UUID_UNIT_HEAD_BOTRO>'; camp uuid := '<UUID_CAMPAGNE_COURANTE>';
  vbe text := '<VILLAGE_BEOUMI>'; vbr text := '<VILLAGE_BROBO>'; vdi text := '<VILLAGE_DIABO>';
  log text := ''; r record; res jsonb; pid_be text; c text;
begin
  execute $f$
  create function pg_temp.enrol(u uuid, vid text, camp uuid) returns jsonb language plpgsql as $g$
  declare rt text; res jsonb;
  begin
    select rt_id into rt from public.producteurs where village_id = vid and rt_id is not null limit 1;
    perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
    perform set_config('role','authenticated',true);
    select public.offline_sync_batch(jsonb_build_array(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'idempotency_key', gen_random_uuid(), 'operation_type','FARMER_ENROLL',
      'campaign_id', camp, 'device_id', gen_random_uuid(), 'created_at_client', now(),
      'payload', jsonb_build_object('local_id','local-farmer-qa-direct',
        'row', jsonb_build_object('nom','QA DIRECT','prenoms','TEST '||upper(substr(md5(random()::text),1,6)),'sexe','F','birth_year',1979,
               'telephone','07'||lpad((floor(random()*1e8))::bigint::text,8,'0'),'village_id',vid,'rt_id',rt,'data',jsonb_build_object('source','QA_DIRECT')),
        'plot', jsonb_build_object('local_name','QA','declared_area','1.0','latitude','','longitude','','gps_accuracy_m','','gps_captured_at',''))
    ))) into res;
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true);
    return res;
  exception when others then
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true);
    return jsonb_build_object('erreur', left(sqlerrm,80));
  end $g$;
  create function pg_temp.consent(u uuid, pid text) returns text language plpgsql as $g$
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
    perform set_config('role','authenticated',true);
    insert into public.farmer_consents(producteur_id,status,scopes,consent_at,text_version,method,source,agent_id,created_by)
    values (pid,'PARTIAL','{"identity":true,"agriculture":true}',now(),'AFLP-DATA-CONSENT-2026.1','VERBAL','QA_DIRECT',u,u);
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true);
    return 'ACCEPTÉ';
  exception when others then
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true);
    return 'REFUSÉ';
  end $g$;
  $f$;

  for r in select * from (values ('E1 Béoumi',vbe),('E2 Brobo',vbr),('E3 Diabo',vdi)) v(cas,vid) loop
    res := pg_temp.enrol(zh, r.vid, camp);
    log := log || format('%s, Zonal Head : %s ; ', r.cas, coalesce(res->'results'->0->>'status', res->>'erreur', res::text));
    if r.cas like 'E1%' then pid_be := res->'results'->0->>'server_id'; end if;
  end loop;
  res := pg_temp.enrol(uhbo, vbe, camp);
  log := log || format('E4 Béoumi, Unit Head Botro : %s ; ', coalesce(res->'results'->0->>'status', res->>'erreur', res::text)
                       || coalesce(' ('||left(res->'results'->0->>'error',60)||')',''));
  log := log || 'E5 consentement Zonal Head, règle actuelle : ' || pg_temp.consent(zh, pid_be) || ' ; ';
  execute 'alter policy farmer_consents_insert on public.farmer_consents with check (private.farmer_registry_can_capture() and created_by = auth.uid() and agent_id = auth.uid() and private.farmer_registry_can_access_producteur(producteur_id))';
  log := log || 'E6 consentement Zonal Head, après P0-1 : ' || pg_temp.consent(zh, pid_be);
  raise exception 'ENRÔLEMENT DIRECT (transaction annulée) : %', log;
end $t$;
