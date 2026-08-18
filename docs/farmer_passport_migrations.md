# AFLP Farmer Registry — Migrations complètes

## État appliqué

Les migrations suivantes ont été appliquées au projet Supabase `FIELD BUYING ANAGROCI` le 18 août 2026 :

### Phase 1 — identité et enrôlement

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
11. `farmer_registry_phase1_07_identity_same_number_reactivation`

### Farmer Registry complet

1. `farmer_registry_complete_01_tables_catalog`
2. `farmer_registry_complete_02_rules_functions`
3. `farmer_registry_complete_03_rls_views`
4. `farmer_registry_complete_04_evidence_types`
5. `farmer_registry_complete_05_action_closure_hardening`
6. `farmer_registry_complete_06_actor_integrity`
7. `farmer_registry_complete_07_roles_gps_privacy`
8. `farmer_registry_complete_08_baseline_version_locking`

## Source consolidée

Le fichier suivant représente l’état final attendu à partir d’une base ayant déjà reçu la Phase 1 :

```text
supabase/20260818_farmer_registry_complete.sql
```

Il contient :

- les tables Parcelles, Production, Sustainability, Inspections, Actions, Visites et Vérifications ;
- le catalogue des 25 critères `AFLP-SUST-2026.1` ;
- les contraintes, indexes et relations ;
- les fonctions de validation et finalisation ;
- les règles de calcul du passeport et du risque ;
- les triggers d’audit et d’historisation ;
- les politiques RLS ;
- les vues de pilotage et de dossier 360 ;
- l’extension des preuves et des formations existantes.

## Nature des changements

Toutes les migrations sont additives :

- aucune table métier historique supprimée ;
- aucun producteur réactivé ;
- aucun Farmer ID renuméroté ;
- aucun historique écrasé ;
- aucune donnée synthétique conservée après recette.

Les baselines `FINAL` et inspections `FINAL` sont immuables. Une correction crée une nouvelle version. Les versions sont attribuées sous verrou transactionnel pour éviter une collision entre appareils.

## Ordre d’application

```text
Phase 1
  ↓
20260818_farmer_registry_complete.sql
  ↓
Tests de schéma et RLS
  ↓
Déploiement frontend
```

Ne pas appliquer le fichier complet avant la Phase 1, car les nouvelles tables référencent `producteurs`, `farmer_consents`, les helpers du schéma `private` et le mécanisme d’audit existant.

## Compatibilité

Le JSONB historique `producteurs.data` reste disponible. Les coordonnées historiques au niveau producteur ne sont pas supprimées, mais les nouvelles captures GPS sont enregistrées dans `farmer_plots` ou `farmer_inspections`.

Les relations Achats et Sacs acceptent encore temporairement l’ID technique ou le Farmer ID lisible dans les vues de dossier. La normalisation physique complète de ces deux modules reste une intégration séparée pour ne pas casser les files offline anciennes.

## Retour arrière fonctionnel

En cas d’incident frontend :

1. retirer les quatre nouveaux chargeurs complets dans `shared/uppercase.js` ;
2. conserver toutes les nouvelles tables et données ;
3. ne pas supprimer les baselines, preuves ou actions ;
4. réactiver le frontend après correction.

Les migrations serveur ne doivent pas être annulées par suppression des tables, car elles peuvent déjà contenir des preuves historiques.

## Contrôles après migration

```sql
select count(*) from public.sustainability_question_catalog where active;
-- attendu : 25

select table_name, row_security_active
from information_schema.tables
where table_name like 'farmer_%';

select * from public.farmer_registry_dashboard_v limit 10;

select proname, prosecdef
from pg_proc
where proname like 'farmer_registry_%';
```

Les fonctions trigger doivent avoir leurs privilèges RPC révoqués. Seules les fonctions métier de finalisation sont exécutables par `authenticated`.
