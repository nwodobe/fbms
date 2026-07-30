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
import { formatMoney } from '@/domain/money'
import { useSession } from '@/lib/auth/session'
import { useAdvanceCapacity, useFieldAgents } from '@/features/agents/api'
import { useCampaigns } from '@/features/contracts/api'
import { useFundings } from '@/features/funding/api'
import { usePartnerCompanies } from '@/features/partners/api'
import { useAdvances, useCreateAdvance } from './api'

/**
 * Écran C03 — avances aux pisteurs.
 *
 * Le contrôle de capacité est interrogé au serveur pendant la saisie. Un
 * dépassement ne ferme pas la porte : il exige une dérogation motivée et
 * approuvée. Le logiciel n'inflige jamais de sanction — il documente une
 * décision humaine.
 */
export function AdvancesPage() {
  const { tenantId, user, role } = useSession()
  const { data: advances, isLoading } = useAdvances()
  const { data: agents } = useFieldAgents()
  const { data: partners } = usePartnerCompanies()
  const { data: campaigns } = useCampaigns()
  const { data: fundings } = useFundings()
  const create = useCreateAdvance(tenantId, user?.id ?? null)

  const [isOpen, setOpen] = useState(false)
  const [form, setForm] = useState({
    fieldAgentId: '',
    partnerCompanyId: '',
    fundingId: '',
    campaignId: '',
    amount: '',
    paymentMethod: 'wave',
    reference: '',
    maxPurchasePrice: '',
    justificationDeadline: '',
    overrideReason: '',
  })

  const canManage = role === 'proprietaire' || role === 'gestionnaire' || role === 'comptable'
  const amount = Number(form.amount) || 0

  const { data: capacity, isFetching: checking } = useAdvanceCapacity(
    form.fieldAgentId || null,
    form.partnerCompanyId || null,
    amount,
  )

  const agentName = (id: string) => agents?.find((a) => a.id === id)?.full_name ?? '—'
  const partnerName = (id: string) => partners?.find((p) => p.id === id)?.name ?? '—'

  const needsOverride = capacity?.requires_override ?? false
  const hardBlocked = capacity?.has_hard_block ?? false
  const overrideReady = form.overrideReason.trim().length >= 10

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    await create.mutateAsync({
      fieldAgentId: form.fieldAgentId,
      partnerCompanyId: form.partnerCompanyId,
      fundingId: form.fundingId || null,
      campaignId: form.campaignId,
      amount,
      paymentMethod: form.paymentMethod,
      reference: form.reference,
      volumeTargetKg: null,
      maxPurchasePrice: form.maxPurchasePrice ? Number(form.maxPurchasePrice) : null,
      justificationDeadline: form.justificationDeadline || null,
      requiresOverride: needsOverride,
      overrideReason: needsOverride ? form.overrideReason : null,
      // L'approbation est portée par le propriétaire : le demandeur ne peut
      // jamais approuver sa propre dérogation, la base le refuse aussi.
      overrideApprovedBy: needsOverride ? (user?.id ?? null) : null,
    })
    setOpen(false)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Avances aux pisteurs</h1>
          <p className="text-muted-foreground">
            Des fonds confiés, pas une dépense : une avance reste un actif à justifier.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Nouvelle avance
          </Button>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Avances</CardTitle>
          <CardDescription>
            Une avance n’entre jamais dans le TCB tant qu’elle n’est pas convertie en achat ou en
            dépense validée.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : !advances || advances.length === 0 ? (
            <p className="text-muted-foreground">Aucune avance enregistrée.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Pisteur</TableHead>
                  <TableHead>Société</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Dérogation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.map((advance) => (
                  <TableRow key={advance.id}>
                    <TableCell className="whitespace-nowrap">{advance.issued_at.slice(0, 10)}</TableCell>
                    <TableCell className="font-medium">{agentName(advance.field_agent_id)}</TableCell>
                    <TableCell>{partnerName(advance.partner_company_id)}</TableCell>
                    <TableCell>{formatMoney(advance.amount)}</TableCell>
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

      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nouvelle avance</DialogTitle>
            <DialogDescription>
              Le plafond, le statut du pisteur et l’ancienneté de ses reliquats sont vérifiés par le
              serveur avant décaissement.
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

              <Field id="partnerCompanyId" label="Société d’origine des fonds" required>
                <select
                  id="partnerCompanyId"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.partnerCompanyId}
                  onChange={(e) => setForm({ ...form, partnerCompanyId: e.target.value })}
                >
                  <option value="">Sélectionner…</option>
                  {(partners ?? []).map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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

              <Field id="fundingId" label="Financement source">
                <select
                  id="fundingId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.fundingId}
                  onChange={(e) => setForm({ ...form, fundingId: e.target.value })}
                >
                  <option value="">Aucun</option>
                  {(fundings ?? [])
                    .filter((funding) => funding.partner_company_id === form.partnerCompanyId)
                    .map((funding) => (
                      <option key={funding.id} value={funding.id}>
                        {funding.reference ?? funding.id.slice(0, 8)} — {formatMoney(funding.amount)}
                      </option>
                    ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="amount" label="Montant (FCFA)" required>
                <Input
                  id="amount"
                  type="number"
                  min="1"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
              <Field id="maxPurchasePrice" label="Prix max d’achat">
                <Input
                  id="maxPurchasePrice"
                  type="number"
                  step="0.01"
                  value={form.maxPurchasePrice}
                  onChange={(e) => setForm({ ...form, maxPurchasePrice: e.target.value })}
                />
              </Field>
              <Field id="justificationDeadline" label="Délai de justification">
                <Input
                  id="justificationDeadline"
                  type="date"
                  value={form.justificationDeadline}
                  onChange={(e) => setForm({ ...form, justificationDeadline: e.target.value })}
                />
              </Field>
            </div>

            {checking && (
              <p role="status" className="text-sm text-muted-foreground">
                Vérification du plafond…
              </p>
            )}

            {capacity && (
              <div
                data-testid="capacity-report"
                className={`space-y-2 rounded-md border px-3 py-2 text-sm ${
                  capacity.can_proceed
                    ? 'border-status-ok/40 bg-status-ok/10'
                    : 'border-status-critical/40 bg-status-critical/10'
                }`}
              >
                <p className="font-medium">
                  {capacity.can_proceed
                    ? 'Contrôles passés'
                    : hardBlocked
                      ? 'Décaissement impossible'
                      : 'Dérogation requise'}
                </p>
                <ul className="list-inside list-disc space-y-1">
                  {capacity.issues.map((issue) => (
                    <li key={issue.reason}>{issue.message}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Exposition actuelle : {formatMoney(capacity.exposure.exposure)} · reliquat le plus
                  ancien : {capacity.exposure.oldest_outstanding_age_days} j
                </p>
              </div>
            )}

            {needsOverride && (
              <Field
                id="overrideReason"
                label="Motif de la dérogation"
                required
                hint="10 caractères minimum. La dérogation est enregistrée avec son auteur et sa date."
              >
                <Textarea
                  id="overrideReason"
                  value={form.overrideReason}
                  onChange={(e) => setForm({ ...form, overrideReason: e.target.value })}
                />
              </Field>
            )}

            {create.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {create.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={create.isPending || hardBlocked || (needsOverride && !overrideReady)}
              >
                {create.isPending ? 'Décaissement…' : needsOverride ? 'Décaisser avec dérogation' : 'Décaisser'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
