import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney, formatWeight } from '@/domain/money'
import { useSession } from '@/lib/auth/session'
import { useDecideIncident, useIncidents, type IncidentRow } from './api'

/** Causes possibles, dans un ordre qui ne privilégie aucune conclusion. */
const CAUSES = [
  { value: 'naturelle', label: 'Perte naturelle (humidité, dessiccation)' },
  { value: 'technique', label: 'Cause technique (pont-bascule, tare, pesée)' },
  { value: 'qualite', label: 'Rejet qualité au contrôle de réception' },
  { value: 'erreur', label: 'Erreur de saisie ou de manipulation' },
  { value: 'responsabilite_confirmee', label: 'Responsabilité établie après enquête' },
  { value: 'inexpliquee', label: 'Écart resté inexpliqué' },
]

const SEVERITY_VARIANT: Record<string, 'ok' | 'warn' | 'critical' | 'neutral'> = {
  faible: 'neutral',
  moderee: 'warn',
  grave: 'critical',
  critique: 'critical',
}

/**
 * Écran E14 — incidents et écarts.
 *
 * Le principe qui gouverne cet écran : **documenter avant d'imputer**. Un écart
 * de poids a plus souvent une cause technique qu'une cause humaine, et une
 * accusation portée trop vite ne se répare pas.
 */
export function IncidentsPage() {
  const { user, role } = useSession()
  const { data: incidents, isLoading } = useIncidents()
  const decide = useDecideIncident(user?.id ?? null)
  const [target, setTarget] = useState<IncidentRow | null>(null)
  const [decision, setDecision] = useState('')
  const [cause, setCause] = useState('')

  const canDecide = role === 'proprietaire' || role === 'gestionnaire'
  const open = (incidents ?? []).filter((incident) =>
    ['ouvert', 'en_enquete', 'reouvert'].includes(incident.status),
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!target) return
    await decide.mutateAsync({ id: target.id, decision, cause })
    setTarget(null)
    setDecision('')
    setCause('')
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Incidents et écarts</h1>
        <p className="text-muted-foreground">
          Documenter les anomalies avant toute imputation de responsabilité.
        </p>
      </header>

      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardHeader>
          <CardTitle>Un écart n’est pas une accusation</CardTitle>
          <CardDescription>
            L’humidité, l’étalonnage des ponts-bascules, la variation de tare, les pertes en transport
            et les erreurs de saisie expliquent la majorité des écarts. Le responsable présumé reste
            « inconnu » tant qu’une enquête n’a pas conclu — le logiciel ne désigne personne.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Incidents ouverts</CardTitle>
          <CardDescription>
            Un incident bloquant empêche la clôture du transfert concerné tant qu’aucune décision
            n’est prise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : open.length === 0 ? (
            <p className="text-muted-foreground">Aucun incident ouvert.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Gravité</TableHead>
                  <TableHead>Quantité exposée</TableHead>
                  <TableHead>Montant exposé</TableHead>
                  <TableHead>Responsable présumé</TableHead>
                  <TableHead>Clôture</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((incident) => (
                  <TableRow key={incident.id}>
                    <TableCell className="font-mono text-xs">{incident.reference}</TableCell>
                    <TableCell>{incident.type.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[incident.severity] ?? 'neutral'}>
                        {incident.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatWeight(incident.exposed_quantity_kg)}</TableCell>
                    <TableCell>{formatMoney(incident.exposed_amount)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {incident.suspected_responsible_type === 'inconnu'
                        ? 'Non déterminé'
                        : (incident.suspected_responsible_type ?? '—')}
                    </TableCell>
                    <TableCell>
                      {incident.blocks_closure ? (
                        <Badge variant="critical">bloquée</Badge>
                      ) : (
                        <Badge variant="ok">libre</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canDecide && (
                        <Button variant="link" size="sm" onClick={() => setTarget(incident)}>
                          Décider
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {open.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Détail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {open.map((incident) => (
              <div key={incident.id}>
                <p className="font-medium">{incident.reference}</p>
                <p className="text-muted-foreground">{incident.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={target !== null} onOpenChange={(isOpen) => !isOpen && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Décision sur l’incident {target?.reference}</DialogTitle>
            <DialogDescription>
              La décision est enregistrée avec son auteur et sa date. Elle lève le blocage de clôture.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <Field id="cause" label="Cause retenue" required>
              <select
                id="cause"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={cause}
                onChange={(event) => setCause(event.target.value)}
              >
                <option value="">Sélectionner…</option>
                {CAUSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="decision"
              label="Décision et justification"
              required
              hint="5 caractères minimum. Elle sera conservée telle quelle dans le journal d’audit."
            >
              <Textarea
                id="decision"
                required
                value={decision}
                onChange={(event) => setDecision(event.target.value)}
              />
            </Field>

            {cause === 'responsabilite_confirmee' && (
              <p className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
                Vous établissez une responsabilité. Assurez-vous que les causes techniques ont été
                écartées : cette décision peut entraîner une retenue financière.
              </p>
            )}

            {decide.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {decide.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setTarget(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={decide.isPending || decision.trim().length < 5 || !cause}>
                {decide.isPending ? 'Enregistrement…' : 'Enregistrer la décision'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
