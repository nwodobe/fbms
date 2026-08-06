# CLAUDE.md — Dépôt `nwodobe/fbms`

Ce dépôt héberge **deux produits** :

1. **ANAGROCI FBMS** — à la **racine** : un **site statique** (HTML/CSS/JS, sans
   build ni bundler), publié par **GitHub Pages**
   (`https://nwodobe.github.io/fbms/index.html`). Backend **Supabase**
   (authentification + données ; la clé *anon* est publique par conception).
2. **Savoir+** — dans `savoir-plus/` : application **Next.js + Neon + Drizzle**
   avec sa **propre CI** (`.github/workflows/savoir-plus-ci.yml`). **Hors
   périmètre** de l'équipe d'agents FBMS.

> Ne mélangez jamais les deux : un changement FBMS ne touche pas `savoir-plus/`
> et inversement.

## Application FBMS — repères
- Pas de `package.json` à la racine, **aucune étape de build**. Les pages sont
  servies telles quelles.
- Chrome commun : `shared/auth-gate.js` (connexion + contrôle de rôle),
  `shared/suite-bar.js` (barre de navigation), `shared/pjs-theme.css` et
  compagnie (design system PJS).
- Tests : **Playwright** (headless), lancé à la main / en CI. Servir le site en
  local (`npx http-server` ou équivalent) puis piloter les pages.

## Équipe d'agents IA (Claude Code + GitHub Actions)
Installée dans `.claude/agents/` et `.github/workflows/`. **Séparation stricte
des rôles** :

| Agent | Écrit du code ? | Fonction |
|-------|------------------|----------|
| `app-orchestrator` | non | coordonne, sérialise les écritures par fichier |
| `ui-design-agent` | présentation, **après reproduction** | design/responsive |
| `ux-navigation-agent` | non (rapport) | navigation/UX |
| `qa-continuous-agent` | tests uniquement | tests & contrôles |
| `app-audit-agent` | non | audit indépendant |
| `auto-fix-agent` | allowlist seulement | plus petit correctif + PR (jamais de fusion) |
| `release-guardian-agent` | non | verdict `GO` / `NO_GO` / `HUMAN_REVIEW` |

### Règles non négociables
- **Ne jamais modifier `main` directement.** Toujours une branche + une PR.
- **Denylist prioritaire** : voir `.github/agent-policy/auto-merge-denylist.txt`.
  Interdit à l'auto-correction : `.github/**`, `.claude/**`, `supabase/**`,
  `savoir-plus/**`, `shared/auth-gate.js` et autres fichiers d'auth/sécurité,
  secrets, `manifest.webmanifest`, `sw.js`, verrous de dépendances.
- L'auto-correction n'agit que sur des anomalies **reproduites**, **faible
  risque**, **dans l'allowlist**, avec **test de non-régression** et **patch
  minimal**.
- L'auto-fusion est **désactivée** (`AGENT_AUTO_MERGE_ENABLED=false`).
- Interrupteur maître : `AI_AGENTS_ENABLED` (défaut `false`).

La politique lisible se trouve dans `agent-policy.yml` ; le mode d'emploi
opérationnel (déclencheurs, secrets, tests, arrêt, retour arrière) dans
`docs/AI_AGENT_OPERATIONS.md`.

## Conventions de contribution
- Français pour l'UI et la documentation.
- Petits diffs, une intention par PR, preuve d'exécution jointe.
- Ne jamais committer de secret ni afficher une clé dans un log.
