import { describe, expect, it } from 'vitest'
import { checkAdvanceCapacity, isOverrideValid, theoreticalVolumeKg, type AdvanceCheckInput } from './advances'

const base: AdvanceCheckInput = {
  amount: 1_000_000,
  currentExposure: 0,
  globalCeiling: 5_000_000,
  partnerExposure: 0,
  partnerCeiling: 3_000_000,
  oldestOutstandingAgeDays: 0,
  overdueBlockDays: 7,
  agentStatus: 'actif',
  isPartnerAuthorized: true,
  fundingAvailable: null,
}

describe('contrôle de capacité d’une avance', () => {
  it('autorise une avance dans les limites', () => {
    const result = checkAdvanceCapacity(base)
    expect(result.canProceed).toBe(true)
    expect(result.requiresOverride).toBe(false)
  })

  it('bloque un dépassement de plafond global, avec les montants', () => {
    const result = checkAdvanceCapacity({ ...base, currentExposure: 4_500_000 })
    expect(result.canProceed).toBe(false)
    expect(result.requiresOverride).toBe(true)

    const item = result.items.find((i) => i.reason === 'plafond_global_depasse')!
    expect(item.measured).toBe(5_500_000)
    expect(item.threshold).toBe(5_000_000)
    // Le message doit porter les chiffres : sans eux, l'utilisateur ne sait pas
    // de combien réduire.
    expect(item.message).toMatch(/5\s?500\s?000 FCFA/)
  })

  it('bloque un dépassement de plafond par société', () => {
    const result = checkAdvanceCapacity({ ...base, partnerExposure: 2_500_000 })
    expect(result.items.some((i) => i.reason === 'plafond_societe_depasse')).toBe(true)
    expect(result.requiresOverride).toBe(true)
  })

  it('accepte exactement le plafond', () => {
    const result = checkAdvanceCapacity({ ...base, currentExposure: 4_000_000 })
    expect(result.canProceed).toBe(true)
  })

  it('bloque une nouvelle avance si un reliquat est trop ancien', () => {
    const result = checkAdvanceCapacity({ ...base, oldestOutstandingAgeDays: 12 })
    expect(result.canProceed).toBe(false)
    expect(result.requiresOverride).toBe(true)
    expect(result.items.find((i) => i.reason === 'avance_ancienne_non_couverte')!.message).toMatch(/12 jours/)
  })

  it('informe sans bloquer sous le seuil', () => {
    const result = checkAdvanceCapacity({ ...base, oldestOutstandingAgeDays: 3 })
    expect(result.canProceed).toBe(true)
    expect(result.items.find((i) => i.reason === 'avance_ancienne_non_couverte')!.severity).toBe('info')
  })

  it('bloque définitivement pour un pisteur suspendu', () => {
    const result = checkAdvanceCapacity({ ...base, agentStatus: 'suspendu' })
    expect(result.canProceed).toBe(false)
    // Une suspension est une décision déjà prise : aucune dérogation ne la lève.
    expect(result.requiresOverride).toBe(false)
    expect(result.hardBlocks).toHaveLength(1)
  })

  it('bloque définitivement pour une société non autorisée', () => {
    const result = checkAdvanceCapacity({ ...base, isPartnerAuthorized: false })
    expect(result.requiresOverride).toBe(false)
    expect(result.hardBlocks[0]!.reason).toBe('societe_non_autorisee')
  })

  it('bloque si le financement source est insuffisant', () => {
    const result = checkAdvanceCapacity({ ...base, fundingAvailable: 400_000 })
    expect(result.canProceed).toBe(false)
    expect(result.items.some((i) => i.reason === 'financement_insuffisant')).toBe(true)
  })

  it('ignore les plafonds non définis', () => {
    const result = checkAdvanceCapacity({
      ...base,
      globalCeiling: null,
      partnerCeiling: null,
      amount: 999_000_000,
    })
    expect(result.canProceed).toBe(true)
  })

  it('ne produit jamais de sanction, seulement des constats', () => {
    const result = checkAdvanceCapacity({
      ...base,
      currentExposure: 9_000_000,
      oldestOutstandingAgeDays: 40,
    })
    // Le résultat décrit et bloque le décaissement ; il ne suspend pas le
    // pisteur et ne retient rien sur sa commission.
    expect(result.canProceed).toBe(false)
    expect(result.requiresOverride).toBe(true)
    expect(Object.keys(result)).toEqual(['items', 'canProceed', 'requiresOverride', 'hardBlocks'])
  })
})

describe('validité d’une dérogation', () => {
  it('exige un approbateur', () => {
    expect(isOverrideValid('Motif suffisamment explicite', null, 'u1').valid).toBe(false)
  })

  it('exige un motif explicite', () => {
    expect(isOverrideValid('ok', 'u2', 'u1').valid).toBe(false)
  })

  it('refuse l’auto-approbation', () => {
    const result = isOverrideValid('Campagne exceptionnelle validée', 'u1', 'u1')
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/ne peut pas approuver sa propre/)
  })

  it('accepte une dérogation motivée et approuvée par un tiers', () => {
    expect(isOverrideValid('Dépassement autorisé par la direction', 'u2', 'u1').valid).toBe(true)
  })
})

describe('volume théorique financé', () => {
  it('divise le montant par le prix de référence', () => {
    expect(theoreticalVolumeKg(20_000_000, 450)).toBeCloseTo(44_444.444, 3)
  })

  it('renvoie null sans prix de référence', () => {
    expect(theoreticalVolumeKg(20_000_000, null)).toBeNull()
    expect(theoreticalVolumeKg(20_000_000, 0)).toBeNull()
  })
})
