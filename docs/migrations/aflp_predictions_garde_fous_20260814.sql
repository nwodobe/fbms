-- ============================================================================
--  AFLP — NIVEAU 3 : PREUVE EXÉCUTABLE DES GARDE-FOUS
--  Fichier : docs/migrations/aflp_predictions_garde_fous_20260814.sql
--  ----------------------------------------------------------------------------
--  À exécuter APRÈS aflp_predictions_20260814.sql.
--
--  Les blocs 2, 3 et 7 du script de vérification contrôlent les DROITS déclarés.
--  Ce script-ci fait autre chose : il ENDOSSE l'identité du rôle technique des
--  modèles et tente réellement chacune des écritures que le cadrage AFLP
--  interdit. Une permission déclarée peut être contredite par un GRANT oublié
--  ailleurs ; une tentative qui échoue, non.
--
--  Le script se termine par un contrôle POSITIF : le rôle doit malgré tout
--  pouvoir lire les sources et écrire ses propres prédictions. Un dispositif
--  qui interdit tout n'est pas sûr, il est inutilisable.
--
--  Résultat attendu : 11 tentatives bloquées, 0 passée, puis « OK ».
--
--  Exécuté le 2026-08-14 sur PostgreSQL 16.13 avec le schéma FBMS réel
--  (supabase/rls.sql + achats.sql + cash.sql + sacs.sql) : 11/11 bloquées.
-- ============================================================================

do $$
declare
  essais text[][] := array[
    array['G01/G07 créer un achat',        'insert into public.achats(date,poids_net,prix_kg,montant) values (current_date,1,1,1)'],
    array['G07 modifier un achat validé',  'update public.achats set montant = 0'],
    array['G08 supprimer un achat',        'delete from public.achats'],
    array['G01 créer une avance',          'insert into public.avances(date,montant) values (current_date,1000000)'],
    array['G01 modifier une avance',       'update public.avances set montant = 999'],
    array['G04 forcer une réconciliation', 'update public.reconciliations set statut = ''Réconcilié'''],
    array['G14 sortir du stock',           'insert into public.sacs_mouvements(date,type,quantite) values (current_date,''ENLEVEMENT'',10)'],
    array['G13 modifier un rôle',          'update public.profils set role = ''Branch Manager'''],
    array['G02 modifier un plafond',       'insert into public.parametres_calcul(cle,valeur) values (''plafond'',''999'')'],
    array['G11 se promouvoir',             'update public.aflp_model_registry set statut = ''DECISION_SUPPORT'''],
    array['G11 simuler une revue humaine', 'insert into public.aflp_prediction_reviews(prediction_id,suite,motif,decideur_nom) values (''x'',''PRIS_CONNAISSANCE'',''motif'',''faux'')']
  ];
  i int; bloque int := 0; passe int := 0; msg text;
begin
  set local role aflp_model;
  for i in 1 .. array_length(essais, 1) loop
    begin
      execute essais[i][2];
      passe := passe + 1;
      raise warning 'ÉCHEC DU GARDE-FOU — « % » a RÉUSSI', essais[i][1];
    exception when others then
      bloque := bloque + 1;
      msg := regexp_replace(sqlerrm, E'\n.*', '');
      raise notice 'BLOQUÉ  % : %', rpad(essais[i][1], 34), left(msg, 62);
    end;
  end loop;
  reset role;
  raise notice '---';
  raise notice 'RÉSULTAT : % tentative(s) bloquée(s), % passée(s)', bloque, passe;
  if passe > 0 then
    raise exception 'AU MOINS UNE TENTATIVE D''ÉCRITURE A ABOUTI — garde-fou en défaut';
  end if;
end
$$;

-- Le rôle DOIT pouvoir lire les sources et écrire ses propres prédictions.
do $$
declare n int;
begin
  set local role aflp_model;
  select count(*) into n from public.achats;
  insert into public.aflp_predictions(prediction_id,cas_usage,entite_type,entite,horizon_jours,
    date_calcul,periode_debut,periode_fin,version_modele,version_variables,version_dataset,statut_modele)
  values ('OK-LECTURE-ECRITURE','volumes','programme','PROGRAMME',7,current_date,
          current_date+1,current_date+7,'3.0.0','vars-1.0.0','ds-test','SHADOW_ONLY');
  reset role;
  raise notice 'OK — le rôle lit les sources (% achats) et écrit ses prédictions', n;
end
$$;
