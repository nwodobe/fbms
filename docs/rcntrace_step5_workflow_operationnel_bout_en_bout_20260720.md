# RCN Trace — Étape 5 : workflow opérationnel terrain de bout en bout

Date : 20/07/2026  
Application : ANAGROCI Operations Suite / RCN Trace  
Périmètre : RCN Trace uniquement  
Statut : protocole opérationnel terrain, sans migration Supabase et sans modification de données

---

## 1. Objectif de l'étape 5

Cette étape formalise le workflow opérationnel complet à exécuter sur le terrain pour vérifier que RCN Trace couvre correctement la chaîne réelle :

```text
réception camion
→ sampling qualité
→ décision GM
→ déchargement / pesée
→ analyse finale
→ lot officiel RCN
→ mise en BIN
→ transfert Bouaké → Yakro
→ réception Yakro entrepôt
→ création d'une BIN Yakro
→ transfert Yakro → Calibrage
→ réception au calibrage
→ opération CAL
→ sorties par calibre
→ contrôle qualité
→ bilan matière
→ clôture
→ audit
```

L'objectif n'est pas seulement de cliquer dans l'application. L'objectif est de vérifier si le système respecte la logique métier réelle :

- le lot porte l'identité matière ;
- la BIN porte la position physique ;
- Bouaké est un entrepôt ;
- Yakro est un second entrepôt ;
- le calibrage est un atelier distinct ;
- une matière stockée à Yakro ne devient disponible pour calibrage qu'après transfert explicite vers calibrage ;
- chaque perte, écart ou correction doit être visible et justifiée.

---

## 2. Nature de cette étape

Cette étape est une étape de recette opérationnelle structurée.

Elle ne fait pas :

- de suppression ;
- de migration Supabase ;
- de changement de table ;
- de modification de données existantes ;
- de modification Farmer Buying ;
- de test physique exécuté depuis ChatGPT.

Elle produit un protocole à exécuter par l'équipe terrain sur téléphone, tablette ou ordinateur.

---

## 3. Acteurs impliqués

### 3.1 Procurement / Branch Manager

Responsable de :

- vérifier le fournisseur ;
- vérifier le camion annoncé ;
- confirmer le site de réception ;
- suivre les volumes fournisseur ;
- suivre les écarts d'engagement ;
- suivre les sacs fournisseur si applicable.

### 3.2 Entrepôt Bouaké

Responsable de :

- réception physique camion ;
- contrôle documentaire ;
- pesée ;
- déchargement ;
- affectation en BIN ;
- suivi des sacs ;
- préparation transfert vers Yakro.

### 3.3 Qualité / Laboratoire

Responsable de :

- sampling ;
- calcul KOR ;
- humidité ;
- nut count ;
- analyse finale ;
- comparaison sampling vs final ;
- avis avant libération.

### 3.4 GM / Validation

Responsable de :

- autoriser ou refuser le déchargement ;
- décider sur les écarts qualité ;
- valider les situations bloquantes ;
- valider les exceptions majeures.

### 3.5 Entrepôt Yakro

Responsable de :

- réception des transferts Bouaké → Yakro ;
- réception directe fournisseur à Yakro ;
- re-sampling si nécessaire ;
- création lot / BIN Yakro ;
- préparation transfert Yakro → Calibrage.

### 3.6 Calibrage / Production

Responsable de :

- réception des transferts destinés au calibrage ;
- rapprochement poids envoyé / reçu ;
- ouverture opération CAL ;
- checklist machine ;
- alimentation machine ;
- sorties par calibre ;
- rejets / restes ;
- bilan matière ;
- clôture.

---

## 4. Préconditions avant test terrain

Avant de commencer, vérifier :

```text
[ ] L'utilisateur est connecté.
[ ] Le module RCN Trace s'ouvre.
[ ] Le portail affiche RCN Trace.
[ ] La connexion internet est disponible au départ.
[ ] Le téléphone ou PC a été actualisé fortement.
[ ] Les données de démonstration ou données réelles sont clairement identifiées.
[ ] Aucun test n'est exécuté sur une opération critique non contrôlée.
```

Recommandation : commencer avec un jeu test contrôlé avant d'utiliser une vraie réception.

---

## 5. Périmètre recommandé du test

Pour une première recette terrain, ne pas tester tout le volume réel.

Périmètre recommandé :

```text
1 camion test
1 fournisseur
1 site Bouaké
1 BIN Bouaké
1 transfert Bouaké → Yakro
1 réception Yakro
1 BIN Yakro
1 transfert Yakro → Calibrage
1 opération CAL
1 bilan matière
```

Ce périmètre est suffisant pour valider la logique complète sans exposer le système.

---

## 6. Scénario principal — flux standard

### 6.1 Étape A — Réception camion à Bouaké

Écran :

```text
Activité entrepôt → Réception
```

Action :

- créer ou ouvrir un dossier réception ;
- saisir le camion ;
- saisir le fournisseur ;
- saisir l'origine ;
- saisir le site Bouaké ;
- saisir le poids annoncé ;
- saisir le nombre de sacs annoncé ;
- rattacher le document ou référence si disponible.

Contrôles attendus :

```text
[ ] Le site de réception est visible.
[ ] La réception n'est pas confondue avec calibrage.
[ ] Le statut montre que le camion est en attente de sampling ou traitement.
[ ] Le dossier REC existe.
```

Preuves à capturer :

- capture écran du dossier REC ;
- numéro camion ;
- fournisseur ;
- site ;
- poids annoncé ;
- date / heure.

Blocage attendu :

- si le site est vide ou incohérent, le test doit être marqué NO-GO fonctionnel.

---

### 6.2 Étape B — Sampling qualité

Écran :

```text
Activité entrepôt → Qualité
```

Action :

- saisir GK ;
- saisir spotted ;
- saisir immature ;
- saisir humidité ;
- saisir nut count ;
- vérifier le KOR calculé ;
- envoyer à décision GM.

Contrôles attendus :

```text
[ ] Le KOR se calcule avec la formule validée.
[ ] L'écart sampling / final n'est pas encore applicable.
[ ] Le dossier passe en attente décision GM.
[ ] Le rôle qualité est clair.
```

Formule rappelée :

```text
KOR = (GK + Spotted/2 + Immature/2) × 0.17637
```

Preuves à capturer :

- valeurs GK / spotted / immature ;
- KOR calculé ;
- humidité ;
- statut envoyé à GM.

Blocage attendu :

- si un KOR impossible ou une humidité invalide est acceptée sans alerte, à remonter.

---

### 6.3 Étape C — Décision GM

Écran :

```text
Activité entrepôt → Qualité / Décision GM
```

Action :

- autoriser le déchargement ;
- ou refuser ;
- ou demander action corrective.

Contrôles attendus :

```text
[ ] Un camion ne doit pas aller au déchargement sans décision GM.
[ ] La décision doit être visible dans le dossier.
[ ] Le motif doit être obligatoire en cas de refus ou blocage.
```

Preuves à capturer :

- décision GM ;
- statut avant / après ;
- nom ou rôle validateur si disponible.

Blocage attendu :

- si le déchargement est possible sans autorisation GM, NO-GO.

---

### 6.4 Étape D — Déchargement / pesée

Écran :

```text
Activité entrepôt → Réception / Déchargement
```

Action :

- saisir brut ;
- saisir tare ;
- saisir net ;
- saisir nombre de sacs ;
- saisir sacs bons, humides, déchirés ;
- saisir prestataire si nécessaire ;
- saisir BIN de déchargement.

Contrôles attendus :

```text
[ ] Le net est cohérent.
[ ] Les sacs bons + humides + déchirés sont cohérents avec total sacs.
[ ] Le site reste Bouaké.
[ ] La BIN de destination appartient au bon site.
[ ] La matière n'est pas encore du calibrage.
```

Preuves à capturer :

- ticket pesée ;
- poids brut / tare / net ;
- sacs ;
- BIN choisie.

Blocage attendu :

- si une BIN Yakro ou CAL est sélectionnée par erreur à Bouaké sans transfert, NO-GO.

---

### 6.5 Étape E — Analyse finale et lot officiel

Écran :

```text
Activité entrepôt → Qualité / Analyse finale
```

Action :

- saisir analyse finale ;
- comparer avec sampling ;
- valider ou bloquer ;
- libérer le lot ;
- créer le lot officiel RCN.

Contrôles attendus :

```text
[ ] Le lot officiel RCN est créé après analyse finale.
[ ] L'écart KOR sampling vs final est visible.
[ ] Si écart ≥ seuil, le système exige décision ou blocage.
[ ] Le lot porte fournisseur, origine, qualité, poids, prix si disponible.
```

Preuves à capturer :

- numéro lot RCN ;
- KOR final ;
- humidité finale ;
- écart ;
- statut libéré / bloqué.

Blocage attendu :

- si un lot bloqué peut alimenter une BIN ou un transfert sans validation, NO-GO.

---

### 6.6 Étape F — Mise en BIN Bouaké

Écran :

```text
Activité entrepôt → Stock & BIN
```

Action :

- affecter le lot à une BIN Bouaké ;
- vérifier la composition ;
- vérifier stock restant ;
- vérifier contributeurs.

Contrôles attendus :

```text
[ ] La BIN a un site clair.
[ ] La BIN n'est pas l'identité matière.
[ ] La composition par lot est visible.
[ ] Le stock total BIN est cohérent.
[ ] La règle de sortie de BIN mélangée reste proportionnelle sauf décision contraire.
```

Preuves à capturer :

- BIN ID ;
- lots contributeurs ;
- poids par contributeur ;
- stock total BIN.

Blocage attendu :

- si une BIN sans lot libéré peut être transférée, NO-GO.

---

### 6.7 Étape G — Préparer transfert Bouaké → Yakro

Écran :

```text
Activité entrepôt → Stock & BIN / Transfert
```

Action :

- sélectionner une BIN Bouaké ;
- choisir destination Yakro entrepôt ;
- saisir poids à transférer ;
- calculer contributeurs ;
- préparer TRF.

Contrôles attendus :

```text
[ ] La destination est clairement Entrepôt Yakro.
[ ] Le transfert est typé warehouse / entrepôt.
[ ] Le transfert n'est pas typé calibrage.
[ ] La quantité sortie ne dépasse pas le stock BIN.
[ ] Les contributeurs sont calculés automatiquement.
```

Preuves à capturer :

- numéro TRF ;
- BIN source ;
- poids envoyé ;
- destination ;
- contributeurs.

Blocage attendu :

- si une BIN Bouaké peut être envoyée directement au calibrage, le verrou Step 4 doit bloquer.

---

### 6.8 Étape H — QA / expédition transfert

Écran :

```text
Activité entrepôt → Transferts
```

Action :

- ouvrir TRF ;
- faire contrôle QA / Lab ;
- expédier vers Yakro.

Contrôles attendus :

```text
[ ] QA est requis avant expédition.
[ ] Les lots non libérés bloquent le transfert.
[ ] Le transfert passe en statut expédié.
[ ] La destination reste Yakro entrepôt.
```

Preuves à capturer :

- statut QA ;
- statut expédié ;
- destination ;
- transporteur / camion si disponible.

Blocage attendu :

- si expédition possible sans QA, NO-GO.

---

### 6.9 Étape I — Réception Yakro entrepôt

Écran :

```text
Activité entrepôt → Transferts / Réception entrepôt
```

Action :

- saisir poids réellement reçu ;
- saisir sacs reçus ;
- saisir qualité arrivée si disponible ;
- créer le dossier réception Yakro ;
- repasser par sampling / GM si le workflow le prévoit.

Contrôles attendus :

```text
[ ] La réception Yakro est une réception entrepôt.
[ ] Elle n'est pas une réception calibrage.
[ ] Le dossier créé est traçable depuis le TRF.
[ ] Les écarts envoyés / reçus sont visibles.
[ ] La matière doit redevenir lot / BIN Yakro avant calibrage.
```

Preuves à capturer :

- poids envoyé ;
- poids reçu ;
- écart ;
- dossier REC Yakro ;
- statut.

Blocage attendu :

- si la réception Yakro alimente directement une opération CAL sans transfert Yakro → Calibrage, NO-GO.

---

### 6.10 Étape J — Lot et BIN Yakro

Écran :

```text
Activité entrepôt → Qualité / Stock & BIN
```

Action :

- finaliser le dossier Yakro ;
- libérer le lot Yakro ;
- mettre en BIN Yakro ;
- vérifier le stock Yakro.

Contrôles attendus :

```text
[ ] La BIN Yakro est une BIN entrepôt.
[ ] Elle reste stockée, pas encore disponible pour calibrage.
[ ] Le lien avec les lots d'origine Bouaké existe.
[ ] La généalogie conserve les fournisseurs d'origine.
```

Preuves à capturer :

- lot Yakro ;
- BIN Yakro ;
- contributeurs ;
- stock.

Blocage attendu :

- si la BIN Yakro apparaît automatiquement en matière calibrage sans TRF, NO-GO.

---

### 6.11 Étape K — Transfert Yakro → Calibrage

Écran :

```text
Activité entrepôt → Stock & BIN / Transfert
```

Action :

- sélectionner BIN Yakro ;
- choisir destination Calibrage ;
- saisir quantité ;
- préparer TRF vers calibrage ;
- valider QA ;
- expédier.

Contrôles attendus :

```text
[ ] Seule une BIN Yakro peut être envoyée vers calibrage.
[ ] La destination est explicitement Calibrage.
[ ] Le transfert est typé calibrage.
[ ] La matière sort de l'entrepôt vers atelier.
[ ] Les contributeurs restent hérités de la BIN Yakro.
```

Preuves à capturer :

- TRF vers calibrage ;
- BIN source Yakro ;
- poids envoyé ;
- statut QA ;
- statut expédié.

Blocage attendu :

- si une BIN Bouaké passe vers calibrage, NO-GO.

---

### 6.12 Étape L — Réception au calibrage

Écran :

```text
Calibrage → Réception au calibrage
```

Action :

- ouvrir le TRF calibrage ;
- saisir poids reçu ;
- saisir sacs reçus ;
- saisir humidité / NC si disponible ;
- saisir motif + responsable si écart hors tolérance ;
- valider réception calibrage.

Contrôles attendus :

```text
[ ] Le transfert est bien destiné au calibrage.
[ ] La réception au calibrage est différente de la réception Yakro.
[ ] Le poids envoyé vs reçu est rapproché.
[ ] Un écart hors tolérance bloque sans motif et responsable.
[ ] Le TRF devient disponible pour opération CAL uniquement après réception calibrage validée.
```

Preuves à capturer :

- TRF ;
- poids envoyé ;
- poids reçu ;
- écart ;
- tolérance ;
- motif si applicable.

Blocage attendu :

- si un transfert entrepôt peut être reçu au calibrage, NO-GO.

---

### 6.13 Étape M — Création opération CAL

Écran :

```text
Calibrage → Opérations de calibrage
```

Action :

- sélectionner transfert reçu ;
- choisir machine ;
- choisir shift ;
- affecter opérateurs ;
- créer opération CAL.

Contrôles attendus :

```text
[ ] L'opération CAL exige un TRF reçu au calibrage.
[ ] Les contributeurs sont hérités automatiquement.
[ ] L'origine fournisseur n'est pas ressaisie manuellement.
[ ] La matière reçue devient poids prévu / reçu de l'opération.
```

Preuves à capturer :

- numéro CAL ;
- TRF source ;
- machine ;
- poids reçu ;
- contributeurs.

Blocage attendu :

- si une opération CAL peut être créée depuis une BIN Yakro sans TRF calibrage, NO-GO.

---

### 6.14 Étape N — Checklist et démarrage machine

Écran :

```text
Calibrage → Opérations → Checklist
```

Action :

- compléter la checklist ;
- vérifier balance ;
- vérifier machine propre ;
- vérifier opérateurs ;
- vérifier BIN de sortie ;
- démarrer.

Contrôles attendus :

```text
[ ] Toutes les cases obligatoires sont complétées.
[ ] Le démarrage est bloqué si checklist incomplète.
[ ] L'opération passe de préparée à prête, puis en cours.
```

Preuves à capturer :

- checklist complétée ;
- statut opération ;
- heure démarrage.

Blocage attendu :

- si démarrage possible avec checklist incomplète, NO-GO.

---

### 6.15 Étape O — Alimentation machine

Écran :

```text
Calibrage → Opération CAL
```

Action :

- saisir quantité alimentée ;
- vérifier le restant ;
- ne pas dépasser le reçu.

Contrôles attendus :

```text
[ ] L'alimentation ne peut pas dépasser le poids reçu.
[ ] Le restant à traiter est visible.
[ ] La matière dans la machine est suivie.
```

Preuves à capturer :

- poids reçu ;
- poids alimenté ;
- restant ;
- statut machine.

Blocage attendu :

- si alimentation supérieure au reçu est acceptée, NO-GO.

---

### 6.16 Étape P — Saisie sorties par calibre

Écran :

```text
Calibrage → Sorties
```

Action :

- saisir C1 à C9 ;
- saisir sacs ;
- saisir NC ;
- saisir BIN de destination par calibre ;
- saisir rejets / restes séparément.

Contrôles attendus :

```text
[ ] Les sorties par calibre sont séparées.
[ ] Les rejets ne sont pas confondus avec pertes inexpliquées.
[ ] Les restes machine sont suivis.
[ ] Le total sorties + pertes + restes est comparé au reçu.
```

Preuves à capturer :

- poids par calibre ;
- total sorties ;
- rejets ;
- restes ;
- écart.

Blocage attendu :

- si le système accepte une sortie totale incohérente sans alerte, à corriger.

---

### 6.17 Étape Q — Contrôle qualité des sorties

Écran :

```text
Calibrage → Contrôle qualité
```

Action :

- contrôler les sorties ;
- confirmer conforme ;
- accepter avec réserve ;
- bloquer ;
- rejeter ;
- demander recalibrage.

Contrôles attendus :

```text
[ ] Une sortie bloquée ne doit pas alimenter une BIN de calibre validée.
[ ] Une sortie rejetée doit rester visible.
[ ] Une sortie à recalibrer doit être orientée vers un flux spécifique.
```

Preuves à capturer :

- décision QC ;
- calibre concerné ;
- motif ;
- statut.

Blocage attendu :

- si une sortie bloquée devient stock fini, NO-GO.

---

### 6.18 Étape R — Bilan matière et clôture

Écran :

```text
Calibrage → Bilan / Clôture
```

Action :

- comparer reçu ;
- comparer sorties ;
- comparer rejets ;
- comparer restes ;
- identifier écart inexpliqué ;
- justifier ;
- clôturer.

Contrôles attendus :

```text
[ ] Reçu = sorties + rejets + restes + écart.
[ ] Écart hors tolérance exige motif.
[ ] Clôture impossible si blocage qualité non traité.
[ ] Après clôture, correction doit être auditée.
```

Preuves à capturer :

- bilan matière ;
- taux écart ;
- motif ;
- statut clôturé ;
- audit.

Blocage attendu :

- si clôture possible avec écart non expliqué ou QC bloqué, NO-GO.

---

## 7. Scénarios négatifs obligatoires

Ces tests doivent volontairement provoquer des erreurs pour vérifier les blocages.

### 7.1 Tenter un transfert Bouaké → Calibrage

Résultat attendu :

```text
bloqué
```

Raison : Bouaké doit d'abord transférer vers Yakro entrepôt.

### 7.2 Tenter de créer une opération CAL depuis une BIN Yakro sans TRF calibrage

Résultat attendu :

```text
bloqué
```

Raison : stock Yakro ≠ matière disponible calibrage.

### 7.3 Tenter de recevoir au calibrage un transfert entrepôt

Résultat attendu :

```text
bloqué
```

Raison : un transfert warehouse doit être reçu en entrepôt.

### 7.4 Tenter de démarrer CAL sans checklist complète

Résultat attendu :

```text
bloqué
```

### 7.5 Tenter d'alimenter plus que le reçu

Résultat attendu :

```text
bloqué
```

### 7.6 Tenter de clôturer avec écart hors tolérance non justifié

Résultat attendu :

```text
bloqué ou alerte critique
```

---

## 8. Grille de recette terrain

| Bloc | Test | Résultat attendu | Résultat terrain | Statut |
|---|---|---|---|---|
| Réception | Camion Bouaké créé | REC créé | À compléter | GO / NO-GO |
| Qualité | Sampling KOR | KOR calculé | À compléter | GO / NO-GO |
| GM | Décision obligatoire | Déchargement bloqué avant GM | À compléter | GO / NO-GO |
| Déchargement | Net et sacs cohérents | Lot possible | À compléter | GO / NO-GO |
| Lot | Lot officiel créé | RCN libéré ou bloqué | À compléter | GO / NO-GO |
| BIN | Stock BIN cohérent | contributeurs visibles | À compléter | GO / NO-GO |
| TRF BKE-YAK | Destination Yakro | type warehouse | À compléter | GO / NO-GO |
| Réception Yakro | Dossier Yakro créé | réception entrepôt | À compléter | GO / NO-GO |
| BIN Yakro | Stock Yakro | pas calibrage | À compléter | GO / NO-GO |
| TRF YAK-CAL | Destination Calibrage | type calibrage | À compléter | GO / NO-GO |
| Réception CAL | poids reçu | validation calibrage | À compléter | GO / NO-GO |
| CAL | création opération | depuis TRF reçu | À compléter | GO / NO-GO |
| Machine | checklist | démarrage contrôlé | À compléter | GO / NO-GO |
| Sorties | C1-C9 | sorties séparées | À compléter | GO / NO-GO |
| QC | décision sortie | blocage si rejet | À compléter | GO / NO-GO |
| Clôture | bilan matière | écart justifié | À compléter | GO / NO-GO |

---

## 9. Critères GO

Le workflow est GO si :

```text
[ ] Toutes les étapes principales passent dans l'ordre.
[ ] Les statuts sont compréhensibles.
[ ] Les écrans ne confondent pas Yakro et Calibrage.
[ ] Les règles Step 4 bloquent les scénarios négatifs.
[ ] Les poids restent cohérents.
[ ] Les contributeurs sont conservés.
[ ] Les sorties calibrage ne dépassent pas le reçu.
[ ] Les écarts sont visibles.
[ ] L'audit trace les actions importantes.
```

---

## 10. Critères NO-GO

Le workflow est NO-GO si l'un des cas suivants apparaît :

```text
[ ] Un lot peut être transféré sans être libéré.
[ ] Bouaké peut envoyer directement au calibrage.
[ ] Yakro stock devient calibrage sans TRF Yakro → Calibrage.
[ ] Une opération CAL peut être créée sans réception calibrage.
[ ] Une sortie QC bloquée alimente le stock fini.
[ ] Une clôture est possible avec écart critique non justifié.
[ ] Les contributeurs disparaissent après transfert ou calibrage.
[ ] Les données se perdent en hors connexion / resynchronisation.
```

---

## 11. Journal d'incident terrain

Chaque incident doit être noté ainsi :

```text
Date / heure :
Utilisateur :
Téléphone / PC :
Écran :
Action réalisée :
Résultat attendu :
Résultat obtenu :
Capture écran : oui / non
Gravité : critique / majeure / mineure
Décision : corriger / surveiller / accepter temporairement
```

---

## 12. Niveau de gravité

### Critique

Bloque le contrôle matière ou crée un risque financier / qualité majeur.

Exemples :

- matière Yakro utilisée en calibrage sans transfert ;
- opération CAL sans réception ;
- perte non tracée ;
- contributeurs disparus ;
- suppression d'opérations non synchronisées.

### Majeur

Ne bloque pas forcément le test, mais peut créer confusion ou erreur utilisateur.

Exemples :

- libellé ambigu ;
- bouton mal placé ;
- statut incomplet ;
- preuve non visible.

### Mineur

Amélioration ergonomique ou esthétique.

Exemples :

- alignement ;
- wording ;
- taille police ;
- couleur de badge.

---

## 13. Rôles pendant le test

| Rôle | Personne recommandée | Responsabilité |
|---|---|---|
| Pilote test | Monsieur KOUASSI | suivre scénario complet |
| Entrepôt Bouaké | WH / assistant | réception, déchargement, BIN |
| Qualité | QA / labo | sampling, KOR, finale |
| GM / validation | GM ou délégué | décision et exceptions |
| Yakro | WH Yakro | réception entrepôt |
| Calibrage | responsable production | opération CAL |
| Observateur | Jackson ou assistant | captures et journal incident |

---

## 14. Recommandation d'exécution

Exécuter le test en 3 vagues :

### Vague 1 — simulation contrôlée

Durée : 1 à 2 heures.

Objectif : comprendre le parcours et détecter les erreurs évidentes.

### Vague 2 — cas réel limité

Durée : 1 journée.

Objectif : tester avec une vraie réception contrôlée.

### Vague 3 — transfert + calibrage

Durée : selon opération réelle.

Objectif : tester la partie la plus sensible : Yakro → Calibrage → CAL.

---

## 15. Décision recommandée après étape 5

Si tous les tests sont GO :

```text
Passer à RCN Trace — Étape 6 : corrections ciblées après recette terrain.
```

Si un bloc critique est NO-GO :

```text
Ne pas élargir l'usage.
Corriger d'abord le bloc critique.
Refaire le test sur le même scénario.
```

Si seuls des points mineurs apparaissent :

```text
Continuer la recette tout en listant les améliorations UI.
```

---

## 16. Audit de cette étape

Cette étape ajoute uniquement ce protocole documentaire.

Elle ne modifie pas :

- les tables Supabase ;
- les triggers ;
- les politiques RLS ;
- les données ;
- Farmer Buying ;
- le moteur RCN Trace ;
- l'interface RCN Trace.

---

## 17. Conclusion

L'étape 5 transforme les corrections précédentes en un protocole opérationnel testable.  
Elle donne à l'équipe une méthode concrète pour vérifier que RCN Trace respecte la réalité terrain de bout en bout.

Le point le plus critique à surveiller reste :

```text
Stock Yakro entrepôt ≠ matière disponible calibrage.
```

La matière devient disponible au calibrage uniquement après :

```text
BIN Yakro → transfert explicite vers calibrage → réception calibrage validée → opération CAL.
```
