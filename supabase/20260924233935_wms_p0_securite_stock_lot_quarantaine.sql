-- =====================================================================
-- FBMS · Correctifs audit Procurement & Warehouse du 24/09/2026
-- Lot 1 (sécurité stock, P0-03, P1-07) et lot 2 (refus, quarantaine,
-- HOLD, dérogation, contrôle achat : P0-01, P0-02, P1-10, P1-11).
--
-- Migration NON destructive :
--   * aucune table supprimée, aucune donnée supprimée ou réécrite ;
--   * les contraintes CHECK élargies sont remplacées par un sur-ensemble ;
--   * les fonctions sont remplacées (CREATE OR REPLACE) en conservant
--     leur signature, leurs droits et leur idempotence.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Référentiels de statuts élargis (sur-ensembles stricts)
-- ---------------------------------------------------------------------
alter table public.wms_lots drop constraint if exists wms_lots_status_check;
alter table public.wms_lots add constraint wms_lots_status_check
  check (status = any (array['QUARANTINE','HOLD','REQUIRES_DECISION','REJECTED','RELEASED','EXHAUSTED','CLOSED']));

alter table public.wms_movements drop constraint if exists wms_movements_type_check;
alter table public.wms_movements add constraint wms_movements_type_check
  check (type = any (array['OFFLOAD','BIN_TRANSFER','DRYING_ISSUE','DRYING_RECEIPT','SORTING','TRANSFER_OUT','TRANSFER_IN','PRODUCTION_ISSUE','ADJUSTMENT','RETURN_TO_SUPPLIER']));
alter table public.wms_movements drop constraint if exists wms_movements_source_type_check;
alter table public.wms_movements add constraint wms_movements_source_type_check
  check (source_type is null or source_type = any (array['TRUCK','STAGING','BIN','DRYING','TRANSIT','PRODUCTION','ADJUSTMENT','SUPPLIER']));
alter table public.wms_movements drop constraint if exists wms_movements_dest_type_check;
alter table public.wms_movements add constraint wms_movements_dest_type_check
  check (dest_type is null or dest_type = any (array['TRUCK','STAGING','BIN','DRYING','TRANSIT','PRODUCTION','ADJUSTMENT','SUPPLIER']));

alter table public.wms_lots add column if not exists hold_reason text;
alter table public.wms_lots add column if not exists status_changed_at timestamptz;
alter table public.wms_lots add column if not exists status_changed_by text;
alter table public.wms_lots add column if not exists derogation_id text;

-- ---------------------------------------------------------------------
-- 2. Dérogations qualité (traçabilité des levées exceptionnelles)
-- ---------------------------------------------------------------------
create table if not exists public.wms_quality_derogations (
  id text primary key,
  lot_id text not null references public.wms_lots(id),
  reception_id text not null references public.wms_receptions(id),
  kind text not null default 'QUALITY_RELEASE' check (kind in ('QUALITY_RELEASE','DOCUMENTS')),
  reason text not null check (btrim(reason) <> ''),
  final_snapshot_id text,
  final_kor numeric,
  final_delta numeric,
  idempotency_key text unique,
  decided_by uuid,
  decided_by_name text,
  decided_role text,
  created_at timestamptz not null default now()
);
alter table public.wms_quality_derogations enable row level security;
drop policy if exists wms_quality_derogations_sel on public.wms_quality_derogations;
create policy wms_quality_derogations_sel on public.wms_quality_derogations
  for select to authenticated using ((select public.rcn_est_actif()));
revoke insert, update, delete, truncate on public.wms_quality_derogations from anon, authenticated;
grant select on public.wms_quality_derogations to authenticated;

-- ---------------------------------------------------------------------
-- 3. Matrice des rôles v2 (ajout des actions nouvelles uniquement,
--    les actions existantes sont reprises à l'identique)
-- ---------------------------------------------------------------------
insert into public.wms_parameters(key, value, version, effective_from, approved_by, reason, active)
select 'roleMatrix',
       v.value
       || jsonb_build_object(
            'quality_derogation', '["Branch Manager","QA / Lab"]'::jsonb,
            'lot_reject',         v.value->'decision',
            'lot_return',         v.value->'offload',
            'hold_bin_place',     v.value->'bin_ops',
            'document_record',    v.value->'reception_create',
            'document_derogation','["Branch Manager"]'::jsonb,
            'grn_generate',       (select jsonb_agg(distinct x) from jsonb_array_elements(v.value->'offload' || v.value->'decision' || v.value->'lot_release') x),
            'profile_assign',     '["Branch Manager"]'::jsonb,
            'jute_production',    (select jsonb_agg(distinct x) from jsonb_array_elements(v.value->'bag_move' || '["Factory User"]'::jsonb) x)
          ),
       (select coalesce(max(version),0)+1 from public.wms_parameters where key='roleMatrix'),
       now(), null,
       'Correctifs audit 24/09/2026 : actions dérogation, rejet après déchargement, BIN HOLD, documents, GRN, affectation profils, sacherie production. Valeurs à valider (voir statut de gouvernance).',
       true
from public.wms_parameters v
where v.key='roleMatrix' and v.version=1
  and not exists (select 1 from public.wms_parameters w where w.key='roleMatrix' and w.value ? 'quality_derogation');

-- ---------------------------------------------------------------------
-- 4. Périmètre Warehouse des rôles rattachés (P0-03)
--    Source unique : transferRoleMatrix.warehouse_scoped_roles.
--    Un rôle rattaché SANS warehouse_code est refusé (plus de passe-droit).
-- ---------------------------------------------------------------------
create or replace function private.wms_scope_violation(p_warehouse_id uuid)
returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_role text; v_code text; v_wh text; v_scoped jsonb;
begin
  if v_uid is null or p_warehouse_id is null then return null; end if;
  select role, nullif(btrim(warehouse_code),'') into v_role, v_code
    from public.profils where user_id = v_uid and coalesce(actif,false);
  if v_role is null then return null; end if;
  v_scoped := coalesce(public.wms_param('transferRoleMatrix')->'warehouse_scoped_roles', '[]'::jsonb);
  if not (v_scoped ? v_role) then return null; end if;
  if v_code is null then
    return format('Profil « %s » sans Warehouse de rattachement : action refusée (rattachement obligatoire).', v_role);
  end if;
  select code into v_wh from public.wms_warehouses where id = p_warehouse_id;
  if v_wh is distinct from v_code then
    return format('Périmètre : votre profil est rattaché au Warehouse %s ; action refusée sur %s.', v_code, coalesce(v_wh,'?'));
  end if;
  return null;
end $$;
revoke all on function private.wms_scope_violation(uuid) from public, anon, authenticated;

create or replace function private.wms_enforce_warehouse_scope()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_msg text;
begin
  -- Le workflow Stock Transfer applique déjà son propre contrôle (wms_trf_require).
  if coalesce(current_setting('wms.trf_ctx', true), '') <> '' then return new; end if;
  v_msg := private.wms_scope_violation(new.warehouse_id);
  if v_msg is null and tg_op = 'UPDATE' and new.warehouse_id is distinct from old.warehouse_id then
    v_msg := private.wms_scope_violation(old.warehouse_id);
  end if;
  if v_msg is not null then raise exception '%', v_msg using errcode = '42501'; end if;
  return new;
end $$;
revoke all on function private.wms_enforce_warehouse_scope() from public, anon, authenticated;

drop trigger if exists trg_wms_scope_movements on public.wms_movements;
create trigger trg_wms_scope_movements before insert on public.wms_movements
  for each row execute function private.wms_enforce_warehouse_scope();
drop trigger if exists trg_wms_scope_receptions on public.wms_receptions;
create trigger trg_wms_scope_receptions before insert or update on public.wms_receptions
  for each row execute function private.wms_enforce_warehouse_scope();
drop trigger if exists trg_wms_scope_lots on public.wms_lots;
create trigger trg_wms_scope_lots before insert on public.wms_lots
  for each row execute function private.wms_enforce_warehouse_scope();
drop trigger if exists trg_wms_scope_bins on public.wms_bins;
create trigger trg_wms_scope_bins before insert or update on public.wms_bins
  for each row execute function private.wms_enforce_warehouse_scope();
drop trigger if exists trg_wms_scope_inventory on public.wms_inventory_counts;
create trigger trg_wms_scope_inventory before insert or update on public.wms_inventory_counts
  for each row execute function private.wms_enforce_warehouse_scope();
drop trigger if exists trg_wms_scope_dryings on public.wms_dryings;
create trigger trg_wms_scope_dryings before insert or update on public.wms_dryings
  for each row execute function private.wms_enforce_warehouse_scope();

-- ---------------------------------------------------------------------
-- 5. Moteur de mouvements : interne uniquement (P0-03)
--    + règles de statut Lot (P0-02) + BIN même Warehouse (P1-07)
-- ---------------------------------------------------------------------
create or replace function public.wms_post_movement(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    if v_wh is not null and v_src_bin.warehouse_id <> v_wh then
      raise exception 'BIN source % hors du Warehouse du mouvement', v_src_i using errcode = '42501';
    end if;
    v_wh := coalesce(v_wh, v_src_bin.warehouse_id);
  end if;
  if v_dst_t = 'BIN' then
    select * into v_bin from public.wms_bins where id = v_dst_i for update;
    if v_bin.id is null then raise exception 'BIN destination % introuvable', v_dst_i; end if;
    if v_bin.status in ('CLOSED','BLOCKED') or (v_bin.status = 'READY_TO_CLOSE' and v_type not in ('DRYING_RECEIPT','SORTING','ADJUSTMENT')) then
      raise exception 'BIN % : statut % — aucune entrée possible', v_dst_i, v_bin.status;
    end if;
    if v_src_bin.id is not null and v_src_bin.warehouse_id <> v_bin.warehouse_id then
      raise exception 'Transfert inter-entrepôts interdit hors workflow Stock Transfer : BIN % → BIN %', v_src_i, v_dst_i using errcode = '42501';
    end if;
    if v_src_t = 'STAGING' and v_src_i is distinct from v_bin.warehouse_id::text then
      raise exception 'Le BIN % n''appartient pas au Warehouse du staging source', v_dst_i using errcode = '42501';
    end if;
    if v_wh is not null and v_bin.warehouse_id <> v_wh then
      raise exception 'BIN destination % hors du Warehouse du mouvement', v_dst_i using errcode = '42501';
    end if;
    if v_src_bin.id is not null and v_src_bin.stock_type <> v_bin.stock_type and v_type not in ('DRYING_RECEIPT','SORTING','ADJUSTMENT') then
      raise exception 'Mélange interdit : BIN % (%) → BIN % (%)', v_src_i, v_src_bin.stock_type, v_dst_i, v_bin.stock_type;
    end if;
    v_wh := coalesce(v_wh, v_bin.warehouse_id);
  end if;
  for lot in select * from jsonb_array_elements(v_lots) loop
    select * into v_lot from public.wms_lots where id = lot->>'lot_id';
    if v_lot.id is null then raise exception 'Lot % introuvable', lot->>'lot_id'; end if;
    -- Règle P0-02 : un Lot non libéré reste visible en stock mais ne circule pas.
    if v_lot.status in ('QUARANTINE','HOLD','REQUIRES_DECISION','REJECTED') then
      if v_type = 'OFFLOAD' then
        null;
      elsif v_type = 'ADJUSTMENT' then
        null; -- ajustement d'inventaire approuvé (motif + approbateur contrôlés plus bas)
      elsif v_type = 'BIN_TRANSFER' and v_dst_t = 'BIN' and v_bin.stock_type = 'HOLD'
            and v_src_t in ('STAGING','BIN') and (v_src_bin.id is null or v_src_bin.stock_type = 'HOLD') then
        null; -- mise à l'écart physique en BIN HOLD
      elsif v_type = 'RETURN_TO_SUPPLIER' and v_lot.status = 'REJECTED' then
        null; -- sortie d'un Lot rejeté (reprise fournisseur)
      else
        raise exception 'Lot % au statut % : mouvement % interdit (seuls la mise en BIN HOLD, le retour fournisseur d''un Lot rejeté et l''ajustement d''inventaire approuvé sont autorisés).', v_lot.id, v_lot.status, v_type
          using errcode = '42501';
      end if;
    end if;
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
  if v_type = 'RETURN_TO_SUPPLIER' and (v_dst_t is distinct from 'SUPPLIER' or v_src_t not in ('STAGING','BIN')) then
    raise exception 'Retour fournisseur : source STAGING/BIN et destination SUPPLIER obligatoires';
  end if;
  v_loss := coalesce(nullif(p->>'process_loss_kg','')::numeric, 0);
  if v_loss < 0 then raise exception 'Perte process négative interdite'; end if;
  v_var := round(v_out - v_in - v_loss, 3);
  if v_type = 'ADJUSTMENT' then
    v_var := round(v_in - v_out, 3);
    if coalesce(btrim(p->>'reason'),'') = '' or coalesce(btrim(p->>'approved_by'),'') = '' then raise exception 'ADJUSTMENT : motif et approbateur obligatoires'; end if;
  elsif v_type in ('OFFLOAD','BIN_TRANSFER','DRYING_ISSUE','TRANSFER_OUT','TRANSFER_IN','PRODUCTION_ISSUE','RETURN_TO_SUPPLIER') and v_var <> 0 then
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
end $function$;

-- P0-03 : plus aucun appel direct depuis le navigateur.
revoke execute on function public.wms_post_movement(jsonb) from public, anon, authenticated;
revoke execute on function public.wms_split_bin_qty(text, numeric) from public, anon, authenticated;
revoke execute on function public.wms_capture_field_genealogy() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Refus camion (P0-01) : l'ancienne RPC ne peut plus échouer faute de
--    motif structuré. Sans motif catalogue, le refus est classé OTHER
--    (commentaire déjà obligatoire).
-- ---------------------------------------------------------------------
create or replace function public.wms_decide_reception(p_id text, p_accept boolean, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; r public.wms_receptions; old text;
begin
  c := public.wms_require('decision');
  select * into r from public.wms_receptions where id = p_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status <> 'AWAITING_DECISION' then raise exception 'Décision impossible : statut % (le Sampling doit être saisi)', r.status; end if;
  if not p_accept and coalesce(btrim(p_comment),'') = '' then raise exception 'Motif obligatoire en cas de refus'; end if;
  if not p_accept and r.rejection_reason_code is null then
    update public.wms_receptions set rejection_reason_code = 'OTHER' where id = p_id returning * into r;
  end if;
  old := r.status;
  update public.wms_receptions set status = case when p_accept then 'ACCEPTED_WAITING_OFFLOAD' else 'REJECTED' end,
    decision = case when p_accept then 'ACCEPTED' else 'REJECTED' end, decision_comment = p_comment,
    decided_by = (c->>'uid')::uuid, decided_by_name = c->>'nom', decided_at = now(), updated_by = (c->>'uid')::uuid, updated_at = now()
  where id = p_id returning * into r;
  perform public.wms_audit(r.id, 'decision', to_jsonb(old), to_jsonb(r.status), coalesce(p_comment, case when p_accept then 'Camion accepté' else 'Camion refusé' end), c->>'nom');
  return to_jsonb(r);
end $function$;

-- ---------------------------------------------------------------------
-- 7. Déchargement = création immédiate du Lot en QUARANTAINE (P0-02, P1-10)
--    Toute marchandise déchargée entre au registre de stock, même si la
--    qualité finale n'est pas encore faite ou échoue.
-- ---------------------------------------------------------------------
create or replace function public.wms_record_offload(p_id text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c jsonb; r public.wms_receptions; v_gross numeric; v_tare numeric; v_net numeric;
  v_entered numeric; v_bags int; s public.wms_quality_snapshots; v_lot text; m jsonb;
begin
  c:=public.wms_require('offload');
  select * into r from public.wms_receptions where id=p_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status<>'ACCEPTED_WAITING_OFFLOAD' then
    raise exception 'Déchargement interdit : la réception est « % » (autorisation requise)',r.status using errcode='42501';
  end if;

  v_gross:=nullif(p->>'gross_kg','')::numeric;
  v_tare:=nullif(p->>'tare_kg','')::numeric;
  v_entered:=nullif(p->>'net_kg','')::numeric;
  if v_gross is null or v_tare is null then raise exception 'Gross Weight et Tare Weight obligatoires'; end if;
  if v_tare<0 or v_gross<=v_tare then raise exception 'Pesée incohérente : Gross doit être supérieur à Tare et Tare >= 0'; end if;
  v_net:=round(v_gross-v_tare,3);
  if v_entered is not null and abs(v_entered-v_net)>0.001 then
    raise exception 'Net Weight incohérent : attendu % kg (= Gross % - Tare %), reçu % kg',v_net,v_gross,v_tare,v_entered;
  end if;

  v_bags:=nullif(p->>'bags','')::int;
  if v_bags is null then
    v_bags:=coalesce(nullif(p->>'bags_good','')::int,0)+coalesce(nullif(p->>'bags_wet','')::int,0)+coalesce(nullif(p->>'bags_torn','')::int,0)+coalesce(nullif(p->>'bags_recond','')::int,0);
    if v_bags=0 then v_bags:=null; end if;
  end if;

  update public.wms_receptions set
    gross_kg=v_gross,tare_kg=v_tare,net_kg=v_net,bags=v_bags,
    bags_good=nullif(p->>'bags_good','')::int,bags_wet=nullif(p->>'bags_wet','')::int,
    bags_torn=nullif(p->>'bags_torn','')::int,bags_recond=nullif(p->>'bags_recond','')::int,
    weighbridge_ticket=coalesce(nullif(p->>'weighbridge_ticket',''),r.weighbridge_ticket),
    delivery_note=coalesce(nullif(p->>'delivery_note',''),r.delivery_note),
    warehouse_receipt=coalesce(nullif(p->>'warehouse_receipt',''),r.warehouse_receipt),
    offload_start=nullif(p->>'offload_start','')::timestamptz,offload_end=nullif(p->>'offload_end','')::timestamptz,
    offloaded_by=(c->>'uid')::uuid,offloaded_at=now(),status='AWAITING_FINAL_QA',
    updated_by=(c->>'uid')::uuid,updated_at=now()
  where id=p_id returning * into r;

  -- Lot officiel créé dès le déchargement, en QUARANTAINE.
  select * into s from public.wms_v_quality_current where reception_id = r.id and type = 'SAMPLING';
  perform pg_advisory_xact_lock(hashtext('wms_lot_seq'));
  v_lot := 'RCN-' || to_char(now() at time zone 'UTC','YYYYMMDD') || '-' || lpad(public.wms_next_seq('RCN:'||to_char(now() at time zone 'UTC','YYYYMMDD'))::text, 3, '0');
  insert into public.wms_lots(id, reception_id, warehouse_id, truck, supplier_name, supplier_code, origin, initial_kg, initial_bags,
                              kor_sampling, status, status_changed_at, status_changed_by, created_by, created_by_name)
  values (v_lot, r.id, r.warehouse_id, r.truck, r.supplier_name, r.supplier_code, r.origin, v_net, v_bags,
          s.kor_exact, 'QUARANTINE', now(), c->>'nom', (c->>'uid')::uuid, c->>'nom');
  update public.wms_quality_snapshots set lot_id = v_lot where reception_id = r.id and lot_id is null;
  update public.wms_receptions set lot_id = v_lot where id = r.id returning * into r;
  m := public.wms_post_movement(jsonb_build_object('type','OFFLOAD','idempotency_key','OFFLOAD:'||r.id,
        'warehouse_id', r.warehouse_id, 'source_type','TRUCK','source_id', r.id, 'dest_type','STAGING','dest_id', r.warehouse_id::text,
        'lots', jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty_out', v_net, 'qty_in', v_net)),
        'reference_type','RECEPTION','reference_id', r.id, 'truck', r.truck, 'supplier_name', r.supplier_name, 'origin', r.origin,
        'reason','Déchargement — Lot en quarantaine (qualité finale en attente)'));

  perform public.wms_audit(r.id,'offload',to_jsonb('ACCEPTED_WAITING_OFFLOAD'::text),
    jsonb_build_object('status',r.status,'gross_kg',v_gross,'tare_kg',v_tare,'net_kg',v_net,'bags',v_bags,'lot',v_lot,'lot_status','QUARANTINE','movement',m->>'id'),
    'Déchargement / pesée — Lot créé en quarantaine');
  return to_jsonb(r) || jsonb_build_object('lot_id', v_lot, 'lot_status', 'QUARANTINE', 'movement', m->>'id');
end $function$;

-- ---------------------------------------------------------------------
-- 8. Qualité finale : HOLD du Lot, pas de levée automatique par une
--    nouvelle saisie (P0-02 « QA finale falsifiée »).
-- ---------------------------------------------------------------------
create or replace function public.wms_save_quality(p_reception_id text, p_type text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c jsonb; r public.wms_receptions; k jsonb; s public.wms_quality_snapshots;
  v_gk numeric; v_imm numeric; v_sp numeric;
  v_samp public.wms_quality_snapshots; v_delta numeric; v_tol numeric; v_ok boolean;
  v_id text; old_status text; v_prev text; v_key text; v_reason text; v_hold_kept boolean := false;
begin
  if p_type not in ('SAMPLING','FINAL') then raise exception 'Type de snapshot invalide (SAMPLING | FINAL)'; end if;
  c := public.wms_require(case when p_type = 'SAMPLING' then 'sampling' else 'final_qa' end);
  v_key := nullif(btrim(coalesce(p->>'idempotency_key','')), '');
  v_reason := nullif(btrim(coalesce(p->>'reason','')), '');
  if v_key is not null then
    select * into s from public.wms_quality_snapshots where idempotency_key = v_key limit 1;
    if s.id is not null then
      select * into r from public.wms_receptions where id = s.reception_id;
      return jsonb_build_object('snapshot', to_jsonb(s), 'reception', to_jsonb(r), 'idempotent', true);
    end if;
  end if;

  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if p_type = 'SAMPLING' and r.status not in ('ARRIVED','AWAITING_DECISION') then
    raise exception 'Sampling impossible au statut %', r.status;
  end if;
  if p_type = 'FINAL' and r.status not in ('AWAITING_FINAL_QA','QUALITY_HOLD') then
    raise exception 'Final Quality impossible au statut % (déchargement requis)', r.status;
  end if;
  if p_type = 'FINAL' and r.net_kg is null then
    raise exception 'Final Quality impossible : la réception n''a pas été déchargée';
  end if;

  v_gk := nullif(btrim(coalesce(p->>'gk_g','')),'')::numeric;
  v_imm := nullif(btrim(coalesce(p->>'imm_g','')),'')::numeric;
  v_sp := nullif(btrim(coalesce(p->>'spotted_g','')),'')::numeric;
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

  select id into v_prev from public.wms_v_quality_current where reception_id = r.id and type = p_type;
  if v_prev is not null and v_reason is null then
    raise exception 'Nouvelle version d''un % : motif obligatoire (l''ancienne mesure est conservée)', p_type;
  end if;

  perform pg_advisory_xact_lock(hashtext('wms_qlt_seq'));
  v_id := 'QLT-' || lpad(public.wms_next_seq('QLT')::text, 6, '0');

  insert into public.wms_quality_snapshots(
    id, reception_id, lot_id, type, gk_g, imm_g, spotted_g, moisture_pct, nut_count,
    browns_g, voids_g, oil_g, weighted_kernel, kor_exact, kor_display, kor_factor,
    formula_version, delta_vs_sampling, within_tolerance, analyst, note, created_by, idempotency_key
  )
  values (
    v_id, r.id, r.lot_id, p_type, v_gk, v_imm, v_sp,
    nullif(btrim(coalesce(p->>'moisture_pct','')),'')::numeric,
    nullif(btrim(coalesce(p->>'nut_count','')),'')::int,
    nullif(p->>'browns_g','')::numeric, nullif(p->>'voids_g','')::numeric, nullif(p->>'oil_g','')::numeric,
    (k->>'weightedKernel')::numeric, (k->>'korExact')::numeric, (k->>'korDisplay')::numeric,
    (k->>'factor')::numeric, k->>'formulaVersion', v_delta, v_ok, c->>'nom', coalesce(p->>'note', v_reason),
    (c->>'uid')::uuid, v_key
  ) returning * into s;

  if v_prev is not null then
    update public.wms_quality_snapshots set superseded_by = v_id where id = v_prev;
    perform public.wms_audit(r.id, p_type||'.version', to_jsonb(v_prev), to_jsonb(v_id), v_reason);
  end if;

  old_status := r.status;
  if p_type = 'SAMPLING' then
    update public.wms_receptions
       set status = 'AWAITING_DECISION', updated_by = (c->>'uid')::uuid, updated_at = now()
     where id = r.id and status = 'ARRIVED';
  else
    if r.lot_id is not null then
      update public.wms_lots set kor_final = s.kor_exact, moisture_final = s.moisture_pct, nut_count_final = s.nut_count
       where id = r.lot_id;
    end if;
    if not v_ok then
      update public.wms_receptions
         set status = 'QUALITY_HOLD',
             hold_reason = format('Écart KOR %s ≥ tolérance %s', round(v_delta,2), v_tol),
             updated_by = (c->>'uid')::uuid, updated_at = now()
       where id = r.id;
      if r.lot_id is not null then
        update public.wms_lots set status = 'HOLD', hold_reason = format('Écart KOR %s ≥ tolérance %s', round(v_delta,2), v_tol),
               status_changed_at = now(), status_changed_by = c->>'nom'
         where id = r.lot_id and status in ('QUARANTINE','HOLD','REQUIRES_DECISION');
      end if;
    elsif r.status = 'QUALITY_HOLD' then
      -- Une nouvelle mesure conforme ne lève JAMAIS le HOLD à elle seule :
      -- la levée passe par wms_set_hold (autre personne) ou une dérogation tracée.
      v_hold_kept := true;
    end if;
  end if;

  select * into r from public.wms_receptions where id = r.id;
  perform public.wms_audit(
    r.id, p_type, jsonb_build_object('status', old_status),
    jsonb_build_object('snapshot', v_id, 'kor', s.kor_display, 'factor', s.kor_factor,
      'status', r.status, 'delta', v_delta, 'idempotency_key', v_key, 'hold_maintained', v_hold_kept),
    coalesce(v_reason, 'Saisie '||p_type)
  );
  return jsonb_build_object('snapshot', to_jsonb(s), 'reception', to_jsonb(r), 'idempotent', false, 'hold_maintained', v_hold_kept);
end
$function$;

-- ---------------------------------------------------------------------
-- 9. HOLD manuel / levée du HOLD (séparation des tâches)
-- ---------------------------------------------------------------------
create or replace function public.wms_set_hold(p_reception_id text, p_hold boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; r public.wms_receptions; old text; f public.wms_quality_snapshots;
begin
  c := public.wms_require('quality_hold');
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motif obligatoire'; end if;
  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  old := r.status;
  if p_hold then
    if r.status not in ('AWAITING_FINAL_QA','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD') then raise exception 'Blocage impossible au statut %', r.status; end if;
    update public.wms_receptions set status = 'QUALITY_HOLD', hold_reason = p_reason, updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id returning * into r;
    if r.lot_id is not null then
      update public.wms_lots set status = 'HOLD', hold_reason = p_reason, status_changed_at = now(), status_changed_by = c->>'nom'
       where id = r.lot_id and status in ('QUARANTINE','HOLD','REQUIRES_DECISION');
    end if;
  else
    if r.status <> 'QUALITY_HOLD' then raise exception 'La réception n''est pas bloquée'; end if;
    if r.net_kg is not null then
      select * into f from public.wms_v_quality_current where reception_id = r.id and type = 'FINAL';
      if f.id is not null and coalesce(f.within_tolerance,false) = false then
        raise exception 'Final Quality courant hors tolérance : levée du HOLD impossible. Refaire une mesure (avec motif) ou décider une dérogation / un rejet.' using errcode = '42501';
      end if;
      if f.id is not null and f.created_by = (c->>'uid')::uuid then
        raise exception 'Séparation des tâches : l''auteur du Final Quality ne peut pas lever lui-même le HOLD.' using errcode = '42501';
      end if;
    end if;
    update public.wms_receptions set status = case when r.net_kg is not null then 'AWAITING_FINAL_QA' when r.decision = 'ACCEPTED' then 'ACCEPTED_WAITING_OFFLOAD' else 'AWAITING_DECISION' end,
      hold_reason = null, updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id returning * into r;
    if r.lot_id is not null then
      update public.wms_lots set status = 'QUARANTINE', hold_reason = null, status_changed_at = now(), status_changed_by = c->>'nom'
       where id = r.lot_id and status in ('HOLD','REQUIRES_DECISION');
    end if;
  end if;
  perform public.wms_audit(r.id, 'hold', to_jsonb(old), to_jsonb(r.status), p_reason, c->>'nom');
  return to_jsonb(r);
end $function$;

-- ---------------------------------------------------------------------
-- 10. Libération du Lot : le Lot existe déjà (quarantaine) ; chemin
--     historique conservé pour les réceptions déchargées avant correctif.
-- ---------------------------------------------------------------------
create or replace function public.wms_release_lot(p_reception_id text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; r public.wms_receptions; f public.wms_quality_snapshots; s public.wms_quality_snapshots; l public.wms_lots; v_id text; m jsonb;
begin
  c := public.wms_require('lot_release');
  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.lot_id is not null then
    select * into l from public.wms_lots where id = r.lot_id for update;
    if l.status in ('RELEASED','EXHAUSTED','CLOSED') then
      return to_jsonb(l) || jsonb_build_object('idempotent', true);
    end if;
    if l.status <> 'QUARANTINE' or r.status <> 'AWAITING_FINAL_QA' then
      raise exception 'Libération impossible : Lot % au statut %, réception au statut % (Final Quality conforme requis, ou dérogation / rejet si HOLD)', l.id, l.status, r.status using errcode = '42501';
    end if;
    select * into f from public.wms_v_quality_current where reception_id = r.id and type = 'FINAL';
    if f.id is null then raise exception 'Final Quality absent : libération impossible'; end if;
    if coalesce(f.within_tolerance,false) = false then raise exception 'Final Quality hors tolérance : réception à traiter en Quality Hold'; end if;
    update public.wms_lots set status = 'RELEASED', kor_final = f.kor_exact, moisture_final = f.moisture_pct, nut_count_final = f.nut_count,
           hold_reason = null, status_changed_at = now(), status_changed_by = c->>'nom'
     where id = l.id returning * into l;
    update public.wms_receptions set status = 'RELEASED', updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id;
    perform public.wms_audit(r.id, 'lot', to_jsonb('QUARANTINE'::text), jsonb_build_object('lot', l.id, 'status','RELEASED', 'final', f.id), 'Libération du Lot (quarantaine levée par Final Quality conforme)');
    return to_jsonb(l) || jsonb_build_object('idempotent', false);
  end if;
  -- Chemin historique : réception déchargée avant la création du Lot au déchargement.
  if r.status <> 'AWAITING_FINAL_QA' then raise exception 'Libération impossible au statut % (Final Quality conforme requis)', r.status; end if;
  select * into f from public.wms_v_quality_current where reception_id = r.id and type = 'FINAL';
  if f.id is null then raise exception 'Final Quality absent : libération impossible'; end if;
  if coalesce(f.within_tolerance,false) = false then raise exception 'Final Quality hors tolérance : réception à traiter en Quality Hold'; end if;
  select * into s from public.wms_v_quality_current where reception_id = r.id and type = 'SAMPLING';
  perform pg_advisory_xact_lock(hashtext('wms_lot_seq'));
  v_id := 'RCN-' || to_char(now() at time zone 'UTC','YYYYMMDD') || '-' || lpad(public.wms_next_seq('RCN:'||to_char(now() at time zone 'UTC','YYYYMMDD'))::text, 3, '0');
  insert into public.wms_lots(id, reception_id, warehouse_id, truck, supplier_name, supplier_code, origin, initial_kg, initial_bags, kor_sampling, kor_final, moisture_final, nut_count_final, created_by, created_by_name, status_changed_at, status_changed_by)
  values (v_id, r.id, r.warehouse_id, r.truck, r.supplier_name, r.supplier_code, r.origin, r.net_kg, r.bags, s.kor_exact, f.kor_exact, f.moisture_pct, f.nut_count, (c->>'uid')::uuid, c->>'nom', now(), c->>'nom') returning * into l;
  update public.wms_quality_snapshots set lot_id = v_id where reception_id = r.id;
  update public.wms_receptions set lot_id = v_id, status = 'RELEASED', updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id;
  m := public.wms_post_movement(jsonb_build_object('type','OFFLOAD','idempotency_key', coalesce('RELEASE:'||p_idempotency_key, 'RELEASE:'||r.id),
        'warehouse_id', r.warehouse_id, 'source_type','TRUCK','source_id', r.id, 'dest_type','STAGING','dest_id', r.warehouse_id::text,
        'lots', jsonb_build_array(jsonb_build_object('lot_id', v_id, 'qty_out', r.net_kg, 'qty_in', r.net_kg)),
        'reference_type','RECEPTION','reference_id', r.id, 'truck', r.truck, 'supplier_name', r.supplier_name, 'origin', r.origin, 'reason','Libération du Lot — matière déchargée en staging'));
  perform public.wms_audit(r.id, 'lot', to_jsonb('AWAITING_FINAL_QA'::text), jsonb_build_object('lot', v_id, 'initial_kg', r.net_kg, 'status','RELEASED'), 'Création & libération du Lot officiel (chemin historique)');
  return to_jsonb(l) || jsonb_build_object('idempotent', false, 'movement', m->>'id');
end $function$;

-- ---------------------------------------------------------------------
-- 11. Décision sur un Lot bloqué : dérogation, rejet, escalade (P0-02)
-- ---------------------------------------------------------------------
create or replace function public.wms_decide_hold_lot(p_lot_id text, p_decision text, p_reason text,
                                                      p_reason_code text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; l public.wms_lots; r public.wms_receptions; f public.wms_quality_snapshots; d public.wms_quality_derogations;
        rr public.wms_rejection_reasons; v_dec text := upper(btrim(coalesce(p_decision,''))); v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
        v_id text; old_lot text; old_rec text;
begin
  if v_dec = 'DEROGATION_RELEASE' then c := public.wms_require('quality_derogation');
  elsif v_dec = 'REJECT' then c := public.wms_require('lot_reject');
  elsif v_dec = 'ESCALATE' then c := public.wms_require('quality_hold');
  else raise exception 'Décision inconnue : DEROGATION_RELEASE, REJECT ou ESCALATE'; end if;
  if v_reason is null then raise exception 'Motif obligatoire'; end if;
  if p_idempotency_key is not null then
    select * into d from public.wms_quality_derogations where idempotency_key = p_idempotency_key;
    if d.id is not null then return to_jsonb(d) || jsonb_build_object('idempotent', true); end if;
  end if;
  select * into l from public.wms_lots where id = p_lot_id for update;
  if l.id is null then raise exception 'Lot introuvable'; end if;
  select * into r from public.wms_receptions where id = l.reception_id for update;
  old_lot := l.status; old_rec := r.status;

  if v_dec = 'ESCALATE' then
    if l.status not in ('QUARANTINE','HOLD') then raise exception 'Escalade impossible : Lot au statut %', l.status; end if;
    update public.wms_lots set status = 'REQUIRES_DECISION', hold_reason = v_reason, status_changed_at = now(), status_changed_by = c->>'nom'
     where id = l.id returning * into l;
    if r.status = 'AWAITING_FINAL_QA' then
      update public.wms_receptions set status = 'QUALITY_HOLD', hold_reason = v_reason, updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id;
    end if;
    perform public.wms_audit(l.id, 'lot.escalate', to_jsonb(old_lot), to_jsonb(l.status), v_reason, c->>'nom');
    return to_jsonb(l) || jsonb_build_object('idempotent', false);
  end if;

  if l.status not in ('QUARANTINE','HOLD','REQUIRES_DECISION') then
    raise exception 'Décision impossible : Lot % au statut %', l.id, l.status;
  end if;

  if v_dec = 'DEROGATION_RELEASE' then
    if l.status = 'QUARANTINE' then raise exception 'Dérogation réservée aux Lots en HOLD / décision requise (un Lot en quarantaine se libère par Final Quality conforme)'; end if;
    select * into f from public.wms_v_quality_current where reception_id = r.id and type = 'FINAL';
    if f.id is null then raise exception 'Final Quality absent : aucune dérogation sans mesure qualité enregistrée' using errcode = '42501'; end if;
    if f.created_by = (c->>'uid')::uuid then
      raise exception 'Séparation des tâches : l''auteur du Final Quality ne peut pas accorder la dérogation.' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtext('wms_drg_seq'));
    v_id := 'DRG-' || lpad(public.wms_next_seq('DRG')::text, 6, '0');
    insert into public.wms_quality_derogations(id, lot_id, reception_id, kind, reason, final_snapshot_id, final_kor, final_delta, idempotency_key, decided_by, decided_by_name, decided_role)
    values (v_id, l.id, r.id, 'QUALITY_RELEASE', v_reason, f.id, f.kor_exact, f.delta_vs_sampling, p_idempotency_key, (c->>'uid')::uuid, c->>'nom', c->>'role')
    returning * into d;
    update public.wms_lots set status = 'RELEASED', derogation_id = v_id, hold_reason = null, kor_final = f.kor_exact,
           moisture_final = f.moisture_pct, nut_count_final = f.nut_count, status_changed_at = now(), status_changed_by = c->>'nom'
     where id = l.id returning * into l;
    update public.wms_receptions set status = 'RELEASED', hold_reason = null, updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id;
    perform public.wms_audit(l.id, 'lot.derogation', jsonb_build_object('lot', old_lot, 'reception', old_rec),
      jsonb_build_object('lot','RELEASED','derogation', v_id, 'final', f.id, 'delta', f.delta_vs_sampling), v_reason, c->>'nom');
    return to_jsonb(l) || jsonb_build_object('derogation', to_jsonb(d), 'idempotent', false);
  end if;

  -- REJECT : le Lot reste en stock (visible, bloqué) jusqu'à sa sortie physique.
  select * into rr from public.wms_rejection_reasons where code = upper(btrim(coalesce(p_reason_code,''))) and active;
  if rr.code is null then raise exception 'Motif de rejet obligatoire et actif (catalogue)'; end if;
  update public.wms_lots set status = 'REJECTED', hold_reason = v_reason, status_changed_at = now(), status_changed_by = c->>'nom'
   where id = l.id returning * into l;
  update public.wms_receptions set status = 'REJECTED', decision = 'REJECTED', rejection_reason_code = rr.code,
         decision_comment = 'Rejet après déchargement : '||v_reason, decided_by = (c->>'uid')::uuid, decided_by_name = c->>'nom',
         decided_at = now(), updated_by = (c->>'uid')::uuid, updated_at = now()
   where id = r.id;
  perform public.wms_audit(l.id, 'lot.reject', jsonb_build_object('lot', old_lot, 'reception', old_rec),
    jsonb_build_object('lot','REJECTED','reason_code', rr.code), v_reason, c->>'nom');
  return to_jsonb(l) || jsonb_build_object('rejection_reason_code', rr.code, 'idempotent', false);
end $function$;
revoke all on function public.wms_decide_hold_lot(text,text,text,text,text) from public, anon;
grant execute on function public.wms_decide_hold_lot(text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- 12. Mise en BIN HOLD et sortie d'un Lot rejeté
-- ---------------------------------------------------------------------
create or replace function public.wms_place_lot_in_hold_bin(p_lot_id text, p_bin_id text, p_qty numeric, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; l public.wms_lots; b public.wms_bins; v_q numeric;
begin
  c := public.wms_require('hold_bin_place');
  select * into l from public.wms_lots where id = p_lot_id;
  if l.id is null then raise exception 'Lot introuvable'; end if;
  if l.status not in ('QUARANTINE','HOLD','REQUIRES_DECISION','REJECTED') then
    raise exception 'Lot % au statut % : utiliser l''affectation BIN normale', l.id, l.status;
  end if;
  select * into b from public.wms_bins where id = p_bin_id;
  if b.id is null then raise exception 'BIN introuvable'; end if;
  if b.stock_type <> 'HOLD' then raise exception 'Le BIN % n''est pas un BIN HOLD (type %)', b.id, b.stock_type; end if;
  if b.warehouse_id <> l.warehouse_id then raise exception 'Le BIN % n''appartient pas au Warehouse du Lot', b.id using errcode = '42501'; end if;
  select coalesce(sum(qty),0) into v_q from public.wms_v_balances where location_type='STAGING' and location_id = l.warehouse_id::text and lot_id = l.id;
  v_q := coalesce(p_qty, v_q);
  if v_q is null or v_q <= 0 then raise exception 'Quantité à placer invalide (aucun stock en staging ?)'; end if;
  return public.wms_post_movement(jsonb_build_object('type','BIN_TRANSFER','idempotency_key', p_idempotency_key, 'warehouse_id', l.warehouse_id,
    'source_type','STAGING','source_id', l.warehouse_id::text, 'dest_type','BIN','dest_id', b.id,
    'lots', jsonb_build_array(jsonb_build_object('lot_id', l.id, 'qty_out', v_q, 'qty_in', v_q)),
    'reference_type','LOT','reference_id', l.id, 'truck', l.truck, 'supplier_name', l.supplier_name, 'origin', l.origin,
    'reason', 'Mise à l''écart en BIN HOLD (Lot '||l.status||')'));
end $function$;
revoke all on function public.wms_place_lot_in_hold_bin(text,text,numeric,text) from public, anon;
grant execute on function public.wms_place_lot_in_hold_bin(text,text,numeric,text) to authenticated;

create or replace function public.wms_return_rejected_lot(p_lot_id text, p_qty numeric, p_reference text, p_source_bin text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; l public.wms_lots; v_st text; v_si text; v_avail numeric;
begin
  c := public.wms_require('lot_return');
  if coalesce(btrim(p_reference),'') = '' then raise exception 'Référence du bon de sortie / reprise obligatoire'; end if;
  if coalesce(btrim(p_idempotency_key),'') = '' then raise exception 'Clé d''idempotence obligatoire'; end if;
  select * into l from public.wms_lots where id = p_lot_id;
  if l.id is null then raise exception 'Lot introuvable'; end if;
  if l.status <> 'REJECTED' then raise exception 'Seul un Lot REJECTED peut sortir en retour fournisseur (statut %)', l.status; end if;
  if p_source_bin is null then v_st := 'STAGING'; v_si := l.warehouse_id::text; else v_st := 'BIN'; v_si := p_source_bin; end if;
  select coalesce(sum(qty),0) into v_avail from public.wms_v_balances where location_type = v_st and location_id = v_si and lot_id = l.id;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantité invalide'; end if;
  return public.wms_post_movement(jsonb_build_object('type','RETURN_TO_SUPPLIER','idempotency_key', p_idempotency_key, 'warehouse_id', l.warehouse_id,
    'source_type', v_st, 'source_id', v_si, 'dest_type','SUPPLIER','dest_id', coalesce(l.supplier_code, l.reception_id),
    'lots', jsonb_build_array(jsonb_build_object('lot_id', l.id, 'qty_out', p_qty, 'qty_in', p_qty)),
    'reference_type','RETURN','reference_id', p_reference, 'truck', l.truck, 'supplier_name', l.supplier_name, 'origin', l.origin,
    'reason', 'Retour fournisseur d''un Lot rejeté'));
end $function$;
revoke all on function public.wms_return_rejected_lot(text,numeric,text,text,text) from public, anon;
grant execute on function public.wms_return_rejected_lot(text,numeric,text,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- 13. Transferts : un Lot non libéré ne peut pas être réservé
-- ---------------------------------------------------------------------
create or replace function private.wms_trf_line_lot_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  select status into v_status from public.wms_lots where id = new.lot_id;
  if v_status is null then raise exception 'Lot % introuvable', new.lot_id; end if;
  if v_status not in ('RELEASED','EXHAUSTED') then
    raise exception 'Lot % au statut % : transfert inter-entrepôts interdit tant qu''il n''est pas libéré', new.lot_id, v_status using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.wms_trf_line_lot_guard() from public, anon, authenticated;
drop trigger if exists trg_wms_trf_line_lot_guard on public.wms_transfer_lines;
create trigger trg_wms_trf_line_lot_guard before insert on public.wms_transfer_lines
  for each row execute function private.wms_trf_line_lot_guard();

-- ---------------------------------------------------------------------
-- 14. Clôture journalière : stock quarantaine / HOLD / rejeté visible,
--     sorties production et retours fournisseur dans la balance.
-- ---------------------------------------------------------------------
create or replace function public.wms_daily_closing(p_warehouse_id uuid, p_date date default current_date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  c jsonb; v_start timestamptz; v_end timestamptz;
  v_open numeric:=0; v_close numeric:=0; v_transit numeric:=0;
  v_receipts numeric:=0; v_tin numeric:=0; v_tout numeric:=0; v_loss numeric:=0; v_adj numeric:=0;
  v_prod numeric:=0; v_ret numeric:=0;
  v_expected numeric:=0; v_variance numeric:=0;
  v_wet numeric:=0; v_dry numeric:=0; v_hold numeric:=0; v_staging numeric:=0; v_drying numeric:=0;
  v_q numeric:=0; v_h numeric:=0; v_rq numeric:=0; v_rj numeric:=0; v_rel numeric:=0;
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
  into v_open,v_close,v_transit,v_staging,v_drying from e;

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
  into v_wet,v_dry,v_hold from e join public.wms_bins b on b.id=e.loc_id;

  -- Stock physique en fin de journée ventilé par statut du Lot.
  with e as (
    select ml.lot_id, -ml.qty_out delta
      from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id
      where m.status='POSTED' and m.warehouse_id=p_warehouse_id and m.source_type in ('STAGING','BIN','DRYING') and m.posted_at<v_end
    union all
    select ml.lot_id, ml.qty_in
      from public.wms_movements m join public.wms_movement_lots ml on ml.movement_id=m.id
      where m.status='POSTED' and m.warehouse_id=p_warehouse_id and m.dest_type in ('STAGING','BIN','DRYING') and m.posted_at<v_end
  )
  select
    coalesce(sum(e.delta) filter(where l.status='QUARANTINE'),0),
    coalesce(sum(e.delta) filter(where l.status='HOLD'),0),
    coalesce(sum(e.delta) filter(where l.status='REQUIRES_DECISION'),0),
    coalesce(sum(e.delta) filter(where l.status='REJECTED'),0),
    coalesce(sum(e.delta) filter(where l.status in ('RELEASED','EXHAUSTED','CLOSED')),0)
  into v_q, v_h, v_rq, v_rj, v_rel
  from e join public.wms_lots l on l.id = e.lot_id;

  select
    coalesce(sum(ml.qty_in) filter(where m.type='OFFLOAD'),0),
    coalesce(sum(ml.qty_in) filter(where m.type='TRANSFER_IN'),0),
    coalesce(sum(ml.qty_out) filter(where m.type='TRANSFER_OUT'),0),
    coalesce(sum(ml.qty_in-ml.qty_out) filter(where m.type='ADJUSTMENT'),0),
    coalesce(sum(ml.qty_out) filter(where m.type='PRODUCTION_ISSUE'),0),
    coalesce(sum(ml.qty_out) filter(where m.type='RETURN_TO_SUPPLIER'),0)
  into v_receipts,v_tin,v_tout,v_adj,v_prod,v_ret
  from public.wms_movements m
  join public.wms_movement_lots ml on ml.movement_id=m.id
  where m.status='POSTED' and m.warehouse_id=p_warehouse_id and m.posted_at>=v_start and m.posted_at<v_end;

  select coalesce(sum(d.process_loss_kg),0)
  into v_loss
  from public.wms_dryings d
  join public.wms_bins b on b.id=d.source_bin_id
  where b.warehouse_id=p_warehouse_id
    and d.created_at>=v_start and d.created_at<v_end
    and d.status<>'CANCELLED';

  v_expected:=round(v_open+v_receipts+v_tin-v_tout-v_loss+v_adj-v_prod-v_ret,3);
  v_variance:=round(v_close-v_expected,3);

  return jsonb_build_object(
    'date',p_date,'warehouse_id',p_warehouse_id,
    'opening_stock_kg',round(v_open,3),'receipts_kg',round(v_receipts,3),
    'transfers_in_kg',round(v_tin,3),'transfers_out_kg',round(v_tout,3),
    'process_loss_kg',round(v_loss,3),'inventory_adjustments_kg',round(v_adj,3),
    'production_issues_kg',round(v_prod,3),'supplier_returns_kg',round(v_ret,3),
    'expected_closing_kg',v_expected,'closing_stock_kg',round(v_close,3),
    'variance_kg',v_variance,'mass_balance_status',case when abs(v_variance)<=0.001 then 'BALANCED' else 'VARIANCE' end,
    'stock_wet_kg',round(v_wet,3),'stock_dry_kg',round(v_dry,3),'stock_hold_kg',round(v_hold,3),
    'stock_staging_kg',round(v_staging,3),'stock_drying_kg',round(v_drying,3),'stock_transit_kg',round(v_transit,3),
    'stock_lot_quarantine_kg',round(v_q,3),'stock_lot_hold_kg',round(v_h,3),'stock_lot_requires_decision_kg',round(v_rq,3),
    'stock_lot_rejected_kg',round(v_rj,3),'stock_lot_released_kg',round(v_rel,3),
    'stock_blocked_kg',round(v_q+v_h+v_rq+v_rj,3)
  );
end $function$;

-- ---------------------------------------------------------------------
-- 15. Achat RCN : soumission / approbation bloquées sans Lot libéré
--     (libération qualité conforme ou dérogation tracée) — P0-02, P1-11
-- ---------------------------------------------------------------------
do $$
declare d text; anchor text := ' if r.status=''REJECTED'' then raise exception ''Camion REJECTED''; end if;';
        chk text := ' if r.status=''REJECTED'' then raise exception ''Camion REJECTED''; end if;
 if r.lot_id is null or not exists(select 1 from public.wms_lots l where l.id=r.lot_id and l.status in (''RELEASED'',''EXHAUSTED'',''CLOSED'')) then
   raise exception ''LOT Warehouse non libéré (quarantaine, HOLD ou rejet) : achat bloqué tant que la qualité n''''est pas conforme ou qu''''une dérogation n''''est pas tracée'' using errcode=''42501'';
 end if;';
        fn text;
begin
  foreach fn in array array['public.procurement_submit_purchase(uuid,numeric,text)','public.procurement_approve_purchase(uuid,numeric,text)'] loop
    select pg_get_functiondef(fn::regprocedure) into d;
    if position('LOT Warehouse non libéré' in d) > 0 then continue; end if;
    if position(anchor in d) = 0 then raise exception 'Ancre introuvable dans %', fn; end if;
    d := replace(d, anchor, chk);
    execute d;
  end loop;
end $$;
