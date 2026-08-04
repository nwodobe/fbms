# Savoir+ — Parcours et flux UX

> Agents responsables : **UX Researcher** et **UI Designer**
> Contributeurs : Product Manager, Frontend Engineer
> Statut : **PROPOSITION** — aucune interface n'a été construite
> Version : 0.1.0 — 2026-08-03

---

## 1. Contraintes de conception (non négociables)

Le contexte d'usage réel dicte l'interface, pas l'inverse.

| Contrainte | Origine | Conséquence de conception |
|---|---|---|
| **Écran de 360 px de large** | Android d'entrée de gamme | conception à 360 px d'abord, élargissement ensuite. Aucun défilement horizontal. |
| **Données mobiles prépayées** | coût réel pour la famille | poids de page minimal, images optimisées, pas de police web lourde, pas de vidéo en MVP |
| **Connexion instable** | réseau ivoirien en zone périurbaine | toute action doit survivre à une coupure ; aucun état ne dépend d'une requête réussie |
| **Session courte et interrompue** | téléphone partagé, coupures de courant | toute progression est sauvegardée à chaque étape, jamais à la fin |
| **Usage nocturne** | après 19 h | mode sombre réel, contraste suffisant en faible luminosité |
| **Une seule main, en marchant** | usage réel | cibles tactiles ≥ 44 px, actions principales dans la zone basse du pouce |
| **Élève démotivé** | moyenne 9,57/20 | jamais plus d'une décision à prendre par écran |

---

## 2. Arborescence

```
Savoir+
│
├── PUBLIC
│   ├── Accueil (présentation)
│   ├── Connexion
│   ├── Inscription  →  élève | parent
│   └── Mot de passe oublié
│
├── ÉLÈVE
│   ├── 🏠 Aujourd'hui             ← écran d'atterrissage par défaut
│   │     ├── séance du jour
│   │     ├── révisions dues
│   │     └── reprendre où j'en étais
│   ├── 📚 Apprendre
│   │     └── Chapitre → Compétence → Leçon → Exercices
│   ├── ✏️ S'entraîner
│   │     └── Exercice → Correction guidée
│   ├── 📕 Mes erreurs
│   ├── 📈 Ma progression
│   └── ⚙️ Mon compte
│         ├── profil et objectif
│         ├── inviter un parent
│         └── déconnexion
│
├── PARENT
│   ├── 👨‍👩‍👦 Mes enfants
│   ├── 📊 Suivi d'un enfant
│   │     ├── activité de la semaine
│   │     ├── progression
│   │     └── difficultés principales
│   ├── 📄 Rapport hebdomadaire
│   └── ⚙️ Mon compte
│
└── ADMIN
    ├── Contenu (chapitres · compétences · leçons · exercices)
    ├── Diagnostics
    ├── Publication et versions
    ├── Statistiques agrégées
    └── Journal d'audit
```

**Profondeur maximale : 3 niveaux.** Au-delà, l'élève se perd. Chaque écran possède une sortie évidente : aucune impasse.

---

## 3. Parcours élève — première utilisation

```
1. Accueil
   « Comprendre, pratiquer, progresser. »
   [Je suis élève]  [Je suis parent]
        │
2. Inscription
   prénom · e-mail · mot de passe
   ⚠️ 3 champs. Pas de nom de famille, pas de date de naissance
      complète, pas de téléphone. Chaque champ retiré = plus d'inscrits.
        │
3. Vérification e-mail
   « On t'a envoyé un lien. »
   ⚠️ NE BLOQUE PAS l'accès au diagnostic.
      Bloquer ici perd l'élève qui n'ouvre pas ses mails tout de suite.
        │
4. Onboarding — 3 questions, 3 écrans
   ① Ta classe ?                → Seconde C (seul choix MVP)
   ② Ton objectif ?             → moyenne visée (Anderson : 12/20)
   ③ Combien de temps par jour ?→ 30 / 45 / 60 / 90 min
                                  Combien de jours par semaine ?
        │
5. Proposition de diagnostic
   « 20 questions, environ 25 minutes.
     Le but n'est pas d'avoir une bonne note :
     c'est de savoir par où commencer.
     Tu peux t'arrêter et reprendre quand tu veux. »
   [Commencer]  [Plus tard]
   ⚠️ « Plus tard » existe. Forcer le diagnostic fait fuir.
      Sans diagnostic, l'app propose un parcours par défaut
      et relance la proposition à chaque ouverture.
        │
6. Diagnostic — 20 questions
   ┌──────────────────────────────┐
   │  Question 7 sur 20     ▓▓▓░░ │  ← progression toujours visible
   │                              │
   │  Calcule : −3 + 5 × 2        │
   │                              │
   │  ○ 4     ○ 7     ○ −16       │
   │                              │
   │       [ Valider ]            │
   └──────────────────────────────┘
   · Aucune correction affichée
   · Aucun retour en arrière
   · Sauvegarde après CHAQUE question
   · Fermeture → reprise exacte au même point
        │
7. Rapport
   « Voilà où tu en es. »
   ✅ Solide (3)        · additions de relatifs …
   ⚠️ À consolider (5)  · fractions, priorités …
   🔴 À reprendre (4)   · calcul littéral …
   ⚪ Pas encore mesuré (0)
   ⚠️ AUCUNE note globale en gros. « 8/20 » démotive.
      « 3 compétences solides » informe.
        │
8. Plan
   « Cette semaine, on travaille 3 choses. »
   [Commencer ma première séance]
```

---

## 4. Parcours quotidien — l'écran « Aujourd'hui »

C'est **l'écran le plus important du produit**. Il répond à une seule question : *qu'est-ce que je fais maintenant ?*

```
┌────────────────────────────────────┐
│  Bonjour Anderson         🔥 4     │  ← série de jours consécutifs
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Ta séance du jour           │  │
│  │  Fractions · 20 min          │  │
│  │  ▓▓▓▓▓▓░░░░  6/10            │  │
│  │        [ Continuer ]         │  │  ← UNE action principale
│  └──────────────────────────────┘  │
│                                    │
│  À réviser aujourd'hui  (2)        │
│  · Règle des signes        J+3     │
│  · Priorités opératoires   J+7     │
│                                    │
│  Cette semaine   ▓▓▓░░  3 j / 5    │
│                                    │
│  [Apprendre] [Erreurs] [Progrès]   │
└────────────────────────────────────┘
```

**Règles :**
- Un seul bouton principal. Le reste est secondaire.
- Si aucune séance n'est prévue, l'écran propose une action, jamais un vide.
- La série de jours (`🔥`) motive mais **ne culpabilise pas** : une série rompue n'affiche pas « tu as échoué », elle affiche « on repart ».

---

## 5. Parcours d'exercice avec correction guidée

C'est le cœur du produit. Le flux est décrit ci-dessous **avec ce qui est interdit à chaque étape**.

```
┌─ ÉTAPE 1 ─ Énoncé ───────────────┐
│  Développe : (x + 3)(x − 2)      │
│  [        ta réponse       ]     │
│  [ Valider ]      [ J'ai besoin  │
│                     d'aide ]     │
└──────────────────────────────────┘
   ⛔ INTERDIT ici : bouton « voir la solution ».
      Le seul chemin vers la solution passe par 3 essais
      ou un abandon explicite.
                  │
         ┌────────┴────────┐
      JUSTE               FAUX
         │                  │
┌────────▼─────────┐ ┌──────▼─────────────────────┐
│ ✅ Bravo — 100 % │ │ ❌ Ce n'est pas ça.        │
│ [Suivant]        │ │ Regarde le signe du        │
└──────────────────┘ │ deuxième produit.          │
                     │                            │
                     │ [Réessayer] [Un indice]    │
                     └──────┬─────────────────────┘
    ⛔ INTERDIT : afficher la bonne réponse.
    ✅ AUTORISÉ : orienter vers la catégorie d'erreur.
                            │
              ┌─────────────▼──────────────┐
              │ 💡 Indice 1                │
              │ Distribue chaque terme du  │
              │ premier facteur.           │
              │ (−10 points)               │
              └─────────────┬──────────────┘
                     2ᵉ essai
                            │
                     faux → Indice 2 (première étape donnée)
                            │
                     3ᵉ essai
                            │
                     faux → SOLUTION DÉTAILLÉE
              ┌─────────────▼──────────────┐
              │ Solution                   │
              │ 1. x·x = x²                │
              │ 2. x·(−2) = −2x            │
              │ 3. 3·x = 3x                │
              │ 4. 3·(−2) = −6             │
              │ → x² + x − 6               │
              │                            │
              │ Ton erreur : SIGNE         │
              │ Enregistrée dans           │
              │ ton carnet.                │
              │                            │
              │ [Exercice similaire]       │
              └────────────────────────────┘
```

**Ce que le serveur n'envoie jamais avant le moment prévu :** la bonne réponse, la solution, l'indice 2 quand seul l'indice 1 est débloqué. Aucune exception, y compris « pour simplifier le développement front ».

---

## 6. Parcours parent

### 6.1 Association

```
ÉLÈVE                              PARENT
  │                                   │
  ├─ Mon compte → Inviter un parent   │
  │  Code : SAVOIR-4K7P               │
  │  (valide 7 jours)                 │
  │                                   │
  │      ──── SMS / WhatsApp ────►    │
  │                                   │
  │                                   ├─ Crée un compte parent
  │                                   ├─ Saisit le code
  │                                   │
  ├─ Notification : « Ton parent      │
  │   veut suivre ta progression »    │
  │   [Accepter] [Refuser]            │
  │                                   │
  └─ Accepté → lien ACTIVE ───────────┤
                                      └─ Accès au suivi
```

**Le double consentement est un choix de conception, pas une contrainte technique.** L'élève doit garder la main sur ce que voit son parent, sinon il désinstalle l'application ou crée un second compte.

### 6.2 Tableau de bord parent

```
┌────────────────────────────────────┐
│  Anderson · Seconde C              │
│                                    │
│  Cette semaine                     │
│  ┌──────────────────────────────┐  │
│  │  4 séances sur 5 prévues  ✅ │  │
│  │  2 h 40 de travail           │  │
│  └──────────────────────────────┘  │
│                                    │
│  Progression                       │
│  Fractions        ▓▓▓▓▓▓░░  faible │
│                              → moyen│
│  Calcul littéral  ▓▓▓░░░░░  à      │
│                              reprendre│
│                                    │
│  Principales difficultés           │
│  · Erreurs de signe (7 fois)       │
│  · Fractions : dénominateurs (4)   │
│                                    │
│  [Rapport de la semaine]           │
└────────────────────────────────────┘
```

**Ce que le parent ne voit jamais :** les réponses exactes de l'enfant, le détail question par question, les notes brutes des exercices ratés, l'heure précise de chaque connexion.

> Le tableau parent répond à « est-ce que ça avance ? », pas à « qu'a-t-il répondu à la question 7 ? ». Cette limite est protégée par le modèle de données lui-même (le parent lit `weekly_reports`, pas `exercise_attempts`).

---

## 7. Comportement hors ligne

### 7.1 Ce qui reste disponible sans réseau

| Fonction | Hors ligne | Détail |
|---|---|---|
| Consulter une leçon déjà ouverte | ✅ | mise en cache à la première consultation |
| Poursuivre une séance chargée | ✅ | exercices pré-chargés au démarrage de la séance |
| Répondre à un exercice | ✅ | mis en file, envoyé au retour du réseau |
| Poursuivre un diagnostic commencé | ✅ | les 20 questions sont chargées d'un bloc |
| Consulter le carnet d'erreurs | ✅ | dernier état synchronisé |
| Consulter la progression | ✅ | dernier état, avec date de fraîcheur affichée |
| Démarrer une **nouvelle** séance non chargée | ❌ | message clair, pas d'erreur technique |
| Espace parent | ❌ | consultation ponctuelle, réseau attendu |

### 7.2 États affichés

| État | Affichage | Ton |
|---|---|---|
| En ligne, synchronisé | rien (l'absence de message est le message) | — |
| Hors ligne, file vide | bandeau discret « Hors ligne » | neutre |
| Hors ligne, file non vide | « Hors ligne · 3 réponses en attente » | **rassurant** |
| Synchronisation en cours | « Synchronisation… » | discret |
| Échec de synchronisation | « Impossible d'envoyer. On réessaiera. » + bouton « Réessayer » | **jamais alarmant** |
| Conflit | « Cette séance a été faite sur un autre appareil. On garde la plus complète. » | explicatif |

**Aucun code d'erreur technique n'est montré à un élève.** Aucun message ne suggère qu'un travail a été perdu tant que ce n'est pas certain — et si ce l'est, il est dit clairement, pas dissimulé.

### 7.3 Scénarios hors ligne à valider

| # | Scénario | Attendu |
|---|---|---|
| OFF-1 | L'élève répond à 5 exercices en mode avion, puis retrouve le réseau | les 5 tentatives remontent, **aucun doublon** |
| OFF-2 | Coupure **pendant** l'envoi | reprise, opération non dupliquée |
| OFF-3 | Fermeture de l'application avec 3 opérations en attente | la file survit ; envoi à la réouverture |
| OFF-4 | Même compte sur deux téléphones, séances différentes | les deux séances remontent, le planning est recalculé sans perte |
| OFF-5 | Diagnostic commencé hors ligne, terminé en ligne | rapport correct, 20 réponses présentes |
| OFF-6 | File en attente depuis 7 jours | envoi accepté ; l'ordre pédagogique est reconstitué avec l'horodatage **client** pour la chronologie affichée, **serveur** pour l'ordre d'écriture |
| OFF-7 | Espace de stockage saturé | message explicite, pas de perte silencieuse |

---

## 8. Points de friction identifiés et parades

| # | Friction | Impact | Parade retenue |
|---|---|---|---|
| F1 | Le diagnostic de 20 questions est long | abandon en cours | progression visible · reprise possible à tout moment · promesse de valeur affichée avant de commencer |
| F2 | Le rapport de diagnostic peut démoraliser | abandon après le diagnostic | vocabulaire non stigmatisant · les points forts d'abord · un plan d'action immédiat |
| F3 | L'élève veut la réponse tout de suite | contournement du produit | pas de bouton « solution » · l'abandon est possible mais explicite et coûteux |
| F4 | La vérification d'e-mail bloque l'entrée | perte à l'inscription | vérification non bloquante pour le diagnostic |
| F5 | Le parent veut tout voir | l'élève se braque | double consentement · agrégats uniquement · révocation par l'élève |
| F6 | La connexion coupe en pleine séance | frustration, perte de confiance | file hors ligne · état rassurant · aucune perte |
| F7 | L'élève ne revient pas le lendemain | échec de la répétition espacée | l'écran « Aujourd'hui » dit quoi faire en 3 secondes · séance courte |
| F8 | Séance planifiée trop chargée | décrochage | plafond strict au temps déclaré |
| F9 | Téléphone partagé, session ouverte | données visibles par un tiers | déconnexion explicite · pas de données sensibles sur l'écran d'accueil |
| F10 | Chargement lent (compute Neon en veille) | perception de panne | squelettes de chargement, jamais un écran blanc ni une erreur |

---

## 9. États obligatoires par écran

Chaque écran définit **cinq** états. Un écran qui n'en définit que trois est incomplet.

| État | Exigence |
|---|---|
| **Chargement** | squelette de contenu, jamais un écran blanc ni un simple compteur |
| **Vide** | explique pourquoi c'est vide **et** propose une action. « Aucune erreur enregistrée — c'est bon signe ! » |
| **Erreur** | langage humain + action de reprise. Jamais de code technique. |
| **Hors ligne** | ce qui reste possible, ce qui attend |
| **Nominal** | le contenu |

---

## 10. Design system — fondations

### 10.1 Couleurs

| Rôle | Couleur | Usage | Interdit |
|---|---|---|---|
| **Bleu profond** | primaire | confiance, actions principales, en-têtes | signaler une erreur |
| **Vert** | succès | progression, réussite, maîtrise | action principale |
| **Orange** | alerte | à consolider, révision en retard | erreur définitive |
| **Rouge** | erreur | réponse fausse, non maîtrisé | fond de page |
| **Blanc / gris clair** | surfaces | fonds, séparateurs | texte principal |

**Règle d'accessibilité :** la couleur ne porte **jamais** seule une information. Un statut est toujours couleur **+** icône **+** texte. Un élève daltonien doit distinguer `fragile` de `not_mastered` sans percevoir la teinte.

### 10.2 Typographie

| Niveau | Taille min. | Note |
|---|---|---|
| Corps de texte | **16 px** | en dessous, iOS zoome automatiquement les champs |
| Énoncé mathématique | **18 px** | lisibilité prioritaire |
| Titre d'écran | 24 px | |
| Étiquette secondaire | 14 px | jamais pour une information essentielle |

Police système par défaut. **Aucune police web** en MVP : le coût en données et en temps de chargement n'est pas justifié.

### 10.3 Accessibilité — exigences minimales

| # | Exigence |
|---|---|
| A1 | Contraste ≥ 4,5:1 pour le texte courant (WCAG AA) |
| A2 | Cibles tactiles ≥ 44 × 44 px |
| A3 | Navigation complète au clavier |
| A4 | Chaque champ possède un `<label>` associé |
| A5 | Les erreurs de formulaire sont annoncées aux lecteurs d'écran (`aria-live`) |
| A6 | Le focus est visible en permanence |
| A7 | Le mode sombre respecte les mêmes ratios de contraste |
| A8 | Aucune information portée par la couleur seule |
| A9 | Le contenu mathématique dispose d'une alternative textuelle |

### 10.4 Mode sombre

Obligatoire (usage nocturne). Fond gris très foncé, **jamais noir pur** (fatigue visuelle et effet de halo sur écran OLED). Les couleurs de statut sont désaturées pour conserver les ratios de contraste sans éblouir.

---

## 11. Règles mobile-first

| # | Règle |
|---|---|
| M1 | Conception à 360 px, élargissement ensuite. Jamais l'inverse. |
| M2 | Une seule action principale par écran. |
| M3 | Les actions principales sont en zone basse (accessibles au pouce). |
| M4 | Aucun défilement horizontal, jamais. |
| M5 | Les formulaires demandent le strict nécessaire. |
| M6 | Le clavier numérique s'ouvre pour les saisies numériques (`inputmode`). |
| M7 | Chaque action donne un retour visuel en moins de 100 ms, même si la requête dure plus. |
| M8 | Aucun survol (`hover`) porteur d'information : il n'existe pas au doigt. |
| M9 | Pas de modale bloquante pendant une séance d'exercice. |
| M10 | Le poids de la première page utile reste sous les 200 Ko. |
