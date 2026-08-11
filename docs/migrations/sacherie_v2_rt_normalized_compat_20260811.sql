-- FBMS / AFLP 2027 - Sacherie V2 compatibility RT normalized columns
-- A executer APRES sacherie_v2_mvp_20260811.sql.
--
-- Constat production : rt.cluster est la colonne normalisee de reference alors
-- que certaines anciennes lignes n'ont pas data->>'cluster'. La V2 doit donc
-- lire d'abord rt.cluster / rt.nom puis seulement utiliser JSON comme fallback.

begin;

create or replace function public.sacherie_calculer_plafond(
  p_rt_id text,
  p_cycle_id text,
  p_stock_rcn_kg numeric
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_finance numeric:=0;
  v_achete numeric:=0;
  v_restant numeric:=0;
  v_bags integer:=0;
  v_reserved integer:=0;
  v_plafond integer:=0;
  v_max_new integer:=0;
  v_available integer:=0;
  v_cluster text;
  v_cluster_stock integer:=0;
begin
  if not public.peut_demander_sacherie() then
    raise exception 'Droit insuffisant pour calculer le plafond Sacherie';
  end if;
  if p_stock_rcn_kg is null or p_stock_rcn_kg<0 then
    raise exception 'Stock RCN vérifié invalide';
  end if;

  select coalesce(a.volume_finance_kg,0)
    into v_finance
  from public.avances a
  where a.rt_id=p_rt_id and a.cycle_id=p_cycle_id and a.cycle_statut='OPEN'
  order by a.created_at desc limit 1;
  if coalesce(v_finance,0)<=0 then
    raise exception 'Cycle finance OPEN sans volume autorisé en kg';
  end if;

  select coalesce(sum(x.poids_net),0)
    into v_achete
  from public.achats x
  where x.rt_id=p_rt_id and x.cycle_id=p_cycle_id and coalesce(x.rejet,false)=false;

  v_restant:=greatest(v_finance-v_achete,0);
  v_bags:=public.sacherie_sacs_sous_responsabilite_rt(p_rt_id);
  v_reserved:=public.sacherie_reservations_rt(p_rt_id,null);
  v_plafond:=floor(((p_stock_rcn_kg+v_restant)*1.10)/80.0);
  v_max_new:=greatest(v_plafond-v_bags,0);
  v_available:=greatest(v_max_new-v_reserved,0);

  select coalesce(nullif(btrim(r.cluster),''), nullif(btrim(r.data->>'cluster'),''), '')
    into v_cluster
  from public.rt r
  where r.id::text=p_rt_id and coalesce(r.deleted,false)=false
  limit 1;
  if not found then raise exception 'RT introuvable dans le référentiel'; end if;
  if v_cluster='' then raise exception 'RT sans cluster : régulariser le référentiel'; end if;

  v_cluster_stock:=public.sacherie_stock_cluster(v_cluster);

  return jsonb_build_object(
    'volume_finance_kg',v_finance,
    'volume_achete_cycle_kg',v_achete,
    'volume_finance_restant_kg',v_restant,
    'stock_rcn_kg_verified',p_stock_rcn_kg,
    'bags_already_held',v_bags,
    'reserved_approved_bags',v_reserved,
    'system_max_bags',v_plafond,
    'max_new_bags',v_max_new,
    'max_new_available',v_available,
    'cluster_stock',v_cluster_stock
  );
end $$;

create or replace function public.sacherie_creer_demande(
  p_client_request_id text,
  p_rt_id text,
  p_cycle_id text,
  p_stock_rcn_kg numeric,
  p_requested_qty integer
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_calc jsonb;
  v_rt_nom text;
  v_cluster text;
  v_zone text;
  v_prof_cluster text;
  v_prof_fonction text;
  v_req public.bag_movement_requests%rowtype;
  v_code text;
begin
  if not public.peut_demander_sacherie() then
    raise exception 'Droit insuffisant pour créer une demande';
  end if;
  if p_client_request_id is null or btrim(p_client_request_id)='' then
    raise exception 'Identifiant client de demande obligatoire';
  end if;
  if p_requested_qty is null or p_requested_qty<=0 then
    raise exception 'Quantité invalide';
  end if;

  select * into v_req
  from public.bag_movement_requests
  where client_request_id=p_client_request_id and requested_by=auth.uid()
  limit 1;
  if found then return to_jsonb(v_req); end if;

  select coalesce(nullif(btrim(r.nom),''), nullif(btrim(r.data->>'nom'),''), nullif(btrim(r.data->>'rt'),''), r.village_nom),
         coalesce(nullif(btrim(r.cluster),''), nullif(btrim(r.data->>'cluster'),''), ''),
         coalesce(nullif(btrim(r.data->>'zone'),''), '')
    into v_rt_nom,v_cluster,v_zone
  from public.rt r
  where r.id::text=p_rt_id and coalesce(r.deleted,false)=false
  limit 1;
  if not found then raise exception 'RT introuvable dans le référentiel'; end if;
  if v_cluster='' then raise exception 'RT sans cluster : régulariser le référentiel'; end if;

  if not public.est_bm() then
    select p.cluster,p.fonction_operationnelle
      into v_prof_cluster,v_prof_fonction
    from public.profils p
    where p.user_id=auth.uid() and p.actif=true limit 1;
    if v_prof_fonction not in ('Unit Head','Assistant Unit Head') then
      raise exception 'Seul le Unit Head ou Assistant Unit Head peut demander pour un RT';
    end if;
    if upper(coalesce(v_prof_cluster,''))<>upper(v_cluster) then
      raise exception 'RT hors du cluster attribué à l utilisateur';
    end if;
  end if;

  v_calc:=public.sacherie_calculer_plafond(p_rt_id,p_cycle_id,p_stock_rcn_kg);
  if p_requested_qty>(v_calc->>'max_new_available')::integer then
    raise exception 'Quantité demandée supérieure au plafond disponible';
  end if;

  v_code:='REQ-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_cluster)||'-'||lpad(nextval('public.bag_request_seq')::text,6,'0');

  insert into public.bag_movement_requests(
    client_request_id,request_code,cluster,zone,rt_id,rt_nom,cycle_id,
    stock_rcn_kg_verified,stock_checked_by,stock_checked_at,stock_source,
    volume_finance_kg,volume_achete_cycle_kg,volume_finance_restant_kg,
    bags_already_held,reserved_approved_bags,system_max_bags,max_new_bags,max_new_available,
    cluster_stock_at_request,requested_qty,status,requested_by,requested_at
  ) values (
    p_client_request_id,v_code,v_cluster,v_zone,p_rt_id,v_rt_nom,p_cycle_id,
    p_stock_rcn_kg,auth.uid(),now(),'PHYSICAL_COUNT',
    (v_calc->>'volume_finance_kg')::numeric,
    (v_calc->>'volume_achete_cycle_kg')::numeric,
    (v_calc->>'volume_finance_restant_kg')::numeric,
    (v_calc->>'bags_already_held')::integer,
    (v_calc->>'reserved_approved_bags')::integer,
    (v_calc->>'system_max_bags')::integer,
    (v_calc->>'max_new_bags')::integer,
    (v_calc->>'max_new_available')::integer,
    (v_calc->>'cluster_stock')::integer,
    p_requested_qty,'PENDING_BM',auth.uid(),now()
  ) returning * into v_req;

  return to_jsonb(v_req);
exception
  when unique_violation then
    select * into v_req
    from public.bag_movement_requests
    where client_request_id=p_client_request_id and requested_by=auth.uid()
    limit 1;
    if found then return to_jsonb(v_req); end if;
    raise;
end $$;

commit;
