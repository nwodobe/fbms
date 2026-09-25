-- ============================================================================
-- NIVEAU 1 — Migration 10 : cycle d'amélioration 1
-- Date : 2026-08-14 · Dépend de : 20260814_01 à 09
--
-- CE QUE CETTE MIGRATION FERME
--   A-05  paiements et commissions n'avaient pas d'entité propre. Le Lot A les
--         exigeait explicitement, et sans eux la réconciliation ne pouvait pas
--         rapprocher « commissions dues » de « commissions payées » : la donnée
--         n'existait pas.
--   Lot F  plusieurs types d'anomalie étaient déclarés dans la contrainte mais
--         n'avaient aucun détecteur. Un type déclaré et jamais levé donne
--         l'illusion d'une couverture qui n'existe pas.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Paiements — un achat peut être réglé en plusieurs fois
-- ---------------------------------------------------------------------------
-- Jusqu'ici, le paiement était un attribut de l'achat (montant + mode_paiement).
-- Un règlement partiel, différé ou groupé n'était pas représentable, et le
-- rapprochement « ce que le RT a effectivement versé » restait impossible.

create table if not exists public.n1_paiements (
  id              uuid primary key default gen_random_uuid(),
  paiement_code   text not null unique,
  local_id        text,
  cle_idempotence text,
  campagne        text not null,
  cluster         text,
  rt_id           text not null,
  cycle_uid       uuid references public.n1_cycles(id),
  achat_id        uuid references public.achats(id),
  beneficiaire    text not null,
  beneficiaire_type text not null default 'PRODUCTEUR',
  montant         numeric not null check (montant > 0),
  mode_paiement   text not null,
  reference_externe text,
  date_paiement   date not null default current_date,
  n1_statut       text not null default 'SOUMIS',
  terminal_id     text,
  created_by      uuid not null default public.n1_uid(),
  created_at      timestamptz not null default now(),
  serveur_recu_le timestamptz not null default now(),
  constraint n1_paie_type_chk check (beneficiaire_type in ('PRODUCTEUR','RT','TRANSPORTEUR','AUTRE')),
  constraint n1_paie_mode_chk check (mode_paiement in ('ESPECES','WAVE','VIREMENT','COMPENSATION')),
  constraint n1_paie_statut_chk check (n1_statut in
    ('BROUILLON','SOUMIS','VALIDE','REJETE','RECONCILIE','CLOTURE','ANNULE','AJUSTE'))
);

create sequence if not exists public.n1_seq_paiement start 1;
create unique index if not exists n1_paie_cle_idem_uidx
  on public.n1_paiements (cle_idempotence) where cle_idempotence is not null;
-- Une référence Wave ne peut pas justifier deux paiements.
create unique index if not exists n1_paie_ref_externe_uidx
  on public.n1_paiements (campagne, mode_paiement, reference_externe)
  where reference_externe is not null;
create index if not exists n1_paie_rt_idx    on public.n1_paiements (rt_id, date_paiement);
create index if not exists n1_paie_cycle_idx on public.n1_paiements (cycle_uid);
create index if not exists n1_paie_achat_idx on public.n1_paiements (achat_id);

-- ---------------------------------------------------------------------------
-- 2) Commissions — dues puis payées, deux faits distincts
-- ---------------------------------------------------------------------------

create table if not exists public.n1_commissions (
  id               uuid primary key default gen_random_uuid(),
  commission_code  text not null unique,
  campagne         text not null,
  cluster          text,
  rt_id            text not null,
  cycle_uid        uuid references public.n1_cycles(id),
  base_kg          numeric not null check (base_kg >= 0),
  taux_fcfa_kg     numeric not null check (taux_fcfa_kg >= 0),
  montant_du       numeric not null check (montant_du >= 0),
  montant_paye     numeric not null default 0 check (montant_paye >= 0),
  paiement_id      uuid references public.n1_paiements(id),
  periode_debut    date,
  periode_fin      date,
  n1_statut        text not null default 'SOUMIS',
  created_by       uuid not null default public.n1_uid(),
  created_at       timestamptz not null default now(),
  constraint n1_comm_statut_chk check (n1_statut in
    ('BROUILLON','SOUMIS','VALIDE','REJETE','RECONCILIE','CLOTURE','ANNULE','AJUSTE')),
  -- On ne paie jamais plus que ce qui est dû sans passer par un ajustement.
  constraint n1_comm_pas_de_surpaiement check (montant_paye <= montant_du)
);

create sequence if not exists public.n1_seq_commission start 1;
create unique index if not exists n1_comm_cycle_uidx
  on public.n1_commissions (cycle_uid) where cycle_uid is not null;
create index if not exists n1_comm_rt_idx on public.n1_commissions (rt_id, campagne);

-- ---------------------------------------------------------------------------
-- 3) Identité, gardes et audit — mêmes règles que partout ailleurs
-- ---------------------------------------------------------------------------

create or replace function public.n1_paiement_identite()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cycle public.n1_cycles%rowtype;
begin
  if nullif(btrim(coalesce(new.campagne,'')),'') is null then
    new.campagne := public.n1_param_txt('campagne_active');
    if new.campagne is null then
      raise exception 'Campagne active non définie : paiement refusé'
        using errcode = 'restrict_violation';
    end if;
  end if;
  if nullif(btrim(coalesce(new.cle_idempotence,'')),'') is null then
    new.cle_idempotence := nullif(btrim(coalesce(new.local_id,'')),'');
  end if;
  if new.date_paiement > current_date then
    raise exception 'Paiement daté dans le futur : refusé' using errcode = 'restrict_violation';
  end if;

  -- Un paiement Wave ou par virement sans référence externe est intraçable :
  -- on ne pourrait jamais le rapprocher du relevé de l'opérateur.
  if new.mode_paiement in ('WAVE','VIREMENT')
     and nullif(btrim(coalesce(new.reference_externe,'')),'') is null then
    raise exception 'Référence externe obligatoire pour un paiement %', new.mode_paiement
      using errcode = 'restrict_violation';
  end if;

  if new.cycle_uid is null then
    select * into v_cycle from public.n1_cycle_actif(new.rt_id, new.campagne);
    if v_cycle.id is not null then new.cycle_uid := v_cycle.id; end if;
  end if;

  if new.paiement_code is null then
    new.paiement_code := 'PAI-' || public.n1_code_court(new.campagne, 8, 'NA') || '-'
      || public.n1_code_court(new.cluster, 3, 'GEN') || '-'
      || lpad(nextval('public.n1_seq_paiement')::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_n1_10_paiement_identite on public.n1_paiements;
create trigger trg_n1_10_paiement_identite before insert on public.n1_paiements
  for each row execute function public.n1_paiement_identite();

-- Le total payé sur un achat ne dépasse jamais le montant de l'achat.
create or replace function public.n1_paiement_garde()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_achat numeric; v_deja numeric;
begin
  if new.achat_id is not null then
    select montant into v_achat from public.achats where id = new.achat_id;
    if not found then raise exception 'Achat introuvable pour ce paiement'; end if;
    select coalesce(sum(montant), 0) into v_deja
    from public.n1_paiements
    where achat_id = new.achat_id and n1_statut <> 'ANNULE' and id <> new.id;
    if v_deja + new.montant > v_achat then
      raise exception
        'Total des paiements (% + %) supérieur au montant de l''achat (%)',
        v_deja, new.montant, v_achat using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_n1_20_paiement_garde on public.n1_paiements;
create trigger trg_n1_20_paiement_garde before insert on public.n1_paiements
  for each row execute function public.n1_paiement_garde();

do $$
declare t text;
begin
  foreach t in array array['n1_paiements','n1_commissions'] loop
    execute format('drop trigger if exists trg_n1_05_verrou_cloture on public.%I', t);
    execute format('create trigger trg_n1_05_verrou_cloture before update or delete on public.%I
                    for each row execute function public.n1_verrou_cloture()', t);
    execute format('drop trigger if exists trg_n1_30_statut on public.%I', t);
    execute format('create trigger trg_n1_30_statut before update on public.%I
                    for each row execute function public.n1_pas_auto_approbation()', t);
    execute format('drop trigger if exists trg_n1_90_audit on public.%I', t);
    execute format('create trigger trg_n1_90_audit after insert or update or delete on public.%I
                    for each row execute function public.n1_audit_trigger()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.est_actif())', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (public.peut_editer_terrain() and created_by = public.n1_uid())', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using (public.n1_peut_controler()) with check (public.n1_peut_controler())', t||'_upd', t);
    execute format('revoke delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Calcul des commissions dues — depuis les achats, pas depuis une saisie
-- ---------------------------------------------------------------------------

create or replace function public.n1_calculer_commissions(p_cycle uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c public.n1_cycles%rowtype;
  v_kg numeric;
  v_taux numeric;
  v_com public.n1_commissions%rowtype;
begin
  if not public.n1_peut_controler() then
    raise exception 'Rôle insuffisant pour calculer les commissions'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_c from public.n1_cycles where id = p_cycle;
  if not found then raise exception 'Cycle introuvable'; end if;

  -- Le taux est un paramètre administré, jamais une constante du code.
  v_taux := public.n1_param_num_obligatoire('commission_rt_fcfa_kg', v_c.campagne, v_c.cluster, v_c.rt_id);

  select coalesce(sum(a.poids_net), 0) into v_kg
  from public.achats a
  where a.cycle_uid = p_cycle and coalesce(a.rejet, false) = false and a.n1_statut <> 'ANNULE';

  insert into public.n1_commissions(
    commission_code, campagne, cluster, rt_id, cycle_uid,
    base_kg, taux_fcfa_kg, montant_du, periode_debut, periode_fin)
  values (
    'COM-' || public.n1_code_court(v_c.campagne, 8, 'NA') || '-'
      || lpad(nextval('public.n1_seq_commission')::text, 6, '0'),
    v_c.campagne, v_c.cluster, v_c.rt_id, p_cycle,
    v_kg, v_taux, round(v_kg * v_taux),
    v_c.date_ouverture::date, current_date)
  -- L'index n1_comm_cycle_uidx est PARTIEL : ON CONFLICT ne peut le viser
  -- qu'en répétant son prédicat.
  on conflict (cycle_uid) where cycle_uid is not null do update
    set base_kg = excluded.base_kg, taux_fcfa_kg = excluded.taux_fcfa_kg,
        montant_du = excluded.montant_du, periode_fin = excluded.periode_fin
  returning * into v_com;

  perform public.n1_auditer('CREATION','n1_commissions',v_com.id::text, null, to_jsonb(v_com),
    'Calcul des commissions du cycle ' || v_c.cycle_code, 'ACCEPTE', null, null, null,
    v_c.campagne, v_c.cluster, v_c.rt_id);

  return to_jsonb(v_com);
end $$;

-- ---------------------------------------------------------------------------
-- 5) Réconciliation : deux dimensions supplémentaires
-- ---------------------------------------------------------------------------
-- On ne réécrit pas n1_reconcilier_cycle : on ajoute une fonction appelée en
-- complément, pour ne pas fragiliser un moteur déjà éprouvé par 24 cas de test.

create or replace function public.n1_recon_dimensions_financieres(
  p_cycle uuid, p_execution uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_c public.n1_cycles%rowtype;
  v_tol numeric;
  v_du numeric; v_paye numeric;
  v_achats numeric; v_regle numeric;
  v_n integer := 0;
begin
  select * into v_c from public.n1_cycles where id = p_cycle;
  if not found then return 0; end if;
  v_tol := coalesce(public.n1_param_num('tolerance_cash_fcfa', v_c.campagne, v_c.cluster, v_c.rt_id), 0);

  -- 5.1 Commissions dues contre commissions payées.
  select coalesce(montant_du, 0), coalesce(montant_paye, 0) into v_du, v_paye
  from public.n1_commissions where cycle_uid = p_cycle;

  if v_du is not null then
    insert into public.n1_reconciliation_lignes(
      cycle_uid, execution_uid, campagne, cluster, rt_id, dimension, unite,
      valeur_attendue, valeur_constatee, ecart, tolerance, cause, statut, criticite,
      responsable, preuve_requise)
    values (
      p_cycle, p_execution, v_c.campagne, v_c.cluster, v_c.rt_id, 'COMMISSIONS', 'FCFA',
      v_du, v_paye, v_paye - v_du, v_tol,
      case when abs(v_paye - v_du) <= v_tol then 'AUCUNE' else 'INCONNUE' end,
      case when v_paye = v_du then 'CONFORME'
           when abs(v_paye - v_du) <= v_tol then 'ECART_TOLERE'
           when v_paye < v_du then 'ECART_TOLERE'   -- reste dû : normal en cours de cycle
           else 'ECART' end,                         -- payé plus que dû : anormal
      case when v_paye > v_du then 'P0' else 'NA' end,
      v_c.ouvert_par, 'État de règlement des commissions signé');
    v_n := v_n + 1;
  end if;

  -- 5.2 Achats enregistrés contre paiements réellement décaissés.
  select coalesce(sum(a.montant), 0) into v_achats
  from public.achats a
  where a.cycle_uid = p_cycle and coalesce(a.rejet, false) = false and a.n1_statut <> 'ANNULE';
  select coalesce(sum(p.montant), 0) into v_regle
  from public.n1_paiements p
  where p.cycle_uid = p_cycle and p.n1_statut <> 'ANNULE'
    and p.beneficiaire_type = 'PRODUCTEUR';

  -- Tant qu'aucun paiement n'est enregistré, la dimension n'a pas de sens : on
  -- ne signale pas un écart de 100 % là où le module n'est simplement pas utilisé.
  if v_regle > 0 then
    insert into public.n1_reconciliation_lignes(
      cycle_uid, execution_uid, campagne, cluster, rt_id, dimension, unite,
      valeur_attendue, valeur_constatee, ecart, tolerance, cause, statut, criticite,
      responsable, preuve_requise)
    values (
      p_cycle, p_execution, v_c.campagne, v_c.cluster, v_c.rt_id, 'ACHATS_PAIEMENTS', 'FCFA',
      v_achats, v_regle, v_regle - v_achats, v_tol,
      case when abs(v_regle - v_achats) <= v_tol then 'AUCUNE' else 'INCONNUE' end,
      case when v_regle = v_achats then 'CONFORME'
           when abs(v_regle - v_achats) <= v_tol then 'ECART_TOLERE' else 'ECART' end,
      case when abs(v_regle - v_achats) <= v_tol then 'NA' else 'P0' end,
      v_c.ouvert_par, 'Relevé des paiements et reçus producteurs');
    v_n := v_n + 1;
  end if;

  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Détecteurs manquants du Lot F
-- ---------------------------------------------------------------------------
-- Trois types étaient déclarés dans la contrainte de n1_anomalies sans qu'aucune
-- règle ne puisse jamais les lever. Un type déclaré et jamais levé donne
-- l'illusion d'une couverture qui n'existe pas.

-- Abrège une clé d'idempotence dans un message : la clé complète n'a rien à
-- faire dans un libellé d'alerte lisible par tous.
create or replace function public.n1_cle_abregee(p text)
returns text language sql immutable as $$
  select left(coalesce(p,'-'), 12) || '…'
$$;

create or replace function public.n1_detecter_anomalies_complement()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_r record; v_tol numeric;
begin
  -- R6 · Numéros papier attribués mais jamais utilisés en fin de cycle.
  for v_r in
    select n.* from public.n1_papier_numeros n
    join public.n1_papier_series s on s.id = n.serie_id
    where n.statut = 'ATTRIBUE' and s.statut = 'ATTRIBUEE'
      and s.attribue_le < now() - (coalesce(public.n1_param_num('delai_retour_papier_jours'), 30) || ' days')::interval
  loop
    perform public.n1_lever_anomalie('PAPIER_NON_ATTRIBUE','P2',
      'Formulaire ' || v_r.numero_lisible || ' attribué depuis plus de '
        || coalesce(public.n1_param_num('delai_retour_papier_jours'), 30) || ' jours, ni utilisé ni restitué',
      'n1_papier_numeros', v_r.id::text, v_r.rt_id, v_r.cluster);
    v_n := v_n + 1;
  end loop;

  -- R7 · Écart village → cluster : ce qui est entré chez les RT d'un cluster
  -- contre ce qui est effectivement arrivé au cluster.
  for v_r in
    select s.cluster,
           sum(s.quantite) filter (where s.entite_type = 'RT') as chez_les_rt,
           coalesce(max(s.quantite) filter (where s.entite_type = 'CLUSTER'), 0) as au_cluster
    from public.n1_soldes s
    where s.article = 'RCN_KG' and s.cluster is not null
    group by s.cluster
  loop
    v_tol := coalesce(public.n1_param_num('tolerance_village_cluster_kg', null, v_r.cluster), 0);
    if abs(coalesce(v_r.chez_les_rt, 0)) > v_tol
       and coalesce(public.n1_param_num('controle_village_cluster_actif'), 0) = 1 then
      perform public.n1_lever_anomalie('ECART_VILLAGE_CLUSTER','P1',
        'Cluster ' || v_r.cluster || ' : ' || coalesce(v_r.chez_les_rt,0)
          || ' kg encore détenus par les RT, ' || v_r.au_cluster || ' kg au cluster',
        'n1_soldes', null, null, v_r.cluster, null,
        v_r.au_cluster, coalesce(v_r.chez_les_rt, 0));
      v_n := v_n + 1;
    end if;
  end loop;

  -- R8 · Paiement sans achat correspondant, ou achat sans aucun paiement
  -- au-delà du délai admis.
  for v_r in
    select a.id, a.achat_code, a.rt_id, a.cluster, a.cycle_uid, a.montant, a.date
    from public.achats a
    where a.mode_paiement in ('WAVE','VIREMENT')
      and a.date < current_date - coalesce(public.n1_param_num('delai_paiement_jours'), 7)::integer
      and not exists (select 1 from public.n1_paiements p where p.achat_id = a.id
                        and p.n1_statut <> 'ANNULE')
      and exists (select 1 from public.n1_paiements p2 where p2.cycle_uid = a.cycle_uid)
  loop
    perform public.n1_lever_anomalie('ACHAT_SANS_FINANCEMENT','P1',
      'Achat ' || v_r.achat_code || ' réglé par voie tracée mais sans paiement enregistré après '
        || coalesce(public.n1_param_num('delai_paiement_jours'), 7) || ' jours',
      'achats', v_r.id::text, v_r.rt_id, v_r.cluster, v_r.cycle_uid, v_r.montant, 0);
    v_n := v_n + 1;
  end loop;

  -- R9 · Commissions payées au-delà du dû.
  for v_r in
    select c.* from public.n1_commissions c where c.montant_paye > c.montant_du
  loop
    perform public.n1_lever_anomalie('DEPASSEMENT_PLAFOND','P0',
      'Commission ' || v_r.commission_code || ' : ' || v_r.montant_paye
        || ' FCFA payés pour ' || v_r.montant_du || ' FCFA dus',
      'n1_commissions', v_r.id::text, v_r.rt_id, v_r.cluster, v_r.cycle_uid,
      v_r.montant_du, v_r.montant_paye);
    v_n := v_n + 1;
  end loop;

  -- R10 · Opérations restées en attente de synchronisation côté serveur.
  for v_r in
    select o.* from public.n1_sync_operations o
    where o.resultat = 'EN_ATTENTE'
      and o.recu_le < now() - (coalesce(public.n1_param_num('seuil_sync_bloquee_heures'), 2) || ' hours')::interval
  loop
    perform public.n1_lever_anomalie('SYNCHRONISATION_TARDIVE','P1',
      'Opération ' || public.n1_cle_abregee(v_r.cle_idempotence) || ' reçue mais non traitée depuis plus de '
        || coalesce(public.n1_param_num('seuil_sync_bloquee_heures'), 2) || ' h',
      'n1_sync_operations', v_r.id::text, null, null);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('detections_complementaires', v_n);
end $$;


revoke all on function public.n1_calculer_commissions(uuid) from public;
grant execute on function public.n1_calculer_commissions(uuid) to authenticated;
grant execute on function public.n1_recon_dimensions_financieres(uuid,uuid) to authenticated;
grant execute on function public.n1_detecter_anomalies_complement() to authenticated;

commit;
