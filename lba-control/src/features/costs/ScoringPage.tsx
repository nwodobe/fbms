import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/domain/money'
import {
  CATEGORY_LABELS,
  SCORE_COMPONENT_CODES,
  SCORE_COMPONENT_LABELS,
  SCORE_WEIGHTS,
  type ScoreCategory,
  type ScoreComponentCode,
} from '@/domain/scoring'
import { useFieldAgents } from '@/features/agents/api'
import { useCampaigns } from '@/features/contracts/api'
import { useSession } from '@/lib/auth/session'
import { useAdjustScore, useAgentScores, useComputeScore, useScoreComponents } from './api'

const CATEGORY_VARIANT: Record<ScoreCategory, 'ok' | 'warn' | 'critical' | 'neutral'> = {
  excellent: 'ok',
  fiable: 'ok',
  sous_surveillance: 'warn',
  risque: 'critical',
  critique: 'critical',
  non_evalue: 'neutral',
}

const MATURITY_LABELS: Record<string, string> = {
  non_evalue: 'Non évalué',
  en_observation: 'En observation',
  provisoire: 'Provisoire',
  confirme: 'Confirmé',
}

function score(value: number | null): string {
  return value === null ? '—' : `${value}/100`
}

/**
 * Écran G02 — scoring des pisteurs.
 *
 * Ce que l'écran s'interdit : transformer un chiffre en sanction. Le plafond
 * proposé est présenté comme une recommandation, jamais appliqué. Une
 * composante non mesurée est affichée comme telle et non notée zéro — punir
 * quelqu'un pour une chose qui n'a pas eu lieu serait une injustice fabriquée
 * par le logiciel.
 */
export function ScoringPage() {
  const { role } = useSession()
  const { data: scores, isLoading } = useAgentScores()
  const { data: agents } = useFieldAgents()
  const { data: campaigns } = useCampaigns()
  const compute = useComputeScore()
  const adjust = useAdjustScore()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agentId, setAgentId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')

  const { data: components } = useScoreComponents(selectedId)
  const selected = (scores ?? []).find((item) => item.id === selectedId) ?? null

  const canCompute = role === 'proprietaire' || role === 'gestionnaire'
  const agentName = (id: string) => agents?.find((agent) => agent.id === id)?.full_name ?? id

  const measured = new Set((components ?? []).map((component) => component.component))
  const unmeasured = SCORE_COMPONENT_CODES.filter((code) => !measured.has(code))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Scoring des pisteurs</h1>
        <p className="text-muted-foreground">Évaluer automatiquement sans créer une boîte noire.</p>
      </header>

      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardHeader>
          <CardTitle>Un score ne sanctionne personne</CardTitle>
          <CardDescription>
            Le score propose, un responsable décide. Aucun plafond n’est modifié automatiquement.
            Une composante sans donnée est exclue du calcul et son poids redistribué : elle n’est
            jamais notée zéro. Un pisteur récent reste « non évalué » tant que son historique ne
            porte pas de conclusion.
          </CardDescription>
        </CardHeader>
      </Card>

      {canCompute && (
        <Card>
          <CardHeader>
            <CardTitle>Calculer un score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="score-agent" label="Pisteur" required>
                <select
                  id="score-agent"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={agentId}
                  onChange={(event) => setAgentId(event.target.value)}
                >
                  <option value="">Sélectionner…</option>
                  {(agents ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.full_name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="score-campaign" label="Campagne">
                <select
                  id="score-campaign"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={campaignId}
                  onChange={(event) => setCampaignId(event.target.value)}
                >
                  <option value="">Toutes campagnes</option>
                  {(campaigns ?? []).map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {compute.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {compute.error.message}
              </p>
            )}

            <Button
              disabled={!agentId || compute.isPending}
              onClick={() => compute.mutate({ agentId, campaignId: campaignId || null })}
            >
              {compute.isPending ? 'Calcul…' : 'Calculer le score'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Scores calculés</CardTitle>
          <CardDescription>
            Score brut, score ajusté aux événements externes validés et score affiché sont conservés
            séparément.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : (scores ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun score calculé.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pisteur</TableHead>
                  <TableHead>Score brut</TableHead>
                  <TableHead>Ajusté (événements)</TableHead>
                  <TableHead>Affiché</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Maturité</TableHead>
                  <TableHead>Plafond recommandé</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(scores ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{agentName(item.field_agent_id)}</TableCell>
                    <TableCell>{score(item.raw_score)}</TableCell>
                    <TableCell>{score(item.event_adjusted_score)}</TableCell>
                    <TableCell className="font-semibold">{score(item.adjusted_score)}</TableCell>
                    <TableCell>
                      <Badge variant={CATEGORY_VARIANT[item.category as ScoreCategory] ?? 'neutral'}>
                        {CATEGORY_LABELS[item.category as ScoreCategory] ?? item.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {MATURITY_LABELS[item.maturity] ?? item.maturity}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.recommended_ceiling === null
                        ? '—'
                        : `${formatMoney(item.recommended_ceiling)} (proposé)`}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => setSelectedId(item.id)}>
                        Détailler
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Composantes de {agentName(selected.field_agent_id)}</CardTitle>
              <CardDescription>
                Poids nominal, valeur, contribution et données sources de chaque composante.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Composante</TableHead>
                    <TableHead>Poids</TableHead>
                    <TableHead>Valeur</TableHead>
                    <TableHead>Contribution</TableHead>
                    <TableHead>Données sources</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(components ?? []).map((component) => (
                    <TableRow key={component.id}>
                      <TableCell>
                        {SCORE_COMPONENT_LABELS[component.component as ScoreComponentCode] ??
                          component.component}
                      </TableCell>
                      <TableCell>{Number(component.weight)}</TableCell>
                      <TableCell>{Number(component.value)}/100</TableCell>
                      <TableCell>{Number(component.weighted_value).toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {JSON.stringify(component.source_data)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {unmeasured.length > 0 && (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <p className="font-medium">Composantes non mesurées sur la période</p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {unmeasured.map((code) => (
                      <li key={code}>
                        {SCORE_COMPONENT_LABELS[code]} — poids nominal {SCORE_WEIGHTS[code]},
                        redistribué sur les composantes observées. Non notée zéro.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.excluded_events.length > 0 && (
                <p className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
                  {selected.excluded_events.length} événement(s) externe(s) validé(s) neutralisé(s)
                  dans le score ajusté :{' '}
                  {selected.excluded_events.map((event) => event.type).join(', ')}.
                </p>
              )}
            </CardContent>
          </Card>

          {canCompute && (
            <Card>
              <CardHeader>
                <CardTitle>Ajustement humain</CardTitle>
                <CardDescription>
                  L’ajustement modifie le score affiché. Le score brut et les composantes restent
                  intacts et reconstituables.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field id="delta" label="Correction (points)" required>
                  <Input
                    id="delta"
                    type="number"
                    value={delta}
                    onChange={(event) => setDelta(event.target.value)}
                  />
                </Field>

                <Field
                  id="adjust-reason"
                  label="Motif"
                  required
                  hint="10 caractères minimum. Conservé avec son auteur et sa date."
                >
                  <Textarea
                    id="adjust-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>

                {adjust.error && (
                  <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {adjust.error.message}
                  </p>
                )}

                <Button
                  disabled={adjust.isPending || reason.trim().length < 10 || delta === ''}
                  onClick={async () => {
                    await adjust.mutateAsync({
                      scoreId: selected.id,
                      delta: Number(delta),
                      reason,
                    })
                    setDelta('')
                    setReason('')
                  }}
                >
                  {adjust.isPending ? 'Enregistrement…' : 'Enregistrer l’ajustement'}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
