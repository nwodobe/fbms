import { describe, expect, it } from 'vitest'
import {
  agentHoldings,
  balanceOf,
  checkBagMovement,
  computeBalances,
  JUSTIFIED_MOVEMENTS,
  reconcile,
  type BagMovement,
  type BagMovementInput,
} from './bags'

const OLAM = 'p-olam'
const DORADO = 'p-dorado'
const AGENT = 'a-1'
const AGENT2 = 'a-2'

let counter = 0
function movement(over: Partial<BagMovement>): BagMovement {
  counter += 1
  return {
    id: `m-${counter}`,
    partnerCompanyId: OLAM,
    type: 'reception_societe',
    quantity: 100,
    fromHolderType: null,
    fromHolderId: null,
    toHolderType: 'warehouse',
    toHolderId: null,
    fieldAgentId: null,
    occurredAt: '2026-03-01T08:00:00Z',
    ...over,
  }
}

/** Scénario réaliste : réception, dotation, usage, retour, perte. */
const HISTORY: BagMovement[] = [
  movement({ type: 'reception_societe', quantity: 1000 }),
  movement({
    type: 'dotation_pisteur',
    quantity: 300,
    fromHolderType: 'warehouse',
    toHolderType: 'field_agent',
    toHolderId: AGENT,
    fieldAgentId: AGENT,
  }),
  movement({
    type: 'dotation_pisteur',
    quantity: 200,
    fromHolderType: 'warehouse',
    toHolderType: 'field_agent',
    toHolderId: AGENT2,
    fieldAgentId: AGENT2,
  }),
  movement({
    type: 'utilisation_achat',
    quantity: 180,
    fromHolderType: 'field_agent',
    fromHolderId: AGENT,
    toHolderType: null,
    fieldAgentId: AGENT,
  }),
  movement({
    type: 'retour_vide',
    quantity: 90,
    fromHolderType: 'field_agent',
    fromHolderId: AGENT,
    toHolderType: 'warehouse',
    fieldAgentId: AGENT,
  }),
  movement({
    type: 'perte',
    quantity: 20,
    fromHolderType: 'field_agent',
    fromHolderId: AGENT,
    toHolderType: null,
    fieldAgentId: AGENT,
    reason: 'Sacs déchirés au chargement sous la pluie',
  }),
]

describe('computeBalances', () => {
  it('déduit les soldes de l’origine et de la destination de chaque mouvement', () => {
    const balances = computeBalances(HISTORY)

    // 1000 reçus − 500 distribués + 90 retournés = 590.
    expect(balanceOf(balances, OLAM, 'warehouse', null)).toBe(590)
    // 300 reçus − 180 utilisés − 90 retournés − 20 perdus = 10.
    expect(balanceOf(balances, OLAM, 'field_agent', AGENT)).toBe(10)
    expect(balanceOf(balances, OLAM, 'field_agent', AGENT2)).toBe(200)
  })

  it('ne mélange pas les sacs de deux sociétés chez le même détenteur', () => {
    const balances = computeBalances([
      movement({ partnerCompanyId: OLAM, quantity: 500 }),
      movement({ partnerCompanyId: DORADO, quantity: 300 }),
    ])

    expect(balanceOf(balances, OLAM, 'warehouse', null)).toBe(500)
    expect(balanceOf(balances, DORADO, 'warehouse', null)).toBe(300)
  })

  it('renvoie zéro pour un détenteur inconnu, sans inventer de ligne', () => {
    const balances = computeBalances(HISTORY)
    expect(balanceOf(balances, OLAM, 'field_agent', 'inconnu')).toBe(0)
    expect(balances.some((balance) => balance.holderId === 'inconnu')).toBe(false)
  })

  it('rend une liste vide sans mouvement', () => {
    expect(computeBalances([])).toEqual([])
  })
})

describe('checkBagMovement', () => {
  const balances = computeBalances(HISTORY)

  const input = (over: Partial<BagMovementInput> = {}): BagMovementInput => ({
    partnerCompanyId: OLAM,
    type: 'dotation_pisteur',
    quantity: 100,
    fromHolderType: 'warehouse',
    fromHolderId: null,
    toHolderType: 'field_agent',
    toHolderId: AGENT,
    ...over,
  })

  it('accepte une dotation dans le solde et annonce le disponible', () => {
    const result = checkBagMovement(input(), balances)
    expect(result.canProceed).toBe(true)
    expect(result.availableAtOrigin).toBe(590)
  })

  it('refuse une dotation au-delà du solde, en chiffrant l’écart', () => {
    const result = checkBagMovement(input({ quantity: 700 }), balances)
    expect(result.canProceed).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('solde_insuffisant')
    expect(result.issues[0]?.message).toContain('590')
  })

  it('refuse une quantité nulle ou négative', () => {
    for (const quantity of [0, -5]) {
      const result = checkBagMovement(input({ quantity }), balances)
      expect(result.issues.map((issue) => issue.code)).toContain('quantite_invalide')
    }
  })

  it('exige une destination pour une dotation', () => {
    const result = checkBagMovement(input({ toHolderType: null, toHolderId: null }), balances)
    expect(result.issues.map((issue) => issue.code)).toContain('destination_manquante')
  })

  it('exige une origine pour une perte', () => {
    const result = checkBagMovement(
      input({ type: 'perte', fromHolderType: null, toHolderType: null, reason: 'Incendie du magasin' }),
      balances,
    )
    expect(result.issues.map((issue) => issue.code)).toContain('origine_manquante')
  })

  it('n’exige aucune origine pour une réception de société', () => {
    const result = checkBagMovement(
      input({ type: 'reception_societe', fromHolderType: null, toHolderType: 'warehouse', toHolderId: null }),
      balances,
    )
    expect(result.canProceed).toBe(true)
    expect(result.availableAtOrigin).toBeNull()
  })

  it('exige toujours une société : sans elle, on ne sait plus à qui restituer', () => {
    const result = checkBagMovement(input({ partnerCompanyId: null }), balances)
    expect(result.issues.map((issue) => issue.code)).toContain('societe_manquante')
  })

  it('refuse une perte non expliquée', () => {
    const withoutReason = checkBagMovement(
      input({
        type: 'perte',
        quantity: 5,
        fromHolderType: 'field_agent',
        fromHolderId: AGENT,
        toHolderType: null,
      }),
      balances,
    )
    expect(withoutReason.canProceed).toBe(false)
    expect(withoutReason.issues.map((issue) => issue.code)).toContain('motif_manquant')

    const withReason = checkBagMovement(
      input({
        type: 'perte',
        quantity: 5,
        fromHolderType: 'field_agent',
        fromHolderId: AGENT,
        toHolderType: null,
        reason: 'Sacs emportés par la crue du fleuve',
      }),
      balances,
    )
    expect(withReason.canProceed).toBe(true)
  })

  it('exige motif ET approbation pour une réaffectation entre sociétés', () => {
    const base = input({
      type: 'reaffectation',
      quantity: 50,
      fromHolderType: 'warehouse',
      toHolderType: 'warehouse',
      toPartnerCompanyId: DORADO,
    })

    const bare = checkBagMovement(base, balances)
    expect(bare.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['motif_manquant', 'approbation_manquante']),
    )

    const approved = checkBagMovement(
      { ...base, reason: 'Rupture de sacherie côté DORADO, accord des deux sociétés', approvedBy: 'u-1' },
      balances,
    )
    // Déplacer des sacs d'un tiers vers un autre est un transfert de valeur.
    expect(approved.canProceed).toBe(true)
  })

  it('nomme les deux mouvements qui exigent une justification', () => {
    expect([...JUSTIFIED_MOVEMENTS].sort()).toEqual(['perte', 'reaffectation'])
  })
})

describe('reconcile', () => {
  it('rapproche entrées, sorties et pertes d’une société', () => {
    const result = reconcile(HISTORY, OLAM)

    expect(result.received).toBe(1000)
    expect(result.distributed).toBe(500)
    expect(result.returned).toBe(90)
    expect(result.usedForPurchases).toBe(180)
    expect(result.declaredLosses).toBe(20)
    expect(result.expectedInWarehouse).toBe(590)
    expect(result.heldByAgents).toBe(210)
  })

  it('calcule un taux de perte rapporté à ce qui a été distribué', () => {
    // 20 perdus sur 500 distribués.
    expect(reconcile(HISTORY, OLAM).lossRatePct).toBe(4)
  })

  it('laisse le taux de perte absent quand rien n’a été distribué', () => {
    const result = reconcile([movement({ quantity: 500 })], OLAM)
    // 0 % sur une dotation inexistante se lirait comme un excellent résultat.
    expect(result.lossRatePct).toBeNull()
    expect(result.received).toBe(500)
  })

  it('ne compte que les mouvements de la société demandée', () => {
    const mixed = [...HISTORY, movement({ partnerCompanyId: DORADO, quantity: 400 })]
    expect(reconcile(mixed, OLAM).received).toBe(1000)
    expect(reconcile(mixed, DORADO).received).toBe(400)
  })
})

describe('agentHoldings', () => {
  it('classe les pisteurs du plus chargé au moins chargé', () => {
    const holdings = agentHoldings(computeBalances(HISTORY))
    expect(holdings.map((holding) => holding.fieldAgentId)).toEqual([AGENT2, AGENT])
    expect(holdings[0]?.bagCount).toBe(200)
  })

  it('écarte les pisteurs à solde nul', () => {
    const cleared = computeBalances([
      movement({
        type: 'dotation_pisteur',
        quantity: 50,
        fromHolderType: 'warehouse',
        toHolderType: 'field_agent',
        toHolderId: AGENT,
      }),
      movement({
        type: 'retour_vide',
        quantity: 50,
        fromHolderType: 'field_agent',
        fromHolderId: AGENT,
        toHolderType: 'warehouse',
      }),
    ])
    expect(agentHoldings(cleared)).toEqual([])
  })
})
