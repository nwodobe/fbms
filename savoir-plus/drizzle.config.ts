/**
 * Savoir+ — Configuration Drizzle Kit.
 *
 * Les migrations s'exécutent avec DATABASE_URL_UNPOOLED (connexion DIRECTE).
 * Voir docs/DECISIONS.md ADR-008 et docs/DATA_MODEL.md §12.
 */
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/server/db/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Volontairement non validée ici : `drizzle-kit generate` n'ouvre aucune
    // connexion. La validation stricte est appliquée par
    // scripts/maintenance/migrate.ts, qui, lui, se connecte.
    url: process.env['DATABASE_URL_UNPOOLED'] ?? '',
  },
  verbose: true,
  strict: true,
} satisfies Config;
