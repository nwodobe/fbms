# Savoir+ — Architecture technique

> Agent responsable : **Software Architect**
> Contributeurs : Neon Database Architect, Backend Engineer, Frontend Engineer, Security Engineer, DevOps Engineer
> Statut : **PROPOSITION** — aucune ligne de code applicatif n'a été écrite
> Version : 0.1.0 — 2026-08-03

---

## 1. Principes directeurs

| # | Principe | Conséquence concrète |
|---|---|---|
| **A1** | **Le serveur est la seule autorité.** | Aucun score, aucun statut de maîtrise, aucune décision d'accès n'est calculé côté client. Le client affiche, il ne décide pas. |
| **A2** | **Le domaine ne connaît ni HTTP ni SQL.** | `lib/scoring`, `lib/mastery`, `lib/revision` sont des fonctions pures, testables sans base de données ni navigateur. |
| **A3** | **Une seule porte vers la base.** | Toute requête SQL passe par `server/repositories/`. Aucun `db.select()` dans un composant, une page ou une Server Action. |
| **A4** | **L'autorisation est explicite, jamais implicite.** | Une route non exposée dans l'interface n'est pas protégée. Chaque Server Action et Route Handler appelle une garde nommée. |
| **A5** | **La donnée sensible ne quitte jamais le serveur.** | Réponses correctes, indices non débloqués, solutions : filtrés dans le repository, pas dans le composant. |
| **A6** | **Toute écriture est idempotente.** | Le mode hors ligne rejoue les opérations. Sans idempotence, les données se dupliquent. |
| **A7** | **Le contenu est versionné, jamais écrasé.** | Une tentative de 2026 doit rester interprétable même si l'exercice a changé en 2027. |
| **A8** | **Mobile-first et faible réseau par défaut.** | Le cas nominal est un Android d'entrée de gamme sur données mobiles instables, pas un poste de bureau. |

---

## 2. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────┐
│                        NAVIGATEUR (PWA)                              │
│                                                                      │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ React Server   │  │ Composants   │  │ Service Worker           │ │
│  │ Components     │  │ Client       │  │ · shell applicatif       │ │
│  │ (rendu serveur)│  │ · RHF + Zod  │  │ · pages consultées       │ │
│  │                │  │ · TanStack   │  │ · assets                 │ │
│  └────────────────┘  └──────┬───────┘  └──────────────────────────┘ │
│                             │                                        │
│                      ┌──────▼────────────────────────┐              │
│                      │ Couche offline (lib/sync)      │              │
│                      │ IndexedDB                      │              │
│                      │ · sessions · réponses          │              │
│                      │ · tentatives · durées          │              │
│                      │ · erreurs                      │              │
│                      │ · FILE D'OPÉRATIONS            │              │
│                      └──────┬────────────────────────┘              │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ HTTPS
                              │ Server Actions · Route Handlers
┌─────────────────────────────▼───────────────────────────────────────┐
│                     NEXT.JS — CÔTÉ SERVEUR                          │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ 1. FRONTIÈRE   server/actions/ · app/api/                     │ │
│  │    · validation Zod du payload           (rejet immédiat)     │ │
│  │    · garde d'autorisation nommée         (rejet immédiat)     │ │
│  │    · aucune logique métier ici                                │ │
│  └───────────────────────────┬───────────────────────────────────┘ │
│  ┌───────────────────────────▼───────────────────────────────────┐ │
│  │ 2. AUTORISATION  server/authorization/                        │ │
│  │    requireSession · requireRole · requireOwnership            │ │
│  │    requireActiveParentLink · requirePublishedContent          │ │
│  └───────────────────────────┬───────────────────────────────────┘ │
│  ┌───────────────────────────▼───────────────────────────────────┐ │
│  │ 3. SERVICES    server/services/                               │ │
│  │    orchestration · transactions · effets de bord · audit      │ │
│  │    diagnostic · attempt · revision · progress · content       │ │
│  └──────────┬──────────────────────────────┬─────────────────────┘ │
│             │                              │                        │
│  ┌──────────▼──────────────┐  ┌────────────▼────────────────────┐  │
│  │ 4. DOMAINE  lib/        │  │ 5. DONNÉES server/repositories/ │  │
│  │    FONCTIONS PURES      │  │    Drizzle · SQL paramétré      │  │
│  │    scoring · mastery    │  │    filtrage des champs secrets  │  │
│  │    revision · validation│  │    clause d'appartenance        │  │
│  │    AUCUNE E/S           │  └────────────┬────────────────────┘  │
│  └─────────────────────────┘               │                       │
│                              ┌─────────────▼──────────────────┐    │
│                              │ server/db/  (client Drizzle)   │    │
│                              │ pooled (app) · direct (migr.)  │    │
│                              └─────────────┬──────────────────┘    │
│  ┌──────────────────────┐  ┌───────────────┼──────────────────┐    │
│  │ server/auth/ Auth.js │  │ server/storage/ R2 (S3 compat.)  │    │
│  └──────────┬───────────┘  └───────────────┼──────────────────┘    │
└─────────────┼───────────────────────────────┼──────────────────────┘
              │                               │
   ┌──────────▼──────────┐        ┌───────────▼─────────┐
   │  NEON PostgreSQL    │        │  Cloudflare R2      │
   │  branches par env.  │        │  buckets privés     │
   └─────────────────────┘        └─────────────────────┘
```

**Règle de dépendance (stricte, à faire respecter par ESLint) :**

```
app / components  →  features  →  server/actions  →  server/authorization
                                                  →  server/services  →  server/repositories → server/db
                                                                     →  lib (pur)
```

Une flèche inverse est un défaut d'architecture. En particulier :
- `lib/` n'importe **rien** de `server/`.
- `components/` n'importe **jamais** `server/db` ni `server/repositories`.
- `server/repositories/` n'importe **jamais** `server/services`.

---

## 3. Modules fonctionnels et frontières

| Module (`src/features/`) | Responsabilité | Dépend de | Ne connaît pas |
|---|---|---|---|
| `auth` | inscription, connexion, vérification, récupération | — | pédagogie |
| `onboarding` | profil élève, objectif, disponibilité, invitation parent | `auth` | exercices |
| `diagnostics` | passation, sauvegarde progressive, rapport, plan initial | `auth` | correction guidée |
| `lessons` | consultation des leçons publiées | `auth` | scoring |
| `exercises` | présentation, soumission de tentative | `auth`, `lessons` | calcul du score (serveur) |
| `corrections` | indices gradués, solution, exercice similaire | `exercises` | carnet d'erreurs (via service) |
| `errors` | carnet d'erreurs, catégories, récurrence | `corrections` | planning |
| `revision` | plan de révision, séances, recalcul des échéances | `errors`, `exercises` | interface parent |
| `progress` | agrégats de progression, graphiques | `exercises`, `revision` | administration |
| `parent` | tableau de bord parent, rapport hebdomadaire | `progress` | données brutes de tentative |
| `admin` | gestion et publication du contenu | tout (lecture) | données personnelles élève |
| `offline` | file d'opérations, synchronisation, conflits | tous | métier (générique) |
| `storage` | pièces jointes de contenu (R2) | `admin` | pédagogie |

**Frontière critique :** `parent` ne lit **jamais** les repositories élève directement. Il passe par `server/services/report.service.ts`, qui n'expose que des agrégats. Cette contrainte est ce qui garantit qu'un parent ne peut pas voir une réponse brute de son enfant.

---

## 4. Structure du dépôt

> Conforme au §9 du cahier des charges. Voir `DECISIONS.md` ADR-001 pour la localisation de la racine (`savoir-plus/` ou dépôt dédié).

```
src/
  app/                        # App Router — routage et rendu uniquement
    (public)/                 #   accueil, connexion, inscription
    (student)/                #   espace élève  — garde: role=student
    (parent)/                 #   espace parent — garde: role=parent
    (admin)/                  #   espace admin  — garde: role=admin
    api/                      #   Route Handlers (sync, webhooks, uploads)
  components/
    ui/                       # shadcn/ui — primitives sans métier
    layout/  student/  parent/  admin/  exercises/  lessons/  charts/
  features/                   # une fonctionnalité = un dossier autonome
    auth/ onboarding/ diagnostics/ lessons/ exercises/ corrections/
    errors/ revision/ progress/ parent/ admin/ offline/ storage/
  server/
    auth/                     # configuration Auth.js, callbacks, adaptateur
    db/                       # clients Drizzle (pooled / direct), schéma
    repositories/             # accès données — seule couche autorisée à faire du SQL
    services/                 # logique métier, transactions, audit
    actions/                  # Server Actions — frontière validée et gardée
    authorization/            # gardes réutilisables + matrice
    storage/                  # service R2, URLs présignées
  lib/
    validation/               # schémas Zod partagés client/serveur
    scoring/                  # PUR — calcul de score de tentative
    mastery/                  # PUR — statuts de maîtrise
    revision/                 # PUR — calendrier de répétition espacée
    sync/                     # file d'opérations IndexedDB, moteur de sync
  hooks/  types/  constants/  tests/

drizzle/
  migrations/                 # SQL versionné, généré par Drizzle Kit
  meta/                       # journal Drizzle

scripts/
  seed/                       # seed:dev (démonstration) · seed:ref (référentiel)
  maintenance/                # sauvegarde, vérification post-migration

docs/                         # les 15 documents de gouvernance
public/                       # manifest PWA, icônes, service worker
```

---

## 5. Flux de données de référence

### 5.1 Soumission d'une tentative d'exercice (chemin critique)

```
Client                Server Action           Service              Repository        Neon
  │                        │                     │                     │              │
  ├─ submitAttempt ───────►│                     │                     │              │
  │  {exerciseId,          │                     │                     │              │
  │   answer,              ├─ Zod.parse() ───────┤ (rejet si invalide) │              │
  │   idempotencyKey}      │                     │                     │              │
  │                        ├─ requireSession()   │                     │              │
  │                        ├─ requireRole('student')                   │              │
  │                        │                     │                     │              │
  │                        ├────────────────────►│                     │              │
  │                        │                     ├─ claimIdempotency ─►│─ INSERT ────►│
  │                        │                     │   (clé déjà vue ?   │   ON CONFLICT│
  │                        │                     │    → retour cache)  │              │
  │                        │                     │                     │              │
  │                        │                     ├─ BEGIN TRANSACTION ─────────────── │
  │                        │                     ├─ getExerciseWithAnswer ───────────►│
  │                        │                     │   (serveur uniquement)             │
  │                        │                     ├─ lib/scoring.evaluate()            │
  │                        │                     │   PUR : correct? score? categorie? │
  │                        │                     ├─ INSERT exercise_attempts ────────►│
  │                        │                     ├─ si erreur: UPSERT error_logs ────►│
  │                        │                     ├─ lib/mastery.recompute() (pur)     │
  │                        │                     ├─ UPSERT student_skill_levels ─────►│
  │                        │                     ├─ lib/revision.schedule() (pur)     │
  │                        │                     ├─ UPSERT revision_plans ───────────►│
  │                        │                     ├─ COMMIT ──────────────────────────►│
  │                        │                     │                     │              │
  │◄── AttemptResult ──────┴─────────────────────┤                     │              │
  │    {correct, score, hintAvailable,           │                     │              │
  │     nextStep}  ← JAMAIS la solution          │                     │              │
```

**Points non négociables de ce flux :**
- La bonne réponse est lue **dans la transaction serveur** et ne figure dans aucune réponse HTTP tant que le droit à la solution n'est pas acquis.
- Tentative + carnet d'erreurs + maîtrise + planning sont mis à jour **dans une seule transaction**. Un plantage à mi-chemin ne laisse pas un carnet d'erreurs incohérent avec la maîtrise.
- L'`idempotencyKey` est réclamée **avant** la transaction métier. Un rejeu hors ligne retourne le résultat mémorisé, il ne recalcule pas.

### 5.2 Synchronisation hors ligne

Voir `OFFLINE_SYNC.md`. En résumé : `POST /api/sync` reçoit un lot d'opérations, chacune portant une `idempotency_key` ; le serveur les traite en séquence, retourne un statut par opération, et le client purge la file au fur et à mesure.

---

## 6. Stratégie Neon

### 6.1 Deux connexions, deux usages

| Variable | Type | Usage | Interdit |
|---|---|---|---|
| `DATABASE_URL` | **poolée** (`-pooler` dans l'hôte) | application web, Server Actions, Route Handlers, fonctions serverless | migrations, `LISTEN/NOTIFY`, sessions longues |
| `DATABASE_URL_UNPOOLED` | **directe** | migrations Drizzle Kit, seeds, sauvegardes, maintenance | toute utilisation par le code applicatif |

Garde-fou proposé : `server/db/index.ts` lève une erreur au démarrage si `DATABASE_URL` ne contient pas `-pooler`, et `scripts/` refuse de s'exécuter si `DATABASE_URL_UNPOOLED` en contient un.

### 6.2 Client de connexion

- Un **module singleton** exporte le client Drizzle. Aucune ouverture de connexion par requête.
- Pilote : `@neondatabase/serverless` (HTTP/WebSocket) pour le runtime serverless, `postgres`/`pg` sur connexion directe pour les migrations.
- `DATABASE_URL` n'est **jamais** préfixée `NEXT_PUBLIC_`. Un test automatisé vérifie qu'aucune variable serveur ne fuit dans le bundle client.

### 6.3 Résilience

- **Retry avec backoff exponentiel** sur les erreurs transitoires (`connection terminated`, `ECONNRESET`, cold start de compute Neon) : 3 tentatives, 100 ms / 400 ms / 1 600 ms, jitter.
- **Ne jamais rejouer** une opération d'écriture non idempotente sans clé d'idempotence.
- Le premier accès après mise en veille du compute Neon peut prendre plusieurs centaines de millisecondes : l'interface affiche un état de chargement, elle n'affiche pas d'erreur.

### 6.4 Branches Neon par environnement

| Environnement | Branche Neon | Données |
|---|---|---|
| `production` | `main` | réelles |
| `staging` | `staging` | anonymisées ou synthétiques |
| `preview` (par PR) | branche éphémère créée depuis `main`, supprimée à la fermeture | copie sans données personnelles |
| `development` | `dev` ou branche locale par développeur | seed de démonstration |

Règle : **une migration s'exécute d'abord sur une branche de preview, jamais directement sur `main`.**

### 6.5 Sauvegarde et restauration

- S'appuyer sur le *point-in-time restore* natif de Neon (fenêtre à confirmer selon le plan tarifaire — voir OQ-06).
- **Complément non négociable** : export logique quotidien (`pg_dump` via connexion directe) déposé chiffré sur R2, rétention 30 jours. Un PITR seul lie la survie des données à la disponibilité du compte Neon.
- Procédure de restauration documentée **et testée** avant la mise en service (Phase 16), pas après.

---

## 7. Stratégie d'authentification

Détail complet dans `AUTHORIZATION_MATRIX.md` et `SECURITY.md`. Ossature :

- **Auth.js** avec adaptateur Drizzle sur les tables `users` / `accounts` / `sessions` / `verification_tokens`.
- **Stratégie de session : `database`**, pas JWT. Motif : révocation immédiate exigée (US-AUTH-03 CA3, US-AUTH-04 CA3). Un JWT reste valide jusqu'à expiration ; une session en base se supprime.
- Fournisseurs MVP : *Credentials* (e-mail + mot de passe, hachage Argon2id) et *Email* (magic link). Google est ajoutable ultérieurement **sans migration** grâce à la table `accounts`.
- Le rôle est stocké en base sur `users.role` et **relu à chaque requête serveur**. Il n'est jamais lu depuis un cookie, un en-tête ou le corps d'une requête.
- Le middleware Next.js ne fait que du routage optimiste (rediriger un visiteur non connecté). **Il ne constitue pas une protection.** La protection est dans les gardes serveur.

---

## 8. Stratégie de stockage (Cloudflare R2)

| Règle | Détail |
|---|---|
| Bucket | **privé par défaut.** Aucun accès public anonyme. |
| Accès | **URLs présignées** générées côté serveur, après contrôle d'autorisation. Durée : 5 min en lecture, 10 min en écriture. |
| Secrets | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` **exclusivement serveur**. Jamais dans le bundle client. |
| Convention de clé | `{env}/{entité}/{uuid}/{slug}.{ext}` — jamais le nom de fichier fourni par l'utilisateur. |
| Contrôle MIME | Liste blanche stricte (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml` désinfecté, `application/pdf`). Vérifié **côté serveur sur les octets réels**, pas sur l'en-tête déclaré. |
| Taille | Plafond appliqué à la génération de l'URL présignée **et** revérifié à la finalisation. |
| Traçabilité | Chaque objet a une ligne `file_assets` : propriétaire, taille, type, statut, date. Un objet sans ligne est orphelin et purgé. |
| CORS | Restreint à `NEXT_PUBLIC_APP_URL`. Pas de `*`. |
| Suppression | Logique d'abord (`status='deleted'`), physique après 30 jours par un script de maintenance. |

---

## 9. Stratégie d'erreurs

| Couche | Comportement |
|---|---|
| `lib/` (pur) | Retourne un `Result<T, DomainError>`. Ne lève pas d'exception pour un cas métier attendu. |
| `repositories/` | Lève `NotFoundError`, `ConflictError`. Ne connaît pas HTTP. |
| `services/` | Traduit en erreurs typées applicatives, écrit l'audit, gère la transaction. |
| `actions/` | Convertit en `ActionResult<T>` sérialisable : `{ ok: true, data }` ou `{ ok: false, code, message }`. |
| Client | Affiche un message compréhensible par un élève de 16 ans. **Jamais de trace technique.** |

**Règle de non-divulgation :** une ressource inexistante et une ressource interdite renvoient la **même** réponse (404) pour les données d'un autre utilisateur. Distinguer les deux permet d'énumérer les identifiants.

---

## 10. Stratégie de cache

| Donnée | Cache | Justification |
|---|---|---|
| Contenu pédagogique publié | agressif — `revalidate` long + invalidation à la publication | identique pour tous, change rarement |
| Profil et progression de l'élève | **jamais mis en cache partagé** | données personnelles, par utilisateur |
| Tableau de bord parent | cache court par utilisateur (60 s) | tolère la fraîcheur, allège la base |
| Rapports hebdomadaires | pré-calculés et stockés | agrégats coûteux, lus souvent |
| Assets R2 | cache navigateur long via URL présignée immuable | contenu figé |

**Interdiction absolue :** aucune donnée d'un utilisateur ne doit se trouver dans un cache indexé par une clé non préfixée par son identifiant. C'est le mécanisme le plus courant de fuite entre comptes.

---

## 11. Stratégie d'observabilité

| Besoin | Moyen (MVP) |
|---|---|
| Erreurs serveur | journal structuré JSON : `timestamp`, `level`, `requestId`, `userId`, `action`, `code`. **Jamais de mot de passe, de jeton ni de réponse d'élève.** |
| Actions sensibles | table `audit_logs` (acteur, action, cible, avant/après, IP, horodatage) |
| Événements produit | table `application_events` (diagnostic terminé, séance terminée, révision honorée) — base des indicateurs du Product Brief |
| Santé base | requêtes lentes Neon, saturation du pool |
| Santé synchronisation | taux d'opérations `failed` / `conflict` — **indicateur d'alerte prioritaire** |

Choix d'un outil externe (Sentry ou équivalent) : à trancher, voir OQ-07.

---

## 12. Montée en charge

Ordre de grandeur cible MVP : quelques centaines d'élèves actifs, pics le soir (19 h – 22 h).

| Goulot anticipé | Parade |
|---|---|
| Connexions PostgreSQL | connexion poolée obligatoire ; le pooler Neon absorbe les pics serverless |
| Requêtes de progression | agrégats pré-calculés dans `student_skill_levels` et `weekly_reports`, pas de `COUNT` sur `exercise_attempts` à l'affichage |
| Lots de synchronisation | plafond de 50 opérations par requête ; au-delà, le client pagine |
| Assets | servis par R2 en direct via URL présignée, jamais relayés par Next.js |
| Compute Neon en veille | acceptable en MVP ; à réévaluer si le délai de démarrage à froid dégrade l'expérience du soir |

**Ce qui ne monte pas en charge et est assumé en MVP :** génération synchrone des rapports hebdomadaires. À déplacer vers une tâche planifiée dès que le volume l'exige.

---

## 13. Diagramme des composants (vue déploiement)

```
        Utilisateur (Android, données mobiles)
                      │
                      ▼
        ┌──────────────────────────────┐
        │  CDN / Edge de l'hébergeur   │  assets statiques, shell PWA
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  Next.js (runtime serveur)   │
        │  · RSC · Server Actions      │
        │  · Route Handlers            │
        └───┬──────────┬───────────┬───┘
            │          │           │
            ▼          ▼           ▼
     ┌───────────┐ ┌────────┐ ┌──────────────┐
     │   Neon    │ │Auth.js │ │ Cloudflare   │
     │ PostgreSQL│ │(mêmes  │ │ R2 (privé)   │
     │  pooled   │ │ tables)│ │              │
     └─────┬─────┘ └────────┘ └──────────────┘
           │
           │ connexion DIRECTE (hors runtime applicatif)
           ▼
     ┌──────────────────────────────────┐
     │ CI GitHub Actions · scripts      │
     │ migrations · seeds · sauvegardes │
     └──────────────────────────────────┘
```

---

## 14. Variables d'environnement

| Variable | Portée | Secret | Rôle |
|---|---|:--:|---|
| `DATABASE_URL` | serveur | ✅ | connexion **poolée** — application |
| `DATABASE_URL_UNPOOLED` | serveur | ✅ | connexion **directe** — migrations, seeds, maintenance |
| `AUTH_SECRET` | serveur | ✅ | signature des jetons Auth.js |
| `AUTH_URL` | serveur | — | URL canonique pour les redirections Auth.js |
| `R2_ACCOUNT_ID` | serveur | — | compte Cloudflare |
| `R2_ACCESS_KEY_ID` | serveur | ✅ | identifiant S3 |
| `R2_SECRET_ACCESS_KEY` | serveur | ✅ | clé S3 |
| `R2_BUCKET_NAME` | serveur | — | bucket cible |
| `R2_ENDPOINT` | serveur | — | endpoint S3 compatible |
| `NEXT_PUBLIC_APP_URL` | **client** | — | seule variable exposée au navigateur |

**Une seule variable est préfixée `NEXT_PUBLIC_`.** Toute nouvelle variable `NEXT_PUBLIC_` exige une justification écrite dans `DECISIONS.md`. Un test de CI échoue si une variable secrète apparaît dans le bundle client.

---

## 15. Ce que cette architecture ne fait pas

Énoncé volontairement, pour éviter les malentendus :

- Elle n'utilise **pas** la RLS PostgreSQL. Neon n'offre pas l'intégration Auth ↔ RLS de Supabase. **L'autorisation est intégralement applicative**, ce qui rend les tests d'autorisation (`tests/authorization/`) non pas souhaitables mais **structurels**.
- Elle ne prévoit **pas** de file de messages ni de traitement asynchrone. Tout est synchrone en MVP.
- Elle ne prévoit **pas** de multi-tenant ni d'établissement scolaire. L'unité est l'élève.
- Elle ne prévoit **pas** de temps réel (WebSocket, présence). Aucun besoin MVP.
