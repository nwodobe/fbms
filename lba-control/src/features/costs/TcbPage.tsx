import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney, formatWeight } from '@/domain/money'
import { computeNetSalePrice } from '@/domain/margin'
import { useCampaigns } from '@/features/contracts/api'
import { usePartnerCompanies } from '@/features/partners/api'
import { useSession } from '@/lib/auth/session'
import { useComputeTcb, useRecordMargin, useTcbComponents, useTcbSnapshots } from './api'

const COMPONENT_LABELS: Record<string, string> = {
  valeur_achat: 'Valeur d’achat',
  charges_indirectes: 'Charges indirectes imputées',
  pertes_valorisees: 'Pertes valorisées',
}

function componentLabel(code: string): string {
  if (COMPONENT_LABELS[code]) return COMPONENT_LABELS[code]
  if (code.startsWith('depenses:')) return `Dépenses · ${code.slice('depenses:'.length)}`
  return code
}

/** Affiche « — » plutôt qu’un zéro inventé quand la donnée n’existe pas. */
function perKg(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)} FCFA/kg`
}

/**
 * Écran F03 — TCB et marges.
 *
 * L'écran est construit autour d'une conviction : un coût de revient qu'on ne
 * peut pas décomposer n'aide personne à décider. Chaque instantané expose donc
 * ses composantes, et la marge est affichée sous ses deux définitions avec leur
 * écart de réconciliation — parce que les deux ne se déduisent pas l'une de
 * l'autre dès qu'une retenue forfaitaire entre en jeu (INC-06).
 */
export function TcbPage() {
  const { role } = useSession()
  const { data: snapshots, isLoading } = useTcbSnapshots()
  const { data: partners } = usePartnerCompanies()
  const { data: campaigns } = useCampaigns()
  const compute = useComputeTcb()
  const recordMargin = useRecordMargin()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scopeId, setScopeId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [margin, setMargin] = useState({
    negotiatedPrice: '',
    premium: '',
    penalty: '',
    withholding: '',
    netRevenue: '',
  })

  const selected = (snapshots ?? []).find((snapshot) => snapshot.id === selectedId) ?? null
  const { data: components } = useTcbComponents(selectedId)

  const canCompute = role === 'proprietaire' || role === 'gestionnaire' || role === 'comptable'
  const partnerName = (id: string) => partners?.find((partner) => partner.id === id)?.name ?? id

  const netSale = computeNetSalePrice({
    negotiatedPrice: Number(margin.negotiatedPrice) || 0,
    premiums: margin.premium ? [{ code: 'prime', label: 'Primes', amountPerKg: Number(margin.premium) }] : [],
    penalties: margin.penalty
      ? [{ code: 'penalite', label: 'Pénalités', amountPerKg: Number(margin.penalty) }]
      : [],
    withholdings: margin.withholding
      ? [{ code: 'retenue', label: 'Retenues', amountPerKg: Number(margin.withholding) }]
      : [],
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">TCB et marges</h1>
        <p className="text-muted-foreground">
          Comprendre le coût réel par kilo et la source de destruction de marge.
        </p>
      </header>

      {canCompute && (
        <Card>
          <CardHeader>
            <CardTitle>Calculer un instantané</CardTitle>
            <CardDescription>
              Le calcul est fait au serveur à partir des achats validés, des dépenses validées, des
              quotes-parts indirectes et des pertes valorisées. Une avance n’y entre jamais.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="scope" label="Société" required>
                <select
                  id="scope"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={scopeId}
                  onChange={(event) => setScopeId(event.target.value)}
                >
                  <option value="">Sélectionner…</option>
                  {(partners ?? []).map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="tcb-campaign" label="Campagne">
                <select
                  id="tcb-campaign"
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
              disabled={!scopeId || compute.isPending}
              onClick={() =>
                compute.mutate({
                  scopeType: 'partner',
                  scopeId,
                  campaignId: campaignId || null,
                  isForecast: false,
                })
              }
            >
              {compute.isPending ? 'Calcul…' : 'Calculer le TCB'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Instantanés</CardTitle>
          <CardDescription>
            Le TCB par kilo reste vide tant qu’aucun kilo n’est accepté : un coût de 0 FCFA/kg serait
            une information fausse.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : (snapshots ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun instantané calculé.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Périmètre</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Poids accepté</TableHead>
                  <TableHead>TCB total</TableHead>
                  <TableHead>TCB / kg accepté</TableHead>
                  <TableHead>Marge totale</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(snapshots ?? []).map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell>
                      {snapshot.scope_type === 'partner'
                        ? partnerName(snapshot.scope_id)
                        : snapshot.scope_id}
                    </TableCell>
                    <TableCell>
                      <Badge variant={snapshot.is_forecast ? 'warn' : 'neutral'}>
                        {snapshot.is_forecast ? 'prévisionnel' : 'réel'}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatWeight(snapshot.accepted_weight_kg)}</TableCell>
                    <TableCell>{formatMoney(snapshot.tcb_total)}</TableCell>
                    <TableCell>{perKg(snapshot.tcb_per_accepted_kg)}</TableCell>
                    <TableCell>
                      {snapshot.margin_total === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge variant={snapshot.is_deficit ? 'critical' : 'ok'}>
                          {formatMoney(snapshot.margin_total)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => setSelectedId(snapshot.id)}>
                        Décomposer
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
              <CardTitle>Décomposition du TCB</CardTitle>
              <CardDescription>
                Chaque composante indique son montant, son coût au kilo et le nombre de transactions
                sources.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Composante</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead>Par kg accepté</TableHead>
                    <TableHead>Transactions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(components ?? []).map((component) => (
                    <TableRow key={component.id}>
                      <TableCell>{componentLabel(component.component)}</TableCell>
                      <TableCell>{formatMoney(component.amount)}</TableCell>
                      <TableCell>{perKg(component.amount_per_kg)}</TableCell>
                      <TableCell>{component.source_count ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="font-semibold">{formatMoney(selected.tcb_total)}</TableCell>
                    <TableCell className="font-semibold">
                      {perKg(selected.tcb_per_accepted_kg)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>

              {selected.tcb_per_accepted_kg === null && (
                <p className="mt-4 rounded-md bg-status-warn/10 px-3 py-2 text-sm">
                  Aucun kilo accepté sur ce périmètre : le coût au kilo n’est pas calculable. Ce
                  n’est pas zéro, c’est une donnée qui n’existe pas encore.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Marges</CardTitle>
              <CardDescription>
                Deux définitions coexistent et ne se déduisent pas l’une de l’autre. Leur écart est
                affiché tel quel : c’est un point de contrôle de la facturation, pas une erreur.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="negotiated" label="Prix négocié (FCFA/kg)">
                  <Input
                    id="negotiated"
                    type="number"
                    value={margin.negotiatedPrice}
                    onChange={(event) =>
                      setMargin({ ...margin, negotiatedPrice: event.target.value })
                    }
                  />
                </Field>
                <Field id="premium" label="Primes (FCFA/kg)">
                  <Input
                    id="premium"
                    type="number"
                    value={margin.premium}
                    onChange={(event) => setMargin({ ...margin, premium: event.target.value })}
                  />
                </Field>
                <Field id="penalty" label="Pénalités (FCFA/kg)">
                  <Input
                    id="penalty"
                    type="number"
                    value={margin.penalty}
                    onChange={(event) => setMargin({ ...margin, penalty: event.target.value })}
                  />
                </Field>
                <Field id="withholding" label="Retenues (FCFA/kg)">
                  <Input
                    id="withholding"
                    type="number"
                    value={margin.withholding}
                    onChange={(event) => setMargin({ ...margin, withholding: event.target.value })}
                  />
                </Field>
                <Field
                  id="net-revenue"
                  label="Chiffre d’affaires net facturé (FCFA)"
                  hint="Tel que facturé, avoirs et retenues forfaitaires compris."
                >
                  <Input
                    id="net-revenue"
                    type="number"
                    value={margin.netRevenue}
                    onChange={(event) => setMargin({ ...margin, netRevenue: event.target.value })}
                  />
                </Field>
              </div>

              <p className="text-sm">
                Prix de vente net calculé : <strong>{perKg(netSale.netSalePrice)}</strong>
                {netSale.isNegative && (
                  <span className="ml-2 text-destructive">
                    Les retenues dépassent le prix : vérifiez la saisie.
                  </span>
                )}
              </p>

              <dl className="grid gap-3 md:grid-cols-3">
                <div>
                  <dt className="text-sm text-muted-foreground">Marge totale</dt>
                  <dd className="text-lg font-semibold">{formatMoney(selected.margin_total)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Marge par kg</dt>
                  <dd className="text-lg font-semibold">{perKg(selected.margin_per_kg)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Écart de réconciliation</dt>
                  <dd className="text-lg font-semibold">
                    {formatMoney(selected.margin_reconciliation_gap)}
                  </dd>
                </div>
              </dl>

              {selected.margin_reconciliation_gap !== null &&
                Math.abs(Number(selected.margin_reconciliation_gap)) >= 1 && (
                  <p className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
                    Les deux marges divergent : le chiffre d’affaires ne porte pas exactement sur le
                    poids accepté (avoir, retenue forfaitaire ou pénalité non proportionnelle).
                    Aucune des deux n’est corrigée à partir de l’autre.
                  </p>
                )}

              {recordMargin.error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {recordMargin.error.message}
                </p>
              )}

              {canCompute && (
                <Button
                  disabled={recordMargin.isPending || !margin.netRevenue}
                  onClick={() =>
                    recordMargin.mutate({
                      snapshotId: selected.id,
                      netRevenue: Number(margin.netRevenue),
                      netSalePricePerKg: netSale.netSalePrice,
                    })
                  }
                >
                  {recordMargin.isPending ? 'Enregistrement…' : 'Enregistrer les marges'}
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
