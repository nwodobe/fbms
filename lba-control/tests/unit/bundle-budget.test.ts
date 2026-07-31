/**
 * Phase 7 · budget de chargement initial.
 *
 * Ce test échoue si le premier chargement de l'application grossit au-delà de
 * ce qui est raisonnable sur un téléphone Android d'entrée de gamme en 2G.
 *
 * Le budget est une décision, pas une mesure : il vaut mieux qu'une
 * régression fasse échouer un test aujourd'hui qu'un pisteur abandonne une
 * saisie dans six mois parce que l'écran met vingt secondes à s'ouvrir.
 *
 * Le test se saute de lui-même si `dist/` n'existe pas — il documente alors ce
 * qu'il aurait vérifié, plutôt que de faire échouer une exécution de tests
 * sans build préalable.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIST = join(process.cwd(), 'dist')
const ASSETS = join(DIST, 'assets')

/** Budgets en kilo-octets, non compressés. */
const BUDGET = {
  /** Point d'entrée : ce qui part avant le premier pixel utile. */
  entry: 460,
  /** Total réellement préchargé par le service worker à l'installation. */
  precache: 1_100,
}

const hasBuild = existsSync(ASSETS)
const describeBuild = hasBuild ? describe : describe.skip

describeBuild('AUDIT · budget de chargement', () => {
  const files = hasBuild ? readdirSync(ASSETS) : []
  const sizeKb = (file: string) => statSync(join(ASSETS, file)).size / 1024

  it('le point d’entrée reste sous le budget', () => {
    const entry = files.find((file) => /^index-[^.]+\.js$/.test(file))
    expect(entry, 'point d’entrée introuvable dans dist/assets').toBeDefined()

    const size = sizeKb(entry!)
    expect(size, `point d’entrée à ${Math.round(size)} kB`).toBeLessThan(BUDGET.entry)
  })

  it('les bibliothèques lourdes sont dans des morceaux différés', () => {
    // Recharts, ExcelJS et jsPDF ne doivent jamais rejoindre le point d'entrée :
    // un pisteur qui saisit un achat n'ouvre ni graphique ni tableur.
    const heavy = ['charts', 'exports']
    for (const name of heavy) {
      const chunk = files.find((file) => file.startsWith(`${name}-`))
      expect(chunk, `morceau « ${name} » introuvable — a-t-il été réintégré ?`).toBeDefined()
    }

    const entry = files.find((file) => /^index-[^.]+\.js$/.test(file))!
    const code = readFileSync(join(ASSETS, entry), 'utf8')
    expect(code).not.toContain('recharts')
  })

  it('le préchargement du service worker reste sous le budget', () => {
    const manifest = readdirSync(DIST).find((file) => file.startsWith('sw.js'))
    expect(manifest, 'service worker introuvable').toBeDefined()

    const code = readFileSync(join(DIST, manifest!), 'utf8')
    // Le service worker est minifié : les clés du manifeste ne sont pas
    // entre guillemets.
    const urls = [...code.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]!)
    expect(urls.length).toBeGreaterThan(0)

    const total = urls.reduce((sum, url) => {
      const path = join(DIST, url.replace(/^\//, ''))
      return existsSync(path) ? sum + statSync(path).size / 1024 : sum
    }, 0)

    expect(total, `préchargement de ${Math.round(total)} kB`).toBeLessThan(BUDGET.precache)
  })

  it('aucun morceau différé n’est préchargé', () => {
    const manifest = readdirSync(DIST).find((file) => file.startsWith('sw.js'))!
    const code = readFileSync(join(DIST, manifest), 'utf8')
    // On inspecte les URL du manifeste, pas le fichier entier : la règle de
    // mise en cache à la demande cite légitimement ces mêmes noms.
    const urls = [...code.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]!)

    // Les précharger annulerait le découpage : le pisteur paierait à
    // l'installation ce qu'il n'ouvrira jamais.
    for (const name of ['exports-', 'charts-', 'html2canvas']) {
      const offenders = urls.filter((url) => url.includes(name))
      expect(offenders, `${name} ne doit pas être préchargé`).toEqual([])
    }
  })
})
