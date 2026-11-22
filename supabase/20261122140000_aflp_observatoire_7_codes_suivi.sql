-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 · migration 7 : CODES DE SUIVI A001 à A012
-- Mandat du Branch Manager du 22/11/2026 (numérotation libre des 12 arbres).
-- ---------------------------------------------------------------------
-- STATUT : NON APPLIQUÉE EN PRODUCTION. Testée sur le staging local fidèle
--          (tests/observatoire/tests_codes_suivi.py). Application en production
--          = décision explicite du Branch Manager.
-- PRINCIPE
--   * Le code physique d'inventaire (pheno_arbres.code, ex. B01/A001) N'EST PAS
--     modifié : il reste l'identifiant terrain bloc + numéro dans le bloc.
--   * Nouveau code de suivi PERSONNALISÉ (pheno_arbres.code_suivi), A001 à A012,
--     indépendant des blocs, choisi par le Chef d'Unité pour les 10 arbres suivis
--     et les 2 réserves. Unique PAR CHAMP (panel) : un autre champ peut réutiliser
--     A001. L'identifiant technique permanent (pheno_arbres.id) ne change jamais.
--   * Unicité garantie par la BASE (contrainte), y compris en cas de deux appareils
--     concurrents : la désignation verrouille le champ (FOR UPDATE), la seconde
--     désignation différente reçoit un CONFLIT (PH409).
--   * Toute modification après attribution passe par pheno_arbres_codes_modifier :
--     motif obligatoire, version attendue (conflit si le champ a changé), journal
--     immuable (ancien et nouveau code de chaque arbre).
--   * Chaque observation enregistre le code de suivi en vigueur au moment de la
--     saisie (pheno_observations.code_suivi) : une visite antérieure garde son code.
-- ADDITIVE : aucune table supprimée, aucune donnée effacée, aucun inventaire modifié,
--   aucun arbre créé. Les champs déjà désignés restent sans code (null) tant que le
--   Chef d'Unité ne les attribue pas ; les anciens téléphones (sans code) restent
--   compatibles : le serveur attribue alors l'ordre par défaut (suivis 01..10 =
--   A001..A010, réserves R1/R2 = A011/A012).
-- RETOUR ARRIÈRE : supabase/20261122140100_aflp_observatoire_7_rollback.sql
-- REJOUABLE : oui.
-- =====================================================================
begin;

-- ---------------------------------------------------------------- colonnes
alter table public.pheno_arbres add column if not exists code_suivi text;
alter table public.pheno_arbres add column if not exists code_suivi_le timestamptz;
alter table public.pheno_arbres add column if not exists code_suivi_par uuid;
alter table public.pheno_arbres drop constraint if exists pheno_arbres_code_suivi_format;
alter table public.pheno_arbres add constraint pheno_arbres_code_suivi_format
  check (code_suivi is null or code_suivi ~ '^A0(0[1-9]|1[0-2])$');
-- Unicité par champ. DIFFÉRABLE : un échange (A001 <-> A008) se fait dans une seule
-- instruction sans collision intermédiaire. Les valeurs nulles (champs anciens) ne
-- se gênent pas entre elles.
alter table public.pheno_arbres drop constraint if exists pheno_arbres_code_suivi_unique;
alter table public.pheno_arbres add constraint pheno_arbres_code_suivi_unique
  unique (panel_id, code_suivi) deferrable initially immediate;

-- Code de suivi en vigueur au moment de l'observation (historique des visites).
alter table public.pheno_observations add column if not exists code_suivi text;

create or replace function private.pheno_obs_code_suivi() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if new.code_suivi is null then
    select a.code_suivi into new.code_suivi from public.pheno_arbres a where a.id = new.arbre_id;
  end if;
  return new;
end $$;
revoke all on function private.pheno_obs_code_suivi() from public, anon, authenticated;
drop trigger if exists pheno_obs_code_suivi on public.pheno_observations;
create trigger pheno_obs_code_suivi before insert on public.pheno_observations
  for each row execute function private.pheno_obs_code_suivi();

-- Paramètre du protocole (lecture seule pour les appareils).
update public.pheno_protocoles set parametres = parametres || jsonb_build_object(
  'codes_suivi', 'A001..A012 uniques par champ, choisis par le Chef d''Unité ; code physique B00/A000 conservé')
where actif and not (parametres ? 'codes_suivi');

-- ---------------------------------------------------------------- aides
create or replace function private.pheno_code_suivi(p_rang integer) returns text
language sql immutable set search_path to 'public', 'pg_temp' as $$ select 'A' || lpad(p_rang::text, 3, '0') $$;

-- ---------------------------------------------------------------- désignation
-- Reprend la désignation de la migration 5 et ajoute le code de suivi :
--   · chaque arbre peut porter code_suivi ; soit AUCUN arbre n'en porte (ancien
--     téléphone : ordre par défaut), soit TOUS en portent, exactement A001..A012 ;
--   · rejeu identique (y compris codes) accepté ; tout écart = CONFLIT.
create or replace function public.pheno_arbres_designer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_panel public.pheno_panels; v_proto public.pheno_protocoles; v_tit integer; v_res integer; v_a jsonb; v_b public.pheno_blocs;
  v_num integer; v_role text; v_rt integer := 0; v_rr integer := 0; v_cles text[] := '{}'; v_cle text; v_liste jsonb := '[]'::jsonb;
  v_n_t integer; v_n_r integer; v_ex text[]; v_ex_codes text[]; v_dem_codes text[];
  v_n_codes integer; v_code text; v_codes text[] := '{}'; v_attendus text[];
begin
  select * into v_panel from public.pheno_panels where id = (p->>'panel_id')::uuid for update;
  if not found then raise exception 'Champ de l''Observatoire introuvable.' using errcode = 'PH002'; end if;
  if not (private.pheno_classe() = 'BM' or (private.pheno_classe() = 'UH' and v_panel.cluster_code = private.pheno_mon_cluster())) then
    raise exception 'Le choix des arbres est réservé au Chef d''Unité du cluster %.', v_panel.cluster_code using errcode = 'PH001'; end if;
  if v_panel.mode_selection <> 'DESIGNATION' then
    raise exception 'Ce champ a été installé par tirage : ses arbres ne se désignent pas.' using errcode = 'PH002'; end if;
  if jsonb_typeof(p->'arbres') <> 'array' then raise exception 'Liste d''arbres invalide.' using errcode = 'PH002'; end if;
  select count(*) filter (where nullif(btrim(x->>'code_suivi'), '') is not null) into v_n_codes from jsonb_array_elements(p->'arbres') x;

  -- Rejeu (même téléphone ou autre) : accepté sans rien changer s'il est identique. Sinon, conflit.
  if exists (select 1 from public.pheno_arbres where panel_id = v_panel.id) then
    select array_agg(k order by k) into v_ex from (
      select a.bloc_id::text || ':' || a.numero_inventaire || ':' || a.role as k
      from public.pheno_arbres a where a.panel_id = v_panel.id and a.remplace_arbre_id is null) s;
    if v_ex = (select array_agg(k order by k) from (select (x->>'bloc_id') || ':' || (x->>'numero') || ':' || (x->>'role') as k
                                                    from jsonb_array_elements(p->'arbres') x) s2) then
      if v_n_codes = 0 then
        return jsonb_build_object('panel_id', v_panel.id, 'deja_designe', true, 'statut_panel', v_panel.statut);
      end if;
      select array_agg(k order by k) into v_ex_codes from (
        select a.bloc_id::text || ':' || a.numero_inventaire || ':' || coalesce(a.code_suivi, '-') as k
        from public.pheno_arbres a where a.panel_id = v_panel.id) s;
      select array_agg(k order by k) into v_dem_codes from (
        select (x->>'bloc_id') || ':' || (x->>'numero') || ':' || coalesce(upper(btrim(x->>'code_suivi')), '-') as k
        from jsonb_array_elements(p->'arbres') x) s2;
      if v_ex_codes = v_dem_codes then
        return jsonb_build_object('panel_id', v_panel.id, 'deja_designe', true, 'statut_panel', v_panel.statut);
      end if;
      raise exception 'Les arbres de ce champ sont déjà désignés avec d''autres codes de suivi (autre appareil ?). Pour changer un code, utilisez la modification motivée.' using errcode = 'PH409';
    end if;
    raise exception 'Les arbres de ce champ sont déjà désignés. Pour changer un arbre, utilisez le remplacement avec motif.' using errcode = 'PH409';
  end if;
  if v_panel.statut <> 'TIRAGE_VERROUILLE' then raise exception 'Le champ n''attend pas de désignation (statut %).', v_panel.statut using errcode = 'PH002'; end if;
  if exists (select 1 from public.pheno_blocs where panel_id = v_panel.id and tire and nb_arbres_inventories is null) then
    raise exception 'Comptez d''abord tous les arbres de chaque bloc suivi.' using errcode = 'PH002'; end if;

  select * into v_proto from public.pheno_protocoles where id = v_panel.protocole_id;
  v_tit := coalesce((v_proto.parametres->>'titulaires')::integer, 10);
  v_res := coalesce((v_proto.parametres->>'reserves')::integer, 2);
  select count(*) filter (where x->>'role' = 'TITULAIRE'), count(*) filter (where x->>'role' = 'RESERVE')
    into v_n_t, v_n_r from jsonb_array_elements(p->'arbres') x;
  if v_n_t <> v_tit or v_n_r <> v_res or jsonb_array_length(p->'arbres') <> v_tit + v_res then
    raise exception 'Choisissez exactement % arbres suivis et % arbres de réserve (reçu : % et %).', v_tit, v_res, v_n_t, v_n_r using errcode = 'PH002'; end if;

  -- Codes de suivi : tout ou rien, exactement A001..A(T+R), chacun une seule fois.
  if v_n_codes <> 0 then
    if v_tit + v_res > 12 then raise exception 'Les codes de suivi ne couvrent que 12 arbres (A001 à A012).' using errcode = 'PH002'; end if;
    if v_n_codes <> v_tit + v_res then
      raise exception 'Attribuez un code de suivi à chacun des % arbres (reçu : %).', v_tit + v_res, v_n_codes using errcode = 'PH002'; end if;
    select array_agg(private.pheno_code_suivi(g) order by g) into v_attendus from generate_series(1, v_tit + v_res) g;
    for v_a in select * from jsonb_array_elements(p->'arbres') loop
      v_code := upper(btrim(v_a->>'code_suivi'));
      if not (v_code = any (v_attendus)) then
        raise exception 'Code de suivi % refusé : seuls % à % sont autorisés.', v_code, v_attendus[1], v_attendus[array_length(v_attendus, 1)] using errcode = 'PH002'; end if;
      if v_code = any (v_codes) then
        raise exception 'Le code de suivi % est attribué à deux arbres : chaque code ne s''utilise qu''une fois par champ.', v_code using errcode = 'PH002'; end if;
      v_codes := v_codes || v_code;
    end loop;
  end if;

  for v_a in select * from jsonb_array_elements(p->'arbres') loop
    select * into v_b from public.pheno_blocs where id = (v_a->>'bloc_id')::uuid and panel_id = v_panel.id;
    if not found or not v_b.tire then raise exception 'Un arbre choisi n''appartient pas à un bloc suivi de ce champ.' using errcode = 'PH002'; end if;
    v_num := (v_a->>'numero')::integer; v_role := v_a->>'role';
    if v_num is null or v_num < 1 or v_num > v_b.nb_arbres_inventories then
      raise exception 'Bloc %, arbre % : le numéro doit être compris entre 1 et % (arbres comptés dans le bloc).', lpad(v_b.numero::text, 2, '0'), coalesce(v_num::text, '?'), v_b.nb_arbres_inventories using errcode = 'PH002'; end if;
    v_cle := v_b.id::text || ':' || v_num;
    if v_cle = any (v_cles) then
      raise exception 'L''arbre % est choisi deux fois.', private.pheno_code_arbre(v_b.numero, v_num) using errcode = 'PH002'; end if;
    v_cles := v_cles || v_cle;
    if v_role = 'TITULAIRE' then v_rt := v_rt + 1; else v_rr := v_rr + 1; end if;
    v_code := case when v_n_codes <> 0 then upper(btrim(v_a->>'code_suivi'))
                   when v_tit + v_res <= 12 then private.pheno_code_suivi(case when v_role = 'TITULAIRE' then v_rt else v_tit + v_rr end) end;
    insert into public.pheno_arbres (id, panel_id, bloc_id, code, numero_inventaire, role, rang, statut, proba_inclusion, designe_par, date_effet,
      code_suivi, code_suivi_le, code_suivi_par)
    values (private.pheno_arbre_id(v_b.id, v_num), v_panel.id, v_b.id, private.pheno_code_arbre(v_b.numero, v_num), v_num, v_role,
      case when v_role = 'TITULAIRE' then v_rt else v_rr end, case when v_role = 'TITULAIRE' then 'ACTIF' else 'RESERVE_EN_ATTENTE' end,
      null, auth.uid(), private.pheno_aujourdhui(), v_code, case when v_code is not null then now() end, case when v_code is not null then auth.uid() end);
    v_liste := v_liste || jsonb_build_object('code', private.pheno_code_arbre(v_b.numero, v_num), 'code_suivi', v_code, 'role', v_role);
  end loop;

  update public.pheno_panels set statut = 'ACTIF', designe_par = auth.uid(), designe_le = now(), reserves_manquantes = 0,
    row_version = row_version + 1, updated_at = now() where id = v_panel.id;
  perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', v_panel.id, 'DESIGNATION_ARBRES', null,
    jsonb_build_object('designe_par', auth.uid(), 'arbres', v_liste, 'appareil', p->>'device_id',
      'codes_suivi', case when v_n_codes <> 0 then 'CHOISIS' else 'ORDRE_PAR_DEFAUT' end,
      'avertissement', 'Suivi d''arbres désignés : pas un échantillon statistiquement représentatif.'), null);
  return jsonb_build_object('panel_id', v_panel.id, 'statut_panel', 'ACTIF',
    'arbres', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'code_suivi', a.code_suivi, 'role', a.role, 'rang', a.rang) order by a.role desc, a.rang), '[]')
               from public.pheno_arbres a where a.panel_id = v_panel.id));
end $$;

-- ---------------------------------------------------------------- modification motivée
-- Attribue ou modifie les 12 codes d'un champ désigné, en une seule fois (échanges
-- possibles). p = { panel_id, base_version, motif, codes: [{ arbre_id, code_suivi }] }.
-- Les 12 arbres du champ (y compris remplacés et réserves) doivent être listés.
create or replace function public.pheno_arbres_codes_modifier(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_panel public.pheno_panels; v_n integer; v_nb_arbres integer; v_motif text := nullif(btrim(p->>'motif'), '');
  v_attendus text[]; v_code text; v_codes text[] := '{}'; v_x jsonb; v_avant jsonb; v_apres jsonb; v_init boolean;
begin
  select * into v_panel from public.pheno_panels where id = (p->>'panel_id')::uuid for update;
  if not found then raise exception 'Champ de l''Observatoire introuvable.' using errcode = 'PH002'; end if;
  if not (private.pheno_classe() = 'BM' or (private.pheno_classe() = 'UH' and v_panel.cluster_code = private.pheno_mon_cluster())) then
    raise exception 'Les codes de suivi sont attribués par le Chef d''Unité du cluster %.', v_panel.cluster_code using errcode = 'PH001'; end if;
  if v_panel.mode_selection <> 'DESIGNATION' then
    raise exception 'Ce champ a été installé par tirage : il n''utilise pas les codes A001 à A012.' using errcode = 'PH002'; end if;
  if (p->>'base_version') is not null and (p->>'base_version')::integer <> v_panel.row_version then
    raise exception 'Le champ a été modifié depuis votre lecture (autre appareil). Actualisez puis recommencez.' using errcode = 'PH409'; end if;
  if v_motif is null then raise exception 'Motif obligatoire pour attribuer ou modifier les codes de suivi.' using errcode = 'PH002'; end if;
  if jsonb_typeof(p->'codes') <> 'array' then raise exception 'Liste des codes invalide.' using errcode = 'PH002'; end if;

  select count(*), bool_and(code_suivi is null) into v_nb_arbres, v_init from public.pheno_arbres where panel_id = v_panel.id;
  if v_nb_arbres = 0 then raise exception 'Les arbres de ce champ ne sont pas encore désignés.' using errcode = 'PH002'; end if;
  if v_nb_arbres > 12 then raise exception 'Les codes de suivi ne couvrent que 12 arbres.' using errcode = 'PH002'; end if;
  select array_agg(private.pheno_code_suivi(g) order by g) into v_attendus from generate_series(1, v_nb_arbres) g;
  v_n := jsonb_array_length(p->'codes');
  if v_n <> v_nb_arbres then
    raise exception 'Indiquez le code des % arbres du champ (reçu : %).', v_nb_arbres, v_n using errcode = 'PH002'; end if;
  for v_x in select * from jsonb_array_elements(p->'codes') loop
    if not exists (select 1 from public.pheno_arbres where id = (v_x->>'arbre_id')::uuid and panel_id = v_panel.id) then
      raise exception 'Arbre étranger à ce champ.' using errcode = 'PH002'; end if;
    v_code := upper(btrim(v_x->>'code_suivi'));
    if v_code is null or not (v_code = any (v_attendus)) then
      raise exception 'Code de suivi % refusé : seuls % à % sont autorisés.', coalesce(v_code, '(vide)'), v_attendus[1], v_attendus[v_nb_arbres] using errcode = 'PH002'; end if;
    if v_code = any (v_codes) then
      raise exception 'Le code de suivi % est attribué à deux arbres.', v_code using errcode = 'PH002'; end if;
    v_codes := v_codes || v_code;
  end loop;
  if (select count(distinct (x->>'arbre_id')) from jsonb_array_elements(p->'codes') x) <> v_nb_arbres then
    raise exception 'Un arbre est listé deux fois.' using errcode = 'PH002'; end if;

  select jsonb_object_agg(a.code, a.code_suivi) into v_avant from public.pheno_arbres a where a.panel_id = v_panel.id;
  select jsonb_object_agg(a.code, upper(btrim(x->>'code_suivi'))) into v_apres
    from jsonb_array_elements(p->'codes') x join public.pheno_arbres a on a.id = (x->>'arbre_id')::uuid;
  if v_avant = v_apres then
    return jsonb_build_object('panel_id', v_panel.id, 'inchange', true, 'row_version', v_panel.row_version);
  end if;

  update public.pheno_arbres a set code_suivi = upper(btrim(x->>'code_suivi')), code_suivi_le = now(), code_suivi_par = auth.uid()
    from jsonb_array_elements(p->'codes') x
    where a.id = (x->>'arbre_id')::uuid and a.panel_id = v_panel.id and a.code_suivi is distinct from upper(btrim(x->>'code_suivi'));
  update public.pheno_panels set row_version = row_version + 1, updated_at = now() where id = v_panel.id;
  perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', v_panel.id,
    case when v_init then 'CODES_SUIVI_ATTRIBUES' else 'CODES_SUIVI_MODIFIES' end,
    jsonb_build_object('codes', v_avant), jsonb_build_object('codes', v_apres, 'appareil', p->>'device_id'), v_motif);
  return jsonb_build_object('panel_id', v_panel.id, 'row_version', v_panel.row_version + 1,
    'arbres', (select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'code_suivi', a.code_suivi) order by a.code_suivi)
               from public.pheno_arbres a where a.panel_id = v_panel.id));
end $$;

revoke all on function private.pheno_code_suivi(integer) from public, anon, authenticated;
revoke all on function public.pheno_arbres_designer(jsonb), public.pheno_arbres_codes_modifier(jsonb) from public, anon;
grant execute on function public.pheno_arbres_designer(jsonb), public.pheno_arbres_codes_modifier(jsonb) to authenticated;

commit;
