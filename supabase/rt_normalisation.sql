-- ============================================================================
-- ANAGROCI — NORMALISATION DES RT IMPORTÉS "À PLAT"
-- ----------------------------------------------------------------------------
-- Problème : l'app FBMS lit uniquement la colonne JSON `data` de la table `rt`
-- ( SB.from("rt").select("data") ). Les RT importés directement dans les
-- COLONNES (nom, telephone, village_nom, cluster, statut, score) mais dont le
-- `data` est VIDE (ex. cluster DIABO) ne s'affichent pas nativement — ils
-- apparaissent en texte brut via le script d'appoint.
--
-- Correctif : reconstruire `data` à partir des colonnes, au format attendu par
-- l'app (nom, telephone, villageId, villageNom, statut, score, id…), pour que
-- ces RT s'affichent comme les autres (pastille, jauge, actions).
--
-- À exécuter dans Supabase → SQL Editor. Non destructif : ne touche QUE les
-- lignes dont `data` est vide (les RT déjà complets ne sont pas modifiés).
-- ============================================================================

-- 1) APERÇU — combien de RT sont concernés, et lesquels (à lancer d'abord) :
select count(*) as rt_a_normaliser
from public.rt
where deleted = false
  and coalesce(data->>'nom', '') = '';

-- Détail (facultatif) :
-- select id, id_rt, nom, telephone, village_nom, cluster, statut, score
-- from public.rt
-- where deleted = false and coalesce(data->>'nom','') = ''
-- order by cluster, nom;

-- 2) NORMALISATION — remplir `data` depuis les colonnes :
update public.rt
set data = jsonb_strip_nulls(jsonb_build_object(
      'id',            id::text,
      'idRt',          nullif(id_rt, ''),
      'nom',           nom,
      'telephone',     telephone,
      'villageId',     village_id::text,
      'villageNom',    village_nom,
      'cluster',       nullif(cluster, ''),
      'statut',        coalesce(nullif(statut, ''), 'Pressenti'),
      'score',         coalesce(score, 50)
    ))
where deleted = false
  and coalesce(data->>'nom', '') = '';

-- 3) VÉRIFICATION — plus aucun RT sans `data` :
select count(*) as restant_sans_data
from public.rt
where deleted = false
  and coalesce(data->>'nom', '') = '';
-- Doit renvoyer 0. Rafraîchir ensuite FBMS (Ctrl+Shift+R) : les RT de DIABO
-- s'affichent alors comme ceux de N'DJÉBONOUA.
-- ============================================================================
