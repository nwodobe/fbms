# FBMS — instructions pour Claude Code

Ce fichier décrit ce dépôt **tel qu'il est**, pas tel qu'un projet web moderne
serait. Les habitudes acquises ailleurs coûtent cher ici : la moitié des erreurs
qu'un agent peut commettre sur FBMS viennent de gestes corrects sur un autre
projet.

---

## 1. Ce qu'est FBMS

**ANAGROCI Operations Suite** — outil interne de terrain (achat de cacao, ALIS,
hubs, carte, audit de distances, traçabilité). Publié par **GitHub Pages** à la
racine du dépôt.

- Dépôt : `nwodobe/fbms` · Branche par défaut : `main`
- Production : la variable de dépôt `PRODUCTION_URL`

> `README.md` précise : « application interne, ne pas diffuser l'URL hors
> équipe ». Ce n'est pas un site vitrine.

### La chose à comprendre avant tout

**Il n'y a ni build, ni gestionnaire de paquets, ni suite de tests à la racine.**

Pas de `package.json`, pas de `npm run build`, pas de bundler. `.nojekyll` est
présent : GitHub Pages sert les fichiers **exactement** tels qu'ils sont commis.
Un fichier poussé est un fichier en production.

Conséquences, toutes vérifiables :

- `npm test`, `npm run lint`, `npm run build` **n'existent pas**. Les inventer
  dans un workflow produit une porte verte qui ne mesure rien.
- Il n'y a pas d'étape de compilation pour rattraper une erreur de syntaxe. Une
  accolade en trop rend le fichier inerte, sans avertissement.
  C'est déjà arrivé : `shared/alis-hardening.js` ne se charge pas, et ses
  garde-fous ne s'exécutent donc jamais (voir §6).
- Les chemins relatifs comptent. `./manifest.webmanifest` depuis `fbms/index.html`
  cherche `fbms/manifest.webmanifest`, qui n'existe pas.

### Deux exceptions à la règle « pas de build »

| Chemin | Nature | Règle |
|---|---|---|
| `savoir-plus/` | Application **Next.js** avec son `package.json` et sa CI (`savoir-plus-ci.yml`) | **Hors périmètre des agents.** Ne pas l'auditer, ne pas la corriger, ne pas l'inclure dans les portes qualité. |
| `supabase/` | SQL, RLS et fonctions Edge | **Jamais de modification automatique.** C'est la vraie serrure (voir §3). |

---

## 2. Structure

| Chemin | Contenu |
|---|---|
| `index.html` | Portail d'entrée |
| `fbms/` | Field Buying — achats, carte |
| `terrain/`, `logistique/`, `rcntrace/`, `suite/` | Modules opérationnels |
| `shared/` | Code commun : `auth-gate.js`, `admin.html`, styles, utilitaires |
| `assets/` | Images et ressources statiques |
| `sw.js`, `i18n-sw.js`, `manifest.webmanifest` | Couche PWA |
| `docs/` | Documentation métier et audits datés |
| `supabase/` | Migrations, RLS, fonctions Edge |
| `savoir-plus/` | Application Next.js séparée — **hors périmètre** |
| `FBMS · Sauvegarde Master.html` | Sauvegarde, **pas une page servie** |

---

## 3. Zones interdites à toute modification automatique

`SECURITE.md` explique la posture : le portail JavaScript **ne protège rien**
seul — la clé publique Supabase est visible dans les pages. La protection réelle
vient des politiques RLS. Une modification de l'une des deux couches sans
l'autre casse la sécurité **ou** casse l'accès des utilisateurs légitimes.

Un agent ne modifie **jamais** :

- `shared/auth-gate.js`, `shared/admin.html` — authentification et rôles
- `supabase/**` — RLS, migrations, fonctions Edge
- `.github/**`, `.claude/**` — un agent qui réécrit sa propre politique n'est
  plus encadré par elle
- `sw.js`, `i18n-sw.js`, `manifest.webmanifest` — un service worker fautif
  survit au correctif dans le cache des utilisateurs
- `.nojekyll`, `CNAME` — la publication elle-même
- `savoir-plus/**`
- tout ce qui touche aux clés, jetons ou identifiants

La liste qui fait foi est `.github/agent-policy/auto-merge-denylist.txt`.
Elle est **prioritaire** sur l'allowlist.

---

## 4. Ce qu'un agent peut réellement vérifier ici

Il n'y a pas de tests, mais il y a des faits observables. Les portes sont dans
`.github/scripts/` et toutes exécutables à la main :

```bash
node .github/scripts/verifier-html.mjs     # structure : lang, titre, alt, doublons d'id
node .github/scripts/verifier-liens.mjs    # liens et ressources internes
node .github/scripts/verifier-js.mjs       # syntaxe JavaScript (node --check)

# Ouvre réellement chaque page dans Chromium, à 3 largeurs.
# Nécessite Playwright : npm install --no-save playwright@1.49.1
node .github/scripts/verifier-pages.mjs
```

Et sur le site publié :

```bash
PRODUCTION_URL=… node .github/scripts/smoke-production.mjs   # la page est-elle utilisable ?
PRODUCTION_URL=… node .github/scripts/auditer-production.mjs # audit complet, 3 largeurs
```

### Référentiels (`baselines`) — lire ceci avant de s'en servir

`.github/agent-policy/*-baseline.json` liste des défauts **qui existent déjà**
sur `main`. Sans eux, les portes seraient rouges dès le premier jour et plus
personne ne les lirait.

**Un référentiel date un défaut, il ne l'absout pas.** Chaque entrée porte la
description du vrai problème. Y ajouter une ligne pour faire passer une porte
sur un défaut que l'on vient d'introduire est un contournement — c'est
exactement ce que ces fichiers servent à rendre visible.

---

## 5. Règles de travail

1. **Ne jamais pousser sur `main`.** Toute modification passe par une branche et
   une pull request.
2. **Ne rien déclarer testé sans preuve.** Une page « vérifiée » est une page
   ouverte dans un navigateur, à une largeur nommée, avec une observation
   citable. Lire le code ne suffit pas — `shared/uppercase.js:79` injecte deux
   scripts dynamiquement, invisibles à toute recherche textuelle.
3. **Trois largeurs, toujours** : 390×844, 768×1024, 1440×900.
4. **Aucune donnée réelle** dans un test, une capture ou un rapport : pas de nom
   de producteur, de numéro de téléphone, de montant, de coordonnée GPS de
   parcelle.
5. **Aucun secret** dans un fichier commis ou un journal. On vérifie qu'une
   variable *existe* ; on n'affiche jamais sa valeur.
6. **Le français** pour le code, les commentaires, les commits et les rapports.
7. **Ne pas inventer de commande.** Si un contrôle n'existe pas, l'écrire ou
   dire qu'il manque — jamais faire semblant.

---

## 6. Défauts connus au moment de l'installation des agents

Constatés par exécution, pas par lecture. Ils sont dans les référentiels ; les
corriger est un travail à part entière, à faire dans des pull requests dédiées.

| Constat | Où | Effet |
|---|---|---|
| Fichier non analysable (accolade en trop, ligne 39) | `shared/alis-hardening.js` | Le fichier **est** chargé en production via `shared/uppercase.js:79`, mais ne s'exécute pas : ses garde-fous sont absents |
| `manifest.webmanifest` et `icon-192.png` demandés en relatif | `fbms/index.html` | 404 réelles en production |
| `anagroci-ui.css` introuvable | depuis `fbms/`, `logistique/`, `terrain/` | Feuille de style absente |
| Attribut `lang` absent | `fbms/fbms_carte.html`, `logistique/alis_fbms.html` | Lecteurs d'écran et traduction |
| Images sans `alt` | `fbms/index.html` (2) | Accessibilité |
| ~90 violations axe-core (WCAG A/AA) | plusieurs pages | Relevées, non bloquantes |

---

## 7. Les agents

Sept agents dans `.claude/agents/`. Leur mode d'emploi, leurs déclencheurs et —
surtout — la différence entre un agent **créé**, **déclenché** et réellement
**opérationnel** sont décrits dans `docs/AI_AGENT_OPERATIONS.md`.

La politique qui les encadre est `agent-policy.yml`, à la racine.
