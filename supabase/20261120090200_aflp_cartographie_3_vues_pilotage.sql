-- =====================================================================
-- CARTOGRAPHIE DES PARCELLES AFLP · migration 3/3 : VUES ET PILOTAGE
-- ---------------------------------------------------------------------
-- Vues en security_invoker : la RLS des tables sources s'applique telle quelle.
-- Tableau de bord : Branch Manager, Assistant Branch Manager, Zonal Head (limité à
-- SA zone). Aucun indicateur n'est fabriqué à partir de données manquantes : une
-- somme vide vaut null, pas zéro ; aucune coordonnée n'est renvoyée par le tableau.
-- Superficies distinguées : déclarée, cartographiée (dernière version active),
-- validée (somme), emprise unique validée (union géographique), chevauchements.
-- =====================================================================
begin;

create or replace function private.plot_map_nom(p_user uuid) returns text
language sql stable security definer set search_path = public, private, pg_temp as $$
  select p.nom from public.profils p where p.user_id = p_user limit 1
$$;
revoke all on function private.plot_map_nom(uuid) from public, anon;
grant execute on function private.plot_map_nom(uuid) to authenticated;

create or replace view public.plot_map_parcelles_v with (security_invoker = true) as
select fp.id as plot_id, fp.plot_code, fp.producteur_id, pr.code as producteur_code, pr.nom as producteur_nom, pr.prenoms as producteur_prenoms,
       fp.village_id, v.village as village_nom, cx.cluster_code, cx.zone_code, fp.local_name, fp.declared_area, fp.area_unit, fp.tree_count,
       fp.latitude, fp.longitude, fp.gps_accuracy_m, fp.gps_captured_at, fp.gps_status, fp.mapping_status, fp.mapped_area_ha, fp.mapped_area_method,
       fp.current_geometry_id, fp.split_from_plot_id, fp.status as plot_status, fp.record_version,
       private.plot_map_consentement_gps(fp.producteur_id) as consentement_gps,
       lg.id as derniere_geometry_id, lg.status as derniere_status, lg.version_no as derniere_version, lg.area_m2 as derniere_area_m2,
       lg.method as derniere_method, lg.created_at as derniere_le,
       (select count(*) from public.farmer_plot_anomalies a where a.plot_id = fp.id and a.statut = 'OUVERTE')::int as anomalies_ouvertes
from public.farmer_plots fp
join public.producteurs pr on pr.id = fp.producteur_id and not coalesce(pr.deleted, false)
join public.villages v on v.id = fp.village_id
left join lateral private.plot_map_contexte(fp.id) cx on true
left join lateral (select g.id, g.status, g.version_no, g.area_m2, g.method, g.created_at from public.farmer_plot_geometries g
                   where g.plot_id = fp.id and g.status in ('SOUMIS','A_CORRIGER','VALIDE') order by g.version_no desc limit 1) lg on true
where not fp.deleted;

create or replace view public.plot_map_geometries_v with (security_invoker = true) as
select g.id, g.plot_id, g.producteur_id, g.village_id, g.cluster_code, g.zone_code, g.version_no, g.base_geometry_id, g.method,
       extensions.st_asgeojson(g.geom::extensions.geometry, 7)::jsonb as geojson,
       g.area_m2, g.perimeter_m, g.vertex_count, g.imagery_source, g.imagery_date, g.boundary_confidence, g.gps_points,
       g.gps_accuracy_min_m, g.gps_accuracy_median_m, g.gps_accuracy_max_m, g.producer_confirmation, g.producer_confirmation_note, g.notes, g.localisation_source, g.identite_confirmee,
       g.status, g.created_by, private.plot_map_nom(g.created_by) as auteur_nom, g.created_by_role, g.created_at, g.created_at_client,
       g.preverified_by, private.plot_map_nom(g.preverified_by) as preverifie_par_nom, g.preverified_at, g.preverification_note,
       g.decided_by, private.plot_map_nom(g.decided_by) as decide_par_nom, g.decided_at, g.decision_comment, g.decision_exception, g.row_version
from public.farmer_plot_geometries g;

grant select on public.plot_map_parcelles_v, public.plot_map_geometries_v to authenticated;
revoke all on public.plot_map_parcelles_v, public.plot_map_geometries_v from anon;

create or replace function public.plot_map_tableau(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private, extensions, pg_temp as $$
declare
  v_classe text := private.plot_map_classe(); v_zone text; v_res jsonb;
  f_cluster text := nullif(p->>'cluster', ''); f_village text := nullif(p->>'village', ''); f_prod text := nullif(p->>'producteur', '');
  f_statut text := nullif(p->>'statut', ''); f_du date := nullif(p->>'du', '')::date; f_au date := nullif(p->>'au', '')::date;
begin
  if v_classe is null or v_classe not in ('BM','ABM','ZH') then raise exception 'Tableau de bord réservé au Branch Manager, à son assistant et aux Chefs de Zone.' using errcode = 'PM001'; end if;
  if v_classe = 'ZH' then
    v_zone := private.plot_map_ma_zone();
    if v_zone is null then raise exception 'Votre zone n''est pas renseignée dans votre profil : tableau de bord indisponible.' using errcode = 'PM001'; end if;
  end if;
  with base as (
    select fp.id, fp.producteur_id, pr.code as producteur_code, fp.village_id, v.village as village_nom, cx.cluster_code, cx.zone_code,
           fp.plot_code, fp.local_name, fp.declared_area, fp.area_unit, fp.split_from_plot_id, fp.latitude is not null as localisee,
           fp.mapping_status, fp.mapped_area_ha, fp.mapped_area_method, fp.current_geometry_id
    from public.farmer_plots fp
    join public.producteurs pr on pr.id = fp.producteur_id and not coalesce(pr.deleted, false)
    join public.villages v on v.id = fp.village_id
    left join lateral private.plot_map_contexte(fp.id) cx on true
    where not fp.deleted and coalesce(fp.status, 'ACTIVE') = 'ACTIVE'
      and (v_zone is null or cx.zone_code = v_zone)
      and (f_cluster is null or cx.cluster_code = f_cluster)
      and (f_village is null or fp.village_id = f_village)
      and (f_prod is null or pr.code = f_prod or fp.producteur_id = f_prod)
      and (f_statut is null or coalesce(fp.mapping_status, case when fp.latitude is not null then 'LOCALISEE' else 'NON_LOCALISEE' end) = f_statut)
  ), act as (   -- dernière version active de chaque parcelle, dans la période demandée
    select distinct on (g.plot_id) g.* from public.farmer_plot_geometries g join base b on b.id = g.plot_id
    where g.status in ('SOUMIS','A_CORRIGER','VALIDE')
      and (f_du is null or g.created_at::date >= f_du) and (f_au is null or g.created_at::date <= f_au)
    order by g.plot_id, g.version_no desc
  ), val as (
    select g.* from public.farmer_plot_geometries g join base b on b.id = g.plot_id where g.status = 'VALIDE'
  ), ano as (
    select a.* from public.farmer_plot_anomalies a join base b on b.id = a.plot_id where a.statut = 'OUVERTE'
  ), toutes as (
    select g.* from public.farmer_plot_geometries g join base b on b.id = g.plot_id
    where (f_du is null or g.created_at::date >= f_du) and (f_au is null or g.created_at::date <= f_au)
  ), par_cluster as (
    select b.cluster_code,
      count(*) as parcelles,
      count(*) filter (where b.localisee) as localisees,
      count(*) filter (where exists (select 1 from act a where a.plot_id = b.id)) as avec_contour,
      count(*) filter (where b.mapping_status = 'SOUMIS') as soumises,
      count(*) filter (where b.mapping_status = 'VALIDE') as validees,
      count(*) filter (where b.mapping_status = 'A_CORRIGER') as a_corriger,
      round(sum(case when b.split_from_plot_id is null and upper(coalesce(b.area_unit, 'HA')) = 'HA' then b.declared_area end), 2) as declaree_ha,
      round(sum((select a.area_m2 from act a where a.plot_id = b.id)) / 10000, 2) as cartographiee_ha,
      round(sum(b.mapped_area_ha) filter (where b.mapping_status = 'VALIDE'), 2) as validee_ha
    from base b group by b.cluster_code
  )
  select jsonb_build_object(
    'perimetre', case when v_zone is null then 'TOUTES_ZONES' else v_zone end,
    'genere_le', now(),
    'producteurs', (select count(distinct producteur_id) from base),
    'producteurs_localises', (select count(distinct producteur_id) from base where localisee),
    'parcelles', (select count(*) from base),
    'parcelles_localisees', (select count(*) from base where localisee),
    'parcelles_non_localisees', (select count(*) from base where not localisee),
    'parcelles_avec_contour', (select count(*) from act),
    'parcelles_soumises', (select count(*) from base where mapping_status = 'SOUMIS'),
    'parcelles_validees', (select count(*) from base where mapping_status = 'VALIDE'),
    'parcelles_a_corriger', (select count(*) from base where mapping_status = 'A_CORRIGER'),
    'superficie_declaree_ha', (select round(sum(declared_area), 2) from base where split_from_plot_id is null and upper(coalesce(area_unit, 'HA')) = 'HA'),
    'superficie_cartographiee_ha', (select round(sum(area_m2) / 10000, 2) from act),
    'superficie_validee_somme_ha', (select round(sum(area_m2) / 10000, 2) from val),
    'emprise_unique_validee_ha', (select round((extensions.st_area(extensions.st_union(geom::extensions.geometry)::extensions.geography, true) / 10000)::numeric, 2) from val),
    -- Fiabilité de la mesure (niveau 1 : limites visibles et confirmées ; 2 : partiellement visibles ; 3 : incertaines).
    'par_niveau', (select jsonb_build_object(
        'niveau_1', count(*) filter (where boundary_confidence = 'VISIBLES'),
        'niveau_2', count(*) filter (where boundary_confidence = 'PARTIELLES'),
        'niveau_3', count(*) filter (where boundary_confidence in ('INCERTAINES','VERIFICATION_TERRAIN')),
        'sans_marche_complete', count(*) filter (where method in ('SATELLITE','IMPORT_FICHIER'))) from act),
    'chevauchements_ouverts', (select count(*) from ano where type = 'CHEVAUCHEMENT'),
    'chevauchements_ouverts_ha', (select round(sum(overlap_m2) / 10000, 4) from ano where type = 'CHEVAUCHEMENT'),
    'anomalies_ouvertes', (select coalesce(jsonb_object_agg(type, n), '{}'::jsonb) from (select type, count(*) n from ano group by type) x),
    'par_cluster', (select coalesce(jsonb_agg(to_jsonb(c) order by c.cluster_code), '[]'::jsonb) from par_cluster c),
    'par_agent', (select coalesce(jsonb_agg(x order by x->>'agent'), '[]'::jsonb) from (
        select jsonb_build_object('agent', coalesce(private.plot_map_nom(t.created_by), 'Inconnu'), 'role', max(t.created_by_role),
               'contours', count(*), 'valides', count(*) filter (where t.status = 'VALIDE'),
               'a_corriger', count(*) filter (where t.status = 'A_CORRIGER'), 'soumis', count(*) filter (where t.status = 'SOUMIS')) x
        from toutes t group by t.created_by) y),
    'parcelles_detail', (select coalesce(jsonb_agg(jsonb_build_object(
        'plot_id', b.id, 'plot_code', b.plot_code, 'producteur_code', b.producteur_code, 'village', b.village_nom, 'cluster', b.cluster_code,
        'parcelle', b.local_name, 'declaree_ha', case when upper(coalesce(b.area_unit, 'HA')) = 'HA' then b.declared_area end,
        'localisee', b.localisee, 'statut', coalesce(b.mapping_status, case when b.localisee then 'LOCALISEE' else 'NON_LOCALISEE' end),
        'cartographiee_ha', (select round(a.area_m2 / 10000, 4) from act a where a.plot_id = b.id),
        'methode', (select a.method from act a where a.plot_id = b.id),
        'confiance', (select a.boundary_confidence from act a where a.plot_id = b.id),
        'validee_ha', case when b.mapping_status = 'VALIDE' then b.mapped_area_ha end,
        'anomalies', (select count(*) from ano where ano.plot_id = b.id)) order by b.cluster_code, b.village_nom, b.producteur_code), '[]'::jsonb)
      from base b where p->>'detail' = 'oui')
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.plot_map_tableau(jsonb) from public, anon;
grant execute on function public.plot_map_tableau(jsonb) to authenticated;

commit;
