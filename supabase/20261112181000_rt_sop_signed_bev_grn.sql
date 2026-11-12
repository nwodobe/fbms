-- AFLP SOP 2027 · Phase 2 : preuve RT/UH, BEV signe et GRN rapproche.
-- DDL pour staging uniquement; aucun mouvement reel ni paiement.
begin;

create table public.rt_sop_bev (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 origin_id text not null,
 origin_label text not null,
 destination_type text not null check(destination_type in ('WAREHOUSE','FACTORY')),
 destination_id text,
 destination_label text not null,
 bev_code text not null unique,
 qty_kg numeric(14,3) not null check(qty_kg>0),
 bags_count integer not null check(bags_count>0),
 vehicle_plate text not null,
 transporter text not null,
 driver_name text not null,
 signed_rt_and_transporter_proof text not null,
 uh_attested_by uuid not null references auth.users(id),
 uh_attested_at timestamptz not null default now(),
 signed_at timestamptz not null,
 idempotency_key uuid not null unique,
 created_at timestamptz not null default now(),
 check(length(btrim(bev_code))>=5),
 check(length(btrim(transporter))>=3),
 check(length(btrim(vehicle_plate))>=4),
 check(signed_at<=created_at+interval '1 day')
);
create index rt_sop_bev_rt on public.rt_sop_bev(rt_id,campaign_id,created_at desc);

alter table public.field_shipments
 add column if not exists sop_bev_id uuid unique references public.rt_sop_bev(id);

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

-- Existing evacuation RPC remains canonical.
-- Reject new village DISPATCHED shipments that do not carry a verified BEV
-- *before* the pre-existing trigger inserts field_stock_movements.
create or replace function private.rt_sop_guard_shipment_dispatch()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare b public.rt_sop_bev%rowtype;
begin
 if new.origin_type<>'VILLAGE' or new.status<>'DISPATCHED' then return new; end if;
 if nullif(btrim(coalesce(new.document_ref,'')),'') is null then
    raise exception 'BEV signe obligatoire avant sortie du village' using errcode='23514';
 end if;
 select * into b from public.rt_sop_bev
 where bev_code=upper(btrim(new.document_ref)) for key share;
 if not found then
   raise exception 'BEV introuvable ou non atteste' using errcode='23514';
 end if;
 if b.campaign_id is distinct from new.campaign_id
    or b.origin_id is distinct from new.origin_id
    or b.destination_type is distinct from new.destination_type
    or (b.destination_type='WAREHOUSE' and b.destination_id is distinct from new.destination_id)
    or upper(regexp_replace(b.vehicle_plate,'\s+','','g')) is distinct from upper(regexp_replace(new.vehicle_plate,'\s+','','g'))
    or abs(b.qty_kg-new.dispatched_qty_kg)>0.01 then
     raise exception 'BEV et expedition differents: verifier campagne, origine, destination, camion, kg';
 end if;
 new.sop_bev_id:=b.id;
 return new;
end $$;

drop trigger if exists trg_050_rt_sop_bev_required on public.field_shipments;
create trigger trg_050_rt_sop_bev_required
before insert on public.field_shipments
for each row execute function private.rt_sop_guard_shipment_dispatch();

-- This is *additional* GRN certification. Existing WMS offload remains possible.
-- A shipment with SOP BEV may only reach terminal RECEIVED/CLOSED after an official GRN.
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

drop trigger if exists trg_051_rt_sop_grn_final on public.field_shipments;
create trigger trg_051_rt_sop_grn_final
before update of status on public.field_shipments
for each row execute function private.rt_sop_guard_grn_final();

-- Keep existing WMS and shipment ledgers; expose a single proof-backed audit view.
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

alter table public.rt_sop_bev enable row level security;
create policy rt_sop_bev_read on public.rt_sop_bev for select to authenticated
using(private.rt_sop_can_read_rt(rt_id));
revoke all on public.rt_sop_bev from public,anon,authenticated;
grant select on public.rt_sop_bev to authenticated;
revoke all on public.rt_sop_bev_grn_v from public,anon;
grant select on public.rt_sop_bev_grn_v to authenticated;

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

revoke all on function public.rt_sop_register_signed_bev(uuid,text,text,text,text,text,text,text,numeric,integer,text,text,text,text,timestamptz,uuid)
 from public,anon;
revoke all on function public.rt_sop_weekly_sign(uuid,text,date,date,jsonb,text,text,text,uuid,uuid)
 from public,anon;
grant execute on function public.rt_sop_register_signed_bev(uuid,text,text,text,text,text,text,text,numeric,integer,text,text,text,text,timestamptz,uuid) to authenticated;
grant execute on function public.rt_sop_weekly_sign(uuid,text,date,date,jsonb,text,text,text,uuid,uuid) to authenticated;
commit;