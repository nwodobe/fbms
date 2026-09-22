
begin;

alter table public.wms_receptions
  add column if not exists delivery_note_present boolean not null default false;

update public.wms_receptions
set delivery_note_present=true
where nullif(btrim(coalesce(delivery_note,'')),'') is not null
  and delivery_note_present=false;

create or replace function public.wms_create_reception(p jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  c jsonb; r public.wms_receptions; v_truck text; v_arr timestamptz; v_win int; dup text; v_id text;
  v_wh public.wms_warehouses; v_sup public.rcn_fournisseurs;
  v_code text; v_name text; v_origin text; v_purchase text; v_channel text; v_supplier_mode text;
  v_src_type text; v_src_id text; v_field public.field_shipments; v_lba public.rcn_proc_arrivages;
  v_expected numeric; v_bags int; v_driver text; v_transporter text; v_reference text;
  v_ad_hoc boolean; v_ad_hoc_reason text; v_delivery_note_present boolean;
begin
  c:=public.wms_require('reception_create');

  if p_idempotency_key is not null then
    select * into r from public.wms_receptions where idempotency_key=p_idempotency_key limit 1;
    if r.id is not null then return to_jsonb(r); end if;
  end if;

  v_purchase:=upper(btrim(coalesce(p->>'purchase_type','')));
  if v_purchase='COOPERATIVE' then v_purchase:='DIRECT'; end if;
  if v_purchase not in ('FIELD_BUYING','LBA','DIRECT') then
    raise exception 'Type d''achat invalide. Valeurs autorisées : Achat Bord Champ, Achat LBA, Achat Direct';
  end if;

  select pt.channel_code into v_channel
  from public.procurement_purchase_types pt
  where pt.code=v_purchase and pt.active;
  if v_channel is null then raise exception 'Type d''achat % inactif',v_purchase; end if;

  v_src_type:=upper(nullif(btrim(p->>'procurement_source_type'),''));
  v_src_id:=nullif(btrim(p->>'procurement_source_id'),'');
  v_ad_hoc:=coalesce((p->>'ad_hoc')::boolean,false);
  v_ad_hoc_reason:=nullif(btrim(p->>'ad_hoc_reason'),'');

  if v_src_type is not null and v_src_type not in ('FIELD_SHIPMENT','LBA_ARRIVAL','SUPPLIER_ARRIVAL') then
    raise exception 'Référence d''approvisionnement non reconnue : %',v_src_type;
  end if;

  if v_src_type is null and not v_ad_hoc then
    raise exception 'Référence d''approvisionnement obligatoire pour une réception planifiée';
  end if;

  if v_ad_hoc and v_ad_hoc_reason is null then
    raise exception 'Motif de la réception non planifiée obligatoire';
  end if;

  if v_purchase='FIELD_BUYING' and v_src_type is distinct from 'FIELD_SHIPMENT' then
    raise exception 'Achat Bord Champ : une Evacuation / Field Shipment est obligatoire pour conserver la généalogie producteurs';
  end if;

  if v_src_type='FIELD_SHIPMENT' then
    select * into v_field from public.field_shipments
    where id::text=v_src_id or shipment_code=v_src_id
    for update;
    if v_field.id is null then raise exception 'Evacuation / Field Shipment introuvable'; end if;
    if v_field.status<>'DISPATCHED' then
      raise exception 'Evacuation % non expédiée (statut %)',v_field.shipment_code,v_field.status;
    end if;
    if v_field.wms_reception_id is not null then
      raise exception 'Evacuation déjà liée à la réception %',v_field.wms_reception_id;
    end if;
    if v_purchase<>'FIELD_BUYING' then
      raise exception 'Cette référence correspond à un Achat Bord Champ';
    end if;

    v_truck:=upper(regexp_replace(coalesce(v_field.vehicle_plate,p->>'truck',''),'\\s+','','g'));
    v_origin:=coalesce(nullif(v_field.origin_label,''),btrim(p->>'origin'));
    v_expected:=coalesce(v_field.dispatched_qty_kg,v_field.planned_qty_kg,nullif(p->>'expected_kg','')::numeric);

    select coalesce(sum(cn.bag_count),0)::int into v_bags
    from public.field_shipment_lots sl
    join public.field_lot_contributors cn on cn.lot_id=sl.lot_id and cn.status='ACTIVE'
    where sl.shipment_id=v_field.id;

    v_driver:=coalesce(nullif(v_field.driver_name,''),nullif(p->>'driver',''));
    v_reference:=v_field.shipment_code;
    v_code:=null;
    v_name:='MULTI-PRODUCTEURS / ACHAT BORD CHAMP';

    select * into v_wh from public.wms_warehouses
    where id::text=v_field.destination_id
       or upper(code)=upper(coalesce(v_field.destination_id,''))
    limit 1;

  elsif v_src_type in ('LBA_ARRIVAL','SUPPLIER_ARRIVAL') then
    select * into v_lba from public.rcn_proc_arrivages where id=v_src_id for update;
    if v_lba.id is null then raise exception 'Arrivage Procurement introuvable'; end if;
    if v_lba.reception_id is not null then
      raise exception 'Arrivage Procurement déjà lié à la réception %',v_lba.reception_id;
    end if;

    if v_src_type='LBA_ARRIVAL' and v_purchase<>'LBA' then
      raise exception 'Cette référence correspond à un Achat LBA';
    end if;

    if v_src_type='SUPPLIER_ARRIVAL' then
      if upper(coalesce(v_lba.payload->>'purchase_type','DIRECT')) in ('DIRECT','COOPERATIVE')
         and v_purchase<>'DIRECT' then
        raise exception 'Cette référence correspond à un Achat Direct';
      elsif upper(coalesce(v_lba.payload->>'purchase_type',''))='LBA'
         and v_purchase<>'LBA' then
        raise exception 'Cette référence correspond à un Achat LBA';
      end if;
    end if;

    v_code:=upper(btrim(coalesce(v_lba.supplier_code,'')));
    select * into v_sup from public.rcn_fournisseurs where code=v_code;
    if v_sup.code is null or upper(coalesce(v_sup.statut,''))<>'ACTIF' then
      raise exception 'Fournisseur / LBA invalide ou inactif';
    end if;

    if v_sup.supplier_id is not null then
      select procurement_mode into v_supplier_mode
      from public.procurement_suppliers
      where supplier_id=v_sup.supplier_id;
    end if;
    v_supplier_mode:=coalesce(v_supplier_mode,
      case when v_code like 'LBA-%' then 'LBA'
           when v_code like 'DIS-%' then 'DIRECT'
           else null end);

    if v_purchase='LBA' and v_supplier_mode is distinct from 'LBA' then
      raise exception 'Le partenaire % n''est pas actuellement en mode LBA',v_code;
    end if;
    if v_purchase='DIRECT' and v_supplier_mode='LBA' then
      raise exception 'Le partenaire % est actuellement en mode LBA',v_code;
    end if;

    v_name:=v_sup.nom;
    v_truck:=upper(regexp_replace(coalesce(v_lba.payload->>'truck',v_lba.payload->>'camion',p->>'truck',''),'\\s+','','g'));
    v_origin:=coalesce(nullif(v_lba.payload->>'origin',''),array_to_string(v_sup.origines,', '),btrim(p->>'origin'));
    v_expected:=coalesce(
      nullif(v_lba.payload->>'expected_kg','')::numeric,
      nullif(v_lba.payload->>'poids_annonce','')::numeric,
      nullif(v_lba.payload->>'qty_kg','')::numeric,
      nullif(p->>'expected_kg','')::numeric
    );
    v_bags:=coalesce(
      nullif(v_lba.payload->>'expected_bags','')::int,
      nullif(v_lba.payload->>'sacs_annonce','')::int,
      nullif(p->>'expected_bags','')::int
    );
    v_driver:=coalesce(nullif(v_lba.payload->>'driver',''),nullif(p->>'driver',''));
    v_transporter:=coalesce(nullif(v_lba.payload->>'transporter',''),nullif(p->>'transporter',''));
    v_reference:=v_lba.id;

    select * into v_wh from public.wms_warehouses
    where id::text=coalesce(nullif(v_lba.payload->>'warehouse_id',''),'')
       or upper(code)=upper(coalesce(v_lba.payload->>'warehouse_code',v_lba.payload->>'warehouse',''))
    limit 1;

  else
    v_code:=upper(btrim(coalesce(p->>'supplier_code','')));
    if v_code='' then
      raise exception 'Fournisseur / LBA obligatoire pour une réception non planifiée';
    end if;

    select * into v_sup from public.rcn_fournisseurs where code=v_code;
    if v_sup.code is null then raise exception 'Code fournisseur % inexistant',v_code; end if;
    if upper(coalesce(v_sup.statut,''))<>'ACTIF' then raise exception 'Fournisseur % inactif',v_code; end if;

    if v_sup.supplier_id is not null then
      select procurement_mode into v_supplier_mode
      from public.procurement_suppliers
      where supplier_id=v_sup.supplier_id;
    end if;
    v_supplier_mode:=coalesce(v_supplier_mode,
      case when v_code like 'LBA-%' then 'LBA'
           when v_code like 'DIS-%' then 'DIRECT'
           else null end);

    if v_purchase='LBA' and v_supplier_mode is distinct from 'LBA' then
      raise exception 'Le partenaire % n''est pas actuellement en mode LBA',v_code;
    end if;
    if v_purchase='DIRECT' and v_supplier_mode='LBA' then
      raise exception 'Le partenaire % est actuellement en mode LBA',v_code;
    end if;

    v_name:=v_sup.nom;
    v_truck:=upper(regexp_replace(coalesce(p->>'truck',''),'\\s+','','g'));
    v_origin:=btrim(coalesce(p->>'origin',''));
    v_expected:=nullif(p->>'expected_kg','')::numeric;
    v_bags:=nullif(p->>'expected_bags','')::int;
    v_driver:=nullif(p->>'driver','');
    v_transporter:=nullif(p->>'transporter','');
    v_reference:=null;
  end if;

  if v_truck='' then raise exception 'Immatriculation du camion obligatoire'; end if;
  if coalesce(v_origin,'')='' then raise exception 'Provenance obligatoire'; end if;

  if v_wh.id is null then
    if nullif(p->>'warehouse_id','') is null then raise exception 'Entrepôt obligatoire'; end if;
    select * into v_wh from public.wms_warehouses where id=(p->>'warehouse_id')::uuid;
  end if;
  if v_wh.id is null then raise exception 'Entrepôt obligatoire'; end if;
  if v_wh.status<>'ACTIVE' then raise exception 'Entrepôt % inactif',v_wh.code; end if;

  if coalesce(btrim(p->>'arrival_at'),'')='' then raise exception 'Date et heure d''arrivée obligatoires'; end if;
  v_arr:=(p->>'arrival_at')::timestamptz;

  v_delivery_note_present:=coalesce((p->>'delivery_note_present')::boolean,
    nullif(btrim(coalesce(p->>'delivery_note','')),'') is not null);
  if nullif(btrim(coalesce(p->>'delivery_note','')),'') is not null then
    v_delivery_note_present:=true;
  end if;
  if v_delivery_note_present and nullif(btrim(coalesce(p->>'delivery_note','')),'') is null then
    raise exception 'Numéro du bon de livraison obligatoire lorsque le document est indiqué présent';
  end if;

  v_win:=coalesce((public.wms_param('duplicateTruckWindowMin')->>'value')::int,120);
  select id into dup from public.wms_receptions
   where truck=v_truck and status not in ('REJECTED','CLOSED')
     and abs(extract(epoch from (arrival_at-v_arr)))<v_win*60
   limit 1;
  if dup is not null and coalesce((p->>'force')::boolean,false)=false then
    raise exception 'Doublon probable : le camion % est déjà enregistré sur ce créneau (%)',v_truck,dup
      using errcode='23505';
  end if;

  perform pg_advisory_xact_lock(hashtext('wms_reception_seq'));
  v_id:='REC-'||to_char(v_arr at time zone 'UTC','YYYYMMDD')||'-'||
        lpad(public.wms_next_seq('REC:'||to_char(v_arr at time zone 'UTC','YYYYMMDD'))::text,3,'0');

  insert into public.wms_receptions(
    id,warehouse_id,truck,supplier_name,supplier_code,origin,purchase_type,reference,idempotency_key,
    expected_kg,expected_bags,arrival_at,driver,transporter,weighbridge_ticket,delivery_note,delivery_note_present,
    procurement_channel,procurement_source_type,procurement_source_id,field_shipment_id,lba_code,
    ad_hoc,ad_hoc_reason,status,created_by,created_by_name,updated_by
  ) values(
    v_id,v_wh.id,v_truck,v_name,v_code,v_origin,v_purchase,v_reference,p_idempotency_key,
    v_expected,v_bags,v_arr,coalesce(v_driver,nullif(p->>'driver','')),coalesce(v_transporter,nullif(p->>'transporter','')),
    nullif(p->>'weighbridge_ticket',''),nullif(p->>'delivery_note',''),v_delivery_note_present,
    v_channel,coalesce(v_src_type,case when v_ad_hoc then 'AD_HOC' else null end),v_src_id,
    case when v_src_type='FIELD_SHIPMENT' then v_field.id else null end,
    case when v_purchase='LBA' then v_code else null end,
    v_ad_hoc,v_ad_hoc_reason,'ARRIVED',(c->>'uid')::uuid,c->>'nom',(c->>'uid')::uuid
  ) returning * into r;

  if v_src_type='FIELD_SHIPMENT' then
    update public.field_shipments
    set wms_reception_id=r.id,updated_by=(c->>'uid')::uuid,updated_at=now()
    where id=v_field.id;
  elsif v_src_type in ('LBA_ARRIVAL','SUPPLIER_ARRIVAL') then
    update public.rcn_proc_arrivages set reception_id=r.id,updated_at=now() where id=v_lba.id;
  end if;

  perform public.wms_audit(
    r.id,'reception',null,
    jsonb_build_object(
      'status',r.status,'truck',r.truck,'warehouse',v_wh.code,'supplier_code',r.supplier_code,
      'purchase_type',r.purchase_type,'planned',not r.ad_hoc,
      'procurement_channel',r.procurement_channel,'source_type',r.procurement_source_type,'source_id',r.procurement_source_id,
      'expected_kg',r.expected_kg,'delivery_note_present',r.delivery_note_present,
      'delivery_note',r.delivery_note,'weighbridge_ticket',r.weighbridge_ticket
    ),
    case when r.ad_hoc then 'Création réception non planifiée' else 'Création réception liée à Procurement' end
  );

  return to_jsonb(r);
end $$;

create or replace view public.wms_v_receptions
with (security_invoker=true) as
select
  r.id,r.warehouse_id,r.truck,r.supplier_name,r.supplier_code,r.origin,r.purchase_type,r.reference,
  r.expected_kg,r.expected_bags,r.arrival_at,r.driver,r.transporter,r.status,r.decision,r.decision_comment,
  r.decided_by,r.decided_by_name,r.decided_at,r.gross_kg,r.tare_kg,r.net_kg,r.bags,r.bags_good,r.bags_wet,
  r.bags_torn,r.bags_recond,r.weighbridge_ticket,r.delivery_note,r.warehouse_receipt,
  r.offload_start,r.offload_end,r.offloaded_by,r.offloaded_at,r.hold_reason,r.lot_id,r.idempotency_key,
  r.created_by,r.created_by_name,r.created_at,r.updated_by,r.updated_at,
  w.code warehouse_code,w.name warehouse_name,w.site_code,
  qs.id sampling_id,qs.kor_display sampling_kor,qs.moisture_pct sampling_moisture,qs.nut_count sampling_nc,qs.created_at sampling_at,
  qf.id final_id,qf.kor_display final_kor,qf.moisture_pct final_moisture,qf.nut_count final_nc,
  qf.delta_vs_sampling kor_delta,qf.within_tolerance,qf.created_at final_at,
  case r.status
    when 'ARRIVED' then 'SAMPLING'
    when 'AWAITING_DECISION' then 'DECISION'
    when 'ACCEPTED_WAITING_OFFLOAD' then 'OFFLOAD'
    when 'AWAITING_FINAL_QA' then case when qf.id is null then 'FINAL_QA' else 'RELEASE' end
    when 'QUALITY_HOLD' then 'RESOLVE_HOLD'
    when 'RELEASED' then 'ALLOCATE_BIN'
    else null
  end next_action,
  round(extract(epoch from now()-r.arrival_at)/3600.0,1) age_hours,
  r.procurement_channel,r.procurement_source_type,r.procurement_source_id,r.field_shipment_id,r.lba_code,
  r.ad_hoc,r.ad_hoc_reason,
  ps.refraction_mode,ps.refraction_value,ps.refraction_kg,ps.paid_weight_kg,ps.price_per_kg,
  ps.amount_payable,ps.payment_status,ps.payment_method,ps.status procurement_settlement_status,
  r.delivery_note_present
from public.wms_receptions r
join public.wms_warehouses w on w.id=r.warehouse_id
left join public.wms_v_quality_current qs on qs.reception_id=r.id and qs.type='SAMPLING'
left join public.wms_v_quality_current qf on qf.reception_id=r.id and qf.type='FINAL'
left join public.procurement_reception_settlements ps on ps.reception_id=r.id;

grant select on public.wms_v_receptions to authenticated;

commit;
