-- =====================================================================
-- SIGNALEMENTS GPS AFLP 2027 · migration 1 : signaler un point GPS douteux
--   d'une parcelle (point de référence ou repère), sans le modifier,
--   et le suivre jusqu'à sa résolution motivée
-- ---------------------------------------------------------------------
-- Origine : contrôle d'une parcelle par le Branch Manager (23/11/2026). Un point
-- « capturé sur le champ » avait été pris au village (à une centaine de mètres
-- du centre), alors que le champ est à plusieurs kilomètres. FBMS n'avait aucun
-- moyen de le signaler :
--   * public.farmer_plot_anomalies exige un geometry_id (NOT NULL) : une parcelle
--     sans contour ne peut rien y signaler ;
--   * ses types (CHEVAUCHEMENT, CONFLIT_VERSION, ECART_SUPERFICIE, PRECISION_GPS,
--     ECART_CALCUL) ne décrivent pas un point pris au mauvais endroit.
--
-- POURQUOI UNE TABLE À PART (et non un relâchement de farmer_plot_anomalies)
--   1. Relâcher le NOT NULL toucherait sa politique RLS (lecture par le contour),
--      la vue plot_map_parcelles_v (compteur anomalies_ouvertes), la validation
--      des contours (une anomalie ouverte bloque la décision) et le classement :
--      quatre comportements existants changeraient pour un besoin nouveau.
--   2. Les clients déjà distribués lisent farmer_plot_anomalies : une ligne sans
--      contour y apparaîtrait sous un libellé faux.
--   Ici, rien d'existant n'est modifié : aucune table, colonne, contrainte,
--   fonction, vue ni donnée. Le point signalé n'est JAMAIS modifié.
--
-- MODÈLE
--   public.geo_signalements : un signalement = une cible (POINT_PARCELLE : le point
--     de référence de farmer_plots ; REPERE : une version de public.geo_reperes),
--     une copie du point tel qu'il était au moment du signalement, un motif
--     obligatoire, un état (OUVERT → RESOLU ou CLASSE) et une résolution motivée.
--   public.geo_signalements_evenements : le journal (SIGNALER, REPONDRE, RESOUDRE),
--     jamais réécrit.
--   Un seul signalement OUVERT par cible.
--
-- DROITS (appliqués par le serveur)
--   Signaler  : Branch Manager ; Chef de Zone (Zonal Head) de la zone de la parcelle.
--   Répondre  : Chef d'Unité et assistant du cluster de la parcelle (et le BM).
--   Résoudre  : Branch Manager ; Chef de Zone de la zone. Résolution motivée.
--               « Point corrigé » exige que le point ait réellement changé depuis
--               le signalement : on ne peut pas clore en prétendant une correction.
--   Lecture   : RLS équivalente à farmer_plot_anomalies (données sensibles du registre
--               + périmètre de lecture des parcelles, zone pour un Chef de Zone).
--   Écriture  : aucune politique. Seules les trois fonctions SECURITY DEFINER écrivent.
-- Codes d'erreur : GS001 refus · GS002 demande invalide · GS409 état changé.
--
-- RETOUR ARRIÈRE : 20261124090100_aflp_signalements_gps_1_rollback.sql
-- REJOUABLE : oui.
-- =====================================================================
begin;

create table if not exists public.geo_signalements (
  id                 uuid primary key default gen_random_uuid(),
  cible_type         text not null,
  plot_id            uuid not null references public.farmer_plots(id),
  repere_id          uuid references public.geo_reperes(id),
  repere_objet_type  text,
  repere_objet_id    uuid,
  producteur_id      text not null,
  cluster_code       text,
  zone_code          text,
  -- Copie du point au moment du signalement (preuve de ce qui a été signalé).
  point_latitude     numeric(10,7) not null,
  point_longitude    numeric(10,7) not null,
  point_precision_m  numeric(8,2),
  point_releve_le    timestamptz,
  point_etat         text,
  distance_village_m integer,
  motif_code         text not null,
  motif              text not null,
  statut             text not null default 'OUVERT',
  signale_par        uuid not null,
  signale_role       text not null,
  signale_le         timestamptz not null default now(),
  resolution_code    text,
  resolution_motif   text,
  resolu_par         uuid,
  resolu_role        text,
  resolu_le          timestamptz,
  constraint geo_signalements_cible_chk check (cible_type in ('POINT_PARCELLE', 'REPERE')),
  constraint geo_signalements_rattachement_chk check (
    (cible_type = 'POINT_PARCELLE' and repere_id is null and repere_objet_type is null and repere_objet_id is null)
    or (cible_type = 'REPERE' and repere_id is not null and repere_objet_type in ('PARCELLE', 'BLOC', 'ARBRE') and repere_objet_id is not null)),
  constraint geo_signalements_motif_code_chk check (motif_code in ('CAPTURE_HORS_CHAMP', 'POSITION_INCOHERENTE', 'PRECISION_DOUTEUSE', 'AUTRE')),
  constraint geo_signalements_motif_chk check (length(btrim(motif)) between 10 and 1000),
  constraint geo_signalements_statut_chk check (statut in ('OUVERT', 'RESOLU', 'CLASSE')),
  constraint geo_signalements_resolution_chk check (
    (statut = 'OUVERT' and resolution_code is null and resolution_motif is null and resolu_par is null and resolu_le is null)
    or (statut = 'RESOLU' and resolution_code = 'POINT_CORRIGE' and length(btrim(resolution_motif)) between 10 and 1000 and resolu_par is not null and resolu_le is not null)
    or (statut = 'CLASSE' and resolution_code in ('POINT_CONFIRME', 'SANS_SUITE') and length(btrim(resolution_motif)) between 10 and 1000 and resolu_par is not null and resolu_le is not null))
);

comment on table public.geo_signalements is
  'Signalements par la supervision d''un point GPS de parcelle douteux (point de référence ou repère). Le point n''est jamais modifié par un signalement ; les coordonnées signalées sont copiées pour preuve.';
comment on column public.geo_signalements.distance_village_m is 'Distance calculée par le serveur entre le point signalé et le centre du village (si le village a des coordonnées). Indicateur, pas une preuve.';

-- Un seul signalement ouvert par cible.
create unique index if not exists geo_signalements_ouvert_unique
  on public.geo_signalements (cible_type, coalesce(repere_objet_id, plot_id)) where statut = 'OUVERT';
create index if not exists geo_signalements_plot_idx on public.geo_signalements (plot_id);
create index if not exists geo_signalements_ouverts_idx on public.geo_signalements (cluster_code) where statut = 'OUVERT';

create table if not exists public.geo_signalements_evenements (
  id             uuid primary key default gen_random_uuid(),
  signalement_id uuid not null references public.geo_signalements(id),
  action         text not null,
  acteur         uuid not null,
  acteur_role    text not null,
  texte          text not null,
  detail         jsonb,
  cree_le        timestamptz not null default now(),
  constraint geo_signalements_evt_action_chk check (action in ('SIGNALER', 'REPONDRE', 'RESOUDRE')),
  constraint geo_signalements_evt_texte_chk check (length(btrim(texte)) between 10 and 1000)
);
create index if not exists geo_signalements_evt_idx on public.geo_signalements_evenements (signalement_id, cree_le);

-- ---------------------------------------------------------------------
-- Droits : lecture seule pour les connectés, rien pour anon
-- (les privilèges par défaut du projet accordent tout à anon : on révoque).
-- ---------------------------------------------------------------------
revoke all on public.geo_signalements, public.geo_signalements_evenements from public, anon, authenticated;
grant select on public.geo_signalements, public.geo_signalements_evenements to authenticated;
alter table public.geo_signalements enable row level security;
alter table public.geo_signalements_evenements enable row level security;

drop policy if exists geo_signalements_lecture on public.geo_signalements;
create policy geo_signalements_lecture on public.geo_signalements for select to authenticated
  using ((select private.farmer_registry_can_read_sensitive()) and (select private.plot_map_peut_lire(producteur_id, zone_code)));

drop policy if exists geo_signalements_evt_lecture on public.geo_signalements_evenements;
create policy geo_signalements_evt_lecture on public.geo_signalements_evenements for select to authenticated
  using (exists (select 1 from public.geo_signalements s where s.id = signalement_id));   -- RLS de geo_signalements appliquée

-- Vue de lecture (invocateur : les RLS ci-dessus et celles du registre s'appliquent).
create or replace view public.geo_signalements_v with (security_invoker = true) as
select s.*, fp.plot_code, fp.local_name, v.village as village_nom, pr.code as producteur_code, pr.nom as producteur_nom, pr.prenoms as producteur_prenoms,
       private.plot_map_nom(s.signale_par) as signale_par_nom, private.plot_map_nom(s.resolu_par) as resolu_par_nom,
       (select jsonb_agg(jsonb_build_object('action', e.action, 'texte', e.texte, 'role', e.acteur_role, 'nom', private.plot_map_nom(e.acteur), 'le', e.cree_le) order by e.cree_le)
          from public.geo_signalements_evenements e where e.signalement_id = s.id) as journal
from public.geo_signalements s
join public.farmer_plots fp on fp.id = s.plot_id
left join public.villages v on v.id = fp.village_id
left join public.producteurs pr on pr.id = s.producteur_id;
revoke all on public.geo_signalements_v from public, anon, authenticated;
grant select on public.geo_signalements_v to authenticated;

-- ---------------------------------------------------------------------
-- Outils
-- ---------------------------------------------------------------------
create or replace function private.geo_signalement_superviseur(p_zone text) returns boolean
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select case private.plot_map_classe()
    when 'BM' then true
    when 'ZH' then private.plot_map_ma_zone() is not null and private.plot_map_ma_zone() = p_zone
    else false end
$$;
revoke all on function private.geo_signalement_superviseur(text) from public, anon, authenticated;

-- Distance en mètres (haversine, rayon moyen 6 371 km). NULL si un point manque.
create or replace function private.geo_signalement_distance_m(la1 numeric, lo1 numeric, la2 numeric, lo2 numeric) returns integer
language sql immutable set search_path to 'pg_temp' as $$
  select case when la1 is null or lo1 is null or la2 is null or lo2 is null then null else
    round(2 * 6371000 * asin(sqrt(
      power(sin(radians((la2 - la1)::float8) / 2), 2)
      + cos(radians(la1::float8)) * cos(radians(la2::float8)) * power(sin(radians((lo2 - lo1)::float8) / 2), 2))))::integer end
$$;
revoke all on function private.geo_signalement_distance_m(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Signaler (Branch Manager, Chef de Zone de la zone)
--    p : { cible_type, plot_id | repere_id, motif_code, motif,
--          point_latitude, point_longitude (point vu à l'écran, facultatifs) }
-- ---------------------------------------------------------------------
create or replace function public.geo_signalement_creer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_cible text := upper(coalesce(p->>'cible_type', ''));
  v_code text := upper(coalesce(p->>'motif_code', ''));
  v_motif text := btrim(coalesce(p->>'motif', ''));
  v_plot uuid; v_rep public.geo_reperes; cx record; v_classe text := private.plot_map_classe();
  v_lat numeric; v_lng numeric; v_prec numeric; v_le timestamptz; v_etat text; v_vu_lat numeric; v_vu_lng numeric;
  v_vlat numeric; v_vlng numeric; v_exist uuid; v_new public.geo_signalements;
begin
  if auth.uid() is null or v_classe is null or not public.est_actif() then raise exception 'Accès refusé.' using errcode = 'GS001'; end if;
  if v_classe not in ('BM', 'ZH') then raise exception 'Le signalement d''un point GPS est réservé au Branch Manager et aux Chefs de Zone.' using errcode = 'GS001'; end if;
  if v_cible not in ('POINT_PARCELLE', 'REPERE') then raise exception 'Cible du signalement inconnue.' using errcode = 'GS002'; end if;
  if v_code not in ('CAPTURE_HORS_CHAMP', 'POSITION_INCOHERENTE', 'PRECISION_DOUTEUSE', 'AUTRE') then raise exception 'Choisissez le motif du signalement.' using errcode = 'GS002'; end if;
  if length(v_motif) < 10 then raise exception 'Décrivez le motif en quelques mots (10 caractères au moins).' using errcode = 'GS002'; end if;
  if length(v_motif) > 1000 then raise exception 'Motif trop long (1 000 caractères au plus).' using errcode = 'GS002'; end if;
  begin
    v_vu_lat := nullif(p->>'point_latitude', '')::numeric; v_vu_lng := nullif(p->>'point_longitude', '')::numeric;
    if v_cible = 'POINT_PARCELLE' then v_plot := (p->>'plot_id')::uuid;
    else select * into v_rep from public.geo_reperes where id = (p->>'repere_id')::uuid; v_plot := v_rep.plot_id; end if;
  exception when others then raise exception 'Identifiant ou coordonnées illisibles.' using errcode = 'GS002';
  end;
  if v_plot is null then raise exception 'Point introuvable.' using errcode = 'GS002'; end if;

  select * into cx from private.plot_map_contexte(v_plot);
  if cx.plot_id is null or cx.deleted then raise exception 'Parcelle introuvable.' using errcode = 'GS002'; end if;
  if not private.plot_map_peut_lire(cx.producteur_id, cx.zone_code) or not private.geo_signalement_superviseur(cx.zone_code) then
    raise exception 'Cette parcelle est hors de votre périmètre.' using errcode = 'GS001'; end if;

  perform pg_advisory_xact_lock(hashtextextended('geo_signalement:' || v_cible || ':' || coalesce(v_rep.objet_id, v_plot)::text, 0));

  if v_cible = 'POINT_PARCELLE' then
    select latitude, longitude, gps_accuracy_m, gps_captured_at, gps_status into v_lat, v_lng, v_prec, v_le, v_etat
      from public.farmer_plots where id = v_plot;
    if v_lat is null then raise exception 'Cette parcelle n''a pas de point GPS de référence à signaler.' using errcode = 'GS002'; end if;
  else
    if not v_rep.actif then raise exception 'Ce repère a été remplacé depuis votre lecture : rechargez la fiche.' using errcode = 'GS409'; end if;
    v_lat := v_rep.latitude; v_lng := v_rep.longitude; v_prec := v_rep.precision_m; v_le := v_rep.releve_le; v_etat := v_rep.origine;
  end if;
  -- Le point vu à l'écran doit être celui du serveur : on ne signale pas un point qui a déjà changé.
  if (v_vu_lat is not null and round(v_vu_lat, 6) <> round(v_lat, 6)) or (v_vu_lng is not null and round(v_vu_lng, 6) <> round(v_lng, 6)) then
    raise exception 'Ce point a changé depuis votre lecture : rechargez la fiche avant de le signaler.' using errcode = 'GS409'; end if;

  select id into v_exist from public.geo_signalements
   where statut = 'OUVERT' and cible_type = v_cible and coalesce(repere_objet_id, plot_id) = coalesce(v_rep.objet_id, v_plot);
  if v_exist is not null then
    raise exception 'Ce point est déjà signalé et le signalement est ouvert. Complétez-le plutôt que d''en créer un second.' using errcode = 'GS409'; end if;

  select gps_lat, gps_lng into v_vlat, v_vlng from public.villages where id = cx.village_id;

  insert into public.geo_signalements (cible_type, plot_id, repere_id, repere_objet_type, repere_objet_id, producteur_id, cluster_code, zone_code,
      point_latitude, point_longitude, point_precision_m, point_releve_le, point_etat, distance_village_m, motif_code, motif, signale_par, signale_role)
  values (v_cible, v_plot, v_rep.id, v_rep.objet_type, v_rep.objet_id, cx.producteur_id, cx.cluster_code, cx.zone_code,
      v_lat, v_lng, v_prec, v_le, v_etat, private.geo_signalement_distance_m(v_lat, v_lng, v_vlat, v_vlng), v_code, v_motif, auth.uid(), v_classe)
  returning * into v_new;
  insert into public.geo_signalements_evenements (signalement_id, action, acteur, acteur_role, texte, detail)
  values (v_new.id, 'SIGNALER', auth.uid(), v_classe, v_motif, jsonb_build_object('motif_code', v_code));

  return jsonb_build_object('statut', 'OUVERT', 'signalement_id', v_new.id, 'distance_village_m', v_new.distance_village_m, 'signale_le', v_new.signale_le);
end $$;
revoke all on function public.geo_signalement_creer(jsonb) from public, anon;
grant execute on function public.geo_signalement_creer(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Répondre (Chef d'Unité ou assistant du cluster ; BM) : le signalement reste ouvert.
-- ---------------------------------------------------------------------
create or replace function public.geo_signalement_repondre(p_signalement uuid, p_texte text) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare v_s public.geo_signalements; v_classe text := private.plot_map_classe(); v_t text := btrim(coalesce(p_texte, ''));
begin
  if auth.uid() is null or v_classe is null or not public.est_actif() then raise exception 'Accès refusé.' using errcode = 'GS001'; end if;
  select * into v_s from public.geo_signalements where id = p_signalement for update;
  if v_s.id is null or not private.plot_map_peut_lire(v_s.producteur_id, v_s.zone_code) then raise exception 'Signalement introuvable.' using errcode = 'GS002'; end if;
  if v_classe not in ('BM', 'UH', 'AUH') or not private.plot_map_peut_saisir(v_s.cluster_code, v_s.producteur_id) then
    raise exception 'La réponse est réservée au Chef d''Unité du cluster et à son assistant.' using errcode = 'GS001'; end if;
  if v_s.statut <> 'OUVERT' then raise exception 'Ce signalement est déjà clos.' using errcode = 'GS409'; end if;
  if length(v_t) < 10 or length(v_t) > 1000 then raise exception 'Votre réponse doit compter de 10 à 1 000 caractères.' using errcode = 'GS002'; end if;
  insert into public.geo_signalements_evenements (signalement_id, action, acteur, acteur_role, texte) values (v_s.id, 'REPONDRE', auth.uid(), v_classe, v_t);
  return jsonb_build_object('statut', 'OUVERT', 'signalement_id', v_s.id, 'repondu_le', now());
end $$;
revoke all on function public.geo_signalement_repondre(uuid, text) from public, anon;
grant execute on function public.geo_signalement_repondre(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Résoudre (Branch Manager, Chef de Zone de la zone), toujours motivé.
--    POINT_CORRIGE  → RESOLU : exige que le point ait changé depuis le signalement.
--    POINT_CONFIRME → CLASSE : le point était exact.
--    SANS_SUITE     → CLASSE : autre raison, à motiver.
-- ---------------------------------------------------------------------
create or replace function public.geo_signalement_resoudre(p_signalement uuid, p_resolution text, p_motif text) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_s public.geo_signalements; v_classe text := private.plot_map_classe(); v_r text := upper(coalesce(p_resolution, ''));
  v_m text := btrim(coalesce(p_motif, '')); v_change boolean; v_statut text;
begin
  if auth.uid() is null or v_classe is null or not public.est_actif() then raise exception 'Accès refusé.' using errcode = 'GS001'; end if;
  select * into v_s from public.geo_signalements where id = p_signalement for update;
  if v_s.id is null or not private.plot_map_peut_lire(v_s.producteur_id, v_s.zone_code) then raise exception 'Signalement introuvable.' using errcode = 'GS002'; end if;
  if not private.geo_signalement_superviseur(v_s.zone_code) then
    raise exception 'La résolution est réservée au Branch Manager et au Chef de Zone de la zone.' using errcode = 'GS001'; end if;
  if v_s.statut <> 'OUVERT' then raise exception 'Ce signalement est déjà clos.' using errcode = 'GS409'; end if;
  if v_r not in ('POINT_CORRIGE', 'POINT_CONFIRME', 'SANS_SUITE') then raise exception 'Choisissez la résolution.' using errcode = 'GS002'; end if;
  if length(v_m) < 10 or length(v_m) > 1000 then raise exception 'Motivez la résolution (10 à 1 000 caractères).' using errcode = 'GS002'; end if;
  if v_r = 'POINT_CORRIGE' then
    if v_s.cible_type = 'POINT_PARCELLE' then
      select fp.latitude is not null and (round(fp.latitude, 7) <> v_s.point_latitude or round(fp.longitude, 7) <> v_s.point_longitude)
        into v_change from public.farmer_plots fp where fp.id = v_s.plot_id;
    else
      select exists (select 1 from public.geo_reperes g where g.objet_type = v_s.repere_objet_type and g.objet_id = v_s.repere_objet_id and g.actif and g.id <> v_s.repere_id)
        into v_change;
    end if;
    if not coalesce(v_change, false) then
      raise exception 'Le point n''a pas changé depuis le signalement : il ne peut pas être déclaré corrigé. Faites d''abord reprendre le point sur le champ.' using errcode = 'GS002'; end if;
  end if;
  v_statut := case when v_r = 'POINT_CORRIGE' then 'RESOLU' else 'CLASSE' end;
  update public.geo_signalements set statut = v_statut, resolution_code = v_r, resolution_motif = v_m, resolu_par = auth.uid(), resolu_role = v_classe, resolu_le = now()
   where id = v_s.id;
  insert into public.geo_signalements_evenements (signalement_id, action, acteur, acteur_role, texte, detail)
  values (v_s.id, 'RESOUDRE', auth.uid(), v_classe, v_m, jsonb_build_object('resolution_code', v_r));
  return jsonb_build_object('statut', v_statut, 'signalement_id', v_s.id, 'resolution_code', v_r, 'resolu_le', now());
end $$;
revoke all on function public.geo_signalement_resoudre(uuid, text, text) from public, anon;
grant execute on function public.geo_signalement_resoudre(uuid, text, text) to authenticated;

commit;
