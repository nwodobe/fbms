# Savoir+ — Modèle pédagogique

> Agent responsable : **Expert pédagogique**
> Contributeurs : Content QA, Product Manager, Backend Engineer
> Statut : **PROPOSITION — CONTENU PROVISOIRE NON VALIDÉ**
> Version : 0.1.0 — 2026-08-03

---

## ⚠️ Avertissement de conformité — à lire avant toute utilisation

**Aucun élément de ce document ne constitue une référence officielle du programme ivoirien de Seconde C.**

Les chapitres, compétences et progressions proposés ci-dessous sont construits à partir de connaissances générales sur les mathématiques du niveau Seconde. Ils **n'ont pas été vérifiés** contre le programme officiel du Ministère de l'Éducation Nationale et de l'Alphabétisation de Côte d'Ivoire.

En conséquence :

1. Tout contenu produit à partir de ce document porte le statut `draft` et la mention **« Contenu provisoire — en attente de validation »**.
2. **Aucun contenu ne passe au statut `published` sans validation par un enseignant ivoirien de mathématiques exerçant en Seconde.**
3. L'application ne doit **jamais** afficher « conforme au programme officiel » avant que cette validation ne soit acquise et tracée.
4. Cette exigence est bloquante et enregistrée sous **OQ-02** dans `OPEN_QUESTIONS.md`.

Ce point n'est pas une formalité : présenter un contenu non validé comme officiel à des élèves préparant un examen national est le risque le plus dommageable du produit.

---

## 1. Principe pédagogique directeur

> **L'élève doit produire avant de recevoir.**

Toute l'architecture pédagogique découle de cette phrase. Elle se décline en quatre règles opérationnelles :

| # | Règle | Traduction technique |
|---|---|---|
| **P1** | On ne travaille pas ce qu'on maîtrise déjà | le parcours est piloté par le diagnostic, pas par la progression de classe |
| **P2** | On ne donne jamais la solution avant une tentative | la solution est verrouillée serveur jusqu'au 3ᵉ essai ou à l'abandon explicite |
| **P3** | Une erreur est une information, pas une sanction | chaque erreur est catégorisée et devient un objet de travail |
| **P4** | Comprendre une fois ne suffit pas | toute notion travaillée entre en répétition espacée |

---

## 2. Matrice chapitres → compétences (MVP)

> **Statut : PROVISOIRE.** 3 chapitres, 12 compétences, conformément au périmètre MVP.

### Chapitre 1 — Nombres relatifs, fractions et priorités opératoires

| Code | Compétence | Prérequis | Niveau visé |
|---|---|---|---|
| `SK-REL-01` | Additionner et soustraire des nombres relatifs | — | Fondamental |
| `SK-REL-02` | Multiplier et diviser des nombres relatifs (règle des signes) | `SK-REL-01` | Fondamental |
| `SK-FRA-01` | Simplifier une fraction, reconnaître des fractions égales | — | Fondamental |
| `SK-FRA-02` | Additionner et soustraire des fractions (mise au même dénominateur) | `SK-FRA-01` | Intermédiaire |
| `SK-FRA-03` | Multiplier et diviser des fractions | `SK-FRA-01` | Intermédiaire |
| `SK-PRI-01` | Appliquer les priorités opératoires et les parenthèses | `SK-REL-02` | Fondamental |

### Chapitre 2 — Calcul littéral

| Code | Compétence | Prérequis | Niveau visé |
|---|---|---|---|
| `SK-LIT-01` | Réduire et ordonner une expression littérale | `SK-REL-02`, `SK-PRI-01` | Fondamental |
| `SK-LIT-02` | Développer un produit (simple distributivité) | `SK-LIT-01` | Intermédiaire |
| `SK-LIT-03` | Développer avec les identités remarquables | `SK-LIT-02` | Intermédiaire |
| `SK-LIT-04` | Factoriser (facteur commun, identités remarquables) | `SK-LIT-03` | Avancé |

### Chapitre 3 — Équations et inéquations

| Code | Compétence | Prérequis | Niveau visé |
|---|---|---|---|
| `SK-EQU-01` | Résoudre une équation du premier degré à une inconnue | `SK-LIT-01`, `SK-FRA-02` | Intermédiaire |
| `SK-EQU-02` | Résoudre une inéquation du premier degré (règle du changement de sens) | `SK-EQU-01` | Avancé |

> **12 compétences.** La numérotation est stable : `SK-XXX-NN` est une clé métier utilisée par les seeds et ne doit jamais changer, même si le libellé évolue.

### Graphe de prérequis

```
SK-REL-01 ──► SK-REL-02 ──► SK-PRI-01 ──┐
                                         ├──► SK-LIT-01 ──► SK-LIT-02 ──► SK-LIT-03 ──► SK-LIT-04
SK-FRA-01 ──┬──► SK-FRA-02 ──────────────┤
            └──► SK-FRA-03                └──► SK-EQU-01 ──► SK-EQU-02
```

**Usage :** une compétence dont un prérequis est `not_mastered` n'est pas proposée en priorité, même si elle est elle-même faible. On répare la base d'abord. C'est la différence entre un parcours personnalisé et une simple liste de lacunes.

---

## 3. Diagnostic initial

### 3.1 Structure

| Paramètre | Valeur |
|---|---|
| Nombre de questions | **20** |
| Compétences couvertes | les 12 |
| Répartition | 2 questions pour les 8 compétences fondamentales/intermédiaires prioritaires, 1 question pour les 4 restantes |
| Durée indicative | 20 à 30 minutes |
| Interruption | autorisée à tout moment, reprise à la question suivante |
| Retour en arrière | **non** — une question validée n'est pas modifiable (sinon le diagnostic mesure la persévérance, pas le niveau) |
| Correction affichée | **aucune pendant le test** |

### 3.2 Règle de répartition

Une compétence évaluée par **une seule** question ne peut jamais être déclarée `mastered`. Une bonne réponse unique ne distingue pas la maîtrise du hasard, en particulier sur un QCM.

| Nb de questions sur la compétence | Statuts atteignables |
|---|---|
| 0 | `not_evaluated` |
| 1 | `not_evaluated` (si juste) · `not_mastered` (si faux) |
| ≥ 2 | tous |

> Une réponse fausse est informative même seule ; une réponse juste seule ne l'est pas. Cette asymétrie est volontaire : elle évite de déclarer maîtrisée une compétence sur un coup de chance, ce qui priverait l'élève d'un travail nécessaire.

### 3.3 Statuts de maîtrise

| Statut | Condition | Signification pour l'élève |
|---|---|---|
| `mastered` | taux ≥ 80 % **et** `evaluated_count ≥ 2` | « Tu maîtrises. On y revient juste de temps en temps. » |
| `fragile` | 50 % ≤ taux < 80 % | « Ça vient, mais ce n'est pas encore solide. » |
| `not_mastered` | taux < 50 % | « À travailler en priorité. » |
| `not_evaluated` | `evaluated_count < 2` | « Pas encore mesuré. » |

**Bornes exactes** (à implémenter sans ambiguïté) : `>= 80` ⇒ mastered · `>= 50 et < 80` ⇒ fragile · `< 50` ⇒ not_mastered.
80 % exactement est `mastered`. 50 % exactement est `fragile`. Ces deux cas limites font l'objet d'un test unitaire dédié.

### 3.4 Rapport de diagnostic

Le rapport présente, dans cet ordre :

1. **Une phrase de synthèse** sans note globale mise en avant. On ne dit pas « 8/20 », on dit « 3 compétences solides, 5 à consolider, 4 à reprendre ».
2. **Les compétences par statut**, la plus prioritaire en premier.
3. **Les 3 priorités de travail** (voir §3.5).
4. **Le plan de la première semaine.**

> **Principe de formulation :** le rapport ne dit jamais « tu es faible en ». Il dit « cette compétence est à travailler ». La différence est ce qui fait revenir l'élève le lendemain.

### 3.5 Génération du plan initial

Ordre de priorité pour sélectionner les 3 premières compétences à travailler :

1. Compétences `not_mastered` **dont tous les prérequis sont `mastered` ou absents** → travaillables immédiatement.
2. Si aucune, remonter au prérequis `not_mastered` le plus en amont du graphe.
3. Puis compétences `fragile` par ordre de prérequis.
4. `not_evaluated` : proposées en mesure complémentaire, jamais en priorité de travail.

Le plan respecte `daily_minutes` et `days_per_week` du profil élève (Anderson : 60 min, 5 j/sem).

---

## 4. Règles de scoring

### 4.1 Score d'une tentative d'exercice

```
score_base = 100 si réussi au 1ᵉʳ essai
             80 si réussi au 2ᵉ essai
             60 si réussi au 3ᵉ essai
              0 si non réussi après 3 essais

score = clamp(score_base − 10 × nombre_d_indices_utilisés, 0, 100)
```

**Cas d'école à figer par des tests :**

| Situation | Essais | Indices | Score |
|---|---|---|---|
| Réussite immédiate | 1 | 0 | **100** |
| Réussite au 2ᵉ après 1 indice | 2 | 1 | **70** |
| Réussite au 3ᵉ après 2 indices | 3 | 2 | **40** |
| Échec total | 3 | 2 | **0** |
| Réussite au 1ᵉʳ avec un indice demandé avant de répondre | 1 | 1 | **90** |

### 4.2 Score partiel

Le score partiel n'est accordé **que si** l'exercice définit des `exercise_steps` avec des valeurs attendues vérifiables.

```
score_partiel = 100 × (Σ poids des étapes justes / Σ poids de toutes les étapes)
puis soumis à la même pénalité d'indices et au même plafond par n° d'essai.
```

Un exercice sans étapes est **binaire** : juste ou faux. Aucun « demi-point d'encouragement » : il fausserait le calcul de maîtrise.

### 4.3 Calcul du taux de maîtrise d'une compétence

```
success_rate = 100 × (Σ scores des N dernières mesures) / (100 × N)
```

avec `N = min(10, nombre de mesures disponibles)`, et `evaluated_count = nombre total de mesures`.

**Fenêtre glissante des 10 dernières mesures.** Motif : un élève qui a raté 20 exercices en septembre et réussi les 10 derniers en décembre a progressé. Une moyenne sur tout l'historique le maintiendrait indéfiniment en `not_mastered`, ce qui contredit l'objectif du produit.

> Voir DM-Q4 dans `OPEN_QUESTIONS.md` : la pondération par récence (au-delà de la fenêtre glissante) reste à arbitrer.

### 4.4 Propriétés obligatoires du scoring

| Propriété | Signification | Test |
|---|---|---|
| **Déterminisme** | mêmes entrées ⇒ même sortie, toujours | test de propriété avec entrées aléatoires |
| **Pureté** | aucune date, aucun aléa, aucune E/S dans `lib/scoring` | revue + interdiction d'import par ESLint |
| **Bornage** | `0 ≤ score ≤ 100` toujours | test de propriété |
| **Serveur uniquement** | le client n'affiche jamais un score qu'il a calculé | test d'intégration |
| **Monotonie** | plus d'indices ⇒ score ≤ ; plus d'essais ⇒ score ≤ | test de propriété |

---

## 5. Carnet d'erreurs

### 5.1 Les 10 catégories

| Code | Catégorie | Exemple type | Remédiation associée |
|---|---|---|---|
| `sign` | Signe | `−3 + 5 = −8` | règle des signes, droite graduée |
| `calculation` | Calcul | `7 × 8 = 54` | automatismes de calcul |
| `fraction` | Fraction | `1/2 + 1/3 = 2/5` | mise au même dénominateur |
| `priority` | Priorité opératoire | `2 + 3 × 4 = 20` | ordre des opérations |
| `formula` | Formule | `(a+b)² = a² + b²` | identités remarquables |
| `method` | Méthode | résout une inéquation comme une équation | procédure pas à pas |
| `reading` | Lecture de l'énoncé | répond à une autre question | reformulation de la consigne |
| `knowledge` | Connaissance | ignore la définition mobilisée | retour à la leçon |
| `attention` | Attention | recopie mal un nombre juste | vérification finale |
| `incomplete` | Réponse incomplète | trouve `x` mais ne conclut pas | exigence de conclusion |

### 5.2 Règles de gestion

| Règle | Détail |
|---|---|
| Unicité | une ligne par `(élève, compétence, catégorie)`. On incrémente `occurrence_count`, on ne crée pas de ligne par occurrence. |
| Récurrence | `occurrence_count >= 3` ⇒ `status = 'recurrent'`. **Seuil strict**, pas « environ trois fois ». |
| Résolution | 3 réussites consécutives sur la compétence **sans reproduire la catégorie** ⇒ `status = 'resolved'`. |
| Réapparition | une erreur `resolved` qui réapparaît repasse à `open` (ou `recurrent` si le compteur le justifie), sans remise à zéro du compteur historique. |
| Attribution | la catégorie est déterminée **côté serveur** : correspondance avec `expected_error_category` de la version d'exercice, sinon règles d'analyse de la réponse, sinon `calculation` par défaut. |

> **Limite assumée du MVP :** la catégorisation automatique d'une réponse libre est imparfaite. On préfère une catégorie par défaut honnête à une catégorisation fantaisiste. Les cas non attribuables sont journalisés pour amélioration ultérieure, jamais devinés.

---

## 6. Correction guidée — protocole en 9 étapes

| Étape | Ce que fait l'élève | Ce que renvoie le serveur | Ce qu'il ne renvoie **jamais** |
|---|---|---|---|
| 1 | 1ᵉʳ essai | juste / faux | la bonne réponse |
| 2 | lit le retour | « il y a une erreur, regarde le signe » (retour orienté catégorie) | la correction |
| 3 | demande de l'aide | **indice 1** — oriente vers la méthode | la valeur numérique attendue |
| 4 | 2ᵉ essai | juste / faux | la bonne réponse |
| 5 | demande de l'aide | **indice 2** — donne la première étape | le résultat final |
| 6 | 3ᵉ essai | juste / faux | — |
| 7 | — | **solution détaillée** (droit acquis) | — |
| 8 | — | **exercice similaire** proposé | — |
| 9 | — | **erreur enregistrée** au carnet | — |

### Règles de verrouillage

| Règle | Contrôle |
|---|---|
| Un indice n'est délivré qu'après une tentative ratée, **ou** sur demande explicite avec pénalité affichée avant confirmation. | serveur |
| L'indice `n+1` exige que l'indice `n` ait été délivré. | serveur |
| La solution exige `attempt_number = 3` **ou** un abandon explicite enregistré. | serveur |
| Le payload de l'exercice ne contient jamais un indice non débloqué. | serveur + test de non-régression |
| L'abandon est un choix conscient : il affiche « tu auras la solution mais l'exercice comptera 0 » avant confirmation. | client + serveur |

> **Ce protocole est la fonction centrale du produit.** S'il est contourné — par une fuite de payload, par un raccourci d'interface, par un « bouton solution » ajouté par commodité — Savoir+ redevient une banque de corrigés et perd sa raison d'être.

---

## 7. Répétition espacée

### 7.1 Calendrier

| `interval_index` | Délai | Cumul depuis la première réussite |
|---|---|---|
| 0 | **J+1** | 1 jour |
| 1 | **J+3** | 4 jours |
| 2 | **J+7** | 11 jours |
| 3 | **J+14** | 25 jours |
| 4 | **J+30** | 55 jours |

Au-delà de l'index 4, la compétence est considérée comme consolidée : la révision passe en mode entretien (une occurrence par mois, hors périmètre MVP de planification fine).

### 7.2 Règles de progression

| Événement | Effet |
|---|---|
| Révision **réussie** | `interval_index += 1` (plafonné à 4), `consecutive_success += 1`, `consecutive_failure = 0` |
| Révision **échouée** | `interval_index = max(0, interval_index − 1)`, `consecutive_failure += 1`, `consecutive_success = 0` |
| **2 échecs consécutifs** | `interval_index = 0` **et** retour à la leçon injecté en tête de la prochaine séance |
| **3 réussites consécutives** au dernier index | compétence marquée consolidée, statut de maîtrise renforcé |
| Révision **manquée** | `status = 'missed'`, replanifiée au prochain jour disponible, **l'intervalle n'avance pas** |

### 7.3 Propriétés obligatoires

| Propriété | Signification |
|---|---|
| **Aucune perte** | une révision due et non faite est reportée, jamais supprimée |
| **Aucune duplication** | contrainte d'unicité en base sur les révisions `scheduled` pour une même cible |
| **Déterminisme** | `lib/revision` est pur ; la date « maintenant » est un **paramètre injecté**, jamais `new Date()` interne |
| **Reproductibilité** | rejouer le même historique reproduit le même calendrier, au jour près |

> Le point sur l'injection de la date est structurant : sans lui, aucun test du calendrier de révision n'est possible, et « J+30 » ne peut être vérifié qu'en attendant trente jours.

### 7.4 Charge quotidienne

La séance quotidienne est plafonnée par `daily_minutes`. Si les révisions dues dépassent le temps disponible, l'ordre de priorité est :

1. révisions **en retard** (`missed`), les plus anciennes d'abord ;
2. erreurs `recurrent` ;
3. révisions dues du jour ;
4. progression sur de nouvelles compétences.

**On ne remplit jamais une séance au-delà du temps déclaré.** Une séance de 60 min qui en réclame 90 fait décrocher l'élève : c'est un échec produit, pas un excès de zèle.

---

## 8. Structure d'une notion

Chaque notion (= une compétence) comporte obligatoirement les 7 blocs suivants :

| Bloc | Contenu | Longueur cible |
|---|---|---|
| **Objectif** | « À la fin, tu sauras… » — une phrase, un verbe d'action | 1 phrase |
| **Cours court** | l'essentiel, sans digression | 150–250 mots |
| **Règle** | l'énoncé formel encadré, mémorisable | 1 à 3 lignes |
| **Exemple** | un cas résolu intégralement, étape par étape | 1 exemple |
| **Erreurs fréquentes** | 2 à 3 pièges, avec le « pourquoi c'est faux » | 2–3 items |
| **Exercices progressifs** | 3 à 5 exercices de difficulté croissante (1 → 5) | 3–5 |
| **Fiche de révision** | condensé d'une demi-page, consultable hors ligne | ≤ 100 mots |

Le quiz de fin de notion réutilise les exercices, il ne constitue pas un contenu distinct.

---

## 9. Répartition du contenu MVP

| Élément | Quantité | Répartition |
|---|---|---|
| Chapitres | 3 | Ch.1 : 6 compétences · Ch.2 : 4 · Ch.3 : 2 |
| Compétences | 12 | voir §2 |
| Leçons | 12 | une par compétence |
| Exercices | 45 | ~3 à 5 par compétence, difficultés 1 à 5 |
| Questions de diagnostic | 20 | voir §3.1 |
| Évaluations | 3 | une par chapitre |

**Aucun texte de remplissage.** Chaque énoncé est un énoncé mathématique réel, vérifié par Content QA avant publication.

---

## 10. Exigences de validation du contenu (Content QA)

Avant qu'un contenu ne passe de `draft` à `published`, il doit franchir ces contrôles :

| # | Contrôle | Bloquant |
|---|---|:--:|
| C1 | La réponse attendue est mathématiquement exacte | ✅ |
| C2 | L'énoncé n'admet pas plusieurs interprétations | ✅ |
| C3 | Les tolérances numériques sont cohérentes (arrondis, formes équivalentes `1/2` = `0.5`) | ✅ |
| C4 | La difficulté annoncée correspond à la difficulté réelle | ✅ |
| C5 | Les indices orientent sans donner la réponse | ✅ |
| C6 | La solution détaillée est complète et suit la méthode enseignée dans la leçon | ✅ |
| C7 | L'énoncé est rédigé dans un français accessible à un élève de 16 ans | ✅ |
| C8 | Aucune notation non introduite en amont dans le parcours | ✅ |
| C9 | Le contexte culturel est pertinent (noms, situations, unités locales) | — |
| C10 | Validation par un enseignant ivoirien de Seconde | ✅ **OQ-02** |

Un contenu qui échoue à un contrôle bloquant est **rejeté**, pas « publié avec réserve ».

---

## 11. Ce que ce modèle pédagogique n'affirme pas

Par honnêteté méthodologique :

- **Les seuils 80 / 50 sont des conventions de conception**, cohérentes avec l'usage courant, non issues d'une étude sur la population cible. Ils sont paramétrables et devront être réévalués sur données réelles.
- **Le calendrier J+1/3/7/14/30 s'inspire des travaux sur la répétition espacée**, sans être calibré sur des élèves ivoiriens de Seconde. Il constitue une base raisonnable, pas une vérité mesurée.
- **La fenêtre de 10 mesures** est un choix d'ingénierie, arbitrable.
- **La catégorisation automatique des erreurs** est approximative sur les réponses libres et doit être présentée à l'élève comme une aide, pas comme un verdict.

Chacun de ces points est un paramètre de configuration, pas une constante enfouie dans le code.
