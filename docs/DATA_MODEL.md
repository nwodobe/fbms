# Savoir+ — Modèle de données

> Agent responsable : **Neon Database Architect**
> Contributeurs : Backend Engineer, Security Engineer, Software Architect
> Statut : **PROPOSITION** — aucun schéma Drizzle, aucune migration n'a été écrite
> Version : 0.1.0 — 2026-08-03

---

## 1. Conventions générales

| Règle | Détail |
|---|---|
| Clé primaire | `uuid` (`gen_random_uuid()`, extension `pgcrypto`) pour toutes les tables métier. Exception : tables Auth.js, qui suivent le format imposé par l'adaptateur. |
| Horodatage | `created_at timestamptz not null default now()` et `updated_at timestamptz not null default now()` sur toute table modifiable. `updated_at` est maintenu par déclencheur, pas par l'application. |
| Fuseau | `timestamptz` **partout**. Jamais `timestamp` sans fuseau : un élève ivoirien (UTC+0) et un serveur en UTC doivent produire le même « J+1 ». |
| Nommage | tables au pluriel, colonnes en `snake_case`, clés étrangères `<entité>_id`. |
| Énumérations | types PostgreSQL `enum` pour les valeurs stables (rôles, statuts), `text` + contrainte `check` pour les valeurs susceptibles d'évoluer. |
| Suppression | **jamais de `on delete cascade` sur une donnée pédagogique produite par un élève.** Une tentative survit à la suppression d'un exercice. |
| Argent / notes | `numeric`, jamais `float`. Les scores sont des entiers 0–100. |
| Soft delete | `status` explicite plutôt que `deleted_at` implicite, pour rendre l'état lisible. |

---

## 2. Modèle conceptuel

```
                    ┌──────────┐
                    │  users   │ role: student | parent | admin
                    └────┬─────┘
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
  ┌───────────────┐ ┌──────────┐ ┌───────────────┐
  │student_profile│ │ profiles │ │ parent_profile│
  └───────┬───────┘ └──────────┘ └───────┬───────┘
          │                              │
          │      ┌───────────────────────┘
          │      ▼
          │  ┌────────────────────┐
          └─►│parent_student_links│ status: pending|active|revoked
             └────────────────────┘

  RÉFÉRENTIEL PÉDAGOGIQUE (produit par admin, versionné)
  subjects ──< chapters ──< skills ──< lessons ──< lesson_versions
                              │
                              ├──< exercises ──< exercise_versions
                              │        └──< exercise_steps
                              │
                              └──< diagnostic_questions >── diagnostic_tests
                                                              └──< diagnostic_test_versions

  PRODUCTION DE L'ÉLÈVE (immuable une fois écrite)
  student ──< diagnostic_attempts ──< diagnostic_answers
          ──< exercise_attempts ──< exercise_attempt_steps
          ──< error_logs
          ──< student_skill_levels        (état courant, recalculé)
          ──< revision_plans ──< revision_sessions ──< revision_session_items
          ──< assessment_attempts >── assessments ──< assessment_questions
          ──< weekly_reports

  TECHNIQUE
  offline_operations · idempotency_records · file_assets
  audit_logs · application_events
```

---

## 3. Tables — Authentification et profils

### 3.1 `users` *(Auth.js + extensions Savoir+)*

| Colonne | Type | Contraintes | Note |
|---|---|---|---|
| `id` | uuid | PK | |
| `email` | text | **unique**, not null | citext ou `lower()` indexé pour l'unicité insensible à la casse |
| `email_verified_at` | timestamptz | null | `null` = non vérifié |
| `password_hash` | text | null | Argon2id. `null` si connexion par magic link uniquement. **Jamais sélectionné par un repository de lecture.** |
| `role` | enum(`student`,`parent`,`admin`) | not null, default `student` | **Source de vérité unique du rôle.** |
| `status` | enum(`active`,`suspended`,`deleted`) | not null, default `active` | contrôlé à chaque requête authentifiée |
| `image` | text | null | requis par l'adaptateur Auth.js |
| `name` | text | null | requis par l'adaptateur Auth.js |
| `created_at` / `updated_at` | timestamptz | not null | |

Index : `unique(lower(email))` · `idx_users_role_status(role, status)`

> **Décision :** le rôle vit sur `users` et non dans une table de liaison. Motif : un utilisateur MVP a exactement un rôle, et le contrôle à chaque requête doit être une lecture unique. Une table `user_roles` sera introduite le jour où un utilisateur cumulera des rôles (parent **et** admin), ce qui n'est pas un cas MVP.

### 3.2 `accounts` *(Auth.js)*
Comptes de fournisseurs externes. `provider`, `provider_account_id`, jetons. Contrainte `unique(provider, provider_account_id)`. **Existe dès le MVP même vide**, pour permettre l'ajout de Google sans migration.

### 3.3 `sessions` *(Auth.js)*
`session_token` unique, `user_id`, `expires`. Stratégie **base de données** : supprimer la ligne révoque immédiatement l'accès.
Index : `idx_sessions_user(user_id)` · `idx_sessions_expires(expires)` (purge des sessions expirées).

### 3.4 `verification_tokens` *(Auth.js + usages Savoir+)*

| Colonne | Type | Note |
|---|---|---|
| `identifier` | text | e-mail cible |
| `token` | text | **haché**, jamais stocké en clair |
| `expires` | timestamptz | |
| `purpose` | enum(`email_verification`,`password_reset`,`magic_link`) | sépare les usages : un jeton de vérification ne doit pas servir à réinitialiser un mot de passe |
| `consumed_at` | timestamptz null | usage unique |

PK composite `(identifier, token)`.

### 3.5 `profiles`
Données communes à tous les rôles : `user_id` (FK unique), `display_name`, `locale` (défaut `fr-CI`), `timezone` (défaut `Africa/Abidjan`), `onboarding_completed_at`.

### 3.6 `student_profiles`

| Colonne | Type | Note |
|---|---|---|
| `user_id` | uuid | FK `users`, unique |
| `grade_level` | text | MVP : `2nde_C` |
| `school_name` | text null | facultatif |
| `current_average` | numeric(4,2) null | ex. 9.57 — **déclaratif**, non vérifié |
| `target_average` | numeric(4,2) null | ex. 12.00 |
| `daily_minutes` | integer | disponibilité, ex. 60 |
| `days_per_week` | integer | check 1–7, ex. 5 |
| `diagnostic_completed_at` | timestamptz null | pilote l'accès au parcours |
| `birth_year` | integer null | **minimisation** : l'année suffit à savoir s'il s'agit d'un mineur, la date complète est inutile |

### 3.7 `parent_profiles`
`user_id` (FK unique), `display_name`, `phone` (null, facultatif), `preferred_report_day` (défaut dimanche).

### 3.8 `parent_student_links`

| Colonne | Type | Note |
|---|---|---|
| `id` | uuid | PK |
| `parent_user_id` | uuid | FK `users` |
| `student_user_id` | uuid | FK `users` |
| `status` | enum(`pending`,`active`,`revoked`) | **Seul `active` ouvre un droit de lecture.** |
| `invitation_code_hash` | text null | code haché, jamais en clair |
| `invited_by` | enum(`student`,`parent`) | qui a initié |
| `invitation_expires_at` | timestamptz null | 7 jours |
| `activated_at` / `revoked_at` | timestamptz null | |
| `revoked_by_user_id` | uuid null | traçabilité |

Contraintes : `unique(parent_user_id, student_user_id)` · `check(parent_user_id <> student_user_id)`
Index : `idx_psl_parent_active(parent_user_id) where status='active'` · `idx_psl_student(student_user_id)`

> **Table la plus sensible du modèle.** Toute requête parent part d'ici. Un défaut ici = fuite de données d'un mineur.

---

## 4. Tables — Référentiel pédagogique

### 4.1 `subjects`
`id`, `code` (unique, ex. `MATH`), `name`, `status` (`draft`/`published`/`archived`), `position`.

### 4.2 `chapters`
`id`, `subject_id` (FK), `code` (unique par matière), `title`, `description`, `grade_level`, `position`, `status`.
Index : `unique(subject_id, code)` · `idx_chapters_subject_status(subject_id, status, position)`

### 4.3 `skills`
`id`, `chapter_id` (FK), `code` (unique par chapitre), `label`, `description`, `position`, `status`, `prerequisite_skill_id` (FK auto-référencée, null).
> `prerequisite_skill_id` porte le graphe de prérequis. Contrainte applicative : pas de cycle (vérifiée au seed et à l'écriture admin).
Index : `unique(chapter_id, code)` · `idx_skills_chapter(chapter_id, position)`

### 4.4 `lessons`
`id`, `skill_id` (FK), `title`, `objective`, `status`, `current_version_id` (FK `lesson_versions`, null), `position`.

### 4.5 `lesson_versions`
`id`, `lesson_id` (FK), `version` (entier incrémental), `body_markdown`, `rule`, `example`, `common_mistakes` (jsonb), `revision_sheet`, `published_at` (null), `published_by` (FK `users`), `created_at`.
Contrainte : `unique(lesson_id, version)`.
> Le contenu vit dans la **version**, jamais dans `lessons`. `lessons` est l'identité stable ; `lesson_versions` est l'historique. C'est ce qui permet de corriger une leçon sans réécrire le passé.

### 4.6 `exercises`
`id`, `skill_id` (FK), `difficulty` (entier 1–5), `type` (enum : `numeric`, `multiple_choice`, `short_text`, `ordered_steps`), `status`, `current_version_id`, `position`, `similar_exercise_id` (FK auto-référencée, null — l'exercice proposé après la solution).

### 4.7 `exercise_versions`

| Colonne | Type | **Exposé au client ?** |
|---|---|:--:|
| `id`, `exercise_id`, `version` | | ✅ |
| `statement` | text | ✅ |
| `assets` (jsonb) | références `file_assets` | ✅ |
| **`correct_answer`** | jsonb | ❌ **JAMAIS avant soumission** |
| **`answer_tolerance`** | jsonb | ❌ |
| **`hints`** | jsonb (tableau ordonné) | ❌ sauf indice débloqué |
| **`solution_markdown`** | text | ❌ sauf droit acquis |
| `expected_error_category` | text null | ❌ — catégorie présumée en cas d'erreur type |
| `published_at`, `published_by` | | ✅ |

> **Ligne rouge du modèle.** Un repository de lecture élève **ne sélectionne jamais** les quatre colonnes marquées ❌. Le filtrage se fait dans la projection SQL du repository, pas dans un composant React. Un test automatisé doit vérifier que la réponse HTTP de `getExerciseForStudent` ne contient aucune de ces clés.

### 4.8 `exercise_steps`
`id`, `exercise_version_id` (FK), `position`, `prompt`, `expected_value` (jsonb, **secret**), `weight` (numeric).
> Support du **score partiel**. Sans étapes vérifiables, pas de score partiel (règle §7 du cahier des charges).

### 4.9 `exercise_attempts`

| Colonne | Type | Note |
|---|---|---|
| `id` | uuid | PK |
| `student_user_id` | uuid | FK `users` |
| `exercise_version_id` | uuid | FK — **pas** `exercise_id` : on fige ce que l'élève a réellement vu |
| `attempt_number` | integer | 1, 2, 3 |
| `submitted_answer` | jsonb | réponse brute de l'élève |
| `is_correct` | boolean | |
| `score` | integer | 0–100, calculé serveur |
| `hints_used` | integer | défaut 0 |
| `duration_ms` | integer | temps passé |
| `solution_revealed` | boolean | défaut false |
| `error_category` | text null | rempli si erreur |
| `source` | enum(`online`,`offline_sync`) | traçabilité de la synchronisation |
| `client_operation_id` | uuid null | corrélation avec `offline_operations` |
| `created_at` | timestamptz | |

Index : `idx_att_student_created(student_user_id, created_at desc)` — écran « mes tentatives » · `idx_att_student_version(student_user_id, exercise_version_id, attempt_number)` — reprise d'un exercice en cours · `idx_att_version(exercise_version_id)` — statistiques admin
Contrainte : `unique(student_user_id, exercise_version_id, attempt_number)` — empêche structurellement le doublon de rejeu hors ligne.

### 4.10 `exercise_attempt_steps`
`attempt_id` (FK), `exercise_step_id` (FK), `submitted_value` (jsonb), `is_correct`, `awarded_weight`.

---

## 5. Tables — Diagnostic

### 5.1 `diagnostic_tests`
`id`, `subject_id`, `grade_level`, `title`, `status`, `current_version_id`.

### 5.2 `diagnostic_test_versions`
`id`, `diagnostic_test_id`, `version`, `question_count` (check = 20 en MVP), `published_at`, `published_by`.

### 5.3 `diagnostic_questions`
`id`, `diagnostic_test_version_id` (FK), `skill_id` (FK), `position`, `statement`, **`correct_answer` (jsonb, secret)**, `choices` (jsonb, sans marqueur de bonne réponse), `weight`.
Contrainte : `unique(diagnostic_test_version_id, position)`.
> `choices` est envoyé au client **débarrassé de tout indicateur de correction**. Ne jamais compter sur l'ordre pour dissimuler la réponse : l'ordre est mélangé côté serveur par question, avec une graine dérivée de `(attempt_id, question_id)` afin que le mélange reste **reproductible** lors d'une reprise.

### 5.4 `diagnostic_attempts`
`id`, `student_user_id`, `diagnostic_test_version_id`, `status` (enum `in_progress`/`completed`/`abandoned`), `started_at`, `completed_at`, `current_position`, `total_score`, `report` (jsonb — statuts par compétence figés au moment du calcul).
Contrainte : au plus un `in_progress` par élève et par version — `unique(student_user_id, diagnostic_test_version_id) where status='in_progress'` (index partiel).

### 5.5 `diagnostic_answers`
`id`, `diagnostic_attempt_id` (FK), `diagnostic_question_id` (FK), `submitted_answer` (jsonb), `is_correct`, `answered_at`, `duration_ms`, `client_operation_id`.
Contrainte : `unique(diagnostic_attempt_id, diagnostic_question_id)` — **c'est ce qui rend la sauvegarde progressive idempotente**. Une réponse renvoyée après coupure met à jour, elle ne duplique pas.

---

## 6. Tables — Progression

### 6.1 `student_skill_levels`
État courant de maîtrise. **Table dérivée, recalculable intégralement** à partir des tentatives.

| Colonne | Type | Note |
|---|---|---|
| `student_user_id` + `skill_id` | uuid | **PK composite** |
| `status` | enum(`mastered`,`fragile`,`not_mastered`,`not_evaluated`) | |
| `success_rate` | numeric(5,2) | 0–100 |
| `evaluated_count` | integer | nb de mesures ; < 2 ⇒ `not_evaluated` |
| `last_evaluated_at` | timestamptz | |
| `source` | enum(`diagnostic`,`practice`,`assessment`,`revision`) | dernière origine |
| `updated_at` | timestamptz | |

Index : `idx_ssl_student_status(student_user_id, status)`
> Le caractère recalculable est une **exigence de conception** : il doit exister un script `scripts/maintenance/recompute-mastery.ts` capable de reconstruire cette table. Sans lui, une régression de scoring devient irréparable.

### 6.2 `error_logs`

| Colonne | Type | Note |
|---|---|---|
| `id` | uuid | PK |
| `student_user_id` | uuid | FK |
| `skill_id` | uuid | FK |
| `category` | enum — 10 valeurs (voir `PEDAGOGY.md` §5) | |
| `occurrence_count` | integer | défaut 1 |
| `status` | enum(`open`,`recurrent`,`resolved`) | `recurrent` dès `occurrence_count >= 3` |
| `first_seen_at`, `last_seen_at` | timestamptz | |
| `last_exercise_version_id` | uuid null | contexte |
| `next_review_at` | timestamptz null | pilote la révision |
| `resolved_at` | timestamptz null | |

Contrainte : `unique(student_user_id, skill_id, category)` — **une ligne par triplet, incrémentée**, pas une ligne par occurrence. C'est ce qui rend le comptage de récurrence exact même en cas de rejeu.
Index : `idx_err_student_status(student_user_id, status)` · `idx_err_next_review(student_user_id, next_review_at) where status <> 'resolved'`

### 6.3 `revision_plans`
`id`, `student_user_id`, `skill_id`, `error_log_id` (null), `interval_index` (0→J+1, 1→J+3, 2→J+7, 3→J+14, 4→J+30), `due_at`, `status` (`scheduled`/`done`/`missed`/`cancelled`), `consecutive_success`, `consecutive_failure`, `last_result`, `created_at`, `updated_at`.
Contrainte : `unique(student_user_id, skill_id, error_log_id) where status='scheduled'` — **une seule révision active par cible**. C'est la garantie « aucune duplication » de la Phase 9.
Index : `idx_rev_due(student_user_id, due_at) where status='scheduled'`

### 6.4 `revision_sessions`
`id`, `student_user_id`, `planned_for` (date), `started_at`, `completed_at`, `planned_minutes`, `actual_duration_ms`, `status` (`planned`/`in_progress`/`completed`/`skipped`), `source` (`auto`/`manual`).

### 6.5 `revision_session_items`
`id`, `revision_session_id` (FK), `revision_plan_id` (FK null), `exercise_version_id` (FK null), `lesson_version_id` (FK null), `position`, `result` (`success`/`failure`/`skipped` null), `completed_at`.
Contrainte : `check` — exactement une des trois références de contenu est non nulle.

### 6.6 `assessments`
`id`, `chapter_id` (FK null), `title`, `type` (`chapter`/`mixed`), `duration_minutes`, `status`, `current_version_id`.

### 6.7 `assessment_questions`
`id`, `assessment_id` (FK), `skill_id`, `position`, `statement`, **`correct_answer` (secret)**, `points` (numeric).

### 6.8 `assessment_attempts`
`id`, `student_user_id`, `assessment_id`, `status`, `started_at`, `completed_at`, `total_score`, `max_score`, `answers` (jsonb), `per_skill_breakdown` (jsonb).

### 6.9 `weekly_reports`
`id`, `student_user_id`, `week_start` (date), `week_end` (date), `sessions_completed`, `total_minutes`, `exercises_attempted`, `success_rate`, `first_try_success_rate`, `skills_improved` (jsonb), `top_difficulties` (jsonb), `recurrent_errors` (jsonb), `generated_at`.
Contrainte : `unique(student_user_id, week_start)`.
> **Table lue par le parent.** Elle ne contient que des agrégats — jamais une réponse brute de l'élève. Cette séparation physique est ce qui garantit techniquement la règle « le parent ne voit pas les données privées non nécessaires ».

---

## 7. Tables — Technique

### 7.1 `offline_operations`
Miroir serveur de la file client (voir `OFFLINE_SYNC.md`).
`id`, `idempotency_key` (**unique**), `user_id`, `device_id`, `operation_type`, `payload` (jsonb), `created_at` (horodatage **client**), `received_at` (horodatage **serveur**), `last_attempt_at`, `attempt_count`, `sync_status` (`pending`/`syncing`/`synced`/`failed`/`conflict`), `last_error`, `server_version`.
Index : `unique(idempotency_key)` · `idx_ops_user_status(user_id, sync_status)`
> Conserver `created_at` (client) **et** `received_at` (serveur) séparément : l'horloge d'un téléphone n'est pas fiable et ne doit jamais servir à ordonner une écriture serveur.

### 7.2 `idempotency_records`
`key` (PK), `user_id`, `operation_type`, `request_hash`, `response_payload` (jsonb), `status`, `created_at`, `expires_at` (rétention 30 jours).
> Distincte de `offline_operations` : celle-ci couvre **toute** écriture idempotente, y compris en ligne. Si la même clé revient avec un `request_hash` différent, c'est un conflit — pas un rejeu.

### 7.3 `file_assets`
`id`, `owner_user_id` (null pour un asset de contenu), `bucket`, `object_key` (unique), `mime_type`, `size_bytes`, `checksum`, `scope` (`content`/`user`), `status` (`pending`/`ready`/`deleted`), `uploaded_at`, `deleted_at`.
> Un objet R2 sans ligne `ready` est orphelin. Le script de maintenance le purge.

### 7.4 `audit_logs`
`id`, `actor_user_id` (null si système), `actor_role`, `action`, `entity_type`, `entity_id`, `before` (jsonb null), `after` (jsonb null), `ip_address` (null), `user_agent` (null), `created_at`.
> **Append-only.** Aucune mise à jour, aucune suppression applicative. `before`/`after` sont expurgés des secrets avant écriture.

### 7.5 `application_events`
`id`, `user_id` (null), `event_type`, `payload` (jsonb), `occurred_at`.
> Base des indicateurs de succès du Product Brief. **Aucune donnée personnelle identifiante dans `payload`.**

---

## 8. Justification des index

Un index n'est créé que s'il sert une requête métier identifiée. Chaque index proposé est adossé à un écran ou un traitement :

| Index | Requête servie |
|---|---|
| `unique(lower(users.email))` | connexion, unicité |
| `idx_users_role_status` | listes admin, contrôle de compte actif |
| `idx_psl_parent_active` | « les enfants de ce parent » — **requête d'autorisation, exécutée à chaque page parent** |
| `idx_psl_student` | « qui suit cet élève », révocation |
| `idx_chapters_subject_status` | catalogue publié |
| `idx_att_student_created` | historique de l'élève, calcul de régularité |
| `idx_att_student_version` | reprise d'un exercice en cours, n° de tentative |
| `idx_err_next_review` (partiel) | « erreurs à réviser » — **cœur de la répétition espacée** |
| `idx_rev_due` (partiel) | « révisions dues aujourd'hui » — requête exécutée à chaque ouverture |
| `unique(weekly_reports.student, week_start)` | rapport parent, unicité de génération |
| `unique(offline_operations.idempotency_key)` | **anti-doublon de synchronisation** |

Aucun index n'est créé « au cas où ». Les index partiels (`where status=...`) sont préférés lorsque la requête ne porte que sur un sous-ensemble : ils sont plus petits et plus rapides.

---

## 9. Transactions obligatoires

| Opération | Périmètre transactionnel |
|---|---|
| Soumission de tentative | idempotence + `exercise_attempts` + `error_logs` + `student_skill_levels` + `revision_plans` |
| Réponse de diagnostic | `diagnostic_answers` + avancement de `diagnostic_attempts.current_position` |
| Clôture de diagnostic | calcul du rapport + `student_skill_levels` initiaux + `revision_plans` initiaux + `student_profiles.diagnostic_completed_at` |
| Activation d'un lien parent | `parent_student_links.status` + consommation du code + `audit_logs` |
| Publication de contenu | nouvelle version + bascule de `current_version_id` + `audit_logs` |
| Traitement d'un lot de synchronisation | **une transaction par opération**, pas une pour tout le lot — un échec isolé ne doit pas annuler les opérations valides |

---

## 10. Ce qui ne doit jamais atteindre le navigateur

Liste de contrôle, à convertir en test automatisé :

| Donnée | Table | Condition d'exposition |
|---|---|---|
| `password_hash` | `users` | **jamais** |
| `token` | `verification_tokens` | **jamais** (seul le lien e-mail le porte) |
| `invitation_code_hash` | `parent_student_links` | **jamais** |
| `correct_answer` | `exercise_versions`, `diagnostic_questions`, `assessment_questions` | après soumission de la question concernée uniquement |
| `hints[i]` | `exercise_versions` | uniquement l'indice `i` débloqué par une tentative ratée |
| `solution_markdown` | `exercise_versions` | après 3ᵉ essai ou abandon explicite |
| `expected_value` | `exercise_steps` | après soumission |
| `DATABASE_URL`, clés R2 | environnement | **jamais** |

---

## 11. Diagramme ERD

```
users ─1─1─ profiles
  │ ─1─1─ student_profiles ─┐
  │ ─1─1─ parent_profiles   │
  │ ─1─n─ accounts          │
  │ ─1─n─ sessions          │
  └─n─n─ parent_student_links ─┘

subjects ─1─n─ chapters ─1─n─ skills ─┬─1─n─ lessons ─1─n─ lesson_versions
                                       ├─1─n─ exercises ─1─n─ exercise_versions ─1─n─ exercise_steps
                                       ├─1─n─ diagnostic_questions
                                       ├─1─n─ assessment_questions
                                       ├─1─n─ student_skill_levels ─n─1─ users
                                       ├─1─n─ error_logs ─n─1─ users
                                       └─1─n─ revision_plans ─n─1─ users

diagnostic_tests ─1─n─ diagnostic_test_versions ─1─n─ diagnostic_questions
                                                 └─1─n─ diagnostic_attempts ─1─n─ diagnostic_answers

exercise_versions ─1─n─ exercise_attempts ─1─n─ exercise_attempt_steps
                          └─n─1─ users

revision_plans ─n─1─ revision_session_items ─n─1─ revision_sessions ─n─1─ users
assessments ─1─n─ assessment_questions
            └─1─n─ assessment_attempts ─n─1─ users
users ─1─n─ weekly_reports
users ─1─n─ offline_operations · idempotency_records · file_assets · audit_logs · application_events
```

---

## 12. Stratégie de migration

| Règle | Détail |
|---|---|
| Source de vérité | le schéma Drizzle TypeScript. Le SQL est **généré**, jamais écrit à la main. |
| Génération | `drizzle-kit generate` produit un fichier horodaté dans `drizzle/migrations/`. |
| Exécution | `drizzle-kit migrate` **avec `DATABASE_URL_UNPOOLED`**. Jamais avec la connexion poolée. |
| Revue | toute migration est lue avant fusion. Une migration contenant `DROP`, `TRUNCATE` ou un `ALTER ... TYPE` réducteur est **rejetée par défaut**. |
| Migration destructrice | exige un plan écrit : sauvegarde préalable, migration en trois temps (ajouter → migrer les données → supprimer), fenêtre de retour arrière. |
| Ordre de déploiement | migration **avant** déploiement du code, avec un schéma rétrocompatible pendant la fenêtre de bascule. |
| Vérification post-déploiement | script obligatoire par migration : compte de lignes, présence des index, contraintes actives. |
| Retour arrière | le retour arrière du **code** est immédiat (redéploiement). Le retour arrière du **schéma** repose sur une migration inverse écrite à l'avance, ou sur un PITR Neon. Le PITR seul est un dernier recours : il perd les écritures postérieures. |
| Environnements | preview → staging → production. Aucune migration n'atteint la production sans être passée par staging. |

---

## 13. Seeds

| Script | Contenu | Environnements |
|---|---|---|
| `seed:reference` | référentiel pédagogique : 3 chapitres, 12 compétences, 12 leçons, 45 exercices, 20 questions de diagnostic, 3 évaluations | dev, staging, **production** |
| `seed:demo` | Anderson + progression simulée : 1 planning, 1 rapport parent, 10 erreurs | dev, staging — **jamais production** |

Les deux sont **idempotents** : rejouables sans doublon, via des `code` métier stables (`CH-01`, `SK-FRAC-01`) et des `ON CONFLICT DO UPDATE`. Aucun texte de remplissage : tout énoncé est un énoncé mathématique réel.

Garde-fou : `seed:demo` refuse de s'exécuter si `NODE_ENV === 'production'`.

---

## 14. Points laissés ouverts

| # | Question | Impact |
|---|---|---|
| DM-Q1 | Faut-il conserver les tentatives d'un compte supprimé sous forme anonymisée (statistiques) ou tout effacer ? | RGPD / protection des mineurs |
| DM-Q2 | Durée de rétention des `audit_logs` et `application_events` ? | volume, conformité |
| DM-Q3 | `correct_answer` en `jsonb` typé par `exercises.type` : faut-il une table par type d'exercice plutôt qu'un jsonb polymorphe ? | rigueur du typage vs simplicité |
| DM-Q4 | Le score d'une compétence doit-il pondérer les tentatives récentes davantage que les anciennes ? | dépend de la règle pédagogique — voir `PEDAGOGY.md` §4 |

Ces questions sont reportées dans `OPEN_QUESTIONS.md`.
