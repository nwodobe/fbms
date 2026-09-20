-- WMS fonctions RPC — partie 4 (H-L). Source : supabase/20260920_wms_warehouse_functions.sql
create or replace function public.wms_create_inventory_count(p_bin_id text, p_physical_kg numeric, p_note text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; b public.wms_bins; v_theo numeric; v_var numeric; ic public.wms_inventory_counts; v_id text;
begin
  c := public.wms_require('inventory_count');
  if p_idempotency_key is not null then
    select * into ic from public.wms_inventory_counts where idempotency_key = p_idempotency_key limit 1;
    if ic.id is not null then return to_jsonb(ic) || jsonb_build_object('idempotent', true); end if;
  end if;
  if p_physical_kg is null or p_physical_kg < 0 then raise exception 'Quantité physique obligatoire (≥ 0)'; end if;
  select * into b from public.wms_bins where id = p_bin_id for update;
  if b.id is null then raise exception 'BIN introuvable'; end if;
  if b.status = 'CLOSED' then raise exception 'BIN clos : comptage impossible'; end if;
  perform pg_advisory_xact_lock(hashtext('wms_loc:BIN:'||b.id));
  select coalesce(sum(qty),0) into v_theo from public.wms_v_balances where location_type = 'BIN' and location_id = b.id;
  v_var := round(p_physical_kg - v_theo, 3);
  perform pg_advisory_xact_lock(hashtext('wms_inv_seq'));
  v_id := 'INV-' || lpad(public.wms_next_seq('INV')::text, 6, '0');
  insert into public.wms_inventory_counts(id, warehouse_id, bin_id, theoretical_kg, physical_kg, variance_kg, status, note, idempotency_key, counted_by, counted_by_name)
  values (v_id, b.warehouse_id, b.id, v_theo, p_physical_kg, v_var, case when abs(v_var) < 0.0005 then 'CLOSED' else 'REVIEW_REQUIRED' end,
          p_note, p_idempotency_key, (c->>'uid')::uuid, c->>'nom') returning * into ic;
  perform public.wms_audit(v_id, 'inventory.count', jsonb_build_object('bin', b.id, 'theoretical_kg', v_theo), jsonb_build_object('physical_kg', p_physical_kg, 'variance_kg', v_var, 'status', ic.status), 'Comptage physique (stock système inchangé)');
  return to_jsonb(ic) || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.wms_resolve_inventory_count(p_count_id text, p_approve boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; ic public.wms_inventory_counts; b public.wms_bins; m jsonb; parts jsonb; lots jsonb; v_bal numeric; anylot text;
begin
  c := public.wms_require('inventory_approve');
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motif obligatoire pour résoudre un écart'; end if;
  select * into ic from public.wms_inventory_counts where id = p_count_id for update;
  if ic.id is null then raise exception 'Comptage introuvable'; end if;
  if ic.status <> 'REVIEW_REQUIRED' then raise exception 'Comptage déjà résolu (%)', ic.status; end if;
  if ic.counted_by = (c->>'uid')::uuid and ic.counted_by is not null then raise exception 'Séparation des tâches : l''approbateur doit être différent du compteur' using errcode = '42501'; end if;
  select * into b from public.wms_bins where id = ic.bin_id for update;
  if not p_approve then
    update public.wms_inventory_counts set status = 'REJECTED', review_reason = p_reason, approved_by = (c->>'uid')::uuid, approved_by_name = c->>'nom', approved_at = now() where id = ic.id returning * into ic;
    perform public.wms_audit(ic.id, 'inventory.review', to_jsonb('REVIEW_REQUIRED'::text), to_jsonb('REJECTED'::text), p_reason, c->>'nom');
    return to_jsonb(ic);
  end if;
  if ic.variance_kg < 0 then
    parts := public.wms_split_bin_qty(b.id, abs(ic.variance_kg));
    select jsonb_agg(jsonb_build_object('lot_id', x->>'lot_id', 'qty_out', (x->>'qty')::numeric, 'qty_in', 0)) into lots from jsonb_array_elements(parts) x;
    m := public.wms_post_movement(jsonb_build_object('type','ADJUSTMENT','idempotency_key','INV-ADJ:'||ic.id,'warehouse_id', b.warehouse_id,
          'source_type','BIN','source_id', b.id,'dest_type','ADJUSTMENT','dest_id', ic.id,'lots', lots,'reference_type','INVENTORY','reference_id', ic.id,'reason', p_reason,'approved_by', c->>'nom'));
  else
    select coalesce(sum(qty),0) into v_bal from public.wms_v_balances where location_type='BIN' and location_id=b.id and qty > 0;
    if v_bal > 0.0005 then
      parts := public.wms_split_bin_qty(b.id, v_bal);
      select jsonb_agg(jsonb_build_object('lot_id', x->>'lot_id', 'qty_out', 0, 'qty_in', round(ic.variance_kg * (x->>'qty')::numeric / v_bal, 3))) into lots from jsonb_array_elements(parts) x;
    else
      select ml.lot_id into anylot from public.wms_movements mm join public.wms_movement_lots ml on ml.movement_id = mm.id where mm.dest_type='BIN' and mm.dest_id=b.id order by mm.posted_at desc limit 1;
      if anylot is null then raise exception 'Aucun Lot contributeur connu : excédent impossible à rattacher (stock anonyme interdit)'; end if;
      lots := jsonb_build_array(jsonb_build_object('lot_id', anylot, 'qty_out', 0, 'qty_in', ic.variance_kg));
    end if;
    m := public.wms_post_movement(jsonb_build_object('type','ADJUSTMENT','idempotency_key','INV-ADJ:'||ic.id,'warehouse_id', b.warehouse_id,
          'source_type','ADJUSTMENT','source_id', ic.id,'dest_type','BIN','dest_id', b.id,'lots', lots,'reference_type','INVENTORY','reference_id', ic.id,'reason', p_reason,'approved_by', c->>'nom'));
  end if;
  update public.wms_inventory_counts set status = 'ADJUSTED', review_reason = p_reason, approved_by = (c->>'uid')::uuid, approved_by_name = c->>'nom', approved_at = now(), adjustment_movement_id = m->>'id' where id = ic.id returning * into ic;
  perform public.wms_audit(ic.id, 'inventory.adjust', jsonb_build_object('theoretical_kg', ic.theoretical_kg), jsonb_build_object('physical_kg', ic.physical_kg, 'variance_kg', ic.variance_kg, 'movement', m->>'id'), p_reason, c->>'nom');
  return to_jsonb(ic) || jsonb_build_object('movement', m->>'id');
end $$;

create or replace function public.wms_correct_reception(p_id text, p_field text, p_value text, p_reason text, p_approver text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_receptions; before jsonb; after jsonb;
begin
  c := public.wms_require('correction');
  if p_field not in ('expected_kg','expected_bags','truck','supplier_name','supplier_code','origin','driver','transporter','reference','weighbridge_ticket','delivery_note') then
    raise exception 'Champ « % » non corrigeable', p_field;
  end if;
  if coalesce(btrim(p_reason),'') = '' or coalesce(btrim(p_approver),'') = '' then raise exception 'Motif et approbateur obligatoires'; end if;
  select * into r from public.wms_receptions where id = p_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status in ('CLOSED') then raise exception 'Dossier clos : correction par transaction contrôlée uniquement'; end if;
  before := to_jsonb(r) -> p_field;
  if p_field = 'expected_kg' then
    update public.wms_receptions set expected_kg = nullif(p_value,'')::numeric, updated_by = (c->>'uid')::uuid, updated_at = now() where id = p_id;
  elsif p_field = 'expected_bags' then
    update public.wms_receptions set expected_bags = nullif(p_value,'')::int, updated_by = (c->>'uid')::uuid, updated_at = now() where id = p_id;
  else
    execute format('update public.wms_receptions set %I = $1, updated_by = $2, updated_at = now() where id = $3', p_field) using p_value, (c->>'uid')::uuid, p_id;
  end if;
  select to_jsonb(x) -> p_field into after from public.wms_receptions x where id = p_id;
  perform public.wms_audit(p_id, 'correction.'||p_field, before, after, p_reason, p_approver);
  return jsonb_build_object('id', p_id, 'field', p_field, 'before', before, 'after', after);
end $$;

create or replace function public.wms_bag_move(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; v_kind text; v_qty int; v_loc text; v_sup text; v_key text; v_id text; v_ref text; v_avail int; v_to_state text; ids text[] := '{}';
begin
  c := public.wms_require('bag_move');
  v_kind := upper(p->>'kind'); v_qty := nullif(p->>'qty','')::int; v_loc := p->>'location'; v_sup := nullif(p->>'supplier_code',''); v_key := p->>'idempotency_key'; v_ref := coalesce(p->>'reference', v_key);
  if v_key is null then raise exception 'Clé d''idempotence obligatoire'; end if;
  if exists (select 1 from public.rcn_jute_movements where event_key = 'WMS:'||v_key||':A') then
    return jsonb_build_object('idempotent', true, 'ids', (select array_agg(id) from public.rcn_jute_movements where event_key like 'WMS:'||v_key||':%'));
  end if;
  if v_qty is null or v_qty <= 0 then raise exception 'Quantité de sacs invalide'; end if;
  if v_loc is null or not exists (select 1 from public.rcn_jute_locations where code = v_loc and actif) then raise exception 'Emplacement sacherie « % » inconnu', v_loc; end if;
  perform pg_advisory_xact_lock(42070, hashtext(v_loc));
  if v_kind in ('DOTATION','RETURN','APPROVED_LOSS') and v_sup is null then raise exception 'Fournisseur obligatoire pour ce mouvement'; end if;
  if v_kind in ('DOTATION','INTERNAL_USE','DAMAGED','REBAGGING','REPAIR_OUT') then
    select coalesce(sum(qty),0) into v_avail from public.rcn_jute_v_stock where location_code = v_loc and state = 'UTILISABLE';
    if v_avail < v_qty then raise exception 'Stock utilisable insuffisant à % (disponible : %) — stock négatif refusé', v_loc, v_avail; end if;
  end if;
  if v_kind = 'DOTATION' then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,supplier_code,qty,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','DOTATION','FOURNISSEUR',v_sup,v_qty,'WMS',v_ref,v_ref,p->>'note','FOURNISSEUR',(c->>'uid')::uuid,now());
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':B','DOTATION','INTERNE',v_qty,v_loc,'UTILISABLE','WMS',v_ref,v_ref,'Sortie physique · dotation '||v_sup,'ANAGROCI',(c->>'uid')::uuid,now());
  elsif v_kind = 'RETURN' then
    v_to_state := case upper(coalesce(p->>'condition','GOOD')) when 'GOOD' then 'UTILISABLE' when 'DAMAGED' then 'DECHIRE' when 'WET' then 'HUMIDE' when 'REPAIRABLE' then 'A_REPARER' else 'A_CLASSER' end;
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,supplier_code,qty,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','RETOUR','FOURNISSEUR',v_sup,v_qty,'WMS',v_ref,v_ref,p->>'note','FOURNISSEUR',(c->>'uid')::uuid,now());
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':B','RETOUR','INTERNE',v_qty,v_loc,v_to_state,'WMS',v_ref,v_ref,'Retour physique · '||v_sup||' · état '||v_to_state,'ANAGROCI',(c->>'uid')::uuid,now());
  elsif v_kind = 'APPROVED_LOSS' then
    if coalesce(btrim(p->>'approved_by'),'') = '' or coalesce(btrim(p->>'note'),'') = '' then raise exception 'Perte approuvée : approbateur et motif obligatoires'; end if;
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,supplier_code,qty,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','PERTE_APPROUVEE','FOURNISSEUR',v_sup,v_qty,'WMS',v_ref,v_ref,p->>'note'||' · approuvé par '||(p->>'approved_by'),'FOURNISSEUR',(c->>'uid')::uuid,now());
  elsif v_kind in ('DAMAGED','REPAIR_OUT','RECONDITIONED','SCRAP','INTERNAL_USE','RETURN_FROM_USE') then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A',
      case v_kind when 'RECONDITIONED' then 'REPARATION_RETOUR' when 'SCRAP' then 'REFORME' else 'CLASSEMENT' end, 'INTERNE', v_qty, v_loc, v_loc,
      case v_kind when 'DAMAGED' then 'UTILISABLE' when 'REPAIR_OUT' then 'DECHIRE' when 'RECONDITIONED' then 'A_REPARER' when 'SCRAP' then coalesce(p->>'from_state','DECHIRE') when 'INTERNAL_USE' then 'UTILISABLE' when 'RETURN_FROM_USE' then 'PLEIN' end,
      case v_kind when 'DAMAGED' then 'DECHIRE' when 'REPAIR_OUT' then 'A_REPARER' when 'RECONDITIONED' then 'REPARE' when 'SCRAP' then 'REFORME' when 'INTERNAL_USE' then 'PLEIN' when 'RETURN_FROM_USE' then 'UTILISABLE' end,
      'WMS', v_ref, v_ref, p->>'note', 'ANAGROCI', (c->>'uid')::uuid, now());
    if v_kind = 'RECONDITIONED' and coalesce((p->>'verified')::boolean,false) then
      v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
      insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
      values (v_id,'WMS:'||v_key||':B','CLASSEMENT','INTERNE',v_qty,v_loc,v_loc,'REPARE','UTILISABLE','WMS',v_ref,v_ref,'Vérification reconditionnement OK','ANAGROCI',(c->>'uid')::uuid,now());
    end if;
  elsif v_kind = 'REBAGGING' then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,source_type,source_id,reference,note,owner_type,created_by,movement_at,bin_id,lot_id)
    values (v_id,'WMS:'||v_key||':A','REBAGING','INTERNE',v_qty,v_loc,'UTILISABLE','WMS',v_ref,v_ref,p->>'note','ANAGROCI',(c->>'uid')::uuid,now(),p->>'bin_id',p->>'lot_id');
  else
    raise exception 'Type de mouvement sacherie inconnu : %', v_kind;
  end if;
  perform public.wms_audit('BAG:'||v_loc, 'bag.'||lower(v_kind), null, jsonb_build_object('qty', v_qty, 'supplier', v_sup, 'ids', to_jsonb(ids)), coalesce(p->>'note', v_kind), p->>'approved_by');
  return jsonb_build_object('idempotent', false, 'ids', to_jsonb(ids));
end $$;

create or replace function public.wms_overview(p_warehouse_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; alert numeric; aging int;
begin
  c := public.wms_ctx();
  alert := coalesce((public.wms_param('binCapacityAlertPct')->>'value')::numeric, 90);
  aging := coalesce((public.wms_param('wetStockAgingHours')->>'value')::int, 48);
  return jsonb_build_object(
    'awaiting_sampling', (select count(*) from public.wms_receptions r where r.status='ARRIVED' and (p_warehouse_id is null or r.warehouse_id=p_warehouse_id)),
    'awaiting_decision', (select count(*) from public.wms_receptions r where r.status='AWAITING_DECISION' and (p_warehouse_id is null or r.warehouse_id=p_warehouse_id)),
    'accepted_waiting_offload', (select count(*) from public.wms_receptions r where r.status='ACCEPTED_WAITING_OFFLOAD' and (p_warehouse_id is null or r.warehouse_id=p_warehouse_id)),
    'final_qa_pending', (select count(*) from public.wms_v_receptions r where r.status='AWAITING_FINAL_QA' and r.final_id is null and (p_warehouse_id is null or r.warehouse_id=p_warehouse_id)),
    'release_pending', (select count(*) from public.wms_v_receptions r where r.status='AWAITING_FINAL_QA' and r.final_id is not null and (p_warehouse_id is null or r.warehouse_id=p_warehouse_id)),
    'quality_hold', (select count(*) from public.wms_receptions r where r.status='QUALITY_HOLD' and (p_warehouse_id is null or r.warehouse_id=p_warehouse_id)),
    'released_today', (select count(*) from public.wms_lots l where l.created_at::date = current_date and (p_warehouse_id is null or l.warehouse_id=p_warehouse_id)),
    'lots_staging', (select count(*) from public.wms_v_lots l where l.staging_kg > 0.0005 and (p_warehouse_id is null or l.warehouse_id=p_warehouse_id)),
    'staging_kg', (select coalesce(sum(staging_kg),0) from public.wms_v_lots l where (p_warehouse_id is null or l.warehouse_id=p_warehouse_id)),
    'active_bins', (select count(*) from public.wms_v_bins b where b.status in ('OPEN','ACTIVE') and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),
    'bins_over_threshold', (select count(*) from public.wms_v_bins b where b.status<>'CLOSED' and b.occupancy_pct >= alert and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),
    'bins_ready_to_close', (select count(*) from public.wms_v_bins b where b.status='READY_TO_CLOSE' and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),
    'bins_blocked', (select count(*) from public.wms_v_bins b where b.status='BLOCKED' and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),
    'wet_stock_kg', (select coalesce(sum(balance_kg),0) from public.wms_v_bins b where b.stock_type='WET' and b.status<>'CLOSED' and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),
    'dry_stock_kg', (select coalesce(sum(balance_kg),0) from public.wms_v_bins b where b.stock_type='DRY' and b.status<>'CLOSED' and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),
    'hold_stock_kg', (select coalesce(sum(balance_kg),0) from public.wms_v_bins b where b.stock_type='HOLD' and b.status<>'CLOSED' and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),
    'wet_aging_bins', (select count(*) from public.wms_v_bins b where b.stock_type='WET' and b.balance_kg>0.0005 and b.age_hours >= aging and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),
    'inventory_variances', (select count(*) from public.wms_inventory_counts i where i.status='REVIEW_REQUIRED' and (p_warehouse_id is null or i.warehouse_id=p_warehouse_id)),
    'drying_loss_alerts', (select count(*) from public.wms_dryings d where d.loss_alert and (p_warehouse_id is null or d.warehouse_id=p_warehouse_id)),
    'outstanding_bags', (select coalesce(sum(balance),0) from public.rcn_jute_v_supplier_balance),
    'params', jsonb_build_object('binCapacityAlertPct', alert, 'wetStockAgingHours', aging, 'korFactor', public.wms_param('korFactor'), 'korTolerance', public.wms_param('korTolerance'))
  );
end $$;

do $$
declare f text;
begin
  foreach f in array array['wms_ctx()','wms_can(text)','wms_require(text)','wms_my_permissions()','wms_param(text)','wms_set_parameter(text,jsonb,text)',
    'wms_upsert_warehouse(jsonb)','wms_set_warehouse_status(uuid,text,text)','wms_delete_warehouse(uuid)','wms_upsert_area(jsonb)',
    'wms_create_reception(jsonb,text)','wms_decide_reception(text,boolean,text)','wms_record_offload(text,jsonb)',
    'wms_compute_kor(numeric,numeric,numeric)','wms_save_quality(text,text,jsonb)','wms_set_hold(text,boolean,text)',
    'wms_post_movement(jsonb)','wms_split_bin_qty(text,numeric)','wms_release_lot(text,text)','wms_create_bin(jsonb)',
    'wms_allocate_lot_to_bin(text,text,numeric,text)','wms_bin_transfer(text,text,numeric,text,text)','wms_set_bin_status(text,text,text)','wms_close_bin(text,boolean,numeric,text)',
    'wms_create_drying(jsonb)','wms_create_inventory_count(text,numeric,text,text)','wms_resolve_inventory_count(text,boolean,text)',
    'wms_correct_reception(text,text,text,text,text)','wms_bag_move(jsonb)','wms_overview(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon;', f);
    execute format('grant execute on function public.%s to authenticated;', f);
  end loop;
  revoke all on function public.wms_next_seq(text) from public, anon, authenticated;
  revoke all on function public.wms_audit(text,text,jsonb,jsonb,text,text) from public, anon, authenticated;
end $$;
