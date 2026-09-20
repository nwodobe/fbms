-- WMS fonctions RPC — partie 3 (F-G + correctif post_movement READY_TO_CLOSE). Source : supabase/20260920_wms_warehouse_functions.sql
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
    if v_bin.status in ('CLOSED','BLOCKED') or (v_bin.status = 'READY_TO_CLOSE' and v_type not in ('DRYING_RECEIPT','SORTING','ADJUSTMENT')) then
      raise exception 'BIN % : statut % — aucune entrée possible', v_dst_i, v_bin.status;
    end if;
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
  if v_bin.id is not null and v_bin.status in ('OPEN','READY_TO_CLOSE') and v_in > 0 then update public.wms_bins set status = 'ACTIVE', updated_at = now() where id = v_bin.id; end if;
  if v_src_bin.id is not null then
    select coalesce(sum(qty),0) into v_bal from public.wms_v_balances where location_type = 'BIN' and location_id = v_src_bin.id;
    if v_bal <= 0.0005 and v_src_bin.status = 'ACTIVE' then update public.wms_bins set status = 'READY_TO_CLOSE', updated_at = now() where id = v_src_bin.id; end if;
  end if;
  update public.wms_lots l set status = 'EXHAUSTED' where l.status = 'RELEASED' and l.id in (select x->>'lot_id' from jsonb_array_elements(v_lots) x)
    and coalesce((select sum(qty) from public.wms_v_balances v where v.lot_id = l.id and v.location_type in ('STAGING','BIN','DRYING','TRANSIT')),0) <= 0.0005;
  perform public.wms_audit(v_id, 'movement', null, jsonb_build_object('type', v_type, 'from', v_src_t||':'||coalesce(v_src_i,''), 'to', v_dst_t||':'||coalesce(v_dst_i,''), 'qty_out', v_out, 'qty_in', v_in, 'process_loss', v_loss, 'variance', v_var, 'lots', v_lots), coalesce(p->>'reason', v_type), p->>'approved_by');
  return to_jsonb(m) || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_release_lot(p_reception_id text, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_receptions; f public.wms_quality_snapshots; s public.wms_quality_snapshots; l public.wms_lots; v_id text; m jsonb;
begin
  c := public.wms_require('lot_release');
  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.lot_id is not null then
    select * into l from public.wms_lots where id = r.lot_id; return to_jsonb(l) || jsonb_build_object('idempotent', true);
  end if;
  if r.status <> 'AWAITING_FINAL_QA' then raise exception 'Libération impossible au statut % (Final Quality conforme requis)', r.status; end if;
  select * into f from public.wms_v_quality_current where reception_id = r.id and type = 'FINAL';
  if f.id is null then raise exception 'Final Quality absent : libération impossible'; end if;
  if coalesce(f.within_tolerance,false) = false then raise exception 'Final Quality hors tolérance : réception à traiter en Quality Hold'; end if;
  select * into s from public.wms_v_quality_current where reception_id = r.id and type = 'SAMPLING';
  perform pg_advisory_xact_lock(hashtext('wms_lot_seq'));
  v_id := 'RCN-' || to_char(now() at time zone 'UTC','YYYYMMDD') || '-' || lpad(public.wms_next_seq('RCN:'||to_char(now() at time zone 'UTC','YYYYMMDD'))::text, 3, '0');
  insert into public.wms_lots(id, reception_id, warehouse_id, truck, supplier_name, supplier_code, origin, initial_kg, initial_bags, kor_sampling, kor_final, moisture_final, nut_count_final, created_by, created_by_name)
  values (v_id, r.id, r.warehouse_id, r.truck, r.supplier_name, r.supplier_code, r.origin, r.net_kg, r.bags, s.kor_exact, f.kor_exact, f.moisture_pct, f.nut_count, (c->>'uid')::uuid, c->>'nom') returning * into l;
  update public.wms_quality_snapshots set lot_id = v_id where reception_id = r.id;
  update public.wms_receptions set lot_id = v_id, status = 'RELEASED', updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id;
  m := public.wms_post_movement(jsonb_build_object('type','OFFLOAD','idempotency_key', coalesce('RELEASE:'||p_idempotency_key, 'RELEASE:'||r.id),
        'warehouse_id', r.warehouse_id, 'source_type','TRUCK','source_id', r.id, 'dest_type','STAGING','dest_id', r.warehouse_id::text,
        'lots', jsonb_build_array(jsonb_build_object('lot_id', v_id, 'qty_out', r.net_kg, 'qty_in', r.net_kg)),
        'reference_type','RECEPTION','reference_id', r.id, 'truck', r.truck, 'supplier_name', r.supplier_name, 'origin', r.origin, 'reason','Libération du Lot — matière déchargée en staging'));
  perform public.wms_audit(r.id, 'lot', to_jsonb('AWAITING_FINAL_QA'::text), jsonb_build_object('lot', v_id, 'initial_kg', r.net_kg, 'status','RELEASED'), 'Création & libération du Lot officiel');
  return to_jsonb(l) || jsonb_build_object('idempotent', false, 'movement', m->>'id');
end $$;

create or replace function public.wms_create_bin(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; w public.wms_warehouses; a public.wms_physical_areas; b public.wms_bins; v_type text; v_id text; yy text; seq bigint; v_key text;
begin
  c := public.wms_require('bin_ops');
  v_key := p->>'idempotency_key';
  if v_key is not null then
    select * into b from public.wms_bins where id in (select apres->>'bin_id' from public.rcn_audit where champ = 'bin.create' and apres->>'idem' = v_key limit 1);
    if b.id is not null then return to_jsonb(b) || jsonb_build_object('idempotent', true); end if;
  end if;
  select * into w from public.wms_warehouses where id = (p->>'warehouse_id')::uuid;
  if w.id is null then raise exception 'Warehouse obligatoire'; end if;
  if w.status <> 'ACTIVE' then raise exception 'Warehouse % inactif', w.code; end if;
  v_type := upper(coalesce(p->>'stock_type','WET'));
  if v_type not in ('WET','DRY','HOLD') then raise exception 'Stock type invalide (WET | DRY | HOLD)'; end if;
  if nullif(p->>'physical_area_id','') is not null then
    select * into a from public.wms_physical_areas where id = (p->>'physical_area_id')::uuid and warehouse_id = w.id;
    if a.id is null then raise exception 'Zone physique introuvable dans ce Warehouse'; end if;
    if a.status <> 'ACTIVE' then raise exception 'Zone % inactive', a.code; end if;
    if exists (select 1 from public.wms_bins where physical_area_id = a.id and status <> 'CLOSED') then
      raise exception 'La zone % porte déjà un BIN opérationnel ouvert', a.code using errcode = '23505';
    end if;
  end if;
  yy := to_char(now(),'YY');
  perform pg_advisory_xact_lock(hashtext('wms_bin_seq'));
  seq := public.wms_next_seq('BIN:'||w.site_code||':'||w.code||':'||v_type||':'||yy);
  v_id := w.site_code||'-'||w.code||'-'||v_type||'-'||yy||'-'||lpad(seq::text,3,'0');
  insert into public.wms_bins(id, warehouse_id, physical_area_id, stock_type, capacity_kg, opened_by)
  values (v_id, w.id, a.id, v_type, coalesce(nullif(p->>'capacity_kg','')::numeric, a.capacity_kg), (c->>'uid')::uuid) returning * into b;
  perform public.wms_audit(v_id, 'bin.create', null, jsonb_build_object('bin_id', v_id, 'stock_type', v_type, 'area', a.code, 'capacity_kg', b.capacity_kg, 'idem', v_key), 'Ouverture BIN opérationnel');
  return to_jsonb(b) || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_allocate_lot_to_bin(p_lot_id text, p_bin_id text, p_qty numeric, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; l public.wms_lots; b public.wms_bins;
begin
  c := public.wms_require('bin_ops');
  select * into l from public.wms_lots where id = p_lot_id;
  if l.id is null then raise exception 'Lot introuvable'; end if;
  if l.status not in ('RELEASED','EXHAUSTED') then raise exception 'Lot % non libéré (%) : entrée en BIN interdite', l.id, l.status; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantité invalide'; end if;
  select * into b from public.wms_bins where id = p_bin_id;
  if b.id is null then raise exception 'BIN introuvable'; end if;
  if b.warehouse_id <> l.warehouse_id then raise exception 'Le BIN % n''appartient pas au Warehouse du Lot', p_bin_id; end if;
  return public.wms_post_movement(jsonb_build_object('type','BIN_TRANSFER','idempotency_key', p_idempotency_key, 'warehouse_id', l.warehouse_id,
    'source_type','STAGING','source_id', l.warehouse_id::text, 'dest_type','BIN','dest_id', p_bin_id,
    'lots', jsonb_build_array(jsonb_build_object('lot_id', l.id, 'qty_out', p_qty, 'qty_in', p_qty)),
    'truck', l.truck, 'supplier_name', l.supplier_name, 'origin', l.origin, 'reason', 'Affectation Lot → BIN'));
end $$;

create or replace function public.wms_bin_transfer(p_from_bin text, p_to_bin text, p_qty numeric, p_idempotency_key text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; parts jsonb; lots jsonb;
begin
  c := public.wms_require('bin_ops');
  if p_from_bin = p_to_bin then raise exception 'BIN source et destination identiques'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantité invalide'; end if;
  parts := public.wms_split_bin_qty(p_from_bin, p_qty);
  select jsonb_agg(jsonb_build_object('lot_id', x->>'lot_id', 'qty_out', (x->>'qty')::numeric, 'qty_in', (x->>'qty')::numeric)) into lots from jsonb_array_elements(parts) x;
  return public.wms_post_movement(jsonb_build_object('type','BIN_TRANSFER','idempotency_key', p_idempotency_key,
    'source_type','BIN','source_id', p_from_bin, 'dest_type','BIN','dest_id', p_to_bin, 'lots', lots, 'reason', coalesce(p_reason,'Transfert BIN → BIN')));
end $$;

create or replace function public.wms_set_bin_status(p_bin_id text, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; b public.wms_bins; old text;
begin
  select * into b from public.wms_bins where id = p_bin_id for update;
  if b.id is null then raise exception 'BIN introuvable'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motif obligatoire'; end if;
  old := b.status;
  if p_status = 'BLOCKED' then
    c := public.wms_require('bin_close');
    if b.status = 'CLOSED' then raise exception 'BIN clos et verrouillé'; end if;
    update public.wms_bins set status = 'BLOCKED', block_reason = p_reason, updated_at = now() where id = b.id returning * into b;
  elsif p_status = 'UNBLOCK' then
    c := public.wms_require('bin_close');
    if b.status <> 'BLOCKED' then raise exception 'Le BIN n''est pas bloqué'; end if;
    update public.wms_bins set status = case when (select coalesce(sum(qty),0) from public.wms_v_balances v where v.location_type='BIN' and v.location_id=b.id) > 0.0005 then 'ACTIVE' else 'READY_TO_CLOSE' end,
      block_reason = null, updated_at = now() where id = b.id returning * into b;
  elsif p_status = 'REOPEN' then
    c := public.wms_require('bin_reopen');
    if b.status <> 'CLOSED' then raise exception 'Le BIN n''est pas clos'; end if;
    update public.wms_bins set status = 'READY_TO_CLOSE', reopen_count = reopen_count + 1, closed_at = null, physical_empty = null, validated_by = null, validated_by_name = null, updated_at = now() where id = b.id returning * into b;
  else
    raise exception 'Transition inconnue : %', p_status;
  end if;
  perform public.wms_audit(b.id, 'bin.status', to_jsonb(old), to_jsonb(b.status), p_reason, c->>'nom');
  return to_jsonb(b);
end $$;

create or replace function public.wms_close_bin(p_bin_id text, p_physical_empty boolean, p_residue_kg numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; b public.wms_bins; v_bal numeric; v_in numeric;
begin
  c := public.wms_require('bin_close');
  select * into b from public.wms_bins where id = p_bin_id for update;
  if b.id is null then raise exception 'BIN introuvable'; end if;
  if b.status = 'CLOSED' then raise exception 'BIN déjà clos et verrouillé'; end if;
  if b.status = 'BLOCKED' then raise exception 'BIN bloqué : débloquer avant clôture'; end if;
  perform pg_advisory_xact_lock(hashtext('wms_loc:BIN:'||b.id));
  select coalesce(sum(qty),0) into v_bal from public.wms_v_balances where location_type = 'BIN' and location_id = b.id;
  select coalesce(sum(ml.qty_in),0) into v_in from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id = m.id where m.status='POSTED' and m.dest_type='BIN' and m.dest_id=b.id;
  if v_bal > 0.0005 then
    raise exception 'Balance théorique = % kg : clôture impossible tant que le résidu n''est pas sorti (transfert ou ajustement approuvé)', round(v_bal,2);
  end if;
  if coalesce(p_physical_empty,false) = false then raise exception 'Physical Empty Check obligatoire (BIN-006)'; end if;
  if coalesce(p_residue_kg,0) > 0.0005 then raise exception 'Résidu physique déclaré (% kg) : à traiter par ajustement approuvé avant clôture', p_residue_kg; end if;
  update public.wms_bins set status = 'CLOSED', physical_empty = true, residue_kg = coalesce(p_residue_kg,0), closure_reason = p_reason,
    closed_by = (c->>'uid')::uuid, closed_by_name = c->>'nom', closed_at = now(), validated_by = (c->>'uid')::uuid, validated_by_name = c->>'nom', updated_at = now()
  where id = b.id returning * into b;
  perform public.wms_audit(b.id, 'bin.close', to_jsonb('READY_TO_CLOSE'::text), jsonb_build_object('status','CLOSED','total_in_kg', v_in, 'physical_empty', true), coalesce(p_reason,'Clôture & verrouillage'), c->>'nom');
  return to_jsonb(b);
end $$;

create or replace function public.wms_create_drying(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; src public.wms_bins; dst public.wms_bins; parent public.wms_dryings; d public.wms_dryings; v_key text; v_id text; v_type text;
        v_in numeric; v_out numeric; v_loss numeric; v_pct numeric; parts jsonb; lots_issue jsonb; lots_receipt jsonb; ratio numeric; mi jsonb; mr jsonb; v_tol numeric; v_batch text; v_cycle int;
begin
  c := public.wms_require('drying');
  v_key := p->>'idempotency_key';
  if v_key is null then raise exception 'Clé d''idempotence obligatoire'; end if;
  select * into d from public.wms_dryings where issue_movement_id in (select id from public.wms_movements where idempotency_key = 'DRY-ISSUE:'||v_key);
  if d.id is not null then return to_jsonb(d) || jsonb_build_object('idempotent', true); end if;
  v_type := upper(coalesce(p->>'type','DRYING'));
  if v_type not in ('DRYING','SORTING') then raise exception 'Type invalide (DRYING | SORTING)'; end if;
  select * into src from public.wms_bins where id = p->>'source_bin_id';
  if src.id is null then raise exception 'BIN source introuvable'; end if;
  select * into dst from public.wms_bins where id = coalesce(nullif(p->>'dest_bin_id',''), p->>'source_bin_id');
  if dst.id is null then raise exception 'BIN destination introuvable'; end if;
  if dst.warehouse_id <> src.warehouse_id then raise exception 'Source et destination doivent appartenir au même Warehouse'; end if;
  v_in := nullif(p->>'input_kg','')::numeric; v_out := nullif(p->>'output_kg','')::numeric;
  if v_in is null or v_in <= 0 then raise exception 'Input kg obligatoire (> 0)'; end if;
  if v_out is null or v_out < 0 then raise exception 'Output kg obligatoire (≥ 0)'; end if;
  if v_out > v_in then raise exception 'Anomalie : Output (% kg) > Input (% kg) — pas de perte négative masquée', v_out, v_in; end if;
  if v_type = 'DRYING' and (nullif(p->>'moisture_before','') is null or nullif(p->>'moisture_after','') is null) then
    raise exception 'Moisture Before et Moisture After obligatoires pour un cycle de séchage';
  end if;
  v_loss := round(v_in - v_out, 3); v_pct := round(100 * v_loss / v_in, 2);
  v_tol := coalesce((public.wms_param('dryingLossTolerancePct')->>'value')::numeric, 100);
  if nullif(p->>'parent_drying_id','') is not null then
    select * into parent from public.wms_dryings where id = p->>'parent_drying_id';
    if parent.id is null then raise exception 'Opération parente introuvable'; end if;
    v_batch := parent.batch_id; v_cycle := parent.cycle_no + 1;
  end if;
  perform pg_advisory_xact_lock(hashtext('wms_dry_seq'));
  v_id := 'DRY-' || lpad(public.wms_next_seq('DRY')::text, 6, '0');
  if v_batch is null then v_batch := v_id; v_cycle := 1; end if;
  parts := public.wms_split_bin_qty(src.id, v_in);
  ratio := case when v_in > 0 then v_out / v_in else 0 end;
  select jsonb_agg(jsonb_build_object('lot_id', x->>'lot_id', 'qty_out', (x->>'qty')::numeric, 'qty_in', (x->>'qty')::numeric)) into lots_issue from jsonb_array_elements(parts) x;
  select jsonb_agg(jsonb_build_object('lot_id', x->>'lot_id', 'qty_out', (x->>'qty')::numeric, 'qty_in', round((x->>'qty')::numeric * ratio, 3))) into lots_receipt from jsonb_array_elements(parts) x;
  lots_receipt := (
    with l as (select x, ord from jsonb_array_elements(lots_receipt) with ordinality as t(x, ord)), s as (select coalesce(sum((x->>'qty_in')::numeric),0) tot from l)
    select jsonb_agg(case when ord = 1 then x || jsonb_build_object('qty_in', round((x->>'qty_in')::numeric + (v_out - s.tot), 3)) else x end order by ord) from l, s);
  mi := public.wms_post_movement(jsonb_build_object('type','DRYING_ISSUE','idempotency_key','DRY-ISSUE:'||v_key,'warehouse_id', src.warehouse_id,
        'source_type','BIN','source_id', src.id,'dest_type','DRYING','dest_id', v_id,'lots', lots_issue,'reference_type','DRYING','reference_id', v_id,'reason', v_type||' — sortie vers aire de séchage/triage'));
  mr := public.wms_post_movement(jsonb_build_object('type', case when v_type='DRYING' then 'DRYING_RECEIPT' else 'SORTING' end,'idempotency_key','DRY-RECEIPT:'||v_key,'warehouse_id', src.warehouse_id,
        'source_type','DRYING','source_id', v_id,'dest_type','BIN','dest_id', dst.id,'lots', lots_receipt,'process_loss_kg', v_loss,'reference_type','DRYING','reference_id', v_id,'reason', v_type||' — retour matière traitée (perte process déclarée)'));
  insert into public.wms_dryings(id, warehouse_id, type, batch_id, parent_drying_id, cycle_no, source_bin_id, dest_bin_id, input_kg, output_kg, input_bags, output_bags,
    moisture_before, moisture_after, nc_before, nc_after, kor_before, kor_after, process_loss_kg, process_loss_pct, loss_alert, issue_movement_id, receipt_movement_id, note, created_by, created_by_name)
  values (v_id, src.warehouse_id, v_type, v_batch, parent.id, v_cycle, src.id, dst.id, v_in, v_out, nullif(p->>'input_bags','')::int, nullif(p->>'output_bags','')::int,
    nullif(p->>'moisture_before','')::numeric, nullif(p->>'moisture_after','')::numeric, nullif(p->>'nc_before','')::int, nullif(p->>'nc_after','')::int,
    nullif(p->>'kor_before','')::numeric, nullif(p->>'kor_after','')::numeric, v_loss, v_pct, v_pct > v_tol, mi->>'id', mr->>'id', p->>'note', (c->>'uid')::uuid, c->>'nom') returning * into d;
  perform public.wms_audit(v_id, v_type, jsonb_build_object('input_kg', v_in, 'moisture', p->>'moisture_before', 'bin', src.id), jsonb_build_object('output_kg', v_out, 'moisture', p->>'moisture_after', 'bin', dst.id, 'process_loss_kg', v_loss, 'loss_pct', v_pct, 'batch', v_batch, 'cycle', v_cycle), 'Opération '||v_type||case when parent.id is not null then ' (re-dry de '||parent.id||')' else '' end);
  return to_jsonb(d) || jsonb_build_object('idempotent', false, 'contributors', parts);
end $$;
