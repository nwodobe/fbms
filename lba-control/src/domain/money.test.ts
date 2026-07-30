import { describe, expect, it } from 'vitest'
import { allocate, divide, formatMoney, formatWeight, multiply, round2, sum } from './money'

describe('arrondi', () => {
  it('neutralise les artefacts de flottant', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
  })

  it('refuse une valeur non finie', () => {
    expect(() => round2(Number.POSITIVE_INFINITY)).toThrow(/non fini/)
    expect(() => round2(Number.NaN)).toThrow(/non fini/)
  })
})

describe('somme', () => {
  it('ne dérive pas sur une longue liste', () => {
    const values = Array.from({ length: 25 }, () => 0.1)
    expect(sum(values)).toBe(2.5)
  })

  it('vaut zéro sur une liste vide', () => {
    expect(sum([])).toBe(0)
  })
})

describe('multiplication poids × prix', () => {
  it('calcule un montant d’achat', () => {
    expect(multiply(8200, 430)).toBe(3_526_000)
  })

  it('gère les prix décimaux', () => {
    expect(multiply(1234.567, 430.25)).toBe(531_172.45)
  })
})

describe('division', () => {
  it('calcule un coût unitaire', () => {
    expect(divide(3_776_000, 8000)).toBe(472)
  })

  it('renvoie null si le dénominateur est nul', () => {
    // Un poids accepté nul signifie « pas encore calculable », pas « zéro ».
    expect(divide(3_776_000, 0)).toBeNull()
  })

  it('renvoie null sur une entrée non finie', () => {
    expect(divide(Number.NaN, 10)).toBeNull()
  })
})

describe('répartition des dépenses indirectes', () => {
  it('conserve exactement le montant réparti', () => {
    const shares = allocate(1000, [1, 1, 1])
    expect(sum(shares)).toBe(1000)
  })

  it('répartit au prorata des pondérations', () => {
    const shares = allocate(1000, [3, 1])
    expect(shares[0]).toBeCloseTo(750, 2)
    expect(shares[1]).toBeCloseTo(250, 2)
  })

  it('n’égare aucun franc sur un montant indivisible', () => {
    const shares = allocate(100, [1, 1, 1])
    expect(sum(shares)).toBe(100)
    expect(shares).toHaveLength(3)
  })

  it('attribue le reliquat à la part la plus lourde', () => {
    const shares = allocate(10, [7, 3])
    expect(sum(shares)).toBe(10)
    expect(shares[0]!).toBeGreaterThan(shares[1]!)
  })

  it('refuse une clé de répartition vide de sens', () => {
    expect(() => allocate(1000, [0, 0])).toThrow(/strictement positif/)
  })

  it('renvoie une liste vide pour aucune cible', () => {
    expect(allocate(1000, [])).toEqual([])
  })
})

describe('formatage', () => {
  it('affiche un montant en FCFA', () => {
    expect(formatMoney(3_526_000)).toMatch(/3\s?526\s?000 FCFA/)
  })

  it('affiche « — » pour une donnée absente, jamais zéro', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(undefined)).toBe('—')
  })

  it('affiche un poids avec son unité', () => {
    expect(formatWeight(8200)).toMatch(/8\s?200 kg/)
    expect(formatWeight(null)).toBe('—')
  })
})
