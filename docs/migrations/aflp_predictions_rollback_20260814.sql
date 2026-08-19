-- ============================================================================
--  AFLP — NIVEAU 3 : RETOUR ARRIÈRE DU STOCKAGE DES PRÉDICTIONS
--  Fichier : docs/migrations/aflp_predictions_rollback_20260814.sql
--  ----------------------------------------------------------------------------
--  Annule aflp_predictions_20260814.sql.
--
--  ⚠ AVANT D'EXÉCUTER : ce script SUPPRIME l'historique des prédictions, des
--  métriques et des revues humaines. Cet historique est la seule preuve de ce
--  que les modèles ont annoncé et de ce que les humains en ont fait. Exportez-le
--  avant (§1), sinon la période d'observation en mode shadow est perdue et devra
--  être recommencée depuis zéro.
--
--  Ce script ne touche à AUCUNE table opérationnelle FBMS. Par construction :
--  la migration n'en a modifié aucune. Le retour arrière est donc sans effet
--  sur les achats, les avances, les réconciliations et les sacs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Exportez d'abord — exécutez ces requêtes et conservez les résultats
-- ---------------------------------------------------------------------------
-- select * from public.aflp_predictions        order by date_calcul, prediction_id;
-- select * from public.aflp_prediction_reviews order by created_at;
-- select * from public.aflp_model_metrics      order by date_calcul;
-- select * from public.aflp_model_drift        order by date_calcul;
-- select * from public.aflp_model_registry     order by cle;

-- ---------------------------------------------------------------------------
-- 2. Coupure immédiate SANS suppression — l'option à préférer
--    Dans la quasi-totalité des cas, ce qu'on veut est « arrêter les modèles »,
--    pas « effacer les preuves ». Ces deux lignes suffisent, et elles sont
--    réversibles.
-- ---------------------------------------------------------------------------
-- update public.aflp_model_registry
--    set actif = false,
--        statut = 'NOT_READY',
--        motif_desactivation = 'Arrêt décidé le '||current_date::text||' par <NOM>',
--        updated_at = now();
--
-- Après cela : FBMS fonctionne à l'identique, le Command Center affiche ses
-- écrans habituels, et l'Assistant IA de niveau 2 reste opérationnel. Vérifiez-le
-- avant d'aller plus loin.

-- ---------------------------------------------------------------------------
-- 3. Suppression complète — irréversible
-- ---------------------------------------------------------------------------
drop trigger if exists aflp_predictions_no_update on public.aflp_predictions;
drop trigger if exists aflp_reviews_no_update     on public.aflp_prediction_reviews;

drop table if exists public.aflp_model_drift        cascade;
drop table if exists public.aflp_model_metrics      cascade;
drop table if exists public.aflp_prediction_reviews cascade;
drop table if exists public.aflp_predictions        cascade;
drop table if exists public.aflp_model_registry     cascade;

drop function if exists public.aflp_predictions_immuables() cascade;

-- ---------------------------------------------------------------------------
-- 4. Rôle technique
--    On retire d'abord tous ses droits, ensuite seulement le rôle : un DROP ROLE
--    échoue tant que des privilèges subsistent quelque part.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_roles where rolname = 'aflp_model') then
    foreach t in array array['achats','avances','reconciliations','sacs_mouvements',
                             'villages','rt','parametres_calcul'] loop
      if to_regclass('public.'||t) is not null then
        execute format('revoke all on public.%I from aflp_model', t);
      end if;
    end loop;
    execute 'revoke all on schema public from aflp_model';
    execute 'alter default privileges in schema public revoke all on tables from aflp_model';
    execute 'drop role aflp_model';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Contrôle du retour arrière
-- ---------------------------------------------------------------------------
do $$
declare restant text;
begin
  foreach restant in array array[
    'aflp_predictions','aflp_prediction_reviews','aflp_model_registry',
    'aflp_model_metrics','aflp_model_drift'
  ] loop
    if to_regclass('public.'||restant) is not null then
      raise exception 'RETOUR ARRIÈRE INCOMPLET : public.% existe encore', restant;
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'aflp_model') then
    raise exception 'RETOUR ARRIÈRE INCOMPLET : le rôle aflp_model existe encore';
  end if;

  -- Les tables opérationnelles doivent être intactes.
  foreach restant in array array['achats','avances','reconciliations','sacs_mouvements'] loop
    if to_regclass('public.'||restant) is null then
      raise exception 'ALERTE : public.% a disparu — le retour arrière a dépassé son périmètre', restant;
    end if;
  end loop;

  raise notice 'Retour arrière complet. Les tables opérationnelles FBMS sont intactes.';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Côté application — à faire dans le même mouvement
-- ---------------------------------------------------------------------------
--  Retirer de terrain/command.html :
--    · <script defer src="../shared/aflp-ia-predictif.js"></script>
--    · <script defer src="../shared/aflp-ia-predictif-ui.js"></script>
--    · <section class="panel" id="aflpPred" …></section>
--    · les deux appels AFLP_PRED_UI.monter(…) et AFLP_PRED_UI.rafraichir(…)
--
--  Les colonnes ajoutées à la requête `achats` (prix_kg, humidite, kor,
--  producteur_id, producteur_nom, rejet, nb_sacs, poids_brut, tare) peuvent
--  RESTER : elles ne coûtent qu'un peu de bande passante et ne changent aucun
--  affichage du Niveau 2.
--
--  Rien d'autre n'est à défaire : la couche prédictive n'a jamais écrit nulle part.
-- ============================================================================
