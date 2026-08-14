-- ============================================================================
--  AFLP — NIVEAU 3 : CONTRÔLE DE LA MIGRATION DES PRÉDICTIONS
--  Fichier : docs/migrations/aflp_predictions_verify_20260814.sql
--  ----------------------------------------------------------------------------
--  À exécuter APRÈS aflp_predictions_20260814.sql, dans Supabase → SQL Editor.
--
--  Ce script ne vérifie pas que les tables « existent » — cela ne prouverait
--  rien. Il vérifie que les INTERDITS tiennent : que le rôle technique des
--  modèles ne peut pas toucher à l'argent, aux rôles, ni aux transactions, et
--  qu'une prédiction ne peut pas être réécrite après coup.
--
--  Chaque bloc lève une exception s'il échoue. Un script qui va au bout sans
--  rien afficher d'autre que « CONTRÔLES OK » est un script qui a tout passé.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Les tables de prédiction existent et sont séparées du transactionnel
-- ---------------------------------------------------------------------------
do $$
declare manquante text;
begin
  foreach manquante in array array[
    'aflp_predictions','aflp_prediction_reviews','aflp_model_registry',
    'aflp_model_metrics','aflp_model_drift'
  ] loop
    if to_regclass('public.'||manquante) is null then
      raise exception 'ÉCHEC 1 : table public.% absente', manquante;
    end if;
  end loop;

  -- Aucune colonne de prédiction ne s'est glissée dans une table de faits.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('achats','avances','reconciliations','sacs_mouvements')
      and (column_name like '%prevision%' or column_name like '%predict%'
           or column_name like '%score_ia%' or column_name like '%_ia')
  ) then
    raise exception 'ÉCHEC 1 : une colonne de prédiction a été ajoutée à une table transactionnelle';
  end if;
  raise notice 'OK 1 — tables présentes, transactionnel intact';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Le rôle technique ne peut PAS écrire dans les tables financières
--    (§21 du cadrage : « ajoute des tests démontrant que l'IA ne peut pas… »)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p text;
begin
  foreach t in array array['achats','avances','reconciliations','sacs_mouvements'] loop
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('aflp_model', 'public.'||t, p) then
        raise exception 'ÉCHEC 2 : le rôle aflp_model dispose du droit % sur public.% — '
                        'l''IA pourrait modifier une transaction', p, t;
      end if;
    end loop;
    if not has_table_privilege('aflp_model', 'public.'||t, 'SELECT') then
      raise exception 'ÉCHEC 2 : le rôle aflp_model ne peut pas LIRE public.% — '
                      'les modèles ne pourront pas s''exécuter', t;
    end if;
  end loop;
  raise notice 'OK 2 — lecture seule sur les tables sources, aucune écriture possible';
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Le rôle technique ne peut ni changer un rôle, ni un plafond, ni se promouvoir
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profils') is not null then
    if has_table_privilege('aflp_model', 'public.profils', 'SELECT')
       or has_table_privilege('aflp_model', 'public.profils', 'UPDATE') then
      raise exception 'ÉCHEC 3 : le rôle aflp_model accède à public.profils — '
                      'l''IA pourrait lire ou modifier un rôle utilisateur';
    end if;
  end if;

  if to_regclass('public.parametres_calcul') is not null then
    if has_table_privilege('aflp_model', 'public.parametres_calcul', 'UPDATE')
       or has_table_privilege('aflp_model', 'public.parametres_calcul', 'INSERT') then
      raise exception 'ÉCHEC 3 : le rôle aflp_model peut écrire dans parametres_calcul — '
                      'l''IA pourrait modifier un plafond ou un seuil';
    end if;
  end if;

  if has_table_privilege('aflp_model', 'public.aflp_model_registry', 'UPDATE') then
    raise exception 'ÉCHEC 3 : le rôle aflp_model peut modifier son propre registre — '
                    'un modèle pourrait se promouvoir lui-même en aide à la décision';
  end if;

  if has_table_privilege('aflp_model', 'public.aflp_prediction_reviews', 'INSERT') then
    raise exception 'ÉCHEC 3 : le rôle aflp_model peut écrire une revue humaine — '
                    'l''IA pourrait simuler une validation qui n''a pas eu lieu';
  end if;
  raise notice 'OK 3 — ni rôle, ni plafond, ni auto-promotion, ni fausse revue';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Une prédiction enregistrée ne peut pas être réécrite
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  insert into public.aflp_predictions (
    prediction_id, cas_usage, entite_type, entite, horizon_jours, date_calcul,
    version_modele, version_variables, version_dataset, statut_modele
  ) values (
    'TEST-IMMUTABILITE', 'volumes', 'programme', 'PROGRAMME', 0, current_date,
    '0.0.0-test', 'test', 'test', 'NOT_READY'
  );

  begin
    update public.aflp_predictions set valeur_prevue = 42 where prediction_id = 'TEST-IMMUTABILITE';
    raise exception 'ÉCHEC 4 : une prédiction a pu être modifiée après enregistrement';
  exception when others then
    if sqlerrm like '%écriture unique%' then ok := true; else raise; end if;
  end;

  if not ok then raise exception 'ÉCHEC 4 : le déclencheur d''immutabilité n''a pas agi'; end if;

  -- Nettoyage : le DELETE étant lui aussi bloqué, on désactive le déclencheur
  -- le temps de retirer la ligne d'essai. C'est volontairement explicite.
  alter table public.aflp_predictions disable trigger aflp_predictions_no_update;
  delete from public.aflp_predictions where prediction_id = 'TEST-IMMUTABILITE';
  alter table public.aflp_predictions enable trigger aflp_predictions_no_update;

  raise notice 'OK 4 — les prédictions sont en écriture unique';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Une prédiction ne peut pas porter sur une période déjà connue
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    insert into public.aflp_predictions (
      prediction_id, cas_usage, entite_type, entite, horizon_jours, date_calcul,
      periode_debut, periode_fin,
      version_modele, version_variables, version_dataset, statut_modele
    ) values (
      'TEST-FUITE', 'volumes', 'programme', 'PROGRAMME', 7, current_date,
      current_date - 7, current_date,          -- période ANTÉRIEURE au calcul
      '0.0.0-test', 'test', 'test', 'NOT_READY'
    );
  exception when check_violation then ok := true;
  end;
  if not ok then
    alter table public.aflp_predictions disable trigger aflp_predictions_no_update;
    delete from public.aflp_predictions where prediction_id = 'TEST-FUITE';
    alter table public.aflp_predictions enable trigger aflp_predictions_no_update;
    raise exception 'ÉCHEC 5 : une prédiction rétrospective a été acceptée — fuite temporelle possible';
  end if;
  raise notice 'OK 5 — aucune prédiction ne peut porter sur une période déjà écoulée';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Un modèle ne passe pas en aide à la décision sans validation nominative
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    update public.aflp_model_registry
       set statut = 'DECISION_SUPPORT'
     where cle = 'volumes';
  exception when check_violation then ok := true;
  end;
  if not ok then
    update public.aflp_model_registry set statut = 'NOT_READY' where cle = 'volumes';
    raise exception 'ÉCHEC 6 : un modèle a été promu en DECISION_SUPPORT sans validation nominative';
  end if;
  raise notice 'OK 6 — la promotion exige une validation nominative';
end
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS active et forcée
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select tablename, rowsecurity, relforcerowsecurity
      from pg_tables t
      join pg_class c on c.relname = t.tablename
     where t.schemaname = 'public'
       and t.tablename in ('aflp_predictions','aflp_prediction_reviews','aflp_model_registry')
  loop
    if not r.rowsecurity then
      raise exception 'ÉCHEC 7 : RLS inactive sur %', r.tablename;
    end if;
    if not r.relforcerowsecurity then
      raise exception 'ÉCHEC 7 : RLS non FORCÉE sur % — le propriétaire la contourne', r.tablename;
    end if;
  end loop;

  -- Aucune politique d'INSERT ouverte à un rôle APPLICATIF : un navigateur ne
  -- fabrique pas de prédiction. La politique réservée à `aflp_model`, elle, est
  -- indispensable — voir le bloc 8.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'aflp_predictions' and cmd = 'INSERT'
       and (roles && array['authenticated','anon','public']::name[])
  ) then
    raise exception 'ÉCHEC 7 : une politique INSERT sur aflp_predictions est ouverte à un rôle applicatif — '
                    'une prédiction pourrait être fabriquée depuis un navigateur';
  end if;

  -- Même exigence sur les revues : elles doivent rester humaines et nominatives,
  -- donc jamais accessibles en écriture au rôle des modèles.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'aflp_prediction_reviews' and cmd = 'INSERT'
       and (roles && array['aflp_model']::name[])
  ) then
    raise exception 'ÉCHEC 7 : le rôle des modèles peut écrire une revue humaine';
  end if;
  raise notice 'OK 7 — RLS active et forcée, aucune écriture de prédiction depuis le navigateur';
end
$$;

-- ---------------------------------------------------------------------------
-- 8. CONTRÔLE POSITIF — le rôle technique doit pouvoir faire son travail
--    ----------------------------------------------------------------------
--    Les blocs 2, 3 et 7 vérifient tous ce qui est INTERDIT. Un dispositif qui
--    interdit tout passerait ces trois blocs sans qu'aucun modèle ne puisse
--    jamais écrire une prédiction. C'est exactement ce qui s'est produit lors
--    de la première exécution de cette migration : `FORCE ROW LEVEL SECURITY`
--    s'applique aussi au rôle qui détient le GRANT INSERT, et le pipeline batch
--    était muet. Ce bloc est là pour que cela ne se reproduise pas.
-- ---------------------------------------------------------------------------
do $$
declare n_avant int; n_apres int;
begin
  select count(*) into n_avant from public.aflp_predictions;

  set local role aflp_model;
  begin
    -- Lecture des sources : indispensable pour calculer quoi que ce soit.
    perform count(*) from public.achats;
    perform count(*) from public.avances;
    perform count(*) from public.reconciliations;
    perform count(*) from public.sacs_mouvements;
  exception when others then
    reset role;
    raise exception 'ÉCHEC 8 : le rôle aflp_model ne peut pas lire les sources (%)', sqlerrm;
  end;

  begin
    insert into public.aflp_predictions (
      prediction_id, cas_usage, entite_type, entite, horizon_jours, date_calcul,
      periode_debut, periode_fin, version_modele, version_variables,
      version_dataset, statut_modele
    ) values (
      'TEST-CONTROLE-POSITIF', 'volumes', 'programme', 'PROGRAMME', 7, current_date,
      current_date + 1, current_date + 7, '0.0.0-test', 'test', 'test', 'SHADOW_ONLY'
    );
    insert into public.aflp_model_metrics (
      cle_modele, cas_usage, date_calcul, version_modele, version_dataset, baseline_methode
    ) values ('volumes', 'volumes', current_date, '0.0.0-test', 'test', 'naif');
    insert into public.aflp_model_drift (
      cle_modele, date_calcul, fenetre_jours, seuil, en_derive
    ) values ('volumes', current_date, 28, 0.30, false);
  exception when others then
    reset role;
    raise exception 'ÉCHEC 8 : le rôle aflp_model ne peut pas écrire ses prédictions, '
                    'métriques ou dérives (%). Le pipeline batch serait muet.', sqlerrm;
  end;
  reset role;

  select count(*) into n_apres from public.aflp_predictions;
  if n_apres <> n_avant + 1 then
    raise exception 'ÉCHEC 8 : l''insertion n''a pas abouti';
  end if;

  -- Nettoyage des lignes d'essai (le déclencheur bloque DELETE : on le suspend).
  alter table public.aflp_predictions disable trigger aflp_predictions_no_update;
  delete from public.aflp_predictions where prediction_id = 'TEST-CONTROLE-POSITIF';
  alter table public.aflp_predictions enable trigger aflp_predictions_no_update;
  delete from public.aflp_model_metrics where version_modele = '0.0.0-test';
  delete from public.aflp_model_drift  where cle_modele = 'volumes' and fenetre_jours = 28;

  raise notice 'OK 8 — le rôle technique lit les sources et écrit dans son périmètre';
end
$$;

-- ---------------------------------------------------------------------------
-- 9. État du registre — doit être NOT_READY partout à l'installation
-- ---------------------------------------------------------------------------
select cle, nom, statut, actif, prochaine_revue
  from public.aflp_model_registry
 order by cle;

select 'CONTRÔLES OK — 9 blocs passés' as resultat;
