-- ============================================================================
-- NIVEAU 1 — PRÉ-CONTRÔLE  (À EXÉCUTER AVANT TOUTE MIGRATION)
-- ----------------------------------------------------------------------------
-- CE SCRIPT NE MODIFIE RIEN. Aucun INSERT, aucun UPDATE, aucun DELETE, aucun
-- DDL. Il se contente de MESURER ce que les nouvelles contraintes rencontreront
-- dans les données existantes.
--
-- À exécuter dans Supabase → SQL Editor, sur la base concernée, et à conserver
-- avec sa sortie : c'est la pièce justificative de la décision de migrer.
--
-- LECTURE DU RÉSULTAT
--   nb = 0            → la contrainte passera sans difficulté.
--   nb > 0            → l'historique viole la règle. Les contraintes étant
--                       posées NOT VALID, la migration RÉUSSIRA quand même et
--                       protégera les lignes nouvelles ; l'historique devra
--                       être régularisé avant tout `VALIDATE CONSTRAINT`.
--   « objet absent »  → la table ou colonne n'existe pas dans cette base : la
--                       migration correspondante est sans objet ici.
-- ============================================================================

\echo '=== NIVEAU 1 — PRÉ-CONTRÔLE — aucune écriture ne sera effectuée ==='

-- ---------------------------------------------------------------------------
-- 0) État des objets attendus
-- ---------------------------------------------------------------------------
select 'PRÉSENCE DES OBJETS' as controle;

select t.nom as objet,
       case when to_regclass('public.' || t.nom) is null then 'ABSENT' else 'PRÉSENT' end as etat
from (values ('achats'),('avances'),('reconciliations'),('sacs_mouvements'),('profils'),
             ('rt'),('villages'),('producteurs'),('bag_movement_requests'),
             ('audit_log'),('rcn_jute_settings'),('rcn_jute_transfers')) t(nom)
order by 2, 1;

-- Objets appelés par le frontend dont la DDL n'est pas au dépôt : leur présence
-- réelle détermine si la base a dérivé du code source.
select 'FONCTIONS HORS DÉPÔT' as controle;
select p.proname as fonction, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'sacherie_%' or p.proname like 'n1_%')
order by 1;

select 'INDEX D''UNICITÉ EXISTANTS SUR achats' as controle;
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'achats' and indexdef ilike '%unique%'
order by 1;

-- ---------------------------------------------------------------------------
-- 1) LOT A — reçus dupliqués
-- ---------------------------------------------------------------------------
select 'A1 · REÇUS DUPLIQUÉS (portée campagne + RT)' as controle;

with norme as (
  select id, rt_id, numero_recu, created_at,
         nullif(upper(regexp_replace(coalesce(numero_recu,''), '[^A-Za-z0-9]', '', 'g')), '') as recu_norme
  from public.achats
)
select rt_id, recu_norme, count(*) as nb_occurrences,
       min(created_at) as premiere, max(created_at) as derniere,
       string_agg(id::text, ', ' order by created_at) as identifiants
from norme
where recu_norme is not null
group by rt_id, recu_norme
having count(*) > 1
order by count(*) desc, rt_id
limit 200;

select 'A1bis · VOLUMÉTRIE DES DOUBLONS DE REÇU' as controle;
with norme as (
  select rt_id, nullif(upper(regexp_replace(coalesce(numero_recu,''), '[^A-Za-z0-9]','','g')),'') r
  from public.achats),
     g as (select rt_id, r, count(*) n from norme where r is not null group by 1,2 having count(*)>1)
select coalesce(sum(n - 1), 0) as lignes_en_trop,
       count(*) as groupes_concernes,
       (select count(*) from public.achats) as total_achats
from g;

-- ---------------------------------------------------------------------------
-- 2) LOT A — identifiants de synchronisation absents
-- ---------------------------------------------------------------------------
select 'A2 · LIGNES SANS IDENTIFIANT LOCAL' as controle;

select 'achats' as table_concernee,
       count(*) filter (where local_id is null or btrim(local_id) = '') as sans_local_id,
       count(*) as total from public.achats
union all select 'avances',
       count(*) filter (where local_id is null or btrim(local_id) = ''), count(*) from public.avances
union all select 'reconciliations',
       count(*) filter (where local_id is null or btrim(local_id) = ''), count(*) from public.reconciliations
union all select 'sacs_mouvements',
       count(*) filter (where local_id is null or btrim(local_id) = ''), count(*) from public.sacs_mouvements;

-- ---------------------------------------------------------------------------
-- 3) LOT B — intégrité référentielle (aucune FK aujourd'hui)
-- ---------------------------------------------------------------------------
select 'B1 · ACHATS DONT LE RT EST HORS RÉFÉRENTIEL' as controle;
select count(*) as nb_achats, count(distinct a.rt_id) as nb_rt_inconnus
from public.achats a
where a.rt_id is not null
  and not exists (select 1 from public.rt r where r.id::text = a.rt_id);

select 'B2 · ACHATS DONT LE PRODUCTEUR EST HORS RÉFÉRENTIEL' as controle;
select count(*) filter (where coalesce(a.producteur_ref, true)) as declares_references_mais_absents,
       count(*) filter (where not coalesce(a.producteur_ref, true)) as declares_non_references,
       count(*) filter (where not coalesce(a.producteur_ref, true)
                          and nullif(btrim(coalesce(a.observation,'')),'') is null) as non_references_sans_justification
from public.achats a
where a.producteur_id is not null
  and not exists (select 1 from public.producteurs p
                  where p.id::text = a.producteur_id or p.code = a.producteur_id);

select 'B3 · ACHATS SANS RT OU SANS PRODUCTEUR' as controle;
select count(*) filter (where rt_id is null or btrim(rt_id) = '') as sans_rt,
       count(*) filter (where producteur_id is null or btrim(producteur_id) = '') as sans_producteur,
       count(*) filter (where created_by is null) as sans_auteur,
       count(*) filter (where date > current_date) as datees_dans_le_futur
from public.achats;

-- ---------------------------------------------------------------------------
-- 4) LOT B — cohérence monétaire et physique
-- ---------------------------------------------------------------------------
select 'B4 · MONTANTS INCOHÉRENTS AVEC poids_net × prix_kg' as controle;
select count(*) as nb_lignes,
       count(*) filter (where abs(montant - round(poids_net * prix_kg)) > 1)   as ecart_sup_1_fcfa,
       count(*) filter (where abs(montant - round(poids_net * prix_kg)) > 100) as ecart_sup_100_fcfa,
       round(max(abs(montant - round(poids_net * prix_kg))), 2) as ecart_max_fcfa,
       round(sum(abs(montant - round(poids_net * prix_kg))), 2) as ecart_cumule_fcfa
from public.achats
where montant is not null and poids_net is not null and prix_kg is not null
  and montant <> round(poids_net * prix_kg);

select 'B5 · PESÉES INCOHÉRENTES' as controle;
select count(*) filter (where poids_brut is not null and tare is not null
                          and abs((poids_brut - tare) - poids_net) > 0.001) as brut_moins_tare_diff_net,
       count(*) filter (where poids_brut is not null and poids_net > poids_brut) as net_superieur_au_brut,
       count(*) filter (where humidite is not null and (humidite < 0 or humidite > 100)) as humidite_hors_bornes,
       count(*) filter (where kor is not null and (kor < 0 or kor > 100)) as kor_hors_bornes
from public.achats;

-- ---------------------------------------------------------------------------
-- 5) LOT B — soldes déjà négatifs
-- ---------------------------------------------------------------------------
select 'B6 · SOLDES DE SACS DÉJÀ NÉGATIFS PAR RT' as controle;
with mouv as (
  select rt_id,
         sum(case when upper(coalesce(destination,'')) = 'RT' then quantite else 0 end)
       - sum(case when upper(coalesce(source,'')) = 'RT' then quantite else 0 end) as solde
  from public.sacs_mouvements where rt_id is not null group by rt_id)
select count(*) filter (where solde < 0) as rt_en_solde_negatif,
       coalesce(min(solde), 0) as pire_solde,
       count(*) as rt_total
from mouv;

select 'B7 · SOLDES DE SACS DÉJÀ NÉGATIFS PAR PRODUCTEUR' as controle;
with mouv as (
  select producteur_id,
         sum(case when upper(coalesce(destination,'')) = 'PRODUCTEUR' then quantite else 0 end)
       - sum(case when upper(coalesce(source,'')) = 'PRODUCTEUR' then quantite else 0 end) as solde
  from public.sacs_mouvements where producteur_id is not null group by producteur_id)
select count(*) filter (where solde < 0) as producteurs_en_solde_negatif,
       coalesce(min(solde), 0) as pire_solde from mouv;

select 'B8 · MOUVEMENTS DE SACS SANS ENTITÉ IDENTIFIÉE' as controle;
select count(*) filter (where upper(coalesce(source,'')) = 'RT' and (rt_id is null or btrim(rt_id) = '')) as source_rt_sans_id,
       count(*) filter (where upper(coalesce(destination,'')) = 'RT' and (rt_id is null or btrim(rt_id) = '')) as dest_rt_sans_id,
       count(*) filter (where upper(coalesce(source,'')) = 'PRODUCTEUR' and (producteur_id is null or btrim(producteur_id) = '')) as source_prod_sans_id,
       count(*) filter (where upper(coalesce(destination,'')) = 'PRODUCTEUR' and (producteur_id is null or btrim(producteur_id) = '')) as dest_prod_sans_id,
       count(*) filter (where source is null and destination is null) as sans_source_ni_destination
from public.sacs_mouvements;

-- ---------------------------------------------------------------------------
-- 6) LOT B/E — cycles de financement existants
-- ---------------------------------------------------------------------------
select 'E1 · RT AYANT PLUSIEURS AVANCES SANS CYCLE RATTACHÉ' as controle;
select count(*) filter (where cycle_id is null) as avances_sans_cycle,
       count(*) filter (where cycle_id is not null and cycle_statut = 'OPEN') as cycles_ouverts,
       count(*) as total_avances,
       count(distinct rt_id) as rt_concernes
from public.avances;

select 'E2 · RT AYANT PLUSIEURS CYCLES OPEN (violerait l''unicité)' as controle;
select rt_id, count(*) as nb_cycles_open, string_agg(cycle_id, ', ') as cycles
from public.avances
where cycle_id is not null and cycle_statut = 'OPEN'
group by rt_id having count(*) > 1
order by 2 desc limit 50;

select 'E3 · EXPOSITION FINANCIÈRE ACTUELLE PAR RT' as controle;
with av as (select rt_id, sum(montant) total_avance from public.avances group by rt_id),
     ac as (select rt_id, sum(montant) total_paye, sum(poids_net) total_kg
            from public.achats where coalesce(rejet,false) = false group by rt_id)
select count(*) as rt_actifs,
       count(*) filter (where coalesce(ac.total_paye,0) > coalesce(av.total_avance,0)) as rt_en_depassement,
       round(coalesce(sum(av.total_avance), 0), 0) as total_avance_programme,
       round(coalesce(sum(ac.total_paye), 0), 0)   as total_paye_programme,
       round(coalesce(sum(greatest(coalesce(ac.total_paye,0) - coalesce(av.total_avance,0), 0)), 0), 0)
         as depassement_cumule_fcfa
from av full join ac on ac.rt_id = av.rt_id;

-- ---------------------------------------------------------------------------
-- 7) LOT D — statuts en texte libre à réconcilier avec la machine d'état
-- ---------------------------------------------------------------------------
select 'D1 · VALEURS RÉELLES DE statut_validation' as controle;
select coalesce(statut_validation, '(null)') as valeur, count(*) as nb
from public.achats group by 1 order by 2 desc;

select 'D2 · VALEURS RÉELLES DE cash_statut ET stock_statut' as controle;
select 'cash_statut' as colonne, coalesce(cash_statut,'(null)') as valeur, count(*) nb
from public.achats group by 1,2
union all
select 'stock_statut', coalesce(stock_statut,'(null)'), count(*) from public.achats group by 1,2
order by 1, 3 desc;

-- ---------------------------------------------------------------------------
-- 8) LOT C — journal d'audit préexistant
-- ---------------------------------------------------------------------------
select 'C1 · TABLE audit_log' as controle;
select case when to_regclass('public.audit_log') is null
            then 'ABSENTE — les politiques conditionnelles de rls.sql n''ont jamais rien protégé'
            else 'PRÉSENTE' end as etat;

-- ---------------------------------------------------------------------------
-- 9) Volumétrie — estimer la durée de la migration
-- ---------------------------------------------------------------------------
select 'VOLUMÉTRIE' as controle;
select relname as table_concernee, n_live_tup as lignes_estimees,
       pg_size_pretty(pg_total_relation_size(c.oid)) as taille
from pg_stat_user_tables s join pg_class c on c.relname = s.relname
where s.schemaname = 'public'
  and s.relname in ('achats','avances','reconciliations','sacs_mouvements','profils',
                    'rt','villages','producteurs')
order by n_live_tup desc;

\echo '=== FIN DU PRÉ-CONTRÔLE — aucune donnée n''a été modifiée ==='
