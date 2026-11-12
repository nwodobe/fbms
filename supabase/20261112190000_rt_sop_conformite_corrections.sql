-- AFLP 2027 · SOP RT · Phase 4 : corrections confirmées par l'audit contradictoire du 12/11/2026
-- Option C : renforce les registres de la PR #311 (rt_sop_*) et les tables existantes.
-- Aucune seconde source de vérité, aucun nouveau module sacherie, aucune donnée modifiée.
-- VERSION POUR REVUE/STAGING. Ne jamais appliquer automatiquement en production.
-- Retour arrière : supabase/rollback/20261112190000_rt_sop_conformite_corrections_down.sql
--
-- Défauts corrigés (preuves : tests/replica-prod/, rapport docs/rt_sop_2027_audit_contradictoire.md)
--  D1  Verrou BEV contournable : field_shipments créée en DRAFT puis passée DISPATCHED par UPDATE.
--  D2  GRN annulé (statut production « ANNULE ») considéré comme officiel.
--  D3  Pas de retrait espèces / dépôt / ajustement / comptage : S3 impossible.
--  D4  Achats en attente et disponible non exposés : S1 non lisible.
--  D5  Restitution plafonnée sans tenir compte des achats en attente (sur-restitution possible).
--  D6  Ordre des décisions UH non déterministe (deux décisions dans la même transaction).
--  D7  Avance SOP modifiable ensuite dans « avances » (montant, RT) par les rôles de configuration.
--  D8  Le BM peut demander puis attester lui-même la réception RT (séparation des tâches).
--  D9  BEV accepté au-delà du stock acheté par le RT (stock négatif).
--  D10 Désaccord ou réserve RT sans anomalie ouverte (S8).
--  D11 Pas de carte de garde RCN par RT, pas d'historique sacherie RT, pas de tableau BM.
--  D12 Pas de contrôle ZH tracé, pas de suspension ciblée liée à une anomalie.
begin;

-- ---------------------------------------------------------------------------
-- 0. Rôles Finance réellement autorisés par profils_role_check en production
-- ---------------------------------------------------------------------------
create or replace function private.rt_sop_finance_roles() returns text[]
language sql immutable as $$ select array['Finance','Finance Manager'] $$;
revoke all on function private.rt_sop_finance_roles() from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 1. D6 · ordre déterministe des décisions UH
-- ---------------------------------------------------------------------------
alter table public.rt_sop_purchase_reviews add column review_seq bigint generated always as identity;
create unique index rt_sop_reviews_seq on public.rt_sop_purchase_reviews(review_seq);
create index rt_sop_reviews_latest_seq on public.rt_sop_purchase_reviews(achat_id, review_seq desc);

-- État unique de chaque achat RT au sens du SOP (source : achats + dernière décision UH).
create or replace view public.rt_sop_purchase_state_v with (security_invoker=true) as
select a.id as achat_id, a.campaign_id, a.rt_id, a.date, a.montant, a.poids_net,
  a.numero_recu, coalesce(a.recu_photo_url, a.recu_photo) as recu_preuve,
  case when upper(coalesce(a.mode_paiement,'')) like '%WAVE%' then 'WAVE'
       when upper(coalesce(a.mode_paiement,'')) ~ '(ESP|CASH|LIQUID)' then 'ESPECES'
       else 'NON_PRECISE' end as mode_paiement_sop,
  coalesce(a.rejet,false) as annule,
  r.decision as derniere_decision_uh, r.reviewed_by, r.reviewed_at, r.reason as motif_uh,
  case when coalesce(a.rejet,false) then 'ANNULE'
       when r.decision = 'APPROVED' then 'VALIDE_UH'
       when r.decision = 'REJECTED' then 'REJETE_UH'
       else 'EN_ATTENTE' end as etat_sop,
  (nullif(btrim(coalesce(a.numero_recu,'')),'') is null
     or nullif(btrim(coalesce(a.recu_photo_url, a.recu_photo,'')),'') is null) as preuve_incomplete,
  round(extract(epoch from (now() - coalesce(a.created_at, a.date::timestamptz)))/3600.0, 1) as age_heures
from public.achats a
left join lateral (
  select x.decision, x.reviewed_by, x.reviewed_at, x.reason
  from public.rt_sop_purchase_reviews x where x.achat_id = a.id
  order by x.review_seq desc limit 1) r on true
where a.rt_id is not null and a.campaign_id is not null;

-- ---------------------------------------------------------------------------
-- 2. D3 · mouvements de liquidité RT (append-only), sans effet sur le solde à justifier
-- ---------------------------------------------------------------------------
create table public.rt_sop_cash_events (
 id uuid primary key default gen_random_uuid(),
 event_seq bigint generated always as identity unique,
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 event_type text not null check (event_type in ('WITHDRAWAL','DEPOSIT','ADJUSTMENT','CASH_COUNT')),
 amount_fcfa numeric(16,2) not null,
 reference text,
 evidence_path text not null,
 reason text,
 recorded_by uuid not null references auth.users(id),
 recorded_role text not null,
 recorded_at timestamptz not null default now(),
 idempotency_key uuid not null unique,
 check ((event_type in ('WITHDRAWAL','DEPOSIT') and amount_fcfa > 0)
     or (event_type = 'ADJUSTMENT' and amount_fcfa <> 0 and length(btrim(coalesce(reason,''))) >= 10)
     or (event_type = 'CASH_COUNT' and amount_fcfa >= 0))
);
create unique index rt_sop_cash_events_ref on public.rt_sop_cash_events(event_type, reference) where reference is not null;
create index rt_sop_cash_events_rt on public.rt_sop_cash_events(rt_id, campaign_id, event_seq desc);
alter table public.rt_sop_cash_events enable row level security;
create policy rt_sop_cash_events_read on public.rt_sop_cash_events for select to authenticated
 using (private.rt_sop_can_read_rt(rt_id));
revoke all on public.rt_sop_cash_events from public, anon, authenticated;
grant select on public.rt_sop_cash_events to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Suspensions ciblées et liens d'anomalies (réutilise aflp_incidents)
-- ---------------------------------------------------------------------------
create table public.rt_sop_incident_links (
 incident_id text primary key references public.aflp_incidents(id),
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 domain text not null check (domain in ('FINANCEMENT','ACHATS','STOCK_RCN','SACHERIE','QUALITE','TRANSPORT','SIGNATURE')),
 source_type text, source_id text,
 opened_by uuid not null references auth.users(id),
 opened_role text not null,
 decision text, decided_by uuid references auth.users(id), decided_at timestamptz,
 idempotency_key uuid not null unique
);
create index rt_sop_incident_links_rt on public.rt_sop_incident_links(rt_id, campaign_id);
create table public.rt_sop_suspensions (
 id uuid primary key default gen_random_uuid(),
 incident_id text not null references public.rt_sop_incident_links(incident_id),
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 scope text not null check (scope in ('ACHATS','BEV','FINANCEMENT')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 lifted_by uuid references auth.users(id), lifted_at timestamptz,
 unique (incident_id, scope)
);
create index rt_sop_suspensions_active on public.rt_sop_suspensions(rt_id, campaign_id, scope) where lifted_at is null;
create table public.rt_sop_zh_controls (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id),
 rt_id text not null references public.rt(id),
 control_type text not null check (control_type in ('DOCUMENTAIRE','PHYSIQUE')),
 result text not null check (result in ('CONFORME','ECART')),
 observations text not null check (length(btrim(observations)) >= 10),
 evidence_path text not null,
 incident_id text references public.aflp_incidents(id),
 controlled_by uuid not null references auth.users(id),
 controlled_at timestamptz not null default now(),
 idempotency_key uuid not null unique
);
create index rt_sop_zh_controls_rt on public.rt_sop_zh_controls(rt_id, campaign_id, controlled_at desc);
alter table public.rt_sop_incident_links enable row level security;
alter table public.rt_sop_suspensions enable row level security;
alter table public.rt_sop_zh_controls enable row level security;
create policy rt_sop_incident_links_read on public.rt_sop_incident_links for select to authenticated using (private.rt_sop_can_read_rt(rt_id));
create policy rt_sop_suspensions_read on public.rt_sop_suspensions for select to authenticated using (private.rt_sop_can_read_rt(rt_id));
create policy rt_sop_zh_controls_read on public.rt_sop_zh_controls for select to authenticated using (private.rt_sop_can_read_rt(rt_id));
revoke all on public.rt_sop_incident_links, public.rt_sop_suspensions, public.rt_sop_zh_controls from public, anon, authenticated;
grant select on public.rt_sop_incident_links, public.rt_sop_suspensions, public.rt_sop_zh_controls to authenticated;

create or replace function private.rt_sop_assert_not_suspended(p_campaign_id uuid, p_rt_id text, p_scope text)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_inc text;
begin
 select incident_id into v_inc from public.rt_sop_suspensions
  where campaign_id=p_campaign_id and rt_id=p_rt_id and scope=p_scope and lifted_at is null limit 1;
 if v_inc is not null then
   raise exception 'Mouvement % suspendu pour ce RT par l''anomalie % : décision autorisée requise', p_scope, v_inc using errcode='42501';
 end if;
end $$;
revoke all on function private.rt_sop_assert_not_suspended(uuid,text,text) from public,anon,authenticated;

-- Ouverture d'anomalie : interne (appel depuis RPC) puis publique.
create or replace function private.rt_sop_open_incident_core(
 p_campaign_id uuid, p_rt_id text, p_domain text, p_severity text, p_description text,
 p_responsible text, p_immediate_action text, p_evidence text, p_source_type text, p_source_id text, p_key uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id text; r public.rt%rowtype; v_type text; v_cat text;
begin
 select incident_id into v_id from public.rt_sop_incident_links where idempotency_key=p_key;
 if found then return v_id; end if;
 select * into r from public.rt where id=p_rt_id;
 v_type := case p_domain when 'QUALITE' then 'QUALITE_LITIGIEUSE' when 'TRANSPORT' then 'PROBLEME_TRANSPORT'
                         when 'STOCK_RCN' then 'PERTE_STOCK' when 'SACHERIE' then 'MANQUE_SACS' else 'AUTRE' end;
 v_cat := case when p_domain in ('FINANCEMENT','ACHATS','SIGNATURE') then 'FINANCIER'
               when p_domain = 'QUALITE' then 'QUALITE' else 'OPERATIONNEL' end;
 insert into public.aflp_incidents(campaign, campaign_id, cluster_code, village_id, rt_id, incident_type, risk_category,
   description, severity, immediate_action, responsible_person, status, evidence_available, evidence_ref,
   reported_by, reported_by_name)
 select c.code, c.id, upper(r.cluster), r.village_id, r.id, v_type, v_cat,
   '[SOP RT '||p_domain||'] '||p_description, p_severity, p_immediate_action,
   coalesce(nullif(btrim(p_responsible),''),'Chef de Zone'), 'OUVERT',
   p_evidence is not null, p_evidence, auth.uid(),
   (select nom from public.profils where user_id=auth.uid())
 from public.campaigns c where c.id=p_campaign_id
 returning id into v_id;
 insert into public.rt_sop_incident_links(incident_id,campaign_id,rt_id,domain,source_type,source_id,opened_by,opened_role,idempotency_key)
 values (v_id,p_campaign_id,p_rt_id,p_domain,p_source_type,p_source_id,auth.uid(),coalesce(private.rt_sop_active_role(),'SYSTEME'),p_key);
 return v_id;
end $$;
revoke all on function private.rt_sop_open_incident_core(uuid,text,text,text,text,text,text,text,text,text,uuid) from public,anon,authenticated;

create or replace function public.rt_sop_open_incident(
 p_campaign_id uuid, p_rt_id text, p_domain text, p_severity text, p_description text,
 p_responsible text, p_immediate_action text, p_evidence_path text, p_suspend_scopes text[], p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_id text; s text;
begin
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 v_role := private.rt_sop_active_role();
 if p_domain = 'QUALITE' then
   perform private.rt_sop_require_role(array['QA / Lab','Unit Head','Zonal Head','Branch Manager','Assistant Branch Manager'], p_rt_id);
 else
   perform private.rt_sop_require_role(array['Unit Head','Zonal Head','Branch Manager','Assistant Branch Manager','Finance','Finance Manager'], p_rt_id);
 end if;
 if length(btrim(coalesce(p_description,''))) < 10 then raise exception 'Description de l''écart obligatoire (10 caractères minimum)'; end if;
 if p_evidence_path is not null and not private.rt_sop_proof_exists(p_rt_id, p_evidence_path) then
   raise exception 'Preuve introuvable dans le registre privé';
 end if;
 if coalesce(array_length(p_suspend_scopes,1),0) > 0 and v_role not in ('Zonal Head','Branch Manager') then
   raise exception 'Seuls le Chef de Zone et le Branch Manager suspendent des mouvements' using errcode='42501';
 end if;
 v_id := private.rt_sop_open_incident_core(p_campaign_id,p_rt_id,p_domain,p_severity,p_description,p_responsible,
          p_immediate_action,p_evidence_path,'MANUEL',null,p_key);
 foreach s in array coalesce(p_suspend_scopes, array[]::text[]) loop
   insert into public.rt_sop_suspensions(incident_id,campaign_id,rt_id,scope,created_by)
   values (v_id,p_campaign_id,p_rt_id,upper(s),auth.uid()) on conflict (incident_id,scope) do nothing;
 end loop;
 return jsonb_build_object('incident_id',v_id);
end $$;

-- Clôture : décision autorisée, jamais par le ZH seul ; QFS seul pour la qualité.
create or replace function public.rt_sop_close_incident(p_incident_id text, p_decision text, p_closing_note text, p_evidence_path text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.rt_sop_incident_links%rowtype; v_allowed text[];
begin
 select * into l from public.rt_sop_incident_links where incident_id=p_incident_id for update;
 if not found then raise exception 'Anomalie SOP introuvable'; end if;
 v_allowed := case l.domain when 'QUALITE' then array['QA / Lab']
                            when 'FINANCEMENT' then array['Finance','Finance Manager','Branch Manager']
                            else array['Branch Manager','Assistant Branch Manager'] end;
 perform private.rt_sop_require_role(v_allowed, l.rt_id);
 if l.decided_at is not null then raise exception 'Anomalie déjà décidée : ouvrir une nouvelle anomalie si nécessaire'; end if;
 if length(btrim(coalesce(p_decision,''))) < 5 or length(btrim(coalesce(p_closing_note,''))) < 5 then
   raise exception 'Décision et note de clôture obligatoires';
 end if;
 if p_evidence_path is null or not private.rt_sop_proof_exists(l.rt_id, p_evidence_path) then
   raise exception 'Preuve de la décision obligatoire';
 end if;
 update public.aflp_incidents set status='CLOS', closing_date=current_date,
   closing_note=p_closing_note, remarks=concat_ws(' | ',remarks,'Décision SOP : '||p_decision||' · preuve '||p_evidence_path),
   updated_by=auth.uid(), updated_at=now()
 where id=p_incident_id;
 update public.rt_sop_incident_links set decision=p_decision, decided_by=auth.uid(), decided_at=now() where incident_id=p_incident_id;
 update public.rt_sop_suspensions set lifted_by=auth.uid(), lifted_at=now() where incident_id=p_incident_id and lifted_at is null;
 return jsonb_build_object('incident_id',p_incident_id,'status','CLOS');
end $$;

create or replace function public.rt_sop_record_zh_control(
 p_campaign_id uuid, p_rt_id text, p_control_type text, p_result text, p_observations text,
 p_evidence_path text, p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rt_sop_zh_controls%rowtype; v_inc text;
begin
 perform private.rt_sop_require_role(array['Zonal Head'], p_rt_id);
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into v from public.rt_sop_zh_controls where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'replay',true); end if;
 if not private.rt_sop_proof_exists(p_rt_id, p_evidence_path) then raise exception 'Preuve du contrôle obligatoire'; end if;
 if p_result = 'ECART' then
   v_inc := private.rt_sop_open_incident_core(p_campaign_id,p_rt_id,'SIGNATURE','MOYENNE',
     'Contrôle '||lower(coalesce(p_control_type,''))||' ZH : '||coalesce(p_observations,''),'Chef de Zone',
     'Écart constaté au contrôle, en attente de décision',p_evidence_path,'ZH_CONTROL',null,
     gen_random_uuid());
 end if;
 insert into public.rt_sop_zh_controls(campaign_id,rt_id,control_type,result,observations,evidence_path,incident_id,controlled_by,idempotency_key)
 values (p_campaign_id,p_rt_id,upper(p_control_type),upper(p_result),p_observations,p_evidence_path,v_inc,auth.uid(),p_key)
 returning * into v;
 return jsonb_build_object('id',v.id,'incident_id',v_inc);
end $$;

-- ---------------------------------------------------------------------------
-- 4. D3 · enregistrement des liquidités
-- ---------------------------------------------------------------------------
create or replace function public.rt_sop_record_cash_event(
 p_campaign_id uuid, p_rt_id text, p_event_type text, p_amount numeric, p_reference text,
 p_evidence_path text, p_reason text, p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rt_sop_cash_events%rowtype; v_type text := upper(btrim(coalesce(p_event_type,'')));
begin
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into v from public.rt_sop_cash_events where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'replay',true); end if;
 if v_type = 'ADJUSTMENT' then
   perform private.rt_sop_require_role(private.rt_sop_finance_roles(), p_rt_id);
 elsif v_type in ('WITHDRAWAL','DEPOSIT') then
   perform private.rt_sop_require_role(array['Unit Head']||private.rt_sop_finance_roles(), p_rt_id);
 elsif v_type = 'CASH_COUNT' then
   perform private.rt_sop_require_role(array['Unit Head','Zonal Head'], p_rt_id);
 else raise exception 'Type de mouvement de liquidité invalide'; end if;
 if not exists(select 1 from public.campaigns where id=p_campaign_id and status='OPEN') then raise exception 'Campagne non ouverte'; end if;
 if not private.rt_sop_proof_exists(p_rt_id, p_evidence_path) then raise exception 'Preuve obligatoire (reçu Wave, fiche de comptage ou décision)'; end if;
 insert into public.rt_sop_cash_events(campaign_id,rt_id,event_type,amount_fcfa,reference,evidence_path,reason,recorded_by,recorded_role,idempotency_key)
 values (p_campaign_id,p_rt_id,v_type,p_amount,nullif(btrim(p_reference),''),p_evidence_path,p_reason,auth.uid(),private.rt_sop_active_role(),p_key)
 returning * into v;
 return jsonb_build_object('id',v.id,'event_type',v.event_type,'amount',v.amount_fcfa);
end $$;

-- ---------------------------------------------------------------------------
-- 5. D4 · registre financier RT : dix montants distincts, un seul calcul
-- ---------------------------------------------------------------------------
drop view if exists public.rt_sop_cash_balance_v;
create view public.rt_sop_cash_balance_v with (security_invoker=true) as
with keys as (
  select campaign_id, rt_id from public.rt_sop_funding_requests
  union select campaign_id, rt_id from public.rt_sop_purchase_state_v
  union select campaign_id, rt_id from public.rt_sop_refunds
  union select campaign_id, rt_id from public.rt_sop_cash_events
), f as (
  select campaign_id, rt_id,
    sum(amount_fcfa) filter (where status='REQUESTED') demandees,
    sum(amount_fcfa) filter (where status in ('FINANCE_SENT','RT_ACK')) versees_non_postees,
    sum(amount_fcfa) filter (where status='POSTED') confirmees,
    sum(amount_fcfa) filter (where status='REJECTED') refusees
  from public.rt_sop_funding_requests group by 1,2
), p as (
  select campaign_id, rt_id,
    sum(montant) filter (where etat_sop='VALIDE_UH') valides,
    sum(montant) filter (where etat_sop='EN_ATTENTE') attente,
    count(*) filter (where etat_sop='EN_ATTENTE') attente_nb,
    sum(montant) filter (where etat_sop='REJETE_UH') rejetes,
    sum(montant) filter (where etat_sop in ('VALIDE_UH','EN_ATTENTE','REJETE_UH') and mode_paiement_sop='ESPECES') especes_payees
  from public.rt_sop_purchase_state_v group by 1,2
), r as (
  select campaign_id, rt_id, sum(amount_fcfa) restit from public.rt_sop_refunds group by 1,2
), e as (
  select campaign_id, rt_id,
    sum(amount_fcfa) filter (where event_type='WITHDRAWAL') retraits,
    sum(amount_fcfa) filter (where event_type='DEPOSIT') depots,
    sum(amount_fcfa) filter (where event_type='ADJUSTMENT') ajustements
  from public.rt_sop_cash_events group by 1,2
), cnt as (
  select distinct on (campaign_id, rt_id) campaign_id, rt_id, amount_fcfa as dernier_comptage, recorded_at as date_comptage
  from public.rt_sop_cash_events where event_type='CASH_COUNT' order by campaign_id, rt_id, event_seq desc
)
select k.campaign_id, k.rt_id,
  coalesce(f.confirmees,0) as avances_confirmees_fcfa,
  coalesce(p.valides,0) as achats_uh_fcfa,
  coalesce(r.restit,0) as restitutions_fcfa,
  coalesce(f.confirmees,0) - coalesce(p.valides,0) - coalesce(r.restit,0) + coalesce(e.ajustements,0) as reste_a_justifier_fcfa,
  coalesce(f.demandees,0) as avances_demandees_fcfa,
  coalesce(f.versees_non_postees,0) as avances_versees_non_confirmees_fcfa,
  coalesce(f.refusees,0) as avances_refusees_fcfa,
  coalesce(p.attente,0) as achats_en_attente_fcfa,
  coalesce(p.attente_nb,0) as achats_en_attente_nb,
  coalesce(p.rejetes,0) as achats_rejetes_uh_fcfa,
  coalesce(e.ajustements,0) as ajustements_fcfa,
  coalesce(f.confirmees,0) - coalesce(p.valides,0) - coalesce(p.attente,0) - coalesce(p.rejetes,0)
    - coalesce(r.restit,0) + coalesce(e.ajustements,0) as disponible_theorique_fcfa,
  coalesce(e.retraits,0) - coalesce(e.depots,0) as especes_retirees_nettes_fcfa,
  coalesce(e.retraits,0) - coalesce(e.depots,0) - coalesce(p.especes_payees,0) as especes_theoriques_fcfa,
  (coalesce(f.confirmees,0) - coalesce(p.valides,0) - coalesce(p.attente,0) - coalesce(p.rejetes,0)
    - coalesce(r.restit,0) + coalesce(e.ajustements,0))
    - (coalesce(e.retraits,0) - coalesce(e.depots,0) - coalesce(p.especes_payees,0)) as wave_theorique_fcfa,
  cnt.dernier_comptage as dernier_comptage_especes_fcfa,
  cnt.date_comptage as date_dernier_comptage,
  cnt.dernier_comptage - (coalesce(e.retraits,0) - coalesce(e.depots,0) - coalesce(p.especes_payees,0)) as ecart_caisse_fcfa
from keys k
left join f using (campaign_id, rt_id) left join p using (campaign_id, rt_id)
left join r using (campaign_id, rt_id) left join e using (campaign_id, rt_id)
left join cnt using (campaign_id, rt_id);
revoke all on public.rt_sop_cash_balance_v from public, anon;
grant select on public.rt_sop_cash_balance_v to authenticated;

-- Alertes simples (S4) : achats en attente sans preuve ou trop anciens.
create or replace view public.rt_sop_alerts_v with (security_invoker=true) as
select campaign_id, rt_id, 'ACHAT_SANS_PREUVE' as alerte, achat_id::text as objet, montant as valeur, age_heures
  from public.rt_sop_purchase_state_v where etat_sop='EN_ATTENTE' and preuve_incomplete
union all
select campaign_id, rt_id, 'ACHAT_EN_ATTENTE_PLUS_72H', achat_id::text, montant, age_heures
  from public.rt_sop_purchase_state_v where etat_sop='EN_ATTENTE' and age_heures > 72
union all
select campaign_id, rt_id, 'ECART_CAISSE', null, ecart_caisse_fcfa, null
  from public.rt_sop_cash_balance_v where abs(coalesce(ecart_caisse_fcfa,0)) > 0;
revoke all on public.rt_sop_alerts_v from public, anon;
grant select on public.rt_sop_alerts_v to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Financement : refus Finance, séparation des tâches, suspension (D8)
-- ---------------------------------------------------------------------------
alter table public.rt_sop_funding_requests
  add column rejected_by uuid references auth.users(id),
  add column rejected_at timestamptz,
  add column rejection_reason text;

create or replace function public.rt_sop_request_funding(
 p_campaign_id uuid,p_rt_id text,p_amount_fcfa numeric,p_plan text,p_wave_account_ref text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rt_sop_funding_requests%rowtype;
begin
 perform private.rt_sop_require_role(array['Branch Manager'],p_rt_id);
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into v from public.rt_sop_funding_requests where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'status',v.status,'replay',true); end if;
 if p_amount_fcfa is null or p_amount_fcfa<=0 or length(btrim(coalesce(p_plan,'')))<8
    or length(btrim(coalesce(p_wave_account_ref,'')))<4 then
    raise exception 'Montant, plan d''achat et compte Wave dédiés requis';
 end if;
 if not exists(select 1 from public.campaigns where id=p_campaign_id and status='OPEN') then raise exception 'Campagne non ouverte'; end if;
 perform private.rt_sop_assert_not_suspended(p_campaign_id,p_rt_id,'FINANCEMENT');
 insert into public.rt_sop_funding_requests(campaign_id,rt_id,amount_fcfa,purchase_plan,wave_account_ref,requested_by,idempotency_key)
 values(p_campaign_id,p_rt_id,p_amount_fcfa,p_plan,p_wave_account_ref,auth.uid(),p_key) returning * into v;
 return jsonb_build_object('id',v.id,'status',v.status,'replay',false);
end $$;

create or replace function public.rt_sop_finance_reject(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rt_sop_funding_requests%rowtype;
begin
 perform private.rt_sop_require_role(private.rt_sop_finance_roles());
 select * into v from public.rt_sop_funding_requests where id=p_id for update;
 if not found then raise exception 'Demande Wave introuvable'; end if;
 if v.status='REJECTED' then return jsonb_build_object('id',v.id,'status',v.status,'replay',true); end if;
 if v.status<>'REQUESTED' then raise exception 'Seule une demande non versée peut être refusée'; end if;
 if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Motif de refus obligatoire'; end if;
 update public.rt_sop_funding_requests set status='REJECTED', rejected_by=auth.uid(), rejected_at=now(), rejection_reason=p_reason where id=v.id;
 return jsonb_build_object('id',v.id,'status','REJECTED');
end $$;

create or replace function public.rt_sop_rt_acknowledge(p_id uuid,p_rt_signed_path text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rt_sop_funding_requests%rowtype;
begin
 select * into v from public.rt_sop_funding_requests where id=p_id for update;
 if not found then raise exception 'Demande Wave introuvable'; end if;
 perform private.rt_sop_require_role(array['Unit Head','Branch Manager'],v.rt_id);
 if v.status='RT_ACK' and v.rt_ack_proof_path=p_rt_signed_path then
   return jsonb_build_object('id',v.id,'status',v.status,'replay',true);
 end if;
 if v.requested_by = auth.uid() or v.finance_by = auth.uid() then
   raise exception 'Séparation des tâches : le demandeur ou le payeur ne peut pas attester la réception RT' using errcode='42501';
 end if;
 if v.status<>'FINANCE_SENT' then raise exception 'L''UH ne peut attester que les versements confirmés par Finance'; end if;
 if not private.rt_sop_proof_exists(v.rt_id,p_rt_signed_path) then raise exception 'Photo de la réception Wave signée par le RT requise'; end if;
 update public.rt_sop_funding_requests set status='RT_ACK', rt_ack_proof_path=p_rt_signed_path, rt_ack_at=now(), rt_ack_witness=auth.uid() where id=v.id;
 return jsonb_build_object('id',v.id,'status','RT_ACK');
end $$;

-- ---------------------------------------------------------------------------
-- 7. D6/D5 · décision UH et restitution sur le registre unique
-- ---------------------------------------------------------------------------
create or replace function public.rt_sop_review_purchase(
 p_achat_id uuid,p_decision text,p_receipt_ref text,p_payment_ref text,p_evidence_path text,p_reason text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.achats%rowtype; r public.rt_sop_purchase_reviews%rowtype; v_name text; b public.rt_sop_cash_balance_v%rowtype; v_last text;
begin
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into r from public.rt_sop_purchase_reviews where idempotency_key=p_key;
 if found then return jsonb_build_object('id',r.id,'decision',r.decision,'replay',true); end if;
 select * into a from public.achats where id=p_achat_id for update;
 if not found then raise exception 'Achat introuvable'; end if;
 perform private.rt_sop_require_role(array['Unit Head'],a.rt_id);
 if a.campaign_id is null or a.rt_id is null or a.rejet=true then raise exception 'Achat incomplet ou annulé'; end if;
 if p_decision not in ('APPROVED','REJECTED') then raise exception 'Décision UH invalide'; end if;
 if p_decision='APPROVED' and (nullif(btrim(coalesce(p_receipt_ref,'')),'') is null
   or nullif(btrim(coalesce(p_payment_ref,'')),'') is null or a.numero_recu is null
   or not private.rt_sop_proof_exists(a.rt_id,p_evidence_path))
   then raise exception 'Reçu et preuve du paiement exigés pour valider un achat'; end if;
 if p_decision='REJECTED' and length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Motif de rejet obligatoire'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.campaign_id::text||':'||a.rt_id,0));
 select decision into v_last from public.rt_sop_purchase_reviews where achat_id=a.id order by review_seq desc limit 1;
 if v_last is not distinct from p_decision then raise exception 'Décision identique déjà enregistrée pour cet achat'; end if;
 if p_decision='APPROVED' then
   select * into b from public.rt_sop_cash_balance_v where campaign_id=a.campaign_id and rt_id=a.rt_id;
   -- L'achat est déjà compté « en attente » ou « rejeté » : il ne réduit pas une seconde fois le disponible.
   if coalesce(b.avances_confirmees_fcfa,0) + coalesce(b.ajustements_fcfa,0) - coalesce(b.restitutions_fcfa,0)
      - coalesce(b.achats_uh_fcfa,0) < a.montant then
     raise exception 'Avance confirmée insuffisante pour cet achat';
   end if;
 end if;
 insert into public.rt_sop_purchase_reviews(achat_id,campaign_id,rt_id,decision,receipt_ref,payment_ref,evidence_path,reason,reviewed_by,idempotency_key)
 values (a.id,a.campaign_id,a.rt_id,p_decision,coalesce(nullif(btrim(p_receipt_ref),''),'Non applicable'),
     coalesce(nullif(btrim(p_payment_ref),''),'Non applicable'),coalesce(p_evidence_path,''),p_reason,auth.uid(),p_key) returning * into r;
 if p_decision='APPROVED' then
    select nom into v_name from public.profils where user_id=auth.uid() and actif=true;
    update public.achats set statut_validation='Validé', validated_by=v_name, validated_at=now() where id=a.id;
 end if;
 return jsonb_build_object('id',r.id,'decision',r.decision,'replay',false);
end $$;

create or replace function public.rt_sop_refund(p_campaign_id uuid,p_rt_id text,p_amount numeric,p_payment_ref text,p_evidence_path text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rt_sop_refunds%rowtype; b public.rt_sop_cash_balance_v%rowtype;
begin
 perform private.rt_sop_require_role(private.rt_sop_finance_roles(),p_rt_id);
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into v from public.rt_sop_refunds where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'replay',true); end if;
 if p_amount is null or p_amount<=0 or length(btrim(coalesce(p_payment_ref,'')))<5
    or not private.rt_sop_proof_exists(p_rt_id,p_evidence_path) then raise exception 'Montant, référence et preuve de restitution obligatoires'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text||':'||p_rt_id,0));
 select * into b from public.rt_sop_cash_balance_v where campaign_id=p_campaign_id and rt_id=p_rt_id;
 if coalesce(b.disponible_theorique_fcfa,0) < p_amount then
   raise exception 'Restitution supérieure aux fonds non engagés (achats en attente inclus)';
 end if;
 insert into public.rt_sop_refunds(campaign_id,rt_id,amount_fcfa,payment_reference,evidence_path,confirmed_by,idempotency_key)
 values(p_campaign_id,p_rt_id,p_amount,trim(p_payment_ref),p_evidence_path,auth.uid(),p_key) returning * into v;
 return jsonb_build_object('id',v.id,'amount',v.amount_fcfa);
end $$;

-- Garde achats (campagne réelle 2027) : ajustements + suspension, verrou conservé.
create or replace function private.rt_sop_guard_purchase_credit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_credit numeric; v_spend numeric; v_refunds numeric; v_adj numeric;
begin
 if not private.rt_sop_is_real_2027(new.campaign_id) or new.rt_id is null then return new; end if;
 if coalesce(new.rejet,false) then return new; end if;
 if tg_op='INSERT' then perform private.rt_sop_assert_not_suspended(new.campaign_id,new.rt_id,'ACHATS'); end if;
 perform pg_advisory_xact_lock(hashtextextended(new.campaign_id::text||':'||new.rt_id,0));
 select coalesce(sum(amount_fcfa),0) into v_credit from public.rt_sop_funding_requests
  where campaign_id=new.campaign_id and rt_id=new.rt_id and status='POSTED';
 select coalesce(sum(montant),0) into v_spend from public.achats
  where campaign_id=new.campaign_id and rt_id=new.rt_id and coalesce(rejet,false)=false and id is distinct from new.id;
 select coalesce(sum(amount_fcfa),0) into v_refunds from public.rt_sop_refunds where campaign_id=new.campaign_id and rt_id=new.rt_id;
 select coalesce(sum(amount_fcfa),0) into v_adj from public.rt_sop_cash_events
  where campaign_id=new.campaign_id and rt_id=new.rt_id and event_type='ADJUSTMENT';
 if v_spend+new.montant+v_refunds>v_credit+v_adj then
    raise exception 'AFLP 2027: achats et restitutions > fonds Wave reellement confirmes';
 end if;
 return new;
end $$;

create or replace function private.rt_sop_restore_review_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.decision='REJECTED' then
   update public.achats set statut_validation='À contrôler',validated_by=null,validated_at=null
   where id=new.achat_id and statut_validation='Validé';
 end if;
 return new;
end $$;

-- ---------------------------------------------------------------------------
-- 8. D7 · une avance issue du SOP ne se modifie ni ne se supprime dans « avances »
-- ---------------------------------------------------------------------------
create or replace function private.rt_sop_protect_posted_advance()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then
   if old.sop_funding_request_id is not null then raise exception 'Avance SOP : suppression interdite (contre-écriture Finance obligatoire)' using errcode='42501'; end if;
   return old;
 end if;
 if old.sop_funding_request_id is not null and (
      new.montant is distinct from old.montant or new.rt_id is distinct from old.rt_id
   or new.campaign_id is distinct from old.campaign_id or new.statut is distinct from old.statut
   or new.sop_funding_request_id is distinct from old.sop_funding_request_id) then
   raise exception 'Avance SOP : montant, RT, campagne et statut non modifiables (contre-écriture Finance obligatoire)' using errcode='42501';
 end if;
 if old.sop_funding_request_id is null and new.sop_funding_request_id is not null then
   raise exception 'Une avance existante ne peut pas être rattachée après coup à un versement SOP' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists trg_051_rt_sop_protect_advance on public.avances;
create trigger trg_051_rt_sop_protect_advance before update or delete on public.avances
for each row execute function private.rt_sop_protect_posted_advance();

-- ---------------------------------------------------------------------------
-- 9. D9/D1/D2 · BEV : plafond de garde, verrou à l'insertion ET à la mise à jour, GRN annulé exclu
-- ---------------------------------------------------------------------------
alter table public.rt_sop_bev
  add column handed_over_by_name text,
  add column received_by_name text,
  add column handover_reserves text,
  add column completed_by uuid references auth.users(id),
  add column completed_at timestamptz;
create table public.rt_sop_bev_lots (
 bev_id uuid not null references public.rt_sop_bev(id),
 lot_id uuid not null references public.field_lots(id),
 linked_by uuid not null references auth.users(id),
 linked_at timestamptz not null default now(),
 primary key (bev_id, lot_id)
);
alter table public.rt_sop_bev_lots enable row level security;
create policy rt_sop_bev_lots_read on public.rt_sop_bev_lots for select to authenticated
 using (exists (select 1 from public.rt_sop_bev b where b.id=bev_id and private.rt_sop_can_read_rt(b.rt_id)));
revoke all on public.rt_sop_bev_lots from public, anon, authenticated;
grant select on public.rt_sop_bev_lots to authenticated;

create or replace function public.rt_sop_register_signed_bev(
 p_campaign_id uuid, p_rt_id text, p_origin_id text, p_origin_label text,
 p_destination_type text, p_destination_id text, p_destination_label text,
 p_bev_code text, p_qty_kg numeric, p_bags_count integer,
 p_vehicle_plate text, p_transporter text, p_driver text,
 p_proof_path text,p_signed_at timestamptz,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rt_sop_bev%rowtype; rt_row public.rt%rowtype; v_bought numeric; v_released numeric;
begin
 perform private.rt_sop_require_role(array['Unit Head'],p_rt_id);
 if p_key is null then raise exception 'Identifiant unique obligatoire'; end if;
 select * into v from public.rt_sop_bev where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'bev_code',v.bev_code,'replay',true); end if;
 select * into rt_row from public.rt where id=p_rt_id and deleted=false;
 if not found then raise exception 'RT introuvable'; end if;
 if p_origin_id is distinct from rt_row.village_id then raise exception 'Village origine different du village rattache au RT'; end if;
 if not exists(select 1 from public.campaigns where id=p_campaign_id and status='OPEN') then raise exception 'Campagne non ouverte'; end if;
 perform private.rt_sop_assert_not_suspended(p_campaign_id,p_rt_id,'BEV');
 if not private.rt_sop_proof_exists(p_rt_id,p_proof_path) then raise exception 'BEV signe RT/prestataire et contresigne UH obligatoire'; end if;
 if p_qty_kg is null or p_qty_kg<=0 or p_bags_count is null or p_bags_count<=0
    or p_signed_at is null or p_signed_at>now()+interval '5 minutes' then raise exception 'Quantite, sacs ou date de signature invalides'; end if;
 if upper(btrim(p_destination_type)) not in ('FACTORY','WAREHOUSE') then raise exception 'Destination invalide'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text||':'||p_rt_id,2));
 select coalesce(sum(poids_net),0) into v_bought from public.achats
  where campaign_id=p_campaign_id and rt_id=p_rt_id and coalesce(rejet,false)=false;
 select coalesce(sum(qty_kg),0) into v_released from public.rt_sop_bev where campaign_id=p_campaign_id and rt_id=p_rt_id;
 if v_released + p_qty_kg > v_bought + 0.01 then
   raise exception 'BEV supérieur au stock sous garde du RT : % kg disponibles', round(v_bought - v_released, 3) using errcode='23514';
 end if;
 insert into public.rt_sop_bev(campaign_id,rt_id,origin_id,origin_label,destination_type,destination_id,destination_label,bev_code,qty_kg,bags_count,
  vehicle_plate,transporter,driver_name,signed_rt_and_transporter_proof,uh_attested_by,signed_at,idempotency_key)
 values(p_campaign_id,p_rt_id,p_origin_id,btrim(p_origin_label),upper(btrim(p_destination_type)),nullif(btrim(p_destination_id),''),btrim(p_destination_label),
  upper(btrim(p_bev_code)),p_qty_kg,p_bags_count,upper(btrim(p_vehicle_plate)),btrim(p_transporter),btrim(p_driver),p_proof_path,auth.uid(),p_signed_at,p_key)
 returning * into v;
 return jsonb_build_object('id',v.id,'bev_code',v.bev_code,'status','SIGNED_EVIDENCE_REGISTERED');
end $$;

-- Compléments du BEV (une seule fois) : lots, personnes remettant/recevant, réserves.
create or replace function public.rt_sop_bev_complete(p_bev_id uuid, p_lot_ids uuid[], p_handed_over_by text, p_received_by text, p_reserves text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.rt_sop_bev%rowtype; l uuid;
begin
 select * into b from public.rt_sop_bev where id=p_bev_id for update;
 if not found then raise exception 'BEV introuvable'; end if;
 perform private.rt_sop_require_role(array['Unit Head'], b.rt_id);
 if b.completed_at is not null then raise exception 'BEV déjà complété : une correction passe par une anomalie'; end if;
 if length(btrim(coalesce(p_handed_over_by,'')))<3 or length(btrim(coalesce(p_received_by,'')))<3 then
   raise exception 'Noms de la personne qui remet et de celle qui reçoit obligatoires';
 end if;
 foreach l in array coalesce(p_lot_ids, array[]::uuid[]) loop
   if not exists (select 1 from public.field_lots where id=l and campaign_id=b.campaign_id) then raise exception 'Lot % hors campagne', l; end if;
   insert into public.rt_sop_bev_lots(bev_id,lot_id,linked_by) values (b.id,l,auth.uid());
 end loop;
 update public.rt_sop_bev set handed_over_by_name=btrim(p_handed_over_by), received_by_name=btrim(p_received_by),
   handover_reserves=nullif(btrim(p_reserves),''), completed_by=auth.uid(), completed_at=now() where id=b.id;
 return jsonb_build_object('id',b.id,'lots',coalesce(array_length(p_lot_ids,1),0));
end $$;

create or replace function private.rt_sop_guard_shipment_dispatch()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.rt_sop_bev%rowtype;
begin
 if not private.rt_sop_is_real_2027(new.campaign_id) or new.origin_type<>'VILLAGE' then return new; end if;
 -- Expédition déjà liée à un BEV : ses données de remise ne changent plus.
 if tg_op='UPDATE' and old.sop_bev_id is not null and (
      new.sop_bev_id is distinct from old.sop_bev_id or new.document_ref is distinct from old.document_ref
   or new.origin_id is distinct from old.origin_id or new.destination_type is distinct from old.destination_type
   or new.destination_id is distinct from old.destination_id or new.vehicle_plate is distinct from old.vehicle_plate
   or new.dispatched_qty_kg is distinct from old.dispatched_qty_kg) then
   raise exception 'AFLP 2027: expedition liee a un BEV signe, donnees de remise non modifiables' using errcode='23514';
 end if;
 if new.status not in ('DISPATCHED','RECEIVED','CLOSED') then return new; end if;
 if tg_op='UPDATE' and old.sop_bev_id is not null then return new; end if;
 if nullif(btrim(coalesce(new.document_ref,'')),'') is null then
    raise exception 'AFLP 2027: BEV signe obligatoire avant sortie du village' using errcode='23514';
 end if;
 select * into b from public.rt_sop_bev where bev_code=upper(btrim(new.document_ref)) for key share;
 if not found then raise exception 'BEV introuvable ou non atteste' using errcode='23514'; end if;
 if b.campaign_id is distinct from new.campaign_id or b.origin_id is distinct from new.origin_id
    or b.destination_type is distinct from new.destination_type
    or (b.destination_type='WAREHOUSE' and b.destination_id is distinct from new.destination_id)
    or upper(regexp_replace(b.vehicle_plate,'\s+','','g')) is distinct from upper(regexp_replace(coalesce(new.vehicle_plate,''),'\s+','','g'))
    or abs(b.qty_kg-coalesce(new.dispatched_qty_kg,0))>0.01 then
     raise exception 'Le BEV ne correspond pas aux donnees du camion' using errcode='23514'; end if;
 new.sop_bev_id:=b.id;
 return new;
end $$;
drop trigger if exists trg_050_rt_sop_bev_required on public.field_shipments;
create trigger trg_050_rt_sop_bev_required
before insert or update of status, document_ref, origin_id, origin_type, destination_type, destination_id, vehicle_plate, dispatched_qty_kg, sop_bev_id, campaign_id
on public.field_shipments for each row execute function private.rt_sop_guard_shipment_dispatch();

create or replace function private.rt_sop_guard_grn_final()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.sop_bev_id is null then return new; end if;
 if new.status in ('RECEIVED','CLOSED') and old.status is distinct from new.status then
    if not exists (select 1 from public.wms_receptions wr join public.wms_grns grn on grn.reception_id=wr.id
      where wr.field_shipment_id=new.id and wr.net_kg is not null and grn.issued_at is not null and grn.issued_by is not null
        and upper(coalesce(grn.status,''))='EMIS') then
      raise exception 'Reception finale impossible: GRN officiel (EMIS) manquant';
    end if;
 end if;
 return new;
end $$;

drop view if exists public.rt_sop_bev_grn_v;
create view public.rt_sop_bev_grn_v with(security_invoker=true) as
select b.id as bev_id,b.campaign_id,b.rt_id,b.bev_code,b.qty_kg as signed_bev_kg,
  b.bags_count,b.transporter,b.vehicle_plate,b.driver_name,b.uh_attested_at,b.signed_rt_and_transporter_proof,
  s.id as shipment_id,s.shipment_code,s.status as shipment_status,s.dispatched_qty_kg,
  w.id as reception_id,w.net_kg as physical_net_received_kg,w.weighbridge_ticket,
  g.id as grn_id,g.status as grn_status,g.issued_at as grn_issued_at,
  case when g.id is not null then round(coalesce(w.net_kg,0)-b.qty_kg,3) else null::numeric end as delta_bev_vs_received_kg,
  case when s.id is null then 'BEV_SIGNED_WAITING_DISPATCH'
       when w.id is null or w.net_kg is null then 'IN_TRANSIT'
       when g.id is null then 'OFFLOADED_WAITING_GRN'
       when abs(coalesce(w.net_kg,0)-b.qty_kg)>0.01 then 'GRN_VARIANCE_REVIEW'
       else 'GRN_MATCHED' end as audit_status,
  b.handed_over_by_name, b.received_by_name, b.handover_reserves,
  (select count(*) from public.rt_sop_bev_lots bl where bl.bev_id=b.id) as lots_lies
from public.rt_sop_bev b
left join public.field_shipments s on s.sop_bev_id=b.id
left join lateral(select w.* from public.wms_receptions w where w.field_shipment_id=s.id order by w.created_at desc,w.id desc limit 1) w on true
left join lateral(select g.* from public.wms_grns g where g.reception_id=w.id and g.issued_at is not null and upper(coalesce(g.status,''))='EMIS'
  order by g.issued_at desc,g.id desc limit 1) g on true;
revoke all on public.rt_sop_bev_grn_v from public,anon;
grant select on public.rt_sop_bev_grn_v to authenticated;

-- Carte de garde RCN par RT : poids payé, poids remis sur BEV, transport, GRN.
create or replace view public.rt_sop_rcn_custody_v with (security_invoker=true) as
with k as (
  select campaign_id, rt_id from public.rt_sop_purchase_state_v union select campaign_id, rt_id from public.rt_sop_bev
), a as (
  select campaign_id, rt_id, sum(poids_net) filter (where not annule) achats_kg,
         sum(poids_net) filter (where etat_sop='VALIDE_UH') achats_valides_kg
  from public.rt_sop_purchase_state_v group by 1,2
), b as (
  select campaign_id, rt_id, sum(signed_bev_kg) bev_kg,
    sum(signed_bev_kg) filter (where audit_status in ('BEV_SIGNED_WAITING_DISPATCH','IN_TRANSIT','OFFLOADED_WAITING_GRN')) transport_kg,
    sum(physical_net_received_kg) filter (where grn_id is not null) grn_kg,
    sum(delta_bev_vs_received_kg) filter (where audit_status='GRN_VARIANCE_REVIEW') ecart_kg,
    count(*) filter (where grn_id is null) bev_sans_grn,
    count(*) filter (where audit_status='GRN_VARIANCE_REVIEW') bev_ecart_a_examiner
  from public.rt_sop_bev_grn_v group by 1,2
)
select k.campaign_id, k.rt_id,
  coalesce(a.achats_kg,0) as achats_payes_kg, coalesce(a.achats_valides_kg,0) as achats_valides_uh_kg,
  coalesce(b.bev_kg,0) as remis_bev_kg,
  coalesce(a.achats_kg,0) - coalesce(b.bev_kg,0) as stock_sous_garde_rt_kg,
  coalesce(b.transport_kg,0) as en_transport_kg,
  coalesce(b.grn_kg,0) as recu_grn_kg,
  b.ecart_kg as ecart_bev_grn_kg,
  coalesce(b.bev_sans_grn,0) as bev_sans_grn, coalesce(b.bev_ecart_a_examiner,0) as bev_ecart_a_examiner
from k left join a using (campaign_id, rt_id) left join b using (campaign_id, rt_id);
revoke all on public.rt_sop_rcn_custody_v from public, anon;
grant select on public.rt_sop_rcn_custody_v to authenticated;

-- ---------------------------------------------------------------------------
-- 10. D10 · bilan hebdomadaire : valeurs théoriques figées, anomalie si réserve/désaccord
-- ---------------------------------------------------------------------------
alter table public.rt_sop_weekly_signoffs add column server_snapshot jsonb, add column incident_id text references public.aflp_incidents(id);

create or replace function public.rt_sop_weekly_sign(
 p_campaign_id uuid,p_rt_id text,p_period_start date,p_period_end date,
 p_snapshot jsonb,p_rt_decision text,p_rt_reservations text,
 p_signed_proof_path text,p_supersedes_id uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rt_sop_weekly_signoffs%rowtype; previous_id uuid; v_hash text; v_balance numeric; v_server jsonb; v_inc text;
begin
 perform private.rt_sop_require_role(array['Unit Head'],p_rt_id);
 if p_key is null then raise exception 'Identifiant unique requis'; end if;
 select * into v from public.rt_sop_weekly_signoffs where idempotency_key=p_key;
 if found then return jsonb_build_object('id',v.id,'replay',true); end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start or p_period_end>p_period_start+6 then raise exception 'Periode de 7 jours maximum'; end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or not(p_snapshot ?& array['rcn_kg','reste_a_justifier_fcfa','sacs_vides','sacs_pleins','pieces']) then raise exception 'Les trois cartes et les pieces sont obligatoires'; end if;
 if p_rt_decision not in ('AGREED','RESERVED','DISAGREED') then raise exception 'Avis RT invalide'; end if;
 if p_rt_decision<>'AGREED' and length(btrim(coalesce(p_rt_reservations,'')))<5 then raise exception 'Motif des reserves ou du desaccord obligatoire'; end if;
 if not private.rt_sop_proof_exists(p_rt_id,p_signed_proof_path) then raise exception 'Fiche hebdomadaire avec signatures manuscrites RT et UH exigee'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text||':'||p_rt_id||':'||p_period_start::text,1));
 select id into previous_id from public.rt_sop_weekly_signoffs where campaign_id=p_campaign_id and rt_id=p_rt_id and period_start=p_period_start
  order by signed_at desc,id desc limit 1;
 if previous_id is distinct from p_supersedes_id then raise exception 'Reprise ou version du bilan incorrecte'; end if;
 select reste_a_justifier_fcfa into v_balance from public.rt_sop_cash_balance_v where rt_id=p_rt_id and campaign_id=p_campaign_id;
 if v_balance is distinct from nullif(p_snapshot->>'reste_a_justifier_fcfa','')::numeric then raise exception 'Le solde financier ne correspond pas au ledger verifie'; end if;
 -- Valeurs théoriques du serveur figées à côté des valeurs comptées : le rapprochement reste contradictoire.
 select jsonb_build_object('finance', (select to_jsonb(c) from public.rt_sop_cash_balance_v c where c.rt_id=p_rt_id and c.campaign_id=p_campaign_id),
   'rcn', (select to_jsonb(r) from public.rt_sop_rcn_custody_v r where r.rt_id=p_rt_id and r.campaign_id=p_campaign_id),
   'calcule_le', now()) into v_server;
 v_hash:=encode(extensions.digest(p_snapshot::text,'sha256'),'hex');
 insert into public.rt_sop_weekly_signoffs(campaign_id,rt_id,period_start,period_end,snapshot,snapshot_sha256,rt_decision,rt_reservations,
   signed_proof_path,uh_signed_by,supersedes_id,idempotency_key,server_snapshot)
 values(p_campaign_id,p_rt_id,p_period_start,p_period_end,p_snapshot,v_hash,p_rt_decision,p_rt_reservations,
   p_signed_proof_path,auth.uid(),p_supersedes_id,p_key,v_server) returning * into v;
 if p_rt_decision <> 'AGREED' then
   v_inc := private.rt_sop_open_incident_core(p_campaign_id,p_rt_id,'SIGNATURE',
     case when p_rt_decision='DISAGREED' then 'ELEVEE' else 'MOYENNE' end,
     case when p_rt_decision='DISAGREED' then 'Désaccord du RT sur le bilan du ' else 'Réserve du RT sur le bilan du ' end
       ||p_period_start::text||' : '||p_rt_reservations,'Chef de Zone','Bilan non clôturé conforme, examen ZH requis',
     p_signed_proof_path,'WEEKLY_SIGNOFF',v.id::text,gen_random_uuid());
   update public.rt_sop_weekly_signoffs set incident_id=v_inc where id=v.id;
 end if;
 return jsonb_build_object('id',v.id,'snapshot_hash',v.snapshot_sha256,'incident_id',v_inc,'replay',false);
end $$;

create or replace view public.rt_sop_weekly_status_v with (security_invoker=true) as
select distinct on (w.campaign_id, w.rt_id, w.period_start)
  w.campaign_id, w.rt_id, w.period_start, w.period_end, w.id as derniere_version_id, w.signed_at,
  w.rt_decision, w.incident_id, i.status as statut_anomalie,
  (select count(*) from public.rt_sop_weekly_signoffs x where x.campaign_id=w.campaign_id and x.rt_id=w.rt_id and x.period_start=w.period_start) as nb_versions,
  case when w.rt_decision='AGREED' then 'CONFORME_SIGNE'
       when w.rt_decision='RESERVED' then 'SIGNE_AVEC_RESERVE'
       else 'DESACCORD_NON_CLOTURE' end as statut
from public.rt_sop_weekly_signoffs w left join public.aflp_incidents i on i.id=w.incident_id
order by w.campaign_id, w.rt_id, w.period_start, w.signed_at desc, w.id desc;
revoke all on public.rt_sop_weekly_status_v from public, anon;
grant select on public.rt_sop_weekly_status_v to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Carte sacherie RT : lecture du registre canonique rcn_jute_movements (aucune écriture)
-- ---------------------------------------------------------------------------
create or replace view public.rt_sop_jute_history_v with (security_invoker=true) as
select l.rt_id, l.cluster, m.campaign_id, m.id as movement_id, m.movement_at, m.movement_type,
  m.from_location, m.to_location, m.from_state, m.to_state, m.qty, m.reference, m.proof_url,
  case when m.to_location=l.code and m.to_state='UTILISABLE' then m.qty else 0 end
   - case when m.from_location=l.code and m.from_state='UTILISABLE' then m.qty else 0 end as delta_vides,
  case when m.to_location=l.code and m.to_state='PLEIN' then m.qty else 0 end
   - case when m.from_location=l.code and m.from_state='PLEIN' then m.qty else 0 end as delta_pleins,
  case when m.to_location=l.code and coalesce(m.from_location,'')<>l.code and m.to_state='UTILISABLE' then 'RECU'
       when m.from_location=l.code and m.to_location=l.code and m.from_state='UTILISABLE' and m.to_state='PLEIN' then 'UTILISE'
       when m.from_location=l.code and coalesce(m.to_location,'')<>l.code and m.from_state='PLEIN' then 'PLEIN_EXPEDIE'
       when m.from_location=l.code and coalesce(m.to_location,'')<>l.code and m.from_state='UTILISABLE' then 'RETOURNE'
       when m.movement_type in ('PERTE_APPROUVEE','AJUSTEMENT_INVENTAIRE') then 'PERTE_OU_AJUSTEMENT'
       when m.to_location=l.code and m.to_state in ('DECHIRE','A_REPARER','HUMIDE','REFORME') then 'ABIME'
       else 'AUTRE' end as categorie_rt
from public.rcn_jute_locations l
join public.rcn_jute_movements m on (m.from_location=l.code or m.to_location=l.code)
where l.scope_type='RT' and m.ledger='INTERNE';

create or replace view public.rt_sop_jute_card_v with (security_invoker=true) as
select h.rt_id, h.campaign_id,
  sum(h.qty) filter (where categorie_rt='RECU') as sacs_recus,
  sum(h.qty) filter (where categorie_rt='UTILISE') as sacs_utilises,
  sum(h.qty) filter (where categorie_rt='PLEIN_EXPEDIE') as sacs_pleins_expedies,
  sum(h.qty) filter (where categorie_rt='RETOURNE') as sacs_retournes,
  sum(h.qty) filter (where categorie_rt='ABIME') as sacs_abimes,
  sum(h.qty) filter (where categorie_rt='PERTE_OU_AJUSTEMENT') as pertes_ajustements,
  sum(h.delta_vides) as sacs_vides_theoriques,
  sum(h.delta_pleins) as sacs_pleins_theoriques,
  sum(h.delta_vides) + sum(h.delta_pleins) as sacs_sous_garde_theoriques,
  max(h.movement_at) as dernier_mouvement,
  count(*) as nb_mouvements
from public.rt_sop_jute_history_v h group by h.rt_id, h.campaign_id;
revoke all on public.rt_sop_jute_history_v, public.rt_sop_jute_card_v from public, anon;
grant select on public.rt_sop_jute_history_v, public.rt_sop_jute_card_v to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Tableau BM par RT · une absence de donnée reste NULL (« non vérifié »), jamais 0
-- ---------------------------------------------------------------------------
create or replace view public.rt_sop_rt_dashboard_v with (security_invoker=true) as
select c.id as campaign_id, c.code as campagne, c.campaign_type, r.id as rt_id, r.nom as rt_nom, upper(r.cluster) as cluster,
  f.avances_confirmees_fcfa, f.achats_uh_fcfa, f.achats_en_attente_fcfa, f.achats_en_attente_nb,
  f.reste_a_justifier_fcfa, f.disponible_theorique_fcfa, f.especes_theoriques_fcfa, f.ecart_caisse_fcfa,
  s.stock_sous_garde_rt_kg, s.en_transport_kg, s.recu_grn_kg, s.bev_sans_grn, s.bev_ecart_a_examiner,
  j.sacs_vides_theoriques, j.sacs_pleins_theoriques,
  w.period_start as dernier_bilan_semaine, w.statut as statut_dernier_bilan,
  (w.period_start is null or w.period_start < current_date - 13) as bilan_hebdo_en_retard,
  (select count(*) from public.rt_sop_incident_links il join public.aflp_incidents i on i.id=il.incident_id
     where il.rt_id=r.id and il.campaign_id=c.id and i.status<>'CLOS') as anomalies_ouvertes,
  (select max(controlled_at) from public.rt_sop_zh_controls z where z.rt_id=r.id and z.campaign_id=c.id) as dernier_controle_zh,
  coalesce((select max(controlled_at) from public.rt_sop_zh_controls z where z.rt_id=r.id and z.campaign_id=c.id) < now() - interval '14 days', true)
     as controle_zh_en_retard,
  (select count(*) from public.rt_sop_suspensions sp where sp.rt_id=r.id and sp.campaign_id=c.id and sp.lifted_at is null) as suspensions_actives,
  case when f.rt_id is null then 'NON_VERIFIE' else 'REGISTRE_SOP' end as source_financiere
from public.campaigns c
cross join public.rt r
left join public.rt_sop_cash_balance_v f on f.rt_id=r.id and f.campaign_id=c.id
left join public.rt_sop_rcn_custody_v s on s.rt_id=r.id and s.campaign_id=c.id
left join public.rt_sop_jute_card_v j on j.rt_id=r.id and j.campaign_id=c.id
left join lateral (select x.period_start, x.statut from public.rt_sop_weekly_status_v x
   where x.rt_id=r.id and x.campaign_id=c.id order by x.period_start desc limit 1) w on true
where r.deleted=false and c.status in ('OPEN','CLOSING');
revoke all on public.rt_sop_rt_dashboard_v from public, anon;
grant select on public.rt_sop_rt_dashboard_v to authenticated;

-- ---------------------------------------------------------------------------
-- 13 bis. D13 · concurrence : le contrôle historique fb_prevent_achat_over_advance
-- ne pose aucun verrou (S15 reproduit : 2 × 60 000 acceptés sur 100 000).
-- Un déclencheur nommé pour s'exécuter juste avant lui sérialise les écritures du même
-- RT et de la même campagne. La fonction historique n'est pas modifiée.
-- Clé identique à celle des RPC SOP (campagne:rt_id) : verrou réentrant, pas d'interblocage.
-- ---------------------------------------------------------------------------
create or replace function private.rt_sop_lock_rt_cash()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare k text := public.fb_rt_key(new.rt_id, new.rt_nom);
begin
 if k is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(new.campaign_id::text,'')||':'||k,0));
 return new;
end $$;
revoke all on function private.rt_sop_lock_rt_cash() from public,anon,authenticated;
drop trigger if exists trg_fa_rt_sop_lock_cash on public.achats;
create trigger trg_fa_rt_sop_lock_cash before insert or update of montant, rt_id, rt_nom on public.achats
for each row execute function private.rt_sop_lock_rt_cash();
drop trigger if exists trg_fa_rt_sop_lock_cash on public.avances;
create trigger trg_fa_rt_sop_lock_cash before insert or update of montant, rt_id, rt_nom on public.avances
for each row execute function private.rt_sop_lock_rt_cash();

-- ---------------------------------------------------------------------------
-- 13 ter. D14 · un achat ayant reçu une décision UH ne change plus (achats_upd autorise le BM)
-- Le registre relit achats.montant : une modification après décision changerait le solde sans trace.
-- Correction : rejet UH puis nouvel achat.
-- ---------------------------------------------------------------------------
create or replace function private.rt_sop_freeze_reviewed_purchase()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists (select 1 from public.rt_sop_purchase_reviews r where r.achat_id=old.id) and (
      new.montant is distinct from old.montant or new.poids_net is distinct from old.poids_net
   or new.prix_kg is distinct from old.prix_kg or new.rt_id is distinct from old.rt_id
   or new.campaign_id is distinct from old.campaign_id or new.rejet is distinct from old.rejet
   or new.mode_paiement is distinct from old.mode_paiement or new.numero_recu is distinct from old.numero_recu) then
   raise exception 'Achat déjà examiné par l''UH : montant, poids, RT, paiement et reçu figés (rejet UH puis nouvel achat)' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.rt_sop_freeze_reviewed_purchase() from public,anon,authenticated;
drop trigger if exists trg_052_rt_sop_freeze_reviewed on public.achats;
create trigger trg_052_rt_sop_freeze_reviewed before update on public.achats
for each row execute function private.rt_sop_freeze_reviewed_purchase();

-- ---------------------------------------------------------------------------
-- 13. Droits d'exécution
-- ---------------------------------------------------------------------------
revoke all on function public.rt_sop_open_incident(uuid,text,text,text,text,text,text,text,text[],uuid) from public,anon;
revoke all on function public.rt_sop_close_incident(text,text,text,text) from public,anon;
revoke all on function public.rt_sop_record_zh_control(uuid,text,text,text,text,text,uuid) from public,anon;
revoke all on function public.rt_sop_record_cash_event(uuid,text,text,numeric,text,text,text,uuid) from public,anon;
revoke all on function public.rt_sop_finance_reject(uuid,text) from public,anon;
revoke all on function public.rt_sop_bev_complete(uuid,uuid[],text,text,text) from public,anon;
revoke all on function private.rt_sop_protect_posted_advance() from public,anon,authenticated;
grant execute on function public.rt_sop_open_incident(uuid,text,text,text,text,text,text,text,text[],uuid) to authenticated;
grant execute on function public.rt_sop_close_incident(text,text,text,text) to authenticated;
grant execute on function public.rt_sop_record_zh_control(uuid,text,text,text,text,text,uuid) to authenticated;
grant execute on function public.rt_sop_record_cash_event(uuid,text,text,numeric,text,text,text,uuid) to authenticated;
grant execute on function public.rt_sop_finance_reject(uuid,text) to authenticated;
grant execute on function public.rt_sop_bev_complete(uuid,uuid[],text,text,text) to authenticated;
commit;
