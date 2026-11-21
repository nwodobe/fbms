-- ============================================================================
-- NIVEAU 1 — VÉRIFICATION APRÈS MIGRATION
-- ----------------------------------------------------------------------------
-- Lecture seule. À exécuter juste après les migrations 01 à 09, avant toute
-- reprise des opérations. Chaque ligne dont le verdict n'est pas « OK » est
-- bloquante.
-- ============================================================================

\echo '=== NIVEAU 1 — VÉRIFICATION D''INSTALLATION ==='

-- 1) Objets attendus -----------------------------------------------------------
select 'TABLES' as bloc, t.nom,
       case when to_regclass('public.'||t.nom) is not null then 'OK' else 'MANQUANT' end as verdict
from (values ('n1_parametres'),('n1_audit'),('n1_cycles'),('n1_exceptions'),('n1_transitions'),
             ('n1_ajustements'),('n1_soldes'),('n1_stock_mouvements'),('n1_lots'),
             ('n1_evacuations'),('n1_receptions_usine'),('n1_reconciliation_lignes'),
             ('n1_anomalies'),('n1_anomalies_historique'),('n1_sync_operations'),
             ('n1_sync_conflits'),('n1_papier_series'),('n1_papier_numeros')) t(nom)
order by 3 desc, 2;

select 'FONCTIONS' as bloc, f.nom,
       case when to_regproc('public.'||f.nom) is not null then 'OK' else 'MANQUANTE' end as verdict
from (values ('n1_auditer'),('n1_definir_parametre'),('n1_param_num_obligatoire'),
             ('n1_ouvrir_cycle'),('n1_rt_refinancable'),('n1_cycle_disponible'),
             ('n1_appliquer_solde'),('n1_demander_ajustement'),('n1_approuver_ajustement'),
             ('n1_reconcilier_cycle'),('n1_debloquer_cycle'),('n1_lever_anomalie'),
             ('n1_detecter_anomalies'),('n1_sync_pousser'),('n1_sync_etat'),
             ('n1_papier_creer_serie'),('n1_papier_consommer')) f(nom)
order by 3 desc, 2;

-- 2) Triggers dans le bon ordre d'exécution ------------------------------------
-- L'ordre est ALPHABÉTIQUE : 05 verrou, 10 identité, 15 champs, 20 gardes,
-- 30 statut, 50 soldes, 60 stock, 90 audit. Un rang manquant ou mal nommé
-- laisserait passer des écritures que la garde suivante croit déjà validées.
select 'TRIGGERS' as bloc, c.relname as table_concernee, t.tgname as trigger,
       case when t.tgenabled = 'O' then 'ACTIF' else 'DÉSACTIVÉ — BLOQUANT' end as verdict
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'trg_n1%'
order by c.relname, t.tgname;

-- 3) Journal d'audit : append-only effectif ------------------------------------
select 'AUDIT APPEND-ONLY' as bloc,
       case when count(*) filter (where tgname = 'trg_n1_audit_immuable') = 1
             and count(*) filter (where tgname = 'trg_n1_audit_immuable_trunc') = 1
            then 'OK — UPDATE, DELETE et TRUNCATE rejetés'
            else 'BLOQUANT — le journal est modifiable' end as verdict
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where c.relname = 'n1_audit' and not t.tgisinternal;

select 'AUDIT — DROITS' as bloc,
       case when has_table_privilege('authenticated','public.n1_audit','UPDATE')
              or has_table_privilege('authenticated','public.n1_audit','DELETE')
            then 'BLOQUANT — authenticated peut écrire sur l''audit'
            else 'OK' end as verdict;

-- 4) RLS active partout --------------------------------------------------------
select 'RLS' as bloc, tablename,
       case when rowsecurity then 'OK' else 'BLOQUANT — RLS inactive' end as verdict
from pg_tables
where schemaname = 'public'
  and tablename in ('achats','avances','reconciliations','sacs_mouvements','profils',
                    'n1_audit','n1_parametres','n1_cycles','n1_soldes','n1_anomalies',
                    'n1_sync_operations','n1_papier_numeros','n1_ajustements')
order by 3 desc, 2;

-- 5) Contraintes d'intégrité ---------------------------------------------------
select 'CONTRAINTES' as bloc, conname,
       case when convalidated then 'VALIDÉE (historique conforme)'
            else 'NOT VALID (protège les lignes nouvelles — normal après migration)' end as etat
from pg_constraint
where conname like '%local_id_requis%' or conname like '%cle_idem_requise%'
   or conname = 'n1_soldes_non_negatif_chk' or conname like '%n1_statut_chk'
order by 2;

select 'INDEX D''UNICITÉ' as bloc, indexname,
       case when indexname is not null then 'OK' else 'MANQUANT' end as verdict
from pg_indexes
where schemaname = 'public'
  and indexname in ('achats_recu_campagne_rt_uidx','n1_cycles_un_actif_par_rt_uidx',
                    'n1_anom_empreinte_uidx','n1_sync_cle_uidx','n1_pap_num_lisible_uidx',
                    'n1_soldes_uk','n1_recep_evac_uidx')
order by 2;

-- 6) Paramétrage obligatoire ---------------------------------------------------
-- Tant qu'un paramètre à risque n'est pas saisi, l'opération correspondante est
-- REFUSÉE. C'est voulu — mais il faut le savoir avant d'envoyer les équipes.
select 'PARAMÈTRES' as bloc, p.cle,
       case when exists (select 1 from public.n1_parametres x
                         where x.cle = p.cle and x.actif = true)
            then 'DÉFINI'
            else 'NON DÉFINI — l''opération correspondante sera REFUSÉE' end as verdict
from (values ('campagne_active'),('plafond_cycle_montant_max'),('plafond_avance_montant_max'),
             ('plafond_achat_montant_max'),('cycle_duree_jours'),('tolerance_montant_fcfa'),
             ('tolerance_cash_fcfa'),('tolerance_poids_kg'),('tolerance_sacs_qte'),
             ('tolerance_usine_kg'),('format_numero_papier')) p(cle)
order by 3, 2;

-- 7) Machine d'état ------------------------------------------------------------
select 'MACHINE D''ÉTAT' as bloc, entite, count(*) as transitions_declarees,
       case when count(*) > 0 then 'OK' else 'BLOQUANT' end as verdict
from public.n1_transitions group by entite;

-- 8) Cohérence des données après migration -------------------------------------
select 'DONNÉES' as bloc, 'achats sans campagne' as controle, count(*) as nb,
       case when count(*) = 0 then 'OK' else 'À RÉGULARISER' end as verdict
from public.achats where campagne is null
union all
select 'DONNÉES', 'achats sans cycle rattaché', count(*),
       case when count(*) = 0 then 'OK' else 'HISTORIQUE — normal, à rattacher si besoin' end
from public.achats where cycle_uid is null
union all
select 'DONNÉES', 'soldes physiques négatifs', count(*),
       case when count(*) = 0 then 'OK' else 'BLOQUANT' end
from public.n1_soldes where quantite < 0;

\echo '=== FIN DE LA VÉRIFICATION ==='
