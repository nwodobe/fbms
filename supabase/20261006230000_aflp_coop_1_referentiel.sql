-- =============================================================================
-- AFLP 2027 · Coopératives — 1/5 : référentiel, affiliations, audit
-- -----------------------------------------------------------------------------
-- Principes (voir docs/AFLP_COOPERATIVES_ARCHITECTURE.md) :
--   * Le PRODUCTEUR reste l'unité centrale : aucune table producteur parallèle.
--     Une coopérative se rattache au registre unique public.producteurs par
--     aflp_coop_memberships (historisé, par campagne, une seule affiliation
--     principale ACTIVE par producteur et par campagne).
--   * Une coopérative N'EST PAS un RT : ses responsables sont des contacts
--     (aflp_coop_contacts), jamais des lignes de public.rt.
--   * UNE organisation, plusieurs rôles : la coopérative AFLP peut pointer vers
--     son identité Procurement (procurement_suppliers.supplier_id) au lieu
--     d'être dupliquée.
--   * Migration ADDITIVE : aucune table existante n'est réécrite, aucun
--     Farmer ID, RT ID ou rattachement existant n'est modifié.
-- =============================================================================
begin;

-- ---------------------------------------------------------------- séquence code
create sequence if not exists public.aflp_coop_code_seq start 1;

-- ------------------------------------------------------------- coopératives
create table if not exists public.aflp_cooperatives (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  acronym text,
  legal_name text,
  org_type text not null default 'SCOOPS'
    check (org_type in ('SCOOPS','COOP_CA','UNION','FEDERATION','GIE','ASSOCIATION','AUTRE')),
  registration_no text,
  approval_no text,
  rccm text,
  creation_date date,
  head_office text,
  address text,
  region text,
  departement text,
  sous_prefecture text,
  locality text,
  locality_village_id text references public.villages(id),
  gps_lat numeric check (gps_lat is null or gps_lat between -90 and 90),
  gps_lng numeric check (gps_lng is null or gps_lng between -180 and 180),
  cluster_code text references public.aflp_clusters(code),
  phone text,
  email text,
  declared_members integer check (declared_members is null or declared_members >= 0),
  aflp_status text not null default 'PROSPECT'
    check (aflp_status in ('PROSPECT','EN_EVALUATION','A_COMPLETER','APPROUVEE','ACTIVE','SUSPENDUE','SORTIE')),
  status_reason text,
  compliance_status text not null default 'NON_EVALUE'
    check (compliance_status in ('NON_EVALUE','CONFORME','PARTIEL','NON_CONFORME')),
  producer_registry_status text not null default 'NON_FOURNI'
    check (producer_registry_status in ('NON_FOURNI','PARTIEL','COMPLET','VERIFIE')),
  aflp_join_date date,
  supplier_id uuid unique references public.procurement_suppliers(supplier_id),
  notes text,
  is_qa boolean not null default false,
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  row_version integer not null default 1,
  constraint aflp_coop_name_no_html check (name !~ '[<>]' and coalesce(acronym,'') !~ '[<>]'),
  constraint aflp_coop_archive_coherent check (not archived or archived_at is not null)
);
comment on table public.aflp_cooperatives is
  'AFLP 2027 : coopératives partenaires (canal COOPERATIVE). Jamais supprimées physiquement : archivage. Identité commerciale optionnelle via supplier_id (Procurement).';
create index if not exists aflp_coop_cluster_idx on public.aflp_cooperatives(cluster_code) where not archived;
create index if not exists aflp_coop_status_idx on public.aflp_cooperatives(aflp_status) where not archived;
create unique index if not exists aflp_coop_name_key on public.aflp_cooperatives(public.farmer_registry_norm_text(name)) where not archived;

-- --------------------------------------------- paramètres campagne (target, modèle)
create table if not exists public.aflp_coop_campaigns (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  campaign text not null default '2027' references public.procurement_campaigns(code),
  payment_model text not null default 'INDIVIDUAL_FARMER'
    check (payment_model in ('INDIVIDUAL_FARMER','COOPERATIVE_CONSOLIDATED')),
  declared_potential_mt numeric check (declared_potential_mt is null or declared_potential_mt >= 0),
  target_mt numeric check (target_mt is null or target_mt >= 0),
  secured_volume_mt numeric check (secured_volume_mt is null or secured_volume_mt >= 0),
  zone_head_name text,
  unit_head_name text,
  referent_rt_id text references public.rt(id),
  destination_warehouse_id uuid references public.wms_warehouses(id),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (cooperative_id, campaign)
);
comment on table public.aflp_coop_campaigns is
  'Paramètres d''une coopérative pour une campagne : modèle de paiement (producteur individuel ou livraison consolidée), potentiel DÉCLARÉ, target AFLP, référents AFLP.';

-- -------------------------------------------------------------- points de collecte
create table if not exists public.aflp_coop_collection_points (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  name text not null,
  village_id text references public.villages(id),
  village_name text,
  gps_lat numeric check (gps_lat is null or gps_lat between -90 and 90),
  gps_lng numeric check (gps_lng is null or gps_lng between -180 and 180),
  capacity_mt numeric check (capacity_mt is null or capacity_mt >= 0),
  manager_name text,
  manager_phone text,
  destination_warehouse_id uuid references public.wms_warehouses(id),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists aflp_coop_cp_coop_idx on public.aflp_coop_collection_points(cooperative_id);

-- ---------------------------------------------------------------------- sections
create table if not exists public.aflp_coop_sections (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  code text,
  name text not null,
  leader_name text,
  leader_phone text,
  collection_point_id uuid references public.aflp_coop_collection_points(id),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create unique index if not exists aflp_coop_section_name_key
  on public.aflp_coop_sections(cooperative_id, public.farmer_registry_norm_text(name)) where active;

-- ---------------------------------------------------------- villages couverts
create table if not exists public.aflp_coop_villages (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  village_id text references public.villages(id),
  village_name text,
  section_id uuid references public.aflp_coop_sections(id),
  declared_producers integer check (declared_producers is null or declared_producers >= 0),
  declared_potential_mt numeric check (declared_potential_mt is null or declared_potential_mt >= 0),
  leader_name text,
  collection_point_id uuid references public.aflp_coop_collection_points(id),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint aflp_coop_village_named check (village_id is not null or nullif(btrim(village_name),'') is not null)
);
comment on table public.aflp_coop_villages is
  'Villages couverts par une coopérative (N villages par coopérative, un village peut être couvert par plusieurs coopératives). village_id NULL = localité hors référentiel AFLP, conservée par son nom.';
create unique index if not exists aflp_coop_village_key
  on public.aflp_coop_villages(cooperative_id, village_id) where active and village_id is not null;
create index if not exists aflp_coop_village_vid_idx on public.aflp_coop_villages(village_id);

-- ---------------------------------------------------------------- responsables
create table if not exists public.aflp_coop_contacts (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  role text not null check (role in ('PRESIDENT','VICE_PRESIDENT','DIRECTEUR','SECRETAIRE','TRESORIER',
    'RESP_COLLECTE','RESP_QUALITE','MAGASINIER','COMPTABLE','AUTRE')),
  full_name text not null,
  phone text,
  email text,
  section_id uuid references public.aflp_coop_sections(id),
  is_primary boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint aflp_coop_contact_no_html check (full_name !~ '[<>]')
);
comment on table public.aflp_coop_contacts is
  'Responsables de la coopérative (président, secrétaire, magasinier...). Ce ne sont PAS des RT et ils ne sont jamais créés dans public.rt.';
create index if not exists aflp_coop_contacts_coop_idx on public.aflp_coop_contacts(cooperative_id) where active;

-- ------------------------------------------------- affiliation producteur <> coop
create table if not exists public.aflp_coop_memberships (
  id uuid primary key default gen_random_uuid(),
  producer_id text not null references public.producteurs(id),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  campaign text not null default '2027' references public.procurement_campaigns(code),
  section_id uuid references public.aflp_coop_sections(id),
  member_number text,
  status text not null default 'ACTIVE' check (status in ('PENDING','ACTIVE','SUSPENDED','ENDED')),
  membership_start date not null default current_date,
  membership_end date,
  is_primary boolean not null default false,
  verified boolean not null default false,
  verification_date date,
  verification_method text check (verification_method is null or verification_method in
    ('LISTE_COOPERATIVE','CARTE_MEMBRE','REGISTRE_COOPERATIVE','VISITE_TERRAIN','APPEL_TELEPHONIQUE','AUTRE')),
  verified_by uuid,
  source text not null default 'MANUEL' check (source in ('MANUEL','IMPORT_EXCEL','ASSOCIATION_EXISTANT','TRANSFERT')),
  followup_rt_id text references public.rt(id),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint aflp_mbr_dates check (membership_end is null or membership_end >= membership_start),
  constraint aflp_mbr_ended_coherent check ((status = 'ENDED') = (membership_end is not null)),
  constraint aflp_mbr_primary_active check (not is_primary or status in ('ACTIVE','PENDING')),
  constraint aflp_mbr_verified_coherent check (not verified or verification_date is not null)
);
comment on table public.aflp_coop_memberships is
  'Affiliation historisée producteur <> coopérative, par campagne. Jamais supprimée : une sortie ferme la ligne (membership_end, ENDED). Une seule affiliation principale ouverte par producteur et campagne (sert au calcul des objectifs, évite le double comptage).';
-- Une seule affiliation PRINCIPALE ouverte par producteur et campagne.
create unique index if not exists aflp_mbr_one_primary
  on public.aflp_coop_memberships(producer_id, campaign) where is_primary and status <> 'ENDED';
-- Pas deux affiliations ouvertes au même couple producteur/coop/campagne.
create unique index if not exists aflp_mbr_one_open
  on public.aflp_coop_memberships(producer_id, cooperative_id, campaign) where status <> 'ENDED';
-- Numéro de membre unique dans la coopérative (lignes ouvertes).
create unique index if not exists aflp_mbr_member_no
  on public.aflp_coop_memberships(cooperative_id, campaign, upper(btrim(member_number)))
  where member_number is not null and btrim(member_number) <> '' and status <> 'ENDED';
create index if not exists aflp_mbr_coop_idx on public.aflp_coop_memberships(cooperative_id, campaign) where status <> 'ENDED';
create index if not exists aflp_mbr_producer_idx on public.aflp_coop_memberships(producer_id);

-- -------------------------------- source d'enrôlement (<> affiliation actuelle)
create table if not exists public.aflp_producer_enrollment (
  producer_id text primary key references public.producteurs(id),
  enrollment_channel text not null check (enrollment_channel in ('AFLP_DIRECT','COOPERATIVE')),
  enrolled_by_rt_id text references public.rt(id),
  enrolled_cooperative_id uuid references public.aflp_cooperatives(id),
  enrolled_campaign text references public.procurement_campaigns(code),
  source text not null default 'MANUEL',
  enrolled_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
comment on table public.aflp_producer_enrollment is
  'Source d''enrôlement figée à la création. Un producteur sans ligne ici est réputé enrôlé AFLP_DIRECT (historique RT) : aucun rattrapage automatique n''est écrit.';

-- --------------------------------------------------------------------- documents
create table if not exists public.aflp_coop_documents (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  category text not null check (category in ('AGREMENT','RCCM','STATUTS','REGLEMENT_INTERIEUR','LISTE_MEMBRES',
    'RIB','PIECE_PRESIDENT','CONTRAT_AFLP','ACCORD_COMMERCIAL','PREFINANCEMENT','ATTESTATION','CERTIFICATION','AUTRE')),
  title text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  issued_on date,
  expires_on date,
  voided boolean not null default false,
  void_reason text,
  replaces_id uuid references public.aflp_coop_documents(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint aflp_doc_dates check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists aflp_coop_docs_coop_idx on public.aflp_coop_documents(cooperative_id) where not voided;

-- ------------------------------------------------------------------------ audit
create table if not exists public.aflp_coop_audit (
  id bigint generated always as identity primary key,
  cooperative_id uuid,
  entity text not null,
  entity_id text,
  operation text not null,
  before_data jsonb,
  after_data jsonb,
  note text,
  actor_id uuid default auth.uid(),
  actor_email text,
  actor_role text,
  created_at timestamptz not null default now()
);
create index if not exists aflp_coop_audit_coop_idx on public.aflp_coop_audit(cooperative_id, created_at desc);

create or replace function private.aflp_coop_audit_trigger()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_before jsonb; v_after jsonb; v_coop uuid; v_id text;
begin
  v_before := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_after  := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_id := coalesce(v_after->>'id', v_before->>'id');
  v_coop := case when tg_table_name = 'aflp_cooperatives' then v_id::uuid
                 else coalesce(v_after->>'cooperative_id', v_before->>'cooperative_id')::uuid end;
  if tg_op = 'UPDATE' and v_before - 'updated_at' - 'updated_by' - 'row_version'
                        = v_after - 'updated_at' - 'updated_by' - 'row_version' then
    return new;
  end if;
  insert into public.aflp_coop_audit(cooperative_id, entity, entity_id, operation, before_data, after_data,
                                     actor_id, actor_email, actor_role)
  values (v_coop, tg_table_name, v_id, tg_op, v_before, v_after, auth.uid(), public.fbms_email(), public.fbms_role());
  return coalesce(new, old);
end $$;

create or replace function private.aflp_coop_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_table_name = 'aflp_cooperatives' then new.row_version := coalesce(old.row_version, 0) + 1; end if;
  return new;
end $$;

-- Code AFLP automatique : COOP-001... ; les fiches QA portent QA-COOP-... et
-- restent exclues de toutes les statistiques.
create or replace function private.aflp_coop_set_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := case when new.is_qa then 'QA-COOP-' else 'COOP-' end
                || lpad(nextval('public.aflp_coop_code_seq')::text, 3, '0');
  else
    new.code := upper(btrim(new.code));
  end if;
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  if new.is_qa and new.code !~ '^QA-' then raise exception 'Une coopérative QA doit avoir un code QA-...'; end if;
  return new;
end $$;

-- Interdiction absolue de suppression physique d'une coopérative : on archive.
create or replace function private.aflp_coop_block_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Suppression physique interdite (%). Utilisez l''archivage.', tg_table_name
    using errcode = '42501';
end $$;

do $$ declare t text; begin
  foreach t in array array['aflp_cooperatives','aflp_coop_campaigns','aflp_coop_collection_points','aflp_coop_sections',
                           'aflp_coop_villages','aflp_coop_contacts','aflp_coop_memberships','aflp_coop_documents'] loop
    execute format('    execute format('create or replace trigger trg_aflp_audit after insert or update or delete on public.%I for each row execute function private.aflp_coop_audit_trigger()', t);
    execute format('    execute format('create or replace trigger trg_aflp_no_delete before delete on public.%I for each row execute function private.aflp_coop_block_delete()', t);
    if t <> 'aflp_coop_documents' then
      execute format('      execute format('create or replace trigger trg_aflp_touch before update on public.%I for each row execute function private.aflp_coop_touch()', t);
    end if;
  end loop;
end $$;
create or replace trigger trg_aflp_coop_code before insert or update of code, name on public.aflp_cooperatives
  for each row execute function private.aflp_coop_set_code();

commit;
