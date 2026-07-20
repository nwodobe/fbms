# Étape 7 — Tests de blocage serveur Farmer Buying

Date : 20 juillet 2026  
Projet : ANAGROCI Operations Suite / Farmer Buying 2027  
Statut : tests techniques serveur exécutés  
RCN Trace : maintenu en dernière position

---

## 1. Objectif

L'étape 7 vérifie que les contrôles serveur ajoutés en étape 6 fonctionnent réellement côté Supabase.

L'objectif n'est pas de faire un test terrain complet sur téléphone. L'objectif est de vérifier, au niveau base de données, que les règles critiques ne dépendent plus seulement du navigateur ou du cache local.

Les trois contrôles ciblés sont :

1. bloquer un achat Farmer Buying supérieur à l'avance RT disponible ;
2. bloquer une sortie de sacs supérieure au stock disponible ;
3. bloquer un doublon global de numéro de reçu.

---

## 2. Contexte avant test

Les sécurités concernées ont été ajoutées à l'étape 6 par la migration :

```text
step6_farmer_buying_server_controls_v2
```

Cette migration a ajouté / sécurisé :

- `avances` ;
- `reconciliations` ;
- `sacs_mouvements` ;
- `farmer_buying_documents` ;
- l'unicité globale de `achats.numero_recu` ;
- le trigger anti-dépassement d'avance RT ;
- le trigger anti-stock sacs négatif.

---

## 3. Méthode de test

Les tests ont été exécutés directement côté Supabase avec des données techniques marquées `STEP7`.

Principe :

- ne pas utiliser de données opérationnelles réelles ;
- ne pas modifier RCN Trace ;
- ne pas modifier les modules applicatifs ;
- nettoyer les données de test lorsque des données temporaires sont nécessaires ;
- capturer les erreurs attendues au lieu de les laisser interrompre tout le test.

---

## 4. Vérification structurelle des protections

La vérification des objets techniques a confirmé la présence de :

```text
achats_numero_recu_unique_idx
trg_fb_prevent_achat_over_advance
trg_fb_prevent_negative_bag_stock
```

Interprétation :

- l'unicité globale des reçus est portée par un index unique fonctionnel ;
- le blocage d'achat au-dessus de l'avance est porté par un trigger sur `achats` ;
- le blocage de stock sacs négatif est porté par un trigger sur `sacs_mouvements`.

---

## 5. Test 1 — Achat supérieur à l'avance RT disponible

### Scénario

Un achat est tenté pour un RT technique sans avance disponible.

### Résultat attendu

L'achat doit être refusé par le serveur.

### Résultat observé

```text
Test : achat_over_advance
Résultat attendu : blocked
Résultat observé : blocked
Passé : true
Message : Avance RT insuffisante. Disponible: 0, achat: 50000
```

### Conclusion

Le serveur bloque bien un achat lorsque l'avance RT disponible est insuffisante.

Cela signifie que même si un navigateur ou un téléphone contourne le contrôle frontend, Supabase refuse l'opération.

---

## 6. Test 2 — Sortie sacs supérieure au stock disponible

### Scénario

Une dotation RT de 10 sacs est tentée depuis un cluster technique sans stock de sacs disponible.

### Résultat attendu

La sortie de sacs doit être refusée par le serveur.

### Résultat observé

```text
Test : negative_bag_stock
Résultat attendu : blocked
Résultat observé : blocked
Passé : true
Message : Stock sacs insuffisant. Disponible: 0, sortie: 10
```

### Conclusion

Le serveur bloque bien une sortie de sacs lorsque le stock disponible est insuffisant.

Cette protection est critique pour éviter que les soldes deviennent négatifs après synchronisation.

---

## 7. Test 3 — Doublon global de numéro de reçu

### Scénario

Deux achats techniques sont tentés avec le même numéro de reçu.

Pour éviter le blocage par avance insuffisante, une avance technique temporaire a été créée pour le RT de test, puis supprimée après le test.

### Résultat attendu

Le deuxième achat avec le même numéro de reçu doit être refusé.

### Résultat observé

```text
Test : duplicate_receipt
Résultat attendu : blocked
Résultat observé : blocked
Passé : true
Message : duplicate key value violates unique constraint "achats_numero_recu_unique_idx"
```

### Conclusion

Le serveur bloque bien les doublons globaux de numéro de reçu.

Cette protection réduit fortement le risque de double paiement ou de double saisie entre deux téléphones différents.

---

## 8. Incidents pendant l'étape 7

Deux incidents techniques ont été rencontrés et corrigés sans impact fonctionnel :

### 8.1 Requête SQL incomplète

Une première tentative de requête de test a été interrompue à cause d'une chaîne SQL incomplète.

Impact :

```text
Aucun résultat métier exploitable.
```

Action :

```text
Requête relancée proprement avec capture des erreurs attendues.
```

### 8.2 Syntaxe PL/pgSQL incorrecte

Une première version du test doublon utilisait le mot `ensure`, qui n'existe pas en PL/pgSQL.

Impact :

```text
Aucune conclusion métier tirée de cette tentative.
```

Action :

```text
Bloc réécrit avec syntaxe PostgreSQL compatible et nettoyage explicite des données STEP7.
```

---

## 9. Ce que l'étape 7 valide réellement

L'étape 7 valide que les règles critiques sont maintenant présentes côté serveur.

Validé :

- achat bloqué si avance RT insuffisante ;
- sortie sacs bloquée si stock insuffisant ;
- doublon global de reçu bloqué ;
- protections indépendantes du navigateur ;
- protections indépendantes du cache local ;
- pas de modification RCN Trace.

---

## 10. Ce que l'étape 7 ne valide pas encore

L'étape 7 ne remplace pas un test terrain complet.

Non encore validé :

- affichage exact des erreurs serveur dans l'interface téléphone ;
- comportement avec plusieurs téléphones synchronisant en même temps ;
- récupération utilisateur après blocage serveur ;
- lisibilité du message pour un RT ou un chef terrain ;
- upload réel des preuves vers Supabase Storage ;
- workflow d'exception BM.

---

## 11. Recommandation avant pilote réel

Avant pilote réel, il faut exécuter un test téléphone ciblé :

1. ouvrir le module Cash ;
2. créer une avance RT test ;
3. ouvrir le module Achats ;
4. faire un achat inférieur à l'avance ;
5. faire un achat supérieur à l'avance ;
6. vérifier que le message est compréhensible ;
7. ouvrir le module Sacs ;
8. créer une réception cluster ;
9. faire une dotation RT inférieure au stock ;
10. faire une dotation RT supérieure au stock ;
11. vérifier que le message est compréhensible ;
12. répéter avec deux téléphones différents.

---

## 12. Risques restants

### 12.1 Message serveur trop technique

Le message `duplicate key value violates unique constraint` est techniquement correct, mais pas assez lisible pour un utilisateur terrain.

Recommandation :

```text
Traduire côté interface les erreurs serveur en messages métier simples.
```

Exemple :

```text
Ce numéro de reçu existe déjà. Vérifiez le reçu ou contactez le Branch Manager.
```

### 12.2 Cache navigateur

Le guard sacs a été corrigé en étape 6, mais un navigateur peut encore conserver une ancienne version.

Recommandation :

```text
Faire un hard refresh sur téléphone avant test.
```

### 12.3 Preuves documentaires

La table `farmer_buying_documents` existe, mais l'upload réel vers Supabase Storage n'est pas encore branché.

Recommandation :

```text
Traiter l'upload des preuves dans une étape dédiée.
```

---

## 13. Décision étape 7

Décision recommandée :

```text
GO pour passer aux tests téléphone ciblés.
```

Condition :

```text
Tester la lisibilité des erreurs dans l'application avant pilote réel.
```

---

## 14. Prochaine étape proposée

Étape 8 — Lisibilité des erreurs serveur et messages utilisateur.

Objectif :

```text
Transformer les erreurs techniques Supabase en messages compréhensibles pour RT, chef terrain et Branch Manager.
```

Exemples :

- avance insuffisante ;
- stock sacs insuffisant ;
- reçu déjà utilisé ;
- doublon local_id ;
- erreur réseau ;
- synchronisation partielle.
