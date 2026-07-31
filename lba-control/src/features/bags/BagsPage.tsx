import { Plus } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  BAG_MOVEMENT_LABELS,
  checkBagMovement,
  computeBalances,
  JUSTIFIED_MOVEMENTS,
  type BagMovement,
  type BagMovementType,
  type HolderType,
} from '@/domain/bags'
import { useFieldAgents } from '@/features/agents/api'
import { usePartnerCompanies } from '@/features/partners/api'
import { useSession } from '@/lib/auth/session'
import {
  useBagMovements,
  useBagReconciliation,
  useBagStocks,
  useCreateBagMovement,
  useReassignBags,
} from './api'

const SELECT_CLASS = 'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

const HOLDER_LABELS: Record<HolderType, string> = {
  warehouse: 'Magasin',
  field_agent: 'Pisteur',
  in_transit: 'En transit',
  partner_site: 'Site de la société',
}

/** Origine et destination attendues pour chaque type, reprises du domaine. */
const SHAPES: Record<BagMovementType, { from: HolderType | null; to: HolderType | null }> = {
  reception_societe: { from: null, to: 'warehouse' },
  dotation_pisteur: { from: 'warehouse', to: 'field_agent' },
  utilisation_achat: { from: 'field_agent', to: null },
  retour_vide: { from: 'field_agent', to: 'warehouse' },
  retour_plein: { from: 'field_agent', to: 'warehouse' },
  perte: { from: 'warehouse', to: null },
  reaffectation: { from: 'warehouse', to: 'warehouse' },
}

/**
 * Écran E11 — sacherie.
 *
 * Un sac vaut peu ; deux mille sacs perdus valent une campagne. C'est le poste
 * où les pertes passent le plus facilement inaperçues, parce que personne ne
 * les compte au moment où elles se produisent.
 *
 * L'écran refuse trois choses : saisir un solde (il se déduit des mouvements),
 * enregistrer une perte sans explication, et déplacer des sacs entre deux
 * sociétés sans approbation — c'est un transfert de valeur entre tiers.
 */
export function BagsPage() {
  const { tenantId, user, role } = useSession()
  const { data: movements, isLoading } = useBagMovements()
  const { data: stocks } = useBagStocks()
  const { data: partners } = usePartnerCompanies()
  const { data: agents } = useFieldAgents()

  const create = useCreateBagMovement(tenantId, user?.id ?? null)
  const reassign = useReassignBags()

  const [isOpen, setOpen] = useState(false)
  const [isReassignOpen, setReassignOpen] = useState(false)
  const [scopePartner, setScopePartner] = useState('')

  const [form, setForm] = useState({
    partnerCompanyId: '',
    type: 'reception_societe' as BagMovementType,
    quantity: '',
    fieldAgentId: '',
    reason: '',
  })

  const [transfer, setTransfer] = useState({
    fromPartnerId: '',
    toPartnerId: '',
    quantity: '',
    reason: '',
  })

  const canManage = role === 'proprietaire' || role === 'gestionnaire' || role === 'magasinier'
  const canReassign = role === 'proprietaire' || role === 'gestionnaire'

  const { data: reconciliation } = useBagReconciliation(tenantId, scopePartner || null)

  const partnerName = (id: string | null) =>
    id === null ? '—' : (partners?.find((partner) => partner.id === id)?.name ?? id)
  const agentName = (id: string | null) =>
    id === null ? '—' : (agents?.find((agent) => agent.id === id)?.full_name ?? id)

  // Le contrôle de saisie rejoue exactement la règle serveur : le magasinier
  // voit le solde disponible pendant qu'il tape, plutôt qu'un refus après coup.
  const domainMovements: BagMovement[] = (movements ?? []).map((row) => ({
    id: row.id,
    partnerCompanyId: row.partner_company_id,
    type: row.type,
    quantity: Number(row.quantity),
    fromHolderType: row.from_holder_type,
    fromHolderId: row.from_holder_id,
    toHolderType: row.to_holder_type,
    toHolderId: row.to_holder_id,
    fieldAgentId: row.field_agent_id,
    occurredAt: row.occurred_at,
    reason: row.reason,
    approvedBy: row.approved_by,
  }))

  const balances = computeBalances(domainMovements)
  const shape = SHAPES[form.type]
  const needsAgent = shape.from === 'field_agent' || shape.to === 'field_agent'

  const check = checkBagMovement(
    {
      partnerCompanyId: form.partnerCompanyId || null,
      type: form.type,
      quantity: Number(form.quantity) || 0,
      fromHolderType: shape.from,
      fromHolderId: shape.from === 'field_agent' ? form.fieldAgentId || null : null,
      toHolderType: shape.to,
      toHolderId: shape.to === 'field_agent' ? form.fieldAgentId || null : null,
      reason: form.reason,
      // La réaffectation passe par son propre formulaire, qui porte
      // l'approbation ; ici le type n'est pas proposé.
      approvedBy: null,
    },
    balances,
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await create.mutateAsync({
      partnerCompanyId: form.partnerCompanyId,
      type: form.type,
      quantity: Number(form.quantity),
      fromHolderType: shape.from,
      fromHolderId: shape.from === 'field_agent' ? form.fieldAgentId || null : null,
      toHolderType: shape.to,
      toHolderId: shape.to === 'field_agent' ? form.fieldAgentId || null : null,
      fieldAgentId: needsAgent ? form.fieldAgentId || null : null,
      reason: form.reason,
    })
    setOpen(false)
    setForm({ ...form, quantity: '', reason: '' })
  }

  async function submitReassign(event: React.FormEvent) {
    event.preventDefault()
    await reassign.mutateAsync({
      fromPartnerId: transfer.fromPartnerId,
      toPartnerId: transfer.toPartnerId,
      holderType: 'warehouse',
      holderId: null,
      quantity: Number(transfer.quantity),
      reason: transfer.reason,
    })
    setReassignOpen(false)
    setTransfer({ ...transfer, quantity: '', reason: '' })
  }

  const warehouseStocks = (stocks ?? []).filter((stock) => stock.holder_type === 'warehouse')
  const agentStocks = (stocks ?? [])
    .filter((stock) => stock.holder_type === 'field_agent' && Number(stock.bag_count) !== 0)
    .sort((a, b) => Number(b.bag_count) - Number(a.bag_count))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sacherie</h1>
          <p className="text-muted-foreground">
            Dotations, retours et pertes de sacs, par société et par détenteur.
          </p>
        </div>
        <div className="flex gap-2">
          {canReassign && (
            <Button variant="ghost" onClick={() => setReassignOpen(true)}>
              Réaffecter entre sociétés
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} />
              Nouveau mouvement
            </Button>
          )}
        </div>
      </header>

      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardHeader>
          <CardTitle>Le solde ne se saisit pas</CardTitle>
          <CardDescription>
            Il se déduit des mouvements enregistrés. Un solde corrigeable à la main est un solde
            auquel on ne peut pas se fier. Une perte se déclare avec son explication : un solde qui
            baisse sans mouvement de perte est une perte cachée.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Soldes en magasin</CardTitle>
        </CardHeader>
        <CardContent>
          {warehouseStocks.length === 0 ? (
            <p className="text-muted-foreground">Aucun sac en magasin.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Société</TableHead>
                  <TableHead>Sacs disponibles</TableHead>
                  <TableHead>Dernier mouvement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warehouseStocks.map((stock) => (
                  <TableRow key={stock.id}>
                    <TableCell>{partnerName(stock.partner_company_id)}</TableCell>
                    <TableCell className="font-semibold">{Number(stock.bag_count)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {stock.updated_at.slice(0, 10)}
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
          <CardTitle>Sacs détenus par les pisteurs</CardTitle>
          <CardDescription>
            Ce que chacun doit restituer, vide ou plein. Un solde ancien et élevé mérite une visite,
            pas une sanction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {agentStocks.length === 0 ? (
            <p className="text-muted-foreground">Aucun sac détenu par un pisteur.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pisteur</TableHead>
                  <TableHead>Société</TableHead>
                  <TableHead>Sacs détenus</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentStocks.map((stock) => (
                  <TableRow key={stock.id}>
                    <TableCell>{agentName(stock.holder_id)}</TableCell>
                    <TableCell>{partnerName(stock.partner_company_id)}</TableCell>
                    <TableCell className="font-semibold">{Number(stock.bag_count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rapprochement par société</CardTitle>
          <CardDescription>
            Reçu, distribué, retourné, utilisé, perdu. Le taux de perte reste vide tant que rien
            n’a été distribué.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field id="scope-partner" label="Société">
            <select
              id="scope-partner"
              className={`${SELECT_CLASS} md:w-72`}
              value={scopePartner}
              onChange={(event) => setScopePartner(event.target.value)}
            >
              <option value="">Sélectionner…</option>
              {(partners ?? []).map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </Field>

          {reconciliation && (
            <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {[
                ['Reçus de la société', reconciliation.received],
                ['Distribués aux pisteurs', reconciliation.distributed],
                ['Retournés', reconciliation.returned],
                ['Utilisés à l’achat', reconciliation.used_for_purchases],
                ['Pertes déclarées', reconciliation.declared_losses],
                ['Détenus par les pisteurs', reconciliation.held_by_agents],
                ['Attendus en magasin', reconciliation.expected_in_warehouse],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold">{Number(value)}</dd>
                </div>
              ))}
              <div>
                <dt className="text-sm text-muted-foreground">Taux de perte</dt>
                <dd className="text-lg font-semibold">
                  {reconciliation.loss_rate_pct === null
                    ? '—'
                    : `${Number(reconciliation.loss_rate_pct)} %`}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mouvements</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : (movements ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun mouvement enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Société</TableHead>
                  <TableHead>Origine</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Sacs</TableHead>
                  <TableHead>Motif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(movements ?? []).map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="font-mono text-xs">
                      {movement.occurred_at.slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={movement.type === 'perte' ? 'critical' : 'neutral'}>
                        {BAG_MOVEMENT_LABELS[movement.type]}
                      </Badge>
                    </TableCell>
                    <TableCell>{partnerName(movement.partner_company_id)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {movement.from_holder_type
                        ? movement.from_holder_type === 'field_agent'
                          ? agentName(movement.from_holder_id)
                          : HOLDER_LABELS[movement.from_holder_type]
                        : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {movement.to_holder_type
                        ? movement.to_holder_type === 'field_agent'
                          ? agentName(movement.to_holder_id)
                          : HOLDER_LABELS[movement.to_holder_type]
                        : '—'}
                    </TableCell>
                    <TableCell className="font-semibold">{Number(movement.quantity)}</TableCell>
                    <TableCell className="text-muted-foreground">{movement.reason ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Saisie d'un mouvement ---------------------------------------------- */}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau mouvement de sacs</DialogTitle>
            <DialogDescription>
              Le solde du détenteur d’origine est affiché pendant la saisie.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <Field id="bag-partner" label="Société propriétaire des sacs" required>
              <select
                id="bag-partner"
                required
                className={SELECT_CLASS}
                value={form.partnerCompanyId}
                onChange={(event) => setForm({ ...form, partnerCompanyId: event.target.value })}
              >
                <option value="">Sélectionner…</option>
                {(partners ?? []).map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="bag-type" label="Type de mouvement" required>
              <select
                id="bag-type"
                className={SELECT_CLASS}
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as BagMovementType })
                }
              >
                {(Object.keys(BAG_MOVEMENT_LABELS) as BagMovementType[])
                  // La réaffectation a son propre formulaire : elle exige une
                  // approbation nominative que ce formulaire ne recueille pas.
                  .filter((type) => type !== 'reaffectation')
                  .map((type) => (
                    <option key={type} value={type}>
                      {BAG_MOVEMENT_LABELS[type]}
                    </option>
                  ))}
              </select>
            </Field>

            {needsAgent && (
              <Field id="bag-agent" label="Pisteur" required>
                <select
                  id="bag-agent"
                  required
                  className={SELECT_CLASS}
                  value={form.fieldAgentId}
                  onChange={(event) => setForm({ ...form, fieldAgentId: event.target.value })}
                >
                  <option value="">Sélectionner…</option>
                  {(agents ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.full_name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field id="bag-quantity" label="Nombre de sacs" required>
              <Input
                id="bag-quantity"
                type="number"
                min="1"
                required
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              />
            </Field>

            {JUSTIFIED_MOVEMENTS.includes(form.type) && (
              <Field
                id="bag-reason"
                label="Explication"
                required
                hint="5 caractères minimum. Une perte sans explication est indéfendable en fin de campagne."
              >
                <Textarea
                  id="bag-reason"
                  value={form.reason}
                  onChange={(event) => setForm({ ...form, reason: event.target.value })}
                />
              </Field>
            )}

            {check.availableAtOrigin !== null && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                Solde disponible à l’origine : <strong>{check.availableAtOrigin}</strong> sac(s).
              </p>
            )}

            {check.issues.map((issue) => (
              <p
                key={issue.code}
                className="rounded-md bg-status-warn/10 px-3 py-2 text-sm"
              >
                {issue.message}
              </p>
            ))}

            {create.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {create.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={create.isPending || !check.canProceed}>
                {create.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Réaffectation ------------------------------------------------------ */}
      <Dialog open={isReassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réaffecter des sacs entre sociétés</DialogTitle>
            <DialogDescription>
              Déplacer des sacs d’une société vers une autre est un transfert de valeur entre deux
              tiers. L’opération est approuvée par vous, motivée, et inscrite au journal d’audit.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitReassign} className="space-y-4">
            <Field id="from-partner" label="Société d’origine" required>
              <select
                id="from-partner"
                required
                className={SELECT_CLASS}
                value={transfer.fromPartnerId}
                onChange={(event) => setTransfer({ ...transfer, fromPartnerId: event.target.value })}
              >
                <option value="">Sélectionner…</option>
                {(partners ?? []).map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="to-partner" label="Société de destination" required>
              <select
                id="to-partner"
                required
                className={SELECT_CLASS}
                value={transfer.toPartnerId}
                onChange={(event) => setTransfer({ ...transfer, toPartnerId: event.target.value })}
              >
                <option value="">Sélectionner…</option>
                {(partners ?? [])
                  .filter((partner) => partner.id !== transfer.fromPartnerId)
                  .map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
              </select>
            </Field>

            <Field id="reassign-quantity" label="Nombre de sacs" required>
              <Input
                id="reassign-quantity"
                type="number"
                min="1"
                required
                value={transfer.quantity}
                onChange={(event) => setTransfer({ ...transfer, quantity: event.target.value })}
              />
            </Field>

            <Field id="reassign-reason" label="Motif" required hint="5 caractères minimum.">
              <Textarea
                id="reassign-reason"
                value={transfer.reason}
                onChange={(event) => setTransfer({ ...transfer, reason: event.target.value })}
              />
            </Field>

            {reassign.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {reassign.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setReassignOpen(false)}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={
                  reassign.isPending ||
                  transfer.reason.trim().length < 5 ||
                  !transfer.fromPartnerId ||
                  !transfer.toPartnerId
                }
              >
                {reassign.isPending ? 'Réaffectation…' : 'Réaffecter'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
