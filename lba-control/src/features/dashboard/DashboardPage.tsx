import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/lib/auth/session'
import { useBranding } from '@/lib/tenant/branding'

/**
 * Écran A02 — tableau de bord dirigeant.
 *
 * Les blocs attendus (finances, matière, performance) sont décrits mais pas
 * remplis : les calculs de TCB, de marge et d'exposition arrivent en phase 5, et
 * afficher des valeurs provisoires reviendrait à mentir sur l'état du produit.
 */
const SECTIONS = [
  {
    title: 'Finances',
    phase: 5,
    indicators: [
      'Financements par société',
      'Avances aux pisteurs',
      'Exposition non couverte',
      'Argent immobilisé',
      'Montants payés et restant à recevoir',
      'TCB et marge',
    ],
  },
  {
    title: 'Matière',
    phase: 4,
    indicators: [
      'Stock disponible et réservé',
      'Stock chez les pisteurs',
      'Stock en transit',
      'Stock réceptionné et rejeté',
      'Stock en litige',
    ],
  },
  {
    title: 'Livraisons',
    phase: 4,
    indicators: [
      'Livraisons prévues aujourd’hui',
      'Livraisons en retard',
      'Transferts en transit',
      'Réceptions du jour',
      'Écarts critiques',
    ],
  },
  {
    title: 'Pisteurs',
    phase: 5,
    indicators: [
      'Pisteurs actifs',
      'Pisteurs sans livraison',
      'Avances anciennes',
      'Meilleurs scores et scores critiques',
      'Recommandations de plafond',
    ],
  },
]

export function DashboardPage() {
  const { role } = useSession()
  const branding = useBranding()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Tableau de bord</h1>
        <p className="text-muted-foreground">
          {branding.commercialName}
          {role ? ` · profil ${role.replace(/_/g, ' ')}` : null}
        </p>
      </header>

      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardHeader>
          <CardTitle>Socle livré, indicateurs à venir</CardTitle>
          <CardDescription>
            La phase 1 livre le socle sécurisé : isolation des entreprises clientes, rôles, politiques
            d’accès et journal d’audit, tous vérifiés par tests automatisés. Les indicateurs ci-dessous
            seront alimentés par les transactions réelles au fil des phases 3 à 6. Aucun chiffre n’est
            affiché tant qu’il n’est pas calculé à partir de vraies opérations.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>Alimenté en phase {section.phase}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {section.indicators.map((indicator) => (
                  <li key={indicator} className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">{indicator}</span>
                    <span className="font-mono text-muted-foreground" aria-label="donnée non disponible">
                      —
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
