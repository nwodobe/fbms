import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DEFAULT_ALERT_RULES, type AlertSeverity, type AlertType } from '@/domain/alerts'
import { useSession } from '@/lib/auth/session'
import {
  useAcknowledgeAlert,
  useAlertRules,
  useAlerts,
  useEvaluateAlerts,
  useSaveAlertRule,
  useSeedAlertRules,
} from './api'

const SEVERITY_VARIANT: Record<AlertSeverity, 'ok' | 'warn' | 'critical' | 'neutral'> = {
  info: 'neutral',
  surveillance: 'warn',
  critique: 'critical',
  blocage: 'critical',
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  blocage: 0,
  critique: 1,
  surveillance: 2,
  info: 3,
}

function ruleTitle(type: string): string {
  return DEFAULT_ALERT_RULES[type as AlertType]?.title ?? type.replace(/_/g, ' ')
}

function thresholdLabel(type: string, key: string): string {
  return DEFAULT_ALERT_RULES[type as AlertType]?.thresholdLabels[key] ?? key
}

/**
 * Écran A03 — centre d'alertes.
 *
 * Deux exigences portées par l'interface :
 *
 *  · chaque alerte affiche sa valeur mesurée ET son seuil, pour qu'un lecteur
 *    puisse contester l'un ou l'autre plutôt que seulement obéir ou ignorer ;
 *  · les seuils sont modifiables par l'entreprise. Un seuil imposé par
 *    l'éditeur serait un jugement sur un métier qu'il ne pratique pas.
 */
export function AlertsPage() {
  const { tenantId, user, role } = useSession()
  const { data: alerts, isLoading } = useAlerts()
  const { data: rules } = useAlertRules()
  const evaluate = useEvaluateAlerts(tenantId)
  const seed = useSeedAlertRules(tenantId)
  const saveRule = useSaveAlertRule()
  const acknowledge = useAcknowledgeAlert(user?.id ?? null)

  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'toutes'>('toutes')
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})

  const canConfigure = role === 'proprietaire' || role === 'gestionnaire'

  const open = (alerts ?? [])
    .filter((alert) => alert.status === 'ouverte')
    .filter((alert) => severityFilter === 'toutes' || alert.severity === severityFilter)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Centre d’alertes</h1>
          <p className="text-muted-foreground">
            Vingt règles à seuils configurables, chacune avec sa mesure et son seuil.
          </p>
        </div>
        {canConfigure && (
          <div className="flex gap-2">
            {(rules ?? []).length === 0 && (
              <Button variant="ghost" onClick={() => seed.mutate()} disabled={seed.isPending}>
                Installer les règles par défaut
              </Button>
            )}
            <Button onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
              {evaluate.isPending ? 'Évaluation…' : 'Évaluer maintenant'}
            </Button>
          </div>
        )}
      </header>

      {[evaluate.error, seed.error, saveRule.error, acknowledge.error]
        .filter((error): error is Error => Boolean(error))
        .map((error) => (
          <p
            key={error.message}
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error.message}
          </p>
        ))}

      {evaluate.isSuccess && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm" role="status">
          {evaluate.data} alerte(s) ouverte(s) par cette évaluation. Une condition déjà signalée ne
          rouvre pas d’alerte : une alerte répétée cent fois n’est plus lue par personne.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Alertes ouvertes</CardTitle>
          <CardDescription>
            Chaque ligne indique ce qui a été mesuré et le seuil qui l’a déclenchée.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field id="severity-filter" label="Filtrer par gravité">
            <select
              id="severity-filter"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm md:w-64"
              value={severityFilter}
              onChange={(event) =>
                setSeverityFilter(event.target.value as AlertSeverity | 'toutes')
              }
            >
              <option value="toutes">Toutes</option>
              <option value="blocage">Blocage</option>
              <option value="critique">Critique</option>
              <option value="surveillance">Surveillance</option>
              <option value="info">Information</option>
            </select>
          </Field>

          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : open.length === 0 ? (
            <p className="text-muted-foreground">Aucune alerte ouverte.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gravité</TableHead>
                  <TableHead>Règle</TableHead>
                  <TableHead>Constat</TableHead>
                  <TableHead>Mesuré</TableHead>
                  <TableHead>Seuil</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[alert.severity]}>{alert.severity}</Badge>
                    </TableCell>
                    <TableCell>{ruleTitle(alert.alert_type)}</TableCell>
                    <TableCell>{alert.message}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {alert.measured_value === null ? '—' : Number(alert.measured_value)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {alert.threshold_value === null ? '—' : Number(alert.threshold_value)}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() =>
                          acknowledge.mutate({ id: alert.id, status: 'acquittee', note: '' })
                        }
                      >
                        Acquitter
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() =>
                          acknowledge.mutate({ id: alert.id, status: 'resolue', note: '' })
                        }
                      >
                        Résoudre
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canConfigure && (rules ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Seuils</CardTitle>
            <CardDescription>
              Chaque règle peut être ajustée ou désactivée. Une règle désactivée reste enregistrée :
              on peut la réactiver sans perdre son paramétrage.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Règle</TableHead>
                  <TableHead>Gravité</TableHead>
                  <TableHead>Seuils</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rules ?? []).map((rule) => {
                  const draft = drafts[rule.id] ?? {}
                  return (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <p>{ruleTitle(rule.alert_type)}</p>
                        <p className="text-xs text-muted-foreground">
                          {DEFAULT_ALERT_RULES[rule.alert_type as AlertType]?.description}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={SEVERITY_VARIANT[rule.severity]}>{rule.severity}</Badge>
                      </TableCell>
                      <TableCell className="space-y-2">
                        {Object.entries(rule.threshold).map(([key, value]) => (
                          <label key={key} className="flex items-center gap-2 text-xs">
                            <span className="w-48 text-muted-foreground">
                              {thresholdLabel(rule.alert_type, key)}
                            </span>
                            <Input
                              className="h-8 w-28"
                              type="number"
                              aria-label={`${ruleTitle(rule.alert_type)} — ${thresholdLabel(rule.alert_type, key)}`}
                              value={draft[key] ?? String(value)}
                              onChange={(event) =>
                                setDrafts({
                                  ...drafts,
                                  [rule.id]: { ...draft, [key]: event.target.value },
                                })
                              }
                            />
                          </label>
                        ))}
                      </TableCell>
                      <TableCell>
                        {rule.is_active ? (
                          <Badge variant="ok">active</Badge>
                        ) : (
                          <Badge variant="neutral">inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() =>
                            saveRule.mutate({
                              id: rule.id,
                              threshold: Object.fromEntries(
                                Object.entries(rule.threshold).map(([key, value]) => [
                                  key,
                                  Number(draft[key] ?? value),
                                ]),
                              ),
                              isActive: rule.is_active,
                            })
                          }
                        >
                          Enregistrer
                        </Button>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() =>
                            saveRule.mutate({
                              id: rule.id,
                              threshold: rule.threshold,
                              isActive: !rule.is_active,
                            })
                          }
                        >
                          {rule.is_active ? 'Désactiver' : 'Activer'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
