import { defineConfig } from 'vitest/config'

/**
 * Tests de base de données : ils parlent à un vrai PostgreSQL, donc runner
 * Node (pas de jsdom) et exécution en série — deux suites qui réinitialisent
 * les mêmes fixtures en parallèle se marcheraient dessus.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
