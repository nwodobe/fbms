-- =====================================================================
-- Retour arrière de 20261118110000_sacherie_lot1bis_circuit_unique_plafond.sql
-- À n'exécuter que sur décision du Branch Manager.
-- La partie A (suppression des 23 emplacements LBA) est définitive :
-- les lignes supprimées restent lisibles dans public.rcn_proc_audit_central
-- (record_id = code, action = DELETE, before_data = ligne complète) et
-- peuvent être réinsérées à partir de before_data si nécessaire.
-- =====================================================================
begin;

-- D. Rétablir campaign = '2027' dans les RPC terrain
do $$
declare f text; d text;
begin
  foreach f in array array['sacherie_ops_network_move','sacherie_ops_create_transfer','sacherie_ops_receive_transfer'] loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f;
    execute replace(d, $q$'ANAGROCI',v_uid,null$q$, $q$'ANAGROCI',v_uid,'2027'$q$);
  end loop;
end $$;

-- C. Retirer le plafond du circuit unique
drop trigger if exists trg_ops_bag_request_plafond on public.ops_bag_requests;
drop function if exists private.ops_aflp_plafond_guard();
drop function if exists public.ops_aflp_plafond_apercu(uuid, text, numeric);
drop function if exists private.ops_aflp_plafond(text, text, numeric, uuid);
alter table public.ops_bag_requests
  drop column if exists plafond_snapshot,
  drop column if exists stock_rcn_kg_verified,
  drop column if exists cycle_id;

-- B. Rouvrir l'ancien circuit
drop trigger if exists trg_sacherie_circuit_a_ferme on public.bag_movement_requests;
drop trigger if exists trg_sacherie_circuit_a_ferme on public.sacs_mouvements;
drop function if exists private.sacherie_circuit_a_ferme();
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('sacherie_creer_demande','sacherie_decider_demande','sacherie_executer_demande')
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;
