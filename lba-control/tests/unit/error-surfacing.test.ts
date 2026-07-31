/**
 * Phase 7 · les erreurs sont affichées.
 *
 * Condition de livraison de la commande §27 : « les erreurs sont affichées
 * clairement ». Ce test la rend vérifiable au lieu de la laisser à
 * l'appréciation.
 *
 * Un écran qui écrit en base sans jamais montrer l'échec est le pire cas
 * possible : l'utilisateur croit avoir enregistré, ferme l'application, et
 * découvre trois jours plus tard que son achat n'existe pas. Le serveur avait
 * raison de refuser ; c'est l'écran qui a menti par omission.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FEATURES = join(process.cwd(), 'src/features')

interface Screen {
  path: string
  code: string
}

function screens(): Screen[] {
  const out: Screen[] = []

  for (const feature of readdirSync(FEATURES, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue
    const dir = join(FEATURES, feature.name)

    for (const file of readdirSync(dir)) {
      // Les écrans commencent par une majuscule ; `api.ts` n'affiche rien.
      if (!file.endsWith('.tsx') || !/^[A-Z]/.test(file)) continue
      out.push({ path: `${feature.name}/${file}`, code: readFileSync(join(dir, file), 'utf8') })
    }
  }

  return out
}

describe('AUDIT · affichage des erreurs', () => {
  const all = screens()

  it('trouve bien les écrans à contrôler', () => {
    expect(all.length).toBeGreaterThan(10)
  })

  it('tout écran qui écrit affiche aussi ses échecs', () => {
    const offenders = all
      .filter((screen) => /\.mutate\(|\.mutateAsync\(/.test(screen.code))
      .filter((screen) => !screen.code.includes('role="alert"'))
      .map((screen) => screen.path)

    expect(offenders).toEqual([])
  })

  it('tout écran qui charge annonce son attente', () => {
    const offenders = all
      .filter((screen) => /isLoading/.test(screen.code))
      .filter((screen) => !screen.code.includes('role="status"'))
      .map((screen) => screen.path)

    // Un écran vide pendant trois secondes se lit comme « il n'y a rien »,
    // pas comme « ça charge ».
    expect(offenders).toEqual([])
  })

  it('aucun écran n’avale une erreur en silence', () => {
    const offenders = all
      .filter((screen) => /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(screen.code))
      .map((screen) => screen.path)

    expect(offenders).toEqual([])
  })

  it('les messages d’erreur passent par le traducteur commun', () => {
    const apis = readdirSync(FEATURES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(FEATURES, entry.name, 'api.ts'))
      .filter((path) => {
        try {
          readFileSync(path)
          return true
        } catch {
          return false
        }
      })

    const offenders = apis
      .map((path) => ({ path, code: readFileSync(path, 'utf8') }))
      .filter(({ code }) => code.includes('error') && !code.includes('describeError'))
      .map(({ path }) => path.replace(`${FEATURES}/`, ''))

    // « duplicate key value violates unique constraint … » affiché tel quel
    // n'aide personne et donne l'impression que l'application est cassée.
    expect(offenders).toEqual([])
  })
})
