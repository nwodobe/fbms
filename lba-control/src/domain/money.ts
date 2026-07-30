/**
 * Arithmétique monétaire.
 *
 * Le franc CFA n'a pas de sous-unité en usage courant, mais les prix au kilo et
 * les quotes-parts de dépenses indirectes produisent des décimales. Tout est
 * donc calculé en entiers de centièmes puis arrondi une seule fois, à la fin :
 * additionner des flottants sur vingt-cinq achats fait dériver le total de
 * quelques francs, et un total qui ne tombe pas juste détruit la confiance dans
 * l'ensemble du produit.
 */

const SCALE = 100

export type Money = number

/** Arrondi bancaire à deux décimales, insensible aux artefacts de flottant. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Montant non fini : ${value}`)
  }
  return Math.round((value + Number.EPSILON) * SCALE) / SCALE
}

/** Somme d'une liste de montants, arrondie une seule fois. */
export function sum(values: readonly number[]): Money {
  return round2(values.reduce((total, value) => total + value, 0))
}

/** Multiplication poids × prix, arrondie au centième. */
export function multiply(quantity: number, unitPrice: number): Money {
  return round2(quantity * unitPrice)
}

/**
 * Division sûre. Renvoie `null` plutôt que `Infinity` ou `NaN` quand le
 * dénominateur est nul : un TCB par kilo « infini » serait affiché comme une
 * donnée, alors qu'il signifie « pas encore calculable ».
 */
export function divide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null
  }
  return round2(numerator / denominator)
}

/**
 * Répartit un montant selon des pondérations, sans perdre ni créer un franc.
 * Le reliquat d'arrondi est attribué à la part la plus lourde — sinon la somme
 * des quotes-parts diffère du montant réparti, et le TCB total ne se réconcilie
 * plus avec ses composantes.
 */
export function allocate(amount: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) return []

  const totalWeight = weights.reduce((total, weight) => total + weight, 0)
  if (totalWeight <= 0) {
    throw new Error('La clé de répartition doit avoir un total strictement positif.')
  }

  const cents = Math.round(amount * SCALE)
  const shares = weights.map((weight) => Math.floor((cents * weight) / totalWeight))
  let remainder = cents - shares.reduce((total, share) => total + share, 0)

  // Le reliquat est distribué aux plus grosses pondérations, dans l'ordre.
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight)

  let cursor = 0
  while (remainder > 0 && order.length > 0) {
    const target = order[cursor % order.length]
    if (target) {
      shares[target.index] = (shares[target.index] ?? 0) + 1
      remainder -= 1
    }
    cursor += 1
  }

  return shares.map((share) => share / SCALE)
}

const XOF_FORMATTER = new Intl.NumberFormat('fr-FR', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Formatage FCFA. Le montant absent s'affiche « — », jamais « 0 ». */
export function formatMoney(value: number | null | undefined, currency = 'FCFA'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${XOF_FORMATTER.format(Math.round(value))} ${currency}`
}

const WEIGHT_FORMATTER = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

export function formatWeight(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${WEIGHT_FORMATTER.format(value)} kg`
}
