/**
 * Savoir+ — Garde-fou des connexions Neon.
 *
 * DECISIONS.md ADR-008 : deux connexions strictement séparées.
 *   · DATABASE_URL          → POOLÉE   → application uniquement
 *   · DATABASE_URL_UNPOOLED → DIRECTE  → migrations, seeds, maintenance
 *
 * Pourquoi un garde-fou logiciel et non une simple convention documentaire :
 * une connexion poolée ne convient pas aux migrations (verrous, sessions
 * transactionnelles longues) et une connexion directe ne convient pas au
 * serverless (épuisement des connexions sous charge). L'erreur est facile à
 * commettre et ses symptômes sont trompeurs — elle se manifeste sous charge,
 * pas en développement.
 *
 * Module PUR : il n'ouvre aucune connexion et ne lit pas `process.env`.
 * Il est donc testable sans base de données.
 */

/** Marqueur d'hôte poolé Neon. */
export const POOLER_MARKER = '-pooler';

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

function parseHost(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DatabaseConfigError(
      'Chaîne de connexion invalide : une URL PostgreSQL est attendue.',
    );
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DatabaseConfigError(
      `Protocole inattendu « ${url.protocol} » : « postgresql: » est attendu.`,
    );
  }

  if (url.hostname === '') {
    throw new DatabaseConfigError('Chaîne de connexion sans hôte.');
  }

  return url.hostname;
}

/** L'hôte désigne-t-il un endpoint poolé ? */
export function isPooled(connectionString: string): boolean {
  return parseHost(connectionString).includes(POOLER_MARKER);
}

/**
 * Valide la chaîne destinée à l'APPLICATION.
 * Refuse une connexion directe : sous charge serverless, elle épuise les
 * connexions PostgreSQL disponibles.
 */
export function assertPooledConnection(connectionString: string | undefined): string {
  if (!connectionString) {
    throw new DatabaseConfigError(
      'DATABASE_URL est absente. L’application ne peut pas démarrer sans connexion poolée.',
    );
  }

  if (!isPooled(connectionString)) {
    throw new DatabaseConfigError(
      `DATABASE_URL doit être une connexion POOLÉE (hôte contenant « ${POOLER_MARKER} »). ` +
        'Une connexion directe épuise les connexions en environnement serverless. ' +
        'Voir docs/DECISIONS.md ADR-008.',
    );
  }

  return connectionString;
}

/**
 * Valide la chaîne destinée aux MIGRATIONS, seeds et maintenance.
 * Refuse une connexion poolée : le pooler ne supporte pas les sessions
 * transactionnelles longues que réclament les migrations.
 */
export function assertDirectConnection(connectionString: string | undefined): string {
  if (!connectionString) {
    throw new DatabaseConfigError(
      'DATABASE_URL_UNPOOLED est absente. Les migrations exigent une connexion directe.',
    );
  }

  if (isPooled(connectionString)) {
    throw new DatabaseConfigError(
      `DATABASE_URL_UNPOOLED doit être une connexion DIRECTE (hôte SANS « ${POOLER_MARKER} »). ` +
        'Le pooler ne supporte pas les sessions transactionnelles longues des migrations. ' +
        'Voir docs/DECISIONS.md ADR-008.',
    );
  }

  return connectionString;
}

/**
 * Refuse d'opérer sur la branche de production.
 * TEST_STRATEGY.md §10 : aucun test ne s'exécute contre la production.
 * Contrôle MÉCANIQUE, pas une consigne.
 */
export function assertNotProductionBranch(
  connectionString: string,
  productionHostMarkers: readonly string[],
): void {
  const host = parseHost(connectionString);
  for (const marker of productionHostMarkers) {
    if (marker !== '' && host.includes(marker)) {
      throw new DatabaseConfigError(
        `Refus d’opérer : l’hôte « ${host} » correspond au marqueur de production « ${marker} ».`,
      );
    }
  }
}
