import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/domain/money'
import { useFieldAgents, type FieldAgent } from './api'

const STATUS: Record<FieldAgent['status'], { label: string; variant: 'ok' | 'warn' | 'neutral' }> = {
  actif: { label: 'Actif', variant: 'ok' },
  suspendu: { label: 'Suspendu', variant: 'warn' },
  cloture: { label: 'Clôturé', variant: 'neutral' },
}

/** Écran C01 — liste des pisteurs. */
export function AgentsPage() {
  const { data: agents, isLoading, error } = useFieldAgents()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Pisteurs</h1>
        <p className="text-muted-foreground">
          Plafonds, sociétés autorisées et situation financière de chaque agent terrain.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Liste</CardTitle>
          <CardDescription>
            Le score et l’exposition détaillée sont visibles sur la fiche de chaque pisteur.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : !agents || agents.length === 0 ? (
            <p className="text-muted-foreground">
              Aucun pisteur enregistré. Créez-en un pour pouvoir remettre des avances.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Téléphone</TableHead>
                  <TableHead>Plafond</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => {
                  const status = STATUS[agent.status] ?? { label: agent.status, variant: 'neutral' as const }
                  return (
                    <TableRow key={agent.id}>
                      <TableCell className="font-mono text-xs">{agent.code}</TableCell>
                      <TableCell className="font-medium">{agent.full_name}</TableCell>
                      <TableCell className="text-muted-foreground">{agent.phone ?? '—'}</TableCell>
                      <TableCell>{formatMoney(agent.ceiling_amount)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {agent.commission_mode === 'aucune'
                          ? '—'
                          : `${agent.commission_value} · ${agent.commission_mode.replace('_', ' ')}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="link" size="sm" asChild>
                          <Link to={`/pisteurs/${agent.id}`}>Ouvrir</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
