import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/shared/AppShell'
import { PhasePlaceholder } from '@/components/shared/PhasePlaceholder'
import { ContractsPage } from '@/features/contracts/ContractsPage'
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
    path: 'financements',
    title: 'Financements reçus',
    phase: 3,
    summary: 'Tracer l’argent reçu par société et le volume théorique associé.',
    delivers: [
      'Montant, référence, moyen de paiement, justificatif',
      'Volume théorique financé (indicatif)',
      'Interdiction de couvrir une société par une autre',
    ],
  },
  {
    path: 'pisteurs',
    title: 'Pisteurs',
    phase: 3,
    summary: 'Situation opérationnelle et financière de chaque pisteur.',
    delivers: ['Plafonds global et par société', 'Exposition, ancienneté des fonds', 'Score explicable'],
  },
  {
    path: 'avances',
    title: 'Avances aux pisteurs',
    phase: 3,
    summary: 'Remettre des fonds sans perdre leur origine ni leur ancienneté.',
    delivers: [
      'Contrôle du plafond et des avances anciennes non couvertes',
      'Dérogation motivée et approuvée en cas de dépassement',
      'Vieillissement FIFO du reliquat',
    ],
  },
  {
    path: 'achats',
    title: 'Achats terrain',
    phase: 3,
    summary: 'Transformer une avance en stock traçable, y compris hors connexion.',
    delivers: [
      'Saisie hors ligne avec identifiant généré sur l’appareil',
      'Détection des doublons probables',
      'Contrôle du prix maximal autorisé',
    ],
  },
  {
    path: 'sacs',
    title: 'Sacherie',
    phase: 4,
    summary: 'Dotations, retours et pertes de sacs, par société.',
    delivers: ['Solde par détenteur et par société', 'Réaffectation inter-sociétés approuvée'],
  },
  {
    path: 'stocks',
    title: 'Stocks et réservations',
    phase: 4,
    summary: 'Distinguer stock en main, disponible, réservé, chargé et litigieux.',
    delivers: [
      'Réservation transactionnelle : aucune double réservation possible',
      'Interdiction du stock négatif',
      'Réaffectation de société par workflow approuvé',
    ],
  },
  {
    path: 'planning',
    title: 'Planning de livraison',
    phase: 4,
    summary: 'Promettre un volume réaliste et suivre les retards.',
    delivers: ['Vérification du stock disponible avant confirmation', 'Capacité véhicule et documents obligatoires'],
  },
  {
    path: 'transferts',
    title: 'Transferts et pesées',
    phase: 4,
    summary: 'Rapprocher la matière sans confondre les quatre poids.',
    delivers: [
      'Poids chargé, déchargé, accepté et payé conservés séparément',
      'Cinq écarts calculés automatiquement',
      'Incident et blocage de clôture au-delà de la tolérance',
    ],
  },
  {
    path: 'incidents',
    title: 'Incidents et litiges',
    phase: 4,
    summary: 'Documenter les anomalies avant toute imputation de responsabilité.',
    delivers: [
      'Type, gravité, montant exposé, preuves',
      'Distinction perte naturelle, technique, qualité et inexpliquée',
      'Aucune imputation automatique au pisteur',
    ],
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
