/**
 * Couverture des avances : allocation FIFO et exposition.
 *
 * C'est le calcul le plus sensible du produit. Il répond à la question qui fait
 * accuser des gens à tort : « combien cet argent confié au pisteur reste-t-il
 * non justifié, et depuis quand ? ».
 *
 * Deux principes non négociables :
 *
 *  1. **L'ancienneté suit l'avance, pas la dernière remise.** Un pisteur qui
 *     reçoit une nouvelle avance ne voit pas son reliquat rajeunir. Sans cela,
 *     un retard ancien disparaîtrait à chaque nouveau décaissement.
 *
 *  2. **L'exposition n'est pas une perte.** Elle sépare l'argent disponible, le
 *     stock détenu, le stock en transit et la valeur reconnue. Les fondre en un
 *     solde unique transforme un pisteur en activité en pisteur suspect.
 *
 * Fonctions pures : l'horloge est injectée, jamais lue.
 */

export interface Advance {
  id: string
  fieldAgentId: string
  partnerCompanyId: string
  amount: number
  /** Date de décaissement, ISO `YYYY-MM-DD`. C'est elle qui porte l'ancienneté. */
  issuedAt: string
  justificationDeadline?: string | null
}

export type CoverageSourceType = 'reception' | 'repayment' | 'authorized_expense' | 'manual_adjustment'

export interface CoverageEvent {
  id: string
  sourceType: CoverageSourceType
  /** Montant reconnu, déjà valorisé selon la règle du contrat. */
  amount: number
  occurredAt: string
  /** Rattachement explicite à une avance, qui court-circuite le FIFO. */
  targetAdvanceId?: string | null
  /** Une affectation manuelle exige approbation et motif (arbitrage D4). */
  isManual?: boolean
  approvedBy?: string | null
  reason?: string | null
}

export interface Allocation {
  advanceId: string
  sourceId: string
  sourceType: CoverageSourceType
  amount: number
  isManual: boolean
}

export interface AdvanceCoverage {
  advance: Advance
  allocated: number
  /** Reste à justifier sur cette avance. */
  outstanding: number
  isFullyCovered: boolean
  /** Âge du reliquat, en jours, calculé depuis la date de l'avance. */
  ageDays: number
  isOverdue: boolean
}

export interface CoverageResult {
  allocations: Allocation[]
  perAdvance: AdvanceCoverage[]
  totalAdvanced: number
  totalCovered: number
  /** Montant non couvert, toutes avances confondues. */
  totalOutstanding: number
  /** Âge du plus ancien reliquat non couvert. 0 si tout est couvert. */
  oldestOutstandingAgeDays: number
  /** Couverture excédentaire : visible, jamais silencieusement absorbée. */
  unallocatedCoverage: number
}

const MS_PER_DAY = 86_400_000

/** Différence en jours entre deux dates ISO, sans dépendance au fuseau local. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  const start = Date.UTC(fy, fm - 1, fd)
  const end = Date.UTC(ty, tm - 1, td)
  return Math.round((end - start) / MS_PER_DAY)
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Alloue les événements de couverture aux avances.
 *
 * FIFO par défaut : les premières livraisons couvrent les premières avances.
 * Une affectation manuelle approuvée cible une avance précise et est traitée en
 * priorité, ce qui permet de corriger une erreur sans réécrire l'historique.
 */
export function allocateCoverage(
  advances: readonly Advance[],
  events: readonly CoverageEvent[],
  asOf: string,
): CoverageResult {
  // Ordre FIFO strict et déterministe : à date égale, l'identifiant tranche,
  // sinon deux exécutions du même calcul pourraient différer.
  const ordered = [...advances].sort((a, b) => {
    const byDate = a.issuedAt.localeCompare(b.issuedAt)
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id)
  })

  const remaining = new Map<string, number>(ordered.map((advance) => [advance.id, advance.amount]))
  const allocations: Allocation[] = []
  let unallocated = 0

  const sortedEvents = [...events].sort((a, b) => {
    const byDate = a.occurredAt.localeCompare(b.occurredAt)
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id)
  })

  // Les affectations manuelles approuvées passent d'abord : elles expriment une
  // décision humaine que le FIFO ne doit pas écraser.
  const manual = sortedEvents.filter((event) => event.isManual && event.targetAdvanceId)
  const automatic = sortedEvents.filter((event) => !(event.isManual && event.targetAdvanceId))

  for (const event of manual) {
    const target = event.targetAdvanceId!
    const left = remaining.get(target)
    if (left === undefined) {
      unallocated = round2(unallocated + event.amount)
      continue
    }
    const applied = Math.min(left, event.amount)
    if (applied > 0) {
      remaining.set(target, round2(left - applied))
      allocations.push({
        advanceId: target,
        sourceId: event.id,
        sourceType: event.sourceType,
        amount: round2(applied),
        isManual: true,
      })
    }
    if (event.amount > applied) unallocated = round2(unallocated + (event.amount - applied))
  }

  for (const event of automatic) {
    let left = event.amount

    for (const advance of ordered) {
      if (left <= 0) break
      const outstanding = remaining.get(advance.id) ?? 0
      if (outstanding <= 0) continue

      const applied = Math.min(outstanding, left)
      remaining.set(advance.id, round2(outstanding - applied))
      left = round2(left - applied)

      allocations.push({
        advanceId: advance.id,
        sourceId: event.id,
        sourceType: event.sourceType,
        amount: round2(applied),
        isManual: false,
      })
    }

    // Une livraison qui dépasse le total des avances n'est pas absorbée en
    // silence : elle reste visible comme excédent de couverture.
    if (left > 0) unallocated = round2(unallocated + left)
  }

  const perAdvance: AdvanceCoverage[] = ordered.map((advance) => {
    const outstanding = round2(remaining.get(advance.id) ?? 0)
    const deadline = advance.justificationDeadline ?? null

    return {
      advance,
      allocated: round2(advance.amount - outstanding),
      outstanding,
      isFullyCovered: outstanding <= 0,
      // L'ancienneté part TOUJOURS de la date de l'avance d'origine.
      ageDays: outstanding > 0 ? daysBetween(advance.issuedAt, asOf) : 0,
      isOverdue: outstanding > 0 && deadline !== null && asOf > deadline,
    }
  })

  const totalAdvanced = round2(ordered.reduce((total, advance) => total + advance.amount, 0))
  const totalOutstanding = round2(perAdvance.reduce((total, row) => total + row.outstanding, 0))

  return {
    allocations,
    perAdvance,
    totalAdvanced,
    totalCovered: round2(totalAdvanced - totalOutstanding),
    totalOutstanding,
    oldestOutstandingAgeDays: perAdvance
      .filter((row) => row.outstanding > 0)
      .reduce((max, row) => Math.max(max, row.ageDays), 0),
    unallocatedCoverage: unallocated,
  }
}

/**
 * Position financière d'un pisteur.
 *
 * Chaque état reste séparé (CMD §10). Il n'existe volontairement aucun champ
 * « solde » unique : c'est ce qui empêche de confondre de l'argent détourné avec
 * de la matière en cours de route.
 */
export interface AgentPosition {
  /** Avances décaissées, cumulées. */
  advanced: number
  /** Valeur reconnue des livraisons acceptées. */
  recognized: number
  /** Remboursements en numéraire. */
  repaid: number
  /** Dépenses autorisées imputées au pisteur. */
  authorizedExpenses: number
  /** Valeur des achats non encore livrés — matière détenue, pas de l'argent perdu. */
  stockAtAgentValue: number
  /** Valeur chargée mais pas encore réceptionnée. */
  inTransitValue: number
}

export interface ExposureBreakdown extends AgentPosition {
  /** Exposition financière : avances − reconnu − remboursements − dépenses autorisées. */
  exposure: number
  /**
   * Part de l'exposition adossée à de la matière identifiée (stock + transit).
   * Ce n'est pas un manquant : c'est du risque opérationnel.
   */
  backedByMatter: number
  /**
   * Exposition sans contrepartie identifiée. C'est le seul chiffre qui justifie
   * une enquête — et encore, il appelle une explication, pas une sanction.
   */
  unexplained: number
}

export function computeExposure(position: AgentPosition): ExposureBreakdown {
  const exposure = round2(
    position.advanced - position.recognized - position.repaid - position.authorizedExpenses,
  )
  const backedByMatter = round2(position.stockAtAgentValue + position.inTransitValue)

  return {
    ...position,
    exposure,
    backedByMatter,
    // Jamais négatif : un excédent de matière ne compense pas un écart de caisse.
    unexplained: round2(Math.max(0, exposure - backedByMatter)),
  }
}

/** Taux de couverture. Plafonné à 100 % pour le score, l'excédent restant visible. */
export function coverageRate(covered: number, advanced: number): number | null {
  if (advanced <= 0) return null
  return round2((covered / advanced) * 100)
}
