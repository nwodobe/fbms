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

// ---------------------------------------------------------------------------
// Canaux de message
// ---------------------------------------------------------------------------

const CHANNELS = ['message-channels'] as const
const OUTBOX = ['message-outbox'] as const

export interface MessageChannelRow {
  id: string
  channel: 'sms' | 'whatsapp' | 'email'
  destination: string
  consented_at: string
  revoked_at: string | null
}

/** Canaux par lesquels l'utilisateur a accepté d'être joint hors application. */
export function useMessageChannels() {
  return useQuery({
    queryKey: CHANNELS,
    queryFn: async (): Promise<MessageChannelRow[]> => {
      const { data, error } = await supabase
        .from('user_message_channels')
        .select('id, channel, destination, consented_at, revoked_at')
        .order('channel')

      if (error) throw new Error(describeError(error))
      return (data ?? []) as MessageChannelRow[]
    },
  })
}

/**
 * Accepte un canal, ou change sa coordonnée.
 *
 * Changer de numéro redemande un consentement côté serveur : accepter des SMS
 * sur un numéro n'est pas les accepter sur le suivant.
 */
export function useSetMessageChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { channel: 'sms' | 'whatsapp' | 'email'; destination: string }) => {
      const { error } = await supabase.rpc('set_message_channel', {
        p_channel: args.channel,
        p_destination: args.destination,
      })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHANNELS }),
  })
}

export function useRevokeMessageChannel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (channel: 'sms' | 'whatsapp' | 'email') => {
      const { error } = await supabase.rpc('revoke_message_channel', { p_channel: channel })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS })
      void queryClient.invalidateQueries({ queryKey: OUTBOX })
    },
  })
}

export interface OutboxRow {
  id: string
  channel: 'sms' | 'whatsapp' | 'email'
  destination: string
  body: string
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'
  attempts: number
  last_error: string | null
  sent_at: string | null
  segments: number | null
  created_at: string
}

/** Journal des messages sortants : ce qui est parti, ce qui a échoué, et pourquoi. */
export function useMessageOutbox() {
  return useQuery({
    queryKey: OUTBOX,
    queryFn: async (): Promise<OutboxRow[]> => {
      const { data, error } = await supabase
        .from('message_outbox')
        .select('id, channel, destination, body, status, attempts, last_error, sent_at, segments, created_at')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw new Error(describeError(error))
      return (data ?? []) as OutboxRow[]
    },
  })
}
