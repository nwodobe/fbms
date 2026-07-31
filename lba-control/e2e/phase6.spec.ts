import { expect, test } from '@playwright/test'
import { BRANDING_FIXTURE, signIn, stubSupabase } from './support/session'

const TENANT = '00000000-0000-4000-8000-000000000001'

/**
 * L'abonnement expire dans cinq jours : dans la fenêtre de rappel (J-7), donc
 * l'écran annonce l'échéance, mais l'accès reste complet.
 */
const IN_FIVE_DAYS = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
/** Trois jours de retard : dans la grâce de cinq jours, donc accès complet. */
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
const FORTY_DAYS_AGO = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10)

function subscription(periodEnd: string, status = 'active') {
  return {
    id: 'sub-1',
    tenant_id: TENANT,
    plan_id: 'plan-standard',
    status,
    period_start: '2026-01-01',
    period_end: periodEnd,
    trial_end: null,
    grace_days: 5,
    readonly_after_days: 30,
    grace_started_at: null,
    read_only_at: null,
    blocked_at: null,
    suspension_reason: null,
    amount: 120000,
    currency: 'XOF',
    auto_renew: false,
  }
}

const INVOICES = [
  {
    id: 'inv-1',
    tenant_id: TENANT,
    subscription_id: 'sub-1',
    number: 'F-2026-0007',
    amount: 120000,
    amount_paid: 0,
    issued_at: '2026-03-01',
    due_date: '2026-03-15',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    status: 'issued',
  },
]

const PAYMENTS = [
  {
    id: 'pay-1',
    tenant_id: TENANT,
    subscription_id: 'sub-1',
    invoice_id: 'inv-1',
    amount: 50000,
    method: 'wave',
    reference: 'WV-77123',
    payer: 'LBA Bouaké',
    declared_at: '2026-03-10T09:00:00.000Z',
    declared_by: null,
    proof_path: null,
    status: 'declared',
    confirmed_by: null,
    confirmed_at: null,
    verifier_note: null,
    rejected_reason: null,
  },
]

const EVENTS = [
  {
    id: 'ev-1',
    tenant_id: TENANT,
    subscription_id: 'sub-1',
    event_type: 'payment_declared',
    old_status: 'active',
    new_status: 'active',
    payment_id: 'pay-1',
    idempotency_key: null,
    reason: 'Déclaration client enregistrée, en attente de vérification.',
    occurred_at: '2026-03-10T09:00:00.000Z',
  },
  {
    id: 'ev-2',
    tenant_id: TENANT,
    subscription_id: 'sub-1',
    event_type: 'reminder_j7',
    old_status: 'active',
    new_status: 'active',
    payment_id: null,
    idempotency_key: 'reminder_j7:sub-1',
    reason: 'Rappel automatique : échéance dans 7 jour(s).',
    occurred_at: '2026-03-24T06:00:00.000Z',
  },
]

const PARTNERS = [
  {
    id: 'p-olam',
    tenant_id: TENANT,
    code: 'OLAM',
    name: 'OLAM (démo)',
    contact_name: null,
    phone: null,
    email: null,
    address: null,
    status: 'active',
    weight_tolerance_pct: 0.5,
    acceptance_tolerance_pct: null,
    external_access_enabled: false,
    created_at: '2026-01-01',
  },
]

const CAMPAIGNS = [
  {
    id: 'c-2026',
    tenant_id: TENANT,
    code: '2026',
    name: 'Campagne 2026',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    status: 'ouverte',
  },
]

const PURCHASES = [
  {
    id: 'pu-1',
    tenant_id: TENANT,
    campaign_id: 'c-2026',
    partner_company_id: 'p-olam',
    field_agent_id: 'a-1',
    amount: 3526000,
    net_weight_kg: 8200,
    purchased_at: '2026-03-01T08:00:00.000Z',
    status: 'valide',
  },
  {
    id: 'pu-2',
    tenant_id: TENANT,
    campaign_id: 'c-2026',
    partner_company_id: 'p-olam',
    field_agent_id: 'a-2',
    amount: 1720000,
    net_weight_kg: 4000,
    purchased_at: '2026-03-02T09:00:00.000Z',
    status: 'valide',
  },
]

const TRANSFERS = [
  {
    id: 't-1',
    tenant_id: TENANT,
    campaign_id: 'c-2026',
    partner_company_id: 'p-olam',
    accepted_kg: 8000,
    net_loaded_kg: 8200,
    ecart_physique_pct: 0.4,
    status: 'receptionne',
    dispatched_at: '2026-03-03T06:00:00.000Z',
  },
]

const STOCK = [
  {
    id: 'lot-1',
    tenant_id: TENANT,
    campaign_id: 'c-2026',
    partner_company_id: 'p-olam',
    quantity_kg: 12000,
    status: 'disponible',
    holder_type: 'warehouse',
  },
  {
    id: 'lot-2',
    tenant_id: TENANT,
    campaign_id: 'c-2026',
    partner_company_id: 'p-olam',
    quantity_kg: 8000,
    status: 'en_transit',
    holder_type: 'in_transit',
  },
]

const TCB = [
  {
    id: 'tcb-1',
    tenant_id: TENANT,
    scope_id: 'p-olam',
    tcb_per_accepted_kg: 491.25,
    margin_total: -80000,
    margin_per_kg: 8.75,
    accepted_weight_kg: 8000,
    computed_at: '2026-03-10T09:00:00.000Z',
  },
]

function fixtures(sub = subscription(IN_FIVE_DAYS)) {
  return {
    tenant_branding: [BRANDING_FIXTURE],
    subscriptions: [sub],
    invoices: INVOICES,
    subscription_payments: PAYMENTS,
    subscription_events: EVENTS,
    partner_companies: PARTNERS,
    campaigns: CAMPAIGNS,
    purchases: PURCHASES,
    transfers: TRANSFERS,
    advances: [
      { id: 'adv-1', tenant_id: TENANT, campaign_id: 'c-2026', partner_company_id: 'p-olam', amount: 5000000, status: 'decaisse', issued_at: '2026-03-01T08:00:00.000Z' },
    ],
    advance_allocations: [{ id: 'al-1', amount: 3000000 }],
    advance_repayments: [{ id: 'rp-1', amount: 500000 }],
    stock_lots: STOCK,
    alerts: [
      { id: 'al-1', tenant_id: TENANT, severity: 'critique', alert_type: 'avance_non_couverte', status: 'ouverte' },
      { id: 'al-2', tenant_id: TENANT, severity: 'info', alert_type: 'livraison_prevue_demain', status: 'ouverte' },
    ],
    tcb_snapshots: TCB,
    delivery_plans: [],
    incidents: [],
  }
}

// ---------------------------------------------------------------------------
// E2E-12 · abonnement
// ---------------------------------------------------------------------------

test.describe('E2E-12 · abonnement', () => {
  test('annonce l’échéance et la prochaine bascule avant qu’elle n’arrive', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/abonnement')

    await expect(page.getByRole('heading', { name: 'Échéance proche' })).toBeVisible()
    await expect(page.getByRole('term').filter({ hasText: 'Prochaine bascule' })).toBeVisible()
    // Un client qui découvre son blocage le jour même n'a pas été prévenu.
    await expect(page.getByText(/Échu — période de grâce le \d{4}-\d{2}-\d{2}/)).toBeVisible()
  })

  test('garde l’accès complet pendant la période de grâce', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures(subscription(THREE_DAYS_AGO, 'grace_period')))
    await page.goto('/abonnement')

    await expect(page.getByRole('heading', { name: 'Échu — période de grâce' })).toBeVisible()
    await expect(page.getByText('accès complet')).toBeVisible()
    await expect(page.getByText('Saisir et modifier : oui')).toBeVisible()
  })

  test('bloque la saisie mais laisse export et déclaration après le délai', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures(subscription(FORTY_DAYS_AGO, 'suspended')))
    await page.goto('/abonnement')

    await expect(page.getByRole('heading', { name: 'Accès opérationnel bloqué' })).toBeVisible()
    await expect(page.getByText('Saisir et modifier : non')).toBeVisible()
    // Retenir les données d'un client en retard serait une prise d'otage.
    await expect(page.getByText('Exporter : oui')).toBeVisible()
    // Sans cela, un client bloqué ne pourrait jamais se débloquer.
    await expect(page.getByText('Déclarer un paiement : oui')).toBeVisible()
  })

  test('affirme que les données sont conservées à toutes les étapes', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures(subscription(FORTY_DAYS_AGO, 'suspended')))
    await page.goto('/abonnement')

    await expect(page.getByText(/données sont conservées à toutes les étapes/)).toBeVisible()
    await expect(page.getByText(/Rien n’est\s+supprimé/)).toBeVisible()
  })

  test('annonce qu’un paiement partiel ne renouvelle pas la période', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/abonnement')

    await page.getByLabel('Montant (FCFA)').fill('50000')

    // Le dire avant l'envoi évite l'appel furieux à la première saisie refusée.
    await expect(page.getByText(/Paiement partiel/)).toBeVisible()
    await expect(page.getByText(/la période n’est pas renouvelée/)).toBeVisible()
  })

  test('confirme qu’un paiement complet renouvellera bien la période', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/abonnement')

    await page.getByLabel('Montant (FCFA)').fill('120000')
    await expect(page.getByText('Facture réglée intégralement.')).toBeVisible()
  })

  test('exige une référence de transaction', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/abonnement')

    await page.getByLabel('Montant (FCFA)').fill('120000')
    await expect(page.getByRole('button', { name: 'Déclarer le paiement' })).toBeDisabled()

    await page.getByLabel('Référence de transaction').fill('WV-99001')
    await expect(page.getByRole('button', { name: 'Déclarer le paiement' })).toBeEnabled()
  })

  test('dit clairement qu’une déclaration ne réactive rien', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/abonnement')

    await expect(page.getByText(/ne renouvelle\s+jamais l’abonnement à elle seule/)).toBeVisible()
    await expect(page.getByText(/une capture d’écran ne suffit pas/)).toBeVisible()
  })

  test('n’offre pas la confirmation à un client', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/abonnement')

    await expect(page.getByText('déclaré, en attente de vérification')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Vérifier et confirmer' })).toHaveCount(0)
  })

  test('montre l’historique des rappels et des déclarations', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/abonnement')

    await expect(page.getByText('reminder j7')).toBeVisible()
    await expect(page.getByText('payment declared')).toBeVisible()
    await expect(page.getByText(/en attente de vérification/).first()).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// E2E-13 · tableau de bord
// ---------------------------------------------------------------------------

test.describe('E2E-13 · tableau de bord', () => {
  test('calcule les indicateurs à partir des transactions', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/')

    const purchased = page.locator('div').filter({ hasText: /^Valeur achetée/ }).first()
    await expect(purchased).toContainText('5 246 000')

    const exposure = page.locator('div').filter({ hasText: /^Exposition chez les pisteurs/ }).first()
    // 5 000 000 avancés − 3 000 000 alloués − 500 000 remboursés.
    await expect(exposure).toContainText('1 500 000')
  })

  test('affiche « — » plutôt qu’un zéro inventé', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, {
      tenant_branding: [BRANDING_FIXTURE],
      partner_companies: PARTNERS,
      campaigns: CAMPAIGNS,
      purchases: [],
      transfers: [],
      advances: [],
      advance_allocations: [],
      advance_repayments: [],
      stock_lots: [],
      alerts: [],
      tcb_snapshots: [],
      delivery_plans: [],
      incidents: [],
    })
    await page.goto('/')

    const purchased = page.locator('div').filter({ hasText: /^Valeur achetée/ }).first()
    await expect(purchased).toContainText('—')
    await expect(purchased).toContainText('Aucune donnée sur ce périmètre.')
    await expect(purchased).not.toContainText('0 FCFA')
  })

  test('indique le nombre de lignes sources de chaque indicateur', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/')

    const purchased = page.locator('div').filter({ hasText: /^Valeur achetée/ }).first()
    // Une moyenne sur deux lignes ne se lit pas comme une moyenne sur deux cents.
    await expect(purchased).toContainText('2 ligne(s) source(s)')
  })

  test('donne à chaque indicateur une phrase de lecture', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/')

    // Le prix moyen d'achat n'est pas le coût de revient : le confondre fait
    // conclure à une marge qui n'existe pas.
    await expect(page.getByText('Valeur achetée rapportée au poids acheté. Ce n’est pas le coût de revient.')).toBeVisible()
    await expect(page.getByText(/N’impute aucune responsabilité/)).toBeVisible()
  })

  test('laisse la marge absente tant qu’aucun chiffre d’affaires n’est saisi', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, {
      ...fixtures(),
      tcb_snapshots: [{ ...TCB[0]!, margin_total: null }],
    })
    await page.goto('/')

    const margin = page.locator('div').filter({ hasText: /^Marge totale/ }).first()
    await expect(margin).toContainText('—')
  })

  test('offre les filtres de périmètre', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/')

    await expect(page.getByLabel('Campagne')).toBeVisible()
    await expect(page.getByLabel('Société')).toBeVisible()
    await page.getByLabel('Campagne').selectOption('c-2026')
    await expect(page.getByLabel('Campagne')).toHaveValue('c-2026')
  })

  test('propose l’export PDF et Excel', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Exporter en PDF' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Exporter en Excel' })).toBeEnabled()
  })

  test('télécharge un classeur Excel réel', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/')

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exporter en Excel' }).click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(/tableau-de-bord.*\.xlsx$/)
  })

  test('trace le graphique des achats sans jour à zéro', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, fixtures())
    await page.goto('/')

    await expect(page.getByText('Achats par jour')).toBeVisible()
    await expect(page.getByText(/un marché\s+fermé n’est pas un effondrement/)).toBeVisible()
  })
})
