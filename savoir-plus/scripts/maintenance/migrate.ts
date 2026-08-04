/**
 * Savoir+ — Exécution des migrations.
 *
 * Utilise DATABASE_URL_UNPOOLED (connexion DIRECTE), jamais la connexion
 * poolée : le pooler ne supporte pas les sessions transactionnelles longues
 * des migrations (DECISIONS.md ADR-008).
 *
 * DEUX TRANSPORTS
 * ---------------
 * · `websocket` (DÉFAUT, recommandé) — le pilote Neon ouvre une vraie session
 *   PostgreSQL. La migration s'exécute dans UNE transaction : en cas d'échec
 *   à mi-parcours, rien n'est appliqué.
 *
 * · `http` (repli) — chaque instruction part en requête HTTPS indépendante.
 *   **Il n'y a donc PAS de transaction englobante** : un échec à mi-parcours
 *   laisse un schéma partiellement migré, à reprendre à la main.
 *   Ce mode n'existe que pour les environnements dont le réseau sortant
 *   interdit la mise à niveau WebSocket (proxies d'entreprise, bacs à sable
 *   CI). Il ne doit pas être le mode par défaut en production.
 *
 * Sélection : NEON_MIGRATION_TRANSPORT=http|websocket
 *
 * Usage : npm run db:migrate
 */
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless';
import { migrate as migrateWs } from 'drizzle-orm/neon-serverless/migrator';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { migrate as migrateHttp } from 'drizzle-orm/neon-http/migrator';
import { Pool, neon, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import {
  assertDirectConnection,
  assertNotProductionBranch,
} from '../../src/server/db/connection-guard';

const MIGRATIONS_FOLDER = './drizzle/migrations';

/**
 * En Node.js, le pilote Neon exige un constructeur WebSocket explicite.
 * Sans cette ligne, la connexion échoue sur un `ErrorEvent` opaque.
 */
neonConfig.webSocketConstructor = ws;

async function migrateOverWebSocket(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await migrateWs(drizzleWs(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

async function migrateOverHttp(connectionString: string): Promise<void> {
  console.warn(
    '⚠ Transport HTTP : les instructions sont envoyées une par une, SANS transaction englobante. ' +
      'Un échec à mi-parcours laisse un schéma partiellement migré.',
  );
  await migrateHttp(drizzleHttp(neon(connectionString)), {
    migrationsFolder: MIGRATIONS_FOLDER,
  });
}

async function main(): Promise<void> {
  const connectionString = assertDirectConnection(process.env['DATABASE_URL_UNPOOLED']);

  // Garde-fou : refuse la production hors intention explicite.
  if (process.env['ALLOW_PRODUCTION_MIGRATION'] !== 'yes') {
    const markers = (process.env['PRODUCTION_HOST_MARKERS'] ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m !== '');
    assertNotProductionBranch(connectionString, markers);
  }

  const transport = process.env['NEON_MIGRATION_TRANSPORT'] ?? 'websocket';
  if (transport !== 'http' && transport !== 'websocket') {
    throw new Error(
      `NEON_MIGRATION_TRANSPORT invalide : « ${transport} ». Valeurs acceptées : http, websocket.`,
    );
  }

  console.warn(`→ Migration en cours (connexion directe, transport ${transport})…`);

  if (transport === 'http') {
    await migrateOverHttp(connectionString);
  } else {
    await migrateOverWebSocket(connectionString);
  }

  console.warn('✓ Migrations appliquées.');
}

main().catch((error: unknown) => {
  console.error('✗ Échec de la migration :', error);
  process.exitCode = 1;
});
