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
import { formatMoney } from '@/domain/money'
import { useCampaigns, type Campaign } from '@/features/contracts/api'
import {
  useCloseCampaign,
  useClosureBlockers,
  useReopenCampaign,
} from '@/features/subscription/api'
import { useSession } from '@/lib/auth/session'

const STATUS_VARIANT: Record<string, 'ok' | 'warn' | 'neutral'> = {
  ouverte: 'ok',
  reouverte: 'warn',
  cloturee: 'neutral',
}

const BLOCKER_TITLES: Record<string, string> = {
  incidents_ouverts: 'Incidents sans décision',
  avances_non_couvertes: 'Avances non couvertes',
  transferts_en_cours: 'Transferts non clôturés',
  depenses_non_statuees: 'Dépenses en attente',
}

/**
 * Écran de clôture et de réouverture de campagne.
 *
 * La clôture est **bloquante par défaut** : les obstacles se lèvent, ils ne se
 * contournent pas. Mais l'écran les **énumère** au lieu de refuser sèchement —
 * « clôture impossible » sans dire pourquoi oblige l'utilisateur à deviner, et
 * le pousse à chercher un contournement.
 *
 * Le forçage existe, parce qu'une campagne qu'on ne peut jamais arrêter finit
 * par être arrêtée en falsifiant des dates. Il exige un motif circonstancié et
 * inscrit les obstacles contournés au journal d'audit : une clôture forcée dont
 * on ne peut pas reconstituer l'état est pire qu'une campagne restée ouverte.
 */
export function CampaignsPage() {
  const { role } = useSession()
  const { data: campaigns, isLoading } = useCampaigns()
  const close = useCloseCampaign()
  const reopen = useReopenCampaign()

  const [selected, setSelected] = useState<Campaign | null>(null)
  const [reopenTarget, setReopenTarget] = useState<Campaign | null>(null)
  const [reason, setReason] = useState('')
  const [reopenReason, setReopenReason] = useState('')

  const { data: check, isFetching } = useClosureBlockers(selected?.id ?? null)

  const canClose = role === 'proprietaire' || role === 'gestionnaire'
  const canReopen = role === 'proprietaire'

  async function submitClose(force: boolean) {
    if (!selected) return
    await close.mutateAsync({ campaignId: selected.id, reason, force })
    setSelected(null)
    setReason('')
  }

  async function submitReopen(event: React.FormEvent) {
    event.preventDefault()
    if (!reopenTarget) return
    await reopen.mutateAsync({ campaignId: reopenTarget.id, reason: reopenReason })
    setReopenTarget(null)
    setReopenReason('')
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Campagnes</h1>
        <p className="text-muted-foreground">
          Clôture d’exercice et réouverture motivée.
        </p>
      </header>

      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardHeader>
          <CardTitle>Une campagne clôturée n’accepte plus d’écriture</CardTitle>
          <CardDescription>
            Achats, dépenses et avances y sont refusés. La réouverture reste possible, réservée au
            propriétaire et motivée : un exercice qu’on ne peut jamais rouvrir pousse à falsifier les
            dates de l’exercice suivant. Aucune donnée n’est supprimée à la clôture.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campagnes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : (campaigns ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucune campagne enregistrée.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(campaigns ?? []).map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-mono text-xs">{campaign.code}</TableCell>
                    <TableCell>{campaign.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {campaign.start_date} → {campaign.end_date}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[campaign.status] ?? 'neutral'}>
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      {canClose && campaign.status !== 'cloturee' && (
                        <Button variant="link" size="sm" onClick={() => setSelected(campaign)}>
                          Préparer la clôture
                        </Button>
                      )}
                      {canReopen && campaign.status === 'cloturee' && (
                        <Button variant="link" size="sm" onClick={() => setReopenTarget(campaign)}>
                          Rouvrir
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

      {/* Clôture ------------------------------------------------------------ */}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clôturer « {selected?.name} »</DialogTitle>
            <DialogDescription>
              Ce qui reste en suspens est listé ci-dessous, avec son compte et son montant.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {isFetching && (
              <p role="status" className="text-muted-foreground">
                Vérification en cours…
              </p>
            )}

            {check && check.blockers.length === 0 && (
              <p className="rounded-md bg-status-ok/10 px-3 py-2 text-sm">
                Aucun obstacle : la campagne peut être clôturée.
              </p>
            )}

            {check && check.blockers.length > 0 && (
              <div className="space-y-2">
                {check.blockers.map((blocker) => (
                  <div
                    key={blocker.code}
                    className="rounded-md bg-status-warn/10 px-3 py-2 text-sm"
                  >
                    <p className="font-medium">
                      {BLOCKER_TITLES[blocker.code] ?? blocker.code} · {blocker.count}
                      {blocker.amount !== undefined && ` · ${formatMoney(blocker.amount)}`}
                    </p>
                    <p className="text-muted-foreground">{blocker.message}</p>
                  </div>
                ))}
              </div>
            )}

            <Field
              id="closure-reason"
              label="Motif"
              hint="Obligatoire pour forcer la clôture : 20 caractères minimum, décrivant ce qui reste en suspens."
            >
              <Textarea
                id="closure-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>

            {close.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {close.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                Annuler
              </Button>

              {check && check.can_close ? (
                <Button type="button" disabled={close.isPending} onClick={() => submitClose(false)}>
                  {close.isPending ? 'Clôture…' : 'Clôturer'}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={close.isPending || reason.trim().length < 20}
                  onClick={() => submitClose(true)}
                >
                  {close.isPending ? 'Clôture…' : 'Forcer la clôture'}
                </Button>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Réouverture -------------------------------------------------------- */}
      <Dialog open={reopenTarget !== null} onOpenChange={(open) => !open && setReopenTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rouvrir « {reopenTarget?.name} »</DialogTitle>
            <DialogDescription>
              La campagne redeviendra écrivable. Le motif est conservé avec votre nom et la date :
              modifier un exercice clos sans trace serait indéfendable en audit.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitReopen} className="space-y-4">
            <Field id="reopen-reason" label="Motif de réouverture" required hint="10 caractères minimum.">
              <Textarea
                id="reopen-reason"
                required
                value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
              />
            </Field>

            {reopen.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {reopen.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setReopenTarget(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={reopen.isPending || reopenReason.trim().length < 10}>
                {reopen.isPending ? 'Réouverture…' : 'Rouvrir la campagne'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
