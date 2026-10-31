# Matrice des identifiants et contraintes — Niveau 1

Date : 14 août 2026 · Migrations 02, 03, 04, 09

## 1. Principe

Trois identifiants coexistent, et ils ne servent pas à la même chose.

| Identifiant | Porté par | Rôle | L'intégrité en dépend-elle ? |
|---|---|---|---|
| `id` (uuid) | Le serveur | Clé technique stable, jamais réutilisée | **Oui** |
| `cle_idempotence` | Le **terminal**, avant tout envoi | Empêche le doublon de synchronisation | **Oui** |
| `local_id` | Le terminal | Conserve l'identifiant d'origine, permet de relier écran et serveur | Non — traçabilité |
| `*_code` (ACH-…, CYC-…) | Le serveur | Lisible au terrain et sur le papier | **Non, jamais** |

> Le code métier est produit par une séquence PostgreSQL. Une séquence **n'est
> pas sans trou** : une transaction annulée consomme un numéro. Un écart dans la
> numérotation lisible n'est donc pas un indice de fraude, et aucun contrôle ne
> doit s'appuyer dessus. Le registre papier (Lot H), lui, est bien sans trou :
> chaque numéro y est matérialisé en ligne.

## 2. Matrice par entité

| Entité | Clé technique | Code lisible | Idempotence | Unicité métier |
|---|---|---|---|---|
| Producteur | `producteurs.id` uuid | `code` | — | héritée du référentiel |
| Utilisateur / RT | `profils.user_id`, `rt.id` uuid | — | — | `user_id` unique |
| **Cycle de financement** | `n1_cycles.id` | `CYC-{CAMP}-{CLUSTER}-{SEQ}` | — | **un seul cycle `OUVERT` ou `BLOQUE` par (campagne, RT)** |
| Avance | `avances.id` | `AVA-…` | `cle_idempotence` unique | rattachée à un cycle `OUVERT` |
| **Achat** | `achats.id` | `ACH-…` | `cle_idempotence` unique | **`(campagne, rt_id, numero_recu normalisé)` unique** |
| Reçu (numéro) | — | `numero_recu` | — | voir ci-dessus + registre papier |
| Paiement | porté par `achats.montant` et `mode_paiement` | — | — | *voir angle mort A-05* |
| Commission | porté par `achats.commission_rt` | — | — | *voir angle mort A-05* |
| Mouvement de sacs | `sacs_mouvements.id` | `SAC-…` | `cle_idempotence` unique | `bag_movement_code` (Sacherie V2) |
| Solde physique | `n1_soldes.id` | — | — | `(campagne, article, entite_type, entite_ref)` unique |
| Mouvement de stock | `n1_stock_mouvements.id` | `STK-…` | `cle_idempotence` unique | un seul `ENTREE_ACHAT` par achat |
| Lot RCN | `n1_lots.id` | `lot_code` unique | — | — |
| Évacuation | `n1_evacuations.id` | `evacuation_code` unique | — | un lot n'est évacué qu'une fois |
| Réception usine | `n1_receptions_usine.id` | `REC-…` | — | **une évacuation = une réception** |
| Réconciliation | `n1_reconciliation_lignes.id` | `execution_uid` | — | — |
| Anomalie | `n1_anomalies.id` | `ANO-{ANNÉE}-{SEQ}` | `empreinte` | **une seule anomalie vivante par empreinte** |
| Ajustement | `n1_ajustements.id` | `AJU-…` | — | référence obligatoire à l'enregistrement corrigé |
| Exception | `n1_exceptions.id` | `exception_code` | — | une seule `APPROUVEE` par (type, ressource, cycle) |
| Opération de synchro | `n1_sync_operations.id` | — | `cle_idempotence` **unique** | — |
| Formulaire papier | `n1_papier_numeros.id` | `AFLP-{CAMP}-{CLUSTER}-{RT}-{SEQ}` | — | unique par campagne **et** par série ; un formulaire = une opération |

## 3. Périmètre d'unicité du reçu — décision et justification

**Retenu : `UNIQUE (campagne, rt_id, numero_recu normalisé)`.**

La normalisation supprime casse, espaces et ponctuation : `R-0001`, `r 0001` et
`R/0001` sont **le même reçu** et le second est rejeté (vérifié, T01).

| Option | Écartée parce que |
|---|---|
| Global par campagne | Les carnets papier actuels commencent tous à 0001 par RT. Le reçu 0001 du deuxième RT serait rejeté à tort. |
| Par cluster | Même problème, atténué mais réel. |
| **Par campagne + RT** | Couvre le risque réel — saisir deux fois le même reçu physique, donc payer deux fois — qui est toujours interne à un RT. |

**Évolution prévue** : une fois le Lot H déployé, le numéro papier est unique par
construction (`AFLP-CAMPAGNE-CLUSTER-RT-SEQUENCE`) et l'unicité globale devient
posable sans faux rejet. C'est une décision à prendre après la première campagne
complète, pas avant.

## 4. Contraintes posées, et leur état

Toutes les contraintes rétroactives sont **`NOT VALID`** : elles protègent chaque
ligne nouvelle sans juger l'historique, et la migration réussit même sur une base
non conforme. C'est le précédent établi par la Sacherie V2.

| Contrainte | Table | Type | État |
|---|---|---|---|
| `achats_recu_campagne_rt_uidx` | achats | index unique partiel | **actif immédiatement** |
| `*_local_id_requis_chk` | 4 tables | CHECK | `NOT VALID` |
| `*_cle_idem_requise_chk` | 4 tables | CHECK | `NOT VALID` |
| `*_source_saisie_chk` | 4 tables | CHECK | `NOT VALID` |
| `*_n1_statut_chk` | achats, avances | CHECK | `NOT VALID` |
| `n1_soldes_non_negatif_chk` | n1_soldes | CHECK | **validée** (table neuve) |
| `n1_cycles_un_actif_par_rt_uidx` | n1_cycles | index unique partiel | **validé** (table neuve) |
| `n1_exc_pas_auto_approbation` | n1_exceptions | CHECK | validée |
| `n1_ajust_pas_auto_appro` | n1_ajustements | CHECK | validée |
| `n1_ajust_pas_auteur_appro` | n1_ajustements | CHECK | validée |
| `n1_recep_evac_uidx` | n1_receptions_usine | index unique | validé |
| `n1_anom_empreinte_uidx` | n1_anomalies | index unique partiel | validé |
| `n1_sync_cle_uidx` | n1_sync_operations | index unique | validé |
| `n1_pap_num_lisible_uidx` | n1_papier_numeros | index unique | validé |

Validation différée, **après** régularisation de l'historique mesurée par
`PRECHECK_doublons_et_blocages.sql` :

```sql
alter table public.achats validate constraint achats_local_id_requis_chk;
```

## 5. Pourquoi des triggers plutôt que des clés étrangères

`achats.rt_id` est de type `text` ; `rt.id` est de type `uuid`. Une vraie clé
étrangère exigerait de convertir la colonne, donc de réécrire l'historique —
opération destructive, exclue par le cadre de cette intervention.

La validation référentielle est donc portée par `n1_achat_garde()` (migration 03),
qui refuse tout achat dont le RT ou le producteur est absent du référentiel
(vérifié, T02). La différence pratique avec une vraie clé étrangère :

- une FK protégerait aussi contre la **suppression** d'un RT encore référencé ;
- le trigger, lui, ne protège que l'écriture d'un achat.

Cet écart est inscrit au registre des angles morts sous **A-02**.
