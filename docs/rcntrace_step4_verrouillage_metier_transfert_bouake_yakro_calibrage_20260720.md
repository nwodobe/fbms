# RCN Trace — Étape 4 : verrouillage métier du transfert Bouaké / Yakro / Calibrage

Date : 20/07/2026
Périmètre : RCN Trace
Statut : correction ciblée d'interface et de logique runtime

---

## 1. Objectif

L'étape 4 vise à empêcher qu'une matière simplement stockée dans un entrepôt Yakro soit utilisée comme matière disponible pour le calibrage sans transfert explicite vers l'atelier de calibrage.

Le risque identifié à l'étape 2 et rendu visible à l'étape 3 est le suivant :

- Bouaké est un entrepôt.
- Yakro est aussi un entrepôt.
- Le calibrage est un atelier de production distinct.
- Un transfert Bouaké -> Yakro ne suffit pas pour alimenter le calibrage.
- Une livraison directe fournisseur à Yakro ne suffit pas non plus pour alimenter le calibrage.
- Une BIN Yakro doit d'abord faire l'objet d'un transfert explicite Yakro -> Calibrage.

---

## 2. Principe métier retenu

La chaîne correcte est :

```text
Réception fournisseur ou transfert interne
        ↓
Entrepôt Bouaké ou Yakro
        ↓
Lot officiel RCN
        ↓
BIN entrepôt
        ↓
Transfert explicite vers Calibrage
        ↓
Réception au calibrage
        ↓
Opération CAL
```

Le point clé est que la matière stockée à Yakro reste une matière d'entrepôt tant qu'elle n'a pas été sortie par un transfert vers calibrage.

---

## 3. Correction appliquée

### 3.1 Fichier ajouté

```text
rcntrace/transfer-business-locks.js
```

Ce fichier ajoute une couche de verrouillage runtime non destructive.

Il ne modifie pas les structures Supabase.
Il ne migre aucune donnée.
Il ne supprime aucune donnée.
Il n'écrit pas directement dans les tables.

---

## 4. Actions verrouillées

### 4.1 Préparation d'un transfert vers calibrage

Lorsqu'un utilisateur prépare un transfert avec destination calibrage, le verrou vérifie que la BIN source est une BIN Yakro.

Règle appliquée :

```text
Seul un stock BIN Yakro peut être envoyé vers calibrage.
```

Si la BIN source est Bouaké, le message métier bloque l'action :

```text
Blocage métier : seul un stock BIN Yakro peut être envoyé vers calibrage.
Transférez d'abord la matière vers Yakro entrepôt, puis créez un transfert Yakro -> Calibrage.
```

### 4.2 Réception au calibrage

La réception au calibrage est refusée si le transfert est de type entrepôt.

Règle appliquée :

```text
Un transfert Bouaké -> Yakro doit être réceptionné comme transfert entrepôt.
Il ne peut pas être réceptionné comme transfert calibrage.
```

### 4.3 Création d'une opération CAL

Une opération CAL ne peut être créée que si :

```text
1. le transfert existe ;
2. le transfert n'est pas un transfert entrepôt ;
3. le transfert est explicitement destiné au calibrage ;
4. le transfert est reçu ou partiellement reçu au calibrage ;
5. la réception calibrage est validée.
```

Si l'une de ces conditions manque, la création de l'opération est bloquée.

---

## 5. Écrans renforcés visuellement

Le fichier ajoute aussi un bandeau de verrouillage sur les écrans sensibles :

```text
transfert
caltransferts
calreception
calops
```

Le but est que l'utilisateur voie immédiatement qu'il est dans une zone où la destination du flux est contrôlée.

---

## 6. Fichier modifié

### 6.1 `rcntrace/flow-clarity.js`

Modification appliquée :

```text
chargement automatique de transfer-business-locks.js
```

Le choix a été volontairement prudent :

- ne pas réécrire `rcntrace.js` ;
- ne pas réécrire `rcntrace-ui.js` ;
- ajouter un guard runtime indépendant ;
- garder un rollback simple.

---

## 7. Pourquoi ne pas modifier directement `rcntrace.js` ?

Le moteur `rcntrace.js` est volumineux et contient déjà beaucoup de logique métier.

Modifier directement ce fichier aurait augmenté le risque de :

- casser une fonction existante ;
- perdre une partie du fichier ;
- créer un conflit avec les précédents correctifs ;
- rendre le rollback plus difficile.

La solution retenue est donc une couche de verrouillage externe, ciblée et réversible.

---

## 8. Contrôles existants confirmés

L'inspection du moteur a confirmé que certaines règles existaient déjà :

- les transferts ont une destination typée : `warehouse` ou `calibrage` ;
- `receiveAtCalibrage` refuse déjà les transferts entrepôt ;
- `createCal` exige un transfert reçu ;
- les transferts vers un entrepôt repassent par réception, sampling, GM, déchargement et lot.

L'étape 4 ne remplace pas ces règles : elle les rend plus strictes et plus visibles.

---

## 9. Limites de cette étape

Cette étape ne crée pas encore de contrainte serveur Supabase.

Le verrouillage est appliqué côté interface / moteur runtime.

Pour un verrouillage absolu serveur, il faudra plus tard ajouter des contraintes ou fonctions RPC côté Supabase, après stabilisation complète du modèle RCN Trace.

---

## 10. Audit technique

Fichiers concernés :

```text
rcntrace/transfer-business-locks.js
rcntrace/flow-clarity.js
docs/rcntrace_step4_verrouillage_metier_transfert_bouake_yakro_calibrage_20260720.md
```

Non modifié :

```text
rcntrace.js
rcntrace-ui.js
Supabase
Farmer Buying
```

Aucune action destructrice :

```text
aucun DROP
aucun TRUNCATE
aucun DELETE
aucun reset
aucune migration Supabase
aucune modification de données
```

---

## 11. Décision recommandée

Passer ensuite à :

```text
RCN Trace — Étape 5 : rendre le workflow opérationnel terrain de bout en bout
```

Objectif de l'étape 5 : tester et renforcer le parcours complet :

```text
Réception camion -> sampling -> décision GM -> déchargement -> lot officiel -> BIN -> transfert -> réception Yakro -> transfert calibrage -> réception calibrage -> opération CAL.
```

---

## 12. Point d'attention

Le verrouillage runtime doit être validé dans le navigateur après déploiement GitHub Pages :

- hard refresh recommandé ;
- tester avec une BIN Bouaké vers calibrage : doit être bloqué ;
- tester avec un transfert Bouaké -> Yakro : doit rester entrepôt ;
- tester avec une BIN Yakro vers calibrage : autorisé ;
- tester création CAL sans réception calibrage : doit être bloqué ;
- tester création CAL après réception calibrage validée : autorisé.
