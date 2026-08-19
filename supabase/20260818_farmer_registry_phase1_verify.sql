-- Read-only verification after AFLP Farmer Registry Phase 1 deployment.
select jsonb_build_object(
 'zones',(select count(*) from public.aflp_zones),
 'clusters',(select count(*) from public.aflp_clusters),
 'producer_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='producteurs'
   and column_name in('prenoms','birth_year','age_band','telephone_alt','preferred_language','operational_status','passport_stage','passport_completion','risk_profile','consent_status','record_version')),
 'consent_table',to_regclass('public.farmer_consents'),
 'identity_table',to_regclass('public.farmer_identity_documents'),
 'audit_table',to_regclass('public.farmer_change_log'),
 'summary_view',to_regclass('public.farmer_passport_summary_v'),
 'active_code_triggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
   where c.relname='producteurs' and not t.tgisinternal and (t.tgname ilike '%code%' or p.proname ilike '%code%')),
 'identity_numbers_in_master',(select count(*) from public.producteurs where id_document_number is not null or data?'pieceNum'),
 'sensitive_audit_rows',(select count(*) from public.farmer_change_log where before_data?'id_document_number' or after_data?'id_document_number'
   or coalesce(before_data->'data','{}'::jsonb)?'pieceNum' or coalesce(after_data->'data','{}'::jsonb)?'pieceNum'
   or before_data?'document_number' or after_data?'document_number')
) as farmer_registry_phase1_verification;
