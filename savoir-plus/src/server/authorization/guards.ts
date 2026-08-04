/**
 * Savoir+ — Gardes d'autorisation.
 *
 * LES SIX CONTRÔLES OBLIGATOIRES (AUTHORIZATION_MATRIX.md §2), dans l'ordre :
 *   1. authentifié           → 401
 *   2. compte actif          → 403
 *   3. rôle autorisé         → 403
 *   4. ressource existante   → 404
 *   5. appartenance          → 404  (jamais 403 : voir errors.ts)
 *   6. état compatible       → 403/409
 *
 * CONCEPTION PAR INJECTION. Les gardes ne lisent ni `process.env`, ni la base,
 * ni les cookies : elles reçoivent une `SessionSource`. Conséquence directe :
 * les 18 tests d'autorisation bloquants s'exécutent **sans base de données**,
 * partout, en millisecondes. Une garde qu'on ne peut pas tester facilement
 * est une garde qu'on ne teste pas.
 *
 * RAPPEL : Neon n'offre pas l'équivalent de la RLS Supabase. Ces gardes sont
 * la PREMIÈRE des deux barrières ; la seconde est la clause d'appartenance
 * dans la requête SQL elle-même (ADR-007).
 */
import {
  AccountInactiveError,
  CrossUserPayloadError,
  ForbiddenRoleError,
  HintLockedError,
  NotFoundError,
  SolutionLockedError,
  UnauthenticatedError,
} from './errors';
import { type Action, type AccountStatus, type Role, can } from './policy';
import { MAX_ATTEMPTS, isHintUnlocked, isSolutionUnlocked } from '@/lib/scoring';

export interface AuthenticatedUser {
  readonly userId: string;
  /** Relu EN BASE à chaque requête. Jamais lu depuis le client (ADR-003). */
  readonly role: Role;
  readonly status: AccountStatus;
  readonly emailVerified: boolean;
}

/**
 * Source de session. En production, une implémentation lit la table
 * `sessions` via Auth.js. En test, un objet littéral suffit.
 */
export interface SessionSource {
  readSession(): Promise<AuthenticatedUser | null>;
}

// ---------------------------------------------------------------------------
// 1 — Authentification
// ---------------------------------------------------------------------------

/** Contrôle n°1. Lève 401 si aucune session valide. */
export async function requireSession(source: SessionSource): Promise<AuthenticatedUser> {
  const user = await source.readSession();
  if (user === null) throw new UnauthenticatedError();
  return user;
}

// ---------------------------------------------------------------------------
// 2 — Compte actif
// ---------------------------------------------------------------------------

/** Contrôles n°1 + n°2. Un compte suspendu ne peut plus rien faire. */
export async function requireActiveAccount(source: SessionSource): Promise<AuthenticatedUser> {
  const user = await requireSession(source);
  if (user.status !== 'active') {
    throw new AccountInactiveError(
      user.status === 'suspended' ? 'Ce compte est suspendu.' : 'Ce compte a été supprimé.',
    );
  }
  return user;
}

// ---------------------------------------------------------------------------
// 3 — Rôle
// ---------------------------------------------------------------------------

/** Contrôles n°1 → n°3, par rôle explicite. */
export async function requireRole(
  source: SessionSource,
  ...roles: readonly Role[]
): Promise<AuthenticatedUser> {
  const user = await requireActiveAccount(source);
  if (!roles.includes(user.role)) throw new ForbiddenRoleError();
  return user;
}

/**
 * Contrôles n°1 → n°3, par ACTION plutôt que par rôle.
 * À préférer : la décision est portée par la matrice (policy.ts), donc
 * vérifiable contre `AUTHORIZATION_MATRIX.md`, plutôt que dispersée dans
 * les appels.
 */
export async function requirePermission(
  source: SessionSource,
  action: Action,
): Promise<AuthenticatedUser> {
  const user = await requireActiveAccount(source);
  if (!can(user.role, action)) throw new ForbiddenRoleError();
  return user;
}

// ---------------------------------------------------------------------------
// 4 + 5 — Existence et appartenance
// ---------------------------------------------------------------------------

export interface OwnedResource {
  readonly ownerUserId: string;
}

/**
 * Contrôles n°4 et n°5.
 *
 * `resource` à `null` (inexistante) et resource appartenant à autrui
 * produisent **la même** erreur 404. C'est volontaire : distinguer les deux
 * permettrait d'énumérer les identifiants d'autres élèves.
 */
export function requireOwnership<T extends OwnedResource>(
  user: AuthenticatedUser,
  resource: T | null | undefined,
): T {
  if (resource === null || resource === undefined) throw new NotFoundError();
  if (resource.ownerUserId !== user.userId) throw new NotFoundError();
  return resource;
}

export type LinkStatus = 'pending' | 'active' | 'revoked';

export interface ParentStudentLink {
  readonly parentUserId: string;
  readonly studentUserId: string;
  readonly status: LinkStatus;
}

/**
 * Contrôle n°5 pour le parent. **SEUL `active` ouvre un droit de lecture.**
 *
 * `pending` et `revoked` sont traités exactement comme un lien inexistant :
 * la révocation doit être immédiate et indiscernable de l'absence de lien.
 */
export function requireActiveParentLink(
  user: AuthenticatedUser,
  studentUserId: string,
  link: ParentStudentLink | null | undefined,
): ParentStudentLink {
  if (link === null || link === undefined) throw new NotFoundError();
  if (link.status !== 'active') throw new NotFoundError();
  if (link.parentUserId !== user.userId) throw new NotFoundError();
  if (link.studentUserId !== studentUserId) throw new NotFoundError();
  return link;
}

// ---------------------------------------------------------------------------
// 6 — État de la ressource
// ---------------------------------------------------------------------------

export type ContentStatus = 'draft' | 'published' | 'archived';

export interface VersionedContent {
  readonly status: ContentStatus;
}

/**
 * Contrôle n°6 pour le contenu pédagogique.
 * Un élève ne voit que `published` ; un brouillon lui est **introuvable**,
 * pas « interdit ». Un admin voit tout.
 */
export function requirePublishedContent<T extends VersionedContent>(
  user: AuthenticatedUser,
  content: T | null | undefined,
): T {
  if (content === null || content === undefined) throw new NotFoundError();
  if (user.role === 'admin') return content;
  if (content.status !== 'published') throw new NotFoundError();
  return content;
}

export interface AttemptProgress {
  readonly attemptNumber: number;
  readonly hintsUsed: number;
  readonly hasGivenUp: boolean;
}

/**
 * L'indice `hintIndex` (0-based) a-t-il été légitimement débloqué ?
 * L'indice n+1 exige que l'indice n ait été délivré (PEDAGOGY.md §6).
 */
export function requireHintUnlocked(progress: AttemptProgress, hintIndex: number): void {
  if (!isHintUnlocked({ hintIndex, hintsUsed: progress.hintsUsed })) {
    throw new HintLockedError();
  }
}

/**
 * FONCTION CENTRALE DU PRODUIT (RISKS.md R-P01).
 *
 * La solution n'est délivrée qu'après le 3ᵉ essai ou un abandon explicite.
 * Si cette garde tombe, Savoir+ redevient une banque de corrigés : le
 * produit continue de fonctionner tout en ayant perdu sa raison d'être.
 * C'est une défaillance silencieuse, donc la plus dangereuse.
 */
export function requireSolutionUnlocked(progress: AttemptProgress): void {
  const unlocked = isSolutionUnlocked({
    attemptNumber: progress.attemptNumber,
    hasGivenUp: progress.hasGivenUp,
  });
  if (!unlocked) {
    throw new SolutionLockedError(
      `La solution s’ouvre après ${MAX_ATTEMPTS} essais ou un abandon explicite.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Synchronisation — le point d'entrée le plus exposé du système
// ---------------------------------------------------------------------------

export interface SyncOperationEnvelope {
  /** Fourni par le client : INFORMATIF UNIQUEMENT. */
  readonly userId?: string | undefined;
}

/**
 * `POST /api/sync` est le point d'entrée le plus exposé (SECURITY.md R-S03).
 *
 * Le `user_id` fourni par le client est **ignoré** et remplacé par celui de
 * la session. Une divergence n'est pas une erreur de saisie : c'est une
 * tentative d'écrire dans les données d'un autre élève. Le lot est rejeté
 * INTÉGRALEMENT — pas partiellement — et journalisé comme incident.
 */
export function assertNoCrossUser(
  operations: readonly SyncOperationEnvelope[],
  sessionUserId: string,
): void {
  for (const operation of operations) {
    if (operation.userId !== undefined && operation.userId !== sessionUserId) {
      throw new CrossUserPayloadError();
    }
  }
}

/**
 * Impose l'identifiant de session à chaque opération du lot.
 * À appliquer APRÈS `assertNoCrossUser` : la vérification signale l'attaque,
 * la normalisation empêche qu'un `userId` client atteigne la base même si
 * une garde future était mal placée.
 */
export function withSessionUserId<T extends SyncOperationEnvelope>(
  operations: readonly T[],
  sessionUserId: string,
): (T & { userId: string })[] {
  return operations.map((operation) => ({ ...operation, userId: sessionUserId }));
}
