# AFLP Farmer Registry — Migrations Phase 1

## Migrations appliquées au projet Supabase

Le 18 août 2026, les migrations suivantes ont été appliquées au projet `FIELD BUYING ANAGROCI` :

1. `farmer_registry_phase1_01_referentiels`
2. `farmer_registry_phase1_02_core_enrolement_v3`
3. `farmer_registry_phase1_03_security_rls`
4. `farmer_registry_phase1_04a_private_identity_table`
5. `farmer_registry_phase1_04b_privacy_migrate_and_redact`
6. `farmer_registry_phase1_04c_identity_capture_compat`
7. `farmer_registry_phase1_04d_consent_history_rules`
8. `farmer_registry_phase1_04e_identity_history_status`
9. `farmer_registry_phase1_05_private_rls_helpers`
10. `farmer_registry_phase1_06_event_ordering`

La tentative intermédiaire `farmer_registry_phase1_04_privacy_history_hardening` a été annulée intégralement par PostgreSQL avant application ; elle n’a laissé aucun état partiel.

## Fichiers versionnés

- `supabase/20260818_farmer_registry_phase1_consolidated.sql`
- `supabase/20260818_farmer_registry_phase1_security.sql`
- `supabase/20260818_farmer_registry_phase1_identity_history.sql`
- `supabase/20260818_farmer_registry_phase1_event_ordering.sql`
- `supabase/20260818_farmer_registry_phase1_verify.sql`

Les quatre premiers fichiers représentent l’état consolidé final et ses renforcements successifs. Le dernier est un script de vérification en lecture seule.

## Nature des changements

- ajout des référentiels Zone et Cluster ;
- préfixe Farmer ID stable par village ;
- identité producteur structurée ;
- Farmer ID unique et immuable ;
- contrôle serveur RT/village ;
- consentements append-only ;
- ordre d’événement monotone pour départager deux consentements ou preuves saisis au même instant ;
- numéros de pièce isolés sous RLS ;
- remplacement et retrait des pièces historisés ;
- audit avant/après avec expurgation ;
- recherche de doublons ;
- calcul serveur du Passport Completion, de la maturité et du Risk Profile ;
- vue `farmer_passport_summary_v` ;
- fonctions de périmètre déplacées dans le schéma non exposé `private` ;
- politiques RLS de périmètre.

## Compatibilité

Aucun producteur supprimé n’a été réactivé. Aucun code existant n’a été modifié. `producteurs.data` demeure disponible pour les anciens clients, sauf retrait de `pieceNum`. Le champ `id_document_number` reste comme tampon de compatibilité mais ne conserve aucune valeur.

Les trois profils historiques n’ont pas encore de périmètre géographique configuré. Une exception de compatibilité maintient donc leur accès actuel. Elle devra être retirée après qualification des profils.

## Recette appliquée

Une recette transactionnelle a vérifié sans laisser de données fictives :

- deux Farmer ID uniques dans un même village ;
- blocage d’un RT appartenant à un autre village ;
- immutabilité du Farmer ID ;
- stockage privé de la pièce d’identité ;
- consentement complet donnant le niveau `BASIC` et 65 % de complétude ;
- rejet serveur d’un consentement complet incomplet ;
- historisation d’un consentement partiel supersédant le précédent ;
- passage automatique à `REVIEW_REQUIRED` ;
- détection de doublon ;
- expurgation des données sensibles dans l’audit.

## Retour arrière fonctionnel

En cas d’incident frontend, retirer les chargeurs `farmer-enrollment-phase1.js`, `farmer-registry-read-phase1.js` et `farmer-registry-privacy-phase1.js`, sans supprimer les nouvelles tables ni les données. Les migrations sont additives et doivent rester en place.
