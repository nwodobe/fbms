export type UserRole = 'student' | 'parent' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';
export type LinkStatus = 'pending' | 'active' | 'revoked';
export type ContentStatus = 'draft' | 'published' | 'archived';

export class AuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404 | 409,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'AuthorizationError';
  }
}

export interface SessionPrincipal {
  userId: string;
  role: UserRole;
  status: UserStatus;
  expiresAt: Date;
}

export interface AttemptAccess {
  ownerUserId: string;
  attemptNumber: number;
  abandoned: boolean;
  unlockedHints: number;
}

export interface ParentLinkAccess {
  parentUserId: string;
  studentUserId: string;
  status: LinkStatus;
}

export function requireSession(
  principal: SessionPrincipal | null,
  now: Date = new Date(),
): SessionPrincipal {
  if (!principal || principal.expiresAt.getTime() <= now.getTime()) {
    throw new AuthorizationError(401, 'AUTHENTICATION_REQUIRED');
  }
  return principal;
}

export function requireActiveAccount(principal: SessionPrincipal): SessionPrincipal {
  if (principal.status !== 'active') {
    throw new AuthorizationError(403, 'ACCOUNT_NOT_ACTIVE');
  }
  return principal;
}

export function requireRole(
  principal: SessionPrincipal,
  ...allowedRoles: readonly UserRole[]
): SessionPrincipal {
  requireActiveAccount(principal);
  if (!allowedRoles.includes(principal.role)) {
    throw new AuthorizationError(403, 'ROLE_NOT_ALLOWED');
  }
  return principal;
}

export function requireOwnership(principal: SessionPrincipal, ownerUserId: string): void {
  requireActiveAccount(principal);
  if (principal.userId !== ownerUserId) {
    throw new AuthorizationError(404, 'RESOURCE_NOT_FOUND');
  }
}

export function requireActiveParentLink(
  principal: SessionPrincipal,
  studentUserId: string,
  link: ParentLinkAccess | null,
): void {
  requireRole(principal, 'parent');
  if (
    !link ||
    link.status !== 'active' ||
    link.parentUserId !== principal.userId ||
    link.studentUserId !== studentUserId
  ) {
    throw new AuthorizationError(404, 'RESOURCE_NOT_FOUND');
  }
}

export function requirePublishedContent(
  principal: SessionPrincipal,
  status: ContentStatus,
): void {
  requireActiveAccount(principal);
  if (principal.role !== 'admin' && status !== 'published') {
    throw new AuthorizationError(404, 'RESOURCE_NOT_FOUND');
  }
}

export function requireSolutionUnlocked(
  principal: SessionPrincipal,
  attempt: AttemptAccess,
): void {
  requireRole(principal, 'student');
  requireOwnership(principal, attempt.ownerUserId);
  if (attempt.attemptNumber < 3 && !attempt.abandoned) {
    throw new AuthorizationError(403, 'SOLUTION_LOCKED');
  }
}

export function requireHintUnlocked(
  principal: SessionPrincipal,
  attempt: AttemptAccess,
  requestedHintIndex: number,
): void {
  requireRole(principal, 'student');
  requireOwnership(principal, attempt.ownerUserId);
  if (requestedHintIndex < 0 || requestedHintIndex > attempt.unlockedHints) {
    throw new AuthorizationError(403, 'HINT_LOCKED');
  }
}

export function assertNoCrossUser(
  principal: SessionPrincipal,
  payloadUserIds: readonly string[],
): void {
  requireActiveAccount(principal);
  if (payloadUserIds.some((userId) => userId !== principal.userId)) {
    throw new AuthorizationError(403, 'CROSS_USER_OPERATION');
  }
}

export function sanitizeClientIdentity<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, 'userId' | 'user_id' | 'role'> {
  const { userId: _userId, user_id: _userIdSnake, role: _role, ...safe } = payload;
  return safe;
}

export function assertExercisePayloadSafe(payload: Record<string, unknown>): void {
  const forbidden = [
    'correct_answer',
    'correctAnswer',
    'solution_markdown',
    'solutionMarkdown',
  ];
  if (forbidden.some((key) => Object.hasOwn(payload, key))) {
    throw new Error('SECRET_EXERCISE_FIELD_EXPOSED');
  }
}
