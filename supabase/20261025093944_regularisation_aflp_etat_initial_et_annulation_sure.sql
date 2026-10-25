-- APPLIQUÉE le 25/10/2026 (version Supabase 20261025093944). Copie exacte pour revue.
-- Schéma interne regularisation_aflp : non exposé, aucun droit anon / authenticated.
-- Remplace l'ancien rollback à base de DELETE. Mode d'emploi :
-- docs/regularisation_aflp_20261025/sql/rollback_lots_A_B_20261025.sql

-- État initial figé des lots A et B (pour détecter toute modification ultérieure)
create table if not exists regularisation_aflp.lot_a_etat_initial as
select id, producteur_id, to_jsonb(fp) as ligne, now() as fige_le from public.farmer_plots fp where fp.notes like 'REG-AFLP-A-20261025%';
create table if not exists regularisation_aflp.lot_b_etat_initial as
select id, producteur_id, to_jsonb(a) as ligne, now() as fige_le from public.farmer_participation_attestations a where a.executed_by_note like '%REG-AFLP-B-20261025%';
alter table regularisation_aflp.lot_a_etat_initial add primary key (id);
alter table regularisation_aflp.lot_b_etat_initial add primary key (id);

create table if not exists regularisation_aflp.journal_annulation (
  id bigserial primary key,
  lot text not null check (lot in ('A','B')),
  ligne_id uuid not null,
  action text not null check (action in ('ANNULEE','RESTAUREE','EXCLUE_MODIFIEE')),
  avant jsonb,
  apres jsonb,
  acteur uuid,
  motif text not null,
  fait_le timestamptz not null default clock_timestamp()
);

-- Lot A : désactivation (deleted + INACTIVE), jamais de DELETE. Lignes modifiées depuis : exclues et journalisées.
create or replace function regularisation_aflp.annuler_lot_a(p_acteur uuid, p_motif text, p_executer boolean default false)
returns table(intactes int, modifiees_exclues int, annulees int)
language plpgsql security definer set search_path = public, regularisation_aflp, private as $fn$
declare r record; n_int int:=0; n_mod int:=0; n_ann int:=0; v_avant jsonb; v_apres jsonb;
begin
  if not exists (select 1 from public.profils where user_id=p_acteur and actif and role in ('Branch Manager','Branch Manager / Head of Programme')) then
    raise exception 'Annulation réservée au Branch Manager (p_acteur).';
  end if;
  if coalesce(btrim(p_motif),'') = '' then raise exception 'Motif obligatoire.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',p_acteur,'role','authenticated')::text, true);
  for r in select e.id, e.ligne, to_jsonb(fp) as courante from regularisation_aflp.lot_a_etat_initial e join public.farmer_plots fp on fp.id=e.id loop
    if r.courante = r.ligne then
      n_int := n_int + 1;
      if p_executer then
        update public.farmer_plots set deleted = true, status = 'INACTIVE',
          notes = notes || ' [ANNULÉE le ' || to_char(now(),'YYYY-MM-DD') || ' : ' || p_motif || ']'
        where id = r.id returning to_jsonb(farmer_plots.*) into v_apres;
        insert into regularisation_aflp.journal_annulation(lot,ligne_id,action,avant,apres,acteur,motif) values ('A',r.id,'ANNULEE',r.courante,v_apres,p_acteur,p_motif);
        n_ann := n_ann + 1;
      end if;
    else
      n_mod := n_mod + 1;
      if p_executer then
        insert into regularisation_aflp.journal_annulation(lot,ligne_id,action,avant,acteur,motif) values ('A',r.id,'EXCLUE_MODIFIEE',r.courante,p_acteur,'Modifiée depuis la migration : conservée');
      end if;
    end if;
  end loop;
  return query select n_int, n_mod, n_ann;
end $fn$;

-- Restauration du lot A : uniquement les parcelles annulées et restées en l'état.
create or replace function regularisation_aflp.restaurer_lot_a(p_acteur uuid, p_motif text, p_executer boolean default false)
returns table(restaurables int, restaurees int)
language plpgsql security definer set search_path = public, regularisation_aflp, private as $fn$
declare r record; n int:=0; n_r int:=0; v_apres jsonb;
begin
  if not exists (select 1 from public.profils where user_id=p_acteur and actif and role in ('Branch Manager','Branch Manager / Head of Programme')) then
    raise exception 'Restauration réservée au Branch Manager (p_acteur).';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub',p_acteur,'role','authenticated')::text, true);
  for r in
    select distinct on (j.ligne_id) j.ligne_id, j.apres, e.ligne as initiale, to_jsonb(fp) as courante
    from regularisation_aflp.journal_annulation j
    join regularisation_aflp.lot_a_etat_initial e on e.id=j.ligne_id
    join public.farmer_plots fp on fp.id=j.ligne_id
    where j.lot='A' and j.action in ('ANNULEE','RESTAUREE') order by j.ligne_id, j.id desc
  loop
    if (r.courante->>'record_version') = (r.apres->>'record_version') and (r.courante->>'deleted')::boolean then
      n := n + 1;
      if p_executer then
        update public.farmer_plots set deleted = false, status = r.initiale->>'status', notes = r.initiale->>'notes'
        where id = r.ligne_id returning to_jsonb(farmer_plots.*) into v_apres;
        insert into regularisation_aflp.journal_annulation(lot,ligne_id,action,avant,apres,acteur,motif) values ('A',r.ligne_id,'RESTAUREE',r.courante,v_apres,p_acteur,coalesce(p_motif,'Restauration'));
        n_r := n_r + 1;
      end if;
    end if;
  end loop;
  return query select n, n_r;
end $fn$;

-- Lot B : retrait (status WITHDRAWN), jamais de DELETE ; restauration symétrique.
create or replace function regularisation_aflp.annuler_lot_b(p_acteur uuid, p_motif text, p_executer boolean default false)
returns table(intactes int, modifiees_exclues int, retirees int)
language plpgsql security definer set search_path = public, regularisation_aflp as $fn$
declare r record; n_int int:=0; n_mod int:=0; n_ret int:=0; v_apres jsonb;
begin
  if not exists (select 1 from public.profils where user_id=p_acteur and actif and role in ('Branch Manager','Branch Manager / Head of Programme')) then
    raise exception 'Annulation réservée au Branch Manager (p_acteur).';
  end if;
  if coalesce(btrim(p_motif),'') = '' then raise exception 'Motif obligatoire.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',p_acteur,'role','authenticated')::text, true);
  for r in select e.id, e.ligne, to_jsonb(a) as courante from regularisation_aflp.lot_b_etat_initial e join public.farmer_participation_attestations a on a.id=e.id loop
    if r.courante = r.ligne then
      n_int := n_int + 1;
      if p_executer then
        update public.farmer_participation_attestations set status='WITHDRAWN',
          notes = coalesce(notes,'') || ' [RETIRÉE le ' || to_char(now(),'YYYY-MM-DD') || ' : ' || p_motif || ']'
        where id=r.id returning to_jsonb(farmer_participation_attestations.*) into v_apres;
        insert into regularisation_aflp.journal_annulation(lot,ligne_id,action,avant,apres,acteur,motif) values ('B',r.id,'ANNULEE',r.courante,v_apres,p_acteur,p_motif);
        n_ret := n_ret + 1;
      end if;
    else
      n_mod := n_mod + 1;
      if p_executer then
        insert into regularisation_aflp.journal_annulation(lot,ligne_id,action,avant,acteur,motif) values ('B',r.id,'EXCLUE_MODIFIEE',r.courante,p_acteur,'Modifiée depuis la migration : conservée');
      end if;
    end if;
  end loop;
  return query select n_int, n_mod, n_ret;
end $fn$;

create or replace function regularisation_aflp.restaurer_lot_b(p_acteur uuid, p_motif text, p_executer boolean default false)
returns table(restaurables int, restaurees int)
language plpgsql security definer set search_path = public, regularisation_aflp as $fn$
declare r record; n int:=0; n_r int:=0; v_apres jsonb;
begin
  if not exists (select 1 from public.profils where user_id=p_acteur and actif and role in ('Branch Manager','Branch Manager / Head of Programme')) then
    raise exception 'Restauration réservée au Branch Manager (p_acteur).';
  end if;
  for r in
    select distinct on (j.ligne_id) j.ligne_id, j.apres, e.ligne as initiale, to_jsonb(a) as courante
    from regularisation_aflp.journal_annulation j
    join regularisation_aflp.lot_b_etat_initial e on e.id=j.ligne_id
    join public.farmer_participation_attestations a on a.id=j.ligne_id
    where j.lot='B' and j.action in ('ANNULEE','RESTAUREE') order by j.ligne_id, j.id desc
  loop
    if r.courante = r.apres and r.courante->>'status' = 'WITHDRAWN' then
      if not exists (select 1 from public.farmer_participation_attestations x where x.producteur_id = r.initiale->>'producteur_id' and x.status='ACTIVE') then
        n := n + 1;
        if p_executer then
          update public.farmer_participation_attestations set status='ACTIVE', notes = r.initiale->>'notes'
          where id=r.ligne_id returning to_jsonb(farmer_participation_attestations.*) into v_apres;
          insert into regularisation_aflp.journal_annulation(lot,ligne_id,action,avant,apres,acteur,motif) values ('B',r.ligne_id,'RESTAUREE',r.courante,v_apres,p_acteur,coalesce(p_motif,'Restauration'));
          n_r := n_r + 1;
        end if;
      end if;
    end if;
  end loop;
  return query select n, n_r;
end $fn$;

revoke all on all functions in schema regularisation_aflp from public, anon, authenticated;
alter table regularisation_aflp.lot_a_etat_initial enable row level security;
alter table regularisation_aflp.lot_b_etat_initial enable row level security;
alter table regularisation_aflp.journal_annulation enable row level security;
revoke all on all tables in schema regularisation_aflp from public, anon, authenticated;
revoke all on all sequences in schema regularisation_aflp from public, anon, authenticated;
