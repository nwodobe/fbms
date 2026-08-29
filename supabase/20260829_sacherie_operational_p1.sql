-- Sacherie AFLP P1 : operations terrain longues campagnes
-- Registre canonique conserve : rcn_jute_locations + rcn_jute_movements.
-- Aucune table de stock parallele.

create or replace function public.sacherie_ops_resolve_cluster_location(p_cluster text)
returns text
language plpgsql
stable security definer
set search_path='public','pg_temp'
as $$
declare v_code text; v_norm text:=upper(regexp_replace(coalesce(p_cluster,''),'[^A-Z0-9]','','g'));
begin
  select l.code into v_code
  from public.rcn_jute_locations l
  where l.actif=true and l.scope_type='CLUSTER'
    and (
      upper(regexp_replace(coalesce(l.cluster,''),'[^A-Z0-9]','','g'))=v_norm
      or (v_norm='DJEBONOUA' and upper(regexp_replace(coalesce(l.cluster,''),'[^A-Z0-9]','','g'))='NDJEBONOUA')
    )
  order by l.created_at asc
  limit 1;
  return v_code;
end $$;

create or replace function public.sacherie_ops_ensure_locations()
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare c record; v_code text; v_created integer:=0; v_existing integer:=0;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not public.est_bm() then raise exception 'Initialisation Sacherie reservee au Branch Manager'; end if;

  insert into public.rcn_jute_locations(code,site_code,warehouse_code,nom,type,actif,scope_type)
  values('JUTE-TRANSIT','GLOBAL','TRANSIT','Sacherie en transit','TRANSIT',true,'TRANSIT')
  on conflict(code) do update set actif=true,scope_type='TRANSIT',nom='Sacherie en transit';

  for c in select code,label from public.aflp_clusters where active is not false order by code loop
    v_code:=public.sacherie_ops_resolve_cluster_location(c.code);
    if v_code is null then
      v_code:='AFLP-CL-'||upper(regexp_replace(c.code,'[^A-Z0-9]+','-','g'));
      insert into public.rcn_jute_locations(code,site_code,warehouse_code,nom,type,actif,scope_type,cluster)
      values(v_code,c.code,'CLUSTER','Cluster '||c.label,'STOCK',true,'CLUSTER',c.code)
      on conflict(code) do update set actif=true,scope_type='CLUSTER',cluster=excluded.cluster,nom=excluded.nom;
      v_created:=v_created+1;
    else
      v_existing:=v_existing+1;
    end if;
  end loop;

  return jsonb_build_object('created',v_created,'existing',v_existing,'transit_location','JUTE-TRANSIT');
end $$;

create or replace function public.sacherie_ops_network_move(
  p_client_operation_id text,
  p_flow text,
  p_cluster text,
  p_rt_id text,
  p_producteur_id text,
  p_qty integer,
  p_receiver_name text default null,
  p_note text default null,
  p_proof_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_uid uuid:=auth.uid(); v_flow text:=upper(coalesce(p_flow,''));
  v_rt public.rt%rowtype; v_prod public.producteurs%rowtype;
  v_from text; v_to text; v_from_state text:='UTILISABLE'; v_to_state text:='UTILISABLE';
  v_mid text; v_event text; v_available integer:=0; v_existing public.rcn_jute_movements%rowtype;
  v_cluster_loc text; v_rt_loc text; v_prod_loc text; v_hub_loc text;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if coalesce(btrim(p_client_operation_id),'')='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantite invalide'; end if;

  v_event:='SACH-P1:'||btrim(p_client_operation_id);
  select * into v_existing from public.rcn_jute_movements where event_key=v_event limit 1;
  if found then return to_jsonb(v_existing); end if;

  select * into v_rt from public.rt where id=p_rt_id and coalesce(deleted,false)=false limit 1;
  if not found then raise exception 'RT introuvable'; end if;
  if upper(regexp_replace(coalesce(v_rt.cluster,''),'[^A-Z0-9]','','g')) <> upper(regexp_replace(coalesce(p_cluster,''),'[^A-Z0-9]','','g'))
     and not (upper(regexp_replace(coalesce(p_cluster,''),'[^A-Z0-9]','','g'))='DJEBONOUA' and upper(regexp_replace(coalesce(v_rt.cluster,''),'[^A-Z0-9]','','g'))='NDJEBONOUA')
  then raise exception 'RT hors du cluster selectionne'; end if;

  v_cluster_loc:=public.sacherie_ops_resolve_cluster_location(p_cluster);
  if v_cluster_loc is null then raise exception 'Location cluster absente : lancer l initialisation Sacherie'; end if;
  v_rt_loc:=public.sacherie_ct_location('RT',v_rt.cluster,v_rt.id,v_rt.nom,null,null);

  if v_flow in ('RT_TO_PRODUCTEUR','PRODUCTEUR_TO_RT','PRODUCTEUR_TO_HUB_FULL') then
    if coalesce(p_producteur_id,'')='' then raise exception 'Producteur obligatoire'; end if;
    select * into v_prod from public.producteurs where id=p_producteur_id and coalesce(deleted,false)=false limit 1;
    if not found then raise exception 'Producteur introuvable'; end if;
    if v_prod.rt_id is not null and v_prod.rt_id<>p_rt_id then raise exception 'Producteur rattache a un autre RT'; end if;
    v_prod_loc:=public.sacherie_ct_location('PRODUCTEUR',v_rt.cluster,null,null,v_prod.id,coalesce(v_prod.nom,'Producteur'));
  end if;

  if v_flow='RT_TO_PRODUCTEUR' then
    v_from:=v_rt_loc; v_to:=v_prod_loc;
  elsif v_flow='PRODUCTEUR_TO_RT' then
    v_from:=v_prod_loc; v_to:=v_rt_loc;
  elsif v_flow='RT_TO_CLUSTER' then
    v_from:=v_rt_loc; v_to:=v_cluster_loc;
  elsif v_flow='PRODUCTEUR_TO_HUB_FULL' then
    v_hub_loc:=public.sacherie_ct_location('HUB',v_rt.cluster,null,null,null,null);
    v_from:=v_prod_loc; v_to:=v_hub_loc; v_to_state:='PLEIN';
  else
    raise exception 'Flux terrain non supporte';
  end if;

  perform public.sacherie_ct_assert_location_access(v_from,true);
  perform public.sacherie_ct_assert_location_access(v_to,true);

  select coalesce(qty,0)::integer into v_available
  from public.rcn_jute_v_stock where location_code=v_from and state=v_from_state;
  if v_available<p_qty then raise exception 'Stock insuffisant a l origine. Disponible: %',v_available; end if;

  v_mid:='JUT-P1-'||substr(md5(v_event),1,20);
  insert into public.rcn_jute_movements(
    id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,
    source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,campaign,cluster,rt_id,producteur_id
  ) values (
    v_mid,v_event,'TRANSFERT','INTERNE',p_qty,v_from,v_to,v_from_state,v_to_state,
    'SACHERIE_P1',p_client_operation_id,p_client_operation_id,
    trim(concat_ws(' | ',nullif(p_note,''),case when coalesce(p_receiver_name,'')<>'' then 'Receptionnaire: '||p_receiver_name end)),
    p_proof_url,now(),'ANAGROCI',v_uid,'2027',v_rt.cluster,v_rt.id,nullif(p_producteur_id,'')
  ) returning * into v_existing;
  return to_jsonb(v_existing);
exception when unique_violation then
  select * into v_existing from public.rcn_jute_movements where event_key=v_event limit 1;
  if found then return to_jsonb(v_existing); end if;
  raise;
end $$;

create or replace function public.sacherie_ops_create_transfer(
  p_client_operation_id text,
  p_from_location text,
  p_to_location text,
  p_state text,
  p_qty integer,
  p_vehicle text,
  p_driver text,
  p_document_ref text,
  p_proof_url text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_uid uuid:=auth.uid(); v_id text; v_event text; v_available integer:=0;
  v_existing public.rcn_jute_transfers%rowtype; v_from public.rcn_jute_locations%rowtype; v_to public.rcn_jute_locations%rowtype;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if coalesce(btrim(p_client_operation_id),'')='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantite invalide'; end if;
  if coalesce(btrim(p_document_ref),'')='' then raise exception 'Reference document obligatoire'; end if;

  v_id:='JTR-P1-'||substr(md5(p_client_operation_id),1,20);
  select * into v_existing from public.rcn_jute_transfers where id=v_id limit 1;
  if found then return to_jsonb(v_existing); end if;

  select * into v_from from public.rcn_jute_locations where code=p_from_location and actif=true;
  if not found then raise exception 'Origine inconnue'; end if;
  select * into v_to from public.rcn_jute_locations where code=p_to_location and actif=true;
  if not found then raise exception 'Destination inconnue'; end if;
  if p_from_location=p_to_location then raise exception 'Origine et destination identiques'; end if;

  perform public.sacherie_ct_assert_location_access(p_from_location,true);
  perform public.sacherie_ct_assert_location_access(p_to_location,true);

  select coalesce(qty,0)::integer into v_available from public.rcn_jute_v_stock where location_code=p_from_location and state=p_state;
  if v_available<p_qty then raise exception 'Stock insuffisant pour transfert. Disponible: %',v_available; end if;

  insert into public.rcn_jute_locations(code,site_code,warehouse_code,nom,type,actif,scope_type)
  values('JUTE-TRANSIT','GLOBAL','TRANSIT','Sacherie en transit','TRANSIT',true,'TRANSIT')
  on conflict(code) do update set actif=true;

  insert into public.rcn_jute_transfers(id,from_location,to_location,state,qty_sent,qty_received,vehicle,driver,document_ref,statut,sent_by,sent_at,proof_url)
  values(v_id,p_from_location,p_to_location,p_state,p_qty,0,nullif(p_vehicle,''),nullif(p_driver,''),p_document_ref,'EN_TRANSIT',v_uid,now(),p_proof_url)
  returning * into v_existing;

  v_event:='TRANSFER-SEND:'||v_id;
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,campaign,cluster)
  values('JUT-'||substr(md5(v_event),1,20),v_event,'TRANSFERT','INTERNE',p_qty,p_from_location,'JUTE-TRANSIT',p_state,'EN_TRANSIT','TRANSFERT',v_id,p_document_ref,p_note,p_proof_url,now(),'ANAGROCI',v_uid,'2027',coalesce(v_from.cluster,v_to.cluster));

  return to_jsonb(v_existing);
end $$;

create or replace function public.sacherie_ops_closure_readiness(p_scope text,p_code text default null)
returns jsonb
language plpgsql
stable security definer
set search_path='public','pg_temp'
as $$
declare
  v_scope text:=upper(coalesce(p_scope,'CAMPAIGN')); v_stock integer:=0; v_open_req integer:=0; v_open_transfers integer:=0;
  v_open_losses integer:=0; v_holds integer:=0; v_where_cluster text:=null;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if v_scope='CLUSTER' then v_where_cluster:=p_code; end if;

  select coalesce(sum(abs(s.qty)),0)::integer into v_stock
  from public.rcn_jute_v_stock s join public.rcn_jute_locations l on l.code=s.location_code
  where s.qty<>0 and s.location_code<>'JUTE-TRANSIT'
    and (v_where_cluster is null or upper(regexp_replace(coalesce(l.cluster,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(v_where_cluster,'[^A-Z0-9]','','g')));

  select count(*) into v_open_req from public.ops_bag_requests r
  where r.channel='AFLP' and r.status not in ('CLOSED','REJECTED','CANCELLED','EXPIRED','RECEIVED')
    and (v_where_cluster is null or upper(regexp_replace(coalesce(r.cluster,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(v_where_cluster,'[^A-Z0-9]','','g')));

  select count(*) into v_open_transfers from public.rcn_jute_transfers t
  join public.rcn_jute_locations l on l.code=t.from_location
  where t.statut not in ('CLOS','CANCELLED')
    and (v_where_cluster is null or upper(regexp_replace(coalesce(l.cluster,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(v_where_cluster,'[^A-Z0-9]','','g')));

  select count(*) into v_open_losses from public.rcn_jute_loss_requests x
  join public.rcn_jute_locations l on l.code=x.location_code
  where x.statut='SOUMIS'
    and (v_where_cluster is null or upper(regexp_replace(coalesce(l.cluster,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(v_where_cluster,'[^A-Z0-9]','','g')));

  select count(*) into v_holds from public.rcn_jute_inventories i
  join public.rcn_jute_locations l on l.code=i.location_code
  where i.reconciliation_status='HOLD'
    and (v_where_cluster is null or upper(regexp_replace(coalesce(l.cluster,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(v_where_cluster,'[^A-Z0-9]','','g')));

  return jsonb_build_object('scope',v_scope,'code',p_code,'ready',(v_stock=0 and v_open_req=0 and v_open_transfers=0 and v_open_losses=0 and v_holds=0),'stock_residual',v_stock,'open_requests',v_open_req,'open_transfers',v_open_transfers,'pending_losses',v_open_losses,'inventory_holds',v_holds);
end $$;

grant execute on function public.sacherie_ops_resolve_cluster_location(text) to authenticated;
grant execute on function public.sacherie_ops_ensure_locations() to authenticated;
grant execute on function public.sacherie_ops_network_move(text,text,text,text,text,integer,text,text,text) to authenticated;
grant execute on function public.sacherie_ops_create_transfer(text,text,text,integer,text,text,text,text,text) to authenticated;
grant execute on function public.sacherie_ops_closure_readiness(text,text) to authenticated;
