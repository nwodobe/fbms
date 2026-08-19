#!/usr/bin/env node
/**
 * La politique de chemins dit-elle la même chose partout ?
 *
 * Deux garde-fous appliquent la même denylist par deux chemins de code
 * différents :
 *   · `.claude/hooks/guard-paths.sh` — au moment où un agent écrit ;
 *   · `.github/scripts/verifier-eligibilite-autofix.mjs` — en intégration
 *     continue, avant toute fusion.
 *
 * S'ils n'interprètent pas les motifs de la même façon, la politique dit deux
 * choses selon l'endroit où on la lit — et c'est toujours la lecture la plus
 * permissive qui l'emporte en pratique. Ce test existe parce que cela s'est
 * produit, deux fois, à l'installation :
 *
 *   1. `rel.lstrip("./")` retirait tout caractère « . » ou « / » en tête au lieu
 *      du seul préfixe « ./ » : `.github/…` devenait `github/…`, et TOUTE
 *      l'infrastructure d'agents échappait au hook.
 *   2. `fnmatch` laisse « * » traverser les « / » : le motif `.github/*` bloquait
 *      `.github/agent-tests/**`, que l'allowlist doit ouvrir — donc
 *      `auto-fix-agent` n'aurait jamais pu écrire le test de non-régression que
 *      la politique lui impose de fournir.
 *
 * Usage : node .github/agent-tests/politique-chemins.mjs
 * Sortie : 0 si le hook se comporte comme attendu et si les tests de
 * non-régression applicatifs raccordés au harnais passent, 1 sinon.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const HOOK = '.claude/hooks/guard-paths.sh'
if (!existsSync(HOOK)) {
  process.stderr.write(`${HOOK} est introuvable : rien à vérifier.\n`)
  process.exit(1)
}

const RACINE = process.cwd()

/** Ce que la politique DOIT refuser. Un « passe » ici est une faille. */
const DOIVENT_ETRE_BLOQUES = [
  '.github/workflows/agent-auto-fix.yml',
  '.github/scripts/verifier-html.mjs',
  '.github/agent-policy/auto-merge-denylist.txt',
  '.github/vendor/axe.min.js',
  '.claude/settings.json',
  '.claude/hooks/guard-paths.sh',
  '.claude/agents/auto-fix-agent.md',
  'agent-policy.yml',
  'CLAUDE.md',
  'shared/auth-gate.js',
  'shared/admin.html',
  'shared/anagroci-config.js',
  'supabase/rls.sql',
  'supabase/functions/admin-create-user/index.ts',
  'sw.js',
  'i18n-sw.js',
  'manifest.webmanifest',
  '.nojekyll',
  'index.html',
  'fbms/index.html',
  'terrain/achats.html',
  'logistique/alis_fbms.html',
  'savoir-plus/package.json',
  'savoir-plus/.env.example',
  '.env',
  '.env.local',
  'assets/logo.svg',
  'icon-192.png',
]

/** Ce que la politique DOIT laisser passer. Un « bloqué » ici rend un agent inutile. */
const DOIVENT_ETRE_AUTORISES = [
  '.github/agent-tests/parcours-pratiques.mjs',
  '.github/agent-tests/sacherie-pilotage.mjs',
  '.github/agent-tests/README.md',
  'docs/AI_AGENT_OPERATIONS.md',
  'docs/RISKS.md',
  'shared/anagroci-ui.css',
  'fbms/style.css',
]

/** @returns true si le hook BLOQUE ce chemin (sortie 2 = refus). */
function bloque(chemin) {
  try {
    execFileSync('bash', [HOOK], {
      input: JSON.stringify({ tool_input: { file_path: `${RACINE}/${chemin}` } }),
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    return false
  } catch (erreur) {
    if (erreur.status === 2) return true
    throw new Error(`${HOOK} a quitté avec le code ${erreur.status} sur « ${chemin} »`)
  }
}

const echecs = []
for (const chemin of DOIVENT_ETRE_BLOQUES) {
  if (bloque(chemin)) process.stdout.write(`ok  bloqué    ${chemin}\n`)
  else {
    process.stdout.write(`ÉCHEC passe     ${chemin}\n`)
    echecs.push(`« ${chemin} » devrait être refusé et ne l'est pas`)
  }
}
for (const chemin of DOIVENT_ETRE_AUTORISES) {
  if (!bloque(chemin)) process.stdout.write(`ok  autorisé  ${chemin}\n`)
  else {
    process.stdout.write(`ÉCHEC bloqué    ${chemin}\n`)
    echecs.push(`« ${chemin} » devrait être autorisé et ne l'est pas`)
  }
}

const total = DOIVENT_ETRE_BLOQUES.length + DOIVENT_ETRE_AUTORISES.length
process.stdout.write(`\n${total - echecs.length}/${total} cas conformes\n`)
for (const e of echecs) process.stdout.write(`  · ${e}\n`)
if (echecs.length > 0) process.exit(1)

// Les tests applicatifs de non-régression autorisés sont raccordés ici afin
// qu'ils soient réellement exécutés par la porte « Cohérence de la politique »
// sans modifier le workflow CI protégé.
execFileSync(process.execPath, ['.github/agent-tests/sacherie-pilotage.mjs'], {
  stdio: 'inherit',
})
