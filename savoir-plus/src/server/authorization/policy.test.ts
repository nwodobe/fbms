import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  assertExercisePayloadSafe,
  assertNoCrossUser,
  requireActiveAccount,
  requireActiveParentLink,
  requireHintUnlocked,
  requireOwnership,
  requirePublishedContent,
  requireRole,
  requireSession,
  requireSolutionUnlocked,
  sanitizeClientIdentity,
  type SessionPrincipal,
} from './policy';

const now = new Date('2026-08-04T08:00:00.000Z');

function principal(
  overrides: Partial<SessionPrincipal> = {},
): SessionPrincipal {
  return {
    userId: 'student-a',
    role: 'student',
    status: 'active',
    expiresAt: new Date('2026-08-05T08:00:00.000Z'),
    ...overrides,
  };
}

function expectAuthError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
    throw new Error('Expected AuthorizationError');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error).toMatchObject({ status, code });
  }
}

describe('matrice d’autorisation bloquante', () => {
  it('T-01 — un élève ne lit pas les tentatives d’un autre élève', () => {
    expectAuthError(() => requireOwnership(principal(), 'student-b'), 404, 'RESOURCE_NOT_FOUND');
  });

  it('T-02 — un user_id étranger est rejeté avant création', () => {
    expectAuthError(
      () => assertNoCrossUser(principal(), ['student-b']),
      403,
      'CROSS_USER_OPERATION',
    );
  });

  it('T-03 — un parent sans lien reçoit 404', () => {
    const parent = principal({ userId: 'parent-a', role: 'parent' });
    expectAuthError(
      () => requireActiveParentLink(parent, 'student-a', null),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });

  it('T-04 — un lien pending ne donne aucun accès parent', () => {
    const parent = principal({ userId: 'parent-a', role: 'parent' });
    expectAuthError(
      () =>
        requireActiveParentLink(parent, 'student-a', {
          parentUserId: 'parent-a',
          studentUserId: 'student-a',
          status: 'pending',
        }),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });

  it('T-05 — un lien revoked ne donne aucun accès parent', () => {
    const parent = principal({ userId: 'parent-a', role: 'parent' });
    expectAuthError(
      () =>
        requireActiveParentLink(parent, 'student-a', {
          parentUserId: 'parent-a',
          studentUserId: 'student-a',
          status: 'revoked',
        }),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });

  it('T-06 — un parent ne peut pas soumettre une réponse', () => {
    expectAuthError(
      () => requireRole(principal({ role: 'parent' }), 'student'),
      403,
      'ROLE_NOT_ALLOWED',
    );
  });

  it('T-07 — le rôle fourni par le client est supprimé et ne donne aucun privilège', () => {
    expect(sanitizeClientIdentity({ role: 'admin', answer: 42 })).toEqual({ answer: 42 });
    expectAuthError(() => requireRole(principal(), 'admin'), 403, 'ROLE_NOT_ALLOWED');
  });

  it('T-08 — une action sans session reçoit 401', () => {
    expectAuthError(() => requireSession(null, now), 401, 'AUTHENTICATION_REQUIRED');
  });

  it('T-09 — un compte suspendu reçoit 403', () => {
    expectAuthError(
      () => requireActiveAccount(principal({ status: 'suspended' })),
      403,
      'ACCOUNT_NOT_ACTIVE',
    );
  });

  it('T-10 — la solution reste verrouillée au premier essai', () => {
    expectAuthError(
      () =>
        requireSolutionUnlocked(principal(), {
          ownerUserId: 'student-a',
          attemptNumber: 1,
          abandoned: false,
          unlockedHints: 0,
        }),
      403,
      'SOLUTION_LOCKED',
    );
  });

  it('T-11 — l’indice 2 est refusé si l’indice 1 n’est pas débloqué', () => {
    expectAuthError(
      () =>
        requireHintUnlocked(
          principal(),
          {
            ownerUserId: 'student-a',
            attemptNumber: 1,
            abandoned: false,
            unlockedHints: 0,
          },
          1,
        ),
      403,
      'HINT_LOCKED',
    );
  });

  it('T-12 — une réponse HTTP ne doit pas exposer correct_answer', () => {
    expect(() => assertExercisePayloadSafe({ correct_answer: 42 })).toThrow(
      'SECRET_EXERCISE_FIELD_EXPOSED',
    );
  });

  it('T-13 — un lot de synchronisation multi-utilisateurs est rejeté intégralement', () => {
    expectAuthError(
      () => assertNoCrossUser(principal(), ['student-a', 'student-b']),
      403,
      'CROSS_USER_OPERATION',
    );
  });

  it('T-14 — un élève ne lit pas un contenu draft', () => {
    expectAuthError(
      () => requirePublishedContent(principal(), 'draft'),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });

  it('T-15 — une session expirée reçoit 401', () => {
    expectAuthError(
      () => requireSession(principal({ expiresAt: new Date('2026-08-04T07:59:59.000Z') }), now),
      401,
      'AUTHENTICATION_REQUIRED',
    );
  });

  it('T-16 — une session supprimée après changement de mot de passe équivaut à aucune session', () => {
    expectAuthError(() => requireSession(null, now), 401, 'AUTHENTICATION_REQUIRED');
  });

  it('T-17 — seule une identité admin active peut atteindre une mutation de rôle', () => {
    expect(requireRole(principal({ userId: 'admin-a', role: 'admin' }), 'admin').role).toBe('admin');
  });

  it('T-18 — un asset appartenant à un autre utilisateur retourne 404', () => {
    expectAuthError(() => requireOwnership(principal(), 'student-b'), 404, 'RESOURCE_NOT_FOUND');
  });
});
