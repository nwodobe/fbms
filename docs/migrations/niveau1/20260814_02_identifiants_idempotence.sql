-- ============================================================================
-- NIVEAU 1 — Migration 02 : LOT A — identifiants uniques et idempotence
-- Date : 2026-08-14 · Dépend de : 20260814_01
--
-- CE QUE CETTE MIGRATION FERME
--   P0-1  reçu dupliqué (aucune contrainte d'unicité aujourd'hui)
--   P0-8  doublons de synchronisation (local_id unique mais NULLABLE)
--
-- PÉRIMÈTRE D'UNICITÉ DU REÇU — décision explicite, à valider par le métier
--   Retenu : UNIQUE (campagne, rt_id, numero_recu normalisé).
--   Pourquoi pas global : les carnets papier actuels sont numérotés à partir de
--   0001 par RT. Une unicité globale rejetterait à tort le reçu 0001 du
--   deuxième RT, alors que le risque réel — saisir deux fois le MÊME reçu
--   physique, donc payer deux fois — est toujours interne à un RT.
--   Après déploiement du LOT H, le numéro papier devient unique par
--   construction (AFLP-CAMPAGNE-CLUSTER-RT-SEQUENCE) et l'unicité globale
--   pourra être ajoutée sans risque : voir 20260814_09.
--
-- TOUTES les contraintes rétroactives sont posées NOT VALID : elles protègent
-- les lignes NOUVELLES sans juger l'historique. Exécuter d'abord
-- PRECHECK/precheck_doublons.sql pour mesurer l'historique.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Colonnes d'identité et de traçabilité de synchronisation
-- ---------------------------------------------------------------------------
-- cle_idempotence : produite par le terminal AVANT tout envoi ; rejoue sans doublon.
-- local_id        : identifiant local d'origine, conservé tel quel (traçabilité).
-- terminal_id     : quel appareil a produit l'écriture.
-- serveur_recu_le : accusé de réception SERVEUR — le terminal ne purge sa file
--                   locale que sur cette valeur, jamais sur une supposition.

do $$
declare t text;
begin
  foreach t in array array['achats','avances','reconciliations','sacs_mouvements'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists cle_idempotence text', t);
      execute format('alter table public.%I add column if not exists terminal_id text', t);
      execute format('alter table public.%I add column if not exists serveur_recu_le timestamptz not null default now()', t);
      execute format('alter table public.%I add column if not exists campagne text', t);
      execute format('alter table public.%I add column if not exists source_saisie text not null default ''APPLICATION''', t);

      -- Idempotence : une clé = une ligne, définitivement.
      execute format(
        'create unique index if not exists %I on public.%I (cle_idempotence) where cle_idempotence is not null',
        t||'_cle_idem_uidx', t);

      -- L'identifiant local devient obligatoire pour les nouvelles lignes.
      if not exists (select 1 from pg_constraint where conname = t||'_local_id_requis_chk') then
        execute format(
          'alter table public.%I add constraint %I check (local_id is not null and btrim(local_id) <> '''') not valid',
          t, t||'_local_id_requis_chk');
      end if;

      -- La clé d'idempotence devient obligatoire pour les nouvelles lignes.
      if not exists (select 1 from pg_constraint where conname = t||'_cle_idem_requise_chk') then
        execute format(
          'alter table public.%I add constraint %I check (cle_idempotence is not null and btrim(cle_idempotence) <> '''') not valid',
          t, t||'_cle_idem_requise_chk');
      end if;

      -- Origine de la saisie : application, reprise papier, ou correction.
      if not exists (select 1 from pg_constraint where conname = t||'_source_saisie_chk') then
        execute format(
          'alter table public.%I add constraint %I check (source_saisie in (''APPLICATION'',''PAPIER_SECOURS'',''REPRISE'',''AJUSTEMENT'')) not valid',
          t, t||'_source_saisie_chk');
      end if;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Normalisation du numéro de reçu
-- ---------------------------------------------------------------------------
-- Un reçu « 0012 », « 0012 » avec espace et « 0012 » en minuscules sont le même
-- reçu. Sans normalisation, l'unicité serait contournable par une espace.

create or replace function public.n1_normaliser_recu(p text)
returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- Colonne calculée : c'est ELLE qui porte l'unicité, pas le texte libre.
alter table public.achats
  add column if not exists numero_recu_norme text
  generated always as (public.n1_normaliser_recu(numero_recu)) stored;

-- ---------------------------------------------------------------------------
-- 3) P0-1 — Unicité du reçu
-- ---------------------------------------------------------------------------
-- Portée : campagne + RT. Les reçus vides ou absents ne sont pas contraints
-- (un achat sans reçu est déjà marqué refinancable = false par le métier).

create unique index if not exists achats_recu_campagne_rt_uidx
  on public.achats (coalesce(campagne,'?'), coalesce(rt_id,'?'), numero_recu_norme)
  where numero_recu_norme is not null;

-- ---------------------------------------------------------------------------
-- 4) Identifiants métier lisibles
-- ---------------------------------------------------------------------------
-- Un identifiant technique (uuid) reste la clé. Le code lisible sert au terrain,
-- au papier et au rapprochement ; l'intégrité ne repose jamais sur lui.

create sequence if not exists public.n1_seq_achat   start 1;
create sequence if not exists public.n1_seq_avance  start 1;
create sequence if not exists public.n1_seq_recon   start 1;
create sequence if not exists public.n1_seq_sac     start 1;

create or replace function public.n1_code_court(p text, p_taille integer default 3, p_defaut text default 'GEN')
returns text language sql immutable as $$
  select coalesce(
    nullif(upper(left(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g'), p_taille)), ''),
    p_defaut)
$$;

create or replace function public.n1_code_metier(
  p_prefixe text, p_campagne text, p_cluster text, p_sequence regclass)
returns text language plpgsql as $$
begin
  return p_prefixe || '-' || public.n1_code_court(coalesce(p_campagne,'NA'), 8, 'NA')
       || '-' || public.n1_code_court(p_cluster, 3, 'GEN')
       || '-' || lpad(nextval(p_sequence)::text, 6, '0');
end $$;

do $$
declare t text; c text;
begin
  foreach t in array array['achats','avances','reconciliations','sacs_mouvements'] loop
    if to_regclass('public.'||t) is not null then
      c := case t when 'achats' then 'achat_code' when 'avances' then 'avance_code'
                  when 'reconciliations' then 'recon_code' else 'sac_code' end;
      execute format('alter table public.%I add column if not exists %I text', t, c);
      execute format('create unique index if not exists %I on public.%I (%I) where %I is not null',
                     t||'_code_uidx', t, c, c);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Trigger commun : campagne, code métier, clé d'idempotence de repli
-- ---------------------------------------------------------------------------
-- La campagne n'est jamais devinée : elle vient du paramètre administré.
-- Si elle n'est pas définie, l'écriture est REFUSÉE (règle « absence = blocage »).

create or replace function public.n1_identite_avant_ecriture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_campagne text;
  v_prefixe  text;
  v_seq      regclass;
  v_col      text;
begin
  -- 5.1 Campagne
  if nullif(btrim(coalesce(new.campagne,'')),'') is null then
    v_campagne := public.n1_param_txt('campagne_active');
    if v_campagne is null then
      raise exception
        'Campagne active non définie : écriture refusée. Le Branch Manager doit exécuter n1_definir_parametre(''campagne_active'', null, ''AFLP2027'', null, ''motif'').'
        using errcode = 'restrict_violation';
    end if;
    new.campagne := v_campagne;
  end if;

  -- 5.2 Clé d'idempotence : à défaut de clé fournie par le terminal, on retombe
  -- sur l'identifiant local. Une écriture sans aucun des deux est refusée par
  -- la contrainte NOT VALID posée plus haut.
  if nullif(btrim(coalesce(new.cle_idempotence,'')),'') is null then
    new.cle_idempotence := nullif(btrim(coalesce(new.local_id,'')),'');
  end if;

  -- 5.3 Code métier lisible
  if tg_table_name = 'achats'          then v_prefixe := 'ACH'; v_seq := 'public.n1_seq_achat';  v_col := 'achat_code';
  elsif tg_table_name = 'avances'         then v_prefixe := 'AVA'; v_seq := 'public.n1_seq_avance'; v_col := 'avance_code';
  elsif tg_table_name = 'reconciliations' then v_prefixe := 'REC'; v_seq := 'public.n1_seq_recon';  v_col := 'recon_code';
  else                                          v_prefixe := 'SAC'; v_seq := 'public.n1_seq_sac';    v_col := 'sac_code';
  end if;

  if (to_jsonb(new) ->> v_col) is null then
    new := jsonb_populate_record(new, jsonb_build_object(
      v_col, public.n1_code_metier(v_prefixe, new.campagne, new.cluster, v_seq)));
  end if;

  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['achats','avances','reconciliations','sacs_mouvements'] loop
    if to_regclass('public.'||t) is not null then
      -- Les triggers d'un même événement s'exécutent dans l'ordre ALPHABÉTIQUE
      -- de leur nom. Le préfixe numérique est donc fonctionnel, pas décoratif :
      -- 10 pose l'identité (campagne, clé, code), 20 applique les gardes
      -- métier qui en dépendent, 90 journalise. Renommer un trigger sans tenir
      -- compte de ce rang casserait silencieusement les gardes.
      execute format('drop trigger if exists trg_n1_identite on public.%I', t);
      execute format('drop trigger if exists trg_n1_10_identite on public.%I', t);
      execute format(
        'create trigger trg_n1_10_identite before insert on public.%I
         for each row execute function public.n1_identite_avant_ecriture()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Immuabilité des identifiants
-- ---------------------------------------------------------------------------
-- Un identifiant que l'on peut réécrire n'identifie rien. Une fois posés,
-- id / local_id / cle_idempotence / code métier ne changent plus.

create or replace function public.n1_identite_immuable()
returns trigger language plpgsql as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_col text;
begin
  if old.id is distinct from new.id then
    raise exception 'Identifiant technique immuable (%.id)', tg_table_name using errcode = 'restrict_violation';
  end if;
  if old.local_id is distinct from new.local_id then
    raise exception 'Identifiant local immuable (%.local_id)', tg_table_name using errcode = 'restrict_violation';
  end if;
  if old.cle_idempotence is distinct from new.cle_idempotence then
    raise exception 'Clé d''idempotence immuable (%.cle_idempotence)', tg_table_name using errcode = 'restrict_violation';
  end if;
  v_col := case tg_table_name when 'achats' then 'achat_code' when 'avances' then 'avance_code'
                              when 'reconciliations' then 'recon_code' else 'sac_code' end;
  if (v_old ->> v_col) is distinct from (v_new ->> v_col) then
    raise exception 'Code métier immuable (%.%)', tg_table_name, v_col using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['achats','avances','reconciliations','sacs_mouvements'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_n1_identite_immuable on public.%I', t);
      execute format('drop trigger if exists trg_n1_10_identite_immuable on public.%I', t);
      execute format(
        'create trigger trg_n1_10_identite_immuable before update on public.%I
         for each row execute function public.n1_identite_immuable()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Audit des quatre tables sensibles
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['achats','avances','reconciliations','sacs_mouvements'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_n1_audit on public.%I', t);
      execute format('drop trigger if exists trg_n1_90_audit on public.%I', t);
      execute format(
        'create trigger trg_n1_90_audit after insert or update or delete on public.%I
         for each row execute function public.n1_audit_trigger()', t);
    end if;
  end loop;
end $$;

commit;

-- ============================================================================
-- VALIDATION DIFFÉRÉE DES CONTRAINTES
-- Une fois l'historique nettoyé (voir PRECHECK + REMEDIATION), et seulement
-- alors, chaque contrainte peut être validée sans verrou long :
--   alter table public.achats validate constraint achats_local_id_requis_chk;
-- Tant qu'elle n'est pas validée, elle protège déjà toute ligne nouvelle.
-- ============================================================================
