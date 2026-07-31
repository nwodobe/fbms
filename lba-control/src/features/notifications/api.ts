import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationItem, NotificationSeverity } from '@/domain/notifications'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'

const KEY = ['notifications'] as const

interface NotificationRow {
  id: string
  title: string
  body: string
  alert_id: string | null
  read_at: string | null
  created_at: string
  alerts: { severity: NotificationSeverity; status: string } | null
}

/**
 * Notifications de l'utilisateur courant.
 *
 * La gravité et le statut viennent de l'alerte d'origine, jointe plutôt que
 * recopiée : une alerte résolue doit cesser d'être présentée comme ouverte sans
 * qu'il faille repasser sur toutes les notifications déjà envoyées.
 */
export function useNotifications() {
  return useQuery({
    queryKey: KEY,
    // Le terrain change pendant qu'on regarde l'écran ; une minute est assez
    // court pour être utile, assez long pour ne pas marteler un réseau faible.
    refetchInterval: 60_000,
    queryFn: async (): Promise<NotificationItem[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, alert_id, read_at, created_at, alerts(severity, status)')
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) throw new Error(describeError(error))

      return ((data ?? []) as unknown as NotificationRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        // Une notification sans alerte rattachée reste une information : elle
        // n'est simplement pas hiérarchisée.
        severity: row.alerts?.severity ?? 'info',
        createdAt: row.created_at,
        readAt: row.read_at,
        alertId: row.alert_id,
        alertStatus: row.alerts?.status ?? null,
      }))
    },
  })
}

/**
 * Marque comme lu.
 *
 * Sans identifiants, tout est marqué. Le serveur ne touche jamais au statut de
 * l'alerte : ranger son écran n'est pas régler la situation.
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const { data, error } = await supabase.rpc('mark_notifications_read', {
        p_ids: ids ?? null,
      })
      if (error) throw new Error(describeError(error))
      return (data ?? 0) as number
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
