-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 (pilote) — migration 2/4 : SÉCURITÉ
-- ---------------------------------------------------------------------
-- STATUT : NON APPLIQUÉE EN PRODUCTION (réplique locale uniquement).
-- MOINDRE PRIVILÈGE
--   Branch Manager            : lecture globale, validation, affectations.
--   Assistant Branch Manager  : lecture globale ; vérification/validation
--                               seulement par affectation agronomique.
--   Zonal Head                : lecture de SA zone ; vérification/validation
--                               seulement par affectation agronomique.
--   Unit Head                 : SON cluster : installation, collecte,
--                               vérification. Validation finale seulement
--                               par affectation.
--   Assistant Unit Head       : SON cluster : installation, collecte,
--                               soumission. JAMAIS de vérification ni de
--                               validation, même avec une affectation.
--   RT et tout autre rôle     : aucun accès (ni lecture ni écriture).
--   Personne ne valide ni ne vérifie une visite qu'il a observée ou saisie.
-- Les politiques ne donnent que la LECTURE. Aucune politique d'écriture :
-- insert/update/delete directs restent refusés.
-- RETOUR ARRIÈRE : supabase/20261113100400_aflp_observatoire_rollback.sql
-- REJOUABLE : oui.
-- =====================================================================
begin;

create or replace function private.pheno_classe_de(p_user uuid) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select case p.role
    when 'Branch Manager' then 'BM'
    when 'Assistant Branch Manager' then 'ABM'
    when 'Zonal Head' then 'ZH'
    when 'Unit Head' then 'UH'
    when 'Assistant Unit Head' then 'AUH'
    else null end
  from public.profils p where p.user_id = p_user and p.actif limit 1
$$;

create or replace function private.pheno_classe() returns text
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select private.pheno_classe_de(auth.uid())
$$;

create or replace function private.pheno_mon_cluster() returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select public.aflp_cluster_code(p.cluster) from public.profils p where p.user_id = auth.uid() and p.actif limit 1
$$;

create or replace function private.pheno_ma_zone() returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce(
    (select c.zone_code from public.aflp_clusters c where c.code = public.aflp_cluster_code(p.cluster)),
    (select z.code from public.aflp_zones z where public.aflp_norm(z.code) = public.aflp_norm(p.zone)
                                               or public.aflp_norm(z.label) = public.aflp_norm(p.zone) limit 1))
  from public.profils p where p.user_id = auth.uid() and p.actif limit 1
$$;

-- Lecture d'un cluster
create or replace function private.pheno_peut_lire_cluster(p_cluster text) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select coalesce(case private.pheno_classe()
    when 'BM' then true
    when 'ABM' then true
    when 'ZH' then exists (select 1 from public.aflp_clusters c where c.code = p_cluster and c.zone_code = private.pheno_ma_zone())
    when 'UH' then p_cluster = private.pheno_mon_cluster()
    when 'AUH' then p_cluster = private.pheno_mon_cluster()
    else false end, false)
$$;

-- Installation et collecte : agents du cluster, et le Branch Manager
create or replace function private.pheno_peut_collecter(p_cluster text) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select coalesce(case private.pheno_classe()
    when 'BM' then true
    when 'UH' then p_cluster = private.pheno_mon_cluster()
    when 'AUH' then p_cluster = private.pheno_mon_cluster()
    else false end, false)
$$;

-- Affectation agronomique active (campagne, cluster, droit, période)
create or replace function private.pheno_a_affectation(p_campaign uuid, p_cluster text, p_droits text[]) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select exists (
    select 1 from public.pheno_affectations a
    where a.user_id = auth.uid() and a.actif and a.campaign_id = p_campaign
      and p_cluster = any (a.cluster_codes) and a.droit = any (p_droits)
      and a.valide_du <= current_date and (a.valide_au is null or a.valide_au >= current_date))
$$;

-- Vérification : UH de son cluster ; ZH/ABM par affectation ; BM. Jamais AUH.
create or replace function private.pheno_peut_verifier(p_campaign uuid, p_cluster text) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select coalesce(case private.pheno_classe()
    when 'BM' then true
    when 'UH' then p_cluster = private.pheno_mon_cluster()
    when 'ZH' then private.pheno_peut_lire_cluster(p_cluster) and private.pheno_a_affectation(p_campaign, p_cluster, array['VERIFICATION','VALIDATION'])
    when 'ABM' then private.pheno_a_affectation(p_campaign, p_cluster, array['VERIFICATION','VALIDATION'])
    else false end, false)
$$;

-- Validation finale : BM ; ZH/ABM/UH uniquement par affectation VALIDATION. Jamais AUH.
create or replace function private.pheno_peut_valider(p_campaign uuid, p_cluster text) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select coalesce(case private.pheno_classe()
    when 'BM' then true
    when 'ZH' then private.pheno_peut_lire_cluster(p_cluster) and private.pheno_a_affectation(p_campaign, p_cluster, array['VALIDATION'])
    when 'ABM' then private.pheno_a_affectation(p_campaign, p_cluster, array['VALIDATION'])
    when 'UH' then p_cluster = private.pheno_mon_cluster() and private.pheno_a_affectation(p_campaign, p_cluster, array['VALIDATION'])
    else false end, false)
$$;

create or replace function private.pheno_cluster_du_panel(p_panel uuid) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select cluster_code from public.pheno_panels where id = p_panel
$$;

create or replace function private.pheno_peut_lire_panel(p_panel uuid) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select private.pheno_peut_lire_cluster(private.pheno_cluster_du_panel(p_panel))
$$;

create or replace function private.pheno_peut_lire_visite(p_visite uuid) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select private.pheno_peut_lire_cluster((select cluster_code from public.pheno_visites where id = p_visite))
$$;

-- Preuves : chemin <campaign_id>/<panel_id>/<user_id>/<fichier>. Tout chemin
-- non conforme est REFUSÉ (aucune branche « sinon vrai »).
create or replace function private.pheno_uuid_ou_null(p text) returns uuid
language plpgsql immutable set search_path to 'public', 'pg_temp' as $$
begin
  if p ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return p::uuid; end if;
  return null;
end $$;

create or replace function private.pheno_preuve_autorisee(p_name text, p_mode text) returns boolean
language plpgsql stable security definer set search_path to 'public', 'private', 'storage', 'pg_temp' as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_campaign uuid; v_panel uuid; v_user uuid; v_cluster text; v_camp_panel uuid;
begin
  if array_length(v_parts, 1) is distinct from 4 then return false; end if;
  v_campaign := private.pheno_uuid_ou_null(v_parts[1]);
  v_panel := private.pheno_uuid_ou_null(v_parts[2]);
  v_user := private.pheno_uuid_ou_null(v_parts[3]);
  if v_campaign is null or v_panel is null or v_user is null then return false; end if;
  if v_parts[4] !~ '^[A-Za-z0-9_.-]{1,120}\.(jpg|jpeg|png|webp)$' then return false; end if;
  select cluster_code, campaign_id into v_cluster, v_camp_panel from public.pheno_panels where id = v_panel;
  if v_cluster is null or v_camp_panel <> v_campaign then return false; end if;
  if p_mode = 'DEPOT' then
    return v_user = auth.uid() and private.pheno_peut_collecter(v_cluster);
  elsif p_mode = 'LECTURE' then
    return private.pheno_peut_lire_cluster(v_cluster);
  end if;
  return false;
end $$;

-- Politiques de LECTURE --------------------------------------------------
drop policy if exists pheno_protocoles_lecture on public.pheno_protocoles;
create policy pheno_protocoles_lecture on public.pheno_protocoles for select to authenticated
  using (private.pheno_classe() is not null);

drop policy if exists pheno_panels_lecture on public.pheno_panels;
create policy pheno_panels_lecture on public.pheno_panels for select to authenticated
  using (private.pheno_peut_lire_cluster(cluster_code));

drop policy if exists pheno_blocs_lecture on public.pheno_blocs;
create policy pheno_blocs_lecture on public.pheno_blocs for select to authenticated
  using (private.pheno_peut_lire_panel(panel_id));

drop policy if exists pheno_arbres_lecture on public.pheno_arbres;
create policy pheno_arbres_lecture on public.pheno_arbres for select to authenticated
  using (private.pheno_peut_lire_panel(panel_id));

drop policy if exists pheno_affectations_lecture on public.pheno_affectations;
create policy pheno_affectations_lecture on public.pheno_affectations for select to authenticated
  using (private.pheno_classe() = 'BM' or (private.pheno_classe() is not null and user_id = auth.uid()));

drop policy if exists pheno_visites_lecture on public.pheno_visites;
create policy pheno_visites_lecture on public.pheno_visites for select to authenticated
  using (private.pheno_peut_lire_cluster(cluster_code));

drop policy if exists pheno_observations_lecture on public.pheno_observations;
create policy pheno_observations_lecture on public.pheno_observations for select to authenticated
  using (private.pheno_peut_lire_visite(visite_id));

drop policy if exists pheno_corrections_lecture on public.pheno_corrections;
create policy pheno_corrections_lecture on public.pheno_corrections for select to authenticated
  using (private.pheno_peut_lire_visite(visite_id));

drop policy if exists pheno_evenements_lecture on public.pheno_evenements_maturite;
create policy pheno_evenements_lecture on public.pheno_evenements_maturite for select to authenticated
  using (private.pheno_peut_lire_panel(panel_id));

drop policy if exists pheno_journal_lecture on public.pheno_journal;
create policy pheno_journal_lecture on public.pheno_journal for select to authenticated
  using (cluster_code is not null and private.pheno_peut_lire_cluster(cluster_code));

-- Preuves : dépôt et lecture seulement. Ni mise à jour ni suppression.
drop policy if exists pheno_preuves_depot on storage.objects;
create policy pheno_preuves_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'pheno-preuves' and private.pheno_preuve_autorisee(name, 'DEPOT'));
drop policy if exists pheno_preuves_lecture on storage.objects;
create policy pheno_preuves_lecture on storage.objects for select to authenticated
  using (bucket_id = 'pheno-preuves' and private.pheno_preuve_autorisee(name, 'LECTURE'));

-- Droits d'exécution : uniquement sur les fonctions de CE module (aucun
-- privilège d'une fonction existante n'est modifié).
revoke all on function private.pheno_classe(), private.pheno_classe_de(uuid), private.pheno_mon_cluster(), private.pheno_ma_zone(),
  private.pheno_peut_lire_cluster(text), private.pheno_peut_collecter(text), private.pheno_a_affectation(uuid, text, text[]),
  private.pheno_peut_verifier(uuid, text), private.pheno_peut_valider(uuid, text), private.pheno_cluster_du_panel(uuid),
  private.pheno_peut_lire_panel(uuid), private.pheno_peut_lire_visite(uuid), private.pheno_uuid_ou_null(text),
  private.pheno_preuve_autorisee(text, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.pheno_classe(), private.pheno_classe_de(uuid), private.pheno_mon_cluster(), private.pheno_ma_zone(),
  private.pheno_peut_lire_cluster(text), private.pheno_peut_collecter(text), private.pheno_a_affectation(uuid, text, text[]),
  private.pheno_peut_verifier(uuid, text), private.pheno_peut_valider(uuid, text), private.pheno_cluster_du_panel(uuid),
  private.pheno_peut_lire_panel(uuid), private.pheno_peut_lire_visite(uuid), private.pheno_uuid_ou_null(text),
  private.pheno_preuve_autorisee(text, text) to authenticated;

commit;
