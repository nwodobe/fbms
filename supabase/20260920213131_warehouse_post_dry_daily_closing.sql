-- Warehouse production readiness: Post-Dry Quality + Daily Closing / Mass Balance.

alter table public.wms_quality_snapshots
  add column if not exists batch_id text,
  add column if not exists cycle_no integer,
  add column if not exists dest_bin_id text,
  add column if not exists disposition text,
  add column if not exists decision_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='wms_quality_snapshots_drying_fk') then
    alter table public.wms_quality_snapshots
      add constraint wms_quality_snapshots_drying_fk foreign key (drying_id) references public.wms_dryings(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='wms_quality_snapshots_dest_bin_fk') then
    alter table public.wms_quality_snapshots
      add constraint wms_quality_snapshots_dest_bin_fk foreign key (dest_bin_id) references public.wms_bins(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='wms_quality_snapshots_post_dry_disposition_check') then
    alter table public.wms_quality_snapshots
      add constraint wms_quality_snapshots_post_dry_disposition_check check (
        (type <> 'POST_DRY' and disposition is null)
        or
        (type='POST_DRY' and disposition in ('READY','RE_DRY','HOLD'))
      );
  end if;
end $$;

alter table public.wms_dryings drop constraint if exists wms_dryings_status_check;
alter table public.wms_dryings
  add constraint wms_dryings_status_check check (
    status in ('COMPLETED','AWAITING_POST_DRY_QA','READY','RE_DRY','QUALITY_HOLD','WEATHER_HOLD','CANCELLED')
  );

create or replace function public.wms_mark_drying_quality_pending()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.type='DRYING' and new.status='COMPLETED' then
    update public.wms_dryings set status='AWAITING_POST_DRY_QA' where id=new.id;
  end if;
  return null;
end $$;

drop trigger if exists trg_wms_mark_drying_quality_pending on public.wms_dryings;
create trigger trg_wms_mark_drying_quality_pending
after insert on public.wms_dryings
for each row execute function public.wms_mark_drying_quality_pending();

revoke all on function public.wms_mark_drying_quality_pending() from public,anon,authenticated;

update public.wms_parameters
set value = value || jsonb_build_object('post_dry_qa', coalesce(value->'final_qa','[]'::jsonb))
where key='roleMatrix' and not (value ? 'post_dry_qa');

create or replace view public.wms_v_post_dry_quality_current
with (security_invoker=true) as
select distinct on (q.drying_id,q.lot_id)
  q.id,q.drying_id,q.batch_id,q.cycle_no,q.lot_id,q.reception_id,q.dest_bin_id,
  q.gk_g,q.imm_g,q.spotted_g,q.moisture_pct,q.nut_count,
  q.weighted_kernel,q.kor_exact,q.kor_display,q.kor_factor,q.formula_version,
  q.disposition,q.decision_reason,q.analyst,q.note,q.created_by,q.created_at
from public.wms_quality_snapshots q
where q.type='POST_DRY' and q.superseded_by is null
order by q.drying_id,q.lot_id,q.created_at desc;

grant select on public.wms_v_post_dry_quality_current to authenticated;

create or replace function public.wms_save_post_dry_quality(p_drying_id text,p_lot_id text,p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c jsonb; d public.wms_dryings; l public.wms_lots; k jsonb; s public.wms_quality_snapshots;
  prev public.wms_quality_snapshots; v_gk numeric; v_imm numeric; v_sp numeric;
  v_id text; v_key text; v_disp text; v_reason text;
begin
  c:=public.wms_require('post_dry_qa');
  v_key:=nullif(btrim(coalesce(p->>'idempotency_key','')),'');
  if v_key is null then raise exception 'Clé d''idempotence obligatoire'; end if;
  select * into s from public.wms_quality_snapshots where idempotency_key=v_key limit 1;
  if s.id is not null then return to_jsonb(s)||jsonb_build_object('idempotent',true); end if;

  select * into d from public.wms_dryings where id=p_drying_id for update;
  if d.id is null then raise exception 'Drying introuvable'; end if;
  if d.type<>'DRYING' then raise exception 'Post-Dry Quality réservé aux cycles DRYING'; end if;
  if d.status not in ('AWAITING_POST_DRY_QA','QUALITY_HOLD','RE_DRY') then
    raise exception 'Post-Dry Quality impossible au statut %',d.status;
  end if;

  select * into l from public.wms_lots where id=p_lot_id;
  if l.id is null then raise exception 'LOT introuvable'; end if;
  if not exists(
    select 1 from public.wms_movement_lots ml
    where ml.movement_id=d.receipt_movement_id and ml.lot_id=l.id and ml.qty_in>0
  ) then raise exception 'LOT % ne contribue pas au cycle %',l.id,d.id; end if;

  v_gk:=nullif(btrim(coalesce(p->>'gk_g','')),'')::numeric;
  v_imm:=nullif(btrim(coalesce(p->>'imm_g','')),'')::numeric;
  v_sp:=nullif(btrim(coalesce(p->>'spotted_g','')),'')::numeric;
  k:=public.wms_compute_kor(v_gk,v_imm,v_sp);
  if k->>'status'<>'OK' then
    raise exception 'KOR NOT CALCULATED : Good Kernel, Immature et Spotted sont obligatoires (Blank ≠ 0)';
  end if;
  if v_gk<0 or v_imm<0 or v_sp<0 then raise exception 'Mesures négatives interdites'; end if;

  v_disp:=upper(btrim(coalesce(p->>'disposition','')));
  if v_disp not in ('READY','RE_DRY','HOLD') then raise exception 'Disposition obligatoire : READY | RE_DRY | HOLD'; end if;
  v_reason:=nullif(btrim(coalesce(p->>'decision_reason','')),'');
  if v_disp<>'READY' and v_reason is null then raise exception 'Motif obligatoire pour RE_DRY ou HOLD'; end if;

  select * into prev from public.wms_quality_snapshots
  where drying_id=d.id and lot_id=l.id and type='POST_DRY' and superseded_by is null
  order by created_at desc limit 1;

  perform pg_advisory_xact_lock(hashtext('wms_qlt_seq'));
  v_id:='QLT-'||lpad(public.wms_next_seq('QLT')::text,6,'0');

  insert into public.wms_quality_snapshots(
    id,reception_id,lot_id,drying_id,batch_id,cycle_no,dest_bin_id,type,
    gk_g,imm_g,spotted_g,moisture_pct,nut_count,weighted_kernel,kor_exact,kor_display,
    kor_factor,formula_version,analyst,note,created_by,idempotency_key,disposition,decision_reason
  ) values (
    v_id,l.reception_id,l.id,d.id,d.batch_id,d.cycle_no,d.dest_bin_id,'POST_DRY',
    v_gk,v_imm,v_sp,nullif(p->>'moisture_pct','')::numeric,nullif(p->>'nut_count','')::int,
    (k->>'weightedKernel')::numeric,(k->>'korExact')::numeric,(k->>'korDisplay')::numeric,
    (k->>'factor')::numeric,k->>'formulaVersion',c->>'nom',p->>'note',(c->>'uid')::uuid,
    v_key,v_disp,v_reason
  ) returning * into s;

  if prev.id is not null then
    update public.wms_quality_snapshots set superseded_by=s.id where id=prev.id;
    perform public.wms_audit(d.id,'POST_DRY.version',to_jsonb(prev.id),to_jsonb(s.id),
      coalesce(p->>'reason','Nouvelle version Post-Dry Quality'));
  end if;

  update public.wms_dryings
    set post_dry_snapshot_id=s.id,
        status=case v_disp when 'READY' then 'READY' when 'RE_DRY' then 'RE_DRY' else 'QUALITY_HOLD' end
  where id=d.id;

  perform public.wms_audit(d.id,'POST_DRY',null,
    jsonb_build_object('snapshot',s.id,'lot',l.id,'batch',d.batch_id,'cycle',d.cycle_no,
      'dest_bin',d.dest_bin_id,'kor',s.kor_display,'moisture',s.moisture_pct,'disposition',v_disp),
    coalesce(v_reason,'Post-Dry Quality'),c->>'nom');

  return to_jsonb(s)||jsonb_build_object('idempotent',false,'drying_status',
    case v_disp when 'READY' then 'READY' when 'RE_DRY' then 'RE_DRY' else 'QUALITY_HOLD' end);
end $$;

revoke all on function public.wms_save_post_dry_quality(text,text,jsonb) from public,anon;
grant execute on function public.wms_save_post_dry_quality(text,text,jsonb) to authenticated;

create or replace function public.wms_daily_closing(p_warehouse_id uuid,p_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  c jsonb; v_start timestamptz; v_end timestamptz;
  v_open numeric:=0; v_close numeric:=0; v_transit numeric:=0;
  v_receipts numeric:=0; v_tin numeric:=0; v_tout numeric:=0; v_loss numeric:=0; v_adj numeric:=0;
  v_expected numeric:=0; v_variance numeric:=0;
  v_wet numeric:=0; v_dry numeric:=0; v_hold numeric:=0; v_staging numeric:=0; v_drying numeric:=0;
begin
  c:=public.wms_ctx();
  if not exists(select 1 from public.wms_warehouses where id=p_warehouse_id) then raise exception 'Warehouse introuvable'; end if;
  v_start:=p_date::timestamptz;
  v_end:=(p_date+1)::timestamptz;

  with e as (
    select m.posted_at,m.source_type loc_type,m.source_id loc_id,-ml.qty_out delta
      from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id
      where m.status='POSTED' and m.warehouse_id=p_warehouse_id and m.source_type is not null
    union all
    select m.posted_at,m.dest_type,m.dest_id,ml.qty_in
      from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id
      where m.status='POSTED' and m.warehouse_id=p_warehouse_id and m.dest_type is not null
  )
  select
    coalesce(sum(delta) filter(where posted_at<v_start and loc_type in ('STAGING','BIN','DRYING')),0),
    coalesce(sum(delta) filter(where posted_at<v_end and loc_type in ('STAGING','BIN','DRYING')),0),
    coalesce(sum(delta) filter(where posted_at<v_end and loc_type='TRANSIT'),0),
    coalesce(sum(delta) filter(where posted_at<v_end and loc_type='STAGING'),0),
    coalesce(sum(delta) filter(where posted_at<v_end and loc_type='DRYING'),0)
  into v_open,v_close,v_transit,v_staging,v_drying
  from e;

  with e as (
    select m.posted_at,m.dest_id loc_id,ml.qty_in delta
      from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id
      where m.status='POSTED' and m.warehouse_id=p_warehouse_id and m.dest_type='BIN' and m.posted_at<v_end
    union all
    select m.posted_at,m.source_id loc_id,-ml.qty_out
      from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id
      where m.status='POSTED' and m.warehouse_id=p_warehouse_id and m.source_type='BIN' and m.posted_at<v_end
  )
  select
    coalesce(sum(e.delta) filter(where b.stock_type='WET'),0),
    coalesce(sum(e.delta) filter(where b.stock_type='DRY'),0),
    coalesce(sum(e.delta) filter(where b.stock_type='HOLD'),0)
  into v_wet,v_dry,v_hold
  from e join public.wms_bins b on b.id=e.loc_id;

  select
    coalesce(sum(qty_in) filter(where type='OFFLOAD'),0),
    coalesce(sum(qty_in) filter(where type='TRANSFER_IN'),0),
    coalesce(sum(qty_out) filter(where type='TRANSFER_OUT'),0),
    coalesce(sum(process_loss_kg),0),
    coalesce(sum(qty_in-qty_out) filter(where type='ADJUSTMENT'),0)
  into v_receipts,v_tin,v_tout,v_loss,v_adj
  from public.wms_movements
  where status='POSTED' and warehouse_id=p_warehouse_id and posted_at>=v_start and posted_at<v_end;

  v_expected:=round(v_open+v_receipts+v_tin-v_tout-v_loss+v_adj,3);
  v_variance:=round(v_close-v_expected,3);

  return jsonb_build_object(
    'date',p_date,'warehouse_id',p_warehouse_id,
    'opening_stock_kg',round(v_open,3),'receipts_kg',round(v_receipts,3),
    'transfers_in_kg',round(v_tin,3),'transfers_out_kg',round(v_tout,3),
    'process_loss_kg',round(v_loss,3),'inventory_adjustments_kg',round(v_adj,3),
    'expected_closing_kg',v_expected,'closing_stock_kg',round(v_close,3),
    'variance_kg',v_variance,'mass_balance_status',case when abs(v_variance)<=0.001 then 'BALANCED' else 'VARIANCE' end,
    'stock_wet_kg',round(v_wet,3),'stock_dry_kg',round(v_dry,3),'stock_hold_kg',round(v_hold,3),
    'stock_staging_kg',round(v_staging,3),'stock_drying_kg',round(v_drying,3),'stock_transit_kg',round(v_transit,3)
  );
end $$;

revoke all on function public.wms_daily_closing(uuid,date) from public,anon;
grant execute on function public.wms_daily_closing(uuid,date) to authenticated;
