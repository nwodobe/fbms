# Exploitation des agents IA — FBMS

Comment fonctionne l'orchestration Claude Code installée dans `nwodobe/fbms` :
ce qu'elle fait, ce qu'elle ne fait pas, comment l'activer, comment l'arrêter,
et comment savoir si elle fonctionne vraiment.

---

## 1. Créé, déclenché, opérationnel — la distinction qui compte

C'est la section la plus importante du document. Elle existe parce que la
confusion entre ces trois états est la façon la plus courante de croire qu'on
est protégé alors qu'on ne l'est pas.

| État | Ce qui le prouve | Ce qu'il ne prouve pas |
|---|---|---|
| **CRÉÉ** | Le fichier existe et est commis sur `main`. | Rien d'autre. Un agent créé n'a jamais rien exécuté. |
| **DÉCLENCHÉ** | Une exécution GitHub Actions porte son nom, avec un identifiant, une date et des journaux. | Que l'exécution ait fait quelque chose. Un job `skipped`, un job qui sort immédiatement sur une condition, un job vert qui n'a exécuté aucune étape utile : tous sont « déclenchés ». |
| **OPÉRATIONNEL** | Une exécution réelle a produit un **effet vérifiable** : un constat cité, une issue ouverte, une branche poussée, une pull request créée, un verdict rendu. | Que l'effet soit bon. C'est le rôle de la relecture humaine. |

Trois pièges, tous rencontrés pendant l'installation :

1. **Un job `skipped` est vert.** Dans l'interface GitHub, un workflow dont
   toutes les conditions sont fausses affiche une coche. Il n'a rien fait.
   Vérifiez toujours le **résumé d'exécution**, pas la couleur.
2. **Une porte qui n'exécute rien passe toujours.** C'est pourquoi aucun
   workflow ici n'appelle `npm test` : cette commande n'existe pas à la racine
   de FBMS, et une étape qui échoue silencieusement en `|| true` est pire que
   pas de porte du tout.
3. **Un fichier d'agent n'est pas un agent.** `.claude/agents/*.md` décrit une
   méthode. Il faut quelqu'un ou quelque chose pour l'exécuter.

> **Statut à la date d'installation : les sept agents sont CRÉÉS.**
> Aucun n'est OPÉRATIONNEL tant que le canari de la §8 n'a pas été exécuté et
> que ses artefacts n'ont pas été constatés.

---

## 2. Les sept agents

Tous dans `.claude/agents/`. Ils s'exécutent via Claude Code — depuis un poste
de travail, ou depuis un workflow qui les invoque.

| Agent | Rôle | Modifie le code ? | Déclencheur |
|---|---|---|---|
| `app-orchestrator` | Répartit le travail, empêche deux agents d'écrire dans le même fichier, consolide les résultats | Non | Manuel |
| `ui-design-agent` | Hiérarchie visuelle, contraste, typographie, espacements, responsive, zones tactiles, états `hover`/`focus`/`disabled`/`loading` | Oui, **après reproduction** d'un défaut réel | Manuel, ou suite à un audit |
| `ux-navigation-agent` | Menus, liens, boutons, parcours, retour arrière, URL directes, 404, formulaires, messages d'erreur, clavier | **Non** — rapport uniquement | Manuel |
| `qa-continuous-agent` | Exécute et maintient les contrôles : liens, HTML, JS, Playwright, console, réseau, accessibilité, smoke test | Les scripts de contrôle seulement | Pull request, push sur branche d'agent |
| `app-audit-agent` | Audit indépendant : fonctionnel, UX, accessibilité, qualité, sécurité, performance, dépendances, erreurs silencieuses, cas limites | **Jamais** | Hebdomadaire, ou manuel |
| `auto-fix-agent` | Le plus petit correctif possible, pour une anomalie reproduite, à faible risque, autorisée par la politique, avec un contrôle de non-régression | Oui, dans l'allowlist **uniquement** | Label `agent-autofix` sur une issue |
| `release-guardian-agent` | Rend `GO`, `NO_GO` ou `HUMAN_REVIEW` sur les PR d'agents | Non | Avant toute fusion |

**Aucun agent ne fusionne quoi que ce soit.** L'auto-fusion est un workflow
distinct, désactivé (§6).

---

## 3. Les cinq workflows

| Workflow | Déclencheurs | Permissions | Ce qu'il fait vraiment |
|---|---|---|---|
| `agent-quality-gates.yml` | PR vers `main`, push sur `agent/**` et `audit/**`, manuel | `contents: read` | Structure HTML, liens internes, syntaxe JS, puis ouvre les 17 pages dans Chromium à 3 largeurs (console, réseau, débordement, zones tactiles, axe-core) |
| `scheduled-agent-audit.yml` | Manuel, lundi 06:00 UTC | `contents: read`, + `issues: write` sur le seul job d'audit | Ouvre le **site publié**, classe les anomalies P0–P3, ouvre ou complète une issue si des P0/P1 sont confirmées |
| `agent-auto-fix.yml` | Label `agent-autofix` sur une issue, manuel | `contents: write`, `pull-requests: write`, `issues: write` sur le seul job de correction | Crée une branche, vérifie l'éligibilité, rejoue les portes, ouvre un **brouillon** |
| `agent-conditional-auto-merge.yml` | `pull_request_target` (labeled, ready_for_review, synchronize) | `contents: read`, + `contents/pull-requests: write` sur le seul job de fusion | **Inerte** tant que `AGENT_AUTO_MERGE_ENABLED` ≠ `true` |
| `production-smoke-test.yml` | `page_build`, quotidien 07:00 UTC, manuel | `contents: read` | Ouvre la production sur mobile et ordinateur : HTTP, titre, contenu rendu, CSS, JS, liens, débordement, erreurs JS, ressources du site en échec |

### Deux points de sécurité à ne pas perdre de vue

- `agent-conditional-auto-merge.yml` utilise `pull_request_target`, qui
  s'exécute avec les droits du dépôt de base. Il ne fait **jamais** de checkout
  de la branche proposée : ce serait exécuter du code non relu avec un jeton
  privilégié. Il ne lit que des métadonnées et les listes de la base.
- `verifier-eligibilite-autofix.mjs` lit l'allowlist et la denylist depuis la
  **branche de base**. Sinon, une pull request qui viderait l'allowlist se
  déclarerait elle-même éligible.

---

## 4. Chemins autorisés et interdits

La source de vérité est `.github/agent-policy/`. La **denylist est prioritaire**
sur l'allowlist.

**Autorisé à la correction automatique** (`auto-merge-allowlist.txt`) :
`**/*.css`, `docs/**`, `.github/agent-tests/**`.

**Interdit** (`auto-merge-denylist.txt`, 26 motifs) : `.github/**`,
`.claude/**`, `shared/auth-gate.js`, `shared/admin.html`, `supabase/**`,
`savoir-plus/**`, `sw.js`, `i18n-sw.js`, `manifest.webmanifest`, `.nojekyll`,
`CNAME`, tout `*.html`, tout `*.js` applicatif, les modules métier, les
ressources, `**/.env*`, `**/*secret*`, `**/*credential*`, `package.json` et
`package-lock.json`.

### Pourquoi le HTML est exclu, alors que la consigne l'autorisait

La politique demandait d'autoriser le « HTML de présentation ». Sur FBMS, il
n'existe pas : la présentation et la logique métier vivent dans les **mêmes
fichiers**. `fbms/index.html` contient la mise en page *et* les appels
Supabase. Aucune règle de chemin ne peut distinguer les deux.

Autoriser `*.html` reviendrait donc à autoriser la correction automatique de la
logique métier. La déviation est documentée dans `agent-policy.yml`, section
`deviations`. Si les feuilles de style sont un jour extraites, l'allowlist
pourra être élargie — pas avant.

Toute modification hors allowlist doit porter le label `human-review`.

---

## 5. Variables et secrets

### Variables de dépôt — à créer manuellement

`Settings → Secrets and variables → Actions → onglet **Variables** → New repository variable`

| Nom | Valeur à l'installation |
|---|---|
| `AI_AGENTS_ENABLED` | `false` |
| `AGENT_AUTO_MERGE_ENABLED` | `false` |
| `AGENT_AUTO_FIX_ENABLED` | `false` |
| `PRODUCTION_URL` | `https://nwodobe.github.io/fbms/index.html` |

### Secrets — seulement si vous invoquez Claude Code depuis un workflow

`Settings → Secrets and variables → Actions → onglet **Secrets** → New repository secret`

| Nom | Nécessaire quand |
|---|---|
| `ANTHROPIC_API_KEY` | Un workflow appelle `anthropics/claude-code-action@v1` |
| `APP_ID` | Vous voulez que les PR d'agents soient signées par une GitHub App plutôt que par `GITHUB_TOKEN` |
| `APP_PRIVATE_KEY` | Idem |

**Aucun des workflows installés n'en a besoin en l'état.** Ils fonctionnent avec
le `GITHUB_TOKEN` fourni automatiquement. Ces secrets ne deviennent nécessaires
que le jour où vous ajoutez une étape `claude-code-action`.

### Règles, sans exception

- Un secret ne s'affiche jamais dans un journal ni dans un fichier commis.
- On vérifie qu'un secret **existe** ; on ne lit jamais sa valeur.
- Ne collez jamais une clé dans une conversation, un ticket ou une PR.
- Une clé qui a été affichée quelque part est une clé à révoquer, pas à cacher.

---

## 6. Activation

Dans cet ordre. Chaque étape se vérifie avant de passer à la suivante.

1. **Fusionner la PR d'installation** après relecture humaine.
2. **Protéger `main`** : `Settings → Branches → Add rule`. Exiger les contrôles
   `Structure, liens et syntaxe` et `Exécution des pages, console et
   accessibilité`. Sans cela, l'auto-fusion — le jour où vous l'activerez —
   n'attendrait rien.
3. **Créer les variables** de la §5, toutes à `false`.
4. **Vérifier que les portes tournent** : ouvrir une PR quelconque et constater
   que les deux contrôles s'exécutent.
5. **Passer `AI_AGENTS_ENABLED=true`.** L'audit et le smoke test deviennent
   actifs. Laisser les deux autres interrupteurs à `false`.
6. **Exécuter le canari** (§8).
7. **`AGENT_AUTO_FIX_ENABLED=true`** seulement si le canari a produit une
   branche et une PR contenant uniquement le fichier demandé.
8. **`AGENT_AUTO_MERGE_ENABLED=true`** : décision distincte, après plusieurs
   semaines d'observation, et jamais avant l'étape 2.

---

## 7. Arrêt et retour arrière

### Arrêt immédiat, sans toucher au code

Passer `AI_AGENTS_ENABLED` à `false`. Tous les workflows d'agents s'arrêtent à
leur premier job et l'écrivent dans leur résumé. C'est réversible et cela ne
laisse aucune trace dans l'historique.

### Arrêt d'un seul comportement

| Pour arrêter | Passer à `false` |
|---|---|
| L'auto-fusion | `AGENT_AUTO_MERGE_ENABLED` |
| Les corrections automatiques | `AGENT_AUTO_FIX_ENABLED` |
| Tout | `AI_AGENTS_ENABLED` |

### Arrêt complet

`Settings → Actions → General → Disable actions`. Cela arrête aussi
`savoir-plus-ci.yml` — à savoir avant de le faire.

### Retour arrière

- **Une PR d'agent déjà fusionnée** : `Revert` sur la PR. Les correctifs
  d'agents sont contraints au plus petit patch possible, précisément pour que
  ce geste reste sûr.
- **L'installation entière** : `git revert` du commit de fusion de la PR
  d'installation. Rien dans cette installation ne modifie le site publié : il
  n'y a donc rien à redéployer.
- **Une publication cassée** : `git revert` puis attendre la republication
  Pages. `production-smoke-test.yml` se déclenche sur `page_build` et confirmera
  le retour à la normale.

> **Le service worker est le seul point non trivial.** Un `sw.js` fautif reste
> dans le cache des navigateurs après le correctif. C'est la raison pour
> laquelle `sw.js` et `i18n-sw.js` sont en denylist : leur retour arrière ne
> dépend pas de vous.

---

## 8. Le canari

À exécuter après l'activation, avant de faire confiance à quoi que ce soit.
Il teste la chaîne complète sur un fichier de **documentation** — jamais sur le
code applicatif.

1. Passer `AI_AGENTS_ENABLED=true`, laisser `AGENT_AUTO_MERGE_ENABLED=false`.
2. `Actions → Audit planifié des agents → Run workflow`.
3. **Vérifier que le job n'est pas `skipped`.** S'il l'est, la variable n'est
   pas lue : vérifier qu'elle est une *variable de dépôt* et non un secret.
4. Ouvrir le résumé d'exécution : il doit contenir un tableau d'anomalies, ou
   la mention qu'aucune n'a été trouvée. Une exécution vide n'est pas un succès.
5. Créer une issue intitulée `[CANARI] Corriger une coquille dans
   AI_AGENT_OPERATIONS.md`, décrivant une correction **minuscule** dans ce
   fichier. Lui poser le label `agent-autofix`.
6. Vérifier qu'une branche `agent/auto-fix-<id>` est créée et qu'une PR
   **brouillon** est ouverte.
7. **Vérifier que la PR ne modifie que le fichier demandé.** C'est le contrôle
   central du canari : un correctif qui déborde invalide tout le reste.
8. Attendre les portes qualité. Les deux doivent être vertes.
9. Demander son verdict au `release-guardian-agent`.
10. Fermer le canari : fermer la PR sans fusionner, supprimer la branche.

**Le canari est concluant** si, et seulement si : le job n'a pas été `skipped`,
l'audit a produit un rapport cité, la PR existe, elle ne touche qu'un fichier,
les portes sont vertes et le gardien a rendu une décision motivée.

---

## 9. Procédure de test

Les contrôles s'exécutent à la main, sans installation particulière hors
Playwright :

```bash
node .github/scripts/verifier-html.mjs
node .github/scripts/verifier-liens.mjs
node .github/scripts/verifier-js.mjs

npm install --no-save playwright@1.49.1 && npx playwright install chromium
node .github/scripts/verifier-pages.mjs --json observations.json

PRODUCTION_URL=https://nwodobe.github.io/fbms/index.html \
  node .github/scripts/smoke-production.mjs
PRODUCTION_URL=https://nwodobe.github.io/fbms/index.html \
  node .github/scripts/auditer-production.mjs --markdown audit.md
```

Trois largeurs, toujours : **390×844**, **768×1024**, **1440×900**.

### Les référentiels

`.github/agent-policy/*-baseline.json` liste les défauts **déjà présents** sur
`main`. Sans eux, les portes seraient rouges dès le premier jour et personne ne
les lirait. Chaque entrée porte la description du vrai problème.

**Un référentiel date un défaut, il ne l'absout pas.** Y ajouter une ligne pour
faire passer une porte sur un défaut qu'on vient d'introduire est un
contournement — et c'est exactement ce que ces fichiers rendent visible.

---

## 10. Limites connues de cette installation

Dites franchement, parce qu'une limite tue plus sûrement quand elle est ignorée.

- **Aucun agent ne rédige de correctif tout seul.** `agent-auto-fix.yml` met en
  place la mécanique — branche, contrôle d'éligibilité, portes, brouillon — mais
  le correctif vient de `auto-fix-agent` exécuté par Claude Code. Brancher cette
  invocation dans le workflow est une décision à prendre séparément, et elle
  exige `ANTHROPIC_API_KEY`.
- **Les parcours authentifiés ne sont pas testés.** FBMS est protégé par
  `shared/auth-gate.js` et par les politiques RLS. Sans compte de test dédié,
  les contrôles ne voient que ce que voit un visiteur non connecté. C'est une
  couverture réelle, mais partielle — et il ne faut pas la présenter autrement.
- **Les CDN tiers sont doublés dans les portes**, jamais dans l'audit de
  production. Une porte de fusion ne doit pas rougir parce qu'un CDN a eu un
  hoquet ; un audit de production, si — c'est un fait que subit l'utilisateur.
- **Le réseau lent n'est pas mesuré.** Playwright peut le simuler ; aucun seuil
  n'a été défini pour FBMS, et un seuil inventé ne mesurerait rien.
- **`savoir-plus/` est hors périmètre** de bout en bout.
