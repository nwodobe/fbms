import { zodResolver } from '@hookform/resolvers/zod'
import { History, Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
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
import { formatMoney, formatWeight } from '@/domain/money'
import { PRICE_TYPE_LABELS, type PriceType } from '@/domain/prices'
import { contractSchema, type ContractInput } from '@/domain/schemas'
import { useSession } from '@/lib/auth/session'
import { usePartnerCompanies } from '@/features/partners/api'
import {
  useCampaigns,
  useContracts,
  useCreateContract,
  useNegotiatedPrices,
  useProducts,
  useRevisePrice,
  useSetContractStatus,
  type Contract,
} from './api'

const COVERAGE_LABELS: Record<Contract['coverage_basis'], string> = {
  purchase_validated: 'Achat validé',
  reception_accepted: 'Réception acceptée',
  payment_received: 'Paiement reçu',
}

/** Écran B03 — contrats et prix négociés. */
export function ContractsPage() {
  const { tenantId, role } = useSession()
  const { data: contracts, isLoading } = useContracts()
  const { data: partners } = usePartnerCompanies()
  const { data: campaigns } = useCampaigns()
  const { data: products } = useProducts()
  const createContract = useCreateContract(tenantId)
  const setStatus = useSetContractStatus()

  const [isFormOpen, setFormOpen] = useState(false)
  const [priceContract, setPriceContract] = useState<Contract | null>(null)

  const canManage = role === 'proprietaire' || role === 'gestionnaire'
  const partnerName = (id: string) => partners?.find((p) => p.id === id)?.name ?? '—'

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContractInput>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      partnerCompanyId: '',
      campaignId: '',
      productId: '',
      reference: '',
      startDate: '',
      endDate: '',
      coverageBasis: 'reception_accepted',
      valuationPriceBasis: 'net_reconnu',
    },
  })

  async function onSubmit(values: ContractInput) {
    await createContract.mutateAsync(values)
    reset()
    setFormOpen(false)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contrats et prix négociés</h1>
          <p className="text-muted-foreground">
            Les conditions applicables à chaque période. Un prix n’est jamais écrasé : toute révision
            crée une version datée.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setFormOpen(true)}>
            <Plus size={16} />
            Nouveau contrat
          </Button>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Contrats</CardTitle>
          <CardDescription>
            Un contrat ne peut pas être activé sans prix négocié : aucune opération ne pourrait être
            valorisée.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : !contracts || contracts.length === 0 ? (
            <p className="text-muted-foreground">Aucun contrat enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Société</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead>Volume cible</TableHead>
                  <TableHead>Couverture</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">{contract.reference}</TableCell>
                    <TableCell>{partnerName(contract.partner_company_id)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {contract.start_date} → {contract.end_date}
                    </TableCell>
                    <TableCell>{formatWeight(contract.target_volume_kg)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {COVERAGE_LABELS[contract.coverage_basis]}
                    </TableCell>
                    <TableCell>
                      <Badge variant={contract.status === 'actif' ? 'ok' : 'neutral'}>{contract.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button variant="link" size="sm" onClick={() => setPriceContract(contract)}>
                        <History size={14} />
                        Prix
                      </Button>
                      {canManage && contract.status === 'brouillon' && (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => setStatus.mutate({ id: contract.id, status: 'actif' })}
                        >
                          Activer
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {setStatus.error && (
            <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {setStatus.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Dialog open={isFormOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau contrat</DialogTitle>
            <DialogDescription>
              Le contrat est créé en brouillon. Ajoutez-lui un prix négocié avant de l’activer.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field id="reference" label="Référence" required error={errors.reference?.message}>
              <Input id="reference" {...register('reference')} aria-invalid={Boolean(errors.reference)} />
            </Field>

            <Field id="partnerCompanyId" label="Société partenaire" required error={errors.partnerCompanyId?.message}>
              <select
                id="partnerCompanyId"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                {...register('partnerCompanyId')}
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
              <Field id="campaignId" label="Campagne" required error={errors.campaignId?.message}>
                <select
                  id="campaignId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  {...register('campaignId')}
                >
                  <option value="">Sélectionner…</option>
                  {(campaigns ?? []).map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="productId" label="Produit" required error={errors.productId?.message}>
                <select
                  id="productId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  {...register('productId')}
                >
                  <option value="">Sélectionner…</option>
                  {(products ?? []).map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="startDate" label="Début" required error={errors.startDate?.message}>
                <Input id="startDate" type="date" {...register('startDate')} />
              </Field>
              <Field id="endDate" label="Fin" required error={errors.endDate?.message}>
                <Input id="endDate" type="date" {...register('endDate')} aria-invalid={Boolean(errors.endDate)} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="korMin"
                label="KOR minimum"
                error={errors.korMin?.message}
              >
                <Input id="korMin" type="number" step="0.01" {...register('korMin', { valueAsNumber: true })} />
              </Field>
              <Field id="humidityMax" label="Humidité maximale (%)" error={errors.humidityMax?.message}>
                <Input
                  id="humidityMax"
                  type="number"
                  step="0.01"
                  {...register('humidityMax', { valueAsNumber: true })}
                />
              </Field>
            </div>

            <Field
              id="weightTolerancePct"
              label="Tolérance d’écart de poids (%)"
              hint="Laisser vide pour utiliser la valeur de la société, puis celle de l’entreprise."
              error={errors.weightTolerancePct?.message}
            >
              <Input
                id="weightTolerancePct"
                type="number"
                step="0.01"
                {...register('weightTolerancePct', { valueAsNumber: true })}
              />
            </Field>

            <Field
              id="coverageBasis"
              label="Fait générateur de la couverture d’une avance"
              hint="Arbitrage métier D1 — modifiable contrat par contrat."
              error={errors.coverageBasis?.message}
            >
              <select
                id="coverageBasis"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                {...register('coverageBasis')}
              >
                <option value="reception_accepted">Réception acceptée (recommandé)</option>
                <option value="purchase_validated">Achat validé</option>
                <option value="payment_received">Paiement reçu</option>
              </select>
            </Field>

            {createContract.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createContract.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createContract.isPending}>
                {createContract.isPending ? 'Création…' : 'Créer le contrat'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {priceContract && (
        <PriceHistoryDialog
          contract={priceContract}
          canManage={canManage}
          onClose={() => setPriceContract(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Historique et révision des prix
// ---------------------------------------------------------------------------

const PRICE_TYPES: PriceType[] = ['negocie', 'plafond_achat', 'producteur', 'net_reconnu', 'valorisation_ecart']

function PriceHistoryDialog({
  contract,
  canManage,
  onClose,
}: {
  contract: Contract
  canManage: boolean
  onClose: () => void
}) {
  const { data: prices, isLoading } = useNegotiatedPrices(contract.id)
  const revise = useRevisePrice()

  const [priceType, setPriceType] = useState<PriceType>('negocie')
  const [price, setPrice] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [justification, setJustification] = useState('')

  const today = new Date().toISOString().slice(0, 10)

  async function submitRevision(event: React.FormEvent) {
    event.preventDefault()
    await revise.mutateAsync({
      contractId: contract.id,
      priceType,
      price: Number(price),
      validFrom,
      justification,
    })
    setPrice('')
    setJustification('')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prix — {contract.reference}</DialogTitle>
          <DialogDescription>
            Chaque révision clôt la version en cours la veille de la nouvelle date d’effet. Les
            opérations déjà valorisées conservent leur prix d’origine.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p role="status" className="text-muted-foreground">
            Chargement de l’historique…
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Prix</TableHead>
                <TableHead>Validité</TableHead>
                <TableHead>Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(prices ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Aucun prix enregistré. Ce contrat ne peut pas être activé tant qu’il n’a pas de prix
                    négocié.
                  </TableCell>
                </TableRow>
              ) : (
                (prices ?? []).map((row) => {
                  const isCurrent = row.valid_to === null || row.valid_to >= today
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground">{PRICE_TYPE_LABELS[row.price_type]}</TableCell>
                      <TableCell className="font-medium">{formatMoney(row.price)}/kg</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.valid_from} → {row.valid_to ?? 'en cours'}{' '}
                        {!isCurrent && <Badge variant="neutral">expiré</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">v{row.version}</TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        )}

        {canManage && (
          <form onSubmit={submitRevision} className="mt-6 space-y-4 border-t pt-4">
            <p className="text-sm font-medium">Nouveau prix / révision</p>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="priceType" label="Type de prix" required>
                <select
                  id="priceType"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={priceType}
                  onChange={(event) => setPriceType(event.target.value as PriceType)}
                >
                  {PRICE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {PRICE_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="price" label="Prix (FCFA/kg)" required>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  required
                />
              </Field>

              <Field id="validFrom" label="Date d’effet" required>
                <Input
                  id="validFrom"
                  type="date"
                  value={validFrom}
                  onChange={(event) => setValidFrom(event.target.value)}
                  required
                />
              </Field>
            </div>

            <Field
              id="justification"
              label="Justification"
              required
              hint="10 caractères minimum — un changement de prix sans motif est indéfendable en audit."
            >
              <Textarea
                id="justification"
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                required
              />
            </Field>

            {revise.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {revise.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Fermer
              </Button>
              <Button type="submit" disabled={revise.isPending}>
                {revise.isPending ? 'Enregistrement…' : 'Enregistrer la version'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
