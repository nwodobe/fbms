-- =====================================================================
-- ANAGROCI FBMS — AFLP MOTO MANAGER (3/3) : vues de pilotage et indicateurs
-- Fichier : supabase/20261031090200_aflp_moto_manager_3_vues_kpi.sql
--
-- STATUT : APPLIQUÉE EN PRODUCTION le 31/10/2026 sur autorisation de M. KOUASSI.
--
-- Toutes les vues sont security_invoker : la RLS des tables moto_* s'applique
-- à l'utilisateur qui interroge. Une donnée manquante produit NULL (affiché
-- « Non disponible »), jamais une valeur par défaut flatteuse.
-- =====================================================================
begin;

-- Nom affiché d'un profil (nom seul : aucune autre donnée du profil n'est exposée).
create or replace function private.moto_nom_profil(p_user uuid)
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select coalesce(nom, email) from public.profils where user_id = p_user and private.moto_classe() is not null $$;
revoke all on function private.moto_nom_profil(uuid) from public, anon;
grant execute on function private.moto_nom_profil(uuid) to authenticated;

create or replace function private.moto_param(p_cle text)
returns numeric language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select valeur from public.moto_parametres where cle = p_cle $$;
revoke all on function private.moto_param(text) from public, anon;
grant execute on function private.moto_param(text) to authenticated;

-- ---------------------------------------------------------------------
-- 1. Flotte
-- ---------------------------------------------------------------------
create or replace view public.moto_v_flotte with (security_invoker = on) as
select m.id, m.code, m.qr_token, m.marque, m.modele, m.annee, m.couleur, m.numero_chassis, m.numero_moteur, m.immatriculation,
       m.date_reception, m.cluster_code, m.zone_code, m.statut_administratif, m.statut_affectation, m.statut_technique,
       m.mise_en_service_at, m.compteur_actuel_km, m.row_version, m.observations,
       a.id as affectation_id, a.beneficiaire_id, private.moto_nom_profil(a.beneficiaire_id) as beneficiaire_nom, a.type_affectation,
       (m.mise_en_service_at is not null and m.statut_technique = 'APTE'
        and m.statut_administratif = 'CONFORME' and m.statut_affectation in ('REMISE','TRANSFEREE')) as autorisee_a_circuler,
       (select count(*) from public.moto_incidents i where i.moto_id = m.id and i.etape <> 'CLOS') as incidents_ouverts,
       (select count(*) from public.moto_immobilisations im where im.moto_id = m.id and im.fin is null) as immobilisations_ouvertes,
       (select max(r.date_releve) from public.moto_releves_km r where r.moto_id = m.id) as dernier_releve_at
from public.moto_motos m
left join public.moto_affectations a on a.moto_id = m.id and a.statut = 'ACTIVE'
where m.actif;

-- ---------------------------------------------------------------------
-- 2. Consommation réelle : méthode plein à plein
--    L/100 km = 100 × litres achetés entre deux pleins complets (plein final
--    inclus, plein initial exclu) ÷ km parcourus entre ces pleins.
--    Les achats au justificatif REJETÉ sont exclus.
-- ---------------------------------------------------------------------
create or replace view public.moto_v_conso_intervalles with (security_invoker = on) as
with pleins as (
  select c.*, lag(c.id) over w as debut_id, lag(c.compteur_km) over w as debut_km, lag(c.date_achat) over w as debut_date
  from public.moto_carburant c
  where c.plein_complet and c.justificatif_statut <> 'REJETE'
  window w as (partition by c.moto_id order by c.compteur_km, c.date_achat)
)
select p.moto_id, p.debut_id, p.id as fin_id, p.debut_date, p.date_achat as fin_date, p.debut_km, p.compteur_km as fin_km,
       p.compteur_km - p.debut_km as km,
       x.litres, x.nb_achats, x.nb_non_verifies,
       case when p.compteur_km - p.debut_km > 0 then round(100 * x.litres / (p.compteur_km - p.debut_km), 2) end as l_100km,
       case when p.compteur_km - p.debut_km <= 0 then 'INVALIDE'
            when 100 * x.litres / (p.compteur_km - p.debut_km) >= private.moto_param('conso_seuil_verification_2') then 'VERIFICATION_PRIORITAIRE'
            when 100 * x.litres / (p.compteur_km - p.debut_km) >= private.moto_param('conso_seuil_verification_1') then 'VERIFICATION'
            else 'NORMAL' end as statut_alerte
from pleins p
cross join lateral (
  select sum(c2.litres) as litres, count(*) as nb_achats, count(*) filter (where c2.justificatif_statut <> 'VERIFIE') as nb_non_verifies
  from public.moto_carburant c2
  where c2.moto_id = p.moto_id and c2.justificatif_statut <> 'REJETE'
    and c2.compteur_km > p.debut_km and c2.compteur_km <= p.compteur_km
) x
where p.debut_id is not null;

create or replace view public.moto_v_conso_moto with (security_invoker = on) as
select m.id as moto_id, m.code,
       count(i.fin_id) filter (where i.statut_alerte <> 'INVALIDE') as nb_intervalles,
       sum(i.km) filter (where i.statut_alerte <> 'INVALIDE') as km_mesures,
       sum(i.litres) filter (where i.statut_alerte <> 'INVALIDE') as litres_mesures,
       case when sum(i.km) filter (where i.statut_alerte <> 'INVALIDE') > 0
            then round(100 * sum(i.litres) filter (where i.statut_alerte <> 'INVALIDE') / sum(i.km) filter (where i.statut_alerte <> 'INVALIDE'), 2) end as l_100km,
       private.moto_param('conso_reference_l100') as reference_l100,
       (select max(c.date_achat) from public.moto_carburant c where c.moto_id = m.id and c.plein_complet and c.justificatif_statut <> 'REJETE') as dernier_plein_complet,
       coalesce((select max(c.date_achat) from public.moto_carburant c where c.moto_id = m.id and c.plein_complet and c.justificatif_statut <> 'REJETE')
                < now() - make_interval(days => private.moto_param('controle_plein_complet_jours')::integer), m.mise_en_service_at is not null) as plein_controle_en_retard
from public.moto_motos m
left join public.moto_v_conso_intervalles i on i.moto_id = m.id
where m.actif
group by m.id, m.code, m.mise_en_service_at;

-- ---------------------------------------------------------------------
-- 3. Rapprochement des dotations par bénéficiaire
--    Reçu = montant dont le bénéficiaire a confirmé la réception (CONFIRMEE, ou
--    CONTESTEE pour la part effectivement reçue ; l'écart reste signalé à part).
--    Distingue : autorisé, remis, reçu confirmé, achats déclarés, justifiés
--    vérifiés, avance à apurer, restitutions, avances personnelles,
--    remboursements. Aucun double comptage dotation / remboursement.
-- ---------------------------------------------------------------------
create or replace view public.moto_v_rapprochement with (security_invoker = on) as
with b as (
  select beneficiaire_id from public.moto_budgets union select beneficiaire_id from public.moto_dotations
  union select agent_id from public.moto_carburant union select beneficiaire_id from public.moto_restitutions
)
select b.beneficiaire_id, private.moto_nom_profil(b.beneficiaire_id) as beneficiaire_nom,
  coalesce((select sum(montant_autorise) from public.moto_budgets x where x.beneficiaire_id = b.beneficiaire_id and x.statut = 'VALIDE'), 0) as budget_autorise,
  coalesce((select sum(montant_remis) from public.moto_dotations x where x.beneficiaire_id = b.beneficiaire_id and x.statut in ('REMISE_DECLAREE','CONFIRMEE','CONTESTEE')), 0) as dotations_remises,
  coalesce((select sum(frais_transaction) from public.moto_dotations x where x.beneficiaire_id = b.beneficiaire_id and x.statut in ('REMISE_DECLAREE','CONFIRMEE','CONTESTEE')), 0) as frais_mobile_money,
  coalesce((select sum(montant_remis) from public.moto_dotations x where x.beneficiaire_id = b.beneficiaire_id and x.statut = 'REMISE_DECLAREE'), 0) as remises_non_confirmees,
  coalesce((select sum(montant_recu) from public.moto_dotations x where x.beneficiaire_id = b.beneficiaire_id and x.statut in ('CONFIRMEE','CONTESTEE')), 0) as dotations_recues,
  coalesce((select sum(montant_remis - coalesce(montant_recu, 0)) from public.moto_dotations x where x.beneficiaire_id = b.beneficiaire_id and x.statut = 'CONTESTEE'), 0) as ecarts_contestes,
  coalesce((select sum(montant) from public.moto_carburant x where x.agent_id = b.beneficiaire_id and x.financement = 'DOTATION' and x.justificatif_statut <> 'REJETE'), 0) as achats_declares,
  coalesce((select sum(montant) from public.moto_carburant x where x.agent_id = b.beneficiaire_id and x.financement = 'DOTATION' and x.justificatif_statut = 'VERIFIE'), 0) as justifies_verifies,
  coalesce((select sum(montant) from public.moto_restitutions x where x.beneficiaire_id = b.beneficiaire_id), 0) as restitutions,
  coalesce((select sum(montant_recu) from public.moto_dotations x where x.beneficiaire_id = b.beneficiaire_id and x.statut in ('CONFIRMEE','CONTESTEE')), 0)
    - coalesce((select sum(montant) from public.moto_carburant x where x.agent_id = b.beneficiaire_id and x.financement = 'DOTATION' and x.justificatif_statut = 'VERIFIE'), 0)
    - coalesce((select sum(montant) from public.moto_restitutions x where x.beneficiaire_id = b.beneficiaire_id), 0) as avance_a_apurer,
  coalesce((select sum(montant) from public.moto_carburant x where x.agent_id = b.beneficiaire_id and x.financement = 'AVANCE_PERSONNELLE' and x.justificatif_statut <> 'REJETE'), 0) as avances_personnelles_declarees,
  coalesce((select sum(montant) from public.moto_carburant x where x.agent_id = b.beneficiaire_id and x.financement = 'AVANCE_PERSONNELLE' and x.justificatif_statut = 'VERIFIE'), 0) as avances_personnelles_verifiees,
  coalesce((select sum(montant) from public.moto_remboursements x where x.beneficiaire_id = b.beneficiaire_id and x.statut in ('VALIDE','PAYE_DECLARE')), 0) as remboursements_valides,
  coalesce((select sum(montant) from public.moto_remboursements x where x.beneficiaire_id = b.beneficiaire_id and x.statut = 'PAYE_DECLARE'), 0) as remboursements_payes_declares,
  coalesce((select sum(montant) from public.moto_carburant x where x.agent_id = b.beneficiaire_id and x.financement = 'AVANCE_PERSONNELLE' and x.justificatif_statut = 'VERIFIE' and x.remboursement_id is null), 0) as reste_a_rembourser
from b;

-- ---------------------------------------------------------------------
-- 4. Coût direct d'exploitation (FCFA/km)
--    Coûts imputables : carburant justifié VÉRIFIÉ (quel que soit le
--    financement : dotation OU avance personnelle, comptés une seule fois au
--    niveau de l'achat), maintenances terminées, réparations et achats de
--    pneus montés, coûts réels d'incidents sans maintenance liée.
--    Dotations et remboursements sont des flux de trésorerie : exclus.
-- ---------------------------------------------------------------------
create or replace view public.moto_v_couts with (security_invoker = on) as
select m.id as moto_id, m.code, m.mise_en_service_at,
  (select min(r.compteur_km) from public.moto_releves_km r where r.moto_id = m.id and m.mise_en_service_at is not null
     and r.date_releve >= m.mise_en_service_at - interval '2 days') as km_debut,
  m.compteur_actuel_km as km_fin,
  coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = m.id and c.justificatif_statut = 'VERIFIE'), 0) as cout_carburant_verifie,
  coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = m.id and c.justificatif_statut = 'A_VERIFIER'), 0) as cout_carburant_a_verifier,
  coalesce((select sum(mt.cout_reel) from public.moto_maintenances mt where mt.moto_id = m.id and mt.statut = 'TERMINEE'), 0) as cout_maintenance,
  coalesce((select sum(pr.cout) from public.moto_pneu_reparations pr where pr.moto_id = m.id), 0)
    + coalesce((select sum(pn.cout_achat) from public.moto_pneus pn
                where (select po.moto_id from public.moto_pneu_poses po where po.pneu_id = pn.id order by po.pose_date, po.id limit 1) = m.id), 0) as cout_pneus,
  coalesce((select sum(i.cout_reel) from public.moto_incidents i where i.moto_id = m.id and i.etape = 'CLOS'
              and not exists (select 1 from public.moto_maintenances mt where mt.incident_id = i.id)), 0) as cout_incidents
from public.moto_motos m where m.actif;

create or replace view public.moto_v_cout_km with (security_invoker = on) as
select c.*, c.km_fin - c.km_debut as km_parcourus,
  c.cout_carburant_verifie + c.cout_maintenance + c.cout_pneus + c.cout_incidents as cout_direct_total,
  case when c.km_fin - c.km_debut > 0
       then round((c.cout_carburant_verifie + c.cout_maintenance + c.cout_pneus + c.cout_incidents) / (c.km_fin - c.km_debut), 1) end as fcfa_km
from public.moto_v_couts c;

-- ---------------------------------------------------------------------
-- 5. Disponibilité technique
--    Jours opérationnels prévus depuis la mise en service (paramètre
--    jours_operationnels_semaine : 6 = lundi à samedi) ; un jour est
--    indisponible s'il chevauche une immobilisation.
-- ---------------------------------------------------------------------
create or replace view public.moto_v_disponibilite with (security_invoker = on) as
with jours as (
  select m.id as moto_id, d::date as jour
  from public.moto_motos m
  cross join lateral generate_series(m.mise_en_service_at::date, current_date, interval '1 day') d
  where m.actif and m.mise_en_service_at is not null
    and extract(isodow from d) <= private.moto_param('jours_operationnels_semaine')
)
select j.moto_id, count(*) as jours_prevus,
  count(*) filter (where exists (select 1 from public.moto_immobilisations im where im.moto_id = j.moto_id
                    and im.debut::date <= j.jour and coalesce(im.fin, now())::date >= j.jour)) as jours_indisponibles,
  round(100.0 * (count(*) - count(*) filter (where exists (select 1 from public.moto_immobilisations im where im.moto_id = j.moto_id
                    and im.debut::date <= j.jour and coalesce(im.fin, now())::date >= j.jour))) / nullif(count(*), 0), 1) as taux_disponibilite_pct
from jours j group by j.moto_id;

-- ---------------------------------------------------------------------
-- 6. Échéances de maintenance (règles paramétrables actives seulement)
-- ---------------------------------------------------------------------
create or replace view public.moto_v_echeances with (security_invoker = on) as
select m.id as moto_id, m.code, r.code as regle, r.libelle, r.source, r.intervalle_km, r.intervalle_jours,
  coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) as base_km,
  coalesce(last.termine_at, m.mise_en_service_at)::date as base_date,
  coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) + r.intervalle_km as prochaine_km,
  (coalesce(last.termine_at, m.mise_en_service_at)::date + r.intervalle_jours) as prochaine_date,
  case
    when (r.intervalle_km is not null and m.compteur_actuel_km >= coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) + r.intervalle_km)
      or (r.intervalle_jours is not null and current_date >= coalesce(last.termine_at, m.mise_en_service_at)::date + r.intervalle_jours) then 'DEPASSEE'
    when (r.intervalle_km is not null and m.compteur_actuel_km >= coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) + r.intervalle_km - r.tolerance_km)
      or (r.intervalle_jours is not null and current_date >= coalesce(last.termine_at, m.mise_en_service_at)::date + r.intervalle_jours - 7) then 'PROCHE'
    when coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) is null
      and coalesce(last.termine_at, m.mise_en_service_at) is null then 'NON_DISPONIBLE'
    else 'A_JOUR' end as statut
from public.moto_motos m
cross join public.moto_regles_maintenance r
left join lateral (select mt.compteur_km, mt.termine_at from public.moto_maintenances mt
                   where mt.moto_id = m.id and mt.statut = 'TERMINEE' and mt.type_maintenance = r.type_maintenance
                   order by mt.termine_at desc limit 1) last on true
where m.actif and r.actif and m.mise_en_service_at is not null;

-- ---------------------------------------------------------------------
-- 7. Alertes documentaires
-- ---------------------------------------------------------------------
create or replace view public.moto_v_alertes_documents with (security_invoker = on) as
select m.id as moto_id, m.code, t.type_document, d.id as document_id, d.statut, d.date_expiration,
  case when d.id is null then 'MANQUANT'
       when d.statut = 'NON_CONFORME' then 'NON_CONFORME'
       when d.statut = 'EN_VERIFICATION' then 'EN_VERIFICATION'
       when d.date_expiration is not null and d.date_expiration < current_date then 'EXPIRE'
       when d.date_expiration is not null and d.date_expiration < current_date + private.moto_param('alerte_document_jours')::integer then 'EXPIRE_BIENTOT'
       else 'OK' end as alerte
from public.moto_motos m
cross join lateral (select jsonb_array_elements_text(valeur_json) as type_document from public.moto_parametres where cle = 'documents_obligatoires') t
left join lateral (select * from public.moto_documents d where d.moto_id = m.id and d.type_document = t.type_document and d.statut <> 'REMPLACE'
                   order by d.depose_at desc limit 1) d on true
where m.actif;

-- ---------------------------------------------------------------------
-- 8. Pneumatiques : durée de vie et coût par km sur données réelles
-- ---------------------------------------------------------------------
create or replace view public.moto_v_pneus with (security_invoker = on) as
select pn.id, pn.code, pn.marque, pn.modele, pn.dimensions, pn.statut, pn.cout_achat,
  (select po.moto_id from public.moto_pneu_poses po where po.pneu_id = pn.id and po.depose_date is null) as moto_actuelle_id,
  (select po.position from public.moto_pneu_poses po where po.pneu_id = pn.id and po.depose_date is null) as position_actuelle,
  coalesce((select sum(coalesce(po.depose_km, mm.compteur_actuel_km) - po.pose_km) from public.moto_pneu_poses po
            join public.moto_motos mm on mm.id = po.moto_id where po.pneu_id = pn.id), 0) as km_parcourus,
  coalesce((select sum(r.cout) from public.moto_pneu_reparations r where r.pneu_id = pn.id), 0) as cout_reparations,
  (select count(*) from public.moto_pneu_reparations r where r.pneu_id = pn.id) as nb_reparations,
  case when pn.statut = 'REFORME' and pn.cout_achat is not null
         and coalesce((select sum(po.depose_km - po.pose_km) from public.moto_pneu_poses po where po.pneu_id = pn.id), 0) > 0
       then round((pn.cout_achat + coalesce((select sum(r.cout) from public.moto_pneu_reparations r where r.pneu_id = pn.id), 0))
                  / (select sum(po.depose_km - po.pose_km) from public.moto_pneu_poses po where po.pneu_id = pn.id), 2) end as fcfa_km_vie_complete
from public.moto_pneus pn;

-- ---------------------------------------------------------------------
-- 9. Qualité des données (diagnostic, jamais sanction)
-- ---------------------------------------------------------------------
create or replace view public.moto_v_qualite_donnees with (security_invoker = on) as
select m.id as moto_id, m.code,
  (select count(*) from public.moto_carburant c where c.moto_id = m.id and c.justificatif_path is null) as achats_sans_justificatif,
  (select count(*) from public.moto_carburant c where c.moto_id = m.id and c.justificatif_statut = 'A_VERIFIER') as justificatifs_a_verifier,
  (select count(*) from public.moto_carburant c where c.moto_id = m.id and c.plein_complet and c.justificatif_statut <> 'REJETE') as pleins_complets,
  (select count(*) from public.moto_v_conso_intervalles i where i.moto_id = m.id and i.statut_alerte = 'INVALIDE') as intervalles_invalides,
  case when (select max(r.date_releve) from public.moto_releves_km r where r.moto_id = m.id) is null then null
       else current_date - (select max(r.date_releve) from public.moto_releves_km r where r.moto_id = m.id)::date end as jours_depuis_dernier_releve,
  (select count(*) from public.moto_corrections k where k.statut = 'DEMANDEE'
     and ((k.cible_table = 'moto_carburant' and exists (select 1 from public.moto_carburant c where c.id = k.cible_id and c.moto_id = m.id))
       or (k.cible_table = 'moto_releves_km' and exists (select 1 from public.moto_releves_km r where r.id = k.cible_id and r.moto_id = m.id)))) as corrections_en_attente
from public.moto_motos m where m.actif;

-- Formation : synthèse par utilisateur et module
create or replace view public.moto_v_formation with (security_invoker = on) as
select f.user_id, private.moto_nom_profil(f.user_id) as nom, f.module_code,
  count(*) as tentatives, max(f.score::numeric / f.total) as meilleur_taux, bool_or(f.reussi) as reussi, max(f.realise_at) as derniere_tentative
from public.moto_formation_resultats f group by f.user_id, f.module_code;

do $$
declare v text;
begin
  foreach v in array array['moto_v_flotte','moto_v_conso_intervalles','moto_v_conso_moto','moto_v_rapprochement','moto_v_couts',
    'moto_v_cout_km','moto_v_disponibilite','moto_v_echeances','moto_v_alertes_documents','moto_v_pneus','moto_v_qualite_donnees','moto_v_formation']
  loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

commit;
