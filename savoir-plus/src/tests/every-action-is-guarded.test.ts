/**
 * Savoir+ — A-07 : TOUTE action serveur possède une garde.
 *
 * AUTHORIZATION_MATRIX.md §5 : « Toute Server Action et tout Route Handler
 * commencent par une garde nommée. Sans exception, y compris les lectures. »
 *
 * Une revue de code ne tient pas cette promesse sur la durée : sur un projet
 * de cette taille, une action ajoutée sans garde arrive tôt ou tard. Ce test
 * l'attrape mécaniquement.
 *
 * Il est volontairement écrit pour ÉCHOUER dès qu'un fichier d'action ou de
 * route existe sans appel de garde — y compris aujourd'hui, où il n'y en a
 * encore aucun.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Répertoires dont TOUT fichier exécutable doit appeler une garde. */
const GUARDED_DIRECTORIES = [join(SRC, 'server', 'actions'), join(SRC, 'app', 'api')];

/** Noms de gardes reconnus. Ajouter une garde ici est un acte délibéré. */
const GUARD_NAMES = [
  'requireSession',
  'requireActiveAccount',
  'requireRole',
  'requirePermission',
  'requireOwnership',
  'requireActiveParentLink',
  'requirePublishedContent',
  'requireHintUnlocked',
  'requireSolutionUnlocked',
  'assertNoCrossUser',
];

/**
 * Échappatoire explicite et traçable. Un fichier ne peut s'exempter qu'en
 * portant ce marqueur ET une justification sur la même ligne — un `// @ts-…`
 * silencieux ne suffit pas.
 *
 * Exemple légitime : la route publique de vérification d'e-mail, qui
 * s'authentifie par jeton et non par session.
 */
const EXEMPTION_MARKER = 'SAVOIR_PLUS_NO_GUARD_REQUIRED:';

function listSourceFiles(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return []; // Le répertoire n'existe pas encore.
  }

  return entries.flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    if (!/\.tsx?$/.test(entry)) return [];
    if (/\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

interface Finding {
  readonly file: string;
  readonly reason: string;
}

function findUnguardedFiles(): Finding[] {
  const findings: Finding[] = [];

  for (const directory of GUARDED_DIRECTORIES) {
    for (const file of listSourceFiles(directory)) {
      const raw = readFileSync(file, 'utf8');

      if (raw.includes(EXEMPTION_MARKER)) {
        const justified = raw
          .split('\n')
          .some(
            (line) => line.includes(EXEMPTION_MARKER) && line.split(EXEMPTION_MARKER)[1]?.trim(),
          );
        if (!justified) {
          findings.push({
            file,
            reason: `porte ${EXEMPTION_MARKER} sans justification sur la même ligne`,
          });
        }
        continue;
      }

      const code = stripComments(raw);

      // Un fichier sans export exécutable (types purs, constantes) n'a rien
      // à garder.
      const hasExecutableExport = /export\s+(async\s+)?function|export\s+const\s+\w+\s*=/.test(
        code,
      );
      if (!hasExecutableExport) continue;

      const callsGuard = GUARD_NAMES.some((guard) => new RegExp(`\\b${guard}\\s*\\(`).test(code));

      if (!callsGuard) {
        findings.push({
          file,
          reason: 'aucun appel de garde détecté (AUTHORIZATION_MATRIX.md §5)',
        });
      }
    }
  }

  return findings;
}

describe('A-07 : aucune action serveur sans garde', () => {
  it('chaque fichier de server/actions et app/api appelle une garde', () => {
    const findings = findUnguardedFiles();

    const report = findings
      .map((f) => `  · ${f.file.replace(SRC, 'src/')} — ${f.reason}`)
      .join('\n');

    expect(
      findings,
      findings.length === 0
        ? ''
        : `\nActions serveur sans garde d’autorisation :\n${report}\n` +
            `\nSans filet RLS sur Neon, chaque garde manquante est une fuite directe.\n` +
            `Ajouter une garde, ou marquer « ${EXEMPTION_MARKER} <justification> ».\n`,
    ).toEqual([]);
  });

  it('le détecteur fonctionne — il rejette un extrait sans garde', () => {
    const withoutGuard = stripComments('export async function readAll() { return db.query(); }');
    const callsGuard = GUARD_NAMES.some((g) => new RegExp(`\\b${g}\\s*\\(`).test(withoutGuard));
    expect(callsGuard).toBe(false);
  });

  it('le détecteur fonctionne — il accepte un extrait gardé', () => {
    const withGuard = stripComments(
      'export async function readMine(s) { const u = await requireSession(s); return u; }',
    );
    const callsGuard = GUARD_NAMES.some((g) => new RegExp(`\\b${g}\\s*\\(`).test(withGuard));
    expect(callsGuard).toBe(true);
  });

  it('un appel de garde en COMMENTAIRE ne compte pas', () => {
    const commentedOut = stripComments(
      '// await requireSession(source);\nexport async function readAll() { return 1; }',
    );
    const callsGuard = GUARD_NAMES.some((g) => new RegExp(`\\b${g}\\s*\\(`).test(commentedOut));
    expect(callsGuard).toBe(false);
  });
});
