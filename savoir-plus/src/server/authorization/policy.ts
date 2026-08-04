/**
 * Savoir+ — Matrice d'autorisation, exprimée comme DONNÉE.
 *
 * `AUTHORIZATION_MATRIX.md` §4 décrit qui peut quoi. Ce fichier en est la
 * traduction exécutable : la matrice devient testable exhaustivement, et un
 * écart entre le document et le code se voit.
 *
 * Une action absente de la table est INTERDITE À TOUS. Le défaut est le
 * refus, jamais l'autorisation (ARCHITECTURE.md A4).
 */

export type Role = 'student' | 'parent' | 'admin';
export type AccountStatus = 'active' | 'suspended' | 'deleted';

export const ROLES: readonly Role[] = ['student', 'parent', 'admin'];

/**
 * `own` : sur ses propres données.
 * `linked` : sur un élève dont le lien parent est ACTIF, en lecture seule
 *            et sur des agrégats uniquement.
 * `any` : sur n'importe quelle ressource — réservé à l'administration,
 *         toujours audité.
 */
export type Scope = 'own' | 'linked' | 'any';

export type Action =
  // Compte et profil
  | 'profile.read'
  | 'profile.update'
  | 'account.changeRole'
  | 'account.suspend'
  | 'account.delete'
  // Lien parent-enfant
  | 'link.invite'
  | 'link.accept'
  | 'link.list'
  | 'link.revoke'
  | 'link.createWithoutInvitation'
  // Diagnostic
  | 'diagnostic.start'
  | 'diagnostic.answer'
  | 'diagnostic.readReport'
  | 'diagnostic.readAnswers'
  | 'diagnostic.manage'
  // Contenu
  | 'content.readPublished'
  | 'content.readDraft'
  | 'content.readSecrets'
  | 'content.manage'
  | 'content.publish'
  // Exercices et tentatives
  | 'attempt.submit'
  | 'attempt.read'
  | 'attempt.update'
  | 'attempt.delete'
  // Erreurs, révision, progression
  | 'errors.read'
  | 'revision.read'
  | 'revision.complete'
  | 'progress.read'
  | 'progress.recompute'
  // Espace parent
  | 'parent.listChildren'
  | 'parent.readActivity'
  | 'parent.readWeeklyReport'
  // Fichiers
  | 'file.readContent'
  | 'file.upload'
  | 'file.delete'
  // Technique
  | 'stats.read'
  | 'audit.read'
  | 'audit.modify'
  | 'sync.push';

export interface Permission {
  readonly scope: Scope;
  /** L'action écrit-elle obligatoirement dans `audit_logs` ? */
  readonly audited?: boolean;
}

type Matrix = Readonly<Partial<Record<Action, Readonly<Partial<Record<Role, Permission>>>>>>;

/**
 * LA MATRICE. Toute divergence avec `AUTHORIZATION_MATRIX.md` §4 est un
 * défaut — l'un des deux ment.
 */
export const PERMISSIONS: Matrix = {
  // --- Compte et profil ---
  'profile.read': {
    student: { scope: 'own' },
    parent: { scope: 'linked' },
    admin: { scope: 'any', audited: true },
  },
  'profile.update': {
    student: { scope: 'own' },
    parent: { scope: 'own' },
    admin: { scope: 'any', audited: true },
  },
  // Personne ne modifie son propre rôle. Pas même un admin.
  'account.changeRole': { admin: { scope: 'any', audited: true } },
  'account.suspend': { admin: { scope: 'any', audited: true } },
  'account.delete': {
    student: { scope: 'own' },
    parent: { scope: 'own' },
    admin: { scope: 'any', audited: true },
  },

  // --- Lien parent-enfant ---
  'link.invite': { student: { scope: 'own' }, parent: { scope: 'own' } },
  'link.accept': { student: { scope: 'own' }, parent: { scope: 'own' } },
  'link.list': {
    student: { scope: 'own' },
    parent: { scope: 'own' },
    admin: { scope: 'any', audited: true },
  },
  'link.revoke': {
    student: { scope: 'own' },
    parent: { scope: 'own' },
    admin: { scope: 'any', audited: true },
  },
  'link.createWithoutInvitation': { admin: { scope: 'any', audited: true } },

  // --- Diagnostic ---
  'diagnostic.start': { student: { scope: 'own' } },
  'diagnostic.answer': { student: { scope: 'own' } },
  'diagnostic.readReport': {
    student: { scope: 'own' },
    parent: { scope: 'linked' },
    admin: { scope: 'any', audited: true },
  },
  'diagnostic.readAnswers': {
    student: { scope: 'own' },
    admin: { scope: 'any', audited: true },
  },
  'diagnostic.manage': { admin: { scope: 'any', audited: true } },

  // --- Contenu ---
  'content.readPublished': {
    student: { scope: 'any' },
    parent: { scope: 'any' },
    admin: { scope: 'any' },
  },
  'content.readDraft': { admin: { scope: 'any' } },
  // correct_answer, hints non débloqués, solution : jamais pour un élève
  // par cette voie. Le déblocage passe par requireHintUnlocked /
  // requireSolutionUnlocked, pas par la matrice.
  'content.readSecrets': { admin: { scope: 'any' } },
  'content.manage': { admin: { scope: 'any', audited: true } },
  'content.publish': { admin: { scope: 'any', audited: true } },

  // --- Exercices et tentatives ---
  'attempt.submit': { student: { scope: 'own' } },
  'attempt.read': { student: { scope: 'own' }, admin: { scope: 'any', audited: true } },
  // Une tentative est IMMUABLE. Personne ne réécrit l'historique
  // d'apprentissage d'un élève (AUTHORIZATION_MATRIX.md §4.5).
  'attempt.update': {},
  'attempt.delete': { admin: { scope: 'any', audited: true } },

  // --- Erreurs, révision, progression ---
  'errors.read': {
    student: { scope: 'own' },
    parent: { scope: 'linked' },
    admin: { scope: 'any', audited: true },
  },
  'revision.read': { student: { scope: 'own' }, parent: { scope: 'linked' } },
  'revision.complete': { student: { scope: 'own' } },
  'progress.read': {
    student: { scope: 'own' },
    parent: { scope: 'linked' },
    admin: { scope: 'any', audited: true },
  },
  'progress.recompute': { admin: { scope: 'any', audited: true } },

  // --- Espace parent ---
  'parent.listChildren': { parent: { scope: 'own' } },
  'parent.readActivity': { parent: { scope: 'linked' } },
  'parent.readWeeklyReport': { parent: { scope: 'linked' } },

  // --- Fichiers ---
  'file.readContent': {
    student: { scope: 'any' },
    parent: { scope: 'any' },
    admin: { scope: 'any' },
  },
  'file.upload': { admin: { scope: 'any', audited: true } },
  'file.delete': { admin: { scope: 'any', audited: true } },

  // --- Technique ---
  'stats.read': { admin: { scope: 'any' } },
  'audit.read': { admin: { scope: 'any' } },
  // APPEND-ONLY : aucune route applicative ne modifie un journal d'audit.
  'audit.modify': {},
  'sync.push': {
    student: { scope: 'own' },
    parent: { scope: 'own' },
    admin: { scope: 'own' },
  },
};

/** Permission d'un rôle sur une action, ou `null` si interdite. */
export function permissionFor(role: Role, action: Action): Permission | null {
  return PERMISSIONS[action]?.[role] ?? null;
}

/** Le rôle est-il autorisé à effectuer l'action, quel qu'en soit le périmètre ? */
export function can(role: Role, action: Action): boolean {
  return permissionFor(role, action) !== null;
}

/** L'action exige-t-elle une écriture dans `audit_logs` pour ce rôle ? */
export function requiresAudit(role: Role, action: Action): boolean {
  return permissionFor(role, action)?.audited === true;
}

/** Liste des actions interdites à TOUS les rôles. */
export function actionsForbiddenToEveryone(): Action[] {
  return (Object.keys(PERMISSIONS) as Action[]).filter(
    (action) => !ROLES.some((role) => can(role, action)),
  );
}
