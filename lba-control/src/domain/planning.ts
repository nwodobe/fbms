/**
 * Planning de livraison : contrôles avant confirmation.
 *
 * Confirmer un planning, c'est promettre un volume à une société. La promesse
 * engage le LBA ; elle doit donc être vérifiable avant d'être faite, pas le
 * matin du chargement.
 */

export type PlanStatus =
  | 'brouillon'
  | 'planifie'
  | 'confirme'
  | 'en_preparation'
  | 'chargement'
  | 'en_transit'
  | 'arrive'
  | 'decharge'
  | 'receptionne'
  | 'cloture'
  | 'reporte'
  | 'annule'

export interface PlanConfirmationInput {
  plannedVolumeKg: number
  /** Stock disponible non réservé, pour la société du planning. */
  availableStockKg: number
  /** Capacité du véhicule prévu, si un véhicule est affecté. */
  vehicleCapacityKg: number | null
  hasVehicle: boolean
  hasDestinationSite: boolean
  /** Documents obligatoires réunis (bon de livraison, ticket de pesée…). */
  hasRequiredDocuments: boolean
}

export type PlanIssueSeverity = 'avertissement' | 'blocage'

export interface PlanIssue {
  code:
    | 'stock_insuffisant'
    | 'vehicule_absent'
    | 'capacite_depassee'
    | 'site_destination_absent'
    | 'documents_manquants'
  severity: PlanIssueSeverity
  message: string
}

export interface PlanConfirmationResult {
  issues: PlanIssue[]
  canConfirm: boolean
}

const formatKg = (value: number): string =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)} kg`

export function checkPlanConfirmation(input: PlanConfirmationInput): PlanConfirmationResult {
  const issues: PlanIssue[] = []

  if (input.plannedVolumeKg > input.availableStockKg) {
    issues.push({
      code: 'stock_insuffisant',
      severity: 'blocage',
      message:
        `La quantité demandée dépasse le stock disponible non réservé ` +
        `(${formatKg(input.availableStockKg)} pour ${formatKg(input.plannedVolumeKg)} promis).`,
    })
  }

  if (!input.hasVehicle) {
    // Avertissement, pas blocage : un planning peut légitimement être confirmé
    // avant que le transporteur ne soit désigné.
    issues.push({
      code: 'vehicule_absent',
      severity: 'avertissement',
      message: 'Aucun véhicule n’est affecté à cette livraison.',
    })
  } else if (input.vehicleCapacityKg !== null && input.plannedVolumeKg > input.vehicleCapacityKg) {
    issues.push({
      code: 'capacite_depassee',
      severity: 'blocage',
      message:
        `Le volume prévu dépasse la capacité du véhicule ` +
        `(${formatKg(input.vehicleCapacityKg)}). Prévoyez plusieurs rotations.`,
    })
  }

  if (!input.hasDestinationSite) {
    issues.push({
      code: 'site_destination_absent',
      severity: 'blocage',
      message: 'Le site de réception n’est pas renseigné : la livraison ne peut pas être confirmée.',
    })
  }

  if (!input.hasRequiredDocuments) {
    issues.push({
      code: 'documents_manquants',
      severity: 'avertissement',
      message: 'Les documents obligatoires ne sont pas encore réunis.',
    })
  }

  return {
    issues,
    canConfirm: issues.every((issue) => issue.severity !== 'blocage'),
  }
}

/**
 * Retard d'une livraison, en jours.
 * Positif = en retard. Null si le planning n'est pas dans un état où le retard
 * a un sens (déjà réceptionné, annulé, reporté).
 */
export function delayDays(plannedDate: string, today: string, status: PlanStatus): number | null {
  if (['receptionne', 'cloture', 'annule', 'reporte'].includes(status)) return null

  const [py, pm, pd] = plannedDate.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number]
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(py, pm - 1, pd)
  const days = Math.round(diff / 86_400_000)

  return days > 0 ? days : 0
}

export type PlanUrgency = 'a_venir' | 'demain' | 'aujourd_hui' | 'en_retard'

/** Classement d'un planning pour le tableau de bord et les alertes. */
export function planUrgency(plannedDate: string, today: string, status: PlanStatus): PlanUrgency | null {
  if (['receptionne', 'cloture', 'annule'].includes(status)) return null

  const delay = delayDays(plannedDate, today, status)
  if (delay !== null && delay > 0) return 'en_retard'
  if (plannedDate === today) return 'aujourd_hui'

  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number]
  const tomorrow = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10)
  if (plannedDate === tomorrow) return 'demain'

  return 'a_venir'
}

/** Un report doit être motivé : sinon la promesse non tenue disparaît sans trace. */
export function checkPostponement(reason: string): { valid: boolean; message: string | null } {
  if (reason.trim().length < 5) {
    return {
      valid: false,
      message: 'Un motif de report est obligatoire : une promesse non tenue doit rester expliquée.',
    }
  }
  return { valid: true, message: null }
}
