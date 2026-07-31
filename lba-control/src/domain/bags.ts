/**
 * Sacherie.
 *
 * Un sac vaut peu ; deux mille sacs perdus valent une campagne. C'est le poste
 * où les pertes passent le plus facilement inaperçues, parce que personne ne
 * les compte au moment où elles se produisent.
 *
 * Trois principes tenus ici :
 *
 *  1. **Un mouvement a une origine et une destination, pas un signe.** Poser
 *     « quantité négative = sortie » oblige chaque lecteur à deviner de quel
 *     stock. Ici, chaque mouvement dit d'où et vers où, et les soldes s'en
 *     déduisent — un mouvement mal saisi devient visible, pas silencieux.
 *
 *  2. **Les sacs appartiennent à une société.** Ils sont fournis par elle et
 *     restituables. Déplacer des sacs d'OLAM vers DORADO est un transfert de
 *     valeur entre deux tiers : il exige une approbation motivée, exactement
 *     comme une réaffectation de matière.
 *
 *  3. **Une perte se déclare, elle ne se déduit pas.** Un solde qui baisse
 *     sans mouvement de perte est une perte cachée. Le rapprochement la rend
 *     visible plutôt que de l'absorber.
 */

export type BagMovementType =
  | 'reception_societe'
  | 'dotation_pisteur'
  | 'utilisation_achat'
  | 'retour_vide'
  | 'retour_plein'
  | 'perte'
  | 'reaffectation'

export type HolderType = 'field_agent' | 'warehouse' | 'in_transit' | 'partner_site'

export interface BagMovement {
  id: string
  partnerCompanyId: string | null
  type: BagMovementType
  /** Toujours strictement positif : le sens est porté par origine et destination. */
  quantity: number
  fromHolderType: HolderType | null
  fromHolderId: string | null
  toHolderType: HolderType | null
  toHolderId: string | null
  fieldAgentId: string | null
  occurredAt: string
  reason?: string | null
  approvedBy?: string | null
}

export interface BagBalance {
  partnerCompanyId: string | null
  holderType: HolderType
  holderId: string | null
  bagCount: number
}

/** Clé de regroupement d'un solde. Le détenteur seul ne suffit pas : les sacs
 *  d'OLAM et ceux de DORADO chez le même pisteur ne se mélangent pas. */
function key(partnerCompanyId: string | null, holderType: HolderType, holderId: string | null): string {
  return `${partnerCompanyId ?? '-'}|${holderType}|${holderId ?? '-'}`
}

/**
 * Forme attendue de chaque type de mouvement.
 *
 * Un `dotation_pisteur` sans destination n'est pas une dotation : c'est une
 * disparition. Décrire la forme ici permet de refuser la saisie avant qu'elle
 * ne fausse un solde.
 */
const SHAPES: Record<BagMovementType, { needsFrom: boolean; needsTo: boolean; label: string }> = {
  reception_societe: { needsFrom: false, needsTo: true, label: 'Réception de sacs de la société' },
  dotation_pisteur: { needsFrom: true, needsTo: true, label: 'Dotation à un pisteur' },
  utilisation_achat: { needsFrom: true, needsTo: false, label: 'Sacs remplis lors d’un achat' },
  retour_vide: { needsFrom: true, needsTo: true, label: 'Retour de sacs vides' },
  retour_plein: { needsFrom: true, needsTo: true, label: 'Retour de sacs pleins' },
  perte: { needsFrom: true, needsTo: false, label: 'Perte déclarée' },
  reaffectation: { needsFrom: true, needsTo: true, label: 'Réaffectation entre sociétés' },
}

export const BAG_MOVEMENT_LABELS: Record<BagMovementType, string> = Object.fromEntries(
  Object.entries(SHAPES).map(([type, shape]) => [type, shape.label]),
) as Record<BagMovementType, string>

/** Mouvements qui exigent un motif : ceux dont l'absence d'explication coûte cher. */
export const JUSTIFIED_MOVEMENTS: readonly BagMovementType[] = ['perte', 'reaffectation']

export function computeBalances(movements: readonly BagMovement[]): BagBalance[] {
  const totals = new Map<string, BagBalance>()

  const add = (
    partnerCompanyId: string | null,
    holderType: HolderType | null,
    holderId: string | null,
    delta: number,
  ) => {
    if (holderType === null) return
    const id = key(partnerCompanyId, holderType, holderId)
    const current = totals.get(id) ?? { partnerCompanyId, holderType, holderId, bagCount: 0 }
    current.bagCount += delta
    totals.set(id, current)
  }

  for (const movement of movements) {
    add(movement.partnerCompanyId, movement.fromHolderType, movement.fromHolderId, -movement.quantity)
    add(movement.partnerCompanyId, movement.toHolderType, movement.toHolderId, movement.quantity)
  }

  return [...totals.values()].sort(
    (a, b) => b.bagCount - a.bagCount || a.holderType.localeCompare(b.holderType),
  )
}

export function balanceOf(
  balances: readonly BagBalance[],
  partnerCompanyId: string | null,
  holderType: HolderType,
  holderId: string | null,
): number {
  return (
    balances.find(
      (balance) =>
        balance.partnerCompanyId === partnerCompanyId &&
        balance.holderType === holderType &&
        balance.holderId === holderId,
    )?.bagCount ?? 0
  )
}

// ---------------------------------------------------------------------------
// Contrôle de saisie
// ---------------------------------------------------------------------------

export type BagIssueSeverity = 'avertissement' | 'blocage'

export interface BagIssue {
  code:
    | 'quantite_invalide'
    | 'origine_manquante'
    | 'destination_manquante'
    | 'solde_insuffisant'
    | 'motif_manquant'
    | 'approbation_manquante'
    | 'societe_manquante'
  severity: BagIssueSeverity
  message: string
}

export interface BagMovementInput {
  partnerCompanyId: string | null
  type: BagMovementType
  quantity: number
  fromHolderType: HolderType | null
  fromHolderId: string | null
  toHolderType: HolderType | null
  toHolderId: string | null
  /** Société de destination, pour une réaffectation entre tiers. */
  toPartnerCompanyId?: string | null
  reason?: string | null
  approvedBy?: string | null
}

export interface BagCheckResult {
  issues: BagIssue[]
  canProceed: boolean
  /** Solde de l'origine avant le mouvement, pour l'afficher pendant la saisie. */
  availableAtOrigin: number | null
}

/**
 * Contrôle un mouvement avant enregistrement.
 *
 * Le solde disponible est renvoyé même quand tout va bien : un magasinier qui
 * voit « 340 sacs disponibles » pendant qu'il en saisit 400 corrige de
 * lui-même, sans avoir besoin d'un refus.
 */
export function checkBagMovement(
  input: BagMovementInput,
  balances: readonly BagBalance[],
): BagCheckResult {
  const issues: BagIssue[] = []
  const shape = SHAPES[input.type]

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    issues.push({
      code: 'quantite_invalide',
      severity: 'blocage',
      message: 'La quantité doit être un nombre entier strictement positif.',
    })
  }

  if (shape.needsFrom && input.fromHolderType === null) {
    issues.push({
      code: 'origine_manquante',
      severity: 'blocage',
      message: `« ${shape.label} » exige une origine : sans elle, des sacs disparaîtraient d’un stock sans qu’on sache lequel.`,
    })
  }

  if (shape.needsTo && input.toHolderType === null) {
    issues.push({
      code: 'destination_manquante',
      severity: 'blocage',
      message: `« ${shape.label} » exige une destination.`,
    })
  }

  if (input.partnerCompanyId === null) {
    issues.push({
      code: 'societe_manquante',
      severity: 'blocage',
      message:
        'Les sacs appartiennent à une société : sans elle, il devient impossible de savoir à qui les restituer.',
    })
  }

  if (JUSTIFIED_MOVEMENTS.includes(input.type)) {
    if ((input.reason ?? '').trim().length < 5) {
      issues.push({
        code: 'motif_manquant',
        severity: 'blocage',
        message:
          input.type === 'perte'
            ? 'Une perte sans explication est indéfendable en fin de campagne. Décrivez ce qui s’est passé.'
            : 'Une réaffectation entre sociétés exige un motif écrit.',
      })
    }
  }

  // Une réaffectation déplace de la valeur d'un tiers vers un autre : elle ne
  // peut pas être décidée par la seule personne qui la saisit.
  const crossesCompanies =
    input.type === 'reaffectation' &&
    input.toPartnerCompanyId !== undefined &&
    input.toPartnerCompanyId !== null &&
    input.toPartnerCompanyId !== input.partnerCompanyId

  if (input.type === 'reaffectation' && !input.approvedBy) {
    issues.push({
      code: 'approbation_manquante',
      severity: 'blocage',
      message: crossesCompanies
        ? 'Une réaffectation entre deux sociétés exige une approbation nominative.'
        : 'Une réaffectation exige une approbation nominative.',
    })
  }

  let availableAtOrigin: number | null = null

  if (input.fromHolderType !== null) {
    availableAtOrigin = balanceOf(
      balances,
      input.partnerCompanyId,
      input.fromHolderType,
      input.fromHolderId,
    )

    if (input.quantity > availableAtOrigin) {
      issues.push({
        code: 'solde_insuffisant',
        severity: 'blocage',
        message: `Solde insuffisant : ${availableAtOrigin} sac(s) disponible(s) pour ${input.quantity} demandé(s).`,
      })
    }
  }

  return {
    issues,
    canProceed: issues.every((issue) => issue.severity !== 'blocage'),
    availableAtOrigin,
  }
}

// ---------------------------------------------------------------------------
// Rapprochement
// ---------------------------------------------------------------------------

export interface BagReconciliation {
  partnerCompanyId: string | null
  received: number
  distributed: number
  returned: number
  usedForPurchases: number
  declaredLosses: number
  /** Sacs encore détenus par les pisteurs. */
  heldByAgents: number
  /** Ce que les mouvements laissent attendre en magasin. */
  expectedInWarehouse: number
  lossRatePct: number | null
}

/**
 * Rapproche les entrées et les sorties d'une société.
 *
 * Le taux de perte est `null` — et non 0 — quand rien n'a été distribué : un
 * taux de perte de 0 % sur une dotation inexistante se lit comme un excellent
 * résultat, alors qu'il ne s'est rien passé.
 */
export function reconcile(
  movements: readonly BagMovement[],
  partnerCompanyId: string | null,
): BagReconciliation {
  const scoped = movements.filter((movement) => movement.partnerCompanyId === partnerCompanyId)
  const sumOf = (type: BagMovementType) =>
    scoped.filter((movement) => movement.type === type).reduce((total, m) => total + m.quantity, 0)

  const received = sumOf('reception_societe')
  const distributed = sumOf('dotation_pisteur')
  const returned = sumOf('retour_vide') + sumOf('retour_plein')
  const usedForPurchases = sumOf('utilisation_achat')
  const declaredLosses = sumOf('perte')

  const balances = computeBalances(scoped)
  const heldByAgents = balances
    .filter((balance) => balance.holderType === 'field_agent')
    .reduce((total, balance) => total + balance.bagCount, 0)

  return {
    partnerCompanyId,
    received,
    distributed,
    returned,
    usedForPurchases,
    declaredLosses,
    heldByAgents,
    expectedInWarehouse: received - distributed + returned,
    lossRatePct:
      distributed > 0 ? Math.round((declaredLosses / distributed) * 10_000) / 100 : null,
  }
}

/** Pisteurs détenant des sacs, du plus chargé au moins chargé. */
export function agentHoldings(
  balances: readonly BagBalance[],
): Array<{ fieldAgentId: string; partnerCompanyId: string | null; bagCount: number }> {
  return balances
    .filter((balance) => balance.holderType === 'field_agent' && balance.holderId !== null)
    .map((balance) => ({
      fieldAgentId: balance.holderId!,
      partnerCompanyId: balance.partnerCompanyId,
      bagCount: balance.bagCount,
    }))
    .filter((entry) => entry.bagCount !== 0)
    .sort((a, b) => b.bagCount - a.bagCount)
}
