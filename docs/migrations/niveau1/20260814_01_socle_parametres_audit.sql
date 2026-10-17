-- ============================================================================
-- FBMS / AFLP 2027 — NIVEAU 1 « Règles et intégrité »
-- Migration 01 : socle — contexte, paramétrage administrable, audit append-only
-- Date : 2026-08-14
--
-- LOT C (journal d'audit) + support du paramétrage exigé par le LOT B.
--
-- PRINCIPES
--   1. Additive uniquement. Aucun DROP TABLE, aucune suppression de donnée.
--   2. Idempotente : réexécutable sans effet de bord.
--   3. Le journal d'audit est append-only, y compris pour le propriétaire de la
--      table : un trigger BEFORE UPDATE OR DELETE rejette l'opération. La RLS
--      seule ne suffirait pas (elle n'oppose rien à service_role).
--   4. Aucun secret, aucune photo, aucun numéro de téléphone n'entre dans
--      l'audit : les champs sensibles sont masqués par n1_masquer().
--
-- APPLICATION : manuelle, après revue, d'abord sur un projet de recette.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Schéma technique
-- ---------------------------------------------------------------------------
-- Tout ce qui est livré ici est préfixé n1_ (Niveau 1) pour ne jamais entrer en
-- collision avec un objet existant en production dont la DDL n'est pas au dépôt.

create schema if not exists n1;
comment on schema n1 is 'Niveau 1 — règles et intégrité AFLP. Objets internes non exposés à PostgREST.';

-- ---------------------------------------------------------------------------
-- 1) Contexte utilisateur
-- ---------------------------------------------------------------------------

-- Identité courante. Isolée dans une fonction pour que le harnais de test
-- puisse la remplacer sans réécrire les règles.
create or replace function public.n1_uid()
returns uuid language sql stable as $$
  select auth.uid()
$$;

create or replace function public.n1_role()
returns text language sql stable security definer set search_path = public as $$
  select p.role from public.profils p
  where p.user_id = public.n1_uid() and p.actif = true
  limit 1
$$;

create or replace function public.n1_contexte()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'user_id', p.user_id,
       'role', p.role,
       'fonction_operationnelle', p.fonction_operationnelle,
       'cluster', p.cluster,
       'zone', p.zone,
       'actif', p.actif)
     from public.profils p
     where p.user_id = public.n1_uid() and p.actif = true
     limit 1),
    jsonb_build_object('user_id', public.n1_uid(), 'role', null, 'actif', false))
$$;

-- ---------------------------------------------------------------------------
-- 2) Paramétrage administrable, versionné et audité
-- ---------------------------------------------------------------------------
-- Les plafonds, tolérances et délégations ne sont PAS inventés dans le code.
-- Ils sont saisis ici par un rôle autorisé, versionnés et tracés.
-- Règle de sûreté : une valeur ABSENTE bloque l'opération à risque
-- (cf. n1_param_num_obligatoire), elle ne l'autorise jamais par défaut.

create table if not exists public.n1_parametres (
  id            uuid primary key default gen_random_uuid(),
  cle           text not null,
  portee        text not null default 'GLOBAL',
  portee_ref    text,                       -- code campagne / cluster / rt selon la portée
  valeur_num    numeric,
  valeur_txt    text,
  valeur_bool   boolean,
  unite         text,
  version       integer not null default 1,
  actif         boolean not null default true,
  motif         text not null,
  valide_par    uuid,
  valide_le     timestamptz,
  created_by    uuid default public.n1_uid(),
  created_at    timestamptz not null default now()
);

alter table public.n1_parametres add column if not exists unite text;
alter table public.n1_parametres add column if not exists valide_par uuid;
alter table public.n1_parametres add column if not exists valide_le timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'n1_param_portee_chk') then
    alter table public.n1_parametres add constraint n1_param_portee_chk
      check (portee in ('GLOBAL','CAMPAGNE','CLUSTER','RT'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'n1_param_portee_ref_chk') then
    alter table public.n1_parametres add constraint n1_param_portee_ref_chk
      check ((portee = 'GLOBAL' and portee_ref is null)
          or (portee <> 'GLOBAL' and nullif(btrim(portee_ref),'') is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'n1_param_valeur_chk') then
    alter table public.n1_parametres add constraint n1_param_valeur_chk
      check (valeur_num is not null or valeur_txt is not null or valeur_bool is not null);
  end if;
end $$;

-- Une seule version ACTIVE par (clé, portée, référence).
create unique index if not exists n1_param_actif_uidx
  on public.n1_parametres (cle, portee, coalesce(portee_ref,'*'))
  where actif = true;

create unique index if not exists n1_param_version_uidx
  on public.n1_parametres (cle, portee, coalesce(portee_ref,'*'), version);

create index if not exists n1_param_cle_idx on public.n1_parametres (cle, actif);

-- Lecture de paramètre, du plus spécifique au plus général.
create or replace function public.n1_param_num(
  p_cle text, p_campagne text default null, p_cluster text default null, p_rt text default null)
returns numeric language sql stable security definer set search_path = public as $$
  select p.valeur_num
  from public.n1_parametres p
  where p.cle = p_cle and p.actif = true and p.valeur_num is not null
    and ( (p.portee = 'RT'       and p.portee_ref = p_rt)
       or (p.portee = 'CLUSTER'  and upper(p.portee_ref) = upper(p_cluster))
       or (p.portee = 'CAMPAGNE' and upper(p.portee_ref) = upper(p_campagne))
       or (p.portee = 'GLOBAL') )
  order by case p.portee when 'RT' then 1 when 'CLUSTER' then 2 when 'CAMPAGNE' then 3 else 4 end
  limit 1
$$;

create or replace function public.n1_param_txt(
  p_cle text, p_campagne text default null, p_cluster text default null, p_rt text default null)
returns text language sql stable security definer set search_path = public as $$
  select p.valeur_txt
  from public.n1_parametres p
  where p.cle = p_cle and p.actif = true and p.valeur_txt is not null
    and ( (p.portee = 'RT'       and p.portee_ref = p_rt)
       or (p.portee = 'CLUSTER'  and upper(p.portee_ref) = upper(p_cluster))
       or (p.portee = 'CAMPAGNE' and upper(p.portee_ref) = upper(p_campagne))
       or (p.portee = 'GLOBAL') )
  order by case p.portee when 'RT' then 1 when 'CLUSTER' then 2 when 'CAMPAGNE' then 3 else 4 end
  limit 1
$$;

-- Variante bloquante : à utiliser pour toute opération à risque financier.
-- Une valeur absente REFUSE l'opération. Elle ne l'autorise jamais.
create or replace function public.n1_param_num_obligatoire(
  p_cle text, p_campagne text default null, p_cluster text default null, p_rt text default null)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  v := public.n1_param_num(p_cle, p_campagne, p_cluster, p_rt);
  if v is null then
    raise exception
      'Paramètre « % » non défini : opération refusée par sécurité. Le Branch Manager doit le saisir dans n1_parametres avant toute opération à risque.', p_cle
      using errcode = 'restrict_violation', hint = 'n1_definir_parametre(''' || p_cle || ''', …)';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Journal d'audit append-only
-- ---------------------------------------------------------------------------
-- Nom volontairement distinct de public.audit_log : la DDL de cette dernière
-- n'est pas au dépôt et sa forme réelle en production est inconnue. On ne
-- réécrit pas une table dont on ignore le contenu.

create table if not exists public.n1_audit (
  id              bigserial primary key,
  event_uid       uuid not null default gen_random_uuid(),
  ts_serveur      timestamptz not null default now(),
  utilisateur     uuid,
  utilisateur_nom text,
  role            text,
  action          text not null,
  resultat        text not null default 'ACCEPTE',
  ressource       text,
  enregistrement  text,
  anciennes_valeurs jsonb,
  nouvelles_valeurs jsonb,
  motif           text,
  terminal_id     text,
  sync_id         text,
  correlation_id  text,
  campagne        text,
  cluster         text,
  rt_id           text
);

alter table public.n1_audit add column if not exists event_uid uuid not null default gen_random_uuid();
alter table public.n1_audit add column if not exists utilisateur_nom text;
alter table public.n1_audit add column if not exists correlation_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'n1_audit_resultat_chk') then
    alter table public.n1_audit add constraint n1_audit_resultat_chk
      check (resultat in ('ACCEPTE','REFUSE'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'n1_audit_action_chk') then
    alter table public.n1_audit add constraint n1_audit_action_chk
      check (action in (
        'CREATION','MODIFICATION','TENTATIVE_REFUSEE','CLOTURE','ANNULATION',
        'AJUSTEMENT','APPROBATION','REJET','CHANGEMENT_STATUT','CHANGEMENT_ROLE',
        'CHANGEMENT_PLAFOND','SYNCHRONISATION','CONFLIT_SYNCHRONISATION',
        'CONNEXION_SENSIBLE','EXPORT_SENSIBLE','RECONCILIATION','ALERTE',
        'DEBLOCAGE','ATTRIBUTION_PAPIER'));
  end if;
end $$;

create index if not exists n1_audit_ts_idx        on public.n1_audit (ts_serveur desc);
create index if not exists n1_audit_ressource_idx on public.n1_audit (ressource, enregistrement);
create index if not exists n1_audit_user_idx      on public.n1_audit (utilisateur, ts_serveur desc);
create index if not exists n1_audit_corr_idx      on public.n1_audit (correlation_id) where correlation_id is not null;
create index if not exists n1_audit_rt_idx        on public.n1_audit (rt_id, ts_serveur desc);

-- 3.1 Masquage — aucun secret ni donnée inutile dans l'audit.
create or replace function public.n1_masquer(p jsonb)
returns jsonb language sql immutable as $$
  select case when p is null then null else
    (select coalesce(jsonb_object_agg(k,
              case
                when k in ('recu_photo','recu_photo_url','photo','piece_jointe')
                     then to_jsonb('[masqué:' || length(coalesce(v #>> '{}','')) || ' car]')
                when k in ('password','mot_de_passe','token','service_role_key',
                           'anon_key','secret','telephone','tel','email_perso')
                     then to_jsonb('[masqué]'::text)
                else v
              end), '{}'::jsonb)
     from jsonb_each(p) as e(k,v))
  end
$$;

-- 3.2 Écriture d'un événement. SECURITY DEFINER : appelable depuis n'importe
-- quel trigger ou RPC, y compris pour tracer un REFUS.
create or replace function public.n1_auditer(
  p_action text,
  p_ressource text,
  p_enregistrement text default null,
  p_anciennes jsonb default null,
  p_nouvelles jsonb default null,
  p_motif text default null,
  p_resultat text default 'ACCEPTE',
  p_correlation text default null,
  p_terminal text default null,
  p_sync text default null,
  p_campagne text default null,
  p_cluster text default null,
  p_rt text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_nom text;
begin
  select p.nom into v_nom from public.profils p where p.user_id = public.n1_uid() limit 1;

  -- LIMITE STRUCTURELLE ASSUMÉE — à lire avant de « corriger » ce bloc.
  -- PostgreSQL n'a pas de transaction autonome. Quand un trigger REFUSE une
  -- écriture, il lève une exception : la transaction est annulée, et la ligne
  -- d'audit insérée juste avant l'est aussi. Bloquer reste prioritaire sur
  -- tracer, donc les gardes lèvent bien une exception.
  -- Mesure compensatoire : RAISE WARNING écrit dans le journal PostgreSQL, qui
  -- n'est PAS annulé par le ROLLBACK et reste consultable dans les logs
  -- Supabase. Un refus laisse donc toujours une trace serveur, même si la
  -- ligne n1_audit correspondante n'a pas survécu.
  -- Voir docs/niveau1/13_ANGLES_MORTS.md — A-01.
  if coalesce(p_resultat,'ACCEPTE') = 'REFUSE' then
    raise warning 'N1_REFUS ressource=% enregistrement=% action=% utilisateur=% rt=% cluster=% motif=%',
      p_ressource, coalesce(p_enregistrement,'-'), p_action,
      coalesce(public.n1_uid()::text,'-'), coalesce(p_rt,'-'), coalesce(p_cluster,'-'),
      coalesce(p_motif,'-');
  end if;

  insert into public.n1_audit(
    utilisateur, utilisateur_nom, role, action, resultat, ressource, enregistrement,
    anciennes_valeurs, nouvelles_valeurs, motif, terminal_id, sync_id, correlation_id,
    campagne, cluster, rt_id)
  values (
    public.n1_uid(), v_nom, public.n1_role(), p_action, coalesce(p_resultat,'ACCEPTE'),
    p_ressource, p_enregistrement,
    public.n1_masquer(p_anciennes), public.n1_masquer(p_nouvelles),
    p_motif, p_terminal, p_sync, p_correlation,
    p_campagne, p_cluster, p_rt)
  returning event_uid into v_id;

  return v_id;
end $$;

-- 3.3 Trigger générique d'audit, à attacher à toute table sensible.
create or replace function public.n1_audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_old jsonb;
  v_new jsonb;
  v_id text;
begin
  if tg_op = 'INSERT' then
    v_action := 'CREATION';  v_old := null;              v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'MODIFICATION'; v_old := to_jsonb(old);  v_new := to_jsonb(new);
  else
    v_action := 'ANNULATION';   v_old := to_jsonb(old);  v_new := null;
  end if;

  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');

  perform public.n1_auditer(
    v_action, tg_table_name, v_id, v_old, v_new, null, 'ACCEPTE', null, null, null,
    coalesce(v_new ->> 'campagne', v_old ->> 'campagne'),
    coalesce(v_new ->> 'cluster',  v_old ->> 'cluster'),
    coalesce(v_new ->> 'rt_id',    v_old ->> 'rt_id'));

  return coalesce(new, old);
end $$;

-- 3.4 APPEND-ONLY — la garantie forte.
-- La RLS ne protège pas de service_role ni du propriétaire ; un trigger, si.
create or replace function public.n1_audit_immuable()
returns trigger language plpgsql as $$
begin
  raise exception 'Journal d''audit append-only : % interdit sur %.', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_n1_audit_immuable on public.n1_audit;
create trigger trg_n1_audit_immuable
  before update or delete on public.n1_audit
  for each row execute function public.n1_audit_immuable();

-- Le TRUNCATE ne déclenche pas un trigger FOR EACH ROW : il faut son propre garde.
drop trigger if exists trg_n1_audit_immuable_trunc on public.n1_audit;
create trigger trg_n1_audit_immuable_trunc
  before truncate on public.n1_audit
  for each statement execute function public.n1_audit_immuable();

-- 3.5 RLS : écriture par tout compte actif, lecture restreinte.
alter table public.n1_audit enable row level security;
drop policy if exists n1_audit_ins on public.n1_audit;
drop policy if exists n1_audit_sel on public.n1_audit;

create policy n1_audit_ins on public.n1_audit
  for insert to authenticated
  with check (public.n1_uid() is not null);

-- Lecture : BM et rôles de contrôle voient tout ; chacun voit ses propres actions.
create policy n1_audit_sel on public.n1_audit
  for select to authenticated
  using (
    public.est_bm()
    or utilisateur = public.n1_uid()
    or public.n1_role() in ('Assistant Branch Manager','Head of Field','Procurement Officer')
  );
-- Aucune policy UPDATE ni DELETE : refusées par défaut, en plus du trigger.

revoke update, delete, truncate on public.n1_audit from authenticated;
revoke update, delete, truncate on public.n1_audit from anon;

-- ---------------------------------------------------------------------------
-- 4) Paramètres : écriture réservée, versionnée et auditée
-- ---------------------------------------------------------------------------

alter table public.n1_parametres enable row level security;
drop policy if exists n1_param_sel on public.n1_parametres;
drop policy if exists n1_param_ins on public.n1_parametres;
drop policy if exists n1_param_upd on public.n1_parametres;
drop policy if exists n1_param_del on public.n1_parametres;

create policy n1_param_sel on public.n1_parametres
  for select to authenticated using (public.est_actif());
-- Aucune écriture directe : tout passe par n1_definir_parametre().

revoke insert, update, delete on public.n1_parametres from authenticated;
revoke insert, update, delete on public.n1_parametres from anon;

-- Changement de plafond = événement auditable, jamais une écriture silencieuse.
create or replace function public.n1_definir_parametre(
  p_cle text,
  p_valeur_num numeric default null,
  p_valeur_txt text default null,
  p_valeur_bool boolean default null,
  p_motif text default null,
  p_portee text default 'GLOBAL',
  p_portee_ref text default null,
  p_unite text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ancien public.n1_parametres%rowtype;
  v_new    public.n1_parametres%rowtype;
  v_version integer;
begin
  if not public.est_bm() then
    perform public.n1_auditer('TENTATIVE_REFUSEE','n1_parametres',p_cle,null,
      jsonb_build_object('cle',p_cle), 'Rôle insuffisant', 'REFUSE');
    raise exception 'Seul le Branch Manager peut définir un paramètre'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_motif,'')),'') is null then
    raise exception 'Motif obligatoire pour définir ou modifier un paramètre';
  end if;
  if p_valeur_num is null and p_valeur_txt is null and p_valeur_bool is null then
    raise exception 'Aucune valeur fournie pour le paramètre « % »', p_cle;
  end if;

  select * into v_ancien from public.n1_parametres
  where cle = p_cle and portee = p_portee
    and coalesce(portee_ref,'*') = coalesce(p_portee_ref,'*') and actif = true
  for update;

  select coalesce(max(version),0) + 1 into v_version from public.n1_parametres
  where cle = p_cle and portee = p_portee
    and coalesce(portee_ref,'*') = coalesce(p_portee_ref,'*');

  if found then
    update public.n1_parametres set actif = false where id = v_ancien.id;
  end if;

  insert into public.n1_parametres(
    cle, portee, portee_ref, valeur_num, valeur_txt, valeur_bool, unite,
    version, actif, motif, valide_par, valide_le, created_by)
  values (
    p_cle, p_portee, p_portee_ref, p_valeur_num, p_valeur_txt, p_valeur_bool, p_unite,
    v_version, true, p_motif, public.n1_uid(), now(), public.n1_uid())
  returning * into v_new;

  perform public.n1_auditer(
    'CHANGEMENT_PLAFOND','n1_parametres', v_new.id::text,
    to_jsonb(v_ancien), to_jsonb(v_new), p_motif, 'ACCEPTE');

  return to_jsonb(v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 4bis) Journalisation d'un refus, hors transaction annulée
-- ---------------------------------------------------------------------------
-- Complément de la mesure ci-dessus : le client qui reçoit une erreur métier
-- rappelle cette RPC dans une NOUVELLE transaction. La ligne d'audit est alors
-- durable. Le client ne peut pas mentir sur l'utilisateur (auth.uid() fait foi)
-- mais il peut omettre l'appel : c'est pourquoi le RAISE WARNING existe aussi.

create or replace function public.n1_journaliser_refus(
  p_ressource text,
  p_motif text,
  p_enregistrement text default null,
  p_charge jsonb default null,
  p_correlation text default null,
  p_terminal text default null,
  p_rt text default null,
  p_cluster text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if public.n1_uid() is null then
    raise exception 'Journalisation de refus refusée hors session authentifiée';
  end if;
  return public.n1_auditer(
    'TENTATIVE_REFUSEE', p_ressource, p_enregistrement, null, p_charge,
    left(coalesce(p_motif,''), 2000), 'REFUSE', p_correlation, p_terminal, null,
    public.n1_param_txt('campagne_active'), p_cluster, p_rt);
end $$;

-- ---------------------------------------------------------------------------
-- 5) Droits d'exécution
-- ---------------------------------------------------------------------------

revoke all on function public.n1_auditer(text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text) from public;
revoke all on function public.n1_definir_parametre(text,numeric,text,boolean,text,text,text,text) from public;

grant execute on function public.n1_contexte() to authenticated;
grant execute on function public.n1_param_num(text,text,text,text) to authenticated;
grant execute on function public.n1_param_txt(text,text,text,text) to authenticated;
grant execute on function public.n1_auditer(text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.n1_definir_parametre(text,numeric,text,boolean,text,text,text,text) to authenticated;
grant execute on function public.n1_journaliser_refus(text,text,text,jsonb,text,text,text,text) to authenticated;

commit;

-- ============================================================================
-- APRÈS APPLICATION — à faire par le Branch Manager, une seule fois :
--
--   select public.n1_definir_parametre('campagne_active', null, 'AFLP2027',
--          null, 'Ouverture de la campagne 2027', 'GLOBAL');
--
-- Les autres paramètres (plafonds, tolérances) sont listés dans
-- docs/niveau1/05_CATALOGUE_REGLES_SERVEUR.md. Tant qu'ils ne sont pas saisis,
-- les opérations à risque correspondantes sont REFUSÉES — c'est voulu.
-- ============================================================================
