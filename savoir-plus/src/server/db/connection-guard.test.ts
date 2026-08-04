/**
 * Tests IT-17 et IT-18 de docs/TEST_STRATEGY.md §5.
 *
 * Ces tests ne touchent aucune base : le garde-fou est un module pur, ce qui
 * permet de vérifier la règle ADR-008 sans Neon.
 */
import { describe, expect, it } from 'vitest';
import {
  DatabaseConfigError,
  POOLER_MARKER,
  assertDirectConnection,
  assertNotProductionBranch,
  assertPooledConnection,
  isPooled,
} from './connection-guard';

const POOLED =
  'postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/db?sslmode=require';
const DIRECT = 'postgresql://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/db?sslmode=require';

describe('isPooled', () => {
  it('reconnaît un hôte poolé', () => {
    expect(isPooled(POOLED)).toBe(true);
  });

  it('reconnaît un hôte direct', () => {
    expect(isPooled(DIRECT)).toBe(false);
  });

  it('accepte le protocole « postgres: » comme « postgresql: »', () => {
    expect(isPooled('postgres://u:p@host-pooler.neon.tech/db')).toBe(true);
  });

  it('ne se laisse pas tromper par « -pooler » ailleurs que dans l’hôte', () => {
    // Le mot apparaît dans le nom de la base, pas dans l'hôte.
    expect(isPooled('postgresql://u:p@ep-direct.neon.tech/my-pooler-db')).toBe(false);
  });

  it('ne se laisse pas tromper par « -pooler » dans le mot de passe', () => {
    expect(isPooled('postgresql://u:secret-pooler@ep-direct.neon.tech/db')).toBe(false);
  });
});

describe('IT-17 : l’application refuse une DATABASE_URL non poolée', () => {
  it('accepte une connexion poolée', () => {
    expect(assertPooledConnection(POOLED)).toBe(POOLED);
  });

  it('REFUSE une connexion directe', () => {
    expect(() => assertPooledConnection(DIRECT)).toThrow(DatabaseConfigError);
    expect(() => assertPooledConnection(DIRECT)).toThrow(/POOLÉE/);
  });

  it('refuse une variable absente', () => {
    expect(() => assertPooledConnection(undefined)).toThrow(/DATABASE_URL est absente/);
    expect(() => assertPooledConnection('')).toThrow(DatabaseConfigError);
  });

  it('le message renvoie à l’ADR', () => {
    expect(() => assertPooledConnection(DIRECT)).toThrow(/ADR-008/);
  });
});

describe('IT-18 : les migrations refusent une URL poolée', () => {
  it('accepte une connexion directe', () => {
    expect(assertDirectConnection(DIRECT)).toBe(DIRECT);
  });

  it('REFUSE une connexion poolée', () => {
    expect(() => assertDirectConnection(POOLED)).toThrow(DatabaseConfigError);
    expect(() => assertDirectConnection(POOLED)).toThrow(/DIRECTE/);
  });

  it('refuse une variable absente', () => {
    expect(() => assertDirectConnection(undefined)).toThrow(/DATABASE_URL_UNPOOLED est absente/);
    expect(() => assertDirectConnection('')).toThrow(DatabaseConfigError);
  });
});

describe('validation de la chaîne', () => {
  it.each([
    ['texte libre', 'pas-une-url'],
    ['chaîne vide après protocole', 'postgresql://'],
  ])('rejette %s', (_label, value) => {
    expect(() => isPooled(value)).toThrow(DatabaseConfigError);
  });

  it('rejette un protocole non PostgreSQL', () => {
    expect(() => isPooled('mysql://u:p@host/db')).toThrow(/Protocole inattendu/);
  });

  it('les deux gardes rejettent une URL invalide', () => {
    expect(() => assertPooledConnection('pas-une-url')).toThrow(DatabaseConfigError);
    expect(() => assertDirectConnection('pas-une-url')).toThrow(DatabaseConfigError);
  });
});

describe('assertNotProductionBranch — TEST_STRATEGY.md §10', () => {
  it('laisse passer un hôte hors production', () => {
    expect(() => assertNotProductionBranch(DIRECT, ['ep-prod-main'])).not.toThrow();
  });

  it('REFUSE un hôte de production', () => {
    const prod = 'postgresql://u:p@ep-prod-main-999.neon.tech/db';
    expect(() => assertNotProductionBranch(prod, ['ep-prod-main'])).toThrow(DatabaseConfigError);
    expect(() => assertNotProductionBranch(prod, ['ep-prod-main'])).toThrow(/production/);
  });

  it('ignore les marqueurs vides — une variable non renseignée ne bloque pas tout', () => {
    expect(() => assertNotProductionBranch(DIRECT, [''])).not.toThrow();
  });

  it('accepte plusieurs marqueurs', () => {
    const prod = 'postgresql://u:p@ep-live-42.neon.tech/db';
    expect(() => assertNotProductionBranch(prod, ['ep-prod', 'ep-live'])).toThrow(
      DatabaseConfigError,
    );
  });

  it('aucun marqueur ⇒ aucun blocage', () => {
    expect(() => assertNotProductionBranch(DIRECT, [])).not.toThrow();
  });
});

describe('constante', () => {
  it('le marqueur Neon est « -pooler »', () => {
    expect(POOLER_MARKER).toBe('-pooler');
  });
});
