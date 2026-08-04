# Savoir+ — Journal des modifications

> Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
> Versionnage sémantique. Le produit n'est pas encore publié : la version reste en `0.x`.

---

## [Non publié]

### 0.2.0 — 2026-08-04 — Phase 2 (partielle) : fondations, schéma, domaine pur

**Portée :** outillage, schéma de données et domaine pur. **Aucune page, aucun écran, aucun contenu pédagogique.**

#### Décidé

- **OQ-01 tranchée de fait.** L'accès de la session est limité au dépôt `nwodobe/fbms` : l'option A (dépôt dédié) n'est pas exécutable. Retenu : **option B**, répertoire isolé `savoir-plus/`, qui préserve intégralement le déploiement GitHub Pages de FBMS. ADR-001 mis à jour en conséquence.

#### Ajouté — Lot 0, fondations

| Élément | Détail |
|---|---|
| `.gitignore` **(F-01)** | créé **avant** toute installation de dépendance. Couvre `.env*`, `node_modules/`, `.next/`, artefacts. |
| `savoir-plus/package.json` **(F-02)** | Next.js 16, React 19, Drizzle, Zod, Vitest. Script `verify` = typage + lint + tests. |
| `tsconfig.json` | TypeScript **strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. |
| `eslint.config.mjs` **(F-04)** | **frontières de modules appliquées mécaniquement** : domaine pur sans dépendance, UI sans accès base ni scoring, repositories sans remontée vers les services. |
| `vitest.config.mts` **(F-05)** | seuil de couverture **100 % des branches** sur `lib/{scoring,mastery,revision}`. |
| `.github/workflows/savoir-plus-ci.yml` **(F-06)** | CI filtrée par chemin (FBMS ne la déclenche pas) : typage → lint → format → couverture → audit → secrets → **dérive de migration** → **refus de migration destructive**. |
| `.env.example` | 10 variables documentées. Une seule `NEXT_PUBLIC_`. |

#### Ajouté — Lot 1, base de données

- **Schéma Drizzle complet : 37 tables**, 22 types énumérés, réparties en 5 modules (`auth`, `pedagogy`, `diagnostic`, `progress`, `technical`).
- **Migration initiale générée** : `drizzle/migrations/0000_initial_schema.sql` — 641 lignes, 60 index, 54 clés étrangères, 32 contraintes `CHECK`, **0 instruction destructive**.
- Les garanties du modèle sont portées **par la base**, pas seulement par le code :
  - `student_skill_levels_mastery_requires_two_measures_ck` — une compétence mesurée moins de 2 fois ne peut jamais être `mastered` ;
  - `error_logs_recurrent_threshold_ck` — seuil strict de 3 occurrences ;
  - `exercise_attempts_unique_try_uq` — anti-doublon structurel de la synchronisation ;
  - `revision_plans_one_active_uq` (index partiel) — aucune duplication de révision ;
  - `diagnostic_answers_attempt_question_uq` — sauvegarde progressive idempotente ;
  - `parent_student_links_parent_active_idx` (index partiel) — requête d'autorisation parent.
- **Garde-fou de connexion** (`connection-guard.ts`, ADR-008) : l'application refuse une `DATABASE_URL` non poolée, les migrations refusent une URL poolée, et un garde refuse d'opérer sur la production.

#### Ajouté — domaine pur

| Module | Contenu |
|---|---|
| `lib/scoring` | score de tentative, score partiel pondéré, **verrouillage de la solution et des indices** |
| `lib/mastery` | seuils 80/50, fenêtre glissante de 10 mesures, recalcul intégral reconstructible |
| `lib/revision` | calendrier J+1/3/7/14/30, progression et régression, composition de séance plafonnée |

#### Tests exécutés

```
Test Files  5 passed (5)
     Tests  163 passed (163)

Couverture du domaine pur :
  Statements 100 % · Branches 100 % · Functions 100 % · Lines 100 %
```

Dont **22 tests des frontières d'architecture** : ils lintent des extraits qui doivent être refusés, et testent donc les règles elles-mêmes.

#### Corrigé

- **Régression réelle détectée par ces tests** : le motif ESLint `@/lib/scoring/*` ne couvrait pas l'import du module racine `@/lib/scoring`, laissant passer une violation de l'ADR-005 (scoring appelé depuis l'UI). Les trois frontières ont été corrigées pour couvrir la forme racine **et** les sous-modules, et la vérification est devenue un test permanent.
- **4 vulnérabilités de gravité haute ou critique** dans les versions initialement retenues, dont **une injection SQL dans `drizzle-orm` < 0.45.2** (GHSA-gpj5-g38j-94v9) — directement liée au risque R-S08. Versions relevées : `drizzle-orm` 0.45.2, `next` 16.3.0, `vitest` 4.1.10, `eslint` 10. **Zéro vulnérabilité haute ou critique restante.**

#### Non fait — volontairement

Aucune page, aucun composant, aucun écran · aucun contenu pédagogique (bloqué par **OQ-02** et **OQ-03**) · aucun seed · aucune Server Action · aucun service · aucune migration exécutée contre une base réelle (aucun projet Neon n'existe — voir OQ-06).

#### Vérifié contre une base Neon réelle

Voir `docs/PHASE2_DB_VERIFICATION.md` pour le détail.

- Projet Neon `autumn-heart-85786511` créé ; migration appliquée sur la branche **`preview/initial-schema`**, jamais directement sur `main` (règle `ARCHITECTURE.md` §6.4).
- **Inventaire du schéma déployé conforme** : 37 tables, 22 enums, 54 clés étrangères, 32 contraintes `CHECK`, 5 index partiels.
- **7 contraintes métier éprouvées par des écritures réellement refusées** : anti-doublon de synchronisation · maîtrise impossible sous 2 mesures · seuil strict de récurrence à 3 · unicité d'e-mail insensible à la casse · unicité de révision active (y compris avec `error_log_id` à `NULL`) · auto-lien parent-enfant impossible · minimum de 2 indices sur un contenu publié.
- Vérification complémentaire : une révision `done` **ne bloque pas** la programmation de la suivante — l'index partiel interdit le doublon sans casser le cycle de répétition espacée.
- Garde-fou ADR-008 éprouvé sur de vraies chaînes Neon : les quatre cas (accepter/refuser, poolée/directe) se comportent comme spécifié.

#### Ajouté — transport de migration de repli

Le proxy sortant du bac à sable refuse toute connexion vers `*.neon.tech` (403 sur le tunnel `CONNECT`), WebSocket comme HTTPS. `scripts/maintenance/migrate.ts` accepte désormais `NEON_MIGRATION_TRANSPORT=http|websocket`. Le mode HTTP est documenté comme **dégradé** : sans session PostgreSQL il n'y a pas de transaction englobante, donc un échec à mi-parcours laisse un schéma partiellement migré. WebSocket reste le défaut.

#### Reste à faire

- **`main` n'est pas migrée.** Seule la branche de preview porte le schéma. À promouvoir par `npm run db:migrate` depuis un environnement disposant d'un accès réseau à Neon.
- **ADR-014 non éprouvé** : la clé étrangère `ON DELETE restrict` protégeant les tentatives d'élève est présente dans le schéma déployé, mais n'a pas été testée par une suppression réelle — cela exigerait un `DELETE`, que je n'exécute pas de ma propre initiative.

#### Reste bloquant

**OQ-02** (validation du programme ivoirien) et **OQ-03** (production des 45 exercices) — tous deux hors du champ du code.

---

### 0.1.0 — 2026-08-03 — Phase 0 : inspection et cadrage documentaire

**Portée :** documentation uniquement. **Aucun code applicatif, aucune migration, aucune dépendance n'a été ajoutée.**

#### Ajouté

| Document | Agent responsable | Contenu |
|---|---|---|
| `docs/PHASE0_INSPECTION.md` | Software Architect, DevOps, Security | état des lieux factuel du dépôt · 8 incompatibilités identifiées · 4 observations de sécurité sur l'existant |
| `docs/PRODUCT_BRIEF.md` | Product Manager | vision · 3 personas · jobs-to-be-done · périmètre et hors-périmètre · 20 user stories avec critères d'acceptation testables · indicateurs de succès |
| `docs/ARCHITECTURE.md` | Software Architect | 8 principes directeurs · vue en couches · frontières de modules · flux de la soumission de tentative · stratégies Neon, Auth, R2, erreurs, cache, observabilité |
| `docs/DATA_MODEL.md` | Neon Database Architect | 37 tables · conventions · index justifiés · transactions obligatoires · liste des données interdites au navigateur · ERD · stratégie de migration et de seed |
| `docs/PEDAGOGY.md` | Expert pédagogique | **avertissement de non-validation du programme ivoirien** · 12 compétences et graphe de prérequis · règles de diagnostic, de scoring, de maîtrise · 10 catégories d'erreurs · protocole de correction en 9 étapes · répétition espacée |
| `docs/UX_FLOWS.md` | UX Researcher, UI Designer | contraintes d'usage réel · arborescence · parcours élève et parent · comportement hors ligne · 10 points de friction · design system · accessibilité |
| `docs/AUTHORIZATION_MATRIX.md` | Auth & Authz Engineer | distinction authentification/autorisation · 6 contrôles obligatoires · matrice complète par rôle et ressource · 9 gardes serveur · 18 tests d'autorisation bloquants · procédure de révocation |
| `docs/SECURITY.md` | Security Engineer | threat model STRIDE · 7 actifs · 5 acteurs de menace · 12 risques cotés · mesures par domaine · checklist OWASP · protection des mineurs · réponse à incident |
| `docs/OFFLINE_SYNC.md` | Offline & Sync Engineer | 6 principes · 8 magasins IndexedDB · modèle d'opération complet · moteur de synchronisation · 7 cas de conflit · 7 garanties avec preuves exigées |
| `docs/TEST_STRATEGY.md` | QA Engineer | pyramide de tests · outillage · ~250 tests unitaires détaillés · 19 tests d'intégration · 15 parcours E2E · 10 contrôles de contenu · CI en 10 étapes · définition de « terminé » |
| `docs/DECISIONS.md` | Software Architect | 14 ADR proposés · 5 décisions en attente |
| `docs/RISKS.md` | tous | 7 risques produit · 7 pédagogiques · 11 techniques · 5 sécurité · 4 conformité · 5 projet · top 5 prioritaire |
| `docs/BACKLOG.md` | Product Manager | 14 lots · ~110 éléments priorisés avec dépendances et portes de sortie · ordonnancement conseillé |
| `docs/OPEN_QUESTIONS.md` | Product Manager | 3 questions bloquantes · 5 importantes · 4 à trancher · 6 mineures · comportement par défaut pour chacune |
| `docs/CHANGELOG.md` | Technical Writer | ce document |

#### Constaté

- Le dépôt `nwodobe/fbms` héberge **ANAGROCI FBMS**, application agro-industrielle statique (HTML/JS + Supabase, GitHub Pages), sans lien avec Savoir+.
- Aucun `package.json`, aucun build, aucun test, aucune CI, **aucun `.gitignore`**.
- Aucun secret privé committé. La clé publique Supabase présente est publiable par conception (sécurité portée par la RLS).
- La stack imposée pour Savoir+ (Next.js, Neon, Drizzle, Auth.js, R2) est **incompatible** avec l'existant. Trois incompatibilités critiques : produit différent, base différente, conflit de racine de déploiement.

#### Décidé (proposé, non ratifié)

14 ADR, dont : sessions Auth.js **en base de données** et non JWT (révocation immédiate exigée) · contenu **versionné** · scoring **exclusivement serveur** · idempotence par clé générée à la **création de l'intention** · autorisation à **double barrière** (absence de RLS sur Neon) · **404 plutôt que 403** sur les ressources d'autrui · une transaction **par opération** de synchronisation.

#### Non fait — volontairement

Conformément à la consigne « ne commence pas le développement métier » :

- aucune page, aucun composant, aucun écran ;
- aucun schéma Drizzle, aucune migration, aucun seed ;
- aucune Server Action, aucun Route Handler, aucun service ;
- aucune installation de dépendance ;
- aucun diagnostic, cours, exercice, carnet d'erreurs ni tableau de bord.

#### Bloquant

Trois décisions humaines sont requises avant la Phase 1 :

| # | Question |
|---|---|
| **OQ-01** | Où vit le code de Savoir+ : dépôt dédié (recommandé) ou sous-répertoire de `fbms` ? |
| **OQ-02** | Qui valide la conformité du contenu au programme ivoirien de Seconde C ? |
| **OQ-03** | Qui produit et vérifie les 45 exercices du MVP ? |

---

## Conventions de ce journal

- Une entrée par phase livrée.
- Sections : `Ajouté` · `Modifié` · `Corrigé` · `Supprimé` · `Sécurité` · `Migrations` · `Non fait`.
- Toute migration de base de données est listée explicitement avec son identifiant.
- Toute décision d'architecture renvoie à son ADR.
- **Aucune fonctionnalité n'est inscrite comme livrée sans la preuve de test correspondante** dans le rapport de phase.
