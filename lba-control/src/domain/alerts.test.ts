import { describe, expect, it } from 'vitest'
import {
  ALERT_TYPES,
  daysBetween,
  DEFAULT_ALERT_RULES,
  dedupeCandidates,
  defaultAlertRules,
  evaluateAlerts,
  sortBySeverity,
  type AlertFacts,
  type AlertRule,
  type AlertType,
} from './alerts'

const NOW = new Date('2026-03-10T09:00:00.000Z')

function rulesWith(overrides: Partial<Record<AlertType, Partial<AlertRule>>>): AlertRule[] {
  return defaultAlertRules().map((rule) => ({ ...rule, ...(overrides[rule.alertType] ?? {}) }))
}

function types(facts: AlertFacts, rules = defaultAlertRules()): AlertType[] {
  return evaluateAlerts(facts, rules, NOW).map((candidate) => candidate.alertType)
}

describe('référentiel des règles', () => {
  it('couvre exactement les vingt types imposés', () => {
    expect(ALERT_TYPES).toHaveLength(20)
    expect(new Set(ALERT_TYPES).size).toBe(20)
  })

  it('donne à chaque règle un seuil paramétrable et un libellé de seuil', () => {
    for (const type of ALERT_TYPES) {
      const definition = DEFAULT_ALERT_RULES[type]
      const keys = Object.keys(definition.threshold)
      expect(keys.length).toBeGreaterThan(0)
      for (const key of keys) {
        expect(definition.thresholdLabels[key]).toBeTruthy()
      }
    }
  })

  it('active les vingt règles par défaut', () => {
    expect(defaultAlertRules().filter((rule) => rule.isActive)).toHaveLength(20)
  })
})

describe('daysBetween', () => {
  it('compte des jours calendaires, dans les deux sens', () => {
    expect(daysBetween('2026-03-01', '2026-03-10')).toBe(9)
    expect(daysBetween('2026-03-10', '2026-03-01')).toBe(-9)
    expect(daysBetween('2026-03-10', '2026-03-10')).toBe(0)
  })
})

describe('evaluateAlerts · financements et avances', () => {
  it('alerte sur un financement proche de l’échéance, pas sur un financement lointain', () => {
    const found = types({
      fundings: [
        { id: 'f1', reference: 'FIN-001', dueDate: '2026-03-14', isSettled: false },
        { id: 'f2', reference: 'FIN-002', dueDate: '2026-05-01', isSettled: false },
        { id: 'f3', reference: 'FIN-003', dueDate: '2026-03-11', isSettled: true },
      ],
    })

    expect(found).toEqual(['financement_proche_echeance'])
  })

  it('mesure et rapporte l’ancienneté d’une avance sans achat', () => {
    const [candidate] = evaluateAlerts(
      {
        advances: [
          {
            id: 'a1',
            reference: 'AV-001',
            fieldAgentId: 'ag1',
            agentName: 'KONE Ibrahim',
            disbursedDate: '2026-03-04',
            purchaseCount: 0,
            outstandingAmount: 0,
            status: 'decaisse',
          },
        ],
      },
      defaultAlertRules(),
      NOW,
    )

    expect(candidate?.alertType).toBe('avance_sans_achat')
    expect(candidate?.measuredValue).toBe(6)
    expect(candidate?.thresholdValue).toBe(3)
    expect(candidate?.fieldAgentId).toBe('ag1')
    expect(candidate?.dedupeKey).toBe('avance_sans_achat:a1')
  })

  it('n’alerte pas sur une avance décaissée du jour', () => {
    expect(
      types({
        advances: [
          {
            id: 'a1',
            reference: 'AV-001',
            fieldAgentId: 'ag1',
            agentName: 'KONE Ibrahim',
            disbursedDate: '2026-03-10',
            purchaseCount: 0,
            outstandingAmount: 500_000,
            status: 'decaisse',
          },
        ],
      }),
    ).toEqual([])
  })

  it('décrit l’exposition d’un pisteur sans lui imputer de faute', () => {
    const [candidate] = evaluateAlerts(
      {
        agentExposures: [
          {
            fieldAgentId: 'ag1',
            agentName: 'KONE Ibrahim',
            exposureAmount: 1_500_000,
            oldestDisbursementDate: '2026-02-25',
            lastDeliveryDate: '2026-03-09',
            isActive: true,
          },
        ],
      },
      defaultAlertRules(),
      NOW,
    )

    expect(candidate?.alertType).toBe('argent_chez_pisteur_trop_longtemps')
    expect(candidate?.measuredValue).toBe(13)
    // Un constat, jamais une accusation.
    expect(candidate?.message).toContain('détient une exposition')
    expect(candidate?.message).not.toMatch(/détourn|vol|retient/i)
  })

  it('respecte un seuil relevé par le tenant', () => {
    const facts: AlertFacts = {
      agentExposures: [
        {
          fieldAgentId: 'ag1',
          agentName: 'KONE Ibrahim',
          exposureAmount: 1_500_000,
          oldestDisbursementDate: '2026-03-02',
          lastDeliveryDate: '2026-03-10',
          isActive: true,
        },
      ],
    }

    expect(types(facts)).toContain('argent_chez_pisteur_trop_longtemps')
    expect(
      types(
        facts,
        rulesWith({ argent_chez_pisteur_trop_longtemps: { threshold: { days: 30, amount: 0 } } }),
      ),
    ).not.toContain('argent_chez_pisteur_trop_longtemps')
  })

  it('ignore une règle désactivée', () => {
    expect(
      types(
        { fundings: [{ id: 'f1', reference: 'FIN-001', dueDate: '2026-03-11', isSettled: false }] },
        rulesWith({ financement_proche_echeance: { isActive: false } }),
      ),
    ).toEqual([])
  })
})

describe('evaluateAlerts · planning', () => {
  const plan = (plannedDate: string, status = 'planifie') => ({
    id: `p-${plannedDate}`,
    reference: `PL-${plannedDate}`,
    plannedDate,
    status,
    partnerCompanyId: null,
  })

  it('distingue « demain », « sous 48 h » et « en retard »', () => {
    expect(types({ plans: [plan('2026-03-11')] })).toEqual(
      expect.arrayContaining(['livraison_prevue_demain', 'livraison_prevue_48h']),
    )
    expect(types({ plans: [plan('2026-03-12')] })).toEqual(['livraison_prevue_48h'])
    expect(types({ plans: [plan('2026-03-15')] })).toEqual([])
    expect(types({ plans: [plan('2026-03-07')] })).toEqual(['livraison_en_retard'])
  })

  it('ne relance rien sur un planning réceptionné, annulé ou reporté', () => {
    for (const status of ['receptionne', 'cloture', 'annule', 'reporte']) {
      expect(types({ plans: [plan('2026-03-01', status)] })).toEqual([])
    }
  })

  it('mesure le retard en jours', () => {
    const [candidate] = evaluateAlerts({ plans: [plan('2026-03-05')] }, defaultAlertRules(), NOW)
    expect(candidate?.measuredValue).toBe(5)
  })
})

describe('evaluateAlerts · stock et transferts', () => {
  it('alerte quand le stock ne couvre pas l’engagement', () => {
    const found = types({
      stockCoverage: [
        { scopeId: 'c1', scopeLabel: 'Contrat OLAM', committedKg: 10_000, availableKg: 4_000 },
        { scopeId: 'c2', scopeLabel: 'Contrat DORADO', committedKg: 5_000, availableKg: 8_000 },
      ],
    })
    expect(found).toEqual(['stock_insuffisant'])
  })

  it('détecte une double réservation', () => {
    const [candidate] = evaluateAlerts(
      {
        lotReservations: [
          { lotId: 'l1', lotCode: 'LOT-0001', quantityKg: 8_000, reservedKg: 9_500 },
          { lotId: 'l2', lotCode: 'LOT-0002', quantityKg: 8_000, reservedKg: 8_000 },
        ],
      },
      defaultAlertRules(),
      NOW,
    )

    expect(candidate?.alertType).toBe('double_reservation')
    expect(candidate?.severity).toBe('blocage')
    expect(candidate?.measuredValue).toBe(1_500)
  })

  it('signale un camion parti sans ticket, un transit trop long et une réception manquante', () => {
    const found = types({
      transfers: [
        {
          id: 't1',
          transferNumber: 'TR-0001',
          status: 'en_transit',
          dispatchedAt: '2026-03-07T06:00:00.000Z',
          arrivedAt: null,
          hasWeighingTicket: false,
          hasReception: false,
          ecartPhysiquePct: null,
          tolerancePct: null,
          tareVariationKg: null,
        },
        {
          id: 't2',
          transferNumber: 'TR-0002',
          status: 'arrive',
          dispatchedAt: '2026-03-08T06:00:00.000Z',
          arrivedAt: '2026-03-08T20:00:00.000Z',
          hasWeighingTicket: true,
          hasReception: false,
          ecartPhysiquePct: null,
          tolerancePct: null,
          tareVariationKg: null,
        },
      ],
    })

    expect(found).toEqual(
      expect.arrayContaining([
        'camion_sans_document',
        'transfert_transit_trop_long',
        'reception_non_renseignee',
      ]),
    )
  })

  it('compare l’écart physique à la tolérance applicable, en valeur absolue', () => {
    const base = {
      id: 't1',
      transferNumber: 'TR-0001',
      status: 'receptionne',
      dispatchedAt: null,
      arrivedAt: null,
      hasWeighingTicket: true,
      hasReception: true,
      tareVariationKg: null,
    }

    expect(
      types({ transfers: [{ ...base, ecartPhysiquePct: 0.4, tolerancePct: 0.5 }] }),
    ).toEqual([])
    expect(
      types({ transfers: [{ ...base, ecartPhysiquePct: 0.9, tolerancePct: 0.5 }] }),
    ).toEqual(['ecart_superieur_tolerance'])
    expect(
      types({ transfers: [{ ...base, ecartPhysiquePct: -0.9, tolerancePct: 0.5 }] }),
    ).toEqual(['ecart_superieur_tolerance'])
  })

  it('laisse la cause d’un écart ouverte', () => {
    const [candidate] = evaluateAlerts(
      {
        transfers: [
          {
            id: 't1',
            transferNumber: 'TR-0001',
            status: 'receptionne',
            dispatchedAt: null,
            arrivedAt: null,
            hasWeighingTicket: true,
            hasReception: true,
            ecartPhysiquePct: 2.4,
            tolerancePct: 0.5,
            tareVariationKg: null,
          },
        ],
      },
      defaultAlertRules(),
      NOW,
    )

    expect(candidate?.message).toContain('Cause à qualifier')
  })

  it('détecte une tare anormale dans les deux sens', () => {
    const base = {
      id: 't1',
      transferNumber: 'TR-0001',
      status: 'receptionne',
      dispatchedAt: null,
      arrivedAt: null,
      hasWeighingTicket: true,
      hasReception: true,
      ecartPhysiquePct: null,
      tolerancePct: null,
    }

    expect(types({ transfers: [{ ...base, tareVariationKg: 250 }] })).toEqual(['tare_anormale'])
    expect(types({ transfers: [{ ...base, tareVariationKg: -250 }] })).toEqual(['tare_anormale'])
    expect(types({ transfers: [{ ...base, tareVariationKg: 40 }] })).toEqual([])
  })
})

describe('evaluateAlerts · dépenses, marges et abonnement', () => {
  it('alerte sur une dépense importante sans justificatif, hors brouillon et rejet', () => {
    const found = types({
      expenses: [
        { id: 'e1', reference: 'DP-001', amount: 300_000, hasProof: false, status: 'validee' },
        { id: 'e2', reference: 'DP-002', amount: 300_000, hasProof: true, status: 'validee' },
        { id: 'e3', reference: 'DP-003', amount: 10_000, hasProof: false, status: 'validee' },
        { id: 'e4', reference: 'DP-004', amount: 900_000, hasProof: false, status: 'rejetee' },
        { id: 'e5', reference: 'DP-005', amount: 900_000, hasProof: false, status: 'brouillon' },
      ],
    })

    expect(found).toEqual(['depense_sans_justificatif'])
  })

  it('n’alerte que sur un doublon encore à vérifier', () => {
    const found = types({
      duplicateFlags: [
        { id: 'd1', expenseId: 'e1', candidateId: 'e2', similarityScore: 88, status: 'a_verifier' },
        { id: 'd2', expenseId: 'e3', candidateId: 'e4', similarityScore: 95, status: 'ecarte' },
        { id: 'd3', expenseId: 'e5', candidateId: 'e6', similarityScore: 40, status: 'a_verifier' },
      ],
    })

    expect(found).toEqual(['depense_doublon_probable'])
  })

  it('alerte quand le coût de revient dépasse le prix net et quand la marge passe sous le seuil', () => {
    const found = types({
      tcb: [
        {
          scopeId: 's1',
          scopeLabel: 'OLAM · campagne 2026',
          tcbPerAcceptedKg: 510,
          netSalePricePerKg: 500,
          marginPerKg: -10,
        },
      ],
    })

    expect(found).toEqual(
      expect.arrayContaining(['tcb_superieur_prix_net', 'marge_inferieure_seuil']),
    )
  })

  it('ne dit rien d’un TCB non calculable', () => {
    expect(
      types({
        tcb: [
          {
            scopeId: 's1',
            scopeLabel: 'OLAM',
            tcbPerAcceptedKg: null,
            netSalePricePerKg: 500,
            marginPerKg: null,
          },
        ],
      }),
    ).toEqual([])
  })

  it('alerte sur un abonnement proche de l’échéance et signale un abonnement expiré', () => {
    expect(
      types({ subscription: { id: 'sub1', planLabel: 'Pro', expiresOn: '2026-03-14' } }),
    ).toEqual(['abonnement_proche_echeance'])

    const [expired] = evaluateAlerts(
      { subscription: { id: 'sub1', planLabel: 'Pro', expiresOn: '2026-03-05' } },
      defaultAlertRules(),
      NOW,
    )
    expect(expired?.message).toContain('expiré depuis 5 jour(s)')
  })
})

describe('dedupeCandidates et tri', () => {
  it('ne réémet pas une alerte déjà ouverte', () => {
    const facts: AlertFacts = {
      fundings: [{ id: 'f1', reference: 'FIN-001', dueDate: '2026-03-12', isSettled: false }],
    }
    const candidates = evaluateAlerts(facts, defaultAlertRules(), NOW)

    expect(dedupeCandidates(candidates)).toHaveLength(1)
    expect(dedupeCandidates(candidates, ['financement_proche_echeance:f1'])).toHaveLength(0)
  })

  it('écarte les doublons internes à une même évaluation', () => {
    const candidates = evaluateAlerts(
      {
        fundings: [
          { id: 'f1', reference: 'FIN-001', dueDate: '2026-03-12', isSettled: false },
          { id: 'f1', reference: 'FIN-001', dueDate: '2026-03-12', isSettled: false },
        ],
      },
      defaultAlertRules(),
      NOW,
    )

    expect(candidates).toHaveLength(2)
    expect(dedupeCandidates(candidates)).toHaveLength(1)
  })

  it('trie le bloquant et le critique avant le reste', () => {
    const candidates = evaluateAlerts(
      {
        lotReservations: [{ lotId: 'l1', lotCode: 'LOT-1', quantityKg: 100, reservedKg: 200 }],
        plans: [
          {
            id: 'p1',
            reference: 'PL-1',
            plannedDate: '2026-03-11',
            status: 'planifie',
            partnerCompanyId: null,
          },
        ],
      },
      defaultAlertRules(),
      NOW,
    )

    const sorted = sortBySeverity(candidates)
    expect(sorted[0]?.severity).toBe('blocage')
    expect(sorted.at(-1)?.severity).toBe('info')
  })

  it('donne à chaque candidat une clé de déduplication unique par entité', () => {
    const candidates = evaluateAlerts(
      {
        transfers: [
          {
            id: 't1',
            transferNumber: 'TR-1',
            status: 'en_transit',
            dispatchedAt: '2026-03-01T06:00:00.000Z',
            arrivedAt: null,
            hasWeighingTicket: false,
            hasReception: false,
            ecartPhysiquePct: null,
            tolerancePct: null,
            tareVariationKg: null,
          },
        ],
      },
      defaultAlertRules(),
      NOW,
    )

    const keys = candidates.map((candidate) => candidate.dedupeKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((key) => key.endsWith(':t1'))).toBe(true)
  })
})

describe('evaluateAlerts · absence de faits', () => {
  it('ne produit rien sur un instantané vide', () => {
    expect(evaluateAlerts({}, defaultAlertRules(), NOW)).toEqual([])
  })
})
