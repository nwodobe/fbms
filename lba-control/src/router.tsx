import { lazy, type ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/shared/AppShell'
import { PhasePlaceholder } from '@/components/shared/PhasePlaceholder'
import { LoginPage } from '@/features/auth/LoginPage'
import { useSession } from '@/lib/auth/session'

/**
 * Écrans chargés à la demande.
 *
 * Le pisteur est la raison de ce découpage. Il travaille sur un téléphone
 * Android d'entrée de gamme, en 2G, parfois en payant son forfait au mégaoctet.
 * Lui faire télécharger la bibliothèque de graphiques du tableau de bord
 * dirigeant pour saisir un achat est un coût qu'il paie réellement, en argent
 * et en attente.
 *
 * `lazy` sur chaque route découpe le bundle par écran : la connexion et la
 * coquille restent dans le chargement initial, tout le reste arrive quand on y
 * va. Les écrans les plus lourds — tableau de bord et TCB — ne pèsent plus rien
 * pour qui ne les ouvre jamais.
 */
const named = <T extends string>(
  loader: () => Promise<Record<T, ComponentType>>,
  name: T,
) => lazy(() => loader().then((module) => ({ default: module[name] })))

const DashboardPage = named(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage')
const AdvancesPage = named(() => import('@/features/advances/AdvancesPage'), 'AdvancesPage')
const AgentDetailPage = named(() => import('@/features/agents/AgentDetailPage'), 'AgentDetailPage')
const AgentsPage = named(() => import('@/features/agents/AgentsPage'), 'AgentsPage')
const ContractsPage = named(() => import('@/features/contracts/ContractsPage'), 'ContractsPage')
const AlertsPage = named(() => import('@/features/costs/AlertsPage'), 'AlertsPage')
const ExpensesPage = named(() => import('@/features/costs/ExpensesPage'), 'ExpensesPage')
const ScoringPage = named(() => import('@/features/costs/ScoringPage'), 'ScoringPage')
const TcbPage = named(() => import('@/features/costs/TcbPage'), 'TcbPage')
const FundingPage = named(() => import('@/features/funding/FundingPage'), 'FundingPage')
const IncidentsPage = named(() => import('@/features/logistics/IncidentsPage'), 'IncidentsPage')
const PlanningPage = named(() => import('@/features/logistics/PlanningPage'), 'PlanningPage')
const StockPage = named(() => import('@/features/logistics/StockPage'), 'StockPage')
const TransfersPage = named(() => import('@/features/logistics/TransfersPage'), 'TransfersPage')
const PurchasesPage = named(() => import('@/features/purchases/PurchasesPage'), 'PurchasesPage')
const PartnerDetailPage = named(() => import('@/features/partners/PartnerDetailPage'), 'PartnerDetailPage')
const PartnersPage = named(() => import('@/features/partners/PartnersPage'), 'PartnersPage')
const SubscriptionPage = named(() => import('@/features/subscription/SubscriptionPage'), 'SubscriptionPage')
const BrandingPage = named(() => import('@/features/settings/BrandingPage'), 'BrandingPage')

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useSession()

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground" role="status">
        Chargement…
      </div>
    )
  }

  if (!session) return <Navigate to="/connexion" replace />
  return <>{children}</>
}

/** Écrans planifiés, déclarés ici pour que la navigation soit complète dès la phase 1. */
const PLANNED = [
  {
    path: 'sacs',
    title: 'Sacherie',
    phase: 4,
    summary: 'Dotations, retours et pertes de sacs, par société.',
    delivers: ['Solde par détenteur et par société', 'Réaffectation inter-sociétés approuvée'],
  },
  {
    path: 'utilisateurs',
    title: 'Utilisateurs et rôles',
    phase: 2,
    summary: 'Créer les comptes, attribuer les rôles, révoquer les appareils.',
    delivers: ['Sept rôles attribuables', 'Révocation d’appareil', 'Séparation des tâches'],
  },
  {
    path: 'audit',
    title: 'Journal d’audit',
    phase: 1,
    summary: 'Historique non modifiable des opérations sensibles.',
    delivers: [
      'Auteur, appareil, date serveur, ancienne et nouvelle valeur, motif',
      'Entrées dédiées pour les changements de poids, de prix, de montant et de société',
      'Consultation réservée aux profils autorisés',
    ],
  },
] as const

export function AppRouter() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />

        {/* Écrans livrés en phase 2 */}
        <Route path="marque" element={<BrandingPage />} />
        <Route path="societes" element={<PartnersPage />} />
        <Route path="societes/:partnerId" element={<PartnerDetailPage />} />
        <Route path="contrats" element={<ContractsPage />} />

        {/* Écrans livrés en phase 3 */}
        <Route path="financements" element={<FundingPage />} />
        <Route path="pisteurs" element={<AgentsPage />} />
        <Route path="pisteurs/:agentId" element={<AgentDetailPage />} />
        <Route path="avances" element={<AdvancesPage />} />
        <Route path="achats" element={<PurchasesPage />} />

        {/* Écrans livrés en phase 4 */}
        <Route path="stocks" element={<StockPage />} />
        <Route path="planning" element={<PlanningPage />} />
        <Route path="transferts" element={<TransfersPage />} />
        <Route path="incidents" element={<IncidentsPage />} />

        {/* Écrans livrés en phase 5 */}
        <Route path="depenses" element={<ExpensesPage />} />
        <Route path="tcb" element={<TcbPage />} />
        <Route path="scoring" element={<ScoringPage />} />
        <Route path="alertes" element={<AlertsPage />} />

        {/* Écrans livrés en phase 6 */}
        <Route path="abonnement" element={<SubscriptionPage />} />

        {PLANNED.map((screen) => (
          <Route
            key={screen.path}
            path={screen.path}
            element={
              <PhasePlaceholder
                title={screen.title}
                phase={screen.phase}
                summary={screen.summary}
                delivers={[...screen.delivers]}
              />
            }
          />
        ))}
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
