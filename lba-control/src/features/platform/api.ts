import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'

const OVERVIEW = ['platform-overview'] as const

export interface PlatformTenant {
  id: string
  slug: string
  commercial_name: string
  tenant_status: string
  subscription_id: string | null
  subscription_status: string | null
  period_end: string | null
  amount: number | null
  days_to_expiry: number | null
  plan_name: string | null
  active_users: number
  active_agents: number
  pending_payments: number
}

export interface PlatformPayment {
  id: string
  tenant_id: string
  commercial_name: string
  amount: number
  method: string
  reference: string
  payer: string | null
  declared_at: string
}

export interface PlatformSupportSession {
  id: string
  tenant_id: string
  commercial_name: string
  reason: string
  granted_at: string
  expires_at: string
  revoked_at: string | null
  is_active: boolean
}

export interface PlatformOverview {
  tenants: PlatformTenant[]
  pending_payments: PlatformPayment[]
  support_sessions: PlatformSupportSession[]
}

/**
 * État commercial des clients.
 *
 * Aucune donnée métier n'y figure : la fonction serveur ne renvoie que des
 * agrégats. Le super-administrateur administre des abonnements, pas des
 * campagnes.
 */
export function usePlatformOverview(enabled: boolean) {
  return useQuery({
    queryKey: OVERVIEW,
    enabled,
    queryFn: async (): Promise<PlatformOverview> => {
      const { data, error } = await supabase.rpc('platform_overview', {})
      if (error) throw new Error(describeError(error))
      return data as PlatformOverview
    },
  })
}

export interface ScheduledTaskRun {
  id: string
  task: 'subscription_lifecycle' | 'alert_evaluation'
  started_at: string
  finished_at: string | null
  status: 'running' | 'succeeded' | 'failed'
  tenants_seen: number
  changes: number
  detail_count: number
  error_count: number
  error: string | null
}

/**
 * Historique des tâches planifiées.
 *
 * Sans cet écran, deux traitements quotidiens tourneraient — ou ne tourneraient
 * pas — sans que personne puisse le constater. Une tâche absente se remarque
 * tard : le jour où un client se plaint de ne pas avoir été prévenu.
 */
export function useScheduledTaskHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['scheduled-task-history'],
    enabled,
    queryFn: async (): Promise<ScheduledTaskRun[]> => {
      const { data, error } = await supabase.rpc('scheduled_task_history', { p_limit: 20 })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as ScheduledTaskRun[]
    },
  })
}

export function useOpenSupportSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { tenantId: string; reason: string; durationMins: number }) => {
      const { error } = await supabase.rpc('open_support_session', {
        p_tenant_id: args.tenantId,
        p_reason: args.reason,
        p_duration_mins: args.durationMins,
      })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: OVERVIEW }),
  })
}

export function useRevokeSupportSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc('revoke_support_session', { p_session_id: sessionId })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: OVERVIEW }),
  })
}

export function useSetTenantStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { tenantId: string; status: string; reason: string }) => {
      const { error } = await supabase.rpc('set_tenant_status', {
        p_tenant_id: args.tenantId,
        p_status: args.status,
        p_reason: args.reason,
      })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: OVERVIEW }),
  })
}
