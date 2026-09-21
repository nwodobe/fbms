-- Warehouse inbound document persistence and Supplier Master-safe controlled correction.

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
  if v_sup.code is null then raise exception 'Supplier Code % inexistant dans Supplier Master',v_code; end if;
  if upper(coalesce(v_sup.statut,''))<>'ACTIF' then raise exception 'Supplier % inactif',v_code; end if;

  v_origin:=btrim(coalesce(p->>'origin',''));
  if v_origin='' then raise exception 'Origin obligatoire'; end if;

  if nullif(p->>'warehouse_id','') is null then raise exception 'Warehouse obligatoire'; end if;
  select * into v_wh from public.wms_warehouses where id=(p->>'warehouse_id')::uuid;
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
    status,created_by,created_by_name,updated_by
  ) values (
    v_id,v_wh.id,v_truck,v_sup.nom,v_sup.code,v_origin,nullif(p->>'purchase_type',''),
    nullif(p->>'reference',''),p_idempotency_key,
    nullif(p->>'expected_kg','')::numeric,nullif(p->>'expected_bags','')::int,v_arr,
    nullif(p->>'driver',''),nullif(p->>'transporter',''),nullif(p->>'weighbridge_ticket',''),nullif(p->>'delivery_note',''),
    'ARRIVED',(c->>'uid')::uuid,c->>'nom',(c->>'uid')::uuid
  ) returning * into r;

  perform public.wms_audit(r.id,'reception',null,
    jsonb_build_object('status',r.status,'truck',r.truck,'warehouse',v_wh.code,'supplier_code',r.supplier_code,
      'expected_kg',r.expected_kg,'delivery_note',r.delivery_note,'weighbridge_ticket',r.weighbridge_ticket),
    'Création réception');
  return to_jsonb(r);
end $$;

create or replace function public.wms_record_offload(p_id text,p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c jsonb; r public.wms_receptions; v_gross numeric; v_tare numeric; v_net numeric;
  v_entered numeric; v_bags int;
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

  perform public.wms_audit(r.id,'offload',to_jsonb('ACCEPTED_WAITING_OFFLOAD'::text),
    jsonb_build_object('status',r.status,'gross_kg',v_gross,'tare_kg',v_tare,'net_kg',v_net,'bags',v_bags),
    'Déchargement / pesée');
  return to_jsonb(r);
end $$;

create or replace function public.wms_correct_reception(p_id text,p_field text,p_value text,p_reason text,p_approver text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c jsonb; r public.wms_receptions; before jsonb; after jsonb; v_sup public.rcn_fournisseurs; v_code text;
begin
  c:=public.wms_require('correction');
  if p_field not in ('expected_kg','expected_bags','truck','supplier_code','origin','driver','transporter','reference','weighbridge_ticket','delivery_note') then
    raise exception 'Champ « % » non corrigeable',p_field;
  end if;
  if coalesce(btrim(p_reason),'')='' or coalesce(btrim(p_approver),'')='' then
    raise exception 'Motif et approbateur obligatoires';
  end if;
  select * into r from public.wms_receptions where id=p_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status='CLOSED' then raise exception 'Dossier clos : correction par transaction contrôlée uniquement'; end if;

  if p_field='supplier_code' then
    before:=jsonb_build_object('supplier_code',r.supplier_code,'supplier_name',r.supplier_name);
    v_code:=upper(btrim(coalesce(p_value,'')));
    select * into v_sup from public.rcn_fournisseurs where code=v_code;
    if v_sup.code is null then raise exception 'Supplier Code % inexistant dans Supplier Master',v_code; end if;
    if upper(coalesce(v_sup.statut,''))<>'ACTIF' then raise exception 'Supplier % inactif',v_code; end if;
    update public.wms_receptions set supplier_code=v_sup.code,supplier_name=v_sup.nom,
      updated_by=(c->>'uid')::uuid,updated_at=now() where id=p_id;
    after:=jsonb_build_object('supplier_code',v_sup.code,'supplier_name',v_sup.nom);
  else
    before:=to_jsonb(r)->p_field;
    if p_field='expected_kg' then
      update public.wms_receptions set expected_kg=nullif(p_value,'')::numeric,updated_by=(c->>'uid')::uuid,updated_at=now() where id=p_id;
    elsif p_field='expected_bags' then
      update public.wms_receptions set expected_bags=nullif(p_value,'')::int,updated_by=(c->>'uid')::uuid,updated_at=now() where id=p_id;
    elsif p_field in ('truck','origin') and coalesce(btrim(p_value),'')='' then
      raise exception '% ne peut pas être vide',p_field;
    else
      execute format('update public.wms_receptions set %I=$1, updated_by=$2, updated_at=now() where id=$3',p_field)
        using p_value,(c->>'uid')::uuid,p_id;
    end if;
    select to_jsonb(x)->p_field into after from public.wms_receptions x where id=p_id;
  end if;

  perform public.wms_audit(p_id,'correction.'||p_field,before,after,p_reason,p_approver);
  return jsonb_build_object('id',p_id,'field',p_field,'before',before,'after',after);
end $$;
