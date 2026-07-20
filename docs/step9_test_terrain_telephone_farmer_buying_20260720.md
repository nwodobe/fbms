# Étape 9 — Test terrain réel sur téléphone Farmer Buying

Date : 20/07/2026  
Périmètre : Farmer Buying uniquement  
Statut : protocole terrain prêt à exécuter  
RCN Trace : non démarré, volontairement maintenu en dernière position

---

## 1. Objectif de l'étape 9

L'objectif de cette étape est de passer du contrôle technique serveur à un test terrain sur téléphone.

Les étapes 6, 7 et 8 ont permis de sécuriser :

- les avances RT ;
- les achats terrain ;
- les mouvements de sacs ;
- les doublons de reçus ;
- la lisibilité des messages d'erreur serveur ;
- la conservation des opérations en attente ou en échec.

L'étape 9 doit maintenant vérifier que ces contrôles sont compréhensibles et exploitables sur téléphone par :

- un RT ;
- un Chef terrain ;
- le Branch Manager ;
- éventuellement un utilisateur Direction en consultation.

---

## 2. Limite importante

Ce document ne prétend pas que le test physique sur téléphone a été exécuté dans l'environnement de l'assistant.

Le test réel doit être fait sur un téléphone Android ou iPhone connecté à l'application publiée :

```text
https://nwodobe.github.io/fbms/
```

L'objectif de ce document est de donner un protocole prêt à exécuter, avec les résultats attendus, les preuves à capturer et les décisions GO / NO-GO.

---

## 3. Préparation avant test

### 3.1 Téléphones à utiliser

Tester au minimum avec :

| Téléphone | Utilisateur | Rôle | Objectif |
|---|---|---|---|
| Téléphone 1 | Branch Manager | BM | Vérifier accès complet et Command Center |
| Téléphone 2 | Chef terrain | Chef | Tester Cash, Sacs, Achats si autorisé |
| Téléphone 3 | RT / Agent | Agent | Tester Achats et Sacs terrain |

Si un seul téléphone est disponible, tester avec plusieurs comptes successivement.

### 3.2 Réseau

Tester dans 3 conditions :

1. bonne connexion ;
2. connexion faible ;
3. mode hors-ligne puis retour réseau.

### 3.3 Nettoyage côté téléphone

Avant test :

1. ouvrir le navigateur mobile ;
2. vider le cache du site ou faire un hard refresh ;
3. rouvrir le portail ;
4. vérifier que la connexion fonctionne ;
5. vérifier que les modules Farmer Buying sont accessibles selon le rôle.

### 3.4 Données de test

Utiliser uniquement des données marquées TEST.

Convention recommandée :

```text
RT_TEST_STEP9
RECU-STEP9-001
RECU-STEP9-DOUBLON
SAC-STEP9
```

Ne pas mélanger avec les données réelles de campagne.

---

## 4. Scénario 1 — Connexion et cache-busting

### Objectif

Vérifier que le téléphone charge bien les scripts Step 8 et non une ancienne version.

### Étapes

1. Ouvrir le portail.
2. Se connecter.
3. Ouvrir Achats Terrain.
4. Ouvrir Sacs Terrain.
5. Ouvrir Cash Terrain avec un profil autorisé.

### Résultat attendu

- La page s'ouvre sans erreur blanche.
- Le module demande la connexion si l'utilisateur n'est pas connecté.
- Les anciens messages techniques ne doivent plus apparaître en brut dans l'interface.
- Les messages doivent être lisibles pour un utilisateur terrain.

### Preuves à capturer

- Capture écran du portail connecté.
- Capture écran Achats Terrain.
- Capture écran Sacs Terrain.
- Capture écran Cash Terrain.

### Décision

| Résultat | Décision |
|---|---|
| Les modules s'ouvrent normalement | GO |
| Page blanche ou module bloqué | NO-GO technique |
| Ancien comportement en cache | vider cache puis retester |

---

## 5. Scénario 2 — Achat supérieur à l'avance RT disponible

### Objectif

Vérifier qu'un achat qui dépasse l'avance RT disponible est bloqué et expliqué clairement.

### Précondition

Créer ou choisir un RT avec :

- aucune avance ; ou
- avance faible ; ou
- solde déjà consommé.

### Étapes

1. Ouvrir Achats Terrain.
2. Sélectionner le RT de test.
3. Saisir un achat volontairement supérieur à son solde disponible.
4. Enregistrer.
5. Synchroniser si l'opération a été créée localement.

### Résultat attendu

Le message doit ressembler à :

```text
Avance RT insuffisante. Solde disponible : X FCFA.
Réconciliez ou ajoutez une avance avant achat.
```

ou, si le blocage vient du serveur :

```text
Synchronisation bloquée : avance RT insuffisante.
Vérifiez le solde du RT, ajoutez une avance ou faites la réconciliation avant de synchroniser cet achat.
```

### Preuves à capturer

- Capture écran du formulaire avant validation.
- Capture écran du message d'erreur.
- Capture écran de la file locale si opération en failed.

### Critère GO

Le RT comprend clairement qu'il ne peut pas acheter sans avance suffisante.

### Critère NO-GO

- L'application affiche une erreur technique brute.
- L'application supprime l'opération sans explication.
- L'achat se synchronise malgré l'avance insuffisante.

---

## 6. Scénario 3 — Correction après avance insuffisante

### Objectif

Vérifier que l'utilisateur peut corriger la situation et resynchroniser.

### Étapes

1. Aller dans Cash Terrain.
2. Créer une avance TEST suffisante pour le RT.
3. Synchroniser Cash.
4. Revenir dans Achats Terrain.
5. Corriger ou ressaisir l'achat TEST.
6. Synchroniser.

### Résultat attendu

- L'avance se synchronise.
- L'achat devient synchronisable après correction.
- L'opération ne disparaît pas de manière silencieuse.

### Preuves à capturer

- Capture de l'avance créée.
- Capture de la synchronisation Cash.
- Capture de l'achat synchronisé.

---

## 7. Scénario 4 — Doublon global de numéro de reçu

### Objectif

Vérifier qu'un reçu déjà utilisé est bloqué, même si le doublon vient d'un autre téléphone.

### Étapes

1. Sur Téléphone 1, créer un achat TEST avec :

```text
RECU-STEP9-DOUBLON
```

2. Synchroniser.
3. Sur Téléphone 2, créer un autre achat TEST avec le même numéro de reçu.
4. Synchroniser.

### Résultat attendu

Le second téléphone doit afficher :

```text
Synchronisation bloquée : ce numéro de reçu existe déjà.
Vérifiez le reçu papier/photo et corrigez le numéro avant de resynchroniser.
```

### Preuves à capturer

- Capture du reçu sur Téléphone 1.
- Capture de l'erreur sur Téléphone 2.
- Capture montrant l'opération en failed ou en attente de correction.

### Critère GO

Le doublon est bloqué et l'utilisateur comprend qu'il doit corriger le numéro de reçu.

### Critère NO-GO

- Le doublon passe.
- L'erreur affichée est incompréhensible.
- Le téléphone supprime l'opération sans preuve.

---

## 8. Scénario 5 — Mouvement sacs supérieur au stock disponible

### Objectif

Vérifier qu'une sortie sacs supérieure au stock réel est bloquée.

### Étapes

1. Ouvrir Sacs Terrain.
2. Choisir un cluster ou RT avec stock sacs nul ou faible.
3. Tenter une sortie sacs supérieure au stock disponible.
4. Enregistrer ou synchroniser selon le cas.

### Résultat attendu

Le message doit être clair :

```text
Stock sacs insuffisant.
```

ou :

```text
Synchronisation bloquée : stock de sacs insuffisant.
Enregistrez d'abord la réception ou la dotation qui alimente ce stock, puis resynchronisez.
```

### Preuves à capturer

- Capture du mouvement sacs tenté.
- Capture du message.
- Capture de la file locale si mouvement failed.

### Critère GO

L'utilisateur comprend qu'il doit d'abord enregistrer une réception ou dotation sacs.

---

## 9. Scénario 6 — Correction stock sacs puis resynchronisation

### Objectif

Vérifier que l'utilisateur peut corriger le stock sacs et relancer la synchronisation.

### Étapes

1. Créer une réception sacs TEST au niveau cluster.
2. Synchroniser.
3. Créer une dotation RT dans la limite du stock disponible.
4. Synchroniser.
5. Créer une sortie vers producteur dans la limite du stock RT.
6. Synchroniser.

### Résultat attendu

Les mouvements doivent être synchronisés dans l'ordre chronologique :

```text
réception cluster → dotation RT → sortie producteur
```

### Critère GO

Aucun faux blocage ne se produit si les mouvements sont logiquement corrects.

### Critère NO-GO

Le serveur bloque une sortie pourtant alimentée par une réception précédente dans la même file.

---

## 10. Scénario 7 — Hors-ligne puis retour réseau

### Objectif

Vérifier que les opérations restent sur le téléphone tant que la connexion est absente.

### Étapes

1. Activer le mode avion.
2. Créer une opération achat TEST.
3. Créer une opération sacs TEST.
4. Vérifier que les opérations sont visibles localement.
5. Désactiver le mode avion.
6. Synchroniser.

### Résultat attendu

- Aucune opération pending ne doit disparaître.
- Les opérations doivent passer en synced si elles sont correctes.
- Les opérations incorrectes doivent passer en failed avec un message lisible.

### Critère GO

Le téléphone devient une file d'attente fiable en cas de réseau instable.

---

## 11. Scénario 8 — Command Center Branch Manager

### Objectif

Vérifier que le Branch Manager voit les alertes importantes.

### Étapes

1. Se connecter avec le compte BM.
2. Ouvrir Command Center.
3. Vérifier les indicateurs :
   - achats ;
   - cash ;
   - sacs ;
   - risques ;
   - pending / failed.

### Résultat attendu

Le BM doit pouvoir voir rapidement :

- les opérations bloquées ;
- les opérations non synchronisées ;
- les risques de cash ;
- les risques sacs.

### Limite

Si le Command Center ne récupère pas certains champs à cause d'une différence de schéma, cela doit être documenté comme correction future.

---

## 12. Grille de recette terrain

| Test | Résultat attendu | Statut terrain | Capture disponible | Décision |
|---|---|---|---|---|
| Connexion mobile | OK | À remplir | Oui / Non | GO / NO-GO |
| Achats Terrain | OK | À remplir | Oui / Non | GO / NO-GO |
| Cash Terrain | OK | À remplir | Oui / Non | GO / NO-GO |
| Sacs Terrain | OK | À remplir | Oui / Non | GO / NO-GO |
| Achat > avance | Bloqué lisible | À remplir | Oui / Non | GO / NO-GO |
| Correction avance | Resync OK | À remplir | Oui / Non | GO / NO-GO |
| Doublon reçu | Bloqué lisible | À remplir | Oui / Non | GO / NO-GO |
| Sortie sacs > stock | Bloqué lisible | À remplir | Oui / Non | GO / NO-GO |
| Correction sacs | Resync OK | À remplir | Oui / Non | GO / NO-GO |
| Hors-ligne | Pending conservé | À remplir | Oui / Non | GO / NO-GO |
| Retour réseau | Sync ou failed lisible | À remplir | Oui / Non | GO / NO-GO |
| Command Center | Alertes visibles | À remplir | Oui / Non | GO / NO-GO |

---

## 13. Critères GO globaux

L'application peut passer à l'étape suivante si :

1. aucun écran blanc n'apparaît sur mobile ;
2. les opérations pending restent visibles ;
3. les blocages serveur sont compréhensibles ;
4. les erreurs ne suppriment aucune donnée ;
5. les corrections permettent de resynchroniser ;
6. les doublons reçus sont bloqués ;
7. les stocks sacs négatifs sont bloqués ;
8. le BM peut voir les risques majeurs ;
9. les utilisateurs terrain comprennent quoi faire après blocage.

---

## 14. Critères NO-GO globaux

Décision NO-GO si :

1. page blanche sur mobile ;
2. impossibilité de se connecter ;
3. perte d'une opération pending ;
4. doublon reçu synchronisé ;
5. achat au-delà de l'avance synchronisé ;
6. sortie sacs négative synchronisée ;
7. erreur affichée uniquement en langage technique ;
8. correction impossible après failed ;
9. Command Center inutilisable pour le BM.

---

## 15. Preuves obligatoires à conserver

Pour chaque test, conserver :

- capture écran avant action ;
- capture écran après action ;
- message affiché ;
- nom du téléphone ;
- nom du testeur ;
- date et heure ;
- module testé ;
- résultat GO / NO-GO ;
- observation terrain.

---

## 16. Rôles recommandés pour l'exécution

| Rôle | Personne recommandée | Responsabilité |
|---|---|---|
| Branch Manager | Monsieur KOUASSI | Décision GO / NO-GO |
| Assistant / Chef terrain | Jackson | Exécution terrain et captures |
| Finance / Cash | Aadil ou utilisateur Cash | Test avances et réconciliations |
| RT test | RT désigné | Test usage réel téléphone |

---

## 17. Décision recommandée après exécution

Si tous les scénarios critiques sont GO :

```text
GO pour étape 10 : mini-pilote contrôlé avec vrais utilisateurs mais périmètre limité.
```

Si un scénario critique est NO-GO :

```text
Correction ciblée avant mini-pilote.
```

---

## 18. Limites restantes après étape 9

Même après test téléphone, les sujets suivants resteront à traiter :

- upload réel des preuves vers Supabase Storage ;
- workflow BM d'exception ;
- clôture journalière cash / sacs ;
- export PDF / Excel opérationnel ;
- notification des blocages critiques ;
- liaison stricte achat ↔ sacs ;
- RCN Trace, uniquement après finalisation Farmer Buying.

---

## 19. Conclusion

L'étape 9 ne modifie pas l'application. Elle transforme la sécurisation technique en protocole d'acceptation terrain.

La priorité est de prouver que le téléphone peut fonctionner comme outil fiable en zone rurale :

- même hors réseau ;
- même avec erreur serveur ;
- même après correction ;
- sans perte de donnée ;
- avec un message clair pour l'utilisateur terrain.
