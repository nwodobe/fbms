/**
 * SEC-16 · aucun secret dans les fichiers suivis par git.
 *
 * Ce test existe parce que la fuite de secret est une erreur qu'on ne commet
 * qu'une fois mais qu'on ne peut jamais vraiment annuler : un dépôt Git garde
 * l'historique. Mieux vaut échouer en local qu'expliquer une rotation de clés.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

/** Motifs qui ne doivent apparaître dans aucun fichier versionné. */
const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: 'JWT (clé Supabase complète)', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { label: 'clé service_role assignée', pattern: /service_role[_a-z]*\s*[:=]\s*['"][A-Za-z0-9._-]{20,}['"]/i },
  { label: 'clé secrète Supabase', pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { label: 'clé privée', pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: 'jeton d’accès GitHub', pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { label: 'clé AWS', pattern: /AKIA[0-9A-Z]{16}/ },
  { label: 'clé OpenAI', pattern: /sk-[A-Za-z0-9]{32,}/ },
  { label: 'mot de passe en dur', pattern: /(password|mot_de_passe)\s*[:=]\s*['"](?!.*(exemple|example|test|demo|\$\{|votre))[^'"]{8,}['"]/i },
]

/** Fichiers qui décrivent légitimement des motifs de secrets, dont celui-ci. */
const SELF_REFERENTIAL = ['tests/unit/no-secrets.test.ts']

/**
 * Fichiers suivis **et** fichiers non encore commités mais non ignorés.
 *
 * N'analyser que le suivi laisserait passer un secret jusqu'au commit — c'est-à-dire
 * jusqu'au moment où il devient irréversible. Ce qui compte ici, c'est ce qui est
 * sur le point de partir.
 */
function trackedFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return [...new Set(output.split('\n').filter(Boolean))]
}

function isTextFile(path: string): boolean {
  return !/\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|eot|mp4|docx?|xlsx?)$/i.test(path)
}

describe('SEC-16 · aucun secret commité', () => {
  const files = trackedFiles().filter(
    (file) => isTextFile(file) && !SELF_REFERENTIAL.includes(file),
  )

  it('trouve bien des fichiers à analyser', () => {
    // Un test qui n'inspecte rien passerait toujours : c'est le pire des faux
    // sentiments de sécurité.
    expect(files.length).toBeGreaterThan(10)
  })

  it('aucun fichier versionné ne contient de secret', () => {
    const findings: string[] = []

    for (const file of files) {
      const absolute = join(REPO_ROOT, file)
      try {
        if (statSync(absolute).size > 2_000_000) continue
      } catch {
        continue
      }

      const content = readFileSync(absolute, 'utf8')
      for (const { label, pattern } of FORBIDDEN) {
        if (pattern.test(content)) {
          findings.push(`${file} → ${label}`)
        }
      }
    }

    expect(findings).toEqual([])
  })

  it('aucun fichier .env réel n’est versionné', () => {
    const envFiles = trackedFiles().filter(
      (file) => /(^|\/)\.env/.test(file) && !file.endsWith('.env.example'),
    )
    expect(envFiles).toEqual([])
  })

  it('.env.example ne contient que des noms de variables, sans valeur', () => {
    const content = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8')
    const assignments = content
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .filter((line) => {
        const value = line.split('=').slice(1).join('=').trim()
        // Les valeurs de développement local (port, hôte, nom de base) sont
        // acceptables ; une chaîne longue ressemblerait à une clé.
        return value.length > 24
      })
    expect(assignments).toEqual([])
  })

  it('aucune variable VITE_ ne porte un nom de secret', () => {
    const content = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8')
    const dangerous = content
      .split('\n')
      .filter((line) => /^VITE_/.test(line))
      .filter((line) => /(service_role|secret|private)/i.test(line))
    // Tout ce qui est préfixé VITE_ finit dans le bundle, donc public.
    expect(dangerous).toEqual([])
  })
})
