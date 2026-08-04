/**
 * Tests de docs/TEST_STRATEGY.md §4.1 (SC-01 → SC-13).
 * Exigence : 100 % des branches (vitest.config.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  ATTEMPT_SCORES,
  HINT_PENALTY,
  InvalidScoreInputError,
  MAX_ATTEMPTS,
  attemptCapFor,
  calculateScore,
  clamp,
  isHintUnlocked,
  isSolutionUnlocked,
  stepCompletionRatio,
} from './index';

describe('calculateScore — cas nominaux (SC-01 → SC-08)', () => {
  it('SC-01 : 1ᵉʳ essai, 0 indice ⇒ 100', () => {
    expect(calculateScore({ attemptNumber: 1, hintsUsed: 0, isCorrect: true }).score).toBe(100);
  });

  it('SC-02 : 2ᵉ essai, 0 indice ⇒ 80', () => {
    expect(calculateScore({ attemptNumber: 2, hintsUsed: 0, isCorrect: true }).score).toBe(80);
  });

  it('SC-03 : 3ᵉ essai, 0 indice ⇒ 60', () => {
    expect(calculateScore({ attemptNumber: 3, hintsUsed: 0, isCorrect: true }).score).toBe(60);
  });

  it('SC-04 : 2ᵉ essai, 1 indice ⇒ 70', () => {
    expect(calculateScore({ attemptNumber: 2, hintsUsed: 1, isCorrect: true }).score).toBe(70);
  });

  it('SC-05 : 3ᵉ essai, 2 indices ⇒ 40', () => {
    expect(calculateScore({ attemptNumber: 3, hintsUsed: 2, isCorrect: true }).score).toBe(40);
  });

  it('SC-06 : échec après 3 essais ⇒ 0', () => {
    expect(calculateScore({ attemptNumber: 3, hintsUsed: 2, isCorrect: false }).score).toBe(0);
  });

  it('SC-07 : 1ᵉʳ essai réussi avec 1 indice demandé avant de répondre ⇒ 90', () => {
    expect(calculateScore({ attemptNumber: 1, hintsUsed: 1, isCorrect: true }).score).toBe(90);
  });

  it('SC-08 : 10 indices ⇒ 0, jamais négatif', () => {
    const result = calculateScore({ attemptNumber: 1, hintsUsed: 10, isCorrect: true });
    expect(result.score).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('au-delà du 3ᵉ essai, le plafond est 0', () => {
    expect(attemptCapFor(4)).toBe(0);
    expect(calculateScore({ attemptNumber: 4, hintsUsed: 0, isCorrect: true }).score).toBe(0);
  });
});

describe('calculateScore — score partiel (SC-09, SC-10)', () => {
  it('SC-09 : 3 étapes sur 4 justes, poids égaux, 1ᵉʳ essai ⇒ 75', () => {
    const result = calculateScore({
      attemptNumber: 1,
      hintsUsed: 0,
      isCorrect: false,
      steps: [
        { weight: 1, isCorrect: true },
        { weight: 1, isCorrect: true },
        { weight: 1, isCorrect: true },
        { weight: 1, isCorrect: false },
      ],
    });
    expect(result.score).toBe(75);
    expect(result.isPartial).toBe(true);
  });

  it('SC-09b : le score partiel est plafonné par le numéro d’essai', () => {
    const result = calculateScore({
      attemptNumber: 3,
      hintsUsed: 0,
      isCorrect: false,
      steps: [
        { weight: 1, isCorrect: true },
        { weight: 1, isCorrect: false },
      ],
    });
    // cap 60 × ratio 0,5 = 30
    expect(result.score).toBe(30);
    expect(result.attemptCap).toBe(60);
  });

  it('le score partiel respecte les poids', () => {
    const result = calculateScore({
      attemptNumber: 1,
      hintsUsed: 0,
      isCorrect: false,
      steps: [
        { weight: 3, isCorrect: true },
        { weight: 1, isCorrect: false },
      ],
    });
    expect(result.score).toBe(75);
  });

  it('toutes les étapes justes mais réponse finale fausse : ratio 1, non partiel', () => {
    const result = calculateScore({
      attemptNumber: 1,
      hintsUsed: 0,
      isCorrect: false,
      steps: [{ weight: 1, isCorrect: true }],
    });
    expect(result.score).toBe(100);
    expect(result.isPartial).toBe(false);
  });

  it('aucune étape juste : ratio 0, non partiel', () => {
    const result = calculateScore({
      attemptNumber: 1,
      hintsUsed: 0,
      isCorrect: false,
      steps: [{ weight: 1, isCorrect: false }],
    });
    expect(result.score).toBe(0);
    expect(result.isPartial).toBe(false);
  });

  it('SC-10 : sans étapes, l’exercice est binaire — aucun score partiel', () => {
    const result = calculateScore({ attemptNumber: 1, hintsUsed: 0, isCorrect: false });
    expect(result.score).toBe(0);
    expect(result.isPartial).toBe(false);
  });

  it('la pénalité d’indices s’applique aussi au score partiel', () => {
    const result = calculateScore({
      attemptNumber: 1,
      hintsUsed: 2,
      isCorrect: false,
      steps: [
        { weight: 1, isCorrect: true },
        { weight: 1, isCorrect: false },
      ],
    });
    // 100 × 0,5 = 50, − 20 = 30
    expect(result.score).toBe(30);
  });
});

describe('stepCompletionRatio', () => {
  it('retourne 0 sur un tableau vide (usage direct)', () => {
    expect(stepCompletionRatio([])).toBe(0);
  });
});

describe('clamp — porte la propriété de bornage', () => {
  it('ramène au plancher', () => {
    expect(clamp(-30, 0, 100)).toBe(0);
  });

  it('ramène au plafond', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('laisse passer une valeur dans les bornes', () => {
    expect(clamp(42, 0, 100)).toBe(42);
  });

  it('accepte les bornes elles-mêmes', () => {
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });
});

describe('calculateScore — validation des entrées', () => {
  it.each([
    ['attemptNumber = 0', { attemptNumber: 0, hintsUsed: 0, isCorrect: true }],
    ['attemptNumber non entier', { attemptNumber: 1.5, hintsUsed: 0, isCorrect: true }],
    ['hintsUsed négatif', { attemptNumber: 1, hintsUsed: -1, isCorrect: true }],
    ['hintsUsed non entier', { attemptNumber: 1, hintsUsed: 0.5, isCorrect: true }],
  ])('rejette %s', (_label, input) => {
    expect(() => calculateScore(input)).toThrow(InvalidScoreInputError);
  });

  it('rejette un tableau d’étapes vide', () => {
    expect(() =>
      calculateScore({ attemptNumber: 1, hintsUsed: 0, isCorrect: false, steps: [] }),
    ).toThrow(InvalidScoreInputError);
  });

  it.each([[0], [-1], [Number.NaN]])('rejette un poids d’étape invalide (%s)', (weight) => {
    expect(() =>
      calculateScore({
        attemptNumber: 1,
        hintsUsed: 0,
        isCorrect: false,
        steps: [{ weight, isCorrect: true }],
      }),
    ).toThrow(InvalidScoreInputError);
  });
});

// ---------------------------------------------------------------------------
// Tests de propriété (SC-11 → SC-13)
// ---------------------------------------------------------------------------

/** Générateur pseudo-aléatoire déterministe — pas de Math.random dans un test. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('calculateScore — propriétés (SC-11 → SC-13)', () => {
  it('SC-11 : 0 <= score <= 100 sur 1 000 entrées', () => {
    const rng = makeRng(42);
    for (let i = 0; i < 1000; i++) {
      const { score } = calculateScore({
        attemptNumber: 1 + Math.floor(rng() * 6),
        hintsUsed: Math.floor(rng() * 12),
        isCorrect: rng() > 0.5,
      });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it('SC-12 : monotonie — plus d’indices ⇒ score inférieur ou égal', () => {
    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber++) {
      let previous = Number.POSITIVE_INFINITY;
      for (let hintsUsed = 0; hintsUsed <= 12; hintsUsed++) {
        const { score } = calculateScore({ attemptNumber, hintsUsed, isCorrect: true });
        expect(score).toBeLessThanOrEqual(previous);
        previous = score;
      }
    }
  });

  it('SC-12b : monotonie — essai plus tardif ⇒ score inférieur ou égal', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let attemptNumber = 1; attemptNumber <= 5; attemptNumber++) {
      const { score } = calculateScore({ attemptNumber, hintsUsed: 0, isCorrect: true });
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it('SC-13 : déterminisme — 100 appels identiques', () => {
    const input = { attemptNumber: 2, hintsUsed: 1, isCorrect: true } as const;
    const reference = calculateScore(input);
    for (let i = 0; i < 100; i++) {
      expect(calculateScore(input)).toEqual(reference);
    }
  });
});

// ---------------------------------------------------------------------------
// Verrouillage de la solution et des indices — fonction centrale du produit
// ---------------------------------------------------------------------------

describe('isSolutionUnlocked — RISKS.md R-P01', () => {
  it.each([1, 2])('la solution reste VERROUILLÉE à l’essai %i sans abandon', (attemptNumber) => {
    expect(isSolutionUnlocked({ attemptNumber, hasGivenUp: false })).toBe(false);
  });

  it('la solution est débloquée au 3ᵉ essai', () => {
    expect(isSolutionUnlocked({ attemptNumber: MAX_ATTEMPTS, hasGivenUp: false })).toBe(true);
  });

  it('la solution est débloquée par un abandon explicite, même au 1ᵉʳ essai', () => {
    expect(isSolutionUnlocked({ attemptNumber: 1, hasGivenUp: true })).toBe(true);
  });
});

describe('isHintUnlocked', () => {
  it('l’indice 1 (index 0) est accessible avant tout indice consommé', () => {
    expect(isHintUnlocked({ hintIndex: 0, hintsUsed: 0 })).toBe(true);
  });

  it('l’indice 2 (index 1) est refusé tant que l’indice 1 n’a pas été délivré', () => {
    expect(isHintUnlocked({ hintIndex: 1, hintsUsed: 0 })).toBe(false);
  });

  it('l’indice 2 est accessible une fois l’indice 1 délivré', () => {
    expect(isHintUnlocked({ hintIndex: 1, hintsUsed: 1 })).toBe(true);
  });

  it.each([[-1], [1.5]])('refuse un index invalide (%s)', (hintIndex) => {
    expect(isHintUnlocked({ hintIndex, hintsUsed: 5 })).toBe(false);
  });
});

describe('constantes', () => {
  it('respectent le cahier des charges', () => {
    expect(ATTEMPT_SCORES).toEqual([100, 80, 60]);
    expect(HINT_PENALTY).toBe(10);
    expect(MAX_ATTEMPTS).toBe(3);
  });
});
