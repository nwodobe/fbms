import { expect, test, type Page } from '@playwright/test'
import { BRANDING_FIXTURE, signIn, stubStorage, stubSupabase } from './support/session'

/**
 * E2E-18 → E2E-20 · justificatifs.
 *
 * Ces parcours vérifient ce que les règles serveur supposent déjà : qu'un
 * ticket de pesée, une preuve d'achat et un logo puissent réellement être
 * déposés depuis les écrans qui les exigent.
 *
 * Trois propriétés sont contrôlées, et ce sont les trois qui font la valeur d'un
 * justificatif :
 *
 *  · un fichier qui n'est pas ce qu'il prétend être est refusé **avant** l'envoi ;
 *  · hors réseau, le fichier est conservé et l'opération est annoncée **sans**
 *    justificatif — jamais l'inverse ;
 *  · aucune adresse permanente n'est produite : la consultation passe par un
 *    lien temporaire.
 */

const TENANT = '00000000-0000-4000-8000-000000000001'

/** Vrais octets d'un PNG minuscule : la signature est vérifiée, pas l'extension. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6360000002000100ffff0300000600' +
    '0557bfabd4000000004945454e44ae426082',
  'hex',
)

const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')

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

const AGENTS = [
  {
    id: 'a-1',
    tenant_id: TENANT,
    code: 'PIS-001',
    full_name: 'KONE Ibrahim (démo)',
    phone: null,
    zone_id: null,
    ceiling_amount: 5_000_000,
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
    product_id: null,
    start_date: '2026-01-01',
    end_date: '2026-08-31',
    status: 'active',
  },
]

const transfer = (over: Record<string, unknown> = {}) => ({
  id: 'tr-1',
  tenant_id: TENANT,
  transfer_number: 'TR-0001',
  partner_company_id: 'p-olam',
  contract_id: null,
  campaign_id: 'c-2026',
  delivery_plan_id: null,
  dispatched_at: '2026-03-10T08:00:00.000Z',
  driver_name: 'Chauffeur 1 (démo)',
  tractor_plate: 'AA-001-BC',
  net_loaded_kg: 8000,
  net_unloaded_kg: null,
  accepted_kg: null,
  paid_kg: null,
  weight_source: 'estimated_bags',
  weighing_ticket_path: null,
  reception_ticket_path: null,
  ecart_physique_kg: null,
  ecart_physique_pct: null,
  ecart_acceptation_kg: null,
  ecart_paiement_kg: null,
  ecart_total_acceptation_kg: null,
  ecart_financier_total_kg: null,
  tare_variation_kg: null,
  status: 'en_transit',
  ...over,
})

const fixtures = (over: Record<string, unknown[]> = {}) => ({
  tenant_branding: [structuredClone(BRANDING_FIXTURE)],
  partner_companies: PARTNERS,
  field_agents: AGENTS,
  campaigns: CAMPAIGNS,
  transfers: [transfer()],
  purchases: [],
  purchase_duplicate_flags: [],
  stock_lots: [],
  stock_reservations: [],
  delivery_plans: [],
  incidents: [],
  ...over,
})

/** Chaque test part d'une base locale vierge : la file est persistante. */
async function clearLocalQueue(page: Page): Promise<void> {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('lba-control-offline')
  })
}

// ---------------------------------------------------------------------------
// E2E-18 · Marque
// ---------------------------------------------------------------------------

test.describe('E2E-18 · images de la marque', () => {
  test('les trois emplacements sont distincts et se déposent séparément', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    const data = await stubSupabase(page, fixtures())
    const storage = await stubStorage(page)

    await page.goto('/marque')

    for (const label of ['Logo principal', 'Logo mobile', 'Image de connexion']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }

    await page
      .getByTestId('proof-input-logo_path')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })

    await expect(page.getByTestId('proof-logo_path').getByText('Consulter le justificatif')).toBeVisible()

    // Le chemin porte le tenant en premier segment : c'est ce qui rend le
    // cloisonnement applicable par politique de bucket.
    expect(storage.uploads.some((path) => path.includes(`marque/${TENANT}/logo/`))).toBe(true)

    // Et il est bien enregistré sur la ligne, pas seulement affiché.
    await expect
      .poll(() => (data.tenant_branding?.[0] as Record<string, unknown>)?.logo_path)
      .toEqual(expect.stringContaining(TENANT))
  })

  test('un fichier renommé en .png mais qui n’en est pas un est refusé', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(page, fixtures())
    const storage = await stubStorage(page)

    await page.goto('/marque')
    await page.getByTestId('proof-input-logo_path').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('MZ\x90\x00 ceci est un exécutable', 'binary'),
    })

    await expect(page.getByRole('alert')).toContainText(/Format non reconnu/)
    // Rien n'est parti : le contrôle a lieu avant l'envoi, pas après.
    expect(storage.uploads).toEqual([])
  })

  test('la consultation passe par un lien temporaire, jamais par une adresse fixe', async ({
    page,
  }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(
      page,
      fixtures({
        tenant_branding: [{ ...BRANDING_FIXTURE, logo_path: `${TENANT}/logo/2026-07-31/x.png` }],
      }),
    )
    await stubStorage(page)

    const signRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/object/sign/')) signRequests.push(request.url())
    })

    await page.goto('/marque')

    // Aucune adresse publique n'est présente dans la page : rien à copier, rien
    // à laisser traîner. Seul le nom de fichier est montré.
    expect(await page.content()).not.toContain('/object/public/')

    await page.getByTestId('proof-logo_path').getByText('Consulter le justificatif').click()

    // Le lien est demandé au moment du clic, et redemandé à chaque consultation.
    await expect.poll(() => signRequests.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// E2E-21 · Logo dans les documents exportés
// ---------------------------------------------------------------------------

const DASHBOARD_FIXTURES = (branding: Record<string, unknown>) => ({
  tenant_branding: [branding],
  partner_companies: PARTNERS,
  campaigns: CAMPAIGNS,
  purchases: [
    {
      id: 'pu-1',
      tenant_id: TENANT,
      campaign_id: 'c-2026',
      partner_company_id: 'p-olam',
      field_agent_id: 'a-1',
      net_weight_kg: 8000,
      amount: 3_526_000,
      purchased_at: '2026-03-10T08:00:00.000Z',
      status: 'valide',
      sync_status: 'synced',
    },
  ],
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

test.describe('E2E-21 · logo dans les documents exportés', () => {
  test('le document sort même quand le logo est introuvable, et le dit', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(
      page,
      DASHBOARD_FIXTURES({ ...BRANDING_FIXTURE, logo_path: `${TENANT}/logo/absent.png` }),
    )
    const storage = await stubStorage(page)
    storage.offline = true

    const download = page.waitForEvent('download')
    await page.goto('/')
    await page.getByRole('button', { name: 'Exporter en PDF' }).click()

    // Le rapport est ce dont l'utilisateur a besoin, pas l'image : refuser
    // d'exporter parce qu'une image manque serait disproportionné.
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
    // Mais un document parti sans le logo déposé est une surprise désagréable à
    // découvrir chez son acheteur : on le dit.
    await expect(page.getByTestId('logo-notice')).toContainText(/sans logo/)
  })

  test('aucune alerte quand le client n’a déposé aucun logo', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(page, DASHBOARD_FIXTURES({ ...BRANDING_FIXTURE, logo_path: null }))
    await stubStorage(page)

    const download = page.waitForEvent('download')
    await page.goto('/')
    await page.getByRole('button', { name: 'Exporter en Excel' }).click()

    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/)
    // La plupart des clients ne déposent pas de logo : les alerter à chaque
    // export serait du bruit.
    await expect(page.getByTestId('logo-notice')).toHaveCount(0)
  })

  test('le logo du client apparaît dans la barre de navigation', async ({ page }, testInfo) => {
    // La barre latérale est celle du bureau. Sur un téléphone, l'en-tête est
    // trop étroit pour un logo et ne porte que le nom : ce n'est pas un défaut,
    // c'est le choix de mise en page, vérifié par le test suivant.
    test.skip(testInfo.project.name !== 'bureau', 'Barre latérale masquée sur écran étroit.')

    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(
      page,
      DASHBOARD_FIXTURES({ ...BRANDING_FIXTURE, logo_path: `${TENANT}/logo/x.png` }),
    )
    await stubStorage(page)

    await page.goto('/')

    const logo = page.getByRole('img', { name: 'LBA Démonstration Bouaké' })
    await expect(logo).toBeVisible()
    // Le bucket est privé : un chemin de stockage n'est pas une adresse, et le
    // poser tel quel produirait une image cassée.
    await expect(logo).toHaveAttribute('src', /token=/)
  })

  test('sur téléphone, l’en-tête porte le nom sans tenter d’afficher le logo', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-android', 'Comportement propre à l’écran étroit.')

    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(
      page,
      DASHBOARD_FIXTURES({ ...BRANDING_FIXTURE, logo_path: `${TENANT}/logo/x.png` }),
    )
    await stubStorage(page)

    await page.goto('/')

    await expect(page.getByText('LBA Démonstration Bouaké').first()).toBeVisible()
    await expect(page.getByRole('img', { name: 'LBA Démonstration Bouaké' })).toBeHidden()
  })
})

// ---------------------------------------------------------------------------
// E2E-19 · Tickets de pesée
// ---------------------------------------------------------------------------

test.describe('E2E-19 · tickets de pesée', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
  })

  test('un transfert sans ticket de départ propose de le joindre', async ({ page }) => {
    const data = await stubSupabase(page, fixtures())
    const storage = await stubStorage(page)

    await page.goto('/transferts')
    await page.getByRole('row', { name: /TR-0001/ }).getByRole('button', { name: 'Joindre' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(/Sans ticket, un poids ne peut pas être déclaré vérifié/)

    await dialog
      .getByTestId('proof-input-weighing_ticket_path')
      .setInputFiles({ name: 'pont-bascule.jpg', mimeType: 'image/jpeg', buffer: JPEG })

    await expect(dialog.getByText('Consulter le justificatif')).toBeVisible()
    expect(storage.uploads.length).toBeGreaterThan(0)

    // Le ticket du départ est rangé sous son propre nom, distinct de celui de
    // la réception : ranger les deux au même endroit en effacerait un.
    await expect
      .poll(() => (data.transfers?.[0] as Record<string, unknown>)?.weighing_ticket_path)
      .toEqual(expect.stringContaining('weighing_ticket_path'))
  })

  test('un ticket déjà joint n’est plus proposé au dépôt', async ({ page }) => {
    await stubSupabase(
      page,
      fixtures({ transfers: [transfer({ weighing_ticket_path: `${TENANT}/ticket/x.jpg` })] }),
    )
    await stubStorage(page)

    await page.goto('/transferts')
    const row = page.getByRole('row', { name: /TR-0001/ })
    await expect(row).toContainText('joint')
    await expect(row.getByRole('button', { name: 'Joindre' })).toHaveCount(0)
  })

  test('la réception porte son propre ticket, distinct de celui du départ', async ({ page }) => {
    await stubSupabase(page, fixtures())
    await stubStorage(page)

    await page.goto('/transferts')
    await page.getByRole('row', { name: /TR-0001/ }).getByRole('button', { name: 'Réceptionner' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Ticket de pesée (réception)')).toBeVisible()
    await expect(dialog.getByTestId('proof-input-reception_ticket_path')).toHaveCount(1)
    // L'emplacement du départ n'est pas celui de la réception : les confondre
    // effacerait la moitié de la preuve d'un écart.
    await expect(dialog.getByTestId('proof-input-weighing_ticket_path')).toHaveCount(0)
  })

  test('un comptable ne se voit pas proposer de joindre un ticket', async ({ page }) => {
    await signIn(page, { role: 'comptable' })
    await stubSupabase(page, fixtures())
    await stubStorage(page)

    await page.goto('/transferts')
    await expect(page.getByRole('button', { name: 'Joindre' })).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// E2E-20 · Preuve d'achat, y compris hors réseau
// ---------------------------------------------------------------------------

test.describe('E2E-20 · preuve d’achat', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
  })

  test('la preuve part avec l’achat quand le réseau est là', async ({ page }) => {
    await stubSupabase(page, fixtures())
    const storage = await stubStorage(page)

    await page.goto('/achats')
    await page.getByRole('button', { name: 'Nouvel achat' }).click()

    const dialog = page.getByRole('dialog')
    await dialog
      .getByTestId('proof-input-proof_path')
      .setInputFiles({ name: 'recu.jpg', mimeType: 'image/jpeg', buffer: JPEG })

    await expect(dialog.getByText('Consulter le justificatif')).toBeVisible()
    expect(storage.uploads.some((path) => path.includes('preuves/'))).toBe(true)
  })

  test('hors réseau, le fichier est gardé et l’achat est annoncé SANS justificatif', async ({
    page,
  }) => {
    await stubSupabase(page, fixtures())
    const storage = await stubStorage(page)
    storage.offline = true

    await page.goto('/achats')
    await page.getByRole('button', { name: 'Nouvel achat' }).click()

    const dialog = page.getByRole('dialog')
    await dialog
      .getByTestId('proof-input-proof_path')
      .setInputFiles({ name: 'recu.jpg', mimeType: 'image/jpeg', buffer: JPEG })

    // Le fichier est conservé…
    await expect(dialog.getByRole('status').first()).toContainText(/conservé sur cet appareil/i)
    // …et surtout : rien ne prétend qu'un justificatif est joint.
    await expect(dialog.getByText('Consulter le justificatif')).toHaveCount(0)

    expect(storage.uploads).toEqual([])
  })

  test('la file annonce les justificatifs qui attendent encore', async ({ page }) => {
    await stubSupabase(page, fixtures())
    const storage = await stubStorage(page)
    storage.offline = true

    await page.goto('/achats')
    await page.getByRole('button', { name: 'Nouvel achat' }).click()
    await page
      .getByRole('dialog')
      .getByTestId('proof-input-proof_path')
      .setInputFiles({ name: 'recu.jpg', mimeType: 'image/jpeg', buffer: JPEG })
    await page.keyboard.press('Escape')

    await expect(page.getByTestId('attachment-status')).toContainText(/pas encore rattachés/)
  })

  test('un fichier trop volumineux est refusé avant de consommer le forfait', async ({ page }) => {
    await stubSupabase(page, fixtures())
    const storage = await stubStorage(page)

    await page.goto('/achats')
    await page.getByRole('button', { name: 'Nouvel achat' }).click()

    // 5 Mo pour une limite de 4 Mo sur la preuve d'achat.
    const tooBig = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)])
    await page
      .getByRole('dialog')
      .getByTestId('proof-input-proof_path')
      .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: tooBig })

    await expect(page.getByRole('alert')).toContainText(/trop volumineux/)
    expect(storage.uploads).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// E2E-22 · Tâches planifiées, vues de la console plateforme
// ---------------------------------------------------------------------------

const PLATFORM_ADMIN = { userId: '00000000-0000-4000-8000-000000000010', role: 'super_admin' }

const EMPTY_OVERVIEW = { tenants: [], pending_payments: [], support_sessions: [] }

async function stubPlatform(
  page: Page,
  runs: Array<Record<string, unknown>>,
): Promise<void> {
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  })

  await page.route('**/rest/v1/rpc/platform_overview', (route) => route.fulfill(json(EMPTY_OVERVIEW)))
  await page.route('**/rest/v1/rpc/scheduled_task_history', (route) => route.fulfill(json(runs)))
}

test.describe('E2E-22 · tâches planifiées', () => {
  test('une exécution réussie est présentée avec ce qu’elle a changé', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page, PLATFORM_ADMIN)
    await stubSupabase(page, fixtures())
    await stubPlatform(page, [
      {
        id: 'run-1',
        task: 'subscription_lifecycle',
        started_at: '2026-07-31T02:10:00.000Z',
        finished_at: '2026-07-31T02:10:04.000Z',
        status: 'succeeded',
        tenants_seen: 42,
        changes: 3,
        detail_count: 3,
        error_count: 0,
        error: null,
      },
    ])

    await page.goto('/plateforme')

    const row = page.getByRole('row', { name: /Cycle d’abonnement/ })
    await expect(row).toContainText('42')
    await expect(row).toContainText('terminée')
  })

  test('des anomalies sont comptées, jamais noyées dans un « terminée »', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page, PLATFORM_ADMIN)
    await stubSupabase(page, fixtures())
    await stubPlatform(page, [
      {
        id: 'run-2',
        task: 'alert_evaluation',
        started_at: '2026-07-31T04:30:00.000Z',
        finished_at: '2026-07-31T04:30:09.000Z',
        status: 'succeeded',
        tenants_seen: 42,
        changes: 17,
        detail_count: 19,
        error_count: 2,
        error: null,
      },
    ])

    await page.goto('/plateforme')

    // Une exécution qui a laissé deux clients de côté n'est pas « terminée »
    // tout court : le nombre d'anomalies doit sauter aux yeux.
    const row = page.getByRole('row', { name: /Évaluation des alertes/ })
    await expect(row).toContainText('2')
  })

  test('l’absence d’exécution est dite, pas laissée à deviner', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page, PLATFORM_ADMIN)
    await stubSupabase(page, fixtures())
    await stubPlatform(page, [])

    await page.goto('/plateforme')

    // Un tableau vide se lit « tout va bien ». Une tâche absente se remarque
    // tard : le jour où un client se plaint de ne pas avoir été prévenu.
    await expect(page.getByTestId('no-task-run')).toContainText(/il ne tourne pas/)
  })
})

// ---------------------------------------------------------------------------
// E2E-23 · Centre de notifications
// ---------------------------------------------------------------------------

const notification = (over: Record<string, unknown> = {}) => ({
  id: 'no-1',
  tenant_id: TENANT,
  user_id: '00000000-0000-4000-8000-000000000011',
  title: 'Avance non couverte',
  body: 'L’avance de 5 000 000 FCFA n’est couverte par aucune livraison depuis 9 jours.',
  alert_id: 'al-1',
  read_at: null,
  created_at: '2026-07-31T06:00:00.000Z',
  alerts: { severity: 'critique', status: 'ouverte' },
  ...over,
})

test.describe('E2E-23 · centre de notifications', () => {
  test('la cloche porte le nombre de non-lues et mène à l’écran', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(page, fixtures({ notifications: [notification(), notification({ id: 'no-2' })] }))
    await stubStorage(page)

    await page.goto('/')

    // Deux cloches existent — l'en-tête étroit et la barre latérale — mais une
    // seule est visible selon la largeur. C'est celle-là qu'un utilisateur
    // clique.
    await expect(page.locator('[data-testid="notification-badge"]:visible')).toHaveText('2')
    await page.locator('[data-testid="notification-bell"]:visible').click()

    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    await expect(page.getByTestId('notification')).toHaveCount(2)
  })

  test('aucune pastille quand tout est lu', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(
      page,
      fixtures({
        notifications: [notification({ read_at: '2026-07-31T07:00:00.000Z' })],
      }),
    )
    await stubStorage(page)

    await page.goto('/')

    // Une pastille à zéro attire l'œil pour rien, et un indicateur permanent
    // finit par ne plus être vu du tout.
    await expect(page.getByTestId('notification-badge')).toHaveCount(0)
  })

  test('une notification lue dont la situation dure reste signalée', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(
      page,
      fixtures({
        notifications: [
          notification({
            read_at: '2026-07-31T07:00:00.000Z',
            alerts: { severity: 'blocage', status: 'ouverte' },
          }),
        ],
      }),
    )
    await stubStorage(page)

    await page.goto('/notifications')

    // « Tout marquer comme lu » ne doit pas donner l'illusion d'avoir traité.
    await expect(page.getByText('1 situation(s) encore ouverte(s)')).toBeVisible()
    await expect(page.getByText('situation non réglée')).toBeVisible()
    await expect(page.getByText(/Marquer comme lu range cet écran/)).toBeVisible()
  })

  test('l’urgent passe devant le récent', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(
      page,
      fixtures({
        notifications: [
          notification({
            id: 'recent-info',
            title: 'Livraison prévue demain',
            created_at: '2026-07-31T09:59:00.000Z',
            alerts: { severity: 'info', status: 'ouverte' },
          }),
          notification({
            id: 'vieux-blocage',
            title: 'Écart supérieur à la tolérance',
            created_at: '2026-07-31T01:00:00.000Z',
            alerts: { severity: 'blocage', status: 'ouverte' },
          }),
        ],
      }),
    )
    await stubStorage(page)

    await page.goto('/notifications')

    // Trier par date ferait glisser un blocage hors de l'écran à mesure que des
    // informations arrivent.
    const first = page.getByTestId('notification').first()
    await expect(first).toContainText('Écart supérieur à la tolérance')
  })

  test('un écran vide dit ce qu’il attend', async ({ page }) => {
    await clearLocalQueue(page)
    await signIn(page)
    await stubSupabase(page, fixtures({ notifications: [] }))
    await stubStorage(page)

    await page.goto('/notifications')

    await expect(page.getByText('Rien à signaler')).toBeVisible()
    await expect(page.getByText(/évaluées deux fois par jour/)).toBeVisible()
  })
})
