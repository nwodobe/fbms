insert into public.wms_parameters(key, value, version, approved_by, reason)
select 'transferRoleMatrix', '{
  "transfer_request":         ["Storekeeper","Warehouse Manager","Supervisor","Head of Field","Procurement Officer","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_approve":         ["Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_cancel":          ["Warehouse Manager","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_load":            ["Storekeeper","Warehouse Manager","Supervisor","Factory User","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_dispatch":        ["Warehouse Manager","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_arrival":         ["Storekeeper","Warehouse Manager","Supervisor","Factory User","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_receive":         ["Storekeeper","Warehouse Manager","Supervisor","Factory User","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_resolve":         ["Warehouse Manager","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_resolve_approve": ["Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_close":           ["Warehouse Manager","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
  "transfer_correct_closed":  ["Branch Manager","General Manager"],
  "warehouse_scoped_roles":   ["Storekeeper","Warehouse Manager","Factory User"]
}'::jsonb, 1, 'système', 'Stock Transfer MVP — matrice initiale À VALIDER par ANAGROCI'
where not exists (select 1 from public.wms_parameters where key = 'transferRoleMatrix');
insert into public.wms_parameters(key, value, version, approved_by, reason)
select 'transferSettings', '{
  "status": "A_VALIDER",
  "varianceTolerancePct": null,
  "varianceToleranceKg": null,
  "allowSelfApprovalRequest": false,
  "allowSelfApprovalResolution": false,
  "transitOverdueHours": null,
  "arrivalPendingHours": null,
  "approvalPendingHours": null,
  "reservationExpiryHours": null,
  "loadDiffReapprovalPct": null,
  "sealMandatory": false,
  "mandatoryDocuments": [],
  "receivingQualityMandatory": false,
  "allowStagingDestination": true,
  "reasonCategories": ["WEIGHING_DIFFERENCE","DATA_ENTRY_ERROR","SCALE_CALIBRATION","BAG_COUNT","MOISTURE","TRANSIT_INCIDENT","PHYSICAL_LOSS","OTHER"],
  "note": "Tolérance null = non validée : toute variance non nulle exige un approbateur."
}'::jsonb, 1, 'système', 'Stock Transfer MVP — paramètres initiaux À VALIDER par ANAGROCI'
where not exists (select 1 from public.wms_parameters where key = 'transferSettings');
create table if not exists public.wms_transfers (
  id                   text primary key,
  status               text not null default 'REQUESTED'
    check (status in ('REQUESTED','APPROVED','READY_TO_LOAD','LOADED','IN_TRANSIT','ARRIVED',
                      'DISCREPANCY','RESOLUTION_PENDING','RECONCILED','CLOSED','REJECTED','CANCELLED')),
  is_test              boolean not null default false,
  origin_warehouse_id  uuid not null references public.wms_warehouses(id),
  dest_warehouse_id    uuid not null references public.wms_warehouses(id),
  purpose              text not null,
  priority             text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  planned_dispatch_at  timestamptz,
  request_doc_ref      text,
  request_note         text,
  planned_qty          numeric(14,3) not null check (planned_qty > 0),
  reserved_qty         numeric(14,3) not null default 0 check (reserved_qty >= 0),
  loaded_qty           numeric(14,3) check (loaded_qty is null or loaded_qty > 0),
  dispatched_qty       numeric(14,3) check (dispatched_qty is null or dispatched_qty > 0),
  received_qty         numeric(14,3) check (received_qty is null or received_qty >= 0),
  variance_kg          numeric(14,3),
  variance_pct         numeric(10,4),
  resolved_kg          numeric(14,3) not null default 0,
  anomaly              text check (anomaly is null or anomaly in ('NEGATIVE','POSITIVE')),
  requested_by uuid, requested_by_name text, requested_role text, requested_at timestamptz not null default now(),
  approved_by uuid, approved_by_name text, approved_at timestamptz, approval_comment text,
  rejected_by_name text, rejected_at timestamptz, reject_reason text,
  cancelled_by_name text, cancelled_at timestamptz, cancel_reason text,
  truck_plate text, transporter text, driver_name text, driver_phone text,
  seal_no text, seal_departure_condition text,
  loading_start timestamptz, loading_end timestamptz, bags_loaded integer check (bags_loaded is null or bags_loaded >= 0),
  gross_kg numeric(14,3), tare_kg numeric(14,3), net_kg numeric(14,3),
  weighbridge_ref text, load_doc_ref text, load_notes text, load_diff_reason text,
  loaded_by_name text, ready_at timestamptz, loaded_at timestamptz,
  dispatched_by uuid, dispatched_by_name text, departed_at timestamptz, eta_at timestamptz,
  arrived_at timestamptz, arrival_receiver text, arrival_truck text, arrival_seal_status text
    check (arrival_seal_status is null or arrival_seal_status in ('INTACT','BROKEN','MISMATCH','NOT_APPLICABLE')),
  arrival_seal_observed text, arrival_gate_ref text, arrival_comment text, arrival_by_name text,
  rc_gross_kg numeric(14,3), rc_tare_kg numeric(14,3), rc_net_kg numeric(14,3),
  bags_received integer check (bags_received is null or bags_received >= 0),
  rc_ticket text, rc_quality_ref text, rc_note text,
  rc_dest_type text check (rc_dest_type is null or rc_dest_type in ('BIN','STAGING')),
  rc_dest_id text,
  received_by uuid, received_by_name text, received_at timestamptz,
  reconciled_at timestamptz, reconciled_by_name text,
  closed_at timestamptz, closed_by_name text, close_note text,
  updated_at timestamptz not null default now(),
  constraint wms_transfers_origin_dest_diff check (origin_warehouse_id <> dest_warehouse_id),
  constraint wms_transfers_net_coherent check (gross_kg is null or tare_kg is null or net_kg is null or abs(gross_kg - tare_kg - net_kg) <= 0.001),
  constraint wms_transfers_rc_net_coherent check (rc_gross_kg is null or rc_tare_kg is null or rc_net_kg is null or abs(rc_gross_kg - rc_tare_kg - rc_net_kg) <= 0.001)
);
create index if not exists idx_wms_transfers_status on public.wms_transfers(status);
create index if not exists idx_wms_transfers_origin on public.wms_transfers(origin_warehouse_id);
create index if not exists idx_wms_transfers_dest   on public.wms_transfers(dest_warehouse_id);
create index if not exists idx_wms_transfers_truck  on public.wms_transfers(truck_plate);
create index if not exists idx_wms_transfers_dates  on public.wms_transfers(requested_at, departed_at, received_at);
create table if not exists public.wms_transfer_lines (
  id                   bigint generated always as identity primary key,
  transfer_id          text not null references public.wms_transfers(id),
  line_no              integer not null,
  source_bin_id        text not null references public.wms_bins(id),
  lot_id               text not null references public.wms_lots(id),
  available_at_request numeric(14,3) not null,
  requested_qty        numeric(14,3) not null check (requested_qty > 0),
  reserved_qty         numeric(14,3) not null default 0 check (reserved_qty >= 0),
  dispatched_qty       numeric(14,3) not null default 0 check (dispatched_qty >= 0),
  received_qty         numeric(14,3) not null default 0 check (received_qty >= 0),
  unique (transfer_id, source_bin_id, lot_id),
  unique (transfer_id, line_no)
);
create index if not exists idx_wms_trf_lines_binlot on public.wms_transfer_lines(source_bin_id, lot_id) where reserved_qty > 0;
create index if not exists idx_wms_trf_lines_lot on public.wms_transfer_lines(lot_id);
create table if not exists public.wms_transfer_ops (
  idempotency_key text primary key,
  transfer_id     text not null,
  action          text not null,
  result          jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_wms_trf_ops_trf on public.wms_transfer_ops(transfer_id);
create table if not exists public.wms_transfer_resolutions (
  id               text primary key,
  transfer_id      text not null references public.wms_transfers(id),
  kind             text not null check (kind in ('DISCREPANCY','CLOSED_CORRECTION')),
  direction        text not null check (direction in ('NEGATIVE','POSITIVE')),
  category         text not null,
  detailed_reason  text not null,
  responsible      text not null,
  investigation    text,
  evidence_ref     text,
  resolution       text not null,
  resolution_type  text not null check (resolution_type in ('WRITE_OFF','REWEIGH_CORRECTION','STOCK_GAIN','COMPENSATION')),
  qty_kg           numeric(14,3) not null check (qty_kg > 0),
  variance_pct     numeric(10,4),
  tolerance_snapshot jsonb,
  requires_approval boolean not null,
  status           text not null check (status in ('PENDING_APPROVAL','POSTED','REJECTED')),
  proposed_by uuid, proposed_by_name text, proposed_at timestamptz not null default now(),
  approved_by uuid, approved_by_name text, approved_at timestamptz, approval_comment text,
  movement_id      text references public.wms_movements(id)
);
create index if not exists idx_wms_trf_res_trf on public.wms_transfer_resolutions(transfer_id);
create unique index if not exists uq_wms_mov_transfer_out on public.wms_movements(reference_id, source_id)
  where type = 'TRANSFER_OUT' and status = 'POSTED' and reference_type = 'TRANSFER';
create unique index if not exists uq_wms_mov_transfer_in on public.wms_movements(reference_id)
  where type = 'TRANSFER_IN' and status = 'POSTED' and reference_type = 'TRANSFER';
create index if not exists idx_wms_mov_reference on public.wms_movements(reference_type, reference_id);
alter table public.wms_transfers            enable row level security;
alter table public.wms_transfer_lines       enable row level security;
alter table public.wms_transfer_ops         enable row level security;
alter table public.wms_transfer_resolutions enable row level security;
do $$
declare t text;
begin
  foreach t in array array['wms_transfers','wms_transfer_lines','wms_transfer_ops','wms_transfer_resolutions'] loop
    execute format('drop policy if exists %I on public.%I;', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.rcn_est_actif());', t||'_sel', t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated;', t);
    execute format('grant select on public.%I to authenticated;', t);
  end loop;
end $$;
create or replace function public.wms_trf_guard_header() returns trigger
language plpgsql set search_path = public as $$
declare ok boolean;
begin
  if tg_op = 'DELETE' then
    if old.is_test and session_user in ('postgres','supabase_admin') then return old; end if;
    raise exception 'Suppression interdite : un transfert ne se supprime pas (audit). Utilisez Cancel/Reject ou une correction compensatoire.' using errcode = '42501';
  end if;
  if old.status in ('CLOSED','REJECTED','CANCELLED') then
    raise exception 'Transfert % verrouillé (%) : modification directe interdite. Correction = opération compensatoire auditée.', old.id, old.status using errcode = '42501';
  end if;
  if new.status <> old.status then
    ok := case old.status
      when 'REQUESTED'          then new.status in ('APPROVED','REJECTED','CANCELLED')
      when 'APPROVED'           then new.status in ('READY_TO_LOAD','LOADED','CANCELLED')
      when 'READY_TO_LOAD'      then new.status in ('LOADED','CANCELLED')
      when 'LOADED'             then new.status in ('READY_TO_LOAD','IN_TRANSIT','CANCELLED')
      when 'IN_TRANSIT'         then new.status in ('ARRIVED')
      when 'ARRIVED'            then new.status in ('RECONCILED','DISCREPANCY')
      when 'DISCREPANCY'        then new.status in ('RESOLUTION_PENDING','RECONCILED')
      when 'RESOLUTION_PENDING' then new.status in ('DISCREPANCY','RECONCILED')
      when 'RECONCILED'         then new.status in ('CLOSED')
      else false end;
    if not ok then raise exception 'Transition de statut interdite : % -> %', old.status, new.status using errcode = '23514'; end if;
  end if;
  if old.departed_at is not null then
    if (new.origin_warehouse_id, new.dest_warehouse_id, new.truck_plate, new.transporter, new.driver_name, new.seal_no,
        new.gross_kg, new.tare_kg, new.net_kg, new.loaded_qty, new.dispatched_qty, new.departed_at, new.bags_loaded)
       is distinct from
       (old.origin_warehouse_id, old.dest_warehouse_id, old.truck_plate, old.transporter, old.driver_name, old.seal_no,
        old.gross_kg, old.tare_kg, old.net_kg, old.loaded_qty, old.dispatched_qty, old.departed_at, old.bags_loaded) then
      raise exception 'Transfert % déjà expédié : données Dispatch figées. Correction uniquement par procédure auditée.', old.id using errcode = '42501';
    end if;
  end if;
  if old.received_at is not null then
    if (new.rc_net_kg, new.rc_gross_kg, new.rc_tare_kg, new.received_qty, new.rc_dest_type, new.rc_dest_id, new.variance_kg)
       is distinct from (old.rc_net_kg, old.rc_gross_kg, old.rc_tare_kg, old.received_qty, old.rc_dest_type, old.rc_dest_id, old.variance_kg) then
      raise exception 'Transfert % déjà reçu : données Receipt et variance figées (aucune modification silencieuse).', old.id using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_wms_trf_guard_header on public.wms_transfers;
create trigger trg_wms_trf_guard_header before update or delete on public.wms_transfers
  for each row execute function public.wms_trf_guard_header();
create or replace function public.wms_trf_guard_child() returns trigger
language plpgsql set search_path = public as $$
declare t public.wms_transfers;
begin
  select * into t from public.wms_transfers where id = old.transfer_id;
  if tg_op = 'DELETE' then
    if coalesce(t.is_test, true) and session_user in ('postgres','supabase_admin') then return old; end if;
    raise exception 'Suppression interdite sur % (journal append-only).', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name = 'wms_transfer_lines' and t.status in ('CLOSED','REJECTED','CANCELLED') then
    raise exception 'Transfert % verrouillé : lignes non modifiables.', t.id using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_wms_trf_guard_lines on public.wms_transfer_lines;
create trigger trg_wms_trf_guard_lines before update or delete on public.wms_transfer_lines
  for each row execute function public.wms_trf_guard_child();
drop trigger if exists trg_wms_trf_guard_res on public.wms_transfer_resolutions;
create trigger trg_wms_trf_guard_res before delete on public.wms_transfer_resolutions
  for each row execute function public.wms_trf_guard_child();
create or replace function public.wms_trf_guard_ops() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and session_user in ('postgres','supabase_admin')
     and exists (select 1 from public.wms_transfers t where t.id = old.transfer_id and t.is_test) then return old; end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.wms_transfers t where t.id = old.transfer_id)
     and session_user in ('postgres','supabase_admin') then return old; end if;
  raise exception 'Registre d''idempotence append-only.' using errcode = '42501';
end $$;
drop trigger if exists trg_wms_trf_guard_ops on public.wms_transfer_ops;
create trigger trg_wms_trf_guard_ops before update or delete on public.wms_transfer_ops
  for each row execute function public.wms_trf_guard_ops();
create or replace function public.wms_trf_guard_movement() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.type in ('TRANSFER_OUT','TRANSFER_IN') or new.source_type = 'TRANSIT' or new.dest_type = 'TRANSIT' then
    if new.reference_type is distinct from 'TRANSFER'
       or coalesce(current_setting('wms.trf_ctx', true), '') = ''
       or current_setting('wms.trf_ctx', true) <> new.reference_id then
      raise exception 'Mouvement de transfert refusé : TRANSFER_OUT / TRANSFER_IN / TRANSIT ne se postent que via le workflow Stock Transfer.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_wms_trf_guard_movement on public.wms_movements;
create trigger trg_wms_trf_guard_movement before insert on public.wms_movements
  for each row execute function public.wms_trf_guard_movement();
create or replace function public.wms_trf_guard_reserved() returns trigger
language plpgsql set search_path = public as $$
declare m public.wms_movements; v_phys numeric; v_res numeric; v_own text;
begin
  if coalesce(new.qty_out, 0) <= 0 then return new; end if;
  select * into m from public.wms_movements where id = new.movement_id;
  if m.source_type is distinct from 'BIN' then return new; end if;
  v_own := case when m.type = 'TRANSFER_OUT' and m.reference_type = 'TRANSFER' then m.reference_id end;
  select coalesce(sum(l.reserved_qty), 0) into v_res
    from public.wms_transfer_lines l join public.wms_transfers t on t.id = l.transfer_id
   where l.source_bin_id = m.source_id and l.lot_id = new.lot_id and l.reserved_qty > 0
     and t.status in ('APPROVED','READY_TO_LOAD','LOADED') and t.id is distinct from v_own;
  if v_res <= 0 then return new; end if;
  select coalesce(sum(qty), 0) into v_phys from public.wms_v_balances
   where location_type = 'BIN' and location_id = m.source_id and lot_id = new.lot_id;
  if v_phys - new.qty_out + 0.0005 < v_res then
    raise exception 'Stock réservé : Lot % dans BIN % — physique % kg, réservé par transfert(s) % kg, sortie demandée % kg.',
      new.lot_id, m.source_id, round(v_phys,3), round(v_res,3), new.qty_out using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_wms_trf_guard_reserved on public.wms_movement_lots;
create trigger trg_wms_trf_guard_reserved before insert on public.wms_movement_lots
  for each row execute function public.wms_trf_guard_reserved();
