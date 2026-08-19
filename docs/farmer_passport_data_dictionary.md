# AFLP Farmer Registry — Data Dictionary complet

## Conventions

- **Source** : déclarée, observée, documentée, calculée ou vérifiée.
- **Confidentialité** : interne, personnel, sensible ou très sensible.
- Les champs `created_by`, `updated_by`, `captured_by`, `verified_by` sont imposés ou contrôlés côté serveur.

## Producteur et passeport

| Champ technique | Label UI | Type | Obligatoire | Source | Validation | Preuve | Confidentialité | Description |
|---|---|---:|:---:|---|---|---|---|---|
| `producteurs.id` | Technical ID | text | Oui | Client | Unique, immuable | SYSTEM | Interne | Clé technique des relations |
| `producteurs.code` | Farmer ID | text | Après sync | Serveur | Unique, immuable | SYSTEM | Interne | Identifiant lisible |
| `producteurs.nom` | Nom | text | Oui | Déclarée | Non vide | DECLARED | Personnel | Nom principal |
| `producteurs.prenoms` | Prénoms | text | Non | Déclarée | Texte | DECLARED | Personnel | Prénoms structurés |
| `producteurs.telephone` | Téléphone | text | Oui | Déclarée | 10 chiffres CI | DECLARED | Personnel | Contact et doublons |
| `producteurs.village_id` | Village | text | Oui | Référentiel | Village existant | DOCUMENTED | Interne | Village AFLP |
| `producteurs.rt_id` | RT | text | Oui | Référentiel | RT du même village | DOCUMENTED | Interne | RT référent |
| `producteurs.passport_stage` | Maturité | text | Oui | Calculée | INCOMPLETE à VERIFIED | CALCULATED | Interne | Niveau documentaire |
| `producteurs.passport_completion` | Complétude | smallint | Oui | Calculée | 0 à 100 | CALCULATED | Interne | Pas un score ESG |
| `producteurs.risk_profile` | Risk Profile | text | Oui | Calculée | Règles explicites | CALCULATED | Restreint | Risque opérationnel |
| `producteurs.review_required` | Review Required | boolean | Oui | Métier | Motif explicite | SYSTEM | Interne | Revue managériale |
| `producteurs.record_version` | Version | bigint | Oui | Serveur | Incrémentée | SYSTEM | Interne | Audit et conflits |

## Parcelles et GPS

| Champ technique | Label UI | Type | Obligatoire | Source | Validation | Preuve | Confidentialité | Description |
|---|---|---:|:---:|---|---|---|---|---|
| `farmer_plots.id` | Plot ID | uuid | Oui | Client | Unique | SYSTEM | Interne | Clé parcelle |
| `farmer_plots.producteur_id` | Producteur | text | Oui | Système | FK producteur | SYSTEM | Interne | Propriétaire logique |
| `farmer_plots.village_id` | Village parcelle | text | Oui | Référentiel | Même village que producteur | DOCUMENTED | Interne | Localisation administrative |
| `farmer_plots.local_name` | Nom local | text | Non | Déclarée | Texte | DECLARED | Interne | Repère terrain |
| `farmer_plots.declared_area` | Surface déclarée | numeric | Oui MVP | Déclarée | > 0 | DECLARED | Interne | Jamais présentée comme GPS vérifiée |
| `farmer_plots.area_unit` | Unité | text | Oui | Référentiel | HA/M2/ACRE/OTHER | SYSTEM | Interne | Unité saisie |
| `farmer_plots.land_tenure_status` | Statut foncier | text | Oui | Déclarée | Liste contrôlée | DECLARED | Sensible | Statut déclaré |
| `farmer_plots.orchard_age_years` | Âge verger | numeric | Non | Déclarée | >= 0 | DECLARED | Interne | Âge approximatif |
| `farmer_plots.tree_count` | Nombre d’arbres | integer | Non | Déclarée | >= 0 | DECLARED | Interne | Estimation |
| `farmer_plots.productive_tree_count` | Arbres productifs | integer | Non | Déclarée | <= total | DECLARED | Interne | Estimation |
| `farmer_plots.latitude` | Latitude | numeric | Conditionnel | GPS | -90 à 90 | GPS VERIFIED | Très sensible | Point représentatif |
| `farmer_plots.longitude` | Longitude | numeric | Conditionnel | GPS | -180 à 180 | GPS VERIFIED | Très sensible | Point représentatif |
| `farmer_plots.gps_accuracy_m` | Précision | numeric | Avec GPS | GPS | > 0 | GPS VERIFIED | Sensible | Précision appareil |
| `farmer_plots.gps_captured_at` | Date GPS | timestamptz | Avec GPS | Appareil | Horodatage | SYSTEM | Sensible | Date client |
| `farmer_plots.gps_captured_by` | Agent GPS | uuid | Avec GPS | Auth | `auth.uid()` | SYSTEM | Sensible | Auteur imposé serveur |
| `farmer_plots.gps_status` | Statut GPS | text | Oui | Métier | Liste contrôlée | SYSTEM | Interne | NOT_MAPPED à GPS_VERIFIED |
| `farmer_plots.gps_verified_area` | Surface GPS vérifiée | numeric | Non | Vérifiée | GPS_VERIFIED requis | GPS VERIFIED | Sensible | Distincte de la surface déclarée |
| `farmer_plots.geometry_geojson` | Polygone futur | jsonb | Non | GPS | Objet GeoJSON | GPS VERIFIED | Très sensible | Compatibilité GPS Level 2 |
| `farmer_plots.area_source` | Source surface | text | Oui | Métier | Liste contrôlée | SYSTEM | Interne | Déclarée, observée ou GPS |
| `farmer_plots.evidence_level` | Niveau de preuve | text | Oui | Métier | Liste contrôlée | SYSTEM | Interne | Niveau affiché dans l’UI |

## Production Baseline

| Champ | Label | Type | Obligatoire FINAL | Source / validation |
|---|---|---:|:---:|---|
| `producteur_id` | Producteur | text | Oui | FK producteur |
| `campaign` | Campagne | text | Oui | Non vide |
| `version` | Version | integer | Oui | Attribuée sous verrou transactionnel |
| `productive_area_ha` | Surface productive | numeric | Oui | > 0 |
| `previous_production_kg` | Production précédente | numeric | Oui | >= 0 |
| `forecast_kg` | Prévision | numeric | Oui | >= 0 |
| `productive_tree_count` | Arbres productifs | integer | Non | >= 0 |
| `previous_sales_channel` | Canal précédent | text | Non | Déclaré |
| `already_anagroci_supplier` | Fournisseur ANAGROCI | boolean | Non | Déclaré/documenté |
| `evidence_level` | Niveau de preuve | text | Oui | DECLARED à AUDITED |
| `yield_kg_ha` | Rendement | numeric | Calculé | Production / surface |
| `status` | Statut | text | Oui | DRAFT/FINAL/CANCELLED |
| `supersedes_id` | Version précédente | uuid | Non | Historisation |

## Sustainability

### Catalogue

| Champ | Description |
|---|---|
| `question_code` | Code stable A01 à D06 |
| `catalog_version` | Version du questionnaire |
| `domain` | Domaine Sustainability |
| `label_fr` / `label_en` | Libellés |
| `guidance_fr` | Guide d’observation |
| `risk_trigger_answers` | Réponses déclenchant un risque |
| `risk_level` | NONE/MEDIUM/HIGH/REVIEW_REQUIRED |
| `default_corrective_action` | Action proposée automatiquement |
| `default_priority` | LOW/MEDIUM/HIGH/CRITICAL |

### Baseline

| Champ | Description |
|---|---|
| `producteur_id` | Producteur évalué |
| `plot_id` | Parcelle optionnelle |
| `campaign` | Campagne |
| `catalog_version` | Version des questions |
| `version` | Version historisée |
| `status` | DRAFT/FINAL/CANCELLED |
| `answered_count` / `required_count` | Complétude du questionnaire |
| `risk_profile` | Risque calculé, pas un score |
| `risk_reasons` | Justifications structurées |
| `supersedes_id` | Baseline précédente |

### Réponses

| Champ | Valeurs / description |
|---|---|
| `answer` | YES, NO, PARTIAL, UNKNOWN, NOT_VERIFIED, NOT_APPLICABLE |
| `evidence_level` | DECLARED, OBSERVED, DOCUMENTED, GPS_VERIFIED, AUDITED |
| `observation` | Faits et contexte |
| `proof_id` | Preuve optionnelle |

## Inspections

| Champ | Description |
|---|---|
| `inspection_type` | BASELINE_CHECK, FOLLOW_UP, VERIFICATION, INCIDENT ou CORRECTIVE_ACTION_REVIEW |
| `inspection_date` | Date terrain |
| `inspector_id` | Auteur imposé par auth |
| `latitude`, `longitude`, `gps_accuracy_m` | Position sensible de l’inspection |
| `status` | DRAFT/FINAL/CANCELLED |
| `risk_profile`, `risk_reasons` | Résultat transparent |

Chaque inspection utilise des lignes distinctes dans `farmer_inspection_answers`. Elle n’écrase jamais une baseline.

## Plans d’action

| Champ | Description |
|---|---|
| `category` | Domaine de l’anomalie |
| `issue` | Problème constaté |
| `corrective_action` | Correction attendue |
| `responsible_user_id`, `responsible_name` | Responsable |
| `due_date` | Échéance |
| `status` | OPEN, IN_PROGRESS, OVERDUE, CLOSED, CANCELLED |
| `priority` | LOW, MEDIUM, HIGH, CRITICAL |
| `evidence_id` | Preuve obligatoire à la clôture |
| `reviewer_id`, `reviewer_name` | Supervision de clôture |

## Visites, formations et preuves

| Entité | Champs clés |
|---|---|
| `farmer_visits` | type, date, GPS, objet, résultat, prochaine action |
| `participants_formation` | session, présence, compétence, localisation, preuve |
| `preuves` | entité, type, Storage path, GPS, timestamps, SHA-256, auteur |
| `farmer_verifications` | décision, méthode, checks, preuve, reviewer |

Les preuves sont stockées dans le bucket privé `terrain-preuves`. Les fichiers ne sont pas conservés en base64 comme preuve définitive.
