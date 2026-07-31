import { describe, expect, it } from 'vitest'
import { buildKpis, purchaseSeries, stockBreakdown, type DashboardInput } from './dashboard'

const EMPTY: DashboardInput = {
  purchases: [],
  transfers: [],
  advances: [],
  advanceCoverage: 0,
  stock: [],
  latestTcb: [],
  openAlerts: [],
  latePlans: 0,
  openIncidents: 0,
}

const FULL: DashboardInput = {
  purchases: [
    { amount: 3_526_000, net_weight_kg: 8200, purchased_at: '2026-03-01T08:00:00Z' },
    { amount: 1_720_000, net_weight_kg: 4000, purchased_at: '2026-03-02T09:00:00Z' },
  ],
  transfers: [
    { accepted_kg: 8000, net_loaded_kg: 8200, ecart_physique_pct: 0.4, status: 'receptionne' },
    { accepted_kg: 2000, net_loaded_kg: 2100, ecart_physique_pct: 1.2, status: 'receptionne' },
  ],
  advances: [{ amount: 5_000_000 }, { amount: 2_000_000 }],
  advanceCoverage: 4_500_000,
  stock: [
    { quantity_kg: 12_000, status: 'disponible', holder_type: 'warehouse' },
    { quantity_kg: 3_000, status: 'disponible', holder_type: 'field_agent' },
    { quantity_kg: 8_000, status: 'en_transit', holder_type: 'in_transit' },
  ],
  latestTcb: [
    {
      scope_id: 'p1',
      tcb_per_accepted_kg: 491.25,
      margin_total: -80_000,
      accepted_weight_kg: 8000,
      computed_at: '2026-03-10T09:00:00Z',
    },
    {
      scope_id: 'p2',
      tcb_per_accepted_kg: 450,
      margin_total: 120_000,
      accepted_weight_kg: 2000,
      computed_at: '2026-03-10T09:00:00Z',
    },
  ],
  openAlerts: [{ severity: 'critique' }, { severity: 'info' }, { severity: 'blocage' }],
  latePlans: 2,
  openIncidents: 1,
}

function get(input: DashboardInput, key: string) {
  return buildKpis(input).find((item) => item.key === key)
}

describe('buildKpis', () => {
  it('n’invente aucun chiffre sur un périmètre vide', () => {
    const kpis = buildKpis(EMPTY)
    const measured = kpis.filter((item) => item.value !== null)

    // Seuls les compteurs d'événements (retards, incidents, alertes) valent
    // légitimement zéro : « aucun incident » est une information, « 0 FCFA
    // achetés » sur un périmètre vide n'en est pas une.
    expect(measured.map((item) => item.key).sort()).toEqual([
      'critical_alerts',
      'late_plans',
      'open_incidents',
    ])
  })

  it('somme la valeur et le poids achetés', () => {
    expect(get(FULL, 'purchase_amount')?.value).toBe(5_246_000)
    expect(get(FULL, 'purchase_weight')?.value).toBe(12_200)
    expect(get(FULL, 'purchase_amount')?.sourceCount).toBe(2)
  })

  it('calcule un prix moyen sans le confondre avec le coût de revient', () => {
    const price = get(FULL, 'average_price')
    expect(price?.value).toBeCloseTo(430, 0)
    expect(price?.hint).toContain('pas le coût de revient')
  })

  it('laisse le prix moyen absent quand aucun poids n’est acheté', () => {
    const input: DashboardInput = {
      ...EMPTY,
      purchases: [{ amount: 1000, net_weight_kg: 0, purchased_at: '2026-03-01T08:00:00Z' }],
    }
    expect(get(input, 'average_price')?.value).toBeNull()
  })

  it('calcule l’exposition comme un solde, jamais négatif', () => {
    expect(get(FULL, 'agent_exposure')?.value).toBe(2_500_000)

    const overCovered: DashboardInput = { ...FULL, advanceCoverage: 9_000_000 }
    expect(get(overCovered, 'agent_exposure')?.value).toBe(0)
  })

  it('sépare le stock disponible, chez les pisteurs et en transit', () => {
    expect(get(FULL, 'stock_available')?.value).toBe(15_000)
    expect(get(FULL, 'stock_at_agents')?.value).toBe(3_000)
    expect(get(FULL, 'stock_in_transit')?.value).toBe(8_000)
  })

  it('moyenne la perte physique et indique le nombre de mesures', () => {
    const loss = get(FULL, 'physical_loss')
    expect(loss?.value).toBe(0.8)
    expect(loss?.sourceCount).toBe(2)
    // Un écart moyen n'accuse personne.
    expect(loss?.hint).toContain('N’impute aucune responsabilité')
  })

  it('ignore les écarts non mesurés dans la moyenne', () => {
    const input: DashboardInput = {
      ...FULL,
      transfers: [
        { accepted_kg: 8000, net_loaded_kg: 8200, ecart_physique_pct: 0.4, status: 'receptionne' },
        { accepted_kg: null, net_loaded_kg: null, ecart_physique_pct: null, status: 'en_transit' },
      ],
    }
    const loss = get(input, 'physical_loss')
    expect(loss?.value).toBe(0.4)
    expect(loss?.sourceCount).toBe(1)
  })

  it('ne retient qu’un instantané de TCB par périmètre', () => {
    const input: DashboardInput = {
      ...FULL,
      latestTcb: [
        {
          scope_id: 'p1',
          tcb_per_accepted_kg: 500,
          margin_total: 100_000,
          accepted_weight_kg: 8000,
          computed_at: '2026-03-01T09:00:00Z',
        },
        {
          scope_id: 'p1',
          tcb_per_accepted_kg: 400,
          margin_total: 200_000,
          accepted_weight_kg: 8000,
          computed_at: '2026-03-10T09:00:00Z',
        },
      ],
    }

    // Empiler les recalculs successifs compterait le même coût deux fois.
    expect(get(input, 'tcb_per_kg')?.value).toBe(400)
    expect(get(input, 'margin_total')?.value).toBe(200_000)
    expect(get(input, 'tcb_per_kg')?.sourceCount).toBe(1)
  })

  it('laisse la marge absente tant qu’aucun chiffre d’affaires n’est saisi', () => {
    const input: DashboardInput = {
      ...FULL,
      latestTcb: [
        {
          scope_id: 'p1',
          tcb_per_accepted_kg: 491.25,
          margin_total: null,
          accepted_weight_kg: 8000,
          computed_at: '2026-03-10T09:00:00Z',
        },
      ],
    }
    expect(get(input, 'margin_total')?.value).toBeNull()
    expect(get(input, 'tcb_per_kg')?.value).toBe(491.25)
  })

  it('compte les alertes critiques et bloquantes, pas les informations', () => {
    expect(get(FULL, 'critical_alerts')?.value).toBe(2)
  })

  it('donne à chaque indicateur une phrase qui empêche la mauvaise lecture', () => {
    for (const item of buildKpis(FULL)) {
      expect(item.hint.length).toBeGreaterThan(20)
    }
  })
})

describe('purchaseSeries', () => {
  it('regroupe par jour et trie chronologiquement', () => {
    const series = purchaseSeries([
      { amount: 100, net_weight_kg: 10, purchased_at: '2026-03-02T09:00:00Z' },
      { amount: 200, net_weight_kg: 20, purchased_at: '2026-03-01T08:00:00Z' },
      { amount: 300, net_weight_kg: 30, purchased_at: '2026-03-01T18:00:00Z' },
    ])

    expect(series).toEqual([
      { date: '2026-03-01', amount: 500, weight: 50, count: 2 },
      { date: '2026-03-02', amount: 100, weight: 10, count: 1 },
    ])
  })

  it('omet les jours sans achat plutôt que de les mettre à zéro', () => {
    const series = purchaseSeries([
      { amount: 100, net_weight_kg: 10, purchased_at: '2026-03-01T09:00:00Z' },
      { amount: 100, net_weight_kg: 10, purchased_at: '2026-03-05T09:00:00Z' },
    ])

    // Une courbe qui retombe à zéro le dimanche laisse croire à un
    // effondrement, alors que le marché était fermé.
    expect(series.map((point) => point.date)).toEqual(['2026-03-01', '2026-03-05'])
  })

  it('rend une série vide sans achat', () => {
    expect(purchaseSeries([])).toEqual([])
  })
})

describe('stockBreakdown', () => {
  it('regroupe par état et trie par volume décroissant', () => {
    expect(stockBreakdown(FULL.stock)).toEqual([
      { status: 'disponible', quantityKg: 15_000 },
      { status: 'en_transit', quantityKg: 8_000 },
    ])
  })

  it('écarte les états sans volume', () => {
    expect(
      stockBreakdown([{ quantity_kg: 0, status: 'rejete', holder_type: 'warehouse' }]),
    ).toEqual([])
  })
})
