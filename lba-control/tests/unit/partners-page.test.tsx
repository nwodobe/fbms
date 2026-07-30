/**
 * Écran B01 — sociétés partenaires.
 *
 * Deux points protégés ici : le code de société est contraint (il sert
 * d'identifiant dans les exports et les documents), et une société n'est jamais
 * supprimée — seulement suspendue.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PartnersPage } from '@/features/partners/PartnersPage'
import { renderWithProviders } from './test-utils'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  role: { current: 'gestionnaire' as string },
  partners: [
    {
      id: 'p1',
      tenant_id: 't1',
      code: 'OLAM',
      name: 'OLAM (démo)',
      contact_name: 'Contact OLAM',
      phone: '+225 00',
      email: null,
      address: null,
      status: 'active' as const,
      weight_tolerance_pct: 0.5,
      acceptance_tolerance_pct: null,
      external_access_enabled: false,
      created_at: '2026-01-01',
    },
    {
      id: 'p2',
      tenant_id: 't1',
      code: 'DORADO',
      name: 'DORADO (démo)',
      contact_name: null,
      phone: null,
      email: null,
      address: null,
      status: 'suspended' as const,
      weight_tolerance_pct: null,
      acceptance_tolerance_pct: null,
      external_access_enabled: false,
      created_at: '2026-01-02',
    },
  ],
}))

vi.mock('@/lib/auth/session', () => ({
  useSession: () => ({
    session: {},
    user: { email: 'gestionnaire@demo.test' },
    tenantId: 't1',
    role: mocks.role.current,
    isLoading: false,
    signOut: vi.fn(),
  }),
  useHasRole: () => true,
}))

vi.mock('@/features/partners/api', () => ({
  usePartnerCompanies: () => ({ data: mocks.partners, isLoading: false, error: null }),
  useCreatePartnerCompany: () => ({ mutateAsync: mocks.create, isPending: false, error: null }),
}))

beforeEach(() => {
  mocks.create.mockReset()
  mocks.create.mockResolvedValue({})
  mocks.role.current = 'gestionnaire'
})

describe('sociétés partenaires', () => {
  it('liste les sociétés avec leur statut', async () => {
    renderWithProviders(<PartnersPage />)

    expect(await screen.findByText('OLAM (démo)')).toBeInTheDocument()
    expect(screen.getByText('DORADO (démo)')).toBeInTheDocument()
    expect(screen.getByText('Suspendue')).toBeInTheDocument()
  })

  it('affiche « Défaut entreprise » quand aucune tolérance n’est fixée', async () => {
    renderWithProviders(<PartnersPage />)
    // Une tolérance absente ne doit pas s'afficher comme 0 % : la cascade
    // contrat → société → entreprise doit rester lisible.
    expect(await screen.findByText('Défaut entreprise')).toBeInTheDocument()
    expect(screen.getByText('0.5 %')).toBeInTheDocument()
  })

  it('crée une société avec un code valide', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PartnersPage />)

    await user.click(await screen.findByRole('button', { name: /Ajouter une société/ }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByRole('textbox', { name: /^Code/ }), 'ANAGROCI')
    await user.type(within(dialog).getByRole('textbox', { name: /^Nom/ }), 'ANAGROCI (démo)')
    await user.click(within(dialog).getByRole('button', { name: /Créer la société/ }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({
      code: 'ANAGROCI',
      name: 'ANAGROCI (démo)',
    })
  })

  it('refuse un code en minuscules sans appeler le serveur', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PartnersPage />)

    await user.click(await screen.findByRole('button', { name: /Ajouter une société/ }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByRole('textbox', { name: /^Code/ }), 'olam')
    await user.type(within(dialog).getByRole('textbox', { name: /^Nom/ }), 'Société test')
    await user.click(within(dialog).getByRole('button', { name: /Créer la société/ }))

    await waitFor(() => {
      const alert = within(dialog).getByRole('alert')
      expect(alert).toHaveTextContent(/majuscules, chiffres et tirets uniquement/i)
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('ne propose pas la création à un rôle en lecture seule', async () => {
    mocks.role.current = 'auditeur'
    renderWithProviders(<PartnersPage />)

    expect(await screen.findByText('OLAM (démo)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ajouter une société/ })).not.toBeInTheDocument()
  })

  it('n’offre aucune action de suppression', async () => {
    renderWithProviders(<PartnersPage />)
    await screen.findByText('OLAM (démo)')
    // La désactivation n'efface aucune donnée : il ne doit exister aucun
    // chemin de suppression dans l'interface.
    expect(screen.queryByRole('button', { name: /supprim/i })).not.toBeInTheDocument()
  })
})
