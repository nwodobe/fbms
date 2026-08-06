#!/usr/bin/env node
/**
 * Contrôle des liens et ressources internes de FBMS.
 *
 * On ne vérifie QUE l'interne. Un lien externe qui tombe est une information
 * utile, mais son échec dépend du réseau du moment : en faire une porte
 * bloquante rendrait l'intégration continue instable pour une raison qui
 * n'appartient pas au dépôt. Les hôtes externes sont donc listés, pas testés.
 *
 * Usage : node .github/scripts/verifier-liens.mjs
 * Sortie : 0 si toutes les cibles internes existent, 1 sinon.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, normalize } from 'node:path'

const suivis = new Set(
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean),
)

const pages = [...suivis].filter((c) => c.endsWith('.html') && !c.startsWith('savoir-plus/'))

/** Attributs qui désignent une ressource ou une destination. */
const MOTIF = /\s(?:href|src)\s*=\s*["']([^"']+)["']/gi

const REFERENTIEL = '.github/agent-policy/liens-baseline.json'
const accepte = existsSync(REFERENTIEL)
  ? new Set(JSON.parse(readFileSync(REFERENTIEL, 'utf8')).accepted)
  : new Set()

const casses = []
const externes = new Map()

for (const page of pages) {
  const html = readFileSync(page, 'utf8')
  const base = dirname(page)

  for (const trouve of html.matchAll(MOTIF)) {
    const brut = trouve[1].trim()
    if (brut === '' || brut.startsWith('#')) continue
    if (/^(data|blob|javascript|mailto|tel):/i.test(brut)) continue

    // Gabarit JavaScript (`${…}`) ou substitution de moteur de rendu : la
    // valeur n'est connue qu'à l'exécution, il n'y a rien à vérifier ici.
    // Sans cette ligne, le script accusait `index.html` d'un lien mort qui
    // n'est qu'une variable — un faux positif, et le pire ennemi d'une porte.
    if (brut.includes('${') || brut.includes('{{')) continue

    if (/^https?:\/\//i.test(brut)) {
      const hote = new URL(brut).host
      externes.set(hote, (externes.get(hote) ?? 0) + 1)
      continue
    }
    if (brut.startsWith('//')) {
      externes.set(brut.split('/')[2], (externes.get(brut.split('/')[2]) ?? 0) + 1)
      continue
    }

    // Chemin interne : on retire la chaîne de cache (`?v=…`) et l'ancre.
    const chemin = brut.split('#')[0].split('?')[0]
    if (chemin === '') continue

    const cible = chemin.startsWith('/')
      ? normalize(chemin.slice(1))
      : normalize(join(base, chemin))

    // Un répertoire est servi par son index.html sur GitHub Pages.
    const candidats = [cible, join(cible, 'index.html')]
    const trouvee = candidats.some(
      (c) => suivis.has(c) || (existsSync(c) && (statSync(c).isFile() || existsSync(join(c, 'index.html')))),
    )

    if (!trouvee) casses.push({ page, lien: brut, cible })
  }
}

const cle = (c) => `${c.page}|${c.lien}`
const historiques = casses.filter((c) => accepte.has(cle(c)))
const nouveaux = casses.filter((c) => !accepte.has(cle(c)))

for (const c of historiques) {
  process.stdout.write(`~ historique ${c.page} → ${c.lien}\n`)
}
for (const c of nouveaux) {
  process.stdout.write(`✗ NOUVEAU    ${c.page} → ${c.lien}  (cible attendue : ${c.cible})\n`)
}

process.stdout.write(
  `\n${pages.length} page(s) · ${historiques.length} lien(s) cassé(s) hérité(s) · ${nouveaux.length} nouveau(x)\n`,
)
process.stdout.write('\nHôtes externes référencés (non testés, dépendances de disponibilité) :\n')
for (const [hote, n] of [...externes.entries()].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${String(n).padStart(3)} × ${hote}\n`)
}

process.exit(nouveaux.length > 0 ? 1 : 0)
