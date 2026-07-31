# LBA Control

Plateforme SaaS B2B de gestion des opérations d'achat agricole (RCN — noix brutes de cajou), destinée
aux LBA et coopératives de Côte d'Ivoire.

Elle relie chaque franc et chaque kilogramme à son origine, son détenteur, son statut et sa
destination : financement reçu → avance au pisteur → achat terrain → stock → planning → transfert →
réception → dépenses → TCB → marge → score.

> **État actuel : phase 1 terminée.** Le socle sécurisé (schéma, isolation multi-entreprises, rôles,
> RLS, journal d'audit) est livré et vérifié par tests. Les écrans métier arrivent aux phases 2 à 6.
> Voir `../IMPLEMENTATION_PLAN.md` pour l'état exact de chaque phase — rien n'y est annoncé comme
> terminé sans test exécuté.

---

## Documents de conception

Ils sont à la racine du dépôt et font foi :

| Fichier | Contenu |
| --- | --- |
| `../IMPLEMENTATION_PLAN.md` | Avancement réel, ce qui marche, ce qui ne marche pas, décisions ouvertes |
| `../ARCHITECTURE.md` | Couches, arborescence, multi-tenant, hors ligne, abonnements |
| `../DATABASE_SCHEMA.md` | Toutes les tables et les règles qu'elles portent |
| `../SECURITY_MODEL.md` | Rôles, RLS, séparation des tâches, audit, stockage, secrets |
| `../TEST_PLAN.md` | Ce qui doit être vérifié, comment, et à quelle phase |
| `../DECISIONS_ET_HYPOTHESES.md` | **8 incohérences** relevées entre documents sources, 14 hypothèses, 12 arbitrages ouverts |

---

## Prérequis

- **Node.js 20+** (développé et testé sur Node 22)
- **PostgreSQL 16** (client et serveur) pour le développement local et les tests
- *Facultatif* : Docker + Supabase CLI, pour la pile complète avec Auth et Storage

---

## Installation

```bash
cd lba-control
npm install
cp .env.example .env.local     # puis renseignez vos valeurs
```

`.env.local` n'est jamais versionné. `.env.example` ne contient aucun secret : uniquement des noms de
variables.

> **Règle de sécurité** : toute variable préfixée `VITE_` finit dans le bundle JavaScript et devient
> publique. La clé `service_role` de Supabase contourne Row Level Security — elle ne doit **jamais**
> y figurer. Un test automatisé (`tests/unit/no-secrets.test.ts`) échoue si un secret apparaît dans un
> fichier versionné.

---

## Base de données locale

Deux chemins, alimentés par **les mêmes migrations** (`supabase/migrations/`) :

### 1. PostgreSQL local, sans Docker *(utilisé par les tests)*

```bash
npm run db:start     # démarre le serveur, applique les 13 migrations
npm run db:seed      # jeu de démonstration (données fictives)
npm run db:reset     # repart d'une base vide
npm run db:stop
```

Le script `scripts/db-local.mjs` applique d'abord `supabase/local/00_local_shim.sql`, qui recrée ce
que Supabase fournit d'origine : les rôles `anon` / `authenticated` / `service_role` et les fonctions
`auth.uid()` / `auth.jwt()`. Les tests reproduisent ainsi le mécanisme exact de Supabase — `SET ROLE
authenticated` puis `request.jwt.claims` — donc une politique qui passe en local passe en production.

### 2. Supabase CLI *(si Docker est disponible)*

```bash
supabase start
supabase db reset
```

---

## Développement

```bash
npm run dev          # serveur de développement
npm run build        # build de production (typecheck strict + Vite + PWA)
npm run preview      # sert le build de production
```

---

## Tests

```bash
npm test             # unitaires + composants (Vitest, jsdom)
npm run test:rls     # sécurité et règles métier, contre un PostgreSQL réel
npm run test:e2e     # parcours P0 (Playwright) — implémentés aux phases 2 à 6
```

État actuel, mesuré et non déclaratif.

**Base de données — 315 tests**

| Suite | Tests | Couvre |
| --- | --- | --- |
| `rls.test.ts` | 59 | Isolation multi-tenant, cloisonnement pisteur, auditeur en lecture seule, immuabilité de l'audit, verrou d'abonnement, assistance super-admin auditée |
| `business-rules.test.ts` | 45 | Mélange de financements, double réservation, historisation des prix, quatre poids et cinq écarts, incidents bloquants, séparation des tâches |
| `security-audit.test.ts` | 40 | **Audit piloté par le catalogue** : chaque table, chaque politique, chaque fonction privilégiée, sans liste écrite à la main |
| `tcb-scoring-alerts.test.ts` | 29 | Anti double comptage, répartition indirecte, TCB, marges, scoring, vingt alertes |
| `subscription-closure.test.ts` | 29 | Cycle d'abonnement jour par jour, paiements, clôture et réouverture de campagne, conservation |
| `advances-purchases.test.ts` | 23 | Plafonds, couverture FIFO, doublons d'achat |
| `reception-incidents.test.ts` | 20 | Tolérance en cascade, écarts, incidents ouverts sans imputation |
| `branding-prices.test.ts` | 18 | Contraste imposé côté serveur, révision de prix versionnée |
| `bags.test.ts` | 18 | Soldes de sacherie déduits des mouvements, pertes expliquées, réaffectation approuvée |
| `attachments.test.ts` | 10 | Rattachement d'un justificatif : qui peut écrire quel chemin sur quelle ligne |
| `scheduled-tasks.test.ts` | 10 | Tâches récurrentes : parcours de tous les clients, isolation des échecs, journal réservé à la plateforme |
| `notifications.test.ts` | 12 | Audience d'une alerte, absence de doublon, distinction lue / résolue |
| `demo-walkthrough.test.ts` | 2 | **Parcours complet** : financement → achat → réception → TCB → alerte → clôture |

**Unitaires et composants — 522 tests**, dont :

| Suite | Couvre |
| --- | --- |
| `src/domain/*.test.ts` | Contraste, arithmétique, prix, couverture, avances, doublons, poids, stock, planning, TCB, marges, scoring, alertes, abonnement, rapports, tableau de bord |
| `tests/unit/offline-queue.test.ts` | OFF-01 → OFF-08 : file non bornée, aucune perte, idempotence, conflits visibles |
| `tests/unit/offline-attachments.test.ts` | OFF-09 → OFF-14 : justificatifs conservés, octets avant chemin, remplacement journalisé |
| `tests/unit/offline-audit.test.ts` | **Audit du code** : aucun appel de suppression, aucune borne de file, endurance sur 500 opérations, octets préservés à travers les mises à jour |
| `tests/unit/bundle-budget.test.ts` | Budget de chargement initial sur mobile |
| `tests/unit/error-surfacing.test.ts` | Tout écran qui écrit affiche ses échecs |
| `tests/unit/no-secrets.test.ts` | Aucun secret dans les fichiers versionnés |

**Parcours end-to-end — 224 tests** (bureau + Android), E2E-01 → E2E-23.

**Copies d'écran de démonstration**

```bash
CAPTURE_DIR=/chemin/de/sortie npx playwright test e2e/capture.spec.ts
```

Fait tourner l'application réelle sur un jeu de données fictif et enregistre 22 écrans — bureau et
téléphone. Exclu de `npm run test:e2e` : il ne vérifie rien, il photographie. Le service worker y est
neutralisé, sans quoi il relaie lui-même les appels réseau et l'interception ne les voit plus.

`npm run test:rls` exige une base locale démarrée (`npm run db:start`).
`tests/unit/bundle-budget.test.ts` exige un `npm run build` préalable ; sans `dist/`, il se saute.

---

## Jeu de démonstration

`npm run db:seed` insère exactement les volumes demandés au cahier des charges :

1 entreprise cliente · 2 sociétés partenaires (OLAM et DORADO, fictives) · 1 campagne · 2 contrats ·
4 pisteurs · 3 financements · 8 avances · 25 achats · 8 lots de stock · 4 plannings ·
4 transferts avec les quatre poids · 20 dépenses · 2 incidents · 4 scores · 1 abonnement actif ·
20 règles d'alerte.

Il intègre aussi les cas de test qualitatifs : un prix expiré, un doublon probable d'achat, un doublon
probable de dépense, 3 achats en attente de synchronisation, des transferts à écart **vert (0,15 %)**,
**orange (0,60 %)** et **rouge (1,85 %)**, un planning annulé et un planning futur.

**Toutes les données sont fictives** et suffixées « (démo) ».

---

## Déploiement

### 1. Base de données

Créez un projet Supabase, puis appliquez les migrations dans l'ordre :

```bash
supabase link --project-ref <ref-du-projet>
supabase db push
```

Vérifiez ensuite, avant toute mise en service :

```sql
-- Aucune ligne attendue : toute table exposée doit avoir RLS activée.
select relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- Aucune ligne attendue : chaque table doit porter ses 4 politiques.
select c.relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname having count(distinct p.polcmd) < 4;
```

### 2. Authentification

Dans Supabase Auth :

- politique de mot de passe : 12 caractères minimum ;
- MFA activable pour les administrateurs (`users.mfa_enrolled_at` est prévu à cet effet) ;
- **`tenant_id` et `role` doivent être écrits dans `app_metadata`**, jamais dans `user_metadata` :
  `user_metadata` est modifiable par l'utilisateur, ce qui lui permettrait de changer d'entreprise ou
  de se déclarer propriétaire.

### 3. Stockage

Créez trois buckets **privés** : `proofs`, `tickets`, `branding`. Aucun bucket public. Les chemins
sont préfixés par `tenant_id/` et l'accès passe par des URL signées de courte durée.

### 4. Application

```bash
npm run build        # produit dist/
```

`dist/` est un site statique déployable sur Netlify, Vercel, Cloudflare Pages ou tout hébergeur
équivalent. Deux points à configurer :

- **Réécriture SPA** : toutes les routes vers `/index.html` ;
- **Variables d'environnement** : `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` uniquement.

En-têtes recommandés :

```
Content-Security-Policy: default-src 'self'; connect-src 'self' https://<projet>.supabase.co; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

### 5. Vérification après déploiement

- [ ] Un utilisateur du client A ne voit aucune donnée du client B, y compris par URL directe
- [ ] Un pisteur ne voit ni la marge du LBA ni les opérations d'un collègue
- [ ] Le journal d'audit se remplit et reste non modifiable
- [ ] Un abonnement suspendu bloque l'écriture mais autorise lecture et export
- [ ] L'application s'installe comme PWA sur Android
- [ ] Aucune clé `service_role` n'est présente dans le bundle (`grep -r service_role dist/`)
- [ ] Le rôle `anon` n'atteint aucune fonction : `select has_schema_privilege('anon','app','usage')` renvoie `false`
- [ ] Une suppression d'achat, d'avance, de dépense ou de prix renvoie 0 ligne affectée
- [ ] Les buckets `preuves` et `marque` existent et sont **privés**
- [ ] Un objet déposé sous le tenant A n'est pas listable par le tenant B
- [ ] Un fichier de plus de 8 Mo est refusé par le bucket lui-même, pas seulement par l'interface

### 6. Tâches planifiées

Deux traitements font vivre le produit dans le temps. Sans eux, un client impayé garde un accès
complet, un client à jour reste bloqué, et la moitié des vingt types d'alerte ne se déclenche
jamais — ce sont ceux qui se mesurent en durées, pas en saisies.

La migration `2500` les installe **automatiquement si `pg_cron` est disponible** :

| Tâche | Fréquence | Fonction |
| --- | --- | --- |
| `lba-subscription-lifecycle` | tous les jours à 02h10 UTC | `app.run_subscription_lifecycle()` |
| `lba-alert-evaluation` | tous les jours à 04h30 et 13h30 UTC | `app.run_alert_evaluation()` |

Activer l'extension au préalable, sur le projet Supabase :

```sql
create extension if not exists pg_cron;
```

Puis rejouer la migration `2500` — elle est écrite pour être rejouable et remplace les tâches
existantes plutôt que de les dupliquer.

**Si `pg_cron` n'est pas disponible** (certains plans le restreignent), la migration s'applique sans
rien planifier, en le disant dans un `notice`. Appelez alors les deux fonctions depuis un
ordonnanceur externe — GitHub Actions, cron système, ou tout planificateur capable d'ouvrir une
connexion PostgreSQL avec un rôle privilégié :

```sql
select app.run_subscription_lifecycle();
select app.run_alert_evaluation();
```

Les deux sont **idempotentes** : les rejouer ne renvoie pas un second rappel, ne rebascule pas un
statut déjà atteint et n'ouvre pas deux fois la même alerte.

**Vérification.** L'écran *Plateforme* affiche les vingt dernières exécutions : tâche, date, nombre
de clients parcourus, changements produits et anomalies. Un tableau vide y est signalé explicitement
— « si l'ordonnanceur est censé tourner, il ne tourne pas » — parce qu'une tâche absente se remarque
autrement trop tard : le jour où un client se plaint de ne pas avoir été prévenu.

Un client en erreur n'interrompt pas les autres : son échec est consigné dans le détail de
l'exécution, et la boucle continue.

---

## Structure

```
lba-control/
├── src/
│   ├── domain/       calculs purs et testables (aucune dépendance React ni réseau)
│   ├── lib/          Supabase, session, marque du tenant, file hors ligne, exports
│   ├── components/   primitives shadcn/ui et composants partagés
│   ├── features/     un dossier par domaine métier
│   └── types/        types de la base
├── supabase/
│   ├── migrations/   26 migrations versionnées et ordonnées
│   └── local/        adaptateur PostgreSQL local (jamais appliqué à Supabase)
├── scripts/          pilotage de la base locale et jeu de démonstration
├── tests/            unitaires, base de données et sécurité
└── e2e/              parcours Playwright
```

---

## Licence et propriété

Le client reste propriétaire de ses données ; la plateforme reste propriétaire du logiciel et de son
code. Le non-paiement suspend le service mais ne transfère jamais la propriété des données.
