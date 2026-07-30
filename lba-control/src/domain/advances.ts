/**
 * Contrôles préalables au décaissement d'une avance.
 *
 * Règle absolue du cahier des charges : le système **avertit et bloque**, mais
 * la décision reste humaine. Un dépassement produit un blocage surmontable par
 * dérogation motivée et approuvée — jamais une suspension automatique du
 * pisteur, jamais une sanction financière décidée par le logiciel (CMD §9, §17).
 */

export type AdvanceBlockReason =
  | 'plafond_global_depasse'
  | 'plafond_societe_depasse'
  | 'avance_ancienne_non_couverte'
  | 'pisteur_suspendu'
  | 'societe_non_autorisee'
  | 'financement_insuffisant'

export type AdvanceCheckSeverity = 'info' | 'avertissement' | 'blocage'

export interface AdvanceCheckItem {
  reason: AdvanceBlockReason
  severity: AdvanceCheckSeverity
  message: string
  /** Valeur mesurée et seuil, pour que l'utilisateur comprenne sans appeler personne. */
  measured?: number
  threshold?: number
}

export interface AdvanceCheckInput {
  amount: number
  /** Exposition actuelle du pisteur, toutes sociétés confondues. */
  currentExposure: number
  /** Plafond global du pisteur. 0 ou null = pas de plafond défini. */
  globalCeiling: number | null
  /** Exposition sur la société concernée. */
  partnerExposure: number
  /** Plafond spécifique à cette société, s'il existe. */
  partnerCeiling: number | null
  /** Âge en jours du plus ancien reliquat non couvert. */
  oldestOutstandingAgeDays: number
  /** Seuil au-delà duquel une avance ancienne bloque une nouvelle (arbitrage D7). */
  overdueBlockDays: number
  agentStatus: 'actif' | 'suspendu' | 'cloture'
  isPartnerAuthorized: boolean
  /** Solde disponible du financement source, si un financement est rattaché. */
  fundingAvailable?: number | null
}

export interface AdvanceCheckResult {
  items: AdvanceCheckItem[]
  /** Le décaissement est-il possible sans dérogation ? */
  canProceed: boolean
  /** Une dérogation motivée et approuvée peut-elle lever les blocages ? */
  requiresOverride: boolean
  /** Blocages qu'aucune dérogation ne lève. */
  hardBlocks: AdvanceCheckItem[]
}

const formatXof = (value: number): string =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(value))} FCFA`

/**
 * Un pisteur suspendu ou clôturé, ou une société non autorisée pour lui, ne se
 * contournent pas par dérogation : ce sont des décisions déjà prises, pas des
 * seuils à arbitrer.
 */
const HARD_BLOCK_REASONS: ReadonlySet<AdvanceBlockReason> = new Set([
  'pisteur_suspendu',
  'societe_non_autorisee',
])

export function checkAdvanceCapacity(input: AdvanceCheckInput): AdvanceCheckResult {
  const items: AdvanceCheckItem[] = []

  if (input.agentStatus !== 'actif') {
    items.push({
      reason: 'pisteur_suspendu',
      severity: 'blocage',
      message:
        input.agentStatus === 'suspendu'
          ? 'Ce pisteur est suspendu. Réactivez-le avant de lui confier des fonds.'
          : 'Ce pisteur est clôturé. Aucune nouvelle avance ne peut lui être remise.',
    })
  }

  if (!input.isPartnerAuthorized) {
    items.push({
      reason: 'societe_non_autorisee',
      severity: 'blocage',
      message:
        "Ce pisteur n'est pas autorisé pour cette société partenaire. Autorisez-le sur sa fiche avant de continuer.",
    })
  }

  const projectedGlobal = input.currentExposure + input.amount
  if (input.globalCeiling !== null && input.globalCeiling > 0 && projectedGlobal > input.globalCeiling) {
    items.push({
      reason: 'plafond_global_depasse',
      severity: 'blocage',
      message:
        `Cette avance porterait l'exposition du pisteur à ${formatXof(projectedGlobal)}, ` +
        `au-dessus de son plafond de ${formatXof(input.globalCeiling)}. ` +
        'Une dérogation motivée et approuvée est requise.',
      measured: projectedGlobal,
      threshold: input.globalCeiling,
    })
  }

  const projectedPartner = input.partnerExposure + input.amount
  if (input.partnerCeiling !== null && input.partnerCeiling > 0 && projectedPartner > input.partnerCeiling) {
    items.push({
      reason: 'plafond_societe_depasse',
      severity: 'blocage',
      message:
        `L'exposition sur cette société atteindrait ${formatXof(projectedPartner)}, ` +
        `au-dessus du plafond de ${formatXof(input.partnerCeiling)} fixé pour elle. ` +
        'Une dérogation motivée et approuvée est requise.',
      measured: projectedPartner,
      threshold: input.partnerCeiling,
    })
  }

  if (input.oldestOutstandingAgeDays > input.overdueBlockDays) {
    items.push({
      reason: 'avance_ancienne_non_couverte',
      severity: 'blocage',
      message:
        `Ce pisteur détient une avance non couverte depuis ${input.oldestOutstandingAgeDays} jours ` +
        `(seuil : ${input.overdueBlockDays}). Justifiez l'existant ou motivez une dérogation.`,
      measured: input.oldestOutstandingAgeDays,
      threshold: input.overdueBlockDays,
    })
  } else if (input.oldestOutstandingAgeDays > 0) {
    items.push({
      reason: 'avance_ancienne_non_couverte',
      severity: 'info',
      message: `Reliquat non couvert le plus ancien : ${input.oldestOutstandingAgeDays} jours.`,
      measured: input.oldestOutstandingAgeDays,
      threshold: input.overdueBlockDays,
    })
  }

  if (
    input.fundingAvailable !== null &&
    input.fundingAvailable !== undefined &&
    input.amount > input.fundingAvailable
  ) {
    items.push({
      reason: 'financement_insuffisant',
      severity: 'blocage',
      message:
        `Le financement source ne dispose que de ${formatXof(input.fundingAvailable)}. ` +
        'Choisissez un autre financement ou réduisez le montant.',
      measured: input.amount,
      threshold: input.fundingAvailable,
    })
  }

  const blocks = items.filter((item) => item.severity === 'blocage')
  const hardBlocks = blocks.filter((item) => HARD_BLOCK_REASONS.has(item.reason))

  return {
    items,
    canProceed: blocks.length === 0,
    // Une dérogation ne lève que les seuils, jamais une décision de gestion.
    requiresOverride: blocks.length > 0 && hardBlocks.length === 0,
    hardBlocks,
  }
}

/**
 * Une dérogation n'existe que si elle est motivée ET approuvée par quelqu'un
 * d'autre. Sans les deux, ce n'est pas une dérogation, c'est un contournement.
 */
export function isOverrideValid(reason: string | null | undefined, approvedBy: string | null | undefined,
  requestedBy: string | null | undefined): { valid: boolean; message: string | null } {
  if (!approvedBy) {
    return { valid: false, message: "Une dérogation exige l'approbation d'un responsable." }
  }
  if ((reason ?? '').trim().length < 10) {
    return { valid: false, message: 'Le motif de la dérogation doit être explicite (10 caractères minimum).' }
  }
  if (requestedBy && approvedBy === requestedBy) {
    return {
      valid: false,
      message: 'Le demandeur ne peut pas approuver sa propre dérogation.',
    }
  }
  return { valid: true, message: null }
}

/** Volume théorique financé : montant ÷ prix de référence. Indicatif (CMD §7). */
export function theoreticalVolumeKg(amount: number, referencePrice: number | null): number | null {
  if (referencePrice === null || referencePrice <= 0) return null
  return Math.round((amount / referencePrice) * 1000) / 1000
}
