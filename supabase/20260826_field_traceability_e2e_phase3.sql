begin;

alter table public.field_rcn_bags
  add constraint field_rcn_bags_weight_range_chk
  check (net_weight_kg >= 40 and net_weight_kg <= 120) not valid;

create or replace view public.field_lot_bag_control_v
with (security_invoker=true) as
select
  l.id as lot_id,
  l.lot_code,
  l.scope_type,
  l.scope_label,
  l.status as lot_status,
  coalesce(c.contributor_kg,0::numeric) as contributor_kg,
  coalesce(c.purchase_count,0) as purchase_count,
  coalesce(b.bag_count,0) as bag_count,
  coalesce(b.bag_weight_kg,0::numeric) as bag_weight_kg,
  coalesce(c.contributor_kg,0::numeric)-coalesce(b.bag_weight_kg,0::numeric) as unbagged_kg,
  case
    when coalesce(b.bag_count,0)=0 then 'NOT_STARTED'
    when abs(coalesce(c.contributor_kg,0)-coalesce(b.bag_weight_kg,0)) <= 0.01 then 'COMPLETE'
    when coalesce(b.bag_weight_kg,0) < coalesce(c.contributor_kg,0) then 'PARTIAL'
    else 'OVER'
  end as bag_trace_status,
  l.created_at
from public.field_lots l
left join lateral (
  select count(*)::int as purchase_count, coalesce(sum(x.qty_kg),0::numeric) as contributor_kg
  from public.field_lot_contributors x
  where x.lot_id=l.id and x.status='ACTIVE'
) c on true
left join lateral (
  select count(*)::int as bag_count, coalesce(sum(x.net_weight_kg),0::numeric) as bag_weight_kg
  from public.field_rcn_bags x
  where x.lot_id=l.id and x.status<>'VOID'
) b on true;

revoke all on public.field_lot_bag_control_v from anon;
grant select on public.field_lot_bag_control_v to authenticated;

create or replace view public.field_stock_balance_v
with (security_invoker=true) as
with ledger as (
  select
    l.id as lot_id,
    case l.scope_type when 'VILLAGE' then 'VILLAGE' when 'CLUSTER' then 'WAREHOUSE' else 'OTHER' end as location_type,
    l.scope_label as location_label,
    coalesce(sum(c.qty_kg),0::numeric) as qty_kg
  from public.field_lots l
  left join public.field_lot_contributors c on c.lot_id=l.id and c.status='ACTIVE'
  group by l.id,l.scope_type,l.scope_label

  union all

  select m.lot_id,m.from_type,m.from_label,-m.qty_sent_kg
  from public.field_stock_movements m
  where m.status in ('DISPATCHED','RECEIVED')

  union all

  select m.lot_id,m.to_type,m.to_label,m.qty_received_kg
  from public.field_stock_movements m
  where m.status='RECEIVED' and m.qty_received_kg is not null
)
select
  lot_id,
  location_type,
  location_label,
  round(sum(qty_kg),2) as balance_kg
from ledger
group by lot_id,location_type,location_label
having abs(sum(qty_kg)) > 0.01;

revoke all on public.field_stock_balance_v from anon;
grant select on public.field_stock_balance_v to authenticated;

create or replace function public.field_available_stock(
  p_lot_id uuid,
  p_location_type text,
  p_location_label text,
  p_exclude_movement_id uuid default null
)
returns numeric
language sql
stable
security invoker
set search_path=public
as $$
  with ledger as (
    select
      case l.scope_type when 'VILLAGE' then 'VILLAGE' when 'CLUSTER' then 'WAREHOUSE' else 'OTHER' end as location_type,
      l.scope_label as location_label,
      coalesce(sum(c.qty_kg),0::numeric) as qty_kg
    from public.field_lots l
    left join public.field_lot_contributors c on c.lot_id=l.id and c.status='ACTIVE'
    where l.id=p_lot_id
    group by l.scope_type,l.scope_label

    union all

    select m.from_type,m.from_label,-m.qty_sent_kg
    from public.field_stock_movements m
    where m.lot_id=p_lot_id
      and m.status in ('DISPATCHED','RECEIVED')
      and (p_exclude_movement_id is null or m.id<>p_exclude_movement_id)

    union all

    select m.to_type,m.to_label,m.qty_received_kg
    from public.field_stock_movements m
    where m.lot_id=p_lot_id
      and m.status='RECEIVED'
      and m.qty_received_kg is not null
      and (p_exclude_movement_id is null or m.id<>p_exclude_movement_id)
  )
  select coalesce(sum(qty_kg),0::numeric)
  from ledger
  where location_type=p_location_type and lower(btrim(location_label))=lower(btrim(p_location_label));
$$;

revoke all on function public.field_available_stock(uuid,text,text,uuid) from public, anon;
grant execute on function public.field_available_stock(uuid,text,text,uuid) to authenticated;

create or replace function public.field_validate_stock_movement_v2()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_available numeric;
begin
  if new.status='CANCELLED' then
    return new;
  end if;

  if new.from_type=new.to_type and lower(btrim(new.from_label))=lower(btrim(new.to_label)) then
    raise exception 'Origine et destination identiques';
  end if;

  select public.field_available_stock(new.lot_id,new.from_type,new.from_label,new.id)
    into v_available;

  if new.status in ('DISPATCHED','RECEIVED') and new.qty_sent_kg > v_available + 0.01 then
    raise exception 'Stock insuffisant au point de depart: %.2f kg disponibles, %.2f kg demandes', v_available, new.qty_sent_kg;
  end if;

  if new.status='RECEIVED' and new.qty_received_kg is not null and new.qty_received_kg > new.qty_sent_kg + 0.01 then
    raise exception 'Quantite recue %.2f kg > quantite envoyee %.2f kg', new.qty_received_kg, new.qty_sent_kg;
  end if;

  if new.status='RECEIVED'
     and new.qty_received_kg is not null
     and abs(new.qty_sent_kg-new.qty_received_kg) > 0.01
     and nullif(btrim(coalesce(new.variance_reason,'')),'') is null then
    raise exception 'Ecart de poids: motif obligatoire';
  end if;

  return new;
end;
$$;

revoke all on function public.field_validate_stock_movement_v2() from public, anon, authenticated;
drop trigger if exists trg_field_stock_movements_validate_v2 on public.field_stock_movements;
create trigger trg_field_stock_movements_validate_v2
before insert or update of lot_id,from_type,from_label,to_type,to_label,qty_sent_kg,qty_received_kg,status,variance_reason
on public.field_stock_movements
for each row execute function public.field_validate_stock_movement_v2();

create index if not exists field_stock_movements_from_idx
on public.field_stock_movements(lot_id,from_type,from_label,status);
create index if not exists field_stock_movements_to_idx
on public.field_stock_movements(lot_id,to_type,to_label,status);

comment on view public.field_lot_bag_control_v is 'Controle physique lot: poids compose vs sacs RCN identifies.';
comment on view public.field_stock_balance_v is 'Solde RCN par lot et lieu, calcule depuis la composition initiale et les mouvements physiques.';
comment on function public.field_available_stock(uuid,text,text,uuid) is 'Calcule le stock disponible d un lot a un lieu donne avant mouvement.';

commit;
