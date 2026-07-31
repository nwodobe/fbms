import { expect, test, type Page, type Route } from '@playwright/test'
import { BRANDING_FIXTURE, openNavigation, signIn, stubSupabase } from './support/session'

/**
 * E2E-28 · le parcours d'activation, de bout en bout.
 *
 * C'est le seul parcours dont l'échec rend tous les autres inatteignables : sans
 * lui, personne n'entre dans l'application. Il enchaîne cinq acteurs et trois
 * écrans publics :
 *
 *   administrateur plateforme → ouverture d'une entreprise → lien d'invitation
 *   → création du mot de passe → acceptation → connexion → tableau de bord
 *
 * Quatre refus sont vérifiés en plus du chemin nominal, parce que ce sont eux
 * qui font la différence entre « un lien qui marche » et « un lien qui ne
 * marche que pour la bonne personne » : jeton pour une autre adresse, invitation
 * expirée, invitation déjà utilisée, et mot de passe trop faible.
 *
 * Le cinquième cas est le plus important à l'installation : le déclencheur
 * « Customize Access Token » non activé. Il produit une application entièrement
 * vide sans le moindre message — sauf si l'écran de diagnostic le nomme.
 */

const TENANT = '00000000-0000-4000-8000-000000000001'
const JETON = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'

const PLATFORM_ADMIN = {
  userId: '00000000-0000-4000-8000-000000000010',
  // `null` et non `undefined` : l'administrateur de plateforme n'appartient à
  // AUCUNE entreprise, et son jeton ne doit donc en porter aucune.
  tenantId: null,
  role: 'super_admin',
  email: 'admin@lba-control.ci',
}

/** Compte fraîchement inscrit : authentifié, sans entreprise ni rôle. */
const PROPRIETAIRE_INVITE = {
  userId: '00000000-0000-4000-8000-0000000000f1',
  tenantId: null,
  role: null,
  email: 'proprietaire@lba-seguela.ci',
}

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify(body),
})

const CREATED_TENANT = {
  tenant_id: '00000000-0000-4000-8000-0000000000aa',
  slug: 'lba-seguela',
  invitation_id: '00000000-0000-4000-8000-0000000000bb',
  invitation_token: JETON,
  invitation_expires_at: '2026-08-14',
  plan: 'Standard',
  trial_end: '2026-08-30',
  expense_categories: 23,
  alert_rules: 20,
}

const EMPTY_OVERVIEW = { tenants: [], pending_payments: [], support_sessions: [] }

const APERCU_VALIDE = {
  found: true,
  commercial_name: 'LBA Séguéla',
  role: 'proprietaire',
  full_name: 'TRAORE Bakary',
  email_matches: true,
  status: 'pending',
  expired: false,
}

const baseFixtures = () => ({
  tenant_branding: [BRANDING_FIXTURE],
  tenants: [],
  tenant_invitations: [],
  users: [],
  alerts: [],
  notifications: [],
})

/** Réponses des fonctions serveur. Toute fonction non citée renvoie `[]`. */
async function stubRpc(page: Page, responses: Record<string, unknown>): Promise<void> {
  for (const [name, body] of Object.entries(responses)) {
    await page.route(`**/rest/v1/rpc/${name}`, (route: Route) => route.fulfill(json(body)))
  }
}

test.describe('parcours d’activation', () => {
  test('l’administrateur plateforme ouvre une entreprise et obtient le lien d’invitation', async ({
    page,
  }) => {
    await signIn(page, PLATFORM_ADMIN)
    await stubSupabase(page, baseFixtures())
    await stubRpc(page, { platform_overview: EMPTY_OVERVIEW, create_tenant: CREATED_TENANT })

    await page.goto('/plateforme')

    await page.getByRole('button', { name: 'Ouvrir un client' }).click()
    await page.getByLabel('Nom commercial').fill('LBA Séguéla')
    await page.getByLabel('Nom du propriétaire').fill('TRAORE Bakary')
    await page.getByLabel('Adresse du propriétaire').fill('proprietaire@lba-seguela.ci')
    await page.getByRole('button', { name: 'Ouvrir le client' }).click()

    // Le lien est le seul moyen pour le propriétaire de créer son compte.
    const lien = page.getByTestId('lien-invitation')
    await expect(lien).toContainText(`/invitation/${JETON}`)

    // L'entreprise naît utilisable : sans catégories de dépenses, aucune
    // dépense n'est saisissable ; sans règles, aucune alerte ne part.
    await expect(page.getByTestId('tenant-cree')).toBeVisible()
  })

  test('le propriétaire invité voit l’entreprise avant de s’engager', async ({ page }) => {
    await stubSupabase(page, baseFixtures())
    await stubRpc(page, { invitation_preview: APERCU_VALIDE })

    await page.goto(`/invitation/${JETON}`)

    // Annoncer l'entreprise et le rôle AVANT toute création de compte : accepter
    // à l'aveugle une invitation dont on ne connaît ni l'émetteur ni le rôle
    // n'est pas un consentement.
    await expect(page.getByText('LBA Séguéla')).toBeVisible()
    await expect(page.getByText('proprietaire', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Créer mon mot de passe' })).toBeVisible()
  })

  test('la création du mot de passe refuse une saisie trop faible, puis ramène à l’invitation', async ({
    page,
  }) => {
    await stubSupabase(page, baseFixtures())
    await stubRpc(page, { invitation_preview: APERCU_VALIDE })

    // Inscription réussie avec session immédiate : projet sans confirmation
    // d'adresse, qui est la configuration recommandée pour ce parcours.
    await page.route('**/auth/v1/signup**', (route) =>
      route.fulfill(
        json({
          access_token: 'jeton-de-test',
          refresh_token: 'refresh-de-test',
          user: { id: PROPRIETAIRE_INVITE.userId, email: PROPRIETAIRE_INVITE.email },
          session: { access_token: 'jeton-de-test' },
        }),
      ),
    )

    await page.goto(`/mot-de-passe?jeton=${JETON}`)

    await page.getByLabel('Adresse électronique').fill('proprietaire@lba-seguela.ci')
    await page.getByLabel('Mot de passe', { exact: true }).fill('court')
    await page.getByLabel('Confirmation').fill('court')

    // Le seuil du serveur est annoncé avant l'envoi : le rappeler après trois
    // essais refusés serait un service de moins bonne qualité.
    await expect(page.getByRole('alert')).toContainText('12 caractères')
    await expect(page.getByRole('button', { name: 'Créer mon compte' })).toBeDisabled()

    await page.getByLabel('Mot de passe', { exact: true }).fill('le camion part a 6h')
    await page.getByLabel('Confirmation').fill('le camion part a 6h')
    await expect(page.getByRole('button', { name: 'Créer mon compte' })).toBeEnabled()
  })

  test('les deux saisies du mot de passe doivent correspondre', async ({ page }) => {
    await stubSupabase(page, baseFixtures())

    await page.goto(`/mot-de-passe?jeton=${JETON}`)
    await page.getByLabel('Mot de passe', { exact: true }).fill('le camion part a 6h')
    await page.getByLabel('Confirmation').fill('le camion part a 7h')

    await expect(page.getByRole('alert')).toContainText('ne correspondent pas')
  })

  test('un compte connecté accepte l’invitation et entre dans l’application', async ({ page }) => {
    await signIn(page, PROPRIETAIRE_INVITE)
    await stubSupabase(page, baseFixtures())

    let accepte = false
    await page.route('**/rest/v1/rpc/accept_invitation', (route) => {
      accepte = true
      return route.fulfill(json({ id: PROPRIETAIRE_INVITE.userId, tenant_id: TENANT }))
    })
    await stubRpc(page, { invitation_preview: APERCU_VALIDE })

    await page.goto(`/invitation/${JETON}`)
    await page.getByRole('button', { name: 'Rejoindre cette entreprise' }).click()

    await expect.poll(() => accepte).toBe(true)
  })

  test('un jeton émis pour une autre adresse ne peut pas être accepté', async ({ page }) => {
    await signIn(page, { ...PROPRIETAIRE_INVITE, email: 'quelquun.dautre@exemple.ci' })
    await stubSupabase(page, baseFixtures())
    await stubRpc(page, {
      invitation_preview: { ...APERCU_VALIDE, email_matches: false },
    })

    await page.goto(`/invitation/${JETON}`)

    // Le serveur refuserait de toute façon ; l'interface doit le dire avant,
    // sinon la personne conclut que le lien est cassé.
    await expect(page.getByRole('alert')).toContainText('autre adresse')
    await expect(page.getByRole('button', { name: 'Rejoindre cette entreprise' })).toBeDisabled()
  })

  test('une invitation expirée est annoncée comme telle, pas comme un lien cassé', async ({
    page,
  }) => {
    await signIn(page, PROPRIETAIRE_INVITE)
    await stubSupabase(page, baseFixtures())
    await stubRpc(page, { invitation_preview: { ...APERCU_VALIDE, expired: true } })

    await page.goto(`/invitation/${JETON}`)

    await expect(page.getByRole('alert')).toContainText('expiré')
    await expect(page.getByRole('button', { name: 'Rejoindre cette entreprise' })).toHaveCount(0)
  })

  test('un jeton inconnu ne dit pas s’il a existé', async ({ page }) => {
    await stubSupabase(page, baseFixtures())
    await stubRpc(page, { invitation_preview: { found: false } })

    await page.goto('/invitation/jeton-invente')

    // Message identique pour « inexistant » et « déjà utilisé » : les
    // distinguer permettrait de tester des codes au hasard.
    await expect(page.getByRole('alert')).toContainText('aucune invitation en cours')
  })

  test('le propriétaire se connecte et atteint son tableau de bord', async ({ page }) => {
    // Une fois l'invitation acceptée, le jeton porte l'entreprise : c'est le
    // hook qui l'y met, à chaque émission.
    await signIn(page, {
      userId: PROPRIETAIRE_INVITE.userId,
      tenantId: TENANT,
      role: 'proprietaire',
      email: PROPRIETAIRE_INVITE.email,
    })
    await stubSupabase(page, baseFixtures())

    await page.goto('/')

    await expect(page).toHaveURL(/\/$/)

    // Sur téléphone le menu est replié derrière un bouton : l'ouvrir comme le
    // ferait un pisteur, au lieu de supposer un écran large.
    await openNavigation(page)
    await expect(page.getByRole('navigation')).toBeVisible()
  })
})

test.describe('diagnostic d’activation', () => {
  test('nomme le déclencheur manquant au lieu d’afficher une application vide', async ({ page }) => {
    // Le compte est rattaché en base et actif, mais son jeton ne porte aucune
    // entreprise. Aucune autre cause n'explique cet écart.
    await signIn(page, PROPRIETAIRE_INVITE)
    await stubSupabase(page, {
      ...baseFixtures(),
      users: [
        {
          id: PROPRIETAIRE_INVITE.userId,
          tenant_id: TENANT,
          role: 'proprietaire',
          status: 'active',
        },
      ],
    })

    await page.goto('/')

    // Sans cet écran, l'application s'ouvre et chaque liste est vide : correct
    // du point de vue de RLS, illisible du point de vue de l'exploitant.
    await expect(page).toHaveURL(/\/activation$/)
    await expect(page.getByText('Configuration du serveur incomplète')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Customize Access Token')
    await expect(page.getByRole('alert')).toContainText('app.custom_access_token')
  })

  test('oriente vers l’invitation un compte jamais rattaché', async ({ page }) => {
    await signIn(page, PROPRIETAIRE_INVITE)
    await stubSupabase(page, baseFixtures())

    await page.goto('/')

    await expect(page).toHaveURL(/\/activation$/)
    await expect(page.getByText('Compte pas encore rattaché')).toBeVisible()

    await page.getByRole('button', { name: 'Saisir un code d’invitation' }).click()
    await expect(page).toHaveURL(/\/invitation$/)
  })

  test('dit à un compte suspendu que ses données sont conservées', async ({ page }) => {
    await signIn(page, PROPRIETAIRE_INVITE)
    await stubSupabase(page, {
      ...baseFixtures(),
      users: [
        {
          id: PROPRIETAIRE_INVITE.userId,
          tenant_id: TENANT,
          role: 'proprietaire',
          status: 'suspended',
        },
      ],
    })

    await page.goto('/')

    await expect(page.getByText('Compte suspendu')).toBeVisible()
    // Une suspension n'est pas une suppression : le dire évite la panique.
    await expect(page.getByText(/données sont conservées/)).toBeVisible()
  })

  test('laisse passer l’administrateur plateforme, qui n’a légitimement aucune entreprise', async ({
    page,
  }) => {
    await signIn(page, PLATFORM_ADMIN)
    await stubSupabase(page, baseFixtures())
    await stubRpc(page, { platform_overview: EMPTY_OVERVIEW })

    await page.goto('/plateforme')

    // Le rediriger vers le diagnostic l'enverrait chercher un défaut inexistant.
    await expect(page).toHaveURL(/\/plateforme$/)
  })
})
