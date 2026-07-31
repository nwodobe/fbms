/**
 * Écran H01 — marque de l'entreprise.
 *
 * Ce que ces tests protègent : qu'une couleur illisible ne puisse pas être
 * enregistrée, et que le refus soit CHIFFRÉ. Un refus sans mesure oblige
 * l'utilisateur à tâtonner jusqu'à abandonner et appeler le support.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandingPage } from '@/features/settings/BrandingPage'
import { renderWithProviders } from './test-utils'

// `vi.hoisted` : les fabriques passées à vi.mock sont hissées au-dessus des
// déclarations du module. Sans cela, la référence à saveMock lèverait une
// erreur de zone morte temporelle.
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  saveImage: vi.fn(),
  branding: {
    tenant_id: 'tenant-1',
    commercial_name: 'LBA Démonstration Bouaké',
    legal_name: 'LBA Démo SARL',
    slogan: 'Contrôler chaque franc',
    logo_path: null,
    logo_mobile_path: null,
    login_image_path: null,
    primary_color: '#1f6f43',
    secondary_color: '#8a3d00',
    phone: null,
    email: null,
    address: null,
    tax_id: null,
    document_footer: null,
    currency: 'XOF',
    language: 'fr',
  },
}))

vi.mock('@/lib/auth/session', () => ({
  useSession: () => ({
    session: {},
    user: { email: 'proprietaire@demo.test' },
    tenantId: 'tenant-1',
    role: 'proprietaire',
    isLoading: false,
    signOut: vi.fn(),
  }),
  useHasRole: () => true,
}))

vi.mock('@/features/settings/api', () => ({
  useTenantBranding: () => ({ data: mocks.branding, isLoading: false }),
  useSaveBranding: () => ({ mutateAsync: mocks.save, isPending: false, error: null }),
  useSaveBrandingImage: () => ({ mutate: mocks.saveImage, isPending: false, error: null }),
}))

beforeEach(() => {
  mocks.save.mockReset()
  mocks.save.mockResolvedValue({})
})

describe('marque de l’entreprise', () => {
  it('affiche la marque enregistrée', async () => {
    renderWithProviders(<BrandingPage />)
    expect(await screen.findByRole('textbox', { name: /^Nom commercial/ })).toHaveValue(
      'LBA Démonstration Bouaké',
    )
    expect(screen.getByRole('textbox', { name: /^Couleur principale/ })).toHaveValue('#1f6f43')
  })

  it('affiche la mesure de contraste des couleurs courantes', async () => {
    renderWithProviders(<BrandingPage />)
    const report = await screen.findByTestId('contrast-report')
    expect(report).toHaveTextContent('Couleurs lisibles')
    expect(report).toHaveTextContent(/\d+\.\d+:1 avec le texte/)
  })

  it('refuse une couleur invisible sur le fond, en donnant la mesure', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BrandingPage />)

    const primary = await screen.findByRole('textbox', { name: /^Couleur principale/ })
    await user.clear(primary)
    await user.type(primary, '#fefefe')

    await waitFor(() => {
      const report = screen.getByTestId('contrast-report')
      expect(report).toHaveTextContent('ne peuvent pas être enregistrées')
      expect(report).toHaveTextContent(/fond de l’application/)
    })
  })

  it('n’envoie rien au serveur tant que les couleurs sont illisibles', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BrandingPage />)

    const primary = await screen.findByRole('textbox', { name: /^Couleur principale/ })
    await user.clear(primary)
    await user.type(primary, '#fefefe')
    await user.click(screen.getByRole('button', { name: /^Enregistrer$/ }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('enregistre une paire lisible', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BrandingPage />)

    const slogan = await screen.findByRole('textbox', { name: /^Slogan/ })
    await user.clear(slogan)
    await user.type(slogan, 'Chaque kilogramme compte')
    await user.click(screen.getByRole('button', { name: /^Enregistrer$/ }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      slogan: 'Chaque kilogramme compte',
      primaryColor: '#1f6f43',
    })
  })

  it('permet de revenir au thème standard', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BrandingPage />)

    const primary = await screen.findByRole('textbox', { name: /^Couleur principale/ })
    await user.clear(primary)
    await user.type(primary, '#123456')
    await user.click(screen.getByRole('button', { name: /Revenir au thème standard/ }))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^Couleur principale/ })).toHaveValue('#1f6f43'),
    )
  })

  it('refuse un nom commercial vide', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BrandingPage />)

    const name = await screen.findByRole('textbox', { name: /^Nom commercial/ })
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: /^Enregistrer$/ }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
