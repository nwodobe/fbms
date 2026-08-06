# FBMS — Opérations de l'équipe d'agents IA

Mode d'emploi de l'orchestration **Claude Code + GitHub Actions** installée dans
`nwodobe/fbms` pour le site statique **ANAGROCI FBMS**.

> **État par défaut : INSTALLÉ MAIS INACTIF.** Les fichiers existent et sont
> valides, mais rien ne s'exécute tant que `AI_AGENTS_ENABLED` n'est pas passé à
> `true` et que les secrets ne sont pas configurés. Voir §Activation.

---

## 1. Créé vs Déclenché vs Opérationnel

Trois états à ne pas confondre :

- **Créé** : le fichier de l'agent/workflow existe dans le dépôt et est
  syntaxiquement valide. *(C'est l'état livré par la PR d'installation.)*
- **Déclenché** : un événement (PR, label, planification, exécution manuelle) a
  lancé le workflow correspondant. Un workflow peut être déclenché puis
  **`skipped`** si `AI_AGENTS_ENABLED != true`.
- **Opérationnel** : une exécution réelle a produit le résultat attendu de bout
  en bout (audit → issue → correctif → PR → tests → gardien), avec preuves.

Un agent **créé** n'est pas **opérationnel**. Seul le **canari** (§7) prouve le
caractère opérationnel.

---

## 2. Les agents (rôle · déclencheur · chemins)

| Agent | Rôle | Déclencheur | Écrit | Chemins |
|-------|------|-------------|-------|---------|
| `app-orchestrator` | coordination, verrou fichier | orchestrateur / manuel | non | lecture seule |
| `ui-design-agent` | design & responsive | sous-tâche design | présentation, après reproduction | allowlist (HTML/CSS) |
| `ux-navigation-agent` | navigation & UX | sous-tâche navigation | non | rapport |
| `qa-continuous-agent` | tests & contrôles | Quality Gates | tests seulement | `.github/agent-scripts/**`, `docs/**` |
| `app-audit-agent` | audit indépendant | Scheduled Audit | non | lecture + WebFetch |
| `auto-fix-agent` | correctif minimal + PR | label `agent-autofix` | allowlist seulement | voir allowlist |
| `release-guardian-agent` | verdict GO/NO_GO/HUMAN_REVIEW | PR d'agent | non | lecture + gates |

Détail complet dans chaque fichier `.claude/agents/*.md`.

### Chemins autorisés (auto-correction)
Fait foi : `.github/agent-policy/auto-merge-allowlist.txt`
(HTML de présentation, `**/*.css`, `docs/**`, `assets/img/**`,
`.github/agent-scripts/**`).

### Chemins interdits (jamais d'auto-correction — label `human-review` requis)
Fait foi : `.github/agent-policy/auto-merge-denylist.txt`
(`.github/**`, `.claude/**`, `supabase/**`, `savoir-plus/**`,
`shared/auth-gate.js` et fichiers d'auth/sécurité, secrets/clés,
`manifest.webmanifest`, `sw.js`, verrous de dépendances). **La denylist prime
toujours sur l'allowlist.**

---

## 3. Workflows GitHub Actions

| Workflow | Fichier | Déclencheurs | Garde | Écrit |
|----------|---------|--------------|-------|-------|
| Agent Quality Gates | `agent-quality-gates.yml` | PR→main, push `agent/**`, manuel | — | non |
| Scheduled Agent Audit | `scheduled-agent-audit.yml` | hebdo + manuel | `AI_AGENTS_ENABLED` + `PRODUCTION_URL` | issue |
| Agent Auto Fix | `agent-auto-fix.yml` | label `agent-autofix` sur issue | `AI_AGENTS_ENABLED` | branche + PR |
| Agent Conditional Auto Merge | `agent-conditional-auto-merge.yml` | PR labellisée | `AGENT_AUTO_MERGE_ENABLED` (**false**) | fusion (désactivée) |
| Production Smoke Test | `production-smoke-test.yml` | push main, PR→main, manuel | — | non |

Les Quality Gates et le Smoke Test **ne dépendent pas** de Claude et tournent
dès la fusion. Les workflows « agents » (Audit, Auto Fix, Auto Merge) restent
inertes tant que les variables/secrets ne sont pas posés.

---

## 4. Variables et secrets

### Variables (Settings → Secrets and variables → Actions → **Variables**)
```
AI_AGENTS_ENABLED        = false
AGENT_AUTO_MERGE_ENABLED = false
PRODUCTION_URL           = https://nwodobe.github.io/fbms/index.html
```

### Secrets (Settings → Secrets and variables → Actions → **Secrets**)
Selon le mode d'authentification de `anthropics/claude-code-action@v1` :
```
ANTHROPIC_API_KEY        (clé API Anthropic)         — requis
# Écritures branche/PR via une App GitHub à privilèges limités (recommandé) :
APP_ID                   (id de l'App GitHub)
APP_PRIVATE_KEY          (clé privée .pem de l'App)
```
> **Ne collez jamais une clé dans le chat ni dans un fichier commité.** Les
> valeurs se saisissent uniquement dans l'UI GitHub. Aucune valeur n'est
> inventée par l'installation.

Étapes manuelles exactes :
1. `Settings → Secrets and variables → Actions`.
2. Onglet **Variables** → *New repository variable* → ajouter les 3 variables.
3. Onglet **Secrets** → *New repository secret* → ajouter `ANTHROPIC_API_KEY`
   (et, si App GitHub, `APP_ID` + `APP_PRIVATE_KEY`).

---

## 5. Procédure de test (local)

Le site est statique ; on le sert puis on le pilote avec Playwright.
```bash
# Depuis la racine du dépôt
npx --yes http-server -p 8080 -c-1 .            # sert le site
# Dans un autre terminal :
node .github/agent-scripts/link-check.mjs http://localhost:8080/index.html
node .github/agent-scripts/console-check.mjs   http://localhost:8080/index.html
npx --yes playwright test -c .github/agent-scripts/playwright.config.mjs
```
Le smoke test de production (Pages) est joué par le workflow
`Production Smoke Test` (il atteint `PRODUCTION_URL` depuis les runners GitHub).

---

## 6. Permissions (moindre privilège)

- Quality Gates, Smoke Test : `contents: read`.
- Jobs `claude-code-action` : `contents: read`, `id-token: write`.
- Écritures branche/PR (Auto Fix) : via un **jeton d'App GitHub** limité
  (`actions/create-github-app-token`) — jamais le `GITHUB_TOKEN` élargi.
- Auto Merge : `contents: write`, `pull-requests: write`, **mais** le workflow
  est verrouillé par `AGENT_AUTO_MERGE_ENABLED=false`.

---

## 7. Canari (obligatoire avant tout usage réel)

À exécuter **après** configuration manuelle des secrets/variables :
1. Passer `AI_AGENTS_ENABLED=true`.
2. Laisser `AGENT_AUTO_MERGE_ENABLED=false`.
3. Lancer manuellement `Scheduled Agent Audit` (onglet Actions → Run workflow).
4. Vérifier que le job **ne passe pas `skipped`** (preuve que le flag est lu).
5. Créer une **issue canari** documentaire, label `agent-autofix`, demandant une
   correction minuscule dans `docs/AI_AGENT_OPERATIONS.md` (ex. corriger une
   coquille).
6. Vérifier que `auto-fix-agent` crée **une branche + une PR**.
7. Vérifier que **seul le fichier demandé** est modifié.
8. Attendre tous les **Quality Gates**.
9. Demander la décision de `release-guardian-agent` (`GO` / `NO_GO` /
   `HUMAN_REVIEW`).
> Ne jamais tester l'auto-correction initiale sur le **code applicatif** :
> utiliser la documentation.

---

## 8. Procédure d'arrêt (kill switch)

Dans l'ordre, du plus doux au plus radical :
1. **Désactiver** : `AI_AGENTS_ENABLED=false` → tous les jobs d'agents
   redeviennent inertes (`skipped`). Effet immédiat, aucun code touché.
2. **Auto-fusion** : vérifier `AGENT_AUTO_MERGE_ENABLED=false` (défaut).
3. **Suspendre un workflow** : Actions → sélectionner le workflow → *Disable
   workflow*.
4. **Révoquer** : retirer `ANTHROPIC_API_KEY` (et l'App GitHub) des secrets.

---

## 9. Procédure de retour arrière (rollback)

- Une PR d'agent problématique : la **fermer sans fusionner** (aucun impact,
  l'auto-fusion est désactivée).
- Un correctif déjà fusionné : `git revert <sha>` sur une branche + PB, puis
  fusion humaine. Pages redéploie automatiquement après fusion sur `main`.
- Retirer entièrement l'installation : `git revert` de la PR d'installation, ou
  supprimer `.claude/`, `.github/workflows/agent-*.yml`,
  `.github/agent-policy/`, `agent-policy.yml`, `docs/AI_AGENT_OPERATIONS.md`.

---

## 10. Limites connues

- Les pages FBMS sont protégées par `auth-gate.js` : un audit sans session ne
  voit que l'écran de connexion. Les parcours authentifiés exigent un **compte
  de test** dédié (à créer par le Branch Manager) ; ils ne sont jamais déclarés
  « testés » sans preuve.
- Le site n'a pas de tests unitaires ni de gestionnaire de paquets à la racine :
  les Quality Gates n'exécutent que des contrôles réellement applicables
  (validation HTML, `node --check`, liens, Playwright, erreurs console). Aucune
  commande fictive n'est déclarée.
- L'`app-audit-agent` a besoin de `PRODUCTION_URL` accessible ; sinon son job se
  termine sans audit.
