import { describe, expect, it } from 'vitest'
import {
  allocateIndirectExpense,
  componentsReconcile,
  computeTcb,
  validateManualAllocation,
  type AllocationBase,
  type TcbExpense,
} from './tcb'
import { sum } from './money'

function expense(overrides: Partial<TcbExpense> & Pick<TcbExpense, 'id' | 'amount'>): TcbExpense {
  return {
    categoryCode: 'transport',
    categoryLabel: 'Transport',
    family: 'Transport',
    nature: 'direct',
    status: 'validee',
    ...overrides,
  }
}

describe('computeTcb', () => {
  it('additionne achat, dépenses directes, quotes-parts indirectes et pertes valorisées', () => {
    const result = computeTcb({
      purchaseValue: 3_526_000,
      expenses: [
        expense({ id: 'e1', amount: 250_000 }),
        expense({ id: 'e2', amount: 40_000, family: 'Manutention', categoryCode: 'manutention' }),
      ],
      allocatedShares: [
        {
          id: 'a1',
          expenseId: 'ind1',
          categoryLabel: 'Gardiennage',
          allocationKey: 'poids_accepte',
          allocatedAmount: 60_000,
        },
      ],
      valuedLosses: [{ id: 'l1', label: 'Écart physique', quantityKg: 120, unitPrice: 450 }],
      acceptedWeightKg: 8_000,
    })

    expect(result.purchaseValue).toBe(3_526_000)
    expect(result.directExpenses).toBe(290_000)
    expect(result.indirectAllocated).toBe(60_000)
    expect(result.valuedLosses).toBe(54_000)
    expect(result.tcbTotal).toBe(3_930_000)
    expect(result.tcbPerAcceptedKg).toBe(491.25)
  })

  it('écarte la catégorie achat_produit pour ne pas compter la matière deux fois', () => {
    const result = computeTcb({
      purchaseValue: 1_000_000,
      expenses: [
        expense({
          id: 'e1',
          amount: 1_000_000,
          categoryCode: 'achat_produit',
          categoryLabel: 'Achat produit',
          family: 'Achat matière',
        }),
      ],
      acceptedWeightKg: 2_000,
    })

    expect(result.tcbTotal).toBe(1_000_000)
    expect(result.directExpenses).toBe(0)
    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0]?.reason).toBe('deja_dans_valeur_achat')
  })

  it('retient une dépense validée non payée et écarte les dépenses rejetées ou annulées', () => {
    const result = computeTcb({
      purchaseValue: 0,
      expenses: [
        expense({ id: 'validee', amount: 100_000, status: 'validee' }),
        expense({ id: 'partielle', amount: 50_000, status: 'partiellement_payee' }),
        expense({ id: 'payee', amount: 30_000, status: 'payee' }),
        expense({ id: 'soumise', amount: 999_999, status: 'soumise' }),
        expense({ id: 'brouillon', amount: 999_999, status: 'brouillon' }),
        expense({ id: 'rejetee', amount: 999_999, status: 'rejetee' }),
        expense({ id: 'annulee', amount: 999_999, status: 'annulee' }),
      ],
      acceptedWeightKg: 1_000,
    })

    expect(result.directExpenses).toBe(180_000)
    expect(result.excluded.map((item) => item.id).sort()).toEqual([
      'annulee',
      'brouillon',
      'rejetee',
      'soumise',
    ])
    expect(new Set(result.excluded.map((item) => item.reason))).toEqual(
      new Set(['statut_non_eligible']),
    )
  })

  it('compte une dépense partiellement payée pour son montant engagé, pas pour la part décaissée', () => {
    // Le reste dû est un coût : le retenir à hauteur du seul décaissement
    // ferait baisser le TCB au moment où la dette augmente.
    const result = computeTcb({
      purchaseValue: 0,
      expenses: [expense({ id: 'e1', amount: 200_000, status: 'partiellement_payee' })],
      acceptedWeightKg: 1_000,
    })

    expect(result.tcbTotal).toBe(200_000)
  })

  it('ne compte jamais une charge indirecte pour son montant total', () => {
    const result = computeTcb({
      purchaseValue: 0,
      expenses: [
        expense({
          id: 'ind1',
          amount: 400_000,
          nature: 'indirect',
          categoryCode: 'gardiennage',
          categoryLabel: 'Gardiennage',
          family: 'Structure',
        }),
      ],
      allocatedShares: [
        {
          id: 'a1',
          expenseId: 'ind1',
          categoryLabel: 'Gardiennage',
          allocationKey: 'poids_accepte',
          allocatedAmount: 120_000,
        },
      ],
      acceptedWeightKg: 3_000,
    })

    expect(result.directExpenses).toBe(0)
    expect(result.indirectAllocated).toBe(120_000)
    expect(result.tcbTotal).toBe(120_000)
    expect(result.excluded[0]?.reason).toBe('charge_indirecte_repartie')
  })

  it('ne double compte pas une avance et l’achat qu’elle finance', () => {
    // Une avance décaissée est un mouvement de trésorerie. Le coût naît de
    // l'achat. Le TCB d'un pisteur ayant reçu 2 000 000 et acheté pour
    // 1 800 000 vaut 1 800 000, jamais 3 800 000.
    const advanceDisbursed = 2_000_000
    const result = computeTcb({
      purchaseValue: 1_800_000,
      expenses: [],
      acceptedWeightKg: 4_000,
    })

    expect(result.tcbTotal).toBe(1_800_000)
    expect(result.tcbTotal).toBeLessThan(advanceDisbursed + 1_800_000)
  })

  it('renvoie un TCB par kilo nul (absent) et non zéro quand rien n’est accepté', () => {
    for (const accepted of [null, 0]) {
      const result = computeTcb({
        purchaseValue: 500_000,
        expenses: [],
        acceptedWeightKg: accepted,
      })
      expect(result.tcbPerAcceptedKg).toBeNull()
      expect(result.acceptedWeightKg).toBeNull()
      expect(result.tcbTotal).toBe(500_000)
    }
  })

  it('produit une décomposition qui reconstitue exactement le total', () => {
    const result = computeTcb({
      purchaseValue: 1_234_567.89,
      expenses: [
        expense({ id: 'e1', amount: 12_345.67 }),
        expense({ id: 'e2', amount: 7_654.33, family: 'Qualité', categoryCode: 'analyse' }),
        expense({ id: 'e3', amount: 1_111.11, family: 'Qualité', categoryCode: 'analyse' }),
      ],
      allocatedShares: [
        {
          id: 'a1',
          expenseId: 'ind',
          categoryLabel: 'Structure',
          allocationKey: 'valeur_achat',
          allocatedAmount: 999.99,
        },
      ],
      valuedLosses: [{ id: 'l1', label: 'Perte', quantityKg: 33.333, unitPrice: 450 }],
      acceptedWeightKg: 2_500,
    })

    expect(componentsReconcile(result)).toBe(true)
    expect(sum(result.components.map((c) => c.amount))).toBe(result.tcbTotal)
  })

  it('remonte les identifiants sources pour que chaque composante soit traçable', () => {
    const result = computeTcb({
      purchaseValue: 0,
      expenses: [
        expense({ id: 'e1', amount: 10_000, family: 'Transport' }),
        expense({ id: 'e2', amount: 20_000, family: 'Transport' }),
      ],
      acceptedWeightKg: 1_000,
    })

    const transport = result.components.find((c) => c.code === 'depenses:Transport')
    expect(transport?.sourceIds).toEqual(['e1', 'e2'])
    expect(transport?.sourceCount).toBe(2)
    expect(transport?.amountPerKg).toBe(30)
  })

  it('isole la part de TCB réellement maîtrisée par le pisteur', () => {
    const result = computeTcb({
      purchaseValue: 0,
      expenses: [
        expense({ id: 'e1', amount: 50_000, isControllableByAgent: true }),
        expense({ id: 'e2', amount: 300_000, isControllableByAgent: false, family: 'Structure' }),
      ],
      acceptedWeightKg: 1_000,
    })

    expect(result.controllableExpenses).toBe(50_000)
    expect(result.directExpenses).toBe(350_000)
  })
})

describe('allocateIndirectExpense', () => {
  const targets: AllocationBase[] = [
    { targetType: 'partner', targetId: 'p1', targetLabel: 'OLAM', baseValue: 8_000 },
    { targetType: 'partner', targetId: 'p2', targetLabel: 'DORADO', baseValue: 2_000 },
  ]

  it('répartit au prorata de la clé sans perdre un franc', () => {
    const outcome = allocateIndirectExpense(400_000, 'poids_accepte', targets)
    expect(outcome.status).toBe('reparti')
    if (outcome.status !== 'reparti') return

    expect(outcome.lines.map((line) => line.allocatedAmount)).toEqual([320_000, 80_000])
    expect(sum(outcome.lines.map((line) => line.allocatedAmount))).toBe(400_000)
    expect(outcome.lines[0]?.shareRatio).toBe(0.8)
    expect(outcome.lines[0]?.totalBaseValue).toBe(10_000)
  })

  it('conserve le montant exact malgré un reste d’arrondi', () => {
    const outcome = allocateIndirectExpense(100, 'nb_livraisons', [
      { targetType: 'transfer', targetId: 't1', targetLabel: 'T1', baseValue: 1 },
      { targetType: 'transfer', targetId: 't2', targetLabel: 'T2', baseValue: 1 },
      { targetType: 'transfer', targetId: 't3', targetLabel: 'T3', baseValue: 1 },
    ])
    expect(outcome.status).toBe('reparti')
    if (outcome.status !== 'reparti') return

    expect(sum(outcome.lines.map((line) => line.allocatedAmount))).toBe(100)
  })

  it('refuse de répartir sur une clé dont la base totale est nulle', () => {
    const outcome = allocateIndirectExpense(400_000, 'poids_accepte', [
      { targetType: 'partner', targetId: 'p1', targetLabel: 'OLAM', baseValue: 0 },
    ])

    expect(outcome.status).toBe('impossible')
    if (outcome.status !== 'impossible') return
    expect(outcome.reason).toContain('Poids accepté')
  })

  it('refuse une base négative et une liste de cibles vide', () => {
    expect(
      allocateIndirectExpense(1_000, 'nb_sacs', [
        { targetType: 'lot', targetId: 'l1', targetLabel: 'L1', baseValue: -5 },
      ]).status,
    ).toBe('impossible')

    expect(allocateIndirectExpense(1_000, 'nb_sacs', []).status).toBe('impossible')
  })

  it('ne calcule jamais une clé manuelle', () => {
    const outcome = allocateIndirectExpense(400_000, 'manuel', targets)
    expect(outcome.status).toBe('impossible')
    if (outcome.status !== 'impossible') return
    expect(outcome.reason).toContain('approuvée')
  })
})

describe('validateManualAllocation', () => {
  const base: AllocationBase[] = [
    { targetType: 'partner', targetId: 'p1', targetLabel: 'OLAM', baseValue: 0 },
    { targetType: 'partner', targetId: 'p2', targetLabel: 'DORADO', baseValue: 0 },
  ]

  it('accepte une répartition qui boucle exactement', () => {
    const result = validateManualAllocation(300_000, [
      { ...base[0]!, allocatedAmount: 250_000 },
      { ...base[1]!, allocatedAmount: 50_000 },
    ])

    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.lines[0]?.shareRatio).toBeCloseTo(0.83333333, 8)
    expect(result.lines.every((line) => line.isManual)).toBe(true)
  })

  it('refuse une répartition qui ne rend pas le montant', () => {
    const result = validateManualAllocation(300_000, [
      { ...base[0]!, allocatedAmount: 250_000 },
      { ...base[1]!, allocatedAmount: 40_000 },
    ])

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.reason).toContain('ne rend pas le montant')
  })

  it('refuse une quote-part négative et une répartition vide', () => {
    expect(
      validateManualAllocation(0, [{ ...base[0]!, allocatedAmount: -1 }]).valid,
    ).toBe(false)
    expect(validateManualAllocation(1_000, []).valid).toBe(false)
  })
})
