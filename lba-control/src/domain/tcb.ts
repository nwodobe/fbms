/**
 * Total Cost Base — le coût réel d'un kilo acheté.
 *
 * C'est l'indicateur sur lequel le métier décide d'arrêter ou de poursuivre une
 * campagne. Il doit donc être exact, mais surtout **explicable** : un TCB qu'on
 * ne peut pas décomposer jusqu'à la transaction n'est pas un outil de décision,
 * c'est une opinion chiffrée.
 *
 * Quatre règles portent tout le module :
 *
 *  1. **La valeur d'achat vient des achats, jamais d'une dépense.** La commande
 *     impose à la fois la catégorie « achat produit » et la formule
 *     `TCB = valeur_achat + dépenses + …`. Les additionner compterait la
 *     matière deux fois (INC-05). La catégorie existe au référentiel ; elle est
 *     écartée du calcul, avec la raison affichée.
 *
 *  2. **Une avance n'est pas un coût.** Remettre de l'argent à un pisteur est un
 *     mouvement de trésorerie ; le coût naît de l'achat financé par cette
 *     avance. Compter les deux doublerait le TCB des campagnes les plus
 *     financées — précisément celles qu'il faut surveiller.
 *
 *  3. **Validée mais non payée compte quand même.** Une dépense engagée est un
 *     coût, que le virement soit parti ou non. À l'inverse, une dépense rejetée
 *     ou annulée n'entre jamais.
 *
 *  4. **Zéro n'est pas une valeur par défaut.** Sans poids accepté, le TCB par
 *     kilo est `null` : afficher 0 FCFA/kg ferait croire à une opération
 *     gratuite (H-04).
 */

import { multiply, round2, sum, divide, allocate } from './money'

export type ExpenseStatus =
  | 'brouillon'
  | 'soumise'
  | 'validee'
  | 'rejetee'
  | 'payee'
  | 'partiellement_payee'
  | 'annulee'

export type ExpenseNature = 'direct' | 'indirect'

export type AllocationKey =
  | 'poids_accepte'
  | 'valeur_achat'
  | 'nb_livraisons'
  | 'nb_sacs'
  | 'jours_stockage'
  | 'manuel'

export type AllocationTargetType =
  | 'partner'
  | 'campaign'
  | 'contract'
  | 'field_agent'
  | 'lot'
  | 'transfer'

/**
 * Statuts de dépense qui entrent au TCB.
 *
 * `partiellement_payee` compte pour son montant engagé, pas pour la fraction
 * déjà décaissée : le reste dû est un coût, pas une économie.
 */
export const TCB_ELIGIBLE_EXPENSE_STATUSES: readonly ExpenseStatus[] = [
  'validee',
  'payee',
  'partiellement_payee',
]

/** Catégorie dont le montant est déjà porté par `purchases` (INC-05). */
export const PURCHASE_VALUE_CATEGORY_CODE = 'achat_produit'

export interface TcbExpense {
  id: string
  categoryCode: string
  categoryLabel: string
  family: string
  nature: ExpenseNature
  status: ExpenseStatus
  /** Montant engagé, en FCFA. */
  amount: number
  isControllableByAgent?: boolean
}

/** Quote-part d'une charge indirecte déjà répartie sur le périmètre calculé. */
export interface AllocatedShare {
  id: string
  expenseId: string
  categoryLabel: string
  allocationKey: AllocationKey
  allocatedAmount: number
}

/** Perte physique valorisée au prix retenu par l'arbitrage D2. */
export interface ValuedLoss {
  id: string
  label: string
  quantityKg: number
  unitPrice: number
}

export interface TcbInputs {
  /** Somme des achats validés du périmètre. Vient de `purchases`, exclusivement. */
  purchaseValue: number
  expenses: readonly TcbExpense[]
  allocatedShares?: readonly AllocatedShare[]
  valuedLosses?: readonly ValuedLoss[]
  /** Dénominateur du TCB par kilo. `null` tant qu'aucune réception n'est acceptée. */
  acceptedWeightKg: number | null
}

export type ExclusionReason =
  | 'statut_non_eligible'
  | 'deja_dans_valeur_achat'
  | 'charge_indirecte_repartie'

export interface ExcludedExpense {
  id: string
  categoryLabel: string
  amount: number
  reason: ExclusionReason
  explanation: string
}

export interface TcbComponent {
  code: string
  label: string
  amount: number
  amountPerKg: number | null
  sourceCount: number
  sourceIds: string[]
}

export interface TcbResult {
  purchaseValue: number
  directExpenses: number
  indirectAllocated: number
  valuedLosses: number
  tcbTotal: number
  /** `null` — et non 0 — quand le poids accepté est absent ou nul (H-04). */
  tcbPerAcceptedKg: number | null
  acceptedWeightKg: number | null
  components: TcbComponent[]
  excluded: ExcludedExpense[]
  /** Part du TCB que le pisteur maîtrise réellement (base du score, D6). */
  controllableExpenses: number
}

const EXCLUSION_EXPLANATIONS: Record<ExclusionReason, string> = {
  statut_non_eligible:
    'Dépense non validée, rejetée ou annulée : elle n’engage pas encore — ou plus — l’entreprise.',
  deja_dans_valeur_achat:
    'La valeur d’achat provient des achats ; la reprendre ici compterait la matière deux fois.',
  charge_indirecte_repartie:
    'Charge indirecte : elle entre au TCB par sa quote-part répartie, pas par son montant total.',
}

function isEligible(status: ExpenseStatus): boolean {
  return TCB_ELIGIBLE_EXPENSE_STATUSES.includes(status)
}

/**
 * Calcule le TCB d'un périmètre et sa décomposition.
 *
 * Les dépenses écartées sont retournées avec leur motif : une somme qui ne
 * correspond pas à ce que l'utilisateur a saisi doit pouvoir s'expliquer sans
 * ouvrir la base.
 */
export function computeTcb(inputs: TcbInputs): TcbResult {
  const excluded: ExcludedExpense[] = []
  const retained: TcbExpense[] = []

  for (const expense of inputs.expenses) {
    let reason: ExclusionReason | null = null

    if (!isEligible(expense.status)) {
      reason = 'statut_non_eligible'
    } else if (expense.categoryCode === PURCHASE_VALUE_CATEGORY_CODE) {
      reason = 'deja_dans_valeur_achat'
    } else if (expense.nature === 'indirect') {
      reason = 'charge_indirecte_repartie'
    }

    if (reason) {
      excluded.push({
        id: expense.id,
        categoryLabel: expense.categoryLabel,
        amount: expense.amount,
        reason,
        explanation: EXCLUSION_EXPLANATIONS[reason],
      })
    } else {
      retained.push(expense)
    }
  }

  const shares = inputs.allocatedShares ?? []
  const losses = inputs.valuedLosses ?? []

  const directExpenses = sum(retained.map((expense) => expense.amount))
  const indirectAllocated = sum(shares.map((share) => share.allocatedAmount))
  const lossAmounts = losses.map((loss) => multiply(loss.quantityKg, loss.unitPrice))
  const valuedLosses = sum(lossAmounts)

  const purchaseValue = round2(inputs.purchaseValue)
  const tcbTotal = sum([purchaseValue, directExpenses, indirectAllocated, valuedLosses])

  const acceptedWeightKg =
    inputs.acceptedWeightKg !== null && inputs.acceptedWeightKg > 0 ? inputs.acceptedWeightKg : null

  const perKg = (amount: number): number | null =>
    acceptedWeightKg === null ? null : divide(amount, acceptedWeightKg)

  const components: TcbComponent[] = []

  components.push({
    code: 'valeur_achat',
    label: 'Valeur d’achat',
    amount: purchaseValue,
    amountPerKg: perKg(purchaseValue),
    sourceCount: purchaseValue > 0 ? 1 : 0,
    sourceIds: [],
  })

  // Une famille de dépenses par ligne : le métier raisonne en « transport »,
  // « manutention », « qualité », pas en identifiants de catégorie.
  const families = new Map<string, TcbExpense[]>()
  for (const expense of retained) {
    const bucket = families.get(expense.family)
    if (bucket) bucket.push(expense)
    else families.set(expense.family, [expense])
  }

  for (const [family, items] of [...families.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr'))) {
    const amount = sum(items.map((item) => item.amount))
    components.push({
      code: `depenses:${family}`,
      label: family,
      amount,
      amountPerKg: perKg(amount),
      sourceCount: items.length,
      sourceIds: items.map((item) => item.id),
    })
  }

  if (shares.length > 0) {
    components.push({
      code: 'charges_indirectes',
      label: 'Charges indirectes imputées',
      amount: indirectAllocated,
      amountPerKg: perKg(indirectAllocated),
      sourceCount: shares.length,
      sourceIds: shares.map((share) => share.id),
    })
  }

  if (losses.length > 0) {
    components.push({
      code: 'pertes_valorisees',
      label: 'Pertes valorisées',
      amount: valuedLosses,
      amountPerKg: perKg(valuedLosses),
      sourceCount: losses.length,
      sourceIds: losses.map((loss) => loss.id),
    })
  }

  const controllableExpenses = sum(
    retained.filter((expense) => expense.isControllableByAgent === true).map((e) => e.amount),
  )

  return {
    purchaseValue,
    directExpenses,
    indirectAllocated,
    valuedLosses,
    tcbTotal,
    tcbPerAcceptedKg: perKg(tcbTotal),
    acceptedWeightKg,
    components,
    excluded,
    controllableExpenses,
  }
}

/**
 * Vérifie que la décomposition affichée reconstitue bien le total.
 *
 * Un écart ici signifie qu'une composante a été oubliée dans l'affichage : le
 * chiffre resterait juste, mais l'explication serait fausse — ce qui est pire,
 * parce qu'invisible.
 */
export function componentsReconcile(result: TcbResult): boolean {
  const total = sum(result.components.map((component) => component.amount))
  return Math.abs(total - result.tcbTotal) < 0.01
}

// ---------------------------------------------------------------------------
// Répartition des charges indirectes
// ---------------------------------------------------------------------------

export interface AllocationBase {
  targetType: AllocationTargetType
  targetId: string
  targetLabel: string
  /** Valeur de la clé pour cette cible : kilos, francs, nombre de livraisons… */
  baseValue: number
}

export interface AllocationLine extends AllocationBase {
  allocationKey: AllocationKey
  totalBaseValue: number
  shareRatio: number
  allocatedAmount: number
  isManual: boolean
}

export type AllocationOutcome =
  | { status: 'reparti'; lines: AllocationLine[] }
  | { status: 'impossible'; reason: string }

export const ALLOCATION_KEY_LABELS: Record<AllocationKey, string> = {
  poids_accepte: 'Poids accepté',
  valeur_achat: 'Valeur d’achat',
  nb_livraisons: 'Nombre de livraisons',
  nb_sacs: 'Nombre de sacs',
  jours_stockage: 'Jours de stockage',
  manuel: 'Répartition manuelle',
}

function ratio(value: number, total: number): number {
  return Math.round((value / total) * 1e8) / 1e8
}

/**
 * Répartit une charge indirecte selon une clé.
 *
 * Renvoie explicitement `impossible` quand la clé ne porte aucune valeur —
 * répartir 400 000 FCFA de gardiennage sur un poids accepté nul produirait des
 * quotes-parts nulles et ferait disparaître la charge du TCB.
 */
export function allocateIndirectExpense(
  amount: number,
  key: AllocationKey,
  targets: readonly AllocationBase[],
): AllocationOutcome {
  if (key === 'manuel') {
    return {
      status: 'impossible',
      reason:
        'La clé manuelle n’est pas calculable : elle exige une répartition saisie, motivée et approuvée.',
    }
  }

  if (targets.length === 0) {
    return { status: 'impossible', reason: 'Aucune cible de répartition sur ce périmètre.' }
  }

  if (targets.some((target) => target.baseValue < 0)) {
    return { status: 'impossible', reason: 'Une valeur de clé négative n’a pas de sens métier.' }
  }

  const totalBaseValue = targets.reduce((total, target) => total + target.baseValue, 0)
  if (totalBaseValue <= 0) {
    return {
      status: 'impossible',
      reason: `La clé « ${ALLOCATION_KEY_LABELS[key]} » vaut zéro sur ce périmètre : la charge ne peut pas être imputée sans la faire disparaître.`,
    }
  }

  const amounts = allocate(round2(amount), targets.map((target) => target.baseValue))

  return {
    status: 'reparti',
    lines: targets.map((target, index) => ({
      ...target,
      allocationKey: key,
      totalBaseValue,
      shareRatio: ratio(target.baseValue, totalBaseValue),
      allocatedAmount: amounts[index] ?? 0,
      isManual: false,
    })),
  }
}

export interface ManualAllocationInput extends AllocationBase {
  allocatedAmount: number
}

/**
 * Contrôle une répartition manuelle : la somme des quotes-parts doit rendre le
 * montant exact, au franc près. Une répartition qui ne boucle pas laisserait
 * une charge partiellement imputée, invisible dans les deux périmètres.
 */
export function validateManualAllocation(
  amount: number,
  lines: readonly ManualAllocationInput[],
): { valid: true; lines: AllocationLine[] } | { valid: false; reason: string } {
  if (lines.length === 0) {
    return { valid: false, reason: 'Aucune quote-part saisie.' }
  }
  if (lines.some((line) => line.allocatedAmount < 0)) {
    return { valid: false, reason: 'Une quote-part négative n’est pas une répartition.' }
  }

  const total = sum(lines.map((line) => line.allocatedAmount))
  const target = round2(amount)
  if (Math.abs(total - target) >= 0.01) {
    return {
      valid: false,
      reason: `La somme des quotes-parts (${total}) ne rend pas le montant réparti (${target}).`,
    }
  }

  return {
    valid: true,
    lines: lines.map((line) => ({
      ...line,
      allocationKey: 'manuel',
      totalBaseValue: target,
      shareRatio: target > 0 ? ratio(line.allocatedAmount, target) : 0,
      isManual: true,
    })),
  }
}
