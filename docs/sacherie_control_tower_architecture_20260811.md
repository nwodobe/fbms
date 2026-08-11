# AFLP 2027 — Architecture cible Sacherie Control Tower

Date : 11/08/2026  
Statut : conception issue d'un audit réel de Production

## 1. Objectif

Le module Sacherie ne doit plus être un simple formulaire de mouvements ni un écran centré uniquement sur le SOP-006. Il doit devenir le système de contrôle du patrimoine de sacs ANAGROCI : localisation, état, responsabilité, mouvements, inventaires, écarts et alertes.

Principe directeur : **un sac ANAGROCI doit toujours avoir une localisation, un état, un responsable et une histoire.**

## 2. Audit de l'existant

### Farmer Buying

- `sacs_mouvements` : registre historique terrain. 11 mouvements en Production au moment de l'audit.
- `bag_movement_requests` : workflow Sacherie V2 de demande, approval BM et remise. Aucune demande créée à ce stade.
- `sacherie_*` : RPC et triggers de contrôle du plafond 80 kg / +10 %, cycle financé, approval et remise.

Limite : `sacs_mouvements` décrit des flux mais ne constitue pas un registre complet par localisation + état. Les anciens types `DECHIRE_RT` / `DECHIRE_PROD` mélangent en plus « déchiré » et « perdu ».

### RCN TRACE

L'infrastructure `rcn_jute_*` existe déjà et est nettement plus riche :

- `rcn_jute_movements` : ledger transactionnel interne ;
- `rcn_jute_locations` : emplacements ;
- `rcn_jute_v_stock` : stock calculé par emplacement et état ;
- `rcn_jute_inventories` : stock théorique, comptage physique et écart ;
- `rcn_jute_transfers` : expédition / réception / écarts ;
- `rcn_jute_repairs` : réparations et irréparables ;
- `rcn_jute_loss_requests` : pertes soumises à décision ;
- `rcn_jute_reconciliations` : rapprochement des sacs au déchargement ;
- Storage privé `rcn-jute-proofs` utilisé par l'interface RCN TRACE.

Au moment de l'audit, les tables opérationnelles `rcn_jute_*` ne contiennent encore aucun mouvement de stock. C'est le meilleur moment pour converger avant qu'un second historique ne se forme.

## 3. Décision d'architecture

### Source de vérité

**`rcn_jute_movements` devient le registre canonique du patrimoine de sacs.**

Le stock ne doit jamais être saisi directement. Il est calculé à partir du ledger transactionnel :

`Stock localisation / état = entrées - sorties`

### Rôle des autres objets

- `bag_movement_requests` reste la couche d'autorisation métier AFLP pour les dotations RT.
- `sacs_mouvements` reste le registre historique / compatibilité Farmer Buying pendant la transition.
- Tout nouveau mouvement `sacs_mouvements` compatible est automatiquement projeté dans `rcn_jute_movements` par un bridge idempotent.
- Les anciens mouvements sont backfillés une seule fois avec une clé d'événement unique.
- Le dashboard lit uniquement le registre canonique, jamais une somme manuelle de KPI.

Cette architecture donne une seule réponse à la question : **« combien de sacs possède ANAGROCI et où sont-ils ? »**

## 4. Modèle de localisation AFLP

Les localisations physiques sont créées dans `rcn_jute_locations` avec une métadonnée de périmètre :

- `CLUSTER` : stock physique au cluster ;
- `RT` : sacs sous responsabilité d'une équipe RT ;
- `PRODUCTEUR` : sacs physiquement chez un producteur quand cette étape est tracée ;
- `HUB` : sacs pleins regroupés au hub ;
- `FACTORY` : sacs arrivés usine ;
- `TRANSIT` : sacs expédiés non encore réceptionnés ;
- `REPARATION` : sacs chez le réparateur ;
- `REBUT` : sacs réformés mais encore physiquement comptables.

Les codes techniques sont déterministes afin d'éviter les doublons.

## 5. Modèle d'état

Le ledger RCN TRACE est conservé et étendu au besoin. Correspondance interface :

| État canonique | Affichage Control Tower |
|---|---|
| `UTILISABLE` | Vide disponible |
| `PLEIN` | Plein |
| `EN_TRANSIT` | En transit |
| `DECHIRE` | Déchiré / à évaluer |
| `A_REPARER` | En réparation |
| `REPARE` | Réparé, à reclasser |
| `REFORME` | REBUT |
| `HUMIDE` | Humide |
| `A_CLASSER` | À classer |

Un sac déchiré ne sort donc pas automatiquement du patrimoine. Il reste visible jusqu'à une décision de réparation, REBUT ou perte approuvée.

## 6. Bridge Farmer Buying → registre canonique

Mapping prévu :

| Farmer Buying | Canonique |
|---|---|
| `USINE_CLUSTER` | entrée `UTILISABLE` au cluster |
| `DOTATION_RT` | cluster `UTILISABLE` → RT `UTILISABLE` |
| `DISTRIBUTION` | RT `UTILISABLE` → producteur `UTILISABLE` |
| `ENLEVEMENT` | producteur `UTILISABLE` → hub `PLEIN` |
| `RETOUR_PROD` | producteur `UTILISABLE` → RT `UTILISABLE` |
| `RETOUR_RT` | RT `UTILISABLE` → cluster `UTILISABLE` |
| `DECHIRE_RT` | RT `UTILISABLE` → RT `DECHIRE` |
| `DECHIRE_PROD` | producteur `UTILISABLE` → producteur `DECHIRE` |

Chaque projection porte `legacy_sacs_id` et un `event_key` unique. Une resynchronisation ne peut donc pas doubler le stock.

## 7. Command Center

Le snapshot Branch Manager doit exposer au minimum :

- total sous contrôle ;
- vides disponibles ;
- pleins ;
- transit ;
- déchirés ;
- à réparer ;
- réparés ;
- REBUT ;
- pertes approuvées ;
- écarts d'inventaire ouverts ;
- approvals en attente / expirées ;
- stock physique par cluster ;
- responsabilité par RT ;
- historique récent ;
- alertes priorisées.

Un chiffre sans transaction explicative est interdit.

## 8. Inventaire et réconciliation

`rcn_jute_inventories` est réutilisé. Un inventaire Control Tower est regroupé par `inventory_batch_id` et contient les comptages par état.

- écart nul : `PASS` ;
- écart non nul : `HOLD` ;
- ajustement éventuel : décision BM explicite, journalisée par un mouvement `AJUSTEMENT_INVENTAIRE` ;
- aucun ajustement silencieux.

## 9. Sécurité

- Les écritures sensibles restent serveur-side.
- Les helpers internes ne sont pas des API navigateur.
- Les RPC publiques vérifient `auth.uid()`, profil actif, fonction opérationnelle et périmètre cluster.
- Le BM peut voir l'ensemble.
- UH / Assistant UH / Warehouse Keeper ne voient et n'agissent que dans leur cluster.
- Les dotations RT continuent à passer par `bag_movement_requests` et l'approval BM.

## 10. Règles de fiabilité des KPI

- `Stock physique` n'est affiché que lorsqu'un inventaire existe.
- Le `plafond RT` n'est affiché que si les données nécessaires au calcul ont été vérifiées.
- Les besoins futurs de sacs issus des financements sont présentés comme une **estimation**, jamais comme un stock réel.
- Les sacs avec acteur non résolu sont visibles comme anomalie, jamais masqués.

## 11. Plan d'implémentation

1. Bridge et registre canonique AFLP.
2. Snapshot Control Tower.
3. Dashboard global et drill-down Cluster / RT.
4. Inventaire physique et écarts.
5. Workflow déchiré → réparation / REBUT.
6. Alertes.
7. Recherche / filtres mouvements.
8. Recette serveur et interface.
9. Mise en production contrôlée.

## 12. Point de vigilance

Le système RCN Jute contient historiquement une logique « fournisseur » distincte du périmètre RT. Cette logique n'est pas supprimée. La convergence se fait au niveau du **ledger interne de propriété ANAGROCI**, tandis que les balances fournisseurs gardent leur ledger `FOURNISSEUR` propre.
