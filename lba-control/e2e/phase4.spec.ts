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
]

const LOTS = [
  {
    id: 'lot-1',
    tenant_id: TENANT,
    code: 'LOT-0001',
    campaign_id: 'c-2026',
    partner_company_id: 'p-olam',
    contract_id: null,
    field_agent_id: 'a-1',
    product_id: 'prod-rcn',
    site_id: 'site-1',
    holder_type: 'warehouse',
    holder_id: null,
    quantity_kg: 20000,
    bag_count: 250,
    kor: 48,
    humidity: 8,
    status: 'disponible',
    is_own_account: false,
  },
  {
    id: 'lot-2',
    tenant_id: TENANT,
    code: 'LOT-0002',
    campaign_id: 'c-2026',
    partner_company_id: 'p-olam',
    contract_id: null,
    field_agent_id: 'a-1',
    product_id: 'prod-rcn',
    site_id: null,
    holder_type: 'in_transit',
    holder_id: null,
    quantity_kg: 32000,
    bag_count: 400,
    kor: 47,
    humidity: 9,
    status: 'en_transit',
    is_own_account: false,
  },
]

/** 15 tonnes déjà promises sur le lot de 20 t : il n'en reste que 5. */
const RESERVATIONS = [
  {
    id: 'res-1',
    tenant_id: TENANT,
    stock_lot_id: 'lot-1',
    delivery_plan_id: 'plan-1',
    partner_company_id: 'p-olam',
    quantity_kg: 15000,
    status: 'active',
    released_at: null,
    release_reason: null,
  },
]

const TRANSFERS = [
  {
    id: 'tr-1',
    tenant_id: TENANT,
    transfer_number: 'TR-0001',
    partner_company_id: 'p-olam',
    contract_id: null,
    campaign_id: 'c-2026',
    delivery_plan_id: 'plan-1',
    dispatched_at: '2026-03-10T08:00:00.000Z',
    driver_name: 'Chauffeur 1 (démo)',
    tractor_plate: 'AA-001-BC',
    net_loaded_kg: 8000,
    net_unloaded_kg: null,
    accepted_kg: null,
    paid_kg: null,
    weight_source: 'verified',
    weighing_ticket_path: 'tickets/tr-1.jpg',
    ecart_physique_kg: null,
    ecart_physique_pct: null,
    ecart_acceptation_kg: null,
    ecart_paiement_kg: null,
    ecart_total_acceptation_kg: null,
    ecart_financier_total_kg: null,
    tare_variation_kg: null,
    status: 'en_transit',
  },
]

const baseFixtures = {
  tenant_branding: [BRANDING_FIXTURE],
  partner_companies: PARTNERS,
  stock_lots: LOTS,
  stock_reservations: RESERVATIONS,
  transfers: TRANSFERS,
  delivery_plans: [],
  incidents: [],
}

// ---------------------------------------------------------------------------
// E2E-06 · Stock disponible et double réservation
// ---------------------------------------------------------------------------

test.describe('E2E-06 · stocks et réservations', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, baseFixtures)
  })

  test('la quantité disponible retire ce qui est déjà réservé', async ({ page }) => {
    await page.goto('/stocks')

    const row = page.getByRole('row', { name: /LOT-0001/ })
    await expect(row).toContainText(/20\s?000 kg/)
    // 20 t − 15 t réservées = 5 t promettables, et c'est ce chiffre qui compte.
    await expect(row).toContainText(/5\s?000 kg/)
  })

  test('un lot en transit n’est pas promettable', async ({ page }) => {
    await page.goto('/stocks')
    const row = page.getByRole('row', { name: /LOT-0002/ })
    await expect(row).toContainText(/32\s?000 kg/)
    await expect(row).toContainText(/0 kg/)
  })

  test('les états matière sont présentés séparément', async ({ page }) => {
    await page.goto('/stocks')
    // Les libellés apparaissent aussi en en-tête de tableau : on cible les
    // cartes d'indicateurs, qui sont les premières dans le document.
    for (const label of ['En magasin', 'Disponible', 'Réservé', 'En transit']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
  })

  test('une réservation au-delà du solde est refusée avant l’envoi', async ({ page }) => {
    await page.goto('/stocks')
    await page.getByRole('row', { name: /LOT-0001/ }).getByRole('button', { name: 'Réserver' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('available-quantity')).toContainText(/5\s?000 kg/)

    await dialog.getByLabel(/Quantité à réserver/).fill('9000')
    await expect(dialog.getByRole('alert')).toContainText(/dépasse le stock disponible non réservé/)
    await expect(dialog.getByRole('button', { name: '^Réserver$' })).toHaveCount(0)
  })

  test('une réservation dans le solde reste possible', async ({ page }) => {
    await page.goto('/stocks')
    await page.getByRole('row', { name: /LOT-0001/ }).getByRole('button', { name: 'Réserver' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Quantité à réserver/).fill('4000')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// E2E-07 · Les quatre poids
// ---------------------------------------------------------------------------

test.describe('E2E-07 · réception et quatre poids distincts', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, baseFixtures)
  })

  test('le tableau présente les quatre poids en colonnes séparées', async ({ page }) => {
    await page.goto('/transferts')

    // `exact` est indispensable : sans lui, « Chargé » correspond aussi à
    // « Déchargé » et l'assertion devient ambiguë.
    for (const header of ['Chargé', 'Déchargé', 'Accepté', 'Payé']) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible()
    }
    // Aucune colonne générique « livré » n'existe.
    await expect(page.getByRole('columnheader', { name: /livré/i })).toHaveCount(0)
  })

  test('les écarts sont calculés pendant la saisie de la réception', async ({ page }) => {
    await page.goto('/transferts')
    await page.getByRole('button', { name: 'Réceptionner' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Poids déchargé/).fill('7940')
    await dialog.getByLabel(/Poids accepté/).fill('7900')

    const preview = dialog.getByTestId('variance-preview')
    await expect(preview).toContainText(/60 kg/)
    await expect(preview).toContainText(/0\.75 %/)
    // L'écart d'acceptation est distinct de l'écart physique.
    await expect(preview).toContainText(/40 kg/)
  })

  test('un poids accepté supérieur au déchargé est refusé', async ({ page }) => {
    await page.goto('/transferts')
    await page.getByRole('button', { name: 'Réceptionner' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Poids déchargé/).fill('7000')
    await dialog.getByLabel(/Poids accepté/).fill('7500')

    await expect(dialog.getByRole('alert')).toContainText(/ne peut pas dépasser le poids déchargé/)
    await expect(dialog.getByRole('button', { name: /Enregistrer la réception/ })).toBeDisabled()
  })

  test('un poids déchargé supérieur au chargé est refusé avec un message parlant', async ({ page }) => {
    await page.goto('/transferts')
    await page.getByRole('button', { name: 'Réceptionner' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Poids déchargé/).fill('8500')
    await dialog.getByLabel(/Poids accepté/).fill('8500')

    await expect(dialog.getByRole('alert')).toContainText(/ne s’alourdit pas en route/)
  })
})

// ---------------------------------------------------------------------------
// E2E-08 · Incident au-delà du seuil
// ---------------------------------------------------------------------------

test.describe('E2E-08 · écart hors tolérance et incident', () => {
  test('la réception affiche les écarts, la tolérance et son origine', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, baseFixtures)

    await page.route('**/rest/v1/rpc/record_transfer_reception', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          transfer_id: 'tr-1',
          ecart_physique_kg: 60,
          ecart_physique_pct: 0.75,
          ecart_acceptation_kg: 40,
          ecart_paiement_kg: 50,
          ecart_total_acceptation_kg: 100,
          ecart_financier_total_kg: 150,
          tolerance: { value: 0.5, source: 'contrat' },
          exceeds_tolerance: true,
          incident_id: 'inc-1',
        }),
      }),
    )

    await page.goto('/transferts')
    await page.getByRole('button', { name: 'Réceptionner' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Poids déchargé/).fill('7940')
    await dialog.getByLabel(/Poids accepté/).fill('7900')
    await dialog.getByLabel(/Motif du rejet/).fill('Rejet qualité au contrôle')
    await dialog.getByRole('button', { name: /Enregistrer la réception/ }).click()

    const report = dialog.getByTestId('variance-report')
    await expect(report).toContainText('Écart supérieur à la tolérance')
    // Les cinq écarts sont restitués, pas seulement un chiffre global.
    await expect(report).toContainText(/60 kg/)
    await expect(report).toContainText(/40 kg/)
    await expect(report).toContainText(/50 kg/)
    await expect(report).toContainText(/100 kg/)
    await expect(report).toContainText(/150 kg/)
    // La tolérance appliquée ET son origine sont affichées.
    await expect(report).toContainText(/0\.5 %/)
    await expect(report).toContainText(/contrat/)
  })

  test('l’incident ouvert n’impute la responsabilité à personne', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, {
      ...baseFixtures,
      incidents: [
        {
          id: 'inc-1',
          tenant_id: TENANT,
          reference: 'INC-0001',
          type: 'ecart_poids',
          severity: 'grave',
          campaign_id: 'c-2026',
          partner_company_id: 'p-olam',
          field_agent_id: null,
          transfer_id: 'tr-1',
          description:
            'Écart de 0.75 % entre le poids chargé (8000 kg) et le poids déchargé (7940 kg), ' +
            'au-dessus de la tolérance de 0.5 % (source : contrat). Causes à examiner avant toute ' +
            'conclusion : perte d’humidité, écart d’étalonnage entre ponts-bascules, variation de ' +
            'tare, perte en transport, erreur de saisie.',
          exposed_quantity_kg: 60,
          exposed_amount: 27000,
          suspected_responsible_type: 'inconnu',
          suspected_responsible_id: null,
          status: 'ouvert',
          decision: null,
          decision_cause: null,
          blocks_closure: true,
          opened_at: '2026-03-11T10:00:00.000Z',
        },
      ],
    })

    await page.goto('/incidents')

    await expect(page.getByText('Un écart n’est pas une accusation')).toBeVisible()
    await expect(page.getByRole('row', { name: /INC-0001/ })).toContainText('Non déterminé')
    await expect(page.getByRole('row', { name: /INC-0001/ })).toContainText('bloquée')

    // Les causes techniques sont proposées avant toute conclusion.
    await expect(page.getByText(/perte d’humidité/)).toBeVisible()
    await expect(page.getByText(/étalonnage entre ponts-bascules/)).toBeVisible()
  })

  test('établir une responsabilité demande une confirmation explicite', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, {
      ...baseFixtures,
      incidents: [
        {
          id: 'inc-1',
          tenant_id: TENANT,
          reference: 'INC-0001',
          type: 'ecart_poids',
          severity: 'grave',
          campaign_id: null,
          partner_company_id: null,
          field_agent_id: null,
          transfer_id: 'tr-1',
          description: 'Écart de poids constaté à la réception.',
          exposed_quantity_kg: 60,
          exposed_amount: 27000,
          suspected_responsible_type: 'inconnu',
          suspected_responsible_id: null,
          status: 'ouvert',
          decision: null,
          decision_cause: null,
          blocks_closure: true,
          opened_at: '2026-03-11T10:00:00.000Z',
        },
      ],
    })

    await page.goto('/incidents')
    await page.getByRole('button', { name: 'Décider' }).click()

    const dialog = page.getByRole('dialog')
    // La décision est refusée tant que cause et justification manquent.
    await expect(dialog.getByRole('button', { name: /Enregistrer la décision/ })).toBeDisabled()

    await dialog.getByLabel(/Cause retenue/).selectOption('responsabilite_confirmee')
    await expect(dialog.getByText(/causes techniques ont été écartées/)).toBeVisible()

    await dialog.getByLabel(/Décision et justification/).fill('Responsabilité établie après enquête contradictoire')
    await expect(dialog.getByRole('button', { name: /Enregistrer la décision/ })).toBeEnabled()
  })
})
