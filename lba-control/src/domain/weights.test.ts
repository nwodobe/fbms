import { describe, expect, it } from 'vitest'
import {
  assessPhysicalVariance,
  assessTareVariation,
  canCloseTransfer,
  checkWeightConsistency,
  computeVariances,
  resolveTolerance,
  valueVariance,
} from './weights'

const weights = {
  netLoadedKg: 8000,
  netUnloadedKg: 7940,
  acceptedKg: 7900,
  paidKg: 7850,
  tareDepartureKg: 14500,
  tareReceptionKg: 14520,
}

describe('les cinq écarts', () => {
  it('calcule les deux formulations sans en arbitrer aucune', () => {
    const variances = computeVariances(weights)

    expect(variances.ecartPhysiqueKg).toBe(60)
    expect(variances.ecartPhysiquePct).toBeCloseTo(0.75, 4)
    // Commande §14 : déchargé − accepté
    expect(variances.ecartAcceptationKg).toBe(40)
    expect(variances.ecartPaiementKg).toBe(50)
    // Cahier des charges §12.3 : chargé − accepté
    expect(variances.ecartTotalAcceptationKg).toBe(100)
    expect(variances.ecartFinancierTotalKg).toBe(150)
    expect(variances.tareVariationKg).toBe(20)
  })

  it('renvoie null tant que la réception n’est pas saisie', () => {
    const variances = computeVariances({
      netLoadedKg: 8000,
      netUnloadedKg: null,
      acceptedKg: null,
      paidKg: null,
    })
    // Un écart non calculable vaut null, jamais zéro : zéro se lirait comme
    // « aucun écart constaté ».
    expect(variances.ecartPhysiqueKg).toBeNull()
    expect(variances.ecartPhysiquePct).toBeNull()
  })

  it('ne divise pas par zéro', () => {
    const variances = computeVariances({
      netLoadedKg: 0,
      netUnloadedKg: 0,
      acceptedKg: null,
      paidKg: null,
    })
    expect(variances.ecartPhysiquePct).toBeNull()
  })

  it('gère un écart négatif sans le masquer', () => {
    const variances = computeVariances({
      netLoadedKg: 7900,
      netUnloadedKg: 8000,
      acceptedKg: null,
      paidKg: null,
    })
    expect(variances.ecartPhysiqueKg).toBe(-100)
  })
})

describe('résolution de la tolérance', () => {
  it('privilégie le contrat', () => {
    const result = resolveTolerance({ contractPct: 0.5, partnerPct: 0.8, tenantPct: 1 })
    expect(result).toEqual({ value: 0.5, source: 'contrat' })
  })

  it('retombe sur la société', () => {
    expect(resolveTolerance({ contractPct: null, partnerPct: 0.8, tenantPct: 1 }).source).toBe('societe')
  })

  it('retombe sur l’entreprise en dernier', () => {
    expect(resolveTolerance({ tenantPct: 1 }).source).toBe('entreprise')
  })

  it('accepte une tolérance de zéro comme une vraie valeur', () => {
    // 0 est un seuil, pas une absence de seuil.
    expect(resolveTolerance({ contractPct: 0, tenantPct: 1 })).toEqual({ value: 0, source: 'contrat' })
  })
})

describe('appréciation d’un écart physique', () => {
  const tolerance = { contractPct: 0.5, tenantPct: 1 }

  it('accepte un écart sous la tolérance', () => {
    const variances = computeVariances({ ...weights, netUnloadedKg: 7990 })
    const result = assessPhysicalVariance(variances, tolerance)
    expect(result.exceedsTolerance).toBe(false)
    expect(result.requiresIncident).toBe(false)
  })

  it('signale une approche du seuil sans crier au loup', () => {
    // 0,4 % pour une tolérance de 0,5 % : à surveiller, pas à sanctionner.
    const variances = computeVariances({ ...weights, netUnloadedKg: 7968 })
    expect(assessPhysicalVariance(variances, tolerance).severity).toBe('surveillance')
  })

  it('déclenche un incident au-delà de la tolérance, avec la mesure et sa source', () => {
    const variances = computeVariances(weights)
    const result = assessPhysicalVariance(variances, tolerance)

    expect(result.exceedsTolerance).toBe(true)
    expect(result.requiresIncident).toBe(true)
    expect(result.severity).toBe('critique')
    expect(result.message).toMatch(/0\.75 %/)
    expect(result.message).toMatch(/tolérance de 0\.5 %/)
    expect(result.message).toMatch(/source : contrat/)
  })

  it('N’IMPUTE JAMAIS l’écart à quiconque', () => {
    const result = assessPhysicalVariance(computeVariances(weights), tolerance)

    // Le résultat propose des causes à examiner. Aucune ne désigne une
    // personne, et le mot « pisteur » n'apparaît nulle part.
    expect(result.possibleCauses.length).toBeGreaterThan(3)
    expect(result.possibleCauses.join(' ').toLowerCase()).not.toContain('pisteur')
    expect(result).not.toHaveProperty('responsible')
    expect(result.possibleCauses.join(' ')).toMatch(/humidité/i)
    expect(result.possibleCauses.join(' ')).toMatch(/pont|étalonnage/i)
  })

  it('n’ouvre pas d’incident formel sur un poids estimé', () => {
    // Accuser sur la foi d'un poids que personne n'a pesé serait indéfendable.
    const result = assessPhysicalVariance(computeVariances(weights), tolerance, 'estimated_bags')
    expect(result.exceedsTolerance).toBe(true)
    expect(result.requiresIncident).toBe(false)
    expect(result.severity).toBe('surveillance')
    expect(result.message).toMatch(/estimation/)
  })

  it('traite un écart négatif en valeur absolue', () => {
    const variances = computeVariances({ ...weights, netUnloadedKg: 8100 })
    expect(assessPhysicalVariance(variances, tolerance).exceedsTolerance).toBe(true)
  })

  it('reste neutre tant que la réception n’est pas saisie', () => {
    const variances = computeVariances({ netLoadedKg: 8000, netUnloadedKg: null, acceptedKg: null, paidKg: null })
    const result = assessPhysicalVariance(variances, tolerance)
    expect(result.exceedsTolerance).toBe(false)
    expect(result.message).toBeNull()
  })
})

describe('tare anormale', () => {
  it('signale une variation supérieure au seuil', () => {
    const variances = computeVariances({ ...weights, tareReceptionKg: 14800 })
    const result = assessTareVariation(variances, 100)
    expect(result.isAbnormal).toBe(true)
    expect(result.message).toMatch(/300 kg/)
    // Elle invite à vérifier les pesées, pas à conclure.
    expect(result.message).toMatch(/Vérifiez les deux pesées/)
  })

  it('ne signale rien sous le seuil', () => {
    expect(assessTareVariation(computeVariances(weights), 100).isAbnormal).toBe(false)
  })

  it('reste silencieuse sans tare de réception', () => {
    const variances = computeVariances({ ...weights, tareReceptionKg: null })
    expect(assessTareVariation(variances, 100).isAbnormal).toBe(false)
  })
})

describe('cohérence des quatre poids', () => {
  it('accepte une chaîne décroissante', () => {
    expect(checkWeightConsistency(weights).valid).toBe(true)
  })

  it('refuse un déchargé supérieur au chargé', () => {
    const result = checkWeightConsistency({ ...weights, netUnloadedKg: 8100 })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/ne s’alourdit pas en route/)
  })

  it('refuse un accepté supérieur au déchargé', () => {
    const result = checkWeightConsistency({ ...weights, acceptedKg: 7999 })
    expect(result.valid).toBe(false)
  })

  it('refuse un payé supérieur à l’accepté', () => {
    const result = checkWeightConsistency({ ...weights, paidKg: 7999 })
    expect(result.valid).toBe(false)
  })

  it('tolère les poids non encore renseignés', () => {
    expect(
      checkWeightConsistency({ netLoadedKg: 8000, netUnloadedKg: null, acceptedKg: null, paidKg: null })
        .valid,
    ).toBe(true)
  })
})

describe('clôture d’un transfert', () => {
  it('refuse tant que la réception est incomplète', () => {
    const result = canCloseTransfer(
      { netLoadedKg: 8000, netUnloadedKg: null, acceptedKg: null, paidKg: null },
      false,
    )
    expect(result.canClose).toBe(false)
    expect(result.reasons).toHaveLength(2)
  })

  it('refuse tant qu’un incident est ouvert', () => {
    const result = canCloseTransfer(weights, true)
    expect(result.canClose).toBe(false)
    expect(result.reasons[0]).toMatch(/incident non résolu/)
  })

  it('autorise une réception complète sans incident', () => {
    expect(canCloseTransfer(weights, false).canClose).toBe(true)
  })
})

describe('valorisation d’un écart', () => {
  it('ne valorise que la part au-delà de la tolérance', () => {
    // 60 kg d'écart, 40 kg tolérés, 450 FCFA/kg → 20 × 450 = 9 000.
    expect(valueVariance(60, 40, 450)).toBe(9000)
  })

  it('vaut zéro si l’écart reste dans la tolérance', () => {
    expect(valueVariance(30, 40, 450)).toBe(0)
  })

  it('renvoie null sans écart calculable', () => {
    expect(valueVariance(null, 40, 450)).toBeNull()
  })
})
