# Étape 3E — Audit final Farmer Buying

Date : 20/07/2026  
Périmètre : programme Farmer Buying — Achats Terrain, Cash / Avances RT, Sacs / Sacherie terrain, Command Center BM.  
Décision projet : RCN Trace reste en dernière position.

---

## 1. Objectif de l'étape

L'objectif de l'étape 3E est de vérifier la cohérence du dispositif Farmer Buying après les étapes :

- 3A — sécurisation Achats Terrain ;
- 3B — sécurisation Cash / Avances RT ;
- 3C — sécurisation Sacs / Sacherie terrain ;
- 3D — renforcement du Command Center BM.

Cette étape sert aussi à corriger le dernier point technique transversal qui pouvait empêcher les gardes métier les plus récents de se charger correctement dans les navigateurs : le cache de `anagroci-audit.js`.

---

## 2. Correction technique effectuée

### 2.1 Cache du script d'audit

Constat :

- `shared/auth-gate.js` chargeait encore `anagroci-audit.js` avec le suffixe `?v=step1b`.
- Or les étapes 3A et 3B ont ajouté des contrôles métier dans `shared/anagroci-audit.js`.
- Avec un navigateur ou GitHub Pages qui garde l'ancien script en cache, les gardes Achats et Cash pouvaient ne pas se charger immédiatement.

Correction appliquée :

```js
anagroci-audit.js?v=step3e-farmer-buying
```

Effet attendu :

- forcer le navigateur à recharger la version récente de `anagroci-audit.js` ;
- rendre actifs les gardes Achats 3A ;
- rendre actifs les gardes Cash 3B ;
- conserver le garde Sacs 3C déjà chargé via `anagroci-sacs-guards.js?v=step3c`.

Aucune donnée n'est modifiée par cette correction.

---

## 3. Audit de cohérence métier

### 3.1 Chaîne Achats → Cash

État après 3A et 3B :

- un achat terrain ne peut plus être enregistré avec une date future ;
- le paiement bancaire est bloqué pour Farmer Buying ;
- un reçu déjà utilisé localement est bloqué ;
- un RT hors référentiel est bloqué quand le référentiel est chargé ;
- un achat peut être bloqué si l'avance RT disponible localement est insuffisante ;
- une nouvelle avance RT est bloquée si le RT garde un solde ouvert non réconcilié ;
- les réconciliations Cash obligent à sélectionner un RT et à saisir des valeurs cohérentes.

Lecture opérationnelle :

> L'agent ne doit plus pouvoir acheter sans contrôle minimum de caisse. Le RT doit tourner sur avance justifiée et réconciliée.

Limite restante :

- le contrôle avance disponible repose encore sur le cache local et les données chargées dans le navigateur ;
- il n'existe pas encore de contrainte serveur qui bloque globalement un achat si la caisse RT est insuffisante ;
- le reçu n'est pas encore unique au niveau global Supabase.

---

### 3.2 Chaîne Achats → Sacs

État après 3C :

- les mouvements de sacs à date future sont bloqués ;
- les quantités nulles, négatives ou décimales sont bloquées ;
- une réception usine vers cluster nécessite un cluster ;
- un mouvement terrain nécessite un RT ;
- un mouvement producteur nécessite un producteur ;
- les sorties de sacs sont bloquées si le stock est insuffisant au niveau cluster, RT ou producteur ;
- la file locale `anagroci_sacs` est protégée avec des statuts et des métadonnées de synchronisation.

Lecture opérationnelle :

> Le système ne devrait plus accepter qu'un RT distribue plus de sacs qu'il n'en a reçu, ou qu'un producteur rende / perde plus de sacs qu'il n'en détient.

Limite restante :

- le lien strict entre un achat RCN et les sacs pleins enlevés n'est pas encore imposé ;
- le document scanné reste local, il n'est pas encore sauvegardé dans Supabase ou Storage ;
- il n'existe pas encore de workflow BM pour approuver les pertes exceptionnelles de sacs.

---

### 3.3 Chaîne Cash → Sacs

Cohérence attendue :

- un RT avec avance importante doit avoir soit des achats enregistrés, soit un solde cash à réconcilier ;
- un RT avec sacs en main doit être suivi dans le Command Center ;
- un RT avec solde cash ouvert et sacs négatifs devient un risque prioritaire.

État après 3D :

- le Command Center BM affiche les RT à risque ;
- il croise avance, solde caisse, réconciliation et sacs RT ;
- il affiche les files locales en attente : achats, avances, réconciliations et sacs.

Lecture opérationnelle :

> Le Branch Manager peut désormais piloter les risques terrain au quotidien, au lieu de découvrir les écarts en fin de campagne.

Limite restante :

- le Command Center reste une vue de lecture ;
- il ne permet pas encore de clôturer une journée ;
- il ne crée pas encore de commentaire BM, décision BM ou plan d'action assigné.

---

## 4. Audit technique

### 4.1 Données et Supabase

Aucune migration Supabase n'a été exécutée dans cette étape.

Aucune table n'a été modifiée directement.

Aucune donnée utilisateur n'a été supprimée.

### 4.2 Fichiers impactés

- `shared/auth-gate.js` : changement du suffixe de cache pour `anagroci-audit.js`.
- `docs/step3e_farmer_buying_final_audit_20260720.md` : présent rapport d'audit.

### 4.3 Fichiers non modifiés

- `terrain/achats.html` ;
- `terrain/cash.html` ;
- `terrain/sacs.html` ;
- `terrain/command.html` ;
- `rcntrace/index.html` ;
- tables Supabase.

---

## 5. Angles morts restants avant exploitation terrain complète

### 5.1 Niveau serveur

Les gardes actuels sont majoritairement frontend / cache local.

À renforcer plus tard :

- contrainte serveur sur unicité globale du reçu ;
- règles serveur sur dépassement d'avance RT ;
- contrôle serveur des stocks sacs négatifs ;
- journal d'audit serveur plus détaillé par action métier.

### 5.2 Preuves documentaires

À renforcer plus tard :

- stockage distant des reçus d'achat ;
- stockage distant des documents de mouvements sacs ;
- signature ou validation numérique RT / BM ;
- rapprochement documentaire en fin de journée.

### 5.3 Workflow BM

À renforcer plus tard :

- validation BM d'un prix hors barème ;
- approbation BM d'une nouvelle avance exceptionnelle ;
- approbation BM d'une perte de sacs ;
- clôture journalière BM ;
- export PDF / Excel du rapport quotidien.

### 5.4 Tests terrain

À réaliser impérativement sur téléphone :

1. créer une avance RT ;
2. enregistrer un achat inférieur à l'avance ;
3. tenter un achat supérieur au solde disponible ;
4. distribuer des sacs au RT ;
5. tenter de sortir plus de sacs que le stock RT disponible ;
6. vérifier le Command Center ;
7. passer hors ligne ;
8. créer une opération ;
9. revenir en ligne ;
10. contrôler la synchronisation.

---

## 6. Conclusion

Le socle Farmer Buying est maintenant cohérent sur les quatre blocs :

- Achats Terrain ;
- Cash / Avances RT ;
- Sacs / Sacherie terrain ;
- Command Center BM.

L'application n'est pas encore un ERP complet, mais elle dispose désormais d'une structure terrain beaucoup plus robuste : contrôles métier, files locales protégées, pilotage BM et visibilité des risques.

Prochaine phase recommandée :

- soit effectuer une session de tests terrain sur téléphone ;
- soit passer à RCN Trace comme prévu en dernière position.
