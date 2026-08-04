/**
 * Savoir+ — Calcul du score d'une tentative d'exercice.
 *
 * FONCTIONS PURES. Aucune E/S, aucune date, aucun aléa.
 * Voir docs/PEDAGOGY.md §4 et docs/DECISIONS.md ADR-005.
 *
 * Ce module est exécuté EXCLUSIVEMENT côté serveur (ADR-005) : un score
 * calculé côté client est falsifiable en trois clics dans les outils de
 * développement, ce qui rendrait sans valeur l'ensemble des données de
 * progression — et donc le tableau de bord parent.
 */

/** Nombre maximal d'essais avant délivrance de la solution (PEDAGOGY.md §6). */
export const MAX_ATTEMPTS = 3;

/** Pénalité, en points de pourcentage, par indice consommé. */
export const HINT_PENALTY = 10;

/**
 * Score plafond par numéro d'essai.
 * Index 0 → 1ᵉʳ essai, index 1 → 2ᵉ, index 2 → 3ᵉ.
 */
export const ATTEMPT_SCORES: readonly number[] = [100, 80, 60];

export interface ExerciseStepResult {
  /** Poids de l'étape dans l'exercice. Doit être strictement positif. */
  readonly weight: number;
  readonly isCorrect: boolean;
}

export interface ScoreInput {
  /** Numéro d'essai, à partir de 1. */
  readonly attemptNumber: number;
  /** Nombre d'indices consommés au moment de la soumission. */
  readonly hintsUsed: number;
  /** La réponse finale est-elle juste ? */
  readonly isCorrect: boolean;
  /**
   * Étapes vérifiables de l'exercice, si l'exercice en définit.
   * PEDAGOGY.md §4.2 : sans étapes vérifiables, PAS de score partiel.
   * Un exercice sans étapes est binaire — juste ou faux.
   */
  readonly steps?: readonly ExerciseStepResult[];
}

export interface ScoreResult {
  /** Score final, entier borné à [0, 100]. */
  readonly score: number;
  /** Un score partiel a-t-il été appliqué ? */
  readonly isPartial: boolean;
  /** Plafond imposé par le numéro d'essai, avant pénalité d'indices. */
  readonly attemptCap: number;
  /** Total des points retirés au titre des indices. */
  readonly hintPenalty: number;
}

export class InvalidScoreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScoreInputError';
  }
}

/**
 * Borne une valeur à l'intervalle [min, max].
 *
 * Exportée pour être testée directement : c'est cette fonction qui porte la
 * propriété de bornage `0 <= score <= 100` (SC-11). Une garde non testée
 * n'est pas une garde.
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function assertValidInput(input: ScoreInput): void {
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
    throw new InvalidScoreInputError('attemptNumber doit être un entier >= 1.');
  }
  if (!Number.isInteger(input.hintsUsed) || input.hintsUsed < 0) {
    throw new InvalidScoreInputError('hintsUsed doit être un entier >= 0.');
  }
  if (input.steps) {
    if (input.steps.length === 0) {
      throw new InvalidScoreInputError(
        'steps ne doit pas être un tableau vide : omettre la propriété si l’exercice n’a pas d’étapes.',
      );
    }
    for (const step of input.steps) {
      if (!Number.isFinite(step.weight) || step.weight <= 0) {
        throw new InvalidScoreInputError('Le poids d’une étape doit être un nombre > 0.');
      }
    }
  }
}

/**
 * Plafond de score imposé par le numéro d'essai.
 * Au-delà du 3ᵉ essai, le plafond est 0 : l'élève a épuisé ses tentatives et
 * a reçu la solution.
 */
export function attemptCapFor(attemptNumber: number): number {
  return ATTEMPT_SCORES[attemptNumber - 1] ?? 0;
}

/**
 * Fraction de réussite des étapes, dans [0, 1], pondérée par le poids.
 */
export function stepCompletionRatio(steps: readonly ExerciseStepResult[]): number {
  let total = 0;
  let earned = 0;
  for (const step of steps) {
    total += step.weight;
    if (step.isCorrect) earned += step.weight;
  }
  // total > 0 est garanti par assertValidInput (tout poids est > 0 et le
  // tableau est non vide), mais la garde reste pour l'usage direct.
  return total === 0 ? 0 : earned / total;
}

/**
 * Calcule le score d'une tentative.
 *
 * Propriétés garanties (testées par des tests de propriété) :
 *  · déterminisme  — mêmes entrées, même sortie, toujours ;
 *  · bornage       — 0 <= score <= 100 ;
 *  · monotonie     — plus d'indices ⇒ score <= ; essai plus tardif ⇒ score <=.
 */
export function calculateScore(input: ScoreInput): ScoreResult {
  assertValidInput(input);

  const attemptCap = attemptCapFor(input.attemptNumber);
  const hintPenalty = input.hintsUsed * HINT_PENALTY;

  let base: number;
  let isPartial = false;

  if (input.isCorrect) {
    base = attemptCap;
  } else if (input.steps) {
    // Score partiel : uniquement si l'exercice définit des étapes vérifiables.
    const ratio = stepCompletionRatio(input.steps);
    base = attemptCap * ratio;
    isPartial = ratio > 0 && ratio < 1;
  } else {
    // Exercice binaire sans étapes : réponse fausse ⇒ 0.
    base = 0;
  }

  const score = clamp(Math.round(base - hintPenalty), 0, 100);

  return { score, isPartial, attemptCap, hintPenalty };
}

/**
 * L'élève a-t-il droit à la solution détaillée ?
 * PEDAGOGY.md §6 : 3ᵉ essai atteint, OU abandon explicite enregistré.
 *
 * Cette fonction est la traduction de la fonction centrale du produit.
 * Toute modification doit être argumentée : c'est la seule barrière entre
 * Savoir+ et une banque de corrigés (RISKS.md R-P01).
 */
export function isSolutionUnlocked(params: {
  readonly attemptNumber: number;
  readonly hasGivenUp: boolean;
}): boolean {
  return params.hasGivenUp || params.attemptNumber >= MAX_ATTEMPTS;
}

/**
 * L'indice d'index `hintIndex` (0-based) est-il débloqué ?
 * PEDAGOGY.md §6 : l'indice n+1 exige que l'indice n ait été délivré.
 */
export function isHintUnlocked(params: {
  readonly hintIndex: number;
  readonly hintsUsed: number;
}): boolean {
  if (!Number.isInteger(params.hintIndex) || params.hintIndex < 0) return false;
  return params.hintIndex <= params.hintsUsed;
}
