create or replace function public.wms_trf_register_arrival(p_id text, p jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb; v_seal text; v_obs text;
begin
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_arrival', t.dest_warehouse_id);
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'ARRIVAL'); if r is not null then return r; end if;
  if t.status <> 'IN_TRANSIT' then raise exception 'Register Arrival impossible au statut % (attendu IN_TRANSIT)', t.status using errcode = '23514'; end if;
  if coalesce(p->>'warehouse_id','') <> '' and (p->>'warehouse_id')::uuid <> t.dest_warehouse_id then
    raise exception 'Mauvaise destination : ce transfert est destiné à un autre Warehouse.' using errcode = '23514';
  end if;
  if coalesce(btrim(p->>'receiver'),'') = '' then raise exception 'Receiver obligatoire' using errcode = '23514'; end if;
  v_obs := nullif(btrim(p->>'seal_observed'),'');
  v_seal := coalesce(nullif(p->>'seal_status',''), case when t.seal_no is null then 'NOT_APPLICABLE' when v_obs is not null and v_obs <> t.seal_no then 'MISMATCH' else 'INTACT' end);
  if v_seal = 'INTACT' and v_obs is not null and t.seal_no is not null and v_obs <> t.seal_no then v_seal := 'MISMATCH'; end if;
  v_before := public.wms_trf_snapshot(p_id);
  update public.wms_transfers set status='ARRIVED', arrived_at=coalesce(nullif(p->>'arrived_at','')::timestamptz, now()),
    arrival_receiver=btrim(p->>'receiver'), arrival_truck=upper(nullif(btrim(p->>'truck'),'')), arrival_seal_status=v_seal,
    arrival_seal_observed=v_obs, arrival_gate_ref=nullif(btrim(p->>'gate_ref'),''), arrival_comment=nullif(btrim(p->>'comment'),''), arrival_by_name=c->>'nom'
  where id = p_id;
  r := public.wms_trf_snapshot(p_id) || jsonb_build_object('seal_status', v_seal, 'truck_match', coalesce(upper(nullif(btrim(p->>'truck'),'')) = t.truck_plate, true));
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'ARRIVAL', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'ARRIVAL', v_before, r, case when v_seal in ('MISMATCH','BROKEN') then 'Arrivée — EXCEPTION SCELLÉ '||v_seal else 'Arrivée enregistrée — destination non créditée' end);
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_confirm_receipt(p_id text, p jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb; g numeric; ta numeric; ne numeric; v_credit numeric; v_var numeric; v_pct numeric;
        v_dt text; v_di text; b public.wms_bins; st jsonb; rec record; n int; i int := 0; v_acc numeric := 0; v_q numeric; v_lots jsonb := '[]'::jsonb;
        m jsonb; v_status text; v_anom text; v_lacc numeric; k int; j int;
begin
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_receive', t.dest_warehouse_id);
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'RECEIPT'); if r is not null then return r; end if;
  if t.received_at is not null then raise exception 'Transfert % déjà reçu le % : double Receipt refusé.', p_id, t.received_at using errcode = '23505'; end if;
  if t.departed_at is null then raise exception 'Receipt impossible avant Dispatch (statut %).', t.status using errcode = '23514'; end if;
  if t.status <> 'ARRIVED' then raise exception 'Confirm Receipt impossible au statut % : enregistrez d''abord l''arrivée (Arrival ≠ Receipt).', t.status using errcode = '23514'; end if;
  st := public.wms_trf_settings();
  g := nullif(p->>'gross_kg','')::numeric; ta := nullif(p->>'tare_kg','')::numeric; ne := nullif(p->>'net_kg','')::numeric;
  if g is not null and ta is not null then
    if ta >= g then raise exception 'Tare (% kg) ≥ Gross (% kg) : Net reçu invalide', ta, g using errcode = '23514'; end if;
    if ne is not null and abs(ne - (g - ta)) > 0.001 then raise exception 'Net reçu saisi (% kg) ≠ Gross − Tare (% kg)', ne, g - ta using errcode = '23514'; end if;
    ne := g - ta;
  end if;
  if ne is null or ne <= 0 then raise exception 'Net Received doit être > 0' using errcode = '23514'; end if;
  if coalesce((st->>'receivingQualityMandatory')::boolean,false) and coalesce(btrim(p->>'quality_ref'),'') = '' then raise exception 'Référence Quality réception obligatoire (paramètre)' using errcode = '23514'; end if;
  v_dt := upper(coalesce(nullif(p->>'dest_type',''),''));
  if v_dt = 'BIN' then
    select * into b from public.wms_bins where id = p->>'dest_bin_id';
    if b.id is null then raise exception 'Destination BIN % inexistant', coalesce(p->>'dest_bin_id','?') using errcode = '23503'; end if;
    if b.warehouse_id <> t.dest_warehouse_id then raise exception 'Destination non valide : BIN % n''appartient pas au Warehouse de destination', b.id using errcode = '23514'; end if;
    v_di := b.id;
  elsif v_dt = 'STAGING' then
    if not coalesce((st->>'allowStagingDestination')::boolean, true) then raise exception 'Controlled Staging non autorisé (paramètre) : choisissez un BIN' using errcode = '23514'; end if;
    v_di := t.dest_warehouse_id::text;
  else
    raise exception 'Destination contrôlée obligatoire : BIN ou STAGING du Warehouse de destination' using errcode = '23514';
  end if;
  v_before := public.wms_trf_snapshot(p_id);
  v_credit := least(ne, t.dispatched_qty);
  v_var := round(t.dispatched_qty - ne, 3);
  v_pct := round(v_var / t.dispatched_qty * 100, 4);
  select count(*) into n from public.wms_transfer_lines where transfer_id = p_id and dispatched_qty > 0;
  for rec in select * from public.wms_transfer_lines where transfer_id = p_id and dispatched_qty > 0 order by dispatched_qty, line_no loop
    i := i + 1;
    if i = n then v_q := round(v_credit - v_acc, 3); else v_q := round(rec.dispatched_qty * v_credit / t.dispatched_qty, 3); end if;
    if v_q > rec.dispatched_qty then v_q := rec.dispatched_qty; end if;
    if v_q < 0 then v_q := 0; end if;
    v_acc := v_acc + v_q;
    update public.wms_transfer_lines set received_qty = v_q where id = rec.id;
  end loop;
  if abs(v_acc - v_credit) > 0.0005 then raise exception 'Répartition Receipt incohérente (% ≠ %)', v_acc, v_credit; end if;
  select jsonb_agg(jsonb_build_object('lot_id', lot_id, 'qty_out', q, 'qty_in', q) order by lot_id) into v_lots
    from (select lot_id, sum(received_qty) q from public.wms_transfer_lines where transfer_id = p_id group by lot_id having sum(received_qty) > 0) x;
  perform set_config('wms.trf_ctx', p_id, true);
  m := public.wms_post_movement(jsonb_build_object('type','TRANSFER_IN','idempotency_key','TRF-IN:'||p_id,
        'warehouse_id', t.dest_warehouse_id, 'source_type','TRANSIT','source_id', p_id, 'dest_type', v_dt, 'dest_id', v_di,
        'lots', v_lots, 'reference_type','TRANSFER','reference_id', p_id, 'truck', t.truck_plate,
        'reason','Confirm Receipt '||p_id||' — In Transit → destination'));
  perform set_config('wms.trf_ctx', '', true);
  if coalesce((m->>'idempotent')::boolean,false) then raise exception 'TRANSFER_IN déjà posté pour % : double Receipt refusé.', p_id using errcode = '23505'; end if;
  if v_var = 0 then v_status := 'RECONCILED'; v_anom := null;
  elsif v_var > 0 then v_status := 'DISCREPANCY'; v_anom := 'NEGATIVE';
  else v_status := 'DISCREPANCY'; v_anom := 'POSITIVE'; end if;
  update public.wms_transfers set status=v_status, anomaly=v_anom, rc_gross_kg=g, rc_tare_kg=ta, rc_net_kg=ne, received_qty=v_credit,
    variance_kg=v_var, variance_pct=v_pct, bags_received=nullif(p->>'bags_received','')::int, rc_ticket=nullif(btrim(p->>'ticket'),''),
    rc_quality_ref=nullif(btrim(p->>'quality_ref'),''), rc_note=nullif(btrim(p->>'note'),''), rc_dest_type=v_dt, rc_dest_id=v_di,
    received_by=(c->>'uid')::uuid, received_by_name=c->>'nom', received_at=now(),
    reconciled_at=case when v_var = 0 then now() end, reconciled_by_name=case when v_var = 0 then 'AUTO (variance 0)' end
  where id = p_id;
  r := public.wms_trf_snapshot(p_id) || jsonb_build_object('movement_id', m->>'id', 'dest_type', v_dt, 'dest_id', v_di,
        'production_issue_created', false, 'requires', case when v_var = 0 then 'CLOSE' when v_var > 0 then 'DISCREPANCY_RESOLUTION' else 'REWEIGH_INVESTIGATION' end);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'RECEIPT', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'RECEIPT', v_before, r,
    case when v_var = 0 then 'Confirm Receipt — variance 0'
         when v_var > 0 then 'Confirm Receipt — DISCREPANCY '||v_var||' kg (non qualifiée de perte)'
         else 'Confirm Receipt — ANOMALIE POSITIVE '||abs(v_var)||' kg : reweigh / investigation' end);
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_post_resolution(p_res_id text, p_approver text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rs public.wms_transfer_resolutions; t public.wms_transfers; v_lots jsonb; m jsonb; v_mid text; rec record; n int; i int := 0; v_acc numeric := 0; v_q numeric; v_tot numeric;
begin
  select * into rs from public.wms_transfer_resolutions where id = p_res_id for update;
  select * into t from public.wms_transfers where id = rs.transfer_id;
  perform set_config('wms.trf_ctx', t.id, true);
  if rs.direction = 'NEGATIVE' then
    select jsonb_agg(jsonb_build_object('lot_id', lot_id, 'qty_out', qty, 'qty_in', 0) order by lot_id), coalesce(sum(qty),0) into v_lots, v_tot
      from public.wms_v_balances where location_type='TRANSIT' and location_id=t.id and qty > 0;
    if abs(v_tot - rs.qty_kg) > 0.0005 then raise exception 'Résiduel In Transit (% kg) ≠ quantité à résoudre (% kg)', v_tot, rs.qty_kg; end if;
    m := public.wms_post_movement(jsonb_build_object('type','ADJUSTMENT','idempotency_key','TRF-RES:'||rs.id,
          'warehouse_id', t.dest_warehouse_id, 'source_type','TRANSIT','source_id', t.id, 'dest_type','ADJUSTMENT','dest_id', rs.category,
          'lots', v_lots, 'reference_type','TRANSFER','reference_id', t.id, 'truck', t.truck_plate,
          'reason', 'Résolution écart '||t.id||' ['||rs.category||'] '||rs.detailed_reason, 'approved_by', p_approver));
    v_mid := m->>'id';
  elsif rs.resolution_type = 'STOCK_GAIN' then
    select count(*) into n from public.wms_transfer_lines where transfer_id=t.id and received_qty > 0;
    v_lots := '[]'::jsonb;
    for rec in select lot_id, sum(received_qty) q from public.wms_transfer_lines where transfer_id=t.id and received_qty > 0 group by lot_id order by 2, 1 loop
      i := i + 1;
      if i = (select count(distinct lot_id) from public.wms_transfer_lines where transfer_id=t.id and received_qty > 0)
        then v_q := round(rs.qty_kg - v_acc, 3); else v_q := round(rs.qty_kg * rec.q / t.received_qty, 3); end if;
      v_acc := v_acc + v_q;
      if v_q > 0 then v_lots := v_lots || jsonb_build_object('lot_id', rec.lot_id, 'qty_out', 0, 'qty_in', v_q); end if;
    end loop;
    m := public.wms_post_movement(jsonb_build_object('type','ADJUSTMENT','idempotency_key','TRF-RES:'||rs.id,
          'warehouse_id', t.dest_warehouse_id, 'source_type','ADJUSTMENT','source_id', rs.category, 'dest_type', t.rc_dest_type, 'dest_id', t.rc_dest_id,
          'lots', v_lots, 'reference_type','TRANSFER_RESOLUTION','reference_id', t.id, 'truck', t.truck_plate,
          'reason', 'Anomalie positive '||t.id||' ['||rs.category||'] '||rs.detailed_reason, 'approved_by', p_approver));
    v_mid := m->>'id';
  end if;
  perform set_config('wms.trf_ctx', '', true);
  update public.wms_transfer_resolutions set status='POSTED', movement_id=v_mid where id = rs.id;
  update public.wms_transfers set status='RECONCILED', resolved_kg = resolved_kg + rs.qty_kg, reconciled_at=now(), reconciled_by_name=p_approver where id = t.id;
  return jsonb_build_object('resolution_id', rs.id, 'movement_id', v_mid);
end $$;
revoke all on function public.wms_trf_post_resolution(text, text) from public, anon, authenticated;

create or replace function public.wms_trf_resolve_discrepancy(p_id text, p jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb; st jsonb; v_qty numeric; v_req boolean; v_rid text; v_type text; v_cat text; v_tp numeric; v_tk numeric; x jsonb;
begin
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_resolve');
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'RESOLVE'); if r is not null then return r; end if;
  if t.status <> 'DISCREPANCY' then raise exception 'Résolution impossible au statut % (attendu DISCREPANCY)', t.status using errcode = '23514'; end if;
  st := public.wms_trf_settings();
  v_cat := upper(coalesce(btrim(p->>'category'),''));
  if v_cat = '' or not coalesce((st->'reasonCategories') ? v_cat, false) then raise exception 'Reason Category obligatoire et contrôlée par liste (%).', coalesce(st->>'reasonCategories','non configurée') using errcode = '23514'; end if;
  if coalesce(btrim(p->>'detailed_reason'),'') = '' then raise exception 'Detailed Reason obligatoire' using errcode = '23514'; end if;
  if coalesce(btrim(p->>'responsible'),'') = '' then raise exception 'Responsible Person obligatoire' using errcode = '23514'; end if;
  if coalesce(btrim(p->>'resolution'),'') = '' then raise exception 'Resolution obligatoire' using errcode = '23514'; end if;
  if t.anomaly = 'NEGATIVE' then
    v_type := 'WRITE_OFF';
    select coalesce(sum(qty),0) into v_qty from public.wms_v_balances where location_type='TRANSIT' and location_id=p_id;
  else
    v_type := upper(coalesce(nullif(p->>'resolution_type',''),'REWEIGH_CORRECTION'));
    if v_type not in ('REWEIGH_CORRECTION','STOCK_GAIN') then raise exception 'Anomalie positive : resolution_type = REWEIGH_CORRECTION ou STOCK_GAIN (jamais une perte négative).' using errcode = '23514'; end if;
    v_qty := abs(t.variance_kg);
  end if;
  if v_qty <= 0 then raise exception 'Aucun écart à résoudre' using errcode = '23514'; end if;
  v_tp := nullif(st->>'varianceTolerancePct','')::numeric; v_tk := nullif(st->>'varianceToleranceKg','')::numeric;
  v_req := t.anomaly = 'POSITIVE' or (v_tp is null and v_tk is null)
           or (v_tp is not null and abs(t.variance_pct) > v_tp) or (v_tk is not null and abs(t.variance_kg) > v_tk);
  v_before := public.wms_trf_snapshot(p_id);
  v_rid := 'TRR-' || p_id || '-' || (select count(*) + 1 from public.wms_transfer_resolutions where transfer_id = p_id);
  insert into public.wms_transfer_resolutions(id, transfer_id, kind, direction, category, detailed_reason, responsible, investigation, evidence_ref,
      resolution, resolution_type, qty_kg, variance_pct, tolerance_snapshot, requires_approval, status, proposed_by, proposed_by_name)
  values (v_rid, p_id, 'DISCREPANCY', t.anomaly, v_cat, btrim(p->>'detailed_reason'), btrim(p->>'responsible'), nullif(btrim(p->>'investigation'),''),
      nullif(btrim(p->>'evidence_ref'),''), btrim(p->>'resolution'), v_type, v_qty, t.variance_pct,
      jsonb_build_object('varianceTolerancePct', v_tp, 'varianceToleranceKg', v_tk, 'settings_status', st->>'status'),
      v_req, 'PENDING_APPROVAL', (c->>'uid')::uuid, c->>'nom');
  if v_req then
    update public.wms_transfers set status='RESOLUTION_PENDING' where id = p_id;
    x := jsonb_build_object('resolution_id', v_rid, 'requires_approval', true);
  else
    x := public.wms_trf_post_resolution(v_rid, 'AUTO_TOLERANCE('||coalesce(v_tp::text,'-')||'%/'||coalesce(v_tk::text,'-')||'kg) · '||(c->>'nom')) || jsonb_build_object('requires_approval', false);
  end if;
  r := public.wms_trf_snapshot(p_id) || x || jsonb_build_object('category', v_cat, 'qty_kg', v_qty, 'resolution_type', v_type);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'RESOLVE', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'RESOLUTION_PROPOSED', v_before, r, '['||v_cat||'] '||btrim(p->>'detailed_reason'));
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_decide_resolution(p_id text, p_approve boolean, p_comment text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; rs public.wms_transfer_resolutions; v_before jsonb; st jsonb; x jsonb := '{}'::jsonb;
begin
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_resolve_approve');
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'RESOLVE_DECISION'); if r is not null then return r; end if;
  if t.status <> 'RESOLUTION_PENDING' then raise exception 'Aucune résolution en attente d''approbation (statut %)', t.status using errcode = '23514'; end if;
  select * into rs from public.wms_transfer_resolutions where transfer_id = p_id and status = 'PENDING_APPROVAL' order by proposed_at desc limit 1 for update;
  if rs.id is null then raise exception 'Résolution en attente introuvable'; end if;
  st := public.wms_trf_settings();
  if rs.proposed_by = (c->>'uid')::uuid and not coalesce((st->>'allowSelfApprovalResolution')::boolean,false) then
    raise exception 'Séparation des tâches : l''auteur de la résolution ne peut pas l''approuver lui-même.' using errcode = '42501';
  end if;
  if not p_approve and coalesce(btrim(p_comment),'') = '' then raise exception 'Refus de résolution : commentaire obligatoire' using errcode = '23514'; end if;
  v_before := public.wms_trf_snapshot(p_id);
  update public.wms_transfer_resolutions set approved_by=(c->>'uid')::uuid, approved_by_name=c->>'nom', approved_at=now(),
         approval_comment=nullif(btrim(coalesce(p_comment,'')),''), status = case when p_approve then status else 'REJECTED' end where id = rs.id;
  if p_approve then x := public.wms_trf_post_resolution(rs.id, c->>'nom');
  else update public.wms_transfers set status='DISCREPANCY' where id = p_id; end if;
  r := public.wms_trf_snapshot(p_id) || x || jsonb_build_object('approved', p_approve, 'resolution_id', rs.id);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'RESOLVE_DECISION', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, case when p_approve then 'RESOLUTION_APPROVED' else 'RESOLUTION_REJECTED' end, v_before, r,
     coalesce(nullif(btrim(coalesce(p_comment,'')),''), '['||rs.category||'] '||rs.detailed_reason), c->>'nom');
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_close(p_id text, p_note text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb; v_res numeric;
begin
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_close');
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'CLOSE'); if r is not null then return r; end if;
  if t.status <> 'RECONCILED' then raise exception 'Clôture impossible au statut % : le transfert doit être RECONCILED (variance nulle ou résolue).', t.status using errcode = '23514'; end if;
  select coalesce(sum(qty),0) into v_res from public.wms_v_balances where location_type='TRANSIT' and location_id=p_id;
  if abs(v_res) > 0.0005 then raise exception 'Clôture refusée : In Transit résiduel % kg non réconcilié.', v_res using errcode = '23514'; end if;
  v_before := public.wms_trf_snapshot(p_id);
  update public.wms_transfers set status='CLOSED', closed_at=now(), closed_by_name=c->>'nom', close_note=nullif(btrim(coalesce(p_note,'')),'') where id = p_id;
  r := public.wms_trf_snapshot(p_id) || jsonb_build_object('locked', true);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'CLOSE', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'CLOSE', v_before, r, coalesce(nullif(btrim(coalesce(p_note,'')),''),'Clôture — transfert verrouillé'), c->>'nom');
  return r || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_trf_correct_closed(p_id text, p jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; t public.wms_transfers; v_qty numeric; v_dir text; v_rid text; m jsonb; v_lots jsonb := '[]'::jsonb; rec record; n int; i int := 0; v_acc numeric := 0; v_q numeric; st jsonb;
begin
  select * into t from public.wms_transfers where id = p_id for share;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_correct_closed');
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'CORRECT_CLOSED'); if r is not null then return r; end if;
  if t.status <> 'CLOSED' then raise exception 'Correction compensatoire réservée aux transferts CLOSED (statut %)', t.status using errcode = '23514'; end if;
  st := public.wms_trf_settings();
  v_qty := nullif(p->>'qty_kg','')::numeric; v_dir := upper(coalesce(p->>'direction',''));
  if v_qty is null or v_qty <= 0 then raise exception 'Quantité de correction > 0 obligatoire' using errcode = '23514'; end if;
  if v_dir not in ('NEGATIVE','POSITIVE') then raise exception 'Direction NEGATIVE ou POSITIVE obligatoire' using errcode = '23514'; end if;
  if coalesce(btrim(p->>'detailed_reason'),'') = '' or coalesce(btrim(p->>'approver'),'') = '' or coalesce(btrim(p->>'responsible'),'') = '' then
    raise exception 'Correction d''un CLOSED : motif, responsable et approbateur obligatoires' using errcode = '23514';
  end if;
  if btrim(p->>'approver') = (c->>'nom') and not coalesce((st->>'allowSelfApprovalResolution')::boolean,false) then
    raise exception 'Séparation des tâches : l''approbateur doit être distinct de l''auteur de la correction.' using errcode = '42501';
  end if;
  select count(distinct lot_id) into n from public.wms_transfer_lines where transfer_id = p_id and received_qty > 0;
  for rec in select lot_id, sum(received_qty) q from public.wms_transfer_lines where transfer_id = p_id and received_qty > 0 group by lot_id order by 2, 1 loop
    i := i + 1;
    if i = n then v_q := round(v_qty - v_acc, 3); else v_q := round(v_qty * rec.q / t.received_qty, 3); end if;
    v_acc := v_acc + v_q;
    if v_q > 0 then v_lots := v_lots || case when v_dir = 'NEGATIVE' then jsonb_build_object('lot_id', rec.lot_id, 'qty_out', v_q, 'qty_in', 0)
                                                                     else jsonb_build_object('lot_id', rec.lot_id, 'qty_out', 0, 'qty_in', v_q) end; end if;
  end loop;
  v_rid := 'TRR-' || p_id || '-' || (select count(*) + 1 from public.wms_transfer_resolutions where transfer_id = p_id);
  m := public.wms_post_movement(jsonb_build_object('type','ADJUSTMENT','idempotency_key','TRF-COR:'||v_rid, 'warehouse_id', t.dest_warehouse_id,
        'source_type', case when v_dir='NEGATIVE' then t.rc_dest_type else 'ADJUSTMENT' end, 'source_id', case when v_dir='NEGATIVE' then t.rc_dest_id else 'CLOSED_CORRECTION' end,
        'dest_type',   case when v_dir='NEGATIVE' then 'ADJUSTMENT' else t.rc_dest_type end, 'dest_id',   case when v_dir='NEGATIVE' then 'CLOSED_CORRECTION' else t.rc_dest_id end,
        'lots', v_lots, 'reference_type','TRANSFER_CORRECTION','reference_id', p_id, 'truck', t.truck_plate,
        'reason','Correction compensatoire '||p_id||' : '||btrim(p->>'detailed_reason'), 'approved_by', btrim(p->>'approver')));
  insert into public.wms_transfer_resolutions(id, transfer_id, kind, direction, category, detailed_reason, responsible, resolution, resolution_type, qty_kg,
      requires_approval, status, proposed_by, proposed_by_name, approved_by_name, approved_at, movement_id)
  values (v_rid, p_id, 'CLOSED_CORRECTION', v_dir, upper(coalesce(nullif(btrim(p->>'category'),''),'OTHER')), btrim(p->>'detailed_reason'), btrim(p->>'responsible'),
      'Mouvement compensatoire '||(m->>'id'), 'COMPENSATION', v_qty, true, 'POSTED', (c->>'uid')::uuid, c->>'nom', btrim(p->>'approver'), now(), m->>'id');
  r := jsonb_build_object('transfer_id', p_id, 'correction_id', v_rid, 'movement_id', m->>'id', 'direction', v_dir, 'qty_kg', v_qty, 'header_unchanged', true);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'CORRECT_CLOSED', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'CLOSED_CORRECTION', public.wms_trf_snapshot(p_id), r, btrim(p->>'detailed_reason'), btrim(p->>'approver'));
  return r || jsonb_build_object('idempotent', false);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'wms_trf_settings()', 'wms_trf_require(text, uuid)', 'wms_trf_my_permissions()',
    'wms_trf_create_request(jsonb, text)', 'wms_trf_approve(text, text, text)', 'wms_trf_reject(text, text, text)',
    'wms_trf_cancel(text, text, text)', 'wms_trf_save_load(text, jsonb, boolean, text)', 'wms_trf_confirm_dispatch(text, text)',
    'wms_trf_register_arrival(text, jsonb, text)', 'wms_trf_confirm_receipt(text, jsonb, text)',
    'wms_trf_resolve_discrepancy(text, jsonb, text)', 'wms_trf_decide_resolution(text, boolean, text, text)',
    'wms_trf_close(text, text, text)', 'wms_trf_correct_closed(text, jsonb, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon;', f);
    execute format('grant execute on function public.%s to authenticated;', f);
  end loop;
  foreach f in array array[
    'wms_trf_audit(text, text, jsonb, jsonb, text, text)', 'wms_trf_op_check(text, text, text)', 'wms_trf_snapshot(text)',
    'wms_trf_guard_header()', 'wms_trf_guard_child()', 'wms_trf_guard_ops()', 'wms_trf_guard_movement()', 'wms_trf_guard_reserved()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated;', f);
  end loop;
end $$;

create or replace view public.rcn_v_transferts as
select
  p->>'id' as id, p->>'cycleId' as cycle_id, p->>'binId' as bin_id, p->>'destination' as destination,
  (p->>'poidsEnvoye')::numeric as poids_envoye, (p->>'poidsRecu')::numeric as poids_recu, (p->>'ecart')::numeric as ecart_kg,
  p->>'ecartMotif' as ecart_motif, p->>'etat' as etat,
  p->'validations'->'entrepot' as val_entrepot, p->'validations'->'qa' as val_qa, p->'validations'->'calibrage' as val_calibrage,
  (p->>'createdAt')::timestamptz as created_at,
  (p->'finance'->>'prixMoyen')::numeric as prix_moyen, (p->'finance'->>'tolerancePct')::numeric as tolerance_pct,
  (p->'finance'->>'toleranceKg')::numeric as tolerance_kg, (p->'finance'->>'valeurEnvoyee')::numeric as valeur_envoyee,
  (p->'finance'->>'valeurRecue')::numeric as valeur_recue, (p->'finance'->>'perteTolerable')::numeric as perte_tolerable_kg,
  (p->'finance'->>'pertePenalisable')::numeric as perte_penalisable_kg, (p->'finance'->>'penalite')::numeric as penalite
from (select payload p from public.rcn_state where kind = 'transfer') r
union all
select t.id, null::text, (select string_agg(distinct l.source_bin_id, ', ') from public.wms_transfer_lines l where l.transfer_id = t.id),
  dw.code, t.dispatched_qty, t.rc_net_kg, t.variance_kg,
  (select string_agg(rs.category, ', ') from public.wms_transfer_resolutions rs where rs.transfer_id = t.id and rs.status = 'POSTED'),
  t.status, null::jsonb, null::jsonb, null::jsonb, t.requested_at,
  null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric
from public.wms_transfers t join public.wms_warehouses dw on dw.id = t.dest_warehouse_id
where not t.is_test;
alter view public.rcn_v_transferts set (security_invoker = on);
grant select on public.rcn_v_transferts to authenticated;
