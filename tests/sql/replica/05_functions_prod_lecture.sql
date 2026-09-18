-- Replica locale : fonctions de LECTURE Sacherie exactes de production (18/09/2026).
CREATE OR REPLACE FUNCTION public.sacherie_ct_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_role text; v_op text; v_cluster text; v_is_bm boolean:=false; v_global jsonb; v_clusters jsonb; v_rts jsonb; v_moves jsonb; v_alerts jsonb; v_requests jsonb; v_inv jsonb;
begin
 if v_uid is null then raise exception 'Connexion requise'; end if;
 select role,fonction_operationnelle,cluster into v_role,v_op,v_cluster from public.profils where user_id=v_uid and actif=true limit 1; if not found then raise exception 'Profil actif requis'; end if;
 v_is_bm:=v_role='Branch Manager'; if not v_is_bm and coalesce(v_op,'') not in ('Zonal Head','Unit Head','Assistant Unit Head','Warehouse Keeper','Logistics Coordinator') then raise exception 'Accès Control Tower non autorisé'; end if;
 select to_jsonb(g) into v_global from public.sacherie_ct_global_stock g; if v_global is null then v_global:=jsonb_build_object('total',0,'vides',0,'pleins',0,'transit',0,'dechires',0,'a_reparer',0,'repares',0,'rebut',0); end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.cluster),'[]'::jsonb) into v_clusters from (
  select c.*,i.physical_stock,i.theoretical_inventory,i.inventory_gap,i.last_inventory,case when coalesce(i.inventory_gap,0)<>0 then 'CRITIQUE' when c.stock_cluster_vide<20 then 'ATTENTION' else 'NORMAL' end status
  from public.sacherie_ct_cluster_stock c left join (
   select l.cluster,sum(i.counted_qty)::integer physical_stock,sum(i.theoretical_qty)::integer theoretical_inventory,sum(i.difference_qty)::integer inventory_gap,max(i.counted_at) last_inventory
   from public.sacherie_ct_latest_inventory i join public.rcn_jute_locations l on l.code=i.location_code where l.scope_type='CLUSTER' group by l.cluster
  ) i using(cluster) where v_is_bm or v_cluster is null or upper(c.cluster)=upper(v_cluster)
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.cluster,x.rt_nom),'[]'::jsonb) into v_rts from (
  select r.*,coalesce((select sum(a.volume_finance_kg) from public.avances a where a.rt_id=r.rt_id and a.cycle_statut='OPEN'),0) volume_finance_kg_open,
  coalesce((select sum(a.volume_finance_kg) from public.avances a where a.rt_id=r.rt_id and a.cycle_statut='OPEN'),0) volume_finance_restant_estime_kg,
  case when r.dechires>0 or r.rebut>0 then 'ATTENTION' when r.total_sous_responsabilite<0 then 'CRITIQUE' else 'NORMAL' end risk_level
  from public.sacherie_ct_rt_stock r where v_is_bm or v_cluster is null or upper(r.cluster)=upper(v_cluster)
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.movement_at desc),'[]'::jsonb) into v_moves from (
  select m.id,m.event_key,m.movement_type,m.qty,m.from_location,m.to_location,m.from_state,m.to_state,m.cluster,m.rt_id,m.producteur_id,m.reference,m.note,m.proof_url,m.movement_at,m.source_type,m.source_id
  from public.rcn_jute_movements m where m.ledger='INTERNE' and (v_is_bm or v_cluster is null or upper(coalesce(m.cluster,''))=upper(v_cluster)) order by m.movement_at desc limit 100
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]'::jsonb) into v_requests from (
  select id,request_code,cluster,rt_id,rt_nom,cycle_id,requested_qty,approved_qty,status,requested_at,approved_at,expires_at,closed_at from public.bag_movement_requests where v_is_bm or v_cluster is null or upper(cluster)=upper(v_cluster) order by requested_at desc limit 100
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.counted_at desc),'[]'::jsonb) into v_inv from (
  select i.*,l.cluster,l.scope_type,l.rt_id from public.sacherie_ct_latest_inventory i join public.rcn_jute_locations l on l.code=i.location_code where v_is_bm or v_cluster is null or upper(coalesce(l.cluster,''))=upper(v_cluster) order by i.counted_at desc limit 100
 ) x;
 with a as (
  select 'DECHIRES'::text code,'ATTENTION'::text severity,c.cluster,c.dechires::numeric value,c.dechires||' sac(s) déchiré(s) à traiter' message from public.sacherie_ct_cluster_stock c where c.dechires>0 and (v_is_bm or v_cluster is null or upper(c.cluster)=upper(v_cluster))
  union all select 'INVENTORY_GAP','CRITIQUE',l.cluster,abs(i.difference_qty),'Écart inventaire de '||i.difference_qty||' sac(s)' from public.sacherie_ct_latest_inventory i join public.rcn_jute_locations l on l.code=i.location_code where i.difference_qty<>0 and (v_is_bm or v_cluster is null or upper(coalesce(l.cluster,''))=upper(v_cluster))
  union all select 'APPROVAL_EXPIRED','ATTENTION',r.cluster,coalesce(r.approved_qty,r.requested_qty),'Approval expiré non clôturé : '||r.request_code from public.bag_movement_requests r where r.status='APPROVED' and r.expires_at<now() and r.closed_at is null and (v_is_bm or v_cluster is null or upper(r.cluster)=upper(v_cluster))
  union all select 'NEGATIVE_STOCK','CRITIQUE',l.cluster,abs(s.qty),'Stock théorique négatif : '||l.nom||' / '||s.state from public.rcn_jute_v_stock s join public.rcn_jute_locations l on l.code=s.location_code where s.qty<0 and (v_is_bm or v_cluster is null or upper(coalesce(l.cluster,''))=upper(v_cluster))
 ) select coalesce(jsonb_agg(to_jsonb(a) order by case severity when 'CRITIQUE' then 1 else 2 end,cluster),'[]'::jsonb) into v_alerts from a;
 return jsonb_build_object('generated_at',now(),'scope',jsonb_build_object('role',v_role,'fonction_operationnelle',v_op,'cluster',v_cluster,'global',v_is_bm),'global',v_global,'clusters',v_clusters,'rts',v_rts,'movements',v_moves,'requests',v_requests,'inventories',v_inv,'alerts',v_alerts);
end $function$
;
create or replace function private.sacherie_ct_perimetre()
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce(
    (select jsonb_build_object(
       'bm',       p.role = 'Branch Manager',
       'autorise', p.role = 'Branch Manager'
                   or coalesce(p.fonction_operationnelle,'') in
                      ('Zonal Head','Unit Head','Assistant Unit Head','Warehouse Keeper','Logistics Coordinator'),
       'cluster',  p.cluster)
     from public.profils p
     where p.user_id = (select auth.uid()) and p.actif = true
     limit 1),
    jsonb_build_object('bm', false, 'autorise', false, 'cluster', null));
$fn$;
