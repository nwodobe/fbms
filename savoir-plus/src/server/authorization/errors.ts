/**
 * Savoir+ — Erreurs d'autorisation.
 *
 * RÈGLE DE NON-DIVULGATION (AUTHORIZATION_MATRIX.md §6) :
 * une ressource appartenant à un autre utilisateur renvoie **404**, jamais
 * 403. Un 403 confirme que la ressource existe et permet d'énumérer les
 * identifiants d'autres élèves.
 *
 * 403 est réservé aux cas où l'existence n'est PAS un secret : rôle
 * insuffisant, compte suspendu, action interdite par nature.
 */

export type AuthErrorCode =
  | 'UNAUTHENTICATED'
  | 'ACCOUNT_INACTIVE'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_ACTION'
  | 'NOT_FOUND'
  | 'HINT_LOCKED'
  | 'SOLUTION_LOCKED'
  | 'CROSS_USER_PAYLOAD';

export abstract class AuthorizationError extends Error {
  abstract readonly httpStatus: 401 | 403 | 404;
  abstract readonly code: AuthErrorCode;

  /**
   * Une tentative d'accès croisé doit être journalisée comme incident de
   * sécurité, pas seulement rejetée (SECURITY.md §7).
   */
  readonly isSecurityIncident: boolean = false;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 401 — aucune session valide. */
export class UnauthenticatedError extends AuthorizationError {
  override readonly httpStatus = 401 as const;
  override readonly code = 'UNAUTHENTICATED' as const;

  constructor(message = 'Session absente ou expirée.') {
    super(message);
  }
}

/** 403 — compte suspendu ou supprimé. L'existence du compte n'est pas un secret pour son titulaire. */
export class AccountInactiveError extends AuthorizationError {
  override readonly httpStatus = 403 as const;
  override readonly code = 'ACCOUNT_INACTIVE' as const;

  constructor(message = 'Ce compte n’est pas actif.') {
    super(message);
  }
}

/** 403 — le rôle ne permet pas l'action. */
export class ForbiddenRoleError extends AuthorizationError {
  override readonly httpStatus = 403 as const;
  override readonly code = 'FORBIDDEN_ROLE' as const;

  constructor(message = 'Votre rôle ne permet pas cette action.') {
    super(message);
  }
}

/** 403 — action interdite par nature (un parent qui tente de répondre, par exemple). */
export class ForbiddenActionError extends AuthorizationError {
  override readonly httpStatus = 403 as const;
  override readonly code = 'FORBIDDEN_ACTION' as const;

  constructor(message = 'Cette action n’est pas autorisée.') {
    super(message);
  }
}

/**
 * 404 — la ressource n'existe pas, OU appartient à quelqu'un d'autre.
 * Les deux cas sont volontairement indiscernables.
 */
export class NotFoundError extends AuthorizationError {
  override readonly httpStatus = 404 as const;
  override readonly code = 'NOT_FOUND' as const;

  constructor(message = 'Ressource introuvable.') {
    super(message);
  }
}

/** 403 — indice non débloqué (PEDAGOGY.md §6). */
export class HintLockedError extends AuthorizationError {
  override readonly httpStatus = 403 as const;
  override readonly code = 'HINT_LOCKED' as const;

  constructor(message = 'Cet indice n’est pas encore disponible.') {
    super(message);
  }
}

/** 403 — solution non débloquée. Fonction centrale du produit (RISKS.md R-P01). */
export class SolutionLockedError extends AuthorizationError {
  override readonly httpStatus = 403 as const;
  override readonly code = 'SOLUTION_LOCKED' as const;

  constructor(message = 'La solution n’est pas encore disponible.') {
    super(message);
  }
}

/**
 * 403 — un lot de synchronisation contient une opération destinée à un autre
 * utilisateur. C'est la faille classique de toute API de synchronisation
 * (SECURITY.md R-S03) : le lot est rejeté INTÉGRALEMENT et journalisé.
 */
export class CrossUserPayloadError extends AuthorizationError {
  override readonly httpStatus = 403 as const;
  override readonly code = 'CROSS_USER_PAYLOAD' as const;
  override readonly isSecurityIncident = true;

  constructor(message = 'Lot rejeté : opération destinée à un autre utilisateur.') {
    super(message);
  }
}

export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError;
}
