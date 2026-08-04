/**
 * Tests de docs/TEST_STRATEGY.md §4.2 (MA-01 → MA-09).
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidMeasureError,
  MASTERY_WINDOW_SIZE,
  type MasteryMeasure,
  type MasteryStatus,
  recomputeMastery,
  statusFor,
  statusLabel,
  workPriority,
} from './index';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function measures(scores: readonly number[]): MasteryMeasure[] {
  return scores.map((score, i) => ({
    score,
    measuredAt: T0 + i * DAY,
    source: 'practice' as const,
  }));
}

describe('statusFor — seuils et cas limites (MA-01 → MA-07)', () => {
  it('MA-01 : 80 % avec 2 mesures ⇒ mastered (borne INCLUSE)', () => {
    expect(statusFor(80, 2)).toBe('mastered');
  });

  it('MA-02 : 79,9 % avec 5 mesures ⇒ fragile', () => {
    expect(statusFor(79.9, 5)).toBe('fragile');
  });

  it('MA-03 : 50 % avec 4 mesures ⇒ fragile (borne INCLUSE)', () => {
    expect(statusFor(50, 4)).toBe('fragile');
  });

  it('MA-04 : 49,9 % avec 4 mesures ⇒ not_mastered', () => {
    expect(statusFor(49.9, 4)).toBe('not_mastered');
  });

  it('MA-05 : 100 % avec UNE SEULE mesure ⇒ not_evaluated, jamais mastered', () => {
    expect(statusFor(100, 1)).toBe('not_evaluated');
  });

  it('MA-06 : 0 % avec une seule mesure ⇒ not_mastered (une erreur est informative)', () => {
    expect(statusFor(0, 1)).toBe('not_mastered');
  });

  it('MA-07 : aucune mesure ⇒ not_evaluated', () => {
    expect(statusFor(0, 0)).toBe('not_evaluated');
    expect(statusFor(100, -1)).toBe('not_evaluated');
  });

  it('l’asymétrie est volontaire : juste seul n’informe pas, faux seul informe', () => {
    expect(statusFor(100, 1)).toBe('not_evaluated');
    expect(statusFor(20, 1)).toBe('not_mastered');
  });
});

describe('recomputeMastery — fenêtre glissante (MA-08)', () => {
  it('MA-08 : 5 mauvaises anciennes + 10 bonnes récentes ⇒ mastered', () => {
    const history = measures([0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    const state = recomputeMastery(history);
    expect(state.successRate).toBe(100);
    expect(state.status).toBe('mastered');
    expect(state.evaluatedCount).toBe(15);
  });

  it('la fenêtre ne retient que les 10 dernières mesures', () => {
    const history = measures([100, 100, 100, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const state = recomputeMastery(history);
    expect(state.successRate).toBe(0);
    expect(state.status).toBe('not_mastered');
    expect(MASTERY_WINDOW_SIZE).toBe(10);
  });

  it('evaluatedCount compte le TOTAL, pas la fenêtre', () => {
    const state = recomputeMastery(measures(new Array(25).fill(90)));
    expect(state.evaluatedCount).toBe(25);
    expect(state.successRate).toBe(90);
  });

  it('aucune mesure ⇒ état vide cohérent', () => {
    const state = recomputeMastery([]);
    expect(state).toEqual({
      status: 'not_evaluated',
      successRate: 0,
      evaluatedCount: 0,
      lastEvaluatedAt: null,
      source: null,
    });
  });

  it('conserve la source et la date de la mesure la plus récente', () => {
    const state = recomputeMastery([
      { score: 40, measuredAt: T0, source: 'diagnostic' },
      { score: 90, measuredAt: T0 + DAY, source: 'assessment' },
    ]);
    expect(state.source).toBe('assessment');
    expect(state.lastEvaluatedAt).toBe(T0 + DAY);
  });

  it('l’ordre du tableau reçu n’a aucune importance', () => {
    const chronological = recomputeMastery([
      { score: 0, measuredAt: T0, source: 'practice' },
      { score: 100, measuredAt: T0 + DAY, source: 'revision' },
    ]);
    const shuffled = recomputeMastery([
      { score: 100, measuredAt: T0 + DAY, source: 'revision' },
      { score: 0, measuredAt: T0, source: 'practice' },
    ]);
    expect(shuffled).toEqual(chronological);
  });

  it('arrondit le taux à deux décimales', () => {
    const state = recomputeMastery(measures([100, 100, 0]));
    expect(state.successRate).toBe(66.67);
  });
});

describe('recomputeMastery — MA-09 : reconstructibilité', () => {
  it('MA-09 : le recalcul complet égale l’application incrémentale', () => {
    const history = measures([30, 45, 60, 75, 80, 85, 90, 95, 100, 100, 100, 100]);

    const full = recomputeMastery(history);

    // Application incrémentale : on rejoue l'historique mesure par mesure.
    let incremental = recomputeMastery([]);
    const accumulated: MasteryMeasure[] = [];
    for (const m of history) {
      accumulated.push(m);
      incremental = recomputeMastery(accumulated);
    }

    expect(incremental).toEqual(full);
  });

  it('MA-09b : le recalcul est stable sur 50 rejeux', () => {
    const history = measures([10, 90, 50, 70, 100]);
    const reference = recomputeMastery(history);
    for (let i = 0; i < 50; i++) {
      expect(recomputeMastery(history)).toEqual(reference);
    }
  });
});

describe('recomputeMastery — validation', () => {
  it.each([[-1], [101], [Number.NaN]])('rejette un score hors bornes (%s)', (score) => {
    expect(() => recomputeMastery([{ score, measuredAt: T0, source: 'practice' }])).toThrow(
      InvalidMeasureError,
    );
  });

  it('rejette une date non finie', () => {
    expect(() =>
      recomputeMastery([{ score: 50, measuredAt: Number.POSITIVE_INFINITY, source: 'practice' }]),
    ).toThrow(InvalidMeasureError);
  });
});

describe('statusLabel — aucun vocabulaire stigmatisant', () => {
  const statuses: MasteryStatus[] = ['mastered', 'fragile', 'not_mastered', 'not_evaluated'];

  it.each(statuses)('%s produit un libellé non vide', (status) => {
    expect(statusLabel(status).length).toBeGreaterThan(0);
  });

  it('n’emploie ni « faible », ni « nul », ni « mauvais »', () => {
    for (const status of statuses) {
      const label = statusLabel(status).toLowerCase();
      expect(label).not.toContain('faible');
      expect(label).not.toContain('nul');
      expect(label).not.toContain('mauvais');
    }
  });
});

describe('workPriority — PEDAGOGY.md §3.5', () => {
  it('classe not_mastered avant fragile', () => {
    expect(workPriority('not_mastered')).toBeLessThan(workPriority('fragile'));
  });

  it('not_evaluated n’est jamais une priorité de travail devant fragile', () => {
    expect(workPriority('not_evaluated')).toBeGreaterThan(workPriority('fragile'));
  });

  it('mastered vient en dernier', () => {
    expect(workPriority('mastered')).toBeGreaterThan(workPriority('not_evaluated'));
  });
});
