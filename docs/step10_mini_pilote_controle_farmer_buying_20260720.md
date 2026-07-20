# Étape 10 — Mini-pilote contrôlé Farmer Buying

Date : 20/07/2026  
Projet : ANAGROCI Operations Suite / Farmer Buying  
Statut : Plan opérationnel de mini-pilote  
Responsable décision : Branch Manager

---

## 1. Objectif de l'étape 10

L'étape 10 transforme les tests techniques et la recette téléphone en un mini-pilote réel, mais strictement limité.

Le but n'est pas encore de lancer toute la campagne Farmer Buying.

Le but est de vérifier, sur un périmètre réduit, que les vrais utilisateurs peuvent travailler avec l'application sans perte de données, sans dépassement d'avance RT, sans stock sacs négatif, sans doublon de reçu et avec un contrôle quotidien par le Branch Manager.

---

## 2. Principe directeur

Le mini-pilote doit être petit, contrôlé et réversible.

Règle de prudence :

```text
On ne teste pas la capacité maximale.
On teste la discipline opérationnelle.
```

Cela signifie :

- peu de RT ;
- peu de villages ;
- petites avances ;
- faible volume ;
- contrôle quotidien ;
- arrêt immédiat si anomalie critique ;
- aucune extension sans décision du Branch Manager.

---

## 3. Périmètre recommandé du mini-pilote

### 3.1 Durée

Durée recommandée :

```text
3 jours ouvrés maximum
```

Découpage :

| Jour | Objectif |
|---|---|
| J-1 | préparation, formation courte, vérification téléphones |
| J0 | lancement terrain limité |
| J1 | poursuite avec contrôle renforcé |
| J2 | clôture pilote et décision GO / NO-GO |

Si les résultats sont instables dès J0, le pilote doit être arrêté avant J1.

---

### 3.2 Utilisateurs

Périmètre recommandé :

| Rôle | Nombre | Commentaire |
|---|---:|---|
| Branch Manager | 1 | contrôle et décision |
| Chef terrain / superviseur | 1 | suivi opérationnel |
| RT pilote | 2 à 3 | pas plus au démarrage |
| Support app | 1 | collecte incidents et captures |

Interdiction pendant le mini-pilote :

```text
Ne pas ouvrir le pilote à tous les RT.
Ne pas utiliser le pilote comme lancement officiel.
```

---

### 3.3 Villages

Périmètre recommandé :

```text
2 à 4 villages maximum
```

Critères de choix :

- villages déjà validés dans FBMS ;
- RT bien identifié ;
- réseau téléphone au moins partiellement disponible ;
- accès terrain simple ;
- producteurs faciles à retrouver ;
- pas de village litigieux ;
- pas de village à forte pression concurrentielle pour ce test.

---

### 3.4 Volume plafond

Volume maximum recommandé :

```text
2 à 5 tonnes par RT sur toute la durée du mini-pilote
```

Volume total pilote recommandé :

```text
10 à 15 tonnes maximum
```

Le volume n'est pas le sujet principal. Le sujet est la fiabilité.

---

### 3.5 Avances RT

Avance recommandée par RT :

```text
500 000 à 1 000 000 FCFA maximum par RT
```

Règles :

- aucune avance massive ;
- aucune deuxième avance sans réconciliation ;
- aucune avance sans RT identifié ;
- toute avance doit être visible dans le module Cash ;
- tout dépassement doit bloquer l'achat.

---

## 4. Conditions obligatoires avant lancement

Le mini-pilote ne démarre que si les conditions ci-dessous sont validées.

| Contrôle | Statut attendu |
|---|---|
| Téléphones chargés | GO |
| Connexion testée | GO |
| Module Achats accessible | GO |
| Module Cash accessible | GO |
| Module Sacs accessible | GO |
| Command Center BM accessible | GO |
| Scripts Step 8 chargés | GO |
| RT pilote connus | GO |
| Villages pilote connus | GO |
| Avances plafonnées | GO |
| Sacs dotés et contrôlés | GO |
| Support incident disponible | GO |

Si un seul point critique est NO-GO, le mini-pilote ne démarre pas.

---

## 5. Briefing obligatoire avant terrain

Avant lancement, le Branch Manager ou le chef terrain doit expliquer clairement aux RT :

```text
1. Ce n'est pas encore le lancement général.
2. Le périmètre est limité.
3. Toute anomalie doit être signalée immédiatement.
4. Aucun achat ne doit être forcé hors application.
5. Aucun reçu ne doit être réutilisé.
6. Aucun mouvement sacs ne doit être fait sans saisie.
7. Une opération en failed ne doit pas être supprimée.
8. Le téléphone doit être gardé avec le RT jusqu'à synchronisation.
```

---

## 6. Scénarios opérationnels du mini-pilote

### Scénario 1 — Création d'avance RT

Objectif : vérifier que l'avance existe avant achat.

Procédure :

1. Ouvrir le module Cash.
2. Sélectionner un RT pilote.
3. Saisir une avance plafonnée.
4. Synchroniser.
5. Vérifier dans Command Center.

Résultat attendu :

```text
Avance visible.
Aucune erreur serveur.
RT identifiable.
Solde disponible cohérent.
```

Preuves :

- capture module Cash ;
- capture Command Center ;
- montant avance ;
- nom RT ;
- heure de synchronisation.

---

### Scénario 2 — Achat normal dans la limite de l'avance

Objectif : vérifier que l'achat normal passe.

Procédure :

1. Ouvrir le module Achats.
2. Choisir le village pilote.
3. Choisir le RT pilote.
4. Saisir producteur / poids / prix / reçu.
5. Ajouter photo du reçu si disponible.
6. Enregistrer.
7. Synchroniser.
8. Vérifier Command Center.

Résultat attendu :

```text
Achat enregistré.
Achat synchronisé.
Montant déduit du solde RT.
Aucune perte de donnée.
```

Preuves :

- reçu papier ;
- capture écran achat ;
- capture statut synced ;
- capture Command Center.

---

### Scénario 3 — Achat supérieur au solde RT

Objectif : vérifier le blocage métier.

Procédure :

1. Créer volontairement un achat supérieur au solde disponible du RT.
2. Tenter d'enregistrer ou synchroniser.

Résultat attendu :

```text
Blocage clair : avance RT insuffisante.
L'utilisateur comprend qu'il doit ajouter une avance ou réconcilier.
Aucune donnée ne disparaît.
```

Message attendu :

```text
Synchronisation bloquée : avance RT insuffisante.
```

Action corrective :

- ajouter une avance validée ; ou
- réduire / corriger l'achat ; ou
- faire une réconciliation si nécessaire ;
- resynchroniser.

---

### Scénario 4 — Doublon de reçu

Objectif : vérifier que deux téléphones ne peuvent pas utiliser le même numéro de reçu.

Procédure :

1. Téléphone A : créer achat avec reçu TEST-RECU-001.
2. Synchroniser téléphone A.
3. Téléphone B : tenter achat avec le même reçu TEST-RECU-001.
4. Synchroniser téléphone B.

Résultat attendu :

```text
Téléphone A : synchronisation OK.
Téléphone B : blocage clair doublon reçu.
```

Message attendu :

```text
Synchronisation bloquée : ce numéro de reçu existe déjà.
```

Action corrective :

- vérifier reçu papier ;
- corriger le numéro ;
- ne jamais supprimer l'opération sans contrôle BM ;
- resynchroniser après correction.

---

### Scénario 5 — Dotation sacs RT

Objectif : vérifier le stock sacs.

Procédure :

1. Ouvrir le module Sacs.
2. Créer une réception ou dotation source vers RT.
3. Synchroniser.
4. Vérifier solde sacs.

Résultat attendu :

```text
Dotation synchronisée.
Stock RT positif.
Mouvement visible dans l'historique.
```

---

### Scénario 6 — Sortie sacs supérieure au stock

Objectif : vérifier le blocage stock négatif.

Procédure :

1. Tenter une sortie supérieure au stock réel du RT ou producteur.
2. Enregistrer / synchroniser.

Résultat attendu :

```text
Blocage clair : stock sacs insuffisant.
Aucun stock négatif serveur.
Aucune opération perdue.
```

Message attendu :

```text
Synchronisation bloquée : stock de sacs insuffisant.
```

Action corrective :

- corriger la quantité ; ou
- saisir d'abord la dotation manquante ;
- resynchroniser.

---

### Scénario 7 — Mode hors-ligne puis retour réseau

Objectif : vérifier la résilience terrain.

Procédure :

1. Mettre le téléphone en mode avion.
2. Créer une avance ou un achat test autorisé.
3. Vérifier statut pending.
4. Réactiver réseau.
5. Synchroniser.

Résultat attendu :

```text
Donnée gardée sur téléphone.
Statut pending puis synced.
Aucune opération supprimée.
```

NO-GO immédiat si :

```text
La donnée disparaît.
Le statut n'est pas visible.
L'utilisateur ne sait pas si l'achat est synchronisé.
```

---

## 7. Contrôle quotidien Branch Manager

Pendant le mini-pilote, le Branch Manager contrôle chaque jour :

| Contrôle | Fréquence |
|---|---|
| Volumes par RT | matin / soir |
| Avances consommées | matin / soir |
| Solde RT | soir |
| Reçus doublons | soir |
| Mouvements sacs | soir |
| Opérations failed | toutes les 2 heures |
| Opérations pending | toutes les 2 heures |
| Incidents critiques | immédiat |

Le Command Center doit être utilisé comme tableau de pilotage.

---

## 8. Journal d'incidents obligatoire

Chaque incident doit être enregistré avec :

```text
Date / heure
Module concerné
Téléphone concerné
Utilisateur
RT
Village
Description
Capture écran
Action corrective
Statut final
Décision BM
```

Catégories :

| Niveau | Définition | Décision |
|---|---|---|
| Mineur | gêne sans risque donnée | correction après pilote |
| Moyen | blocage contournable avec contrôle BM | correction ciblée |
| Critique | risque perte donnée / argent / stock | arrêt pilote |

---

## 9. Critères GO

Le mini-pilote est GO si :

```text
1. Aucun achat ne dépasse l'avance disponible.
2. Aucun reçu doublon ne passe au serveur.
3. Aucun stock sacs négatif n'est créé.
4. Les opérations pending restent visibles.
5. Les opérations failed restent visibles.
6. Les messages d'erreur sont compréhensibles.
7. Les RT comprennent quoi corriger.
8. Le Command Center donne une vue claire au BM.
9. Les données synchronisées correspondent aux reçus terrain.
10. Aucun utilisateur ne perd une opération.
```

---

## 10. Critères NO-GO

Le mini-pilote est NO-GO si :

```text
1. Une opération disparaît du téléphone.
2. Un achat dépasse l'avance RT disponible.
3. Un doublon de reçu est accepté.
4. Un stock sacs devient négatif.
5. Le RT ne comprend pas l'erreur affichée.
6. Le BM ne voit pas les anomalies.
7. Les données synchronisées ne correspondent pas au terrain.
8. La correction d'une opération failed est impossible.
9. Le mode hors-ligne crée une perte ou confusion majeure.
10. Plusieurs téléphones produisent des incohérences non maîtrisées.
```

En cas de NO-GO critique :

```text
Arrêt immédiat du mini-pilote.
Gel des nouvelles saisies.
Capture des preuves.
Analyse technique.
Correction ciblée.
Nouveau test avant reprise.
```

---

## 11. Règles financières pendant le mini-pilote

Règles non négociables :

```text
1. Petite avance uniquement.
2. Pas de refinancement automatique.
3. Pas de paiement hors périmètre pilote.
4. Pas d'achat sans reçu.
5. Pas de reçu réutilisé.
6. Pas de rattrapage massif après coup.
7. Toute correction financière doit être validée par le BM.
```

---

## 12. Règles sacs pendant le mini-pilote

Règles non négociables :

```text
1. Dotation avant sortie.
2. Pas de sortie supérieure au stock.
3. Pas de mouvement oral non saisi.
4. Pas de correction sans observation.
5. Sacs torn / retournés / utilisés à tracer séparément si applicable.
```

---

## 13. Réunion de clôture mini-pilote

À la fin du mini-pilote, tenir une réunion courte avec :

- Branch Manager ;
- chef terrain ;
- RT pilotes ;
- support app ;
- finance si nécessaire.

Questions à traiter :

```text
1. Les RT ont-ils compris l'application ?
2. Les achats sont-ils fiables ?
3. Les avances sont-elles bien contrôlées ?
4. Les sacs sont-ils bien contrôlés ?
5. Les erreurs sont-elles compréhensibles ?
6. Les données terrain correspondent-elles au Command Center ?
7. Peut-on élargir à plus de RT ?
8. Quelles corrections sont obligatoires avant extension ?
```

---

## 14. Décision finale après mini-pilote

Trois décisions possibles :

### Décision A — GO extension limitée

Conditions :

```text
Aucun incident critique.
Incidents mineurs maîtrisés.
RT capables de corriger.
BM confiant sur les contrôles.
```

Action :

```text
Passer à l'étape 11 : extension contrôlée par vague.
```

---

### Décision B — GO avec corrections mineures

Conditions :

```text
Pas de risque argent / reçu / sacs.
Mais ergonomie ou message à améliorer.
```

Action :

```text
Correction rapide puis reprise du mini-pilote ou petite extension.
```

---

### Décision C — NO-GO

Conditions :

```text
Perte de donnée.
Contrôle avance insuffisant.
Doublon non bloqué.
Stock sacs incohérent.
RT incapable d'utiliser correctement.
```

Action :

```text
Arrêt pilote.
Correction technique.
Nouvelle recette téléphone.
Nouveau mini-pilote.
```

---

## 15. Ce que l'étape 10 ne fait pas

Cette étape ne fait pas :

```text
- lancement général Farmer Buying ;
- extension à tous les RT ;
- migration Supabase ;
- modification de tables ;
- changement de code applicatif ;
- démarrage RCN Trace ;
- validation définitive du programme 2027.
```

---

## 16. Conclusion

L'étape 10 est une étape de discipline opérationnelle.

Elle sert à répondre à une question simple :

```text
Peut-on laisser de vrais utilisateurs faire de vrais achats limités sans perdre le contrôle du cash, des reçus, des sacs et de la synchronisation ?
```

Si la réponse est oui, l'application peut passer vers une extension contrôlée par vague.

Si la réponse est non, il faut corriger avant d'augmenter le périmètre.
