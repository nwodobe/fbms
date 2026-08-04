/**
 * Savoir+ — Statuts de maîtrise d'une compétence.
 *
 * FONCTIONS PURES. Voir docs/PEDAGOGY.md §3.3 et §4.3.
 *
 * `student_skill_levels` est une table DÉRIVÉE : elle doit être
 * intégralement reconstructible à partir de l'historique des mesures
 * (DATA_MODEL.md §6.1). C'est ce que garantit `recomputeMastery`, et c'est
 * ce qui rend une régression de scoring réparable plutôt que définitive.
 */

export type MasteryStatus = 'mastered' | 'fragile' | 'not_mastered' | 'not_evaluated';

/** Seuil de maîtrise, en pourcentage. `>= 80` ⇒ mastered. */
export const MASTERED_THRESHOLD = 80;

/** Seuil de fragilité, en pourcentage. `>= 50 et < 80` ⇒ fragile. */
export const FRAGILE_THRESHOLD = 50;

/**
 * Nombre minimal de mesures pour qu'une compétence puisse être déclarée
 * maîtrisée. PEDAGOGY.md §3.2 : une bonne réponse unique ne distingue pas
 * la maîtrise du hasard, en particulier sur un QCM.
 */
export const MIN_MEASURES_FOR_MASTERY = 2;

/**
 * Taille de la fenêtre glissante (DECISIONS.md ADR-010).
 * Une moyenne sur tout l'historique enfermerait un élève qui progresse :
 * 20 échecs en septembre pèseraient indéfiniment sur 10 réussites en
 * décembre. Paramètre de configuration, pas constante enfouie.
 */
export const MASTERY_WINDOW_SIZE = 10;

export type MeasureSource = 'diagnostic' | 'practice' | 'assessment' | 'revision';

export interface MasteryMeasure {
  /** Score de la mesure, dans [0, 100]. */
  readonly score: number;
  /** Horodatage, en millisecondes epoch. Sert uniquement au tri. */
  readonly measuredAt: number;
  readonly source: MeasureSource;
}

export interface MasteryState {
  readonly status: MasteryStatus;
  /** Taux de réussite sur la fenêtre glissante, arrondi à 2 décimales. */
  readonly successRate: number;
  /** Nombre TOTAL de mesures, pas seulement celles de la fenêtre. */
  readonly evaluatedCount: number;
  /** Horodatage de la mesure la plus récente, `null` si aucune. */
  readonly lastEvaluatedAt: number | null;
  /** Source de la mesure la plus récente, `null` si aucune. */
  readonly source: MeasureSource | null;
}

export class InvalidMeasureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMeasureError';
  }
}

/**
 * Détermine le statut à partir d'un taux et d'un nombre de mesures.
 *
 * Cas limites figés (PEDAGOGY.md §3.3) :
 *  · 80 % exactement ⇒ `mastered`
 *  · 50 % exactement ⇒ `fragile`
 *  · moins de 2 mesures ⇒ jamais `mastered`
 *
 * Asymétrie volontaire : une réponse fausse est informative même seule,
 * une réponse juste seule ne l'est pas.
 */
export function statusFor(successRate: number, evaluatedCount: number): MasteryStatus {
  if (evaluatedCount <= 0) return 'not_evaluated';

  if (successRate < FRAGILE_THRESHOLD) return 'not_mastered';

  if (evaluatedCount < MIN_MEASURES_FOR_MASTERY) {
    // Taux suffisant mais mesures insuffisantes : on ne conclut pas.
    return 'not_evaluated';
  }

  if (successRate >= MASTERED_THRESHOLD) return 'mastered';
  return 'fragile';
}

function assertValidMeasures(measures: readonly MasteryMeasure[]): void {
  for (const m of measures) {
    if (!Number.isFinite(m.score) || m.score < 0 || m.score > 100) {
      throw new InvalidMeasureError('Le score d’une mesure doit être dans [0, 100].');
    }
    if (!Number.isFinite(m.measuredAt)) {
      throw new InvalidMeasureError('measuredAt doit être un nombre fini.');
    }
  }
}

/**
 * Recalcule intégralement l'état de maîtrise à partir de l'historique brut.
 *
 * L'ordre du tableau reçu n'a pas d'importance : la fonction trie par
 * `measuredAt`. C'est ce qui rend le recalcul indépendant de l'ordre
 * d'arrivée des opérations de synchronisation (OFFLINE_SYNC.md).
 */
export function recomputeMastery(measures: readonly MasteryMeasure[]): MasteryState {
  assertValidMeasures(measures);

  if (measures.length === 0) {
    return {
      status: 'not_evaluated',
      successRate: 0,
      evaluatedCount: 0,
      lastEvaluatedAt: null,
      source: null,
    };
  }

  // Tri chronologique croissant. `toSorted` n'est pas utilisé pour rester
  // compatible avec les cibles ES2022.
  const sorted = [...measures].sort((a, b) => a.measuredAt - b.measuredAt);
  const window = sorted.slice(-MASTERY_WINDOW_SIZE);

  const sum = window.reduce((acc, m) => acc + m.score, 0);
  const successRate = Math.round((sum / window.length) * 100) / 100;

  const evaluatedCount = sorted.length;

  // `reduce` sans valeur initiale sur un tableau non vide retourne un
  // MasteryMeasure, pas `MasteryMeasure | undefined` : cela évite une garde
  // défensive inatteignable que les tests ne pourraient jamais couvrir.
  // On réduit sur le tableau D'ORIGINE, non trié : les deux branches du
  // comparateur sont ainsi réellement empruntées selon l'ordre d'entrée.
  const latest = measures.reduce((a, b) => (b.measuredAt >= a.measuredAt ? b : a));

  return {
    status: statusFor(successRate, evaluatedCount),
    successRate,
    evaluatedCount,
    lastEvaluatedAt: latest.measuredAt,
    source: latest.source,
  };
}

/** Libellé destiné à l'élève. Aucun vocabulaire stigmatisant (UX_FLOWS.md). */
export function statusLabel(status: MasteryStatus): string {
  switch (status) {
    case 'mastered':
      return 'Tu maîtrises';
    case 'fragile':
      return 'À consolider';
    case 'not_mastered':
      return 'À reprendre';
    case 'not_evaluated':
      return 'Pas encore mesuré';
  }
}

/**
 * Ordre de priorité de travail. Le plus petit passe en premier.
 * PEDAGOGY.md §3.5 : `not_evaluated` n'est jamais une priorité de travail —
 * c'est une mesure à compléter, pas une lacune établie.
 */
export function workPriority(status: MasteryStatus): number {
  switch (status) {
    case 'not_mastered':
      return 0;
    case 'fragile':
      return 1;
    case 'not_evaluated':
      return 2;
    case 'mastered':
      return 3;
  }
}
