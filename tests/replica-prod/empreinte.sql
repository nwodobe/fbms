-- Empreinte du schéma SOP RT (fonctions, vues, colonnes, déclencheurs) pour comparer deux états.
select md5(string_agg(x, '|' order by x)) from (
 select 'F:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')='||md5(regexp_replace(p.prosrc,'\s+',' ','g')) x
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'rt_sop%'
 union all select 'V:'||c.relname||'='||md5(pg_get_viewdef(c.oid)) from pg_class c where c.relkind='v' and c.relname like 'rt_sop%'
 union all select 'C:'||c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod) from pg_attribute a join pg_class c on c.oid=a.attrelid
   where c.relname like 'rt_sop%' and c.relkind='r' and a.attnum>0 and not a.attisdropped
 union all select 'T:'||c.relname||'.'||t.tgname||'='||md5(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal
) s;
