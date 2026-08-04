# Savoir+ — Backlog priorisé

> Agent responsable : **Product Manager**
> Contributeurs : Software Architect, Neon Database Architect, QA Engineer
> Version : 0.1.0 — 2026-08-03

**Aucune estimation en jours n'est fournie.** Le rythme de l'équipe est inconnu et un chiffre inventé serait un engagement sans fondement. Les tailles sont relatives : **XS · S · M · L · XL**.

Priorités : **P0** = MVP bloquant · **P1** = MVP souhaitable · **P2** = post-MVP.

---

## Lot 0 — Fondations (Phase 2)

> **Rien ne commence avant que OQ-01 ne soit tranchée.**

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| F-01 | **Créer `.gitignore`** (`node_modules`, `.env*`, `.next`, artefacts de build) | **P0** | XS | — | `git status` propre après `npm install` |
| F-02 | Initialiser le projet Next.js (App Router, TypeScript **strict**) | P0 | S | OQ-01, F-01 | `tsc --noEmit` sans erreur |
| F-03 | Tailwind CSS + shadcn/ui + tokens de couleur Savoir+ | P0 | S | F-02 | page de démonstration des tokens |
| F-04 | ESLint + Prettier + **règles de frontière de modules** | P0 | S | F-02 | un import interdit fait échouer le lint |
| F-05 | Vitest + React Testing Library + Playwright | P0 | M | F-02 | un test factice passe à chaque niveau |
| F-06 | CI GitHub Actions (10 étapes de `TEST_STRATEGY.md` §11) | P0 | M | F-04, F-05 | pipeline vert sur une PR vide |
| F-07 | Scan de secrets + vérification du bundle client | P0 | S | F-06 | un secret injecté volontairement fait échouer la CI |
| F-08 | Squelette PWA (manifest, service worker, icônes) | P1 | S | F-02 | installable sur Android |

---

## Lot 1 — Base de données (Phase 2)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| D-01 | Schéma Drizzle — authentification et profils (8 tables) | P0 | M | F-02 | `tsc` OK, schéma généré |
| D-02 | Schéma Drizzle — pédagogie (10 tables) | P0 | L | D-01 | — |
| D-03 | Schéma Drizzle — diagnostic (5 tables) | P0 | M | D-02 | — |
| D-04 | Schéma Drizzle — progression (9 tables) | P0 | L | D-02 | — |
| D-05 | Schéma Drizzle — technique (5 tables) | P0 | M | D-01 | — |
| D-06 | Migration initiale + index + contraintes | P0 | M | D-01→05 | migration exécutée sur une branche Neon |
| D-07 | Clients Drizzle poolé / direct + **garde-fou de connexion** | P0 | S | D-06 | IT-17, IT-18 passants |
| D-08 | Retry avec backoff sur erreurs transitoires | P0 | S | D-07 | IT-19 passant |
| D-09 | `seed:reference` (3 chapitres, 12 compétences, 12 leçons, 45 exercices, 20 questions, 3 évaluations) | P0 | **XL** | D-06, contenu validé | IT-14, CQ-01→10 |
| D-10 | `seed:demo` (Anderson + progression) | P1 | M | D-09 | IT-15 (refus en production) |
| D-11 | Tests d'intégration des contraintes (IT-01→04) | P0 | M | D-06 | 4 tests passants |
| D-12 | Script `recompute-mastery` | P1 | M | D-04 | MA-09 passant |
| D-13 | Procédure de sauvegarde et restauration + **test de restauration** | P0 | M | D-06 | restauration effectuée et vérifiée |

> **D-09 est l'élément le plus lourd du backlog et le plus souvent sous-estimé.** Produire 45 exercices avec énoncé, réponse, 2 indices et solution détaillée, tous vérifiés mathématiquement, est un travail humain conséquent (R-J04).

---

## Lot 2 — Authentification et autorisation (Phase 3)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| A-01 | Auth.js + adaptateur Drizzle + sessions **en base** | P0 | M | D-01 | connexion fonctionnelle |
| A-02 | Inscription e-mail/mot de passe (Argon2id) | P0 | M | A-01 | US-AUTH-01 CA1→6 |
| A-03 | Vérification d'e-mail (jeton haché, usage unique, expiration) | P0 | M | A-02, OQ-08 | US-AUTH-02 |
| A-04 | Récupération de mot de passe + révocation totale des sessions | P0 | M | A-03 | US-AUTH-03 |
| A-05 | Magic link | P1 | S | A-03 | — |
| A-06 | **Gardes d'autorisation** (9 gardes de `AUTHORIZATION_MATRIX.md` §5) | **P0** | L | A-01 | toutes testées unitairement |
| A-07 | Test générique « toute action possède une garde » | **P0** | M | A-06 | une action sans garde fait échouer la CI |
| A-08 | Invitation parent-enfant (code haché, double consentement, expiration) | P0 | L | A-06 | US-AUTH-04 |
| A-09 | Révocation de lien | P0 | S | A-08 | E2E-08 |
| A-10 | **Les 18 tests d'autorisation T-01→T-18** | **P0** | L | A-06, A-08 | **18/18 passants — bloquant absolu** |
| A-11 | Limitation de débit (connexion, réinitialisation) | P0 | M | A-02 | test de dépassement |
| A-12 | `audit_logs` sur les actions sensibles | P0 | M | A-06 | T-17 |

---

## Lot 3 — Fondations frontend (Phase 4)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| U-01 | Design system : tokens, typographie, composants de base | P0 | L | F-03 | catalogue de composants |
| U-02 | Layout mobile-first + navigation (élève, parent, admin) | P0 | M | U-01 | aucune impasse de navigation |
| U-03 | Formulaires (React Hook Form + Zod, schémas partagés) | P0 | M | U-01 | erreurs annoncées aux lecteurs d'écran |
| U-04 | Les **5 états** par écran (chargement, vide, erreur, hors ligne, nominal) | P0 | M | U-02 | revue écran par écran |
| U-05 | Mode sombre | P1 | S | U-01 | contrastes vérifiés |
| U-06 | Contrôle d'accessibilité (axe-core en CI) | P0 | M | U-02 | 0 violation critique |

---

## Lot 4 — Diagnostic (Phase 5)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| G-01 | `lib/mastery` — statuts et seuils (fonctions pures) | P0 | M | — | MA-01→09 passants |
| G-02 | Service de diagnostic + sauvegarde progressive | P0 | L | D-03, A-06 | reprise après coupure |
| G-03 | Écran de passation (20 questions) | P0 | M | U-03, G-02 | US-DIAG-01 |
| G-04 | **Aucune réponse correcte dans le payload** | **P0** | M | G-02 | IT-09, T-12 |
| G-05 | Calcul du rapport par compétence | P0 | M | G-01, G-02 | scores reproductibles |
| G-06 | Écran de rapport | P0 | M | G-05, U-01 | US-DIAG-02 |
| G-07 | Génération du plan initial | P0 | L | G-05 | respecte `daily_minutes` |

---

## Lot 5 — Cours et exercices (Phase 6)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| L-01 | Consultation des leçons (7 blocs) | P0 | M | D-02, U-02 | US-LESSON-01 |
| L-02 | Rendu des expressions mathématiques | P0 | M | OQ-09 | lisible à 360 px |
| L-03 | Présentation d'un exercice | P0 | M | L-01 | US-EX-01 |
| L-04 | Soumission de tentative (transaction complète) | P0 | L | D-02, A-06 | IT-05 |
| L-05 | Fiches de révision hors ligne | P1 | S | L-01 | consultable sans réseau |

---

## Lot 6 — Correction guidée (Phase 7)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| C-01 | `lib/scoring` (fonctions pures) | **P0** | M | — | SC-01→13, **100 % des branches** |
| C-02 | Protocole en 9 étapes, **verrouillé serveur** | **P0** | L | C-01, L-04 | E2E-03 |
| C-03 | Gardes `requireHintUnlocked` / `requireSolutionUnlocked` | **P0** | M | A-06 | T-10, T-11 |
| C-04 | **Test de fuite de payload** | **P0** | M | C-02 | E2E-04 |
| C-05 | Interface d'indices gradués | P0 | M | C-02, U-01 | pénalité affichée avant confirmation |
| C-06 | Solution détaillée + exercice similaire | P0 | M | C-02 | — |
| C-07 | Abandon explicite | P0 | S | C-02 | conséquence annoncée avant |
| C-08 | Score partiel par étapes | P1 | M | C-01 | SC-09, SC-10 |

---

## Lot 7 — Carnet d'erreurs (Phase 8)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| E-01 | Catégorisation serveur (10 catégories) | P0 | L | C-02 | attribution déterministe |
| E-02 | Enregistrement avec incrémentation d'occurrence | P0 | M | E-01, D-04 | IT-02 |
| E-03 | Passage à `recurrent` au seuil de 3 | P0 | S | E-02 | E2E-05 |
| E-04 | Résolution après 3 réussites consécutives | P1 | M | E-02 | — |
| E-05 | Écran « Mes erreurs » | P0 | M | E-02, U-01 | US-ERR-01 |

---

## Lot 8 — Répétition espacée (Phase 9)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| R-01 | `lib/revision` — calendrier (**date injectée**) | **P0** | M | — | RV-01→13 |
| R-02 | Programmation et replanification | P0 | L | R-01, D-04 | IT-03 (aucune duplication) |
| R-03 | Génération de la séance quotidienne (plafonnée) | P0 | L | R-02 | RV-10 |
| R-04 | Écran « Aujourd'hui » | **P0** | M | R-03, U-02 | une action principale |
| R-05 | Retour à la leçon après 2 échecs | P0 | S | R-01 | RV-07 |

---

## Lot 9 — Hors ligne et synchronisation (Phase 10)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| O-01 | Couche IndexedDB (8 magasins) | P0 | L | F-08 | écriture/lecture testées |
| O-02 | File d'opérations (modèle complet) | **P0** | L | O-01 | modèle conforme à `OFFLINE_SYNC.md` §4 |
| O-03 | Moteur de synchronisation client (backoff, jitter, lots) | P0 | L | O-02 | reprise après coupure |
| O-04 | `POST /api/sync` (1 transaction par opération) | **P0** | L | O-02, A-06 | statut par opération |
| O-05 | `idempotency_records` + double barrière | **P0** | M | O-04 | IT-07, IT-08 |
| O-06 | `assertNoCrossUser` | **P0** | S | O-04 | T-13 |
| O-07 | Résolution des conflits C1→C7 | P0 | L | O-04 | E2E-12 |
| O-08 | États hors ligne dans l'interface | P0 | M | O-03, U-04 | messages en langage clair |
| O-09 | **Les 7 garanties** de `OFFLINE_SYNC.md` §8 | **P0** | L | O-01→08 | E2E-10, E2E-11, E2E-12 |
| O-10 | Gestion des quotas de stockage | P1 | M | O-01 | la file n'est jamais purgée |

---

## Lot 10 — Progression (Phase 11)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| P-01 | Agrégats de progression (8 indicateurs) | P1 | L | D-04 | calculs exacts |
| P-02 | Écran de progression + graphiques simples | P1 | M | P-01, U-01 | US-PROG-01 |
| P-03 | Calcul de régularité | P1 | S | P-01 | — |

---

## Lot 11 — Espace parent (Phase 12)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| PA-01 | Liste des enfants liés (`active` uniquement) | P0 | S | A-08 | T-03→05 |
| PA-02 | Tableau de bord parent (agrégats) | P0 | M | P-01, PA-01 | US-PARENT-01 |
| PA-03 | Génération du rapport hebdomadaire | P1 | L | P-01 | unicité par semaine |
| PA-04 | **Aucune donnée brute exposée** | **P0** | M | PA-02 | IT-10 |
| PA-05 | Test d'accès croisé parent | **P0** | M | PA-01 | E2E-09 |

---

## Lot 12 — Stockage R2 (Phase 13)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| S-01 | Service R2 + URLs présignées | P1 | M | A-06 | bucket privé vérifié |
| S-02 | Contrôle MIME sur octets réels + plafond de taille | P1 | M | S-01 | upload malveillant rejeté |
| S-03 | Convention de clés + `file_assets` | P1 | S | S-01 | aucun nom de fichier utilisateur |
| S-04 | CORS restreint | P1 | XS | S-01 | pas de `*` |
| S-05 | Suppression logique + purge des orphelins | P2 | M | S-03 | — |

---

## Lot 13 — Administration (Phase 14)

| # | Élément | Prio | Taille | Dépend de | Porte de sortie |
|---|---|:--:|:--:|---|---|
| AD-01 | CRUD chapitres / compétences | P1 | L | A-06 | permissions vérifiées |
| AD-02 | CRUD leçons / exercices avec versions | P1 | XL | AD-01, D-02 | ADR-004 respecté |
| AD-03 | Publication et dépublication | P1 | M | AD-02 | E2E-14 |
| AD-04 | Confirmation explicite de suppression | P1 | S | AD-02 | — |
| AD-05 | Consultation du journal d'audit | P1 | M | A-12 | lecture seule |
| AD-06 | Statistiques agrégées | P2 | M | P-01 | — |

---

## Lot 14 — Durcissement et déploiement (Phases 15-16)

| # | Élément | Prio | Taille | Porte de sortie |
|---|---|:--:|:--:|---|
| X-01 | Suite E2E complète (15 parcours) | **P0** | XL | 15/15 passants |
| X-02 | Tests de réseau dégradé | P0 | M | E2E-13 |
| X-03 | Audit de sécurité complet | **P0** | L | rapport `SECURITY.md` §8 renseigné |
| X-04 | En-têtes HTTP de sécurité | P0 | S | vérifiés en production |
| X-05 | Environnements dev / preview / staging / production | P0 | L | branches Neon par environnement |
| X-06 | Procédure de migration en production + vérification post-déploiement | **P0** | M | testée sur staging |
| X-07 | Procédure de retour arrière | **P0** | M | testée réellement |
| X-08 | Supervision et alertes | P1 | M | OQ-07 |
| X-09 | Documentation (README, guides développeur et administrateur) | P0 | L | un tiers réussit l'installation |
| X-10 | **Zéro anomalie critique ou majeure ouverte** | **P0** | — | condition de mise en service |

---

## Ordonnancement conseillé

```
OQ-01 tranchée ──► Lot 0 ──► Lot 1 ──► Lot 2 ──► Lot 3
                                   (autorisation d'abord :
                                    tout le reste s'appuie dessus)
                                          │
        ┌─────────────────────────────────┼─────────────────┐
        ▼                                 ▼                 ▼
   Lot 4 (diagnostic)          Lot 9 (hors ligne)     Lot 12 (R2)
        │                                 │
        ▼                                 │
   Lot 5 (cours) ──► Lot 6 (correction) ──┤
                            │             │
                            ▼             ▼
                     Lot 7 (erreurs) ──► Lot 8 (révision)
                                          │
                            ┌─────────────┴──────────┐
                            ▼                        ▼
                     Lot 10 (progression)      Lot 13 (admin)
                            │
                            ▼
                     Lot 11 (parent)
                            │
                            ▼
                     Lot 14 (durcissement, déploiement)
```

**Deux règles d'ordonnancement :**

1. **Le Lot 2 (autorisation) précède tout développement fonctionnel.** Ajouter les gardes après coup garantit d'en oublier.
2. **Le Lot 9 (hors ligne) démarre tôt, en parallèle.** Rétrofitter une file d'opérations sur des écritures directes est une réécriture, pas un ajout.

---

## Hors périmètre — non planifié

Physique-Chimie · SVT · Première · Terminale · compte enseignant · classe virtuelle · paiement · abonnement · réseau social · messagerie · visioconférence · reconnaissance de copie manuscrite · chatbot génératif · application Android native · préparation complète au baccalauréat · notifications push · Google Sign-In · upload de photo de copie par l'élève.

Toute demande d'ajout d'un de ces éléments exige une entrée dans `DECISIONS.md` **avant** la moindre ligne de code.
