-- FBMS · AFLP DATA (2/5) : dimensions, villages, missions, achats, cash RT
-- Vues en lecture seule (security_invoker) : elles héritent des politiques RLS
-- des tables sources. Aucune donnée n'est créée ni modifiée.

-- 1. Utilitaires -------------------------------------------------------------
create or replace function public.aflp_date(p text)
returns date language plpgsql immutable set search_path = public, pg_temp as $f$
begin
  if p is null or btrim(p) !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(btrim(p), 10)::date;
exception when others then
  return null;
end $f$;

-- Campagne d'un enregistrement AFLP : la colonne campaign est souvent vide ;
-- tout enregistrement Field Buying sans campagne est rattaché au programme 2027.
create or replace function public.aflp_campaign(p text)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select coalesce(nullif(btrim(p), ''), '2027')
$f$;

create or replace function public.aflp_competition_label(p numeric)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select case
    when p is null or p <= 0 then null
    when p >= 16 then 'Faible (' || p::int || '/20)'
    when p >= 11 then 'Moyen (' || p::int || '/20)'
    else 'Élevé (' || p::int || '/20)' end
$f$;

-- Encadrement AFLP lisible par tout utilisateur actif (noms et rôles uniquement,
-- jamais les courriels). Les profils restent protégés par leur propre RLS.
create or replace function public.aflp_cluster_staff()
returns table (cluster_code text, cluster_label text, zone_code text, zone_label text,
               unit_head text, assistant text, zone_head text)
language sql stable security definer set search_path = public, pg_temp as $f$
  select c.code, c.label, c.zone_code, z.label,
    (select string_agg(p.nom, ', ' order by p.nom) from public.profils p
      where p.actif and p.role in ('Unit Head', 'Chef d''Unité', 'Chef d''unité')
        and public.aflp_cluster_code(p.cluster) = c.code),
    (select string_agg(p.nom, ', ' order by p.nom) from public.profils p
      where p.actif and p.role in ('Assistant Unit Head', 'Assistant Chef d''Unité')
        and public.aflp_cluster_code(p.cluster) = c.code),
    (select string_agg(p.nom, ', ' order by p.nom) from public.profils p
      where p.actif and p.role in ('Zonal Head', 'Chef de Zone')
        and (public.aflp_norm(replace(p.zone, ' ', '_')) = c.zone_code
             or public.aflp_norm(p.zone) = public.aflp_norm(z.label)))
  from public.aflp_clusters c
  left join public.aflp_zones z on z.code = c.zone_code
  where c.active and public.est_actif()
$f$;

create or replace view public.aflp_v_cluster_staff with (security_invoker = true) as
select * from public.aflp_cluster_staff();

-- Encadrement (hors RT) pour l'onglet équipes : nom, rôle, périmètre.
-- Téléphone visible seulement du Branch Manager ou de la personne elle-même.
create or replace function public.aflp_staff_directory()
returns table (staff_ref text, nom text, role text, zone_code text, cluster_code text,
               telephone text, actif boolean, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $f$
  select 'STF-' || upper(left(replace(p.user_id::text, '-', ''), 8)), p.nom, p.role,
    coalesce(c.zone_code, (select z.code from public.aflp_zones z
      where z.code = public.aflp_norm(replace(p.zone, ' ', '_')) or public.aflp_norm(z.label) = public.aflp_norm(p.zone) limit 1)),
    c.code,
    case when public.fbms_role() = 'Branch Manager' or p.user_id = auth.uid() then p.telephone end,
    p.actif, p.created_at
  from public.profils p
  left join public.aflp_clusters c on c.code = public.aflp_cluster_code(p.cluster)
  where public.est_actif()
    and p.role in ('Zonal Head', 'Chef de Zone', 'Unit Head', 'Chef d''Unité', 'Assistant Unit Head',
                   'Supervisor', 'Head of Field', 'Field Buying Operations Officer', 'Coordination')
$f$;

-- 2. Dimensions ----------------------------------------------------------------
create or replace view public.aflp_v_village_dim with (security_invoker = true) as
select v.id as village_id,
  coalesce(nullif(btrim(v.village), ''), nullif(btrim(v.data->'s1'->>'village'), ''), v.id) as village_name,
  c.zone_code, z.label as zone, c.code as cluster_code, c.label as cluster,
  coalesce(nullif(btrim(v.departement), ''), nullif(btrim(v.data->'s1'->>'departement'), '')) as department,
  nullif(btrim(v.data->'s1'->>'sousPrefecture'), '') as sous_prefecture,
  coalesce(v.gps_lat, public.aflp_num(v.data->'s1'->>'gpsLat')) as gps_lat,
  coalesce(v.gps_lng, public.aflp_num(v.data->'s1'->>'gpsLng')) as gps_lng,
  coalesce(public.aflp_num(v.data->'s1'->>'distanceHubRoutiere'), public.aflp_num(v.data->'s1'->>'distanceHub')) as distance_hub_km,
  nullif(btrim(v.data->'s5'->>'typeAcces'), '') as access_type,
  public.aflp_num(v.data->'s5'->>'noteRoute') as road_score,
  public.aflp_oui_non(v.data->'s5'->>'camion10T') as access_10t,
  public.aflp_oui_non(v.data->'s5'->>'camion30T') as access_30t,
  public.aflp_num(v.data->'s3'->>'nbProducteurs') as est_producers,
  public.aflp_num(v.data->'s3'->>'potentielMT') as potential_mt,
  public.aflp_num(v.data->'s3'->>'potentielSecuriseMT') as secured_mt,
  public.aflp_num(v.data->'s9'->>'risqueConcurrentiel20') as competition_score,
  public.aflp_date(v.data->'s1'->>'dateVisite') as census_date,
  nullif(btrim(v.data->'s1'->>'enqueteur'), '') as census_agent,
  v.statut as village_status,
  (v.data->'s8'->>'pasConflitFoncier') = 'false' as conflit_foncier,
  (v.data->'s8'->>'pasConflitCommunautaire') = 'false' as conflit_communautaire,
  case when jsonb_typeof(v.data->'photos') = 'array' then jsonb_array_length(v.data->'photos') else 0 end
    + case when jsonb_typeof(v.data->'photosDrive') = 'array' then jsonb_array_length(v.data->'photosDrive') else 0 end as photo_count
from public.villages v
left join public.aflp_clusters c on c.code = public.aflp_cluster_code(coalesce(nullif(v.cluster_code, ''), v.cluster))
left join public.aflp_zones z on z.code = c.zone_code
where not coalesce(v.deleted, false);

create or replace view public.aflp_v_rt_dim with (security_invoker = true) as
select r.id as rt_id,
  coalesce(nullif(btrim(r.id_rt), ''), nullif(btrim(r.data->>'idRt'), ''), r.id) as staff_code,
  r.nom as rt_name, r.telephone as phone,
  case lower(coalesce(r.data->>'compteWave', ''))
    when 'true' then 'Compte Wave déclaré (numéro à compléter)'
    when 'false' then 'Pas de compte Wave' end as wave_info,
  r.statut as rt_status, r.village_id, vd.village_name,
  coalesce(c.code, vd.cluster_code) as cluster_code, coalesce(c.label, vd.cluster) as cluster,
  coalesce(c.zone_code, vd.zone_code) as zone_code, z.label as zone,
  case when public.aflp_num(r.data->'perf'->>'tonnageEngage') > 0
       then public.aflp_num(r.data->'perf'->>'tonnageEngage') * 1000 end as target_kg,
  r.created_at
from public.rt r
left join public.aflp_clusters c on c.code = public.aflp_cluster_code(r.cluster)
left join public.aflp_v_village_dim vd on vd.village_id = r.village_id
left join public.aflp_zones z on z.code = coalesce(c.zone_code, vd.zone_code)
where not coalesce(r.deleted, false);

-- RT fusionné : on rattache l'identifiant historique au RT conservé.
create or replace view public.aflp_v_rt_alias with (security_invoker = true) as
select r.id as any_rt_id, coalesce(nullif(r.data->>'mergedIntoRtId', ''), r.id) as rt_id
from public.rt r;

-- 3. Onglet 3 · Villages Master Data ------------------------------------------
create or replace view public.aflp_v_villages with (security_invoker = true) as
select vd.village_id, vd.village_name, vd.zone, vd.cluster, vd.department, vd.sous_prefecture,
  vd.gps_lat, vd.gps_lng, vd.distance_hub_km,
  case when vd.access_type is null and vd.road_score is null then null
       else concat_ws(' · ', vd.access_type, case when vd.road_score is not null then 'note ' || vd.road_score::int || '/10' end) end as road_condition,
  vd.access_10t, vd.access_30t, vd.est_producers, vd.potential_mt, vd.secured_mt,
  public.aflp_competition_label(vd.competition_score) as competition_risk,
  (select string_agg(r.rt_name || case when r.rt_status is distinct from 'Confirmé' then ' (' || coalesce(r.rt_status, 'statut ?') || ')' else '' end, ', ' order by r.rt_name)
     from public.aflp_v_rt_dim r where r.village_id = vd.village_id) as assigned_rt,
  st.unit_head,
  greatest(vd.census_date,
    (select max(coalesce(ck.horodatage_client, ck.horodatage_serveur))::date from public.checkins ck where ck.village_id = vd.village_id),
    (select max(m.date_debut) from public.mission_villages mv join public.missions m on m.id = mv.mission_id
      where mv.village_id = vd.village_id and mv.statut = 'visite' and not coalesce(m.deleted, false))) as last_visit_date,
  vd.village_status,
  nullif(concat_ws(' · ',
    case when vd.conflit_foncier then 'Conflit foncier signalé au recensement' end,
    case when vd.conflit_communautaire then 'Conflit communautaire signalé au recensement' end,
    case when vd.gps_lat is null or vd.gps_lng is null then 'GPS manquant' end), '') as remarks,
  vd.zone_code, vd.cluster_code, '2027'::text as campaign
from public.aflp_v_village_dim vd
left join public.aflp_cluster_staff() st on st.cluster_code = vd.cluster_code;

-- 4. Onglet 7 · AFLP Daily Purchases -------------------------------------------
create or replace view public.aflp_v_daily_purchases with (security_invoker = true) as
select coalesce(nullif(a.local_id, ''), a.id::text) as purchase_id,
  a.date as purchase_date,
  coalesce(vd.zone, zz.label) as zone, coalesce(vd.cluster, cz.label) as cluster,
  coalesce(vd.village_name, a.village_nom) as village,
  coalesce(nullif(btrim(concat_ws(' ', p.nom, p.prenoms)), ''), a.producteur_nom) as producer_name,
  coalesce(nullif(a.producteur_code, ''), p.code) as producer_code,
  coalesce(rd.rt_name, a.rt_nom) as rt_name,
  st.unit_head,
  a.poids_net as quantity_kg, a.nb_sacs as bags_count, a.prix_kg as price_kg, a.montant as gross_amount,
  nullif(concat_ws(' · ', a.qualite_statut, nullif(btrim(a.observation), ''),
    case when a.impuretes is not null then 'Impuretés ' || a.impuretes || ' %' end), '') as quality_observation,
  a.humidite as moisture, a.kor,
  a.mode_paiement as payment_method,
  case when coalesce(a.rejet, false) then 'Rejeté (non payé)'
       when a.montant is null or a.montant <= 0 then 'Montant manquant'
       when a.cash_statut ilike 'réconcilié%' then 'Payé · caisse réconciliée'
       else 'Payé · caisse ' || lower(coalesce(a.cash_statut, 'non réconciliée')) end as payment_status,
  null::text as wave_transaction_ref,
  nullif(a.numero_recu, '') as cash_voucher_ref,
  concat_ws(' · ', coalesce(a.statut_validation, 'À contrôler'), a.stock_statut) as purchase_status,
  nullif(concat_ws(' · ',
    case when a.prix_hors_bareme then 'Prix hors barème' || coalesce(' : ' || nullif(a.motif_prix, ''), '') end,
    case when a.recu_photo is null and a.recu_photo_url is null then 'Photo du reçu absente' end,
    case when a.weight_source = 'ESTIMATED' then 'Poids estimé' end), '') as remarks,
  public.aflp_campaign(a.campaign) as campaign,
  coalesce(vd.zone_code, cz.zone_code) as zone_code, coalesce(vd.cluster_code, cz.code) as cluster_code,
  a.village_id, coalesce(ra.rt_id, a.rt_id) as rt_id, a.producteur_id, a.id as achat_uuid, a.created_at,
  coalesce(a.rejet, false) as rejet, a.stock_statut, a.cash_statut, a.statut_validation
from public.achats a
left join public.aflp_v_village_dim vd on vd.village_id = a.village_id
left join public.aflp_clusters cz on cz.code = public.aflp_cluster_code(a.cluster)
left join public.aflp_zones zz on zz.code = cz.zone_code
left join public.aflp_v_rt_alias ra on ra.any_rt_id = a.rt_id
left join public.aflp_v_rt_dim rd on rd.rt_id = coalesce(ra.rt_id, a.rt_id)
left join public.producteurs p on p.id = a.producteur_id
left join public.aflp_cluster_staff() st on st.cluster_code = coalesce(vd.cluster_code, cz.code);

-- 5. Onglet 6 · Field Missions & Village Visits --------------------------------
create or replace view public.aflp_v_missions with (security_invoker = true) as
with mv as (
  select m.id as mission_uuid, mv.village_id, mv.statut as mv_statut, mv.objectif_enrolements as mv_obj,
    m.date_debut, m.date_fin, m.statut, m.notes, m.objectif_enrolements, e.nom as equipe_nom,
    (select min(coalesce(ck.horodatage_client, ck.horodatage_serveur)) from public.checkins ck
      where ck.mission_id = m.id and ck.village_id = mv.village_id and ck.type = 'in') as checkin_at,
    (select count(*) from public.checkins ck where ck.mission_id = m.id and ck.village_id = mv.village_id
      and ck.gps_lat is not null and ck.gps_lng is not null) as gps_checkins,
    (select count(*) from public.producteurs p where p.mission_id = m.id and p.village_id = mv.village_id
      and not coalesce(p.deleted, false)) as producers_met,
    (select sum(coalesce(public.aflp_num(p.data->>'potentiel2027Kg'), public.aflp_num(p.data->>'prodPrecKg')))
       from public.producteurs p where p.mission_id = m.id and p.village_id = mv.village_id and not coalesce(p.deleted, false)) as volume_kg,
    (select sum(public.aflp_num(p.data->>'engagementKg')) from public.producteurs p
      where p.mission_id = m.id and p.village_id = mv.village_id and not coalesce(p.deleted, false)) as engagement_kg
  from public.mission_villages mv
  join public.missions m on m.id = mv.mission_id and not coalesce(m.deleted, false)
  left join public.equipes e on e.id = m.equipe_id
)
select 'MIS-' || upper(left(replace(mv.mission_uuid::text, '-', ''), 8)) as mission_id,
  coalesce(mv.checkin_at::date, mv.date_debut) as visit_date,
  vd.zone, vd.cluster, vd.village_name as village,
  mv.equipe_nom as staff_involved,
  coalesce(nullif(btrim(mv.notes), ''), 'Enrôlement producteurs · objectif ' || coalesce(mv.mv_obj, mv.objectif_enrolements)::text) as mission_objective,
  mv.producers_met, mv.volume_kg as estimated_volume_kg, mv.engagement_kg as commitments_kg,
  null::text as issues_raised,
  case when mv.gps_checkins > 0 then 'Oui' else 'Non' end as gps_checkin,
  null::text as photos_available, null::text as attendance_list,
  case mv.mv_statut when 'planifie' then 'Visite planifiée' when 'visite' then 'Visite réalisée'
    when 'reporte' then 'Visite reportée' when 'annule' then 'Visite annulée' else mv.mv_statut end as follow_up_action,
  (select min(m2.date_debut) from public.mission_villages x join public.missions m2 on m2.id = x.mission_id
    where x.village_id = mv.village_id and m2.date_debut > mv.date_debut and not coalesce(m2.deleted, false)) as next_visit_date,
  case mv.statut when 'brouillon' then 'Brouillon' when 'soumise' then 'Soumise' when 'approuvee' then 'Approuvée'
    when 'en_cours' then 'En cours' when 'cloturee' then 'Clôturée' when 'annulee' then 'Annulée' else mv.statut end as mission_status,
  'Source : mission terrain'::text as remarks,
  vd.zone_code, vd.cluster_code, mv.village_id, 'MISSION'::text as source_type, '2027'::text as campaign
from mv left join public.aflp_v_village_dim vd on vd.village_id = mv.village_id
union all
select 'RECENS-' || vd.village_id, vd.census_date, vd.zone, vd.cluster, vd.village_name,
  vd.census_agent, 'Recensement du village (fiche 9 sections)',
  null::bigint, vd.potential_mt * 1000, vd.secured_mt * 1000,
  nullif(concat_ws(' · ', case when vd.conflit_foncier then 'Conflit foncier' end,
    case when vd.conflit_communautaire then 'Conflit communautaire' end), ''),
  case when vd.gps_lat is not null and vd.gps_lng is not null then 'Oui (fiche)' else 'Non' end,
  case when vd.photo_count > 0 then 'Oui (' || vd.photo_count || ')' else 'Non' end,
  null::text,
  'Statut fiche : ' || coalesce(vd.village_status, '?'),
  null::date, 'Réalisée',
  'Source : fiche de recensement',
  vd.zone_code, vd.cluster_code, vd.village_id, 'RECENSEMENT', '2027'
from public.aflp_v_village_dim vd
where vd.census_date is not null;

-- 6. Onglet 8 · Cash Advances & Payments ---------------------------------------
-- Contrôle : Opening + Received − Paid − Returned = Current balance (par RT).
-- Les retours de fonds ne sont pas tracés dans l'application (montant 0).
create or replace view public.aflp_v_cash_advances with (security_invoker = true) as
with tx as (
  select 'AV-' || coalesce(nullif(a.local_id, ''), a.id::text) as transaction_id, a.date as tx_date, a.created_at, 1 as ord,
    coalesce(ra.rt_id, a.rt_id) as rt_id, a.rt_nom, a.cluster as cluster_raw, null::text as village_id,
    'Avance reçue'::text as transaction_type, a.montant as amount_received, 0::numeric as amount_paid,
    0::numeric as amount_returned, null::numeric as cash_counted, a.source as payment_method,
    nullif(concat_ws(' · ', nullif(a.cycle_id, ''), nullif(a.motif, '')), '') as supporting_document,
    coalesce(nullif(a.cycle_statut, ''), a.statut) as approval_status,
    case when a.override_bm then 'Branch Manager (dérogation)' else a.created_by_nom end as approved_by,
    case when a.override_bm then 'Dérogation : ' || coalesce(a.override_motif, '') end as remarks
  from public.avances a
  left join public.aflp_v_rt_alias ra on ra.any_rt_id = a.rt_id
  where coalesce(a.statut, '') <> 'Annulee'
  union all
  select 'PAY-' || coalesce(nullif(h.local_id, ''), h.id::text), h.date, h.created_at, 2,
    coalesce(ra.rt_id, h.rt_id), h.rt_nom, h.cluster, h.village_id,
    'Paiement producteur', 0, coalesce(h.montant, 0), 0, null, h.mode_paiement,
    coalesce(nullif(h.numero_recu, ''), case when h.recu_photo_url is not null or h.recu_photo is not null then 'Photo du reçu' end),
    coalesce(h.statut_validation, 'À contrôler'), h.validated_by,
    nullif(concat_ws(' · ', 'Achat ' || coalesce(nullif(h.local_id, ''), h.id::text), h.cash_statut), '')
  from public.achats h
  left join public.aflp_v_rt_alias ra on ra.any_rt_id = h.rt_id
  where not coalesce(h.rejet, false)
  union all
  select 'REC-' || coalesce(nullif(r.local_id, ''), r.id::text), r.date, r.created_at, 3,
    coalesce(ra.rt_id, r.rt_id), r.rt_nom, r.cluster, null,
    'Réconciliation caisse', 0, 0, 0, r.cash_restant, null,
    'Cash compté : ' || r.cash_restant::text || coalesce(' · stock valorisé : ' || r.valeur_stock::text, ''),
    r.statut, r.created_by_nom,
    case when r.ecart is not null then 'Écart saisi : ' || r.ecart::text end
  from public.reconciliations r
  left join public.aflp_v_rt_alias ra on ra.any_rt_id = r.rt_id
), run as (
  select tx.*,
    sum(tx.amount_received - tx.amount_paid - tx.amount_returned) over (
      partition by coalesce(tx.rt_id, upper(btrim(tx.rt_nom)))
      order by tx.tx_date, tx.ord, tx.created_at, tx.transaction_id
      rows between unbounded preceding and current row) as current_balance
  from tx
)
select run.transaction_id, run.tx_date as date,
  coalesce(rd.rt_name, run.rt_nom) as staff_rt,
  coalesce(vd.zone, rd.zone, z.label) as zone,
  coalesce(vd.cluster, rd.cluster, c.label) as cluster,
  coalesce(vd.village_name, rd.village_name) as village,
  run.transaction_type,
  run.current_balance - (run.amount_received - run.amount_paid - run.amount_returned) as opening_advance,
  run.amount_received, run.amount_paid, run.amount_returned,
  case when run.cash_counted is not null then run.cash_counted - run.current_balance end as difference,
  run.current_balance, run.payment_method, run.supporting_document, run.approval_status, run.approved_by, run.remarks,
  coalesce(vd.zone_code, rd.zone_code, c.zone_code) as zone_code,
  coalesce(vd.cluster_code, rd.cluster_code, c.code) as cluster_code,
  coalesce(run.village_id, rd.village_id) as village_id, run.rt_id, run.ord, run.created_at, '2027'::text as campaign
from run
left join public.aflp_v_rt_dim rd on rd.rt_id = run.rt_id
left join public.aflp_v_village_dim vd on vd.village_id = run.village_id
left join public.aflp_clusters c on c.code = public.aflp_cluster_code(run.cluster_raw)
left join public.aflp_zones z on z.code = c.zone_code;

-- 7. Droits ----------------------------------------------------------------------
revoke all on function public.aflp_date(text), public.aflp_campaign(text), public.aflp_competition_label(numeric),
  public.aflp_cluster_staff(), public.aflp_staff_directory() from public, anon;
grant execute on function public.aflp_date(text), public.aflp_campaign(text), public.aflp_competition_label(numeric),
  public.aflp_cluster_staff(), public.aflp_staff_directory() to authenticated;
revoke all on public.aflp_v_cluster_staff, public.aflp_v_village_dim, public.aflp_v_rt_dim, public.aflp_v_rt_alias,
  public.aflp_v_villages, public.aflp_v_daily_purchases, public.aflp_v_missions, public.aflp_v_cash_advances from anon;
grant select on public.aflp_v_cluster_staff, public.aflp_v_village_dim, public.aflp_v_rt_dim, public.aflp_v_rt_alias,
  public.aflp_v_villages, public.aflp_v_daily_purchases, public.aflp_v_missions, public.aflp_v_cash_advances to authenticated;
