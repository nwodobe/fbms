import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ProofUpload } from '@/components/shared/ProofUpload'
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
import { ALLOCATION_KEY_LABELS, TCB_ELIGIBLE_EXPENSE_STATUSES } from '@/domain/tcb'
import { useSession } from '@/lib/auth/session'
import { useCampaigns } from '@/features/contracts/api'
import { usePartnerCompanies } from '@/features/partners/api'
import { useFieldAgents } from '@/features/agents/api'
import {
  useAllocateExpense,
  useCreateExpense,
  useDecideExpense,
  useExpenseAllocations,
  useExpenseCategories,
  useExpenseDuplicates,
  useExpenses,
  useReviewDuplicate,
} from './api'
import type { AllocationKeyEnum, ExpenseRow } from '@/types/database'

const STATUS_VARIANT: Record<string, 'ok' | 'warn' | 'critical' | 'neutral'> = {
  brouillon: 'neutral',
  soumise: 'warn',
  validee: 'ok',
  payee: 'ok',
  partiellement_payee: 'ok',
  rejetee: 'critical',
  annulee: 'critical',
}

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

/**
 * Écrans F01 et F02 — saisie, validation et répartition des dépenses.
 *
 * Trois choses que cet écran refuse de faire :
 *
 *  · proposer la catégorie « achat produit » — la valeur d'achat vient des
 *    achats terrain, la saisir ici la compterait deux fois dans le TCB ;
 *  · masquer un doublon probable — il est signalé, jamais bloqué : deux
 *    dépenses identiques le même jour peuvent être parfaitement réelles ;
 *  · répartir une charge indirecte sur une clé nulle — la charge disparaîtrait
 *    du TCB sans que personne ne s'en aperçoive.
 */
export function ExpensesPage() {
  const { tenantId, user, role } = useSession()
  const { data: expenses, isLoading } = useExpenses()
  const { data: categories } = useExpenseCategories()
  const { data: duplicates } = useExpenseDuplicates()
  const { data: allocations } = useExpenseAllocations()
  const { data: partners } = usePartnerCompanies()
  const { data: campaigns } = useCampaigns()
  const { data: agents } = useFieldAgents()

  const create = useCreateExpense(tenantId, user?.id ?? null)
  const decide = useDecideExpense(user?.id ?? null)
  const review = useReviewDuplicate(user?.id ?? null)
  const allocate = useAllocateExpense()

  const [isOpen, setOpen] = useState(false)
  const [target, setTarget] = useState<ExpenseRow | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [allocationTarget, setAllocationTarget] = useState<ExpenseRow | null>(null)
  const [allocationKey, setAllocationKey] = useState<AllocationKeyEnum>('poids_accepte')

  const [form, setForm] = useState({
    categoryId: '',
    partnerCompanyId: '',
    campaignId: '',
    fieldAgentId: '',
    expenseDate: new Date().toISOString().slice(0, 10),
    amount: '',
    beneficiary: '',
    paymentMethod: 'cash',
    reference: '',
    nature: 'direct' as 'direct' | 'indirect',
    allocationKey: 'poids_accepte' as AllocationKeyEnum,
    proofPath: null as string | null,
    // L'identifiant est tiré dès l'ouverture du formulaire : le justificatif
    // doit pouvoir être déposé avant que la ligne n'existe.
    draftId: crypto.randomUUID(),
  })

  const canManage = role === 'proprietaire' || role === 'gestionnaire' || role === 'comptable'
  const canValidate = role === 'proprietaire' || role === 'gestionnaire'

  // Les catégories réservées au système n'apparaissent jamais en saisie.
  const selectable = (categories ?? []).filter(
    (category) => category.is_active && !category.is_system_reserved,
  )
  const categoryLabel = (id: string) =>
    categories?.find((category) => category.id === id)?.label ?? '—'
  const openDuplicates = (duplicates ?? []).filter((flag) => flag.status === 'a_verifier')

  const countedInTcb = (expenses ?? []).filter((expense) =>
    TCB_ELIGIBLE_EXPENSE_STATUSES.includes(expense.status as never),
  )
  const tcbEligibleTotal = countedInTcb.reduce((total, expense) => total + Number(expense.amount), 0)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await create.mutateAsync({
      categoryId: form.categoryId,
      partnerCompanyId: form.partnerCompanyId || null,
      campaignId: form.campaignId,
      fieldAgentId: form.fieldAgentId || null,
      expenseDate: form.expenseDate,
      amount: Number(form.amount) || 0,
      beneficiary: form.beneficiary,
      paymentMethod: form.paymentMethod,
      reference: form.reference,
      nature: form.nature,
      allocationKey: form.allocationKey,
      proofPath: form.proofPath,
      id: form.draftId,
    })
    setOpen(false)
    setForm({ ...form, amount: '', beneficiary: '', reference: '', proofPath: null, draftId: crypto.randomUUID() })
  }

  async function runAllocation() {
    if (!allocationTarget) return
    await allocate.mutateAsync({
      expenseId: allocationTarget.id,
      key: allocationKey,
      targetType: 'partner',
      targetIds: (partners ?? []).map((partner) => partner.id),
    })
    setAllocationTarget(null)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dépenses</h1>
          <p className="text-muted-foreground">
            Enregistrer les coûts sans doubler les avances ni les achats.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Nouvelle dépense
          </Button>
        )}
      </header>

      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardHeader>
          <CardTitle>Ce qui entre dans le TCB, et ce qui n’y entre pas</CardTitle>
          <CardDescription>
            Une dépense <strong>validée mais non encore payée</strong> compte : l’entreprise est
            engagée. Une dépense rejetée ou annulée ne compte pas. Une <strong>avance</strong> n’est
            pas une dépense : le coût naît de l’achat qu’elle finance, pas de la remise des fonds. La
            catégorie « achat produit » est réservée au système pour cette raison.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            Retenu au TCB à ce jour :{' '}
            <span className="font-semibold">{formatMoney(tcbEligibleTotal)}</span> sur{' '}
            {countedInTcb.length} dépense(s).
          </p>
        </CardContent>
      </Card>

      {openDuplicates.length > 0 && (
        <Card className="border-status-warn/40">
          <CardHeader>
            <CardTitle>Doublons probables à vérifier</CardTitle>
            <CardDescription>
              Un signalement, pas un refus : deux dépenses identiques le même jour peuvent être
              réelles. Un humain tranche.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Similarité</TableHead>
                  <TableHead>Critères concordants</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openDuplicates.map((flag) => (
                  <TableRow key={flag.id}>
                    <TableCell>
                      <Badge variant={Number(flag.similarity_score) >= 80 ? 'critical' : 'warn'}>
                        {Number(flag.similarity_score)}/100
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {flag.matched_criteria.join(', ')}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => review.mutate({ id: flag.id, status: 'confirme' })}
                      >
                        C’est un doublon
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => review.mutate({ id: flag.id, status: 'ecarte' })}
                      >
                        Dépenses distinctes
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dépenses enregistrées</CardTitle>
          <CardDescription>
            Une dépense validée ne peut plus changer de montant : elle devient un engagement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : (expenses ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucune dépense enregistrée.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Bénéficiaire</TableHead>
                  <TableHead>Nature</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>TCB</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(expenses ?? []).map((expense) => {
                  const counted = TCB_ELIGIBLE_EXPENSE_STATUSES.includes(expense.status as never)
                  const allocated = (allocations ?? []).filter(
                    (line) => line.expense_id === expense.id,
                  )

                  return (
                    <TableRow key={expense.id}>
                      <TableCell className="font-mono text-xs">{expense.expense_date}</TableCell>
                      <TableCell>{categoryLabel(expense.category_id)}</TableCell>
                      <TableCell>{expense.beneficiary}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {expense.nature === 'indirect'
                          ? `indirecte · ${allocated.length} quote(s)-part(s)`
                          : 'directe'}
                      </TableCell>
                      <TableCell>{formatMoney(expense.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[expense.status] ?? 'neutral'}>
                          {expense.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {expense.nature === 'indirect'
                          ? 'par quote-part'
                          : counted
                            ? 'compté'
                            : 'non compté'}
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        {canValidate && expense.status === 'soumise' && (
                          <Button variant="link" size="sm" onClick={() => setTarget(expense)}>
                            Statuer
                          </Button>
                        )}
                        {canManage && expense.nature === 'indirect' && counted && (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => setAllocationTarget(expense)}
                          >
                            Répartir
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Saisie ------------------------------------------------------------ */}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle dépense</DialogTitle>
            <DialogDescription>
              Elle est enregistrée « soumise ». Une autre personne devra la valider.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <Field id="category" label="Catégorie" required>
              <select
                id="category"
                required
                className={SELECT_CLASS}
                value={form.categoryId}
                onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
              >
                <option value="">Sélectionner…</option>
                {selectable.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.family} · {category.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="campaign" label="Campagne" required>
              <select
                id="campaign"
                required
                className={SELECT_CLASS}
                value={form.campaignId}
                onChange={(event) => setForm({ ...form, campaignId: event.target.value })}
              >
                <option value="">Sélectionner…</option>
                {(campaigns ?? []).map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="partner" label="Société (facultatif)">
              <select
                id="partner"
                className={SELECT_CLASS}
                value={form.partnerCompanyId}
                onChange={(event) => setForm({ ...form, partnerCompanyId: event.target.value })}
              >
                <option value="">Aucune</option>
                {(partners ?? []).map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="agent" label="Pisteur concerné (facultatif)">
              <select
                id="agent"
                className={SELECT_CLASS}
                value={form.fieldAgentId}
                onChange={(event) => setForm({ ...form, fieldAgentId: event.target.value })}
              >
                <option value="">Aucun</option>
                {(agents ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.full_name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="expense-date" label="Date" required>
              <Input
                id="expense-date"
                type="date"
                required
                value={form.expenseDate}
                onChange={(event) => setForm({ ...form, expenseDate: event.target.value })}
              />
            </Field>

            <Field id="amount" label="Montant (FCFA)" required>
              <Input
                id="amount"
                type="number"
                min="1"
                required
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
              />
            </Field>

            <Field id="beneficiary" label="Bénéficiaire" required>
              <Input
                id="beneficiary"
                required
                value={form.beneficiary}
                onChange={(event) => setForm({ ...form, beneficiary: event.target.value })}
              />
            </Field>

            <Field id="reference" label="Référence de pièce">
              <Input
                id="reference"
                value={form.reference}
                onChange={(event) => setForm({ ...form, reference: event.target.value })}
              />
            </Field>

            <Field
              id="nature"
              label="Nature"
              hint="Une charge indirecte n’entre au TCB que par sa quote-part répartie."
            >
              <select
                id="nature"
                className={SELECT_CLASS}
                value={form.nature}
                onChange={(event) =>
                  setForm({ ...form, nature: event.target.value as 'direct' | 'indirect' })
                }
              >
                <option value="direct">Directe</option>
                <option value="indirect">Indirecte</option>
              </select>
            </Field>

            {form.nature === 'indirect' && (
              <Field id="allocation-key" label="Clé de répartition" required>
                <select
                  id="allocation-key"
                  className={SELECT_CLASS}
                  value={form.allocationKey}
                  onChange={(event) =>
                    setForm({ ...form, allocationKey: event.target.value as AllocationKeyEnum })
                  }
                >
                  {Object.entries(ALLOCATION_KEY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <ProofUpload
              kind="justificatif_depense"
              binding={{ table: 'expenses', column: 'proof_path', rowId: form.draftId }}
              value={form.proofPath}
              onChange={(path) => setForm({ ...form, proofPath: path })}
            />

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

      {/* Validation -------------------------------------------------------- */}
      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Statuer sur la dépense</DialogTitle>
            <DialogDescription>
              Une dépense validée entre au TCB, payée ou non. Vous ne pouvez pas valider une dépense
              que vous avez vous-même soumise.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm">
              {target ? `${categoryLabel(target.category_id)} · ${formatMoney(target.amount)}` : ''}
            </p>

            <Field
              id="rejection-reason"
              label="Motif de rejet"
              hint="Obligatoire pour rejeter, 5 caractères minimum."
            >
              <Textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
              />
            </Field>

            {decide.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {decide.error.message}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={rejectionReason.trim().length < 5 || decide.isPending}
                onClick={async () => {
                  if (!target) return
                  await decide.mutateAsync({
                    id: target.id,
                    decision: 'rejetee',
                    reason: rejectionReason,
                  })
                  setTarget(null)
                  setRejectionReason('')
                }}
              >
                Rejeter
              </Button>
              <Button
                type="button"
                disabled={decide.isPending}
                onClick={async () => {
                  if (!target) return
                  await decide.mutateAsync({ id: target.id, decision: 'validee', reason: '' })
                  setTarget(null)
                }}
              >
                Valider
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Répartition ------------------------------------------------------- */}
      <Dialog
        open={allocationTarget !== null}
        onOpenChange={(open) => !open && setAllocationTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Répartir la charge indirecte</DialogTitle>
            <DialogDescription>
              La répartition est calculée au serveur et historisée avec sa base, son total et son
              ratio. Si la clé vaut zéro sur la période, la répartition est refusée plutôt que
              d’imputer des quotes-parts nulles.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field id="allocate-key" label="Clé de répartition" required>
              <select
                id="allocate-key"
                className={SELECT_CLASS}
                value={allocationKey}
                onChange={(event) => setAllocationKey(event.target.value as AllocationKeyEnum)}
              >
                {Object.entries(ALLOCATION_KEY_LABELS)
                  .filter(([value]) => value !== 'manuel')
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </Field>

            <p className="text-sm text-muted-foreground">
              Réparti sur {(partners ?? []).length} société(s).
            </p>

            {allocate.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {allocate.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAllocationTarget(null)}>
                Annuler
              </Button>
              <Button type="button" disabled={allocate.isPending} onClick={runAllocation}>
                {allocate.isPending ? 'Répartition…' : 'Répartir'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
