-- ============================================================================
-- NIVEAU 1 — Migration 07 : LOT F — moteur d'alertes déterministe
-- Date : 2026-08-14 · Dépend de : 20260814_01 à 06
--
-- Moteur de RÈGLES EXPLICITES, pas de modèle prédictif : chaque alerte est
-- reproductible et opposable. Un score statistique ne serait ni l'un ni l'autre.
--
-- IDEMPOTENCE ET REGROUPEMENT
--   Une anomalie est identifiée par une empreinte (type + entité concernée).
--   Tant qu'elle reste OUVERTE, une nouvelle détection incrémente son compteur
--   d'occurrences au lieu de créer un doublon. Un index unique partiel rend le
--   doublon impossible, y compris en cas de détections concurrentes.
-- ============================================================================

begin;

create table if not exists public.n1_anomalies (
  id             uuid primary key default gen_random_uuid(),
  anomalie_code  text not null unique,
  empreinte      text not null,
  type_anomalie  text not null,
  criticite      text not null,
  campagne       text,
  cluster        text,
  rt_id          text,
  ressource      text,
  enregistrement text,
  cycle_uid      uuid references public.n1_cycles(id),
  description    text not null,
  valeur_attendue numeric,
  valeur_constatee numeric,
  ecart          numeric,
  statut         text not null default 'OUVERTE',
  responsable    uuid,
  echeance       date,
  occurrences    integer not null default 1,
  premiere_le    timestamptz not null default now(),
  derniere_le    timestamptz not null default now(),
  resolution     text,
  preuve_resolution text,
  resolu_par     uuid,
  resolu_le      timestamptz,
  constraint n1_anom_statut_chk check (statut in ('OUVERTE','EN_COURS','RESOLUE','REJETEE')),
  constraint n1_anom_crit_chk   check (criticite in ('P0','P1','P2')),
  constraint n1_anom_type_chk   check (type_anomalie in (
    'RECU_DUPLIQUE','ACHAT_SANS_FINANCEMENT','ACHAT_SUPERIEUR_SOLDE','AVANCE_CYCLE_NON_RECONCILIE',
    'SOLDE_SACS_NEGATIF','STOCK_RCN_NEGATIF','ECART_CASH','ECART_STOCK','ECART_SACS',
    'CYCLE_NON_CLOTURE_DELAI','TRANSACTION_AVANT_FINANCEMENT','SYNCHRONISATION_TARDIVE',
    'MODIFICATION_APRES_CLOTURE','TENTATIVE_AUTO_APPROBATION','DEPASSEMENT_PLAFOND',
    'RECEPTION_SANS_EVACUATION','ECART_VILLAGE_CLUSTER','ECART_CLUSTER_USINE',
    'PAPIER_MANQUANT','PAPIER_DUPLIQUE','PAPIER_NON_ATTRIBUE')),
  -- Une résolution sans preuve n'est pas une résolution.
  constraint n1_anom_resolution_chk check (
    statut <> 'RESOLUE' or (nullif(btrim(coalesce(resolution,'')),'') is not null
                            and nullif(btrim(coalesce(preuve_resolution,'')),'') is not null))
);

create sequence if not exists public.n1_seq_anomalie start 1;

-- LA garantie anti-doublon : une seule anomalie vivante par empreinte.
create unique index if not exists n1_anom_empreinte_uidx
  on public.n1_anomalies (empreinte) where statut in ('OUVERTE','EN_COURS');

create index if not exists n1_anom_crit_idx on public.n1_anomalies (criticite, statut, derniere_le desc);
create index if not exists n1_anom_rt_idx   on public.n1_anomalies (rt_id, statut);

create table if not exists public.n1_anomalies_historique (
  id           bigserial primary key,
  anomalie_id  uuid not null references public.n1_anomalies(id),
  ts_serveur   timestamptz not null default now(),
  utilisateur  uuid,
  ancien_statut text,
  nouveau_statut text,
  commentaire  text
);

-- ---------------------------------------------------------------------------
-- Levée d'anomalie — idempotente par construction
-- ---------------------------------------------------------------------------

create or replace function public.n1_lever_anomalie(
  p_type text, p_criticite text, p_description text,
  p_ressource text default null, p_enregistrement text default null,
  p_rt text default null, p_cluster text default null, p_cycle uuid default null,
  p_attendu numeric default null, p_constate numeric default null,
  p_responsable uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_empreinte text;
  v_id uuid;
  v_delai integer;
begin
  -- L'empreinte détermine ce qui est « le même problème ». Deux détections du
  -- même reçu dupliqué doivent se rejoindre ; deux reçus différents non.
  v_empreinte := upper(p_type) || '|' || coalesce(p_ressource,'-') || '|'
              || coalesce(p_enregistrement,'-') || '|' || coalesce(p_rt,'-')
              || '|' || coalesce(p_cycle::text,'-');

  select id into v_id from public.n1_anomalies
  where empreinte = v_empreinte and statut in ('OUVERTE','EN_COURS') for update;

  if found then
    update public.n1_anomalies
       set occurrences = occurrences + 1, derniere_le = now(),
           valeur_constatee = coalesce(p_constate, valeur_constatee),
           ecart = coalesce(p_constate, valeur_constatee) - coalesce(p_attendu, valeur_attendue)
     where id = v_id;
    return v_id;
  end if;

  v_delai := coalesce(public.n1_param_num('delai_resolution_' || lower(p_criticite) || '_jours')::integer,
                      case upper(p_criticite) when 'P0' then 1 when 'P1' then 7 else 30 end);

  insert into public.n1_anomalies(
    anomalie_code, empreinte, type_anomalie, criticite, campagne, cluster, rt_id,
    ressource, enregistrement, cycle_uid, description,
    valeur_attendue, valeur_constatee, ecart, statut, responsable, echeance)
  values (
    'ANO-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.n1_seq_anomalie')::text, 6, '0'),
    v_empreinte, upper(p_type), upper(p_criticite),
    public.n1_param_txt('campagne_active'), p_cluster, p_rt,
    p_ressource, p_enregistrement, p_cycle, p_description,
    p_attendu, p_constate, p_constate - p_attendu, 'OUVERTE',
    p_responsable, current_date + v_delai)
  returning id into v_id;

  insert into public.n1_anomalies_historique(anomalie_id, utilisateur, nouveau_statut, commentaire)
  values (v_id, public.n1_uid(), 'OUVERTE', p_description);

  perform public.n1_auditer('ALERTE', coalesce(p_ressource,'n1_anomalies'), p_enregistrement,
    null, jsonb_build_object('type', p_type, 'criticite', p_criticite, 'description', p_description),
    null, 'ACCEPTE', null, null, null, null, p_cluster, p_rt);

  return v_id;
exception
  when unique_violation then
    -- Détection concurrente : l'autre transaction a créé l'anomalie. On la rejoint.
    select id into v_id from public.n1_anomalies
    where empreinte = v_empreinte and statut in ('OUVERTE','EN_COURS') limit 1;
    return v_id;
end $$;

create or replace function public.n1_resoudre_anomalie(
  p_anomalie uuid, p_resolution text, p_preuve text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_a public.n1_anomalies%rowtype;
begin
  if not public.n1_peut_controler() then
    raise exception 'Rôle insuffisant pour résoudre une anomalie'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_resolution,'')),'') is null
     or nullif(btrim(coalesce(p_preuve,'')),'') is null then
    raise exception 'Résolution ET preuve obligatoires';
  end if;

  select * into v_a from public.n1_anomalies where id = p_anomalie for update;
  if not found then raise exception 'Anomalie introuvable'; end if;
  if v_a.statut = 'RESOLUE' then raise exception 'Anomalie déjà résolue'; end if;
  -- Une anomalie P0 n'est jamais close par la personne qui en est responsable.
  if v_a.criticite = 'P0' and v_a.responsable is not null and v_a.responsable = public.n1_uid() then
    raise exception 'Séparation des tâches : le responsable d''une anomalie P0 ne la clôt pas lui-même'
      using errcode = 'insufficient_privilege';
  end if;

  update public.n1_anomalies
     set statut = 'RESOLUE', resolution = p_resolution, preuve_resolution = p_preuve,
         resolu_par = public.n1_uid(), resolu_le = now()
   where id = p_anomalie returning * into v_a;

  insert into public.n1_anomalies_historique(anomalie_id, utilisateur, ancien_statut, nouveau_statut, commentaire)
  values (p_anomalie, public.n1_uid(), 'OUVERTE', 'RESOLUE', p_resolution || ' | preuve : ' || p_preuve);

  perform public.n1_auditer('APPROBATION','n1_anomalies',p_anomalie::text, null, to_jsonb(v_a),
    p_resolution, 'ACCEPTE');
  return to_jsonb(v_a);
end $$;

-- ---------------------------------------------------------------------------
-- Règles de détection par lot
-- ---------------------------------------------------------------------------
-- Complète les détections faites en temps réel par les triggers des migrations
-- 03 à 06. Elle porte sur ce qui ne se voit qu'à froid : retards, écarts de
-- bout en bout, synchronisations tardives.

create or replace function public.n1_detecter_anomalies()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  v_r record;
  v_seuil numeric;
begin
  -- R1 · Cycle dépassant son échéance sans clôture.
  for v_r in
    select c.* from public.n1_cycles c
    where c.statut in ('OUVERT','BLOQUE') and c.echeance is not null and c.echeance < current_date
  loop
    perform public.n1_lever_anomalie('CYCLE_NON_CLOTURE_DELAI',
      case when current_date - v_r.echeance > 7 then 'P0' else 'P1' end,
      'Cycle ' || v_r.cycle_code || ' non clôturé, ' || (current_date - v_r.echeance) || ' jour(s) de retard',
      'n1_cycles', v_r.id::text, v_r.rt_id, v_r.cluster, v_r.id,
      0, (current_date - v_r.echeance), v_r.ouvert_par);
    v_n := v_n + 1;
  end loop;

  -- R2 · Achat antérieur à l'ouverture du financement.
  for v_r in
    select a.id, a.achat_code, a.rt_id, a.cluster, a.cycle_uid, a.date, c.date_ouverture, c.cycle_code
    from public.achats a join public.n1_cycles c on c.id = a.cycle_uid
    where a.date < c.date_ouverture::date
  loop
    perform public.n1_lever_anomalie('TRANSACTION_AVANT_FINANCEMENT','P0',
      'Achat ' || v_r.achat_code || ' daté du ' || v_r.date
        || ', antérieur à l''ouverture du cycle ' || v_r.cycle_code,
      'achats', v_r.id::text, v_r.rt_id, v_r.cluster, v_r.cycle_uid);
    v_n := v_n + 1;
  end loop;

  -- R3 · Synchronisation anormalement tardive.
  v_seuil := coalesce(public.n1_param_num('seuil_synchronisation_heures'), 48);
  for v_r in
    select a.id, a.achat_code, a.rt_id, a.cluster, a.cycle_uid,
           extract(epoch from (a.serveur_recu_le - a.created_at)) / 3600 as heures
    from public.achats a
    where a.created_at is not null
      and a.serveur_recu_le - a.created_at > (v_seuil || ' hours')::interval
  loop
    perform public.n1_lever_anomalie('SYNCHRONISATION_TARDIVE','P1',
      'Achat ' || v_r.achat_code || ' synchronisé ' || round(v_r.heures) || ' h après sa saisie',
      'achats', v_r.id::text, v_r.rt_id, v_r.cluster, v_r.cycle_uid, v_seuil, round(v_r.heures));
    v_n := v_n + 1;
  end loop;

  -- R4 · Écart cluster → usine hors tolérance sur les évacuations reçues.
  for v_r in
    select e.id, e.evacuation_code, e.cluster, l.rt_id, e.poids_depart_kg,
           rc.poids_recu_kg, rc.ecart_kg
    from public.n1_evacuations e
    join public.n1_lots l on l.id = e.lot_id
    join public.n1_receptions_usine rc on rc.evacuation_id = e.id
    where abs(coalesce(rc.ecart_kg,0)) >
          coalesce(public.n1_param_num('tolerance_usine_kg', null, e.cluster), 0)
  loop
    perform public.n1_lever_anomalie('ECART_CLUSTER_USINE',
      case when abs(v_r.ecart_kg) > coalesce(public.n1_param_num('seuil_ecart_usine_grave_kg'), 100)
           then 'P0' else 'P1' end,
      'Évacuation ' || v_r.evacuation_code || ' : ' || v_r.poids_depart_kg
        || ' kg expédiés, ' || v_r.poids_recu_kg || ' kg reçus',
      'n1_evacuations', v_r.id::text, v_r.rt_id, v_r.cluster, null,
      v_r.poids_depart_kg, v_r.poids_recu_kg);
    v_n := v_n + 1;
  end loop;

  -- R5 · Écarts de réconciliation encore ouverts au-delà de leur échéance.
  for v_r in
    select l.* from public.n1_reconciliation_lignes l
    where l.statut = 'ECART' and l.echeance is not null and l.echeance < current_date
  loop
    perform public.n1_lever_anomalie(
      case v_r.dimension when 'CASH_RESTANT' then 'ECART_CASH'
                         when 'STOCK_RCN' then 'ECART_STOCK'
                         when 'SACS_RT' then 'ECART_SACS'
                         else 'ECART_CLUSTER_USINE' end,
      'P0',
      'Écart ' || v_r.dimension || ' de ' || v_r.ecart || ' ' || v_r.unite
        || ' non résolu à l''échéance du ' || v_r.echeance,
      'n1_reconciliation_lignes', v_r.id::text, v_r.rt_id, v_r.cluster, v_r.cycle_uid,
      v_r.valeur_attendue, v_r.valeur_constatee, v_r.responsable);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('detections', v_n,
    'ouvertes', (select count(*) from public.n1_anomalies where statut in ('OUVERTE','EN_COURS')),
    'p0_ouvertes', (select count(*) from public.n1_anomalies where statut in ('OUVERTE','EN_COURS') and criticite = 'P0'));
end $$;

-- ---------------------------------------------------------------------------
-- Détection en temps réel des tentatives interdites
-- ---------------------------------------------------------------------------
-- Une tentative refusée est annulée avec sa transaction ; l'anomalie doit donc
-- être levée depuis une transaction distincte, à l'appel du client, comme pour
-- n1_journaliser_refus (voir migration 01, limite structurelle A-01).

create or replace function public.n1_signaler_tentative(
  p_type text, p_description text, p_ressource text default null,
  p_enregistrement text default null, p_rt text default null, p_cluster text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if public.n1_uid() is null then
    raise exception 'Signalement refusé hors session authentifiée';
  end if;
  return public.n1_lever_anomalie(p_type, 'P0', p_description, p_ressource, p_enregistrement,
                                  p_rt, p_cluster);
end $$;

alter table public.n1_anomalies enable row level security;
alter table public.n1_anomalies_historique enable row level security;
drop policy if exists n1_anom_sel on public.n1_anomalies;
drop policy if exists n1_anom_h_sel on public.n1_anomalies_historique;
create policy n1_anom_sel on public.n1_anomalies for select to authenticated using (public.est_actif());
create policy n1_anom_h_sel on public.n1_anomalies_historique for select to authenticated using (public.est_actif());
revoke insert, update, delete on public.n1_anomalies from authenticated, anon;
revoke insert, update, delete on public.n1_anomalies_historique from authenticated, anon;

create or replace view public.n1_vue_anomalies as
select a.anomalie_code, a.type_anomalie, a.criticite, a.statut, a.rt_id, a.cluster,
       a.description, a.ecart, a.occurrences, a.premiere_le, a.derniere_le,
       a.echeance, (current_date - a.echeance) as jours_de_retard,
       p.nom as responsable_nom, a.resolution, a.preuve_resolution
from public.n1_anomalies a
left join public.profils p on p.user_id = a.responsable;
grant select on public.n1_vue_anomalies to authenticated;

revoke all on function public.n1_lever_anomalie(text,text,text,text,text,text,text,uuid,numeric,numeric,uuid) from public;
grant execute on function public.n1_detecter_anomalies() to authenticated;
grant execute on function public.n1_resoudre_anomalie(uuid,text,text) to authenticated;
grant execute on function public.n1_signaler_tentative(text,text,text,text,text,text) to authenticated;

commit;
