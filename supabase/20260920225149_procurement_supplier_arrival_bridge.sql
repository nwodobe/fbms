
alter table public.wms_receptions drop constraint if exists wms_receptions_source_type_chk;
alter table public.wms_receptions add constraint wms_receptions_source_type_chk
check (procurement_source_type is null or procurement_source_type in ('FIELD_SHIPMENT','LBA_ARRIVAL','SUPPLIER_ARRIVAL','PURCHASE','AD_HOC'));

create or replace function public.procurement_schedule_supplier_arrival(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c jsonb;s public.rcn_fournisseurs;w public.wms_warehouses;v_channel text;v_type text;v_id text;v_payload jsonb;r public.rcn_proc_arrivages;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['Branch Manager','Assistant Branch Manager','Procurement Officer','LBA Purchase Officer','Field Buying Operations Officer','Supervisor','Administrateur'])
 then raise exception 'Droit insuffisant pour planifier un arrivage fournisseur'; end if;
 v_type:=upper(nullif(btrim(p->>'purchase_type'),''));
 select channel_code into v_channel from public.procurement_purchase_types where code=v_type and active;
 if v_channel is null or v_channel='FIELD_BUYING' then raise exception 'Purchase Type fournisseur invalide'; end if;
 select * into s from public.rcn_fournisseurs where code=upper(btrim(p->>'supplier_code')) and upper(coalesce(statut,''))='ACTIF';
 if s.code is null then raise exception 'Supplier invalide ou inactif'; end if;
 select * into w from public.wms_warehouses where id=(p->>'warehouse_id')::uuid and status='ACTIVE';
 if w.id is null then raise exception 'Warehouse invalide ou inactif'; end if;
 if nullif(btrim(p->>'origin'),'') is null then raise exception 'Origin obligatoire'; end if;
 if nullif(p->>'expected_kg','')::numeric is null or (p->>'expected_kg')::numeric<=0 then raise exception 'Expected kg obligatoire'; end if;
 v_id:='ARR-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 v_payload=jsonb_build_object('procurement_channel',v_channel,'purchase_type',v_type,'origin',p->>'origin',
   'warehouse_id',w.id,'warehouse_code',w.code,'truck',nullif(p->>'truck',''),'driver',nullif(p->>'driver',''),
   'transporter',nullif(p->>'transporter',''),'expected_kg',(p->>'expected_kg')::numeric,
   'expected_bags',nullif(p->>'expected_bags','')::int,'reference',nullif(p->>'reference',''));
 insert into public.rcn_proc_arrivages(id,supplier_code,statut,prevu_at,payload,created_by)
 values(v_id,s.code,'PLANIFIÉ',coalesce(nullif(p->>'expected_at','')::timestamptz,now()),v_payload,(c->>'uid')::uuid)
 returning * into r;
 perform public.wms_audit(v_id,'procurement.supplier_arrival',null,v_payload,'Planification arrivage fournisseur');
 return to_jsonb(r);
end $$;
revoke all on function public.procurement_schedule_supplier_arrival(jsonb) from public,anon;
grant execute on function public.procurement_schedule_supplier_arrival(jsonb) to authenticated;

create or replace view public.procurement_v_pending_receptions
with (security_invoker=true) as
with field_bags as (
  select sl.shipment_id,coalesce(sum(c.bag_count),0)::int expected_bags
  from public.field_shipment_lots sl join public.field_lot_contributors c on c.lot_id=sl.lot_id and c.status='ACTIVE'
  group by sl.shipment_id
)
select 'FIELD_SHIPMENT'::text source_type,s.id::text source_id,s.shipment_code source_ref,
 'FIELD_BUYING'::text procurement_channel,'FIELD_BUYING'::text purchase_type,null::text supplier_code,
 'MULTI-PRODUCER / FIELD BUYING'::text supplier_name,null::text lba_code,s.origin_label origin,s.vehicle_plate truck,
 s.driver_name driver,null::text transporter,coalesce(s.dispatched_qty_kg,s.planned_qty_kg) expected_kg,fb.expected_bags,
 w.id warehouse_id,w.code warehouse_code,s.departed_at source_date,s.status source_status
from public.field_shipments s left join field_bags fb on fb.shipment_id=s.id
left join public.wms_warehouses w on w.id::text=s.destination_id or upper(w.code)=upper(coalesce(s.destination_id,''))
where s.status='DISPATCHED' and s.wms_reception_id is null
union all
select
 case when upper(coalesce(a.payload->>'purchase_type','LBA'))='LBA' then 'LBA_ARRIVAL' else 'SUPPLIER_ARRIVAL' end,
 a.id::text,a.id::text,
 coalesce(nullif(a.payload->>'procurement_channel',''),
   case when f.categorie='LBA' or a.supplier_code like 'LBA-%' then 'LBA'
        when upper(coalesce(f.categorie,'')) like '%COOP%' then 'COOPERATIVE' else 'DIRECT' end),
 coalesce(nullif(a.payload->>'purchase_type',''),
   case when f.categorie='LBA' or a.supplier_code like 'LBA-%' then 'LBA'
        when upper(coalesce(f.categorie,'')) like '%COOP%' then 'COOPERATIVE' else 'DIRECT' end),
 a.supplier_code,f.nom,case when f.categorie='LBA' or a.supplier_code like 'LBA-%' then a.supplier_code else null end,
 coalesce(nullif(a.payload->>'origin',''),array_to_string(f.origines,', '),'Supplier') origin,
 coalesce(nullif(a.payload->>'truck',''),nullif(a.payload->>'camion','')) truck,
 nullif(a.payload->>'driver','') driver,nullif(a.payload->>'transporter','') transporter,
 coalesce(nullif(a.payload->>'expected_kg','')::numeric,nullif(a.payload->>'poids_annonce','')::numeric,nullif(a.payload->>'qty_kg','')::numeric) expected_kg,
 coalesce(nullif(a.payload->>'expected_bags','')::int,nullif(a.payload->>'sacs_annonce','')::int) expected_bags,
 w.id,w.code,coalesce(a.prevu_at,a.created_at),a.statut
from public.rcn_proc_arrivages a left join public.rcn_fournisseurs f on f.code=a.supplier_code
left join public.wms_warehouses w on w.id::text=nullif(a.payload->>'warehouse_id','') or upper(w.code)=upper(coalesce(a.payload->>'warehouse_code',a.payload->>'warehouse',''))
where a.reception_id is null and a.supplier_code is not null;

CREATE OR REPLACE FUNCTION public.wms_create_reception(p jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c jsonb; r public.wms_receptions; v_truck text; v_arr timestamptz; v_win int; dup text; v_id text;
  v_wh public.wms_warehouses; v_sup public.rcn_fournisseurs;
  v_code text; v_name text; v_origin text; v_purchase text; v_channel text;
  v_src_type text; v_src_id text; v_field public.field_shipments; v_lba public.rcn_proc_arrivages;
  v_expected numeric; v_bags int; v_driver text; v_transporter text; v_reference text;
  v_ad_hoc boolean; v_ad_hoc_reason text;
begin
  c:=public.wms_require('reception_create');
  if p_idempotency_key is not null then
    select * into r from public.wms_receptions where idempotency_key=p_idempotency_key limit 1;
    if r.id is not null then return to_jsonb(r); end if;
  end if;

  v_purchase:=upper(btrim(coalesce(p->>'purchase_type','')));
  if v_purchase='' then raise exception 'Purchase Type obligatoire'; end if;
  select pt.channel_code into v_channel from public.procurement_purchase_types pt where pt.code=v_purchase and pt.active;
  if v_channel is null then raise exception 'Purchase Type % invalide ou inactif',v_purchase; end if;

  v_src_type:=upper(nullif(btrim(p->>'procurement_source_type'),''));
  v_src_id:=nullif(btrim(p->>'procurement_source_id'),'');
  v_ad_hoc:=coalesce((p->>'ad_hoc')::boolean,false);
  v_ad_hoc_reason:=nullif(btrim(p->>'ad_hoc_reason'),'');
  if v_ad_hoc and v_ad_hoc_reason is null then raise exception 'Reason for Ad-Hoc Reception obligatoire'; end if;

  if v_src_type='FIELD_SHIPMENT' then
    select * into v_field from public.field_shipments
    where id::text=v_src_id or shipment_code=v_src_id
    for update;
    if v_field.id is null then raise exception 'Field Shipment introuvable'; end if;
    if v_field.status<>'DISPATCHED' then raise exception 'Field Shipment % non expédié (statut %)',v_field.shipment_code,v_field.status; end if;
    if v_field.wms_reception_id is not null then raise exception 'Field Shipment déjà lié à la réception %',v_field.wms_reception_id; end if;
    if v_purchase<>'FIELD_BUYING' then raise exception 'Field Shipment exige Purchase Type FIELD_BUYING'; end if;
    v_truck:=upper(regexp_replace(coalesce(v_field.vehicle_plate,p->>'truck',''),'\s+','','g'));
    v_origin:=coalesce(nullif(v_field.origin_label,''),btrim(p->>'origin'));
    v_expected:=coalesce(v_field.dispatched_qty_kg,v_field.planned_qty_kg,nullif(p->>'expected_kg','')::numeric);
    select coalesce(sum(cn.bag_count),0)::int into v_bags
    from public.field_shipment_lots sl
    join public.field_lot_contributors cn on cn.lot_id=sl.lot_id and cn.status='ACTIVE'
    where sl.shipment_id=v_field.id;
    v_driver:=coalesce(nullif(v_field.driver_name,''),nullif(p->>'driver',''));
    v_reference:=v_field.shipment_code;
    v_code:=null; v_name:='MULTI-PRODUCER / FIELD BUYING';
    select * into v_wh from public.wms_warehouses
      where id::text=v_field.destination_id or upper(code)=upper(coalesce(v_field.destination_id,''))
      limit 1;
  elsif v_src_type in ('LBA_ARRIVAL','SUPPLIER_ARRIVAL') then
    select * into v_lba from public.rcn_proc_arrivages where id=v_src_id for update;
    if v_lba.id is null then raise exception 'LBA Arrival introuvable'; end if;
    if v_lba.reception_id is not null then raise exception 'LBA Arrival déjà lié à la réception %',v_lba.reception_id; end if;
    if v_src_type='LBA_ARRIVAL' and v_purchase<>'LBA' then raise exception 'LBA Arrival exige Purchase Type LBA'; end if;
    if v_src_type='SUPPLIER_ARRIVAL' and upper(coalesce(v_lba.payload->>'purchase_type',''))<>v_purchase then
      raise exception 'Purchase Type % ne correspond pas au Planned Arrival %',v_purchase,coalesce(v_lba.payload->>'purchase_type','-');
    end if;
    v_code:=upper(btrim(coalesce(v_lba.supplier_code,'')));
    select * into v_sup from public.rcn_fournisseurs where code=v_code;
    if v_sup.code is null or upper(coalesce(v_sup.statut,''))<>'ACTIF' then raise exception 'LBA Supplier invalide ou inactif'; end if;
    v_name:=v_sup.nom;
    v_truck:=upper(regexp_replace(coalesce(v_lba.payload->>'truck',v_lba.payload->>'camion',p->>'truck',''),'\s+','','g'));
    v_origin:=coalesce(nullif(v_lba.payload->>'origin',''),array_to_string(v_sup.origines,', '),btrim(p->>'origin'));
    v_expected:=coalesce(nullif(v_lba.payload->>'expected_kg','')::numeric,nullif(v_lba.payload->>'poids_annonce','')::numeric,nullif(v_lba.payload->>'qty_kg','')::numeric,nullif(p->>'expected_kg','')::numeric);
    v_bags:=coalesce(nullif(v_lba.payload->>'expected_bags','')::int,nullif(v_lba.payload->>'sacs_annonce','')::int,nullif(p->>'expected_bags','')::int);
    v_driver:=coalesce(nullif(v_lba.payload->>'driver',''),nullif(p->>'driver',''));
    v_transporter:=coalesce(nullif(v_lba.payload->>'transporter',''),nullif(p->>'transporter',''));
    v_reference:=v_lba.id;
    select * into v_wh from public.wms_warehouses
      where id::text=coalesce(nullif(v_lba.payload->>'warehouse_id',''),'')
         or upper(code)=upper(coalesce(v_lba.payload->>'warehouse_code',v_lba.payload->>'warehouse',''))
      limit 1;
  else
    v_code:=upper(btrim(coalesce(p->>'supplier_code','')));
    if v_code='' then raise exception 'Supplier obligatoire : choisissez un fournisseur du Supplier Master'; end if;
    select * into v_sup from public.rcn_fournisseurs where code=v_code;
    if v_sup.code is null then raise exception 'Supplier Code % inexistant dans Supplier Master',v_code; end if;
    if upper(coalesce(v_sup.statut,''))<>'ACTIF' then raise exception 'Supplier % inactif',v_code; end if;
    v_name:=v_sup.nom;
    v_truck:=upper(regexp_replace(coalesce(p->>'truck',''),'\s+','','g'));
    v_origin:=btrim(coalesce(p->>'origin',''));
    v_expected:=nullif(p->>'expected_kg','')::numeric;
    v_bags:=nullif(p->>'expected_bags','')::int;
    v_driver:=nullif(p->>'driver','');
    v_transporter:=nullif(p->>'transporter','');
    v_reference:=nullif(p->>'reference','');
  end if;

  if v_truck='' then raise exception 'Truck Number obligatoire'; end if;
  if coalesce(v_origin,'')='' then raise exception 'Origin obligatoire'; end if;

  if v_wh.id is null then
    if nullif(p->>'warehouse_id','') is null then raise exception 'Warehouse obligatoire'; end if;
    select * into v_wh from public.wms_warehouses where id=(p->>'warehouse_id')::uuid;
  end if;
  if v_wh.id is null then raise exception 'Warehouse obligatoire'; end if;
  if v_wh.status<>'ACTIVE' then raise exception 'Warehouse % inactif',v_wh.code; end if;

  if coalesce(btrim(p->>'arrival_at'),'')='' then raise exception 'Arrival Date/Time obligatoire'; end if;
  v_arr:=(p->>'arrival_at')::timestamptz;

  v_win:=coalesce((public.wms_param('duplicateTruckWindowMin')->>'value')::int,120);
  select id into dup from public.wms_receptions
   where truck=v_truck and status not in ('REJECTED','CLOSED')
     and abs(extract(epoch from (arrival_at-v_arr)))<v_win*60 limit 1;
  if dup is not null and coalesce((p->>'force')::boolean,false)=false then
    raise exception 'Doublon probable : le camion % est déjà enregistré sur ce créneau (%)',v_truck,dup using errcode='23505';
  end if;

  perform pg_advisory_xact_lock(hashtext('wms_reception_seq'));
  v_id:='REC-'||to_char(v_arr at time zone 'UTC','YYYYMMDD')||'-'||lpad(public.wms_next_seq('REC:'||to_char(v_arr at time zone 'UTC','YYYYMMDD'))::text,3,'0');

  insert into public.wms_receptions(
    id,warehouse_id,truck,supplier_name,supplier_code,origin,purchase_type,reference,idempotency_key,
    expected_kg,expected_bags,arrival_at,driver,transporter,weighbridge_ticket,delivery_note,
    procurement_channel,procurement_source_type,procurement_source_id,field_shipment_id,lba_code,
    ad_hoc,ad_hoc_reason,status,created_by,created_by_name,updated_by
  ) values(
    v_id,v_wh.id,v_truck,v_name,v_code,v_origin,v_purchase,v_reference,p_idempotency_key,
    v_expected,v_bags,v_arr,coalesce(v_driver,nullif(p->>'driver','')),coalesce(v_transporter,nullif(p->>'transporter','')),
    nullif(p->>'weighbridge_ticket',''),nullif(p->>'delivery_note',''),
    v_channel,coalesce(v_src_type,case when v_ad_hoc then 'AD_HOC' else null end),v_src_id,
    case when v_src_type='FIELD_SHIPMENT' then v_field.id else null end,
    case when v_channel='LBA' then v_code else null end,
    v_ad_hoc,v_ad_hoc_reason,'ARRIVED',(c->>'uid')::uuid,c->>'nom',(c->>'uid')::uuid
  ) returning * into r;

  if v_src_type='FIELD_SHIPMENT' then
    update public.field_shipments set wms_reception_id=r.id,updated_by=(c->>'uid')::uuid,updated_at=now()
    where id=v_field.id;
  elsif v_src_type in ('LBA_ARRIVAL','SUPPLIER_ARRIVAL') then
    update public.rcn_proc_arrivages set reception_id=r.id,updated_at=now() where id=v_lba.id;
  end if;

  perform public.wms_audit(r.id,'reception',null,
    jsonb_build_object('status',r.status,'truck',r.truck,'warehouse',v_wh.code,'supplier_code',r.supplier_code,
      'procurement_channel',r.procurement_channel,'source_type',r.procurement_source_type,'source_id',r.procurement_source_id,
      'expected_kg',r.expected_kg,'delivery_note',r.delivery_note,'weighbridge_ticket',r.weighbridge_ticket),
    'Création réception liée à Procurement');
  return to_jsonb(r);
end $function$

