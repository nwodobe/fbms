-- =====================================================================
-- FBMS · Correctifs audit Procurement & Warehouse du 24/09/2026
-- Lot 3 (rôles, profils pilote, RLS sacherie : P0-04, P1-01)
-- Lot 4 (sacherie : mouvements automatiques, RECU_LIVRAISON, production,
--        états, soldes : P1-02 à P1-05)
-- Migration NON destructive (contraintes élargies, ajouts de colonnes,
-- lignes de référence ajoutées, fonctions remplacées à signature égale).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Rôles : Finance Manager reconnu (P0-04)
-- ---------------------------------------------------------------------
alter table public.profils drop constraint if exists profils_role_check;
alter table public.profils add constraint profils_role_check check (role = any (array[
  'Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor','Agent Recenseur',
  'Consultation uniquement','General Manager','Field Buying Operations Officer','Zonal Head','Unit Head','RT',
  'LBA Purchase Officer','Warehouse Manager','Storekeeper','QA / Lab','Factory User','Finance','Viewer / Auditor',
  'Finance Manager']));

-- Finance Manager = contrôle financier indépendant du Branch Manager :
-- comme General Manager, il ne s'attribue pas depuis l'écran (procédure administrateur).
do $$
declare d text;
begin
  select pg_get_functiondef('private.profils_garde_habilitations()'::regprocedure) into d;
  if position('''Finance Manager''' in d) = 0 then
    if position('new.role in (''Branch Manager'',''General Manager'')' in d) = 0 then raise exception 'Ancre garde habilitations introuvable'; end if;
    d := replace(d, 'new.role in (''Branch Manager'',''General Manager'')', 'new.role in (''Branch Manager'',''General Manager'',''Finance Manager'')');
    execute d;
  end if;
  select pg_get_functiondef('public.fbms_roles_attribuables()'::regprocedure) into d;
  if position('''Finance Manager''' in d) = 0 then
    if position('non attribuable par lui.'', 2),' in d) = 0 then raise exception 'Ancre fbms_roles_attribuables introuvable'; end if;
    d := replace(d, 'non attribuable par lui.'', 2),',
      'non attribuable par lui.'', 2),' || chr(10) ||
      '    (''Finance Manager'', ''Finance Manager (rapprochement des paiements)'', ''GLOBAL'', false, false, ''Contrôle financier indépendant du Branch Manager : procédure administrateur.'', 2),');
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- B. Affectation des profils pilote (rôle + Warehouse) par le BM
--    Ne crée AUCUN compte : le compte doit exister (créé par l'administrateur).
-- ---------------------------------------------------------------------
create or replace function public.wms_assign_warehouse_profile(p_user_id uuid, p_role text, p_warehouse_code text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; p public.profils; v_scoped jsonb; v_code text := nullif(upper(btrim(coalesce(p_warehouse_code,''))),''); v_before jsonb;
begin
  c := public.wms_require('profile_assign');
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motif obligatoire'; end if;
  if p_role in ('Branch Manager','General Manager','Finance Manager') then
    raise exception 'Le rôle « % » ne s''attribue pas depuis l''écran : procédure administrateur', p_role using errcode = '42501';
  end if;
  select * into p from public.profils where user_id = p_user_id for update;
  if p.user_id is null then raise exception 'Compte introuvable : il doit d''abord être créé par l''administrateur'; end if;
  if p.user_id = (c->>'uid')::uuid then raise exception 'Vous ne pouvez pas modifier vos propres habilitations' using errcode = '42501'; end if;
  v_scoped := coalesce(public.wms_param('transferRoleMatrix')->'warehouse_scoped_roles', '[]'::jsonb);
  if v_scoped ? p_role and v_code is null then raise exception 'Warehouse de rattachement obligatoire pour le rôle %', p_role; end if;
  if v_code is not null and not exists (select 1 from public.wms_warehouses where code = v_code) then raise exception 'Warehouse % inconnu', v_code; end if;
  v_before := jsonb_build_object('role', p.role, 'warehouse_code', p.warehouse_code, 'actif', p.actif);
  update public.profils set role = p_role, warehouse_code = v_code where user_id = p_user_id returning * into p;
  perform public.wms_audit('PROFIL:'||p_user_id::text, 'profile.assign', v_before,
    jsonb_build_object('role', p.role, 'warehouse_code', p.warehouse_code), p_reason, c->>'nom');
  return jsonb_build_object('user_id', p.user_id, 'role', p.role, 'warehouse_code', p.warehouse_code, 'actif', p.actif);
end $function$;
revoke all on function public.wms_assign_warehouse_profile(uuid,text,text,text) from public, anon;
grant execute on function public.wms_assign_warehouse_profile(uuid,text,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- C. Périmètre sacherie des rôles rattachés à un Warehouse (P1-01)
-- ---------------------------------------------------------------------
create or replace function private.jute_scope_location()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when not coalesce((public.wms_param('transferRoleMatrix')->'warehouse_scoped_roles') ? p.role, false) then null
    when nullif(btrim(p.warehouse_code),'') is null then '∅'
    else 'BAG-WH-'||btrim(p.warehouse_code) end
  from public.profils p
  where p.user_id = (select auth.uid()) and coalesce(p.actif,false)
$$;
revoke all on function private.jute_scope_location() from public, anon;
grant execute on function private.jute_scope_location() to authenticated;

drop policy if exists rcn_jute_movements_wh_scope_read on public.rcn_jute_movements;
create policy rcn_jute_movements_wh_scope_read on public.rcn_jute_movements
  for select to authenticated
  using (
    (select private.jute_scope_location()) is not null
    and (select private.jute_scope_location()) <> '∅'
    and (
      from_location = (select private.jute_scope_location())
      or to_location = (select private.jute_scope_location())
      or (ledger = 'FOURNISSEUR' and reception_id is not null and exists (
            select 1 from public.wms_receptions r join public.wms_warehouses w on w.id = r.warehouse_id
             where r.id = rcn_jute_movements.reception_id and 'BAG-WH-'||w.code = (select private.jute_scope_location())))
    )
  );

drop policy if exists rcn_jute_locations_wh_scope_read on public.rcn_jute_locations;
create policy rcn_jute_locations_wh_scope_read on public.rcn_jute_locations
  for select to authenticated
  using ((select private.jute_scope_location()) is not null
         and (code = (select private.jute_scope_location()) or code = 'JUTE-TRANSIT'));

-- ---------------------------------------------------------------------
-- D. Sacherie : référentiels élargis
-- ---------------------------------------------------------------------
alter table public.rcn_jute_movements add column if not exists bag_condition text;
alter table public.rcn_jute_movements drop constraint if exists rcn_jute_movements_bag_condition_check;
alter table public.rcn_jute_movements add constraint rcn_jute_movements_bag_condition_check
  check (bag_condition is null or bag_condition = any (array['BON','HUMIDE','DECHIRE','RECONDITIONNE']));
alter table public.rcn_jute_movements drop constraint if exists rcn_jute_movements_movement_type_check;
alter table public.rcn_jute_movements add constraint rcn_jute_movements_movement_type_check check (movement_type = any (array[
  'SOLDE_INITIAL','ACHAT','DOTATION','RETOUR','TRANSFERT','CLASSEMENT','REPARATION_SORTIE','REPARATION_RETOUR','REBAGING',
  'REFORME','PERTE_APPROUVEE','AJUSTEMENT_INVENTAIRE',
  'RECU_LIVRAISON','SORTIE_PRODUCTION','RETOUR_PRODUCTION','CONSOMMATION_PRODUCTION']));

-- Deux emplacements de référence. Le déclencheur d'audit central exige une
-- session utilisateur : il est suspendu le temps de cette seule insertion
-- (même transaction) et l'ajout est tracé explicitement dans rcn_audit.
alter table public.rcn_jute_locations disable trigger trg_rcn_jute_locations_audit;
insert into public.rcn_jute_locations(code, site_code, warehouse_code, nom, type, actif, scope_type, actor_type)
values ('JUTE-PRODUCTION-YAK','YAKRO','PRODUCTION','Sacs en production · usine Yamoussoukro','STOCK',true,'PRODUCTION','FACTORY'),
       ('JUTE-REBUT','GLOBAL','REBUT','Sacs mis au rebut (hors stock)','REBUT',true,'REBUT',null)
on conflict (code) do nothing;
alter table public.rcn_jute_locations enable trigger trg_rcn_jute_locations_audit;
select public.wms_audit('JUTE-LOCATIONS', 'referentiel.ajout', null,
  '{"codes":["JUTE-PRODUCTION-YAK","JUTE-REBUT"]}'::jsonb, 'Migration correctifs audit 24/09/2026 : emplacements production et rebut');

-- ---------------------------------------------------------------------
-- E. Déchargement : cohérence total sacs / détail par état
-- ---------------------------------------------------------------------
do $$
declare d text; anchor text := '    if v_bags=0 then v_bags:=null; end if;
  end if;';
begin
  select pg_get_functiondef('public.wms_record_offload(text,jsonb)'::regprocedure) into d;
  if position('Nombre de sacs incohérent' in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'Ancre wms_record_offload introuvable'; end if;
    d := replace(d, anchor, anchor || '
  if v_bags is not null and (coalesce(nullif(p->>''bags_good'','''')::int,0)+coalesce(nullif(p->>''bags_wet'','''')::int,0)+coalesce(nullif(p->>''bags_torn'','''')::int,0)+coalesce(nullif(p->>''bags_recond'','''')::int,0)) > 0
     and v_bags <> (coalesce(nullif(p->>''bags_good'','''')::int,0)+coalesce(nullif(p->>''bags_wet'','''')::int,0)+coalesce(nullif(p->>''bags_torn'','''')::int,0)+coalesce(nullif(p->>''bags_recond'','''')::int,0)) then
    raise exception ''Nombre de sacs incohérent : total % différent du détail par état (bons + humides + déchirés + reconditionnés)'', v_bags;
  end if;');
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- F. Mouvements sacs automatiques au déchargement (P1-02, P1-03)
--    Déclenché quand le Lot est rattaché à la réception déchargée.
-- ---------------------------------------------------------------------
create or replace function private.wms_jute_on_offload()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_code text; v_loc text; v_total int := 0; v_debt int := 0; v_ret int := 0; v_rest int := 0; cond record;
begin
  if not (new.lot_id is not null and old.lot_id is null and new.offloaded_at is not null) then return new; end if;
  if exists (select 1 from public.rcn_jute_movements where event_key like 'WMS-OFFLOAD:'||new.id||':%') then return new; end if;
  select code into v_code from public.wms_warehouses where id = new.warehouse_id;
  v_loc := 'BAG-WH-'||v_code;
  if not exists (select 1 from public.rcn_jute_locations where code = v_loc and actif) then
    raise exception 'Emplacement sacherie % introuvable : mouvements sacs de la réception % impossibles', v_loc, new.id;
  end if;
  for cond in
    select * from (values ('BON', coalesce(new.bags_good,0)), ('HUMIDE', coalesce(new.bags_wet,0)),
                          ('DECHIRE', coalesce(new.bags_torn,0)), ('RECONDITIONNE', coalesce(new.bags_recond,0))) v(c, q)
    where q > 0
  loop
    insert into public.rcn_jute_movements(id, event_key, movement_type, ledger, supplier_code, qty, to_location, to_state,
      reception_id, lot_id, source_type, source_id, reference, note, owner_type, movement_at, bag_condition)
    values ('JUT-WMS-'||replace(gen_random_uuid()::text,'-',''), 'WMS-OFFLOAD:'||new.id||':INT:'||cond.c, 'RECU_LIVRAISON', 'INTERNE',
      new.supplier_code, cond.q, v_loc, 'PLEIN', new.id, new.lot_id, 'WMS_RECEPTION', new.id, new.id,
      'Sacs pleins reçus avec la livraison · état '||cond.c, 'ANAGROCI', coalesce(new.offloaded_at, now()), cond.c);
    v_total := v_total + cond.q;
  end loop;
  if v_total = 0 and coalesce(new.bags,0) > 0 then
    insert into public.rcn_jute_movements(id, event_key, movement_type, ledger, supplier_code, qty, to_location, to_state,
      reception_id, lot_id, source_type, source_id, reference, note, owner_type, movement_at)
    values ('JUT-WMS-'||replace(gen_random_uuid()::text,'-',''), 'WMS-OFFLOAD:'||new.id||':INT:NC', 'RECU_LIVRAISON', 'INTERNE',
      new.supplier_code, new.bags, v_loc, 'PLEIN', new.id, new.lot_id, 'WMS_RECEPTION', new.id, new.id,
      'Sacs pleins reçus avec la livraison · état non détaillé', 'ANAGROCI', coalesce(new.offloaded_at, now()));
    v_total := new.bags;
  end if;
  if v_total > 0 and new.supplier_code is not null then
    select coalesce(sum(case when movement_type in ('SOLDE_INITIAL','DOTATION') then qty when movement_type in ('RETOUR','PERTE_APPROUVEE') then -qty else 0 end),0)
      into v_debt from public.rcn_jute_movements where ledger = 'FOURNISSEUR' and supplier_code = new.supplier_code;
    v_ret := least(v_total, greatest(v_debt,0));
    v_rest := v_total - v_ret;
    if v_ret > 0 then
      insert into public.rcn_jute_movements(id, event_key, movement_type, ledger, supplier_code, qty, reception_id, lot_id,
        source_type, source_id, reference, note, owner_type, movement_at)
      values ('JUT-WMS-'||replace(gen_random_uuid()::text,'-',''), 'WMS-OFFLOAD:'||new.id||':FRN:RETOUR', 'RETOUR', 'FOURNISSEUR',
        new.supplier_code, v_ret, new.id, new.lot_id, 'WMS_RECEPTION', new.id, new.id,
        'Sacs dotés revenus pleins avec la livraison', 'FOURNISSEUR', coalesce(new.offloaded_at, now()));
    end if;
    if v_rest > 0 then
      insert into public.rcn_jute_movements(id, event_key, movement_type, ledger, supplier_code, qty, reception_id, lot_id,
        source_type, source_id, reference, note, owner_type, movement_at)
      values ('JUT-WMS-'||replace(gen_random_uuid()::text,'-',''), 'WMS-OFFLOAD:'||new.id||':FRN:RECU', 'RECU_LIVRAISON', 'FOURNISSEUR',
        new.supplier_code, v_rest, new.id, new.lot_id, 'WMS_RECEPTION', new.id, new.id,
        'Sacs du fournisseur reçus avec la livraison (hors dotation ANAGROCI)', 'FOURNISSEUR', coalesce(new.offloaded_at, now()));
    end if;
  end if;
  perform public.wms_audit(new.id, 'jute.offload', null,
    jsonb_build_object('location', v_loc, 'total', v_total, 'good', new.bags_good, 'wet', new.bags_wet, 'torn', new.bags_torn,
                       'recond', new.bags_recond, 'supplier_return', v_ret, 'received_with_delivery', v_rest, 'lot', new.lot_id),
    'Mouvements sacs automatiques au déchargement');
  return new;
end $$;
revoke all on function private.wms_jute_on_offload() from public, anon, authenticated;
drop trigger if exists trg_wms_jute_on_offload on public.wms_receptions;
create trigger trg_wms_jute_on_offload after update of lot_id on public.wms_receptions
  for each row execute function private.wms_jute_on_offload();

-- ---------------------------------------------------------------------
-- G. Sacs liés aux transferts inter-entrepôts (P1-02)
--    Ne bloque jamais le transfert RCN : l'écart éventuel est tracé.
-- ---------------------------------------------------------------------
create or replace function private.wms_jute_on_transfer()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_from text; v_to text; v_avail int; v_q int := 0; v_out int := 0;
begin
  if new.status = 'IN_TRANSIT' and old.status is distinct from 'IN_TRANSIT' and coalesce(new.bags_loaded,0) > 0 then
    if exists (select 1 from public.rcn_jute_movements where event_key = 'WMS-TRF:'||new.id||':OUT') then return new; end if;
    select 'BAG-WH-'||code into v_from from public.wms_warehouses where id = new.origin_warehouse_id;
    select coalesce(sum(case when to_location = v_from and to_state = 'PLEIN' then qty else 0 end),0)
         - coalesce(sum(case when from_location = v_from and from_state = 'PLEIN' then qty else 0 end),0)
      into v_avail from public.rcn_jute_movements where ledger = 'INTERNE';
    v_q := least(new.bags_loaded, greatest(v_avail,0));
    if v_q > 0 then
      insert into public.rcn_jute_movements(id, event_key, movement_type, ledger, qty, from_location, to_location, from_state, to_state,
        source_type, source_id, reference, note, owner_type, movement_at)
      values ('JUT-WMS-'||replace(gen_random_uuid()::text,'-',''), 'WMS-TRF:'||new.id||':OUT', 'TRANSFERT', 'INTERNE', v_q,
        v_from, 'JUTE-TRANSIT', 'PLEIN', 'EN_TRANSIT', 'WMS_TRANSFER', new.id, new.id,
        'Sacs pleins chargés · transfert '||new.id, 'ANAGROCI', coalesce(new.departed_at, now()));
    end if;
    perform public.wms_audit(new.id, 'jute.transfer_out', null,
      jsonb_build_object('from', v_from, 'bags_loaded', new.bags_loaded, 'posted', v_q, 'shortfall', new.bags_loaded - v_q),
      case when v_q < new.bags_loaded then 'Sacs chargés supérieurs au stock de sacs pleins enregistré : écart à régulariser' else 'Sacs en transit' end);
  elsif new.status in ('RECONCILED','DISCREPANCY') and old.status = 'ARRIVED' and new.bags_received is not null then
    if exists (select 1 from public.rcn_jute_movements where event_key = 'WMS-TRF:'||new.id||':IN') then return new; end if;
    select 'BAG-WH-'||code into v_to from public.wms_warehouses where id = new.dest_warehouse_id;
    select coalesce(sum(qty),0) into v_out from public.rcn_jute_movements where event_key = 'WMS-TRF:'||new.id||':OUT';
    v_q := least(new.bags_received, v_out);
    if v_q > 0 then
      insert into public.rcn_jute_movements(id, event_key, movement_type, ledger, qty, from_location, to_location, from_state, to_state,
        source_type, source_id, reference, note, owner_type, movement_at)
      values ('JUT-WMS-'||replace(gen_random_uuid()::text,'-',''), 'WMS-TRF:'||new.id||':IN', 'TRANSFERT', 'INTERNE', v_q,
        'JUTE-TRANSIT', v_to, 'EN_TRANSIT', 'PLEIN', 'WMS_TRANSFER', new.id, new.id,
        'Sacs pleins reçus · transfert '||new.id, 'ANAGROCI', coalesce(new.received_at, now()));
    end if;
    perform public.wms_audit(new.id, 'jute.transfer_in', null,
      jsonb_build_object('to', v_to, 'bags_sent', v_out, 'bags_received', new.bags_received, 'posted', v_q,
                         'missing_in_transit', greatest(v_out - new.bags_received,0), 'unexplained_surplus', greatest(new.bags_received - v_out,0)),
      case when new.bags_received <> v_out then 'Écart de sacs au transfert : reste visible en transit / à régulariser' else 'Sacs reçus' end);
  end if;
  return new;
end $$;
revoke all on function private.wms_jute_on_transfer() from public, anon, authenticated;
drop trigger if exists trg_wms_jute_on_transfer on public.wms_transfers;
create trigger trg_wms_jute_on_transfer after update of status on public.wms_transfers
  for each row execute function private.wms_jute_on_transfer();

-- ---------------------------------------------------------------------
-- H. Mouvements sacherie manuels : états, rebut hors stock, production,
--    périmètre Warehouse (P1-01, P1-04, P1-05)
-- ---------------------------------------------------------------------
create or replace function public.wms_bag_move(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; v_kind text; v_qty int; v_loc text; v_sup text; v_key text; v_id text; v_ref text; v_avail int; v_to_state text;
        ids text[] := '{}'; v_scope text; v_from_state text; v_prod constant text := 'JUTE-PRODUCTION-YAK'; v_rebut constant text := 'JUTE-REBUT';
begin
  v_kind := upper(coalesce(p->>'kind',''));
  if v_kind like 'PRODUCTION\_%' then c := public.wms_require('jute_production'); else c := public.wms_require('bag_move'); end if;
  v_qty := nullif(p->>'qty','')::int; v_loc := p->>'location'; v_sup := nullif(p->>'supplier_code',''); v_key := p->>'idempotency_key'; v_ref := coalesce(p->>'reference', v_key);
  if v_key is null then raise exception 'Clé d''idempotence obligatoire'; end if;
  if exists (select 1 from public.rcn_jute_movements where event_key = 'WMS:'||v_key||':A') then
    return jsonb_build_object('idempotent', true, 'ids', (select array_agg(id) from public.rcn_jute_movements where event_key like 'WMS:'||v_key||':%'));
  end if;
  if v_qty is null or v_qty <= 0 then raise exception 'Quantité de sacs invalide'; end if;
  if v_loc is null or not exists (select 1 from public.rcn_jute_locations where code = v_loc and actif) then raise exception 'Emplacement sacherie « % » inconnu', v_loc; end if;
  v_scope := private.jute_scope_location();
  if v_scope is not null and v_loc is distinct from v_scope then
    raise exception 'Périmètre sacherie : votre profil est limité à % ; mouvement refusé sur %', replace(v_scope,'∅','(aucun Warehouse rattaché)'), v_loc using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(42070, hashtext(v_loc));
  if v_kind in ('DOTATION','RETURN','APPROVED_LOSS') and v_sup is null then raise exception 'Fournisseur obligatoire pour ce mouvement'; end if;
  v_from_state := case v_kind
    when 'DOTATION' then 'UTILISABLE' when 'INTERNAL_USE' then 'UTILISABLE' when 'DAMAGED' then 'UTILISABLE' when 'REBAGGING' then 'UTILISABLE'
    when 'REPAIR_OUT' then 'DECHIRE' when 'RECONDITIONED' then 'A_REPARER' when 'RETURN_FROM_USE' then 'PLEIN' when 'PRODUCTION_ISSUE' then 'PLEIN'
    when 'SCRAP' then upper(coalesce(nullif(p->>'from_state',''),'DECHIRE')) else null end;
  if v_from_state is not null then
    select coalesce(sum(qty),0) into v_avail from public.rcn_jute_v_stock where location_code = v_loc and state = v_from_state;
    if v_avail < v_qty then raise exception 'Stock de sacs % insuffisant à % (disponible : %) — stock négatif refusé', v_from_state, v_loc, v_avail; end if;
  end if;
  if v_kind in ('PRODUCTION_RETURN','PRODUCTION_CONSUMED','PRODUCTION_SCRAP') then
    select coalesce(sum(qty),0) into v_avail from public.rcn_jute_v_stock where location_code = v_prod and state = 'PLEIN';
    if v_avail < v_qty then raise exception 'Solde de sacs en production insuffisant (disponible : %)', v_avail; end if;
  end if;

  if v_kind = 'DOTATION' then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,supplier_code,qty,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','DOTATION','FOURNISSEUR',v_sup,v_qty,'WMS',v_ref,v_ref,p->>'note','FOURNISSEUR',(c->>'uid')::uuid,now());
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':B','DOTATION','INTERNE',v_qty,v_loc,'UTILISABLE','WMS',v_ref,v_ref,'Sortie physique · dotation '||v_sup,'ANAGROCI',(c->>'uid')::uuid,now());
  elsif v_kind = 'RETURN' then
    v_to_state := case upper(coalesce(p->>'condition','GOOD')) when 'GOOD' then 'UTILISABLE' when 'DAMAGED' then 'DECHIRE' when 'WET' then 'HUMIDE' when 'REPAIRABLE' then 'A_REPARER' else 'A_CLASSER' end;
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,supplier_code,qty,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','RETOUR','FOURNISSEUR',v_sup,v_qty,'WMS',v_ref,v_ref,p->>'note','FOURNISSEUR',(c->>'uid')::uuid,now());
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':B','RETOUR','INTERNE',v_qty,v_loc,v_to_state,'WMS',v_ref,v_ref,'Retour physique · '||v_sup||' · état '||v_to_state,'ANAGROCI',(c->>'uid')::uuid,now());
  elsif v_kind = 'APPROVED_LOSS' then
    if coalesce(btrim(p->>'approved_by'),'') = '' or coalesce(btrim(p->>'note'),'') = '' then raise exception 'Perte approuvée : approbateur et motif obligatoires'; end if;
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,supplier_code,qty,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','PERTE_APPROUVEE','FOURNISSEUR',v_sup,v_qty,'WMS',v_ref,v_ref,p->>'note'||' · approuvé par '||(p->>'approved_by'),'FOURNISSEUR',(c->>'uid')::uuid,now());
  elsif v_kind in ('DAMAGED','REPAIR_OUT','RECONDITIONED','INTERNAL_USE','RETURN_FROM_USE') then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A',
      case v_kind when 'RECONDITIONED' then 'REPARATION_RETOUR' when 'REPAIR_OUT' then 'REPARATION_SORTIE' else 'CLASSEMENT' end, 'INTERNE', v_qty, v_loc, v_loc,
      v_from_state,
      case v_kind when 'DAMAGED' then 'DECHIRE' when 'REPAIR_OUT' then 'A_REPARER' when 'RECONDITIONED' then 'REPARE' when 'INTERNAL_USE' then 'PLEIN' when 'RETURN_FROM_USE' then 'UTILISABLE' end,
      'WMS', v_ref, v_ref, p->>'note', 'ANAGROCI', (c->>'uid')::uuid, now());
    if v_kind = 'RECONDITIONED' and coalesce((p->>'verified')::boolean,false) then
      v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
      insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
      values (v_id,'WMS:'||v_key||':B','CLASSEMENT','INTERNE',v_qty,v_loc,v_loc,'REPARE','UTILISABLE','WMS',v_ref,v_ref,'Vérification reconditionnement OK : sacs utilisables','ANAGROCI',(c->>'uid')::uuid,now());
    end if;
  elsif v_kind = 'SCRAP' then
    -- Mise au rebut : le sac SORT du stock de l'emplacement (vers JUTE-REBUT, hors stock).
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','REFORME','INTERNE',v_qty,v_loc,v_rebut,v_from_state,'REFORME','WMS',v_ref,v_ref,coalesce(p->>'note','Mise au rebut'),'ANAGROCI',(c->>'uid')::uuid,now());
  elsif v_kind = 'REBAGGING' then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,source_type,source_id,reference,note,owner_type,created_by,movement_at,bin_id,lot_id)
    values (v_id,'WMS:'||v_key||':A','REBAGING','INTERNE',v_qty,v_loc,'UTILISABLE','WMS',v_ref,v_ref,p->>'note','ANAGROCI',(c->>'uid')::uuid,now(),p->>'bin_id',p->>'lot_id');
  elsif v_kind = 'PRODUCTION_ISSUE' then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at,lot_id)
    values (v_id,'WMS:'||v_key||':A','SORTIE_PRODUCTION','INTERNE',v_qty,v_loc,v_prod,'PLEIN','PLEIN','WMS',v_ref,v_ref,coalesce(p->>'note','Sortie vers production'),'ANAGROCI',(c->>'uid')::uuid,now(),p->>'lot_id');
  elsif v_kind = 'PRODUCTION_RETURN' then
    v_to_state := case upper(coalesce(p->>'condition','GOOD')) when 'GOOD' then 'UTILISABLE' when 'DAMAGED' then 'DECHIRE' when 'WET' then 'HUMIDE' when 'REPAIRABLE' then 'A_REPARER' else 'A_CLASSER' end;
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','RETOUR_PRODUCTION','INTERNE',v_qty,v_prod,v_loc,'PLEIN',v_to_state,'WMS',v_ref,v_ref,coalesce(p->>'note','Retour de production · état '||v_to_state),'ANAGROCI',(c->>'uid')::uuid,now());
  elsif v_kind = 'PRODUCTION_CONSUMED' then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','CONSOMMATION_PRODUCTION','INTERNE',v_qty,v_prod,'PLEIN','WMS',v_ref,v_ref,coalesce(p->>'note','Sacs consommés en production'),'ANAGROCI',(c->>'uid')::uuid,now());
  elsif v_kind = 'PRODUCTION_SCRAP' then
    v_id := 'JUT-WMS-'||replace(gen_random_uuid()::text,'-',''); ids := ids || v_id;
    insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,owner_type,created_by,movement_at)
    values (v_id,'WMS:'||v_key||':A','REFORME','INTERNE',v_qty,v_prod,v_rebut,'PLEIN','REFORME','WMS',v_ref,v_ref,coalesce(p->>'note','Sacs endommagés en production'),'ANAGROCI',(c->>'uid')::uuid,now());
  else
    raise exception 'Type de mouvement sacherie inconnu : %', v_kind;
  end if;
  perform public.wms_audit('BAG:'||v_loc, 'bag.'||lower(v_kind), null, jsonb_build_object('qty', v_qty, 'supplier', v_sup, 'ids', to_jsonb(ids)), coalesce(p->>'note', v_kind), p->>'approved_by');
  return jsonb_build_object('idempotent', false, 'ids', to_jsonb(ids));
end $function$;

-- ---------------------------------------------------------------------
-- I. Soldes sacherie (P1-04) — vues en security_invoker (RLS respectée)
-- ---------------------------------------------------------------------
create or replace view public.jute_v_supplier_balance with (security_invoker = true) as
select supplier_code,
  coalesce(sum(qty) filter (where movement_type in ('SOLDE_INITIAL','DOTATION')),0)::int as issued,
  coalesce(sum(qty) filter (where movement_type = 'RETOUR'),0)::int as returned,
  coalesce(sum(qty) filter (where movement_type = 'PERTE_APPROUVEE'),0)::int as approved_loss,
  coalesce(sum(qty) filter (where movement_type = 'RECU_LIVRAISON'),0)::int as received_with_delivery,
  (coalesce(sum(qty) filter (where movement_type in ('SOLDE_INITIAL','DOTATION')),0)
   - coalesce(sum(qty) filter (where movement_type in ('RETOUR','PERTE_APPROUVEE')),0))::int as balance,
  max(movement_at) as last_movement
from public.rcn_jute_movements
where ledger = 'FOURNISSEUR'
group by supplier_code;

create or replace view public.jute_v_production_balance with (security_invoker = true) as
select l.code as production_location,
  coalesce(sum(m.qty) filter (where m.movement_type = 'SORTIE_PRODUCTION' and m.to_location = l.code),0)::int as issued,
  coalesce(sum(m.qty) filter (where m.movement_type = 'RETOUR_PRODUCTION' and m.from_location = l.code),0)::int as returned,
  coalesce(sum(m.qty) filter (where m.movement_type = 'CONSOMMATION_PRODUCTION' and m.from_location = l.code),0)::int as consumed,
  coalesce(sum(m.qty) filter (where m.movement_type = 'REFORME' and m.from_location = l.code),0)::int as damaged,
  (coalesce(sum(m.qty) filter (where m.movement_type = 'SORTIE_PRODUCTION' and m.to_location = l.code),0)
   - coalesce(sum(m.qty) filter (where m.movement_type in ('RETOUR_PRODUCTION','CONSOMMATION_PRODUCTION','REFORME') and m.from_location = l.code),0))::int as balance
from public.rcn_jute_locations l
left join public.rcn_jute_movements m on m.ledger = 'INTERNE' and (m.from_location = l.code or m.to_location = l.code)
where l.scope_type = 'PRODUCTION'
group by l.code;

create or replace view public.jute_v_warehouse_closing_balance with (security_invoker = true) as
with f as (
  select l.code as location_code,
    coalesce(sum(m.qty) filter (where m.to_location = l.code and m.movement_type in ('RECU_LIVRAISON','RETOUR','ACHAT','SOLDE_INITIAL','RETOUR_PRODUCTION')),0) as receipts,
    coalesce(sum(m.qty) filter (where m.to_location = l.code and m.movement_type = 'TRANSFERT'),0) as transfers_in,
    coalesce(sum(m.qty) filter (where m.from_location = l.code and m.movement_type in ('DOTATION','SORTIE_PRODUCTION','REBAGING','CONSOMMATION_PRODUCTION')),0) as issues,
    coalesce(sum(m.qty) filter (where m.from_location = l.code and m.movement_type = 'REFORME' and m.to_location is distinct from l.code),0) as damaged_discarded,
    coalesce(sum(m.qty) filter (where m.from_location = l.code and m.movement_type = 'TRANSFERT'),0) as transfers_out,
    coalesce(sum(m.qty) filter (where m.to_location = l.code and m.movement_type = 'AJUSTEMENT_INVENTAIRE'),0)
      - coalesce(sum(m.qty) filter (where m.from_location = l.code and m.movement_type = 'AJUSTEMENT_INVENTAIRE'),0) as adjustments
  from public.rcn_jute_locations l
  left join public.rcn_jute_movements m on m.ledger = 'INTERNE' and (m.from_location = l.code or m.to_location = l.code)
  where l.type = 'STOCK' and coalesce(l.scope_type,'') in ('EXTERNAL_WAREHOUSE','FACTORY_WAREHOUSE')
  group by l.code
), s as (
  select location_code,
    coalesce(sum(qty),0) as closing_actual,
    coalesce(sum(qty) filter (where state = 'UTILISABLE'),0) as utilisable,
    coalesce(sum(qty) filter (where state = 'PLEIN'),0) as plein,
    coalesce(sum(qty) filter (where state = 'HUMIDE'),0) as humide,
    coalesce(sum(qty) filter (where state in ('A_REPARER','REPARE')),0) as en_reparation,
    coalesce(sum(qty) filter (where state = 'DECHIRE'),0) as dechire,
    coalesce(sum(qty) filter (where state = 'A_CLASSER'),0) as a_classer
  from public.rcn_jute_v_stock group by location_code
)
select f.location_code, 0::int as opening,
  f.receipts::int, f.transfers_in::int, f.issues::int, f.damaged_discarded::int, f.transfers_out::int, f.adjustments::int,
  (f.receipts + f.transfers_in - f.issues - f.damaged_discarded - f.transfers_out + f.adjustments)::int as closing_expected,
  coalesce(s.closing_actual,0)::int as closing_actual,
  (coalesce(s.closing_actual,0) - (f.receipts + f.transfers_in - f.issues - f.damaged_discarded - f.transfers_out + f.adjustments))::int as variance,
  coalesce(s.utilisable,0)::int as utilisable, coalesce(s.plein,0)::int as plein, coalesce(s.humide,0)::int as humide,
  coalesce(s.en_reparation,0)::int as en_reparation, coalesce(s.dechire,0)::int as dechire, coalesce(s.a_classer,0)::int as a_classer
from f left join s on s.location_code = f.location_code;

grant select on public.jute_v_supplier_balance, public.jute_v_production_balance, public.jute_v_warehouse_closing_balance to authenticated;
revoke all on public.jute_v_supplier_balance, public.jute_v_production_balance, public.jute_v_warehouse_closing_balance from anon;

-- Balance sur période : Opening + Receipts + Transfers In − Issues − Damaged/Discarded − Transfers Out (+ ajustements) = Closing
create or replace function public.jute_warehouse_closing(p_location text, p_from date, p_to date default current_date)
returns jsonb
language plpgsql stable security invoker
set search_path to 'public'
as $function$
declare v_open numeric; v_rec numeric; v_tin numeric; v_iss numeric; v_dmg numeric; v_tout numeric; v_adj numeric; v_close numeric;
        v_start timestamptz := p_from::timestamptz; v_end timestamptz := (p_to + 1)::timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Période invalide'; end if;
  select coalesce(sum(case when to_location = p_location and to_state is not null then qty else 0 end),0)
       - coalesce(sum(case when from_location = p_location and from_state is not null then qty else 0 end),0)
    into v_open from public.rcn_jute_movements where ledger = 'INTERNE' and movement_at < v_start;
  select
    coalesce(sum(qty) filter (where to_location = p_location and movement_type in ('RECU_LIVRAISON','RETOUR','ACHAT','SOLDE_INITIAL','RETOUR_PRODUCTION')),0),
    coalesce(sum(qty) filter (where to_location = p_location and movement_type = 'TRANSFERT'),0),
    coalesce(sum(qty) filter (where from_location = p_location and movement_type in ('DOTATION','SORTIE_PRODUCTION','REBAGING','CONSOMMATION_PRODUCTION')),0),
    coalesce(sum(qty) filter (where from_location = p_location and movement_type = 'REFORME' and to_location is distinct from p_location),0),
    coalesce(sum(qty) filter (where from_location = p_location and movement_type = 'TRANSFERT'),0),
    coalesce(sum(qty) filter (where to_location = p_location and movement_type = 'AJUSTEMENT_INVENTAIRE'),0)
      - coalesce(sum(qty) filter (where from_location = p_location and movement_type = 'AJUSTEMENT_INVENTAIRE'),0)
  into v_rec, v_tin, v_iss, v_dmg, v_tout, v_adj
  from public.rcn_jute_movements where ledger = 'INTERNE' and movement_at >= v_start and movement_at < v_end;
  select coalesce(sum(case when to_location = p_location and to_state is not null then qty else 0 end),0)
       - coalesce(sum(case when from_location = p_location and from_state is not null then qty else 0 end),0)
    into v_close from public.rcn_jute_movements where ledger = 'INTERNE' and movement_at < v_end;
  return jsonb_build_object('location', p_location, 'from', p_from, 'to', p_to,
    'opening', v_open, 'receipts', v_rec, 'transfers_in', v_tin, 'issues', v_iss, 'damaged_discarded', v_dmg,
    'transfers_out', v_tout, 'adjustments', v_adj,
    'closing_expected', v_open + v_rec + v_tin - v_iss - v_dmg - v_tout + v_adj, 'closing_actual', v_close,
    'variance', v_close - (v_open + v_rec + v_tin - v_iss - v_dmg - v_tout + v_adj));
end $function$;
revoke all on function public.jute_warehouse_closing(text,date,date) from public, anon;
grant execute on function public.jute_warehouse_closing(text,date,date) to authenticated;
