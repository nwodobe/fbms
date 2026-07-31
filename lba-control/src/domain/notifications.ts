/**
 * Centre de notifications.
 *
 * Les alertes existent depuis la phase 5, mais personne n'était prévenu :
 * il fallait ouvrir l'écran des alertes pour les découvrir. Une alerte
 * « livraison prévue demain » qu'on lit le surlendemain n'a servi à rien.
 *
 * Trois règles gouvernent cet écran, et elles sont ici parce qu'elles décident
 * de ce qu'un utilisateur voit — donc de ce à quoi il réagit.
 *
 *  · **L'ordre est celui de l'urgence, pas de l'arrivée.** Un blocage arrivé
 *    hier passe devant une information arrivée ce matin. Trier par date pousse
 *    le grave hors de l'écran au fil de la journée.
 *
 *  · **Le compteur ne ment pas et ne fatigue pas.** Il compte les non-lues, se
 *    plafonne à « 99+ » — au-delà, le nombre exact ne change plus rien à ce
 *    qu'il faut faire — et disparaît à zéro plutôt que d'afficher un rond vide.
 *
 *  · **Une notification lue n'est pas une alerte résolue.** Les deux états sont
 *    distincts et le restent : marquer comme lu range l'écran, cela ne règle
 *    pas la situation. Les confondre ferait disparaître un problème d'un simple
 *    coup d'œil.
 */

export type NotificationSeverity = 'info' | 'surveillance' | 'critique' | 'blocage'

export interface NotificationItem {
  id: string
  title: string
  body: string
  severity: NotificationSeverity
  createdAt: string
  readAt: string | null
  alertId: string | null
  /** Statut de l'alerte d'origine, s'il est connu. */
  alertStatus?: string | null
}

/** Poids de tri : le plus urgent d'abord, à date égale le plus récent. */
const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  blocage: 0,
  critique: 1,
  surveillance: 2,
  info: 3,
}

export const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  blocage: 'Blocage',
  critique: 'Critique',
  surveillance: 'Surveillance',
  info: 'Information',
}

/**
 * Ordonne les notifications.
 *
 * Non lues d'abord — c'est ce que l'utilisateur vient chercher — puis par
 * gravité, puis par date décroissante. Trier d'abord par date ferait glisser un
 * blocage hors de l'écran à mesure que des informations arrivent.
 */
export function sortNotifications(items: readonly NotificationItem[]): NotificationItem[] {
  return [...items].sort((a, b) => {
    const unread = Number(a.readAt !== null) - Number(b.readAt !== null)
    if (unread !== 0) return unread

    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (severity !== 0) return severity

    return b.createdAt.localeCompare(a.createdAt)
  })
}

export function unreadCount(items: readonly NotificationItem[]): number {
  return items.filter((item) => item.readAt === null).length
}

/**
 * Ce qu'affiche la pastille.
 *
 * `null` quand il n'y a rien : une pastille à zéro attire l'œil pour rien.
 * Au-delà de 99, le nombre exact ne change plus ce qu'il faut faire.
 */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null
  return count > 99 ? '99+' : String(count)
}

/**
 * Une notification lue ne vaut pas une alerte traitée.
 *
 * Le rappeler dans l'interface évite le raccourci le plus tentant : vider la
 * liste d'un clic et croire le problème réglé.
 */
export function stillOpen(item: NotificationItem): boolean {
  return item.alertStatus === 'ouverte'
}

export function countStillOpen(items: readonly NotificationItem[]): number {
  return items.filter(stillOpen).length
}

/** Regroupe par jour, en libellés lisibles plutôt qu'en dates brutes. */
export function groupByDay(
  items: readonly NotificationItem[],
  now: Date,
): Array<{ label: string; items: NotificationItem[] }> {
  const groups = new Map<string, NotificationItem[]>()

  for (const item of sortNotifications(items)) {
    const label = dayLabel(item.createdAt, now)
    const bucket = groups.get(label)
    if (bucket) bucket.push(item)
    else groups.set(label, [item])
  }

  return [...groups.entries()].map(([label, grouped]) => ({ label, items: grouped }))
}

export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso)
  const days = wholeDaysBetween(date, now)

  if (days <= 0) return 'Aujourd’hui'
  if (days === 1) return 'Hier'
  if (days < 7) return `Il y a ${days} jours`
  return iso.slice(0, 10)
}

/** Différence en jours calendaires, pas en tranches de 24 heures. */
function wholeDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / 86_400_000)
}
