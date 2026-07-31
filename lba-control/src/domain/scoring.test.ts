import { describe, expect, it } from 'vitest'
import {
  AUTOMATIC_SANCTIONS_ENABLED,
  buildRecommendations,
  computeAgentScore,
  resolveCategory,
  resolveMaturity,
  SCORE_COMPONENT_CODES,
  SCORE_WEIGHTS,
  type ScoreComponentInput,
} from './scoring'

function allComponents(value: number, observationCount = 10): ScoreComponentInput[] {
  return SCORE_COMPONENT_CODES.map((component) => ({ component, value, observationCount }))
}

const MATURE = { completedOperations: 40, activeDays: 90 }

describe('SCORE_WEIGHTS', () => {
  it('reprend exactement les neuf pondérations imposées, de somme 100', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((total, weight) => total + weight, 0)).toBe(100)
    expect(SCORE_WEIGHTS.couverture_avances).toBe(20)
    expect(SCORE_WEIGHTS.respect_delais).toBe(15)
    expect(SCORE_WEIGHTS.ecarts_poids).toBe(15)
    expect(SCORE_WEIGHTS.respect_prix).toBe(10)
    expect(SCORE_WEIGHTS.qualite).toBe(10)
    expect(SCORE_WEIGHTS.fiabilite_justificatifs).toBe(10)
    expect(SCORE_WEIGHTS.gestion_sacs).toBe(5)
    expect(SCORE_WEIGHTS.regularite).toBe(5)
    expect(SCORE_WEIGHTS.maitrise_tcb).toBe(10)
    expect(SCORE_COMPONENT_CODES).toHaveLength(9)
  })
})

describe('resolveMaturity', () => {
  it('classe selon le volume ET la durée d’observation', () => {
    expect(resolveMaturity(0, 0)).toBe('non_evalue')
    expect(resolveMaturity(2, 30)).toBe('non_evalue')
    expect(resolveMaturity(5, 10)).toBe('en_observation')
    expect(resolveMaturity(12, 30)).toBe('provisoire')
    expect(resolveMaturity(30, 60)).toBe('confirme')
  })

  it('refuse de confirmer un pisteur très actif sur une période trop courte', () => {
    // 40 opérations en 5 jours, c'est une pointe de campagne, pas un historique.
    expect(resolveMaturity(40, 5)).toBe('non_evalue')
  })
})

describe('resolveCategory', () => {
  it('applique les seuils de catégorie', () => {
    expect(resolveCategory(92, 'confirme')).toBe('excellent')
    expect(resolveCategory(72, 'confirme')).toBe('fiable')
    expect(resolveCategory(60, 'confirme')).toBe('sous_surveillance')
    expect(resolveCategory(45, 'confirme')).toBe('risque')
    expect(resolveCategory(20, 'confirme')).toBe('critique')
  })

  it('ne prononce aucune catégorie sans maturité suffisante', () => {
    expect(resolveCategory(20, 'non_evalue')).toBe('non_evalue')
    expect(resolveCategory(95, 'non_evalue')).toBe('non_evalue')
    expect(resolveCategory(null, 'confirme')).toBe('non_evalue')
  })
})

describe('computeAgentScore', () => {
  it('calcule une moyenne pondérée sur les neuf composantes', () => {
    const result = computeAgentScore({ components: allComponents(80), ...MATURE })

    expect(result.rawScore).toBe(80)
    expect(result.displayedScore).toBe(80)
    expect(result.category).toBe('fiable')
    expect(result.maturity).toBe('confirme')
    expect(result.unmeasuredComponents).toEqual([])
  })

  it('pondère réellement : une mauvaise composante lourde pèse plus qu’une légère', () => {
    const heavy = computeAgentScore({
      components: SCORE_COMPONENT_CODES.map((component) => ({
        component,
        value: component === 'couverture_avances' ? 0 : 100,
        observationCount: 10,
      })),
      ...MATURE,
    })
    const light = computeAgentScore({
      components: SCORE_COMPONENT_CODES.map((component) => ({
        component,
        value: component === 'gestion_sacs' ? 0 : 100,
        observationCount: 10,
      })),
      ...MATURE,
    })

    expect(heavy.rawScore).toBe(80)
    expect(light.rawScore).toBe(95)
  })

  it('exclut une composante non mesurée au lieu de la noter zéro', () => {
    const result = computeAgentScore({
      components: SCORE_COMPONENT_CODES.map((component) => ({
        component,
        value: component === 'gestion_sacs' ? null : 90,
        observationCount: component === 'gestion_sacs' ? 0 : 10,
      })),
      ...MATURE,
    })

    // Noter zéro la gestion des sacs donnerait 85,5 : le pisteur serait puni
    // pour une dotation qu'il n'a jamais reçue.
    expect(result.rawScore).toBe(90)
    expect(result.unmeasuredComponents).toEqual(['gestion_sacs'])
    expect(result.redistributedWeight).toBe(5)

    const sacs = result.components.find((c) => c.component === 'gestion_sacs')
    expect(sacs?.effectiveWeight).toBe(0)
    expect(sacs?.value).toBeNull()
    expect(sacs?.explanation).toContain('pas notée zéro')
  })

  it('renormalise les poids des composantes mesurées à 100', () => {
    const result = computeAgentScore({
      components: SCORE_COMPONENT_CODES.map((component) => ({
        component,
        value: component === 'gestion_sacs' || component === 'regularite' ? null : 70,
        observationCount: component === 'gestion_sacs' || component === 'regularite' ? 0 : 4,
      })),
      ...MATURE,
    })

    const effectiveTotal = result.components.reduce((total, c) => total + c.effectiveWeight, 0)
    expect(Math.round(effectiveTotal)).toBe(100)
    // Couverture des avances : 20 / 90 × 100 ≈ 22,22.
    expect(result.components.find((c) => c.component === 'couverture_avances')?.effectiveWeight)
      .toBeCloseTo(22.22, 2)
  })

  it('renvoie null et « non évalué » quand aucune composante n’est mesurable', () => {
    const result = computeAgentScore({
      components: SCORE_COMPONENT_CODES.map((component) => ({
        component,
        value: null,
        observationCount: 0,
      })),
      completedOperations: 0,
      activeDays: 0,
    })

    expect(result.rawScore).toBeNull()
    expect(result.displayedScore).toBeNull()
    expect(result.category).toBe('non_evalue')
    expect(result.explanation).toContain('pas encore d’activité évaluable')
  })

  it('distingue score brut et score ajusté par événements externes validés', () => {
    const result = computeAgentScore({
      components: SCORE_COMPONENT_CODES.map((component) => ({
        component,
        value: component === 'respect_delais' ? 40 : 90,
        adjustedValue: component === 'respect_delais' ? 85 : null,
        observationCount: 10,
        excludedEventIds: component === 'respect_delais' ? ['ev1'] : [],
      })),
      externalEvents: [
        {
          id: 'ev1',
          eventType: 'panne_pont_bascule',
          description: 'Pont-bascule hors service deux jours',
          validated: true,
          affectedComponents: ['respect_delais'],
        },
        {
          id: 'ev2',
          eventType: 'pluie',
          description: 'Pluie déclarée mais non validée',
          validated: false,
          affectedComponents: ['respect_delais'],
        },
      ],
      ...MATURE,
    })

    expect(result.rawScore).toBe(82.5)
    expect(result.adjustedScore).toBe(89.25)
    expect(result.appliedEvents.map((event) => event.id)).toEqual(['ev1'])
    expect(result.ignoredEvents.map((event) => event.id)).toEqual(['ev2'])
    expect(result.explanation).toContain('événement(s) externe(s) validé(s)')
  })

  it('conserve le score brut intact malgré un ajustement humain', () => {
    const result = computeAgentScore({
      components: allComponents(60),
      humanAdjustments: [
        { delta: 8, reason: 'Retards imputables au retard de financement du siège', adjustedBy: 'u1' },
      ],
      ...MATURE,
    })

    expect(result.rawScore).toBe(60)
    expect(result.adjustedScore).toBe(60)
    expect(result.displayedScore).toBe(68)
    expect(result.humanAdjustmentTotal).toBe(8)
  })

  it('ignore un ajustement humain non motivé', () => {
    const result = computeAgentScore({
      components: allComponents(60),
      humanAdjustments: [{ delta: 30, reason: 'ok', adjustedBy: 'u1' }],
      ...MATURE,
    })

    expect(result.displayedScore).toBe(60)
    expect(result.humanAdjustmentTotal).toBe(0)
  })

  it('borne le score affiché à [0, 100]', () => {
    const high = computeAgentScore({
      components: allComponents(98),
      humanAdjustments: [
        { delta: 20, reason: 'Campagne exceptionnelle validée par la direction', adjustedBy: 'u1' },
      ],
      ...MATURE,
    })
    expect(high.displayedScore).toBe(100)

    const low = computeAgentScore({
      components: allComponents(10),
      humanAdjustments: [
        { delta: -50, reason: 'Anomalies répétées constatées sur le terrain', adjustedBy: 'u1' },
      ],
      ...MATURE,
    })
    expect(low.displayedScore).toBe(0)
  })

  it('remonte les données sources de chaque composante', () => {
    const result = computeAgentScore({
      components: [
        {
          component: 'couverture_avances',
          value: 75,
          observationCount: 12,
          sourceData: { avances: 12, couvertes: 9 },
        },
      ],
      ...MATURE,
    })

    const component = result.components.find((c) => c.component === 'couverture_avances')
    expect(component?.sourceData).toEqual({ avances: 12, couvertes: 9 })
    expect(component?.observationCount).toBe(12)
    expect(result.rawScore).toBe(75)
  })

  it('reconstitue le score brut par la somme de ses composantes pondérées', () => {
    const result = computeAgentScore({
      components: SCORE_COMPONENT_CODES.map((component, index) => ({
        component,
        value: 40 + index * 5,
        observationCount: 6,
      })),
      ...MATURE,
    })

    const total = result.components.reduce((sum, c) => sum + (c.weightedValue ?? 0), 0)
    expect(Math.abs(total - (result.rawScore ?? 0))).toBeLessThan(0.05)
  })
})

describe('buildRecommendations', () => {
  it('ne produit jamais qu’une proposition soumise à décision humaine', () => {
    for (const value of [95, 75, 60, 30]) {
      const score = computeAgentScore({ components: allComponents(value), ...MATURE })
      const recommendations = buildRecommendations(score, 5_000_000)
      expect(recommendations.length).toBeGreaterThan(0)
      expect(recommendations.every((item) => item.requiresHumanDecision)).toBe(true)
    }
  })

  it('suggère un plafond sans jamais l’appliquer', () => {
    const score = computeAgentScore({ components: allComponents(30), ...MATURE })
    const [first] = buildRecommendations(score, 5_000_000)

    expect(score.category).toBe('critique')
    expect(first?.action).toBe('reduire_plafond')
    expect(first?.suggestedCeiling).toBe(2_000_000)
    expect(first?.rationale).toContain('avant toute décision')
  })

  it('ne recommande rien d’autre que l’observation sans maturité', () => {
    const score = computeAgentScore({
      components: allComponents(20, 2),
      completedOperations: 2,
      activeDays: 3,
    })
    const recommendations = buildRecommendations(score, 5_000_000)

    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]?.action).toBe('aucune_action')
    expect(recommendations[0]?.suggestedCeiling).toBeNull()
  })

  it('propose un contrôle des justificatifs quand la composante est basse', () => {
    const score = computeAgentScore({
      components: SCORE_COMPONENT_CODES.map((component) => ({
        component,
        value: component === 'fiabilite_justificatifs' ? 30 : 90,
        observationCount: 10,
      })),
      ...MATURE,
    })

    expect(buildRecommendations(score, 5_000_000).map((item) => item.action)).toContain(
      'audit_documents',
    )
  })

  it('ne comporte aucun mécanisme de sanction automatique', () => {
    expect(AUTOMATIC_SANCTIONS_ENABLED).toBe(false)
  })
})
