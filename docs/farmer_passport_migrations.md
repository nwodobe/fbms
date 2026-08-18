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

La tentative intermédiaire `farmer_registry_phase1_04_privacy_history_hardening` a été annulée intégralement par PostgreSQL avant application ; elle n’a laissé aucun état partiel.

## Fichiers versionnés

- `supabase/20260818_farmer_registry_phase1_consolidated.sql`
- `supabase/20260818_farmer_registry_phase1_security.sql`
- `supabase/20260818_farmer_registry_phase1_verify.sql`

Les deux premiers fichiers représentent l’état consolidé final. Le troisième est en lecture seule.

## Nature des changements

- ajout des référentiels Zone et Cluster ;
- préfixe Farmer ID stable par village ;
- identité producteur structurée ;
- Farmer ID unique et immuable ;
- contrôle serveur RT/village ;
- consentements append-only ;
- numéros de pièce isolés sous RLS ;
- audit avant/après avec expurgation ;
- recherche de doublons ;
- calcul serveur du Passport Completion, de la maturité et du Risk Profile ;
- vue `farmer_passport_summary_v` ;
- politiques RLS de périmètre.

## Compatibilité

Aucun producteur supprimé n’a été réactivé. Aucun code existant n’a été modifié. `producteurs.data` demeure disponible pour les anciens clients, sauf retrait de `pieceNum`. Le champ `id_document_number` reste comme tampon de compatibilité mais ne conserve aucune valeur.

## Retour arrière fonctionnel

En cas d’incident frontend, retirer les chargeurs `farmer-enrollment-phase1.js` et `farmer-registry-read-phase1.js`, sans supprimer les nouvelles tables ni les données. Les migrations sont additives et doivent rester en place.
