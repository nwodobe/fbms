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

const CAMPAIGNS = [
  {
    id: 'c-2026',
    tenant_id: TENANT,
    code: 'C2026',
    name: 'Campagne 2026 (démo)',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    status: 'ouverte',
  },
]

const AGENTS = [
  {
    id: 'a-1',
    tenant_id: TENANT,
    user_id: null,
    code: 'PIS-001',
    full_name: 'KOUAME Yao (démo)',
    phone: '+225 07 00 00 01',
    zone_id: null,
    mobile_money_account: 'WAVE-001',
    ceiling_amount: 5_000_000,
    activation_date: '2026-01-05',
    status: 'actif',
    commission_mode: 'par_kg',
    commission_value: 5,
  },
]

const FUNDINGS = [
  {
    id: 'f-1',
    tenant_id: TENANT,
    partner_company_id: 'p-olam',
    contract_id: null,
    campaign_id: 'c-2026',
    amount: 20_000_000,
    received_at: '2026-02-01',
    reference: 'FIN-001',
    payment_method: 'bank_transfer',
    reference_price: 450,
    theoretical_volume_kg: 44_444.444,
    coverage_deadline: '2026-04-01',
    status: 'affecte',
  },
]

const baseFixtures = {
  tenant_branding: [BRANDING_FIXTURE],
  partner_companies: PARTNERS,
  campaigns: CAMPAIGNS,
  field_agents: AGENTS,
  fundings: FUNDINGS,
  advances: [],
  purchases: [],
  purchase_duplicate_flags: [],
  contracts: [],
  products: [],
}

// ---------------------------------------------------------------------------
// E2E-03 · Financement reçu et volume théorique
// ---------------------------------------------------------------------------

test.describe('E2E-03 · financements reçus', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, baseFixtures)
  })

  test('rappelle qu’un financement reçu n’est pas une dépense', async ({ page }) => {
    await page.goto('/financements')
    await expect(page.getByText('Un financement reçu n’est pas une dépense')).toBeVisible()
  })

  test('affiche le volume théorique comme indicatif', async ({ page }) => {
    await page.goto('/financements')
    await expect(page.getByRole('cell', { name: /44\s?444/ })).toBeVisible()
  })

  test('calcule le volume théorique pendant la saisie', async ({ page }) => {
    await page.goto('/financements')
    await page.getByRole('button', { name: 'Enregistrer un financement' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Montant reçu/).fill('9000000')
    await dialog.getByLabel(/Prix de référence/).fill('450')

    const preview = dialog.getByTestId('theoretical-volume')
    await expect(preview).toContainText(/20\s?000 kg/)
    // L'écran doit dire explicitement que ce volume ne prouve rien.
    await expect(preview).toContainText(/indicative/)
  })
})

// ---------------------------------------------------------------------------
// E2E-04 · Avance avec contrôle de plafond
// ---------------------------------------------------------------------------

test.describe('E2E-04 · avances et contrôle de plafond', () => {
  test('un dépassement exige une dérogation motivée, et ne suspend personne', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, baseFixtures)

    // Le contrôle de capacité est une fonction serveur : on simule sa réponse.
    await page.route('**/rest/v1/rpc/check_advance_capacity', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          issues: [
            {
              reason: 'plafond_global_depasse',
              severity: 'blocage',
              measured: 8_000_000,
              threshold: 5_000_000,
              message:
                'Cette avance porterait l’exposition à 8 000 000 FCFA, au-dessus du plafond de 5 000 000 FCFA.',
            },
          ],
          can_proceed: false,
          requires_override: true,
          has_hard_block: false,
          exposure: { advanced: 5_000_000, covered: 0, exposure: 5_000_000, oldest_outstanding_age_days: 3 },
        }),
      }),
    )

    await page.goto('/avances')
    await page.getByRole('button', { name: 'Nouvelle avance' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Pisteur/).selectOption('a-1')
    await dialog.getByLabel(/Société d’origine/).selectOption('p-olam')
    await dialog.getByLabel(/^Campagne/).selectOption('c-2026')
    await dialog.getByLabel(/^Montant/).fill('3000000')

    const report = dialog.getByTestId('capacity-report')
    await expect(report).toContainText('Dérogation requise')
    await expect(report).toContainText(/au-dessus du plafond/)

    // Le motif est obligatoire : sans lui, le décaissement reste impossible.
    const submit = dialog.getByRole('button', { name: /Décaisser avec dérogation/ })
    await expect(submit).toBeDisabled()

    await dialog.getByLabel(/Motif de la dérogation/).fill('Campagne exceptionnelle validée en comité')
    await expect(submit).toBeEnabled()
  })

  test('un blocage définitif ne peut pas être contourné', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, baseFixtures)

    await page.route('**/rest/v1/rpc/check_advance_capacity', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          issues: [
            {
              reason: 'pisteur_suspendu',
              severity: 'blocage',
              message: 'Ce pisteur n’est pas actif. Aucune nouvelle avance ne peut lui être remise.',
            },
          ],
          can_proceed: false,
          requires_override: false,
          has_hard_block: true,
          exposure: { advanced: 0, covered: 0, exposure: 0, oldest_outstanding_age_days: 0 },
        }),
      }),
    )

    await page.goto('/avances')
    await page.getByRole('button', { name: 'Nouvelle avance' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Pisteur/).selectOption('a-1')
    await dialog.getByLabel(/Société d’origine/).selectOption('p-olam')
    await dialog.getByLabel(/^Campagne/).selectOption('c-2026')
    await dialog.getByLabel(/^Montant/).fill('100000')

    await expect(dialog.getByTestId('capacity-report')).toContainText('Décaissement impossible')
    // Aucun champ de dérogation n'est proposé : une suspension n'est pas un seuil.
    await expect(dialog.getByLabel(/Motif de la dérogation/)).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /^Décaisser$/ })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// E2E-05 · Achat terrain, en ligne et hors ligne
// ---------------------------------------------------------------------------

test.describe('E2E-05 · achats terrain et file hors ligne', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, baseFixtures)
  })

  test('le montant est calculé, jamais saisi', async ({ page }) => {
    await page.goto('/achats')
    await page.getByRole('button', { name: 'Nouvel achat' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Poids net/).fill('8200')
    await dialog.getByLabel(/Prix \(FCFA\/kg\)/).fill('430')

    await expect(dialog.getByTestId('computed-amount')).toContainText(/3\s?526\s?000 FCFA/)
    // Aucun champ « montant » n'existe : il ne peut pas diverger du poids.
    await expect(dialog.getByLabel(/^Montant/)).toHaveCount(0)
  })

  test('l’état de synchronisation est visible en permanence', async ({ page }) => {
    await page.goto('/achats')
    await expect(page.getByTestId('sync-status')).toBeVisible()
    await expect(page.getByTestId('sync-status')).toContainText(/Connecté|Hors connexion/)
  })

  test('hors connexion, l’achat est conservé sur l’appareil', async ({ page, context }) => {
    await page.goto('/achats')

    await context.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    await page.getByRole('button', { name: 'Nouvel achat' }).click()
    const dialog = page.getByRole('dialog')

    // L'écran prévient AVANT la saisie : le pisteur sait où il en est.
    await expect(dialog.getByText(/Vous êtes hors connexion/)).toBeVisible()

    await dialog.getByLabel(/^Pisteur/).selectOption('a-1')
    await dialog.getByLabel(/^Campagne/).selectOption('c-2026')
    await dialog.getByLabel(/Poids net/).fill('1500')
    await dialog.getByLabel(/Prix \(FCFA\/kg\)/).fill('430')
    await dialog.getByRole('button', { name: /Enregistrer l’achat/ }).click()

    await expect(page.getByRole('status').filter({ hasText: /enregistré sur l'appareil|conservé/ }))
      .toBeVisible({ timeout: 10_000 })

    // L'opération est réellement dans IndexedDB, pas seulement affichée.
    const queued = await page.evaluate(async () => {
      return new Promise<number>((resolve) => {
        const request = indexedDB.open('lba-control-offline')
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('operations', 'readonly')
          const count = tx.objectStore('operations').count()
          count.onsuccess = () => resolve(count.result)
          count.onerror = () => resolve(-1)
        }
        request.onerror = () => resolve(-1)
      })
    })
    expect(queued).toBeGreaterThan(0)

    await context.setOffline(false)
  })

  test('un doublon probable est signalé sans bloquer', async ({ page }) => {
    await stubSupabase(page, {
      ...baseFixtures,
      purchases: [
        {
          id: 'pu-1',
          tenant_id: TENANT,
          field_agent_id: 'a-1',
          partner_company_id: 'p-olam',
          campaign_id: 'c-2026',
          supplier_id: null,
          supplier_name: 'Producteur Un (démo)',
          village: 'Sakassou (démo)',
          purchased_at: '2026-03-10T09:00:00.000Z',
          net_weight_kg: 8200,
          price_per_kg: 430,
          amount: 3_526_000,
          bag_count: 103,
          payment_method: 'cash',
          status: 'valide',
          sync_status: 'synced',
          device_id: 'device-1',
          is_own_account: false,
        },
      ],
      purchase_duplicate_flags: [
        {
          id: 'flag-1',
          tenant_id: TENANT,
          purchase_id: 'pu-1',
          candidate_id: 'pu-0',
          similarity_score: 92.5,
          matched_criteria: ['pisteur', 'vendeur', 'poids', 'montant'],
          status: 'a_verifier',
        },
      ],
    })

    await page.goto('/achats')
    await expect(page.getByText('doublon probable')).toBeVisible()
    // Signalé, mais la ligne reste présente et lisible : rien n'est bloqué.
    await expect(page.getByText('Producteur Un (démo)')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Cloisonnement du pisteur sur les écrans de phase 3
// ---------------------------------------------------------------------------

test.describe('cloisonnement du pisteur', () => {
  test('un pisteur accède aux achats mais pas aux financements', async ({ page }) => {
    await signIn(page, { role: 'pisteur', email: 'pisteur@demo.test' })
    await stubSupabase(page, baseFixtures)

    await page.goto('/achats')
    await expect(page.getByRole('heading', { name: 'Achats terrain' })).toBeVisible()

    // L'entrée n'existe pas dans son menu : il n'a pas à savoir ce qu'il ne
    // peut pas consulter.
    await expect(page.getByRole('link', { name: 'Financements' })).toHaveCount(0)
  })
})
