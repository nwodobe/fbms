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
  describeInvitation,
  emailIssue,
  invitationState,
  INVITATION_LABELS,
  sortInvitations,
} from '@/domain/tenants'
import { useSession } from '@/lib/auth/session'
import type { UserRole } from '@/types/database'
import {
  useAssignableRoles,
  useInviteUser,
  useRevokeDevice,
  useRevokeInvitation,
  useSetUserRole,
  useSetUserStatus,
  useTenantInvitations,
  useTenantUsers,
  useUserDevices,
  type TenantUser,
} from './api'

const ROLE_LABELS: Record<string, string> = {
  proprietaire: 'Propriétaire',
  gestionnaire: 'Gestionnaire',
  comptable: 'Comptable',
  responsable_terrain: 'Responsable terrain',
  pisteur: 'Pisteur',
  auditeur: 'Auditeur',
  magasinier: 'Magasinier',
  logistique: 'Logistique',
  partenaire_externe: 'Partenaire externe',
  super_admin: 'Administrateur plateforme',
}

const SELECT_CLASS = 'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

/**
 * Écran A01 — utilisateurs, rôles et appareils.
 *
 * Annoncé dans la navigation depuis la phase 1, construit ici. Les règles
 * vivaient déjà en base ; ce qui manquait était le moyen de s'en servir.
 *
 * Deux choses que l'écran dit et qu'un tableau ordinaire tairait :
 *
 *  · **ce qui ne peut pas être fait, et pourquoi** — trois rôles ont leurs
 *    politiques rédigées mais non activées ; ils sont listés, grisés et
 *    expliqués plutôt qu'absents. Un rôle qui disparaît sans raison se
 *    redemande tous les six mois ;
 *
 *  · **rien ne se supprime** — on suspend, on révoque. Un compte effacé emporte
 *    la lisibilité de tout ce qu'il a fait, et le journal d'audit se met à
 *    désigner un identifiant sans nom.
 */
export function UsersPage() {
  const { user: currentUser } = useSession()
  const { data: users, isLoading } = useTenantUsers()
  const { data: roles } = useAssignableRoles()
  const { data: devices } = useUserDevices()
  const { data: invitations } = useTenantInvitations()

  const setRole = useSetUserRole()
  const setStatus = useSetUserStatus()
  const revokeDevice = useRevokeDevice()
  const inviteUser = useInviteUser()
  const revokeInvitation = useRevokeInvitation()

  const [editing, setEditing] = useState<TenantUser | null>(null)
  const [form, setForm] = useState({ role: '' as UserRole | '', reason: '' })
  const [inviting, setInviting] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    email: '',
    fullName: '',
    role: '' as UserRole | '',
  })

  const assignable = (roles ?? []).filter((row) => row.is_assignable && row.role !== 'super_admin')
  const blocked = (roles ?? []).filter((row) => !row.is_assignable)
  const userName = (id: string) => users?.find((u) => u.id === id)?.full_name ?? '—'
  const now = new Date()
  const emailProbleme = inviteForm.email.length > 0 ? emailIssue(inviteForm.email) : null

  async function submitRole(event: React.FormEvent) {
    event.preventDefault()
    if (!editing || !form.role) return
    await setRole.mutateAsync({ userId: editing.id, role: form.role, reason: form.reason })
    setEditing(null)
    setForm({ role: '', reason: '' })
  }

  async function submitInvite(event: React.FormEvent) {
    event.preventDefault()
    if (!inviteForm.role) return
    await inviteUser.mutateAsync({
      email: inviteForm.email.trim(),
      fullName: inviteForm.fullName.trim(),
      role: inviteForm.role,
    })
    setInviting(false)
    setInviteForm({ email: '', fullName: '', role: '' })
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Utilisateurs et rôles</h1>
          <p className="text-muted-foreground">
            Sept rôles attribuables, la séparation des tâches, et la révocation d’appareil. Aucun
            compte ne se supprime.
          </p>
        </div>
        <Button onClick={() => setInviting(true)}>Inviter quelqu’un</Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Comptes</CardTitle>
          <CardDescription>
            Le contrôle réel est celui de la base : ce tableau montre ce qui est permis, il ne le
            décide pas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Dernière connexion</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).map((row) => {
                  const isSelf = row.id === currentUser?.id
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.full_name}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(vous)</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.email ?? row.phone ?? '—'}
                      </TableCell>
                      <TableCell>{ROLE_LABELS[row.role] ?? row.role}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.last_login_at ? row.last_login_at.slice(0, 16).replace('T', ' ') : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'active' ? 'ok' : 'warn'}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        {/* Sur son propre compte, rien n'est proposé : le serveur
                            refuse, et proposer un bouton qui échoue toujours est
                            une promesse non tenue. */}
                        {!isSelf && (
                          <>
                            <Button
                              variant="link"
                              size="sm"
                              onClick={() => {
                                setEditing(row)
                                setForm({ role: row.role, reason: '' })
                              }}
                            >
                              Changer le rôle
                            </Button>
                            <Button
                              variant="link"
                              size="sm"
                              onClick={() =>
                                setStatus.mutate({
                                  userId: row.id,
                                  status: row.status === 'active' ? 'suspended' : 'active',
                                  reason:
                                    row.status === 'active'
                                      ? 'Compte suspendu depuis l’écran d’administration.'
                                      : 'Compte réactivé depuis l’écran d’administration.',
                                })
                              }
                            >
                              {row.status === 'active' ? 'Suspendre' : 'Réactiver'}
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
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

      {blocked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Rôles non encore activés</CardTitle>
            <CardDescription>
              Leurs politiques sont écrites et testées, mais ils ne sont pas attribuables. Les
              masquer ferait redemander la même question tous les six mois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {blocked.map((row) => (
                <li key={row.role} className="flex flex-wrap gap-2">
                  <span className="font-medium">{ROLE_LABELS[row.role] ?? row.role}</span>
                  <span className="text-muted-foreground">{row.note ?? 'Activation ultérieure.'}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            Une invitation n’est pas un compte : c’est une promesse de compte, avec une date de
            péremption. Un lien sans expiration oublié dans une boîte mail reste une porte ouverte
            des années durant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(invitations ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucune invitation en cours.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invité</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Invité le</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortInvitations(invitations ?? [], now).map((invitation) => {
                  const state = invitationState(invitation, now)
                  return (
                    <TableRow key={invitation.id}>
                      <TableCell>
                        <p className="font-medium">{invitation.full_name}</p>
                        <p className="text-xs text-muted-foreground">{invitation.email}</p>
                      </TableCell>
                      <TableCell>{ROLE_LABELS[invitation.role] ?? invitation.role}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {invitation.invited_at.slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            state === 'accepted' ? 'ok' : state === 'expired' ? 'warn' : 'neutral'
                          }
                        >
                          {INVITATION_LABELS[state]}
                        </Badge>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {describeInvitation(invitation, now)}
                        </span>
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        {invitation.status === 'pending' && (
                          <>
                            {/* Réinviter renouvelle le délai et remplace le jeton :
                                c'est le geste normal quand un courriel s'est perdu. */}
                            <Button
                              variant="link"
                              size="sm"
                              onClick={() =>
                                inviteUser.mutate({
                                  email: invitation.email,
                                  fullName: invitation.full_name,
                                  role: invitation.role,
                                })
                              }
                            >
                              Renvoyer
                            </Button>
                            <Button
                              variant="link"
                              size="sm"
                              onClick={() => revokeInvitation.mutate(invitation.id)}
                            >
                              Révoquer
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}

          {[inviteUser.error, revokeInvitation.error]
            .filter((item): item is Error => Boolean(item))
            .map((item) => (
              <p
                key={item.message}
                role="alert"
                className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {item.message}
              </p>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appareils</CardTitle>
          <CardDescription>
            Un appareil révoqué ne synchronise plus. Il reste listé : savoir qu’un téléphone a été
            révoqué le 12 mars fait partie de l’enquête sur ce qu’il a saisi le 11.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(devices ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun appareil enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Appareil</TableHead>
                  <TableHead>Dernière activité</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(devices ?? []).map((device) => (
                  <TableRow key={device.id}>
                    <TableCell>{userName(device.user_id)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {device.label ?? device.device_id}
                      {device.platform && ` · ${device.platform}`}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {device.last_seen_at.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={device.revoked_at ? 'critical' : 'ok'}>
                        {device.revoked_at ? 'révoqué' : 'actif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!device.revoked_at && (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() =>
                            revokeDevice.mutate({
                              id: device.id,
                              reason: 'Appareil révoqué depuis l’écran d’administration.',
                            })
                          }
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

      <Dialog open={inviting} onOpenChange={(open) => !open && setInviting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter quelqu’un</DialogTitle>
            <DialogDescription>
              Aucun mot de passe n’est fixé ici : la personne invitée crée son compte elle-même
              depuis le lien reçu. L’invitation expire au bout de quatorze jours.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitInvite} className="space-y-4">
            <Field id="invite-name" label="Nom complet" required>
              <Input
                id="invite-name"
                required
                value={inviteForm.fullName}
                onChange={(event) => setInviteForm({ ...inviteForm, fullName: event.target.value })}
                placeholder="YAO Comptable"
              />
            </Field>

            <Field
              id="invite-email"
              label="Adresse électronique"
              required
              error={emailProbleme ?? undefined}
            >
              <Input
                id="invite-email"
                type="email"
                required
                value={inviteForm.email}
                onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
              />
            </Field>

            {/* Même liste que le changement de rôle : inviter quelqu'un ne doit
                pas contourner ce que changer un rôle interdit. */}
            <Field id="invite-role" label="Rôle" required>
              <select
                id="invite-role"
                required
                className={SELECT_CLASS}
                value={inviteForm.role}
                onChange={(event) =>
                  setInviteForm({ ...inviteForm, role: event.target.value as UserRole })
                }
              >
                <option value="">Sélectionner…</option>
                {assignable.map((row) => (
                  <option key={row.role} value={row.role}>
                    {ROLE_LABELS[row.role] ?? row.role}
                  </option>
                ))}
              </select>
            </Field>

            {inviteUser.error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {inviteUser.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setInviting(false)}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={
                  inviteUser.isPending ||
                  !inviteForm.role ||
                  emailProbleme !== null ||
                  inviteForm.email.length === 0 ||
                  inviteForm.fullName.trim().length < 2
                }
              >
                {inviteUser.isPending ? 'Envoi…' : 'Inviter'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Changer le rôle — {editing?.full_name}</DialogTitle>
            <DialogDescription>
              Le changement est tracé dans le journal d’audit avec son motif.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitRole} className="space-y-4">
            <Field id="role" label="Nouveau rôle" required>
              <select
                id="role"
                required
                className={SELECT_CLASS}
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}
              >
                <option value="">Sélectionner…</option>
                {assignable.map((row) => (
                  <option key={row.role} value={row.role}>
                    {ROLE_LABELS[row.role] ?? row.role}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="reason" label="Motif" required hint="10 caractères minimum.">
              <Textarea
                id="reason"
                required
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
              />
            </Field>

            {setRole.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {setRole.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={setRole.isPending || form.reason.trim().length < 10}>
                {setRole.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
