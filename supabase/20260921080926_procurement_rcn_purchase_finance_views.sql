
begin;

-- Finance write surfaces become RPC-only for canonical flows.
revoke insert,update,delete on public.rcn_proc_bons_payer from authenticated,anon;
revoke insert,update,delete on public.rcn_proc_paiements from authenticated,anon;
grant select on public.rcn_proc_bons_payer,public.rcn_proc_paiements to authenticated;

create or replace function public.procurement_submit_bap(
  p_bap_id text,
  p_facture_ref text default null,
  p_facture_date date default null,
  p_comment text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c jsonb;b public.rcn_proc_bons_payer;before_row jsonb;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array[
   'Branch Manager','Assistant Branch Manager','Procurement Officer','LBA Purchase Officer',
   'Coordination','Administrateur'
 ]) then raise exception 'Droit insuffisant pour soumettre le Bon à Payer'; end if;

 select * into b from public.rcn_proc_bons_payer where id=p_bap_id for update;
 if b.id is null then raise exception 'Bon à Payer introuvable'; end if;
 if b.statut not in ('BROUILLON','A_CORRIGER') then raise exception 'BAP non soumissible au statut %',b.statut; end if;
 if b.purchase_settlement_id is not null and not exists(
   select 1 from public.procurement_reception_settlements s
   where s.id=b.purchase_settlement_id and s.status='APPROVED'
 ) then raise exception 'Le Purchase canonique doit être APPROVED'; end if;
 if nullif(btrim(coalesce(p_facture_ref,b.facture_ref,'')),'') is null then
   raise exception 'Référence facture obligatoire';
 end if;

 before_row:=to_jsonb(b);
 update public.rcn_proc_bons_payer set
   facture_ref=coalesce(nullif(btrim(p_facture_ref),''),facture_ref),
   facture_date=coalesce(p_facture_date,facture_date,current_date),
   commentaire=coalesce(nullif(p_comment,''),commentaire),
   statut='SOUMIS_FINANCE',submitted_by=(c->>'uid')::uuid,submitted_at=now(),updated_at=now()
 where id=b.id returning * into b;

 perform public.wms_audit(b.reception_id,'procurement.bap.submit',before_row,to_jsonb(b),coalesce(p_comment,'Submission BAP'));
 return to_jsonb(b);
end $$;

create or replace function public.procurement_decide_bap(
  p_bap_id text,
  p_approve boolean,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c jsonb;b public.rcn_proc_bons_payer;before_row jsonb;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['Finance Manager','Finance','GM','General Manager','Coordination','Administrateur']) then
   raise exception 'Décision BAP réservée à Finance/Management';
 end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Motif obligatoire'; end if;

 select * into b from public.rcn_proc_bons_payer where id=p_bap_id for update;
 if b.id is null then raise exception 'Bon à Payer introuvable'; end if;
 if b.statut<>'SOUMIS_FINANCE' then raise exception 'BAP doit être SOUMIS_FINANCE'; end if;
 if b.prepared_by=(c->>'uid')::uuid or b.submitted_by=(c->>'uid')::uuid then
   raise exception 'Séparation des tâches : préparateur/soumissionnaire et approbateur Finance doivent être différents';
 end if;

 before_row:=to_jsonb(b);
 update public.rcn_proc_bons_payer set
   statut=case when p_approve then 'APPROUVE_FINANCE' else 'A_CORRIGER' end,
   approved_by=(c->>'uid')::uuid,approved_at=now(),
   commentaire=concat_ws(E'\n',commentaire,p_reason),updated_at=now()
 where id=b.id returning * into b;

 perform public.wms_audit(b.reception_id,'procurement.bap.decision',before_row,to_jsonb(b),p_reason);
 return to_jsonb(b);
end $$;

create or replace function public.procurement_record_payment(
  p_bap_id text,
  p_montant numeric,
  p_mode text,
  p_date date,
  p_reference text default null,
  p_banque text default null,
  p_preuve_url text default null,
  p_motif text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c jsonb;b public.rcn_proc_bons_payer;x public.rcn_proc_paiements;v_mode text;v_id text;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['Finance','Finance Manager','Coordination','Administrateur']) then
   raise exception 'Enregistrement paiement réservé à Finance';
 end if;
 if p_montant is null or p_montant<=0 then raise exception 'Montant paiement doit être > 0'; end if;
 v_mode:=upper(nullif(btrim(p_mode),''));
 if v_mode not in ('VIREMENT','CHEQUE','ESPECES','COMPENSATION','AUTRE') then
   raise exception 'Mode de paiement invalide';
 end if;
 if p_date is null then raise exception 'Date paiement obligatoire'; end if;

 select * into b from public.rcn_proc_bons_payer where id=p_bap_id for update;
 if b.id is null then raise exception 'Bon à Payer introuvable'; end if;
 if b.statut not in ('APPROUVE_FINANCE','PARTIELLEMENT_PAYE') then
   raise exception 'BAP doit être APPROUVE_FINANCE ou PARTIELLEMENT_PAYE';
 end if;

 v_id:='PAY-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.rcn_proc_paiements(
   id,bon_payer_id,montant,mode,banque,reference_bancaire,date_paiement,preuve_url,statut,motif,created_by
 ) values(
   v_id,b.id,p_montant,v_mode,nullif(p_banque,''),nullif(p_reference,''),p_date,nullif(p_preuve_url,''),
   'ENREGISTRE',nullif(p_motif,''),(c->>'uid')::uuid
 ) returning * into x;

 perform public.wms_audit(b.reception_id,'procurement.payment.record',null,to_jsonb(x),coalesce(p_motif,'Payment recorded'));
 return to_jsonb(x);
end $$;

create or replace function public.procurement_reconcile_payment(
  p_payment_id text,
  p_accept boolean,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c jsonb;x public.rcn_proc_paiements;b public.rcn_proc_bons_payer;before_row jsonb;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['Finance Manager','GM','General Manager','Coordination','Administrateur']) then
   raise exception 'Rapprochement paiement réservé à Finance Manager/Management';
 end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Motif obligatoire'; end if;

 select * into x from public.rcn_proc_paiements where id=p_payment_id for update;
 if x.id is null then raise exception 'Paiement introuvable'; end if;
 if x.statut<>'ENREGISTRE' then raise exception 'Paiement doit être ENREGISTRE'; end if;
 if x.created_by=(c->>'uid')::uuid then
   raise exception 'Séparation des tâches : créateur et rapprocheur doivent être différents';
 end if;
 select * into b from public.rcn_proc_bons_payer where id=x.bon_payer_id for update;

 before_row:=to_jsonb(x);
 update public.rcn_proc_paiements set
   statut=case when p_accept then 'RAPPROCHE' else 'REJETE' end,
   rapproche_par=(c->>'uid')::uuid,rapproche_at=now(),
   motif=p_reason,updated_at=now()
 where id=x.id returning * into x;

 perform public.wms_audit(b.reception_id,'procurement.payment.reconcile',before_row,to_jsonb(x),p_reason);
 return to_jsonb(x);
end $$;

-- Canonical finance projection: payment state is derived, never typed in Procurement.
create or replace view public.procurement_v_purchase_finance
with (security_invoker=true) as
select
 s.id purchase_id,
 s.purchase_code,
 b.id bap_id,
 b.statut bap_status,
 b.facture_ref,
 b.facture_date,
 s.amount_approved,
 coalesce(sum(p.montant) filter(where p.statut='RAPPROCHE'),0)::numeric amount_paid,
 greatest(coalesce(s.amount_approved,0)-coalesce(sum(p.montant) filter(where p.statut='RAPPROCHE'),0),0)::numeric outstanding_amount,
 case
   when s.status<>'APPROVED' then 'NOT_READY'
   when b.id is null then 'AWAITING_BAP'
   when coalesce(sum(p.montant) filter(where p.statut='RAPPROCHE'),0)>=coalesce(s.amount_approved,0)
        and coalesce(s.amount_approved,0)>0 then 'PAID'
   when coalesce(sum(p.montant) filter(where p.statut='RAPPROCHE'),0)>0 then 'PARTIAL'
   when count(p.id) filter(where p.statut='ENREGISTRE')>0 then 'PENDING'
   when count(p.id) filter(where p.statut='REJETE')>0 then 'FAILED'
   when count(p.id) filter(where p.statut='ANNULE')>0 then 'REVERSED'
   else 'UNPAID'
 end payment_status,
 max(p.date_paiement) filter(where p.statut='RAPPROCHE') last_payment_date,
 count(p.id) payment_count
from public.procurement_reception_settlements s
left join public.rcn_proc_bons_payer b on b.purchase_settlement_id=s.id
left join public.rcn_proc_paiements p on p.bon_payer_id=b.id
group by s.id,s.purchase_code,b.id,b.statut,b.facture_ref,b.facture_date,s.amount_approved,s.status;

grant select on public.procurement_v_purchase_finance to authenticated;

-- Supplier-purchase register with Warehouse/Quality/Finance in one read model.
create or replace view public.procurement_v_supplier_purchase_register
with (security_invoker=true) as
select
 s.id purchase_id,s.purchase_code,
 coalesce(s.submitted_at,s.created_at,r.arrival_at) purchase_at,
 s.procurement_channel,s.purchase_type,s.campaign,
 r.supplier_code,r.supplier_name,r.id reception_id,r.warehouse_id,r.warehouse_code,r.warehouse_name,
 r.origin,r.truck,r.bags,r.net_kg warehouse_net_kg,
 s.refraction_mode,s.refraction_value,s.refraction_kg,s.refraction_reason,s.paid_weight_kg,
 r.sampling_kor,r.sampling_moisture,r.final_kor,r.final_moisture,
 case when r.final_id is not null then 'FINAL' when r.sampling_id is not null then 'SAMPLING' else null end quality_source,
 s.price_ref,s.reference_price,s.negotiated_price,s.submitted_price,s.approved_price,
 coalesce(s.approved_price,s.submitted_price,s.negotiated_price) effective_price,
 s.amount_submitted,s.amount_approved,
 s.status approval_status,s.price_exception,s.price_exception_pct,s.quality_exception,s.quality_exception_reason,
 s.created_by_name,s.submitted_by_name,s.approved_by_name,s.submitted_at,s.approved_at,s.decision_reason,
 f.bap_id,f.bap_status,f.amount_paid,f.outstanding_amount,f.payment_status,f.last_payment_date,
 case
   when r.status='REJECTED' then 'REJECTED_TRUCK'
   when r.net_kg is null then 'MISSING_NET_WEIGHT'
   when r.final_id is null then 'MISSING_FINAL_QUALITY'
   when s.status='DRAFT' then 'AWAITING_SUBMISSION'
   when s.status='CHANGES_REQUESTED' then 'CHANGES_REQUESTED'
   when s.status='SUBMITTED' then 'AWAITING_APPROVAL'
   when s.status='APPROVED' and f.bap_id is null then 'APPROVED_AWAITING_BAP'
   when s.status='APPROVED' and f.payment_status in ('UNPAID','PENDING','PARTIAL') then 'AWAITING_PAYMENT'
   else null
 end action_required
from public.procurement_reception_settlements s
join public.wms_v_receptions r on r.id=s.reception_id
left join public.procurement_v_purchase_finance f on f.purchase_id=s.id;

grant select on public.procurement_v_supplier_purchase_register to authenticated;

-- Field Buying is summarized by evacuation at Procurement level; source purchases remain immutable in achats.
create or replace view public.procurement_v_field_purchase_summary
with (security_invoker=true) as
select
 fs.id shipment_id,fs.shipment_code,
 fs.departed_at purchase_at,'FIELD_BUYING'::text procurement_channel,'FIELD_BUYING'::text purchase_type,
 fs.origin_label,fs.destination_label,fs.vehicle_plate,
 count(distinct flc.achat_id) producer_purchase_count,
 count(distinct a.producteur_id) producer_count,
 string_agg(distinct a.cluster,', ' order by a.cluster) clusters,
 string_agg(distinct a.village_nom,', ' order by a.village_nom) villages,
 sum(flc.qty_kg)::numeric field_weight_kg,
 sum(coalesce(a.montant,0) * (flc.qty_kg/nullif(a.poids_net,0)))::numeric field_purchase_value,
 r.id reception_id,r.warehouse_code,r.net_kg warehouse_net_kg,
 case when r.net_kg is null then null else round(r.net_kg-sum(flc.qty_kg),3) end variance_kg,
 case when r.net_kg is null or sum(flc.qty_kg)=0 then null
      else round((r.net_kg-sum(flc.qty_kg))*100.0/sum(flc.qty_kg),3) end variance_pct,
 case when r.id is null then 'AWAITING_WAREHOUSE_RECEPTION'
      when r.net_kg is null then 'AWAITING_WEIGHING'
      when abs(r.net_kg-sum(flc.qty_kg))<=0.001 then 'BALANCED'
      else 'VARIANCE_REVIEW' end reconciliation_status
from public.field_shipments fs
join public.field_shipment_lots fsl on fsl.shipment_id=fs.id
join public.field_lot_contributors flc on flc.lot_id=fsl.lot_id and flc.status='ACTIVE'
join public.achats a on a.id=flc.achat_id
left join public.wms_v_receptions r on r.field_shipment_id=fs.id
where fs.status not in ('DRAFT','CANCELLED')
group by fs.id,fs.shipment_code,fs.departed_at,fs.origin_label,fs.destination_label,fs.vehicle_plate,
         r.id,r.warehouse_code,r.net_kg;

grant select on public.procurement_v_field_purchase_summary to authenticated;

-- Work queue includes supplier receptions not yet settled.
create or replace view public.procurement_v_purchase_action_queue
with (security_invoker=true) as
select
 'READY_FOR_SETTLEMENT'::text action_type,r.reception_id object_id,r.reception_id reference,
 r.procurement_channel,r.supplier_name counterparty,r.warehouse_code,
 r.net_kg qty_kg,null::numeric amount,r.arrival_at event_at
from public.procurement_v_ready_supplier_receptions r
where r.purchase_readiness='READY_FOR_SETTLEMENT'
union all
select
 coalesce(p.action_required,'NONE'),p.purchase_id::text,p.purchase_code,p.procurement_channel,p.supplier_name,
 p.warehouse_code,p.paid_weight_kg,coalesce(p.amount_approved,p.amount_submitted),p.purchase_at
from public.procurement_v_supplier_purchase_register p
where p.action_required is not null;

grant select on public.procurement_v_purchase_action_queue to authenticated;

-- Deprecated stored payment fields are no longer authoritative.
create or replace view public.procurement_v_settlements_with_derived_payment
with (security_invoker=true) as
select s.*,f.bap_id,f.bap_status,f.amount_paid,f.outstanding_amount,f.payment_status derived_payment_status,f.last_payment_date
from public.procurement_reception_settlements s
left join public.procurement_v_purchase_finance f on f.purchase_id=s.id;

grant select on public.procurement_v_settlements_with_derived_payment to authenticated;

-- Write privileges only via RPC.
do $$
declare f regprocedure;
begin
 foreach f in array array[
  'public.procurement_submit_bap(text,text,date,text)'::regprocedure,
  'public.procurement_decide_bap(text,boolean,text)'::regprocedure,
  'public.procurement_record_payment(text,numeric,text,date,text,text,text,text)'::regprocedure,
  'public.procurement_reconcile_payment(text,boolean,text)'::regprocedure
 ] loop
   execute format('revoke all on function %s from public,anon',f);
   execute format('grant execute on function %s to authenticated',f);
 end loop;
end $$;

commit;
