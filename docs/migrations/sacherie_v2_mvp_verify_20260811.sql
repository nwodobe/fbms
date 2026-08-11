-- Vérification post-migration Sacherie V2 MVP
-- LECTURE SEULE : aucun changement de données.

-- A. Objets principaux
select 'bag_movement_requests' as objet,
       to_regclass('public.bag_movement_requests') is not null as ok;

-- B. Colonnes de la demande
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='bag_movement_requests'
  and column_name in (
    'client_request_id','request_code','cluster','zone','rt_id','cycle_id',
    'stock_rcn_kg_verified','stock_checked_by','volume_finance_kg',
    'volume_achete_cycle_kg','volume_finance_restant_kg','bags_already_held',
    'reserved_approved_bags','system_max_bags','max_new_bags','max_new_available',
    'cluster_stock_at_request','requested_qty','approved_qty','status',
    'requested_by','approved_by','expires_at','closed_at'
  )
order by column_name;

-- C. Colonnes du registre sacs
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='sacs_mouvements'
  and column_name in (
    'request_id','bag_movement_code','approved_qty','executed_qty','bag_state',
    'lot_id','business_status','issued_by','issued_at','received_by','received_at','correction_of'
  )
order by column_name;

-- D. Cash / Achats / Profils
select table_name,column_name,data_type
from information_schema.columns
where table_schema='public'
  and (
    (table_name='avances' and column_name in ('cycle_id','volume_finance_kg','prix_reference_kg','cycle_statut'))
    or (table_name='achats' and column_name='cycle_id')
    or (table_name='profils' and column_name in ('fonction_operationnelle','cluster','zone'))
  )
order by table_name,column_name;

-- E. Fonctions attendues
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'sacherie_mon_contexte','peut_demander_sacherie','peut_executer_sacherie',
    'sacherie_peut_lire_demande','sacherie_sacs_sous_responsabilite_rt',
    'sacherie_stock_cluster','sacherie_reservations_rt','sacherie_assign_cycle_achat',
    'sacherie_configurer_cycle','sacherie_cloturer_cycle','sacherie_calculer_plafond',
    'sacherie_creer_demande','sacherie_decider_demande','sacherie_guard_mouvement',
    'sacherie_executer_demande'
  )
order by p.proname,arguments;

-- F. Policies RLS
select tablename,policyname,cmd,qual,with_check
from pg_policies
where schemaname='public'
  and tablename in ('bag_movement_requests','sacs_mouvements')
order by tablename,policyname;

-- G. Triggers
select trigger_name,event_object_table,event_manipulation,action_timing
from information_schema.triggers
where trigger_schema='public'
  and trigger_name in ('trg_sacherie_guard_mouvement','trg_sacherie_assign_cycle_achat')
order by trigger_name;

-- H. Index uniques critiques
select indexname,indexdef
from pg_indexes
where schemaname='public'
  and indexname in (
    'avances_cycle_id_uidx','avances_un_cycle_open_par_rt_uidx',
    'sacs_bag_movement_code_uidx','sacs_request_once_uidx',
    'bag_req_client_request_uidx'
  )
order by indexname;

-- I. Contrôles de cohérence des données existantes après migration
select 'plusieurs_cycles_open_meme_rt' as controle,count(*) as anomalies
from (
  select rt_id
  from public.avances
  where cycle_id is not null and cycle_statut='OPEN'
  group by rt_id having count(*)>1
) x
union all
select 'bag_movement_code_duplique',count(*)
from (
  select bag_movement_code
  from public.sacs_mouvements
  where bag_movement_code is not null
  group by bag_movement_code having count(*)>1
) x
union all
select 'request_id_execute_plus_une_fois',count(*)
from (
  select request_id
  from public.sacs_mouvements
  where request_id is not null
  group by request_id having count(*)>1
) x
union all
select 'full_sans_lot_id',count(*)
from public.sacs_mouvements
where bag_state='FULL' and nullif(btrim(lot_id),'') is null;

-- Résultat attendu :
-- - tous les objets/colonnes/fonctions/index apparaissent ;
-- - bag_req n'a pas de policy INSERT/UPDATE/DELETE directe ;
-- - sacs_ins refuse DOTATION_RT directe ;
-- - les quatre compteurs d'anomalies valent 0 pour les données V2.
