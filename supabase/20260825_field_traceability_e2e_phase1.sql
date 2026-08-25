begin;

create table public.field_purchase_sources (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  achat_id uuid not null references public.achats(id) on update restrict on delete restrict,
  plot_id uuid not null references public.farmer_plots(id) on update restrict on delete restrict,
  qty_kg numeric not null check (qty_kg > 0),
  source_type text not null default 'DECLARED' check (source_type in ('DECLARED','ESTIMATED','VERIFIED')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  record_version bigint not null default 1 check (record_version > 0),
  unique (achat_id, plot_id)
);

create table public.field_lots (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  lot_code text not null unique check (btrim(lot_code) <> ''),
  scope_type text not null check (scope_type in ('VILLAGE','CLUSTER','MIXED')),
  scope_id text,
  scope_label text not null check (btrim(scope_label) <> ''),
  status text not null default 'FORMING' check (status in ('FORMING','SEALED','IN_STOCK','IN_TRANSIT','RECEIVED','CLOSED','CANCELLED')),
  sealed_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  record_version bigint not null default 1 check (record_version > 0),
  check (status in ('FORMING','CANCELLED') or sealed_at is not null),
  check (status <> 'CLOSED' or closed_at is not null)
);

create table public.field_lot_contributors (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  lot_id uuid not null references public.field_lots(id) on update restrict on delete restrict,
  achat_id uuid not null references public.achats(id) on update restrict on delete restrict,
  qty_kg numeric not null check (qty_kg > 0),
  bag_count integer check (bag_count is null or bag_count >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CANCELLED')),
  cancellation_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  record_version bigint not null default 1 check (record_version > 0),
  unique (lot_id, achat_id),
  check (status <> 'CANCELLED' or nullif(btrim(coalesce(cancellation_reason,'')),'') is not null)
);

create table public.field_rcn_bags (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  bag_code text not null unique check (btrim(bag_code) <> ''),
  seal_number text unique,
  achat_id uuid not null references public.achats(id) on update restrict on delete restrict,
  lot_id uuid references public.field_lots(id) on update restrict on delete restrict,
  sacherie_movement_id uuid references public.sacs_mouvements(id) on update restrict on delete restrict,
  net_weight_kg numeric not null check (net_weight_kg > 0),
  status text not null default 'FILLED' check (status in ('FILLED','IN_LOT','IN_STOCK','IN_TRANSIT','RECEIVED','VOID')),
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  record_version bigint not null default 1 check (record_version > 0),
  check (status <> 'VOID' or nullif(btrim(coalesce(void_reason,'')),'') is not null)
);

create table public.field_shipments (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  shipment_code text not null unique check (btrim(shipment_code) <> ''),
  origin_type text not null check (origin_type in ('VILLAGE','WAREHOUSE','BOUAKE_WAREHOUSE','OTHER')),
  origin_id text,
  origin_label text not null check (btrim(origin_label) <> ''),
  destination_type text not null check (destination_type in ('WAREHOUSE','FACTORY','OTHER')),
  destination_id text,
  destination_label text not null check (btrim(destination_label) <> ''),
  vehicle_plate text,
  driver_name text,
  planned_qty_kg numeric check (planned_qty_kg is null or planned_qty_kg > 0),
  dispatched_qty_kg numeric check (dispatched_qty_kg is null or dispatched_qty_kg >= 0),
  received_qty_kg numeric check (received_qty_kg is null or received_qty_kg >= 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','LOADING','DISPATCHED','RECEIVED','CLOSED','CANCELLED')),
  departed_at timestamptz,
  arrived_at timestamptz,
  reception_id text unique references public.rcn_receptions(id) on update restrict on delete restrict,
  document_ref text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  record_version bigint not null default 1 check (record_version > 0),
  check (status in ('DRAFT','LOADING','CANCELLED') or departed_at is not null),
  check (status not in ('RECEIVED','CLOSED') or (arrived_at is not null and reception_id is not null)),
  check (status in ('DRAFT','CANCELLED') or nullif(btrim(coalesce(vehicle_plate,'')),'') is not null)
);

create table public.field_shipment_lots (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  shipment_id uuid not null references public.field_shipments(id) on update restrict on delete restrict,
  lot_id uuid not null references public.field_lots(id) on update restrict on delete restrict,
  planned_qty_kg numeric check (planned_qty_kg is null or planned_qty_kg > 0),
  loaded_qty_kg numeric check (loaded_qty_kg is null or loaded_qty_kg > 0),
  received_qty_kg numeric check (received_qty_kg is null or received_qty_kg >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  record_version bigint not null default 1 check (record_version > 0),
  unique (shipment_id, lot_id)
);

create table public.field_stock_movements (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  movement_code text not null unique check (btrim(movement_code) <> ''),
  lot_id uuid not null references public.field_lots(id) on update restrict on delete restrict,
  shipment_id uuid references public.field_shipments(id) on update restrict on delete restrict,
  movement_type text not null check (movement_type in ('VILLAGE_TO_WAREHOUSE','WAREHOUSE_TO_WAREHOUSE','WAREHOUSE_TO_FACTORY','FACTORY_RECEIPT','ADJUSTMENT','RETURN')),
  from_type text not null check (from_type in ('VILLAGE','WAREHOUSE','TRUCK','FACTORY','OTHER')),
  from_id text,
  from_label text not null check (btrim(from_label) <> ''),
  to_type text not null check (to_type in ('VILLAGE','WAREHOUSE','TRUCK','FACTORY','OTHER')),
  to_id text,
  to_label text not null check (btrim(to_label) <> ''),
  qty_sent_kg numeric not null check (qty_sent_kg > 0),
  qty_received_kg numeric check (qty_received_kg is null or qty_received_kg >= 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','DISPATCHED','RECEIVED','CANCELLED')),
  departed_at timestamptz,
  received_at timestamptz,
  variance_reason text,
  document_ref text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  record_version bigint not null default 1 check (record_version > 0),
  check (status in ('DRAFT','CANCELLED') or departed_at is not null),
  check (status <> 'RECEIVED' or (received_at is not null and qty_received_kg is not null))
);

create index field_purchase_sources_achat_idx on public.field_purchase_sources(achat_id);
create index field_purchase_sources_plot_idx on public.field_purchase_sources(plot_id);
create index field_lot_contributors_lot_idx on public.field_lot_contributors(lot_id) where status='ACTIVE';
create index field_lot_contributors_achat_idx on public.field_lot_contributors(achat_id) where status='ACTIVE';
create index field_rcn_bags_achat_idx on public.field_rcn_bags(achat_id);
create index field_rcn_bags_lot_idx on public.field_rcn_bags(lot_id) where lot_id is not null;
create index field_rcn_bags_sacherie_idx on public.field_rcn_bags(sacherie_movement_id) where sacherie_movement_id is not null;
create index field_shipments_status_idx on public.field_shipments(status);
create index field_shipments_reception_idx on public.field_shipments(reception_id) where reception_id is not null;
create index field_shipment_lots_lot_idx on public.field_shipment_lots(lot_id);
create index field_stock_movements_lot_idx on public.field_stock_movements(lot_id);
create index field_stock_movements_shipment_idx on public.field_stock_movements(shipment_id) where shipment_id is not null;

create or replace function public.field_traceability_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.record_version := old.record_version + 1;
  return new;
end;
$$;
revoke all on function public.field_traceability_touch() from public, anon, authenticated;

create trigger trg_field_purchase_sources_touch before update on public.field_purchase_sources for each row execute function public.field_traceability_touch();
create trigger trg_field_lots_touch before update on public.field_lots for each row execute function public.field_traceability_touch();
create trigger trg_field_lot_contributors_touch before update on public.field_lot_contributors for each row execute function public.field_traceability_touch();
create trigger trg_field_rcn_bags_touch before update on public.field_rcn_bags for each row execute function public.field_traceability_touch();
create trigger trg_field_shipments_touch before update on public.field_shipments for each row execute function public.field_traceability_touch();
create trigger trg_field_shipment_lots_touch before update on public.field_shipment_lots for each row execute function public.field_traceability_touch();
create trigger trg_field_stock_movements_touch before update on public.field_stock_movements for each row execute function public.field_traceability_touch();

create or replace function public.field_validate_purchase_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_purchase_producteur text;
  v_plot_producteur text;
  v_purchase_kg numeric;
  v_other_kg numeric;
begin
  select a.producteur_id, a.poids_net into v_purchase_producteur, v_purchase_kg from public.achats a where a.id = new.achat_id;
  if v_purchase_producteur is null then raise exception 'Achat % sans producteur canonique: source parcelle interdite', new.achat_id; end if;
  select fp.producteur_id into v_plot_producteur from public.farmer_plots fp where fp.id = new.plot_id and not fp.deleted and fp.status = 'ACTIVE';
  if v_plot_producteur is null then raise exception 'Parcelle % introuvable ou inactive', new.plot_id; end if;
  if v_plot_producteur <> v_purchase_producteur then raise exception 'Parcelle % et achat % appartiennent a des producteurs differents', new.plot_id, new.achat_id; end if;
  select coalesce(sum(s.qty_kg),0) into v_other_kg from public.field_purchase_sources s where s.achat_id = new.achat_id and s.id <> new.id;
  if v_other_kg + new.qty_kg > v_purchase_kg + 0.01 then raise exception 'Allocation parcelles %.2f kg > poids achat %.2f kg', v_other_kg + new.qty_kg, v_purchase_kg; end if;
  return new;
end;
$$;
revoke all on function public.field_validate_purchase_source() from public, anon, authenticated;
create trigger trg_field_purchase_sources_validate before insert or update of achat_id, plot_id, qty_kg on public.field_purchase_sources for each row execute function public.field_validate_purchase_source();

create or replace function public.field_validate_lot_contributor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_purchase_producteur text;
  v_purchase_kg numeric;
  v_other_kg numeric;
begin
  if new.status = 'CANCELLED' then return new; end if;
  select a.producteur_id, a.poids_net into v_purchase_producteur, v_purchase_kg from public.achats a where a.id = new.achat_id;
  if v_purchase_producteur is null then raise exception 'Achat % sans producteur canonique: contribution lot interdite', new.achat_id; end if;
  select coalesce(sum(c.qty_kg),0) into v_other_kg from public.field_lot_contributors c where c.achat_id = new.achat_id and c.status = 'ACTIVE' and c.id <> new.id;
  if v_other_kg + new.qty_kg > v_purchase_kg + 0.01 then raise exception 'Contributions lots %.2f kg > poids achat %.2f kg', v_other_kg + new.qty_kg, v_purchase_kg; end if;
  return new;
end;
$$;
revoke all on function public.field_validate_lot_contributor() from public, anon, authenticated;
create trigger trg_field_lot_contributors_validate before insert or update of achat_id, qty_kg, status on public.field_lot_contributors for each row execute function public.field_validate_lot_contributor();

create or replace function public.field_validate_rcn_bag()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_purchase_producteur text;
  v_purchase_kg numeric;
  v_other_kg numeric;
  v_link_exists boolean;
begin
  select a.producteur_id, a.poids_net into v_purchase_producteur, v_purchase_kg from public.achats a where a.id = new.achat_id;
  if v_purchase_producteur is null then raise exception 'Achat % sans producteur canonique: sac RCN interdit', new.achat_id; end if;
  select coalesce(sum(b.net_weight_kg),0) into v_other_kg from public.field_rcn_bags b where b.achat_id = new.achat_id and b.status <> 'VOID' and b.id <> new.id;
  if new.status <> 'VOID' and v_other_kg + new.net_weight_kg > v_purchase_kg + 0.01 then raise exception 'Poids sacs %.2f kg > poids achat %.2f kg', v_other_kg + new.net_weight_kg, v_purchase_kg; end if;
  if new.lot_id is not null and new.status <> 'VOID' then
    select exists(select 1 from public.field_lot_contributors c where c.lot_id = new.lot_id and c.achat_id = new.achat_id and c.status='ACTIVE') into v_link_exists;
    if not v_link_exists then raise exception 'Le lot % ne contient pas encore l achat %', new.lot_id, new.achat_id; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.field_validate_rcn_bag() from public, anon, authenticated;
create trigger trg_field_rcn_bags_validate before insert or update of achat_id, lot_id, net_weight_kg, status on public.field_rcn_bags for each row execute function public.field_validate_rcn_bag();

create or replace function public.field_validate_shipment_lot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lot_kg numeric;
  v_other_loaded numeric;
begin
  select coalesce(sum(c.qty_kg),0) into v_lot_kg from public.field_lot_contributors c where c.lot_id = new.lot_id and c.status='ACTIVE';
  if v_lot_kg <= 0 then raise exception 'Lot % sans contributeur actif: expedition interdite', new.lot_id; end if;
  if new.loaded_qty_kg is not null then
    select coalesce(sum(sl.loaded_qty_kg),0) into v_other_loaded from public.field_shipment_lots sl join public.field_shipments s on s.id = sl.shipment_id where sl.lot_id = new.lot_id and sl.id <> new.id and s.status <> 'CANCELLED';
    if v_other_loaded + new.loaded_qty_kg > v_lot_kg + 0.01 then raise exception 'Quantite expediee %.2f kg > composition lot %.2f kg', v_other_loaded + new.loaded_qty_kg, v_lot_kg; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.field_validate_shipment_lot() from public, anon, authenticated;
create trigger trg_field_shipment_lots_validate before insert or update of lot_id, loaded_qty_kg on public.field_shipment_lots for each row execute function public.field_validate_shipment_lot();

create or replace function public.field_validate_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.shipment_id is not null and not exists (select 1 from public.field_shipment_lots sl where sl.shipment_id = new.shipment_id and sl.lot_id = new.lot_id) then
    raise exception 'Le lot % n appartient pas a l expedition %', new.lot_id, new.shipment_id;
  end if;
  return new;
end;
$$;
revoke all on function public.field_validate_stock_movement() from public, anon, authenticated;
create trigger trg_field_stock_movements_validate before insert or update of lot_id, shipment_id on public.field_stock_movements for each row execute function public.field_validate_stock_movement();

alter table public.field_purchase_sources enable row level security;
alter table public.field_lots enable row level security;
alter table public.field_lot_contributors enable row level security;
alter table public.field_rcn_bags enable row level security;
alter table public.field_shipments enable row level security;
alter table public.field_shipment_lots enable row level security;
alter table public.field_stock_movements enable row level security;

revoke all on public.field_purchase_sources, public.field_lots, public.field_lot_contributors, public.field_rcn_bags, public.field_shipments, public.field_shipment_lots, public.field_stock_movements from anon;
grant select, insert, update, delete on public.field_purchase_sources, public.field_lots, public.field_lot_contributors, public.field_rcn_bags, public.field_shipments, public.field_shipment_lots, public.field_stock_movements to authenticated;

create policy field_purchase_sources_sel on public.field_purchase_sources for select to authenticated using (public.est_actif());
create policy field_purchase_sources_ins on public.field_purchase_sources for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy field_purchase_sources_upd on public.field_purchase_sources for update to authenticated using (public.est_actif()) with check (public.est_actif());
create policy field_purchase_sources_del on public.field_purchase_sources for delete to authenticated using (public.est_bm());
create policy field_lots_sel on public.field_lots for select to authenticated using (public.est_actif());
create policy field_lots_ins on public.field_lots for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy field_lots_upd on public.field_lots for update to authenticated using (public.est_actif()) with check (public.est_actif());
create policy field_lots_del on public.field_lots for delete to authenticated using (public.est_bm());
create policy field_lot_contributors_sel on public.field_lot_contributors for select to authenticated using (public.est_actif());
create policy field_lot_contributors_ins on public.field_lot_contributors for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy field_lot_contributors_upd on public.field_lot_contributors for update to authenticated using (public.est_actif()) with check (public.est_actif());
create policy field_lot_contributors_del on public.field_lot_contributors for delete to authenticated using (public.est_bm());
create policy field_rcn_bags_sel on public.field_rcn_bags for select to authenticated using (public.est_actif());
create policy field_rcn_bags_ins on public.field_rcn_bags for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy field_rcn_bags_upd on public.field_rcn_bags for update to authenticated using (public.est_actif()) with check (public.est_actif());
create policy field_rcn_bags_del on public.field_rcn_bags for delete to authenticated using (public.est_bm());
create policy field_shipments_sel on public.field_shipments for select to authenticated using (public.est_actif());
create policy field_shipments_ins on public.field_shipments for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy field_shipments_upd on public.field_shipments for update to authenticated using (public.est_actif()) with check (public.est_actif());
create policy field_shipments_del on public.field_shipments for delete to authenticated using (public.est_bm());
create policy field_shipment_lots_sel on public.field_shipment_lots for select to authenticated using (public.est_actif());
create policy field_shipment_lots_ins on public.field_shipment_lots for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy field_shipment_lots_upd on public.field_shipment_lots for update to authenticated using (public.est_actif()) with check (public.est_actif());
create policy field_shipment_lots_del on public.field_shipment_lots for delete to authenticated using (public.est_bm());
create policy field_stock_movements_sel on public.field_stock_movements for select to authenticated using (public.est_actif());
create policy field_stock_movements_ins on public.field_stock_movements for insert to authenticated with check (public.est_actif() and created_by = auth.uid());
create policy field_stock_movements_upd on public.field_stock_movements for update to authenticated using (public.est_actif()) with check (public.est_actif());
create policy field_stock_movements_del on public.field_stock_movements for delete to authenticated using (public.est_bm());

create view public.field_traceability_chain_v with (security_invoker=true) as
select
  p.id as producteur_id,
  p.code as farmer_id,
  p.nom as producteur_nom,
  p.prenoms as producteur_prenoms,
  a.id as achat_id,
  a.local_id as achat_local_id,
  a.date as achat_date,
  a.poids_net as achat_poids_net_kg,
  c.qty_kg as lot_contribution_kg,
  fl.id as field_lot_id,
  fl.lot_code,
  fl.status as lot_status,
  coalesce(ps.plot_sources, '[]'::jsonb) as plot_sources,
  coalesce(bg.bags, '[]'::jsonb) as bags,
  sl.shipment_id,
  fs.shipment_code,
  fs.status as shipment_status,
  fs.origin_label,
  fs.destination_label,
  fs.vehicle_plate,
  sl.loaded_qty_kg,
  sl.received_qty_kg,
  fs.reception_id,
  rl.id as factory_lot_id
from public.field_lot_contributors c
join public.field_lots fl on fl.id = c.lot_id
join public.achats a on a.id = c.achat_id
left join public.producteurs p on p.id = a.producteur_id
left join lateral (
  select jsonb_agg(jsonb_build_object('plot_id', s.plot_id, 'qty_kg', s.qty_kg, 'source_type', s.source_type) order by s.created_at) as plot_sources
  from public.field_purchase_sources s where s.achat_id = a.id
) ps on true
left join lateral (
  select jsonb_agg(jsonb_build_object('bag_code', b.bag_code, 'seal_number', b.seal_number, 'net_weight_kg', b.net_weight_kg, 'status', b.status) order by b.bag_code) as bags
  from public.field_rcn_bags b where b.achat_id = a.id and b.lot_id = fl.id and b.status <> 'VOID'
) bg on true
left join public.field_shipment_lots sl on sl.lot_id = fl.id
left join public.field_shipments fs on fs.id = sl.shipment_id and fs.status <> 'CANCELLED'
left join public.rcn_lots rl on rl.reception_id = fs.reception_id
where c.status = 'ACTIVE';

revoke all on public.field_traceability_chain_v from anon;
grant select on public.field_traceability_chain_v to authenticated;

comment on table public.field_purchase_sources is 'Allocation d un achat terrain a une ou plusieurs parcelles Farmer Registry.';
comment on table public.field_rcn_bags is 'Sacs RCN remplis et identifies; distincts du ledger de sacherie vide sacs_mouvements.';
comment on table public.field_lots is 'Lots terrain RCN avant reception usine.';
comment on table public.field_lot_contributors is 'Composition d un lot terrain par achats, conservant la provenance producteur.';
comment on table public.field_shipments is 'Expeditions terrain/entrepot vers destination, avec pont optionnel vers rcn_receptions.';
comment on table public.field_shipment_lots is 'Composition d une expedition par lots terrain.';
comment on table public.field_stock_movements is 'Mouvements physiques de RCN terrain, distincts des mouvements de sacherie vide.';
comment on view public.field_traceability_chain_v is 'Chaine E2E Producteur -> Parcelle(s) -> Achat -> Lot terrain -> Shipment -> Reception usine -> Lot RCN.';

commit;
