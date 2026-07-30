/**
 * Résolution des prix négociés.
 *
 * Règle structurante : **un prix actif n'est jamais écrasé**. Toute révision
 * crée une version avec une date d'effet. Ce module répond donc à une seule
 * question, mais correctement : « quel prix s'appliquait à cette date ? ».
 *
 * Fonctions pures, horloge injectée. Un prix qui dépendrait de `new Date()`
 * donnerait un résultat différent selon le moment où on relit l'opération —
 * c'est exactement ce qu'un audit ne pardonne pas.
 */

export type PriceType =
  | 'negocie'
  | 'plafond_achat'
  | 'producteur'
  | 'net_reconnu'
  | 'valorisation_ecart'

export interface NegotiatedPrice {
  id: string
  contractId: string
  priceType: PriceType
  price: number
  /** Date d'effet incluse, format ISO `YYYY-MM-DD`. */
  validFrom: string
  /** Date de fin incluse, ou `null` si le prix court toujours. */
  validTo: string | null
  version: number
  isProvisional: boolean
  justification?: string | null
}

/** Compare deux dates ISO `YYYY-MM-DD` sans passer par un fuseau horaire. */
function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function isWithinValidity(price: NegotiatedPrice, date: string): boolean {
  if (compareIsoDates(date, price.validFrom) < 0) return false
  if (price.validTo !== null && compareIsoDates(date, price.validTo) > 0) return false
  return true
}

export function isExpired(price: NegotiatedPrice, asOf: string): boolean {
  return price.validTo !== null && compareIsoDates(asOf, price.validTo) > 0
}

/**
 * Prix applicable à une date donnée pour un type.
 *
 * Retourne `null` si aucun prix ne couvre la date — et c'est une information
 * utile, pas une erreur à masquer : cela signifie qu'une opération est en train
 * d'être valorisée hors de toute période contractuelle.
 *
 * En cas de chevauchement (qui ne devrait pas exister, la base l'interdit par
 * contrainte EXCLUDE), la version la plus récente l'emporte, de façon
 * déterministe plutôt qu'au hasard de l'ordre de lecture.
 */
export function resolveApplicablePrice(
  prices: readonly NegotiatedPrice[],
  priceType: PriceType,
  date: string,
): NegotiatedPrice | null {
  const candidates = prices
    .filter((price) => price.priceType === priceType && isWithinValidity(price, date))
    .sort((a, b) => {
      const byStart = compareIsoDates(b.validFrom, a.validFrom)
      return byStart !== 0 ? byStart : b.version - a.version
    })

  return candidates[0] ?? null
}

export interface PriceOverlap {
  priceType: PriceType
  first: NegotiatedPrice
  second: NegotiatedPrice
}

/**
 * Détecte les chevauchements avant envoi au serveur.
 *
 * La base refuse déjà ces cas ; ce contrôle sert à afficher un message
 * compréhensible plutôt qu'une violation de contrainte brute.
 */
export function detectOverlaps(prices: readonly NegotiatedPrice[]): PriceOverlap[] {
  const overlaps: PriceOverlap[] = []
  const byType = new Map<PriceType, NegotiatedPrice[]>()

  for (const price of prices) {
    const list = byType.get(price.priceType) ?? []
    list.push(price)
    byType.set(price.priceType, list)
  }

  for (const [priceType, list] of byType) {
    const sorted = [...list].sort((a, b) => compareIsoDates(a.validFrom, b.validFrom))
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]!
      const next = sorted[i + 1]!
      const currentEnd = current.validTo
      if (currentEnd === null || compareIsoDates(currentEnd, next.validFrom) >= 0) {
        overlaps.push({ priceType, first: current, second: next })
      }
    }
  }

  return overlaps
}

export interface PriceCheck {
  applicable: NegotiatedPrice | null
  /** Aucun prix ne couvre la date de l'opération. */
  outOfPeriod: boolean
  /** Le prix saisi dépasse le plafond d'achat du contrat. */
  aboveCeiling: boolean
  ceiling: number | null
  message: string | null
}

/**
 * Contrôle du prix d'un achat à la date réelle de l'opération.
 *
 * Deux avertissements distincts, jamais confondus : « aucun prix applicable à
 * cette date » (le contrat ne couvre pas l'opération) et « prix supérieur au
 * plafond » (le pisteur a payé trop cher). Les fusionner empêcherait de savoir
 * lequel des deux problèmes traiter.
 */
export function checkPurchasePrice(
  prices: readonly NegotiatedPrice[],
  unitPrice: number,
  date: string,
): PriceCheck {
  const applicable = resolveApplicablePrice(prices, 'negocie', date)
  const ceilingPrice = resolveApplicablePrice(prices, 'plafond_achat', date)
  const ceiling = ceilingPrice?.price ?? null

  const outOfPeriod = applicable === null && ceilingPrice === null
  const aboveCeiling = ceiling !== null && unitPrice > ceiling

  let message: string | null = null
  if (outOfPeriod) {
    message =
      'Aucun prix négocié ne couvre cette date. Vérifiez la période du contrat avant de valider.'
  } else if (aboveCeiling) {
    message = `Le prix d'achat dépasse le plafond du contrat (${ceiling} FCFA/kg). Soumettez une dérogation.`
  }

  return { applicable, outOfPeriod, aboveCeiling, ceiling, message }
}

export interface PriceRevision {
  /** Version courante, dont la validité doit être close la veille de l'effet. */
  supersededId: string | null
  supersededValidTo: string | null
  nextVersion: number
}

/** Veille d'une date ISO, sans dépendance au fuseau horaire local. */
export function previousDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const utc = new Date(Date.UTC(year, month - 1, day))
  utc.setUTCDate(utc.getUTCDate() - 1)
  return utc.toISOString().slice(0, 10)
}

/**
 * Prépare une révision de prix.
 *
 * La version en cours est **close**, jamais modifiée dans sa valeur : les
 * opérations déjà valorisées avec elle doivent continuer à l'être.
 */
export function planRevision(
  prices: readonly NegotiatedPrice[],
  priceType: PriceType,
  effectiveFrom: string,
): PriceRevision {
  const sameType = prices.filter((price) => price.priceType === priceType)
  const current = resolveApplicablePrice(prices, priceType, effectiveFrom)
  const maxVersion = sameType.reduce((max, price) => Math.max(max, price.version), 0)

  if (current === null) {
    return { supersededId: null, supersededValidTo: null, nextVersion: maxVersion + 1 }
  }

  return {
    supersededId: current.id,
    supersededValidTo: previousDay(effectiveFrom),
    nextVersion: maxVersion + 1,
  }
}

/** Historique trié du plus récent au plus ancien, pour affichage. */
export function priceHistory(
  prices: readonly NegotiatedPrice[],
  priceType: PriceType,
): NegotiatedPrice[] {
  return prices
    .filter((price) => price.priceType === priceType)
    .sort((a, b) => {
      const byStart = compareIsoDates(b.validFrom, a.validFrom)
      return byStart !== 0 ? byStart : b.version - a.version
    })
}

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  negocie: 'Prix négocié société',
  plafond_achat: "Prix d'achat maximal",
  producteur: 'Prix producteur',
  net_reconnu: 'Prix net reconnu',
  valorisation_ecart: 'Prix de valorisation des écarts',
}
