import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/scoring/**', 'src/lib/mastery/**', 'src/lib/revision/**'],
      // ARCHITECTURE.md A2 : le domaine pur est la couche la plus critique.
      // Une erreur de scoring corrompt silencieusement la progression de tous
      // les élèves (RISKS.md R-T03). D'où l'exigence de 100 % des branches.
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
