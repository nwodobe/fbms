import { describe, expect, it } from 'vitest'
import {
  checkPurchasePrice,
  detectOverlaps,
  isExpired,
  planRevision,
  previousDay,
  priceHistory,
  resolveApplicablePrice,
  type NegotiatedPrice,
} from './prices'

const price = (over: Partial<NegotiatedPrice> & Pick<NegotiatedPrice, 'id' | 'validFrom'>): NegotiatedPrice => ({
  contractId: 'contract-1',
  priceType: 'negocie',
  price: 450,
  validTo: null,
  version: 1,
  isProvisional: false,
  ...over,
})

describe('prix applicable à une date', () => {
  const prices = [
    price({ id: 'v1', price: 430, validFrom: '2026-01-01', validTo: '2026-02-28', version: 1 }),
    price({ id: 'v2', price: 450, validFrom: '2026-03-01', validTo: null, version: 2 }),
  ]

  it('retient la version en vigueur à la date demandée', () => {
    expect(resolveApplicablePrice(prices, 'negocie', '2026-01-15')?.price).toBe(430)
    expect(resolveApplicablePrice(prices, 'negocie', '2026-04-10')?.price).toBe(450)
  })

  it('inclut les bornes de validité', () => {
    expect(resolveApplicablePrice(prices, 'negocie', '2026-02-28')?.id).toBe('v1')
    expect(resolveApplicablePrice(prices, 'negocie', '2026-03-01')?.id).toBe('v2')
  })

  it('un prix expiré reste applicable aux opérations de sa période', () => {
    // C'est tout l'intérêt de l'historisation : une opération de janvier reste
    // valorisée au prix de janvier, même après trois révisions.
    expect(resolveApplicablePrice(prices, 'negocie', '2026-01-20')?.id).toBe('v1')
  })

  it('retourne null hors de toute période', () => {
    expect(resolveApplicablePrice(prices, 'negocie', '2025-12-31')).toBeNull()
  })

  it('ne confond pas deux types de prix', () => {
    const withCeiling = [...prices, price({ id: 'c1', priceType: 'plafond_achat', price: 435, validFrom: '2026-01-01' })]
    expect(resolveApplicablePrice(withCeiling, 'plafond_achat', '2026-04-10')?.price).toBe(435)
    expect(resolveApplicablePrice(withCeiling, 'negocie', '2026-04-10')?.price).toBe(450)
  })

  it('départage un chevauchement de façon déterministe', () => {
    const overlapping = [
      price({ id: 'a', price: 400, validFrom: '2026-01-01', validTo: null, version: 1 }),
      price({ id: 'b', price: 460, validFrom: '2026-02-01', validTo: null, version: 2 }),
    ]
    expect(resolveApplicablePrice(overlapping, 'negocie', '2026-03-01')?.id).toBe('b')
  })
})

describe('expiration', () => {
  it('détecte un prix clos', () => {
    const p = price({ id: 'v1', validFrom: '2026-01-01', validTo: '2026-02-28' })
    expect(isExpired(p, '2026-03-01')).toBe(true)
    expect(isExpired(p, '2026-02-28')).toBe(false)
  })

  it('un prix sans date de fin n’expire jamais', () => {
    expect(isExpired(price({ id: 'v1', validFrom: '2026-01-01' }), '2030-01-01')).toBe(false)
  })
})

describe('détection de chevauchement', () => {
  it('signale deux périodes qui se recouvrent', () => {
    const overlaps = detectOverlaps([
      price({ id: 'a', validFrom: '2026-01-01', validTo: '2026-03-31' }),
      price({ id: 'b', validFrom: '2026-03-01', validTo: '2026-06-30', version: 2 }),
    ])
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0]!.first.id).toBe('a')
  })

  it('signale un prix ouvert suivi d’un autre', () => {
    const overlaps = detectOverlaps([
      price({ id: 'a', validFrom: '2026-01-01', validTo: null }),
      price({ id: 'b', validFrom: '2026-03-01', validTo: null, version: 2 }),
    ])
    expect(overlaps).toHaveLength(1)
  })

  it('accepte des périodes contiguës mais disjointes', () => {
    expect(
      detectOverlaps([
        price({ id: 'a', validFrom: '2026-01-01', validTo: '2026-02-28' }),
        price({ id: 'b', validFrom: '2026-03-01', validTo: null, version: 2 }),
      ]),
    ).toEqual([])
  })

  it('ne compare pas des types de prix différents', () => {
    expect(
      detectOverlaps([
        price({ id: 'a', priceType: 'negocie', validFrom: '2026-01-01', validTo: null }),
        price({ id: 'b', priceType: 'plafond_achat', validFrom: '2026-01-01', validTo: null }),
      ]),
    ).toEqual([])
  })
})

describe('contrôle du prix d’un achat', () => {
  const prices = [
    price({ id: 'n', priceType: 'negocie', price: 450, validFrom: '2026-01-01' }),
    price({ id: 'c', priceType: 'plafond_achat', price: 435, validFrom: '2026-01-01' }),
  ]

  it('accepte un prix sous le plafond', () => {
    const result = checkPurchasePrice(prices, 430, '2026-02-01')
    expect(result.aboveCeiling).toBe(false)
    expect(result.message).toBeNull()
  })

  it('refuse un prix au-dessus du plafond, en donnant le plafond', () => {
    const result = checkPurchasePrice(prices, 445, '2026-02-01')
    expect(result.aboveCeiling).toBe(true)
    expect(result.message).toMatch(/dépasse le plafond du contrat \(435 FCFA\/kg\)/)
  })

  it('accepte un prix exactement égal au plafond', () => {
    expect(checkPurchasePrice(prices, 435, '2026-02-01').aboveCeiling).toBe(false)
  })

  it('signale une opération hors période contractuelle', () => {
    const result = checkPurchasePrice(prices, 430, '2025-06-01')
    expect(result.outOfPeriod).toBe(true)
    expect(result.message).toMatch(/Aucun prix négocié ne couvre cette date/)
  })

  it('distingue « hors période » de « au-dessus du plafond »', () => {
    // Les deux problèmes appellent des actions différentes : corriger le
    // contrat, ou demander une dérogation.
    const outOfPeriod = checkPurchasePrice(prices, 999, '2025-06-01')
    expect(outOfPeriod.outOfPeriod).toBe(true)
    expect(outOfPeriod.aboveCeiling).toBe(false)
  })
})

describe('révision de prix', () => {
  it('calcule la veille de la date d’effet', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28')
    expect(previousDay('2026-01-01')).toBe('2025-12-31')
  })

  it('clôt la version courante et incrémente le numéro de version', () => {
    const prices = [price({ id: 'v1', price: 430, validFrom: '2026-01-01', validTo: null, version: 1 })]
    const revision = planRevision(prices, 'negocie', '2026-03-01')

    expect(revision.supersededId).toBe('v1')
    expect(revision.supersededValidTo).toBe('2026-02-28')
    expect(revision.nextVersion).toBe(2)
  })

  it('ne clôt rien lorsqu’aucun prix ne couvre la date d’effet', () => {
    const revision = planRevision([], 'negocie', '2026-03-01')
    expect(revision.supersededId).toBeNull()
    expect(revision.nextVersion).toBe(1)
  })

  it('poursuit la numérotation après plusieurs révisions', () => {
    const prices = [
      price({ id: 'v1', validFrom: '2026-01-01', validTo: '2026-01-31', version: 1 }),
      price({ id: 'v2', validFrom: '2026-02-01', validTo: null, version: 2 }),
    ]
    expect(planRevision(prices, 'negocie', '2026-03-01').nextVersion).toBe(3)
  })
})

describe('historique', () => {
  it('trie du plus récent au plus ancien', () => {
    const prices = [
      price({ id: 'v1', validFrom: '2026-01-01', validTo: '2026-01-31', version: 1 }),
      price({ id: 'v3', validFrom: '2026-03-01', validTo: null, version: 3 }),
      price({ id: 'v2', validFrom: '2026-02-01', validTo: '2026-02-28', version: 2 }),
    ]
    expect(priceHistory(prices, 'negocie').map((p) => p.id)).toEqual(['v3', 'v2', 'v1'])
  })
})
