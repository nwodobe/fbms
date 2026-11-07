-- ============================================================================
-- NIVEAU 1 — Migration 09 : LOT H — protocole papier de secours numéroté
-- Date : 2026-08-14 · Dépend de : 20260814_01 à 08
--
-- POURQUOI
--   Quand le téléphone tombe, la campagne ne s'arrête pas : on achète sur
--   papier. Sans registre, ces achats reviennent plus tard sans preuve d'ordre
--   ni de complétude, et un formulaire manquant ne se voit jamais.
--
-- CE QUI PORTE L'INTÉGRITÉ
--   Le numéro lisible sert au terrain et au rapprochement. L'intégrité, elle,
--   repose sur l'identifiant technique et sur la contrainte d'unicité de la
--   ligne, jamais sur la lisibilité du numéro imprimé.
--
-- FORMAT
--   Configurable par le paramètre « format_numero_papier ». Proposition par
--   défaut : AFLP-{CAMPAGNE}-{CLUSTER}-{RT}-{SEQUENCE}.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Séries et plages attribuées
-- ---------------------------------------------------------------------------

create table if not exists public.n1_papier_series (
  id            uuid primary key default gen_random_uuid(),
  serie_code    text not null unique,
  campagne      text not null,
  cluster       text not null,
  rt_id         text,
  format        text not null default 'AFLP-{CAMPAGNE}-{CLUSTER}-{RT}-{SEQUENCE}',
  numero_debut  integer not null check (numero_debut > 0),
  numero_fin    integer not null check (numero_fin > 0),
  statut        text not null default 'CREEE',
  cree_par      uuid not null default public.n1_uid(),
  cree_le       timestamptz not null default now(),
  attribue_a    uuid,
  attribue_le   timestamptz,
  recu_par_nom  text,
  restitue_le   timestamptz,
  constraint n1_pap_serie_bornes_chk check (numero_fin >= numero_debut),
  constraint n1_pap_serie_statut_chk check (statut in ('CREEE','ATTRIBUEE','CLOTUREE','ANNULEE'))
);
create sequence if not exists public.n1_seq_papier_serie start 1;
create index if not exists n1_pap_serie_idx on public.n1_papier_series (campagne, cluster, rt_id, statut);

create table if not exists public.n1_papier_numeros (
  id             uuid primary key default gen_random_uuid(),
  serie_id       uuid not null references public.n1_papier_series(id),
  numero_lisible text not null,
  sequence       integer not null,
  campagne       text not null,
  cluster        text not null,
  rt_id          text,
  statut         text not null default 'DISPONIBLE',
  attribue_a     uuid,
  attribue_le    timestamptz,
  utilise_le     date,
  ressource      text,
  enregistrement uuid,
  justification  text,
  declare_par    uuid,
  declare_le     timestamptz,
  cloture_le     date,
  constraint n1_pap_num_statut_chk check (statut in
    ('DISPONIBLE','ATTRIBUE','UTILISE','ANNULE','PERDU','RESTITUE')),
  -- Un numéro sorti du circuit sans avoir servi doit être justifié : c'est la
  -- seule façon de distinguer un carnet mouillé d'un achat non déclaré.
  constraint n1_pap_num_justif_chk check (
    statut not in ('ANNULE','PERDU') or nullif(btrim(coalesce(justification,'')),'') is not null),
  -- Un numéro utilisé pointe l'opération qu'il justifie.
  constraint n1_pap_num_lien_chk check (
    statut <> 'UTILISE' or (ressource is not null and enregistrement is not null))
);

-- Aucun doublon possible, ni sur le numéro lisible ni dans la série.
create unique index if not exists n1_pap_num_lisible_uidx
  on public.n1_papier_numeros (campagne, numero_lisible);
create unique index if not exists n1_pap_num_seq_uidx
  on public.n1_papier_numeros (serie_id, sequence);
-- Un formulaire papier ne justifie qu'UNE opération.
create unique index if not exists n1_pap_num_operation_uidx
  on public.n1_papier_numeros (ressource, enregistrement)
  where enregistrement is not null;
create index if not exists n1_pap_num_statut_idx on public.n1_papier_numeros (statut, campagne, cluster);

-- Rattachement de l'opération numérique à son formulaire papier.
alter table public.achats add column if not exists papier_numero_id uuid references public.n1_papier_numeros(id);
create unique index if not exists achats_papier_uidx
  on public.achats (papier_numero_id) where papier_numero_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Création d'une série
-- ---------------------------------------------------------------------------

create or replace function public.n1_papier_formater(
  p_format text, p_campagne text, p_cluster text, p_rt text, p_sequence integer)
returns text language sql immutable as $$
  select replace(replace(replace(replace(
           coalesce(p_format,'AFLP-{CAMPAGNE}-{CLUSTER}-{RT}-{SEQUENCE}'),
           '{CAMPAGNE}', public.n1_code_court(p_campagne, 8, 'NA')),
           '{CLUSTER}',  public.n1_code_court(p_cluster, 3, 'GEN')),
           '{RT}',       public.n1_code_court(coalesce(p_rt,'GEN'), 4, 'GEN')),
           '{SEQUENCE}', lpad(p_sequence::text, 6, '0'))
$$;

create or replace function public.n1_papier_creer_serie(
  p_cluster text, p_rt_id text, p_numero_debut integer, p_numero_fin integer,
  p_format text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s public.n1_papier_series%rowtype;
  v_campagne text;
  v_format text;
  v_max integer;
  i integer;
begin
  if not public.est_bm() then
    raise exception 'Seul le Branch Manager crée une série de formulaires de secours'
      using errcode = 'insufficient_privilege';
  end if;
  v_campagne := public.n1_param_txt('campagne_active');
  if v_campagne is null then
    raise exception 'Campagne active non définie : création de série refusée';
  end if;
  if p_numero_fin < p_numero_debut then
    raise exception 'Bornes de série invalides';
  end if;
  v_max := coalesce(public.n1_param_num('taille_max_serie_papier'), 1000);
  if (p_numero_fin - p_numero_debut + 1) > v_max then
    raise exception 'Série de % numéros : au-delà du maximum autorisé (%)',
      (p_numero_fin - p_numero_debut + 1), v_max;
  end if;

  v_format := coalesce(p_format, public.n1_param_txt('format_numero_papier'),
                       'AFLP-{CAMPAGNE}-{CLUSTER}-{RT}-{SEQUENCE}');

  insert into public.n1_papier_series(
    serie_code, campagne, cluster, rt_id, format, numero_debut, numero_fin, statut)
  values (
    'SER-' || public.n1_code_court(v_campagne, 8, 'NA') || '-'
      || public.n1_code_court(p_cluster, 3, 'GEN') || '-'
      || lpad(nextval('public.n1_seq_papier_serie')::text, 4, '0'),
    v_campagne, p_cluster, p_rt_id, v_format, p_numero_debut, p_numero_fin, 'CREEE')
  returning * into v_s;

  -- Chaque numéro est matérialisé : un numéro qui n'existe pas en base ne peut
  -- pas être « manquant », et c'est justement ce qu'il faut pouvoir constater.
  for i in p_numero_debut .. p_numero_fin loop
    insert into public.n1_papier_numeros(
      serie_id, numero_lisible, sequence, campagne, cluster, rt_id, statut)
    values (v_s.id, public.n1_papier_formater(v_format, v_campagne, p_cluster, p_rt_id, i),
            i, v_campagne, p_cluster, p_rt_id, 'DISPONIBLE');
  end loop;

  perform public.n1_auditer('ATTRIBUTION_PAPIER','n1_papier_series',v_s.id::text,
    null, to_jsonb(v_s), 'Création de série', 'ACCEPTE', null, null, null,
    v_campagne, p_cluster, p_rt_id);

  return to_jsonb(v_s);
end $$;

-- ---------------------------------------------------------------------------
-- 3) Attribution d'une plage à un responsable
-- ---------------------------------------------------------------------------

create or replace function public.n1_papier_attribuer(
  p_serie uuid, p_responsable uuid, p_recu_par_nom text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s public.n1_papier_series%rowtype; v_n integer;
begin
  if not public.n1_peut_controler() then
    raise exception 'Rôle insuffisant pour attribuer une série'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_recu_par_nom,'')),'') is null then
    raise exception 'Nom du responsable qui reçoit la plage obligatoire';
  end if;

  select * into v_s from public.n1_papier_series where id = p_serie for update;
  if not found then raise exception 'Série introuvable'; end if;
  if v_s.statut <> 'CREEE' then
    raise exception 'Série % déjà attribuée ou close (statut %)', v_s.serie_code, v_s.statut;
  end if;
  if not exists (select 1 from public.profils where user_id = p_responsable and actif = true) then
    raise exception 'Responsable inconnu ou inactif';
  end if;

  update public.n1_papier_series
     set statut = 'ATTRIBUEE', attribue_a = p_responsable, attribue_le = now(),
         recu_par_nom = p_recu_par_nom
   where id = p_serie returning * into v_s;

  update public.n1_papier_numeros
     set statut = 'ATTRIBUE', attribue_a = p_responsable, attribue_le = now()
   where serie_id = p_serie and statut = 'DISPONIBLE';
  get diagnostics v_n = row_count;

  perform public.n1_auditer('ATTRIBUTION_PAPIER','n1_papier_series',p_serie::text,
    null, jsonb_build_object('responsable', p_responsable, 'recu_par', p_recu_par_nom,
                             'numeros', v_n),
    'Attribution de plage', 'ACCEPTE', null, null, null, v_s.campagne, v_s.cluster, v_s.rt_id);

  return jsonb_build_object('serie', to_jsonb(v_s), 'numeros_attribues', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- 4) Saisie ultérieure : le formulaire papier justifie l'opération numérique
-- ---------------------------------------------------------------------------

create or replace function public.n1_papier_consommer(
  p_numero_lisible text, p_ressource text, p_enregistrement uuid, p_date_utilisation date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n public.n1_papier_numeros%rowtype;
begin
  select * into v_n from public.n1_papier_numeros
  where campagne = public.n1_param_txt('campagne_active')
    and numero_lisible = upper(btrim(p_numero_lisible))
  for update;
  if not found then
    raise exception 'Numéro papier « % » inconnu du registre : saisie refusée. Un formulaire hors registre ne peut pas justifier une opération.',
      p_numero_lisible using errcode = 'foreign_key_violation';
  end if;
  if v_n.statut = 'UTILISE' then
    raise exception 'Numéro papier % déjà utilisé pour l''opération % : doublon refusé',
      v_n.numero_lisible, v_n.enregistrement using errcode = 'unique_violation';
  end if;
  if v_n.statut in ('ANNULE','PERDU') then
    raise exception 'Numéro papier % déclaré % : il ne peut pas justifier une opération',
      v_n.numero_lisible, lower(v_n.statut) using errcode = 'restrict_violation';
  end if;
  if v_n.statut = 'DISPONIBLE' then
    raise exception 'Numéro papier % non attribué : attribuer la plage avant utilisation',
      v_n.numero_lisible using errcode = 'restrict_violation';
  end if;

  update public.n1_papier_numeros
     set statut = 'UTILISE', ressource = p_ressource, enregistrement = p_enregistrement,
         utilise_le = coalesce(p_date_utilisation, current_date)
   where id = v_n.id returning * into v_n;

  if p_ressource = 'achats' then
    -- n1_champs_modifiables gèle tout sauf le statut pour un rôle non-BM, et
    -- SECURITY DEFINER ne change pas l'identité vue par est_bm(). Le drapeau de
    -- session ouvre cette écriture précise, depuis cette RPC déjà contrôlée —
    -- même mécanisme que pour l'application d'un ajustement.
    perform set_config('n1.papier_en_cours', p_enregistrement::text, true);
    update public.achats
       set papier_numero_id = v_n.id, source_saisie = 'PAPIER_SECOURS'
     where id = p_enregistrement;
    perform set_config('n1.papier_en_cours', '', true);
  end if;

  perform public.n1_auditer('ATTRIBUTION_PAPIER', p_ressource, p_enregistrement::text,
    null, to_jsonb(v_n), 'Rapprochement papier ' || v_n.numero_lisible, 'ACCEPTE',
    null, null, null, v_n.campagne, v_n.cluster, v_n.rt_id);

  return to_jsonb(v_n);
end $$;

-- ---------------------------------------------------------------------------
-- 5) Numéro annulé, perdu ou restitué — toujours justifié
-- ---------------------------------------------------------------------------

create or replace function public.n1_papier_declarer(
  p_numero_lisible text, p_statut text, p_justification text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n public.n1_papier_numeros%rowtype;
begin
  if not public.n1_peut_controler() then
    raise exception 'Rôle insuffisant pour déclarer un numéro papier'
      using errcode = 'insufficient_privilege';
  end if;
  if upper(p_statut) not in ('ANNULE','PERDU','RESTITUE') then
    raise exception 'Statut de déclaration invalide (ANNULE, PERDU ou RESTITUE attendu)';
  end if;
  if nullif(btrim(coalesce(p_justification,'')),'') is null then
    raise exception 'Justification obligatoire : un numéro qui sort du circuit sans explication est une alerte, pas une écriture';
  end if;

  select * into v_n from public.n1_papier_numeros
  where campagne = public.n1_param_txt('campagne_active')
    and numero_lisible = upper(btrim(p_numero_lisible)) for update;
  if not found then raise exception 'Numéro papier inconnu'; end if;
  if v_n.statut = 'UTILISE' then
    raise exception 'Numéro % déjà utilisé : passer par un ajustement, pas par une déclaration',
      v_n.numero_lisible using errcode = 'restrict_violation';
  end if;

  update public.n1_papier_numeros
     set statut = upper(p_statut), justification = p_justification,
         declare_par = public.n1_uid(), declare_le = now()
   where id = v_n.id returning * into v_n;

  if upper(p_statut) = 'PERDU' then
    perform public.n1_lever_anomalie('PAPIER_MANQUANT','P1',
      'Formulaire de secours ' || v_n.numero_lisible || ' déclaré perdu : ' || p_justification,
      'n1_papier_numeros', v_n.id::text, v_n.rt_id, v_n.cluster);
  end if;

  perform public.n1_auditer('ATTRIBUTION_PAPIER','n1_papier_numeros',v_n.id::text,
    null, to_jsonb(v_n), p_justification, 'ACCEPTE', null, null, null,
    v_n.campagne, v_n.cluster, v_n.rt_id);

  return to_jsonb(v_n);
end $$;

-- ---------------------------------------------------------------------------
-- 6) Clôture quotidienne — ce qui n'est ni utilisé ni justifié est une alerte
-- ---------------------------------------------------------------------------

create or replace function public.n1_papier_cloture_quotidienne(
  p_cluster text default null, p_date date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, current_date);
  v_utilises integer;
  v_manquants integer := 0;
  v_r record;
begin
  if not public.n1_peut_controler() then
    raise exception 'Rôle insuffisant pour la clôture quotidienne du registre papier'
      using errcode = 'insufficient_privilege';
  end if;

  update public.n1_papier_numeros
     set cloture_le = v_date
   where statut = 'UTILISE' and utilise_le = v_date and cloture_le is null
     and (p_cluster is null or upper(cluster) = upper(p_cluster));
  get diagnostics v_utilises = row_count;

  -- Un numéro attribué, encadré par deux numéros utilisés le même jour, mais
  -- qui n'est ni utilisé ni justifié : c'est un trou dans la séquence.
  for v_r in
    select n.* from public.n1_papier_numeros n
    where n.statut = 'ATTRIBUE'
      and (p_cluster is null or upper(n.cluster) = upper(p_cluster))
      and exists (select 1 from public.n1_papier_numeros a
                  where a.serie_id = n.serie_id and a.sequence < n.sequence
                    and a.statut = 'UTILISE' and a.utilise_le <= v_date)
      and exists (select 1 from public.n1_papier_numeros b
                  where b.serie_id = n.serie_id and b.sequence > n.sequence
                    and b.statut = 'UTILISE' and b.utilise_le <= v_date)
  loop
    perform public.n1_lever_anomalie('PAPIER_MANQUANT','P1',
      'Formulaire ' || v_r.numero_lisible || ' non utilisé et non justifié, alors que des numéros '
        || 'antérieurs ET postérieurs de la même série ont servi',
      'n1_papier_numeros', v_r.id::text, v_r.rt_id, v_r.cluster);
    v_manquants := v_manquants + 1;
  end loop;

  perform public.n1_auditer('CLOTURE','n1_papier_numeros', null, null,
    jsonb_build_object('date', v_date, 'utilises', v_utilises, 'manquants', v_manquants),
    'Clôture quotidienne du registre papier', 'ACCEPTE', null, null, null, null, p_cluster);

  return jsonb_build_object('date', v_date, 'cluster', p_cluster,
    'numeros_clotures', v_utilises, 'anomalies_levees', v_manquants);
end $$;

-- ---------------------------------------------------------------------------
-- 7) Registre imprimable et RLS
-- ---------------------------------------------------------------------------

create or replace view public.n1_vue_registre_papier as
select s.serie_code, s.campagne, s.cluster, s.rt_id, s.numero_debut, s.numero_fin,
       s.statut as statut_serie, s.recu_par_nom, s.attribue_le,
       n.numero_lisible, n.statut as statut_numero, n.utilise_le, n.ressource,
       n.enregistrement, n.justification, n.cloture_le
from public.n1_papier_series s
join public.n1_papier_numeros n on n.serie_id = s.id;
grant select on public.n1_vue_registre_papier to authenticated;

do $$
declare t text;
begin
  foreach t in array array['n1_papier_series','n1_papier_numeros'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.est_actif())', t||'_sel', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

grant execute on function public.n1_papier_creer_serie(text,text,integer,integer,text) to authenticated;
grant execute on function public.n1_papier_attribuer(uuid,uuid,text) to authenticated;
grant execute on function public.n1_papier_consommer(text,text,uuid,date) to authenticated;
grant execute on function public.n1_papier_declarer(text,text,text) to authenticated;
grant execute on function public.n1_papier_cloture_quotidienne(text,date) to authenticated;

commit;
