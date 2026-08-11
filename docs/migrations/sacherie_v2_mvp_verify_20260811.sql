-- Verification post-migration Sacherie V2 MVP
-- Lecture seule. Aucun changement de donnees.

select 'bag_movement_requests' as objet, to_regclass('public.bag_movement_requests') is not null as ok;

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='bag_movement_requests'
order by ordinal_position;

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='sacs_mouvements'
  and column_name in ('request_id','bag_movement_code','approved_qty','executed_qty','bag_state','lot_id','business_status','issued_by','issued_at');

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='avances'
  and column_name in ('cycle_id','volume_finance_kg','prix_reference_kg');

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='achats' and column_name='cycle_id';

select proname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname like 'sacherie_%'
order by proname;

select tablename, policyname, cmd
from pg_policies
where schemaname='public' and tablename in ('bag_movement_requests','sacs_mouvements')
order by tablename, policyname;

select trigger_name, event_object_table
from information_schema.triggers
where trigger_schema='public' and trigger_name in ('trg_sacherie_guard_mouvement','trg_sacherie_assign_cycle_achat');
