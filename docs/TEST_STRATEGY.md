# Savoir+ — Stratégie de tests

> Agent responsable : **QA Engineer**
> Contributeurs : Security Engineer, Content QA, Backend Engineer, Offline and Sync Engineer, DevOps Engineer
> Statut : **PROPOSITION** — aucun test n'a été écrit
> Version : 0.1.0 — 2026-08-03

---

## 1. Principe

> **Une fonctionnalité sans preuve d'exécution n'est pas terminée.**

Cette phrase est la règle de fonctionnement du projet, pas un slogan. Concrètement :

- aucune phase n'est déclarée terminée sans la sortie réelle des tests correspondants ;
- « ça devrait marcher » n'est pas un résultat ;
- un test qui échoue n'est jamais désactivé pour débloquer une livraison ;
- un correctif de bug s'accompagne du test qui reproduit le bug **avant** correction.

---

## 2. Pyramide de tests

```
                    ╱╲
                   ╱E2E╲            ~15 parcours Playwright
                  ╱──────╲          lents, fragiles, indispensables
                 ╱ INTÉG. ╲         ~80 tests · PostgreSQL réel
                ╱──────────╲        services · repositories · autorisations
               ╱  UNITAIRES ╲       ~250 tests · Vitest · aucune E/S
              ╱──────────────╲      scoring · maîtrise · révision · validation
             ╱────────────────╲
```

**Le socle est volontairement épais sur le domaine pur.** `lib/scoring`, `lib/mastery` et `lib/revision` sont des fonctions pures : elles se testent exhaustivement, vite, sans base de données. Ce sont aussi les endroits où une erreur est la plus coûteuse (un score faux corrompt toute la progression d'un élève, silencieusement).

---

## 3. Outillage

| Niveau | Outil | Périmètre |
|---|---|---|
| Unitaire | **Vitest** | `lib/*`, utilitaires, schémas Zod |
| Composant | **React Testing Library** | composants, formulaires, états, accessibilité |
| Intégration | **Vitest + PostgreSQL réel** (branche Neon éphémère ou Postgres conteneurisé) | repositories, services, transactions, contraintes |
| E2E | **Playwright** | parcours complets, multi-appareils, hors ligne, réseau dégradé |
| Sécurité | **Vitest + Playwright** | autorisations, payloads, en-têtes |
| Accessibilité | **axe-core** via Playwright | WCAG AA sur les écrans clés |

> **Aucun test d'intégration sur une base simulée.** Un `mock` de Drizzle ne détecte ni une contrainte d'unicité absente, ni une transaction mal fermée, ni un index manquant. C'est précisément ce qu'on cherche à vérifier.

---

## 4. Tests unitaires — domaine pur

### 4.1 `lib/scoring` — couverture 100 % des branches, exigée

| # | Cas | Attendu |
|---|---|---|
| SC-01 | 1ᵉʳ essai, 0 indice | 100 |
| SC-02 | 2ᵉ essai, 0 indice | 80 |
| SC-03 | 3ᵉ essai, 0 indice | 60 |
| SC-04 | 2ᵉ essai, 1 indice | 70 |
| SC-05 | 3ᵉ essai, 2 indices | 40 |
| SC-06 | échec après 3 essais | 0 |
| SC-07 | 1ᵉʳ essai, 1 indice demandé avant réponse | 90 |
| SC-08 | 10 indices (cas absurde) | 0, **jamais négatif** |
| SC-09 | score partiel, 3 étapes sur 4 justes, poids égaux | 75, puis plafonné par le n° d'essai |
| SC-10 | exercice sans étapes, réponse partielle | binaire — 0 ou plein score, **pas de score partiel** |
| SC-11 | **propriété** : `0 ≤ score ≤ 100` sur 1 000 entrées aléatoires | toujours vrai |
| SC-12 | **propriété** : monotonie — plus d'indices ⇒ score ≤ | toujours vrai |
| SC-13 | **propriété** : déterminisme — même entrée, 100 appels | résultat identique |

### 4.2 `lib/mastery`

| # | Cas | Attendu |
|---|---|---|
| MA-01 | taux 80 %, 2 mesures | `mastered` (borne incluse) |
| MA-02 | taux 79,9 %, 5 mesures | `fragile` |
| MA-03 | taux 50 %, 4 mesures | `fragile` (borne incluse) |
| MA-04 | taux 49,9 %, 4 mesures | `not_mastered` |
| MA-05 | taux 100 %, **1 seule** mesure | `not_evaluated` — **jamais `mastered`** |
| MA-06 | taux 0 %, 1 mesure | `not_mastered` (une erreur est informative) |
| MA-07 | 0 mesure | `not_evaluated` |
| MA-08 | 15 mesures : 5 mauvaises anciennes, 10 bonnes récentes | fenêtre glissante ⇒ `mastered` |
| MA-09 | recalcul complet depuis l'historique brut | identique à l'état incrémental |

MA-09 est essentiel : il prouve que `student_skill_levels` est bien une table **dérivée et reconstructible**.

### 4.3 `lib/revision`

| # | Cas | Attendu |
|---|---|---|
| RV-01 | première programmation | J+1 |
| RV-02 | réussite à l'index 0 | index 1, J+3 |
| RV-03 | réussite à l'index 3 | index 4, J+30 |
| RV-04 | réussite à l'index 4 | reste à 4 (plafond) |
| RV-05 | échec à l'index 2 | index 1, J+3 |
| RV-06 | échec à l'index 0 | reste à 0, J+1 |
| RV-07 | **2 échecs consécutifs** | index 0 **et** retour à la leçon injecté |
| RV-08 | **3 réussites consécutives** au dernier index | consolidé |
| RV-09 | révision manquée de 5 jours | replanifiée, **l'intervalle n'avance pas** |
| RV-10 | 10 révisions dues, 60 min disponibles | plafonnement, priorité aux retards |
| RV-11 | **propriété** : aucune date passée n'est produite | toujours vrai |
| RV-12 | **propriété** : déterminisme avec date injectée | toujours vrai |
| RV-13 | **la fonction n'appelle jamais `new Date()` en interne** | vérifié par revue + horloge figée |

RV-13 conditionne tous les autres : sans injection de la date, tester « J+30 » exige d'attendre trente jours.

### 4.4 `lib/validation`

Chaque schéma Zod est testé sur : entrée valide · champ manquant · type incorrect · dépassement de longueur · injection dans une chaîne · UUID malformé · valeur d'énumération inconnue.

---

## 5. Tests d'intégration — base de données réelle

| # | Domaine | Vérifie |
|---|---|---|
| IT-01 | Contraintes | `unique(student, exercise_version, attempt_number)` rejette bien le doublon |
| IT-02 | Contraintes | `unique(student, skill, category)` sur `error_logs` |
| IT-03 | Contraintes | index partiel : une seule révision `scheduled` par cible |
| IT-04 | Contraintes | `check(parent_user_id <> student_user_id)` |
| IT-05 | Transaction | échec en milieu de soumission ⇒ **aucune** écriture partielle |
| IT-06 | Transaction | clôture de diagnostic : rapport + maîtrise + planning, tout ou rien |
| IT-07 | Idempotence | même clé, deux fois ⇒ une seule ligne, même réponse |
| IT-08 | Idempotence | même clé, contenu différent ⇒ 409 |
| IT-09 | Projection | `getExerciseForStudent` ne sélectionne **pas** `correct_answer` |
| IT-10 | Projection | le rapport parent ne contient aucune réponse brute |
| IT-11 | Suppression | supprimer un exercice ne détruit pas les tentatives passées |
| IT-12 | Migration | migration à blanc puis seed ⇒ schéma conforme |
| IT-13 | Migration | rejouer les migrations est idempotent |
| IT-14 | Seed | `seed:reference` deux fois ⇒ aucun doublon |
| IT-15 | Seed | `seed:demo` refuse de s'exécuter en production |
| IT-16 | Index | `EXPLAIN` sur les 5 requêtes chaudes ⇒ pas de `Seq Scan` sur grande table |
| IT-17 | Connexion | l'application refuse de démarrer avec une `DATABASE_URL` non poolée |
| IT-18 | Connexion | les migrations refusent une URL poolée |
| IT-19 | Résilience | une erreur transitoire simulée est rejouée avec backoff |

---

## 6. Tests d'autorisation — **bloquants**

Les 18 tests T-01 à T-18 de `AUTHORIZATION_MATRIX.md` §9 sont repris intégralement ici, avec deux exigences supplémentaires :

| Exigence | Détail |
|---|---|
| **Couverture exhaustive** | un test générique itère sur **toutes** les Server Actions et **tous** les Route Handlers exportés, et vérifie qu'un appel non authentifié échoue. Une action ajoutée sans garde fait échouer la CI automatiquement. |
| **Test de payload** | T-12 inspecte la **réponse HTTP réelle**, pas le code. Il échoue si `correct_answer`, `solution_markdown`, `hints` non débloqués ou `password_hash` apparaissent dans un corps de réponse destiné à un élève. |

Le test générique est ce qui empêche la dérive : sur un projet de cette taille, une action oubliée arrive tôt ou tard. Mieux vaut que la CI le dise que l'élève curieux.

---

## 7. Tests E2E (Playwright)

| # | Parcours | Points de contrôle |
|---|---|---|
| E2E-01 | Inscription → vérification → onboarding → diagnostic → rapport | 20 questions, reprise possible, statuts corrects |
| E2E-02 | Séance quotidienne complète | planning respecté, temps plafonné |
| E2E-03 | **Correction guidée intégrale** | 3 essais, 2 indices, solution, exercice similaire, erreur enregistrée |
| E2E-04 | **Fuite de solution** | inspection du réseau à chaque étape : aucune solution avant droit acquis |
| E2E-05 | Carnet d'erreurs | 3 occurrences ⇒ statut `recurrent` |
| E2E-06 | Révision J+1 | avec horloge simulée |
| E2E-07 | Invitation parent → acceptation → suivi | double consentement respecté |
| E2E-08 | Révocation du lien parent | accès coupé immédiatement |
| E2E-09 | **Accès croisé parent** | URL forgée d'un autre élève ⇒ 404 |
| E2E-10 | **Hors ligne complet** | 5 exercices hors ligne ⇒ 5 tentatives, 0 doublon |
| E2E-11 | **Coupure pendant la synchronisation** | reprise sans perte ni doublon |
| E2E-12 | **Deux appareils** | conflit détecté, message clair, aucune perte |
| E2E-13 | Réseau dégradé (throttling 3G lent) | l'application reste utilisable, états de chargement corrects |
| E2E-14 | Administration : créer → publier → dépublier | versions correctes, audit renseigné |
| E2E-15 | Accessibilité (axe-core) sur 6 écrans clés | 0 violation critique |

E2E-04 et E2E-10 à E2E-12 sont **les tests qui décident si le produit tient ses deux promesses centrales** : ne pas donner la réponse, ne pas perdre le travail.

---

## 8. Tests de contenu (Content QA)

Automatisables :

| # | Contrôle |
|---|---|
| CQ-01 | Chaque exercice publié possède une `correct_answer` non vide |
| CQ-02 | Chaque exercice publié possède au moins 2 indices |
| CQ-03 | Chaque exercice publié possède une solution détaillée |
| CQ-04 | Aucun indice ne contient littéralement la réponse attendue |
| CQ-05 | Chaque compétence dispose d'au moins 3 exercices publiés |
| CQ-06 | Le diagnostic comporte exactement 20 questions couvrant les 12 compétences |
| CQ-07 | Aucune compétence n'est évaluée par une seule question **et** déclarable `mastered` |
| CQ-08 | Le graphe de prérequis est acyclique |
| CQ-09 | Aucun texte de remplissage (« lorem », « à compléter », « TODO ») dans un contenu publié |
| CQ-10 | Tout contenu publié porte une trace de validation humaine (**OQ-02**) |

Non automatisables — revue humaine obligatoire : exactitude mathématique, absence d'ambiguïté, adéquation de la difficulté, qualité de la progression pédagogique.

**CQ-04 mérite une attention particulière :** un indice qui contient la réponse annule le protocole de correction guidée aussi sûrement qu'une fuite de payload.

---

## 9. Tests de performance et de réseau

| # | Test | Seuil |
|---|---|---|
| PF-01 | Première page utile, 3G lent | < 200 Ko, interactive < 5 s |
| PF-02 | Écran « Aujourd'hui » | < 1,5 s sur 4G |
| PF-03 | Soumission de tentative | retour < 800 ms (hors démarrage à froid Neon) |
| PF-04 | Lot de synchronisation de 50 opérations | < 5 s |
| PF-05 | Requêtes chaudes | aucune requête > 200 ms sur un jeu de données réaliste |
| PF-06 | Démarrage à froid du compute Neon | dégradation gracieuse, jamais d'erreur affichée |

---

## 10. Environnements de test

| Niveau | Base | Isolation |
|---|---|---|
| Unitaire | aucune | néant |
| Composant | aucune | rendu isolé |
| Intégration | PostgreSQL réel — branche Neon éphémère ou conteneur local | **une transaction annulée par test**, ou base recréée par fichier |
| E2E | branche Neon de preview + seed déterministe | base réinitialisée avant chaque exécution |

**Aucun test ne s'exécute contre la production.** Contrôle mécanique : les scripts de test refusent de démarrer si l'URL de base contient l'identifiant de la branche `main`.

---

## 11. Intégration continue

Ordre d'exécution — **du plus rapide au plus lent**, arrêt au premier échec :

```
1. Lint + format + typage TypeScript strict     (~1 min)
2. Tests unitaires                              (~2 min)
3. Scan de secrets + npm audit                  (~1 min)
4. Vérification du bundle client (aucun secret) (~1 min)
5. Migrations à blanc + seed                    (~2 min)
6. Tests d'intégration (PostgreSQL réel)        (~5 min)
7. TESTS D'AUTORISATION                         (~3 min)  ← bloquant absolu
8. Build de production                          (~3 min)
9. Tests E2E                                    (~10 min)
10. Accessibilité                               (~2 min)
```

Règles :
- **Aucune fusion** si une étape échoue.
- **Aucune désactivation de test** sans une entrée dans `DECISIONS.md` et une date de réactivation.
- Un test instable (*flaky*) est traité comme un bug, pas mis en quarantaine indéfiniment.

---

## 12. Définition de « terminé »

Une fonctionnalité est terminée quand **tous** ces points sont satisfaits :

| # | Critère |
|---|---|
| 1 | Les critères d'acceptation de la user story sont vérifiés |
| 2 | Tests unitaires écrits et passants |
| 3 | Tests d'intégration écrits et passants |
| 4 | Tests d'autorisation écrits et passants |
| 5 | Test E2E si la fonctionnalité est un parcours utilisateur |
| 6 | Aucune régression sur la suite existante |
| 7 | Lint, format et typage sans erreur |
| 8 | Documentation à jour |
| 9 | **Sortie de test réelle produite dans le rapport de phase** |
| 10 | Revue croisée effectuée par les agents concernés |

Le point 9 est ce qui distingue un rapport honnête d'une déclaration d'intention.

---

## 13. Gestion des anomalies

| Gravité | Définition | Traitement |
|---|---|---|
| **Critique** | perte de données · fuite entre comptes · fuite de solution · impossibilité de se connecter | correction immédiate, **bloque toute livraison** |
| **Majeure** | fonctionnalité centrale inutilisable · score faux · révision perdue | corrigée avant la fin de la phase |
| **Mineure** | défaut d'affichage · libellé · cas limite rare | inscrite au backlog |
| **Cosmétique** | alignement, espacement | inscrite au backlog |

**Aucune anomalie critique ou majeure ne reste ouverte au moment de la mise en service** (Phase 15).

Toute correction s'accompagne d'un test de non-régression qui **échouait avant** le correctif. Une correction sans ce test n'est pas acceptée en revue : rien ne prouve alors qu'elle corrige quoi que ce soit.

---

## 14. État actuel

| Élément | État |
|---|---|
| Stratégie définie | ✅ ce document |
| Outillage installé | ❌ aucun (`package.json` inexistant) |
| Tests écrits | ❌ **zéro** |
| CI configurée | ❌ aucune (`.github/` inexistant) |
| Couverture | ❌ sans objet |

**Aucun test n'a été exécuté. Aucun résultat de test n'est revendiqué dans ce document.**
