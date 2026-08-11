-- ============================================================================
-- FBMS / AFLP 2027 - SACHERIE V2 MVP
-- Date : 2026-08-11
-- Objet : demande -> approval BM -> remise physique -> mouvement tracé
--
-- PRINCIPES DE SÉCURITÉ
--   1. Aucune DOTATION_RT directe depuis le navigateur.
--   2. Le serveur recalcule le plafond 80 kg / +10 %.
--   3. Un approval BM réserve une quantité et ne peut être utilisé qu'une fois.
--   4. Le RT reste responsable des sacs sous-affectés aux producteurs.
--   5. Les contrôles critiques sont côté PostgreSQL/RLS/RPC, pas seulement JS.
--
-- IMPORTANT : script à exécuter MANUELLEMENT après revue, d'abord en test.
-- Aucun DROP TABLE et aucune suppression de données.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Extensions additives : profils, cash, achats, registre sacs
-- ---------------------------------------------------------------------------

alter table public.profils add column if not exists fonction_operationnelle text;
alter table public.profils add column if not exists cluster text;
alter table public.profils add column if not exists zone text;

alter table public.avances add column if not exists cycle_id text;
alter table public.avances add column if not exists volume_finance_kg numeric;
alter table public.avances add column if not exists prix_reference_kg numeric;
alter table public.avances add column if not exists cycle_statut text;

alter table public.achats add column if not exists cycle_id text;
create index if not exists achats_cycle_idx on public.achats(cycle_id, rt_id);

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

create unique index if not exists avances_cycle_id_uidx
  on public.avances(cycle_id) where cycle_id is not null;

-- Un seul cycle de financement OPEN par RT.
create unique index if not exists avances_un_cycle_open_par_rt_uidx
  on public.avances(rt_id)
  where cycle_id is not null and cycle_statut = 'OPEN';

create unique index if not exists sacs_bag_movement_code_uidx
  on public.sacs_mouvements(bag_movement_code)
  where bag_movement_code is not null;

create unique index if not exists sacs_request_once_uidx
  on public.sacs_mouvements(request_id)
  where request_id is not null;

-- Contraintes V2 : NOT VALID tolère l'historique V1 mais protège les nouvelles lignes.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='sacs_bag_state_chk') then
    alter table public.sacs_mouvements add constraint sacs_bag_state_chk
      check (bag_state is null or bag_state in ('EMPTY','FULL','IN_TRANSIT','RETURNED','REPAIR','REBUT')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='sacs_full_lot_chk') then
    alter table public.sacs_mouvements add constraint sacs_full_lot_chk
      check (bag_state is null or bag_state <> 'FULL' or nullif(btrim(lot_id),'') is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='sacs_business_status_chk') then
    alter table public.sacs_mouvements add constraint sacs_business_status_chk
      check (business_status is null or business_status in
        ('APPROVED','PARTIALLY_EXECUTED','EXECUTED','HOLD','FAIL_INCIDENT','CLOSED')) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Demandes et approvals
-- ---------------------------------------------------------------------------

create table if not exists public.bag_movement_requests (
  id uuid primary key default gen_random_uuid(),
  client_request_id text not null,
  request_code text not null unique,
  cluster text not null,
  zone text,
  rt_id text not null,
  rt_nom text,
  cycle_id text not null,
  movement_type text not null default 'DOTATION_RT',

  stock_rcn_kg_verified numeric not null check (stock_rcn_kg_verified >= 0),
  stock_checked_by uuid not null default auth.uid(),
  stock_checked_at timestamptz not null default now(),
  stock_source text not null default 'PHYSICAL_COUNT',

  volume_finance_kg numeric not null check (volume_finance_kg >= 0),
  volume_achete_cycle_kg numeric not null default 0 check (volume_achete_cycle_kg >= 0),
  volume_finance_restant_kg numeric not null check (volume_finance_restant_kg >= 0),
  bags_already_held integer not null default 0,
  reserved_approved_bags integer not null default 0,
  system_max_bags integer not null default 0,
  max_new_bags integer not null default 0,
  max_new_available integer not null default 0,
  cluster_stock_at_request integer not null default 0,

  requested_qty integer not null check (requested_qty > 0),
  approved_qty integer,
  status text not null default 'PENDING_BM',

  requested_by uuid not null default auth.uid(),
  requested_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  expires_at timestamptz,
  approval_comment text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint bag_req_client_uid unique(client_request_id),
  constraint bag_req_status_chk check (status in
    ('PENDING_BM','APPROVED','HOLD','REJECTED','PARTIALLY_EXECUTED','EXECUTED','CLOSED','FAIL_INCIDENT')),
  constraint bag_req_approved_qty_chk check
    (approved_qty is null or (approved_qty > 0 and approved_qty <= requested_qty))
);

-- Si la table a été créée par une première tentative de migration, compléter sans perte.
alter table public.bag_movement_requests add column if not exists client_request_id text;
alter table public.bag_movement_requests add column if not exists zone text;
alter table public.bag_movement_requests add column if not exists reserved_approved_bags integer not null default 0;
alter table public.bag_movement_requests add column if not exists max_new_available integer not null default 0;
alter table public.bag_movement_requests add column if not exists cluster_stock_at_request integer not null default 0;

create unique index if not exists bag_req_client_request_uidx
  on public.bag_movement_requests(client_request_id)
  where client_request_id is not null;
create index if not exists bag_req_rt_idx
  on public.bag_movement_requests(rt_id, requested_at desc);
create index if not exists bag_req_status_idx
  on public.bag_movement_requests(status, requested_at desc);
create index if not exists bag_req_cluster_idx
  on public.bag_movement_requests(cluster, status, requested_at desc);

-- FK additive.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='sacs_request_fk') then
    alter table public.sacs_mouvements
      add constraint sacs_request_fk foreign key(request_id)
      references public.bag_movement_requests(id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Séquences et identifiants métier
-- ---------------------------------------------------------------------------

create sequence if not exists public.bag_request_seq start 1;
create sequence if not exists public.bag_movement_seq start 1;

create or replace function public.sacherie_code_cluster(p_cluster text)
returns text language sql immutable as $$
  select coalesce(nullif(upper(left(regexp_replace(coalesce(p_cluster,''),'[^A-Za-z0-9]','','g'),3)),''),'GEN')
$$;

-- ---------------------------------------------------------------------------
-- 4) Contexte, périmètre et responsabilités
-- ---------------------------------------------------------------------------

create or replace function public.sacherie_mon_contexte()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(
    (select jsonb_build_object(
      'role',p.role,
      'fonction_operationnelle',p.fonction_operationnelle,
      'cluster',p.cluster,
      'zone',p.zone,
      'actif',p.actif
    ) from public.profils p where p.user_id=auth.uid() and p.actif=true limit 1),
    '{}'::jsonb
  )
$$;

create or replace function public.peut_demander_sacherie()
returns boolean language sql stable security definer set search_path=public as $$
  select public.est_bm() or exists(
    select 1 from public.profils p
    where p.user_id=auth.uid() and p.actif=true
      and p.fonction_operationnelle in ('Unit Head','Assistant Unit Head')
  )
$$;

create or replace function public.peut_executer_sacherie(p_cluster text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.est_bm() or exists(
    select 1 from public.profils p
    where p.user_id=auth.uid() and p.actif=true
      and p.fonction_operationnelle in ('Warehouse Keeper','Assistant Unit Head')
      and upper(coalesce(p.cluster,'')) = upper(coalesce(p_cluster,''))
  )
$$;

create or replace function public.sacherie_peut_lire_demande(
  p_cluster text, p_zone text, p_requested_by uuid
) returns boolean
language sql stable security definer set search_path=public as $$
  select public.est_bm()
    or p_requested_by = auth.uid()
    or exists(
      select 1 from public.profils p
      where p.user_id=auth.uid() and p.actif=true and (
        p.fonction_operationnelle='Logistics Coordinator'
        or (p.fonction_operationnelle in ('Unit Head','Assistant Unit Head','Warehouse Keeper')
            and upper(coalesce(p.cluster,''))=upper(coalesce(p_cluster,'')))
        or (p.fonction_operationnelle='Zonal Head'
            and upper(coalesce(p.zone,''))=upper(coalesce(p_zone,'')))
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- 5) Fonctions de stock et exposition
-- ---------------------------------------------------------------------------

-- Le RT reste responsable des sacs qu'il sous-affecte à un producteur.
-- Les transferts internes RT <-> PRODUCTEUR sont donc neutres pour son exposition.
create or replace function public.sacherie_sacs_sous_responsabilite_rt(p_rt_id text)
returns integer language sql stable security definer set search_path=public as $$
  select greatest(coalesce(sum(
    case
      when coalesce(m.destination,'') in ('RT','PRODUCTEUR')
       and coalesce(m.source,'') not in ('RT','PRODUCTEUR') then m.quantite
      when coalesce(m.source,'') in ('RT','PRODUCTEUR')
       and coalesce(m.destination,'') not in ('RT','PRODUCTEUR') then -m.quantite
      else 0
    end
  ),0),0)::integer
  from public.sacs_mouvements m
  where m.rt_id=p_rt_id
$$;

create or replace function public.sacherie_stock_cluster(p_cluster text)
returns integer language sql stable security definer set search_path=public as $$
  select greatest(
    coalesce(sum(case when m.destination='CLUSTER' then m.quantite else 0 end),0)
    - coalesce(sum(case when m.source='CLUSTER' then m.quantite else 0 end),0),
    0
  )::integer
  from public.sacs_mouvements m
  where upper(coalesce(m.cluster,''))=upper(coalesce(p_cluster,''))
$$;

create or replace function public.sacherie_reservations_rt(
  p_rt_id text, p_exclude_request uuid default null
) returns integer language sql stable security definer set search_path=public as $$
  select coalesce(sum(r.approved_qty),0)::integer
  from public.bag_movement_requests r
  where r.rt_id=p_rt_id
    and r.status='APPROVED'
    and r.expires_at > now()
    and (p_exclude_request is null or r.id<>p_exclude_request)
$$;

-- ---------------------------------------------------------------------------
-- 6) Cycle financier et rattachement des achats
-- ---------------------------------------------------------------------------

create or replace function public.sacherie_assign_cycle_achat()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_cycle text;
  v_count integer;
begin
  if new.cycle_id is null and new.rt_id is not null then
    select count(*), min(a.cycle_id)
      into v_count,v_cycle
    from public.avances a
    where a.rt_id=new.rt_id
      and a.cycle_id is not null
      and a.cycle_statut='OPEN';

    if v_count=1 then
      new.cycle_id:=v_cycle;
    elsif v_count>1 then
      raise exception 'Plusieurs cycles Sacherie OPEN pour ce RT : correction BM requise';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sacherie_assign_cycle_achat on public.achats;
create trigger trg_sacherie_assign_cycle_achat
before insert on public.achats
for each row execute function public.sacherie_assign_cycle_achat();

create or replace function public.sacherie_configurer_cycle(
  p_avance_id uuid,
  p_cycle_id text,
  p_volume_finance_kg numeric,
  p_prix_reference_kg numeric default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v public.avances%rowtype;
  v_other integer;
begin
  if not public.est_bm() then
    raise exception 'Seul le Branch Manager peut configurer un cycle Sacherie';
  end if;
  if p_cycle_id is null or btrim(p_cycle_id)='' or p_volume_finance_kg is null or p_volume_finance_kg<=0 then
    raise exception 'Cycle ID et volume financé kg obligatoires';
  end if;

  select * into v from public.avances where id=p_avance_id for update;
  if not found then raise exception 'Avance introuvable'; end if;

  select count(*) into v_other
  from public.avances a
  where a.rt_id=v.rt_id and a.id<>v.id and a.cycle_id is not null and a.cycle_statut='OPEN';
  if v_other>0 then
    raise exception 'Un autre cycle Sacherie est déjà OPEN pour ce RT';
  end if;

  update public.avances
  set cycle_id=upper(btrim(p_cycle_id)),
      volume_finance_kg=p_volume_finance_kg,
      prix_reference_kg=p_prix_reference_kg,
      cycle_statut='OPEN'
  where id=p_avance_id returning * into v;

  return to_jsonb(v);
end $$;

create or replace function public.sacherie_cloturer_cycle(p_cycle_id text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v public.avances%rowtype;
begin
  if not public.est_bm() then raise exception 'Seul le Branch Manager peut clôturer un cycle'; end if;
  update public.avances
  set cycle_statut='CLOSED'
  where cycle_id=upper(btrim(p_cycle_id)) and cycle_statut='OPEN'
  returning * into v;
  if not found then raise exception 'Cycle OPEN introuvable'; end if;
  return to_jsonb(v);
end $$;

-- ---------------------------------------------------------------------------
-- 7) Calcul serveur du plafond
-- ---------------------------------------------------------------------------

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
  v_reserved integer:=0;
  v_plafond integer:=0;
  v_max_new integer:=0;
  v_available integer:=0;
  v_cluster text;
  v_cluster_stock integer:=0;
begin
  if not public.peut_demander_sacherie() then raise exception 'Droit insuffisant pour calculer le plafond Sacherie'; end if;
  if p_stock_rcn_kg is null or p_stock_rcn_kg<0 then raise exception 'Stock RCN vérifié invalide'; end if;

  select coalesce(a.volume_finance_kg,0)
    into v_finance
  from public.avances a
  where a.rt_id=p_rt_id and a.cycle_id=p_cycle_id and a.cycle_statut='OPEN'
  order by a.created_at desc limit 1;
  if coalesce(v_finance,0)<=0 then raise exception 'Cycle finance OPEN sans volume autorisé en kg'; end if;

  select coalesce(sum(x.poids_net),0)
    into v_achete
  from public.achats x
  where x.rt_id=p_rt_id and x.cycle_id=p_cycle_id and coalesce(x.rejet,false)=false;

  v_restant:=greatest(v_finance-v_achete,0);
  v_bags:=public.sacherie_sacs_sous_responsabilite_rt(p_rt_id);
  v_reserved:=public.sacherie_reservations_rt(p_rt_id,null);
  v_plafond:=floor(((p_stock_rcn_kg+v_restant)*1.10)/80.0);
  v_max_new:=greatest(v_plafond-v_bags,0);
  v_available:=greatest(v_max_new-v_reserved,0);

  select coalesce(r.data->>'cluster','') into v_cluster
  from public.rt r where r.id::text=p_rt_id limit 1;
  v_cluster_stock:=public.sacherie_stock_cluster(v_cluster);

  return jsonb_build_object(
    'volume_finance_kg',v_finance,
    'volume_achete_cycle_kg',v_achete,
    'volume_finance_restant_kg',v_restant,
    'stock_rcn_kg_verified',p_stock_rcn_kg,
    'bags_already_held',v_bags,
    'reserved_approved_bags',v_reserved,
    'system_max_bags',v_plafond,
    'max_new_bags',v_max_new,
    'max_new_available',v_available,
    'cluster_stock',v_cluster_stock
  );
end $$;

-- ---------------------------------------------------------------------------
-- 8) Création idempotente d'une demande
-- ---------------------------------------------------------------------------

create or replace function public.sacherie_creer_demande(
  p_client_request_id text,
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
  v_zone text;
  v_prof_cluster text;
  v_prof_fonction text;
  v_req public.bag_movement_requests%rowtype;
  v_code text;
begin
  if not public.peut_demander_sacherie() then raise exception 'Droit insuffisant pour créer une demande'; end if;
  if p_client_request_id is null or btrim(p_client_request_id)='' then raise exception 'Identifiant client de demande obligatoire'; end if;
  if p_requested_qty is null or p_requested_qty<=0 then raise exception 'Quantité invalide'; end if;

  select * into v_req
  from public.bag_movement_requests
  where client_request_id=p_client_request_id and requested_by=auth.uid()
  limit 1;
  if found then return to_jsonb(v_req); end if;

  select coalesce(r.data->>'nom',r.data->>'rt',r.village_nom),
         coalesce(r.data->>'cluster',''),
         coalesce(r.data->>'zone','')
    into v_rt_nom,v_cluster,v_zone
  from public.rt r
  where r.id::text=p_rt_id
  limit 1;
  if not found then raise exception 'RT introuvable dans le référentiel'; end if;
  if btrim(coalesce(v_cluster,''))='' then raise exception 'RT sans cluster : régulariser le référentiel'; end if;

  if not public.est_bm() then
    select p.cluster,p.fonction_operationnelle
      into v_prof_cluster,v_prof_fonction
    from public.profils p
    where p.user_id=auth.uid() and p.actif=true limit 1;
    if v_prof_fonction not in ('Unit Head','Assistant Unit Head') then
      raise exception 'Seul le Unit Head ou Assistant Unit Head peut demander pour un RT';
    end if;
    if upper(coalesce(v_prof_cluster,''))<>upper(v_cluster) then
      raise exception 'RT hors du cluster attribué à l utilisateur';
    end if;
  end if;

  v_calc:=public.sacherie_calculer_plafond(p_rt_id,p_cycle_id,p_stock_rcn_kg);
  if p_requested_qty>(v_calc->>'max_new_available')::integer then
    raise exception 'Quantité demandée supérieure au plafond disponible';
  end if;

  v_code:='REQ-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_cluster)||'-'||lpad(nextval('public.bag_request_seq')::text,6,'0');

  insert into public.bag_movement_requests(
    client_request_id,request_code,cluster,zone,rt_id,rt_nom,cycle_id,
    stock_rcn_kg_verified,stock_checked_by,stock_checked_at,stock_source,
    volume_finance_kg,volume_achete_cycle_kg,volume_finance_restant_kg,
    bags_already_held,reserved_approved_bags,system_max_bags,max_new_bags,max_new_available,
    cluster_stock_at_request,requested_qty,status,requested_by,requested_at
  ) values (
    p_client_request_id,v_code,v_cluster,v_zone,p_rt_id,v_rt_nom,p_cycle_id,
    p_stock_rcn_kg,auth.uid(),now(),'PHYSICAL_COUNT',
    (v_calc->>'volume_finance_kg')::numeric,
    (v_calc->>'volume_achete_cycle_kg')::numeric,
    (v_calc->>'volume_finance_restant_kg')::numeric,
    (v_calc->>'bags_already_held')::integer,
    (v_calc->>'reserved_approved_bags')::integer,
    (v_calc->>'system_max_bags')::integer,
    (v_calc->>'max_new_bags')::integer,
    (v_calc->>'max_new_available')::integer,
    (v_calc->>'cluster_stock')::integer,
    p_requested_qty,'PENDING_BM',auth.uid(),now()
  ) returning * into v_req;

  return to_jsonb(v_req);
exception
  when unique_violation then
    select * into v_req
    from public.bag_movement_requests
    where client_request_id=p_client_request_id and requested_by=auth.uid()
    limit 1;
    if found then return to_jsonb(v_req); end if;
    raise;
end $$;

-- ---------------------------------------------------------------------------
-- 9) Décision BM : recalcul et réservation atomique
-- ---------------------------------------------------------------------------

create or replace function public.sacherie_decider_demande(
  p_request_id uuid,
  p_action text,
  p_approved_qty integer default null,
  p_comment text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_req public.bag_movement_requests%rowtype;
  v_calc jsonb;
  v_qty integer;
  v_other_reserved integer;
  v_available integer;
begin
  if not public.est_bm() then raise exception 'Seul le Branch Manager peut approuver'; end if;

  select * into v_req from public.bag_movement_requests where id=p_request_id for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if v_req.status not in ('PENDING_BM','HOLD') then raise exception 'Demande déjà traitée'; end if;

  -- Verrou logique par RT pour éviter deux approvals concurrents dépassant ensemble le plafond.
  perform pg_advisory_xact_lock(42027,hashtext(v_req.rt_id));

  if upper(p_action)='APPROVE' then
    v_calc:=public.sacherie_calculer_plafond(v_req.rt_id,v_req.cycle_id,v_req.stock_rcn_kg_verified);
    v_other_reserved:=public.sacherie_reservations_rt(v_req.rt_id,v_req.id);
    v_available:=greatest((v_calc->>'max_new_bags')::integer-v_other_reserved,0);
    v_qty:=coalesce(p_approved_qty,v_req.requested_qty);

    if v_qty<=0 or v_qty>v_req.requested_qty or v_qty>v_available then
      raise exception 'Quantité approuvée invalide ou supérieure au plafond disponible';
    end if;

    update public.bag_movement_requests
    set status='APPROVED',approved_qty=v_qty,approved_by=auth.uid(),approved_at=now(),
        expires_at=now()+interval '24 hours',approval_comment=p_comment,
        volume_finance_kg=(v_calc->>'volume_finance_kg')::numeric,
        volume_achete_cycle_kg=(v_calc->>'volume_achete_cycle_kg')::numeric,
        volume_finance_restant_kg=(v_calc->>'volume_finance_restant_kg')::numeric,
        bags_already_held=(v_calc->>'bags_already_held')::integer,
        reserved_approved_bags=v_other_reserved,
        system_max_bags=(v_calc->>'system_max_bags')::integer,
        max_new_bags=(v_calc->>'max_new_bags')::integer,
        max_new_available=v_available
    where id=p_request_id returning * into v_req;

  elsif upper(p_action)='HOLD' then
    if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Motif HOLD obligatoire'; end if;
    update public.bag_movement_requests
    set status='HOLD',approval_comment=p_comment
    where id=p_request_id returning * into v_req;

  elsif upper(p_action)='REJECT' then
    if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Motif de rejet obligatoire'; end if;
    update public.bag_movement_requests
    set status='REJECTED',approval_comment=p_comment,closed_at=now()
    where id=p_request_id returning * into v_req;
  else
    raise exception 'Action inconnue';
  end if;

  return to_jsonb(v_req);
end $$;

-- ---------------------------------------------------------------------------
-- 10) Garde serveur du registre : exactitude du mouvement approuvé
-- ---------------------------------------------------------------------------

create or replace function public.sacherie_guard_mouvement()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_req public.bag_movement_requests%rowtype;
begin
  if new.type='DOTATION_RT' then
    if new.request_id is null then raise exception 'Approval BM requis : request_id absent'; end if;
    select * into v_req from public.bag_movement_requests where id=new.request_id for update;
    if not found or v_req.status<>'APPROVED' then raise exception 'Approval BM requis ou demande non approuvée'; end if;
    if v_req.expires_at is null or v_req.expires_at<now() then raise exception 'Approval expiré'; end if;
    if exists(select 1 from public.sacs_mouvements where request_id=new.request_id) then raise exception 'Approval déjà utilisé'; end if;

    if new.source<>'CLUSTER' or new.destination<>'RT' then raise exception 'Flux DOTATION_RT invalide'; end if;
    if coalesce(new.rt_id,'')<>v_req.rt_id then raise exception 'RT du mouvement différent du RT approuvé'; end if;
    if upper(coalesce(new.cluster,''))<>upper(v_req.cluster) then raise exception 'Cluster du mouvement différent du cluster approuvé'; end if;
    if new.quantite>coalesce(v_req.approved_qty,0) then raise exception 'Quantité exécutée supérieure à la quantité approuvée'; end if;
    if coalesce(new.executed_qty,new.quantite)<>new.quantite then raise exception 'executed_qty incohérent avec quantite'; end if;
    if coalesce(new.approved_qty,0)<>coalesce(v_req.approved_qty,0) then raise exception 'approved_qty incohérent avec approval'; end if;
    if new.bag_state is distinct from 'EMPTY' then raise exception 'Une dotation RT remet des sacs EMPTY'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sacherie_guard_mouvement on public.sacs_mouvements;
create trigger trg_sacherie_guard_mouvement
before insert on public.sacs_mouvements
for each row execute function public.sacherie_guard_mouvement();

-- ---------------------------------------------------------------------------
-- 11) Exécution physique : une demande = une exécution, reliquat annulé
-- ---------------------------------------------------------------------------

create or replace function public.sacherie_executer_demande(
  p_request_id uuid,
  p_executed_qty integer,
  p_bag_state text default 'EMPTY',
  p_lot_id text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_req public.bag_movement_requests%rowtype;
  v_mov public.sacs_mouvements%rowtype;
  v_code text;
  v_cluster_stock integer;
begin
  if p_executed_qty is null or p_executed_qty<=0 then raise exception 'Quantité exécutée invalide'; end if;

  select * into v_req from public.bag_movement_requests where id=p_request_id for update;
  if not found then raise exception 'Demande introuvable'; end if;

  if not public.peut_executer_sacherie(v_req.cluster) then
    raise exception 'Seul le Warehouse Keeper ou Assistant Unit Head du cluster peut remettre les sacs';
  end if;
  if v_req.status<>'APPROVED' then raise exception 'Approval BM requis'; end if;
  if v_req.expires_at is null or v_req.expires_at<now() then raise exception 'Approval expiré'; end if;
  if p_executed_qty>v_req.approved_qty then raise exception 'Quantité exécutée supérieure à la quantité approuvée'; end if;
  if upper(coalesce(p_bag_state,'EMPTY'))<>'EMPTY' then raise exception 'La dotation RT doit être EMPTY'; end if;
  if exists(select 1 from public.sacs_mouvements where request_id=p_request_id) then raise exception 'Approval déjà utilisé'; end if;

  -- Verrous logiques contre les exécutions concurrentes du même RT / même cluster.
  perform pg_advisory_xact_lock(42027,hashtext(v_req.rt_id));
  perform pg_advisory_xact_lock(42028,hashtext(upper(v_req.cluster)));

  v_cluster_stock:=public.sacherie_stock_cluster(v_req.cluster);
  if v_cluster_stock<p_executed_qty then raise exception 'Stock sacs cluster insuffisant'; end if;

  v_code:='BAG-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_req.cluster)||'-'||lpad(nextval('public.bag_movement_seq')::text,6,'0');

  insert into public.sacs_mouvements(
    local_id,date,type,source,destination,cluster,rt_id,rt_nom,quantite,observation,
    created_by,created_by_nom,created_at,
    request_id,bag_movement_code,approved_qty,executed_qty,bag_state,lot_id,business_status,
    issued_by,issued_at
  ) values (
    gen_random_uuid()::text,current_date,'DOTATION_RT','CLUSTER','RT',v_req.cluster,v_req.rt_id,v_req.rt_nom,
    p_executed_qty,'Execution Sacherie V2 '||v_req.request_code,
    auth.uid(),null,now(),
    v_req.id,v_code,v_req.approved_qty,p_executed_qty,'EMPTY',null,
    case when p_executed_qty<v_req.approved_qty then 'PARTIALLY_EXECUTED' else 'EXECUTED' end,
    auth.uid(),now()
  ) returning * into v_mov;

  update public.bag_movement_requests
  set status=case when p_executed_qty<approved_qty then 'PARTIALLY_EXECUTED' else 'EXECUTED' end,
      closed_at=now()
  where id=v_req.id;

  return to_jsonb(v_mov);
end $$;

-- ---------------------------------------------------------------------------
-- 12) RLS : demandes limitées au périmètre ; DOTATION_RT uniquement via RPC
-- ---------------------------------------------------------------------------

alter table public.bag_movement_requests enable row level security;
drop policy if exists bag_req_sel on public.bag_movement_requests;
drop policy if exists bag_req_ins on public.bag_movement_requests;
drop policy if exists bag_req_upd on public.bag_movement_requests;
drop policy if exists bag_req_del on public.bag_movement_requests;
create policy bag_req_sel on public.bag_movement_requests
  for select to authenticated
  using (public.sacherie_peut_lire_demande(cluster,zone,requested_by));
-- Aucune policy INSERT/UPDATE/DELETE : toutes les écritures passent par RPC SECURITY DEFINER.

alter table public.sacs_mouvements enable row level security;
drop policy if exists sacs_ins on public.sacs_mouvements;
create policy sacs_ins on public.sacs_mouvements
  for insert to authenticated
  with check (
    public.est_actif()
    and created_by=auth.uid()
    and type<>'DOTATION_RT'
  );
-- La fonction SECURITY DEFINER sacherie_executer_demande est le seul chemin normal de DOTATION_RT V2.

-- ---------------------------------------------------------------------------
-- 13) Droits RPC
-- ---------------------------------------------------------------------------

revoke all on function public.sacherie_mon_contexte() from public;
revoke all on function public.sacherie_configurer_cycle(uuid,text,numeric,numeric) from public;
revoke all on function public.sacherie_cloturer_cycle(text) from public;
revoke all on function public.sacherie_creer_demande(text,text,text,numeric,integer) from public;
revoke all on function public.sacherie_decider_demande(uuid,text,integer,text) from public;
revoke all on function public.sacherie_executer_demande(uuid,integer,text,text) from public;

-- Retirer proprement l'ancienne signature si une première version a déjà été appliquée.
do $$
begin
  if to_regprocedure('public.sacherie_creer_demande(text,text,numeric,integer)') is not null then
    execute 'revoke all on function public.sacherie_creer_demande(text,text,numeric,integer) from public';
  end if;
end $$;

grant execute on function public.sacherie_mon_contexte() to authenticated;
grant execute on function public.sacherie_calculer_plafond(text,text,numeric) to authenticated;
grant execute on function public.sacherie_configurer_cycle(uuid,text,numeric,numeric) to authenticated;
grant execute on function public.sacherie_cloturer_cycle(text) to authenticated;
grant execute on function public.sacherie_creer_demande(text,text,text,numeric,integer) to authenticated;
grant execute on function public.sacherie_decider_demande(uuid,text,integer,text) to authenticated;
grant execute on function public.sacherie_executer_demande(uuid,integer,text,text) to authenticated;

commit;

-- LIMITES MVP ASSUMÉES
-- - La confirmation RT authentifiée, REBUT complet et réconciliation sacs sont P1.
-- - L'exécution physique hors ligne n'est PAS autorisée dans ce lot : une demande locale n'est jamais un approval.
-- - Supabase Storage pour les preuves est obligatoire avant un pilote réel utilisant des photos.
-- - La durée d'approval est fixée à 24 h dans ce MVP ; elle doit être revalidée avant V1.0 définitive.
