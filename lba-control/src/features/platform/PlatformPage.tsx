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
import { useConfirmPayment } from '@/features/subscription/api'
import { useSession } from '@/lib/auth/session'
import {
  useOpenSupportSession,
  usePlatformOverview,
  useRevokeSupportSession,
  useSetTenantStatus,
  type PlatformTenant,
} from './api'

const SUBSCRIPTION_VARIANT: Record<string, 'ok' | 'warn' | 'critical' | 'neutral'> = {
  active: 'ok',
  trial: 'ok',
  grace_period: 'warn',
  overdue: 'warn',
  pending_payment: 'warn',
  suspended_read_only: 'critical',
  suspended: 'critical',
  cancelled: 'neutral',
  expired: 'neutral',
}

/**
 * Écran Z01 — console plateforme.
 *
 * L'écran est défini autant par ce qu'il montre que par ce qu'il **ne montre
 * pas**. Le super-administrateur y voit l'état commercial de chaque client —
 * plan, échéance, paiements en attente, compteurs d'utilisateurs — et aucune
 * donnée métier : ni achat, ni prix, ni marge, ni nom de pisteur.
 *
 * Entrer chez un client reste possible, par une session d'assistance motivée et
 * limitée dans le temps. Le client lit ensuite dans son propre journal qui est
 * entré, quand et pourquoi. Un accès permanent serait un accès non contrôlé.
 */
export function PlatformPage() {
  const { role } = useSession()
  const isPlatformAdmin = role === 'super_admin'

  const { data, isLoading, error } = usePlatformOverview(isPlatformAdmin)
  const openSession = useOpenSupportSession()
  const revokeSession = useRevokeSupportSession()
  const setStatus = useSetTenantStatus()
  const confirmPayment = useConfirmPayment()

  const [supportTarget, setSupportTarget] = useState<PlatformTenant | null>(null)
  const [statusTarget, setStatusTarget] = useState<PlatformTenant | null>(null)
  const [supportForm, setSupportForm] = useState({ reason: '', durationMins: '60' })
  const [statusForm, setStatusForm] = useState({ status: 'suspended', reason: '' })
  const [note, setNote] = useState('')

  if (!isPlatformAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Console plateforme</h1>
        <p className="text-muted-foreground">
          Cet écran est réservé aux administrateurs de la plateforme.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Console plateforme</h1>
        <p className="text-muted-foreground">
          Abonnements, paiements à vérifier et sessions d’assistance.
        </p>
      </header>

      <Card className="border-status-warn/40 bg-status-warn/5">
        <CardHeader>
          <CardTitle>Aucune donnée métier n’est visible ici</CardTitle>
          <CardDescription>
            Vous administrez des abonnements, pas des campagnes. Les chiffres ci-dessous sont des
            compteurs : ni achat, ni prix, ni marge, ni nom de pisteur. Accéder aux données d’un
            client exige une session d’assistance motivée et limitée dans le temps, que le client
            retrouve dans son propre journal d’audit.
          </CardDescription>
        </CardHeader>
      </Card>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}

      {[openSession.error, revokeSession.error, setStatus.error, confirmPayment.error]
        .filter((item): item is Error => Boolean(item))
        .map((item) => (
          <p
            key={item.message}
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {item.message}
          </p>
        ))}

      <Card>
        <CardHeader>
          <CardTitle>Paiements à vérifier</CardTitle>
          <CardDescription>
            Une déclaration n’a rien changé au statut du client. Confirmez-la après avoir vu le
            relevé — jamais sur la seule foi de la capture d’écran envoyée.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(data?.pending_payments ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun paiement en attente.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead>Moyen</TableHead>
                    <TableHead>Référence</TableHead>
                    <TableHead>Déclaré le</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.pending_payments ?? []).map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{payment.commercial_name}</TableCell>
                      <TableCell className="font-semibold">{formatMoney(payment.amount)}</TableCell>
                      <TableCell>{payment.method.replace(/_/g, ' ')}</TableCell>
                      <TableCell className="font-mono text-xs">{payment.reference}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {payment.declared_at.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="link"
                          size="sm"
                          disabled={confirmPayment.isPending || note.trim().length < 5}
                          onClick={() => confirmPayment.mutate({ paymentId: payment.id, note })}
                        >
                          Confirmer
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Field
                id="verifier-note"
                label="Note de vérification"
                hint="5 caractères minimum : ce qui a été vérifié, et où."
              >
                <Input
                  id="verifier-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Relevé bancaire du 12/03 vérifié"
                />
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clients</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : (data?.tenants ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun client enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Abonnement</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Utilisateurs</TableHead>
                  <TableHead>Pisteurs</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.tenants ?? []).map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <p>{tenant.commercial_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{tenant.slug}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tenant.plan_name ?? '—'}</TableCell>
                    <TableCell>
                      {tenant.subscription_status === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge
                          variant={SUBSCRIPTION_VARIANT[tenant.subscription_status] ?? 'neutral'}
                        >
                          {tenant.subscription_status.replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tenant.period_end ?? '—'}
                      {tenant.days_to_expiry !== null && (
                        <span className="ml-2 text-muted-foreground">
                          {tenant.days_to_expiry >= 0
                            ? `J-${tenant.days_to_expiry}`
                            : `J+${Math.abs(tenant.days_to_expiry)}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{tenant.active_users}</TableCell>
                    <TableCell>{tenant.active_agents}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button variant="link" size="sm" onClick={() => setSupportTarget(tenant)}>
                        Assistance
                      </Button>
                      <Button variant="link" size="sm" onClick={() => setStatusTarget(tenant)}>
                        {tenant.tenant_status === 'active' ? 'Suspendre' : 'Réactiver'}
                      </Button>
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
          <CardTitle>Sessions d’assistance</CardTitle>
          <CardDescription>
            Chaque accès aux données d’un client, avec son motif, son auteur et sa fin. Le client
            voit la même chose dans son journal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(data?.support_sessions ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucune session ouverte à ce jour.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Motif</TableHead>
                  <TableHead>Ouverte le</TableHead>
                  <TableHead>Expire le</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.support_sessions ?? []).map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>{session.commercial_name}</TableCell>
                    <TableCell className="text-muted-foreground">{session.reason}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {session.granted_at.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {session.expires_at.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={session.is_active ? 'warn' : 'neutral'}>
                        {session.is_active ? 'active' : session.revoked_at ? 'révoquée' : 'expirée'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {session.is_active && (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => revokeSession.mutate(session.id)}
                        >
                          Révoquer
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

      {/* Session d'assistance ----------------------------------------------- */}
      <Dialog open={supportTarget !== null} onOpenChange={(open) => !open && setSupportTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ouvrir une session d’assistance</DialogTitle>
            <DialogDescription>
              Vous allez accéder aux données de {supportTarget?.commercial_name}. Le motif, votre
              identité et l’heure seront inscrits dans le journal du client, qui pourra les lire.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!supportTarget) return
              await openSession.mutateAsync({
                tenantId: supportTarget.id,
                reason: supportForm.reason,
                durationMins: Number(supportForm.durationMins),
              })
              setSupportTarget(null)
              setSupportForm({ reason: '', durationMins: '60' })
            }}
          >
            <Field
              id="support-reason"
              label="Motif"
              required
              hint="10 caractères minimum. Il sera lisible par le client."
            >
              <Textarea
                id="support-reason"
                required
                value={supportForm.reason}
                onChange={(event) => setSupportForm({ ...supportForm, reason: event.target.value })}
              />
            </Field>

            <Field
              id="support-duration"
              label="Durée (minutes)"
              required
              hint="Une session sans fin serait un accès permanent."
            >
              <Input
                id="support-duration"
                type="number"
                min="5"
                max="480"
                required
                value={supportForm.durationMins}
                onChange={(event) =>
                  setSupportForm({ ...supportForm, durationMins: event.target.value })
                }
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSupportTarget(null)}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={openSession.isPending || supportForm.reason.trim().length < 10}
              >
                {openSession.isPending ? 'Ouverture…' : 'Ouvrir la session'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Suspension --------------------------------------------------------- */}
      <Dialog open={statusTarget !== null} onOpenChange={(open) => !open && setStatusTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Changer l’état de {statusTarget?.commercial_name}</DialogTitle>
            <DialogDescription>
              Suspendre un client coupe l’outil de travail d’une entreprise entière. Aucune donnée
              n’est supprimée : tout redevient accessible à la réactivation.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!statusTarget) return
              await setStatus.mutateAsync({
                tenantId: statusTarget.id,
                status: statusForm.status,
                reason: statusForm.reason,
              })
              setStatusTarget(null)
              setStatusForm({ status: 'suspended', reason: '' })
            }}
          >
            <Field id="tenant-status" label="Nouvel état" required>
              <select
                id="tenant-status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={statusForm.status}
                onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })}
              >
                <option value="active">Actif</option>
                <option value="suspended">Suspendu</option>
                <option value="archived">Archivé</option>
              </select>
            </Field>

            <Field id="status-reason" label="Motif" required hint="20 caractères minimum.">
              <Textarea
                id="status-reason"
                required
                value={statusForm.reason}
                onChange={(event) => setStatusForm({ ...statusForm, reason: event.target.value })}
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStatusTarget(null)}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={setStatus.isPending || statusForm.reason.trim().length < 20}
              >
                {setStatus.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
