import { Bell, CheckCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  countStillOpen,
  groupByDay,
  SEVERITY_LABELS,
  stillOpen,
  unreadCount,
  type NotificationItem,
  type NotificationSeverity,
} from '@/domain/notifications'
import { useMarkNotificationsRead, useNotifications } from './api'

const SEVERITY_VARIANT: Record<NotificationSeverity, 'ok' | 'warn' | 'critical' | 'neutral'> = {
  info: 'neutral',
  surveillance: 'warn',
  critique: 'critical',
  blocage: 'critical',
}

/**
 * Écran N01 — centre de notifications.
 *
 * Les alertes existaient déjà ; il fallait ouvrir leur écran pour les
 * découvrir. Une alerte « livraison prévue demain » lue le surlendemain n'a
 * servi à rien.
 *
 * L'écran répète une distinction que rien d'autre ne rappelle : **une
 * notification lue n'est pas une situation réglée**. Le compteur des situations
 * encore ouvertes reste affiché même quand tout est lu, précisément pour que
 * « tout marquer comme lu » ne donne pas l'illusion d'avoir traité.
 */
export function NotificationsPage() {
  const { data, isLoading } = useNotifications()
  const markRead = useMarkNotificationsRead()

  const items = data ?? []
  const unread = unreadCount(items)
  const open = countStillOpen(items)
  const groups = groupByDay(items, new Date())

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-muted-foreground">
            Ce que l’application a détecté et que vous n’avez pas encore vu.
          </p>
        </div>
        {unread > 0 && (
          <Button variant="outline" onClick={() => markRead.mutate(undefined)} disabled={markRead.isPending}>
            <CheckCheck size={16} />
            {markRead.isPending ? 'Enregistrement…' : 'Tout marquer comme lu'}
          </Button>
        )}
      </header>

      {open > 0 && (
        <Card className="border-status-warn/40 bg-status-warn/5">
          <CardHeader>
            <CardTitle className="text-base">
              {open} situation(s) encore ouverte(s)
            </CardTitle>
            <CardDescription>
              Marquer comme lu range cet écran ; cela ne règle rien. Les situations se traitent depuis{' '}
              <Link to="/alertes" className="underline">
                l’écran des alertes
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {isLoading ? (
        <p role="status" className="text-muted-foreground">
          Chargement…
        </p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Bell size={28} className="text-muted-foreground" />
            <p className="font-medium">Rien à signaler</p>
            <p className="text-sm text-muted-foreground">
              Les alertes sont évaluées deux fois par jour. Ce qui vous concerne apparaîtra ici.
            </p>
          </CardContent>
        </Card>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h2>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={item.id}>
                  <NotificationCard
                    item={item}
                    onRead={() => markRead.mutate([item.id])}
                    disabled={markRead.isPending}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {markRead.error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {markRead.error.message}
        </p>
      )}
    </div>
  )
}

function NotificationCard({
  item,
  onRead,
  disabled,
}: {
  item: NotificationItem
  onRead: () => void
  disabled: boolean
}) {
  return (
    <Card
      data-testid="notification"
      data-read={item.readAt !== null}
      className={item.readAt === null ? 'border-l-4 border-l-brand' : undefined}
    >
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={SEVERITY_VARIANT[item.severity]}>
              {SEVERITY_LABELS[item.severity]}
            </Badge>
            <CardTitle className="text-base">{item.title}</CardTitle>
            {/* Une notification lue dont la situation dure doit continuer de se
                voir : c'est le cas que « tout marquer comme lu » ferait
                disparaître sans rien avoir réglé. */}
            {item.readAt !== null && stillOpen(item) && (
              <Badge variant="warn">situation non réglée</Badge>
            )}
          </div>
          <CardDescription>{item.body}</CardDescription>
        </div>
        {item.readAt === null && (
          <Button variant="ghost" size="sm" onClick={onRead} disabled={disabled}>
            Marquer comme lu
          </Button>
        )}
      </CardHeader>
    </Card>
  )
}
