create or replace function public.wms_trf_create_request(p jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; v_o uuid; v_d uuid; ow public.wms_warehouses; dw public.wms_warehouses;
        ln jsonb; b public.wms_bins; lt public.wms_lots; v_qty numeric; v_av numeric; v_tot numeric; v_acc numeric; v_share numeric;
        rec record; n int; i int; v_id text; v_day text; v_test boolean := false; v_total numeric := 0; v_line int := 0;
begin
  v_o := nullif(p->>'origin_warehouse_id','')::uuid; v_d := nullif(p->>'dest_warehouse_id','')::uuid;
  c := public.wms_trf_require('transfer_request', v_o);
  r := public.wms_trf_op_check(p_idempotency_key, null, 'REQUEST'); if r is not null then return r; end if;
  select * into ow from public.wms_warehouses where id = v_o;
  select * into dw from public.wms_warehouses where id = v_d;
  if ow.id is null then raise exception 'Origin Warehouse introuvable (référentiel obligatoire)' using errcode = '23503'; end if;
  if dw.id is null then raise exception 'Destination Warehouse introuvable (référentiel obligatoire)' using errcode = '23503'; end if;
  if ow.id = dw.id then raise exception 'Origin = Destination (%) : un mouvement dans le même Warehouse est un BIN TRANSFER du module Warehouse, pas un Stock Transfer.', ow.code using errcode = '23514'; end if;
  if ow.status <> 'ACTIVE' or dw.status <> 'ACTIVE' then raise exception 'Warehouse inactif : origine % (%), destination % (%)', ow.code, ow.status, dw.code, dw.status using errcode = '23514'; end if;
  if coalesce(p->>'source_kind','') = 'LBA_DIRECT' then raise exception 'Une livraison LBA directe Factory n''est pas un Stock Transfer : utilisez Factory Reception.' using errcode = '23514'; end if;
  if coalesce(btrim(p->>'purpose'),'') = '' then raise exception 'Purpose obligatoire'; end if;
  if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Au moins une ligne matière (BIN/Lot) est obligatoire'; end if;
  if coalesce(btrim(p->>'test_tag'),'') <> '' then
    if ow.code not like 'TEST\_%' or dw.code not like 'TEST\_%' then raise exception 'Un transfert TEST exige des Warehouses TEST_* (isolation des données de campagne)'; end if;
    v_test := true;
  end if;

  create temp table if not exists _trf_new_lines(bin_id text, lot_id text, qty numeric, avail numeric) on commit drop;
  truncate _trf_new_lines;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    v_qty := nullif(ln->>'qty','')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Requested Qty invalide (%) : doit être > 0', coalesce(ln->>'qty','vide') using errcode = '23514'; end if;
    select * into b from public.wms_bins where id = ln->>'bin_id';
    if b.id is null then raise exception 'BIN % inexistant', coalesce(ln->>'bin_id','?') using errcode = '23503'; end if;
    if b.warehouse_id <> ow.id then raise exception 'BIN % n''appartient pas au Warehouse d''origine %', b.id, ow.code using errcode = '23514'; end if;
    if b.status in ('CLOSED','BLOCKED') then raise exception 'BIN % est % : aucune sortie possible', b.id, b.status using errcode = '23514'; end if;
    if coalesce(ln->>'lot_id','') <> '' then
      select * into lt from public.wms_lots where id = ln->>'lot_id';
      if lt.id is null then raise exception 'Lot % inexistant', ln->>'lot_id' using errcode = '23503'; end if;
      if lt.status = 'HOLD' then raise exception 'Lot % en HOLD : transfert interdit', lt.id using errcode = '23514'; end if;
      select coalesce(sum(available_kg),0) into v_av from public.wms_v_bin_lot_available where bin_id = b.id and lot_id = lt.id;
      if v_av <= 0.0005 then raise exception 'Lot % sans stock disponible dans le BIN %', lt.id, b.id using errcode = '23514'; end if;
      if v_qty > v_av + 0.0005 then raise exception 'Requested Qty (% kg) > Available Stock (% kg) — Lot % / BIN %', v_qty, round(v_av,3), lt.id, b.id using errcode = '23514'; end if;
      insert into _trf_new_lines values (b.id, lt.id, v_qty, v_av);
    else
      select coalesce(sum(available_kg),0), count(*) into v_tot, n from public.wms_v_bin_lot_available
        where bin_id = b.id and available_kg > 0.0005 and lot_status <> 'HOLD';
      if v_tot <= 0.0005 then raise exception 'BIN % sans stock disponible', b.id using errcode = '23514'; end if;
      if v_qty > v_tot + 0.0005 then raise exception 'Requested Qty (% kg) > Available Stock (% kg) du BIN %', v_qty, round(v_tot,3), b.id using errcode = '23514'; end if;
      i := 0; v_acc := 0;
      for rec in select lot_id, available_kg from public.wms_v_bin_lot_available
                 where bin_id = b.id and available_kg > 0.0005 and lot_status <> 'HOLD' order by available_kg desc, lot_id loop
        i := i + 1;
        if i = n then v_share := round(v_qty - v_acc, 3); else v_share := round(v_qty * rec.available_kg / v_tot, 3); end if;
        if v_share > rec.available_kg then v_share := rec.available_kg; end if;
        v_acc := v_acc + v_share;
        if v_share > 0 then insert into _trf_new_lines values (b.id, rec.lot_id, v_share, rec.available_kg); end if;
      end loop;
    end if;
  end loop;
  for rec in select bin_id, lot_id, sum(qty) q, max(avail) a from _trf_new_lines group by 1,2 loop
    if rec.q > rec.a + 0.0005 then raise exception 'Requested Qty cumulée (% kg) > Available Stock (% kg) — Lot % / BIN %', rec.q, round(rec.a,3), rec.lot_id, rec.bin_id using errcode = '23514'; end if;
    v_total := v_total + rec.q;
  end loop;

  perform pg_advisory_xact_lock(hashtext('wms_trf_seq'));
  v_day := to_char(now() at time zone 'UTC', 'YYYYMMDD');
  if v_test then v_id := 'TEST_TRF_' || regexp_replace(p->>'test_tag', '[^A-Za-z0-9]', '', 'g') || '_' || lpad(public.wms_next_seq('TRFTEST:'||(p->>'test_tag'))::text, 3, '0');
  else v_id := 'TRF-' || v_day || '-' || lpad(public.wms_next_seq('TRF:'||v_day)::text, 3, '0'); end if;

  insert into public.wms_transfers(id, is_test, origin_warehouse_id, dest_warehouse_id, purpose, priority, planned_dispatch_at,
      request_doc_ref, request_note, planned_qty, requested_by, requested_by_name, requested_role)
  values (v_id, v_test, ow.id, dw.id, btrim(p->>'purpose'), coalesce(nullif(p->>'priority',''),'NORMAL'), nullif(p->>'planned_dispatch_at','')::timestamptz,
      nullif(p->>'request_doc_ref',''), nullif(p->>'request_note',''), v_total, (c->>'uid')::uuid, c->>'nom', c->>'role');
  for rec in select bin_id, lot_id, sum(qty) q, max(avail) a from _trf_new_lines group by 1,2 order by 1,2 loop
    v_line := v_line + 1;
    insert into public.wms_transfer_lines(transfer_id, line_no, source_bin_id, lot_id, available_at_request, requested_qty)
    values (v_id, v_line, rec.bin_id, rec.lot_id, rec.a, rec.q);
  end loop;
  r := public.wms_trf_snapshot(v_id) || jsonb_build_object('lines', v_line, 'origin', ow.code, 'destination', dw.code);
  insert into public.wms_transfer_ops(idempotency_key, transfer_id, action, result, created_by) values (p_idempotency_key, v_id, 'REQUEST', r, (c->>'uid')::uuid);
  perform public.wms_trf_audit(v_id, 'REQUEST', null, r, coalesce(p->>'purpose','Transfer Request'));
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_approve(p_id text, p_comment text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb; rec record; v_phys numeric; v_res numeric; v_total numeric := 0; st jsonb;
begin
  c := public.wms_trf_require('transfer_approve');
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'APPROVE'); if r is not null then return r; end if;
  if t.status <> 'REQUESTED' then raise exception 'Approve impossible au statut % (attendu REQUESTED)', t.status using errcode = '23514'; end if;
  st := public.wms_trf_settings();
  if t.requested_by = (c->>'uid')::uuid and not coalesce((st->>'allowSelfApprovalRequest')::boolean, false) then
    raise exception 'Séparation des tâches : le demandeur ne peut pas approuver sa propre demande (paramètre allowSelfApprovalRequest).' using errcode = '42501';
  end if;
  v_before := public.wms_trf_snapshot(p_id);
  for rec in select distinct source_bin_id from public.wms_transfer_lines where transfer_id = p_id order by 1 loop
    perform pg_advisory_xact_lock(hashtext('wms_loc:BIN:'||rec.source_bin_id));
  end loop;
  for rec in select l.*, b.status as bin_status, lo.status as lot_status from public.wms_transfer_lines l
             join public.wms_bins b on b.id = l.source_bin_id join public.wms_lots lo on lo.id = l.lot_id
             where l.transfer_id = p_id order by l.line_no loop
    if rec.bin_status in ('CLOSED','BLOCKED') then raise exception 'BIN % est % : réservation impossible', rec.source_bin_id, rec.bin_status using errcode = '23514'; end if;
    if rec.lot_status = 'HOLD' then raise exception 'Lot % en HOLD : réservation impossible', rec.lot_id using errcode = '23514'; end if;
    select coalesce(sum(qty),0) into v_phys from public.wms_v_balances where location_type='BIN' and location_id=rec.source_bin_id and lot_id=rec.lot_id;
    select coalesce(sum(l2.reserved_qty),0) into v_res from public.wms_transfer_lines l2 join public.wms_transfers t2 on t2.id = l2.transfer_id
      where l2.source_bin_id=rec.source_bin_id and l2.lot_id=rec.lot_id and t2.status in ('APPROVED','READY_TO_LOAD','LOADED') and t2.id <> p_id;
    if rec.requested_qty > v_phys - v_res + 0.0005 then
      raise exception 'Stock disponible insuffisant : Lot % / BIN % — physique % kg, déjà réservé % kg, demandé % kg. Aucune double réservation.',
        rec.lot_id, rec.source_bin_id, round(v_phys,3), round(v_res,3), rec.requested_qty using errcode = '23514';
    end if;
    update public.wms_transfer_lines set reserved_qty = requested_qty where id = rec.id;
    v_total := v_total + rec.requested_qty;
  end loop;
  update public.wms_transfers set status='APPROVED', reserved_qty=v_total, approved_by=(c->>'uid')::uuid, approved_by_name=c->>'nom',
         approved_at=now(), approval_comment=nullif(btrim(coalesce(p_comment,'')),'') where id = p_id;
  r := public.wms_trf_snapshot(p_id);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'APPROVE', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'APPROVE', v_before, r, coalesce(nullif(btrim(coalesce(p_comment,'')),''),'Approbation + réservation'), c->>'nom');
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_reject(p_id text, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb;
begin
  c := public.wms_trf_require('transfer_approve');
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'REJECT'); if r is not null then return r; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Reject : motif obligatoire' using errcode = '23514'; end if;
  if t.status <> 'REQUESTED' then raise exception 'Reject impossible au statut % (attendu REQUESTED ; après approbation utilisez Cancel)', t.status using errcode = '23514'; end if;
  v_before := public.wms_trf_snapshot(p_id);
  update public.wms_transfers set status='REJECTED', rejected_by_name=c->>'nom', rejected_at=now(), reject_reason=btrim(p_reason) where id = p_id;
  r := public.wms_trf_snapshot(p_id);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'REJECT', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'REJECT', v_before, r, btrim(p_reason), c->>'nom');
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_cancel(p_id text, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb;
begin
  c := public.wms_ctx();
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  if not (t.requested_by = (c->>'uid')::uuid and t.status = 'REQUESTED') then c := public.wms_trf_require('transfer_cancel', t.origin_warehouse_id); end if;
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'CANCEL'); if r is not null then return r; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Cancel : motif obligatoire' using errcode = '23514'; end if;
  if t.status not in ('REQUESTED','APPROVED','READY_TO_LOAD','LOADED') then
    raise exception 'Cancel impossible au statut % : après Dispatch une opération ne disparaît pas — correction par procédure auditée.', t.status using errcode = '23514';
  end if;
  v_before := public.wms_trf_snapshot(p_id);
  update public.wms_transfer_lines set reserved_qty = 0 where transfer_id = p_id and reserved_qty <> 0;
  update public.wms_transfers set status='CANCELLED', reserved_qty=0, cancelled_by_name=c->>'nom', cancelled_at=now(), cancel_reason=btrim(p_reason) where id = p_id;
  r := public.wms_trf_snapshot(p_id);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'CANCEL', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'CANCEL', v_before, r, btrim(p_reason));
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_save_load(p_id text, p jsonb, p_confirm boolean, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb; g numeric; ta numeric; ne numeric; st jsonb; v_action text;
begin
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_load', t.origin_warehouse_id);
  v_action := case when p_confirm then 'LOAD_CONFIRM' else 'LOAD_SAVE' end;
  r := public.wms_trf_op_check(p_idempotency_key, p_id, v_action); if r is not null then return r; end if;
  if t.status not in ('APPROVED','READY_TO_LOAD','LOADED') then
    raise exception 'Chargement impossible au statut % (attendu APPROVED / READY_TO_LOAD / LOADED)', t.status using errcode = '23514';
  end if;
  st := public.wms_trf_settings();
  g := nullif(p->>'gross_kg','')::numeric; ta := nullif(p->>'tare_kg','')::numeric; ne := nullif(p->>'net_kg','')::numeric;
  if g is not null and g <= 0 then raise exception 'Gross Weight invalide' using errcode = '23514'; end if;
  if ta is not null and ta < 0 then raise exception 'Tare Weight invalide' using errcode = '23514'; end if;
  if g is not null and ta is not null then
    if ta >= g then raise exception 'Tare (% kg) ≥ Gross (% kg) : Net invalide', ta, g using errcode = '23514'; end if;
    if ne is not null and abs(ne - (g - ta)) > 0.001 then raise exception 'Net saisi (% kg) ≠ Gross − Tare (% kg)', ne, g - ta using errcode = '23514'; end if;
    ne := g - ta;
  end if;
  if ne is not null and ne <= 0 then raise exception 'Net Weight doit être > 0' using errcode = '23514'; end if;
  if ne is not null and ne > t.reserved_qty + 0.0005 then
    raise exception 'Quantité chargée (% kg) > quantité réservée (% kg) : créez une demande complémentaire.', ne, t.reserved_qty using errcode = '23514';
  end if;
  if p_confirm then
    if ne is null then raise exception 'Confirm Loaded : Net Weight (ou Gross + Tare) obligatoire' using errcode = '23514'; end if;
    if coalesce(btrim(p->>'truck_plate'),'') = '' or coalesce(btrim(p->>'transporter'),'') = '' or coalesce(btrim(p->>'driver_name'),'') = '' then
      raise exception 'Confirm Loaded : Truck Plate, Transporter et Driver Name obligatoires' using errcode = '23514';
    end if;
    if coalesce((st->>'sealMandatory')::boolean,false) and coalesce(btrim(p->>'seal_no'),'') = '' then raise exception 'Seal Number obligatoire (paramètre sealMandatory)' using errcode = '23514'; end if;
    if abs(ne - t.reserved_qty) > 0.0005 and coalesce(btrim(p->>'load_diff_reason'),'') = '' then
      raise exception 'Loaded (% kg) ≠ Approved (% kg) : motif de différence obligatoire', ne, t.reserved_qty using errcode = '23514';
    end if;
    if (st->>'loadDiffReapprovalPct') is not null and t.reserved_qty > 0
       and abs(ne - t.reserved_qty) / t.reserved_qty * 100 > (st->>'loadDiffReapprovalPct')::numeric then
      raise exception 'Différence Loaded/Approved au-delà du seuil de ré-approbation (% %%)', st->>'loadDiffReapprovalPct' using errcode = '23514';
    end if;
  end if;
  v_before := public.wms_trf_snapshot(p_id) || jsonb_build_object('truck', t.truck_plate, 'net_kg', t.net_kg);
  update public.wms_transfers set
    truck_plate = upper(nullif(btrim(p->>'truck_plate'),'')), transporter = nullif(btrim(p->>'transporter'),''),
    driver_name = nullif(btrim(p->>'driver_name'),''), driver_phone = nullif(btrim(p->>'driver_phone'),''),
    seal_no = nullif(btrim(p->>'seal_no'),''), seal_departure_condition = nullif(btrim(p->>'seal_departure_condition'),''),
    loading_start = nullif(p->>'loading_start','')::timestamptz, loading_end = nullif(p->>'loading_end','')::timestamptz,
    bags_loaded = nullif(p->>'bags_loaded','')::int, gross_kg = g, tare_kg = ta, net_kg = ne,
    weighbridge_ref = nullif(btrim(p->>'weighbridge_ref'),''), load_doc_ref = nullif(btrim(p->>'load_doc_ref'),''),
    load_notes = nullif(btrim(p->>'load_notes'),''), load_diff_reason = nullif(btrim(p->>'load_diff_reason'),''),
    loaded_qty = case when p_confirm then ne else null end,
    loaded_by_name = c->>'nom', ready_at = coalesce(ready_at, now()),
    loaded_at = case when p_confirm then now() else null end,
    status = case when p_confirm then 'LOADED' else 'READY_TO_LOAD' end
  where id = p_id;
  r := public.wms_trf_snapshot(p_id) || jsonb_build_object('truck', upper(nullif(btrim(p->>'truck_plate'),'')), 'gross_kg', g, 'tare_kg', ta, 'net_kg', ne);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, v_action, r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, v_action, v_before, r, case when p_confirm then 'Confirm Loaded — stock physique inchangé' else 'Préparation chargement' end);
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_confirm_dispatch(p_id text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb; rec record; v_ratio numeric; v_acc numeric := 0; n int; i int := 0;
        v_q numeric; v_lots jsonb; v_movs jsonb := '[]'::jsonb; m jsonb; v_bin record;
begin
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_dispatch', t.origin_warehouse_id);
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'DISPATCH'); if r is not null then return r; end if;
  if t.departed_at is not null then raise exception 'Transfert % déjà expédié le % : double Dispatch refusé.', p_id, t.departed_at using errcode = '23505'; end if;
  if t.status <> 'LOADED' then raise exception 'Confirm Dispatch impossible au statut % (attendu LOADED)', t.status using errcode = '23514'; end if;
  if t.loaded_qty is null or t.loaded_qty <= 0 then raise exception 'Quantité chargée absente' using errcode = '23514'; end if;
  if t.loaded_qty > t.reserved_qty + 0.0005 then raise exception 'Quantité chargée (% kg) > réservée (% kg)', t.loaded_qty, t.reserved_qty using errcode = '23514'; end if;
  v_before := public.wms_trf_snapshot(p_id);
  v_ratio := t.loaded_qty / t.reserved_qty;
  select count(*) into n from public.wms_transfer_lines where transfer_id = p_id and reserved_qty > 0;
  for rec in select * from public.wms_transfer_lines where transfer_id = p_id and reserved_qty > 0 order by reserved_qty, line_no loop
    i := i + 1;
    if i = n then v_q := round(t.loaded_qty - v_acc, 3); else v_q := round(rec.reserved_qty * v_ratio, 3); end if;
    if v_q > rec.reserved_qty + 0.0005 then raise exception 'Répartition Dispatch incohérente sur la ligne % (% > réservé %)', rec.line_no, v_q, rec.reserved_qty; end if;
    v_acc := v_acc + v_q;
    update public.wms_transfer_lines set dispatched_qty = v_q where id = rec.id;
  end loop;
  perform set_config('wms.trf_ctx', p_id, true);
  for v_bin in select source_bin_id from public.wms_transfer_lines where transfer_id = p_id and dispatched_qty > 0 group by 1 order by 1 loop
    select jsonb_agg(jsonb_build_object('lot_id', lot_id, 'qty_out', dispatched_qty, 'qty_in', dispatched_qty) order by lot_id) into v_lots
      from public.wms_transfer_lines where transfer_id = p_id and source_bin_id = v_bin.source_bin_id and dispatched_qty > 0;
    m := public.wms_post_movement(jsonb_build_object('type','TRANSFER_OUT','idempotency_key','TRF-OUT:'||p_id||':'||v_bin.source_bin_id,
          'warehouse_id', t.origin_warehouse_id, 'source_type','BIN','source_id', v_bin.source_bin_id, 'dest_type','TRANSIT','dest_id', p_id,
          'lots', v_lots, 'reference_type','TRANSFER','reference_id', p_id, 'truck', t.truck_plate,
          'reason','Confirm Dispatch '||p_id||' — source → In Transit'));
    if coalesce((m->>'idempotent')::boolean,false) then raise exception 'TRANSFER_OUT déjà posté pour % / BIN % : double Dispatch refusé.', p_id, v_bin.source_bin_id using errcode = '23505'; end if;
    v_movs := v_movs || jsonb_build_object('movement_id', m->>'id', 'bin', v_bin.source_bin_id, 'qty', (m->>'qty_out')::numeric);
  end loop;
  perform set_config('wms.trf_ctx', '', true);
  update public.wms_transfer_lines set reserved_qty = 0 where transfer_id = p_id;
  update public.wms_transfers set status='IN_TRANSIT', dispatched_qty=t.loaded_qty, reserved_qty=0,
         dispatched_by=(c->>'uid')::uuid, dispatched_by_name=c->>'nom', departed_at=now() where id = p_id;
  r := public.wms_trf_snapshot(p_id) || jsonb_build_object('movements', v_movs, 'idempotency_key', p_idempotency_key);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'DISPATCH', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'DISPATCH', v_before, r, 'Confirm Dispatch — TRANSFER_OUT, réservation libérée, In Transit crédité');
  return r || jsonb_build_object('idempotent', false);
end $$;
