-- =============================================================================
-- Test de restauration des deux correctifs PRÉPARÉS (non appliqués en production)
--   1. supabase/PREPARE_20261025_consentements_roles_aflp_et_separation_taches.sql
--   2. supabase/PREPARE_20261025_offline_sync_precision_gps.sql
-- Dans UNE transaction annulée (RAISE final) :
--   a) photographie l'état de production (politique, trigger, empreinte de offline_sync_batch) ;
--   b) applique chaque correctif et vérifie qu'il agit (GPS : précision conservée / NOT_MAPPED) ;
--   c) exécute le retour arrière documenté (section R) ;
--   d) vérifie que l'état est revenu STRICTEMENT identique à la photographie.
-- Aucune donnée ni règle n'est persistée.
-- Remplacer <…> par les identifiants réels (Unit Head, son village, campagne courante).
-- =============================================================================
do $t$
declare
  uh uuid := '<UUID_UNIT_HEAD>'; vid text := '<VILLAGE_DU_UNIT_HEAD>'; camp uuid := '<UUID_CAMPAGNE_COURANTE>';
  pol0 text; def0 text; trg0 int; pol1 text; trg1 int; def1 text; pol2 text; trg2 int; def2 text; fn2 int;
  ancien text; nouveau text; d text; n int; res jsonb; q record; r record; log text := ''; rt text;
begin
  -- a) Photographie
  select with_check into pol0 from pg_policies where schemaname='public' and tablename='farmer_consents' and policyname='farmer_consents_insert';
  select count(*) into trg0 from pg_trigger where tgname='trg_farmer_verification_separation';
  def0 := md5(pg_get_functiondef('public.offline_sync_batch(jsonb)'::regprocedure));

  -- b1) Correctif droits (texte identique au fichier PREPARE, sans begin/commit)
  execute 'alter policy farmer_consents_insert on public.farmer_consents with check (private.farmer_registry_can_capture() and created_by = auth.uid() and agent_id = auth.uid() and private.farmer_registry_can_access_producteur(producteur_id))';
  execute $f$create or replace function private.farmer_verification_separation_guard() returns trigger language plpgsql security definer set search_path = public, private as $g$ begin return new; end $g$;$f$;
  execute 'create trigger trg_farmer_verification_separation before insert or update on public.farmer_verifications for each row execute function private.farmer_verification_separation_guard()';
  select with_check into pol1 from pg_policies where schemaname='public' and tablename='farmer_consents' and policyname='farmer_consents_insert';
  select count(*) into trg1 from pg_trigger where tgname='trg_farmer_verification_separation';
  log := log || format('Droits appliqués : politique contient can_capture=%s, trigger=%s ; ', pol1 like '%farmer_registry_can_capture%', trg1);

  -- b2) Correctif GPS : blocs ancien / nouveau identiques au fichier PREPARE
  ancien := $a$insert into public.farmer_plots(
            id,producteur_id,village_id,local_name,declared_area,area_unit,latitude,longitude,
            gps_status,gps_captured_at,area_source,evidence_level,status
          ) values (
            gen_random_uuid(),v_pid,v_row->>'village_id',
            coalesce(nullif(v_payload->'plot'->>'local_name',''),'PARCELLE PRINCIPALE'),
            nullif(v_payload->'plot'->>'declared_area','')::numeric,'HA',
            nullif(v_payload->'plot'->>'latitude','')::numeric,
            nullif(v_payload->'plot'->>'longitude','')::numeric,
            'NOT_MAPPED',
            null,
            'DECLARED','DECLARED','ACTIVE'
          );$a$;
  nouveau := $n$insert into public.farmer_plots(
            id,producteur_id,village_id,local_name,declared_area,area_unit,latitude,longitude,
            gps_accuracy_m,gps_status,gps_captured_at,area_source,evidence_level,status,notes
          ) values (
            gen_random_uuid(),v_pid,v_row->>'village_id',
            coalesce(nullif(v_payload->'plot'->>'local_name',''),'PARCELLE PRINCIPALE'),
            nullif(v_payload->'plot'->>'declared_area','')::numeric,'HA',
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                 then nullif(v_payload->'plot'->>'latitude','')::numeric end,
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                 then nullif(v_payload->'plot'->>'longitude','')::numeric end,
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                 then nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric end,
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                  and nullif(v_payload->'plot'->>'latitude','') is not null
                 then 'POINT_CAPTURED' else 'NOT_MAPPED' end,
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                  and nullif(v_payload->'plot'->>'latitude','') is not null
                 then coalesce(nullif(v_payload->'plot'->>'gps_captured_at','')::timestamptz, now()) end,
            'DECLARED','DECLARED','ACTIVE',
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) <= 0
                  and nullif(v_payload->'plot'->>'latitude','') is not null
                 then 'Coordonnées saisies sans précision GPS : '||(v_payload->'plot'->>'latitude')||', '
                      ||(v_payload->'plot'->>'longitude')||'. À relever au GPS.' end
          );$n$;
  d := pg_get_functiondef('public.offline_sync_batch(jsonb)'::regprocedure);
  n := (length(d) - length(replace(d, ancien, ''))) / length(ancien);
  if n <> 1 then raise exception 'Bloc attendu trouvé % fois : la fonction déployée a changé.', n; end if;
  execute replace(d, ancien, nouveau);
  def1 := md5(pg_get_functiondef('public.offline_sync_batch(jsonb)'::regprocedure));

  -- Effet du correctif GPS (saisie hors ligne simulée par le Unit Head)
  select rt_id into rt from public.producteurs where village_id = vid and rt_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub',uh,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  for r in select * from (values ('avec_precision','6.5'), ('sans_precision','')) v(cas, acc) loop
    select public.offline_sync_batch(jsonb_build_array(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'idempotency_key', gen_random_uuid(), 'operation_type','FARMER_ENROLL',
      'campaign_id', camp, 'device_id', gen_random_uuid(), 'created_at_client', now(),
      'payload', jsonb_build_object('local_id','local-farmer-qa-'||r.cas,
        'row', jsonb_build_object('nom','QA RESTAURATION','prenoms','TEST '||r.cas||' '||substr(md5(random()::text),1,4),'sexe','M','birth_year',1980,
               'telephone','07'||lpad((floor(random()*1e8))::bigint::text,8,'0'),'village_id',vid,'rt_id',rt,'data',jsonb_build_object('source','QA_RESTAURATION')),
        'plot', jsonb_build_object('local_name','QA','declared_area','1.2','latitude','7.6','longitude','-5.0','gps_accuracy_m',r.acc,'gps_captured_at',now()))
    ))) into res;
    select fp.gps_status, fp.gps_accuracy_m into q from public.farmer_plots fp where fp.producteur_id = res->'results'->0->>'server_id';
    log := log || format('GPS appliqué %s : %s / %s ; ', r.cas, q.gps_status, coalesce(q.gps_accuracy_m::text,'NULL'));
  end loop;
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','',true);

  -- c) Retour arrière documenté (section R des deux fichiers)
  execute 'alter policy farmer_consents_insert on public.farmer_consents with check (peut_editer_terrain() and created_by = auth.uid() and agent_id = auth.uid() and private.farmer_registry_can_access_producteur(producteur_id))';
  execute 'drop trigger if exists trg_farmer_verification_separation on public.farmer_verifications';
  execute 'drop function if exists private.farmer_verification_separation_guard()';
  d := pg_get_functiondef('public.offline_sync_batch(jsonb)'::regprocedure);
  n := (length(d) - length(replace(d, nouveau, ''))) / length(nouveau);
  if n <> 1 then raise exception 'Retour arrière GPS : bloc trouvé % fois.', n; end if;
  execute replace(d, nouveau, ancien);

  -- d) Comparaison à la photographie
  select with_check into pol2 from pg_policies where schemaname='public' and tablename='farmer_consents' and policyname='farmer_consents_insert';
  select count(*) into trg2 from pg_trigger where tgname='trg_farmer_verification_separation';
  select count(*) into fn2 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='private' and p.proname='farmer_verification_separation_guard';
  def2 := md5(pg_get_functiondef('public.offline_sync_batch(jsonb)'::regprocedure));
  log := log || format('RESTAURATION : politique identique=%s, trigger restant=%s, fonction garde restante=%s, offline_sync_batch identique=%s (modifiée pendant le test=%s)',
                       pol2 = pol0, trg2, fn2, def2 = def0, def1 <> def0);
  raise exception 'RESTAURATION (transaction annulée) : %', log;
end $t$;
