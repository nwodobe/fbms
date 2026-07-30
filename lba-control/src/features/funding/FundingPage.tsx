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
import { theoreticalVolumeKg } from '@/domain/advances'
import { formatMoney, formatWeight } from '@/domain/money'
import { useSession } from '@/lib/auth/session'
import { useCampaigns, useContracts } from '@/features/contracts/api'
import { usePartnerCompanies } from '@/features/partners/api'
import { useCreateFunding, useFundings } from './api'

/**
 * Écran E05 — financements reçus.
 *
 * Deux points que l'écran doit rendre évidents :
 *  · un financement reçu **n'est pas une dépense** ;
 *  · le volume théorique est **indicatif** — il dépend du prix de référence
 *    choisi, et ne prouve aucune livraison.
 */
export function FundingPage() {
  const { tenantId, role } = useSession()
  const { data: fundings, isLoading, error } = useFundings()
  const { data: partners } = usePartnerCompanies()
  const { data: contracts } = useContracts()
  const { data: campaigns } = useCampaigns()
  const create = useCreateFunding(tenantId)

  const [isOpen, setOpen] = useState(false)
  const [form, setForm] = useState({
    partnerCompanyId: '',
    contractId: '',
    campaignId: '',
    amount: '',
    receivedAt: new Date().toISOString().slice(0, 10),
    reference: '',
    paymentMethod: 'bank_transfer',
    referencePrice: '',
    coverageDeadline: '',
  })

  const canManage = role === 'proprietaire' || role === 'gestionnaire' || role === 'comptable'
  const partnerName = (id: string) => partners?.find((p) => p.id === id)?.name ?? '—'

  const previewVolume = theoreticalVolumeKg(Number(form.amount) || 0, Number(form.referencePrice) || null)

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    await create.mutateAsync({
      partnerCompanyId: form.partnerCompanyId,
      contractId: form.contractId || null,
      campaignId: form.campaignId,
      amount: Number(form.amount),
      receivedAt: form.receivedAt,
      reference: form.reference,
      paymentMethod: form.paymentMethod,
      referencePrice: form.referencePrice ? Number(form.referencePrice) : null,
      coverageDeadline: form.coverageDeadline || null,
    })
    setOpen(false)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Financements reçus</h1>
          <p className="text-muted-foreground">
            L’argent reçu de chaque société partenaire, séparé société par société.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Enregistrer un financement
          </Button>
        )}
      </header>

      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardHeader>
          <CardTitle>Un financement reçu n’est pas une dépense</CardTitle>
          <CardDescription>
            Il constitue une ressource à justifier. Une livraison à une société ne couvre jamais
            automatiquement le financement d’une autre : toute compensation entre sociétés exige une
            réaffectation approuvée.
          </CardDescription>
        </CardHeader>
      </Card>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Liste</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : !fundings || fundings.length === 0 ? (
            <p className="text-muted-foreground">Aucun financement enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Société</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Prix de référence</TableHead>
                  <TableHead>Volume théorique</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fundings.map((funding) => (
                  <TableRow key={funding.id}>
                    <TableCell className="whitespace-nowrap">{funding.received_at}</TableCell>
                    <TableCell className="font-medium">{partnerName(funding.partner_company_id)}</TableCell>
                    <TableCell>{formatMoney(funding.amount)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {funding.reference_price ? `${funding.reference_price} FCFA/kg` : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground" title="Indicatif : ne prouve aucune livraison">
                      {formatWeight(funding.theoretical_volume_kg)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{funding.coverage_deadline ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="neutral">{funding.status}</Badge>
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
            <DialogTitle>Enregistrer un financement</DialogTitle>
            <DialogDescription>
              La société d’origine est obligatoire : c’est elle qui rattache l’argent, les avances et
              les livraisons qui le couvriront.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <Field id="partnerCompanyId" label="Société partenaire" required>
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

              <Field id="contractId" label="Contrat">
                <select
                  id="contractId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.contractId}
                  onChange={(e) => setForm({ ...form, contractId: e.target.value })}
                >
                  <option value="">Aucun</option>
                  {(contracts ?? [])
                    .filter((contract) => contract.partner_company_id === form.partnerCompanyId)
                    .map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.reference}
                      </option>
                    ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="amount" label="Montant reçu (FCFA)" required>
                <Input
                  id="amount"
                  type="number"
                  min="1"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
              <Field id="receivedAt" label="Date de réception" required>
                <Input
                  id="receivedAt"
                  type="date"
                  required
                  value={form.receivedAt}
                  onChange={(e) => setForm({ ...form, receivedAt: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="referencePrice"
                label="Prix de référence (FCFA/kg)"
                hint="Sert uniquement au volume théorique"
              >
                <Input
                  id="referencePrice"
                  type="number"
                  step="0.01"
                  value={form.referencePrice}
                  onChange={(e) => setForm({ ...form, referencePrice: e.target.value })}
                />
              </Field>
              <Field id="coverageDeadline" label="Date limite de couverture">
                <Input
                  id="coverageDeadline"
                  type="date"
                  value={form.coverageDeadline}
                  onChange={(e) => setForm({ ...form, coverageDeadline: e.target.value })}
                />
              </Field>
            </div>

            <Field id="reference" label="Référence (banque, Wave…)">
              <Input
                id="reference"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </Field>

            {previewVolume !== null && (
              <p data-testid="theoretical-volume" className="rounded-md bg-muted px-3 py-2 text-sm">
                Volume théorique financé : <strong>{formatWeight(previewVolume)}</strong>. Cette valeur
                est indicative : elle dépend du prix de référence et ne remplace jamais le volume
                réellement accepté.
              </p>
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
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
