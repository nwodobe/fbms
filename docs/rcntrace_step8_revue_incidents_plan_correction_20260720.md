# RCN Trace — Étape 8
## Revue des incidents terrain validés & plan de correction

Date : 2026-07-20  
Module : RCN Trace  
Statut : correction ciblée pré-correction post-recette  
Périmètre : interface uniquement, stockage local navigateur

---

## 1. Objectif

L'étape 8 vise à préparer les corrections métier sur la base d'incidents réellement observés.

Comme aucune liste d'incidents terrain validés n'a encore été fournie, cette étape ne modifie pas le moteur métier et ne prétend pas corriger des incidents non observés.

Elle ajoute un outil permettant de :

- relire les incidents saisis pendant la recette terrain ;
- décider si chaque incident est réel ou non ;
- fixer une priorité ;
- ajouter une décision métier ;
- ajouter une action corrective proposée ;
- copier un plan de correction prêt à discuter avec l'équipe.

---

## 2. Rappel de la logique des étapes précédentes

### Étape 5

Formalisation du protocole complet :

```text
Réception camion
→ Sampling
→ GM
→ Déchargement
→ Lot officiel
→ BIN
→ Transfert Bouaké vers Yakro
→ Réception Yakro
→ Transfert Yakro vers Calibrage
→ Réception calibrage
→ CAL
→ Sorties
→ QC
→ Bilan matière
```

### Étape 6

Ajout d'un guide de workflow dans l'interface pour rendre le parcours visible.

### Étape 7

Ajout d'un registre local d'incidents terrain.

### Étape 8

Ajout d'un module de revue des incidents collectés.

---

## 3. Correction appliquée

### Nouveau fichier ajouté

```text
rcntrace/incident-review-board.js
```

Ce fichier ajoute un bouton flottant :

```text
Revue incidents
```

Le bouton ouvre un panneau permettant de relire les incidents locaux saisis via Step 7.

---

## 4. Fonctionnalités du module

Le panneau de revue permet de renseigner :

```text
- statut de décision ;
- priorité correction ;
- décision métier ;
- action corrective proposée.
```

### Statuts proposés

```text
À analyser
Validé métier
Rejeté
Correction préparée
Corrigé à vérifier
```

### Priorités proposées

```text
P0 Bloquant
P1 Majeur
P2 Mineur
P3 Question métier
```

---

## 5. Stockage

Le module utilise le stockage local du navigateur.

```text
Incidents Step 7 : rcntrace:field_incidents:v1
Revues Step 8   : rcntrace:incident_reviews:v1
```

Aucune donnée n'est envoyée à Supabase.

---

## 6. Règle de gouvernance

Une correction métier ne doit être engagée que si l'incident est :

```text
1. observé réellement pendant la recette ;
2. décrit clairement ;
3. rattaché à un écran ;
4. rattaché à une étape du flux ;
5. validé métier ;
6. priorisé ;
7. associé à une action corrective.
```

Cette règle évite de modifier le système sur la base d'une impression non vérifiée.

---

## 7. Exemple de décision attendue

Incident :

```text
L'utilisateur peut essayer d'ouvrir une opération CAL alors que la réception calibrage n'est pas validée.
```

Décision métier :

```text
Incident confirmé. Une opération CAL ne doit être possible qu'après réception calibrage validée.
```

Action corrective :

```text
Afficher un message bloquant clair et désactiver le bouton d'ouverture CAL tant que la réception n'est pas validée.
```

---

## 8. Périmètre technique

### Fichiers concernés

```text
rcntrace/incident-review-board.js
rcntrace/flow-clarity.js
```

### Fichier de documentation

```text
docs/rcntrace_step8_revue_incidents_plan_correction_20260720.md
```

---

## 9. Audit de sécurité

Cette étape respecte les limites suivantes :

```text
- aucune migration Supabase ;
- aucune modification de table ;
- aucune modification de données ;
- aucun reset ;
- aucune suppression ;
- rcntrace.js non modifié ;
- rcntrace-ui.js non modifié ;
- Farmer Buying non modifié.
```

---

## 10. Limites

Le module ne remplace pas une vraie recette terrain.

Il ne crée pas automatiquement une issue GitHub.

Il ne corrige pas automatiquement le code.

Il ne synchronise pas les incidents vers Supabase.

Il prépare seulement une base de décision.

---

## 11. Méthode recommandée pour utiliser Step 8

1. L'équipe terrain exécute le protocole Step 5.
2. Les incidents sont saisis dans Step 7.
3. Le Branch Manager ou le référent métier ouvre Step 8.
4. Chaque incident est revu.
5. Les incidents non confirmés sont rejetés.
6. Les incidents confirmés sont priorisés.
7. Le plan de correction est copié.
8. Les corrections de code sont faites uniquement sur les incidents validés.

---

## 12. Prochaine étape recommandée

Après utilisation réelle de ce registre et revue des incidents :

```text
RCN Trace — Étape 9 : corrections code sur incidents validés P0/P1
```

Mais cette étape doit attendre une vraie liste d'incidents validés.
