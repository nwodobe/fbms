/**
 * Savoir+ — Exécution des migrations.
 *
 * Utilise DATABASE_URL_UNPOOLED (connexion DIRECTE), jamais la connexion
 * poolée : le pooler ne supporte pas les sessions transactionnelles longues
 * des migrations (DECISIONS.md ADR-008).
 *
 * Usage : npm run db:migrate
 */
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import { Pool } from '@neondatabase/serverless';
import { assertDirectConnection, assertNotProductionBranch } from '../../src/server/db/connection-guard';

async function main(): Promise<void> {
  const connectionString = assertDirectConnection(process.env['DATABASE_URL_UNPOOLED']);

  // Garde-fou supplémentaire : refuse la production hors intention explicite.
  if (process.env['ALLOW_PRODUCTION_MIGRATION'] !== 'yes') {
    const markers = (process.env['PRODUCTION_HOST_MARKERS'] ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m !== '');
    assertNotProductionBranch(connectionString, markers);
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  console.warn('→ Migration en cours (connexion directe)…');
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
  console.warn('✓ Migrations appliquées.');

  await pool.end();
}

main().catch((error: unknown) => {
  console.error('✗ Échec de la migration :', error);
  process.exitCode = 1;
});
