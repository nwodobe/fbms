-- Multi-campagnes · 1/3 — référentiel des campagnes.
--
-- Avant : la campagne était une valeur texte (« 2027 ») recopiée dans une dizaine de tables, avec des valeurs par
-- défaut codées en dur et un calendrier technique (procurement_campaigns : 2025 à 2028, une ligne par année civile).
-- Après : une campagne est un objet géré (public.campaigns, identifiant UUID stable) avec un type (REAL, DEMO,
-- SIMULATION, TRAINING, QA) et un cycle de vie (DRAFT → PLANNING → READY → OPEN → CLOSING → CLOSED → ARCHIVED).
-- Le code visible (2027, RCN-2028…) reste lisible ; les relations techniques utilisent campaign_id.
--
-- Compatibilité : procurement_campaigns reste le registre des codes référencés par les clés étrangères historiques
-- (aflp_coop_*). Toute campagne créée y inscrit son code ; rien n'est supprimé.
--
-- Données actuelles : la direction a indiqué que les travaux enregistrés jusqu'ici sont des tests et des
-- simulations, pas une campagne opérationnelle. Ils sont rattachés à la campagne « 2027 » de type SIMULATION
-- (migration 2/3). Aucun référentiel permanent (producteurs, RT, villages, coopératives, fournisseurs, entrepôts,
-- utilisateurs) n'est rattaché ni supprimé.

-- 1. Campagnes
create table if not exists public.campaigns (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$'),
  name                  text not null check (length(btrim(name)) >= 3),
  year                  int  not null check (year between 2020 and 2100),
  campaign_type         text not null default 'REAL' check (campaign_type in ('REAL','DEMO','SIMULATION','TRAINING','QA')),
  status                text not null default 'DRAFT' check (status in ('DRAFT','PLANNING','READY','OPEN','CLOSING','CLOSED','ARCHIVED')),
  start_date            date,
  planned_end_date      date,
  actual_end_date       date,
  currency              text not null default 'XOF',
  country               text not null default 'CI',
  season                text,
  description           text,
  config                jsonb not null default '{}'::jsonb,
  copied_from           uuid references public.campaigns(id) on delete set null,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  opened_at             timestamptz, opened_by uuid,
  closing_started_at    timestamptz, closing_started_by uuid,
  closed_at             timestamptz, closed_by uuid,
  closed_with_reserves  boolean not null default false,
  archived_at           timestamptz, archived_by uuid,
  reopened_count        int not null default 0,
  is_current            boolean not null default false,
  is_qa                 boolean not null default false,
  row_version           int not null default 1,
  updated_at            timestamptz not null default now(),
  constraint campaigns_dates_chk check (planned_end_date is null or start_date is null or planned_end_date >= start_date)
);
comment on table public.campaigns is 'Référentiel des campagnes ANAGROCI (REAL, DEMO, SIMULATION, TRAINING, QA) et leur cycle de vie.';
-- Une seule campagne courante (contexte par défaut des écritures) et une seule campagne REAL ouverte.
create unique index if not exists campaigns_one_current on public.campaigns ((true)) where is_current;
create unique index if not exists campaigns_one_real_open on public.campaigns (campaign_type) where campaign_type = 'REAL' and status = 'OPEN';

-- 2. Journal des événements de campagne (survit à la suppression d'une simulation : pas de clé étrangère)
create table if not exists public.campaign_events (
  id            bigserial primary key,
  campaign_id   uuid not null,
  campaign_code text not null,
  event         text not null check (event in ('CAMPAIGN_CREATED','CAMPAIGN_CONFIG_UPDATED','CAMPAIGN_STATUS_CHANGED','CAMPAIGN_OPENED',
                  'CAMPAIGN_CURRENT_SET','CAMPAIGN_CLOSING_STARTED','CAMPAIGN_CLOSED','CAMPAIGN_REOPENED','CAMPAIGN_ARCHIVED',
                  'SIMULATION_EXPORTED','SIMULATION_DELETED')),
  actor         uuid,
  actor_email   text,
  actor_role    text,
  reason        text,
  before        jsonb,
  after         jsonb,
  details       jsonb,
  at            timestamptz not null default now()
);
create index if not exists campaign_events_campaign_idx on public.campaign_events (campaign_id, at desc);

-- 3. Périmètre et organisation d'une campagne (zones, clusters, villages, RT, responsables, partenaires, infrastructure)
create table if not exists public.campaign_participants (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind        text not null check (kind in ('ZONE','CLUSTER','VILLAGE','RT','ZONE_HEAD','UNIT_HEAD','TEAM','COOPERATIVE','LBA','SUPPLIER','WAREHOUSE','FACTORY')),
  ref_id      text not null,
  ref_label   text,
  parent_ref  text,
  role        text,
  meta        jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (campaign_id, kind, ref_id)
);
create index if not exists campaign_participants_kind_idx on public.campaign_participants (campaign_id, kind) where active;

-- 4. Objectifs par campagne et par niveau
create table if not exists public.campaign_targets (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  level       text not null check (level in ('CAMPAIGN','CHANNEL','ZONE','CLUSTER','COOPERATIVE','SUPPLIER','RT')),
  ref_id      text not null default '',
  ref_label   text,
  target_mt   numeric(14,3) check (target_mt is null or target_mt >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (campaign_id, level, ref_id)
);

-- 5. Producteur par campagne : un seul producteur (même Farmer ID), une ligne par campagne
create table if not exists public.producer_campaigns (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  producer_id     text not null references public.producteurs(id),
  channel         text check (channel in ('AFLP_DIRECT','COOPERATIVE','NO_COOP','LBA','DIRECT_SUPPLIER')),
  rt_id           text,
  village_id      text,
  cooperative_id  uuid,
  membership_id   uuid,
  section_id      uuid,
  potential_kg    numeric check (potential_kg is null or potential_kg >= 0),
  target_kg       numeric check (target_kg is null or target_kg >= 0),
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','PENDING')),
  passport_stage  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  unique (campaign_id, producer_id)
);
create index if not exists producer_campaigns_producer_idx on public.producer_campaigns (producer_id);
create index if not exists producer_campaigns_rt_idx on public.producer_campaigns (campaign_id, rt_id);

-- 6. Instantanés de clôture (figés : consultables même si les référentiels évoluent)
create table if not exists public.campaign_snapshots (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind        text not null check (kind in ('FINAL','CLOSING_PREVIEW','ARCHIVE_EXPORT')),
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  uuid
);
create index if not exists campaign_snapshots_campaign_idx on public.campaign_snapshots (campaign_id, kind, created_at desc);

-- 7. QA explicite sur les référentiels (jamais déduit) : seul un producteur ou une coopérative marqué is_qa et
--    rattaché à une campagne non REAL peut être proposé à la suppression avec cette campagne.
alter table public.producteurs       add column if not exists is_qa boolean not null default false;
alter table public.producteurs       add column if not exists qa_campaign_id uuid;
alter table public.aflp_cooperatives add column if not exists qa_campaign_id uuid;

-- 8. Aides
create or replace function private.campaign_role() returns text
language sql stable security definer set search_path = public, private as $$ select coalesce(public.mon_role(), '') $$;

create or replace function private.campaign_current_id() returns uuid
language sql stable security definer set search_path = public, private as $$
  select id from public.campaigns where is_current limit 1 $$;

create or replace function private.campaign_by_code(p_code text) returns uuid
language sql stable security definer set search_path = public, private as $$
  select id from public.campaigns where code = upper(btrim(p_code)) limit 1 $$;

create or replace function private.campaign_purge_active() returns boolean
language plpgsql stable security definer set search_path = public, private as $$
declare v text := current_setting('aflp.campaign_purge', true);
begin
  if v is null or v = '' then return false; end if;
  return exists (select 1 from public.campaigns c where c.id::text = v and c.campaign_type <> 'REAL');
exception when others then return false;
end $$;

create or replace function private.campaign_log(p_id uuid, p_event text, p_reason text, p_before jsonb, p_after jsonb, p_details jsonb default null)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  insert into public.campaign_events (campaign_id, campaign_code, event, actor, actor_email, actor_role, reason, before, after, details)
  select p_id, coalesce((select code from public.campaigns where id = p_id), coalesce(p_before->>'code', p_after->>'code', '?')),
         p_event, auth.uid(), public.fbms_email(), private.campaign_role(), p_reason, p_before, p_after, p_details;
end $$;

-- Synchronisation du registre historique des codes (clés étrangères aflp_coop_* sur procurement_campaigns.code)
create or replace function private.campaigns_sync_legacy() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'Le code de campagne % ne se modifie pas : il est référencé par les opérations.', old.code using errcode = '42501';
  end if;
  new.is_qa := new.campaign_type = 'QA';
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.row_version := old.row_version + 1; end if;
  -- Le registre historique n'accepte que des années sur 4 chiffres (contrainte procurement_campaigns_code_check) ;
  -- son élargissement fait partie de la migration 4, soumise à validation.
  begin
    insert into public.procurement_campaigns (code, starts_on, ends_on, source)
    values (new.code, coalesce(new.start_date, make_date(new.year, 1, 1)), coalesce(new.planned_end_date, make_date(new.year, 12, 31)), 'CAMPAIGNS')
    on conflict (code) do nothing;
  exception when check_violation then
    raise exception 'Code % refusé : pour l''instant, le code d''une campagne doit être une année sur 4 chiffres (ex. 2028). Les codes alphanumériques (RCN-2028, SIM-2027) seront acceptés après validation de la migration 4 par la direction.', new.code
      using errcode = '23514';
  end;
  return new;
end $$;
create or replace trigger trg_campaigns_sync_legacy before insert or update on public.campaigns
  for each row execute function private.campaigns_sync_legacy();

-- 9. Sécurité : lecture pour tout utilisateur connecté (le contexte campagne est nécessaire partout),
--    écriture uniquement par les fonctions de cycle de vie (migration 3/3).
alter table public.campaigns             enable row level security;
alter table public.campaign_events       enable row level security;
alter table public.campaign_participants enable row level security;
alter table public.campaign_targets      enable row level security;
alter table public.producer_campaigns    enable row level security;
alter table public.campaign_snapshots    enable row level security;

do $p$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='campaigns' and policyname='campaigns_read') then
  create policy campaigns_read on public.campaigns for select to authenticated using (true);
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='campaign_participants' and policyname='campaign_participants_read') then
  create policy campaign_participants_read on public.campaign_participants for select to authenticated using (true);
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='campaign_targets' and policyname='campaign_targets_read') then
  create policy campaign_targets_read on public.campaign_targets for select to authenticated using (true);
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='producer_campaigns' and policyname='producer_campaigns_read') then
  create policy producer_campaigns_read on public.producer_campaigns for select to authenticated using (true);
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='campaign_events' and policyname='campaign_events_read') then
  create policy campaign_events_read on public.campaign_events for select to authenticated
  using (coalesce(public.mon_role(),'') in ('Branch Manager','Assistant Branch Manager','General Manager','Zonal Head','Finance','Viewer / Auditor'));
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='campaign_snapshots' and policyname='campaign_snapshots_read') then
  create policy campaign_snapshots_read on public.campaign_snapshots for select to authenticated
  using (coalesce(public.mon_role(),'') in ('Branch Manager','Assistant Branch Manager','General Manager','Zonal Head','Finance','Viewer / Auditor'));
end if; end $p$;

revoke all on public.campaigns, public.campaign_events, public.campaign_participants, public.campaign_targets,
              public.producer_campaigns, public.campaign_snapshots from anon;
revoke insert, update, delete, truncate on public.campaigns, public.campaign_events, public.campaign_participants,
              public.campaign_targets, public.producer_campaigns, public.campaign_snapshots from authenticated;
grant select on public.campaigns, public.campaign_events, public.campaign_participants, public.campaign_targets,
              public.producer_campaigns, public.campaign_snapshots to authenticated;

revoke execute on function private.campaign_role(), private.campaign_current_id(), private.campaign_by_code(text),
  private.campaign_purge_active(), private.campaign_log(uuid, text, text, jsonb, jsonb, jsonb),
  private.campaigns_sync_legacy() from public, anon, authenticated;
-- Lue par les gardes de suppression existantes (exécutées avec les droits de l'appelant) : renvoie seulement vrai/faux.
grant execute on function private.campaign_purge_active() to authenticated;

-- 10. Campagne de rattachement des travaux actuels : SIMULATION, ouverte, courante.
insert into public.campaigns (code, name, year, campaign_type, status, start_date, planned_end_date, season, description,
                              opened_at, is_current)
values ('2027', 'Simulation AFLP 2027', 2027, 'SIMULATION', 'OPEN', date '2026-08-01', date '2027-07-31', '2026-2027',
        'Travaux de construction, de test et de simulation de l''application (août à octobre 2026). Ce n''est pas une '
        || 'campagne opérationnelle. Dates provisoires. Rattachement automatique à vérifier avant toute suppression.',
        now(), true)
on conflict (code) do nothing;

insert into public.campaign_events (campaign_id, campaign_code, event, actor_role, reason, after)
select c.id, c.code, 'CAMPAIGN_CREATED', 'MIGRATION',
       'Passage au modèle multi-campagnes : rattachement des travaux de test existants à une campagne SIMULATION.',
       to_jsonb(c)
from public.campaigns c where c.code = '2027'
  and not exists (select 1 from public.campaign_events e where e.campaign_id = c.id and e.event = 'CAMPAIGN_CREATED');
