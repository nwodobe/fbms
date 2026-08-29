-- Sacherie AFLP P0 hardening
-- À appliquer après 20260829_sacherie_campaign_p0.sql.

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
  v_env uuid; v_alloc integer:=0; v_cluster_key text;
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
  v_cluster_key:=upper(btrim(v_rt.cluster));

  select e.id into v_env
  from public.aflp_bag_envelopes e
  where e.campaign='2027' and e.status='GM_APPROVED'
  order by e.approved_at desc nulls last,e.created_at desc limit 1;
  if v_env is null then raise exception 'Enveloppe Sacherie 2027 approuvée par GM requise'; end if;

  select coalesce(sum(a.allocated_qty),0)::integer into v_alloc
  from public.aflp_bag_cluster_allocations a
  join public.aflp_clusters c on upper(c.code)=upper(a.cluster) or upper(c.label)=upper(a.cluster)
  where a.envelope_id=v_env and (upper(c.code)=v_cluster_key or upper(c.label)=v_cluster_key);
  if v_alloc<=0 then raise exception 'Allocation Sacherie du cluster absente'; end if;

  v_calc:=public.sacherie_calculer_plafond(p_rt_id,p_cycle_id,p_stock_rcn_kg);
  if p_requested_qty>(v_calc->>'max_new_available')::integer then raise exception 'Quantité demandée supérieure au plafond disponible'; end if;
  if p_requested_qty>(v_calc->>'cluster_stock')::integer then raise exception 'Quantité demandée supérieure au stock physique disponible du cluster'; end if;

  select code into v_source from public.rcn_jute_locations
   where actif=true and scope_type='CLUSTER' and upper(coalesce(cluster,''))=v_cluster_key
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
      'stock_rcn_kg_verified',p_stock_rcn_kg,'control_snapshot',v_calc,
      'envelope_id',v_env,'cluster_allocation_qty',v_alloc
    )
  ) returning * into v_req;
  return to_jsonb(v_req);
exception when unique_violation then
  select * into v_existing from public.ops_bag_requests where client_request_id=p_client_request_id limit 1;
  if found then return to_jsonb(v_existing); end if;
  raise;
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
  v_total integer; v_status text; v_pending integer; v_discrepancies integer;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if not private.ops_has_role(array['Branch Manager','Warehouse Manager','Storekeeper','Procurement Officer','Warehouse Keeper','Assistant Unit Head','Unit Head']) then
    raise exception 'Droit insuffisant pour confirmer une réception';
  end if;
  if p_received_qty is null or p_received_qty<0 then raise exception 'Quantité reçue invalide'; end if;

  select * into v_rel from public.ops_bag_releases where id=p_release_id for update;
  if not found then raise exception 'Sortie introuvable'; end if;
  if p_received_qty>v_rel.qty then raise exception 'Réception supérieure à la quantité sortie'; end if;
  if p_received_qty<>v_rel.qty and coalesce(btrim(p_note),'')='' then raise exception 'Motif obligatoire en cas d écart de réception'; end if;
  if v_rel.received_at is not null then
    if v_rel.received_qty=p_received_qty then return to_jsonb(v_rel); end if;
    raise exception 'Cette sortie a déjà été réceptionnée avec une autre quantité';
  end if;

  v_status:=case when p_received_qty=v_rel.qty then 'CONFIRMED' else 'DISCREPANCY' end;
  update public.ops_bag_releases
     set received_qty=p_received_qty,receipt_status=v_status,receipt_note=p_note,receipt_proof_url=p_proof_url,
         received_by=v_uid,received_at=now()
   where id=p_release_id returning * into v_rel;

  select coalesce(sum(received_qty),0)::integer,
         count(*) filter(where received_at is null),
         count(*) filter(where receipt_status='DISCREPANCY')
    into v_total,v_pending,v_discrepancies
  from public.ops_bag_releases where request_id=v_rel.request_id;

  select * into v_req from public.ops_bag_requests where id=v_rel.request_id for update;
  update public.ops_bag_requests
     set received_qty=v_total,
         status=case when v_discrepancies=0 and v_pending=0 and released_qty=approved_qty and v_total=released_qty then 'RECEIVED' else status end,
         metadata=metadata || jsonb_build_object(
           'receipt_discrepancy',v_discrepancies>0,
           'pending_receipts',v_pending,
           'last_receipt_gap',v_rel.qty-p_received_qty,
           'last_receipt_release_id',v_rel.id,
           'last_receipt_at',now()
         ),
         updated_at=now()
   where id=v_rel.request_id returning * into v_req;

  return jsonb_build_object('release',to_jsonb(v_rel),'request',to_jsonb(v_req),'gap',v_rel.qty-p_received_qty);
end $$;

grant execute on function public.sacherie_ops_create_request(text,text,text,numeric,integer) to authenticated;
grant execute on function public.sacherie_ops_receive_release(uuid,integer,text,text) to authenticated;
