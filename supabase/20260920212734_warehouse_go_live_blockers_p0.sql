-- Warehouse go-live blockers: weight integrity, supplier master, mandatory inbound, physical-area protection.

alter table public.wms_receptions
  alter column supplier_name set not null,
  alter column supplier_code set not null,
  alter column origin set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='wms_receptions_supplier_fk') then
    alter table public.wms_receptions
      add constraint wms_receptions_supplier_fk foreign key (supplier_code)
      references public.rcn_fournisseurs(code);
  end if;
  if not exists (select 1 from pg_constraint where conname='wms_receptions_weight_consistency') then
    alter table public.wms_receptions
      add constraint wms_receptions_weight_consistency check (
        (gross_kg is null and tare_kg is null and net_kg is null)
        or
        (gross_kg is not null and tare_kg is not null and net_kg is not null
         and gross_kg > tare_kg and tare_kg >= 0
         and abs(net_kg - (gross_kg - tare_kg)) <= 0.001)
      );
  end if;
end $$;

create or replace function public.wms_create_reception(p jsonb, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c jsonb; r public.wms_receptions; v_truck text; v_arr timestamptz; v_win int;
  dup text; v_id text; v_wh public.wms_warehouses; v_sup public.rcn_fournisseurs;
  v_code text; v_origin text;
begin
  c := public.wms_require('reception_create');
  if p_idempotency_key is not null then
    select * into r from public.wms_receptions where idempotency_key=p_idempotency_key limit 1;
    if r.id is not null then return to_jsonb(r); end if;
  end if;

  v_truck := upper(regexp_replace(coalesce(p->>'truck',''),'\s+','','g'));
  if v_truck='' then raise exception 'Truck Number obligatoire'; end if;

  v_code := upper(btrim(coalesce(p->>'supplier_code','')));
  if v_code='' then raise exception 'Supplier obligatoire : choisissez un fournisseur du Supplier Master'; end if;
  select * into v_sup from public.rcn_fournisseurs where code=v_code;
  if v_sup.code is null then raise exception 'Supplier Code % inexistant dans Supplier Master', v_code; end if;
  if upper(coalesce(v_sup.statut,''))<>'ACTIF' then raise exception 'Supplier % inactif', v_code; end if;

  v_origin := btrim(coalesce(p->>'origin',''));
  if v_origin='' then raise exception 'Origin obligatoire'; end if;

  if nullif(p->>'warehouse_id','') is null then raise exception 'Warehouse obligatoire'; end if;
  select * into v_wh from public.wms_warehouses where id=(p->>'warehouse_id')::uuid;
  if v_wh.id is null then raise exception 'Warehouse obligatoire'; end if;
  if v_wh.status<>'ACTIVE' then raise exception 'Warehouse % inactif',v_wh.code; end if;

  if coalesce(btrim(p->>'arrival_at'),'')='' then raise exception 'Arrival Date/Time obligatoire'; end if;
  v_arr := (p->>'arrival_at')::timestamptz;

  v_win := coalesce((public.wms_param('duplicateTruckWindowMin')->>'value')::int,120);
  select id into dup from public.wms_receptions
   where truck=v_truck and status not in ('REJECTED','CLOSED')
     and abs(extract(epoch from (arrival_at-v_arr)))<v_win*60 limit 1;
  if dup is not null and coalesce((p->>'force')::boolean,false)=false then
    raise exception 'Doublon probable : le camion % est déjà enregistré sur ce créneau (%)',v_truck,dup using errcode='23505';
  end if;

  perform pg_advisory_xact_lock(hashtext('wms_reception_seq'));
  v_id := 'REC-'||to_char(v_arr at time zone 'UTC','YYYYMMDD')||'-'||lpad(public.wms_next_seq('REC:'||to_char(v_arr at time zone 'UTC','YYYYMMDD'))::text,3,'0');

  insert into public.wms_receptions(
    id,warehouse_id,truck,supplier_name,supplier_code,origin,purchase_type,reference,idempotency_key,
    expected_kg,expected_bags,arrival_at,driver,transporter,status,created_by,created_by_name,updated_by
  ) values (
    v_id,v_wh.id,v_truck,v_sup.nom,v_sup.code,v_origin,nullif(p->>'purchase_type',''),
    nullif(p->>'reference',''),p_idempotency_key,
    nullif(p->>'expected_kg','')::numeric,nullif(p->>'expected_bags','')::int,v_arr,
    nullif(p->>'driver',''),nullif(p->>'transporter',''),'ARRIVED',
    (c->>'uid')::uuid,c->>'nom',(c->>'uid')::uuid
  ) returning * into r;

  perform public.wms_audit(r.id,'reception',null,
    jsonb_build_object('status',r.status,'truck',r.truck,'warehouse',v_wh.code,'supplier_code',r.supplier_code,'expected_kg',r.expected_kg),
    'Création réception');
  return to_jsonb(r);
end $$;

create or replace function public.wms_record_offload(p_id text,p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c jsonb; r public.wms_receptions; v_gross numeric; v_tare numeric; v_net numeric;
  v_entered numeric; v_bags int;
begin
  c := public.wms_require('offload');
  select * into r from public.wms_receptions where id=p_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status<>'ACCEPTED_WAITING_OFFLOAD' then
    raise exception 'Déchargement interdit : la réception est « % » (autorisation requise)',r.status using errcode='42501';
  end if;

  v_gross := nullif(p->>'gross_kg','')::numeric;
  v_tare := nullif(p->>'tare_kg','')::numeric;
  v_entered := nullif(p->>'net_kg','')::numeric;
  if v_gross is null or v_tare is null then raise exception 'Gross Weight et Tare Weight obligatoires'; end if;
  if v_tare<0 or v_gross<=v_tare then raise exception 'Pesée incohérente : Gross doit être supérieur à Tare et Tare >= 0'; end if;
  v_net := round(v_gross-v_tare,3);
  if v_net<=0 then raise exception 'Poids net calculé invalide'; end if;
  if v_entered is not null and abs(v_entered-v_net)>0.001 then
    raise exception 'Net Weight incohérent : attendu % kg (= Gross % - Tare %), reçu % kg',v_net,v_gross,v_tare,v_entered;
  end if;

  v_bags := nullif(p->>'bags','')::int;
  if v_bags is null then
    v_bags := coalesce(nullif(p->>'bags_good','')::int,0)+coalesce(nullif(p->>'bags_wet','')::int,0)+coalesce(nullif(p->>'bags_torn','')::int,0)+coalesce(nullif(p->>'bags_recond','')::int,0);
    if v_bags=0 then v_bags:=null; end if;
  end if;

  update public.wms_receptions set
    gross_kg=v_gross,tare_kg=v_tare,net_kg=v_net,bags=v_bags,
    bags_good=nullif(p->>'bags_good','')::int,bags_wet=nullif(p->>'bags_wet','')::int,
    bags_torn=nullif(p->>'bags_torn','')::int,bags_recond=nullif(p->>'bags_recond','')::int,
    weighbridge_ticket=nullif(p->>'weighbridge_ticket',''),delivery_note=nullif(p->>'delivery_note',''),
    warehouse_receipt=nullif(p->>'warehouse_receipt',''),offload_start=nullif(p->>'offload_start','')::timestamptz,
    offload_end=nullif(p->>'offload_end','')::timestamptz,offloaded_by=(c->>'uid')::uuid,offloaded_at=now(),
    status='AWAITING_FINAL_QA',updated_by=(c->>'uid')::uuid,updated_at=now()
  where id=p_id returning * into r;

  perform public.wms_audit(r.id,'offload',to_jsonb('ACCEPTED_WAITING_OFFLOAD'::text),
    jsonb_build_object('status',r.status,'gross_kg',v_gross,'tare_kg',v_tare,'net_kg',v_net,'bags',v_bags),
    'Déchargement / pesée');
  return to_jsonb(r);
end $$;

create or replace function public.wms_upsert_area(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c jsonb; r public.wms_physical_areas; old jsonb; v_code text; v_wh uuid; v_status text;
begin
  c:=public.wms_require('master_data');
  v_code:=upper(btrim(coalesce(p->>'code','')));
  v_wh:=(p->>'warehouse_id')::uuid;
  if v_code='' or v_wh is null then raise exception 'Warehouse et code de zone obligatoires'; end if;

  if p?'id' and nullif(p->>'id','') is not null then
    select * into r from public.wms_physical_areas where id=(p->>'id')::uuid for update;
    if r.id is null then raise exception 'Zone introuvable'; end if;
    old:=to_jsonb(r);
    v_status:=coalesce(nullif(p->>'status',''),r.status);
    if v_status='INACTIVE' and exists(
      select 1 from public.wms_bins b where b.physical_area_id=r.id and b.status<>'CLOSED'
    ) then
      raise exception 'Physical Area % ne peut pas être désactivée : un ou plusieurs BIN ne sont pas CLOSED',r.code;
    end if;
    update public.wms_physical_areas set code=v_code,description=p->>'description',
      capacity_kg=nullif(p->>'capacity_kg','')::numeric,status=v_status,
      updated_by=(c->>'uid')::uuid,updated_at=now()
      where id=r.id returning * into r;
    perform public.wms_audit('AREA:'||v_code,'area',old,to_jsonb(r),coalesce(p->>'reason','Modification zone physique'));
  else
    if exists(select 1 from public.wms_physical_areas where warehouse_id=v_wh and code=v_code) then
      raise exception 'Zone « % » déjà définie dans ce Warehouse',v_code using errcode='23505';
    end if;
    insert into public.wms_physical_areas(warehouse_id,code,description,capacity_kg,created_by,updated_by)
    values(v_wh,v_code,p->>'description',nullif(p->>'capacity_kg','')::numeric,(c->>'uid')::uuid,(c->>'uid')::uuid)
    returning * into r;
    perform public.wms_audit('AREA:'||v_code,'area',null,to_jsonb(r),'Création zone physique');
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.wms_guard_area_status()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status is distinct from new.status and new.status='INACTIVE' and exists(
    select 1 from public.wms_bins b where b.physical_area_id=new.id and b.status<>'CLOSED'
  ) then
    raise exception 'Physical Area % ne peut pas être désactivée tant que tous ses BIN ne sont pas CLOSED',new.code;
  end if;
  return new;
end $$;

drop trigger if exists trg_wms_guard_area_status on public.wms_physical_areas;
create trigger trg_wms_guard_area_status before update of status on public.wms_physical_areas
for each row execute function public.wms_guard_area_status();

revoke all on function public.wms_guard_area_status() from public,anon,authenticated;
