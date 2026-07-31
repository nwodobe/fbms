import { describe, expect, it } from 'vitest'
import {
  availableQuantity,
  canReserve,
  checkReassignment,
  computeStockPosition,
  reservedQuantity,
  type StockLot,
  type StockReservation,
} from './stock'

const lot = (over: Partial<StockLot> & Pick<StockLot, 'id'>): StockLot => ({
  code: 'LOT-0001',
  partnerCompanyId: 'olam',
  fieldAgentId: 'agent-1',
  quantityKg: 10000,
  status: 'disponible',
  holderType: 'warehouse',
  isOwnAccount: false,
  ...over,
})

const reservation = (
  over: Partial<StockReservation> & Pick<StockReservation, 'id' | 'stockLotId'>,
): StockReservation => ({
  partnerCompanyId: 'olam',
  quantityKg: 1000,
  status: 'active',
  ...over,
})

describe('quantité disponible', () => {
  it('déduit les réservations actives', () => {
    const l = lot({ id: 'l1' })
    const reservations = [
      reservation({ id: 'r1', stockLotId: 'l1', quantityKg: 3000 }),
      reservation({ id: 'r2', stockLotId: 'l1', quantityKg: 2000 }),
    ]
    expect(availableQuantity(l, reservations)).toBe(5000)
  })

  it('ignore les réservations libérées ou annulées', () => {
    const l = lot({ id: 'l1' })
    const reservations = [
      reservation({ id: 'r1', stockLotId: 'l1', quantityKg: 3000, status: 'liberee' }),
      reservation({ id: 'r2', stockLotId: 'l1', quantityKg: 2000, status: 'annulee' }),
    ]
    expect(availableQuantity(l, reservations)).toBe(10000)
  })

  it('ne compte pas les réservations d’un autre lot', () => {
    expect(reservedQuantity('l1', [reservation({ id: 'r1', stockLotId: 'l2', quantityKg: 5000 })])).toBe(0)
  })

  it('vaut zéro pour un lot déjà chargé ou en transit', () => {
    expect(availableQuantity(lot({ id: 'l1', status: 'charge' }), [])).toBe(0)
    expect(availableQuantity(lot({ id: 'l1', status: 'en_transit' }), [])).toBe(0)
    expect(availableQuantity(lot({ id: 'l1', status: 'en_litige' }), [])).toBe(0)
  })

  it('ne descend jamais sous zéro', () => {
    const reservations = [reservation({ id: 'r1', stockLotId: 'l1', quantityKg: 99999 })]
    expect(availableQuantity(lot({ id: 'l1' }), reservations)).toBe(0)
  })
})

describe('réservation', () => {
  const l = lot({ id: 'l1', quantityKg: 10000 })

  it('accepte une quantité disponible', () => {
    expect(canReserve(l, [], 8000, 'olam').allowed).toBe(true)
  })

  it('refuse une DEUXIÈME réservation au-delà du solde', () => {
    // Le cas qui produit la promesse en double : le lot semble « disponible »,
    // mais 8 tonnes sont déjà promises.
    const existing = [reservation({ id: 'r1', stockLotId: 'l1', quantityKg: 8000 })]
    const result = canReserve(l, existing, 5000, 'olam')

    expect(result.allowed).toBe(false)
    expect(result.available).toBe(2000)
    expect(result.reason).toMatch(/dépasse le stock disponible non réservé/)
  })

  it('accepte exactement le solde restant', () => {
    const existing = [reservation({ id: 'r1', stockLotId: 'l1', quantityKg: 8000 })]
    expect(canReserve(l, existing, 2000, 'olam').allowed).toBe(true)
  })

  it('refuse de promettre à une autre société sans réaffectation', () => {
    const result = canReserve(l, [], 1000, 'dorado')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/autre société.*réaffectation approuvée/)
  })

  it('accepte un lot sans société assignée', () => {
    expect(canReserve(lot({ id: 'l1', partnerCompanyId: null }), [], 1000, 'dorado').allowed).toBe(true)
  })

  it('refuse une quantité nulle ou négative', () => {
    expect(canReserve(l, [], 0, 'olam').allowed).toBe(false)
    expect(canReserve(l, [], -5, 'olam').allowed).toBe(false)
  })

  it('refuse un lot bloqué, en donnant son statut', () => {
    const result = canReserve(lot({ id: 'l1', status: 'bloque' }), [], 100, 'olam')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/bloque/)
  })
})

describe('position matière', () => {
  it('sépare chaque état sans total unique trompeur', () => {
    const lots = [
      lot({ id: 'l1', quantityKg: 9500, holderType: 'field_agent', status: 'disponible' }),
      lot({ id: 'l2', quantityKg: 24000, holderType: 'warehouse', status: 'disponible' }),
      lot({ id: 'l3', quantityKg: 32000, holderType: 'in_transit', status: 'en_transit' }),
      lot({ id: 'l4', quantityKg: 7800, holderType: 'warehouse', status: 'en_litige' }),
    ]
    const reservations = [reservation({ id: 'r1', stockLotId: 'l2', quantityKg: 8000 })]

    const position = computeStockPosition(lots, reservations)

    expect(position.chezPisteur).toBe(9500)
    expect(position.enMagasin).toBe(31800)
    expect(position.enTransit).toBe(32000)
    expect(position.enLitige).toBe(7800)
    expect(position.reserve).toBe(8000)
    // Disponible = seulement ce qui est réellement promettable.
    expect(position.disponible).toBe(9500 + 16000)
  })

  it('vaut zéro partout sans lot', () => {
    const position = computeStockPosition([], [])
    expect(Object.values(position).every((value) => value === 0)).toBe(true)
  })
})

describe('réaffectation inter-sociétés', () => {
  const valid = {
    fromPartnerCompanyId: 'olam',
    toPartnerCompanyId: 'dorado',
    quantityKg: 1000,
    reason: 'Erreur d’affectation constatée au contrôle qualité',
    requestedBy: 'u1',
    approvedBy: 'u2',
  }

  it('accepte une demande motivée et approuvée par un tiers', () => {
    expect(checkReassignment(valid).valid).toBe(true)
  })

  it('refuse sans motif explicite', () => {
    const result = checkReassignment({ ...valid, reason: 'erreur' })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/motif explicite/)
  })

  it('refuse sans approbateur', () => {
    expect(checkReassignment({ ...valid, approvedBy: null }).valid).toBe(false)
  })

  it('refuse l’auto-approbation', () => {
    const result = checkReassignment({ ...valid, approvedBy: 'u1' })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/ne peut pas approuver sa propre/)
  })

  it('refuse une réaffectation vers la même société', () => {
    expect(checkReassignment({ ...valid, toPartnerCompanyId: 'olam' }).valid).toBe(false)
  })
})
