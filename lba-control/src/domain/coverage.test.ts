import { describe, expect, it } from 'vitest'
import {
  allocateCoverage,
  computeExposure,
  coverageRate,
  daysBetween,
  type Advance,
  type CoverageEvent,
} from './coverage'

const advance = (id: string, amount: number, issuedAt: string, deadline?: string): Advance => ({
  id,
  fieldAgentId: 'agent-1',
  partnerCompanyId: 'olam',
  amount,
  issuedAt,
  justificationDeadline: deadline ?? null,
})

const event = (id: string, amount: number, occurredAt: string, over: Partial<CoverageEvent> = {}): CoverageEvent => ({
  id,
  sourceType: 'reception',
  amount,
  occurredAt,
  ...over,
})

describe('calcul de jours', () => {
  it('compte les jours entre deux dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7)
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0)
  })

  it('traverse correctement un changement de mois', () => {
    expect(daysBetween('2026-02-25', '2026-03-04')).toBe(7)
  })
})

describe('allocation FIFO', () => {
  it('couvre les premières avances en premier', () => {
    const result = allocateCoverage(
      [advance('a1', 1_000_000, '2026-01-01'), advance('a2', 1_000_000, '2026-02-01')],
      [event('e1', 1_200_000, '2026-02-10')],
      '2026-02-15',
    )

    expect(result.perAdvance[0]!.isFullyCovered).toBe(true)
    expect(result.perAdvance[1]!.outstanding).toBe(800_000)
  })

  it('permet à une livraison de couvrir plusieurs avances', () => {
    const result = allocateCoverage(
      [advance('a1', 500_000, '2026-01-01'), advance('a2', 500_000, '2026-01-05')],
      [event('e1', 1_000_000, '2026-01-10')],
      '2026-01-15',
    )
    expect(result.totalOutstanding).toBe(0)
    expect(result.allocations).toHaveLength(2)
  })

  it('permet à une avance d’être couverte par plusieurs livraisons', () => {
    const result = allocateCoverage(
      [advance('a1', 1_000_000, '2026-01-01')],
      [event('e1', 400_000, '2026-01-05'), event('e2', 600_000, '2026-01-09')],
      '2026-01-10',
    )
    expect(result.totalOutstanding).toBe(0)
    expect(result.allocations.filter((a) => a.advanceId === 'a1')).toHaveLength(2)
  })

  it('CONSERVE la date d’origine après une couverture partielle', () => {
    // Le point qui fait tout : une nouvelle avance ne doit pas rajeunir un
    // reliquat ancien, sinon un retard de deux mois disparaît des écrans.
    const result = allocateCoverage(
      [advance('ancienne', 1_000_000, '2026-01-01'), advance('recente', 1_000_000, '2026-03-01')],
      [event('e1', 300_000, '2026-03-05')],
      '2026-03-10',
    )

    const ancienne = result.perAdvance.find((row) => row.advance.id === 'ancienne')!
    expect(ancienne.outstanding).toBe(700_000)
    expect(ancienne.ageDays).toBe(daysBetween('2026-01-01', '2026-03-10'))
    expect(result.oldestOutstandingAgeDays).toBe(ancienne.ageDays)
  })

  it('une avance entièrement couverte n’a plus d’ancienneté', () => {
    const result = allocateCoverage(
      [advance('a1', 500_000, '2026-01-01')],
      [event('e1', 500_000, '2026-01-20')],
      '2026-06-01',
    )
    expect(result.perAdvance[0]!.ageDays).toBe(0)
    expect(result.oldestOutstandingAgeDays).toBe(0)
  })

  it('rend visible un excédent de couverture au lieu de l’absorber', () => {
    const result = allocateCoverage(
      [advance('a1', 500_000, '2026-01-01')],
      [event('e1', 800_000, '2026-01-10')],
      '2026-01-15',
    )
    expect(result.totalOutstanding).toBe(0)
    expect(result.unallocatedCoverage).toBe(300_000)
  })

  it('signale une avance dépassant son délai de justification', () => {
    const result = allocateCoverage(
      [advance('a1', 500_000, '2026-01-01', '2026-01-08')],
      [],
      '2026-01-20',
    )
    expect(result.perAdvance[0]!.isOverdue).toBe(true)
  })

  it('ne signale pas un retard si l’avance est couverte', () => {
    const result = allocateCoverage(
      [advance('a1', 500_000, '2026-01-01', '2026-01-08')],
      [event('e1', 500_000, '2026-01-05')],
      '2026-01-20',
    )
    expect(result.perAdvance[0]!.isOverdue).toBe(false)
  })

  it('est déterministe quelle que soit la présentation des données', () => {
    const advances = [advance('b', 400_000, '2026-01-01'), advance('a', 400_000, '2026-01-01')]
    const events = [event('e2', 300_000, '2026-01-10'), event('e1', 300_000, '2026-01-10')]

    const first = allocateCoverage(advances, events, '2026-01-15')
    const second = allocateCoverage([...advances].reverse(), [...events].reverse(), '2026-01-15')

    expect(first.allocations).toEqual(second.allocations)
  })

  it('traite un remboursement comme une couverture', () => {
    const result = allocateCoverage(
      [advance('a1', 500_000, '2026-01-01')],
      [event('r1', 200_000, '2026-01-05', { sourceType: 'repayment' })],
      '2026-01-10',
    )
    expect(result.perAdvance[0]!.outstanding).toBe(300_000)
  })

  it('honore une affectation manuelle approuvée avant le FIFO', () => {
    const result = allocateCoverage(
      [advance('a1', 500_000, '2026-01-01'), advance('a2', 500_000, '2026-02-01')],
      [
        event('m1', 500_000, '2026-03-01', {
          isManual: true,
          targetAdvanceId: 'a2',
          approvedBy: 'proprietaire',
          reason: 'Correction validée en comité',
        }),
      ],
      '2026-03-05',
    )

    expect(result.perAdvance.find((r) => r.advance.id === 'a2')!.isFullyCovered).toBe(true)
    expect(result.perAdvance.find((r) => r.advance.id === 'a1')!.outstanding).toBe(500_000)
  })

  it('sans avance, tout est excédent', () => {
    const result = allocateCoverage([], [event('e1', 100_000, '2026-01-01')], '2026-01-02')
    expect(result.totalAdvanced).toBe(0)
    expect(result.unallocatedCoverage).toBe(100_000)
  })
})

describe('exposition', () => {
  const base = {
    advanced: 5_000_000,
    recognized: 2_000_000,
    repaid: 0,
    authorizedExpenses: 0,
    stockAtAgentValue: 0,
    inTransitValue: 0,
  }

  it('déduit la valeur reconnue, les remboursements et les dépenses autorisées', () => {
    const result = computeExposure({ ...base, repaid: 500_000, authorizedExpenses: 300_000 })
    expect(result.exposure).toBe(2_200_000)
  })

  it('distingue l’exposition adossée à de la matière', () => {
    // 3 millions d'exposition, dont 2,5 en stock et transit : ce n'est pas un
    // manquant, c'est une opération en cours.
    const result = computeExposure({ ...base, stockAtAgentValue: 1_500_000, inTransitValue: 1_000_000 })
    expect(result.exposure).toBe(3_000_000)
    expect(result.backedByMatter).toBe(2_500_000)
    expect(result.unexplained).toBe(500_000)
  })

  it('ne rend jamais un écart inexpliqué négatif', () => {
    const result = computeExposure({ ...base, stockAtAgentValue: 10_000_000 })
    expect(result.unexplained).toBe(0)
  })

  it('conserve chaque état séparément', () => {
    const result = computeExposure({ ...base, stockAtAgentValue: 800_000, inTransitValue: 200_000 })
    // Aucun « solde » unique : les états restent lisibles un par un.
    expect(result.advanced).toBe(5_000_000)
    expect(result.recognized).toBe(2_000_000)
    expect(result.stockAtAgentValue).toBe(800_000)
    expect(result.inTransitValue).toBe(200_000)
  })
})

describe('taux de couverture', () => {
  it('calcule un pourcentage', () => {
    expect(coverageRate(750_000, 1_000_000)).toBe(75)
  })

  it('renvoie null sans avance', () => {
    expect(coverageRate(0, 0)).toBeNull()
  })

  it('laisse apparaître un excédent au-delà de 100 %', () => {
    expect(coverageRate(1_200_000, 1_000_000)).toBe(120)
  })
})
