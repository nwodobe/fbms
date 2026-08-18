# AFLP Farmer Registry — Migrations complètes

## État appliqué

Les migrations suivantes ont été appliquées au projet Supabase `FIELD BUYING ANAGROCI` le 18 août 2026.

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
9. `farmer_registry_complete_09_private_evidence_and_training`
10. `farmer_registry_complete_10_revoke_anon_business_rpcs`

La migration `farmer_registry_complete_01_tables_catalog` apparaît une seconde fois dans l’historique live à la suite d’un contrôle idempotent. Le script utilise `IF NOT EXISTS` et `ON CONFLICT`; cette répétition n’a créé ni table en double, ni critère en double, ni donnée métier.

## Sources versionnées

```text
supabase/20260818_farmer_registry_complete.sql
supabase/20260818_farmer_registry_complete_private_evidence.sql
```

Le premier fichier représente le schéma métier complet à partir d’une base ayant déjà reçu la Phase 1. Le second ajoute le bucket privé de preuves, les politiques Storage et les privilèges finaux des RPC métier.

Ils couvrent :

- les tables Parcelles, Production, Sustainability, Inspections, Actions, Visites et Vérifications ;
- le catalogue des 25 critères `AFLP-SUST-2026.1` ;
- les contraintes, indexes et relations ;
- les fonctions de validation et finalisation ;
- les règles de calcul du passeport et du risque ;
- les triggers d’audit et d’historisation ;
- les politiques RLS ;
- les vues de pilotage et de dossier 360 ;
- l’extension des preuves et des formations existantes ;
- le bucket privé `farmer-passport-evidence` ;
- la révocation de l’accès `anon` aux RPC de finalisation.

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
20260818_farmer_registry_complete_private_evidence.sql
  ↓
Tests de schéma, RLS et privilèges RPC
  ↓
Déploiement frontend
```

Ne pas appliquer ces fichiers avant la Phase 1, car les nouvelles tables référencent `producteurs`, `farmer_consents`, les helpers du schéma `private` et le mécanisme d’audit existant.

## Compatibilité

Le JSONB historique `producteurs.data` reste disponible. Les coordonnées historiques au niveau producteur ne sont pas supprimées, mais les nouvelles captures GPS sont enregistrées dans `farmer_plots` ou `farmer_inspections`.

Les vues de dossier acceptent encore temporairement l’ID technique ou le Farmer ID lisible dans Achats et Sacs. La normalisation physique complète de ces deux modules reste une intégration séparée pour ne pas casser les files offline anciennes.

## Retour arrière fonctionnel

En cas d’incident frontend :

1. retirer les chargeurs Farmer Registry complet dans `shared/uppercase.js` ;
2. conserver toutes les nouvelles tables et données ;
3. ne pas supprimer les baselines, preuves ou actions ;
4. réactiver le frontend après correction.

Les migrations serveur ne doivent pas être annulées par suppression des tables, car elles peuvent déjà contenir des preuves historiques.

## Contrôles après migration

```sql
select count(*) from public.sustainability_question_catalog where active;
-- attendu : 25

select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in (
    'farmer_plots','farmer_production_baselines',
    'farmer_sustainability_baselines','farmer_sustainability_answers',
    'farmer_inspections','farmer_inspection_answers',
    'farmer_action_plans','farmer_visits','farmer_verifications'
  );

select p.proname,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'farmer_finalize_production_baseline',
    'farmer_finalize_sustainability_baseline',
    'farmer_finalize_inspection'
  );
-- attendu : anon=false, authenticated=true
```

Les fonctions trigger doivent avoir leurs privilèges RPC révoqués. Seules les trois fonctions métier de finalisation sont exécutables par `authenticated`.