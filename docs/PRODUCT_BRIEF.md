# Savoir+ — Product Brief

> Agent responsable : **Product Manager**
> Contributeurs : Expert pédagogique, UX Researcher
> Statut : **PROPOSITION** — en attente de validation humaine
> Version : 0.1.0 — 2026-08-03

---

## 1. Identité

| | |
|---|---|
| **Nom** | Savoir+ |
| **Signature** | Comprendre, pratiquer, progresser. |
| **Nature** | Application éducative mobile-first (Progressive Web App) |
| **Cible initiale** | Élèves de Seconde C, Côte d'Ivoire |
| **Extension visée** | Lycée ivoirien complet, puis Afrique francophone |
| **Matière MVP** | Mathématiques |

---

## 2. Problème résolu

Un élève de Seconde C en difficulté en mathématiques fait face à quatre obstacles que les ressources existantes (PDF, vidéos, groupes WhatsApp) ne traitent pas :

1. **Il ne sait pas où il pèche.** Une moyenne de 9,57/20 ne dit pas *quelle compétence* est défaillante. Il révise au hasard.
2. **Il consomme au lieu de produire.** Regarder une correction donne une illusion de compréhension qui ne survit pas au devoir.
3. **Il ne comprend pas la cause de ses erreurs.** Une erreur de signe et une erreur de méthode sont traitées de la même façon : « c'est faux ».
4. **Il oublie.** Une notion comprise en octobre est perdue en janvier faute de réactivation.

Côté parent, le suivi se réduit au bulletin trimestriel : trop tard, trop grossier, sans levier d'action.

---

## 3. Proposition de valeur

Savoir+ n'est pas une bibliothèque de cours. Sa valeur repose sur quatre fonctions, dans cet ordre :

| # | Fonction | Ce que ça change |
|---|---|---|
| 1 | **Diagnostiquer le niveau réel** | L'élève sait quelles compétences sont maîtrisées, fragiles ou non maîtrisées — pas une note globale. |
| 2 | **Construire un parcours personnalisé** | Le temps d'étude est alloué là où le gain est maximal, pas au chapitre en cours en classe. |
| 3 | **Obliger l'élève à raisonner** | La solution n'est jamais donnée avant qu'il ait produit une réponse. Indices gradués, pas de raccourci. |
| 4 | **Mesurer la progression réelle** | Progression = réussite sans indice, au premier essai, à distance. Pas le nombre de vidéos vues. |

**Contre-proposition explicite :** si Savoir+ devient une base de PDF avec un quiz par-dessus, le produit a échoué même s'il fonctionne techniquement.

---

## 4. Personas

### P1 — Anderson, 16 ans, élève de Seconde C (persona primaire)

| | |
|---|---|
| **Situation** | Moyenne 9,57/20 en mathématiques. Objectif fixé : 12/20. |
| **Équipement** | Smartphone Android d'entrée de gamme, partagé le soir. Écran ~5,5". |
| **Connexion** | Données mobiles prépayées. Coupures fréquentes. Wi-Fi rare. |
| **Disponibilité** | 60 minutes par jour, 5 jours par semaine, souvent le soir après 19 h. |
| **Frein principal** | Il ne sait pas par où commencer. Il ouvre son cahier et le referme. |
| **Ce qu'il veut** | Savoir quoi faire ce soir, en 20 minutes, et sentir que ça sert. |
| **Ce qui le fait décrocher** | Une page qui charge lentement, un exercice trop dur d'entrée, une correction incompréhensible. |

### P2 — Le parent (persona secondaire)

| | |
|---|---|
| **Profil** | Peu ou pas familier des mathématiques du lycée. |
| **Besoin** | Savoir si l'enfant travaille réellement, et si ça progresse. |
| **Ce qu'il ne veut pas** | Un tableau de bord technique. Des notes qu'il ne sait pas interpréter. |
| **Fréquence d'usage** | 1 à 2 fois par semaine, 3 minutes. |
| **Contrainte forte** | Il ne doit pas pouvoir répondre à la place de l'enfant, ni voir des données non nécessaires. |

### P3 — L'administrateur pédagogique (persona interne)

| | |
|---|---|
| **Profil** | Enseignant ou responsable de contenu mandaté par Savoir+. |
| **Besoin** | Créer, corriger, publier et retirer du contenu sans intervention développeur. |
| **Contrainte forte** | Toute action sensible doit être tracée. Aucune suppression silencieuse. |

> **Note de périmètre :** l'enseignant en tant qu'utilisateur (classe virtuelle, suivi d'une classe) est **hors MVP**. P3 est un rôle interne de production de contenu.

---

## 5. Jobs-to-be-done

| Persona | Job |
|---|---|
| Anderson | *Quand j'ai 30 minutes le soir, je veux savoir exactement quel exercice faire, pour ne pas perdre mon temps à choisir.* |
| Anderson | *Quand je bloque sur un exercice, je veux un coup de pouce qui me fasse trouver, pas la réponse qui me fasse abandonner.* |
| Anderson | *Quand je me trompe, je veux comprendre pourquoi, pour ne pas refaire la même erreur au devoir.* |
| Anderson | *Quand je révise avant un devoir, je veux revoir ce que j'ai raté, pas ce que je maîtrise déjà.* |
| Anderson | *Quand je n'ai plus de connexion, je veux pouvoir continuer ma séance et que rien ne soit perdu.* |
| Parent | *Quand je me demande si mon enfant travaille, je veux le savoir en 30 secondes, sans avoir à comprendre les maths.* |
| Admin | *Quand une erreur est détectée dans un exercice, je veux le retirer immédiatement de la circulation sans casser les tentatives déjà enregistrées.* |

---

## 6. Périmètre du MVP

### 6.1 Dans le périmètre

| Domaine | Contenu |
|---|---|
| Scolaire | Seconde C uniquement — Mathématiques uniquement |
| Contenu | 3 chapitres, 12 compétences, 12 leçons, 45 exercices, 20 questions de diagnostic, 3 évaluations |
| Fonctionnel | Diagnostic initial · cours courts · exercices progressifs · correction guidée · carnet d'erreurs · répétition espacée · planning personnalisé · évaluations · tableau de progression |
| Utilisateurs | `student` · `parent` · `admin` |
| Espaces | Espace élève · espace parent simplifié · espace administrateur de contenu |
| Technique | PWA · usage partiel hors ligne · synchronisation |

### 6.2 Hors périmètre (explicite)

Physique-Chimie · SVT · Première · Terminale · compte enseignant · classe virtuelle · paiement · abonnement · réseau social · messagerie · visioconférence · reconnaissance de copie manuscrite · chatbot génératif libre · application Android native · préparation complète au baccalauréat.

> L'architecture doit **permettre** ces extensions sans réécriture. Elle ne doit pas les **implémenter**. Toute ligne de code écrite pour une fonctionnalité hors périmètre est un défaut de Phase.

### 6.3 Zone grise arbitrée

| Sujet | Arbitrage PM |
|---|---|
| Notifications push | **Hors MVP.** Le rappel de révision est affiché à l'ouverture de l'app, pas poussé. |
| Mode sombre | **Dans le MVP** (exigé §4 Phase 4), mais non bloquant pour la mise en production. |
| Google Sign-In | **Hors MVP**, l'architecture Auth.js doit le rendre ajoutable sans migration. |
| Upload de photo de copie par l'élève | **Hors MVP.** R2 sert d'abord aux médias de contenu (schémas, figures). |

---

## 7. User stories et critères d'acceptation

> Format : `US-<domaine>-<n>`. Priorité : **P0** = MVP bloquant · **P1** = MVP souhaitable · **P2** = post-MVP.
> Chaque critère d'acceptation est formulé pour être **testable automatiquement**.

### 7.1 Compte et accès

**US-AUTH-01 — Création de compte élève** · P0
> En tant qu'élève, je veux créer un compte avec mon e-mail et un mot de passe, afin de retrouver ma progression sur n'importe quel appareil.

Critères d'acceptation :
- CA1 : la création exige e-mail, mot de passe et prénom ; tout champ manquant produit une erreur de validation affichée sous le champ.
- CA2 : le mot de passe est refusé s'il fait moins de 10 caractères.
- CA3 : un e-mail déjà utilisé produit un message générique qui ne révèle pas l'existence du compte.
- CA4 : le compte est créé avec `role = 'student'` et `email_verified_at = null`.
- CA5 : le rôle n'est **jamais** lu depuis une donnée fournie par le client.
- CA6 : un e-mail de vérification est envoyé ; le jeton expire après 24 h.

**US-AUTH-02 — Vérification d'adresse e-mail** · P0
> En tant que système, je veux vérifier l'adresse e-mail, afin d'éviter les comptes fantômes et de permettre la récupération.

- CA1 : tant que l'e-mail n'est pas vérifié, l'élève accède au diagnostic mais pas à l'invitation d'un parent.
- CA2 : un jeton consommé ne peut pas être réutilisé.
- CA3 : un jeton expiré affiche une action « renvoyer le lien ».

**US-AUTH-03 — Récupération de compte** · P0
> En tant qu'élève ayant oublié mon mot de passe, je veux le réinitialiser par e-mail.

- CA1 : la réponse est identique que l'e-mail existe ou non.
- CA2 : le jeton de réinitialisation expire après 1 h et est à usage unique.
- CA3 : toutes les sessions actives sont révoquées après changement de mot de passe.

**US-AUTH-04 — Association parent-enfant** · P0
> En tant qu'élève, je veux inviter mon parent, afin qu'il suive ma progression.

- CA1 : l'élève génère un code d'invitation ; le code expire après 7 jours.
- CA2 : le lien n'est actif qu'après acceptation par **les deux** parties (`status = 'active'`).
- CA3 : l'élève peut révoquer le lien à tout moment ; l'accès parent cesse immédiatement.
- CA4 : un parent ne peut consulter **aucune** donnée d'un élève sans lien `active`. Test d'accès croisé obligatoire.

### 7.2 Diagnostic

**US-DIAG-01 — Passer le diagnostic initial** · P0
> En tant qu'élève, je veux passer un test de 20 questions, afin de savoir où j'en suis vraiment.

- CA1 : le test comporte exactement 20 questions couvrant les 12 compétences.
- CA2 : la réponse est enregistrée à chaque question (sauvegarde progressive), pas seulement à la fin.
- CA3 : une interruption (fermeture, coupure réseau) permet la reprise à la question suivante, sans perte.
- CA4 : **aucune réponse correcte n'est transmise au navigateur avant soumission de la question.** Vérification par inspection du payload réseau.
- CA5 : le score par compétence est reproductible : mêmes réponses ⇒ mêmes statuts.

**US-DIAG-02 — Recevoir un rapport de diagnostic** · P0
> En tant qu'élève, je veux comprendre mon résultat compétence par compétence.

- CA1 : chaque compétence évaluée reçoit un statut : `mastered` (≥ 80 %), `fragile` (50–79 %), `not_mastered` (< 50 %), `not_evaluated` (données insuffisantes).
- CA2 : une compétence évaluée par moins de 2 questions est `not_evaluated`, jamais `mastered`.
- CA3 : le rapport est lisible sans vocabulaire technique.
- CA4 : un plan de travail initial est généré à partir du rapport.

### 7.3 Cours et exercices

**US-LESSON-01 — Consulter une leçon courte** · P0
> En tant qu'élève, je veux une leçon courte et structurée, afin de comprendre avant de pratiquer.

- CA1 : chaque leçon expose : objectif · cours court · règle · exemple · erreurs fréquentes.
- CA2 : la leçon est lisible sur un écran de 360 px de large sans défilement horizontal.
- CA3 : seule une leçon `published` est visible par un élève.

**US-EX-01 — Résoudre un exercice progressif** · P0
> En tant qu'élève, je veux des exercices de difficulté croissante, afin de ne pas décrocher.

- CA1 : les exercices d'une compétence sont ordonnés par niveau de difficulté.
- CA2 : chaque tentative est enregistrée avec sa durée, ses indices consommés et son résultat.
- CA3 : la tentative est enregistrée même si la soumission part en mode hors ligne.

### 7.4 Correction guidée

**US-CORR-01 — Être guidé sans recevoir la solution** · P0
> En tant qu'élève qui se trompe, je veux un indice, pas la réponse.

- CA1 : après le 1ᵉʳ essai raté, le retour indique **qu'**il y a une erreur, jamais **quelle est** la bonne réponse.
- CA2 : l'indice n°1 est délivré après le 1ᵉʳ essai raté, l'indice n°2 après le 2ᵉ.
- CA3 : la solution détaillée n'est délivrée qu'après le 3ᵉ essai, ou sur abandon explicite de l'élève.
- CA4 : **le payload réseau ne contient ni la solution ni les indices non encore débloqués.** Test automatisé obligatoire.
- CA5 : après la solution, un exercice similaire est proposé.
- CA6 : l'erreur est enregistrée au carnet avec sa catégorie.

**US-CORR-02 — Scoring transparent** · P0
- CA1 : 1ᵉʳ essai réussi = 100 % · 2ᵉ = 80 % · 3ᵉ = 60 %.
- CA2 : chaque indice utilisé retire 10 points de pourcentage.
- CA3 : le score final est borné à `[0, 100]`.
- CA4 : le score partiel n'est accordé que si l'exercice définit des étapes vérifiables.
- CA5 : le calcul est **déterministe et calculé côté serveur uniquement**.

### 7.5 Carnet d'erreurs et révision

**US-ERR-01 — Consulter mon carnet d'erreurs** · P0
- CA1 : chaque erreur porte une catégorie parmi les 10 définies (voir `PEDAGOGY.md`).
- CA2 : une erreur observée 3 fois sur la même compétence et la même catégorie devient `recurrent`.
- CA3 : le compteur d'occurrences est exact après rejeu de la même erreur.

**US-REV-01 — Réviser au bon moment** · P0
- CA1 : le calendrier initial est J+1, J+3, J+7, J+14, J+30.
- CA2 : une révision réussie applique l'intervalle suivant ; un échec revient à l'intervalle précédent.
- CA3 : deux échecs consécutifs renvoient à la leçon.
- CA4 : aucune révision due n'est perdue, aucune n'est dupliquée. Le recalcul est déterministe.

### 7.6 Progression et parent

**US-PROG-01 — Voir ma progression** · P1
- CA1 : le tableau affiche taux de réussite, maîtrise par compétence, progression par chapitre, erreurs, régularité, temps, réussite sans indice, évaluations.
- CA2 : les valeurs sont recalculées à partir des tentatives, jamais saisies.

**US-PARENT-01 — Suivre mon enfant** · P0
- CA1 : le parent ne voit que les enfants dont le lien est `active`.
- CA2 : le parent voit : activité, séances terminées, progression, difficultés principales, erreurs récurrentes, rapport hebdomadaire.
- CA3 : le parent **ne peut pas** répondre à un exercice ni modifier une donnée de l'élève. Toute tentative renvoie 403.
- CA4 : une requête forgée sur l'identifiant d'un autre élève renvoie 404 ou 403, jamais des données.

### 7.7 Hors ligne

**US-OFF-01 — Travailler sans connexion** · P0
- CA1 : une séance déjà chargée reste utilisable sans réseau.
- CA2 : toute opération produite hors ligne est mise en file avec une `idempotency_key`.
- CA3 : au retour du réseau, la file est vidée dans l'ordre ; aucun doublon n'est créé côté serveur.
- CA4 : une coupure pendant la synchronisation est reprise sans perte ni double comptage.
- CA5 : un conflit est signalé à l'élève dans un langage compréhensible, jamais silencieux.

### 7.8 Administration

**US-ADMIN-01 — Gérer le contenu** · P1
- CA1 : l'admin crée, modifie, publie et désactive chapitres, compétences, leçons, exercices, diagnostics.
- CA2 : la publication crée une **version** ; les tentatives passées restent rattachées à leur version.
- CA3 : la suppression exige une confirmation explicite et est journalisée.
- CA4 : toute action admin écrit une entrée dans `audit_logs`.

---

## 8. Backlog priorisé

Voir `BACKLOG.md` pour le backlog complet ordonné avec dépendances et estimations.

---

## 9. Indicateurs de succès

### 9.1 Indicateurs produit (à mesurer après mise en service)

| Indicateur | Définition | Cible MVP |
|---|---|---|
| **Taux d'achèvement du diagnostic** | Diagnostics terminés / diagnostics commencés | ≥ 70 % |
| **Régularité** | Élèves actifs ≥ 3 jours sur 7 | ≥ 40 % |
| **Réussite au premier essai sans indice** | Tentatives réussies au 1ᵉʳ essai sans indice / total | En **hausse** sur 4 semaines |
| **Rétention à J+7** | Élèves revenus 7 jours après inscription | ≥ 35 % |
| **Taux de révision honorée** | Révisions dues effectuées dans les 48 h | ≥ 50 % |
| **Activation parent** | Élèves avec au moins un lien parent `active` | ≥ 25 % |

### 9.2 Indicateurs techniques (portes de qualité)

| Indicateur | Cible |
|---|---|
| Perte de données en mode hors ligne | **0** |
| Doublons créés par la synchronisation | **0** |
| Fuite de réponse correcte avant soumission | **0** |
| Accès croisé entre élèves | **0** |
| Bugs critiques ou majeurs ouverts à la mise en service | **0** |
| Couverture de tests sur `lib/scoring`, `lib/mastery`, `lib/revision` | **100 % des branches** |

> **Ces indicateurs ne sont pas mesurables aujourd'hui.** Aucun chiffre ne sera annoncé comme atteint sans preuve produite par les tests ou l'instrumentation.

---

## 10. Ce qui protégerait le mieux ce produit

Trois garde-fous, par ordre d'importance :

1. **Ne jamais livrer la solution avant la production d'une réponse.** C'est la seule barrière entre Savoir+ et une énième banque de corrigés.
2. **Ne jamais publier un contenu non validé par un humain** comme conforme au programme ivoirien. Voir OQ-02.
3. **Ne jamais élargir le périmètre avant que la boucle diagnostic → exercice → correction → erreur → révision ne fonctionne de bout en bout** sur une seule matière et une seule classe.
