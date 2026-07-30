import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney, formatWeight } from '@/domain/money'
import { useAdvances } from '@/features/advances/api'
import { usePurchases } from '@/features/purchases/api'
import { useAgentExposure, useFieldAgent } from './api'

/**
 * Écran C02 — fiche pisteur.
 *
 * L'exposition est décomposée, jamais résumée en un solde unique : confondre
 * l'argent non justifié avec la matière en cours de route revient à transformer
 * un pisteur en activité en pisteur suspect.
 */
export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const { data: agent, isLoading } = useFieldAgent(agentId)
  const { data: exposure } = useAgentExposure(agentId)
  const { data: advances } = useAdvances(agentId)
  const { data: purchases } = usePurchases(agentId)

  if (isLoading) {
    return (
      <p role="status" className="text-muted-foreground">
        Chargement…
      </p>
    )
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <p role="alert">Pisteur introuvable, ou hors du périmètre de votre entreprise.</p>
        <Button variant="outline" asChild>
          <Link to="/pisteurs">Retour aux pisteurs</Link>
        </Button>
      </div>
    )
  }

  const ageDays = exposure?.oldest_outstanding_age_days ?? 0

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link to="/pisteurs">
            <ArrowLeft size={16} />
            Pisteurs
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{agent.full_name}</h1>
            <p className="font-mono text-sm text-muted-foreground">{agent.code}</p>
          </div>
          <Button asChild>
            <Link to={`/avances?pisteur=${agent.id}`}>Nouvelle avance</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identité</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Line label="Téléphone" value={agent.phone} />
            <Line label="Mobile Money" value={agent.mobile_money_account} />
            <Line label="Plafond global" value={formatMoney(agent.ceiling_amount)} />
            <Line label="Activation" value={agent.activation_date} />
            <div className="flex justify-between gap-4 pt-1">
              <span className="text-muted-foreground">Statut</span>
              <Badge variant={agent.status === 'actif' ? 'ok' : 'warn'}>{agent.status}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Exposition</CardTitle>
            <CardDescription>Chaque état reste séparé</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Line label="Avancé" value={formatMoney(exposure?.advanced)} />
            <Line label="Couvert" value={formatMoney(exposure?.covered)} />
            <div className="flex justify-between gap-4 border-t pt-2 font-medium">
              <span>Exposition</span>
              <span>{formatMoney(exposure?.exposure)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Reliquat le plus ancien</span>
              <span className={ageDays > 7 ? 'font-medium text-status-critical' : ''}>
                {exposure ? `${ageDays} j` : '—'}
              </span>
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              L’exposition n’est pas une perte : une partie peut correspondre à du stock détenu ou en
              transit. Le détail matière arrive en phase 4.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance</CardTitle>
            <CardDescription>Score explicable en phase 5</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {['Score', 'Écarts de poids', 'Qualité livrée', 'TCB contrôlable'].map((label) => (
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
          <CardTitle>Avances</CardTitle>
        </CardHeader>
        <CardContent>
          {!advances || advances.length === 0 ? (
            <p className="text-muted-foreground">Aucune avance pour ce pisteur.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Référence</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Dérogation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.map((advance) => (
                  <TableRow key={advance.id}>
                    <TableCell className="whitespace-nowrap">{advance.issued_at.slice(0, 10)}</TableCell>
                    <TableCell className="font-medium">{formatMoney(advance.amount)}</TableCell>
                    <TableCell className="text-muted-foreground">{advance.reference ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={advance.status === 'cloture' ? 'ok' : 'neutral'}>{advance.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                      {advance.requires_override ? (advance.override_reason ?? 'Oui') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Achats récents</CardTitle>
        </CardHeader>
        <CardContent>
          {!purchases || purchases.length === 0 ? (
            <p className="text-muted-foreground">Aucun achat enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Poids</TableHead>
                  <TableHead>Prix/kg</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Synchro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.slice(0, 10).map((purchase) => (
                  <TableRow key={purchase.id}>
                    <TableCell className="whitespace-nowrap">{purchase.purchased_at.slice(0, 10)}</TableCell>
                    <TableCell>{formatWeight(purchase.net_weight_kg)}</TableCell>
                    <TableCell>{formatMoney(purchase.price_per_kg)}</TableCell>
                    <TableCell className="font-medium">{formatMoney(purchase.amount)}</TableCell>
                    <TableCell>
                      <Badge variant={purchase.sync_status === 'synced' ? 'ok' : 'warn'}>
                        {purchase.sync_status}
                      </Badge>
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
