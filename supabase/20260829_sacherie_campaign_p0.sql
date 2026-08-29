-- Sacherie AFLP P0 - campagne longue
-- Non destructif : étend le moteur ops_bag_* et réutilise rcn_jute_*.

alter table public.ops_bag_releases
  add column if not exists received_qty integer not null default 0,
  add column if not exists receipt_status text not null default 'PENDING',
  add column if not exists receipt_note text,
  add column if not exists receipt_proof_url text;

alter table public.ops_bag_releases
  drop constraint if exists ops_bag_releases_received_qty_check;
alter table public.ops_bag_releases
  add constraint ops_bag_releases_received_qty_check check (received_qty >= 0 and received_qty <= qty);

alter table public.ops_bag_releases
  drop constraint if exists ops_bag_releases_receipt_status_check;
alter table public.ops_bag_releases
  add constraint ops_bag_releases_receipt_status_check check (receipt_status in ('PENDING','CONFIRMED','DISCREPANCY'));

create or replace function public.sacherie_ops_campaign_readiness()
returns jsonb
language plpgsql
stable security definer
set search_path='public','pg_temp'
as $$
declare
  v_uid uuid:=auth.uid();
  v_clusters integer:=0; v_cluster_locs integer:=0; v_rt integer:=0; v_rt_locs integer:=0;
  v_env integer:=0; v_alloc integer:=0; v_roles integer:=0; v_factory integer:=0;
  v_missing_clusters jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if not exists(select 1 from public.profils where user_id=v_uid and actif=true) then raise exception 'Profil actif requis'; end if;

  select count(*) into v_clusters from public.aflp_clusters where active is not false;
  select count(*) into v_cluster_locs from public.rcn_jute_locations where actif=true and scope_type='CLUSTER';
  select count(*) into v_rt from public.rt where coalesce(deleted,false)=false;
  select count(*) into v_rt_locs from public.rcn_jute_locations where actif=true and scope_type='RT';
  select count(*) into v_env from public.aflp_bag_envelopes where campaign='2027' and status in ('GM_APPROVED','ACTIVE','OPEN');
  select count(*) into v_alloc from public.aflp_bag_cluster_allocations a join public.aflp_bag_envelopes e on e.id=a.envelope_id where e.campaign='2027';
  select count(*) into v_roles from public.profils where actif=true and coalesce(fonction_operationnelle,'') in ('Zonal Head','Unit Head','Assistant Unit Head','Warehouse Keeper','Logistics Coordinator');
  select count(*) into v_factory from public.rcn_jute_locations where actif=true and scope_type in ('FACTORY','FACTORY_WAREHOUSE');

  select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'label',c.label)),'[]'::jsonb)
    into v_missing_clusters
  from public.aflp_clusters c
  where c.active is not false
    and not exists(
      select 1 from public.rcn_jute_locations l
      where l.actif=true and l.scope_type='CLUSTER'
        and upper(coalesce(l.cluster,'')) in (upper(c.code),upper(c.label))
    );

  return jsonb_build_object(
    'campaign','2027',
    'generated_at',now(),
    'ready', (v_env>0 and v_alloc>=v_clusters and jsonb_array_length(v_missing_clusters)=0 and v_roles>0 and v_factory>0),
    'checks',jsonb_build_object(
      'active_clusters',v_clusters,
      'cluster_locations',v_cluster_locs,
      'missing_cluster_locations',v_missing_clusters,
      'active_rt',v_rt,
      'rt_locations',v_rt_locs,
      'campaign_envelopes',v_env,
      'cluster_allocations',v_alloc,
      'operational_role_profiles',v_roles,
      'factory_locations',v_factory
    )
  );
end $$;

create or replace function public.sacherie_ops_create_request(
  p_client_request_id text,
  p_rt_id text,
  p_cycle_id text,
  p_stock_rcn_kg numeric,
  p_requested_qty integer
)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_uid uuid:=auth.uid(); v_existing public.ops_bag_requests%rowtype; v_rt public.rt%rowtype;
  v_calc jsonb; v_source text; v_dest text; v_code text; v_req public.ops_bag_requests%rowtype;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if not public.peut_demander_sacherie() then raise exception 'Droit insuffisant pour créer une demande Sacherie'; end if;
  if coalesce(btrim(p_client_request_id),'')='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_requested_qty is null or p_requested_qty<=0 then raise exception 'Quantité invalide'; end if;

  select * into v_existing from public.ops_bag_requests where client_request_id=p_client_request_id limit 1;
  if found then return to_jsonb(v_existing); end if;

  select * into v_rt from public.rt where id=p_rt_id and coalesce(deleted,false)=false limit 1;
  if not found then raise exception 'RT introuvable'; end if;
  if coalesce(btrim(v_rt.cluster),'')='' then raise exception 'RT sans cluster'; end if;

  v_calc:=public.sacherie_calculer_plafond(p_rt_id,p_cycle_id,p_stock_rcn_kg);
  if p_requested_qty>(v_calc->>'max_new_available')::integer then raise exception 'Quantité demandée supérieure au plafond disponible'; end if;

  select code into v_source from public.rcn_jute_locations
   where actif=true and scope_type='CLUSTER' and upper(coalesce(cluster,''))=upper(v_rt.cluster)
   order by created_at nulls last limit 1;
  if v_source is null then raise exception 'Location Sacherie du cluster absente : initialisation requise'; end if;

  v_dest:=public.sacherie_ct_location('RT',v_rt.cluster,v_rt.id,v_rt.nom,null,null);
  v_code:='AFLP-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_rt.cluster)||'-'||lpad(nextval('public.ops_bag_request_seq')::text,6,'0');

  insert into public.ops_bag_requests(
    client_request_id,request_code,channel,campaign,cluster,rt_id,
    source_location_code,destination_location_code,requested_qty,notes,metadata
  ) values (
    p_client_request_id,v_code,'AFLP','2027',v_rt.cluster,v_rt.id,
    v_source,v_dest,p_requested_qty,'Demande contrôlée FIELD BUYING',
    jsonb_build_object(
      'workflow','SACHERIE_CAMPAIGN_P0','cycle_id',p_cycle_id,
      'stock_rcn_kg_verified',p_stock_rcn_kg,'control_snapshot',v_calc
    )
  ) returning * into v_req;
  return to_jsonb(v_req);
exception when unique_violation then
  select * into v_existing from public.ops_bag_requests where client_request_id=p_client_request_id limit 1;
  if found then return to_jsonb(v_existing); end if;
  raise;
end $$;

create or replace function public.sacherie_ops_decide_request(
  p_request_id uuid,
  p_action text,
  p_approved_qty integer default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_uid uuid:=auth.uid(); v_req public.ops_bag_requests%rowtype; v_calc jsonb;
  v_cycle text; v_stock numeric; v_qty integer; v_action text:=upper(coalesce(p_action,''));
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if not public.est_bm() then raise exception 'Décision réservée au Branch Manager'; end if;

  select * into v_req from public.ops_bag_requests where id=p_request_id and channel='AFLP' for update;
  if not found then raise exception 'Demande AFLP introuvable'; end if;
  if v_req.requested_by=v_uid and v_action='APPROVE' then raise exception 'Séparation des tâches : l initiateur ne peut pas approuver sa demande'; end if;

  if v_action='REJECT' then
    if coalesce(btrim(p_comment),'')='' then raise exception 'Motif de rejet obligatoire'; end if;
    update public.ops_bag_requests set status='REJECTED',closed_at=now(),closed_reason=p_comment,
      metadata=metadata||jsonb_build_object('decision','REJECT','decision_comment',p_comment,'decision_at',now())
      where id=p_request_id returning * into v_req;
    return to_jsonb(v_req);
  end if;

  if v_action<>'APPROVE' then raise exception 'Action supportée : APPROVE ou REJECT'; end if;
  if v_req.status not in ('REQUESTED','REVIEWED','CONSOLIDATED') then raise exception 'Demande non approuvable dans son statut actuel'; end if;

  v_cycle:=v_req.metadata->>'cycle_id';
  v_stock:=nullif(v_req.metadata->>'stock_rcn_kg_verified','')::numeric;
  if v_cycle is null or v_stock is null then raise exception 'Contrôle cycle/stock absent de la demande'; end if;
  v_calc:=public.sacherie_calculer_plafond(v_req.rt_id,v_cycle,v_stock);
  v_qty:=coalesce(p_approved_qty,v_req.requested_qty);
  if v_qty<=0 or v_qty>v_req.requested_qty or v_qty>(v_calc->>'max_new_available')::integer then
    raise exception 'Quantité approuvée invalide ou supérieure au plafond recalculé';
  end if;

  if v_req.status='REQUESTED' then
    update public.ops_bag_requests set status='REVIEWED' where id=p_request_id returning * into v_req;
  end if;
  if v_req.status='REVIEWED' then
    update public.ops_bag_requests set status='CONSOLIDATED' where id=p_request_id returning * into v_req;
  end if;
  update public.ops_bag_requests set status='BM_APPROVED',approved_qty=v_qty,expires_at=now()+interval '24 hours',
    metadata=metadata||jsonb_build_object('decision','APPROVE','decision_comment',coalesce(p_comment,''),'decision_at',now(),'approval_control_snapshot',v_calc)
    where id=p_request_id returning * into v_req;
  return to_jsonb(v_req);
end $$;

create or replace function public.sacherie_ops_receive_release(
  p_release_id uuid,
  p_received_qty integer,
  p_note text default null,
  p_proof_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_uid uuid:=auth.uid(); v_rel public.ops_bag_releases%rowtype; v_req public.ops_bag_requests%rowtype;
  v_total integer; v_status text;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if not private.ops_has_role(array['Branch Manager','Warehouse Manager','Storekeeper','Procurement Officer','Warehouse Keeper','Assistant Unit Head','Unit Head']) then
    raise exception 'Droit insuffisant pour confirmer une réception';
  end if;
  if p_received_qty is null or p_received_qty<0 then raise exception 'Quantité reçue invalide'; end if;

  select * into v_rel from public.ops_bag_releases where id=p_release_id for update;
  if not found then raise exception 'Sortie introuvable'; end if;
  if p_received_qty>v_rel.qty then raise exception 'Réception supérieure à la quantité sortie'; end if;
  if v_rel.received_at is not null then
    if v_rel.received_qty=p_received_qty then return to_jsonb(v_rel); end if;
    raise exception 'Cette sortie a déjà été réceptionnée avec une autre quantité';
  end if;

  v_status:=case when p_received_qty=v_rel.qty then 'CONFIRMED' else 'DISCREPANCY' end;
  update public.ops_bag_releases
     set received_qty=p_received_qty,receipt_status=v_status,receipt_note=p_note,receipt_proof_url=p_proof_url,
         received_by=v_uid,received_at=now()
   where id=p_release_id returning * into v_rel;

  select coalesce(sum(received_qty),0)::integer into v_total from public.ops_bag_releases where request_id=v_rel.request_id;
  update public.ops_bag_requests set received_qty=v_total,
    metadata=metadata||case when v_status='DISCREPANCY'
      then jsonb_build_object('receipt_discrepancy',true,'last_receipt_gap',v_rel.qty-p_received_qty,'last_receipt_release_id',v_rel.id,'last_receipt_at',now())
      else '{}'::jsonb end,
    updated_at=now()
   where id=v_rel.request_id returning * into v_req;

  return jsonb_build_object('release',to_jsonb(v_rel),'request',to_jsonb(v_req),'gap',v_rel.qty-p_received_qty);
end $$;

grant execute on function public.sacherie_ops_campaign_readiness() to authenticated;
grant execute on function public.sacherie_ops_create_request(text,text,text,numeric,integer) to authenticated;
grant execute on function public.sacherie_ops_decide_request(uuid,text,integer,text) to authenticated;
grant execute on function public.sacherie_ops_receive_release(uuid,integer,text,text) to authenticated;
