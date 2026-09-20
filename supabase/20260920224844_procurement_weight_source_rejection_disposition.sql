
begin;

alter table public.achats add column if not exists weight_source text;
do $$
begin
 if not exists(select 1 from pg_constraint where conname='achats_weight_source_chk') then
   alter table public.achats add constraint achats_weight_source_chk
   check(weight_source is null or weight_source in ('SCALE','ESTIMATED','BAG_STANDARD'));
 end if;
end $$;

create table if not exists public.procurement_rejection_cases(
  id uuid primary key default gen_random_uuid(),
  reception_id text not null unique references public.wms_receptions(id) on update restrict on delete restrict,
  rejection_reason text not null,
  status text not null default 'OPEN' check(status in ('OPEN','RESOLVED')),
  resolution_action text,
  resolution_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_by_name text,
  resolved_at timestamptz,
  constraint procurement_rejection_resolution_chk check (
    status='OPEN' or (
      nullif(btrim(coalesce(resolution_action,'')),'') is not null
      and nullif(btrim(coalesce(resolution_reason,'')),'') is not null
      and resolved_at is not null
    )
  )
);

create or replace function public.procurement_capture_rejection()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='REJECTED' and old.status is distinct from 'REJECTED' then
   insert into public.procurement_rejection_cases(reception_id,rejection_reason,created_by)
   values(new.id,coalesce(nullif(new.decision_comment,''),'Rejet qualité sans motif détaillé'),new.decided_by)
   on conflict(reception_id) do nothing;
 end if;
 return new;
end $$;

drop trigger if exists trg_procurement_capture_rejection on public.wms_receptions;
create trigger trg_procurement_capture_rejection
after update of status on public.wms_receptions
for each row execute function public.procurement_capture_rejection();

create or replace function public.procurement_resolve_rejection(
 p_reception_id text,p_action text,p_reason text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c jsonb;x public.procurement_rejection_cases;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array[
   'General Manager','GM','Branch Manager','Assistant Branch Manager',
   'Procurement Officer','Field Buying Operations Officer','LBA Purchase Officer'
 ]) then raise exception 'Droit insuffisant pour résoudre un rejet'; end if;
 if nullif(btrim(coalesce(p_action,'')),'') is null then raise exception 'Disposition obligatoire'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Motif obligatoire'; end if;
 select * into x from public.procurement_rejection_cases where reception_id=p_reception_id for update;
 if x.id is null then raise exception 'Dossier de rejet introuvable'; end if;
 if x.status='RESOLVED' then return to_jsonb(x)||jsonb_build_object('idempotent',true); end if;
 update public.procurement_rejection_cases set
   status='RESOLVED',resolution_action=btrim(p_action),resolution_reason=btrim(p_reason),
   resolved_by=(c->>'uid')::uuid,resolved_by_name=c->>'nom',resolved_at=now()
 where id=x.id returning * into x;
 perform public.wms_audit(p_reception_id,'procurement.rejection_disposition',null,
   jsonb_build_object('action',x.resolution_action,'reason',x.resolution_reason,'resolved_by',x.resolved_by_name),
   'Disposition camion rejeté');
 return to_jsonb(x)||jsonb_build_object('idempotent',false);
end $$;

alter table public.procurement_rejection_cases enable row level security;
drop policy if exists procurement_rejection_cases_read on public.procurement_rejection_cases;
create policy procurement_rejection_cases_read on public.procurement_rejection_cases
for select to authenticated using (true);
revoke all on public.procurement_rejection_cases from anon;
grant select on public.procurement_rejection_cases to authenticated;
revoke all on function public.procurement_resolve_rejection(text,text,text) from public,anon;
grant execute on function public.procurement_resolve_rejection(text,text,text) to authenticated;

create or replace view public.procurement_v_rejected_trucks
with (security_invoker=true) as
select r.id reception_id,r.truck,r.procurement_channel,r.procurement_source_type,r.procurement_source_id,
       r.supplier_code,r.supplier_name,r.lba_code,r.origin,r.purchase_type,
       r.sampling_kor,r.sampling_moisture,r.decision_comment rejection_reason,r.decided_by_name,r.decided_at,
       c.status disposition_status,c.resolution_action,c.resolution_reason,c.resolved_by_name,c.resolved_at
from public.wms_v_receptions r
left join public.procurement_rejection_cases c on c.reception_id=r.id
where r.status='REJECTED';

grant select on public.procurement_v_rejected_trucks to authenticated;
commit;
