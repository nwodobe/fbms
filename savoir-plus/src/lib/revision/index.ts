/**
 * Savoir+ — Répétition espacée.
 *
 * FONCTIONS PURES. Voir docs/PEDAGOGY.md §7.
 *
 * RÈGLE STRUCTURANTE (RV-13) : la date « maintenant » est TOUJOURS un
 * paramètre injecté. Aucun `new Date()`, aucun `Date.now()` dans ce module —
 * le lint le refuse (eslint.config.mjs, frontière 1). Sans cela, vérifier
 * « J+30 » exigerait d'attendre trente jours.
 */

/** Calendrier initial, en jours : J+1, J+3, J+7, J+14, J+30. */
export const REVISION_INTERVALS_DAYS = [1, 3, 7, 14, 30] as const;

/** Index valide dans le calendrier. */
export type IntervalIndex = 0 | 1 | 2 | 3 | 4;

/** Index maximal du calendrier. */
export const MAX_INTERVAL_INDEX = 4;

/** Nombre d'échecs consécutifs déclenchant le retour à la leçon. */
export const FAILURES_BEFORE_LESSON_RETURN = 2;

/** Nombre de réussites consécutives au dernier index validant la consolidation. */
export const SUCCESSES_BEFORE_CONSOLIDATION = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type RevisionResult = 'success' | 'failure' | 'missed';

export type RevisionStatus = 'scheduled' | 'done' | 'missed' | 'cancelled';

export interface RevisionPlanState {
  /** Index dans REVISION_INTERVALS_DAYS. */
  readonly intervalIndex: number;
  /** Échéance, en millisecondes epoch. */
  readonly dueAt: number;
  readonly consecutiveSuccess: number;
  readonly consecutiveFailure: number;
  /** Faut-il réinjecter la leçon avant la prochaine révision ? */
  readonly requiresLessonReturn: boolean;
  /** La compétence est-elle consolidée ? */
  readonly isConsolidated: boolean;
}

export class InvalidRevisionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRevisionStateError';
  }
}

/**
 * Ramène un entier quelconque dans les bornes du calendrier.
 *
 * Le type de retour est l'union littérale des index valides : le tableau
 * `as const` est alors indexable sans garde `?? `, donc sans branche morte
 * que les tests ne pourraient pas couvrir.
 */
export function clampIndex(index: number): IntervalIndex {
  const truncated = Math.trunc(index);
  if (truncated <= 0) return 0;
  if (truncated >= MAX_INTERVAL_INDEX) return MAX_INTERVAL_INDEX;
  return truncated as IntervalIndex;
}

/** Nombre de jours associé à un index, borné au calendrier. */
export function intervalDaysFor(intervalIndex: number): number {
  return REVISION_INTERVALS_DAYS[clampIndex(intervalIndex)];
}

/** Échéance = `from` + intervalle, en millisecondes epoch. */
export function dueDateFrom(from: number, intervalIndex: number): number {
  return from + intervalDaysFor(intervalIndex) * MS_PER_DAY;
}

/**
 * Première programmation, à la suite d'une erreur ou d'une première réussite.
 * Toujours J+1 (index 0).
 */
export function scheduleFirst(now: number): RevisionPlanState {
  return {
    intervalIndex: 0,
    dueAt: dueDateFrom(now, 0),
    consecutiveSuccess: 0,
    consecutiveFailure: 0,
    requiresLessonReturn: false,
    isConsolidated: false,
  };
}

function assertValidState(state: RevisionPlanState): void {
  if (!Number.isInteger(state.intervalIndex) || state.intervalIndex < 0) {
    throw new InvalidRevisionStateError('intervalIndex doit être un entier >= 0.');
  }
  if (!Number.isFinite(state.dueAt)) {
    throw new InvalidRevisionStateError('dueAt doit être un nombre fini.');
  }
  if (state.consecutiveSuccess < 0 || state.consecutiveFailure < 0) {
    throw new InvalidRevisionStateError('Les compteurs consécutifs doivent être >= 0.');
  }
}

/**
 * Applique le résultat d'une révision et produit le nouvel état.
 *
 * Règles (PEDAGOGY.md §7.2) :
 *  · réussite            → index + 1 (plafonné)
 *  · échec               → index − 1 (plancher 0)
 *  · 2 échecs consécutifs→ index 0 ET retour à la leçon
 *  · 3 réussites au dernier index → consolidé
 *  · manquée             → replanifiée, L'INTERVALLE N'AVANCE PAS
 *
 * Aucune révision n'est jamais supprimée : une révision manquée est
 * reportée. C'est la garantie « aucune perte » de la Phase 9.
 */
export function applyRevisionResult(
  state: RevisionPlanState,
  result: RevisionResult,
  now: number,
): RevisionPlanState {
  assertValidState(state);

  if (result === 'missed') {
    // Report sans progression : l'élève n'a pas démontré quoi que ce soit.
    return {
      ...state,
      dueAt: dueDateFrom(now, state.intervalIndex),
    };
  }

  if (result === 'success') {
    const nextIndex = clampIndex(state.intervalIndex + 1);
    const consecutiveSuccess = state.consecutiveSuccess + 1;
    const atMaxIndex = state.intervalIndex >= MAX_INTERVAL_INDEX;
    const isConsolidated =
      state.isConsolidated || (atMaxIndex && consecutiveSuccess >= SUCCESSES_BEFORE_CONSOLIDATION);

    return {
      intervalIndex: nextIndex,
      dueAt: dueDateFrom(now, nextIndex),
      consecutiveSuccess,
      consecutiveFailure: 0,
      requiresLessonReturn: false,
      isConsolidated,
    };
  }

  // result === 'failure'
  const consecutiveFailure = state.consecutiveFailure + 1;
  const requiresLessonReturn = consecutiveFailure >= FAILURES_BEFORE_LESSON_RETURN;
  const nextIndex = requiresLessonReturn ? 0 : clampIndex(state.intervalIndex - 1);

  return {
    intervalIndex: nextIndex,
    dueAt: dueDateFrom(now, nextIndex),
    consecutiveSuccess: 0,
    consecutiveFailure,
    requiresLessonReturn,
    isConsolidated: false,
  };
}

// ---------------------------------------------------------------------------
// Composition de la séance quotidienne
// ---------------------------------------------------------------------------

export type SessionItemKind = 'overdue' | 'recurrent_error' | 'due_today' | 'new_skill';

export interface CandidateItem {
  readonly id: string;
  readonly kind: SessionItemKind;
  /** Durée estimée, en minutes. Doit être > 0. */
  readonly estimatedMinutes: number;
  /** Échéance, en millisecondes epoch. `null` pour une nouvelle compétence. */
  readonly dueAt: number | null;
}

export interface DailySession {
  readonly items: readonly CandidateItem[];
  readonly totalMinutes: number;
  /** Éléments écartés faute de temps — reportés, jamais perdus. */
  readonly deferred: readonly CandidateItem[];
}

/** Ordre de priorité (PEDAGOGY.md §7.4). Le plus petit passe en premier. */
const KIND_PRIORITY: Record<SessionItemKind, number> = {
  overdue: 0,
  recurrent_error: 1,
  due_today: 2,
  new_skill: 3,
};

/**
 * Ordre total sur les candidats : priorité de nature, puis échéance la plus
 * ancienne, puis identifiant.
 *
 * Exportée pour être testée directement. Passer par `Array.sort` ne
 * garantirait pas que chaque branche du comparateur soit empruntée : le
 * nombre et l'ordre des comparaisons dépendent de l'implémentation du
 * moteur, pas de nos données.
 */
export function compareCandidates(a: CandidateItem, b: CandidateItem): number {
  const byKind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  if (byKind !== 0) return byKind;

  // Les plus anciennes échéances d'abord ; `null` (nouvelle compétence)
  // passe en dernier au sein de son groupe.
  const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Compose la séance du jour dans la limite du temps déclaré par l'élève.
 *
 * PEDAGOGY.md §7.4 : on ne remplit JAMAIS une séance au-delà du temps
 * disponible. Une séance de 60 min qui en réclame 90 fait décrocher
 * l'élève — c'est un échec produit, pas un excès de zèle.
 *
 * Déterministe : à entrées égales, la sortie est identique. Le tri est
 * totalement ordonné (priorité, puis échéance, puis identifiant), sans
 * dépendre de la stabilité du tri natif.
 */
export function composeDailySession(
  candidates: readonly CandidateItem[],
  availableMinutes: number,
): DailySession {
  if (!Number.isFinite(availableMinutes) || availableMinutes < 0) {
    throw new InvalidRevisionStateError('availableMinutes doit être un nombre >= 0.');
  }

  const ordered = [...candidates].sort(compareCandidates);

  const items: CandidateItem[] = [];
  const deferred: CandidateItem[] = [];
  let totalMinutes = 0;

  for (const candidate of ordered) {
    if (totalMinutes + candidate.estimatedMinutes <= availableMinutes) {
      items.push(candidate);
      totalMinutes += candidate.estimatedMinutes;
    } else {
      deferred.push(candidate);
    }
  }

  return { items, totalMinutes, deferred };
}

/** Une révision est-elle due à l'instant `now` ? */
export function isDue(state: RevisionPlanState, now: number): boolean {
  return state.dueAt <= now;
}

/** Nombre de jours de retard, 0 si la révision n'est pas en retard. */
export function overdueDays(state: RevisionPlanState, now: number): number {
  if (state.dueAt > now) return 0;
  return Math.floor((now - state.dueAt) / MS_PER_DAY);
}
