import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/shared/AppShell'
import { PhasePlaceholder } from '@/components/shared/PhasePlaceholder'
import { AdvancesPage } from '@/features/advances/AdvancesPage'
import { AgentDetailPage } from '@/features/agents/AgentDetailPage'
import { AgentsPage } from '@/features/agents/AgentsPage'
import { ContractsPage } from '@/features/contracts/ContractsPage'
import { FundingPage } from '@/features/funding/FundingPage'
import { IncidentsPage } from '@/features/logistics/IncidentsPage'
import { PlanningPage } from '@/features/logistics/PlanningPage'
import { StockPage } from '@/features/logistics/StockPage'
import { TransfersPage } from '@/features/logistics/TransfersPage'
import { PurchasesPage } from '@/features/purchases/PurchasesPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { PartnerDetailPage } from '@/features/partners/PartnerDetailPage'
import { PartnersPage } from '@/features/partners/PartnersPage'
import { BrandingPage } from '@/features/settings/BrandingPage'
import { useSession } from '@/lib/auth/session'

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
    path: 'alertes',
    title: 'Centre d’alertes',
    phase: 5,
    summary: 'Alertes filtrées par gravité, société, pisteur et échéance.',
    delivers: ['Les 20 règles d’alerte à seuils configurables', 'Acquittement et résolution tracés'],
  },
  {
    path: 'sacs',
    title: 'Sacherie',
    phase: 4,
    summary: 'Dotations, retours et pertes de sacs, par société.',
    delivers: ['Solde par détenteur et par société', 'Réaffectation inter-sociétés approuvée'],
  },
  {
    path: 'depenses',
    title: 'Dépenses',
    phase: 5,
    summary: 'Enregistrer les coûts sans doubler les avances ni les achats.',
    delivers: [
      'Les 23 catégories et leurs familles',
      'Validation, rejet et détection de doublons',
      'Clés de répartition des dépenses indirectes',
    ],
  },
  {
    path: 'tcb',
    title: 'TCB et marges',
    phase: 5,
    summary: 'Comprendre le coût réel par kg et la source de destruction de marge.',
    delivers: [
      'TCB prévisionnel et réel affichés séparément',
      'Décomposition par composante, jusqu’à la transaction',
      'Marge totale, marge par kg et écart de réconciliation',
    ],
  },
  {
    path: 'scoring',
    title: 'Scoring des pisteurs',
    phase: 5,
    summary: 'Évaluer automatiquement sans créer une boîte noire.',
    delivers: [
      'Neuf composantes pondérées, données sources visibles',
      'Score brut et score ajusté par événements externes validés',
      'Aucune sanction automatique',
    ],
  },
  {
    path: 'utilisateurs',
    title: 'Utilisateurs et rôles',
    phase: 2,
    summary: 'Créer les comptes, attribuer les rôles, révoquer les appareils.',
    delivers: ['Sept rôles attribuables', 'Révocation d’appareil', 'Séparation des tâches'],
  },
  {
    path: 'abonnement',
    title: 'Abonnement',
    phase: 6,
    summary: 'Plan, échéance, factures, paiements et renouvellement.',
    delivers: [
      'Rappels J-7, J-3 et jour J',
      'Grâce, lecture seule à J+5, blocage à J+30, données conservées',
      'Une déclaration de paiement ne renouvelle jamais seule l’abonnement',
    ],
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
