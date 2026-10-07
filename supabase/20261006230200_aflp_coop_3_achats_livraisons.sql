-- =============================================================================
-- AFLP 2027 · Coopératives — 3/5 : achats, livraisons consolidées, allocations
-- -----------------------------------------------------------------------------
-- MODE A (INDIVIDUAL_FARMER) : ANAGROCI achète au producteur membre.
--   L'achat reste une ligne de public.achats (même chaîne : lot terrain,
--   expédition, réception WMS, LOT, BIN). Il porte désormais son canal
--   (sourcing_channel) et, si le producteur a une affiliation principale ouverte
--   à une coopérative APPROUVEE/ACTIVE pour la campagne, la coopérative, le
--   numéro de membre et la section — renseignés AUTOMATIQUEMENT à l'insertion.
--   Les achats existants restent AFLP_DIRECT (valeur par défaut, vraie pour
--   tous les achats antérieurs à cette migration).
-- MODE B (COOPERATIVE_CONSOLIDATED) : la coopérative est la contrepartie.
--   aflp_coop_deliveries = livraison consolidée, liée au Delivery Plan existant
--   (rcn_proc_arrivages, canal COOPERATIVE) puis à la réception WMS.
--   aflp_coop_delivery_allocations = répartition par producteur membre.
--   Tant que la somme allouée <> poids livré, la livraison est
--   " ALLOCATION À COMPLÉTER " et n'est PAS déclarée entièrement traçable.
-- =============================================================================
begin;

-- --------------------------------------------------------------- achats (additif)
alter table public.achats add column if not exists sourcing_channel text not null default 'AFLP_DIRECT';
alter table public.achats add column if not exists cooperative_id uuid references public.aflp_cooperatives(id);
alter table public.achats add column if not exists coop_membership_id uuid references public.aflp_coop_memberships(id);
alter table public.achats add column if not exists coop_member_number text;
alter table public.achats add column if not exists coop_section_id uuid references public.aflp_coop_sections(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'achats_sourcing_channel_chk') then
    alter table public.achats add constraint achats_sourcing_channel_chk
      check (sourcing_channel in ('AFLP_DIRECT','COOPERATIVE'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'achats_coop_coherent_chk') then
    alter table public.achats add constraint achats_coop_coherent_chk
      check ((sourcing_channel = 'COOPERATIVE') = (cooperative_id is not null));
  end if;
end $$;
create index if not exists achats_cooperative_idx on public.achats(cooperative_id) where cooperative_id is not null;
comment on column public.achats.sourcing_channel is 'Canal AFLP de l''achat : AFLP_DIRECT (Village > RT > Producteur) ou COOPERATIVE (producteur membre, mode A).';

create or replace function private.aflp_achat_canal()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare m record; v_campaign text;
begin
  v_campaign := coalesce(nullif(new.campaign,''), '2027');
  if new.producteur_id is null then
    if new.cooperative_id is not null then raise exception 'Achat coopérative sans producteur identifié'; end if;
    new.sourcing_channel := 'AFLP_DIRECT';
    return new;
  end if;

  if new.cooperative_id is not null then
    -- Canal coopérative demandé explicitement : l'affiliation doit exister.
    select ms.id, ms.member_number, ms.section_id, c.aflp_status into m
    from public.aflp_coop_memberships ms join public.aflp_cooperatives c on c.id = ms.cooperative_id
    where ms.producer_id = new.producteur_id and ms.cooperative_id = new.cooperative_id
      and ms.campaign = v_campaign and ms.status = 'ACTIVE'
    order by ms.is_primary desc limit 1;
    if m.id is null then
      raise exception 'Le producteur % n''a pas d''affiliation ACTIVE à cette coopérative pour la campagne %', new.producteur_id, v_campaign;
    end if;
    if m.aflp_status not in ('APPROUVEE','ACTIVE') then
      raise exception 'Coopérative non active (statut %) : achat au titre de la coopérative refusé', m.aflp_status;
    end if;
  elsif tg_op = 'INSERT' then
    -- Détection automatique : affiliation principale ouverte, coopérative active.
    select ms.id, ms.member_number, ms.section_id, ms.cooperative_id into m
    from public.aflp_coop_memberships ms join public.aflp_cooperatives c on c.id = ms.cooperative_id
    where ms.producer_id = new.producteur_id and ms.campaign = v_campaign and ms.is_primary
      and ms.status = 'ACTIVE' and c.aflp_status in ('APPROUVEE','ACTIVE') and not c.archived and not c.is_qa
    limit 1;
    if m.id is not null then new.cooperative_id := m.cooperative_id; end if;
  end if;

  if new.cooperative_id is not null then
    new.sourcing_channel := 'COOPERATIVE';
    new.coop_membership_id := m.id;
    new.coop_member_number := coalesce(new.coop_member_number, m.member_number);
    new.coop_section_id := coalesce(new.coop_section_id, m.section_id);
  else
    new.sourcing_channel := 'AFLP_DIRECT';
    new.coop_membership_id := null; new.coop_member_number := null; new.coop_section_id := null;
  end if;
  return new;
end $$;
-- Nom en " zz " : s'exécute APRÈS trg_achats_canonicaliser_producteur (ordre alphabétique des triggers BEFORE).
create or replace trigger trg_zz_aflp_achat_canal before insert or update of producteur_id, cooperative_id on public.achats
  for each row execute function private.aflp_achat_canal();

-- ---------------------------------------------------- livraisons consolidées
create sequence if not exists public.aflp_coop_delivery_seq start 1;
create table if not exists public.aflp_coop_deliveries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('LIV-COOP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.aflp_coop_delivery_seq')::text, 5, '0')),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  campaign text not null default '2027' references public.procurement_campaigns(code),
  payment_model text not null check (payment_model in ('INDIVIDUAL_FARMER','COOPERATIVE_CONSOLIDATED')),
  section_id uuid references public.aflp_coop_sections(id),
  collection_point_id uuid references public.aflp_coop_collection_points(id),
  warehouse_id uuid references public.wms_warehouses(id),
  planned_date date,
  planned_kg numeric check (planned_kg is null or planned_kg > 0),
  planned_bags integer check (planned_bags is null or planned_bags >= 0),
  arrival_id text references public.rcn_proc_arrivages(id),
  wms_reception_id text references public.wms_receptions(id),
  delivered_kg numeric check (delivered_kg is null or delivered_kg > 0),
  delivered_bags integer check (delivered_bags is null or delivered_bags >= 0),
  delivered_at timestamptz,
  status text not null default 'PLANIFIEE' check (status in ('PLANIFIEE','EN_ROUTE','RECUE','ANNULEE')),
  cancel_reason text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint aflp_dlv_received check (status <> 'RECUE' or delivered_kg is not null),
  constraint aflp_dlv_cancel check (status <> 'ANNULEE' or nullif(btrim(cancel_reason),'') is not null)
);
comment on table public.aflp_coop_deliveries is
  'Livraison d''une coopérative (Delivery Plan > camion > réception WMS). Reliée au planning Procurement par arrival_id et à la réception par wms_reception_id (ou rcn_proc_arrivages.reception_id).';
create index if not exists aflp_dlv_coop_idx on public.aflp_coop_deliveries(cooperative_id, campaign);
create index if not exists aflp_dlv_arrival_idx on public.aflp_coop_deliveries(arrival_id) where arrival_id is not null;
create index if not exists aflp_dlv_reception_idx on public.aflp_coop_deliveries(wms_reception_id) where wms_reception_id is not null;

create table if not exists public.aflp_coop_delivery_allocations (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.aflp_coop_deliveries(id),
  producer_id text not null references public.producteurs(id),
  membership_id uuid references public.aflp_coop_memberships(id),
  qty_kg numeric not null check (qty_kg > 0),
  bags integer check (bags is null or bags >= 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (delivery_id, producer_id)
);
create index if not exists aflp_alloc_producer_idx on public.aflp_coop_delivery_allocations(producer_id);

create or replace function private.aflp_alloc_guard()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare d public.aflp_coop_deliveries; v_mbr uuid; v_sum numeric; v_ref numeric;
begin
  select * into d from public.aflp_coop_deliveries where id = new.delivery_id for update;
  if d.status = 'ANNULEE' then raise exception 'Livraison annulée : allocation impossible'; end if;
  select ms.id into v_mbr from public.aflp_coop_memberships ms
   where ms.producer_id = new.producer_id and ms.cooperative_id = d.cooperative_id and ms.campaign = d.campaign
     and ms.status in ('ACTIVE','SUSPENDED','ENDED')
   order by (ms.status = 'ACTIVE') desc, ms.membership_start desc limit 1;
  if v_mbr is null then
    raise exception 'Producteur % non membre de la coopérative pour la campagne % : allocation refusée', new.producer_id, d.campaign;
  end if;
  new.membership_id := coalesce(new.membership_id, v_mbr);
  v_ref := coalesce(d.delivered_kg, d.planned_kg);
  select coalesce(sum(qty_kg),0) into v_sum from public.aflp_coop_delivery_allocations
   where delivery_id = new.delivery_id and id <> new.id;
  if v_ref is not null and v_sum + new.qty_kg > v_ref + 0.001 then
    raise exception 'Allocation supérieure au poids de la livraison (% kg alloués pour % kg)', v_sum + new.qty_kg, v_ref;
  end if;
  return new;
end $$;
create or replace trigger trg_aflp_alloc_guard before insert or update on public.aflp_coop_delivery_allocations
  for each row execute function private.aflp_alloc_guard();

-- Une livraison ne peut pas descendre sous ce qui est déjà alloué.
create or replace function private.aflp_dlv_guard()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_sum numeric;
begin
  select coalesce(sum(qty_kg),0) into v_sum from public.aflp_coop_delivery_allocations where delivery_id = new.id;
  if v_sum > coalesce(new.delivered_kg, new.planned_kg, v_sum) + 0.001 then
    raise exception 'Poids livré (% kg) inférieur au total déjà alloué (% kg)', coalesce(new.delivered_kg, new.planned_kg), v_sum;
  end if;
  return new;
end $$;
create or replace trigger trg_aflp_dlv_guard before update on public.aflp_coop_deliveries
  for each row execute function private.aflp_dlv_guard();

-- audit + interdiction de suppression
create or replace trigger trg_aflp_audit after insert or update or delete on public.aflp_coop_deliveries
  for each row execute function private.aflp_coop_audit_trigger();
create or replace trigger trg_aflp_no_delete before delete on public.aflp_coop_deliveries
  for each row execute function private.aflp_coop_block_delete();
create or replace trigger trg_aflp_touch before update on public.aflp_coop_deliveries
  for each row execute function private.aflp_coop_touch();

create or replace function private.aflp_alloc_audit()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_coop uuid;
begin
  select cooperative_id into v_coop from public.aflp_coop_deliveries where id = coalesce(new.delivery_id, old.delivery_id);
  insert into public.aflp_coop_audit(cooperative_id, entity, entity_id, operation, before_data, after_data, actor_id, actor_email, actor_role)
  values (v_coop, tg_table_name, coalesce(new.id, old.id)::text, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid(), public.fbms_email(), public.fbms_role());
  return coalesce(new, old);
end $$;
create or replace trigger trg_aflp_audit after insert or update or delete on public.aflp_coop_delivery_allocations
  for each row execute function private.aflp_alloc_audit();

alter table public.aflp_coop_deliveries enable row level security;
alter table public.aflp_coop_delivery_allocations enable row level security;
drop policy if exists aflp_dlv_sel on public.aflp_coop_deliveries;
create policy aflp_dlv_sel on public.aflp_coop_deliveries for select to authenticated using (private.aflp_coop_can_read(cooperative_id));
drop policy if exists aflp_dlv_ins on public.aflp_coop_deliveries;
create policy aflp_dlv_ins on public.aflp_coop_deliveries for insert to authenticated with check (private.aflp_coop_can_edit(cooperative_id));
drop policy if exists aflp_dlv_upd on public.aflp_coop_deliveries;
create policy aflp_dlv_upd on public.aflp_coop_deliveries for update to authenticated
  using (private.aflp_coop_can_edit(cooperative_id)) with check (private.aflp_coop_can_edit(cooperative_id));

drop policy if exists aflp_alloc_sel on public.aflp_coop_delivery_allocations;
create policy aflp_alloc_sel on public.aflp_coop_delivery_allocations for select to authenticated
  using (private.farmer_registry_can_access_producteur(producer_id)
         and exists (select 1 from public.aflp_coop_deliveries d where d.id = delivery_id and private.aflp_coop_can_read(d.cooperative_id)));
drop policy if exists aflp_alloc_ins on public.aflp_coop_delivery_allocations;
create policy aflp_alloc_ins on public.aflp_coop_delivery_allocations for insert to authenticated
  with check (private.farmer_registry_can_access_producteur(producer_id)
              and exists (select 1 from public.aflp_coop_deliveries d where d.id = delivery_id and private.aflp_coop_can_edit(d.cooperative_id)));
drop policy if exists aflp_alloc_upd on public.aflp_coop_delivery_allocations;
create policy aflp_alloc_upd on public.aflp_coop_delivery_allocations for update to authenticated
  using (exists (select 1 from public.aflp_coop_deliveries d where d.id = delivery_id and private.aflp_coop_can_edit(d.cooperative_id)))
  with check (exists (select 1 from public.aflp_coop_deliveries d where d.id = delivery_id and private.aflp_coop_can_edit(d.cooperative_id)));
-- correction d'une allocation erronée tant que la livraison n'est pas reçue
drop policy if exists aflp_alloc_del on public.aflp_coop_delivery_allocations;
create policy aflp_alloc_del on public.aflp_coop_delivery_allocations for delete to authenticated
  using (exists (select 1 from public.aflp_coop_deliveries d where d.id = delivery_id and d.status <> 'RECUE'
                 and private.aflp_coop_can_edit(d.cooperative_id)));

grant select, insert, update on public.aflp_coop_deliveries to authenticated;
grant select, insert, update, delete on public.aflp_coop_delivery_allocations to authenticated;
grant usage on sequence public.aflp_coop_delivery_seq to authenticated;
revoke all on public.aflp_coop_deliveries, public.aflp_coop_delivery_allocations from anon;

commit;
