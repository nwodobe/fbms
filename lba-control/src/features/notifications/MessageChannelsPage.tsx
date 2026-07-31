import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  CHANNEL_LABELS,
  CHANNELS_BY_SEVERITY,
  countMessages,
  describeOutbox,
  normalizePhone,
  QUIET_HOURS,
  type MessageChannel,
} from '@/domain/messaging'
import {
  useMessageChannels,
  useMessageOutbox,
  useRevokeMessageChannel,
  useSetMessageChannel,
} from './api'

type OutboundChannel = 'sms' | 'whatsapp' | 'email'

const CHANNELS: Array<{ channel: OutboundChannel; hint: string; placeholder: string }> = [
  {
    channel: 'whatsapp',
    hint: 'Numéro WhatsApp, au format ivoirien à dix chiffres.',
    placeholder: '07 00 00 00 01',
  },
  {
    channel: 'sms',
    hint: 'Réservé aux blocages. Chaque envoi est facturé.',
    placeholder: '07 00 00 00 01',
  },
  {
    channel: 'email',
    hint: 'Pour les échéances d’abonnement et les récapitulatifs.',
    placeholder: 'nom@entreprise.ci',
  },
]

const STATUS_VARIANT: Record<string, 'ok' | 'warn' | 'critical' | 'neutral'> = {
  sent: 'ok',
  queued: 'neutral',
  sending: 'neutral',
  failed: 'critical',
  cancelled: 'warn',
}

/**
 * Écran N02 — par où l'application vous joint.
 *
 * Trois choses y sont dites franchement, parce qu'elles engagent la personne :
 *
 *  · **rien ne part sans accord** — un numéro renseigné dans une fiche n'est pas
 *    un consentement, et cet écran est le seul endroit qui en donne un ;
 *
 *  · **ce qui déclenche quoi** — l'échelle est affichée, pas devinée. Sans
 *    elle, un utilisateur qui accepte les SMS ne sait pas s'il en recevra un par
 *    jour ou un par mois ;
 *
 *  · **ce qui est parti** — le journal montre les échecs avant les succès. Un
 *    message non délivré est précisément celui dont on aurait eu besoin.
 */
export function MessageChannelsPage() {
  const { data: channels } = useMessageChannels()
  const { data: outbox } = useMessageOutbox()
  const save = useSetMessageChannel()
  const revoke = useRevokeMessageChannel()

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [invalid, setInvalid] = useState<string | null>(null)

  const active = new Map(
    (channels ?? [])
      .filter((row) => row.revoked_at === null)
      .map((row) => [row.channel, row] as const),
  )

  const counts = countMessages(outbox ?? [])

  function submit(channel: OutboundChannel) {
    const raw = (drafts[channel] ?? '').trim()
    setInvalid(null)

    if (channel !== 'email') {
      // Contrôlé ici plutôt qu'après l'envoi : un numéro mal formé part chez un
      // inconnu, avec des montants et des noms de vendeurs dedans.
      const normalized = normalizePhone(raw)
      if (!normalized) {
        setInvalid(
          'Numéro non reconnu. La Côte d’Ivoire utilise dix chiffres depuis 2021 — un numéro à huit chiffres est refusé plutôt que deviné.',
        )
        return
      }
      save.mutate({ channel, destination: normalized })
      return
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
      setInvalid('Adresse électronique non reconnue.')
      return
    }
    save.mutate({ channel, destination: raw })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Par où vous joindre</h1>
        <p className="text-muted-foreground">
          L’application vous prévient dans son écran de notifications. Ici, vous choisissez ce qui
          doit aussi vous atteindre quand vous ne l’avez pas ouverte.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Ce qui déclenche quoi</CardTitle>
          <CardDescription>
            L’échelle est volontairement avare : un message pour chaque information ferait du produit
            une source de bruit, et le premier réflexe serait de ne plus rien lire.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {(['info', 'surveillance', 'critique', 'blocage'] as const).map((severity) => (
              <div key={severity} className="flex items-baseline justify-between gap-3 border-b py-1">
                <dt className="capitalize">{severity}</dt>
                <dd className="text-muted-foreground">
                  {CHANNELS_BY_SEVERITY[severity]
                    .map((channel: MessageChannel) => CHANNEL_LABELS[channel])
                    .join(' · ')}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            Entre {QUIET_HOURS.from} h et {QUIET_HOURS.to} h, seuls les blocages sortent. Le reste
            attend le matin — reporté, jamais perdu.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vos canaux</CardTitle>
          <CardDescription>
            Un numéro renseigné dans votre fiche n’est pas un accord pour l’utiliser. Vous pouvez
            retirer un canal à tout moment : les messages déjà en attente sont alors annulés.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {CHANNELS.map(({ channel, hint, placeholder }) => {
            const current = active.get(channel)
            return (
              <div key={channel} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{CHANNEL_LABELS[channel]}</span>
                  {current ? (
                    <Badge variant="ok">accepté</Badge>
                  ) : (
                    <Badge variant="neutral">non accepté</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{hint}</p>

                {current ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-sm">{current.destination}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(channel)}
                    >
                      Retirer
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field id={`dest-${channel}`} label="Coordonnée" className="flex-1">
                      <Input
                        id={`dest-${channel}`}
                        placeholder={placeholder}
                        value={drafts[channel] ?? ''}
                        onChange={(event) =>
                          setDrafts({ ...drafts, [channel]: event.target.value })
                        }
                      />
                    </Field>
                    <Button disabled={save.isPending} onClick={() => submit(channel)}>
                      Accepter ce canal
                    </Button>
                  </div>
                )}
              </div>
            )
          })}

          {invalid && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {invalid}
            </p>
          )}
          {save.error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {save.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Messages envoyés</CardTitle>
          <CardDescription data-testid="outbox-summary">{describeOutbox(counts)}</CardDescription>
        </CardHeader>
        <CardContent>
          {(outbox ?? []).length === 0 ? (
            <p className="text-muted-foreground">
              Aucun message pour l’instant. Les alertes critiques et bloquantes en produiront.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(outbox ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {row.created_at.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                    <TableCell>{CHANNEL_LABELS[row.channel]}</TableCell>
                    <TableCell className="max-w-md text-sm text-muted-foreground">
                      {row.body}
                      {row.last_error && (
                        <span className="mt-1 block text-status-critical">{row.last_error}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>{row.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
