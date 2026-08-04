/**
 * Tests de docs/TEST_STRATEGY.md §4.3 (RV-01 → RV-13).
 *
 * Toutes les dates sont INJECTÉES. Aucun appel à Date.now() : c'est ce qui
 * permet de vérifier « J+30 » sans attendre trente jours (RV-13).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CandidateItem,
  FAILURES_BEFORE_LESSON_RETURN,
  InvalidRevisionStateError,
  MAX_INTERVAL_INDEX,
  REVISION_INTERVALS_DAYS,
  type RevisionPlanState,
  applyRevisionResult,
  clampIndex,
  compareCandidates,
  composeDailySession,
  dueDateFrom,
  intervalDaysFor,
  isDue,
  overdueDays,
  scheduleFirst,
} from './index';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY);
}

function stateAt(intervalIndex: number, overrides: Partial<RevisionPlanState> = {}) {
  return {
    intervalIndex,
    dueAt: dueDateFrom(NOW, intervalIndex),
    consecutiveSuccess: 0,
    consecutiveFailure: 0,
    requiresLessonReturn: false,
    isConsolidated: false,
    ...overrides,
  } satisfies RevisionPlanState;
}

describe('calendrier (RV-01)', () => {
  it('respecte J+1, J+3, J+7, J+14, J+30', () => {
    expect(REVISION_INTERVALS_DAYS).toEqual([1, 3, 7, 14, 30]);
  });

  it('RV-01 : la première programmation est à J+1', () => {
    const plan = scheduleFirst(NOW);
    expect(plan.intervalIndex).toBe(0);
    expect(daysBetween(NOW, plan.dueAt)).toBe(1);
    expect(plan.isConsolidated).toBe(false);
  });

  it('borne les index hors calendrier', () => {
    expect(intervalDaysFor(-5)).toBe(1);
    expect(intervalDaysFor(99)).toBe(30);
  });

  it('clampIndex ramène dans [0, 4] et tronque les décimales', () => {
    expect(clampIndex(-3)).toBe(0);
    expect(clampIndex(0)).toBe(0);
    expect(clampIndex(2)).toBe(2);
    expect(clampIndex(2.9)).toBe(2);
    expect(clampIndex(MAX_INTERVAL_INDEX)).toBe(MAX_INTERVAL_INDEX);
    expect(clampIndex(120)).toBe(MAX_INTERVAL_INDEX);
  });

  it('chaque index du calendrier renvoie le bon nombre de jours', () => {
    expect(REVISION_INTERVALS_DAYS.map((_, i) => intervalDaysFor(i))).toEqual([1, 3, 7, 14, 30]);
  });
});

describe('progression sur réussite (RV-02 → RV-04)', () => {
  it('RV-02 : réussite à l’index 0 ⇒ index 1, J+3', () => {
    const next = applyRevisionResult(stateAt(0), 'success', NOW);
    expect(next.intervalIndex).toBe(1);
    expect(daysBetween(NOW, next.dueAt)).toBe(3);
  });

  it('RV-03 : réussite à l’index 3 ⇒ index 4, J+30', () => {
    const next = applyRevisionResult(stateAt(3), 'success', NOW);
    expect(next.intervalIndex).toBe(4);
    expect(daysBetween(NOW, next.dueAt)).toBe(30);
  });

  it('RV-04 : réussite à l’index 4 ⇒ reste à 4 (plafond)', () => {
    const next = applyRevisionResult(stateAt(MAX_INTERVAL_INDEX), 'success', NOW);
    expect(next.intervalIndex).toBe(MAX_INTERVAL_INDEX);
    expect(daysBetween(NOW, next.dueAt)).toBe(30);
  });

  it('une réussite remet à zéro le compteur d’échecs', () => {
    const next = applyRevisionResult(stateAt(1, { consecutiveFailure: 1 }), 'success', NOW);
    expect(next.consecutiveFailure).toBe(0);
    expect(next.consecutiveSuccess).toBe(1);
    expect(next.requiresLessonReturn).toBe(false);
  });
});

describe('régression sur échec (RV-05 → RV-07)', () => {
  it('RV-05 : échec à l’index 2 ⇒ index 1, J+3', () => {
    const next = applyRevisionResult(stateAt(2), 'failure', NOW);
    expect(next.intervalIndex).toBe(1);
    expect(daysBetween(NOW, next.dueAt)).toBe(3);
  });

  it('RV-06 : échec à l’index 0 ⇒ reste à 0, J+1', () => {
    const next = applyRevisionResult(stateAt(0), 'failure', NOW);
    expect(next.intervalIndex).toBe(0);
    expect(daysBetween(NOW, next.dueAt)).toBe(1);
  });

  it('RV-07 : 2 échecs consécutifs ⇒ index 0 ET retour à la leçon', () => {
    const first = applyRevisionResult(stateAt(4), 'failure', NOW);
    expect(first.requiresLessonReturn).toBe(false);
    expect(first.intervalIndex).toBe(3);

    const second = applyRevisionResult(first, 'failure', NOW);
    expect(second.consecutiveFailure).toBe(FAILURES_BEFORE_LESSON_RETURN);
    expect(second.intervalIndex).toBe(0);
    expect(second.requiresLessonReturn).toBe(true);
  });

  it('un échec annule la consolidation', () => {
    const next = applyRevisionResult(stateAt(4, { isConsolidated: true }), 'failure', NOW);
    expect(next.isConsolidated).toBe(false);
  });
});

describe('consolidation (RV-08)', () => {
  it('RV-08 : 3 réussites consécutives au dernier index ⇒ consolidé', () => {
    let state = stateAt(MAX_INTERVAL_INDEX);
    state = applyRevisionResult(state, 'success', NOW);
    expect(state.isConsolidated).toBe(false);
    state = applyRevisionResult(state, 'success', NOW);
    expect(state.isConsolidated).toBe(false);
    state = applyRevisionResult(state, 'success', NOW);
    expect(state.isConsolidated).toBe(true);
    expect(state.consecutiveSuccess).toBe(3);
  });

  it('3 réussites à un index inférieur ne consolident pas', () => {
    let state = stateAt(0);
    for (let i = 0; i < 3; i++) state = applyRevisionResult(state, 'success', NOW);
    expect(state.isConsolidated).toBe(false);
  });

  it('la consolidation acquise se conserve', () => {
    const consolidated = stateAt(MAX_INTERVAL_INDEX, {
      isConsolidated: true,
      consecutiveSuccess: 3,
    });
    expect(applyRevisionResult(consolidated, 'success', NOW).isConsolidated).toBe(true);
  });
});

describe('révision manquée (RV-09) — aucune perte', () => {
  it('RV-09 : manquée de 5 jours ⇒ replanifiée, l’intervalle N’AVANCE PAS', () => {
    const late = NOW + 5 * DAY;
    const state = stateAt(2);
    const next = applyRevisionResult(state, 'missed', late);

    expect(next.intervalIndex).toBe(2);
    expect(daysBetween(late, next.dueAt)).toBe(7);
    expect(next.consecutiveSuccess).toBe(state.consecutiveSuccess);
    expect(next.consecutiveFailure).toBe(state.consecutiveFailure);
  });

  it('une révision manquée n’est jamais annulée', () => {
    const next = applyRevisionResult(stateAt(0), 'missed', NOW + 30 * DAY);
    expect(next.dueAt).toBeGreaterThan(NOW + 30 * DAY);
  });
});

describe('composeDailySession (RV-10) — plafond de temps', () => {
  const candidates: CandidateItem[] = [
    { id: 'new-1', kind: 'new_skill', estimatedMinutes: 20, dueAt: null },
    { id: 'due-1', kind: 'due_today', estimatedMinutes: 15, dueAt: NOW },
    { id: 'over-2', kind: 'overdue', estimatedMinutes: 10, dueAt: NOW - 2 * DAY },
    { id: 'over-1', kind: 'overdue', estimatedMinutes: 10, dueAt: NOW - 9 * DAY },
    { id: 'err-1', kind: 'recurrent_error', estimatedMinutes: 15, dueAt: NOW - DAY },
  ];

  it('RV-10 : ne dépasse jamais le temps disponible', () => {
    const session = composeDailySession(candidates, 60);
    expect(session.totalMinutes).toBeLessThanOrEqual(60);
  });

  it('priorise les retards, les plus anciens d’abord', () => {
    const session = composeDailySession(candidates, 60);
    expect(session.items[0]?.id).toBe('over-1');
    expect(session.items[1]?.id).toBe('over-2');
    expect(session.items[2]?.id).toBe('err-1');
  });

  it('reporte les éléments non retenus — jamais perdus', () => {
    const session = composeDailySession(candidates, 20);
    expect(session.items).toHaveLength(2);
    expect(session.deferred).toHaveLength(3);
    expect(session.items.length + session.deferred.length).toBe(candidates.length);
  });

  it('temps nul ⇒ séance vide, tout est reporté', () => {
    const session = composeDailySession(candidates, 0);
    expect(session.items).toHaveLength(0);
    expect(session.deferred).toHaveLength(candidates.length);
    expect(session.totalMinutes).toBe(0);
  });

  it('aucun candidat ⇒ séance vide', () => {
    const session = composeDailySession([], 60);
    expect(session).toEqual({ items: [], totalMinutes: 0, deferred: [] });
  });

  it('est déterministe quel que soit l’ordre d’entrée', () => {
    const reference = composeDailySession(candidates, 45);
    const reversed = composeDailySession([...candidates].reverse(), 45);
    expect(reversed.items.map((i) => i.id)).toEqual(reference.items.map((i) => i.id));
  });

  it('départage deux éléments identiques par identifiant', () => {
    const tie: CandidateItem[] = [
      { id: 'b', kind: 'due_today', estimatedMinutes: 10, dueAt: NOW },
      { id: 'a', kind: 'due_today', estimatedMinutes: 10, dueAt: NOW },
    ];
    expect(composeDailySession(tie, 60).items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('classe les nouvelles compétences (dueAt null) en dernier de leur groupe', () => {
    const items: CandidateItem[] = [
      { id: 'n1', kind: 'new_skill', estimatedMinutes: 5, dueAt: null },
      { id: 'n2', kind: 'new_skill', estimatedMinutes: 5, dueAt: NOW },
    ];
    expect(composeDailySession(items, 60).items.map((i) => i.id)).toEqual(['n2', 'n1']);
  });

  it('départage par identifiant deux éléments tous deux sans échéance', () => {
    const items: CandidateItem[] = [
      { id: 'z', kind: 'new_skill', estimatedMinutes: 5, dueAt: null },
      { id: 'a', kind: 'new_skill', estimatedMinutes: 5, dueAt: null },
    ];
    expect(composeDailySession(items, 60).items.map((i) => i.id)).toEqual(['a', 'z']);
  });

  it('reste stable si deux éléments portent le même identifiant', () => {
    const items: CandidateItem[] = [
      { id: 'dup', kind: 'due_today', estimatedMinutes: 5, dueAt: NOW },
      { id: 'dup', kind: 'due_today', estimatedMinutes: 5, dueAt: NOW },
    ];
    const session = composeDailySession(items, 60);
    expect(session.items).toHaveLength(2);
    expect(session.totalMinutes).toBe(10);
  });

  it('rejette un temps disponible invalide', () => {
    expect(() => composeDailySession([], -1)).toThrow(InvalidRevisionStateError);
    expect(() => composeDailySession([], Number.NaN)).toThrow(InvalidRevisionStateError);
  });
});

describe('compareCandidates — ordre total, testé directement', () => {
  const base = { estimatedMinutes: 10 } as const;
  const overdue: CandidateItem = { ...base, id: 'x', kind: 'overdue', dueAt: NOW };
  const dueToday: CandidateItem = { ...base, id: 'x', kind: 'due_today', dueAt: NOW };

  it('classe par nature avant tout', () => {
    expect(compareCandidates(overdue, dueToday)).toBeLessThan(0);
    expect(compareCandidates(dueToday, overdue)).toBeGreaterThan(0);
  });

  it('à nature égale, classe par échéance croissante', () => {
    const older: CandidateItem = { ...base, id: 'x', kind: 'overdue', dueAt: NOW - DAY };
    expect(compareCandidates(older, overdue)).toBeLessThan(0);
    expect(compareCandidates(overdue, older)).toBeGreaterThan(0);
  });

  it('une échéance nulle passe après une échéance datée', () => {
    const undated: CandidateItem = { ...base, id: 'x', kind: 'overdue', dueAt: null };
    expect(compareCandidates(undated, overdue)).toBeGreaterThan(0);
    expect(compareCandidates(overdue, undated)).toBeLessThan(0);
  });

  it('à échéance égale, classe par identifiant croissant', () => {
    const a: CandidateItem = { ...base, id: 'a', kind: 'overdue', dueAt: NOW };
    const b: CandidateItem = { ...base, id: 'b', kind: 'overdue', dueAt: NOW };
    expect(compareCandidates(a, b)).toBe(-1);
    expect(compareCandidates(b, a)).toBe(1);
  });

  it('retourne 0 sur deux candidats indiscernables', () => {
    expect(compareCandidates(overdue, { ...overdue })).toBe(0);
  });

  it('deux candidats sans échéance sont départagés par identifiant', () => {
    const a: CandidateItem = { ...base, id: 'a', kind: 'new_skill', dueAt: null };
    const z: CandidateItem = { ...base, id: 'z', kind: 'new_skill', dueAt: null };
    expect(compareCandidates(a, z)).toBe(-1);
    expect(compareCandidates(z, a)).toBe(1);
    expect(compareCandidates(a, { ...a })).toBe(0);
  });
});

describe('propriétés (RV-11, RV-12)', () => {
  it('RV-11 : aucune échéance produite n’est dans le passé', () => {
    for (let index = 0; index <= MAX_INTERVAL_INDEX; index++) {
      for (const result of ['success', 'failure', 'missed'] as const) {
        const next = applyRevisionResult(stateAt(index), result, NOW);
        expect(next.dueAt).toBeGreaterThan(NOW);
      }
    }
  });

  it('RV-12 : déterminisme avec date injectée — 100 appels', () => {
    const state = stateAt(2);
    const reference = applyRevisionResult(state, 'success', NOW);
    for (let i = 0; i < 100; i++) {
      expect(applyRevisionResult(state, 'success', NOW)).toEqual(reference);
    }
  });

  it('RV-12b : un historique rejoué produit le même calendrier', () => {
    const sequence = ['success', 'success', 'failure', 'success', 'missed', 'success'] as const;
    const replay = () => {
      let state = scheduleFirst(NOW);
      for (const r of sequence) state = applyRevisionResult(state, r, NOW);
      return state;
    };
    expect(replay()).toEqual(replay());
  });
});

describe('RV-13 : la date n’est jamais lue en interne', () => {
  it('le module source ne contient ni new Date(), ni Date.now(), ni Math.random()', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '') // commentaires de bloc
      .replace(/\/\/.*$/gm, ''); // commentaires de ligne

    expect(code).not.toMatch(/new\s+Date\s*\(/);
    expect(code).not.toMatch(/Date\s*\.\s*now\s*\(/);
    expect(code).not.toMatch(/Math\s*\.\s*random\s*\(/);
  });
});

describe('validation d’état', () => {
  it.each([
    ['index négatif', { intervalIndex: -1 }],
    ['index non entier', { intervalIndex: 1.5 }],
    ['dueAt non fini', { dueAt: Number.NaN }],
    ['compteur négatif', { consecutiveFailure: -1 }],
    ['succès négatif', { consecutiveSuccess: -1 }],
  ])('rejette un état invalide : %s', (_label, overrides) => {
    expect(() =>
      applyRevisionResult({ ...stateAt(1), ...overrides } as RevisionPlanState, 'success', NOW),
    ).toThrow(InvalidRevisionStateError);
  });
});

describe('utilitaires d’échéance', () => {
  it('isDue est vrai à l’échéance exacte', () => {
    const state = stateAt(0);
    expect(isDue(state, state.dueAt - 1)).toBe(false);
    expect(isDue(state, state.dueAt)).toBe(true);
  });

  it('overdueDays vaut 0 avant l’échéance', () => {
    const state = stateAt(0);
    expect(overdueDays(state, NOW)).toBe(0);
  });

  it('overdueDays compte les jours entiers de retard', () => {
    const state = stateAt(0);
    expect(overdueDays(state, state.dueAt + 3 * DAY + 1000)).toBe(3);
  });
});
