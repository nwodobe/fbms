-- FBMS · AFLP DATA (1/5) : référentiels, objectifs programme, incidents terrain
-- Village → Producteur → RT → Achat → Paiement → Sacs → Stock terrain →
-- Evacuation → Warehouse relay → Usine Yamoussoukro.
-- Aucune table existante n'est modifiée ni vidée. Deux tables sont ajoutées :
--   aflp_program_targets : objectifs (programme, zone, cluster, village) ;
--   aflp_incidents       : incidents, risques et conformité terrain.

-- 1. Utilitaires ------------------------------------------------------------
create or replace function public.aflp_num(p text)
returns numeric language sql immutable set search_path = public, pg_temp as $f$
  select case
    when p is null then null
    when btrim(replace(p, ',', '.')) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(replace(p, ',', '.'))::numeric
    else null end
$f$;

create or replace function public.aflp_norm(p text)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select nullif(upper(translate(btrim(coalesce(p, '')),
    'éèêëàâäîïôöûüçÉÈÊËÀÂÄÎÏÔÖÛÜÇ', 'eeeeaaaiioouucEEEEAAAIIOOUUC')), '')
$f$;

-- Code cluster AFLP canonique à partir d'un libellé libre (code, libellé ou alias)
create or replace function public.aflp_cluster_code(p text)
returns text language sql stable set search_path = public, pg_temp as $f$
  select c.code from public.aflp_clusters c
  where public.aflp_norm(p) is not null
    and (public.aflp_norm(p) = c.code or public.aflp_norm(p) = public.aflp_norm(c.label)
         or public.aflp_norm(p) = any (select public.aflp_norm(a) from unnest(c.aliases) a))
  order by c.code limit 1
$f$;

create or replace function public.aflp_oui_non(p text)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select case lower(btrim(coalesce(p, ''))) when 'true' then 'Oui' when 'false' then 'Non'
    when 'oui' then 'Oui' when 'non' then 'Non' else null end
$f$;

-- 2. Objectifs du programme --------------------------------------------------
create table if not exists public.aflp_program_targets (
  id uuid primary key default gen_random_uuid(),
  campaign text not null,
  scope_type text not null check (scope_type in ('PROGRAMME', 'ZONE', 'CLUSTER', 'VILLAGE')),
  scope_code text not null,
  target_mt numeric not null check (target_mt >= 0),
  source text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (campaign, scope_type, scope_code)
);
alter table public.aflp_program_targets enable row level security;
drop policy if exists aflp_targets_select on public.aflp_program_targets;
create policy aflp_targets_select on public.aflp_program_targets for select to authenticated using (public.est_actif());
drop policy if exists aflp_targets_insert on public.aflp_program_targets;
create policy aflp_targets_insert on public.aflp_program_targets for insert to authenticated with check (public.peut_editer_config());
drop policy if exists aflp_targets_update on public.aflp_program_targets;
create policy aflp_targets_update on public.aflp_program_targets for update to authenticated using (public.peut_editer_config()) with check (public.peut_editer_config());
revoke all on public.aflp_program_targets from anon;
grant select, insert, update on public.aflp_program_targets to authenticated;

-- Seul objectif connu : 3 000 MT pour le programme (décision du Branch Manager).
-- Les objectifs par zone, cluster ou village restent à saisir (affichés « À compléter »).
insert into public.aflp_program_targets (campaign, scope_type, scope_code, target_mt, source, note)
values ('2027', 'PROGRAMME', 'AFLP', 3000, 'Branch Manager', 'Objectif AFLP 2027 : achat bord champ de 3 000 MT de RCN')
on conflict (campaign, scope_type, scope_code) do nothing;

-- 3. Incidents, risques et conformité ---------------------------------------
create table if not exists public.aflp_incidents (
  id text primary key default ('INC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  incident_date date not null default current_date,
  campaign text not null default '2027',
  zone_code text,
  cluster_code text,
  village_id text,
  rt_id text,
  producteur_id text,
  incident_type text not null check (incident_type in ('ACCIDENT_MOTO', 'SECURITE_TERRAIN', 'CONFLIT_PRODUCTEUR',
    'RETARD_PAIEMENT', 'MANQUE_SACS', 'PERTE_STOCK', 'SUSPICION_FRAUDE', 'QUALITE_LITIGIEUSE',
    'PROBLEME_TRANSPORT', 'RISQUE_TRAVAIL_ENFANTS', 'GPS_PREUVE_MANQUANTE', 'AUTRE')),
  risk_category text check (risk_category in ('SECURITE', 'FINANCIER', 'OPERATIONNEL', 'QUALITE', 'CONFORMITE', 'SOCIAL', 'DONNEES')),
  description text not null check (length(btrim(description)) >= 10),
  severity text not null check (severity in ('FAIBLE', 'MOYENNE', 'ELEVEE', 'CRITIQUE')),
  immediate_action text,
  responsible_person text,
  status text not null default 'OUVERT' check (status in ('OUVERT', 'EN_COURS', 'CLOS')),
  closing_date date,
  closing_note text,
  evidence_available boolean not null default false,
  evidence_ref text,
  remarks text,
  reported_by uuid default auth.uid(),
  reported_by_name text,
  updated_by uuid,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'CLOS' or (closing_date is not null and length(btrim(coalesce(closing_note, ''))) >= 5))
);
create index if not exists aflp_incidents_status_idx on public.aflp_incidents (status, incident_date);
create index if not exists aflp_incidents_cluster_idx on public.aflp_incidents (cluster_code);
alter table public.aflp_incidents enable row level security;
drop policy if exists aflp_incidents_select on public.aflp_incidents;
create policy aflp_incidents_select on public.aflp_incidents for select to authenticated using (public.est_actif());
-- Écriture uniquement via les RPC ci-dessous (aucune politique d'écriture directe).
revoke all on public.aflp_incidents from anon;
revoke insert, update, delete on public.aflp_incidents from authenticated;
grant select on public.aflp_incidents to authenticated;

create or replace function public.aflp_declare_incident(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_role text := public.fbms_role();
  v_name text;
  v_cluster text;
  v_zone text;
  v_id text;
begin
  if auth.uid() is null or not public.est_actif() then
    raise exception 'Connexion requise pour déclarer un incident' using errcode = '42501';
  end if;
  if coalesce(v_role, '') in ('', 'Consultation uniquement') then
    raise exception 'Votre rôle ne permet pas de déclarer un incident' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p->>'description', ''))) < 10 then
    raise exception 'Description trop courte (10 caractères minimum)';
  end if;
  select nom into v_name from public.profils where user_id = auth.uid();
  v_cluster := public.aflp_cluster_code(coalesce(p->>'cluster', p->>'cluster_code'));
  if v_cluster is null and nullif(p->>'village_id', '') is not null then
    select public.aflp_cluster_code(coalesce(nullif(v.cluster_code, ''), v.cluster)) into v_cluster
    from public.villages v where v.id = p->>'village_id';
  end if;
  select c.zone_code into v_zone from public.aflp_clusters c where c.code = v_cluster;
  v_zone := coalesce(v_zone, nullif(upper(p->>'zone_code'), ''));
  insert into public.aflp_incidents (incident_date, zone_code, cluster_code, village_id, rt_id, producteur_id,
    incident_type, risk_category, description, severity, immediate_action, responsible_person,
    evidence_available, evidence_ref, remarks, reported_by, reported_by_name)
  values (coalesce(nullif(p->>'incident_date', '')::date, current_date), v_zone, v_cluster,
    nullif(p->>'village_id', ''), nullif(p->>'rt_id', ''), nullif(p->>'producteur_id', ''),
    upper(p->>'incident_type'), nullif(upper(p->>'risk_category'), ''), btrim(p->>'description'), upper(p->>'severity'),
    nullif(btrim(p->>'immediate_action'), ''), nullif(btrim(p->>'responsible_person'), ''),
    coalesce((p->>'evidence_available')::boolean, false), nullif(btrim(p->>'evidence_ref'), ''),
    nullif(btrim(p->>'remarks'), ''), auth.uid(), v_name)
  returning id into v_id;
  insert into public.audit_log (ts, email, action, details)
  values (now(), public.fbms_email(), 'aflp_incident_declared', jsonb_build_object('id', v_id, 'type', upper(p->>'incident_type'), 'severity', upper(p->>'severity'), 'cluster', v_cluster)::text);
  return jsonb_build_object('id', v_id, 'status', 'OUVERT');
end $f$;

create or replace function public.aflp_update_incident(p_id text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_role text := public.fbms_role();
  v_name text;
  v_old text;
begin
  if auth.uid() is null or not public.est_actif() then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if coalesce(v_role, '') not in ('Branch Manager', 'Assistant Branch Manager', 'Head of Field', 'Zonal Head',
      'Supervisor', 'Unit Head', 'Field Buying Operations Officer', 'Coordination') then
    raise exception 'Votre rôle ne permet pas de modifier le statut d''un incident' using errcode = '42501';
  end if;
  if upper(p_status) not in ('OUVERT', 'EN_COURS', 'CLOS') then
    raise exception 'Statut inconnu : %', p_status;
  end if;
  if upper(p_status) = 'CLOS' and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'La clôture exige une note de clôture (5 caractères minimum)';
  end if;
  select status into v_old from public.aflp_incidents where id = p_id for update;
  if v_old is null then
    raise exception 'Incident introuvable : %', p_id;
  end if;
  select nom into v_name from public.profils where user_id = auth.uid();
  update public.aflp_incidents set
    status = upper(p_status),
    closing_date = case when upper(p_status) = 'CLOS' then current_date else null end,
    closing_note = case when upper(p_status) = 'CLOS' then btrim(p_note) else closing_note end,
    remarks = case when upper(p_status) <> 'CLOS' and nullif(btrim(p_note), '') is not null
                   then concat_ws(' · ', remarks, btrim(p_note)) else remarks end,
    updated_by = auth.uid(), updated_by_name = v_name, updated_at = now()
  where id = p_id;
  insert into public.audit_log (ts, email, action, details)
  values (now(), public.fbms_email(), 'aflp_incident_status', jsonb_build_object('id', p_id, 'from', v_old, 'to', upper(p_status))::text);
  return jsonb_build_object('id', p_id, 'status', upper(p_status));
end $f$;

revoke all on function public.aflp_declare_incident(jsonb) from public, anon;
revoke all on function public.aflp_update_incident(text, text, text) from public, anon;
grant execute on function public.aflp_declare_incident(jsonb) to authenticated;
grant execute on function public.aflp_update_incident(text, text, text) to authenticated;
revoke all on function public.aflp_num(text) from public, anon;
revoke all on function public.aflp_norm(text) from public, anon;
revoke all on function public.aflp_cluster_code(text) from public, anon;
revoke all on function public.aflp_oui_non(text) from public, anon;
grant execute on function public.aflp_num(text), public.aflp_norm(text), public.aflp_cluster_code(text), public.aflp_oui_non(text) to authenticated;

-- 4. Encadrement AFLP (Chefs de Zone, Chefs d'Unité, Assistants) ------------
-- Lu depuis les profils : la lecture des profils reste limitée par leur RLS
-- (Branch Manager : tous ; autres : leur propre profil). Absent => « À compléter ».
create or replace view public.aflp_v_cluster_staff with (security_invoker = true) as
select c.code as cluster_code, c.label as cluster_label, c.zone_code, z.label as zone_label,
  (select string_agg(p.nom, ', ' order by p.nom) from public.profils p
    where p.actif and p.role in ('Unit Head', 'Chef d''Unité', 'Chef d''unité')
      and public.aflp_cluster_code(p.cluster) = c.code) as unit_head,
  (select string_agg(p.nom, ', ' order by p.nom) from public.profils p
    where p.actif and p.role in ('Assistant Unit Head', 'Assistant Chef d''Unité')
      and public.aflp_cluster_code(p.cluster) = c.code) as assistant,
  (select string_agg(p.nom, ', ' order by p.nom) from public.profils p
    where p.actif and p.role in ('Zonal Head', 'Chef de Zone')
      and (public.aflp_norm(replace(p.zone, ' ', '_')) = c.zone_code or public.aflp_norm(p.zone) = public.aflp_norm(z.label))) as zone_head
from public.aflp_clusters c
left join public.aflp_zones z on z.code = c.zone_code
where c.active;

revoke all on public.aflp_v_cluster_staff from anon;
grant select on public.aflp_v_cluster_staff to authenticated;
