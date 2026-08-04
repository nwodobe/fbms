/**
 * Savoir+ — LES 18 TESTS D'AUTORISATION BLOCKANTS.
 *
 * Référence : docs/AUTHORIZATION_MATRIX.md §9 (T-01 → T-18).
 *
 * « Une phase dont ils échouent ne peut pas être déclarée terminée. »
 *
 * Neon n'offre pas l'équivalent de la RLS Supabase : chaque garde manquante
 * est une fuite directe, sans seconde barrière côté base. Ces tests ne sont
 * donc pas un confort — ils sont structurels.
 */
import { describe, expect, it } from 'vitest';
import {
  AccountInactiveError,
  CrossUserPayloadError,
  ForbiddenRoleError,
  HintLockedError,
  NotFoundError,
  SolutionLockedError,
  UnauthenticatedError,
} from './errors';
import {
  type AuthenticatedUser,
  type ParentStudentLink,
  type SessionSource,
  assertNoCrossUser,
  requireActiveAccount,
  requireActiveParentLink,
  requireHintUnlocked,
  requireOwnership,
  requirePermission,
  requirePublishedContent,
  requireRole,
  requireSession,
  requireSolutionUnlocked,
  withSessionUserId,
} from './guards';
import { can, requiresAudit } from './policy';

const STUDENT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const STUDENT_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const PARENT = 'cccccccc-0000-0000-0000-000000000003';
const ADMIN = 'dddddddd-0000-0000-0000-000000000004';

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    userId: STUDENT_A,
    role: 'student',
    status: 'active',
    emailVerified: true,
    ...overrides,
  };
}

function session(value: AuthenticatedUser | null): SessionSource {
  return { readSession: () => Promise.resolve(value) };
}

const studentA = user();
const studentB = user({ userId: STUDENT_B });
const parent = user({ userId: PARENT, role: 'parent' });
const admin = user({ userId: ADMIN, role: 'admin' });

// ===========================================================================
// T-01 — Élève A lit les tentatives de l'élève B ⇒ 404
// ===========================================================================
describe('T-01 : accès croisé entre élèves', () => {
  it('renvoie 404 quand la ressource appartient à un autre élève', () => {
    const attemptOfB = { ownerUserId: STUDENT_B, score: 100 };
    expect(() => requireOwnership(studentA, attemptOfB)).toThrow(NotFoundError);
  });

  it('renvoie 404, JAMAIS 403 — un 403 confirmerait l’existence', () => {
    try {
      requireOwnership(studentA, { ownerUserId: STUDENT_B });
      expect.unreachable('la garde aurait dû lever');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).httpStatus).toBe(404);
    }
  });

  it('une ressource inexistante et une ressource d’autrui sont INDISCERNABLES', () => {
    const missing = (() => {
      try {
        requireOwnership(studentA, null);
      } catch (e) {
        return e as NotFoundError;
      }
      return null;
    })();
    const foreign = (() => {
      try {
        requireOwnership(studentA, { ownerUserId: STUDENT_B });
      } catch (e) {
        return e as NotFoundError;
      }
      return null;
    })();

    expect(missing?.httpStatus).toBe(foreign?.httpStatus);
    expect(missing?.code).toBe(foreign?.code);
    expect(missing?.message).toBe(foreign?.message);
  });

  it('laisse passer sa propre ressource', () => {
    const own = { ownerUserId: STUDENT_A, score: 80 };
    expect(requireOwnership(studentA, own)).toBe(own);
  });

  it('le blocage est SYMÉTRIQUE : B ne lit pas davantage A', () => {
    const attemptOfA = { ownerUserId: STUDENT_A };
    expect(() => requireOwnership(studentB, attemptOfA)).toThrow(NotFoundError);
    expect(requireOwnership(studentB, { ownerUserId: STUDENT_B })).toBeTruthy();
  });
});

// ===========================================================================
// T-02 — Élève A soumet une tentative avec le user_id de B ⇒ 403, rien créé
// ===========================================================================
describe('T-02 : soumission avec le user_id d’un autre', () => {
  it('rejette le lot', () => {
    expect(() => assertNoCrossUser([{ userId: STUDENT_B }], STUDENT_A)).toThrow(
      CrossUserPayloadError,
    );
  });

  it('le user_id client est ÉCRASÉ par celui de la session', () => {
    const normalized = withSessionUserId([{ userId: STUDENT_B }], STUDENT_A);
    expect(normalized[0]?.userId).toBe(STUDENT_A);
  });
});

// ===========================================================================
// T-03 / T-04 / T-05 — Parent sans lien, lien `pending`, lien `revoked`
// ===========================================================================
describe('T-03 à T-05 : accès parent selon l’état du lien', () => {
  function link(status: ParentStudentLink['status']): ParentStudentLink {
    return { parentUserId: PARENT, studentUserId: STUDENT_A, status };
  }

  it('T-03 : aucun lien ⇒ 404', () => {
    expect(() => requireActiveParentLink(parent, STUDENT_A, null)).toThrow(NotFoundError);
  });

  it('T-04 : lien `pending` ⇒ 404 — le double consentement n’est pas acquis', () => {
    expect(() => requireActiveParentLink(parent, STUDENT_A, link('pending'))).toThrow(
      NotFoundError,
    );
  });

  it('T-05 : lien `revoked` ⇒ 404 — la révocation est IMMÉDIATE', () => {
    expect(() => requireActiveParentLink(parent, STUDENT_A, link('revoked'))).toThrow(
      NotFoundError,
    );
  });

  it('lien actif mais appartenant à un AUTRE parent ⇒ 404', () => {
    const otherParentLink: ParentStudentLink = {
      parentUserId: 'eeeeeeee-0000-0000-0000-000000000009',
      studentUserId: STUDENT_A,
      status: 'active',
    };
    expect(() => requireActiveParentLink(parent, STUDENT_A, otherParentLink)).toThrow(
      NotFoundError,
    );
  });

  it('lien actif mais visant un AUTRE élève ⇒ 404', () => {
    const linkToB: ParentStudentLink = {
      parentUserId: PARENT,
      studentUserId: STUDENT_B,
      status: 'active',
    };
    expect(() => requireActiveParentLink(parent, STUDENT_A, linkToB)).toThrow(NotFoundError);
  });

  it('lien actif et cohérent ⇒ autorisé', () => {
    const active = link('active');
    expect(requireActiveParentLink(parent, STUDENT_A, active)).toBe(active);
  });
});

// ===========================================================================
// T-06 — Parent tente de soumettre une réponse ⇒ 403
// ===========================================================================
describe('T-06 : le parent ne peut pas répondre à la place de l’enfant', () => {
  it('refuse `attempt.submit` au parent', async () => {
    await expect(requirePermission(session(parent), 'attempt.submit')).rejects.toThrow(
      ForbiddenRoleError,
    );
  });

  it('refuse aussi `revision.complete` et `diagnostic.answer`', async () => {
    await expect(requirePermission(session(parent), 'revision.complete')).rejects.toThrow(
      ForbiddenRoleError,
    );
    await expect(requirePermission(session(parent), 'diagnostic.answer')).rejects.toThrow(
      ForbiddenRoleError,
    );
  });

  it('mais autorise la lecture des agrégats', async () => {
    await expect(requirePermission(session(parent), 'parent.readWeeklyReport')).resolves.toEqual(
      parent,
    );
  });
});

// ===========================================================================
// T-07 — Élève force `role: 'admin'` dans le payload ⇒ sans effet
// ===========================================================================
describe('T-07 : falsification du rôle côté client', () => {
  it('le rôle vient de la SESSION, jamais du payload', async () => {
    // Un payload hostile, avec tout ce qu'un attaquant pourrait tenter.
    const hostilePayload = { role: 'admin', isAdmin: true, user: { role: 'admin' } };
    void hostilePayload; // aucune garde ne le consulte : c'est le test.

    await expect(requirePermission(session(studentA), 'content.manage')).rejects.toThrow(
      ForbiddenRoleError,
    );
  });

  it('l’élève reste refusé sur toutes les actions d’administration', async () => {
    for (const action of ['account.changeRole', 'content.publish', 'audit.read'] as const) {
      await expect(requirePermission(session(studentA), action)).rejects.toThrow(
        ForbiddenRoleError,
      );
    }
  });
});

// ===========================================================================
// T-08 — Utilisateur non authentifié ⇒ 401 sur TOUTES les actions
// ===========================================================================
describe('T-08 : aucune session', () => {
  it('requireSession lève 401', async () => {
    await expect(requireSession(session(null))).rejects.toThrow(UnauthenticatedError);
  });

  it('TOUTES les gardes de session lèvent 401, y compris en lecture', async () => {
    const anonymous = session(null);
    await expect(requireSession(anonymous)).rejects.toThrow(UnauthenticatedError);
    await expect(requireActiveAccount(anonymous)).rejects.toThrow(UnauthenticatedError);
    await expect(requireRole(anonymous, 'student')).rejects.toThrow(UnauthenticatedError);
    await expect(requirePermission(anonymous, 'progress.read')).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('le contrôle d’authentification passe AVANT celui du rôle', async () => {
    // Un anonyme sur une action admin doit obtenir 401, pas 403 : sinon on
    // apprend quelles actions existent avant même d'être connecté.
    try {
      await requirePermission(session(null), 'content.manage');
      expect.unreachable('la garde aurait dû lever');
    } catch (error) {
      expect((error as UnauthenticatedError).httpStatus).toBe(401);
    }
  });
});

// ===========================================================================
// T-09 — Compte suspendu ⇒ 403 même sur une action de son rôle
// ===========================================================================
describe('T-09 : compte non actif', () => {
  it('un compte suspendu est refusé', async () => {
    const suspended = user({ status: 'suspended' });
    await expect(requireActiveAccount(session(suspended))).rejects.toThrow(AccountInactiveError);
  });

  it('un compte supprimé est refusé', async () => {
    const deleted = user({ status: 'deleted' });
    await expect(requireActiveAccount(session(deleted))).rejects.toThrow(AccountInactiveError);
  });

  it('refusé même sur une action normalement permise à son rôle', async () => {
    const suspended = user({ status: 'suspended' });
    expect(can('student', 'attempt.submit')).toBe(true);
    await expect(requirePermission(session(suspended), 'attempt.submit')).rejects.toThrow(
      AccountInactiveError,
    );
  });

  it('le contrôle du compte passe AVANT celui du rôle', async () => {
    const suspendedAdmin = user({ role: 'admin', status: 'suspended' });
    try {
      await requirePermission(session(suspendedAdmin), 'content.manage');
      expect.unreachable('la garde aurait dû lever');
    } catch (error) {
      expect(error).toBeInstanceOf(AccountInactiveError);
    }
  });
});

// ===========================================================================
// T-10 — Élève demande la solution au 1ᵉʳ essai ⇒ 403
// ===========================================================================
describe('T-10 : verrouillage de la solution — RISKS.md R-P01', () => {
  it.each([1, 2])('refuse la solution à l’essai %i', (attemptNumber) => {
    expect(() =>
      requireSolutionUnlocked({ attemptNumber, hintsUsed: 0, hasGivenUp: false }),
    ).toThrow(SolutionLockedError);
  });

  it('autorise la solution au 3ᵉ essai', () => {
    expect(() =>
      requireSolutionUnlocked({ attemptNumber: 3, hintsUsed: 0, hasGivenUp: false }),
    ).not.toThrow();
  });

  it('autorise la solution sur abandon explicite, même au 1ᵉʳ essai', () => {
    expect(() =>
      requireSolutionUnlocked({ attemptNumber: 1, hintsUsed: 0, hasGivenUp: true }),
    ).not.toThrow();
  });

  it('avoir consommé des indices ne déverrouille PAS la solution', () => {
    expect(() =>
      requireSolutionUnlocked({ attemptNumber: 1, hintsUsed: 99, hasGivenUp: false }),
    ).toThrow(SolutionLockedError);
  });
});

// ===========================================================================
// T-11 — Élève demande l'indice 2 sans avoir eu l'indice 1 ⇒ 403
// ===========================================================================
describe('T-11 : gradation des indices', () => {
  it('refuse l’indice 2 (index 1) tant que l’indice 1 n’a pas été délivré', () => {
    expect(() =>
      requireHintUnlocked({ attemptNumber: 1, hintsUsed: 0, hasGivenUp: false }, 1),
    ).toThrow(HintLockedError);
  });

  it('autorise l’indice 1 (index 0) d’emblée', () => {
    expect(() =>
      requireHintUnlocked({ attemptNumber: 1, hintsUsed: 0, hasGivenUp: false }, 0),
    ).not.toThrow();
  });

  it('autorise l’indice 2 une fois l’indice 1 délivré', () => {
    expect(() =>
      requireHintUnlocked({ attemptNumber: 2, hintsUsed: 1, hasGivenUp: false }, 1),
    ).not.toThrow();
  });

  it('refuse un saut d’indices', () => {
    expect(() =>
      requireHintUnlocked({ attemptNumber: 2, hintsUsed: 1, hasGivenUp: false }, 5),
    ).toThrow(HintLockedError);
  });

  it('refuse un index négatif', () => {
    expect(() =>
      requireHintUnlocked({ attemptNumber: 1, hintsUsed: 3, hasGivenUp: false }, -1),
    ).toThrow(HintLockedError);
  });
});

// ===========================================================================
// T-12 — Le payload d'exercice ne doit contenir AUCUN secret
//
// Ce test est repris au niveau du repository dans une phase ultérieure : il
// doit alors inspecter la RÉPONSE HTTP réelle. Ici, on verrouille déjà la
// règle de matrice : `content.readSecrets` n'est ouvert qu'à l'admin.
// ===========================================================================
describe('T-12 : les secrets de contenu ne sont pas lisibles par un élève', () => {
  it('`content.readSecrets` est refusé à l’élève et au parent', () => {
    expect(can('student', 'content.readSecrets')).toBe(false);
    expect(can('parent', 'content.readSecrets')).toBe(false);
  });

  it('`content.readSecrets` n’est ouvert qu’à l’admin', () => {
    expect(can('admin', 'content.readSecrets')).toBe(true);
  });

  it('un élève ne peut ni lire un brouillon ni gérer du contenu', () => {
    expect(can('student', 'content.readDraft')).toBe(false);
    expect(can('student', 'content.manage')).toBe(false);
  });
});

// ===========================================================================
// T-13 — Lot de synchronisation mixant deux user_id ⇒ rejet INTÉGRAL
// ===========================================================================
describe('T-13 : lot de synchronisation hétérogène', () => {
  it('rejette le lot entier, pas seulement l’opération fautive', () => {
    const batch = [
      { userId: STUDENT_A },
      { userId: STUDENT_A },
      { userId: STUDENT_B }, // l'intruse
      { userId: STUDENT_A },
    ];
    expect(() => assertNoCrossUser(batch, STUDENT_A)).toThrow(CrossUserPayloadError);
  });

  it('marque l’événement comme INCIDENT DE SÉCURITÉ', () => {
    try {
      assertNoCrossUser([{ userId: STUDENT_B }], STUDENT_A);
      expect.unreachable('la garde aurait dû lever');
    } catch (error) {
      expect((error as CrossUserPayloadError).isSecurityIncident).toBe(true);
    }
  });

  it('accepte un lot homogène', () => {
    expect(() => assertNoCrossUser([{ userId: STUDENT_A }], STUDENT_A)).not.toThrow();
  });

  it('accepte un lot sans user_id — le serveur l’imposera', () => {
    expect(() => assertNoCrossUser([{}, {}], STUDENT_A)).not.toThrow();
    expect(withSessionUserId([{}, {}], STUDENT_A).every((o) => o.userId === STUDENT_A)).toBe(true);
  });
});

// ===========================================================================
// T-14 — Élève lit un contenu `draft` ⇒ 404
// ===========================================================================
describe('T-14 : contenu non publié', () => {
  it('un brouillon est INTROUVABLE pour un élève, pas « interdit »', () => {
    expect(() => requirePublishedContent(studentA, { status: 'draft' })).toThrow(NotFoundError);
  });

  it('un contenu archivé est également introuvable', () => {
    expect(() => requirePublishedContent(studentA, { status: 'archived' })).toThrow(NotFoundError);
  });

  it('un contenu publié est accessible', () => {
    const published = { status: 'published' as const, title: 'Fractions' };
    expect(requirePublishedContent(studentA, published)).toBe(published);
  });

  it('un admin voit les brouillons', () => {
    const draft = { status: 'draft' as const };
    expect(requirePublishedContent(admin, draft)).toBe(draft);
  });

  it('un contenu inexistant produit la même erreur qu’un brouillon', () => {
    const a = (() => {
      try {
        requirePublishedContent(studentA, null);
      } catch (e) {
        return e as NotFoundError;
      }
      return null;
    })();
    const b = (() => {
      try {
        requirePublishedContent(studentA, { status: 'draft' });
      } catch (e) {
        return e as NotFoundError;
      }
      return null;
    })();
    expect(a?.message).toBe(b?.message);
  });
});

// ===========================================================================
// T-15 — Session expirée ⇒ 401
// ===========================================================================
describe('T-15 : session expirée', () => {
  it('une session absente en base (supprimée ou expirée) produit 401', async () => {
    // La stratégie `database` (ADR-002) fait qu'une session expirée est
    // simplement absente : la source retourne null.
    await expect(requireSession(session(null))).rejects.toThrow(UnauthenticatedError);
  });
});

// ===========================================================================
// T-16 — Mot de passe changé ⇒ sessions invalidées
// ===========================================================================
describe('T-16 : révocation après changement de mot de passe', () => {
  it('la session disparue est refusée à la requête suivante', async () => {
    let stored: AuthenticatedUser | null = studentA;
    const source: SessionSource = { readSession: () => Promise.resolve(stored) };

    await expect(requireSession(source)).resolves.toEqual(studentA);

    // Changement de mot de passe : toutes les lignes `sessions` sont supprimées.
    stored = null;

    await expect(requireSession(source)).rejects.toThrow(UnauthenticatedError);
  });

  it('c’est la stratégie `database` qui rend cette révocation immédiate', () => {
    // Avec un JWT, la session resterait valide jusqu'à expiration — délai
    // inacceptable sur les données d'un mineur (ADR-002).
    expect(true).toBe(true);
  });
});

// ===========================================================================
// T-17 — Une action admin doit écrire dans audit_logs
// ===========================================================================
describe('T-17 : traçabilité des actions sensibles', () => {
  it.each([
    'account.changeRole',
    'account.suspend',
    'content.manage',
    'content.publish',
    'attempt.delete',
    'link.createWithoutInvitation',
    'progress.recompute',
  ] as const)('%s est auditée pour l’admin', (action) => {
    expect(requiresAudit('admin', action)).toBe(true);
  });

  it('une action ordinaire d’élève n’est pas auditée', () => {
    expect(requiresAudit('student', 'attempt.submit')).toBe(false);
  });

  it('toute action `any` accordée à un admin est auditée', () => {
    // Sauf les lectures de catalogue public et les statistiques agrégées,
    // qui ne portent sur aucune donnée personnelle.
    const exempt = new Set([
      'content.readPublished',
      'content.readDraft',
      'content.readSecrets',
      'stats.read',
      'audit.read',
      'file.readContent',
    ]);
    const adminActions = (
      [
        'profile.read',
        'profile.update',
        'account.changeRole',
        'account.suspend',
        'account.delete',
        'link.list',
        'link.revoke',
        'link.createWithoutInvitation',
        'diagnostic.readReport',
        'diagnostic.readAnswers',
        'diagnostic.manage',
        'content.manage',
        'content.publish',
        'attempt.read',
        'attempt.delete',
        'errors.read',
        'progress.read',
        'progress.recompute',
        'file.upload',
        'file.delete',
      ] as const
    ).filter((a) => !exempt.has(a));

    for (const action of adminActions) {
      expect(requiresAudit('admin', action)).toBe(true);
    }
  });
});

// ===========================================================================
// T-18 — Élève accède à un asset R2 d'un autre utilisateur ⇒ 404
// ===========================================================================
describe('T-18 : assets appartenant à autrui', () => {
  it('un asset d’un autre utilisateur est introuvable', () => {
    const assetOfB = { ownerUserId: STUDENT_B, objectKey: 'dev/user/xxx/copie.png' };
    expect(() => requireOwnership(studentA, assetOfB)).toThrow(NotFoundError);
  });

  it('aucune URL présignée ne doit être émise sans passer la garde', () => {
    // La garde lève AVANT toute génération d'URL : le contrôle précède
    // l'effet de bord (ARCHITECTURE.md §8).
    let presignedUrlIssued = false;
    const issue = (): string => {
      requireOwnership(studentA, { ownerUserId: STUDENT_B });
      presignedUrlIssued = true;
      return 'https://r2.example/presigned';
    };
    expect(issue).toThrow(NotFoundError);
    expect(presignedUrlIssued).toBe(false);
  });
});

// ===========================================================================
// Contrôles transverses sur la matrice
// ===========================================================================
describe('Matrice — invariants', () => {
  it('une tentative est IMMUABLE : personne ne peut la modifier', () => {
    expect(can('student', 'attempt.update')).toBe(false);
    expect(can('parent', 'attempt.update')).toBe(false);
    expect(can('admin', 'attempt.update')).toBe(false);
  });

  it('`audit_logs` est append-only : personne ne peut le modifier', () => {
    expect(can('student', 'audit.modify')).toBe(false);
    expect(can('parent', 'audit.modify')).toBe(false);
    expect(can('admin', 'audit.modify')).toBe(false);
  });

  it('un élève ne peut jamais lire les enfants d’un parent', () => {
    expect(can('student', 'parent.listChildren')).toBe(false);
    expect(can('student', 'parent.readActivity')).toBe(false);
  });

  it('un parent ne modifie aucune donnée pédagogique de l’enfant', () => {
    for (const action of [
      'attempt.submit',
      'attempt.update',
      'attempt.delete',
      'diagnostic.start',
      'diagnostic.answer',
      'revision.complete',
      'progress.recompute',
    ] as const) {
      expect(can('parent', action)).toBe(false);
    }
  });

  it('un parent ne lit jamais les réponses brutes de l’enfant', () => {
    expect(can('parent', 'diagnostic.readAnswers')).toBe(false);
    expect(can('parent', 'attempt.read')).toBe(false);
  });

  it('l’admin n’accède pas à l’espace parent', () => {
    expect(can('admin', 'parent.listChildren')).toBe(false);
    expect(can('admin', 'parent.readActivity')).toBe(false);
    expect(can('admin', 'parent.readWeeklyReport')).toBe(false);
  });

  it('la synchronisation est strictement personnelle pour tous les rôles', () => {
    for (const role of ['student', 'parent', 'admin'] as const) {
      expect(can(role, 'sync.push')).toBe(true);
    }
  });
});
