/**
 * Score de fiabilité d'un pisteur.
 *
 * Un score est une accusation chiffrée. Le produit peut le calculer, il ne doit
 * jamais le transformer en sanction. Quatre garde-fous sont codés ici, pas
 * seulement documentés :
 *
 *  1. **Aucune sanction automatique.** Le résultat ne contient aucune décision.
 *     `buildRecommendations` produit des propositions explicitement marquées
 *     `requiresHumanDecision`, jamais un plafond appliqué (CMD §17, DMQ E06).
 *
 *  2. **Une composante sans donnée est exclue, pas notée zéro.** Un pisteur qui
 *     n'a jamais reçu de sacs ne doit pas perdre 5 points de « gestion des
 *     sacs » : ce serait le punir pour une chose qui n'a pas eu lieu. Les poids
 *     sont renormalisés sur les composantes réellement mesurées, et les
 *     exclusions sont affichées.
 *
 *  3. **Un débutant n'est pas noté comme un habitué.** La maturité gouverne
 *     l'affichage : en dessous du seuil d'observation, aucune catégorie n'est
 *     prononcée.
 *
 *  4. **Score brut et score ajusté coexistent.** Les événements externes
 *     validés (camion indisponible, pont-bascule en panne, pluie) produisent un
 *     score ajusté ; le brut reste visible et reconstituable (RG-12).
 */

import { round2 } from './money'

export type ScoreComponentCode =
  | 'couverture_avances'
  | 'respect_delais'
  | 'ecarts_poids'
  | 'respect_prix'
  | 'qualite'
  | 'fiabilite_justificatifs'
  | 'gestion_sacs'
  | 'regularite'
  | 'maitrise_tcb'

export type ScoreCategory =
  | 'excellent'
  | 'fiable'
  | 'sous_surveillance'
  | 'risque'
  | 'critique'
  | 'non_evalue'

export type ScoreMaturity = 'non_evalue' | 'en_observation' | 'provisoire' | 'confirme'

/** Les neuf pondérations imposées. Leur somme vaut exactement 100. */
export const SCORE_WEIGHTS: Record<ScoreComponentCode, number> = {
  couverture_avances: 20,
  respect_delais: 15,
  ecarts_poids: 15,
  respect_prix: 10,
  qualite: 10,
  fiabilite_justificatifs: 10,
  gestion_sacs: 5,
  regularite: 5,
  maitrise_tcb: 10,
}

export const SCORE_COMPONENT_LABELS: Record<ScoreComponentCode, string> = {
  couverture_avances: 'Couverture des avances',
  respect_delais: 'Respect des délais',
  ecarts_poids: 'Écarts de poids',
  respect_prix: 'Respect des prix',
  qualite: 'Qualité livrée',
  fiabilite_justificatifs: 'Fiabilité des justificatifs',
  gestion_sacs: 'Gestion des sacs',
  regularite: 'Régularité',
  maitrise_tcb: 'Maîtrise du TCB contrôlable',
}

export const SCORE_COMPONENT_CODES = Object.keys(SCORE_WEIGHTS) as ScoreComponentCode[]

/** Événement externe validé qui explique un écart sans l'imputer au pisteur. */
export interface ExternalEvent {
  id: string
  eventType: string
  description: string
  /** Seul un événement validé peut ajuster un score. */
  validated: boolean
  affectedComponents: ScoreComponentCode[]
}

export interface ScoreComponentInput {
  component: ScoreComponentCode
  /** Valeur brute sur 100. `null` quand la composante n'est pas mesurable. */
  value: number | null
  /**
   * Valeur recalculée en neutralisant les observations couvertes par un
   * événement externe validé. Absente = identique au brut.
   */
  adjustedValue?: number | null
  /** Nombre d'observations ayant produit la valeur. Zéro = non mesurable. */
  observationCount: number
  sourceData?: Record<string, number | string | null>
  /** Identifiants des événements externes neutralisés dans `adjustedValue`. */
  excludedEventIds?: string[]
}

export interface ScoreComponentResult {
  component: ScoreComponentCode
  label: string
  /** Poids nominal imposé par la commande. */
  nominalWeight: number
  /** Poids réellement appliqué après renormalisation. */
  effectiveWeight: number
  value: number | null
  adjustedValue: number | null
  weightedValue: number | null
  observationCount: number
  isMeasured: boolean
  sourceData: Record<string, number | string | null>
  excludedEventIds: string[]
  explanation: string
}

export interface HumanAdjustment {
  delta: number
  reason: string
  adjustedBy: string
}

export interface ScoreInputs {
  components: readonly ScoreComponentInput[]
  /** Nombre d'opérations achevées sur la période : gouverne la maturité. */
  completedOperations: number
  /** Jours d'activité observés. Un score sur trois jours n'est pas un score. */
  activeDays: number
  externalEvents?: readonly ExternalEvent[]
  humanAdjustments?: readonly HumanAdjustment[]
  /** Plafond d'avance actuel, base des recommandations. */
  currentCeiling?: number | null
}

export interface ScoreResult {
  rawScore: number | null
  adjustedScore: number | null
  /** Score affiché = ajusté + ajustements humains motivés, borné à [0, 100]. */
  displayedScore: number | null
  category: ScoreCategory
  maturity: ScoreMaturity
  components: ScoreComponentResult[]
  unmeasuredComponents: ScoreComponentCode[]
  /** Poids nominal total des composantes non mesurées, redistribué. */
  redistributedWeight: number
  appliedEvents: ExternalEvent[]
  ignoredEvents: ExternalEvent[]
  humanAdjustmentTotal: number
  explanation: string
}

// ---------------------------------------------------------------------------
// Maturité
// ---------------------------------------------------------------------------

/**
 * Seuils de maturité (hypothèse H-15, paramétrables).
 * Ils gouvernent le **droit de prononcer une catégorie**, pas le calcul.
 */
export const MATURITY_THRESHOLDS = {
  observation: { operations: 3, days: 7 },
  provisional: { operations: 10, days: 21 },
  confirmed: { operations: 25, days: 45 },
} as const

export function resolveMaturity(completedOperations: number, activeDays: number): ScoreMaturity {
  const { observation, provisional, confirmed } = MATURITY_THRESHOLDS
  if (completedOperations >= confirmed.operations && activeDays >= confirmed.days) return 'confirme'
  if (completedOperations >= provisional.operations && activeDays >= provisional.days) return 'provisoire'
  if (completedOperations >= observation.operations && activeDays >= observation.days) {
    return 'en_observation'
  }
  return 'non_evalue'
}

// ---------------------------------------------------------------------------
// Catégorie
// ---------------------------------------------------------------------------

export const CATEGORY_THRESHOLDS: ReadonlyArray<{ min: number; category: ScoreCategory }> = [
  { min: 85, category: 'excellent' },
  { min: 70, category: 'fiable' },
  { min: 55, category: 'sous_surveillance' },
  { min: 40, category: 'risque' },
  { min: 0, category: 'critique' },
]

export const CATEGORY_LABELS: Record<ScoreCategory, string> = {
  excellent: 'Excellent',
  fiable: 'Fiable',
  sous_surveillance: 'Sous surveillance',
  risque: 'À risque',
  critique: 'Critique',
  non_evalue: 'Non évalué',
}

/**
 * Traduit un score en catégorie.
 *
 * Une maturité insuffisante renvoie `non_evalue` quel que soit le score :
 * qualifier un pisteur de « critique » sur deux livraisons serait une
 * conclusion que les données ne portent pas.
 */
export function resolveCategory(score: number | null, maturity: ScoreMaturity): ScoreCategory {
  if (score === null || maturity === 'non_evalue') return 'non_evalue'
  return CATEGORY_THRESHOLDS.find((threshold) => score >= threshold.min)?.category ?? 'critique'
}

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function weightedAverage(
  entries: ReadonlyArray<{ weight: number; value: number }>,
): number | null {
  const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0)
  if (totalWeight <= 0) return null
  const total = entries.reduce((sumValue, entry) => sumValue + entry.weight * entry.value, 0)
  return round2(total / totalWeight)
}

export function computeAgentScore(inputs: ScoreInputs): ScoreResult {
  const byCode = new Map(inputs.components.map((component) => [component.component, component]))

  const measured: ScoreComponentInput[] = []
  const unmeasuredComponents: ScoreComponentCode[] = []

  for (const code of SCORE_COMPONENT_CODES) {
    const input = byCode.get(code)
    if (!input || input.value === null || input.observationCount <= 0) {
      unmeasuredComponents.push(code)
    } else {
      measured.push(input)
    }
  }

  const measuredWeight = measured.reduce((total, item) => total + SCORE_WEIGHTS[item.component], 0)
  const redistributedWeight = round2(
    unmeasuredComponents.reduce((total, code) => total + SCORE_WEIGHTS[code], 0),
  )

  const events = inputs.externalEvents ?? []
  const appliedEvents = events.filter((event) => event.validated)
  const ignoredEvents = events.filter((event) => !event.validated)

  const components: ScoreComponentResult[] = SCORE_COMPONENT_CODES.map((code) => {
    const input = byCode.get(code)
    const isMeasured = measured.some((item) => item.component === code)
    const nominalWeight = SCORE_WEIGHTS[code]
    const effectiveWeight =
      isMeasured && measuredWeight > 0 ? round2((nominalWeight / measuredWeight) * 100) : 0

    const value = isMeasured ? clamp(input?.value ?? 0) : null
    const adjustedRaw = input?.adjustedValue
    const adjustedValue =
      !isMeasured ? null : adjustedRaw === undefined || adjustedRaw === null ? value : clamp(adjustedRaw)

    return {
      component: code,
      label: SCORE_COMPONENT_LABELS[code],
      nominalWeight,
      effectiveWeight,
      value,
      adjustedValue,
      weightedValue:
        value === null ? null : round2((value * effectiveWeight) / 100),
      observationCount: input?.observationCount ?? 0,
      isMeasured,
      sourceData: input?.sourceData ?? {},
      excludedEventIds: input?.excludedEventIds ?? [],
      explanation: isMeasured
        ? `${input?.observationCount ?? 0} observation(s) sur la période.`
        : 'Composante non mesurée sur la période : son poids est redistribué, elle n’est pas notée zéro.',
    }
  })

  const rawScore = weightedAverage(
    measured.map((item) => ({
      weight: SCORE_WEIGHTS[item.component],
      value: clamp(item.value ?? 0),
    })),
  )

  const adjustedScore = weightedAverage(
    measured.map((item) => ({
      weight: SCORE_WEIGHTS[item.component],
      value: clamp(
        item.adjustedValue === undefined || item.adjustedValue === null
          ? (item.value ?? 0)
          : item.adjustedValue,
      ),
    })),
  )

  const humanAdjustments = (inputs.humanAdjustments ?? []).filter(
    (adjustment) => adjustment.reason.trim().length >= 10 && adjustment.adjustedBy.length > 0,
  )
  const humanAdjustmentTotal = round2(
    humanAdjustments.reduce((total, adjustment) => total + adjustment.delta, 0),
  )

  const displayedScore =
    adjustedScore === null ? null : round2(clamp(adjustedScore + humanAdjustmentTotal))

  const maturity = resolveMaturity(inputs.completedOperations, inputs.activeDays)
  const category = resolveCategory(displayedScore, maturity)

  return {
    rawScore,
    adjustedScore,
    displayedScore,
    category,
    maturity,
    components,
    unmeasuredComponents,
    redistributedWeight,
    appliedEvents,
    ignoredEvents,
    humanAdjustmentTotal,
    explanation: explainScore({
      rawScore,
      maturity,
      unmeasuredComponents,
      redistributedWeight,
      appliedEvents,
      humanAdjustmentTotal,
    }),
  }
}

function explainScore(state: {
  rawScore: number | null
  maturity: ScoreMaturity
  unmeasuredComponents: ScoreComponentCode[]
  redistributedWeight: number
  appliedEvents: ExternalEvent[]
  humanAdjustmentTotal: number
}): string {
  if (state.rawScore === null) {
    return 'Aucune composante mesurable : le pisteur n’a pas encore d’activité évaluable.'
  }

  const parts: string[] = []
  if (state.maturity === 'non_evalue') {
    parts.push(
      'Activité insuffisante pour prononcer une catégorie : le score est calculé mais reste indicatif.',
    )
  } else if (state.maturity === 'en_observation') {
    parts.push('Pisteur en observation : le score repose sur un historique court.')
  }

  if (state.unmeasuredComponents.length > 0) {
    parts.push(
      `${state.unmeasuredComponents.length} composante(s) non mesurée(s) — ${state.redistributedWeight} points de poids redistribués sur les composantes observées.`,
    )
  }

  if (state.appliedEvents.length > 0) {
    parts.push(
      `${state.appliedEvents.length} événement(s) externe(s) validé(s) neutralisé(s) dans le score ajusté.`,
    )
  }

  if (state.humanAdjustmentTotal !== 0) {
    parts.push(`Ajustement humain motivé de ${state.humanAdjustmentTotal} point(s).`)
  }

  if (parts.length === 0) parts.push('Toutes les composantes sont mesurées sur la période.')
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Recommandations · propositions, jamais décisions
// ---------------------------------------------------------------------------

export type RecommendationAction =
  | 'maintenir_plafond'
  | 'augmenter_plafond'
  | 'reduire_plafond'
  | 'entretien_terrain'
  | 'audit_documents'
  | 'aucune_action'

export interface ScoreRecommendation {
  action: RecommendationAction
  label: string
  rationale: string
  suggestedCeiling: number | null
  /** Toujours vrai. Aucune recommandation n'est exécutable sans décision humaine. */
  requiresHumanDecision: true
}

const CEILING_FACTORS: Record<ScoreCategory, number | null> = {
  excellent: 1.2,
  fiable: 1,
  sous_surveillance: 0.85,
  risque: 0.6,
  critique: 0.4,
  non_evalue: null,
}

/**
 * Propose — sans jamais appliquer — les suites à donner à un score.
 *
 * Le plafond suggéré est une aide à la décision. Aucune écriture de plafond
 * n'est produite ici : une réduction automatique d'encours sur la foi d'un
 * chiffre priverait un pisteur de son revenu sans qu'un humain l'ait décidé.
 */
export function buildRecommendations(
  score: ScoreResult,
  currentCeiling: number | null = null,
): ScoreRecommendation[] {
  if (score.maturity === 'non_evalue' || score.displayedScore === null) {
    return [
      {
        action: 'aucune_action',
        label: 'Poursuivre l’observation',
        rationale:
          'L’historique est trop court pour fonder une décision. Le score reste affiché à titre indicatif.',
        suggestedCeiling: null,
        requiresHumanDecision: true,
      },
    ]
  }

  const factor = CEILING_FACTORS[score.category]
  const suggestedCeiling =
    currentCeiling !== null && factor !== null ? round2(currentCeiling * factor) : null

  const recommendations: ScoreRecommendation[] = []

  if (score.category === 'excellent') {
    recommendations.push({
      action: 'augmenter_plafond',
      label: 'Proposer une hausse de plafond',
      rationale: `Score affiché ${score.displayedScore}/100, maturité « ${score.maturity} ».`,
      suggestedCeiling,
      requiresHumanDecision: true,
    })
  } else if (score.category === 'fiable') {
    recommendations.push({
      action: 'maintenir_plafond',
      label: 'Maintenir le plafond actuel',
      rationale: `Score affiché ${score.displayedScore}/100, aucune dérive constatée.`,
      suggestedCeiling,
      requiresHumanDecision: true,
    })
  } else {
    recommendations.push({
      action: 'reduire_plafond',
      label: 'Proposer une réduction de plafond',
      rationale: `Score affiché ${score.displayedScore}/100. À examiner avec le pisteur avant toute décision.`,
      suggestedCeiling,
      requiresHumanDecision: true,
    })
    recommendations.push({
      action: 'entretien_terrain',
      label: 'Organiser un entretien terrain',
      rationale:
        'Un score bas s’explique souvent par un contexte que les données ne portent pas : route, acheteur, financement.',
      suggestedCeiling: null,
      requiresHumanDecision: true,
    })
  }

  const documents = score.components.find(
    (component) => component.component === 'fiabilite_justificatifs',
  )
  if (documents?.value !== null && documents !== undefined && (documents.value ?? 100) < 60) {
    recommendations.push({
      action: 'audit_documents',
      label: 'Contrôler les justificatifs',
      rationale: `Fiabilité des justificatifs à ${documents.value}/100 sur ${documents.observationCount} observation(s).`,
      suggestedCeiling: null,
      requiresHumanDecision: true,
    })
  }

  return recommendations
}

/**
 * Garde-fou explicite : aucune fonction du domaine ne produit de sanction.
 * Exporté pour être vérifié par un test, afin que la règle ne puisse pas
 * disparaître discrètement au fil des refactorisations.
 */
export const AUTOMATIC_SANCTIONS_ENABLED = false
