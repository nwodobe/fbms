/**
 * Détection de doublons probables.
 *
 * Un doublon détecté est une **hypothèse**, jamais une conclusion. Le terrain
 * produit légitimement des opérations très ressemblantes : un même producteur
 * peut vendre deux fois le même jour, et deux pisteurs peuvent acheter le même
 * poids au même prix affiché.
 *
 * Deux règles héritées du cahier des charges :
 *  · la géolocalisation **pondère** le score, elle ne le détermine jamais seule
 *    (CMD §11) — deux achats au même village ont forcément le même GPS ;
 *  · le résultat ne bloque rien : il signale, un humain tranche.
 */

export interface PurchaseSignature {
  id: string
  fieldAgentId: string
  supplierId?: string | null
  supplierName?: string | null
  localityId?: string | null
  /** Horodatage réel de l'achat, ISO complet. */
  purchasedAt: string
  netWeightKg: number
  amount: number
  paymentReference?: string | null
  gpsLat?: number | null
  gpsLng?: number | null
  deviceId?: string | null
}

export interface DuplicateMatch {
  candidateId: string
  score: number
  matchedCriteria: string[]
  /** Au-delà du seuil : à faire vérifier par un humain. */
  needsReview: boolean
}

/**
 * Pondérations.
 *
 * Le poids et le montant dominent parce qu'ils sont ce qu'une double saisie
 * reproduit à l'identique. Le GPS pèse peu — délibérément.
 */
const WEIGHTS = {
  sameAgent: 10,
  sameSupplier: 20,
  sameDay: 15,
  closeInTime: 10,
  sameWeight: 25,
  sameAmount: 20,
  samePaymentReference: 25,
  sameLocality: 5,
  closeGps: 5,
  sameDevice: 5,
} as const

/** Au-delà de ce score, l'opération est signalée pour vérification. */
export const REVIEW_THRESHOLD = 60

const MINUTE = 60_000

function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10)
}

function minutesApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / MINUTE
}

/** Distance approximative en mètres. Suffisant pour « même endroit ou non ». */
export function gpsDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6_371_000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)))
}

function normalizeName(value: string | null | undefined): string | null {
  if (!value) return null
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

/** Compare deux achats et renvoie un score de similarité sur 100. */
export function compareForDuplicate(
  candidate: PurchaseSignature,
  existing: PurchaseSignature,
): DuplicateMatch {
  const criteria: string[] = []
  let score = 0

  if (candidate.fieldAgentId === existing.fieldAgentId) {
    score += WEIGHTS.sameAgent
    criteria.push('pisteur')
  }

  const sameSupplierId =
    candidate.supplierId != null && candidate.supplierId === existing.supplierId
  const sameSupplierName =
    normalizeName(candidate.supplierName) !== null &&
    normalizeName(candidate.supplierName) === normalizeName(existing.supplierName)

  if (sameSupplierId || sameSupplierName) {
    score += WEIGHTS.sameSupplier
    criteria.push('vendeur')
  }

  if (sameDay(candidate.purchasedAt, existing.purchasedAt)) {
    score += WEIGHTS.sameDay
    criteria.push('date')

    // Deux saisies à quelques minutes d'intervalle sont bien plus suspectes que
    // deux achats séparés de plusieurs heures.
    if (minutesApart(candidate.purchasedAt, existing.purchasedAt) <= 30) {
      score += WEIGHTS.closeInTime
      criteria.push('heure_proche')
    }
  }

  if (Math.abs(candidate.netWeightKg - existing.netWeightKg) < 0.001) {
    score += WEIGHTS.sameWeight
    criteria.push('poids')
  }

  if (Math.abs(candidate.amount - existing.amount) < 0.01) {
    score += WEIGHTS.sameAmount
    criteria.push('montant')
  }

  const reference = candidate.paymentReference?.trim()
  if (reference && reference === existing.paymentReference?.trim()) {
    // Une référence de paiement identique est le signal le plus fort : un même
    // versement ne peut pas financer deux achats distincts.
    score += WEIGHTS.samePaymentReference
    criteria.push('reference_paiement')
  }

  if (candidate.localityId != null && candidate.localityId === existing.localityId) {
    score += WEIGHTS.sameLocality
    criteria.push('localite')
  }

  if (
    candidate.gpsLat != null &&
    candidate.gpsLng != null &&
    existing.gpsLat != null &&
    existing.gpsLng != null &&
    gpsDistanceMeters(candidate.gpsLat, candidate.gpsLng, existing.gpsLat, existing.gpsLng) <= 100
  ) {
    score += WEIGHTS.closeGps
    criteria.push('geolocalisation')
  }

  if (candidate.deviceId != null && candidate.deviceId === existing.deviceId) {
    score += WEIGHTS.sameDevice
    criteria.push('appareil')
  }

  const capped = Math.min(100, score)

  return {
    candidateId: existing.id,
    score: capped,
    matchedCriteria: criteria,
    needsReview: capped >= REVIEW_THRESHOLD,
  }
}

/**
 * Cherche les doublons probables d'un achat parmi les achats existants.
 * Retourne les correspondances triées, du plus probable au moins probable.
 */
export function findDuplicates(
  candidate: PurchaseSignature,
  existing: readonly PurchaseSignature[],
  threshold = REVIEW_THRESHOLD,
): DuplicateMatch[] {
  return existing
    .filter((row) => row.id !== candidate.id)
    .map((row) => compareForDuplicate(candidate, row))
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score)
}

/**
 * Vrai si la géolocalisation est le seul élément qui rapproche deux opérations.
 * Dans ce cas, le signalement n'a aucune valeur : au même village, tous les
 * achats partagent les mêmes coordonnées.
 */
export function isGpsOnlyMatch(match: DuplicateMatch): boolean {
  const meaningful = match.matchedCriteria.filter(
    (criterion) => criterion !== 'geolocalisation' && criterion !== 'localite',
  )
  return meaningful.length === 0 && match.matchedCriteria.length > 0
}
