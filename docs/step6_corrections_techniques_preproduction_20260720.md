# Étape 6 — Corrections techniques pré-production Farmer Buying

Date : 20 juillet 2026  
Projet : ANAGROCI Operations Suite / Farmer Buying 2027  
Statut : Corrections techniques pré-production  
RCN Trace : volontairement maintenu en dernière position

---

## 1. Objectif

L'étape 6 vise à renforcer techniquement le programme Farmer Buying avant le pilote réel.

Les étapes 3 à 5 ont sécurisé le parcours au niveau métier, recette et pré-production. Cette étape ajoute des contrôles serveur et une correction de synchronisation afin que les règles critiques ne reposent plus uniquement sur le navigateur.

---

## 2. Périmètre traité

### Inclus

- Création serveur des tables Farmer Buying manquantes utilisées par les modules terrain :
  - `avances` ;
  - `reconciliations` ;
  - `sacs_mouvements` ;
  - `farmer_buying_documents`.
- Activation RLS sur ces tables.
- Politiques d'accès `authenticated` pour lecture, insertion et mise à jour.
- Unicité globale des reçus d'achat terrain.
- Contrôle serveur du dépassement d'avance RT.
- Contrôle serveur des stocks sacs négatifs.
- Correction de l'ordre de synchronisation des mouvements sacs.

### Non inclus

- Aucun travail RCN Trace.
- Aucun effacement de données.
- Aucun changement des données existantes.
- Aucun changement du design.
- Aucun workflow BM complet d'exception.
- Aucun stockage fichier réel dans Supabase Storage à cette étape.

---

## 3. Migration Supabase appliquée

Migration appliquée :

```text
step6_farmer_buying_server_controls_v2
```

Statut : appliquée avec succès.

Une première tentative a été interrompue avant application complète. Elle n'a pas été retenue. La version `v2` est celle appliquée correctement.

---

## 4. Tables créées

### 4.1 `public.avances`

Table destinée aux avances RT.

Champs principaux :

- `local_id` unique ;
- `date` ;
- `cluster` ;
- `rt_id` ;
- `rt_nom` ;
- `source` ;
- `montant` ;
- `motif` ;
- `statut` ;
- `created_by_nom` ;
- `created_by` ;
- `created_at`.

Objectif : permettre au module Cash / Avances RT de synchroniser réellement les avances terrain.

---

### 4.2 `public.reconciliations`

Table destinée aux réconciliations RT.

Champs principaux :

- `local_id` unique ;
- `date` ;
- `cluster` ;
- `rt_id` ;
- `rt_nom` ;
- `cash_restant` ;
- `valeur_stock` ;
- `total_avance` ;
- `total_paye` ;
- `ecart` ;
- `statut` ;
- `created_by_nom` ;
- `created_by` ;
- `created_at`.

Objectif : permettre au BM de voir les RT à contrôler et de suivre les écarts.

---

### 4.3 `public.sacs_mouvements`

Table destinée aux mouvements de sacs terrain.

Champs principaux :

- `local_id` unique ;
- `date` ;
- `type` ;
- `source` ;
- `destination` ;
- `cluster` ;
- `village_id` ;
- `village_nom` ;
- `rt_id` ;
- `rt_nom` ;
- `producteur_id` ;
- `producteur_nom` ;
- `quantite` ;
- `observation` ;
- `document_url` ;
- `created_by_nom` ;
- `created_by` ;
- `created_at`.

Objectif : permettre au module Sacs / Sacherie de synchroniser les mouvements et de construire les soldes depuis le serveur.

---

### 4.4 `public.farmer_buying_documents`

Table préparatoire pour tracer les preuves documentaires.

Champs principaux :

- `objet_type` ;
- `objet_local_id` ;
- `numero_document` ;
- `url` ;
- `mime` ;
- `taille` ;
- `sha256` ;
- `statut` ;
- `created_by` ;
- `created_at`.

Objectif : préparer la conservation distante des preuves, même si l'upload fichier réel n'est pas encore activé.

---

## 5. Contrôles serveur ajoutés

### 5.1 Unicité globale des reçus

Un index unique a été ajouté sur le numéro de reçu achat terrain.

Règle :

```text
Un même numéro de reçu ne peut pas être utilisé deux fois dans la table achats.
```

Portée :

- contrôle serveur ;
- insensible aux espaces en début / fin ;
- insensible à la casse ;
- ignore les reçus vides.

Impact :

- le contrôle local existant reste utile ;
- le serveur devient la barrière finale contre les doublons multi-téléphones.

---

### 5.2 Contrôle serveur du dépassement d'avance RT

Un trigger serveur vérifie l'avance disponible avant insertion ou mise à jour d'un achat.

Règle :

```text
Montant du nouvel achat <= Avances actives RT - Achats déjà enregistrés RT
```

Si le montant dépasse le solde disponible, le serveur refuse l'opération.

Objectif : éviter qu'un RT puisse acheter au-delà de l'avance disponible, même si le navigateur n'a pas le cache Cash à jour.

---

### 5.3 Contrôle serveur des stocks sacs négatifs

Un trigger serveur vérifie les soldes sacs avant insertion ou mise à jour d'un mouvement.

Règle :

```text
Aucune sortie de sacs ne doit dépasser le solde disponible de la source.
```

Sources contrôlées :

- `CLUSTER` ;
- `RT` ;
- `PRODUCTEUR`.

Objectif : éviter les stocks sacs négatifs côté serveur.

---

## 6. Correction de synchronisation Sacs

Fichier modifié :

```text
shared/anagroci-sacs-guards.js
```

Correction :

```text
La file de synchronisation serveur des mouvements sacs est maintenant envoyée dans l'ordre chronologique croissant.
```

Pourquoi c'est important :

Avant, le stockage local gardait les mouvements les plus récents en premier. Cela pouvait envoyer une sortie de sacs avant l'entrée correspondante.

Exemple de risque :

```text
1. Réception cluster 100 sacs
2. Dotation RT 50 sacs
```

Si l'ordre d'envoi était inversé, le serveur pouvait recevoir la dotation avant la réception et bloquer à juste titre pour stock insuffisant.

La correction conserve l'affichage local récent en premier, mais envoie la synchronisation serveur du plus ancien au plus récent.

---

## 7. Vérifications effectuées

### Tables RLS

Vérification effectuée après migration :

```text
avances                 RLS activé
farmer_buying_documents RLS activé
reconciliations         RLS activé
sacs_mouvements         RLS activé
```

### Triggers serveur

Vérification effectuée :

```text
trg_fb_prevent_achat_over_advance sur achats
trg_fb_prevent_negative_bag_stock sur sacs_mouvements
```

---

## 8. Incidents techniques rencontrés pendant l'étape

### 8.1 Première tentative SQL interrompue

La première tentative de migration a été interrompue avant application complète.

Traitement :

- nouvelle migration complète appliquée sous le nom `step6_farmer_buying_server_controls_v2` ;
- vérification ensuite réalisée sur les tables et triggers.

### 8.2 Première écriture GitHub du guard sacs tronquée

Un premier commit a tronqué `shared/anagroci-sacs-guards.js`.

Traitement :

- fichier immédiatement réparé dans le commit suivant ;
- vérification du début et de la fin du fichier ;
- vérification spécifique de `syncPayload()`.

---

## 9. Limites restantes

Cette étape renforce fortement le serveur, mais certains sujets restent à traiter avant production large :

1. Upload réel des preuves documentaires vers Supabase Storage.
2. Liaison automatique reçu achat → `farmer_buying_documents`.
3. Interface BM d'approbation exceptionnelle.
4. Affichage propre des erreurs serveur dans les modules terrain.
5. Tests physiques sur téléphones RT.
6. Test multi-téléphones avec même reçu.
7. Test offline long avec synchronisation tardive.
8. Nettoyage éventuel du cache navigateur après déploiement.

---

## 10. Recommandation BM

Avant pilote réel, exécuter obligatoirement :

```text
1 RT test
1 téléphone Android
1 avance RT
1 achat valide
1 achat supérieur à l'avance
1 réception sacs cluster
1 dotation RT
1 sortie sacs supérieure au stock
1 coupure réseau
1 reconnexion / synchronisation
1 contrôle Command Center BM
```

Le pilote peut démarrer seulement si :

- l'achat valide se synchronise ;
- l'achat supérieur à l'avance est refusé ;
- la sortie sacs supérieure au stock est refusée ;
- les soldes sont corrects dans Command Center ;
- aucune opération pending ne disparaît.

---

## 11. Position de RCN Trace

RCN Trace reste volontairement en dernière position, conformément à la priorité donnée au programme Farmer Buying.
