/**
 * Les vingt alertes, à seuils configurables.
 *
 * Une alerte est utile tant qu'elle est rare. Trois choix structurent le
 * module :
 *
 *  1. **Chaque alerte porte sa valeur mesurée ET son seuil.** Sans les deux, le
 *     lecteur ne peut ni vérifier ni contester : il ne peut qu'obéir ou ignorer.
 *
 *  2. **Chaque alerte porte une clé de déduplication.** La même condition, jour
 *     après jour, produit une seule alerte ouverte. Cent alertes identiques ne
 *     sont plus lues par personne, et l'alerte utile se perd avec les autres.
 *
 *  3. **Aucune alerte ne désigne un coupable.** Les messages décrivent un fait
 *     et un écart, jamais une intention. « Argent chez le pisteur depuis
 *     12 jours » est un constat ; « le pisteur retient l'argent » est une
 *     accusation que le logiciel n'a pas les moyens de porter.
 *
 * Le module est pur : il reçoit des faits déjà collectés et rend des candidats
 * d'alerte. C'est la couche serveur qui décide de les persister.
 */

export type AlertType =
  | 'financement_proche_echeance'
  | 'avance_sans_achat'
  | 'avance_non_couverte'
  | 'argent_chez_pisteur_trop_longtemps'
  | 'aucune_livraison_depuis_x_jours'
  | 'livraison_prevue_48h'
  | 'livraison_prevue_demain'
  | 'livraison_en_retard'
  | 'stock_insuffisant'
  | 'double_reservation'
  | 'camion_sans_document'
  | 'transfert_transit_trop_long'
  | 'reception_non_renseignee'
  | 'ecart_superieur_tolerance'
  | 'tare_anormale'
  | 'depense_sans_justificatif'
  | 'depense_doublon_probable'
  | 'tcb_superieur_prix_net'
  | 'marge_inferieure_seuil'
  | 'abonnement_proche_echeance'

export type AlertSeverity = 'info' | 'surveillance' | 'critique' | 'blocage'

export interface AlertRule {
  alertType: AlertType
  severity: AlertSeverity
  /** Seuil paramétrable. Les clés dépendent du type. */
  threshold: Record<string, number>
  isActive: boolean
}

export interface AlertRuleDefinition {
  severity: AlertSeverity
  threshold: Record<string, number>
  title: string
  /** Ce que l'alerte constate, en une phrase, pour l'écran de paramétrage. */
  description: string
  thresholdLabels: Record<string, string>
}

/**
 * Valeurs par défaut des vingt règles. Toutes sont modifiables par tenant :
 * un seuil imposé par l'éditeur serait un jugement sur un métier qu'il ne
 * pratique pas.
 */
export const DEFAULT_ALERT_RULES: Record<AlertType, AlertRuleDefinition> = {
  financement_proche_echeance: {
    severity: 'surveillance',
    threshold: { days: 7 },
    title: 'Financement proche de l’échéance',
    description: 'Un financement arrive à échéance dans moins de N jours.',
    thresholdLabels: { days: 'Jours avant échéance' },
  },
  avance_sans_achat: {
    severity: 'surveillance',
    threshold: { days: 3 },
    title: 'Avance décaissée sans achat',
    description: 'Une avance a été décaissée sans qu’aucun achat ne soit enregistré depuis N jours.',
    thresholdLabels: { days: 'Jours sans achat' },
  },
  avance_non_couverte: {
    severity: 'critique',
    threshold: { days: 15, amount: 0 },
    title: 'Avance non couverte',
    description: 'Un reliquat d’avance reste non couvert au-delà de N jours.',
    thresholdLabels: { days: 'Âge du reliquat (jours)', amount: 'Montant plancher (FCFA)' },
  },
  argent_chez_pisteur_trop_longtemps: {
    severity: 'critique',
    threshold: { days: 7, amount: 0 },
    title: 'Argent chez le pisteur depuis longtemps',
    description: 'L’exposition d’un pisteur dépasse N jours d’ancienneté.',
    thresholdLabels: { days: 'Ancienneté (jours)', amount: 'Exposition minimale (FCFA)' },
  },
  aucune_livraison_depuis_x_jours: {
    severity: 'surveillance',
    threshold: { days: 5 },
    title: 'Aucune livraison depuis N jours',
    description: 'Un pisteur actif n’a produit aucune livraison depuis N jours.',
    thresholdLabels: { days: 'Jours sans livraison' },
  },
  livraison_prevue_48h: {
    severity: 'info',
    threshold: { hours: 48 },
    title: 'Livraison prévue sous 48 h',
    description: 'Une livraison planifiée arrive dans moins de N heures.',
    thresholdLabels: { hours: 'Heures avant livraison' },
  },
  livraison_prevue_demain: {
    severity: 'info',
    threshold: { days: 1 },
    title: 'Livraison prévue demain',
    description: 'Une livraison est planifiée pour le lendemain.',
    thresholdLabels: { days: 'Jours avant livraison' },
  },
  livraison_en_retard: {
    severity: 'critique',
    threshold: { days: 1 },
    title: 'Livraison en retard',
    description: 'Une livraison planifiée a dépassé sa date de N jours.',
    thresholdLabels: { days: 'Jours de retard' },
  },
  stock_insuffisant: {
    severity: 'critique',
    threshold: { ratio: 1 },
    title: 'Stock insuffisant',
    description: 'Le stock disponible ne couvre pas le volume engagé.',
    thresholdLabels: { ratio: 'Couverture minimale (engagé / disponible)' },
  },
  double_reservation: {
    severity: 'blocage',
    threshold: { kg: 0 },
    title: 'Double réservation',
    description: 'Les réservations actives dépassent la quantité du lot.',
    thresholdLabels: { kg: 'Dépassement toléré (kg)' },
  },
  camion_sans_document: {
    severity: 'critique',
    threshold: { hours: 6 },
    title: 'Camion parti sans document',
    description: 'Un transfert est parti sans ticket de pesée depuis N heures.',
    thresholdLabels: { hours: 'Heures après départ' },
  },
  transfert_transit_trop_long: {
    severity: 'critique',
    threshold: { hours: 48 },
    title: 'Transfert en transit trop long',
    description: 'Un transfert est en transit depuis plus de N heures.',
    thresholdLabels: { hours: 'Heures en transit' },
  },
  reception_non_renseignee: {
    severity: 'surveillance',
    threshold: { hours: 24 },
    title: 'Réception non renseignée',
    description: 'Un camion est arrivé depuis N heures sans réception saisie.',
    thresholdLabels: { hours: 'Heures après arrivée' },
  },
  ecart_superieur_tolerance: {
    severity: 'critique',
    threshold: { pct: 0 },
    title: 'Écart supérieur à la tolérance',
    description: 'L’écart physique d’un transfert dépasse la tolérance applicable.',
    thresholdLabels: { pct: 'Marge au-delà de la tolérance (points de %)' },
  },
  tare_anormale: {
    severity: 'surveillance',
    threshold: { kg: 100 },
    title: 'Tare anormale',
    description: 'La tare à l’arrivée diffère de la tare au départ de plus de N kg.',
    thresholdLabels: { kg: 'Écart de tare (kg)' },
  },
  depense_sans_justificatif: {
    severity: 'surveillance',
    threshold: { amount: 50_000 },
    title: 'Dépense sans justificatif',
    description: 'Une dépense au-dessus de N FCFA n’a aucun justificatif joint.',
    thresholdLabels: { amount: 'Montant exigeant un justificatif (FCFA)' },
  },
  depense_doublon_probable: {
    severity: 'surveillance',
    threshold: { score: 70 },
    title: 'Dépense probablement en doublon',
    description: 'Deux dépenses présentent un score de similarité supérieur à N.',
    thresholdLabels: { score: 'Score de similarité' },
  },
  tcb_superieur_prix_net: {
    severity: 'critique',
    threshold: { margin: 0 },
    title: 'TCB supérieur au prix de vente net',
    description: 'Le coût de revient au kilo dépasse le prix de vente net.',
    thresholdLabels: { margin: 'Marge minimale (FCFA/kg)' },
  },
  marge_inferieure_seuil: {
    severity: 'surveillance',
    threshold: { marginPerKg: 10 },
    title: 'Marge inférieure au seuil',
    description: 'La marge au kilo passe sous le seuil configuré.',
    thresholdLabels: { marginPerKg: 'Marge minimale (FCFA/kg)' },
  },
  abonnement_proche_echeance: {
    severity: 'surveillance',
    threshold: { days: 7 },
    title: 'Abonnement proche de l’échéance',
    description: 'L’abonnement du tenant expire dans moins de N jours.',
    thresholdLabels: { days: 'Jours avant expiration' },
  },
}

export const ALERT_TYPES = Object.keys(DEFAULT_ALERT_RULES) as AlertType[]

export function defaultAlertRules(): AlertRule[] {
  return ALERT_TYPES.map((alertType) => ({
    alertType,
    severity: DEFAULT_ALERT_RULES[alertType].severity,
    threshold: { ...DEFAULT_ALERT_RULES[alertType].threshold },
    isActive: true,
  }))
}

// ---------------------------------------------------------------------------
// Faits observés
// ---------------------------------------------------------------------------

export interface FundingFact {
  id: string
  reference: string
  dueDate: string
  isSettled: boolean
}

export interface AdvanceFact {
  id: string
  reference: string
  fieldAgentId: string
  agentName: string
  disbursedDate: string | null
  purchaseCount: number
  outstandingAmount: number
  status: string
}

export interface AgentExposureFact {
  fieldAgentId: string
  agentName: string
  exposureAmount: number
  oldestDisbursementDate: string | null
  lastDeliveryDate: string | null
  isActive: boolean
}

export interface PlanFact {
  id: string
  reference: string
  plannedDate: string
  status: string
  partnerCompanyId: string | null
}

export interface StockCoverageFact {
  scopeId: string
  scopeLabel: string
  committedKg: number
  availableKg: number
}

export interface LotReservationFact {
  lotId: string
  lotCode: string
  quantityKg: number
  reservedKg: number
}

export interface TransferFact {
  id: string
  transferNumber: string
  status: string
  dispatchedAt: string | null
  arrivedAt: string | null
  hasWeighingTicket: boolean
  hasReception: boolean
  ecartPhysiquePct: number | null
  tolerancePct: number | null
  tareVariationKg: number | null
}

export interface ExpenseFact {
  id: string
  reference: string
  amount: number
  hasProof: boolean
  status: string
}

export interface DuplicateFlagFact {
  id: string
  expenseId: string
  candidateId: string
  similarityScore: number
  status: string
}

export interface TcbFact {
  scopeId: string
  scopeLabel: string
  tcbPerAcceptedKg: number | null
  netSalePricePerKg: number | null
  marginPerKg: number | null
}

export interface SubscriptionFact {
  id: string
  planLabel: string
  expiresOn: string
}

export interface AlertFacts {
  fundings?: readonly FundingFact[]
  advances?: readonly AdvanceFact[]
  agentExposures?: readonly AgentExposureFact[]
  plans?: readonly PlanFact[]
  stockCoverage?: readonly StockCoverageFact[]
  lotReservations?: readonly LotReservationFact[]
  transfers?: readonly TransferFact[]
  expenses?: readonly ExpenseFact[]
  duplicateFlags?: readonly DuplicateFlagFact[]
  tcb?: readonly TcbFact[]
  subscription?: SubscriptionFact | null
}

export interface AlertCandidate {
  alertType: AlertType
  severity: AlertSeverity
  title: string
  message: string
  measuredValue: number | null
  thresholdValue: number | null
  relatedTable: string | null
  relatedId: string | null
  fieldAgentId?: string | null
  dedupeKey: string
}

// ---------------------------------------------------------------------------
// Utilitaires de date · comparaisons en jours calendaires UTC
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

function toDayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

/** Jours entre deux dates calendaires. Positif si `to` est après `from`. */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from)
}

function hoursSince(instant: string, now: string): number {
  return (Date.parse(now) - Date.parse(instant)) / 3_600_000
}

// ---------------------------------------------------------------------------
// Évaluation
// ---------------------------------------------------------------------------

interface RuleLookup {
  get(type: AlertType): AlertRule | null
}

function buildLookup(rules: readonly AlertRule[]): RuleLookup {
  const map = new Map(rules.map((rule) => [rule.alertType, rule]))
  return {
    get(type) {
      const rule = map.get(type)
      if (!rule || !rule.isActive) return null
      return rule
    },
  }
}

function threshold(rule: AlertRule, key: string): number {
  const configured = rule.threshold[key]
  if (configured !== undefined) return configured
  return DEFAULT_ALERT_RULES[rule.alertType].threshold[key] ?? 0
}

function candidate(
  rule: AlertRule,
  args: Omit<AlertCandidate, 'alertType' | 'severity' | 'title'> & { title?: string },
): AlertCandidate {
  return {
    alertType: rule.alertType,
    severity: rule.severity,
    title: args.title ?? DEFAULT_ALERT_RULES[rule.alertType].title,
    message: args.message,
    measuredValue: args.measuredValue,
    thresholdValue: args.thresholdValue,
    relatedTable: args.relatedTable,
    relatedId: args.relatedId,
    fieldAgentId: args.fieldAgentId ?? null,
    dedupeKey: args.dedupeKey,
  }
}

/**
 * Évalue les vingt règles sur un instantané de faits.
 *
 * `now` est injecté : un moteur d'alertes qui lit l'horloge système n'est pas
 * testable, et une alerte non testée finit par se déclencher au mauvais moment.
 */
export function evaluateAlerts(
  facts: AlertFacts,
  rules: readonly AlertRule[] = defaultAlertRules(),
  now: Date = new Date(),
): AlertCandidate[] {
  const lookup = buildLookup(rules)
  const nowIso = now.toISOString()
  const today = nowIso.slice(0, 10)
  const out: AlertCandidate[] = []

  // --- Financements ---------------------------------------------------------
  const fundingRule = lookup.get('financement_proche_echeance')
  if (fundingRule) {
    const limit = threshold(fundingRule, 'days')
    for (const funding of facts.fundings ?? []) {
      if (funding.isSettled) continue
      const remaining = daysBetween(today, funding.dueDate)
      if (remaining <= limit) {
        out.push(
          candidate(fundingRule, {
            message:
              remaining < 0
                ? `Financement ${funding.reference} échu depuis ${Math.abs(remaining)} jour(s).`
                : `Financement ${funding.reference} à échéance dans ${remaining} jour(s).`,
            measuredValue: remaining,
            thresholdValue: limit,
            relatedTable: 'fundings',
            relatedId: funding.id,
            dedupeKey: `financement_proche_echeance:${funding.id}`,
          }),
        )
      }
    }
  }

  // --- Avances --------------------------------------------------------------
  const noPurchaseRule = lookup.get('avance_sans_achat')
  const uncoveredRule = lookup.get('avance_non_couverte')
  for (const advance of facts.advances ?? []) {
    if (advance.disbursedDate === null) continue
    const age = daysBetween(advance.disbursedDate, today)

    if (noPurchaseRule && advance.purchaseCount === 0) {
      const limit = threshold(noPurchaseRule, 'days')
      if (age >= limit) {
        out.push(
          candidate(noPurchaseRule, {
            message: `Avance ${advance.reference} (${advance.agentName}) décaissée depuis ${age} jour(s) sans achat enregistré.`,
            measuredValue: age,
            thresholdValue: limit,
            relatedTable: 'advances',
            relatedId: advance.id,
            fieldAgentId: advance.fieldAgentId,
            dedupeKey: `avance_sans_achat:${advance.id}`,
          }),
        )
      }
    }

    if (uncoveredRule && advance.outstandingAmount > threshold(uncoveredRule, 'amount')) {
      const limit = threshold(uncoveredRule, 'days')
      if (age >= limit) {
        out.push(
          candidate(uncoveredRule, {
            message: `Avance ${advance.reference} (${advance.agentName}) : reliquat non couvert depuis ${age} jour(s).`,
            measuredValue: age,
            thresholdValue: limit,
            relatedTable: 'advances',
            relatedId: advance.id,
            fieldAgentId: advance.fieldAgentId,
            dedupeKey: `avance_non_couverte:${advance.id}`,
          }),
        )
      }
    }
  }

  // --- Exposition des pisteurs ---------------------------------------------
  const exposureRule = lookup.get('argent_chez_pisteur_trop_longtemps')
  const idleRule = lookup.get('aucune_livraison_depuis_x_jours')
  for (const agent of facts.agentExposures ?? []) {
    if (exposureRule && agent.oldestDisbursementDate !== null) {
      const days = daysBetween(agent.oldestDisbursementDate, today)
      const minAmount = threshold(exposureRule, 'amount')
      const limit = threshold(exposureRule, 'days')
      if (days >= limit && agent.exposureAmount > minAmount) {
        out.push(
          candidate(exposureRule, {
            // Constat, pas accusation : l'argent peut être immobilisé par un
            // marché fermé, une route coupée ou un acheteur absent.
            message: `${agent.agentName} détient une exposition de ${agent.exposureAmount} FCFA depuis ${days} jour(s).`,
            measuredValue: days,
            thresholdValue: limit,
            relatedTable: 'field_agents',
            relatedId: agent.fieldAgentId,
            fieldAgentId: agent.fieldAgentId,
            dedupeKey: `argent_chez_pisteur_trop_longtemps:${agent.fieldAgentId}`,
          }),
        )
      }
    }

    if (idleRule && agent.isActive && agent.lastDeliveryDate !== null) {
      const days = daysBetween(agent.lastDeliveryDate, today)
      const limit = threshold(idleRule, 'days')
      if (days >= limit) {
        out.push(
          candidate(idleRule, {
            message: `${agent.agentName} n’a livré aucune marchandise depuis ${days} jour(s).`,
            measuredValue: days,
            thresholdValue: limit,
            relatedTable: 'field_agents',
            relatedId: agent.fieldAgentId,
            fieldAgentId: agent.fieldAgentId,
            dedupeKey: `aucune_livraison_depuis_x_jours:${agent.fieldAgentId}`,
          }),
        )
      }
    }
  }

  // --- Planning -------------------------------------------------------------
  const closedPlanStatuses = ['receptionne', 'cloture', 'annule', 'reporte']
  const soonRule = lookup.get('livraison_prevue_48h')
  const tomorrowRule = lookup.get('livraison_prevue_demain')
  const lateRule = lookup.get('livraison_en_retard')
  for (const plan of facts.plans ?? []) {
    if (closedPlanStatuses.includes(plan.status)) continue
    const remainingDays = daysBetween(today, plan.plannedDate)

    if (lateRule && remainingDays < 0) {
      const limit = threshold(lateRule, 'days')
      const late = Math.abs(remainingDays)
      if (late >= limit) {
        out.push(
          candidate(lateRule, {
            message: `Livraison ${plan.reference} en retard de ${late} jour(s).`,
            measuredValue: late,
            thresholdValue: limit,
            relatedTable: 'delivery_plans',
            relatedId: plan.id,
            dedupeKey: `livraison_en_retard:${plan.id}`,
          }),
        )
      }
      continue
    }

    if (tomorrowRule && remainingDays === threshold(tomorrowRule, 'days')) {
      out.push(
        candidate(tomorrowRule, {
          message: `Livraison ${plan.reference} prévue demain.`,
          measuredValue: remainingDays,
          thresholdValue: threshold(tomorrowRule, 'days'),
          relatedTable: 'delivery_plans',
          relatedId: plan.id,
          dedupeKey: `livraison_prevue_demain:${plan.id}`,
        }),
      )
    }

    if (soonRule) {
      const limitHours = threshold(soonRule, 'hours')
      if (remainingDays >= 0 && remainingDays * 24 <= limitHours) {
        out.push(
          candidate(soonRule, {
            message: `Livraison ${plan.reference} prévue dans ${remainingDays * 24} h.`,
            measuredValue: remainingDays * 24,
            thresholdValue: limitHours,
            relatedTable: 'delivery_plans',
            relatedId: plan.id,
            dedupeKey: `livraison_prevue_48h:${plan.id}`,
          }),
        )
      }
    }
  }

  // --- Stock ----------------------------------------------------------------
  const stockRule = lookup.get('stock_insuffisant')
  if (stockRule) {
    const ratioLimit = threshold(stockRule, 'ratio')
    for (const coverage of facts.stockCoverage ?? []) {
      if (coverage.committedKg <= 0) continue
      const ratio = coverage.availableKg / coverage.committedKg
      if (ratio < ratioLimit) {
        out.push(
          candidate(stockRule, {
            message: `${coverage.scopeLabel} : ${coverage.availableKg} kg disponibles pour ${coverage.committedKg} kg engagés.`,
            measuredValue: Math.round(ratio * 10_000) / 10_000,
            thresholdValue: ratioLimit,
            relatedTable: 'contracts',
            relatedId: coverage.scopeId,
            dedupeKey: `stock_insuffisant:${coverage.scopeId}`,
          }),
        )
      }
    }
  }

  const doubleRule = lookup.get('double_reservation')
  if (doubleRule) {
    const tolerated = threshold(doubleRule, 'kg')
    for (const lot of facts.lotReservations ?? []) {
      const excess = lot.reservedKg - lot.quantityKg
      if (excess > tolerated) {
        out.push(
          candidate(doubleRule, {
            message: `Lot ${lot.lotCode} : ${lot.reservedKg} kg réservés pour ${lot.quantityKg} kg disponibles.`,
            measuredValue: excess,
            thresholdValue: tolerated,
            relatedTable: 'stock_lots',
            relatedId: lot.lotId,
            dedupeKey: `double_reservation:${lot.lotId}`,
          }),
        )
      }
    }
  }

  // --- Transferts -----------------------------------------------------------
  const documentRule = lookup.get('camion_sans_document')
  const transitRule = lookup.get('transfert_transit_trop_long')
  const receptionRule = lookup.get('reception_non_renseignee')
  const varianceRule = lookup.get('ecart_superieur_tolerance')
  const tareRule = lookup.get('tare_anormale')

  for (const transfer of facts.transfers ?? []) {
    if (documentRule && transfer.dispatchedAt !== null && !transfer.hasWeighingTicket) {
      const limit = threshold(documentRule, 'hours')
      const elapsed = Math.floor(hoursSince(transfer.dispatchedAt, nowIso))
      if (elapsed >= limit) {
        out.push(
          candidate(documentRule, {
            message: `Transfert ${transfer.transferNumber} parti depuis ${elapsed} h sans ticket de pesée.`,
            measuredValue: elapsed,
            thresholdValue: limit,
            relatedTable: 'transfers',
            relatedId: transfer.id,
            dedupeKey: `camion_sans_document:${transfer.id}`,
          }),
        )
      }
    }

    if (transitRule && transfer.status === 'en_transit' && transfer.dispatchedAt !== null) {
      const limit = threshold(transitRule, 'hours')
      const elapsed = Math.floor(hoursSince(transfer.dispatchedAt, nowIso))
      if (elapsed >= limit) {
        out.push(
          candidate(transitRule, {
            message: `Transfert ${transfer.transferNumber} en transit depuis ${elapsed} h.`,
            measuredValue: elapsed,
            thresholdValue: limit,
            relatedTable: 'transfers',
            relatedId: transfer.id,
            dedupeKey: `transfert_transit_trop_long:${transfer.id}`,
          }),
        )
      }
    }

    if (receptionRule && transfer.arrivedAt !== null && !transfer.hasReception) {
      const limit = threshold(receptionRule, 'hours')
      const elapsed = Math.floor(hoursSince(transfer.arrivedAt, nowIso))
      if (elapsed >= limit) {
        out.push(
          candidate(receptionRule, {
            message: `Transfert ${transfer.transferNumber} arrivé depuis ${elapsed} h sans réception saisie.`,
            measuredValue: elapsed,
            thresholdValue: limit,
            relatedTable: 'transfers',
            relatedId: transfer.id,
            dedupeKey: `reception_non_renseignee:${transfer.id}`,
          }),
        )
      }
    }

    if (
      varianceRule &&
      transfer.ecartPhysiquePct !== null &&
      transfer.tolerancePct !== null &&
      Math.abs(transfer.ecartPhysiquePct) > transfer.tolerancePct + threshold(varianceRule, 'pct')
    ) {
      out.push(
        candidate(varianceRule, {
          // La cause reste ouverte : humidité, pont-bascule, route ou saisie.
          message: `Transfert ${transfer.transferNumber} : écart physique de ${transfer.ecartPhysiquePct} % pour une tolérance de ${transfer.tolerancePct} %. Cause à qualifier.`,
          measuredValue: Math.abs(transfer.ecartPhysiquePct),
          thresholdValue: transfer.tolerancePct,
          relatedTable: 'transfers',
          relatedId: transfer.id,
          dedupeKey: `ecart_superieur_tolerance:${transfer.id}`,
        }),
      )
    }

    if (tareRule && transfer.tareVariationKg !== null) {
      const limit = threshold(tareRule, 'kg')
      if (Math.abs(transfer.tareVariationKg) > limit) {
        out.push(
          candidate(tareRule, {
            message: `Transfert ${transfer.transferNumber} : tare variant de ${transfer.tareVariationKg} kg entre départ et arrivée.`,
            measuredValue: Math.abs(transfer.tareVariationKg),
            thresholdValue: limit,
            relatedTable: 'transfers',
            relatedId: transfer.id,
            dedupeKey: `tare_anormale:${transfer.id}`,
          }),
        )
      }
    }
  }

  // --- Dépenses -------------------------------------------------------------
  const proofRule = lookup.get('depense_sans_justificatif')
  if (proofRule) {
    const limit = threshold(proofRule, 'amount')
    for (const expense of facts.expenses ?? []) {
      if (['rejetee', 'annulee', 'brouillon'].includes(expense.status)) continue
      if (!expense.hasProof && expense.amount > limit) {
        out.push(
          candidate(proofRule, {
            message: `Dépense ${expense.reference} de ${expense.amount} FCFA sans justificatif joint.`,
            measuredValue: expense.amount,
            thresholdValue: limit,
            relatedTable: 'expenses',
            relatedId: expense.id,
            dedupeKey: `depense_sans_justificatif:${expense.id}`,
          }),
        )
      }
    }
  }

  const duplicateRule = lookup.get('depense_doublon_probable')
  if (duplicateRule) {
    const limit = threshold(duplicateRule, 'score')
    for (const flag of facts.duplicateFlags ?? []) {
      if (flag.status !== 'a_verifier') continue
      if (flag.similarityScore >= limit) {
        out.push(
          candidate(duplicateRule, {
            message: `Deux dépenses présentent une similarité de ${flag.similarityScore}/100. À vérifier avant paiement.`,
            measuredValue: flag.similarityScore,
            thresholdValue: limit,
            relatedTable: 'expense_duplicate_flags',
            relatedId: flag.id,
            dedupeKey: `depense_doublon_probable:${flag.id}`,
          }),
        )
      }
    }
  }

  // --- TCB et marges --------------------------------------------------------
  const costRule = lookup.get('tcb_superieur_prix_net')
  const marginRule = lookup.get('marge_inferieure_seuil')
  for (const tcb of facts.tcb ?? []) {
    if (costRule && tcb.tcbPerAcceptedKg !== null && tcb.netSalePricePerKg !== null) {
      const margin = threshold(costRule, 'margin')
      if (tcb.tcbPerAcceptedKg > tcb.netSalePricePerKg - margin) {
        out.push(
          candidate(costRule, {
            message: `${tcb.scopeLabel} : coût de revient de ${tcb.tcbPerAcceptedKg} FCFA/kg pour un prix net de ${tcb.netSalePricePerKg} FCFA/kg.`,
            measuredValue: tcb.tcbPerAcceptedKg,
            thresholdValue: tcb.netSalePricePerKg,
            relatedTable: 'tcb_snapshots',
            relatedId: tcb.scopeId,
            dedupeKey: `tcb_superieur_prix_net:${tcb.scopeId}`,
          }),
        )
      }
    }

    if (marginRule && tcb.marginPerKg !== null) {
      const limit = threshold(marginRule, 'marginPerKg')
      if (tcb.marginPerKg < limit) {
        out.push(
          candidate(marginRule, {
            message: `${tcb.scopeLabel} : marge de ${tcb.marginPerKg} FCFA/kg, sous le seuil de ${limit} FCFA/kg.`,
            measuredValue: tcb.marginPerKg,
            thresholdValue: limit,
            relatedTable: 'tcb_snapshots',
            relatedId: tcb.scopeId,
            dedupeKey: `marge_inferieure_seuil:${tcb.scopeId}`,
          }),
        )
      }
    }
  }

  // --- Abonnement -----------------------------------------------------------
  const subscriptionRule = lookup.get('abonnement_proche_echeance')
  if (subscriptionRule && facts.subscription) {
    const limit = threshold(subscriptionRule, 'days')
    const remaining = daysBetween(today, facts.subscription.expiresOn)
    if (remaining <= limit) {
      out.push(
        candidate(subscriptionRule, {
          message:
            remaining < 0
              ? `Abonnement ${facts.subscription.planLabel} expiré depuis ${Math.abs(remaining)} jour(s).`
              : `Abonnement ${facts.subscription.planLabel} expire dans ${remaining} jour(s).`,
          measuredValue: remaining,
          thresholdValue: limit,
          relatedTable: 'subscriptions',
          relatedId: facts.subscription.id,
          dedupeKey: `abonnement_proche_echeance:${facts.subscription.id}`,
        }),
      )
    }
  }

  return out
}

/**
 * Retire les candidats déjà ouverts et les doublons internes.
 *
 * Rejouer l'évaluation chaque heure ne doit pas empiler la même alerte : c'est
 * ce qui rend un centre d'alertes illisible en une semaine.
 */
export function dedupeCandidates(
  candidates: readonly AlertCandidate[],
  openDedupeKeys: readonly string[] = [],
): AlertCandidate[] {
  const seen = new Set(openDedupeKeys)
  const kept: AlertCandidate[] = []

  for (const item of candidates) {
    if (seen.has(item.dedupeKey)) continue
    seen.add(item.dedupeKey)
    kept.push(item)
  }

  return kept
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  blocage: 0,
  critique: 1,
  surveillance: 2,
  info: 3,
}

/** Tri d'affichage : le bloquant d'abord, puis le critique. */
export function sortBySeverity(candidates: readonly AlertCandidate[]): AlertCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.alertType.localeCompare(b.alertType),
  )
}
