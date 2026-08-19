# AFLP Farmer Registry — Architecture complète

Date : 18 août 2026  
Version : 2.0.0

## 1. Objet

Le Farmer Passport est l’identité numérique centrale du producteur dans FBMS. `producteurs.id` est la clé technique immuable des relations. `producteurs.code` reste le Farmer ID lisible, unique et généré côté serveur.

```text
Producteur
  ├── Consentements
  ├── Parcelles et GPS
  ├── Baselines production
  ├── Baselines Sustainability
  ├── Inspections
  ├── Formations
  ├── Visites
  ├── Actions correctives
  ├── Preuves et documents
  ├── Achats
  └── Sacs / traçabilité
```

Le registre enrichit le module Producteurs existant. Il ne constitue ni une application séparée ni une réécriture de FBMS.

## 2. Composants frontend

```text
fbms/index.html
  -> shared/uppercase.js
     -> farmer-enrollment-phase1.js
     -> farmer-registry-read-phase1.js
     -> farmer-registry-privacy-phase1.js
     -> farmer-registry-sync.js
     -> farmer-registry-sync-policy.js
     -> farmer-registry-assessment.js
     -> farmer-registry-passport.js
     -> farmer-registry-operations.js
```

### `farmer-registry-sync.js`

Moteur offline dédié utilisant IndexedDB :

```text
aflp_farmer_registry_db
  ├── cache
  └── outbox
```

Statuts visibles :

```text
LOCAL
PENDING SYNC
SYNCED
SYNC ERROR
```

L’outbox ordonne les dépendances : parcelle avant baseline, baseline avant réponses, réponses avant RPC de finalisation. Une erreur bloque les opérations suivantes du même producteur sans bloquer les autres dossiers.

### `farmer-registry-assessment.js`

Rend le questionnaire Sustainability, conserve le niveau de preuve de chaque réponse et calcule un aperçu transparent du risque. `UNKNOWN` et `NOT_VERIFIED` ne sont jamais transformés en `NO`.

### `farmer-registry-passport.js`

Dossier 360° avec les onglets :

- Overview
- Parcelles
- Production
- Sustainability
- Formations
- Inspections
- Plans d’action
- Visites
- Achats
- Sacs
- Documents

### `farmer-registry-operations.js`

Gère les formulaires terrain : multi-parcelles, capture GPS, baselines, inspections, actions, visites, formations, preuves et vérification du passeport.

## 3. Modèle serveur

### Table maître

`producteurs` conserve l’identité, le rattachement, la maturité, la complétude et le profil de risque.

### Tables enfants

| Table | Fonction |
|---|---|
| `farmer_plots` | Parcelles, superficie déclarée, GPS point, futur GeoJSON |
| `farmer_production_baselines` | Baseline annuelle de production, rendement calculé |
| `sustainability_question_catalog` | Catalogue versionné des 25 critères |
| `farmer_sustainability_baselines` | Évaluation Sustainability historisée |
| `farmer_sustainability_answers` | Réponses et niveaux de preuve |
| `farmer_inspections` | Événements d’inspection indépendants |
| `farmer_inspection_answers` | Réponses observées lors d’inspections |
| `farmer_action_plans` | Actions correctives et clôture avec preuve |
| `farmer_visits` | Visites métier reliables à missions/check-ins |
| `farmer_verifications` | Décisions append-only de supervision |
| `participants_formation` | Table existante enrichie et reliée au Farmer ID |
| `preuves` | Table existante utilisée pour photos, documents, GPS et preuves |

## 4. Parcelles et GPS

Un producteur peut avoir plusieurs parcelles. La superficie déclarée reste distincte de la superficie GPS vérifiée.

```text
DECLARED
OBSERVED
DOCUMENTED
GPS_ESTIMATED
GPS_VERIFIED
```

Le MVP GPS utilise un point représentatif :

```text
latitude
longitude
accuracy
captured_at
captured_by
```

Le futur polygone est préparé dans `geometry_geojson`. Les coordonnées exactes sont protégées par RLS et réservées aux rôles terrain et supervision.

## 5. Baseline production

Chaque campagne crée une version distincte. Une version `FINAL` est immuable. Une correction crée une nouvelle version reliée par `supersedes_id`.

Le rendement est calculé côté serveur :

```text
yield_kg_ha = previous_production_kg / productive_area_ha
```

Les numéros de version sont protégés par verrou transactionnel afin d’éviter les collisions entre appareils.

## 6. Sustainability

Le catalogue `AFLP-SUST-2026.1` contient 25 critères répartis en quatre domaines :

1. pratiques agricoles ;
2. environnement ;
3. gestion phytosanitaire ;
4. social et sécurité.

Réponses autorisées :

```text
YES
NO
PARTIAL
UNKNOWN
NOT_VERIFIED
NOT_APPLICABLE
```

Chaque critère définit explicitement : réponses déclenchant un risque, niveau de risque, action corrective recommandée et priorité.

Il n’existe aucun Sustainability Score assimilable à une certification.

## 7. Risk Profile

Ordre de sévérité :

```text
NOT_ASSESSED < LOW < MEDIUM < HIGH < REVIEW_REQUIRED
```

Le calcul tient compte :

- de la dernière baseline Sustainability finalisée ;
- des doublons et revues requises ;
- du consentement partiel, refusé ou retiré ;
- des actions critiques ou hautes ouvertes.

Une baseline ou inspection à risque crée automatiquement les actions correctives prévues par le catalogue.

## 8. Maturité et complétude

Pondération documentaire :

| Catégorie | Points |
|---|---:|
| Identity | 30 |
| AFLP Assignment | 20 |
| Consent | 15 |
| Plots | 10 |
| GPS | 10 |
| Production Baseline | 10 |
| Sustainability Baseline | 5 |
| **Total** | **100** |

Maturité :

```text
BASIC
  identité + rattachement + consentement complet

MAPPED
  BASIC + parcelle active + point GPS

BASELINE
  MAPPED + baseline production FINAL + Sustainability FINAL

VERIFIED
  BASELINE + décision APPROVED de supervision
```

`VERIFIED` est refusé si une action critique reste ouverte.

## 9. Actions correctives

Les actions peuvent être créées manuellement ou automatiquement. Statuts :

```text
OPEN
IN_PROGRESS
OVERDUE
CLOSED
CANCELLED
```

La clôture ou l’annulation est réservée à la supervision. La clôture exige une preuve et conserve reviewer, date et auteur.

## 10. Sécurité

Trois capacités spécifiques sont définies côté PostgreSQL :

- `farmer_registry_can_capture()` ;
- `farmer_registry_can_supervise()` ;
- `farmer_registry_can_read_sensitive()`.

Les fonctions trigger ne sont pas appelables via l’API RPC. Les auteurs des captures GPS, baselines, inspections, visites et vérifications sont imposés par `auth.uid()`.

Les données GPS ne sont pas exposées aux rôles transverses. Les numéros de pièce restent dans la table privée Phase 1.

## 11. Vues

| Vue | Usage |
|---|---|
| `farmer_passport_summary_v` | Dossier 360 et KPI par producteur |
| `farmer_registry_dashboard_v` | Agrégats Zone/Cluster/Village/RT |
| `farmer_plot_map_v` | Carte sécurisée des parcelles |
| `farmer_sustainability_current_v` | Dernière baseline finalisée |
| `farmer_action_plans_effective_v` | Statut OVERDUE calculé |

## 12. Non-régression

Aucune table existante n’est supprimée. Aucun Farmer ID existant n’est modifié. Les achats et sacs historiques restent lisibles par l’ID technique ou le code pendant la transition. Les modules Cash et Réconciliation demeurent centrés sur le RT.
