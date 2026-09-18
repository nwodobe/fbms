-- Replica locale : fonctions Sacherie EXACTES de production (18/09/2026).
CREATE OR REPLACE FUNCTION public.sacherie_ct_location(p_scope text, p_cluster text, p_rt_id text DEFAULT NULL::text, p_rt_nom text DEFAULT NULL::text, p_producteur_id text DEFAULT NULL::text, p_producteur_nom text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_scope text:=upper(coalesce(p_scope,'')); v_code text; v_name text;
begin
 if v_scope='CLUSTER' then v_code:='AFLP-CL-'||public.sacherie_ct_slug(p_cluster); v_name:='Cluster '||coalesce(p_cluster,'INCONNU');
 elsif v_scope='RT' then v_code:='AFLP-RT-'||public.sacherie_ct_slug(coalesce(p_rt_id,p_rt_nom,'INCONNU')); v_name:='RT '||coalesce(nullif(p_rt_nom,''),p_rt_id,'INCONNU');
 elsif v_scope='PRODUCTEUR' then v_code:='AFLP-PROD-'||public.sacherie_ct_slug(coalesce(p_producteur_id,p_producteur_nom,'INCONNU')); v_name:='Producteur '||coalesce(nullif(p_producteur_nom,''),p_producteur_id,'INCONNU');
 elsif v_scope='HUB' then v_code:='AFLP-HUB-'||public.sacherie_ct_slug(p_cluster); v_name:='Hub '||coalesce(p_cluster,'INCONNU');
 elsif v_scope='FACTORY' then v_code:='AFLP-FACTORY-YAMOUSSOUKRO'; v_name:='Factory Yamoussoukro';
 else raise exception 'Scope sacherie inconnu: %',p_scope; end if;
 insert into public.rcn_jute_locations(code,site_code,warehouse_code,nom,type,actif,scope_type,cluster,rt_id,producteur_id)
 values(v_code,coalesce(nullif(p_cluster,''),'GLOBAL'),v_scope,v_name,'STOCK',true,v_scope,nullif(p_cluster,''),nullif(p_rt_id,''),nullif(p_producteur_id,''))
 on conflict(code) do update set nom=excluded.nom,actif=true,scope_type=excluded.scope_type,cluster=coalesce(excluded.cluster,public.rcn_jute_locations.cluster),rt_id=coalesce(excluded.rt_id,public.rcn_jute_locations.rt_id),producteur_id=coalesce(excluded.producteur_id,public.rcn_jute_locations.producteur_id);
 return v_code;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_assert_location_access(p_location text, p_write boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_role text; v_op text; v_cluster text; l public.rcn_jute_locations%rowtype;
begin
 if v_uid is null then raise exception 'Connexion requise'; end if;
 select role,fonction_operationnelle,cluster into v_role,v_op,v_cluster from public.profils where user_id=v_uid and actif=true limit 1;
 if not found then raise exception 'Profil actif requis'; end if;
 select * into l from public.rcn_jute_locations where code=p_location and actif=true;
 if not found then raise exception 'Localisation inconnue'; end if;
 if v_role='Branch Manager' then return; end if;
 if coalesce(v_op,'') not in ('Zonal Head','Unit Head','Assistant Unit Head','Warehouse Keeper','Logistics Coordinator') then raise exception 'Accès refusé'; end if;
 if v_cluster is not null and l.cluster is not null and upper(v_cluster)<>upper(l.cluster) then raise exception 'Localisation hors périmètre cluster'; end if;
 if p_write and coalesce(v_op,'')='Zonal Head' then raise exception 'Le Zonal Head contrôle mais ne mouvemente pas physiquement les sacs'; end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_locations()
 RETURNS TABLE(code text, nom text, scope_type text, cluster text, rt_id text, producteur_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_role text; v_op text; v_cluster text;
begin
 if v_uid is null then raise exception 'Connexion requise'; end if;
 select role,fonction_operationnelle,p.cluster into v_role,v_op,v_cluster from public.profils p where p.user_id=v_uid and p.actif=true limit 1;
 if not found then raise exception 'Profil actif requis'; end if;
 return query select l.code,l.nom,l.scope_type,l.cluster,l.rt_id,l.producteur_id from public.rcn_jute_locations l where l.actif=true and (v_role='Branch Manager' or v_cluster is null or l.cluster is null or upper(l.cluster)=upper(v_cluster)) order by l.cluster,l.scope_type,l.nom;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_pertes()
 RETURNS TABLE(id text, location_code text, state text, qty integer, motif text, proof_url text, statut text, submitted_at timestamp with time zone, decided_at timestamp with time zone, commentaire_decision text, cluster text, rt_id text, location_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_role text; v_cluster text;
begin
 if v_uid is null then raise exception 'Connexion requise'; end if; select role,p.cluster into v_role,v_cluster from public.profils p where p.user_id=v_uid and p.actif=true limit 1; if not found then raise exception 'Profil actif requis'; end if;
 return query select x.id,x.location_code,x.state,x.qty,x.motif,x.proof_url,x.statut,x.submitted_at,x.decided_at,x.commentaire_decision,l.cluster,l.rt_id,l.nom from public.rcn_jute_loss_requests x left join public.rcn_jute_locations l on l.code=x.location_code where x.ledger='INTERNE' and (v_role='Branch Manager' or v_cluster is null or upper(coalesce(l.cluster,''))=upper(v_cluster)) order by x.submitted_at desc;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_decider_perte(p_id text, p_approve boolean, p_comment text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare x public.rcn_jute_loss_requests%rowtype; v_uid uuid:=auth.uid(); v_role text; v_available integer:=0; v_mid text; l public.rcn_jute_locations%rowtype;
begin
 if v_uid is null then raise exception 'Connexion requise'; end if; select role into v_role from public.profils where user_id=v_uid and actif=true limit 1; if v_role<>'Branch Manager' then raise exception 'Décision perte réservée au Branch Manager'; end if;
 select * into x from public.rcn_jute_loss_requests where id=p_id for update; if not found then raise exception 'Déclaration de perte introuvable'; end if; if x.statut<>'SOUMIS' then raise exception 'Déclaration déjà décidée'; end if;
 if not p_approve then update public.rcn_jute_loss_requests set statut='REFUSE',decided_by=v_uid,decided_at=now(),commentaire_decision=p_comment where id=p_id; return 'REFUSE'; end if;
 select coalesce(qty,0) into v_available from public.rcn_jute_v_stock where location_code=x.location_code and state=x.state; if x.qty>v_available then raise exception 'Stock insuffisant pour approuver cette perte'; end if;
 select * into l from public.rcn_jute_locations where code=x.location_code; v_mid:='JUT-LOSS-'||substr(md5(p_id),1,16);
 insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,cluster,rt_id,producteur_id)
 values(v_mid,'LOSS:'||p_id,'PERTE_APPROUVEE','INTERNE',x.qty,x.location_code,x.state,'AFLP_PERTE',p_id,p_id,x.motif,x.proof_url,now(),'ANAGROCI',v_uid,l.cluster,l.rt_id,l.producteur_id);
 update public.rcn_jute_loss_requests set statut='APPROUVE',decided_by=v_uid,decided_at=now(),commentaire_decision=p_comment where id=p_id; return v_mid;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_declarer_perte(p_location text, p_state text, p_qty integer, p_reason text, p_proof text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_available integer:=0; v_id text; v_uid uuid:=auth.uid();
begin
 perform public.sacherie_ct_assert_location_access(p_location,true); if p_qty<=0 then raise exception 'Quantité invalide'; end if; if coalesce(trim(p_reason),'')='' then raise exception 'Motif obligatoire'; end if;
 select coalesce(qty,0) into v_available from public.rcn_jute_v_stock where location_code=p_location and state=p_state; if p_qty>v_available then raise exception 'Quantité supérieure au stock disponible'; end if;
 v_id:='JLS-CT-'||substr(md5(clock_timestamp()::text||p_location||p_reason),1,16);
 insert into public.rcn_jute_loss_requests(id,location_code,state,qty,ledger,motif,proof_url,statut,submitted_by,submitted_at) values(v_id,p_location,p_state,p_qty,'INTERNE',p_reason,p_proof,'SOUMIS',v_uid,now()); return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_inventorier(p_location text, p_state text, p_counted integer, p_reason text DEFAULT NULL::text, p_proof text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_theoretical integer:=0; v_id text; v_diff integer; v_uid uuid:=auth.uid(); v_status text;
begin
 perform public.sacherie_ct_assert_location_access(p_location,true);
 if p_counted<0 then raise exception 'Comptage physique invalide'; end if;
 select coalesce(qty,0) into v_theoretical from public.rcn_jute_v_stock where location_code=p_location and state=p_state;
 v_diff:=p_counted-v_theoretical; if v_diff<>0 and coalesce(trim(p_reason),'')='' then raise exception 'Motif obligatoire en cas d écart'; end if;
 v_status:=case when v_diff=0 then 'PASS' else 'HOLD' end; v_id:='INV-CT-'||substr(md5(clock_timestamp()::text||p_location||p_state),1,16);
 insert into public.rcn_jute_inventories(id,inventory_batch_id,location_code,state,theoretical_qty,counted_qty,motif,statut,reconciliation_status,counted_by,counted_at,proof_url)
 values(v_id,'CT-'||to_char(now(),'YYYYMMDD'),p_location,p_state,v_theoretical,p_counted,p_reason,'SOUMIS',v_status,v_uid,now(),p_proof);
 return jsonb_build_object('id',v_id,'theoretical',v_theoretical,'counted',p_counted,'difference',v_diff,'status',v_status);
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_traiter_etat(p_location text, p_from_state text, p_to_state text, p_qty integer, p_reason text, p_proof text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_available integer:=0; v_id text; v_role text; v_uid uuid:=auth.uid(); l public.rcn_jute_locations%rowtype;
begin
 perform public.sacherie_ct_assert_location_access(p_location,true); if p_qty<=0 then raise exception 'Quantité invalide'; end if; if coalesce(trim(p_reason),'')='' then raise exception 'Motif obligatoire'; end if;
 if (p_from_state,p_to_state) not in (('DECHIRE','A_REPARER'),('DECHIRE','REFORME'),('A_REPARER','REPARE'),('A_REPARER','REFORME'),('REPARE','UTILISABLE')) then raise exception 'Transition état non autorisée'; end if;
 select role into v_role from public.profils where user_id=v_uid and actif=true limit 1; if p_to_state='REFORME' and v_role<>'Branch Manager' then raise exception 'Classement REBUT réservé au Branch Manager'; end if;
 select coalesce(qty,0) into v_available from public.rcn_jute_v_stock where location_code=p_location and state=p_from_state; if p_qty>v_available then raise exception 'Quantité supérieure au stock disponible dans cet état'; end if;
 select * into l from public.rcn_jute_locations where code=p_location; v_id:='JUT-CT-'||substr(md5(clock_timestamp()::text||p_location||p_reason),1,16);
 insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,cluster,rt_id,producteur_id)
 values(v_id,'STATE:'||v_id,'CLASSEMENT','INTERNE',p_qty,p_location,p_location,p_from_state,p_to_state,'AFLP_ETAT',v_id,v_id,p_reason,p_proof,now(),'ANAGROCI',v_uid,l.cluster,l.rt_id,l.producteur_id);
 return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_bridge_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin perform public.sacherie_ct_project_mouvement(new.id); return new; end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ct_project_mouvement(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.sacs_mouvements%rowtype; v_from text; v_to text; v_from_state text; v_to_state text; v_type text; v_mid text; v_event text;
begin
 select * into s from public.sacs_mouvements where id=p_id;
 if not found then raise exception 'Mouvement sacs introuvable'; end if;
 if s.quantite is null or s.quantite<=0 then raise exception 'Quantite sacs invalide'; end if;
 if s.type='USINE_CLUSTER' then v_to:=public.sacherie_ct_location('CLUSTER',s.cluster,null,null,null,null); v_to_state:='UTILISABLE'; v_type:='ACHAT';
 elsif s.type='DOTATION_RT' then v_from:=public.sacherie_ct_location('CLUSTER',s.cluster,null,null,null,null); v_to:=public.sacherie_ct_location('RT',s.cluster,s.rt_id,s.rt_nom,null,null); v_from_state:='UTILISABLE'; v_to_state:='UTILISABLE'; v_type:='TRANSFERT';
 elsif s.type='DISTRIBUTION' then v_from:=public.sacherie_ct_location('RT',s.cluster,s.rt_id,s.rt_nom,null,null); v_to:=public.sacherie_ct_location('PRODUCTEUR',s.cluster,null,null,s.producteur_id,s.producteur_nom); v_from_state:='UTILISABLE'; v_to_state:='UTILISABLE'; v_type:='TRANSFERT';
 elsif s.type='ENLEVEMENT' then v_from:=public.sacherie_ct_location('PRODUCTEUR',s.cluster,null,null,s.producteur_id,s.producteur_nom); v_to:=public.sacherie_ct_location('HUB',s.cluster,null,null,null,null); v_from_state:='UTILISABLE'; v_to_state:='PLEIN'; v_type:='TRANSFERT';
 elsif s.type='RETOUR_PROD' then v_from:=public.sacherie_ct_location('PRODUCTEUR',s.cluster,null,null,s.producteur_id,s.producteur_nom); v_to:=public.sacherie_ct_location('RT',s.cluster,s.rt_id,s.rt_nom,null,null); v_from_state:='UTILISABLE'; v_to_state:='UTILISABLE'; v_type:='TRANSFERT';
 elsif s.type='RETOUR_RT' then v_from:=public.sacherie_ct_location('RT',s.cluster,s.rt_id,s.rt_nom,null,null); v_to:=public.sacherie_ct_location('CLUSTER',s.cluster,null,null,null,null); v_from_state:='UTILISABLE'; v_to_state:='UTILISABLE'; v_type:='TRANSFERT';
 elsif s.type='DECHIRE_RT' then v_from:=public.sacherie_ct_location('RT',s.cluster,s.rt_id,s.rt_nom,null,null); v_to:=v_from; v_from_state:='UTILISABLE'; v_to_state:='DECHIRE'; v_type:='CLASSEMENT';
 elsif s.type='DECHIRE_PROD' then v_from:=public.sacherie_ct_location('PRODUCTEUR',s.cluster,null,null,s.producteur_id,s.producteur_nom); v_to:=v_from; v_from_state:='UTILISABLE'; v_to_state:='DECHIRE'; v_type:='CLASSEMENT';
 else return null; end if;
 v_event:='AFLP-SACS:'||s.id::text; v_mid:='JUT-AFLP-'||replace(s.id::text,'-','');
 insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,cluster,rt_id,producteur_id,legacy_sacs_id,bag_movement_request_id)
 values(v_mid,v_event,v_type,'INTERNE',s.quantite,v_from,v_to,v_from_state,v_to_state,'AFLP_'||s.type,s.id::text,coalesce(nullif(s.bag_movement_code,''),s.id::text),s.observation,s.document_url,coalesce(s.created_at,s.date::timestamptz),'ANAGROCI',s.created_by,s.cluster,s.rt_id,s.producteur_id,s.id,s.request_id)
 on conflict(event_key) do nothing;
 return v_mid;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ops_resolve_cluster_location(p_cluster text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_code text; v_norm text:=regexp_replace(upper(coalesce(p_cluster,'')),'[^A-Z0-9]','','g');
begin
  select l.code into v_code from public.rcn_jute_locations l
  where l.actif=true and l.scope_type='CLUSTER' and (
    regexp_replace(upper(coalesce(l.cluster,'')),'[^A-Z0-9]','','g')=v_norm
    or (v_norm='DJEBONOUA' and regexp_replace(upper(coalesce(l.cluster,'')),'[^A-Z0-9]','','g')='NDJEBONOUA')
  ) order by l.created_at asc limit 1;
  return v_code;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ops_ensure_locations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      v_code:='AFLP-CL-'||regexp_replace(upper(c.code),'[^A-Z0-9]+','-','g');
      insert into public.rcn_jute_locations(code,site_code,warehouse_code,nom,type,actif,scope_type,cluster)
      values(v_code,c.code,'CLUSTER','Cluster '||c.label,'STOCK',true,'CLUSTER',c.code)
      on conflict(code) do update set actif=true,scope_type='CLUSTER',cluster=excluded.cluster,nom=excluded.nom;
      v_created:=v_created+1;
    else v_existing:=v_existing+1; end if;
  end loop;
  return jsonb_build_object('created',v_created,'existing',v_existing,'transit_location','JUTE-TRANSIT');
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ops_network_move(p_client_operation_id text, p_flow text, p_cluster text, p_rt_id text, p_producteur_id text, p_qty integer, p_receiver_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_proof_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid:=auth.uid(); v_flow text:=upper(coalesce(p_flow,'')); v_rt public.rt%rowtype; v_prod public.producteurs%rowtype;
  v_from text; v_to text; v_from_state text:='UTILISABLE'; v_to_state text:='UTILISABLE'; v_mid text; v_event text;
  v_available integer:=0; v_existing public.rcn_jute_movements%rowtype; v_cluster_loc text; v_rt_loc text; v_prod_loc text; v_hub_loc text;
  v_cluster_norm text:=regexp_replace(upper(coalesce(p_cluster,'')),'[^A-Z0-9]','','g');
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if coalesce(btrim(p_client_operation_id),'')='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantite invalide'; end if;
  v_event:='SACH-P1:'||btrim(p_client_operation_id);
  select * into v_existing from public.rcn_jute_movements where event_key=v_event limit 1;
  if found then return to_jsonb(v_existing); end if;
  select * into v_rt from public.rt where id=p_rt_id and coalesce(deleted,false)=false limit 1;
  if not found then raise exception 'RT introuvable'; end if;
  if regexp_replace(upper(coalesce(v_rt.cluster,'')),'[^A-Z0-9]','','g')<>v_cluster_norm
     and not (v_cluster_norm='DJEBONOUA' and regexp_replace(upper(coalesce(v_rt.cluster,'')),'[^A-Z0-9]','','g')='NDJEBONOUA')
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
  if v_flow='RT_TO_PRODUCTEUR' then v_from:=v_rt_loc; v_to:=v_prod_loc;
  elsif v_flow='PRODUCTEUR_TO_RT' then v_from:=v_prod_loc; v_to:=v_rt_loc;
  elsif v_flow='RT_TO_CLUSTER' then v_from:=v_rt_loc; v_to:=v_cluster_loc;
  elsif v_flow='PRODUCTEUR_TO_HUB_FULL' then v_hub_loc:=public.sacherie_ct_location('HUB',v_rt.cluster,null,null,null,null); v_from:=v_prod_loc; v_to:=v_hub_loc; v_to_state:='PLEIN';
  else raise exception 'Flux terrain non supporte'; end if;
  perform public.sacherie_ct_assert_location_access(v_from,true);
  perform public.sacherie_ct_assert_location_access(v_to,true);
  select coalesce(sum(qty),0)::integer into v_available from public.rcn_jute_v_stock where location_code=v_from and state=v_from_state;
  if v_available<p_qty then raise exception 'Stock insuffisant a l origine. Disponible: %',v_available; end if;
  v_mid:='JUT-P1-'||substr(md5(v_event),1,20);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,campaign,cluster,rt_id,producteur_id)
  values(v_mid,v_event,'TRANSFERT','INTERNE',p_qty,v_from,v_to,v_from_state,v_to_state,'SACHERIE_P1',p_client_operation_id,p_client_operation_id,
    trim(concat_ws(' | ',nullif(p_note,''),case when coalesce(p_receiver_name,'')<>'' then 'Receptionnaire: '||p_receiver_name end)),p_proof_url,now(),'ANAGROCI',v_uid,'2027',v_rt.cluster,v_rt.id,nullif(p_producteur_id,''))
  returning * into v_existing;
  return to_jsonb(v_existing);
exception when unique_violation then
  select * into v_existing from public.rcn_jute_movements where event_key=v_event limit 1;
  if found then return to_jsonb(v_existing); end if; raise;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ops_create_transfer(p_client_operation_id text, p_from_location text, p_to_location text, p_state text, p_qty integer, p_vehicle text, p_driver text, p_document_ref text, p_proof_url text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid:=auth.uid(); v_id text; v_event text; v_available integer:=0; v_existing public.rcn_jute_transfers%rowtype; v_from public.rcn_jute_locations%rowtype; v_to public.rcn_jute_locations%rowtype;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if coalesce(btrim(p_client_operation_id),'')='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantite invalide'; end if;
  if coalesce(btrim(p_document_ref),'')='' then raise exception 'Reference document obligatoire'; end if;
  v_id:='JTR-P1-'||substr(md5(p_client_operation_id),1,20);
  select * into v_existing from public.rcn_jute_transfers where id=v_id limit 1;
  if found then return to_jsonb(v_existing); end if;
  select * into v_from from public.rcn_jute_locations where code=p_from_location and actif=true; if not found then raise exception 'Origine inconnue'; end if;
  select * into v_to from public.rcn_jute_locations where code=p_to_location and actif=true; if not found then raise exception 'Destination inconnue'; end if;
  if p_from_location=p_to_location then raise exception 'Origine et destination identiques'; end if;
  perform public.sacherie_ct_assert_location_access(p_from_location,true);
  perform public.sacherie_ct_assert_location_access(p_to_location,true);
  select coalesce(sum(qty),0)::integer into v_available from public.rcn_jute_v_stock where location_code=p_from_location and state=p_state;
  if v_available<p_qty then raise exception 'Stock insuffisant pour transfert. Disponible: %',v_available; end if;
  insert into public.rcn_jute_locations(code,site_code,warehouse_code,nom,type,actif,scope_type)
  values('JUTE-TRANSIT','GLOBAL','TRANSIT','Sacherie en transit','TRANSIT',true,'TRANSIT') on conflict(code) do update set actif=true;
  insert into public.rcn_jute_transfers(id,from_location,to_location,state,qty_sent,qty_received,vehicle,driver,document_ref,statut,sent_by,sent_at,proof_url)
  values(v_id,p_from_location,p_to_location,p_state,p_qty,0,nullif(p_vehicle,''),nullif(p_driver,''),p_document_ref,'EXPEDIE',v_uid,now(),p_proof_url) returning * into v_existing;
  v_event:='TRANSFER-SEND:'||v_id;
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,campaign,cluster)
  values('JUT-'||substr(md5(v_event),1,20),v_event,'TRANSFERT','INTERNE',p_qty,p_from_location,'JUTE-TRANSIT',p_state,'EN_TRANSIT','TRANSFERT',v_id,p_document_ref,p_note,p_proof_url,now(),'ANAGROCI',v_uid,'2027',coalesce(v_from.cluster,v_to.cluster));
  return to_jsonb(v_existing);
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_ops_receive_transfer(p_client_operation_id text, p_transfer_id text, p_qty integer, p_motif text DEFAULT NULL::text, p_document_ref text DEFAULT NULL::text, p_proof_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid:=auth.uid(); v_t public.rcn_jute_transfers%rowtype; v_total integer; v_event text; v_mid text;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if coalesce(btrim(p_client_operation_id),'')='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantite recue invalide'; end if;
  v_event:='TRANSFER-RECEIVE:'||btrim(p_client_operation_id);
  if exists(select 1 from public.rcn_jute_movements where event_key=v_event) then
    select * into v_t from public.rcn_jute_transfers where id=p_transfer_id;
    return to_jsonb(v_t);
  end if;
  select * into v_t from public.rcn_jute_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfert introuvable'; end if;
  if v_t.statut in ('CLOS','ANNULE') then raise exception 'Transfert deja cloture'; end if;
  perform public.sacherie_ct_assert_location_access(v_t.to_location,true);
  v_total:=coalesce(v_t.qty_received,0)+p_qty;
  if v_total>v_t.qty_sent then raise exception 'Reception superieure a la quantite expediee'; end if;
  if v_total<v_t.qty_sent and coalesce(btrim(p_motif),'')='' then raise exception 'Motif obligatoire pour une reception partielle'; end if;
  v_mid:='JUT-P1-'||substr(md5(v_event),1,20);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,campaign,cluster)
  values(v_mid,v_event,'TRANSFERT','INTERNE',p_qty,'JUTE-TRANSIT',v_t.to_location,'EN_TRANSIT',v_t.state,'TRANSFERT_P1_RECEIPT',v_t.id,
    coalesce(nullif(p_document_ref,''),v_t.document_ref),p_motif,p_proof_url,now(),'ANAGROCI',v_uid,'2027',
    (select cluster from public.rcn_jute_locations where code=v_t.to_location));
  update public.rcn_jute_transfers set qty_received=v_total,ecart=qty_sent-v_total,
    motif_ecart=case when v_total<qty_sent then p_motif else null end,
    statut=case when v_total<qty_sent then 'ECART' else 'CLOS' end,
    received_by=v_uid,received_at=now(),proof_url=coalesce(p_proof_url,proof_url)
  where id=v_t.id returning * into v_t;
  return to_jsonb(v_t);
exception when unique_violation then
  select * into v_t from public.rcn_jute_transfers where id=p_transfer_id;
  return to_jsonb(v_t);
end $function$
;
