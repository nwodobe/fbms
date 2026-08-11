-- ============================================================================
-- FBMS / AFLP 2027 - SACHERIE V2 MVP
-- Date : 2026-08-11
-- Objet : demande -> approval BM -> remise physique -> mouvement trace
-- IMPORTANT : script a executer manuellement apres revue. Aucun DROP TABLE.
-- ============================================================================

begin;

-- 1) Extensions additives sur les profils / cash / achats
alter table public.profils add column if not exists fonction_operationnelle text;
alter table public.profils add column if not exists cluster text;
alter table public.profils add column if not exists zone text;

alter table public.avances add column if not exists cycle_id text;
alter table public.avances add column if not exists volume_finance_kg numeric;
alter table public.avances add column if not exists prix_reference_kg numeric;
create unique index if not exists avances_cycle_id_uidx on public.avances(cycle_id) where cycle_id is not null;

alter table public.achats add column if not exists cycle_id text;
create index if not exists achats_cycle_idx on public.achats(cycle_id, rt_id);

-- 2) Champs Sacherie V2 sur le registre historique existant
alter table public.sacs_mouvements add column if not exists request_id uuid;
alter table public.sacs_mouvements add column if not exists bag_movement_code text;
alter table public.sacs_mouvements add column if not exists approved_qty integer;
alter table public.sacs_mouvements add column if not exists executed_qty integer;
alter table public.sacs_mouvements add column if not exists bag_state text;
alter table public.sacs_mouvements add column if not exists lot_id text;
alter table public.sacs_mouvements add column if not exists business_status text;
alter table public.sacs_mouvements add column if not exists issued_by uuid;
alter table public.sacs_mouvements add column if not exists issued_at timestamptz;
alter table public.sacs_mouvements add column if not exists received_by uuid;
alter table public.sacs_mouvements add column if not exists received_at timestamptz;
alter table public.sacs_mouvements add column if not exists correction_of uuid;
create unique index if not exists sacs_bag_movement_code_uidx on public.sacs_mouvements(bag_movement_code) where bag_movement_code is not null;
create unique index if not exists sacs_request_once_uidx on public.sacs_mouvements(request_id) where request_id is not null;

-- 3) Table des demandes / approvals
create table if not exists public.bag_movement_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text unique,
  cluster text,
  rt_id text not null,
  rt_nom text,
  cycle_id text not null,
  movement_type text not null default 'DOTATION_RT',
  stock_rcn_kg_verified numeric not null check (stock_rcn_kg_verified >= 0),
  stock_checked_by uuid default auth.uid(),
  stock_checked_at timestamptz default now(),
  stock_source text not null default 'PHYSICAL_COUNT',
  volume_finance_kg numeric not null check (volume_finance_kg >= 0),
  volume_achete_cycle_kg numeric not null default 0 check (volume_achete_cycle_kg >= 0),
  volume_finance_restant_kg numeric not null check (volume_finance_restant_kg >= 0),
  bags_already_held integer not null default 0,
  system_max_bags integer not null default 0,
  max_new_bags integer not null default 0,
  requested_qty integer not null check (requested_qty > 0),
  approved_qty integer,
  status text not null default 'PENDING_BM',
  requested_by uuid default auth.uid(),
  requested_at timestamptz default now(),
  approved_by uuid,
  approved_at timestamptz,
  expires_at timestamptz,
  approval_comment text,
  closed_at timestamptz,
  created_at timestamptz default now(),
  constraint bag_req_status_chk check (status in ('PENDING_BM','APPROVED','HOLD','REJECTED','PARTIALLY_EXECUTED','EXECUTED','CLOSED','FAIL_INCIDENT')),
  constraint bag_req_approved_qty_chk check (approved_qty is null or (approved_qty > 0 and approved_qty <= requested_qty))
);
create index if not exists bag_req_rt_idx on public.bag_movement_requests(rt_id, requested_at desc);
create index if not exists bag_req_status_idx on public.bag_movement_requests(status, requested_at desc);

-- FK ajoutee apres creation pour garder le script idempotent.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='sacs_request_fk'
  ) then
    alter table public.sacs_mouvements
      add constraint sacs_request_fk foreign key(request_id)
      references public.bag_movement_requests(id);
  end if;
end $$;

-- 4) Sequence / codes metier
create sequence if not exists public.bag_request_seq start 1;
create sequence if not exists public.bag_movement_seq start 1;

create or replace function public.sacherie_code_cluster(p_cluster text)
returns text language sql immutable as $$
  select upper(left(regexp_replace(coalesce(p_cluster,'GEN'),'[^A-Za-z0-9]','','g'),3))
$$;

-- 5) Droits metier conservateurs
create or replace function public.peut_demander_sacherie()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.profils
    where user_id=auth.uid() and actif=true
      and (
        role in ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
        or fonction_operationnelle in ('Unit Head','Assistant Unit Head','Logistics Coordinator')
      )
  )
$$;

create or replace function public.peut_executer_sacherie()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.profils
    where user_id=auth.uid() and actif=true
      and (
        role in ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
        or fonction_operationnelle in ('Warehouse Keeper','Assistant Unit Head','Unit Head','Logistics Coordinator')
      )
  )
$$;

-- 6) Association automatique des nouveaux achats au cycle actif du RT
create or replace function public.sacherie_assign_cycle_achat()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_cycle text;
begin
  if new.cycle_id is null and new.rt_id is not null then
    select a.cycle_id into v_cycle
    from public.avances a
    where a.rt_id=new.rt_id and a.cycle_id is not null and coalesce(a.statut,'Active')='Active'
    order by a.created_at desc limit 1;
    new.cycle_id:=v_cycle;
  end if;
  return new;
end $$;
drop trigger if exists trg_sacherie_assign_cycle_achat on public.achats;
create trigger trg_sacherie_assign_cycle_achat before insert on public.achats
for each row execute function public.sacherie_assign_cycle_achat();

-- 7) Calcul serveur du plafond
create or replace function public.sacherie_calculer_plafond(
  p_rt_id text,
  p_cycle_id text,
  p_stock_rcn_kg numeric
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_finance numeric:=0;
  v_achete numeric:=0;
  v_restant numeric:=0;
  v_bags integer:=0;
  v_plafond integer:=0;
  v_max_new integer:=0;
begin
  if not public.est_actif() then raise exception 'Acces refuse'; end if;
  if p_stock_rcn_kg is null or p_stock_rcn_kg < 0 then raise exception 'Stock RCN verifie invalide'; end if;

  select coalesce(a.volume_finance_kg,0) into v_finance
  from public.avances a
  where a.rt_id=p_rt_id and a.cycle_id=p_cycle_id
  order by a.created_at desc limit 1;
  if v_finance is null or v_finance <= 0 then raise exception 'Cycle finance sans volume autorise en kg'; end if;

  select coalesce(sum(x.poids_net),0) into v_achete
  from public.achats x
  where x.rt_id=p_rt_id and x.cycle_id=p_cycle_id and coalesce(x.rejet,false)=false;
  v_restant:=greatest(v_finance-v_achete,0);

  select coalesce(sum(case when m.destination='RT' then m.quantite else 0 end),0)
       - coalesce(sum(case when m.source='RT' then m.quantite else 0 end),0)
    into v_bags
  from public.sacs_mouvements m where m.rt_id=p_rt_id;
  v_bags:=greatest(v_bags,0);

  v_plafond:=floor(((p_stock_rcn_kg+v_restant)*1.10)/80.0);
  v_max_new:=greatest(v_plafond-v_bags,0);

  return jsonb_build_object(
    'volume_finance_kg',v_finance,
    'volume_achete_cycle_kg',v_achete,
    'volume_finance_restant_kg',v_restant,
    'stock_rcn_kg_verified',p_stock_rcn_kg,
    'bags_already_held',v_bags,
    'system_max_bags',v_plafond,
    'max_new_bags',v_max_new
  );
end $$;

-- 8) Configuration explicite du cycle par le BM
create or replace function public.sacherie_configurer_cycle(
  p_avance_id uuid,
  p_cycle_id text,
  p_volume_finance_kg numeric,
  p_prix_reference_kg numeric default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v public.avances%rowtype;
begin
  if not public.est_bm() then raise exception 'Seul le Branch Manager peut configurer un cycle'; end if;
  if p_cycle_id is null or btrim(p_cycle_id)='' or p_volume_finance_kg is null or p_volume_finance_kg<=0 then
    raise exception 'Cycle ID et volume finance kg obligatoires';
  end if;
  update public.avances
  set cycle_id=upper(btrim(p_cycle_id)), volume_finance_kg=p_volume_finance_kg, prix_reference_kg=p_prix_reference_kg
  where id=p_avance_id returning * into v;
  if not found then raise exception 'Avance introuvable'; end if;
  return to_jsonb(v);
end $$;

-- 9) Creation de demande : le serveur recalcule tout
create or replace function public.sacherie_creer_demande(
  p_rt_id text,
  p_cycle_id text,
  p_stock_rcn_kg numeric,
  p_requested_qty integer
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_calc jsonb;
  v_rt_nom text;
  v_cluster text;
  v_req public.bag_movement_requests%rowtype;
  v_code text;
begin
  if not public.peut_demander_sacherie() then raise exception 'Droit insuffisant pour creer une demande'; end if;
  if p_requested_qty is null or p_requested_qty<=0 then raise exception 'Quantite invalide'; end if;
  v_calc:=public.sacherie_calculer_plafond(p_rt_id,p_cycle_id,p_stock_rcn_kg);
  if p_requested_qty > (v_calc->>'max_new_bags')::integer then
    raise exception 'Quantite demandee superieure au plafond autorise';
  end if;

  select coalesce(r.data->>'nom',r.data->>'rt',r.village_nom), coalesce(r.data->>'cluster','')
    into v_rt_nom,v_cluster from public.rt r where r.id::text=p_rt_id limit 1;
  v_code:='REQ-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_cluster)||'-'||lpad(nextval('public.bag_request_seq')::text,6,'0');

  insert into public.bag_movement_requests(
    request_code,cluster,rt_id,rt_nom,cycle_id,stock_rcn_kg_verified,stock_checked_by,stock_checked_at,
    volume_finance_kg,volume_achete_cycle_kg,volume_finance_restant_kg,bags_already_held,system_max_bags,max_new_bags,
    requested_qty,status,requested_by,requested_at
  ) values (
    v_code,v_cluster,p_rt_id,v_rt_nom,p_cycle_id,p_stock_rcn_kg,auth.uid(),now(),
    (v_calc->>'volume_finance_kg')::numeric,(v_calc->>'volume_achete_cycle_kg')::numeric,(v_calc->>'volume_finance_restant_kg')::numeric,
    (v_calc->>'bags_already_held')::integer,(v_calc->>'system_max_bags')::integer,(v_calc->>'max_new_bags')::integer,
    p_requested_qty,'PENDING_BM',auth.uid(),now()
  ) returning * into v_req;
  return to_jsonb(v_req);
end $$;

-- 10) Decision BM : approve / hold / reject
create or replace function public.sacherie_decider_demande(
  p_request_id uuid,
  p_action text,
  p_approved_qty integer default null,
  p_comment text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_req public.bag_movement_requests%rowtype; v_qty integer;
begin
  if not public.est_bm() then raise exception 'Seul le Branch Manager peut approuver'; end if;
  select * into v_req from public.bag_movement_requests where id=p_request_id for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if v_req.status not in ('PENDING_BM','HOLD') then raise exception 'Demande deja traitee'; end if;

  if upper(p_action)='APPROVE' then
    v_qty:=coalesce(p_approved_qty,v_req.requested_qty);
    if v_qty<=0 or v_qty>v_req.requested_qty or v_qty>v_req.max_new_bags then raise exception 'Quantite approuvee invalide ou superieure au plafond'; end if;
    update public.bag_movement_requests set status='APPROVED',approved_qty=v_qty,approved_by=auth.uid(),approved_at=now(),expires_at=now()+interval '24 hours',approval_comment=p_comment where id=p_request_id returning * into v_req;
  elsif upper(p_action)='HOLD' then
    update public.bag_movement_requests set status='HOLD',approval_comment=p_comment where id=p_request_id returning * into v_req;
  elsif upper(p_action)='REJECT' then
    update public.bag_movement_requests set status='REJECTED',approval_comment=p_comment,closed_at=now() where id=p_request_id returning * into v_req;
  else raise exception 'Action inconnue'; end if;
  return to_jsonb(v_req);
end $$;

-- 11) Garde serveur sur la dotation RT
create or replace function public.sacherie_guard_mouvement()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_req public.bag_movement_requests%rowtype; v_cluster_stock integer:=0;
begin
  if new.type='DOTATION_RT' then
    if new.request_id is null then raise exception 'Approval BM requis : request_id absent'; end if;
    select * into v_req from public.bag_movement_requests where id=new.request_id for update;
    if not found or v_req.status<>'APPROVED' then raise exception 'Approval BM requis ou demande non approuvee'; end if;
    if v_req.expires_at is null or v_req.expires_at<now() then raise exception 'Approval expire'; end if;
    if new.quantite>coalesce(v_req.approved_qty,0) then raise exception 'Quantite executee superieure a la quantite approuvee'; end if;
    if exists(select 1 from public.sacs_mouvements where request_id=new.request_id) then raise exception 'Approval deja utilise'; end if;
    if new.bag_state='FULL' and nullif(btrim(new.lot_id),'') is null then raise exception 'Lot ID obligatoire pour un sac plein'; end if;
    select coalesce(sum(case when destination='CLUSTER' then quantite else 0 end),0)-coalesce(sum(case when source='CLUSTER' then quantite else 0 end),0)
      into v_cluster_stock from public.sacs_mouvements where cluster=v_req.cluster;
    if v_cluster_stock<new.quantite then raise exception 'Stock sacs cluster insuffisant'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_sacherie_guard_mouvement on public.sacs_mouvements;
create trigger trg_sacherie_guard_mouvement before insert on public.sacs_mouvements
for each row execute function public.sacherie_guard_mouvement();

-- 12) Execution physique : une demande = une seule execution, reliquat annule
create or replace function public.sacherie_executer_demande(
  p_request_id uuid,
  p_executed_qty integer,
  p_bag_state text default 'EMPTY',
  p_lot_id text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_req public.bag_movement_requests%rowtype; v_mov public.sacs_mouvements%rowtype; v_code text;
begin
  if not public.peut_executer_sacherie() then raise exception 'Droit insuffisant pour executer une remise'; end if;
  if p_executed_qty is null or p_executed_qty<=0 then raise exception 'Quantite executee invalide'; end if;
  select * into v_req from public.bag_movement_requests where id=p_request_id for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if v_req.status<>'APPROVED' then raise exception 'Approval BM requis'; end if;
  if v_req.expires_at<now() then raise exception 'Approval expire'; end if;
  if p_executed_qty>v_req.approved_qty then raise exception 'Quantite executee superieure a la quantite approuvee'; end if;
  if upper(coalesce(p_bag_state,'EMPTY'))='FULL' and nullif(btrim(p_lot_id),'') is null then raise exception 'Lot ID obligatoire pour FULL'; end if;
  v_code:='BAG-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_req.cluster)||'-'||lpad(nextval('public.bag_movement_seq')::text,6,'0');

  insert into public.sacs_mouvements(
    local_id,date,type,source,destination,cluster,rt_id,rt_nom,quantite,observation,created_by,created_by_nom,created_at,
    request_id,bag_movement_code,approved_qty,executed_qty,bag_state,lot_id,business_status,issued_by,issued_at
  ) values (
    gen_random_uuid()::text,current_date,'DOTATION_RT','CLUSTER','RT',v_req.cluster,v_req.rt_id,v_req.rt_nom,p_executed_qty,
    'Execution Sacherie V2 '||v_req.request_code,auth.uid(),null,now(),v_req.id,v_code,v_req.approved_qty,p_executed_qty,upper(coalesce(p_bag_state,'EMPTY')),p_lot_id,
    case when p_executed_qty<v_req.approved_qty then 'PARTIALLY_EXECUTED' else 'EXECUTED' end,auth.uid(),now()
  ) returning * into v_mov;

  update public.bag_movement_requests set status=case when p_executed_qty<approved_qty then 'PARTIALLY_EXECUTED' else 'EXECUTED' end,closed_at=now() where id=v_req.id;
  return to_jsonb(v_mov);
end $$;

-- 13) RLS des demandes : lecture profils actifs, creation/decision par RPC uniquement
alter table public.bag_movement_requests enable row level security;
drop policy if exists bag_req_sel on public.bag_movement_requests;
drop policy if exists bag_req_ins on public.bag_movement_requests;
drop policy if exists bag_req_upd on public.bag_movement_requests;
drop policy if exists bag_req_del on public.bag_movement_requests;
create policy bag_req_sel on public.bag_movement_requests for select to authenticated using (public.est_actif());
-- Pas de policy INSERT/UPDATE/DELETE : les ecritures passent par les RPC SECURITY DEFINER.

-- Renforcer la policy d'insertion du registre existant : DOTATION_RT doit avoir request_id.
alter table public.sacs_mouvements enable row level security;
drop policy if exists sacs_ins on public.sacs_mouvements;
create policy sacs_ins on public.sacs_mouvements for insert to authenticated
with check (public.est_actif() and (type<>'DOTATION_RT' or request_id is not null));

-- 14) Droits RPC
revoke all on function public.sacherie_configurer_cycle(uuid,text,numeric,numeric) from public;
revoke all on function public.sacherie_creer_demande(text,text,numeric,integer) from public;
revoke all on function public.sacherie_decider_demande(uuid,text,integer,text) from public;
revoke all on function public.sacherie_executer_demande(uuid,integer,text,text) from public;
grant execute on function public.sacherie_calculer_plafond(text,text,numeric) to authenticated;
grant execute on function public.sacherie_configurer_cycle(uuid,text,numeric,numeric) to authenticated;
grant execute on function public.sacherie_creer_demande(text,text,numeric,integer) to authenticated;
grant execute on function public.sacherie_decider_demande(uuid,text,integer,text) to authenticated;
grant execute on function public.sacherie_executer_demande(uuid,integer,text,text) to authenticated;

commit;

-- NOTE MVP : le solde de sacs RT repose encore sur le registre V1, y compris ses mouvements producteurs.
-- La ventilation fine EMPTY/FULL/REBUT et la confirmation RT sont P1.
