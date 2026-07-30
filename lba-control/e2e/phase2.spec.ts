import { expect, test } from '@playwright/test'
import { BRANDING_FIXTURE, openNavigation, signIn, stubSupabase } from './support/session'

const TENANT = '00000000-0000-4000-8000-000000000001'

const PARTNERS = [
  {
    id: 'p-olam',
    tenant_id: TENANT,
    code: 'OLAM',
    name: 'OLAM (démo)',
    contact_name: 'Contact OLAM',
    phone: '+225 00 00 00 00',
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
    weight_tolerance_pct: 0.8,
    acceptance_tolerance_pct: null,
    external_access_enabled: false,
    created_at: '2026-01-02',
  },
]

// ---------------------------------------------------------------------------
// E2E-01 · Connexion et identité client
// ---------------------------------------------------------------------------

test.describe('E2E-01 · connexion et marque du tenant', () => {
  test('la page de connexion n’expose aucune liste de clients', async ({ page }) => {
    await stubSupabase(page, {})
    await page.goto('/connexion')

    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    // Une liste déroulante d'entreprises permettrait d'énumérer les clients.
    await expect(page.locator('select')).toHaveCount(0)
    await expect(page.getByLabel('Email ou téléphone')).toBeVisible()
  })

  test('un identifiant vide est refusé avec un message explicite', async ({ page }) => {
    await stubSupabase(page, {})
    await page.goto('/connexion')

    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('alert').first()).toContainText(/Renseignez votre email/)
  })

  test('une fois connecté, la marque du tenant est appliquée', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, { tenant_branding: [BRANDING_FIXTURE] })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()

    // La couleur du tenant est injectée en variable CSS, pas en classe générée.
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
    )
    expect(primary).toBe('#1f6f43')

    // Selon la largeur, le nom du tenant est porté par l'en-tête mobile ou par
    // la barre latérale. Ce qui compte est qu'il soit visible quelque part.
    await expect(page.locator(':text("LBA Démonstration Bouaké"):visible').first()).toBeVisible()
  })

  test('le tableau de bord n’affiche aucun chiffre inventé', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, { tenant_branding: [BRANDING_FIXTURE] })
    await page.goto('/')

    await expect(page.getByText('Socle livré, indicateurs à venir')).toBeVisible()
    // Les indicateurs non calculés affichent « — », jamais 0.
    const placeholders = page.getByLabel('donnée non disponible')
    expect(await placeholders.count()).toBeGreaterThan(10)
  })
})

// ---------------------------------------------------------------------------
// E2E-02 · Société → contrat → prix
// ---------------------------------------------------------------------------

test.describe('E2E-02 · sociétés partenaires et contrats', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, {
      tenant_branding: [BRANDING_FIXTURE],
      partner_companies: PARTNERS,
      contracts: [],
      campaigns: [
        {
          id: 'c-2026',
          tenant_id: TENANT,
          code: 'C2026',
          name: 'Campagne 2026 (démo)',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          status: 'ouverte',
        },
      ],
      products: [{ id: 'prod-rcn', tenant_id: TENANT, code: 'RCN', name: 'Noix brutes de cajou', unit: 'kg', is_active: true }],
      negotiated_prices: [],
    })
  })

  test('les sociétés du tenant sont listées', async ({ page }) => {
    await page.goto('/societes')

    await expect(page.getByRole('heading', { name: 'Sociétés partenaires' })).toBeVisible()
    await expect(page.getByText('OLAM (démo)')).toBeVisible()
    await expect(page.getByText('DORADO (démo)')).toBeVisible()
  })

  test('aucune action de suppression n’est proposée', async ({ page }) => {
    await page.goto('/societes')
    await expect(page.getByText('OLAM (démo)')).toBeVisible()
    // La désactivation n'efface aucune donnée : aucun chemin de suppression.
    await expect(page.getByRole('button', { name: /supprim/i })).toHaveCount(0)
  })

  test('un code de société invalide est refusé avant tout appel serveur', async ({ page }) => {
    await page.goto('/societes')
    await page.getByRole('button', { name: 'Ajouter une société' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Code/).fill('anagroci')
    await dialog.getByLabel(/^Nom/).fill('ANAGROCI (démo)')
    await dialog.getByRole('button', { name: 'Créer la société' }).click()

    await expect(dialog.getByRole('alert')).toContainText(/majuscules, chiffres et tirets/i)
    await expect(dialog).toBeVisible()
  })

  test('une société valide est créée et apparaît dans la liste', async ({ page }) => {
    await page.goto('/societes')
    await page.getByRole('button', { name: 'Ajouter une société' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Code/).fill('ANAGROCI')
    await dialog.getByLabel(/^Nom/).fill('ANAGROCI (démo)')
    await dialog.getByRole('button', { name: 'Créer la société' }).click()

    await expect(page.getByText('ANAGROCI (démo)')).toBeVisible()
  })

  test('la fiche société sépare les règles des indicateurs non encore calculés', async ({ page }) => {
    await page.goto('/societes/p-olam')

    await expect(page.getByRole('heading', { name: 'OLAM (démo)' })).toBeVisible()
    await expect(page.getByText('Tolérance d’écart de poids')).toBeVisible()
    await expect(page.getByText('Alimentée aux phases 3 à 5')).toBeVisible()
  })

  test('un contrat exige une société, une campagne et un produit', async ({ page }) => {
    await page.goto('/contrats')
    await page.getByRole('button', { name: 'Nouveau contrat' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Référence/).fill('CT-TEST-2026')
    await dialog.getByRole('button', { name: 'Créer le contrat' }).click()

    await expect(dialog.getByRole('alert').first()).toContainText(/Sélectionnez une société/)
  })

  test('le fait générateur de la couverture est modifiable contrat par contrat', async ({ page }) => {
    await page.goto('/contrats')
    await page.getByRole('button', { name: 'Nouveau contrat' }).click()

    const dialog = page.getByRole('dialog')
    const coverage = dialog.getByLabel(/Fait générateur/)
    await expect(coverage).toHaveValue('reception_accepted')
    await coverage.selectOption('purchase_validated')
    await expect(coverage).toHaveValue('purchase_validated')
  })
})

// ---------------------------------------------------------------------------
// Cloisonnement par rôle dans l'interface
// ---------------------------------------------------------------------------

test.describe('cloisonnement des actions par rôle', () => {
  test('un auditeur ne se voit proposer aucune action de création', async ({ page }) => {
    await signIn(page, { role: 'auditeur', email: 'auditeur@demo.test' })
    await stubSupabase(page, {
      tenant_branding: [BRANDING_FIXTURE],
      partner_companies: PARTNERS,
    })
    await page.goto('/societes')

    await expect(page.getByText('OLAM (démo)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ajouter une société' })).toHaveCount(0)
  })

  test('un pisteur ne voit ni TCB ni marges dans le menu', async ({ page }) => {
    await signIn(page, { role: 'pisteur', email: 'pisteur@demo.test' })
    await stubSupabase(page, { tenant_branding: [BRANDING_FIXTURE] })
    await page.goto('/')

    await openNavigation(page)
    await expect(page.getByRole('link', { name: 'TCB et marges' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Financements' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Achats' })).toBeVisible()
  })
})
