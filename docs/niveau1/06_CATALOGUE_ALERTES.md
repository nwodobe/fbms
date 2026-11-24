# Catalogue des alertes — Niveau 1

Date : 14 août 2026 · Migration 07

## 1. Nature du moteur

Moteur de **règles explicites**, délibérément pas un modèle prédictif. Chaque
alerte est reproductible et opposable : on peut montrer à un RT le calcul exact
qui a produit l'alerte. Un score statistique ne le permettrait pas, et une
décision financière qui ne s'explique pas ne se défend pas.

L'IA prédictive et les scores de risque sont hors périmètre de cette intervention.

## 2. Anti-doublon

Une anomalie est identifiée par une **empreinte** :

```
TYPE | ressource | enregistrement | rt_id | cycle
```

Tant qu'une anomalie de même empreinte est `OUVERTE` ou `EN_COURS`, une nouvelle
détection **incrémente son compteur d'occurrences** au lieu d'en créer une
seconde. Un index unique partiel rend le doublon impossible, y compris entre deux
détections concurrentes — et la fonction rattrape la `unique_violation` pour
rejoindre l'anomalie créée par l'autre transaction.

Une anomalie **résolue** ne bloque pas les récidives : si le même problème
réapparaît, une nouvelle anomalie est ouverte. Sans cela, une résolution
prématurée masquerait définitivement le problème. Vérifié en T07.

## 3. Catalogue

| Type | Criticité | Déclencheur | Détection |
|---|---|---|---|
| `RECU_DUPLIQUE` | P0 | Index unique sur reçu normalisé | temps réel (signalement client) |
| `ACHAT_SANS_FINANCEMENT` | P0 | Aucun cycle ouvert pour le RT | temps réel |
| `ACHAT_SUPERIEUR_SOLDE` | P0 | Montant > financement disponible | temps réel |
| `AVANCE_CYCLE_NON_RECONCILIE` | P0 | Refinancement d'un cycle non réconcilié | temps réel |
| `SOLDE_SACS_NEGATIF` | P0 | `CHECK (quantite >= 0)` | temps réel |
| `STOCK_RCN_NEGATIF` | P0 | idem | temps réel |
| `ECART_CASH` | P0 | Écart de réconciliation non résolu à l'échéance | **par lot** (R5) |
| `ECART_STOCK` | P0 | idem | par lot (R5) |
| `ECART_SACS` | P1 | idem | par lot (R5) |
| `CYCLE_NON_CLOTURE_DELAI` | P1, **P0 au-delà de 7 j** | Échéance dépassée | par lot (R1) |
| `TRANSACTION_AVANT_FINANCEMENT` | P0 | Achat daté avant l'ouverture du cycle | par lot (R2) |
| `SYNCHRONISATION_TARDIVE` | P1 | Délai saisie → réception > `seuil_synchronisation_heures` | par lot (R3) |
| `MODIFICATION_APRES_CLOTURE` | P0 | Trigger `n1_verrou_cloture` | temps réel |
| `TENTATIVE_AUTO_APPROBATION` | P0 | Trigger `n1_pas_auto_approbation` | temps réel |
| `DEPASSEMENT_PLAFOND` | P0 | `n1_param_num_obligatoire` | temps réel |
| `RECEPTION_SANS_EVACUATION` | P0 | Clé étrangère `evacuation_id` | temps réel |
| `ECART_VILLAGE_CLUSTER` | P1 | Réconciliation dimension `STOCK_RCN` | par lot |
| `ECART_CLUSTER_USINE` | P1, **P0 au-delà du seuil grave** | Poids expédié ≠ poids reçu | par lot (R4) |
| `PAPIER_MANQUANT` | P1 | Numéro sauté entre deux numéros utilisés, ou perte déclarée | clôture quotidienne |
| `PAPIER_DUPLIQUE` | P0 | Index unique sur le numéro lisible | temps réel |
| `PAPIER_NON_ATTRIBUE` | P1 | Consommation d'un numéro non attribué | temps réel |

## 4. Contenu d'une alerte

| Champ | Toujours renseigné |
|---|---|
| `anomalie_code` `ANO-{ANNÉE}-{SEQ}` | ✅ |
| `type_anomalie` | ✅ |
| `criticite` P0 / P1 / P2 | ✅ |
| `rt_id`, `cluster`, `campagne`, `cycle_uid` | selon le contexte |
| `ressource`, `enregistrement` | selon le contexte |
| `description` factuelle, chiffrée | ✅ |
| `valeur_attendue`, `valeur_constatee`, `ecart` | pour les écarts |
| `statut` OUVERTE / EN_COURS / RESOLUE / REJETEE | ✅ |
| `responsable` | quand identifiable |
| `echeance` | ✅, calculée depuis la criticité |
| `occurrences`, `premiere_le`, `derniere_le` | ✅ |
| `resolution` + `preuve_resolution` | **obligatoires pour passer RESOLUE** — contrainte SQL |

## 5. Limite structurelle des alertes en temps réel

Quand un trigger **refuse** une écriture, il lève une exception : la transaction
est annulée, et une anomalie insérée juste avant le serait aussi. PostgreSQL n'a
pas de transaction autonome.

Bloquer prime sur tracer — les gardes lèvent donc bien une exception. Trois
mesures compensatoires :

1. **`RAISE WARNING`** dans `n1_auditer` : le journal PostgreSQL n'est pas annulé
   par le `ROLLBACK` et reste consultable dans les journaux Supabase.
2. **`n1_signaler_tentative()`** : le client rappelle cette RPC dans une nouvelle
   transaction après avoir reçu l'erreur. L'anomalie est alors durable.
3. **Détection par lot** `n1_detecter_anomalies()` : rattrape à froid ce que le
   temps réel a manqué.

Le client peut omettre l'appel de l'étape 2 — c'est précisément pourquoi les
étapes 1 et 3 existent. Inscrit sous **A-01**.

## 6. Exploitation

```sql
-- Passe de détection : idempotente, relançable sans risque de doublon.
select public.n1_detecter_anomalies();

-- Vue opérationnelle
select * from public.n1_vue_anomalies
where statut in ('OUVERTE','EN_COURS') order by criticite, echeance;

-- Résolution : preuve obligatoire
select public.n1_resoudre_anomalie('<uuid>', 'Ce qui a été fait', 'PV-2026-0042');
```

**Fréquence recommandée** : une passe quotidienne après la clôture du registre
papier. Elle n'est pas planifiée automatiquement — FBMS étant un site statique,
il n'existe aucun ordonnanceur dans le dépôt. Voir **A-07**.
