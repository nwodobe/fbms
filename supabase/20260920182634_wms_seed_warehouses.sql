insert into public.wms_warehouses(site_code, code, name, location, status, is_factory)
select
  case when l.warehouse_code like 'BKE-%' then 'BKE'
       when l.warehouse_code like 'YAK%' then 'YAK'
       else upper(replace(replace(l.warehouse_code,'WH-',''),'''','')) end as site_code,
  l.warehouse_code,
  regexp_replace(l.nom, '\s*·\s*Sacherie$', ''),
  coalesce(nullif(l.site_code,''), l.warehouse_code),
  'ACTIVE',
  l.scope_type = 'FACTORY_WAREHOUSE'
from public.rcn_jute_locations l
where l.scope_type in ('EXTERNAL_WAREHOUSE','FACTORY_WAREHOUSE') and l.actif
  and not exists (select 1 from public.wms_warehouses w where w.code = l.warehouse_code);
