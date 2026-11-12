-- AFLP 2027 · SOP RT · Phase 1: finances, justificatifs, rapprochement
-- VERSION POUR REVUE/STAGING. Ne jamais appliquer automatiquement sur la production.
-- Aucune ecriture dans les tables existantes n'est executee par cette migration (DDL seulement).
begin;

create table public.rt_sop_funding_requests (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 amount_fcfa numeric(16,2) not null check (amount_fcfa>0),
 purchase_plan text not null check (length(btrim(purchase_plan))>=8),
 wave_account_ref text not null check (length(btrim(wave_account_ref))>=4),
 requested_by uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 status text not null default 'REQUESTED'
    check(status in ('REQUESTED','FINANCE_SENT','RT_ACK','POSTED','REJECTED')),
 wave_reference text unique,
 finance_proof_path text,
 finance_by uuid references auth.users(id),
 finance_at timestamptz,
 rt_ack_proof_path text,
 rt_ack_witness uuid references auth.users(id),
 rt_ack_at timestamptz,
 posted_advance_id uuid unique references public.avances(id),
 idempotency_key uuid not null unique,
 created_at timestamptz not null default now()
);
create index rt_sop_funding_rt_campaign on public.rt_sop_funding_requests(rt_id,campaign_id,created_at desc);

alter table public.avances
 add column if not exists sop_funding_request_id uuid unique references public.rt_sop_funding_requests(id);

create table public.rt_sop_purchase_reviews (
 id uuid primary key default gen_random_uuid(),
 achat_id uuid not null references public.achats(id),
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 decision text not null check(decision in ('APPROVED','REJECTED')),
 receipt_ref text not null,
 payment_ref text not null,
 evidence_path text not null,
 reason text,
 reviewed_by uuid not null references auth.users(id),
 reviewed_at timestamptz not null default now(),
 idempotency_key uuid not null unique,
 created_at timestamptz not null default now()
);
create index rt_sop_reviews_latest on public.rt_sop_purchase_reviews(achat_id,created_at desc,id desc);
create index rt_sop_reviews_rt on public.rt_sop_purchase_reviews(rt_id,campaign_id);

create table public.rt_sop_refunds (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 amount_fcfa numeric(16,2) not null check(amount_fcfa>0),
 payment_reference text not null unique,
 evidence_path text not null,
 confirmed_by uuid not null references auth.users(id),
 confirmed_at timestamptz not null default now(),
 idempotency_key uuid not null unique
);
create index rt_sop_refunds_rt on public.rt_sop_refunds(rt_id,campaign_id);

create table public.rt_sop_weekly_signoffs (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 period_start date not null,
 period_end date not null,
 snapshot jsonb not null,
 snapshot_sha256 text not null,
 rt_decision text not null check(rt_decision in ('AGREED','RESERVED','DISAGREED')),
 rt_reservations text,
 signed_proof_path text not null,
 uh_signed_by uuid not null references auth.users(id),
 signed_at timestamptz not null default now(),
 supersedes_id uuid references public.rt_sop_weekly_signoffs(id),
 idempotency_key uuid not null unique,
 check(period_end>=period_start and period_end<=period_start+interval '6 days'),
 check(rt_decision='AGREED' or length(btrim(coalesce(rt_reservations,'')))>=5)
);
create index rt_sop_weekly_rt on public.rt_sop_weekly_signoffs(rt_id,campaign_id,period_start desc);

-- Private signed evidence: no public read, no UPDATE/DELETE policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rt-sop-evidence','rt-sop-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create or replace function private.rt_sop_active_role()
returns text language sql stable security definer set search_path=public,pg_temp
as $$
 select role from public.profils where user_id=auth.uid() and actif=true limit 1
$$;

create or replace function private.rt_sop_can_read_rt(p_rt_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
 select exists (
  select 1 from public.profils p join public.rt r on r.id=p_rt_id and r.deleted=false
  where p.user_id=auth.uid() and p.actif=true and
    (
      p.role in ('Branch Manager','Assistant Branch Manager','Zonal Head',
                 'Finance','Finance Officer','Finance Manager','Accountant','Comptable','Supervisor')
      or (p.role='Unit Head' and p.cluster is not null
          and upper(trim(p.cluster))=upper(trim(r.cluster)))
    )
 )
$$;

create or replace function private.rt_sop_require_role(p_roles text[],p_rt_id text default null)
returns void language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_role text;
begin
 v_role:=private.rt_sop_active_role();
 if v_role is null or v_role <> all(p_roles) then
   raise exception 'Droit SOP RT insuffisant pour ce mouvement' using errcode='42501';
 end if;
 if p_rt_id is not null and not private.rt_sop_can_read_rt(p_rt_id) then
   raise exception 'RT hors du périmètre autorisé' using errcode='42501';
 end if;
end $$;

create or replace function private.rt_sop_proof_exists(p_rt_id text,p_path text)
returns boolean language sql stable security definer set search_path=storage,public,pg_temp
as $$
 select p_path is not null
   and split_part(p_path,'/',1)=auth.uid()::text
   and split_part(p_path,'/',2)=p_rt_id
   and exists(select 1 from storage.objects where bucket_id='rt-sop-evidence'
          and name=p_path and owner_id=auth.uid()::text
          and coalesce((metadata->>'size')::numeric,0)<=10485760)
$$;

revoke all on function private.rt_sop_active_role() from public,anon,authenticated;
revoke all on function private.rt_sop_can_read_rt(text) from public,anon,authenticated;
revoke all on function private.rt_sop_require_role(text[],text) from public,anon,authenticated;
revoke all on function private.rt_sop_proof_exists(text,text) from public,anon,authenticated;
-- Called from definer RPCs and storage RLS policies, both evaluate as database owner.
grant execute on function private.rt_sop_can_read_rt(text) to authenticated;
grant execute on function private.rt_sop_active_role() to authenticated;

create policy rt_sop_evidence_upload on storage.objects for insert to authenticated
with check (bucket_id='rt-sop-evidence'
 and (storage.foldername(name))[1]=auth.uid()::text
 and private.rt_sop_can_read_rt((storage.foldername(name))[2])
 and lower(storage.extension(name)) in ('pdf','jpg','jpeg','png','webp'));

create policy rt_sop_evidence_read on storage.objects for select to authenticated
using (bucket_id='rt-sop-evidence'
 and private.rt_sop_can_read_rt((storage.foldername(name))[2]));

alter table public.rt_sop_funding_requests enable row level security;
alter table public.rt_sop_purchase_reviews enable row level security;
alter table public.rt_sop_refunds enable row level security;
alter table public.rt_sop_weekly_signoffs enable row level security;
create policy rt_sop_funding_read on public.rt_sop_funding_requests for select to authenticated
 using(private.rt_sop_can_read_rt(rt_id));
create policy rt_sop_reviews_read on public.rt_sop_purchase_reviews for select to authenticated
 using(private.rt_sop_can_read_rt(rt_id));
create policy rt_sop_refunds_read on public.rt_sop_refunds for select to authenticated
 using(private.rt_sop_can_read_rt(rt_id));
create policy rt_sop_weekly_read on public.rt_sop_weekly_signoffs for select to authenticated
 using(private.rt_sop_can_read_rt(rt_id));

revoke all on public.rt_sop_funding_requests,public.rt_sop_purchase_reviews,
 public.rt_sop_refunds,public.rt_sop_weekly_signoffs from public,anon,authenticated;
grant select on public.rt_sop_funding_requests,public.rt_sop_purchase_reviews,
 public.rt_sop_refunds,public.rt_sop_weekly_signoffs to authenticated;

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

create or replace function public.rt_sop_finance_confirm(
 p_id uuid,p_wave_reference text,p_proof_path text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v public.rt_sop_funding_requests%rowtype;
begin
 perform private.rt_sop_require_role(array['Finance','Finance Officer','Finance Manager','Accountant','Comptable']);
 select * into v from public.rt_sop_funding_requests where id=p_id for update;
 if not found then raise exception 'Demande Wave introuvable'; end if;
 if v.status='FINANCE_SENT' and v.wave_reference=p_wave_reference then
    return jsonb_build_object('id',v.id,'status',v.status,'replay',true);
 end if;
 if v.status<>'REQUESTED' then raise exception 'Demande non prête à être versée'; end if;
 if length(btrim(coalesce(p_wave_reference,'')))<5
    or not private.rt_sop_proof_exists(v.rt_id,p_proof_path) then
    raise exception 'Référence Wave et preuve Finance déposée obligatoires';
 end if;
 update public.rt_sop_funding_requests set status='FINANCE_SENT',
   wave_reference=trim(p_wave_reference),finance_proof_path=p_proof_path,
   finance_by=auth.uid(),finance_at=now()
 where id=v.id;
 return jsonb_build_object('id',v.id,'status','FINANCE_SENT');
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

-- Finance only: the official historic credit is created once, AFTER RT signature.
create or replace function public.rt_sop_post_funding(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v public.rt_sop_funding_requests%rowtype; v_id uuid; v_name text;
begin
 perform private.rt_sop_require_role(array['Finance','Finance Officer','Finance Manager','Accountant','Comptable']);
 select * into v from public.rt_sop_funding_requests where id=p_id for update;
 if not found then raise exception 'Demande Wave introuvable'; end if;
 if v.status='POSTED' then
   return jsonb_build_object('id',v.id,'status',v.status,'advance_id',v.posted_advance_id,'replay',true);
 end if;
 if v.status<>'RT_ACK' or v.finance_at is null or v.rt_ack_at is null
    or v.wave_reference is null or v.rt_ack_proof_path is null then
   raise exception 'Versement et réception RT non prouvés';
 end if;
 if not exists(select 1 from public.campaigns where id=v.campaign_id and status='OPEN') then
   raise exception 'Campagne non ouverte';
 end if;
 select nom into v_name from public.profils where user_id=auth.uid() and actif=true;
 insert into public.avances(local_id,date,cluster,rt_id,rt_nom,source,montant,motif,
   statut,created_by,created_by_nom,campaign_id,sop_funding_request_id)
 select 'sop-wave-'||v.id::text,now()::date,r.cluster,r.id,r.nom,'Finance',v.amount_fcfa,
   'AFLP SOP - versement Wave '||v.wave_reference,'Active',auth.uid(),v_name,v.campaign_id,v.id
 from public.rt r where r.id=v.rt_id
 returning id into v_id;
 update public.rt_sop_funding_requests set status='POSTED',posted_advance_id=v_id where id=v.id;
 return jsonb_build_object('id',v.id,'status','POSTED','advance_id',v_id);
end $$;

-- Immutable history of UH decisions. Latest decision for each achat is authoritative.
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

-- Source-of-truth finance RT: only actual POSTED Wave credits and UH-approved paid purchases.
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

-- Make RPCs callable only with authenticated JWT; every RPC checks DB-side roles and proof.
revoke all on function public.rt_sop_request_funding(uuid,text,numeric,text,text,uuid) from public,anon;
revoke all on function public.rt_sop_finance_confirm(uuid,text,text) from public,anon;
revoke all on function public.rt_sop_rt_acknowledge(uuid,text) from public,anon;
revoke all on function public.rt_sop_post_funding(uuid) from public,anon;
revoke all on function public.rt_sop_review_purchase(uuid,text,text,text,text,text,uuid) from public,anon;
revoke all on function public.rt_sop_refund(uuid,text,numeric,text,text,uuid) from public,anon;
grant execute on function public.rt_sop_request_funding(uuid,text,numeric,text,text,uuid) to authenticated;
grant execute on function public.rt_sop_finance_confirm(uuid,text,text) to authenticated;
grant execute on function public.rt_sop_rt_acknowledge(uuid,text) to authenticated;
grant execute on function public.rt_sop_post_funding(uuid) to authenticated;
grant execute on function public.rt_sop_review_purchase(uuid,text,text,text,text,text,uuid) to authenticated;
grant execute on function public.rt_sop_refund(uuid,text,numeric,text,text,uuid) to authenticated;
commit;
