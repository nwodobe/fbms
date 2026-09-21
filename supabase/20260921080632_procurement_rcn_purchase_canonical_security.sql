
begin;

-- Canonical supplier-purchase model.
alter table public.procurement_reception_settlements
  add column if not exists purchase_code text,
  add column if not exists procurement_channel text,
  add column if not exists purchase_type text,
  add column if not exists supplier_code text,
  add column if not exists campaign text,
  add column if not exists price_ref text,
  add column if not exists reference_price numeric,
  add column if not exists negotiated_price numeric,
  add column if not exists submitted_price numeric,
  add column if not exists approved_price numeric,
  add column if not exists amount_submitted numeric,
  add column if not exists amount_approved numeric,
  add column if not exists refraction_reason text,
  add column if not exists price_exception boolean not null default false,
  add column if not exists price_exception_pct numeric,
  add column if not exists quality_exception boolean not null default false,
  add column if not exists quality_exception_reason text,
  add column if not exists submitted_by uuid,
  add column if not exists submitted_by_name text,
  add column if not exists submitted_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists rejected_by_name text,
  add column if not exists rejected_at timestamptz,
  add column if not exists decision_reason text,
  add column if not exists row_version integer not null default 1;

update public.procurement_reception_settlements
set purchase_code=coalesce(purchase_code,'PUR-'||to_char(created_at at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(replace(id::text,'-',''),1,8))),
    negotiated_price=coalesce(negotiated_price,price_per_kg),
    amount_submitted=coalesce(amount_submitted,amount_payable)
where purchase_code is null or negotiated_price is null or amount_submitted is null;

alter table public.procurement_reception_settlements
  alter column purchase_code set not null;

create unique index if not exists procurement_settlement_purchase_code_uq
on public.procurement_reception_settlements(purchase_code);
create index if not exists procurement_settlement_status_idx
on public.procurement_reception_settlements(status,submitted_at desc);
create index if not exists procurement_settlement_supplier_idx
on public.procurement_reception_settlements(supplier_code,status);
create index if not exists procurement_settlement_channel_idx
on public.procurement_reception_settlements(procurement_channel,status);
create index if not exists procurement_settlement_approved_idx
on public.procurement_reception_settlements(approved_at desc) where status='APPROVED';

do $$
begin
 if not exists(select 1 from pg_constraint where conname='procurement_settlement_supplier_fk') then
   alter table public.procurement_reception_settlements
     add constraint procurement_settlement_supplier_fk
     foreign key(supplier_code) references public.rcn_fournisseurs(code) on update cascade;
 end if;
 if not exists(select 1 from pg_constraint where conname='procurement_settlement_price_ref_fk') then
   alter table public.procurement_reception_settlements
     add constraint procurement_settlement_price_ref_fk
     foreign key(price_ref) references public.rcn_proc_prix(id);
 end if;
end $$;

alter table public.procurement_reception_settlements
  drop constraint if exists procurement_reception_settlements_status_check;
alter table public.procurement_reception_settlements
  add constraint procurement_reception_settlements_status_check
  check(status in ('DRAFT','SUBMITTED','CHANGES_REQUESTED','APPROVED','REJECTED'));

alter table public.procurement_reception_settlements
  drop constraint if exists procurement_settlement_prices_chk;
alter table public.procurement_reception_settlements
  add constraint procurement_settlement_prices_chk check(
    (reference_price is null or reference_price>0) and
    (negotiated_price is null or negotiated_price>0) and
    (submitted_price is null or submitted_price>0) and
    (approved_price is null or approved_price>0) and
    (amount_submitted is null or amount_submitted>=0) and
    (amount_approved is null or amount_approved>=0)
  );

alter table public.procurement_reception_settlements
  drop constraint if exists procurement_settlement_refraction_reason_chk;
alter table public.procurement_reception_settlements
  add constraint procurement_settlement_refraction_reason_chk check(
    refraction_kg<=0.001 or nullif(btrim(coalesce(refraction_reason,'')),'') is not null
  );

-- Finance BAP can now originate from canonical settlement or legacy validation.
alter table public.rcn_proc_bons_payer
  alter column purchase_validation_id drop not null,
  add column if not exists purchase_settlement_id uuid;

do $$
begin
 if not exists(select 1 from pg_constraint where conname='rcn_proc_bap_settlement_fk') then
   alter table public.rcn_proc_bons_payer
     add constraint rcn_proc_bap_settlement_fk
     foreign key(purchase_settlement_id) references public.procurement_reception_settlements(id)
     on update restrict on delete restrict;
 end if;
end $$;

create unique index if not exists rcn_proc_bap_settlement_uq
on public.rcn_proc_bons_payer(purchase_settlement_id)
where purchase_settlement_id is not null;

alter table public.rcn_proc_bons_payer
  drop constraint if exists rcn_proc_bap_single_source_chk;
alter table public.rcn_proc_bons_payer
  add constraint rcn_proc_bap_single_source_chk
  check(num_nonnulls(purchase_validation_id,purchase_settlement_id)=1);

-- Server guard: status transitions and approved changes only through dedicated RPCs.
create or replace function private.procurement_settlement_guard()
returns trigger
language plpgsql
security definer
set search_path=public,private
as $$
begin
 if new.status is distinct from old.status
    and coalesce(current_setting('app.procurement_state_transition',true),'')<>'on' then
   raise exception 'Transition de statut interdite hors RPC Procurement dédiée';
 end if;

 if old.status='APPROVED'
    and (
      new.refraction_mode,new.refraction_value,new.refraction_kg,new.refraction_reason,
      new.paid_weight_kg,new.negotiated_price,new.submitted_price,new.approved_price,
      new.amount_submitted,new.amount_approved,new.price_ref
    ) is distinct from (
      old.refraction_mode,old.refraction_value,old.refraction_kg,old.refraction_reason,
      old.paid_weight_kg,old.negotiated_price,old.submitted_price,old.approved_price,
      old.amount_submitted,old.amount_approved,old.price_ref
    )
    and coalesce(current_setting('app.procurement_approved_correction',true),'')<>'on' then
   raise exception 'Purchase APPROVED verrouillé : utiliser la procédure de correction auditée';
 end if;

 new.row_version=old.row_version+1;
 new.updated_at=now();
 return new;
end $$;

drop trigger if exists trg_procurement_settlement_guard on public.procurement_reception_settlements;
create trigger trg_procurement_settlement_guard
before update on public.procurement_reception_settlements
for each row execute function private.procurement_settlement_guard();

-- Readiness view used by Procurement work queue.
create or replace view public.procurement_v_ready_supplier_receptions
with (security_invoker=true) as
select
 r.id reception_id,r.arrival_at,r.procurement_channel,r.purchase_type,r.supplier_code,r.supplier_name,
 r.warehouse_id,r.warehouse_code,r.warehouse_name,r.truck,r.origin,r.net_kg,r.bags,
 r.sampling_kor,r.sampling_moisture,r.final_kor,r.final_moisture,r.final_id,
 case
   when r.status='REJECTED' then 'REJECTED'
   when r.net_kg is null or r.net_kg<=0 then 'WAITING_WEIGHING'
   when r.final_id is null then 'WAITING_FINAL_QUALITY'
   when r.procurement_channel='FIELD_BUYING' then 'FIELD_BUYING_RECONCILIATION'
   when s.id is null then 'READY_FOR_SETTLEMENT'
   else s.status
 end purchase_readiness,
 s.id settlement_id,s.purchase_code,s.status settlement_status
from public.wms_v_receptions r
left join public.procurement_reception_settlements s on s.reception_id=r.id
where coalesce(r.procurement_channel,'')<>'FIELD_BUYING';

grant select on public.procurement_v_ready_supplier_receptions to authenticated;

-- Draft: the only general mutation RPC. It never accepts status/payment state.
create or replace function public.procurement_save_purchase_draft(p_reception_id text,p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
 c jsonb;r public.wms_v_receptions;s public.procurement_reception_settlements;before_row jsonb;
 v_mode text;v_val numeric;v_ref numeric;v_paid numeric;v_neg numeric;v_amt numeric;
 v_price_ref text;pr public.rcn_proc_prix;v_ref_price numeric;v_gap numeric;v_gap_pct numeric;
 v_campaign text;v_code text;v_quality_exception boolean:=false;v_quality_reason text;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array[
   'Procurement Officer','LBA Purchase Officer','Branch Manager','Assistant Branch Manager',
   'Coordination','Administrateur'
 ]) then raise exception 'Droit insuffisant pour préparer un Achat RCN'; end if;

 select * into r from public.wms_v_receptions where id=p_reception_id;
 if r.id is null then raise exception 'Réception Warehouse introuvable'; end if;
 if r.procurement_channel='FIELD_BUYING' then raise exception 'FIELD_BUYING reste géré par les achats producteurs et la Reconciliation'; end if;
 if r.status='REJECTED' then raise exception 'Camion REJECTED : Achat RCN fournisseur interdit'; end if;
 if r.net_kg is null or r.net_kg<=0 then raise exception 'Warehouse Net Weight requis avant Commercial Settlement'; end if;
 if r.supplier_code is null then raise exception 'Supplier Master requis'; end if;

 select * into s from public.procurement_reception_settlements where reception_id=r.id for update;
 if s.id is not null and s.status not in ('DRAFT','CHANGES_REQUESTED') then
   raise exception 'Purchase % verrouillé au statut %',s.purchase_code,s.status;
 end if;
 before_row:=case when s.id is null then null else to_jsonb(s) end;

 v_mode:=upper(coalesce(nullif(p->>'refraction_mode',''),'NONE'));
 if v_mode not in ('NONE','KG','PERCENT') then raise exception 'Refraction Mode invalide'; end if;
 v_val:=coalesce(nullif(p->>'refraction_value','')::numeric,0);
 if v_val<0 then raise exception 'Refraction négative interdite'; end if;
 if v_mode='NONE' then v_ref:=0;
 elsif v_mode='KG' then v_ref:=round(v_val,3);
 else
   if v_val>100 then raise exception 'Refraction %% ne peut pas dépasser 100'; end if;
   v_ref:=round(r.net_kg*v_val/100.0,3);
 end if;
 if v_ref>r.net_kg then raise exception 'Refraction supérieure au Warehouse Net Weight'; end if;
 if v_ref>0 and nullif(btrim(coalesce(p->>'refraction_reason','')),'') is null then
   raise exception 'Refraction Reason obligatoire';
 end if;
 v_paid:=round(r.net_kg-v_ref,3);

 v_neg:=coalesce(nullif(p->>'negotiated_price','')::numeric,nullif(p->>'price_per_kg','')::numeric);
 if v_neg is not null and v_neg<=0 then raise exception 'Negotiated Price doit être supérieur à zéro'; end if;
 v_amt:=case when v_neg is null then null else round(v_paid*v_neg,2) end;

 v_price_ref:=nullif(p->>'price_ref','');
 if v_price_ref is not null then
   select * into pr from public.rcn_proc_prix where id=v_price_ref;
   if pr.id is null then raise exception 'Price Reference introuvable'; end if;
   if pr.supplier_code<>r.supplier_code then raise exception 'Price Reference ne correspond pas au Supplier'; end if;
   v_ref_price:=coalesce(pr.prix_approuve,pr.prix_bm,pr.prix_propose);
   v_campaign:=pr.campagne;
   if r.final_kor is not null and pr.kor_min is not null and r.final_kor<pr.kor_min then
     v_quality_exception:=true;
     v_quality_reason:=concat_ws('; ',v_quality_reason,'Final KOR sous minimum');
   end if;
   if r.final_moisture is not null and pr.humidite_max is not null and r.final_moisture>pr.humidite_max then
     v_quality_exception:=true;
     v_quality_reason:=concat_ws('; ',v_quality_reason,'Final Moisture au-dessus du maximum');
   end if;
 end if;
 v_campaign:=coalesce(v_campaign,nullif(p->>'campaign',''));

 select prix_ecart_alerte_pct into v_gap
 from public.rcn_proc_parametres where id='GLOBAL' and statut='VALIDE';
 v_gap_pct:=case when v_neg is not null and v_ref_price is not null and v_ref_price>0
                  then round(abs(v_neg-v_ref_price)*100.0/v_ref_price,3) else null end;

 if s.id is null then
   v_code:='PUR-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
   insert into public.procurement_reception_settlements(
     purchase_code,reception_id,procurement_channel,purchase_type,supplier_code,campaign,
     refraction_mode,refraction_value,refraction_kg,refraction_reason,net_kg_snapshot,paid_weight_kg,
     price_ref,reference_price,negotiated_price,price_per_kg,amount_payable,
     price_exception,price_exception_pct,quality_exception,quality_exception_reason,
     status,note,created_by,created_by_name,updated_by
   ) values(
     v_code,r.id,r.procurement_channel,r.purchase_type,r.supplier_code,v_campaign,
     v_mode,v_val,v_ref,nullif(p->>'refraction_reason',''),r.net_kg,v_paid,
     v_price_ref,v_ref_price,v_neg,v_neg,v_amt,
     coalesce(v_gap is not null and v_gap_pct>v_gap,false),v_gap_pct,v_quality_exception,v_quality_reason,
     'DRAFT',nullif(p->>'note',''),(c->>'uid')::uuid,c->>'nom',(c->>'uid')::uuid
   ) returning * into s;
 else
   update public.procurement_reception_settlements set
     procurement_channel=r.procurement_channel,purchase_type=r.purchase_type,supplier_code=r.supplier_code,
     campaign=v_campaign,refraction_mode=v_mode,refraction_value=v_val,refraction_kg=v_ref,
     refraction_reason=nullif(p->>'refraction_reason',''),net_kg_snapshot=r.net_kg,paid_weight_kg=v_paid,
     price_ref=v_price_ref,reference_price=v_ref_price,negotiated_price=v_neg,
     price_per_kg=v_neg,amount_payable=v_amt,
     price_exception=coalesce(v_gap is not null and v_gap_pct>v_gap,false),price_exception_pct=v_gap_pct,
     quality_exception=v_quality_exception,quality_exception_reason=v_quality_reason,
     note=nullif(p->>'note',''),updated_by=(c->>'uid')::uuid
   where id=s.id returning * into s;
 end if;

 perform public.wms_audit(r.id,'procurement.purchase.draft',before_row,to_jsonb(s),'Commercial Purchase draft');
 return to_jsonb(s);
end $$;

-- Submit: BM/ABM gate, final QA required, no silent price changes afterwards.
create or replace function public.procurement_submit_purchase(p_purchase_id uuid,p_submitted_price numeric default null,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare c jsonb;s public.procurement_reception_settlements;r public.wms_v_receptions;v_price numeric;before_row jsonb;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['Branch Manager','Assistant Branch Manager','Coordination','Administrateur']) then
   raise exception 'Soumission réservée au Branch Management';
 end if;
 select * into s from public.procurement_reception_settlements where id=p_purchase_id for update;
 if s.id is null then raise exception 'Purchase introuvable'; end if;
 if s.status not in ('DRAFT','CHANGES_REQUESTED') then raise exception 'Purchase non soumissible au statut %',s.status; end if;
 select * into r from public.wms_v_receptions where id=s.reception_id;
 if r.status='REJECTED' then raise exception 'Camion REJECTED'; end if;
 if r.net_kg is null or r.net_kg<=0 then raise exception 'Warehouse Net Weight requis'; end if;
 if r.final_id is null then raise exception 'Final Quality requise avant soumission Achat RCN'; end if;

 v_price:=coalesce(p_submitted_price,s.negotiated_price);
 if v_price is null or v_price<=0 then raise exception 'Submitted Price requis et > 0'; end if;
 if (s.price_exception or s.quality_exception)
    and nullif(btrim(coalesce(p_reason,'')),'') is null then
   raise exception 'Exception prix/qualité : justification obligatoire';
 end if;

 before_row:=to_jsonb(s);
 perform set_config('app.procurement_state_transition','on',true);
 update public.procurement_reception_settlements set
   submitted_price=v_price,price_per_kg=v_price,
   amount_submitted=round(paid_weight_kg*v_price,2),amount_payable=round(paid_weight_kg*v_price,2),
   status='SUBMITTED',submitted_by=(c->>'uid')::uuid,submitted_by_name=c->>'nom',
   submitted_at=now(),decision_reason=nullif(p_reason,''),updated_by=(c->>'uid')::uuid
 where id=s.id returning * into s;
 perform public.wms_audit(s.reception_id,'procurement.purchase.submit',before_row,to_jsonb(s),coalesce(p_reason,'Submission'));
 return to_jsonb(s);
end $$;

create or replace function public.procurement_request_purchase_changes(p_purchase_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare c jsonb;s public.procurement_reception_settlements;before_row jsonb;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['GM','General Manager','Coordination','Administrateur']) then
   raise exception 'Décision réservée au General Management';
 end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Motif obligatoire'; end if;
 select * into s from public.procurement_reception_settlements where id=p_purchase_id for update;
 if s.id is null or s.status<>'SUBMITTED' then raise exception 'Purchase doit être SUBMITTED'; end if;
 before_row:=to_jsonb(s);
 perform set_config('app.procurement_state_transition','on',true);
 update public.procurement_reception_settlements set
   status='CHANGES_REQUESTED',decision_reason=p_reason,updated_by=(c->>'uid')::uuid
 where id=s.id returning * into s;
 perform public.wms_audit(s.reception_id,'procurement.purchase.changes_requested',before_row,to_jsonb(s),p_reason);
 return to_jsonb(s);
end $$;

create or replace function public.procurement_reject_purchase(p_purchase_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare c jsonb;s public.procurement_reception_settlements;before_row jsonb;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['GM','General Manager','Coordination','Administrateur']) then
   raise exception 'Décision réservée au General Management';
 end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Motif obligatoire'; end if;
 select * into s from public.procurement_reception_settlements where id=p_purchase_id for update;
 if s.id is null or s.status<>'SUBMITTED' then raise exception 'Purchase doit être SUBMITTED'; end if;
 before_row:=to_jsonb(s);
 perform set_config('app.procurement_state_transition','on',true);
 update public.procurement_reception_settlements set
   status='REJECTED',decision_reason=p_reason,rejected_by=(c->>'uid')::uuid,
   rejected_by_name=c->>'nom',rejected_at=now(),updated_by=(c->>'uid')::uuid
 where id=s.id returning * into s;
 perform public.wms_audit(s.reception_id,'procurement.purchase.reject',before_row,to_jsonb(s),p_reason);
 return to_jsonb(s);
end $$;

create or replace function public.procurement_approve_purchase(p_purchase_id uuid,p_approved_price numeric default null,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare c jsonb;s public.procurement_reception_settlements;r public.wms_v_receptions;v_price numeric;v_bap text;before_row jsonb;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['GM','General Manager','Coordination','Administrateur']) then
   raise exception 'Approbation réservée au General Management';
 end if;
 select * into s from public.procurement_reception_settlements where id=p_purchase_id for update;
 if s.id is null then raise exception 'Purchase introuvable'; end if;
 if s.status<>'SUBMITTED' then raise exception 'Purchase doit être SUBMITTED'; end if;
 if s.created_by=(c->>'uid')::uuid or s.submitted_by=(c->>'uid')::uuid then
   raise exception 'Séparation des tâches : préparateur/soumissionnaire et approbateur doivent être différents';
 end if;
 select * into r from public.wms_v_receptions where id=s.reception_id;
 if r.status='REJECTED' then raise exception 'Camion REJECTED'; end if;
 if r.final_id is null then raise exception 'Final Quality requise'; end if;

 v_price:=coalesce(p_approved_price,s.submitted_price);
 if v_price is null or v_price<=0 then raise exception 'Approved Price requis et > 0'; end if;
 if (s.price_exception or s.quality_exception)
    and nullif(btrim(coalesce(p_reason,'')),'') is null then
   raise exception 'Exception prix/qualité : commentaire GM obligatoire';
 end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then p_reason:='Approved'; end if;

 before_row:=to_jsonb(s);
 perform set_config('app.procurement_state_transition','on',true);
 update public.procurement_reception_settlements set
   approved_price=v_price,price_per_kg=v_price,
   amount_approved=round(paid_weight_kg*v_price,2),amount_payable=round(paid_weight_kg*v_price,2),
   status='APPROVED',approved_by=(c->>'uid')::uuid,approved_by_name=c->>'nom',approved_at=now(),
   decision_reason=p_reason,updated_by=(c->>'uid')::uuid
 where id=s.id returning * into s;

 v_bap:='BAP-'||s.purchase_code;
 insert into public.rcn_proc_bons_payer(
   id,purchase_validation_id,purchase_settlement_id,reception_id,supplier_code,supplier_name,
   montant_approuve,statut,commentaire,prepared_by
 ) values(
   v_bap,null,s.id,s.reception_id,s.supplier_code,r.supplier_name,
   s.amount_approved,'BROUILLON','Auto-generated from approved canonical Purchase',(c->>'uid')::uuid
 )
 on conflict(purchase_settlement_id) do update set
   montant_approuve=excluded.montant_approuve,updated_at=now()
 where public.rcn_proc_bons_payer.statut in ('BROUILLON','A_CORRIGER');

 perform public.wms_audit(s.reception_id,'procurement.purchase.approve',before_row,to_jsonb(s),p_reason);
 return to_jsonb(s)||jsonb_build_object('bap_id',v_bap);
end $$;

create or replace function public.procurement_correct_approved_purchase(p_purchase_id uuid,p jsonb,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare c jsonb;s public.procurement_reception_settlements;r public.wms_v_receptions;b public.rcn_proc_bons_payer;
 v_mode text;v_val numeric;v_ref numeric;v_paid numeric;v_price numeric;before_row jsonb;pc int;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['GM','General Manager','Coordination','Administrateur']) then
   raise exception 'Correction APPROVED réservée au General Management';
 end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Motif de correction obligatoire'; end if;
 select * into s from public.procurement_reception_settlements where id=p_purchase_id for update;
 if s.id is null or s.status<>'APPROVED' then raise exception 'Purchase doit être APPROVED'; end if;
 select * into r from public.wms_v_receptions where id=s.reception_id;
 select * into b from public.rcn_proc_bons_payer where purchase_settlement_id=s.id for update;
 if b.id is not null then
   select count(*) into pc from public.rcn_proc_paiements
   where bon_payer_id=b.id and statut not in ('REJETE','ANNULE');
   if pc>0 or b.statut not in ('BROUILLON','A_CORRIGER') then
     raise exception 'Correction interdite après engagement Finance/paiement';
   end if;
 end if;

 v_mode:=upper(coalesce(nullif(p->>'refraction_mode',''),s.refraction_mode));
 v_val:=coalesce(nullif(p->>'refraction_value','')::numeric,s.refraction_value);
 if v_mode not in ('NONE','KG','PERCENT') or v_val<0 then raise exception 'Refraction invalide'; end if;
 if v_mode='NONE' then v_ref:=0;
 elsif v_mode='KG' then v_ref:=round(v_val,3);
 else
   if v_val>100 then raise exception 'Refraction %% invalide'; end if;
   v_ref:=round(r.net_kg*v_val/100.0,3);
 end if;
 if v_ref>r.net_kg then raise exception 'Refraction supérieure au Net Weight'; end if;
 if v_ref>0 and nullif(btrim(coalesce(p->>'refraction_reason',s.refraction_reason,'')),'') is null then
   raise exception 'Refraction Reason obligatoire';
 end if;
 v_paid:=round(r.net_kg-v_ref,3);
 v_price:=coalesce(nullif(p->>'approved_price','')::numeric,s.approved_price);
 if v_price is null or v_price<=0 then raise exception 'Approved Price invalide'; end if;

 before_row:=to_jsonb(s);
 perform set_config('app.procurement_approved_correction','on',true);
 update public.procurement_reception_settlements set
   refraction_mode=v_mode,refraction_value=v_val,refraction_kg=v_ref,
   refraction_reason=coalesce(nullif(p->>'refraction_reason',''),s.refraction_reason),
   net_kg_snapshot=r.net_kg,paid_weight_kg=v_paid,
   approved_price=v_price,price_per_kg=v_price,
   amount_approved=round(v_paid*v_price,2),amount_payable=round(v_paid*v_price,2),
   decision_reason=p_reason,updated_by=(c->>'uid')::uuid
 where id=s.id returning * into s;

 if b.id is not null then
   update public.rcn_proc_bons_payer
   set montant_approuve=s.amount_approved,commentaire=concat_ws(E'\n',commentaire,'Correction: '||p_reason),updated_at=now()
   where id=b.id;
 end if;
 perform public.wms_audit(s.reception_id,'procurement.purchase.correct_approved',before_row,to_jsonb(s),p_reason);
 return to_jsonb(s);
end $$;

-- Backward compatibility wrappers are deliberately restrictive.
create or replace function public.procurement_set_reception_settlement(p_reception_id text,p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
 if p ? 'status' or p ? 'payment_status' then
   raise exception 'status/payment_status ne sont plus modifiables via le Draft RPC';
 end if;
 return public.procurement_save_purchase_draft(
   p_reception_id,
   jsonb_build_object(
     'refraction_mode',coalesce(p->>'refraction_mode','NONE'),
     'refraction_value',coalesce(p->>'refraction_value','0'),
     'refraction_reason',p->>'refraction_reason',
     'negotiated_price',coalesce(p->>'negotiated_price',p->>'price_per_kg'),
     'price_ref',p->>'price_ref',
     'campaign',p->>'campaign',
     'note',p->>'note'
   )
 );
end $$;

create or replace function public.procurement_approve_reception_settlement(p_reception_id text,p_approve boolean,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare sid uuid;
begin
 select id into sid from public.procurement_reception_settlements where reception_id=p_reception_id;
 if sid is null then raise exception 'Purchase introuvable'; end if;
 if p_approve then return public.procurement_approve_purchase(sid,null,p_reason);
 else return public.procurement_reject_purchase(sid,p_reason);
 end if;
end $$;

-- Legacy purchase validation becomes read-only for authenticated clients.
revoke insert,update,delete on public.rcn_proc_validations_achat from authenticated,anon;
comment on table public.rcn_proc_validations_achat is
'LEGACY READ ONLY. New supplier purchases use procurement_reception_settlements.';

-- Direct writes to canonical settlements remain read-only; RPCs are the write surface.
revoke insert,update,delete on public.procurement_reception_settlements from authenticated,anon;
grant select on public.procurement_reception_settlements to authenticated;

-- RPC privileges.
do $$
declare f regprocedure;
begin
 foreach f in array array[
   'public.procurement_save_purchase_draft(text,jsonb)'::regprocedure,
   'public.procurement_submit_purchase(uuid,numeric,text)'::regprocedure,
   'public.procurement_request_purchase_changes(uuid,text)'::regprocedure,
   'public.procurement_reject_purchase(uuid,text)'::regprocedure,
   'public.procurement_approve_purchase(uuid,numeric,text)'::regprocedure,
   'public.procurement_correct_approved_purchase(uuid,jsonb,text)'::regprocedure,
   'public.procurement_set_reception_settlement(text,jsonb)'::regprocedure,
   'public.procurement_approve_reception_settlement(text,boolean,text)'::regprocedure
 ] loop
   execute format('revoke all on function %s from public,anon',f);
   execute format('grant execute on function %s to authenticated',f);
 end loop;
end $$;

commit;
