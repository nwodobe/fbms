-- Test D-3 · précision GPS transmise par offline_sync_batch (FARMER_ENROLL avec parcelle).
-- Usage (psql), tout est annulé :
--   begin;
--   savepoint avant;  \i tests/sql/regularisation_aflp/04_offline_sync_precision_gps.sql   rollback to avant;
--   \i supabase/PREPARE_20261025_offline_sync_precision_gps.sql
--   savepoint apres;  \i tests/sql/regularisation_aflp/04_offline_sync_precision_gps.sql   rollback to apres;
--   rollback;   -- annule aussi le correctif
-- Observé le 25/10/2026 :
--   AVANT avec précision : POINT_CAPTURED, précision NULL (précision perdue)
--   AVANT sans précision : POINT_CAPTURED, précision NULL (point sans qualité)
--   APRÈS avec précision : POINT_CAPTURED, précision 6.50
--   APRÈS sans précision : NOT_MAPPED, coordonnées en note, aucun point GPS
-- Le bloc se termine par une erreur volontaire qui affiche le résultat et annule ses écritures.
do $t$
declare
  uh uuid := '<UUID_UNIT_HEAD>'; vid text := '<VILLAGE_DU_UNIT_HEAD>'; camp uuid := '<UUID_CAMPAGNE_COURANTE>';
  rt text; res jsonb; log text := ''; r record; q record; dev uuid := gen_random_uuid();
begin
  select rt_id into rt from public.producteurs where village_id = vid and rt_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub',uh,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  for r in select * from (values ('avec_precision','6.5'), ('sans_precision','')) v(cas, acc) loop
    select public.offline_sync_batch(jsonb_build_array(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'idempotency_key', gen_random_uuid(), 'operation_type','FARMER_ENROLL',
      'campaign_id', camp, 'device_id', dev, 'created_at_client', now(),
      'payload', jsonb_build_object('local_id','local-farmer-qa-'||r.cas,
        'row', jsonb_build_object('nom','QA GPS','prenoms','TEST '||r.cas||' '||substr(md5(random()::text),1,4),'sexe','M','birth_year',1980,
               'telephone','07'||lpad((floor(random()*1e8))::bigint::text,8,'0'),'village_id',vid,'rt_id',rt,'data',jsonb_build_object('source','QA_GPS')),
        'plot', jsonb_build_object('local_name','QA','declared_area','1.2','latitude','7.6','longitude','-5.0','gps_accuracy_m',r.acc,'gps_captured_at',now()))
    ))) into res;
    select fp.gps_status, fp.gps_accuracy_m, fp.latitude is not null as coord, fp.notes is not null as note into q
      from public.farmer_plots fp where fp.producteur_id = res->'results'->0->>'server_id';
    log := log || format('%s : sync=%s statut=%s précision=%s coordonnées=%s note=%s ; ', r.cas, res->'results'->0->>'status',
      q.gps_status, coalesce(q.gps_accuracy_m::text,'NULL'), q.coord, q.note);
  end loop;
  perform set_config('role','postgres',true);
  raise exception 'D-3 : %', log;
end $t$;
