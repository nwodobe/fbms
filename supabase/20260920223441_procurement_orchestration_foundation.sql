
begin;

create table if not exists public.procurement_channels(
  code text primary key,
  label text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_channels_code_chk check (code ~ '^[A-Z0-9_]+$')
);

create table if not exists public.procurement_purchase_types(
  code text primary key,
  label text not null,
  channel_code text not null references public.procurement_channels(code) on update restrict on delete restrict,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_purchase_types_code_chk check (code ~ '^[A-Z0-9_]+$')
);

create table if not exists public.procurement_payment_methods(
  code text primary key,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_payment_methods_code_chk check (code ~ '^[A-Z0-9_]+$')
);

create table if not exists public.procurement_campaign_rules(
  id uuid primary key default gen_random_uuid(),
  campaign text not null,
  channel_code text not null references public.procurement_channels(code) on update restrict on delete restrict,
  zone_code text,
  price_per_kg numeric check (price_per_kg is null or price_per_kg >= 0),
  rt_commission_per_kg numeric check (rt_commission_per_kg is null or rt_commission_per_kg >= 0),
  max_moisture_pct numeric check (max_moisture_pct is null or max_moisture_pct >= 0),
  min_kor numeric check (min_kor is null or min_kor >= 0),
  effective_from date not null,
  effective_to date,
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','INACTIVE','SUPERSEDED')),
  source text,
  reason text,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_campaign_rules_dates_chk check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists procurement_campaign_rules_active_uniq
on public.procurement_campaign_rules(campaign,channel_code,coalesce(zone_code,'*'),effective_from)
where status='ACTIVE';

insert into public.procurement_channels(code,label,description) values
('FIELD_BUYING','Achat Bord Champ','Achats terrain réalisés auprès des producteurs via les équipes RT'),
('LBA','LBA','Achats via le réseau LBA'),
('COOPERATIVE','Coopérative','Achats auprès des coopératives'),
('DIRECT','Direct Supplier','Achats directs auprès d’un fournisseur')
on conflict(code) do update set label=excluded.label,description=excluded.description,updated_at=now();

insert into public.procurement_purchase_types(code,label,channel_code,description) values
('FIELD_BUYING','Achat Bord Champ','FIELD_BUYING','Achat terrain consolidé puis évacué vers un Warehouse'),
('LBA','LBA','LBA','Achat RCN via LBA'),
('COOPERATIVE','Coopérative','COOPERATIVE','Achat RCN auprès d’une coopérative'),
('DIRECT','Direct','DIRECT','Achat direct fournisseur')
on conflict(code) do update set label=excluded.label,channel_code=excluded.channel_code,description=excluded.description,updated_at=now();

insert into public.procurement_payment_methods(code,label) values
('WAVE','Wave'),('CASH','Cash'),('BANK','Bank'),('OTHER','Other approved method')
on conflict(code) do update set label=excluded.label,updated_at=now();

-- Migration contrôlée des paramètres qui étaient hardcodés dans operations/field-buying.js.
insert into public.procurement_campaign_rules(
  campaign,channel_code,zone_code,price_per_kg,rt_commission_per_kg,max_moisture_pct,min_kor,
  effective_from,status,source,reason
)
select '2027','FIELD_BUYING',null,400,10,10,45,date '2026-01-01','ACTIVE',
       'LEGACY_FIELD_BUYING_JS',
       'Valeurs migrées du moteur Field Buying existant; à valider métier puis superséder par une nouvelle règle versionnée.'
where not exists(
  select 1 from public.procurement_campaign_rules
  where campaign='2027' and channel_code='FIELD_BUYING' and zone_code is null and status='ACTIVE'
);

alter table public.wms_receptions
  alter column supplier_name drop not null,
  alter column supplier_code drop not null;

alter table public.wms_receptions
  add column if not exists procurement_channel text references public.procurement_channels(code),
  add column if not exists procurement_source_type text,
  add column if not exists procurement_source_id text,
  add column if not exists field_shipment_id uuid,
  add column if not exists lba_code text references public.rcn_fournisseurs(code),
  add column if not exists ad_hoc boolean not null default false,
  add column if not exists ad_hoc_reason text;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='wms_receptions_purchase_type_fk') then
    alter table public.wms_receptions
      add constraint wms_receptions_purchase_type_fk
      foreign key(purchase_type) references public.procurement_purchase_types(code)
      on update restrict on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='wms_receptions_field_shipment_fk') then
    alter table public.wms_receptions
      add constraint wms_receptions_field_shipment_fk
      foreign key(field_shipment_id) references public.field_shipments(id)
      on update restrict on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='wms_receptions_source_type_chk') then
    alter table public.wms_receptions add constraint wms_receptions_source_type_chk
    check (procurement_source_type is null or procurement_source_type in ('FIELD_SHIPMENT','LBA_ARRIVAL','PURCHASE','AD_HOC'));
  end if;
  if not exists(select 1 from pg_constraint where conname='wms_receptions_adhoc_reason_chk') then
    alter table public.wms_receptions add constraint wms_receptions_adhoc_reason_chk
    check (not ad_hoc or nullif(btrim(coalesce(ad_hoc_reason,'')),'') is not null);
  end if;
end $$;

create unique index if not exists wms_receptions_field_shipment_uniq
on public.wms_receptions(field_shipment_id) where field_shipment_id is not null;
create unique index if not exists wms_receptions_procurement_source_uniq
on public.wms_receptions(procurement_source_type,procurement_source_id)
where procurement_source_type is not null and procurement_source_id is not null;

alter table public.field_shipments
  add column if not exists wms_reception_id text;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='field_shipments_wms_reception_fk') then
    alter table public.field_shipments add constraint field_shipments_wms_reception_fk
    foreign key(wms_reception_id) references public.wms_receptions(id)
    on update restrict on delete restrict;
  end if;
end $$;
create unique index if not exists field_shipments_wms_reception_uniq
on public.field_shipments(wms_reception_id) where wms_reception_id is not null;

create table if not exists public.procurement_reception_settlements(
  id uuid primary key default gen_random_uuid(),
  reception_id text not null unique references public.wms_receptions(id) on update restrict on delete restrict,
  refraction_mode text not null default 'NONE' check (refraction_mode in ('NONE','KG','PERCENT')),
  refraction_value numeric not null default 0 check (refraction_value >= 0),
  refraction_kg numeric not null default 0 check (refraction_kg >= 0),
  net_kg_snapshot numeric not null check (net_kg_snapshot > 0),
  paid_weight_kg numeric not null check (paid_weight_kg >= 0),
  price_per_kg numeric check (price_per_kg is null or price_per_kg >= 0),
  amount_payable numeric check (amount_payable is null or amount_payable >= 0),
  payment_status text not null default 'UNPAID' check (payment_status in ('UNPAID','PENDING','PARTIAL','PAID','FAILED','REVERSED')),
  payment_method text references public.procurement_payment_methods(code),
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  constraint procurement_settlement_refraction_chk check (refraction_kg <= net_kg_snapshot + 0.001),
  constraint procurement_settlement_paid_chk check (abs(paid_weight_kg - (net_kg_snapshot-refraction_kg)) <= 0.001)
);

create or replace function public.procurement_active_rule(
  p_campaign text,
  p_channel text,
  p_zone text default null,
  p_date date default current_date
) returns jsonb
language sql stable security definer set search_path=public as $$
  select to_jsonb(r)
  from public.procurement_campaign_rules r
  where r.campaign=p_campaign
    and r.channel_code=p_channel
    and r.status='ACTIVE'
    and r.effective_from<=p_date
    and (r.effective_to is null or r.effective_to>=p_date)
    and (r.zone_code=p_zone or r.zone_code is null)
  order by (r.zone_code is not null) desc,r.effective_from desc,r.created_at desc
  limit 1
$$;

revoke all on function public.procurement_active_rule(text,text,text,date) from public,anon;
grant execute on function public.procurement_active_rule(text,text,text,date) to authenticated;

create or replace function public.procurement_set_reception_settlement(p_reception_id text,p jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  c jsonb; r public.wms_receptions; s public.procurement_reception_settlements;
  v_mode text; v_val numeric; v_ref numeric; v_paid numeric; v_price numeric; v_amount numeric;
  v_payment text; v_method text;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(array[
    'General Manager','GM','Branch Manager','Assistant Branch Manager',
    'Procurement Officer','LBA Purchase Officer','Field Buying Operations Officer','Finance'
  ]) then raise exception 'Droit insuffisant pour le règlement commercial'; end if;

  select * into r from public.wms_receptions where id=p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.net_kg is null or r.net_kg<=0 then raise exception 'Net Weight Warehouse requis avant Refraction / Paid Weight'; end if;

  v_mode:=upper(coalesce(nullif(p->>'refraction_mode',''),'NONE'));
  if v_mode not in ('NONE','KG','PERCENT') then raise exception 'Refraction Mode invalide'; end if;
  v_val:=coalesce(nullif(p->>'refraction_value','')::numeric,0);
  if v_val<0 then raise exception 'Refraction négative interdite'; end if;

  if v_mode='NONE' then v_ref:=0;
  elsif v_mode='KG' then v_ref:=round(v_val,3);
  else
    if v_val>100 then raise exception 'Refraction %% ne peut pas dépasser 100'; end if;
    v_ref:=round(r.net_kg*v_val/100.0,3);
  end if;

  if v_ref>r.net_kg then raise exception 'Refraction % kg supérieure au Net Weight % kg',v_ref,r.net_kg; end if;
  v_paid:=round(r.net_kg-v_ref,3);
  v_price:=nullif(p->>'price_per_kg','')::numeric;
  if v_price is not null and v_price<0 then raise exception 'Prix négatif interdit'; end if;
  v_amount:=case when v_price is null then null else round(v_paid*v_price,0) end;
  v_payment:=upper(coalesce(nullif(p->>'payment_status',''),'UNPAID'));
  if v_payment not in ('UNPAID','PENDING','PARTIAL','PAID','FAILED','REVERSED') then raise exception 'Payment Status invalide'; end if;
  v_method:=upper(nullif(p->>'payment_method',''));
  if v_method is not null and not exists(select 1 from public.procurement_payment_methods where code=v_method and active) then
    raise exception 'Payment Method % invalide ou inactif',v_method;
  end if;

  insert into public.procurement_reception_settlements(
    reception_id,refraction_mode,refraction_value,refraction_kg,net_kg_snapshot,paid_weight_kg,
    price_per_kg,amount_payable,payment_status,payment_method,status,note,
    created_by,created_by_name,updated_by
  ) values(
    r.id,v_mode,v_val,v_ref,r.net_kg,v_paid,v_price,v_amount,v_payment,v_method,
    coalesce(nullif(p->>'status',''),'DRAFT'),nullif(p->>'note',''),
    (c->>'uid')::uuid,c->>'nom',(c->>'uid')::uuid
  )
  on conflict(reception_id) do update set
    refraction_mode=excluded.refraction_mode,
    refraction_value=excluded.refraction_value,
    refraction_kg=excluded.refraction_kg,
    net_kg_snapshot=excluded.net_kg_snapshot,
    paid_weight_kg=excluded.paid_weight_kg,
    price_per_kg=excluded.price_per_kg,
    amount_payable=excluded.amount_payable,
    payment_status=excluded.payment_status,
    payment_method=excluded.payment_method,
    status=excluded.status,
    note=excluded.note,
    updated_by=(c->>'uid')::uuid,
    updated_at=now()
  returning * into s;

  perform public.wms_audit(r.id,'procurement.settlement',null,
    jsonb_build_object(
      'net_kg',r.net_kg,'refraction_mode',s.refraction_mode,'refraction_value',s.refraction_value,
      'refraction_kg',s.refraction_kg,'paid_weight_kg',s.paid_weight_kg,
      'price_per_kg',s.price_per_kg,'amount_payable',s.amount_payable,
      'payment_status',s.payment_status,'payment_method',s.payment_method
    ),
    'Enregistrement commercial Procurement');
  return to_jsonb(s);
end $$;

revoke all on function public.procurement_set_reception_settlement(text,jsonb) from public,anon;
grant execute on function public.procurement_set_reception_settlement(text,jsonb) to authenticated;

create or replace function public.procurement_approve_reception_settlement(p_reception_id text,p_approve boolean,p_reason text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  c jsonb; s public.procurement_reception_settlements;
begin
  c:=public.wms_ctx();
  if not private.ops_has_role(array['General Manager','GM','Branch Manager','Finance']) then
    raise exception 'Approbation réservée au Management / Finance';
  end if;
  select * into s from public.procurement_reception_settlements where reception_id=p_reception_id for update;
  if s.id is null then raise exception 'Règlement commercial introuvable'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Motif obligatoire'; end if;
  if s.created_by=(c->>'uid')::uuid then raise exception 'Séparation des tâches : créateur et approbateur doivent être différents'; end if;

  update public.procurement_reception_settlements set
    status=case when p_approve then 'APPROVED' else 'REJECTED' end,
    approved_by=(c->>'uid')::uuid,approved_by_name=c->>'nom',approved_at=now(),
    updated_by=(c->>'uid')::uuid,updated_at=now(),note=coalesce(note||E'\n','')||p_reason
  where id=s.id returning * into s;

  perform public.wms_audit(p_reception_id,'procurement.settlement.approval',null,
    jsonb_build_object('status',s.status,'approved_by',s.approved_by_name),p_reason);
  return to_jsonb(s);
end $$;

revoke all on function public.procurement_approve_reception_settlement(text,boolean,text) from public,anon;
grant execute on function public.procurement_approve_reception_settlement(text,boolean,text) to authenticated;

create or replace view public.procurement_v_pending_receptions
with (security_invoker=true) as
with field_bags as (
  select sl.shipment_id,coalesce(sum(c.bag_count),0)::int expected_bags
  from public.field_shipment_lots sl
  join public.field_lot_contributors c on c.lot_id=sl.lot_id and c.status='ACTIVE'
  group by sl.shipment_id
)
select
  'FIELD_SHIPMENT'::text source_type,
  s.id::text source_id,
  s.shipment_code source_ref,
  'FIELD_BUYING'::text procurement_channel,
  'FIELD_BUYING'::text purchase_type,
  null::text supplier_code,
  'MULTI-PRODUCER / FIELD BUYING'::text supplier_name,
  null::text lba_code,
  s.origin_label origin,
  s.vehicle_plate truck,
  s.driver_name driver,
  null::text transporter,
  coalesce(s.dispatched_qty_kg,s.planned_qty_kg) expected_kg,
  fb.expected_bags,
  w.id warehouse_id,
  w.code warehouse_code,
  s.departed_at source_date,
  s.status source_status
from public.field_shipments s
left join field_bags fb on fb.shipment_id=s.id
left join public.wms_warehouses w
  on w.id::text=s.destination_id or upper(w.code)=upper(coalesce(s.destination_id,''))
where s.status='DISPATCHED' and s.wms_reception_id is null

union all

select
  'LBA_ARRIVAL'::text,
  a.id::text,
  a.id::text,
  'LBA'::text,
  'LBA'::text,
  a.supplier_code,
  f.nom,
  a.supplier_code,
  coalesce(nullif(a.payload->>'origin',''),array_to_string(f.origines,', '),'LBA') origin,
  coalesce(nullif(a.payload->>'truck',''),nullif(a.payload->>'camion','')) truck,
  nullif(a.payload->>'driver','') driver,
  nullif(a.payload->>'transporter','') transporter,
  coalesce(nullif(a.payload->>'expected_kg','')::numeric,nullif(a.payload->>'poids_annonce','')::numeric,nullif(a.payload->>'qty_kg','')::numeric) expected_kg,
  coalesce(nullif(a.payload->>'expected_bags','')::int,nullif(a.payload->>'sacs_annonce','')::int) expected_bags,
  w.id warehouse_id,
  w.code warehouse_code,
  coalesce(a.prevu_at,a.created_at) source_date,
  a.statut source_status
from public.rcn_proc_arrivages a
left join public.rcn_fournisseurs f on f.code=a.supplier_code
left join public.wms_warehouses w
  on w.id::text=nullif(a.payload->>'warehouse_id','')
  or upper(w.code)=upper(coalesce(a.payload->>'warehouse_code',a.payload->>'warehouse',''))
where a.reception_id is null
  and a.supplier_code is not null;

create or replace view public.procurement_v_purchase_feed
with (security_invoker=true) as
select
  a.id::text purchase_id,
  'FIELD_BUYING'::text procurement_channel,
  a.date::timestamptz purchase_at,
  a.producteur_code counterparty_code,
  a.producteur_nom counterparty_name,
  null::text lba_code,
  a.producteur_id,
  a.rt_id,
  a.village_id,
  a.village_nom,
  a.cluster,
  a.poids_net field_or_net_kg,
  a.poids_net paid_weight_kg,
  a.prix_kg unit_price,
  a.montant amount,
  a.mode_paiement payment_method,
  a.cash_statut payment_status,
  a.statut_validation status,
  'achats'::text source_table
from public.achats a
where coalesce(a.rejet,false)=false

union all

select
  v.id::text,
  case
    when f.categorie='LBA' or v.supplier_code like 'LBA-%' then 'LBA'
    when upper(coalesce(f.categorie,'')) like '%COOP%' then 'COOPERATIVE'
    else 'DIRECT'
  end,
  v.submitted_at,
  v.supplier_code,
  v.supplier_name,
  case when f.categorie='LBA' or v.supplier_code like 'LBA-%' then v.supplier_code else null end,
  null::text,null::text,null::text,null::text,null::text,
  v.poids_net_kg,
  v.poids_paye_kg,
  coalesce(v.prix_approuve_gm,v.prix_soumis_bm,v.prix_negocie),
  coalesce(v.montant_approuve,v.montant_soumis),
  null::text,null::text,
  v.statut,
  'rcn_proc_validations_achat'::text
from public.rcn_proc_validations_achat v
left join public.rcn_fournisseurs f on f.code=v.supplier_code;

create or replace view public.procurement_v_reconciliation
with (security_invoker=true) as
select
  s.id shipment_id,
  s.shipment_code,
  s.origin_label,
  s.destination_label,
  s.vehicle_plate,
  s.departed_at,
  s.arrived_at,
  s.dispatched_qty_kg field_dispatched_kg,
  r.id wms_reception_id,
  r.net_kg warehouse_net_kg,
  case when r.net_kg is null or s.dispatched_qty_kg is null then null
       else round(r.net_kg-s.dispatched_qty_kg,3) end variance_kg,
  case when r.net_kg is null or s.dispatched_qty_kg is null or s.dispatched_qty_kg=0 then null
       else round((r.net_kg-s.dispatched_qty_kg)*100.0/s.dispatched_qty_kg,3) end variance_pct,
  case when s.wms_reception_id is null then 'AWAITING_WAREHOUSE_RECEPTION'
       when r.net_kg is null then 'AWAITING_WEIGHING'
       when abs(r.net_kg-coalesce(s.dispatched_qty_kg,0))<=0.001 then 'BALANCED'
       else 'VARIANCE_REVIEW' end reconciliation_status
from public.field_shipments s
left join public.wms_receptions r on r.id=s.wms_reception_id
where s.status not in ('DRAFT','CANCELLED');

create or replace function public.wms_create_reception(p jsonb,p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path=public as $$
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
  elsif v_src_type='LBA_ARRIVAL' then
    select * into v_lba from public.rcn_proc_arrivages where id=v_src_id for update;
    if v_lba.id is null then raise exception 'LBA Arrival introuvable'; end if;
    if v_lba.reception_id is not null then raise exception 'LBA Arrival déjà lié à la réception %',v_lba.reception_id; end if;
    if v_purchase<>'LBA' then raise exception 'LBA Arrival exige Purchase Type LBA'; end if;
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
  elsif v_src_type='LBA_ARRIVAL' then
    update public.rcn_proc_arrivages set reception_id=r.id,updated_at=now() where id=v_lba.id;
  end if;

  perform public.wms_audit(r.id,'reception',null,
    jsonb_build_object('status',r.status,'truck',r.truck,'warehouse',v_wh.code,'supplier_code',r.supplier_code,
      'procurement_channel',r.procurement_channel,'source_type',r.procurement_source_type,'source_id',r.procurement_source_id,
      'expected_kg',r.expected_kg,'delivery_note',r.delivery_note,'weighbridge_ticket',r.weighbridge_ticket),
    'Création réception liée à Procurement');
  return to_jsonb(r);
end $$;

revoke all on function public.wms_create_reception(jsonb,text) from public,anon;
grant execute on function public.wms_create_reception(jsonb,text) to authenticated;

create or replace view public.wms_v_receptions
with (security_invoker=true) as
select
  r.id,r.warehouse_id,r.truck,r.supplier_name,r.supplier_code,r.origin,r.purchase_type,r.reference,
  r.expected_kg,r.expected_bags,r.arrival_at,r.driver,r.transporter,r.status,r.decision,r.decision_comment,
  r.decided_by,r.decided_by_name,r.decided_at,r.gross_kg,r.tare_kg,r.net_kg,r.bags,r.bags_good,r.bags_wet,
  r.bags_torn,r.bags_recond,r.weighbridge_ticket,r.delivery_note,r.warehouse_receipt,r.offload_start,r.offload_end,
  r.offloaded_by,r.offloaded_at,r.hold_reason,r.lot_id,r.idempotency_key,r.created_by,r.created_by_name,r.created_at,
  r.updated_by,r.updated_at,
  w.code warehouse_code,w.name warehouse_name,w.site_code,
  qs.id sampling_id,qs.kor_display sampling_kor,qs.moisture_pct sampling_moisture,qs.nut_count sampling_nc,qs.created_at sampling_at,
  qf.id final_id,qf.kor_display final_kor,qf.moisture_pct final_moisture,qf.nut_count final_nc,qf.delta_vs_sampling kor_delta,
  qf.within_tolerance,qf.created_at final_at,
  case r.status
    when 'ARRIVED' then 'SAMPLING'
    when 'AWAITING_DECISION' then 'DECISION'
    when 'ACCEPTED_WAITING_OFFLOAD' then 'OFFLOAD'
    when 'AWAITING_FINAL_QA' then case when qf.id is null then 'FINAL_QA' else 'RELEASE' end
    when 'QUALITY_HOLD' then 'RESOLVE_HOLD'
    when 'RELEASED' then 'ALLOCATE_BIN'
    else null end next_action,
  round(extract(epoch from now()-r.arrival_at)/3600.0,1) age_hours,
  r.procurement_channel,r.procurement_source_type,r.procurement_source_id,r.field_shipment_id,r.lba_code,r.ad_hoc,r.ad_hoc_reason,
  ps.refraction_mode,ps.refraction_value,ps.refraction_kg,ps.paid_weight_kg,ps.price_per_kg,ps.amount_payable,
  ps.payment_status,ps.payment_method,ps.status procurement_settlement_status
from public.wms_receptions r
join public.wms_warehouses w on w.id=r.warehouse_id
left join public.wms_v_quality_current qs on qs.reception_id=r.id and qs.type='SAMPLING'
left join public.wms_v_quality_current qf on qf.reception_id=r.id and qf.type='FINAL'
left join public.procurement_reception_settlements ps on ps.reception_id=r.id;

alter table public.procurement_channels enable row level security;
alter table public.procurement_purchase_types enable row level security;
alter table public.procurement_payment_methods enable row level security;
alter table public.procurement_campaign_rules enable row level security;
alter table public.procurement_reception_settlements enable row level security;

drop policy if exists procurement_channels_read on public.procurement_channels;
create policy procurement_channels_read on public.procurement_channels for select to authenticated using (true);
drop policy if exists procurement_purchase_types_read on public.procurement_purchase_types;
create policy procurement_purchase_types_read on public.procurement_purchase_types for select to authenticated using (true);
drop policy if exists procurement_payment_methods_read on public.procurement_payment_methods;
create policy procurement_payment_methods_read on public.procurement_payment_methods for select to authenticated using (true);
drop policy if exists procurement_campaign_rules_read on public.procurement_campaign_rules;
create policy procurement_campaign_rules_read on public.procurement_campaign_rules for select to authenticated using (true);
drop policy if exists procurement_settlements_read on public.procurement_reception_settlements;
create policy procurement_settlements_read on public.procurement_reception_settlements for select to authenticated
using (public.rcn_proc_active_role(array[
 'General Manager','GM','Branch Manager','Assistant Branch Manager','Procurement Officer','LBA Purchase Officer',
 'Field Buying Operations Officer','Finance','Warehouse Manager','Storekeeper','QA / Lab','Viewer / Auditor'
]));

revoke all on public.procurement_channels,public.procurement_purchase_types,public.procurement_payment_methods,
  public.procurement_campaign_rules,public.procurement_reception_settlements from anon;
grant select on public.procurement_channels,public.procurement_purchase_types,public.procurement_payment_methods,
  public.procurement_campaign_rules,public.procurement_reception_settlements to authenticated;
grant select on public.procurement_v_pending_receptions,public.procurement_v_purchase_feed,public.procurement_v_reconciliation to authenticated;

commit;
