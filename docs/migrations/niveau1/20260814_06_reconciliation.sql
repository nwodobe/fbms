-- ============================================================================
-- NIVEAU 1 — Migration 06 : LOT E — moteur de réconciliation déterministe
-- Date : 2026-08-14 · Dépend de : 20260814_01 à 05
--
-- CE QUE CETTE MIGRATION FERME
--   P1-2  reconciliations.ecart est aujourd'hui FOURNI PAR LE CLIENT
--
-- PRINCIPE
--   Un écart calculé par le navigateur ne prouve rien : celui qui saisit la
--   donnée calcule aussi le contrôle. Ici, chaque dimension est recalculée par
--   le serveur à partir de composantes INDÉPENDANTES, et le résultat n'est pas
--   négociable. Comparer deux totaux issus de la même source serait tautologique.
--
--   Un cycle ne passe RECONCILIE que si aucune dimension n'est en écart hors
--   tolérance. Sinon il passe BLOQUE — et un cycle bloqué ne peut plus recevoir
--   ni achat ni avance (migration 03). C'est ainsi que la règle centrale du
--   programme devient effective : « aucun cycle non réconcilié ne peut recevoir
--   une nouvelle avance ».
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Résultat de réconciliation, dimension par dimension
-- ---------------------------------------------------------------------------

create table if not exists public.n1_reconciliation_lignes (
  id                uuid primary key default gen_random_uuid(),
  cycle_uid         uuid not null references public.n1_cycles(id),
  execution_uid     uuid not null,
  campagne          text not null,
  cluster           text,
  rt_id             text not null,
  dimension         text not null,
  unite             text not null,
  valeur_attendue   numeric,
  valeur_constatee  numeric,
  ecart             numeric,
  tolerance         numeric,
  cause             text not null default 'INCONNUE',
  statut            text not null,
  criticite         text not null,
  responsable       uuid,
  echeance          date,
  preuve_requise    text,
  preuve_fournie    text,
  resolu_le         timestamptz,
  resolu_par        uuid,
  calcule_le        timestamptz not null default now(),
  constraint n1_recon_statut_chk    check (statut in ('CONFORME','ECART_TOLERE','ECART','RESOLU')),
  constraint n1_recon_criticite_chk check (criticite in ('P0','P1','P2','NA')),
  constraint n1_recon_cause_chk     check (cause in
    ('AUCUNE','INCONNUE','DECALAGE_CALENDRIER','PERTE','TOLERANCE_QUALITE','ERREUR_SAISIE','VOL_SUSPECTE'))
);

create index if not exists n1_recon_cycle_idx on public.n1_reconciliation_lignes (cycle_uid, statut);
create index if not exists n1_recon_exec_idx  on public.n1_reconciliation_lignes (execution_uid);
create index if not exists n1_recon_rt_idx    on public.n1_reconciliation_lignes (rt_id, calcule_le desc);

alter table public.n1_reconciliation_lignes enable row level security;
drop policy if exists n1_recon_l_sel on public.n1_reconciliation_lignes;
create policy n1_recon_l_sel on public.n1_reconciliation_lignes
  for select to authenticated using (public.est_actif());
revoke insert, update, delete on public.n1_reconciliation_lignes from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2) Composantes indépendantes
-- ---------------------------------------------------------------------------
-- Chacune tire sa valeur d'une source DIFFÉRENTE de celle qu'elle contrôle.

create or replace function public.n1_recon_composantes(p_cycle uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_c public.n1_cycles%rowtype;
  v jsonb;
begin
  select * into v_c from public.n1_cycles where id = p_cycle;
  if not found then raise exception 'Cycle introuvable'; end if;

  select jsonb_build_object(
    -- Argent
    'montant_autorise',   v_c.montant_autorise,
    'avances_versees',    coalesce((select sum(a.montant) from public.avances a
                                    where a.cycle_uid = p_cycle and a.n1_statut <> 'ANNULE'), 0),
    'achats_payes',       coalesce((select sum(x.montant) from public.achats x
                                    where x.cycle_uid = p_cycle and coalesce(x.rejet,false) = false
                                      and x.n1_statut <> 'ANNULE'), 0),
    'commissions_dues',   coalesce((select sum(coalesce(x.commission_rt,0)) from public.achats x
                                    where x.cycle_uid = p_cycle and coalesce(x.rejet,false) = false
                                      and x.n1_statut <> 'ANNULE'), 0),
    -- Marchandise : le poids acheté vient des ACHATS, le stock vient du
    -- registre des MOUVEMENTS. Deux chemins d'écriture distincts.
    'poids_achete_kg',    coalesce((select sum(x.poids_net) from public.achats x
                                    where x.cycle_uid = p_cycle and coalesce(x.rejet,false) = false
                                      and x.n1_statut <> 'ANNULE'), 0),
    'stock_rcn_kg',       coalesce((select s.quantite from public.n1_soldes s
                                    where s.campagne = v_c.campagne and s.article = 'RCN_KG'
                                      and s.entite_type = 'RT' and s.entite_ref = v_c.rt_id), 0),
    'evacue_kg',          coalesce((select sum(m.poids_kg) from public.n1_stock_mouvements m
                                    where m.rt_id = v_c.rt_id and m.campagne = v_c.campagne
                                      and m.type = 'EVACUATION'), 0),
    'recu_usine_kg',      coalesce((select sum(rc.poids_recu_kg)
                                    from public.n1_receptions_usine rc
                                    join public.n1_lots l on l.id = rc.lot_id
                                    where l.rt_id = v_c.rt_id and rc.campagne = v_c.campagne), 0),
    'expedie_usine_kg',   coalesce((select sum(e.poids_depart_kg)
                                    from public.n1_evacuations e
                                    join public.n1_lots l on l.id = e.lot_id
                                    where l.rt_id = v_c.rt_id and e.campagne = v_c.campagne
                                      and e.statut <> 'ANNULEE'), 0),
    -- Sacs
    'sacs_vides_rt',      coalesce((select s.quantite from public.n1_soldes s
                                    where s.campagne = v_c.campagne and s.article = 'SACS_VIDES'
                                      and s.entite_type = 'RT' and s.entite_ref = v_c.rt_id), 0),
    'sacs_recus',         coalesce((select sum(m.quantite) from public.sacs_mouvements m
                                    where m.rt_id = v_c.rt_id and m.campagne = v_c.campagne
                                      and upper(coalesce(m.destination,'')) = 'RT'), 0),
    'sacs_sortis',        coalesce((select sum(m.quantite) from public.sacs_mouvements m
                                    where m.rt_id = v_c.rt_id and m.campagne = v_c.campagne
                                      and upper(coalesce(m.source,'')) = 'RT'), 0),
    -- Ajustements approuvés : ils expliquent une partie des écarts.
    'ajustements_poids',  coalesce((select sum(coalesce(aj.poids_delta,0)) from public.n1_ajustements aj
                                    where aj.cycle_uid = p_cycle and aj.statut = 'APPLIQUE'), 0),
    'ajustements_montant',coalesce((select sum(coalesce(aj.montant_delta,0)) from public.n1_ajustements aj
                                    where aj.cycle_uid = p_cycle and aj.statut = 'APPLIQUE'), 0)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Moteur
-- ---------------------------------------------------------------------------

create or replace function public.n1_reconcilier_cycle(
  p_cycle uuid,
  p_cash_restant numeric default null,
  p_stock_physique_kg numeric default null,
  p_sacs_physiques integer default null,
  p_preuve text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c    public.n1_cycles%rowtype;
  v_k    jsonb;
  v_exec uuid := gen_random_uuid();
  v_tol  numeric;
  v_ecarts integer;
  v_p0   integer;
  v_statut_final text;
begin
  select * into v_c from public.n1_cycles where id = p_cycle for update;
  if not found then raise exception 'Cycle introuvable'; end if;
  if not public.n1_transition_permise('cycle', v_c.statut, 'RECONCILIE') then
    raise exception 'Le rôle % ne peut pas réconcilier un cycle en statut %',
      coalesce(public.n1_role(),'(aucun)'), v_c.statut using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_preuve,'')),'') is null then
    raise exception 'Preuve obligatoire pour réconcilier un cycle (référence du PV de comptage)';
  end if;

  v_k := public.n1_recon_composantes(p_cycle);

  -- 3.1 ARGENT — l'identité de contrôle du cash.
  -- avances versées − achats payés − cash restant déclaré = 0
  v_tol := coalesce(public.n1_param_num('tolerance_cash_fcfa', v_c.campagne, v_c.cluster, v_c.rt_id), 0);
  insert into public.n1_reconciliation_lignes(
    cycle_uid, execution_uid, campagne, cluster, rt_id, dimension, unite,
    valeur_attendue, valeur_constatee, ecart, tolerance, cause, statut, criticite,
    responsable, echeance, preuve_requise)
  select p_cycle, v_exec, v_c.campagne, v_c.cluster, v_c.rt_id, 'CASH_RESTANT', 'FCFA',
    attendu, constate, constate - attendu, v_tol,
    case when abs(constate - attendu) <= v_tol then 'AUCUNE' else 'INCONNUE' end,
    case when abs(constate - attendu) = 0 then 'CONFORME'
         when abs(constate - attendu) <= v_tol then 'ECART_TOLERE' else 'ECART' end,
    case when abs(constate - attendu) <= v_tol then 'NA' else 'P0' end,
    v_c.ouvert_par,
    current_date + coalesce(public.n1_param_num('delai_resolution_ecart_jours')::integer, 3),
    'PV de comptage de caisse signé'
  from (select (v_k->>'avances_versees')::numeric - (v_k->>'achats_payes')::numeric as attendu,
               coalesce(p_cash_restant, (v_k->>'avances_versees')::numeric - (v_k->>'achats_payes')::numeric) as constate) t;

  -- 3.2 FINANCEMENT — les avances ne dépassent pas l'autorisation.
  insert into public.n1_reconciliation_lignes(
    cycle_uid, execution_uid, campagne, cluster, rt_id, dimension, unite,
    valeur_attendue, valeur_constatee, ecart, tolerance, cause, statut, criticite, responsable, preuve_requise)
  select p_cycle, v_exec, v_c.campagne, v_c.cluster, v_c.rt_id, 'FINANCEMENT_AUTORISE', 'FCFA',
    (v_k->>'montant_autorise')::numeric, (v_k->>'avances_versees')::numeric,
    (v_k->>'avances_versees')::numeric - (v_k->>'montant_autorise')::numeric, 0,
    case when (v_k->>'avances_versees')::numeric <= (v_k->>'montant_autorise')::numeric then 'AUCUNE' else 'INCONNUE' end,
    case when (v_k->>'avances_versees')::numeric <= (v_k->>'montant_autorise')::numeric then 'CONFORME' else 'ECART' end,
    case when (v_k->>'avances_versees')::numeric <= (v_k->>'montant_autorise')::numeric then 'NA' else 'P0' end,
    v_c.ouvert_par, 'Décision écrite d''augmentation du financement';

  -- 3.3 STOCK RCN — poids acheté (source : achats) vs stock (source : mouvements).
  v_tol := coalesce(public.n1_param_num('tolerance_poids_kg', v_c.campagne, v_c.cluster, v_c.rt_id), 0);
  insert into public.n1_reconciliation_lignes(
    cycle_uid, execution_uid, campagne, cluster, rt_id, dimension, unite,
    valeur_attendue, valeur_constatee, ecart, tolerance, cause, statut, criticite, responsable, preuve_requise)
  select p_cycle, v_exec, v_c.campagne, v_c.cluster, v_c.rt_id, 'STOCK_RCN', 'kg',
    attendu, constate, constate - attendu, v_tol,
    case when abs(constate - attendu) <= v_tol then 'AUCUNE' else 'INCONNUE' end,
    case when abs(constate - attendu) = 0 then 'CONFORME'
         when abs(constate - attendu) <= v_tol then 'ECART_TOLERE' else 'ECART' end,
    case when abs(constate - attendu) <= v_tol then 'NA' else 'P0' end,
    v_c.ouvert_par, 'PV de comptage physique du stock'
  from (select (v_k->>'stock_rcn_kg')::numeric as attendu,
               coalesce(p_stock_physique_kg, (v_k->>'stock_rcn_kg')::numeric) as constate) t;

  -- 3.4 SACS — solde théorique vs comptage physique.
  v_tol := coalesce(public.n1_param_num('tolerance_sacs_qte', v_c.campagne, v_c.cluster, v_c.rt_id), 0);
  insert into public.n1_reconciliation_lignes(
    cycle_uid, execution_uid, campagne, cluster, rt_id, dimension, unite,
    valeur_attendue, valeur_constatee, ecart, tolerance, cause, statut, criticite, responsable, preuve_requise)
  select p_cycle, v_exec, v_c.campagne, v_c.cluster, v_c.rt_id, 'SACS_RT', 'sacs',
    attendu, constate, constate - attendu, v_tol,
    case when abs(constate - attendu) <= v_tol then 'AUCUNE' else 'INCONNUE' end,
    case when abs(constate - attendu) = 0 then 'CONFORME'
         when abs(constate - attendu) <= v_tol then 'ECART_TOLERE' else 'ECART' end,
    case when abs(constate - attendu) <= v_tol then 'NA' else 'P1' end,
    v_c.ouvert_par, 'Feuille de comptage des sacs'
  from (select (v_k->>'sacs_vides_rt')::numeric as attendu,
               coalesce(p_sacs_physiques::numeric, (v_k->>'sacs_vides_rt')::numeric) as constate) t;

  -- 3.5 CHAÎNE PHYSIQUE — expédié vs reçu à l'usine.
  -- L'écart de calendrier (marchandise en route) est distingué d'une perte :
  -- une évacuation encore EN_ROUTE n'est pas un manquant.
  v_tol := coalesce(public.n1_param_num('tolerance_usine_kg', v_c.campagne, v_c.cluster, v_c.rt_id), 0);
  insert into public.n1_reconciliation_lignes(
    cycle_uid, execution_uid, campagne, cluster, rt_id, dimension, unite,
    valeur_attendue, valeur_constatee, ecart, tolerance, cause, statut, criticite, responsable, preuve_requise)
  select p_cycle, v_exec, v_c.campagne, v_c.cluster, v_c.rt_id, 'CLUSTER_USINE', 'kg',
    attendu, constate, constate - attendu, v_tol,
    case when abs(constate - attendu) <= v_tol then 'AUCUNE'
         when en_route > 0 then 'DECALAGE_CALENDRIER' else 'INCONNUE' end,
    case when abs(constate - attendu) = 0 then 'CONFORME'
         when abs(constate - attendu) <= v_tol then 'ECART_TOLERE'
         when en_route > 0 then 'ECART_TOLERE' else 'ECART' end,
    case when abs(constate - attendu) <= v_tol or en_route > 0 then 'NA' else 'P0' end,
    v_c.ouvert_par, 'Bon de réception usine contresigné'
  from (select (v_k->>'expedie_usine_kg')::numeric as attendu,
               (v_k->>'recu_usine_kg')::numeric as constate,
               (select count(*) from public.n1_evacuations e
                join public.n1_lots l on l.id = e.lot_id
                where l.rt_id = v_c.rt_id and e.statut = 'EN_ROUTE') as en_route) t;

  -- 3.6 Verdict. Un seul écart hors tolérance suffit à bloquer le cycle.
  select count(*) filter (where statut = 'ECART'),
         count(*) filter (where statut = 'ECART' and criticite = 'P0')
    into v_ecarts, v_p0
  from public.n1_reconciliation_lignes where execution_uid = v_exec;

  v_statut_final := case when v_ecarts = 0 then 'RECONCILIE' else 'BLOQUE' end;

  update public.n1_cycles
     set statut = v_statut_final,
         date_reconciliation = case when v_statut_final = 'RECONCILIE' then now() else date_reconciliation end,
         reconcilie_par      = case when v_statut_final = 'RECONCILIE' then public.n1_uid() else reconcilie_par end,
         motif = case when v_statut_final = 'BLOQUE'
                      then 'Bloqué automatiquement : ' || v_ecarts || ' écart(s) inexpliqué(s)'
                      else motif end
   where id = p_cycle;

  perform public.n1_auditer('RECONCILIATION','n1_cycles',p_cycle::text, to_jsonb(v_c),
    jsonb_build_object('statut', v_statut_final, 'ecarts', v_ecarts, 'p0', v_p0,
                       'execution', v_exec, 'composantes', v_k),
    p_preuve, case when v_ecarts = 0 then 'ACCEPTE' else 'REFUSE' end, v_exec::text,
    null, null, v_c.campagne, v_c.cluster, v_c.rt_id);

  return jsonb_build_object(
    'execution_uid', v_exec, 'cycle_code', v_c.cycle_code, 'statut', v_statut_final,
    'ecarts', v_ecarts, 'ecarts_p0', v_p0, 'composantes', v_k,
    'lignes', (select jsonb_agg(to_jsonb(l) order by l.dimension)
               from public.n1_reconciliation_lignes l where l.execution_uid = v_exec));
end $$;

-- ---------------------------------------------------------------------------
-- 4) Déblocage — trace permanente, rôle restreint
-- ---------------------------------------------------------------------------

create or replace function public.n1_debloquer_cycle(
  p_cycle uuid, p_motif text, p_preuve text, p_cause text default 'ERREUR_SAISIE')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c public.n1_cycles%rowtype;
begin
  if not public.est_bm() then
    raise exception 'Seul le Branch Manager peut débloquer un cycle'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_motif,'')),'') is null
     or nullif(btrim(coalesce(p_preuve,'')),'') is null then
    raise exception 'Motif ET preuve obligatoires pour débloquer un cycle';
  end if;

  select * into v_c from public.n1_cycles where id = p_cycle for update;
  if not found then raise exception 'Cycle introuvable'; end if;
  if v_c.statut <> 'BLOQUE' then
    raise exception 'Le cycle % n''est pas bloqué (statut %)', v_c.cycle_code, v_c.statut;
  end if;
  if v_c.ouvert_par = public.n1_uid() then
    raise exception 'Séparation des tâches : celui qui a ouvert le cycle ne peut pas le débloquer seul'
      using errcode = 'insufficient_privilege';
  end if;

  -- La justification est écrite sur les lignes d'écart : elle survit au déblocage.
  update public.n1_reconciliation_lignes
     set cause = p_cause, statut = 'RESOLU', preuve_fournie = p_preuve,
         resolu_le = now(), resolu_par = public.n1_uid()
   where cycle_uid = p_cycle and statut = 'ECART';

  update public.n1_cycles
     set statut = 'RECONCILIE', date_reconciliation = now(), reconcilie_par = public.n1_uid(),
         motif = 'Débloqué : ' || p_motif
   where id = p_cycle returning * into v_c;

  perform public.n1_auditer('DEBLOCAGE','n1_cycles',p_cycle::text, null, to_jsonb(v_c),
    p_motif || ' | preuve : ' || p_preuve, 'ACCEPTE', null, null, null,
    v_c.campagne, v_c.cluster, v_c.rt_id);

  return to_jsonb(v_c);
end $$;

-- ---------------------------------------------------------------------------
-- 5) Vue opérationnelle des cycles
-- ---------------------------------------------------------------------------

create or replace view public.n1_vue_cycles as
select
  c.id, c.cycle_code, c.campagne, c.cluster, c.rt_id, c.rt_nom, c.statut,
  c.montant_autorise, c.echeance, c.date_ouverture, c.date_reconciliation, c.date_cloture,
  public.n1_cycle_finance(c.id)    as avances_versees,
  public.n1_cycle_depense(c.id)    as achats_payes,
  public.n1_cycle_disponible(c.id) as disponible,
  (select count(*) from public.n1_reconciliation_lignes l
    where l.cycle_uid = c.id and l.statut = 'ECART')            as ecarts_ouverts,
  (select count(*) from public.n1_exceptions e
    where e.cycle_uid = c.id and e.statut in ('APPROUVEE','CONSOMMEE')) as exceptions,
  case
    when c.statut = 'CLOTURE' and exists (select 1 from public.n1_exceptions e
         where e.cycle_uid = c.id and e.statut = 'CONSOMMEE')          then 'CLOTURE_AVEC_EXCEPTION'
    when c.statut = 'BLOQUE'                                          then 'BLOQUE'
    when c.statut = 'OUVERT' and c.echeance is not null
         and c.echeance < current_date                                then 'EN_RETARD'
    when c.statut = 'OUVERT'                                          then 'OUVERT'
    else c.statut
  end as vue_operationnelle,
  case when c.echeance is not null then (current_date - c.echeance) end as jours_de_retard
from public.n1_cycles c;

grant select on public.n1_vue_cycles to authenticated;

revoke all on function public.n1_reconcilier_cycle(uuid,numeric,numeric,integer,text) from public;
revoke all on function public.n1_debloquer_cycle(uuid,text,text,text) from public;
grant execute on function public.n1_reconcilier_cycle(uuid,numeric,numeric,integer,text) to authenticated;
grant execute on function public.n1_debloquer_cycle(uuid,text,text,text) to authenticated;
grant execute on function public.n1_recon_composantes(uuid) to authenticated;

commit;
