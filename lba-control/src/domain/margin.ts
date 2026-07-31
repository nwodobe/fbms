/**
 * Prix de vente net, marges et écart de réconciliation.
 *
 * La commande définit deux marges qui ne se déduisent pas l'une de l'autre :
 *
 *   marge_totale  = chiffre_affaires_net − TCB_total
 *   marge_par_kg  = prix_vente_net − TCB_par_kg_accepté
 *
 * `marge_par_kg × poids_accepté` n'égale `marge_totale` que si le chiffre
 * d'affaires porte exactement sur le poids accepté. Une retenue forfaitaire, un
 * avoir ou une pénalité non proportionnelle suffit à les séparer — sans que ce
 * soit une erreur (INC-06).
 *
 * Le module calcule donc les deux **et leur écart**, et ne présente jamais l'un
 * comme dérivé de l'autre. L'écart est un point de contrôle : quand il grandit
 * sans explication, c'est la facturation qu'il faut regarder, pas le calcul.
 */

import { divide, multiply, round2, sum } from './money'

export interface PriceAdjustment {
  code: string
  label: string
  /** Montant par kilo, toujours positif : le sens est porté par la catégorie. */
  amountPerKg: number
}

export interface NetSalePriceInputs {
  negotiatedPrice: number
  premiums?: readonly PriceAdjustment[]
  penalties?: readonly PriceAdjustment[]
  withholdings?: readonly PriceAdjustment[]
}

export interface NetSalePriceBreakdownLine {
  code: string
  label: string
  /** Signé : ce qui s'ajoute est positif, ce qui se retire est négatif. */
  signedAmountPerKg: number
}

export interface NetSalePriceResult {
  negotiatedPrice: number
  premiumsTotal: number
  penaltiesTotal: number
  withholdingsTotal: number
  netSalePrice: number
  breakdown: NetSalePriceBreakdownLine[]
  /** Vrai si les retenues dépassent le prix : signal d'anomalie de saisie. */
  isNegative: boolean
}

/** `prix_vente_net = prix_négocié + primes − pénalités − retenues`. */
export function computeNetSalePrice(inputs: NetSalePriceInputs): NetSalePriceResult {
  const premiums = inputs.premiums ?? []
  const penalties = inputs.penalties ?? []
  const withholdings = inputs.withholdings ?? []

  const premiumsTotal = sum(premiums.map((item) => item.amountPerKg))
  const penaltiesTotal = sum(penalties.map((item) => item.amountPerKg))
  const withholdingsTotal = sum(withholdings.map((item) => item.amountPerKg))

  const netSalePrice = round2(
    inputs.negotiatedPrice + premiumsTotal - penaltiesTotal - withholdingsTotal,
  )

  const breakdown: NetSalePriceBreakdownLine[] = [
    { code: 'prix_negocie', label: 'Prix négocié', signedAmountPerKg: round2(inputs.negotiatedPrice) },
    ...premiums.map((item) => ({
      code: item.code,
      label: item.label,
      signedAmountPerKg: round2(item.amountPerKg),
    })),
    ...penalties.map((item) => ({
      code: item.code,
      label: item.label,
      signedAmountPerKg: round2(-item.amountPerKg),
    })),
    ...withholdings.map((item) => ({
      code: item.code,
      label: item.label,
      signedAmountPerKg: round2(-item.amountPerKg),
    })),
  ]

  return {
    negotiatedPrice: round2(inputs.negotiatedPrice),
    premiumsTotal,
    penaltiesTotal,
    withholdingsTotal,
    netSalePrice,
    breakdown,
    isNegative: netSalePrice < 0,
  }
}

// ---------------------------------------------------------------------------
// Marges
// ---------------------------------------------------------------------------

export interface MarginInputs {
  /** Chiffre d'affaires net réellement facturé sur le périmètre. */
  netRevenue: number | null
  /** Prix de vente net par kilo, issu de `computeNetSalePrice`. */
  netSalePricePerKg: number | null
  tcbTotal: number
  tcbPerAcceptedKg: number | null
  acceptedWeightKg: number | null
}

export interface MarginResult {
  marginTotal: number | null
  marginPerKg: number | null
  /** `marge_par_kg × poids_accepté` : la marge que la vue au kilo laisse attendre. */
  impliedMarginFromPerKg: number | null
  /** Écart assumé entre les deux définitions (INC-06). `null` si incalculable. */
  reconciliationGap: number | null
  marginRate: number | null
  isDeficit: boolean | null
  /** Phrase affichable expliquant ce que le calcul a pu, ou n'a pas pu, faire. */
  explanation: string
}

export function computeMargin(inputs: MarginInputs): MarginResult {
  const acceptedWeightKg =
    inputs.acceptedWeightKg !== null && inputs.acceptedWeightKg > 0 ? inputs.acceptedWeightKg : null

  const marginTotal =
    inputs.netRevenue === null ? null : round2(inputs.netRevenue - inputs.tcbTotal)

  const marginPerKg =
    inputs.netSalePricePerKg === null || inputs.tcbPerAcceptedKg === null
      ? null
      : round2(inputs.netSalePricePerKg - inputs.tcbPerAcceptedKg)

  const impliedMarginFromPerKg =
    marginPerKg === null || acceptedWeightKg === null ? null : multiply(acceptedWeightKg, marginPerKg)

  const reconciliationGap =
    marginTotal === null || impliedMarginFromPerKg === null
      ? null
      : round2(marginTotal - impliedMarginFromPerKg)

  const marginRate =
    marginTotal === null || inputs.netRevenue === null || inputs.netRevenue === 0
      ? null
      : divide(marginTotal * 100, inputs.netRevenue)

  return {
    marginTotal,
    marginPerKg,
    impliedMarginFromPerKg,
    reconciliationGap,
    marginRate,
    isDeficit: marginTotal === null ? null : marginTotal < 0,
    explanation: explain({ marginTotal, marginPerKg, reconciliationGap, acceptedWeightKg }),
  }
}

function explain(state: {
  marginTotal: number | null
  marginPerKg: number | null
  reconciliationGap: number | null
  acceptedWeightKg: number | null
}): string {
  if (state.marginTotal === null && state.marginPerKg === null) {
    return 'Marge non calculable : ni chiffre d’affaires net ni prix de vente net ne sont renseignés.'
  }
  if (state.acceptedWeightKg === null) {
    return 'Marge au kilo non calculable : aucun poids accepté sur ce périmètre.'
  }
  if (state.marginTotal === null) {
    return 'Marge totale non calculable : le chiffre d’affaires net n’est pas encore facturé.'
  }
  if (state.marginPerKg === null) {
    return 'Marge au kilo non calculable : le prix de vente net n’est pas renseigné.'
  }
  if (state.reconciliationGap !== null && Math.abs(state.reconciliationGap) >= 1) {
    return (
      'Les deux marges divergent : le chiffre d’affaires net ne porte pas exactement sur le poids ' +
      'accepté (avoir, retenue forfaitaire ou pénalité non proportionnelle). L’écart est affiché tel quel.'
    )
  }
  return 'Les deux marges se réconcilient.'
}

// ---------------------------------------------------------------------------
// Signaux de destruction de marge
// ---------------------------------------------------------------------------

export type MarginSignalCode =
  | 'tcb_superieur_prix_net'
  | 'marge_inferieure_seuil'
  | 'ecart_reconciliation_important'

export interface MarginSignal {
  code: MarginSignalCode
  message: string
  measuredValue: number
  thresholdValue: number
}

export interface MarginThresholds {
  /** Marge minimale par kilo attendue, en FCFA. */
  minMarginPerKg: number
  /** Écart de réconciliation au-delà duquel la facturation doit être vérifiée. */
  maxReconciliationGap: number
}

export const DEFAULT_MARGIN_THRESHOLDS: MarginThresholds = {
  minMarginPerKg: 0,
  maxReconciliationGap: 100_000,
}

/**
 * Détecte les conditions d'alerte liées à la marge.
 *
 * Ne prend aucune décision : produit des constats chiffrés, avec la valeur
 * mesurée et le seuil, pour que le lecteur puisse contester l'un ou l'autre.
 */
export function detectMarginSignals(
  margin: MarginResult,
  tcbPerAcceptedKg: number | null,
  netSalePricePerKg: number | null,
  thresholds: MarginThresholds = DEFAULT_MARGIN_THRESHOLDS,
): MarginSignal[] {
  const signals: MarginSignal[] = []

  if (tcbPerAcceptedKg !== null && netSalePricePerKg !== null && tcbPerAcceptedKg > netSalePricePerKg) {
    signals.push({
      code: 'tcb_superieur_prix_net',
      message: 'Le coût de revient au kilo dépasse le prix de vente net : chaque kilo livré perd de l’argent.',
      measuredValue: tcbPerAcceptedKg,
      thresholdValue: netSalePricePerKg,
    })
  }

  if (margin.marginPerKg !== null && margin.marginPerKg < thresholds.minMarginPerKg) {
    signals.push({
      code: 'marge_inferieure_seuil',
      message: `Marge au kilo inférieure au seuil configuré (${thresholds.minMarginPerKg} FCFA/kg).`,
      measuredValue: margin.marginPerKg,
      thresholdValue: thresholds.minMarginPerKg,
    })
  }

  if (
    margin.reconciliationGap !== null &&
    Math.abs(margin.reconciliationGap) > thresholds.maxReconciliationGap
  ) {
    signals.push({
      code: 'ecart_reconciliation_important',
      message:
        'Les deux définitions de marge divergent fortement : la facturation ne porte pas sur le poids accepté.',
      measuredValue: Math.abs(margin.reconciliationGap),
      thresholdValue: thresholds.maxReconciliationGap,
    })
  }

  return signals
}
