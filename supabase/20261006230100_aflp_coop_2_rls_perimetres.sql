-- =============================================================================
-- AFLP 2027 · Coopératives — 2/5 : périmètres et RLS
-- -----------------------------------------------------------------------------
-- Lecture d'une coopérative :
--   * autorité GLOBAL (BM, ABM, Head of Field, Procurement Officer) et Zonal Head
--     (portée terrain globale, décision du 17/09/2026) > toutes ;
--   * rôles transverses Procurement / Finance / Warehouse / Factory / Audit >
--     la fiche ORGANISATION (pas les affiliations nominatives) ;
--   * Unit Head / Supervisor / RT / Agent Recenseur > si la coopérative est dans
--     leur cluster OU couvre un village de leur périmètre
--     (private.farmer_registry_can_access_village, la même serrure que le
--     Farmer Registry).
-- Affiliations producteur : lecture seulement si le producteur est lisible
--   (private.farmer_registry_can_access_producteur). Finance / Warehouse ne
--   voient donc que des agrégats (fonctions de synthèse, sans nom ni téléphone).
-- Écriture : rôles terrain d'encadrement, dans leur périmètre. Changement de
--   statut vers APPROUVEE/ACTIVE et targets : direction (BM, ABM, Head of Field).
-- Aucune politique DELETE : la suppression physique est en plus bloquée par
-- trigger (archivage uniquement).
-- =============================================================================
begin;

create or replace function private.aflp_coop_roles_transverses() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['General Manager','Finance','Finance Manager','LBA Purchase Officer','Warehouse Manager',
               'Storekeeper','QA / Lab','Factory User','Viewer / Auditor','Consultation uniquement',
               'Field Buying Operations Officer','Coordination']
$$;

create or replace function private.aflp_coop_roles_editeurs() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Zonal Head',
               'Field Buying Operations Officer','Unit Head','Assistant Unit Head','Supervisor','Administrateur']
$$;

create or replace function private.aflp_coop_roles_direction() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array['Branch Manager','Assistant Branch Manager','Head of Field','Administrateur']
$$;

create or replace function private.aflp_coop_scope_global() returns boolean
language sql stable security definer set search_path = public, private as $$
  select public.est_actif() and (
    coalesce(private.farmer_registry_authority(), '') = 'GLOBAL'
    or public.portee_terrain_globale()
    or public.mon_role() = 'Administrateur')
$$;

create or replace function private.aflp_coop_can_read(p_coop uuid) returns boolean
language plpgsql stable security definer set search_path = public, private as $$
declare v_cluster text; v_zone text; p public.profils%rowtype;
begin
  if not public.est_actif() then return false; end if;
  if private.aflp_coop_scope_global() then return true; end if;
  if public.mon_role() = any(private.aflp_coop_roles_transverses()) then return true; end if;
  select c.cluster_code, k.zone_code into v_cluster, v_zone
  from public.aflp_cooperatives c left join public.aflp_clusters k on k.code = c.cluster_code
  where c.id = p_coop;
  select * into p from public.profils where user_id = auth.uid() and actif limit 1;
  if v_cluster is not null and p.village_id is null then
    if p.cluster is not null and public.farmer_registry_norm_text(p.cluster) = public.farmer_registry_norm_text(v_cluster) then return true; end if;
    if p.zone is not null and public.farmer_registry_norm_text(p.zone) in
       (public.farmer_registry_norm_text(v_zone),
        public.farmer_registry_norm_text((select label from public.aflp_zones where code = v_zone))) then return true; end if;
  end if;
  return exists (select 1 from public.aflp_coop_villages cv
                 where cv.cooperative_id = p_coop and cv.active and cv.village_id is not null
                   and private.farmer_registry_can_access_village(cv.village_id, p.rt_id));
end $$;

create or replace function private.aflp_coop_can_edit(p_coop uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select public.mon_role() = any(private.aflp_coop_roles_editeurs())
     and (p_coop is null or private.aflp_coop_can_read(p_coop))
$$;

create or replace function private.aflp_coop_is_direction() returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(public.mon_role() = any(private.aflp_coop_roles_direction()), false)
$$;

-- Garde serveur : statut d'approbation, target et archivage réservés à la direction.
create or replace function private.aflp_coop_guard_direction()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null then return new; end if; -- maintenance (service role)
  if tg_table_name = 'aflp_cooperatives' then
    if (tg_op = 'INSERT' and new.aflp_status in ('APPROUVEE','ACTIVE'))
       or (tg_op = 'UPDATE' and new.aflp_status is distinct from old.aflp_status and new.aflp_status in ('APPROUVEE','ACTIVE'))
       or (tg_op = 'UPDATE' and new.archived is distinct from old.archived) then
      if not private.aflp_coop_is_direction() then
        raise exception 'Approbation, activation et archivage d''une coopérative : Branch Manager, Assistant Branch Manager ou Head of Field.'
          using errcode = '42501';
      end if;
    end if;
  elsif tg_table_name = 'aflp_coop_campaigns' then
    if (tg_op = 'INSERT' and new.target_mt is not null)
       or (tg_op = 'UPDATE' and new.target_mt is distinct from old.target_mt) then
      if not private.aflp_coop_is_direction() then
        raise exception 'La target AFLP d''une coopérative est fixée par la direction (BM, ABM, Head of Field).'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create or replace trigger trg_aflp_guard_direction before insert or update on public.aflp_cooperatives
  for each row execute function private.aflp_coop_guard_direction();
create or replace trigger trg_aflp_guard_direction before insert or update on public.aflp_coop_campaigns
  for each row execute function private.aflp_coop_guard_direction();

-- ------------------------------------------------------------------- RLS tables
alter table public.aflp_cooperatives enable row level security;
alter table public.aflp_coop_campaigns enable row level security;
alter table public.aflp_coop_collection_points enable row level security;
alter table public.aflp_coop_sections enable row level security;
alter table public.aflp_coop_villages enable row level security;
alter table public.aflp_coop_contacts enable row level security;
alter table public.aflp_coop_memberships enable row level security;
alter table public.aflp_producer_enrollment enable row level security;
alter table public.aflp_coop_documents enable row level security;
alter table public.aflp_coop_audit enable row level security;

-- Coopérative
drop policy if exists aflp_coop_sel on public.aflp_cooperatives;
create policy aflp_coop_sel on public.aflp_cooperatives for select to authenticated
  using (private.aflp_coop_can_read(id));
drop policy if exists aflp_coop_ins on public.aflp_cooperatives;
create policy aflp_coop_ins on public.aflp_cooperatives for insert to authenticated
  with check (private.aflp_coop_can_edit(null));
drop policy if exists aflp_coop_upd on public.aflp_cooperatives;
create policy aflp_coop_upd on public.aflp_cooperatives for update to authenticated
  using (private.aflp_coop_can_edit(id)) with check (private.aflp_coop_can_edit(id));

-- Tables filles " organisation " : même règle que la coopérative.
do $$ declare t text; begin
  foreach t in array array['aflp_coop_campaigns','aflp_coop_collection_points','aflp_coop_sections','aflp_coop_villages','aflp_coop_documents'] loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.aflp_coop_can_read(cooperative_id))', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.aflp_coop_can_edit(cooperative_id))', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.aflp_coop_can_edit(cooperative_id)) with check (private.aflp_coop_can_edit(cooperative_id))', t||'_upd', t);
  end loop;
end $$;

-- Contacts : données personnelles des dirigeants, pas pour Warehouse / Factory / QA.
drop policy if exists aflp_coop_contacts_sel on public.aflp_coop_contacts;
create policy aflp_coop_contacts_sel on public.aflp_coop_contacts for select to authenticated
  using (private.aflp_coop_can_read(cooperative_id)
         and coalesce(public.mon_role(),'') not in ('Warehouse Manager','Storekeeper','QA / Lab','Factory User'));
drop policy if exists aflp_coop_contacts_ins on public.aflp_coop_contacts;
create policy aflp_coop_contacts_ins on public.aflp_coop_contacts for insert to authenticated
  with check (private.aflp_coop_can_edit(cooperative_id));
drop policy if exists aflp_coop_contacts_upd on public.aflp_coop_contacts;
create policy aflp_coop_contacts_upd on public.aflp_coop_contacts for update to authenticated
  using (private.aflp_coop_can_edit(cooperative_id)) with check (private.aflp_coop_can_edit(cooperative_id));

-- Affiliations : producteur lisible ET coopérative lisible.
drop policy if exists aflp_mbr_sel on public.aflp_coop_memberships;
create policy aflp_mbr_sel on public.aflp_coop_memberships for select to authenticated
  using (private.aflp_coop_can_read(cooperative_id) and private.farmer_registry_can_access_producteur(producer_id));
drop policy if exists aflp_mbr_ins on public.aflp_coop_memberships;
create policy aflp_mbr_ins on public.aflp_coop_memberships for insert to authenticated
  with check ((private.aflp_coop_can_edit(cooperative_id) or public.peut_modifier_rt_producteur())
              and private.aflp_coop_can_read(cooperative_id)
              and private.farmer_registry_can_access_producteur(producer_id));
drop policy if exists aflp_mbr_upd on public.aflp_coop_memberships;
create policy aflp_mbr_upd on public.aflp_coop_memberships for update to authenticated
  using ((private.aflp_coop_can_edit(cooperative_id) or public.peut_modifier_rt_producteur())
         and private.farmer_registry_can_access_producteur(producer_id))
  with check ((private.aflp_coop_can_edit(cooperative_id) or public.peut_modifier_rt_producteur())
              and private.farmer_registry_can_access_producteur(producer_id));

drop policy if exists aflp_enr_sel on public.aflp_producer_enrollment;
create policy aflp_enr_sel on public.aflp_producer_enrollment for select to authenticated
  using (private.farmer_registry_can_access_producteur(producer_id));
-- écriture uniquement par les RPC (security definer) : pas de politique INSERT/UPDATE.

drop policy if exists aflp_coop_audit_sel on public.aflp_coop_audit;
create policy aflp_coop_audit_sel on public.aflp_coop_audit for select to authenticated
  using (cooperative_id is not null and private.aflp_coop_can_read(cooperative_id)
         and coalesce(public.mon_role(),'') not in ('Warehouse Manager','Storekeeper','QA / Lab','Factory User'));

grant select, insert, update on public.aflp_cooperatives, public.aflp_coop_campaigns, public.aflp_coop_collection_points,
  public.aflp_coop_sections, public.aflp_coop_villages, public.aflp_coop_contacts, public.aflp_coop_memberships,
  public.aflp_coop_documents to authenticated;
grant select on public.aflp_producer_enrollment, public.aflp_coop_audit to authenticated;
revoke all on public.aflp_cooperatives, public.aflp_coop_campaigns, public.aflp_coop_collection_points,
  public.aflp_coop_sections, public.aflp_coop_villages, public.aflp_coop_contacts, public.aflp_coop_memberships,
  public.aflp_coop_documents, public.aflp_producer_enrollment, public.aflp_coop_audit from anon;
grant usage on sequence public.aflp_coop_code_seq to authenticated;

-- ---------------------------------------------------- stockage des documents
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('aflp-coop-docs','aflp-coop-docs', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

drop policy if exists aflp_coop_docs_insert on storage.objects;
create policy aflp_coop_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'aflp-coop-docs'
              and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
              and private.aflp_coop_can_edit(((storage.foldername(name))[1])::uuid));
drop policy if exists aflp_coop_docs_read on storage.objects;
create policy aflp_coop_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'aflp-coop-docs'
         and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
         and private.aflp_coop_can_read(((storage.foldername(name))[1])::uuid)
         and coalesce(public.mon_role(),'') not in ('Warehouse Manager','Storekeeper','QA / Lab','Factory User'));

revoke all on function private.aflp_coop_can_read(uuid), private.aflp_coop_can_edit(uuid),
  private.aflp_coop_scope_global(), private.aflp_coop_is_direction() from public, anon;
grant execute on function private.aflp_coop_can_read(uuid), private.aflp_coop_can_edit(uuid),
  private.aflp_coop_scope_global(), private.aflp_coop_is_direction() to authenticated;

commit;
