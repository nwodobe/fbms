-- =====================================================================
-- FBMS · Sacherie AFLP · Lot 1 bis
-- Décisions du Branch Manager (M. KOUASSI) du 18/11/2026 :
--   A. Suppression définitive des 23 emplacements LBA (BAG-ACTOR-LBA-*) :
--      les sacs LBA sont gérés dans PJS (décision du 12/11/2026).
--   B. Circuit unique de dotation : ops_bag_requests -> ops_release_bags
--      (FIELD BUYING › Sacherie AFLP). L'ancien circuit Sacherie V2
--      (bag_movement_requests / DOTATION_RT, terrain/sacherie_v2.html) est fermé
--      en écriture ; ses données restent lisibles.
--   C. Plafond de sacs par RT appliqué à l'approbation BM du circuit unique.
--   D. Correctif : trois RPC terrain écrivaient campaign = '2027', code de la
--      campagne « Simulation AFLP 2027 ». Les mouvements réels étaient donc
--      rattachés à la simulation au lieu de la campagne courante.
-- Retour arrière : 20261118110100_sacherie_lot1bis_rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. Suppression des 23 emplacements LBA
--    Vérifié le 18/11/2026 : 0 mouvement, 0 demande, 0 transfert,
--    0 inventaire rattaché ; aucune fonction serveur ne les recrée.
--    La migration n'a pas d'utilisateur authentifié : le trigger d'audit
--    est suspendu le temps de la suppression (même méthode que la migration
--    20260924235348) et la trace est écrite explicitement ci-dessous.
-- ---------------------------------------------------------------------
do $$
declare v_dep integer;
begin
  select count(*) into v_dep from (
    select 1 from public.rcn_jute_movements m
      where m.from_location like 'BAG-ACTOR-LBA-%' or m.to_location like 'BAG-ACTOR-LBA-%'
    union all select 1 from public.ops_bag_requests r
      where r.source_location_code like 'BAG-ACTOR-LBA-%' or r.destination_location_code like 'BAG-ACTOR-LBA-%'
    union all select 1 from public.ops_bag_releases r
      where r.source_location_code like 'BAG-ACTOR-LBA-%' or r.destination_location_code like 'BAG-ACTOR-LBA-%'
    union all select 1 from public.rcn_jute_transfers t
      where t.from_location like 'BAG-ACTOR-LBA-%' or t.to_location like 'BAG-ACTOR-LBA-%'
    union all select 1 from public.rcn_jute_inventories i where i.location_code like 'BAG-ACTOR-LBA-%'
    union all select 1 from public.rcn_jute_loss_requests l where l.location_code like 'BAG-ACTOR-LBA-%'
  ) x;
  if v_dep > 0 then
    raise exception 'Suppression LBA annulée : % ligne(s) dépendante(s) apparue(s) depuis l''audit', v_dep;
  end if;
end $$;

insert into public.rcn_proc_audit_central(table_name, record_id, action, before_data, after_data, actor_id, actor_role)
select 'rcn_jute_locations', l.code, 'DELETE', to_jsonb(l), null, null,
       'MIGRATION 20261118110000 · décision Branch Manager du 18/11/2026'
  from public.rcn_jute_locations l
 where l.code like 'BAG-ACTOR-LBA-%' and l.scope_type = 'LBA';

alter table public.rcn_jute_locations disable trigger trg_rcn_jute_locations_audit;
delete from public.rcn_jute_locations where code like 'BAG-ACTOR-LBA-%' and scope_type = 'LBA';
alter table public.rcn_jute_locations enable trigger trg_rcn_jute_locations_audit;

-- ---------------------------------------------------------------------
-- B. Fermeture de l'ancien circuit de dotation (Sacherie V2)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('sacherie_creer_demande','sacherie_decider_demande','sacherie_executer_demande')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

create or replace function private.sacherie_circuit_a_ferme()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_table_name = 'bag_movement_requests'
     or (tg_table_name = 'sacs_mouvements' and new.type = 'DOTATION_RT') then
    raise exception 'Ancien circuit de dotation fermé (décision du Branch Manager du 18/11/2026) : utilisez FIELD BUYING › Sacherie AFLP › Nouvelle demande.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_sacherie_circuit_a_ferme on public.bag_movement_requests;
create trigger trg_sacherie_circuit_a_ferme
  before insert on public.bag_movement_requests
  for each row execute function private.sacherie_circuit_a_ferme();

drop trigger if exists trg_sacherie_circuit_a_ferme on public.sacs_mouvements;
create trigger trg_sacherie_circuit_a_ferme
  before insert on public.sacs_mouvements
  for each row execute function private.sacherie_circuit_a_ferme();

-- ---------------------------------------------------------------------
-- C. Plafond de sacs par RT sur le circuit unique
--    Formule reprise de public.sacherie_calculer_plafond :
--      plafond = floor((stock RCN vérifié + volume financé restant) x 1,10 / 80)
--    Sacs détenus : registre canonique (compte du RT + comptes de ses producteurs).
--    Réservés : demandes AFLP approuvées et pas encore sorties.
--    À trancher (Procurement) : 80 kg par sac ici, alors que la campagne 0002
--    porte config.sacherie.bags_per_mt = 80.
-- ---------------------------------------------------------------------
alter table public.ops_bag_requests
  add column if not exists cycle_id text,
  add column if not exists stock_rcn_kg_verified numeric,
  add column if not exists plafond_snapshot jsonb;

create or replace function private.ops_aflp_plafond(
  p_rt_id text, p_cycle_id text, p_stock_rcn_kg numeric, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v_finance numeric := 0; v_achete numeric := 0; v_restant numeric := 0;
  v_held integer := 0; v_reserved integer := 0; v_plafond integer := 0; v_max_new integer := 0;
begin
  if p_stock_rcn_kg is null or p_stock_rcn_kg < 0 then
    raise exception 'Stock RCN vérifié obligatoire pour approuver des sacs';
  end if;
  select coalesce(a.volume_finance_kg,0) into v_finance
    from public.avances a
   where a.rt_id = p_rt_id and a.cycle_id = p_cycle_id and a.cycle_statut = 'OPEN'
   order by a.created_at desc limit 1;
  if coalesce(v_finance,0) <= 0 then
    raise exception 'Aucun cycle de financement ouvert avec un volume en kg pour ce RT';
  end if;
  select coalesce(sum(x.poids_net),0) into v_achete
    from public.achats x
   where x.rt_id = p_rt_id and x.cycle_id = p_cycle_id and coalesce(x.rejet,false) = false;
  v_restant := greatest(v_finance - v_achete, 0);

  select coalesce(sum(s.qty),0)::integer into v_held
    from public.rcn_jute_v_stock s
    join public.rcn_jute_locations l on l.code = s.location_code
   where s.state <> 'REFORME'
     and ( (l.scope_type = 'RT' and l.rt_id = p_rt_id)
        or (l.scope_type = 'PRODUCTEUR' and l.producteur_id in
              (select p.id from public.producteurs p where p.rt_id = p_rt_id)) );

  select coalesce(sum(coalesce(r.approved_qty,0) - coalesce(r.released_qty,0)),0)::integer into v_reserved
    from public.ops_bag_requests r
   where r.channel = 'AFLP' and r.rt_id = p_rt_id
     and r.status in ('BM_APPROVED','READY_FOR_RELEASE','PARTIALLY_RELEASED')
     and (r.expires_at is null or r.expires_at > now())
     and (p_exclude is null or r.id <> p_exclude);

  v_plafond := floor(((p_stock_rcn_kg + v_restant) * 1.10) / 80.0);
  v_max_new := greatest(v_plafond - v_held - v_reserved, 0);

  return jsonb_build_object(
    'volume_finance_kg', v_finance, 'volume_achete_cycle_kg', v_achete,
    'volume_finance_restant_kg', v_restant, 'stock_rcn_kg_verified', p_stock_rcn_kg,
    'sacs_detenus', v_held, 'sacs_reserves', v_reserved,
    'plafond_total', v_plafond, 'max_nouveaux_sacs', v_max_new, 'calcule_le', now());
end $$;

-- Aperçu pour l'écran d'approbation (Branch Manager uniquement).
create or replace function public.ops_aflp_plafond_apercu(p_request_id uuid, p_cycle_id text, p_stock_rcn_kg numeric)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_rt text;
begin
  if not private.ops_has_role(array['Branch Manager']) then
    raise exception 'Calcul du plafond réservé au Branch Manager' using errcode = '42501';
  end if;
  select r.rt_id into v_rt from public.ops_bag_requests r where r.id = p_request_id and r.channel = 'AFLP';
  if v_rt is null then raise exception 'Demande AFLP introuvable'; end if;
  return private.ops_aflp_plafond(v_rt, p_cycle_id, p_stock_rcn_kg, p_request_id);
end $$;

create or replace function private.ops_aflp_plafond_guard()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v jsonb;
begin
  if new.channel = 'AFLP' and new.status = 'BM_APPROVED' and old.status is distinct from 'BM_APPROVED' then
    if coalesce(btrim(new.cycle_id),'') = '' then
      raise exception 'Cycle de financement obligatoire pour approuver des sacs AFLP' using errcode = '23514';
    end if;
    v := private.ops_aflp_plafond(new.rt_id, new.cycle_id, new.stock_rcn_kg_verified, new.id);
    if new.approved_qty > (v->>'max_nouveaux_sacs')::integer then
      raise exception 'Plafond dépassé : % sacs au plus pour ce RT (demandé : %)',
        (v->>'max_nouveaux_sacs'), new.approved_qty using errcode = '23514';
    end if;
    new.plafond_snapshot := v;
  end if;
  return new;
end $$;

-- Nommé pour s'exécuter après trg_ops_bag_request_guard (ordre alphabétique).
drop trigger if exists trg_ops_bag_request_plafond on public.ops_bag_requests;
create trigger trg_ops_bag_request_plafond
  before update on public.ops_bag_requests
  for each row execute function private.ops_aflp_plafond_guard();

revoke execute on function private.ops_aflp_plafond(text, text, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.ops_aflp_plafond_apercu(uuid, text, numeric) from public, anon;
grant execute on function public.ops_aflp_plafond_apercu(uuid, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- D. Correctif campagne des RPC terrain
--    campaign = null : le trigger campaign_stamp rattache la campagne courante.
-- ---------------------------------------------------------------------
do $$
declare f text; d text; d2 text;
begin
  foreach f in array array['sacherie_ops_network_move','sacherie_ops_create_transfer','sacherie_ops_receive_transfer'] loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f;
    d2 := replace(d, $q$'ANAGROCI',v_uid,'2027'$q$, $q$'ANAGROCI',v_uid,null$q$);
    if d2 = d then
      raise exception 'Correctif campagne : motif introuvable dans %, migration annulée', f;
    end if;
    execute d2;
  end loop;
end $$;

commit;
