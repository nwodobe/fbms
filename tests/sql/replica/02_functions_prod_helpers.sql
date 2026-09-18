-- Replica locale : definitions EXACTES de production (pg_get_functiondef,
-- 18/09/2026). Verifiees par md5(prosrc) contre la production : voir
-- tests/sql/replica/prod_md5.txt et tests/sql/verifier_replica.sh.
CREATE OR REPLACE FUNCTION public.est_actif()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif = true)
$function$
;
CREATE OR REPLACE FUNCTION public.rcn_proc_active_role(allowed text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select exists(select 1 from public.profils p where p.user_id=(select auth.uid()) and p.actif is true and p.role=any(allowed))
$function$
;
CREATE OR REPLACE FUNCTION public.fbms_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from profils where user_id = auth.uid() and actif = true;
$function$
;
CREATE OR REPLACE FUNCTION public.mon_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.profils where user_id = auth.uid() and actif = true limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.peut_editer_config()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
$function$
;
CREATE OR REPLACE FUNCTION public.sacherie_mon_contexte()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select jsonb_build_object('role',p.role,'fonction_operationnelle',p.fonction_operationnelle,'cluster',p.cluster,'zone',p.zone,'actif',p.actif) from public.profils p where p.user_id=auth.uid() and p.actif=true limit 1),'{}'::jsonb) $function$
;
CREATE OR REPLACE FUNCTION public.est_bm()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.profils
                 where user_id = auth.uid() and actif = true and role = 'Branch Manager')
$function$
;
CREATE OR REPLACE FUNCTION public.peut_demander_sacherie()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.est_bm() or exists(select 1 from public.profils p where p.user_id=auth.uid() and p.actif=true and p.fonction_operationnelle in ('Unit Head','Assistant Unit Head')) $function$
;
CREATE OR REPLACE FUNCTION public.peut_executer_sacherie(p_cluster text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.est_bm() or exists(select 1 from public.profils p where p.user_id=auth.uid() and p.actif=true and p.fonction_operationnelle in ('Warehouse Keeper','Assistant Unit Head') and upper(coalesce(p.cluster,''))=upper(coalesce(p_cluster,''))) $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_peut_lire_demande(p_cluster text, p_zone text, p_requested_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.est_bm() or p_requested_by=auth.uid() or exists(select 1 from public.profils p where p.user_id=auth.uid() and p.actif=true and (p.fonction_operationnelle='Logistics Coordinator' or (p.fonction_operationnelle in ('Unit Head','Assistant Unit Head','Warehouse Keeper') and upper(coalesce(p.cluster,''))=upper(coalesce(p_cluster,''))) or (p.fonction_operationnelle='Zonal Head' and upper(coalesce(p.zone,''))=upper(coalesce(p_zone,''))))) $function$
;
CREATE OR REPLACE FUNCTION private.farmer_registry_authority()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select coalesce(
    p.authority_level,
    case p.role
      when 'Branch Manager' then 'GLOBAL'
      when 'Branch Manager / Head of Programme' then 'GLOBAL'
      when 'Assistant Branch Manager' then 'GLOBAL'
      when 'Head of Field' then 'GLOBAL'
      when 'Procurement Officer' then 'GLOBAL'
      when 'Zonal Head' then 'ZONE'
      when 'Unit Head' then 'CLUSTER'
      when 'Assistant Unit Head' then 'CLUSTER'
      when 'Supervisor' then 'CLUSTER'
      when 'Warehouse Keeper' then 'CLUSTER'
      when 'RT / Field Partner' then 'VILLAGE'
      when 'Agent Recenseur' then 'VILLAGE'
      when 'Logistics Coordinator' then 'TRANSVERSE'
      when 'Finance / Controller' then 'TRANSVERSE'
      when 'Read Only / Audit' then 'TRANSVERSE'
      when 'Consultation uniquement' then 'TRANSVERSE'
      else 'TRANSVERSE'
    end
  )
  from public.profils p
  where p.user_id = auth.uid() and p.actif = true
  limit 1
$function$
;
CREATE OR REPLACE FUNCTION private.ops_has_role(allowed text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.profils p
    where p.user_id = (select auth.uid())
      and p.actif = true
      and (p.role = any(allowed) or coalesce(p.fonction_operationnelle,'') = any(allowed))
  );
$function$
;
create or replace function public.portee_terrain_globale()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mon_role() in ('Zonal Head')
$$;
CREATE OR REPLACE FUNCTION public.fb_entity_key(p_id text, p_nom text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select nullif(coalesce(nullif(p_id,''), lower(regexp_replace(coalesce(p_nom,''), '\s+', '', 'g'))), '')
$function$
;
CREATE OR REPLACE FUNCTION public.sacherie_code_cluster(p_cluster text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select coalesce(nullif(upper(left(regexp_replace(coalesce(p_cluster,''),'[^A-Za-z0-9]','','g'),3)),''),'GEN') $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_slug(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select trim(both '-' from regexp_replace(upper(coalesce(p_value,'')), '[^A-Z0-9]+', '-', 'g'))
$function$
;
