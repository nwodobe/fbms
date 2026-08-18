# AFLP Farmer Registry — Tests d’acceptation complets

Date d’exécution serveur : 18 août 2026

## 1. Résultats Phase 1 conservés

| Test | Résultat |
|---|---|
| Farmer ID unique pour deux producteurs du même village | PASS |
| Farmer ID immuable | PASS |
| RT hors village | PASS, blocage serveur |
| Doublon potentiel | PASS, signalement et revue |
| Consentement complet incohérent | PASS, refusé |
| Consentements historisés | PASS |
| Numéro de pièce privé | PASS |
| Audit expurgé des pièces | PASS |

## 2. Parcelles et GPS

| Test | Résultat |
|---|---|
| Création d’une parcelle liée au producteur | PASS |
| Village parcelle différent du producteur | PASS, bloqué |
| Surface déclarée <= 0 | PASS, bloquée |
| Arbres productifs > arbres totaux | PASS, bloqué |
| Point GPS sans précision ou timestamp | PASS, bloqué |
| Capture GPS par rôle terrain | PASS |
| Auteur GPS fourni par le client | PASS, remplacé par `auth.uid()` |
| Passage `POINT_CAPTURED` vers `GPS_VERIFIED` par Agent | PASS, bloqué |
| Vérification GPS par Branch Manager | PASS |
| Surface GPS vérifiée sans statut GPS_VERIFIED | PASS, bloquée |

## 3. Production Baseline

| Test | Résultat |
|---|---|
| Baseline DRAFT sauvegardée | PASS |
| Finalisation avec données obligatoires | PASS |
| Finalisation incomplète | PASS, bloquée |
| Rendement kg/ha calculé côté serveur | PASS |
| Modification d’une baseline FINAL | PASS, bloquée |
| Nouvelle version conservant l’ancienne | PASS |
| Attribution concurrente des versions | PASS, verrou transactionnel installé |

## 4. Sustainability Baseline

Le scénario complet a inséré 25 réponses dans une transaction annulée.

| Test | Résultat |
|---|---|
| Catalogue actif | PASS, 25 critères |
| Réponse `UNKNOWN` conservée | PASS |
| Finalisation avec une réponse obligatoire manquante | PASS, bloquée |
| Baseline sans risque critique | PASS, `LOW` |
| Baseline avec D04 = YES | PASS, `REVIEW_REQUIRED` |
| Création automatique d’une action critique | PASS |
| Ancienne baseline conservée | PASS |
| Baseline FINAL modifiée | PASS, bloquée |
| Passport après production + Sustainability | PASS, `BASELINE`, 100 % |

## 5. Inspections et actions correctives

| Test | Résultat |
|---|---|
| Inspection séparée de la baseline | PASS |
| Réponses d’inspection historisées | PASS |
| Risque d’inspection calculé avec les mêmes règles explicites | PASS |
| Action corrective automatique | PASS |
| Action critique ouverte bloque VERIFIED | PASS |
| Clôture par Agent Recenseur | PASS, bloquée |
| Clôture sans preuve | PASS, bloquée |
| Clôture avec preuve et reviewer | PASS |
| Action en retard exposée comme OVERDUE | PASS |

## 6. Vérification du passeport

| Test | Résultat |
|---|---|
| APPROVED avant BASELINE | PASS, bloqué |
| APPROVED sans les trois checks | PASS, bloqué |
| APPROVED avec action critique ouverte | PASS, bloqué |
| APPROVED après preuve et clôture | PASS |
| Statut final | PASS, `VERIFIED`, 100 % |
| Vérification par Agent Recenseur | PASS, bloquée |

## 7. RLS et confidentialité

Un scénario a été exécuté avec le contexte réel du rôle `Agent Recenseur` puis annulé.

| Contrôle | Résultat |
|---|---|
| Création parcelle avec point GPS | Autorisée |
| Vérification GPS | Refusée |
| Clôture action corrective | Refusée |
| Vérification Farmer Passport | Refusée |
| Données synthétiques après rollback | 0 |
| Preuves synthétiques après rollback | 0 |

Les coordonnées exactes des parcelles, inspections et visites ne sont accessibles qu’aux rôles terrain et supervision. Les rôles transverses utilisent les vues agrégées sans coordonnées.

## 8. Offline et synchronisation

Contrôles statiques/runtime versionnés dans :

```text
tests/farmer-registry-complete.mjs
```

Ils vérifient :

- chargement des cinq modules complets ;
- syntaxe JavaScript ;
- nettoyage des colonnes calculées ;
- maintien des tables append-only ;
- statuts LOCAL/PENDING SYNC/SYNCED/SYNC ERROR ;
- logique de risque `UNKNOWN` et `REVIEW_REQUIRED` ;
- présence des tables, RPC et vues dans la migration consolidée ;
- absence de `service_role` ou de clé secrète.

## 9. Scénario serveur complet exécuté

```text
Producteur + consentement complet
  → Parcelle 4,5 ha
  → Point GPS puis GPS_VERIFIED
  → Production Baseline FINAL
  → Sustainability 25/25 sans risque
  → Passport BASELINE, 100 %, LOW
  → Nouvelle Sustainability avec D04 = YES
  → REVIEW_REQUIRED + action CRITICAL
  → Vérification refusée
  → Preuve + clôture supervision
  → Vérification APPROVED
  → Passport VERIFIED, 100 %
  → ROLLBACK
```

Résultat après transaction :

```text
producteurs synthétiques : 0
preuves synthétiques : 0
parcelles synthétiques : 0
baselines synthétiques : 0
actions synthétiques : 0
catalogue Sustainability actif : 25
```

## 10. Recette navigateur

Dimensions à maintenir :

- 390 × 844
- 768 × 1024
- 1440 × 900

Scénarios : ouverture du Passport, ajout multi-parcelles, capture GPS, mode avion, reprise réseau, baseline production, questionnaire 25 critères, risque critique, action automatique, preuve, clôture et vérification.
