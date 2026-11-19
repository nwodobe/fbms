-- =====================================================================
-- CARTOGRAPHIE DES PARCELLES AFLP · migration 2/3 : DROITS ET RPC
-- ---------------------------------------------------------------------
-- Règles appliquées PAR LE SERVEUR (l'interface n'est qu'un reflet) :
--   * Localiser, tracer, soumettre : Unit Head / Assistant Unit Head de SON
--     cluster ; Branch Manager (supervision). Jamais un Zonal Head, un RT,
--     un profil sans rôle reconnu ni un compte inactif.
--   * Consentement : aucune coordonnée (point ou contour) n'est enregistrée
--     si le dernier consentement du producteur n'accorde pas la portée « gps ».
--   * Pré-vérification : Unit Head du cluster, sur le tracé de son assistant.
--   * Décision (valider / demander correction) : Zonal Head dont la ZONE du
--     profil correspond à la zone du cluster (zone absente = refus) ; jamais
--     l'auteur ; refusée tant qu'une anomalie bloquante est ouverte.
--     Exception Branch Manager : drapeau explicite + justification, journalisée,
--     jamais sur son propre tracé, l'auteur reste inchangé.
--   * Lecture des contours : rôles terrain/supervision du périmètre ; un Zonal
--     Head ne lit que les contours de SA zone (la portée globale du registre
--     décidée le 17/09/2026 n'est pas modifiée).
--   * Indicateurs de fonctionnalité : localisation et contours désactivés par
--     défaut ; contours limités aux clusters pilotes.
-- Codes d'erreur : PM001 refus, PM002 demande invalide, PM409 conflit de version.
-- =====================================================================
begin;

-- ------------------------------------------------------------ outils
create or replace function private.plot_map_param(p_cle text) returns jsonb
language sql stable security definer set search_path = public, private, pg_temp as $$
  select coalesce((select valeur from public.plot_map_parametres where cle = p_cle), '{}'::jsonb)
$$;

create or replace function private.plot_map_seuil(p_nom text, p_defaut numeric) returns numeric
language sql stable security definer set search_path = public, private, pg_temp as $$
  select coalesce(nullif(private.plot_map_param('seuils')->>p_nom, '')::numeric, p_defaut)
$$;

create or replace function private.plot_map_profil() returns public.profils
language sql stable security definer set search_path = public, private, pg_temp as $$
  select p from public.profils p where p.user_id = auth.uid() and p.actif = true limit 1
$$;

create or replace function private.plot_map_classe() returns text
language sql stable security definer set search_path = public, private, pg_temp as $$
  select case p.role
    when 'Branch Manager' then 'BM'
    when 'Branch Manager / Head of Programme' then 'BM'
    when 'Assistant Branch Manager' then 'ABM'
    when 'Zonal Head' then 'ZH'
    when 'Unit Head' then 'UH'
    when 'Assistant Unit Head' then 'AUH'
    else null end
  from public.profils p where p.user_id = auth.uid() and p.actif = true limit 1
$$;

create or replace function private.plot_map_norm(p text) returns text
language sql immutable set search_path = public, private, pg_temp as $$
  select nullif(upper(regexp_replace(translate(coalesce(p, ''), 'ÉÈÊËéèêëÀÂàâÎÏîïÔôÙÛÜùûüÇç''’ -', 'EEEEeeeeAAaaIIiiOoUUUuuuCc_____'), '_+', '_', 'g')), '')
$$;

-- Cluster du profil connecté (UH, AUH) et zone (ZH : zone du profil ; UH/AUH : zone de leur cluster).
create or replace function private.plot_map_mon_cluster() returns text
language sql stable security definer set search_path = public, private, pg_temp as $$
  select c.code from public.aflp_clusters c, public.profils p
  where p.user_id = auth.uid() and p.actif and private.plot_map_norm(c.code) = private.plot_map_norm(p.cluster)
  limit 1
$$;
create or replace function private.plot_map_ma_zone() returns text
language sql stable security definer set search_path = public, private, pg_temp as $$
  select coalesce(
    (select c.zone_code from public.aflp_clusters c where c.code = private.plot_map_mon_cluster()),
    (select z.code from public.aflp_zones z, public.profils p
      where p.user_id = auth.uid() and p.actif
        and (private.plot_map_norm(z.code) = private.plot_map_norm(p.zone) or private.plot_map_norm(z.label) = private.plot_map_norm(p.zone))
      limit 1))
$$;

-- Contexte géographique d'une parcelle : producteur, village, cluster, zone.
create or replace function private.plot_map_contexte(p_plot uuid)
returns table (plot_id uuid, producteur_id text, village_id text, cluster_code text, zone_code text, declared_area numeric, area_unit text, plot_status text, deleted boolean)
language sql stable security definer set search_path = public, private, pg_temp as $$
  select fp.id, fp.producteur_id, fp.village_id, c.code, c.zone_code, fp.declared_area, fp.area_unit, fp.status, fp.deleted
  from public.farmer_plots fp
  join public.villages v on v.id = fp.village_id
  left join public.aflp_clusters c on private.plot_map_norm(c.code) = private.plot_map_norm(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster'))
  where fp.id = p_plot
$$;

-- Consentement : la dernière décision enregistrée doit accorder la portée « gps ».
create or replace function private.plot_map_consentement_gps(p_producteur text) returns boolean
language sql stable security definer set search_path = public, private, pg_temp as $$
  select coalesce((
    select (c.status in ('GRANTED','PARTIAL')) and coalesce((c.scopes->>'gps')::boolean, false)
    from public.farmer_consents c where c.producteur_id = p_producteur
    order by c.event_order desc nulls last, c.created_at desc limit 1), false)
$$;

-- Lecture d'un contour : périmètre du registre + restriction de zone pour un Zonal Head.
create or replace function private.plot_map_peut_lire(p_producteur text, p_zone text) returns boolean
language sql stable security definer set search_path = public, private, pg_temp as $$
  select public.est_actif()
     and private.plot_map_classe() is not null
     and private.farmer_registry_can_access_producteur(p_producteur)
     and (private.plot_map_classe() <> 'ZH' or (private.plot_map_ma_zone() is not null and private.plot_map_ma_zone() = p_zone))
$$;

-- Droit d'écriture terrain sur une parcelle (localiser, tracer, ajouter).
create or replace function private.plot_map_peut_saisir(p_cluster text, p_producteur text) returns boolean
language sql stable security definer set search_path = public, private, pg_temp as $$
  select case private.plot_map_classe()
    when 'BM' then true
    when 'UH' then private.plot_map_mon_cluster() is not null and private.plot_map_mon_cluster() = p_cluster
    when 'AUH' then private.plot_map_mon_cluster() is not null and private.plot_map_mon_cluster() = p_cluster
    else false end
    and private.farmer_registry_can_access_producteur(p_producteur)
$$;

create or replace function private.plot_map_actif(p_quoi text, p_cluster text) returns boolean
language sql stable security definer set search_path = public, private, pg_temp as $$
  select case p_quoi
    when 'localisation' then coalesce((private.plot_map_param('activation')->>'localisation')::boolean, false)
    when 'contours' then coalesce((private.plot_map_param('activation')->>'contours')::boolean, false)
      and exists (select 1 from jsonb_array_elements_text(coalesce(private.plot_map_param('activation')->'clusters_pilotes', '[]'::jsonb)) x
                  where private.plot_map_norm(x) = private.plot_map_norm(p_cluster))
    else false end
$$;

create or replace function private.plot_map_journaliser(p_plot uuid, p_geom uuid, p_action text, p_avant jsonb, p_apres jsonb, p_motif text)
returns void language sql security definer set search_path = public, private, pg_temp as $$
  insert into public.farmer_plot_map_events (plot_id, geometry_id, acteur, acteur_role, action, avant, apres, motif)
  values (p_plot, p_geom, auth.uid(), private.plot_map_classe(), p_action, p_avant, p_apres, p_motif)
$$;

create or replace function private.plot_map_hex(p text) returns text
language sql immutable set search_path = public, pg_temp as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- ------------------------------------------------------------ lectures (RLS)
drop policy if exists plot_map_geom_select on public.farmer_plot_geometries;
create policy plot_map_geom_select on public.farmer_plot_geometries for select to authenticated
  using (private.farmer_registry_can_read_sensitive() and private.plot_map_peut_lire(producteur_id, zone_code));
drop policy if exists plot_map_anom_select on public.farmer_plot_anomalies;
create policy plot_map_anom_select on public.farmer_plot_anomalies for select to authenticated
  using (private.farmer_registry_can_read_sensitive()
         and exists (select 1 from public.farmer_plot_geometries g where g.id = geometry_id and private.plot_map_peut_lire(g.producteur_id, g.zone_code)));
drop policy if exists plot_map_events_select on public.farmer_plot_map_events;
create policy plot_map_events_select on public.farmer_plot_map_events for select to authenticated
  using (exists (select 1 from public.farmer_plots fp join private.plot_map_contexte(fp.id) cx on true
                 where fp.id = plot_id and private.plot_map_peut_lire(cx.producteur_id, cx.zone_code)));
drop policy if exists plot_map_param_select on public.plot_map_parametres;
create policy plot_map_param_select on public.plot_map_parametres for select to authenticated using (public.est_actif());

grant select on public.farmer_plot_geometries, public.farmer_plot_anomalies, public.farmer_plot_map_events, public.plot_map_parametres to authenticated;

-- ------------------------------------------------------------ 1. localiser le champ
create or replace function public.plot_map_localiser(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_plot uuid := (p->>'plot_id')::uuid;
  v_lat numeric := (p->>'latitude')::numeric; v_lng numeric := (p->>'longitude')::numeric;
  v_prec numeric := (p->>'precision_m')::numeric; v_le timestamptz := coalesce((p->>'capture_le')::timestamptz, now());
  cx record; v_avant jsonb; v_max numeric := private.plot_map_seuil('precision_localisation_max_m', 50);
begin
  if auth.uid() is null or private.plot_map_classe() is null then raise exception 'Accès refusé.' using errcode = 'PM001'; end if;
  select * into cx from private.plot_map_contexte(v_plot);
  if cx.plot_id is null or cx.deleted then raise exception 'Parcelle introuvable.' using errcode = 'PM002'; end if;
  if cx.cluster_code is null then raise exception 'Le village de cette parcelle n''est rattaché à aucun cluster AFLP.' using errcode = 'PM002'; end if;
  if not private.plot_map_actif('localisation', cx.cluster_code) then raise exception 'La localisation des champs n''est pas encore activée.' using errcode = 'PM001'; end if;
  if not private.plot_map_peut_saisir(cx.cluster_code, cx.producteur_id) then raise exception 'Cette parcelle est hors de votre périmètre.' using errcode = 'PM001'; end if;
  if coalesce((private.plot_map_param('consentement')->>'gps_requis')::boolean, true) and not private.plot_map_consentement_gps(cx.producteur_id) then
    raise exception 'Le producteur n''a pas donné son accord pour l''enregistrement des données GPS. Recueillez d''abord son consentement.' using errcode = 'PM001'; end if;
  if v_lat is null or v_lng is null or v_lat not between 4 and 11 or v_lng not between -9 and -2 then
    raise exception 'Position hors de la Côte d''Ivoire ou illisible.' using errcode = 'PM002'; end if;
  if v_prec is null or v_prec <= 0 then raise exception 'Précision GPS absente.' using errcode = 'PM002'; end if;
  if v_prec > v_max then raise exception 'Précision insuffisante (% m, maximum % m). Placez-vous à découvert dans le champ et réessayez.', round(v_prec), v_max using errcode = 'PM002'; end if;
  if v_le > now() + interval '10 minutes' then raise exception 'Heure du téléphone dans le futur : corrigez l''heure du téléphone.' using errcode = 'PM002'; end if;
  select jsonb_build_object('latitude', latitude, 'longitude', longitude, 'gps_accuracy_m', gps_accuracy_m, 'gps_status', gps_status, 'gps_captured_at', gps_captured_at)
    into v_avant from public.farmer_plots where id = v_plot for update;
  update public.farmer_plots
     set latitude = round(v_lat, 7), longitude = round(v_lng, 7), gps_accuracy_m = round(v_prec, 2), gps_captured_at = v_le,
         gps_status = case when gps_status = 'GPS_VERIFIED' then 'GPS_VERIFIED' else 'POINT_CAPTURED' end,
         updated_by = auth.uid()
   where id = v_plot;
  perform private.plot_map_journaliser(v_plot, null, 'LOCALISER', v_avant,
    jsonb_build_object('latitude', round(v_lat, 7), 'longitude', round(v_lng, 7), 'gps_accuracy_m', round(v_prec, 2), 'capture_le', v_le), null);
  return jsonb_build_object('statut', 'ACCEPTEE', 'plot_id', v_plot, 'precision_m', round(v_prec, 2), 'recu_serveur_le', now());
end $$;

-- ------------------------------------------------------------ 2. ajouter une parcelle
create or replace function public.plot_map_ajouter_parcelle(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_id uuid := coalesce((p->>'id')::uuid, gen_random_uuid());
  v_prod text := p->>'producteur_id'; v_parent uuid := nullif(p->>'split_from_plot_id', '')::uuid;
  v_village text; v_cluster text; v_parent_prod text; v_exist record;
begin
  if auth.uid() is null or private.plot_map_classe() is null then raise exception 'Accès refusé.' using errcode = 'PM001'; end if;
  select * into v_exist from public.farmer_plots where id = v_id;
  if v_exist.id is not null then
    if v_exist.producteur_id = v_prod then return jsonb_build_object('statut', 'ACCEPTEE', 'plot_id', v_id, 'rejoue', true); end if;
    raise exception 'Identifiant de parcelle déjà utilisé.' using errcode = 'PM002';
  end if;
  select pr.village_id into v_village from public.producteurs pr where pr.id = v_prod and not coalesce(pr.deleted, false);
  if v_village is null then raise exception 'Producteur introuvable.' using errcode = 'PM002'; end if;
  select c.code into v_cluster from public.villages v
    left join public.aflp_clusters c on private.plot_map_norm(c.code) = private.plot_map_norm(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster'))
   where v.id = v_village;
  if v_cluster is null then raise exception 'Le village du producteur n''est rattaché à aucun cluster AFLP.' using errcode = 'PM002'; end if;
  if not private.plot_map_actif('contours', v_cluster) then raise exception 'La cartographie des parcelles n''est pas activée pour ce cluster.' using errcode = 'PM001'; end if;
  if not private.plot_map_peut_saisir(v_cluster, v_prod) then raise exception 'Ce producteur est hors de votre périmètre.' using errcode = 'PM001'; end if;
  if v_parent is not null then
    select producteur_id into v_parent_prod from public.farmer_plots where id = v_parent and not deleted;
    if v_parent_prod is distinct from v_prod then raise exception 'La parcelle d''origine doit appartenir au même producteur.' using errcode = 'PM002'; end if;
  end if;
  if nullif(p->>'declared_area', '') is not null and (p->>'declared_area')::numeric <= 0 then raise exception 'Superficie déclarée invalide.' using errcode = 'PM002'; end if;
  insert into public.farmer_plots (id, producteur_id, village_id, local_name, declared_area, area_unit, status, notes, split_from_plot_id, created_by, updated_by)
  values (v_id, v_prod, v_village, nullif(btrim(p->>'local_name'), ''), nullif(p->>'declared_area', '')::numeric, 'HA', 'ACTIVE',
          nullif(btrim(p->>'notes'), ''), v_parent, auth.uid(), auth.uid());
  perform private.plot_map_journaliser(v_id, null, 'AJOUTER_PARCELLE', null,
    jsonb_build_object('producteur_id', v_prod, 'local_name', p->>'local_name', 'split_from_plot_id', v_parent), null);
  return jsonb_build_object('statut', 'ACCEPTEE', 'plot_id', v_id, 'recu_serveur_le', now());
end $$;

-- ------------------------------------------------------------ 3. soumettre un contour
create or replace function public.plot_map_soumettre(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare
  v_id uuid := (p->>'id')::uuid; v_plot uuid := (p->>'plot_id')::uuid;
  v_base uuid := nullif(p->>'base_geometry_id', '')::uuid;
  v_method text := p->>'method'; v_conf text := p->>'boundary_confidence';
  cx record; g extensions.geometry; v_area numeric; v_per numeric; v_n int; v_hash text; v_exist record;
  v_actuelle record; v_version int; v_conflit boolean := false; v_tol numeric := private.plot_map_seuil('tolerance_calcul_pct', 0.5);
  v_client_area numeric := nullif(p->>'area_m2_client', '')::numeric; v_decl_m2 numeric; v_ecart numeric; r record; v_inter numeric;
  v_anomalies int := 0; v_classe text := private.plot_map_classe();
begin
  if auth.uid() is null or v_classe is null then raise exception 'Accès refusé.' using errcode = 'PM001'; end if;
  if v_id is null or v_plot is null then raise exception 'Identifiants manquants.' using errcode = 'PM002'; end if;
  v_hash := private.plot_map_hex(jsonb_build_object('plot', v_plot, 'g', p->'geometrie', 'm', v_method, 'c', v_conf, 'b', v_base)::text);
  select * into v_exist from public.farmer_plot_geometries where id = v_id;
  if v_exist.id is not null then
    if v_exist.created_by = auth.uid() and v_exist.request_hash = v_hash then
      return jsonb_build_object('statut', 'ACCEPTEE', 'rejoue', true, 'geometry_id', v_id, 'area_m2', v_exist.area_m2, 'perimeter_m', v_exist.perimeter_m,
                                'version_no', v_exist.version_no, 'recu_serveur_le', v_exist.created_at);
    end if;
    raise exception 'Identifiant de contour déjà utilisé pour un autre tracé.' using errcode = 'PM002';
  end if;
  select * into cx from private.plot_map_contexte(v_plot);
  if cx.plot_id is null or cx.deleted then raise exception 'Parcelle introuvable.' using errcode = 'PM002'; end if;
  if cx.cluster_code is null then raise exception 'Le village de cette parcelle n''est rattaché à aucun cluster AFLP.' using errcode = 'PM002'; end if;
  if not private.plot_map_actif('contours', cx.cluster_code) then raise exception 'La cartographie des parcelles n''est pas activée pour ce cluster.' using errcode = 'PM001'; end if;
  if not private.plot_map_peut_saisir(cx.cluster_code, cx.producteur_id) then raise exception 'Cette parcelle est hors de votre périmètre.' using errcode = 'PM001'; end if;
  if coalesce((private.plot_map_param('consentement')->>'gps_requis')::boolean, true) and not private.plot_map_consentement_gps(cx.producteur_id) then
    raise exception 'Le producteur n''a pas donné son accord pour l''enregistrement des données GPS. Aucun contour ne peut être enregistré.' using errcode = 'PM001'; end if;
  if v_method is null or v_method not in ('SATELLITE','GPS_POINTS','IMPORT_FICHIER','MIXTE') then raise exception 'Méthode de relevé inconnue.' using errcode = 'PM002'; end if;
  if v_conf is null or v_conf not in ('VISIBLES','PARTIELLES','INCERTAINES','VERIFICATION_TERRAIN') then raise exception 'Indiquez si les limites sont visibles.' using errcode = 'PM002'; end if;
  -- Géométrie : polygone simple, fermé, valide, en WGS84, en Côte d'Ivoire.
  if jsonb_typeof(p->'geometrie') <> 'object' or p->'geometrie'->>'type' <> 'Polygon' then raise exception 'Le contour doit être un polygone.' using errcode = 'PM002'; end if;
  begin
    g := extensions.st_setsrid(extensions.st_geomfromgeojson((p->'geometrie')::text), 4326);
  exception when others then raise exception 'Contour illisible ou non fermé.' using errcode = 'PM002';
  end;
  if extensions.st_geometrytype(g) <> 'ST_Polygon' or extensions.st_numinteriorrings(g) > 0 then raise exception 'Le contour doit être un seul polygone, sans trou.' using errcode = 'PM002'; end if;
  if not extensions.st_isclosed(extensions.st_exteriorring(g)) then raise exception 'Le contour n''est pas fermé.' using errcode = 'PM002'; end if;
  v_n := extensions.st_npoints(extensions.st_removerepeatedpoints(extensions.st_exteriorring(g))) - 1;
  if v_n < 3 then raise exception 'Il faut au moins 3 sommets distincts.' using errcode = 'PM002'; end if;
  if not extensions.st_isvalid(g) then raise exception 'Les lignes du contour se croisent : déplacez les sommets pour supprimer le croisement.' using errcode = 'PM002'; end if;
  if extensions.st_xmin(g) < -9 or extensions.st_xmax(g) > -2 or extensions.st_ymin(g) < 4 or extensions.st_ymax(g) > 11 then
    raise exception 'Contour hors de la Côte d''Ivoire : vérifiez l''ordre longitude, latitude.' using errcode = 'PM002'; end if;
  v_area := round(extensions.st_area(g::extensions.geography, true)::numeric, 2);
  v_per := round(extensions.st_perimeter(g::extensions.geography, true)::numeric, 2);
  if v_area < private.plot_map_seuil('superficie_min_m2', 100) then raise exception 'Contour trop petit (% m²) : vérifiez les sommets.', v_area using errcode = 'PM002'; end if;
  if v_area > private.plot_map_seuil('superficie_max_ha', 200) * 10000 then raise exception 'Contour trop grand (% ha) : vérifiez les sommets.', round(v_area / 10000, 2) using errcode = 'PM002'; end if;
  if v_client_area is not null and abs(v_client_area - v_area) / v_area * 100 > v_tol then
    raise exception 'Écart de calcul entre le téléphone (% m²) et le serveur (% m²) : mettez à jour l''application.', v_client_area, v_area using errcode = 'PM002'; end if;
  if v_method = 'GPS_POINTS' and coalesce((p->>'gps_points')::int, 0) < 3 then raise exception 'Mesure GPS : au moins 3 points relevés sont nécessaires.' using errcode = 'PM002'; end if;

  -- Version et conflit : la base annoncée doit être la dernière version active.
  perform pg_advisory_xact_lock(hashtextextended('plot_map:' || v_plot::text, 0));
  select * into v_actuelle from public.farmer_plot_geometries
   where plot_id = v_plot and status in ('SOUMIS','A_CORRIGER','VALIDE') order by version_no desc limit 1;
  if v_actuelle.id is not null and v_base is distinct from v_actuelle.id then v_conflit := true; end if;
  select coalesce(max(version_no), 0) + 1 into v_version from public.farmer_plot_geometries where plot_id = v_plot;

  insert into public.farmer_plot_geometries (id, plot_id, producteur_id, village_id, cluster_code, zone_code, version_no, base_geometry_id, method, geom,
    geojson_client, area_m2, perimeter_m, area_m2_client, perimeter_m_client, vertex_count, imagery_source, imagery_date, boundary_confidence,
    gps_points, gps_accuracy_min_m, gps_accuracy_median_m, gps_accuracy_max_m, producer_confirmation, producer_confirmation_note, notes, status,
    created_by, created_by_role, device_id, client_operation_id, request_hash, created_at_client)
  values (v_id, v_plot, cx.producteur_id, cx.village_id, cx.cluster_code, cx.zone_code, v_version, v_base, v_method, g::extensions.geography,
    p->'geometrie', v_area, v_per, v_client_area, nullif(p->>'perimeter_m_client', '')::numeric, v_n, nullif(p->>'imagery_source', ''),
    nullif(p->>'imagery_date', '')::date, v_conf, nullif(p->>'gps_points', '')::int, nullif(p->>'gps_accuracy_min_m', '')::numeric,
    nullif(p->>'gps_accuracy_median_m', '')::numeric, nullif(p->>'gps_accuracy_max_m', '')::numeric,
    coalesce(nullif(p->>'producer_confirmation', ''), 'NON_DEMANDEE'), nullif(btrim(p->>'producer_confirmation_note'), ''), nullif(btrim(p->>'notes'), ''),
    'SOUMIS', auth.uid(), v_classe, nullif(p->>'device_id', ''), nullif(p->>'client_operation_id', ''), v_hash, nullif(p->>'created_at_client', '')::timestamptz);

  -- Une version soumise sur la bonne base remplace les versions encore en cours (jamais une version VALIDE).
  if not v_conflit then
    update public.farmer_plot_geometries set status = 'REMPLACE', row_version = row_version + 1
     where plot_id = v_plot and id <> v_id and status in ('SOUMIS','A_CORRIGER');
  else
    insert into public.farmer_plot_anomalies (geometry_id, plot_id, other_geometry_id, other_plot_id, cluster_code, zone_code, type, detail, bloquante)
    values (v_id, v_plot, v_actuelle.id, v_plot, cx.cluster_code, cx.zone_code, 'CONFLIT_VERSION',
            jsonb_build_object('base_annoncee', v_base, 'derniere_version', v_actuelle.id, 'derniere_version_no', v_actuelle.version_no), true);
    v_anomalies := v_anomalies + 1;
  end if;

  -- Chevauchements avec la dernière version active des AUTRES parcelles.
  for r in
    select distinct on (o.plot_id) o.id, o.plot_id, o.geom from public.farmer_plot_geometries o
     where o.plot_id <> v_plot and o.status in ('SOUMIS','A_CORRIGER','VALIDE')
       and extensions.st_intersects(o.geom::extensions.geometry, g)
     order by o.plot_id, (o.status = 'VALIDE') desc, o.version_no desc
  loop
    v_inter := round(extensions.st_area(extensions.st_intersection(r.geom::extensions.geometry, g)::extensions.geography, true)::numeric, 2);
    if v_inter >= private.plot_map_seuil('chevauchement_min_m2', 1) then
      insert into public.farmer_plot_anomalies (geometry_id, plot_id, other_geometry_id, other_plot_id, cluster_code, zone_code, type, overlap_m2, detail, bloquante)
      values (v_id, v_plot, r.id, r.plot_id, cx.cluster_code, cx.zone_code, 'CHEVAUCHEMENT', v_inter,
              jsonb_build_object('part_du_contour_pct', round(v_inter / v_area * 100, 1)), true);
      v_anomalies := v_anomalies + 1;
    end if;
  end loop;

  -- Écart avec la superficie déclarée (non bloquant).
  if cx.declared_area is not null and cx.declared_area > 0 then
    v_decl_m2 := case upper(coalesce(cx.area_unit, 'HA')) when 'HA' then cx.declared_area * 10000 when 'M2' then cx.declared_area when 'ACRE' then cx.declared_area * 4046.8564224 else null end;
    if v_decl_m2 is not null then
      v_ecart := round((v_area - v_decl_m2) / v_decl_m2 * 100, 1);
      if abs(v_ecart) > private.plot_map_seuil('ecart_superficie_pct', 20) then
        insert into public.farmer_plot_anomalies (geometry_id, plot_id, cluster_code, zone_code, type, detail, bloquante)
        values (v_id, v_plot, cx.cluster_code, cx.zone_code, 'ECART_SUPERFICIE',
                jsonb_build_object('declaree_m2', v_decl_m2, 'cartographiee_m2', v_area, 'ecart_pct', v_ecart), false);
        v_anomalies := v_anomalies + 1;
      end if;
    end if;
  end if;
  -- Précision GPS insuffisante (non bloquante, signalée au validateur).
  if v_method in ('GPS_POINTS','MIXTE') and nullif(p->>'gps_accuracy_max_m', '')::numeric > private.plot_map_seuil('precision_gps_max_m', 30) then
    insert into public.farmer_plot_anomalies (geometry_id, plot_id, cluster_code, zone_code, type, detail, bloquante)
    values (v_id, v_plot, cx.cluster_code, cx.zone_code, 'PRECISION_GPS',
            jsonb_build_object('precision_max_m', (p->>'gps_accuracy_max_m')::numeric, 'seuil_m', private.plot_map_seuil('precision_gps_max_m', 30)), false);
    v_anomalies := v_anomalies + 1;
  end if;

  update public.farmer_plots set mapping_status = 'SOUMIS', updated_by = auth.uid(),
         plot_code = coalesce(plot_code, 'PLT-' || cx.cluster_code || '-' || upper(substr(replace(v_plot::text, '-', ''), 1, 8)))
   where id = v_plot and (mapping_status is distinct from 'SOUMIS' or plot_code is null);
  perform private.plot_map_journaliser(v_plot, v_id, 'SOUMETTRE', null,
    jsonb_build_object('version_no', v_version, 'area_m2', v_area, 'perimeter_m', v_per, 'method', v_method, 'conflit', v_conflit), null);
  return jsonb_build_object('statut', 'ACCEPTEE', 'geometry_id', v_id, 'version_no', v_version, 'area_m2', v_area, 'perimeter_m', v_per,
                            'anomalies', v_anomalies, 'conflit', v_conflit, 'recu_serveur_le', now());
end $$;

-- ------------------------------------------------------------ 4. pré-vérifier (Unit Head)
create or replace function public.plot_map_preverifier(p_geometry uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v public.farmer_plot_geometries;
begin
  select * into v from public.farmer_plot_geometries where id = p_geometry for update;
  if v.id is null then raise exception 'Contour introuvable.' using errcode = 'PM002'; end if;
  if private.plot_map_classe() is distinct from 'UH' or private.plot_map_mon_cluster() is distinct from v.cluster_code then
    raise exception 'Seul le Chef d''Unité du cluster pré-vérifie.' using errcode = 'PM001'; end if;
  if v.created_by = auth.uid() then raise exception 'Vous ne pouvez pas pré-vérifier votre propre tracé.' using errcode = 'PM001'; end if;
  if v.status <> 'SOUMIS' then raise exception 'Seul un contour soumis peut être pré-vérifié.' using errcode = 'PM002'; end if;
  update public.farmer_plot_geometries set preverified_by = auth.uid(), preverified_at = now(), preverification_note = nullif(btrim(p_note), ''), row_version = row_version + 1
   where id = p_geometry;
  perform private.plot_map_journaliser(v.plot_id, v.id, 'PREVERIFIER', null, null, p_note);
  return jsonb_build_object('statut', 'ACCEPTEE');
end $$;

-- ------------------------------------------------------------ 5. décider (Zonal Head ; BM en exception)
create or replace function public.plot_map_decider(p_geometry uuid, p_decision text, p_commentaire text default null,
                                                   p_version integer default null, p_exception boolean default false) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v public.farmer_plot_geometries; v_classe text := private.plot_map_classe(); v_ancienne uuid; v_bloq int;
begin
  select * into v from public.farmer_plot_geometries where id = p_geometry for update;
  if v.id is null then raise exception 'Contour introuvable.' using errcode = 'PM002'; end if;
  if p_decision not in ('VALIDER','A_CORRIGER') then raise exception 'Décision inconnue.' using errcode = 'PM002'; end if;
  if v_classe = 'ZH' then
    if private.plot_map_ma_zone() is null then raise exception 'Votre zone n''est pas renseignée dans votre profil : validation impossible.' using errcode = 'PM001'; end if;
    if private.plot_map_ma_zone() is distinct from v.zone_code then raise exception 'Ce contour n''est pas dans votre zone.' using errcode = 'PM001'; end if;
    if p_exception then raise exception 'L''exception est réservée au Branch Manager.' using errcode = 'PM001'; end if;
  elsif v_classe = 'BM' then
    if not coalesce(p_exception, false) then raise exception 'Le Branch Manager ne décide qu''en exception justifiée.' using errcode = 'PM001'; end if;
    if length(btrim(coalesce(p_commentaire, ''))) < 15 then raise exception 'Exception : justification d''au moins 15 caractères obligatoire.' using errcode = 'PM002'; end if;
  else
    raise exception 'Seul le Chef de Zone compétent valide les contours.' using errcode = 'PM001';
  end if;
  if v.created_by = auth.uid() then raise exception 'Vous ne pouvez pas décider sur votre propre tracé.' using errcode = 'PM001'; end if;
  if v.status <> 'SOUMIS' then raise exception 'Ce contour n''est plus en attente de décision (statut %).', v.status using errcode = 'PM409'; end if;
  if p_version is not null and p_version <> v.row_version then raise exception 'Le contour a changé depuis votre lecture : rechargez la page.' using errcode = 'PM409'; end if;
  if p_decision = 'A_CORRIGER' then
    if length(btrim(coalesce(p_commentaire, ''))) < 5 then raise exception 'Expliquez ce qu''il faut corriger.' using errcode = 'PM002'; end if;
    update public.farmer_plot_geometries set status = 'A_CORRIGER', decided_by = auth.uid(), decided_at = now(), decision_comment = btrim(p_commentaire),
           decision_exception = coalesce(p_exception, false), row_version = row_version + 1 where id = v.id;
    update public.farmer_plots set mapping_status = 'A_CORRIGER', updated_by = auth.uid() where id = v.plot_id;
  else
    select count(*) into v_bloq from public.farmer_plot_anomalies where geometry_id = v.id and statut = 'OUVERTE' and bloquante;
    if v_bloq > 0 then raise exception 'Validation impossible : % anomalie(s) bloquante(s) à traiter d''abord.', v_bloq using errcode = 'PM001'; end if;
    select id into v_ancienne from public.farmer_plot_geometries where plot_id = v.plot_id and status = 'VALIDE' for update;
    if v_ancienne is not null then update public.farmer_plot_geometries set status = 'REMPLACE', row_version = row_version + 1 where id = v_ancienne; end if;
    update public.farmer_plot_geometries set status = 'VALIDE', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(btrim(p_commentaire), ''),
           decision_exception = coalesce(p_exception, false), row_version = row_version + 1 where id = v.id;
    update public.farmer_plots set mapping_status = 'VALIDE', current_geometry_id = v.id, mapped_area_ha = round(v.area_m2 / 10000, 4),
           mapped_area_method = case v.method when 'SATELLITE' then 'SATELLITE_ESTIMEE' when 'GPS_POINTS' then 'GPS_MESUREE' when 'IMPORT_FICHIER' then 'IMPORT_FICHIER' else 'MIXTE' end,
           updated_by = auth.uid()
     where id = v.plot_id;
  end if;
  perform private.plot_map_journaliser(v.plot_id, v.id, case when p_decision = 'VALIDER' then 'VALIDER' else 'DEMANDER_CORRECTION' end
    || case when p_exception then '_EXCEPTION_BM' else '' end,
    jsonb_build_object('status', v.status, 'remplace', v_ancienne), null, p_commentaire);
  return jsonb_build_object('statut', 'ACCEPTEE', 'decision', p_decision);
end $$;

-- ------------------------------------------------------------ 6. classer une anomalie
create or replace function public.plot_map_classer_anomalie(p_anomalie uuid, p_classification text, p_justification text) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare a public.farmer_plot_anomalies; v_classe text := private.plot_map_classe(); v_ok text[];
begin
  select * into a from public.farmer_plot_anomalies where id = p_anomalie for update;
  if a.id is null then raise exception 'Anomalie introuvable.' using errcode = 'PM002'; end if;
  if v_classe = 'ZH' then
    if private.plot_map_ma_zone() is null or private.plot_map_ma_zone() is distinct from a.zone_code then raise exception 'Cette anomalie n''est pas dans votre zone.' using errcode = 'PM001'; end if;
  elsif v_classe <> 'BM' or v_classe is null then raise exception 'Seul le Chef de Zone ou le Branch Manager traite les anomalies.' using errcode = 'PM001';
  end if;
  if a.statut <> 'OUVERTE' then raise exception 'Anomalie déjà traitée.' using errcode = 'PM409'; end if;
  if length(btrim(coalesce(p_justification, ''))) < 10 then raise exception 'Justification d''au moins 10 caractères obligatoire.' using errcode = 'PM002'; end if;
  v_ok := case a.type
    when 'CHEVAUCHEMENT' then array['LEGITIME_FAMILIAL','LIMITE_PARTAGEE','ERREUR_TRACE','SUPERPOSITION_DECLAREE']
    when 'CONFLIT_VERSION' then array['CONFLIT_TRAITE']
    when 'ECART_SUPERFICIE' then array['ECART_CONFIRME','ECART_A_CORRIGER']
    when 'PRECISION_GPS' then array['PRECISION_ACCEPTEE','ERREUR_TRACE'] end;
  if not (p_classification = any(v_ok)) then raise exception 'Classement non prévu pour ce type d''anomalie.' using errcode = 'PM002'; end if;
  update public.farmer_plot_anomalies set statut = 'RESOLUE', classification = p_classification, justification = btrim(p_justification),
         decided_by = auth.uid(), decided_at = now() where id = a.id;
  -- Une erreur de tracé renvoie le contour concerné en correction (jamais de modification de la géométrie).
  if p_classification in ('ERREUR_TRACE','ECART_A_CORRIGER') then
    update public.farmer_plot_geometries set status = 'A_CORRIGER', decided_by = auth.uid(), decided_at = now(),
           decision_comment = 'Anomalie ' || a.type || ' : ' || btrim(p_justification), row_version = row_version + 1
     where id = a.geometry_id and status = 'SOUMIS';
    update public.farmer_plots set mapping_status = 'A_CORRIGER' where id = a.plot_id and mapping_status = 'SOUMIS';
  end if;
  perform private.plot_map_journaliser(a.plot_id, a.geometry_id, 'CLASSER_ANOMALIE', jsonb_build_object('type', a.type), jsonb_build_object('classification', p_classification), p_justification);
  return jsonb_build_object('statut', 'ACCEPTEE');
end $$;

-- ------------------------------------------------------------ 7. archiver (Branch Manager)
create or replace function public.plot_map_archiver(p_geometry uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v public.farmer_plot_geometries;
begin
  if private.plot_map_classe() is distinct from 'BM' then raise exception 'Archivage réservé au Branch Manager.' using errcode = 'PM001'; end if;
  if length(btrim(coalesce(p_motif, ''))) < 10 then raise exception 'Motif d''au moins 10 caractères obligatoire.' using errcode = 'PM002'; end if;
  select * into v from public.farmer_plot_geometries where id = p_geometry for update;
  if v.id is null or v.status in ('ARCHIVE','REMPLACE') then raise exception 'Contour introuvable ou déjà inactif.' using errcode = 'PM002'; end if;
  update public.farmer_plot_geometries set status = 'ARCHIVE', row_version = row_version + 1 where id = v.id;
  if v.status = 'VALIDE' then
    update public.farmer_plots set current_geometry_id = null, mapped_area_ha = null, mapped_area_method = null, mapping_status = 'ARCHIVE' where id = v.plot_id;
  end if;
  perform private.plot_map_journaliser(v.plot_id, v.id, 'ARCHIVER', jsonb_build_object('status', v.status), null, p_motif);
  return jsonb_build_object('statut', 'ACCEPTEE');
end $$;

-- ------------------------------------------------------------ 8. paramètres (Branch Manager)
create or replace function public.plot_map_parametre_definir(p_cle text, p_valeur jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_avant jsonb;
begin
  if private.plot_map_classe() is distinct from 'BM' then raise exception 'Paramétrage réservé au Branch Manager.' using errcode = 'PM001'; end if;
  if p_cle not in ('activation','imagerie','seuils','consentement') or jsonb_typeof(p_valeur) <> 'object' then raise exception 'Paramètre inconnu.' using errcode = 'PM002'; end if;
  if p_cle = 'imagerie' and coalesce(p_valeur->>'fournisseur', 'aucun') not in ('aucun','osm')
     and not coalesce((p_valeur->>'licence_confirmee')::boolean, false) then
    raise exception 'Imagerie satellite : la licence doit être confirmée avant activation.' using errcode = 'PM001'; end if;
  select valeur into v_avant from public.plot_map_parametres where cle = p_cle for update;
  insert into public.plot_map_parametres (cle, valeur, maj_le, maj_par) values (p_cle, p_valeur, now(), auth.uid())
  on conflict (cle) do update set valeur = excluded.valeur, maj_le = now(), maj_par = auth.uid();
  insert into public.farmer_plot_map_events (plot_id, acteur, acteur_role, action, avant, apres)
  values ('00000000-0000-0000-0000-000000000000', auth.uid(), 'BM', 'PARAMETRE_' || upper(p_cle), v_avant, p_valeur);
  return jsonb_build_object('statut', 'ACCEPTEE');
end $$;

-- ------------------------------------------------------------ 9. file hors ligne (modèle Observatoire)
create or replace function public.plot_map_sync_batch(p_operations jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_op jsonb; v_cle text; v_hash text; v_recu private.plot_map_sync_recus; v_res jsonb; v_out jsonb := '[]'::jsonb; v_payload jsonb; v_diag text;
begin
  if auth.uid() is null or private.plot_map_classe() is null then raise exception 'Accès refusé.' using errcode = 'PM001'; end if;
  if jsonb_typeof(p_operations) <> 'array' then raise exception 'Lot invalide.' using errcode = 'PM002'; end if;
  if jsonb_array_length(p_operations) > 30 then raise exception 'Lot trop volumineux (30 opérations au plus).' using errcode = 'PM002'; end if;
  for v_op in select * from jsonb_array_elements(p_operations) loop
    v_cle := v_op->>'idempotency_key';
    if coalesce(v_cle, '') = '' or length(v_cle) > 200 then
      v_out := v_out || jsonb_build_object('idempotency_key', v_cle, 'statut', 'REJETEE', 'message', 'Clé d''idempotence manquante.'); continue;
    end if;
    v_hash := private.plot_map_hex(jsonb_build_object('type', v_op->'type', 'payload', coalesce(v_op->'payload', '{}'::jsonb))::text);
    perform pg_advisory_xact_lock(hashtextextended('plot_map_sync:' || v_cle, 0));
    select * into v_recu from private.plot_map_sync_recus where idempotency_key = v_cle;
    if found then
      if v_recu.user_id = auth.uid() and v_recu.request_hash = v_hash then v_out := v_out || (v_recu.resultat || jsonb_build_object('idempotency_key', v_cle, 'rejoue', true));
      else v_out := v_out || jsonb_build_object('idempotency_key', v_cle, 'statut', 'REJETEE', 'message', 'Clé d''idempotence déjà utilisée pour une autre demande.'); end if;
      continue;
    end if;
    v_payload := coalesce(v_op->'payload', '{}'::jsonb) || jsonb_build_object('device_id', v_op->>'device_id', 'created_at_client', v_op->>'created_at_client', 'client_operation_id', v_cle);
    begin
      case v_op->>'type'
        when 'LOCALISER' then v_res := public.plot_map_localiser(v_payload);
        when 'AJOUTER_PARCELLE' then v_res := public.plot_map_ajouter_parcelle(v_payload);
        when 'SOUMETTRE_CONTOUR' then v_res := public.plot_map_soumettre(v_payload);
        else raise exception 'Type d''opération inconnu : %.', v_op->>'type' using errcode = 'PM002';
      end case;
    exception
      when sqlstate 'PM409' then v_res := jsonb_build_object('statut', 'CONFLIT', 'code', 'PM409', 'message', sqlerrm);
      when sqlstate 'PM001' then v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'PM001', 'message', sqlerrm);
      when sqlstate 'PM002' then v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'PM002', 'message', sqlerrm);
      when others then
        v_diag := substr(private.plot_map_hex(gen_random_uuid()::text), 1, 10);
        insert into public.farmer_plot_map_events (plot_id, acteur, acteur_role, action, apres)
        values (coalesce(nullif(v_payload->>'plot_id', '')::uuid, '00000000-0000-0000-0000-000000000000'), auth.uid(), private.plot_map_classe(), 'ERREUR_TECHNIQUE',
                jsonb_build_object('diagnostic', v_diag, 'sqlstate', sqlstate, 'detail', sqlerrm, 'type', v_op->>'type'));
        v_res := jsonb_build_object('statut', 'REJETEE', 'code', 'TECHNIQUE', 'diagnostic', v_diag,
          'message', 'Opération refusée par le serveur (erreur technique). Communiquez le code ' || v_diag || ' à votre Chef de Zone.');
    end;
    v_res := v_res || jsonb_build_object('idempotency_key', v_cle, 'recu_serveur_le', coalesce(v_res->'recu_serveur_le', to_jsonb(now())));
    if v_res->>'statut' = 'ACCEPTEE' then
      insert into private.plot_map_sync_recus (idempotency_key, user_id, request_hash, resultat) values (v_cle, auth.uid(), v_hash, v_res)
      on conflict (idempotency_key) do nothing;
    end if;
    v_out := v_out || v_res;
  end loop;
  return jsonb_build_object('resultats', v_out, 'serveur_le', now());
end $$;

-- ------------------------------------------------------------ droits d'exécution
do $$ declare f text; begin
  foreach f in array array[
    'private.plot_map_param(text)','private.plot_map_seuil(text,numeric)','private.plot_map_profil()','private.plot_map_classe()','private.plot_map_norm(text)',
    'private.plot_map_mon_cluster()','private.plot_map_ma_zone()','private.plot_map_contexte(uuid)','private.plot_map_consentement_gps(text)',
    'private.plot_map_peut_lire(text,text)','private.plot_map_peut_saisir(text,text)','private.plot_map_actif(text,text)',
    'private.plot_map_journaliser(uuid,uuid,text,jsonb,jsonb,text)','private.plot_map_hex(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
  end loop;
  -- Fonctions nécessaires à l'évaluation des politiques RLS et des vues (lecture seule, sans effet).
  foreach f in array array['private.plot_map_classe()','private.plot_map_norm(text)','private.plot_map_mon_cluster()','private.plot_map_ma_zone()',
    'private.plot_map_contexte(uuid)','private.plot_map_consentement_gps(text)','private.plot_map_peut_lire(text,text)','private.plot_map_param(text)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function private.plot_map_journaliser(uuid,uuid,text,jsonb,jsonb,text) from authenticated';
  foreach f in array array['public.plot_map_localiser(jsonb)','public.plot_map_ajouter_parcelle(jsonb)','public.plot_map_soumettre(jsonb)',
    'public.plot_map_preverifier(uuid,text)','public.plot_map_decider(uuid,text,text,integer,boolean)','public.plot_map_classer_anomalie(uuid,text,text)',
    'public.plot_map_archiver(uuid,text)','public.plot_map_parametre_definir(text,jsonb)','public.plot_map_sync_batch(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
