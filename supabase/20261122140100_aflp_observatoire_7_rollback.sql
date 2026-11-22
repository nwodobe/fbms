-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 · RETOUR ARRIÈRE de la migration 7
-- (codes de suivi A001 à A012)
-- Effet :
--   * retire pheno_arbres_codes_modifier, l'aide pheno_code_suivi et le déclencheur
--     qui copie le code de suivi dans chaque observation ;
--   * remet pheno_arbres_designer EXACTEMENT dans sa version de la migration 5
--     (désignation sans code de suivi) ;
--   * CONSERVE les colonnes et leurs valeurs (pheno_arbres.code_suivi,
--     code_suivi_le, code_suivi_par, pheno_observations.code_suivi) et la contrainte
--     d'unicité : aucune donnée saisie n'est perdue, l'ancien code les ignore.
--   * Le journal immuable garde la trace des attributions et modifications.
-- Suppression définitive des colonnes (perte des codes) : bloc commenté en fin de
-- fichier, à n'exécuter que sur décision explicite du Branch Manager.
-- REJOUABLE : oui.
-- =====================================================================
begin;
drop function if exists public.pheno_arbres_codes_modifier(jsonb);
drop trigger if exists pheno_obs_code_suivi on public.pheno_observations;
drop function if exists private.pheno_obs_code_suivi();
update public.pheno_protocoles set parametres = parametres - 'codes_suivi' where actif;

-- Version de la migration 5 (copie conforme de 20261119120000_aflp_observatoire_5_fiabilisation.sql).
-- D2 · Désignation libre de 10 titulaires et 2 réserves par le Chef d'Unité.
create or replace function public.pheno_arbres_designer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $$
declare
  v_panel public.pheno_panels; v_proto public.pheno_protocoles; v_tit integer; v_res integer; v_a jsonb; v_b public.pheno_blocs;
  v_num integer; v_role text; v_rt integer := 0; v_rr integer := 0; v_cles text[] := '{}'; v_cle text; v_liste jsonb := '[]'::jsonb;
  v_n_t integer; v_n_r integer; v_ex text[];
begin
  select * into v_panel from public.pheno_panels where id = (p->>'panel_id')::uuid for update;
  if not found then raise exception 'Champ de l''Observatoire introuvable.' using errcode = 'PH002'; end if;
  if not (private.pheno_classe() = 'BM' or (private.pheno_classe() = 'UH' and v_panel.cluster_code = private.pheno_mon_cluster())) then
    raise exception 'Le choix des arbres est réservé au Chef d''Unité du cluster %.', v_panel.cluster_code using errcode = 'PH001'; end if;
  if v_panel.mode_selection <> 'DESIGNATION' then
    raise exception 'Ce champ a été installé par tirage : ses arbres ne se désignent pas.' using errcode = 'PH002'; end if;
  if jsonb_typeof(p->'arbres') <> 'array' then raise exception 'Liste d''arbres invalide.' using errcode = 'PH002'; end if;

  -- Rejeu identique (même téléphone ou autre) : accepté sans rien changer. Sinon, conflit.
  if exists (select 1 from public.pheno_arbres where panel_id = v_panel.id) then
    select array_agg(k order by k) into v_ex from (
      select a.bloc_id::text || ':' || a.numero_inventaire || ':' || a.role as k
      from public.pheno_arbres a where a.panel_id = v_panel.id and a.remplace_arbre_id is null) s;
    if v_ex = (select array_agg(k order by k) from (select (x->>'bloc_id') || ':' || (x->>'numero') || ':' || (x->>'role') as k
                                                    from jsonb_array_elements(p->'arbres') x) s2) then
      return jsonb_build_object('panel_id', v_panel.id, 'deja_designe', true, 'statut_panel', v_panel.statut);
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
    insert into public.pheno_arbres (id, panel_id, bloc_id, code, numero_inventaire, role, rang, statut, proba_inclusion, designe_par, date_effet)
    values (private.pheno_arbre_id(v_b.id, v_num), v_panel.id, v_b.id, private.pheno_code_arbre(v_b.numero, v_num), v_num, v_role,
      case when v_role = 'TITULAIRE' then v_rt else v_rr end, case when v_role = 'TITULAIRE' then 'ACTIF' else 'RESERVE_EN_ATTENTE' end,
      null, auth.uid(), private.pheno_aujourdhui());
    v_liste := v_liste || jsonb_build_object('code', private.pheno_code_arbre(v_b.numero, v_num), 'role', v_role);
  end loop;

  update public.pheno_panels set statut = 'ACTIF', designe_par = auth.uid(), designe_le = now(), reserves_manquantes = 0,
    row_version = row_version + 1, updated_at = now() where id = v_panel.id;
  perform private.pheno_journaliser(v_panel.cluster_code, 'PANEL', v_panel.id, 'DESIGNATION_ARBRES', null,
    jsonb_build_object('designe_par', auth.uid(), 'arbres', v_liste, 'appareil', p->>'device_id',
      'avertissement', 'Suivi d''arbres désignés : pas un échantillon statistiquement représentatif.'), null);
  return jsonb_build_object('panel_id', v_panel.id, 'statut_panel', 'ACTIF',
    'arbres', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'role', a.role, 'rang', a.rang) order by a.role desc, a.rang), '[]')
               from public.pheno_arbres a where a.panel_id = v_panel.id));
end $$;
drop function if exists private.pheno_code_suivi(integer);
revoke all on function public.pheno_arbres_designer(jsonb) from public, anon;
grant execute on function public.pheno_arbres_designer(jsonb) to authenticated;
commit;

-- ---------------------------------------------------------------------
-- OPTIONNEL, DESTRUCTIF (perte des codes A001..A012) — décision explicite requise :
-- begin;
-- alter table public.pheno_arbres drop constraint if exists pheno_arbres_code_suivi_unique;
-- alter table public.pheno_arbres drop constraint if exists pheno_arbres_code_suivi_format;
-- alter table public.pheno_arbres drop column if exists code_suivi, drop column if exists code_suivi_le, drop column if exists code_suivi_par;
-- alter table public.pheno_observations drop column if exists code_suivi;
-- commit;
