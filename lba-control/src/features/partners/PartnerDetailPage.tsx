import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatWeight } from '@/domain/money'
import { useSession } from '@/lib/auth/session'
import { useContracts } from '@/features/contracts/api'
import { usePartnerCompany, useSetPartnerStatus } from './api'

/**
 * Écran B02 — fiche société.
 *
 * En phase 2, la fiche présente l'identité, les règles applicables et les
 * contrats. Les blocs financements, soldes, TCB et marge n'affichent rien tant
 * que les calculs correspondants n'existent pas : mieux vaut une absence
 * explicite qu'un zéro qui passerait pour un fait.
 */
export function PartnerDetailPage() {
  const { partnerId } = useParams<{ partnerId: string }>()
  const { role } = useSession()
  const { data: partner, isLoading } = usePartnerCompany(partnerId)
  const { data: contracts } = useContracts()
  const setStatus = useSetPartnerStatus()

  const canManage = role === 'proprietaire' || role === 'gestionnaire'
  const partnerContracts = (contracts ?? []).filter((c) => c.partner_company_id === partnerId)

  if (isLoading) {
    return (
      <p role="status" className="text-muted-foreground">
        Chargement…
      </p>
    )
  }

  if (!partner) {
    return (
      <div className="space-y-4">
        <p role="alert">Société introuvable, ou hors du périmètre de votre entreprise.</p>
        <Button variant="outline" asChild>
          <Link to="/societes">Retour aux sociétés</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link to="/societes">
            <ArrowLeft size={16} />
            Sociétés
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{partner.name}</h1>
            <p className="font-mono text-sm text-muted-foreground">{partner.code}</p>
          </div>

          {canManage && (
            <Button
              variant="outline"
              onClick={() =>
                setStatus.mutate({
                  id: partner.id,
                  status: partner.status === 'active' ? 'suspended' : 'active',
                })
              }
              disabled={setStatus.isPending}
            >
              {partner.status === 'active' ? 'Suspendre' : 'Réactiver'}
            </Button>
          )}
        </div>
      </div>

      {setStatus.error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {setStatus.error.message}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identité</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Line label="Contact" value={partner.contact_name} />
            <Line label="Téléphone" value={partner.phone} />
            <Line label="Email" value={partner.email} />
            <Line label="Adresse" value={partner.address} />
            <div className="flex justify-between gap-4 pt-1">
              <span className="text-muted-foreground">Statut</span>
              <Badge variant={partner.status === 'active' ? 'ok' : 'warn'}>
                {partner.status === 'active' ? 'Active' : partner.status === 'suspended' ? 'Suspendue' : 'Clôturée'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Règles applicables</CardTitle>
            <CardDescription>Valeurs par défaut, surchargeables par contrat.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Line
              label="Tolérance d’écart de poids"
              value={
                partner.weight_tolerance_pct === null
                  ? 'Défaut entreprise'
                  : `${partner.weight_tolerance_pct} %`
              }
            />
            <Line
              label="Tolérance d’acceptation"
              value={
                partner.acceptance_tolerance_pct === null
                  ? 'Défaut entreprise'
                  : `${partner.acceptance_tolerance_pct} %`
              }
            />
            <Line
              label="Accès externe"
              value={partner.external_access_enabled ? 'Activé' : 'Désactivé (hors MVP)'}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance</CardTitle>
            <CardDescription>Alimentée aux phases 3 à 5</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {['Financements reçus', 'Volumes acceptés', 'Écarts constatés', 'TCB', 'Marge'].map((label) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-muted-foreground" aria-label="donnée non disponible">
                  —
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contrats</CardTitle>
        </CardHeader>
        <CardContent>
          {partnerContracts.length === 0 ? (
            <p className="text-muted-foreground">
              Aucun contrat pour cette société.{' '}
              <Link to="/contrats" className="underline">
                Créer un contrat
              </Link>
              .
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead>Volume cible</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partnerContracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">{contract.reference}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {contract.start_date} → {contract.end_date}
                    </TableCell>
                    <TableCell>{formatWeight(contract.target_volume_kg)}</TableCell>
                    <TableCell>
                      <Badge variant={contract.status === 'actif' ? 'ok' : 'neutral'}>{contract.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value ?? '—'}</span>
    </div>
  )
}
