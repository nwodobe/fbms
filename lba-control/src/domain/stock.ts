/**
 * Stock : disponibilité, réservation et réaffectation.
 *
 * La règle qui structure tout : **une quantité réservée pour une société n'est
 * plus disponible pour une autre**. Sans elle, le LBA promet deux fois le même
 * stock et découvre le problème le jour du chargement, devant le camion.
 */

export type StockStatus =
  | 'disponible'
  | 'reserve'
  | 'charge'
  | 'en_transit'
  | 'receptionne'
  | 'rejete'
  | 'bloque'
  | 'en_litige'
  | 'cloture'

/** Localisation, distincte du statut : un lot chez le pisteur est aussi disponible. */
export type HolderType = 'field_agent' | 'warehouse' | 'in_transit' | 'partner_site'

export interface StockLot {
  id: string
  code: string
  partnerCompanyId: string | null
  fieldAgentId: string | null
  quantityKg: number
  status: StockStatus
  holderType: HolderType
  isOwnAccount: boolean
}

export interface StockReservation {
  id: string
  stockLotId: string
  partnerCompanyId: string
  quantityKg: number
  status: 'active' | 'liberee' | 'consommee' | 'annulee'
}

/** Statuts qui rendent un lot indisponible, quelle que soit sa quantité. */
const UNAVAILABLE_STATUSES: ReadonlySet<StockStatus> = new Set([
  'charge',
  'en_transit',
  'receptionne',
  'rejete',
  'bloque',
  'en_litige',
  'cloture',
])

export function reservedQuantity(
  lotId: string,
  reservations: readonly StockReservation[],
): number {
  return (
    Math.round(
      reservations
        .filter((r) => r.stockLotId === lotId && r.status === 'active')
        .reduce((total, r) => total + r.quantityKg, 0) * 1000,
    ) / 1000
  )
}

/**
 * Quantité réellement promettable.
 *
 * C'est la quantité du lot **moins ce qui est déjà réservé** — jamais la
 * quantité brute. Afficher la quantité brute comme « disponible » est
 * exactement ce qui produit les doubles réservations.
 */
export function availableQuantity(
  lot: StockLot,
  reservations: readonly StockReservation[],
): number {
  if (UNAVAILABLE_STATUSES.has(lot.status)) return 0
  return Math.max(0, Math.round((lot.quantityKg - reservedQuantity(lot.id, reservations)) * 1000) / 1000)
}

export interface ReservationCheck {
  allowed: boolean
  available: number
  reason: string | null
}

export function canReserve(
  lot: StockLot,
  reservations: readonly StockReservation[],
  quantityKg: number,
  partnerCompanyId: string,
): ReservationCheck {
  const available = availableQuantity(lot, reservations)

  if (quantityKg <= 0) {
    return { allowed: false, available, reason: 'La quantité à réserver doit être strictement positive.' }
  }

  if (UNAVAILABLE_STATUSES.has(lot.status)) {
    return {
      allowed: false,
      available,
      reason: `Ce lot est au statut « ${lot.status} » : il n’est pas réservable.`,
    }
  }

  // Un lot affecté à OLAM ne se promet pas à DORADO sans réaffectation.
  if (lot.partnerCompanyId !== null && lot.partnerCompanyId !== partnerCompanyId) {
    return {
      allowed: false,
      available,
      reason:
        'Cette opération utilise un stock affecté à une autre société. Une réaffectation approuvée est requise.',
    }
  }

  if (quantityKg > available) {
    return {
      allowed: false,
      available,
      reason: `La quantité demandée dépasse le stock disponible non réservé (${available} kg).`,
    }
  }

  return { allowed: true, available, reason: null }
}

export interface StockPosition {
  chezPisteur: number
  enMagasin: number
  reserve: number
  charge: number
  enTransit: number
  receptionne: number
  rejete: number
  enLitige: number
  disponible: number
}

/**
 * Position matière, état par état.
 *
 * Comme pour l'argent, il n'existe volontairement aucun total unique : « 40
 * tonnes de stock » ne dit pas si la marchandise est chez un pisteur, promise à
 * une société ou déjà partie.
 */
export function computeStockPosition(
  lots: readonly StockLot[],
  reservations: readonly StockReservation[],
): StockPosition {
  const position: StockPosition = {
    chezPisteur: 0,
    enMagasin: 0,
    reserve: 0,
    charge: 0,
    enTransit: 0,
    receptionne: 0,
    rejete: 0,
    enLitige: 0,
    disponible: 0,
  }

  for (const lot of lots) {
    const quantity = lot.quantityKg

    if (lot.holderType === 'field_agent') position.chezPisteur += quantity
    if (lot.holderType === 'warehouse') position.enMagasin += quantity

    switch (lot.status) {
      case 'charge':
        position.charge += quantity
        break
      case 'en_transit':
        position.enTransit += quantity
        break
      case 'receptionne':
        position.receptionne += quantity
        break
      case 'rejete':
        position.rejete += quantity
        break
      case 'en_litige':
        position.enLitige += quantity
        break
      default:
        break
    }

    position.reserve += reservedQuantity(lot.id, reservations)
    position.disponible += availableQuantity(lot, reservations)
  }

  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    chezPisteur: round(position.chezPisteur),
    enMagasin: round(position.enMagasin),
    reserve: round(position.reserve),
    charge: round(position.charge),
    enTransit: round(position.enTransit),
    receptionne: round(position.receptionne),
    rejete: round(position.rejete),
    enLitige: round(position.enLitige),
    disponible: round(position.disponible),
  }
}

// ---------------------------------------------------------------------------
// Réaffectation inter-sociétés
// ---------------------------------------------------------------------------

export interface ReassignmentRequest {
  fromPartnerCompanyId: string
  toPartnerCompanyId: string
  quantityKg: number
  reason: string
  requestedBy: string | null
  approvedBy: string | null
}

export interface ReassignmentCheck {
  valid: boolean
  errors: string[]
}

/**
 * Une réaffectation change la société propriétaire d'une matière déjà financée
 * par quelqu'un. Elle exige donc motif ET approbation par un tiers — sans quoi
 * elle devient le moyen le plus simple de mélanger les financements.
 */
export function checkReassignment(request: ReassignmentRequest): ReassignmentCheck {
  const errors: string[] = []

  if (request.fromPartnerCompanyId === request.toPartnerCompanyId) {
    errors.push('La société de destination doit être différente de la société d’origine.')
  }

  if (request.quantityKg <= 0) {
    errors.push('La quantité à réaffecter doit être strictement positive.')
  }

  if (request.reason.trim().length < 10) {
    errors.push('Un motif explicite est obligatoire (10 caractères minimum).')
  }

  if (!request.approvedBy) {
    errors.push('Une réaffectation exige l’approbation d’un responsable.')
  }

  if (request.approvedBy && request.requestedBy && request.approvedBy === request.requestedBy) {
    errors.push('Le demandeur ne peut pas approuver sa propre réaffectation.')
  }

  return { valid: errors.length === 0, errors }
}
