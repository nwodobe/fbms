-- ============================================================================
-- NIVEAU 1 — Migration 05 : LOT D — clôture, immutabilité, ajustements
-- Date : 2026-08-14 · Dépend de : 20260814_01 à 04
--
-- CE QUE CETTE MIGRATION FERME
--   P0-4  une opération clôturée reste modifiable directement
--
-- PRINCIPE
--   Après clôture, on ne corrige pas : on contre-passe. L'écriture d'origine
--   reste intacte et lisible ; la correction est une écriture supplémentaire,
--   motivée, prouvée, et approuvée par quelqu'un d'autre que son auteur.
--   L'écran peut afficher un cadenas ; c'est la base qui le ferme.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Verrou de clôture
-- ---------------------------------------------------------------------------

-- Deux degrés de fermeture, à ne pas confondre :
--   · VERROUILLÉ    : plus rien ne bouge. Seule sortie : un ajustement approuvé.
--   · GELÉ (partiel) : l'opération est réconciliée mais pas encore close ; elle
--     doit pouvoir passer à CLOTURE. Seule la colonne de statut est modifiable.
-- Une première version verrouillait RECONCILIE totalement : elle rendait la
-- transition RECONCILIE → CLOTURE impossible, donc la clôture inatteignable.
create or replace function public.n1_statuts_verrouilles()
returns text[] language sql immutable as $$
  select array['CLOTURE','ANNULE','AJUSTE']
$$;

create or replace function public.n1_statuts_geles()
returns text[] language sql immutable as $$
  select array['RECONCILIE']
$$;

create or replace function public.n1_verrou_cloture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ancien text;
  v_code   text;
  v_old jsonb;
  v_new jsonb;
  v_generees text[];
  k text;
begin
  v_ancien := old.n1_statut;
  v_code   := coalesce(to_jsonb(old) ->> 'achat_code', to_jsonb(old) ->> 'avance_code',
                       to_jsonb(old) ->> 'mouvement_code', old.id::text);

  if tg_op = 'DELETE' then
    if v_ancien = any (public.n1_statuts_verrouilles()) then
      perform public.n1_auditer('TENTATIVE_REFUSEE', tg_table_name, old.id::text,
        to_jsonb(old), null, 'Suppression d''une opération verrouillée', 'REFUSE');
      raise exception
        'Opération % en statut % : suppression interdite. Une correction passe par un ajustement (n1_demander_ajustement).',
        v_code, v_ancien using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if v_ancien = any (public.n1_statuts_verrouilles()) then
    -- Seule sortie autorisée : passer en AJUSTE, et uniquement depuis la RPC
    -- d'approbation d'ajustement, qui pose ce drapeau de session.
    if new.n1_statut = 'AJUSTE'
       and coalesce(current_setting('n1.ajustement_en_cours', true), '') = old.id::text then
      return new;
    end if;
    perform public.n1_auditer('TENTATIVE_REFUSEE', tg_table_name, old.id::text,
      to_jsonb(old), to_jsonb(new), 'Modification après clôture', 'REFUSE');
    raise exception
      'Opération % en statut % : modification directe interdite. Passez par un ajustement motivé et approuvé.',
      v_code, v_ancien using errcode = 'restrict_violation';
  end if;

  -- Gel partiel : réconcilié mais pas encore clos.
  if v_ancien = any (public.n1_statuts_geles()) then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    -- Les colonnes générées valent NULL dans NEW au sein d'un trigger BEFORE :
    -- les comparer signalerait un faux écart à chaque modification.
    select coalesce(array_agg(a.attname::text), array[]::text[]) into v_generees
    from pg_attribute a
    where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';

    for k in select jsonb_object_keys(v_new) loop
      if k <> 'n1_statut' and not (k = any (v_generees))
         and (v_old -> k) is distinct from (v_new -> k) then
        perform public.n1_auditer('TENTATIVE_REFUSEE', tg_table_name, old.id::text,
          v_old, v_new, 'Modification d''un champ sur une opération réconciliée : ' || k, 'REFUSE');
        raise exception
          'Opération % réconciliée : seul le passage à la clôture est possible. Le champ « % » est gelé.',
          v_code, k using errcode = 'restrict_violation';
      end if;
    end loop;
  end if;

  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['achats','avances','sacs_mouvements','n1_stock_mouvements'] loop
    if to_regclass('public.'||t) is not null then
      -- Rang 05 : ce verrou doit précéder tous les autres contrôles. Inutile de
      -- vérifier la légitimité d'une transition sur une écriture déjà close.
      execute format('drop trigger if exists trg_n1_05_verrou_cloture on public.%I', t);
      execute format(
        'create trigger trg_n1_05_verrou_cloture before update or delete on public.%I
         for each row execute function public.n1_verrou_cloture()', t);
    end if;
  end loop;
end $$;

-- sacs_mouvements et n1_stock_mouvements n'ont pas encore de colonne de statut.
alter table public.sacs_mouvements    add column if not exists n1_statut text not null default 'SOUMIS';
alter table public.n1_stock_mouvements add column if not exists n1_statut text not null default 'SOUMIS';

-- ---------------------------------------------------------------------------
-- 2) Registre des ajustements
-- ---------------------------------------------------------------------------

create table if not exists public.n1_ajustements (
  id              uuid primary key default gen_random_uuid(),
  ajustement_code text not null unique,
  campagne        text not null,
  cluster         text,
  rt_id           text,
  cycle_uid       uuid references public.n1_cycles(id),
  ressource       text not null,
  enregistrement  uuid not null,
  type_ajustement text not null,
  valeurs_avant   jsonb,
  valeurs_apres   jsonb,
  montant_delta   numeric,
  poids_delta     numeric,
  quantite_delta  numeric,
  motif           text not null,
  preuve          text not null,
  statut          text not null default 'DEMANDE',
  demande_par     uuid not null default public.n1_uid(),
  demande_le      timestamptz not null default now(),
  approuve_par    uuid,
  approuve_le     timestamptz,
  applique_le     timestamptz,
  refus_motif     text,
  auteur_origine  uuid,
  constraint n1_ajust_statut_chk check (statut in ('DEMANDE','APPROUVE','REFUSE','APPLIQUE')),
  constraint n1_ajust_type_chk check (type_ajustement in
    ('CONTRE_ECRITURE','CORRECTION_MONTANT','CORRECTION_POIDS','CORRECTION_QUANTITE','ANNULATION')),
  constraint n1_ajust_motif_chk  check (btrim(motif) <> ''),
  constraint n1_ajust_preuve_chk check (btrim(preuve) <> ''),
  -- Séparation des tâches, portée par la base : ni le demandeur, ni l'auteur de
  -- l'écriture d'origine ne peuvent approuver l'ajustement.
  constraint n1_ajust_pas_auto_appro   check (approuve_par is null or approuve_par <> demande_par),
  constraint n1_ajust_pas_auteur_appro check (approuve_par is null or auteur_origine is null
                                              or approuve_par <> auteur_origine)
);

create sequence if not exists public.n1_seq_ajustement start 1;
create index if not exists n1_ajust_res_idx   on public.n1_ajustements (ressource, enregistrement);
create index if not exists n1_ajust_cycle_idx on public.n1_ajustements (cycle_uid, statut);
create index if not exists n1_ajust_statut_idx on public.n1_ajustements (statut, demande_le desc);

alter table public.n1_ajustements enable row level security;
drop policy if exists n1_ajust_sel on public.n1_ajustements;
create policy n1_ajust_sel on public.n1_ajustements for select to authenticated using (public.est_actif());
revoke insert, update, delete on public.n1_ajustements from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3) Demande d'ajustement
-- ---------------------------------------------------------------------------

create or replace function public.n1_demander_ajustement(
  p_ressource text,
  p_enregistrement uuid,
  p_type text,
  p_motif text,
  p_preuve text,
  p_montant_delta numeric default null,
  p_poids_delta numeric default null,
  p_quantite_delta numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ligne  jsonb;
  v_ajust  public.n1_ajustements%rowtype;
  v_camp   text;
  v_cluster text;
  v_rt     text;
  v_cycle  uuid;
  v_auteur uuid;
begin
  if not public.n1_peut_controler() then
    raise exception 'Rôle insuffisant pour demander un ajustement'
      using errcode = 'insufficient_privilege';
  end if;
  if p_ressource not in ('achats','avances','sacs_mouvements','n1_stock_mouvements') then
    raise exception 'Ressource « % » non ajustable', p_ressource;
  end if;
  if nullif(btrim(coalesce(p_motif,'')),'') is null then
    raise exception 'Motif obligatoire pour un ajustement';
  end if;
  if nullif(btrim(coalesce(p_preuve,'')),'') is null then
    raise exception 'Preuve obligatoire pour un ajustement (référence du document justificatif)';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_ressource)
    into v_ligne using p_enregistrement;
  if v_ligne is null then
    raise exception 'Enregistrement % introuvable dans %', p_enregistrement, p_ressource;
  end if;

  v_camp    := v_ligne ->> 'campagne';
  v_cluster := v_ligne ->> 'cluster';
  v_rt      := v_ligne ->> 'rt_id';
  v_cycle   := nullif(v_ligne ->> 'cycle_uid','')::uuid;
  v_auteur  := nullif(v_ligne ->> 'created_by','')::uuid;

  insert into public.n1_ajustements(
    ajustement_code, campagne, cluster, rt_id, cycle_uid, ressource, enregistrement,
    type_ajustement, valeurs_avant, montant_delta, poids_delta, quantite_delta,
    motif, preuve, statut, demande_par, auteur_origine)
  values (
    'AJU-' || public.n1_code_court(coalesce(v_camp,'NA'), 8, 'NA') || '-'
      || lpad(nextval('public.n1_seq_ajustement')::text, 6, '0'),
    coalesce(v_camp, public.n1_param_txt('campagne_active')), v_cluster, v_rt, v_cycle,
    p_ressource, p_enregistrement, upper(p_type), public.n1_masquer(v_ligne),
    p_montant_delta, p_poids_delta, p_quantite_delta,
    p_motif, p_preuve, 'DEMANDE', public.n1_uid(), v_auteur)
  returning * into v_ajust;

  perform public.n1_auditer('AJUSTEMENT', p_ressource, p_enregistrement::text,
    v_ligne, to_jsonb(v_ajust), p_motif, 'ACCEPTE', v_ajust.ajustement_code,
    null, null, v_camp, v_cluster, v_rt);

  return to_jsonb(v_ajust);
end $$;

-- ---------------------------------------------------------------------------
-- 4) Approbation et application — contre-écriture, jamais réécriture
-- ---------------------------------------------------------------------------

create or replace function public.n1_approuver_ajustement(
  p_ajustement uuid, p_approuver boolean default true, p_motif text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ajust public.n1_ajustements%rowtype;
  v_ligne jsonb;
begin
  if not public.est_bm() then
    raise exception 'Seul le Branch Manager approuve un ajustement'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_ajust from public.n1_ajustements where id = p_ajustement for update;
  if not found then raise exception 'Ajustement introuvable'; end if;
  if v_ajust.statut <> 'DEMANDE' then
    raise exception 'Ajustement déjà traité (statut %)', v_ajust.statut;
  end if;
  if v_ajust.demande_par = public.n1_uid() then
    raise exception 'Séparation des tâches : le demandeur ne peut pas approuver son propre ajustement'
      using errcode = 'insufficient_privilege';
  end if;
  if v_ajust.auteur_origine is not null and v_ajust.auteur_origine = public.n1_uid() then
    raise exception 'Séparation des tâches : l''auteur de l''écriture d''origine ne peut pas approuver sa correction'
      using errcode = 'insufficient_privilege';
  end if;

  if not p_approuver then
    if nullif(btrim(coalesce(p_motif,'')),'') is null then
      raise exception 'Motif obligatoire pour refuser un ajustement';
    end if;
    update public.n1_ajustements
       set statut = 'REFUSE', approuve_par = public.n1_uid(), approuve_le = now(), refus_motif = p_motif
     where id = p_ajustement returning * into v_ajust;
    perform public.n1_auditer('REJET', v_ajust.ressource, v_ajust.enregistrement::text,
      null, to_jsonb(v_ajust), p_motif, 'ACCEPTE', v_ajust.ajustement_code);
    return to_jsonb(v_ajust);
  end if;

  -- Contre-écriture physique lorsqu'un poids est corrigé : le stock doit suivre.
  if coalesce(v_ajust.poids_delta, 0) <> 0 then
    insert into public.n1_stock_mouvements(
      local_id, cle_idempotence, campagne, type,
      source_type, source_ref, destination_type, destination_ref,
      cluster, rt_id, poids_kg, motif, created_by)
    values (
      'AJU-' || v_ajust.id::text, 'AJU-' || v_ajust.id::text, v_ajust.campagne, 'AJUSTEMENT',
      case when v_ajust.poids_delta < 0 then 'RT' else null end, v_ajust.rt_id,
      case when v_ajust.poids_delta > 0 then 'RT' else null end, v_ajust.rt_id,
      v_ajust.cluster, v_ajust.rt_id, abs(v_ajust.poids_delta),
      'Ajustement ' || v_ajust.ajustement_code || ' — ' || v_ajust.motif,
      public.n1_uid())
    on conflict (cle_idempotence) where cle_idempotence is not null do nothing;
  end if;

  -- L'écriture d'origine n'est pas réécrite : elle est marquée AJUSTE. Le
  -- drapeau de session est la seule clé qui ouvre le verrou de clôture, et il
  -- est posé ici, dans une transaction déjà contrôlée.
  perform set_config('n1.ajustement_en_cours', v_ajust.enregistrement::text, true);
  execute format('update public.%I set n1_statut = ''AJUSTE'' where id = $1', v_ajust.ressource)
    using v_ajust.enregistrement;
  perform set_config('n1.ajustement_en_cours', '', true);

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_ajust.ressource)
    into v_ligne using v_ajust.enregistrement;

  update public.n1_ajustements
     set statut = 'APPLIQUE', approuve_par = public.n1_uid(), approuve_le = now(),
         applique_le = now(), valeurs_apres = public.n1_masquer(v_ligne)
   where id = p_ajustement returning * into v_ajust;

  perform public.n1_auditer('APPROBATION', v_ajust.ressource, v_ajust.enregistrement::text,
    v_ajust.valeurs_avant, v_ligne, v_ajust.motif, 'ACCEPTE', v_ajust.ajustement_code,
    null, null, v_ajust.campagne, v_ajust.cluster, v_ajust.rt_id);

  return to_jsonb(v_ajust);
end $$;

revoke all on function public.n1_demander_ajustement(text,uuid,text,text,text,numeric,numeric,numeric) from public;
revoke all on function public.n1_approuver_ajustement(uuid,boolean,text) from public;
grant execute on function public.n1_demander_ajustement(text,uuid,text,text,text,numeric,numeric,numeric) to authenticated;
grant execute on function public.n1_approuver_ajustement(uuid,boolean,text) to authenticated;

commit;
