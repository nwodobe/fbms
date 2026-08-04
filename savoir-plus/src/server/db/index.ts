/**
 * Savoir+ — Client Drizzle sur Neon.
 *
 * SEULE porte vers la base (ARCHITECTURE.md A3). Aucun composant, aucune
 * page, aucune Server Action n'importe ce module directement : le lint le
 * refuse (eslint.config.mjs, frontière 2).
 *
 * Le client est un SINGLETON : on n'ouvre pas une connexion PostgreSQL par
 * requête (règle Neon n°6).
 */
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';
import { assertPooledConnection } from './connection-guard';

/**
 * Validation AU DÉMARRAGE. Une connexion directe passée à l'application ne
 * provoque pas d'erreur immédiate : elle épuise les connexions sous charge,
 * c'est-à-dire en production, aux heures de pointe. D'où le refus explicite
 * ici plutôt qu'un incident plus tard.
 */
const connectionString = assertPooledConnection(process.env['DATABASE_URL']);

const sql = neon(connectionString);

declare global {
  var __savoirPlusDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

/**
 * En développement, le rechargement à chaud réévalue les modules : sans ce
 * cache global, chaque rechargement créerait un nouveau client.
 */
export const db = globalThis.__savoirPlusDb ?? drizzle(sql, { schema, casing: 'snake_case' });

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__savoirPlusDb = db;
}

export { schema };
export type Database = typeof db;
