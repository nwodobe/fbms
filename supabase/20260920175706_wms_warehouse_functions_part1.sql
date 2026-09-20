-- WMS fonctions RPC — partie 1 (A-C). Source : supabase/20260920_wms_warehouse_functions.sql
create or replace function public.wms_ctx() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
  select user_id, nom, role, actif, email into p from public.profils where user_id = auth.uid() limit 1;
  if p.user_id is null or coalesce(p.actif,false) = false then
    raise exception 'Accès refusé : profil inactif ou inconnu' using errcode = '42501';
  end if;
  return jsonb_build_object('uid', p.user_id, 'nom', coalesce(p.nom, p.email, p.role), 'role', p.role);
end $$;

insert into public.wms_parameters(key, value, reason)
select 'roleMatrix', $j${
 "master_data":      ["Warehouse Manager","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "parameter_set":    ["Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "reception_create": ["Storekeeper","Warehouse Manager","Supervisor","Head of Field","Procurement Officer","LBA Purchase Officer","Factory User","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "correction":       ["Warehouse Manager","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "sampling":         ["QA / Lab","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "final_qa":         ["QA / Lab","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "quality_hold":     ["QA / Lab","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "decision":         ["Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "offload":          ["Storekeeper","Warehouse Manager","Supervisor","Head of Field","Factory User","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "lot_release":      ["QA / Lab","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "bin_ops":          ["Storekeeper","Warehouse Manager","Supervisor","Head of Field","Factory User","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "bin_close":        ["Warehouse Manager","Supervisor","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "bin_reopen":       ["Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "drying":           ["Storekeeper","Warehouse Manager","Supervisor","Factory User","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "bag_move":         ["Storekeeper","Warehouse Manager","Supervisor","Head of Field","Procurement Officer","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "inventory_count":  ["Storekeeper","Warehouse Manager","Supervisor","Factory User","Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"],
 "inventory_approve":["Branch Manager","Assistant Branch Manager","General Manager","Zonal Head"]
}$j$::jsonb, 'Matrice initiale MVP — administrable via wms_set_parameter'
where not exists (select 1 from public.wms_parameters where key = 'roleMatrix');

create or replace function public.wms_can(p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_allowed jsonb;
begin
  select role into v_role from public.profils where user_id = auth.uid() and coalesce(actif,false) limit 1;
  if v_role is null then return false; end if;
  v_allowed := public.wms_param('roleMatrix') -> p_action;
  if v_allowed is null then return false; end if;
  return v_allowed ? v_role;
end $$;

create or replace function public.wms_require(p_action text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb;
begin
  c := public.wms_ctx();
  if not public.wms_can(p_action) then
    raise exception 'Action « % » non autorisée pour le rôle « % »', p_action, c->>'role' using errcode = '42501';
  end if;
  return c;
end $$;

create or replace function public.wms_my_permissions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; m jsonb; k text; res jsonb := '{}'::jsonb;
begin
  begin c := public.wms_ctx(); exception when others then return jsonb_build_object('role', null, 'actions', '{}'::jsonb); end;
  m := public.wms_param('roleMatrix');
  for k in select jsonb_object_keys(m) loop
    res := res || jsonb_build_object(k, (m -> k) ? (c->>'role'));
  end loop;
  return jsonb_build_object('uid', c->'uid', 'nom', c->'nom', 'role', c->'role', 'actions', res);
end $$;

create or replace function public.wms_audit(p_objet text, p_champ text, p_avant jsonb, p_apres jsonb, p_motif text, p_approbateur text default null)
returns text language plpgsql security definer set search_path = public as $$
declare c jsonb; v_id text;
begin
  begin c := public.wms_ctx(); exception when others then c := jsonb_build_object('nom','système','role','system'); end;
  v_id := 'AUD-WMS-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS') || '-' || substr(md5(random()::text),1,6);
  insert into public.rcn_audit(id, objet, champ, avant, apres, motif, approbateur, auteur, role)
  values (v_id, p_objet, p_champ, p_avant, p_apres, p_motif, p_approbateur, c->>'nom', c->>'role');
  return v_id;
end $$;

create or replace function public.wms_set_parameter(p_key text, p_value jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; v_old jsonb; v_ver int; r public.wms_parameters;
begin
  c := public.wms_require('parameter_set');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Motif obligatoire pour modifier un paramètre'; end if;
  select value, version into v_old, v_ver from public.wms_parameters where key = p_key and active order by effective_from desc, version desc limit 1;
  insert into public.wms_parameters(key, value, version, approved_by, reason, created_by)
  values (p_key, p_value, coalesce(v_ver,0)+1, c->>'nom', p_reason, (c->>'uid')::uuid) returning * into r;
  perform public.wms_audit('PARAM:'||p_key, 'value', v_old, p_value, p_reason, c->>'nom');
  return to_jsonb(r);
end $$;

create or replace function public.wms_upsert_warehouse(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_warehouses; old jsonb; v_code text;
begin
  c := public.wms_require('master_data');
  v_code := upper(btrim(coalesce(p->>'code','')));
  if v_code = '' or coalesce(btrim(p->>'name'),'') = '' or coalesce(btrim(p->>'site_code'),'') = '' then
    raise exception 'Site, code et nom du Warehouse sont obligatoires';
  end if;
  if p ? 'id' and p->>'id' is not null then
    select * into r from public.wms_warehouses where id = (p->>'id')::uuid for update;
    if r.id is null then raise exception 'Warehouse introuvable'; end if;
    if exists (select 1 from public.wms_warehouses where code = v_code and id <> r.id) then
      raise exception 'Code Warehouse « % » déjà utilisé', v_code using errcode = '23505';
    end if;
    old := to_jsonb(r);
    update public.wms_warehouses set site_code = upper(btrim(p->>'site_code')), code = v_code, name = btrim(p->>'name'),
      location = p->>'location', capacity_kg = nullif(p->>'capacity_kg','')::numeric,
      is_factory = coalesce((p->>'is_factory')::boolean, r.is_factory),
      updated_by = (c->>'uid')::uuid, updated_at = now()
    where id = r.id returning * into r;
    perform public.wms_audit('WH:'||r.code, 'warehouse', old, to_jsonb(r), coalesce(p->>'reason','Modification Warehouse'));
  else
    if exists (select 1 from public.wms_warehouses where code = v_code) then
      raise exception 'Code Warehouse « % » déjà utilisé', v_code using errcode = '23505';
    end if;
    insert into public.wms_warehouses(site_code, code, name, location, capacity_kg, is_factory, created_by, updated_by)
    values (upper(btrim(p->>'site_code')), v_code, btrim(p->>'name'), p->>'location', nullif(p->>'capacity_kg','')::numeric,
            coalesce((p->>'is_factory')::boolean,false), (c->>'uid')::uuid, (c->>'uid')::uuid) returning * into r;
    perform public.wms_audit('WH:'||r.code, 'warehouse', null, to_jsonb(r), 'Création Warehouse');
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.wms_set_warehouse_status(p_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_warehouses; old text;
begin
  c := public.wms_require('master_data');
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'Statut invalide'; end if;
  select * into r from public.wms_warehouses where id = p_id for update;
  if r.id is null then raise exception 'Warehouse introuvable'; end if;
  old := r.status;
  if p_status = 'INACTIVE' and exists (select 1 from public.wms_bins b where b.warehouse_id = p_id and b.status <> 'CLOSED') then
    raise exception 'Désactivation impossible : des BIN sont encore ouverts dans ce Warehouse';
  end if;
  update public.wms_warehouses set status = p_status, updated_by = (c->>'uid')::uuid, updated_at = now() where id = p_id returning * into r;
  perform public.wms_audit('WH:'||r.code, 'status', to_jsonb(old), to_jsonb(p_status), coalesce(p_reason,'Changement de statut'));
  return to_jsonb(r);
end $$;

create or replace function public.wms_delete_warehouse(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_warehouses;
begin
  c := public.wms_require('master_data');
  select * into r from public.wms_warehouses where id = p_id for update;
  if r.id is null then raise exception 'Warehouse introuvable'; end if;
  if exists (select 1 from public.wms_receptions where warehouse_id = p_id)
     or exists (select 1 from public.wms_bins where warehouse_id = p_id)
     or exists (select 1 from public.wms_lots where warehouse_id = p_id)
     or exists (select 1 from public.wms_movements where warehouse_id = p_id) then
    raise exception 'Suppression interdite : ce Warehouse est déjà utilisé dans une opération. Désactivez-le.';
  end if;
  delete from public.wms_physical_areas where warehouse_id = p_id;
  delete from public.wms_warehouses where id = p_id;
  perform public.wms_audit('WH:'||r.code, 'warehouse', to_jsonb(r), null, 'Suppression (jamais utilisé)');
  return true;
end $$;

create or replace function public.wms_upsert_area(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_physical_areas; old jsonb; v_code text; v_wh uuid;
begin
  c := public.wms_require('master_data');
  v_code := upper(btrim(coalesce(p->>'code','')));
  v_wh := (p->>'warehouse_id')::uuid;
  if v_code = '' or v_wh is null then raise exception 'Warehouse et code de zone obligatoires'; end if;
  if p ? 'id' and p->>'id' is not null then
    select * into r from public.wms_physical_areas where id = (p->>'id')::uuid for update;
    if r.id is null then raise exception 'Zone introuvable'; end if;
    old := to_jsonb(r);
    update public.wms_physical_areas set code = v_code, description = p->>'description',
      capacity_kg = nullif(p->>'capacity_kg','')::numeric, status = coalesce(p->>'status', r.status),
      updated_by = (c->>'uid')::uuid, updated_at = now() where id = r.id returning * into r;
    perform public.wms_audit('AREA:'||v_code, 'area', old, to_jsonb(r), coalesce(p->>'reason','Modification zone physique'));
  else
    if exists (select 1 from public.wms_physical_areas where warehouse_id = v_wh and code = v_code) then
      raise exception 'Zone « % » déjà définie dans ce Warehouse', v_code using errcode = '23505';
    end if;
    insert into public.wms_physical_areas(warehouse_id, code, description, capacity_kg, created_by, updated_by)
    values (v_wh, v_code, p->>'description', nullif(p->>'capacity_kg','')::numeric, (c->>'uid')::uuid, (c->>'uid')::uuid) returning * into r;
    perform public.wms_audit('AREA:'||v_code, 'area', null, to_jsonb(r), 'Création zone physique');
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.wms_create_reception(p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_receptions; v_truck text; v_arr timestamptz; v_win int; dup text; v_id text; v_wh public.wms_warehouses;
begin
  c := public.wms_require('reception_create');
  if p_idempotency_key is not null then
    select * into r from public.wms_receptions where idempotency_key = p_idempotency_key limit 1;
    if r.id is not null then return to_jsonb(r); end if;
  end if;
  v_truck := upper(regexp_replace(coalesce(p->>'truck',''), '\s+', '', 'g'));
  if v_truck = '' then raise exception 'Numéro de camion obligatoire'; end if;
  select * into v_wh from public.wms_warehouses where id = (p->>'warehouse_id')::uuid;
  if v_wh.id is null then raise exception 'Warehouse obligatoire'; end if;
  if v_wh.status <> 'ACTIVE' then raise exception 'Warehouse % inactif', v_wh.code; end if;
  v_arr := coalesce(nullif(p->>'arrival_at','')::timestamptz, now());
  v_win := coalesce((public.wms_param('duplicateTruckWindowMin')->>'value')::int, 120);
  select id into dup from public.wms_receptions
   where truck = v_truck and status not in ('REJECTED','CLOSED')
     and abs(extract(epoch from (arrival_at - v_arr))) < v_win*60 limit 1;
  if dup is not null and coalesce((p->>'force')::boolean,false) = false then
    raise exception 'Doublon probable : le camion % est déjà enregistré sur ce créneau (%)', v_truck, dup using errcode = '23505';
  end if;
  perform pg_advisory_xact_lock(hashtext('wms_reception_seq'));
  v_id := 'REC-' || to_char(v_arr at time zone 'UTC','YYYYMMDD') || '-' || lpad(public.wms_next_seq('REC:'||to_char(v_arr at time zone 'UTC','YYYYMMDD'))::text, 3, '0');
  insert into public.wms_receptions(id, warehouse_id, truck, supplier_name, supplier_code, origin, purchase_type, reference, idempotency_key,
    expected_kg, expected_bags, arrival_at, driver, transporter, status, created_by, created_by_name, updated_by)
  values (v_id, v_wh.id, v_truck, p->>'supplier_name', p->>'supplier_code', p->>'origin', p->>'purchase_type',
    nullif(p->>'reference',''), p_idempotency_key,
    nullif(p->>'expected_kg','')::numeric, nullif(p->>'expected_bags','')::int, v_arr, p->>'driver', p->>'transporter',
    'ARRIVED', (c->>'uid')::uuid, c->>'nom', (c->>'uid')::uuid) returning * into r;
  perform public.wms_audit(r.id, 'reception', null, jsonb_build_object('status', r.status, 'truck', r.truck, 'warehouse', v_wh.code, 'expected_kg', r.expected_kg), 'Création réception');
  return to_jsonb(r);
end $$;

create or replace function public.wms_decide_reception(p_id text, p_accept boolean, p_comment text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_receptions; old text;
begin
  c := public.wms_require('decision');
  select * into r from public.wms_receptions where id = p_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status <> 'AWAITING_DECISION' then raise exception 'Décision impossible : statut % (le Sampling doit être saisi)', r.status; end if;
  if not p_accept and coalesce(btrim(p_comment),'') = '' then raise exception 'Motif obligatoire en cas de refus'; end if;
  old := r.status;
  update public.wms_receptions set status = case when p_accept then 'ACCEPTED_WAITING_OFFLOAD' else 'REJECTED' end,
    decision = case when p_accept then 'ACCEPTED' else 'REJECTED' end, decision_comment = p_comment,
    decided_by = (c->>'uid')::uuid, decided_by_name = c->>'nom', decided_at = now(), updated_by = (c->>'uid')::uuid, updated_at = now()
  where id = p_id returning * into r;
  perform public.wms_audit(r.id, 'decision', to_jsonb(old), to_jsonb(r.status), coalesce(p_comment, case when p_accept then 'Camion accepté' else 'Camion refusé' end), c->>'nom');
  return to_jsonb(r);
end $$;

create or replace function public.wms_record_offload(p_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r public.wms_receptions; v_gross numeric; v_tare numeric; v_net numeric; v_bags int;
begin
  c := public.wms_require('offload');
  select * into r from public.wms_receptions where id = p_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status <> 'ACCEPTED_WAITING_OFFLOAD' then
    raise exception 'Déchargement interdit : la réception est « % » (autorisation requise)', r.status using errcode = '42501';
  end if;
  v_gross := nullif(p->>'gross_kg','')::numeric; v_tare := nullif(p->>'tare_kg','')::numeric; v_net := nullif(p->>'net_kg','')::numeric;
  if v_net is null and v_gross is not null and v_tare is not null then v_net := round(v_gross - v_tare, 2); end if;
  if v_net is null or v_net <= 0 then raise exception 'Poids net physique obligatoire et supérieur à zéro'; end if;
  v_bags := nullif(p->>'bags','')::int;
  if v_bags is null then
    v_bags := coalesce(nullif(p->>'bags_good','')::int,0) + coalesce(nullif(p->>'bags_wet','')::int,0) + coalesce(nullif(p->>'bags_torn','')::int,0) + coalesce(nullif(p->>'bags_recond','')::int,0);
    if v_bags = 0 then v_bags := null; end if;
  end if;
  update public.wms_receptions set gross_kg = v_gross, tare_kg = v_tare, net_kg = v_net, bags = v_bags,
    bags_good = nullif(p->>'bags_good','')::int, bags_wet = nullif(p->>'bags_wet','')::int, bags_torn = nullif(p->>'bags_torn','')::int, bags_recond = nullif(p->>'bags_recond','')::int,
    weighbridge_ticket = p->>'weighbridge_ticket', delivery_note = p->>'delivery_note', warehouse_receipt = p->>'warehouse_receipt',
    offload_start = nullif(p->>'offload_start','')::timestamptz, offload_end = nullif(p->>'offload_end','')::timestamptz,
    offloaded_by = (c->>'uid')::uuid, offloaded_at = now(), status = 'AWAITING_FINAL_QA', updated_by = (c->>'uid')::uuid, updated_at = now()
  where id = p_id returning * into r;
  perform public.wms_audit(r.id, 'offload', to_jsonb('ACCEPTED_WAITING_OFFLOAD'::text), jsonb_build_object('status', r.status, 'net_kg', v_net, 'bags', v_bags), 'Déchargement / pesée');
  return to_jsonb(r);
end $$;
