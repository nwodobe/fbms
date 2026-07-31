import { CloudOff, Plus, RefreshCw } from 'lucide-react'
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
import { ProofUpload } from '@/components/shared/ProofUpload'
import { describeAttachmentState } from '@/domain/attachments'
import { buildPurchaseDocument } from '@/domain/documents'
import { downloadDocument } from '@/lib/export/documents'
import { useDocumentBranding } from '@/lib/export/useDocumentBranding'
import { formatMoney, formatWeight, multiply } from '@/domain/money'
import { useSession } from '@/lib/auth/session'
import { deviceId, useOfflineQueue } from '@/lib/offline/useOfflineQueue'
import { useFieldAgents } from '@/features/agents/api'
import { useCampaigns } from '@/features/contracts/api'
import { usePartnerCompanies } from '@/features/partners/api'
import { useDuplicateFlags, usePurchases, useRecordPurchase, type Purchase } from './api'

/**
 * Écrans D01 et D02 — achats terrain.
 *
 * La saisie fonctionne à l'identique en ligne et hors ligne : hors réseau,
 * l'achat part dans la file locale et rien n'est perdu. L'état de la file est
 * affiché en permanence, car un pisteur doit savoir si ses saisies sont
 * parties sans avoir à le demander.
 */
export function PurchasesPage() {
  const { tenantId, user, role } = useSession()
  const { data: purchases, isLoading } = usePurchases()
  const { data: flags } = useDuplicateFlags()
  const { data: agents } = useFieldAgents()
  const { data: partners } = usePartnerCompanies()
  const { data: campaigns } = useCampaigns()
  const queue = useOfflineQueue()

  const record = useRecordPurchase({
    tenantId,
    userId: user?.id ?? null,
    deviceId: deviceId(),
    isOnline: queue.isOnline,
  })

  const [isOpen, setOpen] = useState(false)
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null)
  const [form, setForm] = useState({
    // L'identifiant est tiré à l'ouverture du formulaire, pas à l'envoi : la
    // preuve d'achat doit pouvoir être photographiée avant que la ligne existe,
    // et elle a besoin de savoir à quelle ligne elle se rattachera.
    draftId: crypto.randomUUID(),
    proofPath: null as string | null,
    fieldAgentId: '',
    partnerCompanyId: '',
    campaignId: '',
    supplierName: '',
    village: '',
    purchasedAt: new Date().toISOString().slice(0, 16),
    netWeightKg: '',
    pricePerKg: '',
    bagCount: '',
    paymentMethod: 'cash',
  })

  const documentBranding = useDocumentBranding()
  const canRecord = role !== 'auditeur'

  /** Reçu remis au vendeur. Le calcul y est écrit en toutes lettres. */
  function printReceipt(purchase: Purchase) {
    void downloadDocument(
      buildPurchaseDocument(
        {
          id: purchase.id,
          supplierName: purchase.supplier_name,
          village: purchase.village,
          agentName: agentName(purchase.field_agent_id),
          purchasedAt: purchase.purchased_at,
          netWeightKg: Number(purchase.net_weight_kg),
          pricePerKg: Number(purchase.price_per_kg),
          amount: Number(purchase.amount),
          currency: 'FCFA',
          bagCount: purchase.bag_count,
          paymentMethod: purchase.payment_method,
        },
        new Date().toISOString(),
      ),
      documentBranding,
    )
  }
  const agentName = (id: string) => agents?.find((a) => a.id === id)?.full_name ?? '—'
  const flaggedIds = new Set((flags ?? []).map((flag) => flag.purchase_id))

  const amount = multiply(Number(form.netWeightKg) || 0, Number(form.pricePerKg) || 0)

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    setQueuedNotice(null)

    const result = await record.mutateAsync({
      // L'identifiant est généré sur l'appareil : c'est lui qui rend la
      // synchronisation idempotente.
      id: form.draftId,
      proofPath: form.proofPath,
      fieldAgentId: form.fieldAgentId,
      partnerCompanyId: form.partnerCompanyId || null,
      campaignId: form.campaignId,
      contractId: null,
      advanceId: null,
      supplierId: null,
      supplierName: form.supplierName || null,
      village: form.village || null,
      purchasedAt: new Date(form.purchasedAt).toISOString(),
      netWeightKg: Number(form.netWeightKg),
      pricePerKg: Number(form.pricePerKg),
      bagCount: form.bagCount ? Number(form.bagCount) : null,
      paymentMethod: form.paymentMethod,
      paymentReference: null,
      isOwnAccount: !form.partnerCompanyId,
      gpsLat: null,
      gpsLng: null,
    })

    if (result.queued) {
      setQueuedNotice(
        `Achat enregistré sur l'appareil (${result.reason}). Il sera envoyé automatiquement au retour du réseau.`,
      )
    }
    setOpen(false)
    // Un nouvel identifiant de brouillon : le suivant est un autre achat, et sa
    // preuve ne doit pas se rattacher à celui qui vient d'être enregistré.
    setForm({ ...form, draftId: crypto.randomUUID(), proofPath: null })
    await queue.refresh()
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Achats terrain</h1>
          <p className="text-muted-foreground">
            Chaque achat transforme une avance en stock traçable.
          </p>
        </div>
        {canRecord && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Nouvel achat
          </Button>
        )}
      </header>

      {/* État de la file : visible en permanence, jamais rassurant à tort. */}
      <Card
        data-testid="sync-status"
        className={queue.pending + queue.failed > 0 ? 'border-status-warn/40 bg-status-warn/5' : undefined}
      >
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              {queue.isOnline ? 'Connecté' : <><CloudOff size={16} /> Hors connexion</>}
            </CardTitle>
            <CardDescription>
              {queue.pending + queue.failed === 0
                ? 'Toutes vos saisies sont synchronisées.'
                : `${queue.pending + queue.failed} opération(s) en attente d’envoi. Aucune n’est perdue : elles partiront au retour du réseau.`}
            </CardDescription>
            {queue.attachments.pending + queue.attachments.sending + queue.attachments.failed > 0 && (
              <p data-testid="attachment-status" className="text-sm text-muted-foreground">
                {describeAttachmentState(queue.attachments)}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void queue.sync()}
            disabled={!queue.isOnline || queue.isSyncing}
          >
            <RefreshCw size={14} className={queue.isSyncing ? 'animate-spin' : undefined} />
            Synchroniser
          </Button>
        </CardHeader>

        {queue.conflicts.length > 0 && (
          <CardContent>
            <p className="mb-2 text-sm font-medium text-status-critical">
              {queue.conflicts.length} conflit(s) à examiner
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {queue.conflicts.map((operation) => (
                <li key={operation.id}>{operation.conflict?.message}</li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      {queuedNotice && (
        <p role="status" className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
          {queuedNotice}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Achats</CardTitle>
          <CardDescription>
            Les doublons probables sont signalés, jamais bloqués : un humain tranche.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : !purchases || purchases.length === 0 ? (
            <p className="text-muted-foreground">Aucun achat enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Pisteur</TableHead>
                  <TableHead>Vendeur</TableHead>
                  <TableHead>Poids</TableHead>
                  <TableHead>Prix/kg</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Synchro</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((purchase) => (
                  <TableRow key={purchase.id}>
                    <TableCell className="whitespace-nowrap">
                      {purchase.purchased_at.slice(0, 10)}
                      {flaggedIds.has(purchase.id) && (
                        <Badge variant="warn" className="ml-2">
                          doublon probable
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{agentName(purchase.field_agent_id)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {purchase.supplier_name ?? '—'}
                    </TableCell>
                    <TableCell>{formatWeight(purchase.net_weight_kg)}</TableCell>
                    <TableCell>{formatMoney(purchase.price_per_kg)}</TableCell>
                    <TableCell className="font-medium">{formatMoney(purchase.amount)}</TableCell>
                    <TableCell>
                      <Badge variant={purchase.sync_status === 'synced' ? 'ok' : 'warn'}>
                        {purchase.sync_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => printReceipt(purchase)}>
                        Reçu
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvel achat</DialogTitle>
            <DialogDescription>
              La saisie fonctionne sans réseau : l’achat est conservé sur l’appareil et envoyé
              automatiquement ensuite.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="fieldAgentId" label="Pisteur" required>
                <select
                  id="fieldAgentId"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.fieldAgentId}
                  onChange={(e) => setForm({ ...form, fieldAgentId: e.target.value })}
                >
                  <option value="">Sélectionner…</option>
                  {(agents ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.full_name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="partnerCompanyId" label="Société partenaire">
                <select
                  id="partnerCompanyId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.partnerCompanyId}
                  onChange={(e) => setForm({ ...form, partnerCompanyId: e.target.value })}
                >
                  <option value="">Achat pour compte propre</option>
                  {(partners ?? []).map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field id="campaignId" label="Campagne" required>
              <select
                id="campaignId"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.campaignId}
                onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
              >
                <option value="">Sélectionner…</option>
                {(campaigns ?? []).map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="supplierName" label="Vendeur">
                <Input
                  id="supplierName"
                  value={form.supplierName}
                  onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                />
              </Field>
              <Field id="village" label="Village">
                <Input
                  id="village"
                  value={form.village}
                  onChange={(e) => setForm({ ...form, village: e.target.value })}
                />
              </Field>
            </div>

            <Field id="purchasedAt" label="Date et heure réelles" required>
              <Input
                id="purchasedAt"
                type="datetime-local"
                required
                value={form.purchasedAt}
                onChange={(e) => setForm({ ...form, purchasedAt: e.target.value })}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="netWeightKg" label="Poids net (kg)" required>
                <Input
                  id="netWeightKg"
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  value={form.netWeightKg}
                  onChange={(e) => setForm({ ...form, netWeightKg: e.target.value })}
                />
              </Field>
              <Field id="pricePerKg" label="Prix (FCFA/kg)" required>
                <Input
                  id="pricePerKg"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={form.pricePerKg}
                  onChange={(e) => setForm({ ...form, pricePerKg: e.target.value })}
                />
              </Field>
              <Field id="bagCount" label="Nombre de sacs">
                <Input
                  id="bagCount"
                  type="number"
                  min="0"
                  value={form.bagCount}
                  onChange={(e) => setForm({ ...form, bagCount: e.target.value })}
                />
              </Field>
            </div>

            {/* Le montant est CALCULÉ, jamais saisi : c'est ce qui garantit
                qu'il ne diverge pas du poids qui alimentera le stock. */}
            <p data-testid="computed-amount" className="rounded-md bg-muted px-3 py-2 text-sm">
              Montant : <strong>{formatMoney(amount)}</strong> — calculé à partir du poids et du prix,
              non modifiable.
            </p>

            <ProofUpload
              kind="preuve_achat"
              binding={{ table: 'purchases', column: 'proof_path', rowId: form.draftId }}
              value={form.proofPath}
              onChange={(path) => setForm({ ...form, proofPath: path })}
              // Une photo mise en attente change l'état de la file : l'annoncer
              // tout de suite évite que le pisteur croie l'avoir déjà envoyée.
              onQueued={() => void queue.refresh()}
            />

            {!queue.isOnline && (
              <p className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
                Vous êtes hors connexion. L’achat sera conservé sur cet appareil puis envoyé
                automatiquement.
              </p>
            )}

            {record.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {record.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={record.isPending}>
                {record.isPending ? 'Enregistrement…' : 'Enregistrer l’achat'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
