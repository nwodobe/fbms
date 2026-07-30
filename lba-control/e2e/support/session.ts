import type { Page, Route } from '@playwright/test'

/**
 * Harnais end-to-end.
 *
 * Ces tests exercent l'application réelle dans un vrai navigateur, avec le
 * serveur Supabase remplacé par des interceptions réseau. Ce choix est
 * délibéré : il permet de vérifier dès maintenant les parcours d'interface
 * (marque, cloisonnement des actions par rôle, contrôles de saisie) sans
 * dépendre d'un projet Supabase hébergé, dont les identifiants n'ont pas leur
 * place dans le dépôt.
 *
 * Ce qu'ils NE prouvent pas : les règles serveur. Celles-ci sont couvertes par
 * la suite `npm run test:rls`, qui s'exécute contre un vrai PostgreSQL avec les
 * migrations réelles. Les deux suites sont complémentaires et aucune ne
 * remplace l'autre.
 */

const base64url = (value: object): string =>
  Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export interface FakeUser {
  userId?: string
  tenantId?: string
  role?: string
  email?: string
}

/** Jeton non signé : supabase-js décode le JWT côté client, il ne le vérifie pas. */
export function buildAccessToken({
  userId = '00000000-0000-4000-8000-000000000011',
  tenantId = '00000000-0000-4000-8000-000000000001',
  role = 'proprietaire',
  email = 'proprietaire@demo.test',
}: FakeUser = {}): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' })
  const payload = base64url({
    sub: userId,
    email,
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    app_metadata: { tenant_id: tenantId, role },
    user_metadata: {},
  })
  return `${header}.${payload}.signature-non-verifiee`
}

/** Installe une session dans le stockage local, avant le chargement de l'application. */
export async function signIn(page: Page, user: FakeUser = {}): Promise<void> {
  const accessToken = buildAccessToken(user)
  const session = {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh-de-test',
    user: {
      id: user.userId ?? '00000000-0000-4000-8000-000000000011',
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email ?? 'proprietaire@demo.test',
      app_metadata: {
        tenant_id: user.tenantId ?? '00000000-0000-4000-8000-000000000001',
        role: user.role ?? 'proprietaire',
      },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    ['lba-control-auth', JSON.stringify(session)],
  )
}

export interface TableFixtures {
  [table: string]: unknown[]
}

/**
 * Intercepte l'API REST de Supabase et sert des enregistrements en mémoire.
 * Les créations sont ajoutées à la collection, ce qui permet de vérifier qu'une
 * ligne créée apparaît bien dans la liste.
 */
export async function stubSupabase(page: Page, fixtures: TableFixtures): Promise<TableFixtures> {
  const data: TableFixtures = structuredClone(fixtures)

  /** PostgREST encode ses filtres ainsi : `?id=eq.abc&status=eq.active`. */
  const applyFilters = (rows: unknown[], url: URL): unknown[] => {
    const reserved = new Set(['select', 'order', 'limit', 'offset'])
    let result = rows

    for (const [column, expression] of url.searchParams) {
      if (reserved.has(column)) continue
      const [operator, ...rest] = expression.split('.')
      const value = rest.join('.')
      if (operator !== 'eq') continue
      result = result.filter((row) => String((row as Record<string, unknown>)[column]) === value)
    }

    return result
  }

  const respond = async (route: Route, rows: unknown[], status = 200) => {
    // `.single()` et `.maybeSingle()` demandent un objet, pas un tableau :
    // renvoyer un tableau ferait échouer la requête côté client.
    const wantsObject = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const body = wantsObject ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows)

    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body,
    })
  }

  await page.route('**/rest/v1/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const table = url.pathname.replace(/^.*\/rest\/v1\//, '').split('?')[0] ?? ''
    const rows = data[table] ?? []

    if (request.method() === 'GET') {
      await respond(route, applyFilters(rows, url))
      return
    }

    if (request.method() === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>
      const created = { id: `generated-${rows.length + 1}`, ...payload }
      data[table] = [...rows, created]
      await respond(route, [created], 201)
      return
    }

    if (request.method() === 'PATCH') {
      const payload = request.postDataJSON() as Record<string, unknown>
      const targeted = applyFilters(rows, url)
      const updated = targeted.map((row) => ({ ...(row as object), ...payload }))
      data[table] = rows.map((row) => {
        const match = updated.find(
          (candidate) =>
            (candidate as Record<string, unknown>).id === (row as Record<string, unknown>).id,
        )
        return match ?? row
      })
      await respond(route, updated)
      return
    }

    await route.fulfill({ status: 204, body: '' })
  })

  // Le rafraîchissement de jeton ne doit pas partir sur le réseau réel.
  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )

  return data
}

/**
 * Ouvre la navigation.
 *
 * Sur téléphone, le menu est replié derrière un bouton — c'est le
 * comportement attendu, pas un défaut. Les tests doivent donc l'ouvrir comme le
 * ferait un pisteur, au lieu de supposer un écran large.
 */
export async function openNavigation(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Ouvrir le menu' })
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click()
  }
  await page.getByRole('navigation').waitFor({ state: 'visible' })
}

export const BRANDING_FIXTURE = {
  tenant_id: '00000000-0000-4000-8000-000000000001',
  commercial_name: 'LBA Démonstration Bouaké',
  legal_name: 'LBA Démonstration SARL',
  slogan: 'Contrôler chaque franc et chaque kilogramme',
  logo_path: null,
  logo_mobile_path: null,
  login_image_path: null,
  primary_color: '#1f6f43',
  secondary_color: '#8a3d00',
  phone: null,
  email: null,
  address: null,
  tax_id: null,
  document_footer: 'Document de démonstration — données fictives',
  currency: 'XOF',
  language: 'fr',
}
