import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/domain/money'
import {
  capabilitiesFor,
  classifyPayment,
  resolveLifecycle,
  type AccessLevel,
} from '@/domain/subscription'
import { useSession } from '@/lib/auth/session'
import {
  useConfirmPayment,
  useDeclarePayment,
  useInvoices,
  useSubscription,
  useSubscriptionEvents,
  useSubscriptionPayments,
} from './api'

const PHASE_LABELS: Record<string, string> = {
  essai: 'Période d’essai',
  actif: 'Actif',
  echeance_proche: 'Échéance proche',
  echu_en_grace: 'Échu — période de grâce',
  lecture_seule: 'Lecture seule',
  bloque: 'Accès opérationnel bloqué',
  resilie: 'Résilié',
}

const ACCESS_VARIANT: Record<AccessLevel, 'ok' | 'warn' | 'critical'> = {
  full: 'ok',
  read_only: 'warn',
  blocked: 'critical',
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  declared: 'déclaré, en attente de vérification',
  confirmed: 'confirmé',
  partial: 'partiel — conservé en avoir',
  rejected: 'rejeté',
}

const METHODS = [
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'mtn_money', label: 'MTN Money' },
  { value: 'moov_money', label: 'Moov Money' },
  { value: 'bank_transfer', label: 'Virement bancaire' },
  { value: 'cheque', label: 'Chèque' },
]

/**
 * Écran A02 — abonnement.
 *
 * L'écran dit deux choses qu'un logiciel de facturation évite en général de
 * dire clairement :
 *
 *  · ce qui va se passer, et quand. La date exacte de chaque bascule est
 *    affichée à l'avance ; un client qui découvre son blocage le jour même n'a
 *    pas été prévenu, il a été piégé.
 *
 *  · qu'une déclaration de paiement ne réactive rien. Le laisser espérer
 *    produirait un appel furieux à la première tentative de saisie.
 */
export function SubscriptionPage() {
  const { role } = useSession()
  const { data: subscription, isLoading } = useSubscription()
  const { data: invoices } = useInvoices()
  const { data: payments } = useSubscriptionPayments()
  const { data: events } = useSubscriptionEvents()
  const declare = useDeclarePayment()
  const confirm = useConfirmPayment()

  const [form, setForm] = useState({
    amount: '',
    method: 'wave',
    reference: '',
    payer: '',
    invoiceId: '',
  })
  const [note, setNote] = useState('')

  const isPlatformAdmin = role === 'super_admin'
  const today = new Date().toISOString().slice(0, 10)

  const lifecycle = subscription
    ? resolveLifecycle(
        {
          status: subscription.status,
          periodEnd: subscription.period_end,
          graceDays: subscription.grace_days,
          readonlyAfterDays: subscription.readonly_after_days,
        },
        today,
      )
    : null

  const capabilities = lifecycle ? capabilitiesFor(lifecycle.accessLevel) : null

  const openInvoice = (invoices ?? []).find(
    (invoice) => invoice.status !== 'paid' && invoice.status !== 'cancelled',
  )

  const amount = Number(form.amount) || 0
  const preview =
    openInvoice && amount > 0
      ? classifyPayment(Number(openInvoice.amount), Number(openInvoice.amount_paid), amount)
      : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await declare.mutateAsync({
      amount,
      method: form.method,
      reference: form.reference,
      invoiceId: form.invoiceId || openInvoice?.id || null,
      payer: form.payer,
    })
    setForm({ ...form, amount: '', reference: '', payer: '' })
  }

  if (isLoading) {
    return (
      <p role="status" className="text-muted-foreground">
        Chargement…
      </p>
    )
  }

  if (!subscription || !lifecycle || !capabilities) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Abonnement</h1>
        <p className="text-muted-foreground">Aucun abonnement enregistré pour cette entreprise.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Abonnement</h1>
        <p className="text-muted-foreground">
          Plan, échéance, factures, paiements et renouvellement.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{PHASE_LABELS[lifecycle.phase] ?? lifecycle.phase}</CardTitle>
            <CardDescription>{lifecycle.message}</CardDescription>
          </div>
          <Badge variant={ACCESS_VARIANT[lifecycle.accessLevel]}>
            {lifecycle.accessLevel === 'full'
              ? 'accès complet'
              : lifecycle.accessLevel === 'read_only'
                ? 'lecture seule'
                : 'accès bloqué'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 md:grid-cols-4">
            <div>
              <dt className="text-sm text-muted-foreground">Échéance</dt>
              <dd className="font-mono">{subscription.period_end}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Montant</dt>
              <dd className="font-semibold">{formatMoney(subscription.amount)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Période de grâce</dt>
              <dd>{subscription.grace_days} jours</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Prochaine bascule</dt>
              <dd className="font-mono">
                {lifecycle.nextTransition
                  ? `${PHASE_LABELS[lifecycle.nextTransition.phase]} le ${lifecycle.nextTransition.on}`
                  : '—'}
              </dd>
            </div>
          </dl>

          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <p className="font-medium">Ce qui reste possible aujourd’hui</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              <li>Consulter les données : {capabilities.canRead ? 'oui' : 'non'}</li>
              <li>Saisir et modifier : {capabilities.canWrite ? 'oui' : 'non'}</li>
              {/* Retenir les données d'un client en retard serait une prise
                  d'otage, pas une politique commerciale. */}
              <li>Exporter : {capabilities.canExport ? 'oui' : 'non'}</li>
              <li>Déclarer un paiement : {capabilities.canDeclarePayment ? 'oui' : 'non'}</li>
            </ul>
            <p className="mt-2">
              Vos données sont conservées à toutes les étapes, y compris après blocage. Rien n’est
              supprimé.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Factures</CardTitle>
        </CardHeader>
        <CardContent>
          {(invoices ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucune facture émise.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numéro</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Déjà réglé</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices ?? []).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">{invoice.number}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {invoice.period_start} → {invoice.period_end}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{invoice.due_date}</TableCell>
                    <TableCell>{formatMoney(invoice.amount)}</TableCell>
                    <TableCell>{formatMoney(invoice.amount_paid)}</TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === 'paid' ? 'ok' : 'warn'}>
                        {invoice.status.replace(/_/g, ' ')}
                      </Badge>
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
          <CardTitle>Déclarer un paiement</CardTitle>
          <CardDescription>
            Votre déclaration est enregistrée et vérifiée avant toute réactivation. Elle ne renouvelle
            jamais l’abonnement à elle seule — une capture d’écran ne suffit pas, et c’est aussi ce qui
            vous protège d’une réactivation faite en votre nom.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="pay-amount" label="Montant (FCFA)" required>
                <Input
                  id="pay-amount"
                  type="number"
                  min="1"
                  required
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                />
              </Field>

              <Field id="pay-method" label="Moyen de paiement" required>
                <select
                  id="pay-method"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.method}
                  onChange={(event) => setForm({ ...form, method: event.target.value })}
                >
                  {METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                id="pay-reference"
                label="Référence de transaction"
                required
                hint="Sans elle, le paiement est invérifiable."
              >
                <Input
                  id="pay-reference"
                  required
                  minLength={3}
                  value={form.reference}
                  onChange={(event) => setForm({ ...form, reference: event.target.value })}
                />
              </Field>

              <Field id="pay-payer" label="Payeur">
                <Input
                  id="pay-payer"
                  value={form.payer}
                  onChange={(event) => setForm({ ...form, payer: event.target.value })}
                />
              </Field>
            </div>

            {preview && (
              <p
                className={
                  preview.renewsPeriod
                    ? 'rounded-md bg-muted px-3 py-2 text-sm'
                    : 'rounded-md bg-status-warn/10 px-3 py-2 text-sm'
                }
              >
                {preview.message}
              </p>
            )}

            {declare.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {declare.error.message}
              </p>
            )}

            {declare.isSuccess && (
              <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
                Déclaration enregistrée. Statut de l’abonnement inchangé jusqu’à vérification.
              </p>
            )}

            <Button type="submit" disabled={declare.isPending || form.reference.trim().length < 3}>
              {declare.isPending ? 'Enregistrement…' : 'Déclarer le paiement'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paiements déclarés</CardTitle>
        </CardHeader>
        <CardContent>
          {(payments ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun paiement déclaré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Moyen</TableHead>
                  <TableHead>Référence</TableHead>
                  <TableHead>Statut</TableHead>
                  {isPlatformAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payments ?? []).map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-mono text-xs">
                      {payment.declared_at.slice(0, 10)}
                    </TableCell>
                    <TableCell>{formatMoney(payment.amount)}</TableCell>
                    <TableCell>{payment.method.replace(/_/g, ' ')}</TableCell>
                    <TableCell className="font-mono text-xs">{payment.reference}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          payment.status === 'confirmed'
                            ? 'ok'
                            : payment.status === 'rejected'
                              ? 'critical'
                              : 'warn'
                        }
                      >
                        {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                      </Badge>
                    </TableCell>
                    {isPlatformAdmin && (
                      <TableCell className="text-right">
                        {payment.status === 'declared' && (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => confirm.mutate({ paymentId: payment.id, note })}
                          >
                            Vérifier et confirmer
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {isPlatformAdmin && (
            <div className="mt-4 space-y-2">
              <Field id="verifier-note" label="Note de vérification">
                <Input
                  id="verifier-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Relevé bancaire vérifié le…"
                />
              </Field>
              {confirm.error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {confirm.error.message}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historique</CardTitle>
          <CardDescription>
            Rappels, changements de statut et vérifications, dans l’ordre où ils se sont produits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(events ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun événement.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(events ?? []).map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {event.occurred_at.slice(0, 16).replace('T', ' ')}
                  </span>
                  <span className="font-medium">{event.event_type.replace(/_/g, ' ')}</span>
                  {event.old_status && event.new_status && event.old_status !== event.new_status && (
                    <span className="text-muted-foreground">
                      {event.old_status} → {event.new_status}
                    </span>
                  )}
                  <span className="text-muted-foreground">{event.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
