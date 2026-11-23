-- =============================================================================
-- Banc Assistant Unit Head · objets complémentaires relevés en production le
-- 03/11/2026 et absents du banc Unit Head : contrainte et déclencheurs de
-- public.profils, tables financières et opérationnelles (achats, avances,
-- incidents, sacs, réconciliations, dépenses de mission) avec leurs politiques
-- RLS EXACTES, contexte Sacherie, classes AFLP FLEET, référentiel des rôles.
-- Colonnes : uniquement celles qui servent aux contrôles. Fonctions : copies
-- textuelles (empreintes vérifiées par lancer-banc.sh).
-- Simplifications (signalées) : les déclencheurs métier de public.achats liés
-- aux règles de campagne Procurement ne sont pas reproduits (ils ne font que
-- REBAISSER le statut de validation) ; voir le rapport.
-- =============================================================================

-- BOUCHON : auth.role() de Supabase
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

-- ----------------------------------------------------------- profils (prod)
alter table public.profils add column if not exists fonction_operationnelle text;
alter table public.profils add column if not exists telephone text;
alter table public.profils add column if not exists derniere_connexion timestamptz;
alter table public.profils add column if not exists created_at timestamptz default now();
alter table public.profils drop constraint if exists profils_role_check;
alter table public.profils add constraint profils_role_check CHECK ((role = ANY (ARRAY['Branch Manager'::text, 'Assistant Branch Manager'::text, 'Head of Field'::text, 'Procurement Officer'::text, 'Supervisor'::text, 'Agent Recenseur'::text, 'Consultation uniquement'::text, 'General Manager'::text, 'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text, 'RT'::text, 'LBA Purchase Officer'::text, 'Warehouse Manager'::text, 'Storekeeper'::text, 'QA / Lab'::text, 'Factory User'::text, 'Finance'::text, 'Viewer / Auditor'::text, 'Finance Manager'::text])));
alter table public.profils drop constraint if exists profils_authority_level_chk;
alter table public.profils add constraint profils_authority_level_chk CHECK (((authority_level IS NULL) OR (authority_level = ANY (ARRAY['GLOBAL'::text, 'ZONE'::text, 'CLUSTER'::text, 'VILLAGE'::text, 'TRANSVERSE'::text]))));

create table if not exists public.rcn_proc_audit_central(id bigserial primary key, table_name text, record_id text, action text,
  before_data jsonb, after_data jsonb, actor_id uuid, actor_role text, created_at timestamptz default now());

CREATE OR REPLACE FUNCTION private.sacherie_norm_cluster(p_valeur text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with k as (
    select regexp_replace(upper(public.unaccent(coalesce(p_valeur,''))),'[^A-Z0-9]','','g') as v
  )
  select c.code
  from public.aflp_clusters c, k
  where k.v <> ''
    and (
      regexp_replace(upper(public.unaccent(c.code)),'[^A-Z0-9]','','g') = k.v
      or regexp_replace(upper(public.unaccent(c.label)),'[^A-Z0-9]','','g') = k.v
      or exists (select 1 from unnest(c.aliases) a
                 where regexp_replace(upper(public.unaccent(a)),'[^A-Z0-9]','','g') = k.v)
    )
  order by c.code
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.aflp_norm(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select nullif(upper(translate(btrim(coalesce(p, '')),
    'éèêëàâäîïôöûüçÉÈÊËÀÂÄÎÏÔÖÛÜÇ', 'eeeeaaaiioouucEEEEAAAIIOOUUC')), '')
$function$;

CREATE OR REPLACE FUNCTION public.aflp_cluster_code(p text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select c.code from public.aflp_clusters c
  where public.aflp_norm(p) is not null
    and (public.aflp_norm(p) = c.code or public.aflp_norm(p) = public.aflp_norm(c.label)
         or public.aflp_norm(p) = any (select public.aflp_norm(a) from unnest(c.aliases) a))
  order by c.code limit 1
$function$;

CREATE OR REPLACE FUNCTION private.profils_garde_habilitations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid();
begin
  -- Validation du cluster pour tout ecrivain (y compris procedure administrateur)
  if tg_op in ('INSERT','UPDATE') and new.cluster is not null and btrim(new.cluster) <> ''
     and (tg_op = 'INSERT' or new.cluster is distinct from old.cluster)
     and private.sacherie_norm_cluster(new.cluster) is null then
    raise exception 'Cluster « % » inconnu du référentiel AFLP', new.cluster using errcode = '23514';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.authority_level = 'GLOBAL'
     and (tg_op = 'INSERT' or new.authority_level is distinct from old.authority_level)
     and new.role in ('Unit Head','Storekeeper') and v_uid is not null then
    -- Portee globale explicite d'un poste normalement limite : autorisee au BM,
    -- tracee dans l'audit. Aucune condition supplementaire ici.
    null;
  end if;
  -- Procedure administrateur (service_role / SQL) : tracee par l'audit.
  if v_uid is null then return coalesce(new, old); end if;

  if not public.est_bm() then
    raise exception 'Seul le Branch Manager actif peut modifier les comptes et leurs habilitations' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.user_id = v_uid then raise exception 'Vous ne pouvez pas supprimer votre propre compte' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then raise exception 'Identifiant de compte non modifiable' using errcode = '42501'; end if;
    if old.user_id = v_uid and (new.role is distinct from old.role or new.actif is distinct from old.actif
        or new.authority_level is distinct from old.authority_level or new.permissions is distinct from old.permissions) then
      raise exception 'Vous ne pouvez pas modifier vos propres habilitations (rôle, statut, portée)' using errcode = '42501';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.role is distinct from old.role) and new.role in ('Branch Manager','General Manager','Finance Manager') then
    raise exception 'Le rôle « % » ne s''attribue pas depuis l''écran : procédure administrateur requise', new.role using errcode = '42501';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION private.profils_journaliser()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_role text;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'derniere_connexion') = (to_jsonb(old) - 'derniere_connexion') then
    return new;
  end if;
  if auth.uid() is not null then
    select role into v_role from public.profils where user_id = auth.uid();
  else
    v_role := coalesce(auth.role(), 'procedure administrateur ('||current_user||')');
  end if;
  insert into public.rcn_proc_audit_central(table_name, record_id, action, before_data, after_data, actor_id, actor_role)
  values ('profils', coalesce(new.user_id, old.user_id)::text, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid(), v_role);
  return coalesce(new, old);
end
$function$;

CREATE OR REPLACE FUNCTION private.profil_cluster_canonique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_k text; v_code text;
begin
  if nullif(btrim(coalesce(new.cluster,'')),'') is null then new.cluster := null; return new; end if;
  if tg_op = 'UPDATE' and new.cluster is not distinct from old.cluster then return new; end if;
  v_k := public.farmer_registry_norm_text(new.cluster);
  select c.code into v_code from public.aflp_clusters c
   where public.farmer_registry_norm_text(c.code) = v_k or public.farmer_registry_norm_text(c.label) = v_k
      or exists (select 1 from unnest(coalesce(c.aliases, '{}'::text[])) a where public.farmer_registry_norm_text(a) = v_k)
   order by c.active desc limit 1;
  if v_code is null then
    raise exception 'Cluster « % » inconnu : choisissez un cluster du référentiel AFLP.', new.cluster using errcode = '23514';
  end if;
  new.cluster := v_code;
  return new;
end $function$;

drop trigger if exists trg_profils_garde_habilitations on public.profils;
create trigger trg_profils_garde_habilitations before insert or update or delete on public.profils
  for each row execute function private.profils_garde_habilitations();
drop trigger if exists trg_profils_journal on public.profils;
create trigger trg_profils_journal after insert or update or delete on public.profils
  for each row execute function private.profils_journaliser();
drop trigger if exists trg_zz_profil_cluster_canonique on public.profils;
create trigger trg_zz_profil_cluster_canonique before insert or update on public.profils
  for each row execute function private.profil_cluster_canonique();

-- Politiques prod de public.profils (relevé 03/11) : remplace celles du banc 16/10.
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='profils' loop
    execute format('drop policy %I on public.profils', r.policyname); end loop; end $$;
alter table public.profils enable row level security;
create policy profils_del_bm on public.profils for delete to authenticated using (est_bm());
create policy profils_ins_bm on public.profils for insert to authenticated with check (est_bm());
create policy profils_sel_bm on public.profils for select to authenticated using (est_bm());
create policy profils_sel_self on public.profils for select to authenticated using (user_id = auth.uid());
create policy profils_select on public.profils for select to public using ((auth.uid() = user_id) OR (fbms_role() = 'Branch Manager'::text));
create policy profils_upd_bm on public.profils for update to authenticated using (est_bm()) with check (est_bm());
create policy profils_update on public.profils for update to public using (fbms_role() = 'Branch Manager'::text);
grant select, insert, update, delete on public.profils to authenticated;

CREATE OR REPLACE FUNCTION public.fbms_roles_attribuables()
 RETURNS TABLE(valeur text, libelle text, portee text, cluster_requis boolean, attribuable boolean, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.est_bm() then
    raise exception 'Réservé au Branch Manager actif' using errcode = '42501';
  end if;
  return query
  with c as (
    select (regexp_matches(pg_get_constraintdef(k.oid), '''([^'']+)''::text', 'g'))[1] as v
    from pg_constraint k
    where k.conrelid = 'public.profils'::regclass and k.conname = 'profils_role_check'
  ),
  meta(v, lib, portee, clr, attr, note, ordre) as (values
    ('Branch Manager', 'Branch Manager / Responsable programme', 'GLOBAL', false, false, 'Non attribuable depuis l''écran : procédure administrateur (Supabase).', 1),
    ('General Manager', 'General Manager', 'GLOBAL', false, false, 'Rôle supérieur au Branch Manager : non attribuable par lui.', 2),
    ('Finance Manager', 'Finance Manager (rapprochement des paiements)', 'GLOBAL', false, false, 'Contrôle financier indépendant du Branch Manager : procédure administrateur.', 2),
    ('Zonal Head', 'Chef de Zone (Zonal Head)', 'GLOBAL', false, true, 'Portée terrain globale (décision du 17/09/2026). Revue des demandes ; ne mouvemente pas les sacs.', 3),
    ('Field Buying Operations Officer', 'Field Buying Operations Officer', 'GLOBAL', false, true, 'Consolidation et coordination ; lecture Sacherie globale.', 4),
    ('Unit Head', 'Chef d''Unité (Unit Head)', 'CLUSTER', true, true, 'Demandes RT, suivi des comptes RT, réceptions terrain. Cluster obligatoire.', 5),
    ('Storekeeper', 'Magasinier (Storekeeper)', 'CLUSTER', true, true, 'Sorties, transferts, comptages, constats physiques. Cluster obligatoire.', 6),
    ('Warehouse Manager', 'Responsable entrepôt usine (Warehouse Manager)', 'HORS_SACHERIE_AFLP', false, true, 'Module RCN TRACE / usine. Aucun accès aux emplacements AFLP.', 7)
  )
  select c.v, coalesce(m.lib, c.v), coalesce(m.portee, 'HORS_SACHERIE_AFLP'), coalesce(m.clr, false),
         coalesce(m.attr, true), m.note
  from c left join meta m on m.v = c.v
  order by coalesce(m.ordre, 100), c.v;
end
$function$;
grant execute on function public.fbms_roles_attribuables() to authenticated;

-- ------------------------------------------------------------ Sacherie (prod)
CREATE OR REPLACE FUNCTION private.sacherie_contexte()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  p public.profils%rowtype;
  v_cl text; v_lect text; v_ecr text; v_glob boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('connecte', false, 'actif', false);
  end if;
  select * into p from public.profils where user_id = auth.uid() and actif = true limit 1;
  if not found then
    return jsonb_build_object('connecte', true, 'actif', false);
  end if;
  v_cl   := private.sacherie_norm_cluster(p.cluster);
  v_glob := coalesce(p.authority_level,'') = 'GLOBAL';
  if p.role = 'Branch Manager' then
    v_lect := 'GLOBAL'; v_ecr := 'GLOBAL';
  elsif p.role = 'Zonal Head' then
    -- Decision du 17/09/2026 (migration zonal_head_global_field_access) :
    -- portee terrain globale. Le Zonal Head controle, il ne mouvemente pas.
    v_lect := case when public.portee_terrain_globale() then 'GLOBAL' else 'CLUSTER' end;
    v_ecr  := null;
  elsif p.role = 'Field Buying Operations Officer' then
    v_lect := 'GLOBAL'; v_ecr := null;
  elsif p.role in ('Unit Head', 'Storekeeper') then
    v_lect := case when v_glob then 'GLOBAL' else 'CLUSTER' end;
    v_ecr  := v_lect;
  end if;
  return jsonb_build_object(
    'connecte', true, 'actif', true, 'role', p.role,
    'cluster', v_cl, 'cluster_saisi', p.cluster,
    'lecture', v_lect, 'ecriture', v_ecr);
end
$function$;

-- ---------------------------------------------------------- AFLP FLEET (prod)
CREATE OR REPLACE FUNCTION private.moto_classe_de(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
           when p.role = 'Branch Manager' then 'BM'
           when p.role = 'Assistant Branch Manager' then 'ABM'
           when p.role in ('Finance','Finance Manager') then 'FINANCE'
           when p.role = 'General Manager' then 'DIRECTION'
           when p.role = 'Zonal Head' then 'ZONE'
           when p.role = 'Unit Head' then 'UNITE'
           when p.role = 'Logistics Coordinator'
             or public.aflp_norm(p.fonction_operationnelle) in ('LOGISTICS COORDINATOR','LOGISTICS_COORDINATOR','COORDINATEUR LOGISTIQUE')
             then 'LOGISTIQUE'
           else null end
  from public.profils p
  where p.user_id = p_user and p.actif = true
  limit 1
$function$;

-- --------------------------------------------- Tables financières / opérations
create table public.achats(id uuid primary key default gen_random_uuid(), local_id text, date date, cluster text, village_id text,
  rt_id text, rt_nom text, producteur_id text, poids_net numeric check (poids_net > 0), prix_kg numeric check (prix_kg > 0), montant numeric,
  nb_sacs integer, humidite numeric, kor numeric, qualite_statut text default 'À contrôler', statut_validation text default 'À valider',
  validated_by uuid, validated_at timestamptz, created_by uuid default auth.uid(), created_by_nom text, created_at timestamptz default now(),
  campaign text, campaign_id uuid, village_nom text, producteur_code text, producteur_nom text, producteur_tel text, poids_brut numeric,
  tare numeric, mode_paiement text, weight_source text, numero_recu text, observation text, prix_hors_bareme boolean default false,
  motif_prix text, commission_rt numeric, refinancable boolean default false, stock_libere boolean default false, stock_statut text default 'Entrée RT',
  saisie_mode text, sourcing_channel text default 'AFLP_DIRECT');
alter table public.achats enable row level security;
create policy achats_del on public.achats for delete to authenticated using (est_bm());
create policy achats_ins on public.achats for insert to authenticated with check ((est_actif() AND (created_by = auth.uid())));
create policy achats_sel on public.achats for select to authenticated using (est_actif());
create policy achats_upd on public.achats for update to authenticated using (est_bm()) with check (est_bm());

create table public.avances(id uuid primary key default gen_random_uuid(), local_id text, date date default current_date, cluster text, rt_id text,
  rt_nom text, montant numeric check (montant > 0), motif text, statut text default 'Active', created_by uuid default auth.uid(),
  created_at timestamptz default now(), override_bm boolean default false, override_motif text, campaign_id uuid);
alter table public.avances enable row level security;
CREATE OR REPLACE FUNCTION public.peut_editer_config()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
$function$;
create policy avances_ins on public.avances for insert to authenticated with check (( SELECT est_actif() AS est_actif));
create policy avances_sel on public.avances for select to authenticated using (est_actif());
create policy avances_upd on public.avances for update to authenticated using (( SELECT peut_editer_config() AS peut_editer_config));

create table public.aflp_incidents(id text primary key default gen_random_uuid()::text, incident_date date default current_date,
  zone_code text, cluster_code text, village_id text, rt_id text, producteur_id text, incident_type text, risk_category text,
  description text, severity text, immediate_action text, responsible_person text, evidence_available boolean default false,
  evidence_ref text, remarks text, status text default 'OUVERT', reported_by uuid, reported_by_name text, created_at timestamptz default now());
alter table public.aflp_incidents enable row level security;
create policy aflp_incidents_select on public.aflp_incidents for select to authenticated using (est_actif());
create table public.audit_log(id bigserial primary key, ts timestamptz, email text, action text, details text);

CREATE OR REPLACE FUNCTION public.aflp_declare_incident(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;
grant execute on function public.aflp_declare_incident(jsonb) to authenticated;

create table public.sacs_mouvements(id uuid primary key default gen_random_uuid(), type text, cluster text, village_id text, qty integer,
  created_by uuid default auth.uid(), created_at timestamptz default now());
alter table public.sacs_mouvements enable row level security;
create policy sacs_sel on public.sacs_mouvements for select to authenticated using (est_actif());
create policy sacs_ins on public.sacs_mouvements for insert to authenticated with check ((est_actif() AND (created_by = auth.uid()) AND (type <> 'DOTATION_RT'::text)));
create policy sacs_mouvements_dotation_insert_guard on public.sacs_mouvements as restrictive for insert to authenticated with check ((type IS DISTINCT FROM 'DOTATION_RT'::text));
create policy sacs_mouvements_delete_guard on public.sacs_mouvements as restrictive for delete to authenticated using (false);

create table public.reconciliations(id uuid primary key default gen_random_uuid(), cluster text, statut text, created_by uuid default auth.uid());
alter table public.reconciliations enable row level security;
create policy reconciliations_ins on public.reconciliations for insert to authenticated with check (( SELECT est_actif() AS est_actif));
create policy reconciliations_sel on public.reconciliations for select to authenticated using (est_actif());
create policy reconciliations_upd on public.reconciliations for update to authenticated using (( SELECT peut_editer_config() AS peut_editer_config));

CREATE OR REPLACE FUNCTION public.est_equipe_terrain()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in
    ('Chef d''equipe','Chef d''équipe','Agent Recenseur','Supervisor',
     'Procurement Officer','Head of Field',
     'Branch Manager','Assistant Branch Manager')
$function$;
create table public.depenses_mission(id uuid primary key default gen_random_uuid(), village_id text, montant_xof numeric,
  statut_validation text, valide_par uuid, valide_le timestamptz, created_by uuid default auth.uid());
alter table public.depenses_mission enable row level security;
create policy depenses_mission_del on public.depenses_mission for delete to authenticated using (( SELECT est_bm() AS est_bm));
create policy depenses_mission_ins on public.depenses_mission for insert to authenticated with check ((( SELECT est_equipe_terrain() AS est_equipe_terrain) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy depenses_mission_sel on public.depenses_mission for select to authenticated using (( SELECT est_actif() AS est_actif));
create policy depenses_mission_upd on public.depenses_mission for update to authenticated using (( SELECT peut_editer_config() AS peut_editer_config));

grant select, insert, update, delete on public.achats, public.avances, public.aflp_incidents, public.sacs_mouvements,
  public.reconciliations, public.depenses_mission to authenticated;
grant usage on schema private to authenticated;

CREATE OR REPLACE FUNCTION private.sacherie_exiger_cluster(p_cluster text, p_ecriture boolean, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  c jsonb := private.sacherie_contexte();
  v_portee text;
  v_cible text;
begin
  if not coalesce((c->>'connecte')::boolean, false) then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if not coalesce((c->>'actif')::boolean, false) then
    raise exception 'Compte désactivé ou sans profil actif : action refusée' using errcode = '42501';
  end if;
  v_portee := c->>(case when p_ecriture then 'ecriture' else 'lecture' end);
  if v_portee is null then
    if p_ecriture and c->>'role' = 'Zonal Head' then
      raise exception 'Le Zonal Head contrôle mais ne mouvemente pas physiquement les sacs' using errcode = '42501';
    end if;
    raise exception 'Accès refusé : le rôle « % » ne permet pas de %', c->>'role', p_action using errcode = '42501';
  end if;
  if v_portee = 'GLOBAL' then return; end if;
  if c->>'cluster' is null then
    raise exception 'Affectation manquante : aucun cluster valide n''est rattaché à ce compte (rôle « % », valeur saisie « % »). Le Branch Manager doit compléter l''affectation dans Comptes et rôles.',
      c->>'role', coalesce(c->>'cluster_saisi','vide')
      using errcode = '42501', hint = 'FBMS_AFFECTATION_MANQUANTE';
  end if;
  v_cible := private.sacherie_norm_cluster(p_cluster);
  if v_cible is null then
    raise exception 'Localisation hors périmètre cluster : cible sans cluster AFLP (« % »), réservée aux comptes à portée globale', coalesce(p_cluster,'aucun')
      using errcode = '42501';
  end if;
  if v_cible <> c->>'cluster' then
    raise exception 'Localisation hors périmètre cluster : % n''est pas votre cluster (%)', v_cible, c->>'cluster'
      using errcode = '42501';
  end if;
end
$function$;
grant execute on function private.sacherie_exiger_cluster(text, boolean, text) to authenticated;
grant select on public.rcn_proc_audit_central to authenticated; -- BANC : lecture de preuve d'audit
