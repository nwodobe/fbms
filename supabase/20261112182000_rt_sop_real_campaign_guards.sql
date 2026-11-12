-- AFLP 2027 · Phase 3: enforcement on the REAL 2027 campaign only.
-- Guard the existing credit and purchasing tables, without rewriting older campaigns.
-- Validate in staging first: this intentionally blocks legacy cash entry for real 2027.
begin;
create or replace function private.rt_sop_is_real_2027(p_campaign_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
 select exists(select 1 from public.campaigns
   where id=p_campaign_id and year=2027 and campaign_type='REAL')
$$;
revoke all on function private.rt_sop_is_real_2027(uuid) from public,anon,authenticated;

create or replace function private.rt_sop_guard_credit()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
declare r public.rt_sop_funding_requests%rowtype;
begin
 if not private.rt_sop_is_real_2027(new.campaign_id) then return new; end if;
 if new.sop_funding_request_id is null then
    raise exception 'AFLP 2027: Finance doit confirmer Wave et le RT avant une avance';
 end if;
 select * into r from public.rt_sop_funding_requests where id=new.sop_funding_request_id;
 if not found or r.status<>'RT_ACK' or r.campaign_id is distinct from new.campaign_id
 or r.rt_id is distinct from new.rt_id or r.amount_fcfa is distinct from new.montant
 or r.finance_by is null or r.rt_ack_at is null or r.finance_proof_path is null
 or r.rt_ack_proof_path is null
 then raise exception 'Financement Wave non justifie pour cette avance'; end if;
 return new;
end $$;
drop trigger if exists trg_050_rt_sop_credit_guard on public.avances;
create trigger trg_050_rt_sop_credit_guard before insert on public.avances
for each row execute function private.rt_sop_guard_credit();

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
 and coalesce(rejet,false)=false and id<>new.id;
 select coalesce(sum(amount_fcfa),0) into v_refunds
 from public.rt_sop_refunds where campaign_id=new.campaign_id and rt_id=new.rt_id;
 if v_spend+new.montant+v_refunds>v_credit then
    raise exception 'AFLP 2027: achats et restitutions > fonds Wave reellement confirmes';
 end if;
 return new;
end $$;
drop trigger if exists trg_zzzzz_rt_sop_purchase_guard on public.achats;
create trigger trg_zzzzz_rt_sop_purchase_guard
before insert or update of montant,rt_id,rejet,campaign_id on public.achats
for each row execute function private.rt_sop_guard_purchase_credit();

-- Side effects prevented: after a final UH approval, later rejection must revert UI status.
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
drop trigger if exists trg_rt_sop_purchase_review_status on public.rt_sop_purchase_reviews;
create trigger trg_rt_sop_purchase_review_status
after insert on public.rt_sop_purchase_reviews for each row
execute function private.rt_sop_restore_review_status();

-- Only new village shipments in the actual campaign require mandatory SOP BEV.
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
commit;