-- RETOUR ARRIÈRE de 20261112190000_rt_sop_conformite_corrections.sql
-- Restaure exactement l'état de la PR #311 (définitions extraites automatiquement de ses migrations).
-- Refuse de s'exécuter si les nouveaux registres contiennent des lignes, sauf :
--   set rt_sop.force_rollback = 'on';   (décision écrite BM + Finance, sauvegarde préalable)
begin;
do $$ begin
 if coalesce(current_setting('rt_sop.force_rollback', true),'') <> 'on' and (
    exists(select 1 from public.rt_sop_cash_events) or exists(select 1 from public.rt_sop_incident_links)
    or exists(select 1 from public.rt_sop_zh_controls) or exists(select 1 from public.rt_sop_bev_lots)
    or exists(select 1 from public.rt_sop_suspensions)) then
   raise exception 'Retour arrière refusé : registres SOP non vides (sauvegarder puis forcer explicitement)';
 end if;
end $$;
drop view if exists public.rt_sop_rt_dashboard_v, public.rt_sop_jute_card_v, public.rt_sop_jute_history_v,
  public.rt_sop_weekly_status_v, public.rt_sop_rcn_custody_v, public.rt_sop_alerts_v, public.rt_sop_cash_balance_v,
  public.rt_sop_bev_grn_v, public.rt_sop_purchase_state_v;
drop trigger if exists trg_fa_rt_sop_lock_cash on public.achats;
drop trigger if exists trg_fa_rt_sop_lock_cash on public.avances;
drop trigger if exists trg_051_rt_sop_protect_advance on public.avances;
drop trigger if exists trg_052_rt_sop_freeze_reviewed on public.achats;
drop function if exists private.rt_sop_freeze_reviewed_purchase();
drop function if exists private.rt_sop_lock_rt_cash(), private.rt_sop_protect_posted_advance();
drop function if exists public.rt_sop_open_incident(uuid,text,text,text,text,text,text,text,text[],uuid),
  public.rt_sop_close_incident(text,text,text,text), public.rt_sop_record_zh_control(uuid,text,text,text,text,text,uuid),
  public.rt_sop_record_cash_event(uuid,text,text,numeric,text,text,text,uuid), public.rt_sop_finance_reject(uuid,text),
  public.rt_sop_bev_complete(uuid,uuid[],text,text,text),
  private.rt_sop_open_incident_core(uuid,text,text,text,text,text,text,text,text,text,uuid),
  private.rt_sop_assert_not_suspended(uuid,text,text);
drop table if exists public.rt_sop_bev_lots, public.rt_sop_zh_controls, public.rt_sop_suspensions,
  public.rt_sop_incident_links, public.rt_sop_cash_events;
alter table public.rt_sop_weekly_signoffs drop column if exists server_snapshot, drop column if exists incident_id;
alter table public.rt_sop_bev drop column if exists handed_over_by_name, drop column if exists received_by_name,
  drop column if exists handover_reserves, drop column if exists completed_by, drop column if exists completed_at;
alter table public.rt_sop_funding_requests drop column if exists rejected_by, drop column if exists rejected_at, drop column if exists rejection_reason;
drop index if exists public.rt_sop_reviews_seq, public.rt_sop_reviews_latest_seq;
alter table public.rt_sop_purchase_reviews drop column if exists review_seq;
drop function if exists private.rt_sop_finance_roles();
-- Définitions de la PR #311 (verbatim)

create or replace function public.rt_sop_request_funding(
 p_campaign_id uuid,p_rt_id text,p_amount_fcfa numeric,p_plan text,
 p_wave_account_ref text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v public.rt_sop_funding_requests%rowtype;
begin
 perform private.rt_sop_require_role(array['Branch Manager'],p_rt_id);
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into v from public.rt_sop_funding_requests where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'status',v.status,'replay',true); end if;
 if p_amount_fcfa is null or p_amount_fcfa<=0 or length(btrim(coalesce(p_plan,'')))<8
    or length(btrim(coalesce(p_wave_account_ref,'')))<4 then
    raise exception 'Montant, plan d''achat et compte Wave dédiés requis';
 end if;
 if not exists(select 1 from public.campaigns where id=p_campaign_id and status='OPEN') then
    raise exception 'Campagne non ouverte';
 end if;
 insert into public.rt_sop_funding_requests
   (campaign_id,rt_id,amount_fcfa,purchase_plan,wave_account_ref,requested_by,idempotency_key)
 values(p_campaign_id,p_rt_id,p_amount_fcfa,p_plan,p_wave_account_ref,auth.uid(),p_key)
 returning * into v;
 return jsonb_build_object('id',v.id,'status',v.status,'replay',false);
end $$;

create or replace function public.rt_sop_rt_acknowledge(
 p_id uuid,p_rt_signed_path text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v public.rt_sop_funding_requests%rowtype;
begin
 select * into v from public.rt_sop_funding_requests where id=p_id for update;
 if not found then raise exception 'Demande Wave introuvable'; end if;
 perform private.rt_sop_require_role(array['Unit Head','Branch Manager'],v.rt_id);
 if v.status='RT_ACK' and v.rt_ack_proof_path=p_rt_signed_path then
   return jsonb_build_object('id',v.id,'status',v.status,'replay',true);
 end if;
 if v.status<>'FINANCE_SENT' then
   raise exception 'L''UH ne peut attester que les versements confirmés par Finance';
 end if;
 if not private.rt_sop_proof_exists(v.rt_id,p_rt_signed_path) then
   raise exception 'Photo de la réception Wave signée par le RT requise';
 end if;
 update public.rt_sop_funding_requests set status='RT_ACK',
   rt_ack_proof_path=p_rt_signed_path,rt_ack_at=now(),rt_ack_witness=auth.uid()
 where id=v.id;
 return jsonb_build_object('id',v.id,'status','RT_ACK');
end $$;

create or replace function public.rt_sop_review_purchase(
 p_achat_id uuid,p_decision text,p_receipt_ref text,p_payment_ref text,
 p_evidence_path text,p_reason text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare a public.achats%rowtype; r public.rt_sop_purchase_reviews%rowtype;
        v_name text; v_balance numeric; v_existing numeric;
begin
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into r from public.rt_sop_purchase_reviews where idempotency_key=p_key;
 if found then return jsonb_build_object('id',r.id,'decision',r.decision,'replay',true); end if;
 select * into a from public.achats where id=p_achat_id for update;
 if not found then raise exception 'Achat introuvable'; end if;
 perform private.rt_sop_require_role(array['Unit Head'],a.rt_id);
 if a.campaign_id is null or a.rt_id is null or a.rejet=true
   then raise exception 'Achat incomplet ou rejeté'; end if;
 if p_decision not in ('APPROVED','REJECTED') then raise exception 'Décision UH invalide'; end if;
 if p_decision='APPROVED' and (
   nullif(btrim(coalesce(p_receipt_ref,'')),'') is null
   or nullif(btrim(coalesce(p_payment_ref,'')),'') is null
   or a.numero_recu is null or not private.rt_sop_proof_exists(a.rt_id,p_evidence_path))
   then raise exception 'Reçu et preuve du paiement exigés pour valider un achat'; end if;
 if p_decision='REJECTED' and length(btrim(coalesce(p_reason,'')))<5 then
   raise exception 'Motif de rejet obligatoire';
 end if;
 -- Advisory serialization of cash account movements for the same RT and campaign.
 perform pg_advisory_xact_lock(hashtextextended(a.campaign_id::text||':'||a.rt_id,0));
 if p_decision='APPROVED' then
   select coalesce(sum(case when status='POSTED' then amount_fcfa else 0 end),0)
   into v_balance from public.rt_sop_funding_requests
    where campaign_id=a.campaign_id and rt_id=a.rt_id;
   select coalesce(sum(amount_fcfa),0) into v_existing
    from public.rt_sop_refunds where campaign_id=a.campaign_id and rt_id=a.rt_id;
   v_balance:=v_balance-v_existing;
   select coalesce(sum(x.montant),0) into v_existing from (
      select distinct on (rev.achat_id) rev.achat_id,rev.decision,ac.montant
      from public.rt_sop_purchase_reviews rev join public.achats ac on ac.id=rev.achat_id
      where rev.rt_id=a.rt_id and rev.campaign_id=a.campaign_id
      order by rev.achat_id,rev.created_at desc,rev.id desc
   ) x where x.decision='APPROVED' and x.achat_id<>a.id;
   if v_balance-v_existing<a.montant then raise exception 'Avance confirmée insuffisante pour cet achat'; end if;
 end if;
 insert into public.rt_sop_purchase_reviews
    (achat_id,campaign_id,rt_id,decision,receipt_ref,payment_ref,
     evidence_path,reason,reviewed_by,idempotency_key)
 values (a.id,a.campaign_id,a.rt_id,p_decision,
     coalesce(nullif(btrim(p_receipt_ref),''),'Non applicable'),
     coalesce(nullif(btrim(p_payment_ref),''),'Non applicable'),
     coalesce(p_evidence_path,''),p_reason,auth.uid(),p_key) returning * into r;
 if p_decision='APPROVED' then
    select nom into v_name from public.profils where user_id=auth.uid() and actif=true;
    update public.achats set statut_validation='Validé',
      validated_by=v_name,validated_at=now()
    where id=a.id;
 end if;
 return jsonb_build_object('id',r.id,'decision',r.decision,'replay',false);
end $$;

create or replace function public.rt_sop_refund(
 p_campaign_id uuid,p_rt_id text,p_amount numeric,p_payment_ref text,
 p_evidence_path text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v public.rt_sop_refunds%rowtype; v_total numeric; v_validated numeric;
begin
 perform private.rt_sop_require_role(array['Finance','Finance Officer','Finance Manager','Accountant','Comptable'],p_rt_id);
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into v from public.rt_sop_refunds where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'replay',true); end if;
 if p_amount is null or p_amount<=0 or length(btrim(coalesce(p_payment_ref,'')))<5
    or not private.rt_sop_proof_exists(p_rt_id,p_evidence_path)
    then raise exception 'Montant, référence et preuve de restitution obligatoires'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text||':'||p_rt_id,0));
 select coalesce(sum(amount_fcfa),0) into v_total
 from public.rt_sop_funding_requests
 where campaign_id=p_campaign_id and rt_id=p_rt_id and status='POSTED';
 select coalesce(sum(amount_fcfa),0) into v_validated
 from public.rt_sop_refunds where campaign_id=p_campaign_id and rt_id=p_rt_id;
 v_total:=v_total-v_validated;
 select coalesce(sum(x.montant),0) into v_validated from (
   select distinct on (rev.achat_id) rev.achat_id,rev.decision,ac.montant
   from public.rt_sop_purchase_reviews rev join public.achats ac on ac.id=rev.achat_id
   where rev.rt_id=p_rt_id and rev.campaign_id=p_campaign_id
   order by rev.achat_id,rev.created_at desc,rev.id desc
 ) x where x.decision='APPROVED';
 if v_total-v_validated<p_amount then raise exception 'Restitution supérieure au solde non déchargé'; end if;
 insert into public.rt_sop_refunds
 (campaign_id,rt_id,amount_fcfa,payment_reference,evidence_path,confirmed_by,idempotency_key)
 values(p_campaign_id,p_rt_id,p_amount,trim(p_payment_ref),p_evidence_path,auth.uid(),p_key)
 returning * into v;
 return jsonb_build_object('id',v.id,'amount',v.amount_fcfa);
end $$;

create or replace function public.rt_sop_register_signed_bev(
 p_campaign_id uuid, p_rt_id text, p_origin_id text, p_origin_label text,
 p_destination_type text, p_destination_id text, p_destination_label text,
 p_bev_code text, p_qty_kg numeric, p_bags_count integer,
 p_vehicle_plate text, p_transporter text, p_driver text,
 p_proof_path text,p_signed_at timestamptz,p_key uuid)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v public.rt_sop_bev%rowtype; rt_row public.rt%rowtype;
begin
 perform private.rt_sop_require_role(array['Unit Head'],p_rt_id);
 if p_key is null then raise exception 'Identifiant unique obligatoire'; end if;
 select * into v from public.rt_sop_bev where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'bev_code',v.bev_code,'replay',true); end if;
 select * into rt_row from public.rt where id=p_rt_id and deleted=false;
 if not found then raise exception 'RT introuvable'; end if;
 if p_origin_id is distinct from rt_row.village_id then
    raise exception 'Village origine different du village rattache au RT';
 end if;
 if not exists(select 1 from public.campaigns where id=p_campaign_id and status='OPEN') then
    raise exception 'Campagne non ouverte';
 end if;
 if not private.rt_sop_proof_exists(p_rt_id,p_proof_path) then
    raise exception 'BEV signe RT/prestataire et contresigne UH obligatoire';
 end if;
 if p_qty_kg is null or p_qty_kg<=0 or p_bags_count is null or p_bags_count<=0
    or p_signed_at is null or p_signed_at>now()+interval '5 minutes' then
    raise exception 'Quantite, sacs ou date de signature invalides';
 end if;
 if upper(btrim(p_destination_type)) not in ('FACTORY','WAREHOUSE') then
    raise exception 'Destination invalide';
 end if;
 insert into public.rt_sop_bev(
  campaign_id,rt_id,origin_id,origin_label,destination_type,destination_id,
  destination_label,bev_code,qty_kg,bags_count,vehicle_plate,transporter,
  driver_name,signed_rt_and_transporter_proof,uh_attested_by,signed_at,idempotency_key)
 values(p_campaign_id,p_rt_id,p_origin_id,btrim(p_origin_label),upper(btrim(p_destination_type)),
  nullif(btrim(p_destination_id),''),btrim(p_destination_label),upper(btrim(p_bev_code)),
  p_qty_kg,p_bags_count,upper(btrim(p_vehicle_plate)),btrim(p_transporter),
  btrim(p_driver),p_proof_path,auth.uid(),p_signed_at,p_key)
 returning * into v;
 return jsonb_build_object('id',v.id,'bev_code',v.bev_code,'status','SIGNED_EVIDENCE_REGISTERED');
end $$;

create or replace function public.rt_sop_weekly_sign(
 p_campaign_id uuid,p_rt_id text,p_period_start date,p_period_end date,
 p_snapshot jsonb,p_rt_decision text,p_rt_reservations text,
 p_signed_proof_path text,p_supersedes_id uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v public.rt_sop_weekly_signoffs%rowtype; previous_id uuid;
        v_hash text; v_balance numeric; v_funding numeric;
begin
 perform private.rt_sop_require_role(array['Unit Head'],p_rt_id);
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into v from public.rt_sop_weekly_signoffs where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'replay',true); end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start
    or p_period_end>p_period_start+6 then raise exception 'Periode de 7 jours maximum'; end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or not(p_snapshot ?& array['rcn_kg','reste_a_justifier_fcfa','sacs_vides','sacs_pleins','pieces'])
    then raise exception 'Les trois cartes et les pieces sont obligatoires'; end if;
 if p_rt_decision not in ('AGREED','RESERVED','DISAGREED') then raise exception 'Avis RT invalide'; end if;
 if p_rt_decision<>'AGREED' and length(btrim(coalesce(p_rt_reservations,'')))<5 then
    raise exception 'Motif des reserves ou du desaccord obligatoire';
 end if;
 if not private.rt_sop_proof_exists(p_rt_id,p_signed_proof_path) then
    raise exception 'Fiche hebdomadaire avec signatures manuscrites RT et UH exigee';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text||':'||p_rt_id||':'||p_period_start::text,1));
 select id into previous_id from public.rt_sop_weekly_signoffs
  where campaign_id=p_campaign_id and rt_id=p_rt_id and period_start=p_period_start
  order by signed_at desc,id desc limit 1;
 if previous_id is distinct from p_supersedes_id then
   raise exception 'Reprise ou version du bilan incorrecte';
 end if;
 -- Verify the financial number against the canonical ledger before freezing a snapshot.
 select reste_a_justifier_fcfa into v_balance from public.rt_sop_cash_balance_v
 where rt_id=p_rt_id and campaign_id=p_campaign_id;
 if v_balance is distinct from nullif(p_snapshot->>'reste_a_justifier_fcfa','')::numeric then
    raise exception 'Le solde financier ne correspond pas au ledger verifie';
 end if;
 -- No claim that photo alone cryptographically proves the RT's identity.
 v_hash:=encode(extensions.digest(p_snapshot::text,'sha256'),'hex');
 insert into public.rt_sop_weekly_signoffs(
   campaign_id,rt_id,period_start,period_end,snapshot,snapshot_sha256,
   rt_decision,rt_reservations,signed_proof_path,uh_signed_by,
   supersedes_id,idempotency_key)
 values(p_campaign_id,p_rt_id,p_period_start,p_period_end,p_snapshot,v_hash,
   p_rt_decision,p_rt_reservations,p_signed_proof_path,auth.uid(),p_supersedes_id,p_key)
 returning * into v;
 return jsonb_build_object('id',v.id,'snapshot_hash',v.snapshot_sha256,'replay',false);
end $$;

create or replace function private.rt_sop_guard_shipment_dispatch()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.rt_sop_bev%rowtype;
begin
 if not private.rt_sop_is_real_2027(new.campaign_id)
    or new.origin_type<>'VILLAGE' or new.status<>'DISPATCHED' then return new; end if;
 if nullif(btrim(coalesce(new.document_ref,'')),'') is null then
    raise exception 'AFLP 2027: BEV signe obligatoire avant sortie du village' using errcode='23514';
 end if;
 select * into b from public.rt_sop_bev where bev_code=upper(btrim(new.document_ref))
 for key share;
 if not found then raise exception 'BEV introuvable ou non atteste'; end if;
 if b.campaign_id is distinct from new.campaign_id or b.origin_id is distinct from new.origin_id
    or b.destination_type is distinct from new.destination_type
    or (b.destination_type='WAREHOUSE' and b.destination_id is distinct from new.destination_id)
    or upper(regexp_replace(b.vehicle_plate,'\s+','','g')) is distinct from
        upper(regexp_replace(new.vehicle_plate,'\s+','','g'))
    or abs(b.qty_kg-new.dispatched_qty_kg)>0.01 then
     raise exception 'Le BEV ne correspond pas aux donnees du camion'; end if;
 new.sop_bev_id:=b.id;
 return new;
end $$;

create or replace function private.rt_sop_guard_grn_final()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
begin
 if new.sop_bev_id is null then return new; end if;
 if new.status in ('RECEIVED','CLOSED') and old.status is distinct from new.status then
    if not exists (
      select 1 from public.wms_receptions wr
      join public.wms_grns grn on grn.reception_id=wr.id
      where wr.field_shipment_id=new.id and wr.net_kg is not null
        and grn.issued_at is not null and grn.issued_by is not null
        and upper(coalesce(grn.status,'')) not in ('CANCELLED','VOID','DRAFT')
    ) then raise exception 'Reception finale impossible: GRN officiel manquant'; end if;
 end if;
 return new;
end $$;

create or replace function private.rt_sop_guard_purchase_credit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_credit numeric;v_spend numeric;v_refunds numeric;
begin
 if not private.rt_sop_is_real_2027(new.campaign_id) or new.rt_id is null then return new; end if;
 if coalesce(new.rejet,false) then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.campaign_id::text||':'||new.rt_id,0));
 select coalesce(sum(amount_fcfa),0) into v_credit
 from public.rt_sop_funding_requests
 where campaign_id=new.campaign_id and rt_id=new.rt_id and status='POSTED';
 select coalesce(sum(montant),0) into v_spend
 from public.achats where campaign_id=new.campaign_id and rt_id=new.rt_id
 and coalesce(rejet,false)=false and id is distinct from new.id;
 select coalesce(sum(amount_fcfa),0) into v_refunds
 from public.rt_sop_refunds where campaign_id=new.campaign_id and rt_id=new.rt_id;
 if v_spend+new.montant+v_refunds>v_credit then
    raise exception 'AFLP 2027: achats et restitutions > fonds Wave reellement confirmes';
 end if;
 return new;
end $$;

create or replace function private.rt_sop_restore_review_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.decision='REJECTED' then
   update public.achats
   set statut_validation='À contrôler',validated_by=null,validated_at=null
   where id=new.achat_id and statut_validation='Validé';
 end if;
 return new;
end $$;

create view public.rt_sop_cash_balance_v with(security_invoker=true) as
with latest as (
 select distinct on (r.achat_id) r.achat_id,r.rt_id,r.campaign_id,r.decision,a.montant
 from public.rt_sop_purchase_reviews r join public.achats a on a.id=r.achat_id
 order by r.achat_id,r.created_at desc,r.id desc
), movements as (
 select campaign_id,rt_id,amount_fcfa as credit,0::numeric as debit,0::numeric as returned
 from public.rt_sop_funding_requests where status='POSTED'
 union all
 select campaign_id,rt_id,0::numeric, case when decision='APPROVED' then montant else 0 end,0::numeric
 from latest
 union all
 select campaign_id,rt_id,0::numeric,0::numeric,amount_fcfa from public.rt_sop_refunds
)
select campaign_id,rt_id,sum(credit) as avances_confirmees_fcfa,
 sum(debit) as achats_uh_fcfa,sum(returned) as restitutions_fcfa,
 sum(credit)-sum(debit)-sum(returned) as reste_a_justifier_fcfa
from movements group by campaign_id,rt_id;

revoke all on public.rt_sop_cash_balance_v from public,anon;
grant select on public.rt_sop_cash_balance_v to authenticated;

create view public.rt_sop_bev_grn_v with(security_invoker=true) as
select b.id as bev_id,b.campaign_id,b.rt_id,b.bev_code,b.qty_kg as signed_bev_kg,
  b.bags_count,b.transporter,b.vehicle_plate,b.driver_name,
  b.uh_attested_at,b.signed_rt_and_transporter_proof,
  s.id as shipment_id,s.shipment_code,s.status as shipment_status,s.dispatched_qty_kg,
  w.id as reception_id,w.net_kg as physical_net_received_kg,w.weighbridge_ticket,
  g.id as grn_id,g.status as grn_status,g.issued_at as grn_issued_at,
  case when g.id is not null and g.issued_at is not null
       then round(coalesce(w.net_kg,0)-b.qty_kg,3)
       else null::numeric end as delta_bev_vs_received_kg,
  case when s.id is null then 'BEV_SIGNED_WAITING_DISPATCH'
       when w.id is null then 'IN_TRANSIT'
       when g.id is null or g.issued_at is null then 'OFFLOADED_WAITING_GRN'
       when abs(coalesce(w.net_kg,0)-b.qty_kg)>0.01 then 'GRN_VARIANCE_REVIEW'
       else 'GRN_MATCHED' end as audit_status
from public.rt_sop_bev b
left join public.field_shipments s on s.sop_bev_id=b.id
left join lateral(select w.* from public.wms_receptions w
  where w.field_shipment_id=s.id order by w.created_at desc,w.id desc limit 1) w on true
left join lateral(select g.* from public.wms_grns g
  where g.reception_id=w.id and g.issued_at is not null
  order by g.issued_at desc,g.id desc limit 1) g on true;

revoke all on public.rt_sop_bev_grn_v from public,anon;
grant select on public.rt_sop_bev_grn_v to authenticated;

drop trigger if exists trg_050_rt_sop_bev_required on public.field_shipments;
create trigger trg_050_rt_sop_bev_required before insert on public.field_shipments
for each row execute function private.rt_sop_guard_shipment_dispatch();
commit;
