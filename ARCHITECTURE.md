# LBA Control — Architecture

> Plateforme SaaS B2B multi-entreprises de contrôle des opérations d'achat agricole (RCN).
> Documents de référence : `DECISIONS_ET_HYPOTHESES.md`, `DATABASE_SCHEMA.md`, `SECURITY_MODEL.md`, `TEST_PLAN.md`.

---

## 1. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CLIENT — PWA React 18 / TypeScript strict / Vite 6                          │
│                                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │  features/ │  │   domain/    │  │  lib/offline  │  │   components/ui  │  │
│  │  (écrans)  │──│ (calculs     │  │  Dexie +      │  │   shadcn/ui +    │  │
│  │  RHF+Zod   │  │  purs, 0 dép)│  │  file sync    │  │   Tailwind       │  │
│  └─────┬──────┘  └──────────────┘  └───────┬───────┘  └──────────────────┘  │
│        │ TanStack Query (cache serveur)     │ IndexedDB (file d'attente)     │
└────────┼──────────────────────────────────┬─┴────────────────────────────────┘
         │ supabase-js (clé publishable)    │  Service Worker (PWA)
         ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  SUPABASE                                                                    │
│  ┌────────────┐  ┌─────────────────────────────────────┐  ┌───────────────┐ │
│  │  Auth      │  │  PostgreSQL                         │  │  Storage      │ │
│  │  (JWT)     │─▶│  RLS sur 100 % des tables exposées  │  │  buckets      │ │
│  │            │  │  fonctions SECURITY DEFINER         │  │  PRIVÉS       │ │
│  │            │  │  triggers d'audit                   │  │  URLs signées │ │
│  └────────────┘  └─────────────────────────────────────┘  └───────────────┘ │
│                  ┌─────────────────────────────────────┐                    │
│                  │  Edge Functions (opérations         │                    │
│                  │  privilégiées : création de tenant, │                    │
│                  │  confirmation de paiement, seed)    │                    │
│                  └─────────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Principe directeur** : le navigateur n'est jamais une autorité. Il ne détient aucun secret, ne décide
d'aucune permission et ne constitue jamais la source de vérité (CDC §19). Toute règle qui protège de l'argent
est appliquée en base — contrainte, politique RLS ou fonction serveur — puis *doublée* côté client pour
l'ergonomie, jamais l'inverse.

---

## 2. Emplacement dans le dépôt

Le dépôt `nwodobe/fbms` héberge déjà une application statique FBMS (PWA vanilla) servie depuis la racine.
Pour ne rien casser, LBA Control est isolé :

```
/                          ← application FBMS existante (intacte)
├── IMPLEMENTATION_PLAN.md ← documents de conception LBA Control
├── ARCHITECTURE.md
├── DATABASE_SCHEMA.md
├── SECURITY_MODEL.md
├── TEST_PLAN.md
├── DECISIONS_ET_HYPOTHESES.md
└── lba-control/           ← nouvelle application SaaS
```

---

## 3. Arborescence de `lba-control/`

```
lba-control/
├── index.html
├── vite.config.ts                 PWA, alias @/, découpage des bundles
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json   TypeScript strict
├── tailwind.config.ts             thème piloté par variables CSS (marque tenant)
├── vitest.config.ts               tests unitaires + composants (jsdom)
├── vitest.db.config.ts            tests RLS/SQL contre un PostgreSQL réel (node)
├── playwright.config.ts           parcours P0 end-to-end
├── .env.example                   AUCUN secret
│
├── scripts/
│   ├── db-local.mjs               démarre/arrête/réinitialise PostgreSQL local
│   ├── db-migrate.mjs             applique les migrations dans l'ordre
│   └── db-seed.mjs                jeu de démonstration (données fictives)
│
├── supabase/
│   ├── config.toml
│   ├── migrations/                migrations versionnées, ordonnées, idempotentes
│   │   ├── 20260730000100_extensions_and_types.sql
│   │   ├── 20260730000200_platform_and_tenants.sql
│   │   ├── 20260730000300_identity_and_roles.sql
│   │   ├── 20260730000400_audit_log.sql
│   │   ├── 20260730000500_partners_contracts_prices.sql
│   │   ├── 20260730000600_funding_agents_advances_purchases.sql
│   │   ├── 20260730000700_stock_bags_planning_transfers.sql
│   │   ├── 20260730000800_expenses_tcb_incidents_scoring.sql
│   │   ├── 20260730000900_subscriptions.sql
│   │   ├── 20260730001000_offline_sync.sql
│   │   ├── 20260730001100_helper_functions.sql
│   │   ├── 20260730001200_rls_policies.sql
│   │   └── 20260730001300_audit_triggers.sql
│   ├── functions/                 Edge Functions (opérations privilégiées)
│   └── tests/                     assertions SQL complémentaires
│
├── e2e/                           spécifications Playwright des parcours P0
│
└── src/
    ├── main.tsx  ·  App.tsx  ·  router.tsx
    │
    ├── domain/                    ⚠ CŒUR MÉTIER — fonctions pures, aucune dépendance
    │   ├── money.ts               arithmétique XOF sûre (pas de flottant à la dérive)
    │   ├── weights.ts             les 4 poids et les 5 écarts
    │   ├── coverage.ts            allocation FIFO avance ↔ livraison
    │   ├── tcb.ts                 TCB prévisionnel/réel, répartition indirecte
    │   ├── margin.ts              prix net, marge totale, marge/kg, réconciliation
    │   ├── scoring.ts             score explicable /100, 9 composantes
    │   ├── alerts.ts              évaluation des 20 règles d'alerte
    │   ├── subscription.ts        cycle J-7 / J-3 / J / grâce / lecture seule / blocage
    │   └── duplicates.ts          détection de doublons achats et dépenses
    │
    ├── lib/
    │   ├── supabase.ts            client (clé publiable uniquement)
    │   ├── query.ts               configuration TanStack Query
    │   ├── auth/                  session, rôles, garde de permission
    │   ├── tenant/                résolution du tenant, thème de marque
    │   ├── offline/               Dexie, file d'attente, moteur de synchronisation
    │   ├── exports/               ExcelJS et jsPDF avec marque du tenant
    │   └── utils.ts
    │
    ├── components/
    │   ├── ui/                    primitives shadcn/ui
    │   └── shared/                AppShell, DataTable, KpiCard, StatusBadge…
    │
    ├── features/                  un dossier par domaine métier
    │   ├── auth/ · dashboard/ · alerts/ · partners/ · contracts/ · funding/
    │   ├── agents/ · advances/ · purchases/ · stock/ · bags/ · planning/
    │   ├── transfers/ · incidents/ · expenses/ · tcb/ · scoring/
    │   ├── reconciliation/ · reports/ · settings/ · subscription/ · platform/
    │
    └── types/
        ├── database.ts            types générés depuis le schéma
        └── domain.ts
```

**Règle de découpage** : un écran ne calcule jamais. Il appelle `src/domain/*`, qui est testé sans React,
sans réseau et sans base. C'est ce qui rend les formules financières vérifiables (condition de livraison
CMD §27).

---

## 4. Couches et responsabilités

| Couche | Responsabilité | Ce qu'elle ne fait **jamais** |
| --- | --- | --- |
| `domain/` | Formules TCB, marge, écarts, FIFO, score, alertes, abonnement, règles de justificatifs, de logo et de notification | Aucun accès réseau, aucun état React, aucune date implicite (l'horloge est injectée) |
| `lib/` | Accès Supabase, cache, session, file hors ligne, exports | Aucune règle métier de calcul |
| `features/` | Écrans, formulaires (RHF + Zod), orchestration | Aucun calcul financier en ligne |
| `components/ui` | Primitives visuelles | Aucune connaissance métier |
| PostgreSQL | Vérité, intégrité, isolation, audit | Rien qui dépende de la confiance envers le client |

---

## 5. Modèle multi-tenant

- Chaque table métier porte `tenant_id UUID NOT NULL` avec `REFERENCES tenants(id)`.
- L'appartenance est portée par le JWT via `app_metadata` (`tenant_id`, `role`), et **vérifiée en base**
  par `app.current_tenant_id()` qui lit `auth.jwt()`.
- Toute politique RLS commence par `tenant_id = app.current_tenant_id()`.
- Les index composites démarrent systématiquement par `tenant_id` — l'isolation est aussi une décision de
  performance, pas seulement de sécurité.
- Le super-administrateur plateforme n'a **aucun** accès métier par défaut ; il en obtient un via une session
  d'assistance explicite, motivée et à durée limitée (voir `SECURITY_MODEL.md`).

Résolution du tenant côté client : segment d'URL (`/t/<slug>`) ou code entreprise saisi à la connexion. La
liste des tenants n'est **jamais** exposée (DMQ E01).

---

## 6. Personnalisation de marque (encadrée)

Deux couleurs seulement, à des emplacements fixes (CMD §5). Le thème est injecté par variables CSS :

```
--brand-primary / --brand-primary-foreground / --brand-secondary / --brand-secondary-foreground
```

Tailwind consomme ces variables ; **aucune classe n'est générée dynamiquement**, aucune structure d'écran
n'est modifiable par le client, aucune typographie n'est configurable. Le contraste WCAG AA est **calculé et
vérifié au moment de l'enregistrement** : une couleur illisible est refusée avec sa mesure de contraste
(exigence de test CDC §23.1). La marque s'applique à : connexion, menu, tableau de bord, PDF, bons de
transfert, bons d'avance, exports et reçus.

---

## 7. Fonctionnement hors ligne

```
Saisie terrain ──▶ Dexie (IndexedDB)  ──▶ file d'attente ──▶ moteur de sync ──▶ Supabase
                   op.id = UUID client        │                    │
                   status = pending           │                    ├─ succès  → synced
                   attempts, last_error       │                    ├─ échec   → failed + backoff
                   created_at_device          │                    └─ conflit → visible, jamais écrasé
```

Garanties, telles qu'exigées (CMD §19) :

1. Une opération `pending` n'est **jamais** supprimée, quel qu'en soit le motif.
2. La file d'attente est **non bornée** — aucune limite à 300 opérations ni ailleurs.
3. La synchronisation est **idempotente** : l'UUID généré sur l'appareil est la clé primaire, un rejeu
   n'insère rien de nouveau (`ON CONFLICT DO NOTHING` + contrainte d'unicité).
4. Les conflits sont **affichés**, jamais résolus par écrasement silencieux.
5. Un journal de synchronisation local prouve qu'aucune opération n'a disparu.
6. Les photos sont compressées côté client (contrôle de type et de taille) avant mise en file.

Le service worker (`vite-plugin-pwa`) gère le shell applicatif ; les données restent gouvernées par Dexie et
TanStack Query. Le stockage local est un **cache et une file de résilience**, jamais la source de vérité.

---

## 8. Sécurité — résumé

Détail complet dans `SECURITY_MODEL.md`.

- RLS active sur **toutes** les tables exposées, avec politiques `SELECT` / `INSERT` / `UPDATE` / `DELETE`.
- `DELETE` **restrictive (`USING (false)`)** sur les tables transactionnelles : la politique existe et refuse.
  L'annulation se fait par statut + date + motif + auteur + audit (CMD §3).
- Aucune clé `service_role` dans le navigateur. Aucune variable `VITE_*` secrète.
- Fonctions privilégiées en `SECURITY DEFINER` avec `search_path` verrouillé.
- Validation Zod **côté client et côté serveur** (mêmes schémas partagés, contraintes SQL en dernier rempart).
- Buckets Storage privés, URLs signées de courte durée, contrôle de type MIME et de taille.
- Journal d'audit alimenté par triggers, non modifiable par les utilisateurs ordinaires.

---

## 9. Cycle de vie de l'abonnement

```
trial ──▶ pending_payment ──▶ active ──┬──▶ (J-7, J-3, J : rappels)
                                       │
                          échéance ────┴──▶ grace_period (5 j, configurable)
                                              │
                                    J+5 ──────┴──▶ suspended_read_only  (écriture bloquée, lecture + export OK)
                                                      │
                                            J+30 ─────┴──▶ suspended     (accès opérationnel bloqué, données conservées)
```

Le blocage en écriture est appliqué **en base** : la fonction `app.tenant_can_write()` est évaluée dans les
politiques `INSERT`/`UPDATE` de toutes les tables métier. Un client suspendu ne peut pas écrire, même en
contournant l'interface. Une capture d'écran déposée par le client **n'active jamais** un abonnement : seule
la confirmation du super-administrateur (ou, plus tard, un webhook serveur signé) le fait.

---

## 10. Tests

| Niveau | Outil | Cible |
| --- | --- | --- |
| Unitaire | Vitest | `src/domain/*` — TCB, marge, écarts, FIFO, score, alertes, abonnement, rattachements, logo, notifications |
| Composant | Vitest + React Testing Library | Formulaires, gardes de permission, états d'erreur |
| Base / RLS | Vitest (runner `node`) + `pg` sur PostgreSQL réel | Isolation tenant, cloisonnement pisteur, immuabilité de l'audit, blocage en suspension |
| Hors ligne | Vitest + `fake-indexeddb` | Non-suppression des `pending`, idempotence, file non bornée |
| E2E | Playwright | Parcours P0 de bout en bout |

Les tests RLS s'exécutent contre un **vrai PostgreSQL** en simulant le mécanisme Supabase (`SET ROLE
authenticated` + `request.jwt.claims`), ce qui permet de vérifier les politiques sans dépendre de Docker.

---

## 11. Environnement local

```bash
cd lba-control
npm install
cp .env.example .env.local        # renseigner l'URL et la clé PUBLISHABLE Supabase
npm run db:start                  # PostgreSQL local + migrations
npm run db:seed                   # jeu de démonstration fictif
npm run dev
```

Deux modes de base de données sont supportés :

1. **PostgreSQL local** (`scripts/db-local.mjs`) — sans Docker, utilisé par la CI et les tests RLS.
2. **Supabase CLI** (`supabase start`) — pile complète avec Auth et Storage, quand Docker est disponible.

Les mêmes fichiers de migration alimentent les deux : `supabase/migrations/` est l'unique source.
