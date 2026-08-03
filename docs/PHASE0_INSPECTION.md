# Phase 0 — Inspection du dépôt et état des lieux

> Produit par : Software Architect, DevOps Engineer, Security Engineer
> Date : 2026-08-03
> Statut : **FACTUEL** — issu de l'inspection réelle du dépôt, aucune supposition.

---

## 1. Identité réelle du dépôt inspecté

| Élément | Valeur constatée |
|---|---|
| Dépôt | `nwodobe/fbms` |
| Branche de travail | `claude/savoir-plus-app-architecture-9kkwwq` |
| Branche principale | `main` |
| Dernier commit `main` | `991c83e` — « Portail : nouvelle interface (tuiles visuelles, recherche, filtre rôle) (#129) » |
| Produit hébergé | **ANAGROCI FBMS — Field Buying 2027** (PJS Global) |
| Domaine métier | Achat de noix de cajou (RCN), recensement de villages, logistique, cash, sacherie |
| Taille | 2,5 Mo (dont 1,1 Mo `.git`) |

**Le dépôt ne contient aucune trace du produit Savoir+.** Aucun fichier, aucune branche, aucun document ne mentionne l'éducation, le lycée, les mathématiques ou la Côte d'Ivoire scolaire.

---

## 2. Stack technique existante (constatée)

### 2.1 Ce qui existe

```
/                      → site statique, servi par GitHub Pages (.nojekyll présent)
  index.html           → portail d'accueil (16 Ko)
  manifest.webmanifest → PWA "ANAGROCI FBMS", theme #0B2B21
  sw.js                → service worker v0.16.6 (cache shell + runtime + tuiles OSM)
  i18n-sw.js           → service worker i18n
  assets/              → logos PJS
  fbms/                → module recensement (app.html, carte, hubs, audit distances)
  logistique/          → module ALIS
  terrain/             → achats, cash, sacs, command center
  rcntrace/            → traçabilité RCN (23 fichiers JS, store + sync + UI)
  shared/              → couche commune (config, auth-gate, i18n, thèmes CSS)
  suite/               → sélecteur d'applications
  supabase/            → 15 fichiers .sql + 1 edge function Deno (admin-create-user)
  docs/                → 30 rapports d'audit et de recette FBMS
```

### 2.2 Caractéristiques déterminantes

| Dimension | Constat |
|---|---|
| Build system | **Aucun.** Pas de `package.json`, pas de bundler, pas de transpilation. |
| Framework | **Aucun.** HTML + JavaScript ES5/ES6 en `<script>` classiques, IIFE. |
| TypeScript | **Absent** (sauf `supabase/functions/admin-create-user/index.ts`, Deno). |
| Base de données | **Supabase** (PostgreSQL managé) — projet `jmbdgpdthzpszfnddwzi` |
| Authentification | Supabase Auth via `shared/auth-gate.js` |
| Autorisation | RLS PostgreSQL (`supabase/rls.sql`) + table `profils(role, actif)` |
| Déploiement | GitHub Pages, servi depuis la racine du dépôt |
| CI/CD | **Aucun.** Pas de répertoire `.github/`, pas de workflow. |
| Tests automatisés | **Aucun.** Pas de runner, pas de fichier de test. |
| Lint / format | **Aucun.** Pas d'ESLint, pas de Prettier. |
| `.gitignore` | **Absent** |
| Node.js disponible | v22.22.2 / npm 10.9.7 (environnement d'exécution) |

---

## 3. Incompatibilités identifiées (bloquantes ou structurantes)

| # | Incompatibilité | Gravité | Impact |
|---|---|---|---|
| **INC-01** | **Produit différent.** Le dépôt héberge FBMS (agro-industrie) ; Savoir+ est une application éducative sans aucun lien métier. | **Critique** | Décision humaine requise sur la localisation du code (voir OQ-01). |
| **INC-02** | **Base de données différente.** L'existant repose sur Supabase ; Savoir+ impose Neon PostgreSQL + Drizzle. Deux fournisseurs PostgreSQL distincts dans un même dépôt. | **Critique** | Deux jeux de secrets, deux consoles, deux modèles d'autorisation (RLS vs gardes applicatives). |
| **INC-03** | **Conflit de racine.** GitHub Pages sert `index.html` depuis la racine. Une application Next.js réclame la racine pour `next.config`, `package.json`, `public/`, `src/`. Installer Next.js à la racine **casse le déploiement FBMS en production**. | **Critique** | Interdit d'appliquer littéralement la structure §9 du cahier des charges à la racine. |
| **INC-04** | **Conflit de PWA.** Un seul `manifest.webmanifest` et un seul `sw.js` peuvent avoir la portée (`scope`) racine. Le service worker FBMS v0.16.6 intercepte déjà toutes les navigations. | **Majeur** | La PWA Savoir+ doit avoir un `scope` distinct, sinon les deux se neutralisent. |
| **INC-05** | **Conflit de documentation.** `docs/` contient 30 rapports FBMS. Y déposer `docs/ARCHITECTURE.md` sans préfixe mélange deux produits dans un même espace. | **Mineur** | Traçabilité dégradée ; atténué par une convention de nommage. |
| **INC-06** | **Absence totale d'outillage.** Ni `package.json`, ni CI, ni tests, ni lint. La chaîne qualité exigée (Vitest, Playwright, ESLint, GitHub Actions) est à créer intégralement. | **Majeur** | Charge de Phase 0/16 sous-estimée si non anticipée. |
| **INC-07** | **Absence de `.gitignore`.** Un `node_modules/`, un `.env.local` ou un `.next/` seraient committés par défaut. **Risque direct de fuite de secrets.** | **Majeur** | À corriger avant la première commande `npm install`. |
| **INC-08** | **Modèle d'autorisation opposé.** FBMS s'appuie sur la RLS PostgreSQL. Savoir+ impose des gardes serveur applicatives (Server Actions, services). Neon ne fournit pas d'équivalent Supabase Auth intégré à la RLS. | **Majeur** | L'autorisation Savoir+ doit être **entièrement applicative**, sans filet RLS. Exigence de tests renforcée. |

---

## 4. Observations de sécurité sur l'existant

> Périmètre : constats sur FBMS, **hors périmètre Savoir+**, consignés pour information du propriétaire du dépôt.

| # | Constat | Niveau |
|---|---|---|
| SEC-E1 | La clé publique Supabase (`sb_publishable_...`) et l'URL du projet sont en clair dans `shared/anagroci-config.js`. C'est **par conception** (clé publiable, sécurité portée par la RLS) et documenté dans `SECURITE.md`. **Pas une fuite**, à condition que la RLS soit effectivement active sur toutes les tables. | Information |
| SEC-E2 | `SECURITE.md` indique lui-même qu'un écran de login JavaScript seul ne protège rien. La protection réelle dépend de l'exécution manuelle de `supabase/rls.sql`. **Aucune vérification automatisée** ne garantit que la RLS est active en production. | Moyen |
| SEC-E3 | Absence de `.gitignore` : aucune barrière contre le commit accidentel d'un fichier de secrets. | Moyen |
| SEC-E4 | Aucune analyse de dépendances (pas de `package.json`, donc pas de `npm audit`), aucun scan de secrets en CI. | Moyen |

Aucun secret privé (`service_role`, mot de passe, token) n'a été trouvé committé dans le dépôt.

---

## 5. Ce que Savoir+ peut réutiliser de l'existant

| Actif | Réutilisable ? | Commentaire |
|---|---|---|
| Expérience PWA terrain / faible réseau | **Oui, conceptuellement** | FBMS gère déjà l'offline et les tuiles cartographiques en cache. Retour d'expérience directement transposable au contexte ivoirien. |
| Couche i18n (`shared/i18n.js`) | Non | JavaScript non typé, non modulaire, couplé à FBMS. |
| Design system (`pjs-theme.css`, `anagroci-ui.css`) | Non | Identité PJS Global (vert pine), sans rapport avec l'identité Savoir+ (bleu profond). |
| Schéma Supabase | Non | Domaine métier disjoint. |
| Rapports d'audit `docs/` | **Oui, comme modèle** | La méthode de rapport par étape (`stepN_*.md`) est de bonne qualité et cohérente avec le format de rapport exigé §16. |

---

## 6. Hypothèse de travail retenue pour la Phase 0

> **HYP-01 — Cohabitation par sous-répertoire isolé.**
> En l'absence de décision humaine, la documentation et l'architecture Savoir+ sont conçues pour vivre dans un répertoire dédié `savoir-plus/` à la racine du dépôt `nwodobe/fbms`, avec la structure imposée au §9 du cahier des charges **appliquée à l'intérieur de ce répertoire**.
> Cette hypothèse préserve intégralement le déploiement GitHub Pages de FBMS et n'engage aucun code.
> **Elle est réversible à coût nul tant qu'aucun code n'est écrit.** L'option recommandée reste un dépôt dédié (voir `DECISIONS.md`, ADR-001).

**Exception assumée :** les 14 documents exigés par la Phase 0 sont créés dans `docs/` à la racine, aux chemins exacts imposés par le cahier des charges. Ils ne portent pas de collision de nom avec les 30 documents FBMS existants (préfixés `step*` / `rcntrace_*`).

---

## 7. Verdict d'inspection

| Contrôle | Résultat |
|---|---|
| Dépôt inspecté | ✅ |
| Stack existante identifiée | ✅ |
| Incompatibilités identifiées | ✅ 8 incompatibilités, dont 3 critiques |
| Fichiers sensibles détectés | ✅ Aucun secret privé committé |
| Dépendances obsolètes | ✅ Sans objet (aucune dépendance déclarée) |
| Erreurs existantes | ✅ Aucun build à casser (pas de build) |
| Structure documentaire créée | ✅ 15 documents |
| Code métier écrit | ✅ **Aucun** — conforme à la consigne |

**Verdict : APPROUVÉ AVEC RÉSERVES.** Les réserves portent sur OQ-01 (localisation du code) et OQ-02 (référentiel pédagogique ivoirien), toutes deux nécessitant une décision humaine avant la Phase 2.
