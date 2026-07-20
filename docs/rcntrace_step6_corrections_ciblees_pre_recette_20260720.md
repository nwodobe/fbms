# RCN Trace — Étape 6
## Corrections ciblées pré-recette terrain

Date : 2026-07-20  
Périmètre : RCN Trace  
Mode : correction interface ciblée, non destructive  
Statut : prêt pour revue / recette terrain

---

## 1. Objectif

L'étape 5 a formalisé le protocole terrain bout-en-bout.

L'étape 6 ajoute une correction ciblée avant exécution réelle terrain : rendre ce protocole visible directement dans l'application RCN Trace, sans modifier le moteur métier principal.

Objectif opérationnel :

```text
Ne pas obliger l'utilisateur terrain à retrouver le protocole dans un fichier de documentation.
Le workflow critique doit être visible dans l'écran RCN Trace lui-même.
```

---

## 2. Limite importante

Cette étape n'est pas encore une correction après observations terrain réelles.

Aucune équipe terrain n'a encore remonté d'incident formel issu du protocole Step 5.

Donc cette étape est traitée comme :

```text
Correction ciblée pré-recette
```

et non comme :

```text
Correction post-recette terrain réelle
```

---

## 3. Problème traité

Même avec les bandeaux de clarification et les verrouillages métier, l'utilisateur peut encore se perdre dans la chaîne complète :

```text
Réception camion
Sampling
Décision GM
Déchargement
Lot officiel
BIN
Transfert Bouaké -> Yakro
Réception Yakro
Transfert Yakro -> Calibrage
Réception calibrage
Opération CAL
Sorties
QC
Bilan matière
Audit
```

Le risque n'est pas seulement technique.

Il est aussi opérationnel :

```text
Un utilisateur peut oublier une étape, ouvrir le mauvais écran, ou ne pas comprendre pourquoi une action est bloquée.
```

---

## 4. Correction appliquée

### 4.1 Nouveau fichier ajouté

```text
rcntrace/workflow-guide.js
```

Ce fichier ajoute un panneau flottant dans l'application :

```text
Workflow RCN
```

Il permet de visualiser le parcours terrain complet, avec :

- le numéro de l'étape ;
- le libellé opérationnel ;
- la règle métier à respecter ;
- un bouton d'accès rapide à l'écran concerné.

---

## 5. Étapes rendues visibles

Le guide couvre quinze points :

```text
01 - Réception camion
02 - Sampling qualité
03 - Décision GM
04 - Déchargement / pesée
05 - Lot officiel RCN
06 - Mise en BIN
07 - Transfert Bouaké -> Yakro
08 - Réception Yakro entrepôt
09 - Transfert Yakro -> Calibrage
10 - Réception calibrage
11 - Opération CAL
12 - Checklist machine
13 - Sorties calibres
14 - QC sorties
15 - Bilan matière / audit
```

---

## 6. Tests négatifs affichés dans le guide

Le panneau rappelle les tests négatifs obligatoires :

```text
Tentative Bouaké -> Calibrage directe
Tentative CAL depuis stock Yakro sans TRF calibrage
Réception calibrage d'un transfert entrepôt
Démarrage CAL sans checklist complète
Alimentation machine supérieure au reçu
Clôture avec écart hors tolérance non justifié
```

Ces tests restent essentiels pour valider que les garde-fous de l'étape 4 fonctionnent réellement.

---

## 7. Fichier modifié

### 7.1 Fichier

```text
rcntrace/flow-clarity.js
```

Modification effectuée :

```text
Ajout du chargement de workflow-guide.js
```

Le chargement est volontairement fait depuis `flow-clarity.js` pour éviter de modifier :

```text
rcntrace.js
rcntrace-ui.js
index.html
```

---

## 8. Fichiers non modifiés

Les fichiers critiques suivants n'ont pas été modifiés :

```text
rcntrace/rcntrace.js
rcntrace/rcntrace-ui.js
rcntrace/rcntrace-sync.js
supabase/rcntrace.sql
supabase/rcntrace_etl.sql
```

---

## 9. Données et Supabase

Aucune action Supabase n'a été réalisée.

```text
Aucune migration
Aucune table modifiée
Aucun trigger ajouté
Aucune donnée modifiée
Aucune donnée supprimée
Aucun reset
```

---

## 10. Farmer Buying

Farmer Buying n'est pas concerné par cette étape.

```text
Aucun fichier Farmer Buying modifié
Aucune table Farmer Buying modifiée
Aucune logique Farmer Buying modifiée
```

---

## 11. Règle métier rappelée

Le guide rappelle implicitement la règle centrale :

```text
Stock Yakro entrepôt ≠ matière disponible calibrage
```

La matière devient disponible pour production uniquement après :

```text
BIN Yakro
-> transfert explicite vers calibrage
-> réception calibrage validée
-> opération CAL
```

---

## 12. Décision de recette recommandée

Avant de passer à une correction plus profonde, l'équipe doit maintenant exécuter un test réel ou simulé sur l'application.

### 12.1 Scénario recommandé

```text
1 camion fournisseur reçu à Bouaké
1 sampling qualité
1 décision GM
1 déchargement
1 lot officiel
1 mise en BIN Bouaké
1 transfert Bouaké -> Yakro
1 réception Yakro entrepôt
1 nouveau lot/BIN Yakro
1 transfert Yakro -> Calibrage
1 réception calibrage
1 opération CAL
1 sortie calibre
1 contrôle qualité sortie
1 bilan matière
```

### 12.2 Critère GO

```text
GO si l'utilisateur suit le guide sans confusion majeure et si les blocages métier correspondent aux attentes.
```

### 12.3 Critère NO-GO

```text
NO-GO si l'utilisateur peut encore utiliser une matière Yakro comme matière calibrage sans transfert explicite, ou si le guide provoque une confusion avec les écrans existants.
```

---

## 13. Prochaine étape recommandée

Après test réel ou revue écran par écran par l'équipe :

```text
RCN Trace — Étape 7 : corrections post-recette terrain
```

Cette étape devra être basée sur des incidents concrets :

```text
écran bloquant
champ manquant
libellé ambigu
workflow trop long
preuve manquante
écart non compris
rôle mal défini
```

---

## 14. Conclusion

L'étape 6 ajoute une aide opérationnelle directement dans RCN Trace.

Elle ne change pas la base de données, ne modifie pas le moteur principal et ne touche pas Farmer Buying.

Elle prépare l'application pour une recette terrain plus propre, plus guidée et plus facilement auditable.
