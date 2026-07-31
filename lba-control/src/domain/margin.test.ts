import { describe, expect, it } from 'vitest'
import {
  computeMargin,
  computeNetSalePrice,
  detectMarginSignals,
  DEFAULT_MARGIN_THRESHOLDS,
} from './margin'

describe('computeNetSalePrice', () => {
  it('applique primes, pénalités et retenues au prix négocié', () => {
    const result = computeNetSalePrice({
      negotiatedPrice: 500,
      premiums: [{ code: 'kor', label: 'Prime KOR', amountPerKg: 25 }],
      penalties: [{ code: 'humidite', label: 'Pénalité humidité', amountPerKg: 12 }],
      withholdings: [{ code: 'retenue_qualite', label: 'Retenue qualité', amountPerKg: 8 }],
    })

    expect(result.netSalePrice).toBe(505)
    expect(result.premiumsTotal).toBe(25)
    expect(result.penaltiesTotal).toBe(12)
    expect(result.withholdingsTotal).toBe(8)
  })

  it('affiche chaque ligne avec son signe pour que le net soit vérifiable à la main', () => {
    const result = computeNetSalePrice({
      negotiatedPrice: 500,
      premiums: [{ code: 'kor', label: 'Prime KOR', amountPerKg: 25 }],
      penalties: [{ code: 'humidite', label: 'Pénalité humidité', amountPerKg: 12 }],
    })

    expect(result.breakdown.map((line) => line.signedAmountPerKg)).toEqual([500, 25, -12])
    expect(result.breakdown.reduce((total, line) => total + line.signedAmountPerKg, 0)).toBe(
      result.netSalePrice,
    )
  })

  it('signale un prix net négatif au lieu de le ramener à zéro', () => {
    const result = computeNetSalePrice({
      negotiatedPrice: 100,
      penalties: [{ code: 'p', label: 'Pénalité', amountPerKg: 150 }],
    })

    expect(result.netSalePrice).toBe(-50)
    expect(result.isNegative).toBe(true)
  })

  it('fonctionne sans aucun ajustement', () => {
    expect(computeNetSalePrice({ negotiatedPrice: 480 }).netSalePrice).toBe(480)
  })
})

describe('computeMargin', () => {
  it('calcule les deux marges et un écart nul quand la facturation porte sur le poids accepté', () => {
    const result = computeMargin({
      netRevenue: 4_000_000,
      netSalePricePerKg: 500,
      tcbTotal: 3_930_000,
      tcbPerAcceptedKg: 491.25,
      acceptedWeightKg: 8_000,
    })

    expect(result.marginTotal).toBe(70_000)
    expect(result.marginPerKg).toBe(8.75)
    expect(result.impliedMarginFromPerKg).toBe(70_000)
    expect(result.reconciliationGap).toBe(0)
    expect(result.explanation).toContain('se réconcilient')
  })

  it('conserve l’écart de réconciliation sans le corriger (INC-06)', () => {
    // Une retenue forfaitaire de 150 000 hors prix au kilo : les deux marges
    // divergent, et c'est une information, pas une erreur de calcul.
    const result = computeMargin({
      netRevenue: 3_850_000,
      netSalePricePerKg: 500,
      tcbTotal: 3_930_000,
      tcbPerAcceptedKg: 491.25,
      acceptedWeightKg: 8_000,
    })

    expect(result.marginTotal).toBe(-80_000)
    expect(result.impliedMarginFromPerKg).toBe(70_000)
    expect(result.reconciliationGap).toBe(-150_000)
    expect(result.isDeficit).toBe(true)
    expect(result.explanation).toContain('divergent')
  })

  it('ne présente jamais une marge comme dérivée de l’autre', () => {
    const result = computeMargin({
      netRevenue: 1_000_000,
      netSalePricePerKg: 500,
      tcbTotal: 900_000,
      tcbPerAcceptedKg: 450,
      acceptedWeightKg: 2_000,
    })

    // marge_par_kg × poids = 100 000 = marge_totale ici, mais les deux sont
    // calculées séparément : l'égalité est constatée, jamais imposée.
    expect(result.marginTotal).toBe(100_000)
    expect(result.impliedMarginFromPerKg).toBe(100_000)
    expect(result.reconciliationGap).toBe(0)
  })

  it('renvoie null plutôt qu’un zéro trompeur quand une donnée manque', () => {
    const noRevenue = computeMargin({
      netRevenue: null,
      netSalePricePerKg: 500,
      tcbTotal: 900_000,
      tcbPerAcceptedKg: 450,
      acceptedWeightKg: 2_000,
    })
    expect(noRevenue.marginTotal).toBeNull()
    expect(noRevenue.marginPerKg).toBe(50)
    expect(noRevenue.reconciliationGap).toBeNull()
    expect(noRevenue.explanation).toContain('chiffre d’affaires net')

    const noWeight = computeMargin({
      netRevenue: 1_000_000,
      netSalePricePerKg: 500,
      tcbTotal: 900_000,
      tcbPerAcceptedKg: null,
      acceptedWeightKg: 0,
    })
    expect(noWeight.marginPerKg).toBeNull()
    expect(noWeight.marginTotal).toBe(100_000)
    expect(noWeight.explanation).toContain('aucun poids accepté')

    const nothing = computeMargin({
      netRevenue: null,
      netSalePricePerKg: null,
      tcbTotal: 0,
      tcbPerAcceptedKg: null,
      acceptedWeightKg: null,
    })
    expect(nothing.isDeficit).toBeNull()
    expect(nothing.explanation).toContain('non calculable')
  })

  it('calcule un taux de marge, et l’omet quand le chiffre d’affaires est nul', () => {
    expect(
      computeMargin({
        netRevenue: 1_000_000,
        netSalePricePerKg: null,
        tcbTotal: 800_000,
        tcbPerAcceptedKg: null,
        acceptedWeightKg: null,
      }).marginRate,
    ).toBe(20)

    expect(
      computeMargin({
        netRevenue: 0,
        netSalePricePerKg: null,
        tcbTotal: 800_000,
        tcbPerAcceptedKg: null,
        acceptedWeightKg: null,
      }).marginRate,
    ).toBeNull()
  })
})

describe('detectMarginSignals', () => {
  it('signale un coût de revient supérieur au prix de vente net', () => {
    const margin = computeMargin({
      netRevenue: 900_000,
      netSalePricePerKg: 450,
      tcbTotal: 1_000_000,
      tcbPerAcceptedKg: 500,
      acceptedWeightKg: 2_000,
    })

    const signals = detectMarginSignals(margin, 500, 450)
    expect(signals.map((signal) => signal.code)).toContain('tcb_superieur_prix_net')
    const signal = signals.find((item) => item.code === 'tcb_superieur_prix_net')
    expect(signal?.measuredValue).toBe(500)
    expect(signal?.thresholdValue).toBe(450)
  })

  it('signale une marge sous le seuil configuré', () => {
    const margin = computeMargin({
      netRevenue: 1_010_000,
      netSalePricePerKg: 505,
      tcbTotal: 1_000_000,
      tcbPerAcceptedKg: 500,
      acceptedWeightKg: 2_000,
    })

    expect(detectMarginSignals(margin, 500, 505, { ...DEFAULT_MARGIN_THRESHOLDS, minMarginPerKg: 10 })
      .map((signal) => signal.code)).toContain('marge_inferieure_seuil')

    expect(detectMarginSignals(margin, 500, 505).map((signal) => signal.code)).not.toContain(
      'marge_inferieure_seuil',
    )
  })

  it('signale un écart de réconciliation anormalement grand', () => {
    const margin = computeMargin({
      netRevenue: 3_000_000,
      netSalePricePerKg: 500,
      tcbTotal: 3_930_000,
      tcbPerAcceptedKg: 491.25,
      acceptedWeightKg: 8_000,
    })

    expect(margin.reconciliationGap).toBe(-1_000_000)
    expect(detectMarginSignals(margin, 491.25, 500).map((signal) => signal.code)).toContain(
      'ecart_reconciliation_important',
    )
  })

  it('ne signale rien sur une opération saine', () => {
    const margin = computeMargin({
      netRevenue: 4_000_000,
      netSalePricePerKg: 500,
      tcbTotal: 3_500_000,
      tcbPerAcceptedKg: 437.5,
      acceptedWeightKg: 8_000,
    })

    expect(detectMarginSignals(margin, 437.5, 500)).toEqual([])
  })
})
