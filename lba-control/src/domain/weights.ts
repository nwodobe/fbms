/**
 * Les quatre poids et les cinq écarts.
 *
 * C'est le cœur du contrôle logistique, et le point où le produit peut faire le
 * plus de dégâts s'il se trompe : un écart mal calculé, ou attribué trop vite,
 * accuse un pisteur d'un vol qui n'a pas eu lieu.
 *
 * Trois principes tenus ici :
 *
 *  1. **Quatre poids distincts.** Chargé, déchargé, accepté, payé. Aucun champ
 *     générique « livré » n'existe. Les confondre fausse la couverture des
 *     avances, le TCB et la marge en même temps.
 *
 *  2. **Deux formulations d'écart conservées.** La commande et le cahier des
 *     charges divergent (voir INC-01) ; les deux sont calculées sous des noms
 *     distincts, aucune n'est arbitrée à la place du métier.
 *
 *  3. **Aucune imputation automatique.** Un écart hors tolérance ouvre un
 *     incident et bloque la clôture. Il ne désigne jamais de responsable :
 *     l'humidité, le pont-bascule, la route et la saisie sont des causes au
 *     moins aussi fréquentes que la malhonnêteté.
 */

export type WeightSource = 'verified' | 'estimated_bags' | 'declared'

export interface TransferWeights {
  /** Poids net au départ. */
  netLoadedKg: number | null
  /** Poids net constaté au déchargement. */
  netUnloadedKg: number | null
  /** Poids reconnu après contrôle qualité. */
  acceptedKg: number | null
  /** Poids effectivement payé par la société. */
  paidKg: number | null
  tareDepartureKg?: number | null
  tareReceptionKg?: number | null
}

export interface WeightVariances {
  /** Chargé − déchargé : la perte physique en route. */
  ecartPhysiqueKg: number | null
  ecartPhysiquePct: number | null
  /** Déchargé − accepté : le refus qualité au site de réception (commande §14). */
  ecartAcceptationKg: number | null
  /** Accepté − payé : l'écart financier de reconnaissance (commande §14). */
  ecartPaiementKg: number | null
  /** Chargé − accepté : la perte totale jusqu'à reconnaissance (CDC §12.3). */
  ecartTotalAcceptationKg: number | null
  /** Chargé − payé : l'écart financier complet (CDC §12.3). */
  ecartFinancierTotalKg: number | null
  /** Tare arrivée − tare départ : premier signal d'une pesée douteuse. */
  tareVariationKg: number | null
}

function subtract(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null
  return Math.round((a - b) * 1000) / 1000
}

export function computeVariances(weights: TransferWeights): WeightVariances {
  const ecartPhysiqueKg = subtract(weights.netLoadedKg, weights.netUnloadedKg)

  return {
    ecartPhysiqueKg,
    ecartPhysiquePct:
      ecartPhysiqueKg !== null && weights.netLoadedKg !== null && weights.netLoadedKg > 0
        ? Math.round((ecartPhysiqueKg / weights.netLoadedKg) * 100 * 1_000_000) / 1_000_000
        : null,
    ecartAcceptationKg: subtract(weights.netUnloadedKg, weights.acceptedKg),
    ecartPaiementKg: subtract(weights.acceptedKg, weights.paidKg),
    ecartTotalAcceptationKg: subtract(weights.netLoadedKg, weights.acceptedKg),
    ecartFinancierTotalKg: subtract(weights.netLoadedKg, weights.paidKg),
    tareVariationKg: subtract(weights.tareReceptionKg, weights.tareDepartureKg),
  }
}

// ---------------------------------------------------------------------------
// Tolérances · résolution en cascade
// ---------------------------------------------------------------------------

export interface ToleranceSources {
  contractPct?: number | null
  partnerPct?: number | null
  tenantPct: number
}

export interface ResolvedTolerance {
  value: number
  /** D'où vient la valeur retenue : indispensable pour expliquer un refus. */
  source: 'contrat' | 'societe' | 'entreprise'
}

/**
 * Le seuil applicable vient du contrat, sinon de la société, sinon du tenant.
 * L'origine est renvoyée avec la valeur : « écart supérieur à la tolérance »
 * sans dire laquelle ni d'où elle vient est ininterprétable sur le terrain.
 */
export function resolveTolerance(sources: ToleranceSources): ResolvedTolerance {
  if (sources.contractPct !== null && sources.contractPct !== undefined) {
    return { value: sources.contractPct, source: 'contrat' }
  }
  if (sources.partnerPct !== null && sources.partnerPct !== undefined) {
    return { value: sources.partnerPct, source: 'societe' }
  }
  return { value: sources.tenantPct, source: 'entreprise' }
}

// ---------------------------------------------------------------------------
// Appréciation d'un écart
// ---------------------------------------------------------------------------

export type VarianceSeverity = 'conforme' | 'surveillance' | 'critique'

export interface VarianceAssessment {
  severity: VarianceSeverity
  exceedsTolerance: boolean
  /** Un écart hors tolérance ouvre un incident et bloque la clôture. */
  requiresIncident: boolean
  tolerance: ResolvedTolerance
  measuredPct: number | null
  message: string | null
  /** Causes plausibles à examiner, dans le désordre : aucune n'est privilégiée. */
  possibleCauses: string[]
}

/** Causes à envisager AVANT de conclure à une responsabilité humaine. */
const CAUSES = [
  'Perte naturelle d’humidité entre le départ et l’arrivée',
  'Écart d’étalonnage entre les deux ponts-bascules',
  'Tare du véhicule différente au départ et à l’arrivée',
  'Poids de départ estimé plutôt que pesé',
  'Perte ou dispersion pendant le transport',
  'Erreur de saisie',
]

export function assessPhysicalVariance(
  variances: WeightVariances,
  sources: ToleranceSources,
  weightSource: WeightSource = 'verified',
): VarianceAssessment {
  const tolerance = resolveTolerance(sources)
  const measuredPct = variances.ecartPhysiquePct

  if (measuredPct === null) {
    return {
      severity: 'conforme',
      exceedsTolerance: false,
      requiresIncident: false,
      tolerance,
      measuredPct: null,
      message: null,
      possibleCauses: [],
    }
  }

  const absolute = Math.abs(measuredPct)
  const exceeds = absolute > tolerance.value

  // Un écart calculé sur une estimation ne vaut pas un écart mesuré : le
  // signaler comme « critique » reviendrait à accuser sur la foi d'un chiffre
  // que personne n'a pesé.
  const isEstimated = weightSource !== 'verified'

  const severity: VarianceSeverity = !exceeds
    ? absolute > tolerance.value * 0.75
      ? 'surveillance'
      : 'conforme'
    : isEstimated
      ? 'surveillance'
      : 'critique'

  const message = exceeds
    ? `Écart de ${absolute.toFixed(2)} % supérieur à la tolérance de ${tolerance.value} % ` +
      `(source : ${tolerance.source}).` +
      (isEstimated
        ? ' Le poids de départ est une estimation : l’écart doit être confirmé avant toute conclusion.'
        : '')
    : null

  return {
    severity,
    exceedsTolerance: exceeds,
    // Un écart hors tolérance sur un poids estimé mérite une vérification, pas
    // encore un incident formel.
    requiresIncident: exceeds && !isEstimated,
    tolerance,
    measuredPct,
    message,
    possibleCauses: exceeds ? [...CAUSES] : [],
  }
}

/**
 * Tare anormale : une variation de tare supérieure au seuil est le premier
 * indice d'une pesée peu fiable, indépendamment de l'écart de marchandise.
 */
export function assessTareVariation(
  variances: WeightVariances,
  thresholdKg: number,
): { isAbnormal: boolean; message: string | null } {
  if (variances.tareVariationKg === null) return { isAbnormal: false, message: null }

  const absolute = Math.abs(variances.tareVariationKg)
  if (absolute <= thresholdKg) return { isAbnormal: false, message: null }

  return {
    isAbnormal: true,
    message:
      `La tare varie de ${absolute} kg entre le départ et l’arrivée (seuil : ${thresholdKg} kg). ` +
      'Vérifiez les deux pesées avant d’interpréter l’écart de marchandise.',
  }
}

// ---------------------------------------------------------------------------
// Cohérence des quatre poids
// ---------------------------------------------------------------------------

export interface WeightConsistency {
  valid: boolean
  errors: string[]
}

/**
 * La chaîne des quatre poids est décroissante : on ne peut pas accepter plus
 * qu'on n'a déchargé, ni payer plus qu'on n'a accepté. Ces contrôles existent
 * aussi en base ; ils sont ici pour donner un message avant l'envoi.
 */
export function checkWeightConsistency(weights: TransferWeights): WeightConsistency {
  const errors: string[] = []
  const { netLoadedKg, netUnloadedKg, acceptedKg, paidKg } = weights

  if (netLoadedKg !== null && netLoadedKg <= 0) {
    errors.push('Le poids chargé doit être strictement positif.')
  }

  if (netUnloadedKg !== null && netLoadedKg !== null && netUnloadedKg > netLoadedKg) {
    errors.push(
      'Le poids déchargé dépasse le poids chargé. Vérifiez les deux pesées : ' +
        'un camion ne s’alourdit pas en route.',
    )
  }

  if (acceptedKg !== null && netUnloadedKg !== null && acceptedKg > netUnloadedKg) {
    errors.push('Le poids accepté ne peut pas dépasser le poids déchargé.')
  }

  if (paidKg !== null && acceptedKg !== null && paidKg > acceptedKg) {
    errors.push('Le poids payé ne peut pas dépasser le poids accepté.')
  }

  return { valid: errors.length === 0, errors }
}

/** Une réception incomplète ne peut pas être clôturée : l'écart deviendrait inexplicable. */
export function canCloseTransfer(weights: TransferWeights, hasOpenIncident: boolean): {
  canClose: boolean
  reasons: string[]
} {
  const reasons: string[] = []

  if (weights.netUnloadedKg === null) reasons.push('Le poids déchargé n’est pas renseigné.')
  if (weights.acceptedKg === null) reasons.push('Le poids accepté n’est pas renseigné.')
  if (hasOpenIncident) {
    reasons.push('Un incident non résolu est ouvert sur ce transfert.')
  }

  return { canClose: reasons.length === 0, reasons }
}

/** Valorisation d'un écart non toléré, au prix contractuel de valorisation. */
export function valueVariance(
  varianceKg: number | null,
  toleratedKg: number,
  valuationPricePerKg: number,
): number | null {
  if (varianceKg === null) return null
  const beyondTolerance = Math.max(0, Math.abs(varianceKg) - Math.abs(toleratedKg))
  return Math.round(beyondTolerance * valuationPricePerKg * 100) / 100
}
