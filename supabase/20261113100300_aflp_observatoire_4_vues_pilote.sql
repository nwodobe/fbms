-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 (pilote) — migration 4/4 : VUES PILOTE
-- ---------------------------------------------------------------------
-- STATUT : NON APPLIQUÉE EN PRODUCTION (réplique locale uniquement).
-- CADRE (spécification V2.1, E2.4) : collecte pilote, AUCUN INDICATEUR
--   OFFICIEL, aucune conversion en tonnage, aucune prévision. Chaque vue
--   porte la colonne nature = 'PILOTE_NON_OFFICIEL'.
-- RÈGLES
--   * Seules les visites VALIDÉES comptent. Brouillons, visites soumises,
--     en vérification ou en correction : exclus.
--   * Seuls les arbres observés officiels comptent : titulaires actifs ou
--     remplacés (pour leurs observations passées) et réserves ACTIVÉES.
--     Une réserve en attente n'a aucune observation.
--   * Poids = 1 / probabilité d'inclusion. « Pas vu » sort du dénominateur.
--   * Une chute « prématurée » ou « non confirmée » ne compte jamais dans C.
--   * C cumulatif : un arbre compte une fois par campagne ; une semaine
--     manquante n'efface rien.
--   * Paliers 10/20/30 % : EXPÉRIMENTAUX, simple préalerte (estimation
--     centrale et couverture des champs), sans intervalle de confiance.
-- Vues security_invoker : la RLS de l'utilisateur s'applique.
-- RETOUR ARRIÈRE : supabase/20261113100400_aflp_observatoire_rollback.sql
-- =====================================================================
begin;

create or replace view public.pheno_v_champ_semaine with (security_invoker = true) as
select v.campaign_id, v.cluster_code, v.panel_id, v.id as visite_id, v.semaine_iso, v.date_observation,
  count(o.id) as arbres_observes,
  count(*) filter (where o.retrouve is false) as arbres_non_retrouves,
  count(*) filter (where 'PAS_VU' in (o.f, o.n, o.p, o.chute)) as arbres_avec_pas_vu,
  round(sum(w.poids) filter (where o.f = 'OUI') / nullif(sum(w.poids) filter (where o.f in ('OUI', 'NON')), 0), 4) as part_f,
  round(sum(w.poids) filter (where o.n = 'OUI') / nullif(sum(w.poids) filter (where o.n in ('OUI', 'NON')), 0), 4) as part_n,
  round(sum(w.poids) filter (where o.p = 'OUI') / nullif(sum(w.poids) filter (where o.p in ('OUI', 'NON')), 0), 4) as part_p,
  round(sum(w.poids) filter (where o.chute = 'MURE')
    / nullif(sum(w.poids) filter (where o.chute in ('MURE', 'PREMATUREE', 'ABSENCE')), 0), 4) as part_c_hebdo,
  count(*) filter (where o.chute = 'PREMATUREE') as chutes_prematurees,
  count(*) filter (where o.chute = 'NON_CONFIRME') as chutes_non_confirmees,
  count(*) filter (where o.chute = 'MURE' and o.chute_preuve = 'DECLAREE_PRODUCTEUR') as c_declarees_producteur,
  'PILOTE_NON_OFFICIEL'::text as nature
from public.pheno_visites v
join public.pheno_observations o on o.visite_id = v.id
join public.pheno_arbres a on a.id = o.arbre_id
cross join lateral (select 1 / coalesce(a.proba_inclusion, 1) as poids) w
where v.statut = 'VALIDE'
group by v.campaign_id, v.cluster_code, v.panel_id, v.id, v.semaine_iso, v.date_observation;

create or replace view public.pheno_v_c_cumulatif with (security_invoker = true) as
select v.campaign_id, v.cluster_code, v.panel_id, v.semaine_iso, v.date_observation,
  t.poids_total, t.arbres_suivis,
  coalesce(c.arbres_c, 0) as arbres_c_cumules,
  round(coalesce(c.poids_c, 0) / nullif(t.poids_total, 0), 4) as part_c_cumulatif,
  'PILOTE_NON_OFFICIEL'::text as nature
from public.pheno_visites v
cross join lateral (
  select sum(1 / coalesce(a.proba_inclusion, 1)) as poids_total, count(*) as arbres_suivis
  from public.pheno_arbres a where a.panel_id = v.panel_id and a.statut in ('ACTIF', 'RESERVE_ACTIVEE')) t
left join lateral (
  select sum(1 / coalesce(a.proba_inclusion, 1)) as poids_c, count(*) as arbres_c
  from public.pheno_arbres a
  where a.panel_id = v.panel_id and a.statut in ('ACTIF', 'RESERVE_ACTIVEE')
    and exists (select 1 from public.pheno_observations o join public.pheno_visites v2 on v2.id = o.visite_id
                where o.arbre_id = a.id and o.chute = 'MURE' and v2.statut = 'VALIDE' and v2.date_observation <= v.date_observation)) c on true
where v.statut = 'VALIDE';

create or replace view public.pheno_v_c_cumulatif_cluster with (security_invoker = true) as
with champs as (
  select campaign_id, cluster_code, count(*) filter (where statut = 'ACTIF') as champs_actifs
  from public.pheno_panels group by 1, 2
), sem as (
  select campaign_id, cluster_code, semaine_iso, count(*) as champs_valides, round(avg(part_c_cumulatif), 4) as part_c_cumulatif_moyenne
  from public.pheno_v_c_cumulatif group by 1, 2, 3
)
select s.campaign_id, s.cluster_code, s.semaine_iso, c.champs_actifs, s.champs_valides,
  round(s.champs_valides::numeric / nullif(c.champs_actifs, 0), 4) as couverture,
  s.part_c_cumulatif_moyenne,
  case when s.champs_valides::numeric / nullif(c.champs_actifs, 0) < 0.75 then 'COUVERTURE_INSUFFISANTE'
       when s.part_c_cumulatif_moyenne >= 0.30 then 'PREALERTE_30'
       when s.part_c_cumulatif_moyenne >= 0.20 then 'PREALERTE_20'
       when s.part_c_cumulatif_moyenne >= 0.10 then 'PREALERTE_10'
       else 'AUCUN' end as palier_experimental,
  'PILOTE_NON_OFFICIEL'::text as nature
from sem s join champs c using (campaign_id, cluster_code);

-- Qualité des données : tous statuts, pour le pilotage (pas un indicateur agronomique)
create or replace view public.pheno_v_qualite with (security_invoker = true) as
select v.campaign_id, v.cluster_code, v.semaine_iso,
  (select count(*) from public.pheno_panels p where p.campaign_id = v.campaign_id and p.cluster_code = v.cluster_code and p.statut = 'ACTIF') as champs_actifs,
  count(*) as visites,
  count(*) filter (where v.statut = 'BROUILLON') as brouillons,
  count(*) filter (where v.statut = 'SOUMIS') as soumises,
  count(*) filter (where v.statut = 'EN_VERIFICATION') as en_verification,
  count(*) filter (where v.statut = 'CORRECTION_DEMANDEE') as corrections_demandees,
  count(*) filter (where v.statut = 'VALIDE') as validees,
  count(*) filter (where v.mode_saisie = 'TRANSCRIPTION_PAPIER') as transcriptions_papier,
  count(*) filter (where v.saisie_le is not null and v.recu_serveur_le - v.saisie_le > interval '48 hours') as recues_apres_48h,
  count(*) filter (where v.saisie_le::date > v.date_observation) as saisies_apres_le_jour,
  (select count(*) from public.pheno_observations o join public.pheno_visites v3 on v3.id = o.visite_id
     where v3.campaign_id = v.campaign_id and v3.cluster_code = v.cluster_code and v3.semaine_iso = v.semaine_iso and o.retrouve is false) as arbres_non_retrouves,
  (select count(*) from public.pheno_observations o join public.pheno_visites v3 on v3.id = o.visite_id
     where v3.campaign_id = v.campaign_id and v3.cluster_code = v.cluster_code and v3.semaine_iso = v.semaine_iso and 'PAS_VU' in (o.f, o.n, o.p, o.chute)) as arbres_avec_pas_vu,
  (select count(*) from public.pheno_corrections c join public.pheno_visites v3 on v3.id = c.visite_id
     where v3.campaign_id = v.campaign_id and v3.cluster_code = v.cluster_code and v3.semaine_iso = v.semaine_iso and c.statut = 'PROPOSEE') as corrections_en_attente
from public.pheno_visites v
group by v.campaign_id, v.cluster_code, v.semaine_iso;

revoke all on public.pheno_v_champ_semaine, public.pheno_v_c_cumulatif, public.pheno_v_c_cumulatif_cluster, public.pheno_v_qualite from anon;
grant select on public.pheno_v_champ_semaine, public.pheno_v_c_cumulatif, public.pheno_v_c_cumulatif_cluster, public.pheno_v_qualite to authenticated;

commit;
