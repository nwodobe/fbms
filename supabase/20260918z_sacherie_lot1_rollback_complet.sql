-- =====================================================================
-- RETOUR ARRIERE COMPLET du lot 1 Sacherie (identite, roles, perimetres)
-- Fichier : supabase/20260918z_sacherie_lot1_rollback_complet.sql
--
-- AVERTISSEMENT : ce script restaure a l'identique les definitions de
-- production du 18/09/2026 (verifiees par md5). Il REOUVRE donc les failles
-- confirmees et corrigees par le lot :
--   * fonction_operationnelle NULL = aucun droit physique (magasinier et
--     Unit Head bloques, BM seul executant) ;
--   * compte sans cluster = ecriture sur toutes les localisations ;
--   * sacherie_ct_location appelable sans controle (reactivation libre) ;
--   * approved_qty / destination / released_qty modifiables par UPDATE direct ;
--   * decision de perte possible par le declarant ou sans profil actif ;
--   * sortie magasin sans controle de cluster.
-- Il ne doit etre execute QUE sur decision ecrite du Branch Manager, apres
-- echec des retours cibles decrits dans docs/sacherie_lot1_identite_acces_20260918.md.
-- Garde-fou : exige  psql -v confirmer_reouverture=oui
-- Il ne touche ni aux comptes, ni aux mouvements, ni au journal d'audit.
-- =====================================================================
\if :{?confirmer_reouverture}
\else
  \echo 'REFUS : relancer avec -v confirmer_reouverture=oui apres decision ecrite du BM'
  \quit
\endif

begin;
drop trigger if exists trg_profils_garde_habilitations on public.profils;
drop trigger if exists trg_profils_journal on public.profils;
drop policy if exists rcn_proc_audit_central_read_profils_bm on public.rcn_proc_audit_central;
drop policy if exists sacherie_perimetre_read on public.rcn_jute_locations;
drop policy if exists sacherie_perimetre_read on public.rcn_jute_movements;
drop policy if exists sacherie_perimetre_read on public.rcn_jute_transfers;
drop policy if exists sacherie_perimetre_read on public.rcn_jute_loss_requests;
drop policy if exists sacherie_perimetre_read on public.rcn_jute_inventories;

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
CREATE OR REPLACE FUNCTION public.ops_bag_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then return new; end if;
  if tg_op='INSERT' then
    new.requested_by:=v_uid; new.requested_at:=coalesce(new.requested_at,now()); new.status:='REQUESTED';
    new.approved_qty:=null; new.released_qty:=0; new.received_qty:=0;
    new.reviewed_by:=null; new.reviewed_at:=null; new.approved_by:=null; new.approved_at:=null;
    return new;
  end if;
  if old.channel<>new.channel or old.requested_by<>new.requested_by or old.requested_qty<>new.requested_qty then raise exception 'Identité de la demande non modifiable après création'; end if;
  if old.status is distinct from new.status then
    if new.status in ('REJECTED','CANCELLED') then
      if not private.ops_has_role(array['General Manager','Branch Manager','Procurement Officer','LBA Purchase Officer','Field Buying Operations Officer','Zonal Head']) then raise exception 'Droit insuffisant pour clôturer la demande'; end if;
    elsif old.channel='LBA' and old.status='REQUESTED' and new.status='REVIEWED' then
      if not private.ops_has_role(array['Procurement Officer','LBA Purchase Officer','Branch Manager']) then raise exception 'Review LBA réservé au Procurement'; end if;
      new.reviewed_by:=v_uid; new.reviewed_at:=now();
    elsif old.channel='LBA' and old.status='REVIEWED' and new.status='GM_APPROVED' then
      if not private.ops_has_role(array['General Manager']) then raise exception 'Seul le General Manager peut approuver les sacs LBA'; end if;
      if v_uid=old.requested_by then raise exception 'Séparation des tâches : l’initiateur ne peut pas approuver sa propre demande'; end if;
      if new.approved_qty is null or new.approved_qty<=0 or new.approved_qty>old.requested_qty then raise exception 'Quantité approuvée invalide'; end if;
      new.approved_by:=v_uid; new.approved_at:=now();
    elsif old.channel='AFLP' and old.status='REQUESTED' and new.status='REVIEWED' then
      if not private.ops_has_role(array['Zonal Head','Branch Manager']) then raise exception 'Review AFLP réservé au Zonal Head'; end if;
      new.reviewed_by:=v_uid; new.reviewed_at:=now();
    elsif old.channel='AFLP' and old.status='REVIEWED' and new.status='CONSOLIDATED' then
      if not private.ops_has_role(array['Field Buying Operations Officer','Branch Manager']) then raise exception 'Consolidation AFLP réservée au Field Buying Operations Officer'; end if;
    elsif old.channel='AFLP' and old.status='CONSOLIDATED' and new.status='BM_APPROVED' then
      if not private.ops_has_role(array['Branch Manager']) then raise exception 'Seul le Branch Manager peut approuver Cluster vers RT'; end if;
      if v_uid=old.requested_by then raise exception 'Séparation des tâches : l’initiateur ne peut pas approuver sa propre demande'; end if;
      if new.approved_qty is null or new.approved_qty<=0 or new.approved_qty>old.requested_qty then raise exception 'Quantité approuvée invalide'; end if;
      new.approved_by:=v_uid; new.approved_at:=now();
    elsif new.status in ('PARTIALLY_RELEASED','FULLY_RELEASED') then
      if not private.ops_has_role(array['Warehouse Manager','Storekeeper','Procurement Officer','Branch Manager','Warehouse Keeper','Assistant Unit Head']) then raise exception 'Sortie physique réservée au magasin'; end if;
    elsif new.status='EXPIRED' then
      if new.expires_at is null or new.expires_at>=now() then raise exception 'Approval non expiré'; end if;
    else raise exception 'Transition sacherie non autorisée: % vers %',old.status,new.status;
    end if;
  end if;

  -- AJOUT : confirmation de reception. Traversait le guard sans aucun controle.
  if new.received_qty is distinct from old.received_qty then
    if new.received_qty < old.received_qty then
      raise exception 'Une reception confirmee ne peut pas etre diminuee (% vers %)', old.received_qty, new.received_qty;
    end if;
    if not private.ops_has_role(array['Unit Head','Field Buying Operations Officer','Branch Manager','Administrateur']) then
      raise exception 'Confirmation de reception reservee au terrain destinataire';
    end if;
    if new.received_qty < new.released_qty
       and coalesce(btrim(new.receipt_gap_reason),'') = '' then
      raise exception 'Ecart de reception (% recus sur % liberes) : motif obligatoire', new.received_qty, new.released_qty;
    end if;
  end if;

  new.updated_at:=now(); return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.ops_release_bags(p_request_id uuid, p_client_release_id text, p_source_location text, p_destination_location text, p_qty integer, p_proof_url text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req public.ops_bag_requests%rowtype;
  v_existing public.ops_bag_releases%rowtype;
  v_available integer;
  v_move_id text;
  v_release public.ops_bag_releases%rowtype;
  v_new_total integer;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if not private.ops_has_role(array['Branch Manager','Warehouse Manager','Storekeeper','Procurement Officer','Warehouse Keeper','Assistant Unit Head']) then
    raise exception 'Droit insuffisant pour libérer les sacs';
  end if;
  if p_client_release_id is null or btrim(p_client_release_id)='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantité de sacs invalide'; end if;
  select * into v_existing from public.ops_bag_releases where client_release_id=p_client_release_id limit 1;
  if found then return to_jsonb(v_existing); end if;
  select * into v_req from public.ops_bag_requests where id=p_request_id for update;
  if not found then raise exception 'Demande de sacs introuvable'; end if;
  if v_req.approved_by = v_uid then raise exception 'Séparation des tâches : approbateur et exécutant doivent être différents'; end if;
  if v_req.status not in ('GM_APPROVED','BM_APPROVED','READY_FOR_RELEASE','PARTIALLY_RELEASED') then raise exception 'Approval valide requis avant la sortie physique'; end if;
  if v_req.expires_at is not null and v_req.expires_at < now() then
    update public.ops_bag_requests set status='EXPIRED',updated_at=now() where id=v_req.id;
    raise exception 'Approval expiré';
  end if;
  if p_source_location is distinct from v_req.source_location_code or p_destination_location is distinct from v_req.destination_location_code then
    raise exception 'Source/destination différentes de l’autorisation';
  end if;
  if v_req.approved_qty is null then raise exception 'Quantité approuvée absente'; end if;
  if v_req.released_qty + p_qty > v_req.approved_qty then raise exception 'Sortie supérieure à l’autorisation restante'; end if;
  perform pg_advisory_xact_lock(42070,hashtext(p_source_location));
  select coalesce(sum(qty),0)::integer into v_available from public.rcn_jute_v_stock where location_code=p_source_location and state='UTILISABLE';
  if v_available < p_qty then raise exception 'Stock utilisable insuffisant'; end if;
  v_move_id := 'JUT-OPS-'||replace(gen_random_uuid()::text,'-','');
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,supplier_code,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,created_by,owner_type,campaign,cluster,rt_id)
  values(v_move_id,'OPS-BAG-RELEASE:'||p_client_release_id,'TRANSFERT','INTERNE',v_req.lba_code,p_qty,p_source_location,p_destination_location,'UTILISABLE','UTILISABLE','OPS_BAG_REQUEST',v_req.id::text,v_req.request_code,p_note,p_proof_url,now(),v_uid,'ANAGROCI',v_req.campaign,v_req.cluster,v_req.rt_id);
  insert into public.ops_bag_releases(client_release_id,request_id,qty,source_location_code,destination_location_code,jute_movement_id,released_by,proof_url,notes)
  values(p_client_release_id,v_req.id,p_qty,p_source_location,p_destination_location,v_move_id,v_uid,p_proof_url,p_note)
  returning * into v_release;
  v_new_total:=v_req.released_qty+p_qty;
  update public.ops_bag_requests
     set released_qty=v_new_total,
         status=case when v_new_total < approved_qty then 'PARTIALLY_RELEASED' else 'FULLY_RELEASED' end,
         updated_at=now()
   where id=v_req.id;
  return to_jsonb(v_release);
exception when unique_violation then
  select * into v_existing from public.ops_bag_releases where client_release_id=p_client_release_id limit 1;
  if found then return to_jsonb(v_existing); end if;
  raise;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sacherie_creer_demande(p_client_request_id text, p_rt_id text, p_cycle_id text, p_stock_rcn_kg numeric, p_requested_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_calc jsonb; v_rt_nom text; v_cluster text; v_zone text; v_prof_cluster text; v_prof_fonction text; v_req public.bag_movement_requests%rowtype; v_code text;
begin
  if not public.peut_demander_sacherie() then raise exception 'Droit insuffisant pour créer une demande'; end if;
  if p_client_request_id is null or btrim(p_client_request_id)='' then raise exception 'Identifiant client de demande obligatoire'; end if;
  if p_requested_qty is null or p_requested_qty<=0 then raise exception 'Quantité invalide'; end if;
  select * into v_req from public.bag_movement_requests where client_request_id=p_client_request_id and requested_by=auth.uid() limit 1;
  if found then return to_jsonb(v_req); end if;
  select coalesce(nullif(btrim(r.nom),''), nullif(btrim(r.data->>'nom'),''), nullif(btrim(r.data->>'rt'),''), r.village_nom), coalesce(nullif(btrim(r.cluster),''), nullif(btrim(r.data->>'cluster'),''), ''), coalesce(nullif(btrim(r.data->>'zone'),''), '') into v_rt_nom,v_cluster,v_zone from public.rt r where r.id::text=p_rt_id and coalesce(r.deleted,false)=false limit 1;
  if not found then raise exception 'RT introuvable dans le référentiel'; end if; if v_cluster='' then raise exception 'RT sans cluster : régulariser le référentiel'; end if;
  if not public.est_bm() then select p.cluster,p.fonction_operationnelle into v_prof_cluster,v_prof_fonction from public.profils p where p.user_id=auth.uid() and p.actif=true limit 1; if v_prof_fonction not in ('Unit Head','Assistant Unit Head') then raise exception 'Seul le Unit Head ou Assistant Unit Head peut demander pour un RT'; end if; if upper(coalesce(v_prof_cluster,''))<>upper(v_cluster) then raise exception 'RT hors du cluster attribué à l utilisateur'; end if; end if;
  v_calc:=public.sacherie_calculer_plafond(p_rt_id,p_cycle_id,p_stock_rcn_kg);
  if p_requested_qty>(v_calc->>'max_new_available')::integer then raise exception 'Quantité demandée supérieure au plafond disponible'; end if;
  v_code:='REQ-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_cluster)||'-'||lpad(nextval('public.bag_request_seq')::text,6,'0');
  insert into public.bag_movement_requests(client_request_id,request_code,cluster,zone,rt_id,rt_nom,cycle_id,stock_rcn_kg_verified,stock_checked_by,stock_checked_at,stock_source,volume_finance_kg,volume_achete_cycle_kg,volume_finance_restant_kg,bags_already_held,reserved_approved_bags,system_max_bags,max_new_bags,max_new_available,cluster_stock_at_request,requested_qty,status,requested_by,requested_at) values (p_client_request_id,v_code,v_cluster,v_zone,p_rt_id,v_rt_nom,p_cycle_id,p_stock_rcn_kg,auth.uid(),now(),'PHYSICAL_COUNT',(v_calc->>'volume_finance_kg')::numeric,(v_calc->>'volume_achete_cycle_kg')::numeric,(v_calc->>'volume_finance_restant_kg')::numeric,(v_calc->>'bags_already_held')::integer,(v_calc->>'reserved_approved_bags')::integer,(v_calc->>'system_max_bags')::integer,(v_calc->>'max_new_bags')::integer,(v_calc->>'max_new_available')::integer,(v_calc->>'cluster_stock')::integer,p_requested_qty,'PENDING_BM',auth.uid(),now()) returning * into v_req;
  return to_jsonb(v_req);
exception when unique_violation then select * into v_req from public.bag_movement_requests where client_request_id=p_client_request_id and requested_by=auth.uid() limit 1; if found then return to_jsonb(v_req); end if; raise;
end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_decider_demande(p_request_id uuid, p_action text, p_approved_qty integer DEFAULT NULL::integer, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_req public.bag_movement_requests%rowtype;v_calc jsonb;v_qty integer;v_other_reserved integer;v_available integer; begin if not public.est_bm() then raise exception 'Seul le Branch Manager peut approuver'; end if; select * into v_req from public.bag_movement_requests where id=p_request_id for update; if not found then raise exception 'Demande introuvable'; end if; if v_req.status not in ('PENDING_BM','HOLD') then raise exception 'Demande déjà traitée'; end if; perform pg_advisory_xact_lock(42027,hashtext(v_req.rt_id)); if upper(p_action)='APPROVE' then v_calc:=public.sacherie_calculer_plafond(v_req.rt_id,v_req.cycle_id,v_req.stock_rcn_kg_verified); v_other_reserved:=public.sacherie_reservations_rt(v_req.rt_id,v_req.id); v_available:=greatest((v_calc->>'max_new_bags')::integer-v_other_reserved,0); v_qty:=coalesce(p_approved_qty,v_req.requested_qty); if v_qty<=0 or v_qty>v_req.requested_qty or v_qty>v_available then raise exception 'Quantité approuvée invalide ou supérieure au plafond disponible'; end if; update public.bag_movement_requests set status='APPROVED',approved_qty=v_qty,approved_by=auth.uid(),approved_at=now(),expires_at=now()+interval '24 hours',approval_comment=p_comment,volume_finance_kg=(v_calc->>'volume_finance_kg')::numeric,volume_achete_cycle_kg=(v_calc->>'volume_achete_cycle_kg')::numeric,volume_finance_restant_kg=(v_calc->>'volume_finance_restant_kg')::numeric,bags_already_held=(v_calc->>'bags_already_held')::integer,reserved_approved_bags=v_other_reserved,system_max_bags=(v_calc->>'system_max_bags')::integer,max_new_bags=(v_calc->>'max_new_bags')::integer,max_new_available=v_available where id=p_request_id returning * into v_req; elsif upper(p_action)='HOLD' then if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Motif HOLD obligatoire'; end if; update public.bag_movement_requests set status='HOLD',approval_comment=p_comment where id=p_request_id returning * into v_req; elsif upper(p_action)='REJECT' then if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Motif de rejet obligatoire'; end if; update public.bag_movement_requests set status='REJECTED',approval_comment=p_comment,closed_at=now() where id=p_request_id returning * into v_req; else raise exception 'Action inconnue'; end if; return to_jsonb(v_req); end $function$
;
CREATE OR REPLACE FUNCTION public.sacherie_executer_demande(p_request_id uuid, p_executed_qty integer, p_bag_state text DEFAULT 'EMPTY'::text, p_lot_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_req public.bag_movement_requests%rowtype;v_mov public.sacs_mouvements%rowtype;v_code text;v_cluster_stock integer; begin if p_executed_qty is null or p_executed_qty<=0 then raise exception 'Quantité exécutée invalide'; end if; select * into v_req from public.bag_movement_requests where id=p_request_id for update; if not found then raise exception 'Demande introuvable'; end if; if not public.peut_executer_sacherie(v_req.cluster) then raise exception 'Seul le Warehouse Keeper ou Assistant Unit Head du cluster peut remettre les sacs'; end if; if v_req.status<>'APPROVED' then raise exception 'Approval BM requis'; end if; if v_req.expires_at is null or v_req.expires_at<now() then raise exception 'Approval expiré'; end if; if p_executed_qty>v_req.approved_qty then raise exception 'Quantité exécutée supérieure à la quantité approuvée'; end if; if upper(coalesce(p_bag_state,'EMPTY'))<>'EMPTY' then raise exception 'La dotation RT doit être EMPTY'; end if; if exists(select 1 from public.sacs_mouvements where request_id=p_request_id) then raise exception 'Approval déjà utilisé'; end if; perform pg_advisory_xact_lock(42027,hashtext(v_req.rt_id)); perform pg_advisory_xact_lock(42028,hashtext(upper(v_req.cluster))); v_cluster_stock:=public.sacherie_stock_cluster(v_req.cluster); if v_cluster_stock<p_executed_qty then raise exception 'Stock sacs cluster insuffisant'; end if; v_code:='BAG-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_req.cluster)||'-'||lpad(nextval('public.bag_movement_seq')::text,6,'0'); insert into public.sacs_mouvements(local_id,date,type,source,destination,cluster,rt_id,rt_nom,quantite,observation,created_by,created_by_nom,created_at,request_id,bag_movement_code,approved_qty,executed_qty,bag_state,lot_id,business_status,issued_by,issued_at) values(gen_random_uuid()::text,current_date,'DOTATION_RT','CLUSTER','RT',v_req.cluster,v_req.rt_id,v_req.rt_nom,p_executed_qty,'Execution Sacherie V2 '||v_req.request_code,auth.uid(),null,now(),v_req.id,v_code,v_req.approved_qty,p_executed_qty,'EMPTY',null,case when p_executed_qty<v_req.approved_qty then 'PARTIALLY_EXECUTED' else 'EXECUTED' end,auth.uid(),now()) returning * into v_mov; update public.bag_movement_requests set status=case when p_executed_qty<approved_qty then 'PARTIALLY_EXECUTED' else 'EXECUTED' end,closed_at=now() where id=v_req.id; return to_jsonb(v_mov); end $function$
;
-- Replica locale : fonctions de LECTURE Sacherie exactes de production (18/09/2026).
;

-- Droits : etat de production du 18/09/2026 (y compris le GRANT de 07:10).
grant execute on function public.sacherie_ct_location(text,text,text,text,text,text) to authenticated;
grant execute on function public.sacherie_ops_create_transfer(text,text,text,text,integer,text,text,text,text,text),
  public.sacherie_ops_receive_transfer(text,text,integer,text,text,text),
  public.sacherie_ops_network_move(text,text,text,text,text,integer,text,text,text),
  public.sacherie_ops_ensure_locations(), public.sacherie_ops_resolve_cluster_location(text) to public;

-- Nouvelles fonctions du lot (plus referencees apres restauration).
drop function if exists public.sacherie_ct_location_rt(text);
drop function if exists public.fbms_roles_attribuables();
drop function if exists private.profils_garde_habilitations();
drop function if exists private.profils_journaliser();
drop function if exists private.sacherie_portee_lecture();
drop function if exists private.sacherie_peut_lire_emplacement(text);
drop function if exists private.sacherie_peut_lire_cluster(text,boolean);
drop function if exists private.sacherie_exiger_cluster(text,boolean,text);
drop function if exists private.sacherie_contexte();
drop function if exists private.sacherie_norm_cluster(text);
commit;
