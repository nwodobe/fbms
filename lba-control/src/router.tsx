import { lazy, type ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/shared/AppShell'
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
const BagsPage = named(() => import('@/features/bags/BagsPage'), 'BagsPage')
const CampaignsPage = named(() => import('@/features/campaigns/CampaignsPage'), 'CampaignsPage')
const PlatformPage = named(() => import('@/features/platform/PlatformPage'), 'PlatformPage')
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
const NotificationsPage = named(
  () => import('@/features/notifications/NotificationsPage'),
  'NotificationsPage',
)
const MessageChannelsPage = named(
  () => import('@/features/notifications/MessageChannelsPage'),
  'MessageChannelsPage',
)
const UsersPage = named(() => import('@/features/admin/UsersPage'), 'UsersPage')
const AuditPage = named(() => import('@/features/admin/AuditPage'), 'AuditPage')

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

/*
 * Plus aucun écran annoncé et non construit.
 *
 * La phase 1 déclarait la navigation complète avec des pages « à venir », pour
 * que personne ne découvre un menu qui s'allonge. Le dernier de ces écrans —
 * utilisateurs et journal d'audit — est livré : le mécanisme de substitution et
 * `PhasePlaceholder` n'ont plus d'objet.
 */

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
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="canaux" element={<MessageChannelsPage />} />
        <Route path="utilisateurs" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
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
        <Route path="sacs" element={<BagsPage />} />
        <Route path="campagnes" element={<CampaignsPage />} />
        <Route path="plateforme" element={<PlatformPage />} />

      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
