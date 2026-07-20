# Étape 8 — Lisibilité des erreurs serveur Farmer Buying

Date : 20/07/2026  
Projet : ANAGROCI Operations Suite  
Périmètre : Farmer Buying  
Statut : correction interface / synchronisation

---

## 1. Objectif

L'étape 7 a confirmé que les contrôles serveur fonctionnent :

- achat supérieur à l'avance RT disponible : bloqué ;
- sortie sacs supérieure au stock disponible : bloquée ;
- doublon global de numéro de reçu : bloqué.

L'étape 8 vise à rendre ces blocages compréhensibles pour les utilisateurs terrain.

Le problème n'était donc plus la sécurité métier, mais la lisibilité opérationnelle :

> Un RT ou un chef terrain ne doit pas voir une erreur technique PostgreSQL.  
> Il doit comprendre ce qu'il doit corriger.

---

## 2. Principe retenu

Les erreurs serveur sont traduites en messages métier.

### Avant

Exemple d'erreur technique :

```text
duplicate key value violates unique constraint "achats_numero_recu_unique_idx"
```

### Après

Message utilisateur :

```text
Synchronisation bloquée : ce numéro de reçu existe déjà. Vérifiez le reçu papier/photo et corrigez le numéro avant de resynchroniser.
```

---

## 3. Fichiers modifiés

### 3.1 `shared/anagroci-audit.js`

Le fichier a été renforcé pour :

- centraliser la traduction des erreurs serveur ;
- afficher un message lisible dans le module Achats ;
- conserver les opérations en échec dans la file locale ;
- marquer les opérations en `failed` avec `last_error` ;
- éviter qu'une erreur serveur soit invisible pour l'utilisateur ;
- continuer à journaliser les blocages métier.

Fonction ajoutée / renforcée :

```javascript
friendlyServerError(raw)
```

Elle traduit notamment :

| Erreur serveur | Message métier |
|---|---|
| `Avance RT insuffisante` | Avance RT insuffisante, vérifier solde / ajouter avance / réconcilier |
| `Stock sacs insuffisant` | Stock sacs insuffisant, enregistrer réception ou dotation d'abord |
| `achats_numero_recu_unique_idx` | Numéro de reçu déjà utilisé |
| `row-level security` | Droits d'accès insuffisants |
| erreur réseau | Connexion instable, garder la donnée en attente |

---

### 3.2 `shared/anagroci-sacs-guards.js`

Le fichier a été renforcé pour :

- synchroniser les mouvements sacs dans l'ordre chronologique ;
- capturer les erreurs Supabase au lieu de les laisser silencieuses ;
- afficher les erreurs de stock sacs de façon compréhensible ;
- conserver les mouvements bloqués en file locale ;
- journaliser les blocages serveur sacs via `bag_sync_server_blocked`.

Point important :

```text
Les mouvements sacs sont envoyés du plus ancien au plus récent.
```

Cela évite qu'une sortie sacs soit envoyée avant l'entrée qui alimente le stock.

---

### 3.3 `shared/auth-gate.js`

Le fichier a été mis à jour pour forcer le rechargement des nouveaux scripts :

```javascript
anagroci-audit.js?v=step8-friendly-errors
anagroci-sacs-guards.js?v=step8-friendly-errors
```

Sans ce cache-busting, certains téléphones pouvaient continuer à utiliser l'ancienne version du guard.

---

## 4. Messages utilisateur définis

### 4.1 Avance RT insuffisante

Message :

```text
Synchronisation bloquée : avance RT insuffisante. Vérifiez le solde du RT, ajoutez une avance ou faites la réconciliation avant de synchroniser cet achat.
```

Sens métier :

- le RT n'a pas assez d'avance disponible ;
- l'achat ne doit pas être payé au-delà du cash alloué ;
- le chef terrain doit ajouter une avance ou réconcilier.

---

### 4.2 Stock sacs insuffisant

Message :

```text
Synchronisation bloquée : stock de sacs insuffisant. Enregistrez d'abord la réception ou la dotation qui alimente ce stock, puis resynchronisez.
```

Sens métier :

- l'utilisateur essaie de sortir plus de sacs que le stock disponible ;
- il manque probablement une réception cluster, une dotation RT ou un retour ;
- il faut corriger la chronologie des mouvements.

---

### 4.3 Reçu déjà utilisé

Message :

```text
Synchronisation bloquée : ce numéro de reçu existe déjà. Vérifiez le reçu papier/photo et corrigez le numéro avant de resynchroniser.
```

Sens métier :

- le même numéro de reçu ne peut pas être utilisé deux fois ;
- le contrôle est global serveur, pas seulement local téléphone ;
- le RT ou le chef terrain doit corriger le numéro.

---

### 4.4 Droits insuffisants

Message :

```text
Synchronisation refusée par les droits d'accès. Déconnectez-vous/reconnectez-vous ou contactez le Branch Manager.
```

Sens métier :

- le profil connecté n'a pas les droits attendus ;
- il peut s'agir d'un problème de session ;
- le Branch Manager doit vérifier le profil.

---

### 4.5 Connexion instable

Message :

```text
Synchronisation impossible : réseau instable. Gardez les données sur le téléphone et réessayez quand la connexion revient.
```

Sens métier :

- l'opération n'est pas perdue ;
- elle reste en attente ;
- il faut resynchroniser plus tard.

---

## 5. Ce qui change pour le terrain

### Avant

Un utilisateur pouvait voir :

```text
duplicate key value violates unique constraint
```

ou ne rien voir du tout sur un mouvement sacs bloqué.

### Après

L'utilisateur voit une phrase claire :

```text
Ce numéro de reçu existe déjà.
```

ou :

```text
Stock de sacs insuffisant.
```

avec l'action à faire.

---

## 6. Sécurité des files locales

L'étape 8 conserve la logique prudente :

- aucune opération en attente n'est supprimée ;
- une opération rejetée serveur reste visible en `failed` ;
- l'erreur lisible est stockée dans `last_error` ;
- l'utilisateur peut corriger puis resynchroniser ;
- les données locales restent protégées en cas de réseau instable.

---

## 7. Ce qui n'a pas été modifié

Cette étape ne modifie pas :

- les tables Supabase ;
- les triggers serveur ;
- les règles RLS ;
- RCN Trace ;
- les modules FBMS, ALIS, Hubs, Carte ;
- les données de production.

---

## 8. Incident pendant l'étape

Un fichier temporaire `docs/step8_placeholder.tmp` a été créé par erreur directement sur `main`.

Correction immédiate :

- fichier supprimé ;
- aucune donnée métier impactée ;
- aucun code applicatif impacté ;
- la branche Step 8 a ensuite été créée proprement depuis `main` corrigé.

---

## 9. Limites restantes

L'étape 8 améliore la lisibilité, mais ne remplace pas le test terrain réel.

À vérifier encore sur téléphone :

1. message visible après échec de synchronisation achat ;
2. message visible après échec de synchronisation sacs ;
3. maintien de l'opération en file locale ;
4. correction puis resynchronisation ;
5. comportement avec réseau instable.

---

## 10. Décision recommandée

GO pour l'étape 9 :

```text
Test terrain réel sur téléphone avec scénario de correction après blocage serveur.
```

Cette étape doit être exécutée par un utilisateur terrain ou simulée sur téléphone connecté à l'application.

---

## 11. Statut final

Étape 8 terminée côté code.

Résultat attendu :

```text
Le serveur continue de bloquer les opérations dangereuses.
L'utilisateur comprend maintenant pourquoi l'opération est bloquée.
La donnée reste en file locale jusqu'à correction.
```
