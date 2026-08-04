/**
 * Savoir+ — Tests des frontières d'architecture.
 *
 * ARCHITECTURE.md §2 définit une règle de dépendance stricte. Ces règles sont
 * appliquées par ESLint (eslint.config.mjs), mais une règle de lint mal
 * écrite échoue en silence : elle ne signale rien et donne l'illusion d'une
 * protection.
 *
 * Ce fichier teste LES RÈGLES ELLES-MÊMES, en lintant des extraits qui
 * DOIVENT être refusés. Il est né d'une régression réelle : le motif
 * `@/lib/scoring/*` ne couvrait pas `@/lib/scoring`, laissant passer une
 * violation de l'ADR-005.
 */
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

const eslint = new ESLint({ cwd: projectRoot });

async function lint(relativePath: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, {
    filePath: `${projectRoot}${relativePath}`,
    warnIgnored: false,
  });
  return results.flatMap((r) => r.messages.map((m) => m.message));
}

describe('Frontière 1 — le domaine pur n’a aucune dépendance (A2)', () => {
  it.each([
    ['@/server/db', "import { db } from '@/server/db';\nexport const a = db;\n"],
    ['@/server (racine)', "import { x } from '@/server';\nexport const a = x;\n"],
    ['@/components (racine)', "import { X } from '@/components';\nexport const a = X;\n"],
    ['drizzle-orm', "import { eq } from 'drizzle-orm';\nexport const a = eq;\n"],
    ['react', "import { useState } from 'react';\nexport const a = useState;\n"],
  ])('refuse un import de %s depuis lib/scoring', async (_label, code) => {
    const messages = await lint('src/lib/scoring/probe.ts', code);
    expect(messages.length).toBeGreaterThan(0);
  });

  it.each([
    ['new Date()', 'export const a = new Date();\n'],
    ['Date.now()', 'export const a = Date.now();\n'],
    ['Math.random()', 'export const a = Math.random();\n'],
  ])('refuse %s dans lib/revision — RV-13', async (_label, code) => {
    const messages = await lint('src/lib/revision/probe.ts', code);
    expect(messages.join(' ')).toMatch(/Domaine pur/);
  });

  it('accepte une fonction pure recevant la date en paramètre', async () => {
    const messages = await lint(
      'src/lib/revision/probe.ts',
      'export const due = (now: number): number => now + 86400000;\n',
    );
    expect(messages).toEqual([]);
  });
});

describe('Frontière 2 — l’UI ne touche jamais la base ni le scoring (A3, ADR-005)', () => {
  it.each([['src/components/probe.tsx'], ['src/app/probe.tsx'], ['src/features/probe.ts']])(
    'refuse @/server/db depuis %s',
    async (path) => {
      const messages = await lint(
        path,
        "import { db } from '@/server/db';\nexport const a = db;\n",
      );
      expect(messages.join(' ')).toMatch(/n’accède jamais directement à la base/);
    },
  );

  it('refuse @/server/repositories depuis l’UI', async () => {
    const messages = await lint(
      'src/components/probe.ts',
      "import { r } from '@/server/repositories';\nexport const a = r;\n",
    );
    expect(messages.join(' ')).toMatch(/n’accède jamais directement à la base/);
  });

  it('ADR-005 : refuse @/lib/scoring (module RACINE) depuis l’UI', async () => {
    const messages = await lint(
      'src/components/probe.ts',
      "import { calculateScore } from '@/lib/scoring';\nexport const a = calculateScore;\n",
    );
    expect(messages.join(' ')).toMatch(/exclusivement côté serveur/);
  });

  it('ADR-005 : refuse aussi un sous-module de @/lib/scoring', async () => {
    const messages = await lint(
      'src/components/probe.ts',
      "import { x } from '@/lib/scoring/helpers';\nexport const a = x;\n",
    );
    expect(messages.join(' ')).toMatch(/exclusivement côté serveur/);
  });

  it('autorise @/lib/mastery depuis l’UI (affichage d’un statut déjà calculé)', async () => {
    const messages = await lint(
      'src/components/probe.ts',
      "import { statusLabel } from '@/lib/mastery';\nexport const a = statusLabel;\n",
    );
    expect(messages).toEqual([]);
  });
});

describe('Frontière 3 — un repository ne remonte pas vers les services', () => {
  it.each([
    ['@/server/services', "import { s } from '@/server/services';\nexport const a = s;\n"],
    ['@/server/actions', "import { s } from '@/server/actions';\nexport const a = s;\n"],
    [
      '@/server/services/attempt',
      "import { s } from '@/server/services/attempt';\nexport const a = s;\n",
    ],
  ])('refuse un import de %s depuis un repository', async (_label, code) => {
    const messages = await lint('src/server/repositories/probe.ts', code);
    expect(messages.join(' ')).toMatch(/ne connaît ni les services ni les actions/);
  });

  it('autorise un repository à importer le client base', async () => {
    const messages = await lint(
      'src/server/repositories/probe.ts',
      "import { db } from '@/server/db';\nexport const a = db;\n",
    );
    expect(messages).toEqual([]);
  });
});

describe('Règles générales de qualité', () => {
  it('refuse `any` non justifié', async () => {
    const messages = await lint(
      'src/server/services/probe.ts',
      'export const a = (x: any): unknown => x;\n',
    );
    expect(messages.join(' ')).toMatch(/any/);
  });

  it('refuse `==`', async () => {
    const messages = await lint(
      'src/server/services/probe.ts',
      'export const a = (x: number): boolean => x == 1;\n',
    );
    expect(messages.join(' ')).toMatch(/===/);
  });
});
