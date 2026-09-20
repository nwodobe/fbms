create or replace view public.wms_v_bin_lot_available as
select b.id as bin_id, b.warehouse_id, w.code as warehouse_code, w.name as warehouse_name, w.site_code,
       b.stock_type, b.status as bin_status,
       v.lot_id, l.supplier_name, l.origin, l.status as lot_status, l.kor_final, l.moisture_final,
       v.qty as physical_kg,
       coalesce(r.reserved_kg, 0) as reserved_kg,
       greatest(v.qty - coalesce(r.reserved_kg, 0), 0) as available_kg
from public.wms_v_balances v
join public.wms_bins b on b.id = v.location_id and v.location_type = 'BIN'
join public.wms_warehouses w on w.id = b.warehouse_id
join public.wms_lots l on l.id = v.lot_id
left join lateral (
  select sum(tl.reserved_qty) as reserved_kg
  from public.wms_transfer_lines tl join public.wms_transfers t on t.id = tl.transfer_id
  where tl.source_bin_id = b.id and tl.lot_id = v.lot_id and tl.reserved_qty > 0
    and t.status in ('APPROVED','READY_TO_LOAD','LOADED')
) r on true
where v.qty > 0.0005;
create or replace view public.wms_v_transfers as
select t.*,
       ow.code as origin_code, ow.name as origin_name, ow.site_code as origin_site,
       dw.code as dest_code,   dw.name as dest_name,   dw.site_code as dest_site, dw.is_factory as dest_is_factory,
       coalesce((select sum(v.qty) from public.wms_v_balances v where v.location_type = 'TRANSIT' and v.location_id = t.id), 0) as in_transit_kg,
       (select count(*) from public.wms_transfer_lines l where l.transfer_id = t.id) as line_count,
       (select count(distinct l.source_bin_id) from public.wms_transfer_lines l where l.transfer_id = t.id) as bin_count,
       (select count(distinct l.lot_id) from public.wms_transfer_lines l where l.transfer_id = t.id) as lot_count,
       case when t.departed_at is not null and t.received_at is null
            then round(extract(epoch from (coalesce(t.arrived_at, now()) - t.departed_at)) / 3600.0, 1) end as transit_age_hours,
       case when t.status = 'IN_TRANSIT'
             and (public.wms_param('transferSettings')->>'transitOverdueHours') is not null
             and extract(epoch from (now() - t.departed_at)) / 3600.0 > (public.wms_param('transferSettings')->>'transitOverdueHours')::numeric
            then true else false end as overdue
from public.wms_transfers t
join public.wms_warehouses ow on ow.id = t.origin_warehouse_id
join public.wms_warehouses dw on dw.id = t.dest_warehouse_id;
create or replace view public.wms_v_transfer_lines as
select l.*, b.stock_type, l2.supplier_name, l2.origin as lot_origin, l2.reception_id, l2.kor_final, l2.moisture_final, l2.truck as lot_truck
from public.wms_transfer_lines l
join public.wms_bins b on b.id = l.source_bin_id
join public.wms_lots l2 on l2.id = l.lot_id;
create or replace view public.wms_v_transfer_audit as
select a.id, a.created_at, coalesce(m.reference_id, split_part(a.objet, '#', 1)) as transfer_id,
       a.objet, a.champ as action, a.avant, a.apres, a.motif, a.auteur, a.role, a.approbateur
from public.rcn_audit a
left join public.wms_movements m on m.id = a.objet and m.reference_type = 'TRANSFER'
where a.objet like 'TRF-%' or a.objet like 'TEST_TRF_%' or m.id is not null;
alter view public.wms_v_bin_lot_available set (security_invoker = on);
alter view public.wms_v_transfers         set (security_invoker = on);
alter view public.wms_v_transfer_lines    set (security_invoker = on);
alter view public.wms_v_transfer_audit    set (security_invoker = on);
revoke all on public.wms_v_bin_lot_available, public.wms_v_transfers, public.wms_v_transfer_lines, public.wms_v_transfer_audit from anon;
grant select on public.wms_v_bin_lot_available, public.wms_v_transfers, public.wms_v_transfer_lines, public.wms_v_transfer_audit to authenticated;
create or replace function public.wms_trf_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(public.wms_param('transferSettings'), '{}'::jsonb);
$$;
create or replace function public.wms_trf_require(p_action text, p_warehouse_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; mx jsonb; v_code text; v_wh text;
begin
  c := public.wms_ctx();
  mx := coalesce(public.wms_param('transferRoleMatrix'), '{}'::jsonb);
  if not coalesce((mx -> p_action) ? (c->>'role'), false) then
    raise exception 'Action « % » non autorisée pour le rôle « % »', p_action, c->>'role' using errcode = '42501';
  end if;
  if p_warehouse_id is not null and coalesce((mx -> 'warehouse_scoped_roles') ? (c->>'role'), false) then
    select nullif(btrim(warehouse_code), '') into v_wh from public.profils where user_id = (c->>'uid')::uuid;
    if v_wh is not null then
      select code into v_code from public.wms_warehouses where id = p_warehouse_id;
      if v_code is distinct from v_wh then
        raise exception 'Périmètre : votre profil est rattaché au Warehouse % ; action « % » refusée sur %.', v_wh, p_action, v_code using errcode = '42501';
      end if;
    end if;
  end if;
  return c;
end $$;
create or replace function public.wms_trf_my_permissions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; mx jsonb; k text; res jsonb := '{}'::jsonb; v_wh text;
begin
  begin c := public.wms_ctx(); exception when others then return jsonb_build_object('role', null, 'actions', '{}'::jsonb); end;
  mx := coalesce(public.wms_param('transferRoleMatrix'), '{}'::jsonb);
  for k in select jsonb_object_keys(mx) loop
    if k <> 'warehouse_scoped_roles' then res := res || jsonb_build_object(k, (mx -> k) ? (c->>'role')); end if;
  end loop;
  select nullif(btrim(warehouse_code), '') into v_wh from public.profils where user_id = (c->>'uid')::uuid;
  return jsonb_build_object('uid', c->'uid', 'nom', c->'nom', 'role', c->'role', 'actions', res,
    'warehouse_scope', case when (mx -> 'warehouse_scoped_roles') ? (c->>'role') then v_wh end,
    'settings', public.wms_trf_settings());
end $$;
create or replace function public.wms_trf_audit(p_trf text, p_action text, p_avant jsonb, p_apres jsonb, p_motif text, p_approbateur text default null)
returns text language sql security definer set search_path = public as $$
  select public.wms_audit(p_trf, p_action, p_avant, p_apres, p_motif, p_approbateur);
$$;
create or replace function public.wms_trf_op_check(p_key text, p_trf text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.wms_transfer_ops;
begin
  if p_key is null or btrim(p_key) = '' then raise exception 'Clé d''idempotence (client_operation_id) obligatoire'; end if;
  select * into o from public.wms_transfer_ops where idempotency_key = p_key;
  if o.idempotency_key is null then return null; end if;
  if o.action <> p_action or (p_trf is not null and o.transfer_id <> p_trf) then
    raise exception 'Clé d''idempotence déjà utilisée pour une autre opération (% sur %)', o.action, o.transfer_id using errcode = '23505';
  end if;
  return coalesce(o.result, '{}'::jsonb) || jsonb_build_object('idempotent', true);
end $$;
create or replace function public.wms_trf_snapshot(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'status', t.status, 'planned_qty', t.planned_qty, 'reserved_qty', t.reserved_qty,
    'loaded_qty', t.loaded_qty, 'dispatched_qty', t.dispatched_qty, 'received_qty', t.received_qty,
    'rc_net_kg', t.rc_net_kg, 'variance_kg', t.variance_kg, 'variance_pct', t.variance_pct, 'resolved_kg', t.resolved_kg, 'anomaly', t.anomaly,
    'in_transit_kg', coalesce((select sum(v.qty) from public.wms_v_balances v where v.location_type='TRANSIT' and v.location_id=t.id),0))
  from public.wms_transfers t where t.id = p_id;
$$;
