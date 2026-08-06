#!/usr/bin/env node
/**
 * Contrôle de syntaxe des fichiers JavaScript du site statique.
 *
 * `node --check` analyse sans exécuter : aucun effet de bord, aucun réseau,
 * aucune dépendance. C'est peu, et c'est assumé — mais une erreur de syntaxe
 * livrée sur GitHub Pages casse une page entière, en silence, et c'est
 * exactement le genre de défaut qu'une porte doit arrêter.
 *
 * Les fichiers du service worker sont inclus : une syntaxe fautive y empêche
 * l'installation du worker sans qu'aucune page ne le signale.
 *
 * Usage : node .github/scripts/verifier-js.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const REFERENTIEL = '.github/agent-policy/js-baseline.json'
const accepte = existsSync(REFERENTIEL)
  ? new Set(JSON.parse(readFileSync(REFERENTIEL, 'utf8')).accepted)
  : new Set()

const fichiers = execFileSync('git', ['ls-files', '-z', '*.js'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  // `savoir-plus/` est compilé et vérifié par sa propre intégration continue.
  .filter((c) => !c.startsWith('savoir-plus/'))

const fautifs = []

for (const fichier of fichiers) {
  try {
    execFileSync(process.execPath, ['--check', fichier], { stdio: 'pipe' })
  } catch (erreur) {
    const sortie = String(erreur.stderr ?? erreur.message)
      .split('\n')
      .filter((l) => l.trim() !== '')
      .slice(0, 3)
      .join(' | ')
    fautifs.push({ fichier, sortie })
  }
}

const historiques = fautifs.filter((f) => accepte.has(f.fichier))
const nouveaux = fautifs.filter((f) => !accepte.has(f.fichier))

for (const f of historiques) {
  process.stdout.write(`~ historique ${f.fichier}\n`)
}
for (const f of nouveaux) {
  process.stdout.write(`✗ NOUVEAU    ${f.fichier}\n    ${f.sortie}\n`)
}

process.stdout.write(
  `\n${fichiers.length} fichier(s) JavaScript · ${historiques.length} erreur(s) héritée(s) · ${nouveaux.length} nouvelle(s)\n`,
)
process.exit(nouveaux.length > 0 ? 1 : 0)
