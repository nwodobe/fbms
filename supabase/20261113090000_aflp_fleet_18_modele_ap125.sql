-- =============================================================================
-- AFLP FLEET 18 : modèle technique APSONIC AP125
-- APPLIQUÉ EN PRODUCTION le 04/11/2026.
-- Décision du Branch Manager du 04/11/2026 : « créé APSONIC AP125 et applique le même principe
-- et rattache les motos ». Les attestations d'assurance SIDAM et les vignettes portent « Modèle : NA » ;
-- MOTO-003 est enregistrée « AP125 » et les 4 châssis partagent le préfixe LD3PCJ6J.
-- Données de référence uniquement (aucune fonction, aucun droit modifié). Rejouable.
-- Retour arrière : 20261113090100_aflp_fleet_18_rollback.sql
-- =============================================================================
insert into public.moto_modeles_techniques (code, libelle, marque_attendue, modele_motif, note)
values ('APSONIC_AP125', 'APSONIC AP125', 'APSONIC', '^AP ?125([-_ ]?[0-9]+)?$',
        'Modèle déclaré par le Branch Manager le 04/11/2026 pour les motos AFLP (documents : modèle NA). Manuel constructeur non retrouvé : règles d''entretien en politique interne, à confirmer par le carnet APSONIC.')
on conflict (code) do nothing;
