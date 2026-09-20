-- WMS · Warehouse Operations — couche transactionnelle canonique (schéma). Voir supabase/20260920_wms_warehouse_operations.sql
create extension if not exists "pgcrypto";

create table if not exists public.wms_parameters (
  id             uuid primary key default gen_random_uuid(),
  key            text not null,
  value          jsonb not null,
  version        int  not null default 1,
  effective_from timestamptz not null default now(),
  approved_by    text,
  reason         text,
  active         boolean not null default true,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists idx_wms_parameters_key on public.wms_parameters(key, active, effective_from desc);

insert into public.wms_parameters(key, value, reason, approved_by)
select v.key, v.value::jsonb, 'Valeur initiale MVP — à valider par ANAGROCI (cahier des charges §26)', null
from (values
  ('korFactor',                '{"factor":0.176,"formulaVersion":"v2.0","formula":"(GK + IMM/2 + SP/2) × factor","status":"A_VALIDER","note":"Fichier campagne = 0.176 ; moteur historique RCNTRACE = 0.17637"}'),
  ('korTolerance',             '{"value":1,"unit":"lb","status":"A_VALIDER"}'),
  ('duplicateTruckWindowMin',  '{"value":120}'),
  ('binCapacityAlertPct',      '{"value":90}'),
  ('binLossTolerancePct',      '{"value":1.5,"status":"A_VALIDER"}'),
  ('dryingLossTolerancePct',   '{"value":10,"status":"A_VALIDER","mode":"ALERT_ONLY"}'),
  ('moistureWetThresholdPct',  '{"value":10,"status":"A_VALIDER","mode":"INFO_ONLY"}'),
  ('wetStockAgingHours',       '{"value":48}')
) as v(key, value)
where not exists (select 1 from public.wms_parameters p where p.key = v.key);

create or replace function public.wms_param(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.wms_parameters
  where key = p_key and active and effective_from <= now()
  order by effective_from desc, version desc limit 1;
$$;

create table if not exists public.wms_warehouses (
  id           uuid primary key default gen_random_uuid(),
  site_code    text not null,
  code         text not null unique,
  name         text not null,
  location     text,
  status       text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  capacity_kg  numeric check (capacity_kg is null or capacity_kg >= 0),
  is_factory   boolean not null default false,
  created_by   uuid, created_at timestamptz not null default now(),
  updated_by   uuid, updated_at timestamptz not null default now()
);

create table if not exists public.wms_physical_areas (
  id           uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.wms_warehouses(id),
  code         text not null,
  description  text,
  capacity_kg  numeric check (capacity_kg is null or capacity_kg >= 0),
  status       text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by   uuid, created_at timestamptz not null default now(),
  updated_by   uuid, updated_at timestamptz not null default now(),
  unique (warehouse_id, code)
);

create table if not exists public.wms_sequences (
  key   text primary key,
  value bigint not null default 0
);
create or replace function public.wms_next_seq(p_key text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.wms_sequences(key, value) values (p_key, 1)
  on conflict (key) do update set value = public.wms_sequences.value + 1
  returning value into v;
  return v;
end $$;

create table if not exists public.wms_receptions (
  id              text primary key,
  warehouse_id    uuid not null references public.wms_warehouses(id),
  truck           text not null,
  supplier_name   text,
  supplier_code   text,
  origin          text,
  purchase_type   text,
  reference       text,
  expected_kg     numeric check (expected_kg is null or expected_kg >= 0),
  expected_bags   int     check (expected_bags is null or expected_bags >= 0),
  arrival_at      timestamptz not null default now(),
  driver          text, transporter text,
  status          text not null default 'ARRIVED' check (status in (
                    'ARRIVED','AWAITING_DECISION','REJECTED','ACCEPTED_WAITING_OFFLOAD',
                    'AWAITING_FINAL_QA','QUALITY_HOLD','RELEASED','CLOSED')),
  decision        text check (decision is null or decision in ('ACCEPTED','REJECTED')),
  decision_comment text, decided_by uuid, decided_by_name text, decided_at timestamptz,
  gross_kg numeric, tare_kg numeric, net_kg numeric check (net_kg is null or net_kg > 0),
  bags int, bags_good int, bags_wet int, bags_torn int, bags_recond int,
  weighbridge_ticket text, delivery_note text, warehouse_receipt text,
  offload_start timestamptz, offload_end timestamptz, offloaded_by uuid, offloaded_at timestamptz,
  hold_reason     text,
  lot_id          text,
  idempotency_key text unique,
  created_by      uuid, created_by_name text, created_at timestamptz not null default now(),
  updated_by      uuid, updated_at timestamptz not null default now()
);
create index if not exists idx_wms_receptions_truck on public.wms_receptions(truck, arrival_at);
create index if not exists idx_wms_receptions_status on public.wms_receptions(status);
create index if not exists idx_wms_receptions_wh on public.wms_receptions(warehouse_id);

create table if not exists public.wms_quality_snapshots (
  id               text primary key,
  reception_id     text references public.wms_receptions(id),
  lot_id           text,
  drying_id        text,
  type             text not null check (type in ('SAMPLING','FINAL','POST_DRY')),
  gk_g             numeric, imm_g numeric, spotted_g numeric,
  moisture_pct     numeric, nut_count int,
  browns_g numeric, voids_g numeric, oil_g numeric,
  weighted_kernel  numeric,
  kor_exact        numeric,
  kor_display      numeric(8,2),
  kor_factor       numeric not null,
  formula_version  text not null,
  delta_vs_sampling numeric,
  within_tolerance boolean,
  analyst          text,
  note             text,
  superseded_by    text,
  created_by       uuid, created_at timestamptz not null default now()
);
create index if not exists idx_wms_qs_rec on public.wms_quality_snapshots(reception_id, type, created_at desc);

create table if not exists public.wms_lots (
  id             text primary key,
  reception_id   text not null unique references public.wms_receptions(id),
  warehouse_id   uuid not null references public.wms_warehouses(id),
  truck          text, supplier_name text, supplier_code text, origin text,
  initial_kg     numeric not null check (initial_kg > 0),
  initial_bags   int,
  kor_sampling   numeric, kor_final numeric, moisture_final numeric, nut_count_final int,
  status         text not null default 'RELEASED' check (status in ('RELEASED','HOLD','EXHAUSTED','CLOSED')),
  created_by     uuid, created_by_name text, created_at timestamptz not null default now()
);

create table if not exists public.wms_bins (
  id                 text primary key,
  warehouse_id       uuid not null references public.wms_warehouses(id),
  physical_area_id   uuid references public.wms_physical_areas(id),
  stock_type         text not null check (stock_type in ('WET','DRY','HOLD')),
  capacity_kg        numeric check (capacity_kg is null or capacity_kg > 0),
  status             text not null default 'OPEN' check (status in ('OPEN','ACTIVE','BLOCKED','READY_TO_CLOSE','CLOSED')),
  block_reason       text,
  physical_empty     boolean,
  residue_kg         numeric,
  closure_reason     text,
  closed_by          uuid, closed_by_name text, closed_at timestamptz,
  validated_by       uuid, validated_by_name text,
  reopen_count       int not null default 0,
  opened_by          uuid, opened_at timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_wms_bins_wh on public.wms_bins(warehouse_id, status);
create unique index if not exists uq_wms_bins_area_open on public.wms_bins(physical_area_id) where status <> 'CLOSED' and physical_area_id is not null;

create table if not exists public.wms_movements (
  id               text primary key,
  idempotency_key  text not null unique,
  type             text not null check (type in ('OFFLOAD','BIN_TRANSFER','DRYING_ISSUE','DRYING_RECEIPT','SORTING','TRANSFER_OUT','TRANSFER_IN','PRODUCTION_ISSUE','ADJUSTMENT')),
  warehouse_id     uuid references public.wms_warehouses(id),
  source_type      text check (source_type is null or source_type in ('TRUCK','STAGING','BIN','DRYING','TRANSIT','PRODUCTION','ADJUSTMENT')),
  source_id        text,
  dest_type        text check (dest_type is null or dest_type in ('TRUCK','STAGING','BIN','DRYING','TRANSIT','PRODUCTION','ADJUSTMENT')),
  dest_id          text,
  qty_out          numeric not null default 0 check (qty_out >= 0),
  qty_in           numeric not null default 0 check (qty_in >= 0),
  process_loss_kg  numeric not null default 0 check (process_loss_kg >= 0),
  variance_kg      numeric not null default 0,
  reference_type   text, reference_id text,
  truck text, supplier_name text, origin text,
  reason           text,
  status           text not null default 'POSTED' check (status in ('POSTED','REVERSED')),
  reversal_of      text,
  approved_by      text,
  created_by       uuid, created_by_name text, created_role text,
  posted_at        timestamptz not null default now()
);
create index if not exists idx_wms_mov_src on public.wms_movements(source_type, source_id);
create index if not exists idx_wms_mov_dst on public.wms_movements(dest_type, dest_id);
create index if not exists idx_wms_mov_ref on public.wms_movements(reference_type, reference_id);

create table if not exists public.wms_movement_lots (
  movement_id  text not null references public.wms_movements(id),
  lot_id       text not null references public.wms_lots(id),
  qty_out      numeric not null default 0 check (qty_out >= 0),
  qty_in       numeric not null default 0 check (qty_in >= 0),
  primary key (movement_id, lot_id)
);
create index if not exists idx_wms_movlots_lot on public.wms_movement_lots(lot_id);

create table if not exists public.wms_dryings (
  id                 text primary key,
  warehouse_id       uuid not null references public.wms_warehouses(id),
  type               text not null check (type in ('DRYING','SORTING')),
  batch_id           text not null,
  parent_drying_id   text references public.wms_dryings(id),
  cycle_no           int not null default 1,
  source_bin_id      text not null references public.wms_bins(id),
  dest_bin_id        text not null references public.wms_bins(id),
  input_kg           numeric not null check (input_kg > 0),
  output_kg          numeric not null check (output_kg >= 0),
  input_bags int, output_bags int,
  moisture_before numeric, moisture_after numeric,
  nc_before int, nc_after int,
  kor_before numeric, kor_after numeric,
  process_loss_kg    numeric not null,
  process_loss_pct   numeric not null,
  loss_alert         boolean not null default false,
  issue_movement_id  text references public.wms_movements(id),
  receipt_movement_id text references public.wms_movements(id),
  post_dry_snapshot_id text,
  status             text not null default 'COMPLETED' check (status in ('COMPLETED','WEATHER_HOLD','CANCELLED')),
  note               text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now()
);
create index if not exists idx_wms_dryings_batch on public.wms_dryings(batch_id, cycle_no);

create table if not exists public.wms_inventory_counts (
  id                text primary key,
  warehouse_id      uuid not null references public.wms_warehouses(id),
  bin_id            text not null references public.wms_bins(id),
  theoretical_kg    numeric not null,
  physical_kg       numeric not null check (physical_kg >= 0),
  variance_kg       numeric not null,
  status            text not null default 'CLOSED' check (status in ('CLOSED','REVIEW_REQUIRED','ADJUSTED','REJECTED')),
  note              text,
  idempotency_key   text unique,
  counted_by uuid, counted_by_name text, counted_at timestamptz not null default now(),
  review_reason     text,
  approved_by uuid, approved_by_name text, approved_at timestamptz,
  adjustment_movement_id text references public.wms_movements(id)
);

create or replace view public.wms_v_balances as
with x as (
  select m.dest_type as location_type, m.dest_id as location_id, ml.lot_id, ml.qty_in as delta
  from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id = m.id
  where m.status = 'POSTED' and m.dest_type is not null and ml.qty_in > 0
  union all
  select m.source_type, m.source_id, ml.lot_id, -ml.qty_out
  from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id = m.id
  where m.status = 'POSTED' and m.source_type is not null and ml.qty_out > 0
)
select location_type, location_id, lot_id, round(sum(delta)::numeric, 3) as qty
from x group by location_type, location_id, lot_id;

create or replace view public.wms_v_bin_contributors as
select b.id as bin_id, v.lot_id, l.supplier_name, l.origin, l.truck, l.kor_final, l.moisture_final,
       coalesce(sum(ml.qty_in) filter (where m.dest_type='BIN' and m.dest_id=b.id),0) as qty_in,
       coalesce(sum(ml.qty_out) filter (where m.source_type='BIN' and m.source_id=b.id),0) as qty_out,
       v.qty as remaining_kg
from public.wms_bins b
join public.wms_v_balances v on v.location_type='BIN' and v.location_id=b.id
join public.wms_lots l on l.id=v.lot_id
left join public.wms_movement_lots ml on ml.lot_id=v.lot_id
left join public.wms_movements m on m.id=ml.movement_id and m.status='POSTED'
   and ((m.dest_type='BIN' and m.dest_id=b.id) or (m.source_type='BIN' and m.source_id=b.id))
group by b.id, v.lot_id, l.supplier_name, l.origin, l.truck, l.kor_final, l.moisture_final, v.qty;

create or replace view public.wms_v_bins as
select b.*, w.code as warehouse_code, w.name as warehouse_name, w.site_code, a.code as area_code,
       coalesce((select sum(qty) from public.wms_v_balances v where v.location_type='BIN' and v.location_id=b.id),0) as balance_kg,
       coalesce((select sum(ml.qty_in) from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id where m.status='POSTED' and m.dest_type='BIN' and m.dest_id=b.id),0) as total_in_kg,
       coalesce((select sum(ml.qty_out) from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id where m.status='POSTED' and m.source_type='BIN' and m.source_id=b.id),0) as total_out_kg,
       (select count(*) from public.wms_v_balances v where v.location_type='BIN' and v.location_id=b.id and v.qty > 0.0005) as contributors,
       case when b.capacity_kg is null or b.capacity_kg=0 then null
            else round(100*coalesce((select sum(qty) from public.wms_v_balances v where v.location_type='BIN' and v.location_id=b.id),0)/b.capacity_kg,1) end as occupancy_pct,
       (select min(m.posted_at) from public.wms_movements m where m.status='POSTED' and m.dest_type='BIN' and m.dest_id=b.id) as first_entry_at,
       round(extract(epoch from (coalesce(b.closed_at, now()) - coalesce((select min(m.posted_at) from public.wms_movements m where m.status='POSTED' and m.dest_type='BIN' and m.dest_id=b.id), b.opened_at)))/3600.0,1) as age_hours
from public.wms_bins b
join public.wms_warehouses w on w.id=b.warehouse_id
left join public.wms_physical_areas a on a.id=b.physical_area_id;

create or replace view public.wms_v_lots as
select l.*, w.code as warehouse_code, r.status as reception_status,
       coalesce((select sum(qty) from public.wms_v_balances v where v.lot_id=l.id and v.location_type='STAGING'),0) as staging_kg,
       coalesce((select sum(qty) from public.wms_v_balances v where v.lot_id=l.id and v.location_type='BIN'),0) as bin_kg,
       coalesce((select sum(qty) from public.wms_v_balances v where v.lot_id=l.id and v.location_type='DRYING'),0) as drying_kg,
       coalesce((select sum(qty) from public.wms_v_balances v where v.lot_id=l.id and v.location_type='TRANSIT'),0) as transit_kg,
       coalesce((select sum(qty) from public.wms_v_balances v where v.lot_id=l.id and v.location_type in ('STAGING','BIN','DRYING','TRANSIT')),0) as current_kg,
       (select count(*) from public.wms_v_balances v where v.lot_id=l.id and v.location_type='BIN' and v.qty>0.0005) as bin_count
from public.wms_lots l
join public.wms_warehouses w on w.id=l.warehouse_id
left join public.wms_receptions r on r.id=l.reception_id;

create or replace view public.wms_v_quality_current as
select distinct on (reception_id, type) *
from public.wms_quality_snapshots
where superseded_by is null and reception_id is not null
order by reception_id, type, created_at desc;

create or replace view public.wms_v_receptions as
select r.*, w.code as warehouse_code, w.name as warehouse_name, w.site_code,
       s.id as sampling_id, s.kor_display as sampling_kor, s.moisture_pct as sampling_moisture, s.nut_count as sampling_nc, s.created_at as sampling_at,
       f.id as final_id, f.kor_display as final_kor, f.moisture_pct as final_moisture, f.nut_count as final_nc, f.delta_vs_sampling as kor_delta, f.within_tolerance, f.created_at as final_at,
       case r.status
         when 'ARRIVED' then 'SAMPLING'
         when 'AWAITING_DECISION' then 'DECISION'
         when 'ACCEPTED_WAITING_OFFLOAD' then 'OFFLOAD'
         when 'AWAITING_FINAL_QA' then case when f.id is null then 'FINAL_QA' else 'RELEASE' end
         when 'QUALITY_HOLD' then 'RESOLVE_HOLD'
         when 'RELEASED' then 'ALLOCATE_BIN'
         else null end as next_action,
       round(extract(epoch from (now() - r.arrival_at))/3600.0,1) as age_hours
from public.wms_receptions r
join public.wms_warehouses w on w.id=r.warehouse_id
left join public.wms_v_quality_current s on s.reception_id=r.id and s.type='SAMPLING'
left join public.wms_v_quality_current f on f.reception_id=r.id and f.type='FINAL';

create or replace view public.wms_v_movements as
select m.*, w.code as warehouse_code,
       (select jsonb_agg(jsonb_build_object('lot_id', ml.lot_id, 'qty_out', ml.qty_out, 'qty_in', ml.qty_in) order by ml.lot_id)
          from public.wms_movement_lots ml where ml.movement_id=m.id) as lots
from public.wms_movements m left join public.wms_warehouses w on w.id=m.warehouse_id;

create or replace view public.wms_v_audit as
select a.id, a.objet, a.champ, a.avant, a.apres, a.motif, a.approbateur, a.auteur, a.role, a.created_at,
       case when a.objet like 'REC-%' then 'RECEPTION' when a.objet like 'RCN-%' then 'LOT'
            when a.objet like 'MOV-%' then 'MOVEMENT' when a.objet like 'DRY-%' then 'DRYING'
            when a.objet like 'INV-%' then 'INVENTORY' when a.objet like 'QLT-%' then 'QUALITY'
            when a.objet like 'WH:%' or a.objet like 'AREA:%' then 'MASTER_DATA'
            when a.objet like 'PARAM:%' then 'PARAMETER' when a.objet like 'BAG%' or a.objet like 'JUT-%' then 'BAG'
            when a.objet ~ '^[A-Z0-9]+-[A-Z0-9]+-(WET|DRY|HOLD)-[0-9]{2}-[0-9]+' then 'BIN'
            else 'OTHER' end as object_type
from public.rcn_audit a;

create or replace view public.wms_v_bag_supplier_balance as
select b.supplier_code, f.nom as supplier_name, b.issued, b.returned, b.approved_loss, b.balance, b.last_movement
from public.rcn_jute_v_supplier_balance b left join public.rcn_fournisseurs f on f.code=b.supplier_code;

do $$
declare t text;
begin
  foreach t in array array['wms_parameters','wms_warehouses','wms_physical_areas','wms_sequences','wms_receptions',
    'wms_quality_snapshots','wms_lots','wms_bins','wms_movements','wms_movement_lots','wms_dryings','wms_inventory_counts']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_sel on public.%I;', t, t);
    execute format('create policy %I_sel on public.%I for select using (public.rcn_est_actif());', t, t);
    execute format('drop policy if exists %I_ins on public.%I;', t, t);
    execute format('drop policy if exists %I_upd on public.%I;', t, t);
    execute format('drop policy if exists %I_del on public.%I;', t, t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated;', t);
    execute format('grant select on public.%I to authenticated;', t);
  end loop;
end $$;
revoke all on public.wms_sequences from anon, authenticated;
grant select on public.wms_v_balances, public.wms_v_bin_contributors, public.wms_v_bins, public.wms_v_lots,
  public.wms_v_quality_current, public.wms_v_receptions, public.wms_v_movements, public.wms_v_audit,
  public.wms_v_bag_supplier_balance to authenticated;

revoke update, delete, truncate on public.rcn_audit from anon, authenticated;
