import { expect, test } from '@playwright/test'
import { BRANDING_FIXTURE, signIn, stubSupabase } from './support/session'

const TENANT = '00000000-0000-4000-8000-000000000001'

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
  {
    id: 'p-dorado',
    tenant_id: TENANT,
    code: 'DORADO',
    name: 'DORADO (démo)',
    contact_name: null,
    phone: null,
    email: null,
    address: null,
    status: 'active',
    weight_tolerance_pct: null,
    acceptance_tolerance_pct: null,
    external_access_enabled: false,
    created_at: '2026-01-01',
  },
]

const AGENTS = [
  {
    id: 'a-1',
    tenant_id: TENANT,
    code: 'PIS-001',
    full_name: 'KONE Ibrahim (démo)',
    phone: null,
    zone_id: null,
    ceiling_amount: 5000000,
    status: 'actif',
    commission_mode: 'par_kg',
    commission_value: 5,
    user_id: null,
    activation_date: '2026-01-05',
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
  {
    id: 'c-2025',
    tenant_id: TENANT,
    code: '2025',
    name: 'Campagne 2025',
    start_date: '2025-01-01',
    end_date: '2025-12-31',
    status: 'cloturee',
  },
]

const BAG_MOVEMENTS = [
  {
    id: 'bm-1',
    tenant_id: TENANT,
    partner_company_id: 'p-olam',
    type: 'reception_societe',
    quantity: 1000,
    from_holder_type: null,
    from_holder_id: null,
    to_holder_type: 'warehouse',
    to_holder_id: null,
    field_agent_id: null,
    purchase_id: null,
    occurred_at: '2026-03-01T08:00:00.000Z',
    reason: null,
    approved_by: null,
  },
  {
    id: 'bm-2',
    tenant_id: TENANT,
    partner_company_id: 'p-olam',
    type: 'dotation_pisteur',
    quantity: 300,
    from_holder_type: 'warehouse',
    from_holder_id: null,
    to_holder_type: 'field_agent',
    to_holder_id: 'a-1',
    field_agent_id: 'a-1',
    purchase_id: null,
    occurred_at: '2026-03-02T08:00:00.000Z',
    reason: null,
    approved_by: null,
  },
  {
    id: 'bm-3',
    tenant_id: TENANT,
    partner_company_id: 'p-olam',
    type: 'perte',
    quantity: 20,
    from_holder_type: 'field_agent',
    from_holder_id: 'a-1',
    to_holder_type: null,
    to_holder_id: null,
    field_agent_id: 'a-1',
    purchase_id: null,
    occurred_at: '2026-03-05T08:00:00.000Z',
    reason: 'Sacs déchirés au chargement sous la pluie',
    approved_by: null,
  },
]

const BAG_STOCKS = [
  {
    id: 'bs-1',
    tenant_id: TENANT,
    partner_company_id: 'p-olam',
    holder_type: 'warehouse',
    holder_id: null,
    bag_count: 700,
    updated_at: '2026-03-05T08:00:00.000Z',
  },
  {
    id: 'bs-2',
    tenant_id: TENANT,
    partner_company_id: 'p-olam',
    holder_type: 'field_agent',
    holder_id: 'a-1',
    bag_count: 280,
    updated_at: '2026-03-05T08:00:00.000Z',
  },
]

const FIXTURES = {
  tenant_branding: [BRANDING_FIXTURE],
  partner_companies: PARTNERS,
  field_agents: AGENTS,
  campaigns: CAMPAIGNS,
  bag_movements: BAG_MOVEMENTS,
  bag_stocks: BAG_STOCKS,
}

// ---------------------------------------------------------------------------
// E2E-15 · sacherie
// ---------------------------------------------------------------------------

test.describe('E2E-15 · sacherie', () => {
  test('affiche les soldes sans jamais les proposer à la saisie', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/sacs')

    await expect(page.getByText('Le solde ne se saisit pas')).toBeVisible()
    await expect(page.getByRole('row', { name: /OLAM.*700/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /KONE Ibrahim.*280/ })).toBeVisible()
  })

  test('annonce le solde disponible pendant la saisie d’une dotation', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/sacs')

    await page.getByRole('button', { name: 'Nouveau mouvement' }).click()
    await page.getByLabel('Société propriétaire des sacs').selectOption('p-olam')
    await page.getByLabel('Type de mouvement').selectOption('dotation_pisteur')
    await page.getByLabel('Pisteur').selectOption('a-1')
    await page.getByLabel('Nombre de sacs').fill('100')

    // Le magasinier voit ce dont il dispose pendant qu'il tape, plutôt qu'un
    // refus après coup.
    await expect(page.getByText(/Solde disponible à l’origine/)).toContainText('700')
  })

  test('refuse une dotation au-delà du solde, avant l’envoi', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/sacs')

    await page.getByRole('button', { name: 'Nouveau mouvement' }).click()
    await page.getByLabel('Société propriétaire des sacs').selectOption('p-olam')
    await page.getByLabel('Type de mouvement').selectOption('dotation_pisteur')
    await page.getByLabel('Pisteur').selectOption('a-1')
    await page.getByLabel('Nombre de sacs').fill('900')

    await expect(page.getByText(/Solde insuffisant : 700 sac\(s\) disponible\(s\) pour 900/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  })

  test('exige une explication pour une perte', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/sacs')

    await page.getByRole('button', { name: 'Nouveau mouvement' }).click()
    await page.getByLabel('Société propriétaire des sacs').selectOption('p-olam')
    await page.getByLabel('Type de mouvement').selectOption('perte')
    await page.getByLabel('Nombre de sacs').fill('10')

    await expect(page.getByText(/indéfendable en fin de campagne/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()

    await page.getByLabel('Explication').fill('Sacs emportés par la crue du fleuve')
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
  })

  test('ne propose pas la réaffectation dans le formulaire ordinaire', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/sacs')

    await page.getByRole('button', { name: 'Nouveau mouvement' }).click()
    const types = page.getByLabel('Type de mouvement')

    // Elle exige une approbation nominative que ce formulaire ne recueille pas.
    await expect(types.locator('option', { hasText: 'Réaffectation entre sociétés' })).toHaveCount(0)
    await expect(types.locator('option', { hasText: 'Dotation à un pisteur' })).toHaveCount(1)
  })

  test('exige un motif pour réaffecter entre deux sociétés', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/sacs')

    await page.getByRole('button', { name: 'Réaffecter entre sociétés' }).click()
    await page.getByLabel('Société d’origine').selectOption('p-olam')
    await page.getByLabel('Société de destination').selectOption('p-dorado')
    await page.getByLabel('Nombre de sacs').fill('100')

    await expect(page.getByRole('button', { name: 'Réaffecter' })).toBeDisabled()
    await page.getByLabel('Motif').fill('Rupture de sacherie côté DORADO')
    await expect(page.getByRole('button', { name: 'Réaffecter' })).toBeEnabled()
  })

  test('un pisteur ne peut ni saisir ni réaffecter', async ({ page }) => {
    await signIn(page, { role: 'pisteur', userId: '00000000-0000-4000-8000-000000000015' })
    await stubSupabase(page, FIXTURES)
    await page.goto('/sacs')

    await expect(page.getByText('Sacherie')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nouveau mouvement' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Réaffecter entre sociétés' })).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// E2E-16 · clôture de campagne
// ---------------------------------------------------------------------------

test.describe('E2E-16 · clôture de campagne', () => {
  async function stubBlockers(page: Parameters<typeof stubSupabase>[0], canClose: boolean) {
    await page.route('**/rest/v1/rpc/campaign_closure_blockers', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          campaign_id: 'c-2026',
          can_close: canClose,
          blockers: canClose
            ? []
            : [
                {
                  code: 'avances_non_couvertes',
                  count: 2,
                  amount: 1500000,
                  message: '2 avance(s) non couverte(s), soit 1500000 FCFA encore chez les pisteurs.',
                },
                {
                  code: 'incidents_ouverts',
                  count: 1,
                  message:
                    '1 incident(s) sans décision. Clôturer effacerait la question sans y répondre.',
                },
              ],
        }),
      }),
    )
  }

  test('énumère les obstacles au lieu de refuser sans explication', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await stubBlockers(page, false)
    await page.goto('/campagnes')

    await page
      .getByRole('row', { name: /Campagne 2026/ })
      .getByRole('button', { name: 'Préparer la clôture' })
      .click()

    await expect(page.getByText('Avances non couvertes · 2')).toBeVisible()
    await expect(page.getByText('Incidents sans décision · 1')).toBeVisible()
    await expect(page.getByText(/encore chez les pisteurs/)).toBeVisible()
  })

  test('n’autorise le forçage qu’avec un motif circonstancié', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await stubBlockers(page, false)
    await page.goto('/campagnes')

    await page
      .getByRole('row', { name: /Campagne 2026/ })
      .getByRole('button', { name: 'Préparer la clôture' })
      .click()

    const force = page.getByRole('button', { name: 'Forcer la clôture' })
    await expect(force).toBeDisabled()

    await page.getByLabel('Motif').fill('Trop court')
    await expect(force).toBeDisabled()

    await page.getByLabel('Motif').fill('Avances traitées hors système et incident classé par la société.')
    await expect(force).toBeEnabled()
  })

  test('propose une clôture simple quand rien ne bloque', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await stubBlockers(page, true)
    await page.goto('/campagnes')

    await page
      .getByRole('row', { name: /Campagne 2026/ })
      .getByRole('button', { name: 'Préparer la clôture' })
      .click()

    await expect(page.getByText('Aucun obstacle')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Clôturer' })).toBeEnabled()
  })

  test('la réouverture est réservée au propriétaire et exige un motif', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/campagnes')

    await page
      .getByRole('row', { name: /Campagne 2025/ })
      .getByRole('button', { name: 'Rouvrir' })
      .click()

    const submit = page.getByRole('button', { name: 'Rouvrir la campagne' })
    await expect(submit).toBeDisabled()
    await page.getByLabel('Motif de réouverture').fill('Facture reçue après clôture')
    await expect(submit).toBeEnabled()
  })

  test('un gestionnaire ne voit pas le bouton de réouverture', async ({ page }) => {
    await signIn(page, { role: 'gestionnaire', userId: '00000000-0000-4000-8000-000000000012' })
    await stubSupabase(page, FIXTURES)
    await page.goto('/campagnes')

    await expect(page.getByRole('button', { name: 'Préparer la clôture' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rouvrir' })).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// E2E-17 · console plateforme
// ---------------------------------------------------------------------------

const OVERVIEW = {
  tenants: [
    {
      id: TENANT,
      slug: 'lba-demo-bouake',
      commercial_name: 'LBA Démonstration Bouaké',
      tenant_status: 'active',
      subscription_id: 'sub-1',
      subscription_status: 'grace_period',
      period_end: '2026-03-31',
      amount: 120000,
      days_to_expiry: -3,
      plan_name: 'Standard',
      active_users: 14,
      active_agents: 6,
      pending_payments: 1,
    },
  ],
  pending_payments: [
    {
      id: 'pay-1',
      tenant_id: TENANT,
      commercial_name: 'LBA Démonstration Bouaké',
      amount: 120000,
      method: 'wave',
      reference: 'WV-77123',
      payer: 'LBA Bouaké',
      declared_at: '2026-03-30T09:00:00.000Z',
    },
  ],
  support_sessions: [
    {
      id: 'ss-1',
      tenant_id: TENANT,
      commercial_name: 'LBA Démonstration Bouaké',
      reason: 'Analyse d’un écart de poids signalé par le client',
      granted_at: '2026-03-28T10:00:00.000Z',
      expires_at: '2026-03-28T11:00:00.000Z',
      revoked_at: null,
      is_active: false,
    },
  ],
}

test.describe('E2E-17 · console plateforme', () => {
  async function stubOverview(page: Parameters<typeof stubSupabase>[0]) {
    await page.route('**/rest/v1/rpc/platform_overview', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(OVERVIEW),
      }),
    )
  }

  test('montre l’état commercial et aucune donnée métier', async ({ page }) => {
    await signIn(page, { role: 'super_admin', userId: '00000000-0000-4000-8000-000000000010' })
    await stubSupabase(page, { tenant_branding: [BRANDING_FIXTURE] })
    await stubOverview(page)
    await page.goto('/plateforme')

    await expect(page.getByText('Aucune donnée métier n’est visible ici')).toBeVisible()
    const clientRow = page.getByRole('row', { name: /lba-demo-bouake/ })
    await expect(clientRow).toContainText('14')
    await expect(clientRow).toContainText('Standard')
    await expect(page.getByText('grace period')).toBeVisible()
    await expect(page.getByText('J+3')).toBeVisible()
  })

  test('exige une note avant de confirmer un paiement', async ({ page }) => {
    await signIn(page, { role: 'super_admin', userId: '00000000-0000-4000-8000-000000000010' })
    await stubSupabase(page, { tenant_branding: [BRANDING_FIXTURE] })
    await stubOverview(page)
    await page.goto('/plateforme')

    const confirm = page.getByRole('button', { name: 'Confirmer' })
    await expect(confirm).toBeDisabled()

    await page.getByLabel('Note de vérification').fill('Relevé bancaire du 30/03 vérifié')
    await expect(confirm).toBeEnabled()
  })

  test('une session d’assistance exige un motif lisible par le client', async ({ page }) => {
    await signIn(page, { role: 'super_admin', userId: '00000000-0000-4000-8000-000000000010' })
    await stubSupabase(page, { tenant_branding: [BRANDING_FIXTURE] })
    await stubOverview(page)
    await page.goto('/plateforme')

    await page.getByRole('button', { name: 'Assistance' }).click()
    await expect(page.getByText(/inscrits dans le journal du client/)).toBeVisible()

    const submit = page.getByRole('button', { name: 'Ouvrir la session' })
    await expect(submit).toBeDisabled()
    await page.getByLabel('Motif').fill('Analyse d’un écart signalé')
    await expect(submit).toBeEnabled()
  })

  test('suspendre un client exige vingt caractères de motif', async ({ page }) => {
    await signIn(page, { role: 'super_admin', userId: '00000000-0000-4000-8000-000000000010' })
    await stubSupabase(page, { tenant_branding: [BRANDING_FIXTURE] })
    await stubOverview(page)
    await page.goto('/plateforme')

    await page.getByRole('button', { name: 'Suspendre' }).click()
    await expect(page.getByText(/Aucune donnée n’est supprimée/)).toBeVisible()

    const submit = page.getByRole('button', { name: 'Enregistrer' })
    await expect(submit).toBeDisabled()
    await page.getByLabel('Motif').fill('Impayé constaté après trois relances écrites.')
    await expect(submit).toBeEnabled()
  })

  test('reste fermée à un propriétaire de tenant', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, { tenant_branding: [BRANDING_FIXTURE] })
    await page.goto('/plateforme')

    await expect(page.getByText(/réservé aux administrateurs de la plateforme/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Assistance' })).toHaveCount(0)
  })
})
