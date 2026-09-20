-- WMS fonctions RPC — partie 2 (D-E). Source : supabase/20260920_wms_warehouse_functions.sql
create or replace function public.wms_compute_kor(p_gk numeric, p_imm numeric, p_sp numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; f numeric; wk numeric; k numeric;
begin
  cfg := public.wms_param('korFactor');
  f := (cfg->>'factor')::numeric;
  if f is null then raise exception 'Paramètre korFactor absent'; end if;
  if p_gk is null or p_imm is null or p_sp is null then
    return jsonb_build_object('status','NOT_CALCULATED','factor', f, 'formulaVersion', cfg->>'formulaVersion');
  end if;
  wk := p_gk + p_imm/2 + p_sp/2;
  k := wk * f;
  return jsonb_build_object('status','OK','weightedKernel', wk, 'korExact', k, 'korDisplay', round(k,2), 'factor', f, 'formulaVersion', cfg->>'formulaVersion');
end $$;

create or replace function public.wms_save_quality(p_reception_id text, p_type text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_receptions; k jsonb; s public.wms_quality_snapshots; v_gk numeric; v_imm numeric; v_sp numeric;
        v_samp public.wms_quality_snapshots; v_delta numeric; v_tol numeric; v_ok boolean; v_id text; old_status text; v_prev text;
begin
  if p_type not in ('SAMPLING','FINAL') then raise exception 'Type de snapshot invalide (SAMPLING | FINAL)'; end if;
  c := public.wms_require(case when p_type = 'SAMPLING' then 'sampling' else 'final_qa' end);
  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if p_type = 'SAMPLING' and r.status not in ('ARRIVED','AWAITING_DECISION') then
    raise exception 'Sampling impossible au statut %', r.status;
  end if;
  if p_type = 'FINAL' and r.status not in ('AWAITING_FINAL_QA','QUALITY_HOLD') then
    raise exception 'Final Quality impossible au statut % (déchargement requis)', r.status;
  end if;
  v_gk := nullif(btrim(coalesce(p->>'gk_g','')),'')::numeric; v_imm := nullif(btrim(coalesce(p->>'imm_g','')),'')::numeric; v_sp := nullif(btrim(coalesce(p->>'spotted_g','')),'')::numeric;
  k := public.wms_compute_kor(v_gk, v_imm, v_sp);
  if k->>'status' <> 'OK' then
    raise exception 'KOR NOT CALCULATED : Good Kernel, Immature et Spotted sont obligatoires (un champ vide n''est pas un zéro)';
  end if;
  if v_gk < 0 or v_imm < 0 or v_sp < 0 then raise exception 'Mesures négatives interdites'; end if;
  if p_type = 'FINAL' then
    select * into v_samp from public.wms_v_quality_current where reception_id = r.id and type = 'SAMPLING';
    if v_samp.id is null then raise exception 'Aucun Sampling enregistré : Final impossible'; end if;
    v_delta := abs((k->>'korExact')::numeric - v_samp.kor_exact);
    v_tol := coalesce((public.wms_param('korTolerance')->>'value')::numeric, 1);
    v_ok := v_delta < v_tol;
  end if;
  perform pg_advisory_xact_lock(hashtext('wms_qlt_seq'));
  v_id := 'QLT-' || lpad(public.wms_next_seq('QLT')::text, 6, '0');
  select id into v_prev from public.wms_v_quality_current where reception_id = r.id and type = p_type;
  insert into public.wms_quality_snapshots(id, reception_id, lot_id, type, gk_g, imm_g, spotted_g, moisture_pct, nut_count, browns_g, voids_g, oil_g,
    weighted_kernel, kor_exact, kor_display, kor_factor, formula_version, delta_vs_sampling, within_tolerance, analyst, note, created_by)
  values (v_id, r.id, r.lot_id, p_type, v_gk, v_imm, v_sp, nullif(btrim(coalesce(p->>'moisture_pct','')),'')::numeric, nullif(btrim(coalesce(p->>'nut_count','')),'')::int,
    nullif(p->>'browns_g','')::numeric, nullif(p->>'voids_g','')::numeric, nullif(p->>'oil_g','')::numeric,
    (k->>'weightedKernel')::numeric, (k->>'korExact')::numeric, (k->>'korDisplay')::numeric, (k->>'factor')::numeric, k->>'formulaVersion',
    v_delta, v_ok, c->>'nom', p->>'note', (c->>'uid')::uuid) returning * into s;
  if v_prev is not null then
    update public.wms_quality_snapshots set superseded_by = v_id where id = v_prev;
    perform public.wms_audit(r.id, p_type||'.version', to_jsonb(v_prev), to_jsonb(v_id), coalesce(p->>'reason','Nouvelle version du snapshot (ancienne conservée)'));
  end if;
  old_status := r.status;
  if p_type = 'SAMPLING' then
    update public.wms_receptions set status = 'AWAITING_DECISION', updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id and status = 'ARRIVED';
  else
    if not v_ok then
      update public.wms_receptions set status = 'QUALITY_HOLD', hold_reason = format('Écart KOR %s ≥ tolérance %s', round(v_delta,2), v_tol), updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id;
    elsif r.status = 'QUALITY_HOLD' then
      update public.wms_receptions set status = 'AWAITING_FINAL_QA', hold_reason = null, updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id;
    end if;
  end if;
  select * into r from public.wms_receptions where id = r.id;
  perform public.wms_audit(r.id, p_type, jsonb_build_object('status', old_status), jsonb_build_object('snapshot', v_id, 'kor', s.kor_display, 'factor', s.kor_factor, 'status', r.status, 'delta', v_delta), 'Saisie '||p_type);
  return jsonb_build_object('snapshot', to_jsonb(s), 'reception', to_jsonb(r));
end $$;

create or replace function public.wms_set_hold(p_reception_id text, p_hold boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_receptions; old text;
begin
  c := public.wms_require('quality_hold');
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motif obligatoire'; end if;
  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  old := r.status;
  if p_hold then
    if r.status not in ('AWAITING_FINAL_QA','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD') then raise exception 'Blocage impossible au statut %', r.status; end if;
    update public.wms_receptions set status = 'QUALITY_HOLD', hold_reason = p_reason, updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id returning * into r;
  else
    if r.status <> 'QUALITY_HOLD' then raise exception 'La réception n''est pas bloquée'; end if;
    update public.wms_receptions set status = case when r.net_kg is not null then 'AWAITING_FINAL_QA' when r.decision = 'ACCEPTED' then 'ACCEPTED_WAITING_OFFLOAD' else 'AWAITING_DECISION' end,
      hold_reason = null, updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id returning * into r;
  end if;
  perform public.wms_audit(r.id, 'hold', to_jsonb(old), to_jsonb(r.status), p_reason, c->>'nom');
  return to_jsonb(r);
end $$;

create or replace function public.wms_post_movement(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; m public.wms_movements; v_type text; v_key text; lot jsonb; v_lot public.wms_lots;
        v_src_t text; v_src_i text; v_dst_t text; v_dst_i text; v_out numeric := 0; v_in numeric := 0; v_loss numeric; v_var numeric;
        v_bin public.wms_bins; v_bal numeric; v_avail numeric; v_id text; v_lots jsonb; v_wh uuid; v_src_bin public.wms_bins;
begin
  c := public.wms_ctx();
  v_type := p->>'type'; v_key := p->>'idempotency_key';
  if v_key is null or btrim(v_key) = '' then raise exception 'Clé d''idempotence obligatoire'; end if;
  select * into m from public.wms_movements where idempotency_key = v_key;
  if m.id is not null then return to_jsonb(m) || jsonb_build_object('idempotent', true); end if;
  v_src_t := p->>'source_type'; v_src_i := p->>'source_id'; v_dst_t := p->>'dest_type'; v_dst_i := p->>'dest_id';
  v_lots := coalesce(p->'lots','[]'::jsonb);
  if jsonb_array_length(v_lots) = 0 then raise exception 'Un mouvement doit référencer au moins un Lot (aucun stock anonyme)'; end if;
  v_wh := nullif(p->>'warehouse_id','')::uuid;
  if v_src_i is not null then perform pg_advisory_xact_lock(hashtext('wms_loc:'||v_src_t||':'||v_src_i)); end if;
  if v_dst_i is not null and (v_dst_t||':'||v_dst_i) <> coalesce(v_src_t||':'||v_src_i,'') then perform pg_advisory_xact_lock(hashtext('wms_loc:'||v_dst_t||':'||v_dst_i)); end if;
  if v_src_t = 'BIN' then
    select * into v_src_bin from public.wms_bins where id = v_src_i for update;
    if v_src_bin.id is null then raise exception 'BIN source % introuvable', v_src_i; end if;
    if v_src_bin.status in ('CLOSED','BLOCKED') then raise exception 'BIN source % est %', v_src_i, v_src_bin.status; end if;
    v_wh := coalesce(v_wh, v_src_bin.warehouse_id);
  end if;
  if v_dst_t = 'BIN' then
    select * into v_bin from public.wms_bins where id = v_dst_i for update;
    if v_bin.id is null then raise exception 'BIN destination % introuvable', v_dst_i; end if;
    if v_bin.status in ('CLOSED','BLOCKED','READY_TO_CLOSE') then raise exception 'BIN % : statut % — aucune entrée possible', v_dst_i, v_bin.status; end if;
    if v_src_bin.id is not null and v_src_bin.stock_type <> v_bin.stock_type and v_type not in ('DRYING_RECEIPT','SORTING','ADJUSTMENT') then
      raise exception 'Mélange interdit : BIN % (%) → BIN % (%)', v_src_i, v_src_bin.stock_type, v_dst_i, v_bin.stock_type;
    end if;
    v_wh := coalesce(v_wh, v_bin.warehouse_id);
  end if;
  for lot in select * from jsonb_array_elements(v_lots) loop
    select * into v_lot from public.wms_lots where id = lot->>'lot_id';
    if v_lot.id is null then raise exception 'Lot % introuvable', lot->>'lot_id'; end if;
    if v_lot.status = 'HOLD' then raise exception 'Lot % en HOLD : mouvement interdit', v_lot.id; end if;
    if coalesce((lot->>'qty_out')::numeric,0) < 0 or coalesce((lot->>'qty_in')::numeric,0) < 0 then raise exception 'Quantité négative interdite'; end if;
    if v_src_t in ('STAGING','BIN','DRYING','TRANSIT') and coalesce((lot->>'qty_out')::numeric,0) > 0 then
      select coalesce(sum(qty),0) into v_avail from public.wms_v_balances where location_type = v_src_t and location_id = v_src_i and lot_id = v_lot.id;
      if v_avail + 0.0005 < (lot->>'qty_out')::numeric then
        raise exception 'Stock insuffisant : Lot % en % % dispose de % kg (demandé % kg) — stock négatif refusé', v_lot.id, v_src_t, v_src_i, round(v_avail,2), lot->>'qty_out' using errcode = '23514';
      end if;
    end if;
    v_out := v_out + coalesce((lot->>'qty_out')::numeric,0);
    v_in  := v_in  + coalesce((lot->>'qty_in')::numeric,0);
  end loop;
  if v_out <= 0 and v_in <= 0 then raise exception 'Quantité de mouvement nulle'; end if;
  v_loss := coalesce(nullif(p->>'process_loss_kg','')::numeric, 0);
  if v_loss < 0 then raise exception 'Perte process négative interdite'; end if;
  v_var := round(v_out - v_in - v_loss, 3);
  if v_type = 'ADJUSTMENT' then
    v_var := round(v_in - v_out, 3);
    if coalesce(btrim(p->>'reason'),'') = '' or coalesce(btrim(p->>'approved_by'),'') = '' then raise exception 'ADJUSTMENT : motif et approbateur obligatoires'; end if;
  elsif v_type in ('OFFLOAD','BIN_TRANSFER','DRYING_ISSUE','TRANSFER_OUT','TRANSFER_IN','PRODUCTION_ISSUE') and v_var <> 0 then
    raise exception 'Mouvement % : OUT (%) ≠ IN (%) — écart non autorisé sur ce type', v_type, v_out, v_in;
  elsif v_type in ('DRYING_RECEIPT','SORTING') and v_var <> 0 then
    raise exception 'Écart inexpliqué de % kg : la perte process doit être déclarée explicitement (OUT − IN − perte = 0)', v_var;
  end if;
  if v_bin.id is not null and v_bin.capacity_kg is not null then
    select coalesce(sum(qty),0) into v_bal from public.wms_v_balances where location_type = 'BIN' and location_id = v_bin.id;
    if v_bal + v_in > v_bin.capacity_kg + 0.0005 then
      raise exception 'Capacité du BIN % dépassée : % + % > % kg', v_bin.id, round(v_bal,1), v_in, v_bin.capacity_kg using errcode = '23514';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('wms_mov_seq'));
  v_id := 'MOV-' || lpad(public.wms_next_seq('MOV')::text, 7, '0');
  insert into public.wms_movements(id, idempotency_key, type, warehouse_id, source_type, source_id, dest_type, dest_id, qty_out, qty_in, process_loss_kg, variance_kg,
    reference_type, reference_id, truck, supplier_name, origin, reason, approved_by, created_by, created_by_name, created_role)
  values (v_id, v_key, v_type, v_wh, v_src_t, v_src_i, v_dst_t, v_dst_i, v_out, v_in, v_loss, v_var,
    p->>'reference_type', p->>'reference_id', p->>'truck', p->>'supplier_name', p->>'origin', p->>'reason', p->>'approved_by', (c->>'uid')::uuid, c->>'nom', c->>'role')
  returning * into m;
  insert into public.wms_movement_lots(movement_id, lot_id, qty_out, qty_in)
  select v_id, x->>'lot_id', coalesce((x->>'qty_out')::numeric,0), coalesce((x->>'qty_in')::numeric,0) from jsonb_array_elements(v_lots) x;
  if v_bin.id is not null and v_bin.status = 'OPEN' and v_in > 0 then update public.wms_bins set status = 'ACTIVE', updated_at = now() where id = v_bin.id; end if;
  if v_src_bin.id is not null then
    select coalesce(sum(qty),0) into v_bal from public.wms_v_balances where location_type = 'BIN' and location_id = v_src_bin.id;
    if v_bal <= 0.0005 and v_src_bin.status = 'ACTIVE' then update public.wms_bins set status = 'READY_TO_CLOSE', updated_at = now() where id = v_src_bin.id; end if;
  end if;
  update public.wms_lots l set status = 'EXHAUSTED' where l.status = 'RELEASED' and l.id in (select x->>'lot_id' from jsonb_array_elements(v_lots) x)
    and coalesce((select sum(qty) from public.wms_v_balances v where v.lot_id = l.id and v.location_type in ('STAGING','BIN','DRYING','TRANSIT')),0) <= 0.0005;
  perform public.wms_audit(v_id, 'movement', null, jsonb_build_object('type', v_type, 'from', v_src_t||':'||coalesce(v_src_i,''), 'to', v_dst_t||':'||coalesce(v_dst_i,''), 'qty_out', v_out, 'qty_in', v_in, 'process_loss', v_loss, 'variance', v_var, 'lots', v_lots), coalesce(p->>'reason', v_type), p->>'approved_by');
  return to_jsonb(m) || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_split_bin_qty(p_bin_id text, p_qty numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare total numeric; parts jsonb := '[]'::jsonb; r record; acc numeric := 0; share numeric; n int; i int := 0;
begin
  select coalesce(sum(qty),0) into total from public.wms_v_balances where location_type = 'BIN' and location_id = p_bin_id and qty > 0;
  if p_qty > total + 0.0005 then raise exception 'Sortie (% kg) supérieure au stock du BIN % (% kg)', p_qty, p_bin_id, round(total,2) using errcode = '23514'; end if;
  select count(*) into n from public.wms_v_balances where location_type = 'BIN' and location_id = p_bin_id and qty > 0;
  for r in select lot_id, qty from public.wms_v_balances where location_type = 'BIN' and location_id = p_bin_id and qty > 0 order by qty desc, lot_id loop
    i := i + 1;
    if i = n then share := round(p_qty - acc, 3); else share := round(p_qty * r.qty / total, 3); end if;
    if share > r.qty then share := r.qty; end if;
    acc := acc + share;
    if share > 0 then parts := parts || jsonb_build_object('lot_id', r.lot_id, 'qty', share); end if;
  end loop;
  return parts;
end $$;
